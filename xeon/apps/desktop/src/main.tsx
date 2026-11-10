import { activeLocale, t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { toast } from "@caustic/react";
import { createRoot } from "react-dom/client";
import pkg from "../package.json" with { type: "json" };
import { createApp } from "./app/bootstrap.ts";
import { createLocalSettings, LOCAL } from "./settings-store/index.ts";
import { selectShellBridge } from "./shell/index.ts";
import { createDesktopIpc } from "./transport/ipc.ts";
import { Providers } from "./views/providers.tsx";
import { App } from "./views/app.tsx";
import { OriginFolderDialogHost } from "./views/origin-folder-dialog.tsx";
import { createOriginFolderPicker, folderPickWith } from "./views/origin-folder-picker.ts";
import { readShellCapabilities, type ShellCapabilities } from "./views/shell-capabilities.ts";
import type { PluginShellPort } from "./plugin-ui/backend.ts";
import { isWebDocument, resolveWebFrameRoot } from "./plugin-ui/frame-root.ts";
import { createPluginUiRuntime } from "./plugin-ui/runtime.ts";
import { createConfirmQueue } from "./views/plugin/confirm-host.tsx";
import { PluginUiProvider } from "./views/plugin/plugin-context.tsx";
import { createDesktopRegistry } from "./views/desktop-registry.tsx";
import { createShellStore, ShellStoreContext } from "./state/shell/index.ts";
import { selectThread } from "./state/engine/index.ts";
import { persistShell, restoreShell } from "./views/shell/persist.ts";
import { installDocumentScrollGuard } from "./views/shell/document-scroll-guard.ts";
import { DesktopShellContext, type DesktopShell } from "./views/desktop-shell-context.ts";
import { createOsNotifier, NOTIFY_FAILED_EVENT, type OsNotifyInvoke } from "./views/os-notify.ts";
import { appearancePortOf, appearancePrefsOf, applyAppearance } from "./views/appearance-prefs.ts";
import { notifyPrefsOf, notifyPrefsPortOf } from "./views/os-notify-prefs.ts";
import { SHELL_INTENT_EVENT, type SubscribeShellIntent } from "./views/shell-intents.ts";
import type { FileSaveInvoke } from "./views/file-save.ts";
import type { FolderPickInvoke } from "./views/folder-pick.ts";
import type { OsReauthInvoke } from "./views/os-reauth.ts";
import { createOsReauthGate, UNAVAILABLE_GATE } from "./app/secret-reveal-gate.ts";
import { RevealGateContext } from "./views/pages/secrets/reveal-gate-context.ts";
import { ShellRestartContext } from "./views/shell-restart-context.ts";
import { UpdateContext } from "./views/update-context.ts";
import { createUpdateController, type UpdatePort } from "./views/update-controller.ts";
import type { UpdateChannelOf, UpdateInvoke } from "./views/update-invoke.ts";

// 셸 호출은 모두 어댑터(src/shell)를 거친다. 실행 때 Electron(preload의 window.fresnelShell)이 있는지 고른다
const shellBridge = selectShellBridge();
const invoke = (command: string, args?: Readonly<Record<string, unknown>>): Promise<unknown> =>
  shellBridge.invoke(command, args);

const osReauth: OsReauthInvoke = (command, args) => invoke(command, args);

// 폴더 선택 창은 모든 OS에서 셸이 띄운다(플러그인 권한은 WebView에 주지 않는다)
const originFolderPicker = createOriginFolderPicker((command, args) => invoke(command, args));
// 기능 감지는 처음 폴더를 고를 때 한 번만 읽는다(데스크톱은 시작 비용이 없다). 웹이면 서버 폴더 고르기 대화 상자를 쓴다
let capabilities: Promise<ShellCapabilities> | null = null;
const usesOriginPicker = async (): Promise<boolean> => {
  capabilities ??= readShellCapabilities((command) => invoke(command));
  const found = await capabilities;
  return found.kind === "web" && found.folderPicker === "origin";
};
const folderPick: FolderPickInvoke = folderPickWith(
  (command) => invoke(command),
  originFolderPicker,
  usesOriginPicker,
);

// 저장 창도 셸이 띄운다. 내용을 넘기는 인자는 `save_file`의 `suggestedName`, `content`다
const fileSave: FileSaveInvoke = (command, args) => invoke(command, args);

// 업데이트 명령(B-10)도 셸이 부른다. 확인, 내려받기, 설치는 셸이 하고, 내려받기 진행만 채널로 받는다
const updateInvoke: UpdateInvoke = (command, args) => invoke(command, args);
const updateChannel: UpdateChannelOf = (onMessage) => shellBridge.createChannel(onMessage);
const updatePort: UpdatePort = { invoke: updateInvoke, createChannel: updateChannel };

// OS 알림, 트레이, 셸 의도 명령도 셸이 부른다(WebView에는 알림 플러그인 권한을 주지 않는다). 깨우기 이벤트만 셸 다리의 `listen`으로 듣는다
const osNotifyInvoke: OsNotifyInvoke = (command, args) => invoke(command, args);
const subscribeShellIntent: SubscribeShellIntent = (onWake) =>
  shellBridge.listen(SHELL_INTENT_EVENT, onWake);

// 셸이 알림을 띄운 뒤 OS가 실패하면 보내는 이벤트(Electron 셸). 다리의 `listen`이 약속을 돌려주므로 해제는 약속이 풀린 뒤에 한다
const subscribeNotifyFailure = (onFailed: () => void): (() => void) => {
  const pending = shellBridge.listen(NOTIFY_FAILED_EVENT, onFailed);
  return () => {
    detach(
      pending.then((stop) => stop()),
      rethrow,
    );
  };
};

// 문서 스크롤 안전망(styles.css가 문서를 막고, 움직인 문서 스크롤은 이 가드가 되돌린다). 창이 닫힐 때까지 둔다
installDocumentScrollGuard(document, window);

// WebView 진입점. 스토어와 연결은 createApp이 만들고 여기서는 화면에 붙이기만 한다.
const container = document.getElementById("root");
if (container === null) {
  document.body.textContent = "root element is missing";
} else {
  const root = createRoot(container);
  // 로케일이 바뀌면 문장을 다시 풀도록 트리를 새로 만든다(문장은 렌더 때 현재 로케일로 풀린다)
  const rerender: { current: ((locale: string) => void) | null } = { current: null };
  const ipc = createDesktopIpc(shellBridge);
  const localSettings = createLocalSettings(ipc);
  const shell = createShellStore(window.innerWidth);
  const registry = createDesktopRegistry();
  const mac = navigator.platform.startsWith("Mac");
  // 사람 재인증 창은 macOS에서만 있다(셸의 `os_reauth`는 다른 OS에서 항상 unavailable). 그 밖은 값 보기가 잠긴다
  const revealGate = mac ? createOsReauthGate(osReauth) : UNAVAILABLE_GATE;
  // 앱 버전은 셸의 업데이트 상태에서 읽는다. 컨트롤러는 앱 다음에 만들어지므로 자리를 먼저 둔다
  const updateRef: { current: ReturnType<typeof createUpdateController> | null } = {
    current: null,
  };
  const app = createApp({
    localSettings,
    languages: navigator.languages.length > 0 ? navigator.languages : [navigator.language],
    onLocaleChange: (locale) => {
      rerender.current?.(locale);
    },
    // 엔진이 다시 돌아오면 완료를 알린다(다시 시작 필요 목록은 bootstrap이 비운다)
    onEngineRestarted: () => {
      toast({ tone: "success", title: t("desktop.restart.done") });
    },
    ipc,
    clock: { now: () => Date.now() },
    scheduler: {
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (handle) => {
        window.clearTimeout(handle);
      },
    },
    frames: window,
    monotonic: () => performance.now(),
    clipboard: navigator.clipboard,
    appVersion: pkg.version,
    liveAppVersion: () => updateRef.current?.currentVersion() ?? null,
    frameFallbackMs: 100,
  });
  // 업데이트는 열 때 한 번 조용히 확인한다. 설정이 안 됐으면 칸과 줄이 "설정되지 않았어요"로 끝나고 토스트는 없다
  const updateController = createUpdateController(updatePort);
  updateRef.current = updateController;
  detach(updateController.start(), rethrow);
  // OS 알림 전달기. 듣기는 셸 다리가 연결이 살아 있을 때 건다(`notices.onDelivered`는 연결이 바뀌면 끊긴다)
  const notifier = createOsNotifier({
    subscribe: (listener) => app.commands.notices.onDelivered(listener),
    invoke: osNotifyInvoke,
    subscribeFailure: subscribeNotifyFailure,
    isFocused: () => document.hasFocus(),
    prefs: () => notifyPrefsOf(localSettings),
    threadOf: (threadId) => selectThread(app.engine.read.getState(), threadId),
    now: () => Date.now(),
    onResult: (outcome) => {
      if (outcome !== "shown") app.log.logger.warn("desktop.notify.not_shown", { outcome });
    },
  });
  const desktopShell: DesktopShell = {
    invoke: (command, args) => invoke(command, args),
    subscribeIntent: subscribeShellIntent,
    notifier,
    prefs: notifyPrefsPortOf(localSettings),
    appearance: appearancePortOf(localSettings, document.documentElement),
  };
  // 플러그인 화면 실행 맥락. Windows는 전용 스킴 주소가 달라 프레임 모드를 켜지 않는다(ADR-0021 §3.6.2)
  // 웹 브라우저는 https 주소(`/view/<토큰>/`)로 열어 스킴 제약이 없으므로 Windows 브라우저도 켠다(L4.remote.spec §6.3)
  const webDocument = isWebDocument(window.location);
  const framesSupported = webDocument || !navigator.platform.startsWith("Win");
  const pluginUi = {
    runtime: createPluginUiRuntime({
      withConnection: (run) => app.commands.pluginUi.withConnection(run),
      appRootsInvoke: framesSupported ? (command, args) => invoke(command, args) : undefined,
      framesSupported,
    }),
    confirm: createConfirmQueue(),
    // 웹이면 프레임을 열 때마다 게이트웨이에서 권한 토큰 경로를 받는다. 데스크톱은 `fresnel-view://`를 그대로 쓴다
    frameRoot: webDocument
      ? () => resolveWebFrameRoot((command) => invoke(command), window.location.origin)
      : undefined,
    logger: app.log.logger,
    openExternal: async (href: string) => {
      await invoke("open_external", { href });
    },
    // 프레임 대신 앱 본 화면이 셸 명령을 부른다. 웹 빌드는 어댑터가 명령을 거절하므로 op가 `failed`로 끝난다
    shell: {
      invoke: (command, args) => invoke(command, args),
      registerSecret: (name, action, value) => ipc.registerSecret(name, action, value),
    } satisfies PluginShellPort,
  };
  window.addEventListener("error", (event) => {
    app.log.logger.error("desktop.window.error", {
      name: event.error instanceof Error ? event.error.name : "unknown",
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    app.log.logger.error("desktop.window.unhandled_rejection", {
      name: event.reason instanceof Error ? event.reason.name : "unknown",
    });
  });
  // 창이 닫히면 릴레이만 끊는다. 엔진을 끄는 일은 셸이 한다(spec 4.3)
  window.addEventListener("pagehide", () => {
    detach(app.stop(), rethrow);
  });
  const render = (locale: string): void => {
    root.render(
      <ShellStoreContext value={shell}>
        <Providers key={locale} engine={app.engine.read} ui={app.ui.read} commands={app.commands}>
          <DesktopShellContext value={desktopShell}>
            <UpdateContext value={updateController}>
              <PluginUiProvider value={pluginUi}>
                <RevealGateContext value={revealGate}>
                  {/* 셸이 엔진을 다시 띄울 수 있다. 웹 진입점은 이 문맥을 주지 않아 단추 대신 한 줄만 보인다(U-02) */}
                  <ShellRestartContext value>
                    <App
                      registry={registry}
                      keyOverrides={localSettings.get(LOCAL.keybindings)}
                      mac={mac}
                      folderPick={folderPick}
                      fileSave={fileSave}
                    />
                    <OriginFolderDialogHost picker={originFolderPicker} />
                  </ShellRestartContext>
                </RevealGateContext>
              </PluginUiProvider>
            </UpdateContext>
          </DesktopShellContext>
        </Providers>
      </ShellStoreContext>,
    );
  };
  rerender.current = render;
  render(activeLocale());
  // 저장해 둔 영역·자리를 읽어 얹은 뒤부터 바뀐 값을 쓴다(읽기 전에는 쓰지 않는다)
  detach(
    localSettings.load().then((loaded) => {
      if (loaded.ok) {
        shell.actions.replace(restoreShell(shell.read.getState(), localSettings));
        applyAppearance(document.documentElement, appearancePrefsOf(localSettings));
      }
      shell.read.subscribe((next, prev) => {
        detach(Promise.all(persistShell(prev, next, localSettings)), rethrow);
      });
      render(activeLocale());
      return null;
    }),
    rethrow,
  );
}
