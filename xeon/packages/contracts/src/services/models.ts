import { Type, type TString, type TUnsafe } from "typebox";
import type { Result, SchemaProof } from "../base/index.ts";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  CacheRetention,
  Context,
  Message,
  Model,
  ModelThinkingLevel,
  Provider,
  SimpleStreamOptions,
  StepId,
  StopReason,
  StreamFn,
  ThinkingBudgets,
  ThreadId,
  TurnId,
  Usage,
} from "../conversation/index.ts";
import type {
  ModelsPort,
  PortKey,
  ProviderResourceDef,
  ScopeId,
  Unsubscribe,
} from "../extensions/index.ts";

// L1.models.spec §3.2~§3.8. 구현은 core-models다. 모델·캐시 값 타입은 여러 서비스가 쓰므로 이 파일에 두고
// services/context.ts가 가져간다(F.capabilities.spec §3.12 규칙 3).
// 2차 타입(계정 풀·레이트 리밋·폴백·구조화 출력, L1.models.spec §3.10)은 M3 이후에 더한다.

export type {
  Api,
  AssistantMessageEventStream,
  CacheRetention,
  Context,
  Model,
  Provider,
  SimpleStreamOptions,
  StreamFn,
  ThinkingBudgets,
};

export const ModelServiceName = "xeon.models" as const;

/**
 * `xeon.models` 전체 모양(ModelService)의 포트 키. 제공 core-models, 소비 core-context 등.
 * 등록 부분형(ModelsPort)의 키는 extensions의 `ModelsPortKey`이고 이름은 같다.
 */
export const ModelServicePortKey: PortKey<ModelService> = { name: ModelServiceName };

// ── 역할과 참조 ──────────────────────────────────────────────────────────

export const MODEL_ROLES: readonly ["main", "review", "summary", "subagent", "judge", "search"] = [
  "main",
  "review",
  "summary",
  "subagent",
  "judge",
  "search",
];
export type ModelRole = (typeof MODEL_ROLES)[number];
export const ModelRoleSchema: TUnsafe<ModelRole> = Type.Unsafe<ModelRole>(
  Type.String({ enum: MODEL_ROLES, minLength: 4, maxLength: 8 }),
);

/** provider: ^[a-z0-9][a-z0-9._-]{0,63}$, modelId: 공백 없는 1~200자. 접미 ":레벨"은 ModelThinkingLevel 값일 때만 레벨로 읽는다 */
export const MODEL_REF_PATTERN: string = "^[a-z0-9][a-z0-9._-]{0,63}/\\S{1,200}$";
export type ModelRefString = string;
export const ModelRefStringSchema: TString = Type.String({
  pattern: MODEL_REF_PATTERN,
  maxLength: 265,
});

export interface ModelRef {
  readonly provider: string;
  readonly modelId: string;
  readonly thinkingLevel: ModelThinkingLevel | null;
}

export type ModelRefError =
  | { readonly kind: "malformed"; readonly input: string }
  | { readonly kind: "empty_model_id"; readonly input: string };

const PROVIDER_REGEX = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * ModelThinkingLevel 값 목록. services는 하위 F 디렉터리에서 값을 import하지 않으므로(타입만 import한다)
 * conversation의 MODEL_THINKING_LEVELS와 같은 값을 여기 적는다. 같은지는 test/services/models.test.ts가 확인한다.
 */
export const THINKING_LEVELS: readonly ModelThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

function levelOf(value: string): ModelThinkingLevel | undefined {
  return THINKING_LEVELS.find((level) => level === value);
}

/**
 * 순수 함수. 첫 `/` 앞이 provider, 나머지가 modelId다. modelId가 `:`로 끝나는 마디를 가지고 그 마디가
 * ModelThinkingLevel 값이면 레벨로 떼어 낸다. 그 밖의 `:`는 modelId의 일부다(예: Bedrock `anthropic.claude-…-v1:0`).
 * modelId 안의 `/`도 허용한다(예: OpenRouter `openrouter/anthropic/claude-…`).
 */
export function parseModelRef(input: string): Result<ModelRef, ModelRefError> {
  const slash = input.indexOf("/");
  if (slash < 0) return { ok: false, error: { kind: "malformed", input } };
  const provider = input.slice(0, slash);
  const rest = input.slice(slash + 1);
  if (!PROVIDER_REGEX.test(provider) || /\s/.test(rest)) {
    return { ok: false, error: { kind: "malformed", input } };
  }
  const colon = rest.lastIndexOf(":");
  const suffix = colon >= 0 ? rest.slice(colon + 1) : "";
  const level = colon >= 0 ? levelOf(suffix) : undefined;
  const modelId = level === undefined ? rest : rest.slice(0, colon);
  if (modelId.length === 0) return { ok: false, error: { kind: "empty_model_id", input } };
  if (modelId.length > 200) return { ok: false, error: { kind: "malformed", input } };
  return { ok: true, value: { provider, modelId, thinkingLevel: level ?? null } };
}

/** 순수 함수. parseModelRef의 역이다 */
export function formatModelRef(ref: ModelRef): ModelRefString {
  const base = `${ref.provider}/${ref.modelId}`;
  return ref.thinkingLevel === null ? base : `${base}:${ref.thinkingLevel}`;
}

/** StepCheckpoint.model(F.records.spec §3.6)과 같은 세 필드 + role */
export interface ModelBinding {
  readonly role: ModelRole;
  readonly provider: string;
  readonly modelId: string;
  readonly thinkingLevel: ModelThinkingLevel;
}
const modelBindingShape = Type.Object(
  {
    role: ModelRoleSchema,
    provider: Type.String({ pattern: "^[a-z0-9][a-z0-9._-]{0,63}$", maxLength: 64 }),
    modelId: Type.String({ minLength: 1, maxLength: 200 }),
    thinkingLevel: Type.Unsafe<ModelThinkingLevel>(
      Type.String({ enum: THINKING_LEVELS, minLength: 3, maxLength: 7 }),
    ),
  },
  { additionalProperties: false },
);

export const ModelBindingSchema: TUnsafe<ModelBinding> = Type.Unsafe<ModelBinding>(
  modelBindingShape satisfies SchemaProof<ModelBinding, typeof modelBindingShape>,
);

// ── 캐시 정책 ────────────────────────────────────────────────────────────

export type CacheSite = "system" | "tools" | "summary" | "tail";

export interface CachePolicy {
  /** pi-ai cacheRetention. "none" | "short" | "long" */
  readonly retention: CacheRetention;
  /** pi-ai sessionId로 보낼 값. 기본은 threadId. retention이 "none"이면 null */
  readonly sessionKey: "thread" | null;
  /** 표식 위치 우선순위. 앞이 먼저 남는다. 길이는 maxBreakpoints 이하 */
  readonly sites: readonly CacheSite[];
  /** provider 상한. anthropic-messages는 4 */
  readonly maxBreakpoints: number;
  /** 대화 중 SystemMessage(toolsAdded·toolsRemoved·sections) 지원 여부. model.compat에서 읽는다 */
  readonly midConversationSystem: boolean;
  /** 대화 중 도구 변경 지원 여부 */
  readonly midConversationToolChanges: boolean;
}

export interface CacheMarks {
  readonly policy: CachePolicy;
  /** messageIndex는 Context.messages 기준. system·tools 표식은 null */
  readonly marks: readonly {
    readonly site: CacheSite;
    readonly messageIndex: number | null;
  }[];
}

// ── 해석과 호출 ──────────────────────────────────────────────────────────

export interface RoleOverrides {
  /** 호출자가 직접 지정한 참조. 서브에이전트 정의 파일의 model 필드(L1.agents) */
  readonly ref?: ModelRefString;
  /** 그룹 덮어쓰기 조회 키. 호출을 일으킨 scope */
  readonly scopeId?: ScopeId;
  /** 레벨만 덮어쓴다. ref의 접미보다 우선한다 */
  readonly thinkingLevel?: ModelThinkingLevel;
}

export type ResolutionSource =
  | "explicit"
  | `group:${string}`
  | "role"
  | "role-fallback"
  | "default"
  | "checkpoint";

export interface ResolvedModel {
  readonly binding: ModelBinding;
  readonly source: ResolutionSource;
  /** 해석 순서에서 거친 단계. 디버깅과 설정 화면의 "출처" 표시용 */
  readonly trace: readonly {
    readonly step: ResolutionSource;
    readonly ref: ModelRefString | null;
  }[];
  /** 카탈로그 항목 */
  readonly model: Model<Api>;
  /** 레벨별 토큰 예산. 레벨이 off이거나 provider가 토큰 예산을 쓰지 않으면 null */
  readonly thinkingBudgetTokens: number | null;
  readonly cachePolicy: CachePolicy;
}

export interface ModelCallContext {
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly stepId: StepId | null;
  readonly role: ModelRole;
  /** 사용량을 귀속할 scope. 그룹이 일으킨 호출이면 그 scope */
  readonly scopeId?: ScopeId;
  readonly signal?: AbortSignal;
}

export interface ModelCallOptions {
  readonly maxTokens?: number;
  readonly toolChoice?: "auto" | "none";
  readonly temperature?: number;
  /** 정책의 보존 기간을 이 호출에서만 바꾼다. 요약 호출은 "none" */
  readonly cacheRetention?: CacheRetention;
  /** L1.context가 계산한 표식. 없으면 provider 기본 위치 */
  readonly cacheMarks?: CacheMarks;
}

export interface ModelCallRequest extends ModelCallContext {
  readonly resolved: ResolvedModel;
  /** 조립된 컨텍스트(L1.context AssembledContext.messages를 담은 pi-ai Context) */
  readonly context: Context;
  readonly options?: ModelCallOptions;
}

export interface ModelListFilter {
  readonly provider?: string;
  /** 자격 증명이 있는 provider만 */
  readonly available?: boolean;
  readonly reasoning?: boolean;
}

export interface ModelInfo {
  /** "provider/modelId" */
  readonly ref: ModelRefString;
  readonly name: string;
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly reasoning: boolean;
  readonly input: readonly ("text" | "image")[];
  readonly cost: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
  };
  readonly supportedThinkingLevels: readonly ModelThinkingLevel[];
  readonly available: boolean;
}

// ── 토큰 추정 ────────────────────────────────────────────────────────────

/** pi-ai utils/estimate.ts ContextUsageEstimate와 같은 모양 */
export interface ContextUsageEstimate {
  readonly tokens: number;
  readonly usageTokens: number;
  readonly trailingTokens: number;
  readonly lastUsageIndex: number | null;
}

export interface TokenEstimator {
  estimateMessage(message: Message): number;
  estimateContext(messages: readonly Message[]): ContextUsageEstimate;
  fromUsage(usage: Usage): number;
}

// ── 사용량 ───────────────────────────────────────────────────────────────

export interface UsageRecord {
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly stepId: StepId | null;
  readonly role: ModelRole;
  readonly scopeId: ScopeId | null;
  readonly provider: string;
  readonly modelId: string;
  /** pi-ai Usage 그대로. cost는 calculateCost 결과 */
  readonly usage: Usage;
  readonly stopReason: StopReason;
  /** stopReason이 "aborted"이거나 사용자 중단 */
  readonly aborted: boolean;
  /** ms */
  readonly recordedAt: number;
}

export interface UsageTotals {
  readonly calls: number;
  readonly abortedCalls: number;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  /** 보고한 provider만 합산 */
  readonly reasoning: number;
  readonly totalTokens: number;
  /** USD */
  readonly costTotal: number;
}

export interface UsageScope {
  readonly threadId: ThreadId;
  readonly turnId?: TurnId;
  readonly role?: ModelRole;
  readonly scopeId?: ScopeId;
}

/** 프로세스 메모리의 합산기. 내구 기록의 원천은 어시스턴트 item.recorded의 message.usage와 turn.completed다 */
export interface UsageMeter {
  totals(scope: UsageScope): UsageTotals;
  subscribe(listener: (record: UsageRecord) => void): Unsubscribe;
}

// ── provider 등록 ────────────────────────────────────────────────────────

/** F.wire-settings.spec §3.8.1 SecretRef 형식의 문자열 */
export type SecretRefString = string;

export interface ProviderModelDef {
  readonly id: string;
  readonly name?: string;
  readonly api?: Api;
  readonly reasoning: boolean;
  readonly input: readonly ("text" | "image")[];
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly cost?: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
  };
}

/** JSON으로 표현되는 provider. pi registerProvider(name, ProviderConfig)의 직렬화 가능한 부분 */
export interface ProviderConfigDef {
  readonly kind: "config";
  readonly name?: string;
  readonly baseUrl?: string;
  readonly api?: Api;
  /** 키는 참조만 받는다. 리터럴, $ENV, !command 형식은 거부한다 */
  readonly apiKey?: SecretRefString;
  /** 비밀 금지. 값에 secret:// 를 쓰면 요청 직전 해석 */
  readonly headers?: Readonly<Record<string, string>>;
  readonly models?: readonly ProviderModelDef[];
}

/** 코드로 만든 provider. 위장 provider 플러그인이 쓴다 */
export interface ProviderRuntimeDef {
  readonly kind: "runtime";
  readonly provider: Provider;
  /** 이 provider의 자격 증명 참조. 요청 직전 해석해 AuthResolutionOverrides.apiKey로 넣는다 */
  readonly credential?: SecretRefString;
}

export type ProviderDef = ProviderConfigDef | ProviderRuntimeDef;

const ModelDefSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 200 }),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    api: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    reasoning: Type.Boolean(),
    input: Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")]), {
      minItems: 1,
      maxItems: 2,
    }),
    contextWindow: Type.Integer({ minimum: 1 }),
    maxTokens: Type.Integer({ minimum: 1 }),
    cost: Type.Optional(
      Type.Object(
        {
          input: Type.Number({ minimum: 0 }),
          output: Type.Number({ minimum: 0 }),
          cacheRead: Type.Number({ minimum: 0 }),
          cacheWrite: Type.Number({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

/** registerProvider(포트 경로)가 config를 검사하는 스키마. 키는 비밀 참조만 받는다 */
const providerConfigDefShape = Type.Object(
  {
    kind: Type.Literal("config"),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    baseUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    api: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    apiKey: Type.Optional(
      Type.String({ pattern: "^secret://[a-z][a-z0-9-]{1,63}$", maxLength: 75 }),
    ),
    headers: Type.Optional(Type.Record(Type.String(), Type.String({ maxLength: 4096 }))),
    models: Type.Optional(Type.Array(ModelDefSchema, { maxItems: 512 })),
  },
  { additionalProperties: false },
);

export const ProviderConfigDefSchema: TUnsafe<ProviderConfigDef> = Type.Unsafe<ProviderConfigDef>(
  providerConfigDefShape satisfies SchemaProof<ProviderConfigDef, typeof providerConfigDefShape>,
);

// ── 오류 ─────────────────────────────────────────────────────────────────

export type ModelErrorKind =
  // 해석·등록 단계 (Result 오류)
  | "invalid_ref"
  | "no_model_for_role"
  | "model_not_found"
  | "model_denied"
  | "provider_unavailable"
  | "provider_conflict"
  | "invalid_provider"
  | "secret_unresolved"
  | "oauth_token_on_default_provider"
  // 호출 단계 (stopReason "error" 메시지의 분류, classify 결과)
  | "rate_limited"
  | "quota_exhausted"
  | "overloaded"
  | "context_overflow"
  | "auth"
  | "aborted"
  | "transport"
  | "provider_error";

export interface ModelError {
  readonly kind: ModelErrorKind;
  /** 비밀 값 마스킹을 거친 문자열 */
  readonly message: string;
  readonly role?: ModelRole;
  readonly ref?: ModelRefString;
  readonly retryAfterMs?: number;
}

// ── ModelService ─────────────────────────────────────────────────────────

// ── hosted 검색 포트 (L2.web.spec §4.8.4, §8 요구) ────────────────────────────

/** 내장 검색 래퍼가 쓰는 모델. ModelRefString("provider/modelId") 또는 "auto"(역할 search의 모델)다(l2.web.search.wrapper.model) */
export type HostedSearchModel = string;

/**
 * 이어 요청용 불투명 문자열. pause_turn 응답이 돌려주고 다음 요청이 그대로 되돌려 보낸다.
 * 안쪽(직렬화한 응답 블록, encrypted_content 포함)은 core-models만 안다. 호출자는 읽거나 고치지 않고 저장하지 않는다.
 */
export type HostedSearchContinuation = string;

export interface HostedSearchRequest {
  readonly model: HostedSearchModel;
  /** 고정 시스템 프롬프트. 예: "Search the web for the user's query and stop. Do not answer." */
  readonly system: string;
  /** 정규화한 검색어 한 줄 */
  readonly query: string;
  /** 출력 토큰 상한. 래퍼는 512를 쓴다 */
  readonly maxOutputTokens: number;
  /** hosted 도구의 도메인 필터로 넘길 조건. 넘기지 못하는 provider는 무시하고 호출자가 결과를 다시 거른다 */
  readonly domains: { readonly allow: readonly string[]; readonly deny: readonly string[] };
  /** 이전 응답이 pause_turn일 때 그 응답의 continuation. 첫 요청은 null */
  readonly continuation: HostedSearchContinuation | null;
}

export type HostedSearchStopReason = "end_turn" | "pause_turn" | "max_tokens" | "refusal";

/** web_search_tool_result 한 건. encrypted_content는 담지 않는다 */
export interface HostedSearchHit {
  readonly url: string;
  readonly title: string | null;
  /** provider가 준 게시 시기 문자열(page_age). 파싱하지 않는다 */
  readonly pageAge: string | null;
}

/** web_search_result_location 한 건. 인용문은 provider가 준 것만 담는다 */
export interface HostedSearchCitation {
  readonly url: string;
  readonly title: string | null;
  readonly citedText: string | null;
}

export interface HostedSearchUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** 검색 요청 수(수수료 단위) */
  readonly searchRequests: number;
}

export interface HostedSearchResponse {
  readonly stopReason: HostedSearchStopReason;
  /** 모델이 쓴 텍스트. 래퍼는 답을 요구하지 않으므로 대개 비어 있다 */
  readonly text: string;
  readonly results: readonly HostedSearchHit[];
  readonly citations: readonly HostedSearchCitation[];
  readonly usage: HostedSearchUsage;
  /** 실제로 요청한 모델 */
  readonly model: { readonly provider: string; readonly modelId: string };
  /** stopReason이 pause_turn이면 이어 요청에 쓸 값, 아니면 null */
  readonly continuation: HostedSearchContinuation | null;
}

/** 예상 가능한 실패. throw하지 않는다(TY-11) */
export type HostedSearchError =
  /** 현재 provider·모델에 hosted 검색이 없다 */
  | {
      readonly kind: "unsupported_model";
      readonly provider: string | null;
      readonly modelId: string | null;
    }
  /** 조직 관리자가 hosted 검색을 꺼 요청이 400으로 거절됐다. 호출자는 프로세스 수명 동안 기억한다 */
  | { readonly kind: "org_disabled" }
  | { readonly kind: "rate_limited"; readonly retryAfterMs: number | null }
  | { readonly kind: "upstream"; readonly status: number | null; readonly message: string }
  | { readonly kind: "cancelled" };

export type HostedSearchSupport =
  | { readonly supported: true; readonly provider: string; readonly modelId: string }
  | { readonly supported: false; readonly reason: "no_model" | "no_hosted_search" };

/**
 * 모델 provider의 서버 도구 검색을 한 턴 요청하는 포트(내장 검색 래퍼용, L2.web.spec §4.8.4).
 * 구현은 core-models(L1C.3). 요청 하나는 hosted 검색 도구 하나만 단 단일 턴이고 대화 기록에 남지 않는다.
 */
export interface HostedSearchPort {
  /** 모델이 hosted 검색을 지원하는가. 모델 호출을 하지 않는다 */
  support(model: HostedSearchModel): HostedSearchSupport;
  search(
    request: HostedSearchRequest,
    signal: AbortSignal,
  ): Promise<Result<HostedSearchResponse, HostedSearchError>>;
}

/** ModelsPort(F.extensions.spec §3.2.1)를 확장한다. registerProvider는 JSON 표현의 config만 받는 포트 경로다 */
export interface ModelService extends ModelsPort {
  /** 역할을 바인딩으로 해석한다. 같은 입력(역할, 덮어쓰기, 설정 스냅샷, 카탈로그)이면 같은 결과다 */
  resolve(role: ModelRole, overrides?: RoleOverrides): Result<ResolvedModel, ModelError>;
  /** 체크포인트에 고정된 바인딩을 역할 표 없이 다시 쓴다 */
  rebind(binding: ModelBinding): Result<ResolvedModel, ModelError>;

  /** 스트림 호출. 오류는 throw하지 않고 stopReason "error"인 종결 이벤트로 낸다(pi-ai 규칙) */
  stream(request: ModelCallRequest): AssistantMessageEventStream;
  /** 완성 호출. stream을 끝까지 읽은 최종 메시지 */
  complete(request: ModelCallRequest): Promise<AssistantMessage>;
  /** core-loop 자체 루프가 부르는 StreamFn. ctx의 귀속 정보로 사용량을 기록하고 지점을 발화한다 */
  streamFn(ctx: ModelCallContext): StreamFn;

  /** 카탈로그 조회. 허용·차단 목록을 적용한 결과 */
  list(filter?: ModelListFilter): readonly ModelInfo[];
  /** provider 등록. 플러그인은 F provider 인터페이스(ProviderDef)로 이 메서드를 부른다 */
  addProvider(owner: ScopeId, name: string, def: ProviderDef): Result<Unsubscribe, ModelError>;
  /**
   * X ModelsPort 등록(확장 hostOf(g).registerProvider). config를 ProviderConfigDefSchema로 검사해 addProvider와 같은 경로로 등록한다.
   * 실패하면 ModelError 값을 던진다(포트 경로는 Result를 돌려주지 않는다)
   */
  registerProvider(owner: ScopeId, name: string, config: ProviderResourceDef): Unsubscribe;

  readonly usage: UsageMeter;
  /** pi-ai 토큰 추정 위임. core-context는 pi-ai를 직접 import하지 않는다 */
  readonly tokens: TokenEstimator;
  /** 종결 메시지의 오류 분류. 오류가 아니면 null */
  classify(message: AssistantMessage, contextWindow?: number): ModelErrorKind | null;
  /**
   * hosted 검색 포트(내장 검색 래퍼용). core-models가 L1C.3에서 구현하면 필수로 올린다.
   * 없는 동안 소비자는 "지원 안 함"(unsupported-model)으로 본다
   */
  readonly hostedSearch?: HostedSearchPort;
}
