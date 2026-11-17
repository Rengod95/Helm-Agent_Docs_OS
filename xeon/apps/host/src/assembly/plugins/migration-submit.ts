import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { attemptAsync, err, ok, parse, type Logger, type Result } from "@fresnel/contracts";
import type { ReviewItem } from "@fresnel/contracts/wire";
import { ExtensionNameSchema } from "@fresnel/contracts/extensions";
import { emit, type PlannedPluginWithMigration } from "@fresnel/plugin-migration";
import type { PluginPortFailure } from "../../handlers/m5/plugins.ts";
import { hashPluginTree } from "./content-hash.ts";
import { collectInOrder, runInOrder } from "./in-order.ts";
import type { FolderRejection } from "./folder-reader.ts";
import { readPluginFolder } from "./folder-reader.ts";
import type { PluginDraftIntake, IntakePrepare } from "./intake.ts";
import type { PluginReview } from "./review.ts";

// 마이그레이션 제출(migration.md §7.5 [제안]). 제안 엔진이 낸 계획을 `emit()`으로 트리로 만들어 `<userDir>/<이름>/`에 쓰고,
// 공유 입구로 초안과 `migration` 검토 항목을 만든다. 앱이 쓰는 것이라 손으로 고친 것이 아니다.
// wire 메서드가 아니다. `engine.ports`로만 노출하고, M5g의 `migration.apply`가 부른다.

/** 제출된 초안 하나. 건너뛴 플러그인은 목록에 없다 */
interface MigratedDraft {
  readonly name: string;
  readonly draftId: string;
  readonly itemId: string;
}

/** 마이그레이션 제출 포트 */
export interface MigrationSubmitPort {
  /**
   * 계획을 폴더로 쓰고 초안과 검토 항목을 만든다. 모든 계획을 먼저 임시 폴더에서 검사하고, 하나라도 거절되면 아무것도 쓰지 않는다.
   * 최근 승인본과 내용이 같은 계획은 건너뛴다(§8 수용 14). 같은 이름의 원본이 있으면 이 서비스가 만든 `migration` 폴더이고 그 폴더가 승인본과 같을 때만 새 버전이다
   */
  submitPlanned(
    plans: readonly PlannedPluginWithMigration[],
  ): Promise<Result<readonly MigratedDraft[], PluginPortFailure>>;
}

export interface MigrationSubmitDeps {
  /** 사용자 플러그인 폴더(`<OsDirs.config>/plugins`). 원본 폴더는 여기 `<이름>/`에 쓴다 */
  readonly userDir: string;
  /** 공유 입구. 초안과 `migration` 항목을 한 직렬 구간에서 만든다 */
  readonly intake: PluginDraftIntake;
  /** 승인 기록을 읽어 같은 이름의 최근 승인본이 `migration`인지 본다 */
  readonly review: Pick<PluginReview, "list">;
  readonly log: Logger;
}

/** 쓰기 전에 임시 폴더에서 검사한 계획 */
interface StagedPlan {
  readonly name: string;
  readonly purpose: string;
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** 임시 폴더를 읽은 내용 해시. 승인본과 같은지 보는 데 쓴다 */
  readonly contentHash: string;
}

const NAME_ISSUE = {
  code: "name_invalid",
  severity: "error",
  path: "/name",
  message: "plugin name must match the extension name pattern",
} as const;

/** 상대 경로인가. 절대 경로, `..`, 빈 조각, 역슬래시, NUL은 거절한다 */
function isSafeRelativePath(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    return false;
  }
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/** 트리를 폴더로 쓴다. 파일은 `0644`다(`emit`은 실행 비트를 내지 않는다) */
async function writeTree(
  dir: string,
  files: ReadonlyMap<string, Uint8Array>,
): Promise<Result<void, PluginPortFailure>> {
  const made = await attemptAsync(() => mkdir(dir, { recursive: true }));
  if (!made.ok) return err({ kind: "store", code: "io" });
  return runInOrder([...files], async ([path, bytes]): Promise<Result<void, PluginPortFailure>> => {
    const target = join(dir, path);
    const written = await attemptAsync(async () => {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { mode: 0o644 });
    });
    return written.ok ? ok(undefined) : err({ kind: "store", code: "io" });
  });
}

/** 임시 폴더의 트리를 읽어 검사한다. 통과하면 내용 해시를 돌려준다 */
async function checkStaged(
  dir: string,
  files: ReadonlyMap<string, Uint8Array>,
): Promise<Result<string, PluginPortFailure>> {
  const written = await writeTree(dir, files);
  if (!written.ok) return err(written.error);
  const read = readPluginFolder(dir, { origin: "user" });
  if (!read.ok) return err(rejectionFailure(read.error));
  return ok(read.value.contentHash);
}

/** 폴더 읽기 거절을 제출의 실패로 옮긴다. 진단 하나가 이슈 하나다 */
function rejectionFailure(rejection: FolderRejection): PluginPortFailure {
  return {
    kind: "draft_invalid",
    issues: rejection.diagnostics.map((item) => ({
      code: item.code,
      severity: item.severity,
      path: item.path,
      message: item.message,
    })),
  };
}

/** 결정 시각이 가장 늦은 항목(없으면 `undefined`) */
function latestDecided(items: readonly ReviewItem[]): ReviewItem | undefined {
  return items
    .filter((item) => item.decidedAt !== null)
    .toSorted((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))
    .at(0);
}

/**
 * 원본 폴더를 이 서비스가 쓴 것으로 볼 수 있는가: 최근 승인본이 `migration`이고, 폴더 내용 해시가 그 승인본과 같다.
 * 손으로 고쳤으면 아니다(`plugin.exists`). 모호하면 아니다(§4.10.4와 같은 방식)
 */
function replaceable(latest: ReviewItem | null, dir: string): boolean {
  if (latest === null || latest.provenance !== "migration" || latest.candidateHash === null) {
    return false;
  }
  const tree = hashPluginTree(dir);
  return tree.ok && tree.value.contentHash === latest.candidateHash;
}

/** 임시 폴더에 쓰고 읽어서 검사한다. 통과하면 내용 해시를 돌려준다. 사용자 폴더는 건드리지 않는다 */
async function stage(
  plan: PlannedPluginWithMigration,
): Promise<Result<StagedPlan, PluginPortFailure>> {
  if (!parse(ExtensionNameSchema, plan.name).ok) {
    return err({ kind: "draft_invalid", issues: [NAME_ISSUE] });
  }
  const files = emit(plan);
  if (![...files.keys()].every(isSafeRelativePath)) return err({ kind: "path_invalid" });
  const root = await attemptAsync(() => mkdtemp(join(tmpdir(), "fresnel-migration-")));
  if (!root.ok) return err({ kind: "store", code: "io" });
  const checked = await checkStaged(join(root.value, plan.name), files);
  await attemptAsync(() => rm(root.value, { recursive: true, force: true }));
  if (!checked.ok) return err(checked.error);
  return ok({ name: plan.name, purpose: plan.purpose, files, contentHash: checked.value });
}

/** 계획 목록을 제출한다. 의존은 `deps`로 받는다 */
export function createMigrationSubmitter(deps: MigrationSubmitDeps): MigrationSubmitPort {
  const { log } = deps;

  /** 이 이름의 최근 승인본. 승인본을 제거로 닫았으면 없다 */
  async function latestApprovedOf(
    name: string,
  ): Promise<Result<ReviewItem | null, PluginPortFailure>> {
    const listed = await deps.review.list({ name, state: "approved" });
    if (!listed.ok) return err(listed.error);
    const latest = latestDecided(listed.value.items);
    if (latest === undefined || latest.kind === "remove") return ok(null);
    return ok(latest);
  }

  /** 준비 단계(직렬 구간 안). 원본이 있으면 새 버전 조건을 다시 본 뒤 덮어쓰고 남은 옛 파일을 지운다 */
  function prepareOf(staged: StagedPlan, dir: string): IntakePrepare {
    return async () => {
      const existed = existsSync(dir);
      if (existed) {
        const latest = await latestApprovedOf(staged.name);
        if (!latest.ok) return err(latest.error);
        if (!replaceable(latest.value, dir)) return err({ kind: "exists", name: staged.name });
      }
      const written = await writeTree(dir, staged.files);
      if (!written.ok || !existed) return written;
      const tree = hashPluginTree(dir);
      if (!tree.ok) return err({ kind: "store", code: "io" });
      const stale = tree.value.files.filter((file) => !staged.files.has(file.path));
      return runInOrder(stale, async (file) => {
        const removed = await attemptAsync(() => rm(join(dir, file.path), { force: true }));
        return removed.ok ? ok(undefined) : err({ kind: "store", code: "io" });
      });
    };
  }

  /** 계획 하나를 제출한다. 승인본과 같으면 건너뛰어 빈 목록을 준다 */
  async function submitOne(
    staged: StagedPlan,
  ): Promise<Result<readonly MigratedDraft[], PluginPortFailure>> {
    const latest = await latestApprovedOf(staged.name);
    if (!latest.ok) return err(latest.error);
    if (latest.value !== null && latest.value.candidateHash === staged.contentHash) {
      log.info("plugin.migration.unchanged", { name: staged.name });
      return ok([]);
    }
    const dir = join(deps.userDir, staged.name);
    if (existsSync(dir) && !replaceable(latest.value, dir)) {
      log.warn("plugin.migration.refused", { name: staged.name, kind: "exists" });
      return err({ kind: "exists", name: staged.name });
    }
    const made = await deps.intake.submit({
      dir,
      provenance: "migration",
      originThreadId: null,
      originProfileId: null,
      evidence: [],
      purpose: staged.purpose,
      prepare: prepareOf(staged, dir),
    });
    if (!made.ok) {
      log.warn("plugin.migration.refused", { name: staged.name, kind: made.error.kind });
      return made;
    }
    log.info("plugin.migration.submitted", { name: staged.name });
    return ok([{ name: staged.name, draftId: made.value.draftId, itemId: made.value.itemId }]);
  }

  return {
    async submitPlanned(plans) {
      const names = plans.map((plan) => plan.name);
      if (new Set(names).size !== names.length) {
        return err({
          kind: "draft_invalid",
          issues: [
            {
              code: "name_duplicate",
              severity: "error",
              path: "",
              message: "two plans share a plugin name",
            },
          ],
        });
      }
      // 모든 계획을 먼저 검사한다. 하나라도 거절되면 아무것도 쓰지 않는다
      const staged = await collectInOrder(plans, async (plan) => {
        const checked = await stage(plan);
        if (!checked.ok) return checked;
        return ok([checked.value]);
      });
      if (!staged.ok) return staged;
      return collectInOrder(staged.value, submitOne);
    },
  };
}
