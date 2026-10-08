import { expect, test } from "bun:test";
import { resolve } from "node:path";
import platformBunManifest from "@effect/platform-bun/package.json" with { type: "json" };
import { parseSpec } from "@workos/oagen";
import effectManifest from "effect/package.json" with { type: "json" };
import packageManifest from "../package.json" with { type: "json" };
import { COMPILER_VERSION, OAGEN_EMITTERS_VERSION, validateOagenIr } from "../src/index.js";

test("pins compiler provenance to package metadata and installed emitters", () => {
  expect(packageManifest.version).toBe(COMPILER_VERSION);
  expect(packageManifest.dependencies["@workos/oagen-emitters"]).toBe(OAGEN_EMITTERS_VERSION);
});

test("pins the compiler and Bun platform to the same stable Effect v4 release", () => {
  const version = packageManifest.dependencies.effect;
  expect(version).toMatch(/^4\.\d+\.\d+$/);
  expect(packageManifest.dependencies["@effect/platform-bun"]).toBe(version);
  expect(packageManifest.overrides["@effect/platform-node-shared"]).toBe(version);
  expect(effectManifest.version).toBe(version);
  expect(platformBunManifest.version).toBe(version);
});

test("Oagen parses the acceptance contract into its shared IR", async () => {
  const spec = await parseSpec(resolve("fixtures/contracts/canary.openapi.json"));
  const operationCount = spec.services.reduce(
    (count, service) => count + service.operations.length,
    0,
  );

  expect(spec.name).toBe("Signalflare Canary API");
  expect(operationCount).toBe(7);
  expect(spec.models.some((model) => model.name === "Table")).toBe(true);
  expect(spec.enums.some((entry) => entry.name === "TableStatus")).toBe(true);
});

test("rejects unresolved references in Oagen IR before emitting broken imports", async () => {
  const spec = await parseSpec(resolve("fixtures/contracts/canary.openapi.json"));
  spec.models.push({
    name: "BrokenModel",
    fields: [
      {
        name: "missing",
        type: { kind: "model", name: "MissingModel" },
        required: true,
      },
    ],
  });

  const report = validateOagenIr(spec);
  expect(report.valid).toBe(false);
  expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "oagen.ir.model-reference.unresolved",
  );
});
