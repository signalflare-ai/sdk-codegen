# Python, Go, and Rust runtime specification

- **Status:** Active implementation plan
- **Baseline:** OpenAPI 3.1.2, Oagen 0.29.2, Oagen emitters 0.24.4
- **Scope:** Signalflare-generated Python, Go, and Rust SDKs

## 1. Purpose

Oagen already emits the language-specific models, enums, resource methods,
serializers, tests, operation manifests, and native API comments. Its Python,
Go, and Rust emitters intentionally assume that an existing WorkOS SDK supplies
several transport, authentication, error, and package files.

Signalflare must provide that missing runtime layer without forking or copying
the upstream model and resource emitters. This is not a blank-sheet runtime
project: the live MIT-licensed WorkOS SDKs contain the hand-maintained files
those emitters target. Signalflare should adapt their proven runtime shapes,
remove product-specific behavior, and add the broader Signalflare auth contract.
A completed target must be a standalone, idiomatic SDK that compiles, makes
authenticated HTTP requests, and preserves the same wire behavior as the
TypeScript Promise client.

This specification turns the broad phases in
[`sdk-codegen-spec.md`](sdk-codegen-spec.md) into mergeable implementation work.

## 2. Current state

| Target             | Oagen core | Native comments | Standalone runtime | Compile/wire gate | Publishable |
| ------------------ | ---------- | --------------- | ------------------ | ----------------- | ----------- |
| TypeScript Promise | Complete   | JSDoc           | Complete           | Complete          | Pilot-ready |
| Python sync/async  | Complete   | Docstrings      | Complete           | Complete          | Pilot-ready |
| Go                 | Complete   | GoDoc           | Complete           | Complete          | Pilot-ready |
| Rust async         | Complete   | Rustdoc         | Complete           | Complete          | Pilot-ready |

The Signalflare wrappers now satisfy the upstream assumptions by emitting the
hand-owned client, auth, error, request-option, pagination, package-bootstrap,
and public-entrypoint files. They remove WorkOS-only services, receive configured
target identifiers, and validate generated TypeScript/Python imports and Rust
modules before accepting output. Complete native targets no longer emit the old
incomplete-runtime warning.

## 3. Ownership and architecture

Each target follows the same boundary:

```text
profile-filtered OpenAPI
        |
        v
Oagen parse + operation plan
        |
        +--> upstream models/enums/resources/native comments
        |
        +--> Signalflare emitter wrapper
                 |
                 +--> client/transport
                 +--> operation-aware auth
                 +--> structured errors
                 +--> request options and runtime helpers
                 +--> public entrypoint cleanup
```

### 3.1 Upstream-owned generation

Continue delegating these files to `@workos/oagen-emitters`:

- models and model conversion;
- enums and unions;
- resource methods and parameter groups;
- wire serialization and deserialization;
- operation manifests and compatibility extraction;
- native inline comments derived from OpenAPI descriptions.

### 3.2 Signalflare-owned generation

Add focused wrappers under:

```text
src/emitters/python/
src/emitters/go/
src/emitters/rust/
```

Each wrapper composes its upstream emitter and emits the missing runtime files.
Runtime templates are owned by this compiler and overwritten deterministically.
A fresh target also receives a minimal `pyproject.toml`, `go.mod`, or
`Cargo.toml`; an existing product-owned package manifest is preserved. Product
release metadata and release policy remain product-owned.

Hardcoded upstream WorkOS names and non-spec services must not appear in a
Signalflare SDK. Prefer narrowly-scoped upstream emitter options. A temporary
post-pass is allowed only when it:

1. matches exact output from the pinned emitter version;
2. asserts the expected match count;
3. fails generation when upstream output changes;
4. is recorded in `UPSTREAM.md` with removal criteria.

Do not fork or copy an entire emitter.

### 3.3 Reviewed WorkOS runtime prior art

The implementation plan is based on both the emitter source and immutable
snapshots of the live SDKs that supply its hand-owned files:

| Language      | Snapshot                | Reusable implementation                                                                                                             | Signalflare-specific gap                                                                                     |
| ------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Python 10.3.0 | `workos-python@7aa6894` | HTTPX sync/async clients, retries, path encoding, request options, pagination, `NOT_GIVEN`, model conversion, and structured errors | generalized `AuthPlan`, credential providers, product naming, bounded errors, strict success decoding        |
| Go 10.4.0     | `workos-go@be30f8d`     | `net/http` transport, options, retries, query encoding, pagination, `NullFields`, and `errors.As`-compatible errors                 | generalized `AuthPlan`, credential providers, product naming, error `details`, bounded errors                |
| Rust 3.4.0    | `workos-rust@afcd055`   | pluggable transport, Reqwest/Rustls, safe retry policy, query encoding, pagination, builder, structured errors, and crate docs      | generalized `AuthPlan`, credential providers, product naming, optional-nullable preservation, bounded errors |

Representative files are:

- Python: `src/workos/_base_client.py`, `_types.py`, `_errors.py`, and
  `_pagination.py`;
- Go: `client.go`, `options.go`, `errors.go`, and `pagination.go`;
- Rust: `src/client.rs`, `transport.rs`, `query.rs`, `error.rs`, `pagination.rs`,
  and `lib.rs`.

The upstream emitters already generate Python `NOT_GIVEN` handling and Go
`NullFields` marshalling for optional nullable request fields. Those conventions
must be retained rather than replaced. Rust still needs a focused solution for
optional plus nullable request fields because the current type mapping collapses
that state to one `Option<T>`.

These references are read-only and are never executed. If implementation is
substantially adapted from a live SDK file, retain the WorkOS MIT notice in a
third-party notice and record the source commit in `UPSTREAM.md`. Do not bring
across WorkOS-only AuthKit helpers, crypto, passwordless services, or unrelated
product models.

## 4. Shared runtime behavior

The language runtimes may be idiomatic, but the following wire behavior is
normative.

### 4.1 Request construction

Every runtime must:

- use the first selected OpenAPI server as its default base URL;
- support a client-level base URL override;
- preserve generated path-segment encoding;
- omit absent query and body values;
- preserve repeated query values where the contract permits arrays;
- send `Accept: application/json`;
- send `Content-Type: application/json` only when a JSON body exists;
- send `X-Signalflare-SDK` with product, SDK, language, and compiler versions;
- allow client-level and per-request headers without allowing them to silently
  replace runtime-managed authentication;
- support client-level and per-request timeouts;
- treat `204` and an empty successful body as an empty result;
- report malformed successful JSON as a response-decode error;
- never log credentials or complete sensitive response bodies.

The reviewed WorkOS runtimes already contain retry and backoff implementations.
Retain that machinery where practical, but default the first Signalflare release
to one attempt until a common idempotency policy and parity tests authorize
retries for safe methods or explicitly idempotent requests.

### 4.2 Authentication

All runtimes consume the compiler's existing `AuthPlan`.

- Top-level OpenAPI security is inherited by operations without an override.
- Security requirement array entries are logical OR alternatives.
- Multiple schemes inside one alternative are logical AND requirements.
- `security: []` is explicitly anonymous and attaches no credentials.
- Named credentials take precedence over generic bearer/API-key credentials.
- Bearer, OAuth2, and OpenID Connect schemes use `Authorization: Bearer`.
- API keys may be placed in headers, query parameters, or cookies.
- Alternatives are evaluated in contract order; the first complete alternative
  is selected.
- Missing credentials fail before network I/O and identify the operation and
  acceptable alternatives.
- Credential providers receive method, path template, operation ID, and scheme
  ID so AuthKit tokens may be refreshed per request.

### 4.3 Errors

Every runtime exposes equivalent structured information, with idiomatic names:

- API status;
- machine-readable error code;
- human-readable message;
- request ID from response headers or a documented body fallback;
- structured `details`;
- at most 64 KiB of raw response body;
- original transport/decode cause where the language supports error chaining.

The minimum categories are:

1. API error;
2. authentication/authorization error;
3. not-found/conflict/validation/rate-limit/server subclasses or kinds;
4. missing credential;
5. timeout/transport error;
6. successful-response decode error.

Expected transport, authentication, API, and decode failures must never panic.

### 4.4 Required, optional, and nullable values

Request serialization must distinguish all four OpenAPI states:

| Contract field     | Python                  | Go                       | Rust                     | Wire behavior                 |
| ------------------ | ----------------------- | ------------------------ | ------------------------ | ----------------------------- |
| required, non-null | `T`                     | `T`                      | `T`                      | value required                |
| optional, non-null | `T \| None`             | `*T`                     | `Option<T>` with skip    | omitted or value              |
| required, nullable | `T \| None`             | `*T` without `omitempty` | `Option<T>` without skip | `null` or value, key required |
| optional, nullable | `T \| None \| NotGiven` | `*T` plus `NullFields`   | `OptionalNullable<T>`    | omitted, `null`, or value     |

Language wrappers must preserve the distinction in generated method parameters,
request models, and serializers. Tests must cover every state; compile success
alone is insufficient.

## 5. Python target

### 5.1 Public shape

```python
from signalflare_atlas import AtlasClient, AsyncAtlasClient

client = AtlasClient(token="token", base_url="https://api.example.com")
widget = client.widgets.get_widget(widget_id="widget_123")

async with AsyncAtlasClient(token=token_provider) as client:
    widget = await client.widgets.get_widget(widget_id="widget_123")
```

Requirements:

- emit idiomatic `snake_case` method names even when `operationId` is camelCase;
- adapt the live `_base_client.py` HTTPX sync/async request machinery rather
  than reimplementing transport, path encoding, pagination, and cleanup;
- allow injected HTTPX clients or transports;
- retain context-manager and async-context-manager cleanup;
- support static credentials, sync providers, and async providers on the
  corresponding client;
- provide the upstream runtime's `NOT_GIVEN`/`NotGiven` definitions expected by
  generated resources;
- retain Oagen's existing `NOT_GIVEN` serialization for optional nullable body
  fields and its `None` omission behavior for optional non-null fields;
- remove `WorkOSClient`, `passwordless`, `actions`, and `pkce` leakage;
- expose generated models and structured errors from the package root.

Signalflare runtime files:

```text
_base_client.py
_auth.py
_errors.py
_types.py
_pagination.py
__init__.py
pyproject.toml
```

Verification:

- Ruff check and format;
- Pyright strict mode;
- pytest sync and async suites;
- local mocked wire/auth tests;
- wheel build and isolated install/import smoke test;
- generated docstrings remain importable through `help()`/`pydoc`.

## 6. Go target

### 6.1 Public shape

```go
client, err := atlas.NewClient(
    atlas.WithBaseURL(endpoint),
    atlas.WithToken(token),
    atlas.WithHTTPClient(httpClient),
)
if err != nil {
    return err
}

widget, err := client.Widgets().Get(ctx, widgetID, &atlas.WidgetsGetParams{})
```

Requirements:

- use the standard `net/http` client;
- accept an injected `*http.Client` and therefore an injectable `RoundTripper`;
- put `context.Context` on every network operation;
- expose static token/API-key options and context-aware credential providers;
- avoid package-level mutable clients or credentials;
- adapt the live request, options, errors, query, and pagination kernels instead
  of rebuilding them;
- expose `APIError` so callers can use `errors.As`;
- retain Oagen's generated `NullFields` convention and validated custom
  `MarshalJSON` for optional nullable body fields;
- remove WorkOS API wording, API-key-only construction, and non-spec services;
- use the configured Go module in product-owned `go.mod` validation.

Signalflare runtime files:

```text
client.go
auth.go
errors.go
options.go
pagination.go
go.mod
```

Verification:

- `gofmt`;
- `go vet ./...`;
- `go test ./...`;
- `httptest.Server` wire/auth tests;
- race test for credential-provider and shared-client usage;
- `go doc ./...` smoke check.

## 7. Rust target

### 7.1 Public shape

```rust
let client = AtlasClient::builder()
    .base_url(endpoint)
    .token(token)
    .build()?;

let widget = client
    .widgets()
    .get_widget(widget_id, GetWidgetParams::default())
    .await?;
```

Requirements:

- adapt the live pluggable `HttpTransport`, Reqwest/Rustls, query, pagination,
  retry, builder, and error kernels instead of rebuilding them;
- allow injection of a configured transport;
- expose a fallible `build()` path; do not copy the live convenience path that
  may panic on invalid headers or missing transport features;
- make the client `Clone + Send + Sync`;
- expose generic builder methods for async credential providers while hiding
  boxed/dynamic implementation details from ordinary callers;
- ensure generated request futures are `Send`;
- expose a structured `Error` with an inspectable error kind and chained source;
- use a dedicated `OptionalNullable<T>` for the three-state case;
- preserve generated `///` model and resource documentation;
- add crate/module documentation, examples, and `# Errors` sections to
  Signalflare-owned public runtime APIs;
- avoid panics on normal transport, auth, API, or decode paths.

Signalflare runtime files:

```text
src/client.rs
src/auth.rs
src/error.rs
src/transport.rs
src/query.rs
src/pagination.rs
src/optional_nullable.rs
src/secret.rs
src/lib.rs
Cargo.toml
```

A fresh target receives a minimal `Cargo.toml` using the configured crate name;
an existing product-owned manifest is preserved and validated against generated
source.

Verification:

- `cargo fmt --all -- --check`;
- `cargo check --all-targets`;
- `cargo test` including integration and doctests;
- `cargo clippy --all-targets` using product lint policy;
- `cargo doc --no-deps` with broken intra-doc links denied;
- compile-time `Clone`, `Send`, `Sync`, and future-`Send` assertions;
- local HTTP wire/auth tests.

## 8. Permanent conformance fixtures

The shared repository owns one runtime-conformance OpenAPI contract and expected
wire vectors. The fixture must include:

- inherited bearer auth;
- header, query, and cookie API keys;
- multi-scheme AND;
- bearer-or-key OR;
- an explicitly anonymous operation;
- path, query, header, and JSON-body serialization;
- required/optional/nullable field combinations;
- empty success and normal JSON success;
- structured 4xx and 5xx errors;
- malformed successful JSON;
- date, date-time, UUID, arrays, maps, enums, and unions;
- per-request headers and timeout behavior.

Every language test must execute the same semantic vectors. Language-specific
test syntax may differ, but expected method, URL, query, headers, body, response,
and error fields must not.

Use product pilots in this order:

1. Canary for exhaustive compiler/runtime behavior;
2. Geocode for a small real package and installation smoke test;
3. Atlas for naming, scale, and parity with its hand-written client.

## 9. Compiler safety gates

Before a target is considered complete, generation must validate its local
imports/modules just as TypeScript does today. The compiler must fail rather
than write a supposedly complete SDK with missing runtime files.

Generation reports and manifests must record:

- the Signalflare wrapper plus upstream emitter version;
- runtime ABI/schema version;
- product/package/module/crate identity;
- selected profiles and operations;
- applied temporary rewrites;
- whether the target passed its publishability gate.

No incomplete target may silently lose its warning.

## 10. Delivery plan

### R0 — Conformance foundation

- [x] Audit the upstream emitters and live WorkOS Python, Go, and Rust runtime
      files; record reusable boundaries and exact source commits.
- [x] Add and validate `runtime-conformance.openapi.json`.
- [x] Add shared auth and wire expectation vectors.
- [x] Add target-specific naming policy derived from stable `operationId`.
- [x] Pass runtime options and target identifiers into all emitter wrappers.
- [x] Add unresolved-module validation for Python and Rust; Go emits one flat
      package and is compiled by its native gate.
- [x] Document required upstream extension requests and pinned rewrites.

**Exit:** one fixture precisely defines auth, error, serialization, nullability,
and documentation behavior before runtime implementations diverge.

### R1 — Python standalone SDK

- [x] Add the Signalflare Python emitter wrapper.
- [x] Adapt the reviewed sync/async HTTPX, pagination, error, runtime-type, and
      public-export kernels; add Signalflare auth.
- [x] Remove WorkOS-only symbols and services.
- [x] Verify and preserve Oagen's existing `NOT_GIVEN` omission/nullability semantics.
- [x] Add format, type, unit, wire, documentation, and package smoke gates.
- [x] Run the Geocode pilot.

**Exit:** generated Canary and Geocode Python packages install, import, typecheck,
and pass sync/async wire tests with no hand-created runtime files.

### R2 — Go standalone SDK

- [x] Add the Signalflare Go emitter wrapper.
- [x] Adapt the reviewed `net/http`, options, errors, query, pagination, and
      `NullFields` kernels; add Signalflare auth.
- [x] Remove WorkOS-only symbols and services.
- [x] Add format, vet, race, unit, wire, documentation, and module gates.
- [x] Run the Geocode pilot.

**Exit:** generated Canary and Geocode Go modules compile and pass all shared
wire vectors.

### R3 — Rust standalone SDK

- [x] Add the Signalflare Rust emitter wrapper.
- [x] Adapt the reviewed client, transport, query, pagination, builder, errors,
      and crate exports; add Signalflare auth.
- [x] Add format, check, Clippy, unit, wire, rustdoc, and package gates.
- [x] Assert the public client is `Clone + Send + Sync`; generated request
      futures compile under Tokio's multithreaded test runtime.
- [x] Run the Geocode pilot.

**Exit:** generated Canary and Geocode crates compile without missing files,
pass all shared wire vectors, and build documentation without warnings.

### R4 — Cross-language compatibility and Atlas

- [ ] Add additive and breaking compatibility fixtures for every target.
- [ ] Emit cross-language compatibility reports.
- [ ] Generate and compile quickstarts/snippets.
- [x] Add isolated package installation tests.
- [ ] Run Atlas generated-client wire/auth parity tests.
- [x] Remove incomplete-runtime warnings only for targets that pass every gate.

**Exit:** all targets are deterministic, installable, compatibility-checked, and
ready for product-owned releases.

## 11. Merge strategy

Keep each runtime in independently reviewable commits:

1. conformance contract and shared vectors;
2. language emitter wrapper and runtime;
3. omission/nullability behavior;
4. compile and wire gates;
5. real-product pilot.

Python lands first because its sync/async runtime exercises the broadest shared
contract with the lowest packaging cost. Go and Rust may proceed in parallel
after R0, but neither should invent behavior not represented by the shared
fixtures.
