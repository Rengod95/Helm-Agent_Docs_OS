import { err, ok, type Logger, type Result } from "@xeon/contracts";
import type { OrderedTool } from "@xeon/contracts/capabilities";
import type {
  EventId,
  IdFactory,
  JsonValue,
  Message,
  StepId,
  SystemMessage,
  ThreadId,
  Usage,
} from "@xeon/contracts/conversation";
import type { DurableEventEnvelope, ProducerHandle, SessionService } from "@xeon/contracts/records";
import type {
  CompactOutcome,
  CompactReason,
  CompactRequest,
  ContextError,
  ModelService,
  ResolvedModel,
} from "@xeon/contracts/services";
import type { ExtHost } from "@xeon/ext-host";
import {
  effectiveMessages,
  findHead,
  findPrefixIndex,
  projectBranch,
  readBranchEvents,
  systemMessageOf,
  type CompactionHead,
  type Projected,
} from "../branch.ts";
import { branchSummaryMessage, itemToMessage } from "../convert.ts";
import { isJsonObject } from "../json.ts";
import { buildPrefixMessage, replaySystemMessages } from "../prefix.ts";
import type { ContextSettings } from "../settings.ts";
import { findCutPoint, type CutCandidate } from "./cut-point.ts";
import { SUMMARIZATION_SYSTEM_PROMPT } from "./prompts.ts";
import {
  extractFileOps,
  fileOpsFromDetails,
  runCompaction,
  type CompactionPreparation,
  type SummarizeDeps,
} from "./summarize.ts";

// L1.context.spec §4.6, plan C-4·C-5·C-7·C-9. 컴팩션 한 번: 가지 읽기 → 준비 → session_before_compact → 요약 →
// 한 커밋(thread.compacted + 새 접두) → session_compact. 원본 이벤트는 지우지 않는다.

/** F `CompactedPayload.summary` 상한(글자). 넘으면 저장할 수 없다 */
const SUMMARY_MAX_CHARS = 65_536;
/** 요약 응답 토큰 상한. 글자 상한 안에 들도록 3.5자/토큰 기준으로 잡는다 */
const SUMMARY_MAX_OUTPUT_TOKENS = 16_000;

/** 가장 최근 조립이 받은 프롬프트 입력. 컴팩션이 새 접두를 만들 때 쓴다(재광고, §4.3 6번) */
export interface PromptInputs {
  readonly basePrompt: string;
  readonly sections: Readonly<Record<string, string>>;
  readonly tools: readonly OrderedTool[];
}

export interface CompactDeps {
  readonly session: Pick<SessionService, "readBranch" | "hydrate" | "commit">;
  readonly producer: ProducerHandle;
  readonly ids: IdFactory;
  readonly models: Pick<ModelService, "tokens" | "complete" | "resolve">;
  readonly ext: Pick<ExtHost, "dispatch">;
  readonly settings: () => ContextSettings;
  /** thread의 가장 최근 조립 입력. 없으면 가지 위 기록된 광고 상태로 새 접두를 만든다 */
  readonly promptInputs: (threadId: ThreadId) => PromptInputs | undefined;
  readonly logger?: Logger;
}

/** 후보 목록과 머리. 머리 뒤는 firstKeptEventId부터 leaf까지, 곧 모델에 보이는 원문이다 */
export interface ThreadCompactionView {
  readonly head: {
    readonly eventId: EventId;
    readonly summary: string;
    readonly firstKeptEventId: EventId;
    readonly details: JsonValue;
  } | null;
  readonly candidates: readonly CutCandidate[];
}

/** 가지를 컷 후보로 바꾼다. system item과 진행 중 item은 후보가 아니다 */
function buildView(
  events: readonly DurableEventEnvelope[],
  projected: readonly (Projected | undefined)[],
  head: CompactionHead | null,
): ThreadCompactionView {
  const candidates: CutCandidate[] = [];
  const startIndex = head === null ? 0 : head.firstKeptIndex;
  for (let index = startIndex; index < projected.length; index += 1) {
    const entry = projected[index];
    const event = events[index];
    if (entry === undefined || event === undefined || entry.type === "compacted") continue;
    if (entry.type === "branch_summary") {
      candidates.push({
        eventId: event.id,
        kind: "custom",
        turnId: null,
        messages: [branchSummaryMessage(entry.payload.summary, event.recordedAt)],
        usage: null,
      });
      continue;
    }
    const item = entry.item;
    if (item.status === "in_progress" || item.kind === "system") continue;
    candidates.push({
      eventId: event.id,
      kind: item.kind,
      turnId: event.turnId,
      messages: [itemToMessage(item)],
      usage: item.kind === "assistant" ? item.message.usage : null,
    });
  }
  return {
    head:
      head === null
        ? null
        : {
            eventId: head.eventId,
            summary: head.summary,
            firstKeptEventId: head.firstKeptEventId,
            details: head.details,
          },
    candidates,
  };
}

export function prepareCompaction(
  view: ThreadCompactionView,
  keepRecentTokens: number,
  estimate: (message: Message) => number,
  tokensBefore: number,
): CompactionPreparation | undefined {
  const { candidates } = view;
  const cut = findCutPoint(candidates, keepRecentTokens, estimate);
  const firstKept = candidates[cut.firstKeptIndex];
  if (firstKept === undefined) return undefined;
  const historyEnd = cut.isSplitTurn ? cut.turnStartIndex : cut.firstKeptIndex;
  const messagesToSummarize = candidates.slice(0, historyEnd).flatMap((c) => c.messages);
  const turnPrefixMessages = cut.isSplitTurn
    ? candidates.slice(cut.turnStartIndex, cut.firstKeptIndex).flatMap((c) => c.messages)
    : [];
  if (messagesToSummarize.length === 0 && turnPrefixMessages.length === 0) return undefined;
  const previous = fileOpsFromDetails(view.head?.details ?? null);
  return {
    firstKeptEventId: firstKept.eventId,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn: cut.isSplitTurn,
    tokensBefore,
    previousSummary: view.head?.summary ?? null,
    fileOps: extractFileOps([...messagesToSummarize, ...turnPrefixMessages], previous),
  };
}

/** 마지막 의미 있는 항목이 컴팩션인지. system item과 투영하지 않는 이벤트(체크포인트 등)는 건너뛴다 */
function lastEntryIsCompaction(projected: readonly (Projected | undefined)[]): boolean {
  for (let index = projected.length - 1; index >= 0; index -= 1) {
    const entry = projected[index];
    if (entry === undefined) continue;
    if (entry.type === "item" && entry.item.kind === "system") continue;
    return entry.type === "compacted";
  }
  return false;
}

/** 컴팩션 뒤 첫 단계 접두. 최근 조립 입력이 있으면 그것으로 재광고하고, 없으면 기록된 광고 상태를 그대로 옮긴다 */
function newPrefixOf(
  deps: CompactDeps,
  threadId: ThreadId,
  projected: readonly (Projected | undefined)[],
  prefixIndex: number,
  timestamp: number,
): SystemMessage | undefined {
  const inputs = deps.promptInputs(threadId);
  if (inputs !== undefined) {
    return buildPrefixMessage({
      basePrompt: inputs.basePrompt,
      sections: inputs.sections,
      tools: inputs.tools,
      timestamp,
    });
  }
  if (prefixIndex < 0) return undefined;
  const state = replaySystemMessages(
    projected.slice(prefixIndex).flatMap((entry) => systemMessageOf(entry) ?? []),
  );
  return state === undefined ? undefined : { ...state, timestamp };
}

function textOf(blocks: readonly { readonly type: string; readonly text?: string }[]): string {
  return blocks.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("");
}

/** xeon.models.complete를 summary 역할, 캐시 없음으로 부르는 얇은 어댑터(§3.2) */
export function summarizeVia(
  models: Pick<ModelService, "complete">,
  resolved: ResolvedModel,
  scope: {
    readonly threadId: ThreadId;
    readonly stepId: StepId | null;
    readonly timestamp: number;
  },
): SummarizeDeps {
  return {
    async summarize(req) {
      const message = await models.complete({
        threadId: scope.threadId,
        turnId: null,
        stepId: scope.stepId,
        role: "summary",
        ...(req.signal === undefined ? {} : { signal: req.signal }),
        resolved,
        context: {
          systemPrompt: req.system,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: req.prompt }],
              timestamp: scope.timestamp,
            },
          ],
        },
        options: {
          maxTokens: Math.min(req.maxTokens, SUMMARY_MAX_OUTPUT_TOKENS),
          cacheRetention: "none",
        },
      });
      return {
        text: textOf(message.content),
        usage: message.usage,
        stopReason: message.stopReason,
        errorMessage: message.errorMessage ?? null,
        hasToolCall: message.content.some((block) => block.type === "toolCall"),
      };
    },
  };
}

function failedMessage(error: ContextError): string | null {
  return error.kind === "aborted" ? null : error.message;
}

/**
 * 컴팩션 한 번을 한다. 오류와 거부는 값으로 돌려준다. 임계·오버플로우 컴팩션은 설정 autoCompact가 꺼져 있으면 건너뛴다.
 * 수동 컴팩션은 꺼져 있어도 한다
 */
export async function compactThread(
  deps: CompactDeps,
  threadId: ThreadId,
  request: CompactRequest,
): Promise<Result<CompactOutcome, ContextError>> {
  const settings = deps.settings();
  if (request.reason !== "manual" && !settings.autoCompact) {
    return ok({ status: "skipped", why: "disabled" });
  }
  const read = await readBranchEvents(deps, threadId, undefined, request.signal);
  if (!read.ok) return read;
  const events = read.value;
  const projectedResult = projectBranch(events);
  if (!projectedResult.ok) return projectedResult;
  const projected = projectedResult.value;
  if (lastEntryIsCompaction(projected)) {
    return ok({ status: "skipped", why: "last_entry_is_compaction" });
  }

  const head = findHead(deps, events, projected);
  const prefixIndex = findPrefixIndex(projected, head);
  const leafEvent = events.at(-1);
  if (leafEvent === undefined) {
    return err({ kind: "branch_not_found", message: `thread ${threadId} has no events` });
  }
  const view = buildView(events, projected, head);
  const estimate = (message: Message): number => deps.models.tokens.estimateMessage(message);
  const tokensBefore = deps.models.tokens.estimateContext(
    effectiveMessages(
      events,
      projected,
      head,
      prefixIndex,
      systemMessageOf(projected[prefixIndex]),
    ),
  ).tokens;
  const prep = prepareCompaction(view, settings.keepRecentTokens, estimate, tokensBefore);
  if (prep === undefined) return ok({ status: "skipped", why: "nothing_to_summarize" });

  const anchor = request.stepId ?? leafEvent.id;
  const key = `compact:${threadId}:${anchor}:${request.reason}`;
  const options = request.signal === undefined ? {} : { signal: request.signal };
  const instructions =
    [settings.compactionInstructions, request.instructions ?? ""]
      .filter((t) => t.length > 0)
      .join("\n") || null;

  // 확장이 거부하거나 요약을 대신할 수 있다. first 지점은 핸들러 실패에도 거부(fail-closed)다
  const before = await deps.ext.dispatch(
    "session_before_compact",
    {
      threadId,
      reason: request.reason,
      willRetry: request.willRetry,
      preparation: {
        firstKeptEventId: prep.firstKeptEventId,
        tokensBefore: prep.tokensBefore,
        isSplitTurn: prep.isSplitTurn,
        previousSummary: prep.previousSummary,
        messagesToSummarize: prep.messagesToSummarize.length,
      },
      instructions,
    },
    { threadId, dispatchKey: `${key}:session_before_compact`, ...options },
  );
  const decision = before.decision;
  const by = before.decidedBy?.extension ?? "extension";
  if (decision !== undefined && decision.cancel) {
    return ok({ status: "cancelled", by, reason: decision.reason });
  }

  let summary: string;
  let firstKeptEventId = prep.firstKeptEventId;
  let fromExtension: string | null = null;
  let extraDetails: JsonValue = null;
  let summaryUsage: Usage | null = null;
  let files: { readFiles: readonly string[]; modifiedFiles: readonly string[] } = {
    readFiles: [],
    modifiedFiles: [],
  };

  if (decision !== undefined) {
    const given = decision.compaction;
    if (!events.some((event) => event.id === given.firstKeptEventId)) {
      return ok({ status: "cancelled", by, reason: "firstKeptEventId is not on this branch" });
    }
    summary = given.summary;
    firstKeptEventId = given.firstKeptEventId;
    extraDetails = given.details;
    fromExtension = by;
  } else {
    const resolved = deps.models.resolve("summary", {});
    if (!resolved.ok) {
      const error: ContextError = {
        kind: "summary_failed",
        message: `no model for the summary role: ${resolved.error.kind}`,
      };
      await failed(deps, threadId, request, key, error);
      return err(error);
    }
    const ran = await runCompaction(
      prep,
      summarizeVia(deps.models, resolved.value, {
        threadId,
        stepId: request.stepId ?? null,
        timestamp: leafEvent.recordedAt,
      }),
      SUMMARIZATION_SYSTEM_PROMPT,
      {
        reserveTokens: settings.reserveTokens,
        modelMaxTokens: resolved.value.model.maxTokens,
        ...(instructions === null ? {} : { instructions }),
        ...options,
      },
    );
    if (!ran.ok) {
      await failed(deps, threadId, request, key, ran.error);
      return err(ran.error);
    }
    summary = ran.value.summary;
    summaryUsage = ran.value.usage;
    files = { readFiles: ran.value.readFiles, modifiedFiles: ran.value.modifiedFiles };
  }

  if (summary.length > SUMMARY_MAX_CHARS) {
    const error: ContextError = {
      kind: "summary_truncated",
      message: `summary is ${summary.length} characters, the record limit is ${SUMMARY_MAX_CHARS}`,
    };
    await failed(deps, threadId, request, key, error);
    return err(error);
  }

  const details: JsonValue = {
    xeon: { reason: request.reason, stepId: request.stepId ?? null },
    readFiles: [...files.readFiles],
    modifiedFiles: [...files.modifiedFiles],
    ...(extraDetails === null ? {} : { extension: extraDetails }),
  };
  const compactedId = deps.ids.next("evt");
  const stepId = request.stepId ?? null;
  const drafts = [
    deps.producer.draft({
      id: compactedId,
      kind: "thread.compacted",
      threadId,
      turnId: null,
      stepId,
      causationId: null,
      correlationId: null,
      payload: {
        summary,
        firstKeptEventId,
        tokensBefore: prep.tokensBefore,
        details,
        usage: summaryUsage,
        fromExtension,
      },
    }),
  ];
  const prefix = newPrefixOf(deps, threadId, projected, prefixIndex, leafEvent.recordedAt);
  if (prefix !== undefined) {
    drafts.push(
      deps.producer.draft({
        id: deps.ids.next("evt"),
        kind: "item.recorded",
        threadId,
        turnId: null,
        stepId,
        causationId: compactedId,
        correlationId: null,
        payload: {
          item: {
            itemId: deps.ids.next("itm"),
            status: "completed",
            kind: "system",
            message: prefix,
          },
        },
      }),
    );
  }
  const committed = deps.session.commit({
    threadId,
    requestId: key,
    // 요약 문장은 호출마다 다르므로 지문에 넣지 않는다. 같은 키의 재시도는 처음 커밋을 돌려받는다
    fingerprintSource: { kind: "compact", reason: request.reason, stepId },
    expectedLeaf: leafEvent.id,
    build: () => ({ kind: "append", drafts, checkpoint: null }),
  });
  if (!committed.ok) {
    const error: ContextError = {
      kind: "commit_failed",
      message: `compaction commit failed: ${committed.error.kind}`,
    };
    await failed(deps, threadId, request, key, error);
    return err(error);
  }
  const result = committed.value;
  if (result.status !== "committed") {
    const error: ContextError = {
      kind: "commit_failed",
      message:
        result.status === "rejected"
          ? `compaction commit rejected: ${result.code}`
          : "compaction commit key was reused with a different request",
    };
    await failed(deps, threadId, request, key, error);
    return err(error);
  }
  const eventId = result.eventIds[0] ?? compactedId;
  await deps.ext.dispatch(
    "session_compact",
    {
      threadId,
      eventId,
      reason: request.reason,
      willRetry: request.willRetry,
      fromExtension,
      tokensBefore: prep.tokensBefore,
    },
    { threadId, dispatchKey: `${key}:session_compact`, ...options },
  );
  return ok({ status: "compacted", eventId, tokensBefore: prep.tokensBefore, fromExtension });
}

async function failed(
  deps: CompactDeps,
  threadId: ThreadId,
  request: CompactRequest,
  key: string,
  error: ContextError,
): Promise<void> {
  deps.logger?.warn("context.compaction_failed", { kind: error.kind, reason: request.reason });
  await deps.ext.dispatch(
    "session_compact_failed",
    { threadId, reason: request.reason, errorMessage: failedMessage(error) },
    {
      threadId,
      dispatchKey: `${key}:session_compact_failed`,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    },
  );
}

/** 같은 reason·stepId 컴팩션이 가지에 이미 있는지(오버플로우 두 번째 판정). 머리만이 아니라 가지 전체를 본다 */
export function hasCompactionFor(
  projected: readonly (Projected | undefined)[],
  reason: CompactReason,
  stepId: StepId,
): boolean {
  return projected.some((entry) => {
    if (entry?.type !== "compacted") return false;
    const details = entry.payload.details;
    if (!isJsonObject(details)) return false;
    const xeon = details["xeon"];
    if (!isJsonObject(xeon)) return false;
    return xeon["reason"] === reason && xeon["stepId"] === stepId;
  });
}
