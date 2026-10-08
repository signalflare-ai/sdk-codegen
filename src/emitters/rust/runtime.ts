import type { GeneratedFile } from "@workos/oagen";
import { thirdPartyNotices, type NativeRuntimeOptions } from "../runtime-options.js";

function rustString(value: string): string {
  return JSON.stringify(value);
}

function renderAuth(options: NativeRuntimeOptions): string {
  const schemes = options.authPlan.schemes
    .map((scheme) => {
      if (scheme.kind === "bearer") {
        return `    AuthScheme { id: ${rustString(scheme.id)}, kind: AuthKind::Bearer, location: "", name: "" },`;
      }
      return `    AuthScheme { id: ${rustString(scheme.id)}, kind: AuthKind::ApiKey, location: ${rustString(scheme.in)}, name: ${rustString(scheme.name)} },`;
    })
    .join("\n");
  const alternatives = (items: readonly { readonly schemes: readonly string[] }[]) =>
    `&[${items.map((item) => `&[${item.schemes.map(rustString).join(", ")}]`).join(", ")}]`;
  const operations = options.authPlan.operations
    .map(
      (operation) =>
        `    AuthOperation { method: ${rustString(operation.method)}, path: ${rustString(operation.path)}, operation_id: ${rustString(operation.operationId)}, alternatives: ${alternatives(operation.alternatives)} },`,
    )
    .join("\n");

  return `//! Operation-aware OpenAPI authentication.

use std::collections::HashMap;
use std::error::Error as StdError;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use http::{HeaderMap, HeaderName, HeaderValue, Method};

use crate::error::Error;

/// Error returned by an application credential provider.
pub type CredentialProviderError = Box<dyn StdError + Send + Sync>;
/// Future returned by a credential provider.
pub type CredentialFuture<'a> = Pin<Box<dyn Future<Output = Result<Option<String>, CredentialProviderError>> + Send + 'a>>;

/// Metadata supplied when the SDK resolves a credential.
#[derive(Debug, Clone, Copy)]
pub struct CredentialContext<'a> {
    /// HTTP method.
    pub method: &'a Method,
    /// OpenAPI path template.
    pub path: &'a str,
    /// OpenAPI operation identifier.
    pub operation_id: Option<&'a str>,
    /// OpenAPI security scheme identifier.
    pub scheme: &'a str,
}

/// Asynchronous source of credentials. Providers may refresh AuthKit tokens per request.
pub trait CredentialProvider: Send + Sync {
    /// Resolve a credential, returning None when this provider cannot satisfy the request.
    fn provide<'a>(&'a self, context: CredentialContext<'a>) -> CredentialFuture<'a>;
}

/// Shared credential-provider handle.
pub type SharedCredentialProvider = Arc<dyn CredentialProvider>;

struct StaticCredential(String);

impl CredentialProvider for StaticCredential {
    fn provide<'a>(&'a self, _context: CredentialContext<'a>) -> CredentialFuture<'a> {
        Box::pin(async move { Ok(Some(self.0.clone())) })
    }
}

/// Wrap a static credential as a provider.
pub fn static_credential(value: impl Into<String>) -> SharedCredentialProvider {
    Arc::new(StaticCredential(value.into()))
}

/// Wrap a closure returning a boxed future as a credential provider.
pub fn credential_provider<F>(provider: F) -> SharedCredentialProvider
where
    F: Send + Sync + 'static + for<'a> Fn(CredentialContext<'a>) -> CredentialFuture<'a>,
{
    struct ClosureProvider<F>(F);
    impl<F> CredentialProvider for ClosureProvider<F>
    where
        F: Send + Sync + 'static + for<'a> Fn(CredentialContext<'a>) -> CredentialFuture<'a>,
    {
        fn provide<'a>(&'a self, context: CredentialContext<'a>) -> CredentialFuture<'a> {
            (self.0)(context)
        }
    }
    Arc::new(ClosureProvider(provider))
}

#[derive(Default)]
pub(crate) struct Credentials {
    pub(crate) token: Option<SharedCredentialProvider>,
    pub(crate) api_key: Option<SharedCredentialProvider>,
    pub(crate) named: HashMap<String, SharedCredentialProvider>,
}

#[allow(dead_code)]
#[derive(Clone, Copy)]
enum AuthKind { Bearer, ApiKey }

#[derive(Clone, Copy)]
struct AuthScheme {
    id: &'static str,
    kind: AuthKind,
    location: &'static str,
    name: &'static str,
}

struct AuthOperation {
    method: &'static str,
    path: &'static str,
    operation_id: &'static str,
    alternatives: &'static [&'static [&'static str]],
}

const SCHEMES: &[AuthScheme] = &[
${schemes}
];

const DEFAULTS: &[&[&str]] = ${alternatives(options.authPlan.defaults)};
const OPERATIONS: &[AuthOperation] = &[
${operations}
];

pub(crate) struct ResolvedAuth {
    pub(crate) headers: HeaderMap,
    pub(crate) query: Vec<(String, String)>,
}

fn path_matches(template: &str, actual: &str) -> bool {
    let expected: Vec<_> = template.trim_matches('/').split('/').collect();
    let received: Vec<_> = actual.trim_matches('/').split('/').collect();
    expected.len() == received.len()
        && expected.iter().zip(received).all(|(part, value)| {
            (part.starts_with('{') && part.ends_with('}')) || *part == value
        })
}

pub(crate) async fn resolve_auth(
    credentials: &Credentials,
    method: &Method,
    path: &str,
) -> Result<ResolvedAuth, Error> {
    let operation = OPERATIONS.iter().find(|operation| {
        operation.method == method.as_str() && path_matches(operation.path, path)
    });
    let alternatives = operation.map_or(DEFAULTS, |value| value.alternatives);
    if alternatives.is_empty() {
        return Ok(ResolvedAuth { headers: HeaderMap::new(), query: Vec::new() });
    }

    for alternative in alternatives {
        let mut headers = HeaderMap::new();
        let mut query = Vec::new();
        let mut complete = true;
        for scheme_id in *alternative {
            let Some(scheme) = SCHEMES.iter().find(|candidate| candidate.id == *scheme_id) else {
                complete = false;
                break;
            };
            let provider = credentials.named.get(*scheme_id).or(match scheme.kind {
                AuthKind::Bearer => credentials.token.as_ref(),
                AuthKind::ApiKey => credentials.api_key.as_ref(),
            });
            let Some(provider) = provider else {
                complete = false;
                break;
            };
            let context = CredentialContext {
                method,
                path: operation.map_or(path, |value| value.path),
                operation_id: operation.map(|value| value.operation_id),
                scheme: scheme_id,
            };
            let value = provider.provide(context).await.map_err(|source| Error::CredentialProvider {
                scheme: (*scheme_id).to_string(),
                source,
            })?;
            let Some(value) = value.filter(|value| !value.is_empty()) else {
                complete = false;
                break;
            };
            match scheme.kind {
                AuthKind::Bearer => {
                    let value = HeaderValue::from_str(&format!("Bearer {value}"))
                        .map_err(|error| Error::Builder(format!("invalid bearer credential: {error}")))?;
                    headers.insert(http::header::AUTHORIZATION, value);
                }
                AuthKind::ApiKey if scheme.location == "header" => {
                    let name = HeaderName::from_bytes(scheme.name.as_bytes())
                        .map_err(|error| Error::Builder(format!("invalid auth header name: {error}")))?;
                    let value = HeaderValue::from_str(&value)
                        .map_err(|error| Error::Builder(format!("invalid API-key credential: {error}")))?;
                    headers.insert(name, value);
                }
                AuthKind::ApiKey if scheme.location == "query" => {
                    query.push((scheme.name.to_string(), value));
                }
                AuthKind::ApiKey => {
                    let cookie = format!("{}={}", scheme.name, percent_encode(&value));
                    let existing = headers.get(http::header::COOKIE).and_then(|value| value.to_str().ok());
                    let combined = existing.map_or(cookie.clone(), |value| format!("{value}; {cookie}"));
                    let value = HeaderValue::from_str(&combined)
                        .map_err(|error| Error::Builder(format!("invalid cookie credential: {error}")))?;
                    headers.insert(http::header::COOKIE, value);
                }
            }
        }
        if complete {
            return Ok(ResolvedAuth { headers, query });
        }
    }

    Err(Error::MissingCredential {
        operation_id: operation.map(|value| value.operation_id.to_string()),
        alternatives: alternatives
            .iter()
            .map(|alternative| alternative.iter().map(|value| (*value).to_string()).collect())
            .collect(),
    })
}

fn percent_encode(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for &byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => output.push(byte as char),
            _ => output.push_str(&format!("%{byte:02X}")),
        }
    }
    output
}
`;
}

function renderError(): string {
  return `//! SDK error types.

use std::error::Error as StdError;
use std::time::Duration;

use bytes::Bytes;
use http::HeaderMap;
use thiserror::Error;

use crate::transport::TransportError;

/// Structured non-successful API response.
#[derive(Debug, Clone)]
pub struct ApiError {
    /// HTTP status code.
    pub status: u16,
    /// Machine-readable error code.
    pub code: Option<String>,
    /// Human-readable message.
    pub message: String,
    /// Request identifier.
    pub request_id: Option<String>,
    /// Structured error details.
    pub details: Option<serde_json::Value>,
    /// Retry-After duration when present.
    pub retry_after: Option<Duration>,
    /// Response headers.
    pub headers: HeaderMap,
    /// Raw response body, bounded to 64 KiB.
    pub raw_body: Bytes,
}

impl ApiError {
    pub(crate) fn from_response(status: u16, headers: &HeaderMap, body: &Bytes) -> Self {
        let bounded_body = Bytes::copy_from_slice(&body[..body.len().min(64 * 1024)]);
        let raw = String::from_utf8_lossy(&bounded_body).into_owned();
        let payload = serde_json::from_slice::<serde_json::Value>(&bounded_body).ok();
        let object = payload.as_ref().and_then(serde_json::Value::as_object);
        let code = object
            .and_then(|object| object.get("code").or_else(|| object.get("error")))
            .and_then(serde_json::Value::as_str)
            .map(ToOwned::to_owned);
        let message = object
            .and_then(|object| object.get("message").or_else(|| object.get("error_description")))
            .and_then(serde_json::Value::as_str)
            .map_or(raw, ToOwned::to_owned);
        let details = object.and_then(|object| object.get("details")).cloned();
        let request_id = headers
            .get("x-request-id")
            .and_then(|value| value.to_str().ok())
            .map(ToOwned::to_owned)
            .or_else(|| object.and_then(|object| object.get("requestId"))
                .and_then(serde_json::Value::as_str).map(ToOwned::to_owned));
        let retry_after = headers
            .get(http::header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
            .map(Duration::from_secs);
        Self { status, code, message, request_id, details, retry_after, headers: headers.clone(), raw_body: bounded_body }
    }
}

/// Broad error category suitable for metrics and matching.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    /// Non-successful HTTP response.
    Api,
    /// Missing credentials.
    MissingCredential,
    /// Credential provider failed.
    CredentialProvider,
    /// Network or timeout failure.
    Network,
    /// Successful response contained malformed JSON.
    ResponseDecode,
    /// Invalid caller configuration or serialization.
    Builder,
}

/// All errors produced by this SDK.
#[derive(Debug, Error)]
pub enum Error {
    /// API response error.
    #[error("API error {status}: {message}", status = .0.status, message = .0.message)]
    Api(Box<ApiError>),
    /// No credential alternative was complete.
    #[error("missing credentials for {operation_id:?}")]
    MissingCredential {
        /// Operation identifier.
        operation_id: Option<String>,
        /// Acceptable AND-groups, ordered as OpenAPI OR alternatives.
        alternatives: Vec<Vec<String>>,
    },
    /// Application credential provider failed.
    #[error("credential provider for {scheme} failed: {source}")]
    CredentialProvider {
        /// Security scheme identifier.
        scheme: String,
        /// Original provider error.
        #[source]
        source: Box<dyn StdError + Send + Sync>,
    },
    /// Configured HTTP transport failed.
    #[error("network error: {0}")]
    Network(#[from] TransportError),
    /// Successful response could not be decoded.
    #[error("unable to decode successful response with status {status}: {source}")]
    ResponseDecode {
        /// HTTP status code.
        status: u16,
        /// Bounded raw response body.
        raw_body: Bytes,
        /// JSON decoder error.
        #[source]
        source: serde_json::Error,
    },
    /// Invalid configuration or request serialization.
    #[error("invalid request: {0}")]
    Builder(String),
}

impl Error {
    /// Return the stable broad category.
    pub fn kind(&self) -> ErrorKind {
        match self {
            Self::Api(_) => ErrorKind::Api,
            Self::MissingCredential { .. } => ErrorKind::MissingCredential,
            Self::CredentialProvider { .. } => ErrorKind::CredentialProvider,
            Self::Network(_) => ErrorKind::Network,
            Self::ResponseDecode { .. } => ErrorKind::ResponseDecode,
            Self::Builder(_) => ErrorKind::Builder,
        }
    }

    /// Return the structured API error when available.
    pub fn api(&self) -> Option<&ApiError> {
        match self { Self::Api(error) => Some(error), _ => None }
    }

    /// Return the HTTP status for API and response-decode errors.
    pub fn status(&self) -> Option<u16> {
        match self {
            Self::Api(error) => Some(error.status),
            Self::ResponseDecode { status, .. } => Some(*status),
            _ => None,
        }
    }

    /// Return true for a 404 API response.
    pub fn is_not_found(&self) -> bool { self.status() == Some(404) }
    /// Return true for a 429 API response.
    pub fn is_rate_limited(&self) -> bool { self.status() == Some(429) }
}
`;
}

function renderTransport(): string {
  return `//! Pluggable asynchronous HTTP transport.

use std::error::Error as StdError;
use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use bytes::Bytes;
use http::{HeaderMap, Method, StatusCode};

#[cfg(feature = "rustls-tls")]
mod reqwest_impl;
#[cfg(feature = "rustls-tls")]
pub use reqwest_impl::ReqwestTransport;

/// Fully constructed outbound request.
#[derive(Debug, Clone)]
pub struct HttpRequest {
    /// HTTP method.
    pub method: Method,
    /// Absolute URL.
    pub url: String,
    /// Request headers.
    pub headers: HeaderMap,
    /// Optional JSON body.
    pub body: Option<Bytes>,
    /// Optional per-request timeout.
    pub timeout: Option<Duration>,
}

/// Materialized HTTP response.
#[derive(Debug, Clone)]
pub struct HttpResponse {
    /// Status code.
    pub status: StatusCode,
    /// Response headers.
    pub headers: HeaderMap,
    /// Response body. Error bodies are bounded to 64 KiB.
    pub body: Bytes,
}

/// Transport failure category used by retry policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportErrorKind { Connect, Timeout, Other }

/// Transport-level failure.
#[derive(Debug)]
pub struct TransportError {
    /// Stable category.
    pub kind: TransportErrorKind,
    /// Original transport error.
    pub source: Box<dyn StdError + Send + Sync>,
}

impl TransportError {
    /// Construct a transport error.
    pub fn new(kind: TransportErrorKind, source: impl Into<Box<dyn StdError + Send + Sync>>) -> Self {
        Self { kind, source: source.into() }
    }
    /// Construct a connection error.
    pub fn connect(source: impl Into<Box<dyn StdError + Send + Sync>>) -> Self { Self::new(TransportErrorKind::Connect, source) }
    /// Construct a timeout error.
    pub fn timeout(source: impl Into<Box<dyn StdError + Send + Sync>>) -> Self { Self::new(TransportErrorKind::Timeout, source) }
    /// Construct another transport error.
    pub fn other(source: impl Into<Box<dyn StdError + Send + Sync>>) -> Self { Self::new(TransportErrorKind::Other, source) }
    pub(crate) fn is_retryable(&self) -> bool { matches!(self.kind, TransportErrorKind::Connect | TransportErrorKind::Timeout) }
}

impl fmt::Display for TransportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result { write!(formatter, "transport error: {}", self.source) }
}
impl StdError for TransportError { fn source(&self) -> Option<&(dyn StdError + 'static)> { Some(&*self.source) } }

/// Thread-safe asynchronous HTTP transport.
#[async_trait]
pub trait HttpTransport: Send + Sync {
    /// Execute a request. HTTP errors remain successful transport responses.
    async fn execute(&self, request: HttpRequest) -> Result<HttpResponse, TransportError>;
}

/// Shared type-erased transport.
pub type SharedTransport = Arc<dyn HttpTransport>;
`;
}

function renderReqwestTransport(): string {
  return `//! Reqwest-backed transport.

use std::time::Duration;

use async_trait::async_trait;
use bytes::BytesMut;

use super::{HttpRequest, HttpResponse, HttpTransport, TransportError};

const MAX_ERROR_BODY_LENGTH: usize = 64 * 1024;

/// Default Reqwest transport using Rustls.
#[derive(Clone)]
pub struct ReqwestTransport { inner: reqwest::Client }

impl ReqwestTransport {
    /// Wrap an existing Reqwest client.
    pub fn from_client(client: reqwest::Client) -> Self { Self { inner: client } }

    /// Create a client with a default timeout.
    pub fn with_timeout(timeout: Duration) -> Result<Self, TransportError> {
        reqwest::Client::builder()
            .timeout(timeout)
            .build()
            .map(Self::from_client)
            .map_err(TransportError::other)
    }
}

#[async_trait]
impl HttpTransport for ReqwestTransport {
    async fn execute(&self, request: HttpRequest) -> Result<HttpResponse, TransportError> {
        let mut builder = self.inner.request(request.method, &request.url).headers(request.headers);
        if let Some(timeout) = request.timeout { builder = builder.timeout(timeout); }
        if let Some(body) = request.body { builder = builder.body(body); }
        let mut response = builder.send().await.map_err(map_error)?;
        let status = response.status();
        let headers = response.headers().clone();
        let is_error = !status.is_success();
        let mut body = BytesMut::new();
        while let Some(chunk) = response.chunk().await.map_err(map_error)? {
            if is_error {
                let remaining = MAX_ERROR_BODY_LENGTH.saturating_sub(body.len());
                if remaining > 0 { body.extend_from_slice(&chunk[..chunk.len().min(remaining)]); }
            } else {
                body.extend_from_slice(&chunk);
            }
        }
        Ok(HttpResponse { status, headers, body: body.freeze() })
    }
}

fn map_error(error: reqwest::Error) -> TransportError {
    if error.is_connect() { TransportError::connect(error) }
    else if error.is_timeout() { TransportError::timeout(error) }
    else { TransportError::other(error) }
}
`;
}

function renderQuery(): string {
  return `//! Query-string encoding for generated parameter structs.

use serde::{Serialize, Serializer};

use crate::error::Error;

#[doc(hidden)]
pub fn serialize_comma_separated_opt<S, T>(values: &Option<Vec<T>>, serializer: S) -> Result<S::Ok, S::Error>
where S: Serializer, T: Serialize {
    match values { Some(values) => serialize_comma_separated(values, serializer), None => serializer.serialize_none() }
}

#[doc(hidden)]
pub fn serialize_comma_separated<S, T>(values: &[T], serializer: S) -> Result<S::Ok, S::Error>
where S: Serializer, T: Serialize {
    let parts = values.iter().map(|value| {
        serde_json::to_string(value).map(|json| json.trim_matches('"').to_string())
    }).collect::<Result<Vec<_>, _>>().map_err(serde::ser::Error::custom)?;
    serializer.serialize_str(&parts.join(","))
}

/// Encode a serializable parameter struct using repeated array keys.
pub fn encode_query<P: Serialize>(params: &P) -> Result<String, Error> {
    let value = serde_json::to_value(params).map_err(|error| Error::Builder(format!("query encode failed: {error}")))?;
    let mut output = String::new();
    encode_value("", &value, &mut output);
    Ok(output)
}

fn encode_value(key: &str, value: &serde_json::Value, output: &mut String) {
    match value {
        serde_json::Value::Null => {}
        serde_json::Value::Object(values) => for (name, value) in values { encode_value(name, value, output); },
        serde_json::Value::Array(values) => for value in values { encode_value(key, value, output); },
        serde_json::Value::String(value) => append_pair(output, key, value),
        serde_json::Value::Number(value) => append_pair(output, key, &value.to_string()),
        serde_json::Value::Bool(value) => append_pair(output, key, if *value { "true" } else { "false" }),
    }
}

pub(crate) fn append_url_pair(url: &mut String, key: &str, value: &str) {
    url.push(if url.contains('?') { '&' } else { '?' });
    url.push_str(&percent_encode(key));
    url.push('=');
    url.push_str(&percent_encode(value));
}

fn append_pair(output: &mut String, key: &str, value: &str) {
    if !output.is_empty() { output.push('&'); }
    output.push_str(&percent_encode(key));
    output.push('=');
    output.push_str(&percent_encode(value));
}

fn percent_encode(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for &byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => output.push(byte as char),
            b' ' => output.push('+'),
            _ => output.push_str(&format!("%{byte:02X}")),
        }
    }
    output
}
`;
}

function renderPagination(): string {
  return `//! Cursor-pagination primitives.

use std::future::Future;

use futures_util::stream::{self, Stream, TryStreamExt};
use serde::{Deserialize, Serialize};

use crate::error::Error;

/// One page of results.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Page<T> {
    /// Items in this page.
    pub data: Vec<T>,
    /// Cursor metadata.
    #[serde(default)]
    pub list_metadata: ListMetadata,
}

/// Cursor metadata.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ListMetadata {
    /// Previous cursor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before: Option<String>,
    /// Next cursor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<String>,
}

/// Turn a page fetcher into a fallible stream of items.
pub fn auto_paginate<T, F, Fut>(fetch: F) -> impl Stream<Item = Result<T, Error>>
where F: FnMut(Option<String>) -> Fut, Fut: Future<Output = Result<Page<T>, Error>> {
    let initial: (Option<Option<String>>, F) = (Some(None), fetch);
    stream::try_unfold(initial, |(cursor, mut fetch)| async move {
        let Some(after) = cursor else { return Ok::<_, Error>(None); };
        let page = fetch(after).await?;
        let next = page.list_metadata.after.clone().map(Some);
        let items = stream::iter(page.data.into_iter().map(Ok::<T, Error>));
        Ok(Some((items, (next, fetch))))
    }).try_flatten()
}

#[allow(dead_code)]
pub(crate) fn auto_paginate_pages<T, F, Fut>(fetch: F) -> impl Stream<Item = Result<T, Error>>
where F: FnMut(Option<String>) -> Fut, Fut: Future<Output = Result<(Vec<T>, Option<String>), Error>> {
    let initial: (Option<Option<String>>, F) = (Some(None), fetch);
    stream::try_unfold(initial, |(cursor, mut fetch)| async move {
        let Some(after) = cursor else { return Ok::<_, Error>(None); };
        let (data, next) = fetch(after).await?;
        let items = stream::iter(data.into_iter().map(Ok::<T, Error>));
        Ok(Some((items, (next.map(Some), fetch))))
    }).try_flatten()
}
`;
}

function renderOptionalNullable(): string {
  return `//! Three-state omitted, null, or value representation.

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// An optional nullable OpenAPI value.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum OptionalNullable<T> {
    /// Field was omitted.
    #[default]
    Missing,
    /// Field was present as JSON null.
    Null,
    /// Field contained a value.
    Value(T),
}

impl<T> OptionalNullable<T> {
    /// Return true when the field should be omitted during serialization.
    pub fn is_missing(&self) -> bool { matches!(self, Self::Missing) }
}

impl<T: Serialize> Serialize for OptionalNullable<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Missing | Self::Null => serializer.serialize_none(),
            Self::Value(value) => value.serialize(serializer),
        }
    }
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for OptionalNullable<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Option::<T>::deserialize(deserializer).map(|value| value.map_or(Self::Null, Self::Value))
    }
}
`;
}

function renderSecret(): string {
  return `//! Redacted string wrapper used for generated secret fields.

use std::fmt;
use serde::{Deserialize, Serialize};

/// String value whose Debug and Display output is redacted.
#[derive(Clone, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SecretString(String);

impl SecretString {
    /// Construct a secret.
    pub fn new(value: impl Into<String>) -> Self { Self(value.into()) }
    /// Deliberately expose the value.
    pub fn expose(&self) -> &str { &self.0 }
    /// Consume the wrapper.
    pub fn into_inner(self) -> String { self.0 }
}
impl fmt::Debug for SecretString { fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result { formatter.write_str(r#"SecretString("<redacted>")"#) } }
impl fmt::Display for SecretString { fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result { formatter.write_str("<redacted>") } }
impl AsRef<str> for SecretString { fn as_ref(&self) -> &str { &self.0 } }
impl From<String> for SecretString { fn from(value: String) -> Self { Self(value) } }
impl From<&str> for SecretString { fn from(value: &str) -> Self { Self(value.to_string()) } }
impl From<SecretString> for String { fn from(value: SecretString) -> Self { value.0 } }
`;
}

function renderClient(options: NativeRuntimeOptions): string {
  const userAgent = `${options.productId}-rust/${options.sdkVersion} sdk-codegen/${options.compilerVersion}`;
  return `//! Client, builder, request options, and retry policy.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use http::{HeaderMap, HeaderName, HeaderValue, Method, header::{ACCEPT, RETRY_AFTER, USER_AGENT}};
use serde::{Serialize, de::DeserializeOwned};

use crate::auth::{Credentials, SharedCredentialProvider, resolve_auth, static_credential};
use crate::error::{ApiError, Error};
use crate::transport::{HttpRequest, SharedTransport};

/// Default contract server.
pub const DEFAULT_BASE_URL: &str = ${rustString(options.defaultBaseUrl)};
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);

/// Per-request retry policy.
#[derive(Debug, Clone)]
pub enum RequestStrategy {
    /// Send exactly once.
    Once,
    /// Send with an idempotency key and the client retry budget.
    Idempotent(String),
    /// Retry up to this many total attempts without sleeping.
    Retry { max_attempts: u32 },
    /// Retry using exponential backoff.
    ExponentialBackoff { max_attempts: u32 },
}

/// Per-request transport options.
#[derive(Debug, Default, Clone)]
pub struct RequestOptions {
    /// Explicit idempotency key.
    pub idempotency_key: Option<String>,
    /// Additional headers. Runtime-managed auth wins on collision.
    pub extra_headers: Vec<(HeaderName, HeaderValue)>,
    /// Retry strategy.
    pub strategy: Option<RequestStrategy>,
    /// Per-request timeout.
    pub timeout: Option<Duration>,
}

impl RequestOptions {
    /// Construct empty options.
    pub fn new() -> Self { Self::default() }
    /// Set an idempotency key.
    pub fn idempotency_key(mut self, value: impl Into<String>) -> Self { self.idempotency_key = Some(value.into()); self }
    /// Append a header.
    pub fn header(mut self, name: HeaderName, value: HeaderValue) -> Self { self.extra_headers.push((name, value)); self }
    /// Select a retry strategy.
    pub fn strategy(mut self, value: RequestStrategy) -> Self { self.strategy = Some(value); self }
    /// Override the request timeout.
    pub fn timeout(mut self, value: Duration) -> Self { self.timeout = Some(value); self }
}

/// Cheap-to-clone asynchronous API client.
#[derive(Clone)]
pub struct Client { inner: Arc<ClientInner> }

struct ClientInner {
    transport: SharedTransport,
    base_url: String,
    max_retries: u32,
    credentials: Credentials,
    api_key: String,
    client_id: String,
    default_headers: HeaderMap,
}

/// Fallible client builder.
#[derive(Default)]
pub struct ClientBuilder {
    token: Option<SharedCredentialProvider>,
    api_key: Option<SharedCredentialProvider>,
    named: HashMap<String, SharedCredentialProvider>,
    static_api_key: String,
    client_id: String,
    base_url: Option<String>,
    timeout: Option<Duration>,
    max_retries: Option<u32>,
    user_agent: Option<String>,
    transport: Option<SharedTransport>,
}

impl Client {
    /// Construct a client with one bearer credential.
    #[cfg(feature = "rustls-tls")]
    pub fn new(token: impl Into<String>) -> Result<Self, Error> { Self::builder().token(token).build() }

    /// Start configuring a client.
    pub fn builder() -> ClientBuilder { ClientBuilder::default() }

    /// Return the configured base URL.
    pub fn base_url(&self) -> &str { &self.inner.base_url }
    /// Return a static client ID used by inferred contract fields.
    pub fn client_id(&self) -> &str { &self.inner.client_id }
    /// Return a static API key used by inferred contract fields.
    pub fn api_key(&self) -> &str { &self.inner.api_key }
    /// Clone the configured transport.
    pub fn transport(&self) -> SharedTransport { self.inner.transport.clone() }
    /// Return default non-auth headers.
    pub fn default_headers(&self) -> &HeaderMap { &self.inner.default_headers }

    pub(crate) async fn request_with_query_opts<P: Serialize, R: DeserializeOwned>(&self, method: Method, path: &str, params: &P, options: Option<&RequestOptions>) -> Result<R, Error> {
        let request = self.build_request(method.clone(), path, Some(params), None::<&()>, options).await?;
        self.send(request, method, options).await
    }

    pub(crate) async fn request_with_body_opts<P: Serialize, B: Serialize, R: DeserializeOwned>(&self, method: Method, path: &str, params: &P, body: Option<&B>, options: Option<&RequestOptions>) -> Result<R, Error> {
        let request = self.build_request(method.clone(), path, Some(params), body, options).await?;
        self.send(request, method, options).await
    }

    #[allow(dead_code)]
    pub(crate) async fn request_with_query_opts_empty<P: Serialize>(&self, method: Method, path: &str, params: &P, options: Option<&RequestOptions>) -> Result<(), Error> {
        let request = self.build_request(method.clone(), path, Some(params), None::<&()>, options).await?;
        self.send_empty(request, method, options).await
    }

    #[allow(dead_code)]
    pub(crate) async fn request_with_body_opts_empty<P: Serialize, B: Serialize>(&self, method: Method, path: &str, params: &P, body: Option<&B>, options: Option<&RequestOptions>) -> Result<(), Error> {
        let request = self.build_request(method.clone(), path, Some(params), body, options).await?;
        self.send_empty(request, method, options).await
    }

    async fn build_request<P: Serialize, B: Serialize>(&self, method: Method, path: &str, query: Option<&P>, body: Option<&B>, options: Option<&RequestOptions>) -> Result<HttpRequest, Error> {
        let mut url = format!("{}{}", self.inner.base_url, path);
        if let Some(query) = query {
            let encoded = crate::query::encode_query(query)?;
            if !encoded.is_empty() { url.push(if url.contains('?') { '&' } else { '?' }); url.push_str(&encoded); }
        }
        let mut headers = self.inner.default_headers.clone();
        if let Some(options) = options {
            for (name, value) in &options.extra_headers { headers.insert(name.clone(), value.clone()); }
            let key = match options.strategy.as_ref() {
                Some(RequestStrategy::Idempotent(value)) => Some(value.as_str()),
                _ => options.idempotency_key.as_deref(),
            };
            if let Some(key) = key {
                headers.insert(HeaderName::from_static("idempotency-key"), HeaderValue::from_str(key).map_err(|error| Error::Builder(format!("invalid idempotency key: {error}")))?);
            }
        }
        let body = match body {
            Some(value) => {
                headers.insert(http::header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
                Some(Bytes::from(serde_json::to_vec(value).map_err(|error| Error::Builder(format!("request encode failed: {error}")))?))
            }
            None => None,
        };
        let auth = resolve_auth(&self.inner.credentials, &method, path).await?;
        for (name, value) in auth.query { crate::query::append_url_pair(&mut url, &name, &value); }
        for (name, value) in &auth.headers { headers.insert(name.clone(), value.clone()); }
        Ok(HttpRequest { method, url, headers, body, timeout: options.and_then(|value| value.timeout) })
    }

    #[allow(dead_code)]
    async fn send_empty(&self, request: HttpRequest, method: Method, options: Option<&RequestOptions>) -> Result<(), Error> {
        let response = self.execute_with_retry(request, &method, options).await?;
        let status = response.status.as_u16();
        if response.status.is_success() { Ok(()) }
        else { Err(Error::Api(Box::new(ApiError::from_response(status, &response.headers, &response.body)))) }
    }

    async fn send<R: DeserializeOwned>(&self, request: HttpRequest, method: Method, options: Option<&RequestOptions>) -> Result<R, Error> {
        let response = self.execute_with_retry(request, &method, options).await?;
        let status = response.status.as_u16();
        if !response.status.is_success() {
            return Err(Error::Api(Box::new(ApiError::from_response(status, &response.headers, &response.body))));
        }
        serde_json::from_slice(&response.body).map_err(|source| Error::ResponseDecode { status, raw_body: response.body, source })
    }

    async fn execute_with_retry(&self, request: HttpRequest, method: &Method, options: Option<&RequestOptions>) -> Result<crate::transport::HttpResponse, Error> {
        let strategy = options.and_then(|value| value.strategy.as_ref());
        let idempotent = options.is_some_and(|value| value.idempotency_key.is_some() || matches!(value.strategy, Some(RequestStrategy::Idempotent(_))));
        let safe = matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS) || idempotent;
        let attempts = match strategy {
            Some(RequestStrategy::Once) => 1,
            Some(RequestStrategy::Retry { max_attempts }) | Some(RequestStrategy::ExponentialBackoff { max_attempts }) => (*max_attempts).max(1),
            Some(RequestStrategy::Idempotent(_)) => self.inner.max_retries.saturating_add(1),
            None if safe => self.inner.max_retries.saturating_add(1),
            None => 1,
        };
        for attempt in 0..attempts {
            match self.inner.transport.execute(request.clone()).await {
                Ok(response) => {
                    let retryable = response.status.as_u16() == 429 || response.status.is_server_error();
                    if retryable && attempt + 1 < attempts {
                        let delay = retry_after(&response.headers).unwrap_or_else(|| Duration::from_millis(100_u64.saturating_mul(1_u64 << attempt.min(6))));
                        if !matches!(strategy, Some(RequestStrategy::Retry { .. })) { tokio::time::sleep(delay).await; }
                        continue;
                    }
                    return Ok(response);
                }
                Err(error) if error.is_retryable() && attempt + 1 < attempts => continue,
                Err(error) => return Err(Error::Network(error)),
            }
        }
        Err(Error::Builder("request retry loop terminated unexpectedly".to_string()))
    }
}

impl ClientBuilder {
    /// Set the generic bearer credential.
    pub fn token(mut self, value: impl Into<String>) -> Self { self.token = Some(static_credential(value)); self }
    /// Set the generic API-key credential.
    pub fn api_key(mut self, value: impl Into<String>) -> Self {
        let value = value.into();
        self.static_api_key = value.clone();
        self.api_key = Some(static_credential(value));
        self
    }
    /// Set a bearer provider.
    pub fn token_provider(mut self, provider: SharedCredentialProvider) -> Self { self.token = Some(provider); self }
    /// Set an API-key provider.
    pub fn api_key_provider(mut self, provider: SharedCredentialProvider) -> Self { self.api_key = Some(provider); self }
    /// Set a named security-scheme provider.
    pub fn credential_provider(mut self, scheme: impl Into<String>, provider: SharedCredentialProvider) -> Self { self.named.insert(scheme.into(), provider); self }
    /// Set a named static credential.
    pub fn credential(self, scheme: impl Into<String>, value: impl Into<String>) -> Self { self.credential_provider(scheme, static_credential(value)) }
    /// Set the base URL.
    pub fn base_url(mut self, value: impl Into<String>) -> Self { self.base_url = Some(value.into()); self }
    /// Set the transport timeout.
    pub fn timeout(mut self, value: Duration) -> Self { self.timeout = Some(value); self }
    /// Set the retry budget. Defaults to zero.
    pub fn max_retries(mut self, value: u32) -> Self { self.max_retries = Some(value); self }
    /// Set a static client ID used by inferred fields.
    pub fn client_id(mut self, value: impl Into<String>) -> Self { self.client_id = value.into(); self }
    /// Set the User-Agent.
    pub fn user_agent(mut self, value: impl Into<String>) -> Self { self.user_agent = Some(value.into()); self }
    /// Inject a custom transport.
    pub fn transport(mut self, value: SharedTransport) -> Self { self.transport = Some(value); self }

    /// Validate configuration and build the client.
    pub fn build(self) -> Result<Client, Error> {
        let base_url = self.base_url.unwrap_or_else(|| DEFAULT_BASE_URL.to_string()).trim_end_matches('/').to_string();
        if !(base_url.starts_with("http://") || base_url.starts_with("https://")) { return Err(Error::Builder("base URL must be absolute HTTP(S)".to_string())); }
        let timeout = self.timeout.unwrap_or(DEFAULT_TIMEOUT);
        let transport = match self.transport {
            Some(value) => value,
            None => default_transport(timeout)?,
        };
        let mut headers = HeaderMap::new();
        headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
        let user_agent = self.user_agent.unwrap_or_else(|| ${rustString(userAgent)}.to_string());
        headers.insert(USER_AGENT, HeaderValue::from_str(&user_agent).map_err(|error| Error::Builder(format!("invalid user agent: {error}")))?);
        Ok(Client { inner: Arc::new(ClientInner {
            transport,
            base_url,
            max_retries: self.max_retries.unwrap_or(0),
            credentials: Credentials { token: self.token, api_key: self.api_key, named: self.named },
            api_key: self.static_api_key,
            client_id: self.client_id,
            default_headers: headers,
        }) })
    }
}

#[cfg(feature = "rustls-tls")]
fn default_transport(timeout: Duration) -> Result<SharedTransport, Error> {
    crate::transport::ReqwestTransport::with_timeout(timeout)
        .map(|transport| Arc::new(transport) as SharedTransport)
        .map_err(Error::Network)
}

#[cfg(not(feature = "rustls-tls"))]
fn default_transport(_timeout: Duration) -> Result<SharedTransport, Error> {
    Err(Error::Builder("no HTTP transport configured".to_string()))
}

fn retry_after(headers: &HeaderMap) -> Option<Duration> {
    headers.get(RETRY_AFTER)?.to_str().ok()?.parse::<u64>().ok().map(Duration::from_secs)
}

/// Percent-encode one dynamic URL path segment.
#[doc(hidden)]
pub fn path_segment(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for &byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => output.push(byte as char),
            _ => output.push_str(&format!("%{byte:02X}")),
        }
    }
    output
}
`;
}

function renderLib(options: NativeRuntimeOptions): string {
  return `#![forbid(unsafe_code)]
//! Generated ${options.productDisplayName} API SDK.
//!
//! Build a Client with Client::builder, configure static or refreshable
//! credentials, then call a typed resource accessor.

pub mod auth;
pub mod client;
pub mod enums;
pub mod error;
pub mod models;
pub mod optional_nullable;
pub mod pagination;
pub mod query;
pub mod resources;
pub mod resources_api;
pub mod secret;
pub mod transport;

pub use auth::{CredentialContext, CredentialFuture, CredentialProvider, CredentialProviderError, SharedCredentialProvider, credential_provider, static_credential};
pub use client::{Client, ClientBuilder, DEFAULT_BASE_URL, RequestOptions, RequestStrategy};
#[allow(unused_imports)]
pub use enums::*;
pub use error::{ApiError, Error, ErrorKind};
pub use models::*;
pub use optional_nullable::OptionalNullable;
pub use pagination::{ListMetadata, Page, auto_paginate};
pub use resources::*;
pub use secret::SecretString;
`;
}

function renderCargo(options: NativeRuntimeOptions, libraryName: string): string {
  return `[package]
name = ${JSON.stringify(options.packageName)}
version = ${JSON.stringify(options.sdkVersion)}
edition = "2024"
rust-version = "1.88"
description = ${JSON.stringify(`Generated ${options.productDisplayName} API SDK`)}
license = "MIT"
homepage = "https://signalflare.ai"
documentation = "https://docs.rs/${options.packageName}"

[lib]
name = ${JSON.stringify(libraryName)}
path = "src/lib.rs"

[features]
default = ["rustls-tls"]
rustls-tls = ["dep:reqwest", "reqwest/rustls-tls"]

[dependencies]
async-trait = "0.1"
bytes = "1"
futures-util = { version = "0.3", default-features = false, features = ["std"] }
http = "1"
reqwest = { version = "0.12", default-features = false, optional = true }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
tokio = { version = "1", features = ["time"] }

[dev-dependencies]
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
wiremock = "0.6"

[lints.rust]
unsafe_code = "forbid"

[lints.clippy]
unwrap_used = "warn"
expect_used = "warn"
dbg_macro = "warn"
todo = "warn"
`;
}

export function generateRustRuntime(
  options: NativeRuntimeOptions,
  libraryName: string,
): GeneratedFile[] {
  return [
    { path: "src/auth.rs", content: renderAuth(options) },
    { path: "src/client.rs", content: renderClient(options) },
    { path: "src/error.rs", content: renderError() },
    { path: "src/transport.rs", content: renderTransport() },
    { path: "src/transport/reqwest_impl.rs", content: renderReqwestTransport() },
    { path: "src/query.rs", content: renderQuery() },
    { path: "src/pagination.rs", content: renderPagination() },
    { path: "src/optional_nullable.rs", content: renderOptionalNullable() },
    { path: "src/secret.rs", content: renderSecret() },
    { path: "src/lib.rs", content: renderLib(options) },
    { path: "Cargo.toml", content: renderCargo(options, libraryName) },
    { path: "THIRD_PARTY_NOTICES.md", content: thirdPartyNotices() },
  ].map((file) => ({
    ...file,
    ...(file.path === "Cargo.toml"
      ? { skipIfExists: true, overwriteExisting: false }
      : { overwriteExisting: true }),
    ...(file.path.endsWith(".rs") ? {} : { headerPlacement: "skip" as const }),
  }));
}
