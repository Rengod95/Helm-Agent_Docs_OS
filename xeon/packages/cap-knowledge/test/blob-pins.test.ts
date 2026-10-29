import { afterEach, describe, expect, test } from "bun:test";
import type { Result } from "@xeon/contracts";
import type { CallContext, WriteOutcome } from "@xeon/contracts/capabilities";
import type { BlobRef } from "@xeon/contracts/records";
import type { ChangeSpec } from "../src/ledger/change.ts";
import { putTree } from "../src/ledger/manifest.ts";
import type { ChangeTarget } from "../src/ledger/target.ts";
import { KNOWLEDGE_OWNER } from "../src/migrations.ts";
import type { KnowledgeFailure } from "../src/errors.ts";
import { SCAN_RULESET_VERSION } from "../src/scan/rules.ts";
import type { Tree } from "../src/skills/tree.ts";
import { asHost, treeFrom } from "./support/helpers.ts";
import { contextOf } from "./support/plans.ts";
import { closeWorlds, createWorld, putSkill, USER_SKILLS, type World } from "./support/world.ts";

// 원장 행과 제안 행이 가리키는 블롭은 `cap.knowledge`가 행 id로 고정한다(L2.knowledge.spec §4.7.1, L0.store §3.4). 시험은 고정과
// 해제가 정확히 어떤 값으로 불렸는지 기록으로 보고, 실제 저장소의 GC가 고정된 블롭을 지키는지도 본다.

afterEach(closeWorlds);

const SCAN = { rulesetVersion: SCAN_RULESET_VERSION, findings: [] };
const SKILL_DIR = `${USER_SKILLS}/deploy`;
const SKILL_FILE = `${SKILL_DIR}/SKILL.md`;
const TARGET: ChangeTarget = { kind: "skill", name: "deploy", scope: "user", path: SKILL_DIR };
const EXTENSION_CALL: CallContext = contextOf(undefined, {
  kind: "extension",
  extension: "test-group",
});
const DAY_MS = 24 * 60 * 60 * 1000;

function skillText(body: string): string {
  return `---\nname: deploy\ndescription: Deploy steps.\n---\n${body}`;
}

function spec(
  overrides: Pick<ChangeSpec, "target" | "next" | "op"> & Partial<ChangeSpec>,
): ChangeSpec {
  return {
    actor: { kind: "user" },
    requestId: undefined,
    baseHash: undefined,
    removal: "archive",
    scan: SCAN,
    approvedBy: "user",
    evidence: undefined,
    reason: undefined,
    proposalId: undefined,
    rollbackOf: undefined,
    captureFailure: "internal",
    ...overrides,
  };
}

/** 적용된 쓰기의 원장 행 id. 실패하거나 다른 상태면 시험이 실패한다 */
function ledgerIdOf(result: Result<WriteOutcome, KnowledgeFailure>): string {
  if (!result.ok) throw new Error(result.error.message);
  if (result.value.status !== "applied" || result.value.ledgerId === undefined) {
    throw new Error(`expected an applied change, got ${result.value.status}`);
  }
  return result.value.ledgerId;
}

function proposalIdOf(outcome: WriteOutcome): string {
  if (outcome.status !== "queued" || outcome.proposalId === undefined) {
    throw new Error(`expected a queued proposal, got ${outcome.status}`);
  }
  return outcome.proposalId;
}

/** `sys_blobs` 행 수 */
async function blobRows(world: World): Promise<number> {
  const count = (await world.store.rowCounts())["sys_blobs"];
  if (count === undefined) throw new Error("sys_blobs is not counted");
  return count;
}

/** 트리를 저장했을 때의 블롭 참조(파일 blob과 목록 blob). 같은 내용이면 같은 참조다 */
function refsOf(world: World, tree: Tree): readonly BlobRef[] {
  const stored = putTree(world.store.service, tree);
  if (!stored.ok) throw new Error(stored.error.message);
  return stored.value.refs;
}

/** 행 id로 건 고정을 `owner sha256` 줄로 모은다(정렬). 다른 행의 고정은 빼고 본다 */
function pinsFor(world: World, refKey: string): string[] {
  return world.blobEvents
    .flatMap((event) =>
      event.op === "pin" && event.refKey === refKey ? [`${event.owner} ${event.sha256}`] : [],
    )
    .toSorted();
}

function expectedPins(refs: readonly BlobRef[]): string[] {
  return refs.map((ref) => `${KNOWLEDGE_OWNER} ${ref.sha256}`).toSorted();
}

/** 행 id의 고정을 푼 호출의 소유자 목록 */
function unpinsFor(world: World, refKey: string): string[] {
  return world.blobEvents.flatMap((event) =>
    event.op === "unpin" && event.refKey === refKey ? [event.owner] : [],
  );
}

function unpinCount(world: World): number {
  return world.blobEvents.filter((event) => event.op === "unpin").length;
}

/** 스킬을 하나 만들고 되돌림을 제안해 대기열에 넣는다. 제안 id를 돌려준다 */
async function queuedRollback(world: World): Promise<string> {
  const ledgerId = ledgerIdOf(
    await world.executor.apply(
      spec({
        target: TARGET,
        next: treeFrom({ "SKILL.md": skillText("v1\n") }),
        op: "skill.create",
      }),
    ),
  );
  const queued = await world.runtime.ledgerApi.rollback({ ledgerId }, { context: EXTENSION_CALL });
  return proposalIdOf(queued);
}

/** 제안을 낼 때 마지막으로 쓴 블롭이 입력 블롭이다 */
function inputShaOf(world: World): string[] {
  return world.blobEvents.flatMap((event) => (event.op === "put" ? [event.sha256] : [])).slice(-1);
}

describe("ledger manifests pin their blobs under the ledger row", () => {
  test("creating a skill pins its file blobs and listing under the new ledger id", async () => {
    const world = await createWorld();
    const next = treeFrom({ "SKILL.md": skillText("v1\n"), "notes.md": "extra\n" });
    const created = await world.executor.apply(spec({ target: TARGET, next, op: "skill.create" }));
    const ledgerId = ledgerIdOf(created);

    expect(pinsFor(world, ledgerId)).toEqual(expectedPins(refsOf(world, next)));
    expect(unpinCount(world)).toBe(0);
  });

  test("replacing a skill pins the old and the new content under the new row and releases nothing", async () => {
    const world = await createWorld();
    const v1 = treeFrom({ "SKILL.md": skillText("v1\n") });
    const v2 = treeFrom({ "SKILL.md": skillText("v2\n"), "notes.md": "extra\n" });
    const createdId = ledgerIdOf(
      await world.executor.apply(spec({ target: TARGET, next: v1, op: "skill.create" })),
    );
    const editedId = ledgerIdOf(
      await world.executor.apply(spec({ target: TARGET, next: v2, op: "skill.edit" })),
    );

    expect(pinsFor(world, editedId)).toEqual(
      [...expectedPins(refsOf(world, v1)), ...expectedPins(refsOf(world, v2))].toSorted(),
    );
    // 처음 행의 고정은 그대로 남는다. 원장 행은 지우지 않으므로 해제도 없다
    expect(pinsFor(world, createdId)).toEqual(expectedPins(refsOf(world, v1)));
    expect(unpinCount(world)).toBe(0);
  });

  test("dropping a skill pins its last content under the new row and releases nothing", async () => {
    const world = await createWorld();
    const last = treeFrom({ "SKILL.md": skillText("v1\n") });
    await world.executor.apply(spec({ target: TARGET, next: last, op: "skill.create" }));
    const droppedId = ledgerIdOf(
      await world.executor.apply(
        spec({ target: TARGET, next: null, op: "skill.archive", removal: "archive" }),
      ),
    );

    expect(pinsFor(world, droppedId)).toEqual(expectedPins(refsOf(world, last)));
    expect(unpinCount(world)).toBe(0);
  });

  test("a failed pin fails the change before the ledger row is written and releases the holder", async () => {
    const world = await createWorld();
    world.blobFault.pinFails = true;
    const result = await world.executor.apply(
      spec({
        target: TARGET,
        next: treeFrom({ "SKILL.md": skillText("v1\n") }),
        op: "skill.create",
      }),
    );

    if (result.ok) throw new Error("expected the change to fail");
    expect(result.error.kind).toBe("unavailable");
    expect(world.fs.has(SKILL_FILE)).toBe(false);
    expect((await world.runtime.ledgerApi.list({}, asHost())).entries).toHaveLength(0);
    // 실패한 고정이 건 행 id를 같은 행 id로 푼다
    const attempted = world.blobEvents.flatMap((event) =>
      event.op === "pin" ? [event.refKey] : [],
    );
    expect(attempted).toHaveLength(1);
    expect(world.blobEvents.flatMap((event) => (event.op === "unpin" ? [event] : []))).toEqual([
      { op: "unpin", owner: KNOWLEDGE_OWNER, refKey: attempted[0] ?? "" },
    ]);
  });

  test("an external skill found by reindex pins its new content under its ledger row", async () => {
    const world = await createWorld();
    putSkill(world.fs, USER_SKILLS, "fresh-skill", { description: "Fresh.", body: "Steps.\n" });
    const reindexed = await world.runtime.skills.reindex();
    expect(reindexed.ok).toBe(true);

    const [row] = (await world.runtime.ledgerApi.list({}, asHost())).entries;
    expect(row?.op).toBe("external");
    const text = "---\nname: fresh-skill\ndescription: Fresh.\n---\nSteps.\n";
    expect(pinsFor(world, row?.ledgerId ?? "")).toEqual(
      expectedPins(refsOf(world, treeFrom({ "SKILL.md": text }))),
    );
  });
});

describe("proposal inputs are pinned under the proposal id until it closes", () => {
  test("queueing a proposal pins its input blob under the proposal id", async () => {
    const world = await createWorld();
    const proposalId = await queuedRollback(world);

    expect(pinsFor(world, proposalId)).toEqual(
      inputShaOf(world).map((sha) => `${KNOWLEDGE_OWNER} ${sha}`),
    );
    expect(pinsFor(world, proposalId)).toHaveLength(1);
  });

  test("rejecting a proposal releases its input blob", async () => {
    const world = await createWorld();
    const proposalId = await queuedRollback(world);
    const decided = await world.runtime.ledgerApi.decide(
      { proposalId, decision: "reject" },
      asHost(),
    );

    expect(decided.proposal.status).toBe("rejected");
    expect(unpinsFor(world, proposalId)).toEqual([KNOWLEDGE_OWNER]);
  });

  test("approving a proposal releases its input blob once the change is applied", async () => {
    const world = await createWorld();
    const proposalId = await queuedRollback(world);
    const decided = await world.runtime.ledgerApi.decide(
      { proposalId, decision: "approve" },
      asHost(),
    );

    expect(decided.proposal.status).toBe("applied");
    expect(unpinsFor(world, proposalId)).toEqual([KNOWLEDGE_OWNER]);
  });

  test("expiring a proposal releases its input blob", async () => {
    const world = await createWorld();
    const proposalId = await queuedRollback(world);
    world.clock.advance(15 * DAY_MS);

    const listed = await world.runtime.ledgerApi.proposals({ status: "expired" });
    expect(listed.proposals.map((proposal) => proposal.proposalId)).toEqual([proposalId]);
    expect(unpinsFor(world, proposalId)).toEqual([KNOWLEDGE_OWNER]);
  });
});

describe("gc with the real store", () => {
  test("gc keeps a queued proposal's input until the proposal is decided", async () => {
    const world = await createWorld({ blobGraceMs: 1000 });
    const ledgerId = ledgerIdOf(
      await world.executor.apply(
        spec({
          target: TARGET,
          next: treeFrom({ "SKILL.md": skillText("v1\n") }),
          op: "skill.create",
        }),
      ),
    );
    const queued = await world.runtime.ledgerApi.rollback(
      { ledgerId },
      { context: EXTENSION_CALL },
    );
    const proposalId = proposalIdOf(queued);
    const stored = await blobRows(world);

    // 유예를 넘겨도 원장 행의 블롭 둘과 제안 입력 블롭은 모두 남는다
    world.clock.advance(1001);
    expect(world.store.opened.gcBlobs({ liveRefs: new Set() }).ok).toBe(true);
    expect(await blobRows(world)).toBe(stored);

    // 제안을 거절하면 입력 블롭만 고정이 풀리고, 다음 gc가 그것만 지운다
    await world.runtime.ledgerApi.decide({ proposalId, decision: "reject" }, asHost());
    expect(world.store.opened.gcBlobs({ liveRefs: new Set() }).ok).toBe(true);
    expect(await blobRows(world)).toBe(stored - 1);
  });
});
