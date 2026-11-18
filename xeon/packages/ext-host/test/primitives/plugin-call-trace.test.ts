import { expect, test } from "bun:test";
import { attemptAsync, ok, type Result } from "@fresnel/contracts";
import {
  defineCapability,
  type CallOptions,
  type ServiceKey,
  type ToolResultView,
  type ToolError,
} from "@fresnel/contracts/capabilities";
import type { JsonValue } from "@fresnel/contracts/conversation";
import {
  PluginCallTracePortKey,
  type ExtMethodDecl,
  type PluginCallTraceEvent,
  type PluginCallTraceSink,
} from "@fresnel/contracts/extensions";
import { Type } from "typebox";
import { capabilityDefTable, hostOf } from "../../src/primitives/index.ts";
import { createTestHost, type TestHost } from "../../src/testing/index.ts";
import { makeUnit } from "./fixtures/support.ts";
import { fakeTools, provideToolsPort } from "./fixtures/fake-plugin-calls.ts";

// M5d: 가벼운 길(읽기 전용 기능 메서드, `capability-guard.ts`의 `light`)의 호출은 추적 싱크에 한 줄씩 넘긴다(턴 기록 §4.3).
// 줄은 호출이 정해진 뒤 나가고, 호출의 결과와 거부는 그대로 돌아온다. 파이프라인 길의 호출은 이 싱크에 줄을 남기지 않는다.
// 핸들러 안의 읽기 전용 호출은 재실행 검사로 거부되므로(on denied), 가벼운 길은 대화가 있는 확장 메서드 안에서 시험한다.

const POINT = "boundary.settle.after" as const;

/** canonicalJson({"text":"p"})의 SHA-256 앞 40 hex(파이프라인의 argsHash와 같은 식) */
const ARGS_HASH_OF_P = "1667c7df215d7d48f1ce00ef7fd4aa270f4e3ad6";

interface WriterApi {
  save(input: { text: string }, options?: CallOptions): Promise<{ saved: string }>;
  peek(input: { text: string }, options?: CallOptions): Promise<{ saved: string }>;
}

const WriteInput = Type.Object({ text: Type.String() });
const WriteOutput = Type.Object({ saved: Type.String() });
const writer = defineCapability({
  id: "demo.writer",
  version: "1.0.0",
  description: "a writer with one declared write and one readOnly method",
  service: {
    methods: {
      save: { description: "saves text", input: WriteInput, output: WriteOutput, replay: "unsafe" },
      peek: {
        description: "reads text",
        input: WriteInput,
        output: WriteOutput,
        replay: "safe",
        readOnly: true,
      },
    },
  },
  tools: [],
});
const writerDefs = capabilityDefTable([writer]);
const writerKey: ServiceKey<WriterApi> = { capability: "demo.writer", version: "1.0.0" };

function providerUnit(impl: WriterApi) {
  return makeUnit(
    { name: "writer-provider", provides: [{ id: "demo.writer", version: "1.0.0" }] },
    (g) => {
      hostOf(g).provide(writerKey, impl);
    },
  );
}

function consumerUnit(setup: Parameters<typeof makeUnit>[1]) {
  return makeUnit(
    {
      name: "pc-consumer",
      builtin: false,
      loadIndex: 1,
      hooks: [POINT],
      requires: [{ id: "demo.writer", range: "^1.0.0" }],
    },
    setup,
  );
}

/** 읽기 전용 확장 메서드 `look` 하나를 가진 소비자. 처리기는 `run`을 대화가 있는 문맥에서 부른다 */
function methodConsumerUnit(run: (svc: WriterApi) => Promise<unknown>) {
  const look: ExtMethodDecl = { verb: "look", params: {}, result: {}, readOnly: true };
  return makeUnit(
    {
      name: "pc-consumer",
      builtin: false,
      loadIndex: 1,
      requires: [{ id: "demo.writer", range: "^1.0.0" }],
      methods: [look],
    },
    (g) => {
      hostOf(g).registerMethod("look", {
        handler: async () => {
          await run(g.capability(writerKey));
          return null;
        },
      });
    },
  );
}

function lookCall(t: TestHost, thread: ReturnType<TestHost["newThread"]>) {
  return t.host.methods.call({
    extension: "pc-consumer",
    verb: "look",
    params: {},
    threadId: thread,
    signal: new AbortController().signal,
    caller: "ui",
  });
}

async function provideTraceSink(t: TestHost, sink: PluginCallTraceSink): Promise<void> {
  await t.host.registerPlatform({
    name: "test-plugin-call-trace",
    setup(ctx) {
      ctx.providePort(PluginCallTracePortKey, sink);
    },
  });
}

async function fire(t: TestHost, thread: ReturnType<TestHost["newThread"]>, dispatchKey: string) {
  await t.host.dispatch(
    POINT,
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey },
  );
}

function okView(structured: JsonValue): Result<ToolResultView, ToolError> {
  return ok({ content: "", structuredContent: structured, isError: false, details: null });
}

test("a readOnly capability call from a method emits one trace line with its caller, method, via, and thread, and the result is unchanged", async () => {
  const events: PluginCallTraceEvent[] = [];
  const fake = fakeTools(() => okView({ saved: "never" }));
  const t = await createTestHost({ capabilityDefs: writerDefs });
  await provideToolsPort(t, fake.port);
  await provideTraceSink(t, {
    record: (event) => {
      events.push(event);
    },
  });
  await t.host.install(
    providerUnit({
      save: () => Promise.resolve({ saved: "" }),
      peek: (input) => Promise.resolve({ saved: input.text }),
    }),
  );
  let seen: unknown;
  await t.host.install(
    methodConsumerUnit(async (svc) => {
      seen = await svc.peek({ text: "p" });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await lookCall(t, thread);
  expect(seen).toEqual({ saved: "p" });
  expect(fake.requests).toEqual([]);
  expect(events).toEqual([
    {
      threadId: thread,
      plugin: "pc-consumer",
      capability: "demo.writer",
      method: "peek",
      argsHash: ARGS_HASH_OF_P,
      ok: true,
      ms: 0,
      via: "method",
      toolCallId: null,
    },
  ]);
});

test("a readOnly call whose provider rejects emits a line with ok false, and the rejection reaches the caller unchanged", async () => {
  const events: PluginCallTraceEvent[] = [];
  const fake = fakeTools(() => okView({ saved: "never" }));
  const t = await createTestHost({ capabilityDefs: writerDefs });
  await provideToolsPort(t, fake.port);
  await provideTraceSink(t, {
    record: (event) => {
      events.push(event);
    },
  });
  const boom = new Error("peek refused");
  await t.host.install(
    providerUnit({
      save: () => Promise.resolve({ saved: "" }),
      peek: () => Promise.reject(boom),
    }),
  );
  let outcome: Result<unknown, { readonly cause?: unknown }> | undefined;
  await t.host.install(
    methodConsumerUnit(async (svc) => {
      outcome = await attemptAsync(() => svc.peek({ text: "p" }));
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await lookCall(t, thread);
  expect(outcome?.ok).toBe(false);
  expect(outcome?.ok === false ? outcome.error.cause : undefined).toBe(boom);
  expect(events).toEqual([
    {
      threadId: thread,
      plugin: "pc-consumer",
      capability: "demo.writer",
      method: "peek",
      argsHash: ARGS_HASH_OF_P,
      ok: false,
      ms: 0,
      via: "method",
      toolCallId: null,
    },
  ]);
});

test("a declared write with no tool mapping takes the pipeline and emits no light-path line", async () => {
  const events: PluginCallTraceEvent[] = [];
  const fake = fakeTools(
    () => okView({ saved: "p" }),
    (capability, method) => capability === "demo.writer" && method === "save",
  );
  const t = await createTestHost({ capabilityDefs: writerDefs });
  await provideToolsPort(t, fake.port);
  await provideTraceSink(t, {
    record: (event) => {
      events.push(event);
    },
  });
  await t.host.install(
    providerUnit({
      save: () => Promise.resolve({ saved: "" }),
      peek: () => Promise.resolve({ saved: "" }),
    }),
  );
  await t.host.install(
    consumerUnit((g) => {
      g.on(POINT, async () => {
        await g.capability(writerKey).save({ text: "p" });
      });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await fire(t, thread, "k3");
  expect(fake.requests).toHaveLength(1);
  expect(events).toEqual([]);
});

test("a trace sink that throws leaves the call result unchanged and reports plugin_call_trace_failed", async () => {
  const fake = fakeTools(() => okView({ saved: "never" }));
  const t = await createTestHost({ capabilityDefs: writerDefs });
  await provideToolsPort(t, fake.port);
  await provideTraceSink(t, {
    record: () => {
      throw new Error("sink is down");
    },
  });
  await t.host.install(
    providerUnit({
      save: () => Promise.resolve({ saved: "" }),
      peek: (input) => Promise.resolve({ saved: input.text }),
    }),
  );
  let seen: unknown;
  await t.host.install(
    methodConsumerUnit(async (svc) => {
      seen = await svc.peek({ text: "p" });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await lookCall(t, thread);
  expect(seen).toEqual({ saved: "p" });
  expect(
    t.diagnostics
      .filter((diagnostic) => diagnostic.code === "plugin_call_trace_failed")
      .map((diagnostic) => [diagnostic.level, diagnostic.extension]),
  ).toEqual([["warning", "pc-consumer"]]);
});
