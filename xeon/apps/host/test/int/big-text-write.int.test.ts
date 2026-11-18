import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { JsonObject } from "@fresnel/contracts/conversation";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@fresnel/core-models/testing";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// AGE-61: 한 줄짜리 거대 텍스트를 `write` 도구로 쓰면 끝나지 않던 결함의 실제 엔진 시험.
// 원인은 두 곳의 제곱 시간이었다(비밀 가림의 접속 정보 패턴, 화면 가림의 파트 누적). 쓰기 자체와 변경 기록은 길이에 비례한다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const MIB = 1024 * 1024;

async function writeBigText(mib: number, limitMs: number): Promise<void> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "xh-bigtext-")));
  const home = useEngineHome();
  writeUserSettings(home, { ...TAPE_SETTINGS, "l1.tools.permissionMode": "bypass" });
  const content = "y".repeat(mib * MIB);
  const args = { path: "big.txt", content } satisfies JsonObject;
  const models = tapeBuildModels(
    tapeProvider(
      tapePlayer(
        tape(`big-text-${String(mib)}`, [
          {
            role: "main" as const,
            label: "write",
            response: {
              type: "message" as const,
              content: [t.toolCall("write", args, "call_1_1")],
              stopReason: "toolUse" as const,
            },
          },
          {
            role: "main" as const,
            label: "answer",
            response: {
              type: "message" as const,
              content: [t.text("done.")],
              stopReason: "stop" as const,
            },
          },
        ]),
        { clock: realTapeClock() },
      ),
    ),
  );
  const host = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    buildModels: models,
  });
  const connection = createHostConnection(host.client);
  try {
    await connection.request("host.hello", HELLO_PARAMS);
    const events = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    const created = await connection.request("thread.create", { workspace: dir });
    const started = Date.now();
    const turn = await startTurnWhenIdle(connection, { threadId: created.threadId, input: "big" });
    await events.waitFor(
      (event) => event.kind === "turn.completed" && event.turnId === turn.turnId,
      limitMs,
    );
    expect(Date.now() - started).toBeLessThan(limitMs);
    // 입력이 커서 변경 기록(diff) 계산을 건너뛰고 생략 표시만 남는다. 잘못된 diff는 남지 않는다
    const result = events.events.find(
      (event) =>
        event.kind === "item.recorded" && JSON.stringify(event.payload).includes("toolResult"),
    );
    expect(result).toBeDefined();
    const recorded = JSON.stringify(result?.payload);
    expect(recorded).toContain('"diffOmitted":"too_large"');
    expect(recorded.length).toBeLessThan(64 * 1024);
    expect(statSync(join(dir, "big.txt")).size).toBe(mib * MIB);
    expect(readFileSync(join(dir, "big.txt"), "utf8") === content).toBe(true);
  } finally {
    await connection.close();
    await host.close();
    home.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
}

realTest(
  "a 17 MiB single-line text write finishes in time and the file holds every byte",
  () => writeBigText(17, 60_000),
  90_000,
);

realTest(
  "a 100 MiB single-line text write finishes in time and the file holds every byte",
  () => writeBigText(100, 120_000),
  150_000,
);
