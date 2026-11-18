// X 기록 포트의 읽기 쪽(L1.persistence.spec §3.3 `ext.loadThread`, `ext.queryRecords`, TxView의 scopeStateRev·scopeLeaseEpoch).
// 켜짐·임대·상태 판은 모두 활성 가지(현재 leaf에서 parentId 사슬) 위 이벤트로 계산한다(X.primitives.spec §4.6.1).
// X 소유 투영 테이블(x_<name>_*)은 읽지 않는다(CM-02).
import { err, ok, parse, type Result } from "@fresnel/contracts";
import {
  toJsonValue,
  TurnCompletedPayloadSchema,
  TurnStartedPayloadSchema,
  type ThreadId,
} from "@fresnel/contracts/conversation";
import { GroupRecordSchema } from "@fresnel/contracts/extensions";
import {
  AgentSettledEventPayloadSchema,
  AgentSpawnedPayloadSchema,
  LeaseAcquiredPayloadSchema,
  DriveCommandSettledPayloadSchema,
  LeaseReleasedPayloadSchema,
  LeaseRequestedPayloadSchema,
  LeaseUserInputPayloadSchema,
  ScopeChangedPayloadSchema,
  type DurableEventEnvelope,
  type ExtensionEventKind,
  type ExtRecordQuery,
  type ExtRecordRow,
  type ExtThreadSnapshot,
  type OpenLease,
  type PendingStartRequest,
  type PendingUserInput,
  type SqlTx,
  type StoredScopeState,
} from "@fresnel/contracts/records";
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
  if (found.value !== undefined) return storedStateOf(found.value);
  // 이 thread에 자기 상태 이벤트가 없으면 갈라져 나온 thread일 수 있다: 가지는 출처 thread의 이벤트까지 이어지므로
  // 사슬 전체에서 찾는다. `loadSnapshot`이 캐시에 싣는 판과 같은 값이어야 `expectStateRev`가 어긋나지 않는다(X.primitives.spec §4.6.1)
  const chain = branchEvents(tx, threadId, STATE_FILTER);
  if (!chain.ok) return chain;
  for (const event of chain.value.toReversed()) {
    const stored = storedStateOf(event);
    if (!stored.ok) return stored;
    if (stored.value.scopeId === scopeId) return stored;
  }
  return ok(undefined);
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

/** 열린 임대 하나를 읽는 중의 모양. `used`는 목록을 다 읽은 뒤 `usedSince`로 채운다 */
interface LeaseDraft {
  readonly leaseId: string;
  readonly lineageId: string;
  readonly scopeId: string;
  readonly leaseEpoch: number;
  readonly limits: OpenLease["limits"];
  readonly parent: string | null;
  readonly depth: number;
  readonly contentHash: string | null;
  readonly input: OpenLease["input"];
  /** 맡긴 마지막 프레임의 끝. 위 프레임이 반납되면 채우고, 새 맡기기 부여나 이 scope의 명령 정착이 오면 비운다 */
  handoffEnd: OpenLease["handoffEnd"];
  /** 프로필의 시작 주도로 부여됐다(`requestId`와 `parent`가 없다) */
  readonly profileStart: boolean;
  readonly acquiredSeq: number;
}

/**
 * `ext.loadThread`: 활성 가지 위 scope.changed, lease.*, 상태 이벤트로 계산한 스냅샷.
 * 열린 임대는 목록이다(오래된 것부터, 맨 위 프레임이 마지막). 스택 위 프레임의 사용량을 아래에 더하는 일은 엔진이 한다
 */
export function loadSnapshot(tx: SqlTx, threadId: ThreadId): Result<ExtThreadSnapshot, RowFault> {
  const scopeEvents = kindIn([
    "scope.changed",
    "lease.acquired",
    "lease.released",
    "lease.requested",
    "lease.user_input",
    "drive.command_settled",
  ]);
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
  const open: LeaseDraft[] = [];
  // 부여되지도 버려지지도 않은 시작 요청(requestId 순서 = 큐 순서)
  const pending = new Map<string, PendingStartRequest>();
  // 부여됐거나 버려진 요청 id. 같은 커밋에서는 기록 순서가 부여보다 뒤일 수 있어 순서와 무관하게 닫는다
  const closed = new Set<string>();
  // 가로챈 사용자 메시지 중 처리되지 않은 것(requestId 순서 = 받은 순서). 처리된 id는 순서와 무관하게 닫는다
  const heldInputs = new Map<string, PendingUserInput>();
  const settledInputs = new Set<string>();
  // 처리된 사용자 메시지가 있는 scope. 그 scope의 새 부여가 비운다
  const settledScopes = new Set<string>();

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
      const { scopeId, leaseId, lineageId, limits, parent, depth, contentHash, input, requestId } =
        payload.value;
      if (requestId !== undefined) {
        pending.delete(requestId);
        closed.add(requestId);
      }
      // 새 맡기기가 시작되면 맡긴 프레임의 앞선 끝은 이미 쓰인 것이다
      if (parent !== undefined) {
        const caller = open.find((lease) => lease.leaseId === parent);
        if (caller !== undefined) caller.handoffEnd = null;
      }
      settledScopes.delete(scopeId);
      const epoch = (leaseEpochs.get(scopeId) ?? 0) + 1;
      leaseEpochs.set(scopeId, epoch);
      // 옛 기록(선택 필드 없음)은 코어 위 첫 프레임(depth 0), 맡긴 프레임이 아님(parent null), 출처 없음(contentHash null)으로 읽는다
      open.push({
        leaseId,
        lineageId,
        scopeId,
        leaseEpoch: epoch,
        limits: {
          ...(limits.maxTurns === undefined ? {} : { maxTurns: limits.maxTurns }),
          ...(limits.maxSpawns === undefined ? {} : { maxSpawns: limits.maxSpawns }),
          ...(limits.maxTokens === undefined ? {} : { maxTokens: limits.maxTokens }),
        },
        parent: parent ?? null,
        depth: depth ?? 0,
        contentHash: contentHash ?? null,
        input: input ?? null,
        handoffEnd: null,
        profileStart: requestId === undefined && parent === undefined,
        acquiredSeq: event.seq,
      });
    } else if (event.kind === "lease.released") {
      const payload = parse(LeaseReleasedPayloadSchema, event.payload);
      if (!payload.ok) return err(rowInvalid("events.envelope lease.released payload"));
      // 맨 위가 아니어도 같은 leaseId의 임대만 뺀다(leaseId는 부여마다 새로 나온다). 사유 waiting도 그냥 반납이다
      const index = open.findIndex((lease) => lease.leaseId === payload.value.leaseId);
      const gone = index === -1 ? undefined : open[index];
      if (index !== -1) open.splice(index, 1);
      // 맡은 프레임이 내려가면 맡긴 프레임이 받을 값을 남긴다(done이면 결과, 그 밖의 사유는 끊김)
      if (gone?.parent !== null && gone?.parent !== undefined) {
        const caller = open.find((lease) => lease.leaseId === gone.parent);
        if (caller !== undefined) {
          caller.handoffEnd =
            payload.value.reason === "done"
              ? { status: "done", result: payload.value.result ?? null }
              : { status: "aborted", result: null };
        }
      }
    } else if (event.kind === "lease.requested") {
      const payload = parse(LeaseRequestedPayloadSchema, event.payload);
      if (!payload.ok) return err(rowInvalid("events.envelope lease.requested payload"));
      const request = payload.value;
      if (request.status === "dropped") {
        pending.delete(request.requestId);
        closed.add(request.requestId);
      } else if (!closed.has(request.requestId)) {
        pending.set(request.requestId, {
          requestId: request.requestId,
          scopeId: request.scopeId,
          trigger: request.trigger,
          parent: request.parent ?? null,
          input: request.input ?? null,
        });
      }
    } else if (event.kind === "lease.user_input") {
      const payload = parse(LeaseUserInputPayloadSchema, event.payload);
      if (!payload.ok) return err(rowInvalid("events.envelope lease.user_input payload"));
      const message = payload.value;
      if (message.status === "settled") {
        heldInputs.delete(message.requestId);
        settledInputs.add(message.requestId);
        settledScopes.add(message.scopeId);
      } else if (!settledInputs.has(message.requestId) && message.input !== undefined) {
        heldInputs.set(message.requestId, {
          requestId: message.requestId,
          scopeId: message.scopeId,
          input: message.input,
        });
      }
    } else if (event.kind === "drive.command_settled") {
      const payload = parse(DriveCommandSettledPayloadSchema, event.payload);
      if (!payload.ok) return err(rowInvalid("events.envelope drive.command_settled payload"));
      // 맡긴 프레임이 끝을 받은 뒤 명령을 정착시켰으면 그 끝은 이미 쓰인 것이다
      for (const lease of open) {
        if (lease.scopeId === payload.value.scopeId) lease.handoffEnd = null;
      }
    } else {
      const state = storedStateOf(event);
      if (!state.ok) return state;
      states.set(state.value.scopeId, state.value);
    }
  }

  const openLeases: OpenLease[] = [];
  for (const lease of open) {
    const used = usedSince(tx, threadId, lease);
    if (!used.ok) return used;
    openLeases.push({
      leaseId: lease.leaseId,
      lineageId: lease.lineageId,
      scopeId: lease.scopeId,
      leaseEpoch: lease.leaseEpoch,
      limits: lease.limits,
      used: used.value,
      parent: lease.parent,
      depth: lease.depth,
      contentHash: lease.contentHash,
      input: lease.input,
      handoffEnd: lease.handoffEnd,
      awaitsUser: lease.profileStart && !settledScopes.has(lease.scopeId),
    });
  }
  // 맡기기 요청은 맡긴 프레임이 아직 열려 있을 때만 되살린다
  const openIds = new Set(open.map((lease) => lease.leaseId));
  const pendingRequests = [...pending.values()].filter(
    (request) =>
      request.trigger !== "handoff" || (request.parent !== null && openIds.has(request.parent)),
  );
  return ok({
    enabled: [...enabled],
    disabled: [...disabled],
    scopeTransitions: Object.fromEntries(transitions),
    enabledAtSeq: Object.fromEntries(enabledAtSeq),
    states: [...states.values()],
    openLeases,
    pendingRequests,
    pendingUserInputs: [...heldInputs.values()],
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
