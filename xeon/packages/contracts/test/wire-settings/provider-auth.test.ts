import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  ProviderCheckAuthParamsSchema,
  ProviderCheckAuthResultSchema,
  WIRE_METHODS,
} from "../../src/wire-settings/wire/index.ts";

// provider.checkAuth(M4, L1.models.spec §3.13). 값을 견주고, 거부 값을 확인한다. 결과에는 키 값 필드가 없다.

const KINDS = [
  "ok",
  "rejected",
  "badAddress",
  "quotaOrBilling",
  "upstream",
  "timeout",
  "unsupported",
  "oauthTokenNotApiKey",
  "noKey",
];

describe("provider.checkAuth registry row", () => {
  test("is an M4 method with both schemas", () => {
    const spec = WIRE_METHODS["provider.checkAuth"];
    expect({ stage: spec.stage, since: spec.since, status: spec.status }).toEqual({
      stage: "M4",
      since: "0.1.0",
      status: "active",
    });
  });
});

describe("provider.checkAuth params", () => {
  test("accepts a provider id and rejects anything else", () => {
    const schema = WIRE_METHODS["provider.checkAuth"].params;
    const ok = parse(schema, { provider: "openrouter" });
    expect(ok.ok ? ok.value : undefined).toEqual({ provider: "openrouter" });
    expect(parse(schema, { provider: "plugin:brave-search" }).ok).toBe(true);
    expect(parse(schema, { provider: "Anthropic" }).ok).toBe(false);
    expect(parse(schema, {}).ok).toBe(false);
    expect(parse(schema, { provider: "openai", key: "sk-x" }).ok).toBe(false);
  });

  test("the params schema alone takes exactly the provider field", () => {
    expect(parse(ProviderCheckAuthParamsSchema, { provider: "google" }).ok).toBe(true);
    expect(parse(ProviderCheckAuthParamsSchema, { provider: "google", extra: 1 }).ok).toBe(false);
  });
});

describe("provider.checkAuth result", () => {
  test("every kind parses with the optional status and reason", () => {
    for (const kind of KINDS) {
      expect(parse(ProviderCheckAuthResultSchema, { kind }).ok).toBe(true);
    }
    const rejected = parse(ProviderCheckAuthResultSchema, {
      kind: "rejected",
      status: 401,
      reason: "invalid x-api-key: ••••",
    });
    expect(rejected.ok ? rejected.value : undefined).toEqual({
      kind: "rejected",
      status: 401,
      reason: "invalid x-api-key: ••••",
    });
  });

  test("rejects an unknown kind, a status outside 100..599, a reason over 200 characters, and any extra field", () => {
    expect(parse(ProviderCheckAuthResultSchema, { kind: "maybe" }).ok).toBe(false);
    expect(parse(ProviderCheckAuthResultSchema, { kind: "rejected", status: 42 }).ok).toBe(false);
    expect(parse(ProviderCheckAuthResultSchema, { kind: "rejected", status: 600 }).ok).toBe(false);
    expect(
      parse(ProviderCheckAuthResultSchema, { kind: "rejected", reason: "x".repeat(201) }).ok,
    ).toBe(false);
    expect(
      parse(ProviderCheckAuthResultSchema, { kind: "rejected", key: "sk-fake-0123456789" }).ok,
    ).toBe(false);
  });
});
