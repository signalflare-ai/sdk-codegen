# SDK release gates

## Versions and ownership

`product.sdkVersion` is the default SDK semantic version. A target's
`sdkVersion` overrides it. Unset versions use `0.0.0`, not the compiler version.
The version is recorded in runtime identification headers and Signalflare
manifests, and used for first-time package bootstraps. Python packaging
normalizes supported prereleases (for example `0.2.0-beta.3` to `0.2.0b3`).
Products must choose Python-compatible release versions when publishing Python.

Existing package manifests are preserved byte-for-byte, including their
versions, exports and dependencies. Updating product package metadata,
building distributable entrypoints and publishing remain product responsibilities.
The TypeScript bootstrap is private and exports source entrypoints; it is not
a production publishing manifest.

TypeScript `effect: true` adds a separate `/effect` entrypoint. Its bootstrap
has an optional exact Effect v4 peer (default `4.0.0`); a product-owned manifest
must retain a matching export and peer. The generated runtime is tested against
the compiler's pinned Effect version, not every configured v4 release.

## Non-mutating drift gate

```bash
bun src/cli/index.ts check --config sdk.config.ts --json
```

Regenerates into a scoped temporary directory, then reports missing, changed,
and stale generator-owned files. Includes the compatibility and Signalflare
metadata files and requires an ownership manifest. Extra hand-owned files and
existing package bootstrap contents are not compared. No product files are
written or deleted. Exit codes: `0` clean, `1` drift/failure, `2` CLI usage error.

Run with the same formatter versions as generation. Python, Go and Rust use
Ruff, gofmt and rustfmt through Oagen. A formatter mismatch or missing tool can
produce drift; native CI requires formatting to succeed. Neither generation nor
check silently installs native tools.

## Released-baseline compatibility gate

Every generated target writes a deterministic `.signalflare-compat.json`
containing its selected bundled contract, package/version identity, public
symbols, exports and type aliases. Commit this file with each released SDK.

```bash
bun src/cli/index.ts compat --config sdk.config.ts --baseline ./released-sdks --json
```

The baseline is either one SDK output directory (select its target), or a
directory containing `typescript/`, `python/`, `go/`, `rust/` outputs. Relative
baseline paths are resolved from the invoking directory; output/spec paths are
relative to `sdk.config.ts`. The baseline must match product, target and profiles.
Older SDKs without a snapshot need an explicit reviewed baseline generated with
this compiler; a missing/malformed baseline fails closed.

Reports combine:

- Oagen's wire IR differ (models, enums, operations, parameter defaults);
- conservative HTTP route, source API identity and security-scheme checks;
- validation/default/const constraints that the IR discards;
- Oagen's language-policy SDK differ for TypeScript, Python, Go and Rust;
- export removals, package identity and public type-alias changes.

TypeScript Promise and Effect are independent surfaces. Removing `/effect` is
breaking. Any breaking finding exits `1`; additive/soft-risk findings remain
visible but do not fail. Auth and validation-constraint changes are deliberately
conservative: even relaxations require review. There is no automatic version
bump, approval bypass or publication.

This is a source-compatibility gate, not proof of behavioral or binary parity.
It inherits upstream extractor limitations; runtime behavior still requires
wire, type, native and product integration tests. For Effect errors, the staging
adapter extracts schema-owned declarations without inherited Effect methods
to avoid Oagen 0.29.2's prototype-key crash. The real SDK is unchanged and is
strictly compiled separately. Upstream snapshots omit alias RHS definitions,
so the envelope retains and conservatively compares them separately.
Rust extraction also normalizes lifetime-only impl receiver names in staging
so upstream joins resource methods to their public structs.

## Effect and OpenAPI

Effect v4's `HttpApiClient.make` consumes an Effect `HttpApi`, not arbitrary
OpenAPI JSON. Its OpenAPI generator is useful for Effect-owned API definitions
through this compiler's `effect-httpapi` adapter. Products with canonical
OpenAPI still use the shared Oagen pipeline for every language, including
native TypeScript Effect generation. No parallel model system is introduced.

## Permanent Atlas regression

`fixtures/contracts/atlas.openapi.json` represents three Atlas operations:
credential exchange, catalog metadata, and JSON queries with success/error
envelopes, freshness, lineage, camelCase wire fields and open row dictionaries.
It intentionally excludes binary Arrow transport and does not replace Atlas's
full canonical contract.

`bun test` verifies Promise/Effect parity and strict compilation. Run
`bun run test:atlas` for Python sync/async generated tests, strict Pyright/Ruff,
wheel build/isolated import, Go vet/race/docs, Rust check/Clippy/tests/rustdoc/
package, and clean cross-language drift/compat gates. Both run in CI.

Atlas still owns canonical metadata/transport policy, `sdk.config.ts`, package
exports and release wiring, full implemented-operation parity, and deciding
how to migrate consumers from its existing handwritten client.
