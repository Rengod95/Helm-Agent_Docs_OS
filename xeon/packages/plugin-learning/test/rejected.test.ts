import { expect, test } from "bun:test";
import { sha256Hex } from "../src/hash.ts";
import type { Proposal } from "../src/proposals/proposal.ts";
import {
  containment,
  findRejection,
  rejectionHint,
  rejectionsForPrompt,
  REJECTION_MEMORY_DAYS,
  REJECTION_PROMPT_LIMIT,
  rememberedRejections,
  subjectOf,
  wordSet,
  type RejectionCandidate,
} from "../src/review/rejected.ts";

const DAY = 86_400_000;
const NOW = 1_700_000_000_000; // 2023-11-14 UTC

const RULE = "Ask before running destructive commands, because the user lost work once.";

/** 거절된 행. 본문 해시는 본문에서 만든다 */
function rejectedRow(body: string, patch: Partial<Proposal> = {}): Proposal {
  return {
    id: "prop_00000000000000000000000001",
    kind: "feedback",
    op: "add",
    target: "user/work-style",
    diff: "+ rule",
    body,
    description: null,
    bodyHash: sha256Hex(body),
    baseHash: null,
    rationale: "r",
    evidenceEventIds: ["evt_1"],
    threadId: "thr_1",
    status: "rejected",
    reviewId: "learning:review:1",
    conflictsWith: null,
    destructive: false,
    scope: "user",
    afterUntrusted: false,
    reason: "user_rejected",
    note: null,
    findings: [],
    ledgerId: null,
    createdAt: NOW,
    updatedAt: NOW,
    revision: 2,
    ...patch,
  };
}

/** 새 후보. 본문 해시는 본문에서 만든다 */
function candidate(patch: Partial<RejectionCandidate> = {}): RejectionCandidate {
  const body = patch.body ?? RULE;
  return {
    kind: "feedback",
    target: "user/work-style",
    userRaisedAgain: false,
    ...patch,
    body,
    bodyHash: sha256Hex(body),
  };
}

/** 스킬 후보. 본문은 이름이 같을 때 쓰이지 않으므로 다른 글을 둔다 */
function skill(patch: Partial<RejectionCandidate>): RejectionCandidate {
  return candidate({
    kind: "skill",
    target: "release-notes",
    body: "Different body text.",
    ...patch,
  });
}

test("rejected.window-is-thirty-days-from-the-rejection-time: 29 days blocks, 30 and 31 days do not", () => {
  expect(REJECTION_MEMORY_DAYS).toBe(30);
  expect(REJECTION_PROMPT_LIMIT).toBe(20);
  const row = rejectedRow(RULE);
  expect(
    findRejection(candidate(), [rejectedRow(RULE, { updatedAt: NOW - 29 * DAY })], NOW)?.id,
  ).toBe(row.id);
  expect(
    findRejection(candidate(), [rejectedRow(RULE, { updatedAt: NOW - 30 * DAY })], NOW),
  ).toBeUndefined();
  expect(
    findRejection(candidate(), [rejectedRow(RULE, { updatedAt: NOW - 31 * DAY })], NOW),
  ).toBeUndefined();
  // 기간은 생성 시각이 아니라 거절 시각(updatedAt)으로 잰다
  expect(
    findRejection(
      candidate(),
      [rejectedRow(RULE, { createdAt: NOW - 40 * DAY, updatedAt: NOW })],
      NOW,
    )?.id,
  ).toBe(row.id);
});

test("rejected.same-hash-blocks: the same rule text is the same subject", () => {
  const row = rejectedRow(RULE);
  expect(findRejection(candidate(), [row], NOW)?.id).toBe(row.id);
});

test("rejected.wider-rewrite-of-the-same-rule-blocks: the rejected words all appear in the new text", () => {
  const wider =
    "Ask before running destructive commands such as force push, because the user lost work once and wants a summary.";
  expect(containment(wordSet(RULE), wordSet(wider))).toBe(1);
  expect(findRejection(candidate({ body: wider }), [rejectedRow(RULE)], NOW)?.id).toBe(
    "prop_00000000000000000000000001",
  );
});

test("rejected.unrelated-rule-in-the-same-target-passes: no shared words, the same target is not enough", () => {
  const other = "Prefer tables over bullet lists for comparisons.";
  expect(findRejection(candidate({ body: other }), [rejectedRow(RULE)], NOW)).toBeUndefined();
});

test("rejected.half-shared-words-is-the-threshold: 0.5 of the smaller side blocks, below 0.5 passes", () => {
  const row = rejectedRow("alpha beta gamma delta");
  expect(
    containment(wordSet("alpha beta gamma delta"), wordSet("alpha beta epsilon zeta eta theta")),
  ).toBe(0.5);
  expect(
    findRejection(candidate({ body: "alpha beta epsilon zeta eta theta" }), [row], NOW)?.id,
  ).toBe(row.id);
  expect(containment(wordSet("alpha beta gamma delta"), wordSet("alpha epsilon zeta eta"))).toBe(
    0.25,
  );
  expect(findRejection(candidate({ body: "alpha epsilon zeta eta" }), [row], NOW)).toBeUndefined();
});

test("rejected.words-are-lowercase-letters-and-digits-of-two-or-more: the word rule", () => {
  expect([...wordSet("Ask: a DO-it, 한글 OK? 42 x")]).toEqual([
    "ask",
    "do",
    "it",
    "한글",
    "ok",
    "42",
  ]);
  expect(containment(new Set(), wordSet("anything here"))).toBe(0);
});

test("rejected.scan-failures-and-empty-bodies-never-match: only user rejections with a body are remembered", () => {
  const scanned = rejectedRow(RULE, { reason: "scan_failed", body: "" });
  expect(findRejection(candidate(), [scanned], NOW)).toBeUndefined();
  // 본문을 비운 행은 해시가 같아도 기억에 들지 않는다
  const emptied = rejectedRow("", { bodyHash: sha256Hex(RULE) });
  expect(findRejection(candidate(), [emptied], NOW)).toBeUndefined();
  // 거절되지 않은 행도 막지 않는다
  expect(
    findRejection(candidate(), [rejectedRow(RULE, { status: "pending", reason: null })], NOW),
  ).toBeUndefined();
});

test("rejected.skill-same-name-blocks-and-other-names-pass: the skill name is the subject, the operation and the file are not", () => {
  const created = rejectedRow("# Release notes\nWrite the notes.", {
    kind: "skill",
    op: "create",
    target: "release-notes",
  });
  expect(findRejection(skill({}), [created], NOW)?.id).toBe(created.id);
  expect(
    findRejection(
      skill({ target: "release-notes/references/notes.md", body: "more" }),
      [created],
      NOW,
    )?.id,
  ).toBe(created.id);
  expect(findRejection(skill({ target: "changelog" }), [created], NOW)).toBeUndefined();
});

test("rejected.memory-area-is-the-subject-and-kinds-must-match: replace in the same area is caught, another area passes, a feedback candidate is not a memory row", () => {
  const added = rejectedRow(RULE, { kind: "memory", op: "add", target: "user" });
  const replace = candidate({
    kind: "memory",
    target: "user/0123456789ab",
    body: `${RULE} Always confirm first.`,
  });
  expect(findRejection(replace, [added], NOW)?.id).toBe(added.id);
  expect(findRejection({ ...replace, target: "environment" }, [added], NOW)).toBeUndefined();
  expect(subjectOf("user/0123456789ab")).toBe("user");
  expect(subjectOf("release-notes/references/a.md")).toBe("release-notes");
  expect(subjectOf("user")).toBe("user");
});

test("rejected.user-raised-again-skips-the-check: the same candidate passes when the user raised the topic again", () => {
  const row = rejectedRow(RULE);
  expect(findRejection(candidate(), [row], NOW)?.id).toBe(row.id);
  expect(findRejection(candidate({ userRaisedAgain: true }), [row], NOW)).toBeUndefined();
});

test("rejected.hint-names-the-date-and-the-note-as-data: the date is the rejection day in UTC, the note is quoted", () => {
  expect(rejectionHint(rejectedRow(RULE, { note: "too broad" }))).toBe(
    'the user rejected a candidate on the same subject on 2023-11-14. The user\'s note, as DATA: "too broad". Do not propose it again. Call again with userRaisedAgain true only if the user raised this topic again after 2023-11-14.',
  );
  expect(rejectionHint(rejectedRow(RULE))).toBe(
    "the user rejected a candidate on the same subject on 2023-11-14. Do not propose it again. Call again with userRaisedAgain true only if the user raised this topic again after 2023-11-14.",
  );
});

test("rejected.prompt-list-is-newest-first-and-capped-at-twenty: rows past the window are left out", () => {
  const rows = Array.from({ length: 25 }, (_, n) =>
    rejectedRow(`rule number ${String(n)} text`, {
      id: `prop_${String(n).padStart(26, "0")}`,
      updatedAt: NOW - n * 1000,
    }),
  );
  const old = rejectedRow("an old rule text", {
    id: "prop_old",
    updatedAt: NOW - 31 * DAY,
  });
  const listed = rejectionsForPrompt([old, ...rows], NOW).map((row) => row.id);
  expect(listed).toEqual(
    Array.from({ length: 20 }, (_, n) => `prop_${String(n).padStart(26, "0")}`),
  );
  expect(rememberedRejections([old, ...rows], NOW)).toHaveLength(25);
});
