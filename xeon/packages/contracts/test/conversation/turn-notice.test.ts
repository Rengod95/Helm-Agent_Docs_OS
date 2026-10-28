import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import { TurnUpdatedPayloadSchema } from "../../src/conversation/index.ts";

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
