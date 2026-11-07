import { t } from "@fresnel/client/i18n";
import {
  decisionParams,
  type ProposalAction,
  type ProposalInput,
  type ProposalRowVM,
  type ProposalScope,
} from "@fresnel/client/settings";
import type { ToggleRequest } from "@fresnel/client/workbench";
import { detach, rethrow } from "@fresnel/contracts";
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useLinkPhase, useThreadSummaries } from "../../../state/engine/index.ts";
import { useShellActions } from "../../../state/shell/index.ts";
import { useCommands } from "../../commands.ts";
import { useProposalPending } from "../../proposal-pending-context.tsx";
import {
  confirmActionOf,
  effectiveScopeOf,
  INITIAL_PROPOSALS_STATE,
  learningStateOf,
  listParamsOf,
  moveSelectionOf,
  overlayOpenOf,
  proposalKeyIntentOf,
  proposalsReducer,
  selectedRowOf,
  skillFailureOf,
  visibleRowsOf,
  type NoticeTone,
  type ProposalFilter,
  type ProposalPage,
  type ProposalsState,
  type SkillRequest,
} from "./proposals-model.ts";
import { commandErrorIdOf, decisionErrorIdOf, doneNoticeOf } from "./proposals-text.ts";
import { ProposalsView, type ProposalsHandlers } from "./proposals-view.tsx";

// 제안 화면(P-06)의 동작. 목록과 결정은 `commands.proposals`로 부르고, 상태는 `proposalsReducer`가 든다.
// 그림은 `proposals-view.tsx`가 그린다. 목록은 연결이 살아날 때와 거르기가 바뀔 때 다시 읽는다.

/** 입력 칸(편집 가능)을 고른다. 여기에 초점이 있으면 화면 바로 가기 키는 아무것도 하지 않는다 */
const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

export function ProposalsScreen(): ReactNode {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const threads = useThreadSummaries();
  const shell = useShellActions();
  // 결정 뒤에 사이드바 배지와 받은 요청 제안 줄의 수를 다시 읽는다
  const refreshPending = useProposalPending().refresh;
  const [state, dispatch] = useReducer(proposalsReducer, INITIAL_PROPOSALS_STATE);
  // 늦게 온 읽기가 새 읽기를 덮지 않도록 읽기마다 번호를 매긴다
  const latestRead = useRef(0);

  const read = useCallback(
    async (filter: ProposalFilter, cursor: string | null, append: boolean): Promise<void> => {
      latestRead.current += 1;
      const seq = latestRead.current;
      dispatch({ type: "listStarted", append });
      const listed = await commands.proposals.list(listParamsOf(filter, cursor));
      if (seq !== latestRead.current) return;
      if (!listed.ok) {
        dispatch({ type: "listFailed" });
        return;
      }
      const page: ProposalPage = {
        rows: listed.value.rows,
        unavailable: listed.value.unavailable,
        nextCursor: listed.value.nextCursor,
      };
      dispatch({ type: "listLoaded", page, append, readAt: Date.now() });
    },
    [commands],
  );

  // 연결이 살아날 때와 거르기가 바뀔 때 목록을 다시 읽는다. 연결이 없으면 마지막 목록을 둔다
  useEffect(() => {
    if (live) detach(read(state.filter, null, false), rethrow);
  }, [live, read, state.filter]);

  // 학습 그룹의 켜짐은 확장 목록에서 읽는다(목록의 안내 줄이 쓴다). 확장이 바뀌면 다시 읽는다
  const readLearning = useCallback(async (): Promise<void> => {
    const listed = await commands.workbench.list();
    dispatch({ type: "learningRead", learning: learningStateOf(listed.ok ? listed.value : null) });
  }, [commands]);

  useEffect(() => {
    if (!live) return undefined;
    detach(readLearning(), rethrow);
    return commands.workbench.onChanged(() => {
      detach(readLearning(), rethrow);
    });
  }, [commands, live, readLearning]);

  const notify = (tone: NoticeTone, text: string): void => {
    dispatch({ type: "noticeSet", notice: { tone, text } });
  };

  const decide = async (
    row: ProposalRowVM,
    action: ProposalAction,
    input: ProposalInput,
  ): Promise<void> => {
    const params = decisionParams(row, action, input);
    if (!params.ok) {
      notify("danger", t(decisionErrorIdOf(params.error)));
      return;
    }
    dispatch({ type: "busyChanged", busy: true });
    const result = await commands.proposals.decide(params.value);
    dispatch({ type: "busyChanged", busy: false });
    refreshPending();
    if (!result.ok) {
      notify("danger", t(commandErrorIdOf(result.error)));
      return;
    }
    const outcome = result.value;
    if (outcome.kind === "failed") {
      notify("danger", outcome.text);
      // 목록이 낡았다는 실패(`reload`)면 다시 읽어 행을 맞춘다
      if (outcome.reload) await read(state.filter, null, false);
      return;
    }
    dispatch({ type: "editorClosed" });
    dispatch({ type: "confirmClosed" });
    // 알림은 결과 행의 상태를 본다: 되돌리기는 `reverted`일 때만 성공이다(원장이 거절하면 `applied`로 남는다)
    const done = doneNoticeOf(action, outcome.applied, outcome.proposal.status);
    notify(done.tone, t(done.textId));
    await read(state.filter, null, false);
  };

  /** 학습 그룹 켜기: 스위치와 같은 확장 쓰기다. 끝나면 켜짐 상태를 다시 읽는다 */
  const turnLearningOn = async (request: ToggleRequest): Promise<void> => {
    const done = await commands.workbench.toggle(request);
    if (!done.ok) {
      notify("danger", t(commandErrorIdOf(done.error)));
      return;
    }
    await readLearning();
  };

  /** 동작 하나. 입력이 필요하면 편집기를, 확인이 필요하면 대화 상자를 연다 */
  const act = (row: ProposalRowVM, action: ProposalAction): void => {
    if (action === "edit" || action === "reject") {
      dispatch({ type: "editorOpened", mode: action === "edit" ? "edit" : "reject", key: row.key });
      return;
    }
    const confirmAction = confirmActionOf(row, action);
    if (confirmAction !== null) {
      dispatch({ type: "confirmOpened", key: row.key, action: confirmAction });
      return;
    }
    detach(decide(row, action, scopeInputOf(row, state)), rethrow);
  };

  const onKey = (event: ReactKeyboardEvent<HTMLElement>): void => {
    // 대화 상자나 편집기가 열려 있으면 목록 바로 가기 키는 쉰다(대화 상자는 포털이라 이벤트가 이 자리로 올라온다)
    if (overlayOpenOf(state)) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const intent = proposalKeyIntentOf({
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      editable: target !== null && target.closest(EDITABLE) !== null,
    });
    if (intent === null) return;
    event.preventDefault();
    if (intent.type === "move") {
      dispatch({
        type: "select",
        key: moveSelectionOf(shownRowsOf(state), state.selectedKey, intent.delta),
      });
      return;
    }
    const row = selectedRowOf(shownRowsOf(state), state.selectedKey);
    if (row === null || !live || state.busy || !row.actions.includes(intent.action)) return;
    act(row, intent.action);
  };

  /** 충돌 스킬 본문을 한 번 읽는다(다시 읽기도 같다). 늦은 응답은 리듀서가 대화 상자의 요청과 맞는지 보고 버린다 */
  const readSkill = async (request: SkillRequest): Promise<void> => {
    dispatch({ type: "skillOpened", request });
    const viewed = await commands.skills.view(request.name, request.threadId ?? undefined);
    if (viewed.ok) {
      dispatch({ type: "skillLoaded", request, skill: viewed.value });
      return;
    }
    dispatch({ type: "skillFailed", request, failure: skillFailureOf(viewed.error) });
  };

  const openThread = (threadId: string): void => {
    const found = threads.find((summary) => summary.threadId === threadId);
    // 근거 대화는 거울에 있을 때만 연다(schedules와 같은 규칙)
    if (found === undefined) return;
    shell.updatePlace({ screen: "chat", scroll: 0 });
    commands.showScreen("chat");
    commands.selectThread(found.threadId);
  };

  const handlers: ProposalsHandlers = {
    filterChange: (filter) => {
      dispatch({ type: "filterChanged", filter });
    },
    select: (key) => {
      dispatch({ type: "select", key });
    },
    act: (action) => {
      const row = selectedRowOf(shownRowsOf(state), state.selectedKey);
      if (row !== null) act(row, action);
    },
    scopeChange: (scope: ProposalScope) => {
      dispatch({ type: "scopeChosen", scope });
    },
    editorChange: (text) => {
      dispatch({ type: "editorChanged", text });
    },
    editorSubmit: () => {
      const editor = state.editor;
      const row = editor.mode === "none" ? null : rowForKey(state, editor.key);
      if (editor.mode === "none" || row === null) return;
      const input: ProposalInput =
        editor.mode === "edit" ? { body: editor.text } : { note: editor.text };
      detach(decide(row, editor.mode === "edit" ? "edit" : "reject", input), rethrow);
    },
    editorCancel: () => {
      dispatch({ type: "editorClosed" });
    },
    confirmAccept: () => {
      const confirm = state.confirm;
      if (confirm === null) return;
      // 확인을 먼저 닫아야 결과 알림이 대화 상자 뒤에 가려지지 않는다
      dispatch({ type: "confirmClosed" });
      const row = rowForKey(state, confirm.key);
      if (row === null) return;
      detach(decide(row, confirm.action, scopeInputOf(row, state)), rethrow);
    },
    confirmCancel: () => {
      dispatch({ type: "confirmClosed" });
    },
    loadMore: () => {
      if (state.list.status !== "ready" || state.list.nextCursor === null) return;
      detach(read(state.filter, state.list.nextCursor, true), rethrow);
    },
    retry: () => {
      detach(read(state.filter, null, false), rethrow);
    },
    openThread,
    skillOpen: (request) => {
      detach(readSkill(request), rethrow);
    },
    skillClose: () => {
      dispatch({ type: "skillClosed" });
    },
    dismissNotice: () => {
      dispatch({ type: "noticeSet", notice: null });
    },
    learningTurnOn: (request) => {
      detach(turnLearningOn(request), rethrow);
    },
    onKey,
  };

  return (
    <ProposalsView
      state={state}
      live={live}
      openable={(threadId) => threads.some((summary) => summary.threadId === threadId)}
      handlers={handlers}
    />
  );
}

/** 화면에 보이는 행(종류 거름 뒤). 목록을 못 읽었으면 빈 목록이다 */
function shownRowsOf(state: ProposalsState): readonly ProposalRowVM[] {
  return state.list.status === "ready" ? visibleRowsOf(state.list.rows, state.filter.kind) : [];
}

/** 행 키로 목록의 행을 찾는다(모든 종류). 결정은 보이지 않는 행에도 갈 수 있으므로 종류 거름을 거치지 않는다 */
function rowForKey(state: ProposalsState, key: string): ProposalRowVM | null {
  if (state.list.status !== "ready") return null;
  return state.list.rows.find((row) => row.key === key) ?? null;
}

/** 승인 입력: 범위를 고를 수 있는 행이면 고른 범위(없으면 기본)를 싣는다 */
function scopeInputOf(row: ProposalRowVM, state: ProposalsState): ProposalInput {
  const scope = effectiveScopeOf(row, state.scope);
  return scope === null ? {} : { scope };
}
