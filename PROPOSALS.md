# Cleanup Proposals — sdk-codegen

Log of code-pattern review findings. Each item is independently actionable;
check items off as they land. File references use `path:line` where useful.

Status key: `[ ]` open · `[x]` done · `[-]` rejected (note why)

---

## A. Bugs / fragile spots

- [x] **A1. Hardcoded version strings scattered.**
  - `COMPILER_VERSION = "0.0.0"` in `src/generator/generate.ts`
  - `0.0.0` hardcoded again inside the generated user-agent template in `src/emitters/typescript/runtime.ts`
  - `"3.1.2"` duplicated in `src/config/schema.ts`, `src/contract/validate.ts`, `src/generator/generate.ts` (manifest)
  - Landed: compiler/generated-SDK/upstream-emitter versions live in `src/version.ts`; `OPENAPI_BASELINE` lives in `src/config/schema.ts`. A provenance test enforces that `COMPILER_VERSION` and the emitter version match package metadata.

- [x] **A2. `exposeSignalflareClient` string-replaces upstream output with no assertion.**
      `src/emitters/typescript/index.ts` — if `nodeEmitter` renames `export { WorkOS }` or the options-interface path, `.replace()` silently no-ops and generated clients export `WorkOS`.
      Landed: each rewrite now requires exactly one upstream match and throws an error naming the pinned emitter version; a missing `src/index.ts` also fails generation.

- [x] **A3. `console.log` monkey-patch in `runOagenGenerate`** (`src/generator/generate.ts`) mutates global state.
      Landed: all Oagen emitter runs now share an Effect `Semaphore`, so quiet and visible invocations cannot overlap while the pinned upstream emitter still logs directly to the global console. Remove the guard if upstream adds a logger abstraction.

- [x] **A4. Unused parameter:** removed `context` from `effectiveParameters(operation)`.

---

## B. Duplication worth collapsing

- [x] **B1. Two sources of truth for target names.** `TARGET_NAMES`, its Effect Schema, `TargetName`, and `TARGET_ID_FIELD` now live in `src/config/schema.ts` and are reused by validation, generation, and the CLI.

- [x] **B2. Triple error re-exports.** Errors now have one public export path from `src/core/errors.ts` through `src/index.ts`; leaf modules no longer re-export them.

- [x] **B3. JSON pointer logic reimplemented.** `pruneUnreferencedSchemas` in `src/contract/profiles.ts` hand-rolled pointer decode + resolution instead of reusing `getAtJsonPointer` (`src/shared/object.ts`). Also `collectSchemaProperties` and `validateLegacyNullable` (`src/contract/validate.ts`) are two ad-hoc tree walkers.
      Landed: pointer tokens use Effect v4 `JsonPointer.escapeToken` / `unescapeToken`, profile pruning reuses `getAtJsonPointer`, and `walkDocument` now owns cycle-safe pointer-aware traversal for reference collection and legacy-nullable inspection. `collectSchemaProperties` remains specialized because it deliberately resolves references and follows only composition keywords. Effect does not provide whole-document traversal or `$ref` resolution, so these focused helpers remain local.

- [x] **B4. Repeated predicates/guards.**
  - `isJsonMediaType`: `mediaType === "application/json" || mediaType.endsWith("+json")` appears 4x in `src/contract/validate.ts`.
  - `isRecord(components) && isRecord(components.securitySchemes)` duplicated in `src/contract/validate.ts` (`configuredSecuritySchemes`) and `src/contract/auth.ts`.
    Landed: `src/shared/http.ts` owns `isJsonMediaType`; `src/contract/accessors.ts` owns `securitySchemesOf(document)`.

- [x] **B5. Identical CLI error handlers.** Both tags now delegate to `printCommandFailure`.

---

## C. Simplification

- [x] **C1. Split contract validation by policy domain.** `src/contract/validate.ts` is now a small orchestrator over `validate/context.ts`, `top-level.ts`, `operation.ts`, `parameters.ts`, `request-body.ts`, `responses.ts`, `schema.ts`, and `security.ts`. Shared context owns diagnostic enrichment and reference resolution. The public validator documents why Signalflare metadata/profile/emitter policy and stable product-CI pointers remain compiler-owned after Redocly parsing instead of generic Spectral rules.

- [-] **C2. `makeExactOptionalCompatible` applied across emitter phases.** Rejected after checking Oagen's `generateAllFiles`: each emitter phase returns a disjoint file list and each generated TypeScript file is transformed once. Oagen exposes no pre-write final-file hook; applying a final pass after `generate()` would be too late because files are already integrated on disk. A future cleanup may wrap the phase methods for readability, but there is no repeated file processing to optimize.

- [x] **C3. Document the profile/audience namespace coupling.** `src/config/schema.ts` and the README now explain that profile names share the audience namespace, profiles combine `includeAudiences`, and targets select named profiles.

---

## D. Documentation gaps

- [x] **D1. Diagnostic code catalog.** `docs/diagnostics.md` catalogs the stable configuration, contract, operation, schema, profile, Oagen, and generation namespaces and documents dynamic `openapi.<rule-id>` findings.

- [x] **D2. `x-signalflare-*` extension reference.** The README now lists field, location, requirement, semantics, enum values, defaults, and output-only profile annotations.

- [x] **D3. Link temporary upstream workarounds to a removal checklist.** Both adapters link to `UPSTREAM.md#temporary-workaround-removal-checklist`, which specifies the regeneration and IR conditions for deleting them on an Oagen upgrade.

---

## E. Effect v4 / OpenAPI review

- [x] **E1. Reuse Effect JSON Pointer primitives.** Effect v4 exports RFC 6901 `JsonPointer.escapeToken` and `unescapeToken`, but not full document traversal or `$ref` resolution. Use those primitives inside the local resolver; do not replace Redocly bundling.

- [x] **E2. Decode compiler-owned structures with Effect Schema.** SDK config, diagnostics/reports, auth plans, and Signalflare manifests now have exported Effect Schemas. Dynamic config modules decode with `Schema.decodeUnknownEffect`; JSON manifests use `Schema.fromJsonString`; semantic cross-reference and product-policy diagnostics remain explicit. Error schemas now reuse the real `ValidationReport` schema rather than `Schema.declare` shape checks.

- [x] **E3. Add an Effect JSON Schema compatibility preflight.** `validateEffectJsonSchemaCompatibility` normalizes components once with `JsonSchema.fromSchemaOpenApi3_1`, imports each root with `SchemaRepresentation.fromJsonSchemaDocument`, and emits component-pointer warnings for unsupported semantics. It is advisory because Effect and Oagen support different subsets, and it never rewrites the canonical document.

- [x] **E4. Use Effect reference allocation in Effect-owned product APIs.** The shared adapter exports one immutable reference policy for current Effect HttpApi sources. Atlas, still on an older Effect beta, now annotates reusable freshness, lineage, run, query-result, commit-report, and supporting schemas with stable identifiers and promotes Effect `$defs` into OpenAPI components. Its original nine unresolved Oagen references are gone; the 30-operation TypeScript pilot now emits 300 files and strictly typechecks.

- [x] **E5. Provide a Signalflare HttpApi annotation adapter.** `src/effect-httpapi/openapi.ts` now provides root and operation annotation helpers for product metadata, SDK metadata, operation IDs, servers, 3.1.2, global AuthKit bearer auth, and explicit anonymous operations. It remains outside all language emitters.

- [-] **E6. Replace Redocly with Effect OpenAPI.** Rejected: Effect's `OpenApi.fromApi` generates documents from Effect `HttpApi`; it does not parse/bundle arbitrary product OpenAPI files. `JsonSchema` handles Schema Objects, not full paths, operations, security, or external-document bundling. Redocly remains the ingestion/bundling layer.

- [x] **E7. Treat unstable APIs as pinned adapters.** All `effect/unstable/httpapi` usage is isolated in `src/effect-httpapi/openapi.ts` and one adapter test. The test snapshots compiler-required metadata, AuthKit security, 3.1.2 output, named nested components, and a zero-diagnostic compiler validation pass against the exact Effect pin.

## Suggested batching

1. **Mechanical, low-risk:** A1, A4, B1, B2, B4, B5, E2
2. **Safety:** A2, A3, E3
3. **Refactor:** B3, C1, C2
4. **Product-side Effect integration:** E4, E5, E7
5. **Docs:** C3, D1, D2, D3
