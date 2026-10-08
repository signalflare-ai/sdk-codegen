import { Result, Schema } from "effect";
import type { Diagnostic, ValidationReport } from "../contract/diagnostics.js";
import { createValidationReport } from "../contract/diagnostics.js";
import { isRecord } from "../shared/object.js";
import {
  OPENAPI_BASELINE,
  SDK_AUDIENCES,
  SDK_VISIBILITIES,
  TARGET_ID_FIELD,
  TARGET_NAMES,
  SdkVersion,
  type SdkAudience,
  type SdkProfile,
  type SignalflareSdkConfig,
} from "./schema.js";

const AUDIENCES = new Set<string>(SDK_AUDIENCES);
const VISIBILITIES = new Set<string>(SDK_VISIBILITIES);

function addError(
  diagnostics: Diagnostic[],
  code: string,
  message: string,
  pointer: string,
  hint?: string,
): void {
  diagnostics.push({
    severity: "error",
    code,
    message,
    pointer,
    ...(hint === undefined ? {} : { hint }),
  });
}

function hasNonEmptyString(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === "string" && record[key].trim().length > 0;
}

function validateVersion(value: unknown, pointer: string, diagnostics: Diagnostic[]): void {
  if (value === undefined) return;
  if (Result.isFailure(Schema.decodeUnknownResult(SdkVersion)(value))) {
    addError(diagnostics, "config.version.invalid", "Expected a semantic version.", pointer);
  }
}

function validateStringArray(
  value: unknown,
  pointer: string,
  allowed: ReadonlySet<string>,
  diagnostics: Diagnostic[],
): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    addError(diagnostics, "config.array.required", "Expected a non-empty array.", pointer);
    return [];
  }

  const valid: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || !allowed.has(item)) {
      addError(
        diagnostics,
        "config.value.invalid",
        `Unsupported value ${JSON.stringify(item)}. Expected one of: ${[...allowed].join(", ")}.`,
        `${pointer}/${index}`,
      );
      continue;
    }
    valid.push(item);
  }
  return valid;
}

export function validateSdkConfig(value: unknown): ValidationReport {
  const diagnostics: Diagnostic[] = [];
  if (!isRecord(value)) {
    addError(diagnostics, "config.invalid", "SDK config must export an object.", "#");
    return createValidationReport(diagnostics);
  }

  const product = value.product;
  if (!isRecord(product)) {
    addError(diagnostics, "config.product.required", "Missing product configuration.", "#/product");
  } else {
    validateVersion(product.sdkVersion, "#/product/sdkVersion", diagnostics);
    if (!hasNonEmptyString(product, "id")) {
      addError(
        diagnostics,
        "config.product.id.required",
        "Product id must be a non-empty string.",
        "#/product/id",
      );
    } else if (!/^[a-z][a-z0-9-]*$/.test(product.id as string)) {
      addError(
        diagnostics,
        "config.product.id.invalid",
        "Product id must use lowercase kebab-case.",
        "#/product/id",
      );
    }
    if (!hasNonEmptyString(product, "displayName")) {
      addError(
        diagnostics,
        "config.product.display-name.required",
        "Product displayName must be a non-empty string.",
        "#/product/displayName",
      );
    }
  }

  const contract = value.contract;
  if (!isRecord(contract)) {
    addError(
      diagnostics,
      "config.contract.required",
      "Missing contract configuration.",
      "#/contract",
    );
  } else {
    if (!hasNonEmptyString(contract, "spec")) {
      addError(
        diagnostics,
        "config.contract.spec.required",
        "Contract spec must be a non-empty path.",
        "#/contract/spec",
      );
    }
    if (contract.openapiBaseline !== undefined && contract.openapiBaseline !== OPENAPI_BASELINE) {
      addError(
        diagnostics,
        "config.contract.baseline.invalid",
        `The supported authoring baseline is OpenAPI ${OPENAPI_BASELINE}.`,
        "#/contract/openapiBaseline",
      );
    }
  }

  const configuredProfiles = new Set<SdkProfile>();
  const profiles = value.profiles;
  if (!isRecord(profiles) || Object.keys(profiles).length === 0) {
    addError(
      diagnostics,
      "config.profiles.required",
      "Configure at least one SDK profile.",
      "#/profiles",
    );
  } else {
    for (const [name, profile] of Object.entries(profiles)) {
      const pointer = `#/profiles/${name}`;
      if (!AUDIENCES.has(name)) {
        addError(
          diagnostics,
          "config.profile.invalid",
          `Unknown profile ${JSON.stringify(name)}.`,
          pointer,
          `Use one of: ${SDK_AUDIENCES.join(", ")}.`,
        );
        continue;
      }
      configuredProfiles.add(name as SdkProfile);
      if (!isRecord(profile)) {
        addError(
          diagnostics,
          "config.profile.invalid",
          "Profile configuration must be an object.",
          pointer,
        );
        continue;
      }
      validateStringArray(
        profile.includeAudiences,
        `${pointer}/includeAudiences`,
        AUDIENCES,
        diagnostics,
      );
      if (profile.enabled !== undefined && typeof profile.enabled !== "boolean") {
        addError(
          diagnostics,
          "config.boolean.invalid",
          "enabled must be a boolean.",
          `${pointer}/enabled`,
        );
      }
      if (profile.visibility !== undefined) {
        validateStringArray(profile.visibility, `${pointer}/visibility`, VISIBILITIES, diagnostics);
      }
    }
  }

  const targets = value.targets;
  if (!isRecord(targets) || Object.keys(targets).length === 0) {
    addError(
      diagnostics,
      "config.targets.required",
      "Configure at least one SDK target.",
      "#/targets",
    );
  } else {
    for (const targetName of TARGET_NAMES) {
      const target = targets[targetName];
      if (target === undefined) continue;
      const pointer = `#/targets/${targetName}`;
      if (!isRecord(target)) {
        addError(
          diagnostics,
          "config.target.invalid",
          "Target configuration must be an object.",
          pointer,
        );
        continue;
      }
      validateVersion(target.sdkVersion, `${pointer}/sdkVersion`, diagnostics);
      if (targetName === "typescript") {
        validateVersion(target.effectVersion, `${pointer}/effectVersion`, diagnostics);
        if (typeof target.effectVersion === "string" && !target.effectVersion.startsWith("4.")) {
          addError(
            diagnostics,
            "config.effect-version.unsupported",
            "The Effect client targets Effect v4.",
            `${pointer}/effectVersion`,
          );
        }
      }
      if (!hasNonEmptyString(target, "output")) {
        addError(
          diagnostics,
          "config.target.output.required",
          "Target output must be a non-empty path.",
          `${pointer}/output`,
        );
      }
      const idField = TARGET_ID_FIELD[targetName];
      if (!hasNonEmptyString(target, idField)) {
        addError(
          diagnostics,
          "config.target.identifier.required",
          `${idField} must be a non-empty string.`,
          `${pointer}/${idField}`,
        );
      }
      const targetProfiles = validateStringArray(
        target.profiles,
        `${pointer}/profiles`,
        AUDIENCES,
        diagnostics,
      );
      for (const profile of targetProfiles) {
        if (!configuredProfiles.has(profile as SdkProfile)) {
          addError(
            diagnostics,
            "config.target.profile.missing",
            `Target references profile ${JSON.stringify(profile)}, but that profile is not configured.`,
            `${pointer}/profiles`,
          );
        }
      }
      if (target.enabled !== undefined && typeof target.enabled !== "boolean") {
        addError(
          diagnostics,
          "config.boolean.invalid",
          "enabled must be a boolean.",
          `${pointer}/enabled`,
        );
      }
      if (
        targetName === "typescript" &&
        target.effect !== undefined &&
        typeof target.effect !== "boolean"
      ) {
        addError(
          diagnostics,
          "config.boolean.invalid",
          "effect must be a boolean.",
          `${pointer}/effect`,
        );
      }
      if (
        targetName === "python" &&
        target.async !== undefined &&
        typeof target.async !== "boolean"
      ) {
        addError(
          diagnostics,
          "config.boolean.invalid",
          "async must be a boolean.",
          `${pointer}/async`,
        );
      }
    }

    for (const targetName of Object.keys(targets)) {
      if (!(TARGET_NAMES as readonly string[]).includes(targetName)) {
        addError(
          diagnostics,
          "config.target.unknown",
          `Unknown target ${JSON.stringify(targetName)}.`,
          `#/targets/${targetName}`,
        );
      }
    }
  }

  return createValidationReport(diagnostics);
}

export function isSignalflareSdkConfig(value: unknown): value is SignalflareSdkConfig {
  return validateSdkConfig(value).valid;
}

export function profileIsEnabled(config: SignalflareSdkConfig, profile: SdkProfile): boolean {
  const configured = config.profiles[profile];
  if (!configured) return false;
  return configured.enabled ?? profile !== "preview";
}

export function audiencesForProfile(
  config: SignalflareSdkConfig,
  profile: SdkProfile,
): ReadonlySet<SdkAudience> {
  return new Set(config.profiles[profile]?.includeAudiences ?? []);
}
