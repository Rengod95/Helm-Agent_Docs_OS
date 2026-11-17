import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { err, ok } from "@fresnel/contracts";
import type { IntakeRequest } from "../../../src/assembly/plugins/intake.ts";
import {
  APPROVE_TO_WORK,
  errorOf,
  instructionTextsOf,
  pluginRigOf,
  removeRigs,
  valueOf,
  writeSkillFolder,
} from "./intake-rig.ts";
import { writeFiles } from "./support.ts";

// 공유 입구(`PluginDraftIntake`, §7.5 [제안]). 출처마다 얼굴이 다르고, 초안과 항목을 한 번에 만든다.
// 준비 단계가 실패하면 초안도 항목도 없다. 마이그레이션 항목은 손 수정이 아니라서 승인할 수 있다.

afterEach(() => {
  removeRigs();
});

const EVIDENCE = {
  kind: "turn",
  threadId: "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  turnId: "trn_01ARZ3NDEKTSV4RRFFQ69G5FAV",
} as const;

test("the intake makes the draft and the review item in one call, and an assistant submission keeps its thread and evidence", async () => {
  const rig = pluginRigOf();
  const dir = writeSkillFolder(rig.root, "notes");
  const made = valueOf(
    await rig.intake.submit({
      dir,
      provenance: "assistant",
      originThreadId: "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      originProfileId: null,
      evidence: [EVIDENCE],
      purpose: "메모를 정리한다",
    }),
  );
  const item = valueOf(await rig.review.get(made.itemId)).item;
  expect(item.provenance).toBe("assistant");
  expect(item.originThreadId).toBe("thr_01ARZ3NDEKTSV4RRFFQ69G5FAV");
  expect(item.evidence).toEqual([EVIDENCE]);
  expect(item.state).toBe("pending");
  expect(item.candidateHash).not.toBeNull();
  expect(valueOf(await rig.review.list({})).items.map((listed) => listed.itemId)).toEqual([
    made.itemId,
  ]);
});

test("an assistant submission without evidence is refused by the type and, when it is run anyway, by the intake", async () => {
  const rig = pluginRigOf();
  const dir = writeSkillFolder(rig.root, "notes");
  // @ts-expect-error -- 증거 없는 assistant 제출은 타입이 거절한다. 실행해도 입구가 거절하는지 함께 본다(시험, TY-08)
  const bare: IntakeRequest = {
    dir,
    provenance: "assistant",
    originThreadId: "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    originProfileId: null,
    evidence: [],
    purpose: "메모를 정리한다",
  };
  const failure = errorOf(await rig.intake.submit(bare));
  expect(failure.kind).toBe("draft_invalid");
  expect(valueOf(await rig.review.list({})).items).toEqual([]);
});

test("a user_instruction or migration submission has no thread and needs no evidence", async () => {
  const rig = pluginRigOf();
  const hint = writeSkillFolder(rig.root, "hint");
  const moved = writeSkillFolder(rig.root, "moved");

  const instructed = valueOf(
    await rig.intake.submit({
      dir: hint,
      provenance: "user_instruction",
      originThreadId: null,
      originProfileId: "work",
      evidence: [],
      purpose: "힌트",
    }),
  );
  const migrated = valueOf(
    await rig.intake.submit({
      dir: moved,
      provenance: "migration",
      originThreadId: null,
      originProfileId: null,
      evidence: [],
      purpose: "옮긴 것",
    }),
  );

  const instructedItem = valueOf(await rig.review.get(instructed.itemId)).item;
  const migratedItem = valueOf(await rig.review.get(migrated.itemId)).item;
  expect([instructedItem.provenance, instructedItem.originThreadId]).toEqual([
    "user_instruction",
    null,
  ]);
  expect([migratedItem.provenance, migratedItem.originThreadId, migratedItem.evidence]).toEqual([
    "migration",
    null,
    [],
  ]);
});

test("a prepare failure makes neither a draft nor a review item", async () => {
  const rig = pluginRigOf();
  const dir = writeSkillFolder(rig.root, "prep");
  const refused = errorOf(
    await rig.intake.submit({
      dir,
      provenance: "migration",
      originThreadId: null,
      originProfileId: null,
      evidence: [],
      purpose: "준비가 막는다",
      prepare: () => Promise.resolve(err({ kind: "exists", name: "prep" })),
    }),
  );
  expect(refused).toEqual({ kind: "exists", name: "prep" });
  expect(valueOf(await rig.review.list({})).items).toEqual([]);

  // 준비가 성공하면 그대로 항목이 생긴다
  const made = valueOf(
    await rig.intake.submit({
      dir,
      provenance: "migration",
      originThreadId: null,
      originProfileId: null,
      evidence: [],
      purpose: "준비가 막는다",
      prepare: () => Promise.resolve(ok(undefined)),
    }),
  );
  expect(valueOf(await rig.review.get(made.itemId)).item.state).toBe("pending");
});

test("a migration item is approvable without a hand-edit refusal, and a missing purpose is purpose_required", async () => {
  const rig = pluginRigOf();
  // 목적 칸이 없는 매니페스트다. 승인 전에는 목적이 없어 승인할 수 없다
  writeFiles(rig.root, {
    "gap/.fresnel-plugin/plugin.json": `${JSON.stringify({ schemaVersion: 2, name: "gap", version: "0.0.0" }, null, 2)}\n`,
    "gap/instructions/01-note.md": "메모\n",
  });
  const made = valueOf(
    await rig.intake.submit({
      dir: join(rig.root, "gap"),
      provenance: "migration",
      originThreadId: null,
      originProfileId: null,
      evidence: [],
      purpose: undefined,
    }),
  );
  const item = valueOf(await rig.review.get(made.itemId)).item;
  expect(item.provenance).toBe("migration");
  expect(item.card.purpose).toBeNull();

  expect(errorOf(await rig.review.decide(made.itemId, APPROVE_TO_WORK))).toEqual({
    kind: "purpose_required",
    itemId: made.itemId,
  });
  // 실패한 승인은 아무것도 바꾸지 않는다
  expect(valueOf(await rig.review.get(made.itemId)).item.state).toBe("pending");

  const approved = valueOf(
    await rig.review.decide(made.itemId, { ...APPROVE_TO_WORK, purpose: "메모를 남긴다" }),
  );
  expect(approved.item.state).toBe("approved");
  expect(approved.appliedTo).toEqual(["work"]);
});

test("a migrated plugin is pending and invisible to the model until approval; one approval puts it in the profile", async () => {
  const rig = pluginRigOf();
  writeFiles(rig.root, {
    "moved/.fresnel-plugin/plugin.json": `${JSON.stringify({ schemaVersion: 2, name: "moved", version: "0.0.0", purpose: "옮긴 메모" }, null, 2)}\n`,
    "moved/instructions/01-note.md": "옮긴 메모\n",
  });
  const made = valueOf(
    await rig.intake.submit({
      dir: join(rig.root, "moved"),
      provenance: "migration",
      originThreadId: null,
      originProfileId: null,
      evidence: [],
      purpose: "옮긴 메모",
    }),
  );

  // 승인 전: 대기 이름으로 보이고(프로필 검증은 `plugin_not_reviewed`로 본다), 재료 포트는 읽지 않는다
  expect(valueOf(await rig.review.pendingNames())).toEqual(["moved"]);
  expect(await instructionTextsOf(rig, "moved")).toEqual([]);

  const outcome = valueOf(await rig.review.decide(made.itemId, APPROVE_TO_WORK));
  expect(outcome.item.state).toBe("approved");
  expect(outcome.appliedTo).toEqual(["work"]);
  expect(valueOf(await rig.review.pendingNames())).toEqual([]);
  expect(await instructionTextsOf(rig, "moved")).toEqual(["옮긴 메모\n"]);
});

test("a skill folder submitted through the intake is a draft and a review item like any other", async () => {
  const rig = pluginRigOf();
  const dir = writeSkillFolder(rig.root, "skilled");
  const made = valueOf(
    await rig.intake.submit({
      dir,
      provenance: "migration",
      originThreadId: null,
      originProfileId: null,
      evidence: [],
      purpose: "스킬",
    }),
  );
  const drafts = valueOf(await rig.review.draftList("skilled")).drafts;
  expect(drafts.map((draft) => draft.submittedItemId)).toEqual([made.itemId]);
  expect(drafts.map((draft) => draft.draftId)).toEqual([made.draftId]);
});
