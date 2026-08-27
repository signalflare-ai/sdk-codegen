# Real-contract pilot findings

The onboarding overlays and generated SDK trees are non-invasive and live under `.tmp/`. One source-level follow-up has since landed in Atlas (`etl` commit `4ba83b0`): reusable Effect schemas now become named OpenAPI components. Geocode and Navigator remain overlay-only pilots.

## Geocode

Source: `../geocode/app/public/openapi.json`

The temporary onboarding overlay:

- upgrades the declared baseline from OpenAPI 3.1.0 to 3.1.2;
- adds `x-signalflare-product`, operation identity, and SDK profile metadata;
- initially selects the five JSON operations whose success responses have documented schemas;
- leaves batch, CSV batch, health, index stats, and taxonomy out of generation until their response contracts are complete/supported.

### TypeScript result

- 5 operations and 33 generated files;
- strict compilation passes with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`;
- mocked wire calls verify bearer auth, query names, structured request serialization, and response deserialization;
- excluded operations and their now-unreachable component schemas do not appear in the output.

The OpenAPI descriptions become JSDoc on resources, methods, parameters, and models. This is IDE/API documentation, not yet a standalone Markdown or HTML documentation site.

Example generated surface:

```ts
const client = new GeocodeClient({
  token: async () => getAccessToken(),
});

await client.geocode.search({
  text: "1600 Pennsylvania Ave",
  limit: 5,
  focusLat: 38.9,
  focusLon: -77.04,
});
```

Verified wire output includes `focus_lat`, `focus_lon`, and `Authorization: Bearer …`. Structured search correctly separates query fields from its JSON body.

### Contract findings

- `/v1/gc/batch` and `/v1/gc/taxonomy` describe successful responses but provide no response content/schema, so a generated client can only return `void`.
- `/v1/gc/batch/csv` uses `text/csv`, which the initial JSON transport deliberately does not support.
- health and index-stat operations do not document expected error responses.
- `Feature.properties` is intentionally emitted as `any` because the source schema is open-ended.
- schema constraints become documentation and static types; generated clients do not perform runtime input validation.

### Other languages

The same five-operation profile emits spec-derived cores:

| Target | Files | Current result                                                                                                                               |
| ------ | ----: | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Python |    18 | Syntax compiles, but imports a missing WorkOS-derived hand-owned runtime and emits redundant forms such as `Optional[Optional[str]]`.        |
| Go     |     9 | Models/tests emit, but the resource implementation and runtime are absent; generated code still contains WorkOS-specific client assumptions. |
| Rust   |    18 | Generated source formats successfully, but expects missing `client`, `error`, crate-root, and package scaffolding.                           |

The compiler reports these targets as incomplete. They should not be published until Signalflare-owned runtimes replace the WorkOS assumptions.

## Atlas

Source: `../etl/packages/types/generated/atlas.openapi.json`

Atlas is the best strategic follow-up because it has an existing hand-written Promise/Effect client for parity comparison. Atlas currently pins an older Effect beta than sdk-codegen, so it uses its local `Schema.toJsonSchemaDocument` path rather than the shared current-Effect HttpApi adapter. A temporary overlay made the top-level contract policy-valid by:

- upgrading to 3.1.2 and adding a server;
- assigning access, pipeline, runner, admin, and preview metadata;
- excluding 23 explicitly unimplemented operations;
- promoting inline success envelopes to named schemas;
- removing 11 path identifiers duplicated in request bodies.

That selects 30 implemented operations. Atlas now annotates reusable Effect schemas with stable identifiers and promotes Effect `$defs` into OpenAPI components at generation time. This removed the original nine unresolved freshness, lineage, claimed-run, query-result, and commit-report references. The overlaid TypeScript pilot now emits 300 files with no generation warnings and passes strict TypeScript compilation.

Remaining API-quality findings:

- `Atlas…` component names are singularized by Oagen to `Atla…`;
- dotted operation IDs produce redundant methods such as `client.catalog.catalogGet()`;
- the temporary onboarding overlay still owns Signalflare metadata, named success envelopes, and path/body deduplication.

Atlas is no longer blocked on nested model IR, but should simplify component/operation naming and move the remaining overlay policy into its canonical generator before publication.

## Navigator

Source: `../navigator/apps/api/openapi/openapi.json`

A metadata-only onboarding overlay over all 419 operations currently reports 884 policy errors:

| Diagnostic                        | Count |
| --------------------------------- | ----: |
| Missing documented error response |   302 |
| Inline production response schema |   385 |
| Inline production request schema  |   154 |
| Legacy `nullable` keyword         |    26 |
| Inline error schema               |     9 |
| Missing explicit 2xx response     |     7 |
| GET request body                  |     1 |

Navigator is too broad for the first pilot. Start with a small tagged/profiled subset only after the canonical generator can attach metadata and named schemas at the source.

## Compiler improvements discovered by these pilots

The real-contract runs resulted in three safeguards:

1. Profile compilation now prunes unreachable component schemas, preventing preview-only models from leaking into production SDKs.
2. Automatic pagination inferred from ordinary `limit`/`offset` parameters is disabled for every target; it had incorrectly converted Geocode places into a page iterator.
3. Oagen IR is validated for unresolved model/enum references before emission, and generated TypeScript local imports are checked before a run is accepted.
