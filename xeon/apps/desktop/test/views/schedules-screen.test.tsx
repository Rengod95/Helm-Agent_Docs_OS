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

// 예약 화면의 서버 렌더. 상태는 reducer로 만들고 동작 핸들러는 아무것도 하지 않는 것으로 둔다.
// 클릭과 키 입력은 DOM이 없어 시험하지 못한다(뜻은 schedule-model.test.ts가 본다).

const NOOP = (): void => {};
const handlers: ScheduleScreenHandlers = {
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
    });
    const markup = html(loaded);
    expect(markup).toContain("서비스 모드가 꺼져 있어");
    expect(markup).toContain("서비스 켜기");
  });
});
