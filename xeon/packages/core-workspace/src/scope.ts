import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  ThreadWorkspaces,
  WorkspaceDeps,
  WorkspaceEnv,
  WorkspaceShellSettings,
} from "@fresnel/contracts/services";
import { craftRoots, defaultRoots } from "./roots.ts";

/**
 * 호출한 대화의 작업 폴더로 의존을 맞춘다(open-issues M-06, L2.workspace.spec §4.3).
 * 작업 폴더가 있으면 그 폴더가 상대 경로의 기준(cwd)이자 읽기·쓰기 root 하나가 되고, 셸의 기본 cwd와
 * 샌드박스 쓰기 root도 같은 값을 쓴다. 작업 폴더가 없으면(옛 행, 대화 문맥 없음, 포트 없음) 의존을 그대로 돌려준다.
 */
export function scopedDeps<S extends WorkspaceShellSettings>(
  deps: WorkspaceDeps<S>,
  threadId: ThreadId | undefined,
): WorkspaceDeps<S> {
  const { threads } = deps;
  if (threads === undefined || threadId === undefined) return deps;
  // 테스트 대화는 쓰기 범위가 작업 폴더 규칙과 다르다(M5c §4.8.7). 표지가 있으면 그 규칙을 쓴다
  const craft = threads.craftScopeOf?.(threadId);
  if (craft !== undefined) return craftScopedDeps(deps, threads, craft.folder);
  const workspace = threads.workspaceOf(threadId);
  if (workspace === null) return deps;
  const env = threads.envAt(workspace);
  return {
    ...deps,
    env,
    roots: {
      ...deps.roots,
      env,
      roots: (context) => defaultRoots(env, context, deps.roots.outputs),
    },
  };
}

/**
 * 테스트 대화의 의존(M5c §4.8.7). 묶인 폴더가 있으면 그 폴더가 cwd이고, 없으면 엔진의 기본 cwd를 그대로 두되 쓰기 root는 없다.
 */
function craftScopedDeps<S extends WorkspaceShellSettings>(
  deps: WorkspaceDeps<S>,
  threads: ThreadWorkspaces,
  folder: string | null,
): WorkspaceDeps<S> {
  const env: WorkspaceEnv = folder === null ? deps.env : threads.envAt(folder);
  return {
    ...deps,
    env,
    roots: {
      ...deps.roots,
      env,
      roots: (context) => craftRoots(env, context, folder, deps.roots.outputs),
    },
  };
}
