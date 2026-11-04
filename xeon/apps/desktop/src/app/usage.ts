import type { HostConnection } from "@fresnel/contracts/wire";
import type { Result } from "@fresnel/contracts";
import type { CommandError, UsageCommands } from "../views/commands.ts";

// 사용량 게이지(P-11 "사용량 (이 대화)")가 부르는 wire. `usage.get`은 읽기만 하므로 쓰기 소유를 얻지 않는다.
// 대화를 고르지 않은 화면은 `threadId` 없이 부르지 않는다(화면이 맡는다). 기대한 실패는 없고 연결과 host 실패만 `CommandError`다.

type WithConnection = <T>(
  run: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

export function createUsageCommands(withConnection: WithConnection): UsageCommands {
  return {
    get: (params) => withConnection((c) => c.request("usage.get", params)),
  };
}
