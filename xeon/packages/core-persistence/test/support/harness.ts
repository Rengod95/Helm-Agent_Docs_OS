// 테스트 조립: 실제 SQLite 위에 SessionService를 올리고, L1 동료(loop, tools, tasks)가 하는 커밋을 흉내 내는 도우미.
// 커밋 지점 이름(C1~X1)은 L1.persistence.spec §4.2를 따른다.
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bug, err, ok, type Logger, type Result } from "@xeon/contracts";
import type {
  EffectId,
  EventId,
  IdFactory,
  ItemId,
  StepId,
  ThreadId,
  TurnId,
} from "@xeon/contracts/conversation";
import {
  commitKeyPart,
  type CommitPlan,
  type CommitRequest,
  type CommitResult,
  type DraftInput,
  type FaultInjector,
  type LeaseToken,
  type ProducerHandle,
  type ReplayPolicy,
  type SessionService,
  type StepCheckpointInput,
  type StoreError,
  type StampedDraft,
  type TxView,
} from "@xeon/contracts/records";
import {
  createSessionService,
  type PersistenceSettings,
  type SessionDeps,
} from "../../src/index.ts";
import { sha256Hex } from "../../src/hash.ts";
import { manualClock, fixedIdFactory, type ManualClock } from "./clock.ts";
import { openTestStore, TEST_HOLDER_A, type TestStore } from "./sqlite-store.ts";

/** 도구 효과 커밋 키의 toolCallId 부분. 운영 생산자와 같은 F 함수를 쓴다(U-13) */
function keyPart(toolCallId: string): string {
  return commitKeyPart(toolCallId, sha256Hex);
}

/** 임시 디렉터리 안 DB 파일 경로. 호출자가 cleanup을 afterEach에 건다 */
export function tempDbPath(): { readonly path: string; readonly cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), "xeon-persistence-"));
  return {
    path: join(directory, "session.db"),
    cleanup: () => {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export interface Harness {
  readonly clock: ManualClock;
  readonly ids: IdFactory;
  readonly store: TestStore;
  readonly service: SessionService;
  readonly loop: ProducerHandle;
  readonly tools: ProducerHandle;
  readonly tasks: ProducerHandle;
  readonly context: ProducerHandle;
  /** 성공으로 끝난 새 커밋(재전송 제외) 수 */
  commits(): number;
  /** 로거에 남은 기록 */
  readonly logs: string[];
}

export interface HarnessOptions {
  readonly path?: string;
  readonly faults?: FaultInjector;
  readonly settings?: () => PersistenceSettings;
  readonly guardProjectors?: boolean;
  readonly clock?: ManualClock;
  readonly ids?: IdFactory;
  readonly store?: TestStore;
  readonly onLeaseLost?: (threadId: ThreadId) => void;
  /** false면 엔진 LeaseHolder를 넘기지 않는다 */
  readonly withHolder?: boolean;
  readonly readBlob?: SessionDeps["readBlob"];
  readonly putBlob?: SessionDeps["putBlob"];
}

export async function openHarness(options: HarnessOptions = {}): Promise<Harness> {
  const clock = options.clock ?? manualClock();
  const ids = options.ids ?? fixedIdFactory();
  const store =
    options.store ??
    (await openTestStore({
      clock,
      ...(options.path === undefined ? {} : { path: options.path }),
    }));
  const logs: string[] = [];
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: (event) => {
      logs.push(`warn:${event}`);
    },
    error: (event) => {
      logs.push(`error:${event}`);
    },
    child: () => logger,
  };
  const created = createSessionService({
    db: store.db,
    leases: store.leases,
    migrations: store.migrations,
    clock,
    ids,
    logger,
    ...(options.withHolder === false ? {} : { holder: TEST_HOLDER_A }),
    ...(options.readBlob === undefined ? {} : { readBlob: options.readBlob }),
    ...(options.putBlob === undefined ? {} : { putBlob: options.putBlob }),
    ...(options.faults === undefined ? {} : { faults: options.faults }),
    ...(options.settings === undefined ? {} : { settings: options.settings }),
    ...(options.guardProjectors === undefined ? {} : { guardProjectors: options.guardProjectors }),
    ...(options.onLeaseLost === undefined ? {} : { onLeaseLost: options.onLeaseLost }),
  });
  if (!created.ok)
    throw new Bug("harness could not create the session service", { cause: created.error });
  const service = created.value;
  let commitCount = 0;
  const counted: SessionService = {
    ...service,
    commit(request: CommitRequest) {
      const result = service.commit(request);
      if (result.ok && result.value.status === "committed" && !result.value.replayed)
        commitCount += 1;
      return result;
    },
  };
  return {
    clock,
    ids,
    store,
    service: counted,
    loop: service.producer("core.loop"),
    tools: service.producer("core.tools"),
    tasks: service.producer("core.tasks"),
    context: service.producer("core.context"),
    commits: () => commitCount,
    logs,
  };
}

/** 같은 DB 파일에 새 서비스를 올린다(프로세스 재시작 흉내). 이전 서비스의 메모리 상태는 모두 사라진다 */
export function reopenHarness(prior: Harness, options: HarnessOptions = {}): Promise<Harness> {
  return openHarness({ ...options, clock: prior.clock, ids: prior.ids, store: prior.store });
}

export interface NewThread {
  readonly threadId: ThreadId;
  readonly token: LeaseToken;
}

/** thread를 만들고 쓰기 소유를 얻어 쓰기 모드로 연다 */
export function newThread(h: Harness, title: string | null = "t"): NewThread {
  const threadId = h.ids.next("thr");
  const made = h.service.threads.create(title === null ? { threadId } : { threadId, title });
  if (!made.ok) throw new Bug("newThread: create failed", { cause: made.error });
  const token = h.store.leases.acquire(`session:${threadId}`, TEST_HOLDER_A);
  if (!token.ok) throw new Bug("newThread: lease failed", { cause: token.error });
  const opened = h.service.openForWrite(threadId, token.value);
  if (!opened.ok) throw new Bug("newThread: open failed", { cause: opened.error });
  return { threadId, token: token.value };
}

export function commitOrThrow(
  h: Harness,
  threadId: ThreadId,
  key: string,
  build: (view: TxView) => CommitPlan,
  source: Record<string, string | number | null> = {},
): Extract<CommitResult, { status: "committed" }> {
  const result = h.service.commit({
    threadId,
    requestId: key,
    fingerprintSource: { key, ...source },
    build,
  });
  if (!result.ok) throw new Bug(`commit ${key} failed: ${result.error.kind}`);
  if (result.value.status !== "committed")
    throw new Bug(`commit ${key} was ${result.value.status}`);
  return result.value;
}

export function commitResult(
  h: Harness,
  threadId: ThreadId,
  key: string,
  build: (view: TxView) => CommitPlan,
): Result<CommitResult, StoreError> {
  return h.service.commit({ threadId, requestId: key, fingerprintSource: { key }, build });
}

// ── 이벤트 초안 만들기 ─────────────────────────────────────────────────

const USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

interface Scope {
  readonly turnId: TurnId | null;
  readonly stepId: StepId | null;
}

export function draftOf(
  h: Harness,
  handle: ProducerHandle,
  kind: DraftInput["kind"],
  threadId: ThreadId,
  scope: Scope,
  payload: unknown,
  causationId: EventId | null = null,
): StampedDraft {
  return handle.draft({
    id: h.ids.next("evt"),
    kind,
    threadId,
    turnId: scope.turnId,
    stepId: scope.stepId,
    causationId,
    correlationId: scope.turnId,
    payload,
  });
}

function userItemPayload(h: Harness, itemId: ItemId, text: string): unknown {
  return {
    item: {
      itemId,
      status: "completed",
      kind: "user",
      message: { role: "user", content: text, timestamp: h.clock.now() },
      requestId: null,
    },
  };
}

function assistantItemPayload(
  h: Harness,
  itemId: ItemId,
  toolCalls: readonly { readonly id: string; readonly name: string }[],
): unknown {
  return {
    item: {
      itemId,
      status: "completed",
      kind: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "ok" },
          ...toolCalls.map((call) => ({
            type: "toolCall",
            id: call.id,
            name: call.name,
            arguments: {},
          })),
        ],
        api: "test",
        provider: "test",
        model: "tape",
        usage: USAGE,
        stopReason: toolCalls.length > 0 ? "toolUse" : "stop",
        timestamp: h.clock.now(),
      },
      partIds: [],
    },
  };
}

function toolResultItemPayload(
  h: Harness,
  itemId: ItemId,
  effectId: EffectId | null,
  toolCallId: string,
  toolName: string,
  isError: boolean,
): unknown {
  return {
    item: {
      itemId,
      status: isError ? "failed" : "completed",
      kind: "toolResult",
      message: {
        role: "toolResult",
        toolCallId,
        toolName,
        content: [{ type: "text", text: "done" }],
        isError,
        timestamp: h.clock.now(),
      },
      effectId,
    },
  };
}

export function intentPayload(
  effectId: EffectId,
  itemId: ItemId,
  toolCallId: string,
  toolName: string,
  replay: ReplayPolicy,
): unknown {
  return {
    effectId,
    toolCallId,
    toolName,
    itemId,
    argsHash: "0".repeat(64),
    args: { path: "a.txt" },
    replay,
    idempotencyKey: null,
  };
}

export function checkpointInput(
  turnId: TurnId,
  stepId: StepId,
  stepIndex: number,
  next: StepCheckpointInput["next"],
): StepCheckpointInput {
  return {
    turnId,
    stepId,
    stepIndex,
    next,
    pendingToolCalls: [],
    inputCursor: { consumedSeq: 0 },
    model: { provider: "test", modelId: "tape", thinkingLevel: "off" },
    leaseRefs: [],
    scopeRef: null,
  };
}

// ── 한 turn의 커밋 지점(L1 동료가 하는 일) ───────────────────────────────

export interface TurnIds {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
}

/** C2: turn.started + user item.recorded */
export function startTurn(
  h: Harness,
  threadId: ThreadId,
  options: { readonly requestId?: string | null; readonly scopeId?: string | null } = {},
): TurnIds {
  const turnId = h.ids.next("trn");
  const scope: Scope = { turnId, stepId: null };
  commitOrThrow(h, threadId, `turn:${turnId}:start`, () => ({
    kind: "append",
    drafts: [
      draftOf(h, h.loop, "turn.started", threadId, scope, {
        inputItemIds: [],
        requestId: options.requestId ?? null,
        scopeId: options.scopeId ?? null,
      }),
      draftOf(
        h,
        h.loop,
        "item.recorded",
        threadId,
        scope,
        userItemPayload(h, h.ids.next("itm"), "hi"),
      ),
    ],
    checkpoint: null,
  }));
  return { threadId, turnId };
}

/** C6: turn.completed */
export function endTurn(
  h: Harness,
  { threadId, turnId }: TurnIds,
  status: "completed" | "interrupted" | "failed" = "completed",
): void {
  commitOrThrow(h, threadId, `turn:${turnId}:end`, () => ({
    kind: "append",
    drafts: [
      draftOf(
        h,
        h.loop,
        "turn.completed",
        threadId,
        { turnId, stepId: null },
        {
          status,
          stepCount: 1,
          usage: null,
          error: null,
        },
      ),
    ],
    checkpoint: null,
  }));
}

export interface ToolCallPlan {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly replay: ReplayPolicy;
}

export interface StepProgress {
  readonly effects: readonly {
    readonly effectId: EffectId;
    readonly call: ToolCallPlan;
    readonly itemId: ItemId;
  }[];
}

/** S1: step.started */
export function commitStepStart(
  h: Harness,
  { threadId, turnId }: TurnIds,
  stepIndex: number,
  stepId: StepId,
): void {
  commitOrThrow(h, threadId, `step:${turnId}:${stepIndex}:start`, () => ({
    kind: "append",
    drafts: [draftOf(h, h.loop, "step.started", threadId, { turnId, stepId }, { stepIndex })],
    checkpoint: null,
  }));
}

/** C3: 모델 응답 확정(assistant item.recorded) */
export function commitResponse(
  h: Harness,
  { threadId, turnId }: TurnIds,
  stepIndex: number,
  stepId: StepId,
  calls: readonly ToolCallPlan[],
): void {
  commitOrThrow(h, threadId, `resp:${turnId}:${stepIndex}`, () => ({
    kind: "append",
    drafts: [
      draftOf(
        h,
        h.loop,
        "item.recorded",
        threadId,
        { turnId, stepId },
        assistantItemPayload(
          h,
          h.ids.next("itm"),
          calls.map((call) => ({ id: call.toolCallId, name: call.toolName })),
        ),
      ),
    ],
    checkpoint: null,
  }));
}

/** E1: effect.intent */
export function commitIntent(
  h: Harness,
  { threadId, turnId }: TurnIds,
  stepId: StepId,
  call: ToolCallPlan,
): StepProgress["effects"][number] {
  const effectId = h.ids.next("efx");
  const itemId = h.ids.next("itm");
  commitOrThrow(h, threadId, `tool:${keyPart(call.toolCallId)}:intent`, () => ({
    kind: "append",
    drafts: [
      draftOf(
        h,
        h.tools,
        "effect.intent",
        threadId,
        { turnId, stepId },
        intentPayload(effectId, itemId, call.toolCallId, call.toolName, call.replay),
      ),
    ],
    checkpoint: null,
  }));
  return { effectId, call, itemId };
}

/** S1 + C3 + E1(도구마다). E2·E3·C5는 호출자가 이어서 부른다 */
export function stepUntilIntents(
  h: Harness,
  turn: TurnIds,
  stepIndex: number,
  stepId: StepId,
  calls: readonly ToolCallPlan[],
): StepProgress {
  commitStepStart(h, turn, stepIndex, stepId);
  commitResponse(h, turn, stepIndex, stepId, calls);
  return { effects: calls.map((call) => commitIntent(h, turn, stepId, call)) };
}

/** E2: effect.exec. 첫 실행은 attempt 0, 재실행은 1부터 */
export function commitExec(
  h: Harness,
  { threadId, turnId }: TurnIds,
  stepId: StepId,
  effectId: EffectId,
  toolCallId: string,
  attempt = 0,
): void {
  commitOrThrow(
    h,
    threadId,
    attempt === 0
      ? `tool:${keyPart(toolCallId)}:exec`
      : `tool:${keyPart(toolCallId)}:exec:${attempt}`,
    () => ({
      kind: "append",
      drafts: [
        draftOf(
          h,
          h.tools,
          "effect.exec",
          threadId,
          { turnId, stepId },
          {
            effectId,
            startedAt: h.clock.now(),
          },
        ),
      ],
      checkpoint: null,
    }),
  );
}

/** E3: effect.result + toolResult item.recorded */
export function commitResultOf(
  h: Harness,
  { threadId, turnId }: TurnIds,
  stepId: StepId,
  effect: StepProgress["effects"][number],
): void {
  const scope: Scope = { turnId, stepId };
  commitOrThrow(h, threadId, `tool:${keyPart(effect.call.toolCallId)}:result`, () => ({
    kind: "append",
    drafts: [
      draftOf(h, h.tools, "effect.result", threadId, scope, {
        effectId: effect.effectId,
        status: "ok",
        resultItemId: effect.itemId,
        output: { structuredContent: null, terminate: false },
        blobRef: null,
        durationMs: 1,
        synthesized: false,
      }),
      draftOf(
        h,
        h.loop,
        "item.recorded",
        threadId,
        scope,
        toolResultItemPayload(
          h,
          effect.itemId,
          effect.effectId,
          effect.call.toolCallId,
          effect.call.toolName,
          false,
        ),
      ),
    ],
    checkpoint: null,
  }));
}

/** C5: step.completed + checkpoint.step */
export function endStep(
  h: Harness,
  { threadId, turnId }: TurnIds,
  stepIndex: number,
  stepId: StepId,
  next: StepCheckpointInput["next"],
): void {
  commitOrThrow(h, threadId, `step:${turnId}:${stepIndex}:end`, () => ({
    kind: "append",
    drafts: [
      draftOf(
        h,
        h.loop,
        "step.completed",
        threadId,
        { turnId, stepId },
        {
          stepIndex,
          status: "completed",
          stopReason: "stop",
          assistantItemId: null,
          toolResultItemIds: [],
        },
      ),
    ],
    checkpoint: checkpointInput(turnId, stepId, stepIndex, next),
  }));
}

/** 한 단계를 끝까지: S1, C3, 도구마다 E1~E3, C5. 도구 n개면 커밋 3+3n개 */
export function fullStep(
  h: Harness,
  turn: TurnIds,
  stepIndex: number,
  calls: readonly ToolCallPlan[],
): void {
  const stepId = h.ids.next("stp");
  const progress = stepUntilIntents(h, turn, stepIndex, stepId, calls);
  for (const effect of progress.effects) {
    commitExec(h, turn, stepId, effect.effectId, effect.call.toolCallId);
    commitResultOf(h, turn, stepId, effect);
  }
  endStep(h, turn, stepIndex, stepId, calls.length > 0 ? "request" : "turn_end");
}

export function expectOk<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: unknown },
): T {
  if (!result.ok) throw new Bug("expected ok", { cause: result.error });
  return result.value;
}

/** 파일 대신 메모리에 두는 blob 저장소 대역. L0.store의 putBlob·readBlob과 같은 F 모양이다 */
export function memoryBlobs(): {
  readonly putBlob: NonNullable<SessionDeps["putBlob"]>;
  readonly readBlob: NonNullable<SessionDeps["readBlob"]>;
  readonly files: ReadonlyMap<string, Uint8Array>;
} {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    putBlob(bytes, mediaType) {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      files.set(sha256, bytes);
      return ok({ type: "blob", sha256, size: bytes.length, mediaType });
    },
    readBlob(ref) {
      const bytes = files.get(ref.sha256);
      return bytes === undefined ? err({ kind: "blob_missing", sha256: ref.sha256 }) : ok(bytes);
    },
  };
}
