import { isAbsolute, relative, sep } from "node:path";
import { err, ok, parse, type Result } from "@xeon/contracts";
import {
  SkillNameSchema,
  type SkillCreatedBy,
  type SkillScope,
  type WriteOutcome,
  type WritableSkillScope,
} from "@xeon/contracts/capabilities";
import type { BlobRef, SqlTx } from "@xeon/contracts/records";
import { fromStoreError, type KnowledgeFailure } from "../errors.ts";
import type { LedgerDeps } from "../ledger/change.ts";
import { pinBlobs, putTree, type StoredTree } from "../ledger/manifest.ts";
import {
  createdByFromLedger,
  indexVersion,
  insertRecord,
  manifestForHash,
} from "../ledger/rows.ts";
import { SCAN_RULESET_VERSION } from "../scan/rules.ts";
import {
  loadSkills,
  type Skill,
  type SkillDiagnostic,
  type SkillRoots,
} from "../upstream/skills.ts";
import { describeSkill, mainFileOf } from "./document.ts";
import {
  allSkills,
  deleteFileState,
  deleteSkill,
  getFileState,
  indexEntryChanged,
  upsertFileState,
  upsertSkill,
  type SkillRow,
} from "./store.ts";
import { readDirTree, readSingleFileTree, treeBytes, treeHash, type Tree } from "./tree.ts";

// L2.knowledge.spec §3.2 reindex, §4.4.3 시작 시 재색인. 스킬 루트를 다시 훑어 색인(cap_knowledge_skills)과 파일 상태를 맞춘다.
// 사용자·프로젝트 범위의 바깥 편집(추가, 변경, 삭제)은 원장에 `external` 항목으로 남긴다. 확장·경로 범위는 읽기 전용이라 남기지 않는다.

export interface ReindexResult {
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
  readonly indexVersion: number;
  readonly diagnostics: readonly SkillDiagnostic[];
}

interface Discovered {
  readonly skill: Skill;
  readonly scope: SkillScope;
  readonly name: string;
  readonly description: string;
  readonly modelInvocable: boolean;
  readonly dir: string;
  readonly tree: Tree;
  readonly hash: string;
  /** 사용자·프로젝트 범위의 내용 목록 blob과 그 파일 blob. 그 밖의 범위는 null */
  readonly manifest: StoredTree | null;
}

function isWritableScope(scope: SkillScope): scope is WritableSkillScope {
  return scope === "user" || scope === "project";
}

const keyOf = (scope: SkillScope, name: string): string => `${scope}\u0000${name}`;

async function discover(
  deps: LedgerDeps,
  skill: Skill,
  diagnostics: SkillDiagnostic[],
): Promise<Discovered | undefined> {
  const tree =
    skill.layout === "dir"
      ? await readDirTree(deps.fs, skill.baseDir)
      : await readSingleFileTree(deps.fs, skill.filePath);
  if (!tree.ok) {
    diagnostics.push({
      type: "warning",
      message: `skill not indexed: ${tree.error.message}`,
      path: skill.filePath,
    });
    return undefined;
  }
  const name = parse(SkillNameSchema, skill.name);
  if (!name.ok) {
    diagnostics.push({
      type: "warning",
      message: "skill not indexed: its name cannot be addressed by skill_view",
      path: skill.filePath,
    });
    return undefined;
  }
  const document = describeSkill(mainFileOf(tree.value, skill.layout));
  if (document === undefined) return undefined;
  const scope = skill.source.scope;
  let manifest: StoredTree | null = null;
  if (isWritableScope(scope)) {
    const stored = putTree(deps.blobs, tree.value);
    if (stored.ok) manifest = stored.value;
    else {
      deps.logger.warn("knowledge.reindex.capture_failed", {
        skill: skill.name,
        cause: stored.error.message,
      });
    }
  }
  return {
    skill,
    scope,
    name: name.value,
    description: skill.description.slice(0, 1024),
    modelInvocable: document.modelInvocable,
    dir: skill.layout === "dir" ? skill.baseDir : skill.filePath,
    tree: tree.value,
    hash: treeHash(tree.value),
    manifest,
  };
}

interface ExternalEntry {
  readonly scope: WritableSkillScope;
  readonly name: string;
  readonly path: string;
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
  readonly beforeManifest: BlobRef | null;
  readonly afterManifest: StoredTree | null;
  readonly indexChanged: boolean;
}

export interface ReindexOptions {
  /**
   * 작업 폴더 단위 프로젝트 폴더일 때 true. 현재 프로젝트 스킬 루트 밖의 프로젝트 행(다른 작업 폴더의 스킬)은 지워진 것이 아니라
   * 이 색인에서 내려간 것이므로 원장에 외부 삭제를 남기지 않고 색인 행만 뺀다. 파일 상태(경로와 내용 해시)는 남겨 두어, 그 작업
   * 폴더로 돌아왔을 때 내용이 그대로면 외부 추가로 다시 적지 않는다
   */
  readonly dropOutOfScopeProjects?: boolean;
}

/** `dir`이 `root` 자신이거나 그 아래인가 */
function isWithin(dir: string, root: string): boolean {
  const rel = relative(root, dir);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** 작업 폴더 단위 색인에서 현재 프로젝트 스킬 루트 밖에 있는 프로젝트 행인가 */
function isOutOfScopeProject(row: SkillRow, roots: SkillRoots, options: ReindexOptions): boolean {
  return (
    options.dropOutOfScopeProjects === true &&
    row.scope === "project" &&
    (roots.project === undefined || !isWithin(row.dir, roots.project))
  );
}

export async function reindexSkills(
  deps: LedgerDeps,
  roots: SkillRoots,
  options: ReindexOptions = {},
): Promise<Result<ReindexResult, KnowledgeFailure>> {
  const loaded = await loadSkills(deps.fs, roots);
  const diagnostics: SkillDiagnostic[] = [...loaded.diagnostics];
  const discovered = await Promise.all(
    loaded.skills.map((skill) => discover(deps, skill, diagnostics)),
  );
  const found = discovered.filter((entry): entry is Discovered => entry !== undefined);

  // 커밋된 뒤에 고정할 행: 행 id와 그 새 내용의 블롭(트랜잭션 안에서 행 id가 정해지므로 고정은 커밋 뒤에 한다)
  const pendingPins: { readonly ledgerId: string; readonly refs: readonly BlobRef[] }[] = [];

  const appendExternal = (tx: SqlTx, entry: ExternalEntry, now: number): void => {
    const ledgerId = deps.ids.next("knl");
    if (entry.afterManifest !== null) {
      pendingPins.push({ ledgerId, refs: entry.afterManifest.refs });
    }
    const scan = { rulesetVersion: SCAN_RULESET_VERSION, findings: [] };
    const outcome: WriteOutcome = {
      status: "applied",
      ledgerId,
      ...(entry.afterHash === null ? {} : { afterHash: entry.afterHash }),
      scan,
      indexChanged: entry.indexChanged,
    };
    insertRecord(tx, {
      ledgerId,
      at: now,
      actor: { kind: "external" },
      target: { kind: "skill", name: entry.name, scope: entry.scope, path: entry.path },
      op: "external",
      beforeHash: entry.beforeHash,
      afterHash: entry.afterHash,
      beforeManifest: entry.beforeManifest,
      afterManifest: entry.afterManifest?.manifest ?? null,
      requestId: undefined,
      approvedBy: undefined,
      evidence: undefined,
      scan,
      reason: undefined,
      proposalId: undefined,
      rollbackOf: undefined,
      status: "applied",
      indexChanged: entry.indexChanged,
      outcome,
    });
  };

  const now = deps.clock.now();
  const applied = deps.db.write((tx) => {
    const previous = allSkills(tx);
    const previousByKey = new Map(previous.map((row) => [keyOf(row.scope, row.name), row]));
    const seen = new Set<string>();
    let added = 0;
    let changed = 0;
    let removed = 0;

    for (const entry of found) {
      const key = keyOf(entry.scope, entry.name);
      seen.add(key);
      const indexed = previousByKey.get(key);
      // 다른 작업 폴더의 같은 이름 스킬이 색인에 있던 자리는 비어 있던 것으로 본다
      const before =
        indexed !== undefined && isOutOfScopeProject(indexed, roots, options) ? undefined : indexed;
      if (
        before === undefined &&
        options.dropOutOfScopeProjects === true &&
        entry.scope === "project"
      ) {
        // 이전에 확인한 파일이고 내용이 그대로면 작업 폴더를 오간 것뿐이다: 색인 행만 되살린다
        const known = getFileState(tx, entry.dir);
        if (known !== undefined && known.kind === "skill" && known.hash === entry.hash) {
          upsertSkill(tx, {
            scope: entry.scope,
            name: entry.name,
            dir: entry.dir,
            layout: entry.skill.layout,
            description: entry.description,
            modelInvocable: entry.modelInvocable,
            createdBy: createdByFromLedger(tx, entry.name, "project"),
            treeHash: entry.hash,
            updatedAt: now,
          });
          added += 1;
          continue;
        }
      }
      const createdBy: SkillCreatedBy =
        before?.createdBy ??
        (isWritableScope(entry.scope)
          ? createdByFromLedger(tx, entry.name, entry.scope)
          : "unknown");
      const row: SkillRow = {
        scope: entry.scope,
        name: entry.name,
        dir: entry.dir,
        layout: entry.skill.layout,
        description: entry.description,
        modelInvocable: entry.modelInvocable,
        createdBy,
        treeHash: entry.hash,
        updatedAt: before !== undefined && before.treeHash === entry.hash ? before.updatedAt : now,
      };
      const contentChanged = before === undefined || before.treeHash !== entry.hash;
      if (before === undefined) added += 1;
      else if (contentChanged) changed += 1;
      if (before !== undefined && !contentChanged && before.dir === entry.dir) continue;
      upsertSkill(tx, row);
      if (isWritableScope(entry.scope)) {
        upsertFileState(tx, {
          path: entry.dir,
          kind: "skill",
          target: entry.name,
          scope: entry.scope,
          hash: entry.hash,
          size: treeBytes(entry.tree),
          mtimeMs: now,
          checkedAt: now,
        });
        if (contentChanged) {
          appendExternal(
            tx,
            {
              scope: entry.scope,
              name: entry.name,
              path: entry.dir,
              beforeHash: before?.treeHash ?? null,
              afterHash: entry.hash,
              beforeManifest:
                before === undefined
                  ? null
                  : manifestForHash(tx, "skill", entry.name, entry.scope, before.treeHash),
              afterManifest: entry.manifest,
              indexChanged: indexEntryChanged(before, row),
            },
            now,
          );
        }
      }
    }

    for (const before of previous) {
      if (seen.has(keyOf(before.scope, before.name))) continue;
      removed += 1;
      deleteSkill(tx, before.scope, before.name);
      if (isOutOfScopeProject(before, roots, options)) continue;
      deleteFileState(tx, before.dir);
      if (isWritableScope(before.scope)) {
        appendExternal(
          tx,
          {
            scope: before.scope,
            name: before.name,
            path: before.dir,
            beforeHash: before.treeHash,
            afterHash: null,
            beforeManifest: manifestForHash(
              tx,
              "skill",
              before.name,
              before.scope,
              before.treeHash,
            ),
            afterManifest: null,
            indexChanged: true,
          },
          now,
        );
      }
    }
    return { added, changed, removed, indexVersion: indexVersion(tx) };
  });
  if (!applied.ok) return err(fromStoreError(applied.error, "reindex"));
  // 행은 이미 커밋됐다. 고정이 실패한 행은 고정 없이 남는다(재색인은 같은 내용을 다시 적지 않으므로 다음 재색인도 채우지 못한다 [미결])
  let pinFailure: KnowledgeFailure | undefined;
  for (const pending of pendingPins) {
    const pinned = pinBlobs(deps.blobs, pending.ledgerId, pending.refs);
    if (!pinned.ok) {
      deps.logger.error("knowledge.reindex.pin_failed", {
        ledgerId: pending.ledgerId,
        cause: pinned.error.message,
      });
      if (pinFailure === undefined) pinFailure = pinned.error;
    }
  }
  if (pinFailure !== undefined) return err(pinFailure);
  return ok({ ...applied.value, diagnostics });
}
