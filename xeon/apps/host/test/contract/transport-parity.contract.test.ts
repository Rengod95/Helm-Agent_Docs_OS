import { describe, expect, test } from "bun:test";
import { repeatAsync } from "@xeon/contracts";
import type { EventWire, HostConnection, Transport } from "@xeon/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost, startStdioHost } from "../../src/main.ts";
import { createStdioTransport } from "../../src/transport/stdio.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { stdioStreams } from "../fixtures/stdio-pair.ts";
import { answeringModels } from "../fixtures/tape-host.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// AH-01, m2-plan HOST.5 transport-parity: 같은 모델 테이프와 같은 요청 열을 in-process와 stdio(같은 프로세스 안 스트림 쌍)로 돌려
// 정규화한 응답·이벤트열이 같다. 정규화는 식별자를 처음 나온 순서의 번호로, 시각을 0으로 바꾸고 휘발 스트림(stream.chunk)과
// 묶음 경계(events.batch를 나눈 방식)를 빼는 것이다. 컴파일 바이너리의 stdio는 자식 프로세스가 필요해 이 시험에 없다
// (DR-07, plan §3 HOST.5 spike의 수동 확인과 DESK.3 사이드카 시험이 맡는다).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const ID_PATTERN = /^[a-z]{3,4}_[0-9A-HJKMNP-TV-Z]{26}$/;

/** 식별자를 처음 나온 순서의 번호로, epoch ms처럼 보이는 시각 필드를 0으로 바꾼다 */
function normalizer(): (value: unknown) => unknown {
  const seen = new Map<string, string>();
  function walk(value: unknown, key: string | undefined): unknown {
    if (typeof value === "string" && ID_PATTERN.test(value)) {
      const prefix = value.slice(0, value.indexOf("_"));
      const known = seen.get(value);
      if (known !== undefined) return known;
      const next = `${prefix}#${String(seen.size + 1)}`;
      seen.set(value, next);
      return next;
    }
    if (typeof value === "number" && key !== undefined && /(At|Ms|[Tt]imestamp)$/.test(key))
      return 0;
    if (typeof value === "string" && key !== undefined && /(At|Since)$/.test(key)) return "time";
    if (Array.isArray(value)) return value.map((item: unknown) => walk(item, undefined));
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([name, item]) => [name, walk(item, name)]),
      );
    }
    return value;
  }
  return (value) => walk(value, undefined);
}

interface Run {
  readonly responses: unknown[];
  readonly events: unknown[];
}

/**
 * thread를 열면 기본 켜짐 scope의 켜기가 비동기로 적용되어 scope.changed가 뒤따라 커밋된다(X.primitives, idle apply). 그 커밋이
 * 입력(input.queued)보다 먼저 들어가는지는 전송이 얼마나 빠른가에 달려 있어 두 전송의 seq가 어긋난다. 새 이벤트가 `quietMs` 동안
 * 없을 때까지 기다린 뒤 입력을 보낸다. 전송 차이를 보려는 시험이라 엔진의 이 경합은 여기서 비켜 간다.
 */
async function untilQuiet(collected: { readonly events: readonly EventWire[] }): Promise<void> {
  const quietMs = 60;
  const state = { seen: -1 };
  await repeatAsync<void>(async () => {
    if (state.seen === collected.events.length) return { value: undefined };
    state.seen = collected.events.length;
    await new Promise<void>((resolve) => setTimeout(resolve, quietMs));
    return undefined;
  });
}

async function drive(client: Transport): Promise<Run> {
  const connection: HostConnection = createHostConnection(client);
  const normalize = normalizer();
  const collected = collectEvents(connection);
  const responses: unknown[] = [];
  responses.push(normalize(await connection.request("host.hello", HELLO_PARAMS)));
  responses.push(normalize(await connection.request("events.subscribe", { from: "head" })));
  const created = await connection.request("thread.create", { title: "parity" });
  responses.push(normalize(created));
  await untilQuiet(collected);
  const started = await connection.request("turn.start", {
    threadId: created.threadId,
    input: "say hello",
    requestId: "parity-1",
  });
  responses.push(normalize(started));
  await collected.waitFor((event: EventWire) => event.kind === "turn.completed");
  const duplicate = await connection.request("turn.start", {
    threadId: created.threadId,
    input: "say hello",
    requestId: "parity-1",
  });
  responses.push(normalize(duplicate));
  await connection.close();
  // 정규화는 한 번의 실행 안에서 식별자 번호를 맞추므로, 응답을 정규화한 뒤 이벤트를 같은 규칙으로 정규화해야 번호가 이어진다
  const events = collected.events
    .toSorted((a, b) => a.seq - b.seq)
    .map((event) => normalize(event));
  return { responses, events };
}

/** 실행마다 새 엔진 홈(저장소)에서 시작한다: 두 전송이 같은 빈 저장소에서 출발해야 seq가 같다 */
async function runInProcess(): Promise<Run> {
  const home = useEngineHome();
  try {
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: answeringModels("parity", "hello back"),
    });
    const run = await drive(host.client);
    await host.close();
    return run;
  } finally {
    home.dispose();
  }
}

async function runStdio(): Promise<Run> {
  const home = useEngineHome();
  try {
    return await runStdioIn();
  } finally {
    home.dispose();
  }
}

async function runStdioIn(): Promise<Run> {
  const streams = stdioStreams();
  const exit = startStdioHost({
    readable: streams.clientToServer.readable,
    writable: streams.serverToClient.writable,
    assemble: {
      devChecks: true,
      defaultGroups: false,
      buildModels: answeringModels("parity", "hello back"),
    },
    handleSignals: false,
  });
  const run = await drive(
    createStdioTransport({
      readable: streams.serverToClient.readable,
      writable: streams.clientToServer.writable,
    }),
  );
  expect((await exit).code).toBe(0);
  return run;
}

describe("transport-parity", () => {
  realTest(
    "the same tape and the same requests give the same responses and events over in-process and stdio",
    async () => {
      const inProcess = await runInProcess();
      const stdio = await runStdio();
      // transport 값 하나만 다르다
      const inHello = inProcess.responses[0];
      const stdioHello = stdio.responses[0];
      expect(inHello).toMatchObject({ transport: "in-process" });
      expect(stdioHello).toMatchObject({ transport: "stdio" });
      expect(inProcess.responses.slice(1)).toEqual(stdio.responses.slice(1));
      expect(inProcess.events.length).toBeGreaterThan(5);
      expect(inProcess.events).toEqual(stdio.events);
    },
  );
});
