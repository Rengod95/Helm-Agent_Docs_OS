import { afterEach, describe, expect, test } from "bun:test";
import { Bug, repeatAsync } from "@xeon/contracts";
import type { AssistantMessage } from "@xeon/contracts/conversation";
import type { PortKey } from "@xeon/contracts/extensions";
import {
  ApprovalServicePortKey,
  ToolServicePortKey,
  type ApprovalService,
  type Redactor,
  type ToolService,
} from "@xeon/contracts/services";
import { toolsPlugin } from "@xeon/core-tools";
import {
  fakeRedactor,
  fakeRunContext,
  fakeSession,
  fakeStore,
  fakeTruncator,
  sequentialIds,
} from "@xeon/core-tools/testing";
import { createTestHost } from "@xeon/ext-host/testing";
import { createToolServiceRegistrar } from "../src/client/register.ts";
import { wrapUntrustedMcp } from "@xeon/contracts/capabilities";
import type { ScopeStack } from "@xeon/contracts/settings";
import type { StubCall, StubOutcome } from "../src/testing/stub-server.ts";
import { layer } from "./support/layers.ts";
import { buildWorld, startWorld, type World } from "./support/world.ts";

// MCP.4 (E6): 연결된 서버의 도구가 실제 core-tools `ToolService`의 광고 목록에 단계 경계에서 나타난다.
// ToolService는 core-tools 내장 확장(`toolsPlugin`)을 테스트 호스트에 올려 얻고, 동적 도구는 조립이 쓸 `createToolServiceRegistrar`로 등록한다.

const NOW = 1_767_571_200_000;

/** 광고와 실행에는 태스크 노드가 필요 없다. 턴 노드를 찾지 못하면 core-tools는 노드 없이 실행한다 */
interface NoTasks {
  find(): undefined;
}

const SessionKey: PortKey<ReturnType<typeof fakeSession>> = { name: "xeon.session" };
const StoreKey: PortKey<ReturnType<typeof fakeStore>> = { name: "xeon.store" };
const TasksKey: PortKey<NoTasks> = { name: "xeon.tasks" };
const SecretsKey: PortKey<{ readonly redactor: Redactor }> = { name: "xeon.secrets" };

interface FakeExec {
  readonly id: string;
  canonicalPath(path: string): Promise<{ ok: true; value: string }>;
  absolutePath(path: string): Promise<{ ok: true; value: string }>;
  truncateHead: ReturnType<typeof fakeTruncator>["truncateHead"];
  formatSize: ReturnType<typeof fakeTruncator>["formatSize"];
}
const ExecKey: PortKey<FakeExec> = { name: "xeon.exec" };

async function bootTools() {
  const t = await createTestHost({ without: ["records", "queue", "loop"] });
  const clock = { now: () => NOW };
  const ids = sequentialIds(5000);
  const session = fakeSession({ clock, ids });
  const truncator = fakeTruncator();
  await t.host.registerPlatform({
    name: "fake-l0",
    setup(ctx) {
      ctx.providePort(SessionKey, session);
      ctx.providePort(StoreKey, fakeStore());
      ctx.providePort(TasksKey, { find: () => undefined });
      ctx.providePort(ExecKey, {
        id: "env1",
        canonicalPath: (path) => Promise.resolve({ ok: true, value: path }),
        absolutePath: (path) => Promise.resolve({ ok: true, value: path }),
        truncateHead: (content, options) => truncator.truncateHead(content, options),
        formatSize: (bytes) => truncator.formatSize(bytes),
      });
      ctx.providePort(SecretsKey, { redactor: fakeRedactor() });
    },
  });
  await t.host.install(toolsPlugin({ clock, ids, settings: { layers: () => [] } }));
  const tools: ToolService | undefined = t.host.ports.get(ToolServicePortKey);
  if (tools === undefined) throw new Bug("test.tools_port_missing");
  const approvals: ApprovalService | undefined = t.host.ports.get(ApprovalServicePortKey);
  if (approvals === undefined) throw new Bug("test.approvals_port_missing");
  const thread = ids.next("thr");
  await t.host.openThread(thread);
  return { tools, approvals, session, ids, thread };
}

const ASSISTANT: AssistantMessage = {
  role: "assistant",
  content: [],
  api: "anthropic-messages",
  provider: "anthropic",
  model: "claude-x",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "toolUse",
  timestamp: NOW,
};

const TOOLS = [
  {
    name: "echo",
    description: "Echo text",
    inputSchema: { type: "object", properties: { text: { type: "string" } } },
    annotations: { readOnlyHint: true },
  },
  { name: "add", description: "Add numbers", annotations: { readOnlyHint: true } },
];

const worlds: World[] = [];

afterEach(async () => {
  await Promise.all(worlds.splice(0).map((world) => world.runtime.shutdown()));
});

async function connect(tools: ToolService, def: { tools?: { deny: string[] } } = {}) {
  const world = buildWorld({
    servers: {
      stub: { stub: { era: "modern", tools: TOOLS }, def: { trustAnnotations: true, ...def } },
    },
    overrides: { tools: createToolServiceRegistrar(tools) },
  });
  worlds.push(world);
  await startWorld(world);
  return world;
}

async function advertisedNames(
  tools: ToolService,
  thread: Awaited<ReturnType<typeof bootTools>>["thread"],
): Promise<string[]> {
  const toolset = await tools.advertise({
    run: { threadId: thread, caller: "main", depth: 0 },
    activated: new Set(),
  });
  if (!toolset.ok) throw new Bug("test.advertise_failed");
  return toolset.value.tools
    .map((tool) => tool.name)
    .filter((name) => name === "echo" || name === "add")
    .toSorted();
}

describe("MCP tools in the real ToolService", () => {
  test("exposes tools at next step boundary: connecting alone leaves the advertised set unchanged", async () => {
    const { tools, thread } = await bootTools();
    const world = await connect(tools);
    expect(await advertisedNames(tools, thread)).toEqual([]);
    const report = await world.runtime.applyBoundary();
    expect(report.toolsAdded.toSorted()).toEqual(["add", "echo"]);
    expect(await advertisedNames(tools, thread)).toEqual(["add", "echo"]);
    const meta = tools.meta("echo");
    expect(meta?.ref).toEqual({ capability: "mcp.stub", name: "echo" });
    expect(meta?.mcpServer).toBe("stub");
    expect(meta?.risk).toBe("read");
  });

  test("a denied tool never reaches the advertised set, and a dropped server leaves it at the next boundary", async () => {
    const { tools, thread } = await bootTools();
    const world = await connect(tools, { tools: { deny: ["add"] } });
    await world.runtime.applyBoundary();
    expect(await advertisedNames(tools, thread)).toEqual(["echo"]);
    await world.runtime.shutdown();
    await world.runtime.applyBoundary();
    expect(await advertisedNames(tools, thread)).toEqual([]);
  });

  test("a call goes through prepare and execute and the text is wrapped as untrusted", async () => {
    const { tools, session, ids, thread } = await bootTools();
    const world = await connect(tools);
    await world.runtime.applyBoundary();
    const run = fakeRunContext({ session, ids, threadId: thread });
    const prepared = await tools.prepare(
      { type: "toolCall", id: "mcp_1", name: "echo", arguments: { text: "hi" } },
      ASSISTANT,
      run,
    );
    if (prepared.kind === "settled") throw new Bug("test.call_settled");
    const outcome = await tools.execute(prepared.call, () => {}, run);
    expect(outcome.isError).toBe(false);
    const first = outcome.result.content[0];
    expect(first?.type === "text" ? first.text : "").toBe(wrapUntrustedMcp("stub", "ok echo"));
  });

  test("an input_required result of a dynamic tool raises a kind question approval and the retry carries the continuation", async () => {
    const { tools, approvals, session, ids, thread } = await bootTools();
    const seen: StubCall[] = [];
    const world = buildWorld({
      servers: {
        stub: {
          stub: {
            era: "modern",
            tools: [
              {
                name: "ask",
                description: "Asks one question",
                annotations: { readOnlyHint: true },
                handle: (call: StubCall): StubOutcome => {
                  seen.push(call);
                  return call.inputResponses === undefined
                    ? {
                        kind: "input_required",
                        inputRequests: {
                          q1: {
                            method: "elicitation/create",
                            params: {
                              mode: "form",
                              message: "Who are you?",
                              requestedSchema: {
                                type: "object",
                                properties: { name: { type: "string" } },
                                required: ["name"],
                              },
                            },
                          },
                        },
                        requestState: "state-1",
                      }
                    : {
                        kind: "complete",
                        content: [{ type: "text", text: JSON.stringify(call.inputResponses) }],
                      };
                },
              },
            ],
          },
          def: { trustAnnotations: true },
        },
      },
      overrides: { tools: createToolServiceRegistrar(tools) },
    });
    worlds.push(world);
    await startWorld(world);
    await world.runtime.applyBoundary();

    const run = fakeRunContext({ session, ids, threadId: thread });
    const prepared = await tools.prepare(
      { type: "toolCall", id: "mcp_ask", name: "ask", arguments: {} },
      ASSISTANT,
      run,
    );
    if (prepared.kind === "settled") throw new Bug("test.call_settled");
    const executing = tools.execute(prepared.call, () => {}, run);
    const request = await repeatAsync(() => {
      const [first] = approvals.pending(thread);
      return Promise.resolve(first === undefined ? undefined : { value: first });
    });
    expect(request.body.kind).toBe("question");
    expect(request.origin.toolCallId).toBe("mcp_ask");
    expect(
      await approvals.respond(request.approvalId, {
        decision: "answer",
        answer: { q1: { selected: [], text: "Ada" } },
      }),
    ).toEqual({ applied: true });
    const outcome = await executing;
    expect(outcome.isError).toBe(false);
    expect(seen.map((call) => call.inputResponses)).toEqual([
      undefined,
      { q1: { action: "accept", content: { name: "Ada" } } },
    ]);
    expect(seen[1]?.requestState).toBe("state-1");
    const first = outcome.result.content[0];
    expect(first?.type === "text" ? first.text : "").toContain("Ada");
  });

  test("a direct call reads the settings of the thread it runs in", async () => {
    const { tools, session, ids, thread } = await bootTools();
    // 세션 층의 결과 크기 상한은 그 thread의 호출에만 적용된다
    let base: ScopeStack = [];
    const source = {
      layers: (threadId: string | undefined): ScopeStack =>
        threadId === thread
          ? [...base, layer("session", { "l2.mcp.result.maxBytes": 1024 })]
          : base,
    };
    const world = buildWorld({
      servers: {
        stub: {
          stub: {
            era: "modern",
            tools: [
              {
                name: "big",
                description: "Long text",
                annotations: { readOnlyHint: true },
                handle: (): StubOutcome => ({
                  kind: "complete",
                  content: [{ type: "text", text: "x".repeat(5000) }],
                }),
              },
            ],
          },
          def: { trustAnnotations: true },
        },
      },
      overrides: { tools: createToolServiceRegistrar(tools), settings: source },
    });
    base = world.settings.layers(undefined);
    worlds.push(world);
    await startWorld(world);
    await world.runtime.applyBoundary();
    const run = fakeRunContext({ session, ids, threadId: thread });
    const prepared = await tools.prepare(
      { type: "toolCall", id: "mcp_big", name: "big", arguments: {} },
      ASSISTANT,
      run,
    );
    if (prepared.kind === "settled") throw new Bug("test.call_settled");
    const outcome = await tools.execute(prepared.call, () => {}, run);
    expect(outcome.isError).toBe(false);
    const text = outcome.result.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
    expect(text.length).toBeLessThan(2500);
    expect(text).toContain("xxx");
  });
});
