// 테스트 화면(P-19)의 동작. 목록은 `useTestList`로 읽고, 거르기·고른 행·시트·멈춤 표지는 `testsUiReducer`가 든다.
// 명령은 `tests-actions.ts`가 부르고 결과만 화면 상태에 넣는다. 그림은 `tests-view.tsx`가 그린다.
import {
  INITIAL_TESTS_UI,
  reportJsonOf,
  submitPlanOf,
  testRowsOf,
  testsUiReducer,
  type RunControl,
  type TestRowVM,
  type TestsNotice,
} from "@fresnel/client/workbench";
import { assertNever, attemptAsync, detach, parse, rethrow } from "@fresnel/contracts";
import { ThreadIdSchema } from "@fresnel/contracts/conversation";
import type { ReplayReport } from "@fresnel/contracts/services";
import type { ExtTestRunParams } from "@fresnel/contracts/wire";
import { useEffect, useReducer, useState, type ReactNode } from "react";
import { useLinkPhase } from "../../state/engine/index.ts";
import { useShell, useShellActions, type WorkbenchContext } from "../../state/shell/index.ts";
import { useCommands } from "../commands.ts";
import { tabLinkOf } from "../workbench/tab-read.ts";
import { phaseOf, runControl, sendTestPrompt, startTest } from "./tests-actions.ts";
import { useTestList } from "./tests-read.ts";
import { TestsView, type TestsViewHandlers } from "./tests-view.tsx";

/** 시작에 성공한 뒤의 알림. Test run은 대상 이름을 붙인 시험 대화를 만든 것이다 */
function startNoticeOf(params: ExtTestRunParams): TestsNotice {
  return params.kind === "testRun" ? { kind: "created", name: params.target } : { kind: "started" };
}

/** 맥락 칸이 시험 대화나 대화이면 그 대화 id, 아니면 null(목록을 거르지 않는다) */
function threadScopeOf(context: WorkbenchContext): string | null {
  switch (context.kind) {
    case "thread":
    case "trial":
      return context.threadId;
    case "all":
    case "profile":
      return null;
    default:
      return assertNever(context, "WorkbenchContext");
  }
}

export function TestsScreen(): ReactNode {
  const commands = useCommands();
  const link = tabLinkOf(useLinkPhase());
  const online = link === "live";
  const scope = threadScopeOf(useShell((s) => s.context));
  const compact = useShell((s) => s.layout) === "compact";
  const shell = useShellActions();
  const [ui, dispatch] = useReducer(testsUiReducer, INITIAL_TESTS_UI);
  const list = useTestList(link);
  const records = list.read.kind === "ready" ? list.read.value : [];
  const rows = testRowsOf(records, ui.filter, scope);
  const selected: TestRowVM | null = rows.find((row) => row.testId === ui.selected) ?? null;
  const selectedThread =
    selected !== null && selected.kind === "testRun" ? selected.threadId : null;
  const selectedRunning = selected !== null && selected.state === "running";

  // 개발 모드 판정은 연결이 살아 있을 때 읽는다. 읽지 못하면 개발 모드가 아니다
  useEffect(() => {
    if (!online) return undefined;
    let active = true;
    const run = async (): Promise<void> => {
      const got = await commands.tests.devMode();
      if (active && got.ok) dispatch({ type: "devMode", devMode: got.value });
    };
    detach(run(), rethrow);
    return () => {
      active = false;
    };
  }, [commands, online]);

  // 고른 Test run이 실행 중이면 단계 이름을 읽는다(목록에는 단계가 없다)
  useEffect(() => {
    if (!online || !selectedRunning || selectedThread === null) return undefined;
    let active = true;
    const run = async (): Promise<void> => {
      const phase = await phaseOf(commands.tests, selectedThread);
      if (active) dispatch({ type: "phaseDone", threadId: selectedThread, phase });
    };
    detach(run(), rethrow);
    return () => {
      active = false;
    };
  }, [commands, online, selectedRunning, selectedThread]);

  // 새 시험 시트가 열려 있는 동안 고를 수 있는 확장 이름을 읽는다. 읽지 못하면 고르기 줄 없이 입력만 둔다
  const sheetOpen = ui.sheet !== null;
  const [targetNames, setTargetNames] = useState<readonly string[]>([]);
  useEffect(() => {
    if (!online || !sheetOpen) return undefined;
    let active = true;
    const run = async (): Promise<void> => {
      const got = await commands.workbench.list();
      if (active && got.ok) {
        setTargetNames(got.value.filter((e) => e.safeModeExcluded === null).map((e) => e.name));
      }
    };
    detach(run(), rethrow);
    return () => {
      active = false;
    };
  }, [commands, online, sheetOpen]);

  const startNow = async (params: ExtTestRunParams, prompt: string | null): Promise<void> => {
    dispatch({ type: "sending", sending: true });
    const started = await startTest(commands.tests, params);
    if (started.ok && prompt !== null && started.value.threadId !== null) {
      // 시험 대화를 열고 과제를 첫 턴으로 보낸다. 대화는 이미 만들어졌으므로 보내지 못해도 목록은 다시 읽는다
      const threadId = parse(ThreadIdSchema, started.value.threadId);
      const sent = threadId.ok
        ? await sendTestPrompt(commands, threadId.value, prompt, crypto.randomUUID())
        : null;
      if (sent === null || !sent.ok) {
        dispatch({ type: "sending", sending: false });
        dispatch({
          type: "notice",
          notice: { kind: "failed", failure: sent === null ? "failed" : sent.failure },
        });
        list.reload();
        return;
      }
    }
    dispatch({ type: "sending", sending: false });
    if (started.ok) {
      // 과제를 보냈으면 화면을 시험 대화로 옮긴다(목록에 남아 있으면 열린 줄 모른다)
      if (prompt !== null && started.value.threadId !== null) shell.switchArea("chat");
      dispatch({ type: "sheetClose" });
      dispatch({ type: "notice", notice: startNoticeOf(params) });
      list.reload();
      return;
    }
    // Test run의 대상이 설치되어 실린 확장이 아니면 호스트가 거절한다: 일반 거절 글 대신 이유와 고를 곳을 말한다
    const failure =
      params.kind === "testRun" && started.failure === "rejected"
        ? "targetNotLoaded"
        : started.failure;
    dispatch({ type: "notice", notice: { kind: "failed", failure } });
  };

  const submit = async (): Promise<void> => {
    const draft = ui.sheet;
    if (draft === null) return;
    const plan = submitPlanOf(draft, ui.devMode);
    switch (plan.kind) {
      case "run":
        if (plan.confirm) dispatch({ type: "confirmOpen", params: plan.params });
        else await startNow(plan.params, plan.prompt);
        return;
      case "locked":
      case "unwired":
      case "invalid":
        return;
      default:
        return assertNever(plan, "SubmitPlan");
    }
  };

  const control = async (threadId: string, action: RunControl): Promise<void> => {
    const done = await runControl(commands.tests, action, threadId);
    if (!done.ok) {
      dispatch({ type: "notice", notice: { kind: "failed", failure: done.failure } });
      return;
    }
    dispatch({ type: "controlDone", threadId, paused: done.value });
    dispatch({ type: "phaseDone", threadId, phase: await phaseOf(commands.tests, threadId) });
  };

  const copy = async (report: ReplayReport): Promise<void> => {
    const written = await attemptAsync(() => commands.secrets.writeClipboard(reportJsonOf(report)));
    dispatch({ type: "notice", notice: { kind: written.ok ? "copied" : "copyFailed" } });
  };

  const handlers: TestsViewHandlers = {
    select: (testId) => {
      dispatch({ type: "select", testId });
    },
    filter: (filter) => {
      dispatch({ type: "filter", filter });
    },
    openSheet: () => {
      dispatch({ type: "sheetOpen" });
    },
    retry: list.reload,
    dismissNotice: () => {
      dispatch({ type: "notice", notice: null });
    },
    sheet: {
      change: (draft) => {
        dispatch({ type: "sheetChange", draft });
      },
      submit: () => {
        detach(submit(), rethrow);
      },
      close: () => {
        dispatch({ type: "sheetClose" });
      },
    },
    confirmRun: () => {
      const params = ui.confirm;
      const prompt =
        ui.sheet !== null && params?.kind === "testRun" ? ui.sheet.prompt.trim() : null;
      dispatch({ type: "confirmClose" });
      if (params !== null) detach(startNow(params, prompt), rethrow);
    },
    cancelRun: () => {
      dispatch({ type: "confirmClose" });
    },
    control: (threadId, action) => {
      detach(control(threadId, action), rethrow);
    },
    copy: (report) => {
      detach(copy(report), rethrow);
    },
  };

  return (
    <TestsView
      read={list.read}
      rows={rows}
      selected={selected}
      ui={ui}
      online={online}
      scoped={scope !== null}
      compact={compact}
      selectedPaused={selectedThread !== null && ui.paused[selectedThread] === true}
      selectedPhase={selectedThread === null ? null : (ui.phase[selectedThread] ?? null)}
      targetNames={targetNames}
      handlers={handlers}
    />
  );
}
