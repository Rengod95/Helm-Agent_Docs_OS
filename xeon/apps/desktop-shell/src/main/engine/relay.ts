// 엔진 stdout 중계와 stdin 쓰기 대기열(relay.rs의 전송 독립 부분, L4.desktop.spec 3.3, 4.5).
// 명령(engine_attach, engine_write 등)과 Electron 채널 연결은 이 위에 얹는다.
// 셸은 JSON을 해석하지 않는다. 아는 것은 줄 경계(`\n`)뿐이다.
// 1. 신용 창: 보낸 바이트와 확인된 바이트의 차가 창을 넘으면 더 보내지 않는다. 역압이 엔진 stdout 읽기까지 전달된다.
// 2. stdin 쓰기는 전용 루프가 순서대로 한다. 보내는 쪽만 대기열이 찼을 때 기다린다.
// 3. 줄 버퍼는 엔진 세대마다 따로 두고, 세대가 끝나면 꼬리를 버린다.
import {
  attempt,
  attemptAsync,
  detach,
  err,
  ok,
  repeatAsync,
  rethrow,
  type Result,
} from "@fresnel/contracts";
import type { ShellChannel } from "../context.ts";
import type { CommandError, EngineState } from "./state.ts";

/** 신용 창. 보낸 바이트에서 처리 확인된 바이트를 뺀 값이 이 값 이하일 때만 다음 묶음을 보낸다 */
export const CREDIT_WINDOW_BYTES: number = 4 * 1024 * 1024;
/** WebView가 처리한 바이트가 이만큼 쌓일 때마다 확인을 보낸다(WebView 쪽 약속). 창은 이 값의 배수보다 커야 한다 */
export const ACK_STEP_BYTES: number = 256 * 1024;
/** 줄 끝이 오지 않은 채 이 길이를 넘으면 그 줄을 버린다(메모리 상한) */
export const MAX_PENDING_LINE_BYTES: number = 2 * 1024 * 1024;
/** `engine_write` 한 번에 실을 수 있는 크기. 줄(프레임) 단위로 보낸다 */
export const MAX_WRITE_BYTES: number = 2 * 1024 * 1024;
/** 백업 폴더 경로의 상한(바이트) */
export const BACKUP_DIR_MAX_BYTES: number = 4096;
/** 쓰기 대기열 한도(메시지 수). 차면 보내는 쪽이 기다린다 */
export const WRITE_QUEUE_FRAMES: number = 16;

const NEWLINE: number = 0x0a;

// ---------------------------------------------------------------------------------------------
// 공용 도구

/** 깨우기 신호. `notify`는 기다리는 쪽을 모두 깨우고, 깨어난 쪽이 조건을 다시 본다(Rust Notify::notify_waiters와 같다) */
interface Signal {
  wait(): Promise<void>;
  notify(): void;
}

function createSignal(): Signal {
  let waiting: (() => void)[] = [];
  return {
    wait: () =>
      new Promise<void>((resolve) => {
        waiting.push(() => {
          resolve();
        });
      }),
    notify: () => {
      const woken = waiting;
      waiting = [];
      for (const wake of woken) wake();
    },
  };
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 줄 버퍼

/** `LineBuffer.finish`의 결과. 버린 꼬리의 바이트 수와 한도를 넘어 버린 줄 수다 */
interface LineBufferEnd {
  readonly tailBytes: number;
  readonly overflowed: number;
}

/** 엔진 세대 하나의 stdout 줄 버퍼. 완성된 줄만 내보내고 꼬리(줄 끝이 없는 조각)는 쥐고 있는다 */
export interface LineBuffer {
  /** 조각을 넣고 마지막 `\n`까지의 완성된 줄을 돌려준다. 완성된 줄이 없으면 null. 줄 경계는 새 조각에서만 찾는다 */
  push(chunk: Uint8Array): Uint8Array | null;
  /** 수신자가 바뀌었다. 쥔 꼬리를 버리고, 그 줄의 나머지도 다음 `\n`까지 버린다 */
  discardPartial(): void;
  /** 세대가 끝났다. 꼬리를 버리고 그 바이트 수를 돌려준다 */
  finish(): LineBufferEnd;
}

/** `limit`은 꼬리의 최대 길이(바이트)다. 넘으면 그 줄을 버리고 다음 `\n`에서 다시 맞춘다 */
export function createLineBuffer(limit: number): LineBuffer {
  // 꼬리는 조각 목록으로 쥔다. 줄 끝이 아직 없는 동안 조각을 붙여도 전체를 다시 복사하지 않는다.
  let pieces: Uint8Array[] = [];
  let tailLength = 0;
  let skipping = false;
  let overflowed = 0;

  function appendTail(piece: Uint8Array): void {
    if (piece.length === 0) return;
    pieces.push(piece);
    tailLength += piece.length;
  }

  function enforceLimit(): void {
    if (tailLength <= limit) return;
    pieces = [];
    tailLength = 0;
    skipping = true;
    overflowed += 1;
  }

  return {
    push(chunk) {
      let rest = chunk;
      if (skipping) {
        const at = rest.indexOf(NEWLINE);
        if (at === -1) return null;
        rest = rest.subarray(at + 1);
        skipping = false;
      }
      if (rest.length === 0) return null;
      const last = rest.lastIndexOf(NEWLINE);
      if (last === -1) {
        appendTail(rest.slice());
        enforceLimit();
        return null;
      }
      const head = rest.subarray(0, last + 1);
      // 꼬리가 비었고 조각이 줄 끝으로 끝나면 같은 배열을 그대로 돌려준다(복사 없음)
      const out =
        tailLength === 0 && head.length === rest.length ? rest : concatBytes([...pieces, head]);
      pieces = [];
      tailLength = 0;
      appendTail(rest.slice(last + 1));
      enforceLimit();
      return out;
    },
    discardPartial() {
      if (tailLength === 0) return;
      pieces = [];
      tailLength = 0;
      skipping = true;
    },
    finish() {
      return { tailBytes: tailLength, overflowed };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// 신용

/** 신용 창이 닫혔다(수신자가 바뀌었거나 종료 중이다) */
interface CreditClosed {
  readonly kind: "credit-closed";
}

const CREDIT_CLOSED: CreditClosed = { kind: "credit-closed" };

/** 수신자 하나(attach 하나)의 송신 신용 */
export interface Credit {
  /** 미확인 바이트가 창 이하가 될 때까지 기다린 뒤 `bytes`를 보낸 양에 더한다. 한 묶음이 창보다 커도 미확인 바이트가 0이면 보낸다 */
  acquire(bytes: number): Promise<Result<void, CreditClosed>>;
  /** 수신자가 `bytes`만큼 처리했다. 보낸 양을 넘는 확인은 보낸 양으로 줄인다 */
  ack(bytes: number): void;
  /** 신용을 닫는다. 기다리는 송신은 모두 거부로 풀린다 */
  close(): void;
  /** 보냈지만 확인되지 않은 바이트 */
  outstanding(): number;
}

export function createCredit(windowBytes: number): Credit {
  let sent = 0;
  let acked = 0;
  let closed = false;
  const changed = createSignal();
  return {
    acquire(bytes) {
      return repeatAsync<Result<void, CreditClosed>>(async () => {
        if (closed) return { value: err(CREDIT_CLOSED) };
        if (sent - acked <= windowBytes) {
          sent += bytes;
          return { value: ok(undefined) };
        }
        await changed.wait();
        return undefined;
      });
    },
    ack(bytes) {
      acked = Math.min(acked + bytes, sent);
      changed.notify();
    },
    close() {
      closed = true;
      changed.notify();
    },
    outstanding() {
      return sent - acked;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// 릴레이

/** 수신 끝이 닫혔다(페이지가 사라졌다). `cause`는 채널이 던진 값이다 */
interface SinkClosed {
  readonly kind: "sink-closed";
  readonly cause: unknown;
}

/** WebView 쪽 수신 끝. 운영에서는 `createChannelSink`가 ShellChannel 둘로 만들고, 시험에서는 가짜다 */
export interface Sink {
  sendBytes(bytes: Uint8Array): Result<void, SinkClosed>;
  sendState(state: EngineState): Result<void, SinkClosed>;
}

/** `engine_attach`가 돌려주는 값 */
interface AttachResult {
  readonly epoch: number;
  readonly state: EngineState;
}

/** 엔진 세대 하나가 끝난 뒤의 집계. 로그에는 이 숫자만 남긴다(L4.desktop.spec E11) */
interface StreamStats {
  readonly forwardedBytes: number;
  readonly droppedBytes: number;
  readonly droppedTailBytes: number;
  readonly overflowedLines: number;
}

/** 엔진 세대 하나의 stdout 흐름. 읽기 작업 하나가 `push`를 순서대로 부른다 */
interface EngineStream {
  /** 엔진 stdout 조각 하나를 처리한다. 신용이 찰 때까지 기다리는 동안 호출자도 멈추므로 역압이 엔진까지 간다 */
  push(chunk: Uint8Array): Promise<void>;
  /** 세대가 끝났다. 줄 끝이 오지 않은 꼬리를 버린다 */
  finish(): StreamStats;
}

export interface Relay {
  /** 페이지 하나를 붙인다. 이전 페이지의 릴레이는 끊는다 */
  attach(sink: Sink): AttachResult;
  /** `epoch`가 현재 연결일 때만 끊는다. 끊었으면 true */
  detach(epoch: number): boolean;
  /** 창이 사라졌다. 현재 연결을 끊는다 */
  detachCurrent(): void;
  /** `epoch`가 현재 연결이면 null, 아니면 `epoch-stale`이다 */
  checkEpoch(epoch: number): CommandError | null;
  /** 수신자가 `bytes`만큼 처리했다. 세대가 다르면 무시하고 false */
  ack(epoch: number, bytes: number): boolean;
  state(): EngineState;
  /** 지금 붙어 있는 페이지의 세대. 0은 아직 attach가 없었다는 뜻이다 */
  currentEpoch(): number;
  /** 상태를 기록하고 붙어 있는 페이지에 알린다. 알리지 못하면 그 페이지를 끊는다 */
  setState(next: EngineState): void;
  /** 종료가 시작됐다. 이후 바이트는 버리고, 대기 중인 송신도 푼다 */
  beginDrain(): void;
  /** 엔진 세대마다 새로 연다. 줄 버퍼가 세대마다 따로다 */
  openStream(): EngineStream;
}

interface Attached {
  readonly epoch: number;
  readonly sink: Sink;
  readonly credit: Credit;
}

export function createRelay(initial: EngineState): Relay {
  let state: EngineState = initial;
  // attach마다 올라간다. 0이면 아직 attach가 없었다
  let lastEpoch = 0;
  let attached: Attached | null = null;
  let draining = false;

  function detachEpoch(epoch: number): boolean {
    if (attached === null || attached.epoch !== epoch) return false;
    attached.credit.close();
    attached = null;
    return true;
  }

  function openStream(): EngineStream {
    const buffer = createLineBuffer(MAX_PENDING_LINE_BYTES);
    let seenEpoch = lastEpoch;
    let forwardedBytes = 0;
    let droppedBytes = 0;
    return {
      async push(chunk) {
        // 페이지가 바뀌었으면 이전 페이지가 앞부분을 못 본 줄을 버린다
        if (lastEpoch !== seenEpoch) {
          buffer.discardPartial();
          seenEpoch = lastEpoch;
        }
        const batch = buffer.push(chunk);
        if (batch === null) return;
        const size = batch.length;
        const target = draining ? null : attached;
        if (target === null) {
          droppedBytes += size;
          return;
        }
        const granted = await target.credit.acquire(size);
        if (!granted.ok) {
          droppedBytes += size;
          return;
        }
        const delivered = target.sink.sendBytes(batch);
        if (delivered.ok) {
          forwardedBytes += size;
          return;
        }
        droppedBytes += size;
        detachEpoch(target.epoch);
      },
      finish() {
        const end = buffer.finish();
        return {
          forwardedBytes,
          droppedBytes,
          droppedTailBytes: end.tailBytes,
          overflowedLines: end.overflowed,
        };
      },
    };
  }

  return {
    attach(sink) {
      if (attached !== null) attached.credit.close();
      lastEpoch += 1;
      const credit = createCredit(CREDIT_WINDOW_BYTES);
      if (draining) credit.close();
      attached = { epoch: lastEpoch, sink, credit };
      return { epoch: lastEpoch, state };
    },
    detach: detachEpoch,
    detachCurrent() {
      if (attached !== null) detachEpoch(attached.epoch);
    },
    checkEpoch(epoch) {
      return lastEpoch !== 0 && lastEpoch === epoch && attached !== null ? null : "epoch-stale";
    },
    ack(epoch, bytes) {
      if (attached === null || attached.epoch !== epoch) return false;
      attached.credit.ack(bytes);
      return true;
    },
    state: () => state,
    currentEpoch: () => lastEpoch,
    setState(next) {
      state = next;
      if (attached === null) return;
      const delivered = attached.sink.sendState(next);
      if (!delivered.ok) detachEpoch(attached.epoch);
    },
    beginDrain() {
      draining = true;
      if (attached !== null) attached.credit.close();
    },
    openStream,
  };
}

/**
 * ShellChannel 둘을 수신 끝으로 감싼다. 바이트는 `Uint8Array`로, 상태 객체는 그대로 보낸다.
 * 채널이 던지면(페이지가 사라졌다) `sink-closed`로 돌려준다. 원래 값은 `cause`에 남는다.
 */
export function createChannelSink(bytesChannel: ShellChannel, stateChannel: ShellChannel): Sink {
  return {
    sendBytes: (bytes) => sendOn(bytesChannel, bytes),
    sendState: (state) => sendOn(stateChannel, state),
  };
}

function sendOn(channel: ShellChannel, message: unknown): Result<void, SinkClosed> {
  const sent = attempt(() => {
    channel.send(message);
  });
  if (sent.ok) return ok(undefined);
  return err({ kind: "sink-closed", cause: sent.error });
}

// ---------------------------------------------------------------------------------------------
// 엔진 stdin 쓰기

/** 엔진 stdin. 운영에서는 엔진 자식 프로세스의 stdin을 감싼 것이고, 시험에서는 가짜다 */
export interface StdinSink {
  /** 엔진이 읽을 때까지 기다린다. 쓰지 못하면 거부한다 */
  write(bytes: Uint8Array): Promise<void>;
  /** stdin을 닫는다(엔진은 EOF를 받는다) */
  close(): void;
}

/** 쓰기 대기열이 닫힌 이유. `pipe-closed`는 닫기 요청 뒤이고, `write-failed`는 stdin 쓰기가 실패한 뒤다 */
type PipeClosed =
  | { readonly kind: "pipe-closed" }
  | { readonly kind: "write-failed"; readonly cause: unknown };

/** stdin 쓰기 루프의 손잡이. 보내는 쪽은 대기열이 찼을 때만 기다리고, 쓰기 루프는 다른 일을 막지 않는다 */
export interface PipeHandle {
  writeFrame(bytes: Uint8Array): Promise<Result<void, PipeClosed>>;
  /** 셸이 직접 쓰는 프레임(`host.shutdown`). 앞선 쓰기가 줄 중간에서 끝났으면 `\n`을 먼저 써서 줄을 닫는다 */
  writeShellFrame(bytes: Uint8Array): Promise<Result<void, PipeClosed>>;
  /** 대기열의 쓰기가 끝난 뒤 stdin을 닫는다(EOF). 이후의 쓰기는 거부한다 */
  closeWrite(): Promise<Result<void, PipeClosed>>;
  /** 쓰기 루프가 끝나면 끝난다(닫기 뒤 또는 쓰기 실패 뒤) */
  readonly finished: Promise<void>;
}

type PipeCommand =
  | { readonly kind: "frame"; readonly bytes: Uint8Array; readonly boundary: boolean }
  | { readonly kind: "close" };

interface WaitingSend {
  readonly command: PipeCommand;
  readonly resolve: (outcome: Result<void, PipeClosed>) => void;
}

const NEWLINE_BYTES: Uint8Array = new Uint8Array([NEWLINE]);

/**
 * stdin 쓰기 루프를 띄운다. 대기열은 `capacity`개까지 쥔다(지금 쓰는 한 개는 세지 않는다).
 * 루프가 끝나면(닫기, 쓰기 실패) `sink.close()`로 엔진 stdin을 닫는다(EOF).
 */
export function createPipeWriter(
  sink: StdinSink,
  capacity: number = WRITE_QUEUE_FRAMES,
): PipeHandle {
  const queue: PipeCommand[] = [];
  // 대기열이 찼을 때 들어온 순서대로 기다린다. 빈자리가 나면 앞에서부터 넣는다(추월하지 않는다)
  const waitingSends: WaitingSend[] = [];
  const itemArrived = createSignal();
  let closedReason: PipeClosed | null = null;
  let atBoundary = true;

  /** 더 받지 않는다. 기다리던 보내기는 모두 이 이유로 거부한다 */
  function closeWith(reason: PipeClosed): void {
    closedReason = reason;
    for (const waiting of waitingSends.splice(0)) waiting.resolve(err(reason));
  }

  function push(command: PipeCommand): void {
    queue.push(command);
    if (command.kind === "close") closeWith({ kind: "pipe-closed" });
    itemArrived.notify();
  }

  function admitWaitingSends(): void {
    for (;;) {
      if (queue.length >= capacity) return;
      const waiting = waitingSends.shift();
      if (waiting === undefined) return;
      push(waiting.command);
      waiting.resolve(ok(undefined));
    }
  }

  function nextCommand(): Promise<PipeCommand> {
    return repeatAsync<PipeCommand>(async () => {
      const command = queue.shift();
      if (command !== undefined) {
        admitWaitingSends();
        return { value: command };
      }
      await itemArrived.wait();
      return undefined;
    });
  }

  /** stdin 쓰기가 실패했다. 대기열을 버리고 stdin을 닫는다 */
  function stopWriter(reason: PipeClosed): void {
    closeWith(reason);
    queue.splice(0);
    sink.close();
  }

  // 명령을 하나씩 차례로 쓴다. 앞 쓰기가 끝나야 다음을 쓴다(repeatAsync가 순차 await를 맡는다)
  async function run(): Promise<void> {
    await repeatAsync<void>(async () => {
      const command = await nextCommand();
      if (command.kind === "close") {
        sink.close();
        return { value: undefined };
      }
      if (command.boundary && !atBoundary) {
        const newline = await attemptAsync(() => sink.write(NEWLINE_BYTES));
        if (!newline.ok) {
          stopWriter({ kind: "write-failed", cause: newline.error });
          return { value: undefined };
        }
        atBoundary = true;
      }
      if (command.bytes.length === 0) return undefined;
      const written = await attemptAsync(() => sink.write(command.bytes));
      if (!written.ok) {
        stopWriter({ kind: "write-failed", cause: written.error });
        return { value: undefined };
      }
      atBoundary = command.bytes.at(-1) === NEWLINE;
      return undefined;
    });
  }

  function enqueue(command: PipeCommand): Promise<Result<void, PipeClosed>> {
    if (closedReason !== null) return Promise.resolve(err(closedReason));
    if (waitingSends.length === 0 && queue.length < capacity) {
      push(command);
      return Promise.resolve(ok(undefined));
    }
    return new Promise<Result<void, PipeClosed>>((resolve) => {
      waitingSends.push({ command, resolve });
    });
  }

  const finished = run();
  detach(finished, rethrow);
  return {
    writeFrame: (bytes) => enqueue({ kind: "frame", bytes, boundary: false }),
    writeShellFrame: (bytes) => enqueue({ kind: "frame", bytes, boundary: true }),
    closeWrite: () => enqueue({ kind: "close" }),
    finished,
  };
}

// ---------------------------------------------------------------------------------------------
// 백업 폴더 모양

/**
 * `db_restore`가 받는 백업 폴더 경로의 모양만 본다. 공백만 있는 값(빈 값 포함), NUL이 든 값,
 * UTF-8 4096바이트를 넘는 값은 `bad-request`다. 통과하면 null이다. 던지는 쪽은 `fail`로 던진다.
 */
export function validateBackupDir(path: string): CommandError | null {
  if (path.trim() === "" || path.includes("\u0000")) return "bad-request";
  if (new TextEncoder().encode(path).byteLength > BACKUP_DIR_MAX_BYTES) return "bad-request";
  return null;
}
