import { isJsonMediaType } from "../../shared/http.js";
import { isRecord } from "../../shared/object.js";
import type { OpenApiDocument } from "../load.js";
import type { ContractOperation } from "../operations.js";
import { addDiagnostic, resolveObject, type ValidationContext } from "./context.js";

function effectiveParameters(operation: ContractOperation): unknown[] {
  const pathParameters = Array.isArray(operation.pathItem.parameters)
    ? operation.pathItem.parameters
    : [];
  const operationParameters = Array.isArray(operation.operation.parameters)
    ? operation.operation.parameters
    : [];
  return [...pathParameters, ...operationParameters];
}

function collectSchemaProperties(
  document: OpenApiDocument,
  schemaValue: unknown,
  visited = new Set<unknown>(),
): Set<string> {
  if (visited.has(schemaValue)) return new Set();
  visited.add(schemaValue);
  const schema = resolveObject(document, schemaValue);
  if (!schema) return new Set();

  const properties = new Set<string>();
  if (isRecord(schema.properties)) {
    for (const name of Object.keys(schema.properties)) properties.add(name);
  }
  for (const composition of ["allOf", "oneOf", "anyOf"] as const) {
    if (!Array.isArray(schema[composition])) continue;
    for (const child of schema[composition]) {
      for (const name of collectSchemaProperties(document, child, visited)) properties.add(name);
    }
  }
  return properties;
}

function requestBodySchema(context: ValidationContext, operation: ContractOperation): unknown {
  const requestBody = resolveObject(context.document, operation.operation.requestBody);
  if (!requestBody || !isRecord(requestBody.content)) return undefined;
  const jsonEntry = Object.entries(requestBody.content).find(([mediaType]) =>
    isJsonMediaType(mediaType),
  );
  if (!jsonEntry) return undefined;
  const media = resolveObject(context.document, jsonEntry[1]);
  return media?.schema;
}

export function validateParameters(context: ValidationContext, operation: ContractOperation): void {
  const placeholders = new Set(
    [...operation.path.matchAll(/\{([^}]+)\}/g)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    ),
  );
  const declaredPathParameters = new Set<string>();
  const seen = new Set<string>();

  for (const [index, rawParameter] of effectiveParameters(operation).entries()) {
    const pointer = `${operation.pointer}/parameters/${index}`;
    const parameter = resolveObject(context.document, rawParameter);
    if (!parameter) {
      addDiagnostic(
        context,
        {
          severity: "error",
          code: "operation.parameter.invalid",
          message: "Parameter must be an object or resolvable local reference.",
          pointer,
        },
        operation,
      );
      continue;
    }
    if (typeof parameter.name !== "string" || parameter.name.length === 0) {
      addDiagnostic(
        context,
        {
          severity: "error",
          code: "operation.parameter.name.required",
          message: "Parameter name is required.",
          pointer: `${pointer}/name`,
        },
        operation,
      );
      continue;
    }
    if (
      typeof parameter.in !== "string" ||
      !["path", "query", "header", "cookie"].includes(parameter.in)
    ) {
      addDiagnostic(
        context,
        {
          severity: "error",
          code: "operation.parameter.location.invalid",
          message: "Parameter location must be path, query, header, or cookie.",
          pointer: `${pointer}/in`,
        },
        operation,
      );
      continue;
    }

    const parameterName = parameter.name;
    const location = parameter.in;
    const key = `${location}:${parameterName}`;
    if (seen.has(key)) {
      addDiagnostic(
        context,
        {
          severity: "error",
          code: "operation.parameter.duplicate",
          message: `Parameter ${JSON.stringify(parameterName)} is declared more than once in ${location}.`,
          pointer,
        },
        operation,
      );
    }
    seen.add(key);

    if (location === "path") {
      declaredPathParameters.add(parameterName);
      if (parameter.required !== true) {
        addDiagnostic(
          context,
          {
            severity: "error",
            code: "operation.path-parameter.required",
            message: `Path parameter ${JSON.stringify(parameterName)} must set required: true.`,
            pointer: `${pointer}/required`,
          },
          operation,
        );
      }
      if (!placeholders.has(parameterName)) {
        addDiagnostic(
          context,
          {
            severity: "error",
            code: "operation.path-parameter.unused",
            message: `Path parameter ${JSON.stringify(parameterName)} has no matching template placeholder.`,
            pointer,
          },
          operation,
        );
      }
    }
  }

  for (const placeholder of placeholders) {
    if (!declaredPathParameters.has(placeholder)) {
      addDiagnostic(
        context,
        {
          severity: "error",
          code: "operation.path-parameter.missing",
          message: `Path template placeholder ${JSON.stringify(placeholder)} has no declared path parameter.`,
          pointer: operation.pointer,
        },
        operation,
      );
    }
  }

  const schema = requestBodySchema(context, operation);
  if (schema !== undefined) {
    const bodyProperties = collectSchemaProperties(context.document, schema);
    for (const pathParameter of declaredPathParameters) {
      if (bodyProperties.has(pathParameter)) {
        addDiagnostic(
          context,
          {
            severity: "error",
            code: "operation.path-body.duplicate",
            message: `Path parameter ${JSON.stringify(pathParameter)} is duplicated in the JSON request body.`,
            pointer: `${operation.pointer}/requestBody`,
          },
          operation,
        );
      }
    }
  }
}
