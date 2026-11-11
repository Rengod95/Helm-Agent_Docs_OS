import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, type Locale } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import type { EngineMirror } from "../../src/state/engine/index.ts";
import { createShellStore, ShellStoreContext } from "../../src/state/shell/index.ts";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import { createUiStore } from "../../src/state/ui/index.ts";
import {
  ScheduleScreenView,
  type ScheduleScreenHandlers,
} from "../../src/views/pages/schedules/schedules-view.tsx";
import {
  ServiceOffNotice,
  ServiceRestartNotice,
} from "../../src/views/pages/schedules/schedule-service-notice.tsx";
import { RunsBody } from "../../src/views/pages/schedules/schedule-runs-sheet.tsx";
import {
  INITIAL_SCHEDULE_STATE,
  noticeOf,
  type RunsState,
  scheduleReducer,
  type ScheduleState,
} from "../../src/views/pages/schedules/schedule-model.ts";
import { message } from "../../src/views/pages/schedules/schedule-text.ts";
import { Providers } from "../../src/views/providers.tsx";
import { ShellRestartContext } from "../../src/views/shell-restart-context.ts";
import type { ScheduleListItem } from "@fresnel/contracts/capabilities";
import { harness } from "../state/helpers.ts";
import { fakeCommands } from "./fake-commands.ts";

// 예약 화면의 서버 렌더. 상태는 reducer로 만들고 동작 핸들러는 아무것도 하지 않는 것으로 둔다.
// 클릭과 키 입력은 DOM이 없어 시험하지 못한다(뜻은 schedule-model.test.ts가 본다).

const NOOP = (): void => {};
const handlers: ScheduleScreenHandlers = {
  filter: NOOP,
  openNew: NOOP,
  retry: NOOP,
  enableService: NOOP,
  dismissNotice: NOOP,
  dismissCancel: NOOP,
  cancel: NOOP,
  sheetChange: NOOP,
  sheetSubmit: NOOP,
  sheetClose: NOOP,
  runsClose: NOOP,
  reenable: NOOP,
  edit: NOOP,
  showRuns: NOOP,
  onKey: NOOP,
  select: NOOP,
  toggleExpanded: NOOP,
  fire: NOOP,
  copy: NOOP,
  askCancel: NOOP,
  openThread: NOOP,
};

// 지역 시각 생성자로 만든 시각이라 어느 시간대에서나 같은 문장이 나온다
const NOW = new Date(2026, 10, 4, 8, 0).getTime();

/** 내일 아침 아홉 시에 도는 간격 예약 한 줄. 마지막 실행은 세 분 전에 끝난 완료다 */
const ROW: ScheduleListItem = {
  entry: {
    id: "sch_aa1",
    trigger: { kind: "interval", everySeconds: 86_400 },
    prompt: "캐시를 정리한다",
    workspace: null,
    title: "캐시 정리",
    sessionKind: "cron",
    enabled: true,
    createdAt: NOW - 86_400_000,
    nextDueAt: new Date(2026, 10, 5, 9, 0).getTime(),
    lastStartedAt: NOW - 180_000,
    iterations: 3,
    stoppedReason: null,
  },
  lastRun: {
    runId: "run_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    scheduleId: "sch_aa1",
    firedBy: "interval",
    dueAt: NOW - 180_000,
    claimedAt: NOW - 180_000,
    missed: false,
    status: "finished",
    threadId: null,
    startedAt: NOW - 180_000,
    endedAt: NOW - 180_000,
    outcome: "completed",
    reason: null,
    skippedCount: 0,
  },
  missedRuns: 0,
};

/** 화면 머리가 셸 스토어(패널 열림 상태)를 읽으므로 셸 맥락 안에서 그린다 */
function html(state: ScheduleState): string {
  return renderToString(
    <ShellStoreContext value={createShellStore(1400)}>
      <ScheduleScreenView state={state} locale="ko" openable={() => false} handlers={handlers} />
    </ShellStoreContext>,
  );
}

/**
 * 엔진이 running인 거울. 서버 렌더는 스토어의 초기 값을 읽으므로 상태를 두 값으로 둔다(safe-mode-view 시험과 같은 방식).
 * 다시 시작 단추는 엔진이 running이고 셸이 있을 때만 나온다.
 */
function runningEngine(): ReadonlyStore<EngineMirror> {
  const h = harness();
  h.store.ingest({ type: "engine", state: { kind: "running", source: "sidecar", pid: 1 } });
  h.store.flush();
  const state = h.store.read.getState();
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => undefined };
}

/** 다시 시작 단추가 달릴 수 있는 맥락(running 엔진, 셸 있음)으로 화면을 그린다 */
function shellHtml(state: ScheduleState, shell: boolean): string {
  const ui = createUiStore();
  return renderToString(
    <ShellRestartContext value={shell}>
      <Providers engine={runningEngine()} ui={ui.read} commands={fakeCommands()}>
        <ShellStoreContext value={createShellStore(1400)}>
          <ScheduleScreenView
            state={state}
            locale="ko"
            openable={() => false}
            handlers={handlers}
          />
        </ShellStoreContext>
      </Providers>
    </ShellRestartContext>,
  );
}

const countOf = (markup: string, text: string): number => markup.split(text).length - 1;

describe("schedules screen server render", () => {
  test("an empty list that has loaded says there are no schedules and offers a new one", () => {
    const loaded = scheduleReducer(INITIAL_SCHEDULE_STATE, {
      type: "listLoaded",
      items: [],
      serviceModeOff: false,
      serviceRestartPending: false,
      nowMs: NOW,
    });
    const markup = html(loaded);
    expect(markup).toContain("예약이 없어요");
    expect(markup).toContain("새 예약");
    expect(markup).not.toContain('data-slot="skeleton"');
    expect(markup).not.toContain("서비스 켜기");
  });

  test("a list that is still loading shows the skeleton, not the empty state", () => {
    const markup = html(INITIAL_SCHEDULE_STATE);
    expect(markup).toContain('data-slot="skeleton"');
    expect(markup).not.toContain("예약이 없어요");
  });

  test("with the service mode off, the warning shows the turn-on action", () => {
    const loaded = scheduleReducer(INITIAL_SCHEDULE_STATE, {
      type: "listLoaded",
      items: [],
      serviceModeOff: true,
      serviceRestartPending: false,
      nowMs: NOW,
    });
    const markup = html(loaded);
    expect(markup).toContain("서비스 모드가 꺼져 있어");
    expect(markup).toContain("서비스 켜기");
  });

  test("the sheet's service notice says quitting the app stops schedules and closing the window does not", () => {
    const markup = renderToString(<ServiceOffNotice canEnable onEnable={NOOP} />);
    expect(markup).toContain("앱을 끝내면(⌘Q) 예약이 멈춰요. 창만 닫으면 계속 돌아요.");
    expect(markup).not.toContain("앱을 끄면");
    expect(markup).toContain("서비스 켜기");
    expect(markup).not.toContain('disabled=""');
  });

  test("the list offers the on and all filters, and the rows show the next run and the last run as ages", () => {
    const withRow = scheduleReducer(INITIAL_SCHEDULE_STATE, {
      type: "listLoaded",
      items: [ROW],
      serviceModeOff: false,
      serviceRestartPending: false,
      nowMs: NOW,
    });
    const markup = html(withRow);
    expect(markup).toContain("켜진 것");
    expect(markup).toContain("모두");
    expect(markup).toContain("내일 09:00");
    expect(markup).toContain("완료");
    expect(markup).toContain("3분 전");
    expect(markup).toContain('aria-label="예약 메뉴"');
  });
});

const body = (runs: RunsState): string =>
  renderToString(
    <RunsBody
      runs={runs}
      title="캐시 정리"
      locale="ko"
      openable={() => false}
      offline={false}
      onOpenThread={NOOP}
      onRetry={NOOP}
      onClose={NOOP}
    />,
  );

describe("service mode turned on, restart pending", () => {
  let previous: Locale = "ko";
  beforeEach(() => {
    previous = activeLocale();
    setActiveLocale("ko");
  });
  afterEach(() => {
    setActiveLocale(previous);
  });

  const enabledWithNotice = scheduleReducer(
    scheduleReducer(INITIAL_SCHEDULE_STATE, {
      type: "listLoaded",
      items: [],
      serviceModeOff: true,
      serviceRestartPending: false,
      nowMs: NOW,
    }),
    { type: "serviceEnabled", restartPending: true },
  );
  const notified = scheduleReducer(enabledWithNotice, {
    type: "notice",
    notice: noticeOf(
      message("desktop.schedules.service.enabledRestart"),
      "success",
      "restartEngine",
    ),
  });

  test("after turning it on, the notice says the engine must restart and one restart button sits with it", () => {
    const markup = shellHtml(notified, true);
    expect(markup).toContain("서비스 모드를 켜 두었어요. 엔진을 다시 시작해야 켜져요.");
    expect(markup).not.toContain("서비스 모드를 켰어요.");
    expect(markup).not.toContain("서비스 켜기");
    expect(markup).not.toContain("서비스 모드가 꺼져 있어");
    expect(countOf(markup, "지금 다시 시작")).toBe(1);
  });

  test("with no notice showing, the banner keeps the restart line and one restart button", () => {
    const pending = scheduleReducer(INITIAL_SCHEDULE_STATE, {
      type: "listLoaded",
      items: [],
      serviceModeOff: false,
      serviceRestartPending: true,
      nowMs: NOW,
    });
    const markup = shellHtml(pending, true);
    expect(markup).toContain("엔진을 다시 시작해야 서비스 모드가 켜져요.");
    expect(markup).not.toContain("서비스 켜기");
    expect(markup).not.toContain("서비스 모드가 꺼져 있어");
    expect(countOf(markup, "지금 다시 시작")).toBe(1);
  });

  test("without a desktop shell the restart line stays as text and shows no button", () => {
    const pending = scheduleReducer(INITIAL_SCHEDULE_STATE, {
      type: "listLoaded",
      items: [],
      serviceModeOff: false,
      serviceRestartPending: true,
      nowMs: NOW,
    });
    const markup = shellHtml(pending, false);
    expect(markup).toContain("엔진을 다시 시작해야 서비스 모드가 켜져요.");
    expect(markup).not.toContain("지금 다시 시작");
  });

  test("once the restart is done the banner and the button are gone", () => {
    const done = scheduleReducer(INITIAL_SCHEDULE_STATE, {
      type: "listLoaded",
      items: [],
      serviceModeOff: false,
      serviceRestartPending: false,
      nowMs: NOW,
    });
    const markup = shellHtml(done, true);
    expect(markup).not.toContain("엔진을 다시 시작해야");
    expect(markup).not.toContain("지금 다시 시작");
    expect(markup).not.toContain("서비스 켜기");
  });
});

/** 셸과 엔진 맥락을 둔 채 부품을 그린다(다시 시작 단추는 엔진이 running이고 셸이 있을 때만 나온다) */
function shellNode(node: ReactNode, shell: boolean): string {
  const ui = createUiStore();
  return renderToString(
    <ShellRestartContext value={shell}>
      <Providers engine={runningEngine()} ui={ui.read} commands={fakeCommands()}>
        {node}
      </Providers>
    </ShellRestartContext>,
  );
}

/** 반복 한 줄이 든 목록을 그린 글. 간격(초)만 바꾼다 */
function rendersLoopEvery(intervalSeconds: number): string {
  const item: ScheduleListItem = {
    ...ROW,
    entry: {
      ...ROW.entry,
      trigger: {
        kind: "repeat",
        intervalSeconds,
        maxIterations: 10,
        expiresAtMs: NOW + 86_400_000,
      },
    },
  };
  return html(
    scheduleReducer(INITIAL_SCHEDULE_STATE, {
      type: "listLoaded",
      items: [item],
      serviceModeOff: false,
      serviceRestartPending: false,
      nowMs: NOW,
    }),
  );
}

describe("sheet restart notice and table rows", () => {
  let previous: Locale = "ko";
  beforeEach(() => {
    previous = activeLocale();
    setActiveLocale("ko");
  });
  afterEach(() => {
    setActiveLocale(previous);
  });

  test("a restart-pending service shows the restart sentence and one restart button in the sheet", () => {
    const markup = shellNode(<ServiceRestartNotice />, true);
    expect(markup).toContain("엔진을 다시 시작해야 서비스 모드가 켜져요.");
    expect(markup).not.toContain("서비스 켜기");
    expect(countOf(markup, "지금 다시 시작")).toBe(1);
  });

  test("without a desktop shell the sheet's restart sentence stays and shows no button", () => {
    const markup = shellNode(<ServiceRestartNotice />, false);
    expect(markup).toContain("엔진을 다시 시작해야 서비스 모드가 켜져요.");
    expect(markup).not.toContain("지금 다시 시작");
  });

  // 끝난 `at`은 엔진이 다시 켜지 않는다(reenableOf). 취소해 시각이 남은 `at`은 켤 수 있다
  const finishedAt: ScheduleListItem = {
    ...ROW,
    entry: {
      ...ROW.entry,
      trigger: { kind: "at", atMs: NOW - 3_600_000 },
      enabled: false,
      nextDueAt: null,
      stoppedReason: "completed",
    },
  };
  const cancelledAt: ScheduleListItem = {
    ...ROW,
    entry: {
      ...ROW.entry,
      trigger: { kind: "at", atMs: NOW + 3_600_000 },
      enabled: false,
      nextDueAt: null,
      stoppedReason: "cancelled",
    },
  };

  test("a finished one-shot schedule has no turn-back-on button, and a cancelled one still does", () => {
    const finished = scheduleReducer(INITIAL_SCHEDULE_STATE, {
      type: "listLoaded",
      items: [finishedAt],
      serviceModeOff: false,
      serviceRestartPending: false,
      nowMs: NOW,
    });
    expect(html(finished)).not.toContain("다시 켜기");
    const cancelled = scheduleReducer(INITIAL_SCHEDULE_STATE, {
      type: "listLoaded",
      items: [cancelledAt],
      serviceModeOff: false,
      serviceRestartPending: false,
      nowMs: NOW,
    });
    expect(html(cancelled)).toContain("다시 켜기");
  });

  test("a loop shows its interval as a human duration, not raw seconds", () => {
    expect(rendersLoopEvery(600)).toContain("10분마다 최대 10회");
    expect(rendersLoopEvery(3600)).toContain("1시간마다 최대 10회");
    expect(rendersLoopEvery(90)).toContain("90초마다 최대 10회");
    expect(rendersLoopEvery(600)).not.toContain("600초마다");
  });

  /** 목록 한 줄을 가진 화면 글. 줄은 `ROW`를 바탕으로 주어진 항목으로 바꾼다 */
  const listOf = (items: readonly ScheduleListItem[]): string =>
    html(
      scheduleReducer(INITIAL_SCHEDULE_STATE, {
        type: "listLoaded",
        items,
        serviceModeOff: false,
        serviceRestartPending: false,
        nowMs: NOW,
      }),
    );

  test("a missed run count shows under the last run with the count and the help icon, and nothing when there are none", () => {
    const markup = listOf([{ ...ROW, missedRuns: 2 }]);
    expect(markup).toContain("놓친 실행 2회");
    expect(markup).toContain('aria-label="놓친 실행 설명"');
    expect(markup).toContain("3분 전");
    expect(listOf([ROW])).not.toContain("놓친 실행");
    expect(listOf([ROW])).not.toContain("놓친 실행 설명");
  });

  test("a watched path outside the allowed folders shows a visible warning with its help icon, and no warning without paths", () => {
    const outside: ScheduleListItem = {
      ...ROW,
      entry: {
        ...ROW.entry,
        trigger: { kind: "file_watch", paths: ["/Users/me/outside"], debounceMs: 1000 },
      },
      outsideWatchPaths: ["/Users/me/outside"],
    };
    const markup = listOf([outside]);
    expect(markup).toContain("허용된 폴더 밖이라 감시되지 않는 경로가 있어요");
    expect(markup).toContain('aria-label="감시 경로 설명"');
    expect(countOf(markup, "허용된 폴더 밖이라")).toBe(1);
    expect(listOf([{ ...outside, outsideWatchPaths: [] }])).not.toContain("허용된 폴더 밖이라");
    expect(listOf([ROW])).not.toContain("허용된 폴더 밖이라");
  });
});

describe("schedule run history body", () => {
  test("each run shows its outcome and its reason as a sentence, not the host's code", () => {
    const out = body({
      kind: "ready",
      scheduleId: "sch_aa1",
      runs: [
        {
          runId: "run_1",
          startedAt: "2026-11-04T00:00:00.000Z",
          endedAt: null,
          outcome: "failed",
          threadId: null,
          error: "start_failed",
          missed: false,
        },
      ],
    });
    expect(out).toContain("실패");
    expect(out).toContain("대화를 시작하지 못했어요. 작업 폴더가 있는지 확인해 주세요.");
    expect(out).not.toContain("start_failed");
  });

  test("a missed run carries the missed badge and its sentence, and an ordinary skip has neither", () => {
    const out = body({
      kind: "ready",
      scheduleId: "sch_aa1",
      runs: [
        {
          runId: "run_2",
          startedAt: "2026-11-04T00:00:00.000Z",
          endedAt: null,
          outcome: "skipped",
          threadId: null,
          error: "missed",
          missed: true,
        },
        {
          runId: "run_3",
          startedAt: "2026-11-04T01:00:00.000Z",
          endedAt: null,
          outcome: "skipped",
          threadId: null,
          error: "min_interval",
          missed: false,
        },
      ],
    });
    expect(out).toContain(">놓친 실행</span>");
    expect(out).toContain("앱이 꺼진 동안 놓친 실행이에요. 따라잡지 않고 건너뛰었어요.");
    expect(out).toContain(
      "직전 실행 뒤 5분이 지나지 않아 건너뛰었어요. 5분 뒤에 다시 눌러 주세요.",
    );
    expect(out.split(">놓친 실행</span>").length - 1).toBe(1);
    expect(out).toContain(
      '<span class="text-ui text-text-secondary">앱이 꺼진 동안 놓친 실행이에요. 따라잡지 않고 건너뛰었어요.</span>',
    );
    expect(out).not.toContain("따라잡아 한 번 실행했어요.");
  });

  test("a missed run that was caught up has the badge and a neutral caught-up line, and no reason line", () => {
    const out = body({
      kind: "ready",
      scheduleId: "sch_aa1",
      runs: [
        {
          runId: "run_5",
          startedAt: "2026-11-04T00:00:00.000Z",
          endedAt: "2026-11-04T00:00:05.000Z",
          outcome: "ok",
          threadId: null,
          error: null,
          missed: true,
        },
      ],
    });
    expect(out.split(">놓친 실행</span>").length - 1).toBe(1);
    expect(out).toContain(
      '<span class="text-ui text-text-secondary">앱이 꺼진 동안 밀린 시각을 따라잡아 한 번 실행했어요.</span>',
    );
    expect(out).not.toContain("앱이 꺼진 동안 놓친 실행이에요");
    expect(out).not.toContain("text-danger-text");
  });

  test("a caught-up run that failed shows the caught-up line and its failure reason in danger text", () => {
    const out = body({
      kind: "ready",
      scheduleId: "sch_aa1",
      runs: [
        {
          runId: "run_6",
          startedAt: "2026-11-04T00:00:00.000Z",
          endedAt: "2026-11-04T00:00:05.000Z",
          outcome: "failed",
          threadId: null,
          error: "run_failed",
          missed: true,
        },
      ],
    });
    expect(out.split(">놓친 실행</span>").length - 1).toBe(1);
    expect(out).toContain(
      '<span class="text-ui text-text-secondary">앱이 꺼진 동안 밀린 시각을 따라잡아 한 번 실행했어요.</span>',
    );
    expect(out).toContain(
      '<span class="text-ui text-danger-text">실행 중에 오류가 났어요. 대화에서 자세한 내용을 확인해 주세요.</span>',
    );
  });

  test("a code the screen does not know is named in the fallback sentence", () => {
    const out = body({
      kind: "ready",
      scheduleId: "sch_aa1",
      runs: [
        {
          runId: "run_4",
          startedAt: "2026-11-04T00:00:00.000Z",
          endedAt: null,
          outcome: "failed",
          threadId: null,
          error: "disk_full",
          missed: false,
        },
      ],
    });
    expect(out).toContain("이유를 알 수 없어요 (disk_full)");
  });

  test("an empty history and a failed read say so", () => {
    expect(body({ kind: "ready", scheduleId: "sch_aa1", runs: [] })).toContain(
      "아직 실행한 기록이 없어요",
    );
    expect(body({ kind: "failed", scheduleId: "sch_aa1", reason: "failed" })).toContain(
      "실행 기록을 읽지 못했어요.",
    );
  });
});
