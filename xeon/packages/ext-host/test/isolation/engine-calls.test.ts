import { expect, test } from "bun:test";
import { Type } from "typebox";
import { err, ok, type Result } from "@fresnel/contracts";
import {
  CapabilityError,
  type CapabilityErrorData,
  type ServiceKey,
} from "@fresnel/contracts/capabilities";
import type { JsonValue } from "@fresnel/contracts/conversation";
import {
  PLUGIN_HOST_ERROR_DETAIL_MAX_BYTES,
  SCRIPT_LIMITS,
  type DriveCommand,
  type EngineCallParams,
  type PluginHostError,
  type PluginScriptPort,
  type RegistrationApi,
  type ScriptRunFailure,
  type ScriptRunRequest,
  type ScriptRunResult,
} from "@fresnel/contracts/extensions";
import {
  createEngineCallRouter,
  parseEngineCallParams,
  type OpenWaits,
} from "../../src/isolation/engine-calls.ts";
import type { AnyState } from "../../src/primitives/erased-types.ts";
import { hostOf } from "../../src/primitives/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { echoDefs, makeOrchestrationUnit, makeUnit } from "../primitives/fixtures/support.ts";

const REGISTRATION = "ext-state";
const toolCall = { toolCallId: "call_1", toolName: "read", input: { path: "a" } };
const ECHO_KEY: ServiceKey<{ echo(input: unknown): Promise<unknown> }> = {
  capability: "demo.echo",
  version: "1.0.0",
};
/** 공급자가 던지는 기능 오류의 데이터. 시험마다 `echo.thrown`으로 바꿀 수 있다 */
const ECHO_ERROR: CapabilityErrorData = {
  capability: "demo.echo",
  method: "echo",
  code: "unavailable",
  message: "every provider failed",
  retryable: true,
  detail: { tried: 2 },
};

/**
 * 실제 확장 호스트에 등록 하나를 올리고, 그 `g`로 라우터를 만든다. 라우터는 디스패치 안에서 불린다.
 * 실제 플러그인 경로와 같이 ambient 문맥(스레드, 등록 범위)이 있어야 `g`의 메서드가 동작한다.
 * `withEcho`이면 `demo.echo` 공급자를 올리고 등록이 그 기능을 요구한다. 공급자가 던질 값은 `echo.thrown`이다
 */
async function rig(
  replayId: number | null = null,
  withEcho = false,
  waits?: OpenWaits,
  scripts?: PluginScriptPort,
) {
  // 공급자의 메서드 정의(멱등 `echo`)가 있어야 가드가 재실행 문맥에서도 기능 호출을 통과시킨다
  const t = await createTestHost(withEcho ? { capabilityDefs: echoDefs } : {});
  const thread = t.newThread();
  await t.host.openThread(thread);
  const echo: { thrown: Error } = { thrown: new CapabilityError(ECHO_ERROR) };
  if (withEcho) {
    await t.host.install(
      makeUnit({ name: "ext-echo", provides: [{ id: "demo.echo", version: "1.0.0" }] }, (g) => {
        hostOf(g).provide(ECHO_KEY, { echo: () => Promise.reject(echo.thrown) });
      }),
    );
  }
  const slot: { g?: RegistrationApi<AnyState> } = {};
  await t.host.install(
    makeUnit<AnyState>(
      {
        name: REGISTRATION,
        usesPost: true,
        loadIndex: withEcho ? 1 : 0,
        ...(withEcho ? { requires: [{ id: "demo.echo", range: "^1.0.0" }] } : {}),
        def: {
          state: {
            schema: Type.Object({ count: Type.Number() }),
            initial: { count: 0 },
            version: 1,
          },
        },
      },
      (g) => {
        slot.g = g;
      },
    ),
  );
  const probe: { run: () => Promise<void> } = { run: async () => {} };
  await t.host.install(
    makeUnit({ name: "ext-probe", hooks: ["tool.call.before"] }, (g) => {
      g.on("tool.call.before", async () => {
        await probe.run();
        return undefined;
      });
    }),
  );
  const router = createEngineCallRouter({
    gOf: (registration) => (registration === REGISTRATION ? slot.g : undefined),
    replayOf: (requestId) => requestId !== null && requestId === replayId,
    ...(waits === undefined ? {} : { waitsOf: () => waits }),
    ...(scripts === undefined ? {} : { scripts }),
  });
  let seq = 0;
  /** `work`를 디스패치 안에서 한 번 실행하고 그 값을 돌려준다. 스레드와 등록의 ambient 문맥이 있는 자리다 */
  async function inProbe<T>(work: () => Promise<T>): Promise<T> {
    const slotResult: { value?: T } = {};
    probe.run = async () => {
      slotResult.value = await work();
    };
    seq += 1;
    await t.host.dispatch("tool.call.before", toolCall, {
      threadId: thread,
      dispatchKey: `probe:${seq}`,
    });
    if (slotResult.value === undefined) throw new Error("the probe handler did not run");
    return slotResult.value;
  }
  /** 라우터를 디스패치 안에서 한 번 부르고 그 결과를 돌려준다 */
  function call(params: EngineCallParams): Promise<Result<JsonValue, PluginHostError>> {
    return inProbe(() => router(params));
  }
  /** 등록의 현재 상태 문서 */
  function stateNow(): Promise<unknown> {
    return inProbe(async () => {
      if (slot.g === undefined) throw new Error("the registration was not installed");
      return slot.g.state();
    });
  }
  return { call, stateNow, echo };
}

/** 공급자의 `echo`를 부르는 기능 호출 params */
function capabilityCall(): EngineCallParams {
  return callOf("capability", {
    key: { capability: "demo.echo", version: "1.0.0" },
    member: "echo",
    input: { text: "hi" },
    options: { requestId: "cap:1" },
  });
}

function callOf(
  method: EngineCallParams["method"],
  params: JsonValue,
  requestId: number | null = null,
): EngineCallParams {
  return { method, registration: REGISTRATION, requestId, params };
}

function errorOf<T, E>(result: Result<T, E>): E {
  if (result.ok) throw new Error(`expected an error, got ${JSON.stringify(result.value)}`);
  return result.error;
}

test("commit stores the state and answers with the committed value", async () => {
  const { call, stateNow } = await rig();
  const reply = await call(callOf("commit", { count: 5 }));
  expect(reply).toEqual({ ok: true, value: { count: 5 } });
  expect(await stateNow()).toEqual({ count: 5 });
});

test("a commit that breaks the state schema is engine_call_failed with the engine code", async () => {
  const { call, stateNow } = await rig();
  const failed = errorOf(await call(callOf("commit", { count: "not a number" })));
  expect(failed.kind).toBe("engine_call_failed");
  expect(failed.message).toMatch(/^state_schema: /);
  expect(await stateNow()).toEqual({ count: 0 });
});

test("a params shape that does not match is invalid_params and the engine is not asked", async () => {
  const { call } = await rig();
  expect(
    errorOf(
      await call(
        callOf("record", { kind: "not-a-kind", subject: { type: "thread", id: "t" }, payload: {} }),
      ),
    ),
  ).toMatchObject({ kind: "invalid_params" });
  expect(errorOf(await call(callOf("readRecords", { kind: "bogus" })))).toMatchObject({
    kind: "invalid_params",
  });
  expect(
    errorOf(await call(callOf("commitWith", { next: { count: 1 }, records: [{ kind: 5 }] }))),
  ).toMatchObject({ kind: "invalid_params" });
});

test("an unknown registration is unknown_target", async () => {
  const { call } = await rig();
  const unknown = await call({
    method: "commit",
    registration: "nobody",
    requestId: null,
    params: { count: 1 },
  });
  expect(unknown).toEqual({
    ok: false,
    error: { kind: "unknown_target", message: "no registration nobody" },
  });
});

test("a commit in a replay answers with the input state and leaves the state unchanged", async () => {
  const { call, stateNow } = await rig(7);
  const reply = await call(callOf("commit", { count: 99 }, 7));
  expect(reply).toEqual({ ok: true, value: { count: 99 } });
  expect(await stateNow()).toEqual({ count: 0 });
});

test("commitWith stores the state with its records and answers with the committed value", async () => {
  const { call, stateNow } = await rig();
  const reply = await call(callOf("commitWith", { next: { count: 3 }, records: [] }));
  expect(reply).toEqual({ ok: true, value: { count: 3 } });
  expect(await stateNow()).toEqual({ count: 3 });
});

test("a commitWith in a replay answers with the input state and leaves the state unchanged", async () => {
  const { call, stateNow } = await rig(7);
  const reply = await call(callOf("commitWith", { next: { count: 42 }, records: [] }, 7));
  expect(reply).toEqual({ ok: true, value: { count: 42 } });
  expect(await stateNow()).toEqual({ count: 0 });
});

test("a record or post in a replay succeeds without reaching the engine", async () => {
  const { call } = await rig(7);
  const subject = { type: "thread", id: "thr_1" };
  expect(
    await call(callOf("record", { kind: "x.ext-state.note.created", subject, payload: {} }, 7)),
  ).toEqual({ ok: true, value: null });
  expect(
    await call(callOf("recordPrivate", { kind: "x.ext-state.note.created", payload: {} }, 7)),
  ).toEqual({ ok: true, value: null });
  expect(
    await call(
      callOf(
        "post",
        {
          item: { kind: "user", content: "hi" },
          options: { when: "next", requestId: "r-replay" },
        },
        7,
      ),
    ),
  ).toEqual({ ok: true, value: { requestId: "r-replay", duplicate: false } });
});

test("a record outside a replay reaches the engine and an undeclared kind is refused there", async () => {
  const { call } = await rig();
  const refused = errorOf(
    await call(
      callOf("record", {
        kind: "x.ext-state.note.created",
        subject: { type: "thread", id: "thr_1" },
        payload: {},
      }),
    ),
  );
  expect(refused.kind).toBe("engine_call_failed");
  expect(refused.message).toMatch(/^record_kind_undeclared: /);
});

test("a post outside a replay is accepted by the engine and answered with its receipt", async () => {
  const { call } = await rig();
  const receipt = await call(
    callOf("post", {
      item: { kind: "user", content: "hello" },
      options: { when: "next", requestId: "r-live" },
    }),
  );
  expect(receipt).toEqual({ ok: true, value: { requestId: "r-live", duplicate: false } });
});

test("a capability call in a replay is refused with replay_mode_denied", async () => {
  const { call } = await rig(7);
  const refused = errorOf(
    await call(
      callOf(
        "capability",
        {
          key: { capability: "demo.echo", version: "1.0.0" },
          member: "run",
          input: {},
          options: null,
        },
        7,
      ),
    ),
  );
  expect(refused).toMatchObject({ kind: "replay_mode_denied" });
});

test("a capability call outside a replay goes through the guarded service and reports an undeclared one", async () => {
  const { call } = await rig();
  const refused = errorOf(
    await call(
      callOf("capability", {
        key: { capability: "demo.echo", version: "1.0.0" },
        member: "run",
        input: {},
      }),
    ),
  );
  expect(refused.kind).toBe("engine_call_failed");
  expect(refused.message).toMatch(/^capability_undeclared: /);
});

test("a capability error from a provider answers engine_call_failed with its code and data as origin", async () => {
  const { call } = await rig(null, true);
  expect(errorOf(await call(capabilityCall()))).toEqual({
    kind: "engine_call_failed",
    message: "unavailable: every provider failed",
    origin: { kind: "capability", data: ECHO_ERROR },
  });
});

test("a capability error whose detail is over the protocol limit answers without the detail and keeps the rest", async () => {
  const { call, echo } = await rig(null, true);
  echo.thrown = new CapabilityError({
    ...ECHO_ERROR,
    detail: "x".repeat(PLUGIN_HOST_ERROR_DETAIL_MAX_BYTES),
  });
  expect(errorOf(await call(capabilityCall())).origin).toEqual({
    kind: "capability",
    data: {
      capability: "demo.echo",
      method: "echo",
      code: "unavailable",
      message: "every provider failed",
      retryable: true,
    },
  });
});

test("a primitive error answers engine_call_failed with its code and the registration as origin", async () => {
  const { call } = await rig();
  expect(errorOf(await call(callOf("commit", { count: "not a number" }))).origin).toEqual({
    kind: "primitive",
    code: "state_schema",
    scopeId: REGISTRATION,
  });
});

test("an error that is neither a capability nor a primitive error answers without an origin", async () => {
  const { call, echo } = await rig(null, true);
  echo.thrown = new Error("boom");
  expect(errorOf(await call(capabilityCall()))).toEqual({
    kind: "engine_call_failed",
    message: "boom",
  });
});

test("a malformed capability key is invalid_params", async () => {
  const { call } = await rig();
  expect(
    errorOf(
      await call(
        callOf("capability", {
          key: { capability: "nodot", version: "1.0.0" },
          member: "run",
          input: {},
        }),
      ),
    ),
  ).toMatchObject({ kind: "invalid_params" });
});

test("a read of a kind that is not a record kind pattern is invalid_params; the own prefix reads", async () => {
  const { call } = await rig();
  expect(await call(callOf("readRecords", { kind: "x.ext-state.*" }))).toEqual({
    ok: true,
    value: [],
  });
  expect(errorOf(await call(callOf("readRecords", { kind: "plain" })))).toMatchObject({
    kind: "invalid_params",
  });
});

test("a requestEffect outside a replay reaches the engine, which refuses an undeclared capability", async () => {
  const { call } = await rig();
  const refused = errorOf(
    await call(
      callOf("requestEffect", { capability: "demo.echo", method: "run", input: {}, key: "k2" }),
    ),
  );
  expect(refused.kind).toBe("engine_call_failed");
  expect(refused.message).toMatch(/^capability_undeclared: /);
});

test("a requestEffect in a replay answers null without reaching the engine", async () => {
  const { call } = await rig(7);
  expect(
    await call(
      callOf("requestEffect", { capability: "demo.echo", method: "run", input: {}, key: "k1" }, 7),
    ),
  ).toEqual({ ok: true, value: null });
  expect(
    errorOf(
      await call(
        callOf(
          "requestEffect",
          { capability: "demo.echo", method: "run", input: {}, key: "x".repeat(49) },
          7,
        ),
      ),
    ),
  ).toMatchObject({ kind: "invalid_params" });
});

test("parseEngineCallParams accepts a known method and refuses an unknown one", () => {
  const known = parseEngineCallParams({
    method: "readRecords",
    registration: "ext-state",
    requestId: null,
    params: { kind: "x.ext-state.*" },
  });
  expect(known.ok).toBe(true);
  const unknown = parseEngineCallParams({
    method: "delegate",
    registration: "ext-state",
    requestId: null,
    params: {},
  });
  expect(unknown.ok).toBe(false);
});

test("updateState commits when the engine's state is the one the handler read", async () => {
  const { call, stateNow } = await rig();
  const reply = await call(
    callOf("updateState", { prev: { count: 0 }, next: { count: 1 }, records: [] }),
  );
  expect(reply).toEqual({ ok: true, value: { kind: "committed", state: { count: 1 } } });
  expect(await stateNow()).toEqual({ count: 1 });
});

test("updateState answers conflict with the engine's current state and commits nothing", async () => {
  const { call, stateNow } = await rig();
  const reply = await call(
    callOf("updateState", { prev: { count: 5 }, next: { count: 6 }, records: [] }),
  );
  expect(reply).toEqual({ ok: true, value: { kind: "conflict", current: { count: 0 } } });
  expect(await stateNow()).toEqual({ count: 0 });
});

test("updateState answers a state the schema refuses as a failed value with its kind", async () => {
  const { call, stateNow } = await rig();
  const reply = await call(
    callOf("updateState", { prev: { count: 0 }, next: { count: "x" }, records: [] }),
  );
  expect(reply).toEqual({ ok: true, value: { kind: "failed", failure: "state_schema" } });
  expect(await stateNow()).toEqual({ count: 0 });
});

test("updateState in a replay answers the input state and leaves the state unchanged", async () => {
  const { call, stateNow } = await rig(7);
  const reply = await call(
    callOf("updateState", { prev: { count: 0 }, next: { count: 9 }, records: [] }, 7),
  );
  expect(reply).toEqual({ ok: true, value: { kind: "committed", state: { count: 9 } } });
  expect(await stateNow()).toEqual({ count: 0 });
});

test("awaitUser without a request context answers null and changes nothing", async () => {
  const { call, stateNow } = await rig();
  expect(await call(callOf("awaitUser", { phase: "begin" }))).toEqual({ ok: true, value: null });
  expect(await call(callOf("awaitUser", { phase: "end" }))).toEqual({ ok: true, value: null });
  expect(await stateNow()).toEqual({ count: 0 });
});

test("awaitUser pauses the request's deadline clock from begin to end, as many times as it began", async () => {
  const log: string[] = [];
  const waits: OpenWaits = {
    count: 0,
    clock: {
      pause: () => log.push("pause"),
      resume: () => log.push("resume"),
    },
  };
  const { call } = await rig(null, false, waits);
  await call(callOf("awaitUser", { phase: "begin" }));
  await call(callOf("awaitUser", { phase: "begin" }));
  expect(waits.count).toBe(2);
  await call(callOf("awaitUser", { phase: "end" }));
  await call(callOf("awaitUser", { phase: "end" }));
  // 끝 신호가 더 와도 풀 것이 없다
  await call(callOf("awaitUser", { phase: "end" }));
  expect(waits.count).toBe(0);
  expect(log).toEqual(["pause", "pause", "resume", "resume"]);
});

/** 드라이브가 있는 등록 `drv-q`와 라우터 하나. `inDispatch`는 디스패치 안에서(thread 문맥이 있는) 라우터를 부르고, 밖에서는 `router`를 직접 부른다 */
async function driveRig() {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const slot: { g?: RegistrationApi<AnyState> } = {};
  /** 드라이브 단계가 본 시작 요청. 단계가 열린 thread의 임대 등록도 함께 본다 */
  const seen: { input: JsonValue | null; calledBy: string | null; scope: string | undefined }[] =
    [];
  await t.host.install(
    makeOrchestrationUnit<AnyState>({ name: "drv-q" }, (g) => {
      slot.g = g;
      g.drive(({ frame }) => {
        seen.push({
          input: frame.input,
          calledBy: frame.calledBy,
          scope: t.host.leaseOf(thread)?.scopeId,
        });
        const stop: DriveCommand<AnyState> = { do: "yield" };
        return Promise.resolve(stop);
      });
    }),
  );
  const probe: { run: () => Promise<void> } = { run: async () => {} };
  await t.host.install(
    makeUnit({ name: "ext-probe-q", hooks: ["tool.call.before"] }, (g) => {
      g.on("tool.call.before", async () => {
        await probe.run();
        return undefined;
      });
    }),
  );
  let replay = false;
  const router = createEngineCallRouter({
    gOf: (registration) => (registration === "drv-q" ? slot.g : undefined),
    replayOf: () => replay,
  });
  let seq = 0;
  async function inDispatch(params: EngineCallParams): Promise<Result<JsonValue, PluginHostError>> {
    const slotReply: { value?: Result<JsonValue, PluginHostError> } = {};
    probe.run = async () => {
      slotReply.value = await router(params);
    };
    seq += 1;
    await t.host.dispatch("tool.call.before", toolCall, {
      threadId: thread,
      dispatchKey: `probe-drv-q:${seq}`,
    });
    if (slotReply.value === undefined) throw new Error("the probe handler did not run");
    return slotReply.value;
  }
  return {
    t,
    seen,
    router,
    inDispatch,
    setReplay: (value: boolean): void => {
      replay = value;
    },
  };
}

function startDriveOf(input: JsonValue | null, requestId: number | null = null): EngineCallParams {
  return { method: "startDrive", registration: "drv-q", requestId, params: { input } };
}

test("startDrive in a dispatch queues the start request on that thread, and the drive step sees its input as a user request", async () => {
  const { t, seen, inDispatch } = await driveRig();
  expect(await inDispatch(startDriveOf({ topic: "t" }))).toEqual({
    ok: true,
    value: { ok: true },
  });
  await t.settled();
  expect(seen).toEqual([{ input: { topic: "t" }, calledBy: null, scope: "drv-q" }]);
});

test("startDrive outside any request context answers no_context as a value and queues nothing", async () => {
  const { t, seen, router } = await driveRig();
  expect(await router(startDriveOf(null))).toEqual({
    ok: true,
    value: { ok: false, error: { kind: "no_context" } },
  });
  await t.settled();
  expect(seen).toEqual([]);
});

test("a replayed startDrive answers ok without queueing a start request", async () => {
  const { t, seen, inDispatch, setReplay } = await driveRig();
  setReplay(true);
  expect(await inDispatch(startDriveOf(null, 7))).toEqual({ ok: true, value: { ok: true } });
  await t.settled();
  expect(seen).toEqual([]);
});

// ── runScript (설계 B): 라우터는 값을 그대로 옮기고, 실행기가 거절과 기동 실패를 값으로 낸다 ──

/** 받은 요청을 기록하고 준비한 결과를 돌려주는 실행기 대역 */
function recordingScripts(result: Result<ScriptRunResult, ScriptRunFailure>): {
  port: PluginScriptPort;
  requests: ScriptRunRequest[];
} {
  const requests: ScriptRunRequest[] = [];
  return {
    port: {
      run(request) {
        requests.push(request);
        return Promise.resolve(result);
      },
    },
    requests,
  };
}

const RUN_RESULT: ScriptRunResult = {
  exitCode: 2,
  signal: null,
  stdout: '{"ok":false}',
  stdoutTruncated: false,
  stderr: "bad\n",
  stderrTruncated: false,
  timedOut: false,
};

test("runScript passes the name, stdin and the caller's registration to the script port and answers its result", async () => {
  const scripts = recordingScripts(ok(RUN_RESULT));
  const { call } = await rig(null, false, undefined, scripts.port);
  const answered = await call(callOf("runScript", { name: "check", stdin: '{"a":1}' }));
  expect(answered).toEqual({ ok: true, value: { ok: true, value: { ...RUN_RESULT } } });
  expect(scripts.requests).toEqual([
    { registration: REGISTRATION, name: "check", stdin: '{"a":1}', replay: false },
  ]);
});

test("runScript without stdin sends an empty stdin", async () => {
  const scripts = recordingScripts(ok(RUN_RESULT));
  const { call } = await rig(null, false, undefined, scripts.port);
  await call(callOf("runScript", { name: "check" }));
  expect(scripts.requests.map((request) => request.stdin)).toEqual([""]);
});

test("runScript in a replay is passed on as a replay request and the port's refusal is the answer", async () => {
  const scripts = recordingScripts(err({ kind: "replay_mode_denied" }));
  const { call } = await rig(7, false, undefined, scripts.port);
  const answered = await call(callOf("runScript", { name: "check" }, 7));
  expect(answered).toEqual({
    ok: true,
    value: { ok: false, error: { kind: "replay_mode_denied" } },
  });
  expect(scripts.requests.map((request) => request.replay)).toEqual([true]);
});

test("runScript without an injected script port answers sandbox_unavailable as a value and runs nothing", async () => {
  const { call } = await rig();
  const answered = await call(callOf("runScript", { name: "check" }));
  expect(answered).toEqual({
    ok: true,
    value: { ok: false, error: { kind: "sandbox_unavailable", reason: "script_port_missing" } },
  });
});

test("a runScript name that does not match the name pattern is invalid_params", async () => {
  const scripts = recordingScripts(ok(RUN_RESULT));
  const { call } = await rig(null, false, undefined, scripts.port);
  const refused = errorOf(await call(callOf("runScript", { name: "Check Me" })));
  expect(refused).toMatchObject({ kind: "invalid_params" });
  expect(scripts.requests).toEqual([]);
});

test("runScript stdin over the byte limit is invalid_params and nothing is asked", async () => {
  const scripts = recordingScripts(ok(RUN_RESULT));
  const { call } = await rig(null, false, undefined, scripts.port);
  const refused = errorOf(
    await call(
      callOf("runScript", { name: "check", stdin: "a".repeat(SCRIPT_LIMITS.stdinBytes + 1) }),
    ),
  );
  expect(refused).toMatchObject({ kind: "invalid_params" });
  expect(scripts.requests).toEqual([]);
});

test("parseEngineCallParams accepts runScript", () => {
  expect(parseEngineCallParams(callOf("runScript", { name: "check" })).ok).toBe(true);
});
