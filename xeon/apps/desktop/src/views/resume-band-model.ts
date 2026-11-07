import type { MessageId } from "@fresnel/client/i18n";
import type { ThreadSummary } from "@fresnel/contracts/wire";

// 트랜스크립트 끝의 "이어서 실행" 띠가 무엇을 보일지 정한다(SC-12, P-02). 화면 없이 시험한다.
// - crashed: 앱·엔진이 비정상 종료돼 열린 turn의 복구 표식이 남았다. "이어서 실행"과 "그대로 두기"
// - held: 중단 뒤 큐에 남은 입력이 있다. 자동으로 시작하지 않으므로 "보내기"로 시작한다 [기본값]
export type ResumeBandView =
  | { readonly kind: "crashed"; readonly runningSince: string; readonly turnId: string }
  | { readonly kind: "held"; readonly queued: number };

/**
 * `queued`는 거울의 대기 입력 수다. 요약의 `queuedInputs`는 목록을 읽을 때만 채워지므로 쓰지 않는다.
 * `approvals`는 그 대화에서 답을 기다리는 승인 수다(거울 목록과 요약 수 중 큰 쪽). 승인을 기다리는 턴은 열린 채 살아 있다:
 * 엔진이 다시 열릴 때 recover가 죽은 턴의 대기 승인을 정리하므로, 승인이 남아 있으면 앱이 멈춘 턴이 아니다.
 * 이때 복구 표식은 남지만 "중단된 턴" 띠는 내지 않는다
 */
export function resumeBandOf(
  thread: ThreadSummary | undefined,
  queued: number,
  approvals: number,
): ResumeBandView | null {
  if (thread === undefined) return null;
  if (thread.resumable !== null) {
    if (approvals > 0) return null;
    return {
      kind: "crashed",
      runningSince: thread.resumable.runningSince,
      turnId: thread.resumable.turnId,
    };
  }
  if (thread.status === "idle" && queued > 0) {
    return { kind: "held", queued };
  }
  return null;
}

/**
 * "이어서 실행"이 시작된 뒤에는 같은 복구 표식의 띠를 닫는다. 표식은 turn이 끝나야 지워지고 그 사이 상태는 running이라
 * 상태만으로는 이어 실행 중인지 앱이 멈춘 채인지 가를 수 없다. 이어서 실행이 시작됐다고 답받은 turn id를 기억해 비교한다
 */
export function resumeBandClosed(view: ResumeBandView | null, resumedTurn: string | null): boolean {
  return view !== null && view.kind === "crashed" && resumedTurn === view.turnId;
}

/**
 * 사이드바 행이 "이어서 실행"을 보일지. 띠(`resumeBandOf`)와 같은 기준이다: 복구 표식이 있어도 승인을 기다리면
 * 멈춘 턴이 아니므로 행은 "승인 N"만 보인다
 */
export function rowResumable(thread: ThreadSummary, approvals: number): boolean {
  return thread.resumable !== null && approvals === 0;
}

/**
 * 중단 띠의 본문 문장. 원격 대상이면 끊긴 것은 서비스 연결이라 그 문장을, 이 기기면 앱이 다시 시작된 문장을 쓴다.
 * 끊긴 쪽을 틀리게 말하지 않으려고 대상으로 가른다
 */
export function crashedBodyOf(remote: boolean): MessageId {
  return remote ? "desktop.resumeBand.crashed.bodyService" : "desktop.resumeBand.crashed.body";
}
