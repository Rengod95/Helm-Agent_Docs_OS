import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { defineManifest, type PortKey } from "@fresnel/contracts/extensions";
import { GroupServiceName, type GroupService } from "@fresnel/contracts/services";
import { ExtHostPortKey, hostOf, type ExtHost } from "@fresnel/ext-host";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { GroupSettingsSourceKey, type GroupSettingsSource } from "@fresnel/group-sdk";
import { AssembleError, assemble } from "../../src/assemble.ts";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import type { HostPluginModule } from "../../src/types.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { testGroup } from "../fixtures/test-group.ts";
import { writeUserSettings } from "../fixtures/user-settings.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// HOST.6 group-sdk (int): 조립 루트가 그룹 서비스를 X의 임대 중재 포트(fresnel.groups)로 내고, 서비스가 보는 그룹 목록·구동 그룹 설정·그룹 설정 읽기를
// 실제 구현으로 잇는다. 서비스는 확장이 포트로 얻어 쓴다(여기서는 포트를 붙잡아 두는 시험용 확장).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const HOLDER_KEY = "x.primitives.activeDriver";
const GROUP_SERVICE_KEY: PortKey<GroupService> = { name: GroupServiceName };

interface Captured {
  service: GroupService | undefined;
  settings: GroupSettingsSource | undefined;
}

/** 서비스와 그룹 설정 포트를 붙잡는 시험용 확장 */
function portProbe(captured: Captured): HostPluginModule {
  return {
    manifest: defineManifest({
      schemaVersion: 2,
      name: "port-probe",
      version: "0.1.0",
      displayName: "Port probe",
      description: "Captures the group service ports for a test.",
      defaultEnabled: true,
      entry: "./src/index.ts",
      plugins: [{ layer: "plugin", hooks: [] }],
      trust: { level: "builtin" },
    }),
    extension: ({ register }) => {
      register("port-probe", {}, (g) => {
        const host = hostOf(g);
        captured.service = host.port(GROUP_SERVICE_KEY);
        captured.settings = host.port(GroupSettingsSourceKey);
      });
    },
  };
}

realTest(
  "the group service lists the installed group and writes the drive holder setting through the settings port",
  async () => {
    const home = useEngineHome();
    const group = testGroup(fixedIdFactory(9));
    const captured: Captured = { service: undefined, settings: undefined };
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      extraPlugins: [group.module, portProbe(captured)],
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const { service, settings } = captured;
    if (service === undefined || settings === undefined) throw new Error("ports were not provided");

    // 목록에는 L3 그룹만 오른다(조립 확장과 코어 확장은 그룹이 아니다)
    const groupId = group.module.manifest.name;
    expect(service.list().map((status) => status.id)).toEqual([groupId]);
    expect(service.status(groupId).ok).toBe(true);

    // 구동 그룹 설정: 쓰기는 이 엔진이 쥔 thread의 session 범위로 가고 settings.get이 그 값을 본다
    const created = await connection.request("thread.create", {});
    const written = await service.setDriveHolder(groupId);
    expect(written.ok).toBe(true);
    const got = await connection.request("settings.get", {
      keys: ["x.primitives.activeDriver"],
      threadId: created.threadId,
    });
    expect(got.settings[0]).toMatchObject({ value: groupId, source: { scope: "launch" } });
    expect(settings.value("x.primitives.activeDriver")).toBeNull();

    // 알 수 없는 그룹은 오류 값이다
    const unknown = await service.setDriveHolder("nope");
    expect(unknown.ok).toBe(false);
    await connection.close();
    await host.close();
    home.dispose();
  },
  30_000,
);

interface Started {
  readonly service: GroupService;
  readonly groupId: string;
  readonly connection: ReturnType<typeof createHostConnection>;
  close(): Promise<void>;
}

async function startWithGroup(seed: number, prepare?: () => void): Promise<Started> {
  prepare?.();
  const group = testGroup(fixedIdFactory(seed));
  const captured: Captured = { service: undefined, settings: undefined };
  const host = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    extraPlugins: [group.module, portProbe(captured)],
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  const { service } = captured;
  if (service === undefined) throw new Error("the group service was not provided");
  return {
    service,
    groupId: group.module.manifest.name,
    connection,
    close: async () => {
      await connection.close();
      await host.close();
    },
  };
}

realTest(
  "the drive holder is written to the thread the request names, never to the one held last; without a named thread it says why",
  async () => {
    const home = useEngineHome();
    const started = await startWithGroup(19);
    const { service, groupId, connection } = started;

    // 쥔 thread가 없으면 session 범위에 쓸 곳이 없다
    expect(await service.setDriveHolder(groupId)).toEqual({
      ok: false,
      error: { kind: "group.settingUnwritable", key: HOLDER_KEY, reason: "no_thread" },
    });

    const older = await connection.request("thread.create", {});
    const newer = await connection.request("thread.create", {});
    // 쥔 thread가 둘이면 마지막에 쥔 thread에 조용히 쓰지 않고 정할 수 없다고 알린다
    expect(await service.setDriveHolder(groupId)).toEqual({
      ok: false,
      error: { kind: "group.settingUnwritable", key: HOLDER_KEY, reason: "ambiguous_thread" },
    });

    // 요청이 가리킨 thread에만 쓴다
    const written = await service.setDriveHolder(groupId, { threadId: older.threadId });
    expect(written.ok).toBe(true);
    const read = await connection.request("settings.get", {
      keys: [HOLDER_KEY],
      threadId: older.threadId,
    });
    expect(read.settings[0]).toMatchObject({ value: groupId, source: { scope: "launch" } });
    const untouched = await connection.request("settings.get", {
      keys: [HOLDER_KEY],
      threadId: newer.threadId,
    });
    expect(untouched.settings[0]).toMatchObject({ source: { scope: "default" } });

    await started.close();
    home.dispose();
  },
  30_000,
);

realTest(
  "a thread this process does not hold is not_owner, a managed scope is locked, and a user file that cannot be written is storage",
  async () => {
    const home = useEngineHome();
    // 이전 프로세스가 만든 thread. 이 프로세스는 쥐지 않는다
    const first = await startWithGroup(29);
    const created = await first.connection.request("thread.create", {});
    await first.close();

    const started = await startWithGroup(39, () => {
      // 사용자 설정 파일이 JSON 객체가 아니면 덮어쓰지 않는다(file_invalid)
      mkdirSync(join(home.root, "config"), { recursive: true, mode: 0o700 });
      writeFileSync(join(home.root, "config", "settings.json"), "[1]");
    });
    const { service, groupId } = started;

    expect(await service.setDriveHolder(groupId, { threadId: created.threadId })).toEqual({
      ok: false,
      error: { kind: "group.settingUnwritable", key: HOLDER_KEY, reason: "not_owner" },
    });
    expect(await service.setDriveHolder(groupId, { scope: "managed" })).toEqual({
      ok: false,
      error: { kind: "group.settingLocked", key: HOLDER_KEY },
    });
    expect(await service.setDriveHolder(groupId, { scope: "user" })).toEqual({
      ok: false,
      error: { kind: "group.settingUnwritable", key: HOLDER_KEY, reason: "storage" },
    });
    await started.close();
    home.dispose();
  },
  30_000,
);

// X.primitives `x.primitives.driveRequiresGroup`(기본 켜짐): 플러그인 그룹이 아닌 플러그인은 drive를 등록하지 못한다.
// 끄면 그룹이 아닌 플러그인도 drive를 등록한다. 설정은 등록 시점(조립 때)에 읽는다
function plainDriverModule(captured: { ext: ExtHost | undefined }): HostPluginModule {
  return {
    manifest: defineManifest({
      schemaVersion: 2,
      name: "drive-plain",
      version: "0.1.0",
      displayName: "Plain driver",
      description: "Declares drive without being a plugin group.",
      defaultEnabled: true,
      entry: "./src/index.ts",
      plugins: [{ layer: "plugin", hooks: [], drives: true }],
      trust: { level: "builtin" },
    }),
    extension: ({ register }) => {
      register("drive-plain", {}, (g) => {
        captured.ext = hostOf(g).port(ExtHostPortKey);
        g.drive(async () => {});
      });
    },
  };
}

realTest(
  "drive policy: by default a plugin that is not a group cannot register drive, so its setup fails and assembly stops",
  async () => {
    const home = useEngineHome();
    const captured: { ext: ExtHost | undefined } = { ext: undefined };
    const caught = await assemble({
      mode: "in-process",
      defaultGroups: false,
      extraPlugins: [plainDriverModule(captured)],
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(AssembleError);
    if (!(caught instanceof AssembleError)) throw new Error("expected an AssembleError");
    expect(caught.issues).toEqual([
      {
        code: "plugin",
        plugin: "drive-plain",
        message:
          "setup of drive-plain failed: x.primitives.driveRequiresGroup is on and this plugin is not a member of a plugin group",
      },
    ]);
    home.dispose();
  },
  30_000,
);

realTest(
  "drive policy: with x.primitives.driveRequiresGroup set to false the same plugin registers and stays enabled",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, { "x.primitives.driveRequiresGroup": false });
    const captured: { ext: ExtHost | undefined } = { ext: undefined };
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      extraPlugins: [plainDriverModule(captured)],
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    expect(captured.ext?.registrations().find((info) => info.id === "drive-plain")).toMatchObject({
      id: "drive-plain",
      status: "enabled",
    });
    await host.close();
    home.dispose();
  },
  30_000,
);
