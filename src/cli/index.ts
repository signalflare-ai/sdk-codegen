#!/usr/bin/env bun

import { SdkConfigLoadError } from "../config/load.js";
import type { Diagnostic, ValidationReport } from "../contract/diagnostics.js";
import {
  GenerationError,
  TARGET_NAMES,
  generateConfiguredSdks,
  type TargetName,
} from "../generator/generate.js";
import { runValidateCommand } from "./validate.js";

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

function parseArguments(args: string[]): CliOptions {
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
      if (format !== "json" && format !== "text") throw new Error("--format must be json or text.");
      options.json = format === "json";
    } else if (argument === "--config") {
      const value = remaining.shift();
      if (!value) throw new Error("--config requires a path.");
      options.configPath = value;
    } else if (argument === "--target") {
      const value = remaining.shift();
      if (!value || !isTargetName(value)) {
        throw new Error(`--target must be one of: ${TARGET_NAMES.join(", ")}.`);
      }
      options.targets.push(value);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function formatDiagnostic(diagnostic: Diagnostic): string {
  const location = [diagnostic.file, diagnostic.pointer].filter(Boolean).join("");
  const operation = diagnostic.operation
    ? ` (${diagnostic.operation.method} ${diagnostic.operation.path}${diagnostic.operation.operationId ? `, ${diagnostic.operation.operationId}` : ""})`
    : "";
  const hint = diagnostic.hint ? `\n    hint: ${diagnostic.hint}` : "";
  return `${diagnostic.severity.toUpperCase()} ${diagnostic.code}${location ? ` ${location}` : ""}${operation}\n    ${diagnostic.message}${hint}`;
}

function printValidationFailure(
  validation: ValidationReport,
  json: boolean,
  configPath: string,
): void {
  if (json) {
    console.log(
      JSON.stringify(
        {
          command: "generate",
          config: configPath,
          report: validation,
        },
        null,
        2,
      ),
    );
  } else {
    for (const diagnostic of validation.diagnostics) console.error(formatDiagnostic(diagnostic));
  }
}

async function runValidate(options: CliOptions): Promise<void> {
  const result = await runValidateCommand({ configPath: options.configPath });
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const diagnostic of result.report.diagnostics) console.log(formatDiagnostic(diagnostic));
    const { errors, warnings } = result.report.summary;
    const status = result.report.valid ? "valid" : "invalid";
    console.log(`Contract ${status}: ${errors} error(s), ${warnings} warning(s).`);
  }
  if (!result.report.valid) process.exitCode = 1;
}

async function runGenerate(options: CliOptions): Promise<void> {
  const result = await generateConfiguredSdks({
    configPath: options.configPath,
    dryRun: options.dryRun,
    quiet: options.json,
    ...(options.targets.length === 0 ? {} : { targets: options.targets }),
  });
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  for (const target of result.targets) {
    const action = target.dryRun ? "Would generate" : "Generated";
    console.log(
      `${action} ${target.files.length} ${target.target} files (${target.operations} operations) in ${target.output}`,
    );
    for (const warning of target.warnings) console.warn(`WARNING ${warning}`);
  }
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  if (options.help || !options.command) {
    console.log(USAGE);
    return;
  }
  if (options.command !== "validate" && options.command !== "generate") {
    console.error(`Unknown command: ${options.command}\n`);
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  try {
    if (options.command === "validate") await runValidate(options);
    else await runGenerate(options);
  } catch (error) {
    if (error instanceof SdkConfigLoadError && error.validation) {
      printValidationFailure(error.validation, options.json, options.configPath);
    } else if (error instanceof GenerationError && error.validation) {
      printValidationFailure(error.validation, options.json, options.configPath);
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  }
}

await main();
