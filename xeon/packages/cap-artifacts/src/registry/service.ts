import { assertNever, parse, type Logger, type Result } from "@xeon/contracts";
import {
  ArtifactsRegistry,
  type ArtifactSummary,
  type CallContext,
  type CallOptions,
  type CapabilityApi,
} from "@xeon/contracts/capabilities";
import {
  toJsonValue,
  type IdFactory,
  type JsonValue,
  type LocalIdFactory,
  type ThreadId,
  type TurnId,
} from "@xeon/contracts/conversation";
import {
  ArtifactRegisteredPayloadSchema,
  ArtifactUpdatedPayloadSchema,
  commitKeyPart,
  type ArtifactRegisteredPayload,
  type ArtifactUpdatedPayload,
  type BlobRef,
  type CommitPlan,
  type CommitResult,
  type DurableEventEnvelope,
  type EventFeed,
  type EventKind,
  type ProducerHandle,
  type ReadFailure,
  type SessionService,
  type StampedDraft,
  type StoreError,
  type StoreService,
} from "@xeon/contracts/records";
import { sha256Hex } from "../hash.ts";
import { assertLive, requestIdOf, scopeOf } from "../call.ts";
import { reject } from "../errors.ts";
import { readEvents } from "../reviews/collect.ts";
import {
  blobFailure,
  decodeText,
  isTextual,
  materialize,
  metaForRegister,
  metaForUpdate,
  metaJsonOf,
  type Stored,
} from "./content.ts";
import {
  foldArtifacts,
  latestOf,
  latestSummaryOf,
  REGISTRY_EVENT_PREFIXES,
  summaryOf,
  type ArtifactState,
  type ArtifactStates,
} from "./state.ts";

// L2.artifacts.spec §3.2, §4.1. artifacts.registry 서비스. 상태는 이벤트를 접어 얻고(state.ts), 쓰기는 커밋 하나다.
// 커밋 밖에서 하는 검사는 입력과 본문에 관한 것뿐이다. 버전 충돌, 보관 검사, 상한은 커밋 build 안에서 거부 계획으로 한다.
// 그래야 같은 requestId의 재시도가 처음 결과를 돌려주고 새 이벤트를 만들지 않는다(§4.1.3).

const CAPABILITY = ArtifactsRegistry.id;
/** `get`이 본문을 싣는 상한(§3.2) */
const TEXT_MAX_BYTES = 256 * 1024;
const LIST_DEFAULT_LIMIT = 50;

type Api = CapabilityApi<typeof ArtifactsRegistry>;
type Committed = Extract<CommitResult, { readonly status: "committed" }>;

/** 산출물 서비스가 읽는 설정. 호출마다 그 스레드의 값으로 읽는다 */
export interface RegistrySettings {
  readonly maxPerSession: number;
  readonly maxContentBytes: number;
}

export interface RegistryDeps {
  readonly session: Pick<SessionService, "commit" | "feed">;
  /** 리뷰와 같은 생산자 핸들이다(claim은 한 번만) */
  readonly producer: ProducerHandle;
  readonly ids: IdFactory;
  readonly localIds: LocalIdFactory;
  readonly blobs: Pick<StoreService, "putBlob" | "readBlob">;
  readonly logger: Logger;
  readonly settings: (threadId: ThreadId) => RegistrySettings;
}

export interface RegistryRuntime {
  readonly api: Api;
}

/** 읽기나 커밋이 실패하면 `unavailable`이다. busy만 다시 시도할 수 있다 */
function storeFailure(method: string, error: StoreError | ReadFailure): Error {
  if (error.kind === "thread_not_found") {
    return reject(CAPABILITY, method, "not_found", "The session does not exist.");
  }
  return reject(CAPABILITY, method, "unavailable", `The store failed: ${error.kind}.`, {
    retryable: error.kind === "busy",
  });
}

function jsonOf(value: unknown): JsonValue {
  const converted = toJsonValue(value);
  if (converted === undefined) throw new Error("the registry built a value that is not JSON");
  return converted;
}

/** 도구 경로: 모델이 낸 호출이라 `toolCallId`가 있다 */
function isToolPath(options: CallOptions | undefined): boolean {
  return options?.context?.toolCallId !== undefined;
}

function commitKeyOf(tag: "reg" | "upd" | "arc", requestId: string): string {
  return ["artifact", tag, commitKeyPart(requestId, sha256Hex)].join(":");
}

/** 생산자: 입력이 주면 그 값, 아니면 호출자가 모델이면 "model", 그 밖이면 "cap.artifacts"(§3.2) */
function producerOf(context: CallContext | undefined, given: string | undefined): string {
  if (given !== undefined) return given;
  return context?.caller.kind === "model" ? "model" : "cap.artifacts";
}

function cursorOffset(method: string, cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  if (!/^(0|[1-9][0-9]{0,8})$/.test(cursor)) {
    throw reject(CAPABILITY, method, "invalid_input", "The cursor is malformed.");
  }
  return Number(cursor);
}

/** 최근 갱신 순, 같은 시각이면 산출물 id 순 */
function newestFirst(a: ArtifactState, b: ArtifactState): number {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  if (a.artifactId < b.artifactId) return -1;
  return a.artifactId > b.artifactId ? 1 : 0;
}

/** 커밋한 순서 범위에서 한 종류의 이벤트를 읽는다. 같은 requestId의 재시도는 처음 커밋의 범위를 돌려받는다 */
function committedEvents(
  method: string,
  feed: Pick<EventFeed, "read">,
  threadId: ThreadId,
  committed: Committed,
  kind: EventKind,
): readonly DurableEventEnvelope[] {
  const span = committed.lastSeq - committed.firstSeq + 1;
  const read = feed.read(
    committed.firstSeq - 1,
    committed.lastSeq,
    { threadIds: [threadId], kindPrefixes: [kind] },
    span,
    span,
  );
  if (!read.ok) throw storeFailure(method, read.error);
  return read.value.events;
}

/** 메서드 본문을 Promise로 감싼다. 던진 오류는 거부가 된다(서비스 메서드는 거부로 실패를 알린다) */
function settle<T>(work: () => T | Promise<T>): Promise<T> {
  return new Promise<T>((resolve) => {
    resolve(work());
  });
}

export function createRegistry(deps: RegistryDeps): RegistryRuntime {
  const locks = new Map<string, Promise<unknown>>();

  /** 같은 키의 연산을 줄 세운다(리뷰의 withLock과 같은 규칙) */
  function withLock<T>(key: string, work: () => T | Promise<T>): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    const next = previous.then(work, work);
    const release = (): undefined => {
      if (locks.get(key) === tail) locks.delete(key);
      return undefined;
    };
    const tail: Promise<undefined> = next.then(release, release);
    locks.set(key, tail);
    return next;
  }

  /** 산출물 상태를 접는다. threadId를 생략하면 모든 세션이다 */
  function loadStates(method: string, threadId: ThreadId | undefined): ArtifactStates {
    const events = readEvents(deps.session.feed, threadId, REGISTRY_EVENT_PREFIXES);
    if (!events.ok) throw storeFailure(method, events.error);
    return foldArtifacts(events.value);
  }

  function stateOf(method: string, artifactId: string): ArtifactState {
    const state = loadStates(method, undefined).get(artifactId);
    if (state === undefined) {
      throw reject(CAPABILITY, method, "not_found", `Artifact ${artifactId} does not exist.`);
    }
    return state;
  }

  function countRegistered(method: string, threadId: ThreadId): number {
    const events = readEvents(deps.session.feed, threadId, ["artifact.registered"]);
    if (!events.ok) throw storeFailure(method, events.error);
    return events.value.length;
  }

  /** 커밋한 뒤 다시 읽어 돌려줄 요약. 버전을 생략하면 최신이다 */
  function summaryAfter(
    method: string,
    threadId: ThreadId,
    artifactId: string,
    version: number | undefined,
  ): ArtifactSummary {
    const state = loadStates(method, threadId).get(artifactId);
    const picked =
      state === undefined
        ? undefined
        : version === undefined
          ? latestOf(state)
          : state.versions.find((candidate) => candidate.version === version);
    if (state === undefined || picked === undefined) {
      throw reject(CAPABILITY, method, "internal", "The committed artifact cannot be read back.");
    }
    return summaryOf(state, picked);
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

  /** 커밋 결과를 성공 값으로 좁힌다. 거부와 키 재사용은 오류로 바꾼다. 호출자가 풀 거부는 호출자가 먼저 본다 */
  function committedOrThrow(method: string, result: Result<CommitResult, StoreError>): Committed {
    if (!result.ok) throw storeFailure(method, result.error);
    const value = result.value;
    switch (value.status) {
      case "committed":
        return value;
      case "rejected":
        if (value.code === "artifact_limit_reached") {
          throw reject(
            CAPABILITY,
            method,
            "artifact_limit_reached",
            "The session has reached its artifact limit.",
          );
        }
        throw reject(CAPABILITY, method, "internal", `The commit was rejected: ${value.code}.`);
      case "key_reused":
        deps.logger.error("artifacts.registry_key_reused", { method });
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

  const api: Api = {
    register(input, options) {
      return settle(() => {
        const method = "register";
        const scope = scopeOf(CAPABILITY, method, options, input.threadId);
        const requestId = requestIdOf(CAPABILITY, method, options);
        if (
          isToolPath(options) &&
          input.threadId !== undefined &&
          input.threadId !== scope.context?.threadId
        ) {
          throw reject(
            CAPABILITY,
            method,
            "denied",
            "A tool call cannot register into another session.",
          );
        }
        const threadId = scope.threadId;
        const settings = deps.settings(threadId);
        return withLock(`thread:${threadId}`, () => {
          const stored: Stored = materialize(
            method,
            deps.blobs,
            input.content,
            settings.maxContentBytes,
          );
          const metaJson = metaJsonOf(method, metaForRegister(input, stored));
          const producer = producerOf(scope.context, input.producer);
          const turnId = scope.turnId;
          const toolCallId = scope.context?.toolCallId ?? null;
          const artifactId = deps.localIds.next("art");
          const count = countRegistered(method, threadId);
          const result = deps.session.commit({
            threadId,
            requestId: commitKeyOf("reg", requestId),
            fingerprintSource: jsonOf({
              kind: input.kind,
              title: input.title,
              content: stored.content,
              meta: metaJson,
              producer,
              turnId,
              toolCallId,
            }),
            build: (): CommitPlan => {
              if (count >= settings.maxPerSession) {
                return { kind: "reject", code: "artifact_limit_reached", detail: null };
              }
              const payload: ArtifactRegisteredPayload = {
                artifactId,
                kind: input.kind,
                title: input.title,
                version: 1,
                content: stored.content,
                sourcePath: null,
                meta: metaJson,
                turnId,
                toolCallId,
                producer,
              };
              return {
                kind: "append",
                drafts: [draftOf(threadId, turnId, "artifact.registered", jsonOf(payload))],
                checkpoint: null,
              };
            },
          });
          const committed = committedOrThrow(method, result);
          const [event] = committedEvents(
            method,
            deps.session.feed,
            threadId,
            committed,
            "artifact.registered",
          );
          const payload =
            event === undefined ? undefined : parse(ArtifactRegisteredPayloadSchema, event.payload);
          if (payload === undefined || !payload.ok) {
            throw reject(
              CAPABILITY,
              method,
              "internal",
              "The committed registration cannot be read back.",
            );
          }
          return summaryAfter(method, threadId, payload.value.artifactId, 1);
        });
      });
    },

    update(input, options) {
      return settle(() => {
        const method = "update";
        assertLive(CAPABILITY, method, options);
        const requestId = requestIdOf(CAPABILITY, method, options);
        return withLock(`artifact:${input.artifactId}`, () => {
          const state = stateOf(method, input.artifactId);
          if (isToolPath(options) && options?.context?.threadId !== state.threadId) {
            throw reject(
              CAPABILITY,
              method,
              "denied",
              "A tool call cannot change another session's artifact.",
            );
          }
          const latest = latestOf(state);
          if (latest === undefined)
            throw reject(CAPABILITY, method, "internal", "The artifact has no version.");
          const settings = deps.settings(state.threadId);
          const stored =
            input.content === undefined
              ? undefined
              : materialize(method, deps.blobs, input.content, settings.maxContentBytes);
          const meta = metaForUpdate(latest.meta, input.meta, isToolPath(options), stored);
          const metaJson = meta === undefined ? null : metaJsonOf(method, meta);
          const title = input.title ?? null;
          const contentRef: BlobRef | null = stored?.content ?? null;
          const turnId = options?.context?.turnId ?? null;
          const result = deps.session.commit({
            threadId: state.threadId,
            requestId: commitKeyOf("upd", requestId),
            fingerprintSource: jsonOf({
              artifactId: input.artifactId,
              baseVersion: input.baseVersion,
              title,
              content: contentRef,
              meta: metaJson,
            }),
            build: (): CommitPlan => {
              if (state.status === "archived") {
                return { kind: "reject", code: "artifact_archived", detail: null };
              }
              if (input.baseVersion !== latest.version) {
                return { kind: "reject", code: "version_conflict", detail: null };
              }
              const payload: ArtifactUpdatedPayload = {
                artifactId: input.artifactId,
                version: latest.version + 1,
                baseVersion: input.baseVersion,
                title,
                content: contentRef,
                sourcePath: null,
                meta: metaJson,
              };
              return {
                kind: "append",
                drafts: [draftOf(state.threadId, turnId, "artifact.updated", jsonOf(payload))],
                checkpoint: null,
              };
            },
          });
          if (result.ok && result.value.status === "rejected") {
            if (result.value.code === "artifact_archived") {
              throw reject(CAPABILITY, method, "artifact_archived", "The artifact is archived.");
            }
            if (result.value.code === "version_conflict") {
              const now = latestOf(stateOf(method, input.artifactId));
              throw reject(
                CAPABILITY,
                method,
                "version_conflict",
                "The base version is not the latest.",
                {
                  detail: { latestVersion: now?.version ?? latest.version },
                },
              );
            }
          }
          const committed = committedOrThrow(method, result);
          const [event] = committedEvents(
            method,
            deps.session.feed,
            state.threadId,
            committed,
            "artifact.updated",
          );
          const payload =
            event === undefined ? undefined : parse(ArtifactUpdatedPayloadSchema, event.payload);
          if (payload === undefined || !payload.ok) {
            throw reject(
              CAPABILITY,
              method,
              "internal",
              "The committed update cannot be read back.",
            );
          }
          // 재시도면 처음 커밋이 만든 버전을 돌려준다
          return summaryAfter(method, state.threadId, input.artifactId, payload.value.version);
        });
      });
    },

    list(input, options) {
      return settle(() => {
        const method = "list";
        assertLive(CAPABILITY, method, options);
        const offset = cursorOffset(method, input.cursor);
        const limit = input.limit ?? LIST_DEFAULT_LIMIT;
        const status = input.status ?? "active";
        const matched = [...loadStates(method, input.threadId).values()]
          .filter((state) => status === "all" || state.status === status)
          .filter((state) => input.kinds === undefined || input.kinds.includes(state.kind))
          .filter((state) => input.turnId === undefined || state.origin.turnId === input.turnId)
          .toSorted(newestFirst);
        const items = matched.slice(offset, offset + limit).map((state) => latestSummaryOf(state));
        const nextCursor = offset + limit < matched.length ? String(offset + limit) : null;
        return { items, nextCursor };
      });
    },

    get(input, options) {
      return settle(() => {
        const method = "get";
        assertLive(CAPABILITY, method, options);
        const state = stateOf(method, input.artifactId);
        const latest = latestOf(state);
        const picked =
          input.version === undefined
            ? latest
            : state.versions.find((candidate) => candidate.version === input.version);
        if (latest === undefined || picked === undefined) {
          throw reject(CAPABILITY, method, "not_found", "The artifact has no such version.");
        }
        return {
          artifact: summaryOf(state, picked),
          latestVersion: latest.version,
          text: input.includeText === true ? textOf(method, picked.content) : null,
        };
      });
    },

    archive(input, options) {
      return settle(() => {
        const method = "archive";
        assertLive(CAPABILITY, method, options);
        const requestId = requestIdOf(CAPABILITY, method, options);
        return withLock(`artifact:${input.artifactId}`, () => {
          const state = stateOf(method, input.artifactId);
          // 이미 보관됐으면 이벤트를 더하지 않고 현재 요약을 돌려준다
          if (state.status === "archived") return latestSummaryOf(state);
          const payload = jsonOf({ artifactId: input.artifactId, reason: input.reason ?? "user" });
          const turnId = options?.context?.turnId ?? null;
          const result = deps.session.commit({
            threadId: state.threadId,
            requestId: commitKeyOf("arc", requestId),
            fingerprintSource: payload,
            build: (): CommitPlan => ({
              kind: "append",
              drafts: [draftOf(state.threadId, turnId, "artifact.archived", payload)],
              checkpoint: null,
            }),
          });
          committedOrThrow(method, result);
          return summaryAfter(method, state.threadId, input.artifactId, undefined);
        });
      });
    },
  };

  /** 텍스트 본문을 싣는다. 텍스트가 아니거나 256 KiB를 넘으면 없다 */
  function textOf(method: string, content: BlobRef): string | null {
    if (!isTextual(content.mediaType) || content.size > TEXT_MAX_BYTES) return null;
    const read = deps.blobs.readBlob(content);
    if (!read.ok) throw blobFailure(method, read.error);
    return decodeText(read.value);
  }

  return { api };
}
