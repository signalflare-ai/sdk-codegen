import { defineSdkConfig } from "../../src/index.js";

export default defineSdkConfig({
  product: {
    id: "canary",
    displayName: "Canary",
  },
  contract: {
    spec: "../../fixtures/contracts/canary.openapi.json",
    openapiBaseline: "3.1.2",
  },
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
