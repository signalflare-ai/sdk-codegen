import {
  toSnakeCase,
  type Emitter,
  type EmitterContext,
  type GeneratedFile,
  type Model,
} from "@workos/oagen";
import { rustEmitter } from "@workos/oagen-emitters";
import { OAGEN_EMITTERS_VERSION } from "../../version.js";
import { nativeRuntimeOptionsFor } from "../runtime-options.js";
import { generateRustRuntime } from "./runtime.js";

const RUST_RESERVED = new Set([
  "as",
  "break",
  "const",
  "continue",
  "crate",
  "else",
  "enum",
  "extern",
  "false",
  "fn",
  "for",
  "if",
  "impl",
  "in",
  "let",
  "loop",
  "match",
  "mod",
  "move",
  "mut",
  "pub",
  "ref",
  "return",
  "self",
  "Self",
  "static",
  "struct",
  "super",
  "trait",
  "true",
  "type",
  "unsafe",
  "use",
  "where",
  "while",
  "async",
  "await",
  "dyn",
]);

function rustFieldName(value: string): string {
  const snake = toSnakeCase(value);
  return RUST_RESERVED.has(snake) ? `${snake}_` : snake;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function preserveNullableStates(files: GeneratedFile[], models: Model[]): GeneratedFile[] {
  for (const model of models) {
    const nullableFields = model.fields.filter((field) => field.type.kind === "nullable");
    if (nullableFields.length === 0) continue;
    const suffix = `/src/models/${toSnakeCase(model.name)}.rs`;
    const file = files.find((candidate) => `/${candidate.path}`.endsWith(suffix));
    if (!file) continue;

    for (const field of nullableFields) {
      const name = rustFieldName(field.name);
      const pattern = new RegExp(
        `    #\\[serde\\(skip_serializing_if = "Option::is_none", default\\)\\]\\n    pub ${escapeRegExp(name)}: Option<([^\\n]+)>,`,
        "g",
      );
      const matches = [...file.content.matchAll(pattern)];
      if (matches.length !== 1) {
        throw new Error(
          `Unable to preserve Rust nullability for ${model.name}.${field.name} from @workos/oagen-emitters@${OAGEN_EMITTERS_VERSION}; expected one generated field, found ${matches.length}.`,
        );
      }
      file.content = file.content.replace(
        pattern,
        field.required
          ? `    pub ${name}: Option<$1>,`
          : `    #[serde(skip_serializing_if = "crate::OptionalNullable::is_missing", default)]\n    pub ${name}: crate::OptionalNullable<$1>,`,
      );
    }
  }
  return files;
}

function transformRustFiles(files: GeneratedFile[]): GeneratedFile[] {
  for (const file of files) {
    if (file.path.startsWith("tests/") && file.path.endsWith(".rs")) {
      file.content = `#![allow(clippy::expect_used)]\n\n${file.content}`;
    }
    if (file.path === "src/models/mod.rs") {
      file.content = file.content.replace(
        "pub use _unions::*;",
        "#[allow(unused_imports)]\npub use _unions::*;",
      );
    }
    if (
      file.path.startsWith("src/resources/") &&
      !file.content.includes("#[derive(") &&
      file.content.includes("use serde::Serialize;")
    ) {
      file.content = file.content.replace("use serde::Serialize;\n", "");
    }
    if (file.path === "tests/common/mod.rs") {
      const expected = `        .api_key("test_api_key")
        .base_url(server.uri())
        .max_retries(0)
        .build()`;
      const replacement = `        .token("test_token")
        .api_key("test_api_key")
        .base_url(server.uri())
        .max_retries(0)
        .build()
        .expect("build generated test client")`;
      const first = file.content.indexOf(expected);
      if (first < 0 || first !== file.content.lastIndexOf(expected)) {
        throw new Error(
          `Unable to rewrite Rust generated test client from @workos/oagen-emitters@${OAGEN_EMITTERS_VERSION}; expected one match.`,
        );
      }
      file.content = file.content.replace(expected, replacement);
    }
  }
  return files;
}

function runtimeFiles(context: EmitterContext): GeneratedFile[] {
  const files = generateRustRuntime(
    nativeRuntimeOptionsFor(context.emitterOptions, "Rust"),
    context.namespace.replaceAll(/[-_]/g, "").toLowerCase(),
  );
  const services = new Set(context.spec.services.map((service) => toSnakeCase(service.name)));
  // A service named Auth or Query shares a public module with a runtime kernel.
  // Preserve Oagen's service facade as a re-export rather than hiding its Params.
  for (const file of files) {
    const module = file.path.match(/^src\/(\w+)\.rs$/)?.[1];
    if (module && services.has(module))
      file.content += `\n// Preserve the generated service facade alongside the runtime kernel.\npub use crate::resources::${module}::*;\n`;
  }
  return files;
}

/** Standalone Rust wrapper over Oagen's generated models/resources/tests. */
export const signalflareRustEmitter: Emitter = {
  language: "rust",
  generateModels: (models, context) =>
    transformRustFiles(preserveNullableStates(rustEmitter.generateModels(models, context), models)),
  generateEnums: (enums, context) => transformRustFiles(rustEmitter.generateEnums(enums, context)),
  generateResources: (services, context) =>
    transformRustFiles(rustEmitter.generateResources(services, context)),
  generateClient: (spec, context) => transformRustFiles(rustEmitter.generateClient(spec, context)),
  generateErrors: (context) => runtimeFiles(context),
  generateTypeSignatures: (spec, context) =>
    transformRustFiles(rustEmitter.generateTypeSignatures?.(spec, context) ?? []),
  generateTests: (spec, context) => {
    const owned = new Set(runtimeFiles(context).map((file) => file.path));
    return transformRustFiles(
      rustEmitter.generateTests(spec, context).filter((file) => !owned.has(file.path)),
    );
  },
  buildOperationsMap: (spec, context) => rustEmitter.buildOperationsMap?.(spec, context) ?? {},
  fileHeader: () => rustEmitter.fileHeader(),
  formatCommand: (targetDirectory) => rustEmitter.formatCommand?.(targetDirectory) ?? null,
};
