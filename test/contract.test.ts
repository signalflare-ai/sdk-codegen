import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Effect } from "effect";
import {
  buildProfileContract,
  CompilerLive,
  defineSdkConfig,
  loadProductContract,
  validateProductContract,
  type OpenApiDocument,
} from "../src/index.js";

const fixturePath = resolve("fixtures/contracts/canary.openapi.json");
const config = defineSdkConfig({
  product: { id: "canary", displayName: "Canary" },
  contract: { spec: fixturePath, openapiBaseline: "3.1.2" },
  profiles: {
    access: { includeAudiences: ["access"] },
    pipelines: { includeAudiences: ["pipelines"] },
    runner: { includeAudiences: ["runner"], visibility: ["internal"] },
    admin: { includeAudiences: ["admin"] },
    preview: { includeAudiences: ["preview"], enabled: true },
  },
  targets: {
    typescript: {
      output: "generated/typescript",
      packageName: "@signalflare-ai/canary",
      profiles: ["access", "pipelines", "runner", "admin"],
      effect: true,
    },
  },
});

async function readFixture(): Promise<OpenApiDocument> {
  return JSON.parse(await readFile(fixturePath, "utf8")) as OpenApiDocument;
}

function operation(
  document: OpenApiDocument,
  path: string,
  method: string,
): Record<string, unknown> {
  return ((document.paths as Record<string, Record<string, unknown>>)[path]![method] ??
    {}) as Record<string, unknown>;
}

describe("contract validation", () => {
  test("accepts the permanent canary contract", async () => {
    const document = await readFixture();
    const report = validateProductContract(document, config, { file: fixturePath });
    expect(report.valid).toBe(true);
    expect(report.diagnostics).toEqual([]);
  });

  test("loads and bundles the canary contract", async () => {
    const loaded = await Effect.runPromise(
      loadProductContract(fixturePath).pipe(Effect.provide(CompilerLive)),
    );
    expect(loaded.validation.valid).toBe(true);
    expect(loaded.document.openapi).toBe("3.1.2");
  });

  test("rejects GET bodies, duplicated path fields, and legacy nullable", async () => {
    const document = await readFixture();
    operation(document, "/tables/{table_id}", "get").requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/CreatePipelineRequest" },
        },
      },
    };
    const schemas = (document.components as { schemas: Record<string, Record<string, unknown>> })
      .schemas;
    const heartbeat = schemas.HeartbeatRequest!;
    (heartbeat.properties as Record<string, unknown>).run_id = { type: "string" };
    schemas.Organization!.nullable = true;

    const report = validateProductContract(document, config);
    const codes = report.diagnostics.map((diagnostic) => diagnostic.code);
    expect(report.valid).toBe(false);
    expect(codes).toContain("operation.request-body.method-unsupported");
    expect(codes).toContain("operation.path-body.duplicate");
    expect(codes).toContain("schema.nullable.legacy");
  });

  test("keeps unimplemented operations out of production profiles", async () => {
    const document = await readFixture();
    const replay = operation(document, "/preview/replays", "post");
    const replayResponses = replay.responses as Record<string, Record<string, unknown>>;
    replayResponses["202"]!.content = { "text/csv": { schema: { type: "string" } } };
    const access = buildProfileContract(document, config, "access");
    const preview = buildProfileContract(document, config, "preview");

    expect(access.validation.valid).toBe(true);
    expect(access.operations.map((entry) => entry.operationId)).toEqual([
      "getTable",
      "listLegacyTables",
      "listTables",
    ]);
    expect(access.operations.some((entry) => entry.operationId === "createReplay")).toBe(false);
    expect(preview.operations.map((entry) => entry.operationId)).toEqual(["createReplay"]);
    expect(Object.keys(access.document.paths as object)).not.toContain("/preview/replays");
    const selectedSchemas = (access.document.components as { schemas: Record<string, unknown> })
      .schemas;
    expect(selectedSchemas.CreateReplayRequest).toBeUndefined();
    expect(selectedSchemas.CreateReplayResponse).toBeUndefined();
  });

  test("allows a schema property named nullable", async () => {
    const document = await readFixture();
    const schemas = (document.components as { schemas: Record<string, Record<string, unknown>> })
      .schemas;
    const table = schemas.Table;
    const properties = table?.properties as Record<string, unknown>;
    properties.nullable = { type: "boolean" };

    const report = validateProductContract(document, config);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      "schema.nullable.legacy",
    );
  });

  test("rejects unsupported and unknown security schemes", async () => {
    const document = await readFixture();
    const securitySchemes = (
      document.components as { securitySchemes: Record<string, Record<string, unknown>> }
    ).securitySchemes;
    securitySchemes.BasicAuth = { type: "http", scheme: "basic" };
    operation(document, "/pipelines", "post").security = [{ MissingScheme: [] }];

    const report = validateProductContract(document, config);
    const codes = report.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("contract.security-scheme.unsupported");
    expect(codes).toContain("operation.security-scheme.unknown");
  });

  test("rejects an unimplemented operation assigned to production", async () => {
    const document = await readFixture();
    const replay = operation(document, "/preview/replays", "post");
    (replay["x-signalflare-sdk"] as { audiences: string[] }).audiences = ["access"];
    const report = validateProductContract(document, config);

    expect(report.valid).toBe(false);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "operation.preview.production-audience",
    );
  });
});
