import { t, activeLocale } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ExtUiEntry, HostConnection } from "@fresnel/contracts/wire";
import { extMessageOf, resolveTree, type ResolvedTree } from "@fresnel/client/views/native";
import {
  buildAppUrl,
  collectThemeTokens,
  createActionRunner,
  stripUnsafeText,
  type ActionRunner,
  type BridgeBackend,
  type BridgePolicyContext,
  type ThemePush,
} from "@fresnel/client/views/app";
import { Button, Chip, Tooltip } from "@caustic/react";
import { CodeXml, MessageSquare } from "@caustic/react/icons";
import { useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createBridgeBackend, type PluginShellPort } from "../../plugin-ui/backend.ts";
import { newFrameNonce, type PluginUiRuntime } from "../../plugin-ui/runtime.ts";
import { ShellStoreContext } from "../../state/shell/index.ts";
import { useSelectedThreadId } from "../../state/ui/index.ts";
import { useCommands } from "../commands.ts";
import { NativeTree } from "./native-tree.tsx";
import { readTreeOf, treeActionsOf } from "./native-run.ts";
import { usePluginUi, usePluginUiState } from "./plugin-context.tsx";
import { browserClock, browserScheduler, PluginFrame } from "./plugin-frame.tsx";

// 플러그인 화면 하나를 셸 틀(머리)과 함께 그린다. 선언형은 `NativeSurface`(`NativeTree`), 앱은 `PluginFrame`이다.
// 셸 머리(확장 이름, 등급, 버전, 프로젝트 배지)는 프레임 밖 셸 층에 있다(ADR-0021 §3.6.6).
// 선언형 본문은 페이지·패널만이 아니라 상태 표시줄 칸과 확장 상세의 설정 구역도 같이 쓴다(`EntrySurface`).

const POLL_MS = 10_000;
const THEME_TOKEN_NAMES: readonly string[] = [
  "--bg",
  "--fg",
  "--dim",
  "--panel",
  "--border",
  "--accent",
  "--accent-fg",
  "--error",
  "--warn",
  "--live",
  "--code-bg",
];

export const screenKeyOf = (entry: ExtUiEntry): string => `${entry.extension}/${entry.id}`;

/** 앱이 정한 테마(data-theme)가 있으면 따르고, 없으면 시스템 설정을 따른다. 프레임에 보내는 색 체계가 셸 색과 어긋나지 않게 한다 */
export function schemeOf(explicit: string | null, systemDark: boolean): ThemePush["scheme"] {
  if (explicit === "dark" || explicit === "light") return explicit;
  return systemDark ? "dark" : "light";
}

function themeNow(): ThemePush {
  const style = getComputedStyle(document.documentElement);
  const locale = activeLocale();
  return {
    tokens: collectThemeTokens(THEME_TOKEN_NAMES, (name) => style.getPropertyValue(name)),
    scheme: schemeOf(
      document.documentElement.getAttribute("data-theme"),
      window.matchMedia("(prefers-color-scheme: dark)").matches,
    ),
    density: "comfortable",
    locale,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    hangulWordBreak: locale.startsWith("ko") ? "keep-all" : "normal",
  };
}

const randomFill = (bytes: Uint8Array): void => {
  crypto.getRandomValues(bytes);
};

/** 한 줄 자리(상태 표시줄 칸)에서는 `dense`로 여백을 줄인다. 셸 한 줄 글은 본문 글 역할(text-ui-dense)이다 */
function Note(props: { readonly text: string; readonly dense?: boolean }): ReactNode {
  return (
    <p
      className={
        props.dense === true
          ? "m-0 px-1 text-ui-dense text-text-secondary"
          : "m-0 p-3 text-ui-dense text-text-secondary"
      }
    >
      {props.text}
    </p>
  );
}

/**
 * 머리: 제목(strong) 옆에 연한 메타 한 줄, 앱 화면이면 "플러그인 앱" 표지(툴팁은 앱 선언의 이유), 끝에 "대화로".
 * 선 없이 간격으로만 나눈다(DP-03). 폭은 시안 b01 `FRAME_WIDTH`(가운데 68rem, 좌우 여백 한 번)다
 */
function Header(props: {
  readonly entry: ExtUiEntry;
  readonly onBackToChat: () => void;
}): ReactNode {
  const { entry } = props;
  const trust = entry.trust === "managed" ? "user" : entry.trust;
  const reason = entry.app?.reason;
  return (
    <header className="mx-auto flex w-full max-w-[68rem] min-w-0 items-center gap-2 px-3 pt-3 pb-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 className="m-0 font-ui text-ui-strong text-text-primary">
          {extMessageOf(entry.messages, activeLocale(), entry.title)}
        </h2>
        <span className="min-w-0 text-ui-sm text-text-tertiary">
          {entry.extension} · v{entry.version}
        </span>
        <span className="min-w-0 text-ui-sm text-text-tertiary">
          {t(`client.view.confirm.trust.${trust}`)}
        </span>
        {entry.trust === "project" ? (
          <Chip size="sm" tone="warning" variant="soft">
            {t("client.view.confirm.projectBadge")}
          </Chip>
        ) : null}
        {entry.mode === "app" ? (
          <Tooltip
            side="bottom"
            align="start"
            content={reason === undefined ? "" : stripUnsafeText(reason, false)}
          >
            <button
              type="button"
              className="inline-flex flex-none rounded-full outline-none focus-visible:focus-ring"
            >
              <Chip size="sm" tone="neutral" variant="soft" icon={<CodeXml aria-hidden />}>
                {t("desktop.workbench.uiMode.app")}
              </Chip>
            </button>
          </Tooltip>
        ) : null}
      </div>
      <Button
        size="xs"
        variant="outline"
        iconStart={<MessageSquare aria-hidden />}
        onClick={props.onBackToChat}
      >
        {t("desktop.plugin.header.backToChat")}
      </Button>
    </header>
  );
}

/** 장부가 이 화면을 껐는지 본다 */
function useDisabled(runtime: PluginUiRuntime, key: string): boolean {
  return useSyncExternalStore(
    (listener) => runtime.ledger.subscribe(listener),
    () => runtime.ledger.stateOf(key).state === "view_disabled",
    () => false,
  );
}

function DisabledNote(props: {
  readonly runtime: PluginUiRuntime;
  readonly keyName: string;
  readonly dense?: boolean;
}): ReactNode {
  return (
    <div
      className={
        props.dense === true ? "flex items-center gap-2" : "flex flex-col items-start gap-2 p-3"
      }
    >
      <Note text={t("desktop.plugin.frame.disabled")} dense={props.dense === true} />
      <Button
        size="xs"
        variant="outline"
        onClick={() => {
          props.runtime.ledger.reenable(props.keyName);
        }}
      >
        {t("desktop.plugin.frame.reenable")}
      </Button>
    </div>
  );
}

/** 확장 문맥: 연결과 판정 맥락. 화면이 읽은 뒤에만 만든다 */
export interface Loaded {
  readonly connection: HostConnection;
  readonly context: BridgePolicyContext;
}

/** 연결과 판정 맥락을 읽는다. 확장 목록이 바뀌면 다시 읽는다(켜짐·안전 모드가 판정에 들어간다) */
function useLoaded(
  runtime: PluginUiRuntime,
  entry: ExtUiEntry,
  threadId: string | null,
): Loaded | "offline" | undefined {
  const commands = useCommands();
  const [loaded, setLoaded] = useState<Loaded | "offline" | undefined>(undefined);
  const entries = useSyncExternalStore(
    runtime.subscribe,
    () => runtime.getState().entries,
    () => runtime.getState().entries,
  );
  const key = screenKeyOf(entry);
  useEffect(() => {
    let live = true;
    const current = entries.find((item) => screenKeyOf(item) === key) ?? entry;
    const load = async (): Promise<void> => {
      const connected = await commands.pluginUi.withConnection((connection) =>
        Promise.resolve(connection),
      );
      if (!connected.ok) {
        if (live) setLoaded("offline");
        return;
      }
      const context = await runtime.contextFor(current, threadId ?? undefined);
      if (!live) return;
      setLoaded(context.ok ? { connection: connected.value, context: context.value } : "offline");
    };
    detach(load(), rethrow);
    return () => {
      live = false;
    };
  }, [commands, runtime, entry, entries, key, threadId]);
  return loaded;
}

/** 화면 하나가 다리 백엔드에 건네는 바뀌는 값. 렌더 밖(효과)에서만 고친다 */
interface SessionBox {
  thread: string | null;
  context: BridgePolicyContext;
}

export interface Session {
  readonly box: SessionBox;
  /** 판정 맥락을 엔진에서 새로 읽어 `box`에 넣는다. 읽지 못하면 undefined다 */
  readonly recheck: () => Promise<BridgePolicyContext | undefined>;
  readonly update: (thread: string | null, context: BridgePolicyContext) => void;
  readonly makeBackend: (resize: (height: number) => void) => BridgeBackend;
  readonly nonce: string;
}

/** 화면 하나(또는 화면 밖 명령 실행기 하나)가 쓰는 세션. 다리 백엔드와 판정 맥락 갱신을 묶는다 */
export function createSession(
  entry: ExtUiEntry,
  context: BridgePolicyContext,
  threadId: string | null,
  showScreen: (screen: "chat" | "settings") => void,
  current: () => HostConnection | null,
  runtime: PluginUiRuntime,
  openExternal: (href: string) => Promise<void>,
  shell?: PluginShellPort,
): Session {
  const box: SessionBox = { thread: threadId, context };
  return {
    box,
    update: (thread, next) => {
      box.thread = thread;
      box.context = next;
    },
    nonce: newFrameNonce(randomFill),
    recheck: async () => {
      const fresh = await runtime.contextFor(entry, box.thread ?? undefined);
      if (!fresh.ok) return undefined;
      box.context = fresh.value;
      return fresh.value;
    },
    makeBackend: (resize) =>
      createBridgeBackend({
        // 재연결 뒤에도 낡은 연결로 보내지 않게 요청마다 지금 연결을 읽는다
        connection: () => current() ?? undefined,
        shell,
        extension: entry.extension,
        screen: entry.id,
        openThreadId: () => box.thread ?? undefined,
        policy: () => box.context,
        snapshot: () => ({
          threadId: box.thread ?? undefined,
          threadTitle: undefined,
          connection: "connected",
          locale: activeLocale(),
          theme: themeNow().scheme,
          extension: {
            enabled: box.context.enabled,
            trust: box.context.trust,
            safeMode: box.context.safeMode,
          },
        }),
        navigate: (target) => {
          if (target.kind === "settings") {
            showScreen("settings");
            return true;
          }
          if (target.kind === "thread") {
            showScreen("chat");
            return true;
          }
          return false;
        },
        // 실행기가 확인 줄을 거친 주소만 여기까지 온다. 확인 없이 OS 브라우저를 여는 길은 없다
        openExternal,
        resize,
        diagnostic: () => {},
      }),
  };
}

/**
 * 대화 화면으로 간다. 플러그인 화면은 셸의 화면 자리(`places.chat.screen`)에 있으므로 스토어의 화면만 바꾸면 돌아가지 않는다(rtC R-2).
 * 앱 셸의 `showChat`과 같은 순서다
 */
export function useShowChat(): () => void {
  const commands = useCommands();
  // 셸 없이 그린 화면(시험, 따로 끼운 곳)에서는 스토어 화면만 바꾼다
  const shell = useContext(ShellStoreContext)?.actions;
  return () => {
    shell?.switchArea("chat");
    commands.showScreen("chat");
    shell?.updatePlace({ screen: "chat", scroll: 0 });
  };
}

function useSession(
  entry: ExtUiEntry,
  context: BridgePolicyContext,
  threadId: string | null,
  runtime: PluginUiRuntime,
  openExternal: (href: string) => Promise<void>,
  shell: PluginShellPort | undefined,
): Session {
  const commands = useCommands();
  const showChat = useShowChat();
  const [session] = useState(() =>
    createSession(
      entry,
      context,
      threadId,
      (screen) => {
        if (screen === "chat") showChat();
        else commands.showScreen(screen);
      },
      () => commands.pluginUi.current(),
      runtime,
      openExternal,
      shell,
    ),
  );
  useEffect(() => {
    session.update(threadId, context);
  }, [session, threadId, context]);
  return session;
}

function FrameBody(props: {
  readonly entry: ExtUiEntry;
  readonly loaded: Loaded;
  readonly runtime: PluginUiRuntime;
}): ReactNode {
  const { entry, loaded, runtime } = props;
  const plugin = usePluginUi();
  const threadId = useSelectedThreadId();
  const session = useSession(
    entry,
    loaded.context,
    threadId,
    runtime,
    plugin.openExternal,
    plugin.shell,
  );
  const app = entry.app;
  const url =
    app === undefined
      ? undefined
      : buildAppUrl(entry.extension, entry.version, app.entry, session.nonce);
  if (app === undefined || url === undefined) {
    return <Note text={t("desktop.plugin.state.frameBlocked")} />;
  }
  return (
    <PluginFrame
      screenKey={screenKeyOf(entry)}
      url={url}
      nonce={session.nonce}
      declaredBridge={app.bridge}
      ledger={runtime.ledger}
      context={() => session.box.context}
      makeBackend={session.makeBackend}
      confirm={plugin.confirm.request}
      cancelConfirm={plugin.confirm.cancel}
      theme={themeNow}
      title={extMessageOf(entry.messages, activeLocale(), entry.title)}
      onClosed={() => {}}
    />
  );
}

/**
 * 이 화면의 동작 실행기. 화면 하나에 하나이고 화면이 사라지면 대기 중인 확인을 거부로 끝낸다.
 * 화면(`PluginView`)은 화면 키와 버전으로 다시 만들어지므로 입력이 바뀌지 않는다
 */
function useRunner(
  session: Session,
  backend: BridgeBackend,
  runtime: PluginUiRuntime,
  key: string,
): ActionRunner {
  const plugin = usePluginUi();
  const [runner] = useState(() =>
    createActionRunner({
      screenKey: key,
      context: () => session.box.context,
      backend,
      ledger: runtime.ledger,
      clock: browserClock,
      scheduler: browserScheduler,
      confirm: plugin.confirm.request,
      cancelConfirm: plugin.confirm.cancel,
      recheck: session.recheck,
      // 장부가 화면을 껐으면 `useDisabled`가 알아서 폴링을 멈춘다
      onDisabled: () => {},
    }),
  );
  useEffect(
    () => () => {
      runner.dispose();
    },
    [runner],
  );
  return runner;
}

/**
 * 선언형 본문. 확장 문맥(`loaded`)으로 연결과 판정 맥락을 잡고 트리를 그린다.
 * `doc`이 있으면 그 문서로 그릴 때 한 번 자르고 읽기를 하지 않는다. 없으면 데이터 문서를 10초마다 읽어 자른다.
 * 버튼 명령은 `treeActionsOf`로 실행기를 거친다(확인 줄, 쿨다운, 장부). 페이지·패널과 상태 표시줄·설정 구역이 같이 쓴다
 */
export function NativeSurface(props: {
  readonly entry: ExtUiEntry;
  readonly loaded: Loaded;
  readonly doc?: Readonly<Record<string, unknown>> | undefined;
  readonly dense?: boolean;
  /** 값을 읽지 못했는지가 바뀔 때 알린다. 상태 표시줄 칸이 값 없는 칸을 감춘다 */
  readonly onFailed?: ((failed: boolean) => void) | undefined;
}): ReactNode {
  const { entry, loaded, doc, dense = false, onFailed } = props;
  const { runtime, openExternal, shell } = usePluginUi();
  const commands = useCommands();
  const threadId = useSelectedThreadId();
  const session = useSession(entry, loaded.context, threadId, runtime, openExternal, shell);
  const [backend] = useState(() => session.makeBackend(() => {}));
  const key = screenKeyOf(entry);
  const runner = useRunner(session, backend, runtime, key);
  const [actions] = useState(() =>
    treeActionsOf({
      runner,
      context: () => session.box.context,
      ledger: runtime.ledger,
      screenKey: key,
      openChat: () => commands.showScreen("chat"),
    }),
  );
  const [tree, setTree] = useState<ResolvedTree | "failed" | undefined>(undefined);
  // 고정 문서를 자르는 시각은 화면이 처음 잡힐 때 한 번 정한다(그릴 때마다 시각을 읽지 않는다)
  const [mountedAt] = useState(() => Date.now());
  const disabled = useDisabled(runtime, key);
  const treeDoc = entry.tree;
  useEffect(() => {
    if (disabled || treeDoc === undefined || doc !== undefined) return undefined;
    let live = true;
    const run = async (): Promise<void> => {
      const next = await readTreeOf(runner, session.box.context, treeDoc, {
        locale: activeLocale(),
        nowMs: Date.now(),
        ...(entry.messages === undefined ? {} : { messages: entry.messages }),
      });
      if (!live) return;
      if (next === undefined) {
        runtime.ledger.fail(key, "query_failed");
        setTree("failed");
        return;
      }
      runtime.ledger.succeed(key);
      setTree(next);
    };
    detach(run(), rethrow);
    const timer = window.setInterval(() => detach(run(), rethrow), POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [runner, session, runtime, key, disabled, treeDoc, doc, entry.messages]);
  const failed = tree === "failed" && doc === undefined;
  useEffect(() => {
    onFailed?.(failed);
  }, [onFailed, failed]);
  if (disabled) return <DisabledNote runtime={runtime} keyName={key} dense={dense} />;
  if (treeDoc === undefined) return null;
  // 고정 문서는 그릴 때 바로 자른다(읽기 폴링 없이 첫 장면부터 글이 보인다)
  const shown: ResolvedTree | "failed" | undefined =
    doc === undefined
      ? tree
      : resolveTree(treeDoc, {
          doc,
          locale: activeLocale(),
          nowMs: mountedAt,
          ...(entry.messages === undefined ? {} : { messages: entry.messages }),
        });
  if (shown === undefined) return <Note dense={dense} text={t("desktop.plugin.state.loading")} />;
  if (shown === "failed")
    return <Note dense={dense} text={t("desktop.plugin.state.queryFailed")} />;
  return (
    <NativeTree
      root={shown.root}
      actions={actions}
      onRenderError={() => runtime.ledger.fail(key, "render_exception")}
    />
  );
}

/**
 * 항목 하나를 확장 문맥을 읽은 뒤 선언형 본문으로 그린다. 상태 표시줄 칸과 확장 상세의 설정 구역이 쓴다.
 * `doc`이 있으면 데이터 문서를 읽지 않고 그 값으로 그린다(트랜스크립트 카드는 기록의 details를 준다).
 * 페이지와 패널은 `PluginView`가 같은 문맥을 읽는다
 */
export function EntrySurface(props: {
  readonly entry: ExtUiEntry;
  readonly dense?: boolean;
  readonly doc?: Readonly<Record<string, unknown>> | undefined;
  readonly onFailed?: ((failed: boolean) => void) | undefined;
}): ReactNode {
  const { entry, dense = false, doc, onFailed } = props;
  const { runtime } = usePluginUi();
  const threadId = useSelectedThreadId();
  const loaded = useLoaded(runtime, entry, threadId);
  if (loaded === undefined) return <Note dense={dense} text={t("desktop.plugin.state.loading")} />;
  if (loaded === "offline") return <Note dense={dense} text={t("desktop.plugin.state.offline")} />;
  if (!loaded.context.enabled || loaded.context.safeMode) {
    return <Note dense={dense} text={t("desktop.plugin.state.disabled")} />;
  }
  return (
    <NativeSurface entry={entry} loaded={loaded} dense={dense} doc={doc} onFailed={onFailed} />
  );
}

export function PluginView(props: { readonly entry: ExtUiEntry }): ReactNode {
  const { entry } = props;
  const { runtime } = usePluginUi();
  const threadId = useSelectedThreadId();
  const loaded = useLoaded(runtime, entry, threadId);
  const key = screenKeyOf(entry);
  const frameDisabled = useDisabled(runtime, key);
  const showChat = useShowChat();
  const pluginState = usePluginUiState();
  const inactive = pluginState.inactive.has(entry.extension);
  const rootSkipped = pluginState.rootsSkipped.find(
    (skipped) => skipped.extension === entry.extension && skipped.version === entry.version,
  );
  let body: ReactNode;
  if (entry.state === "disabled") body = <Note text={t("desktop.plugin.state.disabled")} />;
  else if (entry.state === "invalid") {
    const reason = stripUnsafeText(entry.issues[0]?.message ?? "", false);
    body = <Note text={t("desktop.plugin.state.invalid", { reason })} />;
  } else if (loaded === undefined) body = <Note text={t("desktop.plugin.state.loading")} />;
  else if (loaded === "offline") body = <Note text={t("desktop.plugin.state.offline")} />;
  // 꺼졌거나 안전 모드가 된 확장은 열린 프레임과 폴링을 거두고 알림만 보인다(본문을 그리지 않으면 거둬진다)
  else if (inactive || !loaded.context.enabled || loaded.context.safeMode) {
    body = <Note text={t("desktop.plugin.state.disabled")} />;
  } else if (entry.mode === "app" && rootSkipped !== undefined && runtime.framesAllowed(entry)) {
    // 셸이 이 앱의 root를 받지 않았다. 그리면 프레임 주소가 404이므로 이유만 보인다
    body = <Note text={t("desktop.plugin.state.invalid", { reason: rootSkipped.kind })} />;
  } else if (entry.mode === "app" && runtime.framesAllowed(entry)) {
    body = frameDisabled ? (
      <DisabledNote runtime={runtime} keyName={key} />
    ) : (
      <FrameBody entry={entry} loaded={loaded} runtime={runtime} />
    );
  } else if (entry.tree !== undefined) body = <NativeSurface entry={entry} loaded={loaded} />;
  else body = <Note text={t("desktop.plugin.state.frameBlocked")} />;
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <Header
        entry={entry}
        onBackToChat={() => {
          showChat();
        }}
      />
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">{body}</div>
    </section>
  );
}
