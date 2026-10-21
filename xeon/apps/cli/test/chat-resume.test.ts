import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { EXIT } from "../src/exit-codes.ts";
import {
  assistantItem,
  effectIntent,
  effectResult,
  toolResultItem,
  turnCompleted,
  userItem,
} from "./support/events.ts";
import type { TurnContext } from "./support/fake-server.ts";
import { createHarness, TEST_STORE_ID, waitFor, type Harness } from "./support/harness.ts";
import { storeId, threadId, turnId } from "./support/ids.ts";

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

function harness(options: Parameters<typeof createHarness>[0] = {}): Harness {
  const created = createHarness(options);
  harnesses.push(created);
  return created;
}

function answer(text: string): (context: TurnContext) => void {
  return (context) => {
    context.server.commit(context.threadId, [
      userItem(context.turnId, 1, "q"),
      assistantItem(context.turnId, 2, { text }),
      turnCompleted(context.turnId),
    ]);
  };
}

function readState(path: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return parsed;
}

test("a new session records its thread and the last seen position in the state file", async () => {
  const h = harness({ server: { onTurn: answer("first") } });
  expect(await h.run(["chat", "-p", "q"])).toBe(0);
  const state = readState(h.stateFile);
  expect(state).toEqual({
    version: 1,
    workspaces: {
      "/work/project": {
        threadId: threadId(101),
        position: { storeId: TEST_STORE_ID, seq: h.server().headSeq() },
        updatedAt: new Date(h.clock.now()).toISOString(),
      },
    },
  });
  expect(statSync(h.stateFile).mode & 0o777).toBe(0o600);
});

test("--continue reopens the last session of the working folder and prints only new events", async () => {
  const h = harness({ server: { onTurn: answer("first") } });
  await h.run(["chat", "-p", "q"]);
  const before = h.server().headSeq();
  h.stdout.length = 0;
  h.useServer({
    onTurn: (context) => {
      context.server.commit(context.threadId, [
        userItem(context.turnId, 11, "again"),
        assistantItem(context.turnId, 12, { text: "second" }),
        turnCompleted(context.turnId),
      ]);
    },
  });
  expect(await h.run(["chat", "--continue", "-p", "again"])).toBe(0);
  expect(h.stdoutText()).toBe("second\n");
  const create = h.server().requests.map((request) => request.method);
  expect(create).not.toContain("thread.create");
  const subscribe = h.server().requests.find((request) => request.method === "events.subscribe");
  expect(subscribe?.params).toMatchObject({ from: { storeId: TEST_STORE_ID, seq: before } });
  const turn = h.server().requests.find((request) => request.method === "turn.start");
  expect(turn?.params).toMatchObject({ threadId: threadId(101), input: "again" });
});

test("--continue without a state entry exits 1 with a hint", async () => {
  const h = harness();
  expect(await h.run(["chat", "--continue", "-p", "x"])).toBe(EXIT.error);
  expect(h.stderrText()).toBe(
    "xeon: 이어 열 세션이 없다\n  해결: xeon chat으로 새 세션을 시작한다\n",
  );
  expect(h.closed()).toBe(true);
});

test("--continue is unavailable when the state file location is unknown", async () => {
  const h = harness({ stateFile: false });
  expect(await h.run(["chat", "--continue", "-p", "x"])).toBe(EXIT.error);
  expect(h.stderrText()).toContain("상태 파일 위치를 알 수 없어");
});

test("a broken state file is discarded and --continue says so", async () => {
  const h = harness();
  mkdirSync(dirname(h.stateFile), { recursive: true });
  writeFileSync(h.stateFile, "{ not json");
  expect(await h.run(["chat", "--continue", "-p", "x"])).toBe(EXIT.error);
  expect(h.stderrText()).toContain("버렸다");
  expect(h.stderrText()).toContain("이어 열 세션이 없다");
});

test("--resume without a known position replays from seq 0", async () => {
  const h = harness({ server: { onTurn: answer("first") } });
  await h.run(["chat", "-p", "q"]);
  const id = threadId(101);
  const before = h.server().headSeq();
  h.stdout.length = 0;
  h.useServer({
    onTurn: (context) => {
      context.server.commit(context.threadId, [
        assistantItem(context.turnId, 21, { text: "third" }),
        turnCompleted(context.turnId),
      ]);
    },
  });
  // 상태 파일을 지운다: 위치를 모르는 --resume은 { storeId, seq: 0 }부터다
  writeFileSync(h.stateFile, JSON.stringify({ version: 1, workspaces: {} }));
  expect(await h.run(["chat", "--resume", id, "-p", "next"])).toBe(0);
  const subscribe = h.server().requests.find((request) => request.method === "events.subscribe");
  expect(subscribe?.params).toMatchObject({ from: { storeId: TEST_STORE_ID, seq: 0 } });
  expect(h.stdoutText()).toBe("first\nthird\n");
  expect(h.server().headSeq()).toBeGreaterThan(before);
});

test("--resume of an unknown thread exits 1", async () => {
  const h = harness();
  expect(await h.run(["chat", "--resume", threadId(555), "-p", "x"])).toBe(EXIT.error);
  expect(h.stderrText()).toContain("세션");
  expect(h.stderrText()).toContain("없다");
});

test("a state position from another store is sent as is and falls back to the head with a notice", async () => {
  const h = harness({ server: { onTurn: answer("first") } });
  await h.run(["chat", "-p", "q"]);
  writeFileSync(
    h.stateFile,
    JSON.stringify({
      version: 1,
      workspaces: {
        "/work/project": {
          threadId: threadId(101),
          position: { storeId: storeId(77), seq: 3 },
          updatedAt: "2026-01-05T00:00:00.000Z",
        },
      },
    }),
  );
  h.stdout.length = 0;
  h.stderr.length = 0;
  h.useServer({
    onTurn: (context) => {
      context.server.commit(context.threadId, [
        assistantItem(context.turnId, 31, { text: "fresh" }),
        turnCompleted(context.turnId),
      ]);
    },
  });
  expect(await h.run(["chat", "--continue", "-p", "x"])).toBe(0);
  expect(h.stderrText()).toContain("저장소가 바뀌어 이전 기록을 이어 받지 못했다");
  expect(h.stdoutText()).toBe("fresh\n");
  const subscribes = h.server().requests.filter((request) => request.method === "events.subscribe");
  expect(subscribes.map((request) => request.params)).toEqual([
    expect.objectContaining({ from: { storeId: storeId(77), seq: 3 } }),
    expect.objectContaining({ from: "head" }),
  ]);
});

test("a killed run resumes with only newer seqs and the recovery events (AC2)", async () => {
  const h = harness({
    server: {
      onTurn: (context) => {
        context.server.commit(context.threadId, [
          userItem(context.turnId, 1, "read it"),
          assistantItem(context.turnId, 2, { toolCallId: "call-1" }),
          effectIntent(context.turnId, {
            effect: 1,
            item: 3,
            toolCallId: "call-1",
            toolName: "read",
            args: { path: "a.txt" },
          }),
        ]);
      },
    },
  });
  const firstTurn = turnId(101);
  const running = h.run(["chat", "-p", "read it", "--json"]);
  await waitFor(() => h.stdoutText().includes("effect.intent"));
  h.signal("SIGTERM");
  expect(await running).toBe(EXIT.terminated);
  const lastSeen = h.server().headSeq();
  const first = h.stdoutText();
  h.stdout.length = 0;

  h.useServer({
    onTurn: (context) => {
      // 엔진이 열 때 쓰는 복구 기록, 이어서 새 turn
      context.server.commit(context.threadId, [
        toolResultItem(firstTurn, {
          item: 4,
          effect: 1,
          toolCallId: "call-1",
          toolName: "read",
          text: "The tool call was interrupted before its result was recorded.",
          isError: true,
        }),
        effectResult(firstTurn, { effect: 1, synthesized: true, resultItem: 4 }),
        turnCompleted(firstTurn, "interrupted"),
        userItem(context.turnId, 5, "again"),
        assistantItem(context.turnId, 6, { text: "done" }),
        turnCompleted(context.turnId),
      ]);
    },
  });
  expect(await h.run(["chat", "--continue", "-p", "again", "--json"])).toBe(0);
  const seqs = h
    .stdoutText()
    .split("\n")
    .filter((line) => line.length > 0)
    .flatMap((line): number[] => {
      const message: unknown = JSON.parse(line);
      if (typeof message !== "object" || message === null) return [];
      const params: unknown = Reflect.get(message, "params");
      const events: unknown =
        typeof params === "object" && params !== null ? Reflect.get(params, "events") : undefined;
      return Array.isArray(events)
        ? events.flatMap((event: unknown) => {
            const seq: unknown =
              typeof event === "object" && event !== null ? Reflect.get(event, "seq") : undefined;
            return typeof seq === "number" ? [seq] : [];
          })
        : [];
    });
  expect(seqs.length).toBeGreaterThan(0);
  expect(seqs.every((seq) => seq > lastSeen)).toBe(true);
  expect(new Set(seqs).size).toBe(seqs.length);
  expect(first).toContain("effect.intent");
  const turn = h.server().requests.findLast((request) => request.method === "turn.start");
  expect(turn?.params).toMatchObject({ threadId: threadId(101) });
});

test("the position is on disk before the batch is written out", async () => {
  const h = harness({
    server: {
      onTurn: (context) => {
        context.server.commit(context.threadId, [userItem(context.turnId, 1, "hello")]);
      },
    },
  });
  const running = h.run(["chat", "-p", "hello", "--json"]);
  await waitFor(() => h.stdoutText().includes("item.recorded"));
  const state = readState(h.stateFile);
  expect(JSON.stringify(state)).toContain(`"seq":${h.server().headSeq()}`);
  h.signal("SIGTERM");
  await running;
});

test("a batch with a hole makes the client subscribe again from its last position", async () => {
  const h = harness({
    server: {
      onTurn: (context) => {
        const events = context.server.commit(
          context.threadId,
          [
            userItem(context.turnId, 1, "hello"),
            assistantItem(context.turnId, 2, { text: "once" }),
            turnCompleted(context.turnId),
          ],
          { notify: false },
        );
        const last = events.at(-1);
        if (last === undefined) return;
        // 구멍: 클라이언트 위치(thread.started까지)와 from이 이어지지 않는다
        context.server.sendBatch({ from: last.seq - 1, to: last.seq, events: [last] });
      },
    },
  });
  expect(await h.run(["chat", "-p", "hello"])).toBe(0);
  expect(h.stdoutText()).toBe("once\n");
  const subscribes = h.server().requests.filter((request) => request.method === "events.subscribe");
  expect(subscribes).toHaveLength(2);
  expect(subscribes[1]?.params).toMatchObject({ from: { seq: 1 } });
});

test("state files in other workspaces are kept", async () => {
  const h = harness({ server: { onTurn: answer("first") } });
  mkdirSync(dirname(h.stateFile), { recursive: true });
  writeFileSync(
    h.stateFile,
    JSON.stringify({
      version: 1,
      extra: "keep",
      workspaces: {
        "/other": {
          threadId: threadId(9),
          position: { storeId: TEST_STORE_ID, seq: 4 },
          updatedAt: "2026-01-05T00:00:00.000Z",
        },
      },
    }),
  );
  chmodSync(h.stateFile, 0o600);
  await h.run(["chat", "-p", "q"]);
  const state = readState(h.stateFile);
  expect(state).toMatchObject({
    extra: "keep",
    workspaces: {
      "/other": { threadId: threadId(9) },
      "/work/project": { threadId: threadId(101) },
    },
  });
  expect(existsSync(`${h.stateFile}.tmp`)).toBe(false);
});

test("a state file that cannot be written does not stop the conversation", async () => {
  const h = harness({ server: { onTurn: answer("fine") } });
  // 상태 파일 자리에 폴더가 있다: 이름 바꾸기가 실패한다
  mkdirSync(h.stateFile, { recursive: true });
  expect(await h.run(["chat", "-p", "q"])).toBe(0);
  expect(h.stdoutText()).toBe("fine\n");
  expect(h.stderrText()).toContain("CLI 상태 파일을 쓰지 못했다");
});
