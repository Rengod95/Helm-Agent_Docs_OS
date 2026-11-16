import type { HostConnection } from "@fresnel/contracts/wire";
import type { Result } from "@fresnel/contracts";
import type { CommandError, WorkCommands } from "../views/commands.ts";

// 목표와 작업 화면(P-14)이 부르는 wire. 목표와 작업 목록은 읽기(`goal.status`, `work.tasks.list`)이고,
// 목표 걸기·해제는 `command.run`으로 `/goal` 줄을 보내는 쓰기라 엔진 대상을 바꾸는 중이면 `switching`으로 거절한다.

type WithConnection = <T>(
  run: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

export function createWorkCommands(
  withConnection: WithConnection,
  withWrite: WithConnection,
): WorkCommands {
  return {
    goal: (threadId) => withConnection((c) => c.request("goal.status", { threadId })),
    tasks: (threadId) => withConnection((c) => c.request("work.tasks.list", { threadId })),
    goalCommand: (threadId, text) => withWrite((c) => c.request("command.run", { threadId, text })),
  };
}
