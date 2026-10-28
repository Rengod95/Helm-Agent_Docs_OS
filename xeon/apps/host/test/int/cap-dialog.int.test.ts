import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { callingModels } from "../fixtures/call-tape.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { toolResultTexts } from "../fixtures/tool-results.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// HOST.6 cap-dialog (int): ask_user가 도구로 광고되고, 질문 승인(kind question)이 approval.requested로 나오며,
// 정본 모양(QuestionAnswer)으로 답하면 같은 도구 호출이 답을 받아 이어진다(D5의 입력 대기 재호출 경로).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

realTest(
  "ask_user raises a question approval; the answer in the canonical shape reaches the model",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: callingModels("dialog", [
        {
          name: "ask_user",
          args: {
            questions: [
              {
                id: "color",
                question: "Which color?",
                options: [
                  { id: "red", label: "Red" },
                  { id: "blue", label: "Blue", recommended: true },
                ],
              },
            ],
          },
        },
      ]),
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    const created = await connection.request("thread.create", {});
    await connection.request("turn.start", { threadId: created.threadId, input: "pick" });

    const asked = await collector.waitFor((event) => event.kind === "approval.requested");
    const listed = await connection.request("approval.list", { threadId: created.threadId });
    expect(listed.approvals).toHaveLength(1);
    expect(listed.approvals[0]?.request.body.kind).toBe("question");
    // 질문 id → { selected, text? }. 클라이언트는 QuestionBody를 그리고 이 모양으로 답한다
    const answered = await connection.request("approval.respond", {
      approvalId: asked.id,
      decision: "answer",
      answer: { color: { selected: ["blue"] } },
    });
    expect(answered).toEqual({ applied: true });
    const done = await collector.waitFor((event) => event.kind === "turn.completed");
    expect(done.payload).toMatchObject({ status: "completed" });
    expect(toolResultTexts(collector.events).join("\n")).toContain("blue");
    await connection.close();
    await host.close();
    home.dispose();
  },
  30_000,
);
