import { resolve } from "node:path";
import { Effect, Result } from "effect";
import { loadSdkConfigEffect } from "../config/load.js";
import type { Diagnostic, ValidationReport } from "../contract/diagnostics.js";
import { createValidationReport } from "../contract/diagnostics.js";
import { loadProductContractEffect } from "../contract/load.js";
import { validateProductContract } from "../contract/validate.js";

export interface ValidateCommandOptions {
  configPath: string;
  cwd?: string;
}

export interface ValidateCommandResult {
  command: "validate";
  config: string;
  contract?: string;
  report: ValidationReport;
}

export const runValidateCommandEffect = Effect.fn("SdkCli.validate")(function* (
  options: ValidateCommandOptions,
) {
  const cwd = options.cwd ?? process.cwd();
  const loadedConfig = yield* loadSdkConfigEffect(options.configPath, cwd);
  const contractPath = resolve(loadedConfig.directory, loadedConfig.config.contract.spec);
  const contractResult = yield* Effect.result(loadProductContractEffect(contractPath));

  if (Result.isFailure(contractResult)) {
    return {
      command: "validate",
      config: loadedConfig.path,
      contract: contractPath,
      report: contractResult.failure.validation,
    } satisfies ValidateCommandResult;
  }

  const loadedContract = contractResult.success;
  const contractValidation = validateProductContract(loadedContract.document, loadedConfig.config, {
    file: loadedContract.path,
  });
  const diagnostics: Diagnostic[] = [
    ...loadedConfig.validation.diagnostics,
    ...loadedContract.validation.diagnostics,
    ...contractValidation.diagnostics,
  ];

  return {
    command: "validate",
    config: loadedConfig.path,
    contract: loadedContract.path,
    report: createValidationReport(diagnostics),
  } satisfies ValidateCommandResult;
});

/** Promise compatibility boundary for consumers not using Effect. */
export function runValidateCommand(
  options: ValidateCommandOptions,
): Promise<ValidateCommandResult> {
  return Effect.runPromise(runValidateCommandEffect(options));
}
