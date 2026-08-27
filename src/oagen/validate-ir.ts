import { type ApiSpec, type TypeRef } from "@workos/oagen";
import type { Diagnostic, ValidationReport } from "../contract/diagnostics.js";
import { createValidationReport } from "../contract/diagnostics.js";

function validateTypeReference(
  type: TypeRef,
  pointer: string,
  models: ReadonlySet<string>,
  enums: ReadonlySet<string>,
  diagnostics: Diagnostic[],
): void {
  switch (type.kind) {
    case "model":
      if (!models.has(type.name)) {
        diagnostics.push({
          severity: "error",
          code: "oagen.ir.model-reference.unresolved",
          message: `Oagen produced an unresolved model reference ${JSON.stringify(type.name)}.`,
          pointer,
          hint: "Promote the nested object to a named component schema or add a focused pre-IR normalization.",
        });
      }
      return;
    case "enum":
      if (!enums.has(type.name)) {
        diagnostics.push({
          severity: "error",
          code: "oagen.ir.enum-reference.unresolved",
          message: `Oagen produced an unresolved enum reference ${JSON.stringify(type.name)}.`,
          pointer,
          hint: "Promote the inline enum to a named component schema.",
        });
      }
      return;
    case "array":
      validateTypeReference(type.items, `${pointer}/items`, models, enums, diagnostics);
      return;
    case "nullable":
      validateTypeReference(type.inner, `${pointer}/inner`, models, enums, diagnostics);
      return;
    case "map":
      validateTypeReference(type.valueType, `${pointer}/valueType`, models, enums, diagnostics);
      if (type.keyType) {
        validateTypeReference(type.keyType, `${pointer}/keyType`, models, enums, diagnostics);
      }
      return;
    case "union":
      for (const [index, variant] of type.variants.entries()) {
        validateTypeReference(variant, `${pointer}/variants/${index}`, models, enums, diagnostics);
      }
      return;
    case "primitive":
    case "literal":
      return;
  }
}

/** Reject parser output that would force emitters to import non-existent types. */
export function validateOagenIr(spec: ApiSpec): ValidationReport {
  const diagnostics: Diagnostic[] = [];
  const models = new Set(spec.models.map((model) => model.name));
  const enums = new Set(spec.enums.map((item) => item.name));

  for (const [modelIndex, model] of spec.models.entries()) {
    for (const [fieldIndex, field] of model.fields.entries()) {
      validateTypeReference(
        field.type,
        `#/models/${modelIndex}/fields/${fieldIndex}/type`,
        models,
        enums,
        diagnostics,
      );
    }
    for (const [parameterIndex, parameter] of (model.typeParams ?? []).entries()) {
      if (parameter.default) {
        validateTypeReference(
          parameter.default,
          `#/models/${modelIndex}/typeParams/${parameterIndex}/default`,
          models,
          enums,
          diagnostics,
        );
      }
    }
    for (const [value, target] of Object.entries(model.discriminator?.mapping ?? {})) {
      if (!models.has(target)) {
        diagnostics.push({
          severity: "error",
          code: "oagen.ir.discriminator-reference.unresolved",
          message: `Oagen discriminator value ${JSON.stringify(value)} references missing model ${JSON.stringify(target)}.`,
          pointer: `#/models/${modelIndex}/discriminator/mapping/${value}`,
        });
      }
    }
  }

  for (const [serviceIndex, service] of spec.services.entries()) {
    for (const [operationIndex, operation] of service.operations.entries()) {
      const pointer = `#/services/${serviceIndex}/operations/${operationIndex}`;
      for (const [collectionName, parameters] of [
        ["pathParams", operation.pathParams],
        ["queryParams", operation.queryParams],
        ["headerParams", operation.headerParams],
        ["cookieParams", operation.cookieParams ?? []],
      ] as const) {
        for (const [parameterIndex, parameter] of parameters.entries()) {
          validateTypeReference(
            parameter.type,
            `${pointer}/${collectionName}/${parameterIndex}/type`,
            models,
            enums,
            diagnostics,
          );
        }
      }
      if (operation.requestBody) {
        validateTypeReference(
          operation.requestBody,
          `${pointer}/requestBody`,
          models,
          enums,
          diagnostics,
        );
      }
      validateTypeReference(operation.response, `${pointer}/response`, models, enums, diagnostics);
      for (const [responseIndex, response] of (operation.successResponses ?? []).entries()) {
        validateTypeReference(
          response.type,
          `${pointer}/successResponses/${responseIndex}/type`,
          models,
          enums,
          diagnostics,
        );
      }
      for (const [errorIndex, error] of operation.errors.entries()) {
        if (error.type) {
          validateTypeReference(
            error.type,
            `${pointer}/errors/${errorIndex}/type`,
            models,
            enums,
            diagnostics,
          );
        }
      }
      if (operation.pagination) {
        validateTypeReference(
          operation.pagination.itemType,
          `${pointer}/pagination/itemType`,
          models,
          enums,
          diagnostics,
        );
      }
    }
  }

  return createValidationReport(diagnostics);
}
