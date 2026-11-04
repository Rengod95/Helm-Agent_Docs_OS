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
import type { ThreadId } from "@fresnel/contracts/conversation";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { sequencedModels } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle, until } from "../fixtures/wire-client.ts";

// X.operations §4.7.6 신뢰 게이트를 실제 조립과 실제 자식 프로세스로 시험한다. 작업 폴더의 `.fresnel/settings.json`과
// `.fresnel/settings.local.json`에 든 외부 훅은 폴더 신뢰가 `allow`가 되기 전에는 자식 프로세스를 시작하지 않는다.
// 신뢰는 wire `trust.decide`(저장 파일 `trust.json`)로 정한다. 호스트에서 `thread.trust.before`는 발화되지 않는다
// (apps/host/src/assembly/trust.ts의 emitProjectTrust는 빈 함수다), 그래서 그 지점은 이 시험의 경로가 아니다.
// 표식 파일은 훅이 실제로 돌았을 때만 생기므로 그 부재로 "돌지 않았음"을 본다. 같은 훅이 신뢰 뒤에는 도는지를 대조로 함께 확인한다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const POINT = "input.user.before";
const WS_HOOK = "ws-gate";
const LOCAL_HOOK = "local-gate";

/** 훅 스크립트. 표식 경로(argv[2])에 훅 id를 쓰고 빈 결정(`{}`)을 낸다 */
function markerScript(dir: string): string[] {
  const path = join(dir, "mark.ts");
  writeFileSync(
    path,
    `import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2] ?? "", process.env["FRESNEL_HOOK_ID"] ?? "");
console.log("{}");`,
  );
  return [process.execPath, path];
}

/** 이 thread의 turn.completed가 `count`개 모일 때까지 기다린다. 턴이 끝났다는 것은 그 턴의 훅이 모두 돌았다는 뜻이다 */
async function waitForTurns(
  events: ReturnType<typeof collectEvents>,
  threadId: ThreadId,
  count: number,
): Promise<void> {
  const completed = (): number =>
    events.events.filter((event) => event.kind === "turn.completed" && event.threadId === threadId)
      .length;
  expect(await until(() => completed() >= count, 20_000)).toBe(true);
}

realTest(
  "a work folder's external hooks never start until the folder is trusted; allow runs the same hooks at the next turn",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const scratch = mkdtempSync(join(tmpdir(), "xh-trust-scratch-"));
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-trust-ws-")));
    const wsMarker = join(scratch, "ws-marker.txt");
    const localMarker = join(scratch, "local-marker.txt");
    const argv = markerScript(scratch);
    mkdirSync(join(workspace, ".fresnel"));
    writeFileSync(
      join(workspace, ".fresnel", "settings.json"),
      JSON.stringify({
        "x.operations.hookDefs": [{ id: WS_HOOK, point: POINT, command: [...argv, wsMarker] }],
      }),
    );
    writeFileSync(
      join(workspace, ".fresnel", "settings.local.json"),
      JSON.stringify({
        "x.operations.hookDefs": [
          { id: LOCAL_HOOK, point: POINT, command: [...argv, localMarker] },
        ],
      }),
    );

    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: sequencedModels("external-hooks-trust", ["하나.", "둘.", "셋."]),
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    try {
      const events = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });
      const { threadId } = await connection.request("thread.create", { workspace });
      expect(await connection.request("trust.get", { workspace })).toMatchObject({
        verdict: "undecided",
        via: "headless",
      });

      // 결정이 없는 폴더: 턴을 돌려도 두 범위의 훅은 자식 프로세스를 시작하지 않는다
      await startTurnWhenIdle(connection, { threadId, input: "첫 질문" });
      await waitForTurns(events, threadId, 1);
      expect(existsSync(wsMarker)).toBe(false);
      expect(existsSync(localMarker)).toBe(false);

      // 명시한 거부: 같은 결과다
      expect(
        await connection.request("trust.decide", {
          workspace,
          choice: { kind: "folder", verdict: "deny" },
        }),
      ).toMatchObject({ verdict: "deny", via: "store" });
      await startTurnWhenIdle(connection, { threadId, input: "둘째 질문" });
      await waitForTurns(events, threadId, 2);
      expect(existsSync(wsMarker)).toBe(false);
      expect(existsSync(localMarker)).toBe(false);

      // 폴더를 신뢰하면 같은 훅이 다음 턴부터 돈다(대조): 표식에 훅 id가 그대로 남는다
      expect(
        await connection.request("trust.decide", {
          workspace,
          choice: { kind: "folder", verdict: "allow" },
        }),
      ).toMatchObject({ verdict: "allow", via: "store" });
      await startTurnWhenIdle(connection, { threadId, input: "셋째 질문" });
      await waitForTurns(events, threadId, 3);
      expect(readFileSync(wsMarker, "utf8")).toBe(WS_HOOK);
      expect(readFileSync(localMarker, "utf8")).toBe(LOCAL_HOOK);

      // 신뢰를 거두면 다음 턴부터 다시 돌지 않는다: 표식을 지우고 턴을 돌려 부재를 본다
      rmSync(wsMarker);
      rmSync(localMarker);
      expect(
        await connection.request("trust.decide", {
          workspace,
          choice: { kind: "folder", verdict: "deny" },
        }),
      ).toMatchObject({ verdict: "deny", via: "store" });
      await startTurnWhenIdle(connection, { threadId, input: "넷째 질문" });
      await waitForTurns(events, threadId, 4);
      expect(existsSync(wsMarker)).toBe(false);
      expect(existsSync(localMarker)).toBe(false);
    } finally {
      await connection.close();
      await host.close();
      rmSync(workspace, { recursive: true, force: true });
      rmSync(scratch, { recursive: true, force: true });
      home.dispose();
    }
  },
  60_000,
);
