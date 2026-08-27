export const SDK_AUDIENCES = ["access", "pipelines", "runner", "admin", "preview"] as const;
export type SdkAudience = (typeof SDK_AUDIENCES)[number];
export type SdkProfile = SdkAudience;

export const SDK_VISIBILITIES = ["public", "partner", "internal"] as const;
export type SdkVisibility = (typeof SDK_VISIBILITIES)[number];

export interface ProductConfig {
  id: string;
  displayName: string;
}

export interface ContractConfig {
  spec: string;
  openapiBaseline?: "3.1.2";
}

export interface ProfileConfig {
  includeAudiences: SdkAudience[];
  enabled?: boolean;
  visibility?: SdkVisibility[];
}

export interface BaseTargetConfig {
  output: string;
  profiles: SdkProfile[];
  enabled?: boolean;
}

export interface TypeScriptTargetConfig extends BaseTargetConfig {
  packageName: string;
  effect?: boolean;
}

export interface PythonTargetConfig extends BaseTargetConfig {
  packageName: string;
  async?: boolean;
}

export interface GoTargetConfig extends BaseTargetConfig {
  module: string;
}

export interface RustTargetConfig extends BaseTargetConfig {
  crateName: string;
}

export interface TargetConfig {
  typescript?: TypeScriptTargetConfig;
  python?: PythonTargetConfig;
  go?: GoTargetConfig;
  rust?: RustTargetConfig;
}

export interface SignalflareSdkConfig {
  product: ProductConfig;
  contract: ContractConfig;
  profiles: Partial<Record<SdkProfile, ProfileConfig>>;
  targets: TargetConfig;
}
