import type { WireHandlers } from "@xeon/contracts/wire";
import type { Engine } from "../types.ts";

// F wire §3.3.1 proposal.list, proposal.decide(M3-REQ-18, D-M3-32 a). 학습 그룹의 대기열과 L2.knowledge의 쓰기 승인 대기열을 한 목록으로 보이고
// 결정을 출처로 보낸다. 합치기와 오류 옮기기는 `assembly/proposals.ts`의 포트가 한다. 한 출처를 읽지 못하면 그 출처만 `unavailable`에 올라
// 나머지 행은 돌아오고, 결정 실패는 던지지 않고 `ok: false`와 이유로 돌려준다(JSON-RPC 오류는 params 위반과 전송 실패에만 쓴다).

export function createProposalHandlers(
  engine: Engine,
): Pick<WireHandlers, "proposal.list" | "proposal.decide"> {
  const { proposals } = engine.ports;
  return {
    "proposal.list": (params, context) => proposals.list(params, context.signal),
    "proposal.decide": (params, context) => proposals.decide(params, context.signal),
  };
}
