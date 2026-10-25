import type { ThreadId } from "@xeon/contracts/conversation";
import type { HostConnection, ThreadListResult, ThreadSummary } from "@xeon/contracts/wire";

// thread.list에서 세션 하나의 요약을 찾는다. thread.list에는 id로 거르는 질의가 없어 쪽을 넘기며 찾는다.

const PAGE_SIZE = 200;
/** 한 범위에서 넘겨 볼 쪽 수 상한. 최근 갱신 순이라 열려는 세션은 앞쪽에 있다 */
const MAX_PAGES = 3;

async function scan(
  connection: HostConnection,
  workspace: string | null,
  threadId: ThreadId,
): Promise<ThreadSummary | null> {
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    // oxlint-disable-next-line no-await-in-loop -- 쪽은 앞 쪽의 cursor가 있어야 읽을 수 있다 (L4.cli.spec §3.1)
    const listed: ThreadListResult = await connection.request("thread.list", {
      limit: PAGE_SIZE,
      ...(workspace === null ? {} : { workspace }),
      ...(cursor === null ? {} : { cursor }),
    });
    const found = listed.threads.find((thread) => thread.threadId === threadId);
    if (found !== undefined) return found;
    if (listed.nextCursor === null || listed.threads.length === 0) return null;
    cursor = listed.nextCursor;
  }
  return null;
}

/** 작업 폴더의 세션에서 먼저 찾고, 없으면 전체에서 찾는다. 찾지 못하면 null이다 */
export async function findThreadSummary(
  connection: HostConnection,
  workspace: string,
  threadId: ThreadId,
): Promise<ThreadSummary | null> {
  const inWorkspace = await scan(connection, workspace, threadId);
  return inWorkspace ?? scan(connection, null, threadId);
}
