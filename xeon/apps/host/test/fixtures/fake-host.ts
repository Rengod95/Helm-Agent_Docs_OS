import { createHostConnection } from "../../src/client.ts";
import {
  createConnectionHub,
  type HostLimits,
  type ServedConnection,
} from "../../src/connection.ts";
import type { ConnectionHub } from "../../src/connection-types.ts";
import { createWireHandlers } from "../../src/handlers/index.ts";
import { createInProcessTransportFactory } from "../../src/transport/in-process.ts";
import { stdioPair } from "./stdio-pair.ts";
import { createFakeEngine, type FakeEngine, type FakeEngineOptions } from "./fake-engine.ts";
import type { WireHandlers, HostConnection, Transport } from "@xeon/contracts/wire";

// 가짜 엔진 위에 실제 처리기 표·연결 허브·in-process 전송을 세운다. 시험이 처리기를 바꿔 끼울 수 있다.

function testLimits(overrides: Partial<HostLimits> = {}): HostLimits {
  return {
    maxReplayEvents: 100_000,
    maxSubscriptionsPerConnection: 16,
    replayBatchMaxEvents: 500,
    scanLimit: 10_000,
    sendLowWaterBytes: 1_048_576,
    ...overrides,
  };
}

export interface FakeHostOptions extends FakeEngineOptions {
  readonly limits?: Partial<HostLimits>;
  /** 처리기 표를 바꾼다 */
  readonly override?: (table: WireHandlers) => WireHandlers;
}

export interface FakeHost {
  readonly fake: FakeEngine;
  readonly hub: ConnectionHub;
  /** 새 연결을 열고 서버 쪽 연결과 클라이언트 전송을 돌려준다 */
  connect(wrap?: (server: Transport) => Transport): {
    readonly served: ServedConnection;
    readonly client: Transport;
    readonly connection: HostConnection;
  };
  /** 같은 프로세스 안의 스트림 쌍 위 stdio 전송으로 새 연결을 연다 */
  connectStdio(): { readonly served: ServedConnection; readonly client: Transport };
}

export function createFakeHost(options: FakeHostOptions = {}): FakeHost {
  const fake = createFakeEngine(options);
  const slot: { hub: ConnectionHub | undefined } = { hub: undefined };
  const base = createWireHandlers(
    fake.engine,
    () => {
      if (slot.hub === undefined) throw new Error("hub is not ready");
      return slot.hub;
    },
    { serverName: "xeon", serverVersion: "0.0.0-test", pid: 1 },
  );
  const handlers = options.override === undefined ? base : options.override(base);
  const hub = createConnectionHub(fake.engine, handlers);
  slot.hub = hub;
  return {
    fake,
    hub,
    connect(wrap) {
      const pair = createInProcessTransportFactory({ devChecks: true })();
      const server = wrap === undefined ? pair.server : wrap(pair.server);
      const served = hub.serve(server, { limits: testLimits(options.limits), devChecks: true });
      return { served, client: pair.client, connection: createHostConnection(pair.client) };
    },
    connectStdio() {
      const pair = stdioPair();
      const served = hub.serve(pair.server, {
        limits: testLimits(options.limits),
        devChecks: true,
      });
      return { served, client: pair.client };
    },
  };
}
