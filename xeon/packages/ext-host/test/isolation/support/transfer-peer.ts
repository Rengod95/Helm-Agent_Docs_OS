// 조각 전송 시험의 자식 대역(AGE-59). 감독(`createPluginHostSupervisor`)이 띄우는 프로세스 자리에 들어가, 실제 프레이밍
// (`createFrameReader`, `createFrameWriter`)으로 엔진과 말한다. 그래서 엔진이 보낸 조각은 모여서 원래 프레임으로 들어오고,
// 시험이 쓰는 답은 필요하면 조각으로 나간다. 깨진 전송은 `raw`로 줄 그대로 보낸다.
// 자식 칸(`childMax`)을 주면 협상에 답하고, 주지 않으면 옛 자식처럼 칸 없이 답한다. 읽기를 멈추면(`holdReads`) 엔진의 쓰기가 막힌다.
import { PassThrough } from "node:stream";
import { detach, ok, parse, repeatAsync, type Result } from "@fresnel/contracts";
import type { JsonValue } from "@fresnel/contracts/conversation";
import {
  PLUGIN_HOST_PROTOCOL_VERSION,
  PluginHostTransferOptionSchema,
  type ClassifiedFrame,
  type IsolatedChild,
  type IsolationProcessPort,
  type IsolationSpawnError,
  type IsolationSpawnSpec,
  type PluginHostErrorKind,
  type PluginHostFrame,
} from "@fresnel/contracts/extensions";
import {
  createFrameReader,
  createFrameWriter,
  type FrameReadError,
  type FrameReadResult,
  type FrameSink,
  type FrameWriteError,
} from "../../../src/isolation/framing.ts";
import { declOf } from "./scripted-child.ts";

export interface PeerOptions {
  /** `host.init`에 답할 등록 선언 목록. `declOf`로 만든다 */
  readonly decls?: readonly JsonValue[];
  /** 자식이 알리는 조각 상한. 없으면 칸을 답하지 않는 옛 자식이다 */
  readonly childMax?: number;
}

/** 시험이 보는 자식 대역 하나 */
export interface TransferPeer {
  readonly child: IsolatedChild;
  alive(): boolean;
  /** 엔진이 보낸 요청(조각을 모은 뒤) 가운데 `method`인 다음 것을 기다린다 */
  next(method: string): Promise<{ readonly id: number; readonly params: unknown }>;
  /** 조건에 맞는 받은 프레임을 기다린다. 이미 받은 것도 본다 */
  frameWhere(match: (frame: ClassifiedFrame) => boolean): Promise<ClassifiedFrame>;
  /** 받은 프레임 전부(조각을 모은 뒤) */
  frames(): readonly ClassifiedFrame[];
  /** 읽기 오류 값 전부(`transfer_failed` 포함). 프레임이 아닌 것은 여기에만 남는다 */
  readErrors(): readonly FrameReadError[];
  /** 엔진이 보낸 원래 바이트 글(조각 줄 포함) */
  received(): string;
  /** 자식이 보낸 쓰기 실패(프레임 쓰기가 값으로 돌려준 실패) */
  writeErrors(): readonly FrameWriteError[];
  reply(id: number, result: JsonValue): void;
  fail(id: number, kind: PluginHostErrorKind, message: string): void;
  /** 답 프레임을 보낸다(엔진 방향 상한을 넘으면 조각으로 나간다) */
  send(frame: PluginHostFrame): void;
  /** 줄 한 개를 그대로 쓴다(줄 끝은 붙인다). 깨진 전송을 만들 때 쓴다 */
  raw(text: string): void;
  /** 읽기를 멈춘다. 엔진의 쓰기는 자식이 읽을 때까지 막힌다 */
  holdReads(): void;
  releaseReads(): void;
  /** 예기치 않게 끝난다 */
  crash(): void;
  signals(): readonly string[];
}

/** 스폰 때마다 새 대역을 만드는 포트. `peers`로 시험이 대역을 찾는다 */
export interface TransferPeerPort extends IsolationProcessPort {
  readonly peers: TransferPeer[];
  readonly specs: IsolationSpawnSpec[];
}

/** 엔진이 보낸 `host.init` 칸에서 엔진 상한을 읽는다. 없으면 undefined다 */
function engineMaxOf(params: unknown): number | undefined {
  if (typeof params !== "object" || params === null || !("transfer" in params)) return undefined;
  const parsed = parse(PluginHostTransferOptionSchema, params.transfer);
  return parsed.ok ? parsed.value.maxBytes : undefined;
}

function startPeer(options: PeerOptions): TransferPeer {
  const decls = options.decls ?? [declOf("peer", [])];
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const decoder = new TextDecoder();
  const received: string[] = [];
  const inbox: ClassifiedFrame[] = [];
  /** `next`가 이미 넘긴 프레임. 같은 요청을 두 번 받지 않게 한다 */
  const handed = new Set<ClassifiedFrame>();
  const readErrors: FrameReadError[] = [];
  const writeErrors: FrameWriteError[] = [];
  const signals: string[] = [];
  let wake: (() => void) | undefined;
  let holding: Promise<void> | undefined;
  let release: (() => void) | undefined;
  let alive = true;
  const exitHolder: { settle?: (info: { code: number | null; signal: string | null }) => void } =
    {};
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    exitHolder.settle = resolve;
  });

  function notify(): void {
    const resume = wake;
    wake = undefined;
    resume?.();
  }

  function finish(info: { code: number | null; signal: string | null }): void {
    if (!alive) return;
    alive = false;
    stdout.end();
    stdin.destroy();
    exitHolder.settle?.(info);
    notify();
  }

  // 표준출력 싱크. 역압은 `drain`을 기다려 받는다(엔진 쪽 `stdinSinkOf`와 같은 규칙)
  let needDrain = false;
  stdout.on("drain", () => {
    needDrain = false;
    notify();
  });
  const sink: FrameSink = {
    write(line) {
      if (!alive) throw new Error("the peer is gone");
      if (!stdout.write(line)) needDrain = true;
    },
    drained() {
      if (!alive || !needDrain) return Promise.resolve();
      return new Promise<void>((resolve) => {
        wake = resolve;
      });
    },
  };
  const writer = createFrameWriter(sink, {
    onTransferFailed: (_frame, error) => {
      writeErrors.push(error);
    },
    stallMs: 60_000,
  });

  /** `host.init`에 답한다. 엔진이 칸을 주고 자식이 상한을 알릴 때만 칸으로 답하고 쓰기 상한을 맞춘다 */
  function answerInit(id: number, params: unknown): void {
    const engineMax = engineMaxOf(params);
    const childMax = options.childMax;
    const transfer =
      childMax === undefined || engineMax === undefined ? undefined : { maxBytes: childMax };
    if (transfer !== undefined) writer.setTransfer(Math.min(engineMax ?? 0, childMax ?? 0));
    writer.write({
      id,
      result: {
        protocolVersion: PLUGIN_HOST_PROTOCOL_VERSION,
        registrations: [...decls],
        ...(transfer === undefined ? {} : { transfer }),
      },
    });
  }

  function arrived(item: FrameReadResult): void {
    if (!item.ok) {
      readErrors.push(item.error);
      notify();
      return;
    }
    const frame = item.value;
    if (frame.kind === "request" && frame.method === "host.init") {
      answerInit(frame.id, frame.params);
      return;
    }
    inbox.push(frame);
    notify();
  }

  // 입력 덩어리마다 읽는다. 읽기를 멈추면(`holdReads`) 덩어리를 넘기지 않아 엔진의 쓰기가 막힌다(조각 중간에서도 막힌다)
  async function* gatedInput(source: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
    for await (const chunk of source) {
      received.push(decoder.decode(chunk, { stream: true }));
      await heldGate();
      yield chunk;
    }
  }
  const reader = createFrameReader(
    gatedInput(stdin),
    options.childMax === undefined ? {} : { maxTransferBytes: options.childMax },
  );
  // 읽기 루프. 프레임 하나씩 가져와 들인다. 끝나면 `finish`로 종료를 알린다
  detach(
    repeatAsync<void>(async () => {
      await heldGate();
      const item = await reader.next();
      if (item === null) {
        finish({ code: 0, signal: null });
        return { value: undefined };
      }
      arrived(item);
      return undefined;
    }),
    () => {
      finish({ code: 1, signal: null });
    },
  );

  /** 읽기가 멈춰 있으면 풀릴 때까지 기다린다. 멈춘 동안은 아무것도 넘기지 않는다 */
  function heldGate(): Promise<void> {
    return repeatAsync<void>(async () => {
      const pause = holding;
      if (pause === undefined) return { value: undefined };
      await pause;
      return undefined;
    });
  }

  function frameMatch(match: (frame: ClassifiedFrame) => boolean): ClassifiedFrame | undefined {
    return inbox.find((frame) => match(frame));
  }

  function waitWhere<T>(find: () => T | undefined): Promise<T> {
    return new Promise<T>((resolve) => {
      const attempt = (): void => {
        const found = find();
        if (found !== undefined) {
          resolve(found);
          return;
        }
        wake = attempt;
      };
      attempt();
    });
  }

  const child: IsolatedChild = {
    pid: 7000,
    stdin,
    stdout,
    stderr,
    exited,
    kill(signal) {
      signals.push(signal);
      finish({ code: null, signal });
    },
  };

  return {
    child,
    alive: () => alive,
    next: (method) =>
      waitWhere(() => {
        const found = inbox.find(
          (frame) => !handed.has(frame) && frame.kind === "request" && frame.method === method,
        );
        if (found?.kind !== "request") return undefined;
        handed.add(found);
        return { id: found.id, params: found.params };
      }),
    frameWhere: (match) => waitWhere(() => frameMatch(match)),
    frames: () => [...inbox],
    readErrors: () => [...readErrors],
    received: () => received.join(""),
    writeErrors: () => [...writeErrors],
    reply(id, result) {
      writer.write({ id, result });
    },
    fail(id, kind, message) {
      writer.write({ id, error: { kind, message } });
    },
    send(frame) {
      const written = writer.write(frame);
      if (!written.ok) writeErrors.push(written.error);
    },
    raw(text) {
      if (alive) stdout.write(`${text}\n`);
    },
    holdReads() {
      if (holding !== undefined) return;
      holding = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    releaseReads() {
      const resume = release;
      holding = undefined;
      release = undefined;
      resume?.();
    },
    crash: () => {
      finish({ code: 1, signal: null });
    },
    signals: () => [...signals],
  };
}

/** 스폰 때마다 새 대역을 만든다. 시험은 `port.peers`로 대역을 찾는다 */
export function createTransferPeerPort(options: PeerOptions = {}): TransferPeerPort {
  const peers: TransferPeer[] = [];
  const specs: IsolationSpawnSpec[] = [];
  return {
    peers,
    specs,
    async spawn(spec: IsolationSpawnSpec): Promise<Result<IsolatedChild, IsolationSpawnError>> {
      specs.push(spec);
      const peer = startPeer(options);
      peers.push(peer);
      return ok(peer.child);
    },
  };
}
