import type { ThreadId } from "@xeon/contracts/conversation";
import type { WorkspaceEnv } from "../env.ts";

/**
 * 대화마다 다른 작업 폴더를 풀어 주는 포트(open-issues M-06, plan DG.4). 실제 구현은 `xeon.session`의
 * `query.thread(threadId).workspace`(`thread.started` payload의 `workspace`)와 `xeon.exec`의 `withCwd`다.
 */
export interface ThreadWorkspaces {
  /** 대화가 만들어질 때 저장한 작업 폴더. 값이 없거나 옛 행이면 null이다 */
  workspaceOf(threadId: ThreadId): string | null;
  /** 그 폴더를 cwd로 하는 실행 환경 */
  envAt(cwd: string): WorkspaceEnv;
}
