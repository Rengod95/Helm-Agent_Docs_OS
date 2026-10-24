// X 기록 포트 `SessionService.ext`(L1.persistence.spec §3.3, PS-16). 확장 레코드·상태·scope·임대 이벤트를 SessionWriter 한 트랜잭션으로
// 커밋하고, 활성 가지 기준 스냅샷과 기록 조회를 돌려준다. 결과는 스펙 §3.3 변환표를 따른다.
import { assertNever, parse, type Result } from "@xeon/contracts";
import { toJsonValue, type JsonValue, type ThreadId } from "@xeon/contracts/conversation";
import {
  checkEnvelopeSize,
  COMMIT_KEY_PATTERN,
  ownerOfKind,
  parseEventKind,
  type CatalogEntry,
  type CommitPlan,
  type DurableEventDraft,
  type ExtCommitRequest,
  type ExtCommitResult,
  type ReadFailure,
  type ExtensionEventKind,
  type ExtRecordQuery,
  type ExtRecordRow,
  type ExtThreadSnapshot,
  type ProducerId,
  type RecordCommitPort,
  type StampedDraft,
  type StoreDb,
  type StoreError,
} from "@xeon/contracts/records";
import { needsDetach } from "./blob.ts";
import { activeStateOf, loadSnapshot, queryActiveRecords } from "./ext-queries.ts";
import type { ProducerRegistry } from "./producers.ts";
import { readResult } from "./rows.ts";
import type { KindCatalog } from "./upcast.ts";
import type { CommitHooks, SessionWriter } from "./writer.ts";

export interface ExtPortDeps {
  readonly db: StoreDb;
  readonly writer: SessionWriter;
  readonly producers: ProducerRegistry;
  readonly catalog: KindCatalog;
  /** blob 쓰기가 있는가. 없으면 상한을 넘는 초안은 거부한다 */
  readonly canDetach: boolean;
}

const COMMIT_KEY = new RegExp(COMMIT_KEY_PATTERN);

/** X가 낸 scope·임대 이벤트의 생산자 */
const XH_PRODUCER: ProducerId = "xh";

interface Prepared {
  readonly drafts: readonly StampedDraft[];
  /** 비공개 소유 확장을 초안 id별로. 공개 커밋이면 비어 있다 */
  readonly privateOwners: ReadonlyMap<string, string>;
  readonly fingerprintSource: JsonValue;
}

function isExtensionKind(kind: string): kind is ExtensionEventKind {
  return kind.startsWith("x.") || kind.startsWith("grp.");
}

/** 초안 하나를 낙인한다. 거부해야 하면 undefined(스펙 §3.3 "초안 검증 실패"는 `invalid`) */
function stampDraft(
  deps: ExtPortDeps,
  threadId: ThreadId,
  draft: DurableEventDraft,
): { readonly stamped: StampedDraft; readonly owner: string | null } | undefined {
  if (draft.threadId !== threadId) return undefined;
  if (!Number.isInteger(draft.version) || draft.version < 1) return undefined;
  const { kind } = draft;
  let producer: ProducerId;
  let owner: string | null;
  let entry: CatalogEntry | undefined;
  const parsed = parseEventKind(kind);
  if (parsed.ok && parsed.value.origin === "extension" && isExtensionKind(kind)) {
    owner = parsed.value.ownerId;
    producer = `ext.${owner}`;
    // 등록부에 없는 확장 kind는 열린 kind로 올린다. payload는 X가 이미 검사했다(KindCatalog.openExtension)
    entry = deps.catalog.openExtension(kind, draft.version);
  } else if (ownerOfKind(kind) === XH_PRODUCER) {
    owner = null;
    producer = XH_PRODUCER;
    entry = deps.catalog.entryOf(kind);
  } else {
    return undefined;
  }
  if (entry === undefined || !entry.durable || entry.retired === true) return undefined;
  if (draft.version > entry.version || !parse(entry.payload, draft.payload).ok) return undefined;
  const size = checkEnvelopeSize({ ...draft, seq: 1, recordedAt: 0, parentId: null });
  if (!size.ok && !(deps.canDetach && needsDetach(draft))) return undefined;
  const { durable: _durable, version, ...rest } = draft;
  return { stamped: deps.producers.internal(producer).draft({ ...rest, version }), owner };
}

function prepare(deps: ExtPortDeps, request: ExtCommitRequest): Prepared | undefined {
  if (!COMMIT_KEY.test(request.requestId) || request.drafts.length === 0) return undefined;
  const stamped: StampedDraft[] = [];
  const privateOwners = new Map<string, string>();
  const visibility = request.visibility ?? "public";
  for (const draft of request.drafts) {
    const done = stampDraft(deps, request.threadId, draft);
    if (done === undefined) return undefined;
    if (visibility === "private") {
      // 비공개는 확장 접두 kind만 쓴다. 소유 확장은 kind의 둘째 마디이고 낙인한 생산자의 이름과 같다(F.records.spec §3.9)
      if (done.owner === null) return undefined;
      privateOwners.set(draft.id, done.owner);
    }
    stamped.push(done.stamped);
  }
  const source =
    request.fingerprintSource ??
    toJsonValue(request.drafts.map((draft) => [draft.kind, draft.payload]));
  if (source === undefined) return undefined;
  // visibility는 지문에 넣는다: 같은 키로 공개 범위만 바꾸면 key_reused다(스펙 §3.3)
  return { drafts: stamped, privateOwners, fingerprintSource: { source, visibility } };
}

function rejectionOf(error: StoreError): ExtCommitResult {
  switch (error.kind) {
    case "ownership_lost":
      return { status: "rejected", code: "lease_lost" };
    case "busy":
      return { status: "rejected", code: "busy" };
    case "disk_full":
    case "io":
    case "read_only":
    case "row_invalid":
      return { status: "rejected", code: "storage" };
    case "thread_not_found":
      // 열지 않은 thread에 쓰려는 호출은 X의 결함이다
      return { status: "rejected", code: "invalid" };
    default:
      return assertNever(error, "StoreError");
  }
}

export function createExtPort(deps: ExtPortDeps): RecordCommitPort {
  const { db, writer } = deps;

  const storedState = (threadId: ThreadId, scopeId: string) =>
    readResult(db, (tx) => activeStateOf(tx, threadId, scopeId));

  const commitSync = (request: ExtCommitRequest): ExtCommitResult => {
    const prepared = prepare(deps, request);
    if (prepared === undefined) return { status: "rejected", code: "invalid" };
    const expect = request.expectStateRev;
    const hooks: CommitHooks =
      prepared.privateOwners.size === 0
        ? {}
        : { privateOwnerOf: (draft) => prepared.privateOwners.get(draft.id) ?? null };
    const outcome = writer.commitWith(
      {
        threadId: request.threadId,
        requestId: request.requestId,
        fingerprintSource: prepared.fingerprintSource,
        build(view): CommitPlan {
          if (
            expect !== undefined &&
            view.scopeStateRev(request.threadId, expect.scopeId) !== expect.rev
          ) {
            return { kind: "reject", code: "state_conflict", detail: expect.scopeId };
          }
          return { kind: "append", drafts: prepared.drafts, checkpoint: null };
        },
      },
      hooks,
    );
    if (!outcome.ok) return rejectionOf(outcome.error);
    if (outcome.value.kind === "preempted") {
      // 생성 키 훅은 쓰지 않았다
      return { status: "rejected", code: "invalid" };
    }
    const result = outcome.value.result;
    switch (result.status) {
      case "committed": {
        if (!result.replayed) return { status: "committed" };
        if (expect === undefined) return { status: "replayed" };
        const stored = storedState(request.threadId, expect.scopeId);
        if (!stored.ok) return rejectionOf(stored.error);
        return stored.value === undefined
          ? { status: "replayed" }
          : { status: "replayed", stored: stored.value };
      }
      case "rejected":
        return {
          status: "rejected",
          code: result.code === "state_conflict" ? "state_conflict" : "invalid",
        };
      case "key_reused":
        return { status: "rejected", code: "invalid" };
      default:
        return assertNever(result, "CommitResult");
    }
  };

  return {
    // 커밋은 동기 SQLite 호출이다. 던진 것(투영기 예외 등)은 거부된 Promise로 올린다
    commit: (request) => Promise.resolve().then(() => commitSync(request)),
    loadThread(threadId): Promise<Result<ExtThreadSnapshot, ReadFailure>> {
      return Promise.resolve().then(() => readResult(db, (tx) => loadSnapshot(tx, threadId)));
    },
    queryRecords(
      threadId,
      query: ExtRecordQuery,
      reader,
    ): Promise<Result<readonly ExtRecordRow[], ReadFailure>> {
      return Promise.resolve().then(() =>
        readResult(db, (tx) => queryActiveRecords(tx, threadId, query, reader)),
      );
    },
  };
}
