import { describe, expect, test } from "bun:test";
import type { ItemRecord, StepComposition, Usage } from "@fresnel/contracts/conversation";
import type { AgentRow, TurnSummary } from "../../../src/state/engine/index.ts";
import {
  compositionPartsOf,
  contextFillOf,
  loadedToolsOf,
  roundsOf,
  usageReportOf,
} from "../../../src/views/panels/context/context-model.ts";
import { itm, thr, trn } from "../../state/helpers.ts";

// 컨텍스트 탭 모델(DP-201~203): 채움과 자동 요약 문턱, 턴별 채움, 구성 갈래, 토큰·비용 합, 실린 도구.

function usage(input: number, output: number, cost: number): Usage {
  return {
    input,
    output,
    cacheRead: 10,
    cacheWrite: 5,
    totalTokens: input + output + 15,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
  };
}

function turn(n: number, over: Partial<TurnSummary> = {}): TurnSummary {
  return {
    turnId: trn(n),
    origin: "user",
    startedSeq: n,
    inputItemIds: [],
    leadScopeId: null,
    requestId: null,
    invoked: [],
    model: null,
    startedAt: null,
    running: false,
    aborting: false,
    abort: null,
    steps: 1,
    durationMs: null,
    usage: null,
    rawUsage: null,
    end: null,
    stopReason: null,
    warnings: [],
    notices: [],
    lastContextTokens: null,
    composition: null,
    ...over,
  };
}

describe("contextFillOf", () => {
  test("자동 요약 문턱은 창에서 남겨 둘 토큰을 뺀 값이다", () => {
    expect(
      contextFillOf(
        { tokens: 100_000, limit: 200_000 },
        { autoCompact: true, reserveTokens: 16_384 },
      ),
    ).toEqual({
      kind: "known",
      used: 100_000,
      limit: 200_000,
      percent: 50,
      threshold: 183_616,
      compaction: { kind: "left", tokens: 83_616 },
    });
  });

  test("문턱을 넘었거나 꺼졌거나 정책을 모르면 그대로 말한다", () => {
    const over = contextFillOf(
      { tokens: 190_000, limit: 200_000 },
      { autoCompact: true, reserveTokens: 16_384 },
    );
    expect(over.kind === "known" ? over.compaction : null).toEqual({ kind: "over" });
    const off = contextFillOf({ tokens: 10, limit: 100 }, { autoCompact: false, reserveTokens: 1 });
    expect(off.kind === "known" ? [off.threshold, off.compaction] : null).toEqual([
      null,
      { kind: "off" },
    ]);
    const unknown = contextFillOf({ tokens: 10, limit: 100 }, null);
    expect(unknown.kind === "known" ? unknown.compaction : null).toEqual({ kind: "unknown" });
  });

  test("한도를 모르면 비율을 만들지 않고, 사용량이 없으면 none이다", () => {
    expect(contextFillOf({ tokens: 500, limit: null }, null)).toEqual({
      kind: "noLimit",
      used: 500,
    });
    expect(contextFillOf(null, null)).toEqual({ kind: "none" });
  });
});

describe("roundsOf와 compositionPartsOf", () => {
  const composition: StepComposition = {
    system: 1000,
    tools: 3000,
    sections: { rules: 500, empty: 0 },
    injected: 200,
    volatile: 100,
    history: 15_000,
    total: 16_800,
  };

  test("문맥 토큰을 아는 턴만 기둥이 되고 번호는 대화 안 순서다", () => {
    const rounds = roundsOf(
      [
        turn(1, {
          lastContextTokens: 10_000,
          usage: {
            input: 0,
            output: 1000,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: null,
          },
        }),
        turn(2),
        turn(3, { lastContextTokens: 20_000, composition }),
      ],
      100_000,
    );
    expect(rounds.map((r) => [r.number, r.total, r.out, r.tokens])).toEqual([
      [1, 10, 1, 10_000],
      [3, 20, 0, 20_000],
    ]);
  });

  test("구성은 네 갈래이고 규칙 갈래 안에 절·확장·환경이 있다", () => {
    expect(compositionPartsOf(composition, 100_000)).toEqual([
      { key: "system", tokens: 1000, detail: [], percent: 1 },
      { key: "tools", tokens: 3000, detail: [], percent: 3 },
      {
        key: "rules",
        tokens: 800,
        detail: [
          { name: "rules", tokens: 500 },
          { name: "injected", tokens: 200 },
          { name: "volatile", tokens: 100 },
        ],
        percent: 0.8,
      },
      { key: "history", tokens: 15_000, detail: [], percent: 15 },
    ]);
  });

  test("갈래 합이 창을 넘으면 비례로 줄여 100을 넘지 않는다", () => {
    const parts = compositionPartsOf(composition, 10_000);
    expect(parts.reduce((sum, p) => sum + p.percent, 0)).toBeLessThanOrEqual(100.1);
  });
});

describe("usageReportOf", () => {
  test("턴 합, 하위 에이전트 합, 모델별 합을 따로 낸다", () => {
    const agent: AgentRow = {
      agent: {
        childThreadId: thr(2),
        agent: "reviewer",
        requestId: "r1",
        caller: "main",
        depth: 1,
        background: false,
        owner: { kind: "scope", scopeId: "s1" },
        modelRole: "default",
        spawnedSeq: 1,
        spawnedAt: "2026-11-13T00:00:00.000Z",
        status: "completed",
        settledAt: null,
        reportText: null,
        reportTruncated: false,
        usage: usage(50, 5, 0.1),
        error: null,
        limitHit: null,
      },
      progress: null,
    };
    const report = usageReportOf(
      [
        turn(1, { model: "a/m1", rawUsage: usage(100, 10, 1) }),
        turn(2, { model: "b/m2", rawUsage: usage(300, 30, 0) }),
        turn(3),
      ],
      [agent],
    );
    expect(report.main).toEqual({
      input: 400,
      output: 40,
      cacheRead: 20,
      cacheWrite: 10,
      total: 470,
      cost: 1,
    });
    expect(report.agents).toEqual({
      input: 50,
      output: 5,
      cacheRead: 10,
      cacheWrite: 5,
      total: 70,
      cost: 0.1,
    });
    expect(report.byModel).toEqual([
      { model: "b/m2", total: 345, cost: null },
      { model: "a/m1", total: 125, cost: 1 },
    ]);
    expect([report.turns, report.agentCount]).toEqual([2, 1]);
  });
});

const system = (
  n: number,
  added: readonly string[],
  removed: readonly string[] = [],
): ItemRecord => ({
  itemId: itm(n),
  status: "completed",
  kind: "system",
  message: {
    role: "system",
    content: "",
    toolsAdded: added.map((name) => ({ name, description: "", parameters: {} })),
    ...(removed.length === 0 ? {} : { toolsRemoved: removed.map((name) => ({ name })) }),
    timestamp: 0,
  },
});

describe("loadedToolsOf", () => {
  test("접두와 도구 변경을 차례로 적용하고 미룬 도구를 따로 센다", () => {
    const records = [system(1, ["read", "edit", "bash"]), system(2, ["grep"], ["bash"])];
    const items: Record<string, ItemRecord> = {};
    for (const r of records) items[r.itemId] = r;
    expect(
      loadedToolsOf(
        records.map((r) => r.itemId),
        items,
        [{ code: "tools_deferred", added: ["grep", "web_fetch"], removed: [] }],
      ),
    ).toEqual({ names: ["edit", "grep", "read"], deferred: ["web_fetch"] });
  });

  test("도구를 적은 시스템 item이 없으면 모른다(null)", () => {
    expect(loadedToolsOf([], {}, [])).toBeNull();
  });
});
