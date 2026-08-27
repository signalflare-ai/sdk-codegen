import { isRecord, resolveLocalReference } from "../shared/object.js";
import type { OpenApiDocument } from "./load.js";
import { listContractOperations } from "./operations.js";

export type AuthSchemePlan =
  | { id: string; kind: "bearer" }
  | { id: string; kind: "apiKey"; in: "header" | "query" | "cookie"; name: string };

export interface SecurityAlternativePlan {
  /** Scheme IDs required together. OpenAPI object entries are logical AND. */
  schemes: string[];
}

export interface OperationAuthPlan {
  method: string;
  path: string;
  operationId: string;
  /** Alternatives are logical OR. An empty array means explicitly anonymous. */
  alternatives: SecurityAlternativePlan[];
}

export interface AuthPlan {
  schemes: AuthSchemePlan[];
  defaults: SecurityAlternativePlan[];
  operations: OperationAuthPlan[];
}

function compileRequirements(value: unknown): SecurityAlternativePlan[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    return [{ schemes: Object.keys(entry).sort() }];
  });
}

function compileScheme(
  document: OpenApiDocument,
  id: string,
  rawScheme: unknown,
): AuthSchemePlan | undefined {
  const scheme = resolveLocalReference(document, rawScheme);
  if (!isRecord(scheme) || typeof scheme.type !== "string") return undefined;
  if (
    scheme.type === "http" &&
    typeof scheme.scheme === "string" &&
    scheme.scheme.toLowerCase() === "bearer"
  ) {
    return { id, kind: "bearer" };
  }
  if (scheme.type === "oauth2" || scheme.type === "openIdConnect") {
    return { id, kind: "bearer" };
  }
  if (
    scheme.type === "apiKey" &&
    (scheme.in === "header" || scheme.in === "query" || scheme.in === "cookie") &&
    typeof scheme.name === "string" &&
    scheme.name.length > 0
  ) {
    return { id, kind: "apiKey", in: scheme.in, name: scheme.name };
  }
  return undefined;
}

export function compileAuthPlan(document: OpenApiDocument): AuthPlan {
  const securitySchemes =
    isRecord(document.components) && isRecord(document.components.securitySchemes)
      ? document.components.securitySchemes
      : {};
  const schemes = Object.entries(securitySchemes)
    .flatMap(([id, scheme]) => {
      const compiled = compileScheme(document, id, scheme);
      return compiled === undefined ? [] : [compiled];
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const defaults = compileRequirements(document.security);
  const operations = listContractOperations(document)
    .map((entry): OperationAuthPlan => {
      const operationId =
        typeof entry.operation.operationId === "string"
          ? entry.operation.operationId
          : `${entry.method}:${entry.path}`;
      const alternatives = Object.hasOwn(entry.operation, "security")
        ? compileRequirements(entry.operation.security)
        : defaults;
      return {
        method: entry.method.toUpperCase(),
        path: entry.path,
        operationId,
        alternatives,
      };
    })
    .sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.method.localeCompare(right.method) ||
        left.operationId.localeCompare(right.operationId),
    );

  return { schemes, defaults, operations };
}
