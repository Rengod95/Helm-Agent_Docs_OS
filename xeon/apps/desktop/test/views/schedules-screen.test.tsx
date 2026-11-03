import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import {
  ScheduleScreenView,
  type ScheduleScreenHandlers,
} from "../../src/views/pages/schedules/schedules-view.tsx";
import {
  INITIAL_SCHEDULE_STATE,
  scheduleReducer,
  type ScheduleState,
} from "../../src/views/pages/schedules/schedule-model.ts";
import type { ScheduleListItem } from "@fresnel/contracts/capabilities";

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
};

function html(state: ScheduleState): string {
  return renderToString(
    <ScheduleScreenView state={state} locale="ko" openable={() => false} handlers={handlers} />,
  );
}

describe("schedules screen server render", () => {
  test("an empty list that has loaded says there are no schedules and offers a new one", () => {
    const loaded = scheduleReducer(INITIAL_SCHEDULE_STATE, {
      type: "listLoaded",
      items: [],
      serviceModeOff: false,
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
      nowMs: NOW,
    });
    const markup = html(loaded);
    expect(markup).toContain("서비스 모드가 꺼져 있어");
    expect(markup).toContain("서비스 켜기");
  });

  test("the list offers the on and all filters, and the rows show the next run and the last run as ages", () => {
    const withRow = scheduleReducer(INITIAL_SCHEDULE_STATE, {
      type: "listLoaded",
      items: [ROW],
      serviceModeOff: false,
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
