import { err, ok, type Result } from "@xeon/contracts";
import type {
  CallOptions,
  SkillIndexEntry,
  SkillListInput,
  SkillListOutput,
  SkillScope,
  SkillViewInput,
  SkillViewOutput,
} from "@xeon/contracts/capabilities";
import { failure, fromStoreError, type KnowledgeFailure } from "../errors.ts";
import type { LedgerDeps } from "../ledger/change.ts";
import { indexVersion } from "../ledger/rows.ts";
import { compareBytes, utf8DecodeStrict } from "../hash.ts";
import type { KnowledgeSettings } from "../settings.ts";
import type { SkillDiagnostic } from "../upstream/skills.ts";
import type { IndexSnapshot } from "./delta.ts";
import { describeSkill, mainFileOf } from "./document.ts";
import { isAddressableSkillFile } from "./paths.ts";
import { buildSkillIndexBlock, truncateDescription, type SkillIndexBlock } from "./prompt-block.ts";
import { reindexSkills, type ReindexResult } from "./reindex.ts";
import type { RootsResult } from "./roots.ts";
import { allSkills, type SkillRow } from "./store.ts";
import { readDirTree, readSingleFileTree, treeHash, type Tree } from "./tree.ts";

// L2.knowledge.plan K2: list, view(지연 로딩), reindex, 첫 turn 인덱스 블록.

export interface SkillsDeps extends LedgerDeps {
  readonly roots: () => Promise<RootsResult>;
  /** 호출 한 번이 읽는 유효 설정 */
  readonly settings: (threadId: string | undefined) => KnowledgeSettings;
  /** `knowledge_search`를 광고하는가(KN.2 전에는 false). 인덱스 블록 끝 안내문이 이 값을 따른다 */
  readonly searchToolAdvertised?: boolean;
  /** 재색인이 끝난 뒤 부른다. 스킬·메모리 검색 색인을 파일에서 다시 만드는 데 쓴다(spec §3.8). 실패는 기록만 하고 재색인 결과를 바꾸지 않는다 */
  readonly afterReindex?: () => Promise<Result<void, KnowledgeFailure>>;
}

export interface SkillsRuntime {
  list(
    input: SkillListInput,
    options?: CallOptions,
  ): Promise<Result<SkillListOutput, KnowledgeFailure>>;
  view(
    input: SkillViewInput,
    options?: CallOptions,
  ): Promise<Result<SkillViewOutput, KnowledgeFailure>>;
  reindex(): Promise<Result<ReindexResult, KnowledgeFailure>>;
  /** 세션 첫 turn에 넣는 인덱스 블록(spec §4.2.5) */
  indexBlock(threadId: string | undefined): Result<SkillIndexBlock, KnowledgeFailure>;
  /** 모델이 보는 인덱스(이름과 잘린 설명)와 버전. 델타 알림의 기준이다(spec §4.2.6) */
  indexSnapshot(threadId: string | undefined): Result<IndexSnapshot, KnowledgeFailure>;
}

/** 모델이 보는 순서: 프로젝트 → 사용자 → 확장 → 경로 */
const SCOPE_RANK: Readonly<Record<SkillScope, number>> = {
  project: 0,
  user: 1,
  extension: 2,
  path: 3,
};

const MAX_LISTED = 2000;
const MAX_DIAGNOSTICS = 200;
const MAX_VIEW_CONTENT = 1_048_576;
const MAX_VIEW_FILES = 500;

function rank(row: SkillRow): number {
  return SCOPE_RANK[row.scope];
}

function bySkillOrder(a: SkillRow, b: SkillRow): number {
  return rank(a) - rank(b) || compareBytes(a.name, b.name);
}

/** 같은 이름이면 앞 범위가 이긴다 */
function winners(rows: readonly SkillRow[]): SkillRow[] {
  const best = new Map<string, SkillRow>();
  for (const row of rows) {
    const current = best.get(row.name);
    if (current === undefined || rank(row) < rank(current)) best.set(row.name, row);
  }
  return Array.from(best.values()).toSorted(bySkillOrder);
}

function entryOf(row: SkillRow, descriptionChars: number): SkillIndexEntry {
  return {
    name: row.name,
    description: truncateDescription(row.description, descriptionChars),
    scope: row.scope,
    createdBy: row.createdBy,
    treeHash: row.treeHash,
    modelInvocable: row.modelInvocable,
  };
}

export function createSkills(deps: SkillsDeps): SkillsRuntime {
  let lastDiagnostics: readonly SkillDiagnostic[] = [];
  const searchOptions = { searchTool: deps.searchToolAdvertised === true };

  const reindex = async (): Promise<Result<ReindexResult, KnowledgeFailure>> => {
    const resolved = await deps.roots();
    const result = await reindexSkills(deps, resolved.roots);
    if (result.ok) {
      lastDiagnostics = [...resolved.diagnostics, ...result.value.diagnostics];
      const refreshed = await deps.afterReindex?.();
      if (refreshed !== undefined && !refreshed.ok) {
        deps.logger.warn("knowledge.docs_index.rebuild_failed", {
          kind: refreshed.error.kind,
          message: refreshed.error.message,
        });
      }
    }
    return result;
  };

  const readRows = (): Result<{ rows: readonly SkillRow[]; version: number }, KnowledgeFailure> => {
    const read = deps.db.read((tx) => ({ rows: allSkills(tx), version: indexVersion(tx) }));
    return read.ok ? ok(read.value) : err(fromStoreError(read.error, "skill index"));
  };

  const indexBlock: SkillsRuntime["indexBlock"] = (threadId) => {
    const settings = deps.settings(threadId).skills;
    if (!settings.enabled) return ok({ text: "", usedChars: 0, omitted: 0, included: [] });
    const read = readRows();
    if (!read.ok) return read;
    const visible = winners(read.value.rows)
      .filter((row) => row.modelInvocable)
      .map((row) => entryOf(row, settings.indexDescriptionChars));
    return ok(buildSkillIndexBlock(visible, settings.indexBudgetChars, searchOptions));
  };

  const indexSnapshot: SkillsRuntime["indexSnapshot"] = (threadId) => {
    const settings = deps.settings(threadId).skills;
    if (!settings.enabled) return ok({ version: 0, descriptions: new Map() });
    const read = readRows();
    if (!read.ok) return read;
    const descriptions = new Map<string, string>();
    for (const row of winners(read.value.rows)) {
      if (row.modelInvocable) {
        descriptions.set(
          row.name,
          truncateDescription(row.description, settings.indexDescriptionChars),
        );
      }
    }
    return ok({ version: read.value.version, descriptions });
  };

  const list: SkillsRuntime["list"] = (input, options) => {
    const settings = deps.settings(options?.context?.threadId).skills;
    if (!settings.enabled) {
      return Promise.resolve(
        ok({
          skills: [],
          budget: { limitChars: settings.indexBudgetChars, usedChars: 0, omitted: 0 },
          indexVersion: 0,
          diagnostics: [],
        }),
      );
    }
    const read = readRows();
    if (!read.ok) return Promise.resolve(read);
    const scopes = input.scopes;
    const all = winners(read.value.rows)
      .filter((row) => scopes === undefined || scopes.includes(row.scope))
      .filter((row) => input.includeHidden === true || row.modelInvocable)
      .map((row) => entryOf(row, settings.indexDescriptionChars));
    const block = buildSkillIndexBlock(
      all.filter((entry) => entry.modelInvocable),
      settings.indexBudgetChars,
      searchOptions,
    );
    return Promise.resolve(
      ok({
        skills: all.slice(0, MAX_LISTED),
        budget: {
          limitChars: settings.indexBudgetChars,
          usedChars: block.usedChars,
          omitted: block.omitted,
        },
        indexVersion: read.value.version,
        diagnostics: lastDiagnostics.slice(0, MAX_DIAGNOSTICS).map((item) => ({
          severity: item.type,
          message: item.message.slice(0, 512),
          path: item.path.slice(0, 1024),
        })),
      }),
    );
  };

  const treeOf = (row: SkillRow): Promise<Result<Tree, KnowledgeFailure>> =>
    row.layout === "dir" ? readDirTree(deps.fs, row.dir) : readSingleFileTree(deps.fs, row.dir);

  const find = (input: SkillViewInput): Result<SkillRow, KnowledgeFailure> => {
    const read = readRows();
    if (!read.ok) return read;
    const found = winners(read.value.rows).find(
      (row) => row.name === input.name && (input.scope === undefined || row.scope === input.scope),
    );
    return found === undefined
      ? err(failure("not_found", `skill ${input.name} is not in the index`))
      : ok(found);
  };

  const view: SkillsRuntime["view"] = async (input, options) => {
    if (!deps.settings(options?.context?.threadId).skills.enabled) {
      return err(failure("unavailable", "skills are turned off (l2.knowledge.skills.enabled)"));
    }
    // 지원 파일 경로는 파일을 열기 전에 가장 먼저 검사한다
    if (input.file !== undefined && !isAddressableSkillFile(input.file)) {
      return err(failure("invalid_input", "file is not a supported skill file path"));
    }
    let row = find(input);
    if (!row.ok) return row;
    let tree = await treeOf(row.value);
    // 색인과 파일이 어긋났으면(바깥 편집) 재색인으로 맞추고 다시 찾는다(spec §4.2.4)
    if (!tree.ok && tree.error.kind !== "not_found") return tree;
    if (!tree.ok || treeHash(tree.value) !== row.value.treeHash) {
      const refreshed = await reindex();
      if (!refreshed.ok) return refreshed;
      row = find(input);
      if (!row.ok) return row;
      tree = await treeOf(row.value);
      if (!tree.ok) return tree;
    }
    const skill = row.value;
    const files = tree.value.files
      .map((file) => file.path)
      .filter((path) => skill.layout === "dir" && isAddressableSkillFile(path))
      .slice(0, MAX_VIEW_FILES);
    const document = describeSkill(mainFileOf(tree.value, skill.layout));
    if (document === undefined) {
      return err(failure("internal", `skill ${skill.name} has no readable SKILL.md`));
    }
    let content = document.body;
    if (input.file !== undefined) {
      const wanted = tree.value.files.find((file) => file.path === input.file);
      if (wanted === undefined || skill.layout !== "dir") {
        return err(failure("not_found", `skill ${skill.name} has no file ${input.file}`));
      }
      const text = utf8DecodeStrict(wanted.bytes);
      if (text === undefined) {
        return err(failure("unsupported", `${input.file} is not a UTF-8 text file`));
      }
      content = text;
    }
    if (content.length > MAX_VIEW_CONTENT) {
      return err(failure("limit_exceeded", "the content is larger than 1 MiB"));
    }
    return ok({
      name: skill.name,
      scope: skill.scope,
      description: skill.description.slice(0, 1024),
      content,
      files,
      treeHash: skill.treeHash,
      createdBy: skill.createdBy,
    });
  };

  return { list, view, reindex, indexBlock, indexSnapshot };
}
