import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Deferred, Effect, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";
import { CompilerLive, generateConfiguredSdks } from "../src/index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

interface Client {
  widgets: {
    getWidget(
      input: { widgetId: string },
      options?: { timeoutMs?: number },
    ): Effect.Effect<unknown, { _tag: string; status?: number; code?: string }>;
  };
  jobs: { createJob(input: Record<string, unknown>): Effect.Effect<unknown, { _tag: string }> };
}

async function generateClient() {
  await mkdir(".tmp", { recursive: true });
  const directory = await mkdtemp(resolve(".tmp/effect-sdk-test-"));
  directories.push(directory);
  const output = join(directory, "sdk");
  const configPath = join(directory, "sdk.config.ts");
  await writeFile(
    configPath,
    `export default ${JSON.stringify({
      product: {
        id: "runtime-conformance",
        displayName: "Runtime Conformance",
        sdkVersion: "1.2.3",
      },
      contract: { spec: resolve("fixtures/contracts/runtime-conformance.openapi.json") },
      profiles: { access: { includeAudiences: ["access"] } },
      targets: {
        typescript: {
          output,
          profiles: ["access"],
          packageName: "@signalflare-ai/runtime-conformance",
          effect: true,
        },
      },
    })};\n`,
  );
  const report = await Effect.runPromise(
    generateConfiguredSdks({ configPath, quiet: true }).pipe(Effect.provide(CompilerLive)),
  );
  const module = (await import(pathToFileURL(join(output, "src/effect.ts")).href)) as {
    RuntimeConformanceEffectClient: new (options: Record<string, unknown>) => Client;
  };
  return { output, report, module };
}

describe("generated native Effect client", () => {
  test("strictly typechecks both entrypoints and shares models/serialization", async () => {
    const { output, report, module } = await generateClient();
    expect(report.targets[0]?.warnings).toEqual([]);
    await writeFile(
      join(output, "usage.ts"),
      `import { Effect } from 'effect';
import { RuntimeConformance, SdkApiError } from './src/effect';
export const program = Effect.gen(function* () {
  const client = yield* RuntimeConformance;
  return yield* client.widgets.getWidget({ widgetId: 'one' }, { timeoutMs: 100 });
}).pipe(Effect.provide(RuntimeConformance.layer({ token: () => Effect.succeed('access') })),
  Effect.catchTag('SdkApiError', error => Effect.succeed(error.status)));
export const apiError: SdkApiError = new SdkApiError({ status: 404, message: 'missing', code: undefined, requestId: undefined, details: undefined, body: '' });
`,
    );
    const check = Bun.spawn(
      [
        "bunx",
        "tsc",
        "--ignoreConfig",
        "--noEmit",
        "--strict",
        "--exactOptionalPropertyTypes",
        "--noUncheckedIndexedAccess",
        "--skipLibCheck",
        "--target",
        "ES2023",
        "--lib",
        "ES2023,DOM,DOM.Iterable",
        "--module",
        "ESNext",
        "--moduleResolution",
        "Bundler",
        join(output, "src/index.ts"),
        join(output, "src/effect.ts"),
        join(output, "usage.ts"),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [exit, stdout, stderr] = await Promise.all([
      check.exited,
      new Response(check.stdout).text(),
      new Response(check.stderr).text(),
    ]);
    expect(stdout + stderr).toBe("");
    expect(exit).toBe(0);
    const requests: RequestInit[] = [];
    const client = new module.RuntimeConformanceEffectClient({
      token: () => Effect.succeed("access"),
      fetch: async (_url: URL, init: RequestInit) => {
        requests.push(init);
        return Response.json({ widget_id: "one", display_name: "One", state: "ready" });
      },
    });
    const program = client.widgets.getWidget({ widgetId: "one" });
    expect(requests).toHaveLength(0);
    await Effect.runPromise(program);
    expect(new Headers(requests[0]?.headers).get("authorization")).toBe("Bearer access");
    expect(new Headers(requests[0]?.headers).get("x-signalflare-sdk")).toContain(
      "runtime-conformance/1.2.3",
    );
    expect(await readFile(join(output, "src/index.ts"), "utf8")).not.toContain("from 'effect'");
  });

  test("returns expected failures in the typed channel before or after I/O", async () => {
    const { module } = await generateClient();
    let calls = 0;
    const fetch = async () => {
      calls++;
      return Response.json({ code: "NOT_FOUND", message: "missing" }, { status: 404 });
    };
    const missing = new module.RuntimeConformanceEffectClient({ fetch });
    const missingResult = await Effect.runPromise(
      Effect.result(missing.widgets.getWidget({ widgetId: "one" })),
    );
    expect(Result.isFailure(missingResult) && missingResult.failure._tag).toBe(
      "SdkMissingCredentialError",
    );
    expect(calls).toBe(0);
    const client = new module.RuntimeConformanceEffectClient({ token: "access", fetch });
    const apiResult = await Effect.runPromise(
      Effect.result(client.widgets.getWidget({ widgetId: "one" })),
    );
    expect(Result.isFailure(apiResult) && apiResult.failure).toMatchObject({
      _tag: "SdkApiError",
      status: 404,
      code: "NOT_FOUND",
    });
    const malformed = new module.RuntimeConformanceEffectClient({
      token: "access",
      fetch: async () => new Response("not json"),
    });
    const decode = await Effect.runPromise(
      Effect.result(malformed.widgets.getWidget({ widgetId: "one" })),
    );
    expect(Result.isFailure(decode) && decode.failure._tag).toBe("SdkDecodeError");
    const rejected = new module.RuntimeConformanceEffectClient({
      token: () => Effect.fail("credential unavailable"),
      fetch,
    });
    const credential = await Effect.runPromise(
      Effect.result(rejected.widgets.getWidget({ widgetId: "one" })),
    );
    expect(Result.isFailure(credential) && credential.failure._tag).toBe("SdkCredentialError");
    const throwing = new module.RuntimeConformanceEffectClient({
      token: () => {
        throw new Error("provider failed");
      },
      fetch,
    });
    const thrown = await Effect.runPromise(
      Effect.result(throwing.widgets.getWidget({ widgetId: "one" })),
    );
    expect(Result.isFailure(thrown) && thrown.failure._tag).toBe("SdkCredentialError");
    const transport = new module.RuntimeConformanceEffectClient({
      token: "access",
      fetch: async () => {
        throw new Error("offline");
      },
    });
    const offline = await Effect.runPromise(
      Effect.result(transport.widgets.getWidget({ widgetId: "one" })),
    );
    expect(Result.isFailure(offline) && offline.failure._tag).toBe("SdkTransportError");
  });

  test("interruption aborts the HTTP request without affecting another call", async () => {
    const { module } = await generateClient();
    await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<AbortSignal>();
        const client = new module.RuntimeConformanceEffectClient({
          token: "access",
          fetch: (url: URL, init: RequestInit) => {
            if (url.pathname.endsWith("two"))
              return Promise.resolve(
                Response.json({ id: "two", name: "Two", created_at: "2026-01-01" }),
              );
            const signal = init.signal;
            if (!signal) throw new Error("missing abort signal");
            Effect.runSync(Deferred.succeed(started, signal));
            return new Promise<Response>((_resolve, reject) =>
              signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
            );
          },
        });
        const fiber = yield* Effect.forkChild(client.widgets.getWidget({ widgetId: "one" }));
        const signal = yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        expect(signal.aborted).toBe(true);
        const result = yield* Effect.result(client.widgets.getWidget({ widgetId: "two" }));
        expect(Result.isSuccess(result)).toBe(true);
      }),
    );
  });

  test("timeout includes credential resolution, using the virtual clock", async () => {
    const { module } = await generateClient();
    await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        let calls = 0;
        const client = new module.RuntimeConformanceEffectClient({
          timeoutMs: 50,
          token: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
          fetch: async () => {
            calls++;
            return Response.json({});
          },
        });
        const fiber = yield* Effect.forkChild(
          Effect.result(client.widgets.getWidget({ widgetId: "one" })),
        );
        yield* Deferred.await(started);
        yield* TestClock.adjust(50);
        const result = yield* Fiber.join(fiber);
        expect(Result.isFailure(result) && result.failure._tag).toBe("SdkTimeoutError");
        expect(calls).toBe(0);
      }).pipe(Effect.provide(TestClock.layer())),
    );
  });

  test("per-call timeout covers response-body reads and aborts transport", async () => {
    const { module } = await generateClient();
    await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<AbortSignal>();
        const client = new module.RuntimeConformanceEffectClient({
          token: "access",
          fetch: async (_url: URL, init: RequestInit) => {
            const signal = init.signal;
            if (!signal) throw new Error("missing signal");
            const activeSignal: AbortSignal = signal;
            class SlowResponse extends Response {
              override readonly text = () => {
                Effect.runSync(Deferred.succeed(started, activeSignal));
                return new Promise<string>((_resolve, reject) =>
                  activeSignal.addEventListener("abort", () => reject(activeSignal.reason), {
                    once: true,
                  }),
                );
              };
            }
            return new SlowResponse("{}");
          },
        });
        const fiber = yield* Effect.forkChild(
          Effect.result(client.widgets.getWidget({ widgetId: "one" }, { timeoutMs: 50 })),
        );
        const signal = yield* Deferred.await(started);
        yield* TestClock.adjust(50);
        const result = yield* Fiber.join(fiber);
        expect(Result.isFailure(result) && result.failure._tag).toBe("SdkTimeoutError");
        expect(signal.aborted).toBe(true);
      }).pipe(Effect.provide(TestClock.layer())),
    );
  });
});
