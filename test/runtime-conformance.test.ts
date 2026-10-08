import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Effect, Schema } from "effect";
import {
  buildProfileContract,
  compileAuthPlan,
  CompilerLive,
  generateConfiguredSdks,
  loadProductContract,
  loadSdkConfig,
  validateProductContract,
  type OpenApiDocument,
} from "../src/index.js";

const contractPath = resolve("fixtures/contracts/runtime-conformance.openapi.json");
const configPath = resolve("test/fixtures/runtime-conformance.sdk.config.ts");
const vectorsPath = resolve("fixtures/conformance/runtime-vectors.json");

const StringRecord = Schema.Record(Schema.String, Schema.String);
const CredentialVector = Schema.Struct({
  token: Schema.optionalKey(Schema.String),
  apiKey: Schema.optionalKey(Schema.String),
  named: Schema.optionalKey(StringRecord),
});
const ExpectedRequest = Schema.Struct({
  method: Schema.String,
  path: Schema.String,
  query: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  headersContain: StringRecord,
  headersAbsent: Schema.Array(Schema.String),
  body: Schema.Unknown,
});
const RequestVector = Schema.Struct({
  id: Schema.String,
  operationId: Schema.String,
  credentials: CredentialVector,
  input: Schema.Record(Schema.String, Schema.Unknown),
  expected: ExpectedRequest,
});
const ResponseVector = Schema.Struct({
  id: Schema.String,
  status: Schema.Number,
  headers: StringRecord,
  body: Schema.optionalKey(Schema.Unknown),
  rawBody: Schema.optionalKey(Schema.String),
  expectedError: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  expectedValue: Schema.optionalKey(Schema.Unknown),
});
const RuntimeVectors = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  contract: Schema.String,
  requests: Schema.NonEmptyArray(RequestVector),
  responses: Schema.NonEmptyArray(ResponseVector),
});

describe("runtime conformance foundation", () => {
  test("validates the permanent contract and selects every conformance operation", async () => {
    const { config, validation: configValidation } = await Effect.runPromise(
      loadSdkConfig(configPath).pipe(Effect.provide(CompilerLive)),
    );
    const loaded = await Effect.runPromise(
      loadProductContract(contractPath).pipe(Effect.provide(CompilerLive)),
    );
    const report = validateProductContract(loaded.document, config, { file: contractPath });
    const profile = buildProfileContract(loaded.document, config, "access");

    expect(configValidation.valid).toBe(true);
    expect(loaded.validation.valid).toBe(true);
    expect(report.valid).toBe(true);
    expect(profile.validation.valid).toBe(true);
    expect(profile.operations.map((entry) => entry.operationId).sort()).toEqual([
      "createJob",
      "getHealth",
      "getWidget",
      "verifyAlternativeCredentials",
      "verifyCombinedCredentials",
      "verifyCookieKey",
      "verifyQueryKey",
    ]);
  });

  test("compiles inherited, overridden, AND, OR, and anonymous auth exactly", async () => {
    const loaded = await Effect.runPromise(
      loadProductContract(contractPath).pipe(Effect.provide(CompilerLive)),
    );
    const plan = compileAuthPlan(loaded.document);
    const operations = Object.fromEntries(
      plan.operations.map((operation) => [operation.operationId, operation.alternatives]),
    );

    expect(plan.schemes).toEqual([
      { id: "BearerAuth", kind: "bearer" },
      { id: "CookieKey", kind: "apiKey", in: "cookie", name: "session_key" },
      { id: "HeaderKey", kind: "apiKey", in: "header", name: "X-API-Key" },
      { id: "QueryKey", kind: "apiKey", in: "query", name: "api_key" },
    ]);
    expect(plan.defaults).toEqual([{ schemes: ["BearerAuth"] }]);
    expect(operations).toMatchObject({
      getWidget: [{ schemes: ["BearerAuth"] }],
      createJob: [{ schemes: ["HeaderKey"] }],
      verifyQueryKey: [{ schemes: ["QueryKey"] }],
      verifyCookieKey: [{ schemes: ["CookieKey"] }],
      verifyCombinedCredentials: [{ schemes: ["BearerAuth", "HeaderKey"] }],
      verifyAlternativeCredentials: [{ schemes: ["BearerAuth"] }, { schemes: ["HeaderKey"] }],
      getHealth: [],
    });
  });

  test("emits complete standalone Python, Go, and Rust packages", async () => {
    const report = await Effect.runPromise(
      generateConfiguredSdks({ configPath, dryRun: true, quiet: true }).pipe(
        Effect.provide(CompilerLive),
      ),
    );
    const targets = Object.fromEntries(report.targets.map((target) => [target.target, target]));

    expect(targets.python?.warnings).toEqual([]);
    expect(targets.python?.files).toContain("pyproject.toml");
    expect(targets.python?.files).toContain("src/runtime_conformance/_base_client.py");
    expect(targets.go?.warnings).toEqual([]);
    expect(targets.go?.files).toContain("go.mod");
    expect(targets.go?.files).toContain("client.go");
    expect(targets.go?.files).toContain("runtime_conformance_client.go");
    expect(targets.rust?.warnings).toEqual([]);
    expect(targets.rust?.files).toContain("Cargo.toml");
    expect(targets.rust?.files).toContain("src/client.rs");
    expect(targets.rust?.files).toContain("src/transport.rs");
  });

  test("keeps shared wire vectors aligned with the contract", async () => {
    const vectors = Schema.decodeUnknownSync(RuntimeVectors)(
      JSON.parse(await readFile(vectorsPath, "utf8")),
    );
    const document = JSON.parse(await readFile(contractPath, "utf8")) as OpenApiDocument;
    const operationIds = new Set<string>();
    for (const pathItem of Object.values(document.paths as Record<string, unknown>)) {
      if (!pathItem || typeof pathItem !== "object") continue;
      for (const operation of Object.values(pathItem as Record<string, unknown>)) {
        if (!operation || typeof operation !== "object") continue;
        const operationId = (operation as Record<string, unknown>).operationId;
        if (typeof operationId === "string") operationIds.add(operationId);
      }
    }

    expect(resolve(dirname(vectorsPath), vectors.contract)).toBe(contractPath);
    expect(new Set(vectors.requests.map((vector) => vector.id)).size).toBe(vectors.requests.length);
    expect(new Set(vectors.responses.map((vector) => vector.id)).size).toBe(
      vectors.responses.length,
    );
    expect(vectors.requests.every((vector) => operationIds.has(vector.operationId))).toBe(true);
    expect(vectors.requests).toHaveLength(9);
    expect(vectors.responses).toHaveLength(3);
  });
});
