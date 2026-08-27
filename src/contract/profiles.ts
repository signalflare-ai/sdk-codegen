import type { SdkProfile, SignalflareSdkConfig } from "../config/schema.js";
import { audiencesForProfile, profileIsEnabled } from "../config/validate.js";
import { escapeJsonPointer, isRecord } from "../shared/object.js";
import type { Diagnostic, ValidationReport } from "./diagnostics.js";
import { createValidationReport } from "./diagnostics.js";
import { parseOperationSdkMetadata } from "./extensions.js";
import type { OpenApiDocument } from "./load.js";
import { HTTP_METHODS, listContractOperations } from "./operations.js";

export interface SelectedOperation {
  identity: string;
  operationId: string;
  sourceApiId: string;
  method: string;
  path: string;
}

export interface ProfileContractResult {
  profile: SdkProfile;
  document: OpenApiDocument;
  operations: SelectedOperation[];
  validation: ValidationReport;
}

export interface ProfilesContractResult {
  profiles: SdkProfile[];
  document: OpenApiDocument;
  operations: SelectedOperation[];
  validation: ValidationReport;
}

const HTTP_METHOD_SET = new Set<string>(HTTP_METHODS);

function componentReferenceName(reference: string, group: string): string | undefined {
  const prefix = `#/components/${group}/`;
  if (!reference.startsWith(prefix)) return undefined;
  return reference.slice(prefix.length).replaceAll("~1", "/").replaceAll("~0", "~");
}

function pruneUnreferencedSchemas(document: OpenApiDocument): void {
  if (!isRecord(document.components) || !isRecord(document.components.schemas)) return;
  const schemas = document.components.schemas;
  const reachable = new Set<string>();
  const visitedReferences = new Set<string>();
  const pendingReferences: string[] = [];
  const seen = new WeakSet<object>();

  const walk = (value: unknown): void => {
    if (typeof value === "string" && value.startsWith("#/components/")) {
      pendingReferences.push(value);
      return;
    }
    if (typeof value !== "object" || value === null || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    for (const child of Object.values(value as Record<string, unknown>)) walk(child);
  };

  walk(document.paths);
  while (pendingReferences.length > 0) {
    const reference = pendingReferences.pop()!;
    if (visitedReferences.has(reference)) continue;
    visitedReferences.add(reference);
    const schemaName = componentReferenceName(reference, "schemas");
    if (schemaName !== undefined) reachable.add(schemaName);

    const resolved = reference
      .slice(2)
      .split("/")
      .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
      .reduce<unknown>(
        (current, segment) => (isRecord(current) ? current[segment] : undefined),
        document,
      );
    walk(resolved);
  }

  for (const name of Object.keys(schemas)) {
    if (!reachable.has(name)) delete schemas[name];
  }
}

export function buildProfilesContract(
  document: OpenApiDocument,
  config: SignalflareSdkConfig,
  requestedProfiles: readonly SdkProfile[],
): ProfilesContractResult {
  const profiles = [...new Set(requestedProfiles)];
  const diagnostics: Diagnostic[] = [];
  const selectedPointers = new Set<string>();
  const selected: SelectedOperation[] = [];
  const selectionsByProfile = new Map<SdkProfile, number>();

  for (const profile of profiles) {
    const profileConfig = config.profiles[profile];
    if (!profileConfig) {
      diagnostics.push({
        severity: "error",
        code: "profile.not-configured",
        message: `Profile ${JSON.stringify(profile)} is not configured.`,
        pointer: `#/profiles/${profile}`,
      });
    } else if (!profileIsEnabled(config, profile)) {
      diagnostics.push({
        severity: "error",
        code: "profile.disabled",
        message: `Profile ${JSON.stringify(profile)} is disabled.`,
        pointer: `#/profiles/${profile}/enabled`,
      });
    }
  }

  for (const operation of listContractOperations(document)) {
    const parsed = parseOperationSdkMetadata(operation.operation, operation.pointer);
    if (!parsed.metadata) continue;
    const metadata = parsed.metadata;
    let included = false;

    for (const profile of profiles) {
      const profileConfig = config.profiles[profile];
      if (!profileConfig || !profileIsEnabled(config, profile)) continue;
      const audiences = audiencesForProfile(config, profile);
      const visibility = new Set(profileConfig.visibility ?? []);
      const audienceMatches = metadata.audiences.some((audience) => audiences.has(audience));
      const visibilityMatches = visibility.size === 0 || visibility.has(metadata.visibility);
      const previewSafe = profile === "preview" || metadata.implemented;
      if (!metadata.generate || !audienceMatches || !visibilityMatches || !previewSafe) continue;
      included = true;
      selectionsByProfile.set(profile, (selectionsByProfile.get(profile) ?? 0) + 1);
    }

    if (!included) continue;
    const operationId = operation.operation.operationId;
    if (typeof operationId !== "string" || operationId.length === 0) continue;
    selectedPointers.add(operation.pointer);
    selected.push({
      identity: `${config.product.id}.${metadata.sourceApiId}.${operationId}`,
      operationId,
      sourceApiId: metadata.sourceApiId,
      method: operation.method.toUpperCase(),
      path: operation.path,
    });
  }

  const filtered = structuredClone(document);
  if (isRecord(filtered.paths)) {
    for (const [path, rawPathItem] of Object.entries(filtered.paths)) {
      if (!isRecord(rawPathItem)) continue;
      for (const method of Object.keys(rawPathItem)) {
        if (!HTTP_METHOD_SET.has(method.toLowerCase())) continue;
        const pointer = `#/paths/${escapeJsonPointer(path)}/${method}`;
        if (!selectedPointers.has(pointer)) delete rawPathItem[method];
      }
      const hasOperation = Object.keys(rawPathItem).some((key) =>
        HTTP_METHOD_SET.has(key.toLowerCase()),
      );
      if (!hasOperation) delete filtered.paths[path];
    }
  }
  pruneUnreferencedSchemas(filtered);
  filtered["x-signalflare-generated-profiles"] = profiles;

  selected.sort(
    (left, right) =>
      left.identity.localeCompare(right.identity) ||
      left.path.localeCompare(right.path) ||
      left.method.localeCompare(right.method),
  );

  for (const profile of profiles) {
    if (
      config.profiles[profile] &&
      profileIsEnabled(config, profile) &&
      !selectionsByProfile.has(profile)
    ) {
      diagnostics.push({
        severity: "warning",
        code: "profile.empty",
        message: `Profile ${JSON.stringify(profile)} selected no operations.`,
        pointer: `#/profiles/${profile}`,
      });
    }
  }

  return {
    profiles,
    document: filtered,
    operations: selected,
    validation: createValidationReport(diagnostics),
  };
}

export function buildProfileContract(
  document: OpenApiDocument,
  config: SignalflareSdkConfig,
  profile: SdkProfile,
): ProfileContractResult {
  const result = buildProfilesContract(document, config, [profile]);
  result.document["x-signalflare-generated-profile"] = profile;
  return {
    profile,
    document: result.document,
    operations: result.operations,
    validation: result.validation,
  };
}
