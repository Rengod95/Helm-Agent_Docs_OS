import type { CallContext } from "@xeon/contracts/capabilities";
import type { L2ApprovalsPort } from "@xeon/contracts/services";

export type { L2ApprovalsPort };

/**
 * 승인 프로토콜(`xeon.approvals`, kind `question`)을 쓰는 유일한 자리(L2.dialog.spec §4.1.1).
 * 포트 모양은 F의 L2 공통 `L2ApprovalsPort`(L2.readme §5.7)다. 이 포트는 요청이 낸 쪽(출처)을 호출마다 정해야 해서
 * 호출 문맥으로 포트를 만드는 팩토리로 받는다: 도구 호출 안이면 문맥의 `toolCallId`·`turnId`가 요청의 `origin`이 되어
 * L1.tools가 그 호출의 대기 체크포인트를 같은 커밋에 넣는다.
 *
 * 실제 팩토리는 HOST 조립에서 `xeon.approvals`(core-tools)를 감싸 만든다. core-tools의 기준 구현은 `testing/l2-port.ts`의
 * `l2ApprovalsPort(approvals, { origin })`이고, F `ApprovalService`에 비차단 `open`·`wait`·`get`이 오를 때까지(L1.tools.spec §8.3 F 요청 11)
 * 정식 팩토리는 없다.
 */
export interface ApprovalsPortFactory {
  forCall(context: CallContext | undefined): L2ApprovalsPort;
}
