import { afterAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { PLUGIN_HOST_MAX_FRAME_BYTES } from "@fresnel/contracts/extensions";
import {
  cleanupTempRoots,
  frameOf,
  initParams,
  startHost,
  THREAD_ID,
  writePluginRoot,
  type RunningHost,
} from "./support/host.ts";

afterAll(cleanupTempRoots);

/** 한 대화의 문맥 필드. 훅과 도구와 명령과 메서드 호출이 같이 쓴다 */
function context(state: object = { count: 7 }): object {
  return {
    threadId: THREAD_ID,
    deadlineMs: null,
    replay: false,
    caller: "engine",
    state,
    settings: { "ext.demo.limit": 3 },
  };
}

/** 엔트리 하나를 올리고 host.init 응답까지 기다린다 */
async function initialize(
  host: RunningHost,
  root: string,
  settings: Readonly<Record<string, unknown>> = {},
): Promise<unknown> {
  host.send({ id: 1, method: "host.init", params: initParams(root, settings) });
  const reply = await host.out.waitFor((frame) => frame.id === 1);
  return reply;
}

/** 주 시험 엔트리: 도구, 명령, 메서드, 훅 세 가지 fold, 상태 커밋, 설정, 호출 문맥, 스트림 알림 */
const MAIN_ENTRY = `
import { Type } from "typebox";
import { hostOf } from "@fresnel/ext-host";

export default function extension({ register }) {
  register("demo", { state: { schema: Type.Object({ count: Type.Number() }), initial: { count: 0 }, version: 1 }, defaultEnabled: true }, (g) => {
    const host = hostOf(g);
    host.registerTool({
      name: "echo",
      description: "echo text",
      parameters: Type.Object({ text: Type.String() }),
      replay: "safe",
      execute: async (args, ctx) => ({
        echoed: args.text,
        call: ctx.toolCallId,
        caller: ctx.caller,
      }),
    });
    host.registerCommand("hello", { description: "say hi", handler: async (args) => "hi " + args });
    host.registerMethod("ping", { handler: async (params) => ({ pong: params.n }) });
    g.on("boundary.turn.before", () => undefined);
    g.on("boundary.turn.before", () => "second");
    g.on("tool.call.before", (payload, ctx) => {
      const call = host.callContext();
      return {
        seen: g.state().count,
        threadId: ctx.threadId,
        limit: host.settingValue("ext.demo.limit"),
        callKind: call === undefined ? null : call.kind,
      };
    });
    g.on("request.context.before", (payload, current, ctx) => ({ ...current, extra: ctx.state.count }));
    g.on("boundary.settle.after", async () => {
      const committed = await g.commit({ count: g.state().count + 1 });
      return { committed: committed.count, now: g.state().count };
    });
    g.on("request.stream", () => {
      throw new Error("stream boom");
    });
  });
}
`;

describe("host.init", () => {
  test("answers with the registrations, hooks, tools, commands and methods the entry declared", async () => {
    const root = await writePluginRoot(MAIN_ENTRY);
    const host = startHost();
    const reply = await initialize(host, root);
    expect(reply).toMatchObject({
      id: 1,
      result: {
        protocolVersion: 1,
        registrations: [
          {
            id: "demo",
            defaultEnabled: true,
            state: { initial: { count: 0 }, version: 1 },
            hooks: [
              { point: "boundary.turn.before", handlerIndex: 0 },
              { point: "boundary.turn.before", handlerIndex: 1 },
              { point: "tool.call.before", handlerIndex: 0 },
              { point: "request.context.before", handlerIndex: 0 },
              { point: "boundary.settle.after", handlerIndex: 0 },
              { point: "request.stream", handlerIndex: 0 },
            ],
            tools: [
              {
                name: "echo",
                def: {
                  name: "echo",
                  description: "echo text",
                  replay: "safe",
                  parameters: { type: "object", properties: { text: { type: "string" } } },
                },
              },
            ],
            commands: [{ name: "hello", description: "say hi" }],
            methods: [{ verb: "ping" }],
            flags: [],
            hasDisposers: false,
          },
        ],
      },
    });
    host.input.end();
    expect(await host.exit).toBe("stdin_closed");
  });

  test("a protocol version other than the host's is refused with protocol_version", async () => {
    const root = await writePluginRoot(MAIN_ENTRY);
    const host = startHost();
    host.send({ id: 1, method: "host.init", params: { ...initParams(root), protocolVersion: 99 } });
    const reply = await host.out.waitFor((frame) => frame.id === 1);
    expect(reply.error).toEqual({
      kind: "protocol_version",
      message: "this host speaks protocol 1, the engine sent 99",
    });
    expect(await host.exit).toBe("init_failed");
  });

  test("a request before host.init is refused at once and host.init still works afterwards", async () => {
    const root = await writePluginRoot(MAIN_ENTRY);
    const host = startHost();
    host.send({
      id: 9,
      method: "hook.invoke",
      params: {
        ...context({}),
        registration: "demo",
        point: "tool.call.before",
        handlerIndex: 0,
        payload: {},
        current: null,
      },
    });
    expect((await host.out.waitFor((frame) => frame.id === 9)).error).toMatchObject({
      kind: "invalid_params",
      message: "host.init must be the first request",
    });
    const reply = await initialize(host, root);
    expect(reply).toMatchObject({ id: 1, result: { protocolVersion: 1 } });
    host.input.end();
    expect(await host.exit).toBe("stdin_closed");
  });

  test("an entry outside the extension root is not imported", async () => {
    const root = await writePluginRoot(MAIN_ENTRY);
    const outside = await writePluginRoot(MAIN_ENTRY);
    const host = startHost();
    const entry = relative(root, join(outside, "src", "index.ts"));
    host.send({ id: 1, method: "host.init", params: { ...initParams(root), entry } });
    const reply = await host.out.waitFor((frame) => frame.id === 1);
    expect(reply.error).toMatchObject({ kind: "handler_threw" });
    expect(reply.error?.message).toContain("outside the extension root");
    expect(await host.exit).toBe("init_failed");
  });

  test("a setup that refuses with err(SetupRefusal) fails init with handler_threw", async () => {
    const root = await writePluginRoot(`
export default function extension({ register }) {
  register("demo", {}, () => ({ ok: false, error: { reason: "no-dir", cause: null } }));
}
`);
    const host = startHost();
    const reply = await initialize(host, root);
    expect(reply).toMatchObject({ id: 1, error: { kind: "handler_threw" } });
    expect(reply).toMatchObject({ error: { message: expect.stringContaining("no-dir") } });
    expect(await host.exit).toBe("init_failed");
  });

  test("a drive registration fails init with unsupported_api naming drive", async () => {
    const root = await writePluginRoot(`
export default function extension({ register }) {
  register("demo", {}, (g) => {
    g.drive(async () => undefined);
  });
}
`);
    const host = startHost();
    const reply = await initialize(host, root);
    expect(reply).toMatchObject({ id: 1, error: { kind: "unsupported_api" } });
    expect(reply).toMatchObject({ error: { message: expect.stringContaining("drive") } });
    expect(await host.exit).toBe("init_failed");
  });

  test("a migrateState call fails init with unsupported_api naming migrateState", async () => {
    const root = await writePluginRoot(`
import { Type } from "typebox";
import { hostOf } from "@fresnel/ext-host";
export default function extension({ register }) {
  register("demo", { state: { schema: Type.Object({}), initial: {}, version: 2 } }, (g) => {
    hostOf(g).migrateState((doc) => doc);
  });
}
`);
    const host = startHost();
    const reply = await initialize(host, root);
    expect(reply).toMatchObject({ id: 1, error: { kind: "unsupported_api" } });
    expect(reply).toMatchObject({ error: { message: expect.stringContaining("migrateState") } });
    expect(await host.exit).toBe("init_failed");
  });
});

describe("hook.invoke", () => {
  test("tap, first and chain folds return the handler values and see the request state snapshot", async () => {
    const root = await writePluginRoot(MAIN_ENTRY);
    const host = startHost();
    await initialize(host, root);

    host.send({
      id: 2,
      method: "hook.invoke",
      params: {
        ...context(),
        registration: "demo",
        point: "boundary.turn.before",
        handlerIndex: 1,
        payload: {},
        current: null,
      },
    });
    expect((await host.out.waitFor((frame) => frame.id === 2)).result).toBe("second");

    host.send({
      id: 3,
      method: "hook.invoke",
      params: {
        ...context({ count: 7 }),
        registration: "demo",
        point: "tool.call.before",
        handlerIndex: 0,
        payload: { name: "echo" },
        current: null,
      },
    });
    expect((await host.out.waitFor((frame) => frame.id === 3)).result).toEqual({
      seen: 7,
      threadId: THREAD_ID,
      limit: 3,
      callKind: "on",
    });

    host.send({
      id: 4,
      method: "hook.invoke",
      params: {
        ...context({ count: 7 }),
        registration: "demo",
        point: "request.context.before",
        handlerIndex: 0,
        payload: {},
        current: { messages: ["a"] },
      },
    });
    expect((await host.out.waitFor((frame) => frame.id === 4)).result).toEqual({
      messages: ["a"],
      extra: 7,
    });
  });

  test("g.commit goes out as engine.call with the request id, and its response updates g.state()", async () => {
    const root = await writePluginRoot(MAIN_ENTRY);
    const host = startHost();
    await initialize(host, root);

    host.send({
      id: 5,
      method: "hook.invoke",
      params: {
        ...context({ count: 7 }),
        registration: "demo",
        point: "boundary.settle.after",
        handlerIndex: 0,
        payload: {},
        current: null,
      },
    });
    const call = await host.out.waitFor((frame) => frame.method === "engine.call");
    expect(call.id).toBe(1);
    expect(call.params).toEqual({
      method: "commit",
      registration: "demo",
      requestId: 5,
      params: { count: 8 },
    });
    host.send({ id: 1, result: { count: 8 } });
    const reply = await host.out.waitFor((frame) => frame.id === 5);
    expect(reply.result).toEqual({ committed: 8, now: 8 });
  });

  test("a handler that throws answers handler_threw and the host keeps serving", async () => {
    const root = await writePluginRoot(`
export default function extension({ register }) {
  register("demo", {}, (g) => {
    g.on("tool.call.before", () => {
      throw new Error("boom");
    });
    g.on("request.context.before", (payload, current) => ({ ...current, ok: true }));
  });
}
`);
    const host = startHost();
    await initialize(host, root);
    host.send({
      id: 2,
      method: "hook.invoke",
      params: {
        ...context({}),
        registration: "demo",
        point: "tool.call.before",
        handlerIndex: 0,
        payload: {},
        current: null,
      },
    });
    const failed = await host.out.waitFor((frame) => frame.id === 2);
    expect(failed.error).toEqual({ kind: "handler_threw", message: "boom" });

    host.send({
      id: 3,
      method: "hook.invoke",
      params: {
        ...context({}),
        registration: "demo",
        point: "request.context.before",
        handlerIndex: 0,
        payload: {},
        current: { messages: [] },
      },
    });
    expect((await host.out.waitFor((frame) => frame.id === 3)).result).toEqual({
      messages: [],
      ok: true,
    });
  });

  test("request.cancel aborts the handler's ctx signal", async () => {
    const root = await writePluginRoot(`
export default function extension({ register }) {
  register("demo", {}, (g) => {
    g.on("tool.call.before", (payload, ctx) => {
      const aborted = new Promise((resolve) => {
        ctx.signal.addEventListener("abort", () => resolve("aborted"));
      });
      g.recordPrivate("x.demo.started", { ok: true });
      return aborted;
    });
  });
}
`);
    const host = startHost();
    await initialize(host, root);
    host.send({
      id: 2,
      method: "hook.invoke",
      params: {
        ...context({}),
        registration: "demo",
        point: "tool.call.before",
        handlerIndex: 0,
        payload: {},
        current: null,
      },
    });
    // 핸들러가 신호를 붙이고 나서 엔진 호출을 낸 뒤에 취소한다. 그래야 취소가 요청에 닿는다
    await host.out.waitFor((frame) => frame.method === "engine.call");
    host.send({ method: "request.cancel", params: { id: 2 } });
    expect((await host.out.waitFor((frame) => frame.id === 2)).result).toBe("aborted");
  });

  test("an unknown registration or handler answers unknown_target and a malformed one invalid_params", async () => {
    const root = await writePluginRoot(MAIN_ENTRY);
    const host = startHost();
    await initialize(host, root);
    host.send({
      id: 2,
      method: "hook.invoke",
      params: {
        ...context({}),
        registration: "nope",
        point: "tool.call.before",
        handlerIndex: 0,
        payload: {},
        current: null,
      },
    });
    expect((await host.out.waitFor((frame) => frame.id === 2)).error).toMatchObject({
      kind: "unknown_target",
    });
    host.send({ id: 3, method: "hook.invoke", params: { registration: "demo" } });
    expect((await host.out.waitFor((frame) => frame.id === 3)).error).toMatchObject({
      kind: "invalid_params",
    });
    host.send({ id: 4, method: "nope.request", params: {} });
    expect((await host.out.waitFor((frame) => frame.id === 4)).error).toMatchObject({
      kind: "unknown_target",
    });
  });

  test("a result over the frame cap is replaced by a frame_too_large error", async () => {
    const root = await writePluginRoot(`
export default function extension({ register }) {
  register("demo", {}, (g) => {
    g.on("boundary.step.after", () => "x".repeat(${PLUGIN_HOST_MAX_FRAME_BYTES}));
  });
}
`);
    const host = startHost();
    await initialize(host, root);
    host.send({
      id: 2,
      method: "hook.invoke",
      params: {
        ...context({}),
        registration: "demo",
        point: "boundary.step.after",
        handlerIndex: 0,
        payload: {},
        current: null,
      },
    });
    const reply = await host.out.waitFor((frame) => frame.id === 2);
    expect(reply.error).toMatchObject({ kind: "frame_too_large" });
  });
});

describe("tool, command and method calls", () => {
  test("tool.execute, command.run and method.call reach their handlers and return their values", async () => {
    const root = await writePluginRoot(MAIN_ENTRY);
    const host = startHost();
    await initialize(host, root);

    host.send({
      id: 2,
      method: "tool.execute",
      params: {
        ...context(),
        registration: "demo",
        name: "echo",
        args: { text: "hi" },
        toolCallId: "call-1",
        callerInfo: { kind: "model", agent: "subagent", afterUntrusted: true },
      },
    });
    expect((await host.out.waitFor((frame) => frame.id === 2)).result).toEqual({
      echoed: "hi",
      call: "call-1",
      caller: { kind: "model", agent: "subagent", afterUntrusted: true },
    });

    host.send({
      id: 3,
      method: "command.run",
      params: {
        ...context(),
        registration: "demo",
        name: "hello",
        args: "world",
        invocationId: "inv-1",
      },
    });
    expect((await host.out.waitFor((frame) => frame.id === 3)).result).toBe("hi world");

    host.send({
      id: 4,
      method: "method.call",
      params: {
        ...context(),
        registration: "demo",
        verb: "ping",
        params: { n: 5 },
        callId: "m-1",
        callerKind: "wire",
      },
    });
    expect((await host.out.waitFor((frame) => frame.id === 4)).result).toEqual({ pong: 5 });
  });
});

describe("disposers and shutdown", () => {
  const DISPOSING_ENTRY = `
import { writeFileSync } from "node:fs";
export default function extension({ register }) {
  register("demo", {}, (g) => {
    g.onDispose(() => {
      writeFileSync(new URL("../marker.txt", import.meta.url), "disposed");
    });
  });
}
`;

  test("scope.dispose runs that registration's disposers and host.dispose ends the host as disposed", async () => {
    const root = await writePluginRoot(DISPOSING_ENTRY);
    const host = startHost();
    await initialize(host, root);

    host.send({ id: 2, method: "scope.dispose", params: { registration: "demo" } });
    expect((await host.out.waitFor((frame) => frame.id === 2)).result).toBeNull();
    expect(await readFile(join(root, "marker.txt"), "utf8")).toBe("disposed");

    host.send({ id: 3, method: "host.dispose", params: { reason: "shutdown" } });
    expect((await host.out.waitFor((frame) => frame.id === 3)).result).toBeNull();
    expect(await host.exit).toBe("disposed");
  });

  test("closing the input runs the disposers and ends the host as stdin_closed", async () => {
    const root = await writePluginRoot(DISPOSING_ENTRY);
    const host = startHost();
    await initialize(host, root);
    host.input.end();
    expect(await host.exit).toBe("stdin_closed");
    expect(await readFile(join(root, "marker.txt"), "utf8")).toBe("disposed");
  });
});

describe("notifications", () => {
  test("an event.notify handler that throws is reported on stderr and sends no reply", async () => {
    const root = await writePluginRoot(MAIN_ENTRY);
    const host = startHost();
    await initialize(host, root);
    host.send({
      method: "event.notify",
      params: {
        ...context({}),
        registration: "demo",
        point: "request.stream",
        handlerIndex: 0,
        eventKey: "e-1",
        payload: { text: "t" },
      },
    });
    expect(await host.diagnostics.waitForText("stream boom")).toContain(
      "event handler of demo failed: stream boom",
    );
    host.send({
      id: 2,
      method: "hook.invoke",
      params: {
        ...context({}),
        registration: "demo",
        point: "boundary.turn.before",
        handlerIndex: 1,
        payload: {},
        current: null,
      },
    });
    await host.out.waitFor((frame) => frame.id === 2);
    const replyIds = host.out.lines.map(frameOf).map((frame) => frame.id);
    expect(replyIds).toEqual([1, 2]);
  });
});

describe("engine calls from a handler", () => {
  test("g.capability sends the key, the member and the input, and the options without the signal", async () => {
    const root = await writePluginRoot(`
export default function extension({ register }) {
  register("demo", {}, (g) => {
    const cap = g.capability({ capability: "fresnel.demo", version: "1.0.0" });
    g.on("tool.call.before", (payload, ctx) => cap.ping({ n: 1 }, { signal: ctx.signal, timeoutMs: 5 }));
  });
}
`);
    const host = startHost();
    await initialize(host, root);
    host.send({
      id: 2,
      method: "hook.invoke",
      params: {
        ...context({}),
        registration: "demo",
        point: "tool.call.before",
        handlerIndex: 0,
        payload: {},
        current: null,
      },
    });
    const call = await host.out.waitFor((frame) => frame.method === "engine.call");
    expect(call.params).toEqual({
      method: "capability",
      registration: "demo",
      requestId: 2,
      params: {
        key: { capability: "fresnel.demo", version: "1.0.0" },
        member: "ping",
        input: { n: 1 },
        options: { timeoutMs: 5 },
      },
    });
    host.send({ id: call.id, result: { pong: true } });
    expect((await host.out.waitFor((frame) => frame.id === 2)).result).toEqual({ pong: true });
  });

  test("g.post sends the item and options and returns the engine's receipt", async () => {
    const root = await writePluginRoot(`
export default function extension({ register }) {
  register("demo", {}, (g) => {
    g.on("tool.call.before", () => g.post({ kind: "user", content: "hi" }, { when: "next", requestId: "r1" }));
  });
}
`);
    const host = startHost();
    await initialize(host, root);
    host.send({
      id: 2,
      method: "hook.invoke",
      params: {
        ...context({}),
        registration: "demo",
        point: "tool.call.before",
        handlerIndex: 0,
        payload: {},
        current: null,
      },
    });
    const call = await host.out.waitFor((frame) => frame.method === "engine.call");
    expect(call.params).toEqual({
      method: "post",
      registration: "demo",
      requestId: 2,
      params: { item: { kind: "user", content: "hi" }, options: { when: "next", requestId: "r1" } },
    });
    host.send({ id: call.id, result: { requestId: "r1", duplicate: false } });
    expect((await host.out.waitFor((frame) => frame.id === 2)).result).toEqual({
      requestId: "r1",
      duplicate: false,
    });
  });

  test("an engine failure reaches the handler as an exception and the hook answers handler_threw", async () => {
    const root = await writePluginRoot(MAIN_ENTRY);
    const host = startHost();
    await initialize(host, root);
    host.send({
      id: 5,
      method: "hook.invoke",
      params: {
        ...context({ count: 7 }),
        registration: "demo",
        point: "boundary.settle.after",
        handlerIndex: 0,
        payload: {},
        current: null,
      },
    });
    const call = await host.out.waitFor((frame) => frame.method === "engine.call");
    host.send({ id: call.id, error: { kind: "state_conflict", message: "conflict" } });
    const reply = await host.out.waitFor((frame) => frame.id === 5);
    expect(reply.error).toEqual({ kind: "handler_threw", message: "conflict" });
  });
});
