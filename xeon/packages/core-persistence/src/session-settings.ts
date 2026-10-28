// session 범위 설정 값(L1.persistence.spec §6.2, PS-14). 값은 `settings.changed{scope:"session"}` 이벤트에 남고,
// 활성 가지 위 이벤트를 seq 순으로 접어 읽는다: 분기·되감기·재개를 따라간다.
// 이벤트 순서로 쌓는 투영(p_settings)은 두지 않는다. 버려진 가지의 값을 담을 수 있어서다(§3.10 p_scopes와 같은 이유).
// 도구 호출마다 읽으므로 thread별 캐시를 두고 leaf가 앞으로만 나아갔을 때는 새 이벤트만 접는다.
import { Bug, err, ok, parse, type Logger, type Result } from "@xeon/contracts";
import type { EventId, IdFactory, JsonValue, ThreadId } from "@xeon/contracts/conversation";
import {
  commitKeyPart,
  SettingsChangedPayloadSchema,
  type CommitPlan,
  type SessionSettingsError,
  type SessionSettingsLayer,
  type SessionSettingsStore,
  type SqlTx,
  type StoreDb,
} from "@xeon/contracts/records";
import { sha256Hex } from "./hash.ts";
import { branchEvents, isOnBranch, kindIn, leafOf } from "./branch.ts";
import { envelopeOfRow } from "./events.ts";
import { columns, readResult, rowInvalid, type RowFault } from "./rows.ts";
import { PERSISTENCE_PRODUCER, type ProducerRegistry } from "./producers.ts";
import type { SessionWriter } from "./writer.ts";

export interface SessionSettingsDeps {
  readonly db: StoreDb;
  readonly writer: SessionWriter;
  readonly producers: ProducerRegistry;
  readonly ids: IdFactory;
  readonly logger: Logger | undefined;
}

interface Cached {
  readonly leaf: EventId;
  readonly leafSeq: number;
  readonly values: ReadonlyMap<string, unknown>;
}

const SETTINGS_KIND = "settings.changed";

function foldInto(
  values: Map<string, unknown>,
  event: { readonly payload: unknown },
): Result<void, RowFault> {
  const payload = parse(SettingsChangedPayloadSchema, event.payload);
  if (!payload.ok) return err(rowInvalid("events.envelope settings.changed payload"));
  if (payload.value.scope !== "session") return ok(undefined);
  if (payload.value.value === null) values.delete(payload.value.key);
  else values.set(payload.value.key, payload.value.value);
  return ok(undefined);
}

function seqOf(tx: SqlTx, eventId: EventId): Result<number, RowFault> {
  const row = tx.get("SELECT seq FROM events WHERE id = ?", [eventId]);
  if (row === undefined) return err(rowInvalid("events.id"));
  return columns(row, "events").int("seq");
}

export interface SessionSettingsHandle extends SessionSettingsStore {
  /** 삭제된 thread의 캐시를 버린다 */
  forget(threadId: ThreadId): void;
}

export function createSessionSettings(deps: SessionSettingsDeps): SessionSettingsHandle {
  const { db, writer, producers, ids, logger } = deps;
  const cache = new Map<ThreadId, Cached>();
  const handle = producers.internal(PERSISTENCE_PRODUCER);

  /** 현재 leaf 기준 값. 캐시가 맞으면 그대로, leaf가 앞으로 나아갔으면 새 이벤트만, 아니면 처음부터 */
  const compute = (tx: SqlTx, threadId: ThreadId): Result<Cached | undefined, RowFault> => {
    const found = leafOf(tx, threadId);
    if (!found.ok) return found;
    const leaf = found.value ?? null;
    if (leaf === null) return ok(undefined);
    const cached = cache.get(threadId);
    if (cached?.leaf === leaf) return ok(cached);
    const leafSeq = seqOf(tx, leaf);
    if (!leafSeq.ok) return leafSeq;
    const values = new Map<string, unknown>();
    if (cached !== undefined && isOnBranch(tx, leaf, { id: cached.leaf, seq: cached.leafSeq })) {
      for (const [key, value] of cached.values) values.set(key, value);
      const rows = tx.all(
        `SELECT id, seq, envelope FROM events WHERE thread_id = ? AND kind = ? AND seq > ? ORDER BY seq`,
        [threadId, SETTINGS_KIND, cached.leafSeq],
      );
      for (const row of rows) {
        const c = columns(row, "events");
        const id = c.string("id");
        if (!id.ok) return id;
        const seq = c.int("seq");
        if (!seq.ok) return seq;
        if (!isOnBranch(tx, leaf, { id: id.value, seq: seq.value })) continue;
        const envelope = envelopeOfRow(row);
        if (!envelope.ok) return envelope;
        const folded = foldInto(values, envelope.value);
        if (!folded.ok) return folded;
      }
    } else {
      const events = branchEvents(tx, threadId, kindIn([SETTINGS_KIND]));
      if (!events.ok) return events;
      for (const event of events.value) {
        const folded = foldInto(values, event);
        if (!folded.ok) return folded;
      }
    }
    const next: Cached = { leaf, leafSeq: leafSeq.value, values };
    cache.set(threadId, next);
    return ok(next);
  };

  const write = (
    threadId: ThreadId,
    key: string,
    value: JsonValue,
    requestKey: string,
  ): Result<void, SessionSettingsError> => {
    const committed = writer.commit({
      threadId,
      requestId: `settings:${commitKeyPart(requestKey, sha256Hex)}`,
      fingerprintSource: { key, scope: "session", value },
      build(): CommitPlan {
        return {
          kind: "append",
          drafts: [
            handle.draft({
              id: ids.next("evt"),
              kind: "settings.changed",
              threadId,
              turnId: null,
              stepId: null,
              causationId: null,
              correlationId: null,
              payload: { key, scope: "session", value },
            }),
          ],
          checkpoint: null,
        };
      },
    });
    if (!committed.ok) return committed;
    if (committed.value.status === "key_reused") {
      // 같은 키에 다른 값: 호출자가 키를 잘못 썼다. 아무 행도 쓰지 않았다
      logger?.warn("session.settings_key_reused", { threadId, key, requestKey });
      return err({ kind: "key_reused", requestKey });
    }
    if (committed.value.status === "rejected") {
      throw new Bug(`store.schema_invalid: settings commit was rejected (${committed.value.code})`);
    }
    return ok(undefined);
  };

  return {
    forget(threadId): void {
      cache.delete(threadId);
    },
    layer(threadId): SessionSettingsLayer {
      const computed = readResult(db, (tx) => compute(tx, threadId));
      if (!computed.ok) {
        // layer는 오류 통로가 없고 설정을 읽는 모든 소비자가 부른다(F 계약). 읽을 수 없으면 비어 있는 층으로 두고 남긴다
        logger?.error("session.settings_layer_unreadable", {
          threadId,
          reason: computed.error.kind,
        });
        return { scope: "session", values: new Map() };
      }
      if (computed.value === undefined) cache.delete(threadId);
      return { scope: "session", values: computed.value?.values ?? new Map() };
    },
    set: (threadId, key, value, requestKey) => write(threadId, key, value, requestKey),
    reset: (threadId, key, requestKey) => write(threadId, key, null, requestKey),
  };
}
