import { afterAll, describe, expect, test } from "bun:test";
import { WIRE_CONFORMANCE_CASES } from "@xeon/contracts/wire";
import { startInProcessHost, startStdioHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { stdioStreams } from "../fixtures/stdio-pair.ts";
import { createStdioTransport } from "../../src/transport/stdio.ts";
import { runConformanceCase } from "./conformance-runner.ts";

// AH-02, F.wire-settings.plan §6 A1·A2·A4·A7·A10: 실제 엔진 위에서 같은 케이스가 in-process와 stdio 모두 통과한다.
// 엔진이 서지 못하는 동안은 건너뛴다(fixtures/real-engine.ts).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const home = useEngineHome();
afterAll(() => {
  home.dispose();
});

describe("conformance-in-process (real engine)", () => {
  for (const testCase of WIRE_CONFORMANCE_CASES) {
    realTest(`${testCase.id}: ${testCase.title}`, async () => {
      const host = await startInProcessHost({ devChecks: true });
      await runConformanceCase(testCase, host.client);
      await host.close();
      expect(host.engine.storeId.startsWith("sto_")).toBe(true);
    });
  }
});

describe("conformance-stdio (real engine)", () => {
  for (const testCase of WIRE_CONFORMANCE_CASES) {
    realTest(`${testCase.id}: ${testCase.title}`, async () => {
      const streams = stdioStreams();
      const exit = startStdioHost({
        readable: streams.clientToServer.readable,
        writable: streams.serverToClient.writable,
        assemble: { devChecks: true },
        handleSignals: false,
      });
      const client = createStdioTransport({
        readable: streams.serverToClient.readable,
        writable: streams.clientToServer.writable,
      });
      await runConformanceCase(testCase, client);
      await client.close();
      expect((await exit).code).toBe(0);
    });
  }
});
