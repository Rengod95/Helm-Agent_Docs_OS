import { describe, expect, test } from "bun:test";
import { ok, type Result } from "@fresnel/contracts";
import {
  CapabilityError,
  ScheduleEntries,
  ScheduleEntriesKey,
  type CapabilityApi,
} from "@fresnel/contracts/capabilities";
import {
  defineManifest,
  validateManifest,
  type ExtensionEntry,
  type PortKey,
  type ToolRegisterError,
} from "@fresnel/contracts/extensions";
import {
  ToolServicePortKey,
  type ToolRegistration,
  type Unregister,
} from "@fresnel/contracts/services";
import { createTestHost } from "@fresnel/ext-host/testing";
import type { ScopeLayer } from "@fresnel/contracts/settings";
import { SCHEDULE_EXTENSION_NAME, scheduleManifest, schedulePlugin } from "../src/index.ts";
import { createHarness } from "./support/harness.ts";

interface FakeTools {
  register(registration: ToolRegistration): Result<Unregister, ToolRegisterError>;
}

/** 도구 서비스 포트의 대역. 이름은 실제 포트와 같고 시험이 등록 호출을 기록한다 */
const ToolsKey: PortKey<FakeTools> = { name: ToolServicePortKey.name };

/** 거부를 기다려 CapabilityError를 돌려준다. 거부하지 않거나 다른 값으로 거부하면 시험이 실패한다 */
async function rejectionOf(promise: Promise<unknown> | undefined): Promise<CapabilityError> {
  if (promise === undefined) throw new Error("the consumer has no schedule API");
  try {
    await promise;
  } catch (caught) {
    if (caught instanceof CapabilityError) return caught;
    throw caught;
  }
  throw new Error("expected the call to reject with a CapabilityError");
}

/** 설정 층 하나를 만든다. 값은 `l2.schedule.entries.directCreate` 하나다 */
function directCreateLayer(scope: ScopeLayer["scope"], value: string): ScopeLayer {
  return { scope, values: new Map([["l2.schedule.entries.directCreate", value]]) };
}

async function boot(options: { tools?: boolean; layers?: readonly ScopeLayer[] } = {}) {
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
  const h = createHarness();
  const layers = options.layers ?? [];
  const installed = await t.host.install(
    schedulePlugin({ service: h.service, settings: { layers: () => layers } }),
  );
  await t.settled();
  return { t, installed, registered, service: h.service };
}

/** 예약 기능을 requires로 쓰는 소비자 확장. 호스트가 넘긴 기능 API를 그대로 받는다 */
function consumer() {
  const apis: { schedule?: CapabilityApi<typeof ScheduleEntries> } = {};
  const entry: ExtensionEntry = ({ manifest, register }) => {
    register(manifest.name, {}, (g) => {
      apis.schedule = g.capability(ScheduleEntriesKey);
    });
  };
  return {
    apis,
    unit: {
      manifest: defineManifest({
        schemaVersion: 2,
        name: "schedule-consumer",
        version: "0.1.0",
        entry: "./src/index.ts",
        plugins: [
          {
            layer: "L3",
            hooks: [],
            requires: [{ id: "schedule.entries", range: "^1.0.0" }],
          },
        ],
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
    expect(checked.manifest?.plugins[0]?.layer).toBe("L2");
    expect(checked.manifest?.plugins[0]?.provides).toEqual([
      { id: "schedule.entries", version: "1.0.0" },
    ]);
    const unit = schedulePlugin({
      service: createHarness().service,
      settings: { layers: () => [] },
    });
    expect(unit.builtin).toBe(true);
    expect(unit.manifest.plugins[0]?.hooks).toEqual([]);
    expect(unit.manifest.plugins[0]?.drives).toBeUndefined();
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
    expect(made?.entry).toMatchObject({
      id: "sch_1",
      trigger: { kind: "remote" },
      enabled: true,
      // 확장이 만든 항목에는 만든 확장의 이름이 남는다(사용자가 목록에서 본다)
      createdBy: "ext:schedule-consumer",
    });
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

describe("direct call setting through the installed plugin", () => {
  test("a user deny makes the consumer's create fail as denied and leaves no entry", async () => {
    const { t, service } = await boot({ layers: [directCreateLayer("user", "deny")] });
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    const error = await rejectionOf(
      apis.schedule?.create({ trigger: { kind: "remote" }, prompt: "go" }),
    );
    expect(error.data).toMatchObject({ code: "denied", retryable: false });
    expect(service.list()).toEqual([]);
  });

  test("a managed deny also reaches the consumer's create", async () => {
    const { t, service } = await boot({ layers: [directCreateLayer("managed", "deny")] });
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    const error = await rejectionOf(
      apis.schedule?.create({ trigger: { kind: "remote" }, prompt: "go" }),
    );
    expect(error.data.code).toBe("denied");
    expect(service.list()).toEqual([]);
  });

  test("a project deny has no effect: the consumer's create still creates the entry", async () => {
    const { t, service } = await boot({ layers: [directCreateLayer("project", "deny")] });
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    const made = await apis.schedule?.create({ trigger: { kind: "remote" }, prompt: "go" });
    expect(made?.entry.createdBy).toBe("ext:schedule-consumer");
    expect(service.list()).toHaveLength(1);
  });

  test("ask without an approval service is refused as unavailable and creates nothing", async () => {
    const { t, service } = await boot({ layers: [directCreateLayer("user", "ask")] });
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    const error = await rejectionOf(
      apis.schedule?.create({ trigger: { kind: "remote" }, prompt: "go" }),
    );
    expect(error.data.code).toBe("unavailable");
    expect(service.list()).toEqual([]);
  });
});
