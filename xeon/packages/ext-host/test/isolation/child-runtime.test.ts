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

  test.each(["providePort", "registerWebProvider"])(
    "a %s call in setup fails init with unsupported_api naming it",
    async (api) => {
      const root = await writePluginRoot(`
import { hostOf } from "@fresnel/ext-host";
export default function extension({ register }) {
  register("demo", {}, (g) => {
    hostOf(g).${api}();
  });
}
`);
      const host = startHost();
      const reply = await initialize(host, root);
      expect(reply).toMatchObject({ id: 1, error: { kind: "unsupported_api" } });
      expect(reply).toMatchObject({ error: { message: expect.stringContaining(api) } });
      expect(await host.exit).toBe("init_failed");
    },
  );

  test("a drive registration is declared with its limits and no longer fails init", async () => {
    const root = await writePluginRoot(`
export default function extension({ register }) {
  register("demo", {}, (g) => {
    g.drive(async () => ({ do: "yield" }), { limits: { maxTurns: 3 } });
  });
}
`);
    const host = startHost();
    const reply = await initialize(host, root);
    expect(reply).toMatchObject({
      id: 1,
      result: { registrations: [{ id: "demo", drive: { limits: { maxTurns: 3 } } }] },
    });
  });

  test("a drive registration without options is declared with no limits", async () => {
    const root = await writePluginRoot(`
export default function extension({ register }) {
  register("demo", {}, (g) => {
    g.drive(async () => ({ do: "yield" }));
  });
}
`);
    const host = startHost();
    const reply = await initialize(host, root);
    expect(reply).toMatchObject({
      id: 1,
      result: { registrations: [{ id: "demo", drive: { limits: null } }] },
    });
  });

  test("a second drive in setup fails init with drive_duplicate", async () => {
    const root = await writePluginRoot(`
export default function extension({ register }) {
  register("demo", {}, (g) => {
    g.drive(async () => ({ do: "yield" }));
    g.drive(async () => ({ do: "yield" }));
  });
}
`);
    const host = startHost();
    const reply = await initialize(host, root);
    expect(reply).toMatchObject({ id: 1, error: { kind: "handler_threw" } });
    expect(reply).toMatchObject({
      error: { message: expect.stringContaining("drive_duplicate") },
    });
    expect(await host.exit).toBe("init_failed");
  });

  test("drive.step runs the step with the input and answers the command with the limits read at that moment", async () => {
    const root = await writePluginRoot(`
export default function extension({ register }) {
  register("demo", { state: { schema: { type: "object" }, initial: { count: 0 }, version: 1 } }, (g) => {
    g.drive(async ({ state, last, budget, frame }) => ({
      do: "done",
      result: { count: state.count, last, budget, frame },
    }), { get limits() { return { maxTurns: 5 }; } });
  });
}
`);
    const host = startHost();
    await initialize(host, root);
    host.send({
      id: 2,
      method: "drive.step",
      params: {
        threadId: THREAD_ID,
        deadlineMs: null,
        replay: false,
        caller: "engine",
        state: { count: 7 },
        settings: {},
        registration: "demo",
        last: null,
        budget: { turns: 4, spawns: null, tokens: null },
        frame: { frameDepth: 1, calledBy: "helm", input: { topic: "t" } },
      },
    });
    expect(await host.out.waitFor((frame) => frame.id === 2)).toEqual({
      id: 2,
      result: {
        command: {
          do: "done",
          result: {
            count: 7,
            last: null,
            budget: { turns: 4, spawns: null, tokens: null },
            frame: { frameDepth: 1, calledBy: "helm", input: { topic: "t" } },
          },
        },
        limits: { maxTurns: 5 },
      },
    });
  });

  test("drive.step fails with handler_threw when the step throws, and with unknown_target for a registration without a drive", async () => {
    const root = await writePluginRoot(`
export default function extension({ register }) {
  register("boom", {}, (g) => {
    g.drive(async () => { throw new Error("step boom"); });
  });
  register("plain", {}, () => undefined);
}
`);
    const host = startHost();
    await initialize(host, root);
    const params = {
      threadId: THREAD_ID,
      deadlineMs: null,
      replay: false,
      caller: "engine",
      state: {},
      settings: {},
      last: null,
      budget: { turns: null, spawns: null, tokens: null },
      frame: { frameDepth: 1, calledBy: null, input: null },
    };
    host.send({ id: 2, method: "drive.step", params: { ...params, registration: "boom" } });
    expect((await host.out.waitFor((frame) => frame.id === 2)).error).toEqual({
      kind: "handler_threw",
      message: "step boom",
    });
    host.send({ id: 3, method: "drive.step", params: { ...params, registration: "plain" } });
    expect((await host.out.waitFor((frame) => frame.id === 3)).error).toEqual({
      kind: "unknown_target",
      message: "no drive of plain",
    });
    host.send({ id: 4, method: "drive.step", params: { ...params, last: { kind: "nope" } } });
    expect((await host.out.waitFor((frame) => frame.id === 4)).error).toMatchObject({
      kind: "invalid_params",
    });
  });

  test("a startDrive call in setup answers no_context at once without asking the engine, and init goes on", async () => {
    const root = await writePluginRoot(`
import { hostOf } from "@fresnel/ext-host";
export default function extension({ register }) {
  register("demo", {}, async (g) => {
    const started = await hostOf(g).startDrive();
    if (started.ok || started.error.kind !== "no_context") throw new Error("setup must see no_context");
  });
}
`);
    const host = startHost();
    const reply = await initialize(host, root);
    expect(reply).toMatchObject({ id: 1, result: { protocolVersion: 1 } });
    expect(host.out.lines.filter((line) => line.includes('"engine.call"'))).toEqual([]);
    host.input.end();
    expect(await host.exit).toBe("stdin_closed");
  });
});

describe("startDrive in an isolated host", () => {
  test("startDrive sends its input as engine.call with the request id and returns the engine's refusal as a value", async () => {
    const root = await writePluginRoot(`
import { hostOf } from "@fresnel/ext-host";
export default function extension({ register }) {
  register("demo", {}, (g) => {
    hostOf(g).registerMethod("start", { handler: (params) => hostOf(g).startDrive(params) });
  });
}
`);
    const host = startHost();
    await initialize(host, root);
    host.send({
      id: 3,
      method: "method.call",
      params: {
        ...context(),
        registration: "demo",
        verb: "start",
        params: { topic: "t" },
        callId: "s-1",
        callerKind: "wire",
      },
    });
    const call = await host.out.waitFor((frame) => frame.method === "engine.call");
    expect(call.params).toEqual({
      method: "startDrive",
      registration: "demo",
      requestId: 3,
      params: { input: { topic: "t" } },
    });
    host.send({ id: call.id, result: { ok: false, error: { kind: "not_drive" } } });
    expect(
      (await host.out.waitFor((frame) => frame.id === 3 && frame.method === undefined)).result,
    ).toEqual({ ok: false, error: { kind: "not_drive" } });
    host.input.end();
    expect(await host.exit).toBe("stdin_closed");
  });

  test("a call without an input sends a null input and a success answers ok", async () => {
    const root = await writePluginRoot(`
import { hostOf } from "@fresnel/ext-host";
export default function extension({ register }) {
  register("demo", {}, (g) => {
    hostOf(g).registerMethod("start", { handler: async () => (await hostOf(g).startDrive()).ok });
  });
}
`);
    const host = startHost();
    await initialize(host, root);
    host.send({
      id: 4,
      method: "method.call",
      params: {
        ...context(),
        registration: "demo",
        verb: "start",
        params: null,
        callId: "s-2",
        callerKind: "wire",
      },
    });
    const call = await host.out.waitFor((frame) => frame.method === "engine.call");
    expect(call.params).toEqual({
      method: "startDrive",
      registration: "demo",
      requestId: 4,
      params: { input: null },
    });
    host.send({ id: call.id, result: { ok: true } });
    expect(
      (await host.out.waitFor((frame) => frame.id === 4 && frame.method === undefined)).result,
    ).toBe(true);
    host.input.end();
    expect(await host.exit).toBe("stdin_closed");
  });
});

/** 상태 버전 2이고 `migrateState`로 `{n}`을 `{count}`로 옮기는 등록 */
const STATE_V2_ENTRY = `
import { Type } from "typebox";
import { hostOf } from "@fresnel/ext-host";
export default function extension({ register }) {
  register("demo", { state: { schema: Type.Object({ count: Type.Number() }), initial: { count: 0 }, version: 2 } }, (g) => {
    hostOf(g).migrateState(async (doc, fromVersion) => ({ count: doc.n * 10 + fromVersion }));
  });
}
`;

/** 훅 하나가 `updateState`로 1을 더한 결과를 돌려주는 등록 */
const UPDATE_ENTRY = `
import { Type } from "typebox";
import { hostOf } from "@fresnel/ext-host";
export default function extension({ register }) {
  register("demo", { state: { schema: Type.Object({ count: Type.Number() }), initial: { count: 0 }, version: 1 } }, (g) => {
    g.on("tool.call.before", () => hostOf(g).updateState((prev) => ({ count: prev.count + 1 })));
  });
}
`;

/** 훅 하나가 사용자 대기를 감싸 기다리고 대기의 값을 돌려주는 등록. 대기가 던지면 그 오류를 던진다 */
const WAIT_ENTRY = `
import { hostOf } from "@fresnel/ext-host";
export default function extension({ register }) {
  register("demo", {}, (g) => {
    g.on("tool.call.before", (payload) => {
      if (payload.toolName === "reject") return hostOf(g).awaitUser(() => Promise.reject(new Error("nope")));
      return hostOf(g).awaitUser(() => Promise.resolve("yes"));
    });
  });
}
`;

/** 호출 문맥으로 `tool.call.before` 훅 하나를 부른다. 상태 스냅샷은 `state`다 */
function hookCall(id: number, state: object, toolName = "echo"): object {
  return {
    id,
    method: "hook.invoke",
    params: {
      ...context(state),
      registration: "demo",
      point: "tool.call.before",
      handlerIndex: 0,
      payload: { toolName },
      current: null,
    },
  };
}

describe("state migration in an isolated host", () => {
  test("migrateState is declared as hasMigration and host.init succeeds", async () => {
    const root = await writePluginRoot(STATE_V2_ENTRY);
    const host = startHost();
    const reply = await initialize(host, root);
    expect(reply).toMatchObject({
      id: 1,
      result: {
        registrations: [{ id: "demo", state: { version: 2 }, hasMigration: true }],
      },
    });
    host.input.end();
    expect(await host.exit).toBe("stdin_closed");
  });

  test("state.migrate runs the migration with the stored document and answers the migrated document", async () => {
    const root = await writePluginRoot(STATE_V2_ENTRY);
    const host = startHost();
    await initialize(host, root);
    host.send({
      id: 2,
      method: "state.migrate",
      params: { registration: "demo", doc: { n: 4 }, fromVersion: 1 },
    });
    expect(await host.out.waitFor((frame) => frame.id === 2)).toEqual({
      id: 2,
      result: { count: 41 },
    });
  });

  test("a migration that throws or answers no document fails the request with handler_threw", async () => {
    const root = await writePluginRoot(`
import { hostOf } from "@fresnel/ext-host";
export default function extension({ register }) {
  register("demo", { state: { schema: { type: "object" }, initial: {}, version: 2 } }, (g) => {
    hostOf(g).migrateState((doc) => {
      if (doc.bad === true) throw new Error("cannot move");
      return undefined;
    });
  });
}
`);
    const host = startHost();
    await initialize(host, root);
    host.send({
      id: 2,
      method: "state.migrate",
      params: { registration: "demo", doc: { bad: true }, fromVersion: 1 },
    });
    expect((await host.out.waitFor((frame) => frame.id === 2)).error).toEqual({
      kind: "handler_threw",
      message: "cannot move",
    });
    host.send({
      id: 3,
      method: "state.migrate",
      params: { registration: "demo", doc: {}, fromVersion: 1 },
    });
    expect((await host.out.waitFor((frame) => frame.id === 3)).error).toEqual({
      kind: "handler_threw",
      message: "the migrated state of demo is not JSON",
    });
  });

  test("a second migrateState fails the setup with state_migration_duplicate", async () => {
    const root = await writePluginRoot(`
import { hostOf } from "@fresnel/ext-host";
export default function extension({ register }) {
  register("demo", { state: { schema: { type: "object" }, initial: {}, version: 2 } }, (g) => {
    hostOf(g).migrateState((doc) => doc);
    hostOf(g).migrateState((doc) => doc);
  });
}
`);
    const host = startHost();
    const reply = await initialize(host, root);
    expect(reply).toMatchObject({ id: 1, error: { kind: "handler_threw" } });
    expect(reply).toMatchObject({
      error: { message: expect.stringContaining("state_migration_duplicate") },
    });
    expect(await host.exit).toBe("init_failed");
  });

  test("a migrateState for a scope without state fails the setup with state_undeclared", async () => {
    const root = await writePluginRoot(`
import { hostOf } from "@fresnel/ext-host";
export default function extension({ register }) {
  register("demo", {}, (g) => {
    hostOf(g).migrateState((doc) => doc);
  });
}
`);
    const host = startHost();
    const reply = await initialize(host, root);
    expect(reply).toMatchObject({ error: { kind: "handler_threw" } });
    expect(reply).toMatchObject({
      error: { message: expect.stringContaining("state_undeclared") },
    });
  });

  test("a migrateState call after setup is refused with the outside-setup message", async () => {
    const root = await writePluginRoot(`
import { hostOf } from "@fresnel/ext-host";
export default function extension({ register }) {
  let api;
  register("demo", { state: { schema: { type: "object" }, initial: {}, version: 2 } }, (g) => {
    api = g;
    g.on("tool.call.before", () => {
      hostOf(api).migrateState((doc) => doc);
      return undefined;
    });
  });
}
`);
    const host = startHost();
    await initialize(host, root);
    host.send(hookCall(2, {}));
    expect((await host.out.waitFor((frame) => frame.id === 2)).error).toEqual({
      kind: "handler_threw",
      message: "migrateState can only be registered inside setup",
    });
  });
});

describe("updateState in an isolated host", () => {
  test("updateState sends prev and next to the engine and answers the committed state", async () => {
    const root = await writePluginRoot(UPDATE_ENTRY);
    const host = startHost();
    await initialize(host, root);
    host.send(hookCall(2, { count: 7 }));
    const call = await host.out.waitFor((frame) => frame.method === "engine.call");
    expect(call.params).toEqual({
      method: "updateState",
      registration: "demo",
      requestId: 2,
      params: { prev: { count: 7 }, next: { count: 8 }, records: [] },
    });
    host.send({ id: call.id, result: { kind: "committed", state: { count: 8 } } });
    expect(
      (await host.out.waitFor((frame) => frame.id === 2 && frame.method === undefined)).result,
    ).toEqual({
      ok: true,
      value: { count: 8 },
    });
    host.input.end();
    expect(await host.exit).toBe("stdin_closed");
  });

  test("a conflict is retried once from the engine's current document and then commits", async () => {
    const root = await writePluginRoot(UPDATE_ENTRY);
    const host = startHost();
    await initialize(host, root);
    host.send(hookCall(2, { count: 7 }));
    const first = await host.out.waitFor((frame) => frame.method === "engine.call");
    host.send({ id: first.id, result: { kind: "conflict", current: { count: 9 } } });
    const second = await host.out.waitFor(
      (frame) => frame.method === "engine.call" && frame.id === 2,
    );
    expect(second.params).toEqual({
      method: "updateState",
      registration: "demo",
      requestId: 2,
      params: { prev: { count: 9 }, next: { count: 10 }, records: [] },
    });
    host.send({ id: 2, result: { kind: "committed", state: { count: 10 } } });
    expect(
      (await host.out.waitFor((frame) => frame.id === 2 && frame.method === undefined)).result,
    ).toEqual({
      ok: true,
      value: { count: 10 },
    });
  });

  test("a second conflict answers state_conflict as a value and does not throw", async () => {
    const root = await writePluginRoot(UPDATE_ENTRY);
    const host = startHost();
    await initialize(host, root);
    host.send(hookCall(2, { count: 7 }));
    const first = await host.out.waitFor((frame) => frame.method === "engine.call");
    host.send({ id: first.id, result: { kind: "conflict", current: { count: 9 } } });
    await host.out.waitFor((frame) => frame.method === "engine.call" && frame.id === 2);
    host.send({ id: 2, result: { kind: "conflict", current: { count: 11 } } });
    expect(
      (await host.out.waitFor((frame) => frame.id === 2 && frame.method === undefined)).result,
    ).toEqual({
      ok: false,
      error: { kind: "state_conflict" },
    });
  });

  test("a failed reply answers the failure kind as a value", async () => {
    const root = await writePluginRoot(UPDATE_ENTRY);
    const host = startHost();
    await initialize(host, root);
    host.send(hookCall(2, { count: 7 }));
    const call = await host.out.waitFor((frame) => frame.method === "engine.call");
    host.send({ id: call.id, result: { kind: "failed", failure: "state_schema" } });
    expect(
      (await host.out.waitFor((frame) => frame.id === 2 && frame.method === undefined)).result,
    ).toEqual({
      ok: false,
      error: { kind: "state_schema" },
    });
  });
});

describe("awaitUser in an isolated host", () => {
  test("begin is sent before the wait and end after it, and the wait's value is the hook's", async () => {
    const root = await writePluginRoot(WAIT_ENTRY);
    const host = startHost();
    await initialize(host, root);
    host.send(hookCall(2, {}));
    const begin = await host.out.waitFor((frame) => frame.method === "engine.call");
    expect(begin.params).toEqual({
      method: "awaitUser",
      registration: "demo",
      requestId: 2,
      params: { phase: "begin" },
    });
    host.send({ id: begin.id, result: null });
    const end = await host.out.waitFor((frame) => frame.method === "engine.call" && frame.id === 2);
    expect(end.params).toEqual({
      method: "awaitUser",
      registration: "demo",
      requestId: 2,
      params: { phase: "end" },
    });
    host.send({ id: end.id, result: null });
    expect(
      (await host.out.waitFor((frame) => frame.id === 2 && frame.method === undefined)).result,
    ).toBe("yes");
  });

  test("end is sent even when the wait rejects, and the rejection is the hook's error", async () => {
    const root = await writePluginRoot(WAIT_ENTRY);
    const host = startHost();
    await initialize(host, root);
    host.send(hookCall(2, {}, "reject"));
    const begin = await host.out.waitFor((frame) => frame.method === "engine.call");
    host.send({ id: begin.id, result: null });
    const end = await host.out.waitFor((frame) => frame.method === "engine.call" && frame.id === 2);
    expect(end.params).toMatchObject({ params: { phase: "end" } });
    host.send({ id: end.id, result: null });
    expect(
      (await host.out.waitFor((frame) => frame.id === 2 && frame.method === undefined)).error,
    ).toEqual({
      kind: "handler_threw",
      message: "nope",
    });
  });

  test("a failed end is a diagnostic and does not replace the wait's value", async () => {
    const root = await writePluginRoot(WAIT_ENTRY);
    const host = startHost();
    await initialize(host, root);
    host.send(hookCall(2, {}));
    const begin = await host.out.waitFor((frame) => frame.method === "engine.call");
    host.send({ id: begin.id, result: null });
    const end = await host.out.waitFor((frame) => frame.method === "engine.call" && frame.id === 2);
    host.send({ id: end.id, error: { kind: "engine_call_failed", message: "gone" } });
    expect(
      (await host.out.waitFor((frame) => frame.id === 2 && frame.method === undefined)).result,
    ).toBe("yes");
    expect(await host.diagnostics.waitForText("awaitUser end of demo failed")).toContain("gone");
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
    expect(
      (await host.out.waitFor((frame) => frame.id === 2 && frame.method === undefined)).result,
    ).toBe("second");

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
    const failed = await host.out.waitFor((frame) => frame.id === 2 && frame.method === undefined);
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
    expect(
      (await host.out.waitFor((frame) => frame.id === 2 && frame.method === undefined)).result,
    ).toBe("aborted");
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
    expect(
      (await host.out.waitFor((frame) => frame.id === 2 && frame.method === undefined)).error,
    ).toMatchObject({
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
    const reply = await host.out.waitFor((frame) => frame.id === 2 && frame.method === undefined);
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
    expect(
      (await host.out.waitFor((frame) => frame.id === 2 && frame.method === undefined)).result,
    ).toEqual({
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
    expect(
      (await host.out.waitFor((frame) => frame.id === 2 && frame.method === undefined)).result,
    ).toBeNull();
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
  test("an event.notify handler that throws is reported on stderr, sends no reply, and is acknowledged", async () => {
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
    // 실패한 처리도 확인을 보낸다(엔진의 미확인 수를 줄인다). 알림 확인은 응답이 아니다
    expect(await host.out.waitFor((frame) => frame.method === "event.done")).toEqual({
      method: "event.done",
      params: { eventKey: "e-1" },
    });
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
    await host.out.waitFor((frame) => frame.id === 2 && frame.method === undefined);
    const replyIds = host.out.lines
      .map(frameOf)
      .filter((frame) => frame.method === undefined)
      .map((frame) => frame.id);
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
    expect(
      (await host.out.waitFor((frame) => frame.id === 2 && frame.method === undefined)).result,
    ).toEqual({ pong: true });
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
    expect(
      (await host.out.waitFor((frame) => frame.id === 2 && frame.method === undefined)).result,
    ).toEqual({
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

/** 훅이 엔진 호출을 하고, 그 실패를 잡아 종류와 값을 돌려준다. 시험 입력이 `commit`이면 상태 커밋, 그 밖이면 기능 호출이다 */
const ORIGIN_ENTRY = `
import { Type } from "typebox";

export default function extension({ register }) {
  register("demo", { state: { schema: Type.Object({ count: Type.Number() }), initial: { count: 0 }, version: 1 } }, (g) => {
    g.on("tool.call.before", async (payload) => {
      const failing = payload.toolName === "commit"
        ? () => g.commit({ count: 9 })
        : () => g.capability({ capability: "demo.echo", version: "1.0.0" }).echo({ text: "hi" });
      try {
        await failing();
        return "no error";
      } catch (cause) {
        return {
          name: cause.name,
          message: cause.message,
          code: cause.code ?? null,
          kind: cause.kind ?? null,
          data: cause.data ?? null,
          scopeId: cause.scopeId ?? null,
        };
      }
    });
  });
}
`;

/** 엔진 호출 하나를 주어진 실패로 답하고, 훅이 받은 값을 돌려준다 */
async function failingEngineCall(toolName: string, error: object): Promise<unknown> {
  const root = await writePluginRoot(ORIGIN_ENTRY);
  const host = startHost();
  await initialize(host, root);
  host.send(hookCall(2, {}, toolName));
  const call = await host.out.waitFor((frame) => frame.method === "engine.call");
  host.send({ id: call.id, error });
  return (await host.out.waitFor((frame) => frame.id === 2 && frame.method === undefined)).result;
}

describe("engine call failures keep their origin in an isolated host", () => {
  const CAPABILITY_DATA = {
    capability: "demo.echo",
    method: "echo",
    code: "unavailable",
    message: "every provider failed",
    retryable: true,
    detail: { tried: 2 },
  };

  test("a capability failure with its origin is thrown as a CapabilityError carrying the engine's data", async () => {
    expect(
      await failingEngineCall("capability", {
        kind: "engine_call_failed",
        message: "unavailable: every provider failed",
        origin: { kind: "capability", data: CAPABILITY_DATA },
      }),
    ).toEqual({
      name: "CapabilityError",
      message: "every provider failed",
      code: null,
      kind: null,
      data: CAPABILITY_DATA,
      scopeId: null,
    });
  });

  test("a primitive failure with its origin is thrown as a PrimitiveError with the code and the scope, without the code prefix twice", async () => {
    expect(
      await failingEngineCall("commit", {
        kind: "engine_call_failed",
        message: "state_conflict: the state changed",
        origin: { kind: "primitive", code: "state_conflict", scopeId: "demo" },
      }),
    ).toEqual({
      name: "PrimitiveError",
      message: "the state changed",
      code: "state_conflict",
      kind: null,
      data: null,
      scopeId: "demo",
    });
  });

  test("a primitive origin whose code is not a primitive error code stays a PluginEngineCallError", async () => {
    expect(
      await failingEngineCall("commit", {
        kind: "engine_call_failed",
        message: "made_up_code: x",
        origin: { kind: "primitive", code: "made_up_code" },
      }),
    ).toEqual({
      name: "PluginEngineCallError",
      message: "made_up_code: x",
      code: null,
      kind: "engine_call_failed",
      data: null,
      scopeId: null,
    });
  });

  test("a failure without an origin stays a PluginEngineCallError with the engine's kind", async () => {
    expect(
      await failingEngineCall("commit", { kind: "engine_call_failed", message: "plain" }),
    ).toEqual({
      name: "PluginEngineCallError",
      message: "plain",
      code: null,
      kind: "engine_call_failed",
      data: null,
      scopeId: null,
    });
  });
});
