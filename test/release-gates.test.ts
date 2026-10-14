import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { Effect } from "effect";
import {
  CompilerLive,
  compareCompatibilitySnapshots,
  generateConfiguredSdks,
  loadCompatibilitySnapshot,
  validateSdkConfig,
  type GenerateSdkOptions,
  type OpenApiDocument,
} from "../src/index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function setup(allTargets = false) {
  await mkdir(".tmp", { recursive: true });
  const directory = await mkdtemp(resolve(".tmp/release-gates-test-"));
  directories.push(directory);
  const spec = join(directory, "contract.json");
  const output = join(directory, "typescript");
  const document = JSON.parse(
    await readFile("fixtures/contracts/runtime-conformance.openapi.json", "utf8"),
  ) as OpenApiDocument;
  await writeFile(spec, JSON.stringify(document));
  const configPath = join(directory, "sdk.config.ts");
  await writeFile(
    configPath,
    `export default ${JSON.stringify({
      product: {
        id: "runtime-conformance",
        displayName: "Runtime Conformance",
        sdkVersion: "2.3.4",
      },
      contract: { spec },
      profiles: { access: { includeAudiences: ["access"] } },
      targets: {
        typescript: {
          output,
          packageName: "@signalflare-ai/runtime-conformance",
          profiles: ["access"],
          effect: true,
        },
        ...(allTargets
          ? {
              python: {
                output: join(directory, "python"),
                packageName: "runtime-conformance",
                profiles: ["access"],
                sdkVersion: "3.0.0",
              },
              go: {
                output: join(directory, "go"),
                module: "example.com/runtime-conformance",
                profiles: ["access"],
              },
              rust: {
                output: join(directory, "rust"),
                crateName: "runtime-conformance",
                profiles: ["access"],
              },
            }
          : {}),
      },
    })};\n`,
  );
  const run = (options: GenerateSdkOptions = {}) =>
    Effect.runPromise(
      generateConfiguredSdks({ configPath, quiet: true, ...options }).pipe(
        Effect.provide(CompilerLive),
      ),
    );
  return { directory, output, spec, document, run, configPath };
}

describe("release safety gates", () => {
  test("check is repeatable and read-only; preserves hand-owned files", async () => {
    const { output, run } = await setup();
    await run();
    expect((await run({ check: true })).targets[0]?.drift).toEqual([]);
    const snapshot = await readFile(join(output, ".signalflare-compat.json"), "utf8");
    await run();
    expect(await readFile(join(output, ".signalflare-compat.json"), "utf8")).toBe(snapshot);
    await writeFile(join(output, "package.json"), '{"name":"product-owned","version":"9.0.0"}\n');
    await writeFile(join(output, "custom.ts"), "export const custom = true;\n");
    expect((await run({ check: true })).targets[0]?.drift).toEqual([]);
    const path = join(output, "src/operation-manifest.ts");
    await writeFile(path, "broken\n");
    const result = await run({ check: true });
    expect(result.targets[0]?.drift).toContainEqual({
      path: "src/operation-manifest.ts",
      kind: "changed",
    });
    expect(await readFile(path, "utf8")).toBe("broken\n");
    await run();
    expect(await readFile(join(output, "package.json"), "utf8")).toContain("product-owned");
  });

  test("check finds missing and stale generator-owned files without deleting them", async () => {
    const { output, run } = await setup();
    await run();
    await rm(join(output, "src/operation-manifest.ts"));
    const manifestPath = join(output, ".oagen-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { files: string[] };
    manifest.files.push("src/stale.ts");
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(join(output, "src/stale.ts"), "old\n");
    const result = await run({ check: true });
    expect(result.targets[0]?.drift).toContainEqual({
      path: "src/operation-manifest.ts",
      kind: "missing",
    });
    expect(result.targets[0]?.drift).toContainEqual({ path: "src/stale.ts", kind: "stale" });
    expect(await readFile(join(output, "src/stale.ts"), "utf8")).toBe("old\n");
  });

  test("versions are product-owned and every language captures a compatibility baseline", async () => {
    const { directory, run } = await setup(true);
    await run();
    for (const target of ["typescript", "python", "go", "rust"] as const) {
      const snapshot = await Effect.runPromise(
        loadCompatibilitySnapshot(join(directory, target, ".signalflare-compat.json")).pipe(
          Effect.provide(CompilerLive),
        ),
      );
      expect(snapshot.sdkVersion).toBe(target === "python" ? "3.0.0" : "2.3.4");
      expect(
        Object.values(snapshot.surfaces).every((surface) => surface.snapshot.symbols.length > 0),
      ).toBe(true);
    }
    const result = await run({ baseline: relative(process.cwd(), directory) });
    expect(result.targets.map((target) => target.compatibility?.compatible)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    await run();
    expect(await readFile(join(directory, "python/pyproject.toml"), "utf8")).toContain(
      'version = "3.0.0"',
    );
    expect(await readFile(join(directory, "rust/Cargo.toml"), "utf8")).toContain(
      'version = "2.3.4"',
    );
  }, 20000);

  test("version policy rejects malformed versions and non-v4 Effect", () => {
    for (const version of ["1", "01.2.3", "1.2.3-beta.01", "latest"]) {
      const report = validateSdkConfig({
        product: { id: "test", displayName: "Test", sdkVersion: version },
      });
      expect(
        report.diagnostics.some((diagnostic) => diagnostic.code === "config.version.invalid"),
      ).toBe(true);
    }
    const report = validateSdkConfig({ targets: { typescript: { effectVersion: "3.0.0" } } });
    expect(
      report.diagnostics.some(
        (diagnostic) => diagnostic.code === "config.effect-version.unsupported",
      ),
    ).toBe(true);
  });

  test("wire gate retains auth, routing and constraints missing from upstream IR; alias changes are gated", async () => {
    const { output, directory, run } = await setup();
    await run();
    const baseline = await Effect.runPromise(
      loadCompatibilitySnapshot(join(output, ".signalflare-compat.json")).pipe(
        Effect.provide(CompilerLive),
      ),
    );
    const candidate = structuredClone(baseline);
    const paths = candidate.contract.paths as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const operation = paths["/widgets/{widget_id}"]?.get;
    if (!operation) throw new Error("fixture operation missing");
    operation.security = [{ HeaderKey: [] }];
    paths["/renamed/{widget_id}"] = paths["/widgets/{widget_id}"] ?? {};
    delete paths["/widgets/{widget_id}"];
    const schemas = candidate.contract.components as {
      schemas: Record<string, { properties: Record<string, Record<string, unknown>> }>;
    };
    const name = schemas.schemas.Widget?.properties.name;
    if (!name) throw new Error("fixture schema missing");
    name.maxLength = 50;
    const effect = candidate.surfaces.effect;
    if (!effect) throw new Error("effect snapshot missing");
    effect.aliases.SdkError = "SdkApiError";
    const report = await Effect.runPromise(
      compareCompatibilitySnapshots(baseline, candidate, directory).pipe(
        Effect.provide(CompilerLive),
      ),
    );
    expect(report.compatible).toBe(false);
    expect(report.findings.map((finding) => finding.id)).toContain("wire.getWidget.route");
    expect(report.findings.map((finding) => finding.id)).toContain("wire.getWidget.security");
    expect(report.findings.some((finding) => finding.id.endsWith("/maxLength"))).toBe(true);
    expect(report.findings.map((finding) => finding.id)).toContain("sdk.effect.alias.SdkError");
  });

  test("compat detects wire/auth and separate Promise/Effect public-surface changes", async () => {
    const { directory, output, document, spec, run } = await setup(true);
    await run();
    expect((await run({ baseline: directory })).targets[0]?.compatibility?.compatible).toBe(true);
    const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>;
    const operation = paths["/widgets/{widget_id}"]?.get;
    if (!operation) throw new Error("missing fixture operation");
    operation.operationId = "findWidget";
    operation.security = [{ HeaderKey: [] }];
    await writeFile(spec, JSON.stringify(document));
    const result = await run({ baseline: directory });
    const report = result.targets[0]?.compatibility;
    expect(report?.compatible).toBe(false);
    expect(report?.surfaces.promise?.summary.breaking).toBeGreaterThan(0);
    expect(report?.surfaces.effect?.summary.breaking).toBeGreaterThan(0);
    expect(report?.wire.summary.breaking).toBeGreaterThan(0);
    for (const target of result.targets.slice(1)) {
      expect(target.compatibility?.compatible).toBe(false);
      expect(target.compatibility?.surfaces[target.target]?.summary.breaking).toBeGreaterThan(0);
    }
    expect(await readFile(join(output, "src/operation-manifest.ts"), "utf8")).toContain(
      "getWidget",
    );
  });

  test("CLI check exits nonzero for drift and compat requires an explicit baseline", async () => {
    const { configPath, output, run } = await setup();
    await run();
    const spawn = async (args: string[]) => {
      const child = Bun.spawn(["bun", "src/cli/index.ts", ...args], {
        stdout: "pipe",
        stderr: "pipe",
      });
      // Drain both pipes while the CLI runs so verbose output cannot block exit.
      const [exit, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { exit, stdout, stderr };
    };
    const clean = await spawn(["check", "--config", configPath, "--json"]);
    expect(clean.exit).toBe(0);
    expect(JSON.parse(clean.stdout).command).toBe("check");
    await writeFile(join(output, "src/operation-manifest.ts"), "drift\n");
    expect((await spawn(["check", "--config", configPath, "--json"])).exit).toBe(1);
    expect((await spawn(["compat", "--config", configPath])).exit).toBe(2);
    // Includes generation plus three cold CLI processes on shared CI runners.
  }, 20000);
});
