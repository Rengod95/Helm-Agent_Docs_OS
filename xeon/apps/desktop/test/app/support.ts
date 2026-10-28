import { repeatAsync } from "@xeon/contracts";
import type { ThreadSummary } from "@xeon/contracts/wire";
import type { DesktopIpc, EngineState, SecretRegisterError } from "../../src/transport/ipc.ts";
import { createApp, type App } from "../../src/app/bootstrap.ts";
import { fakeIpc, requestId, type FakeIpc } from "../transport/fake-ipc.ts";
import { STORE, summary, thr, userItem } from "../state/helpers.ts";

/** 시험별로 바꾸는 엔진 응답. results는 메서드 결과를 덮고, errors는 JSON-RPC 오류 프레임을 돌려준다 */
export type EngineExtra = {
  /** `registerSecret`이 돌려줄 오류(가짜 ipc 직접 호출용). 없으면 성공 */
  readonly registerError?: SecretRegisterError;
  readonly results?: Readonly<Record<string, unknown>>;
  readonly errors?: Readonly<Record<string, { code: number; kind: string; details?: unknown }>>;
};

export const tick = (ms = 5): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function until(condition: () => boolean, label: string): Promise<void> {
  let left = 200;
  await repeatAsync<undefined>(async () => {
    if (condition()) return { value: undefined };
    left -= 1;
    if (left <= 0) throw new Error(`timed out waiting for ${label}`);
    await tick();
    return undefined;
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function paramsOf(message: unknown): unknown {
  return isRecord(message) ? message["params"] : undefined;
}

function methodOf(message: unknown): string {
  const method: unknown = isRecord(message) ? message["method"] : undefined;
  return typeof method === "string" ? method : "";
}

/** 엔진 역할: 요청에 결과를 돌려준다. 시험이 호출 목록을 본다 */
export function engineFake(
  threads: readonly ThreadSummary[] = [summary(thr(1))],
  stateForAttach?: (n: number) => EngineState,
  extra: EngineExtra = {},
): { fake: FakeIpc; methods: string[]; params: { method: string; params: unknown }[] } {
  const methods: string[] = [];
  const params: { method: string; params: unknown }[] = [];
  const results: Readonly<Record<string, unknown>> = {
    "host.hello": {
      protocolVersion: "0.1.0",
      server: { name: "xeon", version: "1.2.3" },
      storeId: STORE,
      transport: "stdio",
      features: [],
      experimental: [],
    },
    "events.subscribe": { sub: "s1", start: 5, headSeq: 5, storeId: STORE, mode: "live" },
    "thread.list": { threads, nextCursor: null },
    "thread.read": {
      threadId: thr(1),
      items: [userItem(1, "hello")],
      position: { storeId: STORE, seq: 5 },
      hasMore: false,
    },
    "turn.start": { turnId: "trn_00000000000000000000000001" },
  };
  const result = (method: string): unknown => extra.results?.[method] ?? results[method] ?? {};
  const fake = fakeIpc({
    ...(extra.registerError === undefined ? {} : { registerError: extra.registerError }),
    ...(stateForAttach === undefined ? {} : { stateForAttach }),
    onWrite: (message, f) => {
      const method = methodOf(message);
      methods.push(method);
      if (requestId(message) === "") return; // 알림($/connectionReset)에는 응답이 없다
      params.push({ method, params: paramsOf(message) });
      const failure = extra.errors?.[method];
      if (failure !== undefined) {
        f.emitLine({
          jsonrpc: "2.0",
          id: requestId(message),
          error: {
            code: failure.code,
            message: failure.kind,
            data: {
              kind: failure.kind,
              retryable: false,
              ...(failure.details === undefined ? {} : { details: failure.details }),
            },
          },
        });
        return;
      }
      f.emitLine({ jsonrpc: "2.0", id: requestId(message), result: result(method) });
    },
  });
  return { fake, methods, params };
}

export function makeApp(fake: FakeIpc): App {
  return makeAppOver(fake.ipc);
}

/** 셸 쪽을 직접 정한 ipc(예: mockIPC 위의 실제 ipc.ts)로 앱을 만든다 */
export function makeAppOver(ipc: DesktopIpc): App {
  return createApp({
    ipc,
    clock: { now: () => Date.now() },
    scheduler: {
      setTimeout: (fn, ms) => Number(setTimeout(fn, ms)),
      clearTimeout: (h) => clearTimeout(h),
    },
    frames: {
      requestAnimationFrame: (cb) => Number(setTimeout(() => cb(0), 0)),
      cancelAnimationFrame: (h) => clearTimeout(h),
    },
    monotonic: () => performance.now(),
    clipboard: { writeText: () => Promise.resolve() },
    appVersion: "0.0.0",
    frameFallbackMs: 20,
    logSink: () => {},
  });
}
