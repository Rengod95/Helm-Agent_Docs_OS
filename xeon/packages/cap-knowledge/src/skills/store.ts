import {
  SkillScopeSchema,
  type SkillCreatedBy,
  type SkillScope,
} from "@xeon/contracts/capabilities";
import { parse } from "@xeon/contracts";
import type { SqlRow, SqlTx } from "@xeon/contracts/records";
import { intCell, textCell } from "../ledger/rows.ts";

// cap_knowledge_skills(스킬 색인)와 cap_knowledge_files(마지막으로 확인한 내용 해시)의 입출력.

export interface SkillRow {
  readonly scope: SkillScope;
  readonly name: string;
  readonly dir: string;
  readonly layout: "dir" | "file";
  readonly description: string;
  readonly modelInvocable: boolean;
  readonly createdBy: SkillCreatedBy;
  readonly treeHash: string;
  readonly updatedAt: number;
}

function toSkillRow(row: SqlRow): SkillRow | undefined {
  const scope = parse(SkillScopeSchema, textCell(row, "scope"));
  const layout = textCell(row, "layout");
  const createdBy = textCell(row, "created_by");
  if (!scope.ok) return undefined;
  if (layout !== "dir" && layout !== "file") return undefined;
  if (createdBy !== "user" && createdBy !== "agent" && createdBy !== "unknown") return undefined;
  return {
    scope: scope.value,
    name: textCell(row, "name"),
    dir: textCell(row, "dir"),
    layout,
    description: textCell(row, "description"),
    modelInvocable: intCell(row, "model_invocable") === 1,
    createdBy,
    treeHash: textCell(row, "tree_hash"),
    updatedAt: intCell(row, "updated_at"),
  };
}

export function getSkill(tx: SqlTx, scope: SkillScope, name: string): SkillRow | undefined {
  const row = tx.get("SELECT * FROM cap_knowledge_skills WHERE scope = ? AND name = ?", [
    scope,
    name,
  ]);
  return row === undefined ? undefined : toSkillRow(row);
}

export function allSkills(tx: SqlTx): readonly SkillRow[] {
  const rows = tx.all("SELECT * FROM cap_knowledge_skills");
  return rows.flatMap((row) => {
    const skill = toSkillRow(row);
    return skill === undefined ? [] : [skill];
  });
}

export function upsertSkill(tx: SqlTx, skill: SkillRow): void {
  tx.run(
    `INSERT INTO cap_knowledge_skills
       (scope, name, dir, layout, description, model_invocable, created_by, tree_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (scope, name) DO UPDATE SET
       dir = excluded.dir, layout = excluded.layout, description = excluded.description,
       model_invocable = excluded.model_invocable, created_by = excluded.created_by,
       tree_hash = excluded.tree_hash, updated_at = excluded.updated_at`,
    [
      skill.scope,
      skill.name,
      skill.dir,
      skill.layout,
      skill.description,
      skill.modelInvocable ? 1 : 0,
      skill.createdBy,
      skill.treeHash,
      skill.updatedAt,
    ],
  );
}

export function deleteSkill(tx: SqlTx, scope: SkillScope, name: string): void {
  tx.run("DELETE FROM cap_knowledge_skills WHERE scope = ? AND name = ?", [scope, name]);
}

export interface FileStateRow {
  readonly path: string;
  readonly kind: "skill" | "memory";
  readonly target: string;
  readonly scope: string;
  readonly hash: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly checkedAt: number;
}

export function upsertFileState(tx: SqlTx, file: FileStateRow): void {
  tx.run(
    `INSERT INTO cap_knowledge_files (path, kind, target, scope, hash, size, mtime_ms, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (path) DO UPDATE SET
       kind = excluded.kind, target = excluded.target, scope = excluded.scope, hash = excluded.hash,
       size = excluded.size, mtime_ms = excluded.mtime_ms, checked_at = excluded.checked_at`,
    [
      file.path,
      file.kind,
      file.target,
      file.scope,
      file.hash,
      file.size,
      file.mtimeMs,
      file.checkedAt,
    ],
  );
}

export function deleteFileState(tx: SqlTx, path: string): void {
  tx.run("DELETE FROM cap_knowledge_files WHERE path = ?", [path]);
}

/** 색인에 보이는 내용이 달라졌는가: 있고 없음, 설명, 모델 호출 가능 여부 */
export function indexEntryChanged(
  previous: SkillRow | undefined,
  next: SkillRow | undefined,
): boolean {
  if (previous === undefined || next === undefined) return previous !== next;
  return (
    previous.description !== next.description || previous.modelInvocable !== next.modelInvocable
  );
}
