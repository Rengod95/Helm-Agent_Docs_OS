import { expect, test } from "bun:test";
import type { GroupService, GroupSettingUnwritableReason } from "@xeon/contracts/services";
import {
  GROUP_USAGE,
  createGroupService,
  defineGroup,
  groupCommand,
  parseGroupCommand,
  runGroupCommand,
  type GroupModule,
} from "../src/index.ts";
import { memoryDriveHolderSettings, groupCatalogOf } from "../src/testing/index.ts";
import { serviceRig } from "./support/host.ts";
import { groupManifestOf } from "./support/manifests.ts";

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
  expect(parseGroupCommand("drive auto")).toEqual({
    ok: true,
    command: { op: "drive", target: "auto" },
  });
  expect(parseGroupCommand("drive helm")).toEqual({
    ok: true,
    command: { op: "drive", target: "helm" },
  });
  for (const bad of [
    "on",
    "off a b",
    "drive",
    "drive Helm",
    "drive foo_bar",
    "status BAD",
    "restart helm",
    "reset",
    "reset BAD",
    "status helm extra",
  ]) {
    expect(parseGroupCommand(bad)).toEqual({ ok: false, usage: GROUP_USAGE });
  }
  expect(GROUP_USAGE).toBe(
    "사용법: /group status [이름] | on <이름> | off <이름> | drive <이름|auto> | reset <이름>",
  );
});

function driver(name: string): GroupModule {
  return defineGroup({
    manifest: groupManifestOf({ name, usesDrive: true }),
    setup(g) {
      g.drive(async (loop) => {
        await loop.turn({ input: { kind: "user", content: name } });
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

test("command.drive-unknown-no-drive-locked-and-auto", async () => {
  const { holder, command } = await rig();
  expect(await command.run("drive xyz")).toEqual({
    ok: false,
    text: "알 수 없는 그룹: xyz. 설치된 그룹: helm, learning, review",
    pending: false,
  });
  expect(await command.run("drive learning")).toEqual({
    ok: false,
    text: "learning 그룹은 drive를 쓰지 않아 구동 그룹으로 지정할 수 없다",
    pending: false,
  });
  expect(holder.writes).toEqual([]);

  // helm이 임대를 갖고 있다. review는 후보라 X가 다음 경계에 임대를 옮긴다
  const named = await command.run("drive review");
  expect(named).toEqual({
    ok: true,
    text: "구동 그룹을 지정했다: review. 다음 단계 경계에 적용한다",
    pending: true,
  });
  expect(holder.writes).toEqual([{ holder: "review", scope: "session", threadId: null }]);

  expect(await command.run("drive auto")).toEqual({
    ok: true,
    text: "구동 그룹 선택을 바꿨다: auto. 현재 holder는 유지한다",
    pending: false,
  });
  expect(holder.writes.at(-1)).toEqual({ holder: null, scope: "session", threadId: null });

  const locked = await rig();
  const lockedHolder = memoryDriveHolderSettings({ locked: true });
  const lockedService = createGroupService({
    host: locked.t.host,
    catalog: groupCatalogOf([driver("helm")]),
    holder: lockedHolder,
    currentThread: () => locked.thread,
    report: () => {},
  });
  expect(await groupCommand(lockedService).run("drive helm")).toEqual({
    ok: false,
    text: "x.primitives.activeDriveGroup은 상위 범위 설정이 잠가 바꿀 수 없다",
    pending: false,
  });
});

test("command.drive-reports-each-unwritable-reason", async () => {
  const { service } = await rig();
  const cases: readonly (readonly [GroupSettingUnwritableReason, string])[] = [
    ["no_thread", "쓸 대화가 없다"],
    ["ambiguous_thread", "열린 대화가 여럿이라 어느 대화에 쓸지 정할 수 없다"],
    ["not_owner", "그 대화의 쓰기 소유를 이 프로세스가 쥐고 있지 않다"],
    ["project_unavailable", "프로젝트 설정 파일을 쓸 수 없다(작업 폴더가 없거나 신뢰하지 않는다)"],
    ["invalid_value", "값이 설정 정의에 맞지 않는다"],
    ["storage", "저장소나 설정 파일 쓰기에 실패했다"],
  ];
  const outputs = await Promise.all(
    cases.map(([reason]) => {
      const failing: GroupService = {
        ...service,
        setDriveHolder: () =>
          Promise.resolve({
            ok: false,
            error: {
              kind: "group.settingUnwritable",
              key: "x.primitives.activeDriveGroup",
              reason,
            },
          }),
      };
      return runGroupCommand(failing, { op: "drive", target: "review" });
    }),
  );
  expect(outputs).toEqual(
    cases.map(([, text]) => ({
      ok: false,
      text: `x.primitives.activeDriveGroup을 쓸 수 없다: ${text}`,
      pending: false,
    })),
  );
});

test("command.status-prints-setting-and-one-line-per-group", async () => {
  const { holder, command, service } = await rig();
  const all = await command.run("status");
  expect(all.ok).toBe(true);
  expect(all.pending).toBe(false);
  const lines = all.text.split("\n");
  expect(lines[0]).toBe("구동 그룹 설정: auto");
  expect(lines).toHaveLength(4);
  expect(lines[1]).toBe("helm  켜짐  drive=구동");
  expect(lines[2]).toBe("learning  켜짐  drive=없음");
  expect(lines[3]).toBe("review  켜짐  drive=대기");

  holder.set("missing");
  const stale = await runGroupCommand(service, { op: "status", id: "review" });
  expect(stale.text.split("\n")).toEqual([
    "구동 그룹 설정: missing(설치되지 않음)",
    "review  켜짐  drive=대기",
  ]);
  expect(await command.run("status nobody")).toMatchObject({ ok: false });
});

test("command.usage-on-bad-input", async () => {
  const { command } = await rig();
  expect(await command.run("restart")).toEqual({ ok: false, text: GROUP_USAGE, pending: false });
  expect(command.name).toBe("group");
});
