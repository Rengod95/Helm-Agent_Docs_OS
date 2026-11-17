import { describe, expect, test } from "bun:test";
import type { TSchema } from "typebox";
import { parse } from "../../src/base/index.ts";
import {
  CostFiguresSchema,
  EvidenceRefSchema,
  InjectInventorySchema,
  PluginCardSchema,
  PluginSettingDefSchema,
  PluginUiDeclSchema,
} from "../../src/extensions/index.ts";
import { PLUGIN_CARD } from "../wire-settings/plugin-fixtures.ts";

function roundTrip(schema: TSchema, value: unknown): void {
  const result = parse(schema, value);
  expect(result.ok ? result.value : result.error).toEqual(value);
}

/** 카드의 Hook 칸 하나를 fold만 바꾼 덮어쓰기 값(나머지 칸은 픽스처 그대로) */
function withHookFold(fold: string): object {
  return {
    does: {
      ...PLUGIN_CARD.does,
      hook: { hooks: [{ ...PLUGIN_CARD.does.hook?.hooks[0], fold }] },
    },
  };
}

describe("plugin card schema (M5c-1)", () => {
  test("a complete card round trips by value", () => {
    roundTrip(PluginCardSchema, PLUGIN_CARD);
  });

  test("a card with no Inject, Hook or Drive and a null purpose is valid", () => {
    roundTrip(PluginCardSchema, {
      ...PLUGIN_CARD,
      purpose: null,
      does: { inject: null, hook: null, drive: null },
      runs: { code: false, isolated: null },
    });
  });

  test("optional origin fields are kept when given and may be omitted", () => {
    const origin = { kind: "project", projectId: "prj_1", createdIn: { threadId: "thr_1" } };
    roundTrip(PluginCardSchema, { ...PLUGIN_CARD, origin });
    expect(parse(PluginCardSchema, { ...PLUGIN_CARD, origin: { kind: "user" } }).ok).toBe(true);
  });

  test("rejects extra top-level keys, unknown origin, enforcement and health values", () => {
    expect(parse(PluginCardSchema, { ...PLUGIN_CARD, extra: 1 }).ok).toBe(false);
    expect(parse(PluginCardSchema, { ...PLUGIN_CARD, origin: { kind: "unknown" } }).ok).toBe(false);
    expect(parse(PluginCardSchema, { ...PLUGIN_CARD, enforcement: "strict" }).ok).toBe(false);
    expect(
      parse(PluginCardSchema, {
        ...PLUGIN_CARD,
        health: { ...PLUGIN_CARD.health, state: "running" },
      }).ok,
    ).toBe(false);
  });

  test("the review state of a card is one of the four card states", () => {
    expect(
      parse(PluginCardSchema, {
        ...PLUGIN_CARD,
        review: { ...PLUGIN_CARD.review, state: "sent_back" },
      }).ok,
    ).toBe(false);
    for (const state of ["approved", "pending", "draft", "none"]) {
      expect(
        parse(PluginCardSchema, { ...PLUGIN_CARD, review: { ...PLUGIN_CARD.review, state } }).ok,
      ).toBe(true);
    }
  });

  test("the purpose is at most 200 characters", () => {
    expect(parse(PluginCardSchema, { ...PLUGIN_CARD, purpose: "a".repeat(200) }).ok).toBe(true);
    expect(parse(PluginCardSchema, { ...PLUGIN_CARD, purpose: "a".repeat(201) }).ok).toBe(false);
  });

  test("a hook fold is one of the four folds of hooks.ts", () => {
    for (const fold of ["tap", "first", "chain", "collect"]) {
      expect(parse(PluginCardSchema, { ...PLUGIN_CARD, ...withHookFold(fold) }).ok).toBe(true);
    }
    expect(parse(PluginCardSchema, { ...PLUGIN_CARD, ...withHookFold("detached") }).ok).toBe(false);
  });

  test("cost figures are non-negative integers or null, and the basis is one of four", () => {
    roundTrip(CostFiguresSchema, {
      always: 0,
      drive: null,
      onDemand: null,
      toolCount: null,
      basis: "unknown",
    });
    expect(
      parse(CostFiguresSchema, {
        always: -1,
        drive: null,
        onDemand: null,
        toolCount: null,
        basis: "declared",
      }).ok,
    ).toBe(false);
    expect(
      parse(CostFiguresSchema, {
        always: 1.5,
        drive: null,
        onDemand: null,
        toolCount: null,
        basis: "declared",
      }).ok,
    ).toBe(false);
    expect(
      parse(CostFiguresSchema, {
        always: 1,
        drive: null,
        onDemand: null,
        toolCount: null,
        basis: "guess",
      }).ok,
    ).toBe(false);
  });

  test("InjectInventory keeps its lists and its UI declarations are objects", () => {
    roundTrip(InjectInventorySchema, PLUGIN_CARD.does.inject);
    expect(parse(InjectInventorySchema, { ...PLUGIN_CARD.does.inject, ui: ["panel"] }).ok).toBe(
      false,
    );
    roundTrip(PluginUiDeclSchema, {
      id: "panel",
      placement: "side",
      readsState: "notes.count",
      modelVisible: "partial",
    });
    expect(
      parse(PluginUiDeclSchema, {
        id: "panel",
        placement: "side",
        readsState: null,
        modelVisible: "some",
      }).ok,
    ).toBe(false);
  });

  test("a setting definition keeps an unknown default value", () => {
    for (const value of ["text", 3, null, { nested: true }]) {
      roundTrip(PluginSettingDefSchema, {
        key: "ext.acme-notes.token",
        label: "Token",
        default: value,
        required: false,
        secret: true,
      });
    }
    expect(
      parse(PluginSettingDefSchema, { key: "k", label: "l", default: 1, secret: false }).ok,
    ).toBe(false);
  });
});

describe("evidence reference (E §3.5 minimal copy)", () => {
  test("a turn reference and a backtest reference round trip", () => {
    roundTrip(EvidenceRefSchema, { kind: "turn", threadId: "thr_1", turnId: "trn_1" });
    roundTrip(EvidenceRefSchema, {
      kind: "call",
      threadId: "thr_1",
      turnId: "trn_1",
      stepIndex: 2,
      toolCallId: "call_9",
    });
    roundTrip(EvidenceRefSchema, { kind: "backtest", backtestRunId: "bt_1" });
  });

  test("an unknown kind or a backtest with a thread is rejected", () => {
    expect(parse(EvidenceRefSchema, { kind: "replay", threadId: "t", turnId: "u" }).ok).toBe(false);
    expect(
      parse(EvidenceRefSchema, { kind: "backtest", backtestRunId: "bt_1", threadId: "thr_1" }).ok,
    ).toBe(false);
    expect(
      parse(EvidenceRefSchema, { kind: "turn", threadId: "thr_1", turnId: "trn_1", stepIndex: -1 })
        .ok,
    ).toBe(false);
  });
});
