import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attempt } from "@xeon/contracts";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { callingModels } from "../fixtures/call-tape.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { toolResultTexts } from "../fixtures/tool-results.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// HOST.6 cap-mcp (int), 결정 D6, E6 stdio: 설정에 적은 stdio MCP 서버를 사용자 권한 자식 프로세스로 띄우고(L0 platform-process의
// McpProcessPort), 서버가 광고한 도구가 도구 표에 올라 모델이 부를 수 있다. 엔진을 닫으면 서버 프로세스가 남지 않는다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const SERVER = join(import.meta.dir, "..", "fixtures", "mcp-stdio-server.ts");

function isAlive(pid: number): boolean {
  return attempt(() => process.kill(pid, 0)).ok;
}

async function until(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    // eslint-disable-next-line no-await-in-loop -- 폴링
    await Bun.sleep(20);
  }
  return condition();
}

realTest(
  "a configured stdio server is spawned, its tool is callable, and no process is left after close",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "xeon-mcp-stdio-"));
    const pidFile = join(dir, "server.pid");
    const listedFile = join(dir, "listed");
    const home = useEngineHome();
    writeUserSettings(home, {
      ...TAPE_SETTINGS,
      "l2.mcp.servers": {
        stdiofix: {
          transport: {
            type: "stdio",
            command: process.execPath,
            args: [SERVER, pidFile, listedFile],
          },
        },
      },
      // 서버 도구는 기본이 승인을 묻는다. 이 시험은 호출 경로를 본다
      "l2.mcp.approvalMode": "auto",
    });
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: callingModels("mcp-stdio", [{ name: "stdio_marker", args: {} }], "done.", [
        "warmed up.",
      ]),
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    const created = await connection.request("thread.create", {});
    // 연결은 세션 시작을 막지 않는다. 서버가 도구 목록을 내준 뒤 한 turn을 돌리면 도구가 다음 turn_start에 도구 표에 오른다
    expect(await until(() => existsSync(listedFile), 10_000)).toBe(true);
    await connection.request("turn.start", { threadId: created.threadId, input: "warm up" });
    await collector.waitFor((event) => event.kind === "turn.completed");
    expect(existsSync(pidFile)).toBe(true);
    const pid = Number(readFileSync(pidFile, "utf8"));
    expect(isAlive(pid)).toBe(true);
    const second = await startTurnWhenIdle(connection, {
      threadId: created.threadId,
      input: "call it",
    });
    await collector.waitFor(
      (event) => event.kind === "turn.completed" && event.turnId === second.turnId,
    );
    expect(toolResultTexts(collector.events).join("\n")).toContain("marker-from-stdio");
    await connection.close();
    await host.close();
    expect(await until(() => !isAlive(pid), 8000)).toBe(true);
    home.dispose();
    rmSync(dir, { recursive: true, force: true });
  },
  40_000,
);
