// X 기록 포트의 읽기 쪽(L1.persistence.spec §3.3 `ext.loadThread`, `ext.queryRecords`, TxView의 scopeStateRev·scopeLeaseEpoch).
// 켜짐·임대·상태 판은 모두 활성 가지(현재 leaf에서 parentId 사슬) 위 이벤트로 계산한다(X.primitives.spec §4.6.1).
// X 소유 투영 테이블(x_<name>_*)은 읽지 않는다(CM-02).
import { err, ok, parse, type Result } from "@xeon/contracts";
import {
  toJsonValue,
  TurnCompletedPayloadSchema,
  TurnStartedPayloadSchema,
  type ThreadId,
} from "@xeon/contracts/conversation";
import { GroupRecordSchema } from "@xeon/contracts/extensions";
import {
  AgentSettledEventPayloadSchema,
  AgentSpawnedPayloadSchema,
  LeaseAcquiredPayloadSchema,
  LeaseReleasedPayloadSchema,
  ScopeChangedPayloadSchema,
  type DurableEventEnvelope,
  type ExtensionEventKind,
  type ExtRecordQuery,
  type ExtRecordRow,
  type ExtThreadSnapshot,
  type OpenLease,
  type SqlTx,
  type StoredScopeState,
} from "@xeon/contracts/records";
import {
  branchEvents,
  branchEventsWithOwner,
  kindIn,
  latestEvent,
  type KindFilter,
} from "./branch.ts";
import { EXT_STATE_KIND_SUFFIX, ExtStatePayloadSchema } from "./ext-state.ts";
import { rowInvalid, type RowFault } from "./rows.ts";

/** 활성 가지에서 읽는 확장 상태 이벤트의 kind 조건 */
const STATE_FILTER: KindFilter = { sql: `kind LIKE '%${EXT_STATE_KIND_SUFFIX}'`, params: [] };

function storedStateOf(event: DurableEventEnvelope): Result<StoredScopeState, RowFault> {
  const payload = parse(ExtStatePayloadSchema, event.payload);
  if (!payload.ok) return err(rowInvalid(`events.envelope ${event.kind} payload`));
  const doc = toJsonValue(payload.value.doc);
  if (doc === undefined) return err(rowInvalid(`events.envelope ${event.kind} doc`));
  return ok({
    scopeId: payload.value.scopeId,
    eventId: event.id,
    rev: payload.value.rev,
    version: payload.value.version,
    doc,
  });
}

/** 활성 가지 위 scope의 마지막 상태 판. 없으면 undefined(판 0) */
export function activeStateOf(
  tx: SqlTx,
  threadId: ThreadId,
  scopeId: string,
): Result<StoredScopeState | undefined, RowFault> {
  const found = latestEvent(tx, threadId, STATE_FILTER, {
    match: { pointer: "/scopeId", equals: scopeId },
    onActiveBranch: true,
  });
  if (!found.ok) return found;
  if (found.value === undefined) return ok(undefined);
  return storedStateOf(found.value);
}

/** 활성 가지 위 scope의 lease.acquired 수(= 임대 차수). 임대가 없었으면 0 */
export function activeLeaseEpoch(
  tx: SqlTx,
  threadId: ThreadId,
  scopeId: string,
): Result<number, RowFault> {
  const events = branchEvents(tx, threadId, kindIn(["lease.acquired"]));
  if (!events.ok) return events;
  let epoch = 0;
  for (const event of events.value) {
    const payload = parse(LeaseAcquiredPayloadSchema, event.payload);
    if (!payload.ok) return err(rowInvalid("events.envelope lease.acquired payload"));
    if (payload.value.scopeId === scopeId) epoch += 1;
  }
  return ok(epoch);
}

/** 열린 임대가 쓴 양: 임대를 받은 뒤 같은 scope가 시작한 turn과 이 임대가 소유한 spawn(L1.persistence.spec §3.3) */
function usedSince(
  tx: SqlTx,
  threadId: ThreadId,
  lease: { readonly leaseId: string; readonly scopeId: string; readonly acquiredSeq: number },
): Result<OpenLease["used"], RowFault> {
  const events = branchEvents(
    tx,
    threadId,
    kindIn(["turn.started", "turn.completed", "agent.spawned", "agent.settled"]),
  );
  if (!events.ok) return events;
  const ownTurns = new Set<string>();
  const ownChildren = new Set<string>();
  let turns = 0;
  let spawns = 0;
  let tokens = 0;
  for (const event of events.value) {
    if (event.seq <= lease.acquiredSeq) continue;
    if (event.kind === "turn.started") {
      const payload = parse(TurnStartedPayloadSchema, event.payload);
      if (!payload.ok) return err(rowInvalid("events.envelope turn.started payload"));
      if (payload.value.scopeId === lease.scopeId && event.turnId !== null) {
        ownTurns.add(event.turnId);
        turns += 1;
      }
    } else if (event.kind === "turn.completed") {
      if (event.turnId === null || !ownTurns.has(event.turnId)) continue;
      const payload = parse(TurnCompletedPayloadSchema, event.payload);
      if (!payload.ok) return err(rowInvalid("events.envelope turn.completed payload"));
      tokens += payload.value.usage?.totalTokens ?? 0;
    } else if (event.kind === "agent.spawned") {
      const payload = parse(AgentSpawnedPayloadSchema, event.payload);
      if (!payload.ok) return err(rowInvalid("events.envelope agent.spawned payload"));
      const { owner } = payload.value;
      if (owner.kind === "drive" && owner.leaseId === lease.leaseId) {
        ownChildren.add(payload.value.childThreadId);
        spawns += 1;
      }
    } else if (event.kind === "agent.settled") {
      const payload = parse(AgentSettledEventPayloadSchema, event.payload);
      if (!payload.ok) return err(rowInvalid("events.envelope agent.settled payload"));
      if (ownChildren.has(payload.value.childThreadId)) {
        tokens += payload.value.usage?.totalTokens ?? 0;
      }
    }
  }
  return ok({ turns, spawns, tokens });
}

/** `ext.loadThread`: 활성 가지 위 scope.changed, lease.*, 상태 이벤트로 계산한 스냅샷 */
export function loadSnapshot(tx: SqlTx, threadId: ThreadId): Result<ExtThreadSnapshot, RowFault> {
  const scopeEvents = kindIn(["scope.changed", "lease.acquired", "lease.released"]);
  const events = branchEvents(tx, threadId, {
    sql: `(${scopeEvents.sql} OR ${STATE_FILTER.sql})`,
    params: scopeEvents.params,
  });
  if (!events.ok) return events;

  const enabled = new Set<string>();
  const disabled = new Set<string>();
  const transitions = new Map<string, number>();
  const enabledAtSeq = new Map<string, number>();
  const leaseEpochs = new Map<string, number>();
  const states = new Map<string, StoredScopeState>();
  let open: {
    readonly leaseId: string;
    readonly scopeId: string;
    readonly leaseEpoch: number;
    readonly limits: OpenLease["limits"];
    readonly acquiredSeq: number;
  } | null = null;

  for (const event of events.value) {
    if (event.kind === "scope.changed") {
      const payload = parse(ScopeChangedPayloadSchema, event.payload);
      if (!payload.ok) return err(rowInvalid("events.envelope scope.changed payload"));
      const { scopeId, status } = payload.value;
      transitions.set(scopeId, (transitions.get(scopeId) ?? 0) + 1);
      if (status === "enabled") {
        enabled.add(scopeId);
        disabled.delete(scopeId);
        enabledAtSeq.set(scopeId, event.seq);
      } else {
        enabled.delete(scopeId);
        disabled.add(scopeId);
        enabledAtSeq.delete(scopeId);
      }
    } else if (event.kind === "lease.acquired") {
      const payload = parse(LeaseAcquiredPayloadSchema, event.payload);
      if (!payload.ok) return err(rowInvalid("events.envelope lease.acquired payload"));
      const { scopeId, leaseId, limits } = payload.value;
      const epoch = (leaseEpochs.get(scopeId) ?? 0) + 1;
      leaseEpochs.set(scopeId, epoch);
      open = {
        leaseId,
        scopeId,
        leaseEpoch: epoch,
        limits: {
          ...(limits.maxTurns === undefined ? {} : { maxTurns: limits.maxTurns }),
          ...(limits.maxSpawns === undefined ? {} : { maxSpawns: limits.maxSpawns }),
          ...(limits.maxTokens === undefined ? {} : { maxTokens: limits.maxTokens }),
        },
        acquiredSeq: event.seq,
      };
    } else if (event.kind === "lease.released") {
      const payload = parse(LeaseReleasedPayloadSchema, event.payload);
      if (!payload.ok) return err(rowInvalid("events.envelope lease.released payload"));
      if (open?.leaseId === payload.value.leaseId) open = null;
    } else {
      const state = storedStateOf(event);
      if (!state.ok) return state;
      states.set(state.value.scopeId, state.value);
    }
  }

  let openLease: OpenLease | null = null;
  if (open !== null) {
    const used = usedSince(tx, threadId, open);
    if (!used.ok) return used;
    openLease = {
      leaseId: open.leaseId,
      scopeId: open.scopeId,
      leaseEpoch: open.leaseEpoch,
      limits: open.limits,
      used: used.value,
    };
  }
  return ok({
    enabled: [...enabled],
    disabled: [...disabled],
    scopeTransitions: Object.fromEntries(transitions),
    enabledAtSeq: Object.fromEntries(enabledAtSeq),
    states: [...states.values()],
    openLease,
    leaseEpochs: Object.fromEntries(leaseEpochs),
  });
}

function isExtensionKind(kind: string): kind is ExtensionEventKind {
  return kind.startsWith("x.") || kind.startsWith("grp.");
}

function ownerOfExtensionKind(kind: string): string {
  return kind.split(".")[1] ?? "";
}

/**
 * `ext.queryRecords`: 활성 가지 위 확장 기록. 비공개 행(private_owner)은 reader가 쓴 확장일 때만 돌려준다.
 * 공개 행의 payload는 GroupRecord이고, 비공개 행은 확장이 정한 payload를 그대로 싣는다
 */
export function queryActiveRecords(
  tx: SqlTx,
  threadId: ThreadId,
  query: ExtRecordQuery,
  reader: string,
): Result<readonly ExtRecordRow[], RowFault> {
  const exact = !query.kind.endsWith("*");
  const prefix = exact ? query.kind : query.kind.slice(0, -1);
  const events = branchEventsWithOwner(tx, threadId, {
    sql: `${exact ? "kind = ?" : "substr(kind, 1, ?) = ?"} AND (private_owner IS NULL OR private_owner = ?)`,
    params: exact ? [prefix, reader] : [prefix.length, prefix, reader],
  });
  if (!events.ok) return events;
  const rows: ExtRecordRow[] = [];
  for (const { envelope: event, privateOwner } of events.value) {
    const kind = event.kind;
    if (!isExtensionKind(kind) || kind.endsWith(EXT_STATE_KIND_SUFFIX)) continue;
    let row: ExtRecordRow | undefined;
    if (privateOwner === null) {
      const record = parse(GroupRecordSchema, event.payload);
      if (record.ok) {
        row = {
          groupId: record.value.groupId,
          kind,
          version: record.value.version,
          subject: record.value.subject,
          payload: record.value.payload,
        };
      }
    } else {
      const payload = toJsonValue(event.payload);
      if (payload !== undefined) {
        row = {
          groupId: ownerOfExtensionKind(kind),
          kind,
          version: event.version,
          subject: { type: "thread", id: event.threadId },
          payload,
        };
      }
    }
    if (row === undefined) continue;
    const { subject } = query;
    if (
      subject !== undefined &&
      (row.subject.type !== subject.type || row.subject.id !== subject.id)
    ) {
      continue;
    }
    rows.push(row);
    if (query.limit !== undefined && rows.length >= query.limit) break;
  }
  return ok(rows);
}
