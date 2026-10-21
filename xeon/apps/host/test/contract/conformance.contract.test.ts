import { describe, expect, test } from "bun:test";
import { WIRE_CONFORMANCE_CASES } from "@xeon/contracts/wire";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { runConformanceCase } from "./conformance-runner.ts";

// AH-02: WIRE_CONFORMANCE_CASES 전부가 in-process와 stdio(같은 프로세스 안 스트림 쌍)에서 통과한다.
// 가짜 엔진 위의 실제 처리기·허브·전송이다. 실제 엔진 위의 같은 시험은 conformance-real.contract.test.ts다.

describe("conformance-in-process", () => {
  for (const testCase of WIRE_CONFORMANCE_CASES) {
    test(`${testCase.id}: ${testCase.title}`, async () => {
      const host = createFakeHost();
      const { client, served } = host.connect();
      await runConformanceCase(testCase, client);
      await client.close();
      await served.closed;
      expect(host.hub.size).toBe(0);
    });
  }
});

describe("conformance-stdio", () => {
  for (const testCase of WIRE_CONFORMANCE_CASES) {
    test(`${testCase.id}: ${testCase.title}`, async () => {
      const host = createFakeHost();
      const { client, served } = host.connectStdio();
      await runConformanceCase(testCase, client);
      await client.close();
      await served.closed;
      expect(host.hub.size).toBe(0);
    });
  }
});
