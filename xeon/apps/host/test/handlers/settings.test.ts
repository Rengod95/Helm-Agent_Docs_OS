import { expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import { WireError } from "@xeon/contracts/wire";
import type { SettingsWriteFailure } from "../../src/types.ts";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";
import { fixedIdFactory } from "@xeon/ext-host/testing";

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
