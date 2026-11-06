import type { Result } from "@fresnel/contracts";
import type { HostConnection } from "@fresnel/contracts/wire";
import type { CommandError, MemoryCommands } from "../views/commands.ts";

// 설정 "대화와 컨텍스트" 탭의 기억 구역(W-19)이 부르는 wire. 읽기는 연결이 있으면 되고, 쓰기는 엔진 대상을 바꾸는 중이면 보류한다.
// 읽을 때 받은 `fileHash`를 고치기와 지우기의 `baseHash`로 되돌려 보낸다. 바깥에서 바뀌었으면 host가 `jsonrpc.invalidParams`(path `baseHash`)로 알린다.

type With = <T>(
  run: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

export function createMemoryCommands(
  withConnection: With,
  withWriteConnection: With,
): MemoryCommands {
  return {
    read: () => withConnection((c) => c.request("knowledge.memory.read", {})),
    add: (store, text) =>
      withWriteConnection((c) => c.request("knowledge.memory.add", { store, text })),
    replace: (store, entryId, text, baseHash) =>
      withWriteConnection((c) =>
        c.request("knowledge.memory.replace", { store, entryId, text, baseHash }),
      ),
    remove: (store, entryId, baseHash) =>
      withWriteConnection((c) =>
        c.request("knowledge.memory.remove", { store, entryId, baseHash }),
      ),
  };
}
