package runtime_conformance_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	sdk "github.com/signalflare-ai/runtime-conformance-go"
)

type capturedRequest struct {
	method  string
	path    string
	rawPath string
	query   map[string][]string
	header  http.Header
	body    []byte
}

func responseBody(path string) string {
	switch {
	case strings.HasPrefix(path, "/widgets/"):
		return `{"id":"00000000-0000-0000-0000-000000000000","name":"Widget","createdAt":"2026-01-01T00:00:00.000Z"}`
	case path == "/jobs":
		return `{"id":"00000000-0000-0000-0000-000000000000","state":"queued"}`
	case path == "/health":
		return `{"status":"ok"}`
	default:
		return `{"accepted":true}`
	}
}

func testClient(t *testing.T, options ...sdk.ClientOption) (*sdk.Client, <-chan capturedRequest) {
	t.Helper()
	requests := make(chan capturedRequest, 2)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read request: %v", err)
		}
		requests <- capturedRequest{
			method: request.Method,
			path: request.URL.Path,
			rawPath: request.URL.EscapedPath(),
			query: request.URL.Query(),
			header: request.Header.Clone(),
			body: body,
		}
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte(responseBody(request.URL.Path)))
	}))
	t.Cleanup(server.Close)
	allOptions := append([]sdk.ClientOption{sdk.WithBaseURL(server.URL)}, options...)
	client, err := sdk.NewClientWithOptions(allOptions...)
	if err != nil {
		t.Fatalf("build client: %v", err)
	}
	return client, requests
}

func TestSharedAuthAndWireVectors(t *testing.T) {
	ctx := context.Background()

	client, requests := testClient(t, sdk.WithToken("authkit-token"))
	_, err := client.Widgets().Get(
		ctx,
		"widget/123",
		&sdk.WidgetsGetParams{IncludeHistory: boolPointer(true)},
		sdk.WithExtraHeaders(http.Header{"X-Trace-Mode": []string{"verbose"}}),
	)
	if err != nil { t.Fatalf("get widget: %v", err) }
	request := <-requests
	if request.method != "GET" || request.rawPath != "/widgets/widget%2F123" { t.Fatalf("unexpected widget request: %#v", request) }
	if got := request.query["include_history"]; len(got) != 1 || got[0] != "true" { t.Fatalf("unexpected query: %#v", request.query) }
	if request.header.Get("Authorization") != "Bearer authkit-token" { t.Fatalf("missing bearer auth") }
	if request.header.Get("X-Trace-Mode") != "verbose" { t.Fatalf("missing trace header") }

	client, requests = testClient(t, sdk.WithAPIKey("header-secret"))
	_, err = client.Jobs().Create(ctx, &sdk.JobsCreateParams{RequiredValue: "required", RequiredNullable: nil})
	if err != nil { t.Fatalf("create job: %v", err) }
	request = <-requests
	if request.header.Get("X-API-Key") != "header-secret" { t.Fatalf("missing header key") }
	var body map[string]any
	if err := json.Unmarshal(request.body, &body); err != nil { t.Fatalf("decode body: %v", err) }
	if value, present := body["requiredNullable"]; !present || value != nil { t.Fatalf("required null missing: %#v", body) }
	if _, present := body["optionalNullable"]; present { t.Fatalf("optional null should be omitted: %#v", body) }

	present := "present"
	client.Jobs().Create(ctx, &sdk.JobsCreateParams{
		RequiredValue: "required", RequiredNullable: &present, OptionalValue: &present,
		Tags: []string{"one", "two"}, NullFields: []string{"optionalNullable"},
	})
	request = <-requests
	if err := json.Unmarshal(request.body, &body); err != nil { t.Fatalf("decode body: %v", err) }
	if value, present := body["optionalNullable"]; !present || value != nil { t.Fatalf("explicit null missing: %#v", body) }

	client, requests = testClient(t, sdk.WithAPIKey("query-secret"))
	_, err = client.Authentication().VerifyQueryKey(ctx)
	if err != nil { t.Fatalf("query key: %v", err) }
	request = <-requests
	if len(request.query["api_key"]) != 1 || request.query["api_key"][0] != "query-secret" || request.header.Get("Authorization") != "" { t.Fatalf("query auth mismatch: %#v", request) }

	client, requests = testClient(t, sdk.WithAPIKey("cookie secret"))
	_, err = client.Authentication().VerifyCookieKey(ctx)
	if err != nil { t.Fatalf("cookie key: %v", err) }
	request = <-requests
	if request.header.Get("Cookie") != "session_key=cookie%20secret" { t.Fatalf("cookie auth mismatch: %q", request.header.Get("Cookie")) }

	client, requests = testClient(t, sdk.WithToken("authkit-token"), sdk.WithAPIKey("header-secret"))
	_, err = client.Authentication().VerifyCombinedCredentials(ctx)
	if err != nil { t.Fatalf("combined auth: %v", err) }
	request = <-requests
	if request.header.Get("Authorization") != "Bearer authkit-token" || request.header.Get("X-API-Key") != "header-secret" { t.Fatalf("combined auth mismatch") }

	client, requests = testClient(t, sdk.WithToken("authkit-token"), sdk.WithAPIKey("unused"))
	_, err = client.Authentication().VerifyAlternativeCredentials(ctx)
	if err != nil { t.Fatalf("alternative auth: %v", err) }
	request = <-requests
	if request.header.Get("Authorization") == "" || request.header.Get("X-API-Key") != "" { t.Fatalf("first alternative not selected") }

	client, requests = testClient(t, sdk.WithAPIKey("fallback"))
	_, err = client.Authentication().VerifyAlternativeCredentials(ctx)
	if err != nil { t.Fatalf("fallback auth: %v", err) }
	request = <-requests
	if request.header.Get("X-API-Key") != "fallback" || request.header.Get("Authorization") != "" { t.Fatalf("fallback mismatch") }

	client, requests = testClient(t, sdk.WithToken("must-not-leak"), sdk.WithAPIKey("must-not-leak"))
	_, err = client.System().GetHealth(ctx)
	if err != nil { t.Fatalf("anonymous call: %v", err) }
	request = <-requests
	if request.header.Get("Authorization") != "" || request.header.Get("X-API-Key") != "" || request.header.Get("Cookie") != "" { t.Fatalf("credential leaked to anonymous operation") }
}

func TestCredentialProviderAndManagedHeaders(t *testing.T) {
	var received sdk.CredentialContext
	client, requests := testClient(t, sdk.WithTokenProvider(func(_ context.Context, value sdk.CredentialContext) (string, error) {
		received = value
		return "fresh-token", nil
	}))
	_, err := client.Widgets().Get(context.Background(), "widget", &sdk.WidgetsGetParams{}, sdk.WithExtraHeaders(http.Header{"Authorization": []string{"Bearer stale"}}))
	if err != nil { t.Fatalf("provider request: %v", err) }
	request := <-requests
	if request.header.Get("Authorization") != "Bearer fresh-token" { t.Fatalf("custom header replaced managed auth") }
	if received.OperationID != "getWidget" || received.Path != "/widgets/{widget_id}" || received.Scheme != "BearerAuth" { t.Fatalf("provider context mismatch: %#v", received) }
}

func TestErrorDecodeMissingAndBoundedBody(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls++
		switch request.URL.Path {
		case "/widgets/decode":
			writer.WriteHeader(http.StatusOK)
			_, _ = writer.Write([]byte("{not-json"))
		case "/widgets/large":
			writer.WriteHeader(http.StatusInternalServerError)
			_, _ = writer.Write([]byte(strings.Repeat("x", 70000)))
		default:
			writer.Header().Set("X-Request-ID", "request_123")
			writer.WriteHeader(http.StatusNotFound)
			_, _ = writer.Write([]byte(`{"code":"widget_not_found","message":"Widget not found","details":{"widgetId":"widget_123"}}`))
		}
	}))
	defer server.Close()

	client, err := sdk.NewClientWithOptions(sdk.WithBaseURL(server.URL), sdk.WithToken("token"))
	if err != nil { t.Fatalf("build client: %v", err) }
	_, err = client.Widgets().Get(context.Background(), "widget", &sdk.WidgetsGetParams{})
	var notFound *sdk.NotFoundError
	if !errors.As(err, &notFound) { t.Fatalf("expected NotFoundError, got %v", err) }
	if notFound.Code != "widget_not_found" || notFound.RequestID != "request_123" { t.Fatalf("structured error mismatch: %#v", notFound.APIError) }
	if details, ok := notFound.Details.(map[string]any); !ok || details["widgetId"] != "widget_123" { t.Fatalf("details mismatch: %#v", notFound.Details) }

	client, _ = sdk.NewClientWithOptions(sdk.WithBaseURL(server.URL), sdk.WithToken("token"))
	_, err = client.Widgets().Get(context.Background(), "decode", &sdk.WidgetsGetParams{})
	var decode *sdk.ResponseDecodeError
	if !errors.As(err, &decode) { t.Fatalf("expected decode error, got %v", err) }

	client, _ = sdk.NewClientWithOptions(sdk.WithBaseURL(server.URL), sdk.WithToken("token"))
	_, err = client.Widgets().Get(context.Background(), "large", &sdk.WidgetsGetParams{})
	var apiError *sdk.APIError
	if !errors.As(err, &apiError) || len(apiError.RawBody) != 64*1024 { t.Fatalf("error body was not bounded: %d", len(apiError.RawBody)) }

	before := calls
	missing, _ := sdk.NewClientWithOptions(sdk.WithBaseURL(server.URL))
	_, err = missing.Widgets().Get(context.Background(), "widget", &sdk.WidgetsGetParams{})
	var missingCredential *sdk.MissingCredentialError
	if !errors.As(err, &missingCredential) { t.Fatalf("expected missing credential, got %v", err) }
	if calls != before { t.Fatalf("missing credentials performed network I/O") }
}

func boolPointer(value bool) *bool { return &value }
