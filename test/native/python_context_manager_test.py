from __future__ import annotations

import sys

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
