import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import type { HostConnection } from "@xeon/contracts/wire";
import { parseServiceEndpoint } from "@xeon/client/endpoint";
import { createHostConnection } from "../../src/client.ts";
import { connectServiceTransport, startService, type ServiceHandle } from "../../src/index.ts";
import { createSshTunnelPort } from "../../src/service/tunnel.ts";
import { approvalModels } from "../fixtures/approval-tape.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { isLoopbackAddress, ownListeners } from "../fixtures/listeners.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { connectedClient, manualTime, scratchRuntimeDir } from "../fixtures/service-harness.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// X5(M3b B2-RMT): 원격 사용. `socat` 중계로 만든 가짜 터널(ssh -L의 대역: 로컬 Unix 소켓을 서비스 Unix 소켓에 잇는다) 너머에서
// 세션 목록을 읽고 입력(turn, 승인)을 서비스에 맡긴다. 서비스가 듣는 주소는 모두 루프백이거나 Unix 소켓이다.
// 실제 엔진, 실제 소켓, 실제 socat 프로세스, 모델 테이프.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const SOCAT = Bun.which("socat");

const home = useEngineHome();
writeUserSettings(home, { ...TAPE_SETTINGS, "l0.sandbox.enabled": false });
const workspace = mkdtempSync(join(tmpdir(), "xrmt-ws-"));
const previousCwd = process.cwd();
process.chdir(workspace);
afterAll(() => {
  process.chdir(previousCwd);
  home.dispose();
  rmSync(workspace, { recursive: true, force: true });
});

function startedHandle(started: Awaited<ReturnType<typeof startService>>): ServiceHandle {
  if (!started.started) throw new Error(`the service did not start: ${started.reason}`);
  return started.handle;
}

interface FakeTunnels {
  readonly port: ReturnType<typeof createSshTunnelPort>;
  readonly requests: { target: string; remoteSocket: string; port?: number }[];
}

/** ssh 대신 socat이 로컬 소켓을 원격(여기서는 같은 기기의) 서비스 소켓에 잇는다 */
function socatTunnels(socat: string): FakeTunnels {
  const requests: { target: string; remoteSocket: string; port?: number }[] = [];
  const port = createSshTunnelPort({
    readyTimeoutMs: 10_000,
    buildCommand: (request, localSocket) => {
      requests.push({ ...request });
      return ok({
        command: socat,
        args: [`UNIX-LISTEN:${localSocket},fork,mode=600`, `UNIX-CONNECT:${request.remoteSocket}`],
      });
    },
  });
  return { port, requests };
}

async function connectThroughTunnel(text: string, tunnels: FakeTunnels): Promise<HostConnection> {
  const endpoint = parseServiceEndpoint(text);
  if (!endpoint.ok) throw new Error(`bad endpoint: ${JSON.stringify(endpoint.error)}`);
  const transport = await connectServiceTransport(endpoint.value, { tunnel: tunnels.port });
  if (!transport.ok) throw new Error(`cannot connect: ${JSON.stringify(transport.error)}`);
  const connection = createHostConnection(transport.value);
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

describe("remote use through a tunnel (X5)", () => {
  test("socat is installed (X5 needs it; nothing is skipped silently)", () => {
    expect(SOCAT).not.toBeNull();
  });

  realTest(
    "a client behind the tunnel lists sessions and delegates input; every service listener is loopback or a Unix socket",
    async () => {
      if (SOCAT === null) throw new Error("socat is missing");
      const runtime = scratchRuntimeDir();
      const handle = startedHandle(
        await startService({
          runtimeDir: runtime.dir,
          assemble: { devChecks: true, defaultGroups: false, buildModels: approvalModels("x5") },
          tcp: { host: "127.0.0.1", port: 0 },
          time: manualTime(),
          handleSignals: false,
          startupGraceMs: 0,
          idleGraceMs: 60_000,
        }),
      );
      const tunnels = socatTunnels(SOCAT);
      const opened: HostConnection[] = [];
      try {
        const { registration } = handle;
        const remoteText = `ssh://me@fake-box:2222${registration.socket}`;

        // 1. 터널 너머의 클라이언트가 세션 목록을 읽는다
        const remote = await connectThroughTunnel(remoteText, tunnels);
        opened.push(remote);
        expect(tunnels.requests).toEqual([
          { target: "me@fake-box", remoteSocket: registration.socket, port: 2222 },
        ]);
        expect((await remote.request("thread.list", {})).threads).toEqual([]);

        // 2. 입력을 서비스에 맡긴다: thread 생성과 turn 시작, 승인 응답까지 모두 터널 너머에서
        const collector = collectEvents(remote);
        await remote.request("events.subscribe", { from: "head" });
        const created = await remote.request("thread.create", { workspace });
        await remote.request("turn.start", { threadId: created.threadId, input: "run it" });
        const asked = await collector.waitFor((event) => event.kind === "approval.requested");

        // 3. 다른 기기(두 번째 터널)가 같은 서비스의 같은 세션을 본다: 세션은 서비스 안에 있다
        const second = await connectThroughTunnel(remoteText, tunnels);
        opened.push(second);
        const listed = await second.request("thread.list", {});
        expect(listed.threads.map((thread) => thread.threadId)).toEqual([created.threadId]);
        const local = await connectedClient({ kind: "unix", path: registration.socket });
        opened.push(local);
        expect((await local.request("thread.list", {})).threads.map((t) => t.threadId)).toEqual([
          created.threadId,
        ]);

        // 4. 두 번째 기기가 승인으로 입력을 이어 맡기고 turn이 서비스 안에서 끝난다
        const collector2 = collectEvents(second);
        await second.request("events.subscribe", { from: "head" });
        await second.request("thread.open", { threadId: created.threadId, mode: "write" });
        await second.request("approval.respond", { approvalId: asked.id, decision: "allow" });
        await collector2.waitFor((event) => event.kind === "turn.completed");
        expect(tunnels.requests).toHaveLength(2);

        // 5. 서비스가 듣는 주소: 등록 파일이 적은 값과 운영체제가 아는 값이 모두 루프백 또는 Unix 소켓이다
        expect(registration.socket.startsWith("/")).toBe(true);
        const tcpAddress = handle.tcpAddress;
        if (tcpAddress === undefined) throw new Error("the service did not open tcp");
        const stored: unknown = JSON.parse(readFileSync(join(runtime.dir, "service.json"), "utf8"));
        expect(stored).toMatchObject({ socket: registration.socket, tcp: tcpAddress });
        expect(tcpAddress).toMatch(/^127\.0\.0\.1:\d+$/);
        const listeners = ownListeners();
        if (listeners !== undefined) {
          expect(listeners.every(isLoopbackAddress)).toBe(true);
          expect(
            listeners
              .filter((listener) => listener.family !== "unix")
              .map((listener) => listener.address),
          ).toEqual([tcpAddress]);
          expect(
            listeners
              .filter((listener) => listener.family === "unix")
              .map((listener) => listener.address),
          ).toContain(registration.socket);
        }
      } finally {
        await Promise.all(opened.map((connection) => connection.close()));
        await handle.shutdown("stop");
        runtime.dispose();
      }
    },
    90_000,
  );

  realTest(
    "a tunnel that cannot start is reported by value and leaves no connection behind",
    async () => {
      const tunnels = createSshTunnelPort({
        readyTimeoutMs: 2000,
        buildCommand: () => ok({ command: "/nonexistent/xeon-tunnel", args: [] }),
      });
      const endpoint = parseServiceEndpoint("ssh://fake-box/run/xeon.sock");
      if (!endpoint.ok) throw new Error("bad endpoint");
      expect(await connectServiceTransport(endpoint.value, { tunnel: tunnels })).toEqual(
        err({ kind: "tunnel_failed", failure: { kind: "spawn_failed", detail: "ENOENT" } }),
      );
    },
    30_000,
  );
});
