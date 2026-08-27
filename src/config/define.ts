import type { SignalflareSdkConfig } from "./schema.js";

/**
 * Defines a product-owned SDK manifest while preserving literal target and
 * profile values for editor completion and compile-time checking.
 */
export function defineSdkConfig<const Config extends SignalflareSdkConfig>(config: Config): Config {
  return config;
}
