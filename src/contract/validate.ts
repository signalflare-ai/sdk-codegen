import type { SignalflareSdkConfig } from "../config/schema.js";
import { escapeJsonPointer, isRecord, resolveLocalReference } from "../shared/object.js";
import type { Diagnostic, DiagnosticOperation, ValidationReport } from "./diagnostics.js";
import { createValidationReport } from "./diagnostics.js";
import { parseOperationSdkMetadata, parseProductMetadata } from "./extensions.js";
import { listContractOperations, type ContractOperation } from "./operations.js";
import type { OpenApiDocument } from "./load.js";

interface ValidationContext {
  document: OpenApiDocument;
  config: SignalflareSdkConfig;
  file?: string;
  diagnostics: Diagnostic[];
}

function operationDetails(operation: ContractOperation): DiagnosticOperation {
  return {
    method: operation.method.toUpperCase(),
    path: operation.path,
    ...(typeof operation.operation.operationId === "string"
      ? { operationId: operation.operation.operationId }
      : {}),
  };
}

function addDiagnostic(
  context: ValidationContext,
  diagnostic: Omit<Diagnostic, "file">,
  operation?: ContractOperation,
): void {
  context.diagnostics.push({
    ...diagnostic,
    ...(context.file === undefined ? {} : { file: context.file }),
    ...(operation === undefined ? {} : { operation: operationDetails(operation) }),
  });
}

function configuredSecuritySchemes(context: ValidationContext): Record<string, unknown> {
  return isRecord(context.document.components) &&
    isRecord(context.document.components.securitySchemes)
    ? context.document.components.securitySchemes
    : {};
}

function validateSecurityRequirements(
  context: ValidationContext,
  value: unknown,
  pointer: string,
  operation?: ContractOperation,
): void {
  if (!Array.isArray(value)) {
    addDiagnostic(
      context,
      {
        severity: "error",
        code: "operation.security.invalid",
        message: "Security requirements must be an array.",
        pointer,
      },
      operation,
    );
    return;
  }

  const schemes = configuredSecuritySchemes(context);
  for (const [alternativeIndex, alternative] of value.entries()) {
    if (!isRecord(alternative)) {
      addDiagnostic(
        context,
        {
          severity: "error",
          code: "operation.security-alternative.invalid",
          message: "Each security alternative must be an object.",
          pointer: `${pointer}/${alternativeIndex}`,
        },
        operation,
      );
      continue;
    }
    for (const [scheme, scopes] of Object.entries(alternative)) {
      if (!(scheme in schemes)) {
        addDiagnostic(
          context,
          {
            severity: "error",
            code: "operation.security-scheme.unknown",
            message: `Security requirement references unknown scheme ${JSON.stringify(scheme)}.`,
            pointer: `${pointer}/${alternativeIndex}/${escapeJsonPointer(scheme)}`,
          },
          operation,
        );
      }
      if (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === "string")) {
        addDiagnostic(
          context,
          {
            severity: "error",
            code: "operation.security-scopes.invalid",
            message: "Security requirement scopes must be an array of strings.",
            pointer: `${pointer}/${alternativeIndex}/${escapeJsonPointer(scheme)}`,
          },
          operation,
        );
      }
    }
  }
}

function validateSecuritySchemeDefinitions(context: ValidationContext): void {
  const schemes = configuredSecuritySchemes(context);
  for (const [name, rawScheme] of Object.entries(schemes)) {
    const pointer = `#/components/securitySchemes/${escapeJsonPointer(name)}`;
    const scheme = resolveObject(context.document, rawScheme);
    if (!scheme || typeof scheme.type !== "string") {
      addDiagnostic(context, {
        severity: "error",
        code: "contract.security-scheme.invalid",
        message: `Security scheme ${JSON.stringify(name)} must be a resolvable object with a type.`,
        pointer,
      });
      continue;
    }
    const supportedHttp =
      scheme.type === "http" &&
      typeof scheme.scheme === "string" &&
      scheme.scheme.toLowerCase() === "bearer";
    const supportedApiKey =
      scheme.type === "apiKey" &&
      (scheme.in === "header" || scheme.in === "query" || scheme.in === "cookie") &&
      typeof scheme.name === "string" &&
      scheme.name.length > 0;
    if (
      !supportedHttp &&
      !supportedApiKey &&
      scheme.type !== "oauth2" &&
      scheme.type !== "openIdConnect"
    ) {
      addDiagnostic(context, {
        severity: "error",
        code: "contract.security-scheme.unsupported",
        message: `Security scheme ${JSON.stringify(name)} is not supported by generated clients.`,
        pointer,
        hint: "Use HTTP bearer, OAuth2/OpenID Connect bearer tokens, or an API key in a header, query parameter, or cookie.",
      });
    }
  }
}

function validateTopLevel(context: ValidationContext): void {
  const { document, config } = context;
  const version = document.openapi;
  if (typeof version !== "string") {
    addDiagnostic(context, {
      severity: "error",
      code: "contract.openapi.required",
      message: "The contract must declare an OpenAPI version.",
      pointer: "#/openapi",
    });
  } else if (!/^3\.1\.\d+$/.test(version)) {
    let hint = "Author the canonical contract as OpenAPI 3.1.2.";
    if (version.startsWith("2."))
      hint = "Convert Swagger/OpenAPI 2.0 to OpenAPI 3.1.2 before SDK generation.";
    else if (version.startsWith("3.0."))
      hint = "Run the explicit OpenAPI 3.0 to 3.1 normalization path first.";
    else if (version.startsWith("3.2."))
      hint = "OpenAPI 3.2 remains experimental until the conformance fixture suite passes.";
    addDiagnostic(context, {
      severity: "error",
      code: "contract.openapi.unsupported",
      message: `Unsupported OpenAPI version ${JSON.stringify(version)}.`,
      pointer: "#/openapi",
      hint,
    });
  } else if (version !== (config.contract.openapiBaseline ?? "3.1.2")) {
    addDiagnostic(context, {
      severity: "warning",
      code: "contract.openapi.baseline-mismatch",
      message: `The contract uses OpenAPI ${version}; the authoring baseline is ${config.contract.openapiBaseline ?? "3.1.2"}.`,
      pointer: "#/openapi",
      hint: "Normalize and commit the canonical contract as OpenAPI 3.1.2.",
    });
  }

  if (!isRecord(document.info)) {
    addDiagnostic(context, {
      severity: "error",
      code: "contract.info.required",
      message: "The contract must declare info.title and info.version.",
      pointer: "#/info",
    });
  } else {
    if (typeof document.info.title !== "string" || document.info.title.length === 0) {
      addDiagnostic(context, {
        severity: "error",
        code: "contract.info.title.required",
        message: "info.title must be a non-empty string.",
        pointer: "#/info/title",
      });
    }
    if (typeof document.info.version !== "string" || document.info.version.length === 0) {
      addDiagnostic(context, {
        severity: "error",
        code: "contract.info.version.required",
        message: "info.version must be a non-empty string.",
        pointer: "#/info/version",
      });
    }
  }

  const product = parseProductMetadata(document);
  for (const diagnostic of product.diagnostics) addDiagnostic(context, diagnostic);
  if (product.metadata && product.metadata.id !== config.product.id) {
    addDiagnostic(context, {
      severity: "error",
      code: "contract.product-id.mismatch",
      message: `Contract product id ${JSON.stringify(product.metadata.id)} does not match config product id ${JSON.stringify(config.product.id)}.`,
      pointer: "#/x-signalflare-product/id",
    });
  }

  if (!Array.isArray(document.servers) || document.servers.length === 0) {
    addDiagnostic(context, {
      severity: "error",
      code: "contract.servers.required",
      message: "The canonical product contract must declare at least one server.",
      pointer: "#/servers",
    });
  } else {
    for (const [index, rawServer] of document.servers.entries()) {
      if (!isRecord(rawServer) || typeof rawServer.url !== "string" || rawServer.url.length === 0) {
        addDiagnostic(context, {
          severity: "error",
          code: "contract.server.url.required",
          message: "Every server must declare a non-empty URL.",
          pointer: `#/servers/${index}/url`,
        });
        continue;
      }
      if (
        !rawServer.url.startsWith("https://") &&
        !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(rawServer.url)
      ) {
        addDiagnostic(context, {
          severity: "warning",
          code: "contract.server.insecure",
          message: `Production server URL ${JSON.stringify(rawServer.url)} does not use HTTPS.`,
          pointer: `#/servers/${index}/url`,
        });
      }
    }
  }

  const securitySchemes = configuredSecuritySchemes(context);
  if (Object.keys(securitySchemes).length === 0) {
    addDiagnostic(context, {
      severity: "error",
      code: "contract.security-schemes.required",
      message: "The contract must declare explicit security schemes.",
      pointer: "#/components/securitySchemes",
    });
  } else {
    validateSecuritySchemeDefinitions(context);
  }
  if (Object.hasOwn(document, "security")) {
    validateSecurityRequirements(context, document.security, "#/security");
  }

  if (!isRecord(document.paths) || Object.keys(document.paths).length === 0) {
    addDiagnostic(context, {
      severity: "error",
      code: "contract.paths.required",
      message: "The contract must declare at least one path.",
      pointer: "#/paths",
    });
  }
}

function resolveObject(
  document: OpenApiDocument,
  value: unknown,
): Record<string, unknown> | undefined {
  const resolved = resolveLocalReference(document, value);
  return isRecord(resolved) ? resolved : undefined;
}

function validateOperationIdentity(
  context: ValidationContext,
  operation: ContractOperation,
  operationIds: Map<string, ContractOperation>,
): void {
  const id = operation.operation.operationId;
  if (typeof id !== "string" || id.length === 0) {
    addDiagnostic(
      context,
      {
        severity: "error",
        code: "operation.id.required",
        message: "Every operation must have a stable, non-empty operationId.",
        pointer: `${operation.pointer}/operationId`,
      },
      operation,
    );
  } else if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(id)) {
    addDiagnostic(
      context,
      {
        severity: "error",
        code: "operation.id.invalid",
        message: `operationId ${JSON.stringify(id)} contains unsupported characters.`,
        pointer: `${operation.pointer}/operationId`,
      },
      operation,
    );
  } else {
    const prior = operationIds.get(id);
    if (prior) {
      addDiagnostic(
        context,
        {
          severity: "error",
          code: "operation.id.duplicate",
          message: `operationId ${JSON.stringify(id)} is also used by ${prior.method.toUpperCase()} ${prior.path}.`,
          pointer: `${operation.pointer}/operationId`,
        },
        operation,
      );
    } else {
      operationIds.set(id, operation);
    }
  }

  if (!Array.isArray(operation.operation.tags) || operation.operation.tags.length === 0) {
    addDiagnostic(
      context,
      {
        severity: "error",
        code: "operation.tags.required",
        message: "Every operation must have at least one tag for service grouping.",
        pointer: `${operation.pointer}/tags`,
      },
      operation,
    );
  }
}

function effectiveParameters(context: ValidationContext, operation: ContractOperation): unknown[] {
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
  const jsonEntry = Object.entries(requestBody.content).find(
    ([mediaType]) => mediaType === "application/json" || mediaType.endsWith("+json"),
  );
  if (!jsonEntry) return undefined;
  const media = resolveObject(context.document, jsonEntry[1]);
  return media?.schema;
}

function validateParameters(context: ValidationContext, operation: ContractOperation): void {
  const placeholders = new Set(
    [...operation.path.matchAll(/\{([^}]+)\}/g)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    ),
  );
  const declaredPathParameters = new Set<string>();
  const seen = new Set<string>();

  for (const [index, rawParameter] of effectiveParameters(context, operation).entries()) {
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

function isNamedComponentSchema(schema: unknown): boolean {
  return (
    isRecord(schema) &&
    typeof schema.$ref === "string" &&
    schema.$ref.startsWith("#/components/schemas/")
  );
}

function validateRequestBody(
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

  const jsonMedia = Object.entries(body.content).filter(
    ([mediaType]) => mediaType === "application/json" || mediaType.endsWith("+json"),
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

function validateResponses(
  context: ValidationContext,
  operation: ContractOperation,
  production: boolean,
): void {
  const responses = resolveObject(context.document, operation.operation.responses);
  if (!responses) {
    addDiagnostic(
      context,
      {
        severity: "error",
        code: "operation.responses.required",
        message: "Every operation must declare responses.",
        pointer: `${operation.pointer}/responses`,
      },
      operation,
    );
    return;
  }

  const successEntries = Object.entries(responses).filter(([status]) => /^2\d\d$/.test(status));
  if (successEntries.length === 0) {
    addDiagnostic(
      context,
      {
        severity: "error",
        code: "operation.success-response.required",
        message: "Every operation must declare at least one explicit 2xx response.",
        pointer: `${operation.pointer}/responses`,
      },
      operation,
    );
  }

  for (const [status, rawResponse] of successEntries) {
    const response = resolveObject(context.document, rawResponse);
    if (!response || response.content === undefined) continue;
    if (!isRecord(response.content)) {
      addDiagnostic(
        context,
        {
          severity: "error",
          code: "operation.response.content.invalid",
          message: `Response ${status} content must be an object.`,
          pointer: `${operation.pointer}/responses/${status}/content`,
        },
        operation,
      );
      continue;
    }
    for (const [mediaType, rawMedia] of Object.entries(response.content)) {
      const isJson = mediaType === "application/json" || mediaType.endsWith("+json");
      if (!isJson) {
        if (production) {
          addDiagnostic(
            context,
            {
              severity: "error",
              code: "operation.transport.unsupported",
              message: `Response media type ${JSON.stringify(mediaType)} is not supported by the initial JSON/no-content compiler.`,
              pointer: `${operation.pointer}/responses/${status}/content/${escapeJsonPointer(mediaType)}`,
            },
            operation,
          );
        }
        continue;
      }
      const media = resolveObject(context.document, rawMedia);
      if (production && !isNamedComponentSchema(media?.schema)) {
        addDiagnostic(
          context,
          {
            severity: "error",
            code: "operation.response-schema.named-required",
            message: "Production JSON responses must reference a named component schema.",
            pointer: `${operation.pointer}/responses/${status}/content/${escapeJsonPointer(mediaType)}/schema`,
          },
          operation,
        );
      }
    }
  }

  if (production) {
    const errors = Object.entries(responses).filter(
      ([status]) => status === "default" || /^[45]\d\d$/.test(status),
    );
    if (errors.length === 0) {
      addDiagnostic(
        context,
        {
          severity: "error",
          code: "operation.error-response.required",
          message: "Production operations must document at least one expected error response.",
          pointer: `${operation.pointer}/responses`,
        },
        operation,
      );
    }
    for (const [status, rawResponse] of errors) {
      const response = resolveObject(context.document, rawResponse);
      if (!response || !isRecord(response.content)) continue;
      const json = Object.entries(response.content).find(
        ([mediaType]) => mediaType === "application/json" || mediaType.endsWith("+json"),
      );
      const media = json ? resolveObject(context.document, json[1]) : undefined;
      if (!json || !isNamedComponentSchema(media?.schema)) {
        addDiagnostic(
          context,
          {
            severity: "error",
            code: "operation.error-schema.named-required",
            message: `Error response ${status} must use a named JSON component schema.`,
            pointer: `${operation.pointer}/responses/${status}`,
          },
          operation,
        );
      }
    }
  }
}

function validateSecurity(
  context: ValidationContext,
  operation: ContractOperation,
  production: boolean,
): void {
  if (!production) return;
  const hasOperationSecurity = Object.hasOwn(operation.operation, "security");
  const hasGlobalSecurity = Object.hasOwn(context.document, "security");
  if (hasOperationSecurity) {
    validateSecurityRequirements(
      context,
      operation.operation.security,
      `${operation.pointer}/security`,
      operation,
    );
  }
  if (!hasOperationSecurity && !hasGlobalSecurity) {
    addDiagnostic(
      context,
      {
        severity: "error",
        code: "operation.security.required",
        message: "Production operations must explicitly inherit or declare a security policy.",
        pointer: `${operation.pointer}/security`,
        hint: "Declare top-level security or an operation-level security array. Use security: [] only for intentionally anonymous operations.",
      },
      operation,
    );
  }
}

function validateLegacyNullable(context: ValidationContext): void {
  const visited = new WeakSet<object>();
  const walk = (value: unknown, pointer: string): void => {
    if (typeof value !== "object" || value === null || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const [index, child] of value.entries()) walk(child, `${pointer}/${index}`);
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPointer = `${pointer}/${escapeJsonPointer(key)}`;
      if (key === "nullable" && typeof child === "boolean") {
        addDiagnostic(context, {
          severity: "error",
          code: "schema.nullable.legacy",
          message:
            "OpenAPI 3.1 schemas must express nullability with JSON Schema types, not nullable: true.",
          pointer: childPointer,
          hint: 'Use type: ["<type>", "null"] or an equivalent anyOf.',
        });
      }
      walk(child, childPointer);
    }
  };
  walk(context.document, "#");
}

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
  const operationIds = new Map<string, ContractOperation>();

  for (const operation of listContractOperations(document)) {
    validateOperationIdentity(context, operation, operationIds);
    const parsedMetadata = parseOperationSdkMetadata(operation.operation, operation.pointer);
    for (const diagnostic of parsedMetadata.diagnostics)
      addDiagnostic(context, diagnostic, operation);
    const metadata = parsedMetadata.metadata;
    const production =
      metadata !== undefined &&
      metadata.generate &&
      metadata.implemented &&
      metadata.audiences.some((audience) => audience !== "preview");

    validateParameters(context, operation);
    validateRequestBody(context, operation, production);
    validateResponses(context, operation, production);
    validateSecurity(context, operation, production);
  }

  return createValidationReport(context.diagnostics);
}
