import { err, type Result } from "@fresnel/contracts";
import type { HostConnection } from "@fresnel/contracts/wire";
import type { CommandError, SkillCommands } from "../views/commands.ts";

// 제안 화면(P-06)의 충돌 스킬 본문(W-14)이 부르는 wire. 읽기만 한다. host는 이름을 모르면 `jsonrpc.invalidParams`로 알리고,
// 입력 이름(issue path)은 `name`이다. 그 거절만 `not_found`로 옮기고, 다른 입력의 거절과 읽기 실패는 명령 오류 그대로 둔다.

type WithConnection = <T>(
  run: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

export function createSkillCommands(withConnection: WithConnection): SkillCommands {
  return {
    async view(name, threadId) {
      const viewed = await withConnection((c) =>
        c.request("knowledge.skills.view", threadId === undefined ? { name } : { name, threadId }),
      );
      if (viewed.ok) return viewed;
      if (viewed.error.kind === "rejected" && viewed.error.path === "name") {
        return err({ kind: "not_found" });
      }
      return viewed;
    },
  };
}
