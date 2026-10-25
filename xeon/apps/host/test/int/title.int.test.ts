import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { answeringModels } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// G2-12 (int): 목록이 모두 "제목 없음"이던 문제. 첫 입력 80자가 제목이 되고, thread.rename이 제목을 바꾸며 목록과 이벤트에 반영된다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

realTest(
  "the first input titles the thread in the list, and thread.rename replaces the title",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: answeringModels("title", "done."),
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    try {
      const created = await connection.request("thread.create", {});
      const question = `이 저장소의 빌드가 왜 느린지\n알려 줘 ${"자세히 ".repeat(40)}`;
      await connection.request("turn.start", { threadId: created.threadId, input: question });
      await collector.waitFor((event) => event.kind === "turn.completed");
      const titled = (await connection.request("thread.list", {})).threads.find(
        (row) => row.threadId === created.threadId,
      );
      const expected = Array.from(question.replaceAll(/\s+/gu, " ").trim()).slice(0, 80).join("");
      expect(titled?.title).toBe(expected.trimEnd());
      expect(Array.from(titled?.title ?? "").length).toBeLessThanOrEqual(80);

      const renamed = await connection.request("thread.rename", {
        threadId: created.threadId,
        title: "빌드 속도 조사",
      });
      const updated = await collector.waitFor(
        (event) => event.kind === "thread.updated" && event.seq === renamed.position.seq,
      );
      expect(updated.payload).toMatchObject({ title: "빌드 속도 조사" });
      const after = (await connection.request("thread.list", {})).threads.find(
        (row) => row.threadId === created.threadId,
      );
      expect(after?.title).toBe("빌드 속도 조사");
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  30_000,
);

realTest(
  "a thread created with a title keeps it when the first input arrives",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: answeringModels("title-kept", "done."),
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    try {
      const created = await connection.request("thread.create", { title: "내가 정한 제목" });
      await connection.request("turn.start", { threadId: created.threadId, input: "질문" });
      await collector.waitFor((event) => event.kind === "turn.completed");
      const row = (await connection.request("thread.list", {})).threads.find(
        (entry) => entry.threadId === created.threadId,
      );
      expect(row?.title).toBe("내가 정한 제목");
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  30_000,
);
