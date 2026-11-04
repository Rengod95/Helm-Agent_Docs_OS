import { activeLocale, t } from "@fresnel/client/i18n";
import { CLIPBOARD_CLEAR_MS, submitKey, type KeyField } from "@fresnel/client/settings";
import { assertNever, detach, rethrow, type Scheduler } from "@fresnel/contracts";
import type { SecretName } from "@fresnel/contracts/capabilities";
import {
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLinkPhase } from "../../../state/engine/index.ts";
import { useCommands } from "../../commands.ts";
import { RevealGateContext } from "./reveal-gate-context.ts";
import { draftOf, entryNameOf, metaParamsOf, type MetaDraft } from "./secret-draft.ts";
import {
  COUNTDOWN_REFRESH_MS,
  initialSecretsState,
  listActionOf,
  secretsReducer,
  secretsViewOf,
  type KeyIntent,
  type Notice,
  type SecretSort,
} from "./secret-model.ts";
import { createRevealSession, revealPortOf, type RevealSession } from "./secret-reveal.ts";
import { commandErrorText, metaProblemIdOf, type MessageRef } from "./secret-text.ts";
import { SecretsScreenView, type SecretsScreenHandlers } from "./secrets-view.tsx";

// 시크릿 화면(P-10)의 동작. 목록, 참조, 시험, 메타, 삭제는 명령(`commands.secrets`)으로 부르고, 상태는 `secretsReducer`가 든다.
// 값 보기는 `RevealSession`이 든다: 값은 세션 밖으로 나가지 않는다. 이 파일은 DOM 이벤트(창 흐림, 화면 숨김, 시간 간격)를 잇는다.
// 그림은 `secrets-view.tsx`가 그린다. `SecretsPanel`은 화면 본문이다: 설정 화면이 이것을 넣어 시크릿을 연다(README 참고).

/** 값 보기와 클립보드 시한이 쓰는 창의 타이머 */
const WINDOW_SCHEDULER: Scheduler = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (handle) => {
    window.clearTimeout(handle);
  },
};

const SECONDS = 1000;

/** 명령 오류를 화면 문장으로 */
function messageOf(ref: MessageRef): string {
  return t(ref.id, ref.args);
}

export function SecretsPanel(): ReactNode {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const gate = useContext(RevealGateContext);
  const [state, dispatch] = useReducer(secretsReducer, gate.available, initialSecretsState);
  const latest = useRef(0);

  // 값 보기 세션은 화면 하나에 하나다. 재인증 관문은 앱 진입점이 넣는다(macOS는 `os_reauth`, 그 밖은 잠김)
  const [session] = useState<RevealSession>(() =>
    createRevealSession({
      gate,
      valuePort: revealPortOf(commands.secrets),
      scheduler: WINDOW_SCHEDULER,
      clock: { now: () => Date.now() },
      clipboard: { writeText: (text) => commands.secrets.writeClipboard(text) },
    }),
  );

  const notify = (tone: Notice["tone"], text: string): void => {
    dispatch({ type: "notice", notice: { tone, text } });
  };

  const load = useCallback(async (): Promise<void> => {
    latest.current += 1;
    const seq = latest.current;
    dispatch({ type: "listStarted" });
    const listed = await commands.secrets.list();
    if (seq !== latest.current) return;
    dispatch(listActionOf(listed));
  }, [commands]);

  const loadRefs = useCallback(
    async (name: SecretName): Promise<void> => {
      dispatch({ type: "refs", name, load: { kind: "loading" } });
      const found = await commands.secrets.references(name);
      dispatch({
        type: "refs",
        name,
        load: found.ok
          ? { kind: "ready", value: found.value }
          : { kind: "failed", error: found.error },
      });
    },
    [commands],
  );

  const runTest = useCallback(
    async (name: SecretName): Promise<void> => {
      dispatch({ type: "test", name, load: { kind: "loading" } });
      const tested = await commands.secrets.test(name);
      dispatch({
        type: "test",
        name,
        load: tested.ok
          ? { kind: "ready", value: tested.value }
          : { kind: "failed", error: tested.error },
      });
    },
    [commands],
  );

  // 지금 시각은 효과에서만 읽는다. 처음에 한 번, 그 뒤로는 간격마다 다시 읽는다(마지막 사용 문장의 "2분 전")
  useEffect(() => {
    dispatch({ type: "now", nowMs: Date.now() });
    const timer = window.setInterval(() => {
      dispatch({ type: "now", nowMs: Date.now() });
    }, COUNTDOWN_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  // 연결이 살아날 때마다 목록을 다시 읽는다. 연결이 없으면 마지막 목록을 두고 오프라인으로 바꾼다
  useEffect(() => {
    if (live) detach(load(), rethrow);
    else dispatch({ type: "listFailed", error: { kind: "offline" } });
  }, [load, live]);

  // 고른 시크릿의 참조는 고를 때마다 한 번 읽는다(이미 읽었거나 읽는 중이면 다시 부르지 않는다)
  const detailName = state.detail?.name ?? null;
  const refsIdle = state.detail?.refs.kind === "idle";
  useEffect(() => {
    if (live && detailName !== null && refsIdle) detach(loadRefs(detailName), rethrow);
  }, [live, detailName, refsIdle, loadRefs]);

  // 값 보기 상태가 바뀌면 화면 상태에 옮긴다(값은 옮기지 않는다)
  useEffect(
    () =>
      session.subscribe(() => {
        dispatch({ type: "reveal", view: session.view() });
      }),
    [session],
  );

  // 값이 보이는 동안 남은 초를 시간 간격마다 다시 쓴다
  const revealing = state.reveal.status === "revealed";
  useEffect(() => {
    if (!revealing) return undefined;
    const timer = window.setInterval(() => {
      dispatch({ type: "reveal", view: session.view() });
    }, COUNTDOWN_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [revealing, session]);

  // 창이 뒤로 가거나 화면이 가려지면 값을 가린다
  useEffect(() => {
    const hideOnBlur = (): void => {
      session.hide();
    };
    const hideWhenHidden = (): void => {
      if (document.hidden) session.hide();
    };
    window.addEventListener("blur", hideOnBlur);
    document.addEventListener("visibilitychange", hideWhenHidden);
    return () => {
      window.removeEventListener("blur", hideOnBlur);
      document.removeEventListener("visibilitychange", hideWhenHidden);
    };
  }, [session]);

  // 화면을 떠나면(본문이 사라지면) 값을 가리고 클립보드도 지금 지운다
  useEffect(
    () => () => {
      session.hide();
    },
    [session],
  );

  // 다른 시크릿을 고르면 앞의 값을 가린다
  useEffect(() => {
    if (state.reveal.status !== "hidden" && state.reveal.name !== detailName) session.hide();
  }, [detailName, session, state.reveal]);

  /** 쓰기 명령 하나가 가는 동안 동작 버튼을 잠근다 */
  const busyWhile = async (job: () => Promise<void>): Promise<void> => {
    dispatch({ type: "busy", busy: true });
    try {
      await job();
    } finally {
      dispatch({ type: "busy", busy: false });
    }
  };

  const reloadAndSelect = async (name: SecretName | null): Promise<void> => {
    await load();
    if (name !== null) dispatch({ type: "select", name });
  };

  // ── 등록 창 ───────────────────────────────────────────────────────────

  /** 등록을 시작한다. 호스트가 값을 받으면 그 창에서 받으니 이 화면은 닫는다 */
  const beginEntry = async (name: SecretName, action: "add" | "set"): Promise<void> => {
    const begun = await commands.secrets.beginEntry(name, action);
    if (!begun.ok) {
      dispatch({ type: "entryFailed", error: messageOf(commandErrorText(begun.error)) });
      return;
    }
    if (begun.value) {
      dispatch({ type: "entryClosed" });
      notify("info", t("desktop.secrets.entry.hostWindow"));
      return;
    }
    dispatch({ type: "entryBegun", name, action, started: false });
  };

  const entryNext = (): void => {
    if (state.entry.kind !== "name") return;
    const checked = entryNameOf(state.entry.name);
    if (!checked.ok) {
      dispatch({ type: "entryFailed", error: t("desktop.secrets.entry.nameInvalid") });
      return;
    }
    dispatch({ type: "entryPending", busy: true });
    detach(beginEntry(checked.value, "add"), rethrow);
  };

  const changeValue = (): void => {
    const name = state.detail?.name;
    if (name === undefined) return;
    dispatch({ type: "entryChange", name });
    detach(beginEntry(name, "set"), rethrow);
  };

  /**
   * 값을 등록한다. `submitKey`는 첫 `await` 전에 입력 칸을 읽고 비우므로, 이 함수를 이벤트 안에서 바로 불러야 한다.
   * 값은 셸 명령이 보낸 뒤 덮는다. 상태에는 글자가 없다.
   */
  const submitValue = async (
    name: SecretName,
    action: "add" | "set",
    field: KeyField,
  ): Promise<void> => {
    const outcome = await submitKey(commands.secrets, name, action, field);
    switch (outcome.kind) {
      case "registered":
        dispatch({ type: "entryClosed" });
        notify("success", t("desktop.secrets.entry.saved"));
        await reloadAndSelect(name);
        return;
      case "terminal":
        dispatch({
          type: "entryFailed",
          error: t("desktop.secrets.entry.terminal", {
            command: `fresnel secret ${action} ${name}`,
          }),
        });
        return;
      case "empty":
        dispatch({ type: "entryFailed", error: t("desktop.secrets.entry.empty") });
        return;
      case "failed":
        dispatch({ type: "entryFailed", error: outcome.text });
        return;
      default:
        return assertNever(outcome, "KeyOutcome");
    }
  };

  const entrySubmit = (field: KeyField): void => {
    if (state.entry.kind !== "value") return;
    const { name, action } = state.entry;
    dispatch({ type: "entryPending", busy: true });
    detach(submitValue(name, action, field), rethrow);
  };

  // ── 메타 고치기 ───────────────────────────────────────────────────────

  const openMeta = (): void => {
    const selected = secretsViewOf(state).selected;
    if (selected === null) return;
    dispatch({ type: "metaOpen", name: selected.name, draft: draftOf(selected.meta) });
  };

  const saveMeta = async (name: SecretName, draft: MetaDraft): Promise<void> => {
    const entry = state.rows.find((row) => row.name === name);
    const checked = metaParamsOf(name, draft, entry?.meta);
    if (!checked.ok) {
      dispatch({ type: "metaFailed", error: t(metaProblemIdOf(checked.error)) });
      return;
    }
    dispatch({ type: "metaBusy", busy: true });
    await busyWhile(async () => {
      const saved = await commands.secrets.editMeta(checked.value);
      if (!saved.ok) {
        dispatch({ type: "metaFailed", error: messageOf(commandErrorText(saved.error)) });
        return;
      }
      dispatch({ type: "metaClosed" });
      notify("success", t("desktop.secrets.meta.saved"));
      await reloadAndSelect(name);
    });
  };

  const submitMeta = (): void => {
    if (state.meta.kind !== "open") return;
    detach(saveMeta(state.meta.name, state.meta.draft), rethrow);
  };

  // ── 시험, 삭제 ────────────────────────────────────────────────────────

  const askRemove = (): void => {
    const detail = state.detail;
    if (detail === null) return;
    dispatch({ type: "confirmRemove", open: true });
    detach(loadRefs(detail.name), rethrow);
  };

  const removeSecret = async (name: SecretName): Promise<void> => {
    await busyWhile(async () => {
      const removed = await commands.secrets.remove(name);
      dispatch({ type: "confirmRemove", open: false });
      if (!removed.ok) {
        notify("danger", messageOf(commandErrorText(removed.error)));
        return;
      }
      if (!removed.value) {
        notify("danger", t("desktop.secrets.error.failed"));
        return;
      }
      notify("success", t("desktop.secrets.delete.done"));
      await reloadAndSelect(null);
    });
  };

  // ── 값 보기 ──────────────────────────────────────────────────────────

  const reveal = (): void => {
    const selected = secretsViewOf(state).selected;
    if (selected === null) return;
    detach(session.reveal(selected.name), rethrow);
  };

  const copyValue = async (): Promise<void> => {
    const copied = await session.copy();
    notify(
      copied ? "success" : "danger",
      copied
        ? t("desktop.secrets.reveal.copied", { seconds: CLIPBOARD_CLEAR_MS / SECONDS })
        : t("desktop.secrets.reveal.copyFailed"),
    );
  };

  const intent = (next: KeyIntent): void => {
    switch (next.type) {
      case "move":
        dispatch({ type: "move", delta: next.delta });
        return;
      case "copy":
        detach(copyValue(), rethrow);
        return;
      case "hide":
        session.hide();
        return;
      case "detail":
        // 상세로 초점을 옮기는 일은 화면 그림이 맡는다
        return;
      default:
        return assertNever(next, "KeyIntent");
    }
  };

  const handlers: SecretsScreenHandlers = {
    add: () => {
      dispatch({ type: "entryAdd" });
    },
    retry: () => {
      detach(load(), rethrow);
    },
    query: (query) => {
      dispatch({ type: "query", query });
    },
    sort: (sort: SecretSort) => {
      dispatch({ type: "sort", sort });
    },
    select: (name) => {
      dispatch({ type: "select", name });
    },
    intent,
    dismissNotice: () => {
      dispatch({ type: "notice", notice: null });
    },
    detail: {
      reveal,
      hide: () => {
        session.hide();
      },
      copy: () => {
        detach(copyValue(), rethrow);
      },
      changeValue,
      editMeta: openMeta,
      test: () => {
        const name = state.detail?.name;
        if (name !== undefined) detach(runTest(name), rethrow);
      },
      askRemove,
    },
    entryName: (name) => {
      dispatch({ type: "entryName", name });
    },
    entryNext,
    entrySubmit,
    entryClose: () => {
      dispatch({ type: "entryClosed" });
    },
    metaDraft: (draft) => {
      dispatch({ type: "metaDraft", draft });
    },
    metaSubmit: submitMeta,
    metaClose: () => {
      dispatch({ type: "metaClosed" });
    },
    removeConfirm: () => {
      const name = state.detail?.name;
      if (name !== undefined) detach(removeSecret(name), rethrow);
    },
    removeClose: () => {
      dispatch({ type: "confirmRemove", open: false });
    },
  };

  return (
    <SecretsScreenView
      state={state}
      shownText={session.shownText()}
      locale={activeLocale()}
      nowMs={state.nowMs}
      handlers={handlers}
    />
  );
}
