import { join } from "node:path";
import { expect, test } from "bun:test";
import { scanDriveSource } from "@fresnel/group-sdk/testing";
import { AUTHORING_TOOL_NAMES, authoringManifest } from "../src/index.ts";
import { createGroupRig, type GroupRig } from "./group-support.ts";

const DIR = "/work/demo";

async function confirmedSession(rig: GroupRig): Promise<void> {
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

test("authoring.manifest: builtin plugin group, default on, thirteen tools registered, all deferred", async () => {
  expect(authoringManifest.name).toBe("authoring");
  expect(authoringManifest.defaultEnabled).toBe(true);
  expect(authoringManifest.trust).toEqual({ level: "builtin" });
  expect(authoringManifest.group).toEqual({});
  const rig = await createGroupRig();
  const names = rig.toolNames();
  expect(names).toEqual([...AUTHORING_TOOL_NAMES].toSorted());
  // 문맥 비용 0: 도구는 모두 `tool_search`로 찾아야 광고된다
  expect(rig.exposures()).toEqual(AUTHORING_TOOL_NAMES.map(() => "deferred"));
});

test("authoring.intent: tools wait for the user to confirm the kind and the name", async () => {
  const rig = await createGroupRig();
  await rig.call("authoring_start", { kind: "single-plugin", name: "demo", dir: DIR });
  expect(rig.state().phase).toBe("intent");
  const early = await rig.call("authoring_scaffold", { sessionId: "auth-demo" });
  expect(early).toMatchObject({ ok: false, error: { kind: "awaiting_confirmation" } });
  expect(rig.probe.calls).toEqual([]);
  await rig.t.boundary(rig.thread).turnSettled();
  await rig.t.settled();
  expect(rig.approvals.created).toHaveLength(1);
  await rig.answer("yes");
  expect(rig.state()).toMatchObject({ phase: "compose", intentConfirmed: true, name: "demo" });
});

test("authoring.start-drive: a child conversation cannot start the builder, so the tool refuses and opens no session", async () => {
  const rig = await createGroupRig();
  const child = rig.t.newThread();
  await rig.t.host.openThread(child, { child: true });
  await rig.t.settled();
  const refused = await rig.call(
    "authoring_start",
    { kind: "single-plugin", name: "demo", dir: DIR },
    child,
  );
  expect(refused).toMatchObject({ ok: false, error: { kind: "drive_unavailable" } });
  expect(rig.state().sessionId).toBeNull();
  expect(rig.probe.calls).toEqual([]);
});

test("authoring.A-3: with a session open, a write outside the target folder is blocked, inside it passes", async () => {
  const rig = await createGroupRig();
  expect(await rig.guard("write", "write", { path: "/elsewhere/a.ts" })).toBeUndefined();
  await confirmedSession(rig);
  expect(await rig.guard("write", "write", { path: "/elsewhere/a.ts" })).toEqual({
    block: true,
    reason: "authoring: write would write outside the target folder (/elsewhere/a.ts)",
  });
  expect(await rig.guard("write", "write", { path: `${DIR}/src/a.ts` })).toBeUndefined();
  expect(await rig.guard("read_file", "read", { path: "/elsewhere/a.ts" })).toBeUndefined();
  // 이 그룹의 도구는 경로 인자가 없어도 막히지 않는다
  expect(await rig.guard("authoring_scaffold", "write", {})).toBeUndefined();
});

test("authoring.A-3: the guard lifts when the session ends", async () => {
  const rig = await createGroupRig();
  await confirmedSession(rig);
  await rig.call("authoring_scaffold", { sessionId: "auth-demo" });
  expect(rig.probe.calls).toEqual([`scaffold:${DIR}`]);
  expect(await rig.guard("write", "write", { path: "/elsewhere/a.ts" })).toBeDefined();
  // 설치 단계는 없다(M5c §7.7). 세션이 끝나면 쓰기 범위 가드가 풀린다
  await rig.call("authoring_stop", { sessionId: "auth-demo" });
  expect(rig.state()).toMatchObject({ phase: "idle", sessionId: null, submitted: null });
  expect(await rig.guard("write", "write", { path: "/elsewhere/a.ts" })).toBeUndefined();
});

test("authoring.A-4: package writes nothing before a yes, and the frame stays on the stack asking while the question is open", async () => {
  const rig = await createGroupRig();
  await confirmedSession(rig);
  await rig.call("authoring_scaffold", { sessionId: "auth-demo" });
  await rig.call("authoring_validate", { sessionId: "auth-demo" });
  expect(rig.state().phase).toBe("trial");
  const asked = await rig.call("authoring_package", { sessionId: "auth-demo" });
  expect(asked).toMatchObject({ ok: true, status: "awaiting_confirmation", action: "package" });
  await rig.t.boundary(rig.thread).turnSettled();
  await rig.t.settled();
  // 질문이 열렸고 파일은 쓰지 않았다. 질문 대기는 반납이 아니라 프레임 상태 `asking`이라 drive 락은 그대로 쥐고 있다(drive-isolation.md 2.1)
  expect(rig.approvals.created).toHaveLength(2);
  expect(rig.probe.calls.filter((call) => call.startsWith("pack:"))).toEqual([]);
  expect(rig.t.host.leaseOf(rig.thread)).toMatchObject({ scopeId: "authoring" });
  expect(rig.t.host.driveFrames(rig.thread).at(-1)).toMatchObject({
    plugin: "authoring",
    state: "asking",
  });
  const released = rig.t.records
    .events(rig.thread)
    .filter((event) => event.kind === "lease.released")
    .map((event) => event.payload);
  expect(released.some((payload) => JSON.stringify(payload).includes('"waiting"'))).toBe(false);
  await rig.answer("yes");
  expect(rig.probe.calls.filter((call) => call.startsWith("pack:"))).toEqual([`pack:${DIR}`]);
  expect(rig.state()).toMatchObject({
    phase: "package",
    packaged: { path: `${DIR}/dist/package`, sha256: "a".repeat(64), files: 1 },
  });
});

test("authoring.A-4: a refused package confirmation packs nothing and a later call asks again", async () => {
  const rig = await createGroupRig();
  await confirmedSession(rig);
  await rig.call("authoring_scaffold", { sessionId: "auth-demo" });
  await rig.call("authoring_validate", { sessionId: "auth-demo" });
  await rig.call("authoring_package", { sessionId: "auth-demo" });
  await rig.t.boundary(rig.thread).turnSettled();
  await rig.t.settled();
  await rig.answer("no");
  expect(rig.probe.calls.filter((call) => call.startsWith("pack:"))).toEqual([]);
  expect(rig.state()).toMatchObject({ pending: null, denied: "package", packaged: null });
  expect(await rig.call("authoring_package", { sessionId: "auth-demo" })).toMatchObject({
    ok: false,
    status: "denied",
  });
  expect(await rig.call("authoring_package", { sessionId: "auth-demo" })).toMatchObject({
    status: "awaiting_confirmation",
  });
  expect(rig.state().askRound).toBe(2);
});

test("authoring.A-5: replay returns dev_mode_required in a shipped build and runs in development mode", async () => {
  const shipped = await createGroupRig();
  await confirmedSession(shipped);
  expect(await shipped.call("authoring_replay", { sessionId: "auth-demo" })).toEqual({
    ok: false,
    error: { kind: "dev_mode_required", message: "replay runs only in development mode" },
  });
  expect(shipped.probe.calls).toEqual([]);
  expect(shipped.state().replay).toBe("dev_mode_required");

  const dev = await createGroupRig({ devMode: () => true });
  await confirmedSession(dev);
  expect(await dev.call("authoring_replay", { sessionId: "auth-demo" })).toMatchObject({
    ok: true,
  });
  expect(dev.probe.calls).toEqual([`replay:${DIR}`]);
  expect(dev.state().replay).toBe("passed");
});

test("authoring.fix-loop: the same error three times stops and asks the user", async () => {
  const rig = await createGroupRig();
  await confirmedSession(rig);
  await rig.call("authoring_scaffold", { sessionId: "auth-demo" });
  rig.probe.validation = {
    ok: false,
    issues: [{ severity: "error", code: "AU-009", path: "/src", message: "secret" }],
  };
  const first = await rig.call("authoring_validate", { sessionId: "auth-demo" });
  expect(first).toMatchObject({ ok: false });
  await rig.call("authoring_validate", { sessionId: "auth-demo" });
  const third = await rig.call("authoring_validate", { sessionId: "auth-demo" });
  expect(third).toMatchObject({ ok: false, stopped: expect.any(String) });
  expect(rig.state()).toMatchObject({ phase: "fix", pending: "fix_limit", sameErrorRuns: 3 });
  expect(await rig.call("authoring_validate", { sessionId: "auth-demo" })).toMatchObject({
    error: { kind: "awaiting_confirmation" },
  });
  await rig.t.boundary(rig.thread).turnSettled();
  await rig.t.settled();
  await rig.answer("yes");
  expect(rig.state()).toMatchObject({ pending: null, sameErrorRuns: 0 });
});

test("authoring.drive-source-is-deterministic: the drive keeps the replay discipline", async () => {
  const source = await Bun.file(join(import.meta.dir, "../src/group-drive.ts")).text();
  // 스캐너는 `<식>.drive(함수)` 호출을 찾는다. 등록 줄은 group.ts에 있어 같은 모양의 줄을 덧붙인다
  const registered = `${source}\ng.drive(authoringDrive(g, devkit));\n`;
  expect(scanDriveSource(registered, { fileName: "group-drive.ts" })).toEqual([]);
});

test("authoring.restore: thread.start tells the model about an open session and says nothing without one", async () => {
  const rig = await createGroupRig();
  const resume = async (key: string) => {
    await rig.t.host.dispatch(
      "thread.start",
      { reason: "resume", threadId: rig.thread },
      { threadId: rig.thread, dispatchKey: key },
    );
    await rig.t.settled();
  };
  await resume("r0");
  expect(rig.t.queue.items).toEqual([]);
  await confirmedSession(rig);
  await resume("r1");
  const restored = rig.t.queue.items.filter((item) => item.requestId === "authoring:restore:demo");
  expect(restored.map((item) => [item.requestId, item.item])).toEqual([
    [
      "authoring:restore:demo",
      {
        kind: "context",
        customType: "grp.authoring.notice.status",
        content: "[authoring] session auth-demo is open at compose (/work/demo)",
        display: true,
      },
    ],
  ]);
});

test("authoring.target-dir: a relative dir resolves inside the working folder, an absolute dir stays, no folder refuses a relative dir", async () => {
  const rig = await createGroupRig({ workspaceOf: () => "/work/space" });
  const outside = await rig.call("authoring_start", {
    kind: "single-plugin",
    name: "demo",
    dir: "../other",
  });
  expect(outside).toMatchObject({ ok: false, error: { kind: "outside_workspace" } });
  expect(rig.state().phase).toBe("idle");
  const relative = await rig.call("authoring_start", {
    kind: "single-plugin",
    name: "demo",
    dir: "./demo",
  });
  expect(relative).toMatchObject({ ok: true, sessionId: "auth-demo" });
  expect(rig.state().dir).toBe("/work/space/demo");
});

test("authoring.target-dir: without a working folder a relative dir opens no session and an absolute dir does", async () => {
  const rig = await createGroupRig();
  const refused = await rig.call("authoring_start", {
    kind: "single-plugin",
    name: "demo",
    dir: "./demo",
  });
  expect(refused).toMatchObject({ ok: false, error: { kind: "needs_folder" } });
  expect(rig.state()).toMatchObject({ phase: "idle", dir: null, sessionId: null });
  const absolute = await rig.call("authoring_start", {
    kind: "single-plugin",
    name: "demo",
    dir: "/abs/demo/../demo",
  });
  expect(absolute).toMatchObject({ ok: true });
  expect(rig.state().dir).toBe("/abs/demo");
});

test("authoring.stop: an open session closes to idle, keeps the files, and a new session opens in another folder", async () => {
  const rig = await createGroupRig();
  await confirmedSession(rig);
  await rig.call("authoring_scaffold", { sessionId: "auth-demo" });
  expect(rig.state().files).toHaveLength(2);
  const blocked = await rig.call("authoring_start", {
    kind: "single-plugin",
    name: "demo",
    dir: "/work/other",
  });
  expect(blocked).toMatchObject({ ok: false, error: { kind: "session_open" } });
  const wrong = await rig.call("authoring_stop", { sessionId: "auth-nope" });
  expect(wrong).toMatchObject({ ok: false, error: { kind: "unknown_session" } });
  const stopped = await rig.call("authoring_stop", { sessionId: "auth-demo" });
  expect(stopped).toMatchObject({ ok: true, status: "closed", closed: "auth-demo" });
  expect(rig.state()).toMatchObject({ phase: "idle", sessionId: null, dir: null, files: [] });
  // 가드는 풀리고, 같은 이름으로 다른 폴더에 다시 열 수 있다
  expect(await rig.guard("write", "write", { path: "/elsewhere/a.ts" })).toBeUndefined();
  const again = await rig.call("authoring_start", {
    kind: "single-plugin",
    name: "demo",
    dir: "/work/other",
  });
  expect(again).toMatchObject({ ok: true, sessionId: "auth-demo" });
  expect(rig.state().dir).toBe("/work/other");
  const none = await rig.call("authoring_stop", {});
  expect(none).toMatchObject({ ok: true, status: "closed" });
  expect(await rig.call("authoring_stop", {})).toEqual({ ok: true, status: "none", closed: null });
});

test("authoring.resume: an answer to the confirmation queues a followUp so the same flow continues without the user typing", async () => {
  const rig = await createGroupRig();
  await rig.call("authoring_start", { kind: "single-plugin", name: "demo", dir: DIR });
  await rig.t.boundary(rig.thread).turnSettled();
  await rig.t.settled();
  expect(rig.t.queue.items.filter((item) => item.when === "followUp")).toEqual([]);
  await rig.answer("yes");
  const resumed = rig.t.queue.items.filter((item) => item.when === "followUp");
  expect(resumed.map((item) => [item.requestId, item.item])).toEqual([
    [
      "authoring:intent:demo:0:r",
      {
        kind: "context",
        customType: "grp.authoring.notice.status",
        content:
          "[authoring] the user confirmed the kind and the name: continue with authoring_compose and authoring_scaffold",
        display: false,
      },
    ],
  ]);
});

test("authoring.resume: a declined package also queues a followUp so the model can answer the user", async () => {
  const rig = await createGroupRig();
  await confirmedSession(rig);
  await rig.call("authoring_scaffold", { sessionId: "auth-demo" });
  await rig.call("authoring_validate", { sessionId: "auth-demo" });
  await rig.call("authoring_package", { sessionId: "auth-demo" });
  await rig.t.boundary(rig.thread).turnSettled();
  await rig.t.settled();
  await rig.answer("no");
  const resumed = rig.t.queue.items.filter((item) => item.requestId.endsWith(":r"));
  expect(resumed.map((item) => item.when)).toEqual(["followUp", "followUp"]);
  expect(resumed.at(-1)?.item).toMatchObject({ content: "[authoring] the user declined packing" });
});

test("authoring.card-text: the confirmation cards are Korean and name the kind and the folder", async () => {
  const rig = await createGroupRig();
  await rig.call("authoring_start", { kind: "single-plugin", name: "demo", dir: DIR });
  await rig.t.boundary(rig.thread).turnSettled();
  await rig.t.settled();
  const request = rig.approvals.created[0];
  expect(JSON.stringify(request?.body)).toContain('플러그인 \\"demo\\"을 /work/demo에 만들까요?');
  expect(JSON.stringify(request?.body)).toContain('"label":"예"');
  expect(JSON.stringify(request?.body)).toContain('"label":"아니요"');
  expect(request?.title).toBe("Plugin Builder");
});

test("authoring.guide: lists the topics and reads a body or a reference file from the injected guide", async () => {
  const rig = await createGroupRig({
    guide: {
      topics: () => ({
        ok: true,
        value: [{ name: "plugins", description: "Use when building", files: ["references/a.md"] }],
      }),
      read: (topic, file) =>
        topic === "plugins"
          ? { ok: true, value: `text:${file ?? "SKILL"}` }
          : { ok: false, error: { kind: "not_found", message: `no guide topic ${topic}` } },
    },
  });
  expect(await rig.call("authoring_guide", {})).toEqual({
    ok: true,
    topics: [{ topic: "plugins", description: "Use when building", files: ["references/a.md"] }],
  });
  expect(await rig.call("authoring_guide", { topic: "plugins" })).toEqual({
    ok: true,
    topic: "plugins",
    text: "text:SKILL",
  });
  expect(await rig.call("authoring_guide", { topic: "plugins", file: "references/a.md" })).toEqual({
    ok: true,
    topic: "plugins",
    text: "text:references/a.md",
  });
  expect(await rig.call("authoring_guide", { topic: "nope" })).toEqual({
    ok: false,
    error: { kind: "not_found", message: "no guide topic nope" },
  });
});

test("authoring.guide: without an injected guide the tool says so and opens no session", async () => {
  const rig = await createGroupRig();
  expect(await rig.call("authoring_guide", {})).toMatchObject({
    ok: false,
    error: { kind: "guide_unavailable" },
  });
  expect(rig.state().sessionId).toBeNull();
});

test("authoring.lease: the builder takes the stack only when authoring_start asks for it; with no session it never takes it by itself", async () => {
  const rig = await createGroupRig();
  const acquired = () =>
    rig.t.records
      .events(rig.thread)
      .filter((event) => event.kind === "lease.acquired")
      .map((event) => event.payload);
  const released = () =>
    rig.t.records
      .events(rig.thread)
      .filter((event) => event.kind === "lease.released")
      .map((event) => event.payload);
  // 중재가 없고 시작 요청도 없으면 기본 켜짐인 빌더는 경계를 돌려도 스택에 오르지 않는다
  await rig.t.boundary(rig.thread).turnSettled();
  await rig.t.settled();
  await rig.t.boundary(rig.thread).idle();
  await rig.t.settled();
  expect(acquired()).toHaveLength(0);
  expect(rig.t.host.leaseOf(rig.thread)).toBeNull();
  // `authoring_start`가 시작 요청을 낸다. 다음 경계에서 스택에 오르고 확인 질문을 연다
  await confirmedSession(rig);
  expect(acquired().length).toBeGreaterThan(0);
  for (const payload of acquired()) expect(payload).toMatchObject({ scopeId: "authoring" });
  // 열린 세션 동안에는 `done`으로 물러나지 않는다(yield로 머문다)
  const doneCount = released().filter(
    (payload) =>
      typeof payload === "object" &&
      payload !== null &&
      "reason" in payload &&
      payload.reason === "done",
  );
  expect(doneCount).toHaveLength(0);
});

test("authoring.submit: without a Test run the review refuses with no_evidence and names authoring_trial, and sends nothing", async () => {
  const rig = await createGroupRig();
  await confirmedSession(rig);
  await rig.call("authoring_scaffold", { sessionId: "auth-demo" });
  await rig.call("authoring_validate", { sessionId: "auth-demo" });
  const refused = await rig.call("authoring_submit", { sessionId: "auth-demo" });
  expect(refused).toMatchObject({
    ok: false,
    error: { kind: "no_evidence", message: expect.stringContaining("authoring_trial") },
  });
  expect(rig.probe.calls.filter((call) => call.startsWith("submit:"))).toEqual([]);
  expect(rig.state()).toMatchObject({ submitted: null });
});

test("authoring.submit: after a Test run, the turn of that run is the evidence and the draft and item are recorded; nothing is installed", async () => {
  const rig = await createGroupRig();
  await confirmedSession(rig);
  await rig.call("authoring_scaffold", { sessionId: "auth-demo" });
  await rig.call("authoring_validate", { sessionId: "auth-demo" });
  await rig.call("authoring_trial", { sessionId: "auth-demo", prompt: "demo" });
  await rig.t.boundary(rig.thread).turnSettled();
  await rig.t.settled();
  await rig.answer("yes");
  expect(rig.state().trial).toEqual({ threadId: "thr_trial" });
  // 턴 id 없이 보내면 거절하고 어느 대화의 턴이 필요한지 알린다
  const needsTurn = await rig.call("authoring_submit", { sessionId: "auth-demo" });
  expect(needsTurn).toMatchObject({
    ok: false,
    error: { kind: "no_evidence", message: expect.stringContaining("thr_trial") },
  });
  const sent = await rig.call("authoring_submit", {
    sessionId: "auth-demo",
    turnId: "turn_1",
    purpose: "데모 플러그인",
  });
  expect(sent).toEqual({
    ok: true,
    draftId: "draft_demo",
    itemId: "rvw_demo",
    notice: "검토함에서 승인해야 쓸 수 있다",
  });
  expect(rig.probe.submits).toEqual([
    {
      dir: DIR,
      originThreadId: rig.thread,
      evidence: [{ kind: "turn", threadId: "thr_trial", turnId: "turn_1" }],
      purpose: "데모 플러그인",
    },
  ]);
  expect(rig.state()).toMatchObject({
    submitted: { draftId: "draft_demo", itemId: "rvw_demo" },
    phase: "trial",
  });
  // 다시 검사하면 제출 기록은 지운다(검토함의 항목은 그대로다). 고친 뒤에는 새 초안으로 다시 보낸다
  await rig.call("authoring_validate", { sessionId: "auth-demo" });
  expect(rig.state()).toMatchObject({ submitted: null });
});
