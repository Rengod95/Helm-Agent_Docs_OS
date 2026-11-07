import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  ProviderRetryDetailSchema,
  TurnUpdatedPayloadSchema,
} from "../../src/conversation/index.ts";

// L1.loop.spec FR-L5: turn.updated에 사용자에게만 보이는 알림(gate_limit, repeat_detected)을 싣는다.
describe("TurnUpdatedPayload.notice", () => {
  test("a plain status update still parses", () => {
    expect(parse(TurnUpdatedPayloadSchema, { status: "running" }).ok).toBe(true);
  });

  test("the gate limit notice carries the limit", () => {
    const parsed = parse(TurnUpdatedPayloadSchema, {
      status: "running",
      notice: { code: "gate_limit", detail: { limit: 8 } },
    });
    expect(parsed.ok).toBe(true);
  });

  test("the repeat notice carries the kind and count", () => {
    const parsed = parse(TurnUpdatedPayloadSchema, {
      status: "running",
      notice: { code: "repeat_detected", detail: { kind: "action_error", count: 3 } },
    });
    expect(parsed.ok).toBe(true);
  });

  test("the provider retry notice carries attempt, maxRetries and whole-millisecond waitMs", () => {
    const detail = { attempt: 2, maxRetries: 3, waitMs: 4000 };
    const parsed = parse(TurnUpdatedPayloadSchema, {
      status: "running",
      notice: { code: "provider_retry", detail },
    });
    expect(parsed.ok && parsed.value.notice).toEqual({ code: "provider_retry", detail });
    expect(parse(ProviderRetryDetailSchema, detail).ok).toBe(true);
  });

  test("a provider retry detail with a fractional wait or no attempt is rejected", () => {
    expect(parse(ProviderRetryDetailSchema, { attempt: 1, maxRetries: 3, waitMs: 1.5 }).ok).toBe(
      false,
    );
    expect(parse(ProviderRetryDetailSchema, { attempt: 0, maxRetries: 3, waitMs: 500 }).ok).toBe(
      false,
    );
    expect(parse(ProviderRetryDetailSchema, { attempt: 1, maxRetries: 3 }).ok).toBe(false);
  });

  test("an unknown code or a missing detail is rejected", () => {
    expect(
      parse(TurnUpdatedPayloadSchema, { status: "running", notice: { code: "other", detail: 1 } })
        .ok,
    ).toBe(false);
    expect(
      parse(TurnUpdatedPayloadSchema, { status: "running", notice: { code: "gate_limit" } }).ok,
    ).toBe(false);
  });
});
