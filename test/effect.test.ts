import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { Effect, Result } from "effect";
import {
  generateConfiguredSdksEffect,
  loadProductContractEffect,
  loadSdkConfigEffect,
} from "../src/index.js";

describe("Effect compiler core", () => {
  test("loads configuration through a named Effect workflow", async () => {
    const loaded = await Effect.runPromise(
      loadSdkConfigEffect(resolve("test/fixtures/sdk.config.ts")),
    );
    expect(loaded.config.product.id).toBe("canary");
  });

  test("returns contract failures in the typed error channel", async () => {
    const result = await Effect.runPromise(
      Effect.result(loadProductContractEffect("fixtures/contracts/missing.openapi.json")),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("ContractLoadError");
      expect(result.failure.validation.diagnostics[0]?.code).toBe("contract.file.unreadable");
    }
  });

  test("exposes generation as an Effect while retaining Promise compatibility", async () => {
    const report = await Effect.runPromise(
      generateConfiguredSdksEffect({
        configPath: resolve("test/fixtures/sdk.config.ts"),
        targets: ["typescript"],
        dryRun: true,
        quiet: true,
      }),
    );
    expect(report.targets[0]?.operations).toBe(6);
  });
});
