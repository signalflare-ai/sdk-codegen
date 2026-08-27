import { JsonSchema, SchemaRepresentation } from "effect";
import { escapeJsonPointer, isRecord } from "../shared/object.js";
import type { Diagnostic, ValidationReport } from "./diagnostics.js";
import { createValidationReport } from "./diagnostics.js";
import type { OpenApiDocument } from "./load.js";

function componentSchemasOf(document: OpenApiDocument): Record<string, JsonSchema.JsonSchema> {
  if (!isRecord(document.components) || !isRecord(document.components.schemas)) return {};
  return Object.fromEntries(
    Object.entries(document.components.schemas).filter(
      (entry): entry is [string, JsonSchema.JsonSchema] => isRecord(entry[1]),
    ),
  );
}

/**
 * Checks the subset of OpenAPI 3.1 Schema Objects that Effect can faithfully
 * import. This is advisory: Oagen and Effect do not support exactly the same
 * JSON Schema keywords, so incompatibilities remain warnings until correlated
 * with a generated target failure.
 */
export function validateEffectJsonSchemaCompatibility(document: OpenApiDocument): ValidationReport {
  const schemas = componentSchemasOf(document);
  const entries = Object.entries(schemas);
  if (entries.length === 0) return createValidationReport([]);

  const diagnostics: Diagnostic[] = [];
  let canonical: JsonSchema.Document<"draft-2020-12">;
  try {
    canonical = JsonSchema.fromSchemaOpenApi3_1({
      anyOf: entries.map(([name]) => ({
        $ref: `#/components/schemas/${escapeJsonPointer(name)}`,
      })),
      $defs: schemas,
    });
  } catch (cause) {
    return createValidationReport([
      {
        severity: "warning",
        code: "schema.effect-normalization.unsupported",
        message: `Effect could not normalize the OpenAPI 3.1 component schemas: ${cause instanceof Error ? cause.message : String(cause)}`,
        pointer: "#/components/schemas",
        hint: "The canonical contract remains unchanged; Redocly and Oagen still determine generation compatibility.",
      },
    ]);
  }

  for (const [name] of entries) {
    const schema = canonical.definitions[name];
    if (schema === undefined) continue;
    try {
      SchemaRepresentation.fromJsonSchemaDocument(
        {
          dialect: "draft-2020-12",
          schema,
          definitions: canonical.definitions,
        },
        { patterns: "apply" },
      );
    } catch (cause) {
      diagnostics.push({
        severity: "warning",
        code: "schema.effect-import.unsupported",
        message: `Effect cannot faithfully import component ${JSON.stringify(name)}: ${cause instanceof Error ? cause.message : String(cause)}`,
        pointer: `#/components/schemas/${escapeJsonPointer(name)}`,
        hint: "This is advisory until the native Effect SDK consumes component schemas directly.",
      });
    }
  }

  return createValidationReport(diagnostics);
}
