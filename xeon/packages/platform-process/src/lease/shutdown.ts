import { Bug, type Clock, type Logger, type Scheduler } from "@xeon/contracts";
import type { ShutdownCoordinator, ShutdownReason } from "@xeon/contracts/services";

// L0.process.spec §3.2·§4.2, L0.process.plan PR-07. ShutdownCoordinator의 소유자 쪽이다.
// 참여자는 등록 역순으로 하나씩 기다리며 부르고, 시한을 넘기면 기다리지 않고 exit(1)을 부른다.
// 모두 끝났을 때의 종료코드 0은 요청한 쪽(host.shutdown 처리기, watchChildLease)이 응답을 보낸 뒤에 부른다.

export interface ShutdownOutcome {
  /** 모든 참여자가 시한 안에 끝났으면 참 */
  readonly completed: boolean;
  readonly elapsedMs: number;
}

export interface ProcessShutdown extends ShutdownCoordinator {
  /** 종료를 요청한다. 참여자를 시한 안에서 기다리고, 넘으면 exit(1). 두 번째 호출은 첫 Promise를 돌려준다 */
  request(reason: ShutdownReason): Promise<ShutdownOutcome>;
}

export interface ProcessShutdownOptions {
  /** l0.process.shutdown.timeoutMs */
  readonly timeoutMs: number;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  /** 시한 초과 때 exit(1)로 부른다. 테스트에서 주입한다 */
  readonly exit: (code: number) => never;
  readonly logger?: Logger;
}

interface Participant {
  readonly name: string;
  readonly run: (reason: ShutdownReason) => Promise<void>;
}

function describeError(caught: unknown): string {
  return caught instanceof Error ? caught.message : "non_error_thrown";
}

export function createProcessShutdown(options: ProcessShutdownOptions): ProcessShutdown {
  const { timeoutMs, clock, scheduler, exit, logger } = options;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Bug("shutdown timeoutMs must be a positive number");
  }
  const controller = new AbortController();
  const participants: Participant[] = [];
  const late: Promise<void>[] = [];
  let currentReason: ShutdownReason | null = null;
  let requested: Promise<ShutdownOutcome> | undefined;

  /** 참여자 예외는 진단에 남기고 삼킨다. 다음 참여자를 부르고 종료코드는 바뀌지 않는다 */
  async function callParticipant(participant: Participant, reason: ShutdownReason): Promise<void> {
    try {
      await participant.run(reason);
    } catch (caught) {
      logger?.error("shutdown.participant_failed", {
        name: participant.name,
        error: describeError(caught),
      });
    }
  }

  /** 등록 역순으로 하나씩 기다린다. 앞 참여자가 끝나야 다음을 부른다 */
  async function runParticipants(reason: ShutdownReason): Promise<void> {
    await participants
      .toReversed()
      .reduce<Promise<void>>(
        (chain, participant) => chain.then(() => callParticipant(participant, reason)),
        Promise.resolve(),
      );
    await Promise.all(late);
  }

  function start(reason: ShutdownReason): Promise<ShutdownOutcome> {
    currentReason = reason;
    controller.abort(reason);
    const startedAt = clock.now();
    logger?.info("shutdown.requested", { reason });
    return new Promise<ShutdownOutcome>((resolve) => {
      let settled = false;
      const timer = scheduler.setTimeout(() => {
        if (settled) return;
        settled = true;
        const elapsedMs = clock.now() - startedAt;
        logger?.warn("shutdown.timeout", { reason, elapsedMs, timeoutMs });
        resolve({ completed: false, elapsedMs });
        exit(1);
      }, timeoutMs);
      const finish = (): void => {
        if (settled) return;
        settled = true;
        scheduler.clearTimeout(timer);
        resolve({ completed: true, elapsedMs: clock.now() - startedAt });
      };
      runParticipants(reason).then(finish, (caught: unknown) => {
        logger?.error("shutdown.run_failed", { error: describeError(caught) });
        finish();
      });
    });
  }

  return {
    get signal(): AbortSignal {
      return controller.signal;
    },
    get reason(): ShutdownReason | null {
      return currentReason;
    },
    onShutdown(name, run) {
      const participant: Participant = { name, run };
      participants.push(participant);
      // 종료가 이미 시작됐으면 바로 부른다. 진행 중인 실행이 아직 기다리고 있으면 그 시한 안에서 기다린다
      if (currentReason !== null) late.push(callParticipant(participant, currentReason));
      return () => {
        const index = participants.indexOf(participant);
        if (index >= 0) participants.splice(index, 1);
      };
    },
    request(reason) {
      requested ??= start(reason);
      return requested;
    },
  };
}
