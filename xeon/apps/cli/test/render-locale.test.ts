import { afterEach, beforeEach, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, type Locale } from "@xeon/client/i18n";
import type { ScopeHandlerFailedPayload } from "@xeon/contracts/records";
import type { NotifyDeliveredParams, TrustStatus } from "@xeon/contracts/wire";
import type { PromptIo } from "../src/render/approval.ts";
import { createLockPrompt } from "../src/render/lock.ts";
import { deliveredText, handlerFailedText } from "../src/render/notices.ts";
import { pieceOf } from "../src/render/text-sink.ts";
import { resultLines } from "../src/render/tools.ts";
import { describeTrust } from "../src/render/trust.ts";
import { threadId } from "./support/ids.ts";

// 렌더 문장(잠금, 신뢰 카드, 알림, 승인 결과, 도구 줄)을 영어 로케일에서 전체 문자열로 비교한다.
// 시험 프로세스의 로케일은 ko이므로 끝나면 되돌린다.

let before: Locale = "ko";

beforeEach(() => {
  before = activeLocale();
  setActiveLocale("en");
});

afterEach(() => {
  setActiveLocale(before);
});

const ROOT = "/work/project";

test("the lock prompt names the owner and the options in English", async () => {
  const shown: string[] = [];
  const answers: (string | null)[] = ["x", null];
  const io: PromptIo = {
    readLine: () => Promise.resolve(answers.shift() ?? null),
    stdout: (text) => {
      shown.push(text);
      return Promise.resolve();
    },
  };
  const pick = createLockPrompt(io);
  const choice = await pick(
    { ownerKind: "cli", options: ["observe", "fork"] },
    new AbortController().signal,
  );
  expect(choice).toBe("cancel");
  expect(shown).toEqual([
    "Another process (cli) is using this session.\n  [o] Watch only\n  [f] Fork into a new session\n  [Enter] Cancel\n",
    "Enter one of the letters shown\n",
  ]);
});

test("the trust card is written in English and numbers its options", () => {
  const status: TrustStatus = {
    projectRoot: ROOT,
    required: true,
    verdict: "allow",
    via: "prompt",
    resources: ["AGENTS.md"],
    options: [
      { choice: { kind: "folder", verdict: "allow" }, label: "trust-folder", savedPath: ROOT },
      { choice: { kind: "session", verdict: "deny" }, label: "deny-session", savedPath: null },
    ],
  };
  expect(describeTrust(status)).toBe(
    [
      "Project: /work/project",
      "Resources to load: AGENTS.md",
      "Verdict: Trusted - Decided just now by asking",
      "If trusted, this resource's instructions, commands and MCP servers run with your permissions. If not trusted, it is not read",
      "  1) Trust this folder (saved: /work/project)",
      "  2) Do not trust for this run only (not saved)",
      "",
    ].join("\n"),
  );
});

test("a notice of another thread is in English with a bracketed kind", () => {
  const params: NotifyDeliveredParams = {
    threadId: threadId(2),
    notice: { kind: "completed", title: "Done", body: "x", seq: 7, sourceType: "dialog.notified" },
    deliveredAt: "2026-01-05T00:00:00.000Z",
  };
  expect(deliveredText(params, threadId(1))).toBe("[done] Done (other conversation)\nx");
});

test("a handler failure names the extension in English", () => {
  const failed: ScopeHandlerFailedPayload = {
    owner: "ext:acme",
    point: "tool.before",
    result: "throw",
    message: "boom",
    consecutive: 1,
  };
  expect(handlerFailedText(failed)).toBe(
    "Extension acme failed in its tool.before handler (1 in a row): boom",
  );
});

test("the approval downgrade notice says what was asked and what was applied", () => {
  const piece = pieceOf(
    {
      kind: "approvalResolved",
      approvalId: "ap",
      decision: "allow",
      remember: "thread",
      requestedRemember: "always",
      resolvedBy: "user",
    },
    "full",
    false,
  );
  expect(piece).toEqual({
    target: "stderr",
    text: "You chose always allow, but it was applied as allow for this session\n",
  });
});

test("a read result line counts its lines in English", () => {
  expect(resultLines("read", { path: "a.ts", kind: "text", text: "x\ny\nz" }, [], 80)).toEqual([
    "a.ts (3 lines)",
  ]);
});
