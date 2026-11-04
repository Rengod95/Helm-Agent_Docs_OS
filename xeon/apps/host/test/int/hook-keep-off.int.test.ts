import { expect, test } from "bun:test";
import type { TraceReadPort } from "@fresnel/contracts/extensions";
import {
  createExtReadPort,
  EMPTY_EXT_READ_SOURCES,
  type ExtReadSources,
} from "../../src/assembly/m4/ext-read-port.ts";
import { createExtReadHandlers } from "../../src/handlers/m4/ext-read.ts";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { recordingEnv, type RecordingEnv } from "../fixtures/hook-order-env.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// hooks.disableConfirm, hooks.reenable (X.operations §4.3.3 외부 훅 질문의 답 경로). 처리기는 실제 표 위에서 돌고,
// 훅 장부 원천과 설정 저장소만 대역이다. 꺼짐은 설정 `x.operations.hookDisabled`에 먼저 쓰인다.

const KEY = "x.operations.hookDisabled";
const QUESTION = { rule: "consecutive", consecutive: 5, windowFailures: 5 } as const;
const APPLIED = { appliesAt: "nextStepBoundary", diagnostics: [] } as const;

const EMPTY_TRACE: TraceReadPort = {
  enabled: () => false,
  turn: () => undefined,
  timings: () => ({ traceEnabled: false, timings: [] }),
};

interface Recorded {
  readonly sources: ExtReadSources;
  readonly confirmed: string[];
  readonly reenabled: string[];
}

/** `asking`인 훅은 질문이 있고, 저장 값은 설정 저장소(`values`)에서 읽는다 */
function sourcesOf(
  env: RecordingEnv,
  asking: readonly string[],
  patch: Partial<ExtReadSources> = {},
): Recorded {
  const confirmed: string[] = [];
  const reenabled: string[] = [];
  const sources: ExtReadSources = {
    ...EMPTY_EXT_READ_SOURCES,
    hookKeepOffQuestion: (hook) => (asking.includes(hook) ? QUESTION : null),
    hookDisabledSaved: () => {
      const value = env.values.get(KEY);
      return Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
    },
    hookDisableConfirm: (hook) => {
      confirmed.push(hook);
    },
    hookReenable: (hook) => {
      reenabled.push(hook);
    },
    ...patch,
  };
  return { sources, confirmed, reenabled };
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

test("hooks.list shows each external hook as its own row by id, with the question and off state; hook points carry neither", async () => {
  const env = recordingEnv();
  env.values.set(KEY, ["log-start"]);
  const { sources } = sourcesOf(env, ["no-rm"], {
    externalHooks: () => [
      {
        id: "no-rm",
        point: "tool.call.before",
        source: "user",
        tierRank: 1,
        unit: "fresnel-hooks-user",
      },
      {
        id: "log-start",
        point: "thread.start",
        source: "user",
        tierRank: 1,
        unit: "fresnel-hooks-user",
      },
    ],
    hookHandlers: () => [
      {
        point: "tool.call.before",
        registrationId: "b",
        extension: "b",
        tier: 0,
        loadIndex: 1,
        seq: 1,
      },
      {
        point: "tool.call.before",
        registrationId: "a",
        extension: "a",
        tier: 3,
        loadIndex: 0,
        seq: 0,
      },
    ],
  });
  const connection = connect(sources, env);
  await connection.request("host.hello", HELLO_PARAMS);
  const listed = await connection.request("hooks.list", {});
  expect(
    listed.hooks.map((row) => [
      row.hook,
      row.point,
      row.source,
      row.external,
      row.handlers,
      row.keepOffQuestion,
      row.autoDisabled,
    ]),
  ).toEqual([
    ["log-start", "thread.start", "user", true, 0, undefined, true],
    ["no-rm", "tool.call.before", "user", true, 1, QUESTION, undefined],
    ["thread.start", undefined, undefined, false, 1, undefined, undefined],
    ["tool.call.before", undefined, undefined, false, 3, undefined, undefined],
  ]);
  // 지점 줄의 순서에 외부 훅이 실제 id로, 디스패치와 같은 tier 순서로 낀다: tier 0, 외부(tier 1), tier 3
  const point = listed.hooks.find((row) => row.hook === "tool.call.before");
  expect(point?.order?.map((row) => [row.registrationId, row.tier])).toEqual([
    ["b", 0],
    ["no-rm", 1],
    ["a", 3],
  ]);
  await connection.close();
});

test("hooks.list keeps a row for an off hook whose definition is not visible", async () => {
  const env = recordingEnv();
  env.values.set(KEY, ["gone-hook"]);
  const { sources } = sourcesOf(env, []);
  const connection = connect(sources, env);
  await connection.request("host.hello", HELLO_PARAMS);
  const listed = await connection.request("hooks.list", {});
  expect(listed.hooks.map((row) => [row.hook, row.fold, row.handlers, row.autoDisabled])).toEqual([
    ["gone-hook", "external", 0, true],
  ]);
  await connection.close();
});

test("hooks.disableConfirm: writes the off state to the user file first, then answers yes", async () => {
  const env = recordingEnv();
  env.values.set(KEY, ["zzz"]);
  const recorded = sourcesOf(env, ["no-rm-rf"]);
  const connection = connect(recorded.sources, env);
  await connection.request("host.hello", HELLO_PARAMS);
  expect(await connection.request("hooks.disableConfirm", { hook: "no-rm-rf" })).toEqual(APPLIED);
  expect(env.calls).toEqual([
    { op: "write", scope: "user", key: KEY, value: ["no-rm-rf", "zzz"], threadId: undefined },
  ]);
  expect(recorded.confirmed).toEqual(["no-rm-rf"]);
  await connection.close();
});

test("hooks.disableConfirm: an unknown hook is hooks.notFound, and safe mode refuses", async () => {
  const env = recordingEnv();
  const recorded = sourcesOf(env, ["no-rm-rf"]);
  const connection = connect(recorded.sources, env);
  await connection.request("host.hello", HELLO_PARAMS);
  const unknown = await failureOf(connection.request("hooks.disableConfirm", { hook: "nope" }));
  expect(unknown).toMatchObject({
    code: 3405,
    data: { kind: "hooks.notFound", details: { hook: "nope" } },
  });
  expect(env.calls).toEqual([]);
  expect(recorded.confirmed).toEqual([]);
  await connection.close();

  const safeEnv = recordingEnv();
  const safe = sourcesOf(safeEnv, ["no-rm-rf"], {
    safeMode: () => ({ active: true, cause: "user" }),
  });
  const safeConnection = connect(safe.sources, safeEnv);
  await safeConnection.request("host.hello", HELLO_PARAMS);
  const refused = await failureOf(
    safeConnection.request("hooks.disableConfirm", { hook: "no-rm-rf" }),
  );
  expect(refused).toMatchObject({ code: 3403, data: { kind: "extension.safeModeActive" } });
  expect(safe.confirmed).toEqual([]);
  expect(safeEnv.calls).toEqual([]);
  await safeConnection.close();
});

test("hooks.disableConfirm: a failed settings write answers the store error and does not turn the hook off", async () => {
  const env = recordingEnv({
    failure: { kind: "file_unwritable", path: "/cfg/settings.json", code: "EACCES" },
  });
  const recorded = sourcesOf(env, ["no-rm-rf"]);
  const connection = connect(recorded.sources, env);
  await connection.request("host.hello", HELLO_PARAMS);
  const failed = await failureOf(connection.request("hooks.disableConfirm", { hook: "no-rm-rf" }));
  expect(failed).toMatchObject({ data: { kind: "store.io", details: { code: "EACCES" } } });
  expect(recorded.confirmed).toEqual([]);
  await connection.close();
});

test("hooks.reenable: keeps a questioned hook on without touching the file, and turns a saved-off hook back on", async () => {
  const env = recordingEnv();
  env.values.set(KEY, ["off-hook", "other"]);
  const recorded = sourcesOf(env, ["asked"]);
  const connection = connect(recorded.sources, env);
  await connection.request("host.hello", HELLO_PARAMS);
  expect(await connection.request("hooks.reenable", { hook: "asked" })).toEqual(APPLIED);
  expect(env.calls).toEqual([]);
  expect(await connection.request("hooks.reenable", { hook: "off-hook" })).toEqual(APPLIED);
  expect(env.calls).toEqual([
    { op: "write", scope: "user", key: KEY, value: ["other"], threadId: undefined },
  ]);
  expect(recorded.reenabled).toEqual(["asked", "off-hook"]);
  const unknown = await failureOf(connection.request("hooks.reenable", { hook: "nope" }));
  expect(unknown).toMatchObject({ code: 3405, data: { kind: "hooks.notFound" } });
  await connection.close();
});

test("hooks.reenable: turning the last saved hook back on clears the setting", async () => {
  const env = recordingEnv();
  env.values.set(KEY, ["only"]);
  const recorded = sourcesOf(env, []);
  const connection = connect(recorded.sources, env);
  await connection.request("host.hello", HELLO_PARAMS);
  await connection.request("hooks.reenable", { hook: "only" });
  expect(env.calls).toEqual([
    { op: "reset", scope: "user", key: KEY, value: undefined, threadId: undefined },
  ]);
  await connection.close();
});
