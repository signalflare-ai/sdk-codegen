import { expect, test } from "bun:test";
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";
import {
  generateSignalflareOpenApi,
  signalflareApiAnnotations,
  signalflareOperationAnnotations,
} from "../src/effect-httpapi/openapi.js";
import { defineSdkConfig, validateProductContract } from "../src/index.js";
import { isRecord } from "../src/shared/object.js";

const Coordinates = Schema.Struct({
  latitude: Schema.Number,
  longitude: Schema.Number,
}).annotate({ identifier: "Coordinates" });

const Feature = Schema.Struct({
  id: Schema.String,
  coordinates: Coordinates,
}).annotate({ identifier: "Feature" });

const FeatureNotFound = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
})
  .annotate({ identifier: "FeatureNotFound" })
  .pipe(HttpApiSchema.status(404));

const getFeature = HttpApiEndpoint.get("getFeature", "/features/:featureId", {
  params: { featureId: Schema.String },
  success: Feature,
  error: FeatureNotFound,
}).annotateMerge(
  signalflareOperationAnnotations({
    operationId: "getFeature",
    sourceApiId: "geocode",
    audiences: ["access"],
    visibility: "public",
    stability: "stable",
  }),
);

const health = HttpApiEndpoint.get("health", "/health", {
  success: Schema.Struct({ status: Schema.Literal("ok") }).annotate({
    identifier: "Health",
  }),
}).annotateMerge(
  signalflareOperationAnnotations({
    operationId: "health",
    sourceApiId: "geocode",
    audiences: ["preview"],
    visibility: "public",
    stability: "experimental",
    implemented: false,
    security: "anonymous",
  }),
);

const features = HttpApiGroup.make("features").add(getFeature, health);
const api = HttpApi.make("geocode")
  .add(features)
  .annotateMerge(
    signalflareApiAnnotations({
      productId: "geocode",
      displayName: "Geocode",
      contractVersion: 1,
      apiVersion: "1.0.0",
      servers: [{ url: "https://api.signalflare.ai" }],
    }),
  );

test("generates compiler-ready OpenAPI through the pinned Effect HttpApi adapter", () => {
  const document = generateSignalflareOpenApi(api);
  expect(document.openapi).toBe("3.1.2");
  expect(document.info).toMatchObject({ title: "Geocode", version: "1.0.0" });
  expect(document.security).toEqual([{ AuthKit: [] }]);
  expect(document.components.securitySchemes.AuthKit).toMatchObject({
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  });
  expect(Object.keys(document.components.schemas)).toEqual(
    expect.arrayContaining(["Coordinates", "Feature", "FeatureNotFound"]),
  );

  const documentRoot: unknown = document;
  expect(isRecord(documentRoot) && documentRoot["x-signalflare-product"]).toEqual({
    id: "geocode",
    displayName: "Geocode",
    contractVersion: 1,
  });
  expect(document.paths["/health"]?.get?.security).toEqual([]);

  const operation = document.paths["/features/{featureId}"]?.get;
  expect(operation).toMatchObject({
    operationId: "getFeature",
    "x-signalflare-api-id": "geocode",
    "x-signalflare-implemented": true,
    "x-signalflare-sdk": {
      audiences: ["access"],
      visibility: "public",
      stability: "stable",
      generate: true,
    },
  });

  const config = defineSdkConfig({
    product: { id: "geocode", displayName: "Geocode" },
    contract: { spec: "openapi.json", openapiBaseline: "3.1.2" },
    profiles: { access: { includeAudiences: ["access"] } },
    targets: {
      typescript: {
        output: "generated/typescript",
        packageName: "@signalflare-ai/geocode",
        profiles: ["access"],
      },
    },
  });
  const report = validateProductContract(document, config);
  expect(report.valid).toBe(true);
  expect(report.diagnostics).toEqual([]);
});
