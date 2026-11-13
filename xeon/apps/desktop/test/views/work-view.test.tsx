import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { GoalStatusResult } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import {
  INITIAL_WORK_STATE,
  workReducer,
  type PlanVersionWire,
  type WorkState,
} from "../../src/views/pages/work/work-model.ts";
import {
  PlanVersionsBody,
  WorkView,
  type WorkHandlers,
} from "../../src/views/pages/work/work-view.tsx";
import { version, versionsUpTo } from "./plan-fixtures.ts";

// 작업 탭(P-14, DP-195)의 목표·계획 서버 렌더. 빈(목표 없음), 읽는 중, 오류, 오프라인, 권한 필요(해당 없음)를 그린다.
// 작업 판(거울)은 `tasks` 자리로 들어오고 그 그림은 task-board.test.tsx가 본다.
// 계획 카드(W-18)와 판 목록 본문도 그린다. 대화상자는 열린 때만 포털로 나가므로 본문은 `PlanVersionsBody`를 직접 그린다.
// 클릭과 입력은 DOM이 없어 시험하지 못한다(뜻은 work-model 시험이 본다).

const NOOP = (): void => {};
const HANDLERS: WorkHandlers = {
  draftChange: NOOP,
  submitGoal: NOOP,
  clearGoal: NOOP,
  retryGoal: NOOP,
  retryPlan: NOOP,
  viewPlan: NOOP,
  openVersions: NOOP,
  closeVersions: NOOP,
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

/** 계획 p1을 읽는 중인 상태(판 목록은 아직 없다) */
function startedPlan(): WorkState {
  return workReducer(withGoal(null), { type: "planLoadStarted", planId: "p1" });
}

/** 계획 p1의 판 목록을 읽어 온 상태 */
function withPlanLoaded(versions: readonly PlanVersionWire[]): WorkState {
  return workReducer(startedPlan(), { type: "planLoaded", planId: "p1", versions });
}

/** 그려진 스켈레톤 수 */
function skeletonsOf(markup: string): number {
  return markup.split('data-slot="skeleton"').length - 1;
}

describe("WorkView plan card (W-18)", () => {
  test("no plan: the card is not drawn at all, its heading and info are absent", () => {
    const markup = html(withGoal(null));
    expect(markup).not.toContain(t("desktop.work.plan.heading"));
    expect(markup).not.toContain(t("desktop.work.plan.info"));
    expect(buttonOf(markup, t("desktop.work.plan.versions.open"))).toBe("");
  });

  test("a plan shows its latest version's title, number and status, and the view button", () => {
    const markup = html(
      withPlanLoaded([
        version(1, { title: "첫 계획", status: "approved" }),
        version(2, { title: "캐시 만료 수정", status: "submitted" }),
      ]),
    );
    expect(markup).toContain("캐시 만료 수정");
    expect(markup).not.toContain("첫 계획");
    expect(markup).toContain(t("desktop.work.plan.version", { version: 2 }));
    expect(markup).toContain(t("desktop.work.plan.status.submitted"));
    // 한 줄의 "보기"가 판 목록을 연다(mockups/p14 계획 줄)
    expect(buttonOf(markup, t("desktop.work.plan.versions.open"))).not.toBe("");
    // 정보 아이콘의 설명 글은 숨은 글로 늘 나간다
    expect(markup).toContain(t("desktop.work.plan.info"));
  });

  test("loading: the card waits with one skeleton, and offline while loading says so instead", () => {
    const loading = workReducer(withGoal(null), {
      type: "planLoadStarted",
      planId: "p1",
    });
    expect(skeletonsOf(html(loading))).toBe(1);
    const offline = html(loading, { live: false });
    expect(skeletonsOf(offline)).toBe(0);
    expect(offline).toContain(t("desktop.work.offline"));
  });

  test("not found: an alert says the plan is gone and no view button is drawn", () => {
    const missing = workReducer(startedPlan(), {
      type: "planFailed",
      planId: "p1",
      reason: "notFound",
    });
    const markup = html(missing);
    expect(markup).toContain(t("desktop.work.plan.notFound"));
    expect(buttonOf(markup, t("desktop.work.plan.versions.open"))).toBe("");
  });

  test("read error: the card says the plan could not be read, with a retry", () => {
    const failed = workReducer(startedPlan(), {
      type: "planFailed",
      planId: "p1",
      reason: "failed",
    });
    const markup = html(failed);
    expect(markup).toContain(t("desktop.work.plan.load.failed"));
    expect(buttonOf(markup, t("desktop.work.retry"))).not.toBe("");
  });

  test("a plan read with no versions reads as not found", () => {
    const markup = html(withPlanLoaded([]));
    expect(markup).toContain(t("desktop.work.plan.notFound"));
    expect(buttonOf(markup, t("desktop.work.plan.versions.open"))).toBe("");
  });
});

describe("PlanVersionsBody (the version list)", () => {
  test("the newest 50 versions show, the older ones are counted as hidden", () => {
    const markup = renderToString(
      <PlanVersionsBody view="ready" versions={versionsUpTo(52)} onRetry={NOOP} />,
    );
    expect(markup).toContain(">버전 52<");
    expect(markup).toContain(">버전 3<");
    expect(markup).not.toContain(">버전 2<");
    expect(markup).not.toContain(">버전 1<");
    expect(markup.indexOf(">버전 52<")).toBeLessThan(markup.indexOf(">버전 3<"));
    expect(markup).toContain(t("desktop.work.plan.versions.hidden", { count: 2 }));
  });

  test("a long body is cut to a preview with an expand button, and a short one has none", () => {
    const markup = renderToString(
      <PlanVersionsBody
        view="ready"
        versions={[version(1, { body: "가".repeat(300) }), version(2, { body: "짧은 본문" })]}
        onRetry={NOOP}
      />,
    );
    expect(markup).toContain(`${"가".repeat(200)}…`);
    expect(markup).not.toContain("가".repeat(201));
    expect(markup).toContain("짧은 본문");
    // 펼치기는 긴 본문 하나에만 있다
    expect(markup.split(t("desktop.work.plan.versions.expand")).length - 1).toBe(1);
  });

  test("a rejected version's feedback waits behind the expand button", () => {
    const markup = renderToString(
      <PlanVersionsBody
        view="ready"
        versions={[version(1, { status: "rejected", feedback: "범위를 줄여 주세요" })]}
        onRetry={NOOP}
      />,
    );
    expect(markup).toContain(t("desktop.work.plan.status.rejected"));
    expect(markup).not.toContain("범위를 줄여 주세요");
    expect(markup.split(t("desktop.work.plan.versions.expand")).length - 1).toBe(1);
  });

  test("a loading list is a skeleton, a failed list is an alert with a retry", () => {
    expect(
      skeletonsOf(renderToString(<PlanVersionsBody view="loading" versions={[]} onRetry={NOOP} />)),
    ).toBe(1);
    const failed = renderToString(<PlanVersionsBody view="failed" versions={[]} onRetry={NOOP} />);
    expect(failed).toContain(t("desktop.work.plan.load.failed"));
    expect(buttonOf(failed, t("desktop.work.retry"))).not.toBe("");
  });
});
