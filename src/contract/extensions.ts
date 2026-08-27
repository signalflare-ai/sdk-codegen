import {
  SDK_AUDIENCES,
  SDK_VISIBILITIES,
  type SdkAudience,
  type SdkVisibility,
} from "../config/schema.js";
import { isRecord } from "../shared/object.js";
import type { Diagnostic } from "./diagnostics.js";

export const SDK_STABILITIES = ["stable", "beta", "experimental"] as const;
export type SdkStability = (typeof SDK_STABILITIES)[number];

export interface ProductMetadata {
  id: string;
  displayName: string;
  contractVersion: number;
}

export interface OperationSdkMetadata {
  audiences: SdkAudience[];
  visibility: SdkVisibility;
  stability: SdkStability;
  generate: boolean;
  service?: string;
  implemented: boolean;
  sourceApiId: string;
}

const AUDIENCES = new Set<string>(SDK_AUDIENCES);
const VISIBILITIES = new Set<string>(SDK_VISIBILITIES);
const STABILITIES = new Set<string>(SDK_STABILITIES);

function extensionError(code: string, message: string, pointer: string): Diagnostic {
  return { severity: "error", code, message, pointer };
}

export function parseProductMetadata(
  document: Record<string, unknown>,
  pointer = "#/x-signalflare-product",
): { metadata?: ProductMetadata; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const value = document["x-signalflare-product"];
  if (!isRecord(value)) {
    diagnostics.push(
      extensionError(
        "contract.product-metadata.required",
        "x-signalflare-product must define id, displayName, and contractVersion.",
        pointer,
      ),
    );
    return { diagnostics };
  }

  if (typeof value.id !== "string" || value.id.length === 0) {
    diagnostics.push(
      extensionError(
        "contract.product-id.required",
        "Product metadata id is required.",
        `${pointer}/id`,
      ),
    );
  }
  if (typeof value.displayName !== "string" || value.displayName.length === 0) {
    diagnostics.push(
      extensionError(
        "contract.product-display-name.required",
        "Product metadata displayName is required.",
        `${pointer}/displayName`,
      ),
    );
  }
  if (!Number.isInteger(value.contractVersion) || (value.contractVersion as number) < 1) {
    diagnostics.push(
      extensionError(
        "contract.product-version.invalid",
        "Product metadata contractVersion must be a positive integer.",
        `${pointer}/contractVersion`,
      ),
    );
  }

  if (diagnostics.length > 0) return { diagnostics };
  return {
    metadata: {
      id: value.id as string,
      displayName: value.displayName as string,
      contractVersion: value.contractVersion as number,
    },
    diagnostics,
  };
}

export function parseOperationSdkMetadata(
  operation: Record<string, unknown>,
  pointer: string,
): { metadata?: OperationSdkMetadata; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const sdk = operation["x-signalflare-sdk"];
  const sourceApiId = operation["x-signalflare-api-id"];
  const implemented = operation["x-signalflare-implemented"];

  if (typeof sourceApiId !== "string" || sourceApiId.length === 0) {
    diagnostics.push(
      extensionError(
        "operation.source-api.required",
        "Every operation must declare a non-empty x-signalflare-api-id.",
        `${pointer}/x-signalflare-api-id`,
      ),
    );
  }
  if (implemented !== undefined && typeof implemented !== "boolean") {
    diagnostics.push(
      extensionError(
        "operation.implemented.invalid",
        "x-signalflare-implemented must be a boolean when present.",
        `${pointer}/x-signalflare-implemented`,
      ),
    );
  }
  if (!isRecord(sdk)) {
    diagnostics.push(
      extensionError(
        "operation.sdk-metadata.required",
        "Every operation must declare x-signalflare-sdk metadata.",
        `${pointer}/x-signalflare-sdk`,
      ),
    );
    return { diagnostics };
  }

  const audiences: SdkAudience[] = [];
  if (!Array.isArray(sdk.audiences) || sdk.audiences.length === 0) {
    diagnostics.push(
      extensionError(
        "operation.audiences.required",
        "x-signalflare-sdk.audiences must be a non-empty array.",
        `${pointer}/x-signalflare-sdk/audiences`,
      ),
    );
  } else {
    for (const [index, audience] of sdk.audiences.entries()) {
      if (typeof audience !== "string" || !AUDIENCES.has(audience)) {
        diagnostics.push(
          extensionError(
            "operation.audience.invalid",
            `Unsupported SDK audience ${JSON.stringify(audience)}.`,
            `${pointer}/x-signalflare-sdk/audiences/${index}`,
          ),
        );
      } else {
        audiences.push(audience as SdkAudience);
      }
    }
  }

  if (typeof sdk.visibility !== "string" || !VISIBILITIES.has(sdk.visibility)) {
    diagnostics.push(
      extensionError(
        "operation.visibility.invalid",
        `x-signalflare-sdk.visibility must be one of: ${SDK_VISIBILITIES.join(", ")}.`,
        `${pointer}/x-signalflare-sdk/visibility`,
      ),
    );
  }
  if (typeof sdk.stability !== "string" || !STABILITIES.has(sdk.stability)) {
    diagnostics.push(
      extensionError(
        "operation.stability.invalid",
        `x-signalflare-sdk.stability must be one of: ${SDK_STABILITIES.join(", ")}.`,
        `${pointer}/x-signalflare-sdk/stability`,
      ),
    );
  }
  if (sdk.generate !== undefined && typeof sdk.generate !== "boolean") {
    diagnostics.push(
      extensionError(
        "operation.generate.invalid",
        "x-signalflare-sdk.generate must be a boolean when present.",
        `${pointer}/x-signalflare-sdk/generate`,
      ),
    );
  }
  if (sdk.service !== undefined && (typeof sdk.service !== "string" || sdk.service.length === 0)) {
    diagnostics.push(
      extensionError(
        "operation.service.invalid",
        "x-signalflare-sdk.service must be a non-empty string when present.",
        `${pointer}/x-signalflare-sdk/service`,
      ),
    );
  }

  const isImplemented = implemented !== false;
  if (!isImplemented && audiences.some((audience) => audience !== "preview")) {
    diagnostics.push(
      extensionError(
        "operation.preview.production-audience",
        "An unimplemented operation may only belong to the preview audience.",
        `${pointer}/x-signalflare-sdk/audiences`,
      ),
    );
  }

  if (diagnostics.length > 0) return { diagnostics };
  return {
    metadata: {
      audiences,
      visibility: sdk.visibility as SdkVisibility,
      stability: sdk.stability as SdkStability,
      generate: sdk.generate !== false,
      ...(sdk.service === undefined ? {} : { service: sdk.service as string }),
      implemented: isImplemented,
      sourceApiId: sourceApiId as string,
    },
    diagnostics,
  };
}
