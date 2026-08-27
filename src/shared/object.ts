import { JsonPointer, Predicate } from "effect";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Predicate.isObject(value);
}

export const escapeJsonPointer = JsonPointer.escapeToken;

export function getAtJsonPointer(document: unknown, pointer: string): unknown {
  if (pointer === "#" || pointer === "") return document;
  if (!pointer.startsWith("#/")) return undefined;

  let current = document;
  for (const rawPart of pointer.slice(2).split("/")) {
    const part = JsonPointer.unescapeToken(rawPart);
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else if (isRecord(current)) {
      current = current[part];
    } else {
      return undefined;
    }
  }

  return current;
}

export function resolveLocalReference(document: unknown, value: unknown): unknown {
  if (!isRecord(value) || typeof value.$ref !== "string") return value;
  return getAtJsonPointer(document, value.$ref) ?? value;
}
