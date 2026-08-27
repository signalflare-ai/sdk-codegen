import { OPENAPI_BASELINE } from "../../config/schema.js";
import { isRecord } from "../../shared/object.js";
import { parseProductMetadata } from "../extensions.js";
import { addDiagnostic, type ValidationContext } from "./context.js";
import { validateTopLevelSecurity } from "./security.js";

export function validateTopLevel(context: ValidationContext): void {
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
    let hint = `Author the canonical contract as OpenAPI ${OPENAPI_BASELINE}.`;
    if (version.startsWith("2."))
      hint = `Convert Swagger/OpenAPI 2.0 to OpenAPI ${OPENAPI_BASELINE} before SDK generation.`;
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
  } else if (version !== (config.contract.openapiBaseline ?? OPENAPI_BASELINE)) {
    addDiagnostic(context, {
      severity: "warning",
      code: "contract.openapi.baseline-mismatch",
      message: `The contract uses OpenAPI ${version}; the authoring baseline is ${config.contract.openapiBaseline ?? OPENAPI_BASELINE}.`,
      pointer: "#/openapi",
      hint: `Normalize and commit the canonical contract as OpenAPI ${OPENAPI_BASELINE}.`,
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

  validateTopLevelSecurity(context);

  if (!isRecord(document.paths) || Object.keys(document.paths).length === 0) {
    addDiagnostic(context, {
      severity: "error",
      code: "contract.paths.required",
      message: "The contract must declare at least one path.",
      pointer: "#/paths",
    });
  }
}
