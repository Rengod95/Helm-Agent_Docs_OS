// 코어 투영기 core(L1.persistence.spec §4.5.1). 순수 함수만 둔다: 시계, 난수, 파일, 네트워크, 환경 변수를
// 쓰지 않고, node:fs와 bun을 import하지 않는다(EV-06). 시각이 필요하면 event.recordedAt을 쓴다.
import {
  assertNever,
  Bug,
  canonicalJson,
  parse,
  type ParseError,
  type Result,
} from "@xeon/contracts";
import {
  StepCompletedPayloadSchema,
  ThreadClosedPayloadSchema,
  ThreadStartedPayloadSchema,
  ThreadUpdatedPayloadSchema,
  TurnCompletedPayloadSchema,
  TurnStartedPayloadSchema,
} from "@xeon/contracts/conversation";
import {
  AgentSettledEventPayloadSchema,
  AgentSpawnedPayloadSchema,
  ApprovalRequestedPayloadSchema,
  ApprovalResolvedPayloadSchema,
  BLOB_PLACEHOLDER_PREFIX,
  BlobRefSchema,
  EffectExecSchema,
  EffectIntentSchema,
  EffectResultSchema,
  InputPlacedPayloadSchema,
  InputQueuedPayloadSchema,
  InputWithdrawnPayloadSchema,
  ItemRecordedPayloadSchema,
  LeafMovedPayloadSchema,
  StepCheckpointSchema,
  ThreadResumedPayloadSchema,
  type DurableEventEnvelope,
  type EventKind,
  type InputQueuedPayload,
  type ProjectionTx,
  type Projector,
} from "@xeon/contracts/records";

/** 투영 규칙 버전. 테이블 모양이나 규칙이 바뀌면 올린다(다음 열기 때 core만 다시 만든다) */
export const CORE_PROJECTOR_VERSION = 5;

export const CORE_PROJECTOR_TABLES: readonly string[] = [
  "p_threads",
  "p_items",
  "p_effects",
  "p_turns",
  "p_inputs",
  "step_checkpoints",
  "p_blob_refs",
  "p_approvals",
  "p_agents",
];

const CORE_PROJECTOR_DDL: readonly string[] = [
  `CREATE TABLE p_threads (
  thread_id          TEXT PRIMARY KEY,
  title              TEXT,
  status             TEXT NOT NULL CHECK (status IN ('idle', 'running', 'closed')),
  workspace          TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  first_seq          INTEGER NOT NULL,
  head_seq           INTEGER NOT NULL,
  leaf_event_id      TEXT,
  forked_from_thread TEXT,
  forked_from_event  TEXT,
  closed_reason      TEXT,
  open_turn_id       TEXT,
  running_since      INTEGER,
  resume_attempts    INTEGER NOT NULL DEFAULT 0
) STRICT`,
  `CREATE TABLE p_items (
  item_id         TEXT PRIMARY KEY,
  thread_id       TEXT NOT NULL,
  event_id        TEXT NOT NULL,
  parent_event_id TEXT,
  seq             INTEGER NOT NULL,
  turn_id         TEXT,
  step_id         TEXT,
  kind            TEXT NOT NULL,
  status          TEXT NOT NULL,
  stop_reason     TEXT,
  effect_id       TEXT
) STRICT`,
  "CREATE INDEX p_items_thread_seq ON p_items (thread_id, seq)",
  `CREATE TABLE p_effects (
  effect_id      TEXT PRIMARY KEY,
  thread_id      TEXT NOT NULL,
  tool_call_id   TEXT NOT NULL,
  item_id        TEXT NOT NULL,
  tool_name      TEXT NOT NULL,
  replay         TEXT NOT NULL CHECK (replay IN ('safe', 'unsafe')),
  intent_seq     INTEGER NOT NULL,
  exec_count     INTEGER NOT NULL DEFAULT 0,
  last_exec_seq  INTEGER,
  result_seq     INTEGER,
  result_status  TEXT,
  synthesized    INTEGER NOT NULL DEFAULT 0
) STRICT`,
  "CREATE UNIQUE INDEX p_effects_call ON p_effects (thread_id, tool_call_id)",
  "CREATE INDEX p_effects_open ON p_effects (thread_id, intent_seq) WHERE result_seq IS NULL",
  `CREATE TABLE p_turns (
  turn_id             TEXT PRIMARY KEY,
  thread_id           TEXT NOT NULL,
  status              TEXT NOT NULL,
  started_seq         INTEGER NOT NULL,
  started_at          INTEGER NOT NULL,
  completed_seq       INTEGER,
  abort_requested_seq INTEGER,
  step_count          INTEGER NOT NULL DEFAULT 0,
  request_id          TEXT,
  scope_id            TEXT
) STRICT`,
  // scope_id가 NULL인 turn과 섞이지 않게 NULL을 빈 문자열로 접는다(scope id는 1자 이상이다)
  `CREATE UNIQUE INDEX p_turns_request ON p_turns (thread_id, COALESCE(scope_id, ''), request_id)
  WHERE request_id IS NOT NULL`,
  "CREATE INDEX p_turns_thread ON p_turns (thread_id, started_seq)",
  `CREATE TABLE p_inputs (
  input_id        TEXT PRIMARY KEY,
  thread_id       TEXT NOT NULL,
  seq             INTEGER NOT NULL,
  mode            TEXT NOT NULL,
  state           TEXT NOT NULL CHECK (state IN ('queued', 'placed', 'withdrawn')),
  source_key      TEXT NOT NULL,
  request_id      TEXT NOT NULL,
  placed_item_id  TEXT,
  placed_turn_id  TEXT
) STRICT`,
  "CREATE UNIQUE INDEX p_inputs_request ON p_inputs (thread_id, source_key, request_id)",
  "CREATE INDEX p_inputs_state ON p_inputs (thread_id, state, seq)",
  // 승인 요청과 응답(L1.tools.spec §4.7). 응답 커밋의 build가 view.approval로 요청이 있고 미해결인지 본다
  `CREATE TABLE p_approvals (
  approval_id      TEXT PRIMARY KEY,
  thread_id        TEXT NOT NULL,
  origin_thread_id TEXT NOT NULL,
  tool_call_id     TEXT,
  body_kind        TEXT NOT NULL,
  requested_seq    INTEGER NOT NULL,
  resolved_seq     INTEGER,
  decision         TEXT
) STRICT`,
  "CREATE INDEX p_approvals_open ON p_approvals (thread_id, requested_seq) WHERE resolved_seq IS NULL",
  // 부모 대화의 자식 thread 연결(L1.agents.spec §3.5). thread_id는 부모, 같은 (부모, 자식 requestId)는 하나다
  `CREATE TABLE p_agents (
  child_thread_id   TEXT PRIMARY KEY,
  thread_id         TEXT NOT NULL,
  request_id        TEXT NOT NULL,
  agent             TEXT NOT NULL,
  owner_kind        TEXT NOT NULL,
  owner_turn_id     TEXT,
  owner_tool_call_id TEXT,
  background        INTEGER NOT NULL,
  depth             INTEGER NOT NULL,
  spawned_seq       INTEGER NOT NULL,
  settled_seq       INTEGER,
  settled_status    TEXT,
  settled_event_id  TEXT
) STRICT`,
  "CREATE UNIQUE INDEX p_agents_request ON p_agents (thread_id, request_id)",
  "CREATE INDEX p_agents_open ON p_agents (thread_id, owner_turn_id) WHERE settled_seq IS NULL",
  // thread가 참조하는 blob 해시(GC 뿌리). detached 필드와 effect.*의 BlobRef가 채운다
  `CREATE TABLE p_blob_refs (
  thread_id      TEXT NOT NULL,
  sha256         TEXT NOT NULL,
  first_seq      INTEGER NOT NULL,
  PRIMARY KEY (thread_id, sha256)
) STRICT`,
  `CREATE TABLE step_checkpoints (
  thread_id      TEXT PRIMARY KEY,
  checkpoint_id  TEXT NOT NULL,
  seq            INTEGER NOT NULL,
  turn_id        TEXT NOT NULL,
  step_index     INTEGER NOT NULL,
  next           TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  record         TEXT NOT NULL
) STRICT`,
];

type Reducer = (tx: ProjectionTx, event: DurableEventEnvelope) => void;

/** 이벤트 payload를 카탈로그 스키마로 다시 좁힌다. 커밋 경로가 이미 검사했으므로 실패하면 코드 결함이다 */
function expectPayload<T>(result: Result<T, ParseError>, event: DurableEventEnvelope): T {
  if (!result.ok) {
    // xeon-disable-next-line xeon/bug-for-expected -- 커밋 경로가 같은 payload를 이미 검증했다. 투영기가 다시 실패하면 코드 결함이다 (eng.typescript.guide TY-24)
    throw new Bug(`store.projection_failed: invalid ${event.kind} payload at seq ${event.seq}`, {
      cause: result.error,
    });
  }
  return result.value;
}

function turnIdOf(event: DurableEventEnvelope): string {
  if (event.turnId === null) {
    throw new Bug(`store.projection_failed: ${event.kind} needs a turnId (seq ${event.seq})`);
  }
  return event.turnId;
}

/** 입력 출처 키(eng.transactions.design §4.8): 사용자 user, 확장 scopeId('/'는 ':'), 위임 deleg, 예약 timer */
function sourceKeyOf(source: InputQueuedPayload["source"]): string {
  switch (source.type) {
    case "user":
      return "user";
    case "extension":
      return source.scopeId.replaceAll("/", ":");
    case "delegation":
      return "deleg";
    case "schedule":
      return "timer";
    default:
      return assertNever(source, "core projector input source");
  }
}

function reduceThreadStarted(tx: ProjectionTx, event: DurableEventEnvelope): void {
  const payload = expectPayload(parse(ThreadStartedPayloadSchema, event.payload), event);
  tx.run(
    `INSERT INTO p_threads (thread_id, title, status, workspace, created_at, updated_at, first_seq, head_seq,
       leaf_event_id, forked_from_thread, forked_from_event, closed_reason, open_turn_id, running_since, resume_attempts)
     VALUES (?, ?, 'idle', ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0)`,
    [
      event.threadId,
      payload.title,
      payload.workspace ?? null,
      event.recordedAt,
      event.recordedAt,
      event.seq,
      event.seq,
      event.id,
      payload.forkedFrom?.threadId ?? null,
      payload.forkedFrom?.eventId ?? null,
    ],
  );
}

/** 모든 내구 이벤트가 thread의 head, 갱신 시각, leaf를 올린다. thread.leaf_moved는 아래 리듀서가 leaf를 덮어쓴다 */
function touchThread(tx: ProjectionTx, event: DurableEventEnvelope): void {
  tx.run(
    "UPDATE p_threads SET head_seq = ?, updated_at = ?, leaf_event_id = ? WHERE thread_id = ?",
    [event.seq, event.recordedAt, event.id, event.threadId],
  );
}

const REDUCERS: ReadonlyMap<EventKind, Reducer> = new Map<EventKind, Reducer>([
  [
    "thread.updated",
    (tx, event): void => {
      const payload = expectPayload(parse(ThreadUpdatedPayloadSchema, event.payload), event);
      if (payload.title !== undefined) {
        tx.run("UPDATE p_threads SET title = ? WHERE thread_id = ?", [
          payload.title,
          event.threadId,
        ]);
      }
      if (payload.status !== undefined) {
        tx.run("UPDATE p_threads SET status = ? WHERE thread_id = ?", [
          payload.status,
          event.threadId,
        ]);
      }
      if (payload.leafEventId !== undefined) {
        tx.run("UPDATE p_threads SET leaf_event_id = ? WHERE thread_id = ?", [
          payload.leafEventId,
          event.threadId,
        ]);
      }
    },
  ],
  [
    "thread.closed",
    (tx, event): void => {
      const payload = expectPayload(parse(ThreadClosedPayloadSchema, event.payload), event);
      tx.run("UPDATE p_threads SET status = 'closed', closed_reason = ? WHERE thread_id = ?", [
        payload.reason,
        event.threadId,
      ]);
    },
  ],
  [
    "thread.leaf_moved",
    (tx, event): void => {
      const payload = expectPayload(parse(LeafMovedPayloadSchema, event.payload), event);
      tx.run("UPDATE p_threads SET leaf_event_id = ? WHERE thread_id = ?", [
        payload.leafEventId,
        event.threadId,
      ]);
    },
  ],
  [
    "thread.resumed",
    (tx, event): void => {
      const payload = expectPayload(parse(ThreadResumedPayloadSchema, event.payload), event);
      // 복구 표식의 시도 수는 열린 turn의 thread.resumed에서만 센다
      tx.run("UPDATE p_threads SET resume_attempts = ? WHERE thread_id = ? AND open_turn_id = ?", [
        payload.attempt,
        event.threadId,
        payload.turnId,
      ]);
    },
  ],
  [
    "turn.started",
    (tx, event): void => {
      const payload = expectPayload(parse(TurnStartedPayloadSchema, event.payload), event);
      const turnId = turnIdOf(event);
      tx.run(
        `INSERT INTO p_turns (turn_id, thread_id, status, started_seq, started_at, completed_seq,
           abort_requested_seq, step_count, request_id, scope_id)
         VALUES (?, ?, 'running', ?, ?, NULL, NULL, 0, ?, ?)`,
        [turnId, event.threadId, event.seq, event.recordedAt, payload.requestId, payload.scopeId],
      );
      // 복구 표식: 열린 turn과 시작 시각. 새 turn은 재개 시도 수를 0에서 센다
      tx.run(
        `UPDATE p_threads SET status = 'running', open_turn_id = ?, running_since = ?, resume_attempts = 0
         WHERE thread_id = ?`,
        [turnId, event.recordedAt, event.threadId],
      );
    },
  ],
  [
    "turn.completed",
    (tx, event): void => {
      const payload = expectPayload(parse(TurnCompletedPayloadSchema, event.payload), event);
      const turnId = turnIdOf(event);
      tx.run("UPDATE p_turns SET status = ?, completed_seq = ? WHERE turn_id = ?", [
        payload.status,
        event.seq,
        turnId,
      ]);
      tx.run(
        `UPDATE p_threads SET status = CASE WHEN status = 'closed' THEN status ELSE 'idle' END,
           open_turn_id = NULL, running_since = NULL, resume_attempts = 0
         WHERE thread_id = ? AND open_turn_id = ?`,
        [event.threadId, turnId],
      );
    },
  ],
  [
    "turn.abort_requested",
    (tx, event): void => {
      tx.run(
        "UPDATE p_turns SET abort_requested_seq = ? WHERE turn_id = ? AND abort_requested_seq IS NULL",
        [event.seq, turnIdOf(event)],
      );
    },
  ],
  [
    "step.completed",
    (tx, event): void => {
      expectPayload(parse(StepCompletedPayloadSchema, event.payload), event);
      tx.run("UPDATE p_turns SET step_count = step_count + 1 WHERE turn_id = ?", [turnIdOf(event)]);
    },
  ],
  [
    "item.recorded",
    (tx, event): void => {
      const { item } = expectPayload(parse(ItemRecordedPayloadSchema, event.payload), event);
      const stopReason = item.kind === "assistant" ? item.message.stopReason : null;
      const effectId = item.kind === "toolResult" ? item.effectId : null;
      tx.run(
        `INSERT INTO p_items (item_id, thread_id, event_id, parent_event_id, seq, turn_id, step_id, kind,
           status, stop_reason, effect_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.itemId,
          event.threadId,
          event.id,
          event.parentId,
          event.seq,
          event.turnId,
          event.stepId,
          item.kind,
          item.status,
          stopReason,
          effectId,
        ],
      );
    },
  ],
  [
    "effect.intent",
    (tx, event): void => {
      const intent = expectPayload(parse(EffectIntentSchema, event.payload), event);
      tx.run(
        `INSERT INTO p_effects (effect_id, thread_id, tool_call_id, item_id, tool_name, replay, intent_seq,
           exec_count, last_exec_seq, result_seq, result_status, synthesized)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, 0)`,
        [
          intent.effectId,
          event.threadId,
          intent.toolCallId,
          intent.itemId,
          intent.toolName,
          intent.replay,
          event.seq,
        ],
      );
    },
  ],
  [
    "effect.exec",
    (tx, event): void => {
      const exec = expectPayload(parse(EffectExecSchema, event.payload), event);
      tx.run(
        "UPDATE p_effects SET exec_count = exec_count + 1, last_exec_seq = ? WHERE effect_id = ?",
        [event.seq, exec.effectId],
      );
    },
  ],
  [
    "effect.result",
    (tx, event): void => {
      const result = expectPayload(parse(EffectResultSchema, event.payload), event);
      tx.run(
        "UPDATE p_effects SET result_seq = ?, result_status = ?, synthesized = ? WHERE effect_id = ?",
        [event.seq, result.status, result.synthesized ? 1 : 0, result.effectId],
      );
    },
  ],
  [
    "input.queued",
    (tx, event): void => {
      const payload = expectPayload(parse(InputQueuedPayloadSchema, event.payload), event);
      tx.run(
        `INSERT INTO p_inputs (input_id, thread_id, seq, mode, state, source_key, request_id, placed_item_id,
           placed_turn_id)
         VALUES (?, ?, ?, ?, 'queued', ?, ?, NULL, NULL)`,
        [
          event.id,
          event.threadId,
          event.seq,
          payload.mode,
          sourceKeyOf(payload.source),
          payload.requestId,
        ],
      );
    },
  ],
  [
    "input.placed",
    (tx, event): void => {
      const payload = expectPayload(parse(InputPlacedPayloadSchema, event.payload), event);
      tx.run(
        "UPDATE p_inputs SET state = 'placed', placed_item_id = ?, placed_turn_id = ? WHERE input_id = ?",
        [payload.itemId, event.turnId, payload.inputId],
      );
    },
  ],
  [
    "input.withdrawn",
    (tx, event): void => {
      const payload = expectPayload(parse(InputWithdrawnPayloadSchema, event.payload), event);
      tx.run("UPDATE p_inputs SET state = 'withdrawn' WHERE input_id = ?", [payload.inputId]);
    },
  ],
  [
    "approval.requested",
    (tx, event): void => {
      const payload = expectPayload(parse(ApprovalRequestedPayloadSchema, event.payload), event);
      tx.run(
        `INSERT INTO p_approvals (approval_id, thread_id, origin_thread_id, tool_call_id, body_kind,
           requested_seq, resolved_seq, decision)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
        [
          event.id,
          event.threadId,
          payload.origin.threadId,
          payload.origin.toolCallId,
          payload.body.kind,
          event.seq,
        ],
      );
    },
  ],
  [
    "approval.resolved",
    (tx, event): void => {
      const payload = expectPayload(parse(ApprovalResolvedPayloadSchema, event.payload), event);
      tx.run(
        "UPDATE p_approvals SET resolved_seq = ?, decision = ? WHERE approval_id = ? AND resolved_seq IS NULL",
        [event.seq, payload.decision, payload.approvalId],
      );
    },
  ],
  [
    "agent.spawned",
    (tx, event): void => {
      const payload = expectPayload(parse(AgentSpawnedPayloadSchema, event.payload), event);
      const { owner } = payload;
      tx.run(
        `INSERT INTO p_agents (child_thread_id, thread_id, request_id, agent, owner_kind, owner_turn_id,
           owner_tool_call_id, background, depth, spawned_seq, settled_seq, settled_status, settled_event_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
        [
          payload.childThreadId,
          event.threadId,
          payload.requestId,
          payload.agent,
          owner.kind,
          owner.kind === "scope" ? null : owner.turnId,
          owner.kind === "tool" ? owner.toolCallId : null,
          payload.background ? 1 : 0,
          payload.depth,
          event.seq,
        ],
      );
    },
  ],
  [
    "agent.settled",
    (tx, event): void => {
      const payload = expectPayload(parse(AgentSettledEventPayloadSchema, event.payload), event);
      tx.run(
        `UPDATE p_agents SET settled_seq = ?, settled_status = ?, settled_event_id = ?
         WHERE child_thread_id = ? AND settled_seq IS NULL`,
        [event.seq, payload.status, event.id, payload.childThreadId],
      );
    },
  ],
  [
    "checkpoint.step",
    (tx, event): void => {
      const checkpoint = expectPayload(parse(StepCheckpointSchema, event.payload), event);
      tx.run(
        `INSERT OR REPLACE INTO step_checkpoints (thread_id, checkpoint_id, seq, turn_id, step_index, next,
           schema_version, record)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.threadId,
          checkpoint.checkpointId,
          event.seq,
          checkpoint.turnId,
          checkpoint.stepIndex,
          checkpoint.next,
          checkpoint.schemaVersion,
          canonicalJson(checkpoint),
        ],
      );
    },
  ],
]);

const PLACEHOLDER_PATTERN = new RegExp(`${BLOB_PLACEHOLDER_PREFIX}([0-9a-f]{64})(?![0-9a-f])`, "g");

/** payload 안 모든 문자열에서 `blob:sha256:<hex>` 자리표시의 해시를 모은다(L0.store.spec §10 S-15). 키 이름은 보지 않는다 */
function placeholderHashesIn(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(PLACEHOLDER_PATTERN)) {
      const hash = match[1];
      if (hash !== undefined) into.push(hash);
    }
  } else if (Array.isArray(value)) {
    for (const entry of value) placeholderHashesIn(entry, into);
  } else if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) placeholderHashesIn(entry, into);
  }
}

/**
 * 이 이벤트가 참조하는 blob 해시: `detached`의 BlobRef, effect.intent.args, effect.result.blobRef,
 * 그리고 payload 문자열의 `blob:sha256:<hex>` 자리표시(cap-mcp 내용, cap-dialog 이미지 첨부, cap-workspace 이미지)
 */
function blobHashesOf(event: DurableEventEnvelope): readonly string[] {
  const hashes = (event.detached ?? []).map((field) => field.ref.sha256);
  placeholderHashesIn(event.payload, hashes);
  if (event.kind === "effect.intent") {
    const intent = parse(EffectIntentSchema, event.payload);
    const ref = intent.ok ? parse(BlobRefSchema, intent.value.args) : undefined;
    if (ref?.ok === true) hashes.push(ref.value.sha256);
  } else if (event.kind === "effect.result") {
    const result = parse(EffectResultSchema, event.payload);
    if (result.ok && result.value.blobRef !== null) hashes.push(result.value.blobRef.sha256);
  }
  return hashes;
}

function recordBlobRefs(tx: ProjectionTx, event: DurableEventEnvelope): void {
  for (const sha256 of new Set(blobHashesOf(event))) {
    tx.run("INSERT OR IGNORE INTO p_blob_refs (thread_id, sha256, first_seq) VALUES (?, ?, ?)", [
      event.threadId,
      sha256,
      event.seq,
    ]);
  }
}

/** 코어 투영기. 관심 kind는 "all"이다: 모든 내구 이벤트가 thread의 head·leaf·updated_at을 올린다 */
export function createCoreProjector(): Projector {
  return {
    name: "core",
    version: CORE_PROJECTOR_VERSION,
    tables: CORE_PROJECTOR_TABLES,
    ddl: CORE_PROJECTOR_DDL,
    kinds: "all",
    apply(tx: ProjectionTx, event: DurableEventEnvelope): void {
      if (event.kind === "thread.started") {
        reduceThreadStarted(tx, event);
        return;
      }
      touchThread(tx, event);
      REDUCERS.get(event.kind)?.(tx, event);
      recordBlobRefs(tx, event);
    },
  };
}
