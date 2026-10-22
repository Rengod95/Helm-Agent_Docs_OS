import { assertNever, Bug, parse } from "@xeon/contracts";
import type { JsonValue, ThreadId } from "@xeon/contracts/conversation";
import {
  RECORD_KIND_PATTERN,
  RecordCommitPortKey,
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
import { ENVELOPE_MAX_BYTES, type ExtensionEventKind } from "@xeon/contracts/records";
import { ambient, type Ambient } from "./ambient.ts";
import type { Generation, HostCore, ScopeRecord, StateCacheEntry, ThreadRuntime } from "./core.ts";
import { makeDraft } from "./drafts.ts";
import { PrimitiveError } from "./errors.ts";
import { deepFreeze } from "./freeze.ts";
import { hash12, keyPart } from "./keys.ts";

const STATE_SLACK_BYTES = 4096;
const RECORD_KIND_REGEX = new RegExp(RECORD_KIND_PATTERN);

export interface StateService {
  /** 핸들러 ctx.state용 마지막 커밋 상태. 상태 선언이 없으면 undefined */
  docOf(threadId: ThreadId, scopeId: ScopeId): unknown;
  /** (thread, scope)의 활성 가지 위 상태 판 */
  revOf(threadId: ThreadId, scopeId: ScopeId): number;
  state(record: ScopeRecord, generation: Generation): unknown;
  commit(record: ScopeRecord, generation: Generation, next: unknown): Promise<unknown>;
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
  /** 켜기 준비: 저장된 상태가 선언 버전·스키마와 맞는지 본다. 맞지 않으면 오류를 돌려준다 */
  checkStored(record: ScopeRecord, thread: ThreadRuntime): PrimitiveError | undefined;
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
    async commit(record, generation, next) {
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
      if (!parse(decl.schema, next).ok) {
        throw new PrimitiveError(
          "state_schema",
          `state of ${record.id} does not match its schema`,
          {
            scopeId: record.id,
          },
        );
      }
      if (jsonBytes(next) > ENVELOPE_MAX_BYTES - STATE_SLACK_BYTES) {
        throw new PrimitiveError("state_too_large", `state of ${record.id} is too large`, {
          scopeId: record.id,
        });
      }
      const port = portOf(record);
      const current = cacheOf(record, thread);
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
        drafts: [draft],
      });
      switch (result.status) {
        case "committed": {
          thread.states.set(record.id, {
            eventId: draft.id,
            rev: current.rev + 1,
            version: decl.version,
            doc: deepFreeze(next),
          });
          noteEffect(amb);
          return deepFreeze(next);
        }
        case "replayed": {
          const stored = result.stored;
          if (stored !== undefined) {
            thread.states.set(record.id, {
              eventId: stored.eventId,
              rev: stored.rev,
              version: stored.version,
              doc: deepFreeze(stored.doc),
            });
            return deepFreeze(stored.doc);
          }
          return deepFreeze(next);
        }
        case "rejected":
          switch (result.code) {
            case "state_conflict":
              throw new PrimitiveError(
                "state_conflict",
                `state of ${record.id} changed; read it again`,
                {
                  scopeId: record.id,
                },
              );
            case "lease_lost":
              throw new PrimitiveError("lease_revoked", "session write ownership was lost", {
                scopeId: record.id,
              });
            case "busy":
            case "storage":
              throw new PrimitiveError(
                "storage_unavailable",
                `state commit failed: ${result.code}`,
                {
                  scopeId: record.id,
                },
              );
            case "invalid":
              // 초안과 키는 X가 만든다. 저장소가 거부하면 X의 결함이다
              throw new Bug("commit.invalid: state commit draft or key was rejected");
            default:
              return assertNever(result.code, "ExtCommitRejectCode");
          }
        default:
          return assertNever(result, "ExtCommitResult");
      }
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
      const prefix =
        record.manifest.kind === "group"
          ? `grp.${record.manifest.name}.`
          : `x.${record.manifest.name}.`;
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
      if (!isReadAllowed(record, query.kind)) {
        throw new PrimitiveError("read_kind_undeclared", `reading ${query.kind} is not declared`, {
          scopeId: record.id,
        });
      }
      const amb = ambient();
      const thread = threadOf(amb, record);
      const port = portOf(record);
      const rows = await port.queryRecords(
        thread.threadId,
        {
          kind: query.kind,
          ...(query.subject === undefined ? {} : { subject: query.subject }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
        },
        record.manifest.name,
      );
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
    checkStored(record, thread) {
      const decl = record.def.state;
      if (decl === undefined) return undefined;
      const stored = thread.states.get(record.id);
      if (stored === undefined) return undefined;
      if (stored.version > decl.version) {
        return new PrimitiveError(
          "state_schema",
          `stored state of ${record.id} is version ${stored.version}, newer than ${decl.version}`,
          { scopeId: record.id },
        );
      }
      if (stored.version < decl.version) {
        return new PrimitiveError(
          "state_migration_missing",
          `stored state of ${record.id} is version ${stored.version} and no migration exists (M2)`,
          { scopeId: record.id },
        );
      }
      if (!parse(decl.schema, stored.doc).ok) {
        return new PrimitiveError(
          "state_schema",
          `stored state of ${record.id} breaks its schema`,
          {
            scopeId: record.id,
          },
        );
      }
      return undefined;
    },
  };
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

/** 자기 접두 kind이거나 readsRecordKinds가 덮으면 읽을 수 있다(X.primitives.spec §4.6.4) */
function isReadAllowed(record: ScopeRecord, kind: string): boolean {
  const prefix =
    record.manifest.kind === "group"
      ? `grp.${record.manifest.name}.`
      : `x.${record.manifest.name}.`;
  if (kind.startsWith(prefix)) return true;
  return (record.manifest.readsRecordKinds ?? []).some((declared) =>
    declared.endsWith("*") ? kind.startsWith(declared.slice(0, -1)) : declared === kind,
  );
}
