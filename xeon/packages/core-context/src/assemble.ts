import { err, ok, parse, type Logger, type ParseError, type Result } from "@xeon/contracts";
import type {
  EventId,
  ItemRecord,
  Message,
  SystemMessage,
  ThreadId,
} from "@xeon/contracts/conversation";
import {
  BranchSummarizedPayloadSchema,
  CompactedPayloadSchema,
  ItemRecordedPayloadSchema,
  type BranchSummarizedPayload,
  type CompactedPayload,
  type DurableEventEnvelope,
  type SessionService,
} from "@xeon/contracts/records";
import type {
  AssembleOptions,
  AssembledContext,
  ContextError,
  ModelService,
  PendingSystemItem,
  PrefixInfo,
  ToolChangeDecision,
} from "@xeon/contracts/services";
import type { ExtHost } from "@xeon/ext-host";
import {
  branchSummaryMessage,
  compactionSummaryMessage,
  convertToLlm,
  itemToMessage,
} from "./convert.ts";
import { buildPrefixMessage, prefixHash, prefixToolset, replaySystemMessages } from "./prefix.ts";

// L1.context.spec §4.1 조립 순서(M1 몫): 가지 읽기 → 컴팩션 머리 → 메시지 변환 → context 지점 → 추정.
// 도구 변경 메시지(§4.3), 캐시 표식(§4.5), 모델 전환 경고(§4.4), context_with_system 지점은 M2다.

export interface AssembleDeps {
  readonly session: Pick<SessionService, "readBranch" | "hydrate">;
  readonly models: Pick<ModelService, "tokens">;
  readonly ext: Pick<ExtHost, "dispatch">;
  readonly logger?: Logger;
}

/** 가지 위 이벤트 하나를 조립에 쓰는 모양으로 읽은 것. 조립에 쓰지 않는 이벤트는 undefined */
type Projected =
  | { readonly type: "item"; readonly item: ItemRecord }
  | { readonly type: "compacted"; readonly payload: CompactedPayload }
  | { readonly type: "branch_summary"; readonly payload: BranchSummarizedPayload };

interface CompactionHead {
  /** 가지 위 thread.compacted 이벤트의 위치 */
  readonly index: number;
  readonly eventId: EventId;
  readonly firstKeptEventId: EventId;
  /** 가지 위 firstKeptEventId 이벤트의 위치 */
  readonly firstKeptIndex: number;
  readonly summary: string;
  readonly recordedAt: number;
}

function projectionFailed(event: DurableEventEnvelope, error: ParseError): ContextError {
  const issue = error.issues[0];
  const detail = issue === undefined ? "" : ` ${issue.path} ${issue.message}`;
  return { kind: "projection_failed", message: `${event.kind} ${event.id}${detail}` };
}

function projectEvent(event: DurableEventEnvelope): Result<Projected | undefined, ContextError> {
  if (event.kind === "item.recorded") {
    const parsed = parse(ItemRecordedPayloadSchema, event.payload);
    if (!parsed.ok) return err(projectionFailed(event, parsed.error));
    return ok({ type: "item", item: parsed.value.item });
  }
  if (event.kind === "thread.compacted") {
    const parsed = parse(CompactedPayloadSchema, event.payload);
    if (!parsed.ok) return err(projectionFailed(event, parsed.error));
    return ok({ type: "compacted", payload: parsed.value });
  }
  if (event.kind === "thread.branch_summarized") {
    const parsed = parse(BranchSummarizedPayloadSchema, event.payload);
    if (!parsed.ok) return err(projectionFailed(event, parsed.error));
    return ok({ type: "branch_summary", payload: parsed.value });
  }
  return ok(undefined);
}

function projectBranch(
  events: readonly DurableEventEnvelope[],
): Result<readonly (Projected | undefined)[], ContextError> {
  const projected: (Projected | undefined)[] = [];
  for (const event of events) {
    const one = projectEvent(event);
    if (!one.ok) return one;
    projected.push(one.value);
  }
  return ok(projected);
}

/** leaf에서 루트까지 거슬러 읽은 가지를 루트→leaf 순서로 돌려준다. detached 필드는 블롭에서 되돌린다 */
async function readBranchEvents(
  deps: AssembleDeps,
  threadId: ThreadId,
  leaf: EventId,
  signal: AbortSignal | undefined,
): Promise<Result<readonly DurableEventEnvelope[], ContextError>> {
  const events: DurableEventEnvelope[] = [];
  for await (const read of deps.session.readBranch(threadId, leaf)) {
    if (signal?.aborted === true) return err({ kind: "aborted", message: "assemble aborted" });
    if (!read.ok) {
      return err({ kind: "read_failed", message: `session read failed: ${read.error.kind}` });
    }
    const event = read.value;
    const detached = event.detached !== undefined && event.detached.length > 0;
    events.push(detached ? await deps.session.hydrate(event) : event);
  }
  const last = events.at(-1);
  if (last === undefined || last.id !== leaf) {
    return err({ kind: "branch_not_found", message: `leaf ${leaf} is not on thread ${threadId}` });
  }
  return ok(events);
}

/**
 * 가지 위 마지막 thread.compacted가 머리다(§4.8). firstKeptEventId가 가지에 없거나 컴팩션보다 뒤면
 * 손상으로 보고 머리를 무시한다(§5). 투영 오류로 올리지 않고 로그만 남긴다
 */
function findHead(
  deps: AssembleDeps,
  events: readonly DurableEventEnvelope[],
  projected: readonly (Projected | undefined)[],
): CompactionHead | null {
  for (let index = projected.length - 1; index >= 0; index -= 1) {
    const entry = projected[index];
    const event = events[index];
    if (entry?.type !== "compacted" || event === undefined) continue;
    const { firstKeptEventId, summary } = entry.payload;
    const firstKeptIndex = events.findIndex((candidate) => candidate.id === firstKeptEventId);
    if (firstKeptIndex < 0 || firstKeptIndex > index) {
      deps.logger?.warn("context.compaction_head_invalid", {
        eventId: event.id,
        firstKeptEventId,
      });
      return null;
    }
    return {
      index,
      eventId: event.id,
      firstKeptEventId,
      firstKeptIndex,
      summary,
      recordedAt: event.recordedAt,
    };
  }
  return null;
}

/** 완료된 system item의 메시지. 그 밖의 항목은 undefined */
function systemMessageOf(entry: Projected | undefined): SystemMessage | undefined {
  if (entry?.type !== "item" || entry.item.kind !== "system") return undefined;
  return entry.item.status === "in_progress" ? undefined : entry.item.message;
}

/**
 * 기록된 접두의 위치. 머리가 있으면 머리 뒤 첫 system item(컴팩션이 같은 커밋에 새 접두를 넣는다, §4.6 5번),
 * 없으면 가지의 첫 system item이다. item.recorded의 system item에는 purpose가 남지 않으므로(F.conversation
 * ItemRecord) 위치로 알아본다. 접두 뒤의 system item은 도구 변경·절 갱신이다. 없으면 -1
 */
function findPrefixIndex(
  projected: readonly (Projected | undefined)[],
  head: CompactionHead | null,
): number {
  const from = head === null ? 0 : head.index + 1;
  for (let index = from; index < projected.length; index += 1) {
    if (systemMessageOf(projected[index]) !== undefined) return index;
  }
  return -1;
}

function isSystem(message: Message): message is SystemMessage {
  return message.role === "system";
}

/**
 * context 지점(chain)을 시스템 메시지를 뺀 배열로 발화한다(§4.1 4번). 핸들러가 바꾼 배열이 있으면
 * 접두와 뒤따르는 시스템 메시지를 합친 시스템 메시지를 맨 앞에 되돌린다(pi emitContext와 같다).
 * 바꾼 핸들러가 없으면 조립한 배열을 그대로 둔다
 */
async function applyContextPoint(
  deps: AssembleDeps,
  threadId: ThreadId,
  opts: AssembleOptions,
  assembled: readonly Message[],
): Promise<readonly Message[]> {
  const visible = assembled.filter((message) => !isSystem(message));
  // 디스패치가 payload를 동결하고 핸들러가 current를 고칠 수 있으므로 저장소가 준 객체는 복사해서 넘긴다
  const outcome = await deps.ext.dispatch(
    "context",
    { messages: structuredClone(visible) },
    {
      threadId,
      dispatchKey: `${opts.stepId}:context`,
      initial: { messages: structuredClone(visible) },
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    },
  );
  if (outcome.applied.length === 0) return assembled;
  const systemState = replaySystemMessages(assembled.filter(isSystem));
  const returned = convertToLlm(outcome.value.messages);
  return systemState === undefined ? returned : [systemState, ...returned];
}

/**
 * leaf까지의 가지로 모델 요청 컨텍스트를 만든다. 커밋하지 않는다. 접두가 아직 기록되지 않았으면
 * 이번에 만들어 pendingItems로 돌려준다(§4.2). 접두의 타임스탬프는 leaf 이벤트의 recordedAt이다
 * (시계를 쓰지 않으므로 기록 전 다시 조립해도 같은 접두를 만든다)
 */
export async function assembleContext(
  deps: AssembleDeps,
  threadId: ThreadId,
  leaf: EventId,
  opts: AssembleOptions,
): Promise<Result<AssembledContext, ContextError>> {
  const read = await readBranchEvents(deps, threadId, leaf, opts.signal);
  if (!read.ok) return read;
  const events = read.value;
  const projectedResult = projectBranch(events);
  if (!projectedResult.ok) return projectedResult;
  const projected = projectedResult.value;

  const head = findHead(deps, events, projected);
  const prefixIndex = findPrefixIndex(projected, head);
  const recordedPrefix = systemMessageOf(projected[prefixIndex]);
  const recordedPrefixEvent = events[prefixIndex];

  const pendingItems: PendingSystemItem[] = [];
  let toolChange: ToolChangeDecision | null = null;
  let prefixMessage: SystemMessage;
  let prefixEventId: EventId | null = null;
  if (recordedPrefix !== undefined && recordedPrefixEvent !== undefined) {
    prefixMessage = recordedPrefix;
    prefixEventId = recordedPrefixEvent.id;
  } else {
    const leafEvent = events.at(-1);
    prefixMessage = buildPrefixMessage({
      basePrompt: opts.basePrompt,
      sections: opts.sections,
      tools: opts.tools,
      timestamp: leafEvent === undefined ? 0 : leafEvent.recordedAt,
    });
    pendingItems.push({ purpose: "prefix", message: prefixMessage });
    toolChange = {
      action: "readvertise",
      reason: head === null ? "first_request" : "compaction",
      firstChangedIndex: opts.tools.length === 0 ? null : 0,
    };
  }

  const messages: Message[] = [prefixMessage];
  if (head !== null) messages.push(compactionSummaryMessage(head.summary, head.recordedAt));
  const startIndex = head === null ? 0 : head.firstKeptIndex;
  for (let index = startIndex; index < projected.length; index += 1) {
    const entry = projected[index];
    if (entry === undefined || entry.type === "compacted" || index === prefixIndex) continue;
    if (entry.type === "branch_summary") {
      const event = events[index];
      if (event !== undefined) {
        messages.push(branchSummaryMessage(entry.payload.summary, event.recordedAt));
      }
      continue;
    }
    if (entry.item.status === "in_progress") continue;
    // 머리 앞에 기록된 도구 변경·절 갱신은 새 접두가 이미 반영하고 있다
    if (entry.item.kind === "system" && head !== null && index < head.index) continue;
    messages.push(itemToMessage(entry.item));
  }

  if (Object.keys(opts.volatile).length > 0) {
    // volatile 계층의 위치 규칙은 문서가 서로 다르다(§4.1 표 "끝"과 본문 "마지막 사용자 메시지 앞", §10-8).
    // 정해질 때까지 조립에 넣지 않는다
    deps.logger?.warn("context.volatile_ignored", { keys: Object.keys(opts.volatile).length });
  }

  const finalMessages = await applyContextPoint(deps, threadId, opts, messages);
  const prefix: PrefixInfo = {
    prefixHash: prefixHash(prefixMessage),
    toolset: await prefixToolset(prefixMessage),
    recordedAt: prefixEventId,
  };
  return ok({
    messages: finalMessages,
    prefix,
    toolChange,
    // 캐시 표식 위치 계산(§4.5)은 M2다. 비어 있으면 표식을 두지 않는다는 뜻이므로 호출자는 provider 기본 위치를 쓴다
    cacheMarks: { policy: opts.cachePolicy, marks: [] },
    estimate: deps.models.tokens.estimateContext(finalMessages),
    compactionHead:
      head === null ? null : { eventId: head.eventId, firstKeptEventId: head.firstKeptEventId },
    pendingItems,
    warnings: [],
  });
}
