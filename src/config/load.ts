import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import type { ValidationReport } from "../contract/diagnostics.js";
import type { SignalflareSdkConfig } from "./schema.js";
import { validateSdkConfig } from "./validate.js";

export interface LoadedSdkConfig {
  config: SignalflareSdkConfig;
  path: string;
  directory: string;
  validation: ValidationReport;
}

export class SdkConfigLoadError extends Error {
  override readonly name = "SdkConfigLoadError";

  constructor(
    message: string,
    readonly validation?: ValidationReport,
  ) {
    super(message);
  }
}

export async function loadSdkConfig(
  configPath = "sdk.config.ts",
  cwd = process.cwd(),
): Promise<LoadedSdkConfig> {
  const absolutePath = resolve(cwd, configPath);
  let imported: unknown;

  try {
    imported = await import(pathToFileURL(absolutePath).href);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SdkConfigLoadError(`Failed to load SDK config at ${absolutePath}: ${detail}`);
  }

  const value =
    typeof imported === "object" && imported !== null && "default" in imported
      ? (imported as { default: unknown }).default
      : imported;
  const validation = validateSdkConfig(value);
  if (!validation.valid) {
    throw new SdkConfigLoadError(`Invalid SDK config at ${absolutePath}.`, validation);
  }

  return {
    config: value as SignalflareSdkConfig,
    path: absolutePath,
    directory: dirname(absolutePath),
    validation,
  };
}
