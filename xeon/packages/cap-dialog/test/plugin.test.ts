import { describe, expect, test } from "bun:test";
import { ok, type Result } from "@xeon/contracts";
import {
  DialogAskKey,
  DialogAttachmentsKey,
  DialogCommandsKey,
  DialogStatusKey,
  WorkspaceImagesKey,
  type CapabilityApi,
  type DialogAsk,
  type DialogAttachments,
  type DialogCommands,
  type DialogStatus,
} from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { OsTime } from "@xeon/contracts/services";
import { defineManifest, validateManifest, type PortKey } from "@xeon/contracts/extensions";
import type {
  CommitBatch,
  DurableEventEnvelope,
  ReadFailure,
  VolatileEventEnvelope,
} from "@xeon/contracts/records";
import { hostOf, type ExtensionUnit } from "@xeon/ext-host";
import { createTestHost, fixedIdFactory } from "@xeon/ext-host/testing";
import { DIALOG_EXTENSION_NAME, dialogManifest } from "../src/manifest.ts";
import { dialogPlugin } from "../src/plugin.ts";
import { DIALOG_SETTING_DEFS } from "../src/settings.ts";
import { fakeApprovals } from "./support/fake-approvals.ts";
import {
  callOptions,
  fakeShell,
  memoryFiles,
  recordingLogger,
  type LogLine,
  type MemoryFiles,
} from "./support/harness.ts";
import { fakeImages, memoryBlobs, pngBytes, type MemoryBlobs } from "./support/images.ts";
import { memoryCommandFiles, type MemoryCommandFiles } from "./support/memory-command-files.ts";
import { manualTimers } from "./support/timers.ts";

// 플러그인 조립: L0·L1 포트를 가짜로 제공하고 실제 ExtHost에 올려 능력, 지점 핸들러, 피드 구독을 확인한다.

const ids = fixedIdFactory(100);

interface FakeFeed {
  headSeq(): Result<number, ReadFailure>;
  oldestReplayableSeq(): number;
  read(): Result<{ events: DurableEventEnvelope[]; scannedTo: number }, ReadFailure>;
  onCommit(): () => void;
  onVolatile(): () => void;
}
interface FakeQuery {
  thread(threadId: ThreadId): Result<{ workspace: string | undefined } | undefined, ReadFailure>;
}
type SubscribeFn = (
  afterSeq: number,
  listener: (batch: CommitBatch) => void,
  filter?: { kindPrefixes?: readonly string[] },
) => Result<() => void, ReadFailure>;
interface FakeOs {
  readonly dirs: { readonly home: string };
  readonly time: Pick<OsTime, "clock" | "scheduler" | "random">;
  logger(component: string): ReturnType<typeof recordingLogger>;
}
type FakeExec = MemoryCommandFiles & MemoryFiles & { readonly cwd: string };

const ExecKey: PortKey<FakeExec> = { name: "xeon.exec" };
const OsKey: PortKey<FakeOs> = { name: "xeon.os" };
const StoreKey: PortKey<MemoryBlobs> = { name: "xeon.store" };
const FeedKey: PortKey<FakeFeed> = { name: "xeon.session", member: "feed" };
const QueryKey: PortKey<FakeQuery> = { name: "xeon.session", member: "query" };
const SubscribeKey: PortKey<SubscribeFn> = { name: "xeon.session", member: "subscribe" };
const EmitKey: PortKey<(event: VolatileEventEnvelope) => void> = {
  name: "xeon.session",
  member: "emitVolatile",
};

interface Collected {
  readonly volatile: VolatileEventEnvelope[];
  readonly subscribed: { afterSeq: number; kindPrefixes: readonly string[] | undefined }[];
  listener: ((batch: CommitBatch) => void) | undefined;
}

async function boot(options: { session?: boolean; store?: boolean; approvals?: boolean } = {}) {
  const t = await createTestHost({ without: ["records"] });
  const timers = manualTimers();
  const lines: LogLine[] = [];
  const commandFiles = memoryCommandFiles({
    "/work/.xeon/commands/hello.md": "---\ndescription: 인사\n---\n안녕 $1",
    "/work/.xeon/commands/shell.md": "x !{echo hi}",
  });
  const files = memoryFiles();
  const blobs = memoryBlobs();
  const approvals = fakeApprovals();
  const collected: Collected = { volatile: [], subscribed: [], listener: undefined };
  const exec: FakeExec = { ...commandFiles, ...files, cwd: "/work" };
  const workspace: Record<string, string> = {};

  await t.host.registerPlatform({
    name: "fake-l0",
    setup(ctx) {
      ctx.providePort(ExecKey, exec);
      ctx.providePort(OsKey, {
        dirs: { home: "/home/user" },
        time: { clock: timers.clock, scheduler: timers.scheduler, random: () => 0.5 },
        logger: () => recordingLogger(lines),
      });
      if (options.store !== false) ctx.providePort(StoreKey, blobs);
      if (options.session !== false) {
        ctx.providePort(FeedKey, {
          headSeq: () => ok(10),
          oldestReplayableSeq: () => 0,
          read: () => ok({ events: [], scannedTo: 0 }),
          onCommit: () => () => undefined,
          onVolatile: () => () => undefined,
        });
        ctx.providePort(QueryKey, {
          thread: (threadId) => ok({ workspace: workspace[threadId] }),
        });
        ctx.providePort(SubscribeKey, (afterSeq, listener, filter) => {
          collected.subscribed.push({ afterSeq, kindPrefixes: filter?.kindPrefixes });
          collected.listener = listener;
          return ok(() => {
            collected.listener = undefined;
          });
        });
        ctx.providePort(EmitKey, (event) => {
          collected.volatile.push(event);
        });
      }
    },
  });

  // workspace.images 제공자(cap-workspace 대역)
  const images = fakeImages(blobs);
  const provider: ExtensionUnit = {
    manifest: defineManifest({
      schemaVersion: 1,
      name: "fake-workspace",
      version: "0.1.0",
      layer: "L2",
      kind: "plugin",
      entry: "./src/index.ts",
      provides: [{ id: "workspace.images", version: "1.0.0" }],
      points: [],
      usesDrive: false,
    }),
    entry: ({ manifest, scope }) => {
      scope(manifest.name, {}, (g) => {
        hostOf(g).provide(WorkspaceImagesKey, {
          register: images.register,
          load: () => Promise.reject(new Error("not used")),
          resize: () => Promise.reject(new Error("not used")),
        });
      });
    },
    loadIndex: 0,
    builtin: true,
  };
  await t.host.install(provider);
  await t.settled();

  const shell = fakeShell();
  const installed = await t.host.install(
    dialogPlugin({
      settings: { layers: () => [] },
      ids,
      ...(options.approvals === false ? {} : { approvals: approvals.factory }),
      shell,
      loadIndex: 1,
    }),
  );
  await t.settled();
  return {
    t,
    timers,
    lines,
    installed,
    files,
    blobs,
    approvals,
    collected,
    shell,
    workspace,
    images,
  };
}

interface Apis {
  ask?: CapabilityApi<typeof DialogAsk>;
  commands?: CapabilityApi<typeof DialogCommands>;
  status?: CapabilityApi<typeof DialogStatus>;
  attachments?: CapabilityApi<typeof DialogAttachments>;
}

function consumer(): { apis: Apis; unit: ExtensionUnit } {
  const apis: Apis = {};
  const unit: ExtensionUnit = {
    manifest: defineManifest({
      schemaVersion: 1,
      name: "dialog-consumer",
      version: "0.1.0",
      layer: "L3",
      kind: "plugin",
      entry: "./src/index.ts",
      requires: [
        { id: "dialog.ask", range: "^1.0.0" },
        { id: "dialog.commands", range: "^1.0.0" },
        { id: "dialog.status", range: "^1.0.0" },
        { id: "dialog.attachments", range: "^1.0.0" },
      ],
      points: [],
      usesDrive: false,
    }),
    entry: ({ manifest, scope }) => {
      scope(manifest.name, {}, (g) => {
        apis.ask = g.capability(DialogAskKey);
        apis.commands = g.capability(DialogCommandsKey);
        apis.status = g.capability(DialogStatusKey);
        apis.attachments = g.capability(DialogAttachmentsKey);
      });
    },
    loadIndex: 2,
    builtin: false,
  };
  return { apis, unit };
}

describe("manifest", () => {
  test("매니페스트가 validateManifest를 통과하고 M2 능력 넷을 제공한다", () => {
    const checked = validateManifest(dialogManifest());
    expect(checked.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    const manifest = checked.manifest;
    expect(manifest?.name).toBe(DIALOG_EXTENSION_NAME);
    expect(manifest?.layer).toBe("L2");
    expect(manifest?.provides?.map((entry) => entry.id)).toEqual([
      "dialog.ask",
      "dialog.commands",
      "dialog.status",
      "dialog.attachments",
    ]);
    expect(manifest?.requires).toEqual([{ id: "workspace.images", range: "^1.0.0" }]);
    expect(manifest?.points).toEqual([
      "input",
      "tool_execution_start",
      "tool_execution_end",
      "before_agent_start",
    ]);
    expect(manifest?.usesPost).toBe(false);
    expect(manifest?.usesDrive).toBe(false);
  });
});

describe("plugin", () => {
  test("설치하면 능력 넷이 제공되고 소비자가 부를 수 있다", async () => {
    const { t, installed, approvals } = await boot();
    expect(installed.setups[0]?.status).toBe("applied");
    expect(installed.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    const { apis, unit } = consumer();
    const result = await t.host.install(unit);
    expect(result.setups[0]?.status).toBe("applied");
    await t.settled();

    const thread = t.newThread();
    const asked = await apis.ask?.ask(
      { questions: [{ id: "q", question: "?" }] },
      callOptions(thread, { requestId: "call-1" }),
    );
    expect(asked?.status).toBe("input_required");
    expect(approvals.entries()).toHaveLength(1);
    const listed = await apis.commands?.list({}, callOptions(thread));
    expect(listed?.commands.map((command) => command.name)).toEqual(["hello", "shell"]);
  });

  test("입력 지점은 셸 없는 템플릿 명령만 치환한다", async () => {
    const { t } = await boot();
    const thread = t.newThread();
    await t.host.openThread(thread);
    const dispatch = (text: string) =>
      t.host.dispatch(
        "input",
        { text, source: "interactive" },
        { threadId: thread, dispatchKey: `k:${text}`, initial: { text, handled: false } },
      );
    expect(await dispatch("/hello 철수")).toMatchObject({ value: { text: "안녕 철수" } });
    expect(await dispatch("/shell")).toMatchObject({ value: { text: "/shell" } });
    expect(await dispatch("그냥 문장")).toMatchObject({ value: { text: "그냥 문장" } });
  });

  test("before_agent_start는 명령 목록을 시스템 프롬프트 뒤에 붙인다", async () => {
    const { t } = await boot();
    const thread = t.newThread();
    await t.host.openThread(thread);
    const out = await t.host.dispatch(
      "before_agent_start",
      { prompt: "hi", systemPrompt: "BASE", systemPromptOptions: {} },
      {
        threadId: thread,
        dispatchKey: "k",
        initial: { messages: [], systemPrompt: "BASE" },
      },
    );
    const prompt = out.value.systemPrompt;
    expect(prompt.startsWith("BASE\n\n")).toBe(true);
    expect(prompt).toContain("- /hello: 인사");
  });

  test("도구 실행 지점이 core.tools를 채우고 지운다", async () => {
    const { t, timers, collected } = await boot();
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    const thread = t.newThread();
    await t.host.openThread(thread);
    await t.host.dispatch(
      "tool_execution_start",
      { toolCallId: "c1", toolName: "bash", args: {} },
      { threadId: thread, dispatchKey: "s" },
    );
    const during = await apis.status?.list({}, callOptions(thread));
    expect(during?.items.map((item) => `${item.id}=${item.text}`)).toEqual(["core.tools=bash"]);
    await timers.advance(100);
    expect(collected.volatile).toHaveLength(1);
    expect(collected.volatile[0]).toMatchObject({
      kind: "dialog.status",
      durable: false,
      afterSeq: 10,
    });
    await t.host.dispatch(
      "tool_execution_end",
      { toolCallId: "c1", toolName: "bash", result: null, isError: false },
      { threadId: thread, dispatchKey: "e" },
    );
    expect((await apis.status?.list({}, callOptions(thread)))?.items).toEqual([]);
  });

  test("피드 구독은 설치 때 한 번이고 턴 이벤트가 core.turn을 채운다", async () => {
    const { t, collected, timers } = await boot();
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    expect(collected.subscribed).toEqual([{ afterSeq: 10, kindPrefixes: ["turn.", "approval."] }]);
    const thread = t.newThread();
    const event: DurableEventEnvelope = {
      id: ids.next("evt"),
      kind: "turn.started",
      version: 1,
      threadId: thread,
      turnId: null,
      stepId: null,
      recordedAt: 1,
      causationId: null,
      correlationId: null,
      payload: {},
      durable: true,
      seq: 11,
      parentId: null,
    };
    collected.listener?.({ firstSeq: 11, lastSeq: 11, events: [event] });
    await timers.advance(100);
    expect((await apis.status?.list({}, callOptions(thread)))?.items).toMatchObject([
      { id: "core.turn", text: "실행 중" },
    ]);
    expect(collected.volatile).toHaveLength(1);
  });

  test("제거하면 구독과 타이머가 정리된다", async () => {
    const { t, collected, timers } = await boot();
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    const thread = t.newThread();
    await apis.status?.setItem({ id: "g.x", text: "x" }, callOptions(thread));
    expect(timers.pending()).toBe(1);
    await t.host.uninstall(DIALOG_EXTENSION_NAME);
    await t.settled();
    expect(collected.listener).toBeUndefined();
    expect(timers.pending()).toBe(0);
  });

  test("첨부는 workspace.images와 blob 저장소를 거친다", async () => {
    const { t, files, images, blobs } = await boot();
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    files.put("/work/a.png", pngBytes(4, 3, 64));
    const { attachment } =
      (await apis.attachments?.add({ source: { kind: "path", path: "/work/a.png" } })) ?? {};
    expect(attachment).toMatchObject({ kind: "image", name: "a.png" });
    expect(images.calls).toHaveLength(1);
    expect(blobs.stored.size).toBe(1);
  });

  test("승인 팩토리가 없으면 경고를 남기고 ask는 unavailable이다", async () => {
    const { t, lines } = await boot({ approvals: false });
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    expect(lines.map((line) => line.event)).toContain("dialog.approvals_missing");
    const thread = t.newThread();
    const failure = await apis.ask
      ?.ask({ questions: [{ id: "q", question: "?" }] }, callOptions(thread, { requestId: "r" }))
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );
    expect(failure).toMatchObject({ data: { code: "unavailable" } });
  });

  test("세션과 저장소가 없으면 경고를 남기고 상태 이벤트와 첨부 저장이 빠진다", async () => {
    const { t, lines, collected } = await boot({ session: false, store: false });
    const events = lines.map((line) => line.event);
    expect(events).toContain("dialog.session_missing");
    expect(events).toContain("dialog.store_missing");
    expect(collected.subscribed).toEqual([]);
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    const thread = t.newThread();
    await apis.status?.setItem({ id: "g.x", text: "x" }, callOptions(thread));
    expect((await apis.status?.list({}, callOptions(thread)))?.items).toHaveLength(1);
  });
});

describe("설정 정의", () => {
  test("키 13개가 모두 선언되어 있다", () => {
    expect(DIALOG_SETTING_DEFS).toHaveLength(13);
  });
});
