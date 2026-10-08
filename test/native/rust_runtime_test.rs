#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use bytes::Bytes;
use http::{HeaderMap, HeaderValue, StatusCode};
use runtimeconformance::{
    Client, CreateJobRequest, Error, ErrorKind, OptionalNullable, credential_provider,
    jobs::CreateJobParams,
    transport::{HttpRequest, HttpResponse, HttpTransport, SharedTransport, TransportError},
    widgets::GetWidgetParams,
};

#[derive(Clone)]
struct RecordingTransport {
    requests: Arc<Mutex<Vec<HttpRequest>>>,
    responder: Arc<dyn Fn(&HttpRequest) -> HttpResponse + Send + Sync>,
}

#[async_trait]
impl HttpTransport for RecordingTransport {
    async fn execute(&self, request: HttpRequest) -> Result<HttpResponse, TransportError> {
        let response = (self.responder)(&request);
        self.requests.lock().unwrap().push(request);
        Ok(response)
    }
}

fn json_response(status: StatusCode, body: &str) -> HttpResponse {
    HttpResponse { status, headers: HeaderMap::new(), body: Bytes::copy_from_slice(body.as_bytes()) }
}

fn success_response(request: &HttpRequest) -> HttpResponse {
    let path = request.url.split('?').next().unwrap();
    if path.contains("/widgets/") {
        json_response(StatusCode::OK, r#"{"id":"00000000-0000-0000-0000-000000000000","name":"Widget","createdAt":"2026-01-01T00:00:00.000Z"}"#)
    } else if path.ends_with("/jobs") {
        json_response(StatusCode::CREATED, r#"{"id":"00000000-0000-0000-0000-000000000000","state":"queued"}"#)
    } else if path.ends_with("/health") {
        json_response(StatusCode::OK, r#"{"status":"ok"}"#)
    } else {
        json_response(StatusCode::OK, r#"{"accepted":true}"#)
    }
}

fn client_with(
    configure: impl FnOnce(runtimeconformance::ClientBuilder) -> runtimeconformance::ClientBuilder,
) -> (Client, Arc<Mutex<Vec<HttpRequest>>>) {
    let requests = Arc::new(Mutex::new(Vec::new()));
    let transport: SharedTransport = Arc::new(RecordingTransport {
        requests: requests.clone(),
        responder: Arc::new(success_response),
    });
    let client = configure(Client::builder().transport(transport).base_url("https://runtime.test"))
        .build()
        .expect("build test client");
    (client, requests)
}

fn last_request(requests: &Arc<Mutex<Vec<HttpRequest>>>) -> HttpRequest {
    requests.lock().unwrap().last().expect("recorded request").clone()
}

#[tokio::test]
async fn shared_auth_and_wire_vectors() {
    let (client, requests) = client_with(|builder| builder.token("authkit-token"));
    let options = runtimeconformance::RequestOptions::new().header(
        http::HeaderName::from_static("x-trace-mode"),
        HeaderValue::from_static("verbose"),
    );
    client.widgets().get_widget_with_options(
        "widget/123",
        GetWidgetParams { include_history: Some(true), x_trace_mode: None },
        Some(&options),
    ).await.expect("get widget");
    let request = last_request(&requests);
    assert!(request.url.contains("/widgets/widget%2F123"));
    assert!(request.url.contains("include_history=true"));
    assert_eq!(request.headers[http::header::AUTHORIZATION], "Bearer authkit-token");
    assert_eq!(request.headers["x-trace-mode"], "verbose");

    let (client, requests) = client_with(|builder| builder.api_key("header-secret"));
    let body = CreateJobRequest {
        required_value: "required".to_string(),
        optional_value: None,
        required_nullable: None,
        optional_nullable: OptionalNullable::Missing,
        tags: None,
    };
    client.jobs().create_job(CreateJobParams::new(body)).await.expect("create job");
    let request = last_request(&requests);
    assert_eq!(request.headers["x-api-key"], "header-secret");
    let payload: serde_json::Value = serde_json::from_slice(request.body.as_ref().expect("body")).expect("json body");
    assert_eq!(payload["requiredNullable"], serde_json::Value::Null);
    assert!(payload.get("optionalNullable").is_none());

    let body = CreateJobRequest {
        required_value: "required".to_string(),
        optional_value: Some("present".to_string()),
        required_nullable: Some("present".to_string()),
        optional_nullable: OptionalNullable::Null,
        tags: Some(vec!["one".to_string(), "two".to_string()]),
    };
    client.jobs().create_job(CreateJobParams::new(body)).await.expect("create explicit null");
    let request = last_request(&requests);
    let payload: serde_json::Value = serde_json::from_slice(request.body.as_ref().expect("body")).expect("json body");
    assert_eq!(payload["optionalNullable"], serde_json::Value::Null);

    let (client, requests) = client_with(|builder| builder.api_key("query-secret"));
    client.authentication().verify_query_key().await.expect("query auth");
    let request = last_request(&requests);
    assert!(request.url.contains("api_key=query-secret"));
    assert!(!request.headers.contains_key(http::header::AUTHORIZATION));

    let (client, requests) = client_with(|builder| builder.api_key("cookie secret"));
    client.authentication().verify_cookie_key().await.expect("cookie auth");
    assert_eq!(last_request(&requests).headers[http::header::COOKIE], "session_key=cookie%20secret");

    let (client, requests) = client_with(|builder| builder.token("authkit-token").api_key("header-secret"));
    client.authentication().verify_combined_credentials().await.expect("combined auth");
    let request = last_request(&requests);
    assert_eq!(request.headers[http::header::AUTHORIZATION], "Bearer authkit-token");
    assert_eq!(request.headers["x-api-key"], "header-secret");

    let (client, requests) = client_with(|builder| builder.token("authkit-token").api_key("unused"));
    client.authentication().verify_alternative_credentials().await.expect("first auth alternative");
    let request = last_request(&requests);
    assert!(request.headers.contains_key(http::header::AUTHORIZATION));
    assert!(!request.headers.contains_key("x-api-key"));

    let (client, requests) = client_with(|builder| builder.api_key("fallback"));
    client.authentication().verify_alternative_credentials().await.expect("fallback auth");
    let request = last_request(&requests);
    assert_eq!(request.headers["x-api-key"], "fallback");
    assert!(!request.headers.contains_key(http::header::AUTHORIZATION));

    let (client, requests) = client_with(|builder| builder.token("must-not-leak").api_key("must-not-leak"));
    client.system().get_health().await.expect("anonymous operation");
    let request = last_request(&requests);
    assert!(!request.headers.contains_key(http::header::AUTHORIZATION));
    assert!(!request.headers.contains_key("x-api-key"));
    assert!(!request.headers.contains_key(http::header::COOKIE));
}

#[tokio::test]
async fn async_provider_receives_context_and_managed_auth_wins() {
    let contexts = Arc::new(Mutex::new(Vec::new()));
    let captured = contexts.clone();
    let provider = credential_provider(move |context| {
        let value = (context.operation_id.map(str::to_string), context.path.to_string(), context.scheme.to_string());
        captured.lock().unwrap().push(value);
        Box::pin(async { Ok(Some("fresh-token".to_string())) })
    });
    let (client, requests) = client_with(|builder| builder.token_provider(provider));
    let options = runtimeconformance::RequestOptions::new().header(
        http::header::AUTHORIZATION,
        HeaderValue::from_static("Bearer stale"),
    );
    client.widgets().get_widget_with_options("widget", GetWidgetParams::default(), Some(&options)).await.expect("provider auth");
    assert_eq!(last_request(&requests).headers[http::header::AUTHORIZATION], "Bearer fresh-token");
    assert_eq!(contexts.lock().unwrap()[0], (Some("getWidget".to_string()), "/widgets/{widget_id}".to_string(), "BearerAuth".to_string()));
}

#[tokio::test]
async fn structured_decode_missing_and_bounded_errors() {
    let requests = Arc::new(Mutex::new(Vec::new()));
    let transport: SharedTransport = Arc::new(RecordingTransport {
        requests: requests.clone(),
        responder: Arc::new(|request| {
            if request.url.contains("decode") {
                json_response(StatusCode::OK, "{not-json")
            } else if request.url.contains("large") {
                json_response(StatusCode::INTERNAL_SERVER_ERROR, &"x".repeat(70000))
            } else {
                let mut response = json_response(StatusCode::NOT_FOUND, r#"{"code":"widget_not_found","message":"Widget not found","details":{"widgetId":"widget_123"}}"#);
                response.headers.insert("x-request-id", HeaderValue::from_static("request_123"));
                response
            }
        }),
    });
    let client = Client::builder().transport(transport).base_url("https://runtime.test").token("token").build().expect("client");

    let error = client.widgets().get_widget("missing", GetWidgetParams::default()).await.expect_err("not found");
    let api = error.api().expect("api error");
    assert_eq!(api.status, 404);
    assert_eq!(api.code.as_deref(), Some("widget_not_found"));
    assert_eq!(api.request_id.as_deref(), Some("request_123"));
    assert_eq!(api.details.as_ref().and_then(|value| value.get("widgetId")).and_then(serde_json::Value::as_str), Some("widget_123"));

    let error = client.widgets().get_widget("decode", GetWidgetParams::default()).await.expect_err("decode error");
    assert_eq!(error.kind(), ErrorKind::ResponseDecode);
    assert_eq!(error.status(), Some(200));

    let error = client.widgets().get_widget("large", GetWidgetParams::default()).await.expect_err("large error");
    assert_eq!(error.api().expect("api error").raw_body.len(), 64 * 1024);

    let before = requests.lock().unwrap().len();
    let missing = Client::builder().transport(Arc::new(RecordingTransport {
        requests: requests.clone(), responder: Arc::new(success_response),
    })).base_url("https://runtime.test").build().expect("missing client");
    let error = missing.widgets().get_widget("widget", GetWidgetParams::default()).await.expect_err("missing credential");
    assert!(matches!(error, Error::MissingCredential { .. }));
    assert_eq!(requests.lock().unwrap().len(), before);
}

#[test]
fn client_is_clone_send_sync_and_optional_nullable_has_three_states() {
    fn assert_client<T: Clone + Send + Sync>() {}
    assert_client::<Client>();

    #[derive(serde::Serialize)]
    struct Body {
        #[serde(skip_serializing_if = "OptionalNullable::is_missing")]
        value: OptionalNullable<String>,
    }
    assert_eq!(serde_json::to_string(&Body { value: OptionalNullable::Missing }).unwrap(), "{}");
    assert_eq!(serde_json::to_string(&Body { value: OptionalNullable::Null }).unwrap(), r#"{"value":null}"#);
    assert_eq!(serde_json::to_string(&Body { value: OptionalNullable::Value("x".to_string()) }).unwrap(), r#"{"value":"x"}"#);
}
