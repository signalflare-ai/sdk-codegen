import type { GeneratedFile } from "@workos/oagen";
import { thirdPartyNotices, type NativeRuntimeOptions } from "../runtime-options.js";

function goString(value: string): string {
  return JSON.stringify(value);
}

function renderAuth(options: NativeRuntimeOptions): string {
  const schemes = options.authPlan.schemes
    .map((scheme) => {
      if (scheme.kind === "bearer") {
        return `{id: ${goString(scheme.id)}, kind: authBearer},`;
      }
      return `{id: ${goString(scheme.id)}, kind: authAPIKey, location: ${goString(scheme.in)}, name: ${goString(scheme.name)}},`;
    })
    .join("\n\t\t");
  const alternatives = (items: readonly { readonly schemes: readonly string[] }[]) =>
    items.map((item) => `{schemes: []string{${item.schemes.map(goString).join(", ")}}}`).join(", ");
  const operations = options.authPlan.operations
    .map(
      (operation) =>
        `{method: ${goString(operation.method)}, path: ${goString(operation.path)}, operationID: ${goString(operation.operationId)}, alternatives: []authAlternative{${alternatives(operation.alternatives)}}},`,
    )
    .join("\n\t\t");

  return `package PLACEHOLDER

import (
	"context"
	"fmt"
	"net/url"
	"strings"
)

type authKind uint8

const (
	authBearer authKind = iota
	authAPIKey
)

type authScheme struct {
	id       string
	kind     authKind
	location string
	name     string
}

type authAlternative struct {
	schemes []string
}

type authOperation struct {
	method       string
	path         string
	operationID  string
	alternatives []authAlternative
}

type authPlan struct {
	schemes    []authScheme
	defaults   []authAlternative
	operations []authOperation
}

var sdkAuthPlan = authPlan{
	schemes: []authScheme{
		${schemes}
	},
	defaults: []authAlternative{${alternatives(options.authPlan.defaults)}},
	operations: []authOperation{
		${operations}
	},
}

// CredentialContext describes the operation requesting a credential.
type CredentialContext struct {
	Method      string
	Path        string
	OperationID string
	Scheme      string
}

// CredentialProvider resolves a credential immediately before a request.
type CredentialProvider func(context.Context, CredentialContext) (string, error)

type resolvedAuth struct {
	headers map[string]string
	query   url.Values
}

func pathMatches(template, actual string) bool {
	expected := strings.Split(strings.Trim(template, "/"), "/")
	received := strings.Split(strings.Trim(actual, "/"), "/")
	if len(expected) != len(received) {
		return false
	}
	for index, part := range expected {
		if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
			continue
		}
		if part != received[index] {
			return false
		}
	}
	return true
}

func (c *Client) resolveAuth(ctx context.Context, method, path string) (resolvedAuth, error) {
	var operation *authOperation
	for index := range sdkAuthPlan.operations {
		candidate := &sdkAuthPlan.operations[index]
		if candidate.method == strings.ToUpper(method) && pathMatches(candidate.path, path) {
			operation = candidate
			break
		}
	}
	alternatives := sdkAuthPlan.defaults
	if operation != nil {
		alternatives = operation.alternatives
	}
	if len(alternatives) == 0 {
		return resolvedAuth{headers: map[string]string{}, query: url.Values{}}, nil
	}
	schemes := make(map[string]authScheme, len(sdkAuthPlan.schemes))
	for _, scheme := range sdkAuthPlan.schemes {
		schemes[scheme.id] = scheme
	}
	for _, alternative := range alternatives {
		result := resolvedAuth{headers: map[string]string{}, query: url.Values{}}
		complete := true
		for _, schemeID := range alternative.schemes {
			scheme, ok := schemes[schemeID]
			if !ok {
				complete = false
				break
			}
			provider := c.credentialProviders[schemeID]
			if provider == nil {
				if scheme.kind == authBearer {
					provider = c.tokenProvider
				} else {
					provider = c.apiKeyProvider
				}
			}
			if provider == nil {
				complete = false
				break
			}
			operationID := ""
			template := path
			if operation != nil {
				operationID = operation.operationID
				template = operation.path
			}
			value, err := provider(ctx, CredentialContext{
				Method: strings.ToUpper(method), Path: template, OperationID: operationID, Scheme: schemeID,
			})
			if err != nil {
				return resolvedAuth{}, fmt.Errorf("resolve credential %q: %w", schemeID, err)
			}
			if value == "" {
				complete = false
				break
			}
			switch {
			case scheme.kind == authBearer:
				result.headers["Authorization"] = "Bearer " + value
			case scheme.location == "header":
				result.headers[scheme.name] = value
			case scheme.location == "query":
				result.query.Add(scheme.name, value)
			case scheme.location == "cookie":
				cookie := scheme.name + "=" + encodeCookieValue(value)
				if existing := result.headers["Cookie"]; existing != "" {
					result.headers["Cookie"] = existing + "; " + cookie
				} else {
					result.headers["Cookie"] = cookie
				}
			}
		}
		if complete {
			return result, nil
		}
	}
	operationID := ""
	if operation != nil {
		operationID = operation.operationID
	}
	acceptable := make([][]string, 0, len(alternatives))
	for _, alternative := range alternatives {
		acceptable = append(acceptable, append([]string(nil), alternative.schemes...))
	}
	return resolvedAuth{}, &MissingCredentialError{OperationID: operationID, Alternatives: acceptable}
}

func encodeCookieValue(value string) string {
	var result strings.Builder
	for _, b := range []byte(value) {
		switch {
		case b >= 'a' && b <= 'z', b >= 'A' && b <= 'Z', b >= '0' && b <= '9', b == '-', b == '.', b == '_', b == '~':
			result.WriteByte(b)
		default:
			fmt.Fprintf(&result, "%%%02X", b)
		}
	}
	return result.String()
}
`;
}

function renderOptions(options: NativeRuntimeOptions): string {
  return `package PLACEHOLDER

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

const (
	defaultBaseURL = ${goString(options.defaultBaseUrl)}
	defaultTimeout = 60 * time.Second
	defaultMaxRetries = 0
)

// Logger receives credential-free request lifecycle messages.
type Logger interface {
	Printf(format string, args ...any)
}

// ClientOption configures a client.
type ClientOption func(*Client)

// WithBaseURL overrides the contract's default server.
func WithBaseURL(value string) ClientOption { return func(client *Client) { client.baseURL = value } }

// WithHTTPClient injects the HTTP client and RoundTripper used for requests.
func WithHTTPClient(value *http.Client) ClientOption { return func(client *Client) { client.httpClient = value } }

// WithToken configures the generic bearer credential.
func WithToken(value string) ClientOption {
	return func(client *Client) {
		client.token = value
		client.tokenProvider = staticCredential(value)
	}
}

// WithAPIKey configures the generic API-key credential.
func WithAPIKey(value string) ClientOption {
	return func(client *Client) {
		client.apiKey = value
		client.apiKeyProvider = staticCredential(value)
	}
}

// WithCredential sets a credential for one named OpenAPI security scheme.
func WithCredential(scheme, value string) ClientOption {
	return WithCredentialProvider(scheme, staticCredential(value))
}

// WithTokenProvider configures a context-aware bearer provider.
func WithTokenProvider(provider CredentialProvider) ClientOption {
	return func(client *Client) { client.tokenProvider = provider }
}

// WithAPIKeyProvider configures a context-aware API-key provider.
func WithAPIKeyProvider(provider CredentialProvider) ClientOption {
	return func(client *Client) { client.apiKeyProvider = provider }
}

// WithCredentialProvider sets a provider for one named OpenAPI security scheme.
func WithCredentialProvider(scheme string, provider CredentialProvider) ClientOption {
	return func(client *Client) {
		if client.credentialProviders == nil {
			client.credentialProviders = make(map[string]CredentialProvider)
		}
		client.credentialProviders[scheme] = provider
	}
}

// WithMaxRetries sets the retry budget for safe or explicitly idempotent calls.
func WithMaxRetries(value int) ClientOption {
	return func(client *Client) {
		if value < 0 { value = 0 }
		client.maxRetries = value
	}
}

// WithClientID sets a client field used by explicitly inferred contract parameters.
func WithClientID(value string) ClientOption { return func(client *Client) { client.clientID = value } }

// WithLogger installs a request lifecycle logger. Credentials and bodies are never logged.
func WithLogger(value Logger) ClientOption { return func(client *Client) { client.logger = value } }

// WithHeaders installs client-level headers. Runtime-managed auth wins on collision.
func WithHeaders(value http.Header) ClientOption {
	return func(client *Client) { client.headers = value.Clone() }
}

// NewClientWithOptions constructs and validates a client without legacy credential defaults.
func NewClientWithOptions(opts ...ClientOption) (*Client, error) {
	client := NewClient("", opts...)
	parsed, err := url.Parse(client.baseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("invalid base URL %q", client.baseURL)
	}
	if client.httpClient == nil {
		return nil, fmt.Errorf("HTTP client must not be nil")
	}
	return client, nil
}

func staticCredential(value string) CredentialProvider {
	return func(context.Context, CredentialContext) (string, error) { return value, nil }
}

// RequestOption configures one request.
type RequestOption func(*requestConfig)

type requestConfig struct {
	extraHeaders   http.Header
	timeout        time.Duration
	maxRetries     *int
	baseURL        string
	idempotencyKey string
}

// WithExtraHeaders adds per-request headers. Runtime-managed auth wins on collision.
func WithExtraHeaders(value http.Header) RequestOption {
	return func(request *requestConfig) { request.extraHeaders = value.Clone() }
}

// WithTimeout sets a per-request timeout.
func WithTimeout(value time.Duration) RequestOption {
	return func(request *requestConfig) { request.timeout = value }
}

// WithIdempotencyKey marks a request as safe to retry and sends the key.
func WithIdempotencyKey(value string) RequestOption {
	return func(request *requestConfig) { request.idempotencyKey = value }
}

// WithRequestMaxRetries overrides the retry budget for one request.
func WithRequestMaxRetries(value int) RequestOption {
	return func(request *requestConfig) {
		if value < 0 { value = 0 }
		request.maxRetries = &value
	}
}

// WithRequestBaseURL overrides the server for one request.
func WithRequestBaseURL(value string) RequestOption {
	return func(request *requestConfig) { request.baseURL = value }
}

type appInfo struct { Name, Version, URL string }

// WithAppInfo appends application identification to the SDK User-Agent.
func WithAppInfo(name, version, url string) ClientOption {
	return func(client *Client) { client.appInfo = appInfo{Name: name, Version: version, URL: url} }
}
`;
}

function renderErrors(): string {
  return `package PLACEHOLDER

import (
	"encoding/json"
	"fmt"
	"time"
)

// APIError is a structured non-successful API response.
type APIError struct {
	StatusCode int
	RequestID  string
	RetryAfter time.Duration
	RawBody    string
	Code       string
	Message    string
	Details    any
}

func (errorValue *APIError) Error() string {
	message := errorValue.Message
	if message == "" { message = errorValue.RawBody }
	if message == "" { message = httpStatusMessage(errorValue.StatusCode) }
	if errorValue.RequestID != "" {
		return fmt.Sprintf("API error %d: %s (request_id=%s)", errorValue.StatusCode, message, errorValue.RequestID)
	}
	return fmt.Sprintf("API error %d: %s", errorValue.StatusCode, message)
}

func httpStatusMessage(status int) string { return fmt.Sprintf("HTTP status %d", status) }

// MissingCredentialError means no configured credentials satisfy the operation.
type MissingCredentialError struct {
	OperationID string
	Alternatives [][]string
}

func (errorValue *MissingCredentialError) Error() string {
	operation := errorValue.OperationID
	if operation == "" { operation = "API request" }
	return "missing credentials for " + operation
}

// NetworkError wraps a transport failure.
type NetworkError struct { Err error }
func (errorValue *NetworkError) Error() string { return "network error: " + errorValue.Err.Error() }
func (errorValue *NetworkError) Unwrap() error { return errorValue.Err }

// ResponseDecodeError reports malformed successful JSON.
type ResponseDecodeError struct { StatusCode int; RawBody string; Err error }
func (errorValue *ResponseDecodeError) Error() string { return fmt.Sprintf("decode successful response %d: %v", errorValue.StatusCode, errorValue.Err) }
func (errorValue *ResponseDecodeError) Unwrap() error { return errorValue.Err }

type AuthenticationError struct { *APIError }
type AuthorizationError struct { *APIError }
type BadRequestError struct { *APIError }
type NotFoundError struct { *APIError }
type ConflictError struct { *APIError }
type UnprocessableEntityError struct { *APIError }
type RateLimitExceededError struct { *APIError }
type ServerError struct { *APIError }

func (errorValue *AuthenticationError) Unwrap() error { return errorValue.APIError }
func (errorValue *AuthorizationError) Unwrap() error { return errorValue.APIError }
func (errorValue *BadRequestError) Unwrap() error { return errorValue.APIError }
func (errorValue *NotFoundError) Unwrap() error { return errorValue.APIError }
func (errorValue *ConflictError) Unwrap() error { return errorValue.APIError }
func (errorValue *UnprocessableEntityError) Unwrap() error { return errorValue.APIError }
func (errorValue *RateLimitExceededError) Unwrap() error { return errorValue.APIError }
func (errorValue *ServerError) Unwrap() error { return errorValue.APIError }

func parseAPIError(status int, requestID, retryAfter string, body []byte) error {
	apiError := &APIError{StatusCode: status, RequestID: requestID, RawBody: string(body)}
	if retryAfter != "" {
		if duration, err := time.ParseDuration(retryAfter + "s"); err == nil { apiError.RetryAfter = duration }
	}
	var payload struct {
		Code string ${"`"}json:"code"${"`"}
		Error string ${"`"}json:"error"${"`"}
		Message string ${"`"}json:"message"${"`"}
		Description string ${"`"}json:"error_description"${"`"}
		Details any ${"`"}json:"details"${"`"}
	}
	if json.Unmarshal(body, &payload) == nil {
		apiError.Code = payload.Code
		if apiError.Code == "" { apiError.Code = payload.Error }
		apiError.Message = payload.Message
		if apiError.Message == "" { apiError.Message = payload.Description }
		apiError.Details = payload.Details
	}
	switch status {
	case 400: return &BadRequestError{apiError}
	case 401: return &AuthenticationError{apiError}
	case 403: return &AuthorizationError{apiError}
	case 404: return &NotFoundError{apiError}
	case 409: return &ConflictError{apiError}
	case 422: return &UnprocessableEntityError{apiError}
	case 429: return &RateLimitExceededError{apiError}
	default:
		if status >= 500 { return &ServerError{apiError} }
		return apiError
	}
}
`;
}

function renderClient(options: NativeRuntimeOptions): string {
  const sdk = `${options.productId}/${options.sdkVersion} (go; sdk-codegen/${options.compilerVersion})`;
  return `package PLACEHOLDER

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"math/rand/v2"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/go-querystring/query"
)

const maxErrorBodyLength = 64 * 1024

func isRetryableStatus(status int) bool {
	return status == 429 || status == 500 || status == 502 || status == 503 || status == 504
}

func (client *Client) request(
	ctx context.Context,
	method string,
	path string,
	queryParams any,
	body any,
	result any,
	opts []RequestOption,
) (*http.Response, error) {
	configuration := &requestConfig{}
	for _, option := range opts { option(configuration) }
	baseURL := client.baseURL
	if configuration.baseURL != "" { baseURL = configuration.baseURL }
	maxRetries := client.maxRetries
	if configuration.maxRetries != nil { maxRetries = *configuration.maxRetries }
	if method != http.MethodGet && method != http.MethodHead && method != http.MethodOptions && configuration.idempotencyKey == "" {
		maxRetries = 0
	}

	auth, err := client.resolveAuth(ctx, method, path)
	if err != nil { return nil, err }
	requestURL := strings.TrimRight(baseURL, "/") + path
	parsedURL, err := url.Parse(requestURL)
	if err != nil { return nil, fmt.Errorf("parse request URL: %w", err) }
	queryValues, err := encodeQuery(queryParams)
	if err != nil { return nil, err }
	mergedQuery := parsedURL.Query()
	for key, values := range queryValues {
		for _, value := range values { mergedQuery.Add(key, value) }
	}
	for key, values := range auth.query {
		for _, value := range values { mergedQuery.Add(key, value) }
	}
	parsedURL.RawQuery = mergedQuery.Encode()
	requestURL = parsedURL.String()

	var encodedBody []byte
	if body != nil {
		encodedBody, err = json.Marshal(body)
		if err != nil { return nil, fmt.Errorf("encode request body: %w", err) }
	}
	var lastError error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done(): return nil, ctx.Err()
			case <-time.After(retryDelay(attempt, lastError)):
			}
		}
		var reader io.Reader
		if encodedBody != nil { reader = bytes.NewReader(encodedBody) }
		request, requestError := http.NewRequestWithContext(ctx, method, requestURL, reader)
		if requestError != nil { return nil, fmt.Errorf("create request: %w", requestError) }
		for key, values := range client.headers {
			for _, value := range values { request.Header.Add(key, value) }
		}
		for key, values := range configuration.extraHeaders {
			request.Header.Del(key)
			for _, value := range values { request.Header.Add(key, value) }
		}
		request.Header.Set("Accept", "application/json")
		request.Header.Set("X-Signalflare-SDK", ${goString(sdk)})
		if encodedBody != nil { request.Header.Set("Content-Type", "application/json") }
		if configuration.idempotencyKey != "" { request.Header.Set("Idempotency-Key", configuration.idempotencyKey) }
		for key, value := range auth.headers { request.Header.Set(key, value) }

		httpClient := client.httpClient
		if configuration.timeout > 0 {
			copy := *httpClient
			copy.Timeout = configuration.timeout
			httpClient = &copy
		}
		started := time.Now()
		response, requestError := httpClient.Do(request)
		if requestError != nil {
			lastError = &NetworkError{Err: requestError}
			if client.logger != nil { client.logger.Printf("sdk: %s %s error=%v duration=%s", method, path, requestError, time.Since(started)) }
			if attempt < maxRetries { continue }
			return nil, lastError
		}
		if client.logger != nil { client.logger.Printf("sdk: %s %s status=%d duration=%s", method, path, response.StatusCode, time.Since(started)) }

		if response.StatusCode >= 400 {
			responseBody, readError := io.ReadAll(io.LimitReader(response.Body, maxErrorBodyLength+1))
			response.Body.Close()
			if readError != nil { return response, &NetworkError{Err: readError} }
			if len(responseBody) > maxErrorBodyLength { responseBody = responseBody[:maxErrorBodyLength] }
			lastError = parseAPIError(response.StatusCode, response.Header.Get("X-Request-ID"), response.Header.Get("Retry-After"), responseBody)
			if isRetryableStatus(response.StatusCode) && attempt < maxRetries { continue }
			return response, lastError
		}

		responseBody, readError := io.ReadAll(response.Body)
		response.Body.Close()
		if readError != nil { return response, &NetworkError{Err: readError} }
		if result != nil && response.StatusCode != http.StatusNoContent && len(bytes.TrimSpace(responseBody)) > 0 {
			if decodeError := json.Unmarshal(responseBody, result); decodeError != nil {
				raw := responseBody
				if len(raw) > maxErrorBodyLength { raw = raw[:maxErrorBodyLength] }
				return response, &ResponseDecodeError{StatusCode: response.StatusCode, RawBody: string(raw), Err: decodeError}
			}
		}
		return response, nil
	}
	return nil, lastError
}

func encodeQuery(params any) (url.Values, error) {
	if params == nil { return url.Values{}, nil }
	if values, ok := params.(url.Values); ok { return values, nil }
	values, err := query.Values(params)
	if err != nil { return nil, fmt.Errorf("encode query parameters: %w", err) }
	return values, nil
}

func (client *Client) buildURL(path string, values url.Values, opts []RequestOption) string {
	configuration := &requestConfig{}
	for _, option := range opts { option(configuration) }
	baseURL := client.baseURL
	if configuration.baseURL != "" { baseURL = configuration.baseURL }
	result := strings.TrimRight(baseURL, "/") + path
	if encoded := values.Encode(); encoded != "" { result += "?" + encoded }
	return result
}

func retryDelay(attempt int, lastError error) time.Duration {
	var apiError *APIError
	if errors.As(lastError, &apiError) && apiError.RetryAfter > 0 { return apiError.RetryAfter }
	base := 100 * time.Millisecond
	wait := time.Duration(float64(base) * math.Pow(2, float64(attempt-1))) + time.Duration(rand.Int64N(int64(base)))
	if wait > 5*time.Second { return 5*time.Second }
	return wait
}
`;
}

function renderPagination(): string {
  return `package PLACEHOLDER

import "context"

// Iterator lazily retrieves cursor-paginated results.
type Iterator[T any] struct {
	ctx context.Context
	client *Client
	method string
	path string
	params any
	cursorParam string
	dataPath string
	opts []RequestOption
	items []T
	current T
	after string
	err error
	done bool
}

func newIterator[T any](ctx context.Context, client *Client, method, path string, params any, cursorParam, dataPath string, opts []RequestOption, _ any) *Iterator[T] {
	return &Iterator[T]{ctx: ctx, client: client, method: method, path: path, params: params, cursorParam: cursorParam, dataPath: dataPath, opts: opts}
}

// Next advances to the next item.
func (iterator *Iterator[T]) Next() bool {
	for {
		if len(iterator.items) > 0 {
			iterator.current = iterator.items[0]
			iterator.items = iterator.items[1:]
			return true
		}
		if iterator.done || iterator.err != nil { return false }
		values, err := encodeQuery(iterator.params)
		if err != nil { iterator.err = err; return false }
		if iterator.after != "" { values.Set(iterator.cursorParam, iterator.after) }
		var payload struct {
			Data []T ${"`"}json:"data"${"`"}
			ListMetadata struct { After *string ${"`"}json:"after"${"`"} } ${"`"}json:"list_metadata"${"`"}
		}
		_, iterator.err = iterator.client.request(iterator.ctx, iterator.method, iterator.path, values, nil, &payload, iterator.opts)
		if iterator.err != nil { return false }
		iterator.items = payload.Data
		iterator.done = payload.ListMetadata.After == nil
		if payload.ListMetadata.After != nil { iterator.after = *payload.ListMetadata.After }
	}
}

// Current returns the current item. Call only after Next returns true.
func (iterator *Iterator[T]) Current() T { return iterator.current }

// Err returns the terminal iteration error.
func (iterator *Iterator[T]) Err() error { return iterator.err }
`;
}

function renderGoMod(options: NativeRuntimeOptions): string {
  return `module ${options.packageName}

go 1.23

require (
	github.com/google/go-querystring v1.1.0
	github.com/stretchr/testify v1.10.0
)
`;
}

export function generateGoRuntime(
  options: NativeRuntimeOptions,
  packageName: string,
): GeneratedFile[] {
  const withPackage = (content: string) =>
    content.replace("package PLACEHOLDER", `package ${packageName}`);
  return [
    { path: "auth.go", content: withPackage(renderAuth(options)) },
    { path: "client.go", content: withPackage(renderClient(options)) },
    { path: "errors.go", content: withPackage(renderErrors()) },
    { path: "options.go", content: withPackage(renderOptions(options)) },
    { path: "pagination.go", content: withPackage(renderPagination()) },
    { path: "go.mod", content: renderGoMod(options) },
    { path: "THIRD_PARTY_NOTICES.md", content: thirdPartyNotices() },
  ].map((file) => ({
    ...file,
    ...(file.path === "go.mod"
      ? { skipIfExists: true, overwriteExisting: false }
      : { overwriteExisting: true }),
  }));
}
