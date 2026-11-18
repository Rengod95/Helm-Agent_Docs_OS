import { expect, test } from "bun:test";
import { attemptAsync, err, ok, type Result } from "@fresnel/contracts";
import {
  CapabilityError,
  defineCapability,
  type CallOptions,
  type PluginCallRequest,
  type ServiceKey,
  type ToolError,
  type ToolResultView,
} from "@fresnel/contracts/capabilities";
import type { PortKey, ToolsPort } from "@fresnel/contracts/extensions";
import type { JsonValue } from "@fresnel/contracts/conversation";
import { Type } from "typebox";
import { createEngineCallRouter } from "../../src/isolation/engine-calls.ts";
import { capabilityDefTable, hostOf } from "../../src/primitives/index.ts";
import { createTestHost, type TestHost } from "../../src/testing/index.ts";
import { makeUnit } from "./fixtures/support.ts";
import { fakeTools, provideToolsPort, type FakeToolsPort } from "./fixtures/fake-plugin-calls.ts";

// hooks-core-boundary §5.3 U-1·U-5·U-8·U-10: 플러그인 코드의 기능 호출은 도구 파이프라인으로 가고(도구 매핑이 있거나 readOnly가 아님),
// readOnly 호출은 옛 직접 경로에 남는다. 재실행 효과 표는 파이프라인 경로에서 건너뛰고, 설정이 꺼지면 옛 검사를 받는다.

const POINT = "boundary.settle.after" as const;

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

const SETTINGS_KEY: PortKey<{ value(key: string): unknown }> = { name: "fresnel.settings" };

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

const NO_PROVIDER_EFFECT = {
  save: () => Promise.resolve({ saved: "" }),
  peek: () => Promise.resolve({ saved: "" }),
};

async function provideSettings(t: TestHost, values: Record<string, unknown>): Promise<void> {
  await t.host.registerPlatform({
    name: "test-settings",
    setup(ctx) {
      ctx.providePort(SETTINGS_KEY, { value: (key) => values[key] });
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

/** 실패 값의 원인이 `CapabilityError`면 그 코드(`plugin_call_<kind>` 등), 아니면 undefined */
function codeOf(outcome: Result<unknown, { readonly cause?: unknown }>): string | undefined {
  if (outcome.ok) return undefined;
  const cause = outcome.error.cause;
  return cause instanceof CapabilityError ? cause.data.code : undefined;
}

test("a plugin's save from a hook goes to the pipeline with via hook and a derived request id, without an explicit requestId", async () => {
  const providerCalls: string[] = [];
  const fake = fakeTools(
    () => okView({ saved: "a" }),
    (capability, method) => capability === "demo.writer" && method === "save",
  );
  const t = await createTestHost({ capabilityDefs: writerDefs });
  await provideToolsPort(t, fake.port);
  await t.host.install(
    providerUnit({
      save: (input) => {
        providerCalls.push(input.text);
        return Promise.resolve({ saved: input.text });
      },
      peek: () => Promise.resolve({ saved: "" }),
    }),
  );
  let seen: unknown;
  await t.host.install(
    consumerUnit((g) => {
      g.on(POINT, async () => {
        seen = await g.capability(writerKey).save({ text: "a" });
      });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await fire(t, thread, "k1");
  expect(fake.requests).toHaveLength(1);
  expect(fake.requests[0]).toMatchObject({
    via: "hook",
    plugin: { name: "pc-consumer" },
    target: { kind: "capability", capability: "demo.writer", method: "save" },
    input: { text: "a" },
    hookDepth: 1,
  });
  expect(fake.requests[0]?.requestId).toMatch(/^call:[0-9a-f]{40}$/);
  expect(seen).toEqual({ saved: "a" });
  expect(providerCalls).toEqual([]);
});

test("a declared write with no tool mapping goes to the pipeline as the cap: synthetic entry", async () => {
  const fake = fakeTools(() => okView({ saved: "s" }));
  const t = await createTestHost({ capabilityDefs: writerDefs });
  await provideToolsPort(t, fake.port);
  await t.host.install(providerUnit(NO_PROVIDER_EFFECT));
  await t.host.install(
    consumerUnit((g) => {
      g.on(POINT, async () => {
        await g.capability(writerKey).save({ text: "s" });
      });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await fire(t, thread, "k2");
  expect(fake.requests.map((request) => request.target)).toEqual([
    { kind: "capability", capability: "demo.writer", method: "save" },
  ]);
});

test("a readOnly method with no tool mapping stays on the direct path and makes no pipeline call", async () => {
  const fake = fakeTools(() => okView({ saved: "never" }));
  const t = await createTestHost({ capabilityDefs: writerDefs });
  await provideToolsPort(t, fake.port);
  const peeks: string[] = [];
  await t.host.install(
    providerUnit({
      save: () => Promise.resolve({ saved: "" }),
      peek: (input) => {
        peeks.push(input.text);
        return Promise.resolve({ saved: input.text });
      },
    }),
  );
  let pending: Promise<{ saved: string }> | undefined;
  await t.host.install(
    consumerUnit((g) => {
      // setup은 맥락이 없는 호출이라 읽기 전용 메서드를 직접 부른다
      pending = g.capability(writerKey).peek({ text: "p" });
    }),
  );
  expect(await pending).toEqual({ saved: "p" });
  expect(peeks).toEqual(["p"]);
  expect(fake.requests).toEqual([]);
});

test("a readOnly method called by a draft plugin does not take the direct path: it goes to the pipeline so the draft approval rule applies (L1.tools §4.6.1)", async () => {
  const fake = fakeTools(() => okView({ saved: "from-pipeline" }));
  const t = await createTestHost({ capabilityDefs: writerDefs });
  await provideToolsPort(t, { ...fake.port, isDraftScope: () => true });
  const peeks: string[] = [];
  await t.host.install(
    providerUnit({
      save: () => Promise.resolve({ saved: "" }),
      peek: (input) => {
        peeks.push(input.text);
        return Promise.resolve({ saved: input.text });
      },
    }),
  );
  let seen: unknown;
  await t.host.install(
    consumerUnit((g) => {
      g.on(POINT, async () => {
        seen = await g.capability(writerKey).peek({ text: "p" });
      });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await fire(t, thread, "draft-peek");
  expect(fake.requests).toHaveLength(1);
  expect(fake.requests[0]).toMatchObject({
    via: "hook",
    plugin: { name: "pc-consumer" },
    target: { kind: "capability", capability: "demo.writer", method: "peek" },
    input: { text: "p" },
  });
  expect(seen).toEqual({ saved: "from-pipeline" });
  expect(peeks).toEqual([]);
});

test("a draft plugin's readOnly call with no thread to ask in is refused, never run directly", async () => {
  const fake = fakeTools(() => okView({ saved: "never" }));
  const t = await createTestHost({ capabilityDefs: writerDefs });
  await provideToolsPort(t, { ...fake.port, isDraftScope: () => true });
  const peeks: string[] = [];
  await t.host.install(
    providerUnit({
      save: () => Promise.resolve({ saved: "" }),
      peek: (input) => {
        peeks.push(input.text);
        return Promise.resolve({ saved: input.text });
      },
    }),
  );
  let pending: Promise<{ saved: string }> | undefined;
  await t.host.install(
    consumerUnit((g) => {
      // setup은 대화 맥락이 없다
      pending = g.capability(writerKey).peek({ text: "p" });
    }),
  );
  const started = pending;
  if (started === undefined) throw new Error("the consumer did not call");
  const outcome = await attemptAsync(() => started);
  expect(outcome.ok).toBe(false);
  expect(peeks).toEqual([]);
  expect(fake.requests).toEqual([]);
});

async function runWith(enabled: boolean) {
  const fake = fakeTools(() => okView({ saved: "x" }));
  const t = await createTestHost({ capabilityDefs: writerDefs });
  await provideToolsPort(t, fake.port);
  await provideSettings(t, { "l1.tools.pluginCalls": enabled });
  await t.host.install(providerUnit(NO_PROVIDER_EFFECT));
  let outcome: Result<unknown, { readonly cause?: unknown }> = ok(undefined);
  await t.host.install(
    consumerUnit((g) => {
      g.on(POINT, async () => {
        outcome = await attemptAsync(() => g.capability(writerKey).save({ text: "x" }));
      });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await fire(t, thread, enabled ? "on" : "off");
  return { fake, outcome };
}

test("the replay check does not reject a handler's write on the pipeline path, and still rejects it when the setting is off", async () => {
  const on = await runWith(true);
  expect(on.outcome.ok).toBe(true);
  expect(on.fake.requests).toHaveLength(1);
  const off = await runWith(false);
  expect(off.fake.requests).toEqual([]);
  expect(codeOf(off.outcome)).toBe("effect_not_allowed");
});

test("an explicit requestId is the pipeline key, and calls in one handler get distinct derived keys", async () => {
  const fake = fakeTools(() => okView({ saved: "y" }));
  const t = await createTestHost({ capabilityDefs: writerDefs });
  await provideToolsPort(t, fake.port);
  await t.host.install(providerUnit(NO_PROVIDER_EFFECT));
  await t.host.install(
    consumerUnit((g) => {
      g.on(POINT, async () => {
        await g.capability(writerKey).save({ text: "y" }, { requestId: "mine" });
        await g.capability(writerKey).save({ text: "y" });
        await g.capability(writerKey).save({ text: "y" });
      });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await fire(t, thread, "k3");
  const ids = fake.requests.map((request) => request.requestId);
  expect(ids[0]).toBe("mine");
  expect(new Set(ids).size).toBe(3);
});

test("a call that repeats its own hook chain (same plugin, target, and arguments) is refused as hook_cycle before it runs", async () => {
  const requests: PluginCallRequest[] = [];
  let nested: Result<unknown, { readonly cause?: unknown }> = ok(undefined);
  let writerApi: WriterApi | undefined;
  const port: ToolsPort = {
    register: () => err({ kind: "replace_forbidden", toolName: "x", reason: "no_target" }),
    toolMappedFor: (capability, method) => capability === "demo.writer" && method === "save",
    async executeForPlugin(request) {
      requests.push(request);
      // 첫 호출이 낸 훅이 같은 플러그인의 같은 호출을 다시 부른다(U-8 (나))
      if (requests.length === 1 && writerApi !== undefined) {
        const again = writerApi;
        nested = await attemptAsync(() => again.save({ text: "a" }));
      }
      return okView({ saved: "a" });
    },
  };
  const t = await createTestHost({ capabilityDefs: writerDefs });
  await provideToolsPort(t, port);
  await t.host.install(providerUnit(NO_PROVIDER_EFFECT));
  await t.host.install(
    consumerUnit((g) => {
      writerApi = g.capability(writerKey);
      const api = writerApi;
      g.on(POINT, async () => {
        await api.save({ text: "a" });
      });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await fire(t, thread, "k4");
  expect(requests).toHaveLength(1);
  expect(codeOf(nested)).toBe("plugin_call_hook_cycle");
  if (nested.ok) return;
  expect(nested.error.cause).toMatchObject({
    message: expect.stringContaining("[fresnel:hook_cycle]"),
  });
});

test("a denied pipeline result reaches the plugin as plugin_call_denied, and a failed tool result keeps the provider code", async () => {
  const fake: FakeToolsPort = fakeTools((request) =>
    request.requestId === "deny-me"
      ? err({ kind: "denied", message: "[fresnel:denied] no", resolvedBy: "policy" })
      : ok({ content: "boom", structuredContent: null, isError: true, details: { code: "x" } }),
  );
  const t = await createTestHost({ capabilityDefs: writerDefs });
  await provideToolsPort(t, fake.port);
  await t.host.install(providerUnit(NO_PROVIDER_EFFECT));
  const outcomes: Result<unknown, { readonly cause?: unknown }>[] = [];
  await t.host.install(
    consumerUnit((g) => {
      g.on(POINT, async () => {
        outcomes.push(
          await attemptAsync(() =>
            g.capability(writerKey).save({ text: "d" }, { requestId: "deny-me" }),
          ),
        );
        outcomes.push(
          await attemptAsync(() =>
            g.capability(writerKey).save({ text: "f" }, { requestId: "fail-me" }),
          ),
        );
      });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await fire(t, thread, "k5");
  expect(outcomes.map(codeOf)).toEqual(["plugin_call_denied", "x"]);
});

async function run(enabled: boolean) {
  const fake = fakeTools(() => okView({ saved: "e" }));
  const t = await createTestHost({ capabilityDefs: writerDefs });
  await provideToolsPort(t, fake.port);
  await provideSettings(t, { "l1.tools.pluginCalls": enabled });
  const saved: string[] = [];
  await t.host.install(
    providerUnit({
      save: (input) => {
        saved.push(input.text);
        return Promise.resolve({ saved: input.text });
      },
      peek: () => Promise.resolve({ saved: "" }),
    }),
  );
  await t.host.install(
    consumerUnit((g) => {
      g.on(POINT, async () => {
        await hostOf(g).requestEffect({
          capability: "demo.writer",
          method: "save",
          input: { text: "e" },
          key: "ew:pipe",
        });
      });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await fire(t, thread, enabled ? "ef-on" : "ef-off");
  await t.settled();
  return { fake, saved };
}

test("a requestEffect of a declared write goes to the pipeline with via effect and the effect key; with the setting off it runs the provider directly", async () => {
  const on = await run(true);
  expect(on.fake.requests).toHaveLength(1);
  expect(on.fake.requests[0]).toMatchObject({ via: "effect", requestId: "ew:pipe" });
  expect(on.saved).toEqual([]);
  const off = await run(false);
  expect(off.fake.requests).toEqual([]);
  expect(off.saved).toEqual(["e"]);
});

// U-11: 승인 상속 주장은 내장 확장만 싣는다. 외부·격리 플러그인이 넘긴 값은 버려지고, 격리 플러그인의 `engine.call` 기능 호출도
// 같은 가드를 지나 파이프라인으로 가며 호출 주체는 그 플러그인의 이름이다.

async function saveWithClaim(
  builtin: boolean,
  claim: CallOptions,
): Promise<readonly PluginCallRequest[]> {
  const fake = fakeTools(() => okView({ saved: "a" }));
  const t = await createTestHost({ capabilityDefs: writerDefs });
  await provideToolsPort(t, fake.port);
  await t.host.install(providerUnit(NO_PROVIDER_EFFECT));
  await t.host.install(
    makeUnit(
      {
        name: "pc-consumer",
        builtin,
        loadIndex: 1,
        hooks: [POINT],
        requires: [{ id: "demo.writer", range: "^1.0.0" }],
      },
      (g) => {
        g.on(POINT, async () => {
          await g.capability(writerKey).save({ text: "a" }, claim);
        });
      },
    ),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await fire(t, thread, "claim");
  return fake.requests;
}

test("a built-in plugin's approval claim reaches the engine; an external plugin's claim is dropped", async () => {
  const claim: CallOptions = { inheritApproval: { approvalId: "apv_card" } };
  const trusted = await saveWithClaim(true, claim);
  expect(trusted[0]?.inheritApproval).toEqual({ approvalId: "apv_card" });
  const external = await saveWithClaim(false, claim);
  expect(external).toHaveLength(1);
  expect(external[0]?.inheritApproval).toBeUndefined();
});

test("an isolated plugin's engine.call capability call goes to the pipeline as that plugin and carries no approval claim", async () => {
  const fake = fakeTools(() => okView({ saved: "a" }));
  const t = await createTestHost({ capabilityDefs: writerDefs });
  await provideToolsPort(t, fake.port);
  await t.host.install(providerUnit(NO_PROVIDER_EFFECT));
  let reply: unknown;
  await t.host.install(
    makeUnit(
      {
        name: "pc-isolated",
        builtin: false,
        loadIndex: 1,
        hooks: [POINT],
        requires: [{ id: "demo.writer", range: "^1.0.0" }],
      },
      (g) => {
        const router = createEngineCallRouter({ gOf: () => g, replayOf: () => false });
        g.on(POINT, async () => {
          reply = await router({
            method: "capability",
            registration: "pc-isolated",
            requestId: null,
            params: {
              key: { capability: "demo.writer", version: "1.0.0" },
              member: "save",
              input: { text: "a" },
              options: { inheritApproval: { approvalId: "apv_card" } },
            },
          });
        });
      },
    ),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await fire(t, thread, "engine-call");
  expect(reply).toEqual({ ok: true, value: { saved: "a" } });
  expect(fake.requests).toHaveLength(1);
  expect(fake.requests[0]).toMatchObject({
    plugin: { name: "pc-isolated" },
    target: { kind: "capability", capability: "demo.writer", method: "save" },
    input: { text: "a" },
  });
  expect(fake.requests[0]?.inheritApproval).toBeUndefined();
});
