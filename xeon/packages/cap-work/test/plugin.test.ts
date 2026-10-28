import { afterEach, describe, expect, test } from "bun:test";
import { Bug, err, ok, type Logger, type LogFields, type Result } from "@xeon/contracts";
import {
  WorkPlansKey,
  WorkTasksKey,
  type CapabilityApi,
  type CommandActionRegistry,
  type WorkPlans,
  type WorkTasks,
} from "@xeon/contracts/capabilities";
import {
  defineManifest,
  validateManifest,
  ScopedStorePortKey,
  type ExtensionEntry,
  type PortKey,
  type ToolRegisterError,
} from "@xeon/contracts/extensions";
import {
  ApprovalServicePortKey,
  SessionPortKey,
  type ToolRegistration,
  type Unregister,
} from "@xeon/contracts/services";
import type { ScopeLayer } from "@xeon/contracts/settings";
import type { ExtensionUnit } from "@xeon/ext-host";
import { createTestHost, flushMicrotasks, type TestHost } from "@xeon/ext-host/testing";
import { workManifest, WORK_EXTENSION_NAME } from "../src/manifest.ts";
import { workPlugin } from "../src/plugin.ts";
import { rejection } from "./support/assertions.ts";
import { openBase, type Base } from "./support/harness.ts";
import { approvalsDriver, modeDriver } from "./support/l1.ts";
import { tid } from "./support/tasks.ts";

interface FakeTools {
  register(registration: ToolRegistration): Result<Unregister, ToolRegisterError>;
}
interface FakeOs {
  logger(component: string): Logger;
}

const OsKey: PortKey<FakeOs> = { name: "xeon.os" };
const ToolsKey: PortKey<FakeTools> = { name: "xeon.tools" };

interface LogLine {
  readonly event: string;
  readonly fields: LogFields | undefined;
}

function recordingLogger(lines: LogLine[]): Logger {
  const logger: Logger = {
    debug: (event, fields) => void lines.push({ event, fields }),
    info: (event, fields) => void lines.push({ event, fields }),
    warn: (event, fields) => void lines.push({ event, fields }),
    error: (event, fields) => void lines.push({ event, fields }),
    child: () => logger,
  };
  return logger;
}

function userLayer(values: Record<string, unknown>): ScopeLayer {
  return { scope: "user", values: new Map(Object.entries(values)) };
}

let base: Base | undefined;

afterEach(async () => {
  await base?.[Symbol.asyncDispose]();
  base = undefined;
});

async function boot(
  options: {
    tools?: boolean;
    refuse?: string;
    settings?: Record<string, unknown>;
    commands?: CommandActionRegistry;
  } = {},
) {
  const opened = await openBase();
  base = opened;
  // xeon.session 전체를 이 시험이 제공하므로 호스트 대역의 기록 포트(같은 서비스 이름의 ext 멤버)는 빼 둔다
  const t: TestHost = await createTestHost({ without: ["records"] });
  const registered: ToolRegistration[] = [];
  const unregistered: string[] = [];
  const lines: LogLine[] = [];
  await t.host.registerPlatform({
    name: "fake-l0",
    setup(ctx) {
      ctx.providePort(SessionPortKey, opened.session);
      ctx.providePort(ScopedStorePortKey, opened.store.service);
      ctx.providePort(OsKey, { logger: () => recordingLogger(lines) });
      // 승인은 실제 core-tools 서비스다. 플러그인이 이 포트를 `planApprovalsOver`로 감싸 쓴다
      ctx.providePort(ApprovalServicePortKey, opened.l1.approvals);
      if (options.tools !== false) {
        ctx.providePort(ToolsKey, {
          register: (registration) => {
            registered.push(registration);
            const label = registration.kind === "capability" ? registration.def.id : "direct";
            if (label === options.refuse) return err({ kind: "name_conflict", toolName: label });
            return ok(() => {
              unregistered.push(label);
            });
          },
        });
      }
    },
  });
  const mode = modeDriver(opened.l1.tools);
  const approvals = approvalsDriver({
    session: opened.session,
    approvals: opened.l1.approvals,
    faults: opened.faults,
  });
  const installed = await t.host.install(
    workPlugin({
      ids: opened.ids,
      settings: { layers: () => [userLayer(options.settings ?? {})] },
      mode,
      ...(options.commands === undefined ? {} : { commands: options.commands }),
    }),
  );
  return { t, opened, installed, registered, unregistered, lines, mode, approvals };
}

/** work.tasks를 requires로 쓰는 소비자(L3 그룹 경로: 서비스를 직접 부른다) */
function consumer() {
  const apis: { tasks?: CapabilityApi<typeof WorkTasks>; plans?: CapabilityApi<typeof WorkPlans> } =
    {};
  const entry: ExtensionEntry = ({ manifest, scope }) => {
    scope(manifest.name, {}, (g) => {
      apis.tasks = g.capability(WorkTasksKey);
      apis.plans = g.capability(WorkPlansKey);
    });
  };
  const unit: ExtensionUnit = {
    manifest: defineManifest({
      schemaVersion: 1,
      name: "work-consumer",
      version: "0.1.0",
      layer: "L3",
      kind: "plugin",
      entry: "./src/index.ts",
      requires: [
        { id: "work.tasks", range: "^1.0.0" },
        { id: "work.plans", range: "^1.0.0" },
      ],
      points: [],
      usesDrive: false,
    }),
    entry,
    loadIndex: 1,
    builtin: false,
  };
  return { apis, unit };
}

describe("manifest", () => {
  test("the manifest passes validateManifest and is a builtin L2 plugin", () => {
    const checked = validateManifest(workManifest());
    expect(checked.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(checked.manifest?.name).toBe(WORK_EXTENSION_NAME);
    expect(checked.manifest?.layer).toBe("L2");
    expect(checked.manifest?.kind).toBe("plugin");
    expect(checked.manifest?.provides).toEqual([
      { id: "work.tasks", version: "1.0.0" },
      { id: "work.plans", version: "1.0.0" },
    ]);
    expect(checked.manifest?.points).toEqual(["before_agent_start", "session_start"]);
    expect(checked.manifest?.usesDrive).toBe(false);
  });
});

describe("plugin", () => {
  test("installing provides work.tasks and a consumer writes and reads through it", async () => {
    const { t, opened, installed } = await boot();
    expect(installed.setups[0]?.status).toBe("applied");
    expect(installed.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    const { apis, unit } = consumer();
    const result = await t.host.install(unit);
    expect(result.setups[0]?.status).toBe("applied");
    await t.settled();
    const options = opened.opts("req-consumer");
    const out = await apis.tasks?.create({ content: "from a group" }, options);
    expect(out?.task).toMatchObject({ id: "t1", status: "pending", blocked: false });
    const listed = await apis.tasks?.list({}, opened.opts());
    expect(listed?.tasks.map((task) => task.content)).toEqual(["from a group"]);
    // 같은 키 재호출은 이벤트를 늘리지 않는다
    const events = opened.eventCount();
    await apis.tasks?.create({ content: "from a group" }, options);
    expect(opened.eventCount()).toBe(events);
  });

  test("task_write reaches L1.tools with read risk so plan mode can keep the list", async () => {
    const { registered } = await boot();
    expect(registered).toHaveLength(2);
    const [registration, plansRegistration] = registered;
    expect(registration?.kind === "capability" ? registration.def.id : undefined).toBe(
      "work.tasks",
    );
    expect(registration?.kind === "capability" ? registration.key : undefined).toEqual(
      WorkTasksKey,
    );
    expect(
      registration?.kind === "capability" ? registration.def.tools.map((tool) => tool.name) : [],
    ).toEqual(["task_write"]);
    expect(registration?.kind === "capability" ? registration.policy : undefined).toEqual({
      task_write: { risk: "read" },
    });
    expect(
      plansRegistration?.kind === "capability"
        ? plansRegistration.def.tools.map((tool) => tool.name)
        : [],
    ).toEqual(["enter_plan_mode", "exit_plan_mode", "submit_plan"]);
    expect(plansRegistration?.kind === "capability" ? plansRegistration.key : undefined).toEqual(
      WorkPlansKey,
    );
    expect(plansRegistration?.kind === "capability" ? plansRegistration.policy : undefined).toEqual(
      {
        enter_plan_mode: { risk: "read" },
        exit_plan_mode: { risk: "read" },
        submit_plan: { risk: "read", classes: ["user_interaction"] },
      },
    );
  });

  test("uninstalling takes back the tool registration", async () => {
    const { t, unregistered } = await boot();
    await t.host.uninstall(WORK_EXTENSION_NAME);
    expect(unregistered.toSorted()).toEqual(["work.plans", "work.tasks"]);
  });

  test("a refused tool registration fails the setup by value", async () => {
    const { installed } = await boot({ refuse: "work.tasks" });
    expect(installed.setups[0]).toMatchObject({
      status: "failed",
      failure: { kind: "threw", code: "scope_setup_failed" },
    });
  });

  test("without the tools service nothing is advertised but the capability still works", async () => {
    const { t, opened, registered, lines } = await boot({ tools: false });
    expect(registered).toEqual([]);
    expect(lines.map((line) => line.event)).toContain("work.tools_missing");
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    await apis.tasks?.create({ content: "still works" }, opened.opts());
    expect((await apis.tasks?.list({}, opened.opts()))?.tasks).toHaveLength(1);
  });

  test("a call without a thread context is rejected even through the provider", async () => {
    const { t } = await boot();
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    const error = await rejection(apis.tasks?.list({}) ?? Promise.resolve());
    expect(error.data.code).toBe("invalid_input");
  });
});

async function dispatch(t: TestHost, threadId: ReturnType<TestHost["newThread"]>) {
  return await t.host.dispatch(
    "before_agent_start",
    { prompt: "go on", systemPrompt: "", systemPromptOptions: {} },
    {
      threadId,
      dispatchKey: `bas:${Math.random()}`,
      initial: { messages: [], systemPrompt: "" },
    },
  );
}

describe("work.plans through the plugin", () => {
  test("a group enters plan mode, submits, gets approved and the mode is restored by the feed listener", async () => {
    const { t, opened, mode, approvals } = await boot();
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    await mode.set(opened.threadId, "acceptEdits");
    expect(await apis.plans?.enterMode({}, opened.opts("e1"))).toEqual({
      mode: "plan",
      previousMode: "acceptEdits",
    });
    const submitted = await apis.plans?.submit({ title: "t", body: "b" }, opened.opts("c1"));
    expect(submitted).toMatchObject({ status: "input_required", planId: "p1" });
    const request = approvals.requests[0];
    if (request === undefined) throw new Bug("no approval request");
    await approvals.respond(request.approvalId, "allow");
    await flushMicrotasks();
    expect(mode.current(opened.threadId)).toBe("acceptEdits");
    expect(await apis.plans?.submit({ title: "t", body: "b" }, opened.opts("c1"))).toMatchObject({
      status: "decided",
      decision: "approved",
    });
  });

  test("session_start repairs a plan whose approval request never went out", async () => {
    const { t, opened, approvals } = await boot();
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.host.openThread(opened.threadId);
    await t.settled();
    approvals.failRequests(1);
    await rejection(
      apis.plans?.submit({ title: "t", body: "b" }, opened.opts("c1")) ?? Promise.resolve(),
    );
    expect(approvals.requests).toHaveLength(0);
    await t.host.dispatch(
      "session_start",
      { reason: "resume", threadId: opened.threadId },
      { threadId: opened.threadId, dispatchKey: "start-1" },
    );
    await flushMicrotasks();
    expect(approvals.requests).toHaveLength(1);
  });

  test("a command registry from the assembly gets /plan and /tasks and loses them on uninstall", async () => {
    const calls: string[] = [];
    const commands: CommandActionRegistry = {
      registerAction(decl) {
        calls.push(`add:${decl.name}`);
        return () => {
          calls.push(`remove:${decl.name}`);
        };
      },
    };
    const { t } = await boot({ commands });
    expect(calls).toEqual(["add:plan", "add:tasks"]);
    await t.host.uninstall(WORK_EXTENSION_NAME);
    expect(calls.toSorted()).toEqual(["add:plan", "add:tasks", "remove:plan", "remove:tasks"]);
  });

  test("a plugin without approvals reports submit_plan as unavailable and says so at startup", async () => {
    const opened = await openBase();
    base = opened;
    const t: TestHost = await createTestHost({ without: ["records"] });
    const lines: LogLine[] = [];
    await t.host.registerPlatform({
      name: "fake-l0",
      setup(ctx) {
        ctx.providePort(SessionPortKey, opened.session);
        ctx.providePort(ScopedStorePortKey, opened.store.service);
        ctx.providePort(OsKey, { logger: () => recordingLogger(lines) });
      },
    });
    await t.host.install(workPlugin({ ids: opened.ids, settings: { layers: () => [] } }));
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    const events = lines.map((line) => line.event);
    expect(events).toContain("work.approvals_missing");
    expect(events).toContain("work.mode_missing");
    const error = await rejection(
      apis.plans?.submit({ title: "t", body: "b" }, opened.opts("c1")) ?? Promise.resolve(),
    );
    expect(error.data.code).toBe("unavailable");
  });
});

describe("before_agent_start reminder", () => {
  test("an idle list is reported once the setting turns it on and writes nothing", async () => {
    const { t, opened } = await boot({ settings: { "l2.work.tasks.reminderTurns": 2 } });
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.host.openThread(opened.threadId);
    await t.settled();
    await apis.tasks?.write(
      {
        ops: [
          { op: "create", content: "write the spec" },
          { op: "create", content: "ship", status: "in_progress" },
        ],
      },
      opened.opts(),
    );
    opened.completeTurn();
    expect((await dispatch(t, opened.threadId)).value.messages).toEqual([]);
    opened.completeTurn();
    const events = opened.eventCount();
    const out = await dispatch(t, opened.threadId);
    expect(opened.eventCount()).toBe(events);
    expect(out.value.messages).toHaveLength(1);
    const message = out.value.messages[0];
    expect(message?.customType).toBe("x.cap-work.tasks.reminder");
    expect(message?.display).toBe(false);
    expect(typeof message?.content === "string" ? message.content : "").toContain(
      "t1 [대기] write the spec",
    );
    // 목록을 고치면 알림이 멎는다
    await apis.tasks?.update({ id: tid("t1"), status: "completed" }, opened.opts());
    expect((await dispatch(t, opened.threadId)).value.messages).toEqual([]);
  });

  test("with the default setting (0) no reminder is made", async () => {
    const { t, opened } = await boot();
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.host.openThread(opened.threadId);
    await t.settled();
    await apis.tasks?.create({ content: "x" }, opened.opts());
    for (let turn = 0; turn < 5; turn += 1) opened.completeTurn();
    expect((await dispatch(t, opened.threadId)).value.messages).toEqual([]);
  });
});
