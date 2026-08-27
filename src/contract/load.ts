import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BaseResolver,
  Oas3_1Types,
  bundleDocument,
  createConfig,
  makeDocumentFromString,
} from "@redocly/openapi-core";
import { Effect, FileSystem } from "effect";
import { ContractLoadError } from "../core/errors.js";
import { isRecord } from "../shared/object.js";
import type { Diagnostic } from "./diagnostics.js";
import { createValidationReport, type ValidationReport } from "./diagnostics.js";

export type OpenApiDocument = Record<string, unknown>;

export interface LoadedContract {
  document: OpenApiDocument;
  path: string;
  validation: ValidationReport;
}

export { ContractLoadError } from "../core/errors.js";

function problemPointer(problem: unknown): string | undefined {
  if (!isRecord(problem) || !Array.isArray(problem.location)) return undefined;
  for (const location of problem.location) {
    if (isRecord(location) && typeof location.pointer === "string") return location.pointer;
  }
  return undefined;
}

export const loadProductContract = Effect.fn("ProductContract.load")(function* (
  specPath: string,
  cwd = process.cwd(),
) {
  const absolutePath = resolve(cwd, specPath);
  const diagnostics: Diagnostic[] = [];
  const fs = yield* FileSystem.FileSystem;
  const content = yield* fs.readFileString(absolutePath).pipe(
    Effect.mapError(
      (cause) =>
        new ContractLoadError({
          message: `Unable to read OpenAPI contract at ${absolutePath}.`,
          validation: createValidationReport([
            {
              severity: "error",
              code: "contract.file.unreadable",
              message: `Unable to read contract: ${cause.message}`,
              file: absolutePath,
              pointer: "#",
            },
          ]),
          cause,
        }),
    ),
  );

  const result = yield* Effect.tryPromise({
    try: () => {
      const source = makeDocumentFromString(content, pathToFileURL(absolutePath).href);
      return createConfig({}).then((config) =>
        bundleDocument({
          document: source,
          config,
          types: Oas3_1Types,
          externalRefResolver: new BaseResolver(),
          dereference: false,
        }),
      );
    },
    catch: (cause) =>
      new ContractLoadError({
        message: `OpenAPI parsing failed for ${absolutePath}.`,
        validation: createValidationReport([
          {
            severity: "error",
            code: "contract.parse.failed",
            message: cause instanceof Error ? cause.message : String(cause),
            file: absolutePath,
            pointer: "#",
          },
        ]),
        cause,
      }),
  });

  for (const problem of result.problems) {
    const pointer = problemPointer(problem);
    diagnostics.push({
      severity: problem.severity === "error" ? "error" : "warning",
      code: `openapi.${problem.ruleId ?? "parse"}`,
      message: problem.message,
      file: absolutePath,
      ...(pointer === undefined ? {} : { pointer }),
    });
  }

  const validation = createValidationReport(diagnostics);
  if (!validation.valid) {
    return yield* new ContractLoadError({
      message: `OpenAPI parsing failed for ${absolutePath}.`,
      validation,
    });
  }

  const parsed = result.bundle.parsed;
  if (!isRecord(parsed)) {
    return yield* new ContractLoadError({
      message: `OpenAPI document at ${absolutePath} is not an object.`,
      validation: createValidationReport([
        {
          severity: "error",
          code: "contract.document.invalid",
          message: "The OpenAPI document root must be an object.",
          file: absolutePath,
          pointer: "#",
        },
      ]),
    });
  }

  return { document: parsed, path: absolutePath, validation } satisfies LoadedContract;
});
