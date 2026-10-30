import { describe, expect, test } from "bun:test";
import { ok, type Result } from "@xeon/contracts";
import {
  ScheduleEntries,
  ScheduleEntriesKey,
  type CapabilityApi,
} from "@xeon/contracts/capabilities";
import {
  defineManifest,
  validateManifest,
  type ExtensionEntry,
  type PortKey,
  type ToolRegisterError,
} from "@xeon/contracts/extensions";
import {
  ToolServicePortKey,
  type ToolRegistration,
  type Unregister,
} from "@xeon/contracts/services";
import { createTestHost } from "@xeon/ext-host/testing";
import { SCHEDULE_EXTENSION_NAME, scheduleManifest, schedulePlugin } from "../src/index.ts";
import { createHarness } from "./support/harness.ts";

interface FakeTools {
  register(registration: ToolRegistration): Result<Unregister, ToolRegisterError>;
}

/** 도구 서비스 포트의 대역. 이름은 실제 포트와 같고 시험이 등록 호출을 기록한다 */
const ToolsKey: PortKey<FakeTools> = { name: ToolServicePortKey.name };

async function boot(options: { tools?: boolean } = {}) {
  const t = await createTestHost();
  const registered: ToolRegistration[] = [];
  await t.host.registerPlatform({
    name: "fake-tools",
    setup(ctx) {
      if (options.tools === false) return;
      ctx.providePort(ToolsKey, {
        register: (registration) => {
          registered.push(registration);
          return ok(() => {});
        },
      });
    },
  });
  const service = createHarness().service;
  const installed = await t.host.install(schedulePlugin({ service }));
  await t.settled();
  return { t, installed, registered };
}

/** 예약 능력을 requires로 쓰는 소비자 확장. 호스트가 넘긴 능력 API를 그대로 받는다 */
function consumer() {
  const apis: { schedule?: CapabilityApi<typeof ScheduleEntries> } = {};
  const entry: ExtensionEntry = ({ manifest, scope }) => {
    scope(manifest.name, {}, (g) => {
      apis.schedule = g.capability(ScheduleEntriesKey);
    });
  };
  return {
    apis,
    unit: {
      manifest: defineManifest({
        schemaVersion: 1,
        name: "schedule-consumer",
        version: "0.1.0",
        layer: "L3",
        kind: "plugin",
        entry: "./src/index.ts",
        requires: [{ id: "schedule.entries", range: "^1.0.0" }],
        points: [],
        usesDrive: false,
      }),
      entry,
      loadIndex: 1,
      builtin: false,
    },
  };
}

describe("manifest", () => {
  test("the manifest validates, is a builtin L2 plugin, and provides schedule.entries 1.0.0", () => {
    expect(SCHEDULE_EXTENSION_NAME).toBe("cap-schedule");
    const checked = validateManifest(scheduleManifest());
    expect(checked.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(checked.manifest?.name).toBe("cap-schedule");
    expect(checked.manifest?.layer).toBe("L2");
    expect(checked.manifest?.kind).toBe("plugin");
    expect(checked.manifest?.provides).toEqual([{ id: "schedule.entries", version: "1.0.0" }]);
    const unit = schedulePlugin({ service: createHarness().service });
    expect(unit.builtin).toBe(true);
    expect(unit.manifest.points).toEqual([]);
    expect(unit.manifest.usesDrive).toBe(false);
  });
});

describe("plugin", () => {
  test("installing provides ScheduleEntriesKey, and a consumer lists and creates through it", async () => {
    const { t, installed } = await boot();
    expect(installed.setups[0]?.status).toBe("applied");
    expect(installed.issues.filter((issue) => issue.severity === "error")).toEqual([]);

    const { apis, unit } = consumer();
    const result = await t.host.install(unit);
    expect(result.setups[0]?.status).toBe("applied");
    await t.settled();
    expect(await apis.schedule?.list({})).toEqual({ items: [] });
    const made = await apis.schedule?.create({
      trigger: { kind: "remote" },
      prompt: "go",
    });
    expect(made?.entry).toMatchObject({ id: "sch_1", trigger: { kind: "remote" }, enabled: true });
    expect(await apis.schedule?.list({})).toMatchObject({
      items: [{ entry: { id: "sch_1" }, lastRun: null }],
    });
  });

  test("tools.register is called once with the entries definition and the exec policy for schedule_create", async () => {
    const { registered } = await boot();
    expect(registered).toHaveLength(1);
    const only = registered[0];
    if (only?.kind !== "capability") throw new Error("expected a capability registration");
    expect(only.def).toBe(ScheduleEntries);
    expect(only.key).toBe(ScheduleEntriesKey);
    expect(only.policy).toEqual({ schedule_create: { risk: "exec" } });
  });

  test("without a tool service port nothing throws: the capability is provided and no tool is registered", async () => {
    const { t, installed, registered } = await boot({ tools: false });
    expect(installed.setups[0]?.status).toBe("applied");
    expect(registered).toEqual([]);

    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    expect(await apis.schedule?.list({})).toEqual({ items: [] });
  });
});
