import { expect, test } from "bun:test";
import type { TraceReadPort } from "@fresnel/contracts/extensions";
import { hookOrderOf, type HookOrderMap } from "@fresnel/ext-host";
import {
  createExtReadPort,
  EMPTY_EXT_READ_SOURCES,
  type ExtReadSources,
} from "../../src/assembly/m4/ext-read-port.ts";
import { createExtReadHandlers } from "../../src/handlers/m4/ext-read.ts";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { recordingEnv, type RecordingEnv } from "../fixtures/hook-order-env.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// hooks.order.*(W-51, X.operations §4.1.5, F.wire-settings §3). 처리기는 실제 표 위에서 돌고, 핸들러 원천과 설정 저장소만 대역이다.
// 저장 값은 원천(`saved()`)이 설정 저장소의 값을 `hookOrderOf`로 다시 읽어 보인다. 쓰기는 `RecordingEnv.calls`에 남는다.

const KEY = "x.operations.hookOrder";

type HandlerRow = ReturnType<ExtReadSources["hookHandlers"]>[number];

// tool.call.before: first, closed. guard(tier 0) policy와 audit, user alpha, project gamma.
// request.context.before: chain, 멈춤 규칙 없음. alpha, gamma. 배열 순서는 일부러 뒤섞었다: 기본 순서는 (tier, loadIndex, seq)다.
const HANDLERS: readonly HandlerRow[] = [
  {
    point: "tool.call.before",
    registrationId: "gamma",
    extension: "gamma",
    tier: 2,
    loadIndex: 3,
    seq: 0,
  },
  {
    point: "tool.call.before",
    registrationId: "audit",
    extension: "audit",
    tier: 0,
    loadIndex: 1,
    seq: 0,
  },
  {
    point: "tool.call.before",
    registrationId: "policy",
    extension: "policy",
    tier: 0,
    loadIndex: 0,
    seq: 0,
  },
  {
    point: "tool.call.before",
    registrationId: "alpha",
    extension: "alpha",
    tier: 1,
    loadIndex: 2,
    seq: 0,
  },
  {
    point: "request.context.before",
    registrationId: "gamma",
    extension: "gamma",
    tier: 2,
    loadIndex: 3,
    seq: 1,
  },
  {
    point: "request.context.before",
    registrationId: "alpha",
    extension: "alpha",
    tier: 1,
    loadIndex: 2,
    seq: 1,
  },
];

const EMPTY_TRACE: TraceReadPort = {
  enabled: () => false,
  turn: () => undefined,
  timings: () => ({ traceEnabled: false, timings: [] }),
};

/** 저장 값은 `values`에서 읽고, 적용 중인 값은 `applied`를 그대로 쓴다 */
function sourcesOf(
  values: Map<string, unknown>,
  applied: HookOrderMap = hookOrderOf({}),
): ExtReadSources {
  return {
    ...EMPTY_EXT_READ_SOURCES,
    hookHandlers: () => HANDLERS,
    hookOrder: () => ({
      saved: () => hookOrderOf(values.get(KEY)),
      applied: () => applied,
      pending: () => false,
    }),
  };
}

function connect(sources: ExtReadSources, env: RecordingEnv) {
  const port = createExtReadPort({ traceRead: EMPTY_TRACE, env: env.env }, sources);
  const host = createFakeHost({
    override: (table) => ({ ...table, ...createExtReadHandlers(port) }),
  });
  return host.connect().connection;
}

async function failureOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (error: unknown) => error,
  );
}

const POLICY = { registrationId: "policy", extension: "policy", tier: 0 };
const AUDIT = { registrationId: "audit", extension: "audit", tier: 0 };
const ALPHA = { registrationId: "alpha", extension: "alpha", tier: 1 };
const GAMMA = { registrationId: "gamma", extension: "gamma", tier: 2 };

test("hooks.order.get: nothing saved and nothing applied gives an empty list", async () => {
  const env = recordingEnv();
  const connection = connect(sourcesOf(env.values), env);
  await connection.request("host.hello", HELLO_PARAMS);
  expect(await connection.request("hooks.order.get", {})).toEqual({ hooks: [] });
  await connection.close();
});

test("hooks.order.get: saved and applied per hook, and pending when they differ", async () => {
  const env = recordingEnv();
  env.values.set(KEY, { "tool.call.before": ["gamma", "alpha"] });
  const applied = hookOrderOf({
    "tool.call.before": ["alpha", "gamma"],
    "request.context.before": ["gamma"],
  });
  const connection = connect(sourcesOf(env.values, applied), env);
  await connection.request("host.hello", HELLO_PARAMS);
  expect(await connection.request("hooks.order.get", {})).toEqual({
    hooks: [
      { hook: "request.context.before", saved: [], applied: ["gamma"], pending: true },
      {
        hook: "tool.call.before",
        saved: ["gamma", "alpha"],
        applied: ["alpha", "gamma"],
        pending: true,
      },
    ],
  });
  await connection.close();
});

test("hooks.order.set: across tiers stores the list under the user scope with the exact write call", async () => {
  const env = recordingEnv();
  const connection = connect(sourcesOf(env.values), env);
  await connection.request("host.hello", HELLO_PARAMS);
  expect(
    await connection.request("hooks.order.set", {
      hook: "tool.call.before",
      order: ["gamma", "alpha"],
    }),
  ).toEqual({ hook: "tool.call.before", saved: ["gamma", "alpha"], appliesAt: "nextStepBoundary" });
  expect(env.calls).toEqual([
    {
      op: "write",
      scope: "user",
      key: KEY,
      value: { "tool.call.before": ["gamma", "alpha"] },
      threadId: undefined,
    },
  ]);
  expect(await connection.request("hooks.order.get", {})).toEqual({
    hooks: [
      {
        hook: "tool.call.before",
        saved: ["gamma", "alpha"],
        applied: [],
        pending: true,
      },
    ],
  });
  await connection.close();
});

test("hooks.order.set: moving a guard handler is saved as proposed, above or below a regular handler, and nothing is refused", async () => {
  const env = recordingEnv();
  const connection = connect(sourcesOf(env.values), env);
  await connection.request("host.hello", HELLO_PARAMS);
  expect(
    await connection.request("hooks.order.set", {
      hook: "tool.call.before",
      order: ["audit", "policy"],
    }),
  ).toEqual({
    hook: "tool.call.before",
    saved: ["audit", "policy"],
    appliesAt: "nextStepBoundary",
  });
  expect(env.calls).toEqual([
    {
      op: "write",
      scope: "user",
      key: KEY,
      value: { "tool.call.before": ["audit", "policy"] },
      threadId: undefined,
    },
  ]);
  expect(
    await connection.request("hooks.order.set", {
      hook: "tool.call.before",
      order: ["alpha", "policy"],
    }),
  ).toEqual({
    hook: "tool.call.before",
    saved: ["alpha", "policy"],
    appliesAt: "nextStepBoundary",
  });
  expect(env.values.get(KEY)).toEqual({ "tool.call.before": ["alpha", "policy"] });
  await connection.close();
});

test("hooks.order.set: guard ids are stored as proposed, with duplicates dropped", async () => {
  const env = recordingEnv();
  const connection = connect(sourcesOf(env.values), env);
  await connection.request("host.hello", HELLO_PARAMS);
  expect(
    await connection.request("hooks.order.set", {
      hook: "tool.call.before",
      order: ["policy", "audit", "gamma", "alpha", "policy"],
    }),
  ).toEqual({
    hook: "tool.call.before",
    saved: ["policy", "audit", "gamma", "alpha"],
    appliesAt: "nextStepBoundary",
  });
  expect(env.calls).toEqual([
    {
      op: "write",
      scope: "user",
      key: KEY,
      value: { "tool.call.before": ["policy", "audit", "gamma", "alpha"] },
      threadId: undefined,
    },
  ]);
  await connection.close();
});

test("hooks.order.set: a registration id that is not in the hook is accepted and stored", async () => {
  const env = recordingEnv();
  const connection = connect(sourcesOf(env.values), env);
  await connection.request("host.hello", HELLO_PARAMS);
  expect(
    await connection.request("hooks.order.set", {
      hook: "request.context.before",
      order: ["ghost", "alpha"],
    }),
  ).toEqual({
    hook: "request.context.before",
    saved: ["ghost", "alpha"],
    appliesAt: "nextStepBoundary",
  });
  expect(env.values.get(KEY)).toEqual({ "request.context.before": ["ghost", "alpha"] });
  await connection.close();
});

test("hooks.order.set and hooks.order.reset: an unknown hook is hooks.notFound, and preview of it too", async () => {
  const env = recordingEnv();
  const connection = connect(sourcesOf(env.values), env);
  await connection.request("host.hello", HELLO_PARAMS);
  const set = await failureOf(
    connection.request("hooks.order.set", { hook: "no.such.hook", order: ["alpha"] }),
  );
  expect(set).toMatchObject({
    code: 3405,
    data: { kind: "hooks.notFound", details: { hook: "no.such.hook" } },
  });
  const reset = await failureOf(connection.request("hooks.order.reset", { hook: "no.such.hook" }));
  expect(reset).toMatchObject({
    code: 3405,
    data: { kind: "hooks.notFound", details: { hook: "no.such.hook" } },
  });
  const preview = await failureOf(
    connection.request("hooks.order.preview", { hook: "no.such.hook", order: [] }),
  );
  expect(preview).toMatchObject({ code: 3405, data: { kind: "hooks.notFound" } });
  expect(env.calls).toEqual([]);
  await connection.close();
});

test("hooks.order.set: a failed settings write answers the store error and stores nothing", async () => {
  const env = recordingEnv({
    failure: { kind: "file_unwritable", path: "/cfg/settings.json", code: "EACCES" },
  });
  const connection = connect(sourcesOf(env.values), env);
  await connection.request("host.hello", HELLO_PARAMS);
  const failed = await failureOf(
    connection.request("hooks.order.set", { hook: "tool.call.before", order: ["gamma"] }),
  );
  expect(failed).toMatchObject({
    message: "hooks.order.set: the settings file cannot be written",
    data: { kind: "store.io", details: { code: "EACCES" } },
  });
  expect(env.values.has(KEY)).toBe(false);
  await connection.close();
});

test("hooks.order.reset: one hook clears only that hook and writes the rest", async () => {
  const env = recordingEnv();
  env.values.set(KEY, {
    "tool.call.before": ["gamma", "alpha"],
    "request.context.before": ["gamma", "alpha"],
  });
  const connection = connect(sourcesOf(env.values), env);
  await connection.request("host.hello", HELLO_PARAMS);
  expect(await connection.request("hooks.order.reset", { hook: "tool.call.before" })).toEqual({
    hooks: ["tool.call.before"],
    appliesAt: "nextStepBoundary",
  });
  expect(env.calls).toEqual([
    {
      op: "write",
      scope: "user",
      key: KEY,
      value: { "request.context.before": ["gamma", "alpha"] },
      threadId: undefined,
    },
  ]);
  await connection.close();
});

test("hooks.order.reset: without a hook clears every saved hook and removes the setting when none remain", async () => {
  const env = recordingEnv();
  env.values.set(KEY, {
    "tool.call.before": ["gamma", "alpha"],
    "request.context.before": ["gamma", "alpha"],
  });
  const connection = connect(sourcesOf(env.values), env);
  await connection.request("host.hello", HELLO_PARAMS);
  expect(await connection.request("hooks.order.reset", {})).toEqual({
    hooks: ["request.context.before", "tool.call.before"],
    appliesAt: "nextStepBoundary",
  });
  expect(env.calls).toEqual([
    { op: "reset", scope: "user", key: KEY, value: undefined, threadId: undefined },
  ]);
  expect(await connection.request("hooks.order.get", {})).toEqual({ hooks: [] });
  await connection.close();
});

test("hooks.order.reset: with nothing saved answers an empty list and writes nothing", async () => {
  const env = recordingEnv();
  const connection = connect(sourcesOf(env.values), env);
  await connection.request("host.hello", HELLO_PARAMS);
  expect(await connection.request("hooks.order.reset", {})).toEqual({
    hooks: [],
    appliesAt: "nextStepBoundary",
  });
  expect(await connection.request("hooks.order.reset", { hook: "tool.call.before" })).toEqual({
    hooks: [],
    appliesAt: "nextStepBoundary",
  });
  expect(env.calls).toEqual([]);
  await connection.close();
});

test("hooks.order.preview: a first closed hook lists first_answer and first_failure_deny with the handlers before each", async () => {
  const env = recordingEnv();
  const connection = connect(sourcesOf(env.values), env);
  await connection.request("host.hello", HELLO_PARAMS);
  expect(
    await connection.request("hooks.order.preview", {
      hook: "tool.call.before",
      order: ["gamma", "alpha"],
    }),
  ).toEqual({
    hook: "tool.call.before",
    order: ["policy", "audit", "gamma", "alpha"],
    saveable: true,
    guardRisk: [],
    skips: [
      { registrationId: "audit", extension: "audit", reason: "first_answer", by: [POLICY] },
      { registrationId: "audit", extension: "audit", reason: "first_failure_deny", by: [POLICY] },
      { registrationId: "gamma", extension: "gamma", reason: "first_answer", by: [POLICY, AUDIT] },
      {
        registrationId: "gamma",
        extension: "gamma",
        reason: "first_failure_deny",
        by: [POLICY, AUDIT],
      },
      {
        registrationId: "alpha",
        extension: "alpha",
        reason: "first_answer",
        by: [POLICY, AUDIT, GAMMA],
      },
      {
        registrationId: "alpha",
        extension: "alpha",
        reason: "first_failure_deny",
        by: [POLICY, AUDIT, GAMMA],
      },
    ],
    valueChanges: [],
    autoDisable: [{ registrationId: "gamma", extension: "gamma", affects: [ALPHA] }],
  });
  // 저장은 일어나지 않는다
  expect(env.calls).toEqual([]);
  await connection.close();
});

test("hooks.order.preview: a guard-moving proposal stays saveable and reports the guard as skippable and losing its first place", async () => {
  const env = recordingEnv();
  const connection = connect(sourcesOf(env.values), env);
  await connection.request("host.hello", HELLO_PARAMS);
  expect(
    await connection.request("hooks.order.preview", {
      hook: "tool.call.before",
      order: ["audit", "policy"],
    }),
  ).toEqual({
    hook: "tool.call.before",
    order: ["audit", "policy", "alpha", "gamma"],
    saveable: true,
    skips: [
      { registrationId: "policy", extension: "policy", reason: "first_answer", by: [AUDIT] },
      { registrationId: "policy", extension: "policy", reason: "first_failure_deny", by: [AUDIT] },
      { registrationId: "alpha", extension: "alpha", reason: "first_answer", by: [AUDIT, POLICY] },
      {
        registrationId: "alpha",
        extension: "alpha",
        reason: "first_failure_deny",
        by: [AUDIT, POLICY],
      },
      {
        registrationId: "gamma",
        extension: "gamma",
        reason: "first_answer",
        by: [AUDIT, POLICY, ALPHA],
      },
      {
        registrationId: "gamma",
        extension: "gamma",
        reason: "first_failure_deny",
        by: [AUDIT, POLICY, ALPHA],
      },
    ],
    valueChanges: [],
    // audit과 policy는 guard라 면제다. alpha는 뒤에 gamma가 있어 노트가 있다
    autoDisable: [{ registrationId: "alpha", extension: "alpha", affects: [GAMMA] }],
    guardRisk: [
      {
        registrationId: "policy",
        extension: "policy",
        mayBeSkipped: true,
        losesFirstPosition: true,
        by: [AUDIT],
      },
    ],
  });
  await connection.close();
});

test("hooks.order.preview: a chain hook lists value changes and no skips", async () => {
  const env = recordingEnv();
  const connection = connect(sourcesOf(env.values), env);
  await connection.request("host.hello", HELLO_PARAMS);
  expect(
    await connection.request("hooks.order.preview", {
      hook: "request.context.before",
      order: ["gamma", "alpha"],
    }),
  ).toEqual({
    hook: "request.context.before",
    order: ["gamma", "alpha"],
    saveable: true,
    guardRisk: [],
    skips: [],
    valueChanges: [{ registrationId: "alpha", extension: "alpha", by: [GAMMA] }],
    autoDisable: [],
  });
  await connection.close();
});
