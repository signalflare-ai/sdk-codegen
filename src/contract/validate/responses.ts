import { isJsonMediaType } from "../../shared/http.js";
import { escapeJsonPointer, isRecord } from "../../shared/object.js";
import type { ContractOperation } from "../operations.js";
import { addDiagnostic, resolveObject, type ValidationContext } from "./context.js";
import { isNamedComponentSchema } from "./schema.js";

export function validateResponses(
  context: ValidationContext,
  operation: ContractOperation,
  production: boolean,
): void {
  const responses = resolveObject(context.document, operation.operation.responses);
  if (!responses) {
    addDiagnostic(
      context,
      {
        severity: "error",
        code: "operation.responses.required",
        message: "Every operation must declare responses.",
        pointer: `${operation.pointer}/responses`,
      },
      operation,
    );
    return;
  }

  const successEntries = Object.entries(responses).filter(([status]) => /^2\d\d$/.test(status));
  if (successEntries.length === 0) {
    addDiagnostic(
      context,
      {
        severity: "error",
        code: "operation.success-response.required",
        message: "Every operation must declare at least one explicit 2xx response.",
        pointer: `${operation.pointer}/responses`,
      },
      operation,
    );
  }

  for (const [status, rawResponse] of successEntries) {
    const response = resolveObject(context.document, rawResponse);
    if (!response || response.content === undefined) continue;
    if (!isRecord(response.content)) {
      addDiagnostic(
        context,
        {
          severity: "error",
          code: "operation.response.content.invalid",
          message: `Response ${status} content must be an object.`,
          pointer: `${operation.pointer}/responses/${status}/content`,
        },
        operation,
      );
      continue;
    }
    for (const [mediaType, rawMedia] of Object.entries(response.content)) {
      if (!isJsonMediaType(mediaType)) {
        if (production) {
          addDiagnostic(
            context,
            {
              severity: "error",
              code: "operation.transport.unsupported",
              message: `Response media type ${JSON.stringify(mediaType)} is not supported by the initial JSON/no-content compiler.`,
              pointer: `${operation.pointer}/responses/${status}/content/${escapeJsonPointer(mediaType)}`,
            },
            operation,
          );
        }
        continue;
      }
      const media = resolveObject(context.document, rawMedia);
      if (production && !isNamedComponentSchema(media?.schema)) {
        addDiagnostic(
          context,
          {
            severity: "error",
            code: "operation.response-schema.named-required",
            message: "Production JSON responses must reference a named component schema.",
            pointer: `${operation.pointer}/responses/${status}/content/${escapeJsonPointer(mediaType)}/schema`,
          },
          operation,
        );
      }
    }
  }

  if (production) {
    const errors = Object.entries(responses).filter(
      ([status]) => status === "default" || /^[45]\d\d$/.test(status),
    );
    if (errors.length === 0) {
      addDiagnostic(
        context,
        {
          severity: "error",
          code: "operation.error-response.required",
          message: "Production operations must document at least one expected error response.",
          pointer: `${operation.pointer}/responses`,
        },
        operation,
      );
    }
    for (const [status, rawResponse] of errors) {
      const response = resolveObject(context.document, rawResponse);
      if (!response || !isRecord(response.content)) continue;
      const json = Object.entries(response.content).find(([mediaType]) =>
        isJsonMediaType(mediaType),
      );
      const media = json ? resolveObject(context.document, json[1]) : undefined;
      if (!json || !isNamedComponentSchema(media?.schema)) {
        addDiagnostic(
          context,
          {
            severity: "error",
            code: "operation.error-schema.named-required",
            message: `Error response ${status} must use a named JSON component schema.`,
            pointer: `${operation.pointer}/responses/${status}`,
          },
          operation,
        );
      }
    }
  }
}
