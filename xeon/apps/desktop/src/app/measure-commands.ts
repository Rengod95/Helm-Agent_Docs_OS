import type { Result } from "@fresnel/contracts";
import type { HostConnection } from "@fresnel/contracts/wire";
import type { CommandError, MeasureCommands } from "../views/commands.ts";

// 성능 측정 화면(P-20)이 부르는 읽기 wire(`measure.turn`, `measure.daily`). 결과는 요청의 반환값이라 거울에 넣지 않는다.

type Run = <T>(
  work: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

export function createMeasureCommands(read: Run): MeasureCommands {
  return {
    turn: (threadId, turnId) => read((c) => c.request("measure.turn", { threadId, turnId })),
    daily: (kind, metric) => read((c) => c.request("measure.daily", { kind, metric })),
    promotion: (threadId) =>
      read((c) => c.request("group.promotion", threadId === null ? {} : { threadIds: [threadId] })),
  };
}
