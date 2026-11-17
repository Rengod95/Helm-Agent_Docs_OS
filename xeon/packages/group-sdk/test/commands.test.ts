import { expect, test } from "bun:test";
import {
  GROUP_USAGE,
  defineGroup,
  groupCommand,
  parseGroupCommand,
  runGroupCommand,
  type GroupModule,
} from "../src/index.ts";
import { serviceRig, startDriveOf } from "./support/host.ts";
import { groupManifestOf } from "./support/manifests.ts";
import { turnFinished } from "./support/steps.ts";

test("command.parse-grammar", () => {
  expect(parseGroupCommand("")).toEqual({ ok: true, command: { op: "status" } });
  expect(parseGroupCommand("reset helm")).toEqual({
    ok: true,
    command: { op: "reset", id: "helm" },
  });
  expect(parseGroupCommand("  status ")).toEqual({ ok: true, command: { op: "status" } });
  expect(parseGroupCommand("status helm")).toEqual({
    ok: true,
    command: { op: "status", id: "helm" },
  });
  expect(parseGroupCommand("on helm")).toEqual({ ok: true, command: { op: "on", id: "helm" } });
  expect(parseGroupCommand("off web-exa")).toEqual({
    ok: true,
    command: { op: "off", id: "web-exa" },
  });
  for (const bad of [
    "on",
    "off a b",
    "drive helm",
    "status BAD",
    "restart helm",
    "reset",
    "reset BAD",
    "status helm extra",
  ]) {
    expect(parseGroupCommand(bad)).toEqual({ ok: false, usage: GROUP_USAGE });
  }
  expect(GROUP_USAGE).toBe("사용법: /group status [이름] | on <이름> | off <이름> | reset <이름>");
});

function driver(name: string): GroupModule {
  return defineGroup({
    manifest: groupManifestOf({ name, drives: true }),
    setup(g) {
      g.drive(async ({ last }) => {
        if (turnFinished(last)) return { do: "yield" };
        return { do: "turn", input: { kind: "user", content: name } };
      });
    },
  });
}

function quiet(name: string): GroupModule {
  return defineGroup({ manifest: groupManifestOf({ name }), setup() {} });
}

async function rig() {
  const modules = [driver("helm"), quiet("learning"), driver("review")];
  const base = await serviceRig(modules);
  return { ...base, command: groupCommand(base.service) };
}

test("command.group-off-applies-at-step-boundary", async () => {
  const { t, thread, service, command } = await rig();
  // 사용자 turn이 실행 중이다
  t.loop.setRunning(thread, true);
  const output = await command.run("off learning");
  expect(output).toEqual({
    ok: true,
    text: "learning 끄기 요청을 기록했다. 다음 단계 경계에 적용한다",
    pending: true,
  });
  expect(service.status("learning")).toMatchObject({
    ok: true,
    value: { scope: "disabling", pendingToggle: "disable" },
  });
  await t.boundary(thread).stepEnd();
  t.loop.setRunning(thread, false);
  await t.settled();
  expect(service.status("learning")).toMatchObject({
    ok: true,
    value: { scope: "disabled", pendingToggle: null },
  });
  // 경계 뒤 scope.changed{disabled}가 정확히 한 번 커밋됐다
  const disabled = t.records
    .events(thread)
    .filter((event) => event.kind === "scope.changed")
    .filter((event) => JSON.stringify(event.payload).includes('"disabled"'));
  expect(disabled).toHaveLength(1);
});

test("command.group-on-while-idle-says-it-applied", async () => {
  const { t, service, command } = await rig();
  await command.run("off learning");
  await t.settled();
  expect(service.status("learning")).toMatchObject({ ok: true, value: { scope: "disabled" } });
  expect(await command.run("on learning")).toEqual({
    ok: true,
    text: "learning 그룹을 켰다",
    pending: false,
  });
});

test("command.status-prints-one-line-per-group-from-the-frame-stack", async () => {
  const { t, thread, command, service } = await rig();
  const idle = await command.run("status");
  expect(idle.text.split("\n")).toEqual([
    "helm  켜짐  drive=없음",
    "learning  켜짐  drive=없음",
    "review  켜짐  drive=없음",
  ]);
  await startDriveOf(t, thread, "helm");
  const all = await command.run("status");
  expect(all.ok).toBe(true);
  expect(all.pending).toBe(false);
  const lines = all.text.split("\n");
  expect(lines).toHaveLength(3);
  expect(lines[0]).toBe("helm  켜짐  drive=구동");
  expect(lines[1]).toBe("learning  켜짐  drive=없음");
  expect(lines[2]).toBe("review  켜짐  drive=없음");
  const one = await runGroupCommand(service, { op: "status", id: "review" });
  expect(one.text).toBe("review  켜짐  drive=없음");
  expect(await command.run("status nobody")).toMatchObject({ ok: false });
});

test("command.usage-on-bad-input", async () => {
  const { command } = await rig();
  expect(await command.run("restart")).toEqual({ ok: false, text: GROUP_USAGE, pending: false });
  expect(command.name).toBe("group");
});
