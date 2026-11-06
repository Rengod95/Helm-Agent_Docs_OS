import { describe, expect, test } from "bun:test";
import type { ShellContext } from "../src/main/context.ts";
import { sharedIntents } from "../src/main/intents.ts";
import {
  createSingleInstanceModule,
  type SingleInstancePorts,
} from "../src/main/single-instance.ts";
import { createFakeContext } from "./fake-context.ts";

interface FakeLock {
  readonly ports: SingleInstancePorts;
  readonly exits: number[];
  readonly secondListeners: (() => void)[];
  readonly openUrlListeners: (() => void)[];
}

function fakeLock(granted: boolean): FakeLock {
  const exits: number[] = [];
  const secondListeners: (() => void)[] = [];
  const openUrlListeners: (() => void)[] = [];
  return {
    ports: {
      requestLock: () => granted,
      onSecondInstance: (listener) => {
        secondListeners.push(listener);
      },
      onOpenUrl: (listener) => {
        openUrlListeners.push(listener);
      },
      exit: (code) => {
        exits.push(code);
      },
    },
    exits,
    secondListeners,
    openUrlListeners,
  };
}

function startInstance(ports: SingleInstancePorts, ctx: ShellContext): void {
  const module = createSingleInstanceModule(ports);
  module.beforeReady?.();
  module.register(ctx);
}

describe("single instance", () => {
  test("a second launch exits with 0 and listens to nothing", () => {
    const lock = fakeLock(false);
    const fake = createFakeContext();
    startInstance(lock.ports, fake.ctx);
    expect(lock.exits).toEqual([0]);
    expect({
      second: lock.secondListeners.length,
      openUrl: lock.openUrlListeners.length,
    }).toEqual({ second: 0, openUrl: 0 });
    expect(fake.shown.count).toBe(0);
  });

  test("the lock is requested before register, so before the app is ready", () => {
    const calls: string[] = [];
    const lock = fakeLock(true);
    const module = createSingleInstanceModule({
      ...lock.ports,
      requestLock: () => {
        calls.push("lock");
        return true;
      },
    });
    module.beforeReady?.();
    calls.push("ready");
    module.register(createFakeContext().ctx);
    expect(calls).toEqual(["lock", "ready"]);
  });

  test("the first launch keeps running and listens for the second launch and open-url", () => {
    const lock = fakeLock(true);
    const fake = createFakeContext();
    startInstance(lock.ports, fake.ctx);
    expect(lock.exits).toEqual([]);
    expect({
      second: lock.secondListeners.length,
      openUrl: lock.openUrlListeners.length,
    }).toEqual({ second: 1, openUrl: 1 });
  });

  test("a second launch brings the main window forward once and queues no intent", () => {
    sharedIntents.take(Date.now());
    const lock = fakeLock(true);
    const fake = createFakeContext();
    startInstance(lock.ports, fake.ctx);
    for (const listener of lock.secondListeners) listener();
    expect(fake.shown.count).toBe(1);
    expect(lock.exits).toEqual([]);
    expect(sharedIntents.take(Date.now())).toEqual([]);
  });

  test("open-url brings the main window forward and queues no intent", () => {
    sharedIntents.take(Date.now());
    const lock = fakeLock(true);
    const fake = createFakeContext();
    startInstance(lock.ports, fake.ctx);
    for (const listener of lock.openUrlListeners) listener();
    expect(fake.shown.count).toBe(1);
    expect(sharedIntents.take(Date.now())).toEqual([]);
  });
});
