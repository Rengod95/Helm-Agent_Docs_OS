import type { Logger } from "@xeon/contracts";
import type { IdFactory, ThreadId } from "@xeon/contracts/conversation";
import type { ProducerHandle } from "@xeon/contracts/records";
import type { WorkReader, WorkSessionPort } from "./ports/session.ts";
import type { WorkSettings } from "./settings.ts";

/** 작업 서비스 조립에 필요한 의존. 플러그인이 포트에서 모아 넘기고, 시험은 실제 저장소 위에서 직접 넘긴다 */
export interface WorkTasksDeps {
  readonly session: WorkSessionPort;
  /** cap_work_* 읽기 핸들 */
  readonly reader: WorkReader;
  /** `session.producer("cap.work")`로 받은 핸들. 플러그인 setup에서 한 번만 받는다 */
  readonly producer: ProducerHandle;
  readonly ids: IdFactory;
  readonly logger: Logger;
  /** 호출 한 번이 읽는 유효 설정. 스레드의 세션 범위를 포함한다 */
  readonly settings: (threadId: ThreadId) => WorkSettings;
}
