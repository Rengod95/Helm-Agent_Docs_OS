import { t, activeLocale } from "@fresnel/client/i18n";
import { attemptAsync, detach, rethrow } from "@fresnel/contracts";
import type { ExtUiEntry, HostConnection } from "@fresnel/contracts/wire";
import { resolveTree, type ResolvedTree } from "@fresnel/client/views/native";
import {
  buildAppUrl,
  collectThemeTokens,
  stripUnsafeText,
  type BridgeBackend,
  type BridgePolicyContext,
  type ThemePush,
} from "@fresnel/client/views/app";
import { Button } from "@caustic/react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createBridgeBackend } from "../../plugin-ui/backend.ts";
import { newFrameNonce, type PluginUiRuntime } from "../../plugin-ui/runtime.ts";
import { useSelectedThreadId } from "../../state/ui/index.ts";
import { useCommands } from "../commands.ts";
import { NativeTree, type NativeTreeActions } from "./native-tree.tsx";
import { usePluginUi } from "./plugin-context.tsx";
import { PluginFrame } from "./plugin-frame.tsx";

// 플러그인 화면 하나를 셸 틀(머리)과 함께 그린다. 선언형은 `NativeTree`, 앱은 `PluginFrame`이다.
// 셸 머리(확장 이름, 등급, 버전, 프로젝트 배지)는 프레임 밖 셸 층에 있다(ADR-0021 §3.6.6).

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

function themeNow(): ThemePush {
  const style = getComputedStyle(document.documentElement);
  const locale = activeLocale();
  return {
    tokens: collectThemeTokens(THEME_TOKEN_NAMES, (name) => style.getPropertyValue(name)),
    scheme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    density: "comfortable",
    locale,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    hangulWordBreak: locale.startsWith("ko") ? "keep-all" : "normal",
  };
}

const randomFill = (bytes: Uint8Array): void => {
  crypto.getRandomValues(bytes);
};

function Note(props: { readonly text: string }): ReactNode {
  return <p className="p-3 text-sm text-muted-foreground">{props.text}</p>;
}

function Header(props: { readonly entry: ExtUiEntry }): ReactNode {
  const { entry } = props;
  const trust = entry.trust === "managed" ? "user" : entry.trust;
  return (
    <header className="flex items-baseline gap-2 border-b px-3 py-2">
      <h2 className="text-sm font-medium">{entry.title}</h2>
      <span className="text-xs text-muted-foreground">
        {entry.extension} · v{entry.version}
      </span>
      <span className="text-xs text-muted-foreground">
        {t(`client.view.confirm.trust.${trust}`)}
      </span>
      {entry.trust === "project" ? (
        <span className="text-xs">{t("client.view.confirm.projectBadge")}</span>
      ) : null}
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
}): ReactNode {
  return (
    <div className="flex flex-col items-start gap-2 p-3">
      <Note text={t("desktop.plugin.frame.disabled")} />
      <Button
        onClick={() => {
          props.runtime.ledger.reenable(props.keyName);
        }}
      >
        {t("desktop.plugin.frame.reenable")}
      </Button>
    </div>
  );
}

interface Loaded {
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

interface Session {
  readonly box: SessionBox;
  readonly update: (thread: string | null, context: BridgePolicyContext) => void;
  readonly makeBackend: (resize: (height: number) => void) => BridgeBackend;
  readonly nonce: string;
}

function createSession(
  entry: ExtUiEntry,
  loaded: Loaded,
  threadId: string | null,
  showScreen: (screen: "chat" | "settings") => void,
): Session {
  const box: SessionBox = { thread: threadId, context: loaded.context };
  return {
    box,
    update: (thread, context) => {
      box.thread = thread;
      box.context = context;
    },
    nonce: newFrameNonce(randomFill),
    makeBackend: (resize) =>
      createBridgeBackend({
        connection: loaded.connection,
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
        // 외부 링크는 확인 줄이 아직 없어 열지 않는다([미결]). 확인 없이 OS 브라우저를 여는 길은 두지 않는다
        openExternal: () => Promise.resolve(),
        confirmExternal: () => Promise.resolve(false),
        resize,
        diagnostic: () => {},
      }),
  };
}

function useSession(entry: ExtUiEntry, loaded: Loaded, threadId: string | null): Session {
  const commands = useCommands();
  const [session] = useState(() =>
    createSession(entry, loaded, threadId, (screen) => commands.showScreen(screen)),
  );
  useEffect(() => {
    session.update(threadId, loaded.context);
  }, [session, threadId, loaded]);
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
  const session = useSession(entry, loaded, threadId);
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
      theme={themeNow}
      title={entry.title}
      onClosed={() => {}}
    />
  );
}

/** 선언형 화면의 데이터 문서. 뿌리 키는 읽기 전용 메서드 동사(`/status/...`)와 `host`다 */
async function readDoc(
  backend: BridgeBackend,
  context: BridgePolicyContext,
): Promise<Record<string, unknown> | undefined> {
  const verbs = [...context.methods].filter(([, grant]) => grant.readOnly).map(([verb]) => verb);
  const results = await Promise.all(
    verbs.map(async (verb) => ({ verb, result: await backend.query(verb, {}) })),
  );
  const doc: Record<string, unknown> = {};
  for (const { verb, result } of results) {
    if (result.ok) doc[verb] = result.value;
  }
  if (verbs.length > 0 && Object.keys(doc).length === 0) return undefined;
  doc["host"] = backend.host();
  return doc;
}

function NativeBody(props: {
  readonly entry: ExtUiEntry;
  readonly loaded: Loaded;
  readonly runtime: PluginUiRuntime;
}): ReactNode {
  const { entry, loaded, runtime } = props;
  const commands = useCommands();
  const threadId = useSelectedThreadId();
  const session = useSession(entry, loaded, threadId);
  const [backend] = useState(() => session.makeBackend(() => {}));
  const [tree, setTree] = useState<ResolvedTree | "failed" | undefined>(undefined);
  const key = screenKeyOf(entry);
  const disabled = useDisabled(runtime, key);
  const treeDoc = entry.tree;
  const context = loaded.context;
  useEffect(() => {
    if (disabled || treeDoc === undefined) return undefined;
    let live = true;
    const run = async (): Promise<void> => {
      const doc = await attemptAsync(() => readDoc(backend, context));
      if (!live) return;
      if (!doc.ok || doc.value === undefined) {
        runtime.ledger.fail(key, "query_failed");
        setTree("failed");
        return;
      }
      runtime.ledger.succeed(key);
      setTree(resolveTree(treeDoc, { doc: doc.value, locale: activeLocale(), nowMs: Date.now() }));
    };
    detach(run(), rethrow);
    const timer = window.setInterval(() => detach(run(), rethrow), POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [backend, context, runtime, key, disabled, treeDoc]);
  if (disabled) return <DisabledNote runtime={runtime} keyName={key} />;
  if (tree === undefined) return <Note text={t("desktop.plugin.state.loading")} />;
  if (tree === "failed") return <Note text={t("desktop.plugin.state.queryFailed")} />;
  const actions: NativeTreeActions = {
    runCommand(name, values) {
      // 자기 확장이 등록한 명령만 연다. 선언형 화면이 다른 명령을 부르는 길은 없다
      if (context.ownCommands.has(name)) {
        const args = Object.entries(values)
          .map(([field, value]) => `${field}=${String(value)}`)
          .join(" ");
        detach(backend.command(name, args), rethrow);
      }
    },
    openLink(link) {
      if (link.kind === "thread") commands.showScreen("chat");
    },
  };
  return (
    <NativeTree
      root={tree.root}
      actions={actions}
      onRenderError={() => runtime.ledger.fail(key, "render_exception")}
    />
  );
}

export function PluginView(props: { readonly entry: ExtUiEntry }): ReactNode {
  const { entry } = props;
  const { runtime } = usePluginUi();
  const threadId = useSelectedThreadId();
  const loaded = useLoaded(runtime, entry, threadId);
  const key = screenKeyOf(entry);
  const frameDisabled = useDisabled(runtime, key);
  let body: ReactNode;
  if (entry.state === "disabled") body = <Note text={t("desktop.plugin.state.disabled")} />;
  else if (entry.state === "invalid") {
    const reason = stripUnsafeText(entry.issues[0]?.message ?? "", false);
    body = <Note text={t("desktop.plugin.state.invalid", { reason })} />;
  } else if (loaded === undefined) body = <Note text={t("desktop.plugin.state.loading")} />;
  else if (loaded === "offline") body = <Note text={t("desktop.plugin.state.offline")} />;
  else if (entry.mode === "app" && runtime.framesAllowed(entry)) {
    body = frameDisabled ? (
      <DisabledNote runtime={runtime} keyName={key} />
    ) : (
      <FrameBody entry={entry} loaded={loaded} runtime={runtime} />
    );
  } else if (entry.tree !== undefined)
    body = <NativeBody entry={entry} loaded={loaded} runtime={runtime} />;
  else body = <Note text={t("desktop.plugin.state.frameBlocked")} />;
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <Header entry={entry} />
      <div className="min-h-0 flex-1 overflow-auto">{body}</div>
    </section>
  );
}
