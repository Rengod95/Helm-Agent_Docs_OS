import { expect, test } from "bun:test";
import { failureReasonOf } from "../../src/turn-failure/reason.ts";

const AUTH_JSON =
  '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_1"}';

test("the server's error message is the reason", () => {
  expect(failureReasonOf(AUTH_JSON)).toBe("invalid x-api-key");
});

test("a body with a retry marker after it still gives the message", () => {
  expect(failureReasonOf('429 {"error":{"message":"slow down"}} [retry-after=7]')).toBe(
    "slow down",
  );
});

test("without a message the original sentence is the reason", () => {
  expect(failureReasonOf("401 unauthorized")).toBe("401 unauthorized");
  expect(failureReasonOf('400 {"error":{"type":"invalid_request_error"}}')).toBe(
    '400 {"error":{"type":"invalid_request_error"}}',
  );
  expect(failureReasonOf("400 {not json")).toBe("400 {not json");
});

test("a key-like token in the message is masked, the rest of the sentence stays", () => {
  expect(
    failureReasonOf(
      '401 {"error":{"type":"authentication_error","message":"Incorrect key sk-ant-api03-EXAMPLE123"}}',
    ),
  ).toBe("Incorrect key ••••");
  expect(
    failureReasonOf('500 {"error":{"message":"bad token ABCdef1234567890ABCdef1234567890"}}'),
  ).toBe("bad token ••••");
});

test("a key-like token outside the JSON is masked too", () => {
  expect(failureReasonOf("401 rejected: sk-proj-EXAMPLE123")).toBe("401 rejected: ••••");
  expect(failureReasonOf("401 key-abcdef12345 rejected")).toBe("401 •••• rejected");
});

test("words and ids that are not key-shaped stay as they are", () => {
  expect(failureReasonOf(AUTH_JSON)).toBe("invalid x-api-key");
  expect(failureReasonOf("429 rate_limit_error [retry-after=7]")).toBe(
    "429 rate_limit_error [retry-after=7]",
  );
});
