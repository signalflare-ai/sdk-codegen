import { escapeJsonPointer, isRecord } from "../../shared/object.js";
import { securitySchemesOf } from "../accessors.js";
import type { ContractOperation } from "../operations.js";
import { addDiagnostic, resolveObject, type ValidationContext } from "./context.js";

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

  const schemes = securitySchemesOf(context.document);
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
  const schemes = securitySchemesOf(context.document);
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

export function validateTopLevelSecurity(context: ValidationContext): void {
  const securitySchemes = securitySchemesOf(context.document);
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
  if (Object.hasOwn(context.document, "security")) {
    validateSecurityRequirements(context, context.document.security, "#/security");
  }
}

export function validateOperationSecurity(
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
