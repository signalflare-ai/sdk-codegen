import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BaseResolver,
  Oas3_1Types,
  bundleDocument,
  createConfig,
  makeDocumentFromString,
} from "@redocly/openapi-core";
import type { Diagnostic } from "./diagnostics.js";
import { createValidationReport, type ValidationReport } from "./diagnostics.js";
import { isRecord } from "../shared/object.js";

export type OpenApiDocument = Record<string, unknown>;

export interface LoadedContract {
  document: OpenApiDocument;
  path: string;
  validation: ValidationReport;
}

export class ContractLoadError extends Error {
  override readonly name = "ContractLoadError";

  constructor(
    message: string,
    readonly validation: ValidationReport,
  ) {
    super(message);
  }
}

function problemPointer(problem: unknown): string | undefined {
  if (!isRecord(problem) || !Array.isArray(problem.location)) return undefined;
  for (const location of problem.location) {
    if (isRecord(location) && typeof location.pointer === "string") return location.pointer;
  }
  return undefined;
}

export async function loadProductContract(
  specPath: string,
  cwd = process.cwd(),
): Promise<LoadedContract> {
  const absolutePath = resolve(cwd, specPath);
  const diagnostics: Diagnostic[] = [];
  let content: string;

  try {
    content = await readFile(absolutePath, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const report = createValidationReport([
      {
        severity: "error",
        code: "contract.file.unreadable",
        message: `Unable to read contract: ${detail}`,
        file: absolutePath,
        pointer: "#",
      },
    ]);
    throw new ContractLoadError(`Unable to read OpenAPI contract at ${absolutePath}.`, report);
  }

  try {
    const source = makeDocumentFromString(content, pathToFileURL(absolutePath).href);
    const config = await createConfig({});
    const result = await bundleDocument({
      document: source,
      config,
      types: Oas3_1Types,
      externalRefResolver: new BaseResolver(),
      dereference: false,
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
      throw new ContractLoadError(`OpenAPI parsing failed for ${absolutePath}.`, validation);
    }

    const parsed = result.bundle.parsed;
    if (!isRecord(parsed)) {
      const invalid = createValidationReport([
        {
          severity: "error",
          code: "contract.document.invalid",
          message: "The OpenAPI document root must be an object.",
          file: absolutePath,
          pointer: "#",
        },
      ]);
      throw new ContractLoadError(`OpenAPI document at ${absolutePath} is not an object.`, invalid);
    }

    return { document: parsed, path: absolutePath, validation };
  } catch (error) {
    if (error instanceof ContractLoadError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    const report = createValidationReport([
      {
        severity: "error",
        code: "contract.parse.failed",
        message: detail,
        file: absolutePath,
        pointer: "#",
      },
    ]);
    throw new ContractLoadError(`OpenAPI parsing failed for ${absolutePath}.`, report);
  }
}
