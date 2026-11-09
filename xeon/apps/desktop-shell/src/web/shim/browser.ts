// 브라우저 전역을 `ShimEnv`로 옮긴다. DOM 타입은 이 파일에만 있다. 읽는 시점은 `createShim`을 부를 때와 명령을 받을 때뿐이다.
import type {
  BrowserPermission,
  OpenSocket,
  ShimEnv,
  ShimFileLike,
  ShimNotifications,
  ShimPage,
  ShimPushManager,
  ShimServiceWorkers,
} from "./env.ts";

/** 페이지에 알리는 진단 이벤트 이름. 값은 코드 글 하나다 */
const REPORT_EVENT = "fresnel-shell-report";
/** 내려받은 주소를 풀기 전에 기다리는 시간(ms). 브라우저가 내려받기를 시작하기 전에 지우면 빈 파일이 된다 */
const RELEASE_DELAY_MS = 1_000;
const NOTICE_ID = "fresnel-shell-notice";
const NOTICE_STYLE = [
  "position:fixed",
  "left:50%",
  "bottom:16px",
  "transform:translateX(-50%)",
  "max-width:90vw",
  "padding:8px 12px",
  "border-radius:8px",
  "background:rgba(0,0,0,0.8)",
  "color:#fff",
  "font:14px system-ui,sans-serif",
  "pointer-events:none",
  "z-index:2147483000",
].join(";");

/**
 * 전역에 없을 수 있는 값을 `undefined`를 포함한 타입으로 받는다. 대입하면 TypeScript가 좁혀 버리므로 함수를 거친다.
 * 브라우저가 기능을 빼고 낼 수 있는 전역(Notification, PushManager, navigator.serviceWorker)에만 쓴다.
 */
function presentOf<T>(value: T | undefined): T | undefined {
  return value;
}

/** 주소로 WebSocket을 여는 함수를 만든다. 시험은 실제 `WebSocket`을 그대로 넣는다 */
export function socketOpener(WebSocketCtor: typeof WebSocket): OpenSocket {
  return (url, handlers) => {
    const socket = new WebSocketCtor(url);
    socket.addEventListener("open", () => {
      handlers.open();
    });
    socket.addEventListener("message", (event) => {
      handlers.message(event.data);
    });
    socket.addEventListener("close", (event) => {
      handlers.close(event.code);
    });
    return {
      send: (text) => {
        socket.send(text);
      },
      close: (code) => {
        socket.close(code);
      },
    };
  };
}

function pageOf(win: Window & typeof globalThis): ShimPage {
  const doc = win.document;
  let notice: HTMLElement | null = null;
  const noticeElement = (): HTMLElement => {
    if (notice === null) {
      const created = doc.createElement("div");
      created.id = NOTICE_ID;
      created.setAttribute("role", "status");
      created.setAttribute("aria-live", "polite");
      created.style.cssText = NOTICE_STYLE;
      created.hidden = true;
      doc.body.append(created);
      notice = created;
    }
    return notice;
  };
  return {
    title: () => doc.title,
    setTitle: (title) => {
      doc.title = title;
    },
    showNotice: (text) => {
      const element = noticeElement();
      // 글만 넣는다. HTML로 해석하지 않는다
      element.textContent = text;
      element.hidden = false;
    },
    hideNotice: () => {
      // 알림을 한 번도 띄우지 않았다면 만들 필요가 없다
      if (notice !== null) notice.hidden = true;
    },
    pickFile: () =>
      new Promise<ShimFileLike | null>((resolve) => {
        // 사용자 제스처 안에서 바로 연다. 이 함수가 호출된 같은 동기 구간에서 `click()`을 부른다
        const input = doc.createElement("input");
        input.type = "file";
        input.hidden = true;
        input.addEventListener(
          "change",
          () => {
            const file = input.files?.item(0) ?? null;
            input.remove();
            resolve(file);
          },
          { once: true },
        );
        input.addEventListener(
          "cancel",
          () => {
            input.remove();
            resolve(null);
          },
          { once: true },
        );
        doc.body.append(input);
        input.click();
      }),
    download: (name, content, mime) => {
      const url = URL.createObjectURL(new Blob([content], { type: mime }));
      const link = doc.createElement("a");
      link.href = url;
      link.download = name;
      link.hidden = true;
      doc.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, RELEASE_DELAY_MS);
    },
    openTab: (url) => {
      win.open(url, "_blank", "noopener,noreferrer");
    },
    focusWindow: () => {
      win.focus();
    },
    report: (code) => {
      win.dispatchEvent(new CustomEvent(REPORT_EVENT, { detail: code }));
    },
  };
}

function notificationsOf(win: Window & typeof globalThis): ShimNotifications | undefined {
  const Ctor = presentOf(win.Notification);
  if (Ctor === undefined) return undefined;
  return {
    permission: (): BrowserPermission => Ctor.permission,
    requestPermission: () => Ctor.requestPermission(),
    show: (notice, handlers) => {
      const note = new Ctor(notice.title, { body: notice.body });
      note.addEventListener("click", () => {
        handlers.onClick();
      });
      note.addEventListener("error", () => {
        handlers.onError();
      });
    },
  };
}

function pushManagerOf(manager: PushManager): ShimPushManager {
  return {
    subscribe: (options) =>
      manager.subscribe({
        userVisibleOnly: options.userVisibleOnly,
        applicationServerKey: options.applicationServerKey,
      }),
  };
}

/** 서비스 워커와 푸시를 쓸 수 있을 때만 값을 준다. 보안 컨텍스트가 아니면 `navigator.serviceWorker`가 없다 */
function serviceWorkersOf(win: Window & typeof globalThis): ShimServiceWorkers | undefined {
  const container = presentOf(win.navigator.serviceWorker);
  const managerCtor = presentOf(win.PushManager);
  if (container === undefined || managerCtor === undefined) return undefined;
  return {
    register: async (url) => {
      await container.register(url);
    },
    activePushManager: () =>
      container.ready.then((registration) => pushManagerOf(registration.pushManager)),
  };
}

/** 실제 브라우저 `window`를 shim 환경으로 옮긴다 */
export function browserEnvironment(win: Window & typeof globalThis): ShimEnv {
  return {
    location: win.location,
    openSocket: socketOpener(win.WebSocket),
    timers: {
      setTimeout: (callback, ms) => win.setTimeout(callback, ms),
    },
    page: pageOf(win),
    notifications: notificationsOf(win),
    serviceWorkers: serviceWorkersOf(win),
    fetch: (url, init) => win.fetch(url, init),
    isSecureContext: win.isSecureContext,
  };
}
