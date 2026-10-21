import { expect, test } from "bun:test";
import {
  InputQueuePortKey,
  validateManifest,
  type ExtensionEntry,
  type ExtensionManifest,
  type PortKey,
  type PostReceipt,
} from "@xeon/contracts/extensions";
import { TaskServiceName, type TaskService } from "@xeon/contracts/services";
import type { ExtensionUnit } from "@xeon/ext-host";
import { createTestHost } from "@xeon/ext-host/testing";
import { createTasksEntry, TASKS_MANIFEST } from "../src/plugin.ts";
import { createStaticTasksSettings } from "../src/settings-source.ts";
import { memorySession, recordingLogger, type MemorySession } from "../src/testing/index.ts";
import { fixedIdFactory } from "./support/ids.ts";

// xeon.session 대역을 ext-host 포트로 제공한다. 키의 타입은 시험 대역에 맞춘다
const FakeSessionKey: PortKey<MemorySession> = { name: "xeon.session" };
const TaskServiceKey: PortKey<TaskService> = { name: TaskServiceName };

const POSTER_MANIFEST: ExtensionManifest = {
  schemaVersion: 1,
  name: "poster",
  version: "0.1.0",
  layer: "L3",
  kind: "group",
  entry: "./src/index.ts",
  points: ["agent_settled"],
  usesPost: true,
  usesDrive: false,
};

async function setup() {
  const t = await createTestHost({ without: ["queue", "records"] });
  const ids = fixedIdFactory(9000);
  const session = memorySession({ ids });
  const log = recordingLogger();
  await t.host.registerPlatform({
    name: "fake-session",
    setup(ctx) {
      ctx.providePort(FakeSessionKey, session);
    },
  });
  const unit: ExtensionUnit = {
    manifest: TASKS_MANIFEST,
    entry: createTasksEntry({ ids, settings: createStaticTasksSettings(), log: log.logger }),
    loadIndex: 0,
    builtin: true,
  };
  return { t, session, log, unit };
}

test("the manifest passes manifest validation", () => {
  const result = validateManifest(TASKS_MANIFEST);
  expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  expect(TASKS_MANIFEST).toMatchObject({ name: "core-tasks", layer: "L1", kind: "plugin" });
});

test("installing the plugin provides xeon.tasks through the ext-host plugin API", async () => {
  const { t, unit } = await setup();
  const installed = await t.host.install(unit);
  expect(installed.entryError).toBeUndefined();
  expect(installed.setups.map((setup) => setup.status)).toEqual(["applied"]);
  expect(installed.issues).toEqual([]);

  const service = t.host.ports.get(TaskServiceKey);
  expect(service).toBeDefined();
  // X의 post가 쓰는 InputQueuePort 키와 같은 서비스다
  expect(t.host.ports.get(InputQueuePortKey)).toBe(service);
  expect(service?.root.kind).toBe("app");
});

test("without xeon.session the setup fails with port_unavailable", async () => {
  const t = await createTestHost({ without: ["queue", "records"] });
  const entry = createTasksEntry({
    ids: fixedIdFactory(),
    settings: createStaticTasksSettings(),
    log: recordingLogger().logger,
  });
  const installed = await t.host.install({
    manifest: TASKS_MANIFEST,
    entry,
    loadIndex: 0,
    builtin: true,
  });
  expect(installed.setups.map((setup) => setup.status)).toEqual(["failed"]);
  expect(installed.setups[0]?.failure?.code).toBe("port_unavailable");
});

test("an extension post goes through ext-host into input.queued and post.accepted", async () => {
  const { t, session, unit } = await setup();
  await t.host.install(unit);
  const receipts: PostReceipt[] = [];
  const entry: ExtensionEntry = ({ manifest, scope }) => {
    scope(manifest.name, {}, (g) => {
      g.on("agent_settled", async () => {
        receipts.push(
          await g.post(
            { kind: "user", content: "review done" },
            { when: "followUp", requestId: "rev-1" },
          ),
        );
      });
    });
  };
  await t.host.install({ manifest: POSTER_MANIFEST, entry, loadIndex: 1, builtin: false });

  const thread = t.newThread();
  session.openThread(thread);
  await t.host.openThread(thread);
  const fire = (key: string) =>
    t.host.dispatch(
      "agent_settled",
      { turnId: t.ids.next("trn"), aborted: false },
      { threadId: thread, dispatchKey: key },
    );
  await fire("k1");
  await fire("k2");

  expect(receipts).toEqual([
    { requestId: "rev-1", duplicate: false },
    { requestId: "rev-1", duplicate: true },
  ]);
  expect(session.events.map((event) => event.kind)).toEqual(["input.queued", "post.accepted"]);
  expect(session.events[0]?.payload).toMatchObject({
    mode: "followUp",
    requestId: "rev-1",
    source: { type: "extension", scopeId: "poster" },
  });
});

test("disposing the host closes the service: signals only, no intent", async () => {
  const { t, session, unit } = await setup();
  await t.host.install(unit);
  const service = t.host.ports.get(TaskServiceKey);
  if (service === undefined) throw new Error("xeon.tasks was not provided");
  const thread = service.openScope(service.root, { kind: "thread", id: "thr_one" });
  await t.host.dispose();
  expect(thread.signal.aborted).toBe(true);
  expect(service.root.abortReason).toEqual({ code: "error", message: "tasks.closed" });
  expect(session.events).toEqual([]);
});
