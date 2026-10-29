// 실제 SQLite(platform-store) 위에 core-persistence 세션 서비스를 올리고 리뷰 서비스(createReviews)를 붙이는 시험 조립.
// 포트는 test/support/ports.ts의 대역이다. 저장소를 배열로 흉내 내지 않는다(eng.testing.guide TS-07).
import { Bug, type Clock, type Logger, type LogFields } from "@xeon/contracts";
import type { CallerInfo, CallOptions } from "@xeon/contracts/capabilities";
import {
  isId,
  isLocalId,
  type ApprovalId,
  type IdFactory,
  type LocalId,
  type LocalIdFactory,
  type LocalIdPrefix,
  type ThreadId,
  type TurnId,
} from "@xeon/contracts/conversation";
import type {
  ApprovalResolvedPayload,
  CommitRequest,
  DurableEventEnvelope,
  SessionService,
} from "@xeon/contracts/records";
import { createSessionService } from "@xeon/core-persistence";
import { openTestStore, TEST_HOLDER_A, type TestStore } from "@xeon/platform-store/testing";
import { REVIEWS_PRODUCER } from "../../src/reviews/kernel.ts";
import {
  createRegistry,
  type RegistryRuntime,
  type RegistrySettings,
} from "../../src/registry/service.ts";
import { createReviews, type ReviewsRuntime } from "../../src/reviews/service.ts";
import {
  fakeApprovals,
  fakeFiles,
  fakeGuard,
  fakeQueue,
  type FakeApprovals,
  type FakeFiles,
  type FakeGuard,
  type FakeQueue,
} from "./ports.ts";

interface LogLine {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly event: string;
  readonly fields: LogFields | undefined;
}

/** 리뷰 서비스가 낸 커밋 하나의 seq 범위. 범위의 이벤트 종류는 `eventKindsIn`으로 읽는다 */
interface CommitRecord {
  readonly requestId: string;
  readonly firstSeq: number;
  readonly lastSeq: number;
}

interface SeedToolResult {
  readonly turnId: TurnId;
  readonly toolCallId: string;
  readonly path: string;
  readonly diff: string;
  /** 오류 결과면 수집하지 않는다 */
  readonly isError?: boolean;
}

export interface ReviewsHarness extends AsyncDisposable {
  readonly ids: IdFactory;
  readonly localIds: LocalIdFactory;
  readonly store: TestStore;
  readonly session: SessionService;
  readonly threadId: ThreadId;
  readonly runtime: ReviewsRuntime;
  readonly api: ReviewsRuntime["api"];
  readonly files: FakeFiles;
  readonly guard: FakeGuard;
  readonly queue: FakeQueue;
  readonly approvals: FakeApprovals;
  readonly logs: LogLine[];
  /** 리뷰 서비스가 넘긴 커밋 중 성공한 것 */
  readonly commits: CommitRecord[];
  /** 쓰기 호출 옵션. 턴을 주면 호출 문맥에 싣는다. requestId를 생략하면 호출마다 새 값을 만든다 */
  opts(requestId?: string, turnId?: TurnId): CallOptions;
  /** 내구 이벤트를 커밋 순서로 읽는다. prefix를 주면 그 접두의 종류만 */
  events(prefix?: string): Promise<DurableEventEnvelope[]>;
  /** seq 범위(양 끝 포함) 안의 이벤트 종류, 커밋 순서 */
  eventKindsIn(firstSeq: number, lastSeq: number): Promise<string[]>;
  /** 한 턴의 도구 결과(item.recorded toolResult)를 남긴다. details는 FileChange 모양이다 */
  seedToolResult(input: SeedToolResult): void;
  /** 승인 해결 이벤트(approval.resolved) 봉투. 응답 모양은 호출자가 정한다 */
  resolvedEvent(
    approvalId: ApprovalId,
    decision: ApprovalResolvedPayload["decision"],
    answer: unknown,
    resolvedBy?: ApprovalResolvedPayload["resolvedBy"],
  ): DurableEventEnvelope;
}

const T0 = 1_767_571_200_000;

function recordingLogger(lines: LogLine[]): Logger {
  const logger: Logger = {
    debug: (event, fields) => void lines.push({ level: "debug", event, fields }),
    info: (event, fields) => void lines.push({ level: "info", event, fields }),
    warn: (event, fields) => void lines.push({ level: "warn", event, fields }),
    error: (event, fields) => void lines.push({ level: "error", event, fields }),
    child: () => logger,
  };
  return logger;
}

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encode(value: number, length: number): string {
  let rest = value;
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out = ALPHABET.charAt(rest % 32) + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

/** 같은 시드와 같은 호출 순서면 같은 ID를 낸다. 시계를 읽지 않는다 */
export function fixedIds(seed: number): IdFactory {
  let counter = 0;
  return {
    next(prefix) {
      counter += 1;
      const value = `${prefix}_0${encode(seed, 5)}${encode(counter, 20)}`;
      if (!isId(prefix, value)) throw new Bug(`harness made a bad id: ${value}`);
      return value;
    },
  };
}

export function fixedLocalIds(seed: number): LocalIdFactory {
  let counter = 0;
  return {
    next<P extends LocalIdPrefix>(prefix: P): LocalId<P> {
      counter += 1;
      const value = `${prefix}_0${encode(seed, 5)}${encode(counter, 20)}`;
      if (!isLocalId(prefix, value)) throw new Bug(`harness made a bad local id: ${value}`);
      return value;
    },
  };
}

interface Boot {
  readonly clock: Clock;
  /** 시계를 앞으로 민다. 기본 시계는 T0에 멈춰 있다 */
  readonly advance: (ms: number) => void;
  readonly ids: IdFactory;
  readonly localIds: LocalIdFactory;
  readonly store: TestStore;
  readonly session: SessionService;
  readonly logs: LogLine[];
}

/** 저장소와 세션 서비스를 연다. 실패하면 저장소를 닫고 던진다 */
async function bootSession(): Promise<Boot> {
  let now = T0;
  const clock: Clock = { now: () => now };
  const ids = fixedIds(1);
  const localIds = fixedLocalIds(1);
  const store = await openTestStore({ clock, ids });
  const logs: LogLine[] = [];
  const created = createSessionService({
    db: store.root,
    leases: store.leases,
    migrations: store.service.migrations,
    readBlob: (ref) => store.service.readBlob(ref),
    putBlob: (bytes, mediaType) => store.service.putBlob(bytes, mediaType),
    clock,
    ids,
    logger: recordingLogger(logs),
    holder: TEST_HOLDER_A,
  });
  if (!created.ok) {
    await store[Symbol.asyncDispose]();
    throw new Bug("harness could not create the session service", { cause: created.error });
  }
  return {
    clock,
    advance: (ms) => {
      now += ms;
    },
    ids,
    localIds,
    store,
    session: created.value,
    logs,
  };
}

/** 새 대화를 만들고 이 시험이 쓰기 자격을 쥔다 */
function createWriteThread({
  ids,
  store,
  session,
}: Pick<Boot, "ids" | "store" | "session">): ThreadId {
  const threadId = ids.next("thr");
  const made = session.threads.create({ threadId });
  if (!made.ok) throw new Bug("harness: thread create failed", { cause: made.error });
  const token = store.leases.acquire(`session:${threadId}`, TEST_HOLDER_A);
  if (!token.ok) throw new Bug("harness: lease failed", { cause: token.error });
  const opened = session.openForWrite(threadId, token.value);
  if (!opened.ok) throw new Bug("harness: open failed", { cause: opened.error });
  return threadId;
}

/** 리뷰 시험용 조립. 파일 내용(경로 → 텍스트)을 주면 그 파일들이 작업 공간에 있다 */
export async function openReviews(
  initialFiles: Readonly<Record<string, string>> = {},
): Promise<ReviewsHarness> {
  const { ids, localIds, store, session, logs } = await bootSession();
  const threadId = createWriteThread({ ids, store, session });

  const commits: CommitRecord[] = [];
  const files = fakeFiles(initialFiles);
  const guard = fakeGuard();
  const queue = fakeQueue();
  const approvals = fakeApprovals(() => ids.next("evt"));
  const loop = session.producer("core.loop");
  // 리뷰 서비스에는 성공한 커밋만 기록하는 얇은 감싸기를 준다. 저장은 실제 세션이 한다
  const recordingSession = {
    feed: session.feed,
    commit(request: CommitRequest) {
      const result = session.commit(request);
      if (result.ok && result.value.status === "committed") {
        commits.push({
          requestId: request.requestId,
          firstSeq: result.value.firstSeq,
          lastSeq: result.value.lastSeq,
        });
      }
      return result;
    },
  };
  const runtime = createReviews({
    session: recordingSession,
    producer: session.producer(REVIEWS_PRODUCER),
    ids,
    localIds,
    blobs: store.service,
    files,
    guard,
    approvals,
    queue,
    logger: recordingLogger(logs),
    settings: () => ({ deliverAs: "followUp" }),
  });

  let counter = 0;
  return {
    ids,
    localIds,
    store,
    session,
    threadId,
    runtime,
    api: runtime.api,
    files,
    guard,
    queue,
    approvals,
    logs,
    commits,
    opts(requestId, turnId) {
      counter += 1;
      return {
        requestId: requestId ?? `req-${counter}`,
        context: {
          threadId,
          ...(turnId === undefined ? {} : { turnId }),
          caller: { kind: "model", agent: "main" },
        },
      };
    },
    async events(prefix) {
      const out: DurableEventEnvelope[] = [];
      for await (const item of session.readFrom(0, { threadId })) {
        if (!item.ok) throw new Bug("harness: event read failed", { cause: item.error });
        if (prefix === undefined || item.value.kind.startsWith(prefix)) out.push(item.value);
      }
      return out;
    },
    async eventKindsIn(firstSeq, lastSeq) {
      const kinds: string[] = [];
      for await (const item of session.readFrom(firstSeq - 1, { threadId })) {
        if (!item.ok) throw new Bug("harness: event read failed", { cause: item.error });
        if (item.value.seq > lastSeq) break;
        kinds.push(item.value.kind);
      }
      return kinds;
    },
    seedToolResult(input) {
      const { turnId, toolCallId, path, diff } = input;
      const lines = diff.split("\n");
      const added = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
      const removed = lines.filter(
        (line) => line.startsWith("-") && !line.startsWith("---"),
      ).length;
      const draft = loop.draft({
        id: ids.next("evt"),
        kind: "item.recorded",
        threadId,
        turnId,
        stepId: null,
        causationId: null,
        correlationId: null,
        payload: {
          item: {
            itemId: ids.next("itm"),
            status: "completed",
            kind: "toolResult",
            message: {
              role: "toolResult",
              toolCallId,
              toolName: "edit",
              content: [{ type: "text", text: "ok" }],
              details: { path, existed: true, diff, added, removed },
              isError: input.isError === true,
              timestamp: T0,
            },
            effectId: null,
          },
        },
      });
      const committed = session.commit({
        threadId,
        requestId: `item:${toolCallId}`,
        fingerprintSource: { toolCallId },
        build: () => ({ kind: "append", drafts: [draft], checkpoint: null }),
      });
      if (!committed.ok || committed.value.status !== "committed") {
        throw new Bug("harness: seeding a tool result failed", { cause: committed });
      }
    },
    resolvedEvent(approvalId, decision, answer, resolvedBy = "user") {
      return {
        id: ids.next("evt"),
        kind: "approval.resolved",
        version: 1,
        threadId,
        turnId: null,
        stepId: null,
        recordedAt: T0,
        causationId: null,
        correlationId: null,
        payload: {
          approvalId,
          decision,
          answer,
          remember: "once",
          requestedRemember: null,
          resolvedBy,
        },
        durable: true,
        seq: 1,
        parentId: null,
      };
    },
    async [Symbol.asyncDispose]() {
      await store[Symbol.asyncDispose]();
    },
  };
}

export interface RegistryHarness extends AsyncDisposable {
  readonly ids: IdFactory;
  readonly localIds: LocalIdFactory;
  readonly store: TestStore;
  readonly session: SessionService;
  /** 처음 만든 대화. 쓰기 호출의 기본 문맥이다 */
  readonly threadId: ThreadId;
  readonly api: RegistryRuntime["api"];
  /** 호출마다 읽는 상한. 시험이 바꾸면 다음 호출부터 적용된다 */
  readonly limits: RegistrySettings;
  readonly logs: LogLine[];
  /** 시계를 앞으로 민다(밀리초). 이후 이벤트의 recordedAt이 커진다 */
  advance(ms: number): void;
  /** 같은 저장소에 새 대화를 만들고 쓰기 자격을 쥔다 */
  newThread(): ThreadId;
  /**
   * 호출 옵션. requestId를 생략하면 호출마다 새 값을 만든다. `contextThread`는 호출 문맥의 대화,
   * `turnId`와 `toolCallId`를 주면 그 문맥을 싣는다(도구 경로는 `toolCallId`가 있다)
   */
  opts(
    requestId?: string,
    extra?: {
      readonly contextThread?: ThreadId;
      readonly turnId?: TurnId;
      readonly toolCallId?: string;
      readonly caller?: CallerInfo;
    },
  ): CallOptions;
  /** 한 대화의 내구 이벤트를 커밋 순서로 읽는다. prefix를 주면 그 접두의 종류만 */
  events(threadId: ThreadId, prefix?: string): Promise<DurableEventEnvelope[]>;
}

/** 산출물 레지스트리 시험용 조립. 리뷰와 같은 저장소 위에 `createRegistry`를 붙인다 */
export async function openRegistry(
  limits: RegistrySettings = { maxPerSession: 500, maxContentBytes: 26214400 },
): Promise<RegistryHarness> {
  const { advance, ids, localIds, store, session, logs } = await bootSession();
  const threadId = createWriteThread({ ids, store, session });
  const runtime = createRegistry({
    session,
    producer: session.producer(REVIEWS_PRODUCER),
    ids,
    localIds,
    blobs: store.service,
    logger: recordingLogger(logs),
    settings: () => limits,
  });

  let counter = 0;
  return {
    ids,
    localIds,
    store,
    session,
    threadId,
    api: runtime.api,
    limits,
    logs,
    advance,
    newThread() {
      return createWriteThread({ ids, store, session });
    },
    opts(requestId, extra) {
      counter += 1;
      return {
        requestId: requestId ?? `req-${counter}`,
        context: {
          threadId: extra?.contextThread ?? threadId,
          ...(extra?.turnId === undefined ? {} : { turnId: extra.turnId }),
          ...(extra?.toolCallId === undefined ? {} : { toolCallId: extra.toolCallId }),
          caller: extra?.caller ?? { kind: "model", agent: "main" },
        },
      };
    },
    async events(target, prefix) {
      const out: DurableEventEnvelope[] = [];
      for await (const item of session.readFrom(0, { threadId: target })) {
        if (!item.ok) throw new Bug("harness: event read failed", { cause: item.error });
        if (prefix === undefined || item.value.kind.startsWith(prefix)) out.push(item.value);
      }
      return out;
    },
    async [Symbol.asyncDispose]() {
      await store[Symbol.asyncDispose]();
    },
  };
}
