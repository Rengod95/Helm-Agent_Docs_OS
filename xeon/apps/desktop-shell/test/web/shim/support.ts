// shim 시험의 가짜와 실제 `/shell` 서버. 가짜는 shim이 쓰는 면(env.ts)의 모양만 맞춘다.
import { afterEach } from "bun:test";
import { socketOpener } from "../../../src/web/shim/browser.ts";
import { decodeFrame, encodeFrame } from "../../../src/web/session/protocol.ts";
import type {
  BrowserPermission,
  ShimEnv,
  ShimFetch,
  ShimFileLike,
  ShimLocation,
  ShimNoticeContent,
  ShimNotifications,
  ShimNotifyHandlers,
  ShimPage,
  ShimRequestInit,
  ShimTimers,
} from "../../../src/web/shim/env.ts";
import { isRecord, ownField } from "../../../src/web/shim/util.ts";

/** 값을 기다리는 약속 하나. 사건이 일어나면 `resolve`로 채운다 */
export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

export function deferred<T>(): Deferred<T> {
  // 실행자는 약속을 만들 때 바로 불리므로 `done`은 아래 `resolve`가 쓸 때 이미 채워져 있다
  let done: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    done = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      done?.(value);
    },
  };
}

export type Settled =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: unknown };

/** 약속의 결과를 값으로 바꾼다. 이행과 거절 모두 값이 된다 */
export function settled(work: Promise<unknown>): Promise<Settled> {
  return work.then(
    (value): Settled => ({ ok: true, value }),
    (error: unknown): Settled => ({ ok: false, error }),
  );
}

// ---------- 브라우저 면의 가짜 ----------

interface Download {
  readonly name: string;
  readonly content: string;
  readonly mime: string;
}

interface PageState {
  title: string;
  readonly notices: string[];
  hidden: number;
  readonly downloads: Download[];
  readonly tabs: string[];
  readonly reports: string[];
  focusCount: number;
  pickCalls: number;
  pickAnswer: ShimFileLike | null;
}

export interface FakePage extends ShimPage {
  readonly state: PageState;
}

export function fakePage(title = "Fresnel"): FakePage {
  const state: PageState = {
    title,
    notices: [],
    hidden: 0,
    downloads: [],
    tabs: [],
    reports: [],
    focusCount: 0,
    pickCalls: 0,
    pickAnswer: null,
  };
  return {
    state,
    title: () => state.title,
    setTitle: (next) => {
      state.title = next;
    },
    showNotice: (text) => {
      state.notices.push(text);
    },
    hideNotice: () => {
      state.hidden += 1;
    },
    pickFile: () => {
      state.pickCalls += 1;
      return Promise.resolve(state.pickAnswer);
    },
    download: (name, content, mime) => {
      state.downloads.push({ name, content, mime });
    },
    openTab: (url) => {
      state.tabs.push(url);
    },
    focusWindow: () => {
      state.focusCount += 1;
    },
    report: (code) => {
      state.reports.push(code);
    },
  };
}

export function fakeFile(
  name: string,
  bytes: Uint8Array,
  size: number = bytes.byteLength,
): ShimFileLike {
  return {
    name,
    size,
    arrayBuffer: () => Promise.resolve(new Uint8Array(bytes).buffer),
  };
}

interface NotificationState {
  permission: BrowserPermission;
  requests: number;
  requestAnswer: BrowserPermission;
  throwOnShow: boolean;
  readonly shown: ShimNoticeContent[];
  readonly handlers: ShimNotifyHandlers[];
}

export interface FakeNotifications extends ShimNotifications {
  readonly state: NotificationState;
}

export function fakeNotifications(permission: BrowserPermission): FakeNotifications {
  const state: NotificationState = {
    permission,
    requests: 0,
    requestAnswer: "denied",
    throwOnShow: false,
    shown: [],
    handlers: [],
  };
  return {
    state,
    permission: () => state.permission,
    requestPermission: () => {
      state.requests += 1;
      state.permission = state.requestAnswer;
      return Promise.resolve(state.requestAnswer);
    },
    show: (notice, handlers) => {
      if (state.throwOnShow) throw new Error("notification refused");
      state.shown.push(notice);
      state.handlers.push(handlers);
    },
  };
}

export interface FakeLocation extends ShimLocation {
  readonly reloads: number;
  readonly assigned: string[];
  /** 처음 새로고침될 때 이행한다 */
  readonly reloaded: Promise<void>;
  /** 처음 이동할 때 목적지를 준다 */
  readonly navigated: Promise<string>;
}

export function fakeLocation(host: string, protocol = "http:"): FakeLocation {
  let reloads = 0;
  const assigned: string[] = [];
  const reloaded = deferred<void>();
  const navigated = deferred<string>();
  return {
    protocol,
    host,
    get reloads() {
      return reloads;
    },
    assigned,
    reloaded: reloaded.promise,
    navigated: navigated.promise,
    reload: () => {
      reloads += 1;
      reloaded.resolve(undefined);
    },
    assign: (url) => {
      assigned.push(url);
      navigated.resolve(url);
    },
  };
}

export interface ManualTimers extends ShimTimers {
  /** 예약된 재연결 기다림(ms)을 예약 순서대로 적는다 */
  readonly delays: number[];
  /** 다음 예약을 기다렸다가 실행한다. 예약이 생기기 전이면 생길 때까지 기다린다 */
  runNext(): Promise<void>;
}

/** 시계를 시험이 돌린다. 실제 시간을 기다리지 않는다 */
export function manualTimers(): ManualTimers {
  const delays: number[] = [];
  const queue: (() => void)[] = [];
  const waiters: (() => void)[] = [];
  return {
    delays,
    setTimeout: (callback, ms) => {
      delays.push(ms);
      queue.push(callback);
      waiters.shift()?.();
      return delays.length;
    },
    runNext: async () => {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
        });
      }
      const next = queue.shift();
      if (next === undefined) throw new Error("no scheduled timer");
      next();
    },
  };
}

export interface FetchCall {
  readonly url: string;
  readonly init: ShimRequestInit | undefined;
}

/** 경로별 응답을 주는 가짜 fetch. 모르는 경로는 404다 */
export function fakeFetch(
  routes: Readonly<Record<string, { readonly ok: boolean; readonly body: unknown }>> = {},
): { readonly fetch: ShimFetch; readonly calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetch: ShimFetch = (url, init) => {
    calls.push({ url, init });
    const route = routes[url];
    const reply = route ?? { ok: false, body: null };
    return Promise.resolve({
      ok: reply.ok,
      json: () => Promise.resolve(reply.body),
    });
  };
  return { fetch, calls };
}

/** 시험 환경 하나. 기본값은 보안 컨텍스트가 아니고 알림도 서비스 워커도 없는 브라우저다 */
export function shimEnv(overrides: Partial<ShimEnv> & { readonly host: string }): ShimEnv {
  const { host, ...rest } = overrides;
  return {
    location: fakeLocation(host),
    openSocket: () => {
      throw new Error("no socket in this test");
    },
    timers: manualTimers(),
    page: fakePage(),
    notifications: undefined,
    serviceWorkers: undefined,
    fetch: fakeFetch().fetch,
    isSecureContext: false,
    ...rest,
  };
}

// ---------- 실제 `/shell` 서버 ----------

interface ServerSocket {
  send(frame: unknown): void;
  /** 글을 그대로 보낸다(프로토콜을 어긴 프레임을 시험할 때) */
  raw(text: string): void;
  close(code: number, reason?: string): void;
}

export interface ServerCall {
  readonly command: string;
  readonly args: unknown;
  readonly id: number;
  readonly socket: ServerSocket;
}

export interface ShellScript {
  readonly onOpen?: (socket: ServerSocket) => void;
  readonly onInvoke: (call: ServerCall) => void;
}

export interface ShellServer {
  readonly port: number;
  /** 받은 명령 이름, 받은 순서대로 */
  readonly commands: string[];
  /** 닫은 채널 번호 */
  readonly channelCloses: number[];
  /** 업그레이드 횟수(연결 수) */
  readonly connections: () => number;
  stop(): Promise<void>;
}

const started: ShellServer[] = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((server) => server.stop()));
});

export function replyOk(call: ServerCall, value: unknown): void {
  call.socket.send({ t: "reply", id: call.id, ok: true, value });
}

export function replyError(call: ServerCall, error: unknown): void {
  call.socket.send({ t: "reply", id: call.id, ok: false, error });
}

/** 인자의 `{ $channel: n }`에서 번호를 읽는다. 없으면 -1 */
export function channelIdOf(args: unknown): number {
  const channel = ownField(args, "ch");
  const id = ownField(channel, "$channel");
  return typeof id === "number" ? id : -1;
}

function socketOf(ws: Bun.ServerWebSocket): ServerSocket {
  return {
    send: (frame) => {
      ws.send(encodeFrame(frame));
    },
    raw: (text) => {
      ws.send(text);
    },
    close: (code, reason) => {
      ws.close(code, reason);
    },
  };
}

export function startShellServer(script: ShellScript): ShellServer {
  const commands: string[] = [];
  const channelCloses: number[] = [];
  let connections = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, bunServer) {
      if (new URL(request.url).pathname === "/shell" && bunServer.upgrade(request)) {
        connections += 1;
        return undefined;
      }
      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        script.onOpen?.(socketOf(ws));
      },
      message(ws, message) {
        if (typeof message !== "string") return;
        const frame = decodeFrame(message);
        if (!isRecord(frame)) return;
        if (frame.t === "close-channel" && typeof frame.id === "number") {
          channelCloses.push(frame.id);
          return;
        }
        if (frame.t === "invoke" && typeof frame.id === "number" && typeof frame.cmd === "string") {
          commands.push(frame.cmd);
          script.onInvoke({
            command: frame.cmd,
            args: frame.args,
            id: frame.id,
            socket: socketOf(ws),
          });
        }
      },
    },
  });
  const port = server.port;
  if (port === undefined) throw new Error("the test server has no port");
  const handle: ShellServer = {
    port,
    commands,
    channelCloses,
    connections: () => connections,
    stop: () => server.stop(true),
  };
  started.push(handle);
  return handle;
}

/** 실제 WebSocket을 쓰는 환경. 위치와 시계와 페이지는 시험이 넣는다 */
export function liveEnv(server: ShellServer, overrides: Partial<ShimEnv> = {}): ShimEnv {
  return shimEnv({
    host: `127.0.0.1:${server.port}`,
    openSocket: liveOpener(),
    ...overrides,
  });
}

/** 실제 전역 `WebSocket`을 감싼 열기 함수. 시험이 browser.ts의 것을 그대로 쓴다 */
function liveOpener(): ShimEnv["openSocket"] {
  return socketOpener(WebSocket);
}
