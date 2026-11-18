import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bug, err, type Clock, type Logger, type LogFields, type Result } from "@fresnel/contracts";
import type { CallOptions } from "@fresnel/contracts/capabilities";
import {
  isId,
  type IdFactory,
  type ItemId,
  type ThreadId,
  type TurnId,
} from "@fresnel/contracts/conversation";
import type {
  BlobError,
  BlobRef,
  CommitRequest,
  CommitResult,
  DurableEventEnvelope,
  SessionService,
  StoreError,
} from "@fresnel/contracts/records";
import type { FileRewindService } from "@fresnel/contracts/services";
import { createSessionService } from "@fresnel/core-persistence";
import { openTestStore, TEST_HOLDER_A, type TestStore } from "@fresnel/platform-store/testing";
import type { WorkspaceDeps } from "../../src/deps.ts";
import { createRewindCapture } from "../../src/rewind/capture.ts";
import { DEFAULT_REWIND_LIMITS, type RewindLimits } from "../../src/rewind/limits.ts";
import { createFileRewindService } from "../../src/rewind/service.ts";
import { createRewindStore, type RewindBlobs, type RewindSession } from "../../src/rewind/store.ts";
import { createFilesApi } from "../../src/service.ts";
import { realDeps, realEnv } from "./real-env.ts";

// 파일 되감기 시험 조립. 실제 SQLite(platform-store/testing)와 실제 임시 폴더(실제 파일 시스템)를 쓴다.
// 커밋 실패와 blob 실패는 세션과 blob 포트를 감싸 주입한다. 시험 본문에는 `as`가 없다.

interface LogLine {
  readonly level: "warn" | "error";
  readonly event: string;
  readonly fields: LogFields | undefined;
}

interface Faults {
  /** 이 접두로 시작하는 커밋 키의 커밋을 `io` 오류로 실패시킨다. null이면 실패시키지 않는다 */
  commitPrefix: string | null;
  /** 참이면 blob 쓰기가 `disk_full`로 실패한다 */
  blobsFail: boolean;
}

export interface Rewind extends AsyncDisposable {
  /** 기본 작업 폴더(실제 경로, 정규 경로) */
  readonly folder: string;
  /** 시험이 끝나면 함께 지우는 임시 폴더를 하나 더 만든다 */
  makeFolder(): string;
  readonly session: SessionService;
  readonly store: TestStore;
  readonly ids: IdFactory;
  readonly logs: LogLine[];
  readonly faults: Faults;
  readonly service: FileRewindService;
  readonly deps: WorkspaceDeps;
  /** 새 대화. 작업 폴더를 주면 그 폴더를 쓴다 */
  newThread(folder?: string): ThreadId;
  /** 턴 식별자 */
  newTurn(): TurnId;
  /** 활성 가지에 사용자 항목을 하나 쌓는다. 되감기 목표로 쓴다 */
  seedUserItem(threadId: ThreadId, turnId: TurnId): ItemId;
  /** 셸 명령의 효과 의도(추적 밖 효과)를 쌓는다 */
  seedBashIntent(threadId: ThreadId, turnId: TurnId, itemId: ItemId, toolCallId: string): void;
  /** 도구 경로의 write 호출. 문맥에 대화와 턴을 싣는다 */
  write(
    threadId: ThreadId,
    turnId: TurnId,
    path: string,
    content: string,
  ): Promise<{ readonly bytes: number }>;
  /** 턴 문맥 없이 write를 부른다(캡처하지 않는 경로) */
  writeWithoutTurn(
    threadId: ThreadId,
    path: string,
    content: string,
  ): Promise<{ readonly bytes: number }>;
  edit(
    threadId: ThreadId,
    turnId: TurnId,
    path: string,
    oldText: string,
    newText: string,
  ): Promise<{ readonly applied: number }>;
  /** 대화의 워크스페이스 이벤트를 커밋 순서로 */
  events(threadId: ThreadId, prefix?: string): Promise<DurableEventEnvelope[]>;
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

/** 같은 시드와 같은 호출 순서면 같은 id를 낸다 */
function idFactory(seed: number): IdFactory {
  let counter = 0;
  return {
    next(prefix) {
      counter += 1;
      const value = `${prefix}_0${encode(seed, 5)}${encode(counter, 20)}`;
      if (!isId(prefix, value)) throw new Bug(`rewind harness made a bad id: ${value}`);
      return value;
    },
  };
}

function recordingLogger(lines: LogLine[]): Logger {
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (event, fields) => void lines.push({ level: "warn", event, fields }),
    error: (event, fields) => void lines.push({ level: "error", event, fields }),
    child: () => logger,
  };
  return logger;
}

function tempFolder(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "fresnel-rewind-")));
}

const T0 = 1_767_571_200_000;

/** 세션 포트를 감싼다. 커밋 실패 주입만 더한다. 나머지는 실제 세션이다 */
function faultySession(session: SessionService, faults: Faults): RewindSession {
  return {
    feed: session.feed,
    query: session.query,
    readBranch(threadId, leaf) {
      return session.readBranch(threadId, leaf);
    },
    commit(request: CommitRequest): Result<CommitResult, StoreError> {
      const prefix = faults.commitPrefix;
      if (prefix !== null && request.requestId.startsWith(prefix)) {
        return err({ kind: "io", code: "INJECTED" });
      }
      return session.commit(request);
    },
  };
}

export async function openRewind(
  options: { readonly limits?: RewindLimits } = {},
): Promise<Rewind> {
  let now = T0;
  const clock: Clock = { now: () => (now += 1) };
  const ids = idFactory(1);
  const store = await openTestStore({ clock, ids });
  const logs: LogLine[] = [];
  const logger = recordingLogger(logs);
  const created = createSessionService({
    db: store.root,
    leases: store.leases,
    migrations: store.service.migrations,
    readBlob: (ref) => store.service.readBlob(ref),
    putBlob: (bytes, mediaType) => store.service.putBlob(bytes, mediaType),
    clock,
    ids,
    logger,
    holder: TEST_HOLDER_A,
  });
  if (!created.ok) {
    await store[Symbol.asyncDispose]();
    throw new Bug("rewind harness could not create the session service", { cause: created.error });
  }
  const session = created.value;
  const folders: string[] = [];
  const folder = tempFolder();
  folders.push(folder);
  const faults: Faults = { commitPrefix: null, blobsFail: false };
  const blobs: RewindBlobs = {
    putBlob: (bytes: Uint8Array, mediaType: string | null): Result<BlobRef, BlobError> =>
      faults.blobsFail ? err({ kind: "disk_full" }) : store.service.putBlob(bytes, mediaType),
    readBlob: (ref) => store.service.readBlob(ref),
  };
  const rewindStore = createRewindStore({
    session: faultySession(session, faults),
    producer: session.producer("cap.workspace"),
    ids,
    blobs,
    logger,
    limits: options.limits ?? DEFAULT_REWIND_LIMITS,
  });
  const toolsProducer = session.producer("core.tools");
  const loop = session.producer("core.loop");

  const envs = new Map<string, ReturnType<typeof realEnv>>();
  function envFor(cwd: string): ReturnType<typeof realEnv> {
    const cached = envs.get(cwd);
    if (cached !== undefined) return cached;
    const made = realEnv(cwd);
    envs.set(cwd, made);
    return made;
  }
  const defaultEnv = envFor(folder);
  const base = realDeps(defaultEnv);
  const deps: WorkspaceDeps = {
    ...base,
    threads: {
      workspaceOf: (threadId) => {
        const row = session.query.thread(threadId);
        return row.ok ? (row.value?.workspace ?? null) : null;
      },
      envAt: (cwd) => envFor(cwd),
    },
    rewind: createRewindCapture(rewindStore),
  };
  const service = createFileRewindService(deps, rewindStore);
  const files = createFilesApi(deps);
  let counter = 0;

  function callOptions(
    threadId: ThreadId,
    turnId: TurnId | undefined,
    toolCallId: string,
  ): CallOptions {
    counter += 1;
    return {
      requestId: `req-${counter}`,
      context: {
        threadId,
        ...(turnId === undefined ? {} : { turnId }),
        toolCallId,
        caller: { kind: "model", agent: "main" },
      },
    };
  }

  function newThread(workspace?: string): ThreadId {
    const threadId = ids.next("thr");
    const made = session.threads.create({ threadId, workspace: workspace ?? folder });
    if (!made.ok) throw new Bug("rewind harness: thread create failed", { cause: made.error });
    const token = store.leases.acquire(`thread:${threadId}`, TEST_HOLDER_A);
    if (!token.ok) throw new Bug("rewind harness: lease failed", { cause: token.error });
    const opened = session.openForWrite(threadId, token.value);
    if (!opened.ok) throw new Bug("rewind harness: open failed", { cause: opened.error });
    return threadId;
  }

  function commitDraft(
    threadId: ThreadId,
    requestId: string,
    draft: ReturnType<typeof loop.draft>,
  ): void {
    const result = session.commit({
      threadId,
      requestId,
      fingerprintSource: { requestId },
      build: () => ({ kind: "append", drafts: [draft], checkpoint: null }),
    });
    if (!result.ok || result.value.status !== "committed") {
      throw new Bug("rewind harness: seed commit failed");
    }
  }

  const rewind: Rewind = {
    folder,
    makeFolder: () => {
      const dir = tempFolder();
      folders.push(dir);
      return dir;
    },
    session,
    store,
    ids,
    logs,
    faults,
    service,
    deps,
    newThread,
    newTurn: () => ids.next("trn"),
    seedUserItem(threadId, turnId) {
      const itemId = ids.next("itm");
      commitDraft(
        threadId,
        `seed:${itemId}`,
        loop.draft({
          id: ids.next("evt"),
          kind: "item.recorded",
          threadId,
          turnId,
          stepId: null,
          causationId: null,
          correlationId: null,
          payload: {
            item: {
              itemId,
              status: "completed",
              kind: "user",
              message: { role: "user", content: "seed", timestamp: 1 },
              requestId: null,
            },
          },
        }),
      );
      return itemId;
    },
    seedBashIntent(threadId, turnId, itemId, toolCallId) {
      const effectId = ids.next("efx");
      commitDraft(
        threadId,
        `seed:${effectId}`,
        toolsProducer.draft({
          id: ids.next("evt"),
          kind: "effect.intent",
          threadId,
          turnId,
          stepId: null,
          causationId: null,
          correlationId: null,
          payload: {
            effectId,
            toolCallId,
            toolName: "bash",
            itemId,
            argsHash: "0".repeat(64),
            args: { command: "echo seeded" },
            replay: "unsafe",
            idempotencyKey: null,
          },
        }),
      );
    },
    async write(threadId, turnId, path, content) {
      const out = await files.write(
        { path, content },
        callOptions(threadId, turnId, `tc-${counter + 1}`),
      );
      return { bytes: out.bytes };
    },
    async writeWithoutTurn(threadId, path, content) {
      const out = await files.write(
        { path, content },
        callOptions(threadId, undefined, `tc-${counter + 1}`),
      );
      return { bytes: out.bytes };
    },
    async edit(threadId, turnId, path, oldText, newText) {
      const out = await files.edit(
        { path, edits: [{ oldText, newText }] },
        callOptions(threadId, turnId, `tc-${counter + 1}`),
      );
      return { applied: out.applied };
    },
    async events(threadId, prefix) {
      const out: DurableEventEnvelope[] = [];
      for await (const item of session.readFrom(0, { threadId })) {
        if (!item.ok) throw new Bug("rewind harness: event read failed", { cause: item.error });
        if (prefix === undefined || item.value.kind.startsWith(prefix)) out.push(item.value);
      }
      return out;
    },
    async [Symbol.asyncDispose]() {
      await store[Symbol.asyncDispose]();
      for (const dir of folders) rmSync(dir, { recursive: true, force: true });
    },
  };
  return rewind;
}
