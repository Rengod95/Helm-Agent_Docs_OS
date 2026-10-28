import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

realTest(
  "a project command file of the thread's folder runs only after the folder is trusted",
  async () => {
    const home = useEngineHome();
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-cmd-")));
    mkdirSync(join(workspace, ".xeon", "commands"), { recursive: true });
    writeFileSync(
      join(workspace, ".xeon", "commands", "hello.md"),
      "---\ndescription: greet\n---\nHello $ARGUMENTS\n",
    );
    const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    try {
      const created = await connection.request("thread.create", { workspace });
      // 신뢰하기 전에는 프로젝트 명령 파일을 읽지 않는다(fail-closed)
      expect(
        await connection.request("command.run", { threadId: created.threadId, text: "/hello Ada" }),
      ).toEqual({ status: "not_command" });
      await connection.request("trust.decide", {
        workspace,
        choice: { kind: "folder", verdict: "allow" },
      });
      expect(
        await connection.request("command.run", { threadId: created.threadId, text: "/hello Ada" }),
      ).toEqual({ status: "expanded", name: "hello", text: "Hello Ada" });
    } finally {
      await connection.close();
      await host.close();
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    }
  },
  30_000,
);

realTest(
  "command.list with a threadId shows the project commands of that thread's folder once it is trusted",
  async () => {
    const home = useEngineHome();
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-cmdlist-")));
    mkdirSync(join(workspace, ".xeon", "commands"), { recursive: true });
    writeFileSync(
      join(workspace, ".xeon", "commands", "hello.md"),
      "---\ndescription: greet\n---\nHello $ARGUMENTS\n",
    );
    const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    try {
      const created = await connection.request("thread.create", { workspace });
      const namesOf = async (params: { readonly threadId?: typeof created.threadId }) =>
        (await connection.request("command.list", params)).commands.map((command) => command.name);
      // 신뢰하기 전에는 그 폴더의 명령 파일을 읽지 않는다
      expect(await namesOf({ threadId: created.threadId })).not.toContain("hello");
      await connection.request("trust.decide", {
        workspace,
        choice: { kind: "folder", verdict: "allow" },
      });
      expect(await namesOf({ threadId: created.threadId })).toContain("hello");
      // thread 문맥이 없으면 엔진의 기본 작업 폴더 기준이라 이 폴더의 명령이 없다
      expect(await namesOf({})).not.toContain("hello");
      // 목록만 읽으므로 쓰기 소유를 새로 얻지 않는다: 지운 thread는 3001이다
      await connection.request("thread.delete", { threadId: created.threadId });
      const caught = await rejectionOf(
        connection.request("command.list", { threadId: created.threadId }),
      );
      expect(caught).toBeInstanceOf(WireError);
      if (caught instanceof WireError) expect(caught.code).toBe(3001);
    } finally {
      await connection.close();
      await host.close();
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    }
  },
  30_000,
);
