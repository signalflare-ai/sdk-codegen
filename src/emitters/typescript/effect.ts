import type { GeneratedFile } from "@workos/oagen";
import { OAGEN_EMITTERS_VERSION } from "../../version.js";
import type { SignalflareTypeScriptEmitterOptions } from "./index.js";

function drift(label: string): never {
  throw new Error(
    `Unable to generate native Effect resources from @workos/oagen-emitters@${OAGEN_EMITTERS_VERSION}: ${label}. See UPSTREAM.md.`,
  );
}

/** Pinned resource-only transform; Oagen still owns signatures, docs and serializers. */
export function generateEffectResources(files: readonly GeneratedFile[]): GeneratedFile[] {
  return files.flatMap((file) => {
    if (!file.content.includes("constructor(private readonly workos: WorkOS)")) return [];
    if (file.content.includes("AutoPaginatable")) drift("automatic pagination must be disabled");
    let methods = 0;
    const methodPattern = /^  async (\w+)\(([\s\S]*?)\): Promise<([^\n]+)> \{\n([\s\S]*?)^  \}/gm;
    const content = file.content.replace(
      methodPattern,
      (_match, name: string, params: string, result: string, body: string) => {
        methods++;
        const awaits = body.match(/\bawait\s+/g)?.length ?? 0;
        const transportAwaits =
          body.match(/\bawait this\.workos\.(?:get|post|put|patch|delete|deleteWithBody)(?:<|\()/g)
            ?.length ?? 0;
        if (awaits !== transportAwaits) drift(`unsupported async body in ${file.path}:${name}`);
        const transformed = body
          .replaceAll("this.workos", "client")
          .replace(/\bawait\s+/g, "yield* ")
          .replace(
            /\b(serialize\w+)\(([^;\n]*)\)/g,
            "(yield* Effect.try({ try: () => $1($2), catch: (cause) => new SdkRequestError({ cause }) }))",
          )
          .replace(
            /^    return ([\s\S]*?);$/gm,
            (_return, expression: string) =>
              `    return yield* Effect.try({\n      try: () => ${expression},\n      catch: (cause) => new SdkDecodeError({ cause }),\n    });`,
          );
        return `  ${name}(${params}${params.trim() ? ", " : ""}sdkRequestOptions: EffectRequestOptions = {}): Effect.Effect<${result}, SdkError> {\n    const client = this.workos.withRequestOptions(sdkRequestOptions);\n    return Effect.gen(function* () {\n${transformed
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n")}    }).pipe(Effect.withSpan(${JSON.stringify(name)}));\n  }`;
      },
    );
    const expected = file.content.match(/^  async /gm)?.length ?? 0;
    if (methods === 0 || methods !== expected) drift(`method count mismatch in ${file.path}`);
    if (!content.includes("from '../workos';"))
      drift(`resource client import changed in ${file.path}`);
    return [
      {
        ...file,
        path: file.path.replace(/\.ts$/, ".effect.ts"),
        content: `import { Effect } from 'effect';\nimport { SdkDecodeError, SdkRequestError, type SdkError, type EffectRequestOptions } from '../effect-runtime';\n${content.replace("from '../workos';", "from '../effect-client';").replaceAll("@returns {Promise<", "@returns {Effect.Effect<")}`,
        overwriteExisting: true,
      },
    ];
  });
}

export function generateEffectClient(
  files: readonly GeneratedFile[],
  options: SignalflareTypeScriptEmitterOptions,
): GeneratedFile[] {
  const client = files.find((file) => file.path === "src/workos.ts");
  const index = files.find((file) => file.path === "src/index.ts");
  if (!client || !index) drift("missing root client or index");
  const baseImport = "import { WorkOSBase } from './common/workos-base';";
  if (!client.content.includes(baseImport)) drift("root client base import changed");
  let clientContent = client.content
    .replace(
      baseImport,
      "import { Context, Layer } from 'effect';\nimport { EffectClientBase, type EffectClientOptions } from './effect-runtime';",
    )
    .replace(/^import type \{ WorkOSOptions \} from '[^']+';\n/m, "")
    .replaceAll("WorkOSOptions", "EffectClientOptions")
    .replace("extends WorkOSBase", "extends EffectClientBase")
    .replace(/(import \{ [^\n]+ \} from '\.\/[^'/]+\/[^']+)(';)/g, "$1.effect$2");
  const serviceName = options.clientClassName.replace(/Client$/, "");
  clientContent += `\n\n/** Effect v4 service for the ${options.productId} API. No network I/O occurs during acquisition. */\nexport class ${serviceName} extends Context.Service<${serviceName}, WorkOS>()(${JSON.stringify(`${options.packageName}/effect`)}) {\n  static layer(options: EffectClientOptions = {}): Layer.Layer<${serviceName}> {\n    return Layer.sync(${serviceName}, () => new WorkOS(options));\n  }\n}\n`;
  const exports = index.content
    .split("\n")
    .filter(
      (line) =>
        (line.startsWith("export * from '") && line.includes("/interfaces")) ||
        (line.startsWith("export type") &&
          !line.includes("workos-options") &&
          !line.includes("utils/pagination")) ||
        line.includes("operationManifest"),
    )
    .join("\n");
  return [
    { path: "src/effect-client.ts", content: clientContent, overwriteExisting: true },
    {
      path: "src/effect.ts",
      content: `${exports}\nexport { WorkOS as ${options.clientClassName.replace(/Client$/, "EffectClient")}, ${serviceName} } from './effect-client';\nexport * from './effect-runtime';\n`,
      overwriteExisting: true,
    },
  ];
}

export function generateEffectRuntime(
  options: SignalflareTypeScriptEmitterOptions,
): GeneratedFile[] {
  return [
    { path: "src/effect-runtime.ts", content: renderRuntime(options), overwriteExisting: true },
    {
      path: "EFFECT.md",
      content:
        "# Native Effect v4 SDK\n\nInstall stable Effect v4 with `bun add effect@4.0.0`. Import the service from\n`src/effect.ts` or your product-owned package's `/effect` subpath.\n\nThe Promise entrypoint has no Effect dependency. Both surfaces share Oagen\nmodels and serializers. Add an optional `effect: ^4.0.0` peer dependency and\na separate `./effect` package export in your product-owned manifest.\nRequests, credential providers, interruption, timeouts and typed errors are\nnative Effects. No retries are enabled by default.\n",
      overwriteExisting: true,
      headerPlacement: "skip",
    },
  ];
}

function renderRuntime(options: SignalflareTypeScriptEmitterOptions): string {
  return `import { Effect, Schema } from 'effect';
import { authPlan } from './common/auth-plan';
import type { CredentialContext } from './common/interfaces/workos-options.interface';
import type { GetOptions } from './common/interfaces/get-options.interface';
import type { PostOptions } from './common/interfaces/post-options.interface';
import { appendQuery } from './common/wire';

export type { CredentialContext } from './common/interfaces/workos-options.interface';
export type EffectCredentialProvider = (context: CredentialContext) => Effect.Effect<string | undefined, unknown>;
export type EffectCredential = string | EffectCredentialProvider;

/** Client credentials are evaluated afresh inside each request Effect. */
export interface EffectClientOptions {
  baseURL?: string | undefined;
  token?: EffectCredential | undefined;
  apiKey?: EffectCredential | undefined;
  credentials?: Readonly<Record<string, EffectCredential | undefined>> | undefined;
  fetch?: typeof globalThis.fetch | undefined;
  headers?: HeadersInit | undefined;
  timeoutMs?: number | undefined;
}

/** Overrides apply to one resource call, including its response-body read. */
export interface EffectRequestOptions extends PostOptions {}

export class SdkApiError extends Schema.TaggedError<SdkApiError>()('SdkApiError', {
  status: Schema.Number,
  message: Schema.String,
  code: Schema.UndefinedOr(Schema.String),
  requestId: Schema.UndefinedOr(Schema.String),
  details: Schema.Unknown,
  body: Schema.String,
}) {}
export class SdkMissingCredentialError extends Schema.TaggedError<SdkMissingCredentialError>()('SdkMissingCredentialError', {
  operationId: Schema.UndefinedOr(Schema.String),
  alternatives: Schema.Array(Schema.Array(Schema.String)),
}) {}
export class SdkCredentialError extends Schema.TaggedError<SdkCredentialError>()('SdkCredentialError', {
  scheme: Schema.String, cause: Schema.Unknown,
}) {}
export class SdkTransportError extends Schema.TaggedError<SdkTransportError>()('SdkTransportError', { cause: Schema.Unknown }) {}
export class SdkDecodeError extends Schema.TaggedError<SdkDecodeError>()('SdkDecodeError', {
  cause: Schema.Unknown,
  status: Schema.optionalKey(Schema.Number),
  body: Schema.optionalKey(Schema.String),
}) {}
export class SdkRequestError extends Schema.TaggedError<SdkRequestError>()('SdkRequestError', { cause: Schema.Unknown }) {}
export class SdkTimeoutError extends Schema.TaggedError<SdkTimeoutError>()('SdkTimeoutError', { timeoutMs: Schema.Number }) {}
export type SdkError = SdkApiError | SdkMissingCredentialError | SdkCredentialError | SdkTransportError | SdkDecodeError | SdkRequestError | SdkTimeoutError;

const MAX_ERROR_BODY_LENGTH = 64 * 1024;
const DEFAULT_BASE_URL = ${JSON.stringify(options.defaultBaseUrl)};

function pathMatches(template: string, path: string): boolean {
  const expected = template.split('/').filter(Boolean);
  const actual = path.split('/').filter(Boolean);
  return expected.length === actual.length && expected.every((part, i) => part.startsWith('{') && part.endsWith('}') || part === actual[i]);
}

function resolveAuth(options: EffectClientOptions, method: string, path: string) {
  return Effect.gen(function* () {
    const operation = authPlan.operations.find((entry) => entry.method === method && pathMatches(entry.path, path));
    const alternatives = operation?.alternatives ?? authPlan.defaults;
    if (alternatives.length === 0) return { headers: {}, query: [] } as { headers: Record<string, string>; query: Array<[string, string]> };
    const schemes = new Map(authPlan.schemes.map((scheme) => [scheme.id, scheme]));
    const values = new Map<string, string | undefined>();
    for (const alternative of alternatives) {
      const headers: Record<string, string> = {};
      const query: Array<[string, string]> = [];
      let complete = true;
      for (const id of alternative.schemes) {
        const scheme = schemes.get(id);
        if (!scheme) { complete = false; break; }
        if (!values.has(id)) {
          const configured = options.credentials?.[id] ?? (scheme.kind === 'bearer' ? options.token : options.apiKey);
          const context = { method, path: operation?.path ?? path, operationId: operation?.operationId, scheme: id };
          const value = typeof configured === 'function'
            ? yield* Effect.try({ try: () => configured(context), catch: (cause) => new SdkCredentialError({ scheme: id, cause }) }).pipe(Effect.flatten, Effect.mapError((cause) => cause instanceof SdkCredentialError ? cause : new SdkCredentialError({ scheme: id, cause })))
            : configured;
          values.set(id, value);
        }
        const value = values.get(id);
        if (!value) { complete = false; break; }
        if (scheme.kind === 'bearer') headers.Authorization = 'Bearer ' + value;
        else if (scheme.in === 'header') headers[scheme.name] = value;
        else if (scheme.in === 'query') query.push([scheme.name, value]);
        else { const next = scheme.name + '=' + encodeURIComponent(value); headers.Cookie = headers.Cookie ? headers.Cookie + '; ' + next : next; }
      }
      if (complete) return { headers, query };
    }
    return yield* Effect.fail(new SdkMissingCredentialError({ operationId: operation?.operationId, alternatives: alternatives.map((a) => a.schemes) }));
  });
}

/** Native Effect transport. Promise boundaries are confined to fetch and body reads. */
export class EffectClientBase {
  readonly baseURL: string;
  readonly key: string | undefined;
  constructor(readonly options: EffectClientOptions = {}, private readonly requestOptions: EffectRequestOptions = {}) {
    this.baseURL = options.baseURL ?? DEFAULT_BASE_URL;
    this.key = typeof options.apiKey === 'string' ? options.apiKey : undefined;
  }
  protected setAuthHeaders(_headers: Record<string, string>): void {}

  withRequestOptions(options: EffectRequestOptions): EffectClientBase {
    return new EffectClientBase(this.options, options);
  }

  private request<Result>(method: string, path: string, entity: unknown, overrides: GetOptions | PostOptions = {}): Effect.Effect<{ data: Result }, SdkError> {
    const options = this.options;
    const local = this.requestOptions;
    const timeoutMs = local.timeoutMs ?? overrides.timeoutMs ?? options.timeoutMs;
    const request = Effect.gen(function* () {
      const operation = authPlan.operations.find((entry) => entry.method === method && pathMatches(entry.path, path));
      yield* Effect.annotateCurrentSpan({ 'sdk.product': ${JSON.stringify(options.productId)}, 'sdk.operation': operation?.operationId ?? method, 'http.request.method': method, 'http.route': operation?.path ?? path });
      const auth = yield* resolveAuth(options, method, path);
      const prepared = yield* Effect.try({
        try: () => {
          const url = new URL(path, options.baseURL ?? DEFAULT_BASE_URL);
          appendQuery(url, { ...overrides.query, ...local.query });
          for (const [name, value] of auth.query) url.searchParams.set(name, value);
          const headers = new Headers(options.headers);
          new Headers(overrides.headers).forEach((value, name) => headers.set(name, value));
          new Headers(local.headers).forEach((value, name) => headers.set(name, value));
          headers.set('Accept', 'application/json');
          headers.set('X-Signalflare-SDK', ${JSON.stringify(`${options.productId}/${options.sdkVersion} (typescript-effect; sdk-codegen/${options.compilerVersion})`)});
          for (const [name, value] of Object.entries(auth.headers)) headers.set(name, value);
          const idempotencyKey = local.idempotencyKey ?? ('idempotencyKey' in overrides ? overrides.idempotencyKey : undefined);
          if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
          if (entity !== undefined) headers.set('Content-Type', 'application/json');
          return { url, headers, body: entity === undefined ? undefined : JSON.stringify(entity) };
        },
        catch: (cause) => new SdkRequestError({ cause }),
      });
      const { response, rawBody } = yield* Effect.tryPromise({
        try: async (signal) => {
          const fetchFn = options.fetch ?? globalThis.fetch;
          const response = await fetchFn(prepared.url, { method, headers: prepared.headers, ...(prepared.body === undefined ? {} : { body: prepared.body }), signal });
          const rawBody = await response.text();
          return { response, rawBody };
        },
        catch: (cause) => new SdkTransportError({ cause }),
      });
      const requestId = response.headers.get('x-request-id') ?? undefined;
      yield* Effect.annotateCurrentSpan({ 'http.response.status_code': response.status, ...(requestId === undefined ? {} : { 'http.response.request_id': requestId }) });
      if (!response.ok) {
        let decoded: Record<string, unknown> = {};
        try { const value: unknown = JSON.parse(rawBody); if (value !== null && typeof value === 'object' && !Array.isArray(value)) decoded = value as Record<string, unknown>; } catch { /* Preserve bounded evidence. */ }
        return yield* Effect.fail(new SdkApiError({
          status: response.status,
          message: typeof decoded.message === 'string' ? decoded.message : 'API request failed with status ' + response.status + '.',
          code: typeof decoded.code === 'string' ? decoded.code : undefined,
           requestId: requestId ?? (typeof decoded.requestId === 'string' ? decoded.requestId : typeof decoded.request_id === 'string' ? decoded.request_id : undefined),
          details: decoded.details,
          body: rawBody.slice(0, MAX_ERROR_BODY_LENGTH),
        }));
      }
      if (response.status === 204 || rawBody.length === 0) return { data: undefined as Result };
      const data = yield* Effect.try({ try: () => JSON.parse(rawBody) as Result, catch: (cause) => new SdkDecodeError({ status: response.status, body: rawBody.slice(0, MAX_ERROR_BODY_LENGTH), cause }) });
      return { data };
    }).pipe(Effect.withSpan('sdk.request'));
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) return Effect.fail(new SdkRequestError({ cause: 'timeoutMs must be finite and non-negative.' }));
    return timeoutMs === undefined ? request : request.pipe(Effect.timeoutOrElse({ duration: timeoutMs, orElse: () => Effect.fail(new SdkTimeoutError({ timeoutMs })) }));
  }

  get<Result>(path: string, options: GetOptions = {}) { return this.request<Result>('GET', path, undefined, options); }
  post<Result, Entity>(path: string, entity: Entity, options: PostOptions = {}) { return this.request<Result>('POST', path, entity, options); }
  put<Result, Entity>(path: string, entity: Entity, options: PostOptions = {}) { return this.request<Result>('PUT', path, entity, options); }
  patch<Result, Entity>(path: string, entity: Entity, options: PostOptions = {}) { return this.request<Result>('PATCH', path, entity, options); }
  delete(path: string, query?: Record<string, string | number | boolean | undefined>) { return this.request<void>('DELETE', path, undefined, query === undefined ? {} : { query }).pipe(Effect.asVoid); }
  deleteWithBody<Entity>(path: string, entity: Entity) { return this.request<void>('DELETE', path, entity).pipe(Effect.asVoid); }
}
`;
}
