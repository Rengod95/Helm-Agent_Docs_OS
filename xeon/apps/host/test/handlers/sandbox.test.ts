import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { SelfTestReport } from "@fresnel/contracts/services";
import { WireError } from "@fresnel/contracts/wire";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// sandbox.lastSelfTest, sandbox.selfTest(M4, L0.sandbox.spec §4.4). 가짜 포트 위의 실제 처리기다. 샌드박스를 실제로 띄우지 않는다.

const REPORT: SelfTestReport = {
  at: 1_700_000_000_000,
  durationMs: 42,
  passed: false,
  items: [
    { id: "network_denied", passed: false, detail: "exit=0" },
    { id: "env_allowlist", passed: true },
  ],
};

async function open(host: FakeHost) {
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

test("sandbox.lastSelfTest answers null before any run and the stored report after one, without running the check", async () => {
  const slot: { report?: SelfTestReport } = {};
  let runs = 0;
  const host = createFakeHost({
    overrides: {
      sandboxSelfTest: {
        last: () => slot.report,
        run: () => {
          runs += 1;
          return Promise.resolve(ok(REPORT));
        },
      },
    },
  });
  const connection = await open(host);
  expect(await connection.request("sandbox.lastSelfTest", {})).toEqual({ report: null });
  slot.report = REPORT;
  expect(await connection.request("sandbox.lastSelfTest", {})).toEqual({ report: REPORT });
  expect(runs).toBe(0);
  await connection.close();
});

test("sandbox.selfTest runs the check once and returns its report; a missing service is an internal error", async () => {
  let runs = 0;
  const host = createFakeHost({
    overrides: {
      sandboxSelfTest: {
        run: () => {
          runs += 1;
          return Promise.resolve(ok(REPORT));
        },
      },
    },
  });
  const connection = await open(host);
  expect(await connection.request("sandbox.selfTest", {})).toEqual(REPORT);
  expect(runs).toBe(1);
  await connection.close();

  const missing = createFakeHost({
    overrides: {
      sandboxSelfTest: {
        run: () => Promise.resolve(err({ kind: "not_running" as const })),
      },
    },
  });
  const missingConnection = await open(missing);
  const failure = await wireErrorOf(missingConnection.request("sandbox.selfTest", {}));
  expect(failure.data.kind).toBe("internal");
  expect(failure.message).toContain("sandbox: the sandbox service is not running");
  await missingConnection.close();
});
