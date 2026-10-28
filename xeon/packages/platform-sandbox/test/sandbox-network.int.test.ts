import { rmSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { repeatAsync } from "@xeon/contracts";
import {
  ENVIRONMENT_EXIT_CODE,
  missingMessage,
  readSandboxEnvironment,
  runCollected,
  shouldFailOnMissing,
  startRealSandbox,
} from "./support/real-sandbox.ts";

// M3-REQ-55: 네트워크는 기본 허용이고 차단 도메인 목록만 막는다. 실제 srt 프록시와 bwrap으로 확인한다.
// srt는 프로세스 전역 싱글턴이라 한 시험 안에서 서비스를 하나씩 차례로 만들고 dispose한다.
// 필수 바이너리가 없을 때의 동작은 sandbox.int.test.ts와 같다.

const environment = readSandboxEnvironment();
if (environment.supported && environment.missing.length > 0 && shouldFailOnMissing(Bun.env)) {
  process.stderr.write(`${missingMessage(environment)}\n`);
  process.exit(ENVIRONMENT_EXIT_CODE);
}
const runnable = environment.supported && environment.missing.length === 0;
if (!runnable) process.stderr.write("SKIPPED sandbox-network.int: sandbox not runnable here\n");
const suite = runnable ? describe : describe.skip;

async function waitForConnections(seen: readonly string[], count: number): Promise<void> {
  let tries = 0;
  await repeatAsync<void>(async () => {
    tries += 1;
    if (seen.length >= count || tries > 100) return { value: undefined };
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    return undefined;
  });
}

suite("real sandbox network policy (srt proxy)", () => {
  test("a domain is reachable by default and refused once it is on the blocked list", async () => {
    const connections: string[] = [];
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          connections.push("open");
          socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
          socket.end();
        },
        data() {},
      },
    });
    // NO_PROXY가 루프백을 프록시 밖으로 보내므로 --noproxy ''로 프록시를 강제한다
    const fetchCode = `curl -s --noproxy '' -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:${String(listener.port)}/`;
    const codeWith = async (blockedDomains: readonly string[]): Promise<string> => {
      const box = await startRealSandbox({ blockedDomains });
      try {
        const policy = box.service.defaultPolicy({
          workspaceRoots: [box.dirs.workspace],
          tempDir: box.dirs.tmp,
        });
        const ran = await runCollected(box.service.wrapShell(box.shell, policy), fetchCode, {
          cwd: box.dirs.workspace,
        });
        return ran.output;
      } finally {
        await box.service.dispose();
        rmSync(box.dirs.root, { recursive: true, force: true });
      }
    };
    try {
      // 대조: 차단 목록이 비어 있으면 같은 명령이 프록시를 거쳐 서버에 닿는다
      expect(await codeWith([])).toBe("200");
      await waitForConnections(connections, 1);
      expect(connections).toEqual(["open"]);

      // 목록에 넣으면 프록시가 거부한다. 서버에는 연결이 늘지 않는다
      expect(await codeWith(["127.0.0.1"])).toBe("403");
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      expect(connections).toEqual(["open"]);
    } finally {
      listener.stop(true);
    }
  });
});
