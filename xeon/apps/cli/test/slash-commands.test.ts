import { afterEach, expect, test } from "bun:test";
import { WireError, wireError } from "@xeon/contracts/wire";
import type { CommandListResult } from "@xeon/contracts/wire";
import { EXIT } from "../src/exit-codes.ts";
import { completionsOf, parseSlash } from "../src/slash.ts";
import { assistantItem, turnCompleted } from "./support/events.ts";
import type { FakeHandlers, TurnContext } from "./support/fake-server.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { threadId } from "./support/ids.ts";
import { summary } from "./support/m2.ts";
import { scriptedInput, type Reply } from "./support/script.ts";

// G1-01: 엔진에 등록한 슬래시 명령을 command.list / command.run으로 실행한다. 호스트 처리기는 가짜다
// (실제 처리기와의 종단 시험은 T2 병합 뒤 `needs wave-2 host`로 다시 돌린다).

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

const TTY = { stdinIsTty: true, stdoutIsTty: true, columns: 80 } as const;

const PLAN: CommandListResult["commands"][number] = {
  name: "plan",
  description: "계획 모드를 켠다",
  argumentHint: "[on|off]",
  args: [{ name: "mode", choices: ["on", "off"] }],
  kind: "action",
  source: "capability",
  origin: "cap-work",
  hasShell: false,
};
const REVIEW: CommandListResult["commands"][number] = {
  name: "review",
  description: "변경을 검토한다",
  argumentHint: null,
  args: [],
  kind: "template",
  source: "project",
  origin: ".xeon/commands/review.md",
  hasShell: true,
};

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
    server: { onTurn: answer("ok"), handlers },
  });
  harnesses.push(h);
  return { h, input };
}

function runParams(h: Harness): readonly Record<string, unknown>[] {
  return h
    .server()
    .requests.filter((request) => request.method === "command.run")
    .map((request) => Object.fromEntries(Object.entries(request.params ?? {})));
}

test("parseSlash hands a name that is neither built-in nor alias to the engine with the whole line", () => {
  expect(parseSlash("/plan on")).toEqual({ kind: "engine", name: "plan", text: "/plan on" });
  expect(parseSlash("/frob")).toEqual({ kind: "engine", name: "frob", text: "/frob" });
  // 내장이 이름이 겹치는 엔진 명령보다 앞선다
  expect(parseSlash("/help")).toEqual({ kind: "help" });
});

test("an action command prints done.message and sends the line unchanged to command.run", async () => {
  const s = chat(["/plan on"], {
    "command.run": () => ({
      status: "done",
      name: "plan",
      message: "계획 모드를 켰다",
      result: null,
    }),
  });
  expect(await s.h.run(["chat"])).toBe(EXIT.ok);
  expect(s.h.stdoutText()).toContain("계획 모드를 켰다\n");
  const calls = runParams(s.h);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toEqual({ threadId: expect.stringMatching(/^thr_/), text: "/plan on" });
  // 동작 명령은 turn을 만들지 않는다
  expect(s.h.methods()).not.toContain("turn.start");
});

test("a done result without a message prints the structured value as JSON", async () => {
  const s = chat(["/tasks"], {
    "command.run": () => ({
      status: "done",
      name: "tasks",
      message: null,
      result: { open: 2, items: ["a", "b"] },
    }),
  });
  expect(await s.h.run(["chat"])).toBe(EXIT.ok);
  expect(s.h.stdoutText()).toContain(JSON.stringify({ open: 2, items: ["a", "b"] }, null, 2));
});

test("an expanded template is sent as a user turn with the expanded text", async () => {
  const s = chat(["/review src"], {
    "command.run": () => ({
      status: "expanded",
      name: "review",
      text: "src 폴더의 변경을 검토한다",
    }),
  });
  expect(await s.h.run(["chat"])).toBe(EXIT.ok);
  const turn = s.h.server().requests.find((request) => request.method === "turn.start");
  expect(turn?.params).toMatchObject({ input: "src 폴더의 변경을 검토한다" });
  expect(turn?.params).not.toMatchObject({ input: "/review src" });
});

test("needs_confirmation shows the shell commands and runs again with confirmShell only after a yes", async () => {
  const handlers: FakeHandlers = {
    "command.run": (params) =>
      params["confirmShell"] === true
        ? { status: "expanded", name: "review", text: "diff 결과를 검토한다" }
        : {
            status: "needs_confirmation",
            name: "review",
            shell: [{ index: 0, command: "git diff --stat" }],
          },
  };
  const yes = chat(["/review", "y"], handlers);
  expect(await yes.h.run(["chat"])).toBe(EXIT.ok);
  expect(yes.h.stdoutText()).toContain("/review이(가) 셸 명령을 실행한다:\n  git diff --stat\n");
  expect(runParams(yes.h).map((call) => call["confirmShell"])).toEqual([undefined, true]);
  expect(
    yes.h.server().requests.find((request) => request.method === "turn.start")?.params,
  ).toMatchObject({ input: "diff 결과를 검토한다" });

  const no = chat(["/review", ""], handlers);
  expect(await no.h.run(["chat"])).toBe(EXIT.ok);
  expect(no.h.stderrText()).toContain("실행하지 않았다");
  expect(runParams(no.h)).toHaveLength(1);
  expect(no.h.methods()).not.toContain("turn.start");
});

test("not_command reports an unknown slash command and keeps the session", async () => {
  const s = chat(["/frob", "hello"], { "command.run": () => ({ status: "not_command" }) });
  expect(await s.h.run(["chat"])).toBe(EXIT.ok);
  expect(s.h.stderrText()).toContain("모르는 슬래시 명령: /frob");
  expect(
    s.h.server().requests.find((request) => request.method === "turn.start")?.params,
  ).toMatchObject({ input: "hello" });
});

test("a host without command.run never gets the call and answers unknown", async () => {
  const s = chat(["/plan on"], {});
  expect(await s.h.run(["chat"])).toBe(EXIT.ok);
  expect(s.h.methods()).not.toContain("command.run");
  expect(s.h.methods()).not.toContain("command.list");
  expect(s.h.stderrText()).toContain("모르는 슬래시 명령: /plan");
});

test("command failures are mapped to two-line phrases and the session goes on", async () => {
  const s = chat(["/plan x", "hello"], {
    "command.run": () => {
      throw new WireError(4000, "developer text", {
        kind: "cap.dialog.commands.command_args_invalid",
        retryable: false,
        details: { message: "mode must be on or off" },
      });
    },
  });
  expect(await s.h.run(["chat"])).toBe(EXIT.ok);
  expect(s.h.stderrText()).toContain("xeon: 명령 인자가 선언에 맞지 않다: mode must be on or off");
  expect(s.h.stderrText()).toContain("  해결: /help로 명령의 사용법을 확인한다");
  expect(s.h.methods()).toContain("turn.start");
});

test("/help lists the engine commands and the completer knows their names and first-argument choices", async () => {
  const s = chat(["/help"], { "command.list": () => ({ commands: [PLAN, REVIEW] }) });
  expect(await s.h.run(["chat"])).toBe(EXIT.ok);
  expect(s.h.stdoutText()).toContain(
    "엔진 명령\n  /plan [on|off]   계획 모드를 켠다\n  /review   변경을 검토한다\n",
  );
  const complete = s.h.completer();
  expect(complete?.("/pl")).toEqual(["/plan"]);
  expect(complete?.("/plan o")).toEqual(["/plan on", "/plan off"]);
  expect(complete?.("/plan of")).toEqual(["/plan off"]);
  // 내장 이름은 한 번만 나온다
  expect(complete?.("/re")).toEqual(["/resume", "/rename", "/review"]);
});

test("completionsOf is a pure function over the engine command list", () => {
  expect(completionsOf("/p", [], [PLAN, REVIEW])).toEqual(["/plan"]);
  expect(completionsOf("/plan ", [], [PLAN])).toEqual(["/plan on", "/plan off"]);
  expect(completionsOf("/review ", [], [REVIEW])).toEqual([]);
});

function requestsOf(h: Harness, method: string): readonly Record<string, unknown>[] {
  return h
    .server()
    .requests.filter((request) => request.method === method)
    .map((request) => Object.fromEntries(Object.entries(request.params ?? {})));
}

test("command.list is asked with the id of the session the chat opened (G1-01)", async () => {
  const s = chat(["/plan on"], {
    "command.list": () => ({ commands: [PLAN] }),
    "command.run": () => ({ status: "done", name: "plan", message: "ok", result: null }),
  });
  expect(await s.h.run(["chat"])).toBe(EXIT.ok);
  const listed = requestsOf(s.h, "command.list");
  expect(listed).toEqual([{ threadId: expect.stringMatching(/^thr_/) }]);
  // 목록을 읽은 thread와 명령을 실행한 thread가 같다
  expect(listed[0]?.["threadId"]).toBe(runParams(s.h)[0]?.["threadId"]);
});

test("switching sessions with /resume reads the command list again for the new session", async () => {
  const T1 = threadId(1);
  const T2 = threadId(2);
  const input = scriptedInput(["/resume 2", "/help", "/quit"]);
  const h = createHarness({
    terminal: TTY,
    env: { NO_COLOR: "1" },
    readLine: (prompt, signal) => input.readLine(prompt, signal),
    server: {
      knownThreads: [T1, T2],
      onTurn: answer("ok"),
      handlers: {
        "thread.list": () => ({
          threads: [summary(T1, { title: "하나" }), summary(T2, { title: "둘" })],
          nextCursor: null,
        }),
        "thread.open": (params) => ({
          threadId: params["threadId"],
          role: "owner",
          position: { storeId: "sto_00000000000000000000000001", seq: 0 },
        }),
        // 프로젝트 명령은 세션의 작업 폴더에 달려 있다: 두 번째 세션에서만 /review가 있다
        "command.list": (params) => ({
          commands: params["threadId"] === T2 ? [PLAN, REVIEW] : [PLAN],
        }),
      },
    },
  });
  harnesses.push(h);
  expect(await h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  expect(requestsOf(h, "command.list").map((params) => params["threadId"])).toEqual([T1, T2]);
  const help = h.stdoutText().slice(h.stdoutText().lastIndexOf("슬래시 명령"));
  expect(help).toContain("  /review   변경을 검토한다\n");
});

test("parseSlash reads /compact with and without summary instructions", () => {
  expect(parseSlash("/compact")).toEqual({ kind: "compact", instructions: null });
  expect(parseSlash("/compact  결정 사항만 남겨  ")).toEqual({
    kind: "compact",
    instructions: "결정 사항만 남겨",
  });
});

test("/compact sends thread.compact for this session and prints the token count", async () => {
  const s = chat(["/compact"], {
    "thread.compact": () => ({
      status: "compacted",
      eventId: "evt_00000000000000000000000001",
      tokensBefore: 8123,
      fromExtension: null,
      position: { storeId: "sto_00000000000000000000000001", seq: 9 },
    }),
  });
  expect(await s.h.run(["chat"])).toBe(EXIT.ok);
  expect(requestsOf(s.h, "thread.compact")).toEqual([{ threadId: expect.stringMatching(/^thr_/) }]);
  expect(s.h.stdoutText()).toContain("대화를 요약했다 (요약 전 약 8123 토큰)\n");
  // 요약은 turn을 만들지 않는다
  expect(s.h.methods()).not.toContain("turn.start");
});

test("/compact passes the text after the name as the summary instructions and names an extension", async () => {
  const s = chat(["/compact 결정 사항만 남겨"], {
    "thread.compact": () => ({
      status: "compacted",
      eventId: "evt_00000000000000000000000001",
      tokensBefore: 40,
      fromExtension: "my-summary",
      position: { storeId: "sto_00000000000000000000000001", seq: 9 },
    }),
  });
  expect(await s.h.run(["chat"])).toBe(EXIT.ok);
  expect(requestsOf(s.h, "thread.compact")).toEqual([
    { threadId: expect.stringMatching(/^thr_/), instructions: "결정 사항만 남겨" },
  ]);
  expect(s.h.stdoutText()).toContain("(요약 전 약 40 토큰, 요약 확장 my-summary)");
});

test("a skipped compaction prints its reason and is not an error", async () => {
  const reasons = [
    ["nothing_to_summarize", "요약할 내용이 아직 없다"],
    ["last_entry_is_compaction", "방금 요약했다. 새 대화가 쌓인 뒤에 다시 요약한다"],
    ["disabled", "이 엔진은 컴팩션을 쓸 수 없게 조립되어 있다"],
  ] as const;
  for (const [why, text] of reasons) {
    const s = chat(["/compact"], { "thread.compact": () => ({ status: "skipped", why }) });
    // oxlint-disable-next-line no-await-in-loop -- 사례마다 하네스 하나를 끝까지 돌린다
    expect(await s.h.run(["chat"])).toBe(EXIT.ok);
    expect(s.h.stdoutText()).toContain(`${text}\n`);
    expect(s.h.stderrText()).toBe("");
  }
});

test("compaction failures are two-line phrases and the session goes on", async () => {
  const failures: readonly [ReturnType<typeof wireError>, string, string][] = [
    [
      wireError("thread.cancelledByExtension", {
        details: { point: "session_before_compact", reason: "요약 금지 구간" },
      }),
      "xeon: 확장이 컴팩션 작업을 막았다: 요약 금지 구간",
      "  해결: 확장의 설정을 확인한다 (xeon config get)",
    ],
    [
      wireError("thread.compactFailed", { details: { reason: "summary_failed" } }),
      "xeon: 대화를 요약하지 못했다 (summary_failed)",
      "  해결: 잠시 뒤 다시 /compact를 실행한다. 반복되면 xeon doctor를 실행하고 보고한다",
    ],
    [wireError("turn.busy"), "xeon: 진행 중인 turn이 있다", "  해결: 끝난 뒤 다시 보낸다"],
    [
      wireError("thread.closed", { details: { threadId: "thr_1" } }),
      "xeon: 닫힌 세션이라 쓸 수 없다: thr_1",
      "  해결: xeon sessions fork로 분기하거나 새 세션을 연다",
    ],
    [wireError("request.cancelled"), "xeon: 요청이 취소되었다", "  해결: 필요하면 다시 실행한다"],
  ];
  for (const [error, first, second] of failures) {
    const s = chat(["/compact", "hello"], {
      "thread.compact": () => {
        throw error;
      },
    });
    // oxlint-disable-next-line no-await-in-loop -- 사례마다 하네스 하나를 끝까지 돌린다
    expect(await s.h.run(["chat"])).toBe(EXIT.ok);
    expect(s.h.stderrText()).toContain(`${first}\n${second}\n`);
    // 오류 뒤에도 입력을 이어 받는다
    expect(s.h.methods()).toContain("turn.start");
  }
});

test("a host without thread.compact never gets the call", async () => {
  const s = chat(["/compact"], {});
  expect(await s.h.run(["chat"])).toBe(EXIT.ok);
  expect(s.h.methods()).not.toContain("thread.compact");
  expect(s.h.stderrText()).toContain("xeon: 이 엔진은 수동 컴팩션을 처리하지 않는다");
});

test("/compact is built in: it wins over an engine command with the same name and shows in /help and completion", async () => {
  const compactCommand: CommandListResult["commands"][number] = {
    ...PLAN,
    name: "compact",
    description: "엔진 쪽 compact",
    argumentHint: null,
    args: [],
  };
  const s = chat(["/help", "/compact"], {
    "command.list": () => ({ commands: [compactCommand] }),
    "command.run": () => ({ status: "done", name: "compact", message: "엔진", result: null }),
    "thread.compact": () => ({ status: "skipped", why: "nothing_to_summarize" }),
  });
  expect(await s.h.run(["chat"])).toBe(EXIT.ok);
  expect(s.h.stdoutText()).toContain("  /compact [<지침>]   지금 대화를 요약해 줄인다\n");
  expect(s.h.stdoutText()).not.toContain("엔진 쪽 compact");
  expect(s.h.methods()).not.toContain("command.run");
  expect(s.h.completer()?.("/co")).toEqual(["/compact"]);
});
