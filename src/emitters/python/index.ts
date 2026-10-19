import type { Emitter, EmitterContext, GeneratedFile } from "@workos/oagen";
import { pythonEmitter } from "@workos/oagen-emitters";
import { OAGEN_EMITTERS_VERSION } from "../../version.js";
import { nativeRuntimeOptionsFor } from "../runtime-options.js";
import { generatePythonRuntime } from "./runtime.js";

function replaceExactly(
  content: string,
  expected: string,
  replacement: string,
  label: string,
): string {
  const first = content.indexOf(expected);
  if (first < 0 || first !== content.lastIndexOf(expected)) {
    throw new Error(
      `Unable to rewrite ${label} from @workos/oagen-emitters@${OAGEN_EMITTERS_VERSION}; expected exactly one match.`,
    );
  }
  return content.replace(expected, replacement);
}

function preserveRequiredNullableBodyFields(content: string, context: EmitterContext): string {
  const requiredNullableNames = context.spec.models.flatMap((model) =>
    model.fields
      .filter((field) => field.required && field.type.kind === "nullable")
      .map((field) => field.name),
  );
  if (requiredNullableNames.length === 0) return content;
  return content.replace(
    /body: Dict\[str, Any\] = \{k: v for k, v in \{[\s\S]*?\}\.items\(\) if v is not None\}/g,
    (block) => {
      const names = requiredNullableNames.filter((name) =>
        block.includes(`${JSON.stringify(name)}:`),
      );
      if (names.length === 0) return block;
      const requiredKeys = `{${names.map((name) => JSON.stringify(name)).join(", ")}}`;
      return block.replace(
        "}.items() if v is not None}",
        `}.items() if v is not None or k in ${requiredKeys}}`,
      );
    },
  );
}

function alignPythonGeneratedQueryAssertions(content: string): string {
  return content.replace(
    /(assert request\.url\.params\[[^\n]+\] == )(-?\d+(?:\.\d+)?|True|False)$/gm,
    (_match, prefix: string, value: string) =>
      `${prefix}${JSON.stringify(value === "True" ? "true" : value === "False" ? "false" : value)}`,
  );
}

function transformPythonFiles(files: GeneratedFile[], context: EmitterContext): GeneratedFile[] {
  const options = nativeRuntimeOptionsFor(context.emitterOptions, "Python");
  for (const file of files) {
    if (!file.path.endsWith(".py")) continue;
    let content = file.content;
    if (file.path.endsWith("/_client.py")) {
      for (const importLine of [
        "from .passwordless import AsyncPasswordless, Passwordless\n",
        "from .actions import Actions, AsyncActions\n",
        "from .pkce import PKCE\n",
      ]) {
        content = replaceExactly(
          content,
          importLine,
          "",
          `Python non-spec import ${importLine.trim()}`,
        );
      }
      const blockPattern =
        /\n    # @oagen-ignore-start — non-spec service accessors \(hand-maintained\)[\s\S]*?\n    # @oagen-ignore-end/g;
      const blocks = content.match(blockPattern) ?? [];
      if (blocks.length !== 2) {
        throw new Error(
          `Unable to remove Python non-spec accessors from @workos/oagen-emitters@${OAGEN_EMITTERS_VERSION}; expected two blocks, found ${blocks.length}.`,
        );
      }
      content = content.replace(blockPattern, "");
    }
    content = content
      .replaceAll(
        "AuthenticationError: If the API key is invalid (401).",
        "AuthenticationError: If authentication is missing, invalid, or expired (401).",
      )
      .replaceAll("AsyncWorkOSClient", `Async${options.clientClassName}`)
      .replaceAll("WorkOSClient", options.clientClassName)
      .replaceAll("WorkOSError", "SignalflareError")
      .replaceAll("WorkOS API", `${options.productDisplayName} API`);
    if (file.path.startsWith("tests/") && file.path.endsWith(".py")) {
      content = alignPythonGeneratedQueryAssertions(content)
        .replaceAll(
          `${options.clientClassName}(api_key="sk_test_123"`,
          `${options.clientClassName}(token="sk_test_123", api_key="sk_test_123"`,
        )
        .replaceAll(
          `Async${options.clientClassName}(api_key="sk_test_123"`,
          `Async${options.clientClassName}(token="sk_test_123", api_key="sk_test_123"`,
        );
    }
    // Pinned Oagen models do not escape Python keyword field identifiers.
    // Preserve JSON keys while using conventional trailing-underscore attributes.
    const keywords = [
      "False",
      "None",
      "True",
      "and",
      "as",
      "assert",
      "async",
      "await",
      "break",
      "class",
      "continue",
      "def",
      "del",
      "elif",
      "else",
      "except",
      "finally",
      "for",
      "from",
      "global",
      "if",
      "import",
      "in",
      "is",
      "lambda",
      "nonlocal",
      "not",
      "or",
      "pass",
      "raise",
      "return",
      "try",
      "while",
      "with",
      "yield",
    ];
    const keywordFields = new Set(
      context.spec.models.flatMap((model) =>
        model.fields.filter((field) => keywords.includes(field.name)).map((field) => field.name),
      ),
    );
    for (const name of keywordFields) {
      content = content
        .replace(new RegExp(`^(\\s*)${name}(?=\\s*[:=])`, "gm"), `$1${name}_`)
        .replace(new RegExp(`\\.${name}\\b`, "g"), `.${name}_`);
    }
    file.content = preserveRequiredNullableBodyFields(content, context);
  }
  return files;
}

function runtimeFiles(context: EmitterContext): GeneratedFile[] {
  const options = nativeRuntimeOptionsFor(context.emitterOptions, "Python");
  return generatePythonRuntime(options, context.namespace);
}

/** Standalone Python wrapper over Oagen's generated models/resources/tests. */
export const signalflarePythonEmitter: Emitter = {
  language: "python",
  generateModels: (models, context) =>
    transformPythonFiles(pythonEmitter.generateModels(models, context), context),
  generateEnums: (enums, context) =>
    transformPythonFiles(pythonEmitter.generateEnums(enums, context), context),
  generateResources: (services, context) =>
    transformPythonFiles(pythonEmitter.generateResources(services, context), context),
  generateClient: (spec, context) =>
    transformPythonFiles(pythonEmitter.generateClient(spec, context), context),
  generateErrors: (context) => runtimeFiles(context),
  generateTypeSignatures: (spec, context) =>
    transformPythonFiles(pythonEmitter.generateTypeSignatures?.(spec, context) ?? [], context),
  generateTests: (spec, context) => {
    const owned = new Set(runtimeFiles(context).map((file) => file.path));
    return transformPythonFiles(
      pythonEmitter.generateTests(spec, context).filter((file) => !owned.has(file.path)),
      context,
    );
  },
  buildOperationsMap: (spec, context) => pythonEmitter.buildOperationsMap?.(spec, context) ?? {},
  fileHeader: () => pythonEmitter.fileHeader(),
  formatCommand: (targetDirectory) => pythonEmitter.formatCommand?.(targetDirectory) ?? null,
};
