import { sep } from "node:path";

// 프로젝트 소속과 프로필 기본값의 순수 계산(review m5 §4.4.2, §4.4.5, §4.4.8). 저장하지 않고 매번 계산한다.
// 입출력이 없어 시험이 값으로 비교한다. 루트의 정규 경로는 호출하는 쪽(`project-port.ts`)이 만든다.

/** 암묵 기본 폴더 프로젝트의 id. `projects.json`에는 없다 */
export const DEFAULT_PROJECT_ID = "prj_default";

/** 소속 계산에 쓰는 루트 하나. `root`는 정규 경로다. `name`이 null이면 암묵 프로젝트(기본 폴더)다 */
export interface ScopeRoot {
  readonly projectId: string;
  readonly root: string;
  readonly name: string | null;
}

/** 프로필 기본값을 고를 때 보는 대화 하나 */
export interface ScopeThread {
  readonly threadId: string;
  /** 정규 작업 폴더. 없으면 null */
  readonly workspace: string | null;
  /** 저장된 프로필 id. 없으면 null(기본) */
  readonly profileId: string | null;
  /** 마지막 활동 시각(ms). 값이 클수록 최근이다 */
  readonly updatedAt: number;
  /** Test run 대화인가. 프로젝트 묶음과 기본값 계산에서 뺀다(§4.8) */
  readonly testRun: boolean;
}

/** 프로필 기본값의 원천이 된 대화 */
export type RecentThread = ScopeThread;

/** `path`가 `root`와 같거나 그 안에 있는가. 둘 다 정규 경로여야 한다 */
export function isWithin(path: string, root: string): boolean {
  if (path === root) return true;
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return path.startsWith(prefix);
}

/**
 * `path`를 포함하는 루트 가운데 가장 깊은 것. 깊이가 같으면 목록에서 먼저 온 것이다.
 * 명시 프로젝트를 암묵 기본 폴더보다 앞에 둔다(같은 폴더를 가리키면 명시가 이긴다)
 */
export function deepestRoot(path: string, roots: readonly ScopeRoot[]): ScopeRoot | undefined {
  let best: ScopeRoot | undefined;
  for (const candidate of roots) {
    if (!isWithin(path, candidate.root)) continue;
    if (best === undefined || candidate.root.length > best.root.length) best = candidate;
  }
  return best;
}

/** 대화 폴더가 속한 프로젝트 id(암묵 기본 폴더 포함). 어느 루트에도 없으면 null */
export function projectIdOf(path: string, roots: readonly ScopeRoot[]): string | null {
  return deepestRoot(path, roots)?.projectId ?? null;
}

/**
 * wire의 `ThreadProjectRef`. 명시 프로젝트만 싣는다. 암묵 기본 폴더 대화와 루트가 없는 대화는 null이다
 * (`ThreadProfileView.project`의 "null이면 기본 폴더 대화" 규칙)
 */
export function projectRefOf(
  workspace: string | null,
  roots: readonly ScopeRoot[],
): { readonly projectId: string; readonly name: string } | null {
  if (workspace === null) return null;
  const deepest = deepestRoot(workspace, roots);
  if (deepest === undefined || deepest.name === null) return null;
  return { projectId: deepest.projectId, name: deepest.name };
}

/**
 * 프로필 기본값을 고르는 대화(§4.4.8). `threads`는 최근순(`updatedAt` 내림차순)이어야 한다.
 * 같은 정규 폴더의 가장 최근 대화가 먼저다. 없으면 같은 프로젝트의 가장 최근 대화다. 둘 다 없으면 undefined다.
 * Test run 대화는 어느 단계에서도 고르지 않는다. `workspace`가 없으면 프로젝트를 가리지 않는 가장 최근 대화다.
 */
export function recentThreadOf(input: {
  readonly threads: readonly ScopeThread[];
  readonly workspace: string | undefined;
  /** 정규 폴더가 속한 프로젝트 id. 없으면 null. `workspace`가 있을 때만 부른다 */
  readonly projectIdOf: (workspace: string) => string | null;
}): RecentThread | undefined {
  const candidates = input.threads.filter((thread) => !thread.testRun);
  if (input.workspace === undefined) return candidates[0];
  const workspace = input.workspace;
  const sameFolder = candidates.find((thread) => thread.workspace === workspace);
  if (sameFolder !== undefined) return sameFolder;
  const project = input.projectIdOf(workspace);
  if (project === null) return undefined;
  return candidates.find(
    (thread) => thread.workspace !== null && input.projectIdOf(thread.workspace) === project,
  );
}
