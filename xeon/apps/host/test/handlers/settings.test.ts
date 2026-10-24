import { expect, test } from "bun:test";
import { WireError } from "@xeon/contracts/wire";
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
