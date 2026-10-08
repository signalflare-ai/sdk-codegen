# Architecture

Product repositories provide a canonical OpenAPI 3.1 contract and a typed
`sdk.config.ts`. This package validates both before passing a selected contract
to Oagen.

```text
sdk.config.ts + product.openapi.json
              |
              v
configuration and Signalflare contract validation
              |
              v
access / pipelines / runner / admin / preview profile selection
              |
              v
Oagen parse -> IR -> operation plan
              |
              v
Signalflare-configured emitters -> product-owned SDK trees
```

## Current implementation boundary

The implemented vertical slice provides:

- typed manifest definition and runtime validation;
- OpenAPI loading and external-reference bundling;
- OpenAPI 3.1 and Signalflare extension validation;
- deterministic multi-profile selection with preview exclusion;
- structured diagnostics through `signalflare-sdk validate`;
- profile-filtered generation through `signalflare-sdk generate`;
- Oagen manifests enhanced with source/config provenance;
- a Signalflare TypeScript wrapper over the upstream Node emitter;
- generated fetch transport, structured errors, and operation-aware auth;
- strict TypeScript compile and wire/auth tests over the acceptance contract.

Signalflare wrappers now compose the upstream Python, Go, and Rust spec-derived
cores with standalone HTTP, operation-aware auth, structured error, pagination,
nullability, and package-bootstrap runtimes. Their native format, type, compile,
wire, documentation, and package gates run through `bun run test:runtimes`.
TypeScript also emits a native Effect v4 surface when configured, sharing the
same models and serializers. Requests and credentials remain lazy Effects,
with tagged errors, spans, per-call options, cancellation, timeouts, and a
`Context.Service`/`Layer` integration. The Promise entrypoint stays independent
of Effect. Normative runtime behavior
and the remaining product-pilot sequence are tracked in
[`language-runtimes.md`](language-runtimes.md).

## Compiler runtime

Compiler boundary workflows use stable Effect v4 (`effect` and
`@effect/platform-bun` pinned to `4.0.0`). Configuration and contract loading,
validation-command composition, generation, filesystem access, manifests, and
the CLI expose named Effects with schema-backed tagged errors. The Bun CLI is
the runtime boundary and provides the live compiler layer; compiler APIs do not
expose Promise compatibility wrappers.

Pure deterministic transforms—metadata parsing, profile selection, schema
pruning, auth-plan compilation, and IR validation—remain ordinary synchronous
functions. Foreign Promise/throwing APIs from Redocly and Oagen are isolated in
`Effect.tryPromise` adapter boundaries.

## Effect-owned contract sources

The `@signalflare-ai/sdk-codegen/effect-httpapi` subpath isolates Effect's
HttpApi OpenAPI API (`effect/http-api`, still marked unstable upstream) behind
a pinned product-side adapter. Root
annotations inject the 3.1.2 baseline,
product metadata, servers, and global AuthKit bearer policy. Operation annotations
inject stable operation IDs and required `x-signalflare-*` metadata, including
explicit anonymous-security overrides.

`generateSignalflareOpenApi` reuses one immutable reference-policy options object
so Effect's OpenAPI cache remains effective. The policy promotes schemas with
identifiers into components and leaves anonymous schemas inline. Product APIs
should therefore annotate reusable nested request, response, and error schemas
with stable identifiers before generation; this is the intended Atlas migration
path for unresolved nested models.

## Authentication boundary

The compiler preserves named OpenAPI security schemes and each operation's
inherited or overridden requirements. OpenAPI alternatives remain logical OR;
multiple schemes in one alternative remain logical AND; `security: []` remains
anonymous. Generated TypeScript clients select credentials per operation rather
than attaching every configured credential to every request.

Credential acquisition remains application-owned. A WorkOS AuthKit application
passes its current access token as a string or async provider through
`ClientOptions.token`; generated operations only perform standards-based bearer
or API-key attachment.

## Upstream adapters

Oagen 0.29.2 drops variants from standalone component-level discriminated unions.
Until that gap is fixed upstream, generation applies a diagnosed pre-IR adapter
that flattens such unions to an open wire-compatible object. The canonical
contract is never mutated and every applied adapter appears in the generation
report.

## Stable operation identity

The compiler identifies an operation as:

```text
product id + source API id + operationId
```

HTTP method and path remain compatibility inputs, but are not the sole public
identity.

## Validation order

1. Load and validate `sdk.config.ts`.
2. Parse and bundle the OpenAPI document.
3. Enforce the Signalflare 3.1.x policy and vendor extensions.
4. Reject request/response shapes known to misgenerate.
5. Select the union of operations enabled for each target's profiles.
6. Apply diagnosed temporary adapters for known upstream parser gaps.
7. Parse the selected contract into Oagen IR and preserve operationId names.
8. Emit through Oagen, add the target runtime, and write ownership/provenance manifests.

Before writing each target, the compiler validates local imports and extracts
its public compatibility surfaces in a temporary directory. `check` regenerates
and formats in that temporary directory only. `compat` compares a candidate
against the released `.signalflare-compat.json`, combining upstream IR and
language differ reports with conservative auth/route/constraint/export/alias
checks. See [release gates](release-gates.md) for policy and limitations.

Running policy validation before Oagen is intentional: Oagen accepts OpenAPI
`3.*` and its IR does not retain every Signalflare vendor extension needed for
profile selection and diagnostics.
