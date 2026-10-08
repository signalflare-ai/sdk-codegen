import { join, posix } from "node:path";
import type { GeneratedFile } from "@workos/oagen";
import { Effect, FileSystem, Schema } from "effect";
import { GenerationError } from "../core/errors.js";

export interface GenerationDrift {
  path: string;
  kind: "missing" | "changed" | "stale";
}

/** Only generator-owned files are compared; package manifests and other hand-owned files are preserved. */
export const checkGeneratedFiles = Effect.fn("SdkGenerator.checkFiles")(function* (
  output: string,
  files: readonly GeneratedFile[],
) {
  const fs = yield* FileSystem.FileSystem;
  const drift: GenerationDrift[] = [];
  const expected = new Set(files.map((file) => posix.normalize(file.path)));
  const io = (cause: unknown) =>
    new GenerationError({ message: "Unable to check generated SDK files.", cause });
  for (const file of files) {
    const path = join(output, file.path);
    if (!(yield* fs.exists(path).pipe(Effect.mapError(io)))) {
      drift.push({ path: file.path, kind: "missing" });
    } else if (file.overwriteExisting !== false && file.content.length > 0) {
      const current = yield* fs.readFileString(path).pipe(Effect.mapError(io));
      if (current !== file.content) drift.push({ path: file.path, kind: "changed" });
    }
  }
  const manifestPath = join(output, ".oagen-manifest.json");
  if (yield* fs.exists(manifestPath).pipe(Effect.mapError(io))) {
    const raw = yield* fs.readFileString(manifestPath).pipe(Effect.mapError(io));
    const manifest = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.JsonObject))(
      raw,
    ).pipe(Effect.mapError(io));
    const owned = manifest.files;
    if (Array.isArray(owned)) {
      for (const entry of owned) {
        const path =
          typeof entry === "string"
            ? entry
            : entry !== null && typeof entry === "object" && "path" in entry
              ? entry.path
              : undefined;
        if (
          typeof path === "string" &&
          (posix.isAbsolute(path) || posix.normalize(path).startsWith("../"))
        )
          return yield* new GenerationError({
            message: "Ownership manifest contains an unsafe file path.",
          });
        if (
          typeof path === "string" &&
          !expected.has(posix.normalize(path)) &&
          (yield* fs.exists(join(output, path)).pipe(Effect.mapError(io)))
        ) {
          drift.push({ path, kind: "stale" });
        }
      }
    }
  } else {
    drift.push({ path: ".oagen-manifest.json", kind: "missing" });
  }
  return drift.sort((a, b) => a.path.localeCompare(b.path));
});
