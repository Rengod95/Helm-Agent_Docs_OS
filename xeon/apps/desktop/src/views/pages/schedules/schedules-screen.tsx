import { activeLocale } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { WireParams } from "@fresnel/contracts/wire";
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
import { checkDraft, checkEditDraft, sheetErrorsOf } from "./schedule-draft.ts";
import {
  canAct,
  INITIAL_SCHEDULE_STATE,
  keyIntentOf,
  listFailureOf,
  listParamsOf,
  noticeOf,
  scheduleReducer,
  selectedItemOf,
  type ScheduleFilter,
} from "./schedule-model.ts";
import { commandErrorOf, message, scheduleErrorOf, type MessageRef } from "./schedule-text.ts";
import { ScheduleScreenView, type ScheduleScreenHandlers } from "./schedules-view.tsx";

// 예약 화면(P-07)의 동작. 목록과 동작은 명령(`commands.schedule`)으로 부르고, 상태는 `scheduleReducer`가 든다.
// 그림은 `schedules-view.tsx`가 그린다.

/** 입력 칸(편집 가능)을 고른다. 여기에 초점이 있으면 화면 바로 가기 키는 아무것도 하지 않는다 */
const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

export function SchedulesScreen(): ReactNode {
  const commands = useCommands();
  // 연결 상태가 바뀔 때마다 다시 읽는다. 연결이 끊기면 마지막 목록을 두고 오프라인으로 바꾼다
  const live = useLinkPhase() === "live";
  const threads = useThreadSummaries();
  const shell = useShellActions();
  const [state, dispatch] = useReducer(scheduleReducer, INITIAL_SCHEDULE_STATE);
  // 늦게 온 응답이 새 응답을 덮지 않도록 읽기마다 번호를 매긴다
  const latest = useRef(0);
  // 목록을 읽을 때 쓰는 거르기. 거르기 동작이 상태와 함께 바꾸고, 다시 읽기는 이 값을 쓴다
  const filterRef = useRef<ScheduleFilter>(INITIAL_SCHEDULE_STATE.filter);

  const load = useCallback(async (): Promise<void> => {
    latest.current += 1;
    const seq = latest.current;
    dispatch({ type: "listStarted" });
    const listed = await commands.schedule.list(listParamsOf(filterRef.current));
    if (seq !== latest.current) return;
    if (listed.ok) {
      dispatch({
        type: "listLoaded",
        items: listed.value.items,
        serviceModeOff: listed.value.serviceModeOff,
        serviceRestartPending: listed.value.serviceRestartPending,
        nowMs: Date.now(),
      });
    } else {
      dispatch({ type: "listFailed", reason: listFailureOf(listed.error) });
    }
  }, [commands]);

  // 연결이 살아날 때마다 다시 읽는다(연결이 끊겨 있었다면 목록이 낡았을 수 있다)
  useEffect(() => {
    if (live) detach(load(), rethrow);
    else dispatch({ type: "listFailed", reason: "offline" });
  }, [load, live]);

  const failNotice = (text: MessageRef): void => {
    dispatch({ type: "notice", notice: noticeOf(text, "danger") });
  };

  const cancelSchedule = async (scheduleId: string): Promise<void> => {
    dispatch({ type: "busy", busy: true });
    const done = await commands.schedule.cancel(scheduleId);
    dispatch({ type: "busy", busy: false });
    dispatch({ type: "dismissCancel" });
    if (!done.ok) return failNotice(commandErrorOf(done.error));
    if (!done.value.ok) return failNotice(scheduleErrorOf(done.value.error));
    dispatch({
      type: "notice",
      notice: noticeOf(message("desktop.schedules.cancelled"), "success"),
    });
    await load();
  };

  const fireSchedule = async (scheduleId: string): Promise<void> => {
    dispatch({ type: "busy", busy: true });
    const fired = await commands.schedule.fire(scheduleId);
    dispatch({ type: "busy", busy: false });
    if (!fired.ok) return failNotice(commandErrorOf(fired.error));
    if (!fired.value.ok) return failNotice(scheduleErrorOf(fired.value.error));
    dispatch({ type: "notice", notice: noticeOf(message("desktop.schedules.fired"), "success") });
    await load();
  };

  const reenableSchedule = async (scheduleId: string): Promise<void> => {
    dispatch({ type: "busy", busy: true });
    const done = await commands.schedule.update({ scheduleId, enabled: true });
    dispatch({ type: "busy", busy: false });
    if (!done.ok) return failNotice(commandErrorOf(done.error));
    // 지난 시각의 `at`이나 상한에 이른 반복은 호스트가 꺼진 채로 돌려준다(L2.schedule §4.4.9 [미결] 14)
    if (!done.value.enabled) return failNotice(message("desktop.schedules.reenableRefused"));
    dispatch({
      type: "notice",
      notice: noticeOf(message("desktop.schedules.reenabled"), "success"),
    });
    await load();
  };

  const showRuns = async (scheduleId: string): Promise<void> => {
    dispatch({ type: "runsStarted", scheduleId });
    const got = await commands.schedule.runs(scheduleId);
    if (got.ok) dispatch({ type: "runsLoaded", scheduleId, runs: got.value.runs });
    else dispatch({ type: "runsFailed", scheduleId, reason: listFailureOf(got.error) });
  };

  const updateSchedule = async (params: WireParams<"schedule.update">): Promise<void> => {
    const done = await commands.schedule.update(params);
    if (!done.ok) {
      dispatch({ type: "sheetFailed", errors: { fields: {}, form: commandErrorOf(done.error) } });
      return;
    }
    dispatch({ type: "sheetClosed" });
    dispatch({ type: "notice", notice: noticeOf(message("desktop.schedules.edited"), "success") });
    await load();
  };

  const enableService = async (): Promise<void> => {
    dispatch({ type: "busy", busy: true });
    const written = await commands.schedule.enableService();
    dispatch({ type: "busy", busy: false });
    if (!written.ok) return failNotice(commandErrorOf(written.error));
    const { restartPending } = written.value;
    dispatch({ type: "serviceEnabled", restartPending });
    // 엔진이 다시 시작해야 켜지면 알림이 그렇게 말하고 "지금 다시 시작"을 붙인다. 이미 켜진 채로 대기가 없으면 예전 글이다
    dispatch({
      type: "notice",
      notice: restartPending
        ? noticeOf(message("desktop.schedules.service.enabledRestart"), "success", "restartEngine")
        : noticeOf(message("desktop.schedules.service.enabled"), "success"),
    });
    await load();
  };

  const createSchedule = async (params: WireParams<"schedule.create">): Promise<void> => {
    const created = await commands.schedule.create(params);
    if (!created.ok) {
      dispatch({
        type: "sheetFailed",
        errors: { fields: {}, form: commandErrorOf(created.error) },
      });
      return;
    }
    if (!created.value.ok) {
      dispatch({ type: "sheetFailed", errors: sheetErrorsOf(created.value.error) });
      return;
    }
    dispatch({ type: "sheetClosed" });
    dispatch({ type: "notice", notice: noticeOf(message("desktop.schedules.created"), "success") });
    await load();
  };

  const openThread = (threadId: string): void => {
    const found = threads.find((summary) => summary.threadId === threadId);
    // 대화 id의 타입은 거울의 요약이 갖고 있다. 거울에 없는 대화는 열지 않는다(app.tsx onGoToThread와 같은 규칙)
    if (found === undefined) return;
    shell.updatePlace({ screen: "chat", scroll: 0 });
    commands.showScreen("chat");
    commands.selectThread(found.threadId);
  };

  const openable = (threadId: string): boolean =>
    threads.some((summary) => summary.threadId === threadId);

  const submitSheet = (): void => {
    const sheet = state.sheet;
    if (sheet === null || sheet.sending) return;
    if (sheet.mode === "edit") {
      const edit = sheet.scheduleId === null ? null : checkEditDraft(sheet.draft, sheet.scheduleId);
      if (edit === null) return;
      if (!edit.ok) {
        dispatch({ type: "sheetFailed", errors: edit.errors });
        return;
      }
      dispatch({ type: "sheetSending", sending: true });
      detach(updateSchedule(edit.params), rethrow);
      return;
    }
    const check = checkDraft(sheet.draft, Date.now());
    if (!check.ok) {
      dispatch({ type: "sheetFailed", errors: check.errors });
      return;
    }
    dispatch({ type: "sheetSending", sending: true });
    detach(createSchedule(check.params), rethrow);
  };

  const onKey = (event: ReactKeyboardEvent<HTMLElement>): void => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const intent = keyIntentOf({
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      editable: target !== null && target.closest(EDITABLE) !== null,
      onRow: target !== null && target.dataset.slot === "table-row",
    });
    if (intent === null) return;
    event.preventDefault();
    const selected = selectedItemOf(state);
    switch (intent.type) {
      case "new":
        if (canAct(state)) dispatch({ type: "openNew", nowMs: Date.now() });
        return;
      case "move":
        dispatch({ type: "move", delta: intent.delta });
        return;
      case "openThread": {
        const threadId = selected?.lastRun?.threadId ?? null;
        if (threadId !== null && openable(threadId)) openThread(threadId);
        return;
      }
      case "cancel":
        if (selected !== null && selected.entry.enabled && canAct(state)) {
          dispatch({ type: "askCancel", id: selected.entry.id });
        }
        return;
      default:
        return assertNever(intent, "KeyIntent");
    }
  };

  const handlers: ScheduleScreenHandlers = {
    filter: (filter) => {
      filterRef.current = filter;
      dispatch({ type: "filterChanged", filter });
      detach(load(), rethrow);
    },
    openNew: () => {
      dispatch({ type: "openNew", nowMs: Date.now() });
    },
    retry: () => {
      detach(load(), rethrow);
    },
    enableService: () => {
      detach(enableService(), rethrow);
    },
    dismissNotice: () => {
      dispatch({ type: "notice", notice: null });
    },
    dismissCancel: () => {
      dispatch({ type: "dismissCancel" });
    },
    cancel: (scheduleId) => {
      detach(cancelSchedule(scheduleId), rethrow);
    },
    sheetChange: (draft) => {
      dispatch({ type: "sheetChanged", draft });
    },
    sheetSubmit: submitSheet,
    sheetClose: () => {
      dispatch({ type: "sheetClosed" });
    },
    onKey,
    select: (id) => {
      dispatch({ type: "select", id });
    },
    toggleExpanded: (id) => {
      dispatch({ type: "toggleExpanded", id });
    },
    fire: (id) => {
      detach(fireSchedule(id), rethrow);
    },
    copy: (id) => {
      dispatch({ type: "openCopy", id, nowMs: Date.now() });
    },
    reenable: (id) => {
      detach(reenableSchedule(id), rethrow);
    },
    edit: (id) => {
      dispatch({ type: "openEdit", id, nowMs: Date.now() });
    },
    showRuns: (id) => {
      detach(showRuns(id), rethrow);
    },
    runsClose: () => {
      dispatch({ type: "runsClosed" });
    },
    askCancel: (id) => {
      dispatch({ type: "askCancel", id });
    },
    openThread,
  };

  return (
    <ScheduleScreenView
      state={state}
      locale={activeLocale()}
      openable={openable}
      handlers={handlers}
    />
  );
}
