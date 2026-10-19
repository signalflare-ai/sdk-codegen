import type { GeneratedFile } from "@workos/oagen";
import { thirdPartyNotices, type NativeRuntimeOptions } from "../runtime-options.js";

function renderErrors(): string {
  return `from __future__ import annotations

from typing import Any, Mapping


class SignalflareError(Exception):
    """Base exception for this SDK."""


class APIError(SignalflareError):
    """A structured non-successful API response."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int,
        code: str | None = None,
        request_id: str | None = None,
        details: Any = None,
        raw_body: str = "",
        response_json: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.request_id = request_id
        self.details = details
        self.raw_body = raw_body
        self.response_json = response_json

    def __str__(self) -> str:
        suffix = f" (request_id={self.request_id})" if self.request_id else ""
        return f"API error {self.status_code}: {self.message}{suffix}"


class BadRequestError(APIError):
    """HTTP 400 error."""


class AuthenticationError(APIError):
    """HTTP 401 error."""


class AuthorizationError(APIError):
    """HTTP 403 error."""


class NotFoundError(APIError):
    """HTTP 404 error."""


class ConflictError(APIError):
    """HTTP 409 error."""


class UnprocessableEntityError(APIError):
    """HTTP 422 error."""


class RateLimitExceededError(APIError):
    """HTTP 429 error."""

    def __init__(self, *args: Any, retry_after: float | None = None, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.retry_after = retry_after


class ServerError(APIError):
    """HTTP 5xx error."""


class MissingCredentialError(SignalflareError):
    """No configured credentials satisfy an operation's security requirements."""

    def __init__(self, operation_id: str | None, alternatives: list[list[str]]) -> None:
        self.operation_id = operation_id
        self.alternatives = alternatives
        operation = operation_id or "API request"
        super().__init__(f"Missing credentials for {operation}.")


class ConnectionError(SignalflareError):
    """The SDK could not connect to the API."""


class TimeoutError(SignalflareError):
    """The API request timed out."""


class ResponseDecodeError(SignalflareError):
    """A successful response could not be decoded."""

    def __init__(self, status_code: int, raw_body: str) -> None:
        self.status_code = status_code
        self.raw_body = raw_body
        super().__init__(f"Unable to decode successful response with status {status_code}.")
`;
}

function renderTypes(): string {
  return `from __future__ import annotations

import sys
from datetime import datetime
from enum import Enum
from typing import Any, Dict, Literal, NoReturn, Protocol, TypedDict, TypeVar

if sys.version_info >= (3, 11):
    from typing import Self
else:
    from typing_extensions import Self


class RequestOptions(TypedDict, total=False):
    """Per-request transport overrides."""

    extra_headers: Dict[str, str]
    timeout: float
    idempotency_key: str
    max_retries: int
    base_url: str


class Deserializable(Protocol):
    """A generated model that supports dictionary deserialization."""

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> Self: ...


D = TypeVar("D", bound=Deserializable)


class NotGiven:
    """Sentinel distinguishing omission from an explicit JSON null."""

    def __bool__(self) -> Literal[False]:
        return False

    def __repr__(self) -> str:
        return "NOT_GIVEN"


NOT_GIVEN = NotGiven()


def enum_value(value: Any) -> Any:
    """Return an enum's wire value while accepting primitive values."""
    return value.value if isinstance(value, Enum) else value


def _parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _format_datetime(value: datetime) -> str:
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _raise_deserialize_error(cls_name: str, error: Exception) -> NoReturn:
    from ._errors import ResponseDecodeError

    raise ResponseDecodeError(200, f"Unexpected response while parsing {cls_name}: {error}") from error
`;
}

function renderAuth(options: NativeRuntimeOptions): string {
  return `from __future__ import annotations

import inspect
import json
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Mapping
from urllib.parse import quote

from ._errors import MissingCredentialError


@dataclass(frozen=True, slots=True)
class CredentialContext:
    """Context supplied to a per-request credential provider."""

    method: str
    path: str
    operation_id: str | None
    scheme: str


CredentialProvider = Callable[[CredentialContext], str | None | Awaitable[str | None]]
Credential = str | CredentialProvider


@dataclass(frozen=True, slots=True)
class ResolvedAuth:
    headers: dict[str, str]
    query: list[tuple[str, str]]


_AUTH_PLAN: dict[str, Any] = json.loads(${JSON.stringify(JSON.stringify(options.authPlan))})


def _path_matches(template: str, actual: str) -> bool:
    expected = [part for part in template.split("/") if part]
    received = [part for part in actual.split("/") if part]
    return len(expected) == len(received) and all(
        part.startswith("{") and part.endswith("}") or part == received[index]
        for index, part in enumerate(expected)
    )


def _operation(method: str, path: str) -> dict[str, Any] | None:
    return next(
        (
            operation
            for operation in _AUTH_PLAN["operations"]
            if operation["method"] == method.upper() and _path_matches(operation["path"], path)
        ),
        None,
    )


def _configured_credential(
    scheme: Mapping[str, Any],
    *,
    token: Credential | None,
    api_key: Credential | None,
    credentials: Mapping[str, Credential | None],
) -> Credential | None:
    named = credentials.get(str(scheme["id"]))
    if named is not None:
        return named
    return token if scheme["kind"] == "bearer" else api_key


def _resolved_parts(
    alternatives: list[dict[str, Any]],
    values: Mapping[str, str],
) -> ResolvedAuth | None:
    schemes = {scheme["id"]: scheme for scheme in _AUTH_PLAN["schemes"]}
    for alternative in alternatives:
        headers: dict[str, str] = {}
        query: list[tuple[str, str]] = []
        complete = True
        for scheme_id in alternative["schemes"]:
            scheme = schemes.get(scheme_id)
            value = values.get(scheme_id)
            if scheme is None or value is None or value == "":
                complete = False
                break
            if scheme["kind"] == "bearer":
                headers["Authorization"] = f"Bearer {value}"
            elif scheme["in"] == "header":
                headers[str(scheme["name"])] = value
            elif scheme["in"] == "query":
                query.append((str(scheme["name"]), value))
            else:
                cookie = f"{scheme['name']}={quote(value, safe='')}"
                headers["Cookie"] = f"{headers['Cookie']}; {cookie}" if "Cookie" in headers else cookie
        if complete:
            return ResolvedAuth(headers=headers, query=query)
    return None


def resolve_auth_sync(
    method: str,
    path: str,
    *,
    token: Credential | None,
    api_key: Credential | None,
    credentials: Mapping[str, Credential | None],
) -> ResolvedAuth:
    operation = _operation(method, path)
    alternatives = operation["alternatives"] if operation else _AUTH_PLAN["defaults"]
    if not alternatives:
        return ResolvedAuth(headers={}, query=[])
    schemes = {scheme["id"]: scheme for scheme in _AUTH_PLAN["schemes"]}
    values: dict[str, str] = {}
    for alternative in alternatives:
        for scheme_id in alternative["schemes"]:
            if scheme_id in values:
                continue
            scheme = schemes.get(scheme_id)
            if scheme is None:
                continue
            credential = _configured_credential(
                scheme, token=token, api_key=api_key, credentials=credentials
            )
            context = CredentialContext(
                method=method.upper(),
                path=operation["path"] if operation else path,
                operation_id=operation.get("operationId") if operation else None,
                scheme=scheme_id,
            )
            value = credential(context) if callable(credential) else credential
            if inspect.isawaitable(value):
                close = getattr(value, "close", None)
                if callable(close):
                    close()
                raise TypeError("Synchronous clients cannot use an asynchronous credential provider.")
            if value:
                values[scheme_id] = value
        resolved = _resolved_parts([alternative], values)
        if resolved is not None:
            return resolved
    raise MissingCredentialError(
        operation.get("operationId") if operation else None,
        [list(alternative["schemes"]) for alternative in alternatives],
    )


async def resolve_auth_async(
    method: str,
    path: str,
    *,
    token: Credential | None,
    api_key: Credential | None,
    credentials: Mapping[str, Credential | None],
) -> ResolvedAuth:
    operation = _operation(method, path)
    alternatives = operation["alternatives"] if operation else _AUTH_PLAN["defaults"]
    if not alternatives:
        return ResolvedAuth(headers={}, query=[])
    schemes = {scheme["id"]: scheme for scheme in _AUTH_PLAN["schemes"]}
    values: dict[str, str] = {}
    for alternative in alternatives:
        for scheme_id in alternative["schemes"]:
            if scheme_id in values:
                continue
            scheme = schemes.get(scheme_id)
            if scheme is None:
                continue
            credential = _configured_credential(
                scheme, token=token, api_key=api_key, credentials=credentials
            )
            context = CredentialContext(
                method=method.upper(),
                path=operation["path"] if operation else path,
                operation_id=operation.get("operationId") if operation else None,
                scheme=scheme_id,
            )
            value = credential(context) if callable(credential) else credential
            if inspect.isawaitable(value):
                value = await value
            if value:
                values[scheme_id] = value
        resolved = _resolved_parts([alternative], values)
        if resolved is not None:
            return resolved
    raise MissingCredentialError(
        operation.get("operationId") if operation else None,
        [list(alternative["schemes"]) for alternative in alternatives],
    )
`;
}

function renderPagination(): string {
  return `from __future__ import annotations

from dataclasses import dataclass, field
from typing import AsyncIterator, Awaitable, Callable, Generic, Iterator, TypeVar

from ._types import Deserializable

T = TypeVar("T", bound=Deserializable)


@dataclass(slots=True)
class ListMetadata:
    before: str | None = None
    after: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, object]) -> "ListMetadata":
        before = data.get("before")
        after = data.get("after")
        return cls(
            before=before if isinstance(before, str) else None,
            after=after if isinstance(after, str) else None,
        )


@dataclass
class SyncPage(Generic[T]):
    data: list[T]
    list_metadata: ListMetadata
    _fetch_page: Callable[..., "SyncPage[T]"] | None = field(default=None, repr=False)

    @property
    def before(self) -> str | None:
        return self.list_metadata.before

    @property
    def after(self) -> str | None:
        return self.list_metadata.after

    def __iter__(self) -> Iterator[T]:
        page = self
        while True:
            yield from page.data
            if not page.data or page.after is None or page._fetch_page is None:
                break
            page = page._fetch_page(after=page.after)


@dataclass
class AsyncPage(Generic[T]):
    data: list[T]
    list_metadata: ListMetadata
    _fetch_page: Callable[..., Awaitable["AsyncPage[T]"]] | None = field(default=None, repr=False)

    @property
    def before(self) -> str | None:
        return self.list_metadata.before

    @property
    def after(self) -> str | None:
        return self.list_metadata.after

    async def __aiter__(self) -> AsyncIterator[T]:
        page = self
        while True:
            for item in page.data:
                yield item
            if not page.data or page.after is None or page._fetch_page is None:
                break
            page = await page._fetch_page(after=page.after)
`;
}

function renderBaseClient(options: NativeRuntimeOptions): string {
  const sdkHeader = `${options.productId}/${options.sdkVersion} (python; sdk-codegen/${options.compilerVersion})`;
  return `from __future__ import annotations

import asyncio
import sys
import time
from enum import Enum
from typing import Any, Mapping, Sequence, Type, cast, overload
from urllib.parse import quote, urlencode

if sys.version_info >= (3, 11):
    from typing import Self
else:
    from typing_extensions import Self

import httpx

from ._auth import Credential, resolve_auth_async, resolve_auth_sync
from ._errors import (
    APIError,
    AuthenticationError,
    AuthorizationError,
    BadRequestError,
    ConflictError,
    ConnectionError,
    NotFoundError,
    RateLimitExceededError,
    ResponseDecodeError,
    ServerError,
    SignalflareError,
    TimeoutError,
    UnprocessableEntityError,
)
from ._pagination import AsyncPage, ListMetadata, SyncPage
from ._types import D, Deserializable, RequestOptions

DEFAULT_BASE_URL = ${JSON.stringify(options.defaultBaseUrl)}
DEFAULT_TIMEOUT = 60.0
DEFAULT_MAX_RETRIES = 0
MAX_ERROR_BODY_LENGTH = 64 * 1024
RETRY_STATUS_CODES = {429, 500, 502, 503, 504}


def _query_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, Enum):
        return str(value.value)
    return str(value)


def _query_items(params: Mapping[str, Any] | None) -> list[tuple[str, str]]:
    result: list[tuple[str, str]] = []
    for name, value in (params or {}).items():
        if value is None:
            continue
        values: Sequence[Any] = cast(Sequence[Any], value) if isinstance(value, (list, tuple)) else [value]
        result.extend((name, _query_value(entry)) for entry in values)
    return result


def _error_type(status_code: int) -> type[APIError]:
    return {
        400: BadRequestError,
        401: AuthenticationError,
        403: AuthorizationError,
        404: NotFoundError,
        409: ConflictError,
        422: UnprocessableEntityError,
        429: RateLimitExceededError,
    }.get(status_code, ServerError if status_code >= 500 else APIError)


class _BaseClient:
    def __init__(
        self,
        *,
        token: Credential | None = None,
        api_key: Credential | None = None,
        credentials: Mapping[str, Credential | None] | None = None,
        client_id: str | None = None,
        base_url: str | None = None,
        request_timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        self._token = token
        self._api_key = api_key
        self._credentials = dict(credentials or {})
        self.client_id = client_id
        self._base_url = (base_url or DEFAULT_BASE_URL).rstrip("/") + "/"
        self._request_timeout = request_timeout
        self._max_retries = max(0, max_retries)
        self._headers = dict(headers or {})

    @property
    def base_url(self) -> str:
        return self._base_url

    @property
    def api_key(self) -> str | None:
        return self._api_key if isinstance(self._api_key, str) else None

    def _require_api_key(self) -> str:
        value = self.api_key
        if value is None:
            raise SignalflareError("This operation requires a static API key.")
        return value

    def _require_client_id(self) -> str:
        if self.client_id is None:
            raise SignalflareError("This operation requires a client ID.")
        return self.client_id

    @staticmethod
    def _encode_path(path: Sequence[str]) -> str:
        if isinstance(path, str):
            raise TypeError("path must be a sequence of path segments, not a string")
        return "/".join(quote(str(segment), safe="") for segment in path)

    def _resolve_base_url(self, request_options: RequestOptions | None) -> str:
        override = request_options.get("base_url") if request_options else None
        return str(override or self._base_url).rstrip("/")

    def _resolve_timeout(self, request_options: RequestOptions | None) -> float:
        override = request_options.get("timeout") if request_options else None
        return float(override if override is not None else self._request_timeout)

    def _resolve_max_retries(self, request_options: RequestOptions | None) -> int:
        override = request_options.get("max_retries") if request_options else None
        return max(0, int(override if override is not None else self._max_retries))

    def build_url(self, path: Sequence[str], params: Mapping[str, Any] | None = None) -> str:
        url = f"{self._base_url.rstrip('/')}/{self._encode_path(path)}"
        items = _query_items(params)
        return f"{url}?{urlencode(items)}" if items else url

    def _headers_for(
        self,
        body: Mapping[str, Any] | None,
        resolved_headers: Mapping[str, str],
        idempotency_key: str | None,
        request_options: RequestOptions | None,
    ) -> dict[str, str]:
        headers = dict(self._headers)
        if request_options:
            headers.update(request_options.get("extra_headers", {}))
        headers["Accept"] = "application/json"
        headers["X-Signalflare-SDK"] = ${JSON.stringify(sdkHeader)}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        for managed_name, value in resolved_headers.items():
            for existing in list(headers):
                if existing.lower() == managed_name.lower():
                    del headers[existing]
            headers[managed_name] = value
        return headers

    @staticmethod
    def _deserialize_response(
        response: httpx.Response, model: Type[Deserializable] | None
    ) -> Any:
        if response.status_code == 204 or not response.content:
            return None
        try:
            data = response.json()
            if model is None:
                return data
            if not isinstance(data, dict):
                raise TypeError("expected a JSON object")
            return model.from_dict(cast(dict[str, Any], data))
        except ResponseDecodeError:
            raise
        except Exception as error:
            raise ResponseDecodeError(
                response.status_code, response.text[:MAX_ERROR_BODY_LENGTH]
            ) from error

    @staticmethod
    def _raise_error(response: httpx.Response) -> None:
        raw_body = response.text[:MAX_ERROR_BODY_LENGTH]
        payload: dict[str, Any] = {}
        try:
            decoded: Any = response.json()
            if isinstance(decoded, dict):
                payload = cast(dict[str, Any], decoded)
        except Exception:
            pass
        message_value = payload.get("message", payload.get("error_description", raw_body))
        message = str(message_value or f"API request failed with status {response.status_code}.")
        code_value = payload.get("code", payload.get("error"))
        code = str(code_value) if isinstance(code_value, str) else None
        request_id = response.headers.get("x-request-id")
        if request_id is None and isinstance(payload.get("requestId"), str):
            request_id = cast(str, payload["requestId"])
        error_type = _error_type(response.status_code)
        kwargs: dict[str, Any] = {
            "status_code": response.status_code,
            "code": code,
            "request_id": request_id,
            "details": payload.get("details"),
            "raw_body": raw_body,
            "response_json": payload,
        }
        if error_type is RateLimitExceededError:
            retry_after = response.headers.get("retry-after")
            try:
                kwargs["retry_after"] = float(retry_after) if retry_after else None
            except ValueError:
                kwargs["retry_after"] = None
        raise error_type(message, **kwargs)

    @staticmethod
    def _can_retry(method: str, idempotency_key: str | None) -> bool:
        return method.upper() in {"GET", "HEAD", "OPTIONS"} or idempotency_key is not None


class ${options.clientClassName}(_BaseClient):
    """Synchronous ${options.productDisplayName} API client."""

    def __init__(self, *, http_client: httpx.Client | None = None, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._client = http_client or httpx.Client(follow_redirects=True)
        self._owns_client = http_client is None

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, exc_type: Any, exc_value: Any, traceback: Any) -> None:
        self.close()

    @overload
    def request(self, method: str, path: Sequence[str], *, model: Type[D], params: dict[str, Any] | None = ..., body: dict[str, Any] | None = ..., idempotency_key: str | None = ..., request_options: RequestOptions | None = ...) -> D: ...

    @overload
    def request(self, method: str, path: Sequence[str], *, model: None = ..., params: dict[str, Any] | None = ..., body: dict[str, Any] | None = ..., idempotency_key: str | None = ..., request_options: RequestOptions | None = ...) -> Any: ...

    def request(
        self,
        method: str,
        path: Sequence[str],
        *,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
        model: Type[Deserializable] | None = None,
        idempotency_key: str | None = None,
        request_options: RequestOptions | None = None,
    ) -> Any:
        encoded_path = "/" + self._encode_path(path)
        url = self._resolve_base_url(request_options) + encoded_path
        resolved = resolve_auth_sync(
            method,
            encoded_path,
            token=self._token,
            api_key=self._api_key,
            credentials=self._credentials,
        )
        query = _query_items(params) + resolved.query
        effective_idempotency_key = idempotency_key or (
            request_options.get("idempotency_key") if request_options else None
        )
        headers = self._headers_for(body, resolved.headers, effective_idempotency_key, request_options)
        max_retries = self._resolve_max_retries(request_options) if self._can_retry(method, effective_idempotency_key) else 0
        for attempt in range(max_retries + 1):
            try:
                response = self._client.request(
                    method.upper(),
                    url,
                    params=httpx.QueryParams(cast(Any, query)),
                    json=body if body is not None else None,
                    headers=headers,
                    timeout=self._resolve_timeout(request_options),
                )
                if response.status_code in RETRY_STATUS_CODES and attempt < max_retries:
                    time.sleep(min(0.1 * (2**attempt), 5.0))
                    continue
                if response.status_code >= 400:
                    self._raise_error(response)
                return self._deserialize_response(response, model)
            except httpx.TimeoutException as error:
                if attempt < max_retries:
                    continue
                raise TimeoutError(f"Request timed out: {error}") from error
            except httpx.HTTPError as error:
                if attempt < max_retries:
                    continue
                raise ConnectionError(f"Network request failed: {error}") from error
        raise SignalflareError("Request retry loop terminated unexpectedly.")

    def request_list(self, method: str, path: Sequence[str], **kwargs: Any) -> list[dict[str, Any]]:
        result = self.request(method, path, **kwargs)
        if not isinstance(result, list):
            raise ResponseDecodeError(200, "Expected a JSON array.")
        return cast(list[dict[str, Any]], result)

    def request_page(
        self,
        method: str,
        path: Sequence[str],
        *,
        model: Type[D],
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
        request_options: RequestOptions | None = None,
    ) -> SyncPage[D]:
        raw = self.request(method, path, params=params, body=body, request_options=request_options)
        data: dict[str, Any] = cast(dict[str, Any], raw) if isinstance(raw, dict) else {}
        raw_items = cast(list[Any], data.get("data") or [])
        items = [model.from_dict(cast(dict[str, Any], item)) for item in raw_items]
        metadata_value = data.get("list_metadata")
        metadata = ListMetadata.from_dict(
            cast(dict[str, object], metadata_value) if isinstance(metadata_value, dict) else {}
        )

        def fetch_page(*, after: str | None = None) -> SyncPage[D]:
            return self.request_page(
                method, path, model=model, params={**(params or {}), "after": after}, body=body, request_options=request_options
            )

        return SyncPage(data=items, list_metadata=metadata, _fetch_page=fetch_page)


class Async${options.clientClassName}(_BaseClient):
    """Asynchronous ${options.productDisplayName} API client."""

    def __init__(self, *, http_client: httpx.AsyncClient | None = None, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._client = http_client or httpx.AsyncClient(follow_redirects=True)
        self._owns_client = http_client is None

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, exc_type: Any, exc_value: Any, traceback: Any) -> None:
        await self.close()

    async def request(
        self,
        method: str,
        path: Sequence[str],
        *,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
        model: Type[D] | None = None,
        idempotency_key: str | None = None,
        request_options: RequestOptions | None = None,
    ) -> Any:
        encoded_path = "/" + self._encode_path(path)
        url = self._resolve_base_url(request_options) + encoded_path
        resolved = await resolve_auth_async(
            method,
            encoded_path,
            token=self._token,
            api_key=self._api_key,
            credentials=self._credentials,
        )
        query = _query_items(params) + resolved.query
        effective_idempotency_key = idempotency_key or (
            request_options.get("idempotency_key") if request_options else None
        )
        headers = self._headers_for(body, resolved.headers, effective_idempotency_key, request_options)
        max_retries = self._resolve_max_retries(request_options) if self._can_retry(method, effective_idempotency_key) else 0
        for attempt in range(max_retries + 1):
            try:
                response = await self._client.request(
                    method.upper(),
                    url,
                    params=httpx.QueryParams(cast(Any, query)),
                    json=body if body is not None else None,
                    headers=headers,
                    timeout=self._resolve_timeout(request_options),
                )
                if response.status_code in RETRY_STATUS_CODES and attempt < max_retries:
                    await asyncio.sleep(min(0.1 * (2**attempt), 5.0))
                    continue
                if response.status_code >= 400:
                    self._raise_error(response)
                return self._deserialize_response(response, model)
            except httpx.TimeoutException as error:
                if attempt < max_retries:
                    continue
                raise TimeoutError(f"Request timed out: {error}") from error
            except httpx.HTTPError as error:
                if attempt < max_retries:
                    continue
                raise ConnectionError(f"Network request failed: {error}") from error
        raise SignalflareError("Request retry loop terminated unexpectedly.")

    async def request_list(self, method: str, path: Sequence[str], **kwargs: Any) -> list[dict[str, Any]]:
        result = await self.request(method, path, **kwargs)
        if not isinstance(result, list):
            raise ResponseDecodeError(200, "Expected a JSON array.")
        return cast(list[dict[str, Any]], result)

    async def request_page(
        self,
        method: str,
        path: Sequence[str],
        *,
        model: Type[D],
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
        request_options: RequestOptions | None = None,
    ) -> AsyncPage[D]:
        raw = await self.request(method, path, params=params, body=body, request_options=request_options)
        data: dict[str, Any] = cast(dict[str, Any], raw) if isinstance(raw, dict) else {}
        raw_items = cast(list[Any], data.get("data") or [])
        items = [model.from_dict(cast(dict[str, Any], item)) for item in raw_items]
        metadata_value = data.get("list_metadata")
        metadata = ListMetadata.from_dict(
            cast(dict[str, object], metadata_value) if isinstance(metadata_value, dict) else {}
        )

        async def fetch_page(*, after: str | None = None) -> AsyncPage[D]:
            return await self.request_page(
                method, path, model=model, params={**(params or {}), "after": after}, body=body, request_options=request_options
            )

        return AsyncPage(data=items, list_metadata=metadata, _fetch_page=fetch_page)
`;
}

function renderInit(options: NativeRuntimeOptions): string {
  return `"""${options.productDisplayName} SDK."""

from ._auth import CredentialContext, CredentialProvider
from ._client import Async${options.clientClassName}, ${options.clientClassName}
from ._errors import (
    APIError,
    AuthenticationError,
    AuthorizationError,
    BadRequestError,
    ConflictError,
    ConnectionError,
    MissingCredentialError,
    NotFoundError,
    RateLimitExceededError,
    ResponseDecodeError,
    ServerError,
    SignalflareError,
    TimeoutError,
    UnprocessableEntityError,
)
from ._pagination import AsyncPage, ListMetadata, SyncPage
from ._types import NOT_GIVEN, NotGiven, RequestOptions

__all__ = [
    "${options.clientClassName}",
    "Async${options.clientClassName}",
    "CredentialContext",
    "CredentialProvider",
    "SignalflareError",
    "APIError",
    "AuthenticationError",
    "AuthorizationError",
    "BadRequestError",
    "ConflictError",
    "ConnectionError",
    "MissingCredentialError",
    "NotFoundError",
    "RateLimitExceededError",
    "ResponseDecodeError",
    "ServerError",
    "TimeoutError",
    "UnprocessableEntityError",
    "SyncPage",
    "AsyncPage",
    "ListMetadata",
    "RequestOptions",
    "NOT_GIVEN",
    "NotGiven",
]
`;
}

function renderPyproject(options: NativeRuntimeOptions, moduleName: string): string {
  return `[project]
name = ${JSON.stringify(options.packageName)}
version = ${JSON.stringify(options.sdkVersion)}
description = ${JSON.stringify(`Generated ${options.productDisplayName} API SDK`)}
requires-python = ">=3.10"
license = "MIT"
dependencies = ["httpx>=0.27,<1", "typing-extensions>=4; python_version < '3.11'"]

[project.optional-dependencies]
test = ["pytest>=8,<10", "pytest-asyncio>=0.24,<2", "pytest-httpx>=0.35,<1"]

[dependency-groups]
dev = ["pyright>=1.1,<2", "ruff>=0.15,<1"]

[build-system]
requires = ["hatchling>=1.27"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/${moduleName}"]

[tool.pyright]
typeCheckingMode = "strict"
include = ["src/${moduleName}"]
reportPrivateUsage = false
reportUnnecessaryIsInstance = false
reportUnusedFunction = false
reportUnusedImport = false

[tool.ruff]
target-version = "py310"

[tool.ruff.lint]
select = ["E4", "E7", "E9", "F", "I"]

[tool.ruff.lint.per-file-ignores]
"src/**/__init__.py" = ["F401", "F403"]
"src/**/_resource.py" = ["F401"]
"src/**/models/*.py" = ["F401"]
"tests/*.py" = ["F401"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
`;
}

function renderConftest(options: NativeRuntimeOptions, moduleName: string): string {
  return `import pytest

from ${moduleName} import Async${options.clientClassName}, ${options.clientClassName}


@pytest.fixture
def client():
    value = ${options.clientClassName}(token="test_token", api_key="test_api_key", max_retries=0)
    try:
        yield value
    finally:
        value.close()


@pytest.fixture
def workos(client):
    return client


@pytest.fixture
async def async_client():
    value = Async${options.clientClassName}(token="test_token", api_key="test_api_key", max_retries=0)
    try:
        yield value
    finally:
        await value.close()


@pytest.fixture
async def async_workos(async_client):
    return async_client
`;
}

function renderTestHelpers(): string {
  return `import json
from pathlib import Path
from typing import Any


def load_fixture(name: str) -> Any:
    return json.loads((Path(__file__).parent / "fixtures" / name).read_text())
`;
}

export function generatePythonRuntime(
  options: NativeRuntimeOptions,
  moduleName: string,
): GeneratedFile[] {
  const prefix = `src/${moduleName}`;
  return [
    { path: `${prefix}/_errors.py`, content: renderErrors() },
    { path: `${prefix}/_types.py`, content: renderTypes() },
    { path: `${prefix}/_auth.py`, content: renderAuth(options) },
    { path: `${prefix}/_pagination.py`, content: renderPagination() },
    { path: `${prefix}/_base_client.py`, content: renderBaseClient(options) },
    { path: `${prefix}/__init__.py`, content: renderInit(options) },
    { path: `${prefix}/py.typed`, content: "" },
    { path: `${prefix}/THIRD_PARTY_NOTICES.md`, content: thirdPartyNotices() },
    { path: "pyproject.toml", content: renderPyproject(options, moduleName) },
    { path: "THIRD_PARTY_NOTICES.md", content: thirdPartyNotices() },
    { path: "tests/__init__.py", content: "" },
    { path: "tests/conftest.py", content: renderConftest(options, moduleName) },
    { path: "tests/generated_helpers.py", content: renderTestHelpers() },
  ].map((file) => ({
    ...file,
    ...(file.path === "pyproject.toml"
      ? { skipIfExists: true, overwriteExisting: false }
      : { overwriteExisting: true }),
  }));
}
