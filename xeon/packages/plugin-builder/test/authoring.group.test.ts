import { join } from "node:path";
import { expect, test } from "bun:test";
import { scanDriveSource } from "@fresnel/group-sdk/testing";
import { AUTHORING_TOOL_NAMES, authoringManifest } from "../src/index.ts";
import { createGroupRig, type GroupRig } from "./group-support.ts";

const DIR = "/work/demo";

async function confirmedSession(rig: GroupRig): Promise<void> {
  const started = await rig.call("authoring_start", {
    kind: "plugin-group",
    name: "demo",
    dir: DIR,
  });
  expect(started).toMatchObject({ ok: true, sessionId: "auth-demo" });
  await rig.t.boundary(rig.thread).turnSettled();
  await rig.t.settled();
  await rig.answer("yes");
}

test("authoring.manifest: builtin plugin group, default off, ten tools registered", async () => {
  expect(authoringManifest.name).toBe("authoring");
  expect(authoringManifest.defaultEnabled).toBe(false);
  expect(authoringManifest.trust).toEqual({ level: "builtin" });
  expect(authoringManifest.group).toEqual({});
  const rig = await createGroupRig();
  const names = rig.toolNames();
  expect(names).toEqual([...AUTHORING_TOOL_NAMES].toSorted());
});

test("authoring.intent: tools wait for the user to confirm the kind and the name", async () => {
  const rig = await createGroupRig();
  await rig.call("authoring_start", { kind: "plugin-group", name: "demo", dir: DIR });
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
  await rig.call("authoring_validate", { sessionId: "auth-demo" });
  await rig.call("authoring_package", { sessionId: "auth-demo" });
  await rig.t.boundary(rig.thread).turnSettled();
  await rig.t.settled();
  await rig.answer("yes");
  await rig.call("authoring_install", { sessionId: "auth-demo", scope: "user" });
  await rig.t.boundary(rig.thread).turnSettled();
  await rig.t.settled();
  await rig.answer("yes");
  expect(rig.state()).toMatchObject({
    phase: "done",
    installed: { name: "demo", version: "0.1.0", location: "/ext/demo" },
  });
  expect(await rig.guard("write", "write", { path: "/elsewhere/a.ts" })).toBeUndefined();
});

test("authoring.A-4: package writes nothing before a yes, and the drive lock is handed back while waiting", async () => {
  const rig = await createGroupRig();
  await confirmedSession(rig);
  await rig.call("authoring_scaffold", { sessionId: "auth-demo" });
  await rig.call("authoring_validate", { sessionId: "auth-demo" });
  expect(rig.state().phase).toBe("trial");
  const asked = await rig.call("authoring_package", { sessionId: "auth-demo" });
  expect(asked).toMatchObject({ ok: true, status: "awaiting_confirmation", action: "package" });
  await rig.t.boundary(rig.thread).turnSettled();
  await rig.t.settled();
  // 질문이 열렸고 파일은 쓰지 않았고 drive 락은 반납된 상태다
  expect(rig.approvals.created).toHaveLength(2);
  expect(rig.probe.calls.filter((call) => call.startsWith("pack:"))).toEqual([]);
  expect(rig.t.host.leaseOf(rig.thread)).toBeNull();
  const released = rig.t.records
    .events(rig.thread)
    .filter((event) => event.kind === "lease.released")
    .map((event) => event.payload);
  expect(released.at(-1)).toMatchObject({ reason: "waiting" });
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
  expect(rig.t.queue.items.map((item) => [item.requestId, item.item])).toEqual([
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
    kind: "plugin-group",
    name: "demo",
    dir: "../other",
  });
  expect(outside).toMatchObject({ ok: false, error: { kind: "outside_workspace" } });
  expect(rig.state().phase).toBe("idle");
  const relative = await rig.call("authoring_start", {
    kind: "plugin-group",
    name: "demo",
    dir: "./demo",
  });
  expect(relative).toMatchObject({ ok: true, sessionId: "auth-demo" });
  expect(rig.state().dir).toBe("/work/space/demo");
});

test("authoring.target-dir: without a working folder a relative dir opens no session and an absolute dir does", async () => {
  const rig = await createGroupRig();
  const refused = await rig.call("authoring_start", {
    kind: "plugin-group",
    name: "demo",
    dir: "./demo",
  });
  expect(refused).toMatchObject({ ok: false, error: { kind: "needs_folder" } });
  expect(rig.state()).toMatchObject({ phase: "idle", dir: null, sessionId: null });
  const absolute = await rig.call("authoring_start", {
    kind: "plugin-group",
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
    kind: "plugin-group",
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
    kind: "plugin-group",
    name: "demo",
    dir: "/work/other",
  });
  expect(again).toMatchObject({ ok: true, sessionId: "auth-demo" });
  expect(rig.state().dir).toBe("/work/other");
  const none = await rig.call("authoring_stop", {});
  expect(none).toMatchObject({ ok: true, status: "closed" });
  expect(await rig.call("authoring_stop", {})).toEqual({ ok: true, status: "none", closed: null });
});
