import { expect, test } from "bun:test";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@xeon/core-models/testing";
import type { JsonObject } from "@xeon/contracts/conversation";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// B2-ART (int): 산출물 레지스트리 도구(artifact_create)와 세션 이름 도구(session_rename, 설정으로 켠다)가 호스트 조립에서 모델에 보이고 동작한다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

function call(name: string, args: JsonObject) {
  return {
    role: "main" as const,
    label: name,
    response: {
      type: "message" as const,
      content: [t.toolCall(name, args, "call_1")],
      stopReason: "toolUse" as const,
    },
  };
}

const FINAL = {
  role: "main" as const,
  label: "final",
  response: { type: "message" as const, content: [t.text("done.")], stopReason: "stop" as const },
};

async function runTape(toolName: string, args: JsonObject, settings: Record<string, unknown>) {
  const home = useEngineHome();
  writeUserSettings(home, { ...TAPE_SETTINGS, ...settings });
  const host = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    buildModels: tapeBuildModels(
      tapeProvider(
        tapePlayer(tape("artifacts-tools", [call(toolName, args), FINAL]), {
          clock: realTapeClock(),
        }),
      ),
    ),
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
    await collector.waitFor(
      (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
    );
    const listed = await connection.request("thread.list", {});
    return { events: collector.events, threads: listed.threads, threadId: created.threadId };
  } finally {
    await connection.close();
    await host.close();
    home.dispose();
  }
}

realTest(
  "artifact_create registers a document artifact in the session",
  async () => {
    const run = await runTape(
      "artifact_create",
      { kind: "document", title: "Notes", text: "line one\nline two\n", summary: "two lines" },
      {},
    );
    const registered = run.events.filter((event) => event.kind === "artifact.registered");
    expect(registered).toHaveLength(1);
    expect(registered[0]?.payload).toMatchObject({
      kind: "document",
      title: "Notes",
      version: 1,
      producer: "model",
      meta: { summary: "two lines", preview: { lines: 2 } },
    });
  },
  60_000,
);

realTest(
  "session_rename is advertised only when l2.artifacts.tools.sessionRename is on and renames the session",
  async () => {
    const run = await runTape(
      "session_rename",
      { title: "Renamed by the model" },
      { "l2.artifacts.tools.sessionRename": true },
    );
    expect(run.threads.map((row) => [row.threadId, row.title])).toEqual([
      [run.threadId, "Renamed by the model"],
    ]);
  },
  60_000,
);
