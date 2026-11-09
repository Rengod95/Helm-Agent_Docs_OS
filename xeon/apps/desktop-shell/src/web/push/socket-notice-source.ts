// 서비스 Unix 소켓에서 `notify.delivered`를 받아 알림 원천(`NoticeSource`, notice-listener.ts)으로 낸다(spec §6.2, HS-94).
// 연결마다 `host.hello`를 먼저 보낸다(클라이언트 이름 `fresnel-web-push`, 토큰 없음: 유닉스 소켓은 접속 전 인증이 없다).
// 답을 받은 뒤에만 알림을 듣는다. 답을 `helloTimeoutMs` 안에 못 받거나 연결이 끊기면 닫고, 1초부터 두 배씩(최대 30초) 기다렸다 다시 붙는다.
// 답을 받으면 기다림을 1초로 되돌린다. 알림 값은 계약 스키마로 검사한다(경계 값이라 `unknown`으로 받는다).
// 이 연결은 바이트를 해석해 값으로 바꿀 뿐이고 본문은 읽어 두지 않는다. 로그에는 연결 상태와 오류 코드만 남긴다.
import { createConnection, type Socket } from "node:net";
import { attempt, parse, type Logger, type Scheduler, type TimerHandle } from "@fresnel/contracts";
import {
  createLineFramer,
  encodeText,
  NotifyDeliveredParamsSchema,
  WIRE_PROTOCOL_VERSION,
  type HostHelloParams,
  type LineFramer,
} from "@fresnel/contracts/wire";
import { errnoCode, isRecord, ownField } from "../../main/lib/narrow.ts";
import { nodeScheduler } from "../../main/lib/scheduler.ts";
import type { NoticeSource, PushableNotice } from "./notice-listener.ts";

/** `host.hello`의 `client.name`. 서비스 로그와 `host.clients`에 이 이름으로 보인다 */
const NOTICE_CLIENT_NAME = "fresnel-web-push";
/** `host.hello`의 `client.version`. desktop-shell은 `apps/host`의 엔진 버전을 가져오지 않으므로 여기에 둔다 */
const NOTICE_CLIENT_VERSION = "0.0.0";
const HELLO_ID = "fresnel-web-push.hello";
const HELLO_PARAMS: HostHelloParams = {
  protocolVersion: WIRE_PROTOCOL_VERSION,
  client: { name: NOTICE_CLIENT_NAME, version: NOTICE_CLIENT_VERSION, kind: "other" },
};
const HELLO_TIMEOUT_MS = 10_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export interface SocketNoticeSourceOptions {
  readonly socketPath: string;
  readonly logger: Logger;
  /** 기본은 노드 타이머다. 시험은 짧은 시간을 넣는다 */
  readonly scheduler?: Scheduler;
  readonly helloTimeoutMs?: number;
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
}

/** 소켓 알림 원천. 첫 `onNotice`에서 연결을 시작하고 `close`에서 끝낸다 */
export interface SocketNoticeSource extends NoticeSource {
  /** 연결을 끊고 다시 붙지 않는다. 듣는 쪽도 모두 뗀다. 여러 번 불러도 된다 */
  close(): void;
}

interface Session {
  readonly socket: Socket;
  readonly framer: LineFramer;
  helloTimer: TimerHandle | null;
  helloDone: boolean;
}

interface SourceState {
  started: boolean;
  closed: boolean;
  backoffMs: number;
  reconnect: TimerHandle | null;
  current: Session | null;
}

export function createSocketNoticeSource(options: SocketNoticeSourceOptions): SocketNoticeSource {
  const scheduler = options.scheduler ?? nodeScheduler();
  const helloTimeoutMs = options.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
  const initialBackoffMs = options.initialBackoffMs ?? INITIAL_BACKOFF_MS;
  const maxBackoffMs = options.maxBackoffMs ?? MAX_BACKOFF_MS;
  const log = options.logger;
  const listeners = new Set<(notice: PushableNotice) => void>();
  const state: SourceState = {
    started: false,
    closed: false,
    backoffMs: initialBackoffMs,
    reconnect: null,
    current: null,
  };

  function clearHelloTimer(session: Session): void {
    if (session.helloTimer === null) return;
    scheduler.clearTimeout(session.helloTimer);
    session.helloTimer = null;
  }

  function scheduleReconnect(): void {
    if (state.closed || state.reconnect !== null) return;
    const delay = state.backoffMs;
    state.backoffMs = Math.min(state.backoffMs * 2, maxBackoffMs);
    state.reconnect = scheduler.setTimeout(connect, delay);
  }

  /** 연결을 끊는다. 닫힘 처리(`onClose`)가 다시 붙는 일을 맡는다 */
  function fail(session: Session, reason: string): void {
    log.warn("push.notice_source_failed", { reason });
    session.socket.destroy();
  }

  function deliver(notice: PushableNotice): void {
    for (const listener of listeners) listener(notice);
  }

  function handleMessage(session: Session, value: unknown): void {
    if (!session.helloDone) {
      if (ownField(value, "id") !== HELLO_ID) return;
      if (!isRecord(ownField(value, "result"))) {
        fail(session, "hello_rejected");
        return;
      }
      session.helloDone = true;
      clearHelloTimer(session);
      state.backoffMs = initialBackoffMs;
      log.info("push.notice_source_connected", {});
      return;
    }
    if (ownField(value, "method") !== "notify.delivered") return;
    const parsed = parse(NotifyDeliveredParamsSchema, ownField(value, "params"));
    if (!parsed.ok) {
      log.warn("push.notice_source_invalid", { reason: "notify_params" });
      return;
    }
    deliver({
      kind: parsed.value.notice.kind,
      title: parsed.value.notice.title,
      threadId: parsed.value.threadId,
    });
  }

  function onConnect(session: Session): void {
    if (state.current !== session) return;
    session.socket.write(
      encodeText(
        JSON.stringify({
          jsonrpc: "2.0",
          id: HELLO_ID,
          method: "host.hello",
          params: HELLO_PARAMS,
        }),
      ),
    );
    session.helloTimer = scheduler.setTimeout(() => {
      session.helloTimer = null;
      if (state.current === session) fail(session, "hello_timeout");
    }, helloTimeoutMs);
  }

  function onData(session: Session, chunk: Buffer): void {
    if (state.current !== session) return;
    for (const event of session.framer.push(chunk)) {
      if (event.kind === "rejected") {
        log.warn("push.notice_source_invalid", { reason: event.problem });
        continue;
      }
      handleMessage(session, event.value);
    }
  }

  function onClose(session: Session): void {
    clearHelloTimer(session);
    if (state.current === session) state.current = null;
    if (state.closed) return;
    log.warn("push.notice_source_disconnected", { connected: session.helloDone });
    scheduleReconnect();
  }

  function connect(): void {
    state.reconnect = null;
    if (state.closed) return;
    const made = attempt(() => createConnection({ path: options.socketPath }));
    if (!made.ok) {
      log.warn("push.notice_source_failed", { reason: "connect_threw" });
      scheduleReconnect();
      return;
    }
    const session: Session = {
      socket: made.value,
      framer: createLineFramer(),
      helloTimer: null,
      helloDone: false,
    };
    state.current = session;
    session.socket.on("connect", () => {
      onConnect(session);
    });
    session.socket.on("data", (chunk: Buffer) => {
      onData(session, chunk);
    });
    session.socket.on("error", (caught: Error) => {
      log.warn("push.notice_source_error", { reason: errnoCode(caught) ?? "UNKNOWN" });
    });
    session.socket.on("close", () => {
      onClose(session);
    });
  }

  return {
    onNotice(callback) {
      if (state.closed) return () => undefined;
      listeners.add(callback);
      if (!state.started) {
        state.started = true;
        connect();
      }
      return () => {
        listeners.delete(callback);
      };
    },

    close() {
      if (state.closed) return;
      state.closed = true;
      listeners.clear();
      if (state.reconnect !== null) {
        scheduler.clearTimeout(state.reconnect);
        state.reconnect = null;
      }
      const current = state.current;
      state.current = null;
      if (current !== null) {
        clearHelloTimer(current);
        current.socket.destroy();
      }
    },
  };
}
