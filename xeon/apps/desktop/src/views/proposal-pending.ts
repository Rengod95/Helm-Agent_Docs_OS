import type { Result } from "@fresnel/contracts";
import type { NoticeKind } from "@fresnel/contracts/capabilities";
import type { ProposalListParams } from "@fresnel/contracts/wire";
import type { CommandError } from "./commands.ts";

// 대기 제안 수. 사이드바 "제안" 배지와 받은 요청의 제안 줄이 함께 쓴다(SC-06 1단계, P-03).
// 수는 `proposal.list { status: ["pending"] }`의 행 수다. 출처와 종류는 거르지 않는다.

/** 한 번에 읽는 대기 행의 수(`proposal.list`의 상한). 넘는 행은 세지 않는다 [결정: 오케스트레이터 기본값, fxLM] */
export const PENDING_PROPOSAL_LIMIT = 200;

/** 연결이 살아 있는 동안의 주기 다시 읽기 간격(ms) [결정: 오케스트레이터 기본값, fxLM] */
export const PENDING_REFRESH_MS = 30_000;

/** 대기 행만 읽는 질의. 출처와 종류는 거르지 않는다 */
export function pendingListParams(): ProposalListParams {
  return { status: ["pending"], limit: PENDING_PROPOSAL_LIMIT };
}

/** 읽기에 쓰는 명령. 실제 값은 `commands.proposals.list`다(행 수만 필요하다) */
export interface PendingReadPorts {
  readonly proposals: (
    params: ProposalListParams,
  ) => Promise<Result<{ readonly rows: readonly unknown[] }, CommandError>>;
}

/** 대기 제안 수를 읽는다. 목록을 못 읽으면 0이다(오류로 알리지 않는다). 읽은 행을 그대로 센다 */
export async function readPendingCount(ports: PendingReadPorts): Promise<number> {
  const listed = await ports.proposals(pendingListParams());
  return listed.ok ? listed.value.rows.length : 0;
}

/** 다시 읽는 때를 건다. 모두 값이 함수라서 시험이 가짜 시계와 가짜 사건으로 돌릴 수 있다 */
export interface PendingWatchPorts {
  readonly read: () => void;
  /** 주기 호출. 반환값을 부르면 멈춘다 */
  readonly every: (ms: number, listener: () => void) => () => void;
  /** 창이 앞으로 올라왔을 때. 반환값은 구독 해제 */
  readonly onFocus: (listener: () => void) => () => void;
  /** 전달된 알림의 종류. 반환값은 구독 해제 */
  readonly onNotice: (listener: (kind: NoticeKind) => void) => () => void;
}

/**
 * 다시 읽는 때: 붙을 때 한 번, 주기(30초), 창이 앞으로 올 때, 배경 작업이 끝났다는 알림이 올 때.
 * 학습 검토의 끝을 알리는 전용 알림은 없고, 검토가 끝나면 `agent.settled`의 배경 완료 알림이 온다(spec 7.5 1단계).
 * 반환값을 부르면 모두 끊는다.
 */
export function watchPendingCount(ports: PendingWatchPorts): () => void {
  ports.read();
  const stops = [
    ports.every(PENDING_REFRESH_MS, ports.read),
    ports.onFocus(ports.read),
    ports.onNotice((kind) => {
      if (kind === "background_completed") ports.read();
    }),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}
