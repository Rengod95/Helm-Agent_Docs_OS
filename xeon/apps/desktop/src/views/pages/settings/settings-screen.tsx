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
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useLinkPhase } from "../../../state/engine/index.ts";
import { useShell } from "../../../state/shell/index.ts";
import {
  useSelectedThreadId,
  useSettingsJump,
  type SettingsJump,
} from "../../../state/ui/index.ts";
import { useCommands, type SettingsFileTarget, type SettingsFileWrite } from "../../commands.ts";
import { PROVIDER_EDITORS, RotationPanel, useUsageState } from "../providers/providers-screen.tsx";
import { UsagePanelView } from "../providers/providers-view.tsx";
import { SecretsPanel } from "../secrets/secrets-screen.tsx";
import type { FolderPickInvoke } from "../../folder-pick.ts";
import { useSettingsFilePaths } from "./settings-file-paths.ts";
import { RestorePanel } from "./settings-restore-screen.tsx";
import { ToolsWebPanel, useToolsWebState } from "../tools-web/tools-web-screen.tsx";
import {
  fileDirtyOf,
  fileEditableOf,
  fileEditorReducer,
  fileSaveableOf,
  initialFileEditor,
  type FileScope,
} from "./settings-file-model.ts";
import {
  dirtyKeysOf,
  pageStatusOf,
  SAVED_MARK_MS,
  tabSwitchOf,
  type SettingsKeyIntent,
} from "./settings-model.ts";
import type { DedicatedEditors, FieldHandlers } from "./settings-field.tsx";
import { SettingsFileEditorView, type SettingsFileHandlers } from "./settings-file-view.tsx";
import { SETTINGS_EDITORS } from "./settings-editors-screen.tsx";
import { SettingsPageView, type SettingsPageHandlers } from "./settings-view.tsx";
import { UpdatePanel } from "./settings-update-view.tsx";
import { NotifyPanel } from "./settings-notify-view.tsx";
import { AppearancePanel } from "./settings-appearance-view.tsx";

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

/** 이 화면의 전용 편집기 전부. 계정과 제공자(P-11)와 설정 전용 편집기(P-09 §6.13)를 합친다 */
const EDITORS: DedicatedEditors = { ...PROVIDER_EDITORS, ...SETTINGS_EDITORS };

function withKey(set: ReadonlySet<SettingKey>, key: SettingKey): ReadonlySet<SettingKey> {
  return new Set([...set, key]);
}

function withoutKey(set: ReadonlySet<SettingKey>, key: SettingKey): ReadonlySet<SettingKey> {
  const next = new Set(set);
  next.delete(key);
  return next;
}

export function SettingsPage(props: {
  /** 폴더 선택 창을 부르는 invoke. 데이터 복원 구역의 고르기 단추가 쓴다 */
  readonly folderPick?: FolderPickInvoke | undefined;
}): ReactNode {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const threadId = useSelectedThreadId();
  const narrow = useShell((s) => s.layout) === "compact";
  const [tab, setTab] = useState<SettingsTab>("overview");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [saved, setSaved] = useState<ReadonlySet<SettingKey>>(() => new Set());
  const [binding, setBinding] = useState<Binding>({ live: false, controller: null });
  // 명령 팔레트가 준 요청 가운데 이 화면이 받은 것. 스크롤은 값이 읽힌 뒤 이 요청마다 한 번 한다
  const [taken, setTaken] = useState<SettingsJump | null>(null);
  const scrolled = useRef<SettingsJump | null>(null);
  // 설정 파일 편집기(P-09 "파일로 보기"). 읽기와 쓰기마다 번호를 새로 주고, 응답은 그 번호가 맞을 때만 반영된다(reducer)
  const [file, dispatchFile] = useReducer(fileEditorReducer, initialFileEditor);
  const fileSeq = useRef(0);
  // 읽기 때의 열린 대화. 효과에서만 읽고 쓴다(렌더 중에는 건드리지 않는다)
  const threadRef = useRef<ThreadId | null>(threadId);
  const loadedThread = useRef<ThreadId | null>(null);
  const savedTimers = useRef(new Map<SettingKey, number>());

  // 연결이 살아날 때 이 연결의 컨트롤러를 만들고, 처음 열 때도 만든다. 만드는 일만 하고(구독하지 않는다), 읽기는 아래 효과가 한다.
  // 연결이 끊기면 컨트롤러는 그대로 두어 마지막 값을 보인다. 엔진 항목만 읽기 전용이고 로컬 항목은 바꿀 수 있다(§4.1.3)
  if (binding.live !== live || binding.controller === null) {
    const reopen = live || binding.controller === null;
    setBinding({ live, controller: reopen ? commands.settings.open() : binding.controller });
  }
  const controller = binding.controller;

  useEffect(() => {
    threadRef.current = threadId;
  }, [threadId]);

  // 컨트롤러마다 한 번 읽는다. 엔진이 없는 컨트롤러는 로컬 원천만 읽는다. 컨트롤러를 놓을 때(바뀌거나 화면을 떠날 때) 알림 구독을 끊는다
  useEffect(() => {
    if (controller === null) return undefined;
    loadedThread.current = threadRef.current;
    detach(controller.load(), rethrow);
    return () => {
      detach(controller.dispose(), rethrow);
    };
  }, [controller]);

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
  const usage = useUsageState(live, threadId);
  const filePaths = useSettingsFilePaths(live, threadId);
  const jump = useSettingsJump();
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

  // 명령 팔레트가 준 탭과 항목으로 옮긴다. 이전 요청과 다른 요청이면 그릴 때 맞춘다(찾기 글을 비우고 탭을 연다.
  // 초안이 있으면 묻는 대화 상자가 먼저 뜬다). 요청은 맞춘 뒤 스토어에서 지운다
  if (jump !== null && jump !== taken) {
    setTaken(jump);
    setQuery("");
    requestTab(jump.tab);
  }
  useEffect(() => {
    if (jump !== null) commands.settleSettingsJump();
  }, [jump, commands]);

  // "저장됨" 표시는 2초 뒤 지운다. 화면을 떠나면 시계를 끈다
  useEffect(() => {
    if (!file.saved) return undefined;
    const handle = window.setTimeout(() => {
      dispatchFile({ type: "savedMarkCleared" });
    }, SAVED_MARK_MS);
    return () => {
      window.clearTimeout(handle);
    };
  }, [file.saved]);

  // 항목 자리로 스크롤한다. 탭이 옮겨진 뒤와 값이 읽힌 뒤에 자리가 생긴다. 자리가 없으면(묻기로 막히거나 항목이 없으면) 그만둔다
  useEffect(() => {
    if (taken === null || scrolled.current === taken || view === null) return;
    scrolled.current = taken;
    if (taken.key === null) return;
    const key = taken.key;
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="settings-field"]'));
    rows.find((row) => row.dataset.key === key)?.scrollIntoView({ block: "center" });
  }, [taken, view]);

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
    // "내 값 유지"는 덮어쓰기를 고른 것이다. 표시를 걷고 바로 저장한다(숫자 칸은 이미 끝난 편집이라 블러가 다시 오지 않는다)
    keepDraft: (key) => {
      controller?.keepDraft(key);
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

  /** 원문을 읽는다. 응답은 시작할 때의 번호가 맞을 때만 편집기에 들어간다 */
  const readFileText = async (seq: number, target: SettingsFileTarget): Promise<void> => {
    const read = await commands.settings.readFile(target);
    if (read.ok) {
      dispatchFile({ type: "loaded", seq, doc: read.value });
    } else {
      dispatchFile({ type: "loadFailed", seq, error: read.error });
    }
  };

  /** 쓴다. 파일이 그 사이에 바뀌었으면 충돌 단계로 두고 초안은 남긴다 */
  const writeFileText = async (seq: number, write: SettingsFileWrite): Promise<void> => {
    const written = await commands.settings.writeFile(write);
    if (written.ok) {
      dispatchFile({
        type: "saved",
        seq,
        path: written.value.path,
        sha256: written.value.sha256,
        text: write.text,
      });
      return;
    }
    const error = written.error;
    if (error.kind === "conflict") {
      dispatchFile({ type: "saveConflicted", seq });
    } else {
      dispatchFile({ type: "saveFailed", seq, error });
    }
  };

  /** 읽기를 새 번호로 시작한다. 범위를 바꾸거나 다시 읽을 때도 이것을 쓴다 */
  const startFile = (scope: FileScope, thread: ThreadId | null): void => {
    fileSeq.current += 1;
    const seq = fileSeq.current;
    dispatchFile({ type: "started", seq, scope, threadId: thread });
    detach(readFileText(seq, { scope, threadId: thread }), rethrow);
  };

  const openFile = (): void => {
    if (!live || file.phase !== "closed") return;
    startFile("user", threadId);
  };

  const selectFileScope = (scope: FileScope): void => {
    if (fileDirtyOf(file) || file.saving || file.phase === "loading") return;
    startFile(scope, threadId);
  };

  // 다시 읽기는 편집기가 처음 연 대화로 읽는다. 충돌이나 읽기 실패 뒤에는 초안이 파일 내용으로 바뀐다
  const rereadFile = (): void => {
    if (!live || file.saving) return;
    startFile(file.scope, file.threadId);
  };

  const saveFile = (): void => {
    if (!fileSaveableOf(file, live) || file.doc === null) return;
    fileSeq.current += 1;
    const seq = fileSeq.current;
    dispatchFile({ type: "saveStarted", seq });
    detach(
      writeFileText(seq, {
        scope: file.scope,
        threadId: file.threadId,
        text: file.draft,
        baseSha256: file.doc.sha256,
      }),
      rethrow,
    );
  };

  const editFile = (text: string): void => {
    if (!fileEditableOf(file, live)) return;
    dispatchFile({ type: "edited", text });
  };

  const fileHandlers: SettingsFileHandlers = {
    scope: selectFileScope,
    edit: editFile,
    save: saveFile,
    discard: () => {
      dispatchFile({ type: "discarded" });
    },
    close: () => {
      dispatchFile({ type: "closed" });
    },
    reread: rereadFile,
  };
  const fileEditor =
    file.phase === "closed" ? null : (
      <SettingsFileEditorView
        state={file}
        live={live}
        hasThread={threadId !== null}
        handlers={fileHandlers}
      />
    );

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
    retry: () => {
      if (controller !== null) detach(controller.load(), rethrow);
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
    openFile,
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
      secretsPanel={<SecretsPanel embedded />}
      fileEditor={fileEditor}
      fileOpen={file.phase !== "closed"}
      editors={EDITORS}
      toolsPanel={<ToolsWebPanel state={toolsWeb} live={live} />}
      restorePanel={<RestorePanel folderPick={props.folderPick} />}
      updatePanel={<UpdatePanel />}
      filePaths={filePaths}
      notifyPanel={<NotifyPanel />}
      appearancePanel={<AppearancePanel />}
      rotationPanel={
        view === null ? null : <RotationPanel view={view} live={live} handlers={fields} />
      }
      usagePanel={
        <UsagePanelView
          load={usage.load}
          offline={!live}
          hasThread={threadId !== null}
          onRetry={usage.reload}
        />
      }
      handlers={handlers}
    />
  );
}
