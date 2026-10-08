import { Schema } from "effect";

export const OPENAPI_BASELINE = "3.1.2" as const;

export const SDK_AUDIENCES = ["access", "pipelines", "runner", "admin", "preview"] as const;
export const SdkAudience = Schema.Literals(SDK_AUDIENCES);
export type SdkAudience = typeof SdkAudience.Type;

/**
 * Profiles deliberately share the audience namespace. A profile selects one or
 * more operation audiences, while targets select which named profiles to emit.
 */
export type SdkProfile = SdkAudience;

export const SDK_VISIBILITIES = ["public", "partner", "internal"] as const;
export const SdkVisibility = Schema.Literals(SDK_VISIBILITIES);
export type SdkVisibility = typeof SdkVisibility.Type;

export const TARGET_NAMES = ["typescript", "python", "go", "rust"] as const;
export const TargetName = Schema.Literals(TARGET_NAMES);
export type TargetName = typeof TargetName.Type;

export const TARGET_ID_FIELD = {
  typescript: "packageName",
  python: "packageName",
  go: "module",
  rust: "crateName",
} as const satisfies Record<TargetName, string>;

const NonBlankString = Schema.String.check(
  Schema.isPattern(/\S/, { expected: "a non-blank string" }),
);

export const SdkVersion = Schema.String.check(
  Schema.isPattern(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
    { expected: "a semantic version" },
  ),
);

export const ProductConfig = Schema.Struct({
  id: Schema.String.check(
    Schema.isPattern(/^[a-z][a-z0-9-]*$/, { expected: "a lowercase kebab-case product id" }),
  ),
  displayName: NonBlankString,
  sdkVersion: Schema.optionalKey(SdkVersion),
});
export interface ProductConfig extends Schema.Schema.Type<typeof ProductConfig> {}

export const ContractConfig = Schema.Struct({
  spec: NonBlankString,
  openapiBaseline: Schema.optionalKey(Schema.Literal(OPENAPI_BASELINE)),
});
export interface ContractConfig extends Schema.Schema.Type<typeof ContractConfig> {}

export const ProfileConfig = Schema.Struct({
  includeAudiences: Schema.NonEmptyArray(SdkAudience),
  enabled: Schema.optionalKey(Schema.Boolean),
  visibility: Schema.optionalKey(Schema.NonEmptyArray(SdkVisibility)),
});
export interface ProfileConfig extends Schema.Schema.Type<typeof ProfileConfig> {}

const BaseTargetFields = {
  output: NonBlankString,
  profiles: Schema.NonEmptyArray(SdkAudience),
  enabled: Schema.optionalKey(Schema.Boolean),
  sdkVersion: Schema.optionalKey(SdkVersion),
};

export const BaseTargetConfig = Schema.Struct(BaseTargetFields);
export interface BaseTargetConfig extends Schema.Schema.Type<typeof BaseTargetConfig> {}

export const TypeScriptTargetConfig = Schema.Struct({
  ...BaseTargetFields,
  packageName: NonBlankString,
  effect: Schema.optionalKey(Schema.Boolean),
  effectVersion: Schema.optionalKey(SdkVersion),
});
export interface TypeScriptTargetConfig extends Schema.Schema.Type<typeof TypeScriptTargetConfig> {}

export const PythonTargetConfig = Schema.Struct({
  ...BaseTargetFields,
  packageName: NonBlankString,
  async: Schema.optionalKey(Schema.Boolean),
});
export interface PythonTargetConfig extends Schema.Schema.Type<typeof PythonTargetConfig> {}

export const GoTargetConfig = Schema.Struct({
  ...BaseTargetFields,
  module: NonBlankString,
});
export interface GoTargetConfig extends Schema.Schema.Type<typeof GoTargetConfig> {}

export const RustTargetConfig = Schema.Struct({
  ...BaseTargetFields,
  crateName: NonBlankString,
});
export interface RustTargetConfig extends Schema.Schema.Type<typeof RustTargetConfig> {}

export const TargetConfig = Schema.Struct({
  typescript: Schema.optionalKey(TypeScriptTargetConfig),
  python: Schema.optionalKey(PythonTargetConfig),
  go: Schema.optionalKey(GoTargetConfig),
  rust: Schema.optionalKey(RustTargetConfig),
});
export interface TargetConfig extends Schema.Schema.Type<typeof TargetConfig> {}

export const SignalflareSdkConfig = Schema.Struct({
  product: ProductConfig,
  contract: ContractConfig,
  profiles: Schema.Struct({
    access: Schema.optionalKey(ProfileConfig),
    pipelines: Schema.optionalKey(ProfileConfig),
    runner: Schema.optionalKey(ProfileConfig),
    admin: Schema.optionalKey(ProfileConfig),
    preview: Schema.optionalKey(ProfileConfig),
  }),
  targets: TargetConfig,
});
export interface SignalflareSdkConfig extends Schema.Schema.Type<typeof SignalflareSdkConfig> {}
