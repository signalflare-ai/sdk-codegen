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
import { generateTypeScriptRuntime, type TypeScriptRuntimeOptions } from "./runtime.js";

export interface SignalflareTypeScriptEmitterOptions extends TypeScriptRuntimeOptions {
  [key: string]: unknown;
  clientClassName: string;
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
      /^(\s*(?:readonly\s+)?[A-Za-z_$][\w$]*\?): ([^;\n]+);$/gm,
      (line, property: string, type: string) =>
        type.includes("undefined") ? line : `${property}: ${type} | undefined;`,
    );
  }
  return files;
}

function exposeSignalflareClient(files: GeneratedFile[], context: EmitterContext): GeneratedFile[] {
  const options = optionsFor(context);
  for (const file of files) {
    if (file.path !== "src/index.ts") continue;
    file.content = file.content
      .replace(
        "export type { WorkOSOptions } from './common/interfaces/workos-options.interface';",
        "export type { ClientOptions, Credential, CredentialContext, CredentialProvider } from './common/interfaces/workos-options.interface';",
      )
      .replace(
        "export { WorkOS } from './workos';",
        `export { WorkOS as ${options.clientClassName} } from './workos';`,
      );
    if (!file.content.includes("operation-manifest")) {
      file.content += "\nexport { operationManifest } from './operation-manifest';\n";
    }
  }
  return makeExactOptionalCompatible(files);
}

function runtimeFiles(context: EmitterContext): GeneratedFile[] {
  return generateTypeScriptRuntime(optionsFor(context)).map((file) => ({
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
    makeExactOptionalCompatible(nodeEmitter.generateModels(models, context)),
  generateEnums: (enums, context) =>
    makeExactOptionalCompatible(nodeEmitter.generateEnums(enums, context)),
  generateResources: (services, context) =>
    makeExactOptionalCompatible(nodeEmitter.generateResources(services, context)),
  generateClient: (spec: ApiSpec, context) =>
    exposeSignalflareClient(nodeEmitter.generateClient(spec, context), context),
  generateErrors: (context) =>
    makeExactOptionalCompatible([...nodeEmitter.generateErrors(context), ...runtimeFiles(context)]),
  generateTypeSignatures: (spec, context) =>
    makeExactOptionalCompatible(nodeEmitter.generateTypeSignatures?.(spec, context) ?? []),
  generateTests: (spec, context) => {
    const ownedRuntimePaths = new Set(runtimeFiles(context).map((file) => file.path));
    return makeExactOptionalCompatible(
      nodeEmitter.generateTests(spec, context).filter((file) => !ownedRuntimePaths.has(file.path)),
    );
  },
  buildOperationsMap: (_spec, context) => buildOperationsMap(context),
  fileHeader: () => nodeEmitter.fileHeader(),
  formatCommand: (targetDir) => nodeEmitter.formatCommand?.(targetDir) ?? null,
};

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
