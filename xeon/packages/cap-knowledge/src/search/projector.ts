import { Bug, parse } from "@xeon/contracts";
import {
  ThreadStartedPayloadSchema,
  ThreadUpdatedPayloadSchema,
} from "@xeon/contracts/conversation";
import {
  AgentSpawnedPayloadSchema,
  ItemRecordedPayloadSchema,
  type DurableEventEnvelope,
  type ProjectionTx,
  type Projector,
} from "@xeon/contracts/records";
import type { Static, TSchema } from "typebox";
import { sha256Hex } from "../hash.ts";
import {
  KNOWLEDGE_DDL_BASE,
  KNOWLEDGE_DDL_FTS,
  KNOWLEDGE_PROJECTOR_NAME,
  KNOWLEDGE_PROJECTOR_VERSION,
  KNOWLEDGE_PROJECTOR_VERSION_NO_FTS,
  KNOWLEDGE_TABLES_BASE,
  KNOWLEDGE_TABLES_FTS,
} from "./ddl.ts";

// L2.knowledge.spec §3.8 투영기 `cap.knowledge`: 세션 목록(`cap_knowledge_sessions`). 이벤트의 순수 함수다(EV-06): 시계, 난수, 파일을
// 쓰지 않고 소유 테이블만 갱신한다. 세션 본문 색인(`sessiondocs`, `sessionfts`)은 소비자가 쓴다(`search/indexer.ts`).
//
// 세션 종류는 이벤트에서 이렇게 읽는다 [가정: payload에 세션 종류 필드가 없다]: `agent.spawned`가 가리키는 자식 thread는
// `background: true`면 background, 아니면 subagent이고, 나머지는 main이다. cron은 M3 `cap-schedule`부터 생긴다.

function payloadOf<S extends TSchema>(schema: S, event: DurableEventEnvelope): Static<S> {
  const parsed = parse(schema, event.payload);
  return parsed.ok ? parsed.value : failProjection(event.kind, parsed.error);
}

/** 이벤트 payload는 커밋 때 카탈로그 스키마로 검증됐으므로 모양이 다르면 코드 결함이다 */
function failProjection(kind: string, cause: unknown): never {
  throw new Bug(
    `store.projection_failed: cap.knowledge ${kind} payload does not match its catalog schema`,
    { cause },
  );
}

function applyStarted(tx: ProjectionTx, event: DurableEventEnvelope): void {
  const started = payloadOf(ThreadStartedPayloadSchema, event);
  const project =
    started.workspace === undefined || started.workspace === null
      ? null
      : sha256Hex(started.workspace).slice(0, 16);
  // 자식 thread는 부모의 agent.spawned가 먼저 kind를 정해 둘 수 있다. kind는 건드리지 않는다
  tx.run(
    `INSERT INTO cap_knowledge_sessions (thread_id, kind, project, title, created_at, last_at, messages)
     VALUES (?, 'main', ?, ?, ?, ?, 0)
     ON CONFLICT (thread_id) DO UPDATE SET
       project = excluded.project, title = excluded.title, created_at = excluded.created_at,
       last_at = MAX(cap_knowledge_sessions.last_at, excluded.last_at)`,
    [event.threadId, project, started.title, event.recordedAt, event.recordedAt],
  );
}

function applyUpdated(tx: ProjectionTx, event: DurableEventEnvelope): void {
  const updated = payloadOf(ThreadUpdatedPayloadSchema, event);
  if (updated.title === undefined) return;
  tx.run("UPDATE cap_knowledge_sessions SET title = ? WHERE thread_id = ?", [
    updated.title,
    event.threadId,
  ]);
}

function applySpawned(tx: ProjectionTx, event: DurableEventEnvelope): void {
  const spawned = payloadOf(AgentSpawnedPayloadSchema, event);
  const kind = spawned.background ? "background" : "subagent";
  tx.run(
    `INSERT INTO cap_knowledge_sessions (thread_id, kind, project, title, created_at, last_at, messages)
     VALUES (?, ?, NULL, NULL, ?, ?, 0)
     ON CONFLICT (thread_id) DO UPDATE SET kind = excluded.kind`,
    [spawned.childThreadId, kind, event.recordedAt, event.recordedAt],
  );
}

function applyItem(tx: ProjectionTx, event: DurableEventEnvelope): void {
  const recorded = payloadOf(ItemRecordedPayloadSchema, event);
  if (recorded.item.kind !== "user" && recorded.item.kind !== "assistant") return;
  tx.run(
    "UPDATE cap_knowledge_sessions SET messages = messages + 1, last_at = MAX(last_at, ?) WHERE thread_id = ?",
    [event.recordedAt, event.threadId],
  );
}

/** FTS를 쓸 수 있으면 색인 표까지, 아니면 세션 목록만 선언한다 */
export function createKnowledgeProjector(options: { readonly fts: boolean }): Projector {
  return {
    name: KNOWLEDGE_PROJECTOR_NAME,
    version: options.fts ? KNOWLEDGE_PROJECTOR_VERSION : KNOWLEDGE_PROJECTOR_VERSION_NO_FTS,
    tables: options.fts ? KNOWLEDGE_TABLES_FTS : KNOWLEDGE_TABLES_BASE,
    ddl: options.fts ? KNOWLEDGE_DDL_FTS : KNOWLEDGE_DDL_BASE,
    kinds: ["thread.started", "thread.updated", "agent.spawned", "item.recorded"],
    apply(tx, event) {
      // 관심 kind 넷만 등록부가 넘긴다. 다른 kind는 오지 않는다
      if (event.kind === "thread.started") applyStarted(tx, event);
      else if (event.kind === "thread.updated") applyUpdated(tx, event);
      else if (event.kind === "agent.spawned") applySpawned(tx, event);
      else if (event.kind === "item.recorded") applyItem(tx, event);
    },
  };
}
