import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Bug } from "@fresnel/contracts";
import type { JsonValue } from "@fresnel/contracts/conversation";
import type { RawPluginHostFrame } from "@fresnel/contracts/extensions";
import {
  createCandidateRunner,
  type CandidateCall,
  type CandidateLaunch,
  type CandidateLaunchInfo,
  type CandidateOpenInput,
  type CandidateRunner,
  type IsolationLaunch,
  type IsolationLaunchInfo,
  type ReplayPoint,
} from "../../src/index.ts";
import {
  createManualClock,
  recordingLogger,
  until,
  type ManualClock,
} from "./support/fake-process.ts";
import {
  createScriptedPort,
  declOf,
  type ChildIo,
  type ChildScript,
  type ScriptedPort,
} from "./support/scripted-child.ts";

const ROOT = "/nonexistent/candidate-root";

// 호출하는 쪽의 `launch`는 proxy-entry의 것과 같은 모양이다(마지막 시험이 맞춘다)
const isolatedLaunch: (info: IsolationLaunchInfo) => IsolationLaunch = () => ({
  command: "plugin-host",
  args: ["--stdio"],
  env: {},
});

/** 프로미스가 던진 값을 돌려준다. 던지지 않았으면 undefined다(시험이 그 값을 본다) */
function rejectionOf(work: Promise<unknown>): Promise<unknown> {
  return work.then(
    () => undefined,
    (cause: unknown) => cause,
  );
}

interface Rig {
  readonly runner: CandidateRunner;
  readonly port: ScriptedPort;
  readonly clock: ManualClock;
  readonly events: string[];
}

const rigs: Rig[] = [];

afterEach(() => {
  // 스크립트가 던졌다면 시험이 실패하도록 여기서 본다
  for (const rig of rigs.splice(0)) {
    expect(rig.port.failures).toEqual([]);
  }
});

function rigOf(options: { readonly decls: JsonValue[]; readonly script: ChildScript }): Rig {
  const port = createScriptedPort(options);
  const clock = createManualClock();
  const events: string[] = [];
  const runner = createCandidateRunner({
    process: port,
    launch: isolatedLaunch,
    setTimer: clock.setTimer,
    now: clock.now,
    logger: recordingLogger(events),
    initTimeoutMs: 1000,
  });
  const rig: Rig = { runner, port, clock, events };
  rigs.push(rig);
  return rig;
}

function openOf(): CandidateOpenInput {
  return {
    name: "candidate",
    versionId: "v-cand",
    root: ROOT,
    manifest: { name: "candidate", entry: "./src/index.ts" },
    entry: "./src/index.ts",
  };
}

function callOf(point: ReplayPoint, overrides: Partial<CandidateCall> = {}): CandidateCall {
  return {
    point,
    threadId: "thr_candidate",
    payload: { toolName: "shell" },
    current: null,
    caller: "engine",
    deadlineMs: 500,
    ...overrides,
  };
}

function framesOf(rig: Rig, method: string): readonly RawPluginHostFrame[] {
  return rig.port.children.flatMap((child) =>
    child.received().filter((frame) => frame.method === method),
  );
}

/** 자식이 한 호출 안에서 쓰는 엔진 호출 모음. 응답은 `replies`에 순서대로 쌓는다 */
async function writesOf(
  io: ChildIo,
  requestId: number,
  replies: RawPluginHostFrame[],
): Promise<void> {
  replies.push(
    await io.engineCall({
      method: "commit",
      registration: "cand",
      requestId,
      params: { count: 1 },
    }),
  );
  replies.push(
    await io.engineCall({
      method: "commitWith",
      registration: "cand",
      requestId,
      params: { next: { count: 2 }, records: [] },
    }),
  );
  replies.push(
    await io.engineCall({
      method: "record",
      registration: "cand",
      requestId,
      params: {
        kind: "x.demo.note.saved",
        subject: { type: "thread", id: "thr_candidate" },
        payload: { n: 1 },
      },
    }),
  );
  replies.push(
    await io.engineCall({
      method: "recordPrivate",
      registration: "cand",
      requestId,
      params: { kind: "x.demo.note.saved", payload: { n: 1 } },
    }),
  );
  replies.push(
    await io.engineCall({
      method: "post",
      registration: "cand",
      requestId,
      params: {
        item: { kind: "user", content: "hi" },
        options: { when: "next", requestId: "req-1" },
      },
    }),
  );
  replies.push(
    await io.engineCall({
      method: "updateState",
      registration: "cand",
      requestId,
      params: { prev: { count: 0 }, next: { count: 1 }, records: [] },
    }),
  );
  replies.push(
    await io.engineCall({
      method: "startDrive",
      registration: "cand",
      requestId,
      params: { input: null },
    }),
  );
  replies.push(
    await io.engineCall({
      method: "readRecords",
      registration: "cand",
      requestId,
      params: { kind: "x.demo.*" },
    }),
  );
  replies.push(
    await io.engineCall({
      method: "awaitUser",
      registration: "cand",
      requestId,
      params: { phase: "begin" },
    }),
  );
  replies.push(
    await io.engineCall({
      method: "requestEffect",
      registration: "cand",
      requestId,
      params: { capability: "fresnel.effects", method: "run", input: {}, key: "k-1" },
    }),
  );
  replies.push(
    await io.engineCall({
      method: "reportChanges",
      registration: "cand",
      requestId,
      params: { entries: [] },
    }),
  );
}

// ── 부정 시험 먼저: 후보는 주입된 포트로 띄운 격리 자식에서만 돌고, 돌려 보기는 아무것도 쓰지 않는다 ──

test("spawns only through the injected process port", async () => {
  const rig = rigOf({
    decls: [declOf("cand", [{ point: "tool.call.before", handlerIndex: 0 }])],
    script: async (io) => {
      const hook = await io.next("hook.invoke");
      io.reply(hook.id, { block: true, reason: "x" });
    },
  });
  const opened = await rig.runner.open(openOf());
  expect(opened.ok).toBe(true);
  expect(rig.port.specs).toEqual([
    {
      command: "plugin-host",
      args: ["--stdio"],
      readRoot: ROOT,
      env: {},
      label: "ext:candidate:v-cand",
    },
  ]);
  // 결정은 자식이 보낸 답이다. 엔진 프로세스 안에서 후보 코드가 돌지 않았다는 것을 자식 프레임으로 본다
  const outcome = await rig.runner.run(callOf("tool.call.before"));
  expect(outcome).toMatchObject({ kind: "returned", value: { block: true, reason: "x" } });
  expect(rig.port.children).toHaveLength(1);
  expect(framesOf(rig, "hook.invoke")).toHaveLength(1);
  rig.runner.close("disabled");
});

test("the candidate runner source has no dynamic import and imports only the listed modules", () => {
  const source = readFileSync(
    new URL("../../src/isolation/candidate-runner.ts", import.meta.url),
    "utf8",
  );
  expect(/\bimport\s*\(/.test(source)).toBe(false);
  const specifiers = [...source.matchAll(/^import\b[\s\S]*?\bfrom\s+"([^"]+)";/gm)].map(
    (match) => match[1],
  );
  expect(specifiers).toEqual([
    "typebox",
    "@fresnel/contracts",
    "@fresnel/contracts/capabilities",
    "@fresnel/contracts/conversation",
    "@fresnel/contracts/extensions",
    "./supervisor.ts",
  ]);
});

test("a replay request carries replay:true on every hook.invoke frame", async () => {
  const rig = rigOf({
    decls: [
      declOf("cand", [
        { point: "tool.call.before", handlerIndex: 0 },
        { point: "tool.call.before", handlerIndex: 1 },
      ]),
    ],
    script: async (io) => {
      const first = await io.next("hook.invoke");
      io.reply(first.id, null);
      const second = await io.next("hook.invoke");
      io.reply(second.id, null);
    },
  });
  await rig.runner.open(openOf());
  const outcome = await rig.runner.run(callOf("tool.call.before"));
  expect(outcome).toMatchObject({ kind: "returned", value: null });
  const hooks = framesOf(rig, "hook.invoke");
  expect(hooks).toHaveLength(2);
  expect(hooks.map((frame) => frame.params)).toMatchObject([{ replay: true }, { replay: true }]);
  rig.runner.close("disabled");
});

test("capability from the child is denied and flagged as replay_denied", async () => {
  const observed: RawPluginHostFrame[] = [];
  const rig = rigOf({
    decls: [declOf("cand", [{ point: "guard.tool.before", handlerIndex: 0 }])],
    script: async (io) => {
      const hook = await io.next("hook.invoke");
      observed.push(
        await io.engineCall({
          method: "capability",
          registration: "cand",
          requestId: hook.id,
          params: {
            key: { capability: "fresnel.guard", version: "1.0.0" },
            member: "check",
            input: {},
          },
        }),
      );
      // 거부 뒤에 막음을 답해도 결과는 돌려 보기 거부다
      io.reply(hook.id, { block: true, reason: "after the denial" });
    },
  });
  await rig.runner.open(openOf());
  const outcome = await rig.runner.run(callOf("guard.tool.before"));
  expect(outcome).toMatchObject({ kind: "replay_denied" });
  expect(observed).toMatchObject([{ error: { kind: "replay_mode_denied" } }]);
  rig.runner.close("disabled");
});

test("commit, record and post from the child succeed but change nothing", async () => {
  const replies: RawPluginHostFrame[] = [];
  const seen: unknown[] = [];
  const rig = rigOf({
    decls: [declOf("cand", [{ point: "tool.call.before", handlerIndex: 0 }], { count: 0 })],
    script: async (io) => {
      const first = await io.next("hook.invoke");
      seen.push(first.params);
      await writesOf(io, first.id, replies);
      io.reply(first.id, null);
      // 두 번째 호출은 선언된 초기 상태를 받는다. 첫 호출의 쓰기가 남지 않았다
      const second = await io.next("hook.invoke");
      seen.push(second.params);
      io.reply(second.id, null);
    },
  });
  await rig.runner.open(openOf());
  expect(await rig.runner.run(callOf("tool.call.before"))).toMatchObject({
    kind: "returned",
    value: null,
  });
  expect(await rig.runner.run(callOf("tool.call.before"))).toMatchObject({
    kind: "returned",
    value: null,
  });
  expect(replies).toMatchObject([
    { result: { count: 1 } },
    { result: { count: 2 } },
    { result: null },
    { result: null },
    { result: { requestId: "req-1", duplicate: false } },
    { result: { kind: "committed", state: { count: 1 } } },
    { result: { ok: true } },
    { result: [] },
    { result: null },
    { result: null },
    // 훅 호출에는 도구 실행의 변경 문맥이 없어서 실제 라우터와 같은 오류다
    { error: { kind: "invalid_params" } },
  ]);
  expect(seen).toMatchObject([{ state: { count: 0 } }, { state: { count: 0 } }]);
  rig.runner.close("disabled");
});

test("a run before open and a run on a point without a handler are programmer errors", async () => {
  const rig = rigOf({
    decls: [declOf("cand", [{ point: "tool.call.before", handlerIndex: 0 }])],
    script: () => Promise.resolve(),
  });
  expect(await rejectionOf(rig.runner.run(callOf("tool.call.before")))).toBeInstanceOf(Bug);
  await rig.runner.open(openOf());
  expect(await rejectionOf(rig.runner.run(callOf("guard.tool.before")))).toBeInstanceOf(Bug);
  rig.runner.close("disabled");
});

// ── 긍정 시험: 값과 순서 ──────────────────────────────────────────────────

test("a pass comes back as null and a decision as the value the child returned", async () => {
  const rig = rigOf({
    decls: [declOf("cand", [{ point: "tool.call.before", handlerIndex: 0 }])],
    script: async (io) => {
      const first = await io.next("hook.invoke");
      io.reply(first.id, null);
      const second = await io.next("hook.invoke");
      io.reply(second.id, { block: true, reason: "x" });
    },
  });
  await rig.runner.open(openOf());
  expect(await rig.runner.run(callOf("tool.call.before"))).toMatchObject({
    kind: "returned",
    value: null,
  });
  expect(await rig.runner.run(callOf("tool.call.before"))).toMatchObject({
    kind: "returned",
    value: { block: true, reason: "x" },
  });
  rig.runner.close("disabled");
});

test("handlers run in registration order, one request at a time", async () => {
  const seen: unknown[] = [];
  const sentBeforeAnswer: number[] = [];
  const rig = rigOf({
    decls: [
      declOf("cand", [
        { point: "tool.result", handlerIndex: 0 },
        { point: "tool.result", handlerIndex: 1 },
      ]),
    ],
    script: async (io) => {
      const first = await io.next("hook.invoke");
      seen.push(first.params);
      // 답하기 전에 받은 hook.invoke 수. 병렬이면 두 번째가 이미 와 있다
      sentBeforeAnswer.push(io.received().filter((frame) => frame.method === "hook.invoke").length);
      io.reply(first.id, null);
      const second = await io.next("hook.invoke");
      seen.push(second.params);
      sentBeforeAnswer.push(io.received().filter((frame) => frame.method === "hook.invoke").length);
      io.reply(second.id, null);
    },
  });
  await rig.runner.open(openOf());
  await rig.runner.run(callOf("tool.result", { current: { content: "original" } }));
  expect(sentBeforeAnswer).toEqual([1, 2]);
  expect(seen).toMatchObject([{ handlerIndex: 0 }, { handlerIndex: 1 }]);
  rig.runner.close("disabled");
});

test("tool.result passes the previous handler's value as current", async () => {
  const seen: unknown[] = [];
  const rig = rigOf({
    decls: [
      declOf("cand", [
        { point: "tool.result", handlerIndex: 0 },
        { point: "tool.result", handlerIndex: 1 },
      ]),
    ],
    script: async (io) => {
      const first = await io.next("hook.invoke");
      seen.push(first.params);
      io.reply(first.id, { content: "patched" });
      const second = await io.next("hook.invoke");
      seen.push(second.params);
      io.reply(second.id, null);
    },
  });
  await rig.runner.open(openOf());
  const outcome = await rig.runner.run(callOf("tool.result", { current: { content: "original" } }));
  expect(outcome).toMatchObject({ kind: "returned", value: { content: "patched" } });
  expect(seen).toMatchObject([
    { current: { content: "original" } },
    { current: { content: "patched" } },
  ]);
  rig.runner.close("disabled");
});

test("guard.tool.before stops at the first decision", async () => {
  const rig = rigOf({
    decls: [
      declOf("cand", [
        { point: "guard.tool.before", handlerIndex: 0 },
        { point: "guard.tool.before", handlerIndex: 1 },
      ]),
    ],
    script: async (io) => {
      const hook = await io.next("hook.invoke");
      io.reply(hook.id, { block: true, reason: "first" });
    },
  });
  await rig.runner.open(openOf());
  const outcome = await rig.runner.run(callOf("guard.tool.before"));
  expect(outcome).toMatchObject({ kind: "returned", value: { block: true, reason: "first" } });
  expect(framesOf(rig, "hook.invoke")).toHaveLength(1);
  rig.runner.close("disabled");
});

test("tool.call.before keeps the strongest decision and a block ends the run", async () => {
  const rig = rigOf({
    decls: [
      declOf("cand", [
        { point: "tool.call.before", handlerIndex: 0 },
        { point: "tool.call.before", handlerIndex: 1 },
        { point: "tool.call.before", handlerIndex: 2 },
      ]),
    ],
    script: async (io) => {
      const asking = await io.next("hook.invoke");
      io.reply(asking.id, { ask: true, reason: "a" });
      const blocking = await io.next("hook.invoke");
      io.reply(blocking.id, { block: true, reason: "b" });
    },
  });
  await rig.runner.open(openOf());
  const outcome = await rig.runner.run(callOf("tool.call.before"));
  expect(outcome).toMatchObject({ kind: "returned", value: { block: true, reason: "b" } });
  // 막음이 나왔으므로 세 번째 핸들러는 부르지 않는다
  expect(framesOf(rig, "hook.invoke")).toHaveLength(2);
  rig.runner.close("disabled");
});

test("a decision that does not match the hook schema is a handler failure", async () => {
  const rig = rigOf({
    decls: [declOf("cand", [{ point: "guard.tool.before", handlerIndex: 0 }])],
    script: async (io) => {
      const hook = await io.next("hook.invoke");
      io.reply(hook.id, { block: false, reason: "x" });
    },
  });
  await rig.runner.open(openOf());
  const outcome = await rig.runner.run(callOf("guard.tool.before"));
  expect(outcome).toMatchObject({
    kind: "threw",
    message: "the decision of guard.tool.before does not match its schema",
  });
  rig.runner.close("disabled");
});

test("a handler error from the child is threw with its message", async () => {
  const rig = rigOf({
    decls: [declOf("cand", [{ point: "guard.tool.before", handlerIndex: 0 }])],
    script: async (io) => {
      const hook = await io.next("hook.invoke");
      io.fail(hook.id, "handler_threw", "boom");
    },
  });
  await rig.runner.open(openOf());
  expect(await rig.runner.run(callOf("guard.tool.before"))).toMatchObject({
    kind: "threw",
    message: "boom",
  });
  rig.runner.close("disabled");
});

test("a call past its deadline stops the child and the next run starts a fresh one", async () => {
  const rig = rigOf({
    decls: [declOf("cand", [{ point: "tool.call.before", handlerIndex: 0 }])],
    script: async (io, spawn) => {
      const hook = await io.next("hook.invoke");
      if (spawn === 0) {
        // 첫 자식은 답하지 않는다. 시간 한도가 지나면 엔진이 멈춘다
        await io.next("host.never");
        return;
      }
      io.reply(hook.id, { block: true, reason: `spawn ${spawn}` });
    },
  });
  await rig.runner.open(openOf());
  const first = rig.runner.run(callOf("tool.call.before", { deadlineMs: 50 }));
  await until(() => framesOf(rig, "hook.invoke").length === 1, "the hook frame");
  rig.clock.advance(50);
  expect(await first).toMatchObject({ kind: "timeout", ms: 50 });
  expect(rig.port.children[0]?.signals()).toEqual(["SIGTERM"]);

  const second = await rig.runner.run(callOf("tool.call.before"));
  expect(second).toMatchObject({ kind: "returned", value: { block: true, reason: "spawn 1" } });
  expect(rig.port.specs).toHaveLength(2);
  expect(rig.runner.restarts).toBe(1);
  rig.runner.close("disabled");
});

test("open reports a spawn failure as a value and lists no handlers", async () => {
  const rig = rigOf({
    decls: [declOf("cand", [{ point: "tool.call.before", handlerIndex: 0 }])],
    script: () => Promise.resolve(),
  });
  rig.port.failNextSpawn({ kind: "spawn_failed", code: "ENOENT", message: "no binary" });
  const opened = await rig.runner.open(openOf());
  expect(opened).toMatchObject({ ok: false, error: { kind: "spawn_failed" } });
  expect(rig.runner.handlersFor("tool.call.before")).toEqual([]);
  expect(rig.port.specs).toHaveLength(1);
});

test("a child that exits between runs makes the next run process_failed", async () => {
  const rig = rigOf({
    decls: [declOf("cand", [{ point: "tool.call.before", handlerIndex: 0 }])],
    script: async (io, spawn) => {
      const hook = await io.next("hook.invoke");
      io.reply(hook.id, null);
      if (spawn === 0) io.crash();
    },
  });
  await rig.runner.open(openOf());
  expect(await rig.runner.run(callOf("tool.call.before"))).toMatchObject({
    kind: "returned",
    value: null,
  });
  // 자식이 끝나고 감독이 그것을 처리할 때까지 기다린다(시계를 쓰지 않는다)
  await until(() => rig.events.includes("plugin_host.exited"), "the child to exit");
  rig.port.failNextSpawn({ kind: "spawn_failed", code: "ENOENT", message: "gone" });
  expect(await rig.runner.run(callOf("tool.call.before"))).toMatchObject({
    kind: "process_failed",
    reason: "spawn_failed",
  });
});

test("close makes later runs process_failed and a second close is harmless", async () => {
  const rig = rigOf({
    decls: [declOf("cand", [{ point: "tool.call.before", handlerIndex: 0 }])],
    script: async (io) => {
      const hook = await io.next("hook.invoke");
      io.reply(hook.id, null);
    },
  });
  await rig.runner.open(openOf());
  rig.runner.close("disabled");
  rig.runner.close("disabled");
  expect(await rig.runner.run(callOf("tool.call.before"))).toMatchObject({
    kind: "process_failed",
    reason: "disposed",
  });
});

test("the initial state is a copy: changing a returned copy does not change later calls", async () => {
  const seen: unknown[] = [];
  const rig = rigOf({
    decls: [declOf("cand", [{ point: "tool.call.before", handlerIndex: 0 }], { count: 0 })],
    script: async (io) => {
      const hook = await io.next("hook.invoke");
      seen.push(hook.params);
      io.reply(hook.id, null);
    },
  });
  await rig.runner.open(openOf());
  const [handler] = rig.runner.handlersFor("tool.call.before");
  const copy = handler?.initialState;
  if (copy !== undefined && copy !== null && typeof copy === "object") {
    Object.assign(copy, { count: 99 });
  }
  expect(await rig.runner.run(callOf("tool.call.before"))).toMatchObject({
    kind: "returned",
    value: null,
  });
  expect(seen).toMatchObject([{ state: { count: 0 } }]);
  expect(rig.runner.handlersFor("tool.call.before")).toMatchObject([
    { hasState: true, initialState: { count: 0 } },
  ]);
  rig.runner.close("disabled");
});

test("handlersFor lists the registrations in order with their state", async () => {
  const rig = rigOf({
    decls: [
      declOf("alpha", [{ point: "tool.call.before", handlerIndex: 0 }], { count: 0 }),
      declOf("beta", [
        { point: "guard.tool.before", handlerIndex: 0 },
        { point: "tool.call.before", handlerIndex: 0 },
      ]),
    ],
    script: () => Promise.resolve(),
  });
  const opened = await rig.runner.open(openOf());
  expect(opened).toMatchObject({ ok: true, value: [{ id: "alpha" }, { id: "beta" }] });
  expect(rig.runner.handlersFor("tool.call.before")).toEqual([
    { registration: "alpha", handlerIndex: 0, hasState: true, initialState: { count: 0 } },
    { registration: "beta", handlerIndex: 0, hasState: false, initialState: null },
  ]);
  expect(rig.runner.handlersFor("tool.result")).toEqual([]);
  rig.runner.close("disabled");
});

test("the child's stderr is kept as stderrTail", async () => {
  const rig = rigOf({
    decls: [declOf("cand", [{ point: "guard.tool.before", handlerIndex: 0 }])],
    script: async (io) => {
      const hook = await io.next("hook.invoke");
      io.stderr("candidate warning\n");
      io.reply(hook.id, null);
    },
  });
  await rig.runner.open(openOf());
  await rig.runner.run(callOf("guard.tool.before"));
  await until(() => rig.runner.stderrTail().length > 0, "the stderr line");
  expect(rig.runner.stderrTail()).toEqual(["candidate warning"]);
  rig.runner.close("disabled");
});

test("the isolated entry's launch function fits the candidate runner", () => {
  const candidate: (info: CandidateLaunchInfo) => CandidateLaunch = isolatedLaunch;
  expect(candidate({ name: "n", root: ROOT, entry: "./src/index.ts", versionId: "v" })).toEqual({
    command: "plugin-host",
    args: ["--stdio"],
    env: {},
  });
});
