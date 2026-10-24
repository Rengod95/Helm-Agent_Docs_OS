import { attemptAsync, err, ok, type Result } from "@xeon/contracts";
import {
  WIRE_PROTOCOL_VERSION,
  WireError,
  type HostConnection,
  type StdioTransportFactory,
  type Transport,
  type WireResult,
} from "@xeon/contracts/wire";
import type { DesktopIpc, EngineState, IpcError } from "./ipc.ts";

// L4.desktop.spec 3.4. 릴레이 바이트를 스트림 쌍으로 감싸 F `StdioTransportFactory`에 넘긴다.

/** WebView가 처리한 바이트가 이만큼 쌓일 때마다 engine_ack로 신용을 돌려준다(spec 3.3) */
export const ACK_UNIT_BYTES: number = 256 * 1024;

/** 릴레이 한 세대. readable은 엔진 stdout 바이트(완성된 줄), writable은 엔진 stdin 바이트(프레임 하나가 write 한 번)다 */
export interface RelayPort {
  readonly epoch: number;
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  /** 지금까지 받은 가장 최근 셸 상태 */
  state(): EngineState;
  onState(listener: (state: EngineState) => void): () => void;
  /** 이 세대를 끊는다. 엔진은 끄지 않는다 */
  close(): Promise<void>;
}

class RelayWriteError extends Error {
  override readonly name: string = "RelayWriteError";
}

/** engine_attach를 부르고 Channel 바이트를 ReadableStream으로, engine_write를 WritableStream으로 감싼다 */
export async function attachRelay(
  ipc: DesktopIpc,
  onState: (state: EngineState) => void = ignoreState,
): Promise<Result<RelayPort, IpcError>> {
  const listeners = new Set<(state: EngineState) => void>([onState]);
  const latest: { state: EngineState | null } = { state: null };
  const queue: Uint8Array[] = [];
  const flow: {
    epoch: number;
    unacked: number;
    cancelled: boolean;
    wake: (() => void) | null;
  } = { epoch: 0, unacked: 0, cancelled: false, wake: null };

  const settleAck = (): void => {
    if (flow.epoch === 0 || flow.unacked < ACK_UNIT_BYTES) return;
    const bytes = flow.unacked;
    flow.unacked = 0;
    // 신용 반환이 실패해도(세대 교체) 다음 attach가 새 신용 창을 연다. 읽기를 멈추지 않는다
    void ipc.ack(flow.epoch, bytes);
  };

  /** 다음 바이트 조각. 취소되면 null. 조각이 없으면 도착이나 취소를 기다린다 */
  const nextChunk = async (): Promise<Uint8Array | null> => {
    const chunk = queue.shift();
    if (chunk !== undefined) return chunk;
    if (flow.cancelled) return null;
    await new Promise<void>((resolve) => {
      flow.wake = resolve;
    });
    return nextChunk();
  };

  const readable = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        const chunk = await nextChunk();
        if (chunk === null) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
        flow.unacked += chunk.byteLength;
        settleAck();
      },
      cancel() {
        flow.cancelled = true;
        flow.wake?.();
      },
    },
    { highWaterMark: 0 },
  );

  const attached = await ipc.attach(
    (chunk) => {
      queue.push(chunk);
      flow.wake?.();
    },
    (state) => {
      latest.state = state;
      for (const listener of Array.from(listeners)) listener(state);
    },
  );
  if (!attached.ok) return attached;
  const { epoch } = attached.value;
  // attach 응답이 Channel 상태 메시지보다 먼저 올 수 있다. 더 늦은 상태가 이미 왔으면 그것이 최신이다
  latest.state ??= attached.value.state;
  flow.epoch = epoch;
  settleAck();

  const writable = new WritableStream<Uint8Array>({
    async write(chunk) {
      const written = await ipc.write(epoch, chunk);
      if (!written.ok) {
        const code = written.error.kind === "command" ? written.error.code : "invalid";
        throw new RelayWriteError(`engine_write failed: ${code}`);
      }
    },
  });

  return ok({
    epoch,
    readable,
    writable,
    state: () => latest.state ?? attached.value.state,
    onState(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async close() {
      flow.cancelled = true;
      flow.wake?.();
      await ipc.detach(epoch);
    },
  });
}

function ignoreState(): void {
  // 상태를 받을 곳을 따로 넘기지 않은 호출. 상태는 relay.onState로도 받을 수 있다
}

export type OpenError =
  | { readonly kind: "engine_not_running"; readonly state: EngineState }
  | { readonly kind: "hello"; readonly code: number | null; readonly message: string };

export interface EngineConnectionDeps {
  readonly stdioTransport: StdioTransportFactory;
  readonly connect: (transport: Transport) => HostConnection;
  readonly client: { readonly name: string; readonly version: string };
}

export interface EngineConnection {
  readonly connection: HostConnection;
  readonly hello: WireResult<"host.hello">;
  readonly relay: RelayPort;
}

/**
 * running인 릴레이 위에 전송과 연결을 만들고 host.hello(client.kind "desktop")를 보낸다.
 * 릴레이의 스트림은 한 번만 쓸 수 있으므로, 엔진이 다시 뜨면 호출자가 새로 attach한 릴레이를 넘긴다(src/app/session.ts).
 * [미결] 새 페이지의 `$/connectionReset`은 F에 아직 없다(spec 4.5). 지금은 hello 중복(1002)이 hello 오류로 나온다.
 */
export async function openEngineConnection(
  deps: EngineConnectionDeps,
  relay: RelayPort,
): Promise<Result<EngineConnection, OpenError>> {
  if (relay.state().kind !== "running") {
    return err({ kind: "engine_not_running", state: relay.state() });
  }
  const transport = deps.stdioTransport({ readable: relay.readable, writable: relay.writable });
  const connection = deps.connect(transport);
  const hello = await attemptAsync(() =>
    connection.request("host.hello", {
      protocolVersion: WIRE_PROTOCOL_VERSION,
      client: { name: deps.client.name, version: deps.client.version, kind: "desktop" },
    }),
  );
  if (hello.ok) return ok({ connection, hello: hello.value, relay });
  await connection.close();
  const cause = hello.error.cause;
  return err({
    kind: "hello",
    code: cause instanceof WireError ? cause.code : null,
    message: cause instanceof Error ? cause.name : "unknown",
  });
}
