import { expect, test } from "bun:test";
import { turnFailureOf } from "../../src/views/turn-failure-model.ts";

const AUTH_JSON =
  '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_1"}';

test("401은 키 다시 등록으로 가고 원문은 detail에 그대로 남는다", () => {
  expect(turnFailureOf(AUTH_JSON)).toEqual({
    kind: "auth",
    text: "desktop.turnFailure.auth",
    action: "reregister-key",
    detail: AUTH_JSON,
  });
});

test("상태 코드와 오류 종류별 분류와 단추", () => {
  const rows: readonly (readonly [string, string, string | null])[] = [
    ['400 {"error":{"type":"invalid_request_error"}}', "bad_request", null],
    [
      '404 {"error":{"type":"not_found_error","message":"model: x"}}',
      "model_not_found",
      "change-model",
    ],
    ["model_not_found: anthropic/x", "model_not_found", "change-model"],
    ["secret_unresolved: no value stored", "auth", "reregister-key"],
    ["429 rate limit", "rate_limited", "resend"],
    ["529 overloaded_error", "server", "resend"],
    ["503 Service Unavailable", "server", "resend"],
    ["Connection error.", "network", "resend"],
    ["provider_unavailable: no route", "network", "resend"],
    ["뭔지 모를 오류", "unknown", "resend"],
  ];
  for (const [error, kind, action] of rows) {
    const view = turnFailureOf(error);
    expect([error, view.kind, view.action]).toEqual([error, kind, action]);
  }
});

test("host_mismatch는 키 오류와 나뉘어 호스트와 제공자 설정 단추를 준다", () => {
  const error =
    "secret_unresolved: secret k could not be leased (denied: host_mismatch, host=proxy.example.com)";
  expect(turnFailureOf(error)).toEqual({
    kind: "host_mismatch",
    text: "desktop.turnFailure.hostMismatch",
    action: "open-providers",
    params: { host: "proxy.example.com" },
    detail: error,
  });
  const bare = "secret_unresolved: secret k could not be leased (denied: host_mismatch)";
  expect(turnFailureOf(bare).text).toBe("desktop.turnFailure.hostMismatchAny");
  expect(turnFailureOf(bare).kind).toBe("host_mismatch");
});
