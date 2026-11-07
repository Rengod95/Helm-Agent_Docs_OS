import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { SecretNameSchema, type SecretName } from "@fresnel/contracts/capabilities";
import {
  keySecretOf,
  keySecretOfModel,
  providerOfModelRef,
  turnFailureOf,
} from "../../src/views/turn-failure-model.ts";

function nameOf(text: string): SecretName {
  const parsed = parse(SecretNameSchema, text);
  if (!parsed.ok) throw new Error("test name must parse");
  return parsed.value;
}

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

test("403은 권한 없음으로 가고 모델 바꾸기를 준다. 키 다시 등록은 주지 않는다", () => {
  const error =
    '403 {"type":"error","error":{"type":"permission_error","message":"model not allowed"}}';
  expect(turnFailureOf(error)).toEqual({
    kind: "permission_denied",
    text: "desktop.turnFailure.permissionDenied",
    action: "change-model",
    detail: error,
  });
});

test("429에 서버 대기가 있으면 초를 자리 값으로 싣고, 없으면 대기 없는 문장이다", () => {
  const waited = turnFailureOf("429 rate_limit_error [retry-after=7]");
  expect(waited).toEqual({
    kind: "rate_limited",
    text: "desktop.turnFailure.rateLimitedWait",
    action: "resend",
    params: { seconds: "7" },
    detail: "429 rate_limit_error [retry-after=7]",
  });
  const plain = turnFailureOf("429 rate limit");
  expect(plain.text).toBe("desktop.turnFailure.rateLimited");
  expect(plain.params).toBeUndefined();
});

test("문맥 넘침은 모델 바꾸기이고, 같은 400이라도 문맥이 아니면 문장만 있다", () => {
  const overflow =
    '400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 250000 tokens > 200000 maximum"}}';
  expect(turnFailureOf(overflow)).toEqual({
    kind: "context_overflow",
    text: "desktop.turnFailure.contextOverflow",
    action: "change-model",
    detail: overflow,
  });
  expect(turnFailureOf('400 {"error":{"type":"invalid_request_error"}}')).toEqual({
    kind: "bad_request",
    text: "desktop.turnFailure.badRequest",
    action: null,
    detail: '400 {"error":{"type":"invalid_request_error"}}',
  });
});

test("끊긴 스트림은 다시 보내기이고 다른 종류보다 먼저 판정된다", () => {
  const error = "stream_interrupted: 529 overloaded_error";
  expect(turnFailureOf(error)).toEqual({
    kind: "interrupted",
    text: "desktop.turnFailure.interrupted",
    action: "resend",
    detail: error,
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

test("모델 참조에서 제공자 id를 꺼낸다", () => {
  expect(providerOfModelRef("fake-provider/model-x:high")).toBe("fake-provider");
  expect(providerOfModelRef("no-slash")).toBeNull();
  expect(providerOfModelRef("/leading")).toBeNull();
  expect(providerOfModelRef(null)).toBeNull();
});

test("키 참조에서 시크릿 이름을 꺼내고, 규칙에 맞지 않으면 null이다", () => {
  expect(keySecretOf("secret://fake-key")).toBe(nameOf("fake-key"));
  expect(keySecretOf("secret://Bad_Name")).toBeNull();
  expect(keySecretOf("plain-value")).toBeNull();
  expect(keySecretOf(null)).toBeNull();
});

test("실패한 턴의 모델 제공자가 쓰는 키의 시크릿을 고른다", () => {
  const providers = [
    { id: "fake-provider", apiKeyRef: "secret://fake-key" },
    { id: "other", apiKeyRef: "secret://other-key" },
  ];
  expect(keySecretOfModel("fake-provider/model-x", providers)).toBe(nameOf("fake-key"));
  expect(keySecretOfModel("other/y", providers)).toBe(nameOf("other-key"));
  expect(keySecretOfModel("unknown/z", providers)).toBeNull();
  expect(keySecretOfModel(null, providers)).toBeNull();
  expect(
    keySecretOfModel("fake-provider/model-x", [{ id: "fake-provider", apiKeyRef: null }]),
  ).toBeNull();
});
