import type { ThreadId } from "@fresnel/contracts/conversation";
import type { RegistrationId, RegistrationStatus } from "@fresnel/contracts/extensions";
import { hostInternalsOf, type ExtHost } from "./host.ts";
import { DEFAULT_LEASE_WAIT_LIMIT } from "./settings.ts";

/** 임대를 받지 못하고 기다리는 후보 하나(`group.driveLock`의 candidates) */
export interface DriveLockCandidate {
  readonly registrationId: RegistrationId;
  /** 넘긴 `turn_settled`·`idle` 경계 수 */
  readonly waits: number;
  /** `x.primitives.leaseWaitLimit`. 넘으면 거부된다 */
  readonly waitLimit: number;
}

/** thread 하나의 drive lock 읽기. 열린 thread만 있다 */
export interface DriveLockView {
  /** 임대를 가진 Registration id. 커밋되지 않았거나 반납이 커밋된 임대는 보유자가 아니라서 null */
  readonly holder: RegistrationId | null;
  readonly leaseEpoch: number;
  /** 임대가 정한 상한. 없는 필드는 상한 없음 */
  readonly limits: { readonly turns?: number; readonly spawns?: number; readonly tokens?: number };
  readonly used: { readonly turns: number; readonly spawns: number; readonly tokens: number };
  readonly candidates: readonly DriveLockCandidate[];
}

/** 조립 루트가 wire 확장 읽기(`ext.list`, `group.driveLock`)에 쓰는 읽기 전용 조회 */
export interface ExtReadView {
  /**
   * 그 thread에서의 Registration 상태. thread가 열려 있지 않거나 모르는 Registration이면 undefined.
   * 켜져 있고 요청도 켜짐이면 enabled, 꺼져 있고 요청도 꺼짐이면 disabled, 둘이 다르면 enabling·disabling이다
   */
  threadStatus(threadId: ThreadId, scopeId: RegistrationId): RegistrationStatus | undefined;
  /** thread의 drive lock. thread가 열려 있지 않으면 undefined */
  driveLock(threadId: ThreadId): DriveLockView | undefined;
}

/** 내부는 부를 때 얻는다. `createExtHost`가 만들지 않은 대역 ExtHost로도 만들 수 있게 한다(`traceReadOf`와 같다) */
export function extReadViewOf(host: ExtHost): ExtReadView {
  return {
    threadStatus(threadId, scopeId) {
      const { core } = hostInternalsOf(host);
      const thread = core.threads.get(threadId);
      const record = core.scopes.get(scopeId);
      if (thread === undefined || record === undefined) return undefined;
      const running = thread.active.has(scopeId);
      const wanted = thread.want.get(scopeId)?.enabled ?? record.desired;
      if (running) return wanted ? "enabled" : "disabling";
      return wanted ? "enabling" : "disabled";
    },
    driveLock(threadId) {
      const { core } = hostInternalsOf(host);
      const thread = core.threads.get(threadId);
      if (thread === undefined) return undefined;
      const lease = thread.lease;
      const held = lease !== null && lease.status !== "released" && lease.committed ? lease : null;
      const limit = core.deps.settings.leaseWaitLimit?.(threadId) ?? DEFAULT_LEASE_WAIT_LIMIT;
      return {
        holder: held === null ? null : held.scopeId,
        leaseEpoch: held === null ? 0 : held.leaseEpoch,
        limits: {
          ...(held?.limits.maxTurns === undefined ? {} : { turns: held.limits.maxTurns }),
          ...(held?.limits.maxSpawns === undefined ? {} : { spawns: held.limits.maxSpawns }),
          ...(held?.limits.maxTokens === undefined ? {} : { tokens: held.limits.maxTokens }),
        },
        used: held === null ? { turns: 0, spawns: 0, tokens: 0 } : { ...held.used },
        candidates: [...thread.leaseWait.entries()].map(([registrationId, wait]) => ({
          registrationId,
          waits: wait.waited,
          waitLimit: limit,
        })),
      };
    },
  };
}
