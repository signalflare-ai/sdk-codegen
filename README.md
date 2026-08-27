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
[`docs/real-contract-pilots.md`](docs/real-contract-pilots.md),
[`PROPOSALS.md`](PROPOSALS.md), and [`UPSTREAM.md`](UPSTREAM.md).

## Development

```bash
bun install --frozen-lockfile
bun run check
bun run build
```

Validate or generate a product SDK:

```bash
bun run src/cli/index.ts validate --config sdk.config.ts
bun run src/cli/index.ts generate --config sdk.config.ts
bun run src/cli/index.ts generate --config sdk.config.ts --target typescript --dry-run --json
```
