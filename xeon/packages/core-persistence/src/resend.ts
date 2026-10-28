import type { ResumePlan } from "@xeon/contracts/records";

// L1.persistence.spec §4.8.4, L1.loop.spec §4.5 (M3-REQ-81). 재개 때 모델 요청을 다시 보낼지의 정책.
// [결정: 오케스트레이터 기본값] 체크포인트 재전송이다. 요청별 멱등 키는 쓰지 않는다: 제공자 API에 멱등 키 수단이 공통으로 없고,
// 재개 요청의 컨텍스트는 커밋된 이벤트에서 결정적으로 다시 만들어져 끊기지 않은 실행의 같은 요청과 같은 `contextHash`를 갖는다.
// 단계 하나의 응답이 T3 커밋 전에 끊기면 그 단계의 요청이 한 번 더 나가고(제공자 쪽 중복 과금 가능), T3 뒤에 끊기면 응답은 다시 받지 않는다.

export type ModelRequestResend =
  /** 열린 단계의 응답이 커밋되지 않았다. 같은 단계 번호로 요청을 다시 보낸다 */
  | { readonly kind: "resend_step"; readonly stepIndex: number }
  /** 응답이 이미 커밋됐다(도구 단계 이후). 모델 요청을 다시 보내지 않는다 */
  | { readonly kind: "none" };

/** 정책 이름. 문서와 시험이 같은 값을 쓴다 */
export const MODEL_REQUEST_RESEND_POLICY = "checkpoint_resend" as const;

export function modelRequestResendOf(
  plan: Pick<ResumePlan, "next" | "checkpoint" | "marker">,
): ModelRequestResend {
  if (plan.next !== "request") return { kind: "none" };
  // 열린 turn의 마지막 완료 단계 다음 번호부터 다시 연다. 그 turn의 체크포인트가 없으면(첫 요청 전에 끊김) 0번 단계다
  const { checkpoint, marker } = plan;
  const sameTurn = checkpoint !== null && marker !== null && checkpoint.turnId === marker.turnId;
  return { kind: "resend_step", stepIndex: sameTurn ? checkpoint.stepIndex + 1 : 0 };
}
