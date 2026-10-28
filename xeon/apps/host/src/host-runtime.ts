import { attemptAsync, Bug } from "@xeon/contracts";
import { resolveSetting } from "@xeon/contracts/settings";
import { assemble, ENGINE_VERSION } from "./assemble.ts";
import { shutdownTimeoutOf, type SettingReader } from "./assembly/settings-sources.ts";
import { createConnectionHub } from "./connection.ts";
import type { ConnectionHub } from "./connection-types.ts";
import { createWireHandlers, type HostLifecycle } from "./handlers/index.ts";
import type { AssembleOptions, Engine } from "./types.ts";
import { messageOf } from "./util.ts";

// 호스트 시작과 종료 절차의 공통 부분(L4.host-service.spec §4.8, HS-31). stdio 호스트(main.ts)와 서비스(service/lifetime.ts)가 함께 쓴다.

export interface HostExit {
  readonly code: 0 | 1;
  readonly reason: "eof" | "signal" | "idle" | "stop" | "startup";
  /** 시작 거부(code 1)일 때 이유 한 줄. spec에 더한 선택 필드 */
  readonly message?: string;
}

export interface RunningHost {
  readonly engine: Engine;
  readonly hub: ConnectionHub;
}

export function settingReaderOf(engine: Engine): SettingReader {
  return (key) => {
    const def = engine.catalog.get(key);
    if (def === undefined) return undefined;
    return resolveSetting(def, engine.ports.settings.layers(undefined)).setting.value;
  };
}

export async function startHost(
  options: AssembleOptions,
  lifecycle?: HostLifecycle,
): Promise<RunningHost> {
  const engine = await assemble(options);
  const slot: { hub: ConnectionHub | undefined } = { hub: undefined };
  const handlers = createWireHandlers(
    engine,
    () => {
      if (slot.hub === undefined) throw new Bug("connection hub is used before it is created");
      return slot.hub;
    },
    { serverName: "xeon", serverVersion: ENGINE_VERSION, pid: process.pid },
    lifecycle,
  );
  const hub = createConnectionHub(engine, handlers);
  slot.hub = hub;
  return { engine, hub };
}

/** HS-31 1·2단계: 새 요청을 거절하고, 진행 중 turn을 안전 경계에서 멈추고 체크포인트를 커밋한다. 시한 안에 못 멈췄으면 "deadline" */
export async function stopTurns(running: RunningHost): Promise<"clean" | "deadline"> {
  const { engine, hub } = running;
  hub.beginShutdown();
  const deadlineMs = shutdownTimeoutOf(settingReaderOf(engine));
  const stopped = await attemptAsync(() => engine.ports.turns.stopAtSafeBoundary(deadlineMs));
  if (!stopped.ok) {
    // 멈추는 호출이 실패하면 turn이 멈췄는지 알 수 없다. 시한을 넘긴 것과 같이 다룬다
    engine.ports.log.error("host.stop_failed", { message: messageOf(stopped.error.cause) });
    return "deadline";
  }
  if (!stopped.value) {
    engine.ports.log.error("host.stop_timeout", { deadlineMs });
    return "deadline";
  }
  return "clean";
}

/** HS-31 3·4단계: 연결을 닫고 엔진을 닫는다 */
export async function closeHost(running: RunningHost): Promise<void> {
  await running.hub.closeAll("shutdown");
  running.hub.dispose();
  await running.engine.close();
}

/** in-process 종료(HS-35): 협조 창구 없이 1~4단계를 차례로 한다 */
export async function stopHost(running: RunningHost): Promise<"clean" | "deadline"> {
  const outcome = await stopTurns(running);
  await closeHost(running);
  return outcome;
}
