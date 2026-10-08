import { toPascalCase, type Emitter, type EmitterContext, type GeneratedFile } from "@workos/oagen";
import { goEmitter } from "@workos/oagen-emitters";
import { OAGEN_EMITTERS_VERSION } from "../../version.js";
import { nativeRuntimeOptionsFor } from "../runtime-options.js";
import { generateGoRuntime } from "./runtime.js";

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

function transformGeneratedClient(content: string, displayName: string): string {
  content = replaceExactly(
    content,
    "\tapiKey       string\n\tclientID     string\n\tbaseURL      string\n\thttpClient   *http.Client\n\tmaxRetries   int\n\tlogger       Logger\n\tappInfo      appInfo\n",
    "\ttoken               string\n\tapiKey              string\n\tclientID            string\n\tbaseURL             string\n\thttpClient          *http.Client\n\tmaxRetries          int\n\tlogger              Logger\n\tappInfo             appInfo\n\theaders             http.Header\n\ttokenProvider       CredentialProvider\n\tapiKeyProvider      CredentialProvider\n\tcredentialProviders map[string]CredentialProvider\n",
    "Go Client runtime fields",
  );
  content = replaceExactly(
    content,
    "\tc := &Client{\n\t\tapiKey:     apiKey,\n\t\tbaseURL:    defaultBaseURL,\n\t\thttpClient: &http.Client{Timeout: defaultTimeout},\n\t\tmaxRetries: defaultMaxRetries,\n\t}",
    "\tc := &Client{\n\t\ttoken:               apiKey,\n\t\tapiKey:              apiKey,\n\t\tbaseURL:             defaultBaseURL,\n\t\thttpClient:          &http.Client{Timeout: defaultTimeout},\n\t\tmaxRetries:          defaultMaxRetries,\n\t\theaders:             make(http.Header),\n\t\ttokenProvider:       staticCredential(apiKey),\n\t\tapiKeyProvider:      staticCredential(apiKey),\n\t\tcredentialProviders: make(map[string]CredentialProvider),\n\t}",
    "Go Client initialization",
  );

  for (const [pattern, label] of [
    [/^\s*passwordless\s+\*PasswordlessService\n/m, "Go passwordless field"],
    [
      /^\s*c\.passwordless = &PasswordlessService\{client: c\}\n/m,
      "Go passwordless initialization",
    ],
  ] as const) {
    const matches = content.match(pattern);
    if (!matches || matches.length !== 1) {
      throw new Error(
        `Unable to rewrite ${label} from @workos/oagen-emitters@${OAGEN_EMITTERS_VERSION}; expected exactly one match.`,
      );
    }
    content = content.replace(pattern, "");
  }
  const accessor = `// Passwordless returns the Passwordless service.
func (c *Client) Passwordless() *PasswordlessService {
\treturn c.passwordless
}
`;
  content = replaceExactly(content, accessor, "", "Go passwordless accessor");
  return content.replaceAll("WorkOS API", `${displayName} API`);
}

function goFieldName(value: string): string {
  return toPascalCase(value)
    .replace(/Ids(?=[A-Z]|$)/g, "IDs")
    .replace(/Id(?=[A-Z]|$)/g, "ID")
    .replace(/Uuid(?=[A-Z]|$)/g, "UUID")
    .replace(/Url(?=[A-Z]|$)/g, "URL")
    .replace(/Api(?=[A-Z]|$)/g, "API");
}

function alignGoGeneratedTestFixtures(content: string, context: EmitterContext): string {
  for (const model of context.spec.models) {
    for (const field of model.fields) {
      if (field.type.kind !== "primitive" || field.type.type !== "string") continue;
      const fieldName = goFieldName(field.domainName ?? field.name);
      if (field.type.format === "uuid") {
        content = content.replace(
          new RegExp(`"[^"]*01234", result\\.${fieldName}\\)`, "g"),
          `"00000000-0000-0000-0000-000000000000", result.${fieldName})`,
        );
      } else if (field.type.format === "date-time") {
        content = content.replaceAll(
          `"test_${field.name}", result.${fieldName})`,
          `"2023-01-01T00:00:00.000Z", result.${fieldName})`,
        );
      } else if (field.type.format === "date") {
        content = content.replaceAll(
          `"test_${field.name}", result.${fieldName})`,
          `"2023-01-01", result.${fieldName})`,
        );
      }
    }
  }
  return content;
}

function transformGoFiles(files: GeneratedFile[], context: EmitterContext): GeneratedFile[] {
  const options = nativeRuntimeOptionsFor(context.emitterOptions, "Go");
  for (const file of files) {
    if (!file.path.endsWith(".go")) continue;
    if (file.path.endsWith("_test.go")) {
      file.content = alignGoGeneratedTestFixtures(
        file.content.replaceAll(
          '"github.com/workos/workos-go/v6"',
          JSON.stringify(options.packageName),
        ),
        context,
      );
    }
  }
  return files;
}

function transformGoClient(files: GeneratedFile[], context: EmitterContext): GeneratedFile[] {
  const options = nativeRuntimeOptionsFor(context.emitterOptions, "Go");
  if (files.length !== 1) {
    throw new Error(
      `Unable to identify the Go client from @workos/oagen-emitters@${OAGEN_EMITTERS_VERSION}; expected exactly one file.`,
    );
  }
  const [file] = files;
  if (file === undefined) return files;
  file.path = `${context.namespace}_client.go`;
  file.content = transformGeneratedClient(file.content, options.productDisplayName);
  return files;
}

function runtimeFiles(context: EmitterContext): GeneratedFile[] {
  return generateGoRuntime(
    nativeRuntimeOptionsFor(context.emitterOptions, "Go"),
    context.namespace,
  );
}

/** Standalone Go wrapper over Oagen's generated models/resources/tests. */
export const signalflareGoEmitter: Emitter = {
  language: "go",
  generateModels: (models, context) =>
    transformGoFiles(goEmitter.generateModels(models, context), context),
  generateEnums: (enums, context) =>
    transformGoFiles(goEmitter.generateEnums(enums, context), context),
  generateResources: (services, context) => {
    const owned = new Set(runtimeFiles(context).map((file) => file.path));
    return transformGoFiles(
      goEmitter
        .generateResources(services, context)
        .map((file) => (owned.has(file.path) ? { ...file, path: `resources_${file.path}` } : file)),
      context,
    );
  },
  generateClient: (spec, context) =>
    transformGoClient(goEmitter.generateClient(spec, context), context),
  generateErrors: (context) => runtimeFiles(context),
  generateTypeSignatures: (spec, context) =>
    transformGoFiles(goEmitter.generateTypeSignatures?.(spec, context) ?? [], context),
  generateTests: (spec, context) => {
    const owned = new Set(runtimeFiles(context).map((file) => file.path));
    return transformGoFiles(
      goEmitter.generateTests(spec, context).filter((file) => !owned.has(file.path)),
      context,
    );
  },
  buildOperationsMap: (spec, context) => goEmitter.buildOperationsMap?.(spec, context) ?? {},
  fileHeader: () => goEmitter.fileHeader(),
  formatCommand: (targetDirectory) => goEmitter.formatCommand?.(targetDirectory) ?? null,
};
