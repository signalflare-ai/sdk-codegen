import { isRecord, walkDocument } from "../../shared/object.js";
import { addDiagnostic, type ValidationContext } from "./context.js";

export function isNamedComponentSchema(schema: unknown): boolean {
  return (
    isRecord(schema) &&
    typeof schema.$ref === "string" &&
    schema.$ref.startsWith("#/components/schemas/")
  );
}

export function validateLegacyNullable(context: ValidationContext): void {
  walkDocument(context.document, (value, pointer) => {
    if (!isRecord(value) || typeof value.nullable !== "boolean") return;
    addDiagnostic(context, {
      severity: "error",
      code: "schema.nullable.legacy",
      message:
        "OpenAPI 3.1 schemas must express nullability with JSON Schema types, not nullable: true.",
      pointer: `${pointer}/nullable`,
      hint: 'Use type: ["<type>", "null"] or an equivalent anyOf.',
    });
  });
}
