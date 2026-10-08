import type { AuthPlan } from "../../contract/auth.js";

export interface TypeScriptRuntimeOptions {
  authPlan: AuthPlan;
  defaultBaseUrl: string;
  compilerVersion: string;
  sdkVersion: string;
  productId: string;
  packageName: string;
}

interface RuntimeFile {
  path: string;
  content: string;
}

function renderClientOptions(): string {
  return `export interface CredentialContext {
  method: string;
  path: string;
  operationId: string | undefined;
  scheme: string;
}

export type CredentialProvider = (
  context: CredentialContext,
) => string | undefined | Promise<string | undefined>;

export type Credential = string | CredentialProvider;

export interface WorkOSOptions {
  baseURL?: string;
  token?: Credential;
  apiKey?: Credential;
  credentials?: Record<string, Credential | undefined>;
  fetch?: typeof globalThis.fetch;
  headers?: HeadersInit;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type ClientOptions = WorkOSOptions;
`;
}

function renderRequestOptions(): RuntimeFile[] {
  return [
    {
      path: "src/common/interfaces/get-options.interface.ts",
      content: `export interface GetOptions {
  query?: Record<string, unknown>;
  headers?: HeadersInit;
  timeoutMs?: number;
}
`,
    },
    {
      path: "src/common/interfaces/post-options.interface.ts",
      content: `export interface PostOptions {
  query?: Record<string, unknown>;
  headers?: HeadersInit;
  timeoutMs?: number;
  idempotencyKey?: string;
}
`,
    },
    {
      path: "src/common/interfaces/put-options.interface.ts",
      content: `import type { PostOptions } from './post-options.interface';
export type PutOptions = PostOptions;
`,
    },
    {
      path: "src/common/interfaces/patch-options.interface.ts",
      content: `import type { PostOptions } from './post-options.interface';
export type PatchOptions = PostOptions;
`,
    },
    {
      path: "src/common/interfaces/pagination-options.interface.ts",
      content: `export interface PaginationOptions {
  limit?: number;
  before?: string;
  after?: string;
  order?: 'asc' | 'desc';
}
`,
    },
  ];
}

function renderExceptions(): string {
  return `export interface ApiErrorOptions {
  status: number;
  code?: string;
  requestId?: string;
  details?: unknown;
  body?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly requestId: string | undefined;
  readonly details: unknown;
  readonly body: string | undefined;

  constructor(message: string, options: ApiErrorOptions) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.details = options.details;
    this.body = options.body;
  }
}

export class AuthenticationException extends ApiError {}
export class UnauthorizedException extends AuthenticationException {}
export class AuthorizationException extends ApiError {}
export class BadRequestException extends ApiError {}
export class NotFoundException extends ApiError {}
export class ConflictException extends ApiError {}
export class UnprocessableEntityException extends ApiError {}
export class RateLimitExceededException extends ApiError {}
export class GenericServerException extends ApiError {}

export class MissingCredentialError extends Error {
  constructor(readonly operationId: string | undefined, readonly alternatives: readonly string[][]) {
    super(
      operationId
        ? \`Missing credentials for operation \${operationId}.\`
        : 'Missing credentials for API request.',
    );
    this.name = 'MissingCredentialError';
  }
}

export class ResponseDecodeError extends Error {
  constructor(readonly status: number, readonly body: string, options?: ErrorOptions) {
    super(\`Unable to decode JSON response with status \${status}.\`, options);
    this.name = 'ResponseDecodeError';
  }
}

export class RequestError extends Error {}
export class TransportError extends Error {}
export class RequestTimeoutError extends TransportError {}
`;
}

function renderAuthTypes(): string {
  return `import type { Credential, CredentialContext, WorkOSOptions } from './interfaces/workos-options.interface';
import { MissingCredentialError } from './exceptions';

export type AuthScheme =
  | { id: string; kind: 'bearer' }
  | { id: string; kind: 'apiKey'; in: 'header' | 'query' | 'cookie'; name: string };

export interface AuthPlan {
  schemes: AuthScheme[];
  defaults: Array<{ schemes: string[] }>;
  operations: Array<{
    method: string;
    path: string;
    operationId: string;
    alternatives: Array<{ schemes: string[] }>;
  }>;
}

export interface ResolvedAuth {
  headers: Record<string, string>;
  query: Array<[string, string]>;
}

function pathMatches(template: string, actual: string): boolean {
  const templateParts = template.split('/').filter(Boolean);
  const actualParts = actual.split('/').filter(Boolean);
  return (
    templateParts.length === actualParts.length &&
    templateParts.every((part, index) =>
      part.startsWith('{') && part.endsWith('}') ? true : part === actualParts[index],
    )
  );
}

async function resolveCredential(
  credential: Credential | undefined,
  context: CredentialContext,
): Promise<string | undefined> {
  const value = typeof credential === 'function' ? await credential(context) : credential;
  return value && value.length > 0 ? value : undefined;
}

export async function resolveAuth(
  plan: AuthPlan,
  options: WorkOSOptions,
  method: string,
  path: string,
): Promise<ResolvedAuth> {
  const operation = plan.operations.find(
    (entry) => entry.method === method && pathMatches(entry.path, path),
  );
  const alternatives = operation?.alternatives ?? plan.defaults;
  if (alternatives.length === 0) return { headers: {}, query: [] };
  const schemes = new Map(plan.schemes.map((scheme) => [scheme.id, scheme]));

  for (const alternative of alternatives) {
    const headers: Record<string, string> = {};
    const query: Array<[string, string]> = [];
    let complete = true;

    for (const schemeId of alternative.schemes) {
      const scheme = schemes.get(schemeId);
      if (!scheme) {
        complete = false;
        break;
      }
      const configured =
        options.credentials?.[schemeId] ??
        (scheme.kind === 'bearer' ? options.token : options.apiKey);
      const credential = await resolveCredential(configured, {
        method,
        path,
        operationId: operation?.operationId,
        scheme: schemeId,
      });
      if (!credential) {
        complete = false;
        break;
      }

      if (scheme.kind === 'bearer') headers.Authorization = \`Bearer \${credential}\`;
      else if (scheme.in === 'header') headers[scheme.name] = credential;
      else if (scheme.in === 'query') query.push([scheme.name, credential]);
      else {
        const next = \`\${scheme.name}=\${encodeURIComponent(credential)}\`;
        headers.Cookie = headers.Cookie ? \`\${headers.Cookie}; \${next}\` : next;
      }
    }

    if (complete) return { headers, query };
  }

  throw new MissingCredentialError(
    operation?.operationId,
    alternatives.map((alternative) => alternative.schemes),
  );
}
`;
}

function renderAuthPlan(plan: AuthPlan): string {
  return `import type { AuthPlan } from './auth';

export const authPlan: AuthPlan = ${JSON.stringify(plan, null, 2)};
`;
}

function renderClientBase(options: TypeScriptRuntimeOptions): string {
  return `import { authPlan } from './auth-plan';
import { resolveAuth } from './auth';
import {
  ApiError,
  AuthenticationException,
  AuthorizationException,
  BadRequestException,
  ConflictException,
  GenericServerException,
  NotFoundException,
  RateLimitExceededException,
  RequestError,
  RequestTimeoutError,
  ResponseDecodeError,
  TransportError,
  UnprocessableEntityException,
} from './exceptions';
import type { GetOptions } from './interfaces/get-options.interface';
import type { PatchOptions } from './interfaces/patch-options.interface';
import type { PostOptions } from './interfaces/post-options.interface';
import type { PutOptions } from './interfaces/put-options.interface';
import type { WorkOSOptions } from './interfaces/workos-options.interface';

const MAX_ERROR_BODY_LENGTH = 64 * 1024;
const DEFAULT_BASE_URL = ${JSON.stringify(options.defaultBaseUrl)};

import { appendQuery } from './wire';

function errorClass(status: number): typeof ApiError {
  if (status === 400) return BadRequestException;
  if (status === 401) return AuthenticationException;
  if (status === 403) return AuthorizationException;
  if (status === 404) return NotFoundException;
  if (status === 409) return ConflictException;
  if (status === 422) return UnprocessableEntityException;
  if (status === 429) return RateLimitExceededException;
  return GenericServerException;
}

export class WorkOSBase {
  protected readonly key: string | undefined;
  private readonly options: WorkOSOptions;
  private readonly fetchFn: typeof globalThis.fetch;
  readonly baseURL: string;

  constructor(options: WorkOSOptions = {}) {
    this.options = options;
    this.key = typeof options.apiKey === 'string' ? options.apiKey : undefined;
    this.baseURL = options.baseURL ?? DEFAULT_BASE_URL;
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  protected setAuthHeaders(_headers: Record<string, string>): void {}

  private async request<Result, Entity = never>(
    method: string,
    path: string,
    entity: Entity | undefined,
    requestOptions: GetOptions | PostOptions = {},
  ): Promise<{ data: Result }> {
    const signals: AbortSignal[] = this.options.signal ? [this.options.signal] : [];
    const timeoutMs = requestOptions.timeoutMs ?? this.options.timeoutMs;
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) {
      throw new RequestError('timeoutMs must be a finite non-negative number.');
    }
    const timeout = timeoutMs === undefined ? undefined : new AbortController();
    if (timeout) signals.push(timeout.signal);
    const signal = signals.length ? AbortSignal.any(signals) : undefined;
    const timer = timeout && timeoutMs !== undefined
      ? setTimeout(() => timeout.abort(new RequestTimeoutError('SDK request timed out.')), timeoutMs)
      : undefined;
    try {
    signal?.throwIfAborted();
    let url: URL;
    let body: string | undefined;
    try {
      url = new URL(path, this.baseURL.endsWith('/') ? this.baseURL : \`\${this.baseURL}/\`);
      appendQuery(url, requestOptions.query);
      body = entity === undefined ? undefined : JSON.stringify(entity);
    } catch (cause) {
      throw new RequestError('Unable to serialize SDK request.', { cause });
    }
    const resolvedAuth = await resolveAuth(authPlan, this.options, method, path);
    signal?.throwIfAborted();
    for (const [name, value] of resolvedAuth.query) url.searchParams.append(name, value);

    const headers = new Headers(this.options.headers);
    new Headers(requestOptions.headers).forEach((value, name) => headers.set(name, value));
    headers.set('Accept', 'application/json');
    headers.set('X-Signalflare-SDK', ${JSON.stringify(
      `${options.productId}/${options.sdkVersion} (typescript; sdk-codegen/${options.compilerVersion})`,
    )});
    for (const [name, value] of Object.entries(resolvedAuth.headers)) headers.set(name, value);
    if ('idempotencyKey' in requestOptions && requestOptions.idempotencyKey) {
      headers.set('Idempotency-Key', requestOptions.idempotencyKey);
    }
    if (entity !== undefined) headers.set('Content-Type', 'application/json');

    let response: Response;
    let rawBody: string;
    try {
      response = await this.fetchFn(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        ...(signal === undefined ? {} : { signal }),
      });
      rawBody = await response.text();
      signal?.throwIfAborted();
    } catch (cause) {
      if (timeout?.signal.aborted) throw new RequestTimeoutError('SDK request timed out.', { cause });
      throw new TransportError('SDK transport failed.', { cause });
    }

    if (!response.ok) {
      let decoded: Record<string, unknown> = {};
      try {
        const value: unknown = rawBody ? JSON.parse(rawBody) : {};
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) decoded = value as Record<string, unknown>;
      } catch {
        // Preserve the bounded raw response below.
      }
      const ErrorType = errorClass(response.status);
       const requestId = response.headers.get('x-request-id') ?? (typeof decoded.requestId === 'string' ? decoded.requestId : typeof decoded.request_id === 'string' ? decoded.request_id : undefined);
      throw new ErrorType(
        typeof decoded.message === 'string' ? decoded.message : \`API request failed with status \${response.status}.\`,
        {
          status: response.status,
          ...(typeof decoded.code === 'string' ? { code: decoded.code } : {}),
          ...(requestId ? { requestId } : {}),
          ...(decoded.details === undefined ? {} : { details: decoded.details }),
          body: rawBody.slice(0, MAX_ERROR_BODY_LENGTH),
        },
      );
    }

    if (response.status === 204 || rawBody.length === 0) return { data: undefined as Result };
    try {
      return { data: JSON.parse(rawBody) as Result };
    } catch (error) {
      throw new ResponseDecodeError(response.status, rawBody.slice(0, MAX_ERROR_BODY_LENGTH), {
        cause: error,
      });
    }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  get<Result>(path: string, options: GetOptions = {}): Promise<{ data: Result }> {
    return this.request<Result>('GET', path, undefined, options);
  }

  post<Result, Entity>(
    path: string,
    entity: Entity,
    options: PostOptions = {},
  ): Promise<{ data: Result }> {
    return this.request<Result, Entity>('POST', path, entity, options);
  }

  put<Result, Entity>(
    path: string,
    entity: Entity,
    options: PutOptions = {},
  ): Promise<{ data: Result }> {
    return this.request<Result, Entity>('PUT', path, entity, options);
  }

  patch<Result, Entity>(
    path: string,
    entity: Entity,
    options: PatchOptions = {},
  ): Promise<{ data: Result }> {
    return this.request<Result, Entity>('PATCH', path, entity, options);
  }

  async delete(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<void> {
    await this.request<void>('DELETE', path, undefined, query === undefined ? {} : { query });
  }

  async deleteWithBody<Entity>(path: string, entity: Entity): Promise<void> {
    await this.request<void, Entity>('DELETE', path, entity);
  }
}
`;
}

function renderPagination(): string {
  return `import type { PaginationOptions } from '../interfaces/pagination-options.interface';

export interface ListMetadata {
  before?: string | null;
  after?: string | null;
}

export interface ListResponse<T> {
  data: T[];
  list_metadata?: ListMetadata;
  listMetadata?: ListMetadata;
}

export interface List<T> {
  data: T[];
  listMetadata: ListMetadata;
}

export class AutoPaginatable<
  ResourceType,
  ParametersType extends PaginationOptions = PaginationOptions,
> {
  readonly object = 'list' as const;
  readonly options: ParametersType;

  constructor(
    private page: List<ResourceType>,
    private readonly apiCall: (params: PaginationOptions) => Promise<List<ResourceType>>,
    options?: ParametersType,
  ) {
    this.options = options ?? ({} as ParametersType);
  }

  get data(): ResourceType[] {
    return this.page.data;
  }

  get listMetadata(): ListMetadata {
    return this.page.listMetadata;
  }

  async autoPagination(): Promise<ResourceType[]> {
    const results = [...this.page.data];
    if (this.options.limit) return results;
    let after = this.page.listMetadata.after ?? undefined;
    while (after) {
      this.page = await this.apiCall({ ...this.options, limit: 100, after });
      results.push(...this.page.data);
      after = this.page.listMetadata.after ?? undefined;
    }
    return results;
  }
}
`;
}

function renderFetchAndDeserialize(): string {
  return `import type { WorkOS } from '../../workos';
import type { GetOptions } from '../interfaces/get-options.interface';
import type { List, ListResponse } from './pagination';
import type { PaginationOptions } from '../interfaces/pagination-options.interface';

export async function fetchAndDeserialize<T, U>(
  client: WorkOS,
  endpoint: string,
  deserialize: (data: T) => U,
  options?: PaginationOptions,
  requestOptions?: GetOptions,
): Promise<List<U>> {
  const { data } = await client.get<ListResponse<T>>(endpoint, {
    ...requestOptions,
    query: { ...options, ...requestOptions?.query },
  });
  return {
    data: data.data.map(deserialize),
    listMetadata: data.listMetadata ?? data.list_metadata ?? {},
  };
}
`;
}

function renderOperationManifest(plan: AuthPlan): string {
  const operations = plan.operations.map((operation) => ({
    operationId: operation.operationId,
    method: operation.method,
    path: operation.path,
  }));
  return `export const operationManifest = ${JSON.stringify(operations, null, 2)} as const;
`;
}

export function generateTypeScriptRuntime(options: TypeScriptRuntimeOptions): RuntimeFile[] {
  return [
    {
      path: "src/common/interfaces/workos-options.interface.ts",
      content: renderClientOptions(),
    },
    ...renderRequestOptions(),
    { path: "src/common/exceptions.ts", content: renderExceptions() },
    { path: "src/common/auth.ts", content: renderAuthTypes() },
    { path: "src/common/auth-plan.ts", content: renderAuthPlan(options.authPlan) },
    { path: "src/common/workos-base.ts", content: renderClientBase(options) },
    {
      path: "src/common/wire.ts",
      content: `export function appendQuery(url: URL, query: Record<string, unknown> | undefined): void {
  if (!query) return;
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (entry !== null && typeof entry === 'object') throw new TypeError('Structured query parameters require an explicit serializer.');
      url.searchParams.append(name, String(entry));
    }
  }
}
`,
    },
    { path: "src/common/utils/pagination.ts", content: renderPagination() },
    {
      path: "src/common/utils/fetch-and-deserialize.ts",
      content: renderFetchAndDeserialize(),
    },
    {
      path: "src/operation-manifest.ts",
      content: renderOperationManifest(options.authPlan),
    },
  ];
}
