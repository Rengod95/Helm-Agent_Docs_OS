import { expect, test } from "bun:test";
import { canonicalJson, type Logger } from "@fresnel/contracts";
import {
  defineManifest,
  type ContextTraceEvent,
  type ContextTraceSink,
  type ExtensionEntry,
} from "@fresnel/contracts/extensions";
import type { OrderedTool } from "@fresnel/contracts/capabilities";
import type { AdvertisedToolset } from "@fresnel/contracts/services";
import type { ExtensionUnit } from "@fresnel/ext-host";
import { Type } from "typebox";
import {
  advertisedFactOf,
  emitContextTrace,
  pluginOfCapability,
} from "../src/loop/context-trace.ts";
import { createHarness } from "./support/harness.ts";
import type { ScriptedResponse } from "./support/fake-models.ts";

// 조립 재료·광고 측정은 모델 요청을 바꾸지 않는다(정본 turn-record-metrics.md §4.1 규칙 7, AC-1).

const script: readonly ScriptedResponse[] = [
  {
    kind: "message",
    content: [
      { type: "text", text: "looking" },
      { type: "toolCall", id: "c1", name: "read", arguments: { path: "a" } },
      { type: "toolCall", id: "s1", name: "skill_view", arguments: { name: "deploy" } },
    ],
    stopReason: "toolUse",
  },
  { kind: "message", content: [{ type: "text", text: "all done" }], stopReason: "stop" },
];

const tools = [{ name: "read" }, { name: "skill_view" }];

/** 요청 본문(메시지, 도구 정의, 추론 옵션)의 직렬화. 바이트 비교에 쓴다 */
function bodiesOf(
  requests: ReadonlyArray<{
    readonly stepId: unknown;
    readonly messages: unknown;
    readonly tools: unknown;
    readonly reasoning: unknown;
    readonly thinkingBudgets: unknown;
  }>,
): string {
  return JSON.stringify(
    requests.map((request) => ({
      stepId: request.stepId,
      messages: request.messages,
      tools: request.tools,
      reasoning: request.reasoning,
      thinkingBudgets: request.thinkingBudgets,
    })),
  );
}

async function runWith(contextTrace: ContextTraceSink | undefined): Promise<{
  readonly bodies: string;
  readonly logs: readonly string[];
}> {
  const h = await createHarness({
    tools,
    script: [...script],
    ...(contextTrace === undefined ? {} : { contextTrace }),
  });
  await h.loop.admit({
    threadId: h.threadId,
    content: "go",
    via: "interactive",
    requestId: "req-1",
  });
  await h.settle();
  return {
    bodies: bodiesOf(h.models.requests),
    logs: h.logs.records.map((record) => record.event),
  };
}

test("request_bodies_are_byte_identical_with_the_trace_sink_on_and_off", async () => {
  const off = await runWith(undefined);
  const events: ContextTraceEvent[] = [];
  const on = await runWith({ record: (event) => events.push(event) });
  expect(off.bodies.length).toBeGreaterThan(200);
  expect(on.bodies).toBe(off.bodies);
  // 켠 쪽은 실제로 측정했다: 요청마다 조립 사실 한 줄, 스킬 읽기 한 줄
  expect(events.filter((event) => event.kind === "step_context").length).toBe(2);
  expect(
    events.flatMap((event) =>
      event.kind === "skill_read" ? [[event.name, event.toolCallId.startsWith("s1")]] : [],
    ),
  ).toEqual([["deploy", true]]);
});

/** `input.agent.before`에서 안내 한 줄을 기본 프롬프트 뒤에 더하는 확장. 안내의 출처가 하나로 정해지는 경우를 만든다 */
function promptAdditionOf(name: string, text: string): ExtensionUnit {
  const entry: ExtensionEntry = ({ manifest, register }) => {
    register(manifest.name, {}, (g) => {
      g.on("input.agent.before", (payload) => ({
        systemPrompt: `${payload.systemPrompt}\n\n${text}`,
      }));
    });
  };
  return {
    manifest: defineManifest({
      schemaVersion: 2,
      name,
      version: "0.1.0",
      entry: "./index.ts",
      plugins: [{ layer: "plugin", hooks: ["input.agent.before"] }],
    }),
    entry,
    loadIndex: 4,
    builtin: false,
  };
}

/** 요청 본문과, 조립에 넘긴 안내(`volatile.instructions`)다. 조립 대역은 volatile을 메시지에 붙이지 않으므로 안내는 입력으로 확인한다 */
async function runWithAddition(contextTrace: ContextTraceSink | undefined): Promise<{
  readonly bodies: string;
  readonly instructions: readonly (string | undefined)[];
  readonly owners: readonly (string | undefined)[];
}> {
  const h = await createHarness({
    tools,
    script: [...script],
    ...(contextTrace === undefined ? {} : { contextTrace }),
  });
  await h.host.host.install(promptAdditionOf("advisor", "Prefer short answers."));
  await h.host.settled();
  await h.loop.admit({
    threadId: h.threadId,
    content: "go",
    via: "interactive",
    requestId: "req-1",
  });
  await h.settle();
  return {
    bodies: bodiesOf(h.models.requests),
    instructions: h.context.assembled.map((item) => item.volatile["instructions"]),
    owners: h.context.assembled.map((item) => item.promptAdditionOwner),
  };
}

test("the_prompt_addition_owner_is_reported_and_the_request_bytes_do_not_change", async () => {
  const off = await runWithAddition(undefined);
  const events: ContextTraceEvent[] = [];
  const on = await runWithAddition({ record: (event) => events.push(event) });
  // 안내가 조립까지 갔다는 것을 먼저 확인해 바이트 비교가 빈 값끼리 맞는 일을 막는다
  expect(off.instructions).toEqual(["Prefer short answers.", "Prefer short answers."]);
  expect(on.bodies).toBe(off.bodies);
  // 출처가 하나의 핸들러로 정해지므로 두 단계 모두 조립 입력이 그 플러그인을 소유자로 준다(재료 줄은 실제 조립이 쓴다)
  expect(off.owners).toEqual(["advisor", "advisor"]);
  expect(on.owners).toEqual(["advisor", "advisor"]);
  expect(events.filter((event) => event.kind === "step_context").length).toBe(2);
});

test("a_sink_that_throws_leaves_the_request_unchanged_and_logs_one_warning", async () => {
  const off = await runWith(undefined);
  const thrown = await runWith({
    record: () => {
      throw new Error("sink failure");
    },
  });
  expect(thrown.bodies).toBe(off.bodies);
  expect(
    thrown.logs.filter((event) => event === "loop.context_trace_failed").length,
  ).toBeGreaterThan(0);
  expect(off.logs.filter((event) => event === "loop.context_trace_failed")).toEqual([]);
});

test("owner_of_a_tool_follows_its_capability_prefix", () => {
  expect(pluginOfCapability("ext.alpha")).toBe("alpha");
  expect(pluginOfCapability("mcp.search")).toBe("search");
  expect(pluginOfCapability("knowledge")).toBe("knowledge");
  expect(pluginOfCapability("")).toBe("none");
});

function toolOf(name: string, capability: string): OrderedTool {
  return {
    capability,
    name,
    wire: { name, description: `tool ${name}`, parameters: Type.Object({}) },
  };
}

test("advertised_summary_counts_states_and_owners_exactly", () => {
  const alpha = toolOf("a-run", "ext.alpha");
  const search = toolOf("s-find", "mcp.search");
  const knowledge = toolOf("k-view", "knowledge");
  const toolset: AdvertisedToolset = {
    tools: [alpha, search, knowledge],
    deferred: [{ capability: "ext.alpha", name: "a-hidden" }],
    removed: [{ ref: { capability: "ext.beta", name: "b-off" }, ruleId: "rule", tier: "default" }],
    fingerprint: "sha256:fixed",
  };
  const fact = advertisedFactOf({ toolset, activated: new Set(["s-find"]) });
  expect(fact.count).toBe(3);
  expect(fact.tokens).toBe(tokenOf(alpha) + tokenOf(search) + tokenOf(knowledge));
  expect(fact.deferredCount).toBe(1);
  expect(fact.removedCount).toBe(1);
  expect(fact.fingerprint).toBe("sha256:fixed");
  expect(fact.byPlugin).toEqual([
    { plugin: "alpha", count: 1, tokens: tokenOf(alpha), deferred: 1, activated: 0 },
    { plugin: "knowledge", count: 1, tokens: tokenOf(knowledge), deferred: 0, activated: 0 },
    { plugin: "search", count: 1, tokens: tokenOf(search), deferred: 0, activated: 1 },
  ]);
  expect(fact.tools.map((row) => [row.name, row.plugin, row.state])).toEqual([
    ["a-run", "alpha", "advertised"],
    ["s-find", "search", "activated"],
    ["k-view", "knowledge", "advertised"],
    ["a-hidden", "alpha", "deferred"],
  ]);
  expect(fact.toolsOmitted).toBe(0);
});

/** 도구 하나의 정의 토큰(글자 수 / 4 올림). 시험의 기대값을 만든다 */
function tokenOf(tool: OrderedTool): number {
  return Math.ceil(canonicalJson(tool.wire).length / 4);
}

test("advertised_tool_rows_are_capped_and_the_rest_is_counted", () => {
  const many: OrderedTool[] = [];
  for (let index = 0; index < 260; index += 1) many.push(toolOf(`t${String(index)}`, "knowledge"));
  const fact = advertisedFactOf({
    toolset: { tools: many, deferred: [], removed: [], fingerprint: "sha256:many" },
    activated: new Set(),
  });
  expect(fact.count).toBe(260);
  expect(fact.tools.length).toBe(256);
  expect(fact.toolsOmitted).toBe(4);
});

test("emit_without_a_sink_does_nothing_and_a_throwing_sink_is_logged_once", () => {
  const warnings: string[] = [];
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: (event) => {
      warnings.push(event);
    },
    error: () => {},
    child: () => logger,
  };
  const event: ContextTraceEvent = {
    kind: "skill_read",
    threadId: "thr",
    turnId: "trn",
    stepId: "stp",
    toolCallId: "c",
    name: "deploy",
  };
  emitContextTrace({ logger }, event);
  expect(warnings).toEqual([]);
  emitContextTrace(
    {
      logger,
      contextTrace: {
        record: () => {
          throw new Error("boom");
        },
      },
    },
    event,
  );
  expect(warnings).toEqual(["loop.context_trace_failed"]);
});
