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

test("host.hello lists the implemented plugin methods, including plugin.draft.fromInstruction (M5c §4.10)", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  const featured = new Set(hello.features.map((feature) => feature.name));
  expect(featured.has("plugin.list")).toBe(true);
  expect(featured.has("plugin.get")).toBe(true);
  // plugin.invocables는 M5c §3.4 읽기 처리기로 구현됐다(§4.3.2)
  expect(featured.has("plugin.invocables")).toBe(true);
  // plugin.scan은 M5c §3.4 읽기 처리기로 구현됐다(검토 항목은 만들지 않는다)
  expect(featured.has("plugin.scan")).toBe(true);
  // 한 줄 지침은 `notImplemented`가 아니다(§4.10)
  expect(featured.has("plugin.draft.fromInstruction")).toBe(true);
  await connection.close();
});

test("plugin.draft.fromInstruction passes the parameters to the port and returns its two ids", async () => {
  const seen: unknown[] = [];
  const port: Partial<PluginPort> = {
    draftFromInstruction: (params) => {
      seen.push(params);
      return Promise.resolve(ok({ draftId: "drf_1", itemId: "rvw_1" }));
    },
  };
  const host = createFakeHost({ overrides: { plugins: port } });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);

  expect(
    await connection.request("plugin.draft.fromInstruction", { text: "Answer briefly." }),
  ).toEqual({
    draftId: "drf_1",
    itemId: "rvw_1",
  });
  expect(
    await connection.request("plugin.draft.fromInstruction", {
      text: "Answer briefly.",
      name: "brief",
      profileId: "work",
    }),
  ).toEqual({ draftId: "drf_1", itemId: "rvw_1" });
  expect(seen).toEqual([
    { text: "Answer briefly." },
    { text: "Answer briefly.", name: "brief", profileId: "work" },
  ]);
  await connection.close();
});

test("a same-name plugin folder that cannot be replaced answers plugin.exists (3624) with the name", async () => {
  const port: Partial<PluginPort> = {
    draftFromInstruction: () => Promise.resolve(err({ kind: "exists", name: "instr-3f9a1c" })),
  };
  const host = createFakeHost({ overrides: { plugins: port } });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);

  const error = await wireErrorOf(
    connection.request("plugin.draft.fromInstruction", { text: "Answer briefly." }),
  );
  expect(error.code).toBe(3624);
  expect(error.data).toMatchObject({ kind: "plugin.exists", details: { name: "instr-3f9a1c" } });
  await connection.close();
});

test("an instruction the port refuses as invalid answers plugin.invalid (3621) with the issue codes", async () => {
  const port: Partial<PluginPort> = {
    draftFromInstruction: () =>
      Promise.resolve(
        err({
          kind: "draft_invalid",
          issues: [{ code: "text_blank", severity: "error", path: "/text", message: "blank" }],
        }),
      ),
  };
  const host = createFakeHost({ overrides: { plugins: port } });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);

  const error = await wireErrorOf(
    connection.request("plugin.draft.fromInstruction", { text: "   " }),
  );
  expect(error.code).toBe(3621);
  expect(error.data).toMatchObject({
    kind: "plugin.invalid",
    details: { issues: [{ code: "text_blank", severity: "error" }] },
  });
  await connection.close();
});

test("the wire rejects an empty or over-2000-character instruction before the port is called (jsonrpc.invalidParams)", async () => {
  let calls = 0;
  const port: Partial<PluginPort> = {
    draftFromInstruction: () => {
      calls += 1;
      return Promise.resolve(err({ kind: "exists", name: "x" }));
    },
  };
  const host = createFakeHost({ overrides: { plugins: port } });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);

  const empty = await wireErrorOf(connection.request("plugin.draft.fromInstruction", { text: "" }));
  expect(empty.data.kind).toBe("jsonrpc.invalidParams");
  const long = await wireErrorOf(
    connection.request("plugin.draft.fromInstruction", { text: "a".repeat(2001) }),
  );
  expect(long.data.kind).toBe("jsonrpc.invalidParams");
  expect(calls).toBe(0);
  await connection.close();
});
