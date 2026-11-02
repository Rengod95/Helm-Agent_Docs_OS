import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { TestRunControlPort } from "@fresnel/contracts/extensions";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// Y9 host 부분(spec-deltas/t-wb.md §5). thread.create { testRun }의 표지, 빈 구현이면 testRun.unavailable, 가짜 포트로 pause → step → resume과 phase.
// 실제 ext-host 연결 시험은 T-XD 병합 뒤 통합 시험 한 줄이다.

function failureOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (error: unknown) => error,
  );
}

/** 멈춤 상태를 가진 가짜 제어 포트. 호출 순서를 남긴다 */
function fakeControl(): { readonly port: TestRunControlPort; readonly calls: string[] } {
  const calls: string[] = [];
  const state = { paused: false };
  return {
    calls,
    port: {
      pause(threadId) {
        calls.push(`pause ${threadId}`);
        state.paused = true;
        return ok({ paused: true });
      },
      resume(threadId) {
        calls.push(`resume ${threadId}`);
        if (!state.paused) return err({ kind: "not_paused" });
        state.paused = false;
        return ok({ paused: false });
      },
      step(threadId) {
        calls.push(`step ${threadId}`);
        if (!state.paused) return err({ kind: "not_paused" });
        return ok({ paused: true });
      },
      phase(threadId) {
        calls.push(`phase ${threadId}`);
        return ok({ phase: "plan", group: "helm", seq: 12 });
      },
    },
  };
}

test("thread.create { testRun } marks the thread, and an ordinary thread has no mark", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const plain = await connection.request("thread.create", {});
  const testRun = await connection.request("thread.create", { testRun: true });
  const list = await connection.request("thread.list", {});
  expect(list.threads.map((thread) => [thread.threadId, thread.testRun])).toEqual([
    [plain.threadId, undefined],
    [testRun.threadId, { profileId: null, target: null, paused: false }],
  ]);
  await connection.close();
});

test("with the empty control port every testRun.* call is testRun.unavailable", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const { threadId } = await connection.request("thread.create", { testRun: true });
  for (const method of [
    "testRun.pause",
    "testRun.resume",
    "testRun.step",
    "testRun.phase",
  ] as const) {
    // eslint-disable-next-line no-await-in-loop -- 메서드마다 차례로 확인한다
    expect(await failureOf(connection.request(method, { threadId }))).toMatchObject({
      code: 3311,
      data: { kind: "testRun.unavailable" },
    });
  }
  await connection.close();
});

test("pause, step and resume go through the control port in order and the mark follows paused", async () => {
  const control = fakeControl();
  const host = createFakeHost({ profiles: { testRunControl: control.port } });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const { threadId } = await connection.request("thread.create", { testRun: true });
  const pausedOf = async (): Promise<boolean | undefined> =>
    (await connection.request("thread.list", {})).threads.find(
      (thread) => thread.threadId === threadId,
    )?.testRun?.paused;

  expect(await failureOf(connection.request("testRun.resume", { threadId }))).toMatchObject({
    data: { kind: "testRun.notPaused" },
  });
  expect(await connection.request("testRun.pause", { threadId })).toEqual({ paused: true });
  expect(await pausedOf()).toBe(true);
  expect(await connection.request("testRun.step", { threadId })).toEqual({ paused: true });
  expect(await connection.request("testRun.phase", { threadId })).toEqual({
    phase: "plan",
    group: "helm",
    seq: 12,
  });
  expect(await connection.request("testRun.resume", { threadId })).toEqual({ paused: false });
  expect(await pausedOf()).toBe(false);
  expect(control.calls).toEqual([
    `resume ${threadId}`,
    `pause ${threadId}`,
    `step ${threadId}`,
    `phase ${threadId}`,
    `resume ${threadId}`,
  ]);
  await connection.close();
});

test("a thread that is not a Test run is testRun.notATestRun and never reaches the port; an unknown thread is thread.notFound", async () => {
  const control = fakeControl();
  const host = createFakeHost({ profiles: { testRunControl: control.port } });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const { threadId } = await connection.request("thread.create", {});
  expect(await failureOf(connection.request("testRun.pause", { threadId }))).toMatchObject({
    code: 3312,
    data: { kind: "testRun.notATestRun" },
  });
  expect(await failureOf(connection.request("testRun.phase", { threadId }))).toMatchObject({
    data: { kind: "testRun.notATestRun" },
  });
  const ghost = host.fake.ids.next("thr");
  expect(await failureOf(connection.request("testRun.pause", { threadId: ghost }))).toMatchObject({
    data: { kind: "thread.notFound" },
  });
  expect(control.calls).toEqual([]);
  await connection.close();
});
