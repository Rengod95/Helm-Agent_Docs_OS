import { expect, test } from "bun:test";
import { createOrchestrationRig, type OrchestrationRig } from "./group-support.ts";

// 시험 대화는 시작할 때의 초안 복사본을 읽는다(U-06). 열린 시험이 있는 동안 고친 폴더가 검사를 통과하면, 다음 시험은 새 초안으로 다시 읽어야 한다.

const DIR = "/work/demo";

async function confirmedSession(rig: OrchestrationRig): Promise<void> {
  const started = await rig.call("authoring_start", {
    kind: "single-plugin",
    name: "demo",
    dir: DIR,
  });
  expect(started).toMatchObject({ ok: true, sessionId: "auth-demo" });
  await rig.t.boundary(rig.thread).turnSettled();
  await rig.t.settled();
  await rig.answer("yes");
}

async function openTestRun(rig: OrchestrationRig): Promise<void> {
  await rig.call("authoring_trial", { sessionId: "auth-demo" });
  await rig.t.boundary(rig.thread).turnSettled();
  await rig.t.settled();
  await rig.answer("yes");
}

test("trial-reread: a passing validate while a Test run is open clears it, so the next authoring_trial starts a new Test run on the folder as it is now", async () => {
  const rig = await createOrchestrationRig();
  await confirmedSession(rig);
  await rig.call("authoring_scaffold", { sessionId: "auth-demo" });
  const first = await rig.call("authoring_validate", { sessionId: "auth-demo" });
  expect(first).not.toHaveProperty("note");
  await openTestRun(rig);
  expect(rig.state().trial).toEqual({ threadId: "thr_trial" });

  // 고친 뒤 검사가 통과하면 열린 시험 기록을 지우고, 옛 시험 대화가 아직 옛 판을 쓴다는 줄을 싣는다
  const checked = await rig.call("authoring_validate", { sessionId: "auth-demo" });
  expect(checked).toMatchObject({
    ok: true,
    note: expect.stringContaining("authoring_trial"),
  });
  expect(rig.state().trial).toBeNull();

  // 기록을 지웠으므로 시험을 다시 부르면 옛 대화를 `done`으로 돌려주지 않고 확인 카드를 새로 묻는다
  expect(await rig.call("authoring_trial", { sessionId: "auth-demo" })).toMatchObject({
    ok: true,
    status: "awaiting_confirmation",
    action: "trial",
  });
  await rig.t.boundary(rig.thread).turnSettled();
  await rig.t.settled();
  await rig.answer("yes");
  expect(rig.probe.calls.filter((call) => call.startsWith("testRun:"))).toEqual([
    `testRun:${DIR}`,
    `testRun:${DIR}`,
  ]);
  expect(rig.state().trial).toEqual({ threadId: "thr_trial" });
});

test("trial-reread: after the fix passes, the review refuses the old Test run's evidence until a Test run on this version has run", async () => {
  const rig = await createOrchestrationRig();
  await confirmedSession(rig);
  await rig.call("authoring_scaffold", { sessionId: "auth-demo" });
  await rig.call("authoring_validate", { sessionId: "auth-demo" });
  await openTestRun(rig);
  await rig.call("authoring_validate", { sessionId: "auth-demo" });
  const refused = await rig.call("authoring_submit", { sessionId: "auth-demo" });
  expect(refused).toMatchObject({ ok: false, error: { kind: "no_evidence" } });
  expect(rig.probe.submits).toEqual([]);
});
