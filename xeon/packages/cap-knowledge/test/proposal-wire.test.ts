import { afterEach, describe, expect, test } from "bun:test";
import { eachAsync } from "@xeon/contracts";
import type { CallOptions, Proposal } from "@xeon/contracts/capabilities";
import {
  proposalRowOf,
  createKnowledgeProposalWire,
  knowledgeStatusesOf,
} from "../src/approval/wire.ts";
import { asHost, threadIdOf } from "./support/helpers.ts";
import { contextOf } from "./support/plans.ts";
import {
  closeWorlds,
  createWorld,
  PROJECT_SKILLS,
  USER_SKILLS,
  type World,
} from "./support/world.ts";

// M3-REQ-91(D-M3-32 a): 지식 대기열은 그대로 두고, 합친 승인 목록(`proposal.list`·`proposal.decide`)이 부를 조회·결정 어댑터를 둔다.
// 학습 대기열은 이 패키지 밖이다. 어댑터는 `knowledge.ledger` 능력 API만 쓴다.

afterEach(closeWorlds);

const THREAD = threadIdOf(1);

function background(afterUntrusted = false): CallOptions {
  return {
    context: contextOf(THREAD, {
      kind: "model",
      agent: "background",
      ...(afterUntrusted ? { afterUntrusted: true } : {}),
    }),
  };
}

function bySource(world: World) {
  return createKnowledgeProposalWire(world.runtime.ledgerApi);
}

async function queue(world: World, text: string, options = background()): Promise<string> {
  const queued = await world.runtime.memoryApi.add({ store: "user", text }, options);
  if (queued.outcome.proposalId === undefined) throw new Error("the write was not queued");
  return queued.outcome.proposalId;
}

async function queueSkill(world: World, name: string, options = background()): Promise<string> {
  const queued = await world.runtime.skillsApi.create(
    { name, description: "Use when testing.", body: "# body\n" },
    options,
  );
  if (queued.proposalId === undefined) throw new Error("the write was not queued");
  return queued.proposalId;
}

describe("proposalRowOf", () => {
  test("maps a queued skill and a destructive memory proposal to rows of the merged list", async () => {
    const world = await createWorld();
    const skillId = await queueSkill(world, "learned");
    world.clock.advance(1000);
    await world.runtime.memoryApi.add({ store: "user", text: "old" }, asHost());
    const read = await world.runtime.memoryApi.read({ stores: ["user"] }, asHost());
    const view = read.stores[0];
    world.clock.advance(1000);
    const replaceId =
      (
        await world.runtime.memoryApi.replace(
          {
            store: "user",
            entryId: view?.entries[0]?.id ?? "",
            text: "new",
            baseHash: view?.fileHash ?? "",
          },
          background(),
        )
      ).outcome.proposalId ?? "";

    const rows = (await bySource(world).list({})).map((row) => [
      row.source,
      row.id,
      row.kind,
      row.op,
      row.target,
      row.status,
      row.destructive,
      row.scope,
      row.revision,
      row.afterUntrusted,
    ]);
    expect(rows).toEqual([
      [
        "knowledge",
        replaceId,
        "memory",
        "memory.replace",
        "memory:user",
        "pending",
        true,
        null,
        1,
        false,
      ],
      [
        "knowledge",
        skillId,
        "skill",
        "skill.create",
        "skill:learned",
        "pending",
        false,
        "user",
        1,
        false,
      ],
    ]);
    const skillRow = (await bySource(world).list({ status: ["pending"], limit: 5 })).find(
      (row) => row.id === skillId,
    );
    expect(skillRow).toMatchObject({
      rationale: null,
      evidence: [],
      conflictsWith: null,
      reason: null,
    });
    expect(skillRow?.diff).toContain("+# body");
  });

  test("maps stale and expired proposals to their reason codes", () => {
    const base: Omit<Proposal, "status"> = {
      proposalId: "knp_01ARZ3NDEKTSV4RRFFQ5ABCDEF",
      createdAt: 1,
      actor: { kind: "user" },
      target: { kind: "skill", name: "x" },
      op: "skill.edit",
      baseHash: "a".repeat(64),
      preview: "diff",
      scan: { rulesetVersion: "1.0.0", findings: [] },
    };
    expect(proposalRowOf({ ...base, status: "stale" })).toMatchObject({
      reason: "base_stale",
      destructive: true,
    });
    expect(proposalRowOf({ ...base, status: "expired" }).reason).toBe("expired");
    expect(proposalRowOf({ ...base, status: "pending", afterUntrusted: true }).afterUntrusted).toBe(
      true,
    );
  });
});

describe("afterUntrusted", () => {
  test("is kept on the queued proposal and carried to the ledger entry when it is applied", async () => {
    const world = await createWorld();
    const id = await queue(world, "from the web");
    // 같은 호출 문맥이 afterUntrusted를 싣는다
    const untrustedId = await queue(world, "after reading the web", background(true));
    const wire = bySource(world);
    const rows = await wire.list({});
    expect(Object.fromEntries(rows.map((row) => [row.id, row.afterUntrusted]))).toEqual({
      [id]: false,
      [untrustedId]: true,
    });

    const decided = await wire.decide(
      { source: "knowledge", id: untrustedId, decision: "approve" },
      asHost(),
    );
    expect(decided).toMatchObject({ ok: true, applied: true });
    const entry = (await world.runtime.ledgerApi.list({}, asHost())).entries[0];
    expect(entry).toMatchObject({ proposalId: untrustedId, afterUntrusted: true });
    const plain = (await world.runtime.ledgerApi.list({ limit: 5 }, asHost())).entries.length;
    expect(plain).toBe(1);
  });

  test("a direct agent write after untrusted input is marked in the ledger", async () => {
    const world = await createWorld();
    const done = await world.runtime.skillsApi.create(
      { name: "direct", description: "d", body: "b" },
      { context: contextOf(THREAD, { kind: "model", agent: "main", afterUntrusted: true }) },
    );
    // 승인 포트가 없는 세계에서 주 대화의 쓰기는 대기열로 간다
    expect(done.status).toBe("queued");
    expect((await world.runtime.ledgerApi.proposals({})).proposals[0]?.afterUntrusted).toBe(true);
  });
});

describe("list", () => {
  test("filters by wire status, pages by a keyset position and answers an empty list for learning-only statuses", async () => {
    const world = await createWorld();
    const ids: string[] = [];
    await eachAsync(["one", "two", "three"], async (text) => {
      world.clock.advance(1000);
      ids.push(await queue(world, text));
      return undefined;
    });
    const [one = "", two = "", three = ""] = ids;
    const wire = bySource(world);
    const first = await wire.list({ limit: 2 });
    expect(first.map((row) => row.id)).toEqual([three, two]);
    const last = first[1];
    const second = await wire.list({
      limit: 2,
      before: { createdAt: last?.createdAt ?? 0, id: last?.id ?? "" },
    });
    expect(second.map((row) => row.id)).toEqual([one]);

    expect(await wire.list({ status: ["approved", "reverted"] })).toEqual([]);
    expect((await wire.list({ status: ["pending", "approved"] })).length).toBe(3);
    expect((await wire.list({ status: ["applied"] })).length).toBe(0);
    expect(knowledgeStatusesOf(["approved"])).toBeUndefined();
    expect(knowledgeStatusesOf(undefined)).toEqual([]);
  });

  test("proposals with statuses and before behave the same through the capability", async () => {
    const world = await createWorld();
    await queue(world, "one");
    world.clock.advance(1000);
    const newer = await queue(world, "two");
    const listed = await world.runtime.ledgerApi.proposals({
      statuses: ["pending", "stale"],
      limit: 1,
    });
    expect(listed.proposals.map((proposal) => proposal.proposalId)).toEqual([newer]);
  });
});

describe("decide", () => {
  test("approve applies the proposal, reject closes it, a second decision is closed", async () => {
    const world = await createWorld();
    const approveId = await queue(world, "keep me");
    const rejectId = await queue(world, "drop me");
    const wire = bySource(world);

    const approved = await wire.decide(
      { source: "knowledge", id: approveId, decision: "approve" },
      asHost(),
    );
    expect(approved).toMatchObject({
      ok: true,
      applied: true,
      proposal: { id: approveId, status: "applied" },
    });
    const rejected = await wire.decide(
      { source: "knowledge", id: rejectId, decision: "reject", note: "no" },
      asHost(),
    );
    expect(rejected).toMatchObject({
      ok: true,
      applied: false,
      proposal: { id: rejectId, status: "rejected" },
    });
    expect(
      await wire.decide({ source: "knowledge", id: approveId, decision: "approve" }, asHost()),
    ).toMatchObject({
      ok: false,
      reason: "closed",
    });
    expect(
      await wire.decide(
        { source: "knowledge", id: "knp_01ARZ3NDEKTSV4RRFFQ5ZZZZZZ", decision: "approve" },
        asHost(),
      ),
    ).toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });

  test("edit and revert belong to the learning queue and a wrong revision is refused", async () => {
    const world = await createWorld();
    const id = await queue(world, "x");
    const wire = bySource(world);
    expect(
      await wire.decide({ source: "knowledge", id, decision: "edit", body: "y" }, asHost()),
    ).toMatchObject({
      ok: false,
      reason: "unsupported",
    });
    expect(
      await wire.decide({ source: "knowledge", id, decision: "revert" }, asHost()),
    ).toMatchObject({
      ok: false,
      reason: "unsupported",
    });
    expect(
      await wire.decide({ source: "knowledge", id, decision: "approve", revision: 2 }, asHost()),
    ).toMatchObject({
      ok: false,
      reason: "revision_mismatch",
    });
    expect((await world.runtime.ledgerApi.proposals({})).proposals[0]?.status).toBe("pending");
  });

  test("a decision by anyone but the user is refused as needing approval", async () => {
    const world = await createWorld();
    const id = await queue(world, "x");
    const result = await bySource(world).decide(
      { source: "knowledge", id, decision: "approve" },
      { context: contextOf(undefined, { kind: "extension", extension: "grp" }) },
    );
    expect(result).toMatchObject({ ok: false, reason: "approval_required" });
  });

  test("a changed target turns the proposal stale and reports base_stale", async () => {
    const world = await createWorld();
    await world.runtime.skillsApi.create(
      { name: "deploy", description: "d", body: "v1\n" },
      asHost(),
    );
    const hash = (await world.runtime.skillsApi.view({ name: "deploy" })).treeHash;
    const queued = await world.runtime.skillsApi.edit(
      { name: "deploy", baseHash: hash, body: "v2\n" },
      background(),
    );
    await world.runtime.skillsApi.edit({ name: "deploy", baseHash: hash, body: "v3\n" }, asHost());
    const result = await bySource(world).decide(
      { source: "knowledge", id: queued.proposalId ?? "", decision: "approve" },
      asHost(),
    );
    expect(result).toMatchObject({ ok: false, reason: "base_stale" });
    expect((await bySource(world).list({ status: ["stale"] })).map((row) => row.reason)).toEqual([
      "base_stale",
    ]);
  });
});

describe("scope chosen at approval (D-M3-09)", () => {
  test("a queued new skill can be applied to the project scope by the user", async () => {
    const world = await createWorld();
    const id = await queueSkill(world, "shared");
    const result = await bySource(world).decide(
      { source: "knowledge", id, decision: "approve", scope: "project" },
      asHost(),
    );
    expect(result).toMatchObject({ ok: true, applied: true });
    expect(world.fs.has(`${PROJECT_SKILLS}/shared/SKILL.md`)).toBe(true);
    expect(world.fs.has(`${USER_SKILLS}/shared/SKILL.md`)).toBe(false);
    const entry = (await world.runtime.ledgerApi.list({}, asHost())).entries[0];
    expect(entry).toMatchObject({
      target: { kind: "skill", name: "shared", scope: "project" },
      proposalId: id,
    });
  });

  test("the user scope is the default and the same scope is accepted", async () => {
    const world = await createWorld();
    const id = await queueSkill(world, "mine");
    const result = await bySource(world).decide(
      { source: "knowledge", id, decision: "approve", scope: "user" },
      asHost(),
    );
    expect(result).toMatchObject({ ok: true, applied: true });
    expect(world.fs.has(`${USER_SKILLS}/mine/SKILL.md`)).toBe(true);
  });

  test("a memory proposal and an edit of an existing skill refuse another scope", async () => {
    const world = await createWorld();
    const memoryId = await queue(world, "note");
    await world.runtime.skillsApi.create(
      { name: "deploy", description: "d", body: "v1\n" },
      asHost(),
    );
    const hash = (await world.runtime.skillsApi.view({ name: "deploy" })).treeHash;
    const edit = await world.runtime.skillsApi.edit(
      { name: "deploy", baseHash: hash, body: "v2\n" },
      background(),
    );
    const wire = bySource(world);
    const results = await Promise.all(
      [memoryId, edit.proposalId ?? ""].map((id) =>
        wire.decide({ source: "knowledge", id, decision: "approve", scope: "project" }, asHost()),
      ),
    );
    expect(results.map((result) => (result.ok ? "ok" : result.reason))).toEqual([
      "scope_not_allowed",
      "scope_not_allowed",
    ]);
    expect((await wire.list({ status: ["pending"] })).length).toBe(2);
  });
});
