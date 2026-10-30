import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { callingModels } from "../fixtures/call-tape.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { toolResultTexts } from "../fixtures/tool-results.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// M3b B1-SCH2 (int): 예약 플러그인이 올린 도구 `schedule_create`가 조립된 호스트의 도구 목록에 있다. 모델이 부르면 실행 등급 exec로
// 승인을 기다리고, 허용하면 항목을 만들고 거부하면 만들지 않는다. 틱은 서비스 모드에서만 돌므로 여기서는 실행하지 않는다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const CALL = { name: "schedule_create", args: { everySeconds: 300, prompt: "nightly summary" } };

/** 모델이 도구를 부르고, 승인 요청에 `decision`으로 답한 뒤 turn이 끝날 때까지 기다린다 */
async function runCall(decision: "allow" | "deny") {
  const home = useEngineHome();
  writeUserSettings(home, TAPE_SETTINGS);
  const host = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    buildModels: callingModels("schedule-tool", [CALL], "done."),
  });
  const connection = createHostConnection(host.client);
  try {
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    const created = await connection.request("thread.create", {});
    const started = await startTurnWhenIdle(connection, {
      threadId: created.threadId,
      input: "go",
    });
    const asked = await collector.waitFor((event) => event.kind === "approval.requested");
    const listed = await connection.request("approval.list", { threadId: created.threadId });
    const answered = await connection.request("approval.respond", {
      approvalId: asked.id,
      decision,
    });
    expect(answered).toEqual({ applied: true });
    await collector.waitFor(
      (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
    );
    const schedules = await connection.request("schedule.list", {});
    return { listed, texts: toolResultTexts(collector.events), schedules };
  } finally {
    await connection.close();
    await host.close();
    home.dispose();
  }
}

realTest(
  "schedule_create is offered by the assembled host as an exec tool of schedule.entries and a denial creates nothing",
  async () => {
    const run = await runCall("deny");
    expect(run.listed.approvals).toHaveLength(1);
    expect(run.listed.approvals[0]?.request.body).toMatchObject({
      kind: "tool",
      tool: {
        toolName: "schedule_create",
        risk: "exec",
        capability: { id: "schedule.entries", method: "create" },
      },
    });
    expect(run.schedules).toEqual({ ok: true, items: [] });
  },
  60_000,
);

realTest(
  "an approved schedule_create call creates the entry and the tool result names it",
  async () => {
    const run = await runCall("allow");
    if (!run.schedules.ok) throw new Error("the list failed");
    const [item] = run.schedules.items;
    if (item === undefined) throw new Error("the approved call created no entry");
    expect(run.schedules.items).toHaveLength(1);
    expect(item).toMatchObject({
      entry: {
        trigger: { kind: "interval", everySeconds: 300 },
        prompt: "nightly summary",
        enabled: true,
      },
      lastRun: null,
    });
    expect(run.texts.join("\n")).toContain(`schedule ${item.entry.id} next=`);
  },
  60_000,
);
