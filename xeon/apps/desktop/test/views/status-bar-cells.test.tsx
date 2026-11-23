import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { activeLocale, catalogOf, setActiveLocale, t, type Locale } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import { THREADLESS_NOTICE_SEQ_BASE, type Notice } from "@fresnel/contracts/capabilities";
import type { ThreadSummary } from "@fresnel/contracts/wire";
import type { EngineMirror, EngineState } from "../../src/state/engine/index.ts";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import { createUiStore, type UiState } from "../../src/state/ui/store.ts";
import { PluginUiProvider } from "../../src/views/plugin/plugin-context.tsx";
import { Providers } from "../../src/views/providers.tsx";
import {
  CONTEXT_NEAR_PERCENT,
  ContextCell,
  contextNearOf,
  contextTextOf,
  engineDescriptionOf,
  engineHealthOf,
  goalCellOf,
  goalShownOf,
  healthOf,
  linkDescriptionOf,
  liveKindsOf,
  LiveList,
  liveRowsOf,
  SandboxOffCell,
  scheduleFailureRowOf,
  StatusBar,
  tokensDescriptionOf,
  type LiveRow,
} from "../../src/views/status-bar.tsx";
import { fakeCommands } from "./fake-commands.ts";
import { emptyPluginUi } from "./plugin/support.tsx";
import { approvalRequest, evt, harness, STORE, SUB, summary, thr, trn } from "../state/helpers.ts";

// 상태 표시줄의 칸(B-09, d02). 점과 글, Popover 설명과 진행 중 묶음을 값으로 본다.
// Popover의 본문은 열 때만 그려서 서버 렌더에는 나오지 않으므로, 본문의 묶음은 `liveRowsOf`로 시험한다.

const EXIT = { code: 1, signal: null, at: "2026-11-03T00:00:00.000Z" } as const;
const RUNNING: EngineState = { kind: "running", source: "sidecar", pid: 1 };
const FAILED: EngineState = { kind: "failed", attempts: 3, lastExit: EXIT };
const RESTARTING: EngineState = {
  kind: "restarting",
  attempt: 1,
  retryAt: "2026-11-03T00:00:05.000Z",
  lastExit: EXIT,
};
const TEST_RUN = { profileId: null, target: null, paused: false } as const;

describe("status bar engine cell", () => {
  test("the health level follows the engine state: ok, passing (busy), stopped (idle) or failed", () => {
    expect(engineHealthOf(RUNNING)).toBe("ok");
    expect(engineHealthOf(RESTARTING)).toBe("busy");
    expect(engineHealthOf(FAILED)).toBe("failed");
    expect(engineHealthOf({ kind: "stopped" })).toBe("idle");
    expect(engineHealthOf(null)).toBe("busy");
    expect(engineHealthOf(undefined)).toBe("busy");
  });

  test("a running, failed or restarting engine adds a sentence to its popover", () => {
    expect(engineDescriptionOf(FAILED)).toBe("desktop.status.cell.engine.failed");
    expect(engineDescriptionOf(RESTARTING)).toBe("desktop.status.cell.engine.restarting");
    expect(engineDescriptionOf(RUNNING)).toBe("desktop.status.cell.engine.running");
    expect(engineDescriptionOf(null)).toBeUndefined();
  });

  test("the health cell says nothing when all is well, and names only what is wrong", () => {
    const local = { kind: "local" } as const;
    const remote = { kind: "remote", address: "unix:/run/box.sock", label: "box" } as const;
    expect(healthOf(RUNNING, "live", 0, local)).toEqual({
      text: null,
      tone: undefined,
      busy: false,
    });
    expect(healthOf(RUNNING, "live", 0, remote)).toEqual({
      text: "원격 box",
      tone: undefined,
      busy: false,
    });
    expect(healthOf(RUNNING, "resync", 2, local)).toEqual({
      text: "다시 맞추는 중 (2/3)",
      tone: undefined,
      busy: true,
    });
    expect(healthOf(RUNNING, "failed", 0, local)).toEqual({
      text: "연결 복구 실패",
      tone: "danger",
      busy: false,
    });
    expect(healthOf(RUNNING, "offline", 0, local)).toEqual({
      text: "연결 없음",
      tone: undefined,
      busy: false,
    });
    expect(healthOf(RESTARTING, "offline", 0, local)).toEqual({
      text: "엔진 다시 시작 중",
      tone: undefined,
      busy: true,
    });
    expect(healthOf(FAILED, "offline", 0, local)).toEqual({
      text: "엔진 시작 실패",
      tone: "danger",
      busy: false,
    });
  });
});

describe("status bar in-progress cell", () => {
  test("running conversations split into conversations, test conversations and schedules, in list order", () => {
    const rows = liveRowsOf(
      [
        summary(thr(1), { status: "running", title: "캐시 무효화 조사" }),
        summary(thr(2), { status: "idle", title: "끝난 대화" }),
        summary(thr(3), { status: "running", title: "렌즈 5개로 넓히기", testRun: TEST_RUN }),
        summary(thr(4), {
          status: "running",
          title: null,
          origin: { kind: "schedule", scheduleId: "daily" },
        }),
        summary(thr(5), { status: "closed", title: "닫은 대화" }),
      ],
      {},
    );
    expect(rows).toEqual([
      { kind: "thread", threadId: thr(1), title: "캐시 무효화 조사", failed: false, reason: null },
      { kind: "trial", threadId: thr(3), title: "렌즈 5개로 넓히기", failed: false, reason: null },
      { kind: "schedule", threadId: thr(4), title: null, failed: false, reason: null },
    ]);
  });

  test("no running conversation gives no rows, so the popover shows its empty line", () => {
    expect(liveRowsOf([summary(thr(1), { status: "idle" })], {})).toEqual([]);
  });

  test("a schedule conversation whose last turn failed is a failed row with its reason, ahead of the running rows", () => {
    const rows = liveRowsOf(
      [
        summary(thr(1), { status: "running", title: "캐시 무효화 조사" }),
        summary(thr(2), {
          status: "idle",
          title: "매일 정리",
          origin: { kind: "schedule", scheduleId: "daily" },
        }),
        summary(thr(3), { status: "idle", title: "사용자가 낸 실패" }),
        summary(thr(4), {
          status: "running",
          title: "예약 실행 중",
          origin: { kind: "schedule", scheduleId: "hourly" },
        }),
      ],
      { [thr(2)]: "rate_limited", [thr(3)]: "사용자 대화의 실패는 목록에 오르지 않는다" },
    );
    expect(rows).toEqual([
      {
        kind: "schedule",
        threadId: thr(2),
        title: "매일 정리",
        failed: true,
        reason: "rate_limited",
      },
      { kind: "thread", threadId: thr(1), title: "캐시 무효화 조사", failed: false, reason: null },
      { kind: "schedule", threadId: thr(4), title: "예약 실행 중", failed: false, reason: null },
    ]);
  });

  test("a group with a failed row moves to the top, the other groups keep their order", () => {
    const failed: LiveRow = {
      kind: "schedule",
      threadId: thr(2),
      title: null,
      failed: true,
      reason: "x",
    };
    const thread: LiveRow = {
      kind: "thread",
      threadId: thr(1),
      title: null,
      failed: false,
      reason: null,
    };
    const trial: LiveRow = { ...thread, kind: "trial", threadId: thr(3) };
    expect(liveKindsOf([thread, trial, failed])).toEqual(["schedule", "thread", "trial"]);
    // 실패가 없으면 묶음 순서는 그대로다(빈 묶음은 `LiveList`가 그리지 않는다)
    expect(liveKindsOf([thread, trial])).toEqual(["thread", "trial", "schedule"]);
  });

  test("the popover list shows the failed row's icon face, its words and its reason", () => {
    const html = renderToString(
      <LiveList
        rows={[
          {
            kind: "thread",
            threadId: thr(1),
            title: "캐시 무효화 조사",
            failed: false,
            reason: null,
          },
          {
            kind: "schedule",
            threadId: thr(2),
            title: "매일 정리",
            failed: true,
            reason: "rate_limited",
          },
        ]}
        goTo={null}
        close={() => {}}
      />,
    );
    expect(html.indexOf("예약")).toBeLessThan(html.indexOf("대화</h3>"));
    expect(html).toContain("매일 정리");
    expect(html).toContain("실패 (rate_limited)");
    expect(html.match(/bg-danger-soft text-danger-text/g)?.length).toBe(1);
  });

  test("a row with no reason shows no failure line and no icon face", () => {
    const html = renderToString(
      <LiveList
        rows={[
          {
            kind: "thread",
            threadId: thr(1),
            title: "캐시 무효화 조사",
            failed: false,
            reason: null,
          },
        ]}
        goTo={null}
        close={() => {}}
      />,
    );
    expect(html).toContain("캐시 무효화 조사");
    expect(html).not.toContain("실패");
    expect(html).not.toContain("bg-danger-soft");
  });

  test("the failed-row sentence exists in ko and en with the reason placeholder", () => {
    const locales: readonly Locale[] = ["ko", "en"];
    for (const locale of locales) {
      expect(catalogOf(locale)["desktop.status.cell.live.failed"]).toMatch(/\{reason\}/);
    }
  });

  test("the scheduled-run failure sentence exists in ko and en with the reason placeholder", () => {
    const locales: readonly Locale[] = ["ko", "en"];
    for (const locale of locales) {
      expect(catalogOf(locale)["desktop.status.cell.live.scheduleRunFailed"]).toMatch(/\{reason\}/);
    }
  });

  test("a scheduled run that failed before its conversation opened is a failed row with its reason, no thread, ahead of the running rows", () => {
    const threadless: Notice = {
      kind: "error",
      title: "예약 작업이 실패했어요",
      body: "start_failed",
      seq: THREADLESS_NOTICE_SEQ_BASE + 3,
      sourceType: "schedule.run_finished",
      createdAt: 100,
    };
    const rows = liveRowsOf(
      [summary(thr(1), { status: "running", title: "캐시 무효화 조사" })],
      {},
      [threadless],
    );
    expect(rows).toEqual([
      {
        kind: "schedule",
        threadId: null,
        title: null,
        failed: true,
        reason: t("desktop.schedules.runs.reason.startFailed"),
      },
      { kind: "thread", threadId: thr(1), title: "캐시 무효화 조사", failed: false, reason: null },
    ]);
  });

  test("the schedule row of a thread-less failure is its own row, built from the notice's reason code", () => {
    const row = scheduleFailureRowOf({
      kind: "error",
      title: "예약 작업이 실패했어요",
      body: "run_failed",
      seq: THREADLESS_NOTICE_SEQ_BASE + 4,
      sourceType: "schedule.run_finished",
      createdAt: 200,
    });
    expect(row.reason).toBe(t("desktop.schedules.runs.reason.runFailed"));
    expect(row.reason).not.toContain("run_failed");
  });

  test("a thread-less failure alone moves the schedule group to the top", () => {
    const failedThreadless: LiveRow = {
      kind: "schedule",
      threadId: null,
      title: null,
      failed: true,
      reason: "x",
    };
    const thread: LiveRow = {
      kind: "thread",
      threadId: thr(1),
      title: null,
      failed: false,
      reason: null,
    };
    expect(liveKindsOf([thread, failedThreadless])).toEqual(["schedule", "thread", "trial"]);
  });

  test("the popover shows a thread-less failure as one danger line with its sentence and no conversation name", () => {
    const html = renderToString(
      <LiveList
        rows={[
          {
            kind: "schedule",
            threadId: null,
            title: null,
            failed: true,
            reason: t("desktop.schedules.runs.reason.startFailed"),
          },
        ]}
        goTo={null}
        close={() => {}}
      />,
    );
    expect(html).toContain(
      t("desktop.status.cell.live.scheduleRunFailed", {
        reason: t("desktop.schedules.runs.reason.startFailed"),
      }),
    );
    expect(html).toContain("bg-danger-soft text-danger-text");
    expect(html).not.toContain("제목 없음");
    expect(html).not.toContain("<button");
  });
});

/** 예약 대화 하나가 turn 실패로 끝난 거울. 거울의 입력을 실제 순서대로 넣는다 */
function mirrorWithFailure(): EngineMirror {
  const h = harness();
  h.store.ingest({ type: "engine", state: RUNNING });
  h.store.ingest({
    type: "subscribed",
    sub: SUB,
    storeId: STORE,
    start: 5,
    live: true,
    from: "head",
  });
  h.store.ingest({
    type: "threads",
    threads: [
      summary(thr(2), {
        status: "idle",
        title: "매일 정리",
        origin: { kind: "schedule", scheduleId: "daily" },
      }),
    ],
  });
  h.store.ingest({
    type: "batch",
    sub: SUB,
    from: 5,
    to: 6,
    caughtUp: true,
    facts: [
      {
        type: "turn.completed",
        seq: 6,
        eventId: evt(6),
        threadId: thr(2),
        turnId: trn(1),
        at: "t",
        payload: { status: "failed", stepCount: 0, usage: null, error: "rate_limited" },
      },
    ],
  });
  h.store.flush();
  return h.store.read.getState();
}

/**
 * 이 연결에서 시작한 예약 대화가 실패로 끝난 거울. `thread.list`를 읽지 않았고, 출처는 예약 입력 사실(`input.queued`)에서 온다.
 */
function mirrorWithLiveScheduleFailure(): EngineMirror {
  const h = harness();
  // 진행 중 칸은 엔진이 돌 때만 그린다(fxRM)
  h.store.ingest({ type: "engine", state: RUNNING });
  h.store.ingest({
    type: "subscribed",
    sub: SUB,
    storeId: STORE,
    start: 4,
    live: true,
    from: "head",
  });
  h.store.ingest({
    type: "batch",
    sub: SUB,
    from: 4,
    to: 8,
    caughtUp: true,
    facts: [
      {
        type: "thread.started",
        seq: 5,
        eventId: evt(5),
        threadId: thr(2),
        turnId: null,
        at: "t",
        payload: { title: "매일 정리", forkedFrom: null },
      },
      {
        type: "input.queued",
        seq: 6,
        eventId: evt(6),
        threadId: thr(2),
        turnId: null,
        at: "t",
        input: {
          mode: "followUp",
          requestId: "sched-1",
          sourceType: "schedule",
          scheduleId: "daily",
          preview: { kind: "text", text: "캐시를 정리한다" },
        },
      },
      { type: "turn.started", seq: 7, eventId: evt(7), threadId: thr(2), turnId: trn(1), at: "t" },
      {
        type: "turn.completed",
        seq: 8,
        eventId: evt(8),
        threadId: thr(2),
        turnId: trn(1),
        at: "t",
        payload: { status: "failed", stepCount: 0, usage: null, error: "rate_limited" },
      },
    ],
  });
  h.store.flush();
  return h.store.read.getState();
}

/** 상태 표시줄 전체를 주어진 거울로 그린다 */
function barWith(state: EngineMirror): string {
  return renderToString(
    <Providers engine={frozenStore(state)} ui={createUiStore().read} commands={fakeCommands()}>
      <PluginUiProvider value={emptyPluginUi()}>
        <StatusBar />
      </PluginUiProvider>
    </Providers>,
  );
}

describe("status bar in-progress cell with a failed schedule", () => {
  let previous: Locale = "ko";
  beforeEach(() => {
    previous = activeLocale();
    setActiveLocale("ko");
  });
  afterEach(() => {
    setActiveLocale(previous);
  });

  test("a scheduled conversation whose last turn failed draws a danger failed cell, no dot", () => {
    const html = barWith(mirrorWithFailure());
    expect(cellTextOf(html, "failed")).toBe("예약 실패 1");
    const failed = html.slice(html.indexOf('data-bar-cell="failed"'));
    expect(failed.slice(0, failed.indexOf("</button>"))).toContain('data-bar-tone="danger"');
    expect(html).not.toContain("data-bar-dot");
  });

  test("with nothing running and no failure there is no live cell at all", () => {
    expect(cellIdsOf(barWith(liveMirror([])))).toEqual([]);
  });

  test("the live cell is a plain count with no dot and no failed cell beside it", () => {
    const html = barWith(
      liveMirror([summary(thr(1), { status: "running", title: "캐시 무효화 조사" })]),
    );
    expect(cellIdsOf(html)).toEqual(["live"]);
    const live = html.slice(html.indexOf('data-bar-cell="live"'));
    const face = live.slice(0, live.indexOf("</button>"));
    expect(face).not.toContain("data-bar-dot");
    expect(face).not.toContain("data-bar-tone");
    expect(face).toContain('title="실행 중 탭 열기"');
  });

  test("a schedule run started on this connection lands in the schedule group with its failure row first", () => {
    const state = mirrorWithLiveScheduleFailure();
    expect(state.threads.byId[thr(2)]?.origin).toEqual({ kind: "schedule", scheduleId: "daily" });
    expect(liveRowsOf(Object.values(state.threads.byId), state.turnFailures)).toEqual([
      {
        kind: "schedule",
        threadId: thr(2),
        title: "매일 정리",
        failed: true,
        reason: "rate_limited",
      },
    ]);
    const html = barWith(state);
    expect(cellTextOf(html, "failed")).toBe("예약 실패 1");
  });
});

/** 상태가 바뀌지 않는 스토어. 서버 렌더가 읽는 처음 상태가 곧 이 상태다 */
function frozenStore(state: EngineMirror): ReadonlyStore<EngineMirror> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

describe("status bar server render", () => {
  test("a failed engine draws one health cell with the failure, with no in-progress count", () => {
    const h = harness();
    h.store.ingest({ type: "engine", state: FAILED });
    h.store.ingest({
      type: "threads",
      threads: [
        summary(thr(1), { status: "running", title: "캐시 무효화 조사" }),
        summary(thr(3), { status: "running", title: "렌즈 5개로 넓히기", testRun: TEST_RUN }),
        summary(thr(2), { status: "idle", title: "끝난 대화" }),
      ],
    });
    h.store.flush();
    const html = renderToString(
      <Providers
        engine={frozenStore(h.store.read.getState())}
        ui={createUiStore().read}
        commands={fakeCommands()}
      >
        <PluginUiProvider value={emptyPluginUi()}>
          <StatusBar />
        </PluginUiProvider>
      </Providers>,
    );
    expect(cellTextOf(html, "health")).toBe("엔진 시작 실패");
    expect(html).not.toContain("data-bar-dot");
    expect(html).toContain('data-bar-tone="danger"');
    expect(html).not.toContain('data-bar-cell="engine"');
    expect(html).not.toContain('data-bar-cell="link"');
    expect(html).not.toContain('data-bar-cell="live"');
    expect(html).not.toContain("진행 중 2");
    expect(html).not.toContain("끝난 대화");
  });

  test("a running engine on a live link draws the in-progress count from the mirror", () => {
    const html = barWith(
      liveMirror([
        summary(thr(1), { status: "running", title: "캐시 무효화 조사" }),
        summary(thr(3), { status: "running", title: "렌즈 5개로 넓히기", testRun: TEST_RUN }),
        summary(thr(2), { status: "idle", title: "끝난 대화" }),
      ]),
    );
    expect(cellTextOf(html, "live")).toBe("진행 중 2");
    expect(html).not.toContain("끝난 대화");
  });
});

/** 대화 하나가 돌고 승인 하나가 기다리는 거울. 승인은 `approval.requested` 사실로 넣는다 */
function mirrorWithApproval(kind: "tool" | "question" = "tool"): EngineMirror {
  const h = harness();
  h.store.ingest({ type: "engine", state: RUNNING });
  h.store.ingest({
    type: "subscribed",
    sub: SUB,
    storeId: STORE,
    start: 5,
    live: true,
    from: "head",
  });
  h.store.ingest({
    type: "threads",
    threads: [summary(thr(1), { status: "running", title: "캐시 무효화 조사" })],
  });
  h.store.ingest({
    type: "batch",
    sub: SUB,
    from: 5,
    to: 6,
    caughtUp: true,
    facts: [
      {
        type: "approval.requested",
        seq: 6,
        eventId: evt(6),
        threadId: thr(1),
        turnId: null,
        at: "t",
        request:
          kind === "question"
            ? approvalRequest(thr(1))
            : {
                ...approvalRequest(thr(1)),
                body: {
                  kind: "tool",
                  tool: {
                    toolName: "bash",
                    risk: "write",
                    args: { command: "ls" },
                    argsHash: "h",
                    ruleId: null,
                  },
                },
              },
      },
    ],
  });
  h.store.flush();
  return h.store.read.getState();
}

/** 상태 표시줄을 주어진 거울과 ui 상태로 그린다. 서버 렌더는 시작 상태를 읽으므로 고른 상태를 두 값으로 준다 */
function barWithUi(state: EngineMirror, ui: UiState): string {
  const frozenUi: ReadonlyStore<UiState> = {
    getState: () => ui,
    getInitialState: () => ui,
    subscribe: () => () => {},
  };
  return renderToString(
    <Providers engine={frozenStore(state)} ui={frozenUi} commands={fakeCommands()}>
      <PluginUiProvider value={emptyPluginUi()}>
        <StatusBar />
      </PluginUiProvider>
    </Providers>,
  );
}

/** 칸의 식별자가 HTML에 나타나는 순서 */
const cellIdsOf = (html: string): string[] =>
  [...html.matchAll(/data-bar-cell="([^"]*)"/g)].map((match) => match[1] ?? "");

/** 칸 id와 실패 단추 글이 HTML에 나타나는 순서 */
function sequenceOf(html: string): string[] {
  const pattern = /data-bar-cell="([^"]*)"|>(엔진 다시 시작|다시 연결|진단 복사)</g;
  return [...html.matchAll(pattern)].map((match) => match[1] ?? match[2] ?? "");
}

/** 칸의 글을 HTML에서 읽는다. 칸이 없으면 null */
function cellTextOf(html: string, cellId: string): string | null {
  const from = html.indexOf(`data-bar-cell="${cellId}"`);
  if (from < 0) return null;
  const match = /data-bar-text[^>]*>([^<]*)</.exec(html.slice(from));
  return match?.[1] ?? null;
}

describe("status bar cell order", () => {
  let previous: Locale = "ko";
  beforeEach(() => {
    previous = activeLocale();
    setActiveLocale("ko");
  });
  afterEach(() => {
    setActiveLocale(previous);
  });

  test("a healthy bar is empty on the left, and in-progress then approvals follow the spacer on the right", () => {
    const html = barWith(mirrorWithApproval());
    expect(cellIdsOf(html)).toEqual(["live", "approvals"]);
    const spacer = html.indexOf('class="grow"');
    expect(spacer).toBeLessThan(html.indexOf('data-bar-cell="live"'));
  });

  test("the approval cell reads its count, and is absent when no approval waits", () => {
    const approvals = barWith(mirrorWithApproval());
    expect(cellTextOf(approvals, "approvals")).toBe("승인 대기 1");
    // 점 없이 대화 목록의 확인 수와 같은 따뜻한 글자색·굵기다(DP-206)
    const face = approvals.slice(approvals.indexOf('data-bar-cell="approvals"'));
    expect(face.slice(0, face.indexOf("</button>"))).toContain('data-bar-tone="attention"');
    expect(approvals).toContain("fx-attend-count");
    expect(approvals).not.toContain("data-bar-dot");
    expect(cellIdsOf(barWith(mirrorWithFailure()))).toEqual(["failed"]);
  });

  test("a waiting question is counted as an answer wait, not as an approval", () => {
    const html = barWith(mirrorWithApproval("question"));
    expect(cellIdsOf(html)).toEqual(["live", "questions"]);
    expect(cellTextOf(html, "questions")).toBe("답변 대기 1");
  });

  test("the bar has no settings button, the sidebar footer is the way to settings", () => {
    expect(barWith(mirrorWithApproval())).not.toContain("설정");
  });

  test("failure buttons follow the health cell: restart, then reconnect and copy", () => {
    const h = harness();
    h.store.ingest({ type: "engine", state: FAILED });
    h.store.flush();
    const ui = createUiStore();
    ui.actions.setConnectError("hello:1002");
    // 엔진이 실패했으면 거울의 "진행 중" 수는 오래된 것이라 그 칸은 없다
    expect(sequenceOf(barWithUi(h.store.read.getState(), ui.read.getState()))).toEqual([
      "health",
      "엔진 다시 시작",
      "다시 연결",
      "진단 복사",
    ]);
  });
});

/** 실행 중인 엔진 하나를 든 거울. 엔진 칸의 글이 대상에 따라 어떻게 나는지 본다 */
/** 엔진이 돌고 연결도 live인 거울. 연결이 live가 아니면 엔진 칸은 "시작 중"이다(상태 띠) */
function mirrorRunning(): EngineMirror {
  const h = harness();
  h.store.ingest({ type: "engine", state: RUNNING });
  h.store.ingest({
    type: "subscribed",
    sub: SUB,
    storeId: STORE,
    start: 5,
    live: true,
    from: "head",
  });
  h.store.flush();
  return h.store.read.getState();
}

describe("status bar engine cell names the attached target", () => {
  let previous: Locale = "ko";
  beforeEach(() => {
    previous = activeLocale();
    setActiveLocale("ko");
  });
  afterEach(() => {
    setActiveLocale(previous);
  });

  test("a remote target shows its name on the health cell and the full line to screen readers", () => {
    const ui = createUiStore();
    ui.actions.setEngineTarget({
      kind: "remote",
      address: "unix:/run/box.sock",
      label: "build-box",
    });
    const html = barWithUi(mirrorRunning(), ui.read.getState());
    expect(cellTextOf(html, "health")).toBe("원격 build-box");
    expect(html).toContain(
      '<span role="status" class="sr-only">엔진 실행 중 (원격 build-box)</span>',
    );
  });

  test("a running process whose link is not live yet shows the link state in words, with no dot", () => {
    const h = harness();
    h.store.ingest({ type: "engine", state: RUNNING });
    h.store.flush();
    const html = barWithUi(h.store.read.getState(), createUiStore().read.getState());
    expect(cellTextOf(html, "health")).toBe("연결 없음");
    expect(html).not.toContain("data-bar-dot");
  });

  test("this computer on a live link draws no health cell; the hidden status line still names the engine", () => {
    const html = barWithUi(mirrorRunning(), createUiStore().read.getState());
    expect(html).not.toContain('data-bar-cell="health"');
    expect(html).not.toContain("data-bar-dot");
    expect(html).toContain('<span role="status" class="sr-only">엔진 실행 중 (앱 안)</span>');
    expect(html).not.toContain("연결됨<");
  });
});

describe("status bar model and usage cells", () => {
  let previous: Locale = "ko";
  beforeEach(() => {
    previous = activeLocale();
    setActiveLocale("ko");
  });
  afterEach(() => {
    setActiveLocale(previous);
  });

  test("the context cell reads the percent with a bar when the window is known, and the tokens otherwise", () => {
    const known = renderToString(
      <ContextCell usage={{ tokens: 41_000, percent: 40.4, limit: 100_000 }} />,
    );
    expect(cellTextOf(known, "context")).toBe("컨텍스트 40%");
    expect(known).toContain('data-slot="progress"');
    expect(known).toContain("--cs-progress:40%");
    expect(known).not.toContain("data-bar-tone");
    const unknown = renderToString(
      <ContextCell usage={{ tokens: 41_000, percent: null, limit: null }} />,
    );
    expect(cellTextOf(unknown, "context")).toBe("컨텍스트 4.1만");
    expect(unknown).not.toContain('data-slot="progress"');
  });

  test("a context at 80% or more is near the automatic summary and turns the cell to the warning tone", () => {
    expect(CONTEXT_NEAR_PERCENT).toBe(80);
    expect(contextNearOf({ tokens: 79_000, percent: 79.4, limit: 100_000 })).toBe(false);
    expect(contextNearOf({ tokens: 80_000, percent: 80, limit: 100_000 })).toBe(true);
    expect(contextNearOf({ tokens: 900_000, percent: null, limit: null })).toBe(false);
    const html = renderToString(
      <ContextCell usage={{ tokens: 91_000, percent: 91, limit: 100_000 }} />,
    );
    expect(html).toContain('data-bar-tone="warning"');
    expect(contextTextOf({ tokens: 91_000, percent: 91, limit: 100_000 })).toBe("컨텍스트 91%");
  });

  test("collapsible cells keep their text for screen readers, and the context tooltip says the tokens", () => {
    const html = renderToString(
      <ContextCell usage={{ tokens: 41_000, percent: 40, limit: 100_000 }} />,
    );
    expect(html).toContain("data-bar-collapsible");
    expect(html).toContain('title="지금 컨텍스트에 4.1만 토큰이 있고, 컨텍스트 창의 40%예요."');
    expect(html).toContain("data-bar-icon");
    expect(html).toContain("data-bar-trailing");
  });

  test("the sandbox-off cell is a warning cell with its own words", () => {
    const html = renderToString(<SandboxOffCell openSettings={() => {}} />);
    expect(cellTextOf(html, "sandbox")).toBe("샌드박스 꺼짐");
    expect(html).toContain('data-bar-tone="warning"');
  });

  test("the status bar row is not a live region, only the engine line is", () => {
    const html = barWith(mirrorWithApproval());
    expect(html).toContain('<footer class="statusbar">');
    expect(html.match(/role="status"/g)?.length).toBe(1);
    expect(html).toMatch(/<span role="status" class="sr-only">[^<]+<\/span>/);
  });

  test("the tokens sentence names the tokens, and the percent only when the limit is known", () => {
    expect(tokensDescriptionOf({ tokens: 41_000, percent: null, limit: null })).toBe(
      "지금 컨텍스트에 4.1만 토큰이 있어요.",
    );
    expect(tokensDescriptionOf({ tokens: 41_000, percent: 40.4, limit: 100_000 })).toBe(
      "지금 컨텍스트에 4.1만 토큰이 있고, 컨텍스트 창의 40%예요.",
    );
    setActiveLocale("en");
    expect(tokensDescriptionOf({ tokens: 41_000, percent: 40, limit: 100_000 })).toBe(
      "The context holds 41K tokens right now, 40% of the context window.",
    );
  });

  test("the status bar words exist in ko and en with their placeholders", () => {
    const locales: readonly Locale[] = ["ko", "en"];
    for (const locale of locales) {
      expect(catalogOf(locale)["desktop.status.context"]).toMatch(/\{percent\}/);
      expect(catalogOf(locale)["desktop.status.contextTokens"]).toMatch(/\{tokens\}/);
      expect(catalogOf(locale)["desktop.status.approvalsWaiting"]).toMatch(/\{count\}/);
      expect(catalogOf(locale)["desktop.status.liveFailed"]).toMatch(/\{count\}/);
      expect(catalogOf(locale)["desktop.status.sandboxOff"]).toMatch(/\S/);
      expect(catalogOf(locale)["desktop.status.cell.tokens.description"]).toMatch(/\{tokens\}/);
      expect(catalogOf(locale)["desktop.status.cell.tokens.limitDescription"]).toMatch(
        /\{tokens\}.*\{percent\}/,
      );
    }
  });

  test("a selected conversation draws neither cell before a value is read, since the reads run after mount", () => {
    const ui = createUiStore();
    ui.actions.selectThread(thr(1));
    expect(cellIdsOf(barWithUi(mirrorWithApproval(), ui.read.getState()))).toEqual([
      "live",
      "approvals",
    ]);
  });
});

const goal = (status: "active" | "met" | "exhausted" | "cleared") =>
  ({ condition: "c", status, judged: 2, maxJudgments: 3, lastVerdict: null }) as const;

describe("status bar goal cell", () => {
  test("an active goal reads judged over max with its state in the description", () => {
    expect(goalCellOf(goal("active"))).toEqual({
      text: "목표 2/3",
      description: "판정 2/3 (진행 중)",
    });
    expect(goalCellOf(goal("exhausted"))?.description).toBe("판정 2/3 (멈춤)");
  });
  test("no goal or a cleared one leaves no cell", () => {
    expect(goalCellOf(null)).toBeNull();
    expect(goalCellOf(goal("cleared"))).toBeNull();
  });
});

describe("status bar ended goal", () => {
  test("an ended goal stays with its result until the next turn starts, then stays hidden", () => {
    const ended = goal("met");
    const idle = goalShownOf(ended, thr(1), false, null);
    expect(idle.goal).toEqual(ended);
    expect(goalCellOf(idle.goal)?.description).toBe("판정 2/3 (충족)");
    const next = goalShownOf(ended, thr(1), true, idle.dismissed);
    expect(next.goal).toBeNull();
    expect(goalShownOf(ended, thr(1), false, next.dismissed).goal).toBeNull();
  });
  test("an active goal is always shown and a newer ended goal is not hidden by an older dismissal", () => {
    expect(goalShownOf(goal("active"), thr(1), true, null).goal).toEqual(goal("active"));
    const old = goalShownOf(goal("met"), thr(1), true, null);
    const newer = { ...goal("exhausted"), condition: "d" } as const;
    expect(goalShownOf(newer, thr(1), false, old.dismissed).goal).toEqual(newer);
  });
});

/** 실행 중인 엔진과 살아 있는 연결 위의 거울. 연결이 살아 있어야 대화 목록을 믿을 수 있다 */
function liveMirror(threads: readonly ThreadSummary[]): EngineMirror {
  const h = harness();
  h.store.ingest({ type: "engine", state: RUNNING });
  h.store.ingest({
    type: "subscribed",
    sub: SUB,
    storeId: STORE,
    start: 5,
    live: true,
    from: "head",
  });
  h.store.ingest({ type: "threads", threads: [...threads] });
  h.store.flush();
  return h.store.read.getState();
}

describe("status bar in-progress cell follows the engine", () => {
  let previous: Locale = "ko";
  beforeEach(() => {
    previous = activeLocale();
    setActiveLocale("ko");
  });
  afterEach(() => {
    setActiveLocale(previous);
  });

  test("a running engine on a live link counts the running conversations", () => {
    const html = barWith(
      liveMirror([summary(thr(1), { status: "running", title: "캐시 무효화 조사" })]),
    );
    expect(cellIdsOf(html)).toContain("live");
    expect(cellTextOf(html, "live")).toBe("진행 중 1");
  });

  test("a failed engine draws no in-progress cell, though the mirror still lists a running conversation", () => {
    const h = harness();
    h.store.ingest({ type: "engine", state: FAILED });
    h.store.ingest({
      type: "threads",
      threads: [summary(thr(1), { status: "running", title: "캐시 무효화 조사" })],
    });
    h.store.flush();
    const html = barWith(h.store.read.getState());
    expect(cellIdsOf(html)).toEqual(["health"]);
    expect(html).not.toContain("진행 중 1");
  });

  test("a down link under a running engine draws no in-progress cell", () => {
    const stale = liveMirror([summary(thr(1), { status: "running", title: "캐시 무효화 조사" })]);
    const html = barWith({ ...stale, link: { phase: "offline" } });
    expect(cellIdsOf(html)).toEqual(["health"]);
    expect(html).not.toContain("진행 중 1");
  });
});

describe("status bar link cell names the service for a remote target", () => {
  let previous: Locale = "ko";
  beforeEach(() => {
    previous = activeLocale();
    setActiveLocale("ko");
  });
  afterEach(() => {
    setActiveLocale(previous);
  });

  test("a remote link that is down names the service, this computer keeps the engine sentence", () => {
    expect(linkDescriptionOf("offline", true)).toBe("desktop.status.serviceLost");
    expect(linkDescriptionOf("failed", true)).toBe("desktop.status.serviceLost");
    expect(linkDescriptionOf("offline", false)).toBe("desktop.status.cell.link.down");
    expect(linkDescriptionOf("failed", false)).toBe("desktop.status.cell.link.down");
  });

  test("a remote link that is up or catching up keeps the sentence of its phase", () => {
    expect(linkDescriptionOf("live", true)).toBe("desktop.status.cell.link.live");
    expect(linkDescriptionOf("syncing", true)).toBe("desktop.status.cell.link.catchUp");
    expect(linkDescriptionOf("connecting", true)).toBeUndefined();
  });

  test("the failure line of a remote target says the service sentence, this computer's does not", () => {
    const remote = createUiStore();
    remote.actions.setEngineTarget({
      kind: "remote",
      address: "unix:/run/box.sock",
      label: "build-box",
    });
    remote.actions.setConnectError("hello:1002");
    expect(barWithUi(mirrorRunning(), remote.read.getState())).toContain(
      "서비스에 연결할 수 없어요. 서비스가 켜져 있는지 확인한 뒤 다시 연결해요.",
    );
    const local = createUiStore();
    local.actions.setConnectError("hello:1002");
    expect(barWithUi(mirrorRunning(), local.read.getState())).not.toContain(
      "서비스에 연결할 수 없어요",
    );
  });
});
