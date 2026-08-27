import { describe, expect, test } from "bun:test";
import { defineSdkConfig, validateSdkConfig } from "../src/index.js";

const validConfig = defineSdkConfig({
  product: { id: "canary", displayName: "Canary" },
  contract: { spec: "fixtures/contracts/canary.openapi.json", openapiBaseline: "3.1.2" },
  profiles: {
    access: { includeAudiences: ["access"] },
    preview: { includeAudiences: ["preview"], enabled: false },
  },
  targets: {
    typescript: {
      output: "generated/typescript",
      packageName: "@signalflare-ai/canary",
      profiles: ["access"],
      effect: true,
    },
  },
});

describe("SDK config", () => {
  test("accepts a typed product manifest", () => {
    expect(validateSdkConfig(validConfig)).toEqual({
      valid: true,
      diagnostics: [],
      summary: { errors: 0, warnings: 0, info: 0 },
    });
  });

  test("rejects unknown profiles and target references", () => {
    const report = validateSdkConfig({
      ...validConfig,
      profiles: {
        unknown: { includeAudiences: ["unknown"] },
      },
      targets: {
        typescript: {
          ...validConfig.targets.typescript,
          profiles: ["access"],
        },
      },
    });

    expect(report.valid).toBe(false);
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "config.profile.invalid",
    );
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "config.target.profile.missing",
    );
  });
});
