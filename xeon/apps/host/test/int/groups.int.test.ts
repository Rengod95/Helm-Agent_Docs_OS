import { expect, test } from "bun:test";
import { defineManifest, type PortKey } from "@xeon/contracts/extensions";
import { GroupServiceName, type GroupService } from "@xeon/contracts/services";
import { hostOf } from "@xeon/ext-host";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { GroupSettingsSourceKey, type GroupSettingsSource } from "@xeon/group-kit";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import type { HostPluginModule } from "../../src/types.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { testGroup } from "../fixtures/test-group.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// HOST.6 group-kit (int): 조립 루트가 그룹 서비스를 X의 임대 중재 포트(xeon.groups)로 내고, 서비스가 보는 그룹 목록·구동 그룹 설정·그룹 설정 읽기를
// 실제 구현으로 잇는다. 서비스는 확장이 포트로 얻어 쓴다(여기서는 포트를 붙잡아 두는 시험용 확장).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const GROUP_SERVICE_KEY: PortKey<GroupService> = { name: GroupServiceName };

interface Captured {
  service: GroupService | undefined;
  settings: GroupSettingsSource | undefined;
}

/** 서비스와 그룹 설정 포트를 붙잡는 시험용 확장 */
function portProbe(captured: Captured): HostPluginModule {
  return {
    manifest: defineManifest({
      schemaVersion: 1,
      name: "port-probe",
      version: "0.1.0",
      displayName: "Port probe",
      description: "Captures the group service ports for a test.",
      defaultEnabled: true,
      layer: "plugin",
      kind: "plugin",
      entry: "./src/index.ts",
      points: [],
      usesDrive: false,
      trust: { level: "builtin" },
    }),
    extension: ({ scope }) => {
      scope("port-probe", {}, (g) => {
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
      keys: ["x.primitives.activeDriveGroup"],
      threadId: created.threadId,
    });
    expect(got.settings[0]).toMatchObject({ value: groupId, source: { scope: "session" } });
    expect(settings.value("x.primitives.activeDriveGroup")).toBeNull();

    // 알 수 없는 그룹은 오류 값이다
    const unknown = await service.setDriveHolder("nope");
    expect(unknown.ok).toBe(false);
    await connection.close();
    await host.close();
    home.dispose();
  },
  30_000,
);
