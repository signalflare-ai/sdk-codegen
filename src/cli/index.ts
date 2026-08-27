#!/usr/bin/env bun

import { BunRuntime } from "@effect/platform-bun";
import { Console, Effect } from "effect";
import type { Diagnostic, ValidationReport } from "../contract/diagnostics.js";
import { CliUsageError } from "../core/errors.js";
import { CompilerLive } from "../core/layers.js";
import {
  TARGET_NAMES,
  generateConfiguredSdks,
  type GenerationReport,
  type TargetName,
} from "../generator/generate.js";
import { runValidateCommand, type ValidateCommandResult } from "./validate.js";

interface CliOptions {
  command?: string;
  configPath: string;
  json: boolean;
  help: boolean;
  dryRun: boolean;
  targets: TargetName[];
}

const USAGE = `Signalflare SDK Codegen

Usage:
  signalflare-sdk validate [--config sdk.config.ts] [--json]
  signalflare-sdk generate [--config sdk.config.ts] [--target typescript] [--dry-run] [--json]

Commands:
  validate    Validate the product manifest and canonical OpenAPI contract
  generate    Generate configured SDK targets through Oagen

Options:
  --config <path>  Product SDK manifest (default: sdk.config.ts)
  --target <name>  Generate only one configured target; may be repeated
  --dry-run        Plan generation without writing files
  --json           Emit a machine-readable report
  --help           Show this help
`;

function isTargetName(value: string): value is TargetName {
  return (TARGET_NAMES as readonly string[]).includes(value);
}

const parseArguments = Effect.fn("SdkCli.parseArguments")(function* (args: string[]) {
  const options: CliOptions = {
    configPath: "sdk.config.ts",
    json: false,
    help: false,
    dryRun: false,
    targets: [],
  };
  const remaining = [...args];
  const command = remaining.shift();
  if (command !== undefined) options.command = command;

  while (remaining.length > 0) {
    const argument = remaining.shift();
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--format") {
      const format = remaining.shift();
      if (format !== "json" && format !== "text") {
        return yield* new CliUsageError({ message: "--format must be json or text." });
      }
      options.json = format === "json";
    } else if (argument === "--config") {
      const value = remaining.shift();
      if (!value) return yield* new CliUsageError({ message: "--config requires a path." });
      options.configPath = value;
    } else if (argument === "--target") {
      const value = remaining.shift();
      if (!value || !isTargetName(value)) {
        return yield* new CliUsageError({
          message: `--target must be one of: ${TARGET_NAMES.join(", ")}.`,
        });
      }
      options.targets.push(value);
    } else {
      return yield* new CliUsageError({ message: `Unknown argument: ${argument}` });
    }
  }

  if (options.command && options.command !== "validate" && options.command !== "generate") {
    return yield* new CliUsageError({ message: `Unknown command: ${options.command}` });
  }
  return options;
});

function formatDiagnostic(diagnostic: Diagnostic): string {
  const location = [diagnostic.file, diagnostic.pointer].filter(Boolean).join("");
  const operation = diagnostic.operation
    ? ` (${diagnostic.operation.method} ${diagnostic.operation.path}${diagnostic.operation.operationId ? `, ${diagnostic.operation.operationId}` : ""})`
    : "";
  const hint = diagnostic.hint ? `\n    hint: ${diagnostic.hint}` : "";
  return `${diagnostic.severity.toUpperCase()} ${diagnostic.code}${location ? ` ${location}` : ""}${operation}\n    ${diagnostic.message}${hint}`;
}

const setExitCode = (code: number) =>
  Effect.sync(() => {
    process.exitCode = code;
  });

const printValidationFailure = Effect.fn("SdkCli.printValidationFailure")(function* (
  validation: ValidationReport,
  options: CliOptions,
) {
  if (options.json) {
    yield* Console.log(
      JSON.stringify(
        {
          command: options.command,
          config: options.configPath,
          report: validation,
        },
        null,
        2,
      ),
    );
  } else {
    yield* Effect.forEach(validation.diagnostics, (diagnostic) =>
      Console.error(formatDiagnostic(diagnostic)),
    );
  }
});

const printValidationResult = Effect.fn("SdkCli.printValidationResult")(function* (
  result: ValidateCommandResult,
  options: CliOptions,
) {
  if (options.json) {
    yield* Console.log(JSON.stringify(result, null, 2));
  } else {
    yield* Effect.forEach(result.report.diagnostics, (diagnostic) =>
      Console.log(formatDiagnostic(diagnostic)),
    );
    const { errors, warnings } = result.report.summary;
    const status = result.report.valid ? "valid" : "invalid";
    yield* Console.log(`Contract ${status}: ${errors} error(s), ${warnings} warning(s).`);
  }
  if (!result.report.valid) yield* setExitCode(1);
});

const printGenerationResult = Effect.fn("SdkCli.printGenerationResult")(function* (
  result: GenerationReport,
  options: CliOptions,
) {
  if (options.json) {
    yield* Console.log(JSON.stringify(result, null, 2));
    return;
  }
  yield* Effect.forEach(result.targets, (target) => {
    const action = target.dryRun ? "Would generate" : "Generated";
    return Effect.gen(function* () {
      yield* Console.log(
        `${action} ${target.files.length} ${target.target} files (${target.operations} operations) in ${target.output}`,
      );
      yield* Effect.forEach(target.warnings, (warning) => Console.warn(`WARNING ${warning}`));
    });
  });
});

const runCommand = Effect.fn("SdkCli.runCommand")(function* (options: CliOptions) {
  if (options.help || !options.command) {
    yield* Console.log(USAGE);
    return;
  }
  if (options.command === "validate") {
    const result = yield* runValidateCommand({ configPath: options.configPath });
    yield* printValidationResult(result, options);
    return;
  }

  const result = yield* generateConfiguredSdks({
    configPath: options.configPath,
    dryRun: options.dryRun,
    quiet: options.json,
    ...(options.targets.length === 0 ? {} : { targets: options.targets }),
  });
  yield* printGenerationResult(result, options);
});

const program = parseArguments(process.argv.slice(2)).pipe(
  Effect.flatMap((options) =>
    runCommand(options).pipe(
      Effect.catchTags({
        SdkConfigLoadError: (error) =>
          Effect.gen(function* () {
            if (error.validation) yield* printValidationFailure(error.validation, options);
            else yield* Console.error(error.message);
            yield* setExitCode(1);
          }),
        GenerationError: (error) =>
          Effect.gen(function* () {
            if (error.validation) yield* printValidationFailure(error.validation, options);
            else yield* Console.error(error.message);
            yield* setExitCode(1);
          }),
      }),
    ),
  ),
  Effect.catchTag("CliUsageError", (error) =>
    Effect.gen(function* () {
      yield* Console.error(error.message);
      yield* Console.error(USAGE);
      yield* setExitCode(2);
    }),
  ),
  Effect.provide(CompilerLive),
);

BunRuntime.runMain(program);
