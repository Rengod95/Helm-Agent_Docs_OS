import { describe, expect, test } from "bun:test";
import {
  alwaysRememberOf,
  approvalAgeOf,
  approvalExpiryOf,
  approvalKeyOf,
  feedbackTextOf,
  FEEDBACK_MAX,
  foldPlanLines,
  PLAN_FOLD_LINES,
  reviewTotalsOf,
  threadLinkVisibleOf,
} from "../../src/views/approval-card/card-model.ts";
import type { ApprovalRequestedPayload } from "@fresnel/contracts/records";
import { thr } from "../state/helpers.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("approval age", () => {
  test("under a minute is now, then the whole minutes, hours and days", () => {
    expect(approvalAgeOf(10 * MINUTE, 10 * MINUTE - 59_999)).toEqual({ unit: "now" });
    expect(approvalAgeOf(10 * MINUTE, 10 * MINUTE - MINUTE)).toEqual({ unit: "minutes", count: 1 });
    expect(approvalAgeOf(10 * HOUR, 10 * HOUR - 2 * HOUR - 1)).toEqual({ unit: "hours", count: 2 });
    expect(approvalAgeOf(5 * DAY, 0)).toEqual({ unit: "days", count: 5 });
  });

  test("a request time in the future counts as now", () => {
    expect(approvalAgeOf(0, 5 * MINUTE)).toEqual({ unit: "now" });
  });
});

function requestWith(extra: Partial<ApprovalRequestedPayload>): ApprovalRequestedPayload {
  return {
    origin: { threadId: thr(1), turnId: null, stepId: null, toolCallId: null, caller: "main" },
    requestKey: "k",
    title: "Run",
    remember: ["once"],
    surfaceThreadId: thr(1),
    requestedAt: 0,
    body: {
      kind: "question",
      question: {
        questions: [{ id: "q", text: "ok?", options: [], multiSelect: false, allowFreeText: true }],
      },
    },
    ...extra,
  };
}

describe("approval expiry", () => {
  test("no expiresAt means no expiry line", () => {
    expect(approvalExpiryOf(requestWith({}))).toBeNull();
  });

  test("an expiry without onExpire auto-denies; an answer onExpire auto-answers", () => {
    expect(approvalExpiryOf(requestWith({ expiresAt: 1234 }))).toEqual({
      at: 1234,
      decision: "deny",
    });
    expect(
      approvalExpiryOf(
        requestWith({ expiresAt: 99, onExpire: { decision: "answer", answer: { q: "x" } } }),
      ),
    ).toEqual({ at: 99, decision: "answer" });
  });
});

type KeyFlags = Partial<Record<"shiftKey" | "metaKey" | "ctrlKey" | "altKey", boolean>>;

const key = (value: string, flags: KeyFlags = {}) => ({
  key: value,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...flags,
});

describe("approval keys", () => {
  test("Y is the primary answer, Shift+Y the always answer, N the refusal", () => {
    expect(approvalKeyOf(key("y"))).toBe("primary");
    expect(approvalKeyOf(key("Y", { shiftKey: true }))).toBe("always");
    expect(approvalKeyOf(key("n"))).toBe("deny");
    expect(approvalKeyOf(key("N"))).toBe("deny");
  });

  test("Shift+N and other letters are not card keys", () => {
    expect(approvalKeyOf(key("N", { shiftKey: true }))).toBeNull();
    expect(approvalKeyOf(key("a"))).toBeNull();
  });

  test("a key with ⌘, Ctrl or Alt is left to the shell shortcuts", () => {
    expect(approvalKeyOf(key("y", { metaKey: true }))).toBeNull();
    expect(approvalKeyOf(key("n", { ctrlKey: true }))).toBeNull();
    expect(approvalKeyOf(key("Y", { shiftKey: true, altKey: true }))).toBeNull();
  });
});

describe("plan fold", () => {
  test("a plan of PLAN_FOLD_LINES lines or fewer is shown whole", () => {
    const text = Array.from({ length: PLAN_FOLD_LINES }, (_, i) => `${i + 1}`).join("\n");
    expect(foldPlanLines(text, PLAN_FOLD_LINES)).toEqual({ head: text, rest: null });
  });

  test("a longer plan shows the first lines and folds the rest", () => {
    const lines = Array.from({ length: PLAN_FOLD_LINES + 2 }, (_, i) => `line ${i + 1}`);
    const folded = foldPlanLines(lines.join("\n"), PLAN_FOLD_LINES);
    expect(folded.head.split("\n")).toHaveLength(PLAN_FOLD_LINES);
    expect(folded.head.endsWith(`line ${PLAN_FOLD_LINES}`)).toBe(true);
    expect(folded.rest).toBe(`line ${PLAN_FOLD_LINES + 1}\nline ${PLAN_FOLD_LINES + 2}`);
  });
});

describe("review totals", () => {
  test("the file count is the list length and the hunk count is their sum", () => {
    expect(reviewTotalsOf([{ hunks: 4 }, { hunks: 2 }, { hunks: 1 }])).toEqual({
      files: 3,
      hunks: 7,
    });
    expect(reviewTotalsOf([])).toEqual({ files: 0, hunks: 0 });
  });
});

describe("always-in-this-conversation memory", () => {
  test("offered when the request lists thread, or always (which the core stores as thread)", () => {
    expect(alwaysRememberOf(["once", "thread"])).toBe("thread");
    expect(alwaysRememberOf(["always"])).toBe("always");
  });

  test("not offered for a once-only request", () => {
    expect(alwaysRememberOf(["once"])).toBeNull();
    expect(alwaysRememberOf([])).toBeNull();
  });
});

describe("feedback text", () => {
  test("blank feedback is no feedback; the rest is trimmed", () => {
    expect(feedbackTextOf("   ")).toBeNull();
    expect(feedbackTextOf("")).toBeNull();
    expect(feedbackTextOf("  split the step  ")).toBe("split the step");
  });

  test("feedback is cut at the contract's maximum length", () => {
    const long = "a".repeat(FEEDBACK_MAX + 5);
    expect(feedbackTextOf(long)?.length).toBe(FEEDBACK_MAX);
  });
});

describe("thread link in the card head", () => {
  const T1 = thr(1);
  const T2 = thr(2);

  test("the name links only outside the transcript of its own conversation", () => {
    // 받은 요청(밖, null)은 다른 대화든 같은 대화든 링크다
    expect(threadLinkVisibleOf({ threadId: T1, within: null, openable: true })).toBe(true);
    expect(threadLinkVisibleOf({ threadId: T1, within: T2, openable: true })).toBe(true);
    // 그 대화의 트랜스크립트 안에서는 링크가 없다
    expect(threadLinkVisibleOf({ threadId: T1, within: T1, openable: true })).toBe(false);
  });

  test("a conversation that cannot be opened is never a link", () => {
    expect(threadLinkVisibleOf({ threadId: T1, within: null, openable: false })).toBe(false);
    expect(threadLinkVisibleOf({ threadId: T1, within: T2, openable: false })).toBe(false);
    expect(threadLinkVisibleOf({ threadId: T1, within: T1, openable: false })).toBe(false);
  });
});
