import { afterEach, expect, test } from "bun:test";
import { wireError } from "@xeon/contracts/wire";
import { EXIT } from "../src/exit-codes.ts";
import { assistantItem, turnCompleted, userItem } from "./support/events.ts";
import type { TurnContext } from "./support/fake-server.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { threadId } from "./support/ids.ts";
import { def, fakeSettings, summary } from "./support/m2.ts";
import { scriptedInput, type Reply } from "./support/script.ts";

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

const TTY = { stdinIsTty: true, stdoutIsTty: true, columns: 80 } as const;
const T1 = threadId(1);
const T2 = threadId(2);

function answer(text: string): (context: TurnContext) => void {
  return (context) => {
    context.server.commit(context.threadId, [
      userItem(context.turnId, 1, "hi"),
      assistantItem(context.turnId, 2, { text }),
      turnCompleted(context.turnId),
    ]);
  };
}

function locked(options: readonly string[] = ["observe", "fork"]) {
  return () => {
    throw wireError("thread.locked", { details: { ownerKind: "app", options: [...options] } });
  };
}

interface Opened {
  readonly h: Harness;
  readonly opens: Record<string, unknown>[];
  readonly forks: Record<string, unknown>[];
  readonly input: ReturnType<typeof scriptedInput>;
}

function lockedSession(replies: readonly Reply[], options?: readonly string[]): Opened {
  const opens: Record<string, unknown>[] = [];
  const forks: Record<string, unknown>[] = [];
  const input = scriptedInput(replies);
  const h = createHarness({
    terminal: TTY,
    env: { NO_COLOR: "1" },
    readLine: (prompt, signal) => input.readLine(prompt, signal),
    server: {
      knownThreads: [T1, T2],
      onTurn: answer("forked answer"),
      handlers: {
        "thread.open": (params) => {
          opens.push({ ...params });
          if (params["mode"] === "write" && params["threadId"] === T1) return locked(options)();
          return {
            threadId: params["threadId"],
            role: params["mode"] === "write" ? "owner" : "observer",
            position: { storeId: "sto_00000000000000000000000001", seq: 0 },
          };
        },
        "thread.fork": (params) => {
          forks.push({ ...params });
          return { threadId: T2, position: { storeId: "sto_00000000000000000000000001", seq: 0 } };
        },
      },
    },
  });
  harnesses.push(h);
  return { h, opens, forks, input };
}

test("--resume opens the session for writing through thread.open", async () => {
  const h = createHarness({
    env: { NO_COLOR: "1" },
    server: {
      knownThreads: [T1],
      onTurn: answer("again"),
      handlers: {
        "thread.open": (params) => ({
          threadId: params["threadId"],
          role: "owner",
          position: { storeId: "sto_00000000000000000000000001", seq: 0 },
        }),
      },
    },
  });
  harnesses.push(h);
  expect(await h.run(["chat", "-p", "again", "--resume", T1])).toBe(EXIT.ok);
  const order = h.methods();
  expect(order.indexOf("thread.open")).toBeGreaterThan(-1);
  expect(order.indexOf("thread.open")).toBeLessThan(order.indexOf("events.subscribe"));
  expect(h.server().requests.find((r) => r.method === "thread.open")?.params).toEqual({
    threadId: T1,
    mode: "write",
  });
});

test("--continue takes the newest session of the working folder from thread.list", async () => {
  const lists: unknown[] = [];
  const h = createHarness({
    env: { NO_COLOR: "1" },
    server: {
      knownThreads: [T1],
      onTurn: answer("continued"),
      handlers: {
        "thread.list": (params) => (
          lists.push(params),
          { threads: [summary(T1)], nextCursor: null }
        ),
        "thread.open": (params) => ({
          threadId: params["threadId"],
          role: "owner",
          position: { storeId: "sto_00000000000000000000000001", seq: 0 },
        }),
      },
    },
  });
  harnesses.push(h);
  expect(await h.run(["chat", "-p", "go on", "--continue"])).toBe(EXIT.ok);
  expect(lists).toEqual([{ workspace: "/work/project", limit: 1 }]);
  expect(h.server().requests.find((r) => r.method === "turn.start")?.params).toMatchObject({
    threadId: T1,
  });
});

test("--continue with no session in thread.list says so and exits 1", async () => {
  const h = createHarness({
    env: { NO_COLOR: "1" },
    server: { handlers: { "thread.list": () => ({ threads: [], nextCursor: null }) } },
  });
  harnesses.push(h);
  expect(await h.run(["chat", "-p", "x", "--continue"])).toBe(EXIT.error);
  expect(h.stderrText()).toContain("이어 열 세션이 없다");
});

test("a locked session in print mode exits 4 without asking anything", async () => {
  const lock = lockedSession([]);
  expect(await lock.h.run(["chat", "-p", "x", "--resume", T1])).toBe(EXIT.lockDenied);
  expect(lock.input.prompts).toEqual([]);
  expect(lock.h.stderrText()).toContain("다른 프로세스(app)가 이 세션을 쓰고 있다");
});

test("a locked session on a terminal offers observe and fork; delegate stays hidden without a service", async () => {
  const lock = lockedSession([""], ["observe", "fork", "delegate"]);
  expect(await lock.h.run(["chat", "--resume", T1])).toBe(EXIT.lockDenied);
  const shown = lock.h.stdoutText();
  expect(shown).toContain("다른 프로세스(app)가 이 세션을 쓰고 있다.");
  expect(shown).toContain("[o] 관찰만 한다");
  expect(shown).toContain("[f] 분기해서 새 세션으로 연다");
  expect(shown).not.toContain("[d]");
  expect(lock.forks).toEqual([]);
});

test("choosing observe opens read-only: typed lines are not sent as turns", async () => {
  const lock = lockedSession(["o", "무시될 입력", "/quit"]);
  expect(await lock.h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  expect(lock.opens).toContainEqual({ threadId: T1, mode: "observe" });
  expect(lock.h.stdoutText()).toContain("관찰 전용이다");
  expect(lock.h.stderrText()).toContain("관찰 전용이라 입력을 보낼 수 없다");
  expect(lock.h.methods()).not.toContain("turn.start");
});

test("choosing fork opens a branch for writing and the next turn goes to the branch", async () => {
  const lock = lockedSession(["f", "hello", "/quit"]);
  expect(await lock.h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  expect(lock.forks).toEqual([{ threadId: T1 }]);
  expect(lock.opens).toContainEqual({ threadId: T2, mode: "write" });
  expect(lock.h.server().requests.find((r) => r.method === "turn.start")?.params).toMatchObject({
    threadId: T2,
  });
  expect(lock.h.stdoutText()).toContain("forked answer");
});

test("a locked session whose host offers no options at all exits 4", async () => {
  const lock = lockedSession([], []);
  expect(await lock.h.run(["chat", "--resume", T1])).toBe(EXIT.lockDenied);
  expect(lock.input.prompts).toEqual([]);
});

test("--set applies each override to the session scope, in order, before the first turn", async () => {
  const settings = fakeSettings([
    def("l4.cli.theme", { allowedScopes: ["user", "session"] }),
    def("l4.cli.outputMode", { allowedScopes: ["user", "session"], default: "text" }),
  ]);
  const h = createHarness({
    env: { NO_COLOR: "1" },
    server: { onTurn: answer("ok"), handlers: settings.handlers },
  });
  harnesses.push(h);
  expect(
    await h.run([
      "chat",
      "-p",
      "x",
      "--set",
      "l4.cli.theme=dark",
      "--set",
      "l4.cli.outputMode=text",
    ]),
  ).toBe(EXIT.ok);
  expect(settings.writes.map((w) => [w.key, w.value, w.scope])).toEqual([
    ["l4.cli.theme", "dark", "session"],
    ["l4.cli.outputMode", "text", "session"],
  ]);
  expect(settings.writes.every((w) => typeof w.threadId === "string")).toBe(true);
  const order = h.methods();
  expect(order.lastIndexOf("settings.set")).toBeLessThan(order.indexOf("turn.start"));
});

test("a failing --set stops before the turn and exits 2", async () => {
  const settings = fakeSettings([def("l4.cli.theme", { allowedScopes: ["user"] })]);
  const h = createHarness({
    env: { NO_COLOR: "1" },
    server: { onTurn: answer("never"), handlers: settings.handlers },
  });
  harnesses.push(h);
  expect(await h.run(["chat", "-p", "x", "--set", "l4.cli.theme=dark"])).toBe(EXIT.usage);
  expect(h.stderrText()).toContain("--set l4.cli.theme");
  expect(h.stderrText()).toContain("허용 범위: user");
  expect(h.methods()).not.toContain("turn.start");
  expect(h.closed()).toBe(true);
});

test("--set against a host without settings.set explains it and exits 1", async () => {
  const h = createHarness({ env: { NO_COLOR: "1" }, server: { onTurn: answer("never") } });
  harnesses.push(h);
  expect(await h.run(["chat", "-p", "x", "--set", "l4.cli.theme=dark"])).toBe(EXIT.error);
  expect(h.stderrText()).toContain("settings.set이 없다");
  expect(h.methods()).not.toContain("turn.start");
});
