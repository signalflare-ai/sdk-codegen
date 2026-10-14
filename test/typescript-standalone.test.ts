import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import contract from "../fixtures/contracts/typescript-standalone.openapi.json" with { type: "json" };
import { CompilerLive, generateConfiguredSdks, type GenerateSdkOptions } from "../src/index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function setup(errorEnum = true) {
  await mkdir(".tmp", { recursive: true });
  const directory = await mkdtemp(resolve(".tmp/typescript-standalone-"));
  directories.push(directory);
  const spec = join(directory, "contract.json");
  const document = structuredClone(contract);
  if (!errorEnum) {
    // Isolate the repeat-generation regression from the fresh shared-enum failure.
    const { enum: _values, ...code } = document.components.schemas.Failure.properties.code;
    await writeFile(
      spec,
      JSON.stringify({
        ...document,
        components: {
          ...document.components,
          schemas: {
            ...document.components.schemas,
            Failure: {
              ...document.components.schemas.Failure,
              properties: {
                ...document.components.schemas.Failure.properties,
                code,
              },
            },
          },
        },
      }),
    );
  } else await writeFile(spec, JSON.stringify(document));
  const output = join(directory, "typescript");
  const configPath = join(directory, "sdk.config.ts");
  await writeFile(
    configPath,
    `export default ${JSON.stringify({
      product: { id: "standalone", displayName: "Standalone", sdkVersion: "1.0.0" },
      contract: { spec },
      profiles: { access: { includeAudiences: ["access"] } },
      targets: {
        typescript: {
          output,
          packageName: "@signalflare-ai/standalone",
          profiles: ["access"],
          effect: true,
        },
      },
    })};\n`,
  );
  const run = (options: GenerateSdkOptions = {}) =>
    Effect.runPromise(
      generateConfiguredSdks({ configPath, quiet: true, ...options }).pipe(
        Effect.provide(CompilerLive),
      ),
    );
  return { output, run, spec };
}

async function compile(output: string) {
  const child = Bun.spawn(
    [
      "bunx",
      "tsc",
      "--ignoreConfig",
      "--noEmit",
      "--strict",
      "--exactOptionalPropertyTypes",
      "--noUncheckedIndexedAccess",
      "--skipLibCheck",
      "--target",
      "ES2023",
      "--lib",
      "ES2023,DOM,DOM.Iterable",
      "--module",
      "ESNext",
      "--moduleResolution",
      "Bundler",
      join(output, "src/index.ts"),
      join(output, "src/effect.ts"),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [exit, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(stdout + stderr).toBe("");
  expect(exit).toBe(0);
}

async function contents(output: string, files: readonly string[]) {
  return Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [file, await readFile(join(output, file), "utf8")]),
    ),
  );
}

interface CatalogClient<Result> {
  catalog: { catalogCommits(): Result; catalogLineage(): Result };
}

async function verifyWire(output: string) {
  const promise = (await import(pathToFileURL(join(output, "src/index.ts")).href)) as {
    StandaloneClient: new (options: Record<string, unknown>) => CatalogClient<Promise<unknown>>;
  };
  const effect = (await import(pathToFileURL(join(output, "src/effect.ts")).href)) as {
    StandaloneEffectClient: new (
      options: Record<string, unknown>,
    ) => CatalogClient<Effect.Effect<unknown, unknown>>;
  };
  const commits = {
    commits: [{ commitId: "commit-1", table: { schema: "raw", table: "orders" } }],
  };
  const lineage = { table: { schema: "raw", table: "orders" }, lineage: ["source-1"] };
  const calls: string[] = [];
  const fetch = async (url: URL, init: RequestInit) => {
    calls.push(url.pathname);
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer token");
    return Response.json(url.pathname === "/v1/catalog/commits" ? commits : lineage);
  };
  const options = { token: "token", fetch };
  const client = new promise.StandaloneClient(options);
  expect(await client.catalog.catalogCommits()).toEqual(commits);
  expect(await client.catalog.catalogLineage()).toEqual(lineage);
  const effectClient = new effect.StandaloneEffectClient(options);
  expect(await Effect.runPromise(effectClient.catalog.catalogCommits())).toEqual(commits);
  expect(await Effect.runPromise(effectClient.catalog.catalogLineage())).toEqual(lineage);
  expect(calls).toEqual([
    "/v1/catalog/commits",
    "/v1/catalog/lineage",
    "/v1/catalog/commits",
    "/v1/catalog/lineage",
  ]);
}

describe("standalone TypeScript emitter context", () => {
  test("prunes removed contract models without adopting stale generated files", async () => {
    const { output, run, spec } = await setup();
    await run();
    const removedModel = join(output, "src/catalog/interfaces/lineage-response.interface.ts");
    expect(await Bun.file(removedModel).exists()).toBe(true);
    await writeFile(
      spec,
      JSON.stringify({
        ...contract,
        paths: { "/v1/catalog/commits": contract.paths["/v1/catalog/commits"] },
      }),
    );
    const report = await run();
    expect(report.targets[0]?.operations).toBe(1);
    expect(await Bun.file(removedModel).exists()).toBe(false);
    await compile(output);
    expect((await run({ check: true })).targets[0]?.drift).toEqual([]);
  }, 20000);

  test("emits error-only shared enums on the first run", async () => {
    const { output, run } = await setup();
    const report = await run();
    expect(report.targets[0]?.files).toContain("src/common/interfaces/failure-code.interface.ts");
    expect(
      await readFile(join(output, "src/common/interfaces/failure-code.interface.ts"), "utf8"),
    ).toContain("INVALID_QUERY");
    await compile(output);
    await verifyWire(output);
  }, 20000);

  test("repeated generation stays byte-identical and preserves product-owned files", async () => {
    const { output, run } = await setup(false);
    const first = await run();
    await compile(output);
    const packagePath = join(output, "package.json");
    const ownedPackage = (await readFile(packagePath, "utf8")).replace(
      '"version": "1.0.0"',
      '"version": "9.0.0"',
    );
    await writeFile(packagePath, ownedPackage);
    const customPath = join(output, "src/product-helper.ts");
    await writeFile(customPath, "export const productOwned = true;\n");
    const files = first.targets[0]?.files ?? [];
    expect(files.length).toBeGreaterThan(0);
    const baseline = await contents(output, files);
    for (let iteration = 0; iteration < 2; iteration++) {
      const report = await run();
      expect(report.targets[0]?.files).toEqual(files);
      await compile(output);
      const current = await contents(output, files);
      expect(files.filter((file) => current[file] !== baseline[file])).toEqual([]);
      expect((await run({ check: true })).targets[0]?.drift).toEqual([]);
      expect(await readFile(packagePath, "utf8")).toBe(ownedPackage);
      expect(await readFile(customPath, "utf8")).toBe("export const productOwned = true;\n");
    }
    await verifyWire(output);
  }, 30000);
});
