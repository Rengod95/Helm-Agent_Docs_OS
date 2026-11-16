import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { GoalStatusResult } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import {
  INITIAL_WORK_STATE,
  workReducer,
  type WorkState,
} from "../../src/views/pages/work/work-model.ts";
import { WorkView, type WorkHandlers } from "../../src/views/pages/work/work-view.tsx";

// 작업 탭(P-14, DP-195)의 목표 서버 렌더. 빈(목표 없음), 읽는 중, 오류, 오프라인, 권한 필요(해당 없음)를 그린다.
// 작업 판(거울)은 `tasks` 자리로 들어오고 그 그림은 task-board.test.tsx가 본다.
// 클릭과 입력은 DOM이 없어 시험하지 못한다(뜻은 work-model 시험이 본다).

const NOOP = (): void => {};
const HANDLERS: WorkHandlers = {
  draftChange: NOOP,
  submitGoal: NOOP,
  clearGoal: NOOP,
  retryGoal: NOOP,
  dismissNotice: NOOP,
};

type GoalWire = NonNullable<GoalStatusResult["goal"]>;

const ACTIVE: GoalWire = {
  condition: "시험이 모두 통과한다",
  status: "active",
  judged: 2,
  maxJudgments: 3,
  lastVerdict: { met: false, reason: "e2e 2개 실패" },
};

function withGoal(goal: GoalWire | null): WorkState {
  return workReducer(INITIAL_WORK_STATE, { type: "goalLoaded", goal });
}

const TASKS_SLOT = "작업 판 자리";

function html(state: WorkState, over: { live?: boolean } = {}): string {
  return renderToString(
    <WorkView
      state={state}
      live={over.live ?? true}
      handlers={HANDLERS}
      tasks={<p>{TASKS_SLOT}</p>}
    />,
  );
}

/** 글이 든 버튼 하나의 시작 태그와 글. 없으면 빈 글이다 */
function buttonOf(markup: string, label: string): string {
  const found = markup.match(
    new RegExp(`<button[^>]*>(?:(?!</button>).)*${label}(?:(?!</button>).)*</button>`),
  );
  return found === null ? "" : found[0];
}

describe("WorkView states", () => {
  test("empty goal: the goal strip offers the one-line condition form, and the task board slot follows", () => {
    const markup = html(withGoal(null));
    expect(markup).toContain(t("desktop.work.goal.set.submit"));
    expect(markup).toContain(t("desktop.work.goal.info"));
    expect(markup).not.toContain(t("desktop.work.goal.clear"));
    expect(markup).toContain(TASKS_SLOT);
  });

  test("reading: the goal strip shows skeletons and no form", () => {
    const markup = html(INITIAL_WORK_STATE);
    expect(markup).toContain('data-slot="skeleton"');
    expect(markup).not.toContain(t("desktop.work.goal.set.submit"));
  });

  test("error: a failed goal read says so with a retry, and the task board still shows", () => {
    const markup = html(workReducer(INITIAL_WORK_STATE, { type: "goalFailed" }));
    expect(markup).toContain(t("desktop.work.goal.load.failed"));
    expect(markup).toContain(t("desktop.work.retry"));
    expect(markup).toContain(TASKS_SLOT);
  });

  test("error from a goal command shows its sentence as a notice", () => {
    const noticed = workReducer(withGoal(ACTIVE), {
      type: "noticeSet",
      notice: { tone: "danger", text: t("desktop.work.command.failed") },
    });
    expect(html(noticed)).toContain(t("desktop.work.command.failed"));
  });

  test("offline: the banner says so, the clear button is locked, and the read goal stays", () => {
    const markup = html(withGoal(ACTIVE), { live: false });
    expect(markup).toContain(t("desktop.work.offline"));
    expect(markup).toContain(ACTIVE.condition);
    expect(buttonOf(markup, t("desktop.work.goal.clear"))).toContain('disabled=""');
  });

  test("permission needed does not apply: nothing on the tab asks for approval", () => {
    const markup = html(withGoal(ACTIVE));
    expect(markup).not.toContain(t("client.settings.proposals.failed.approvalRequired"));
    expect(markup).not.toContain(t("desktop.approvals.failure.switching"));
  });

  test("an active goal shows its condition, the judged count and the last verdict", () => {
    const markup = html(withGoal(ACTIVE));
    expect(markup).toContain(ACTIVE.condition);
    expect(markup).toContain(t("desktop.work.goal.judged", { judged: 2, max: 3 }));
    expect(markup).toContain(t("desktop.work.goal.verdict.unmet"));
    expect(markup).toContain("e2e 2개 실패");
    // 진행 중인 목표가 있으면 목표 걸기 칸은 보이지 않는다
    expect(markup).not.toContain(t("desktop.work.goal.set.submit"));
  });
});
