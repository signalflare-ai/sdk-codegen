import { resolve } from "node:path";
import { loadSdkConfig } from "../config/load.js";
import type { Diagnostic, ValidationReport } from "../contract/diagnostics.js";
import { createValidationReport } from "../contract/diagnostics.js";
import { ContractLoadError, loadProductContract } from "../contract/load.js";
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

export async function runValidateCommand(
  options: ValidateCommandOptions,
): Promise<ValidateCommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const loadedConfig = await loadSdkConfig(options.configPath, cwd);
  const contractPath = resolve(loadedConfig.directory, loadedConfig.config.contract.spec);
  let loadedContract;

  try {
    loadedContract = await loadProductContract(contractPath);
  } catch (error) {
    if (error instanceof ContractLoadError) {
      return {
        command: "validate",
        config: loadedConfig.path,
        contract: contractPath,
        report: error.validation,
      };
    }
    throw error;
  }

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
  };
}
