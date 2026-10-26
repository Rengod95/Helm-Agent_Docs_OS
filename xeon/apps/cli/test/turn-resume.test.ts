import { afterEach, expect, test } from "bun:test";
import { wireError } from "@xeon/contracts/wire";
import { EXIT } from "../src/exit-codes.ts";
import { describeResumable, resumeResultText } from "../src/commands/resume-turn.ts";
import { assistantItem, turnCompleted } from "./support/events.ts";
import type { FakeHandlers, TurnContext } from "./support/fake-server.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { threadId, turnId } from "./support/ids.ts";
import { summary } from "./support/m2.ts";
import { scriptedInput, type Reply } from "./support/script.ts";

// G1-02: thread.list의 resumable 표식이 있는 세션을 열면 사용자에게 묻고, 확인하면 turn.resume을 부른다.
// 호스트 처리기는 가짜다(실제 처리기와의 종단 시험은 turn-resume-host.int.test.ts).

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

const TTY = { stdinIsTty: true, stdoutIsTty: true, columns: 80 } as const;
const T1 = threadId(1);
const T2 = threadId(2);
const CUT = turnId(7);
const RESUMABLE = { turnId: CUT, runningSince: "2026-01-05T00:05:00.000Z", resumeAttempts: 0 };

function answer(text: string): (context: TurnContext) => void {
  return (context) => {
    context.server.commit(context.threadId, [
      assistantItem(context.turnId, 1, { text }),
      turnCompleted(context.turnId),
    ]);
  };
}

function chat(replies: readonly Reply[], handlers: FakeHandlers) {
  const input = scriptedInput([...replies, "/quit"]);
  const h = createHarness({
    terminal: TTY,
    env: { NO_COLOR: "1" },
    readLine: (prompt, signal) => input.readLine(prompt, signal),
    server: { knownThreads: [T1, T2], onTurn: answer("ok"), handlers },
  });
  harnesses.push(h);
  return { h, input };
}

/** 끊긴 turn을 이어 실행하면 어시스턴트 답과 turn.completed를 내고 resumed로 답하는 가짜 처리기 */
function resumingHandlers(listed: readonly ReturnType<typeof summary>[]): {
  readonly handlers: FakeHandlers;
  readonly calls: Record<string, unknown>[];
} {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    handlers: {
      "thread.list": () => ({ threads: listed, nextCursor: null }),
      "turn.resume": (params, server) => {
        calls.push(Object.fromEntries(Object.entries(params)));
        const thread = [T1, T2].find((candidate) => candidate === params["threadId"]);
        if (thread === undefined)
          throw wireError("thread.notFound", { details: { threadId: "?" } });
        server.commit(thread, [
          assistantItem(CUT, 1, { text: "이어서 끝냈다" }),
          turnCompleted(CUT),
        ]);
        return { status: "resumed", turnId: CUT, from: "request" };
      },
    },
  };
}

test("describeResumable and resumeResultText phrase each outcome", () => {
  expect(describeResumable(RESUMABLE)).toBe(
    "이 세션에 끊긴 turn이 있다 (시작 2026-01-05T00:05:00.000Z)\n",
  );
  expect(describeResumable({ ...RESUMABLE, resumeAttempts: 2 })).toBe(
    "이 세션에 끊긴 turn이 있다 (시작 2026-01-05T00:05:00.000Z, 이어 실행을 2번 시도했다)\n",
  );
  expect(resumeResultText({ status: "resumed", turnId: CUT, from: "tools" })).toBe(
    "이어서 실행한다 (tools 단계부터)\n",
  );
  expect(resumeResultText({ status: "closed", turnId: CUT, reason: "abort_requested" })).toBe(
    "중단 요청이 있었던 turn이라 이어 실행하지 않고 닫았다\n",
  );
  expect(resumeResultText({ status: "closed", turnId: CUT, reason: "owner_cancelled" })).toBe(
    "소유자가 취소한 turn이라 이어 실행하지 않고 닫았다\n",
  );
  expect(resumeResultText({ status: "nothing" })).toBe("이어서 실행할 turn이 없다\n");
});

test("opening a resumable session asks, and y sends turn.resume for that thread and shows the rest of the turn", async () => {
  const host = resumingHandlers([summary(T1, { resumable: RESUMABLE })]);
  const s = chat(["y"], host.handlers);
  expect(await s.h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  expect(s.h.stdoutText()).toContain("이 세션에 끊긴 turn이 있다 (시작 2026-01-05T00:05:00.000Z)");
  expect(s.input.prompts[0]).toBe("이어서 실행할까요? [y/N] ");
  expect(host.calls).toEqual([{ threadId: T1 }]);
  expect(s.h.stdoutText()).toContain("이어서 실행한다 (request 단계부터)");
  expect(s.h.stdoutText()).toContain("이어서 끝냈다");
  // 이어 실행은 새 입력이 아니다
  expect(s.h.methods()).not.toContain("turn.start");
});

test("answering n (or just enter) does not call turn.resume", async () => {
  const host = resumingHandlers([summary(T1, { resumable: RESUMABLE })]);
  const s = chat([""], host.handlers);
  expect(await s.h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  expect(host.calls).toEqual([]);
  expect(s.h.methods()).not.toContain("turn.resume");
  expect(s.h.stdoutText()).toContain("이어서 실행하지 않았다");
});

test("a closed result is reported and the session stays usable", async () => {
  const s = chat(["y", "hello"], {
    "thread.list": () => ({ threads: [summary(T1, { resumable: RESUMABLE })], nextCursor: null }),
    "turn.resume": () => ({ status: "closed", turnId: CUT, reason: "abort_requested" }),
  });
  expect(await s.h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  expect(s.h.stdoutText()).toContain("중단 요청이 있었던 turn이라 이어 실행하지 않고 닫았다");
  expect(
    s.h.server().requests.find((request) => request.method === "turn.start")?.params,
  ).toMatchObject({ threadId: T1, input: "hello" });
});

test("a turn.resume failure is shown as a two-line phrase", async () => {
  const s = chat(["y"], {
    "thread.list": () => ({ threads: [summary(T1, { resumable: RESUMABLE })], nextCursor: null }),
    "turn.resume": () => {
      throw wireError("thread.closed", { details: { threadId: T1 } });
    },
  });
  expect(await s.h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  expect(s.h.stderrText()).toContain(`xeon: 닫힌 세션이라 쓸 수 없다: ${T1}`);
});

test("a session without the resumable mark never asks", async () => {
  const host = resumingHandlers([summary(T1)]);
  const s = chat([], host.handlers);
  expect(await s.h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  expect(s.input.prompts.some((prompt) => prompt.includes("이어서 실행할까요?"))).toBe(false);
  expect(host.calls).toEqual([]);
});

test("a new session and print mode never look for a resumable turn", async () => {
  const host = resumingHandlers([summary(T1, { resumable: RESUMABLE })]);
  const fresh = chat([], host.handlers);
  expect(await fresh.h.run(["chat"])).toBe(EXIT.ok);
  expect(fresh.h.methods()).not.toContain("thread.list");

  const print = chat([], host.handlers);
  expect(await print.h.run(["chat", "--resume", T1, "-p", "계속"])).toBe(EXIT.ok);
  expect(print.h.methods()).not.toContain("turn.resume");
  expect(print.input.prompts).toEqual([]);
});

test("a host without turn.resume is not asked", async () => {
  const s = chat([], {
    "thread.list": () => ({ threads: [summary(T1, { resumable: RESUMABLE })], nextCursor: null }),
  });
  expect(await s.h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  expect(s.input.prompts.some((prompt) => prompt.includes("이어서 실행할까요?"))).toBe(false);
});

test("a resumable session found by id outside the folder is still offered", async () => {
  const listed = [summary(T1, { workspace: "/elsewhere", resumable: RESUMABLE })];
  const host = resumingHandlers(listed);
  const s = chat(["y"], {
    ...host.handlers,
    "thread.list": (params) => ({
      threads: params["workspace"] === undefined ? listed : [],
      nextCursor: null,
    }),
  });
  expect(await s.h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  expect(host.calls).toEqual([{ threadId: T1 }]);
});

test("/resume switching to a resumable session asks too", async () => {
  const host = resumingHandlers([
    summary(T1, { title: "하나" }),
    summary(T2, { title: "둘", resumable: RESUMABLE }),
  ]);
  const s = chat(["/resume", "2", "y"], host.handlers);
  expect(await s.h.run(["chat"])).toBe(EXIT.ok);
  expect(host.calls).toEqual([{ threadId: T2 }]);
});
