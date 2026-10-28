import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repeatAsync, type Clock, type Scheduler } from "@xeon/contracts";
import { WireError, type HostConnection } from "@xeon/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { connectServiceTransport, type ServiceEndpoint } from "../../src/index.ts";
import { createManualScheduler } from "./manual-scheduler.ts";
import { HELLO_PARAMS } from "./wire-client.ts";

// 서비스 모드 int 시험의 도우미: 짧은 runtimeDir, 유휴 타이머용 수동 시간, 서비스 소켓에 붙는 연결.

export interface ManualTime {
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  advance(ms: number): void;
}

export function manualTime(): ManualTime {
  const scheduler = createManualScheduler();
  const state = { now: 1_800_000_000_000 };
  return {
    clock: { now: () => state.now },
    scheduler,
    advance(ms) {
      state.now += ms;
      scheduler.advance(ms);
    },
  };
}

/** 소켓 경로 한도(103바이트)를 넘지 않는 짧은 임시 runtimeDir(0700) */
export function scratchRuntimeDir(): { readonly dir: string; dispose(): void } {
  const dir = mkdtempSync(join(tmpdir(), "xsvc-"));
  return {
    dir,
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** 서비스에 접속하고 hello까지 끝낸 연결 */
export async function connectedClient(
  endpoint: ServiceEndpoint,
  token?: string,
): Promise<HostConnection> {
  const transport = await connectServiceTransport(endpoint);
  if (!transport.ok) throw new Error(`cannot connect to the service: ${transport.error.kind}`);
  const connection = createHostConnection(transport.value);
  await connection.request("host.hello", {
    ...HELLO_PARAMS,
    ...(token === undefined ? {} : { auth: { token } }),
  });
  return connection;
}

export async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  try {
    await call;
  } catch (caught) {
    if (caught instanceof WireError) return caught;
    throw caught;
  }
  throw new Error("expected the call to fail with a WireError");
}

/** 소켓 위 사건(연결 종료 감지)은 실제 I/O라 조건이 참이 될 때까지 짧게 폴링한다. 상한을 넘으면 던진다 */
export async function eventually(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  await repeatAsync<void>(async () => {
    if (condition()) return { value: undefined };
    if (Date.now() > deadline) throw new Error("the condition did not hold in time");
    await Bun.sleep(10);
    return undefined;
  });
}
