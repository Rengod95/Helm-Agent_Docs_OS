import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { callingModels, type ToolStep } from "../fixtures/call-tape.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { toolResultTexts } from "../fixtures/tool-results.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// [제안, AGE-63] (int, 실제 엔진, 임시 홈): 모델이 `sandbox_protect`로 더한 폴더는 설정 파일의 사용자 목록에 적히고, 같은 턴의
// 다음 셸 호출이 그 안의 파일을 읽지도 쓰지도 못한다. 더하기 전에는 같은 명령이 읽는다(대조). 모든 파일은 임시 엔진 홈 안에 있다.
// 권한 모드는 bypass로 둔다. 셸은 실제 샌드박스에서 돈다.
// 주의: 보호된 폴더를 읽는 셸 호출은 "작업 폴더 밖 쓰기" 승인 질문도 낸다(core-workspace run.ts의 쓰기 허용 흐름이
// "Operation not permitted" 문구에 반응한다). 시험은 그 질문을 거부로 답한다. 이 흐름의 문제는 보고서의 미결 사항이다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const SECRET = "fake-vault-value-for-protect-int";
const TURN_WAIT_MS = 150_000;

realTest(
  "a folder added by sandbox_protect is written to the user list, and the next shell call in the same turn cannot read or write it",
  async () => {
    const home = useEngineHome();
    const vault = join(home.root, "vault");
    const secretPath = join(vault, "secret.txt");
    mkdirSync(vault, { recursive: true });
    writeFileSync(secretPath, SECRET);
    writeUserSettings(home, { ...TAPE_SETTINGS, "l1.tools.permissionMode": "bypass" });
    const steps: readonly ToolStep[] = [
      { name: "bash", args: { command: `cat '${secretPath}'` } },
      { name: "sandbox_protect", args: { paths: [vault] } },
      { name: "bash", args: { command: `cat '${secretPath}'` } },
      { name: "bash", args: { command: `echo changed >> '${secretPath}'` } },
      { name: "sandbox_protect", args: { paths: [`${vault}/`] } },
    ];
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: callingModels("sandbox-protect", steps, "done."),
    });
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });
      const created = await connection.request("thread.create", {});
      const started = await startTurnWhenIdle(connection, {
        threadId: created.threadId,
        input: "protect the vault folder",
      });
      // 턴이 끝날 때까지 나오는 승인 질문은 거부로 답한다(위 주의 참고). 기다리는 것은 승인 질문 하나 또는 턴의 끝이다
      const answered = new Set<string>();
      const answerUntilDone = (): Promise<void> =>
        collector
          .waitFor(
            (event) =>
              (event.kind === "approval.requested" && !answered.has(event.id)) ||
              (event.kind === "turn.completed" && event.turnId === started.turnId),
            TURN_WAIT_MS,
          )
          .then((event) => {
            if (event.kind === "turn.completed") return undefined;
            answered.add(event.id);
            return connection
              .request("approval.respond", { approvalId: event.id, decision: "deny" })
              .then(() => answerUntilDone());
          });
      await answerUntilDone();

      const texts = toolResultTexts(collector.events, 4000);
      expect(texts).toHaveLength(5);
      const [beforeRead, protectFirst, afterRead, afterWrite, protectAgain] = texts;
      // (대조) 더하기 전에는 같은 명령이 읽는다
      expect(beforeRead).toContain(SECRET);
      expect(beforeRead).toContain('"isError":false');
      // 더하기 결과는 추가된 경로와 적용 시점을 말한다
      expect(protectFirst).toContain("Added: ");
      expect(protectFirst).toContain(
        "Blocked for reading and writing from the next shell or file call",
      );
      // 같은 턴의 다음 셸 호출은 읽지 못한다. 출력에 값이 없고 실패한다
      expect(afterRead).toContain('"isError":true');
      expect(afterRead).not.toContain(SECRET);
      // 거부 문구는 셸이 낸 "Operation not permitted"다(샌드박스 위반 설명 줄은 시점에 따라 붙어서 단언하지 않는다)
      expect(afterRead).toContain("Operation not permitted");
      // 쓰기도 막힌다. 파일 내용은 그대로다
      expect(afterWrite).toContain('"isError":true');
      expect(afterWrite).toContain("Operation not permitted");
      expect(readFileSync(secretPath, "utf8")).toBe(SECRET);
      // 같은 경로를 다시 더하면 이미 보호 중이라 아무것도 더하지 않는다
      expect(protectAgain).toContain("Nothing new was added");
      expect(protectAgain).toContain("Already protected: ");

      // 사용자 범위 파일에 한 번 적혔다(중복 없음), 다른 키는 그대로다
      const stored = userFile(join(home.root, "config", "settings.json"));
      expect(stored["l0.sandbox.protectedPaths.extra"]).toEqual([vault]);
      expect(stored["l1.tools.permissionMode"]).toBe("bypass");
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  180_000,
);

function userFile(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null) throw new Error("expected an object");
  return Object.fromEntries(Object.entries(parsed));
}
