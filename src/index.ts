export { defineSdkConfig } from "./config/define.js";
export { loadSdkConfig } from "./config/load.js";
export {
  OPENAPI_BASELINE,
  SDK_AUDIENCES,
  SDK_VISIBILITIES,
  TARGET_ID_FIELD,
  TARGET_NAMES,
  type BaseTargetConfig,
  type ContractConfig,
  type GoTargetConfig,
  type ProductConfig,
  type ProfileConfig,
  type PythonTargetConfig,
  type RustTargetConfig,
  type SdkAudience,
  type SdkProfile,
  type SdkVisibility,
  SignalflareSdkConfig,
  SdkVersion,
  type TargetConfig,
  type TargetName,
  type TypeScriptTargetConfig,
} from "./config/schema.js";
export {
  audiencesForProfile,
  isSignalflareSdkConfig,
  profileIsEnabled,
  validateSdkConfig,
} from "./config/validate.js";
export {
  Diagnostic,
  DiagnosticOperation,
  DiagnosticSeverity,
  DiagnosticSummary,
  ValidationReport,
} from "./contract/diagnostics.js";
export {
  AuthPlan,
  AuthSchemePlan,
  OperationAuthPlan,
  SecurityAlternativePlan,
  compileAuthPlan,
} from "./contract/auth.js";
export {
  type OperationSdkMetadata,
  type ProductMetadata,
  SDK_STABILITIES,
  type SdkStability,
  parseOperationSdkMetadata,
  parseProductMetadata,
} from "./contract/extensions.js";
export { loadProductContract, type LoadedContract, type OpenApiDocument } from "./contract/load.js";
export { validateEffectJsonSchemaCompatibility } from "./contract/json-schema.js";
export {
  normalizeContractForOagen,
  type ContractNormalizationResult,
} from "./contract/normalize.js";
export {
  buildProfileContract,
  buildProfilesContract,
  type ProfileContractResult,
  type ProfilesContractResult,
  type SelectedOperation,
} from "./contract/profiles.js";
export { validateProductContract } from "./contract/validate.js";
export {
  generateConfiguredSdks,
  type GenerateSdkOptions,
  type GeneratedTargetReport,
  type GenerationReport,
} from "./generator/generate.js";
export {
  runValidateCommand,
  type ValidateCommandOptions,
  type ValidateCommandResult,
} from "./cli/validate.js";
export {
  CliUsageError,
  ContractLoadError,
  GenerationError,
  SdkConfigLoadError,
} from "./core/errors.js";
export { CompilerLive } from "./core/layers.js";
export { signalflareOagenPlugin } from "./oagen/plugin.js";
export { validateOagenIr } from "./oagen/validate-ir.js";
export {
  SIGNALFLARE_MANIFEST_SCHEMA_VERSION,
  SignalflareSdkManifest,
  SignalflareSdkManifestJson,
} from "./generator/manifest.js";
export {
  COMPILER_VERSION,
  EFFECT_VERSION,
  GENERATED_SDK_VERSION,
  OAGEN_EMITTERS_VERSION,
} from "./version.js";
export {
  COMPATIBILITY_FILE,
  createCompatibilitySnapshot,
  loadCompatibilitySnapshot,
  compareCompatibilitySnapshots,
  type SdkCompatibilitySnapshot,
  type SdkCompatibilityReport,
} from "./generator/compatibility.js";
export type { GenerationDrift } from "./generator/check.js";
