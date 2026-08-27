import { resolve } from "node:path";
import { Effect, Result } from "effect";
import { loadSdkConfig } from "../config/load.js";
import type { Diagnostic, ValidationReport } from "../contract/diagnostics.js";
import { createValidationReport } from "../contract/diagnostics.js";
import { loadProductContract } from "../contract/load.js";
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

export const runValidateCommand = Effect.fn("SdkCli.validate")(function* (
  options: ValidateCommandOptions,
) {
  const cwd = options.cwd ?? process.cwd();
  const loadedConfig = yield* loadSdkConfig(options.configPath, cwd);
  const contractPath = resolve(loadedConfig.directory, loadedConfig.config.contract.spec);
  const contractResult = yield* Effect.result(loadProductContract(contractPath));

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
