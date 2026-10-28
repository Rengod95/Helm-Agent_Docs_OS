import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { attemptAsync, err, ok, type Result } from "@xeon/contracts";
import type { RunCommand } from "./proc.ts";

// L0.os.spec §3.13, M3-REQ-48. git 워크트리 연산(create, list, remove). 셸 없이 argv로 git을 부른다.
// F 계약에 타입이 없어 이 패키지의 로컬 타입이다 [F 요청: OsService.worktrees].

export interface WorktreeInfo {
  /** 워크트리 디렉터리의 절대 경로 */
  readonly path: string;
  /** 체크아웃한 브랜치 이름(refs/heads/ 제외). 분리된 HEAD이면 null */
  readonly branch: string | null;
  readonly head: string;
  /** 저장소의 주 워크트리인지 */
  readonly isMain: boolean;
}

export type WorktreeError =
  | { readonly kind: "not_absolute"; readonly path: string }
  | { readonly kind: "git_unavailable"; readonly code: string }
  /**
   * git이 0이 아닌 코드로 끝났다. 저장소가 아니거나 브랜치·경로가 이미 있는 경우.
   * `output`은 git의 stderr(없으면 stdout)의 앞 2000자다. stderr는 끝쪽 8 KiB만 읽는다.
   */
  | { readonly kind: "git_failed"; readonly exitCode: number; readonly output: string }
  | { readonly kind: "cancelled" };

export interface WorktreeCreateOptions {
  /** 새 워크트리 디렉터리(절대 경로, 아직 없어야 한다) */
  readonly path: string;
  /** 만들 브랜치 이름 */
  readonly branch: string;
  /** 시작점. 기본 HEAD */
  readonly base?: string;
}

export interface WorktreeOps {
  create(
    repo: string,
    opts: WorktreeCreateOptions,
    signal: AbortSignal,
  ): Promise<Result<WorktreeInfo, WorktreeError>>;
  list(repo: string, signal: AbortSignal): Promise<Result<readonly WorktreeInfo[], WorktreeError>>;
  /** `force`이면 수정된 파일이 있어도 지운다. 기본 거짓 */
  remove(
    repo: string,
    path: string,
    opts: { readonly force?: boolean },
    signal: AbortSignal,
  ): Promise<Result<void, WorktreeError>>;
}

/** worktree add는 큰 저장소에서 5초(기본)를 넘길 수 있다 */
const WORKTREE_GIT_TIMEOUT_MS = 60_000;
/** git_failed.output에 싣는 글자 상한 */
const GIT_OUTPUT_MAX = 2000;

/** 심볼릭 링크를 풀어 비교용 경로를 만든다. 경로가 없으면 적힌 그대로 쓴다 */
async function canonicalPath(path: string): Promise<string> {
  const real = await attemptAsync(() => realpath(path));
  return real.ok ? real.value : path;
}

/** `git worktree list --porcelain` 출력을 해석한다. 빈 줄이 항목을 가른다. 첫 항목이 주 워크트리다 */
export function parseWorktreeList(output: string): readonly WorktreeInfo[] {
  const result: WorktreeInfo[] = [];
  for (const block of output.split("\n\n")) {
    let path: string | undefined;
    let head = "";
    let branch: string | null = null;
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line.startsWith("HEAD ")) head = line.slice("HEAD ".length);
      else if (line.startsWith("branch "))
        branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    }
    if (path !== undefined) result.push({ path, branch, head, isMain: result.length === 0 });
  }
  return result;
}

/** 목록에서 `target`(realpath로 맞춘 경로)과 같은 워크트리를 찾는다 */
async function findListed(
  list: readonly WorktreeInfo[],
  target: string,
): Promise<WorktreeInfo | undefined> {
  const canonical = await Promise.all(list.map((w) => canonicalPath(w.path)));
  const index = canonical.indexOf(target);
  return index < 0 ? undefined : list[index];
}

export function createWorktreeOps(deps: { readonly run: RunCommand }): WorktreeOps {
  async function git(
    repo: string,
    args: readonly string[],
    signal: AbortSignal,
  ): Promise<Result<string, WorktreeError>> {
    if (!isAbsolute(repo)) return err({ kind: "not_absolute", path: repo });
    const ran = await deps.run(["git", "-C", repo, ...args], {
      signal,
      timeoutMs: WORKTREE_GIT_TIMEOUT_MS,
      captureStderr: true,
    });
    if (!ran.ok) {
      if (ran.error.kind === "cancelled") return err({ kind: "cancelled" });
      const code = ran.error.kind === "timeout" ? "timeout" : ran.error.code;
      return err({ kind: "git_unavailable", code });
    }
    if (ran.value.exitCode !== 0) {
      // git은 오류를 stderr에 쓴다. stderr가 비면 stdout을 쓴다
      const stderr = ran.value.stderr ?? "";
      const text = stderr.trim() === "" ? ran.value.stdout : stderr;
      return err({
        kind: "git_failed",
        exitCode: ran.value.exitCode,
        output: text.slice(0, GIT_OUTPUT_MAX),
      });
    }
    return ok(ran.value.stdout);
  }

  async function list(
    repo: string,
    signal: AbortSignal,
  ): Promise<Result<readonly WorktreeInfo[], WorktreeError>> {
    const out = await git(repo, ["worktree", "list", "--porcelain"], signal);
    return out.ok ? ok(parseWorktreeList(out.value)) : out;
  }

  return {
    list,
    async create(repo, opts, signal) {
      if (!isAbsolute(opts.path)) return err({ kind: "not_absolute", path: opts.path });
      const added = await git(
        repo,
        ["worktree", "add", "-b", opts.branch, "--", opts.path, opts.base ?? "HEAD"],
        signal,
      );
      if (!added.ok) return added;
      const all = await list(repo, signal);
      if (!all.ok) return all;
      // git이 적는 경로는 심볼릭 링크가 풀린 모양일 수 있어 realpath로 맞춰 본다. 목록에 없으면 실패다
      const created = await findListed(all.value, await canonicalPath(opts.path));
      if (created === undefined) {
        return err({ kind: "git_failed", exitCode: 0, output: "worktree not listed after add" });
      }
      return ok(created);
    },
    async remove(repo, path, opts, signal) {
      if (!isAbsolute(path)) return err({ kind: "not_absolute", path });
      const args =
        opts.force === true
          ? ["worktree", "remove", "--force", "--", path]
          : ["worktree", "remove", "--", path];
      const removed = await git(repo, args, signal);
      return removed.ok ? ok(undefined) : removed;
    },
  };
}
