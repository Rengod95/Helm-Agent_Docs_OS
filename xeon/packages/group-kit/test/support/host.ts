import type { ThreadId } from "@xeon/contracts/conversation";
import type { TestHost } from "@xeon/ext-host/testing";
import type { GroupModule } from "../../src/index.ts";

export function install(
  t: TestHost,
  module: GroupModule,
  loadIndex = 0,
): ReturnType<TestHost["host"]["install"]> {
  return t.host.install({
    manifest: module.manifest,
    entry: module.entry,
    loadIndex,
    builtin: true,
  });
}

/** agent_settled 지점을 한 번 발화한다. 이 지점에 on을 건 그룹의 핸들러가 부른다 */
export function fireSettled(t: TestHost, thread: ThreadId, key: string): Promise<unknown> {
  return t.host.dispatch(
    "agent_settled",
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: key },
  );
}
