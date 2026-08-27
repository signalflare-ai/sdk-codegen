import type { SignalflareSdkConfig } from "../../config/schema.js";
import { isRecord, resolveLocalReference } from "../../shared/object.js";
import type { Diagnostic, DiagnosticOperation } from "../diagnostics.js";
import type { OpenApiDocument } from "../load.js";
import type { ContractOperation } from "../operations.js";

export interface ValidationContext {
  document: OpenApiDocument;
  config: SignalflareSdkConfig;
  file?: string;
  diagnostics: Diagnostic[];
}

function operationDetails(operation: ContractOperation): DiagnosticOperation {
  return {
    method: operation.method.toUpperCase(),
    path: operation.path,
    ...(typeof operation.operation.operationId === "string"
      ? { operationId: operation.operation.operationId }
      : {}),
  };
}

export function addDiagnostic(
  context: ValidationContext,
  diagnostic: Omit<Diagnostic, "file">,
  operation?: ContractOperation,
): void {
  context.diagnostics.push({
    ...diagnostic,
    ...(context.file === undefined ? {} : { file: context.file }),
    ...(operation === undefined ? {} : { operation: operationDetails(operation) }),
  });
}

export function resolveObject(
  document: OpenApiDocument,
  value: unknown,
): Record<string, unknown> | undefined {
  const resolved = resolveLocalReference(document, value);
  return isRecord(resolved) ? resolved : undefined;
}
