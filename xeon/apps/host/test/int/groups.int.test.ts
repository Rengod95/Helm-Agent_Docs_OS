import { expect, test } from "bun:test";
import { defineManifest } from "@fresnel/contracts/extensions";
import { ExtHostPortKey, hostOf, type ExtHost, SETTINGS_READ_PORT } from "@fresnel/ext-host";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import type { GroupSettingsSource } from "@fresnel/group-sdk";
import { AssembleError, assemble } from "../../src/assemble.ts";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import type { HostPluginModule } from "../../src/types.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { testGroup } from "../fixtures/test-group.ts";
import { writeUserSettings } from "../fixtures/user-settings.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// HOST.6 group-sdk (int): 조립 루트가 그룹 서비스를 만들어 `onService`로 넘기고, 서비스가 보는 그룹 목록·그룹 설정 읽기를 실제 구현으로 잇는다.
// 그룹의 drive 역할은 thread의 주도권 스택에서 읽는다(drive-isolation.md 2.6). 중재 포트와 구동 그룹 설정은 없다(E3).
// 서비스는 확장이 포트로 얻어 쓴다(여기서는 포트를 붙잡아 두는 시험용 확장).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

interface Captured {
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
        captured.settings = host.port(SETTINGS_READ_PORT);
      });
    },
  };
}

realTest(
  "the group service lists the installed group, and a thread that never led has only the core-loop frame in drive.frames",
  async () => {
    const home = useEngineHome();
    const group = testGroup(fixedIdFactory(9));
    const captured: Captured = { settings: undefined };
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      extraPlugins: [group.module, portProbe(captured)],
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);

    // 목록에는 L3 그룹만 오른다(조립 확장과 코어 확장은 그룹이 아니다). 주도한 적 없는 그룹은 drive 역할이 none이다
    const groupId = group.module.manifest.name;
    expect(await connection.request("group.list", {})).toMatchObject({
      groups: [{ id: groupId, drive: "none" }],
    });

    // 주도한 적이 없는 대화의 스택은 코어 루프 한 칸뿐이고, 그룹은 스택에 없어 drive 역할이 none이다
    const created = await connection.request("thread.create", {});
    expect(await connection.request("drive.frames", { threadId: created.threadId })).toEqual({
      frames: [
        {
          depth: 0,
          plugin: null,
          versionId: null,
          leaseId: null,
          state: "driving",
          used: { turns: 0, spawns: 0, tokens: 0 },
          limits: {},
        },
      ],
    });

    await connection.close();
    await host.close();
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
        g.drive(async () => ({ do: "yield" }));
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
