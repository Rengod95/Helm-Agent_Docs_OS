import { describe, expect, test } from "bun:test";
import type { BackgroundOwner, BackgroundProcessInfo } from "@xeon/contracts/services";
import {
  DEFAULT_BACKGROUND_GRACE_MS,
  DEFAULT_BACKGROUND_RETENTION_MS,
  createBackgroundRegistry,
} from "../src/index.ts";
import { flushMicrotasks, manualClock } from "./support/clock.ts";
import {
  fakeProcess,
  memoryLogger,
  sequentialLocalIds,
  type FakeProcess,
} from "./support/fakes.ts";

function setup() {
  const clock = manualClock();
  const logger = memoryLogger();
  const registry = createBackgroundRegistry({
    clock,
    scheduler: clock,
    ids: sequentialLocalIds(),
    logger,
  });
  return { clock, logger, registry };
}

const TOOL_OWNER: BackgroundOwner = { kind: "tool", threadId: "thr_a", ref: "call-1" };

function registerFake(
  registry: ReturnType<typeof setup>["registry"],
  fake: FakeProcess,
  owner: BackgroundOwner = TOOL_OWNER,
  pid = 100,
) {
  const result = registry.register({ label: "dev server", owner, pid, stopper: fake.stopper });
  if (!result.ok) throw new Error("register failed");
  return result.value;
}

describe("register, list, get", () => {
  test("registers a running entry with an issued bgp id and the registration time", () => {
    const { clock, registry } = setup();
    const id = registerFake(registry, fakeProcess());
    expect(id).toMatch(/^bgp_/);
    expect(registry.get(id)).toEqual({
      id,
      label: "dev server",
      owner: TOOL_OWNER,
      pid: 100,
      startedAt: clock.now(),
      state: "running",
      exitCode: null,
    });
  });

  test("list filters by thread and owner kind", () => {
    const { registry } = setup();
    registerFake(registry, fakeProcess(), TOOL_OWNER, 1);
    registerFake(registry, fakeProcess(), { kind: "mcp", threadId: null, ref: "files" }, 2);
    registerFake(registry, fakeProcess(), { kind: "tool", threadId: "thr_b", ref: null }, 3);
    expect(registry.list().map((info) => info.pid)).toEqual([1, 2, 3]);
    expect(registry.list({ threadId: "thr_a" }).map((info) => info.pid)).toEqual([1]);
    expect(registry.list({ kind: "tool" }).map((info) => info.pid)).toEqual([1, 3]);
    expect(registry.list({ kind: "tool", threadId: "thr_b" }).map((info) => info.pid)).toEqual([3]);
  });

  test("get returns undefined for an unknown id", () => {
    const { registry } = setup();
    expect(registry.get("bgp_missing")).toBeUndefined();
  });

  test("the info it returns is a snapshot, not a live view", () => {
    const { registry } = setup();
    const fake = fakeProcess();
    const id = registerFake(registry, fake);
    const before = registry.get(id);
    fake.exit(0);
    expect(before?.state).toBe("running");
  });
});

describe("process exit", () => {
  test("a process that ends by itself becomes exited with its code", async () => {
    const { registry } = setup();
    const fake = fakeProcess();
    const id = registerFake(registry, fake);
    fake.exit(3);
    await flushMicrotasks();
    expect(registry.get(id)?.state).toBe("exited");
    expect(registry.get(id)?.exitCode).toBe(3);
  });

  test("a rejected exited promise marks the entry lost", async () => {
    const { logger, registry } = setup();
    const fake = fakeProcess();
    const id = registerFake(registry, fake);
    fake.crash(new Error("watcher died"));
    await flushMicrotasks();
    expect(registry.get(id)?.state).toBe("lost");
    expect(logger.records.some((record) => record.event === "background.exited_rejected")).toBe(
      true,
    );
  });

  test("finished entries stay in list for ten minutes and then disappear", async () => {
    const { clock, registry } = setup();
    const fake = fakeProcess();
    const id = registerFake(registry, fake);
    fake.exit(0);
    await flushMicrotasks();
    await clock.advance(DEFAULT_BACKGROUND_RETENTION_MS - 1);
    expect(registry.get(id)).toBeDefined();
    await clock.advance(1);
    expect(registry.get(id)).toBeUndefined();
  });
});

describe("onChange", () => {
  test("reports registration, stopping and the final state in order", async () => {
    const { registry } = setup();
    const seen: string[] = [];
    registry.onChange((info: BackgroundProcessInfo) => {
      seen.push(info.state);
    });
    const id = registerFake(registry, fakeProcess());
    await registry.stop(id);
    expect(seen).toEqual(["running", "stopping", "exited"]);
  });

  test("unsubscribe stops notifications and a throwing listener does not break the others", async () => {
    const { logger, registry } = setup();
    const seen: string[] = [];
    registry.onChange(() => {
      throw new Error("listener bug");
    });
    const off = registry.onChange((info) => {
      seen.push(info.state);
    });
    registerFake(registry, fakeProcess());
    expect(seen).toEqual(["running"]);
    expect(logger.records.some((record) => record.event === "background.listener_failed")).toBe(
      true,
    );
    off();
    registerFake(registry, fakeProcess());
    expect(seen).toEqual(["running"]);
  });
});

describe("stop", () => {
  test("unknown id is not_found", async () => {
    const { registry } = setup();
    expect(await registry.stop("bgp_missing")).toEqual({
      ok: false,
      error: { kind: "not_found", id: "bgp_missing" },
    });
  });

  test("a process that honours graceful stop ends as exited without a force", async () => {
    const { registry } = setup();
    const fake = fakeProcess();
    const id = registerFake(registry, fake);
    expect(await registry.stop(id)).toEqual({ ok: true, value: "exited" });
    expect(fake.stopCalls).toEqual(["graceful"]);
  });

  test("a process that ignores graceful gets a force after graceMs and ends as killed", async () => {
    const { clock, registry } = setup();
    const fake = fakeProcess({ ignore: ["graceful"] });
    const id = registerFake(registry, fake);
    const stopping = registry.stop(id);
    await flushMicrotasks();
    expect(registry.get(id)?.state).toBe("stopping");
    await clock.advance(DEFAULT_BACKGROUND_GRACE_MS - 1);
    expect(fake.stopCalls).toEqual(["graceful"]);
    await clock.advance(1);
    expect(fake.stopCalls).toEqual(["graceful", "force"]);
    expect(await stopping).toEqual({ ok: true, value: "killed" });
    expect(registry.get(id)?.state).toBe("killed");
  });

  test("an explicit graceMs overrides the default", async () => {
    const { clock, registry } = setup();
    const fake = fakeProcess({ ignore: ["graceful"] });
    const id = registerFake(registry, fake);
    const stopping = registry.stop(id, { graceMs: 50 });
    await clock.advance(50);
    expect(fake.stopCalls).toEqual(["graceful", "force"]);
    expect(await stopping).toEqual({ ok: true, value: "killed" });
  });

  test("a process that survives force is marked lost and logged", async () => {
    const { clock, logger, registry } = setup();
    const fake = fakeProcess({ ignore: ["graceful", "force"] });
    const id = registerFake(registry, fake);
    const stopping = registry.stop(id, { graceMs: 100 });
    await clock.advance(100);
    await clock.advance(2000);
    expect(await stopping).toEqual({ ok: true, value: "lost" });
    expect(registry.get(id)?.state).toBe("lost");
    expect(logger.records.some((record) => record.event === "background.lost")).toBe(true);
  });

  test("a lost process that finally exits is recorded as killed", async () => {
    const { clock, registry } = setup();
    const fake = fakeProcess({ ignore: ["graceful", "force"] });
    const id = registerFake(registry, fake);
    const stopping = registry.stop(id, { graceMs: 10 });
    await clock.advance(10);
    await clock.advance(2000);
    await stopping;
    fake.exit(137, "SIGKILL");
    await flushMicrotasks();
    expect(registry.get(id)?.state).toBe("killed");
    expect(registry.get(id)?.exitCode).toBe(137);
  });

  test("a stopper that rejects is logged and the escalation still happens", async () => {
    const { clock, logger, registry } = setup();
    const fake = fakeProcess({ failOn: ["graceful"], ignore: ["graceful"] });
    const id = registerFake(registry, fake);
    const stopping = registry.stop(id, { graceMs: 20 });
    await clock.advance(20);
    expect(await stopping).toEqual({ ok: true, value: "killed" });
    expect(logger.records.some((record) => record.event === "background.stop_failed")).toBe(true);
  });

  test("concurrent stops share one run", async () => {
    const { registry } = setup();
    const fake = fakeProcess();
    const id = registerFake(registry, fake);
    const [a, b] = await Promise.all([registry.stop(id), registry.stop(id)]);
    expect(a).toEqual(b);
    expect(fake.stopCalls).toEqual(["graceful"]);
  });

  test("stopping an already finished entry is ok and does not call the stopper", async () => {
    const { registry } = setup();
    const fake = fakeProcess();
    const id = registerFake(registry, fake);
    fake.exit(0);
    await flushMicrotasks();
    expect(await registry.stop(id)).toEqual({ ok: true, value: "exited" });
    expect(fake.stopCalls).toEqual([]);
  });
});

describe("stopOwnedBy", () => {
  test("stops only the live entries of that thread and returns how many", async () => {
    const { registry } = setup();
    const mine = fakeProcess();
    const alsoMine = fakeProcess();
    const finished = fakeProcess();
    const other = fakeProcess();
    registerFake(registry, mine, TOOL_OWNER, 1);
    registerFake(registry, alsoMine, { kind: "other", threadId: "thr_a", ref: null }, 2);
    registerFake(registry, finished, TOOL_OWNER, 3);
    registerFake(registry, other, { kind: "tool", threadId: "thr_b", ref: null }, 4);
    finished.exit(0);
    await flushMicrotasks();
    expect(await registry.stopOwnedBy("thr_a")).toBe(2);
    expect(mine.stopCalls).toEqual(["graceful"]);
    expect(alsoMine.stopCalls).toEqual(["graceful"]);
    expect(finished.stopCalls).toEqual([]);
    expect(other.stopCalls).toEqual([]);
    expect(registry.list({ threadId: "thr_b" })[0]?.state).toBe("running");
  });

  test("returns 0 when nothing belongs to the thread", async () => {
    const { registry } = setup();
    expect(await registry.stopOwnedBy("thr_none")).toBe(0);
  });
});

describe("close", () => {
  test("stops every live entry in parallel and refuses new registrations", async () => {
    const { clock, registry } = setup();
    const polite = fakeProcess();
    const stubborn = fakeProcess({ ignore: ["graceful"] });
    const first = registerFake(registry, polite, TOOL_OWNER, 1);
    const second = registerFake(registry, stubborn, { kind: "mcp", threadId: null, ref: "x" }, 2);
    const closing = registry.close({ graceMs: 100 });
    await flushMicrotasks();
    expect(polite.stopCalls).toEqual(["graceful"]);
    expect(stubborn.stopCalls).toEqual(["graceful"]);
    await clock.advance(100);
    expect(await closing).toBe(2);
    expect(registry.get(first)?.state).toBe("exited");
    expect(registry.get(second)?.state).toBe("killed");
    expect(
      registry.register({ label: "late", owner: TOOL_OWNER, pid: 9, stopper: polite.stopper }),
    ).toEqual({
      ok: false,
      error: { kind: "registry_closed" },
    });
    expect(clock.pendingTimers()).toEqual([]);
  });
});
