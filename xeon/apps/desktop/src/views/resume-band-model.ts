import type { ThreadSummary } from "@fresnel/contracts/wire";

// 트랜스크립트 끝의 "이어서 실행" 띠가 무엇을 보일지 정한다(SC-12, P-02). 화면 없이 시험한다.
// - crashed: 앱·엔진이 비정상 종료돼 열린 turn의 복구 표식이 남았다. "이어서 실행"과 "그대로 두기"
// - held: 중단 뒤 큐에 남은 입력이 있다. 자동으로 시작하지 않으므로 "보내기"로 시작한다 [기본값]
export type ResumeBandView =
  | { readonly kind: "crashed"; readonly runningSince: string }
  | { readonly kind: "held"; readonly queued: number };

export function resumeBandOf(thread: ThreadSummary | undefined): ResumeBandView | null {
  if (thread === undefined) return null;
  if (thread.resumable !== null) {
    return { kind: "crashed", runningSince: thread.resumable.runningSince };
  }
  if (thread.status === "idle" && thread.queuedInputs > 0) {
    return { kind: "held", queued: thread.queuedInputs };
  }
  return null;
}
