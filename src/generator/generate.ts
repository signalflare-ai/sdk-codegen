import { createHash } from "node:crypto";
import { join, posix, resolve } from "node:path";
import {
  generate,
  parseSpec,
  toPascalCase,
  toSnakeCase,
  type ApiSpec,
  type Emitter,
  type GeneratedFile,
  type OperationHint,
} from "@workos/oagen";
import { Effect, FileSystem, Schema, Semaphore } from "effect";
import { loadSdkConfig } from "../config/load.js";
import {
  OPENAPI_BASELINE,
  TARGET_NAMES,
  type SdkProfile,
  type SignalflareSdkConfig,
  type TargetName,
} from "../config/schema.js";
import { compileAuthPlan } from "../contract/auth.js";
import type { Diagnostic, ValidationReport } from "../contract/diagnostics.js";
import { createValidationReport } from "../contract/diagnostics.js";
import { loadProductContract, type OpenApiDocument } from "../contract/load.js";
import { normalizeContractForOagen } from "../contract/normalize.js";
import { buildProfilesContract, type ProfilesContractResult } from "../contract/profiles.js";
import { validateProductContract } from "../contract/validate.js";
import { GenerationError } from "../core/errors.js";
import { signalflareGoEmitter } from "../emitters/go/index.js";
import { signalflarePythonEmitter } from "../emitters/python/index.js";
import type { NativeRuntimeOptions } from "../emitters/runtime-options.js";
import { signalflareRustEmitter } from "../emitters/rust/index.js";
import {
  signalflareTypeScriptEmitter,
  stripAutomaticPagination,
  type SignalflareTypeScriptEmitterOptions,
} from "../emitters/typescript/index.js";
import { validateOagenIr } from "../oagen/validate-ir.js";
import {
  COMPILER_VERSION,
  EFFECT_VERSION,
  GENERATED_SDK_VERSION,
  OAGEN_EMITTERS_VERSION,
} from "../version.js";
import {
  SIGNALFLARE_MANIFEST_SCHEMA_VERSION,
  SignalflareSdkManifestJson,
  type SignalflareSdkManifest,
} from "./manifest.js";
import { checkGeneratedFiles, type GenerationDrift } from "./check.js";
import {
  COMPATIBILITY_FILE,
  compareSdkBaseline,
  createCompatibilitySnapshot,
  type SdkCompatibilityReport,
} from "./compatibility.js";

const OagenManifestFromJson = Schema.fromJsonString(Schema.JsonObject);

export interface GenerateSdkOptions {
  configPath?: string;
  cwd?: string;
  targets?: TargetName[];
  dryRun?: boolean;
  check?: boolean;
  baseline?: string;
  quiet?: boolean;
}

export interface GeneratedTargetReport {
  target: TargetName;
  language: string;
  output: string;
  profiles: SdkProfile[];
  operations: number;
  files: string[];
  warnings: string[];
  dryRun: boolean;
  drift?: GenerationDrift[];
  compatibility?: SdkCompatibilityReport;
}

export interface GenerationReport {
  command: "generate" | "check" | "compat";
  config: string;
  contract: string;
  compilerVersion: string;
  targets: GeneratedTargetReport[];
  validation: ValidationReport;
}

type ConfiguredTarget = NonNullable<SignalflareSdkConfig["targets"][TargetName]>;

interface TargetDefinition {
  name: TargetName;
  config: ConfiguredTarget;
  emitter: Emitter;
  language: string;
}

function generationError(operation: string, cause: unknown): GenerationError {
  return new GenerationError({
    message: `${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
    cause,
  });
}

function validateGeneratedTypeScriptImports(
  files: readonly { path: string; content: string }[],
): ValidationReport {
  const generatedPaths = new Set(files.map((file) => posix.normalize(file.path)));
  const diagnostics: Diagnostic[] = [];
  const importPattern = /\bfrom\s+['"](\.[^'"]+)['"]/g;

  for (const file of files) {
    if (!file.path.endsWith(".ts") || file.content.length === 0) continue;
    for (const match of file.content.matchAll(importPattern)) {
      const specifier = match[1];
      if (!specifier) continue;
      const withoutExtension = specifier.replace(/\.(?:js|ts)$/, "");
      const base = posix.normalize(posix.join(posix.dirname(file.path), withoutExtension));
      if (generatedPaths.has(`${base}.ts`) || generatedPaths.has(`${base}/index.ts`)) continue;
      diagnostics.push({
        severity: "error",
        code: "generation.typescript-import.unresolved",
        message: `Generated file imports missing module ${JSON.stringify(specifier)}.`,
        pointer: file.path,
        hint: "This usually indicates an unresolved Oagen model/enum or an incomplete target runtime.",
      });
    }
  }

  return createValidationReport(diagnostics);
}

function validateGeneratedPythonImports(
  files: readonly { path: string; content: string }[],
): ValidationReport {
  const generatedPaths = new Set(files.map((file) => posix.normalize(file.path)));
  const packageRoots = new Set(
    [...generatedPaths].flatMap((path) => {
      const match = path.match(/^src\/([^/]+)\//);
      return match?.[1] ? [match[1]] : [];
    }),
  );
  const diagnostics: Diagnostic[] = [];
  const importPattern = /^from\s+([.A-Za-z_][.\w]*)\s+import\s+/gm;

  for (const file of files) {
    if (!file.path.endsWith(".py")) continue;
    for (const match of file.content.matchAll(importPattern)) {
      const specifier = match[1];
      if (!specifier) continue;
      let base: string | undefined;
      if (specifier.startsWith(".")) {
        const dots = specifier.match(/^\.+/)?.[0].length ?? 0;
        base = posix.dirname(file.path);
        for (let index = 1; index < dots; index += 1) base = posix.dirname(base);
        const module = specifier.slice(dots).replaceAll(".", "/");
        if (module) base = posix.join(base, module);
      } else {
        const root = specifier.split(".")[0];
        if (root === "tests") base = specifier.replaceAll(".", "/");
        else if (root && packageRoots.has(root)) base = `src/${specifier.replaceAll(".", "/")}`;
      }
      if (!base) continue;
      if (generatedPaths.has(`${base}.py`) || generatedPaths.has(`${base}/__init__.py`)) continue;
      diagnostics.push({
        severity: "error",
        code: "generation.python-import.unresolved",
        message: `Generated file imports missing module ${JSON.stringify(specifier)}.`,
        pointer: file.path,
        hint: "The Python runtime wrapper or generated package barrel is incomplete.",
      });
    }
  }
  return createValidationReport(diagnostics);
}

function validateGeneratedRustModules(
  files: readonly { path: string; content: string }[],
): ValidationReport {
  const generatedPaths = new Set(files.map((file) => posix.normalize(file.path)));
  const diagnostics: Diagnostic[] = [];
  const modulePattern = /^(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/gm;
  for (const file of files) {
    if (!file.path.endsWith(".rs")) continue;
    for (const match of file.content.matchAll(modulePattern)) {
      const moduleName = match[1];
      if (!moduleName) continue;
      const basename = posix.basename(file.path);
      const moduleDirectory =
        basename === "lib.rs" ||
        basename === "main.rs" ||
        basename === "mod.rs" ||
        file.path.startsWith("tests/")
          ? posix.dirname(file.path)
          : file.path.slice(0, -".rs".length);
      const base = posix.join(moduleDirectory, moduleName);
      if (generatedPaths.has(`${base}.rs`) || generatedPaths.has(`${base}/mod.rs`)) continue;
      diagnostics.push({
        severity: "error",
        code: "generation.rust-module.unresolved",
        message: `Generated file declares missing module ${JSON.stringify(moduleName)}.`,
        pointer: file.path,
        hint: "The Rust runtime wrapper or generated module barrel is incomplete.",
      });
    }
  }
  return createValidationReport(diagnostics);
}

function validateGeneratedImports(
  target: TargetName,
  files: readonly { path: string; content: string }[],
): ValidationReport {
  if (target === "typescript") return validateGeneratedTypeScriptImports(files);
  if (target === "python") return validateGeneratedPythonImports(files);
  if (target === "rust") return validateGeneratedRustModules(files);
  return createValidationReport([]);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function preserveHandOwnedFiles(emitter: Emitter, existing: ReadonlyMap<string, string>): Emitter {
  // Keep paths in the upstream manifest (otherwise pruning deletes TOML bootstraps).
  // Identical content bypasses both JSON merging and AST rewriting in Oagen's writer.
  const keep = (files: GeneratedFile[]) =>
    files.map((file) =>
      existing.has(file.path)
        ? { ...file, content: existing.get(file.path) ?? "", headerPlacement: "skip" as const }
        : file,
    );
  return {
    ...emitter,
    generateModels: (models, context) => keep(emitter.generateModels(models, context)),
    generateEnums: (enums, context) => keep(emitter.generateEnums(enums, context)),
    generateResources: (services, context) => keep(emitter.generateResources(services, context)),
    generateClient: (spec, context) => keep(emitter.generateClient(spec, context)),
    generateErrors: (context) => keep(emitter.generateErrors(context)),
    generateTests: (spec, context) => keep(emitter.generateTests(spec, context)),
    ...(emitter.generateTypeSignatures
      ? {
          generateTypeSignatures: (spec, context) =>
            keep(emitter.generateTypeSignatures?.(spec, context) ?? []),
        }
      : {}),
  };
}

function targetDefinitions(config: SignalflareSdkConfig): TargetDefinition[] {
  const emitters: Record<TargetName, { emitter: Emitter; language: string }> = {
    typescript: { emitter: signalflareTypeScriptEmitter, language: "node" },
    python: { emitter: signalflarePythonEmitter, language: "python" },
    go: { emitter: signalflareGoEmitter, language: "go" },
    rust: { emitter: signalflareRustEmitter, language: "rust" },
  };

  return TARGET_NAMES.flatMap((name) => {
    const target = config.targets[name];
    if (!target || target.enabled === false) return [];
    return [{ name, config: target, ...emitters[name] }];
  });
}

const selectTargets = Effect.fn("SdkGenerator.selectTargets")(function* (
  config: SignalflareSdkConfig,
  requestedTargets: TargetName[] | undefined,
) {
  const definitions = targetDefinitions(config);
  if (!requestedTargets || requestedTargets.length === 0) return definitions;
  const requested = new Set(requestedTargets);
  const selected = definitions.filter((target) => requested.has(target.name));
  const missing = requestedTargets.filter(
    (target) => !selected.some((entry) => entry.name === target),
  );
  if (missing.length > 0) {
    return yield* new GenerationError({
      message: `Requested target(s) are not configured and enabled: ${missing.join(", ")}.`,
    });
  }
  return selected;
});

function operationHints(
  operations: Array<{ method: string; path: string; operationId: string }>,
  target: TargetName,
): Record<string, OperationHint> {
  return Object.fromEntries(
    operations.map((operation) => [
      `${operation.method} ${operation.path}`,
      { name: target === "python" ? toSnakeCase(operation.operationId) : operation.operationId },
    ]),
  );
}

function firstServerUrl(document: OpenApiDocument): string {
  if (!Array.isArray(document.servers)) return "";
  for (const server of document.servers) {
    if (
      typeof server === "object" &&
      server !== null &&
      "url" in server &&
      typeof server.url === "string"
    ) {
      return server.url;
    }
  }
  return "";
}

function packageIdentifier(target: TargetDefinition): string {
  if ("packageName" in target.config) return target.config.packageName;
  if ("module" in target.config) return target.config.module;
  return target.config.crateName;
}

const enrichOagenManifest = Effect.fn("SdkGenerator.enrichManifest")(function* (
  output: string,
  details: {
    sdkName: string;
    specPath: string;
    specSha: string;
    configSha: string;
    emitterVersion: string;
  },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = join(output, ".oagen-manifest.json");
  const content = yield* fs
    .readFileString(path)
    .pipe(Effect.mapError((cause) => generationError("Read Oagen manifest", cause)));
  const parsed = yield* Schema.decodeUnknownEffect(OagenManifestFromJson)(content).pipe(
    Effect.mapError((cause) => generationError("Parse Oagen manifest", cause)),
  );
  const enriched = {
    ...parsed,
    sdkName: details.sdkName,
    specPath: details.specPath,
    specSha: details.specSha,
    emitterVersion: details.emitterVersion,
    configSha: details.configSha,
    compatSchemaVersion: "1",
  };
  yield* fs
    .writeFileString(path, `${JSON.stringify(enriched, null, 2)}\n`)
    .pipe(Effect.mapError((cause) => generationError("Write Oagen manifest", cause)));
});

const generateSignalflareManifest = Effect.fn("SdkGenerator.manifest")(function* (details: {
  product: string;
  profiles: SdkProfile[];
  target: TargetName;
  packageName: string;
  sdkVersion: string;
  effectVersion?: string;
}) {
  const manifest = {
    schemaVersion: SIGNALFLARE_MANIFEST_SCHEMA_VERSION,
    product: details.product,
    profiles: details.profiles,
    target: details.target,
    packageName: details.packageName,
    sdkVersion: details.sdkVersion,
    ...(details.effectVersion === undefined ? {} : { effectVersion: details.effectVersion }),
    compilerVersion: COMPILER_VERSION,
    openapiBaseline: OPENAPI_BASELINE,
  } satisfies SignalflareSdkManifest;
  const content = yield* Schema.encodeEffect(SignalflareSdkManifestJson)(manifest).pipe(
    Effect.mapError((cause) => generationError("Encode Signalflare manifest", cause)),
  );
  return {
    path: ".signalflare-sdk-manifest.json",
    content: `${content}\n`,
    overwriteExisting: true,
  } satisfies GeneratedFile;
});

function emitterOptions(
  config: SignalflareSdkConfig,
  target: TargetDefinition,
  document: OpenApiDocument,
): SignalflareTypeScriptEmitterOptions | NativeRuntimeOptions {
  const shared = {
    authPlan: compileAuthPlan(document),
    defaultBaseUrl: firstServerUrl(document),
    compilerVersion: COMPILER_VERSION,
    sdkVersion: target.config.sdkVersion ?? config.product.sdkVersion ?? GENERATED_SDK_VERSION,
    productId: config.product.id,
    packageName: packageIdentifier(target),
    clientClassName: `${toPascalCase(config.product.displayName)}Client`,
  };
  if (target.name === "typescript") {
    return {
      ...shared,
      effect: "effect" in target.config && target.config.effect === true,
      effectVersion:
        "effectVersion" in target.config
          ? (target.config.effectVersion ?? EFFECT_VERSION)
          : EFFECT_VERSION,
      adoptMissingServices: true,
    } as SignalflareTypeScriptEmitterOptions & {
      adoptMissingServices: boolean;
    };
  }
  return { ...shared, productDisplayName: config.product.displayName };
}

/**
 * Python and Rust's pinned emitters mistake every non-default security scheme
 * for an explicit bearer argument. Authentication is instead resolved by the
 * generated runtime from the original operation-aware AuthPlan.
 */
function stripEmitterManagedSecurity(spec: ApiSpec): ApiSpec {
  return {
    ...spec,
    services: spec.services.map((service) => ({
      ...service,
      operations: service.operations.map((operation) => {
        if (operation.security === undefined) return operation;
        const { security: _security, ...withoutSecurity } = operation;
        return withoutSecurity;
      }),
    })),
  };
}

const oagenConsoleSemaphore = Semaphore.makeUnsafe(1);

function runOagenGenerate(
  quiet: boolean,
  task: () => Promise<GeneratedFile[]>,
): Effect.Effect<GeneratedFile[], GenerationError> {
  const run = Effect.tryPromise({
    try: task,
    catch: (cause) => generationError("Run Oagen emitter", cause),
  });
  const guardedRun = quiet
    ? Effect.acquireUseRelease(
        Effect.sync(() => {
          const log = console.log;
          console.log = () => {};
          return log;
        }),
        () => run,
        (log) => Effect.sync(() => void (console.log = log)),
      )
    : run;

  // Oagen logs directly to the global console. Serialize both quiet and visible
  // runs so a quiet invocation can never suppress an overlapping generation.
  return oagenConsoleSemaphore.withPermit(guardedRun);
}

interface TargetGenerationContext {
  config: SignalflareSdkConfig;
  profileContract: ProfilesContractResult;
  target: TargetDefinition;
  temporaryDirectory: string;
  configSha: string;
  specSha: string;
  options: GenerateSdkOptions;
}

const generateTarget = Effect.fn("SdkGenerator.generateTarget")(function* (
  context: TargetGenerationContext,
) {
  const { config, profileContract, target, temporaryDirectory, configSha, specSha, options } =
    context;
  const fs = yield* FileSystem.FileSystem;
  const normalization = normalizeContractForOagen(profileContract.document);
  const temporarySpec = join(temporaryDirectory, `${target.name}.openapi.json`);
  yield* fs
    .writeFileString(temporarySpec, `${JSON.stringify(normalization.document, null, 2)}\n`)
    .pipe(Effect.mapError((cause) => generationError("Write temporary OpenAPI document", cause)));

  const parsed = yield* Effect.tryPromise({
    try: () => parseSpec(temporarySpec),
    catch: (cause) => generationError("Parse Oagen IR", cause),
  });
  const paginationSafeIr = stripAutomaticPagination(parsed);
  const ir =
    target.name === "typescript" ? paginationSafeIr : stripEmitterManagedSecurity(paginationSafeIr);
  const irValidation = validateOagenIr(ir);
  if (!irValidation.valid) {
    return yield* new GenerationError({
      message: `Oagen produced invalid IR for target ${target.name}.`,
      validation: irValidation,
    });
  }

  const output = resolve(context.options.cwd ?? process.cwd(), target.config.output);
  const targetEmitterOptions = emitterOptions(config, target, profileContract.document);
  const files = yield* runOagenGenerate(options.quiet === true, () =>
    generate(ir, target.emitter, {
      namespace: toPascalCase(config.product.displayName),
      outputDir: output,
      dryRun: true,
      operationHints: operationHints(profileContract.operations, target.name),
      emitterOptions: targetEmitterOptions,
    }),
  );

  const importValidation = validateGeneratedImports(target.name, files);
  if (!importValidation.valid) {
    return yield* new GenerationError({
      message: `The generated ${target.name} target contains unresolved local modules.`,
      validation: importValidation,
    });
  }

  const snapshot = yield* createCompatibilitySnapshot(
    {
      product: config.product.id,
      target: target.name,
      profiles: profileContract.profiles,
      sdkVersion: targetEmitterOptions.sdkVersion,
      packageName: packageIdentifier(target),
      contract: profileContract.document,
    },
    files,
    temporaryDirectory,
  );
  const snapshotFile: GeneratedFile = {
    path: COMPATIBILITY_FILE,
    content: `${JSON.stringify(snapshot, null, 2)}\n`,
    overwriteExisting: true,
  };
  const signalflareManifestFile = yield* generateSignalflareManifest({
    product: config.product.id,
    profiles: profileContract.profiles,
    target: target.name,
    packageName: packageIdentifier(target),
    sdkVersion: targetEmitterOptions.sdkVersion,
    ...("effect" in targetEmitterOptions &&
    targetEmitterOptions.effect === true &&
    typeof targetEmitterOptions.effectVersion === "string"
      ? { effectVersion: targetEmitterOptions.effectVersion }
      : {}),
  });
  let drift: GenerationDrift[] | undefined;
  if (options.check) {
    const checkedOutput = join(temporaryDirectory, "checked", target.name);
    yield* runOagenGenerate(options.quiet === true, () =>
      generate(ir, target.emitter, {
        namespace: toPascalCase(config.product.displayName),
        outputDir: checkedOutput,
        operationHints: operationHints(profileContract.operations, target.name),
        emitterOptions: targetEmitterOptions,
      }),
    );
    const formatted = yield* Effect.forEach(files, (file) =>
      fs.readFileString(join(checkedOutput, file.path)).pipe(
        Effect.map((content) => ({ ...file, content })),
        Effect.mapError((cause) => generationError("Read regenerated comparison file", cause)),
      ),
    );
    drift = yield* checkGeneratedFiles(output, [
      ...formatted,
      snapshotFile,
      signalflareManifestFile,
    ]);
  }
  const compatibility = options.baseline
    ? yield* compareSdkBaseline(
        resolve(context.options.cwd ?? process.cwd(), options.baseline),
        snapshot,
        temporaryDirectory,
      )
    : undefined;

  if (!options.dryRun && !options.check && !options.baseline) {
    const handOwned = new Map<string, string>();
    for (const file of files) {
      if (file.overwriteExisting === false && (yield* fs.exists(join(output, file.path)))) {
        handOwned.set(
          file.path,
          yield* fs
            .readFileString(join(output, file.path))
            .pipe(Effect.mapError((cause) => generationError("Read hand-owned SDK file", cause))),
        );
      }
    }
    // Plan and validate all source/imports/surfaces before allowing the upstream writer to touch product files.
    yield* runOagenGenerate(options.quiet === true, () =>
      generate(ir, preserveHandOwnedFiles(target.emitter, handOwned), {
        namespace: toPascalCase(config.product.displayName),
        outputDir: output,
        operationHints: operationHints(profileContract.operations, target.name),
        emitterOptions: targetEmitterOptions,
      }),
    );
    yield* fs
      .writeFileString(join(output, COMPATIBILITY_FILE), snapshotFile.content)
      .pipe(Effect.mapError((cause) => generationError("Write compatibility snapshot", cause)));
    yield* enrichOagenManifest(output, {
      sdkName: packageIdentifier(target),
      specPath: config.contract.spec,
      specSha,
      configSha,
      emitterVersion: `@signalflare-ai/${target.name}-wrapper+@workos/oagen-emitters@${OAGEN_EMITTERS_VERSION}`,
    });
    yield* fs
      .writeFileString(join(output, signalflareManifestFile.path), signalflareManifestFile.content)
      .pipe(Effect.mapError((cause) => generationError("Write Signalflare manifest", cause)));
  }

  return {
    target: target.name,
    language: target.language,
    output,
    profiles: profileContract.profiles,
    operations: profileContract.operations.length,
    files: [
      ...new Set([
        ...files.map((file) => file.path),
        COMPATIBILITY_FILE,
        signalflareManifestFile.path,
        ".oagen-manifest.json",
      ]),
    ].sort(),
    warnings: [
      ...normalization.transforms,
      ...profileContract.validation.diagnostics
        .filter(
          (diagnostic): diagnostic is Diagnostic & { severity: "warning" } =>
            diagnostic.severity === "warning",
        )
        .map((diagnostic) => diagnostic.message),
    ],
    dryRun: options.dryRun === true || options.check === true || options.baseline !== undefined,
    ...(drift === undefined ? {} : { drift }),
    ...(compatibility === undefined ? {} : { compatibility }),
  } satisfies GeneratedTargetReport;
});

export const generateConfiguredSdks = Effect.fn("SdkGenerator.generate")(function* (
  options: GenerateSdkOptions = {},
) {
  const cwd = options.cwd ?? process.cwd();
  const loadedConfig = yield* loadSdkConfig(options.configPath ?? "sdk.config.ts", cwd);
  const loadedContract = yield* loadProductContract(
    loadedConfig.config.contract.spec,
    loadedConfig.directory,
  ).pipe(
    Effect.mapError(
      (error) =>
        new GenerationError({
          message: error.message,
          validation: error.validation,
          cause: error,
        }),
    ),
  );

  const contractValidation = validateProductContract(loadedContract.document, loadedConfig.config, {
    file: loadedContract.path,
  });
  const validation = createValidationReport([
    ...loadedConfig.validation.diagnostics,
    ...loadedContract.validation.diagnostics,
    ...contractValidation.diagnostics,
  ]);
  if (!validation.valid) {
    return yield* new GenerationError({
      message: "SDK generation stopped because contract validation failed.",
      validation,
    });
  }

  const targets = yield* selectTargets(loadedConfig.config, options.targets);
  const fs = yield* FileSystem.FileSystem;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const temporaryDirectory = yield* fs
        .makeTempDirectoryScoped({ prefix: "signalflare-sdk-" })
        .pipe(Effect.mapError((cause) => generationError("Create temporary directory", cause)));
      const configSha = sha256(JSON.stringify(loadedConfig.config));
      const specSha = sha256(JSON.stringify(loadedContract.document));

      const reports = yield* Effect.forEach(targets, (target) => {
        const profileContract = buildProfilesContract(
          loadedContract.document,
          loadedConfig.config,
          target.config.profiles,
        );
        if (!profileContract.validation.valid) {
          return new GenerationError({
            message: `Unable to build profiles for target ${target.name}.`,
            validation: profileContract.validation,
          });
        }
        return generateTarget({
          config: loadedConfig.config,
          profileContract,
          target,
          temporaryDirectory,
          configSha,
          specSha,
          options: {
            ...options,
            cwd: loadedConfig.directory,
            ...(options.baseline === undefined ? {} : { baseline: resolve(cwd, options.baseline) }),
          },
        });
      });

      return {
        command: options.baseline ? "compat" : options.check ? "check" : "generate",
        config: loadedConfig.path,
        contract: loadedContract.path,
        compilerVersion: COMPILER_VERSION,
        targets: reports,
        validation,
      } satisfies GenerationReport;
    }),
  );
});
