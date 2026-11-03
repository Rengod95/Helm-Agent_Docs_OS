import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bug } from "@fresnel/contracts";
import type { SessionSettingsStore } from "@fresnel/contracts/records";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { buildEngineCatalog } from "../../src/assembly/catalog.ts";
import { createSettingsEngine, type SettingsEngine } from "../../src/assembly/settings-engine.ts";

const scratch = mkdtempSync(join(tmpdir(), "xh-set-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function engineOver(): SettingsEngine {
  const built = buildEngineCatalog();
  if (!built.ok) throw new Error("the core catalog must build");
  return createSettingsEngine(built.catalog);
}

function fileWith(name: string, content: string): string {
  const path = join(scratch, name);
  writeFileSync(path, content);
  return path;
}

test("a missing file is an empty user scope with no diagnostic", async () => {
  const settings = engineOver();
  await settings.loadUserFile(join(scratch, "missing.json"));
  expect(settings.diagnostics).toEqual([]);
  expect(settings.value("l1.loop.maxSteps")).toBe(0);
  expect(settings.layers(undefined)).toHaveLength(1);
});

test("a valid file sets values, the path shows up in the layer and raw() strips the prefix", async () => {
  const settings = engineOver();
  const path = fileWith(
    "valid.json",
    JSON.stringify({
      "l1.loop.maxSteps": 12,
      "l0.store.heartbeatMs": 4000,
      "l0.store.requireFts5": true,
      "l1.persistence.maxResumeAttempts": 5,
    }),
  );
  await settings.loadUserFile(path);
  expect(settings.value("l1.loop.maxSteps")).toBe(12);
  expect(settings.layers(undefined)[0]).toMatchObject({ scope: "user", path });
  expect(settings.raw("l0.store.")).toEqual({ heartbeatMs: 4000, requireFts5: true });
  expect(settings.raw("l1.persistence.")).toEqual({ maxResumeAttempts: 5 });
  expect(settings.raw("l9.nothing.")).toEqual({});
});

test("a value that breaks its range is skipped and the default shows through", async () => {
  const settings = engineOver();
  await settings.loadUserFile(fileWith("range.json", JSON.stringify({ "l1.loop.maxSteps": -4 })));
  expect(settings.value("l1.loop.maxSteps")).toBe(0);
});

test("a file that cannot be used leaves an empty scope and one diagnostic without its text", async () => {
  const broken = engineOver();
  await broken.loadUserFile(fileWith("broken.json", "{ nope"));
  expect(broken.diagnostics).toEqual(["settings.user_invalid_json"]);
  const list = engineOver();
  await list.loadUserFile(fileWith("list.json", "[1,2]"));
  expect(list.diagnostics).toEqual(["settings.user_not_object"]);
  const directory = engineOver();
  await directory.loadUserFile(scratch);
  expect(directory.diagnostics[0]).toContain("settings.user_unreadable");
});

test("unknown keys have no effective value", () => {
  expect(engineOver().value("l1.nope.missing")).toBeUndefined();
});

test("a stored key the catalog no longer has loads without failing and is kept, not read", async () => {
  const built = buildEngineCatalog();
  if (!built.ok) throw new Error("the core catalog must build");
  const settings = createSettingsEngine(built.catalog);
  await settings.loadUserFile(
    fileWith(
      "retired-key.json",
      JSON.stringify({
        "l2.web.search.searxng.url": "http://127.0.0.1:8080",
        "l1.loop.maxSteps": 12,
      }),
    ),
  );
  expect(built.catalog.has("l2.web.search.searxng.url")).toBe(false);
  expect(settings.value("l2.web.search.searxng.url")).toBeUndefined();
  expect(settings.value("l1.loop.maxSteps")).toBe(12);
  // 파일에는 그대로 보존된다. 엔진은 카탈로그에 없는 키를 진단으로 올리지 않는다(경고는 settings.readFile의 unknownKeys가 낸다)
  expect(settings.raw("l2.web.search.")).toEqual({ "searxng.url": "http://127.0.0.1:8080" });
  expect(settings.diagnostics).toEqual([]);
});

test("the session scope is added for a thread once the session store is bound", () => {
  const settings = engineOver();
  const threadId = fixedIdFactory().next("thr");
  const store: SessionSettingsStore = {
    layer: () => ({ scope: "launch", values: new Map([["l1.loop.maxSteps", 3]]) }),
    set: () => {
      throw new Bug("not used");
    },
    reset: () => {
      throw new Bug("not used");
    },
  };
  expect(settings.layers(threadId)).toHaveLength(1);
  settings.bindSession(store);
  expect(settings.layers(undefined)).toHaveLength(1);
  expect(settings.layers(threadId).map((layer) => layer.scope)).toEqual(["user", "launch"]);
  expect(settings.value("l1.loop.maxSteps", threadId)).toBe(3);
  expect(settings.value("l1.loop.maxSteps")).toBe(0);
});

test("a not_implemented Bug from the session store is raised, not skipped with a diagnostic", () => {
  const settings = engineOver();
  const threadId = fixedIdFactory().next("thr");
  settings.bindSession({
    layer: () => {
      throw new Bug("session.not_implemented: sessionSettings.layer");
    },
    set: () => {
      throw new Bug("not used");
    },
    reset: () => {
      throw new Bug("not used");
    },
  });
  expect(() => settings.layers(threadId)).toThrow("session.not_implemented");
  expect(settings.diagnostics).toEqual([]);
});

test("any other failure of the session store is not hidden", () => {
  const settings = engineOver();
  const threadId = fixedIdFactory().next("thr");
  settings.bindSession({
    layer: () => {
      throw new Bug("store.read_failed: busy");
    },
    set: () => {
      throw new Bug("not used");
    },
    reset: () => {
      throw new Bug("not used");
    },
  });
  expect(() => settings.layers(threadId)).toThrow("store.read_failed");
});
