import { expect, test } from "bun:test";
import {
  classifyTurnFailure,
  STREAM_INTERRUPTED_PREFIX,
  type TurnFailure,
} from "../../src/turn-failure/classify.ts";

const AUTH_JSON =
  '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_1"}';
const PERMISSION_JSON =
  '403 {"type":"error","error":{"type":"permission_error","message":"model not allowed"}}';
const OVERFLOW_JSON =
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 250000 tokens > 200000 maximum"}}';

test("끊김 접두는 상태 코드와 이름보다 먼저 본다", () => {
  expect(STREAM_INTERRUPTED_PREFIX).toBe("stream_interrupted: ");
  expect(classifyTurnFailure(`stream_interrupted: ${AUTH_JSON}`)).toStrictEqual({
    kind: "interrupted",
  });
  expect(classifyTurnFailure("stream_interrupted: 529 overloaded_error")).toStrictEqual({
    kind: "interrupted",
  });
});

test("호스트 불일치는 키 오류 이름보다 먼저 보고 호스트를 싣는다", () => {
  const withHost =
    "secret_unresolved: secret k could not be leased (denied: host_mismatch, host=proxy.example.com)";
  expect(classifyTurnFailure(withHost)).toStrictEqual({
    kind: "host_mismatch",
    params: { host: "proxy.example.com" },
  });
  const bare = "secret_unresolved: secret k could not be leased (denied: host_mismatch)";
  expect(classifyTurnFailure(bare)).toStrictEqual({ kind: "host_mismatch" });
});

test("상태 코드와 오류 이름별 종류", () => {
  const rows: readonly (readonly [string, TurnFailure])[] = [
    [AUTH_JSON, { kind: "auth" }],
    ["401 unauthorized", { kind: "auth" }],
    [PERMISSION_JSON, { kind: "permission_denied" }],
    ["403 Forbidden", { kind: "permission_denied" }],
    ['404 {"error":{"type":"not_found_error","message":"model: x"}}', { kind: "model_not_found" }],
    [OVERFLOW_JSON, { kind: "context_overflow" }],
    ["400 maximum context length is 128000 tokens", { kind: "context_overflow" }],
    ["400 request exceeds the context window", { kind: "context_overflow" }],
    ['400 {"error":{"type":"invalid_request_error"}}', { kind: "bad_request" }],
    ["429 rate limit", { kind: "rate_limited" }],
    ["429 rate_limit_error [retry-after=7]", { kind: "rate_limited", params: { seconds: "7" } }],
    ["529 overloaded_error", { kind: "server" }],
    ["503 Service Unavailable", { kind: "server" }],
    ["Connection error.", { kind: "network" }],
    ["provider_unavailable: no route", { kind: "network" }],
    ["model_not_found: anthropic/x", { kind: "model_not_found" }],
    ["secret_unresolved: no value stored", { kind: "auth" }],
    ["뭔지 모를 오류", { kind: "unknown" }],
  ];
  for (const [error, expected] of rows) {
    expect([error, classifyTurnFailure(error)]).toStrictEqual([error, expected]);
  }
});

test("429의 대기 표지가 없으면 자리 값이 없다", () => {
  expect(classifyTurnFailure("429 rate_limit_error")).toStrictEqual({ kind: "rate_limited" });
});

test("같은 문장은 같은 답을 준다", () => {
  expect(classifyTurnFailure(OVERFLOW_JSON)).toStrictEqual(classifyTurnFailure(OVERFLOW_JSON));
});
