import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import { validateManifest, type PluginCard } from "@fresnel/contracts/extensions";
import { WireError, type PluginListFilter } from "@fresnel/contracts/wire";
import { buildPluginCard } from "../../src/assembly/plugins/card.ts";
import type { PluginPort } from "../../src/handlers/m5/plugins.ts";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M5c §3.4: `plugin.list`, `plugin.get`은 포트가 돌려준 값을 그대로 옮기고, 없는 이름은 기존 `extension.notFound`다.
// 나머지 `plugin.*`은 아직 `notImplemented`이므로 `host.hello`의 features에 이 두 개만 오른다.

function cardOf(name: string): PluginCard {
  const checked = validateManifest({
    schemaVersion: 2,
    name,
    version: "1.0.0",
    purpose: "Says hello",
    plugins: [{ layer: "plugin", hooks: [] }],
  });
  if (checked.manifest === undefined) throw new Error("the test manifest is invalid");
  return buildPluginCard({
    folder: {
      name,
      manifest: checked.manifest,
      materials: { instructions: [], skills: [], mcpServers: [], agents: [], commands: [] },
    },
    origin: { kind: "user" },
    review: { state: "none", currentHash: null, pendingItemId: null, approvedAt: null },
    usedBy: [],
    health: { state: "idle", lastActiveAt: null, lastError: null },
  });
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  try {
    await call;
  } catch (caught) {
    if (caught instanceof WireError) return caught;
    throw caught;
  }
  throw new Error("expected the request to fail with a WireError");
}

test("plugin.list passes the filter to the port and returns its cards unchanged", async () => {
  const seen: PluginListFilter[] = [];
  const card = cardOf("greeter");
  const port: Partial<PluginPort> = {
    list: (filter) => {
      seen.push(filter);
      return Promise.resolve(ok({ plugins: [card] }));
    },
  };
  const host = createFakeHost({ overrides: { plugins: port } });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);

  expect(await connection.request("plugin.list", {})).toEqual({ plugins: [card] });
  expect(
    await connection.request("plugin.list", { filter: { profileId: "work", origin: "user" } }),
  ).toEqual({ plugins: [card] });
  expect(seen).toEqual([{}, { profileId: "work", origin: "user" }]);
  await connection.close();
});

test("plugin.get returns the card with the empty review and source fields", async () => {
  const card = cardOf("greeter");
  const port: Partial<PluginPort> = {
    get: () =>
      Promise.resolve(
        ok({
          card,
          versions: [],
          source: { path: "/config/plugins/greeter", matchesReviewed: false },
          entries: [],
          settingsDefs: [],
        }),
      ),
  };
  const host = createFakeHost({ overrides: { plugins: port } });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);

  expect(await connection.request("plugin.get", { name: "greeter" })).toEqual({
    card,
    versions: [],
    source: { path: "/config/plugins/greeter", matchesReviewed: false },
    entries: [],
    settingsDefs: [],
  });
  await connection.close();
});

test("plugin.get of a name that is not installed answers extension.notFound with the name", async () => {
  const port: Partial<PluginPort> = {
    get: (name) => Promise.resolve(err({ kind: "unknown_plugin", name })),
  };
  const host = createFakeHost({ overrides: { plugins: port } });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);

  const error = await wireErrorOf(connection.request("plugin.get", { name: "missing" }));
  expect(error.data).toMatchObject({ kind: "extension.notFound", details: { name: "missing" } });
  await connection.close();
});

test("a profile list failure under plugin.list is the profile error, not a silent empty list", async () => {
  const port: Partial<PluginPort> = {
    list: () =>
      Promise.resolve(
        err({
          kind: "profiles",
          failure: { kind: "corrupt", path: "/config/profiles.json", reason: "not json" },
        }),
      ),
  };
  const host = createFakeHost({ overrides: { plugins: port } });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);

  const error = await wireErrorOf(connection.request("plugin.list", {}));
  expect(error.data.kind).toBe("profile.fileCorrupt");
  await connection.close();
});

test("host.hello lists plugin.list, plugin.get and plugin.scan as implemented and the other plugin methods as not", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  const featured = new Set(hello.features.map((feature) => feature.name));
  expect(featured.has("plugin.list")).toBe(true);
  expect(featured.has("plugin.get")).toBe(true);
  expect(featured.has("plugin.invocables")).toBe(false);
  // plugin.scan은 M5c §3.4 읽기 처리기로 구현됐다(검토 항목은 만들지 않는다)
  expect(featured.has("plugin.scan")).toBe(true);
  await connection.close();
});
