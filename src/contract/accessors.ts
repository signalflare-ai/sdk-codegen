import { isRecord } from "../shared/object.js";
import type { OpenApiDocument } from "./load.js";

export function securitySchemesOf(document: OpenApiDocument): Record<string, unknown> {
  return isRecord(document.components) && isRecord(document.components.securitySchemes)
    ? document.components.securitySchemes
    : {};
}
