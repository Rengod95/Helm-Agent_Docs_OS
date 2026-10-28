import { assertNever, Bug, err, ok, parse, type Result } from "@xeon/contracts";
import { toJsonValue, type JsonValue, type ThreadId } from "@xeon/contracts/conversation";
import {
  RECORD_KIND_PATTERN,
  RecordCommitPortKey,
  type ExtCommitRejectCode,
  type ExtRecordRow,
  type GroupRecord,
  type RecordKind,
  type RecordCommitPort,
  type RecordKindDecl,
  type RecordQuery,
  type RecordSubject,
  type ScopeId,
  validateGroupRecord,
} from "@xeon/contracts/extensions";
import {
  ENVELOPE_MAX_BYTES,
  type DurableEventDraft,
  type ExtensionEventKind,
} from "@xeon/contracts/records";
import { ambient, type Ambient } from "./ambient.ts";
import type { Generation, HostCore, ScopeRecord, StateCacheEntry, ThreadRuntime } from "./core.ts";
import { makeDraft } from "./drafts.ts";
import { PrimitiveError } from "./errors.ts";
import { deepFreeze } from "./freeze.ts";
import { hash12, keyPart } from "./keys.ts";
import { isKindReadable, ownKindPrefix } from "./read-scope.ts";

const STATE_SLACK_BYTES = 4096;
const RECORD_KIND_REGEX = new RegExp(RECORD_KIND_PATTERN);

/** `commitWith`·`updateState`가 상태와 함께 커밋하는 그룹 레코드 하나 */
export interface RecordInput {
  readonly kind: RecordKind;
  readonly subject: RecordSubject;
  readonly payload: JsonValue;
}

/** `updateState`가 값으로 돌려주는 실패. 던지지 않는다 */
export interface StateUpdateError {
  readonly kind:
    | "state_conflict"
    | "state_schema"
    | "state_too_large"
    | "storage_unavailable"
    | "lease_revoked";
  readonly cause?: unknown;
}

const UPDATE_FAILURES: readonly StateUpdateError["kind"][] = [
  "state_conflict",
  "state_schema",
  "state_too_large",
  "storage_unavailable",
  "lease_revoked",
];

function isUpdateFailure(code: string): code is StateUpdateError["kind"] {
  return UPDATE_FAILURES.some((kind) => kind === code);
}

export interface StateService {
  /** 핸들러 ctx.state용 마지막 커밋 상태. 상태 선언이 없으면 undefined */
  docOf(threadId: ThreadId, scopeId: ScopeId): unknown;
  /** (thread, scope)의 활성 가지 위 상태 판 */
  revOf(threadId: ThreadId, scopeId: ScopeId): number;
  state(record: ScopeRecord, generation: Generation): unknown;
  commit(record: ScopeRecord, generation: Generation, next: unknown): Promise<unknown>;
  /** 상태 커밋과 그룹 레코드를 한 트랜잭션으로 낸다(M3-REQ-24 [제안]) */
  commitWith(
    record: ScopeRecord,
    generation: Generation,
    next: unknown,
    records: readonly RecordInput[],
  ): Promise<unknown>;
  /**
   * 줄 세운 읽기-계산-커밋(M3-REQ-23 [제안]). 줄 안에서 최신 상태를 읽어 fn을 적용하므로 같은 프로세스 안의 겹침으로는 충돌하지 않는다.
   * 저장소가 판 충돌을 내면 상태를 다시 읽고 한 번 더 적용하며, 두 번째도 충돌이면 err(state_conflict)다
   */
  update(
    record: ScopeRecord,
    generation: Generation,
    fn: (prev: unknown) => unknown,
    records: (next: unknown) => readonly RecordInput[],
  ): Promise<Result<unknown, StateUpdateError>>;
  record(
    record: ScopeRecord,
    generation: Generation,
    kind: RecordKind,
    subject: RecordSubject,
    payload: JsonValue,
  ): Promise<void>;
  recordPrivate(
    record: ScopeRecord,
    generation: Generation,
    kind: RecordKind,
    payload: JsonValue,
  ): Promise<void>;
  readRecords(
    record: ScopeRecord,
    generation: Generation,
    query: RecordQuery,
  ): Promise<readonly GroupRecord[]>;
  /**
   * 한 thread에서 켜기 전에 저장된 상태 문서를 준비한다(X.primitives.spec §4.5.3 4번, §4.6.1 3번). 저장된 판이 없으면 할 일이 없다.
   * 버전이 낮으면 setup이 등록한 마이그레이션 훅으로 옮겨 새 판으로 커밋한다. 훅이 없거나 결과가 스키마를 어기면,
   * 저장된 버전이 선언보다 높으면 오류를 돌려준다
   */
  prepareStored(
    record: ScopeRecord,
    generation: Generation,
    thread: ThreadRuntime,
  ): Promise<PrimitiveError | undefined>;
}

/** scope 상태 커밋의 이벤트 kind: <x|grp>.<이름>.state.committed (X.primitives.spec §4.6.1) */
function stateKindOf(manifest: {
  readonly kind: string;
  readonly name: string;
}): ExtensionEventKind {
  return `${manifest.kind === "group" ? "grp" : "x"}.${manifest.name}.state.committed`;
}

function assertGeneration(record: ScopeRecord, generation: Generation): void {
  if (generation.closed) {
    throw new PrimitiveError("scope_inactive", `scope ${record.id} generation is closed`, {
      scopeId: record.id,
    });
  }
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function cacheOf(record: ScopeRecord, thread: ThreadRuntime): StateCacheEntry {
  const stored = thread.states.get(record.id);
  if (stored !== undefined) return stored;
  const decl = record.def.state;
  return { eventId: null, rev: 0, version: decl?.version ?? 1, doc: decl?.initial };
}

/** on 핸들러 안은 디스패치 키 기준, drive 안은 임대·호출 기준의 멱등 키 재료를 만든다 */
function nextIdentity(
  record: ScopeRecord,
  amb: Ambient,
  letter: "" | "c" | "r",
): { readonly rid: string; readonly fingerprint: JsonValue } {
  if (amb.drive !== null) {
    const n = amb.drive.i;
    amb.drive.i += 1;
    return {
      rid: `${amb.drive.leaseId}:${amb.drive.baseRev}.${letter}${n}`,
      fingerprint: {
        scopeId: record.id,
        leaseId: amb.drive.leaseId,
        baseRev: amb.drive.baseRev,
        n,
      },
    };
  }
  const n = amb.counter;
  amb.counter += 1;
  const dispatchKey = amb.dispatchKey ?? "";
  const prefix = letter === "r" ? "rec" : "st";
  return {
    rid: `${prefix}:${hash12(record.id)}:${keyPart(dispatchKey)}:${n}`,
    fingerprint: { scopeId: record.id, dispatchKey, n },
  };
}

function noteEffect(amb: Ambient): void {
  if (amb.drive !== null) amb.drive.effects += 1;
}

function queueKey(thread: ThreadRuntime, record: ScopeRecord): string {
  return `${thread.threadId}|${record.id}`;
}

export function createStateService(core: HostCore): StateService {
  function threadOf(amb: Ambient | undefined, record: ScopeRecord): ThreadRuntime {
    if (amb === undefined) {
      throw new PrimitiveError("no_thread", "no thread context (setup body or detached callback)", {
        scopeId: record.id,
      });
    }
    const thread = core.threads.get(amb.threadId);
    if (thread === undefined) {
      throw new PrimitiveError("no_thread", `thread ${amb.threadId} is not open`, {
        scopeId: record.id,
      });
    }
    return thread;
  }

  function portOf(record: ScopeRecord): RecordCommitPort {
    const port = core.ports.get(RecordCommitPortKey);
    if (port === undefined) {
      throw new PrimitiveError(
        "port_unavailable",
        "xeon.session (RecordCommitPort) is not provided",
        {
          scopeId: record.id,
        },
      );
    }
    return port;
  }

  /** 낮은 버전의 저장 상태를 훅으로 옮기고 새 판으로 커밋한다. 같은 판을 다시 옮기면 같은 키라 replayed다 */
  async function migrateStored(
    record: ScopeRecord,
    generation: Generation,
    thread: ThreadRuntime,
    stored: StateCacheEntry,
    decl: NonNullable<ScopeRecord["def"]["state"]>,
  ): Promise<PrimitiveError | undefined> {
    const migrate = generation.migration;
    if (migrate === null) {
      return new PrimitiveError(
        "state_migration_missing",
        `stored state of ${record.id} is version ${stored.version} but setup did not register migrateState (needs ${decl.version})`,
        { scopeId: record.id },
      );
    }
    const storedDoc = toJsonValue(stored.doc);
    if (storedDoc === undefined) {
      return new PrimitiveError("state_schema", `stored state of ${record.id} is not JSON`, {
        scopeId: record.id,
      });
    }
    let migrated: JsonValue;
    try {
      migrated = migrate(storedDoc, stored.version);
    } catch (cause) {
      return new PrimitiveError(
        "state_migration_failed",
        `migrateState of ${record.id} threw while moving version ${stored.version} to ${decl.version}`,
        { scopeId: record.id, cause },
      );
    }
    if (!parse(decl.schema, migrated).ok) {
      return new PrimitiveError(
        "state_schema",
        `migrated state of ${record.id} does not match its schema`,
        { scopeId: record.id },
      );
    }
    if (jsonBytes(migrated) > ENVELOPE_MAX_BYTES - STATE_SLACK_BYTES) {
      return new PrimitiveError("state_too_large", `migrated state of ${record.id} is too large`, {
        scopeId: record.id,
      });
    }
    const port = core.ports.get(RecordCommitPortKey);
    if (port === undefined) {
      return new PrimitiveError(
        "port_unavailable",
        "xeon.session (RecordCommitPort) is not provided, so the state cannot be migrated",
        { scopeId: record.id },
      );
    }
    const draft = makeDraft(core.deps.ids, {
      threadId: thread.threadId,
      kind: stateKindOf(record.manifest),
      payload: {
        scopeId: record.id,
        rev: stored.rev + 1,
        prevEventId: stored.eventId,
        version: decl.version,
        doc: migrated,
      },
    });
    const result = await port.commit({
      threadId: thread.threadId,
      requestId: `mig:${hash12(record.id)}:${stored.version}-${decl.version}:${stored.rev}`,
      fingerprintSource: {
        scopeId: record.id,
        from: stored.version,
        to: decl.version,
        rev: stored.rev,
      },
      expectStateRev: { scopeId: record.id, rev: stored.rev },
      drafts: [draft],
    });
    switch (result.status) {
      case "committed":
        thread.states.set(record.id, {
          eventId: draft.id,
          rev: stored.rev + 1,
          version: decl.version,
          doc: deepFreeze(migrated),
        });
        return undefined;
      case "replayed": {
        const after = result.stored;
        thread.states.set(
          record.id,
          after === undefined
            ? {
                eventId: draft.id,
                rev: stored.rev + 1,
                version: decl.version,
                doc: deepFreeze(migrated),
              }
            : {
                eventId: after.eventId,
                rev: after.rev,
                version: after.version,
                doc: deepFreeze(after.doc),
              },
        );
        return undefined;
      }
      case "rejected":
        return rejectionError(record, result.code);
      default:
        return assertNever(result, "ExtCommitResult");
    }
  }

  /** (thread, scope)마다 커밋을 한 줄로 세운다(M3-REQ-23). 앞 작업이 실패해도 뒤 작업은 이어 간다 */
  const tails = new Map<string, Promise<void>>();

  function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const result = previous.then(task);
    const settled = Promise.allSettled([result]).then(() => {
      if (tails.get(key) === settled) tails.delete(key);
      return undefined;
    });
    tails.set(key, settled);
    return result;
  }

  /** 저장소의 활성 가지 상태로 캐시를 다시 채운다. 읽지 못하면 storage_unavailable */
  async function refreshStates(record: ScopeRecord, thread: ThreadRuntime): Promise<void> {
    const loaded = await portOf(record).loadThread(thread.threadId);
    if (!loaded.ok) {
      throw new PrimitiveError(
        "storage_unavailable",
        `state of ${record.id} could not be re-read: ${loaded.error.kind}`,
        { scopeId: record.id },
      );
    }
    for (const stored of loaded.value.states) {
      if (stored.scopeId !== record.id) continue;
      thread.states.set(record.id, {
        eventId: stored.eventId,
        rev: stored.rev,
        version: stored.version,
        doc: deepFreeze(stored.doc),
      });
    }
  }

  /** 공개 기록 초안 하나를 검사해 만든다. `record`와 `commitWith`가 같은 규칙을 쓴다 */
  function recordDraftOf(
    record: ScopeRecord,
    generation: Generation,
    thread: ThreadRuntime,
    input: RecordInput,
  ): DurableEventDraft {
    generation.usage.recordKinds.add(input.kind);
    const decl = record.manifest.recordKinds?.find((candidate) => candidate.kind === input.kind);
    if (decl === undefined) {
      throw new PrimitiveError(
        "record_kind_undeclared",
        `record kind ${input.kind} is not declared`,
        { scopeId: record.id },
      );
    }
    const groupRecord: GroupRecord = {
      groupId: record.manifest.name,
      kind: input.kind,
      version: decl.version,
      subject: input.subject,
      payload: input.payload,
    };
    const errors = validateGroupRecord(groupRecord, toRecordKindDecl(decl)).filter(
      (issue) => issue.severity === "error",
    );
    if (errors.length > 0) {
      throw new PrimitiveError(
        "record_invalid",
        `record ${input.kind} is invalid: ${errors.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`,
        { scopeId: record.id },
      );
    }
    return makeDraft(core.deps.ids, {
      threadId: thread.threadId,
      kind: input.kind,
      payload: groupRecord,
    });
  }

  /**
   * 상태 커밋 하나를 저장소에 낸다. `expectedRev`는 호출자가 본 판이고 캐시와 다르면 저장소를 부르지 않고 conflict다.
   * 저장소가 판 충돌로 거부해도 conflict다. `records`는 같은 요청의 초안으로 실어 상태와 함께 커밋된다(M3-REQ-24)
   */
  async function commitNow(
    record: ScopeRecord,
    thread: ThreadRuntime,
    amb: Ambient,
    next: unknown,
    expectedRev: number,
    extra: readonly DurableEventDraft[],
  ): Promise<{ readonly kind: "done"; readonly doc: unknown } | { readonly kind: "conflict" }> {
    const decl = record.def.state;
    if (decl === undefined) throw new Bug("state.commitNow: no state declaration");
    if (!parse(decl.schema, next).ok) {
      throw new PrimitiveError("state_schema", `state of ${record.id} does not match its schema`, {
        scopeId: record.id,
      });
    }
    if (jsonBytes(next) > ENVELOPE_MAX_BYTES - STATE_SLACK_BYTES) {
      throw new PrimitiveError("state_too_large", `state of ${record.id} is too large`, {
        scopeId: record.id,
      });
    }
    const port = portOf(record);
    const current = cacheOf(record, thread);
    if (current.rev !== expectedRev) return { kind: "conflict" };
    const { rid, fingerprint } = nextIdentity(record, amb, "c");
    const draft = makeDraft(core.deps.ids, {
      threadId: thread.threadId,
      kind: stateKindOf(record.manifest),
      payload: {
        scopeId: record.id,
        rev: current.rev + 1,
        prevEventId: current.eventId,
        version: decl.version,
        doc: next,
      },
    });
    const result = await port.commit({
      threadId: thread.threadId,
      requestId: rid,
      fingerprintSource: fingerprint,
      expectStateRev: { scopeId: record.id, rev: current.rev },
      drafts: [draft, ...extra],
    });
    switch (result.status) {
      case "committed":
        thread.states.set(record.id, {
          eventId: draft.id,
          rev: current.rev + 1,
          version: decl.version,
          doc: deepFreeze(next),
        });
        noteEffect(amb);
        return { kind: "done", doc: deepFreeze(next) };
      case "replayed": {
        const stored = result.stored;
        if (stored === undefined) return { kind: "done", doc: deepFreeze(next) };
        thread.states.set(record.id, {
          eventId: stored.eventId,
          rev: stored.rev,
          version: stored.version,
          doc: deepFreeze(stored.doc),
        });
        return { kind: "done", doc: deepFreeze(stored.doc) };
      }
      case "rejected":
        if (result.code === "state_conflict") return { kind: "conflict" };
        throw rejectionError(record, result.code);
      default:
        return assertNever(result, "ExtCommitResult");
    }
  }

  /** `commit`과 `commitWith`: 호출 순서대로 줄을 세우고, 호출 때의 판을 기대 판으로 쓴다 */
  async function commitQueued(
    record: ScopeRecord,
    generation: Generation,
    next: unknown,
    records: readonly RecordInput[],
  ): Promise<unknown> {
    assertGeneration(record, generation);
    const decl = record.def.state;
    if (decl === undefined) {
      throw new PrimitiveError("state_undeclared", `scope ${record.id} has no state`, {
        scopeId: record.id,
      });
    }
    const amb = ambient();
    const thread = threadOf(amb, record);
    if (amb === undefined) throw new Bug("state.commit: ambient vanished");
    const extra = records.map((input) => recordDraftOf(record, generation, thread, input));
    const expectedRev = cacheOf(record, thread).rev;
    return serialize(queueKey(thread, record), async () => {
      const done = await commitNow(record, thread, amb, next, expectedRev, extra);
      if (done.kind === "conflict") {
        throw new PrimitiveError("state_conflict", `state of ${record.id} changed; read it again`, {
          scopeId: record.id,
        });
      }
      return done.doc;
    });
  }

  return {
    docOf(threadId, scopeId) {
      const record = core.scopes.get(scopeId);
      const decl = record?.def.state;
      if (decl === undefined) return undefined;
      const thread = core.threads.get(threadId);
      return thread?.states.get(scopeId)?.doc ?? decl.initial;
    },
    revOf(threadId, scopeId) {
      return core.threads.get(threadId)?.states.get(scopeId)?.rev ?? 0;
    },
    state(record, generation) {
      assertGeneration(record, generation);
      const decl = record.def.state;
      if (decl === undefined) {
        throw new PrimitiveError("state_undeclared", `scope ${record.id} has no state`, {
          scopeId: record.id,
        });
      }
      const thread = threadOf(ambient(), record);
      return deepFreeze(cacheOf(record, thread).doc);
    },
    commit(record, generation, next) {
      return commitQueued(record, generation, next, []);
    },
    commitWith(record, generation, next, records) {
      return commitQueued(record, generation, next, records);
    },
    async update(record, generation, fn, records) {
      assertGeneration(record, generation);
      const decl = record.def.state;
      if (decl === undefined) {
        throw new PrimitiveError("state_undeclared", `scope ${record.id} has no state`, {
          scopeId: record.id,
        });
      }
      const amb = ambient();
      const thread = threadOf(amb, record);
      if (amb === undefined) throw new Bug("state.update: ambient vanished");
      const attempt = (): Promise<
        { readonly kind: "done"; readonly doc: unknown } | { readonly kind: "conflict" }
      > => {
        const current = cacheOf(record, thread);
        const next = fn(deepFreeze(current.doc));
        const extra = records(next).map((input) =>
          recordDraftOf(record, generation, thread, input),
        );
        return commitNow(record, thread, amb, next, current.rev, extra);
      };
      return serialize(queueKey(thread, record), async () => {
        try {
          const first = await attempt();
          if (first.kind === "done") return ok(first.doc);
          // 저장소의 판이 캐시보다 앞선다(다른 프로세스나 가지). 캐시를 다시 읽고 한 번 더 적용한다
          await refreshStates(record, thread);
          const second = await attempt();
          return second.kind === "done" ? ok(second.doc) : err({ kind: "state_conflict" });
        } catch (cause) {
          if (cause instanceof PrimitiveError && isUpdateFailure(cause.code)) {
            return err({ kind: cause.code, cause });
          }
          throw cause;
        }
      });
    },
    async record(record, generation, kind, subject, payload) {
      assertGeneration(record, generation);
      generation.usage.recordKinds.add(kind);
      const decl = record.manifest.recordKinds?.find((candidate) => candidate.kind === kind);
      if (decl === undefined) {
        throw new PrimitiveError("record_kind_undeclared", `record kind ${kind} is not declared`, {
          scopeId: record.id,
        });
      }
      const amb = ambient();
      const thread = threadOf(amb, record);
      if (amb === undefined) throw new Bug("state.record: ambient vanished");
      const groupRecord: GroupRecord = {
        groupId: record.manifest.name,
        kind,
        version: decl.version,
        subject,
        payload,
      };
      const issues = validateGroupRecord(groupRecord, toRecordKindDecl(decl));
      const errors = issues.filter((issue) => issue.severity === "error");
      if (errors.length > 0) {
        throw new PrimitiveError(
          "record_invalid",
          `record ${kind} is invalid: ${errors.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`,
          { scopeId: record.id },
        );
      }
      const port = portOf(record);
      const { rid } = nextIdentity(record, amb, "r");
      const result = await port.commit({
        threadId: thread.threadId,
        requestId: rid,
        drafts: [
          makeDraft(core.deps.ids, { threadId: thread.threadId, kind, payload: groupRecord }),
        ],
      });
      throwIfRejected(record, result);
      if (result.status === "committed") noteEffect(amb);
    },
    async recordPrivate(record, generation, kind, payload) {
      assertGeneration(record, generation);
      const amb = ambient();
      const thread = threadOf(amb, record);
      if (amb === undefined) throw new Bug("state.recordPrivate: ambient vanished");
      const prefix = ownKindPrefix(record.manifest);
      const area = kind.split(".")[2];
      const declaredPublic =
        record.manifest.recordKinds?.some((decl) => decl.kind === kind) === true;
      if (
        !kind.startsWith(prefix) ||
        !RECORD_KIND_REGEX.test(kind) ||
        area === "state" ||
        declaredPublic
      ) {
        throw new PrimitiveError(
          "record_private_invalid",
          `private record kind ${kind} is not allowed`,
          {
            scopeId: record.id,
          },
        );
      }
      if (jsonBytes(payload) > ENVELOPE_MAX_BYTES - STATE_SLACK_BYTES) {
        throw new PrimitiveError("state_too_large", `private record ${kind} is too large`, {
          scopeId: record.id,
        });
      }
      const port = portOf(record);
      const { rid } = nextIdentity(record, amb, "r");
      const result = await port.commit({
        threadId: thread.threadId,
        requestId: rid,
        visibility: "private",
        drafts: [makeDraft(core.deps.ids, { threadId: thread.threadId, kind, payload })],
      });
      throwIfRejected(record, result);
      if (result.status === "committed") noteEffect(amb);
    },
    async readRecords(record, generation, query) {
      assertGeneration(record, generation);
      generation.usage.readsRecordKinds.add(query.kind);
      if (!isKindReadable(record.manifest, query.kind)) {
        throw new PrimitiveError("read_kind_undeclared", `reading ${query.kind} is not declared`, {
          scopeId: record.id,
        });
      }
      const amb = ambient();
      const thread = threadOf(amb, record);
      const port = portOf(record);
      const queried = await port.queryRecords(
        thread.threadId,
        {
          kind: query.kind,
          ...(query.subject === undefined ? {} : { subject: query.subject }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
        },
        record.manifest.name,
      );
      if (!queried.ok) {
        throw new PrimitiveError(
          "storage_unavailable",
          `reading ${query.kind} failed: ${queried.error.kind}`,
          { scopeId: record.id },
        );
      }
      const rows = queried.value;
      const own = new Map(
        (record.manifest.recordKinds ?? []).map((decl) => [decl.kind, decl.version]),
      );
      for (const row of rows) {
        const declared = own.get(row.kind);
        if (declared !== undefined && row.version > declared) {
          core.deps.report({
            level: "warning",
            code: "record_version_unknown",
            scopeId: record.id,
            extension: record.extension,
            message: `record ${row.kind} version ${row.version} is newer than declared ${declared}`,
          });
        }
      }
      return rows.map(toGroupRecord);
    },
    async prepareStored(record, generation, thread) {
      const decl = record.def.state;
      if (decl === undefined) return undefined;
      const stored = thread.states.get(record.id);
      if (stored === undefined) return undefined;
      if (stored.version > decl.version) {
        return new PrimitiveError(
          "state_future_version",
          `stored state of ${record.id} is version ${stored.version}, newer than ${decl.version}`,
          { scopeId: record.id },
        );
      }
      if (stored.version === decl.version) {
        return parse(decl.schema, stored.doc).ok
          ? undefined
          : new PrimitiveError("state_schema", `stored state of ${record.id} breaks its schema`, {
              scopeId: record.id,
            });
      }
      return migrateStored(record, generation, thread, stored, decl);
    },
  };
}

/** 거부된 커밋 코드를 확장이 받는 오류로 옮긴다. invalid는 X 결함이라 Bug다 */
function rejectionError(record: ScopeRecord, code: ExtCommitRejectCode): PrimitiveError {
  switch (code) {
    case "state_conflict":
      return new PrimitiveError("state_conflict", `state of ${record.id} changed; read it again`, {
        scopeId: record.id,
      });
    case "lease_lost":
      return new PrimitiveError("lease_revoked", "session write ownership was lost", {
        scopeId: record.id,
      });
    case "busy":
    case "storage":
      return new PrimitiveError("storage_unavailable", `state commit failed: ${code}`, {
        scopeId: record.id,
      });
    case "invalid":
      // 초안과 키는 X가 만든다. 저장소가 거부하면 X의 결함이다
      throw new Bug("commit.invalid: state migration draft or key was rejected");
    default:
      return assertNever(code, "ExtCommitRejectCode");
  }
}

function throwIfRejected(
  record: ScopeRecord,
  result: { readonly status: string; readonly code?: string },
): void {
  if (result.status !== "rejected") return;
  if (result.code === "lease_lost") {
    throw new PrimitiveError("lease_revoked", "session write ownership was lost", {
      scopeId: record.id,
    });
  }
  if (result.code === "invalid") {
    throw new Bug("commit.invalid: record commit draft or key was rejected");
  }
  throw new PrimitiveError("storage_unavailable", `commit failed: ${result.code ?? "unknown"}`, {
    scopeId: record.id,
  });
}

function toGroupRecord(row: ExtRecordRow): GroupRecord {
  return {
    groupId: row.groupId,
    kind: row.kind,
    version: row.version,
    subject: row.subject,
    payload: row.payload,
  };
}

/** 매니페스트 JSON 선언을 validateGroupRecord가 받는 형태로 바꾼다. payload는 JSON Schema 문서 그대로 스키마로 쓴다 */
function toRecordKindDecl(decl: {
  readonly kind: RecordKind;
  readonly version: number;
  readonly description: string;
  readonly payload: Readonly<Record<string, unknown>>;
}): RecordKindDecl {
  // 매니페스트의 payload는 JSON Schema 객체이고 parse가 그대로 컴파일한다(F.extensions.spec §3.1)
  return { ...decl, payload: decl.payload };
}
