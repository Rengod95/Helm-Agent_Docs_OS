import { expect, test } from "bun:test";
import { readAccounts, readRateLimit } from "../../src/accounts/index.ts";
import { providersOf, readProviders } from "../../src/settings/index.ts";

// f/F-01: 읽을 수 없는 저장 값과 빈 값을 구분한다. 쓰기 경로는 읽을 수 없는 값 위에 쓰지 않는다.

const PROVIDER = {
  id: "openai",
  enabled: true,
  apiKeyRef: "secret://openai-api-key",
  baseUrl: null,
};

test("a stored provider list that fits the schema is read as it is", () => {
  expect(readProviders([PROVIDER])).toEqual({ ok: true, value: [PROVIDER] });
  expect(readProviders([])).toEqual({ ok: true, value: [] });
});

test("a list with an unknown field or a wrong shape is unreadable, not empty", () => {
  expect(readProviders([{ ...PROVIDER, extra: 1 }])).toEqual({
    ok: false,
    error: { kind: "unreadable" },
  });
  expect(readProviders(undefined)).toEqual({ ok: false, error: { kind: "unreadable" } });
  expect(readProviders("nope")).toEqual({ ok: false, error: { kind: "unreadable" } });
  // 표시용 읽기는 그대로 빈 목록이다
  expect(providersOf([{ ...PROVIDER, extra: 1 }])).toEqual([]);
});

test("accounts and rate limits are unreadable when malformed, and empty values are readable", () => {
  expect(readAccounts([])).toEqual({ ok: true, value: [] });
  expect(readAccounts({ nope: true })).toEqual({ ok: false, error: { kind: "unreadable" } });
  expect(readRateLimit({})).toEqual({ ok: true, value: {} });
  expect(readRateLimit([1])).toEqual({ ok: false, error: { kind: "unreadable" } });
});
