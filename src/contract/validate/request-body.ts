import { isJsonMediaType } from "../../shared/http.js";
import { escapeJsonPointer, isRecord } from "../../shared/object.js";
import type { ContractOperation } from "../operations.js";
import { addDiagnostic, resolveObject, type ValidationContext } from "./context.js";
import { isNamedComponentSchema } from "./schema.js";

export function validateRequestBody(
  context: ValidationContext,
  operation: ContractOperation,
  production: boolean,
): void {
  if (operation.operation.requestBody === undefined) return;
  if (operation.method === "get" || operation.method === "delete") {
    addDiagnostic(
      context,
      {
        severity: "error",
        code: "operation.request-body.method-unsupported",
        message: `${operation.method.toUpperCase()} operations must represent request fields as path, query, or header parameters, not a request body.`,
        pointer: `${operation.pointer}/requestBody`,
      },
      operation,
    );
  }

  const body = resolveObject(context.document, operation.operation.requestBody);
  if (!body || !isRecord(body.content) || Object.keys(body.content).length === 0) {
    addDiagnostic(
      context,
      {
        severity: "error",
        code: "operation.request-body.content.required",
        message: "Request body must declare content.",
        pointer: `${operation.pointer}/requestBody/content`,
      },
      operation,
    );
    return;
  }

  const jsonMedia = Object.entries(body.content).filter(([mediaType]) =>
    isJsonMediaType(mediaType),
  );
  if (jsonMedia.length === 0 && production) {
    addDiagnostic(
      context,
      {
        severity: "error",
        code: "operation.transport.unsupported",
        message: "The initial compiler supports JSON request bodies only.",
        pointer: `${operation.pointer}/requestBody/content`,
      },
      operation,
    );
  } else if (production) {
    for (const [mediaType, rawMedia] of jsonMedia) {
      const media = resolveObject(context.document, rawMedia);
      if (!isNamedComponentSchema(media?.schema)) {
        addDiagnostic(
          context,
          {
            severity: "error",
            code: "operation.request-schema.named-required",
            message: "Production JSON request bodies must reference a named component schema.",
            pointer: `${operation.pointer}/requestBody/content/${escapeJsonPointer(mediaType)}/schema`,
          },
          operation,
        );
      }
    }
  }
}
