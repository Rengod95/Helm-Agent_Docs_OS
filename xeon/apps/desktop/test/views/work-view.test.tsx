import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { GoalStatusResult, WorkTasksListResult } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import {
  INITIAL_WORK_STATE,
  workReducer,
  type WorkState,
} from "../../src/views/pages/work/work-model.ts";
import { WorkView, type WorkHandlers } from "../../src/views/pages/work/work-view.tsx";

// 목표와 작업 탭(P-14)의 서버 렌더. 빈(목표 없음, 대화 없음), 읽는 중, 오류, 오프라인, 권한 필요(해당 없음), 긴 내용을 그린다.
// 클릭과 입력은 DOM이 없어 시험하지 못한다(뜻은 work-model 시험이 본다).

const NOOP = (): void => {};
const HANDLERS: WorkHandlers = {
  draftChange: NOOP,
  submitGoal: NOOP,
  clearGoal: NOOP,
  retryGoal: NOOP,
  retryTasks: NOOP,
  toggleDone: NOOP,
  dismissNotice: NOOP,
};

type GoalWire = NonNullable<GoalStatusResult["goal"]>;
type TaskWire = WorkTasksListResult["tasks"][number];

const ACTIVE: GoalWire = {
  condition: "시험이 모두 통과한다",
  status: "active",
  judged: 2,
  maxJudgments: 3,
  lastVerdict: { met: false, reason: "e2e 2개 실패" },
};

function task(id: number, status: TaskWire["status"]): TaskWire {
  return { taskId: `t${String(id)}`, content: `작업 ${String(id)}`, status, blockedBy: null };
}

function withGoal(goal: GoalWire | null): WorkState {
  return workReducer(INITIAL_WORK_STATE, { type: "goalLoaded", goal });
}

function withTasks(state: WorkState, tasks: readonly TaskWire[]): WorkState {
  return workReducer(state, { type: "tasksLoaded", tasks });
}

function html(state: WorkState, over: { live?: boolean; threadOpen?: boolean } = {}): string {
  return renderToString(
    <WorkView
      threadOpen={over.threadOpen ?? true}
      state={state}
      live={over.live ?? true}
      handlers={HANDLERS}
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
  test("no conversation open: only the empty text says so, with no goal or task panel", () => {
    const markup = html(INITIAL_WORK_STATE, { threadOpen: false });
    expect(markup).toContain(t("desktop.work.noThread"));
    expect(markup).not.toContain(t("desktop.work.goal.set.submit"));
    expect(markup).not.toContain(t("desktop.work.tasks.empty"));
  });

  test("empty goal: the panel says there is no goal and offers the condition form", () => {
    const state = withTasks(withGoal(null), []);
    const markup = html(state);
    expect(markup).toContain(t("desktop.work.goal.empty"));
    expect(markup).toContain(t("desktop.work.goal.set.submit"));
    expect(markup).toContain(t("desktop.work.tasks.empty"));
  });

  test("reading: both panels show skeletons and no empty text", () => {
    const markup = html(INITIAL_WORK_STATE);
    expect(markup).toContain('data-slot="skeleton"');
    expect(markup).not.toContain(t("desktop.work.goal.empty"));
    expect(markup).not.toContain(t("desktop.work.tasks.empty"));
  });

  test("error: a failed goal read and a failed task read each say so with a retry", () => {
    const failed = workReducer(workReducer(INITIAL_WORK_STATE, { type: "goalFailed" }), {
      type: "tasksFailed",
    });
    const markup = html(failed);
    expect(markup).toContain(t("desktop.work.goal.load.failed"));
    expect(markup).toContain(t("desktop.work.tasks.load.failed"));
    expect(markup).toContain(t("desktop.work.retry"));
  });

  test("error from a goal command shows its sentence as a notice", () => {
    const noticed = workReducer(withTasks(withGoal(ACTIVE), []), {
      type: "noticeSet",
      notice: { tone: "danger", text: t("desktop.work.command.failed") },
    });
    expect(html(noticed)).toContain(t("desktop.work.command.failed"));
  });

  test("offline: the banner says so, the clear button is locked, and the read goal stays", () => {
    const markup = html(withTasks(withGoal(ACTIVE), [task(1, "pending")]), { live: false });
    expect(markup).toContain(t("desktop.work.offline"));
    expect(markup).toContain(ACTIVE.condition);
    expect(buttonOf(markup, t("desktop.work.goal.clear"))).toContain('disabled=""');
  });

  test("permission needed does not apply: nothing on the tab asks for approval", () => {
    const markup = html(withTasks(withGoal(ACTIVE), [task(1, "pending")]));
    expect(markup).not.toContain(t("client.settings.proposals.failed.approvalRequired"));
    expect(markup).not.toContain(t("desktop.approvals.failure.switching"));
  });

  test("an active goal shows its condition, the judged count and the last verdict", () => {
    const markup = html(withTasks(withGoal(ACTIVE), []));
    expect(markup).toContain(ACTIVE.condition);
    expect(markup).toContain(t("desktop.work.goal.judged", { judged: 2, max: 3 }));
    expect(markup).toContain(t("desktop.work.goal.verdict.unmet"));
    expect(markup).toContain("e2e 2개 실패");
    // 진행 중인 목표가 있으면 목표 걸기 칸은 보이지 않는다
    expect(markup).not.toContain(t("desktop.work.goal.set.submit"));
  });

  test("long content: over the limit the done tasks fold and the button says how many are hidden", () => {
    const tasks = Array.from({ length: 101 }, (_, index) =>
      task(index + 1, index < 60 ? "done" : "pending"),
    );
    const markup = html(withTasks(withGoal(ACTIVE), tasks));
    expect(markup).toContain(t("desktop.work.tasks.expandDone", { count: 60 }));
    expect(markup).not.toContain("작업 1<");
    expect(markup).toContain("작업 101");
  });
});
