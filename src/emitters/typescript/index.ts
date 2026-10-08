import {
  toCamelCase,
  toPascalCase,
  type ApiSpec,
  type Emitter,
  type EmitterContext,
  type GeneratedFile,
  type OperationsMap,
} from "@workos/oagen";
import { nodeEmitter } from "@workos/oagen-emitters";
import type { AuthPlan } from "../../contract/auth.js";
import { OAGEN_EMITTERS_VERSION } from "../../version.js";
import { generateEffectClient, generateEffectResources, generateEffectRuntime } from "./effect.js";
import { generateTypeScriptRuntime, type TypeScriptRuntimeOptions } from "./runtime.js";
import { preserveTypeScriptWireNames } from "./wire-names.js";

export interface SignalflareTypeScriptEmitterOptions extends TypeScriptRuntimeOptions {
  [key: string]: unknown;
  clientClassName: string;
  effect?: boolean;
  effectVersion?: string;
}

function optionsFor(context: EmitterContext): SignalflareTypeScriptEmitterOptions {
  const options = context.emitterOptions as
    | Partial<SignalflareTypeScriptEmitterOptions>
    | undefined;
  if (
    !options ||
    !options.authPlan ||
    typeof options.defaultBaseUrl !== "string" ||
    typeof options.compilerVersion !== "string" ||
    typeof options.sdkVersion !== "string" ||
    typeof options.productId !== "string" ||
    typeof options.packageName !== "string" ||
    typeof options.clientClassName !== "string"
  ) {
    throw new Error(
      "The Signalflare TypeScript emitter requires compiler-supplied runtime options.",
    );
  }
  return options as SignalflareTypeScriptEmitterOptions;
}

function makeExactOptionalCompatible(files: GeneratedFile[]): GeneratedFile[] {
  for (const file of files) {
    if (!file.path.endsWith(".ts")) continue;
    file.content = file.content.replace(
      /^(\s*(?:readonly\s+)?(?:[A-Za-z_$][\w$]*|"[^"\n]+"|'[^'\n]+')\?): ([^;\n]+);$/gm,
      (line, property: string, type: string) =>
        type.includes("undefined") ? line : `${property}: ${type} | undefined;`,
    );
  }
  return files;
}

function replacePinnedUpstreamOutput(
  content: string,
  expected: string,
  replacement: string,
  label: string,
): string {
  const first = content.indexOf(expected);
  if (first < 0 || first !== content.lastIndexOf(expected)) {
    throw new Error(
      `Unable to rewrite ${label} from @workos/oagen-emitters@${OAGEN_EMITTERS_VERSION}; expected exactly one ${JSON.stringify(expected)}.`,
    );
  }
  return content.replace(expected, replacement);
}

function exposeSignalflareClient(files: GeneratedFile[], context: EmitterContext): GeneratedFile[] {
  const options = optionsFor(context);
  const index = files.find((file) => file.path === "src/index.ts");
  if (!index) {
    throw new Error(
      `@workos/oagen-emitters@${OAGEN_EMITTERS_VERSION} did not emit the expected src/index.ts entrypoint.`,
    );
  }
  index.content = replacePinnedUpstreamOutput(
    index.content,
    "export type { WorkOSOptions } from './common/interfaces/workos-options.interface';",
    "export type { ClientOptions, Credential, CredentialContext, CredentialProvider } from './common/interfaces/workos-options.interface';",
    "the generated client options export",
  );
  index.content = replacePinnedUpstreamOutput(
    index.content,
    "export { WorkOS } from './workos';",
    `export { WorkOS as ${options.clientClassName} } from './workos';`,
    "the generated client class export",
  );
  if (!index.content.includes("operation-manifest")) {
    index.content += "\nexport { operationManifest } from './operation-manifest';\n";
  }
  if (options.effect) files.push(...generateEffectClient(files, options));
  files.push({
    path: "package.json",
    overwriteExisting: false,
    content: `${JSON.stringify(
      {
        name: options.packageName,
        version: options.sdkVersion,
        private: true,
        type: "module",
        exports: {
          ".": "./src/index.ts",
          ...(options.effect ? { "./effect": "./src/effect.ts" } : {}),
        },
        ...(options.effect
          ? {
              peerDependencies: { effect: options.effectVersion },
              peerDependenciesMeta: { effect: { optional: true } },
            }
          : {}),
      },
      null,
      2,
    )}\n`,
  });
  return makeExactOptionalCompatible(files);
}

function runtimeFiles(context: EmitterContext): GeneratedFile[] {
  const options = optionsFor(context);
  return [
    ...generateTypeScriptRuntime(options),
    ...(options.effect ? generateEffectRuntime(options) : []),
  ].map((file) => ({
    ...file,
    overwriteExisting: true,
  }));
}

function buildOperationsMap(context: EmitterContext): OperationsMap {
  const operations: OperationsMap = {};
  for (const resolved of context.resolvedOperations ?? []) {
    const key = `${resolved.operation.httpMethod.toUpperCase()} ${resolved.operation.path}`;
    const value = {
      sdkMethod: `${toPascalCase(resolved.mountOn)}.${toCamelCase(resolved.methodName)}`,
      service: toCamelCase(resolved.mountOn),
    };
    const existing = operations[key];
    if (existing === undefined) operations[key] = value;
    else operations[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return operations;
}

/**
 * Signalflare's greenfield TypeScript target. It delegates models, serializers,
 * resources, and compatibility behavior to the reviewed WorkOS Node emitter,
 * then supplies the runtime/auth files that the upstream emitter intentionally
 * keeps hand-owned in WorkOS SDKs.
 */
export const signalflareTypeScriptEmitter: Emitter = {
  language: "node",
  generateModels: (models, context) =>
    makeExactOptionalCompatible(
      preserveTypeScriptWireNames(nodeEmitter.generateModels(models, context), context),
    ),
  generateEnums: (enums, context) =>
    makeExactOptionalCompatible(nodeEmitter.generateEnums(enums, context)),
  generateResources: (services, context) => {
    const files = preserveTypeScriptWireNames(
      nodeEmitter.generateResources(services, context),
      context,
    );
    return makeExactOptionalCompatible([
      ...files,
      ...(optionsFor(context).effect ? generateEffectResources(files) : []),
    ]);
  },
  generateClient: (spec: ApiSpec, context) =>
    exposeSignalflareClient(nodeEmitter.generateClient(spec, context), context),
  generateErrors: (context) =>
    makeExactOptionalCompatible([...nodeEmitter.generateErrors(context), ...runtimeFiles(context)]),
  generateTypeSignatures: (spec, context) =>
    makeExactOptionalCompatible(nodeEmitter.generateTypeSignatures?.(spec, context) ?? []),
  generateTests: (spec, context) => {
    const ownedRuntimePaths = new Set(runtimeFiles(context).map((file) => file.path));
    return makeExactOptionalCompatible(
      nodeEmitter
        .generateTests(spec, context)
        .filter(
          (file) =>
            !ownedRuntimePaths.has(file.path) &&
            !/(?:\.effect\.ts$|^src\/effect(?:-client|-runtime)?\.ts$)/.test(file.path) &&
            file.path !== "package.json" &&
            file.path !== "EFFECT.md",
        ),
    );
  },
  buildOperationsMap: (_spec, context) => buildOperationsMap(context),
  fileHeader: () => nodeEmitter.fileHeader(),
  formatCommand: (targetDir) => nodeEmitter.formatCommand?.(targetDir) ?? null,
};

/**
 * Removes Oagen's heuristic pagination until the parser distinguishes explicit
 * contract pagination from field-name inference. See the removal checklist in
 * UPSTREAM.md#temporary-workaround-removal-checklist.
 */
export function stripAutomaticPagination(spec: ApiSpec): ApiSpec {
  return {
    ...spec,
    services: spec.services.map((service) => ({
      ...service,
      operations: service.operations.map((operation) => {
        if (operation.pagination === undefined) return operation;
        const { pagination: _pagination, ...withoutPagination } = operation;
        return withoutPagination;
      }),
    })),
  };
}

export type { AuthPlan };
