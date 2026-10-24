import { assertNever } from "@xeon/contracts";
import type { KnowledgeActor, LedgerOp, SkillCreatedBy } from "@xeon/contracts/capabilities";
import type { SqlTx } from "@xeon/contracts/records";
import type { ChangeTarget } from "../ledger/target.ts";
import { createdByFromLedger } from "../ledger/rows.ts";
import { describeSkill, mainFileOf } from "./document.ts";
import {
  deleteFileState,
  deleteSkill,
  getSkill,
  indexEntryChanged,
  upsertFileState,
  upsertSkill,
  type SkillRow,
} from "./store.ts";
import { treeBytes, type Tree } from "./tree.ts";

// 변경이 적용된 같은 트랜잭션에서 색인과 파일 상태를 맞춘다(spec §4.4.1 10단계).

function createdByActor(actor: KnowledgeActor): SkillCreatedBy {
  switch (actor.kind) {
    case "user":
      return "user";
    case "agent":
    case "extension":
      return "agent";
    case "external":
    case "system":
      return "unknown";
    default:
      return assertNever(actor, "KnowledgeActor");
  }
}

export interface IndexUpdate {
  readonly target: ChangeTarget;
  readonly op: LedgerOp;
  readonly actor: KnowledgeActor;
  /** 적용 뒤 내용. 대상이 없어졌으면 null */
  readonly next: Tree | null;
  readonly afterHash: string | null;
  readonly now: number;
}

/** 색인에 보이는 내용(이름, 설명, 모델 호출 여부, 있고 없음)이 바뀌었으면 true */
export function updateIndexAfterChange(tx: SqlTx, update: IndexUpdate): boolean {
  const { target, next, afterHash, now } = update;
  if (afterHash === null || next === null) {
    deleteFileState(tx, target.path);
  } else {
    upsertFileState(tx, {
      path: target.path,
      kind: target.kind,
      target: target.name,
      scope: target.scope ?? "",
      hash: afterHash,
      size: treeBytes(next),
      mtimeMs: now,
      checkedAt: now,
    });
  }
  if (target.kind !== "skill" || target.scope === undefined) return false;

  const previous = getSkill(tx, target.scope, target.name);
  const document = next === null ? undefined : describeSkill(mainFileOf(next, "dir"));
  if (afterHash === null || document === undefined) {
    deleteSkill(tx, target.scope, target.name);
    return indexEntryChanged(previous, undefined);
  }
  const createdBy: SkillCreatedBy =
    previous?.createdBy ??
    (update.op === "skill.create"
      ? createdByActor(update.actor)
      : createdByFromLedger(tx, target.name, target.scope));
  const row: SkillRow = {
    scope: target.scope,
    name: target.name,
    dir: target.path,
    layout: "dir",
    description: document.description,
    modelInvocable: document.modelInvocable,
    createdBy,
    treeHash: afterHash,
    updatedAt: now,
  };
  upsertSkill(tx, row);
  return indexEntryChanged(previous, row);
}
