import { toKebabCase, toSnakeCase, type EmitterContext, type GeneratedFile } from "@workos/oagen";

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Oagen's Node emitter assumes WorkOS snake_case wire names. Restore exact OpenAPI
 * names only in wire declarations/accesses; never rename domain fields or dictionary keys.
 */
export function preserveTypeScriptWireNames(
  files: GeneratedFile[],
  context: EmitterContext,
): GeneratedFile[] {
  for (const file of files) {
    for (const model of context.spec.models) {
      const basename = toKebabCase(model.name);
      if (
        !file.path.endsWith(`/${basename}.interface.ts`) &&
        !file.path.endsWith(`/${basename}.serializer.ts`)
      )
        continue;
      const replacements = model.fields.filter((field) => toSnakeCase(field.name) !== field.name);
      if (replacements.length === 0) continue;
      for (const field of replacements) {
        const wire = escapePattern(toSnakeCase(field.name));
        if (file.path.endsWith(".serializer.ts")) {
          file.content = file.content
            .replace(
              new RegExp(`\\bresponse\\.${wire}\\b`, "g"),
              `response[${JSON.stringify(field.name)}]`,
            )
            .replace(
              new RegExp(`^(\\s*)${wire}(\\??):`, "gm"),
              `$1${JSON.stringify(field.name)}$2:`,
            );
        } else {
          file.content = file.content.replace(
            /(export interface \w+(?:Response|Wire)\s*\{)([\s\S]*?)(^\})/gm,
            (_match, start: string, body: string, end: string) =>
              start +
              body.replace(
                new RegExp(`^(\\s*)${wire}(\\??):`, "gm"),
                `$1${JSON.stringify(field.name)}$2:`,
              ) +
              end,
          );
        }
      }
    }
    // Query parameters are emitted directly in resources/options serializers.
    const parameters = context.spec.services.flatMap((service) =>
      service.operations.flatMap((operation) => operation.queryParams),
    );
    for (const parameter of parameters) {
      const wire = toSnakeCase(parameter.name);
      if (wire === parameter.name) continue;
      file.content = file.content.replace(
        new RegExp(`^(\\s*)${escapePattern(wire)}: (options\\.[^\\n]+)`, "gm"),
        `$1${JSON.stringify(parameter.name)}: $2`,
      );
    }
  }
  return files;
}
