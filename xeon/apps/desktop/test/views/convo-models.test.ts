import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { LeadSegment, TurnSummary } from "../../src/state/engine/index.ts";
import { activitySummaryOf } from "../../src/views/convo/activity-model.ts";
import {
  leaderNameOf,
  leadMetersOf,
  markerTextOf,
  newTokensOf,
  releaseTextOf,
  turnDetailLinesOf,
  turnMetaOf,
} from "../../src/views/convo/turn-model.ts";
import {
  commandMetaOf,
  durationText,
  failureToneOf,
  planArgsOf,
  planResultOf,
  toolHeadOf,
  type ToolResultView,
} from "../../src/views/convo/tool-view-model.ts";
import { evt, trn } from "../state/helpers.ts";

// 대화 줄의 순수 모델(dzT2a, L4 desktop-ux §16): 도구 머리, 걸린 시간, 계획 결과, 묶음 요약, 주도 구간 글.

describe("toolHeadOf", () => {
  test("read는 파일 아이콘, 과거·현재형 동사, 경로 대상이다", () => {
    const head = toolHeadOf("read", { path: "src/app.ts" }, null);
    expect(head.icon).toBe("read");
    expect(head.verb).toBe(t("desktop.convo.tool.read"));
    expect(head.verbRunning).toBe(t("desktop.convo.tool.read.running"));
    expect(head.target.kind).toBe("path");
    expect(head.target.kind === "path" ? head.target.path : null).toBe("src/app.ts");
    expect(head.rawName).toBe(false);
  });

  test("bash는 명령 대상이다", () => {
    const head = toolHeadOf("bash", { command: "bun test" }, null);
    expect(head.target).toEqual({ kind: "command", text: "bun test" });
  });

  test("MCP 도구는 서버 이름을 처음부터 든다", () => {
    const head = toolHeadOf("mcp__qa__lookup", {}, "qa");
    expect(head.server).toBe("qa");
  });
});

describe("durationText", () => {
  test("1초 밑은 ms, 10초 밑은 소수 한 자리, 1분부터 분과 초다", () => {
    expect(durationText(420)).toBe(t("desktop.convo.duration.ms", { ms: 420 }));
    expect(durationText(3240)).toBe(t("desktop.convo.duration.s", { seconds: "3.2" }));
    expect(durationText(34_400)).toBe(t("desktop.convo.duration.s", { seconds: 34 }));
    expect(durationText(64_000)).toBe(t("desktop.convo.duration.m", { minutes: 1, seconds: 4 }));
  });

  test("bash 끝 메타는 종료 코드와 시간이다. 둘 다 없으면 null", () => {
    const view: ToolResultView = {
      outcome: { kind: "done" },
      output: "",
      cut: null,
      hook: null,
      blocks: [],
      exitCode: 2,
      durationMs: 1500,
      server: null,
    };
    expect(commandMetaOf(view)).toBe(
      `${t("desktop.convo.exitCode", { code: 2 })} · ${durationText(1500)}`,
    );
    expect(commandMetaOf({ ...view, exitCode: null, durationMs: null })).toBeNull();
  });
});

describe("failureToneOf", () => {
  test("실패만 위험색, 거절·중단은 중립, 훅·보호·샌드박스는 경고다", () => {
    expect(failureToneOf("failed")).toBe("danger");
    expect(failureToneOf("denied")).toBe("neutral");
    expect(failureToneOf("interrupted")).toBe("neutral");
    expect(failureToneOf("hookBlocked")).toBe("warning");
    expect(failureToneOf("guard")).toBe("warning");
    expect(failureToneOf("sandbox")).toBe("warning");
  });
});

describe("plan", () => {
  test("결과 글에서 판과 상태를 읽고, 모양이 다르면 null", () => {
    expect(planResultOf("Plan p1 v3: Approved")).toEqual({ version: 3, state: "approved" });
    expect(planResultOf("Plan p1 v1: awaiting user approval")).toEqual({
      version: 1,
      state: "pending",
    });
    expect(planResultOf("Plan p1 v2: Revision requested. Notes")).toEqual({
      version: 2,
      state: "revise",
    });
    expect(planResultOf("done")).toBeNull();
  });

  test("인자는 제목과 본문이고 모양이 틀리면 빈 글", () => {
    expect(planArgsOf({ title: "이전", body: "1. a" })).toEqual({ title: "이전", body: "1. a" });
    expect(planArgsOf({ title: 3 })).toEqual({ title: "", body: "" });
  });
});

describe("activitySummaryOf", () => {
  test("범주별 개수를 가운뎃점으로 잇는다", () => {
    const summary = activitySummaryOf([
      { name: "read", args: { path: "a.ts" }, server: null },
      { name: "read", args: { path: "b.ts" }, server: null },
      { name: "read", args: { path: "c.ts" }, server: null },
      { name: "bash", args: { command: "ls" }, server: null },
      { name: "bash", args: { command: "pwd" }, server: null },
    ]);
    expect(summary).toBe(
      `${t("desktop.convo.group.read", { count: 3 })} · ${t("desktop.convo.group.command", { count: 2 })}`,
    );
  });

  test("읽은 파일이 둘 이하면 이름을 적는다", () => {
    const summary = activitySummaryOf([
      { name: "read", args: { path: "src/a.ts" }, server: null },
      { name: "read", args: { path: "src/b.ts" }, server: null },
    ]);
    expect(summary).toBe(t("desktop.convo.group.readNames", { names: "a.ts, b.ts" }));
  });
});

const LEAD: LeadSegment = {
  leaseId: "lease-1",
  scopeId: "ext:helm",
  epoch: 1,
  active: false,
  acquiredSeq: 1,
  acquiredAt: "2026-11-11T00:00:00.000Z",
  releasedSeq: 9,
  releasedAt: "2026-11-11T00:05:00.000Z",
  releaseReason: "budget",
  limits: { maxTurns: 8, maxTokens: 50_000 },
  turnIds: [trn(1)],
  used: { turns: 3, tokens: 46_000, spawns: 0 },
};

describe("lead", () => {
  test("이름은 scope의 ext: 접두를 뗀다", () => {
    expect(leaderNameOf("ext:helm")).toBe("helm");
    expect(leaderNameOf("helm")).toBe("helm");
  });

  test("한도 칸은 한도가 있는 것만, 90%를 넘으면 경고다", () => {
    expect(leadMetersOf(LEAD)).toEqual([
      { text: t("desktop.convo.lead.turns", { used: 3, max: 8 }), warn: false },
      { text: "토큰 4.6만/5만", warn: true },
    ]);
  });

  test("반납 사유 글", () => {
    expect(releaseTextOf(LEAD)).toBe(t("desktop.convo.lead.release.budget", { name: "helm" }));
    expect(releaseTextOf({ ...LEAD, releaseReason: "disabled" })).toBe(
      t("desktop.convo.lead.release.revoked", { name: "helm" }),
    );
  });
});

describe("markerTextOf", () => {
  test("갈래 이동 사유마다 다른 글이다", () => {
    const at = "2026-11-11T00:00:00.000Z";
    const moved = (reason: "branch" | "rewind" | "restore"): string =>
      markerTextOf({ seq: 1, at, change: { kind: "leaf_moved", reason, leafEventId: evt(1) } });
    expect(moved("branch")).toBe(t("desktop.convo.marker.branched"));
    expect(moved("rewind")).toBe(t("desktop.convo.marker.rewound"));
    expect(moved("restore")).toBe(t("desktop.convo.marker.restored"));
  });

  test("모델 바꿈은 화면 이름으로, 권한 모드는 칩과 같은 이름으로 적는다", () => {
    const at = "2026-11-11T00:00:00.000Z";
    const model = {
      seq: 2,
      at,
      change: { kind: "model", model: "anthropic/claude-sonnet-5-5" },
    } as const;
    expect(markerTextOf(model)).toBe("모델을 Claude Sonnet 5.5(으)로 바꿈");
    expect(markerTextOf(model, () => "Sonnet")).toBe("모델을 Sonnet(으)로 바꿈");
    const mode = (value: string | null): string =>
      markerTextOf({ seq: 3, at, change: { kind: "permission_mode", value } });
    expect(mode("acceptEdits")).toBe("권한 모드: 편집 자동 허용");
    expect(mode("plan")).toBe("권한 모드: 계획 모드");
    expect(mode("bypass")).toBe("권한 모드: 모두 허용");
    expect(mode("default")).toBe("권한 모드: 실행마다 묻기");
    expect(mode("custom")).toBe("권한 모드: custom");
    expect(mode(null)).toBe("권한 모드를 기본으로 되돌림");
  });
});

function turnOf(over: Partial<TurnSummary>): TurnSummary {
  return {
    turnId: trn(1),
    origin: "user",
    startedSeq: 1,
    inputItemIds: [],
    leadScopeId: null,
    model: null,
    startedAt: "2026-11-11T00:00:00.000Z",
    running: false,
    aborting: false,
    abort: null,
    steps: 1,
    durationMs: 2_200,
    usage: null,
    rawUsage: null,
    end: null,
    stopReason: null,
    warnings: [],
    notices: [],
    lastContextTokens: null,
    ...over,
  };
}

const GREETING_USAGE = {
  input: 12,
  output: 400,
  cacheRead: 0,
  cacheWrite: 13_100,
  totalTokens: 13_512,
  cost: 0.0006,
};

describe("turn foot", () => {
  test("새로 쓴 토큰은 출력 + 캐시 안 된 입력이다", () => {
    expect(newTokensOf(GREETING_USAGE)).toBe(412);
  });

  test("메타는 이번 턴이 새로 쓴 토큰을 앞세우고 모델은 화면 이름이다", () => {
    expect(turnMetaOf(turnOf({ usage: GREETING_USAGE }))).toBe("1단계 · 2.2초 · 새로 412 토큰");
    expect(
      turnMetaOf(
        turnOf({
          usage: { ...GREETING_USAGE, input: 30_000, cacheRead: 200_000 },
          model: "anthropic/claude-sonnet-5-5",
        }),
      ),
    ).toBe("1단계 · 2.2초 · 새로 3만 토큰 · Claude Sonnet 5.5");
  });

  test("상세는 전체(캐시 포함)·입력·출력·캐시·비용·모델 참조 순이다", () => {
    expect(
      turnDetailLinesOf(turnOf({ usage: GREETING_USAGE, model: "anthropic/claude-sonnet-5-5" })),
    ).toEqual([
      "전체 13,512 토큰(캐시 포함)",
      "입력 12 토큰",
      "출력 400 토큰",
      "캐시 읽기 0 · 쓰기 13,100",
      t("desktop.convo.foot.cost", { cost: 0.0006 }),
      "anthropic/claude-sonnet-5-5",
    ]);
    expect(turnDetailLinesOf(turnOf({}))).toEqual([]);
  });
});
