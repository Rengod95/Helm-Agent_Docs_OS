import { expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import { WireError } from "@xeon/contracts/wire";
import type { BinaryCheckReport } from "@xeon/platform-os";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// host.status의 includeBinaries와 binaries(G2-07, HS-69). 가짜 엔진 위의 실제 처리기다. 실제 점검은 test/int/lifecycle.int.test.ts다.

async function open(host: FakeHost) {
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  try {
    await call;
  } catch (caught) {
    if (caught instanceof WireError) return caught;
    throw caught;
  }
  throw new Error("expected the request to fail with a WireError");
}

const REPORT: BinaryCheckReport = {
  platform: "darwin",
  ready: false,
  blocking: ["sops"],
  degraded: ["git"],
  items: [
    {
      name: "rg",
      need: "required",
      usedBy: "sandbox(srt), 작업 공간 파일 검색",
      impact: "파일 검색과 샌드박스 시작이 동작하지 않는다",
      status: { kind: "ok", path: "/Users/someone/bin/rg", version: "14.1.0", source: "system" },
    },
    {
      name: "sops",
      need: "required",
      usedBy: "secrets 기본 provider",
      impact: "비밀을 읽고 쓸 수 없다",
      status: { kind: "missing", hint: "brew install sops" },
    },
    {
      name: "age",
      need: "required",
      usedBy: "secrets 키 생성",
      impact: "새 비밀 키를 만들 수 없다",
      status: { kind: "too_old", found: "1.0.0", required: "1.1.0" },
    },
    {
      name: "git",
      need: "optional",
      usedBy: "작업 공간 git 기능",
      impact: "git 상태 표시와 작업 트리 기능만 빠진다",
      status: { kind: "unusable", reason: "version_unreadable" },
    },
  ],
};

test("host.status without includeBinaries has no binaries and runs no check", async () => {
  const host = createFakeHost({ diagnose: () => Promise.resolve({ binaries: ok(REPORT) }) });
  const connection = await open(host);
  const statuses = [
    await connection.request("host.status", {}),
    await connection.request("host.status", { includeBinaries: false }),
  ];
  for (const status of statuses) {
    expect(Object.keys(status).toSorted()).toEqual([
      "connections",
      "idleShutdownAt",
      "liveTurns",
      "mode",
      "pid",
      "startedAt",
    ]);
  }
  expect(host.fake.diagnoseCalls()).toBe(0);
  await connection.close();
});

test("includeBinaries carries the check report with every status variant and no executable path", async () => {
  const host = createFakeHost({ diagnose: () => Promise.resolve({ binaries: ok(REPORT) }) });
  const connection = await open(host);
  const status = await connection.request("host.status", { includeBinaries: true });
  expect(status.binaries).toEqual({
    platform: "darwin",
    ready: false,
    blocking: ["sops"],
    degraded: ["git"],
    items: [
      {
        name: "rg",
        need: "required",
        usedBy: "sandbox(srt), 작업 공간 파일 검색",
        impact: "파일 검색과 샌드박스 시작이 동작하지 않는다",
        status: { kind: "ok", version: "14.1.0", source: "system" },
      },
      {
        name: "sops",
        need: "required",
        usedBy: "secrets 기본 provider",
        impact: "비밀을 읽고 쓸 수 없다",
        status: { kind: "missing", hint: "brew install sops" },
      },
      {
        name: "age",
        need: "required",
        usedBy: "secrets 키 생성",
        impact: "새 비밀 키를 만들 수 없다",
        status: { kind: "too_old", found: "1.0.0", required: "1.1.0" },
      },
      {
        name: "git",
        need: "optional",
        usedBy: "작업 공간 git 기능",
        impact: "git 상태 표시와 작업 트리 기능만 빠진다",
        status: { kind: "unusable", reason: "version_unreadable" },
      },
    ],
  });
  expect(JSON.stringify(status)).not.toContain("/Users/someone");
  // 나머지 필드는 평소 상태 조회와 같다
  expect(status).toMatchObject({ mode: "in-process", connections: 1, liveTurns: 0 });
  expect(host.fake.diagnoseCalls()).toBe(1);
  await connection.close();
});

test("a check that was cancelled fails the request with request.cancelled and no partial result", async () => {
  const host = createFakeHost({
    diagnose: () => Promise.resolve({ binaries: err({ kind: "cancelled" }) }),
  });
  const connection = await open(host);
  const error = await wireErrorOf(connection.request("host.status", { includeBinaries: true }));
  expect(error.code).toBe(5001);
  expect(error.data.kind).toBe("request.cancelled");
  // 점검이 중단되어도 평소 상태 조회는 그대로 된다
  expect(await connection.request("host.status", {})).toMatchObject({ mode: "in-process" });
  await connection.close();
});
