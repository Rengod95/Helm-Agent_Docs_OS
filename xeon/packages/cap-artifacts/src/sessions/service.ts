import { assertNever, Bug, parse, type Logger, type Result } from "@xeon/contracts";
import {
  ArtifactsSessions,
  LabelSchema,
  type CallOptions,
  type CapabilityApi,
  type CapabilityError,
  type SessionMetaView,
} from "@xeon/contracts/capabilities";
import {
  toJsonValue,
  type IdFactory,
  type JsonValue,
  type ThreadId,
  type TurnId,
} from "@xeon/contracts/conversation";
import {
  commitKeyPart,
  type CommitPlan,
  type CommitResult,
  type EventKind,
  type LifecycleError,
  type ProducerHandle,
  type ProjectionQuery,
  type ReadFailure,
  type SessionService,
  type StampedDraft,
  type StoreError,
  type ThreadLifecycle,
  type ThreadListQuery,
  type ThreadSummaryRow,
} from "@xeon/contracts/records";
import { sha256Hex } from "../hash.ts";
import { assertLive, requestIdOf, scopeOf } from "../call.ts";
import { reject } from "../errors.ts";
import { readEvents } from "../reviews/collect.ts";
import { foldSessionMeta, SESSION_META_EVENT_PREFIXES, type SessionMetaIndex } from "./state.ts";

// L2.artifacts.spec §3.4, §3.5, §4.3. artifacts.sessions 서비스. 라벨은 이벤트를 접어 얻고(state.ts), 제목은 L1 제목 API로 쓴다.
// 이 서비스는 제목 이벤트를 직접 커밋하지 않는다(§4.3.1). 쓰기는 라벨 커밋 하나와 제목 호출 하나다.
// handoff·export는 2차라 없다.

const CAPABILITY = ArtifactsSessions.id;
/** 세션당 라벨 상한(§3.4, §4.3.3) */
const LABELS_MAX = 32;
/** setMeta의 제목 상한(§3.4) */
const TITLE_MAX = 200;
const LIST_DEFAULT_LIMIT = 50;
const SEARCH_DEFAULT_LIMIT = 20;
/** threads.list 한 쪽의 크기. 전체 세션을 모을 때 쓴다(L1의 최대 쪽 크기와 같다) */
const THREAD_PAGE = 200;

type Api = CapabilityApi<typeof ArtifactsSessions>;
type SetMetaInput = Parameters<Api["setMeta"]>[0];
type LabelsInput = NonNullable<SetMetaInput["labels"]>;
type TitleSource = "user" | "model";
type SessionOrder = "updated" | "created";

/** 세션 서비스가 쓰는 부분. 제목 쓰기와 목록 읽기는 `threads`의 두 함수뿐이다 */
export interface SessionsDeps {
  readonly session: Pick<SessionService, "commit" | "feed"> & {
    readonly query: Pick<ProjectionQuery, "thread">;
    readonly threads: Pick<ThreadLifecycle, "list" | "setTitle">;
  };
  /** 리뷰와 산출물 레지스트리와 같은 생산자 핸들이다(claim은 한 번만) */
  readonly producer: ProducerHandle;
  readonly ids: IdFactory;
  readonly logger: Logger;
}

export interface SessionsRuntime {
  readonly api: Api;
}

/** 읽기나 커밋이 실패하면 `unavailable`이다. 세션이 없으면 `not_found`다. busy만 다시 시도할 수 있다 */
function storeFailure(method: string, error: StoreError | ReadFailure): CapabilityError {
  if (error.kind === "thread_not_found") {
    return reject(CAPABILITY, method, "not_found", "The session does not exist.");
  }
  return reject(CAPABILITY, method, "unavailable", `The store failed: ${error.kind}.`, {
    retryable: error.kind === "busy",
  });
}

function isToolPath(options: CallOptions | undefined): boolean {
  return options?.context?.toolCallId !== undefined;
}

function jsonOf(value: unknown): JsonValue {
  const converted = toJsonValue(value);
  if (converted === undefined) throw new Bug("sessions built a value that is not JSON");
  return converted;
}

function cursorOffset(method: string, cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  if (!/^(0|[1-9][0-9]{0,8})$/.test(cursor)) {
    throw reject(CAPABILITY, method, "invalid_input", "The cursor is malformed.");
  }
  return Number(cursor);
}

/** 메서드 본문을 Promise로 감싼다. 던진 오류는 거부가 된다(서비스 메서드는 거부로 실패를 알린다) */
function settle<T>(work: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    resolve(work());
  });
}

/** 라벨 정규화: NFC, 앞뒤 공백 제거. 정규화한 값이 LabelSchema에 맞지 않으면 `invalid_input`이다 (§4.3.3) */
function labelOf(method: string, raw: string): string {
  const checked = parse(LabelSchema, raw.normalize("NFC").trim());
  if (!checked.ok) throw reject(CAPABILITY, method, "invalid_input", "A label is malformed.");
  return checked.value;
}

function distinct(labels: readonly string[]): string[] {
  return [...new Set(labels)];
}

/** 찾기 비교 형식. NFC 뒤 ASCII 대문자만 소문자로 바꾼다(SQLite `lower`의 범위, §4.3.3) */
function searchKey(text: string): string {
  return text.normalize("NFC").replace(/[A-Z]+/g, (run) => run.toLowerCase());
}

/**
 * 적용 뒤의 라벨 전체. `set`이 있으면 그 목록이 전체다. 없으면 현재 목록 끝에 `add`를 더하고 `remove`를 뺀다.
 * `set`과 `add`·`remove`를 함께 받으면 어느 쪽이 맞는지 정할 수 없어 거부한다 [결정: M3b 구현].
 */
function nextLabels(method: string, current: readonly string[], input: LabelsInput): string[] {
  if (input.set !== undefined) {
    if (input.add !== undefined || input.remove !== undefined) {
      throw reject(
        CAPABILITY,
        method,
        "invalid_input",
        "labels.set cannot be combined with add or remove.",
      );
    }
    return distinct(input.set.map((raw) => labelOf(method, raw)));
  }
  const added = distinct([...current, ...(input.add ?? []).map((raw) => labelOf(method, raw))]);
  const removed = new Set((input.remove ?? []).map((raw) => labelOf(method, raw)));
  return added.filter((label) => !removed.has(label));
}

/** 라벨 조건. 입력 라벨을 같은 방식으로 정규화해 세션 라벨과 비교한다 */
function labelFilter(method: string, raw: readonly string[] | undefined): readonly string[] {
  return (raw ?? []).map((label) => labelOf(method, label));
}

/** 주어진 라벨이 모두 세션 라벨에 있으면 참이다. 정확히 같은 문자열만 맞는다 */
function hasLabels(labels: readonly string[], wanted: readonly string[]): boolean {
  return wanted.every((label) => labels.includes(label));
}

function sameLabels(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((label, index) => label === right[index]);
}

/** 최근 순. 같은 시각이면 threadId 오름차순이다(산출물 목록과 같은 규칙, §4.1.6) */
function byOrder(order: SessionOrder): (left: SessionMetaView, right: SessionMetaView) => number {
  return (left, right) => {
    const a = order === "updated" ? left.updatedAt : left.createdAt;
    const b = order === "updated" ? right.updatedAt : right.createdAt;
    if (a !== b) return b - a;
    if (left.threadId < right.threadId) return -1;
    return left.threadId > right.threadId ? 1 : 0;
  };
}

/** 제목 또는 라벨에 찾는 문자열이 부분으로 들어 있으면 참이다 */
function matches(view: SessionMetaView, needle: string): boolean {
  const texts = view.title === null ? view.labels : [view.title, ...view.labels];
  return texts.some((text) => searchKey(text).includes(needle));
}

function viewOf(
  row: ThreadSummaryRow,
  index: SessionMetaIndex,
  source: TitleSource,
): SessionMetaView {
  return {
    threadId: row.threadId,
    title: row.title,
    // 제목 이벤트에는 출처가 없어 출처는 호출 경로로만 정한다(§4.3.1, §10 미결 2). 제목이 없으면 null이다
    titleSource: row.title === null ? null : source,
    labels: [...(index.labels.get(row.threadId) ?? [])],
    workspace: row.workspace,
    artifactCount: index.artifactCounts.get(row.threadId) ?? 0,
    handoffFrom: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createSessions(deps: SessionsDeps): SessionsRuntime {
  /** 세션 행 하나. 없으면 `not_found`다. 쓰기 전에 부르면 빈 세션에 쓰지 않는다 */
  function rowOf(method: string, threadId: ThreadId): ThreadSummaryRow {
    const row = deps.session.query.thread(threadId);
    if (!row.ok) throw storeFailure(method, row.error);
    if (row.value === undefined) {
      throw reject(CAPABILITY, method, "not_found", "The session does not exist.");
    }
    return row.value;
  }

  /** 세션 메타를 접는다. threadId를 생략하면 모든 세션이다 */
  function indexOf(method: string, threadId: ThreadId | undefined): SessionMetaIndex {
    const events = readEvents(deps.session.feed, threadId, SESSION_META_EVENT_PREFIXES);
    if (!events.ok) throw storeFailure(method, events.error);
    return foldSessionMeta(events.value);
  }

  /** 모든 세션 행. `threads.list`는 오류 통로가 없어 읽을 수 없으면 빈 쪽을 돌려준다(L1 계약) */
  function allThreads(workspace: string | undefined): ThreadSummaryRow[] {
    const rows: ThreadSummaryRow[] = [];
    let cursor: string | null = null;
    do {
      const query: ThreadListQuery = {
        limit: THREAD_PAGE,
        ...(workspace === undefined ? {} : { workspace }),
        ...(cursor === null ? {} : { cursor }),
      };
      const page = deps.session.threads.list(query);
      rows.push(...page.threads);
      cursor = page.nextCursor;
    } while (cursor !== null);
    return rows;
  }

  function draftOf(
    threadId: ThreadId,
    turnId: TurnId | null,
    kind: EventKind,
    payload: JsonValue,
  ): StampedDraft {
    return deps.producer.draft({
      id: deps.ids.next("evt"),
      kind,
      threadId,
      turnId,
      stepId: null,
      causationId: null,
      correlationId: null,
      payload,
    });
  }

  /** 라벨 커밋의 결과를 성공 값으로 좁힌다. 거부와 키 재사용은 `internal`로 바꾸고 키 재사용은 기록한다 */
  function committedOrThrow(method: string, result: Result<CommitResult, StoreError>): void {
    if (!result.ok) throw storeFailure(method, result.error);
    const value = result.value;
    switch (value.status) {
      case "committed":
        return;
      case "rejected":
        throw reject(CAPABILITY, method, "internal", `The commit was rejected: ${value.code}.`);
      case "key_reused":
        deps.logger.error("artifacts.sessions_key_reused", { method });
        throw reject(
          CAPABILITY,
          method,
          "internal",
          "The request id was used for another request.",
        );
      default:
        return assertNever(value, "CommitResult");
    }
  }

  /** 제목 쓰기의 실패를 능력 거부로 바꾼다. 이 호출 경로에서 올 수 없는 종류는 `internal`이다 */
  function titleFailure(method: string, error: LifecycleError): CapabilityError {
    if (error.kind === "key_reused") {
      deps.logger.error("artifacts.sessions_key_reused", { method });
      return reject(CAPABILITY, method, "internal", "The request id was used for another request.");
    }
    if (error.kind === "thread_closed") {
      return reject(CAPABILITY, method, "unavailable", "The session is closed.");
    }
    if (error.kind === "not_owner") {
      return reject(CAPABILITY, method, "unavailable", "This process does not hold the session.");
    }
    if (
      error.kind === "turn_running" ||
      error.kind === "has_forks" ||
      error.kind === "invalid_target" ||
      error.kind === "cancelled_by_extension"
    ) {
      return reject(
        CAPABILITY,
        method,
        "internal",
        `The title change returned an unexpected ${error.kind}.`,
      );
    }
    return storeFailure(method, error);
  }

  const api: Api = {
    setMeta(input, options) {
      return settle(() => {
        const method = "setMeta";
        const scope = scopeOf(CAPABILITY, method, options, input.threadId);
        const requestId = requestIdOf(CAPABILITY, method, options);
        // 도구 경로는 모델이 낸 호출이라 다른 세션의 제목과 라벨을 바꾸지 못한다 (§3.5)
        if (
          isToolPath(options) &&
          input.threadId !== undefined &&
          input.threadId !== options?.context?.threadId
        ) {
          throw reject(CAPABILITY, method, "denied", "A tool call cannot change another session.");
        }
        const threadId = scope.threadId;
        rowOf(method, threadId);

        const current = indexOf(method, threadId).labels.get(threadId) ?? [];
        const labels =
          input.labels === undefined ? undefined : nextLabels(method, current, input.labels);
        if (labels !== undefined && labels.length > LABELS_MAX) {
          throw reject(CAPABILITY, method, "too_many_labels", "A session has at most 32 labels.");
        }
        if (
          input.title !== undefined &&
          (input.title.length === 0 || input.title.length > TITLE_MAX)
        ) {
          throw reject(CAPABILITY, method, "invalid_input", "The title is empty or too long.");
        }

        // 제목은 L1 제목 API로 쓴다. 같은 requestId의 재시도는 L1이 처음 결과를 돌려준다
        if (input.title !== undefined) {
          const titled = deps.session.threads.setTitle(
            threadId,
            input.title,
            `retitle:${commitKeyPart(requestId, sha256Hex)}`,
          );
          if (!titled.ok) throw titleFailure(method, titled.error);
        }

        // 라벨이 실제로 바뀔 때만 이벤트를 쓴다. 지문은 요청한 변경이라 같은 요청의 재시도가 같은 키로 맞는다
        if (labels !== undefined && !sameLabels(labels, current)) {
          const requested = input.labels;
          const turnId = scope.turnId;
          const result = deps.session.commit({
            threadId,
            requestId: `artifact:labels:${commitKeyPart(requestId, sha256Hex)}`,
            fingerprintSource: jsonOf({
              set: requested?.set ?? null,
              add: requested?.add ?? null,
              remove: requested?.remove ?? null,
            }),
            build: (): CommitPlan => ({
              kind: "append",
              drafts: [draftOf(threadId, turnId, "artifact.session_labeled", jsonOf({ labels }))],
              checkpoint: null,
            }),
          });
          committedOrThrow(method, result);
        }

        return viewOf(
          rowOf(method, threadId),
          indexOf(method, threadId),
          isToolPath(options) ? "model" : "user",
        );
      });
    },

    list(input, options) {
      return settle(() => {
        const method = "list";
        assertLive(CAPABILITY, method, options);
        const offset = cursorOffset(method, input.cursor);
        const limit = input.limit ?? LIST_DEFAULT_LIMIT;
        const wanted = labelFilter(method, input.labels);
        const index = indexOf(method, undefined);
        const sorted = allThreads(input.workspace)
          .map((row) => viewOf(row, index, "user"))
          .filter((view) => hasLabels(view.labels, wanted))
          .toSorted(byOrder(input.order ?? "updated"));
        const items = sorted.slice(offset, offset + limit);
        const nextCursor = offset + limit < sorted.length ? String(offset + limit) : null;
        return { items, nextCursor };
      });
    },

    search(input, options) {
      return settle(() => {
        const method = "search";
        assertLive(CAPABILITY, method, options);
        const needle = searchKey(input.query);
        if (needle.length === 0)
          throw reject(CAPABILITY, method, "invalid_input", "The query is empty.");
        const wanted = labelFilter(method, input.labels);
        const index = indexOf(method, undefined);
        const items = allThreads(undefined)
          .map((row) => viewOf(row, index, "user"))
          .filter((view) => matches(view, needle) && hasLabels(view.labels, wanted))
          .toSorted(byOrder("updated"))
          .slice(0, input.limit ?? SEARCH_DEFAULT_LIMIT);
        return { items };
      });
    },
  };

  return { api };
}
