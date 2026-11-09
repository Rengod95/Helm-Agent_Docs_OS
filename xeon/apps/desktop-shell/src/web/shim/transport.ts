// `/shell` 연결 하나를 맡는다: 열기, 연결 전 요청 줄 세우기, 응답 짝짓기, 채널과 이벤트 전달, 끊김과 재연결.
// 브라우저에서 가로채는 명령은 intercepts.ts가 맡고, 여기는 서버로 가는 명령만 다룬다.
import { CHANNEL_KEY } from "../../shared/channels.ts";
import {
  decodeFrame,
  encodeFrame,
  MAX_SHELL_FRAME_CHARS,
  type ServerFrame,
} from "../session/protocol.ts";
import type { OpenSocket, ShimSocket, ShimTimers } from "./env.ts";
import { attempt, isRecord } from "./util.ts";

/** 첫 재연결까지의 기다림(ms). 실패할 때마다 두 배가 되고 상한에서 멈춘다 */
const RECONNECT_FIRST_MS = 500;
const RECONNECT_CAP_MS = 15_000;
const NORMAL_CLOSE = 1000;
const PROTOCOL_ERROR = 1002;
const INTERNAL_ERROR = 1011;
const ABNORMAL_CLOSE = 1006;
/** 인증 실패로 보는 닫힘 코드(1008은 정책 위반, 4401은 인증 필요). 다시 잇지 않고 로그인으로 보낸다 */
const AUTH_CLOSE_CODES: ReadonlySet<number> = new Set([1008, 4401]);
/** 이벤트 이름 규칙. preload의 `EVENT_NAME`과 같다 */
const EVENT_NAME = /^[a-z][a-z0-9-]{0,63}$/u;

/** 연결 상태. `connecting`은 한 번도 열리지 않았고, `lost`는 열린 적이 있다가 끊겼다 */
type LinkState = "connecting" | "open" | "lost" | "stopped";

/** 소켓 하나의 묶음. 닫힘 처리는 한 번만 한다 */
interface Link {
  socket: ShimSocket | null;
  done: boolean;
}

interface Waiter {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
}

/** 연결 전에 줄 세운 것. 명령과 채널 닫기는 낸 순서대로 나간다 */
type Queued =
  | {
      readonly kind: "invoke";
      readonly id: number;
      readonly command: string;
      readonly args: unknown;
      readonly waiter: Waiter;
    }
  | { readonly kind: "close-channel"; readonly id: number };

export interface TransportHooks {
  /** 연결이 열렸다 */
  readonly connected: () => void;
  /** 연결이 끊겼고 다시 잇기를 기다린다 */
  readonly disconnected: () => void;
  /** 열린 적이 있다가 끊긴 뒤 다시 붙었다. 서버 쪽 탭 세션이 사라졌으므로 페이지를 다시 읽는다 */
  readonly reload: () => void;
  /** 인증으로 닫혔다 */
  readonly toLogin: () => void;
  /** 진단 코드 하나(값은 싣지 않는다) */
  readonly report: (code: string) => void;
}

export interface TransportDeps {
  readonly url: string;
  readonly openSocket: OpenSocket;
  readonly timers: ShimTimers;
  readonly hooks: TransportHooks;
}

export interface Transport {
  /** 서버로 명령을 보낸다. 연결 전이면 줄 세운다 */
  readonly invoke: (command: string, args: unknown) => Promise<unknown>;
  /** 메시지를 받을 채널을 열고 `{ $channel: id }`를 돌려준다. 인자에 그대로 실어 보낸다 */
  readonly openChannel: (onMessage: (message: unknown) => void) => Record<string, number>;
  readonly closeChannel: (id: number) => void;
  /** 이름 붙은 이벤트를 듣는다. 돌려주는 함수가 듣기를 끝낸다 */
  readonly listen: (name: string, onEvent: () => void) => () => void;
  /** 이름 붙은 이벤트를 이 탭 안에서 보낸다(브라우저가 낸 알림 사건에 쓴다) */
  readonly emit: (name: string) => void;
}

/** 서버가 보낸 값이 프로토콜 모양이면 그 프레임으로, 아니면 `null` */
function serverFrameOf(value: unknown): ServerFrame | null {
  if (!isRecord(value)) return null;
  if (value.t === "event") {
    return typeof value.name === "string" ? { t: "event", name: value.name } : null;
  }
  if (value.t === "channel") {
    if (typeof value.id !== "number" || !Object.hasOwn(value, "message")) return null;
    return { t: "channel", id: value.id, message: value.message };
  }
  if (value.t === "reply") {
    const { id, ok } = value;
    if (typeof id !== "number") return null;
    // JSON은 undefined를 싣지 못한다. 값이 없는 성공은 undefined 값이다(데스크톱의 void 명령과 같다)
    if (ok === true) {
      return { t: "reply", id, ok: true, value: value.value };
    }
    if (ok === false && Object.hasOwn(value, "error")) {
      return { t: "reply", id, ok: false, error: value.error };
    }
  }
  return null;
}

/** 모양이 틀린 응답이라도 번호만큼은 읽는다. 대기 중인 요청이면 `invalid-reply`로 거절하려고 쓴다 */
function replyIdOf(value: unknown): number | null {
  if (!isRecord(value) || value.t !== "reply" || typeof value.id !== "number") return null;
  return value.id;
}

export function createTransport(deps: TransportDeps): Transport {
  const pending = new Map<number, Waiter>();
  const queued: Queued[] = [];
  const channels = new Map<number, (message: unknown) => void>();
  const listeners = new Map<string, Set<() => void>>();
  let state: LinkState = "connecting";
  let live: Link | null = null;
  let nextId = 1;
  let nextChannel = 1;
  let delay = RECONNECT_FIRST_MS;

  function connect(): void {
    const link: Link = { socket: null, done: false };
    const opened = attempt(() =>
      deps.openSocket(deps.url, {
        open: () => {
          onOpen(link);
        },
        message: (data) => {
          onFrame(link, data);
        },
        close: (code) => {
          lose(link, code);
        },
      }),
    );
    if (opened.ok) {
      link.socket = opened.value;
    } else {
      lose(link, ABNORMAL_CLOSE);
    }
  }

  function onOpen(link: Link): void {
    if (link.done || state === "stopped") return;
    delay = RECONNECT_FIRST_MS;
    deps.hooks.connected();
    if (state === "lost") {
      // 끊겼다가 다시 붙었다. 서버 탭 세션은 사라졌으므로 화면 상태가 낡았다.
      // 상태를 맞추는 가장 단순하고 맞는 방법은 페이지를 다시 읽는 것이다(한 번만).
      state = "stopped";
      link.done = true;
      live = null;
      link.socket?.close(NORMAL_CLOSE);
      deps.hooks.reload();
      return;
    }
    state = "open";
    live = link;
    for (const item of queued.splice(0)) {
      if (item.kind === "invoke") {
        transmit(link, item.id, item.command, item.args, item.waiter);
      } else {
        sendText(link, encodeFrame({ t: "close-channel", id: item.id }));
      }
    }
  }

  function onFrame(link: Link, data: unknown): void {
    if (link.done) return;
    if (typeof data !== "string") {
      violation(link);
      return;
    }
    const decoded = attempt(() => decodeFrame(data));
    if (!decoded.ok) {
      violation(link);
      return;
    }
    const frame = serverFrameOf(decoded.value);
    if (frame === null) {
      const id = replyIdOf(decoded.value);
      const waiter = id === null ? undefined : pending.get(id);
      if (id !== null && waiter !== undefined) {
        pending.delete(id);
        waiter.reject("invalid-reply");
        return;
      }
      violation(link);
      return;
    }
    if (frame.t === "reply") {
      const waiter = pending.get(frame.id);
      // 이미 거절한 요청의 늦은 답이면 버린다
      if (waiter === undefined) return;
      pending.delete(frame.id);
      if (frame.ok) {
        waiter.resolve(frame.value);
      } else {
        waiter.reject(frame.error);
      }
      return;
    }
    if (frame.t === "channel") {
      channels.get(frame.id)?.(frame.message);
      return;
    }
    emit(frame.name);
  }

  /** 프로토콜을 벗어난 프레임은 연결을 닫고 끊김으로 다룬다. 다시 잇는다. 프레임 내용은 기록하지 않는다 */
  function violation(link: Link): void {
    deps.hooks.report("shell-protocol");
    link.socket?.close(PROTOCOL_ERROR);
    lose(link, PROTOCOL_ERROR);
  }

  /** 소켓이 닫혔다. 보낸 뒤 답을 못 받은 요청은 모두 `connection-lost`로 거절하고, 인증 닫힘이 아니면 다시 잇는다 */
  function lose(link: Link, code: number): void {
    if (link.done) return;
    link.done = true;
    if (live === link) live = null;
    const waiting = [...pending.values()];
    pending.clear();
    for (const waiter of waiting) {
      waiter.reject("connection-lost");
    }
    if (AUTH_CLOSE_CODES.has(code)) {
      state = "stopped";
      deps.hooks.toLogin();
      return;
    }
    if (state === "stopped") return;
    if (state === "open") state = "lost";
    deps.hooks.disconnected();
    scheduleReconnect();
  }

  function scheduleReconnect(): void {
    const wait = delay;
    delay = Math.min(delay * 2, RECONNECT_CAP_MS);
    deps.timers.setTimeout(() => {
      if (state !== "stopped") connect();
    }, wait);
  }

  /** 프레임을 보낸다. 쓰지 못하면 연결이 죽은 것으로 보고 닫는다 */
  function sendText(link: Link, text: string): boolean {
    const sent = attempt(() => {
      link.socket?.send(text);
    });
    if (!sent.ok) {
      // 쓰지 못한 소켓을 그대로 두면 이 쪽에서만 끊긴 것으로 보여 서버 쪽 연결이 남는다. 닫고 끊김으로 다룬다
      link.socket?.close(INTERNAL_ERROR);
      lose(link, ABNORMAL_CLOSE);
    }
    return sent.ok;
  }

  function transmit(link: Link, id: number, command: string, args: unknown, waiter: Waiter): void {
    const encoded = attempt(() => encodeFrame({ t: "invoke", id, cmd: command, args }));
    if (!encoded.ok) {
      waiter.reject("invalid-args");
      return;
    }
    // 서버가 이 크기를 넘는 프레임에서 연결을 닫으므로 보내지 않고 거절한다
    if (encoded.value.length > MAX_SHELL_FRAME_CHARS) {
      waiter.reject("too-large");
      return;
    }
    pending.set(id, waiter);
    sendText(link, encoded.value);
  }

  function invoke(command: string, args: unknown): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject: (reason) => {
          // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- 셸 거절 값은 문자열 코드나 {kind}다. Error로 감싸지 않는다(preload와 같다)
          reject(reason);
        },
      };
      const id = nextId;
      nextId += 1;
      if (state === "connecting") {
        queued.push({ kind: "invoke", id, command, args, waiter });
        return;
      }
      if (state === "open" && live !== null) {
        transmit(live, id, command, args, waiter);
        return;
      }
      // 끊긴 뒤에는 줄 세우지 않는다. 다시 붙으면 페이지를 새로 읽으므로 이 요청은 의미가 없다
      waiter.reject("connection-lost");
    });
  }

  function emit(name: string): void {
    // 듣는 중에 스스로 듣기를 끝내도 Set 순회는 안전하다(지운 항목은 건너뛴다)
    for (const listener of listeners.get(name) ?? []) {
      listener();
    }
  }

  connect();

  return {
    invoke,
    openChannel(onMessage) {
      const id = nextChannel;
      nextChannel += 1;
      channels.set(id, onMessage);
      return { [CHANNEL_KEY]: id };
    },
    closeChannel(id) {
      channels.delete(id);
      if (state === "connecting") {
        queued.push({ kind: "close-channel", id });
      } else if (state === "open" && live !== null) {
        sendText(live, encodeFrame({ t: "close-channel", id }));
      }
    },
    listen(name, onEvent) {
      if (!EVENT_NAME.test(name)) return () => undefined;
      const set = listeners.get(name) ?? new Set<() => void>();
      set.add(onEvent);
      listeners.set(name, set);
      return () => {
        set.delete(onEvent);
      };
    },
    emit,
  };
}
