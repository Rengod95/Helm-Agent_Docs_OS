import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { useCallback, useEffect, useReducer, useRef, type ReactNode } from "react";
import { useLinkPhase, useThreadRunning } from "../../../state/engine/index.ts";
import { useCommands } from "../../commands.ts";
import { commandErrorIdOf } from "./work-text.ts";
import { goalCommandTextOf, INITIAL_WORK_STATE, workReducer } from "./work-model.ts";
import { WorkView, type WorkHandlers } from "./work-view.tsx";

// 작업 탭(P-14, DP-195)의 목표 동작. 열린 대화의 목표는 `commands.work.goal`로 읽고, 목표 걸기·해제는 `/goal` 줄을
// `command.run`으로 보낸다.
// 작업 판은 부르는 쪽(`views/panels/tasks/tasks-tab.tsx`)이 거울에서 그려 `tasks`로 넘긴다.
// 상태는 `workReducer`가 들고 그림은 `work-view.tsx`가 그린다. 대화가 바뀌면 부르는 쪽이 `key`로 새로 시작한다

export function ThreadWork(props: {
  readonly threadId: ThreadId;
  readonly tasks: ReactNode;
}): ReactNode {
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
    const goal = await commands.work.goal(threadId);
    if (seq !== latestRead.current) return;
    dispatch(goal.ok ? { type: "goalLoaded", goal: goal.value.goal } : { type: "goalFailed" });
  }, [commands, threadId]);

  // 연결이 살아 있고 턴이 돌고 있지 않을 때 읽는다. 턴이 끝나면 판정이 바뀌었을 수 있어 다시 읽는다.
  // 턴이 도는 중에 탭을 열었으면 아직 한 번도 못 읽었으므로 그때도 읽는다(아니면 뼈대가 턴 끝까지 남는다)
  const goalUnread = state.goal.status === "loading";
  useEffect(() => {
    if (live && (!running || goalUnread)) detach(read(), rethrow);
  }, [live, running, goalUnread, read]);

  const notify = (tone: "success" | "danger" | "info", text: string): void => {
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
    dismissNotice: () => {
      dispatch({ type: "noticeSet", notice: null });
    },
  };
  return <WorkView state={state} live={live} handlers={handlers} tasks={props.tasks} />;
}
