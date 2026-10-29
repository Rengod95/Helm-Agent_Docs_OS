---
id: L1.models.spec
layer: L1
domain: models
kind: spec
status: draft
depends_on: [F.conversation.spec, F.capabilities.spec, F.records.spec, F.extensions.spec, F.wire-settings.spec, eng.context-map.design, adr.0001, adr.0002]
binds: [xeon/packages/core-models/**, xeon/plugins/provider-anthropic-oauth/**, xeon/packages/group-account-rotation/**, xeon/packages/group-provider-anthropic-oauth/**]
---

# L1 모델 게이트웨이 (models)

계획 v2의 하위 층 L1-c(모델 게이트웨이)를 구현하는 `xeon/packages/core-models`와, 배포에서 빼는 위장 provider 플러그인 `xeon/plugins/provider-anthropic-oauth`의 스펙이다. `_routing/routes.yaml` layout의 `plugins` 항목이 이 문서를 플러그인 문서로 지정한다. 컨텍스트는 `model-gateway`다(`eng.context-map.design` §4.1).

## 1. 목적과 범위

### 1.1 정하는 것

- Cordis 서비스 `xeon.models`의 인터페이스 `ModelService`: 역할 해석, 스트림·완성 호출, 모델 목록, provider 등록, 사용량 보고, 토큰 추정과 오류 분류 위임.
- pi-ai를 그대로 쓰는 범위와 그 위에 Xeon이 정하는 세 가지: 캐시 정책 객체(`CachePolicy`), 용도별 라우팅(역할 표), 설정 노출.
- 역할 표의 역할 목록, 해석 순서, 모델 참조 문자열 형식 `provider/modelId[:thinkingLevel]`.
- 추론 레벨과 레벨별 토큰 예산, 단계 체크포인트(`StepCheckpoint.model`) 고정 규칙.
- 비밀 참조(`secret://`)를 요청 직전에만 해석하는 규칙.
- 발화 지점 6개: `request.provider.before`, `request.headers.before`, `request.provider.after`, `request.stream`, `request.model.after`, `request.thinking.after`.
- M3: 레이트 리밋과 계정 회전(설정은 M3 설정 화면, review.decisions-2 U-21). 2차: 폴백 체인, 구조화 출력.
- 위장 provider 플러그인의 분리 방식(방안 A 우선, 방안 B 전환 조건), 배포 제외 검사, 위험 고지.
- 설정 키 `l1.models.*`.

### 1.2 다루지 않는 것

| 대상 | 정하는 문서 |
|---|---|
| 메시지·스트림 이벤트·`Usage`·`ModelThinkingLevel` 타입 | `F.conversation.spec` §3.1 (pi 재노출) |
| 단계 체크포인트 레코드 모양 | `F.records.spec` §3.6 |
| 지점 선언 표, fold, 페이로드 형태 규칙 | `F.extensions.spec` §3.3~§3.5 |
| 컨텍스트 조립, 캐시 표식 위치 계산, 컴팩션 | `L1.context.spec` |
| 자체 루프(adr.0009)와의 연결, 예산(단계·비용 상한 없음) | `L1.loop.spec` |
| 서브에이전트 정의 파일의 `model` 필드, 목표 판정 실행 | `L1.agents.spec` |
| 비밀 저장, 해석 구현, 마스킹 | `L0.secrets.spec` |
| 설정 화면 렌더링 | `L4.settings-ui.spec` |
| 내장 검색 래퍼의 검색 절차 | `L2.web.spec` (이 문서는 `search` 역할의 모델 해석만 정한다) |

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 역할(`ModelRole`) | 모델을 고르는 용도 이름. `main`, `review`, `summary`, `subagent`, `judge`, `search` 6종 |
| 모델 참조(`ModelRefString`) | `provider/modelId` 또는 `provider/modelId:thinkingLevel` 문자열 |
| 바인딩(`ModelBinding`) | 해석 결과의 고정 부분. 역할, provider, modelId, 추론 레벨. `StepCheckpoint.model`에 저장하는 값과 같은 필드를 가진다 |
| 해석(resolve) | 역할과 덮어쓰기 값, 설정, 카탈로그로 바인딩을 계산하는 순수 계산 |
| 다시 묶기(rebind) | 체크포인트에 고정된 바인딩을 역할 표를 거치지 않고 다시 쓰는 것 |
| 캐시 정책 객체(`CachePolicy`) | 캐시 보존 기간, 세션 키, 표식 위치 우선순위, 표식 상한을 묶은 값. `L1.context.spec`과 같은 이름으로 쓴다 |
| 캐시 표식(`CacheMarks`) | `CachePolicy`에 따라 조립된 메시지 배열에서 표식을 둘 위치. `L1.context.spec`이 계산하고 이 서비스가 요청에 적용한다 |
| 계정(account) | 같은 provider의 자격 증명 하나. 2차 계정 풀의 원소 |
| 위장 provider | Anthropic 구독 OAuth 토큰으로 Claude Code 클라이언트 요청 모양을 흉내 내는 경로. `plugins/provider-anthropic-oauth` |

## 3. 인터페이스

### 3.1 pi-ai 재사용 범위

[결정] pi-ai provider를 그대로 쓰고 부족분만 포크한다. 새 provider 계층을 만들지 않는다(`_research/decisions-log.md` 2026-10-21 결정 2차, `_research/foundation-plan.md` §2 모델·루프 행). 패키지는 `@earendil-works/pi-ai` 1.3.0 정확 고정이다. 소스 줄 번호는 `~/projects/_ref/pi-src/packages/ai/src`(커밋 `cdaf6c2`, 1.1.0 소스) 기준이고, 1.3.0과 다른 곳은 따로 적는다(`_research/notes/L1-2.md` §3.9).

| 항목 | 그대로 쓰는 것 | 위치 | Xeon이 더하는 것 |
|---|---|---|---|
| provider와 와이어 형식 분리 | `createProvider`, `ProviderStreams`, `Api = KnownApi \| (string & {})` | `models.ts:1041`, `types.ts:311`, `types.ts:73` | provider 등록 API(§3.7) |
| 모델 카탈로그 | `models.generated.ts`, `Model.contextWindow`, `maxTokens`, `cost`, `reasoning` | `types.ts:834-850`(`_research/packages.md` §4.3은 849-879로 적었다. 이 문서는 로컬 소스 줄을 쓴다) | 허용·차단 목록, 역할 표 |
| 재시도와 백오프 | `retryAssistantCall`, `RetryPolicy`, `isRetryableAssistantError`, `retryProviderRequest` | `utils/retry.ts`(257줄), `utils/provider-retry.ts`(128줄) | 재시도 수치 설정(§6) |
| 비용·토큰 계측 | `Usage`, `calculateCost`. 중단된 응답도 `error` 이벤트의 `AssistantMessage`에 `usage`가 실린다 | `types.ts:446-466`, `models.ts:1200` | 합산기 `UsageMeter`(§3.5) |
| 캐시 | `cacheRetention`, `sessionId`, `ModelPromptCache` | `types.ts:243`, `249`, `848` | 캐시 정책 객체(§3.6) |
| 추론 | `reasoning?: ThinkingLevel`, `thinkingBudgets`(pi-ai `SimpleStreamOptions`. core-loop 자체 루프는 단계 바인딩으로 받아 그대로 넘긴다), `clampThinkingLevel` | `types.ts:372-376`, `models.ts:1235`, agent `agent.ts:137` | 레벨별 토큰 설정, 체크포인트 고정(§4.2) |
| 토큰 추정, 오버플로우 감지 | `estimateMessageTokens`, `estimateContextTokens`, `calculateContextTokens`, `isContextOverflow` | `utils/estimate.ts`, `utils/overflow.ts:137` | `L1.context.spec`에 서비스로 위임(§3.3) |
| 인자 검증 | `validateToolArguments` | `utils/validation.ts:317` | 2차 구조화 출력 재시도 루프(§4.10) |
| 요청 변형 훅 | `onPayload`, `onResponse`, `onProviderStreamEvent`, `ModelsRequestTransforms.transformHeaders` | `types.ts:178`, `182`, `219-223`, `models.ts:112-115` | 지점 디스패치(§7) |
| 자격 증명 | `CredentialStore`(provider당 1건), `Models.getAuth` | `auth/types.ts:65-94`, `auth/resolve.ts:19-25` | 비밀 다리(§3.9) |

포크 판정 목록 [제안]. 판정 기준은 "공개 API와 훅으로 표현되는가"다. 표현되면 포크하지 않는다.

| 대상 | 판정 | 근거 |
|---|---|---|
| `anthropic-messages.ts` 위장 분기 8곳 | 방안 A(래퍼)로 시작. 조건이 맞지 않으면 그 파일만 포크(방안 B) | §4.11, `_research/packages.md` §2.1, `_research/notes/L1-2.md` §1 |
| `ThinkingBudgets`에 `xhigh`, `max` 키가 없음(`types.ts:136-141`, 레벨은 `minimal`~`max` 6종, `providers/model-schema.ts:3`) | 포크하지 않는다. `xhigh`·`max`의 토큰 예산은 provider 매핑(`Model.thinkingLevelMap`)에 맡기고 설정 값은 저장만 한다 | 공개 API로 레벨 자체는 전달된다. 숫자 예산은 토큰 기반 provider에만 쓰인다(`types.ts:375` 주석) |
| 사용량 합산 | 포크 대상은 coding-agent `usage-totals.ts`의 `combineUsage`(소형). pi-ai 밖 파일이라 복사 후 F `Usage`로 고친다 | `_research/packages.md` §4.3 L1-c 비용·토큰 계측 행 |
| 계정 회전(M3) | 포크하지 않는다. `CredentialStore` 위에 계정 풀을 두고 요청마다 `AuthResolutionOverrides.apiKey`로 넣는다 | §4.8 |
| `transformMessages`, `normalizeContext` | 그대로 | provider 전환 시 thinking 블록 처리(`api/transform-messages.ts`) |

### 3.2 F에 두는 이름

서비스 인터페이스 `ModelService`와 서비스 이름 상수는 F `@xeon/contracts/services` 서브패스에 둔다 [결정: review.decisions-2 D-04]. 나머지 이름(역할, 참조, 바인딩, `CachePolicy`)도 같은 서브패스의 `services/models.ts`에 둔다. 여러 서비스가 함께 쓰는 모델 값 타입의 위치는 `F.capabilities.spec` §3.12 규칙 3이 정했고, `L1.context.spec`은 이 파일에서 import한다. 순수 함수 `parseModelRef`, `formatModelRef`, `resolveRole`은 `F.readme` §1의 런타임 로직 예외 1(순수 함수)에 해당한다.

```ts
// xeon/packages/contracts/src/services/models.ts  (F.capabilities.spec §3.12 규칙 3)
import { Type, type TUnsafe, type TString } from "typebox";
import type {
  Model, Api, Context, Provider, CacheRetention, ThinkingBudgets,
  AssistantMessageEventStream, SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { AssistantMessage, Message, ModelThinkingLevel, StopReason, StreamFn, Usage } from "../conversation/pi.ts";
import type { ThreadId, TurnId, StepId } from "../conversation/ids.ts";
import type { Result } from "../base/index.ts";

/**
 * pi-ai 타입 재노출(타입 전용). F.conversation.spec §3.1 규칙 1과 같은 방식.
 * 구현에서는 `AssistantMessageEventStream`과 `StreamFn`만 순수 재노출이 아니라 F가 소비 계약(AsyncIterable과 result())을
 * 적은 인터페이스다(pi-ai 클래스의 `#private` 때문, F.conversation.spec §3.1). `Model`은 pi처럼 `Model<Api>`로 쓴다.
 */
export type { Model, Api, Context, Provider, CacheRetention, ThinkingBudgets, AssistantMessageEventStream, SimpleStreamOptions, StreamFn };

export const ModelServiceName: "xeon.models" = "xeon.models";

export const MODEL_ROLES: readonly ["main", "review", "summary", "subagent", "judge", "search"] =
  ["main", "review", "summary", "subagent", "judge", "search"];
export type ModelRole = (typeof MODEL_ROLES)[number];
export const ModelRoleSchema: TUnsafe<ModelRole>;

/** provider: ^[a-z0-9][a-z0-9._-]{0,63}$, modelId: 공백 없는 1~200자. 접미 ":레벨"은 ModelThinkingLevel 값일 때만 레벨로 읽는다 */
export const MODEL_REF_PATTERN: string = "^[a-z0-9][a-z0-9._-]{0,63}/\\S{1,200}$";
export type ModelRefString = string;
export const ModelRefStringSchema: TString;   // Type.String({ pattern: MODEL_REF_PATTERN, maxLength: 265 })

export interface ModelRef {
  readonly provider: string;
  readonly modelId: string;
  readonly thinkingLevel: ModelThinkingLevel | null;
}
export type ModelRefError =
  | { readonly kind: "malformed"; readonly input: string }
  | { readonly kind: "empty_model_id"; readonly input: string };
export function parseModelRef(input: string): Result<ModelRef, ModelRefError>;
export function formatModelRef(ref: ModelRef): ModelRefString;

/** StepCheckpoint.model(F.records.spec §3.6)과 같은 세 필드 + role */
export interface ModelBinding {
  readonly role: ModelRole;
  readonly provider: string;
  readonly modelId: string;
  readonly thinkingLevel: ModelThinkingLevel;
}
export const ModelBindingSchema: TUnsafe<ModelBinding>;
```

- `parseModelRef` 규칙: 첫 `/` 앞이 provider다. 나머지가 modelId다. modelId가 `:`로 끝나는 마디를 가지고 그 마디가 `ModelThinkingLevel` 값(`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`)이면 레벨로 떼어 낸다. 그 밖의 `:`는 modelId의 일부다(예: Bedrock `anthropic.claude-…-v1:0`). modelId 안의 `/`도 허용한다(예: OpenRouter `openrouter/anthropic/claude-…`).
- [미결] `StepCheckpoint.model`에 `role`이 없다. 재개 뒤 다시 묶을 때 역할이 필요하지 않으므로 체크포인트에는 추가하지 않는 쪽을 제안한다. 대신 `ModelBinding`에서 `role`을 뺀 `Omit<ModelBinding, "role">`이 체크포인트 값과 같아야 한다(수용 기준 7).

### 3.3 서비스 인터페이스

```ts
// xeon/packages/contracts/src/services/models.ts (F.capabilities.spec §3.12, review.decisions-2 D-04). 구현은 xeon/packages/core-models/src/service.ts
import type { ScopeId, Unsubscribe, ModelsPort, ProviderResourceDef } from "../extensions/index.ts";   // F.extensions.spec §3.2, §3.2.1 ports.ts
import type { EventId } from "../conversation/ids.ts";

export interface ModelService extends ModelsPort {
  /** 역할을 바인딩으로 해석한다. 같은 입력(역할, 덮어쓰기, 설정 스냅샷, 카탈로그)이면 같은 결과다 */
  resolve(role: ModelRole, overrides?: RoleOverrides): Result<ResolvedModel, ModelError>;
  /** 체크포인트에 고정된 바인딩을 역할 표 없이 다시 쓴다(§4.2) */
  rebind(binding: ModelBinding): Result<ResolvedModel, ModelError>;

  /** 스트림 호출. 오류는 throw하지 않고 stopReason "error"인 종결 이벤트로 낸다(pi-ai 규칙) */
  stream(request: ModelCallRequest): AssistantMessageEventStream;
  /** 완성 호출. stream을 끝까지 읽은 최종 메시지 */
  complete(request: ModelCallRequest): Promise<AssistantMessage>;
  /** core-loop 자체 루프가 부르는 StreamFn(F 정의). ctx의 귀속 정보로 사용량을 기록하고 지점을 발화한다 */
  streamFn(ctx: ModelCallContext): StreamFn;

  /** 카탈로그 조회. 허용·차단 목록을 적용한 결과 */
  list(filter?: ModelListFilter): readonly ModelInfo[];
  /** provider 요청의 목적지(baseUrl 설정 → 등록부 → provider 기본 주소). 모르거나 해석할 수 없으면 null. 비밀 lease의 `target`과 같은 값이다(§3.9) [결정: M2 Mac 실기] */
  providerTarget(providerId: string): ProviderTarget | null;
  /** provider 등록. 플러그인은 F provider 인터페이스(ProviderDef)로 이 메서드를 부른다(§3.7, §3.11) */
  addProvider(owner: ScopeId, name: string, def: ProviderDef): Result<Unsubscribe, ModelError>;
  /** X ModelsPort 등록(확장 hostOf(g).registerProvider). config를 ProviderConfigDefSchema로 검사해 addProvider와 같은 경로로 등록한다. 실패하면 ModelError 값을 던진다(§3.7) */
  registerProvider(owner: ScopeId, name: string, config: ProviderResourceDef): Unsubscribe;

  readonly usage: UsageMeter;
  /** pi-ai 토큰 추정 위임. DR-07 때문에 core-context는 pi-ai를 직접 import하지 않는다 */
  readonly tokens: TokenEstimator;
  /** 종결 메시지의 오류 분류. 오류가 아니면 null */
  classify(message: AssistantMessage, contextWindow?: number): ModelErrorKind | null;
}

export interface RoleOverrides {
  /** 호출자가 직접 지정한 참조. 서브에이전트 정의 파일의 model 필드(L1.agents.spec) */
  readonly ref?: ModelRefString;
  /** 그룹 덮어쓰기 조회 키. 호출을 일으킨 scope(F.extensions.spec ScopeId) */
  readonly scopeId?: ScopeId;
  /** 레벨만 덮어쓴다. ref의 접미보다 우선한다 */
  readonly thinkingLevel?: ModelThinkingLevel;
}

export type ResolutionSource = "explicit" | `group:${string}` | "role" | "role-fallback" | "default" | "checkpoint";

export interface ResolvedModel {
  readonly binding: ModelBinding;
  readonly source: ResolutionSource;
  /** 해석 순서에서 거친 단계. 디버깅과 설정 화면의 "출처" 표시용 */
  readonly trace: readonly { readonly step: ResolutionSource; readonly ref: ModelRefString | null }[];
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

export interface ModelCallRequest extends ModelCallContext {
  readonly resolved: ResolvedModel;
  /** 조립된 컨텍스트(L1.context.spec AssembledContext.messages를 담은 pi-ai Context) */
  readonly context: Context;
  readonly options?: ModelCallOptions;
}

export interface ModelCallOptions {
  readonly maxTokens?: number;
  readonly toolChoice?: "auto" | "none";
  readonly temperature?: number;
  /** 정책의 보존 기간을 이 호출에서만 바꾼다. 요약 호출은 "none" */
  readonly cacheRetention?: CacheRetention;
  /** L1.context.spec이 계산한 표식. 없으면 provider 기본 위치 */
  readonly cacheMarks?: CacheMarks;
}

export interface ModelListFilter {
  readonly provider?: string;
  readonly available?: boolean;      // 자격 증명이 있는 provider만
  readonly reasoning?: boolean;
}
export interface ModelInfo {
  readonly ref: ModelRefString;      // "provider/modelId"
  readonly name: string;
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly reasoning: boolean;
  readonly input: readonly ("text" | "image")[];
  readonly cost: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number };
  readonly supportedThinkingLevels: readonly ModelThinkingLevel[];
  readonly available: boolean;
}

export interface TokenEstimator {
  estimateMessage(message: Message): number;
  estimateContext(messages: readonly Message[]): ContextUsageEstimate;
  fromUsage(usage: Usage): number;
}
/** pi-ai utils/estimate.ts ContextUsageEstimate와 같은 모양 */
export interface ContextUsageEstimate {
  readonly tokens: number;
  readonly usageTokens: number;
  readonly trailingTokens: number;
  readonly lastUsageIndex: number | null;
}
```

- `streamFn(ctx)`가 돌려준 함수는 core-loop 자체 루프가 넘기는 `model` 인자를 그대로 쓴다. core-loop는 단계 시작(`openStep`)에서 정한 바인딩의 `ResolvedModel.model`을 넣는다(`L1.loop.spec` §3.2). 넘어온 `model`이 등록되지 않은 provider면 `provider_unavailable` 오류 종결 메시지를 낸다.
- [결정: adr.0009 §3.5, 구현 반영] 자체 루프는 pi-ai 값 함수를 쓰지 않으므로 core-models가 대신 감싼다. (1) `streamFn`은 루프가 넘기는 변환 결과(`convertToLlm`, L1.context)를 `Context`(`messages`만 담음)로 받는다. F `StreamFn`의 컨텍스트 인자는 `Context`다. `TranscriptContext`는 pi-ai `normalizeContext`만 만들 수 있고 값 import는 core-models만 하기 때문이다. 정규화는 `Models.streamSimple` 안에서 pi-ai가 한다. (2) 도구 선언 차이: `declareTools`는 만들지 않았다. L1.context가 고정 접두 system 메시지의 `toolsAdded`로 도구 목록을 이미 선언하고 `AssembledContext.pendingItems`로 돌려주며, core-loop가 그 item을 C3에 기록하기 때문이다(`L1.context.spec`). 원본 `declareToolChanges`는 옮기지 않았다. (3) core-tools의 TypeBox 검증(`validate.ts`)이 pi-ai `validateToolArguments`의 TypeBox 경로와 같은 결과를 내는 것을 사례 시험으로 고정했다(선택 null 제거, 변환, 오류 문장). TypeBox 표지가 없는 순수 JSON Schema(MCP 도구)의 coerce 경로는 M2 cap-mcp에서 이 메서드를 감싸 `Result`로 돌려주는 방식으로 더한다(`L1.loop.plan` LP18).
- `stream`, `complete`, `streamFn`은 모두 같은 파이프라인(§4.3)을 지난다.

### 3.4 역할 표

| 역할 | 쓰는 곳 | 설정 키 | 기본 대체 사슬 | 기본 캐시 보존 |
|---|---|---|---|---|
| `main` | 주 루프의 단계 요청(`L1.loop.spec`) | `l1.models.default` | 없음 | 설정값(`l1.models.cacheRetention`) |
| `review` | 검토 서브에이전트, 그룹의 검토 호출 | `l1.models.routing.review` | `main` | 설정값 |
| `summary` | 컴팩션 요약(`L1.context.spec` §4.6), 떠난 가지 요약 | `l1.models.routing.summary` | `main` | `none`(pi `completeSummarization`의 `cacheRetention: "none"`, coding-agent `compaction.ts:631`) |
| `subagent` | 서브에이전트(`L1.agents.spec`). 정의 파일의 `model` 필드가 `RoleOverrides.ref`로 들어와 덮어쓴다 | `l1.models.routing.subagent` | `main` | 설정값 |
| `judge` | 목표 판정. `L1.agents.spec`이 판정 실행 경로에서 부른다(실행 횟수 상한은 그 문서) | `l1.models.routing.judge` | `review` → `main` | `none` |
| `search` | 내장 검색 래퍼의 소형 모델 한 턴(`_research/foundation-plan.md` §1 결정 6 ②, `L2.web.spec`) | `l1.models.routing.search` | `summary` → `main` | `none` |
| 그룹 덮어쓰기 | 그룹이 일으킨 위 역할 호출 | `l1.models.groupRouting` (`{ [scopeId]: { [role]: ref } }`) | 해당 역할의 일반 해석 | 해당 역할 |

- [결정] 목표 판정은 별도 판정 모델과 실행 횟수 상한으로 한다(`_research/foundation-plan.md` §1 결정 4). 이 문서는 `judge` 역할로 모델만 고른다.
- omp `modelRoles`(default, smol, slow, plan, commit 등 16종, `_research/settings.md` §2.5)는 참고만 했다. 역할 수를 6개로 줄인 이유는 L1 안에 실제 호출처가 있는 역할만 두기 위해서다 [제안].
- [미결] 그룹이 새 역할 이름(예: Helm 렌즈 전용)을 등록할 수 있게 할지. 현재 제안은 6종 고정이고 그룹은 `groupRouting`으로 기존 역할만 덮어쓴다.
- 모델 테이프의 `ModelTapeTurn.role`(`eng.testing.guide` TS-04)은 이 표의 `ModelRole` 값이다.

### 3.5 사용량

```ts
export interface UsageRecord {
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly stepId: StepId | null;
  readonly role: ModelRole;
  readonly scopeId: ScopeId | null;
  readonly provider: string;
  readonly modelId: string;
  readonly usage: Usage;              // pi-ai Usage 그대로. cost는 calculateCost 결과
  readonly stopReason: StopReason;
  readonly aborted: boolean;          // stopReason이 "aborted"이거나 사용자 중단
  readonly recordedAt: number;        // ms
}
export interface UsageTotals {
  readonly calls: number;
  readonly abortedCalls: number;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly reasoning: number;         // 보고한 provider만 합산
  readonly totalTokens: number;
  readonly costTotal: number;         // USD
}
export interface UsageScope {
  readonly threadId: ThreadId;
  readonly turnId?: TurnId;
  readonly role?: ModelRole;
  readonly scopeId?: ScopeId;
}
export interface UsageMeter {
  totals(scope: UsageScope): UsageTotals;
  subscribe(listener: (record: UsageRecord) => void): Unsubscribe;
}
```

- 사용량의 내구 기록은 이 서비스가 쓰지 않는다. 어시스턴트 `item.recorded`의 `message.usage`와 `turn.completed`의 사용량이 원천이다(`F.records.spec` §3.3). `UsageMeter`는 프로세스 메모리의 합산기이고, 재개 뒤에는 이벤트를 다시 읽어 채운다 [제안].
- M3: 레이트 리밋 창(§4.8)을 위해 `core_models_usage_windows` 테이블에 provider·계정별 창 합계를 둔다.

### 3.6 캐시 정책 객체

`L1.context.spec`과 같은 이름을 쓴다. 정책은 이 서비스가 만들고, 표식 위치는 context가 계산하고, 요청 적용은 이 서비스가 한다.

```ts
export type CacheSite = "system" | "tools" | "summary" | "tail";

export interface CachePolicy {
  /** pi-ai cacheRetention. "none" | "short" | "long" */
  readonly retention: CacheRetention;
  /** pi-ai sessionId로 보낼 값. 기본은 threadId. retention이 "none"이면 null */
  readonly sessionKey: "thread" | null;
  /** 표식 위치 우선순위. 앞이 먼저 남는다. 길이는 maxBreakpoints 이하 */
  readonly sites: readonly CacheSite[];
  /** provider 상한. anthropic-messages는 4(oc 최대 4개, _research/item-catalog.md L1-c) */
  readonly maxBreakpoints: number;
  /** 대화 중 SystemMessage(toolsAdded·toolsRemoved·sections) 지원 여부. model.compat에서 읽는다 */
  readonly midConversationSystem: boolean;
  /** 대화 중 도구 변경 지원 여부 */
  readonly midConversationToolChanges: boolean;
}

export interface CacheMarks {
  readonly policy: CachePolicy;
  /** messageIndex는 Context.messages 기준. system·tools 표식은 null */
  readonly marks: readonly { readonly site: CacheSite; readonly messageIndex: number | null }[];
}
```

- retention이 `none`인 정책(요약·판정·검색 역할, 설정 `none`)은 `sessionKey`가 `null`이고 `sites`가 빈 배열이다 [구현: M2]. 호출 단위 덮어쓰기(`ModelCallOptions.cacheRetention`, agent-core가 넘긴 값)도 이 세 역할에는 `none`을 유지한다.
- 대화 중 system 메시지·도구 변경 지원은 `model.compat`의 `supportsMidConvoSystemMessages`와 `supportsMidConvoToolChanges`(anthropic) 또는 `supportsMidConvoToolAdditions`(그 밖)에서 읽는다. 도구 변경은 system 메시지 지원이 있을 때만 참이다 [구현: M2].
- 표식 적용은 anthropic-messages 페이로드에 대해 `onPayload`에서 한다. `CacheMarks`의 `summary` 위치를 페이로드 `messages`의 마지막 블록에 달고(문자열 content는 text 블록으로 바꾼다), 페이로드에 달린 `cache_control` 수가 `maxBreakpoints`를 넘으면 `sites` 뒤쪽(`tail`, 그다음 `summary`)부터 지운다. 같은 입력에 같은 결과를 내서 pi-ai 재시도 때 다시 불려도 안전하다 [구현: M2].
- 기본 `sites`는 `["system", "tools", "summary", "tail"]`다. pi-ai `anthropic-messages`는 retention이 `none`이 아니면 시스템 블록(`anthropic-messages.ts:1167-1190`), 마지막 도구(`1608`), 마지막 user·system 메시지(`1483-1504`)에 표식을 붙인다. Xeon이 더하는 위치는 `summary`(컴팩션 요약 메시지)뿐이다 [제안].
- 다른 API(OpenAI 계열, Google)는 자동 접두 캐시를 쓰므로 `marks`를 무시하고 `retention`, `sessionKey`만 전달한다.
- 정책은 해석 때 `ResolvedModel.cachePolicy`로 정해진다. 호출 단위 덮어쓰기는 `ModelCallOptions.cacheRetention`만 허용한다.

### 3.7 provider 등록

[결정: review.decisions-2 D-04] `ModelService`는 `ModelsPort`(`F.extensions.spec` §3.2.1 `ports.ts`)를 확장한다(`F.capabilities.spec` §3.12 규칙 2). 확장의 `hostOf(g).registerProvider(name, config)`는 `ModelsPort.registerProvider(owner, name, config: ProviderResourceDef)`로 이 서비스에 들어온다. `ProviderResourceDef`는 F에서 `JsonValue`이므로 이 경로는 JSON으로 표현되는 `kind: "config"`만 받는다. 함수를 담는 `kind: "runtime"`은 플러그인이 `addProvider`로 등록한다(§3.11). 두 메서드는 같은 등록부를 쓴다 [제안].

```ts
/** JSON으로 표현되는 provider. pi registerProvider(name, ProviderConfig)의 직렬화 가능한 부분 */
export interface ProviderConfigDef {
  readonly kind: "config";
  readonly name?: string;
  readonly baseUrl?: string;
  readonly api?: Api;
  /** 키는 참조만 받는다. 리터럴, $ENV, !command 형식은 거부한다(pi ProviderConfig.apiKey와 다른 점) */
  readonly apiKey?: SecretRefString;
  readonly headers?: Readonly<Record<string, string>>;   // 비밀 금지. 값에 secret:// 를 쓰면 요청 직전 해석
  readonly models?: readonly ProviderModelDef[];
}
export interface ProviderModelDef {
  readonly id: string;
  readonly name?: string;
  readonly api?: Api;
  readonly reasoning: boolean;
  readonly input: readonly ("text" | "image")[];
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly cost?: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number };
}
/** 코드로 만든 provider. 위장 provider 플러그인이 쓴다 */
export interface ProviderRuntimeDef {
  readonly kind: "runtime";
  readonly provider: Provider;
  /** 이 provider의 자격 증명 참조. 요청 직전 해석해 AuthResolutionOverrides.apiKey로 넣는다 */
  readonly credential?: SecretRefString;
}
export type ProviderDef = ProviderConfigDef | ProviderRuntimeDef;
export type SecretRefString = string;   // F.wire-settings.spec §3.8.1 SecretRef 형식
export const ProviderConfigDefSchema: TUnsafe<ProviderConfigDef>;
```

- 등록 이름은 `^[a-z0-9][a-z0-9._-]{0,63}$`이어야 하고 어기면 `invalid_provider`다. `kind: "runtime"`은 `provider.id`가 등록 이름과 같아야 한다 [구현: M2].
- `kind: "config"`는 내장 provider 이름이면 `models` 없이 `baseUrl`, `headers`, `apiKey`만 덮어쓸 수 있고(해제하면 내장 값으로 돌아간다), 새 이름이면 `baseUrl`과 `models`가 필요하다. `api`는 pi-ai 내장 API 중 `anthropic-messages`, `openai-completions`, `openai-responses`, `google-generative-ai`, `mistral-conversations`만 쓸 수 있다. `headers` 값이 `secret://` 참조이면 요청 직전에 해석해 요청 헤더에만 싣는다 [구현: M2].
- 자격 증명 참조는 설정 `l1.models.providers`의 `apiKeyRef`가 먼저이고 없으면 등록부의 `apiKey`(config)나 `credential`(runtime)이다. `list({ available: true })`는 참조가 있는 provider와 등록부로 들어온 provider를 포함한다 [구현: M2].
- 포트 경로 `registerProvider`가 던지는 값은 `ModelRegistrationError`(`Error`를 확장하고 `kind`, `ref`, `message`로 `ModelError`를 구현한다)다 [구현: M2].
- `addProvider`는 `name`이 이미 있으면 `provider_conflict` 오류를 낸다. 같은 owner가 다시 등록하는 경우도 먼저 해제해야 한다 [제안]. 해제는 반환된 `Unsubscribe`와 scope dispose(X)로 한다.
- `registerProvider`(포트 경로)는 `Result`를 돌려주지 않는다. `config`가 `ProviderConfigDefSchema`를 통과하지 않으면 `kind: "invalid_provider"`, 이름이 겹치면 `provider_conflict`인 `ModelError`를 던진다 [제안]. X는 이 예외를 등록 실패로 확장에 돌려준다.
- 내장 provider(pi-ai `providers/all.ts`)의 기본값을 바꾸는 등록(pi 예: baseUrl만 바꾸기)은 `kind: "config"`에 `models` 없이 `baseUrl`만 주는 형태로 허용한다.
- `kind: "runtime"`은 함수가 들어 있으므로 JSON 매니페스트로 선언할 수 없다. 그래서 포트 경로에는 넣지 않고 `addProvider`로만 받는다. F `ProviderResourceDef`는 `JsonValue` 그대로 둔다.
- [미결] pi `registerVirtualModel`(가상 모델 라우터, `X.primitives.spec` §4.8 표)을 지원할지. 역할 표와 그룹 덮어쓰기로 대부분의 용도가 해결되므로 2차 이후로 미룬다 [제안].

### 3.8 오류

```ts
export type ModelErrorKind =
  // 해석·등록 단계 (Result 오류)
  | "invalid_ref" | "no_model_for_role" | "model_not_found" | "model_denied"
  | "provider_unavailable" | "provider_conflict" | "invalid_provider" | "secret_unresolved" | "oauth_token_on_default_provider"
  // 호출 단계 (stopReason "error" 메시지의 분류, classify 결과)
  | "rate_limited" | "quota_exhausted" | "overloaded" | "context_overflow"
  | "auth" | "aborted" | "transport" | "provider_error";

export interface ModelError {
  readonly kind: ModelErrorKind;
  readonly message: string;           // 비밀 값 마스킹을 거친 문자열
  readonly role?: ModelRole;
  readonly ref?: ModelRefString;
  readonly retryAfterMs?: number;
}
```

`classify` 규칙 [제안]:

| 순서 | 조건 | 결과 |
|---|---|---|
| 1 | `stopReason === "aborted"` | `aborted` |
| 2 | `isContextOverflow(message, contextWindow)` | `context_overflow` |
| 3 | `stopReason !== "error"` | `null` |
| 4 | pi-ai의 재시도 불가 한도 패턴(`retry.ts:252-257`의 `NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN`) | `quota_exhausted` |
| 5 | HTTP 429 또는 레이트 리밋 문구 | `rate_limited` |
| 6 | HTTP 529, 503, "overloaded" 문구 | `overloaded` |
| 7 | HTTP 401, 403 | `auth` |
| 8 | 연결 실패, 시간 초과 | `transport` |
| 9 | 그 밖 | `provider_error` |

- 5~8의 문구 판정은 pi-ai 정규식을 쓰고 Xeon 정규식을 새로 만들지 않는다. pi-ai에 없는 구분(5와 6)은 `errorMessage`의 HTTP 상태 접두에서 읽는다 [가정: pi-ai 오류 메시지가 상태 코드를 담는다. M-1 테스트에서 확인].

### 3.9 비밀 다리

```ts
// xeon/packages/core-models/src/secrets-bridge.ts (core-models 내부, 공개하지 않음)
import type { CredentialStore } from "@earendil-works/pi-ai";
import type { SecretService } from "@xeon/contracts/services";   // xeon.secrets, F.capabilities.spec §3.12 규칙 7

export interface ProviderCredentialRefs {
  /** providerId → 비밀 참조. l1.models.providers 설정에서 만든다 */
  get(providerId: string): SecretRefString | null;
}
/** pi-ai CredentialStore 구현. read()가 요청마다 참조를 해석한다. list()는 메타만, modify·delete는 거부 */
export function secretBackedCredentialStore(refs: ProviderCredentialRefs, secrets: SecretService): CredentialStore;
```

- 해석 시점: pi-ai `Models.getAuth`가 요청마다 `CredentialStore.read(providerId)`를 부른다(`auth/types.ts:65-70`). 이 함수 안에서만 `xeon.secrets`로 값을 얻고, 값은 반환 객체 안에만 있다. 캐시하지 않는다 [제안](`_research/secrets.md` §6.2 "실행 직전 해석").
- 값은 요청 헤더로만 나간다. `ModelCallRequest`, `ResolvedModel`, 이벤트, 로그, 지점 페이로드에 싣지 않는다(§7.2 헤더 가림).
- 사용 모드: `runtime-http`(`L0.secrets.spec` §4.3 M3)로 `lease`한다. purpose는 `model.provider:<id>`, `target`은 provider 기본 URL의 호스트다. 마일스톤 M1부터 이 모드를 쓴다. 값은 프로세스 안 HTTP 클라이언트에만 있고 모델 컨텍스트, 이벤트, DB에 들어가지 않는다(review.decisions-2 U-19 보충). bash 도구의 비밀 주입은 `env` 모드 그대로다.
- 사용 정책의 근원 [결정: M2 Mac 실기]: 새로 등록한 비밀의 사용 정책은 비어 있어(`L4.host-service.spec` HS-45) 위 `lease`는 `denied`다. 비밀을 provider에 연결하는 사람의 행위(사용자 범위 `l1.models.providers`의 `apiKeyRef` 쓰기. 데스크톱 "provider에 연결"과 `xeon config set`은 모두 `settings.set`이다)가 이 호출 하나만 허용하는 정책을 비밀 메타에 더한다. 허용은 `modes: ["runtime-http"]`, `tools: ["model.provider:<id>"]`, `hosts: [providerTarget(<id>)의 호스트]`뿐이다. `env` 모드, 도구, 다른 호스트는 열지 않는다. 호스트 쪽 규칙은 `L4.host-service.spec` HS-45 [결정: M2 Mac 실기]다. `providerTarget`은 이 호스트 값을 호출과 같은 규칙으로 구하기 위한 조회다.
- `modify`, `delete`는 `ModelsError("auth")`를 던진다. 키 등록과 삭제는 비밀 관리 경로(`just secret-add`, 설정 화면 secrets 탭)로만 한다.
- `list()`는 provider 이름과 참조 유무만 돌려준다(pi 계약: "must not execute configured API-key commands while listing").
- 오류 문자열은 `xeon.secrets`의 마스킹 함수를 지난다 [가정: L0.secrets.spec이 마스킹 API를 서비스로 제공한다].
- `lease`가 정책으로 거부되면(`denied`) 종결 메시지의 사유 문장에 거부 사유를 싣는다: `secret_unresolved: secret <이름> could not be leased (denied: mode_not_allowed)`. 사람이 어디를 고칠지(사용 모드, 호스트) 알 수 있다 [결정: M2 Mac 실기].
- 위장 경로 가드 [제안]: 기본 `anthropic` provider에서 해석한 값이 `sk-ant-oat`를 포함하면 요청을 보내지 않고 `oauth_token_on_default_provider` 오류를 낸다. pi-ai 기본 경로는 키 접두만으로 위장 분기에 들어가기 때문이다(`anthropic-messages.ts:978-980`, `1014`, `_research/notes/L1-2.md` §3.1). [결정 M-1: m2/l1c] 가드로 막는다. 설정 참조뿐 아니라 agent-core가 `apiKey` 옵션으로 넘긴 값도 같은 규칙으로 검사한다(기본 provider id `anthropic`만 대상이다). 가드에 걸리면 종결 메시지는 `oauth_token_on_default_provider: …`이고 요청은 나가지 않는다.

### 3.10 2차 타입

```ts
// M3: 계정 풀과 레이트 리밋 (core-models/src/accounts.ts, rate-limit.ts). review.decisions-2 U-21
export interface AccountDef {
  readonly provider: string;
  readonly accountId: string;                 // ^[a-z0-9][a-z0-9-]{0,63}$
  readonly credential: SecretRefString;
  readonly priority: number;                  // 작을수록 먼저
  readonly reservePct: number;                // 0~100. 창 한도의 이 비율은 예약으로 남긴다
}
export type UsageLimitAction = "wait" | "switch" | "fail";
export interface RateLimitPolicy {
  readonly minIntervalMs: number;             // 같은 계정 요청 사이 최소 간격
  readonly onLimit: UsageLimitAction;
  readonly maxWaitMs: number;                 // wait일 때 상한. 넘으면 switch, 계정이 없으면 fail
}

// 2차: 폴백 체인 (fallback.ts)
export interface FallbackChain {
  readonly role: ModelRole;
  readonly refs: readonly ModelRefString[];   // 최대 3개 [제안]
}

// 2차: 구조화 출력 (structured-output.ts)
export interface StructuredRequest<T> extends ModelCallRequest {
  readonly schema: TSchema;                   // TypeBox
  readonly maxAttempts: number;               // 기본 3, 상한 5
}
export type StructuredResult<T> =
  | { readonly ok: true; readonly value: T; readonly attempts: number; readonly usage: Usage }
  | { readonly ok: false; readonly kind: "schema_mismatch" | ModelErrorKind; readonly attempts: number; readonly lastError: string };
```

[결정: M3b B3-L1M, 오케스트레이터 기본값] 최소형 `completeStructured`는 `ModelService`에 더하지 않고 core-agents의 `structured.ts`(`L1.agents.spec` §4.8)에 둔다. 아래 서명은 계정 풀·폴백과 함께 쓰는 2차 형태가 필요해질 때 `ModelService`로 옮기는 후보다. 그때까지 이 절의 `ModelService` 항목은 쓰지 않는다. 후보 서명: `ModelService`에는 `completeStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>`를 더한다. 계획 v2는 구조화 출력을 2차로 두었다. 그러나 목표 판정(`L1.agents.spec` §4.8, 제품 범위 I11은 M3)이 구조화 판정 출력을 쓰므로 [제안] `completeStructured`의 최소형(재시도 루프와 횟수 상한만)을 M3에 당긴다. 계정 풀·폴백과 함께 쓰는 형태는 2차에 남긴다.

### 3.11 위장 provider 플러그인

```ts
// xeon/plugins/provider-anthropic-oauth/src/plugin.ts
// import 허용: @xeon/contracts(F), @xeon/ext-host(X), L0 패키지, 외부 패키지 @earendil-works/pi-ai(값)·@anthropic-ai/sdk(pi-ai가 쓰는 0.129.0과 같은 모듈)
// import 금지: @xeon/core-*
export const manifest: ExtensionManifest;   // name "provider-anthropic-oauth", kind "plugin", defaultEnabled false

/** setup에서 주입받은 xeon.models(F ModelService)의 addProvider(owner, "anthropic-oauth", { kind: "runtime", provider, credential }) */
export function setup(g: ScopeApi<unknown>): void;
```

- [결정: review.decisions-2 U-16] `plugins/*`는 L1 순위다. 플러그인은 F, X, L0, 외부 패키지(pi-ai)만 import하고 `core-*`는 import하지 않는다. 같은 층 예외는 두지 않는다.
- 등록 경로: 플러그인 → F provider 인터페이스(`ProviderDef`) → `xeon.models`(core-models 서비스)의 `addProvider`. 서비스는 X가 주입한다. 플러그인은 X `ModelsPort`(`hostOf(g).registerProvider`)를 쓰지 않는다(`X.primitives.spec` §3.9). 플러그인은 core-models를 import하지 않는다.
- 이 경로는 import 자체를 없애므로 `plugins/*`를 L1에 두어도 같은 층 import가 생기지 않는다. 고칠 구속 문서: `eng.dependency-rules.guide` DR-07(pi-ai 소유 패키지에 `plugins/provider-anthropic-oauth`를 더한다)과 DR-09(플러그인 허용 목록을 F, X, L0, pi-ai·Anthropic SDK로 바꾸고 `DR-02/provider-anthropic-oauth` 항목을 지운다).

### 3.12 hosted 검색 포트

내장 검색 래퍼(`L2.web.spec` §4.8.4)가 쓰는 `ModelService.hostedSearch`(F `HostedSearchPort`, `@xeon/contracts/services`)의 구현이다 [구현: M2, L1C.3]. 타입은 F가 정했고 이 절은 구현 규칙만 적는다.

- 모델: `HostedSearchRequest.model`이 `auto`이면 역할 `search`의 해석 결과(`l1.models.routing.search` → `summary` → `main` → default)이고, 아니면 그 모델 참조를 역할 `search`로 해석한다(허용·차단 목록을 거친다). 해석에 실패하면 `support`는 `no_model`, `search`는 `unsupported_model`(provider·모델 null)이다.
- 지원 판정(`support`): 모델 API가 `anthropic-messages`이고 provider가 `anthropic`이거나 기본 주소의 호스트가 `anthropic.com`이면 지원한다. 같은 API를 쓰는 타사 호환 서버는 지원하지 않는다(`no_hosted_search`). 판정은 모델 호출도 비밀 해석도 하지 않는다.
- 요청: 기존 호출 파이프라인을 지난다(비밀 참조 해석, `sk-ant-oat` 가드, 재시도, 사용량). 추가로 `onPayload` 훅이 페이로드에 서버 도구 `{ type: "web_search_20250305", name: "web_search", max_uses: 1 }`을 넣는다. 시스템 프롬프트는 `request.system`, 사용자 메시지는 `request.query` 한 줄, 출력 상한은 `maxOutputTokens`, 추론은 끈다. 캐시는 역할 `search`라 보존 없음이다.
- 도메인: `allow`가 있으면 `allowed_domains`만, 없고 `deny`가 있으면 `blocked_domains`만 넘긴다(Anthropic은 둘을 함께 받지 않는다). 둘 다 있으면 `deny`는 넘기지 않고 로그 `hosted_search.deny_not_sent`를 남긴다. 호출자가 결과를 다시 거른다.
- 응답: pi-ai anthropic 어댑터는 서버 도구 블록을 `AssistantMessage`에 싣지 않으므로 어댑터가 `onProviderStreamEvent`로 넘기는 원시 SSE 이벤트를 `anthropic-stream.ts`가 다시 모은다. `web_search_tool_result`의 `url`, `title`, `page_age`가 `results`, 텍스트 블록의 `web_search_result_location`이 `citations`, 텍스트가 `text`다. `encrypted_content`, `encrypted_index`는 응답에 담지 않는다. 사용량은 입력·출력 토큰과 `server_tool_use.web_search_requests`다.
- 종료 사유: `message_delta`의 `stop_reason`을 `end_turn`, `pause_turn`, `max_tokens`, `refusal`로 옮기고 그 밖의 값은 `end_turn`이다. 종료 사유를 받았으면 `refusal`처럼 pi-ai가 오류로 끝낸 경우도 정상 응답이다.
- 이어 요청: `pause_turn`이면 직전 응답의 content 블록 전체(`encrypted_content` 포함)를 JSON으로 직렬화해 `hs1:<base64url>` 문자열로 `continuation`에 담는다. 호출자는 읽거나 저장하지 않는다. 다음 요청의 `continuation`은 페이로드 `messages` 끝에 assistant 메시지로 되돌려 보낸다. 해석할 수 없는 문자열은 `upstream`(`status: null`)이고 요청을 보내지 않는다.
- 오류(`HostedSearchError`): 신호가 중단됐으면 `cancelled`. HTTP 400이고 메시지에 web search와 organization·admin·disabled·not enabled 계열 단어가 함께 있으면 `org_disabled` [가정: 오류 문구는 실제 응답으로 확인하지 못했다]. 429나 도구 결과의 `too_many_requests`는 `rate_limited`(`retryAfterMs: null`). provider·모델 없음은 `unsupported_model`. 그 밖은 `upstream`이고 `status`는 메시지에서 읽은 HTTP 상태, `message`는 비밀 마스킹을 거친 문자열이다. 결과가 없고 도구 결과가 `web_search_tool_result_error`면 `upstream`이다.
- thread에 속하지 않는 호출이다. 요청 지점(`request.provider.before` 등)과 `request.model.after`는 발화하지 않는다. 사용량은 예약 thread id(`HOSTED_SEARCH_THREAD`)에 역할 `search`로 쌓인다.
- 시험: 어댑터 원시 이벤트를 테이프 차례의 `rawEvents`로 재생한다(`@xeon/core-models/testing`의 테이프 provider). 네트워크 호출은 없다.
- 범위 밖: 이 포트는 대화 기록에 남지 않는 단일 턴 요청이다. 메인 모델의 일반 턴 요청에 서버 도구를 넣는 일(`L2.web.spec` §4.8.1 A안)은 M2에 구현하지 않았다. 사유는 §10 12번이다.

## 4. 동작 규칙

### 4.1 역할 해석

해석은 순수 함수 `resolveRole`(F 요청, `core-models/src/role-table.ts`에서 쓰는 이름과 같음)로 한다. 입력은 역할, 덮어쓰기, 설정 스냅샷(`RoutingTable`), 카탈로그 조회 함수다.

```ts
export interface RoutingTable {
  readonly default: ModelRefString | null;                                         // l1.models.default
  readonly routing: Readonly<Partial<Record<Exclude<ModelRole, "main">, ModelRefString>>>; // l1.models.routing.*
  readonly groupRouting: Readonly<Record<string, Readonly<Partial<Record<ModelRole, ModelRefString>>>>>;
  readonly thinkingLevel: ModelThinkingLevel;                                      // l1.models.thinkingLevel
  readonly thinkingBudgets: Readonly<Record<Exclude<ModelThinkingLevel, "off">, number>>;
  readonly allowed: readonly string[];                                            // 패턴. 비면 전체 허용
  readonly denied: readonly string[];
}
export const ROLE_FALLBACK: Readonly<Record<ModelRole, readonly ModelRole[]>> = {
  main: [], review: ["main"], summary: ["main"], subagent: ["main"], judge: ["review", "main"], search: ["summary", "main"],
};
export function resolveRole(input: {
  readonly role: ModelRole;
  readonly overrides: RoleOverrides;
  readonly table: RoutingTable;
  readonly lookup: (provider: string, modelId: string) => Model<Api> | undefined;
}): Result<{ readonly binding: ModelBinding; readonly source: ResolutionSource; readonly model: Model<Api>; readonly trace: ResolvedModel["trace"] }, ModelError>;
```

해석 순서 [제안]:

0. `trace`에는 거친 단계를 순서대로 싣고, 값이 없는 단계는 `ref: null`로 남긴다. 값이 있는 첫 단계에서 멈춘다. 그 값이 틀렸으면(`invalid_ref`, `model_not_found`, `model_denied`) 다음 단계로 넘어가지 않고 오류를 돌려준다 [구현: M2].
1. `overrides.ref`가 있으면 그것을 쓴다. 출처 `explicit`.
2. `overrides.scopeId`가 있고 `groupRouting[scopeId][role]`가 있으면 그것을 쓴다. 출처 `group:<scopeId>`.
3. 역할이 `main`이 아니고 `routing[role]`이 있으면 그것을 쓴다. 출처 `role`.
4. `ROLE_FALLBACK[role]`의 역할을 앞에서부터 차례로 2~3단계로 찾는다(그룹 덮어쓰기 포함). 출처 `role-fallback`.
5. `default`를 쓴다. 출처 `default`.
6. 모두 없으면 `no_model_for_role`.

해석 뒤 검사:

- `parseModelRef` 실패 → `invalid_ref`.
- 카탈로그에 없음 → `model_not_found`.
- `denied` 패턴에 맞거나, `allowed`가 비어 있지 않은데 맞지 않음 → `model_denied`. 패턴은 `provider/modelId` 전체 일치 또는 `provider/*`다.
- 추론 레벨: `overrides.thinkingLevel` → 참조 접미 → `table.thinkingLevel` 순으로 정하고 pi-ai `clampThinkingLevel(model, level)`로 모델이 지원하는 값으로 맞춘다(`models.ts:1235`). `model.reasoning`이 false면 `off`다.
- 토큰 예산: 레벨이 `off`가 아니면 `table.thinkingBudgets[level]`. 호출 때 pi-ai `thinkingBudgets`로 넘기는 것은 `minimal`~`high` 네 키뿐이다(§3.1 포크 판정).
- 그룹 덮어쓰기가 꺼진 scope의 값인지는 서비스 의존 `scopeEnabled(scopeId)`로 판정한다. 플러그인은 `ext.scopes()`의 상태가 `enabled`인 scope만 켜진 것으로 연결한다. 의존이 없으면 모든 scope가 켜진 것으로 본다 [구현: M2].
- `rebind`는 카탈로그 부재 외에 허용·차단 목록에 걸린 고정 모델도 `model_denied`로 거부한다. 고정 레벨은 clamp하지 않는다 [구현: M2].
- 설정 스냅샷은 호출 시점의 유효 값(`F.wire-settings.spec` §3.9 `resolveSetting`)이다. 범위 우선순위(관리 > 세션 > 로컬 > 프로젝트 > 사용자)는 설정 계층이 처리하므로 이 순서에는 넣지 않는다. 세션 중 `/model` 변경은 `l1.models.default`의 세션 범위 값이다.

### 4.2 추론 레벨과 체크포인트 고정

1. 단계 시작에 core-loop가 `resolve("main", { scopeId })`를 부르고 결과 바인딩을 그 단계의 모든 요청에 쓴다(`L1.loop.spec`).
2. 같은 단계의 `checkpoint.step`에 `{ provider, modelId, thinkingLevel }`을 쓴다(`F.records.spec` §3.6 `StepCheckpoint.model`).
3. 재개하면 core-loop가 `rebind(checkpoint.model + role "main")`을 부른다. 역할 표를 거치지 않으므로 설정이 바뀌었어도 재개 뒤 첫 요청은 고정 값을 쓴다. 출처는 `checkpoint`다.
4. 그 다음 단계부터는 1번으로 돌아가 새로 해석한다.
5. 고정 모델이 카탈로그에서 사라졌거나 차단 목록에 들어갔으면 `rebind`는 오류를 낸다. core-loop는 새로 해석하고 `request.model.after`(`source: "restore"`)를 발화한다 [제안].
6. 바인딩이 이전 단계와 다르면 `request.model.after`를 발화한다. 레벨만 다르면 `request.thinking.after`를 발화한다(§7).

### 4.3 호출 파이프라인

`stream`, `complete`, `streamFn`이 공유하는 순서다 [제안].

| 순서 | 동작 | pi-ai 연결점 |
|---|---|---|
| 1 | 바인딩의 provider가 등록되어 있고 사용 가능한지 확인 | `Models.getProvider` |
| 2 | 캐시 정책 적용: `cacheRetention`, `sessionId = threadId`(retention이 none이 아닐 때) | `StreamOptions` |
| 3 | 추론: `reasoning = thinkingLevel`(off면 생략), `thinkingBudgets` | `SimpleStreamOptions` |
| 4 | 재시도 수치: `maxRetries`, `maxRetryDelayMs` | `ProviderRequestOptions` |
| 5 | 페이로드 확정 뒤: 캐시 표식 적용(anthropic-messages만) → `request.provider.before` 디스패치 | `onPayload` |
| 5b | `request.provider.before` 체인이 끝난 최종 페이로드로 `guard.model.before`(first, fail-closed) 디스패치 [결정: M3-REQ-109]. 차단이면 `[xeon:denied_by_guard] <사유>` 오류를 던져 요청을 보내지 않고, pi-ai가 오류 응답(`stopReason: "error"`)으로 바꾼다. 핸들러·디스패처 예외도 차단이다. 내장 검사는 없다 | `onPayload` |
| 6 | 헤더 확정 뒤: `request.headers.before` 디스패치(비밀 헤더 가림) | `transformHeaders` |
| 7 | 자격 증명 해석(요청 직전) | `CredentialStore.read` |
| 8 | 응답 수신: `request.provider.after` 디스패치 | `onResponse` |
| 9 | 원시 스트림 이벤트: `request.stream` 디스패치(지원하는 어댑터만) | `onProviderStreamEvent` |
| 10 | 종결 이벤트(`done` 또는 `error`): `UsageRecord` 기록 | 스트림 래퍼 |

- 5번 `onPayload`는 1.3.0에서 재시도 때 다시 불린다(`_research/notes/L1-2.md` §3.9). 캐시 표식 적용과 지점 디스패치는 같은 입력에 같은 결과를 내야 한다. on 핸들러 재실행 계약(`F.extensions.spec` §4.3)과 같은 조건이다.
- 모델 요청 자체는 의도 커밋을 두지 않는다. 직전 단계 체크포인트가 그 역할을 한다(`architecture.runtime-flow.design` §4.1).

### 4.4 사용량 집계

1. 스트림 래퍼는 종결 이벤트 `done`의 `message.usage`, `error`의 `error.usage`를 읽는다. 중단(`aborted`)과 오류 응답도 pi-ai가 `usage`를 채우므로 같은 방식으로 기록한다(`_research/packages.md` §4.3 L1-c 비용·토큰 계측 행).
2. 비용은 pi-ai `calculateCost(model, usage)`(`models.ts:1200`)로 계산한 값이 이미 `usage.cost`에 있다. 단가가 모두 0이면 비용은 0으로 합산하고 `UsageTotals`에는 그대로 둔다.
3. 종결 이벤트 없이 스트림이 끊기면(프로세스 종료 제외) 래퍼가 `aborted: true`, 0 사용량으로 기록한다.
4. 합산 단위는 `UsageScope`(thread, turn, role, scope)다. 그룹이 일으킨 호출은 `scopeId`별로 따로 합산한다. drive 임대 상한(`maxTokens`, `F.extensions.spec` §3.2 `DriveLimits`)은 X가 이 합계를 읽어 판정한다 [가정: X.primitives.spec].

### 4.5 재시도

- [제안] 재시도는 provider 요청 단계 하나에서만 한다. pi-ai의 `retryProviderRequest`가 `maxRetries`와 `maxRetryDelayMs`로 429·5xx를 다시 보낸다. 이중 재시도를 피하려고 루프 쪽 `retryAssistantCall`은 주 루프 호출에 쓰지 않는다(`docs/design/12-runtime-engine.md` §3.3.6의 이중 재시도 근거를 참고).
- 이미 콘텐츠 이벤트를 낸 뒤의 스트림 오류는 다시 보내지 않고 오류 종결로 끝낸다. 다음 동작은 core-loop가 정한다.
- `complete` 호출(요약, 판정, 검색)은 `retryAssistantCall`을 쓴다. 콘텐츠를 소비자에게 흘려보내지 않기 때문이다.
- `quota_exhausted`, `auth`, `context_overflow`는 재시도하지 않는다.

### 4.6 캐시

- 접두 고정과 변동 정보 말미 부착은 `L1.context.spec`이 맡는다. 이 서비스는 정책을 만들고 표식을 적용한다.
- 모델이 바뀌면 provider 캐시가 무효가 된다. 경고는 `L1.context.spec` §4.4가 낸다.
- 요약·판정·검색 호출은 `retention: "none"`이다. 주 대화의 캐시 키(`sessionId`)를 공유하지 않는다.
- [미결] 캐시 TTL 기본값. pi-ai 기본은 `short`다(`types.ts:240-243`). 1시간 보존(`long`)은 쓰기 단가가 높아 기본으로 두지 않는 쪽을 제안한다.

### 4.7 비밀 해석 시점

- 설정에는 `secret://<name>` 참조만 저장한다(`F.wire-settings.spec` §3.8.1 D3, `_research/secrets.md` §6.1).
- 해석은 §3.9 `CredentialStore.read` 안에서만 한다. 시작할 때 모든 키를 미리 해석하지 않는다.
- 위장 provider는 `ProviderRuntimeDef.credential`로 참조를 넘기고, 이 서비스가 요청 직전 해석해 `AuthResolutionOverrides.apiKey`로 넣는다. 플러그인 코드는 값을 저장하지 않는다.
- 참조를 해석할 수 없으면 요청을 보내지 않고 `secret_unresolved` 오류 종결 메시지를 낸다.

### 4.8 레이트 리밋과 계정 회전 (M3)

- 근거: pi-ai `CredentialStore`는 provider당 자격 증명 1건이다(`auth/types.ts:65-94`, `read(providerId)`). 같은 provider의 계정 여럿을 돌리려면 그 위에 계정 풀이 필요하다.
- 계정 선택: 우선순위 오름차순으로, 창 사용량이 `100 - reservePct` 퍼센트 아래이고 대기 중이 아닌 첫 계정을 고른다. 고른 계정의 참조를 요청 직전 해석해 `AuthResolutionOverrides.apiKey`로 넣는다.
- 요청 간격: 같은 계정의 직전 요청 시각에서 `minIntervalMs`가 지나기 전에는 요청을 보내지 않고 대기 상태로 둔다. 대기는 `signal`로 취소된다.
- 한도 오류: `rate_limited`는 `retryAfterMs`만큼 그 계정을 대기 상태로 두고 `onLimit`에 따라 대기하거나 다른 계정으로 바꾼다. `quota_exhausted`는 재시도 불가로 분류하고 그 계정을 창이 끝날 때까지 뺀다.
- 상태 저장: `core_models_accounts`(계정 메타, 참조만), `core_models_usage_windows`(계정·창별 합계), `core_models_cooldowns`(대기 종료 시각)를 `xeon.store.scoped("core_models_")`로 쓴다(`eng.context-map.design` §5.2). 세션 투영이 아니므로 재생으로 다시 만들지 않는다.
- 읽기 자료: omp `usage-limit.ts`, `credential-pin.ts`. AgentSession에 결합된 구현이라 코드를 가져오지 않는다(`_research/packages.md` §4.3 L1-c 레이트 리밋 행).
- 단계: M3다. 설정(`l1.models.accounts`, `l1.models.rateLimit`)은 M3 설정 화면에서 조작한다 [결정: review.decisions-2 U-21].
- 구현(M3b B2-MDL): `core-models/src/accounts.ts`(풀 상태기계), `rotation.ts`(호출 하나를 계정 위에서 돌림), `pipeline.ts`(회전 분기). 규칙은 아래와 같다.
  - 기본 꺼짐: 회전은 `account-rotation` 플러그인 scope가 켜져 있고(`xeon.ext` scope 상태) `ext.account-rotation.acknowledgeRisk`가 true일 때만 돈다. 어느 하나라도 아니면 계정 설정은 무시하고 provider 설정의 키를 쓴다. 첫 사용 고지 문구는 플러그인 userConfig와 설정 화면이 보인다(§4.11.3 위장 provider와 같은 방식).
  - 정책이 없는 provider는 `{ minIntervalMs: 0, onLimit: "switch", maxWaitMs: 0 }`이다 [결정: 오케스트레이터 기본값].
  - 계정 선택: 우선순위 오름차순(같으면 설정 순서)으로 쉬는 중이 아니고 `minIntervalMs`가 지난 첫 계정을 고른다. 쓸 수 없지만 곧 생기는 계정이 있으면 대기 대상이다. 간격 대기는 `maxWaitMs` 안에서 늘 허용하고, 한도(쿨다운) 대기는 `onLimit: "wait"`일 때만 허용한다. 넘거나 허용하지 않으면 마지막 한도 오류를 그대로 낸다.
  - `rate_limited`: 오류 문구의 `retry-after`(초 또는 ms)만큼, 없으면 60초 그 계정을 쉬게 한다 [결정: 오케스트레이터 기본값]. `onLimit`이 `fail`이면 바로 오류를 내고, 아니면 다음 계정으로 같은 요청을 다시 보낸다. `quota_exhausted`는 그 계정을 1시간 뺀다 [결정: 오케스트레이터 기본값, 창 종료 시각을 알 수 없다].
  - 콘텐츠를 한 조각이라도 낸 호출은 다시 보내지 않는다. 실패한 시도의 사건(start, error)은 소비자에게 가지 않는다. 회전 중에는 pi-ai 요청 단계 재시도(`maxRetries`)를 끈다(한도 오류를 같은 키로 되풀이하지 않기 위해).
  - 호출자가 `apiKey`를 넘긴 호출과 hosted 검색 같은 내부 호출은 회전하지 않는다.
  - [미결] 상태 저장(`core_models_*` 테이블)은 아직 없다. 쉬는 시각과 마지막 요청 시각은 프로세스 메모리에만 있어 재시작하면 사라진다.
  - [미결] 창 사용률(`reservePct` 비교)을 채우는 출처가 없다. 풀의 `reportUtilization`만 있고 호출하는 곳이 없다.
- client/accounts view-model(M3b B2-MDL): 모델 계정과 레이트 리밋 설정 화면의 순수 로직은 `packages/client/src/accounts/`(`@xeon/client/accounts`)에 둡니다. 화면 컴포넌트는 M4에서 씁니다.
  - 읽기: `modelAccountsView({ accounts, rateLimit, acknowledged, pluginEnabled })`는 `providers`와 `rotation`을 돌려줍니다. `providers`는 계정이나 정책이 있는 provider를 id 순으로 담고, 계정은 우선순위 오름차순(같으면 설정 순서), 정책이 없으면 `policy: null`입니다. `rotation`은 `{ state, notice }`입니다. `state`는 `off`(플러그인 꺼짐, 꺼짐이 먼저 판정됩니다), `needsNotice`(켜졌지만 `ext.account-rotation.acknowledgeRisk`가 `true`가 아님), `on`입니다. 입력은 `unknown`으로 받고 모양이 맞지 않으면 빈 값으로 읽습니다(`accountsOf`, `rateLimitOf`).
  - 검사와 편집: `checkAccount`와 `checkRateLimit`은 `Result`를 돌려주고, 실패는 `{ kind: "invalid", field }`입니다. 범위는 `accountsSchema`·`rateLimitSchema`와 같습니다. client는 core-models를 import하지 않고 typebox로 같은 모양을 적습니다. `withAccount`, `withoutAccount`, `withRateLimit`, `withoutRateLimit`은 입력을 바꾸지 않고 새 값을 돌려줍니다.
  - 저장: `saveModelAccounts(connection, edits)`는 `settings.readFile`(범위 `user`)로 원문을 읽고, 편집한 키 세 개만 바꾼 원문을 같은 `baseSha256`으로 `settings.writeFile`에 보냅니다. 다른 키와 키 순서는 그대로 남습니다. 실패는 `not_object`(파일이 JSON 객체가 아님), `conflict`(`settings.fileConflict`, 읽은 뒤 파일이 바뀜), `host`(그 밖의 와이어 오류), `transport`(응답을 받지 못함)입니다 [결정: 오케스트레이터 기본값, `conflict`를 따로 뺌].
  - 시험 X7(`packages/client/test/accounts/x7.test.ts`, `scripts/exit-tests.txt`): 메모리 호스트가 설정 파일 하나를 들고 두 번 저장합니다. 키 세 개가 같은 이름으로 쓰이고 다른 키와 키 순서가 남는지, 두 번째 편집이 계정을 지우지 않는지 확인합니다. 키와 값은 core-models의 `MODELS_SETTING_DEFS`와 `validateSettingValue`를 통과해야 합니다. 읽기와 쓰기 사이에 파일이 바뀌면 `conflict`로 실패하고 아무것도 쓰지 않습니다. 같은 종료 조건의 `packages/core-models test/rotation.test.ts`는 429 계정 회전 시험입니다.
  - [미결] 저장 뒤 `settings.invalidated` 알림으로 다시 읽는 일은 M4 화면 작업에서 정합니다. `routes.yaml`의 `settings-ui` 경로(`packages/client/src/settings/**`)에는 `accounts/`가 없어 라우팅으로는 이 절이 찾아지지 않습니다. 경로를 넣을지는 문서 라우팅 담당이 정합니다.
- [미결] 구독 계정 회전은 provider 약관 검토가 필요하다(`_research/settings.md` §2.5 계정 행). M3 착수 전에 별도 설계 문서에서 정한다. 검토 결과가 부정이면 구독 계정 회전만 빼고 API 키 계정 회전과 레이트 리밋은 M3에 둔다.
- 플러그인 패키지 [결정: 오케스트레이터 기본값]: 계정 회전 플러그인은 `packages/group-account-rotation`(kind `group`, layer L3, `defaultEnabled: false`)에 둡니다. 이 그룹은 고지 설정 `ext.account-rotation.acknowledgeRisk`(기본 false)를 읽기만 하고 아무것도 등록하지 않습니다. 회전 게이트는 위 두 조건을 core-models가 봅니다. 패키지의 `build:plugin` 스크립트가 `.xeon-plugin/plugin.json`과 `dist/index.js`를 만듭니다.

### 4.9 폴백 체인 (2차)

- 동작 조건은 `overloaded`와 `provider_unavailable`뿐이다. 레이트 리밋(`rate_limited`, `quota_exhausted`)에서는 동작하지 않는다. 레이트 리밋은 §4.8 정책이 처리한다(Claude Code `fallbackModel` 규칙, `_research/settings.md` §2.5 폴백 행).
- 체인은 역할별이다. 콘텐츠를 아직 내지 않은 요청만 다음 모델로 다시 보낸다.
- 폴백으로 바뀐 바인딩은 그 단계 안에서만 유지하고, 체크포인트에는 실제로 쓴 바인딩을 쓴다. 다음 단계는 역할 표로 다시 해석한다 [제안]. 바뀔 때 `request.model.after`(`source: "fallback"`)를 발화한다.
- 참고: omp `session/retry-fallback-chains.ts`(읽기 자료).

### 4.10 구조화 출력 (2차)

1. 스키마를 매개변수로 가진 도구 하나(`final_answer`)를 광고하고 `toolChoice`로 그 도구 호출을 요구한다 [가정: provider별 강제 호출 옵션을 pi-ai가 노출한다. 노출하지 않으면 시스템 지시로 대신한다].
2. 응답의 도구 호출 인자를 pi-ai `validateToolArguments`(`utils/validation.ts:317`)로 검증한다. 1.3.0은 `argumentsError`가 있으면 먼저 던진다(`_research/notes/L1-1.md` §0-7).
3. 실패하면 검증 오류 문구를 도구 결과로 붙여 다시 요청한다. 시도 수 상한은 `maxAttempts`(기본 3, 최대 5)다(Claude Code 최대 5회, `_research/item-catalog.md` L1-c).
4. 모든 시도의 사용량을 합산해 결과에 싣는다.

### 4.11 위장 provider

[결정] 위장 경로는 유지하되 `xeon/plugins/provider-anthropic-oauth`로 분리하고, 배포판에서 빼고, 기본 꺼짐(`defaultEnabled: false`)으로 둔다(`_research/decisions-log.md` 2026-10-21 결정 2차, `_research/foundation-plan.md` §2 모델·루프 행, `product.scope.spec` N6).

#### 4.11.1 pi-ai 안의 위장 코드 8곳

`anthropic-messages.ts` 기준. 1.1.0 소스 줄은 `_research/packages.md` §2.1, 1.3.0 dist 줄은 `_research/notes/L1-2.md` §3.9다.

| # | 1.1.0 소스 줄 | 1.3.0 dist 줄 | 내용 | 방안 A의 처리 | 플러그인 파일 |
|---|---|---|---|---|---|
| 1 | 95-132 | 43-69 | 위장 선언: `claudeCodeVersion = "2.1.280"`, CC 도구명 17개, `toClaudeCodeName`, `fromClaudeCodeName` | 표와 버전 문자열을 복제하고 함께 고정한다 | `tool-name-map.ts` |
| 2 | 603-607, 636-639 | 406-408 | `isOAuth` 변수. `options.client`가 있으면 `false`로 고정 | 래퍼가 항상 `options.client`를 넘긴다. 원본 위장 분기는 실행되지 않는다 | `wrapper.ts` |
| 3 | 727-729 | 548-549 | 응답 스트림 도구명 역치환 | 래퍼 스트림이 `toolcall_start`에서 블록 `name`을 되돌린다. 같은 객체를 후속 이벤트와 `done`이 참조하므로 한 번이면 된다 | `stream-unmap.ts` |
| 4 | 978-980 | 783-785 | 판별식 `apiKey.includes("sk-ant-oat")` | client 경로에서는 평가되지 않는다. 기본 경로는 core-models 가드(§3.9)로 막는다 | (core-models `secrets-bridge.ts`) |
| 5 | 1013-1033 | 803-822 | OAuth 클라이언트: Bearer, `user-agent: claude-cli/<ver>`, `x-app: cli` 등 | SDK 클라이언트를 `apiKey: null`, `authToken`, 같은 헤더 세트로 직접 만든다. `user-agent`는 한 키만 둔다 | `wrapper.ts` |
| 6 | 1106 | 874-875 | beta 헤더 `claude-code-20250219`, `oauth-2025-04-20` | `onPayload`에서 `params.betas`를 고친다. `anthropic-beta` 헤더 설정 여부에 따른 조건 분기(1087-1106)를 복제한다 | `payload-rewrite.ts` |
| 7 | 1167-1186 | 931-944 | 시스템 프롬프트 앞 identity 문장 | `onPayload`에서 `params.system` 앞에 블록을 넣고 `cache_control`을 원문 블록에서 복사한다 | `payload-rewrite.ts` |
| 8 | 1347, 1443, 1603 | 1078, 1175, 1323 | `tool_reference`, `tool_use`, 도구 정의 이름을 CC 표기로 치환 | `onPayload`에서 `tools[].name`, `messages[].content[]`의 `tool_use.name`, system 메시지의 `tool_removal`·`tool_addition` 이름을 바꾼다 | `payload-rewrite.ts` |

- 로그인 흐름(`auth/oauth/anthropic.ts`, 307줄)은 `providers/anthropic.ts:81-84`의 lazy 슬롯에 이미 분리되어 있다(`_research/packages.md` §2.1). 플러그인은 이 모듈을 그대로 쓴다.

#### 4.11.2 방안 A와 방안 B

방안 A(래퍼, 포크 없음)를 먼저 시도한다(`_research/packages.md` §2.1 권고, `_research/notes/L1-2.md` §1 "기술적으로 가능").

| 구성 | 내용 |
|---|---|
| 래퍼 provider | `ProviderStreams`(`types.ts:311`)를 구현한다. `stream`은 원본 `stream`(export, 1.1.0 `:571`)을 `options.client`와 `onPayload`를 넣어 부른다 |
| `streamSimple` | 원본에 위임하지 않는다. 원본은 `buildBaseOptions`가 `client`를 버려 판별식이 다시 평가된다(`_research/notes/L1-2.md` §3.7). reasoning 매핑(약 50줄)을 복제하고 공개 도우미 `adjustMaxTokensForThinking`, `clampMaxTokensToContext`를 쓴다 |
| `options.client` 주입 | `new Anthropic({ apiKey: null, authToken, defaultHeaders, fetch })`. client 경로는 `options.headers`, `options.fetch`, 세션 헤더를 무시하므로 래퍼가 직접 병합한다(`_research/notes/L1-2.md` §3.2 표) |
| `onPayload` 치환 | 8곳 표의 6·7·8. 같은 입력에 같은 출력을 내는 순수 함수다. 1.3.0은 재시도 때 다시 부른다 |
| 응답 역치환 | 8곳 표의 3 |
| Api id와 provider id | 두 갈래가 있다. A1은 새 Api id를 `registerApiProvider`로 전역 등록한다. A2는 Api id `anthropic-messages`를 그대로 두고 `createProvider({ id: "anthropic-oauth", api: { "anthropic-messages": wrapper } })`로 provider id만 나눈다. [제안] A2. A1은 managed effort 이력(`1456-1460`, `1524`)과 compat 스키마 키(`providers/compat-schema.ts:594`)를 잃는다(`_research/notes/L1-2.md` §3.8). [미결 M-2] 최종 선택은 M-8 스파이크 결과로 정한다 |

방안 B로 내려가는 조건 [제안]. 하나라도 맞으면 B로 바꾼다.

1. pi-ai 업그레이드에서 `options.client` 주입 경로나 `onPayload` 호출 위치가 없어지거나, `onPayload`가 최종 요청 본문을 받지 않게 된다.
2. 와이어 동등성 테스트(원본 경로와 래퍼 경로의 요청 URL, 헤더, 본문 비교, `L1.models.plan` M-8)를 공개 경로만으로 통과시킬 수 없다.
3. 래퍼가 복제해야 하는 pi-ai 비공개 코드가 150줄을 넘는다. 현재 추정은 `getCacheControl`·`resolveCacheRetention` 약 15줄, `streamSimple` reasoning 매핑 약 50줄, beta 조건 분기, 도구명 표다.
4. 실 토큰 스모크(수동)에서 원본 경로는 수용되고 래퍼 경로는 거부된다.

방안 B: `anthropic-messages.ts` 한 파일만 포크해 플러그인 안 `src/anthropic-messages-cc.ts`로 둔다. 원본은 `~/projects/_ref/pi-src/packages/ai/src/api/anthropic-messages.ts`(pi 커밋 `cdaf6c2`, 1639줄)이고, 1.3.0의 재시도 루프 차이(`dist:434-470`)를 반영해야 한다. 업스트림 변경을 따라가는 병합 비용이 크다(`_research/packages.md` §2.1 방안 B 위험).

#### 4.11.3 활성화와 위험 고지

- 기본 꺼짐: 매니페스트 `defaultEnabled: false`. 켜기 키는 X 예약 키 `ext.provider-anthropic-oauth.enabled`다(`F.extensions.spec` §6). 관리 범위에서 `false`로 잠글 수 있다.
- 사용자 확인 [제안]: userConfig 키 `ext.provider-anthropic-oauth.acknowledgeRisk`(boolean, 기본 false). 이 값이 true가 아니면 setup이 provider를 등록하지 않고 진단 메시지를 낸다. 설정 화면 plugins 탭은 켜기 전에 아래 문구를 보인다.

  > 이 플러그인은 Claude 구독 OAuth 토큰으로 Claude Code 클라이언트와 같은 모양의 요청을 보낸다. Anthropic 이용 약관에 어긋날 수 있고 계정이 제한되거나 정지될 수 있다. 공개 배포판에는 들어 있지 않으며, 켜면 그 위험을 사용자가 진다.

- [가정] Anthropic 서버가 래퍼 경로 요청을 받아들이고 구독 OAuth 토큰을 이 방식으로 쓸 수 있다고 보고 설계한다. 둘 다 확인하지 않았다(`_research/notes/L1-2.md` §6). 공개 배포 여부를 정하기 전에 확인한다.
- [미결] 별도 플러그인 배포 여부(`product.scope.spec` N6).
- 구현 위치 [결정: 오케스트레이터 기본값]: 위장 provider 플러그인은 `xeon/packages/group-provider-anthropic-oauth`에 둡니다. kind `group`, layer L3, `defaultEnabled: false`, scope id `provider-anthropic-oauth`입니다. 설정 `ext.provider-anthropic-oauth.acknowledgeRisk`(boolean, 기본 false)와 `ext.provider-anthropic-oauth.credential`(비밀 참조 또는 null, 기본 null)이 모두 참일 때만 setup이 provider `anthropic-oauth`(api `anthropic-messages`, 모델 3개)를 등록합니다. 하나라도 어긋나면 아무것도 등록하지 않으므로 `anthropic-oauth/…` 참조는 `provider_unavailable`이 됩니다. 등록은 setup에서만 일어나므로 설정을 바꾼 뒤에는 scope를 다시 켜야 반영됩니다. 위장은 pi-ai 내장 OAuth 분기에 맡기고 provider id가 `anthropic`이 아니므로 §3.9 가드 밖에서 동작합니다. 와이어 동등 래퍼는 만들지 않았습니다.
- [미결] M-8 와이어 동등 래퍼를 쓸지 정하지 않았습니다. 고지 동의가 없을 때 진단 메시지를 내라는 위 사용자 확인 `[제안]`은 구현하지 않았습니다. 그룹 API에는 진단 경로가 없어 setup은 조용히 등록을 건너뜁니다.
- [미결] `xeon/plugins/provider-anthropic-oauth` 스텁을 남길지 정하지 않았습니다. 이 위치는 §3.11이 가리키는 옛 경로입니다.

#### 4.11.4 배포 제외 검사

`eng.dependency-rules.guide` DR-09 배포 제외 규칙을 검사로 옮긴다. CI 항목 위치는 `L1.models.plan`이다.

| # | 검사 | 실패 조건 |
|---|---|---|
| 1 | 모든 `xeon/**/package.json`의 `dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies` | 플러그인 자신 밖에서 `@xeon/provider-anthropic-oauth`가 나온다 |
| 2 | `bun build --compile` 진입점(`apps/cli`, `apps/host`)의 메타파일 입력 목록 | `plugins/provider-anthropic-oauth/` 경로가 있다 |
| 3 | 배포 번들의 내장 플러그인 목록(`L4.host-service.spec` 조립 목록) | `provider-anthropic-oauth`가 있다 |
| 4 | core-models 테스트를 플러그인 디렉터리를 지운 작업 트리에서 실행 | 하나라도 실패한다 |

- 바이너리 문자열 검사(예: `claude-cli/`)는 쓰지 않는다. 방안 A에서는 pi-ai 본체에 위장 분기 코드가 그대로 남아 있어 항상 걸리기 때문이다. 그 분기의 실행은 §3.9 가드가 막는다.

## 5. 실패와 경계 사례

| 사례 | 처리 |
|---|---|
| `l1.models.default`가 없고 역할 표도 비어 있음 | `resolve`가 `no_model_for_role`. core-loop는 턴을 시작하지 않고 설정 안내 오류를 낸다 |
| 참조 형식 오류(`anthropic` 같이 `/` 없음) | 설정 쓰기 단계에서 `settings.invalidValue`(`ModelRefStringSchema`). 파일에 남은 값은 `invalid_ref` |
| 참조 접미가 레벨 이름이 아님(`…-v1:0`) | modelId의 일부로 읽는다 |
| 모델이 지원하지 않는 레벨 요청 | `clampThinkingLevel`로 낮춘다. `request.thinking.after`는 실제 쓰인 레벨로 발화한다 |
| 체크포인트의 모델이 없어짐 | `rebind` 오류 → 새로 해석, `request.model.after`(`restore`) |
| 그룹 덮어쓰기의 scopeId가 꺼진 그룹 | 덮어쓰기를 무시한다. 꺼진 그룹은 호출을 일으키지 않으므로 정상 경로에서는 생기지 않는다 |
| 비밀 참조 해석 실패 | `secret_unresolved` 오류 종결 메시지. 재시도하지 않는다 |
| 기본 `anthropic` provider에 `sk-ant-oat` 키 | `oauth_token_on_default_provider`. 요청을 보내지 않는다 |
| 같은 이름 provider 두 번 등록 | 두 번째가 `provider_conflict` |
| `request.provider.before` 핸들러가 페이로드를 망가뜨림 | 그 핸들러 패치를 버리고(skip) 다음으로 간다. 최종 페이로드가 provider에서 거부되면 `provider_error` 종결 |
| `request.headers.before` 패치가 인증 헤더를 바꾸려 함 | 인증 헤더(`authorization`, `x-api-key`, `x-goog-api-key`) 패치는 무시하고 기록한다 [제안] |
| 스트림 도중 사용자 중단 | 종결 `aborted`, 부분 사용량 기록 |
| 캐시 표식이 상한을 넘음 | 우선순위가 낮은 위치부터 버린다(`sites` 뒤쪽부터) |
| 위장 플러그인을 켰지만 `acknowledgeRisk`가 false | provider를 등록하지 않는다. `anthropic-oauth/...` 참조는 `provider_unavailable` |

## 6. 설정 노출

키 문법과 `SettingDef` 규칙은 `F.wire-settings.spec` §3.8이다. 탭 배치는 `L4.settings-ui.spec` §4.1.1 표를 따른다. 모든 키의 `layer`는 `"L1"`이다. 범위 약어: M 관리, U 사용자, P 프로젝트, Lo 로컬, S 세션.

| 키 | 타입 | 기본값 | 범위 | 변경 적용 | 탭 / 위젯 | 단계 |
|---|---|---|---|---|---|---|
| `l1.models.default` | `ModelRefString \| null` | `null` | M U P Lo S | nextTurn | models / select | M1 |
| `l1.models.routing.review` | `ModelRefString \| null` | `null` | M U P Lo S | nextTurn | models / table(역할 표) | M2 |
| `l1.models.routing.summary` | 같음 | `null` | 같음 | nextTurn | 같음 | M2 |
| `l1.models.routing.subagent` | 같음 | `null` | 같음 | nextTurn | 같음 | M2 |
| `l1.models.routing.judge` | 같음 | `null` | 같음 | nextTurn | 같음 | M2 |
| `l1.models.routing.search` | 같음 | `null` | 같음 | nextTurn | 같음 | M2 |
| `l1.models.groupRouting` | `Record<scopeId, Partial<Record<ModelRole, ModelRefString>>>` | `{}` | M U P Lo | nextTurn | models / table | M2 |
| `l1.models.thinkingLevel` | `ModelThinkingLevel` | `"medium"` [가정: pi 기본값과 같음] | M U P Lo S | nextTurn | models / select | M2 |
| `l1.models.thinkingBudgets` | `{ minimal, low, medium, high, xhigh, max: integer ≥ 0 }` | `1024, 2048, 8192, 16384, 32768, 32768`(omp 기본, `_research/settings.md` §2.5) | M U P | nextTurn | models / table(레벨과 같은 행) | M2 |
| `l1.models.allowedModels` | `string[]`(패턴) | `[]` | M U P | nextTurn | models / list | M2 |
| `l1.models.deniedModels` | `string[]`(패턴) | `[]` | M U P | nextTurn | models / list | M2 |
| `l1.models.providers` | `{ id, enabled, apiKeyRef: SecretRef \| null, baseUrl: string \| null }[]` | `[]` | M U P Lo | live | providers / table(키는 참조만) | M1 |
| `l1.models.cacheRetention` | `"none" \| "short" \| "long"` | `"short"` | M U P | nextTurn | advanced / select | M2 |
| `l1.models.retry` | `{ maxRetries: 0~10, baseDelayMs, maxDelayMs }` | `{ 3, 2000, 60000 }`(pi 기본, `_research/settings.md` §2.5) | M U | nextTurn | advanced / table | M1 |
| `l1.models.accounts` | `AccountDef[]` | `[]` | M U | live | providers / table | M3 |
| `l1.models.rateLimit` | `{ [provider]: RateLimitPolicy }` | `{}` | M U P | live | budgets / table | M3 |
| `ext.account-rotation.acknowledgeRisk` | `boolean` | `false` | U | live | plugins / switch | M3 |
| `l1.models.fallbackChains` | `{ [role]: ModelRefString[] }`(역할당 최대 3) | `{}` | M U P | nextTurn | models / table | 2차 |
| `l1.models.structuredOutputAttempts` | `integer 1~5` | `3` | M U P | nextTurn | advanced / number | 2차 |

- 비밀 값은 저장하지 않는다. `apiKeyRef`, `AccountDef.credential`은 `SecretRef` 문자열 패턴(`^secret://[a-z][a-z0-9-]{1,63}$`)을 지난 참조다. 참조 자체는 비밀이 아니므로 `secret: true`(D2, D3) 대상이 아니다 [제안].
- `routing.*`를 역할마다 키 하나로 나눈 이유는 범위별 덮어쓰기를 역할 단위로 하기 위해서다. `groupRouting`은 scopeId에 하이픈이 들어갈 수 있어 키 이름 마디(`[a-z][A-Za-z0-9]*`)로 쓸 수 없으므로 표 값 하나로 둔다.
- 명령: `xeon config set l1.models.default anthropic/claude-sonnet-4-6:high`, 대화 중 `/model`(세션 범위 쓰기), `/thinking <레벨>`(세션 범위 `l1.models.thinkingLevel`).
- 위장 플러그인 키: `ext.provider-anthropic-oauth.enabled`(X 예약, 기본 false), `ext.provider-anthropic-oauth.acknowledgeRisk`(userConfig), `ext.provider-anthropic-oauth.credential`(userConfig, `sensitive: true` → 참조). 탭은 plugins.

## 7. 확장 지점

### 7.1 발화하는 지점

fold와 페이로드는 `F.extensions.spec` §3.4~§3.5를 인용만 한다. 이 문서는 발화 위치와 페이로드 필드 제안만 둔다.

| 지점 | kind | fold | 발화 위치 | pi-ai 연결점 | 비고 |
|---|---|---|---|---|---|
| `request.provider.before` | request | chain | §4.3 5번 | `onPayload` | M1 지점. 페이로드 `{ payload }`(F §3.5). 패치는 교체 |
| `request.headers.before` | request | chain | §4.3 6번 | `transformHeaders` | 헤더 패치(null은 삭제) |
| `request.provider.after` | request | tap | §4.3 8번 | `onResponse` | |
| `request.stream` | request | tap | §4.3 9번 | `onProviderStreamEvent` | 지원하는 어댑터만 |
| `request.model.after` | request | tap | 단계 시작에 바인딩이 바뀔 때(§4.2 6번), 폴백 전환 | 없음 | |
| `request.thinking.after` | request | tap(detached) | 레벨만 바뀔 때 | 없음 | `dispatch: detached` |

- 발화 구현 [구현: M2, m2/l1c]:
  - `request.model.after`와 `request.thinking.after`는 요청을 보내기 직전에 같은 thread·역할·scope의 직전 호출 바인딩과 비교해 발화한다. 요청을 보내지 못한 호출(provider 없음, 가드)은 비교도 발화도 하지 않는다. 직전 호출이 없으면(처음이거나 프로세스를 다시 띄운 뒤) `previous: null`인 `request.model.after`를 한 번 낸다. provider·모델이 다르면 `request.model.after`만, 레벨만 다르면 `request.thinking.after`만 낸다. `source`는 체크포인트로 다시 묶은 해석 결과면 `restore`, 그 밖은 `route`다. `set`(사용자 `/model`)과 `fallback`은 이 서비스가 구분하지 못하므로 쓰지 않는다.
  - `request.headers.before`는 pi-ai `transformHeaders`에서 발화한다. 핸들러에는 소문자 이름으로 바꾼 사본을 주고, 이름에 `authorization`, `api-key`, `token`, `secret`, `cookie`가 들어 있거나 비밀 참조에서 푼 헤더의 값은 `"[secret]"`로 가린다. 핸들러가 낸 최종 헤더 중 가린 헤더는 어떤 패치도 받지 않고 원래 값을 쓴다(바꾸거나 지우려 하면 로그 `model.auth_header_patch_ignored`에 이름만 남긴다). 새 인증 헤더를 만드는 패치도 같다. 가리지 않은 헤더는 패치대로 바뀌고, 최종 값에 없는 이름은 삭제된다.
  - `request.provider.after`의 헤더에서는 `authorization`, `api-key`, `cookie`가 든 이름을 뺀다.
  - `request.stream`는 어댑터가 원시 이벤트를 넘길 때마다 발화한다. 디스패치 키는 호출 키에 이벤트 순번을 붙인다.
  - 한 호출의 키는 `<stepId|turnId|threadId>:<지점>:<순번>`이고 순번은 호출마다 하나다. 같은 호출의 재시도는 같은 키를 쓴다.

### 7.2 페이로드 필드 제안 (F 요청)

M1 밖 지점은 `F.extensions.spec` §3.3의 형태 규칙(pi 필드 이름 유지, pi 고유 타입은 F 타입으로)으로 아래를 제안한다.

```ts
export interface BeforeProviderHeadersPayload {
  readonly provider: string; readonly modelId: string; readonly role: ModelRole;
  /** 인증 헤더 값은 "[secret]"로 가린다 */
  readonly headers: Readonly<Record<string, string | null>>;
}
export interface HeadersPatch { readonly set: Readonly<Record<string, string | null>> }
export interface AfterProviderResponsePayload {
  readonly provider: string; readonly modelId: string; readonly role: ModelRole;
  readonly status: number; readonly headers: Readonly<Record<string, string>>;   // 인증·쿠키 헤더 제외
}
export interface ProviderStreamPayload { readonly provider: string; readonly api: string; readonly model: string; readonly data: unknown }
export interface ModelSelectPayload {
  readonly binding: ModelBinding;
  readonly previous: ModelBinding | null;
  readonly source: "set" | "route" | "restore" | "fallback";
}
export interface ThinkingLevelSelectPayload {
  readonly role: ModelRole;
  readonly level: ModelThinkingLevel;
  readonly previousLevel: ModelThinkingLevel | null;
}
```

- `BeforeProviderRequestPayload`(F §3.5, `{ payload: unknown }`)에 `provider`, `modelId`, `role`을 더하도록 요청한다. 핸들러가 provider별로 다른 패치를 내려면 필요하다.
- pi `request.model.after`의 `model: Model<any>`는 F 타입 규칙에 따라 `ModelBinding`으로 바꿨다. `source`의 pi 값 `cycle`은 Xeon에 대응 기능이 없어 뺐다.
- 재생 계약: 모든 핸들러는 다시 실행해도 되는 질의다(`F.extensions.spec` §4.3). `request.provider.before`는 pi-ai 재시도 때 같은 요청에 다시 불릴 수 있다(§4.3).

### 7.3 휘발 이벤트 접두

- `model.` 접두는 `model-gateway` 소유로 예약만 한다(`eng.context-map.design` §5.1). 이 문서는 kind를 정의하지 않는다. 사용량 게이지 실시간 표시가 필요해지면 휘발 kind `model.usage`를 F 형식으로 제안한다 [제안, 2차].

### 7.4 drive와의 관계

- drive 임대의 토큰 상한은 `UsageMeter.totals({ threadId, scopeId })`로 판정한다 [가정: X.primitives.spec이 이 값을 읽는다].
- drive 함수가 `loop.spawn`으로 서브에이전트를 열 때 그룹 덮어쓰기가 적용되도록 core-agents가 `RoleOverrides.scopeId`를 넘긴다(`L1.agents.spec`).

## 8. 다른 문서와의 인터페이스

### 8.1 제공

| 이름 | 쓰는 문서 |
|---|---|
| `xeon.models`(`ModelService`), `ResolvedModel`, `ModelCallRequest`, `streamFn` | `L1.loop.spec`, `L1.agents.spec`, `L1.context.spec`, `L2.web.spec` |
| `ModelRole`, `MODEL_ROLES`, `ROLE_FALLBACK`, `ModelBinding`, `ModelRefString`, `parseModelRef` | `L1.loop.spec`, `L1.agents.spec`, `L4.settings-ui.spec`, `eng.testing.guide`(테이프 `role`) |
| `CachePolicy`, `CacheMarks`, `CacheSite` | `L1.context.spec` |
| `TokenEstimator`, `classify`, `ModelErrorKind` | `L1.context.spec`(임계, 오버플로우), `L1.loop.spec` |
| `UsageMeter`, `UsageRecord`, `UsageTotals` | `L1.loop.spec`(턴 사용량), `X.primitives.spec`(drive 상한), `L4.host-service.spec`(게이지, 2차) |
| `ProviderDef` | `X.primitives.spec` §3.9 `ProviderResourceDef` |
| 테이프 가짜 `@xeon/core-models/testing` | 모든 L1·L2 테스트(`eng.testing.guide` TS-04) |

### 8.2 요구

| 이름 | 출처 |
|---|---|
| `Message`, `AssistantMessage`, `Usage`, `StopReason`, `ModelThinkingLevel` | `F.conversation.spec` §3.1 |
| `StepCheckpoint.model` | `F.records.spec` §3.6 |
| 지점 선언(`POINTS`), 페이로드 타입, `ScopeId` | `F.extensions.spec` |
| `SettingDef`, `defineSettings`, `SecretRef`, `resolveSetting` | `F.wire-settings.spec` §3.8~§3.9 |
| `xeon.secrets`(`SecretService`): 참조 해석, 마스킹 | `L0.secrets.spec` [가정: 메서드 이름] |
| `xeon.ext`: 지점 디스패치 | `X.primitives.spec` |
| `xeon.store.scoped("core_models_")`(2차) | `L0.store.spec` |
| 유효 설정 읽기 경로 | [가정] X 또는 `L1.persistence.spec`의 `SettingsStorePort`. 서비스 이름 미정 |

### 8.3 F·X·엔지니어링 요청 사항

1. (반영됨) `F.capabilities.spec`: §3.2의 값 타입(역할, 참조, 바인딩, `resolveRole`, `CachePolicy`)과 §3.3 `ModelService`, 서비스 이름 상수를 `@xeon/contracts/services`의 `services/models.ts`에 둔다(review.decisions-2 D-04, F.capabilities §3.12 규칙 3). pi-ai `Model`, `Api`, `Context`, `Provider`, `CacheRetention`, `ThinkingBudgets`, `AssistantMessageEventStream`, `SimpleStreamOptions`를 타입 전용으로 재노출한다. `StreamFn`은 F가 소비 계약으로 정의한다(adr.0009 §3.2). `F.conversation.spec` §3.1은 `Context`를 "L1-c 몫"으로 남겼으나, 서비스 인터페이스가 F에 있으므로 타입 재노출은 F에 있어야 한다.
2. `F.extensions.spec`: §7.2 페이로드 필드. `BeforeProviderRequestPayload`에 `provider`, `modelId`, `role` 추가.
3. (철회) `X.primitives.spec` `ProviderResourceDef`를 `ProviderDef`로 바꾸는 요청은 거둔다. 포트 경로는 JSON `kind: "config"`만 받고, `kind: "runtime"`은 `addProvider`로 받는다(§3.7).
4. `eng.context-map.design` §4.1: `model-gateway`의 (d) 쓰는 서비스에 `xeon.ext`(지점 디스패치)를 더한다.
5. `eng.dependency-rules.guide`: DR-07, DR-09 수정(§3.11, review.decisions-2 U-16).

## 9. 수용 기준

1. 같은 `RoutingTable`, `RoleOverrides`, 카탈로그로 `resolveRole`을 두 번 부르면 같은 `binding`과 `source`가 나온다. 입력 객체의 키 순서를 바꿔도 같다.
2. `judge` 역할에 값이 없고 `review`에 값이 있으면 `review` 값으로 해석되고 출처는 `role-fallback`이다. 둘 다 없으면 `default`다.
3. `overrides.scopeId = "helm"`이고 `groupRouting.helm.review`가 있으면 그 값이 `routing.review`보다 먼저 쓰인다. `overrides.ref`는 그룹 덮어쓰기보다 먼저 쓰인다.
4. `parseModelRef("bedrock/anthropic.claude-x-v1:0")`의 modelId는 `anthropic.claude-x-v1:0`이고 레벨은 null이다. `parseModelRef("anthropic/claude-x:high")`의 레벨은 `high`다.
5. 테이프가 `error`(`reason: "aborted"`, `afterContent` 있음)를 낸 호출의 사용량이 `UsageMeter.totals`에 더해지고 `abortedCalls`가 1 늘어난다.
6. 요청 로그, 지점 페이로드(`request.headers.before`, `request.provider.after`), 이벤트 DB, 오류 메시지 어디에도 `secret://`를 해석한 값이 나타나지 않는다. 테스트는 알려진 가짜 키 문자열을 모든 출력에서 찾는다.
7. 단계 시작 바인딩의 `{ provider, modelId, thinkingLevel }`이 같은 단계 `checkpoint.step`의 `model`과 같다. 재개 뒤 첫 요청은 그 사이 `l1.models.default`를 바꿔도 체크포인트 값을 쓴다.
8. 기본 `anthropic` provider에 `sk-ant-oat`로 시작하는 가짜 키를 주면 요청이 나가지 않고 `oauth_token_on_default_provider`가 된다.
9. `plugins/provider-anthropic-oauth` 디렉터리를 지운 작업 트리에서 core-models 테스트가 모두 통과한다.
10. 배포 제외 검사(§4.11.4 1~3)에서 `@xeon/provider-anthropic-oauth`와 그 경로가 나오지 않는다.
11. 같은 이름으로 `addProvider`를 두 번 부르면 두 번째가 `provider_conflict`다. 반환된 `Unsubscribe`를 부르면 그 provider의 모델이 `list()`에서 빠진다.
12. 위장 플러그인을 `defaultEnabled: false` 그대로 두면 provider 목록에 `anthropic-oauth`가 없다.
13. `ModelService`는 `ModelsPort`에 대입 가능하다(타입 테스트). `registerProvider(owner, name, { kind: "config", baseUrl })`는 `addProvider`와 같은 등록부에 들어가고, 스키마를 통과하지 않는 `config`는 `invalid_provider` `ModelError`를 던진다.

## 10. 미결 사항

1. (닫음) 기본 `anthropic-messages` 경로의 `sk-ant-oat` 자동 분기는 core-models 가드(§3.9)로 막는다(m2/l1c). pi-ai 포크는 하지 않는다.
2. [미결 M-2] 방안 A의 갈래: A1(새 Api id)과 A2(Api id 유지, provider id 분리). 제안은 A2.
3. [미결] 위장 플러그인의 별도 배포 여부(`product.scope.spec` N6)와 서버 수용·이용 조건 확인 시점.
4. [결정: review.decisions-2 U-16] `plugins/*`는 L1 순위다. 플러그인은 F, X, L0, pi-ai만 import하고 `core-*`는 import하지 않는다. 위장 provider는 F provider 인터페이스로 `xeon.models`에 등록한다(§3.11). DR-07·DR-09를 고친다.
5. [미결] 그룹 정의 역할(6종 밖)을 허용할지(§3.4).
6. [미결] `StepCheckpoint.model`에 `role`을 넣을지(§3.2).
7. [미결] `l1.models.thinkingLevel` 기본값과 `cacheRetention` 기본값(§4.6).
8. [미결] 구독 계정 회전(M3, review.decisions-2 U-21)의 약관 검토와 별도 설계 문서(§4.8).
9. [미결] pi `registerVirtualModel` 지원 여부(§3.7).
10. [결정: review.decisions-2 U-24] TypeBox 버전은 catalog 1.3.27이고 pi-ai가 고정한 판과 같다. core-models가 pi-ai `Tool.parameters`를 그대로 넘겨도 스키마 객체가 한 판이다.
11. [미결] L1 서비스가 유효 설정을 읽는 경로와 서비스 이름(§8.2 마지막 행).
12. [미결] 일반 턴 요청의 hosted 서버 도구(`L2.web.spec` §4.8.1 A안, ADR-0005 ①). M2 마감 재검토 4에서 조사했고 구현하지 않았다. 페이로드에 서버 도구를 더하는 것은 `request.provider.before` 패치로 가능하다. 모자란 것은 응답 쪽이다. pi-ai 1.3.0의 `AssistantMessage.content`(`types.d.ts:364`)와 anthropic-messages 어댑터는 `server_tool_use`, `web_search_tool_result` 블록을 싣지도 이력으로 되돌리지도 않는다. 그래서 (a) `encrypted_content` 보관과 반송, (b) `pause_turn`(어댑터가 `stopReason: "stop"`으로 바꿔 턴이 잘린다) 이어 요청, (c) 인용을 `normalizeHostedSearch`와 L4로 보내는 경로가 없다. pi-ai 어댑터 패치나 F `AssistantMessage` 확장이 필요하고 `m3-plan`에서 정한다. 그 전까지 모델 검색은 `web_search` 함수 도구와 내장 래퍼로 처리된다(`L2.web.spec` §10 3번).
