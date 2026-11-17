import { canonicalJson, ok, type Logger, type Result } from "@fresnel/contracts";
import type {
  EventId,
  Message,
  ModelThinkingLevel,
  SystemMessage,
  ThreadId,
  UserMessage,
} from "@fresnel/contracts/conversation";
import type { ContextMaterialFact } from "@fresnel/contracts/extensions";
import type {
  AssembleOptions,
  AssembledContext,
  ContextComposition,
  ContextError,
  ContextWarning,
  ModelBinding,
  ModelService,
  PendingSystemItem,
  PrefixInfo,
  ToolChangeDecision,
} from "@fresnel/contracts/services";
import type { DurableEventEnvelope } from "@fresnel/contracts/records";
import type { ExtHost } from "@fresnel/ext-host";
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
import { maskMessages, type MessageMasker } from "./mask-messages.ts";
import { resolveImageBlobs, type BlobByHashReader } from "./resolve-blobs.ts";
import { convertToLlm } from "./convert.ts";
import { buildPrefixMessage, prefixHash, prefixToolset, replaySystemMessages } from "./prefix.ts";
import { DEFAULT_CONTEXT_SETTINGS, type ContextSettings } from "./settings.ts";
import { decideToolChange } from "./toolset-diff.ts";

// L1.context.spec §4.1 조립 순서: 가지 읽기 → 컴팩션 머리 → 메시지 변환 → context 지점 → 도구·절 변경 →
// request.system.before 지점 → 캐시 표식 → volatile → 추정(§4.2~§4.5). 커밋하지 않는다.

export interface AssembleDeps extends BranchReaderDeps {
  readonly models: Pick<ModelService, "tokens">;
  readonly ext: Pick<ExtHost, "dispatch">;
  /** 호출 시점의 유효 설정. 없으면 기본값이다 */
  readonly settings?: () => ContextSettings;
  /** 컴팩션 머리 앞에 있어도 요약 뒤에 다시 넣는 custom 메시지의 customType. 없으면 재주입하지 않는다 */
  readonly reinject?: ReadonlySet<string>;
  /** 모델 입력 사후 가림(L0.secrets.spec §3.5.1). 없으면 가리지 않는다 */
  readonly redactor?: MessageMasker;
  /** 이미지 `blob:sha256:<hex>` 자리표시를 모델 요청에서 base64로 푸는 읽기(`fresnel.store`). 없으면 풀지 않는다 */
  readonly readBlobByHash?: BlobByHashReader;
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
async function applyContextHook(
  deps: AssembleDeps,
  threadId: ThreadId,
  opts: AssembleOptions,
  assembled: readonly Message[],
): Promise<{ readonly messages: readonly Message[]; readonly appliers: readonly HookApplier[] }> {
  const visible = assembled.filter((message) => !isSystem(message));
  // 디스패치가 payload를 동결하고 핸들러가 current를 고칠 수 있으므로 저장소가 준 객체는 복사해서 넘긴다
  const outcome = await deps.ext.dispatch(
    "request.context.before",
    { messages: structuredClone(visible) },
    {
      threadId,
      dispatchKey: `${opts.stepId}:request.context.before`,
      initial: { messages: structuredClone(visible) },
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    },
  );
  const appliers = outcome.applied.map(applierOf);
  if (outcome.applied.length === 0) return { messages: assembled, appliers };
  const systemState = replaySystemMessages(assembled.filter(isSystem));
  const returned = convertToLlm(outcome.value.messages);
  return { messages: systemState === undefined ? returned : [systemState, ...returned], appliers };
}

/** 합치기 훅에서 값을 적용한 핸들러. 캐시 사건의 원인 소유자다(T-MEAS-CACHE) */
interface HookApplier {
  readonly registrationId: string;
  readonly plugin: string;
}

function applierOf(ref: { readonly scopeId: string; readonly extension: string }): HookApplier {
  return { registrationId: ref.scopeId, plugin: ref.extension };
}

/** 접두 시스템 메시지의 바뀐 부분. 본문(`system`)과 절(`sections`)을 따로 비교한다 */
function changedPartsOf(before: Message | undefined, after: Message | undefined): string[] {
  if (before === undefined || after === undefined) return ["messages"];
  if (before.role !== "system" || after.role !== "system") return ["messages"];
  const parts: string[] = [];
  if (before.content !== after.content) parts.push("system");
  if (canonicalJson(before.sections ?? {}) !== canonicalJson(after.sections ?? {})) {
    parts.push("sections");
  }
  return parts.length === 0 ? ["messages"] : parts;
}

/** 두 메시지 배열이 처음 달라지는 위치. 같으면 null */
function firstDifference(before: readonly Message[], after: readonly Message[]): number | null {
  const length = Math.max(before.length, after.length);
  for (let index = 0; index < length; index += 1) {
    const left = before[index];
    const right = after[index];
    if (left === undefined || right === undefined) return index;
    if (canonicalJson(left) !== canonicalJson(right)) return index;
  }
  return null;
}

/** request.system.before 지점(chain)을 전체 배열로 발화한다(§4.1 5번). 결과가 최종 messages다 */
async function applyContextWithSystemHook(
  deps: AssembleDeps,
  threadId: ThreadId,
  opts: AssembleOptions,
  assembled: readonly Message[],
): Promise<{
  readonly messages: readonly Message[];
  readonly changed: boolean;
  readonly appliers: readonly HookApplier[];
}> {
  const outcome = await deps.ext.dispatch(
    "request.system.before",
    { messages: structuredClone([...assembled]) },
    {
      threadId,
      dispatchKey: `${opts.stepId}:request.system.before`,
      initial: { messages: structuredClone([...assembled]) },
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    },
  );
  const appliers = outcome.applied.map(applierOf);
  if (outcome.applied.length === 0) return { messages: assembled, changed: false, appliers };
  return { messages: convertToLlm(outcome.value.messages), changed: true, appliers };
}

/** 글자 수 / 4 올림. pi-ai 추정과 같은 규칙이다 */
function textTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** 소유자를 정할 수 없는 재료의 자리 값(로더 미병합. §4.5 규칙 27) */
const UNOWNED_PLUGIN = "none";
const PLUGIN_SECTION_PREFIX = "plugin:";

/** 절 키 `plugin:<이름>:<경로>`(MaterialPort 지침 키 모양)에서 소유자와 경로를 읽는다. 모양이 다르면 소유자를 정하지 않는다 */
function sectionOwnerOf(key: string): { readonly plugin: string; readonly ref: string } {
  if (!key.startsWith(PLUGIN_SECTION_PREFIX)) return { plugin: UNOWNED_PLUGIN, ref: key };
  const rest = key.slice(PLUGIN_SECTION_PREFIX.length);
  const cut = rest.indexOf(":");
  if (cut <= 0 || cut === rest.length - 1) return { plugin: UNOWNED_PLUGIN, ref: key };
  return { plugin: rest.slice(0, cut), ref: rest.slice(cut + 1) };
}

/**
 * 이번 요청의 재료(§4.5 규칙 26·27). 입력이 이미 가진 값만 쓴다: 기본 프롬프트, 절(키의 소유자), 덧씌운 지침(`volatile.instructions`),
 * 합치기 훅이 더한 몫(적용한 핸들러의 첫 플러그인). 스킬 색인·기억은 사용자 정의 메시지로 들어와 여기서 가리지 못하므로 빠진다
 */
function materialsOf(input: {
  readonly basePrompt: string;
  readonly sections: Readonly<Record<string, string>>;
  readonly volatile: Readonly<Record<string, string>>;
  readonly hookInjected: number;
  readonly hookAppliers: readonly HookApplier[];
}): ContextMaterialFact[] {
  const out: ContextMaterialFact[] = [];
  if (input.basePrompt !== "") {
    out.push({
      plugin: UNOWNED_PLUGIN,
      versionId: null,
      registrationId: null,
      kind: "always",
      material: "instruction",
      ref: "base-prompt",
      tokens: textTokens(input.basePrompt),
      truncated: false,
      omitted: null,
      itemId: null,
      attribution: "shared",
    });
  }
  for (const key of Object.keys(input.sections).toSorted()) {
    const text = input.sections[key];
    if (text === undefined || text === "") continue;
    const owner = sectionOwnerOf(key);
    out.push({
      plugin: owner.plugin,
      versionId: null,
      registrationId: null,
      kind: "always",
      material: "instruction",
      ref: owner.ref.slice(0, 256),
      tokens: textTokens(text),
      truncated: false,
      omitted: null,
      itemId: null,
      attribution: owner.plugin === UNOWNED_PLUGIN ? "shared" : "declared",
    });
  }
  const addition = input.volatile["instructions"];
  if (addition !== undefined && addition !== "") {
    out.push({
      plugin: UNOWNED_PLUGIN,
      versionId: null,
      registrationId: null,
      kind: "always",
      material: "instruction",
      ref: "prompt-addition",
      tokens: textTokens(addition),
      truncated: false,
      omitted: null,
      itemId: null,
      attribution: "shared",
    });
  }
  if (input.hookInjected > 0) {
    // 기여를 모르는 훅 메시지는 한 덩어리다. 소유자는 적용한 핸들러의 첫 플러그인이고 `shared`다(§4.5 규칙 27)
    const first = input.hookAppliers[0];
    out.push({
      plugin: first?.plugin ?? UNOWNED_PLUGIN,
      versionId: null,
      registrationId: first?.registrationId ?? null,
      kind: "always",
      material: "hook_text",
      ref: "request-hooks",
      tokens: input.hookInjected,
      truncated: false,
      omitted: null,
      itemId: null,
      attribution: "shared",
    });
  }
  return out;
}

/** 요청 구성 토큰(T-MEAS-CTX). 절은 이름이 소유자다. history는 total에서 나머지를 뺀 값이라 합이 항상 total과 같다(음수면 0) */
function compositionOf(input: {
  readonly prefix: SystemMessage;
  readonly prefixTokens: number;
  readonly tools: AssembleOptions["tools"];
  readonly injected: number;
  readonly volatile: number;
  readonly total: number;
}): ContextComposition {
  const sections: Record<string, number> = {};
  let sectionSum = 0;
  for (const [name, text] of Object.entries(input.prefix.sections ?? {})) {
    if (text === null) continue;
    const tokens = textTokens(text);
    sections[name] = tokens;
    sectionSum += tokens;
  }
  const system = Math.max(0, input.prefixTokens - sectionSum);
  const history = Math.max(0, input.total - system - sectionSum - input.injected - input.volatile);
  return {
    system,
    tools: textTokens(canonicalJson(input.tools.map((tool) => tool.wire))),
    sections,
    injected: input.injected,
    volatile: input.volatile,
    history,
    total: input.total,
  };
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
    settings.reinjectRecentFiles,
  );
  messages.push(...appended);

  const tokensBeforeHooks = deps.models.tokens.estimateContext(messages).tokens;
  const afterContext = await applyContextHook(deps, threadId, opts, messages);
  const withSystem = await applyContextWithSystemHook(deps, threadId, opts, afterContext.messages);
  const finalMessages: Message[] = [...withSystem.messages];
  if (withSystem.changed) {
    const first = finalMessages[0];
    if (first === undefined || canonicalJson(first) !== canonicalJson(prefixMessage)) {
      // 위치는 훅을 거치기 전 요청과 처음 달라지는 메시지, 원인은 값을 적용한 핸들러(두 합치기 훅 모두)다
      const appliers = [...afterContext.appliers, ...withSystem.appliers];
      warnings.push({
        code: "cache_prefix_reset",
        at: firstDifference(messages, finalMessages) ?? 0,
        changed: changedPartsOf(messages[0], first),
        owners: appliers.map((item) => item.registrationId),
        plugins: [...new Set(appliers.map((item) => item.plugin))],
      });
    }
  }

  const tokensAfterHooks = deps.models.tokens.estimateContext(finalMessages).tokens;
  const hookInjected = Math.max(0, tokensAfterHooks - tokensBeforeHooks);
  const hookAppliers = [...afterContext.appliers, ...withSystem.appliers];
  const cacheMarks = computeCacheMarks(opts.cachePolicy, finalMessages);

  // volatile 계층은 표식 뒤, 대화 끝에 둔다. 커밋하지 않는 조립 전용 메시지다(§4.1)
  let volatileTokens = 0;
  if (Object.keys(opts.volatile).length > 0) {
    const text = volatileText(opts.volatile);
    if (opts.cachePolicy.midConversationSystem) {
      finalMessages.push({ role: "system", content: text, timestamp });
    } else {
      const note: UserMessage = { role: "user", content: text, timestamp };
      finalMessages.push(note);
    }
    volatileTokens = Math.max(
      0,
      deps.models.tokens.estimateContext(finalMessages).tokens - tokensAfterHooks,
    );
  }

  // 모델 입력 사후 가림. 표식은 위에서 인덱스로만 정해졌으므로 내용을 바꿔도 같다. 접두 판정(cache_prefix_reset, prefixHash)은 가리기 전 값으로 했다
  const masked =
    deps.redactor === undefined ? finalMessages : maskMessages(deps.redactor, finalMessages);
  // 이미지 자리표시는 요청에서만 푼다(기록과 접두 판정은 자리표시 그대로). 풀 수 없으면 자리 문장으로 바꾼다
  const outgoing =
    deps.readBlobByHash === undefined
      ? masked
      : resolveImageBlobs(deps.readBlobByHash, masked, deps.logger);
  const estimate = deps.models.tokens.estimateContext(outgoing);
  if (estimate.tokens > opts.contextWindow - settings.reserveTokens) {
    warnings.push({
      code: "near_window",
      tokens: estimate.tokens,
      contextWindow: opts.contextWindow,
    });
  }

  const composition = compositionOf({
    prefix: prefixMessage,
    prefixTokens: deps.models.tokens.estimateMessage(prefixMessage),
    tools: opts.tools,
    injected: hookInjected,
    volatile: volatileTokens,
    total: estimate.tokens,
  });
  const materials = materialsOf({
    basePrompt: opts.basePrompt,
    sections: opts.sections,
    volatile: opts.volatile,
    hookInjected,
    hookAppliers,
  });

  const prefix: PrefixInfo = {
    prefixHash: prefixHash(prefixMessage),
    toolset: await prefixToolset(prefixMessage),
    recordedAt: prefixEventId,
  };
  return ok({
    messages: outgoing,
    prefix,
    toolChange,
    cacheMarks,
    estimate,
    composition,
    materials,
    compactionHead:
      head === null ? null : { eventId: head.eventId, firstKeptEventId: head.firstKeptEventId },
    pendingItems,
    warnings,
  });
}
