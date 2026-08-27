import type { SchemaRepresentation } from "effect";
import { HttpApi, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";
import { OPENAPI_BASELINE, type SdkAudience, type SdkVisibility } from "../config/schema.js";
import { isRecord } from "../shared/object.js";

export interface SignalflareApiAnnotationsOptions {
  productId: string;
  displayName: string;
  contractVersion: number;
  apiVersion: string;
  servers: ReadonlyArray<OpenApi.OpenAPISpecServer>;
  authSchemeName?: string;
}

export interface SignalflareOperationAnnotationsOptions {
  operationId: string;
  sourceApiId: string;
  audiences: readonly [SdkAudience, ...SdkAudience[]];
  visibility: SdkVisibility;
  stability: "stable" | "beta" | "experimental";
  generate?: boolean;
  service?: string;
  implemented?: boolean;
  security?: "inherit" | "anonymous";
}

/**
 * Root annotations for Effect-owned product APIs. The transform deliberately
 * sits behind this pinned adapter because Effect's HttpApi OpenAPI module is
 * unstable and currently declares its generated document as OpenAPI 3.1.0.
 */
export function signalflareApiAnnotations(options: SignalflareApiAnnotationsOptions) {
  const authSchemeName = options.authSchemeName ?? "AuthKit";
  return OpenApi.annotations({
    title: options.displayName,
    version: options.apiVersion,
    servers: options.servers,
    transform: (document) => {
      const components = isRecord(document.components) ? document.components : {};
      const securitySchemes = isRecord(components.securitySchemes)
        ? components.securitySchemes
        : {};
      return {
        ...document,
        openapi: OPENAPI_BASELINE,
        components: {
          ...components,
          securitySchemes: {
            ...securitySchemes,
            [authSchemeName]: {
              type: "http",
              scheme: "bearer",
              bearerFormat: "JWT",
              description: "WorkOS AuthKit access token",
            },
          },
        },
        security: [{ [authSchemeName]: [] }],
        "x-signalflare-product": {
          id: options.productId,
          displayName: options.displayName,
          contractVersion: options.contractVersion,
        },
      };
    },
  });
}

/** Adds the compiler-required operation metadata at the HttpApi source. */
export function signalflareOperationAnnotations(options: SignalflareOperationAnnotationsOptions) {
  return OpenApi.annotations({
    identifier: options.operationId,
    override: {
      "x-signalflare-api-id": options.sourceApiId,
      "x-signalflare-implemented": options.implemented ?? true,
      "x-signalflare-sdk": {
        audiences: options.audiences,
        visibility: options.visibility,
        stability: options.stability,
        generate: options.generate ?? true,
        ...(options.service === undefined ? {} : { service: options.service }),
      },
      ...(options.security === "anonymous" ? { security: [] } : {}),
    },
  });
}

const referencePolicy: SchemaRepresentation.ReferencePolicy = ({ identifier }) => identifier;

/**
 * Reuse this immutable options object so Effect's OpenAPI WeakMap cache remains
 * effective. Anonymous schemas remain inline; annotate reusable/nested product
 * schemas with stable identifiers to promote them into components.
 */
export const SIGNALFLARE_OPENAPI_OPTIONS = Object.freeze({
  referencePolicy,
}) satisfies SchemaRepresentation.ToRepresentationOptions;

export type SignalflareOpenApiDocument = Omit<OpenApi.OpenAPISpec, "openapi"> & {
  readonly openapi: typeof OPENAPI_BASELINE;
};

/** Generates a Signalflare OpenAPI document through the pinned unstable adapter. */
export function generateSignalflareOpenApi<
  Id extends string,
  Groups extends HttpApiGroup.Constraint,
>(api: HttpApi.HttpApi<Id, Groups>): SignalflareOpenApiDocument {
  const generated = OpenApi.fromApi(api, SIGNALFLARE_OPENAPI_OPTIONS);
  const { openapi: _upstreamVersion, ...document } = generated;
  return { ...document, openapi: OPENAPI_BASELINE };
}
