import { describe, expect, test } from "bun:test";
import type { HookEntry } from "@fresnel/contracts/wire";
import { orderTableOf } from "../../../src/views/workbench/order-merge.ts";

const row = (registrationId: string, tier: number | null) => ({
  registrationId,
  extension: registrationId,
  tier,
  status: "enabled" as const,
  error: null,
});

const HOOK: HookEntry = {
  hook: "tool.call.before",
  fold: "first",
  handlers: 2,
  registrations: ["web", "core"],
  external: false,
  order: [row("core", 0), row("web", 1), row("old", null)],
};

describe("orderTableOf: 기본 순서와 적용 순서", () => {
  test("기본 순서는 tier가 있는 행만 행 순서대로 잇는다. tier가 없는 행은 빠진다", () => {
    expect(orderTableOf([HOOK], [])).toEqual({ "tool.call.before": ["core", "web"] });
  });

  test("order 필드가 없는 옛 호스트는 registrations를 그대로 쓴다", () => {
    // `order` 키를 아예 뺀다(exactOptionalPropertyTypes에서 undefined 값은 맞지 않는다)
    const { order: _current, ...rest } = HOOK;
    const legacy: HookEntry = { ...rest, registrations: ["web", "core"] };
    expect(orderTableOf([legacy], [])).toEqual({ "tool.call.before": ["web", "core"] });
  });

  test("적용 순서가 있는 훅은 기본 순서를 버리고 적용 순서로 덮는다", () => {
    const applied = [
      { hook: "tool.call.before", saved: ["web", "core"], applied: ["web", "core"], pending: true },
    ];
    expect(orderTableOf([HOOK], applied)).toEqual({ "tool.call.before": ["web", "core"] });
  });

  test("적용 순서만 있는 훅도 표에 들어가고, 적용 순서가 빈 목록이면 빈 순서다", () => {
    const other: HookEntry = { ...HOOK, hook: "tool.result", order: [] };
    const applied = [
      { hook: "tool.call.before", saved: [], applied: ["core"], pending: false },
      { hook: "guard.only", saved: [], applied: [], pending: false },
    ];
    expect(orderTableOf([other], applied)).toEqual({
      "tool.result": [],
      "tool.call.before": ["core"],
      "guard.only": [],
    });
  });
});
