import { afterEach, expect, test } from "bun:test";
import { wireError, type ThreadSummary } from "@xeon/contracts/wire";
import { parseArgv, type TerminalFacts } from "../src/cli/command.ts";
import { EXIT } from "../src/exit-codes.ts";
import { parseSlash } from "../src/slash.ts";
import { assistantItem, turnCompleted } from "./support/events.ts";
import type { FakeHandlers, TurnContext } from "./support/fake-server.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { threadId } from "./support/ids.ts";
import { summary } from "./support/m2.ts";
import { scriptedInput } from "./support/script.ts";

// G2-12: 세션 제목. 목록은 제목을 보이고, `sessions rename`과 `/rename`은 thread.rename으로 바꾼다.
// 첫 입력 80자로 제목을 정하는 일은 호스트(T2)가 한다. 호스트 처리기는 가짜다(종단 시험은 wave 2 병합 뒤 다시 돌린다).

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

const TTY: TerminalFacts = { stdinIsTty: true, stdoutIsTty: true };
const T1 = threadId(1);

function parse(argv: readonly string[]): unknown {
  const parsed = parseArgv(argv, TTY, {});
  return parsed.ok ? parsed.value.command : parsed.error.code;
}

test("sessions rename takes an id and a title, joining loose words", () => {
  expect(parse(["sessions", "rename", T1, "릴리즈", "준비", "점검"])).toEqual({
    kind: "sessions.rename",
    threadId: T1,
    title: "릴리즈 준비 점검",
  });
  expect(parse(["sessions", "rename"])).toBe("missingArgument");
  expect(parse(["sessions", "rename", T1])).toBe("missingArgument");
  expect(parse(["sessions", "rename", "nope", "제목"])).toBe("invalidThreadId");
  expect(parse(["sessions", "rename", T1, "가".repeat(201)])).toBe("unexpectedArgument");
  expect(parse(["sessions", "rename", T1, "가".repeat(200)])).toMatchObject({
    kind: "sessions.rename",
  });
});

test("/rename parses the rest of the line as the title and refuses an empty or long one", () => {
  expect(parseSlash("/rename 새  제목")).toEqual({ kind: "rename", title: "새  제목" });
  expect(parseSlash("/rename")).toEqual({
    kind: "usage",
    message: "사용법: /rename <제목> (제목이 비어 있다)",
  });
  expect(parseSlash(`/rename ${"가".repeat(201)}`)).toEqual({
    kind: "usage",
    message: "사용법: /rename <제목> (제목이 너무 길다 (200자 이하))",
  });
});

/** thread.rename이 제목을 바꾸고 thread.list가 그 제목을 보이는 상태 있는 가짜 */
function titled(): {
  readonly handlers: FakeHandlers;
  readonly renames: Record<string, unknown>[];
} {
  const renames: Record<string, unknown>[] = [];
  const state: { title: string | null } = { title: null };
  const list = (): ThreadSummary[] => [summary(T1, { title: state.title })];
  return {
    renames,
    handlers: {
      "thread.list": () => ({ threads: list(), nextCursor: null }),
      "thread.rename": (params) => {
        renames.push(Object.fromEntries(Object.entries(params)));
        if (params["threadId"] !== T1) {
          throw wireError("thread.notFound", { details: { threadId: String(params["threadId"]) } });
        }
        state.title = typeof params["title"] === "string" ? params["title"] : null;
        return { position: { storeId: "sto_00000000000000000000000001", seq: 5 } };
      },
    },
  };
}

function harness(handlers: FakeHandlers, lines: readonly string[] = []) {
  const input = scriptedInput([...lines, "/quit"]);
  const h = createHarness({
    terminal: { ...TTY, columns: 80 },
    env: { NO_COLOR: "1" },
    readLine: (prompt, signal) => input.readLine(prompt, signal),
    server: {
      knownThreads: [T1],
      handlers,
      onTurn: (context: TurnContext) => {
        context.server.commit(context.threadId, [
          assistantItem(context.turnId, 1, { text: "ok" }),
          turnCompleted(context.turnId),
        ]);
      },
    },
  });
  harnesses.push(h);
  return h;
}

test("sessions rename sends thread.rename and the list then shows the title instead of (제목 없음)", async () => {
  const host = titled();
  const h = harness(host.handlers);
  expect(await h.run(["sessions", "ls"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toContain("(제목 없음)");
  expect(await h.run(["sessions", "rename", T1, "릴리즈", "준비"])).toBe(EXIT.ok);
  expect(host.renames).toEqual([{ threadId: T1, title: "릴리즈 준비" }]);
  expect(h.stdoutText()).toContain(`이름을 바꿨다: ${T1}  릴리즈 준비\n`);
  const before = h.stdoutText().length;
  expect(await h.run(["sessions", "ls"])).toBe(EXIT.ok);
  const listed = h.stdoutText().slice(before);
  expect(listed).toContain("릴리즈 준비");
  expect(listed).not.toContain("(제목 없음)");
});

test("renaming a missing session is a readable error with exit 1", async () => {
  const host = titled();
  const h = harness(host.handlers);
  expect(await h.run(["sessions", "rename", threadId(9), "제목"])).toBe(EXIT.error);
  expect(h.stderrText()).toContain(`xeon: 세션 ${threadId(9)}이(가) 없다`);
});

test("a host without thread.rename says it does not handle the request", async () => {
  const h = harness({});
  expect(await h.run(["sessions", "rename", T1, "제목"])).toBe(EXIT.error);
  expect(h.stderrText()).toContain("이 엔진은 아직 그 요청을 처리하지 않는다 (thread.rename)");
});

test("/rename in chat renames the current session", async () => {
  const host = titled();
  const h = harness(host.handlers, ["/rename 새 제목"]);
  expect(await h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  expect(host.renames).toEqual([{ threadId: T1, title: "새 제목" }]);
  expect(h.stdoutText()).toContain("제목을 바꿨다: 새 제목\n");
});

test("/rename without a title does not call the host", async () => {
  const host = titled();
  const h = harness(host.handlers, ["/rename"]);
  expect(await h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  expect(host.renames).toEqual([]);
  expect(h.stderrText()).toContain("사용법: /rename <제목> (제목이 비어 있다)");
});

test("the /resume list shows titles", async () => {
  const host = titled();
  const h = harness(host.handlers, ["/rename 나의 세션", "/resume", ""]);
  expect(await h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  expect(h.stdoutText()).toContain(`1) ${T1}  2026-01-05T00:10:00.000Z  나의 세션`);
});
