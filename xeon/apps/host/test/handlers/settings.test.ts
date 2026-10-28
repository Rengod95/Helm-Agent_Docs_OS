import { expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import { WireError } from "@xeon/contracts/wire";
import type { SettingsWriteFailure } from "../../src/types.ts";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { Type } from "typebox";
import { defineSettings } from "@xeon/contracts/settings";
import { flushMicrotasks, settleUntil } from "../fixtures/clock.ts";
import type { WireNotificationParams } from "../fixtures/notifications.ts";

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  try {
    await call;
  } catch (caught) {
    if (caught instanceof WireError) return caught;
    throw caught;
  }
  throw new Error("expected the request to fail with a WireError");
}

test("settings-get-resolves: no keys returns the whole catalog sorted by key with defaults", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const result = await connection.request("settings.get", {});
  const keys = result.settings.map((setting) => setting.key);
  expect(keys).toEqual(keys.toSorted());
  expect(keys.length).toBe(host.fake.engine.catalog.size);
  const replay = result.settings.find(
    (setting) => setting.key === "l4.host-service.maxReplayEvents",
  );
  expect(replay).toMatchObject({
    value: 100_000,
    source: { scope: "default" },
    locked: false,
    runtimeChange: "live",
    pendingUntil: null,
    deprecated: false,
  });
  await connection.close();
});

test("settings-get-resolves: the layers decide the value, the source and the shadowed scopes", async () => {
  const key = "l4.host-service.maxSubscriptionsPerConnection";
  const host = createFakeHost({
    layers: [
      { scope: "managed", values: new Map([[key, 8]]) },
      { scope: "user", values: new Map([[key, 32]]), path: "/home/u/.config/xeon/settings.json" },
    ],
  });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const result = await connection.request("settings.get", { keys: [key] });
  expect(result.settings).toHaveLength(1);
  expect(result.settings[0]).toMatchObject({
    key,
    value: 8,
    source: { scope: "managed" },
    locked: true,
    shadowed: [{ scope: "user", path: "/home/u/.config/xeon/settings.json" }],
  });
  await connection.close();
});

test("a value that breaks its type or range is skipped, logged without the value, and the next layer decides", async () => {
  const key = "l4.host-service.maxReplayEvents";
  const host = createFakeHost({
    layers: [{ scope: "user", values: new Map([[key, 5]]) }],
  });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const result = await connection.request("settings.get", { keys: [key] });
  expect(result.settings[0]).toMatchObject({ value: 100_000, source: { scope: "default" } });
  const logged = host.fake.log.infos.find((entry) => entry.message === "settings.value_skipped");
  expect(logged?.fields["key"]).toBe(key);
  expect(JSON.stringify(logged?.fields)).not.toContain('"value"');
  await connection.close();
});

test("settings.get with an unknown key is settings.unknownKey", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const error = await wireErrorOf(
    connection.request("settings.get", { keys: ["l1.nope.missing"] }),
  );
  expect(error.code).toBe(3101);
  expect(error.data.details).toEqual({ key: "l1.nope.missing" });
  await connection.close();
});

test("settings.get with a thread that does not exist is thread.notFound", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const threadId = fixedIdFactory(5).next("thr");
  const error = await wireErrorOf(connection.request("settings.get", { threadId }));
  expect(error.code).toBe(3001);
  expect(error.data.details).toEqual({ threadId });
  const known = host.fake.seedThread();
  const ok = await connection.request("settings.get", { threadId: known, keys: [] });
  expect(ok.settings).toEqual([]);
  await connection.close();
});

// ── HOST.2: settings.set, settings.reset, settings.list ────────────────────────────────────────

const REPLAY = "l4.host-service.maxReplayEvents";

test("settings.set checks the value first, writes through the port and answers with the resolved setting", async () => {
  const writes: unknown[] = [];
  const host = createFakeHost({
    overrides: {
      settings: {
        write: (scope, key, value, threadId) => {
          writes.push([scope, key, value, threadId]);
          return Promise.resolve(ok(undefined));
        },
      },
    },
  });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const set = await connection.request("settings.set", { key: REPLAY, value: 5000, scope: "user" });
  expect(writes).toEqual([["user", REPLAY, 5000, undefined]]);
  expect(set.setting.key).toBe(REPLAY);

  const wrongType = await wireErrorOf(
    connection.request("settings.set", { key: REPLAY, value: "x", scope: "user" }),
  );
  expect(wrongType.code).toBe(3102);
  const outOfRange = await wireErrorOf(
    connection.request("settings.set", { key: REPLAY, value: 5, scope: "user" }),
  );
  expect(outOfRange.code).toBe(3102);
  const unknown = await wireErrorOf(
    connection.request("settings.set", { key: "l1.nope.missing", value: 1, scope: "user" }),
  );
  expect(unknown.code).toBe(3101);
  const scope = await wireErrorOf(
    connection.request("settings.set", { key: REPLAY, value: 5000, scope: "project" }),
  );
  expect(scope.code).toBe(3103);
  expect(scope.data.details).toMatchObject({ key: REPLAY, scope: "project" });
  // 검사에서 막힌 요청은 포트에 닿지 않는다
  expect(writes).toHaveLength(1);
  await connection.close();
});

test("settings.set on a key the managed scope fixed is settings.locked", async () => {
  const host = createFakeHost({
    layers: [{ scope: "managed", values: new Map([[REPLAY, 2000]]) }],
  });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const error = await wireErrorOf(
    connection.request("settings.set", { key: REPLAY, value: 5000, scope: "user" }),
  );
  expect(error.code).toBe(3104);
  expect(error.data.details).toMatchObject({ lockedBy: "managed" });
  await connection.close();
});

test("settings.set never puts the value in an error, and a plain string for a secret key is settings.secretValue", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const secretKey = [...host.fake.engine.catalog.values()].find((def) => def.secret === true);
  if (secretKey === undefined) return;
  const error = await wireErrorOf(
    connection.request("settings.set", {
      key: secretKey.key,
      value: "plain-secret-value-123",
      scope: "user",
    }),
  );
  expect(error.code).toBe(3105);
  expect(JSON.stringify(error.data)).not.toContain("plain-secret-value-123");
  await connection.close();
});

test("settings.set maps the port's write failures to wire errors", async () => {
  const cases: readonly [SettingsWriteFailure, number, string | undefined][] = [
    [{ kind: "workspace_required", scope: "project" }, 3103, "workspaceRequired"],
    [{ kind: "untrusted_project", workspace: "/w" }, 3103, "untrustedProject"],
    [{ kind: "managed_read_only" }, 3103, "managedReadOnly"],
    [{ kind: "not_owner", threadId: fixedIdFactory(31).next("thr") }, 3002, undefined],
    [{ kind: "file_invalid", path: "/p" }, 5006, undefined],
    [{ kind: "file_unwritable", path: "/p", code: "EACCES" }, 5006, undefined],
    [{ kind: "disk_full" }, 5004, undefined],
  ];
  await Promise.all(
    cases.map(async ([failure, code, reason]) => {
      const host = createFakeHost({
        overrides: { settings: { write: () => Promise.resolve(err(failure)) } },
      });
      const { connection } = host.connect();
      await connection.request("host.hello", HELLO_PARAMS);
      const error = await wireErrorOf(
        connection.request("settings.set", { key: REPLAY, value: 5000, scope: "user" }),
      );
      expect(error.code).toBe(code);
      if (reason !== undefined) expect(error.data.details).toMatchObject({ reason });
      // 경로와 값은 응답에 싣지 않는다
      expect(JSON.stringify(error.data)).not.toContain("/p");
      await connection.close();
    }),
  );
});

test("settings.set maps a reused session request key to an internal error and logs the Bug message", async () => {
  const host = createFakeHost({
    overrides: {
      settings: {
        write: () => Promise.resolve(err({ kind: "key_reused", requestKey: "evt_1" })),
      },
    },
  });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const error = await wireErrorOf(
    connection.request("settings.set", { key: REPLAY, value: 5000, scope: "user" }),
  );
  expect(error.code).toBe(-32603);
  expect(error.data.kind).toBe("internal");
  const logged = host.fake.log.errors.find((entry) => entry.message === "handler.threw");
  expect(logged?.fields["message"]).toBe(
    "settings.write: the host builds a fresh request key per call",
  );
  await connection.close();
});

test("settings.set without a thread for the session scope is invalid params; for project it needs a workspace", async () => {
  const host = createFakeHost({
    overrides: {
      settings: {
        write: (scope) => Promise.resolve(err({ kind: "thread_required", scope })),
      },
    },
  });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const session = await wireErrorOf(
    connection.request("settings.set", { key: "l1.loop.maxSteps", value: 3, scope: "session" }),
  );
  expect(session.code).toBe(-32602);
  const project = await wireErrorOf(
    connection.request("settings.set", { key: "l1.loop.maxSteps", value: 3, scope: "project" }),
  );
  expect(project.code).toBe(3103);
  expect(project.data.details).toMatchObject({ reason: "workspaceRequired" });
  await connection.close();
});

test("settings.set with a thread prepares the project layers first and rejects an unknown thread", async () => {
  const prepared: string[] = [];
  const host = createFakeHost({
    overrides: {
      settings: {
        prepare: (threadId) => {
          prepared.push(threadId);
          return Promise.resolve();
        },
        write: () => Promise.resolve(ok(undefined)),
      },
    },
  });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const known = host.fake.seedThread();
  await connection.request("settings.set", {
    key: "l1.loop.maxSteps",
    value: 3,
    scope: "session",
    threadId: known,
  });
  expect(prepared).toEqual([known]);
  const unknown = fixedIdFactory(41).next("thr");
  const error = await wireErrorOf(
    connection.request("settings.set", {
      key: REPLAY,
      value: 5000,
      scope: "user",
      threadId: unknown,
    }),
  );
  expect(error.code).toBe(3001);
  await connection.close();
});

test("settings.reset checks key, scope and lock, then clears through the port", async () => {
  const cleared: unknown[] = [];
  const host = createFakeHost({
    layers: [
      { scope: "managed", values: new Map([["l4.host-service.maxSubscriptionsPerConnection", 4]]) },
    ],
    overrides: {
      settings: {
        reset: (scope, key, threadId) => {
          cleared.push([scope, key, threadId]);
          return Promise.resolve(ok(undefined));
        },
      },
    },
  });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const reset = await connection.request("settings.reset", { key: REPLAY, scope: "user" });
  expect(reset.setting.key).toBe(REPLAY);
  expect(cleared).toEqual([["user", REPLAY, undefined]]);
  expect(
    (
      await wireErrorOf(
        connection.request("settings.reset", { key: "l1.nope.missing", scope: "user" }),
      )
    ).code,
  ).toBe(3101);
  expect(
    (await wireErrorOf(connection.request("settings.reset", { key: REPLAY, scope: "project" })))
      .code,
  ).toBe(3103);
  expect(
    (
      await wireErrorOf(
        connection.request("settings.reset", {
          key: "l4.host-service.maxSubscriptionsPerConnection",
          scope: "user",
        }),
      )
    ).code,
  ).toBe(3104);
  expect(cleared).toHaveLength(1);
  await connection.close();
});

test("settings.list returns the catalog as wire definitions, filtered by prefix and sorted by key", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const all = await connection.request("settings.list", {});
  const keys = all.defs.map((def) => def.key);
  expect(keys).toEqual(keys.toSorted());
  expect(keys).toContain(REPLAY);
  const filtered = await connection.request("settings.list", { prefix: "l4.host-service." });
  expect(filtered.defs.length).toBeGreaterThan(0);
  expect(filtered.defs.every((def) => def.key.startsWith("l4.host-service."))).toBe(true);
  const replay = filtered.defs.find((def) => def.key === REPLAY);
  expect(replay?.default).toBe(100_000);
  await connection.close();
});

// ── M2 마감 G1-08, G5-04: 예약 키 숨김과 settings.invalidated ───────────────────────────────

const RESERVED_KEY = "l4.cli.futureSwitch";
const reservedGroup = defineSettings("l4.cli", {
  futureSwitch: {
    type: Type.Boolean(),
    default: false,
    runtimeChange: "live",
    allowedScopes: ["user"],
    stage: "reserved",
    since: "0.1.0",
  },
});

test("settings.list hides reserved keys unless the client asks, and writing one is settings.reserved", async () => {
  const host = createFakeHost({ settingGroups: [reservedGroup] });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const hidden = await connection.request("settings.list", { prefix: "l4.cli." });
  expect(hidden.defs.map((def) => def.key)).toEqual([]);
  const shown = await connection.request("settings.list", {
    prefix: "l4.cli.",
    includeReserved: true,
  });
  expect(shown.defs.map((def) => [def.key, def.stage])).toEqual([[RESERVED_KEY, "reserved"]]);
  const refused = await wireErrorOf(
    connection.request("settings.set", { key: RESERVED_KEY, value: true, scope: "user" }),
  );
  expect(refused.data.kind).toBe("settings.reserved");
  expect(refused.code).toBe(3106);
  await connection.close();
});

test("a settings change reaches every ready connection as settings.invalidated with keys, scopes and thread but no value", async () => {
  const host = createFakeHost();
  const first = host.connect().connection;
  const second = host.connect().connection;
  const notReady = host.connect().connection;
  await first.request("host.hello", HELLO_PARAMS);
  await second.request("host.hello", HELLO_PARAMS);
  const seen: { readonly who: string; readonly params: WireNotificationParams }[] = [];
  first.onNotification("settings.invalidated", (params) => {
    seen.push({ who: "first", params });
  });
  second.onNotification("settings.invalidated", (params) => {
    seen.push({ who: "second", params });
  });
  notReady.onNotification("settings.invalidated", (params) => {
    seen.push({ who: "notReady", params });
  });
  const thread = host.fake.seedThread();
  host.fake.emitSettingsChange({ keys: [REPLAY], scopes: ["session"], threadId: thread });
  host.fake.emitSettingsChange({ keys: [], scopes: ["project", "local"], threadId: null });
  await settleUntil(() => seen.length >= 4);
  await flushMicrotasks();
  expect(seen).toEqual([
    { who: "first", params: { keys: [REPLAY], scopes: ["session"], threadId: thread } },
    { who: "second", params: { keys: [REPLAY], scopes: ["session"], threadId: thread } },
    { who: "first", params: { keys: [], scopes: ["project", "local"], threadId: null } },
    { who: "second", params: { keys: [], scopes: ["project", "local"], threadId: null } },
  ]);
  await first.close();
  await second.close();
  await notReady.close();
});

test("host.hello lists settings.invalidated among the notifications the host implements", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  expect(hello.features.map((feature) => feature.name)).toContain("settings.invalidated");
  await connection.close();
});

// HS-46 [결정: M2 Mac 실기]: 모르는 모델 id는 저장하기 전에 거절한다. 같은 provider의 모델을 보여 준다.
test("settings.set refuses a model id the registry does not have, names it and the provider's models, and writes nothing", async () => {
  const writes: unknown[] = [];
  const host = createFakeHost({
    overrides: {
      settings: {
        write: (scope, key, value) => {
          writes.push([scope, key, value]);
          return Promise.resolve(ok(undefined));
        },
      },
    },
  });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const wrong = await wireErrorOf(
    connection.request("settings.set", {
      key: "l1.models.default",
      value: "tape/tape-1.5:high",
      scope: "user",
    }),
  );
  expect(wrong.code).toBe(3102);
  expect(wrong.data.details).toEqual({
    key: "l1.models.default",
    issues: [{ path: "value", message: "알 수 없는 모델 tape/tape-1.5 (tape의 모델: tape-1)" }],
  });
  const noProvider = await wireErrorOf(
    connection.request("settings.set", {
      key: "l1.models.routing.review",
      value: "nowhere/m",
      scope: "user",
    }),
  );
  expect(noProvider.data.details).toEqual({
    key: "l1.models.routing.review",
    issues: [
      {
        path: "value",
        message: "알 수 없는 모델 nowhere/m (provider nowhere에 등록된 모델이 없다)",
      },
    ],
  });
  expect(writes).toEqual([]);
  // 등록된 모델(추론 수준 접미 포함)과 지우는 값(null)은 통과한다
  await connection.request("settings.set", {
    key: "l1.models.default",
    value: "tape/tape-1:high",
    scope: "user",
  });
  await connection.request("settings.set", {
    key: "l1.models.default",
    value: null,
    scope: "user",
  });
  expect(writes).toEqual([
    ["user", "l1.models.default", "tape/tape-1:high"],
    ["user", "l1.models.default", null],
  ]);
  await connection.close();
});

test("settings.set tells the secret service about provider links only for the user scope of l1.models.providers", async () => {
  const host = createFakeHost({
    overrides: { settings: { write: () => Promise.resolve(ok(undefined)) } },
  });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const providers = [{ id: "tape", enabled: true, apiKeyRef: "secret://tape-key", baseUrl: null }];
  await connection.request("settings.set", {
    key: "l1.models.providers",
    value: providers,
    scope: "user",
  });
  expect(host.fake.secrets.linkCalls()).toBe(1);
  // 다른 키, 다른 범위는 연결이 아니다: 프로젝트 파일이 비밀의 사용 정책을 넓히지 못한다
  await connection.request("settings.set", {
    key: "l1.models.default",
    value: "tape/tape-1",
    scope: "user",
  });
  await connection.request("settings.set", {
    key: "l1.models.providers",
    value: providers,
    scope: "project",
  });
  expect(host.fake.secrets.linkCalls()).toBe(1);
  await connection.close();
});
