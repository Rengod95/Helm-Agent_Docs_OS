import { afterEach, describe, expect, test } from "bun:test";
import type { CallContext } from "@xeon/contracts/capabilities";
import { SCAN_RULESET_VERSION } from "../src/scan/rules.ts";
import { treeHash } from "../src/skills/tree.ts";
import { scriptedApprovals } from "./support/approvals.ts";
import { asHost, rejection, threadIdOf, treeFrom } from "./support/helpers.ts";
import {
  agentActor,
  contextOf,
  createPlan,
  deployTarget,
  editPlan,
  hashOfDeploy,
  request,
  skillText,
} from "./support/plans.ts";
import { closeWorlds, createWorld, USER_SKILLS, userLayer, type World } from "./support/world.ts";

afterEach(closeWorlds);

const THREAD = threadIdOf(1);
const SKILL_FILE = `${USER_SKILLS}/deploy/SKILL.md`;
const DAY = 24 * 60 * 60 * 1000;

const MAIN_CALL: CallContext = contextOf(THREAD, { kind: "model", agent: "main" });

async function createDeploy(world: World, body = "v1\n"): Promise<string> {
  const created = await world.executor.apply({
    actor: { kind: "user" },
    target: deployTarget(),
    op: "skill.create",
    requestId: undefined,
    baseHash: null,
    next: treeFrom({ "SKILL.md": skillText(body) }),
    removal: "archive",
    scan: { rulesetVersion: SCAN_RULESET_VERSION, findings: [] },
    approvedBy: "user",
    evidence: undefined,
    reason: undefined,
    proposalId: undefined,
    rollbackOf: undefined,
    captureFailure: "internal",
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.value.ledgerId ?? "";
}

function noApproval(world: World): void {
  world.setLayers([userLayer({ "l2.knowledge.write.approval": false })]);
}

describe("write approval gate", () => {
  test("files unchanged before approval", async () => {
    const approvals = scriptedApprovals();
    const world = await createWorld({ approvals });
    const held = approvals.hold();
    const pending = request(world.runtime.writer, {
      plan: createPlan(),
      actor: agentActor("main"),
      context: MAIN_CALL,
    });
    // 사람이 답하기 전에는 파일도 원장도 바뀌지 않는다
    await Bun.sleep(20);
    expect(approvals.requests).toHaveLength(1);
    expect(world.fs.has(SKILL_FILE)).toBe(false);
    const before = await world.runtime.ledgerApi.list({}, asHost());
    expect(before.entries).toHaveLength(0);
    held.release({ kind: "allow" });
    const outcome = await pending;
    if (!outcome.ok) throw new Error(outcome.error.message);
    expect(outcome.value).toMatchObject({ status: "applied", approvedBy: "approval" });
    expect(world.fs.text(SKILL_FILE)).toContain("v1");
    const request1 = approvals.requests[0];
    expect(request1).toMatchObject({
      op: "skill.create",
      toolName: "skill_manage",
      capability: { id: "knowledge.skills", method: "create" },
      target: { kind: "skill", name: "deploy", scope: "user" },
      afterUntrusted: false,
    });
    expect(request1?.preview).toContain("+++ b/SKILL.md");
  });

  test("a denial keeps the files and carries the feedback", async () => {
    const approvals = scriptedApprovals();
    const world = await createWorld({ approvals });
    approvals.answerWith({ kind: "deny", feedback: "not this one" });
    const outcome = await request(world.runtime.writer, {
      plan: createPlan(),
      actor: agentActor("main"),
      context: MAIN_CALL,
    });
    expect(outcome).toMatchObject({
      ok: false,
      error: { kind: "approval_denied", detail: { feedback: "not this one" } },
    });
    expect(world.fs.has(SKILL_FILE)).toBe(false);
  });

  test("a change made while the approval was pending is refused after the answer", async () => {
    const approvals = scriptedApprovals();
    const world = await createWorld({ approvals });
    await createDeploy(world);
    const plan = await editPlan(world, "agent edit\n");
    const held = approvals.hold();
    const pending = request(world.runtime.writer, {
      plan,
      actor: agentActor("main"),
      context: MAIN_CALL,
    });
    await Bun.sleep(20);
    world.fs.put(SKILL_FILE, skillText("edited by hand\n"));
    held.release({ kind: "allow" });
    const outcome = await pending;
    expect(outcome).toMatchObject({ ok: false, error: { kind: "base_stale" } });
    expect(world.fs.text(SKILL_FILE)).toContain("edited by hand");
  });

  test("the same requestId asks once and returns the first result", async () => {
    const approvals = scriptedApprovals();
    const world = await createWorld({ approvals });
    const first = await request(world.runtime.writer, {
      plan: createPlan(),
      actor: agentActor("main"),
      context: MAIN_CALL,
      requestId: "call-1",
    });
    const second = await request(world.runtime.writer, {
      plan: createPlan(),
      actor: agentActor("main"),
      context: MAIN_CALL,
      requestId: "call-1",
    });
    expect(first.ok && second.ok && first.value.ledgerId === second.value.ledgerId).toBe(true);
    expect(approvals.requests).toHaveLength(1);
    expect(approvals.requests[0]?.requestKey).toMatch(/^kw_[0-9a-f]{40}$/);
  });

  test("background destructive always queued", async () => {
    const approvals = scriptedApprovals();
    const world = await createWorld({ approvals });
    await createDeploy(world);
    noApproval(world);
    const outcome = await request(world.runtime.writer, {
      plan: await editPlan(world, "changed\n"),
      actor: agentActor("background"),
      context: contextOf(THREAD, { kind: "model", agent: "background" }),
    });
    if (!outcome.ok) throw new Error(outcome.error.message);
    expect(outcome.value.status).toBe("queued");
    expect(approvals.requests).toHaveLength(0);
    expect(world.fs.text(SKILL_FILE)).toContain("v1");
  });

  test("with the approval setting off a main agent creates without asking", async () => {
    const approvals = scriptedApprovals();
    const world = await createWorld({ approvals });
    noApproval(world);
    const outcome = await request(world.runtime.writer, {
      plan: createPlan(),
      actor: agentActor("main"),
      context: MAIN_CALL,
    });
    expect(outcome).toMatchObject({ ok: true, value: { status: "applied", approvedBy: "policy" } });
    expect(approvals.requests).toHaveLength(0);
  });

  test("after untrusted forces approval", async () => {
    const approvals = scriptedApprovals();
    const world = await createWorld({ approvals });
    noApproval(world);
    const outcome = await request(world.runtime.writer, {
      plan: createPlan(),
      actor: agentActor("main"),
      context: contextOf(THREAD, { kind: "model", agent: "main", afterUntrusted: true }),
    });
    expect(outcome.ok).toBe(true);
    expect(approvals.requests).toHaveLength(1);
    expect(approvals.requests[0]?.afterUntrusted).toBe(true);
  });

  test("a non-interactive run queues instead of asking", async () => {
    const approvals = scriptedApprovals();
    const world = await createWorld({ approvals });
    const outcome = await request(world.runtime.writer, {
      plan: createPlan(),
      actor: agentActor("main"),
      context: contextOf(THREAD, { kind: "model", agent: "main" }, { interactive: false }),
    });
    expect(outcome).toMatchObject({ ok: true, value: { status: "queued" } });
    expect(approvals.requests).toHaveLength(0);
  });

  test("without an approval port a main agent write is queued", async () => {
    const world = await createWorld();
    const outcome = await request(world.runtime.writer, {
      plan: createPlan(),
      actor: agentActor("main"),
      context: MAIN_CALL,
    });
    expect(outcome).toMatchObject({ ok: true, value: { status: "queued" } });
    expect(world.fs.has(SKILL_FILE)).toBe(false);
  });

  test("evidence validity decides between a direct apply and the approval", async () => {
    const approvals = scriptedApprovals();
    const world = await createWorld({ approvals });
    world.setLayers([
      userLayer({ "l2.knowledge.write.trustedEvidenceSources": ["test-group.queue"] }),
    ]);
    const evidence = { source: "test-group.queue", ref: "p1:1", decidedAt: 1 };
    const trusted = await request(world.runtime.writer, {
      plan: createPlan(),
      actor: { kind: "extension", extension: "test-group" },
      context: contextOf(THREAD, { kind: "extension", extension: "test-group" }),
      evidence,
    });
    expect(trusted).toMatchObject({
      ok: true,
      value: { status: "applied", approvedBy: "evidence" },
    });
    expect(approvals.requests).toHaveLength(0);
    const entries = (await world.runtime.ledgerApi.list({}, asHost())).entries;
    expect(entries[0]?.evidence).toEqual(evidence);

    // 다른 확장이 같은 source를 내밀면 증거는 무효이고 세션이 있으니 승인을 묻는다
    const forged = await request(world.runtime.writer, {
      plan: await editPlan(world, "forged\n"),
      actor: { kind: "extension", extension: "other-group" },
      context: contextOf(THREAD, { kind: "extension", extension: "other-group" }),
      evidence,
    });
    expect(forged.ok).toBe(true);
    expect(approvals.requests).toHaveLength(1);
  });
});

describe("proposal queue", () => {
  const EXTENSION_CALL = contextOf(undefined, { kind: "extension", extension: "test-group" });

  async function queueRollback(world: World, ledgerId: string, requestId?: string) {
    return world.runtime.ledgerApi.rollback(
      { ledgerId, reason: "undo" },
      { context: EXTENSION_CALL, ...(requestId === undefined ? {} : { requestId }) },
    );
  }

  test("a queued proposal changes nothing until the user approves it", async () => {
    const world = await createWorld();
    const ledgerId = await createDeploy(world);
    const queued = await queueRollback(world, ledgerId, "grp-1");
    expect(queued.status).toBe("queued");
    expect(queued.proposalId).toBeDefined();
    expect(world.fs.has(SKILL_FILE)).toBe(true);

    const listed = await world.runtime.ledgerApi.proposals({ status: "pending" });
    expect(listed.proposals).toHaveLength(1);
    expect(listed.proposals[0]).toMatchObject({
      proposalId: queued.proposalId,
      status: "pending",
      op: "rollback",
      actor: { kind: "extension", extension: "test-group" },
      target: { kind: "skill", name: "deploy", scope: "user" },
    });
    expect(listed.proposals[0]?.preview).toContain("SKILL.md");

    // 같은 requestId는 새 제안을 만들지 않고 첫 결과를 돌려준다
    const again = await queueRollback(world, ledgerId, "grp-1");
    expect(again.proposalId).toBe(queued.proposalId);
    expect((await world.runtime.ledgerApi.proposals({})).proposals).toHaveLength(1);

    const decided = await world.runtime.ledgerApi.decide(
      { proposalId: queued.proposalId ?? "", decision: "approve", note: "ok" },
      asHost(),
    );
    expect(decided.proposal.status).toBe("applied");
    expect(decided.outcome?.status).toBe("applied");
    expect(world.fs.has(SKILL_FILE)).toBe(false);
    // 원장에는 제안한 행위자와 제안 id가 남고, 승인은 사람의 승인으로 센다
    const entry = (await world.runtime.ledgerApi.list({}, asHost())).entries[0];
    expect(entry).toMatchObject({
      op: "rollback",
      actor: { kind: "extension", extension: "test-group" },
      approvedBy: "approval",
      proposalId: queued.proposalId,
      reason: "ok",
    });
    expect(decided.proposal.ledgerId).toBe(entry?.ledgerId);

    // 이미 처리한 제안은 다시 결정할 수 없다
    const closed = await rejection(
      world.runtime.ledgerApi.decide(
        { proposalId: queued.proposalId ?? "", decision: "approve" },
        asHost(),
      ),
    );
    expect(closed.data.code).toBe("proposal_closed");
  });

  test("a rejected proposal leaves the files alone", async () => {
    const world = await createWorld();
    const ledgerId = await createDeploy(world);
    const queued = await queueRollback(world, ledgerId);
    const decided = await world.runtime.ledgerApi.decide(
      { proposalId: queued.proposalId ?? "", decision: "reject" },
      asHost(),
    );
    expect(decided.proposal.status).toBe("rejected");
    expect(decided.outcome).toBeUndefined();
    expect(world.fs.has(SKILL_FILE)).toBe(true);
    expect((await world.runtime.ledgerApi.list({}, asHost())).entries).toHaveLength(1);
  });

  test("a proposal whose target changed becomes stale", async () => {
    const world = await createWorld();
    const ledgerId = await createDeploy(world);
    const queued = await queueRollback(world, ledgerId);
    // 제안 뒤에 같은 스킬이 바뀌었다
    world.fs.put(SKILL_FILE, skillText("hand edit\n"));
    const error = await rejection(
      world.runtime.ledgerApi.decide(
        { proposalId: queued.proposalId ?? "", decision: "approve" },
        asHost(),
      ),
    );
    expect(error.data.code).toBe("rollback_conflict");
    const listed = await world.runtime.ledgerApi.proposals({ status: "stale" });
    expect(listed.proposals.map((proposal) => proposal.proposalId)).toEqual([
      queued.proposalId ?? "",
    ]);
    expect(world.fs.text(SKILL_FILE)).toContain("hand edit");
  });

  test("a pending proposal expires after the configured days", async () => {
    const world = await createWorld();
    const ledgerId = await createDeploy(world);
    const queued = await queueRollback(world, ledgerId);
    world.clock.advance(13 * DAY);
    expect((await world.runtime.ledgerApi.proposals({ status: "pending" })).proposals).toHaveLength(
      1,
    );
    world.clock.advance(2 * DAY);
    expect((await world.runtime.ledgerApi.proposals({ status: "pending" })).proposals).toHaveLength(
      0,
    );
    const expired = await world.runtime.ledgerApi.proposals({ status: "expired" });
    expect(expired.proposals.map((proposal) => proposal.proposalId)).toEqual([
      queued.proposalId ?? "",
    ]);
    const closed = await rejection(
      world.runtime.ledgerApi.decide(
        { proposalId: queued.proposalId ?? "", decision: "approve" },
        asHost(),
      ),
    );
    expect(closed.data.code).toBe("proposal_closed");
    expect(world.fs.has(SKILL_FILE)).toBe(true);
  });

  test("only the user decides, and an unknown proposal is not found", async () => {
    const world = await createWorld();
    const ledgerId = await createDeploy(world);
    const queued = await queueRollback(world, ledgerId);
    const denied = await rejection(
      world.runtime.ledgerApi.decide(
        { proposalId: queued.proposalId ?? "", decision: "approve" },
        { context: EXTENSION_CALL },
      ),
    );
    expect(denied.data.code).toBe("denied");
    const missing = await rejection(
      world.runtime.ledgerApi.decide(
        { proposalId: "knp_00000000000000000000000000", decision: "approve" },
        asHost(),
      ),
    );
    expect(missing.data.code).toBe("not_found");
    expect(await hashOfDeploy(world)).toBe(treeHash(treeFrom({ "SKILL.md": skillText("v1\n") })));
  });
});
