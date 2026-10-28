import { canonicalJson, ok, type Logger, type Result } from "@xeon/contracts";
import type {
  EventId,
  Message,
  ModelThinkingLevel,
  SystemMessage,
  ThreadId,
  UserMessage,
} from "@xeon/contracts/conversation";
import type {
  AssembleOptions,
  AssembledContext,
  ContextError,
  ContextWarning,
  ModelBinding,
  ModelService,
  PendingSystemItem,
  PrefixInfo,
  ToolChangeDecision,
} from "@xeon/contracts/services";
import type { DurableEventEnvelope } from "@xeon/contracts/records";
import type { ExtHost } from "@xeon/ext-host";
import {
  findHead,
  effectiveMessages,
  findPrefixIndex,
  isSystem,
  projectBranch,
  readBranchEvents,
  systemMessageOf,
  type BranchReaderDeps,
} from "./branch.ts";
import { computeCacheMarks } from "./cache-marks.ts";
import { convertToLlm } from "./convert.ts";
import { buildPrefixMessage, prefixHash, prefixToolset, replaySystemMessages } from "./prefix.ts";
import { DEFAULT_CONTEXT_SETTINGS, type ContextSettings } from "./settings.ts";
import { decideToolChange } from "./toolset-diff.ts";

// L1.context.spec §4.1 조립 순서: 가지 읽기 → 컴팩션 머리 → 메시지 변환 → context 지점 → 도구·절 변경 →
// context_with_system 지점 → 캐시 표식 → volatile → 추정(§4.2~§4.5). 커밋하지 않는다.

export interface AssembleDeps extends BranchReaderDeps {
  readonly models: Pick<ModelService, "tokens">;
  readonly ext: Pick<ExtHost, "dispatch">;
  /** 호출 시점의 유효 설정. 없으면 기본값이다 */
  readonly settings?: () => ContextSettings;
  /** 컴팩션 머리 앞에 있어도 요약 뒤에 다시 넣는 custom 메시지의 customType. 없으면 재주입하지 않는다 */
  readonly reinject?: ReadonlySet<string>;
  readonly logger?: Logger;
}

interface PreviousModel {
  readonly provider: string;
  readonly modelId: string;
  readonly thinkingLevel: ModelThinkingLevel | null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return isRecord(value) ? value : undefined;
}

/** 가지 위 마지막 checkpoint.step의 모델. 없거나 모양이 다르면 undefined */
function previousModelOf(events: readonly DurableEventEnvelope[]): PreviousModel | undefined {
  const last = events.findLast((event) => event.kind === "checkpoint.step");
  const model = recordOf(recordOf(last?.payload)?.["model"]);
  const provider = model?.["provider"];
  const modelId = model?.["modelId"];
  if (typeof provider !== "string" || typeof modelId !== "string") return undefined;
  return { provider, modelId, thinkingLevel: null };
}

/**
 * 이전 단계 바인딩과 provider 또는 모델이 다르면 접두 캐시가 깨진다(§4.4). 레벨만 다르면 경고하지 않는다.
 * 체크포인트에는 role이 없으므로 이번 바인딩의 role을 쓴다
 */
function modelSwitchWarning(
  events: readonly DurableEventEnvelope[],
  binding: ModelBinding,
): ContextWarning | undefined {
  const previous = previousModelOf(events);
  if (previous === undefined) return undefined;
  if (previous.provider === binding.provider && previous.modelId === binding.modelId) {
    return undefined;
  }
  return {
    code: "cache_reset_model_switch",
    from: {
      role: binding.role,
      provider: previous.provider,
      modelId: previous.modelId,
      thinkingLevel: binding.thinkingLevel,
    },
    to: binding,
  };
}

/** 이번 절 값과 접두가 가진 절의 차이. 바뀐 절만 담고 사라진 절은 null이다 */
function sectionChanges(
  current: Readonly<Record<string, string | null>>,
  desired: Readonly<Record<string, string>>,
): Record<string, string | null> {
  const changes: Record<string, string | null> = {};
  for (const name of Object.keys(desired).toSorted()) {
    const value = desired[name];
    if (value !== undefined && current[name] !== value) changes[name] = value;
  }
  for (const name of Object.keys(current).toSorted()) {
    if (current[name] !== undefined && current[name] !== null && !(name in desired)) {
      changes[name] = null;
    }
  }
  return changes;
}

/** volatile 계층(날짜, 작업 디렉터리 상태). 이름순으로 한 덩어리 텍스트를 만든다 */
function volatileText(volatile: Readonly<Record<string, string>>): string {
  return Object.keys(volatile)
    .toSorted()
    .map((name) => `<${name}>\n${volatile[name] ?? ""}\n</${name}>`)
    .join("\n");
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

/** context_with_system 지점(chain)을 전체 배열로 발화한다(§4.1 5번). 결과가 최종 messages다 */
async function applyContextWithSystemPoint(
  deps: AssembleDeps,
  threadId: ThreadId,
  opts: AssembleOptions,
  assembled: readonly Message[],
): Promise<{ readonly messages: readonly Message[]; readonly changed: boolean }> {
  const outcome = await deps.ext.dispatch(
    "context_with_system",
    { messages: structuredClone([...assembled]) },
    {
      threadId,
      dispatchKey: `${opts.stepId}:context_with_system`,
      initial: { messages: structuredClone([...assembled]) },
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    },
  );
  if (outcome.applied.length === 0) return { messages: assembled, changed: false };
  return { messages: convertToLlm(outcome.value.messages), changed: true };
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
  const settings = deps.settings?.() ?? DEFAULT_CONTEXT_SETTINGS;

  const head = findHead(deps, events, projected);
  const prefixIndex = findPrefixIndex(projected, head);
  const recordedPrefix = systemMessageOf(projected[prefixIndex]);
  const recordedPrefixEvent = events[prefixIndex];
  const leafEvent = events.at(-1);
  const timestamp = leafEvent === undefined ? 0 : leafEvent.recordedAt;

  const pendingItems: PendingSystemItem[] = [];
  const warnings: ContextWarning[] = [];
  /** 이번 조립에서 접두·기록된 메시지 뒤에 이어 붙일 도구 변경·절 갱신 메시지 */
  const appended: SystemMessage[] = [];
  let toolChange: ToolChangeDecision | null = null;
  let prefixMessage: SystemMessage;
  let prefixEventId: EventId | null = null;
  if (recordedPrefix !== undefined && recordedPrefixEvent !== undefined) {
    prefixMessage = recordedPrefix;
    prefixEventId = recordedPrefixEvent.id;
    // 기록된 접두 뒤의 도구 변경·절 갱신을 적용한 현재 광고 상태
    const state = replaySystemMessages(
      projected.slice(prefixIndex).flatMap((entry) => systemMessageOf(entry) ?? []),
    );
    const change = decideToolChange({
      advertised: state?.toolsAdded,
      next: opts.tools,
      policy: opts.cachePolicy,
      timestamp,
    });
    toolChange = change.decision;
    warnings.push(...change.warnings);
    if (change.pending !== null && change.message !== null) {
      pendingItems.push(change.pending);
      appended.push(change.message);
    }
    // 절 갱신은 대화 중 system 메시지를 지원할 때만 바로 넣고, 아니면 다음 컴팩션까지 미룬다(§4.1)
    if (opts.cachePolicy.midConversationSystem) {
      const changes = sectionChanges(state?.sections ?? {}, opts.sections);
      if (Object.keys(changes).length > 0) {
        const message: SystemMessage = {
          role: "system",
          content: "",
          sections: changes,
          timestamp,
        };
        pendingItems.push({ purpose: "sections", message });
        appended.push(message);
      }
    }
  } else {
    prefixMessage = buildPrefixMessage({
      basePrompt: opts.basePrompt,
      sections: opts.sections,
      tools: opts.tools,
      timestamp,
    });
    pendingItems.push({ purpose: "prefix", message: prefixMessage });
    toolChange = {
      action: "readvertise",
      reason: head === null ? "first_request" : "compaction",
      firstChangedIndex: opts.tools.length === 0 ? null : 0,
    };
  }

  const switched = modelSwitchWarning(events, opts.binding);
  if (switched !== undefined) warnings.push(switched);

  const messages = effectiveMessages(
    events,
    projected,
    head,
    prefixIndex,
    prefixMessage,
    deps.reinject,
  );
  messages.push(...appended);

  const afterContext = await applyContextPoint(deps, threadId, opts, messages);
  const withSystem = await applyContextWithSystemPoint(deps, threadId, opts, afterContext);
  const finalMessages: Message[] = [...withSystem.messages];
  if (withSystem.changed) {
    const first = finalMessages[0];
    if (first === undefined || canonicalJson(first) !== canonicalJson(prefixMessage)) {
      warnings.push({ code: "cache_prefix_reset", at: 0 });
    }
  }

  const cacheMarks = computeCacheMarks(opts.cachePolicy, finalMessages);

  // volatile 계층은 표식 뒤, 대화 끝에 둔다. 커밋하지 않는 조립 전용 메시지다(§4.1)
  if (Object.keys(opts.volatile).length > 0) {
    const text = volatileText(opts.volatile);
    if (opts.cachePolicy.midConversationSystem) {
      finalMessages.push({ role: "system", content: text, timestamp });
    } else {
      const note: UserMessage = { role: "user", content: text, timestamp };
      finalMessages.push(note);
    }
  }

  const estimate = deps.models.tokens.estimateContext(finalMessages);
  if (estimate.tokens > opts.contextWindow - settings.reserveTokens) {
    warnings.push({
      code: "near_window",
      tokens: estimate.tokens,
      contextWindow: opts.contextWindow,
    });
  }

  const prefix: PrefixInfo = {
    prefixHash: prefixHash(prefixMessage),
    toolset: await prefixToolset(prefixMessage),
    recordedAt: prefixEventId,
  };
  return ok({
    messages: finalMessages,
    prefix,
    toolChange,
    cacheMarks,
    estimate,
    compactionHead:
      head === null ? null : { eventId: head.eventId, firstKeptEventId: head.firstKeptEventId },
    pendingItems,
    warnings,
  });
}
