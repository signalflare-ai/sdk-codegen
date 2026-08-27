import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";
import { generate, parseSpec, toPascalCase, type Emitter, type OperationHint } from "@workos/oagen";
import { goEmitter, pythonEmitter, rustEmitter } from "@workos/oagen-emitters";
import { loadSdkConfig } from "../config/load.js";
import type { BaseTargetConfig, SdkProfile, SignalflareSdkConfig } from "../config/schema.js";
import { compileAuthPlan } from "../contract/auth.js";
import type { Diagnostic, ValidationReport } from "../contract/diagnostics.js";
import { createValidationReport } from "../contract/diagnostics.js";
import { ContractLoadError, loadProductContract, type OpenApiDocument } from "../contract/load.js";
import { normalizeContractForOagen } from "../contract/normalize.js";
import { buildProfilesContract } from "../contract/profiles.js";
import { validateProductContract } from "../contract/validate.js";
import {
  signalflareTypeScriptEmitter,
  stripAutomaticPagination,
  type SignalflareTypeScriptEmitterOptions,
} from "../emitters/typescript/index.js";
import { validateOagenIr } from "../oagen/validate-ir.js";

export const COMPILER_VERSION = "0.0.0";
export const OAGEN_EMITTERS_VERSION = "0.24.4";
export const TARGET_NAMES = ["typescript", "python", "go", "rust"] as const;
export type TargetName = (typeof TARGET_NAMES)[number];

export interface GenerateSdkOptions {
  configPath?: string;
  cwd?: string;
  targets?: TargetName[];
  dryRun?: boolean;
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
}

export interface GenerationReport {
  command: "generate";
  config: string;
  contract: string;
  compilerVersion: string;
  targets: GeneratedTargetReport[];
  validation: ValidationReport;
}

export class GenerationError extends Error {
  override readonly name = "GenerationError";

  constructor(
    message: string,
    readonly validation?: ValidationReport,
  ) {
    super(message);
  }
}

interface TargetDefinition {
  name: TargetName;
  config: BaseTargetConfig & Record<string, unknown>;
  emitter: Emitter;
  language: string;
}

async function withoutConsoleLogs<Result>(
  quiet: boolean,
  task: () => Promise<Result>,
): Promise<Result> {
  if (!quiet) return task();
  const log = console.log;
  console.log = () => {};
  try {
    return await task();
  } finally {
    console.log = log;
  }
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function targetDefinitions(config: SignalflareSdkConfig): TargetDefinition[] {
  const emitters: Record<TargetName, { emitter: Emitter; language: string }> = {
    typescript: { emitter: signalflareTypeScriptEmitter, language: "node" },
    python: { emitter: pythonEmitter, language: "python" },
    go: { emitter: goEmitter, language: "go" },
    rust: { emitter: rustEmitter, language: "rust" },
  };

  return TARGET_NAMES.flatMap((name) => {
    const target = config.targets[name] as (BaseTargetConfig & Record<string, unknown>) | undefined;
    if (!target || target.enabled === false) return [];
    return [{ name, config: target, ...emitters[name] }];
  });
}

function operationHints(
  operations: Array<{ method: string; path: string; operationId: string }>,
): Record<string, OperationHint> {
  return Object.fromEntries(
    operations.map((operation) => [
      `${operation.method} ${operation.path}`,
      { name: operation.operationId },
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
  for (const key of ["packageName", "module", "crateName"] as const) {
    const value = target.config[key];
    if (typeof value === "string") return value;
  }
  return target.name;
}

function runtimeWarnings(target: TargetDefinition): string[] {
  if (target.name === "typescript") {
    return target.config.effect === true
      ? ["Effect generation is not implemented yet; this run emits the Promise/fetch client only."]
      : [];
  }
  return [
    `The ${target.name} emitter expects a product-owned hand-written transport/error runtime; this run emits its spec-derived core.`,
  ];
}

async function enrichOagenManifest(
  output: string,
  details: {
    sdkName: string;
    specPath: string;
    specSha: string;
    configSha: string;
    emitterVersion: string;
  },
): Promise<void> {
  const path = join(output, ".oagen-manifest.json");
  const parsed = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  const enriched = {
    ...parsed,
    sdkName: details.sdkName,
    specPath: details.specPath,
    specSha: details.specSha,
    emitterVersion: details.emitterVersion,
    configSha: details.configSha,
    compatSchemaVersion: "1",
  };
  await writeFile(path, `${JSON.stringify(enriched, null, 2)}\n`, "utf8");
}

async function writeSignalflareManifest(
  output: string,
  details: {
    product: string;
    profiles: SdkProfile[];
    target: TargetName;
    packageName: string;
  },
): Promise<void> {
  const manifest = {
    schemaVersion: 1,
    product: details.product,
    profiles: details.profiles,
    target: details.target,
    packageName: details.packageName,
    compilerVersion: COMPILER_VERSION,
    openapiBaseline: "3.1.2",
  };
  await writeFile(
    join(output, ".signalflare-sdk-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

function typeScriptEmitterOptions(
  config: SignalflareSdkConfig,
  target: TargetDefinition,
  document: OpenApiDocument,
): SignalflareTypeScriptEmitterOptions {
  return {
    authPlan: compileAuthPlan(document),
    defaultBaseUrl: firstServerUrl(document),
    compilerVersion: COMPILER_VERSION,
    productId: config.product.id,
    packageName: packageIdentifier(target),
    clientClassName: `${toPascalCase(config.product.displayName)}Client`,
    adoptMissingServices: true,
  } as SignalflareTypeScriptEmitterOptions & { adoptMissingServices: boolean };
}

function selectedTargets(
  config: SignalflareSdkConfig,
  requestedTargets: TargetName[] | undefined,
): TargetDefinition[] {
  const definitions = targetDefinitions(config);
  if (!requestedTargets || requestedTargets.length === 0) return definitions;
  const requested = new Set(requestedTargets);
  const selected = definitions.filter((target) => requested.has(target.name));
  const missing = requestedTargets.filter(
    (target) => !selected.some((entry) => entry.name === target),
  );
  if (missing.length > 0) {
    throw new GenerationError(
      `Requested target(s) are not configured and enabled: ${missing.join(", ")}.`,
    );
  }
  return selected;
}

export async function generateConfiguredSdks(
  options: GenerateSdkOptions = {},
): Promise<GenerationReport> {
  const cwd = options.cwd ?? process.cwd();
  const loadedConfig = await loadSdkConfig(options.configPath ?? "sdk.config.ts", cwd);
  let loadedContract;
  try {
    loadedContract = await loadProductContract(
      loadedConfig.config.contract.spec,
      loadedConfig.directory,
    );
  } catch (error) {
    if (error instanceof ContractLoadError) {
      throw new GenerationError(error.message, error.validation);
    }
    throw error;
  }

  const contractValidation = validateProductContract(loadedContract.document, loadedConfig.config, {
    file: loadedContract.path,
  });
  const validation = createValidationReport([
    ...loadedConfig.validation.diagnostics,
    ...loadedContract.validation.diagnostics,
    ...contractValidation.diagnostics,
  ]);
  if (!validation.valid) {
    throw new GenerationError(
      "SDK generation stopped because contract validation failed.",
      validation,
    );
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "signalflare-sdk-"));
  const reports: GeneratedTargetReport[] = [];
  const configSha = sha256(JSON.stringify(loadedConfig.config));
  const specSha = sha256(JSON.stringify(loadedContract.document));

  try {
    for (const target of selectedTargets(loadedConfig.config, options.targets)) {
      const profileContract = buildProfilesContract(
        loadedContract.document,
        loadedConfig.config,
        target.config.profiles,
      );
      if (!profileContract.validation.valid) {
        throw new GenerationError(
          `Unable to build profiles for target ${target.name}.`,
          profileContract.validation,
        );
      }

      const normalization = normalizeContractForOagen(profileContract.document);
      const temporarySpec = join(temporaryDirectory, `${target.name}.openapi.json`);
      await writeFile(
        temporarySpec,
        `${JSON.stringify(normalization.document, null, 2)}\n`,
        "utf8",
      );
      const ir = stripAutomaticPagination(await parseSpec(temporarySpec));
      const irValidation = validateOagenIr(ir);
      if (!irValidation.valid) {
        throw new GenerationError(
          `Oagen produced invalid IR for target ${target.name}.`,
          irValidation,
        );
      }

      const output = resolve(loadedConfig.directory, target.config.output);
      const emitterOptions =
        target.name === "typescript"
          ? typeScriptEmitterOptions(loadedConfig.config, target, profileContract.document)
          : undefined;
      const files = await withoutConsoleLogs(options.quiet === true, () =>
        generate(ir, target.emitter, {
          namespace: toPascalCase(loadedConfig.config.product.displayName),
          outputDir: output,
          ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
          operationHints: operationHints(profileContract.operations),
          ...(emitterOptions === undefined ? {} : { emitterOptions }),
        }),
      );

      if (target.name === "typescript") {
        const importValidation = validateGeneratedTypeScriptImports(files);
        if (!importValidation.valid) {
          throw new GenerationError(
            "The generated TypeScript target contains unresolved local imports.",
            importValidation,
          );
        }
      }

      if (!options.dryRun) {
        await enrichOagenManifest(output, {
          sdkName: packageIdentifier(target),
          specPath: loadedConfig.config.contract.spec,
          specSha,
          configSha,
          emitterVersion:
            target.name === "typescript"
              ? `@signalflare-ai/typescript-wrapper+@workos/oagen-emitters@${OAGEN_EMITTERS_VERSION}`
              : OAGEN_EMITTERS_VERSION,
        });
        await writeSignalflareManifest(output, {
          product: loadedConfig.config.product.id,
          profiles: profileContract.profiles,
          target: target.name,
          packageName: packageIdentifier(target),
        });
      }

      reports.push({
        target: target.name,
        language: target.language,
        output,
        profiles: profileContract.profiles,
        operations: profileContract.operations.length,
        files: [...new Set(files.map((file) => file.path))].sort(),
        warnings: [
          ...runtimeWarnings(target),
          ...normalization.transforms,
          ...profileContract.validation.diagnostics
            .filter(
              (diagnostic): diagnostic is Diagnostic & { severity: "warning" } =>
                diagnostic.severity === "warning",
            )
            .map((diagnostic) => diagnostic.message),
        ],
        dryRun: options.dryRun === true,
      });
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  return {
    command: "generate",
    config: loadedConfig.path,
    contract: loadedContract.path,
    compilerVersion: COMPILER_VERSION,
    targets: reports,
    validation,
  };
}
