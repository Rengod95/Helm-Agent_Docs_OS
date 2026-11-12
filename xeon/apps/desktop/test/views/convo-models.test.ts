import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { LeadSegment } from "../../src/state/engine/index.ts";
import { activitySummaryOf } from "../../src/views/convo/activity-model.ts";
import {
  leaderNameOf,
  leadMetersOf,
  markerTextOf,
  releaseTextOf,
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
      { text: t("desktop.convo.lead.tokens", { used: 46_000, max: 50_000 }), warn: true },
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
    expect(markerTextOf({ seq: 2, at, change: { kind: "model", model: "m-2" } })).toBe(
      t("desktop.convo.marker.model", { model: "m-2" }),
    );
  });
});
