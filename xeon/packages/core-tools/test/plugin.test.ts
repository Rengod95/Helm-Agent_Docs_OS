import { expect, test } from "bun:test";
import { validateManifest, type PortKey } from "@xeon/contracts/extensions";
import {
  WorkspaceFilesKey,
  WorkspaceFiles,
  WorkspaceShell,
  WorkspaceShellKey,
} from "@xeon/contracts/capabilities";
import {
  ApprovalServicePortKey,
  ToolServicePortKey,
  type Redactor,
} from "@xeon/contracts/services";
import type { OutputTruncator } from "../src/types.ts";
import { createTestHost } from "@xeon/ext-host/testing";
import { toolsManifest, toolsPlugin } from "../src/plugin.ts";
import {
  fakeRedactor,
  fakeRunContext,
  fakeSession,
  fakeStore,
  fakeTruncator,
  sequentialIds,
  type FakeSession,
  type FakeStore,
} from "../src/testing/index.ts";
import { TOOLS_EXTENSION_NAME } from "../src/index.ts";
import { fakeTasks, type FakeTasks } from "./support/fake-tasks.ts";
import { callTool, directTool, NOW } from "./support/harness.ts";

interface FakeExec {
  readonly id: string;
  canonicalPath(path: string): Promise<{ ok: true; value: string }>;
  absolutePath(path: string): Promise<{ ok: true; value: string }>;
  truncateHead: OutputTruncator["truncateHead"];
  formatSize: OutputTruncator["formatSize"];
}

const SessionKey: PortKey<FakeSession> = { name: "xeon.session" };
const StoreKey: PortKey<FakeStore> = { name: "xeon.store" };
const TasksKey: PortKey<FakeTasks> = { name: "xeon.tasks" };
const ExecKey: PortKey<FakeExec> = { name: "xeon.exec" };
const SecretsKey: PortKey<{ readonly redactor: Redactor }> = { name: "xeon.secrets" };

async function boot() {
  // 테스트 호스트의 기록 포트(xeon.session의 ext 속성)는 빼고, 이 패키지가 쓰는 세션 대역을 올린다
  const t = await createTestHost({ without: ["records", "queue", "loop"] });
  const clock = { now: () => NOW };
  const ids = sequentialIds(5000);
  const session = fakeSession({ clock, ids });
  const tasks = fakeTasks();
  const truncator = fakeTruncator();
  const exec: FakeExec = {
    id: "env1",
    canonicalPath: (path) => Promise.resolve({ ok: true, value: path }),
    absolutePath: (path) => Promise.resolve({ ok: true, value: path }),
    truncateHead: (content, o) => truncator.truncateHead(content, o),
    formatSize: (bytes) => truncator.formatSize(bytes),
  };
  await t.host.registerPlatform({
    name: "fake-l0",
    setup(ctx) {
      ctx.providePort(SessionKey, session);
      ctx.providePort(StoreKey, fakeStore());
      ctx.providePort(TasksKey, tasks);
      ctx.providePort(ExecKey, exec);
      ctx.providePort(SecretsKey, { redactor: fakeRedactor() });
    },
  });
  const installed = await t.host.install(
    toolsPlugin({
      clock,
      ids,
      settings: { layers: () => [] },
    }),
  );
  return { t, installed, session, tasks, ids };
}

test("the manifest passes validateManifest and the unit is a builtin L1 plugin", () => {
  const checked = validateManifest(toolsManifest());
  expect(checked.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  expect(checked.manifest?.name).toBe(TOOLS_EXTENSION_NAME);
  expect(checked.manifest?.layer).toBe("L1");
  expect(checked.manifest?.optional?.map((entry) => entry.id)).toEqual([
    "workspace.files",
    "workspace.shell",
    "workspace.images",
  ]);
  const unit = toolsPlugin({
    clock: { now: () => NOW },
    ids: sequentialIds(),
    settings: { layers: () => [] },
  });
  expect(unit.builtin).toBe(true);
  expect(unit.manifest.points).toEqual([]);
});

test("installing provides xeon.tools and xeon.approvals ports and runs a call end to end", async () => {
  const { t, installed, session, tasks, ids } = await boot();
  expect(installed.setups[0]?.status).toBe("applied");
  expect(installed.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  const tools = t.host.ports.get(ToolServicePortKey);
  const approvals = t.host.ports.get(ApprovalServicePortKey);
  expect(tools).toBeDefined();
  expect(approvals).toBeDefined();
  if (tools === undefined) return;

  // 확장 ToolsPort 경로로 등록한 도구도 같은 파이프라인을 지난다
  const thread = ids.next("thr");
  await t.host.openThread(thread);
  const seenThreads: string[] = [];
  tools.register("acme-notes", {
    name: "note_add",
    description: "add a note",
    parameters: directTool("x", () => Promise.resolve({ content: [], details: null })).parameters,
    replay: "unsafe",
    execute: (_args, ctx) => {
      seenThreads.push(ctx.threadId);
      return Promise.resolve("noted");
    },
  });
  // 위험 등급을 선언하지 않은 도구는 exec이므로 승인이 필요하다. 비대화형이라 거부된다
  const run = fakeRunContext({ session, ids, threadId: thread, interactive: false });
  tasks.addTurn(run.turnId);
  const denied = await callTool(tools, run, { id: "n1", name: "note_add", args: { text: "x" } });
  expect(denied.blocked).toContain("noninteractive_ask_denied");
  expect(seenThreads).toEqual([]);

  // 읽기 도구 능력은 매니페스트 optional에 올라 있어 g.capability로 해석된다(공급자가 없으면 unavailable 결과)
  tools.register({ kind: "capability", def: WorkspaceFiles, key: WorkspaceFilesKey });
  tools.register({ kind: "capability", def: WorkspaceShell, key: WorkspaceShellKey });
  const read = await callTool(tools, run, { id: "r1", name: "read", args: { path: "a" } });
  expect(read.isError).toBe(true);
  expect(JSON.stringify(read.result)).toContain("[unavailable]");
  expect(session.events.map((event) => event.kind)).toEqual([
    "item.recorded",
    "effect.intent",
    "effect.exec",
    "effect.result",
    "item.recorded",
  ]);
});

test("setup takes the truncation functions from xeon.exec and needs no truncator option (D-08)", async () => {
  const { installed, t } = await boot();
  expect(installed.setups[0]?.status).toBe("applied");
  expect(t.host.ports.get(ToolServicePortKey)).toBeDefined();
});
