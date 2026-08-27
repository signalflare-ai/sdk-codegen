# Signalflare SDK Codegen

Shared OpenAPI SDK compiler for Signalflare products.

## Contract

- Each product owns one canonical OpenAPI document.
- Product repositories own their SDK manifest, generated clients, tests, and releases.
- This repository owns shared validation, compatibility policy, SDK profiles, and language emitters.
- Public, runner, admin, and preview surfaces are derived from the canonical product contract rather than authored as separate contracts.

## Planned targets

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
- `signalflare-sdk validate` and `signalflare-sdk generate`;
- Oagen generation, ownership manifests, provenance, and safe pruning;
- a generated TypeScript Promise/fetch client with structured errors;
- operation-aware bearer/API-key auth with async credential providers;
- operationId-preserving method names and exact-optional TypeScript output;
- generated-client typecheck and wire/auth tests against the canary contract.

Python, Go, and Rust spec-derived cores can be emitted but still require their
product-owned transport/error runtimes. TypeScript Effect generation remains the
next client-surface milestone. See [`docs/architecture.md`](docs/architecture.md),
[`docs/sdk-codegen-spec.md`](docs/sdk-codegen-spec.md),
[`docs/diagnostics.md`](docs/diagnostics.md),
[`docs/real-contract-pilots.md`](docs/real-contract-pilots.md),
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
```
