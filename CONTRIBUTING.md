# Contributing

This repository uses Bun for dependency management and TypeScript tooling.

## Setup

```bash
bun install --frozen-lockfile
bun run check
bun run build
```

## Development rules

- Keep product endpoint definitions and generated product SDKs in their product repositories.
- Add a contract fixture before accepting a new OpenAPI shape.
- Keep generation deterministic; generated source must not contain timestamps.
- Prefer upstream Oagen extension points over copied emitter code.
- Never overwrite a hand-owned SDK file without an explicit ownership rule.
- Include compile and wire-level tests for emitter behavior changes.

Use conventional commit messages and include the generated diff when a change affects output.
