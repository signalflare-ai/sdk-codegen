import { expect, test } from "bun:test";
import { signalflareOagenPlugin } from "../src/index.js";

test("registers only Signalflare's reviewed upstream targets", () => {
  expect(signalflareOagenPlugin.emitters.map((emitter) => emitter.language)).toEqual([
    "node",
    "python",
    "go",
    "rust",
  ]);
  expect(Object.keys(signalflareOagenPlugin.smokeRunners).sort()).toEqual([
    "go",
    "node",
    "python",
    "rust",
  ]);
  expect(signalflareOagenPlugin.extractors).toHaveLength(4);
});
