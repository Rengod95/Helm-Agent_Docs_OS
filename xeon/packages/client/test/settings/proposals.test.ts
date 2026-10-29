import { describe, expect, test } from "bun:test";
import type { ProposalDecideResult, ProposalListResult, ProposalRow } from "@xeon/contracts/wire";
import { parse } from "@xeon/contracts";
import { ThreadIdSchema } from "@xeon/contracts/conversation";
import {
  decisionOutcomeOf,
  decisionParams,
  proposalListView,
  type ProposalRowVM,
} from "../../src/settings/index.ts";

// M3-18 L4: 두 대기열(학습, 지식)을 한 목록으로 보이는 view-model, 동작의 `proposal.decide` params, 결과 문구.

const THREAD = ((): ProposalRow["evidence"][number]["threadId"] => {
  const parsed = parse(ThreadIdSchema, "thr_00000000000000000000000001");
  if (!parsed.ok) throw new Error("test id must parse");
  return parsed.value;
})();

function row(overrides: Partial<ProposalRow>): ProposalRow {
  return {
    source: "learning",
    id: "p1",
    kind: "skill",
    op: "create",
    target: "skills/review.md",
    status: "pending",
    destructive: false,
    diff: "+ line",
    rationale: "자주 반복했다",
    evidence: [{ eventId: "evt_1", threadId: THREAD }],
    conflictsWith: null,
    reason: null,
    revision: 3,
    scope: null,
    afterUntrusted: false,
    createdAt: 1000,
    ...overrides,
  };
}

function listOf(proposals: readonly ProposalRow[]): ProposalListResult {
  return { proposals: [...proposals], nextCursor: null, unavailable: [] };
}

function vm(overrides: Partial<ProposalRow>): ProposalRowVM {
  const first = proposalListView(listOf([row(overrides)])).rows[0];
  if (first === undefined) throw new Error("expected a row");
  return first;
}

describe("proposalListView", () => {
  test("two sources become one list with labels, keys and the actions each row allows", () => {
    const view = proposalListView(
      listOf([
        row({ id: "a", source: "learning", status: "pending" }),
        row({ id: "a", source: "knowledge", kind: "memory", status: "pending", revision: 1 }),
        row({ id: "b", source: "learning", status: "applied" }),
        row({ id: "c", source: "knowledge", kind: "memory", status: "applied", revision: 1 }),
        row({ id: "d", source: "learning", status: "rejected" }),
        row({ id: "e", source: "knowledge", kind: "memory", status: "stale", revision: 1 }),
      ]),
    );
    expect(view.rows.map((r) => [r.key, r.sourceLabel, r.statusLabel, r.actions])).toEqual([
      ["learning:a", "학습", "대기 중", ["approve", "reject", "edit"]],
      ["knowledge:a", "지식", "대기 중", ["approve", "reject"]],
      ["learning:b", "학습", "적용됨", ["revert"]],
      ["knowledge:c", "지식", "적용됨", []],
      ["learning:d", "학습", "거절됨", []],
      ["knowledge:e", "지식", "오래됨", []],
    ]);
    expect(view.emptyText).toBeNull();
  });

  test("only skills choose a scope, defaulting to user", () => {
    expect(vm({ kind: "skill" }).scopeChoice).toEqual({
      allowed: ["user", "project"],
      initial: "user",
    });
    expect(vm({ kind: "memory" }).scopeChoice).toBeNull();
  });

  test("warnings and evidence count are carried, an empty list says why, and an unreadable source is named", () => {
    const flagged = vm({
      destructive: true,
      afterUntrusted: true,
      conflictsWith: "skills/other.md",
    });
    expect(flagged).toMatchObject({
      destructive: true,
      afterUntrusted: true,
      conflictsWith: "skills/other.md",
      evidenceCount: 1,
    });
    const empty = proposalListView({
      proposals: [],
      nextCursor: "next",
      unavailable: ["knowledge"],
    });
    expect(empty.rows).toEqual([]);
    expect(empty.emptyText).toBe("대기 중인 제안이 없어요");
    expect(empty.unavailableTexts).toEqual(["지식 제안을 불러오지 못했어요"]);
    expect(empty.nextCursor).toBe("next");
  });
});

describe("decisionParams", () => {
  test("approve sends the revision the list showed, and a skill's scope (user by default)", () => {
    expect(decisionParams(vm({}), "approve")).toEqual({
      ok: true,
      value: { source: "learning", id: "p1", decision: "approve", revision: 3, scope: "user" },
    });
    expect(decisionParams(vm({}), "approve", { scope: "project" })).toEqual({
      ok: true,
      value: { source: "learning", id: "p1", decision: "approve", revision: 3, scope: "project" },
    });
    expect(
      decisionParams(vm({ kind: "memory", source: "knowledge", revision: 1 }), "approve"),
    ).toEqual({
      ok: true,
      value: { source: "knowledge", id: "p1", decision: "approve", revision: 1 },
    });
    expect(
      decisionParams(vm({ kind: "memory", source: "knowledge", revision: 1 }), "approve", {
        scope: "user",
      }),
    ).toEqual({ ok: false, error: { kind: "scope_not_applicable" } });
  });

  test("reject trims the note and leaves it out when it is empty", () => {
    expect(decisionParams(vm({}), "reject", { note: "  필요 없어요 " })).toEqual({
      ok: true,
      value: { source: "learning", id: "p1", decision: "reject", note: "필요 없어요" },
    });
    expect(decisionParams(vm({}), "reject", { note: "   " })).toEqual({
      ok: true,
      value: { source: "learning", id: "p1", decision: "reject" },
    });
  });

  test("edit needs a body and sends the revision; revert sends none", () => {
    expect(decisionParams(vm({}), "edit", { body: "" })).toEqual({
      ok: false,
      error: { kind: "empty_body" },
    });
    expect(decisionParams(vm({}), "edit", { body: "새 본문" })).toEqual({
      ok: true,
      value: { source: "learning", id: "p1", decision: "edit", revision: 3, body: "새 본문" },
    });
    expect(decisionParams(vm({ status: "applied" }), "revert")).toEqual({
      ok: true,
      value: { source: "learning", id: "p1", decision: "revert" },
    });
  });

  test("an action the row does not allow is refused before anything is sent", () => {
    expect(
      decisionParams(vm({ source: "knowledge", kind: "memory" }), "edit", { body: "x" }),
    ).toEqual({
      ok: false,
      error: { kind: "not_allowed", action: "edit" },
    });
    expect(decisionParams(vm({ status: "rejected" }), "approve")).toEqual({
      ok: false,
      error: { kind: "not_allowed", action: "approve" },
    });
  });
});

describe("decisionOutcomeOf", () => {
  test("a taken decision returns the updated row and whether it was applied", () => {
    const outcome = decisionOutcomeOf({
      ok: true,
      proposal: row({ status: "applied" }),
      applied: true,
    });
    expect(outcome).toMatchObject({ kind: "done", applied: true });
    if (outcome.kind === "done") expect(outcome.proposal.statusLabel).toBe("적용됨");
  });

  test("every failure has a sentence, the reasons that mean the list is stale ask for a reload, and the server detail is not shown", () => {
    const reasons: readonly [Extract<ProposalDecideResult, { ok: false }>["reason"], boolean][] = [
      ["not_found", true],
      ["revision_mismatch", true],
      ["closed", true],
      ["base_stale", true],
      ["scope_not_allowed", false],
      ["unsupported", false],
      ["scan_failed", false],
      ["approval_required", false],
      ["unavailable", false],
    ];
    for (const [reason, reload] of reasons) {
      const outcome = decisionOutcomeOf({ ok: false, reason, detail: "SERVER-DETAIL /etc/secret" });
      expect(outcome.kind).toBe("failed");
      if (outcome.kind !== "failed") continue;
      expect(outcome.reload).toBe(reload);
      expect(outcome.text.length).toBeGreaterThan(0);
      expect(outcome.text).not.toContain("SERVER-DETAIL");
    }
  });
});
