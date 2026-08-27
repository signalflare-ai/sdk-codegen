import { isRecord, resolveLocalReference } from "../shared/object.js";
import type { OpenApiDocument } from "./load.js";

export interface ContractNormalizationResult {
  document: OpenApiDocument;
  transforms: string[];
}

function mergeDiscriminatedUnion(
  document: OpenApiDocument,
  name: string,
  schema: Record<string, unknown>,
): { schema: Record<string, unknown>; diagnostic: string } | undefined {
  if (!Array.isArray(schema.oneOf) || !isRecord(schema.discriminator)) return undefined;
  const variants = schema.oneOf
    .map((variant) => resolveLocalReference(document, variant))
    .filter(
      (variant): variant is Record<string, unknown> =>
        isRecord(variant) && isRecord(variant.properties),
    );
  if (variants.length !== schema.oneOf.length || variants.length === 0) return undefined;

  const properties: Record<string, unknown> = {};
  const requiredSets = variants.map(
    (variant) =>
      new Set(
        Array.isArray(variant.required)
          ? variant.required.filter((field): field is string => typeof field === "string")
          : [],
      ),
  );
  const discriminatorProperty =
    typeof schema.discriminator.propertyName === "string"
      ? schema.discriminator.propertyName
      : undefined;

  for (const variant of variants) {
    for (const [field, fieldSchema] of Object.entries(
      variant.properties as Record<string, unknown>,
    )) {
      if (field === discriminatorProperty) {
        properties[field] = { type: "string" };
      } else if (!(field in properties)) {
        properties[field] = fieldSchema;
      } else if (JSON.stringify(properties[field]) !== JSON.stringify(fieldSchema)) {
        properties[field] = { anyOf: [properties[field], fieldSchema] };
      }
    }
  }

  const required = [...requiredSets[0]!].filter((field) =>
    requiredSets.slice(1).every((fields) => fields.has(field)),
  );
  const { oneOf: _oneOf, discriminator: _discriminator, ...rest } = schema;
  return {
    schema: {
      ...rest,
      type: "object",
      ...(required.length === 0 ? {} : { required }),
      properties,
      "x-signalflare-normalized-union": true,
    },
    diagnostic: `Flattened discriminated union ${name} to an open wire-compatible object because Oagen 0.29.2 drops standalone component oneOf variants.`,
  };
}

/**
 * Temporary, diagnosed pre-IR adapters for upstream parser gaps. The canonical
 * product contract is never mutated; every applied transform is reported.
 */
export function normalizeContractForOagen(document: OpenApiDocument): ContractNormalizationResult {
  const normalized = structuredClone(document);
  const schemas =
    isRecord(normalized.components) && isRecord(normalized.components.schemas)
      ? normalized.components.schemas
      : undefined;
  const transforms: string[] = [];
  if (!schemas) return { document: normalized, transforms };

  for (const [name, rawSchema] of Object.entries(schemas)) {
    if (!isRecord(rawSchema)) continue;
    const merged = mergeDiscriminatedUnion(normalized, name, rawSchema);
    if (!merged) continue;
    schemas[name] = merged.schema;
    transforms.push(merged.diagnostic);
  }

  return { document: normalized, transforms };
}
