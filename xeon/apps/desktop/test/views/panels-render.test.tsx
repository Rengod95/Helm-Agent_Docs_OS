import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import { TaskBoardView, type TaskBoardHandlers } from "../../src/views/panels/tasks/task-board.tsx";
import type { TaskBoard } from "../../src/views/panels/tasks/task-board-model.ts";
import { RunBoardView, type RunHandlers } from "../../src/views/panels/running/running-tab.tsx";
import type { RunBoard, RunRow } from "../../src/views/panels/running/running-model.ts";
import { thr } from "../state/helpers.ts";

// 작업 판과 실행 중 판의 서버 렌더(DP-195, DP-196): 빈 상태, 지금 카드, 접힌 끝남, 묶음과 동작.

const NOOP = (): void => {};
const TASK_HANDLERS: TaskBoardHandlers = {
  ownerThread: (owner) => (owner === "reviewer" ? "thr-child" : null),
  openThread: NOOP,
  toggleFinished: NOOP,
};

const BOARD: TaskBoard = {
  current: {
    id: "t2",
    content: "단위 통일",
    activeForm: "캐시 만료 단위를 통일하는 중",
    status: "in_progress",
    owner: "reviewer",
    waitingOn: [],
  },
  next: [
    {
      id: "t3",
      content: "문서 고치기",
      activeForm: null,
      status: "pending",
      owner: null,
      waitingOn: ["시험 추가"],
    },
  ],
  failed: [],
  finished: [
    {
      id: "t1",
      content: "끝난 일",
      activeForm: null,
      status: "completed",
      owner: null,
      waitingOn: [],
    },
  ],
  progress: { done: 1, total: 3 },
  blocked: 1,
  total: 3,
};

describe("TaskBoardView", () => {
  test("empty: says what will gather here, with no progress bar", () => {
    const out = renderToString(
      <TaskBoardView
        board={{
          ...BOARD,
          current: null,
          next: [],
          finished: [],
          total: 0,
          progress: { done: 0, total: 0 },
          blocked: 0,
        }}
        finishedOpen={false}
        handlers={TASK_HANDLERS}
      />,
    );
    expect(out).toContain(t("desktop.tasks.empty.title"));
    expect(out).not.toContain('role="progressbar"');
  });

  test("the current card leads with the active form; waiting and owner show; finished stays folded", () => {
    const out = renderToString(
      <TaskBoardView board={BOARD} finishedOpen={false} handlers={TASK_HANDLERS} />,
    );
    expect(out).toContain("data-task-current");
    expect(out).toContain("캐시 만료 단위를 통일하는 중");
    expect(out).toContain("@reviewer");
    expect(out).toContain(t("desktop.tasks.waitingOn", { task: "시험 추가" }));
    expect(out).toContain(t("desktop.tasks.group.finished"));
    expect(out).not.toContain("끝난 일");
    const opened = renderToString(
      <TaskBoardView board={BOARD} finishedOpen handlers={TASK_HANDLERS} />,
    );
    expect(opened).toContain("끝난 일");
  });
});

function row(over: Partial<RunRow>): RunRow {
  return {
    threadId: thr(1),
    title: "테스트 정리",
    agentName: null,
    background: false,
    origin: null,
    state: "running",
    outcome: null,
    approvals: 0,
    tool: null,
    steps: 0,
    sinceMs: 0,
    tokens: null,
    parentId: null,
    parentTitle: null,
    children: [],
    ...over,
  };
}

const RUN_HANDLERS: RunHandlers = {
  open: NOOP,
  answer: NOOP,
  stop: NOOP,
  stopping: new Set(),
  live: true,
};

describe("RunBoardView", () => {
  test("empty: one line on what this tab shows", () => {
    const board: RunBoard = {
      waiting: [],
      running: [],
      finished: [],
      runningCount: 0,
      waitingCount: 0,
    };
    const out = renderToString(<RunBoardView board={board} now={0} handlers={RUN_HANDLERS} />);
    expect(out).toContain(t("desktop.running.empty.title"));
  });

  test("groups in order waiting, running, just finished, each with its own actions", () => {
    const board: RunBoard = {
      waiting: [row({ threadId: thr(1), state: "waiting", approvals: 2, title: "승인 대화" })],
      running: [
        row({
          threadId: thr(2),
          title: "도는 대화",
          tool: "bash",
          children: [
            row({ threadId: thr(3), agentName: "reviewer", background: true, parentId: thr(2) }),
          ],
        }),
      ],
      finished: [
        row({
          threadId: thr(4),
          state: "finished",
          outcome: "completed",
          tokens: 1200,
          title: "끝난 대화",
        }),
      ],
      runningCount: 2,
      waitingCount: 1,
    };
    const out = renderToString(<RunBoardView board={board} now={60_000} handlers={RUN_HANDLERS} />);
    const order = ["승인 대화", "도는 대화", "reviewer", "끝난 대화"].map((s) => out.indexOf(s));
    expect(order).toEqual([...order].toSorted((a, b) => a - b));
    expect(out).toContain(t("desktop.running.answer"));
    expect(out).toContain(t("desktop.running.waitingFor", { count: 2 }));
    expect(out).toContain(t("desktop.running.tool", { tool: "bash" }));
    expect(out).toContain(t("desktop.running.chip.background"));
    expect(out).toContain(`aria-label="${t("desktop.running.stop")}"`);
    expect(out).toContain(t("desktop.running.record"));
  });
});
