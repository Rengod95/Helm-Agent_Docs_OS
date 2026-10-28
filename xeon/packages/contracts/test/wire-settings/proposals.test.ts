import { describe, expect, test } from "bun:test";
import type { TSchema } from "typebox";
import { parse } from "../../src/base/index.ts";
import {
  PROPOSAL_DECIDE_FAILURES,
  PROPOSAL_SOURCES,
  ProposalDecideResultSchema,
  ProposalRowSchema,
  WIRE_METHODS,
  classifyMethodName,
} from "../../src/wire-settings/wire/index.ts";
import { rawId } from "../helpers/ids.ts";

function accepts(schema: TSchema, value: unknown): boolean {
  return parse(schema, value).ok;
}

const row = {
  source: "learning",
  id: "prop_1",
  kind: "skill",
  op: "create",
  target: "git-rebase",
  status: "pending",
  destructive: false,
  diff: "+ steps",
  rationale: "repeated twice",
  evidence: [{ eventId: "evt_1", threadId: rawId("thr", 1) }],
  conflictsWith: null,
  reason: null,
  revision: 1,
  scope: "user",
  afterUntrusted: false,
  createdAt: 1_790_000_000_000,
};

const knowledgeRow = {
  ...row,
  source: "knowledge",
  id: "pro_9",
  evidence: [],
  rationale: null,
  scope: null,
  status: "stale",
};

describe("proposal.* wire (M3-REQ-18, D-M3-32 a)", () => {
  test("two sources, one list row shape", () => {
    expect(PROPOSAL_SOURCES).toEqual(["learning", "knowledge"]);
    expect(accepts(ProposalRowSchema, row)).toBe(true);
    expect(accepts(ProposalRowSchema, knowledgeRow)).toBe(true);
    expect(accepts(ProposalRowSchema, { ...row, source: "queue" })).toBe(false);
    expect(accepts(ProposalRowSchema, { ...row, status: "approving" })).toBe(false);
    expect(accepts(ProposalRowSchema, { ...row, revision: 0 })).toBe(false);
    expect(accepts(ProposalRowSchema, { ...row, extra: 1 })).toBe(false);
  });

  test("registered as M3 core methods with valid names", () => {
    expect(Object.keys(WIRE_METHODS).filter((n) => n.startsWith("proposal."))).toEqual([
      "proposal.list",
      "proposal.decide",
    ]);
    for (const name of ["proposal.list", "proposal.decide"]) {
      expect(classifyMethodName(name)).toBe("core");
    }
    expect(WIRE_METHODS["proposal.list"].stage).toBe("M3");
    expect(WIRE_METHODS["proposal.decide"].stage).toBe("M3");
  });

  test("proposal.list params", () => {
    const { params } = WIRE_METHODS["proposal.list"];
    expect(accepts(params, {})).toBe(true);
    expect(accepts(params, { source: "knowledge", status: ["pending", "stale"], limit: 200 })).toBe(
      true,
    );
    expect(accepts(params, { _meta: {} })).toBe(true);
    for (const bad of [
      { source: "other" },
      { status: [] },
      { status: ["done"] },
      { limit: 0 },
      { limit: 201 },
      { cursor: "" },
    ]) {
      expect(accepts(params, bad)).toBe(false);
    }
  });

  test("proposal.list result merges rows and names unavailable sources", () => {
    const { result } = WIRE_METHODS["proposal.list"];
    expect(
      accepts(result, { proposals: [row, knowledgeRow], nextCursor: null, unavailable: [] }),
    ).toBe(true);
    expect(accepts(result, { proposals: [], nextCursor: "c1", unavailable: ["knowledge"] })).toBe(
      true,
    );
    expect(accepts(result, { proposals: [], nextCursor: null })).toBe(false);
    expect(accepts(result, { proposals: [], nextCursor: null, unavailable: ["x"] })).toBe(false);
  });

  test("proposal.decide params are a union keyed by decision", () => {
    const { params } = WIRE_METHODS["proposal.decide"];
    const target = { source: "learning", id: "prop_1" };
    expect(accepts(params, { ...target, decision: "approve" })).toBe(true);
    expect(accepts(params, { ...target, decision: "approve", revision: 2, scope: "project" })).toBe(
      true,
    );
    expect(accepts(params, { ...target, decision: "reject", note: "no" })).toBe(true);
    expect(accepts(params, { ...target, decision: "edit", body: "new body" })).toBe(true);
    expect(accepts(params, { ...target, decision: "revert" })).toBe(true);
    expect(accepts(params, { ...target, decision: "approve", _meta: {} })).toBe(true);
    for (const bad of [
      { ...target, decision: "approve", body: "x" },
      { ...target, decision: "reject", revision: 1 },
      { ...target, decision: "edit" },
      { ...target, decision: "edit", body: "" },
      { ...target, decision: "revert", note: "x" },
      { ...target, decision: "approve", scope: "global" },
      { ...target, decision: "approve", revision: 0 },
      { ...target, decision: "archive" },
      { source: "learning", decision: "approve" },
      { ...target, source: "x", decision: "approve" },
    ]) {
      expect(accepts(params, bad)).toBe(false);
    }
  });

  test("proposal.decide result: success carries the row, failure carries a reason from the closed set", () => {
    expect(accepts(ProposalDecideResultSchema, { ok: true, proposal: row, applied: false })).toBe(
      true,
    );
    for (const reason of PROPOSAL_DECIDE_FAILURES) {
      expect(accepts(ProposalDecideResultSchema, { ok: false, reason })).toBe(true);
    }
    expect(PROPOSAL_DECIDE_FAILURES).toEqual([
      "not_found",
      "revision_mismatch",
      "closed",
      "scope_not_allowed",
      "unsupported",
      "base_stale",
      "scan_failed",
      "approval_required",
      "unavailable",
    ]);
    expect(accepts(ProposalDecideResultSchema, { ok: false, reason: "boom" })).toBe(false);
    expect(accepts(ProposalDecideResultSchema, { ok: true, applied: true })).toBe(false);
  });
});
