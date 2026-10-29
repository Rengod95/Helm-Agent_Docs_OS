import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTunnel, sshTunnelCommand, type SocketTunnel } from "../src/index.ts";
import { realClock, realScheduler } from "./support/real-time.ts";

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

function fakeSpec(localSocket: string, mode: "listen" | "dies" | "exit" | "silent") {
  return { command: process.execPath, args: [FAKE, localSocket, mode], localSocket };
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
      { command: "/nonexistent/xeon-tunnel", args: [], localSocket },
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
});

describe("sshTunnelCommand", () => {
  const base = {
    target: "me@box.example",
    remoteSocket: "/run/user/1000/xeon/xeon.sock",
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
          "/tmp/xtun-1/s:/run/user/1000/xeon/xeon.sock",
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
    expect(sshTunnelCommand({ ...base, remoteSocket: "/a:b/xeon.sock" })).toEqual({
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
