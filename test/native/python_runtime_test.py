from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from runtime_conformance import (
    APIError,
    AsyncRuntimeConformanceClient,
    MissingCredentialError,
    ResponseDecodeError,
    RuntimeConformanceClient,
)


def response_for(request: httpx.Request) -> httpx.Response:
    if request.url.path.startswith("/widgets/"):
        return httpx.Response(
            200,
            json={
                "id": "00000000-0000-0000-0000-000000000000",
                "name": "Widget",
                "createdAt": "2026-01-01T00:00:00.000Z",
            },
        )
    if request.url.path == "/jobs":
        return httpx.Response(
            201,
            json={"id": "00000000-0000-0000-0000-000000000000", "state": "queued"},
        )
    if request.url.path == "/health":
        return httpx.Response(200, json={"status": "ok"})
    return httpx.Response(200, json={"accepted": True})


def make_client(**credentials: Any) -> tuple[RuntimeConformanceClient, list[httpx.Request]]:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return response_for(request)

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    client = RuntimeConformanceClient(
        http_client=http_client,
        base_url="https://runtime.test",
        **credentials,
    )
    return client, requests


def test_shared_auth_and_wire_vectors() -> None:
    client, requests = make_client(token="authkit-token")
    client.widgets.get_widget(
        "widget/123",
        include_history=True,
        request_options={"extra_headers": {"X-Trace-Mode": "verbose"}},
    )
    request = requests[-1]
    assert request.url.path == "/widgets/widget/123"
    assert request.url.raw_path.startswith(b"/widgets/widget%2F123")
    assert request.url.params.get_list("include_history") == ["true"]
    assert request.headers["authorization"] == "Bearer authkit-token"
    assert request.headers["x-trace-mode"] == "verbose"

    client, requests = make_client(api_key="header-secret")
    client.jobs.create_job(required_value="required", required_nullable=None)
    request = requests[-1]
    assert request.headers["x-api-key"] == "header-secret"
    assert request.headers["content-type"] == "application/json"
    assert json.loads(request.content) == {
        "requiredValue": "required",
        "requiredNullable": None,
    }

    client.jobs.create_job(
        required_value="required",
        required_nullable="present",
        optional_value="present",
        optional_nullable=None,
        tags=["one", "two"],
    )
    assert json.loads(requests[-1].content) == {
        "requiredValue": "required",
        "optionalValue": "present",
        "requiredNullable": "present",
        "optionalNullable": None,
        "tags": ["one", "two"],
    }

    client, requests = make_client(api_key="query-secret")
    client.authentication.verify_query_key()
    assert requests[-1].url.params.get_list("api_key") == ["query-secret"]
    assert "authorization" not in requests[-1].headers

    client, requests = make_client(api_key="cookie secret")
    client.authentication.verify_cookie_key()
    assert requests[-1].headers["cookie"] == "session_key=cookie%20secret"

    client, requests = make_client(token="authkit-token", api_key="header-secret")
    client.authentication.verify_combined_credentials()
    assert requests[-1].headers["authorization"] == "Bearer authkit-token"
    assert requests[-1].headers["x-api-key"] == "header-secret"

    client, requests = make_client(token="authkit-token", api_key="unused")
    client.authentication.verify_alternative_credentials()
    assert requests[-1].headers["authorization"] == "Bearer authkit-token"
    assert "x-api-key" not in requests[-1].headers

    client, requests = make_client(api_key="fallback-header-secret")
    client.authentication.verify_alternative_credentials()
    assert requests[-1].headers["x-api-key"] == "fallback-header-secret"
    assert "authorization" not in requests[-1].headers

    client, requests = make_client(token="must-not-leak", api_key="must-not-leak")
    client.system.get_health()
    assert "authorization" not in requests[-1].headers
    assert "x-api-key" not in requests[-1].headers
    assert "cookie" not in requests[-1].headers


def test_managed_auth_wins_and_provider_receives_template() -> None:
    contexts = []

    def provider(context):
        contexts.append(context)
        return "fresh-token"

    client, requests = make_client(token=provider)
    client.widgets.get_widget(
        "widget",
        request_options={"extra_headers": {"Authorization": "Bearer stale"}},
    )
    assert requests[-1].headers["authorization"] == "Bearer fresh-token"
    assert contexts[0].operation_id == "getWidget"
    assert contexts[0].path == "/widgets/{widget_id}"
    assert contexts[0].scheme == "BearerAuth"


@pytest.mark.asyncio
async def test_async_credential_provider() -> None:
    requests: list[httpx.Request] = []
    contexts = []

    async def provider(context):
        contexts.append(context)
        return "async-token"

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return response_for(request)

    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client = AsyncRuntimeConformanceClient(
        token=provider,
        base_url="https://runtime.test",
        http_client=http_client,
    )
    await client.widgets.get_widget("widget")
    assert requests[-1].headers["authorization"] == "Bearer async-token"
    assert contexts[0].operation_id == "getWidget"
    await http_client.aclose()


def test_errors_decode_empty_and_missing_credentials() -> None:
    requests: list[httpx.Request] = []

    def not_found(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            404,
            headers={"x-request-id": "request_123"},
            json={
                "code": "widget_not_found",
                "message": "Widget not found",
                "details": {"widgetId": "widget_123"},
            },
        )

    client = RuntimeConformanceClient(
        token="token",
        base_url="https://runtime.test",
        http_client=httpx.Client(transport=httpx.MockTransport(not_found)),
    )
    with pytest.raises(APIError) as raised:
        client.widgets.get_widget("widget")
    assert raised.value.status_code == 404
    assert raised.value.code == "widget_not_found"
    assert raised.value.request_id == "request_123"
    assert raised.value.details == {"widgetId": "widget_123"}

    malformed = RuntimeConformanceClient(
        token="token",
        base_url="https://runtime.test",
        http_client=httpx.Client(
            transport=httpx.MockTransport(lambda request: httpx.Response(200, text="{not-json"))
        ),
    )
    with pytest.raises(ResponseDecodeError) as decode:
        malformed.widgets.get_widget("widget")
    assert decode.value.status_code == 200

    empty = RuntimeConformanceClient(
        base_url="https://runtime.test",
        http_client=httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(204))),
    )
    assert empty.system.get_health() is None

    called = False

    def must_not_call(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(500)

    missing = RuntimeConformanceClient(
        base_url="https://runtime.test",
        http_client=httpx.Client(transport=httpx.MockTransport(must_not_call)),
    )
    with pytest.raises(MissingCredentialError):
        missing.widgets.get_widget("widget")
    assert called is False


def test_error_body_is_bounded() -> None:
    client = RuntimeConformanceClient(
        token="token",
        base_url="https://runtime.test",
        http_client=httpx.Client(
            transport=httpx.MockTransport(lambda request: httpx.Response(500, text="x" * 70000))
        ),
    )
    with pytest.raises(APIError) as raised:
        client.widgets.get_widget("widget")
    assert len(raised.value.raw_body) == 64 * 1024
