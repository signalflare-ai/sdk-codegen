import { expect, test } from "bun:test";

const PROMISE_TARGET_TEMPLATE = "src/emitters/typescript/runtime.ts";

test("keeps compiler orchestration Effect-native", async () => {
  const violations: string[] = [];
  const glob = new Bun.Glob("src/**/*.ts");

  for await (const path of glob.scan({ cwd: process.cwd(), onlyFiles: true })) {
    if (path === PROMISE_TARGET_TEMPLATE) continue;
    const source = await Bun.file(path).text();
    if (source.includes("Effect.runPromise")) violations.push(`${path}: Effect.runPromise`);
    if (source.includes('from "node:fs/promises"')) violations.push(`${path}: node:fs/promises`);
    if (/export\s+async\s+function/.test(source))
      violations.push(`${path}: exported async function`);
  }

  expect(violations).toEqual([]);
});
