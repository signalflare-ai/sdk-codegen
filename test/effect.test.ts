import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { Effect, Result } from "effect";
import {
  CompilerLive,
  generateConfiguredSdks,
  loadProductContract,
  loadSdkConfig,
} from "../src/index.js";

describe("Effect compiler core", () => {
  test("loads configuration through a named Effect workflow", async () => {
    const loaded = await Effect.runPromise(loadSdkConfig(resolve("test/fixtures/sdk.config.ts")));
    expect(loaded.config.product.id).toBe("canary");
  });

  test("returns contract failures in the typed error channel", async () => {
    const result = await Effect.runPromise(
      Effect.result(loadProductContract("fixtures/contracts/missing.openapi.json")).pipe(
        Effect.provide(CompilerLive),
      ),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("ContractLoadError");
      expect(result.failure.validation.diagnostics[0]?.code).toBe("contract.file.unreadable");
    }
  });

  test("exposes generation as an Effect program", async () => {
    const report = await Effect.runPromise(
      generateConfiguredSdks({
        configPath: resolve("test/fixtures/sdk.config.ts"),
        targets: ["typescript"],
        dryRun: true,
        quiet: true,
      }).pipe(Effect.provide(CompilerLive)),
    );
    expect(report.targets[0]?.operations).toBe(6);
  });
});
