import { describe, expect, test } from "bun:test";
import {
  REPLAY_EFFECT_TABLE,
  capabilityEffectOf,
  isEffectAllowed,
  type ReplayEffect,
} from "../../src/extensions/index.ts";

describe("REPLAY_EFFECT_TABLE (ADR-0015 §3.2)", () => {
  test("rows keep the ADR order", () => {
    expect(Object.keys(REPLAY_EFFECT_TABLE)).toEqual([
      "commit",
      "record",
      "post",
      "loop.turn",
      "loop.spawn",
      "g.delegate",
      "g.delegateStatus",
      "g.cancelDelegates",
      "capability.idempotent",
      "capability.readOnly",
      "capability.undeclared",
      "io",
    ]);
  });

  test("on and drive verdicts per row", () => {
    const verdicts = Object.entries(REPLAY_EFFECT_TABLE).map(
      ([effect, row]) => `${effect}: ${row.on}/${row.drive}`,
    );
    expect(verdicts).toEqual([
      "commit: allowed/allowed",
      "record: allowed/allowed",
      "post: allowed/allowed",
      "loop.turn: n/a/allowed",
      "loop.spawn: n/a/allowed",
      "g.delegate: allowed/allowed",
      "g.delegateStatus: denied/allowed",
      "g.cancelDelegates: denied/denied",
      "capability.idempotent: allowed/allowed",
      "capability.readOnly: denied/allowed",
      "capability.undeclared: denied/denied",
      "io: denied/denied",
    ]);
  });

  test("requestId rule and guarantor per row", () => {
    const rules = Object.entries(REPLAY_EFFECT_TABLE).map(
      ([effect, row]) => `${effect}: ${row.requestId} ${row.guarantor}`,
    );
    expect(rules).toEqual([
      "commit: none X",
      "record: none X",
      "post: required L1.input-queue",
      "loop.turn: default_or_explicit L1.loop",
      "loop.spawn: default_or_explicit L1.agents",
      "g.delegate: required L1.agents",
      "g.delegateStatus: none none",
      "g.cancelDelegates: none none",
      "capability.idempotent: required provider",
      "capability.readOnly: optional none",
      "capability.undeclared: none none",
      "io: none none",
    ]);
  });

  test("isEffectAllowed treats n/a as not allowed", () => {
    const loopTurn: ReplayEffect = "loop.turn";
    expect(isEffectAllowed(loopTurn, "on")).toBe(false);
    expect(isEffectAllowed(loopTurn, "drive")).toBe(true);
    expect(isEffectAllowed("capability.readOnly", "on")).toBe(false);
    expect(isEffectAllowed("capability.readOnly", "drive")).toBe(true);
    expect(isEffectAllowed("capability.idempotent", "on")).toBe(true);
  });

  test("capabilityEffectOf picks the row from the declaration", () => {
    expect(capabilityEffectOf({ idempotent: true })).toBe("capability.idempotent");
    expect(capabilityEffectOf({ readOnly: true })).toBe("capability.readOnly");
    expect(capabilityEffectOf({})).toBe("capability.undeclared");
    // 둘 다 선언하면 검증 오류(effect_class_conflict)이고, 표에서는 선언 없음으로 본다
    expect(capabilityEffectOf({ idempotent: true, readOnly: true })).toBe("capability.undeclared");
  });
});
