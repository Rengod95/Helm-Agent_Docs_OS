import type { Clock } from "@xeon/contracts";
import type { LearningBridge } from "./bridge.ts";
import type { LearningQueueReader } from "./proposals/reader.ts";
import type { CommandReport } from "./results.ts";

/** 조립 루트가 넘기는 의존. 시간과 읽기 면은 주입한다(eng.typescript.guide TY-21) */
export interface LearningDeps {
  readonly clock: Clock;
  /** 대기열 읽기 면(투영 `x_learning_*`). 쓰기는 그룹이 기록으로 한다 */
  readonly reader: LearningQueueReader;
  /** 조립 루트(L4)가 대기열 목록 면을 받아 가는 자리 */
  readonly bridge?: LearningBridge;
  /**
   * `/learning` 명령 결과를 받는 자리. F `CommandResourceDef.handler`는 값을 돌려주지 않아 결과를 이 콜백으로 낸다.
   * `invocationId`는 명령 호출 id라 호출한 쪽이 자기 호출의 결과를 알아본다
   */
  readonly report?: (report: CommandReport, invocationId: string) => void;
}
