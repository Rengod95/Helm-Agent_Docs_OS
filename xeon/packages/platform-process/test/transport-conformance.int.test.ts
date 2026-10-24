import { describe, expect, test } from "bun:test";
import { WIRE_CONFORMANCE_CASES, type Transport } from "@xeon/contracts/wire";
import { Bug } from "@xeon/contracts";
import { createInProcessPair, createInProcessPairWith } from "../src/index.ts";
import { serveConformanceHost, spawnFakeEngine } from "../src/testing/index.ts";
import { runConformanceCase, type ConformanceLink } from "./support/conformance-runner.ts";
import { rejectionOf } from "./support/fakes.ts";
import { asFrame } from "./support/unsafe.ts";

// L0.process.plan PR-04, F.wire-settings.spec §9 A10: 같은 전송 적합성 케이스가 in-process와 stdio(자식 프로세스)에서 같은 결과로 통과한다.

function linkOf(transport: Transport): ConformanceLink {
  return {
    send: (frame) => transport.send(asFrame(frame)),
    onMessage: (handler) => transport.onMessage(handler),
  };
}

describe("conformance over in-process", () => {
  for (const testCase of WIRE_CONFORMANCE_CASES) {
    test(`${testCase.id}: ${testCase.title}`, async () => {
      const pair = createInProcessPair();
      serveConformanceHost(pair.server);
      const failure = await runConformanceCase(testCase, linkOf(pair.client));
      await pair.client.close();
      expect(failure).toBeUndefined();
    });
  }
});

describe("conformance over stdio (child process)", () => {
  for (const testCase of WIRE_CONFORMANCE_CASES) {
    test(`${testCase.id}: ${testCase.title}`, async () => {
      const engine = await spawnFakeEngine();
      const failure = await runConformanceCase(testCase, linkOf(engine.client));
      await engine.closeStdin();
      const exit = await engine.exited;
      expect(failure).toBeUndefined();
      expect(exit.code).toBe(0);
    });
  }
});

describe("in-process dev build checks", () => {
  test("in-process rejects non-serializable values in dev builds", async () => {
    const pair = createInProcessPair();
    expect(await rejectionOf(pair.client.send(asFrame(undefined)))).toBeInstanceOf(Bug);
    // 함수 값 필드는 JSON 왕복에서 사라질 뿐 오류가 아니다
    expect(
      await rejectionOf(pair.client.send(asFrame({ jsonrpc: "2.0", fn: () => 1 }))),
    ).toBeUndefined();
  });

  test("values JSON drops change shape on the other side, so params checks catch them", async () => {
    const pair = createInProcessPair();
    const seen: unknown[] = [];
    pair.server.onMessage((message) => {
      seen.push(message);
    });
    await pair.client.send(
      asFrame({
        jsonrpc: "2.0",
        id: "r1",
        method: "a.b",
        params: { when: new Date(0), gone: undefined },
      }),
    );
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    expect(seen).toEqual([
      { jsonrpc: "2.0", id: "r1", method: "a.b", params: { when: "1970-01-01T00:00:00.000Z" } },
    ]);
  });

  test("the production mode passes the same object, frozen", async () => {
    const pair = createInProcessPairWith({ mode: "freeze" });
    const seen: unknown[] = [];
    pair.server.onMessage((message) => {
      seen.push(message);
    });
    const message = asFrame({ jsonrpc: "2.0", id: "r1", method: "a.b", params: {} });
    await pair.client.send(message);
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    expect(seen[0]).toBe(message);
    expect(Object.isFrozen(message)).toBe(true);
  });
});
