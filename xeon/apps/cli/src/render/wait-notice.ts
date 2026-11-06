import { detach } from "@fresnel/contracts";

// print 모드의 침묵 안내(L4.cli.spec §4.5.2). 긴 대화를 이어 가면 첫 출력까지 요약과 모델 호출로 수십 초가 걸린다.
// 첫 출력이 없는 채로 일정 시간이 지나면 stderr에 한 줄을 한 번만 낸다. 출력이 시작됐거나 turn이 끝났으면 내지 않는다.

/** 첫 출력이 없을 때 안내를 내기까지의 시간 */
export const PRINT_WAIT_NOTICE_MS = 5000;

export interface WaitNotice {
  /** 타이머를 거둔다. 안내가 이미 나갔거나 turn이 끝났으면 아무 일도 하지 않는다 */
  stop(): void;
}

export interface WaitNoticeOptions {
  readonly afterMs: number;
  /** 지금까지 turn의 출력이 있었는지 */
  readonly hasOutput: () => boolean;
  readonly write: (text: string) => Promise<void>;
  readonly text: string;
  /** 쓰기가 실패해도 turn을 막지 않는다. 실패는 여기로 넘긴다 */
  readonly onWriteFailure: (caught: unknown) => void;
}

export function startWaitNotice(options: WaitNoticeOptions): WaitNotice {
  const timer = setTimeout(() => {
    if (options.hasOutput()) return;
    detach(options.write(options.text), options.onWriteFailure);
  }, options.afterMs);
  return {
    stop() {
      clearTimeout(timer);
    },
  };
}
