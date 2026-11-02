import type { ScheduleService } from "@fresnel/cap-schedule";
import type { TestRunControlPort, TraceReadPort } from "@fresnel/contracts/extensions";
import type { Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ReadFailure } from "@fresnel/contracts/records";
import type { DialogAreaHolder } from "./dialog-area-bridge.ts";

// M4 포트 구현이 받는 의존. 계측 읽기와 Test run 제어는 계약의 포트 타입이라 소유 트랙이 ext-host를 기다리지 않는다.
// T-F 시점에는 빈 구현을 넘기고, T-XD의 마지막 커밋이 `index.ts`에서 ext-host 구현으로 바꾼다(`spec-deltas/t-f.md` §5 4번).

/** 엔진 포트에서 오는 의존. `createEnginePorts`가 넘긴다. 소유 트랙마다 필요한 만큼만 더한다 */
export interface M4EngineDeps {
  /** T-WC: 예약 서비스(`schedule.update`, `schedule.runs`) */
  readonly schedule: Pick<ScheduleService, "open" | "list" | "runs" | "update">;
  /** T-WC: thread 존재 확인(`goal.status`, `work.tasks.list`) */
  readonly threads: {
    exists(threadId: ThreadId): Result<boolean, ReadFailure>;
  };
  /** T-WC: 목표·작업 기능 API 자리(조립 확장이 채운다) */
  readonly dialogArea: DialogAreaHolder;
}

export interface M4PortDeps extends M4EngineDeps {
  readonly traceRead: TraceReadPort;
  readonly testRunControl: TestRunControlPort;
}
