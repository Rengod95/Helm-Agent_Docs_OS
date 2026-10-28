import { expect, test } from "bun:test";
import { toJsonValue } from "@xeon/contracts/conversation";
import { LEARNING_EVENT_KINDS } from "../src/index.ts";
import {
  RECORD_KIND_PATTERN,
  validateGroupRecord,
  type GroupRecord,
} from "@xeon/contracts/extensions";
import { learningRecordKindDecls, proposedRecordOf } from "../src/records.ts";
import type { Proposal } from "../src/proposals/proposal.ts";

const BASE = { proposalId: "prop_1", target: "release-notes", reviewId: "learning:review:1" };

const EXAMPLES: Readonly<Record<string, unknown>> = {
  "grp.learning.skill.proposed": {
    ...BASE,
    op: "create",
    summary: "create release-notes",
    conflictsWith: null,
  },
  "grp.learning.skill.approved": { ...BASE, revision: 1 },
  "grp.learning.skill.rejected": { ...BASE, reason: "user_rejected" },
  "grp.learning.skill.applied": { ...BASE, ledgerId: "knl_1", skillName: "release-notes" },
  "grp.learning.memory.proposed": { ...BASE, op: "add", area: "user", summary: "add user" },
  "grp.learning.feedback.proposed": {
    ...BASE,
    signal: "frustration",
    summary: "add user/work-style",
  },
  "grp.learning.review.finished": {
    reviewId: "learning:review:1",
    outcome: "completed",
    proposalCount: 2,
    inputTokens: 10,
    outputTokens: 5,
  },
  "grp.learning.script.proposed": { ...BASE, form: "script", occurrences: 3, summary: "script" },
};

function record(kind: GroupRecord["kind"], payload: unknown): GroupRecord {
  return {
    groupId: "learning",
    kind,
    version: 1,
    subject: { type: "thread", id: "thr_1" },
    payload: toJsonValue(payload) ?? null,
  };
}

test("records.schema-valid: the eight public record kinds accept their example and refuse a wrong one", () => {
  const declared: string[] = learningRecordKindDecls.map((decl) => decl.kind);
  expect(declared.toSorted()).toEqual(Object.keys(EXAMPLES).toSorted());
  for (const decl of learningRecordKindDecls) {
    expect(new RegExp(RECORD_KIND_PATTERN).test(decl.kind)).toBe(true);
    expect(decl.kind.startsWith("grp.learning.")).toBe(true);
    const issues = validateGroupRecord(record(decl.kind, EXAMPLES[decl.kind]), decl).filter(
      (found) => found.severity === "error",
    );
    expect(issues).toEqual([]);
    const wrong = validateGroupRecord(record(decl.kind, { unexpected: true }), decl).filter(
      (found) => found.severity === "error",
    );
    expect(wrong.length).toBeGreaterThan(0);
  }
});

test("records.private-kinds: nine kinds follow the pattern, are not declared, and decode back from their payload", () => {
  expect(LEARNING_EVENT_KINDS).toHaveLength(9);
  for (const name of LEARNING_EVENT_KINDS) {
    const kind = `grp.learning.${name}`;
    expect(new RegExp(RECORD_KIND_PATTERN).test(kind)).toBe(true);
    expect(learningRecordKindDecls.some((decl) => decl.kind === kind)).toBe(false);
  }
});

function proposal(patch: Partial<Proposal>): Proposal {
  return {
    id: "prop_1",
    kind: "skill",
    op: "create",
    target: "release-notes",
    diff: "+ secret body",
    body: "secret body",
    description: null,
    bodyHash: "0".repeat(64),
    baseHash: null,
    rationale: "r",
    evidenceEventIds: ["evt_1"],
    threadId: "thr_1",
    status: "pending",
    reviewId: "learning:review:1",
    conflictsWith: "release-process",
    destructive: false,
    scope: "user",
    afterUntrusted: false,
    reason: null,
    findings: [],
    ledgerId: null,
    createdAt: 1,
    updatedAt: 1,
    revision: 1,
    ...patch,
  };
}

test("records.proposed-records-carry-no-body-and-match-their-schema", () => {
  const skill = proposedRecordOf(proposal({}));
  expect(skill?.kind).toBe("grp.learning.skill.proposed");
  expect(JSON.stringify(skill)).not.toContain("secret body");
  const memory = proposedRecordOf(proposal({ kind: "memory", op: "add", target: "environment" }));
  expect(memory).toMatchObject({
    kind: "grp.learning.memory.proposed",
    payload: { area: "environment" },
  });
  const feedback = proposedRecordOf(
    proposal({ kind: "feedback", op: "add", target: "user/work-style" }),
  );
  expect(feedback?.kind).toBe("grp.learning.feedback.proposed");
  expect(proposedRecordOf(proposal({ kind: "script", op: "create" }))).toBeUndefined();
  for (const draft of [skill, memory, feedback]) {
    const decl = learningRecordKindDecls.find((found) => found.kind === draft?.kind);
    if (decl === undefined || draft === undefined) throw new Error("missing declaration");
    expect(
      validateGroupRecord(record(draft.kind, draft.payload), decl).filter(
        (found) => found.severity === "error",
      ),
    ).toEqual([]);
  }
});
