import { describe, expect, test } from "bun:test";
import type { TSchema } from "typebox";
import { parse } from "../../src/base/index.ts";
import {
  TURN_ORIGINS,
  TurnOriginSchema,
  TurnStartedPayloadSchema,
} from "../../src/conversation/index.ts";
import { AgentSettledPayloadSchema, AgentStartPayloadSchema } from "../../src/extensions/index.ts";
import { InputQueuedPayloadSchema } from "../../src/records/index.ts";
import { rawId } from "../helpers/ids.ts";

const turnId = rawId("trn", 1);
const itemId = rawId("itm", 1);

function accepts(schema: TSchema, value: unknown): boolean {
  return parse(schema, value).ok;
}

describe("TurnOrigin (M3-REQ-06, 100)", () => {
  test("values", () => {
    expect(TURN_ORIGINS).toEqual(["user", "scheduled", "remote", "delegation", "drive", "other"]);
    expect(TURN_ORIGINS.map((v) => accepts(TurnOriginSchema, v))).toEqual(
      TURN_ORIGINS.map(() => true),
    );
    for (const bad of ["schedule", "review", "User", "", null]) {
      expect(accepts(TurnOriginSchema, bad)).toBe(false);
    }
  });

  test("AgentStartPayload carries an optional origin that is checked when present", () => {
    expect(accepts(AgentStartPayloadSchema, { turnId, origin: "remote" })).toBe(true);
    expect(accepts(AgentStartPayloadSchema, { turnId })).toBe(true);
    expect(accepts(AgentStartPayloadSchema, { turnId, origin: "cron" })).toBe(false);
  });

  const settled = {
    turnId,
    aborted: false,
    origin: "scheduled",
    status: "completed",
    hasFinalAnswer: true,
    lastItemId: itemId,
  };

  test("AgentSettledPayload carries origin, status, hasFinalAnswer, lastItemId", () => {
    expect(accepts(AgentSettledPayloadSchema, settled)).toBe(true);
    expect(accepts(AgentSettledPayloadSchema, { ...settled, lastItemId: null })).toBe(true);
    expect(accepts(AgentSettledPayloadSchema, { ...settled, status: "error" })).toBe(true);
    // 네 필드는 L1.loop가 채우기 전까지 선택이다
    expect(accepts(AgentSettledPayloadSchema, { turnId, aborted: false })).toBe(true);
    for (const key of ["origin", "status", "hasFinalAnswer", "lastItemId"]) {
      expect(accepts(AgentSettledPayloadSchema, { ...settled, [key]: undefined })).toBe(true);
    }
    expect(accepts(AgentSettledPayloadSchema, { ...settled, origin: "cron" })).toBe(false);
    expect(accepts(AgentSettledPayloadSchema, { ...settled, hasFinalAnswer: "yes" })).toBe(false);
    expect(accepts(AgentSettledPayloadSchema, { ...settled, status: "interrupted" })).toBe(false);
    expect(accepts(AgentSettledPayloadSchema, { ...settled, lastItemId: "itm_x" })).toBe(false);
  });

  test("turn.started record: origin is optional so old events still parse", () => {
    const started = { inputItemIds: [itemId], requestId: "r1", scopeId: null };
    expect(accepts(TurnStartedPayloadSchema, started)).toBe(true);
    expect(accepts(TurnStartedPayloadSchema, { ...started, origin: "drive" })).toBe(true);
    expect(accepts(TurnStartedPayloadSchema, { ...started, origin: "robot" })).toBe(false);
  });

  test("input.queued record: origin is optional", () => {
    const queued = {
      mode: "next",
      item: { kind: "user", content: "hi" },
      requestId: "in-1",
      source: { type: "schedule", timerId: "t1" },
    };
    expect(accepts(InputQueuedPayloadSchema, queued)).toBe(true);
    expect(accepts(InputQueuedPayloadSchema, { ...queued, origin: "scheduled" })).toBe(true);
    expect(accepts(InputQueuedPayloadSchema, { ...queued, origin: "schedule" })).toBe(false);
  });
});
