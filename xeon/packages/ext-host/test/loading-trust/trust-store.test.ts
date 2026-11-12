import { expect, test } from "bun:test";
import { trustOptions } from "../../src/loading-trust/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import {
  entriesOf,
  entryPaths,
  FIXED_NOW,
  memoryFs,
  memoryTrustBackend,
  storeOf,
} from "./support/trust-fakes.ts";

const DECIDED_AT = new Date(FIXED_NOW).toISOString();

function file(entries: Record<string, { verdict: string; via?: string }>): string {
  const full = Object.fromEntries(
    Object.entries(entries).map(([path, entry]) => [
      path,
      { verdict: entry.verdict, decidedAt: "2026-01-01T00:00:00.000Z", via: entry.via ?? "prompt" },
    ]),
  );
  return JSON.stringify({ version: 1, entries: full });
}

test("corrupt store treated as untrusted and never overwritten", async () => {
  await eachInOrder(
    ["{ not json", "[]", JSON.stringify({ version: 1, entries: { "/a": 1 } })],
    async (text) => {
      const backend = memoryTrustBackend(text);
      const store = storeOf(backend);
      expect((await store.lookup("/a/b")).kind).toBe("corrupt");
      const written = await store.setMany([{ path: "/a", verdict: "allow", via: "prompt" }]);
      expect(written).toMatchObject({ ok: false, error: { kind: "corrupt" } });
      // 파일 바이트가 그대로다
      expect(backend.text()).toBe(text);
      return "continue";
    },
  );
  // 읽기 실패도 손상으로 본다
  const unreadable = memoryTrustBackend(file({ "/a": { verdict: "allow" } }));
  unreadable.failReads("permission denied");
  expect(await storeOf(unreadable).lookup("/a")).toEqual({
    kind: "corrupt",
    reason: "permission denied",
  });
});

test("a missing file is an empty store", async () => {
  const backend = memoryTrustBackend(null);
  expect(await storeOf(backend).lookup("/a")).toEqual({ kind: "none" });
  const written = await storeOf(backend).setMany([
    { path: "/a", verdict: "allow", via: "command" },
  ]);
  expect(written.ok).toBe(true);
  expect(entriesOf(backend.text())).toEqual({
    version: 1,
    entries: { "/a": { verdict: "allow", decidedAt: DECIDED_AT, via: "command" } },
  });
});

test("nearest ancestor wins", async () => {
  const backend = memoryTrustBackend(
    file({ "/a": { verdict: "allow" }, "/a/b": { verdict: "deny" } }),
  );
  const store = storeOf(backend);
  expect(await store.lookup("/a/b/c")).toEqual({ kind: "found", verdict: "deny", path: "/a/b" });
  expect(await store.lookup("/a/x")).toEqual({ kind: "found", verdict: "allow", path: "/a" });
  expect(await store.lookup("/a")).toEqual({ kind: "found", verdict: "allow", path: "/a" });
  expect(await store.lookup("/z")).toEqual({ kind: "none" });
});

test("pi v0 format migrates", async () => {
  const backend = memoryTrustBackend(`﻿${JSON.stringify({ "/a": true, "/b": false, "/c": null })}`);
  const store = storeOf(backend);
  expect(await store.lookup("/a/x")).toEqual({ kind: "found", verdict: "allow", path: "/a" });
  expect(await store.lookup("/b")).toEqual({ kind: "found", verdict: "deny", path: "/b" });
  expect(await store.lookup("/c")).toEqual({ kind: "none" });
  // 읽기는 파일을 바꾸지 않는다. 다음 쓰기에서 버전 1로 바꾼다
  expect(backend.calls.updates).toBe(0);
  await store.setMany([{ path: "/d", verdict: "allow", via: "prompt" }]);
  const written = entriesOf(backend.text());
  expect(written).toEqual({
    version: 1,
    entries: {
      "/a": { verdict: "allow", decidedAt: DECIDED_AT, via: "prompt" },
      "/b": { verdict: "deny", decidedAt: DECIDED_AT, via: "prompt" },
      "/d": { verdict: "allow", decidedAt: DECIDED_AT, via: "prompt" },
    },
  });
  // 값이 잘못된 pi 파일은 손상이다
  const bad = memoryTrustBackend(JSON.stringify({ "/a": "yes" }));
  expect((await storeOf(bad).lookup("/a")).kind).toBe("corrupt");
});

test("parent choice updates save the parent and drop the project entry", async () => {
  const backend = memoryTrustBackend(
    file({ "/work/app": { verdict: "deny" }, "/other": { verdict: "allow" } }),
  );
  const store = storeOf(backend);
  const parent = trustOptions("/work/app", "/work").find(
    (option) => option.choice.kind === "parent",
  );
  expect(parent?.savedPath).toBe("/work");
  await store.setMany(parent?.updates ?? []);
  expect(entryPaths(backend.text())).toEqual(["/other", "/work"]);
  expect(await store.lookup("/work/app")).toEqual({
    kind: "found",
    verdict: "allow",
    path: "/work",
  });
});

test("trust options: five choices, the parent one only when a parent exists", () => {
  const withParent = trustOptions("/work/app", "/work");
  expect(withParent.map((option) => `${option.choice.kind}:${option.choice.verdict}`)).toEqual([
    "folder:allow",
    "parent:allow",
    "session:allow",
    "folder:deny",
    "session:deny",
  ]);
  expect(withParent.map((option) => option.savedPath)).toEqual([
    "/work/app",
    "/work",
    null,
    "/work/app",
    null,
  ]);
  expect(
    withParent
      .filter((option) => option.choice.kind === "session")
      .every((o) => o.updates.length === 0),
  ).toBe(true);
  expect(trustOptions("/", null).map((option) => option.choice.kind)).toEqual([
    "folder",
    "session",
    "folder",
    "session",
  ]);
});

test("paths are normalized for lookup and writing, keys are sorted", async () => {
  const backend = memoryTrustBackend(null);
  const aliases: Record<string, string> = { "/link/proj": "/real/proj", "/link/b": "/real/b" };
  const fs = memoryFs([], aliases);
  const store = storeOf(backend, fs);
  await store.setMany([
    { path: "/link/proj", verdict: "allow", via: "prompt" },
    { path: "/link/b", verdict: "deny", via: "point" },
    { path: "/a", verdict: "allow", via: "prompt" },
  ]);
  const text = backend.text() ?? "";
  expect(entryPaths(text)).toEqual(["/a", "/real/b", "/real/proj"]);
  expect(text.endsWith("\n")).toBe(true);
  expect(await store.lookup("/link/proj")).toEqual({
    kind: "found",
    verdict: "allow",
    path: "/real/proj",
  });
});

test("list reads the stored decisions in file order without writing, and omits savedAt for the old format", async () => {
  const stored = memoryTrustBackend(
    file({ "/work/app": { verdict: "allow" }, "/work/old": { verdict: "deny" } }),
  );
  const before = stored.text();
  expect(await storeOf(stored).list()).toEqual({
    ok: true,
    value: [
      { path: "/work/app", verdict: "allow", savedAt: "2026-01-01T00:00:00.000Z" },
      { path: "/work/old", verdict: "deny", savedAt: "2026-01-01T00:00:00.000Z" },
    ],
  });
  expect(stored.text()).toBe(before);
  expect(stored.calls.updates).toBe(0);

  // 파일이 없으면 빈 목록이다
  expect(await storeOf(memoryTrustBackend(null)).list()).toEqual({ ok: true, value: [] });

  // 버전 없는 옛 형식은 저장 시각 없이 싣는다
  const old = memoryTrustBackend(JSON.stringify({ "/a": true, "/b": false, "/c": null }));
  expect(await storeOf(old).list()).toEqual({
    ok: true,
    value: [
      { path: "/a", verdict: "allow" },
      { path: "/b", verdict: "deny" },
    ],
  });

  // 손상은 corrupt, 읽기 실패는 io다. 둘 다 파일을 바꾸지 않는다
  const corrupt = memoryTrustBackend("{ not json");
  expect(await storeOf(corrupt).list()).toEqual({
    ok: false,
    error: { kind: "corrupt", reason: "not valid JSON" },
  });
  const unreadable = memoryTrustBackend(file({ "/a": { verdict: "allow" } }));
  unreadable.failReads("permission denied");
  expect(await storeOf(unreadable).list()).toEqual({
    ok: false,
    error: { kind: "io", cause: "permission denied" },
  });
});

// 지우기(`verdict: null`): 그 항목 하나만 빠지고, 폴더는 상위 폴더 결정이나 미결정으로 돌아간다
test("a null verdict removes only that entry, and the folder falls back to its parent or to undecided", async () => {
  const backend = memoryTrustBackend(
    file({
      "/work": { verdict: "allow" },
      "/work/app": { verdict: "deny" },
      "/other": { verdict: "allow" },
    }),
  );
  const store = storeOf(backend);
  expect(await store.lookup("/work/app")).toEqual({
    kind: "found",
    verdict: "deny",
    path: "/work/app",
  });

  const removed = await store.setMany([{ path: "/work/app", verdict: null, via: "prompt" }]);
  expect(removed.ok).toBe(true);
  expect(entryPaths(backend.text())).toEqual(["/other", "/work"]);
  expect(await store.lookup("/work/app")).toEqual({
    kind: "found",
    verdict: "allow",
    path: "/work",
  });

  await store.setMany([{ path: "/other", verdict: null, via: "prompt" }]);
  expect(await store.lookup("/other")).toEqual({ kind: "none" });
  expect(entryPaths(backend.text())).toEqual(["/work"]);

  // 없는 항목을 지워도 남은 항목은 그대로다
  const before = entriesOf(backend.text());
  expect((await store.setMany([{ path: "/missing", verdict: null, via: "prompt" }])).ok).toBe(true);
  expect(entriesOf(backend.text())).toEqual(before);
});

test("a backend failure is an io error and the store stays usable", async () => {
  const backend = memoryTrustBackend(file({ "/a": { verdict: "allow" } }));
  const store = storeOf(backend);
  backend.failNextUpdate("disk full");
  const failed = await store.setMany([{ path: "/b", verdict: "deny", via: "prompt" }]);
  expect(failed).toMatchObject({ ok: false, error: { kind: "io" } });
  expect(await store.lookup("/b")).toEqual({ kind: "none" });
  const again = await store.setMany([{ path: "/b", verdict: "deny", via: "prompt" }]);
  expect(again.ok).toBe(true);
  expect(await store.lookup("/b")).toEqual({ kind: "found", verdict: "deny", path: "/b" });
});
