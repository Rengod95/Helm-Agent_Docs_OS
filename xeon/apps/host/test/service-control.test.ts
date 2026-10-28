import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createRegistrationStore, isProcessAlive } from "@xeon/platform-process";
import { parseHostArgv } from "../src/argv.ts";
import { serviceStatus, stopHostService } from "../src/service/control.ts";
import { scratchRuntimeDir } from "./fixtures/service-harness.ts";

// 멈춘 서비스와 pid 재사용: 신호는 같은 프로세스임이 확인될 때만 보낸다(M3b B1-SVC 보강).

const TOKEN = "t".repeat(43);
const START = 1_700_000_000_000;
const children: ReturnType<typeof Bun.spawn>[] = [];
const dirs: { dispose(): void }[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  for (const dir of dirs.splice(0)) dir.dispose();
});

function writeRegistration(runtimeDir: string, pid: number, startedAt: number): void {
  const written = createRegistrationStore({ path: join(runtimeDir, "service.json") }).write({
    schemaVersion: 1,
    version: "0.0.0",
    protocolVersion: "0.1.0",
    socket: join(runtimeDir, "gone.sock"),
    pid,
    startedAt,
    token: TOKEN,
    storeId: "s",
  });
  expect(written.ok).toBe(true);
}

function sleeper(): ReturnType<typeof Bun.spawn> {
  const child = Bun.spawn(["sleep", "60"], { stdout: "ignore", stderr: "ignore" });
  children.push(child);
  return child;
}

describe("stopHostService identity", () => {
  test("a registration whose start time does not match the process is a stale record: nothing is killed", async () => {
    const runtime = scratchRuntimeDir();
    dirs.push(runtime);
    const child = sleeper();
    writeRegistration(runtime.dir, child.pid, START);
    const stopped = await stopHostService({
      runtimeDir: runtime.dir,
      fingerprint: () => START + 1,
    });
    expect(stopped).toEqual({ ok: true, value: { kind: "not_running" } });
    expect(isProcessAlive(child.pid)).toBe(true);
  });

  test("an unreadable fingerprint is unconfirmed and nothing is killed", async () => {
    const runtime = scratchRuntimeDir();
    dirs.push(runtime);
    const child = sleeper();
    writeRegistration(runtime.dir, child.pid, START);
    const stopped = await stopHostService({ runtimeDir: runtime.dir, fingerprint: () => null });
    expect(stopped).toEqual({ ok: true, value: { kind: "not_running" } });
    expect(isProcessAlive(child.pid)).toBe(true);
  });

  test("a hung service (alive, same start time, no answer) is ended with SIGTERM instead of reported as not running", async () => {
    const runtime = scratchRuntimeDir();
    dirs.push(runtime);
    const child = sleeper();
    writeRegistration(runtime.dir, child.pid, START);
    const status = await serviceStatus({ runtimeDir: runtime.dir });
    expect(status).toEqual({ ok: true, value: { running: false, reason: "unreachable" } });
    const stopped = await stopHostService({
      runtimeDir: runtime.dir,
      fingerprint: () => START,
      shutdownTimeoutMs: 2000,
    });
    expect(stopped).toEqual({ ok: true, value: { kind: "signalled", outcome: "terminated" } });
    await child.exited;
    expect(isProcessAlive(child.pid)).toBe(false);
  });

  test("a process that is already gone is not_running", async () => {
    const runtime = scratchRuntimeDir();
    dirs.push(runtime);
    const child = sleeper();
    child.kill("SIGKILL");
    await child.exited;
    writeRegistration(runtime.dir, child.pid, START);
    const stopped = await stopHostService({ runtimeDir: runtime.dir, fingerprint: () => START });
    expect(stopped).toEqual({ ok: true, value: { kind: "not_running" } });
  });
});

describe("--listen-tcp loopback rule", () => {
  test("0.0.0.0 is refused without --allow-non-loopback and accepted with it", () => {
    const refused = parseHostArgv(["service", "run", "--listen-tcp", "0.0.0.0:7777"]);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toContain("tcp_not_loopback");
    expect(
      parseHostArgv(["service", "run", "--listen-tcp", "0.0.0.0:7777", "--allow-non-loopback"]),
    ).toEqual({
      ok: true,
      command: {
        kind: "service-run",
        safeMode: false,
        tcp: { host: "0.0.0.0", port: 7777 },
        allowNonLoopback: true,
      },
    });
  });

  test("127.0.0.1, ::1 and localhost are accepted", () => {
    for (const host of ["127.0.0.1", "::1", "localhost"]) {
      expect(parseHostArgv(["host", "--service", "--listen-tcp", `${host}:7777`]).ok).toBe(true);
    }
  });
});
