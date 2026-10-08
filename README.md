# Signalflare SDK Codegen

Shared OpenAPI SDK compiler for Signalflare products.

## Contract

- Each product owns one canonical OpenAPI document.
- Product repositories own their SDK manifest, generated clients, tests, and releases.
- This repository owns shared validation, compatibility policy, SDK profiles, and language emitters.
- Public, runner, admin, and preview surfaces are derived from the canonical product contract rather than authored as separate contracts.

## Supported targets

- TypeScript Promise client
- TypeScript Effect client
- Python sync and async clients
- Go client
- Rust client

## Planned consumers

- Atlas
- Navigator
- Forge

## Current implementation

The compiler now provides:

- typed `sdk.config.ts` manifests;
- OpenAPI loading, reference bundling, and contract validation;
- deterministic multi-profile selection with preview exclusion;
- Effect v4-native config, contract, validation, generation, filesystem, and CLI workflows;
- schema-backed typed failures and a Bun Effect runtime/layer boundary;
- a pinned Effect HttpApi adapter for compiler-ready product OpenAPI generation;
- `signalflare-sdk validate`, `generate`, `check`, and `compat`;
- Oagen generation, ownership manifests, provenance, and safe pruning;
- a generated TypeScript Promise/fetch client with structured errors;
- operation-aware bearer/API-key auth with async credential providers;
- operationId-preserving method names and exact-optional TypeScript output;
- generated-client typecheck and wire/auth tests against the canary contract.
- native Effect v4 requests, credential Effects, service layers, typed errors, interruption, and timeouts;
- deterministic release snapshots with wire and per-language public-surface compatibility checks;
- product/target-owned SDK versions, independent of the compiler version.

Python sync/async, Go, and Rust now emit standalone runtimes and package
bootstraps with shared auth/wire/error/nullability conformance gates. TypeScript
Promise and Effect entrypoints share models/serializers without making Promise
consumers import Effect. See
[`docs/architecture.md`](docs/architecture.md),
[`docs/sdk-codegen-spec.md`](docs/sdk-codegen-spec.md),
[`docs/diagnostics.md`](docs/diagnostics.md),
[`docs/language-runtimes.md`](docs/language-runtimes.md),
[`docs/real-contract-pilots.md`](docs/real-contract-pilots.md),
[`docs/release-gates.md`](docs/release-gates.md),
[`PROPOSALS.md`](PROPOSALS.md), and [`UPSTREAM.md`](UPSTREAM.md).

## Signalflare OpenAPI extensions

| Field                              | Location              | Required    | Semantics                                                                                                                                                                                         |
| ---------------------------------- | --------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `x-signalflare-product`            | Document root         | Yes         | `{ id, displayName, contractVersion }`; identifies the product and positive integer contract revision.                                                                                            |
| `x-signalflare-sdk`                | Operation             | Yes         | Declares non-empty `audiences`, `visibility` (`public`, `partner`, `internal`), `stability` (`stable`, `beta`, `experimental`), optional `service`, and optional `generate` (defaults to `true`). |
| `x-signalflare-api-id`             | Operation             | Yes         | Stable source API identity used in selected-operation metadata.                                                                                                                                   |
| `x-signalflare-implemented`        | Operation             | No          | Defaults to `true`; `false` operations may only use the `preview` audience and remain out of production profiles.                                                                                 |
| `x-signalflare-generated-profile`  | Derived document root | Output only | Names the single profile used by `buildProfileContract`. Do not author it in the canonical contract.                                                                                              |
| `x-signalflare-generated-profiles` | Derived document root | Output only | Lists profiles combined by `buildProfilesContract`. Do not author it in the canonical contract.                                                                                                   |

## Development

```bash
bun install --frozen-lockfile
bun run check
bun run build
```

A profile name intentionally uses the same namespace as an operation audience.
`profiles.<name>.includeAudiences` defines which audiences that profile contains;
each target's `profiles` array then selects the named profiles to combine into
that generated SDK.

Validate or generate a product SDK:

```bash
bun run src/cli/index.ts validate --config sdk.config.ts
bun run src/cli/index.ts generate --config sdk.config.ts
bun run src/cli/index.ts generate --config sdk.config.ts --target typescript --dry-run --json
bun run src/cli/index.ts check --config sdk.config.ts --json
bun run src/cli/index.ts compat --config sdk.config.ts --baseline ./released-sdks --json
```

Enable the Effect entrypoint with `targets.typescript.effect: true`. Set
`product.sdkVersion` (or a target's `sdkVersion`) before releasing. Package
manifests are bootstraps: existing product-owned files are preserved and must
be updated by the product's release process.

`bun run test:runtimes` checks native runtime conformance; `bun run test:atlas`
checks the representative permanent Atlas fixture across Python, Go, and Rust,
including release gates and package creation. Bun tests cover strict TypeScript
Promise/Effect compilation and Atlas envelope/auth/wire behavior. The fixture
is not Atlas's complete canonical contract or a product release integration.
