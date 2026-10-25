import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { attempt } from "@xeon/contracts";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { callingModels } from "../fixtures/call-tape.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { toolResultTexts } from "../fixtures/tool-results.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// G2-02 (int), HS-76: 데스크톱 사이드카의 작업 디렉터리는 홈이다. 사용자가 고른 폴더(대화의 작업 폴더)의 `.mcp.json`이 읽히고, 신뢰 판정도
// 그 폴더로 한다. 엔진의 작업 디렉터리에 `.mcp.json`이 있어도 대화의 폴더가 아니면 읽지 않는다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const SERVER = join(import.meta.dir, "..", "fixtures", "mcp-stdio-server.ts");

function isAlive(pid: number): boolean {
  return attempt(() => process.kill(pid, 0)).ok;
}

async function until(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- 폴링
    await Bun.sleep(20);
  }
  return condition();
}

function writeMcpJson(dir: string, name: string, pidFile: string, listedFile: string): void {
  writeFileSync(
    join(dir, ".mcp.json"),
    JSON.stringify({
      mcpServers: { [name]: { command: process.execPath, args: [SERVER, pidFile, listedFile] } },
    }),
  );
}

realTest(
  "the .mcp.json of the thread's own folder is read after the folder is trusted, not the one in the engine's working directory",
  async () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "xeon-mcp-ws-")));
    const engineCwd = join(base, "engine-cwd");
    const projectDir = join(base, "project");
    mkdirSync(engineCwd);
    mkdirSync(projectDir);
    const decoyPid = join(base, "decoy.pid");
    const projectPid = join(base, "project.pid");
    const projectListed = join(base, "project.listed");
    // 엔진의 작업 디렉터리에도 서버가 있다: 대화의 폴더가 아니므로 시작하면 안 된다
    writeMcpJson(engineCwd, "decoy", decoyPid, join(base, "decoy.listed"));
    writeMcpJson(projectDir, "projsrv", projectPid, projectListed);
    const home = useEngineHome();
    writeUserSettings(home, {
      ...TAPE_SETTINGS,
      // 서버 도구는 기본이 승인을 묻는다. 이 시험은 읽는 폴더와 호출 경로를 본다
      "l2.mcp.approvalMode": "auto",
      "l0.sandbox.enabled": false,
    });
    const previousCwd = process.cwd();
    process.chdir(engineCwd);
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: callingModels("mcp-ws", [{ name: "stdio_marker", args: {} }], "done.", [
        "untrusted turn.",
        "warmed up.",
      ]),
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    try {
      const created = await connection.request("thread.create", { workspace: projectDir });
      const turnDone = async (input: string): Promise<void> => {
        const started = await startTurnWhenIdle(connection, { threadId: created.threadId, input });
        await collector.waitFor(
          (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
        );
      };

      // 신뢰하기 전에는 폴더의 서버를 띄우지 않는다
      await turnDone("before trust");
      expect(existsSync(projectPid)).toBe(false);
      expect(existsSync(decoyPid)).toBe(false);

      // 사용자가 폴더를 신뢰한다. 다음 단계 경계에 그 폴더의 정의를 읽어 서버를 띄운다
      await connection.request("trust.decide", {
        workspace: projectDir,
        choice: { kind: "folder", verdict: "allow" },
      });
      await turnDone("after trust");
      expect(await until(() => existsSync(projectListed), 10_000)).toBe(true);
      const pid = Number(readFileSync(projectPid, "utf8"));
      expect(isAlive(pid)).toBe(true);
      await turnDone("call it");
      expect(toolResultTexts(collector.events).join("\n")).toContain("marker-from-stdio");
      // 엔진의 작업 디렉터리에 있던 서버는 한 번도 뜨지 않았다
      expect(existsSync(decoyPid)).toBe(false);

      await connection.close();
      await host.close();
      expect(await until(() => !isAlive(pid), 8000)).toBe(true);
    } finally {
      process.chdir(previousCwd);
      rmSync(base, { recursive: true, force: true });
      home.dispose();
    }
  },
  60_000,
);
