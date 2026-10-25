import { expect, test } from "bun:test";
import { renderTaskList } from "@xeon/contracts/capabilities";
import { WireError } from "@xeon/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// G1-01 (int): 실제 엔진에 등록된 슬래시 명령(cap-work의 /plan, /tasks)을 wire로 읽고 실행한다.
// 사람이 쓰는 클라이언트가 /plan, /tasks를 부를 수 있어야 계획과 작업 목록 산출물을 만들 수 있다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

realTest(
  "command.list shows /plan and /tasks, and command.run executes them for a thread",
  async () => {
    const home = useEngineHome();
    const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    try {
      const listed = await connection.request("command.list", {});
      const plan = listed.commands.find((command) => command.name === "plan");
      expect(plan).toMatchObject({ kind: "action", source: "capability", origin: "cap-work" });
      expect(listed.commands.find((command) => command.name === "tasks")).toMatchObject({
        kind: "action",
        origin: "cap-work",
      });
      const filtered = await connection.request("command.list", { prefix: "ta" });
      expect(filtered.commands.map((command) => command.name)).toEqual(["tasks"]);

      const created = await connection.request("thread.create", {});
      const emptyList = renderTaskList({ tasks: [], created: [] }).content[0];
      const tasks = await connection.request("command.run", {
        threadId: created.threadId,
        text: "/tasks",
      });
      expect(tasks).toMatchObject({ status: "done", name: "tasks" });
      expect(tasks.status === "done" ? tasks.message : null).toBe(
        emptyList?.type === "text" ? emptyList.text : "(작업 없음)",
      );

      const started = await connection.request("command.run", {
        threadId: created.threadId,
        text: "/plan",
      });
      expect(started).toMatchObject({ status: "done", name: "plan" });
      expect(started.status === "done" ? started.message : "").toContain(
        "계획 모드를 시작했습니다",
      );

      const usage = await connection.request("command.run", {
        threadId: created.threadId,
        text: "/plan nonsense",
      });
      expect(usage.status === "done" ? usage.message : "").toContain("사용법");

      // 명령이 아닌 줄과 모르는 명령은 클라이언트가 turn.start로 보낼 입력이다
      expect(
        await connection.request("command.run", { threadId: created.threadId, text: "hello" }),
      ).toEqual({ status: "not_command" });
      expect(
        await connection.request("command.run", {
          threadId: created.threadId,
          text: "/no-such-command",
        }),
      ).toEqual({ status: "not_command" });
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  30_000,
);

realTest(
  "command.run on a thread that does not exist is thread.notFound",
  async () => {
    const home = useEngineHome();
    const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    try {
      const created = await connection.request("thread.create", {});
      await connection.request("thread.delete", { threadId: created.threadId });
      const caught = await rejectionOf(
        connection.request("command.run", { threadId: created.threadId, text: "/tasks" }),
      );
      expect(caught).toBeInstanceOf(WireError);
      if (caught instanceof WireError) expect(caught.code).toBe(3001);
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  30_000,
);
