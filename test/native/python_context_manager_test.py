from __future__ import annotations

import inspect
import json
import subprocess
import sys
from pathlib import Path

import httpx
import pytest

from runtime_conformance import (
    AsyncRuntimeConformanceClient,
    RuntimeConformanceClient,
)
from runtime_conformance.system.models.health_result import HealthResult

if sys.version_info >= (3, 11):
    from typing import assert_type
else:
    from typing_extensions import assert_type


class ApplicationClient(RuntimeConformanceClient):
    def application_method(self) -> str:
        return "sync"


class AsyncApplicationClient(AsyncRuntimeConformanceClient):
    def application_method(self) -> str:
        return "async"


def test_constructor_signature_and_documentation() -> None:
    expected = {
        "token",
        "api_key",
        "credentials",
        "client_id",
        "base_url",
        "request_timeout",
        "max_retries",
        "headers",
        "http_client",
    }
    for client_class in (RuntimeConformanceClient, AsyncRuntimeConformanceClient):
        signature = inspect.signature(client_class)
        assert set(signature.parameters) == expected
        assert all(
            p.kind == inspect.Parameter.KEYWORD_ONLY
            for p in signature.parameters.values()
        )
        docs = inspect.getdoc(client_class.__init__) or ""
        assert "HTTP timeout in seconds" in docs
        assert "NOT a fallback for bearer schemes" in docs
        assert "never closed by this SDK" in docs
        assert "BearerAuth" in docs


def test_constructor_rejects_invalid_arguments_in_pyright(tmp_path: Path) -> None:
    invalid = tmp_path / "invalid_client.py"
    invalid.write_text(
        "from runtime_conformance import RuntimeConformanceClient, AsyncRuntimeConformanceClient\n"
        "RuntimeConformanceClient(tokne='typo')\n"
        "AsyncRuntimeConformanceClient(tokne='typo')\n"
        "RuntimeConformanceClient(request_timeout='slow')\n"
        "AsyncRuntimeConformanceClient(max_retries='many')\n"
    )
    project = Path(__file__).resolve().parents[1] / "pyproject.toml"
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "pyright",
            "--project",
            str(project),
            "--pythonpath",
            sys.executable,
            "--outputjson",
            str(invalid),
        ],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    report = json.loads(result.stdout)
    assert result.returncode == 1, result.stdout + result.stderr
    errors = [d for d in report["generalDiagnostics"] if d["severity"] == "error"]
    assert len(errors) == 4, errors
    assert {d["range"]["start"]["line"] for d in errors} == {1, 2, 3, 4}
    assert sum('No parameter named "tokne"' in d["message"] for d in errors) == 2


def health_response(request: httpx.Request) -> httpx.Response:
    assert request.url.path == "/health"
    return httpx.Response(200, json={"status": "ok"})


def test_sync_context_preserves_generated_client() -> None:
    with httpx.Client(transport=httpx.MockTransport(health_response)) as http:
        original = RuntimeConformanceClient(http_client=http)
        with original as client:
            assert_type(client, RuntimeConformanceClient)
            assert client is original
            result = client.system.get_health()
            assert_type(result, HealthResult)
            assert result.status == "ok"


def test_sync_context_preserves_application_subclass() -> None:
    with httpx.Client(transport=httpx.MockTransport(health_response)) as http:
        original = ApplicationClient(http_client=http)
        with original as client:
            assert_type(client, ApplicationClient)
            assert client is original
            assert client.application_method() == "sync"
            result = client.system.get_health()
            assert_type(result, HealthResult)
            assert result.status == "ok"


@pytest.mark.asyncio
async def test_async_context_preserves_generated_client() -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(health_response)
    ) as http:
        original = AsyncRuntimeConformanceClient(http_client=http)
        async with original as client:
            assert_type(client, AsyncRuntimeConformanceClient)
            assert client is original
            result = await client.system.get_health()
            assert_type(result, HealthResult)
            assert result.status == "ok"


@pytest.mark.asyncio
async def test_async_context_preserves_application_subclass() -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(health_response)
    ) as http:
        original = AsyncApplicationClient(http_client=http)
        async with original as client:
            assert_type(client, AsyncApplicationClient)
            assert client is original
            assert client.application_method() == "async"
            result = await client.system.get_health()
            assert_type(result, HealthResult)
            assert result.status == "ok"
