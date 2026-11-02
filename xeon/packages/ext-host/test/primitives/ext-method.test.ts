// 확장 메서드(X.primitives.spec §3.9.2, §4.12, §9 58~64). 등록 검사, 호출 결과 분류, 보고, 수명, ambient를 확인한다.
import { expect, test } from "bun:test";
import { attempt, attemptAsync } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ExtMethodDecl } from "@fresnel/contracts/extensions";
import { Type } from "typebox";
import {
  hostOf,
  PrimitiveError,
  type ExtensionUnit,
  type ExtMethodSettled,
} from "../../src/primitives/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { makeManifest, makeUnit } from "./fixtures/support.ts";

/** 등록 함수가 던진 PrimitiveError의 코드. 던지지 않으면 undefined다 */
function codeOf(run: () => void): string | undefined {
  const outcome = attempt(run);
  if (outcome.ok) return undefined;
  const cause = outcome.error.cause;
  return cause instanceof PrimitiveError ? cause.code : "not_primitive";
}

function declOf(
  verb: string,
  params: Readonly<Record<string, unknown>> = {},
  result: Readonly<Record<string, unknown>> = {},
): ExtMethodDecl {
  return { verb, params, result, readOnly: true };
}

const sumParams = {
  type: "object",
  properties: { n: { type: "integer", minimum: 1 } },
  required: ["n"],
  additionalProperties: false,
};
const sumResult = {
  type: "object",
  properties: { total: { type: "number" } },
  required: ["total"],
};
const modeParams = {
  type: "object",
  properties: { mode: { type: "string" } },
  required: ["mode"],
};
const modeOfResult = {
  type: "object",
  properties: { total: { type: "number" } },
  required: ["total"],
};

/** 시험 처리기가 params.n을 읽는다. 모양이 없으면 0 */
function nOf(params: unknown): number {
  return typeof params === "object" &&
    params !== null &&
    "n" in params &&
    typeof params.n === "number"
    ? params.n
    : 0;
}

/** 시험 처리기가 params.mode를 읽는다. 모양이 없으면 빈 문자열 */
function modeOf(params: unknown): string {
  return typeof params === "object" &&
    params !== null &&
    "mode" in params &&
    typeof params.mode === "string"
    ? params.mode
    : "";
}

/** 취소되지 않는 새 신호를 쓰는 호출 입력 */
function callOf(
  extension: string,
  verb: string,
  params: unknown,
  threadId: ThreadId | null = null,
  callId?: string,
) {
  return {
    extension,
    verb,
    params,
    threadId,
    signal: new AbortController().signal,
    caller: "wire" as const,
    ...(callId === undefined ? {} : { callId }),
  };
}

test("a registered method returns the handler's value and is listed with its declaration", async () => {
  const t = await createTestHost();
  await t.host.install(
    makeUnit({ name: "calc", methods: [declOf("sum", sumParams, sumResult)] }, (g) => {
      hostOf(g).registerMethod("sum", {
        handler: (params) => Promise.resolve({ total: 5 * nOf(params) }),
      });
    }),
  );
  expect(await t.host.methods.call(callOf("calc", "sum", { n: 2 }))).toEqual({
    kind: "ok",
    value: { total: 10 },
  });
  expect(t.host.methods.list()).toEqual([
    { extension: "calc", verb: "sum", decl: declOf("sum", sumParams, sumResult), scopeId: "calc" },
  ]);
});

test("registerMethod refuses an undeclared verb, a verb outside the pattern, an uncompilable schema and a second copy", async () => {
  const t = await createTestHost();
  const codes: (string | undefined)[] = [];
  const handler = { handler: () => Promise.resolve(null) };
  await t.host.install(
    makeUnit(
      {
        name: "dup",
        methods: [
          declOf("ping"),
          declOf("Bad_verb"),
          declOf("broken", { type: "string", pattern: "[" }),
          declOf("brokenResult", {}, { type: "string", pattern: "[" }),
        ],
      },
      (g) => {
        const api = hostOf(g);
        codes.push(codeOf(() => api.registerMethod("missing", handler)));
        codes.push(codeOf(() => api.registerMethod("Bad_verb", handler)));
        codes.push(codeOf(() => api.registerMethod("broken", handler)));
        codes.push(codeOf(() => api.registerMethod("brokenResult", handler)));
        api.registerMethod("ping", handler);
        codes.push(codeOf(() => api.registerMethod("ping", handler)));
      },
    ),
  );
  expect(codes).toEqual([
    "resource_name_invalid",
    "resource_name_invalid",
    "method_schema_invalid",
    "method_schema_invalid",
    "resource_conflict",
  ]);
  expect(t.host.methods.list().map((method) => method.verb)).toEqual(["ping"]);
});

test("a second Registration of the same extension cannot register a verb another one already has", async () => {
  const t = await createTestHost();
  const codes: (string | undefined)[] = [];
  const manifest = makeManifest({
    name: "twin",
    group: {},
    methods: [declOf("ping")],
    extraPlugins: [{ id: "second", layer: "plugin", hooks: [], defaultEnabled: true }],
  });
  const twin: ExtensionUnit = {
    manifest,
    entry: ({ register }) => {
      register("twin", {}, (g) => {
        hostOf(g).registerMethod("ping", { handler: () => Promise.resolve("first") });
      });
      register("twin/second", {}, (g) => {
        codes.push(
          codeOf(() => {
            hostOf(g).registerMethod("ping", { handler: () => Promise.resolve("second") });
          }),
        );
      });
    },
    loadIndex: 0,
    builtin: true,
  };
  await t.host.install(twin);
  expect(codes).toEqual(["resource_conflict"]);
  expect(t.host.methods.list()).toEqual([
    { extension: "twin", verb: "ping", decl: declOf("ping"), scopeId: "twin" },
  ]);
  expect(await t.host.methods.call(callOf("twin", "ping", {}))).toEqual({
    kind: "ok",
    value: "first",
  });
});

test("params that break the declared schema are rejected before the handler runs, with exact issues", async () => {
  const settled: ExtMethodSettled[] = [];
  const t = await createTestHost({ onMethodSettled: (info) => settled.push(info) });
  let calls = 0;
  await t.host.install(
    makeUnit({ name: "calc", methods: [declOf("sum", sumParams, sumResult)] }, (g) => {
      hostOf(g).registerMethod("sum", {
        handler: () => {
          calls += 1;
          return Promise.resolve({ total: 0 });
        },
      });
    }),
  );
  expect(await t.host.methods.call(callOf("calc", "sum", { n: 0 }))).toEqual({
    kind: "params_invalid",
    issues: [{ path: "/n", message: "must be >= 1" }],
  });
  expect(calls).toBe(0);
  expect(settled).toEqual([
    { extension: "calc", scopeId: "calc", verb: "sum", outcome: "params_invalid", activeMs: 0 },
  ]);
});

test("params issues come from the validator in schema order, and typebox's default cap of 8 applies", async () => {
  const t = await createTestHost();
  const names = Array.from({ length: 25 }, (_, index) => `p${index}`);
  const wide = {
    type: "object",
    properties: Object.fromEntries(names.map((name) => [name, { type: "integer" }])),
  };
  await t.host.install(
    makeUnit({ name: "calc", methods: [declOf("wide", wide)] }, (g) => {
      hostOf(g).registerMethod("wide", { handler: () => Promise.resolve(null) });
    }),
  );
  const params = Object.fromEntries(names.map((name) => [name, "x"]));
  expect(await t.host.methods.call(callOf("calc", "wide", params))).toEqual({
    kind: "params_invalid",
    issues: names.slice(0, 8).map((name) => ({ path: `/${name}`, message: "must be integer" })),
  });
});

test("a handler result that is not JSON or breaks the declared result is result_invalid", async () => {
  const settled: ExtMethodSettled[] = [];
  const t = await createTestHost({ onMethodSettled: (info) => settled.push(info) });
  await t.host.install(
    makeUnit({ name: "shape", methods: [declOf("shape", modeParams, modeOfResult)] }, (g) => {
      hostOf(g).registerMethod("shape", {
        handler: (params) => {
          const mode = modeOf(params);
          if (mode === "text") return Promise.resolve({ total: "five" });
          if (mode === "undef") return Promise.resolve(undefined);
          if (mode === "fn") return Promise.resolve({ total: () => 1 });
          const cyclic: Record<string, unknown> = { total: 1 };
          cyclic["self"] = cyclic;
          return Promise.resolve(cyclic);
        },
      });
    }),
  );
  const run = (mode: string) => t.host.methods.call(callOf("shape", "shape", { mode }));
  expect(await run("text")).toEqual({
    kind: "result_invalid",
    issues: [{ path: "/total", message: "must be number" }],
  });
  expect(await run("undef")).toEqual({
    kind: "result_invalid",
    issues: [{ path: "", message: "undefined is not JSON" }],
  });
  expect(await run("fn")).toEqual({
    kind: "result_invalid",
    issues: [{ path: "/total", message: "function is not JSON" }],
  });
  expect(await run("cycle")).toEqual({
    kind: "result_invalid",
    issues: [{ path: "/self", message: "a cycle is not JSON" }],
  });
  expect(settled.map((info) => info.outcome)).toEqual([
    "result_invalid",
    "result_invalid",
    "result_invalid",
    "result_invalid",
  ]);
});

test("a throwing handler is threw with a 500 character message and is reported once", async () => {
  const settled: ExtMethodSettled[] = [];
  const t = await createTestHost({ onMethodSettled: (info) => settled.push(info) });
  await t.host.install(
    makeUnit({ name: "calc", methods: [declOf("boom"), declOf("long")] }, (g) => {
      hostOf(g).registerMethod("boom", { handler: () => Promise.reject(new Error("boom")) });
      hostOf(g).registerMethod("long", {
        handler: () => Promise.reject(new Error("x".repeat(600))),
      });
    }),
  );
  expect(await t.host.methods.call(callOf("calc", "boom", {}))).toEqual({
    kind: "threw",
    message: "boom",
  });
  expect(await t.host.methods.call(callOf("calc", "long", {}))).toEqual({
    kind: "threw",
    message: "x".repeat(500),
  });
  expect(settled).toEqual([
    { extension: "calc", scopeId: "calc", verb: "boom", outcome: "threw", activeMs: 0 },
    { extension: "calc", scopeId: "calc", verb: "long", outcome: "threw", activeMs: 0 },
  ]);
  expect(
    t.diagnostics
      .filter((diagnostic) => diagnostic.code === "handler_failed")
      .map((d) => d.message),
  ).toEqual(["method boom threw", "method long threw"]);
});

test("a method of a switched-off Registration is extension_off and is no longer listed", async () => {
  const settled: ExtMethodSettled[] = [];
  const t = await createTestHost({ onMethodSettled: (info) => settled.push(info) });
  const thread = t.newThread();
  await t.host.install(
    makeUnit(
      { name: "calc", methods: [declOf("sum", sumParams, sumResult), declOf("later")] },
      (g) => {
        hostOf(g).registerMethod("sum", {
          handler: (params) => Promise.resolve({ total: nOf(params) }),
        });
      },
    ),
  );
  await t.host.openThread(thread);
  await t.settled();
  expect(await t.host.methods.call(callOf("calc", "sum", { n: 3 }, thread))).toEqual({
    kind: "ok",
    value: { total: 3 },
  });
  expect(await t.host.methods.call(callOf("calc", "later", {}, thread))).toEqual({
    kind: "not_found",
  });
  expect(await t.host.methods.call(callOf("calc", "nope", {}, thread))).toEqual({
    kind: "not_found",
  });

  t.host.registration("calc")?.disable();
  await t.settled();
  expect(t.host.registration("calc")?.status).toBe("disabled");
  expect(t.host.methods.list()).toEqual([]);
  expect(await t.host.methods.call(callOf("calc", "sum", { n: 3 }, thread))).toEqual({
    kind: "extension_off",
  });
  expect(await t.host.methods.call(callOf("calc", "sum", { n: 3 }))).toEqual({
    kind: "extension_off",
  });
  // 처리기에 닿은 호출만 보고된다. not_found와 extension_off는 보고되지 않는다
  expect(settled.map((info) => info.outcome)).toEqual(["ok"]);
});

test("a call whose signal is already aborted is aborted and never reaches the handler", async () => {
  const t = await createTestHost();
  let calls = 0;
  await t.host.install(
    makeUnit({ name: "calc", methods: [declOf("ping")] }, (g) => {
      hostOf(g).registerMethod("ping", {
        handler: () => {
          calls += 1;
          return Promise.resolve("pong");
        },
      });
    }),
  );
  const controller = new AbortController();
  controller.abort();
  expect(
    await t.host.methods.call({
      extension: "calc",
      verb: "ping",
      params: {},
      threadId: null,
      signal: controller.signal,
      caller: "ui",
    }),
  ).toEqual({ kind: "aborted" });
  expect(calls).toBe(0);
});

test("aborting a running call returns aborted without waiting for the handler, and the handler sees the abort", async () => {
  const settled: ExtMethodSettled[] = [];
  const t = await createTestHost({ onMethodSettled: (info) => settled.push(info) });
  let seen: AbortSignal | undefined;
  await t.host.install(
    makeUnit({ name: "calc", methods: [declOf("wait")] }, (g) => {
      hostOf(g).registerMethod("wait", {
        handler: (_params, ctx) => {
          seen = ctx.signal;
          return new Promise<unknown>(() => {});
        },
      });
    }),
  );
  const controller = new AbortController();
  const pending = t.host.methods.call({
    extension: "calc",
    verb: "wait",
    params: {},
    threadId: null,
    signal: controller.signal,
    caller: "wire",
  });
  controller.abort();
  expect(await pending).toEqual({ kind: "aborted" });
  expect(seen?.aborted).toBe(true);
  expect(settled).toEqual([
    { extension: "calc", scopeId: "calc", verb: "wait", outcome: "aborted", activeMs: 0 },
  ]);
});

test("the same verb in two extensions is two methods, each runs its own handler", async () => {
  const t = await createTestHost();
  await t.host.install(
    makeUnit({ name: "ext-a", methods: [declOf("ping")] }, (g) => {
      hostOf(g).registerMethod("ping", { handler: () => Promise.resolve("a") });
    }),
  );
  await t.host.install(
    makeUnit({ name: "ext-b", methods: [declOf("ping")] }, (g) => {
      hostOf(g).registerMethod("ping", { handler: () => Promise.resolve("b") });
    }),
  );
  expect(await t.host.methods.call(callOf("ext-a", "ping", {}))).toEqual({
    kind: "ok",
    value: "a",
  });
  expect(await t.host.methods.call(callOf("ext-b", "ping", {}))).toEqual({
    kind: "ok",
    value: "b",
  });
  expect(t.host.methods.list()).toEqual([
    { extension: "ext-a", verb: "ping", decl: declOf("ping"), scopeId: "ext-a" },
    { extension: "ext-b", verb: "ping", decl: declOf("ping"), scopeId: "ext-b" },
  ]);
});

test("switching a Registration off and on again registers the method and compiles its schema again", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.install(
    makeUnit({ name: "calc", methods: [declOf("sum", sumParams, sumResult)] }, (g) => {
      hostOf(g).registerMethod("sum", {
        handler: (params) => Promise.resolve({ total: nOf(params) }),
      });
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  t.host.registration("calc")?.disable();
  await t.settled();
  expect(t.host.methods.list()).toEqual([]);
  t.host.registration("calc")?.enable();
  await t.settled();
  expect(t.host.methods.list().map((method) => method.verb)).toEqual(["sum"]);
  expect(await t.host.methods.call(callOf("calc", "sum", { n: 0 }, thread))).toEqual({
    kind: "params_invalid",
    issues: [{ path: "/n", message: "must be >= 1" }],
  });
  expect(await t.host.methods.call(callOf("calc", "sum", { n: 4 }, thread))).toEqual({
    kind: "ok",
    value: { total: 4 },
  });
});

test("with a thread open the handler runs in the thread's ambient, so commit works without no_thread", async () => {
  const t = await createTestHost();
  const CountSchema = Type.Object({ n: Type.Integer({ minimum: 0 }) });
  const thread = t.newThread();
  await t.host.install(
    makeUnit<{ readonly n: number }>(
      {
        name: "counter",
        def: { state: { schema: CountSchema, initial: { n: 0 }, version: 1 } },
        methods: [
          declOf(
            "bump",
            {},
            { type: "object", properties: { n: { type: "integer" } }, required: ["n"] },
          ),
        ],
      },
      (g) => {
        hostOf(g).registerMethod("bump", {
          handler: async () => {
            const next = await g.commit({ n: g.state().n + 1 });
            return { n: next.n };
          },
        });
      },
    ),
  );
  await t.host.openThread(thread);
  await t.settled();
  expect(await t.host.methods.call(callOf("counter", "bump", {}, thread))).toEqual({
    kind: "ok",
    value: { n: 1 },
  });
  expect(await t.host.methods.call(callOf("counter", "bump", {}, thread))).toEqual({
    kind: "ok",
    value: { n: 2 },
  });
});

test("without a thread the handler has no ambient, so commit fails with no_thread", async () => {
  const t = await createTestHost();
  const CountSchema = Type.Object({ n: Type.Integer({ minimum: 0 }) });
  await t.host.install(
    makeUnit<{ readonly n: number }>(
      {
        name: "counter",
        def: { state: { schema: CountSchema, initial: { n: 0 }, version: 1 } },
        methods: [declOf("probe", {}, { type: "string" })],
      },
      (g) => {
        hostOf(g).registerMethod("probe", {
          handler: async () => {
            const outcome = await attemptAsync(() => g.commit({ n: 9 }));
            if (outcome.ok) return "committed";
            return outcome.error.cause instanceof PrimitiveError
              ? outcome.error.cause.code
              : "unexpected";
          },
        });
      },
    ),
  );
  expect(await t.host.methods.call(callOf("counter", "probe", {}))).toEqual({
    kind: "ok",
    value: "no_thread",
  });
});

test("the handler gets the given callId or a new one, and a null threadId when the call has no thread", async () => {
  const t = await createTestHost();
  await t.host.install(
    makeUnit({ name: "calc", methods: [declOf("who", {}, { type: "string" })] }, (g) => {
      hostOf(g).registerMethod("who", {
        handler: (_params, ctx) =>
          Promise.resolve(ctx.threadId === null ? `call:${ctx.callId}` : "thread"),
      });
    }),
  );
  expect(await t.host.methods.call(callOf("calc", "who", {}, null, "call-7"))).toEqual({
    kind: "ok",
    value: "call:call-7",
  });
  expect(await t.host.methods.call(callOf("calc", "who", {}))).toMatchObject({
    kind: "ok",
    value: expect.stringMatching(/^call:[0-9a-f]{8}-[0-9a-f-]{27}$/),
  });
});

test("the reported activeMs is the handler's own time, and a throwing observer does not change the outcome", async () => {
  const observed: ExtMethodSettled[] = [];
  const t = await createTestHost({
    onMethodSettled: (info) => {
      observed.push(info);
      throw new Error("observer");
    },
  });
  await t.host.install(
    makeUnit({ name: "calc", methods: [declOf("slow", {}, { type: "string" })] }, (g) => {
      hostOf(g).registerMethod("slow", {
        handler: async () => {
          await t.timers.advance(7);
          return "done";
        },
      });
    }),
  );
  expect(await t.host.methods.call(callOf("calc", "slow", {}))).toEqual({
    kind: "ok",
    value: "done",
  });
  expect(observed).toEqual([
    { extension: "calc", scopeId: "calc", verb: "slow", outcome: "ok", activeMs: 7 },
  ]);
  expect(
    t.diagnostics.filter((d) => d.message === "onMethodSettled threw").map((d) => d.level),
  ).toEqual(["error"]);
});
