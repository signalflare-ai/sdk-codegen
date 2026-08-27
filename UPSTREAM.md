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

## Initial review findings

- Oagen provides the OpenAPI 3.x parser, language-neutral IR, operation
  planning, generated-file manifests, compatibility extraction, and verification
  primitives needed by this project.
- The emitter package exposes named Node, Python, Go, and Rust emitters and
  extractors, so Signalflare can register only its enabled targets.
- The emitters are not all greenfield SDK generators. Several intentionally
  expect hand-owned runtime files from existing WorkOS SDKs: Node and Python do
  not emit their error runtimes, Rust keeps its client/error/pagination core
  hand-owned, and Go also omits an error runtime.
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
3. Search for `UPSTREAM.md#temporary-workaround-removal-checklist` so temporary
   adapters cannot survive an upgrade review unnoticed.

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
