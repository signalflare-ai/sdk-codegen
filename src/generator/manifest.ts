import { Schema } from "effect";
import { OPENAPI_BASELINE, SdkAudience, SdkVersion, TargetName } from "../config/schema.js";
import { COMPILER_VERSION } from "../version.js";

export const SIGNALFLARE_MANIFEST_SCHEMA_VERSION = 1 as const;

export const SignalflareSdkManifest = Schema.Struct({
  schemaVersion: Schema.Literal(SIGNALFLARE_MANIFEST_SCHEMA_VERSION),
  product: Schema.NonEmptyString,
  profiles: Schema.Array(SdkAudience),
  target: TargetName,
  packageName: Schema.NonEmptyString,
  sdkVersion: Schema.optionalKey(SdkVersion),
  effectVersion: Schema.optionalKey(SdkVersion),
  compilerVersion: Schema.Literal(COMPILER_VERSION),
  openapiBaseline: Schema.Literal(OPENAPI_BASELINE),
});
export interface SignalflareSdkManifest extends Schema.Schema.Type<typeof SignalflareSdkManifest> {}

export const SignalflareSdkManifestJson = Schema.fromJsonString(SignalflareSdkManifest, {
  space: 2,
});
