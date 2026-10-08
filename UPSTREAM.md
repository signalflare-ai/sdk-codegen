# Upstream dependencies

Signalflare SDK Codegen uses Oagen as a framework and starts from its published
emitters. It does not currently vendor or fork upstream source.

## Reviewed snapshots

| Package                  | Version   | Commit                                                                                                | Repository                                                          |
| ------------------------ | --------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `@workos/oagen`          | `0.29.2`  | [`e7683f6`](https://github.com/workos/oagen/commit/e7683f6eff0a68ffb17df2bc8919a791317063cc)          | [`workos/oagen`](https://github.com/workos/oagen)                   |
| `@workos/oagen-emitters` | `0.24.4`  | [`95d41c5`](https://github.com/workos/oagen-emitters/commit/95d41c5221ddd424a579000893cf52b0f54b5e4b) | [`workos/oagen-emitters`](https://github.com/workos/oagen-emitters) |
| WorkOS Node SDK          | `10.10.0` | [`d871a01`](https://github.com/workos/workos-node/commit/d871a01c37ce3767cfcc7ba1477a5678ffbf92c2)    | [`workos/workos-node`](https://github.com/workos/workos-node)       |

Both package manifests declare the MIT license. Dependencies are pinned exactly
while the initial compiler and fixture suite are being established.

## Effect runtime

The compiler uses stable `effect@4.0.0` and `@effect/platform-bun@4.0.0`.
`@effect/platform-node-shared` is overridden to `4.0.0` to keep platform peer
requirements aligned. The available `4.0.1` release is currently blocked by the
local Bun 50-hour minimum-release-age safety gate; do not bypass that gate.
Stable v4 moved the HttpApi entrypoint from `effect/unstable/httpapi` to
`effect/http-api`; its OpenAPI APIs remain marked unstable upstream and isolated
behind the compiler adapter.

## Reviewed live runtime snapshots

The Python, Go, and Rust emitters deliberately target hand-maintained runtime
files in the corresponding live WorkOS SDKs. These immutable MIT-licensed
snapshots are implementation prior art, not package dependencies, and are never
executed from `.agents/references`.

| SDK                                                        | Version  | Commit                                                                                               | Reusable runtime boundary                                                                 |
| ---------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [`workos-python`](https://github.com/workos/workos-python) | `10.3.0` | [`7aa6894`](https://github.com/workos/workos-python/commit/7aa689481035f24f41765afe59227f46bbacfdb5) | HTTPX sync/async base client, request options, errors, pagination, `NOT_GIVEN`            |
| [`workos-go`](https://github.com/workos/workos-go)         | `10.4.0` | [`be30f8d`](https://github.com/workos/workos-go/commit/be30f8d82e238934a68fdb0c0193c72351d130bd)     | `net/http` request core, options, errors, retries, query encoding, pagination             |
| [`workos-rust`](https://github.com/workos/workos-rust)     | `3.4.0`  | [`afcd055`](https://github.com/workos/workos-rust/commit/afcd055c81a398a895dfb7f76e2084913a73d553)   | pluggable transport, Reqwest/Rustls, builder, errors, retries, query encoding, pagination |

Signalflare wrappers should adapt these small kernels, strip WorkOS-only
services/helpers, and add operation-aware `AuthPlan` resolution. Substantially
adapted source must retain the applicable WorkOS MIT notice in the distributed
third-party notices.

## Initial review findings

- Oagen provides the OpenAPI 3.x parser, language-neutral IR, operation
  planning, generated-file manifests, compatibility extraction, and verification
  primitives needed by this project.
- The emitter package exposes named Node, Python, Go, and Rust emitters and
  extractors, so Signalflare can register only its enabled targets.
- The emitters are not all greenfield SDK generators. Several intentionally
  expect hand-owned runtime files from existing WorkOS SDKs: Node and Python do
  not emit their complete transport/error runtimes, Rust keeps its
  client/error/transport/query/pagination core hand-owned, and Go keeps its
  request/options/error/pagination core hand-owned. The matching live SDK files
  have now been reviewed and should be adapted instead of recreated.
- The Node emitter contains substantial live-SDK adoption and WorkOS layout
  behavior. It must be spiked against the Signalflare acceptance fixture before
  it is treated as the TypeScript target.
- Oagen accepts OpenAPI `3.*`; Signalflare validation therefore runs before the
  Oagen parse step to enforce the narrower 3.1.x policy and SDK metadata rules.
- The TypeScript target now wraps the Node emitter with a Signalflare-owned
  fetch/auth/error runtime modeled on the same generated-resource/hand-owned-core
  boundary used by `workos-node`.
- Oagen 0.29.2 loses variants for standalone component-level discriminated
  unions. The compiler currently reports and applies a temporary open-object
  normalization so wire serialization remains correct; restoring a typed union
  is an upstream issue or a focused emitter enhancement.
- The 0.24.0 → 0.24.4 emitter update contains scoped Python/Ruby, Rust required
  vector-query, Python/.NET list-metadata, and .NET delete fixes. It contains no
  Node emitter change; regenerating the Geocode TypeScript pilot produced an
  identical source tree.

These findings reinforce the upstream-first plan while making a small
Signalflare runtime/configuration layer necessary. They are not currently a
reason to fork.

## Temporary workaround removal checklist

For every `@workos/oagen` or emitter upgrade:

1. Parse the canary standalone `oneOf`/discriminator component without
   `normalizeContractForOagen` and verify that all variants and mappings survive
   in IR and generated TypeScript. If they do, delete the union flattener, its
   warning, and `x-signalflare-normalized-union`.
2. Inspect pagination extraction against list-shaped and cursor-shaped canary
   operations. Remove `stripAutomaticPagination` only when upstream requires an
   explicit contract signal or exposes a policy that disables field-name
   inference; regenerate and wire-test every target afterward.
3. Check whether native emitters expose options for client naming and disabling
   WorkOS-only services. If so, remove the exact Python/Go post-passes and Go's
   generated-client filename override, which prevents a namespace/service
   collision such as `geocode.go`.
4. Check whether native emitters can defer all operation security to a runtime
   auth resolver. If so, remove `stripEmitterManagedSecurity`; until then it
   prevents Python and Rust from treating API-key schemes as explicit bearer
   method parameters.
5. Check Python required-nullable body emission. Remove the focused body
   comprehension rewrite once required `None` values are retained without also
   retaining optional non-null `None` values.
6. Check Python generated query-parameter assertions. Remove the test rewrite
   when non-string values are compared with HTTPX's string-valued
   `QueryParams` representation.
7. Check Rust request-model optional-nullable emission. Remove the
   `OptionalNullable<T>` field rewrite when the emitter preserves missing,
   explicit null, and value states itself.
8. Check Go's generated test expectations for formatted string fields. Remove
   the fixture-alignment rewrite when UUID/date/date-time assertions use the
   same fixture-value logic as fixture generation.
9. Search for `UPSTREAM.md#temporary-workaround-removal-checklist` so temporary
   adapters cannot survive an upgrade review unnoticed.
10. Check Node wire-name emission against the Atlas camelCase fixture. Remove
    `preserveTypeScriptWireNames` once wire properties/accesses retain exact
    OpenAPI names rather than always applying `toSnakeCase`.
11. Check Python keyword model fields (`from` in Atlas lineage). Remove the
    trailing-underscore attribute adapter when the emitter escapes identifiers
    while retaining exact JSON keys.
12. Check Go runtime/service filename collisions and Rust runtime/service
    facades. Remove collision renaming/re-exports when Auth and Query services
    coexist with the runtime kernels without losing generated service types.
13. Check Node compatibility extraction of native Effect error classes. Remove
    `effectExtractionSource` when inherited methods such as `toString` cannot
    collide with prototype keys in the upstream method accumulator. Also check
    alias RHS retention before removing the supplemental alias comparison.
14. Recheck bootstrap ownership: Oagen 0.29.2 merges existing JSON even with
    `overwriteExisting: false`. Preserve identical hand-owned content in the
    emission plan, rather than filtering paths (which can cause TOML pruning).
15. Recheck the pinned Effect resource-method transform and preservation-marker
    filtering on repeated generation. It must fail loud on unfamiliar upstream
    output rather than silently emitting incomplete methods or empty entrypoints.
16. Check Rust compatibility extraction of lifetime-bearing impl receivers:
    `AuthApi<'a>` currently fails to join the bare `AuthApi` struct, dropping
    resource methods. Remove the staging-only receiver normalization once
    upstream associates these receivers correctly.

## Vendoring policy

Vendoring is allowed only after an issue records that emitter options, wrappers,
or a focused upstream change cannot meet a required behavior. If that happens,
only the affected emitter and shared utilities will be copied, upstream license
notices will be retained, and this document will record the source commit and
Signalflare patches.

## Updating

An upstream update must include:

1. the reviewed version and commit in this file;
2. refreshed exact dependency pins and lockfile;
3. regenerated golden fixtures;
4. all target compile and wire tests;
5. a review of generated public-surface changes.
