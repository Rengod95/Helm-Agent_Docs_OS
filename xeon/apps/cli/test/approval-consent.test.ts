import { afterEach, expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import {
  ApprovalRequestedPayloadSchema,
  type ApprovalRequestedPayload,
} from "@xeon/contracts/records";
import type { ApprovalRespondResult } from "@xeon/contracts/wire";
import { EXIT } from "../src/exit-codes.ts";
import {
  createApprovalPrompter,
  type ApprovalResponse,
  type SupersededReason,
} from "../src/render/approval.ts";
import { pieceOf } from "../src/render/text-sink.ts";
import { approvalViewOf } from "../src/render/transcript.ts";
import {
  approvalRequested,
  approvalResolved,
  assistantItem,
  turnCompleted,
} from "./support/events.ts";
import type { TurnContext } from "./support/fake-server.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { threadId, turnId } from "./support/ids.ts";
import { scriptedInput, type Reply } from "./support/script.ts";

// G2-10: 승인 카드의 동의 표시. 명령 전체, 비밀 핸들, 요청 주체, 만료를 보이고, 적용 범위가 낮춰지거나 사용자 응답이 아닌 해결은
// 사실대로 알린다. approval.respond가 적용하지 못한 이유(answer_invalid, commit_failed 등)는 이유별로 다룬다.

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

const TTY = { stdinIsTty: true, stdoutIsTty: true, columns: 80 } as const;
const THREAD = threadId(1);
const TURN = turnId(1);

function payloadOf(
  options: Parameters<typeof approvalRequested>[2] = {},
): ApprovalRequestedPayload {
  const parsed = parse(
    ApprovalRequestedPayloadSchema,
    approvalRequested(THREAD, TURN, options).payload,
  );
  if (!parsed.ok) throw new Error("fixture payload is invalid");
  return parsed.value;
}

function toolBody(args: Record<string, unknown>): unknown {
  return {
    kind: "tool",
    tool: { toolName: "bash", risk: "high", args, argsHash: "h", ruleId: null },
  };
}

function bodyOf(options: Parameters<typeof approvalRequested>[2] = {}): readonly string[] {
  return approvalViewOf("evt_1", payloadOf(options)).body;
}

test("a tool card shows the whole command, not only the 120-character summary", () => {
  const command = `cd /work && ${"echo very-long-argument ".repeat(12)}\nrm -rf build`;
  const body = bodyOf({ body: toolBody({ command }) });
  expect(body[0]).toBe("도구: bash (위험: high)");
  expect(body[1]?.endsWith("…")).toBe(true);
  expect(body.slice(2)).toEqual([
    "명령:",
    `  cd /work && ${"echo very-long-argument ".repeat(12)}`,
    "  rm -rf build",
  ]);
});

test("a very long command is cut at 40 lines with the number of hidden lines", () => {
  const command = Array.from({ length: 45 }, (_, n) => `step ${String(n)}`).join("\n");
  const body = bodyOf({ body: toolBody({ command }) });
  expect(body.at(-1)).toBe("  …(5줄 생략)");
  expect(body.filter((row) => row.startsWith("  step "))).toHaveLength(40);
});

test("secretEnv handles are shown by name and secret:// reference, never as a value", () => {
  const body = bodyOf({
    body: toolBody({
      command: 'curl -H "Authorization: $TOKEN" https://api.example.com',
      secretEnv: { TOKEN: "secret://github-token", BAD: "plain-looking-value" },
    }),
  });
  expect(body).toContain("비밀: TOKEN=secret://github-token, BAD=(참조 형식이 올바르지 않음)");
  expect(body.join("\n")).not.toContain("plain-looking-value");
});

test("a tool call without command or secretEnv adds no detail lines", () => {
  expect(bodyOf({ body: toolBody({ path: "a.txt" }) })).toEqual([
    "도구: bash (위험: high)",
    '인자: {"path":"a.txt"}',
  ]);
});

function first(caller: string): string | undefined {
  return bodyOf({ caller })[0];
}

test("the requester is named unless it is the main agent", () => {
  expect(first("main")).toBe("도구: bash (위험: high)");
  expect(first("background")).toBe("요청 주체: 백그라운드 작업");
  expect(first("host")).toBe("요청 주체: 호스트");
  expect(first("subagent:explorer")).toBe("요청 주체: 서브에이전트 explorer");
  expect(first("ext:helm")).toBe("요청 주체: 확장 helm");
});

test("an expiring request shows when it ends and what happens then", () => {
  const at = Date.UTC(2026, 9, 25, 12, 0, 0);
  expect(bodyOf({ expiresAt: at }).at(-1)).toBe(
    "만료: 2026-10-25T12:00:00.000Z (그때까지 답하지 않으면 거부로 처리한다)",
  );
  expect(bodyOf({ expiresAt: at, onExpire: { decision: "answer", answer: {} } }).at(-1)).toBe(
    "만료: 2026-10-25T12:00:00.000Z (그때까지 답하지 않으면 정해 둔 답으로 처리한다)",
  );
  expect(bodyOf({}).some((row) => row.startsWith("만료"))).toBe(false);
});

function resolved(
  resolvedBy: "user" | "noninteractive" | "cancelled" | "superseded" | "expired",
  remember: "once" | "thread" | "always" = "once",
  requested: "once" | "thread" | "always" | null = null,
): string | undefined {
  return pieceOf(
    {
      kind: "approvalResolved",
      approvalId: "a",
      decision: "allow",
      remember,
      requestedRemember: requested,
      resolvedBy,
    },
    "full",
    false,
  )?.text;
}

test("a downgraded remember scope is announced, an honored one is silent", () => {
  expect(resolved("user", "thread", "always")).toBe(
    "항상 허용을 골랐지만 이 세션 동안 허용으로 낮춰 적용했다\n",
  );
  expect(resolved("user", "once", "thread")).toBe(
    "이 세션 동안 허용을 골랐지만 이번만 허용으로 낮춰 적용했다\n",
  );
  expect(resolved("user", "thread", "thread")).toBeUndefined();
  expect(resolved("user", "once", null)).toBeUndefined();
});

test("a resolution that is not the user's answer says why", () => {
  expect(resolved("expired")).toBe("승인 요청이 만료되어 정해 둔 대로 처리했다\n");
  expect(resolved("noninteractive")).toBe("대화형 입력이 없어 승인 요청을 자동으로 처리했다\n");
  expect(resolved("cancelled")).toBe("turn이 취소되어 승인 요청을 닫았다\n");
  expect(resolved("superseded")).toBe("다른 요청으로 대체되어 승인 요청을 닫았다\n");
  expect(resolved("expired", "thread", "always")).toBe(
    "승인 요청이 만료되어 정해 둔 대로 처리했다\n항상 허용을 골랐지만 이 세션 동안 허용으로 낮춰 적용했다\n",
  );
});

function chatWith(replies: readonly Reply[], resolve: (context: TurnContext, id: string) => void) {
  const input = scriptedInput(["go", ...replies, "/quit"]);
  const responds: Record<string, unknown>[] = [];
  const open: { context?: TurnContext; id?: string } = {};
  const h = createHarness({
    terminal: TTY,
    env: { NO_COLOR: "1" },
    readLine: (prompt, signal) => input.readLine(prompt, signal),
    server: {
      handlers: {
        "approval.respond": (params) => {
          responds.push(Object.fromEntries(Object.entries(params)));
          if (open.context !== undefined && open.id !== undefined) resolve(open.context, open.id);
          return { applied: true };
        },
      },
      onTurn: (context) => {
        const [event] = context.server.commit(context.threadId, [
          approvalRequested(context.threadId, context.turnId, { caller: "subagent:explorer" }),
        ]);
        if (event === undefined) return;
        open.context = context;
        open.id = event.id;
      },
    },
  });
  harnesses.push(h);
  return { h, responds };
}

test("picking always shows the downgrade the host reports on the resolved event", async () => {
  const s = chatWith(["a"], (context, id) => {
    context.server.commit(context.threadId, [
      approvalResolved(context.turnId, id, "allow", "user", {
        applied: "thread",
        requested: "always",
      }),
      assistantItem(context.turnId, 3, { text: "done" }),
      turnCompleted(context.turnId),
    ]);
  });
  expect(await s.h.run(["chat"])).toBe(EXIT.ok);
  expect(s.responds[0]).toMatchObject({ decision: "allow", remember: "always" });
  expect(s.h.stderrText()).toContain("요청 주체: 서브에이전트 explorer");
  expect(s.h.stderrText()).toContain("항상 허용을 골랐지만 이 세션 동안 허용으로 낮춰 적용했다");
});

// ── approval.respond가 적용하지 못한 이유 ──────────────────────────────

function prompter(results: readonly ApprovalRespondResult[], lines: readonly string[]) {
  const sent: ApprovalResponse[] = [];
  const out: string[] = [];
  const superseded: SupersededReason[] = [];
  const queue = [...lines];
  const rest = [...results];
  const sink = createApprovalPrompter({
    io: {
      readLine: () => Promise.resolve(queue.shift() ?? null),
      stdout: (text) => {
        out.push(text);
        return Promise.resolve();
      },
    },
    respond: (_id, response) => {
      sent.push(response);
      return Promise.resolve(rest.shift() ?? { applied: true });
    },
    onError: () => undefined,
    onSuperseded: (_id, reason) => {
      superseded.push(reason);
    },
  });
  sink.offer(approvalViewOf("evt_1", payloadOf()));
  return { sink, sent, out, superseded };
}

test("answer_invalid shows the detail and asks again; the second answer is sent", async () => {
  const p = prompter(
    [{ applied: false, reason: "answer_invalid", detail: "mode가 목록에 없다" }],
    ["y", "t"],
  );
  await p.sink.idle();
  expect(p.sent).toEqual([
    { decision: "allow", remember: "once" },
    { decision: "allow", remember: "thread" },
  ]);
  expect(p.out).toContain("응답이 요청과 맞지 않다: mode가 목록에 없다. 다시 입력한다\n");
  expect(p.superseded).toEqual([]);
});

test("commit_failed asks again, and gives up after three tries leaving the approval pending", async () => {
  const failed: ApprovalRespondResult = { applied: false, reason: "commit_failed" };
  const p = prompter([failed, failed, failed], ["y", "y", "y"]);
  await p.sink.idle();
  expect(p.sent).toHaveLength(3);
  expect(
    p.out.filter((text) => text === "승인 응답을 기록하지 못했다. 다시 입력한다\n"),
  ).toHaveLength(2);
  expect(p.out.at(-1)).toBe("응답이 계속 적용되지 않아 이 승인은 대기로 남긴다\n");
  expect(p.superseded).toEqual([]);
});

test("already_resolved and unknown_approval close the prompt with their own reason", async () => {
  const a = prompter([{ applied: false, reason: "already_resolved" }], ["y"]);
  await a.sink.idle();
  expect(a.sent).toHaveLength(1);
  expect(a.superseded).toEqual(["already_resolved"]);

  const b = prompter([{ applied: false, reason: "unknown_approval" }], ["y"]);
  await b.sink.idle();
  expect(b.superseded).toEqual(["unknown_approval"]);

  const c = prompter([{ applied: false }], ["y"]);
  await c.sink.idle();
  expect(c.superseded).toEqual(["unspecified"]);
});

test("an unknown approval is told apart from one answered elsewhere on the terminal", async () => {
  const input = scriptedInput(["go", "y", "/quit"]);
  const h = createHarness({
    terminal: TTY,
    env: { NO_COLOR: "1" },
    readLine: (prompt, signal) => input.readLine(prompt, signal),
    server: {
      handlers: { "approval.respond": () => ({ applied: false, reason: "unknown_approval" }) },
      onTurn: (context) => {
        context.server.commit(context.threadId, [
          approvalRequested(context.threadId, context.turnId),
          turnCompleted(context.turnId),
        ]);
      },
    },
  });
  harnesses.push(h);
  expect(await h.run(["chat"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toContain("(host가 모르는 승인이다. 재시작으로 사라졌을 수 있다)");
});

test("print mode tells when its deny answer was not applied", async () => {
  const h = createHarness({
    env: { NO_COLOR: "1" },
    server: {
      handlers: { "approval.respond": () => ({ applied: false, reason: "already_resolved" }) },
      onTurn: (context) => {
        context.server.commit(context.threadId, [
          approvalRequested(context.threadId, context.turnId),
          turnCompleted(context.turnId),
        ]);
      },
    },
  });
  harnesses.push(h);
  expect(await h.run(["chat", "-p", "run it"])).toBe(EXIT.ok);
  expect(h.stderrText()).toContain(
    '승인 요청 "bash 실행"에 비대화 모드라 거부로 답했으나 적용되지 않았다 (already_resolved)',
  );
});

test("a review approval shows its title, round and one row per file (compile fix for ADR-0018 review)", () => {
  const review = {
    kind: "review",
    review: {
      reviewId: "rvw_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      artifactId: "art_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      title: "refactor loader",
      round: 2,
      files: [
        { path: "src/a.ts", change: "modified", binary: false, hunks: 3 },
        { path: "logo.png", change: "added", binary: true, hunks: 0 },
      ],
    },
  };
  const view = approvalViewOf("evt_1", payloadOf({ body: review }));
  expect(view.body.slice(-3)).toEqual([
    "검토: refactor loader (라운드 2)",
    "modified src/a.ts (hunk 3)",
    "added logo.png (hunk 0)",
  ]);
  expect(view.allowsAnswer).toBe(false);
});
