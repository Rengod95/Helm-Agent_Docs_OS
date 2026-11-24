import { expect, test } from "bun:test";
import type { JsonValue } from "@fresnel/contracts/conversation";
import type { RegistrationApi } from "@fresnel/contracts/extensions";
import {
  createEngineCallRouter,
  type EngineMethodScope,
} from "../../src/isolation/engine-calls.ts";
import type { AnyState } from "../../src/primitives/erased-types.ts";
import { withAmbient, withReadOnlyMethod, type Ambient } from "../../src/primitives/ambient.ts";
import { hostOf } from "../../src/primitives/index.ts";
import { createTestHost, memoryPluginStore } from "../../src/testing/index.ts";
import { makeUnit } from "../primitives/fixtures/support.ts";

// 격리 경로의 `pluginStore` engine.call 왕복(X.primitives.spec §4.6.7). 자식이 보낸 요청은 라우터가 받아 같은 `g`의 저장소로 옮긴다.
// 쓰기 자격은 요청이 확장 메서드의 것인지(`methodScopeOf`)로 정해진다. 훅 요청에는 표지가 없다

const REGISTRATION = "ps-iso";

test("a pluginStore engine call round-trips through the router; a hook or a readOnly method cannot write", async () => {
  const port = memoryPluginStore();
  const t = await createTestHost({ pluginStore: port });
  const slot: { g?: RegistrationApi<AnyState> } = {};
  await t.host.install(
    makeUnit<AnyState>({ name: REGISTRATION }, (g) => {
      slot.g = g;
    }),
  );
  const scope: { current: EngineMethodScope | undefined } = { current: undefined };
  const router = createEngineCallRouter({
    gOf: (registration) => (registration === REGISTRATION ? slot.g : undefined),
    replayOf: () => false,
    methodScopeOf: () => scope.current,
  });
  const call = (params: JsonValue) =>
    router({ method: "pluginStore", registration: REGISTRATION, requestId: null, params });

  // 메서드 표지가 있으면 쓸 수 있다
  scope.current = { readOnly: false, ownData: false };
  expect(await call({ op: "put", key: "note.one", value: { n: 1 } })).toEqual({
    ok: true,
    value: { ok: true, value: null },
  });
  expect(await call({ op: "get", key: "note.one" })).toEqual({
    ok: true,
    value: { ok: true, value: { n: 1 } },
  });
  expect(await call({ op: "list", prefix: "note." })).toEqual({
    ok: true,
    value: { ok: true, value: [{ key: "note.one", value: { n: 1 } }] },
  });
  expect(await call({ op: "put", key: "Bad", value: 1 })).toEqual({
    ok: true,
    value: { ok: false, error: { kind: "store_key_invalid" } },
  });

  // readOnly 메서드는 읽고, 쓰면 거부된다. 거부된 쓰기는 저장소를 바꾸지 않는다
  scope.current = { readOnly: true, ownData: false };
  expect(await call({ op: "get", key: "note.one" })).toEqual({
    ok: true,
    value: { ok: true, value: { n: 1 } },
  });
  expect(await call({ op: "put", key: "note.one", value: { n: 2 } })).toMatchObject({
    ok: false,
    error: { kind: "engine_call_failed", origin: { kind: "primitive", code: "read_only_method" } },
  });
  expect(await port.get(REGISTRATION, "note.one")).toEqual({ ok: true, value: '{"n":1}' });

  // 훅 요청(메서드 표지 없음)은 쓰지 못한다. 읽기는 된다
  scope.current = undefined;
  expect(await call({ op: "delete", key: "note.one" })).toMatchObject({
    ok: false,
    error: {
      kind: "engine_call_failed",
      origin: { kind: "primitive", code: "store_outside_method" },
    },
  });
  expect(await call({ op: "get", key: "note.one" })).toEqual({
    ok: true,
    value: { ok: true, value: { n: 1 } },
  });
  expect(await port.get(REGISTRATION, "note.one")).toEqual({ ok: true, value: '{"n":1}' });
});

test("a pluginStore call with a malformed shape is refused as invalid_params", async () => {
  const t = await createTestHost({ pluginStore: memoryPluginStore() });
  const slot: { g?: RegistrationApi<AnyState> } = {};
  await t.host.install(
    makeUnit<AnyState>({ name: REGISTRATION }, (g) => {
      slot.g = g;
    }),
  );
  const router = createEngineCallRouter({
    gOf: (registration) => (registration === REGISTRATION ? slot.g : undefined),
    replayOf: () => false,
    methodScopeOf: () => ({ readOnly: false, ownData: false }),
  });
  expect(
    await router({
      method: "pluginStore",
      registration: REGISTRATION,
      requestId: null,
      params: { op: "clear" },
    }),
  ).toMatchObject({ ok: false, error: { kind: "invalid_params" } });
});

test("a tool's pluginStore write is not refused when the router runs inside a readOnly method flow it did not start from", async () => {
  const port = memoryPluginStore();
  const t = await createTestHost({ pluginStore: port });
  const slot: { g?: RegistrationApi<AnyState> } = {};
  await t.host.install(
    makeUnit<AnyState>({ name: REGISTRATION }, (g) => {
      slot.g = g;
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  if (slot.g === undefined) throw new Error("the unit was not set up");
  const toolAmbient: Ambient = {
    threadId: thread,
    scopeId: hostOf(slot.g).scopeId,
    point: null,
    dispatchKey: null,
    counter: 0,
    drive: null,
    handler: null,
    invocation: "tool",
    callId: "call-1",
  };
  const router = createEngineCallRouter({
    gOf: (registration) => (registration === REGISTRATION ? slot.g : undefined),
    replayOf: () => false,
    ambientOf: () => toolAmbient,
    methodScopeOf: () => undefined,
  });
  // 감독의 읽기 흐름이 readOnly 메서드 호출 안에서 시작되었다면, 그 표지가 도구 요청에 새면 안 된다
  const reply = await withReadOnlyMethod(() =>
    router({
      method: "pluginStore",
      registration: REGISTRATION,
      requestId: 7,
      params: { op: "put", key: "tool.note", value: { n: 1 } },
    }),
  );
  expect(reply).toEqual({ ok: true, value: { ok: true, value: null } });
  expect(await port.get(REGISTRATION, "tool.note")).toEqual({ ok: true, value: '{"n":1}' });
});

test("a pluginStore write of a method request without an ambient ignores the ambient of the flow that reads engine calls", async () => {
  const port = memoryPluginStore();
  const t = await createTestHost({ pluginStore: port });
  const slot: { g?: RegistrationApi<AnyState> } = {};
  await t.host.install(
    makeUnit<AnyState>({ name: REGISTRATION }, (g) => {
      slot.g = g;
    }),
  );
  const router = createEngineCallRouter({
    gOf: (registration) => (registration === REGISTRATION ? slot.g : undefined),
    replayOf: () => false,
    methodScopeOf: () => ({ readOnly: false, ownData: false }),
  });
  // 자식을 처음 띄운 훅 디스패치의 ambient(`invocation` 없음)가 이 흐름에 남아 있다
  const foreign: Ambient = {
    threadId: t.newThread(),
    scopeId: "other-scope",
    point: null,
    dispatchKey: "hook:1",
    counter: 0,
    drive: null,
    handler: null,
  };
  const reply = await withAmbient(foreign, () =>
    router({
      method: "pluginStore",
      registration: REGISTRATION,
      requestId: null,
      params: { op: "put", key: "note.one", value: { n: 1 } },
    }),
  );
  expect(reply).toEqual({ ok: true, value: { ok: true, value: null } });
  expect(await port.get(REGISTRATION, "note.one")).toEqual({ ok: true, value: '{"n":1}' });
});
