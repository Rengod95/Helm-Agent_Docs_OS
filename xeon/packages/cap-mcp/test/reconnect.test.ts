import { describe, expect, test } from "bun:test";
import { backoffDelayMs } from "../src/client/backoff.ts";
import type { StubOutcome } from "../src/testing/stub-server.ts";
import { flush } from "./support/flush.ts";
import { rejection } from "./support/rejection.ts";
import { buildWorld, startWorld, type World } from "./support/world.ts";

const tools = [{ name: "echo" }, { name: "add" }];

function openWorld(user: Record<string, unknown> = {}): World {
  return buildWorld({ servers: { stub: { stub: { era: "modern", tools } } }, user });
}

async function stateOf(world: World): Promise<string | undefined> {
  const status = await world.runtime.service.client.status({ server: "stub" });
  return status.state;
}

describe("reconnect", () => {
  test("crash removes tools then restores", async () => {
    const world = openWorld();
    await startWorld(world);
    await world.runtime.applyBoundary();
    expect(world.registrar.names()).toEqual(["add", "echo"]);

    await world.stubs["stub"]?.drop();
    await flush();
    expect(await stateOf(world)).toBe("reconnecting");
    // 도구는 다음 단계 경계에서 한꺼번에 빠진다
    expect(world.registrar.names()).toEqual(["add", "echo"]);
    const removed = await world.runtime.applyBoundary();
    expect(removed.toolsRemoved.toSorted()).toEqual(["add", "echo"]);
    expect(world.registrar.names()).toEqual([]);
    expect(world.changes.at(-1)?.servers).toEqual([{ id: "stub", status: "disconnected" }]);

    world.scheduler.advance(1000);
    await world.runtime.settled();
    expect(await stateOf(world)).toBe("connected");
    const added = await world.runtime.applyBoundary();
    expect(added.toolsAdded.toSorted()).toEqual(["add", "echo"]);
    expect(world.registrar.names()).toEqual(["add", "echo"]);
    await world.runtime.shutdown();
  });

  test("backoff schedule", async () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((attempt) => backoffDelayMs(attempt, 60000))).toEqual([
      1000, 2000, 4000, 8000, 16000, 32000, 60000,
    ]);
    const world = openWorld({ "reconnect.maxAttempts": 10 });
    world.factory.failNext(4);
    await startWorld(world);
    // 첫 시도 실패 뒤 1초, 2초, 4초 … 간격으로 다시 시도한다
    const delays: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const next = world.scheduler.pending()[0];
      delays.push(next ?? -1);
      world.scheduler.advance(next ?? 0);
      // oxlint-disable-next-line no-await-in-loop -- 시도가 끝나야 다음 타이머가 생긴다 (eng.testing.guide TS-05)
      await world.runtime.settled();
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000]);
    expect(await stateOf(world)).toBe("connected");
    await world.runtime.shutdown();
  });

  test("gives up after max attempts", async () => {
    const world = openWorld({ "reconnect.maxAttempts": 3 });
    world.factory.failNext(50, "connection refused");
    await startWorld(world);
    for (let i = 0; i < 5; i += 1) {
      world.scheduler.advance(60000);
      // oxlint-disable-next-line no-await-in-loop -- 시도가 끝나야 다음 타이머가 생긴다 (eng.testing.guide TS-05)
      await world.runtime.settled();
    }
    expect(await stateOf(world)).toBe("failed");
    expect(world.scheduler.pending()).toEqual([]);
    expect(world.factory.opens).toHaveLength(3);
    const status = await world.runtime.service.client.status({ server: "stub" });
    expect(status.lastError).toMatchObject({ code: "spawn_failed" });
    // reconnect가 다시 시작시킨다
    world.factory.failNext(0);
    const revived = await world.runtime.service.client.reconnect({ server: "stub" });
    expect(revived.state).toBe("connected");
    await world.runtime.shutdown();
  });

  test("call during reconnect fails fast", async () => {
    const world = openWorld();
    await startWorld(world);
    await world.stubs["stub"]?.drop();
    await flush();
    const failure = await rejection(
      world.runtime.service.client.callTool({ server: "stub", tool: "echo", arguments: {} }),
    );
    expect(failure).toMatchObject({ data: { code: "server_disconnected", retryable: true } });
    await world.runtime.shutdown();
  });

  test("in-flight call finishes on removal", async () => {
    const gate = Promise.withResolvers<void>();
    const slow = {
      name: "slow",
      handle: async (): Promise<StubOutcome> => {
        await gate.promise;
        return { kind: "complete", content: [{ type: "text", text: "late" }] };
      },
    };
    const world = buildWorld({ servers: { stub: { stub: { era: "modern", tools: [slow] } } } });
    await startWorld(world);
    const call = world.runtime.service.client.callTool({
      server: "stub",
      tool: "slow",
      arguments: {},
    });
    await flush();
    let disabled = false;
    const disabling = world.runtime.service.client.disable({ server: "stub" }).then((status) => {
      disabled = true;
      return status;
    });
    await flush();
    // 진행 중 호출이 끝나기 전에는 연결이 닫히지 않는다
    expect(disabled).toBe(false);
    gate.resolve();
    const output = await call;
    expect(output.status).toBe("complete");
    expect((await disabling).state).toBe("disabled");
    // 그 뒤의 호출은 연결이 없다
    const after = await rejection(
      world.runtime.service.client.callTool({ server: "stub", tool: "slow", arguments: {} }),
    );
    expect(after).toMatchObject({ data: { code: "server_disconnected" } });
    await world.runtime.shutdown();
  });

  test("connect revives a disabled server and settings removal drops it", async () => {
    const world = openWorld();
    await startWorld(world);
    await world.runtime.service.client.disable({ server: "stub" });
    expect(await stateOf(world)).toBe("disabled");
    const back = await world.runtime.service.client.connect({ server: "stub" });
    expect(back.state).toBe("connected");
    world.settings.set([]);
    await world.runtime.load(world.controller.signal);
    await world.runtime.settled();
    await flush();
    const failure = await rejection(world.runtime.service.client.status({ server: "stub" }));
    expect(failure).toMatchObject({ data: { code: "server_unknown" } });
    await world.runtime.shutdown();
  });

  test("a server that never answers fails the connect with a timeout", async () => {
    const world = buildWorld({
      servers: {
        stub: {
          stub: { era: "modern", tools, silentHandshake: true },
          def: { timeouts: { connectMs: 1000 } },
        },
      },
      user: { "reconnect.maxAttempts": 1 },
    });
    await startWorld(world);
    const status = await world.runtime.service.client.status({ server: "stub" });
    expect(status.state).toBe("failed");
    expect(status.lastError?.code).toBe("timeout");
    await world.runtime.shutdown();
  }, 10000);
});
