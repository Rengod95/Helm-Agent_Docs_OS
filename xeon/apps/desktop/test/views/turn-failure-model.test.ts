import { expect, test } from "bun:test";
import {
  providerOfModelRef,
  turnFailureOf,
  type TurnFailureView,
} from "../../src/views/turn-failure-model.ts";

const AUTH_JSON =
  '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_1"}';
const PERMISSION_JSON =
  '403 {"type":"error","error":{"type":"permission_error","message":"model not allowed"}}';
const OVERFLOW_JSON =
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 250000 tokens > 200000 maximum"}}';
const MISSING_KEY =
  "secret_unresolved: secret anthropic-api-key could not be leased (secret_missing)";
const HOST_MISMATCH =
  "secret_unresolved: secret k could not be leased (denied: host_mismatch, host=proxy.example.com)";

// 행: 실패 문장, 실패한 턴의 제공자, 기대 값. 기대 값은 종류, 문장 키, 단추, 자리 값, 정보 아이콘 뒤 사유 전부다
const ROWS: readonly (readonly [string, string | null, TurnFailureView])[] = [
  [
    AUTH_JSON,
    "anthropic",
    {
      kind: "auth",
      text: "desktop.turnFailure.auth",
      action: "change-key",
      params: { provider: "Anthropic" },
      detail: "invalid x-api-key",
    },
  ],
  [
    AUTH_JSON,
    null,
    {
      kind: "auth",
      text: "desktop.turnFailure.authAny",
      action: "change-key",
      detail: "invalid x-api-key",
    },
  ],
  [
    "401 unauthorized",
    "openai",
    {
      kind: "auth",
      text: "desktop.turnFailure.auth",
      action: "change-key",
      params: { provider: "OpenAI" },
      detail: "401 unauthorized",
    },
  ],
  [
    MISSING_KEY,
    "anthropic",
    {
      kind: "no_key",
      text: "desktop.turnFailure.noKey",
      action: "add-key",
      detail: MISSING_KEY,
    },
  ],
  [
    "secret_unresolved: no value stored",
    null,
    {
      kind: "no_key",
      text: "desktop.turnFailure.noKey",
      action: "add-key",
      detail: "secret_unresolved: no value stored",
    },
  ],
  [
    "secret_unresolved: secret anthropic-api-key could not be used (decrypt_failed)",
    "anthropic",
    {
      kind: "key_unusable",
      text: "desktop.turnFailure.keyUnusable",
      action: "change-key",
      detail: "secret_unresolved: secret anthropic-api-key could not be used (decrypt_failed)",
    },
  ],
  [
    "oauth_token_on_default_provider: provider anthropic does not accept subscription OAuth tokens",
    "anthropic",
    {
      kind: "key_unusable",
      text: "desktop.turnFailure.keyUnusable",
      action: "change-key",
      detail:
        "oauth_token_on_default_provider: provider anthropic does not accept subscription OAuth tokens",
    },
  ],
  [
    HOST_MISMATCH,
    "anthropic",
    {
      kind: "host_mismatch",
      text: "desktop.turnFailure.hostMismatch",
      action: "open-providers",
      params: { host: "proxy.example.com" },
      detail: HOST_MISMATCH,
    },
  ],
  [
    "secret_unresolved: secret k could not be leased (denied: host_mismatch)",
    null,
    {
      kind: "host_mismatch",
      text: "desktop.turnFailure.hostMismatchAny",
      action: "open-providers",
      detail: "secret_unresolved: secret k could not be leased (denied: host_mismatch)",
    },
  ],
  [
    PERMISSION_JSON,
    "anthropic",
    {
      kind: "permission_denied",
      text: "desktop.turnFailure.permissionDenied",
      action: "change-model",
      detail: "model not allowed",
    },
  ],
  [
    '402 {"type":"error","error":{"type":"billing_error","message":"Payment required"}}',
    "openai",
    {
      kind: "billing",
      text: "desktop.turnFailure.billing",
      action: null,
      detail: "Payment required",
    },
  ],
  [
    '429 {"type":"error","error":{"type":"insufficient_quota","message":"You exceeded your current quota"}}',
    "openai",
    {
      kind: "billing",
      text: "desktop.turnFailure.billing",
      action: null,
      detail: "You exceeded your current quota",
    },
  ],
  [
    '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the API."}}',
    "anthropic",
    {
      kind: "billing",
      text: "desktop.turnFailure.billing",
      action: null,
      detail: "Your credit balance is too low to access the API.",
    },
  ],
  [
    OVERFLOW_JSON,
    "anthropic",
    {
      kind: "context_overflow",
      text: "desktop.turnFailure.contextOverflow",
      action: "change-model",
      detail: "prompt is too long: 250000 tokens > 200000 maximum",
    },
  ],
  [
    '400 {"error":{"type":"invalid_request_error"}}',
    "anthropic",
    {
      kind: "bad_request",
      text: "desktop.turnFailure.badRequest",
      action: null,
      detail: '400 {"error":{"type":"invalid_request_error"}}',
    },
  ],
  [
    '404 {"error":{"type":"not_found_error","message":"model: x"}}',
    "anthropic",
    {
      kind: "model_not_found",
      text: "desktop.turnFailure.modelNotFound",
      action: "change-model",
      detail: "model: x",
    },
  ],
  [
    "model_not_found: anthropic/x",
    "anthropic",
    {
      kind: "model_not_found",
      text: "desktop.turnFailure.modelNotFound",
      action: "change-model",
      detail: "model_not_found: anthropic/x",
    },
  ],
  [
    "429 rate limit",
    "anthropic",
    {
      kind: "rate_limited",
      text: "desktop.turnFailure.rateLimited",
      action: "resend",
      detail: "429 rate limit",
    },
  ],
  [
    "429 rate_limit_error [retry-after=7]",
    "anthropic",
    {
      kind: "rate_limited",
      text: "desktop.turnFailure.rateLimitedWait",
      action: "resend",
      params: { seconds: "7" },
      detail: "429 rate_limit_error [retry-after=7]",
    },
  ],
  [
    '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
    "anthropic",
    {
      kind: "overloaded",
      text: "desktop.turnFailure.overloaded",
      action: "resend",
      detail: "Overloaded",
    },
  ],
  [
    "503 Service Unavailable",
    "anthropic",
    {
      kind: "overloaded",
      text: "desktop.turnFailure.overloaded",
      action: "resend",
      detail: "503 Service Unavailable",
    },
  ],
  [
    '500 {"error":{"type":"api_error","message":"Internal failure"}}',
    "anthropic",
    {
      kind: "server",
      text: "desktop.turnFailure.server",
      action: "resend",
      detail: "Internal failure",
    },
  ],
  [
    "504 Gateway Timeout",
    "anthropic",
    {
      kind: "timeout",
      text: "desktop.turnFailure.timeout",
      action: "resend",
      detail: "504 Gateway Timeout",
    },
  ],
  [
    "request timed out after 60s",
    "anthropic",
    {
      kind: "timeout",
      text: "desktop.turnFailure.timeout",
      action: "resend",
      detail: "request timed out after 60s",
    },
  ],
  [
    "Connection error.",
    "anthropic",
    {
      kind: "network",
      text: "desktop.turnFailure.network",
      action: "resend",
      detail: "Connection error.",
    },
  ],
  [
    "stream_interrupted: 529 overloaded_error",
    "anthropic",
    {
      kind: "interrupted",
      text: "desktop.turnFailure.interrupted",
      action: "resend",
      detail: "stream_interrupted: 529 overloaded_error",
    },
  ],
  [
    "뭔지 모를 오류",
    "anthropic",
    {
      kind: "unknown",
      text: "desktop.turnFailure.unknown",
      action: "resend",
      detail: "뭔지 모를 오류",
    },
  ],
  // 사유에 시크릿 모양이 있으면 가린다(JSON 본문과 본문 없는 문장 둘 다)
  [
    '401 {"type":"error","error":{"type":"authentication_error","message":"Incorrect key sk-ant-api03-EXAMPLEPLACEHOLDER"}}',
    "anthropic",
    {
      kind: "auth",
      text: "desktop.turnFailure.auth",
      action: "change-key",
      params: { provider: "Anthropic" },
      detail: "Incorrect key ••••",
    },
  ],
  [
    '500 {"error":{"message":"bad token EXAMPLEPLACEHOLDER1234EXAMPLE"}}',
    "anthropic",
    {
      kind: "server",
      text: "desktop.turnFailure.server",
      action: "resend",
      detail: "bad token ••••",
    },
  ],
  [
    "401 rejected: sk-proj-EXAMPLE123",
    "openai",
    {
      kind: "auth",
      text: "desktop.turnFailure.auth",
      action: "change-key",
      params: { provider: "OpenAI" },
      detail: "401 rejected: ••••",
    },
  ],
];

test("each failure text gives its kind, message key, button, values, and masked detail", () => {
  for (const [error, provider, expected] of ROWS) {
    expect([error, provider, turnFailureOf(error, provider)]).toStrictEqual([
      error,
      provider,
      expected,
    ]);
  }
});

test("no detail keeps a key-like string, whatever the row", () => {
  const keyLike = /sk-[A-Za-z0-9]|key-[A-Za-z0-9]{6,}|[A-Za-z0-9_-]{20,}\d/;
  for (const [error, provider] of ROWS) {
    expect([error, keyLike.test(turnFailureOf(error, provider).detail)]).toStrictEqual([
      error,
      false,
    ]);
  }
});

test("a 401 without a thread's provider says the provider, and names no provider", () => {
  const view = turnFailureOf(AUTH_JSON);
  expect([view.text, view.params]).toStrictEqual(["desktop.turnFailure.authAny", undefined]);
});

test("the thread's model reference gives its provider id", () => {
  expect(providerOfModelRef("fake-provider/model-x:high")).toBe("fake-provider");
  expect(providerOfModelRef("no-slash")).toBeNull();
  expect(providerOfModelRef("/leading")).toBeNull();
  expect(providerOfModelRef(null)).toBeNull();
});
