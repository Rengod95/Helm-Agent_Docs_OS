import type { Clock, Logger } from "@fresnel/contracts";
import type { LeaseHolder, LeaseService, LeaseToken } from "@fresnel/contracts/records";
import type { ScheduleLeader, ScheduleLeadership } from "@fresnel/cap-schedule";

// L2.schedule.spec §4.4.3, L4.host-service.spec HS-40. 틱 Scheduler leader를 `sys_leases`의 `scheduler` 자원으로 판정한다.
// 쥔 동안 하트비트(`keepAlive`)가 임대를 늘리고, 잃으면(만료 뒤 다른 프로세스가 가져감) `onLost`를 한 번 부른다.

const SCHEDULER_RESOURCE = "scheduler";

export interface StoreScheduleLeaderDeps {
  readonly leases: Pick<LeaseService, "acquire" | "release" | "inspect" | "keepAlive">;
  readonly holder: LeaseHolder;
  readonly logger: Logger;
}

/** 이 프로세스의 임대를 새로 읽어 대조한다. 읽지 못하면 쥐지 않은 것으로 본다(틱을 멈추는 쪽이 안전하다) */
function holdsToken(
  leases: Pick<LeaseService, "inspect">,
  token: LeaseToken,
  now: number,
): boolean {
  const owner = leases.inspect(SCHEDULER_RESOURCE);
  if (!owner.ok || owner.value === null) return false;
  return (
    owner.value.holderId === token.holderId &&
    owner.value.epoch === token.epoch &&
    owner.value.expiresAt > now
  );
}

export function createStoreScheduleLeader(
  deps: StoreScheduleLeaderDeps & { readonly clock: Pick<Clock, "now"> },
): ScheduleLeader {
  return {
    tryAcquire(onLost): ScheduleLeadership | null {
      const acquired = deps.leases.acquire(SCHEDULER_RESOURCE, deps.holder);
      if (!acquired.ok) {
        // 다른 프로세스가 쥐고 있으면 정상이다. 그 밖의 실패는 남긴다
        if (acquired.error.kind !== "busy" && acquired.error.kind !== "lock_busy") {
          deps.logger.warn("schedule.leader_acquire_failed", { kind: acquired.error.kind });
        }
        return null;
      }
      const token = acquired.value;
      let released = false;
      const alive = deps.leases.keepAlive(token, () => {
        released = true;
        onLost();
      });
      return {
        holds: () => !released && holdsToken(deps.leases, token, deps.clock.now()),
        release: () => {
          if (released) return;
          released = true;
          alive[Symbol.dispose]();
          const done = deps.leases.release(token);
          if (!done.ok)
            deps.logger.warn("schedule.leader_release_failed", { kind: done.error.kind });
        },
      };
    },
  };
}

/** 살아 있는 Scheduler leader가 있는가(이 프로세스든 다른 프로세스든). `service_mode_off` 경고의 근거다 */
export function schedulerLeaderIsLive(
  leases: Pick<LeaseService, "inspect">,
  clock: Pick<Clock, "now">,
): boolean {
  const owner = leases.inspect(SCHEDULER_RESOURCE);
  return owner.ok && owner.value !== null && owner.value.expiresAt > clock.now();
}
