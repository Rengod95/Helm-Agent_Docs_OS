import type { ThreadId } from "@xeon/contracts/conversation";
import type { WorkspaceDeps } from "./deps.ts";
import { defaultRoots } from "./roots.ts";

/**
 * 호출한 대화의 작업 폴더로 의존을 맞춘다(open-issues M-06, L2.workspace.spec §4.3).
 * 작업 폴더가 있으면 그 폴더가 상대 경로의 기준(cwd)이자 읽기·쓰기 root 하나가 되고, 셸의 기본 cwd와
 * 샌드박스 쓰기 root도 같은 값을 쓴다. 작업 폴더가 없으면(옛 행, 대화 문맥 없음, 포트 없음) 의존을 그대로 돌려준다.
 */
export function scopedDeps(deps: WorkspaceDeps, threadId: ThreadId | undefined): WorkspaceDeps {
  const { threads } = deps;
  if (threads === undefined || threadId === undefined) return deps;
  const workspace = threads.workspaceOf(threadId);
  if (workspace === null) return deps;
  const env = threads.envAt(workspace);
  return {
    ...deps,
    env,
    roots: { ...deps.roots, env, roots: (context) => defaultRoots(env, context) },
  };
}
