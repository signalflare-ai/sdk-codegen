import { dirname, join, posix, resolve } from "node:path";
import {
  diffSpecs,
  parseSpec,
  toCamelCase,
  toSnakeCase,
  type DiffReport,
  type GeneratedFile,
} from "@workos/oagen";
import {
  apiSurfaceToSnapshot,
  diffSnapshots,
  generateReport,
  goExtractor,
  nodeExtractor,
  pythonExtractor,
  rustExtractor,
  validateSnapshot,
  type CompatReport,
  type CompatSnapshot,
  type Extractor,
} from "@workos/oagen/compat";
import { Effect, FileSystem, Schema } from "effect";
import { compileAuthPlan } from "../contract/auth.js";
import type { OpenApiDocument } from "../contract/load.js";
import { normalizeContractForOagen } from "../contract/normalize.js";
import { listContractOperations } from "../contract/operations.js";
import { GenerationError } from "../core/errors.js";
import { type SdkProfile, type TargetName } from "../config/schema.js";
import { isRecord } from "../shared/object.js";

export const COMPATIBILITY_FILE = ".signalflare-compat.json";

export interface SdkSurfaceSnapshot {
  snapshot: CompatSnapshot;
  exports: Record<string, readonly string[]>;
  aliases: Record<string, string>;
}

export interface SdkCompatibilitySnapshot {
  schemaVersion: 1;
  product: string;
  target: TargetName;
  profiles: SdkProfile[];
  sdkVersion: string;
  packageName: string;
  contract: OpenApiDocument;
  surfaces: Record<string, SdkSurfaceSnapshot>;
}

const SnapshotEnvelope = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  product: Schema.String,
  target: Schema.Literals(["typescript", "python", "go", "rust"]),
  profiles: Schema.Array(Schema.Literals(["access", "pipelines", "runner", "admin", "preview"])),
  sdkVersion: Schema.String,
  packageName: Schema.String,
  contract: Schema.Record(Schema.String, Schema.Unknown),
  surfaces: Schema.Record(
    Schema.String,
    Schema.Struct({
      snapshot: Schema.Unknown,
      exports: Schema.Record(Schema.String, Schema.Array(Schema.String)),
      aliases: Schema.Record(Schema.String, Schema.String),
    }),
  ),
});

const failure = (operation: string) => (cause: unknown) =>
  new GenerationError({ message: `${operation} failed.`, cause });

/** Oagen 0.29.2's {} method table crashes on inherited Effect toString methods.
 * Extract schema-owned public error declarations, not the entire Effect inheritance tree.
 * The generated SDK itself is unchanged and separately strict-typechecked against real Effect.
 */
function effectExtractionSource(content: string): string {
  return content.replace(
    /export class (\w+) extends Schema\.TaggedError<\1>\(\)\('([^']+)', \{([\s\S]*?)\}\) \{\}/g,
    (_match, name: string, tag: string, body: string) => {
      const fields = [
        ...body.matchAll(
          /(\w+):\s*(Schema\.(?:optionalKey|UndefinedOr)\(Schema\.(?:String|Number)\)|Schema\.Array\(Schema\.Array\(Schema\.String\)\)|Schema\.(?:String|Number|Unknown))/g,
        ),
      ].map(([, field, schema]) => {
        const optional = schema?.includes("optionalKey");
        const type = schema?.includes("Array")
          ? "readonly (readonly string[])[]"
          : schema?.includes("String")
            ? "string"
            : schema?.includes("Number")
              ? "number"
              : "unknown";
        return `${field}${optional ? "?" : ""}: ${type}${schema?.includes("UndefinedOr") ? " | undefined" : ""}`;
      });
      if (fields.length === 0 || fields.length !== [...body.matchAll(/\b\w+\s*:/g)].length)
        throw new Error(
          `Unsupported Effect error declaration in compatibility extraction: ${name}.`,
        );
      return `export class ${name} {\n  declare readonly _tag: ${JSON.stringify(tag)};\n${fields.map((field) => `  declare readonly ${field};`).join("\n")}\n  constructor(options: { ${fields.join("; ")} }) {}\n}`;
    },
  );
}

/** Staging only reads generated source through upstream extractors; it never runs the SDK. */
export const createCompatibilitySnapshot = Effect.fn("SdkCompatibility.snapshot")(function* (
  details: Omit<SdkCompatibilitySnapshot, "schemaVersion" | "surfaces">,
  files: readonly GeneratedFile[],
  temporaryDirectory: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const extractors: Record<TargetName, Extractor> = {
    typescript: nodeExtractor,
    python: pythonExtractor,
    go: goExtractor,
    rust: rustExtractor,
  };
  const surfaceNames =
    details.target === "typescript"
      ? ["promise", ...(files.some((file) => file.path === "src/effect.ts") ? ["effect"] : [])]
      : [details.target];
  const surfaces: Record<string, SdkSurfaceSnapshot> = {};
  for (const surfaceName of surfaceNames) {
    const directory = join(temporaryDirectory, "surfaces", details.target, surfaceName);
    for (const file of files) {
      if (/^(?:tests?|examples)\//.test(file.path) || /(?:_test\.go|\.test\.ts)$/.test(file.path))
        continue;
      const effectFile = /(?:\.effect\.ts$|^src\/effect(?:-client|-runtime)?\.ts$)/.test(file.path);
      if (surfaceName === "promise" && effectFile) continue;
      if (
        surfaceName === "effect" &&
        !effectFile &&
        (file.path === "src/workos.ts" ||
          file.path === "src/index.ts" ||
          file.path === "src/common/workos-base.ts" ||
          file.content.includes("constructor(private readonly workos: WorkOS)"))
      )
        continue;
      const relative = posix.normalize(file.path);
      if (posix.isAbsolute(relative) || relative.startsWith("../"))
        return yield* new GenerationError({ message: "Emitter produced an unsafe file path." });
      const path = join(directory, relative);
      yield* fs
        .makeDirectory(dirname(path), { recursive: true })
        .pipe(Effect.mapError(failure("Stage SDK surface")));
      const content = yield* Effect.try({
        try: () => {
          if (surfaceName === "effect") return effectExtractionSource(file.content);
          // Oagen keys Rust impl receivers by text, but structs by bare name.
          // Strip lifetime-only receiver parameters in staging, not the real SDK.
          if (details.target === "rust")
            return file.content.replace(/\bimpl<'a>\s+(\w+)<'a>\s*\{/g, "impl $1 {");
          return file.content;
        },
        catch: failure("Prepare SDK compatibility surface"),
      });
      yield* fs.writeFileString(path, content).pipe(Effect.mapError(failure("Stage SDK surface")));
    }
    if (details.target === "typescript") {
      yield* fs
        .writeFileString(
          join(directory, "tsconfig.json"),
          JSON.stringify({
            compilerOptions: {
              target: "ES2023",
              module: "ESNext",
              moduleResolution: "Bundler",
              strict: true,
            },
            include: ["src/**/*.ts"],
          }),
        )
        .pipe(Effect.mapError(failure("Stage TypeScript extractor config")));
      if (surfaceName === "effect")
        yield* fs
          .writeFileString(
            join(directory, "package.json"),
            JSON.stringify({ exports: { ".": "./src/effect.ts" } }),
          )
          .pipe(Effect.mapError(failure("Stage Effect extractor entrypoint")));
    }
    const surface = yield* Effect.tryPromise({
      try: () => extractors[details.target].extract(directory),
      catch: failure(`Extract SDK compatibility surface ${details.target}/${surfaceName}`),
    });
    const snapshot = apiSurfaceToSnapshot(surface);
    if (snapshot.symbols.length === 0 && listContractOperations(details.contract).length > 0)
      return yield* new GenerationError({
        message: `Compatibility extraction produced no symbols for ${details.target}/${surfaceName}.`,
      });
    const methods = new Set(
      Object.values(surface.classes).flatMap((entry) => Object.keys(entry.methods)),
    );
    for (const operation of details.target === "go"
      ? []
      : listContractOperations(details.contract)) {
      const id = String(operation.operation.operationId);
      const method = details.target === "typescript" ? toCamelCase(id) : toSnakeCase(id);
      if (!methods.has(method))
        return yield* new GenerationError({
          message: `Compatibility extraction is missing operation ${id} in ${details.target}/${surfaceName}.`,
        });
    }
    snapshot.source.extractedAt = "1970-01-01T00:00:00.000Z";
    snapshot.symbols.sort((a, b) => a.id.localeCompare(b.id));
    surfaces[surfaceName] = {
      snapshot,
      exports: surface.exports,
      aliases: Object.fromEntries(
        Object.entries(surface.typeAliases).map(([name, alias]) => [name, alias.value]),
      ),
    };
  }
  return { schemaVersion: 1, ...details, surfaces } satisfies SdkCompatibilitySnapshot;
});

export const loadCompatibilitySnapshot = Effect.fn("SdkCompatibility.load")(function* (
  path: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const content = yield* fs
    .readFileString(path)
    .pipe(Effect.mapError(failure("Read compatibility baseline")));
  const decoded = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SnapshotEnvelope))(
    content,
  ).pipe(Effect.mapError(failure("Decode compatibility baseline")));
  const surfaces: Record<string, SdkSurfaceSnapshot> = {};
  for (const [name, surface] of Object.entries(decoded.surfaces)) {
    if (!validateSnapshot(surface.snapshot))
      return yield* new GenerationError({
        message: `Invalid upstream compatibility snapshot for ${name}.`,
      });
    surfaces[name] = {
      snapshot: surface.snapshot,
      exports: surface.exports,
      aliases: surface.aliases,
    };
  }
  if (Object.keys(surfaces).length === 0 || !isRecord(decoded.contract.paths))
    return yield* new GenerationError({
      message: "Compatibility baseline has no surfaces or contract paths.",
    });
  return {
    ...decoded,
    profiles: [...decoded.profiles],
    surfaces,
  } satisfies SdkCompatibilitySnapshot;
});

export interface CompatibilityFinding {
  id: string;
  severity: "breaking" | "soft-risk" | "additive";
  message: string;
}

export interface SdkCompatibilityReport {
  target: TargetName;
  compatible: boolean;
  wire: DiffReport;
  surfaces: Record<string, CompatReport>;
  findings: CompatibilityFinding[];
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

function operationSecurity(document: OpenApiDocument, operation: Record<string, unknown>): unknown {
  return operation.security ?? document.security ?? [];
}

/** Supplemental checks retain security and source identity which Oagen's IR differ does not. */
function supplementalWireFindings(
  oldDocument: OpenApiDocument,
  newDocument: OpenApiDocument,
): CompatibilityFinding[] {
  const findings: CompatibilityFinding[] = [];
  const oldOperations = listContractOperations(oldDocument);
  const newOperations = new Map(
    listContractOperations(newDocument).map((entry) => [entry.operation.operationId, entry]),
  );
  const oldSchemes = compileAuthPlan(oldDocument).schemes;
  const newSchemes = compileAuthPlan(newDocument).schemes;
  for (const old of oldOperations) {
    const id = String(old.operation.operationId);
    const current = newOperations.get(id);
    if (!current) continue;
    if (old.method !== current.method || old.path !== current.path)
      findings.push({
        id: `wire.${id}.route`,
        severity: "breaking",
        message: `HTTP method or path changed for ${id}.`,
      });
    if (old.operation["x-signalflare-api-id"] !== current.operation["x-signalflare-api-id"])
      findings.push({
        id: `wire.${id}.source-api`,
        severity: "breaking",
        message: `Source API identity changed for ${id}.`,
      });
    const before = operationSecurity(oldDocument, old.operation);
    const after = operationSecurity(newDocument, current.operation);
    // Changes in alternative/scope/scheme semantics are conservatively gated for review.
    if (stable(before) !== stable(after))
      findings.push({
        id: `wire.${id}.security`,
        severity: "breaking",
        message: `Authentication requirements changed for ${id}.`,
      });
  }
  for (const scheme of oldSchemes) {
    const after = newSchemes.find((entry) => entry.id === scheme.id);
    if (stable(scheme) !== stable(after))
      findings.push({
        id: `wire.security-scheme.${scheme.id}`,
        severity: "breaking",
        message: `Authentication scheme ${scheme.id} changed.`,
      });
  }
  // The upstream IR does not retain every JSON Schema validation keyword.
  // Conservatively gate changes on existing schemas; new optional properties
  // remain additive and descriptions/examples are deliberately ignored.
  const constraints = new Set([
    "const",
    "default",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "pattern",
    "minItems",
    "maxItems",
    "uniqueItems",
    "minProperties",
    "maxProperties",
    "additionalProperties",
  ]);
  const compareConstraints = (before: unknown, after: unknown, pointer: string): void => {
    if (Array.isArray(before) && Array.isArray(after)) {
      before.forEach((entry, index) =>
        compareConstraints(entry, after[index], `${pointer}/${index}`),
      );
    } else if (isRecord(before) && isRecord(after)) {
      for (const keyword of constraints) {
        if (stable(before[keyword]) !== stable(after[keyword]))
          findings.push({
            id: `wire.schema${pointer}/${keyword}`,
            severity: "breaking",
            message: `Schema constraint ${keyword} changed at ${pointer}.`,
          });
      }
      for (const key of Object.keys(before)) {
        if (!constraints.has(key) && key in after)
          compareConstraints(before[key], after[key], `${pointer}/${key}`);
      }
    }
  };
  compareConstraints(oldDocument.components, newDocument.components, "#/components");
  compareConstraints(oldDocument.paths, newDocument.paths, "#/paths");
  return findings;
}

export const compareCompatibilitySnapshots = Effect.fn("SdkCompatibility.compare")(function* (
  baseline: SdkCompatibilitySnapshot,
  candidate: SdkCompatibilitySnapshot,
  temporaryDirectory: string,
) {
  if (
    baseline.product !== candidate.product ||
    baseline.target !== candidate.target ||
    stable(baseline.profiles) !== stable(candidate.profiles)
  )
    return yield* new GenerationError({
      message: "Compatibility baselines must match product, target and selected profiles.",
    });
  const fs = yield* FileSystem.FileSystem;
  const parse = Effect.fn("SdkCompatibility.parseWire")(function* (
    name: string,
    contract: OpenApiDocument,
  ) {
    const path = join(temporaryDirectory, `${candidate.target}-${name}.json`);
    yield* fs
      .writeFileString(path, JSON.stringify(normalizeContractForOagen(contract).document))
      .pipe(Effect.mapError(failure("Stage wire baseline")));
    return yield* Effect.tryPromise({
      try: () => parseSpec(path),
      catch: failure("Parse wire baseline"),
    });
  });
  const oldSpec = yield* parse("before", baseline.contract);
  const newSpec = yield* parse("after", candidate.contract);
  const wire = diffSpecs(oldSpec, newSpec);
  const findings = supplementalWireFindings(baseline.contract, candidate.contract);
  if (baseline.packageName !== candidate.packageName)
    findings.push({
      id: "sdk.package-name",
      severity: "breaking",
      message: "SDK package/module/crate identity changed.",
    });
  for (const change of wire.changes)
    findings.push({
      id: `wire.${change.kind}.${"name" in change ? change.name : `${change.serviceName}.${change.operationName}`}`,
      severity: change.classification,
      message: `Wire contract ${change.kind}.`,
    });
  for (const change of wire.behaviorChanges)
    findings.push({
      id: `wire.default.${change.serviceName}.${change.operationName}.${change.paramName}`,
      severity: "breaking",
      message: "Parameter default changed.",
    });
  const surfaces: Record<string, CompatReport> = {};
  for (const [name, before] of Object.entries(baseline.surfaces)) {
    const after = candidate.surfaces[name];
    if (!after) {
      findings.push({
        id: `sdk.${name}.removed`,
        severity: "breaking",
        message: `SDK surface ${name} was removed.`,
      });
      continue;
    }
    const report = generateReport(
      diffSnapshots(before.snapshot, after.snapshot),
      before.snapshot.source.language,
    );
    surfaces[name] = report;
    for (const change of report.changes)
      findings.push({
        id: `sdk.${name}.${change.conceptualChangeId}`,
        severity: change.severity,
        message: `${name}: ${change.message ?? change.category} (${change.symbol}).`,
      });
    for (const [path, names] of Object.entries(before.exports)) {
      for (const symbol of names)
        if (!after.exports[path]?.includes(symbol))
          findings.push({
            id: `sdk.${name}.export.${path}.${symbol}`,
            severity: "breaking",
            message: `Export ${symbol} was removed from ${path}.`,
          });
    }
    // Oagen's snapshot bridge stores alias identity, but not its RHS.
    for (const [alias, value] of Object.entries(before.aliases)) {
      if (after.aliases[alias] !== value)
        findings.push({
          id: `sdk.${name}.alias.${alias}`,
          severity: "breaking",
          message: `Public type alias ${alias} changed in ${name}.`,
        });
    }
  }
  return {
    target: candidate.target,
    compatible: !findings.some((finding) => finding.severity === "breaking"),
    wire,
    surfaces,
    findings,
  } satisfies SdkCompatibilityReport;
});

export const compareSdkBaseline = Effect.fn("SdkCompatibility.baseline")(function* (
  baselineDirectory: string,
  candidate: SdkCompatibilitySnapshot,
  temporaryDirectory: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const grouped = resolve(baselineDirectory, candidate.target, COMPATIBILITY_FILE);
  const path = (yield* fs.exists(grouped))
    ? grouped
    : resolve(baselineDirectory, COMPATIBILITY_FILE);
  const baseline = yield* loadCompatibilitySnapshot(path);
  return yield* compareCompatibilitySnapshots(baseline, candidate, temporaryDirectory);
});
