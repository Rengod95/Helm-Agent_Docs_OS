import {
  initialSettingsState,
  settingsViewOf,
  type SettingsController,
  type SettingsState,
  type WritableScope,
} from "@fresnel/client/settings";
import { t } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { SettingKey, SettingsTab } from "@fresnel/contracts/settings";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useLinkPhase } from "../../../state/engine/index.ts";
import { useShell } from "../../../state/shell/index.ts";
import { useSelectedThreadId } from "../../../state/ui/index.ts";
import { useCommands } from "../../commands.ts";
import { PROVIDER_EDITORS } from "../providers/providers-screen.tsx";
import { SecretsPanel } from "../secrets/secrets-screen.tsx";
import { ToolsWebPanel, useToolsWebState } from "../tools-web/tools-web-screen.tsx";
import {
  dirtyKeysOf,
  pageStatusOf,
  SAVED_MARK_MS,
  tabSwitchOf,
  type SettingsKeyIntent,
} from "./settings-model.ts";
import type { FieldHandlers } from "./settings-field.tsx";
import { SettingsPageView, type SettingsPageHandlers } from "./settings-view.tsx";

// 설정 화면(P-09)의 동작. 컨트롤러(`commands.settings.open()`)는 연결마다 하나씩 만든다. 읽기와 알림 구독은 효과가 하고,
// 상태는 `useSyncExternalStore`로 받는다. 탭 옮기기의 초안 묻기, 저장됨 표시 2초, ⌘S와 Esc, 열린 대화가 바뀔 때의 다시 읽기가 여기 있다.
// 그림은 `settings-view.tsx`가 그린다. 시크릿 탭은 P-10 시크릿 화면(`SecretsPanel`)을 그대로 넣는다.
// 계정과 제공자, 예산과 한도의 전용 편집기(P-11)와 도구와 웹 패널(P-12)은 `editors`와 `toolsPanel`로 넣는다.
// 값 입력과 열람은 이 화면이 받지 않는다. 시크릿 값은 `SecretsPanel`의 입력 창이 받는다.

/** 탭을 옮기려다 멈춘 자리. 저장하거나 버리면 `to`로 간다 */
interface PendingMove {
  readonly to: SettingsTab;
  readonly keys: readonly SettingKey[];
}

/** 연결 상태와 그 연결의 컨트롤러. 연결이 바뀔 때 화면 안에서 맞춘다 */
interface Binding {
  readonly live: boolean;
  readonly controller: SettingsController | null;
}

function withKey(set: ReadonlySet<SettingKey>, key: SettingKey): ReadonlySet<SettingKey> {
  return new Set([...set, key]);
}

function withoutKey(set: ReadonlySet<SettingKey>, key: SettingKey): ReadonlySet<SettingKey> {
  const next = new Set(set);
  next.delete(key);
  return next;
}

export function SettingsPage(): ReactNode {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const threadId = useSelectedThreadId();
  const narrow = useShell((s) => s.layout) === "compact";
  const [tab, setTab] = useState<SettingsTab>("overview");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [saved, setSaved] = useState<ReadonlySet<SettingKey>>(() => new Set());
  const [binding, setBinding] = useState<Binding>({ live: false, controller: null });
  // 읽기 때의 열린 대화. 효과에서만 읽고 쓴다(렌더 중에는 건드리지 않는다)
  const threadRef = useRef<ThreadId | null>(threadId);
  const loadedThread = useRef<ThreadId | null>(null);
  const savedTimers = useRef(new Map<SettingKey, number>());

  // 연결이 바뀌면 이 연결의 컨트롤러를 만든다. 만드는 일만 하고(구독하지 않는다), 읽기는 아래 효과가 한다.
  // 연결이 끊기면 컨트롤러는 그대로 두어 마지막 값을 읽기 전용으로 보인다
  if (binding.live !== live) {
    setBinding({ live, controller: live ? commands.settings.open() : binding.controller });
  }
  const controller = binding.controller;

  useEffect(() => {
    threadRef.current = threadId;
  }, [threadId]);

  // 컨트롤러마다 한 번 읽는다. 컨트롤러를 놓을 때(연결이 끊기거나 화면을 떠날 때) 알림 구독을 끊는다
  useEffect(() => {
    if (controller === null || !live) return undefined;
    loadedThread.current = threadRef.current;
    detach(controller.load(), rethrow);
    return () => {
      detach(controller.dispose(), rethrow);
    };
  }, [controller, live]);

  // 열린 대화가 바뀌면 대화 범위 값을 다시 읽는다. 같은 대화는 다시 읽지 않는다(컨트롤러를 만든 읽기가 이미 맞다)
  useEffect(() => {
    if (controller === null || !live) return;
    if (loadedThread.current === threadId) return;
    loadedThread.current = threadId;
    detach(controller.load(), rethrow);
  }, [controller, live, threadId]);

  // 화면을 떠나면 남은 "저장됨" 시계를 끈다
  useEffect(() => {
    const timers = savedTimers.current;
    return () => {
      for (const handle of timers.values()) window.clearTimeout(handle);
      timers.clear();
    };
  }, []);

  const subscribe = useCallback(
    (listener: () => void): (() => void) =>
      controller === null ? () => undefined : controller.subscribe(listener),
    [controller],
  );
  const snapshot = useCallback(
    (): SettingsState => (controller === null ? initialSettingsState : controller.getState()),
    [controller],
  );
  const state = useSyncExternalStore(subscribe, snapshot);
  const status = pageStatusOf({
    live,
    hasController: controller !== null,
    loadStatus: state.status,
  });
  const view = useMemo(() => (status === "ready" ? settingsViewOf(state) : null), [status, state]);
  const toolsWeb = useToolsWebState(live);
  const dirtyKeys = view === null ? [] : dirtyKeysOf(view.tabs);

  const markSaved = (key: SettingKey): void => {
    setSaved((prev) => withKey(prev, key));
    const previous = savedTimers.current.get(key);
    if (previous !== undefined) window.clearTimeout(previous);
    const handle = window.setTimeout(() => {
      savedTimers.current.delete(key);
      setSaved((prev) => withoutKey(prev, key));
    }, SAVED_MARK_MS);
    savedTimers.current.set(key, handle);
  };

  /** 초안이 있는 키 하나를 저장한다. 저장이 끝나 초안과 오류가 없으면 "저장됨"을 보인다 */
  const saveKey = async (key: SettingKey): Promise<void> => {
    if (controller === null || !controller.getState().drafts.has(key)) return;
    await controller.commit(key);
    const after = controller.getState();
    if (!after.drafts.has(key) && !after.errors.has(key)) markSaved(key);
  };

  const moveTo = (to: SettingsTab): void => {
    setTab(to);
    setQuery("");
  };

  const requestTab = (to: SettingsTab): void => {
    const decision = tabSwitchOf({ current: tab, to, dirtyKeys });
    switch (decision.kind) {
      case "stay":
        return;
      case "move":
        moveTo(decision.to);
        return;
      case "ask":
        setPending({ to: decision.to, keys: decision.keys });
        return;
      default:
        return assertNever(decision, "TabSwitch");
    }
  };

  /** 묻는 대화 상자에서 "저장하고 이동": 초안을 모두 저장하고, 하나라도 남으면 옮기지 않는다 */
  const saveThenMove = async (move: PendingMove): Promise<void> => {
    await Promise.all(move.keys.map((key) => saveKey(key)));
    if (controller === null) return;
    const after = controller.getState();
    const stuck = move.keys.some((key) => after.drafts.has(key) || after.errors.has(key));
    if (!stuck) moveTo(move.to);
  };

  const fields: FieldHandlers = {
    edit: (key, raw) => {
      controller?.edit(key, raw);
    },
    change: (key, raw) => {
      if (controller === null) return;
      controller.edit(key, raw);
      detach(saveKey(key), rethrow);
    },
    commit: (key) => {
      detach(saveKey(key), rethrow);
    },
    discard: (key) => {
      controller?.discard(key);
    },
    selectScope: (key: SettingKey, scope: WritableScope) => {
      controller?.selectScope(key, scope);
    },
    reset: (key, scope) => {
      if (controller !== null) detach(controller.reset(key, scope), rethrow);
    },
  };

  const keyIntent = (intent: SettingsKeyIntent): void => {
    if (intent === "save") {
      for (const key of dirtyKeys) detach(saveKey(key), rethrow);
      return;
    }
    if (intent === "discard") {
      for (const key of dirtyKeys) controller?.discard(key);
    }
    // "search"는 찾기 칸의 초점이라 그림이 맡는다
  };

  const handlers: SettingsPageHandlers = {
    select: requestTab,
    query: (text) => {
      setQuery(text);
    },
    keyIntent,
    restart: () => {
      if (controller !== null) detach(controller.restartHost(), rethrow);
    },
    retry: () => {
      if (controller !== null) detach(controller.load(), rethrow);
    },
    back: () => {
      commands.showScreen("chat");
    },
    fields,
    promptSave: () => {
      const move = pending;
      setPending(null);
      if (move !== null) detach(saveThenMove(move), rethrow);
    },
    promptDiscard: () => {
      const move = pending;
      setPending(null);
      if (move === null) return;
      for (const key of move.keys) controller?.discard(key);
      moveTo(move.to);
    },
    promptStay: () => {
      setPending(null);
    },
  };

  return (
    <SettingsPageView
      status={status}
      loadError={state.loadError?.message ?? t("desktop.settings.loadFailed.unknown")}
      view={view}
      tab={tab}
      query={query}
      narrow={narrow}
      readOnly={!live}
      hasThread={threadId !== null}
      saved={saved}
      restartError={state.restartError?.message ?? null}
      prompt={pending === null ? null : { to: pending.to, count: pending.keys.length }}
      secretsPanel={<SecretsPanel />}
      editors={PROVIDER_EDITORS}
      toolsPanel={<ToolsWebPanel state={toolsWeb} live={live} />}
      handlers={handlers}
    />
  );
}
