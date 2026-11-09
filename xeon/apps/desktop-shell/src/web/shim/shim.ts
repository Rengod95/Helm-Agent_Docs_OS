// 브라우저 shim(`/shell/shim.js`). `window.fresnelShell`(invoke, openChannel, closeChannel, listen)을 WebSocket 통로로 구현한다.
// UI 번들은 그대로 두고, 이 스크립트가 UI 모듈보다 먼저 실행되어 같은 이름을 심는다(§5.2, §6).
// 설계: 명령 표(intercepts.ts)가 브라우저에서 처리하는 명령을 먼저 받고, 나머지는 transport.ts가 `/shell`로 보낸다.
import { browserEnvironment } from "./browser.ts";
import { createIntercepts } from "./intercepts.ts";
import { createNotifyCommands } from "./notify.ts";
import { createPushRunner } from "./push.ts";
import type { ShimEnv } from "./env.ts";
import { createTransport, type TransportHooks } from "./transport.ts";
import { attempt } from "./util.ts";

/** `/shell`의 경로. 게이트웨이가 여기서 업그레이드를 받는다 */
const SHELL_PATH = "/shell";
/** 인증으로 닫히면 보내는 곳 */
const LOGIN_PATH = "/login";
/** 끊겼을 때 보이는 알림 글 */
export const OFFLINE_TEXT = "서버에 닿지 않아요. 다시 연결하고 있어요.";

/** `window.fresnelShell`의 모양. UI의 `FresnelShellApi`와 같다 */
export interface ShimApi {
  invoke(command: string, args?: unknown): Promise<unknown>;
  openChannel(onMessage: (message: unknown) => void): Record<string, number>;
  closeChannel(id: number): void;
  listen(name: string, onEvent: () => void): () => void;
}

/** 현재 페이지 주소에서 `/shell` WebSocket 주소를 만든다. https면 `wss:`, 아니면 `ws:` */
function shellUrlOf(location: { readonly protocol: string; readonly host: string }): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}${SHELL_PATH}`;
}

export function createShim(env: ShimEnv): ShimApi {
  const hooks: TransportHooks = {
    connected: () => {
      env.page.hideNotice();
    },
    disconnected: () => {
      env.page.showNotice(OFFLINE_TEXT);
    },
    // 서버 탭 세션이 사라졌으므로 페이지를 다시 읽는다. 한 번만 부른다(transport가 보장한다)
    reload: () => {
      env.location.reload();
    },
    toLogin: () => {
      env.location.assign(LOGIN_PATH);
    },
    report: (code) => {
      env.page.report(code);
    },
  };
  const transport = createTransport({
    url: shellUrlOf(env.location),
    openSocket: env.openSocket,
    timers: env.timers,
    hooks,
  });
  const ensurePush = createPushRunner({
    isSecureContext: env.isSecureContext,
    serviceWorkers: env.serviceWorkers,
    fetch: env.fetch,
    report: (code) => {
      env.page.report(code);
    },
  });
  const notify = createNotifyCommands({
    page: env.page,
    notifications: env.notifications,
    emit: (name) => {
      transport.emit(name);
    },
    ensurePush,
  });
  const pushSupported =
    env.isSecureContext && env.serviceWorkers !== undefined && env.notifications !== undefined;
  const intercepts = createIntercepts({ page: env.page, notify, pushSupported });
  // 이미 허용된 페이지는 열 때마다 구독을 맞춘다(구독이 사라졌을 수 있다)
  const notifications = env.notifications;
  if (notifications !== undefined) {
    const read = attempt(() => notifications.permission());
    if (read.ok && read.value === "granted") ensurePush();
  }
  return {
    invoke(command, args) {
      const intercept = intercepts.get(command);
      return intercept === undefined ? transport.invoke(command, args) : intercept(args);
    },
    openChannel: transport.openChannel,
    closeChannel: transport.closeChannel,
    listen: transport.listen,
  };
}

// 페이지에서 실행될 때만 `window.fresnelShell`을 심는다. 읽기 전용이고 한 번만 정의한다
if (typeof window !== "undefined") {
  Object.defineProperty(window, "fresnelShell", {
    value: createShim(browserEnvironment(window)),
    enumerable: true,
  });
}
