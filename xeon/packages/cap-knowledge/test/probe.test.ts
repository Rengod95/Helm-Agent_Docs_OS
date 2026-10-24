import { afterEach, describe, expect, test } from "bun:test";
import { probeFts } from "../src/search/probe.ts";
import { asHost, rejection } from "./support/helpers.ts";
import { closeWorlds, createWorld, putSkill, USER_SKILLS } from "./support/world.ts";

afterEach(closeWorlds);

describe("fts probe", () => {
  test("trigram needs FTS5 and SQLite 3.34 or newer", () => {
    expect(probeFts({ fts5: true, sqliteVersion: "3.53.4" })).toEqual({ available: true });
    expect(probeFts({ fts5: true, sqliteVersion: "3.34.0" })).toEqual({ available: true });
    expect(probeFts({ fts5: true, sqliteVersion: "4.0.0" })).toEqual({ available: true });
    const old = probeFts({ fts5: true, sqliteVersion: "3.33.9" });
    expect(old).toMatchObject({ available: false });
    expect(old.available ? "" : old.reason).toContain("3.34.0");
    const missing = probeFts({ fts5: false, sqliteVersion: "3.53.4" });
    expect(missing).toMatchObject({ available: false });
    expect(missing.available ? "" : missing.reason).toContain("FTS5");
    expect(probeFts({ fts5: true, sqliteVersion: "unknown" })).toMatchObject({ available: false });
  });
});

describe("probe failure", () => {
  test("probe failure disables session search", async () => {
    const world = await createWorld({
      sessions: true,
      capabilities: { fts5: false, sqliteVersion: "3.53.4" },
    });
    expect(world.deps.searchAvailability).toMatchObject({
      sessions: false,
      docs: false,
      list: true,
    });
    expect(world.deps.searchAvailability.reason).toContain("FTS5");
    // 시작은 성공했고 색인 소비자는 시작하지 않았다
    expect(world.runtime.indexer()).toBeUndefined();
    const kit = world.sessions;
    const threadId = kit?.newThread({ title: "Still listed" });
    if (kit !== undefined && threadId !== undefined) kit.say(threadId, "user", "searchable words");
    const only = await rejection(
      world.runtime.searchApi.query({ query: "searchable", kinds: ["session"] }, asHost()),
    );
    expect(only.data.code).toBe("unavailable");
    expect(only.data.detail).toMatchObject({ reason: "fts5_unavailable" });
    expect(
      (await rejection(world.runtime.searchApi.read({ sessionId: "x" }, asHost()))).data.detail,
    ).toMatchObject({
      reason: "fts5_unavailable",
    });
    // 세션 목록은 투영만 쓰므로 계속 동작한다
    const list = await world.runtime.searchApi.list({}, asHost());
    expect(list.sessions.map((session) => session.title)).toEqual(["Still listed"]);
    // FTS 표가 없고 투영 버전도 FTS 없는 쪽이다
    const tables = world.store.root.read((tx) =>
      tx.all("SELECT name FROM sqlite_master WHERE name LIKE 'cap_knowledge_%fts%'"),
    );
    expect(tables.ok && tables.value.length === 0).toBe(true);
  });

  test("the default query reports the degraded kind and skills fall back to like", async () => {
    const world = await createWorld({
      sessions: true,
      capabilities: { fts5: true, sqliteVersion: "3.30.0" },
    });
    putSkill(world.fs, USER_SKILLS, "deploy-guide", {
      description: "How to deploy the service.",
      body: "Run the deploy script, then verify the health endpoint.",
    });
    await world.runtime.skillsApi.reindex({});
    await world.runtime.memoryApi.add(
      { store: "user", text: "Always verify the health endpoint." },
      asHost(),
    );
    const found = await world.runtime.searchApi.query({ query: "health endpoint" }, asHost());
    expect(found.degraded).toEqual(["session"]);
    // FTS 표가 없으므로 경로는 like다
    expect(found.path).toBe("like");
    expect(found.hits.map((hit) => hit.kind)).toEqual(["skill", "memory"]);
    expect(found.hits[0]?.ref).toBe("deploy-guide");
    expect(found.hits[0]?.snippet).toContain("health endpoint");
    expect(found.hits[0]?.score).toBeUndefined();
  });

  test("without a session service nothing is indexed and the list is unavailable", async () => {
    const world = await createWorld();
    expect(world.deps.searchAvailability).toMatchObject({
      sessions: false,
      docs: false,
      list: false,
      reason: "no session service",
    });
    const list = await rejection(world.runtime.searchApi.list({}, asHost()));
    expect(list.data.code).toBe("unavailable");
    const memory = await world.runtime.memoryApi.add(
      { store: "user", text: "works without fts" },
      asHost(),
    );
    expect(memory.outcome.status).toBe("applied");
    const found = await world.runtime.searchApi.query(
      { query: "without", kinds: ["memory"] },
      asHost(),
    );
    expect(found.hits).toHaveLength(1);
  });
});
