import { defineSdkConfig } from "../../src/index.js";

export default defineSdkConfig({
  product: {
    id: "runtime-conformance",
    displayName: "Runtime Conformance",
  },
  contract: {
    spec: "../../fixtures/contracts/runtime-conformance.openapi.json",
    openapiBaseline: "3.1.2",
  },
  profiles: {
    access: { includeAudiences: ["access"] },
  },
  targets: {
    typescript: {
      output: "../../.tmp/runtime-conformance/typescript",
      packageName: "@signalflare-ai/runtime-conformance",
      profiles: ["access"],
    },
    python: {
      output: "../../.tmp/runtime-conformance/python",
      packageName: "signalflare-runtime-conformance",
      profiles: ["access"],
      async: true,
    },
    go: {
      output: "../../.tmp/runtime-conformance/go",
      module: "github.com/signalflare-ai/runtime-conformance-go",
      profiles: ["access"],
    },
    rust: {
      output: "../../.tmp/runtime-conformance/rust",
      crateName: "signalflare-runtime-conformance",
      profiles: ["access"],
    },
  },
});
