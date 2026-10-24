import type { OsTime } from "@xeon/contracts/services";

/**
 * 시계와 지연 실행. 질문 시간 제한과 상태줄 묶음 발행이 쓴다. 운영은 `xeon.os`의 `time`을 그대로 넘기고,
 * 테스트는 수동 시계를 넘긴다(eng.testing.guide TS-03).
 */
export type Timers = Pick<OsTime, "clock" | "scheduler">;
