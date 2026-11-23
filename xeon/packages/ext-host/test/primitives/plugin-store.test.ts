import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import {
  ToolsPortKey,
  type ExtMethodDecl,
  type RegistrationApi,
  type ToolResourceDef,
} from "@fresnel/contracts/extensions";
import { Type } from "typebox";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { hostOf, PrimitiveError } from "../../src/primitives/index.ts";
import { createTestHost, memoryPluginStore } from "../../src/testing/index.ts";
import { makeUnit } from "./fixtures/support.ts";

// 플러그인 전용 저장소(X.primitives.spec §4.6.7). 쓰기는 확장 메서드 처리기 안에서만, 읽기 메서드에서는 쓰기를 거부하는지 본다

type Host = Awaited<ReturnType<typeof createTestHost>>;
type Job = (g: RegistrationApi<never>, verb: string) => Promise<unknown>;

interface Probe {
  out: unknown;
  job: Job;
}

interface Verb {
  readonly verb: string;
  readonly readOnly?: boolean;
  readonly ownDataOnly?: boolean;
}

function decl(verb: Verb): ExtMethodDecl {
  return {
    verb: verb.verb,
    params: {},
    result: {},
    readOnly: verb.readOnly === true,
    ...(verb.ownDataOnly === true ? { ownDataOnly: true } : {}),
  };
}

/** 메서드 하나의 처리기는 `probe.job`을 부르고 그 값을 `probe.out`에 남긴다 */
function storeUnit(name: string, verbs: readonly Verb[], probe: Probe, loadIndex = 0) {
  return makeUnit({ name, loadIndex, methods: verbs.map(decl) }, (g) => {
    const api = hostOf(g);
    for (const verb of verbs) {
      api.registerMethod(verb.verb, {
        handler: async () => {
          probe.out = await probe.job(g, verb.verb);
          return null;
        },
      });
    }
  });
}

/** 메서드를 부른다. `thread`가 null이면 대화가 없는 호출이다 */
function callVerb(t: Host, extension: string, verb: string, thread: ThreadId | null) {
  return t.host.methods.call({
    extension,
    verb,
    params: {},
    threadId: thread,
    signal: new AbortController().signal,
    caller: "ui",
  });
}

/** 저장할 값에 주인 이름을 붙이는 작업 */
function tagged(tag: string): Job {
  return async (g, verb) =>
    verb === "save"
      ? g.pluginStore.put("shared.key", { owner: tag })
      : g.pluginStore.get("shared.key");
}

/** 실패의 PrimitiveError 코드. 성공이면 "ok" */
async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "ok";
  } catch (error) {
    return error instanceof PrimitiveError ? error.code : "not_primitive_error";
  }
}

/** 값으로 돌아온 저장소 오류의 종류. 성공이면 "ok" */
function kindOf(result: { readonly ok: boolean; readonly error?: { readonly kind: string } }) {
  return result.ok ? "ok" : result.error?.kind;
}

test("a method without a conversation puts and reads its store, and the values compare equal", async () => {
  const port = memoryPluginStore();
  const t = await createTestHost({ pluginStore: port });
  const probe: Probe = { out: undefined, job: async () => null };
  await t.host.install(
    storeUnit("ps-solo", [{ verb: "save" }, { verb: "load", readOnly: true }], probe),
  );
  probe.job = async (g, verb) =>
    verb === "save"
      ? g.pluginStore.put("note.one", { text: "hi", n: 2, tags: ["a", null] })
      : g.pluginStore.get("note.one");
  await callVerb(t, "ps-solo", "save", null);
  expect(probe.out).toEqual({ ok: true, value: undefined });
  await callVerb(t, "ps-solo", "load", null);
  expect(probe.out).toEqual({ ok: true, value: { text: "hi", n: 2, tags: ["a", null] } });
  // 포트에도 같은 값이 JSON으로 남는다
  expect(await port.get("ps-solo", "note.one")).toEqual({
    ok: true,
    value: '{"text":"hi","n":2,"tags":["a",null]}',
  });
});

test("the same key of two plugins is stored and read separately", async () => {
  const port = memoryPluginStore();
  const t = await createTestHost({ pluginStore: port });
  const probeA: Probe = { out: undefined, job: tagged("A") };
  const probeB: Probe = { out: undefined, job: tagged("B") };
  await t.host.install(
    storeUnit("ps-a", [{ verb: "save" }, { verb: "load", readOnly: true }], probeA),
  );
  await t.host.install(
    storeUnit("ps-b", [{ verb: "save" }, { verb: "load", readOnly: true }], probeB, 1),
  );
  await callVerb(t, "ps-a", "save", null);
  await callVerb(t, "ps-b", "save", null);
  await callVerb(t, "ps-a", "load", null);
  const readByA = probeA.out;
  await callVerb(t, "ps-b", "load", null);
  expect(readByA).toEqual({ ok: true, value: { owner: "A" } });
  expect(probeB.out).toEqual({ ok: true, value: { owner: "B" } });
  expect(await port.get("ps-a", "shared.key")).toEqual({ ok: true, value: '{"owner":"A"}' });
  expect(await port.get("ps-b", "shared.key")).toEqual({ ok: true, value: '{"owner":"B"}' });
});

test("a readOnly method cannot put, an ownDataOnly or plain method can, and the store is written only by a method", async () => {
  const port = memoryPluginStore();
  const t = await createTestHost({ pluginStore: port });
  const codes: Record<string, string> = {};
  const probe: Probe = { out: undefined, job: async () => null };
  await t.host.install(
    storeUnit(
      "ps-roles",
      [{ verb: "ro", readOnly: true }, { verb: "own", ownDataOnly: true }, { verb: "plain" }],
      probe,
    ),
  );
  probe.job = async (g, verb) => {
    codes[verb] = await codeOf(() => g.pluginStore.put(`role.${verb}`, { verb }));
    return null;
  };
  const thread = t.newThread();
  await t.host.openThread(thread);
  await callVerb(t, "ps-roles", "ro", thread);
  await callVerb(t, "ps-roles", "own", thread);
  await callVerb(t, "ps-roles", "plain", null);
  expect(codes).toEqual({ ro: "read_only_method", own: "ok", plain: "ok" });
  expect(await port.get("ps-roles", "role.ro")).toEqual({ ok: true, value: null });
  expect(await port.get("ps-roles", "role.own")).toEqual({ ok: true, value: '{"verb":"own"}' });
});

test("put and delete in setup and in an on handler are rejected, and nothing is written", async () => {
  const port = memoryPluginStore();
  const t = await createTestHost({ pluginStore: port });
  const codes: Record<string, string> = {};
  await t.host.install(
    makeUnit({ name: "ps-ctx", hooks: ["boundary.settle.after"] }, async (g) => {
      codes.setup = await codeOf(() => g.pluginStore.put("ctx.setup", { n: 1 }));
      g.on("boundary.settle.after", async () => {
        codes.hookPut = await codeOf(() => g.pluginStore.put("ctx.hook", { n: 2 }));
        codes.hookDelete = await codeOf(() => g.pluginStore.delete("ctx.hook"));
        // 읽기는 어디서나 된다
        codes.hookGet = (await g.pluginStore.get("ctx.hook")).ok ? "ok" : "failed";
      });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.host.dispatch(
    "boundary.settle.after",
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "ps-ctx:1" },
  );
  expect(codes).toEqual({
    setup: "store_outside_method",
    hookPut: "store_outside_method",
    hookDelete: "store_outside_method",
    hookGet: "ok",
  });
  expect(await port.list("ps-ctx", "")).toEqual({ ok: true, value: [] });
});

test("the key format is checked, a value over 64 KiB is refused, and the boundary is inclusive", async () => {
  const t = await createTestHost({ pluginStore: memoryPluginStore() });
  const out: Record<string, unknown> = {};
  const probe: Probe = { out: undefined, job: async () => null };
  await t.host.install(storeUnit("ps-form", [{ verb: "run" }], probe));
  probe.job = async (g) => {
    const bad: readonly [string, string][] = [
      ["upper", "Bad"],
      ["lead", "-lead"],
      ["slash", "a/b"],
      ["empty", ""],
      ["long", "a".repeat(65)],
      ["space", "x y"],
    ];
    const rows = await Promise.all(
      bad.map(async ([label, key]) => [label, kindOf(await g.pluginStore.put(key, 1))] as const),
    );
    for (const [label, kind] of rows) out[label] = kind;
    out.longKey = kindOf(await g.pluginStore.put("a".repeat(64), 1));
    // 직렬화 65536바이트(따옴표 포함)는 된다, 65537바이트는 안 된다
    out.valueAtLimit = kindOf(await g.pluginStore.put("big.ok", "x".repeat(65534)));
    out.valueOverLimit = kindOf(await g.pluginStore.put("big.over", "x".repeat(65535)));
    out.getKeyInvalid = kindOf(await g.pluginStore.get("Bad"));
    return null;
  };
  await callVerb(t, "ps-form", "run", null);
  expect(out).toEqual({
    upper: "store_key_invalid",
    lead: "store_key_invalid",
    slash: "store_key_invalid",
    empty: "store_key_invalid",
    long: "store_key_invalid",
    space: "store_key_invalid",
    longKey: "ok",
    valueAtLimit: "ok",
    valueOverLimit: "store_value_too_large",
    getKeyInvalid: "store_key_invalid",
  });
});

test("the 257th key is refused with store_full", async () => {
  const t = await createTestHost({ pluginStore: memoryPluginStore() });
  const out: Record<string, unknown> = {};
  const probe: Probe = { out: undefined, job: async () => null };
  await t.host.install(storeUnit("ps-count", [{ verb: "run" }], probe));
  probe.job = async (g) => {
    // 한 플러그인의 쓰기는 들어온 순서로 하나씩 실행된다(X.primitives.spec §4.6.7)
    const puts = await Promise.all(
      Array.from({ length: 256 }, (_, index) => g.pluginStore.put(`k.${index + 1}`, index + 1)),
    );
    out.refused = puts.filter((result) => !result.ok).length;
    out.k257 = kindOf(await g.pluginStore.put("k.257", 257));
    // 기존 키의 덮어쓰기는 키 수를 늘리지 않는다
    out.overwrite = kindOf(await g.pluginStore.put("k.256", 0));
    return null;
  };
  await callVerb(t, "ps-count", "run", null);
  expect(out).toEqual({ refused: 0, k257: "store_full", overwrite: "ok" });
});

test("the 1 MiB total is refused with store_full, and overwriting a key gives its old bytes back", async () => {
  const port = memoryPluginStore();
  const t = await createTestHost({ pluginStore: port });
  const out: Record<string, unknown> = {};
  const probe: Probe = { out: undefined, job: async () => null };
  await t.host.install(storeUnit("ps-total", [{ verb: "run" }], probe));
  probe.job = async (g) => {
    // 값 하나가 60002바이트이므로 17개는 1048576 안에 든다. 18번째부터 넘는다
    const big = "a".repeat(60000);
    const first = await Promise.all(
      Array.from({ length: 17 }, (_, index) => g.pluginStore.put(`t.${index + 1}`, big)),
    );
    out.first17 = first.every((result) => result.ok) ? "ok" : "refused";
    out.t18 = kindOf(await g.pluginStore.put("t.18", big));
    out.shrink = kindOf(await g.pluginStore.put("t.1", 1));
    out.t18Again = kindOf(await g.pluginStore.put("t.18", big));
    return null;
  };
  await callVerb(t, "ps-total", "run", null);
  expect(out.first17).toBe("ok");
  expect(out.t18).toBe("store_full");
  expect(out.shrink).toBe("ok");
  expect(out.t18Again).toBe("ok");
  // t.2~t.17은 60002바이트씩, t.1은 "1"(1바이트), t.18은 60002바이트
  expect(await port.usage("ps-total")).toEqual({
    ok: true,
    value: { keys: 18, bytes: 16 * 60002 + 1 + 60002 },
  });
});

async function kindsFor(
  pluginStore: ReturnType<typeof memoryPluginStore> | undefined,
): Promise<Record<string, unknown>> {
  const t = await createTestHost(pluginStore === undefined ? {} : { pluginStore });
  const out: Record<string, unknown> = {};
  const probe: Probe = { out: undefined, job: async () => null };
  await t.host.install(storeUnit("ps-port", [{ verb: "run" }], probe));
  probe.job = async (g) => {
    out.get = kindOf(await g.pluginStore.get("k.one"));
    out.put = kindOf(await g.pluginStore.put("k.one", 1));
    out.delete = kindOf(await g.pluginStore.delete("k.one"));
    out.list = kindOf(await g.pluginStore.list());
    return null;
  };
  await callVerb(t, "ps-port", "run", null);
  return out;
}

test("without a port, or with a failing port, the store answers storage_unavailable", async () => {
  const unavailable = {
    get: "storage_unavailable",
    put: "storage_unavailable",
    delete: "storage_unavailable",
    list: "storage_unavailable",
  };
  expect(await kindsFor(undefined)).toEqual(unavailable);
  expect(await kindsFor(memoryPluginStore({ fail: true }))).toEqual(unavailable);
});

test("list returns keys in ascending order, filters by prefix, and delete of a missing key is not a failure", async () => {
  const t = await createTestHost({ pluginStore: memoryPluginStore() });
  const out: Record<string, unknown> = {};
  const probe: Probe = { out: undefined, job: async () => null };
  await t.host.install(storeUnit("ps-list", [{ verb: "run" }], probe));
  probe.job = async (g) => {
    await g.pluginStore.put("b.two", 2);
    await g.pluginStore.put("a.two", 22);
    await g.pluginStore.put("a.one", 11);
    await g.pluginStore.put("c.x", 3);
    const prefixed = await g.pluginStore.list("a.");
    out.prefixed = prefixed.ok ? prefixed.value : prefixed.error.kind;
    const all = await g.pluginStore.list();
    out.all = all.ok ? all.value.map((entry) => entry.key) : all.error.kind;
    out.none = kindOf(await g.pluginStore.list("zz"));
    out.badPrefix = kindOf(await g.pluginStore.list("A"));
    out.deleteMissing = kindOf(await g.pluginStore.delete("never.set"));
    await g.pluginStore.delete("a.one");
    const after = await g.pluginStore.list("a.");
    out.afterDelete = after.ok ? after.value : after.error.kind;
    return null;
  };
  await callVerb(t, "ps-list", "run", null);
  expect(out).toEqual({
    prefixed: [
      { key: "a.one", value: 11 },
      { key: "a.two", value: 22 },
    ],
    all: ["a.one", "a.two", "b.two", "c.x"],
    none: "ok",
    badPrefix: "store_key_invalid",
    deleteMissing: "ok",
    afterDelete: [{ key: "a.two", value: 22 }],
  });
});

test("a model tool writes the same store a method reads, in any conversation, and a readOnly method still cannot write", async () => {
  const port = memoryPluginStore();
  const t = await createTestHost({ pluginStore: port });
  const tools = new Map<string, ToolResourceDef>();
  await t.host.registerPlatform({
    name: "test-tools-port",
    setup(ctx) {
      ctx.providePort(ToolsPortKey, {
        toolMappedFor: () => false,
        executeForPlugin: () =>
          Promise.resolve(err({ kind: "unavailable", message: "test double" })),
        register(_owner, def) {
          tools.set(def.name, def);
          return ok(() => {
            tools.delete(def.name);
          });
        },
      });
    },
  });
  const probe: Probe = { out: undefined, job: async (g) => g.pluginStore.get("tool.note") };
  await t.host.install(
    makeUnit(
      { name: "ps-tool", loadIndex: 0, methods: [decl({ verb: "load", readOnly: true })] },
      (g) => {
        const api = hostOf(g);
        api.registerMethod("load", {
          handler: async () => {
            probe.out = await probe.job(g, "load");
            return null;
          },
        });
        api.registerTool({
          name: "ps_tool_save",
          description: "save",
          parameters: Type.Object({}),
          replay: "unsafe",
          execute: async () => g.pluginStore.put("tool.note", { text: "from the tool" }),
        });
      },
    ),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  const def = tools.get("ps_tool_save");
  if (def === undefined) throw new Error("tool is not registered");
  const result = await def.execute(
    {},
    {
      threadId: thread,
      signal: new AbortController().signal,
      toolCallId: "call-1",
      caller: { kind: "model", agent: "main" },
    },
  );
  expect(result).toEqual({ ok: true, value: undefined });
  // 대화 없이 부른 메서드가 같은 값을 읽는다
  await callVerb(t, "ps-tool", "load", null);
  expect(probe.out).toEqual({ ok: true, value: { text: "from the tool" } });
  // readOnly 메서드는 여전히 쓰지 못한다
  probe.job = async (g) => codeOf(() => g.pluginStore.put("tool.note", { text: "x" }));
  await callVerb(t, "ps-tool", "load", null);
  expect(probe.out).toBe("read_only_method");
});

test("a store put and delete announce a data change of the extension, a failed put does not", async () => {
  const port = memoryPluginStore();
  const t = await createTestHost({ pluginStore: port });
  const probe: Probe = { out: undefined, job: async () => null };
  await t.host.install(storeUnit("ps-signal", [{ verb: "save" }], probe));
  const seen: string[] = [];
  t.host.onChange((change) => {
    if (change.kind === "data") seen.push(`${change.extension}:${String(change.threadId)}`);
  });
  probe.job = async (g) => {
    await g.pluginStore.put("n.one", { n: 1 });
    await g.pluginStore.put("Bad Key", { n: 2 });
    await g.pluginStore.delete("n.one");
    return null;
  };
  await callVerb(t, "ps-signal", "save", null);
  expect(seen).toEqual(["ps-signal:null", "ps-signal:null"]);
});
