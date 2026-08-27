# Signalflare SDK Codegen

- **Status:** Proposed architecture and implementation plan
- **Date:** August 6, 2026
- **Repository:** `signalflare-ai/sdk-codegen`
- **Package:** `@signalflare-ai/sdk-codegen`
- **Primary inputs:** OpenAPI product contracts
- **Initial targets:** TypeScript, TypeScript Effect, Python, Go, Rust

## 1. Executive summary

Signalflare should maintain one small, public SDK compiler repository that turns each product's canonical OpenAPI contract into product-owned SDKs.

The compiler will be shared by Atlas, Navigator, Forge, and future Signalflare products. It will not own their endpoint definitions, generated output, authentication policy, release versions, or product-specific convenience methods. Each product repository remains the source of truth for its API contract and generated SDK packages.

The implementation should use [`@workos/oagen`](https://github.com/workos/oagen) as the OpenAPI parsing, intermediate representation, generation, compatibility, manifest, and verification framework. It should initially consume the relevant emitters from [`@workos/oagen-emitters`](https://github.com/workos/oagen-emitters), wrapping them with Signalflare configuration, validation, target profiles, and testing. It should not begin as a wholesale fork.

The initial product contract model is:

```text
product-owned API definitions
        ↓
canonical product OpenAPI 3.1 contract
        ↓
Signalflare contract validation and profile selection
        ↓
@workos/oagen parse → IR → operation planning
        ↓
Signalflare-configured language emitters
        ↓
product-owned TypeScript / Effect / Python / Go / Rust SDKs
        ↓
compatibility checks + compile tests + wire smoke tests
```

A product may contain multiple separately deployed APIs. Those APIs may remain separately authored, but the product repository must build one canonical product OpenAPI artifact for SDK generation. Every operation retains its source API identity through standard OpenAPI fields and Signalflare vendor extensions.

The generated client surface is divided into four production audiences:

1. **Governed access** — catalog discovery, trusted table metadata, credentials, queries, query runs, and user-facing data access.
2. **Pipeline authoring** — pipeline documents, registration, scheduling, execution, status, and reports.
3. **Runner protocol** — machine-to-machine leases, heartbeats, commit authorization, commit recording, event/report publication, and other runner control-plane operations.
4. **Admin** — privileged organization, catalog, operational, and support APIs.

A fifth **contract-preview** audience may exist in the canonical OpenAPI document but is excluded from production SDK generation and compatibility guarantees by default.

## 2. Context and problem statement

Signalflare currently has multiple API products with different contract and client-generation approaches:

- Atlas generates an OpenAPI document from a typed method registry and Effect schemas, but its TypeScript client is still handwritten and it has no generated Python, Go, or Rust SDK.
- Navigator has multiple OpenAPI-producing API packages and generates TypeScript clients locally.
- Forge has a mix of a legacy Swagger 2.0 contract, a small OpenAPI 3 contract, and handwritten client code.
- More Signalflare APIs are expected over time.

Without a shared compiler and policy layer, each product will independently solve the same problems:

- operation naming;
- service grouping;
- request serialization;
- optional versus nullable semantics;
- error decoding;
- retries, timeouts, pagination, and telemetry;
- generated-file ownership;
- compatibility enforcement;
- language-specific smoke testing;
- provenance and release discipline.

The result would be duplicated generator tooling, inconsistent SDK behavior, and contract drift between languages.

The opposite extreme—one company-wide API definition or one repository containing all generated SDKs—is also undesirable. Atlas, Navigator, and Forge have different deployments, trust boundaries, ownership, release cycles, and product semantics. Their API contracts and generated output need to remain product-owned.

The required middle layer is a shared compiler with local product manifests.

## 3. Architectural decisions

### 3.1 One shared compiler repository

Create and maintain one public repository:

```text
signalflare-ai/sdk-codegen
```

It publishes one primary package:

```text
@signalflare-ai/sdk-codegen
```

The repository owns reusable generation-time behavior only:

- configuration schema and loader;
- OpenAPI validation and normalization;
- SDK audience/profile selection;
- shared Oagen plugin assembly;
- shared emitter configuration;
- the custom TypeScript Effect emitter or facade generator;
- compatibility policy;
- generated-file provenance;
- fixture contracts;
- golden tests;
- compile and wire-smoke harnesses;
- the `signalflare-sdk` CLI.

### 3.2 Product repositories own contracts and outputs

Each product repository owns:

- source route/schema definitions;
- the canonical product OpenAPI artifact;
- a small `sdk.config.ts` manifest;
- generated SDK source;
- hand-owned product facades;
- product-specific integration tests;
- package names and versions;
- package publishing and release notes.

Generated output must be committed beside the product that owns the contract. The shared compiler repository must not become a release monorepo for every product SDK.

### 3.3 One canonical OpenAPI document per product

Each product exposes one canonical OpenAPI document as the generation input.

This does not require every API within a product to share one server process or one source-code package. A product repository may compose several source documents into the canonical artifact. The composition must preserve:

- source API identity;
- server or base URL identity;
- authentication boundary;
- operation identity;
- tags and service grouping;
- stability and visibility metadata.

Examples:

- Atlas builds one `atlas.openapi.json` containing access, pipeline, runner, admin, and preview operations.
- Navigator builds one `navigator.openapi.json` from its main API and DAPI contracts while preserving their distinct source API IDs and servers.
- Forge builds one `forge.openapi.json` after normalizing its full Swagger 2.0 surface into OpenAPI 3.x.

The canonical document is a built artifact, not a reason to collapse distinct runtime APIs into one deployment.

### 3.4 OpenAPI version policy

The first production version of this compiler will normalize and validate against **OpenAPI 3.1.2**.

Rationale:

- OpenAPI 3.1 has broad tooling support and aligns schema semantics with modern JSON Schema.
- Atlas already emits an OpenAPI 3.1 document.
- The pinned Oagen implementation accepts OpenAPI `3.*`, but its documented remediation still explicitly names OpenAPI 3.0 and 3.1.
- OpenAPI 3.2.0 is the current published OpenAPI line, but it must be treated as experimental here until the parser, all five target surfaces, compatibility extractors, and smoke suites pass dedicated 3.2 fixtures.

Policy:

- v1 authoring target: OpenAPI 3.1.2;
- accepted input: 3.1.x;
- 3.2.x: opt-in experimental mode only;
- Swagger/OpenAPI 2.0: rejected with a conversion instruction;
- OpenAPI 3.0.x: accepted only through an explicit normalization path to 3.1.2.

This is a compiler-support decision, not a rejection of OpenAPI 3.2. A milestone later in this plan promotes 3.2 after conformance is proven.

### 3.5 Upstream dependency strategy

Use upstream packages first:

- `@workos/oagen` pinned to an exact reviewed version;
- selected named emitters and extractors from `@workos/oagen-emitters`;
- a Signalflare-owned plugin/preset that configures those pieces.

Do not start by forking the full emitter repository.

A selective vendor or fork is permitted only when a recorded decision shows that upstream extension points cannot express a required behavior. Valid triggers include:

1. a required package layout cannot be expressed through emitter options or a wrapper;
2. Signalflare error/runtime behavior requires invasive emitter changes;
3. a WorkOS-specific assumption cannot be disabled or overridden;
4. upstream changes repeatedly break deterministic Signalflare output;
5. an upstream issue is not accepted or cannot land within the required release window.

If vendoring becomes necessary:

- vendor only affected emitters and shared utilities;
- preserve the MIT license and copyright notices;
- add `UPSTREAM.md` with source repository, version, and commit;
- keep the first vendor commit mechanically close to upstream;
- document all Signalflare patches;
- retain an upstream comparison/update workflow.

### 3.6 TypeScript Effect is a client surface, not a separate model universe

TypeScript Promise and TypeScript Effect clients must share one generated TypeScript model and operation layer.

The generator must not produce two incompatible sets of TypeScript request and response types.

The intended shape is:

```text
OpenAPI operation/model IR
        ↓
shared generated TypeScript models + serializers + endpoint descriptors
        ├── Promise/fetch client
        └── Effect v4 client
```

The Effect surface may provide richer typed errors, services, layers, tracing, retries, and interruption semantics. The Promise surface remains the conventional low-dependency client.

## 4. Goals

### 4.1 Functional goals

The compiler must:

1. generate TypeScript, TypeScript Effect, Python, Go, and Rust SDKs from one product OpenAPI contract;
2. select generated operations by product audience without maintaining separate hand-authored specs;
3. produce deterministic, reviewable, committed output;
4. preserve stable public SDK surfaces through compatibility checks;
5. generate or enforce consistent request serialization and response/error decoding;
6. support product-local handwritten facades without overwriting them;
7. emit provenance manifests and safely prune stale generated files;
8. compile and wire-test each enabled language target;
9. provide snippets for the same operation/profile/language plan used by full generation;
10. fail early on contract shapes known to generate incorrect SDKs.

### 4.2 Organizational goals

The project must:

- centralize generic SDK policy without centralizing product ownership;
- give Atlas, Navigator, and Forge the same SDK quality bar;
- allow each product to adopt languages incrementally;
- make generated changes easy to review in product pull requests;
- support a public contribution and release model;
- minimize permanent forks of upstream generator infrastructure.

### 4.3 Quality goals

Generated SDKs must be:

- deterministic;
- idiomatic enough for normal language users;
- explicit about nullability and optionality;
- forward-compatible where the wire contract permits it;
- safe around authentication and secrets;
- observable through request IDs and user-agent metadata;
- independently compilable;
- covered by generated unit fixtures and wire-level smoke tests.

## 5. Non-goals

This repository will not:

- define product endpoints or business schemas;
- merge Atlas, Navigator, and Forge into one company-wide OpenAPI document;
- implement product authorization or policy decisions;
- generate server implementations in the initial scope;
- own product release versions;
- publish all product SDKs from this repository;
- hide a malformed product contract with permanent generator transforms;
- replace product-specific integration tests;
- generate ETL connector or data-plane implementations;
- guarantee every OpenAPI feature before a corresponding fixture and emitter test exists;
- make contract-preview operations part of the stable public SDK by default.

## 6. Terminology

| Term                  | Meaning                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------- |
| **Source API**        | A separately authored or deployed API within a product.                                 |
| **Product contract**  | The canonical OpenAPI document used to generate one product's SDKs.                     |
| **Profile**           | A selected operation audience such as access, pipelines, runner, or admin.              |
| **Target**            | A generated language/client output.                                                     |
| **Emitter**           | Oagen component that turns IR into language files.                                      |
| **Extractor**         | Oagen component that extracts a live SDK's public surface for compatibility comparison. |
| **Facade**            | Small handwritten layer over generated operations for ergonomic workflows.              |
| **Generated core**    | Generated models, serializers, endpoints, resources, and base client behavior.          |
| **Preview operation** | Contract-visible but excluded from stable production SDK generation.                    |
| **Wire name**         | Field or parameter name transmitted over HTTP.                                          |
| **Domain name**       | Language-facing field or method name exposed by an SDK.                                 |

## 7. System architecture

### 7.1 Product-side flow

```text
route/schema source A ─┐
route/schema source B ─┼─> product OpenAPI build ─> canonical product.openapi.json
route/schema source C ─┘                                  │
                                                         ├─> docs views
                                                         ├─> API parity tests
                                                         └─> sdk-codegen
                                                                  │
                                         sdk.config.ts ────────────┤
                                                                  ↓
                                                        generated SDK trees
                                                                  │
                                         handwritten facades ─────┤
                                                                  ↓
                                                   product build/test/release
```

### 7.2 Compiler flow

```text
load config
   ↓
load and bundle OpenAPI refs
   ↓
validate OpenAPI and Signalflare extensions
   ↓
normalize safe, declared differences
   ↓
select profile operations
   ↓
parse through Oagen IR
   ↓
apply shared operation planning and SDK behavior
   ↓
emit models/resources/client/errors/tests/snippets
   ↓
write with generated-file manifest and safe pruning
   ↓
extract candidate public surface
   ↓
compatibility diff
   ↓
format + compile + unit fixtures + wire smoke tests
   ↓
produce machine-readable and Markdown reports
```

### 7.3 Oagen responsibilities

The implementation should rely on Oagen for the concerns it already models well:

- OpenAPI loading and `$ref` bundling;
- OpenAPI-to-IR parsing;
- language-neutral `ApiSpec`, services, operations, models, enums, auth, and SDK behavior;
- shared `OperationPlan` semantics;
- emitter lifecycle;
- generated-file writing;
- `.oagen-manifest.json` ownership and pruning;
- live SDK surface extraction;
- compatibility overlay/diff workflows;
- verification and smoke-runner integration.

Signalflare code should not reimplement Oagen's IR parser or operation planning.

### 7.4 Signalflare responsibilities

The shared compiler adds:

- product configuration and profiles;
- contract validation rules required across Signalflare;
- canonical vendor extension parsing;
- safe profile filtering before emission;
- standard runtime/error/telemetry defaults;
- target package layout conventions;
- Promise/Effect shared TypeScript generation;
- cross-language compatibility policy;
- deterministic command orchestration;
- provenance and reports spanning all generated targets;
- Signalflare fixtures and smoke servers;
- adoption helpers for existing product SDKs.

## 8. Canonical product contract

### 8.1 Required top-level properties

Every product contract must include:

- `openapi`;
- `info.title`;
- `info.version`;
- at least one `servers` entry unless the product config supplies a development-only override;
- explicit security schemes;
- stable, unique `operationId` values;
- named request/response component schemas for public operations;
- `x-signalflare-product` metadata.

Illustrative shape:

```yaml
openapi: 3.1.2
info:
  title: Atlas API
  version: 1.4.0
servers:
  - url: https://api.example.signalflare.ai
x-signalflare-product:
  id: atlas
  displayName: Atlas
  contractVersion: 1
```

### 8.2 Source API identity

Operations composed from different source APIs must retain an API ID:

```yaml
x-signalflare-api-id: catalog
```

The API ID is used for:

- diagnostics;
- server/base URL resolution;
- auth validation;
- compatibility identity;
- generated resource mounting when required;
- tracing which source contract produced an SDK method.

The stable operation identity is:

```text
product ID + source API ID + operationId
```

HTTP method/path remain part of compatibility analysis but are not the only identity.

### 8.3 SDK operation metadata

Use standard OpenAPI fields first:

- `operationId` for the stable operation identifier;
- `tags` for service grouping;
- `security` for authentication;
- `deprecated` for deprecation;
- `summary` and `description` for generated docs.

Use a small vendor extension only where OpenAPI has no equivalent:

```yaml
x-signalflare-sdk:
  audiences:
    - access
  visibility: public
  stability: stable
  generate: true
```

Supported fields:

| Field        | Values                                              | Purpose                                                                                     |
| ------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `audiences`  | `access`, `pipelines`, `runner`, `admin`, `preview` | Select generated client surfaces. Multiple values are allowed.                              |
| `visibility` | `public`, `partner`, `internal`                     | Distribution and documentation policy.                                                      |
| `stability`  | `stable`, `beta`, `experimental`                    | Compatibility and release policy.                                                           |
| `generate`   | boolean                                             | Explicit final inclusion switch. Defaults to `true` for implemented stable/beta operations. |
| `service`    | string, optional                                    | Overrides tag-derived service mounting when unavoidable.                                    |

Product-specific business behavior must not be encoded into this extension.

### 8.4 Profiles

The compiler has five standard profiles:

| Profile     | Audience                                                        | Production generation                |
| ----------- | --------------------------------------------------------------- | ------------------------------------ |
| `access`    | Normal applications and agents consuming governed product data. | Yes                                  |
| `pipelines` | Pipeline authors and orchestration clients.                     | Yes                                  |
| `runner`    | Trusted data-plane or worker implementations.                   | Yes, normally internal distribution  |
| `admin`     | Privileged operators and support tooling.                       | Yes, separately packaged or exported |
| `preview`   | Contract design and future methods.                             | No by default                        |

A product config may rename an exported package path, but the semantic audience names remain stable across products.

Operations without `x-signalflare-sdk.audiences` fail validation unless the product config has an explicit default. Silent placement is not allowed for stable public operations.

### 8.5 Implemented versus preview

A contract may describe planned operations, but production SDKs must not make them look callable.

Signalflare contracts should use a canonical extension such as:

```yaml
x-signalflare-implemented: false
```

Rules:

- `implemented: false` operations are forced into the preview profile;
- production profiles reject them even if an audience was assigned incorrectly;
- preview generation is opt-in and clearly names the output as preview;
- removal of a never-shipped preview operation is not a stable SDK breaking change;
- promotion from preview to stable requires implementation, route parity, examples, and smoke coverage.

### 8.6 Parameters and request bodies

Contract validation must reject the common shapes that currently produce incorrect SDKs:

- GET or DELETE request fields represented only as a JSON request body;
- path parameters duplicated in a request body;
- path parameters not marked `required: true`;
- parameters missing an explicit `in` location;
- undocumented transport coercion of structured query values;
- an operation request schema that does not match the actual route decoder;
- optional properties advertised as nullable when the server rejects `null`;
- nullable properties advertised as optional when explicit `null` means “clear this value.”

For every request field, the contract must distinguish:

1. required and non-nullable;
2. optional and non-nullable;
3. required and nullable;
4. optional and nullable.

The generated languages must preserve these distinctions as closely as their type systems permit.

### 8.7 Responses and errors

Every production operation must document:

- all success status codes;
- whether the success response is empty, JSON, binary, or streaming;
- a named success schema for JSON responses;
- expected error status codes;
- the product's structured error schema;
- request ID behavior.

The shared compiler should support a conventional error envelope but must remain spec-driven. A recommended envelope is:

```yaml
Error:
  type: object
  required: [code, message]
  properties:
    code:
      type: string
    message:
      type: string
    requestId:
      type: [string, "null"]
    details:
      type: [object, "null"]
      additionalProperties: true
```

Generated SDKs must preserve:

- HTTP status;
- structured product error code;
- message;
- request ID;
- safe details payload;
- original response body when decoding fails.

Product contracts, not the generator, decide which error codes each operation can return.

### 8.8 Union and enum policy

For discriminated unions:

- require an explicit discriminator whenever the wire format has one;
- preserve unknown variants for forward compatibility where feasible;
- generate language-appropriate union representations;
- test known and unknown variants.

For enums:

- prefer open/unknown-preserving representations for server-controlled values;
- classify enum value removal as breaking;
- classify enum value addition as soft risk unless the target representation safely preserves unknown values;
- never silently map unknown values to an existing member.

### 8.9 Pagination

Pagination must be explicit in the contract or deterministically detected and confirmed by configuration.

Supported initial strategies:

- cursor;
- offset/limit;
- link header.

The compiler may generate iteration helpers, but raw one-page methods must remain accessible. Pagination helpers belong to the thin facade when language or product ergonomics require them.

### 8.10 Binary, streaming, and long-running operations

The first release must fail clearly rather than misgenerate unsupported transport modes.

Each operation is classified as one of:

- JSON request/JSON response;
- no-body request/JSON response;
- JSON request/no-content response;
- binary upload/download;
- streaming response;
- long-running/polling workflow.

JSON and no-content operations are required for v1. Binary, streaming, and long-running patterns require dedicated fixtures before being marked supported.

## 9. Product configuration

### 9.1 Local manifest

Every product keeps a small `sdk.config.ts` next to its canonical OpenAPI artifact.

Illustrative API:

```ts
import { defineSdkConfig } from "@signalflare-ai/sdk-codegen";

export default defineSdkConfig({
  product: {
    id: "atlas",
    displayName: "Atlas",
  },
  contract: {
    spec: "packages/types/generated/atlas.openapi.json",
    openapiBaseline: "3.1.2",
  },
  profiles: {
    access: {
      includeAudiences: ["access"],
    },
    pipelines: {
      includeAudiences: ["pipelines"],
    },
    runner: {
      includeAudiences: ["runner"],
      visibility: ["internal"],
    },
    admin: {
      includeAudiences: ["admin"],
    },
    preview: {
      includeAudiences: ["preview"],
      enabled: false,
    },
  },
  targets: {
    typescript: {
      output: "packages/atlas/src/generated",
      packageName: "@signalflare-ai/atlas",
      profiles: ["access", "pipelines", "runner", "admin"],
      effect: true,
    },
    python: {
      output: "sdks/python/signalflare_atlas",
      packageName: "signalflare-atlas",
      profiles: ["access", "pipelines", "runner", "admin"],
      async: true,
    },
    go: {
      output: "sdks/go",
      module: "github.com/signalflare-ai/atlas-go",
      profiles: ["access", "pipelines", "runner", "admin"],
    },
    rust: {
      output: "sdks/rust",
      crateName: "signalflare-atlas",
      profiles: ["access", "pipelines", "runner", "admin"],
    },
  },
});
```

The final API may differ, but these responsibilities must remain visible and typed.

### 9.2 What stays out of shared config

The product manifest must not centralize:

- endpoint definitions;
- product permission logic;
- WorkOS or other identity-provider workflows;
- package version numbers unless used only as generation metadata;
- secrets;
- publish credentials;
- release automation ownership;
- environment-specific production URLs that belong in product deployment configuration.

### 9.3 Escape hatches

Supported escape hatches must be narrow and reportable:

- operation hints keyed by `METHOD /path`;
- service mount rules;
- schema and field naming hints;
- language-specific emitter options;
- hand-owned type declarations;
- hand-owned service/resource files;
- an emergency `transformSpec` hook.

`transformSpec` is an emergency adapter, not routine policy. Every transform must:

- be deterministic and idempotent;
- include a reason and issue link in configuration;
- emit a diagnostic entry;
- have a fixture test;
- be removed when the source contract is fixed.

## 10. Compiler package design

### 10.1 Proposed repository layout

```text
sdk-codegen/
├── src/
│   ├── cli/
│   │   ├── generate.ts
│   │   ├── check.ts
│   │   ├── validate.ts
│   │   ├── compat.ts
│   │   ├── verify.ts
│   │   └── snippets.ts
│   ├── config/
│   │   ├── schema.ts
│   │   ├── load.ts
│   │   └── define.ts
│   ├── contract/
│   │   ├── validate.ts
│   │   ├── normalize.ts
│   │   ├── extensions.ts
│   │   ├── profiles.ts
│   │   └── diagnostics.ts
│   ├── oagen/
│   │   ├── plugin.ts
│   │   ├── behavior.ts
│   │   ├── operations.ts
│   │   └── provenance.ts
│   ├── emitters/
│   │   ├── typescript-effect/
│   │   └── shared/
│   ├── targets/
│   │   ├── typescript.ts
│   │   ├── python.ts
│   │   ├── go.ts
│   │   └── rust.ts
│   ├── compat/
│   │   ├── policy.ts
│   │   ├── report.ts
│   │   └── baselines.ts
│   ├── testing/
│   │   ├── fixtures.ts
│   │   ├── smoke-server.ts
│   │   └── runners.ts
│   └── index.ts
├── fixtures/
│   ├── contracts/
│   ├── expected/
│   └── wire-cases/
├── docs/
├── scripts/
├── test/
├── README.md
├── LICENSE
├── UPSTREAM.md
└── package.json
```

### 10.2 Public package API

The package should expose:

```ts
export { defineSdkConfig } from "./config/define";
export type { SignalflareSdkConfig } from "./config/schema";
export { validateProductContract } from "./contract/validate";
export { buildProfileContract } from "./contract/profiles";
export { signalflareOagenPlugin } from "./oagen/plugin";
export { signalflareCompatPolicy } from "./compat/policy";
```

Most product repositories should use the CLI and `defineSdkConfig`. Lower-level exports exist for tests and exceptional integration.

### 10.3 CLI

The package binary is:

```text
signalflare-sdk
```

Required commands:

```bash
signalflare-sdk validate --config sdk.config.ts
signalflare-sdk generate --config sdk.config.ts
signalflare-sdk check --config sdk.config.ts
signalflare-sdk compat --config sdk.config.ts
signalflare-sdk verify --config sdk.config.ts
signalflare-sdk snippets --config sdk.config.ts
```

Optional diagnostic commands:

```bash
signalflare-sdk inspect-contract --config sdk.config.ts
signalflare-sdk inspect-profile access --config sdk.config.ts
signalflare-sdk explain-operation atlas.catalog.tables.list
```

Command behavior:

- `validate` checks contract and configuration only;
- `generate` writes deterministic output and manifests;
- `check` generates into a temporary directory and fails on diff;
- `compat` compares generated public surfaces against committed baselines;
- `verify` runs formatting, compilation, generated tests, and wire smoke tests;
- `snippets` emits documentation snippets from the same operation plan.

All commands must support JSON report output for CI.

### 10.4 Oagen plugin assembly

The Signalflare plugin should register only enabled emitters and extractors, not the entire upstream language bundle.

Conceptually:

```ts
import {
  nodeEmitter,
  pythonEmitter,
  goEmitter,
  rustEmitter,
  nodeExtractor,
  pythonExtractor,
  goExtractor,
  rustExtractor,
} from "@workos/oagen-emitters";

export const signalflareOagenPlugin = {
  emitters: [nodeEmitter, pythonEmitter, goEmitter, rustEmitter, effectEmitter],
  extractors: [nodeExtractor, pythonExtractor, goExtractor, rustExtractor],
  smokeRunners: signalflareSmokeRunners,
};
```

The actual Effect generation may be a post-pass over the shared TypeScript output rather than a full independent Oagen language emitter. The implementation spike must select the design that avoids duplicated TypeScript models and serializers.

### 10.5 Runtime requirements

The reviewed Oagen and emitter packages require Node.js 24.10 or newer. The codegen package must align its engine requirement unless the initial spike proves a supported lower runtime.

Recommended initial runtime policy:

```json
{
  "engines": {
    "node": ">=24.10.0"
  }
}
```

Bun may remain the package manager and task runner, but generation must be tested under the supported Node runtime because Oagen declares Node engine requirements.

Dependencies must be pinned exactly during initial development. Automated dependency updates require regenerated golden fixtures and all language verification jobs.

## 11. Generated target design

### 11.1 Shared rules

Every target must generate:

- request and response models;
- enums and unions;
- resource/service methods;
- base client configuration;
- request serialization;
- response decoding;
- structured API errors;
- authentication header support;
- request ID propagation;
- generated tests or fixtures;
- operation metadata/provenance;
- a public-surface compatibility snapshot.

Every target must support:

- custom base URL;
- bearer token or contract-defined API key configuration;
- custom headers;
- timeout configuration;
- test transport or custom HTTP transport where idiomatic;
- product/language/version user-agent identification.

### 11.2 TypeScript Promise client

Recommended package shape inside a product package:

```text
src/
├── generated/
│   ├── models/
│   ├── resources/
│   ├── serialization/
│   ├── client.ts
│   ├── errors.ts
│   └── operation-manifest.ts
├── client.ts          # optional hand-owned convenience facade
├── effect.ts          # hand-owned/generated Effect entrypoint
└── index.ts
```

Recommended exports for Atlas:

```text
@signalflare-ai/atlas/client
@signalflare-ai/atlas/pipelines
@signalflare-ai/atlas/runner
@signalflare-ai/atlas/admin
@signalflare-ai/atlas/effect
@signalflare-ai/atlas/models
@signalflare-ai/atlas/errors
@signalflare-ai/atlas/openapi.json
```

The generated Promise client should use standard `fetch`, allow an injected fetch implementation, and avoid pulling Effect into the default dependency graph.

### 11.3 TypeScript Effect client

The Effect client must target the Effect version selected by the product repository. For Atlas, that is Effect v4.

The Effect surface should provide:

- a service tag or equivalent client interface;
- a Layer constructor from endpoint/auth/fetch options;
- one Effect-returning method per generated operation;
- typed expected API errors;
- transport/decode defects represented consistently;
- interruption-aware requests;
- spans annotated with product, operation ID, HTTP method/path, status, and request ID;
- retry behavior derived from shared SDK policy, not ad hoc method wrappers.

Illustrative API:

```ts
import { Effect } from "effect";
import { Atlas } from "@signalflare-ai/atlas/effect";

const program = Effect.gen(function* () {
  const atlas = yield* Atlas;
  return yield* atlas.access.tables.list({ schema: "raw" });
});

await Effect.runPromise(
  program.pipe(
    Effect.provide(
      Atlas.layer({
        endpoint: process.env.ATLAS_API_URL!,
        token: process.env.ATLAS_TOKEN!,
      }),
    ),
  ),
);
```

This example is a target API, not a statement about the current Atlas package.

The Promise and Effect clients must use the same wire serializers and response models. Their compatibility surfaces are checked separately because method return types differ.

### 11.4 Python client

Recommended generated package layout:

```text
signalflare_atlas/
├── client.py
├── async_client.py
├── access/
├── pipelines/
├── runner/
├── admin/
├── models/
├── errors.py
└── _internal/
```

Requirements:

- sync client in the first production release;
- async client generated from the same operation plan;
- typed request parameter groups;
- explicit `NOT_GIVEN`-style sentinel for omitted optional fields;
- explicit `None` support only for nullable fields;
- structured error types;
- context-manager support where appropriate;
- Python type checking in CI;
- unknown union/enum preservation where practical.

Illustrative API:

```py
from signalflare_atlas import AtlasClient

client = AtlasClient(
    endpoint=os.environ["ATLAS_API_URL"],
    token=os.environ["ATLAS_TOKEN"],
)

tables = client.access.tables.list(schema="raw")
run = client.pipelines.run(pipeline_id="orders_daily")
report = client.pipelines.wait_for_run(run.run_id)
```

`wait_for_run` is a candidate handwritten facade helper; the endpoint methods and models are generated.

### 11.5 Go client

Recommended module layout:

```text
atlas/
├── client.go
├── errors.go
├── access/
├── pipelines/
├── runner/
├── admin/
└── models/
```

Requirements:

- `context.Context` on every network method;
- idiomatic options structs;
- explicit pointer/value rules for optional and nullable fields;
- structured API error type preserving status, code, request ID, and details;
- injectable `http.Client`;
- no hidden global client;
- `gofmt`, `go vet`, compilation, and wire smoke tests.

Illustrative API:

```go
client := atlas.NewClient(
    atlas.WithBaseURL(os.Getenv("ATLAS_API_URL")),
    atlas.WithToken(os.Getenv("ATLAS_TOKEN")),
)

tables, err := client.Access.Tables.List(ctx, &atlas.ListTablesOptions{
    Schema: atlas.String("raw"),
})
if err != nil {
    return err
}
```

### 11.6 Rust client

Recommended crate layout:

```text
src/
├── client.rs          # may remain hand-owned
├── error.rs           # may remain hand-owned
├── access/
├── pipelines/
├── runner/
├── admin/
├── models/
├── pagination.rs
└── lib.rs
```

Requirements:

- async client based on a product-selected HTTP transport;
- `Result<T, AtlasError>`-style structured errors;
- `serde` models;
- forward-compatible union/enum handling where possible;
- builder or options structs for optional parameters;
- explicit timeouts;
- no panics for normal decode or transport failures;
- `cargo fmt`, `cargo check`, tests, and wire smoke tests.

Illustrative API:

```rust
let client = AtlasClient::builder()
    .base_url(std::env::var("ATLAS_API_URL")?)
    .token(std::env::var("ATLAS_TOKEN")?)
    .build()?;

let tables = client
    .access()
    .tables()
    .list(ListTablesRequest {
        schema: Some("raw".to_owned()),
        ..Default::default()
    })
    .await?;
```

Like the upstream hybrid Rust pattern, foundational client/error/pagination files may remain hand-owned while resource and model files are generated. Such ownership must be explicit through the manifest and ignore markers.

### 11.7 Snippet generation

Snippets are separate outputs from full SDK emitters, but must consume the same selected profile and operation plan.

Generate at least:

- minimal authentication/client construction;
- one request example per operation;
- pagination example where applicable;
- error handling example;
- async example for Python and Rust;
- Effect example for TypeScript Effect.

Snippets are documentation artifacts, not compile substitutes. Selected snippets should be compiled or type-checked in CI.

## 12. Hand-owned versus generated code

### 12.1 Generated ownership

Generated code owns:

- models;
- enums/unions;
- wire serializers/deserializers;
- endpoint methods;
- resource/service classes or modules;
- operation manifests;
- generated endpoint tests;
- generated snippets.

### 12.2 Hand-owned ownership

Handwritten code may own:

- auth exchange and client rebinding;
- `waitForRun`/polling helpers;
- auto-pagination helpers beyond the raw page methods;
- domain-specific query result generics;
- local pipeline-document validation convenience;
- framework integration layers;
- user-agent package version wiring;
- custom transports;
- migration aliases during a deprecation window.

Handwritten facades must call generated methods rather than duplicate URLs or request schemas.

### 12.3 Ownership markers

The generator must support explicit hand-owned files and types. It must never overwrite an existing hand-owned file by inference alone.

Required mechanisms:

- generated file headers;
- `.oagen-manifest.json`;
- optional `@oagen-ignore-file` markers for compatible upstream emitters;
- product config lists for hand-owned files/types/services;
- a generation failure when ownership is ambiguous.

## 13. Provenance and manifests

Every target output must include Oagen's `.oagen-manifest.json` as the authoritative generated-file ownership and provenance record. The compiler must not replace or fork this format.

The Oagen manifest already records the language, SDK name, generated files, source specification path/hash, emitter version/hash, configuration hash, compatibility schema version, and generation time. Signalflare should not duplicate those fields in a second mandatory manifest.

If product/profile metadata cannot be represented through the upstream manifest, the compiler may write a small deterministic `.signalflare-sdk-manifest.json` sidecar:

```json
{
  "schemaVersion": 1,
  "product": "atlas",
  "profiles": ["access", "pipelines", "runner", "admin"],
  "target": "typescript",
  "compilerVersion": "0.1.0",
  "openapiBaseline": "3.1.2"
}
```

The sidecar must not duplicate Oagen's generated-file list, source digest, emitter digest, or configuration digest.

Determinism rules:

- timestamps must not appear in generated source files or the Signalflare sidecar;
- `check` must ignore or normalize Oagen's volatile `generatedAt` field;
- normal generation should avoid rewriting a committed manifest when inputs and emitted files are unchanged;
- stale files may be pruned only when the prior Oagen manifest owns the file and the generation header guard matches.

Together, the manifests support:

- provenance;
- safe stale-file pruning;
- debugging generator changes;
- compatibility baselines;
- release attestations;
- reproducibility checks.

## 14. Compatibility policy

### 14.1 Two compatibility dimensions

Every change is checked at two levels:

1. **Wire contract compatibility** — old versus new OpenAPI.
2. **Language SDK compatibility** — baseline versus candidate public SDK surface.

Both checks are required. A wire-additive change may still be source-breaking in a language SDK.

### 14.2 Stable operation policy

For stable production operations, fail compatibility on:

- operation removal;
- `operationId` change;
- source API ID change without an explicit migration mapping;
- HTTP method or path change;
- parameter location change;
- required parameter addition;
- optional parameter becoming required;
- nullable input becoming non-nullable;
- response type replacement or narrowing;
- required response field removal;
- enum member removal;
- authentication requirement becoming stricter without a major release;
- public method/service/model removal in a generated SDK;
- public return type change;
- generated package export removal.

### 14.3 Soft-risk changes

Report and require review for:

- non-nullable response becoming nullable;
- enum member addition in closed-enum targets;
- numeric type widening or narrowing;
- new success status codes;
- pagination strategy changes;
- a model moving between generated service modules;
- a method rename produced only by naming-policy changes;
- a new required error-handling branch in an Effect client;
- changes to retry/idempotency behavior.

Product policy may promote a soft risk to a failure.

### 14.4 Allowed additive changes

Normally allow:

- new stable operation;
- new optional request field;
- new optional response field;
- new model used only by a new operation;
- description/example changes;
- new preview operations;
- removal of never-shipped preview operations;
- new SDK snippets.

### 14.5 Deprecation

Stable methods must be deprecated before removal.

A product config defines its minimum deprecation window. Generated SDKs must carry language-appropriate deprecation markers and replacement guidance from the OpenAPI description or extension.

Removal still requires the product's major-version policy even after the window expires.

### 14.6 Baselines

Each generated language commits:

- `.oagen-compat-snapshot.json`;
- the prior released OpenAPI artifact or its immutable digest/reference;
- any allowed-break exceptions with owners and expiration dates.

Compatibility exceptions must be narrowly keyed to symbols or operations. A blanket “allow breaking” mode is not acceptable in protected branches.

## 15. Verification strategy

### 15.1 Test layers

The shared repository must use five layers:

1. **Unit tests** — config, extensions, profile selection, validation, naming, and compatibility policy.
2. **Golden generation tests** — fixture OpenAPI in, exact generated tree out.
3. **Language compile tests** — compile/type-check every generated fixture.
4. **Wire smoke tests** — run generated requests against a deterministic local HTTP server and compare method, path, query, headers, and body.
5. **Product integration tests** — run selected SDK flows against each product's local API.

### 15.2 Required fixture matrix

Fixtures must cover:

- required/optional/nullable combinations;
- path/query/header/body parameters;
- empty success responses;
- structured errors;
- arrays/maps;
- date/date-time/UUID/binary formats;
- oneOf/anyOf/allOf;
- discriminated unions and unknown variants;
- open and closed enums;
- cursor and offset pagination;
- multiple servers/source APIs;
- operation profiles;
- implemented versus preview operations;
- deprecated operations;
- hand-owned files/types;
- stale generated file pruning;
- additive and breaking compatibility changes.

### 15.3 Language gates

TypeScript:

- format/lint;
- `tsc --noEmit`;
- Promise client tests;
- Effect v4 type/error tests;
- Node/Bun wire smoke test as supported.

Python:

- formatter/linter;
- static type checker;
- sync and async unit tests;
- wire smoke test.

Go:

- `gofmt`;
- `go vet`;
- `go test`;
- wire smoke test.

Rust:

- `cargo fmt --check`;
- `cargo check`;
- `cargo test`;
- wire smoke test.

### 15.4 Product adoption gate

A product target is not production-ready until:

- its generated package compiles;
- all stable profile operations are represented;
- no preview operation is accidentally exported;
- auth and base URL behavior are tested;
- structured errors are decoded;
- a live local product smoke test passes;
- compatibility baseline is committed;
- generated docs contain at least one working quickstart.

## 16. Continuous integration

### 16.1 Shared compiler CI

Required jobs:

1. install with frozen lockfile;
2. lint and format check;
3. TypeScript typecheck;
4. unit tests;
5. golden tests;
6. generate all fixture targets;
7. TypeScript/Effect compile and smoke;
8. Python compile/type/smoke;
9. Go compile/test/smoke;
10. Rust compile/test/smoke;
11. package build;
12. package API compatibility check;
13. dependency/license audit.

Language jobs should run in parallel after fixture generation artifacts are available.

### 16.2 Product repository CI

Recommended flow:

```text
build/update canonical OpenAPI
        ↓
validate OpenAPI and route parity
        ↓
signalflare-sdk validate
        ↓
signalflare-sdk generate
        ↓
git diff --exit-code
        ↓
signalflare-sdk compat
        ↓
signalflare-sdk verify
        ↓
product-specific integration tests
```

Recommended scripts:

```json
{
  "scripts": {
    "sdk:validate": "signalflare-sdk validate --config sdk.config.ts",
    "sdk:generate": "signalflare-sdk generate --config sdk.config.ts",
    "sdk:check": "signalflare-sdk check --config sdk.config.ts",
    "sdk:compat": "signalflare-sdk compat --config sdk.config.ts",
    "sdk:verify": "signalflare-sdk verify --config sdk.config.ts"
  }
}
```

## 17. Security and trust requirements

The compiler and generated SDKs must:

- never embed credentials or environment values in generated output;
- redact configured sensitive patterns from diagnostics;
- avoid logging bearer tokens, cookies, API keys, request bodies marked sensitive, or authorization headers;
- preserve server-provided request IDs;
- use HTTPS defaults for production server URLs;
- make insecure/custom URLs explicit constructor options;
- avoid automatic retries for non-idempotent operations unless policy explicitly allows them;
- support idempotency headers where the contract declares them;
- prevent path-template injection through correct URL encoding;
- serialize query parameters without string concatenation vulnerabilities;
- bound response-body capture in errors;
- pin and review generator dependencies;
- publish provenance for compiler releases.

The shared compiler must not make authorization decisions. Generated clients send credentials and decode authorization errors; the product API remains authoritative.

## 18. Runtime behavior policy

Oagen's language-neutral SDK behavior is the base for shared defaults. Signalflare must define and version policy for:

- retryable status codes;
- maximum attempts and backoff;
- timeout defaults;
- request ID headers;
- SDK telemetry headers;
- user-agent format;
- idempotency header names and eligible methods;
- pagination delays;
- logging hooks;
- misplaced-options request guards.

Recommended user-agent format:

```text
signalflare-{product}/{sdk-version} ({language}; sdk-codegen/{compiler-version})
```

Runtime policy changes can alter application behavior even when models and methods remain source-compatible. They must appear in compatibility reports and release notes.

## 19. Diagnostics and reporting

Every command should be human-readable by default and support JSON output.

A generation report should include:

- product and contract digest;
- selected profiles;
- selected/skipped operation counts;
- per-target generated/updated/pruned file counts;
- hand-owned files encountered;
- transforms/hints used;
- unsupported constructs;
- compatibility summary;
- compile/smoke status;
- compiler and Oagen versions.

`check` and `compat` should also produce concise Markdown suitable for pull-request comments.

Errors must identify:

- source file and JSON pointer where possible;
- operation ID and `METHOD /path`;
- source API ID;
- target language if target-specific;
- remediation guidance.

## 20. Release and versioning model

### 20.1 Compiler release

`@signalflare-ai/sdk-codegen` follows semantic versioning.

- patch: bug fix with no intended generated public-surface change;
- minor: new supported OpenAPI feature, language feature, command, or additive policy;
- major: configuration API break, default naming break, generated layout break, or compatibility-policy break.

Because a compiler patch can accidentally change output, every release is tested against pinned fixture and product canaries.

### 20.2 Product SDK releases

Product repositories own SDK versions and publish independently.

Generated SDK versions are not automatically equal to:

- the API `info.version`;
- the compiler version;
- another language's package version.

A product may choose aligned cross-language versions, but that is product release policy.

### 20.3 Compiler upgrades in products

Compiler upgrades should be explicit dependency pull requests containing:

- old/new compiler versions;
- generated diff;
- compatibility reports;
- compile and smoke results;
- any newly adopted behavior.

No floating generator version is allowed in protected CI.

## 21. Adoption plan

### 21.1 Atlas

Atlas is the first adopter because it already has:

- a typed method registry;
- generated OpenAPI;
- a published package boundary;
- a handwritten TypeScript client to use as a compatibility baseline;
- clearly separable access, pipeline, runner, admin, and preview operations.

Atlas prerequisites:

1. normalize the generated document to OpenAPI 3.1.2;
2. fix GET/DELETE parameter locations;
3. eliminate path/body duplication;
4. fix optional-versus-nullable mismatches;
5. assign stable operation IDs and SDK audiences;
6. separate stable implemented operations from contract preview;
7. verify product/admin security scheme assignment;
8. commit the normalized contract and route-parity tests.

Atlas rollout order:

1. generate TypeScript models and access client alongside the handwritten client;
2. extract and preserve the current public TypeScript surface where desired;
3. add Promise and Effect clients over one generated TS core;
4. generate pipeline and runner clients;
5. generate Python sync/async;
6. generate Go and Rust;
7. migrate handwritten endpoint wrappers to thin facades;
8. deprecate duplicate handwritten transport code.

### 21.2 Navigator

Navigator already generates separate TypeScript clients for its main API and DAPI.

Navigator prerequisites:

1. keep its source API generators separate;
2. build one canonical product OpenAPI artifact from those sources;
3. attach stable source API IDs and per-operation servers/auth;
4. preserve current generated TypeScript method names through a compatibility baseline;
5. map existing main API and DAPI exports into product profiles/services.

Navigator should initially adopt the shared compiler for validation and compatibility before replacing all existing TypeScript generation in one step.

### 21.3 Forge

Forge requires contract normalization first.

Forge prerequisites:

1. convert the full Swagger 2.0 source into a validated OpenAPI 3.1.2 product contract;
2. reconcile the small current OpenAPI `/version` surface with the full API;
3. establish stable operation IDs and tags;
4. document auth schemes and special headers such as sudo/TOTP behavior;
5. extract the handwritten Rust client's public surface as a compatibility baseline.

Forge rollout should begin with a narrow generated resource set, preserving the handwritten Rust client core until generated transport and errors match existing behavior.

## 22. Implementation phases

### Phase 0 — Repository and upstream baseline

**Deliverables**

- MIT `LICENSE`;
- `CONTRIBUTING.md` and security policy;
- `UPSTREAM.md` recording reviewed Oagen repositories and commits;
- exact dependencies on `@workos/oagen` and `@workos/oagen-emitters`;
- Node engine alignment;
- build, typecheck, lint, and test scripts;
- CI skeleton.

**Exit criteria**

- package builds from a clean checkout;
- tests run on the declared Node version;
- upstream licenses and provenance are documented;
- no generated product code exists in this repository.

### Phase 1 — Config, validation, and profile compiler

**Deliverables**

- `defineSdkConfig`;
- typed configuration validation;
- OpenAPI 3.1.2 validation;
- Signalflare extension parser;
- operation profile selection;
- implemented/preview enforcement;
- contract diagnostics and JSON report;
- multi-source API identity support;
- fixture contracts.

**Exit criteria**

- `signalflare-sdk validate` works;
- malformed GET/path/body/nullability cases fail with actionable diagnostics;
- profile selection is deterministic and fixture-tested;
- preview operations cannot enter production profiles.

### Phase 2 — Oagen orchestration and TypeScript

**Deliverables**

- Signalflare Oagen plugin assembly;
- deterministic generation wrapper;
- TypeScript Promise target;
- shared TypeScript generated core;
- Effect v4 target/facade;
- generated-file and Signalflare manifests;
- TypeScript compatibility extraction;
- TypeScript golden, compile, and wire tests.

**Exit criteria**

- one fixture generates both Promise and Effect clients without duplicate models;
- both clients make equivalent wire requests;
- stable public surfaces are diffed;
- stale generated files are safely pruned;
- hand-owned files are preserved.

### Phase 3 — Python

**Deliverables**

- sync and async Python clients;
- omission sentinel and nullable handling;
- models/errors/resources;
- Python compatibility extraction;
- format, type, compile, unit, and wire tests;
- snippets.

**Exit criteria**

- sync/async methods come from one operation plan;
- omitted versus explicit `None` is wire-tested;
- structured errors preserve request ID and details;
- fixture package passes the Python gates.

### Phase 4 — Go and Rust

**Deliverables**

- Go target and extractor integration;
- Rust target and extractor integration;
- hand-owned runtime boundaries documented;
- language-specific union/enum policy;
- compile, unit, and wire tests;
- snippets.

**Exit criteria**

- both targets compile from the shared fixtures;
- nullable/optional semantics are tested;
- generated errors preserve structured API details;
- no normal transport/decode path panics.

### Phase 5 — Compatibility, reports, and release workflow

**Deliverables**

- cross-language compatibility policy;
- committed baseline workflow;
- PR Markdown summaries;
- `check`, `compat`, `verify`, and `snippets` commands;
- release provenance;
- compiler upgrade guide.

**Exit criteria**

- a deliberately breaking fixture fails all relevant gates;
- an additive fixture passes;
- soft-risk changes are reported;
- generated docs/snippets compile where practical.

### Phase 6 — Atlas pilot

**Deliverables**

- corrected Atlas canonical OpenAPI;
- Atlas `sdk.config.ts`;
- generated TypeScript Promise and Effect clients;
- preserved or intentionally migrated existing TypeScript surface;
- generated Python pilot;
- local Worker integration tests;
- migration notes.

**Exit criteria**

- Atlas's stable implemented operations are represented in the intended profiles;
- the current handwritten client has a documented migration path;
- Promise, Effect, and Python smoke tests pass against a local Atlas API;
- no contract-preview methods ship in stable exports.

### Phase 7 — Navigator and Forge adoption

**Deliverables**

- Navigator canonical product artifact and migration plan;
- Forge OpenAPI 3.1.2 normalization plan and first generated resource slice;
- product-specific release pipelines;
- cross-product compiler canary suite.

**Exit criteria**

- all three products run shared contract validation in CI;
- at least two products ship generated SDK code;
- compiler upgrades are canaried against all three product contracts.

### Phase 8 — OpenAPI 3.2 conformance

**Deliverables**

- OpenAPI 3.2 fixture suite;
- parser/emitter gap report;
- upstream issues or patches;
- explicit compatibility policy for new 3.2 features;
- migration decision.

**Exit criteria**

- all enabled languages pass 3.2 fixtures;
- no silent schema loss occurs;
- the authoring baseline is upgraded only after product canary success.

## 23. Initial backlog

### P0: compiler foundation

- [ ] Add `LICENSE`.
- [ ] Add `UPSTREAM.md` with Oagen provenance.
- [ ] Align Node engine with upstream requirements.
- [ ] Add TypeScript build/test/lint tooling.
- [ ] Define and validate `sdk.config.ts`.
- [ ] Implement OpenAPI 3.1.2 contract validation.
- [ ] Implement `x-signalflare-product`, `x-signalflare-api-id`, and `x-signalflare-sdk` parsing.
- [ ] Implement profile selection and preview exclusion.
- [ ] Add JSON diagnostics.

### P1: TypeScript pilot

- [ ] Wire selected upstream Oagen emitters/extractors.
- [ ] Generate a deterministic TypeScript fixture SDK.
- [ ] Implement shared Promise/Effect TypeScript core.
- [ ] Add Effect v4 service/layer generation.
- [ ] Add generated-file ownership tests.
- [ ] Add TypeScript API-surface compatibility checks.
- [ ] Add wire smoke server and tests.

### P2: Python, Go, Rust

- [ ] Add Python sync/async target.
- [ ] Add omission/nullability tests.
- [ ] Add Go target.
- [ ] Add Rust target.
- [ ] Add cross-language error fixtures.
- [ ] Add cross-language compatibility reports.

### P3: product pilots

- [ ] Normalize Atlas OpenAPI.
- [ ] Generate Atlas access SDK.
- [ ] Generate Atlas pipeline and runner surfaces.
- [ ] Create Navigator canonical product contract.
- [ ] Normalize Forge Swagger 2.0 contract.
- [ ] Add product canary tests.

## 24. Risks and mitigations

| Risk                                                             | Impact                                             | Mitigation                                                                                            |
| ---------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Upstream emitters contain WorkOS-specific assumptions.           | Generated output may not fit Signalflare packages. | Spike real fixture output first; use options/wrappers; selectively vendor only blocked emitters.      |
| One canonical product document obscures separate API boundaries. | Wrong server/auth selection.                       | Require source API IDs, per-operation servers/security where needed, and boundary validation.         |
| Generator transforms hide contract bugs.                         | SDK and server drift.                              | Treat transforms as temporary, diagnosed, issue-linked, and fixture-tested.                           |
| Optional/nullable semantics vary by language.                    | Incorrect payloads or unusable clients.            | Four-state contract validation and wire fixtures across all languages.                                |
| Enum additions break exhaustive consumers.                       | Source compatibility regressions.                  | Unknown-preserving representations and soft-risk compatibility reports.                               |
| Promise and Effect clients diverge.                              | Duplicate behavior and bugs.                       | One generated TS core and wire-equivalence tests.                                                     |
| Compiler upgrades create large diffs.                            | Difficult reviews and adoption resistance.         | Exact version pins, deterministic generation, product canaries, and compatibility reports.            |
| Generated files overwrite custom code.                           | Data loss in SDK repositories.                     | Manifest ownership, ignore markers, hand-owned config, and ambiguous-ownership failure.               |
| Multi-language CI is slow.                                       | Poor contributor experience.                       | Parallel language jobs, fixture artifact reuse, and fast `validate`/`check` local commands.           |
| OpenAPI 3.2 features exceed current Oagen behavior.              | Silent contract loss.                              | Keep 3.1.2 baseline until a dedicated 3.2 conformance phase passes.                                   |
| Forge contract conversion changes semantics.                     | Generated client incompatibility.                  | Extract handwritten Rust surface, migrate resource-by-resource, and retain hand-owned core initially. |

## 25. Open decisions

These decisions should be resolved during the named phase, not before implementation evidence exists.

1. **Effect implementation shape:** full Oagen emitter versus post-pass/facade over generated TypeScript endpoint descriptors. Resolve in Phase 2 by choosing the design with one model/serializer source.
2. **TypeScript package topology:** one product package with subpath exports versus separate Promise/Effect packages. Default to one package unless peer dependency constraints require separation.
3. **HTTP runtimes for Python, Go, and Rust:** select idiomatic libraries during target spikes and keep transport injection possible.
4. **Canonical product composition:** shared compiler helper versus product-owned composition step. Default to product-owned composition; add a shared helper only after two products need the same logic.
5. **Open enum representation:** determine target-specific defaults through fixtures and compatibility behavior.
6. **Version alignment across languages:** product policy, not compiler policy.
7. **Selective emitter vendoring:** allowed only after the upstream-first spike and a recorded blocker.
8. **OpenAPI 3.2 promotion:** only after Phase 8 conformance results.

## 26. Definition of done

The SDK codegen project is production-ready when:

- the public compiler package is versioned and documented;
- Atlas, Navigator, and Forge can each provide a canonical product OpenAPI plus local config;
- OpenAPI contracts are validated for parameter, nullability, error, security, profile, and preview correctness;
- TypeScript Promise, TypeScript Effect, Python, Go, and Rust targets are supported by fixture tests;
- generated outputs are deterministic and safely owned through manifests;
- stable SDK surfaces are compatibility-checked per language;
- generated packages compile and pass wire smoke tests;
- product repositories own and release their generated SDKs;
- compiler upgrades are reproducible and reviewed through generated diffs;
- no stable SDK exposes an unimplemented preview operation;
- no product endpoint or authorization policy is centralized in this repository.

## 27. Reference versions and provenance

The design was prepared against these reviewed upstream snapshots:

| Project                                                             | Version  | Commit                                                                                                                                 | Role                                                                                               |
| ------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [`workos/oagen`](https://github.com/workos/oagen)                   | `0.29.2` | [`e7683f6eff0a68ffb17df2bc8919a791317063cc`](https://github.com/workos/oagen/commit/e7683f6eff0a68ffb17df2bc8919a791317063cc)          | OpenAPI parser, IR, operation planning, generation engine, manifests, compatibility, verification. |
| [`workos/oagen-emitters`](https://github.com/workos/oagen-emitters) | `0.24.4` | [`95d41c5221ddd424a579000893cf52b0f54b5e4b`](https://github.com/workos/oagen-emitters/commit/95d41c5221ddd424a579000893cf52b0f54b5e4b) | Existing TypeScript/Node, Python, Go, Rust emitters, extractors, snippets, and smoke runners.      |

Relevant upstream concepts:

- Oagen Parse → Emit → Write architecture;
- shared `ApiSpec` IR and `OperationPlan`;
- `OagenConfig` plugin registration, operation hints, mount rules, field hints, and emitter options;
- `.oagen-manifest.json` generated-file ownership;
- compatibility surface extraction and overlay;
- `compat-extract`, `compat-diff`, `generate`, and `verify` workflows;
- temporary pre-IR `transformSpec` adapters;
- language-specific smoke runners;
- hybrid generated/hand-owned SDKs.

OpenAPI references:

- [OpenAPI Specification 3.1.2](https://spec.openapis.org/oas/v3.1.2.html)
- [OpenAPI Specification 3.2.0](https://spec.openapis.org/oas/v3.2.0.html)
- [OpenAPI Initiative specification repository](https://github.com/OAI/OpenAPI-Specification)

## Appendix A — Illustrative Atlas usage by profile

These examples define the target ergonomics. Exact names will be finalized through generated compatibility fixtures.

### A.1 Governed access: TypeScript

```ts
import { AtlasClient } from "@signalflare-ai/atlas/client";

const atlas = new AtlasClient({
  endpoint: process.env.ATLAS_API_URL!,
  token: process.env.ATLAS_TOKEN!,
});

const tables = await atlas.access.tables.list({ schema: "raw" });
const description = await atlas.access.tables.describe({
  schema: "raw",
  table: "orders",
});
const result = await atlas.access.query.execute({
  sql: "select * from raw.orders limit 10",
});
```

### A.2 Pipeline authoring: TypeScript

```ts
import { AtlasClient } from "@signalflare-ai/atlas/client";

const atlas = new AtlasClient({
  endpoint: process.env.ATLAS_API_URL!,
  token: process.env.ATLAS_TOKEN!,
});

const pipeline = await atlas.pipelines.register({
  pipelineId: "orders_daily",
  document: {
    version: 1,
    source: {
      kind: "postgres",
      connectionRef: "orders-source",
      table: "orders",
    },
    target: {
      schema: "raw",
      table: "orders",
      incremental: {
        strategy: "delete+insert",
        key: "business_date",
        lookbackDays: 7,
      },
    },
  },
});

const run = await atlas.pipelines.run({ pipelineId: pipeline.pipelineId });
const report = await atlas.waitForRun(run.runId);
```

### A.3 Runner protocol: Rust

```rust
let lease = atlas
    .runner()
    .runs()
    .heartbeat(HeartbeatRunRequest {
        run_id: run_id.clone(),
        attempt,
        lease_token: lease_token.clone(),
    })
    .await?;

let authorization = atlas
    .runner()
    .commits()
    .authorize(AuthorizeCommitRequest {
        run_id,
        attempt,
        lease_token,
        operation,
    })
    .await?;
```

### A.4 Admin: Python

```py
from signalflare_atlas import AtlasClient

atlas = AtlasClient(
    endpoint=os.environ["ATLAS_ADMIN_API_URL"],
    token=os.environ["ATLAS_ADMIN_TOKEN"],
)

catalogs = atlas.admin.catalogs.list(org_id="org_123")
```

## Appendix B — Illustrative compatibility matrix

| Contract change                 | Wire result    | TS                  | Effect                | Python              | Go                  | Rust                | Default policy             |
| ------------------------------- | -------------- | ------------------- | --------------------- | ------------------- | ------------------- | ------------------- | -------------------------- |
| Add operation                   | Additive       | Additive            | Additive              | Additive            | Additive            | Additive            | Allow                      |
| Remove stable operation         | Breaking       | Breaking            | Breaking              | Breaking            | Breaking            | Breaking            | Fail                       |
| Add optional request field      | Additive       | Additive            | Additive              | Additive            | Additive            | Additive            | Allow                      |
| Add required request field      | Breaking       | Breaking            | Breaking              | Breaking            | Breaking            | Breaking            | Fail                       |
| Add optional response field     | Additive       | Usually additive    | Usually additive      | Usually additive    | Usually additive    | Usually additive    | Allow + compile            |
| Response field becomes nullable | Wire widening  | Source risk         | Error-union/type risk | Type risk           | Pointer/type risk   | `Option` risk       | Report/fail by policy      |
| Add enum member                 | Wire additive  | Exhaustiveness risk | Exhaustiveness risk   | Exhaustiveness risk | Exhaustiveness risk | Exhaustiveness risk | Soft risk unless open enum |
| Remove enum member              | Breaking       | Breaking            | Breaking              | Breaking            | Breaking            | Breaking            | Fail                       |
| Change operation ID only        | Wire unchanged | Naming break        | Naming break          | Naming break        | Naming break        | Naming break        | Fail or explicit alias     |
| Remove preview operation        | Preview-only   | N/A stable          | N/A stable            | N/A stable          | N/A stable          | N/A stable          | Allow                      |

## Appendix C — Required first acceptance fixture

The first fixture contract should model one small fictional Signalflare product containing:

- two source API IDs;
- access, pipeline, runner, admin, and preview profiles;
- bearer and API-key security schemes;
- GET path/query parameters;
- POST JSON bodies;
- optional non-nullable and optional nullable fields;
- one discriminated union;
- one open enum;
- structured API errors;
- cursor pagination;
- one deprecated operation;
- one unimplemented preview operation.

The same fixture must generate and wire-test all five client surfaces. This fixture becomes the permanent compiler canary before any real product adoption.
