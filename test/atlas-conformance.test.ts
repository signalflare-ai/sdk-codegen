import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Result } from "effect";
import { CompilerLive, generateConfiguredSdks } from "../src/index.js";

let directory: string | undefined;
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

const catalog = {
  ok: true,
  data: {
    catalogId: "catalog-1",
    workosOrgId: "org-1",
    status: "active",
    dataAccessMode: "catalog_only",
    quackUrl: "https://quack.test",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  },
};
const exchanged = {
  ok: true,
  data: {
    catalogId: "catalog-1",
    credentialId: "credential-1",
    jwt: "catalog-token",
    permissions: ["query"],
    expiresAt: "2027-01-01",
  },
};
const query = {
  ok: true,
  data: {
    format: "json",
    catalogId: "catalog-1",
    columns: [{ name: "custom_column", type: "json", nullable: true }],
    rows: [{ custom_column: { nested_key: [null, 42, true] } }],
    rowCount: 1,
    truncated: false,
    elapsedMs: 5,
    freshness: { status: "fresh", lastCommitId: "commit-1" },
    lineage: [
      {
        from: { kind: "table", id: "table-1" },
        to: { kind: "query", id: "query-1" },
        kind: "reads",
      },
    ],
  },
};

interface AtlasClient<Result> {
  auth: { authExchange(input: Record<string, never>): Result };
  catalog: { catalogGet(): Result };
  query: { queryExecute(input: { sql: string; format?: "json"; maxRows?: number }): Result };
}

describe("permanent Atlas regression contract", () => {
  test("all targets generate and Promise/Effect preserve Atlas envelopes, auth and open row dictionaries", async () => {
    await mkdir(".tmp", { recursive: true });
    directory = await mkdtemp(resolve(".tmp/atlas-test-"));
    const configPath = join(directory, "sdk.config.ts");
    await writeFile(
      configPath,
      `export default ${JSON.stringify({
        product: { id: "atlas", displayName: "Atlas", sdkVersion: "0.2.0-beta.3" },
        contract: { spec: resolve("fixtures/contracts/atlas.openapi.json") },
        profiles: { access: { includeAudiences: ["access"] } },
        targets: {
          typescript: {
            output: join(directory, "typescript"),
            packageName: "@signalflare-ai/atlas",
            profiles: ["access"],
            effect: true,
          },
          python: {
            output: join(directory, "python"),
            packageName: "signalflare-atlas",
            profiles: ["access"],
            async: true,
          },
          go: {
            output: join(directory, "go"),
            module: "github.com/signalflare-ai/atlas-go",
            profiles: ["access"],
          },
          rust: {
            output: join(directory, "rust"),
            crateName: "signalflare-atlas",
            profiles: ["access"],
          },
        },
      })};\n`,
    );
    const report = await Effect.runPromise(
      generateConfiguredSdks({ configPath, quiet: true }).pipe(Effect.provide(CompilerLive)),
    );
    expect(report.targets.map((target) => [target.operations, target.warnings])).toEqual([
      [3, []],
      [3, []],
      [3, []],
      [3, []],
    ]);
    const output = join(directory, "typescript");
    const check = Bun.spawn(
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
      check.exited,
      new Response(check.stdout).text(),
      new Response(check.stderr).text(),
    ]);
    expect(stdout + stderr).toBe("");
    expect(exit).toBe(0);
    const promiseModule = (await import(pathToFileURL(join(output, "src/index.ts")).href)) as {
      AtlasClient: new (options: Record<string, unknown>) => AtlasClient<Promise<unknown>>;
    };
    const effectModule = (await import(pathToFileURL(join(output, "src/effect.ts")).href)) as {
      AtlasEffectClient: new (
        options: Record<string, unknown>,
      ) => AtlasClient<
        Effect.Effect<
          unknown,
          { _tag: string; requestId?: string; code?: string; details?: unknown }
        >
      >;
    };
    for (const effect of [false, true]) {
      const calls: Array<{
        path: string;
        method: string | undefined;
        headers: Headers;
        body: unknown;
      }> = [];
      const fetch = async (url: URL, init: RequestInit) => {
        calls.push({
          path: url.pathname,
          method: init.method,
          headers: new Headers(init.headers),
          body: init.body ? JSON.parse(String(init.body)) : undefined,
        });
        return Response.json(
          url.pathname.endsWith("exchange")
            ? exchanged
            : url.pathname.endsWith("catalog")
              ? catalog
              : query,
          { status: url.pathname.endsWith("exchange") ? 201 : 200 },
        );
      };
      const options = {
        credentials: { WorkosBearer: "workos-token", CatalogBearer: "catalog-token" },
        fetch,
      };
      const client = effect
        ? new effectModule.AtlasEffectClient(options)
        : new promiseModule.AtlasClient(options);
      const run = (value: Promise<unknown> | Effect.Effect<unknown, unknown>) =>
        Effect.isEffect(value) ? Effect.runPromise(value) : value;
      expect(await run(client.auth.authExchange({}))).toEqual(exchanged);
      expect(await run(client.catalog.catalogGet())).toEqual(catalog);
      expect(
        await run(
          client.query.queryExecute({ sql: "select * from table_1", format: "json", maxRows: 1 }),
        ),
      ).toEqual(query);
      expect(
        calls.map((call) => [call.method, call.path, call.headers.get("authorization")]),
      ).toEqual([
        ["POST", "/v1/auth/exchange", "Bearer workos-token"],
        ["GET", "/v1/catalog", "Bearer catalog-token"],
        ["POST", "/v1/query", "Bearer catalog-token"],
      ]);
      expect(calls[2]?.body).toEqual({ sql: "select * from table_1", format: "json", maxRows: 1 });
      expect(calls[0]?.headers.get("x-signalflare-sdk")).toContain("atlas/0.2.0-beta.3");
    }
    const error = {
      ok: false,
      code: "INVALID_SQL",
      message: "invalid SQL",
      requestId: "request-1",
      details: { line: 1 },
    };
    const fetch = async () => Response.json(error, { status: 400 });
    const promiseClient = new promiseModule.AtlasClient({ token: "catalog-token", fetch });
    await expect(promiseClient.query.queryExecute({ sql: "bad" })).rejects.toMatchObject({
      code: "INVALID_SQL",
      requestId: "request-1",
      details: { line: 1 },
    });
    const effectClient = new effectModule.AtlasEffectClient({ token: "catalog-token", fetch });
    const failure = await Effect.runPromise(
      Effect.result(effectClient.query.queryExecute({ sql: "bad" })),
    );
    expect(Result.isFailure(failure) && failure.failure).toMatchObject({
      _tag: "SdkApiError",
      code: "INVALID_SQL",
      requestId: "request-1",
      details: { line: 1 },
    });
    const snapshot = JSON.parse(await readFile(join(output, ".signalflare-compat.json"), "utf8"));
    expect(Object.keys(snapshot.surfaces)).toEqual(["promise", "effect"]);
  }, 20000);
});
