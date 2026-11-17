import { expect, test } from "bun:test";
import { Type } from "typebox";
import type { Result } from "@fresnel/contracts";
import type { JsonValue } from "@fresnel/contracts/conversation";
import type {
  EngineCallParams,
  PluginHostError,
  RegistrationApi,
} from "@fresnel/contracts/extensions";
import { createEngineCallRouter, parseEngineCallParams } from "../../src/isolation/engine-calls.ts";
import type { AnyState } from "../../src/primitives/erased-types.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { makeUnit } from "../primitives/fixtures/support.ts";

const REGISTRATION = "ext-state";
const toolCall = { toolCallId: "call_1", toolName: "read", input: { path: "a" } };

/**
 * 실제 확장 호스트에 등록 하나를 올리고, 그 `g`로 라우터를 만든다. 라우터는 디스패치 안에서 불린다.
 * 실제 플러그인 경로와 같이 ambient 문맥(스레드, 등록 범위)이 있어야 `g`의 메서드가 동작한다
 */
async function rig(replayId: number | null = null) {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const slot: { g?: RegistrationApi<AnyState> } = {};
  await t.host.install(
    makeUnit<AnyState>(
      {
        name: REGISTRATION,
        usesPost: true,
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
  return { call, stateNow };
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
