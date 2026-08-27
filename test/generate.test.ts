import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import { CompilerLive, generateConfiguredSdks } from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createConfig(): Promise<{ configPath: string; output: string }> {
  const directory = await mkdtemp(join(tmpdir(), "signalflare-generate-test-"));
  temporaryDirectories.push(directory);
  const output = join(directory, "typescript");
  const configPath = join(directory, "sdk.config.ts");
  const config = {
    product: { id: "canary", displayName: "Canary" },
    contract: {
      spec: resolve("fixtures/contracts/canary.openapi.json"),
      openapiBaseline: "3.1.2",
    },
    profiles: {
      access: { includeAudiences: ["access"] },
      pipelines: { includeAudiences: ["pipelines"] },
      runner: { includeAudiences: ["runner"], visibility: ["internal"] },
      admin: { includeAudiences: ["admin"] },
      preview: { includeAudiences: ["preview"], enabled: false },
    },
    targets: {
      typescript: {
        output,
        packageName: "@signalflare-ai/canary",
        profiles: ["access", "pipelines", "runner", "admin"],
        effect: false,
      },
    },
  };
  await writeFile(configPath, `export default ${JSON.stringify(config, null, 2)};\n`, "utf8");
  return { configPath, output };
}

async function typecheckGeneratedClient(output: string): Promise<void> {
  const process = Bun.spawn(
    [
      "bunx",
      "tsc",
      "--ignoreConfig",
      "--noEmit",
      "--strict",
      "--exactOptionalPropertyTypes",
      "--noUncheckedIndexedAccess",
      "--target",
      "ES2023",
      "--lib",
      "ES2023,DOM,DOM.Iterable",
      "--module",
      "ESNext",
      "--moduleResolution",
      "Bundler",
      "--skipLibCheck",
      join(output, "src/index.ts"),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  expect(`${stdout}\n${stderr}`).toBe("\n");
  expect(exitCode).toBe(0);
}

describe("SDK generation", () => {
  test("generates, typechecks, and authenticates a profile-filtered TypeScript client", async () => {
    const { configPath, output } = await createConfig();
    const report = await Effect.runPromise(
      generateConfiguredSdks({
        configPath,
        targets: ["typescript"],
        quiet: true,
      }).pipe(Effect.provide(CompilerLive)),
    );

    expect(report.targets).toHaveLength(1);
    expect(report.targets[0]?.operations).toBe(6);
    expect(report.targets[0]?.files).toContain("src/common/auth-plan.ts");
    expect(report.targets[0]?.files).not.toContain("src/preview/preview.ts");
    await typecheckGeneratedClient(output);

    const sdk = (await import(pathToFileURL(join(output, "src/index.ts")).href)) as {
      CanaryClient: new (options: Record<string, unknown>) => {
        tables: {
          getTable(options: { tableId: string; includeColumns?: boolean }): Promise<unknown>;
        };
        pipelines: {
          createPipeline(options: Record<string, unknown>): Promise<unknown>;
        };
      };
      MissingCredentialError: new (...args: never[]) => Error;
    };
    const requests: Array<{ url: URL; headers: Headers; body?: string }> = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      requests.push({
        url,
        headers: new Headers(init?.headers),
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      });
      if (url.pathname === "/pipelines") {
        return Response.json({ pipeline_id: "daily", created_at: "2026-08-15T00:00:00Z" });
      }
      return Response.json({ id: "orders", name: "Orders", status: "ready" });
    };
    const client = new sdk.CanaryClient({
      baseURL: "https://canary.test",
      token: async () => "authkit-token",
      apiKey: "pipeline-key",
      fetch,
    });

    await client.tables.getTable({ tableId: "orders", includeColumns: true });
    await client.pipelines.createPipeline({
      pipelineId: "daily",
      source: { kind: "postgres", connectionRef: "warehouse", table: "orders" },
    });

    expect(requests[0]?.url.pathname).toBe("/tables/orders");
    expect(requests[0]?.url.searchParams.get("include_columns")).toBe("true");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer authkit-token");
    expect(requests[0]?.headers.has("x-api-key")).toBe(false);
    expect(requests[1]?.headers.get("x-api-key")).toBe("pipeline-key");
    expect(requests[1]?.headers.has("authorization")).toBe(false);
    expect(JSON.parse(requests[1]?.body ?? "{}")).toMatchObject({
      pipeline_id: "daily",
      source: { kind: "postgres", connection_ref: "warehouse", table: "orders" },
    });

    const bearerOnlyClient = new sdk.CanaryClient({
      baseURL: "https://canary.test",
      token: "authkit-token",
      fetch,
    });
    await expect(
      bearerOnlyClient.pipelines.createPipeline({
        pipelineId: "daily",
        source: { kind: "postgres", connectionRef: "warehouse", table: "orders" },
      }),
    ).rejects.toBeInstanceOf(sdk.MissingCredentialError);

    const secondReport = await Effect.runPromise(
      generateConfiguredSdks({
        configPath,
        targets: ["typescript"],
        quiet: true,
      }).pipe(Effect.provide(CompilerLive)),
    );
    expect(secondReport.targets[0]?.files).toHaveLength(report.targets[0]?.files.length ?? 0);

    const oagenManifest = JSON.parse(
      await readFile(join(output, ".oagen-manifest.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(oagenManifest.sdkName).toBe("@signalflare-ai/canary");
    expect(oagenManifest.specSha).toBeString();
    expect(oagenManifest.operations).toMatchObject({
      "POST /runner/runs/{run_id}/heartbeat": {
        sdkMethod: "Runner.heartbeatRun",
      },
    });
  });
});
