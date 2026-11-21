import { parse } from "@fresnel/contracts";
import {
  TurnCompletedPayloadSchema,
  TurnStartedPayloadSchema,
} from "@fresnel/contracts/conversation";
import type { RegistrationId } from "@fresnel/contracts/extensions";
import {
  AgentSettledEventPayloadSchema,
  AgentSpawnedPayloadSchema,
  LeaseAcquiredPayloadSchema,
  LeaseReleasedPayloadSchema,
  type DurableEventEnvelope,
} from "@fresnel/contracts/records";

/** scope 하나의 이벤트 집계(L3.group-sdk.spec §3.12). 임대는 `lease.*`, 사용량은 `turn.*`(drive 턴)과 `agent.settled`(자식)에서 나온다 */
export interface ScopeUsage {
  readonly leases: number;
  readonly leaseMs: number;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
  };
  readonly costUsd: number;
}

interface MutableUsage {
  leases: number;
  leaseMs: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
}

interface OpenLease {
  readonly scopeId: RegistrationId;
  readonly acquiredAt: number;
}

/**
 * 한 thread의 이벤트열을 scope별 사용량으로 접는다. 순수 함수이고 시계를 읽지 않는다.
 * - `lease.acquired`는 임대 수를 올리고, 같은 `leaseId`의 `lease.released`가 오면 recordedAt 차이를 임대 시간에 더한다.
 *   풀리지 않은 임대는 수에만 든다.
 * - `turn.started`의 scopeId가 null이 아니면 그 turnId를 scope에 묶는다. `turn.completed`의 사용량은 묶인 scope에 더한다.
 * - `agent.settled.usage`는 자식의 사용량이고 부모 `turn.completed`에는 들어 있지 않다. `owner`(없으면 같은 `childThreadId`의 `agent.spawned.owner`)가
 *   `scope`나 `drive`이면 그 scopeId에 더한다. `tool` 소유는 그룹 귀속이 없어 건너뛴다. 같은 `childThreadId`와 `requestId`는 한 번만 센다.
 * 그룹 사용량(토큰과 비용)의 원천은 이 접기 하나다. 메모리 카운터의 `addUsage`는 `group.metrics`가 읽지 않는다.
 * 입력은 이벤트 한 thread를 가지 순서로 준 것이다. 종류별 순서만 맞으면 되고, 검사에 실패한 payload는 건너뛴다.
 */
export function summarizeUsage(
  events: readonly DurableEventEnvelope[],
): ReadonlyMap<RegistrationId, ScopeUsage> {
  const scopes = new Map<RegistrationId, MutableUsage>();
  const openLeases = new Map<string, OpenLease>();
  const turnScopes = new Map<string, RegistrationId>();
  const spawnOwners = new Map<string, RegistrationId>();
  const settledChildren = new Set<string>();

  function scopeOf(scopeId: RegistrationId): MutableUsage {
    const found = scopes.get(scopeId);
    if (found !== undefined) return found;
    const created: MutableUsage = {
      leases: 0,
      leaseMs: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      costUsd: 0,
    };
    scopes.set(scopeId, created);
    return created;
  }

  for (const event of events) {
    if (event.kind === "lease.acquired") {
      const checked = parse(LeaseAcquiredPayloadSchema, event.payload);
      if (!checked.ok) continue;
      scopeOf(checked.value.scopeId).leases += 1;
      openLeases.set(checked.value.leaseId, {
        scopeId: checked.value.scopeId,
        acquiredAt: event.recordedAt,
      });
    } else if (event.kind === "lease.released") {
      const checked = parse(LeaseReleasedPayloadSchema, event.payload);
      if (!checked.ok) continue;
      const open = openLeases.get(checked.value.leaseId);
      if (open === undefined) continue;
      openLeases.delete(checked.value.leaseId);
      scopeOf(open.scopeId).leaseMs += event.recordedAt - open.acquiredAt;
    } else if (event.kind === "turn.started") {
      const checked = parse(TurnStartedPayloadSchema, event.payload);
      if (!checked.ok || checked.value.scopeId === null || event.turnId === null) continue;
      turnScopes.set(event.turnId, checked.value.scopeId);
    } else if (event.kind === "turn.completed") {
      const checked = parse(TurnCompletedPayloadSchema, event.payload);
      if (!checked.ok || checked.value.usage === null || event.turnId === null) continue;
      const scopeId = turnScopes.get(event.turnId);
      if (scopeId === undefined) continue;
      const usage = checked.value.usage;
      const target = scopeOf(scopeId);
      target.input += usage.input;
      target.output += usage.output;
      target.cacheRead += usage.cacheRead;
      target.cacheWrite += usage.cacheWrite;
      target.costUsd += usage.cost.total;
    } else if (event.kind === "agent.spawned") {
      const checked = parse(AgentSpawnedPayloadSchema, event.payload);
      if (!checked.ok || checked.value.owner.kind === "tool") continue;
      spawnOwners.set(checked.value.childThreadId, checked.value.owner.scopeId);
    } else if (event.kind === "agent.settled") {
      const checked = parse(AgentSettledEventPayloadSchema, event.payload);
      if (!checked.ok || checked.value.usage === null) continue;
      const owner = checked.value.owner;
      const scopeId =
        owner === undefined
          ? spawnOwners.get(checked.value.childThreadId)
          : owner.kind === "tool"
            ? undefined
            : owner.scopeId;
      if (scopeId === undefined) continue;
      const key = `${checked.value.childThreadId}:${checked.value.requestId}`;
      if (settledChildren.has(key)) continue;
      settledChildren.add(key);
      const usage = checked.value.usage;
      const target = scopeOf(scopeId);
      target.input += usage.input;
      target.output += usage.output;
      target.cacheRead += usage.cacheRead;
      target.cacheWrite += usage.cacheWrite;
      target.costUsd += usage.cost.total;
    }
  }

  return new Map(
    [...scopes].map(([scopeId, usage]) => [
      scopeId,
      {
        leases: usage.leases,
        leaseMs: usage.leaseMs,
        tokens: {
          input: usage.input,
          output: usage.output,
          cacheRead: usage.cacheRead,
          cacheWrite: usage.cacheWrite,
        },
        costUsd: usage.costUsd,
      },
    ]),
  );
}
