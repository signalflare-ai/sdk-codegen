# Cleanup Proposals — sdk-codegen

Log of code-pattern review findings. Each item is independently actionable;
check items off as they land. File references use `path:line` where useful.

Status key: `[ ]` open · `[x]` done · `[-]` rejected (note why)

---

## A. Bugs / fragile spots

- [ ] **A1. Hardcoded version strings scattered.**
  - `COMPILER_VERSION = "0.0.0"` in `src/generator/generate.ts`
  - `0.0.0` hardcoded again inside the generated user-agent template in `src/emitters/typescript/runtime.ts`
  - `"3.1.2"` duplicated in `src/config/schema.ts`, `src/contract/validate.ts`, `src/generator/generate.ts` (manifest)
  - Fix: read version from `package.json` (already imported in `test/upstream.test.ts`) or a generated `version.ts`; export one `OPENAPI_BASELINE` constant. Retire the drift test once a single source of truth exists.

- [ ] **A2. `exposeSignalflareClient` string-replaces upstream output with no assertion.**
      `src/emitters/typescript/index.ts` — if `nodeEmitter` renames `export { WorkOS }` or the options-interface path, `.replace()` silently no-ops and generated clients export `WorkOS`.
      Fix: assert the replacement happened (`includes()` before/after) and throw a diagnostic naming the pinned upstream version.

- [ ] **A3. `console.log` monkey-patch in `runOagenGenerate`** (`src/generator/generate.ts`) mutates global state. Safe only because `Effect.forEach` is sequential today.
      Fix: document the sequential-only invariant at minimum; ideally route oagen output through a logger abstraction instead of patching `console`.

- [ ] **A4. Unused parameter:** `effectiveParameters(context, operation)` in `src/contract/validate.ts` never reads `context`. Drop it.

---

## B. Duplication worth collapsing

- [ ] **B1. Two sources of truth for target names.** `TARGETS` in `src/config/validate.ts` vs `TARGET_NAMES` in `src/generator/generate.ts`, plus `TARGET_ID_FIELD`.
      Fix: move `TARGET_NAMES` and the id-field map into `src/config/schema.ts`; import everywhere.

- [ ] **B2. Triple error re-exports.** `SdkConfigLoadError` exported from `src/core/errors.ts`, re-exported by `src/config/load.ts`, and both paths exported again in `src/index.ts` (same for `ContractLoadError`, `GenerationError`).
      Fix: keep one canonical public export path in `src/index.ts`; drop leaf-module re-exports.

- [x] **B3. JSON pointer logic reimplemented.** `pruneUnreferencedSchemas` in `src/contract/profiles.ts` hand-rolled pointer decode + resolution instead of reusing `getAtJsonPointer` (`src/shared/object.ts`). Also `collectSchemaProperties` and `validateLegacyNullable` (`src/contract/validate.ts`) are two ad-hoc tree walkers.
      Landed: pointer tokens now use Effect v4 `JsonPointer.escapeToken` / `unescapeToken`, and profile pruning reuses `getAtJsonPointer`. Effect does not provide a whole-document pointer resolver, so the small resolver remains local. Follow-up: add a shared `walkDocument(value, pointer, visit)` helper for the walkers.

- [ ] **B4. Repeated predicates/guards.**
  - `isJsonMediaType`: `mediaType === "application/json" || mediaType.endsWith("+json")` appears 4x in `src/contract/validate.ts`.
  - `isRecord(components) && isRecord(components.securitySchemes)` duplicated in `src/contract/validate.ts` (`configuredSecuritySchemes`) and `src/contract/auth.ts`.
    Fix: extract `isJsonMediaType` into `src/shared/`; share one `securitySchemesOf(document)` helper.

- [ ] **B5. Identical CLI error handlers.** `SdkConfigLoadError` and `GenerationError` catch handlers in `src/cli/index.ts` are byte-identical.
      Fix: share one `printLoadFailure(error, options)` helper or collapse the catch.

---

## C. Simplification

- [ ] **C1. Split `src/contract/validate.ts` (816 lines, one procedural file).**
  - Reduce `addDiagnostic(context, {severity, code, message, pointer}, operation)` boilerplate (~30 repeats) with a curried per-validator helper.
  - Split into `validate/top-level.ts`, `validate/parameters.ts`, `validate/responses.ts`, `validate/security.ts`.
  - Add a doc comment explaining why validation is hand-rolled instead of Redocly/Spectral rules (assumed: product-specific policy + pointers into `x-signalflare-*` extensions) — confirm and write down the actual reason.

- [ ] **C2. `makeExactOptionalCompatible` applied 6 times** across `src/emitters/typescript/index.ts`, redundantly re-processing already-transformed files (models → again in `generateErrors` wrapper → again over everything in `exposeSignalflareClient`). Idempotent but wasteful.
      Fix: run once as a final pass over the full `GeneratedFile[]`. Comment that it is a regex-based AST-less transform and state its invariants (one property per line, no existing `undefined`).

- [ ] **C3. Document the profile/audience namespace coupling.** `SdkProfile = SdkAudience` in `src/config/schema.ts` deliberately shares one namespace; the `includeAudiences` / `profiles` relationship is the least obvious part of the config.
      Fix: one explanatory sentence in the schema + README.

---

## D. Documentation gaps

- [ ] **D1. Diagnostic code catalog.** Codes (`operation.path-body.duplicate`, `schema.nullable.legacy`, …) are stringly scattered and are consumed by product repos/CI.
      Fix: add `docs/diagnostics.md` (or a const registry object) so codes are greppable and testable.

- [ ] **D2. `x-signalflare-*` extension reference.** `x-signalflare-product`, `x-signalflare-sdk`, `x-signalflare-api-id`, `x-signalflare-implemented`, `x-signalflare-generated-profile(s)` are the public authoring contract but only documented implicitly by validation.
      Fix: add a README table (field, location, required, semantics).

- [ ] **D3. Link temporary upstream workarounds to a removal checklist.** `normalizeContractForOagen` (`src/contract/normalize.ts`) and `stripAutomaticPagination` are marked temporary.
      Fix: reference the upstream oagen issue / `UPSTREAM.md` entry so the next version bump includes deleting them.

---

## E. Effect v4 / OpenAPI review

- [x] **E1. Reuse Effect JSON Pointer primitives.** Effect v4 exports RFC 6901 `JsonPointer.escapeToken` and `unescapeToken`, but not full document traversal or `$ref` resolution. Use those primitives inside the local resolver; do not replace Redocly bundling.

- [ ] **E2. Decode compiler-owned structures with Effect Schema.** Define schemas for SDK config, diagnostics/reports, Signalflare manifests, and auth plans. Use `Schema.decodeUnknownEffect` at module/file boundaries and `Schema.fromJsonString` for JSON text. Keep cross-reference and product-policy checks as semantic validators after structural decoding. The Oagen manifest reader now uses `Schema.fromJsonString(Schema.JsonObject)` as the first small adoption.

- [ ] **E3. Add an Effect JSON Schema compatibility preflight.** Effect v4 provides `JsonSchema.fromSchemaOpenApi3_1` and `SchemaRepresentation.fromJsonSchemaDocument`. A local spike imported every component in Canary (12/12), Geocode (9/9), and Atlas (107/107). Add an optional pre-Oagen pass that reports unsupported JSON Schema constructs with component pointers instead of relying on Oagen warnings. Do not rewrite the canonical document until round-trip fidelity and naming are proven.

- [ ] **E4. Use Effect reference allocation in Effect-owned product APIs.** `SchemaRepresentation` accepts a deterministic `referencePolicy`, and `unstable/httpapi/OpenApi.fromApi` deduplicates schemas and emits components, errors, security, and docs. This is especially promising for Atlas, whose canonical schemas already originate in Effect. Give reusable nested schemas identifiers or a reference policy so Oagen receives named freshness/lineage/run/result components instead of unresolved inline models.

- [ ] **E5. Provide a Signalflare HttpApi annotation adapter.** Effect OpenAPI supports `Identifier`, `Servers`, `Override`, and `Transform`. A small product-side helper could inject `x-signalflare-product`, operation SDK metadata, operation IDs, global bearer security, and the 3.1.2 version override at the source. Keep this helper outside the language emitters.

- [-] **E6. Replace Redocly with Effect OpenAPI.** Rejected: Effect's `OpenApi.fromApi` generates documents from Effect `HttpApi`; it does not parse/bundle arbitrary product OpenAPI files. `JsonSchema` handles Schema Objects, not full paths, operations, security, or external-document bundling. Redocly remains the ingestion/bundling layer.

- [ ] **E7. Treat unstable APIs as pinned adapters.** `effect/unstable/httpapi` and the project are on exact `4.0.0-rc.112`. Isolate HttpApi/OpenAPI integration behind a small adapter and add snapshot tests before using it in product contract generation. `JsonPointer`, `JsonSchema`, `Schema`, and `SchemaRepresentation` are stable core exports.

## Suggested batching

1. **Mechanical, low-risk:** A1, A4, B1, B2, B4, B5, E2
2. **Safety:** A2, A3, E3
3. **Refactor:** B3, C1, C2
4. **Product-side Effect integration:** E4, E5, E7
5. **Docs:** C3, D1, D2, D3
