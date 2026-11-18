import { assertNever, Bug, err, ok, parse, type Logger, type Result } from "@fresnel/contracts";
import {
  toJsonValue,
  type IdFactory,
  type ThreadId,
  type TurnId,
} from "@fresnel/contracts/conversation";
import {
  WorkspaceFilesCapturedPayloadSchema,
  WorkspaceRewindAppliedPayloadSchema,
  WorkspaceRewindOverwrittenPayloadSchema,
  WorkspaceRewindStartedPayloadSchema,
  WorkspaceRewindUndonePayloadSchema,
  type DurableEventEnvelope,
  type EventFeed,
  type EventKind,
  type FileBefore,
  type ProducerHandle,
  type ReadFailure,
  type SessionService,
  type StoreService,
  type WorkspaceRewindAppliedPayload,
  type WorkspaceRewindOverwrittenPayload,
  type WorkspaceRewindStartedPayload,
  type WorkspaceRewindUndonePayload,
} from "@fresnel/contracts/records";
import { sha256Bytes } from "./hash.ts";
import type { RewindLimits } from "./limits.ts";

// 되감기의 저장 쪽(L1.persistence.spec §4.13.2, F.records.spec §3.3.3). 이벤트를 읽어 로그와 대화별 상태를 만들고,
// 옛 내용을 blob에 넣고, 워크스페이스 이벤트를 커밋한다. 파일 내용은 로그·이벤트·오류 어디에도 싣지 않는다.

export type RewindSession = Pick<SessionService, "commit" | "feed" | "query" | "readBranch">;
export type RewindBlobs = Pick<StoreService, "putBlob" | "readBlob">;

export interface RewindStoreDeps {
  readonly session: RewindSession;
  /** 생산자 `cap.workspace`의 핸들. 플러그인 setup에서 한 번만 받는다 */
  readonly producer: ProducerHandle;
  readonly ids: IdFactory;
  readonly blobs: RewindBlobs;
  readonly logger: Logger;
  readonly limits: RewindLimits;
}

/** 대화 하나의 원본 저장 상태. 처음 쓸 때 이벤트에서 채우고, 이 프로세스의 저장으로 갱신한다 */
export interface ThreadRewindState {
  /** 서로 다른 blob 해시 → 크기 */
  readonly blobSizes: Map<string, number>;
  /** `blobSizes`의 크기 합. 대화당 상한과 견준다 */
  totalBytes: number;
  /** `turnId`와 경로 → 이 턴에서 그 경로를 처음 기록했는가. `untracked`는 처음 기록이 실패해 추적하지 않는 경로다 */
  readonly turnPaths: Map<string, "tracked" | "untracked">;
}

/** 워크스페이스 이벤트 전체를 접은 로그. 되감기 식별자로 찾는다 */
export interface RewindLog {
  readonly started: ReadonlyMap<string, WorkspaceRewindStartedPayload>;
  readonly applied: ReadonlyMap<string, WorkspaceRewindAppliedPayload>;
  readonly undone: ReadonlyMap<string, WorkspaceRewindUndonePayload>;
  /** 덮어쓰기 기록, 커밋 순서 */
  readonly overwritten: readonly WorkspaceRewindOverwrittenPayload[];
}

interface CommitEventInput {
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  /** 커밋 키. 같은 키에 다른 내용을 내면 `key_reused`다 */
  readonly requestKey: string;
  readonly kind: EventKind;
  /** JSON 값이어야 한다. 파일 내용을 넣지 않는다 */
  readonly payload: unknown;
}

export interface RewindStore extends RewindStoreDeps {
  /** 대화의 원본 저장 상태. 처음 부를 때 이벤트를 읽는다 */
  stateOf(threadId: ThreadId): Result<ThreadRewindState, string>;
  /** 옛 내용(없으면 null)을 기록할 `FileBefore`로 바꾼다. 상한을 넘거나 대화 총량을 넘으면 `unrestorable`이다 */
  snapshot(threadId: ThreadId, bytes: Uint8Array | null): Result<FileBefore, string>;
  readLog(threadId: ThreadId): Result<RewindLog, string>;
  commitEvent(input: CommitEventInput): Result<void, string>;
}

const PAGE = 2000;

function failureText(error: ReadFailure): string {
  return error.kind === "row_invalid" ? `row_invalid:${error.where}` : error.kind;
}

function rowInvalid(kind: string): string {
  return `row_invalid:${kind}`;
}

/** 접두가 맞는 이벤트를 커밋 순서로 모두 읽는다. 한 대화만 본다 */
function readEvents(
  feed: EventFeed,
  threadId: ThreadId,
  kindPrefixes: readonly string[],
): Result<DurableEventEnvelope[], ReadFailure> {
  const head = feed.headSeq();
  if (!head.ok) return err(head.error);
  const events: DurableEventEnvelope[] = [];
  let after = 0;
  while (after < head.value) {
    const page = feed.read(
      after,
      head.value,
      { threadIds: [threadId], kindPrefixes },
      PAGE,
      PAGE * 4,
    );
    if (!page.ok) return err(page.error);
    events.push(...page.value.events);
    if (page.value.scannedTo <= after) break;
    after = page.value.scannedTo;
  }
  return ok(events);
}

function turnKey(turnId: TurnId, path: string): string {
  return `${turnId}\n${path}`;
}

function addBlob(state: ThreadRewindState, sha256: string, size: number): void {
  if (state.blobSizes.has(sha256)) return;
  state.blobSizes.set(sha256, size);
  state.totalBytes += size;
}

function addBefore(state: ThreadRewindState, before: FileBefore): void {
  if (before.state === "saved") addBlob(state, before.blob.sha256, before.blob.size);
}

/** 이벤트에서 원본 저장 상태를 만든다. 턴별 기록 경로와 blob 크기를 모두 채운다 */
function loadState(feed: EventFeed, threadId: ThreadId): Result<ThreadRewindState, string> {
  const events = readEvents(feed, threadId, ["workspace."]);
  if (!events.ok) return err(failureText(events.error));
  const state: ThreadRewindState = { blobSizes: new Map(), totalBytes: 0, turnPaths: new Map() };
  for (const event of events.value) {
    if (event.kind === "workspace.files_captured") {
      const payload = parse(WorkspaceFilesCapturedPayloadSchema, event.payload);
      if (!payload.ok || event.turnId === null) return err(rowInvalid("workspace.files_captured"));
      for (const entry of payload.value.entries) {
        if (entry.first) {
          state.turnPaths.set(turnKey(event.turnId, entry.path), "tracked");
          addBefore(state, entry.before);
        }
      }
    } else if (event.kind === "workspace.rewind_started") {
      const payload = parse(WorkspaceRewindStartedPayloadSchema, event.payload);
      if (!payload.ok) return err(rowInvalid("workspace.rewind_started"));
      for (const entry of payload.value.entries) {
        addBefore(state, entry.targetBefore);
        addBefore(state, entry.undoBefore);
      }
    }
  }
  return ok(state);
}

export function createRewindStore(deps: RewindStoreDeps): RewindStore {
  const { session, producer, ids, blobs, limits } = deps;
  const states = new Map<ThreadId, ThreadRewindState>();

  function stateOf(threadId: ThreadId): Result<ThreadRewindState, string> {
    const cached = states.get(threadId);
    if (cached !== undefined) return ok(cached);
    const loaded = loadState(session.feed, threadId);
    if (!loaded.ok) return err(loaded.error);
    states.set(threadId, loaded.value);
    return ok(loaded.value);
  }

  function snapshot(threadId: ThreadId, bytes: Uint8Array | null): Result<FileBefore, string> {
    if (bytes === null) return ok({ state: "absent" });
    const size = bytes.byteLength;
    if (size > limits.fileMaxBytes) {
      return ok({ state: "unrestorable", reason: "too_large", size });
    }
    const state = stateOf(threadId);
    if (!state.ok) return err(state.error);
    const sha256 = sha256Bytes(bytes);
    if (
      !state.value.blobSizes.has(sha256) &&
      state.value.totalBytes + size > limits.threadQuotaBytes
    ) {
      return ok({ state: "unrestorable", reason: "quota", size });
    }
    const put = blobs.putBlob(bytes, null);
    if (!put.ok) return err(`blob:${put.error.kind}`);
    addBlob(state.value, put.value.sha256, put.value.size);
    return ok({ state: "saved", blob: put.value, mode: null });
  }

  function readLog(threadId: ThreadId): Result<RewindLog, string> {
    const events = readEvents(session.feed, threadId, ["workspace."]);
    if (!events.ok) return err(failureText(events.error));
    const started = new Map<string, WorkspaceRewindStartedPayload>();
    const applied = new Map<string, WorkspaceRewindAppliedPayload>();
    const undone = new Map<string, WorkspaceRewindUndonePayload>();
    const overwritten: WorkspaceRewindOverwrittenPayload[] = [];
    for (const event of events.value) {
      if (event.kind === "workspace.rewind_started") {
        const payload = parse(WorkspaceRewindStartedPayloadSchema, event.payload);
        if (!payload.ok) return err(rowInvalid(event.kind));
        if (!started.has(payload.value.rewindId))
          started.set(payload.value.rewindId, payload.value);
      } else if (event.kind === "workspace.rewind_applied") {
        const payload = parse(WorkspaceRewindAppliedPayloadSchema, event.payload);
        if (!payload.ok) return err(rowInvalid(event.kind));
        if (!applied.has(payload.value.rewindId))
          applied.set(payload.value.rewindId, payload.value);
      } else if (event.kind === "workspace.rewind_undone") {
        const payload = parse(WorkspaceRewindUndonePayloadSchema, event.payload);
        if (!payload.ok) return err(rowInvalid(event.kind));
        if (!undone.has(payload.value.rewindId)) undone.set(payload.value.rewindId, payload.value);
      } else if (event.kind === "workspace.rewind_overwritten") {
        const payload = parse(WorkspaceRewindOverwrittenPayloadSchema, event.payload);
        if (!payload.ok) return err(rowInvalid(event.kind));
        overwritten.push(payload.value);
      }
    }
    return ok({ started, applied, undone, overwritten });
  }

  function commitEvent(input: CommitEventInput): Result<void, string> {
    const body = toJsonValue(input.payload);
    if (body === undefined) throw new Bug("workspace event payloads are JSON values");
    const { threadId, turnId, kind } = input;
    const result = session.commit({
      threadId,
      requestId: input.requestKey,
      fingerprintSource: body,
      build: () => ({
        kind: "append",
        drafts: [
          producer.draft({
            id: ids.next("evt"),
            kind,
            threadId,
            turnId,
            stepId: null,
            causationId: null,
            correlationId: null,
            payload: body,
          }),
        ],
        checkpoint: null,
      }),
    });
    if (!result.ok) return err(result.error.kind);
    switch (result.value.status) {
      case "committed":
        return ok(undefined);
      case "rejected":
        return err(`rejected:${result.value.code}`);
      case "key_reused":
        return err("key_reused");
      default:
        return assertNever(result.value, "CommitResult");
    }
  }

  return { ...deps, stateOf, snapshot, readLog, commitEvent };
}
