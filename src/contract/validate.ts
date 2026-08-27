import type { SignalflareSdkConfig } from "../config/schema.js";
import type { ValidationReport } from "./diagnostics.js";
import { createValidationReport } from "./diagnostics.js";
import { parseOperationSdkMetadata } from "./extensions.js";
import { validateEffectJsonSchemaCompatibility } from "./json-schema.js";
import type { OpenApiDocument } from "./load.js";
import { listContractOperations, type ContractOperation } from "./operations.js";
import { addDiagnostic, type ValidationContext } from "./validate/context.js";
import { validateOperationIdentity } from "./validate/operation.js";
import { validateParameters } from "./validate/parameters.js";
import { validateRequestBody } from "./validate/request-body.js";
import { validateResponses } from "./validate/responses.js";
import { validateLegacyNullable } from "./validate/schema.js";
import { validateOperationSecurity } from "./validate/security.js";
import { validateTopLevel } from "./validate/top-level.js";

/**
 * Validates Signalflare's authoring and generated-SDK policies after Redocly
 * has parsed and bundled the document. These rules remain compiler-owned rather
 * than generic Redocly/Spectral rules because they combine product metadata,
 * profile selection, emitter transport limits, and operation-aware diagnostics
 * with stable JSON Pointers consumed by product CI.
 */
export function validateProductContract(
  document: OpenApiDocument,
  config: SignalflareSdkConfig,
  options: { file?: string } = {},
): ValidationReport {
  const context: ValidationContext = {
    document,
    config,
    diagnostics: [],
    ...(options.file === undefined ? {} : { file: options.file }),
  };

  validateTopLevel(context);
  validateLegacyNullable(context);
  for (const diagnostic of validateEffectJsonSchemaCompatibility(document).diagnostics) {
    addDiagnostic(context, diagnostic);
  }
  const operationIds = new Map<string, ContractOperation>();

  for (const operation of listContractOperations(document)) {
    validateOperationIdentity(context, operation, operationIds);
    const parsedMetadata = parseOperationSdkMetadata(operation.operation, operation.pointer);
    for (const diagnostic of parsedMetadata.diagnostics) {
      addDiagnostic(context, diagnostic, operation);
    }
    const metadata = parsedMetadata.metadata;
    const production =
      metadata !== undefined &&
      metadata.generate &&
      metadata.implemented &&
      metadata.audiences.some((audience) => audience !== "preview");

    validateParameters(context, operation);
    validateRequestBody(context, operation, production);
    validateResponses(context, operation, production);
    validateOperationSecurity(context, operation, production);
  }

  return createValidationReport(context.diagnostics);
}
