import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTunnel, sshTunnelCommand, type SocketTunnel } from "../src/index.ts";
import { manualClock } from "./support/clock.ts";
import { realClock, realScheduler, waitFor } from "./support/real-time.ts";

// L0.process.spec §4.4.8: 터널 프로세스의 준비 감지, 조기 종료, 시한, 정리. 실제 자식 프로세스(fixtures/fake-tunnel.ts)와 실제 Unix 소켓.

const FAKE = `${import.meta.dir}/fixtures/fake-tunnel.ts`;
const deps = { clock: realClock(), scheduler: realScheduler() };

const dirs: string[] = [];
const open: SocketTunnel[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "xtun-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(open.splice(0).map((tunnel) => tunnel.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fakeSpec(
  localSocket: string,
  mode: "listen" | "dies" | "exit" | "silent" | "ignore-term",
  extra: readonly string[] = [],
) {
  return { command: process.execPath, args: [FAKE, localSocket, mode, ...extra], localSocket };
}

/** fake-tunnel(ignore-term)이 받은 SIGTERM 목록. 파일이 아직 없으면 빈 목록 */
function signalsIn(logPath: string): string[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

describe("openTunnel", () => {
  test("is ready once the local socket exists, and close() stops the process and removes the socket", async () => {
    const localSocket = join(scratch(), "t.sock");
    const opened = await openTunnel(fakeSpec(localSocket, "listen"), deps);
    if (!opened.ok) throw new Error(`unexpected: ${JSON.stringify(opened.error)}`);
    open.push(opened.value);
    expect(opened.value.localSocket).toBe(localSocket);
    expect(existsSync(localSocket)).toBe(true);
    await opened.value.close();
    const exit = await opened.value.exited;
    expect(exit.signal).toBe("SIGTERM");
    expect(existsSync(localSocket)).toBe(false);
    // 두 번 불러도 된다
    await opened.value.close();
  });

  test("a process that exits before the socket appears is an exited error carrying the code and the stderr tail", async () => {
    const localSocket = join(scratch(), "t.sock");
    const opened = await openTunnel(fakeSpec(localSocket, "exit"), deps);
    expect(opened).toEqual({
      ok: false,
      error: {
        kind: "exited",
        code: 7,
        signal: null,
        stderr: "tunnel: permission denied (publickey)\n",
      },
    });
  });

  test("a process that never makes the socket times out and is killed", async () => {
    const localSocket = join(scratch(), "t.sock");
    const opened = await openTunnel(
      { ...fakeSpec(localSocket, "silent"), readyTimeoutMs: 300 },
      deps,
    );
    expect(opened).toEqual({ ok: false, error: { kind: "timeout", stderr: "" } });
  });

  test("a missing executable is spawn_failed ENOENT", async () => {
    const localSocket = join(scratch(), "t.sock");
    const opened = await openTunnel(
      { command: "/nonexistent/fresnel-tunnel", args: [], localSocket },
      deps,
    );
    expect(opened).toEqual({ ok: false, error: { kind: "spawn_failed", code: "ENOENT" } });
  });

  test("a local socket path over the sun_path limit is refused before anything is spawned", async () => {
    const localSocket = `/${"a".repeat(120)}/t.sock`;
    const opened = await openTunnel(fakeSpec(localSocket, "listen"), deps);
    expect(opened).toEqual({
      ok: false,
      error: { kind: "path_too_long", path: localSocket, limit: 103 },
    });
  });

  test("the tunnel process dying after it was ready resolves exited without close()", async () => {
    const localSocket = join(scratch(), "t.sock");
    const opened = await openTunnel(fakeSpec(localSocket, "dies"), deps);
    if (!opened.ok) throw new Error("unexpected");
    open.push(opened.value);
    expect(await opened.value.exited).toEqual({ code: 3, signal: null });
  });

  test("close() sends SIGTERM, leaves a SIGTERM-ignoring process alone until 2000ms, then SIGKILLs it", async () => {
    const dir = scratch();
    const localSocket = join(dir, "t.sock");
    const signalLog = join(dir, "signals.log");
    // 준비 확인과 정리 시한은 같은 수동 시계로 돈다. 자식이 소켓을 만드는 것만 실시간으로 기다린다
    const clock = manualClock();
    const opening = openTunnel(
      { ...fakeSpec(localSocket, "ignore-term", [signalLog]), pollMs: 25 },
      { clock, scheduler: clock },
    );
    expect(await waitFor(() => existsSync(localSocket), 5000)).toBe(true);
    await clock.advance(25);
    const opened = await opening;
    if (!opened.ok) throw new Error(`unexpected: ${JSON.stringify(opened.error)}`);
    const tunnel = opened.value;
    try {
      const requestedAt = clock.now();
      const closing = tunnel.close();
      // 시한 타이머는 정확히 2000ms 뒤로 하나만 걸린다
      expect(clock.pendingTimers()).toEqual([{ at: requestedAt + 2000 }]);
      expect(await waitFor(() => signalsIn(signalLog).length === 1, 5000)).toBe(true);
      expect(signalsIn(signalLog)).toEqual(["SIGTERM"]);

      // 1999ms가 지나도 SIGKILL은 가지 않는다. 실시간으로 잠시 기다려도 프로세스는 끝나지 않는다
      await clock.advance(1999);
      const afterAdvance = await Promise.race([
        tunnel.exited.then(() => "exited"),
        waitFor(() => false, 200).then(() => "running"),
      ]);
      expect(afterAdvance).toBe("running");

      // 2000ms에 SIGKILL이 가고, 프로세스는 신호 종료로 사라지며 소켓 파일도 지워진다
      await clock.advance(1);
      const exit = await tunnel.exited;
      await closing;
      expect(exit).toEqual({ code: null, signal: "SIGKILL" });
      expect([...signalsIn(signalLog), exit.signal]).toEqual(["SIGTERM", "SIGKILL"]);
      expect(existsSync(localSocket)).toBe(false);
    } finally {
      // 실패해도 자식을 남기지 않는다. close()는 같은 Promise를 돌려주므로 이미 불렀어도 된다
      const closing = tunnel.close();
      await clock.advance(2000);
      await closing;
    }
  });
});

describe("sshTunnelCommand", () => {
  const base = {
    target: "me@box.example",
    remoteSocket: "/run/user/1000/fresnel/fresnel.sock",
    localSocket: "/tmp/xtun-1/s",
  };

  test("builds the ssh argv with the forward as one -L field and the target after --", () => {
    expect(sshTunnelCommand({ ...base, port: 2222, identityFile: "/home/me/.ssh/id" })).toEqual({
      ok: true,
      value: {
        command: "ssh",
        args: [
          "-N",
          "-T",
          "-o",
          "ExitOnForwardFailure=yes",
          "-o",
          "BatchMode=yes",
          "-o",
          "ServerAliveInterval=15",
          "-o",
          "ServerAliveCountMax=3",
          "-p",
          "2222",
          "-i",
          "/home/me/.ssh/id",
          "-L",
          "/tmp/xtun-1/s:/run/user/1000/fresnel/fresnel.sock",
          "--",
          "me@box.example",
        ],
      },
    });
  });

  test("rejects a target that ssh would read as an option, and paths that would break the -L fields", () => {
    expect(sshTunnelCommand({ ...base, target: "-oProxyCommand=touch /tmp/x" })).toEqual({
      ok: false,
      error: { kind: "invalid_target", target: "-oProxyCommand=touch /tmp/x" },
    });
    expect(sshTunnelCommand({ ...base, target: "box example" }).ok).toBe(false);
    expect(sshTunnelCommand({ ...base, remoteSocket: "relative.sock" })).toEqual({
      ok: false,
      error: { kind: "invalid_path", field: "remoteSocket" },
    });
    expect(sshTunnelCommand({ ...base, remoteSocket: "/a:b/fresnel.sock" })).toEqual({
      ok: false,
      error: { kind: "invalid_path", field: "remoteSocket" },
    });
    expect(sshTunnelCommand({ ...base, localSocket: "/tmp/x y/s" })).toEqual({
      ok: false,
      error: { kind: "invalid_path", field: "localSocket" },
    });
    expect(sshTunnelCommand({ ...base, port: 70_000 })).toEqual({
      ok: false,
      error: { kind: "invalid_port", port: 70_000 },
    });
  });
});
