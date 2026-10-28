import { describe, expect, test } from "bun:test";
import { createIdleMonitor, createTokenGate, newServiceToken, verifyToken } from "../src/index.ts";
import { manualClock } from "./support/clock.ts";

const GRACE = 60_000;
const STARTUP = 10_000;

function setup() {
  const clock = manualClock();
  const monitor = createIdleMonitor({
    clock,
    scheduler: clock,
    startupGraceMs: STARTUP,
    idleGraceMs: GRACE,
  });
  const fired: number[] = [];
  monitor.onIdle(() => {
    fired.push(clock.now());
  });
  return { clock, monitor, fired };
}

describe("idle monitor (L0.process.spec 4.4.4 table)", () => {
  test("connections 0, live 0, schedules 0 and the grace elapsed: idle fires", async () => {
    const { clock, monitor, fired } = setup();
    monitor.update({ connections: 0, liveTasks: 0, pendingSchedules: 0 });
    await clock.advance(GRACE + STARTUP);
    expect(fired).toHaveLength(1);
  });

  test("the grace has not elapsed: nothing fires and idleShutdownAt is the planned time", async () => {
    const { clock, monitor, fired } = setup();
    const start = clock.now();
    monitor.update({ connections: 0, liveTasks: 0, pendingSchedules: 0 });
    expect(monitor.idleShutdownAt).toBe(start + STARTUP + GRACE);
    await clock.advance(GRACE - 1);
    expect(fired).toHaveLength(0);
  });

  test("a connection, a live task (approval waiting counts), or a pending schedule each prevent idle", async () => {
    const cases = [
      { connections: 1, liveTasks: 0, pendingSchedules: 0 },
      { connections: 0, liveTasks: 1, pendingSchedules: 0 },
      { connections: 0, liveTasks: 0, pendingSchedules: 1 },
    ];
    await Promise.all(
      cases.map(async (blocked) => {
        const { clock, monitor, fired } = setup();
        monitor.update(blocked);
        expect(monitor.idleShutdownAt).toBeNull();
        await clock.advance(GRACE * 3);
        expect(fired).toHaveLength(0);
      }),
    );
  });

  test("a new connection during the grace cancels the timer; going idle again restarts the full grace", async () => {
    const { clock, monitor, fired } = setup();
    await clock.advance(STARTUP);
    monitor.update({ connections: 0, liveTasks: 0, pendingSchedules: 0 });
    await clock.advance(GRACE - 1000);
    monitor.update({ connections: 1, liveTasks: 0, pendingSchedules: 0 });
    expect(monitor.idleShutdownAt).toBeNull();
    await clock.advance(5000);
    monitor.update({ connections: 0, liveTasks: 0, pendingSchedules: 0 });
    await clock.advance(GRACE - 1);
    expect(fired).toHaveLength(0);
    await clock.advance(1);
    expect(fired).toHaveLength(1);
  });

  test("repeated idle updates do not push the deadline", async () => {
    const { clock, monitor, fired } = setup();
    await clock.advance(STARTUP);
    monitor.update({ connections: 0, liveTasks: 0, pendingSchedules: 0 });
    await clock.advance(GRACE / 2);
    monitor.update({ connections: 0, liveTasks: 0, pendingSchedules: 0 });
    await clock.advance(GRACE / 2);
    expect(fired).toHaveLength(1);
  });

  test("being idle inside the startup grace counts the idle grace from the end of the startup grace", async () => {
    const { clock, monitor, fired } = setup();
    monitor.update({ connections: 0, liveTasks: 0, pendingSchedules: 0 });
    await clock.advance(STARTUP + GRACE - 1);
    expect(fired).toHaveLength(0);
    await clock.advance(1);
    expect(fired).toHaveLength(1);
  });
});

const random = (bytes: number): Uint8Array => new Uint8Array(bytes).map((_, index) => index);

describe("service token", () => {
  test("32 random bytes become a 43 character base64url token", () => {
    expect(newServiceToken(random)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("verifyToken accepts only the same string value", () => {
    const token = newServiceToken(random);
    expect(verifyToken(token, token)).toBe(true);
    expect(verifyToken(token, `${token}x`)).toBe(false);
    expect(verifyToken(token, "")).toBe(false);
    expect(verifyToken(token, undefined)).toBe(false);
    expect(verifyToken(token, 5)).toBe(false);
  });

  test("rotate with a failing persist keeps the old token", () => {
    const gate = createTokenGate((bytes) => new Uint8Array(bytes).fill(9));
    const first = gate.current();
    expect(gate.rotate(() => false)).toBeUndefined();
    expect(gate.current()).toBe(first);
  });

  test("a rotated token invalidates the previous one", () => {
    let counter = 0;
    const gate = createTokenGate((bytes) => {
      counter += 1;
      return new Uint8Array(bytes).fill(counter);
    });
    const first = gate.current();
    expect(gate.verify(first)).toBe(true);
    const second = gate.rotate() ?? "";
    expect(second).not.toBe(first);
    expect(gate.verify(first)).toBe(false);
    expect(gate.verify(second)).toBe(true);
  });
});
