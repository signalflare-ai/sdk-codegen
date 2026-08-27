import { BunFileSystem } from "@effect/platform-bun";

/** Live compiler services for Bun-based CLI and programmatic execution. */
export const CompilerLive = BunFileSystem.layer;
