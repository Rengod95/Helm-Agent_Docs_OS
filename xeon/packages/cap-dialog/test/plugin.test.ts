import { describe, expect, test } from "bun:test";
import { eachAsync, ok, type Result } from "@xeon/contracts";
import {
  DIALOG_CAPABILITIES,
  WorkspaceImages,
  DialogAskKey,
  DialogAttachmentsKey,
  DialogCommandsKey,
  DialogNotify,
  DialogStatusKey,
  WorkspaceImagesKey,
  type CapabilityApi,
  type DialogAsk,
  type DialogAttachments,
  type DialogCommands,
  type DialogStatus,
  type Notice,
  type NoticeFeed,
  type ServiceKey,
} from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import { ApprovalServicePortKey, type OsTime } from "@xeon/contracts/services";
import { defineManifest, validateManifest, type PortKey } from "@xeon/contracts/extensions";
import type {
  CommitBatch,
  DurableEventEnvelope,
  ProducerHandle,
  ProducerId,
  ReadFailure,
  VolatileEventEnvelope,
} from "@xeon/contracts/records";
import { capabilityDefTable, hostOf, type ExtensionUnit } from "@xeon/ext-host";
import { createTestHost, fixedIdFactory } from "@xeon/ext-host/testing";
import { DIALOG_EXTENSION_NAME, dialogManifest } from "../src/manifest.ts";
import { dialogPlugin } from "../src/plugin.ts";
import { DIALOG_SETTING_DEFS } from "../src/settings.ts";
import { realApprovals } from "./support/real-approvals.ts";
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
import { turnCompleted } from "./support/notices.ts";

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
const ProducerKey: PortKey<(id: ProducerId) => ProducerHandle> = {
  name: "xeon.session",
  member: "producer",
};

interface Collected {
  readonly volatile: VolatileEventEnvelope[];
  readonly subscribed: { afterSeq: number; kindPrefixes: readonly string[] | undefined }[];
  listener: ((batch: CommitBatch) => void) | undefined;
}

async function boot(
  options: {
    session?: boolean;
    store?: boolean;
    approvals?: boolean;
    /** 프로젝트 신뢰 판정. 생략하면 모두 신뢰한다. null이면 옵션을 주지 않는다(fail-closed) */
    trust?: ((projectDir: string) => Promise<boolean>) | null;
    /** 기본 명령 파일에 더하는 파일 */
    extraCommands?: Record<string, string>;
  } = {},
) {
  // 능력 정의 표가 있어야 호스트가 정의의 메서드만 감싼다. 구독 같은 정의 밖 멤버는 그대로 넘긴다(조립 루트와 같다)
  const t = await createTestHost({
    without: ["records"],
    capabilityDefs: capabilityDefTable([...DIALOG_CAPABILITIES, WorkspaceImages]),
  });
  const timers = manualTimers();
  const lines: LogLine[] = [];
  const commandFiles = memoryCommandFiles({
    "/work/.xeon/commands/hello.md": "---\ndescription: 인사\n---\n안녕 $1",
    "/work/.xeon/commands/shell.md": "x !{echo hi}",
    ...options.extraCommands,
  });
  const files = memoryFiles();
  const blobs = memoryBlobs();
  const approvals = await realApprovals();
  const collected: Collected = { volatile: [], subscribed: [], listener: undefined };
  const exec: FakeExec = { ...commandFiles, ...files, cwd: "/work" };
  // 항목이 없는 대화는 엔진 cwd와 같은 `/work`를 작업 폴더로 가진다. undefined를 넣으면 작업 폴더가 없는 대화다
  const workspace: Record<string, string | undefined> = {};

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
      // 승인은 실제 core-tools 서비스다. 플러그인이 이 포트를 `questionApprovalsOver`로 감싸 쓴다
      if (options.approvals !== false)
        ctx.providePort(ApprovalServicePortKey, approvals.l1.approvals);
      if (options.session !== false) {
        ctx.providePort(FeedKey, {
          headSeq: () => ok(10),
          oldestReplayableSeq: () => 0,
          read: () => ok({ events: [], scannedTo: 0 }),
          onCommit: () => () => undefined,
          onVolatile: () => () => undefined,
        });
        ctx.providePort(QueryKey, {
          thread: (threadId) =>
            ok({ workspace: threadId in workspace ? workspace[threadId] : "/work" }),
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
        // emit의 커밋 경로는 이 시험의 대상이 아니다(notify-service·session-adapter 시험). 생산자는 받을 수만 있으면 된다
        ctx.providePort(ProducerKey, (id) => ({
          producer: id,
          draft: () => {
            throw new Error("not used");
          },
        }));
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
      shell,
      ...(options.trust === null
        ? {}
        : { projectTrust: options.trust ?? (() => Promise.resolve(true)) }),
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
  notify?: CapabilityApi<typeof DialogNotify> & NoticeFeed;
}

/** 구독까지 보이는 알림 능력 키(런타임 키는 DialogNotifyKey와 같다) */
const NotifyFeedKey: ServiceKey<CapabilityApi<typeof DialogNotify> & NoticeFeed> = {
  capability: DialogNotify.id,
  version: DialogNotify.version,
};

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
        { id: "dialog.notify", range: "^1.0.0" },
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
        apis.notify = g.capability(NotifyFeedKey);
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
      "dialog.notify",
    ]);
    expect(manifest?.requires).toEqual([{ id: "workspace.images", range: "^1.0.0" }]);
    expect(manifest?.points).toEqual([
      "input.user.before",
      "tool.execution.before",
      "tool.execution.after",
      "input.agent.before",
    ]);
    expect(manifest?.usesPost).toBe(false);
    expect(manifest?.usesDrive).toBe(false);
  });
});

const failingTrust = (): Promise<boolean> => Promise.reject(new Error("store unreadable"));

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

  test("프로젝트 신뢰가 없으면 .xeon/commands를 읽지 않고 한 번 경고한다 (G1-03)", async () => {
    const { t, lines } = await boot({ trust: () => Promise.resolve(false) });
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    const thread = t.newThread();
    expect((await apis.commands?.list({}, callOptions(thread)))?.commands).toEqual([]);
    expect((await apis.commands?.list({}, callOptions(thread)))?.commands).toEqual([]);
    const expand = await apis.commands?.expand({ text: "/hello 철수" }, callOptions(thread));
    expect(expand).toEqual({ matched: false });
    const warned = lines.filter((line) => line.event === "dialog.project_commands_untrusted");
    expect(warned.map((line) => line.fields)).toEqual([
      { projectDir: "/work", reason: "not_trusted" },
    ]);
  });

  test("판정 콜백이 없거나 실패하면 신뢰하지 않은 것으로 본다 (G1-03)", async () => {
    await eachAsync([null, failingTrust] as const, async (trust) => {
      const { t } = await boot({ trust });
      const { apis, unit } = consumer();
      await t.host.install(unit);
      await t.settled();
      const listed = await apis.commands?.list({}, callOptions(t.newThread()));
      expect(listed?.commands).toEqual([]);
      return undefined;
    });
  });

  test("신뢰는 대화의 작업 폴더로 묻고, 작업 폴더가 없는 대화는 엔진 cwd로 내려가지 않는다 (G2-02)", async () => {
    const asked: string[] = [];
    const { t, workspace } = await boot({
      trust: (dir) => {
        asked.push(dir);
        return Promise.resolve(true);
      },
      extraCommands: { "/other/.xeon/commands/elsewhere.md": "다른 폴더 명령" },
    });
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    const other = t.newThread();
    workspace[other] = "/other";
    const bare = t.newThread();
    workspace[bare] = undefined;

    const inOther = await apis.commands?.list({}, callOptions(other));
    expect(inOther?.commands.map((command) => [command.name, command.source])).toEqual([
      ["elsewhere", "project"],
    ]);
    expect(asked).toEqual(["/other"]);
    const withoutWorkspace = await apis.commands?.list({}, callOptions(bare));
    expect(withoutWorkspace?.commands).toEqual([]);
    // 작업 폴더가 없는 대화는 신뢰를 묻지도 않는다
    expect(asked).toEqual(["/other"]);
  });

  test("입력 지점은 셸 없는 템플릿 명령만 치환한다", async () => {
    const { t } = await boot();
    const thread = t.newThread();
    await t.host.openThread(thread);
    const dispatch = (text: string) =>
      t.host.dispatch(
        "input.user.before",
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
      "input.agent.before",
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
      "tool.execution.before",
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
      "tool.execution.after",
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
    expect(collected.subscribed).toEqual([
      {
        afterSeq: 10,
        kindPrefixes: ["turn.", "approval.", "work.", "agent.", "schedule.", "dialog."],
      },
    ]);
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

  test("dialog.notify를 제공하고 피드의 완료 턴을 구독자에게 알린다", async () => {
    const { t, collected } = await boot();
    const { apis, unit } = consumer();
    const result = await t.host.install(unit);
    expect(result.setups[0]?.status).toBe("applied");
    await t.settled();
    const thread = t.newThread();
    const got: Notice[] = [];
    apis.notify?.subscribe({ kinds: ["completed"] }, (_threadId, notice) => {
      got.push(notice);
    });
    collected.listener?.({
      firstSeq: 11,
      lastSeq: 11,
      events: [
        {
          id: ids.next("evt"),
          kind: "turn.completed",
          version: 1,
          threadId: thread,
          turnId: null,
          stepId: null,
          recordedAt: 1,
          causationId: null,
          correlationId: null,
          payload: turnCompleted("completed"),
          durable: true,
          seq: 11,
          parentId: null,
        },
      ],
    });
    expect(got).toEqual([
      {
        kind: "completed",
        title: "작업이 끝났다",
        body: null,
        seq: 11,
        sourceType: "turn.completed",
      },
    ]);
    // 저장소 읽기는 피드 대역(빈 로그)을 거친다. list는 알림을 만들지 않고 nextSeq를 0으로 돌려준다
    expect(await apis.notify?.list({ afterSeq: 0 }, callOptions(thread))).toEqual({
      notices: [],
      nextSeq: 0,
    });
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
