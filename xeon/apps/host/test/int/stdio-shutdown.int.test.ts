import { afterAll, describe, expect, test } from "bun:test";
import type { EventWire, HostConnection } from "@xeon/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost, startStdioHost, type HostExit } from "../../src/main.ts";
import type { AssembleOptions } from "../../src/types.ts";
import { createStdioTransport } from "../../src/transport/stdio.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { stdioStreams } from "../fixtures/stdio-pair.ts";
import { stallingModels } from "../fixtures/tape-host.ts";
import { collectEvents, HELLO_PARAMS, type EventCollector } from "../fixtures/wire-client.ts";

// AH-10, SV-06 (stdio-eof-checkpoint-exit), HS-31~HS-36 (int): 실제 엔진과 실제 SQLite 위의 stdio 호스트 종료 절차.
// 모델은 응답하지 않는 테이프라 turn이 진행 중인 채로 종료를 요청한다. 자식 프로세스를 띄우지 않고 같은 프로세스 안의 스트림 쌍으로 잇는다(DR-07).
// 컴파일 바이너리의 EOF 종료는 DESK.1 S4와 HOST.5 spike(plan §3)에서 실제 바이너리로 확인했다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const home = useEngineHome();
afterAll(() => {
  home.dispose();
});

interface RunningStdio {
  readonly connection: HostConnection;
  readonly events: EventCollector;
  readonly exit: Promise<HostExit>;
}

async function startStalledHost(handleSignals = false): Promise<RunningStdio> {
  const streams = stdioStreams();
  const assemble: Omit<AssembleOptions, "mode"> = {
    devChecks: true,
    defaultGroups: false,
    buildModels: stallingModels("stdio-shutdown"),
    // 시한을 넘겨도 시험 프로세스를 끝내지 않는다
    exit: (code) => {
      throw new Error(`unexpected exit(${String(code)})`);
    },
  };
  const exit = startStdioHost({
    readable: streams.clientToServer.readable,
    writable: streams.serverToClient.writable,
    assemble,
    handleSignals,
  });
  const connection = createHostConnection(
    createStdioTransport({
      readable: streams.serverToClient.readable,
      writable: streams.clientToServer.writable,
    }),
  );
  await connection.request("host.hello", HELLO_PARAMS);
  const events = collectEvents(connection);
  await connection.request("events.subscribe", { from: "head" });
  return { connection, events, exit };
}

/** turn을 하나 시작해 모델의 첫 요청이 진행 중인 단계까지 간다 */
async function startRunningTurn(running: RunningStdio): Promise<string> {
  const created = await running.connection.request("thread.create", {});
  await running.connection.request("turn.start", { threadId: created.threadId, input: "hello" });
  await running.events.waitFor((event) => event.kind === "step.started");
  return created.threadId;
}

function kindsOf(events: readonly EventWire[]): string[] {
  return events.map((event) => event.kind);
}

/** 같은 저장소를 새 호스트로 다시 열어 한 thread의 이벤트 종류를 순서대로 읽는다. 복구 표식 조회(thread.list의 resumable)는 L1B.2가 들어온 뒤 더한다 */
async function storedKinds(threadId: string): Promise<string[]> {
  const again = await startInProcessHost({ devChecks: true, defaultGroups: false });
  const head = again.engine.ports.feed.headSeq();
  if (!head.ok) throw new Error("head read failed");
  const read = again.engine.ports.feed.read(0, head.value, undefined, 10_000, 10_000);
  await again.close();
  if (!read.ok) throw new Error("event read failed");
  return read.value.events
    .filter((event) => event.threadId === threadId)
    .map((event) => event.kind);
}

describe("stdio-eof-checkpoint-exit", () => {
  realTest(
    "closing stdin while a turn runs commits the checkpoint, exits 0 with eof and leaves no recovery marker",
    async () => {
      const running = await startStalledHost();
      const threadId = await startRunningTurn(running);
      await running.connection.close();
      const exit = await running.exit;
      expect(exit).toEqual({ code: 0, reason: "eof" });
      // 진행 중이던 turn이 안전 경계에서 멈추고 닫힌 기록이 저장소에 남았다
      const kinds = await storedKinds(threadId);
      expect(kinds).toContain("turn.started");
      expect(kinds).toContain("turn.abort_requested");
      expect(kinds.at(-1)).not.toBe("turn.started");
      expect(kinds).toContain("turn.completed");
    },
  );
});

describe("host.shutdown", () => {
  realTest(
    "answers accepted after the turn has stopped, then the host exits 0 with reason stop",
    async () => {
      const running = await startStalledHost();
      const threadId = await startRunningTurn(running);
      const answered = await running.connection.request("host.shutdown", { reason: "client_exit" });
      expect(answered).toEqual({ accepted: true });
      // 응답이 오기 전에 turn의 정리 이벤트가 먼저 전해졌다(참여자가 응답 전에 끝난다)
      expect(kindsOf(running.events.events)).toContain("turn.completed");
      expect(await running.exit).toEqual({ code: 0, reason: "stop" });
      expect(await storedKinds(threadId)).toContain("turn.completed");
    },
  );

  realTest("host.shutdown is listed in the stdio host's hello features", async () => {
    const streams = stdioStreams();
    const exit = startStdioHost({
      readable: streams.clientToServer.readable,
      writable: streams.serverToClient.writable,
      assemble: { devChecks: true, defaultGroups: false },
      handleSignals: false,
    });
    const connection = createHostConnection(
      createStdioTransport({
        readable: streams.serverToClient.readable,
        writable: streams.clientToServer.writable,
      }),
    );
    const hello = await connection.request("host.hello", HELLO_PARAMS);
    expect(hello.features.map((feature) => feature.name)).toContain("host.shutdown");
    await connection.close();
    await exit;
  });
});

/** 시험 전부터 있던 처리기(`known`)를 뺀, 새로 붙은 신호 처리기 수 */
function addedListeners(signal: "SIGTERM" | "SIGINT", known: ReadonlySet<unknown>): number {
  return process.listeners(signal).filter((listener) => !known.has(listener)).length;
}

describe("signals", () => {
  realTest(
    "SIGTERM runs the same procedure with reason signal and removes its listeners",
    async () => {
      // 다른 소유자(예: 샌드박스 런타임의 정리 처리기)도 같은 신호에 처리기를 둘 수 있으므로, 시험 전부터 있던 처리기를 빼고 host가 더한 것만 센다
      const before = new Set(process.listeners("SIGTERM"));
      const beforeInt = new Set(process.listeners("SIGINT"));
      const running = await startStalledHost(true);
      expect(addedListeners("SIGTERM", before)).toBe(1);
      await startRunningTurn(running);
      process.emit("SIGTERM");
      const exit = await running.exit;
      expect(exit).toEqual({ code: 0, reason: "signal" });
      expect(kindsOf(running.events.events)).toContain("turn.completed");
      expect(addedListeners("SIGTERM", before)).toBe(0);
      expect(addedListeners("SIGINT", beforeInt)).toBe(0);
      await running.connection.close();
    },
  );
});
