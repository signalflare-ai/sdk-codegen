import { defineSdkConfig } from "../../src/index.js";

export default defineSdkConfig({
  product: { id: "atlas", displayName: "Atlas", sdkVersion: "0.2.0-beta.3" },
  contract: { spec: "../../fixtures/contracts/atlas.openapi.json" },
  profiles: { access: { includeAudiences: ["access"] } },
  targets: {
    typescript: {
      output: "../../.tmp/atlas-conformance/typescript",
      packageName: "@signalflare-ai/atlas",
      profiles: ["access"],
      effect: true,
    },
    python: {
      output: "../../.tmp/atlas-conformance/python",
      packageName: "signalflare-atlas",
      profiles: ["access"],
      async: true,
    },
    go: {
      output: "../../.tmp/atlas-conformance/go",
      module: "github.com/signalflare-ai/atlas-go",
      profiles: ["access"],
    },
    rust: {
      output: "../../.tmp/atlas-conformance/rust",
      crateName: "signalflare-atlas",
      profiles: ["access"],
    },
  },
});
