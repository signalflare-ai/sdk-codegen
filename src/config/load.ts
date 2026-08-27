import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Schema } from "effect";
import { createValidationReport, type ValidationReport } from "../contract/diagnostics.js";
import { SdkConfigLoadError } from "../core/errors.js";
import { SignalflareSdkConfig } from "./schema.js";
import { validateSdkConfig } from "./validate.js";

export interface LoadedSdkConfig {
  config: SignalflareSdkConfig;
  path: string;
  directory: string;
  validation: ValidationReport;
}

export const loadSdkConfig = Effect.fn("SdkConfig.load")(function* (
  configPath = "sdk.config.ts",
  cwd = process.cwd(),
) {
  const absolutePath = resolve(cwd, configPath);
  const imported = yield* Effect.tryPromise({
    try: () => import(pathToFileURL(absolutePath).href) as Promise<unknown>,
    catch: (cause) =>
      new SdkConfigLoadError({
        message: `Failed to load SDK config at ${absolutePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      }),
  });

  const value =
    typeof imported === "object" && imported !== null && "default" in imported
      ? (imported as { default: unknown }).default
      : imported;
  const validation = validateSdkConfig(value);
  if (!validation.valid) {
    return yield* new SdkConfigLoadError({
      message: `Invalid SDK config at ${absolutePath}.`,
      validation,
    });
  }

  const config = yield* Schema.decodeUnknownEffect(SignalflareSdkConfig)(value, {
    errors: "all",
    onExcessProperty: "error",
  }).pipe(
    Effect.mapError(
      (cause) =>
        new SdkConfigLoadError({
          message: `Invalid SDK config at ${absolutePath}: ${cause.message}`,
          validation: createValidationReport([
            {
              severity: "error",
              code: "config.schema.invalid",
              message: cause.message,
              pointer: "#",
            },
          ]),
          cause,
        }),
    ),
  );

  return {
    config,
    path: absolutePath,
    directory: dirname(absolutePath),
    validation,
  } satisfies LoadedSdkConfig;
});
