import { describe, expect, test } from "bun:test";
import type { MeasureRow } from "@fresnel/contracts/wire";
import { outcomeOf, turnViewOf } from "../../src/workbench/index.ts";

const hook = (
  seq: number,
  registrationId: string,
  ms: number,
  result: string,
  step = 0,
): MeasureRow => ({
  at: 1,
  kind: "hook",
  metrics: { ms, seq, step },
  tags: { hook: "context", registrationId, result },
});

const ctx: MeasureRow = {
  at: 1,
  kind: "ctx",
  metrics: {
    step: 0,
    system: 100,
    tools: 40,
    injected: 30,
    volatile: 0,
    history: 200,
    total: 430,
    "section.acme": 70,
    "section.helm": 30,
  },
  tags: {},
};

describe("outcomeOf", () => {
  test("keeps known names and flags problems; unknown names stay raw", () => {
    expect(outcomeOf("failed")).toEqual({ key: "failed", raw: "failed", problem: true });
    expect(outcomeOf("modified")).toEqual({ key: "modified", raw: "modified", problem: false });
    expect(outcomeOf("future_kind")).toEqual({ key: null, raw: "future_kind", problem: false });
  });

  test("the old names are no longer known, so they stay raw", () => {
    expect(outcomeOf("over_budget")).toEqual({ key: null, raw: "over_budget", problem: false });
    expect(outcomeOf("patched")).toEqual({ key: null, raw: "patched", problem: false });
  });
});

describe("turnViewOf", () => {
  test("off and empty states", () => {
    expect(turnViewOf({ enabled: false, rows: [] })).toEqual({ kind: "off" });
    expect(turnViewOf({ enabled: true, rows: [] })).toEqual({ kind: "empty" });
  });

  test("orders hooks by seq, sums per plugin and ranks the slowest first", () => {
    const state = turnViewOf({
      enabled: true,
      rows: [
        hook(3, "helm", 5, "passed"),
        hook(1, "acme", 800, "failed"),
        hook(2, "acme", 100, "passed"),
        ctx,
        {
          at: 1,
          kind: "cache",
          metrics: { step: 0, at: 12 },
          tags: { code: "cache_prefix_reset", owner: "acme" },
        },
        {
          at: 1,
          kind: "cache",
          metrics: { step: 1 },
          tags: { code: "cache_reset_model_switch", owner: "model", from: "a", to: "b" },
        },
        { at: 1, kind: "mystery", metrics: {}, tags: {} },
      ],
    });
    if (state.kind !== "ready") throw new Error("expected ready");
    const { view } = state;
    expect(view.hooks.map((h) => [h.seq, h.registrationId])).toEqual([
      [1, "acme"],
      [2, "acme"],
      [3, "helm"],
    ]);
    expect(view.hookTotalMs).toBe(905);
    expect(view.plugins).toEqual([
      { owner: "acme", hookMs: 900, handlers: 2, problems: 1, sectionTokens: 70, cacheEvents: 1 },
      { owner: "helm", hookMs: 5, handlers: 1, problems: 0, sectionTokens: 30, cacheEvents: 0 },
    ]);
    expect(view.bars).toEqual([
      {
        step: 0,
        total: 430,
        tools: 40,
        segments: [
          { part: "system", owner: null, tokens: 100 },
          { part: "section", owner: "acme", tokens: 70 },
          { part: "section", owner: "helm", tokens: 30 },
          { part: "injected", owner: null, tokens: 30 },
          { part: "history", owner: null, tokens: 200 },
        ],
      },
    ]);
    expect(view.cache).toEqual([
      {
        step: 0,
        code: "cache_prefix_reset",
        owner: "acme",
        from: "",
        to: "",
        at: 12,
        added: null,
        removed: null,
        cacheWrite: null,
        gapMs: null,
      },
      {
        step: 1,
        code: "cache_reset_model_switch",
        owner: "model",
        from: "a",
        to: "b",
        at: null,
        added: null,
        removed: null,
        cacheWrite: null,
        gapMs: null,
      },
    ]);
    expect(view.summary).toBeNull();
  });

  test("reads a cache expiry row with the rewritten tokens and the gap", () => {
    const state = turnViewOf({
      enabled: true,
      rows: [
        {
          at: 1,
          kind: "cache",
          metrics: { step: 2, cacheWrite: 13_456, gapMs: 399_600 },
          tags: { code: "cache_expired", owner: "ttl" },
        },
      ],
    });
    if (state.kind !== "ready") throw new Error("ready expected");
    expect(state.view.cache).toEqual([
      {
        step: 2,
        code: "cache_expired",
        owner: "ttl",
        from: "",
        to: "",
        at: null,
        added: null,
        removed: null,
        cacheWrite: 13_456,
        gapMs: 399_600,
      },
    ]);
  });

  test("reads the turn row and call rows; missing numbers become 0 or null", () => {
    const state = turnViewOf({
      enabled: true,
      rows: [
        {
          at: 1,
          kind: "turn",
          metrics: { steps: 2, totalTokens: 900, usd: 0.5 },
          tags: { status: "completed" },
        },
        { at: 1, kind: "call", metrics: { durationMs: 40 }, tags: { role: "main", model: "m" } },
      ],
    });
    if (state.kind !== "ready") throw new Error("expected ready");
    expect(state.view.summary).toEqual({
      status: "completed",
      steps: 2,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 900,
      usd: 0.5,
    });
    expect(state.view.calls).toEqual([
      {
        role: "main",
        model: "m",
        durationMs: 40,
        firstTokenMs: null,
        totalTokens: 0,
        cacheRead: 0,
        usd: 0,
      },
    ]);
  });
});
