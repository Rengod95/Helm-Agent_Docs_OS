import type { Result } from "@fresnel/contracts";
import type { HostConnection } from "@fresnel/contracts/wire";
import type { CommandError, ProfileCanvasCommands } from "../views/commands.ts";

// 프로필 캔버스(C3, craft-flows §6.10, §8)가 부르는 wire: 읽기 다섯과 쓰기 하나(`profile.put`).
// 쓰기는 엔진 대상을 바꾸는 중이면 `switching`으로 거절한다(`withWrite`).

type WithConnection = <T>(
  run: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

export function createProfileCanvasCommands(
  withConnection: WithConnection,
  withWrite: WithConnection,
): ProfileCanvasCommands {
  return {
    profiles: () => withConnection((c) => c.request("profile.list", {})),
    cards: () => withConnection((c) => c.request("plugin.list", {})),
    blocks: () => withConnection((c) => c.request("blocks.describe", {})),
    applied: (profileId) => withConnection((c) => c.request("blocks.applied", { profileId })),
    preview: (profileId) => withConnection((c) => c.request("profile.preview", { id: profileId })),
    put: (profile, baseRev) => withWrite((c) => c.request("profile.put", { profile, baseRev })),
  };
}
