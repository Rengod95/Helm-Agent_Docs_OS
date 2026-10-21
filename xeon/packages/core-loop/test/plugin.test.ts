import { expect, test } from "bun:test";
import { Bug, err } from "@xeon/contracts";
import { LoopPortKey, type PortKey } from "@xeon/contracts/extensions";
import { EVENT_CATALOG, SessionServiceName, type SessionService } from "@xeon/contracts/records";
import {
  ContextServiceName,
  LoopServiceName,
  ModelServiceName,
  OsServiceName,
  TaskServiceName,
  ToolServiceName,
  type ContextService,
  type LoopService,
  type ModelService,
  type OsService,
  type TaskService,
  type ToolService,
} from "@xeon/contracts/services";
import { createTestHost, fixedIdFactory } from "@xeon/ext-host/testing";
import { LOOP_MANIFEST, loopExtensionUnit } from "../src/index.ts";
import { manualClock } from "./support/clock.ts";
import { createFakeContext } from "./support/fake-context.ts";
import { createFakeModels } from "./support/fake-models.ts";
import { createFakeSession } from "./support/fake-session.ts";
import { createFakeTasks } from "./support/fake-tasks.ts";
import { createFakeTools } from "./support/fake-tools.ts";
import { capturedLogger } from "./support/harness.ts";

function missing(name: string): never {
  throw new Bug(`os stub: ${name}`);
}

const OS_KEY: PortKey<OsService> = { name: OsServiceName };
const SESSION_KEY: PortKey<SessionService> = { name: SessionServiceName };
const TASKS_KEY: PortKey<TaskService> = { name: TaskServiceName };
const TOOLS_KEY: PortKey<ToolService> = { name: ToolServiceName };
const CONTEXT_KEY: PortKey<ContextService> = { name: ContextServiceName };
const MODELS_KEY: PortKey<ModelService> = { name: ModelServiceName };
const LOOP_KEY: PortKey<LoopService> = { name: LoopServiceName };

function osStub(clock: ReturnType<typeof manualClock>): OsService {
  const logs = capturedLogger();
  return {
    info: { platform: "linux", arch: "x64", isWsl: false, release: "test" },
    dirs: {
      home: "/h",
      data: "/d",
      config: "/c",
      cache: "/ca",
      state: "/s",
      runtime: "/r",
      resource: "/re",
      tmp: "/t",
    },
    time: { clock, scheduler: clock, random: () => 0.5 },
    machineId: "test",
    userId: 1,
    processStartFingerprint: () => missing("processStartFingerprint"),
    logger: () => logs.logger,
    fsKind: () => missing("fsKind"),
    resolveBinary: () => missing("resolveBinary"),
    notify: () => Promise.resolve(err({ kind: "disabled" })),
    watch: () => missing("watch"),
    get telemetry() {
      return missing("telemetry");
    },
  };
}

test("the_loop_extension_provides_xeon_loop_through_the_host_ports", async () => {
  const clock = manualClock();
  const ids = fixedIdFactory(100);
  const fake = createFakeSession({ clock, ids });
  const tasks = createFakeTasks({ session: fake.session, ids });
  const tools = createFakeTools({ session: fake.session, ids, clock, tools: [] });
  const models = createFakeModels({ clock });
  const context = createFakeContext({ session: fake.session, clock });
  const host = await createTestHost({ without: ["loop", "queue", "records"] });

  await host.host.registerPlatform({
    name: "loop-plugin-test",
    setup(ctx) {
      ctx.providePort(OS_KEY, osStub(clock));
      ctx.providePort(SESSION_KEY, fake.session);
      ctx.providePort(TASKS_KEY, tasks.service);
      ctx.providePort(TOOLS_KEY, tools.service);
      ctx.providePort(CONTEXT_KEY, context.service);
      ctx.providePort(MODELS_KEY, models.service);
    },
  });

  const installed = await host.host.install(
    loopExtensionUnit({ ids: fixedIdFactory(5_000), hostMode: "in-process" }),
  );
  expect(installed.entryError).toBeUndefined();
  expect(installed.setups.map((setup) => setup.status)).toEqual(["applied"]);
  await host.settled();

  const loop = host.host.ports.get(LOOP_KEY);
  expect(loop).toBeDefined();
  expect(host.host.ports.get(LoopPortKey)).toBe(loop);
  expect(loop?.status(fake.startThread())).toBe("idle");
  expect(LOOP_MANIFEST.name).toBe("core-loop");
  expect(EVENT_CATALOG.length).toBeGreaterThan(0);
});
