import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { useCallback, useEffect, useReducer, useRef, type ReactNode } from "react";
import { useLinkPhase, useThreadRunning } from "../../../state/engine/index.ts";
import { useSelectedThreadId } from "../../../state/ui/index.ts";
import { useCommands } from "../../commands.ts";
import { commandErrorIdOf } from "./work-text.ts";
import { goalCommandTextOf, INITIAL_WORK_STATE, workReducer } from "./work-model.ts";
import { WorkView, type WorkHandlers } from "./work-view.tsx";

// 목표와 작업 탭(P-14)의 동작. 열린 대화의 목표와 작업 목록은 `commands.work`로 읽고, 목표 걸기·해제는 `/goal` 줄을
// `command.run`으로 보낸다. 상태는 `workReducer`가 들고 그림은 `work-view.tsx`가 그린다.

/** 열린 대화가 없을 때 쓰는 빈 상태 */
const NO_HANDLERS: WorkHandlers = {
  draftChange: () => {},
  submitGoal: () => {},
  clearGoal: () => {},
  retryGoal: () => {},
  retryTasks: () => {},
  toggleDone: () => {},
  dismissNotice: () => {},
};

export function WorkScreen(): ReactNode {
  const threadId = useSelectedThreadId();
  if (threadId === null) {
    return (
      <WorkView threadOpen={false} state={INITIAL_WORK_STATE} live={false} handlers={NO_HANDLERS} />
    );
  }
  // 대화가 바뀌면 상태(초안, 접기, 알림)를 새로 시작한다
  return <OpenThreadWork key={threadId} threadId={threadId} />;
}

function OpenThreadWork(props: { readonly threadId: ThreadId }): ReactNode {
  const { threadId } = props;
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const running = useThreadRunning(threadId);
  const [state, dispatch] = useReducer(workReducer, INITIAL_WORK_STATE);
  // 늦게 온 읽기가 새 읽기를 덮지 않도록 읽기마다 번호를 매긴다
  const latestRead = useRef(0);

  const read = useCallback(async (): Promise<void> => {
    latestRead.current += 1;
    const seq = latestRead.current;
    dispatch({ type: "loadStarted" });
    const [goal, tasks] = await Promise.all([
      commands.work.goal(threadId),
      commands.work.tasks(threadId),
    ]);
    if (seq !== latestRead.current) return;
    dispatch(goal.ok ? { type: "goalLoaded", goal: goal.value.goal } : { type: "goalFailed" });
    dispatch(
      tasks.ok ? { type: "tasksLoaded", tasks: tasks.value.tasks } : { type: "tasksFailed" },
    );
  }, [commands, threadId]);

  // 연결이 살아 있고 턴이 돌고 있지 않을 때 읽는다. 턴이 끝나면 판정과 작업이 바뀌었을 수 있어 다시 읽는다
  useEffect(() => {
    if (live && !running) detach(read(), rethrow);
  }, [live, running, read]);

  const notify = (tone: "success" | "danger", text: string): void => {
    dispatch({ type: "noticeSet", notice: { tone, text } });
  };

  const runGoal = async (text: string, doneText: string): Promise<void> => {
    dispatch({ type: "busyChanged", busy: true });
    const ran = await commands.work.goalCommand(threadId, text);
    dispatch({ type: "busyChanged", busy: false });
    if (!ran.ok) {
      notify("danger", t(commandErrorIdOf(ran.error)));
      return;
    }
    // `done`이 아니면 명령이 적용되지 않았다(모르는 명령, 확인이 필요한 셸 명령 등)
    if (ran.value.status !== "done") {
      notify("danger", t("desktop.work.command.failed"));
      return;
    }
    notify("success", doneText);
    await read();
  };

  const handlers: WorkHandlers = {
    draftChange: (draft) => {
      dispatch({ type: "draftChanged", draft });
    },
    submitGoal: () => {
      const built = goalCommandTextOf({ kind: "set", condition: state.draft });
      if (!built.ok) {
        notify(
          "danger",
          t(
            built.error.kind === "empty"
              ? "desktop.work.goal.set.empty"
              : "desktop.work.goal.set.tooLong",
          ),
        );
        return;
      }
      detach(runGoal(built.value, t("desktop.work.goal.setDone")), rethrow);
    },
    clearGoal: () => {
      const built = goalCommandTextOf({ kind: "clear" });
      if (!built.ok) return;
      detach(runGoal(built.value, t("desktop.work.goal.clearDone")), rethrow);
    },
    retryGoal: () => {
      detach(read(), rethrow);
    },
    retryTasks: () => {
      detach(read(), rethrow);
    },
    toggleDone: () => {
      dispatch({ type: "doneToggled" });
    },
    dismissNotice: () => {
      dispatch({ type: "noticeSet", notice: null });
    },
  };
  return <WorkView threadOpen state={state} live={live} handlers={handlers} />;
}
