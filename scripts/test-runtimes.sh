#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

TOOLS="$ROOT/.tmp/runtime-tools"
OUTPUT="$ROOT/.tmp/runtime-conformance"
PYTHON_OUT="$OUTPUT/python"
GO_OUT="$OUTPUT/go"
RUST_OUT="$OUTPUT/rust"

rm -rf "$TOOLS" "$OUTPUT"
mkdir -p "$OUTPUT"
uv venv "$TOOLS" --python 3.12 >/dev/null
uv pip install --python "$TOOLS/bin/python" 'ruff==0.16.6' >/dev/null
PATH="$TOOLS/bin:$PATH" bun src/cli/index.ts generate \
  --config test/fixtures/runtime-conformance.sdk.config.ts \
  --json >"$OUTPUT/generation-report.json"

cp test/native/python_context_manager_test.py "$PYTHON_OUT/tests/test_context_manager.py"
cp test/native/go_runtime_test.go "$GO_OUT/signalflare_runtime_test.go"
cp test/native/rust_runtime_test.rs "$RUST_OUT/tests/signalflare_runtime_test.rs"
gofmt -w "$GO_OUT/signalflare_runtime_test.go"
rustfmt --edition 2024 "$RUST_OUT/tests/signalflare_runtime_test.rs"

"$TOOLS/bin/ruff" check "$PYTHON_OUT/src" "$PYTHON_OUT/tests"
"$TOOLS/bin/ruff" format --check "$PYTHON_OUT/src" "$PYTHON_OUT/tests"
# Check consumers, not just declarations: context-manager return types must
# retain generated resources and application subclasses on Python 3.10+.
for python_version in 3.10 3.12; do
  uv run --python "$python_version" --project "$PYTHON_OUT" --extra test --group dev pyright \
    --pythonversion "$python_version" --project "$PYTHON_OUT/pyproject.toml" \
    "$PYTHON_OUT/src" "$PYTHON_OUT/tests/test_context_manager.py"
  uv run --python "$python_version" --project "$PYTHON_OUT" --extra test --group dev pytest -q \
    "$PYTHON_OUT/tests/test_context_manager.py"
done
uv run --project "$PYTHON_OUT" --extra test --group dev pytest -q \
  "$PYTHON_OUT/tests" "$ROOT/test/native/python_runtime_test.py"
uv build --project "$PYTHON_OUT" --wheel --out-dir "$PYTHON_OUT/dist"
uv venv "$OUTPUT/python-install" --python 3.12 >/dev/null
uv pip install --python "$OUTPUT/python-install/bin/python" "$PYTHON_OUT"/dist/*.whl >/dev/null
"$OUTPUT/python-install/bin/python" -c \
  'from runtime_conformance import AsyncRuntimeConformanceClient, RuntimeConformanceClient; assert RuntimeConformanceClient and AsyncRuntimeConformanceClient'
uv run --project "$PYTHON_OUT" --extra test python -c \
  'from runtime_conformance import RuntimeConformanceClient; help(RuntimeConformanceClient)'

(
  cd "$GO_OUT"
  go mod tidy
  test -z "$(gofmt -l .)"
  go vet ./...
  go test -race ./...
  go doc . >/dev/null
  go list ./... >/dev/null
)

(
  cd "$RUST_OUT"
  cargo fmt --all -- --check
  cargo check --all-targets
  cargo clippy --all-targets -- -D warnings
  cargo test
  RUSTDOCFLAGS='-D warnings -D rustdoc::broken-intra-doc-links' cargo doc --no-deps
  cargo package --allow-dirty
)
