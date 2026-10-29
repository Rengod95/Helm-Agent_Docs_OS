import { expect, test } from "bun:test";
import { ok } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import { ToolsPortKey, type ScopeApi, type ToolResourceDef } from "@xeon/contracts/extensions";
import { Type } from "typebox";
import { hostOf, PrimitiveError } from "../../src/primitives/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { makeUnit, snapshotOf } from "./fixtures/support.ts";

// X.primitives.spec §4.6.6. 도구 execute와 명령 처리기의 ambient. 디스패치 키는 호출 id다(M3-REQ-102)

const CounterSchema = Type.Object({ n: Type.Integer({ minimum: 0 }) });
const notePayloadSchema: Record<string, unknown> = {
  type: "object",
  properties: { text: { type: "string" } },
  required: ["text"],
  additionalProperties: false,
};

type Host = Awaited<ReturnType<typeof createTestHost>>;

interface Setup {
  readonly t: Host;
  readonly tools: Map<string, ToolResourceDef>;
}

async function work(
  g: ScopeApi<{ n: number }>,
  threadId: ThreadId,
  text: string,
): Promise<{ n: number }> {
  const before = g.state();
  await g.recordPrivate("grp.direct.queue.added", { text });
  await g.record("grp.direct.note.recorded", { type: "thread", id: threadId }, { text });
  await g.commit({ n: before.n + 1 });
  return g.state();
}

/** 그룹 하나가 도구 `probe`와 명령 `probe`를 등록한다. 둘 다 비공개 기록, 공개 레코드, 상태 커밋을 한 번씩 한다 */
async function boot(): Promise<Setup> {
  const t = await createTestHost();
  const tools = new Map<string, ToolResourceDef>();
  await t.host.registerPlatform({
    name: "test-tools-port",
    setup(ctx) {
      ctx.providePort(ToolsPortKey, {
        register(_owner, def) {
          tools.set(def.name, def);
          return ok(() => {
            tools.delete(def.name);
          });
        },
      });
    },
  });
  await t.host.install(
    makeUnit(
      {
        name: "direct",
        kind: "group",
        recordKinds: [
          {
            kind: "grp.direct.note.recorded",
            version: 1,
            description: "note",
            payload: notePayloadSchema,
          },
        ],
        def: { state: { schema: CounterSchema, initial: { n: 0 }, version: 1 } },
      },
      (g) => {
        const host = hostOf(g);
        host.registerTool({
          name: "probe",
          description: "probe",
          parameters: Type.Object({}),
          replay: "unsafe",
          execute: async (_args, ctx) => work(g, ctx.threadId, `tool:${ctx.toolCallId}`),
        });
        host.registerCommand("probe", {
          handler: async (args, ctx) => {
            if (ctx.threadId === null) {
              g.state();
              return;
            }
            await work(g, ctx.threadId, `cmd:${args}`);
          },
        });
      },
    ),
  );
  return { t, tools };
}

function runTool(setup: Setup, threadId: ThreadId, toolCallId: string): Promise<unknown> {
  const def = setup.tools.get("probe");
  if (def === undefined) throw new Error("tool probe is not registered");
  return def.execute(
    {},
    {
      threadId,
      signal: new AbortController().signal,
      toolCallId,
      caller: { kind: "model", agent: "main" },
    },
  );
}

/** 등록된 명령의 처리기를 L4처럼 부른다. 정의는 `unknown`으로 보관되므로 모양을 확인한다 */
function runCommand(
  setup: Setup,
  threadId: ThreadId | null,
  invocationId: string,
  args: string,
): Promise<void> {
  const def = setup.t.host.resources.list("command")[0]?.def;
  if (typeof def !== "object" || def === null || !("handler" in def)) {
    throw new Error("command probe is not registered");
  }
  const handler = def.handler;
  if (typeof handler !== "function") throw new Error("command handler is not a function");
  return Promise.resolve(
    handler.call(def, args, { threadId, invocationId, signal: new AbortController().signal }),
  );
}

function kindsOf(t: Host, threadId: ThreadId): string[] {
  return t.records
    .events(threadId)
    .map((event) => event.kind)
    .filter((kind) => kind.startsWith("grp.direct."));
}

const WRITES = ["grp.direct.queue.added", "grp.direct.note.recorded", "grp.direct.state.committed"];

async function docOf(t: Host, threadId: ThreadId): Promise<unknown> {
  const snapshot = await snapshotOf(t.records, threadId);
  return snapshot.states.find((state) => state.scopeId === "direct")?.doc;
}

test("a tool execute can recordPrivate, record, commit and read state", async () => {
  const setup = await boot();
  const thread = setup.t.newThread();
  await setup.t.host.openThread(thread);
  const returned = await runTool(setup, thread, "call-1");
  expect(returned).toEqual({ n: 1 });
  expect(kindsOf(setup.t, thread).length).toBe(3);
  expect(kindsOf(setup.t, thread).toSorted()).toEqual([...WRITES].toSorted());
  expect(await docOf(setup.t, thread)).toEqual({ n: 1 });
});

test("a command handler can recordPrivate, record, commit and read state", async () => {
  const setup = await boot();
  const thread = setup.t.newThread();
  await setup.t.host.openThread(thread);
  await runCommand(setup, thread, "cmd-1", "go");
  expect(kindsOf(setup.t, thread).toSorted()).toEqual([...WRITES].toSorted());
  expect(await docOf(setup.t, thread)).toEqual({ n: 1 });
});

test("rerunning a tool call with the same tool call id does not repeat its effects", async () => {
  const setup = await boot();
  const thread = setup.t.newThread();
  await setup.t.host.openThread(thread);
  await runTool(setup, thread, "call-1");
  await runTool(setup, thread, "call-1");
  expect(kindsOf(setup.t, thread)).toHaveLength(3);
  expect(await docOf(setup.t, thread)).toEqual({ n: 1 });
  // 다른 호출 id는 새 효과다
  await runTool(setup, thread, "call-2");
  expect(kindsOf(setup.t, thread)).toHaveLength(6);
  expect(await docOf(setup.t, thread)).toEqual({ n: 2 });
});

test("rerunning a command with the same invocation id does not repeat its effects", async () => {
  const setup = await boot();
  const thread = setup.t.newThread();
  await setup.t.host.openThread(thread);
  await runCommand(setup, thread, "cmd-1", "go");
  await runCommand(setup, thread, "cmd-1", "go");
  expect(kindsOf(setup.t, thread)).toHaveLength(3);
  await runCommand(setup, thread, "cmd-2", "go");
  expect(kindsOf(setup.t, thread)).toHaveLength(6);
  expect(await docOf(setup.t, thread)).toEqual({ n: 2 });
});

test("a tool call id and a command invocation id with the same text do not share keys", async () => {
  const setup = await boot();
  const thread = setup.t.newThread();
  await setup.t.host.openThread(thread);
  await runTool(setup, thread, "same");
  await runCommand(setup, thread, "same", "go");
  expect(kindsOf(setup.t, thread)).toHaveLength(6);
});

test("a tool run in a child conversation writes to that conversation only", async () => {
  const setup = await boot();
  const parent = setup.t.newThread();
  const child = setup.t.newThread();
  await setup.t.host.openThread(parent);
  await setup.t.host.openThread(child);
  await runTool(setup, child, "call-child");
  expect(kindsOf(setup.t, parent)).toEqual([]);
  expect(kindsOf(setup.t, child).toSorted()).toEqual([...WRITES].toSorted());
  expect(await docOf(setup.t, parent)).toBeUndefined();
  expect(await docOf(setup.t, child)).toEqual({ n: 1 });
});

test("without an open thread or a thread id the writes still fail with no_thread", async () => {
  const setup = await boot();
  const closed = setup.t.newThread();
  const toolError = await runTool(setup, closed, "call-1").catch((error: unknown) => error);
  expect(toolError).toBeInstanceOf(PrimitiveError);
  expect(toolError instanceof PrimitiveError ? toolError.code : undefined).toBe("no_thread");
  const commandError = await runCommand(setup, null, "cmd-1", "go").catch(
    (error: unknown) => error,
  );
  expect(commandError).toBeInstanceOf(PrimitiveError);
  expect(commandError instanceof PrimitiveError ? commandError.code : undefined).toBe("no_thread");
});
