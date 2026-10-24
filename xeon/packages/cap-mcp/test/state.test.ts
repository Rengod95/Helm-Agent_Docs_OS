import { afterEach, describe, expect, test } from "bun:test";
import { createStateStore, MCP_STORE_OWNER } from "../src/client/state-store.ts";
import { releaseStores, openMcpStore } from "./support/store.ts";
import { fixedClock } from "./support/time.ts";
import { buildWorld, maskerFor, startWorld } from "./support/world.ts";

afterEach(releaseStores);

describe("cap_mcp_servers", () => {
  test("persists server status", async () => {
    const clock = fixedClock();
    const store = await openMcpStore(clock);
    const world = buildWorld({
      servers: {
        good: { stub: { era: "modern", tools: [{ name: "a" }] } },
        bad: { stub: { era: "modern", tools: [] } },
      },
      user: { "reconnect.maxAttempts": 1 },
      overrides: { store: store.service },
    });
    world.factory.failNext(1, "refused with SUPERSECRET");
    // good가 먼저 열리도록 bad만 실패시키기 위해 열린 순서를 맞춘다: 서버 id 순으로 정의가 풀린다
    await startWorld(world);
    await world.runtime.applyBoundary();

    const rows = store.root.read((tx) =>
      tx.all(
        "SELECT server_id, source, state, protocol_version, last_error_code, tools_fingerprint FROM cap_mcp_servers ORDER BY server_id",
      ),
    );
    expect(rows.ok).toBe(true);
    if (!rows.ok) return;
    const byId = Object.fromEntries(rows.value.map((row) => [row["server_id"], row]));
    const stateOf = (id: string): unknown => byId[id]?.["state"];
    const states = [stateOf("bad"), stateOf("good")].toSorted((a, b) =>
      String(a).localeCompare(String(b)),
    );
    expect(states).toEqual(["connected", "failed"]);
    const connected = rows.value.find((row) => row["state"] === "connected");
    expect(connected?.["protocol_version"]).toBe("2026-07-28");
    expect(String(connected?.["tools_fingerprint"])).toMatch(/^sha256:[0-9a-f]{64}$/);
    const failed = rows.value.find((row) => row["state"] === "failed");
    expect(failed?.["last_error_code"]).toBe("spawn_failed");
    await world.runtime.shutdown();
  });

  test("survives a restart and masks the error message", async () => {
    const clock = fixedClock();
    const store = await openMcpStore(clock);
    const needle = "mask-this-aaaaaaaa";
    const writer = createStateStore({ store: store.service, clock, masker: maskerFor([needle]) });
    expect(writer.migrate().ok).toBe(true);
    expect(
      writer.save({
        serverId: "stub",
        source: "settings:user",
        state: "failed",
        lastError: { code: "spawn_failed", message: `boom ${needle}`, at: 42 },
        lastConnectedAt: 7,
        protocolVersion: undefined,
        toolsFingerprint: undefined,
      }).ok,
    ).toBe(true);

    // 재시작: 같은 저장소를 새 상태 저장소 핸들이 읽는다. 마이그레이션은 한 번 더 불러도 된다
    const reader = createStateStore({ store: store.service, clock, masker: maskerFor([]) });
    expect(reader.migrate().ok).toBe(true);
    const loaded = reader.load("stub");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value).toMatchObject({
      state: "failed",
      lastError: { code: "spawn_failed", message: "boom [REDACTED]", at: 42 },
      lastConnectedAt: 7,
    });
    expect(reader.load("nope")).toEqual({ ok: true, value: undefined });
    expect(reader.remove("stub").ok).toBe(true);
    expect(reader.load("stub")).toEqual({ ok: true, value: undefined });
    expect(MCP_STORE_OWNER).toBe("cap.mcp");
  });

  test("removed servers lose their row at the boundary", async () => {
    const store = await openMcpStore(fixedClock());
    const world = buildWorld({
      servers: { stub: { stub: { era: "modern", tools: [{ name: "a" }] } } },
      overrides: { store: store.service },
    });
    await startWorld(world);
    expect((await store.rowCounts())["cap_mcp_servers"]).toBe(1);
    world.settings.set([]);
    await world.runtime.load(world.controller.signal);
    await world.runtime.settled();
    await world.runtime.applyBoundary();
    expect((await store.rowCounts())["cap_mcp_servers"]).toBe(0);
    await world.runtime.shutdown();
  });
});
