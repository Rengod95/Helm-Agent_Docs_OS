import { t } from "@fresnel/client/i18n";
import {
  decisionParams,
  type ProposalAction,
  type ProposalInput,
  type ProposalRowVM,
  type ProposalScope,
} from "@fresnel/client/settings";
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
import {
  confirmActionOf,
  effectiveScopeOf,
  INITIAL_PROPOSALS_STATE,
  listParamsOf,
  moveSelectionOf,
  proposalKeyIntentOf,
  proposalsReducer,
  selectedRowOf,
  visibleRowsOf,
  type ProposalFilter,
  type ProposalPage,
  type ProposalsState,
} from "./proposals-model.ts";
import { commandErrorIdOf, decisionErrorIdOf, doneNoticeIdOf } from "./proposals-text.ts";
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
        unavailableTexts: listed.value.unavailableTexts,
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

  const notify = (tone: "success" | "danger", text: string): void => {
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
    notify("success", t(doneNoticeIdOf(action, outcome.applied)));
    await read(state.filter, null, false);
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
    // 확인 대화 상자나 편집기가 열려 있으면 목록 바로 가기 키는 쉰다(대화 상자는 포털이라 이벤트가 이 자리로 올라온다)
    if (state.confirm !== null || state.editor.mode !== "none") return;
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
    dismissNotice: () => {
      dispatch({ type: "noticeSet", notice: null });
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
