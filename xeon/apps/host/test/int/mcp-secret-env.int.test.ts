import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attempt } from "@xeon/contracts";
import { parseSecretRef, type SecretMeta } from "@xeon/contracts/capabilities";
import type { JsonObject } from "@xeon/contracts/conversation";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@xeon/core-models/testing";
import { memorySecrets } from "@xeon/platform-secrets/testing";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { toolResultTexts } from "../fixtures/tool-results.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// M3-05, M3-REQ-75 (B3-SEC 끝 시험). 비밀 env를 쓰는 stdio MCP 서버는 사용자의 기동 승인 한 번 뒤에 뜬다. 승인 전에는 프로세스가 없고,
// 서버 정의가 바뀌면 정의 해시가 달라져 다시 승인을 받아야 뜬다. 승인 레코드(approval.requested)에 정의 해시가 실린다.
// 비밀 서비스만 메모리 대역(sops 없음)이고 정책 판정, lease, 감사 기록은 운영 구현이다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const SERVER = join(import.meta.dir, "..", "fixtures", "mcp-stdio-server.ts");
const REF = "secret://github-token";
const SECRET_VALUE = "xeon-fake-token-mcp-9c41e7a0b2d35f68";
const parsed = parseSecretRef(REF);
if (!parsed.ok) throw new Error("fixture secret reference is invalid");
const SECRET_NAME = parsed.value.name;

function metaOf(): SecretMeta {
  return {
    name: SECRET_NAME,
    desc: "GitHub token for the MCP start approval test",
    provider: "sops",
    ref: "dev/GITHUB_TOKEN",
    scope: "user",
    expiresAt: null,
    use: { modes: ["env"], tools: ["mcp.start:*"], hosts: [], commands: ["mcp:sec"] },
    approval: "per-session",
    ttlSeconds: 900,
    maxUses: 50,
  };
}

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

const text = (content: string) => ({
  type: "message" as const,
  content: [t.text(content)],
  stopReason: "stop" as const,
});
const call = (id: string) => ({
  type: "message" as const,
  content: [t.toolCall("stdio_marker", {} satisfies JsonObject, id)],
  stopReason: "toolUse" as const,
});
const main = (label: string, response: ReturnType<typeof text> | ReturnType<typeof call>) => ({
  role: "main" as const,
  label,
  response,
});

realTest(
  "a secret-env server starts after one approval, and a changed definition asks again",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "xeon-mcp-secret-"));
    const pidFile = join(dir, "server.pid");
    const listedFile = join(dir, "listed");
    const home = useEngineHome();
    const definition = (logLevel: string) => ({
      transport: {
        type: "stdio",
        command: process.execPath,
        args: [SERVER, pidFile, listedFile],
        env: { GH_TOKEN: REF, LOG_LEVEL: logLevel },
      },
    });
    writeUserSettings(home, {
      ...TAPE_SETTINGS,
      "l2.mcp.servers": { sec: definition("info") },
      "l2.mcp.approvalMode": "auto",
    });
    const holder: { secrets: ReturnType<typeof memorySecrets> | undefined } = {
      secrets: undefined,
    };
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: tapeBuildModels(
        tapeProvider(
          tapePlayer(
            tape("mcp-secret-env", [
              main("warm up", text("warm.")),
              main("first call", call("call_1")),
              main("first done", text("done one.")),
              main("after change", text("changed.")),
              main("settle", text("settled.")),
              main("second call", call("call_2")),
              main("second done", text("done two.")),
            ]),
            { clock: realTapeClock() },
          ),
        ),
      ),
      secretsRuntime: (deps) => {
        const secrets = memorySecrets({
          clock: deps.os.time.clock,
          scheduler: deps.os.time.scheduler,
          ids: deps.ids,
          secrets: [{ meta: metaOf(), value: SECRET_VALUE }],
        });
        holder.secrets = secrets;
        return { service: secrets, admin: secrets.admin };
      },
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    const created = await connection.request("thread.create", {});
    const runTurn = async (input: string): Promise<void> => {
      const started = await startTurnWhenIdle(connection, { threadId: created.threadId, input });
      await collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
      );
    };

    // 1. 첫 turn: 서버는 승인을 기다린다. 승인 레코드에 정의 해시가 있고 프로세스는 뜨지 않았다
    await runTurn("warm up");
    const first = await collector.waitFor((event) => event.kind === "approval.requested");
    const firstBody = JSON.stringify(first.payload);
    expect(firstBody).toContain("mcp_start");
    expect(firstBody).toContain("definitionHash");
    expect(firstBody).toContain(REF);
    expect(firstBody).not.toContain(SECRET_VALUE);
    expect(existsSync(pidFile)).toBe(false);

    // 2. 승인 한 번: 서버가 뜨고 도구가 비밀 env와 평문 env를 받은 채 돈다
    expect(
      await connection.request("approval.respond", { approvalId: first.id, decision: "allow" }),
    ).toEqual({ applied: true });
    expect(await until(() => existsSync(listedFile), 10_000)).toBe(true);
    const firstPid = Number(readFileSync(pidFile, "utf8"));
    expect(isAlive(firstPid)).toBe(true);
    await runTurn("call it");
    expect(toolResultTexts(collector.events).join("\n")).toContain(
      "marker-from-stdio token=present log=info",
    );
    const approvedRecords = holder.secrets
      ?.auditRecords()
      .filter((r) => r.type === "secret.approved");
    expect(approvedRecords).toMatchObject([
      { handle: REF, scope: "per-session", approvalId: first.id },
    ]);
    // 값은 와이어 어디에도 나오지 않는다
    expect(JSON.stringify(collector.events)).not.toContain(SECRET_VALUE);

    // 3. 정의를 바꾸면 해시가 달라져 서버가 내려가고 다시 승인을 받아야 뜬다
    await connection.request("settings.set", {
      key: "l2.mcp.servers",
      value: { sec: definition("debug") },
      scope: "user",
    });
    await runTurn("after the change");
    const second = await collector.waitFor(
      (event) => event.kind === "approval.requested" && event.id !== first.id,
    );
    expect(second.id).not.toBe(first.id);
    expect(JSON.stringify(second.payload)).not.toBe(firstBody);
    expect(await until(() => !isAlive(firstPid), 8000)).toBe(true);
    expect(Number(readFileSync(pidFile, "utf8"))).toBe(firstPid);

    expect(
      await connection.request("approval.respond", { approvalId: second.id, decision: "allow" }),
    ).toEqual({ applied: true });
    expect(await until(() => Number(readFileSync(pidFile, "utf8")) !== firstPid, 10_000)).toBe(
      true,
    );
    // 연결이 끝난 서버의 도구는 다음 단계 경계에 도구 표에 오른다
    await runTurn("settle");
    await runTurn("call it again");
    expect(toolResultTexts(collector.events).join("\n")).toContain(
      "marker-from-stdio token=present log=debug",
    );

    await connection.close();
    await host.close();
    home.dispose();
    rmSync(dir, { recursive: true, force: true });
  },
  60_000,
);
