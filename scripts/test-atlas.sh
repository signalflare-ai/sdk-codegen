#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
TOOLS="$ROOT/.tmp/atlas-tools"
OUTPUT="$ROOT/.tmp/atlas-conformance"
rm -rf "$OUTPUT"
if [ ! -x "$TOOLS/bin/python" ]; then uv venv "$TOOLS" --python 3.12 >/dev/null; fi
uv pip install --python "$TOOLS/bin/python" 'ruff==0.16.6' >/dev/null
export PATH="$TOOLS/bin:$PATH"
mkdir -p "$OUTPUT"
bun src/cli/index.ts generate --config test/fixtures/atlas.sdk.config.ts --json >"$OUTPUT/generation-report.json"
bun src/cli/index.ts check --config test/fixtures/atlas.sdk.config.ts --json >"$OUTPUT/drift-report.json"
bun src/cli/index.ts compat --config test/fixtures/atlas.sdk.config.ts --baseline "$OUTPUT" --json >"$OUTPUT/compatibility-report.json"

PYTHON_OUT="$OUTPUT/python"
ruff check "$PYTHON_OUT/src" "$PYTHON_OUT/tests"
ruff format --check "$PYTHON_OUT/src" "$PYTHON_OUT/tests"
uv run --project "$PYTHON_OUT" --extra test --group dev pyright --project "$PYTHON_OUT/pyproject.toml"
uv run --project "$PYTHON_OUT" --extra test --group dev pytest -q "$PYTHON_OUT/tests"
uv build --project "$PYTHON_OUT" --wheel --out-dir "$PYTHON_OUT/dist"
if [ ! -x "$OUTPUT/python-install/bin/python" ]; then uv venv "$OUTPUT/python-install" --python 3.12 >/dev/null; fi
uv pip install --python "$OUTPUT/python-install/bin/python" "$PYTHON_OUT"/dist/*.whl >/dev/null
"$OUTPUT/python-install/bin/python" -c 'from atlas import AtlasClient, AsyncAtlasClient; assert AtlasClient and AsyncAtlasClient'

(
  cd "$OUTPUT/go"
  go mod tidy
  test -z "$(gofmt -l .)"
  go vet ./...
  go test -race ./...
  go doc . >/dev/null
)
(
  cd "$OUTPUT/rust"
  cargo fmt --all -- --check
  cargo check --all-targets
  cargo clippy --all-targets -- -D warnings
  cargo test
  RUSTDOCFLAGS='-D warnings -D rustdoc::broken-intra-doc-links' cargo doc --no-deps
  cargo package --allow-dirty
)
