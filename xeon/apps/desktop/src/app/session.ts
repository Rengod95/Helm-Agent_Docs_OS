import { detach, repeatAsync, type Logger } from "@xeon/contracts";
import type { HostConnection } from "@xeon/contracts/wire";
import {
  createThreadReaderPort,
  startLink,
  type EngineLink,
  type EngineStore,
} from "../state/engine/index.ts";
import type { UiStore } from "../state/ui/index.ts";
import type { DesktopIpc, EngineState } from "../transport/ipc.ts";
import {
  attachRelay,
  openEngineConnection,
  type EngineConnectionDeps,
  type RelayPort,
} from "../transport/tauri-stdio.ts";

// 엔진 연결 수명. 셸 상태가 running일 때 연결을 열고, 아닐 때 닫는다.
// 엔진이 다시 뜨면 새 attach로 새 세대의 스트림을 받아 hello부터 다시 한다(L4.desktop.design 10절 규칙 4).
// 거울은 그대로이므로 새 컨트롤러가 거울의 cursor부터 재구독한다.

export type SessionDeps = {
  readonly ipc: DesktopIpc;
  readonly engine: EngineStore;
  readonly ui: UiStore;
  readonly logger: Logger;
  readonly transport: EngineConnectionDeps;
};

export interface Session {
  /** 지금 열려 있는 연결. 엔진이 running이 아니면 null */
  connection(): HostConnection | null;
  link(): EngineLink | null;
  /** 마지막으로 hello가 끝난 엔진의 버전 */
  engineVersion(): string | null;
  /** 연결 시도가 실패해 멈췄을 때 사용자가 다시 시작한다 */
  reconnect(): void;
  restartEngine(): Promise<boolean>;
  stop(): Promise<void>;
}

type Wait = { readonly promise: Promise<void>; readonly open: () => void };

function wait(): Wait {
  const w = Promise.withResolvers<void>();
  return { promise: w.promise, open: () => w.resolve() };
}

export function startSession(deps: SessionDeps): Session {
  const current: {
    connection: HostConnection | null;
    link: EngineLink | null;
    relay: RelayPort | null;
    engineVersion: string | null;
    stopped: boolean;
    retry: Wait;
  } = {
    connection: null,
    link: null,
    relay: null,
    engineVersion: null,
    stopped: false,
    retry: wait(),
  };

  const isStopped = (): boolean => current.stopped;

  const report = (cause: unknown): void => {
    deps.logger.error("desktop.session.failed", {
      error: cause instanceof Error ? cause.name : "unknown",
    });
  };

  /** 한 번의 연결 수명. 연결을 열고 엔진이 running을 벗어나거나 연결이 닫힐 때까지 기다린다. 실패로 끝나면 "idle" */
  const runOnce = async (): Promise<"again" | "idle"> => {
    const gate = { current: wait() };
    const onState = (state: EngineState): void => {
      deps.engine.ingest({ type: "engine", state });
      const opened = gate.current;
      gate.current = wait();
      opened.open();
    };
    const attached = await attachRelay(deps.ipc, onState);
    if (!attached.ok) {
      const code = attached.error.kind === "command" ? attached.error.code : "invalid";
      deps.ui.actions.setConnectError(`attach:${code}`);
      return "idle";
    }
    const relay = attached.value;
    current.relay = relay;
    deps.engine.ingest({ type: "engine", state: relay.state() });
    // 확인과 기다림 사이에 await가 없으므로 상태 변화를 놓치지 않는다
    await repeatAsync<undefined>(async () => {
      if (isStopped() || relay.state().kind === "running") return { value: undefined };
      await gate.current.promise;
      return undefined;
    });
    if (isStopped()) return "idle";
    const opened = await openEngineConnection(deps.transport, relay);
    if (!opened.ok) {
      const error = opened.error;
      deps.ui.actions.setConnectError(
        error.kind === "hello" ? `hello:${error.code ?? "unknown"}` : "engine_not_running",
      );
      return "idle";
    }
    deps.ui.actions.setConnectError(null);
    const { connection, hello } = opened.value;
    current.engineVersion = hello.server.version;
    const link = startLink({
      connection,
      store: deps.engine,
      transcripts: createThreadReaderPort({
        connection,
        storeId: () => deps.engine.read.getState().cursor?.storeId ?? null,
      }),
      logger: deps.logger,
      openThreadId: () => deps.ui.read.getState().selectedThreadId,
    });
    current.connection = connection;
    current.link = link;
    const left = wait();
    const unlisten = relay.onState((state) => {
      if (state.kind !== "running") left.open();
    });
    // hello 중에 셸 상태가 바뀌었을 수 있다
    if (relay.state().kind !== "running") left.open();
    detach(
      connection.closed.then(() => {
        left.open();
        return null;
      }),
      report,
    );
    await left.promise;
    unlisten();
    link.stop();
    current.link = null;
    current.connection = null;
    await connection.close();
    return "again";
  };

  const loop = async (): Promise<void> => {
    await repeatAsync<undefined>(async () => {
      if (isStopped()) return { value: undefined };
      current.retry = wait();
      const outcome = await runOnce();
      // 실패로 끝났으면 사용자가 다시 연결을 고를 때까지 쉰다. 엔진이 내려갔다 올라온 경우는 바로 다시 연다
      if (outcome === "idle" && !isStopped()) await current.retry.promise;
      return undefined;
    });
  };
  detach(loop(), report);

  return {
    connection: () => current.connection,
    link: () => current.link,
    engineVersion: () => current.engineVersion,
    reconnect: () => current.retry.open(),
    async restartEngine() {
      const restarted = await deps.ipc.restart();
      return restarted.ok;
    },
    async stop() {
      current.stopped = true;
      current.retry.open();
      current.link?.stop();
      await current.connection?.close();
      await current.relay?.close();
    },
  };
}
