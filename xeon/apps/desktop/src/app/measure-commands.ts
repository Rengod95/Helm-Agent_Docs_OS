import type { Result } from "@fresnel/contracts";
import type { HostConnection } from "@fresnel/contracts/wire";
import type { CommandError, MeasureCommands } from "../views/commands.ts";

// 측정 읽기 wire(`measure.turn`, `orchestration.promotion`). 플러그인 상세의 측정 탭과 메트릭의 턴 번호 곡선, 같이 쓰는 도구가 부른다.
// 결과는 요청의 반환값이라 거울에 넣지 않는다. 옛 성능 측정 화면만 쓰던 `measure.daily`는 화면과 함께 뺐다(AGE-69).

type Run = <T>(
  work: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

export function createMeasureCommands(read: Run): MeasureCommands {
  return {
    turn: (threadId, turnId) => read((c) => c.request("measure.turn", { threadId, turnId })),
    promotion: (threadIds) =>
      read((c) => c.request("orchestration.promotion", threadIds === null ? {} : { threadIds })),
  };
}
