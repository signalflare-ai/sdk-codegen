import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { Effect } from "effect";
import { CompilerLive } from "../src/core/layers.js";
import { runValidateCommand } from "../src/cli/validate.js";

test("validate command checks a product config and contract", async () => {
  const result = await Effect.runPromise(
    runValidateCommand({
      configPath: resolve("test/fixtures/sdk.config.ts"),
    }).pipe(Effect.provide(CompilerLive)),
  );

  expect(result.report.valid).toBe(true);
  expect(result.report.summary.errors).toBe(0);
  expect(result.contract).toEndWith("fixtures/contracts/canary.openapi.json");
});
