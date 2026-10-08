import type { OagenConfig } from "@workos/oagen";
import {
  goExtractor,
  nodeExtractor,
  pythonExtractor,
  rustExtractor,
  workosEmittersPlugin,
} from "@workos/oagen-emitters";
import { signalflareGoEmitter } from "../emitters/go/index.js";
import { signalflarePythonEmitter } from "../emitters/python/index.js";
import { signalflareRustEmitter } from "../emitters/rust/index.js";
import { signalflareTypeScriptEmitter } from "../emitters/typescript/index.js";

const ENABLED_UPSTREAM_LANGUAGES = ["node", "python", "go", "rust"] as const;

const smokeRunners = Object.fromEntries(
  ENABLED_UPSTREAM_LANGUAGES.flatMap((language) => {
    const runner = workosEmittersPlugin.smokeRunners?.[language];
    return runner === undefined ? [] : [[language, runner]];
  }),
);

/**
 * Focused upstream plugin assembly. Product repositories should consume this
 * through Signalflare orchestration rather than registering WorkOS' full
 * language bundle.
 *
 * The upstream `node` language is the basis for Signalflare's TypeScript
 * target. Effect generation will be registered separately over the shared
 * TypeScript operation/model layer.
 */
export const signalflareOagenPlugin = {
  emitters: [
    signalflareTypeScriptEmitter,
    signalflarePythonEmitter,
    signalflareGoEmitter,
    signalflareRustEmitter,
  ],
  extractors: [nodeExtractor, pythonExtractor, goExtractor, rustExtractor],
  smokeRunners,
} satisfies Pick<OagenConfig, "emitters" | "extractors" | "smokeRunners">;
