import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { activeLocale, catalogOf, setActiveLocale, type Locale } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import type { EngineMirror, EngineState } from "../../src/state/engine/index.ts";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import { createUiStore } from "../../src/state/ui/store.ts";
import { PluginUiProvider } from "../../src/views/plugin/plugin-context.tsx";
import { Providers } from "../../src/views/providers.tsx";
import {
  engineDescriptionOf,
  engineDotOf,
  liveDotOf,
  liveKindsOf,
  LiveList,
  liveRowsOf,
  StatusBar,
  type LiveRow,
} from "../../src/views/status-bar.tsx";
import { fakeCommands } from "./fake-commands.ts";
import { emptyPluginUi } from "./plugin/support.tsx";
import { evt, harness, STORE, SUB, summary, thr, trn } from "../state/helpers.ts";

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
  test("the dot follows the engine state", () => {
    expect(engineDotOf(RUNNING)).toBe("success");
    expect(engineDotOf(RESTARTING)).toBe("warning");
    expect(engineDotOf(FAILED)).toBe("danger");
    expect(engineDotOf({ kind: "stopped" })).toBe("neutral");
    expect(engineDotOf(null)).toBe("neutral");
    expect(engineDotOf(undefined)).toBe("neutral");
  });

  test("only a failed or restarting engine adds a sentence to its popover", () => {
    expect(engineDescriptionOf(FAILED)).toBe("desktop.status.cell.engine.failed");
    expect(engineDescriptionOf(RESTARTING)).toBe("desktop.status.cell.engine.restarting");
    expect(engineDescriptionOf(RUNNING)).toBeUndefined();
    expect(engineDescriptionOf(null)).toBeUndefined();
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

  test("the dot is danger only while a row failed, and no dot otherwise", () => {
    const failed: LiveRow = {
      kind: "schedule",
      threadId: thr(2),
      title: null,
      failed: true,
      reason: "rate_limited",
    };
    const running: LiveRow = {
      kind: "thread",
      threadId: thr(1),
      title: null,
      failed: false,
      reason: null,
    };
    expect(liveDotOf([running, failed])).toBe("danger");
    expect(liveDotOf([running])).toBeUndefined();
    expect(liveDotOf([])).toBeUndefined();
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
    expect(html).toContain("실패 · rate_limited");
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
});

/** 예약 대화 하나가 turn 실패로 끝난 거울. 거울의 입력을 실제 순서대로 넣는다 */
function mirrorWithFailure(): EngineMirror {
  const h = harness();
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

  test("the live cell's dot turns danger when a scheduled conversation's last turn failed", () => {
    const html = barWith(mirrorWithFailure());
    const live = html.slice(html.indexOf('data-bar-cell="live"'));
    expect(live.slice(0, live.indexOf("</button>"))).toContain('data-bar-dot="danger"');
  });

  test("without a failure the live cell draws no dot", () => {
    const h = harness();
    h.store.ingest({ type: "engine", state: RUNNING });
    h.store.flush();
    const html = barWith(h.store.read.getState());
    const live = html.slice(html.indexOf('data-bar-cell="live"'));
    expect(live.slice(0, live.indexOf("</button>"))).not.toContain("data-bar-dot");
  });
});

/** 상태가 바뀌지 않는 스토어. 서버 렌더가 읽는 처음 상태가 곧 이 상태다 */
function frozenStore(state: EngineMirror): ReadonlyStore<EngineMirror> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

describe("status bar server render", () => {
  test("each cell draws its text, its dot, and its count from the mirror", () => {
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
    expect(html).toContain('data-bar-cell="engine"');
    expect(html).toContain("엔진 시작 실패");
    expect(html).toContain('data-bar-dot="danger"');
    expect(html).toContain('data-bar-cell="link"');
    expect(html).toContain("연결 없음");
    expect(html).toContain('data-bar-cell="live"');
    expect(html).toContain("진행 중 2");
    expect(html).not.toContain("끝난 대화");
  });
});
