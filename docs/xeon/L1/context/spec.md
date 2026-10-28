---
id: L1.context.spec
layer: L1
domain: context
kind: spec
status: draft
depends_on: [F.conversation.spec, F.records.spec, F.capabilities.spec, F.extensions.spec, L1.models.spec, L1.persistence.spec, eng.events.design, eng.context-map.design]
binds: [xeon/packages/core-context/**]
---

# L1 컨텍스트와 컴팩션 (context)

계획 v2의 하위 층 L1-e(컨텍스트와 컴팩션)를 구현하는 `xeon/packages/core-context`의 스펙이다. 컨텍스트는 `run-engine`이다(`eng.context-map.design` §4.1, §4.5).

## 1. 목적과 범위

### 1.1 정하는 것

- Cordis 서비스 `xeon.context`의 인터페이스 `ContextService`: `assemble`, `compact`, `shouldCompact`, `estimate`, `recoverOverflow`, `summarizeBranch`.
- 컨텍스트 조립: 고정 접두(시스템 프롬프트, 도구 목록, 스킬 인덱스, 메모리)와 말미의 변동 정보. stable·context·volatile 3계층.
- 도구 목록 변경을 접두 밖에서 알리는 규칙(`SystemMessage.toolsAdded`·`toolsRemoved`)과 재광고 기준.
- 캐시 표식 위치 계산(`CacheMarks`). 정책 객체 `CachePolicy`는 `L1.models.spec` §3.6이 만든다.
- 롤링 요약 컴팩션(pi 컴팩션 포크), 임계와 예약 여유, 비파괴 컴팩션 엔트리, 오버플로우 복구.
- 발화 지점 6개: `context`, `request.system.before`, `request.cache.before`, `session.compact.before`, `session.compact.after`, `session.compact.failed`.
- 이벤트 소유 제안: `thread.compacted`, `thread.branch_summarized`.
- 설정 키 `l1.context.*`.
- 2차: 도구 결과 선제 제거, 컴팩션 후 재주입, 추가 워크스페이스 루트, 캐시 워밍.

### 1.2 다루지 않는 것

| 대상 | 정하는 문서 |
|---|---|
| `thread.compacted` payload 모양, 분기 규칙 | `F.records.spec` §3.3, §4.6 |
| `ItemRecord`, 메시지 타입 | `F.conversation.spec` §3.5.2, §3.1 |
| 도구 정렬 `orderTools`, `diffToolsets`, `toolsetFingerprint` | `F.capabilities.spec` §3.8, §4.5 |
| 모델 해석, 캐시 정책 객체, 토큰 추정과 오버플로우 감지의 구현 | `L1.models.spec` |
| 단계 흐름, 요청 재시도 시점, `input.agent.before` 발화 | `L1.loop.spec` |
| 이벤트 커밋, leaf 이동, 투영 | `L1.persistence.spec` |
| 도구 노출 정책(deny 도구 제거, tool search) | `L1.tools.spec` |
| 스킬·메모리 저장 | `L2.knowledge.spec` |

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 조립(assemble) | 가지 하나의 이벤트에서 모델 요청 컨텍스트(`Context.messages`)를 만드는 것 |
| 고정 접두 | 대화 첫머리의 시스템 메시지 하나. 기본 프롬프트, 이름 붙은 절(sections), 정렬된 도구 전체 목록을 담는다. 세션 중 바꾸지 않고 컴팩션 때만 다시 만든다 |
| stable 계층 | 기본 시스템 프롬프트와 도구 목록. 접두의 `content`와 `toolsAdded` |
| context 계층 | 프로젝트 지침, 스킬 인덱스, 메모리. 접두의 `sections` |
| volatile 계층 | 날짜, 작업 디렉터리 상태처럼 단계마다 바뀌는 정보. 대화 말미에 붙인다 |
| 도구 변경 메시지 | 접두 뒤에 덧붙이는 `SystemMessage{ toolsAdded, toolsRemoved }` |
| 재광고 | 도구 목록 전체를 접두에 다시 쓰는 것. 접두 캐시가 깨진다 |
| 컴팩션 머리 | 가지 위의 마지막 `thread.compacted`. 조립 때 `firstKeptEventId` 앞 내용을 요약으로 바꾼다 |
| 컷 포인트 | 원문을 남기기 시작하는 항목. `firstKeptEventId`가 된다 |
| 분할 턴 | 컷 포인트가 턴 중간에 놓인 경우. 턴 앞부분을 따로 요약한다 |

## 3. 인터페이스

### 3.1 서비스 (F 요청 사항)

서비스 인터페이스 `ContextService`와 서비스 이름 상수는 F `@xeon/contracts/services` 서브패스에 둔다 [결정: review.decisions-2 D-04]. `CachePolicy`, `CacheMarks`, `ModelBinding`, `ContextUsageEstimate`는 `L1.models.spec` §3.2~§3.6이 F capabilities에 두도록 요청한 이름이고, services 서브패스가 그 이름을 import한다. `eng.context-map.design` §5.3의 위치 표기(conversation)를 services로 고치도록 요청한다.

```ts
// xeon/packages/contracts/src/services/context.ts (F 요청, review.decisions-2 D-04)
import type { Result } from "../base/index.ts";
import type { EventId, ThreadId, StepId, TurnId } from "../conversation/ids.ts";
import type { Message, AgentMessage, AssistantMessage, SystemMessage, Usage, JsonValue } from "../conversation/pi.ts";
import type { OrderedTool, ToolsetFingerprint } from "./ordering.ts";
import type { CachePolicy, CacheMarks, ModelBinding, ContextUsageEstimate } from "./models.ts";

export const ContextServiceName: "xeon.context" = "xeon.context";

export interface ContextService {
  /** leaf까지의 가지로 모델 요청 컨텍스트를 만든다. 같은 이벤트·도구·절이면 같은 바이트를 낸다 */
  assemble(threadId: ThreadId, leaf: EventId, opts: AssembleOptions): Promise<Result<AssembledContext, ContextError>>;
  /** 컴팩션 한 번. thread.compacted를 커밋하거나, 거부·실패를 돌려준다 */
  compact(threadId: ThreadId, request: CompactRequest): Promise<Result<CompactOutcome, ContextError>>;
  /** 임계 검사. 모델 호출 없이 계산한다 */
  shouldCompact(threadId: ThreadId, leaf: EventId, binding: ModelBinding): Promise<CompactCheck>;
  /** 메시지 배열의 토큰 추정. xeon.models TokenEstimator에 위임한다 */
  estimate(messages: readonly Message[]): ContextUsageEstimate;
  /** core-loop가 스트림을 열 때 부르는 변환(adr.0009). §4.1 3번 규칙과 같다. 던지지 않는다 */
  convertToLlm(messages: readonly AgentMessage[]): Message[];
  /** 오버플로우 종결 메시지를 받아 단계당 한 번 컴팩션한다(§4.7) */
  recoverOverflow(threadId: ThreadId, stepId: StepId, failed: AssistantMessage, binding: ModelBinding): Promise<OverflowRecovery>;
  /** 떠난 가지 요약 초안을 만든다. 커밋은 하지 않는다(§4.9) */
  summarizeBranch(threadId: ThreadId, from: EventId, to: EventId, opts?: { readonly instructions?: string; readonly signal?: AbortSignal }):
    Promise<Result<BranchSummaryDraft, ContextError>>;
}

export interface AssembleOptions {
  /** 이번 단계 바인딩(체크포인트 고정값). 모델 전환 경고와 창 크기에 쓴다 */
  readonly binding: ModelBinding;
  readonly contextWindow: number;
  /** xeon.models가 해석 때 낸 정책 */
  readonly cachePolicy: CachePolicy;
  /** 이번 단계 도구 집합. core-tools가 orderTools로 정렬해 넘긴다 */
  readonly tools: readonly OrderedTool[];
  /** 기본 시스템 프롬프트 */
  readonly basePrompt: string;
  /** context 계층 절. before_agent_start 결과(L1.loop.spec). 키는 절 이름 */
  readonly sections: Readonly<Record<string, string>>;
  /** volatile 계층. 단계마다 바뀐다 */
  readonly volatile: Readonly<Record<string, string>>;
  readonly turnId: TurnId;
  readonly stepId: StepId;
  readonly signal?: AbortSignal;
}

export interface AssembledContext {
  /** pi-ai Context.messages로 그대로 넘긴다. [0]은 고정 접두 SystemMessage */
  readonly messages: readonly Message[];
  readonly prefix: PrefixInfo;
  /** 이번 조립에서 접두 뒤에 새로 둔 도구 변경. 없으면 null */
  readonly toolChange: ToolChangeDecision | null;
  readonly cacheMarks: CacheMarks;
  readonly estimate: ContextUsageEstimate;
  readonly compactionHead: { readonly eventId: EventId; readonly firstKeptEventId: EventId } | null;
  /** 이번 조립에서 새로 커밋해야 할 system item 초안(접두 고정, 도구 변경, 절 갱신). loop가 단계 커밋에 넣는다 */
  readonly pendingItems: readonly PendingSystemItem[];
  readonly warnings: readonly ContextWarning[];
}

export interface PrefixInfo {
  /** 접두 SystemMessage를 정규화 JSON으로 만든 sha256 hex */
  readonly prefixHash: string;
  readonly toolset: ToolsetFingerprint;
  /** 접두를 담은 system item의 이벤트. 아직 커밋 전이면 null */
  readonly recordedAt: EventId | null;
}

export type ToolChangeDecision =
  | { readonly action: "append"; readonly added: number; readonly removed: number }
  | { readonly action: "defer"; readonly firstChangedIndex: number }
  | { readonly action: "readvertise"; readonly reason: "first_request" | "compaction" | "explicit"; readonly firstChangedIndex: number | null };

export interface PendingSystemItem {
  readonly purpose: "prefix" | "tool_change" | "sections";
  readonly message: SystemMessage;   // F 재노출 pi-ai SystemMessage
}

export type ContextWarning =
  | { readonly code: "cache_reset_model_switch"; readonly from: ModelBinding; readonly to: ModelBinding }
  | { readonly code: "cache_prefix_reset"; readonly at: number | null }
  | { readonly code: "tools_deferred"; readonly added: readonly string[]; readonly removed: readonly string[] }
  | { readonly code: "near_window"; readonly tokens: number; readonly contextWindow: number };

export type CompactReason = "manual" | "threshold" | "overflow";
export interface CompactRequest {
  readonly reason: CompactReason;
  readonly binding: ModelBinding;
  readonly contextWindow: number;
  /** 사용자가 /compact 뒤에 적은 지침 */
  readonly instructions?: string;
  /** overflow 복구일 때 실패한 단계 */
  readonly stepId?: StepId;
  readonly willRetry: boolean;
  readonly signal?: AbortSignal;
}
export type CompactOutcome =
  | { readonly status: "compacted"; readonly eventId: EventId; readonly tokensBefore: number; readonly fromExtension: string | null }
  | { readonly status: "skipped"; readonly why: "nothing_to_summarize" | "last_entry_is_compaction" | "disabled" }
  | { readonly status: "cancelled"; readonly by: string; readonly reason: string };

export interface CompactCheck {
  readonly should: boolean;
  readonly tokens: number;
  readonly threshold: number;        // contextWindow - reserveTokens
}

export type OverflowRecovery =
  | { readonly action: "retry"; readonly compactedEventId: EventId }
  | { readonly action: "fail"; readonly reason: "second_overflow" | "compaction_failed" | "compaction_cancelled" | "disabled" };

/** fromEventId를 뺀 세 필드가 L1.persistence.spec §3.8 BranchSummaryInput과 같다 */
export interface BranchSummaryDraft {
  readonly fromEventId: EventId;
  readonly summary: string;
  readonly details: JsonValue | null;
  readonly usage: Usage | null;
}

export type ContextErrorKind =
  | "branch_not_found" | "read_failed" | "projection_failed" | "summary_failed" | "summary_has_tool_call"
  | "summary_truncated" | "commit_failed" | "aborted";
export interface ContextError { readonly kind: ContextErrorKind; readonly message: string }
```

- F 이름 `SystemMessage`는 `F.conversation.spec` §3.1의 재노출이다.
- `assemble`은 커밋하지 않는다. 새 system item은 `pendingItems`로 돌려주고 core-loop가 단계 커밋에 넣는다. 그래서 조립 결과와 커밋이 한 트랜잭션에 묶인다 [제안].
- `compact`는 `xeon.session`으로 직접 커밋한다. 단계 사이에서만 부르므로 단계 커밋과 겹치지 않는다(§4.6 6번).

### 3.2 내부 타입 (core-context 내부)

컴팩션 포크가 session-manager 타입 대신 쓰는 타입이다(`_research/notes/L1-3.md` §5.2).

```ts
// xeon/packages/core-context/src/compaction/cut-point.ts
export interface CutCandidate {
  readonly eventId: EventId;               // 이 항목부터 남기면 firstKeptEventId
  readonly kind: "user" | "assistant" | "custom" | "toolResult" | "system";
  readonly turnId: TurnId | null;
  readonly messages: readonly Message[];
  readonly usage: Usage | null;            // assistant만
}
export interface ThreadCompactionView {
  readonly head: { readonly eventId: EventId; readonly summary: string; readonly firstKeptEventId: EventId } | null;
  readonly candidates: readonly CutCandidate[];   // head 뒤 항목만
}
export interface CutPointResult {
  readonly firstKeptIndex: number;
  readonly turnStartIndex: number;         // 분할 턴이 아니면 -1
  readonly isSplitTurn: boolean;
}
export function findCutPoint(candidates: readonly CutCandidate[], keepRecentTokens: number, estimate: (m: Message) => number): CutPointResult;

// compaction/threshold.ts  (pi compaction.ts:116-142, 264-270 이식)
export interface CompactionSettings { readonly enabled: boolean; readonly reserveTokens: number; readonly keepRecentTokens: number }
export function shouldCompactTokens(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean;

// compaction/summarize.ts
export interface SummarizeDeps {
  summarize(req: {
    readonly system: string;
    readonly prompt: string;
    readonly maxTokens: number;
    readonly signal?: AbortSignal;
  }): Promise<{ readonly text: string; readonly usage: Usage; readonly stopReason: string; readonly hasToolCall: boolean }>;
}
export interface CompactionPreparation {
  readonly firstKeptEventId: EventId;
  readonly messagesToSummarize: readonly Message[];
  readonly turnPrefixMessages: readonly Message[];
  readonly isSplitTurn: boolean;
  readonly tokensBefore: number;
  readonly previousSummary: string | null;
  readonly fileOps: { readonly read: readonly string[]; readonly modified: readonly string[] };
}
export function prepareCompaction(view: ThreadCompactionView, settings: CompactionSettings, estimate: (m: Message) => number): CompactionPreparation | undefined;
export function runCompaction(prep: CompactionPreparation, deps: SummarizeDeps, opts: { readonly reserveTokens: number; readonly instructions?: string; readonly signal?: AbortSignal }):
  Promise<Result<{ readonly summary: string; readonly usage: Usage; readonly details: JsonValue }, ContextError>>;
```

- `SummarizeDeps.summarize`는 `xeon.models.complete`를 `summary` 역할, `cacheRetention: "none"`으로 부르는 얇은 어댑터다(`L1.models.spec` §3.4).

## 4. 동작 규칙

### 4.1 조립 순서

`assemble`이 만드는 `messages` 순서 [제안]:

| 위치 | 내용 | 계층 | 원천 |
|---|---|---|---|
| 0 | 고정 접두 `SystemMessage{ content: basePrompt, sections, toolsAdded: 정렬 전체 }` | stable + context | 가지 위 마지막 `purpose: prefix` system item. 없으면 이번 조립에서 만든다 |
| 1 | 컴팩션 요약 메시지(머리가 있을 때) | — | `thread.compacted.summary` |
| 2 | 남긴 원문 항목(`firstKeptEventId`부터 leaf까지)과 그 사이의 도구 변경·절 갱신 system item | — | `item.recorded` |
| 끝 | volatile 정보 | volatile | `AssembleOptions.volatile` |

1. 가지 읽기: `xeon.session`으로 leaf에서 루트까지 거슬러 읽는다(`F.records.spec` §4.6 1). 마지막 `thread.compacted`가 머리다.
2. 머리가 있으면 `firstKeptEventId` 앞의 `item.recorded`는 넣지 않는다(비파괴, `F.records.spec` §4.6 4). 요약은 `UserMessage`로 넣는다. 본문 형식은 pi `compactionSummary` 역할의 사용자 메시지 변환(`coding-agent/src/core/messages.ts`)을 따른다.
3. 메시지 변환: `ItemRecord`를 `Message`로 바꾼다. `kind: "custom"`은 `display`와 상관없이 `content`를 `UserMessage`로 바꾸고 `details`는 넣지 않는다(`F.conversation.spec` §3.5.2). `thread.branch_summarized`는 그 위치에 요약 `UserMessage`로 넣는다.
4. `context` 지점(chain)을 시스템 메시지를 뺀 배열로 발화한다. 결과 배열 뒤에 시스템 메시지를 원래 위치로 되돌린다. pi `ContextEvent` 주석과 같다.
5. `request.system.before` 지점(chain)을 전체 배열로 발화한다. 결과가 최종 `messages`다.
6. 캐시 표식 위치를 계산한다(§4.5).
7. 토큰 추정을 계산한다(`xeon.models.tokens.estimateContext`).

- volatile 정보 위치 [구현: M2, 표의 "끝"을 따른다]: 캐시 표식을 계산한 뒤 `messages` 맨 끝에 한 메시지로 붙인다. `cachePolicy.midConversationSystem`이 참이면 `SystemMessage`, 거짓이면 `UserMessage`이고 본문은 이름순 `<이름>\n값\n</이름>` 덩어리다. 어느 쪽이든 커밋하지 않는 조립 전용 메시지이고 `tail` 표식 뒤에 놓인다. 재개 뒤 다시 만들어도 값이 같도록 volatile 원천은 단계 시작 시각과 체크포인트 값에서만 계산한다 [제안]. 앞 문단의 "마지막 사용자 메시지 앞"은 이 위치로 고쳤다. 앞에 두면 단계마다 바뀌는 값이 이전 `tail` 표식 앞으로 들어가 캐시가 매 단계 깨진다.
- 접두 뒤 변경 처리 [구현: M2]: 도구 변경·절 갱신은 접두 뒤 system item을 모두 적용한 "현재 광고 상태"(`replaySystemMessages`)와 이번 `AssembleOptions`를 비교한다. 새 변경 item은 `pendingItems`로 내면서 같은 메시지를 이번 `messages` 끝(volatile 앞)에도 붙이므로, 단계 커밋 뒤 다시 조립해도 같은 순서가 된다. 변경이 없으면 아무것도 내지 않는다.
- context 계층 절의 변경: 접두 고정 뒤 `sections` 값이 바뀌면 `midConversationSystem`이 참일 때만 `purpose: "sections"` system item으로 바뀐 절만 덧붙인다. 거짓이면 다음 컴팩션까지 미룬다.

### 4.2 접두 고정

- 고정 접두는 thread에서 처음 조립할 때 만들고 `pendingItems`(`purpose: "prefix"`)로 돌려준다. core-loop가 첫 단계 커밋에 `item.recorded`(kind `system`)로 넣는다.
- 이후 조립은 접두를 다시 만들지 않고 기록된 system item을 그대로 쓴다. 재개 뒤에도 같은 바이트다.
- 접두의 `basePrompt`는 루프가 정한 기본 프롬프트이고, `input.agent.before`가 시스템 프롬프트에 더한 부분은 접두에 넣지 않는다. 루프가 단계마다 `volatile`의 `instructions` 항목으로 넘긴다(`L1.loop.spec` §4.2 규칙 1). 접두를 만들 때의 `sections`는 접두 system item 또는 `purpose: "sections"` item에 남아 재개 뒤에도 같은 접두를 얻는다.
- 호출 순서: core-loop는 요청마다 요청 준비 단계(`loop/prepare-request.ts`)에서 `assemble`을 부르고, 스트림을 열 때 결과 `messages`를 `convertToLlm`으로 바꿔 streamFn에 넘긴다(`L1.loop.spec` §3.2 표).
- 접두는 컴팩션 때만 다시 만든다. `compact`가 `thread.compacted`와 같은 커밋에 새 접두 system item을 넣는다(§4.6 5번). pi `CompactionEntry.systemMessage`("compaction 경계의 프롬프트와 도구 상태")에 해당하는 값을 F 필드 추가 없이 별도 item으로 남기는 방식이다 [제안](`_research/notes/L1-3.md` §12 미결 (c)).
- 근거: 접두 3계층(her, cc), 세션당 한 번 조립하고 컴팩션 때만 다시 만든다(`_research/item-catalog.md` L1-e 프롬프트 계층 행).

### 4.3 도구 변경과 재광고 기준

`F.capabilities.spec` §4.5와 pi-ai `SystemMessage.toolsAdded`·`toolsRemoved`(`types.ts:536-557`)를 쓴다. Anthropic 경로는 이 메시지를 `tool_addition`·`tool_removal` 블록으로 바꾸고 같은 이름 재정의는 제거 없이 추가만 보낸다(`anthropic-messages.ts:1325-1352`).

1. 접두를 아직 만들지 않았으면 정렬 전체 목록을 접두에 둔다. 결정 `readvertise(first_request)`.
2. 접두 뒤에는 `diffToolsets(직전 광고 목록, 이번 목록)`을 계산한다. 직전 광고 목록은 접두 `toolsAdded`에 그 뒤 도구 변경 item을 차례로 적용한 결과다.
3. `added`, `removed`가 모두 비면 아무것도 하지 않는다.
4. `cachePolicy.midConversationToolChanges`가 참이면 `SystemMessage{ toolsAdded: added, toolsRemoved: removed }`를 `pendingItems`(`purpose: "tool_change"`)로 낸다. 결정 `append`. 접두는 바뀌지 않는다.
5. 거짓이면 변경을 미룬다. 결정 `defer`. 광고 목록은 그대로이고, 사라진 도구의 호출은 core-tools 디스패치가 거부한다(`L1.tools.spec`, 광고 고정·허용은 디스패치). 경고 `tools_deferred`.
6. 재광고는 세 경우에만 한다: 첫 요청(1번), 컴팩션(§4.6 5번), 사용자의 명시 명령(`/tools reload` 같은 L4 명령, 결정 `readvertise(explicit)`).
7. `firstChangedIndex`의 쓰임: 재광고할 때 접두 캐시가 깨지는 위치다. `null`이면 정렬 목록이 같아 재광고하지 않는다. 미룬 변경(`defer`)에도 값을 기록해 두고, 재광고 때 경고 `cache_prefix_reset{ at }`에 싣는다. 컴팩션 재구성은 어차피 접두를 새로 만들므로 이 값을 비용 판단에 쓰지 않는다.

### 4.4 모델 전환 경고

- 이전 단계 바인딩(가지 위 마지막 `checkpoint.step.model`)과 이번 바인딩의 provider 또는 modelId가 다르면 경고 `cache_reset_model_switch`를 낸다. core-loop가 휘발 알림으로 클라이언트에 전달한다 [제안].
- 레벨만 다를 때는 경고하지 않는다. provider별로 레벨 변경이 캐시에 주는 영향이 다르고(`supportsMidConvoEffort`), `request.thinking.after` 지점이 따로 있기 때문이다.

### 4.5 캐시 표식

- 표식 위치는 `CachePolicy.sites` 순서로 고른다(`L1.models.spec` §3.6). 기본은 `system`, `tools`, `summary`, `tail`이고 상한은 `maxBreakpoints`(Anthropic 4, oc 최대 4개)다.
- `summary`: 컴팩션 요약 메시지의 인덱스. 머리가 없으면 그 표식은 쓰지 않는다.
- `tail`: 마지막 사용자 메시지 또는 마지막 system 메시지의 인덱스. volatile 메시지는 tail 뒤에 오므로 표식 뒤에 놓인다.
- `system`, `tools`는 인덱스 없이 표시만 한다. 적용은 provider 어댑터가 한다.
- 상한을 넘으면 `sites`의 뒤쪽부터 버린다.

### 4.6 롤링 요약 컴팩션

[제안] 롤링 요약 컴팩션은 pi 컴팩션 포크다. 근거는 "패키지 사용·포크를 적극 채택"하는 방침(`_research/decisions-log.md` 2026-10-21 결정 2차)과 조사 판정이다(`_research/foundation-plan.md` §2 모델·루프 행의 "부족분만 포크" 원칙, `_research/packages.md` §4.3 L1-e 롤링 요약 행, `_research/layer-plan-v2.json` L1-e). 원본은 `~/projects/_ref/pi-src/packages/coding-agent/src/core/compaction/compaction.ts`(pi 커밋 `cdaf6c2`, 1119줄)다.

0. 구현 메모 [구현: M2]: 후보는 "머리 뒤"를 컴팩션 이벤트 뒤가 아니라 요약 뒤에 모델에 보이는 항목, 곧 이전 머리의 `firstKeptEventId`부터 leaf까지로 읽는다(이전 컴팩션 때 남긴 원문도 새 요약 대상이다). 후보에는 진행 중 item, system item, 컴팩션 이벤트를 넣지 않고 `thread.branch_summarized`는 `custom` 후보로 넣는다. 컷 뒤에 도구 호출이 컷 앞에 있는 결과가 남으면(사용자 끼어들기) 다음 후보로 옮기고, 더 없으면 그 호출 항목으로 당긴다. 턴 시작은 `user`·`custom`이거나, `turnId`가 앞 항목과 달라지는 `assistant`다. `turnId`가 null인 항목은 `user`·`custom`만 턴 시작으로 본다(§10 미결 6의 잠정 답).
1. 준비: 가지를 `ThreadCompactionView`로 바꾼다. 마지막 항목이 컴팩션이면 준비하지 않는다(`compaction.ts:876-878`). 이전 머리가 있으면 그 요약을 `previousSummary`로 넘기고 머리 뒤 항목만 후보로 둔다(`:891-895`).
2. 컷 포인트: 뒤에서부터 토큰을 누적하다가 `keepRecentTokens` 이상이면 멈춘다. 컷은 그 위치 이후 첫 후보이고, 없으면 마지막 후보다. 토큰 0 항목은 건너뛴다(`:458-479`). 후보는 `user`, `assistant`, `custom` 항목이고 `toolResult`, `system`은 후보가 아니다(`:351-364`, `_research/notes/L1-3.md` §5.4).
3. `session.compact.before`(first)를 발화한다. 결정이 `cancel`이면 멈추고 `cancelled`를 돌려준다. 결정이 `compaction`(확장 요약)이면 4번을 건너뛰고 그 요약을 쓴다(`fromExtension` = 확장 이름).
4. 요약: 이전 요약이 없으면 `SUMMARIZATION_PROMPT`, 있으면 `UPDATE_SUMMARIZATION_PROMPT`를 쓴다(`:507-579`, `:718`). 형식은 목표(Goal), 제약(Constraints & Preferences), 진행(Done·In Progress·Blocked), 결정(Key Decisions), 다음 단계(Next Steps), 핵심 맥락(Critical Context)이다. 시스템 프롬프트는 `utils.ts:161-163`의 `SUMMARIZATION_SYSTEM_PROMPT`다. 최대 토큰은 `min(floor(0.8 × reserveTokens), model.maxTokens)`(`:712-715`). 분할 턴이면 턴 앞부분을 `TURN_PREFIX_SUMMARIZATION_PROMPT`(`:942-955`)로 따로 요약하고 `floor(0.5 × reserveTokens)`를 쓴다. 두 요약은 `요약 + "---" + 턴 맥락`으로 합친다(`:1032`). 사용자 지침(`instructions`)과 설정 `l1.context.compactionInstructions`를 프롬프트 끝에 붙인다.
5. 커밋: `xeon.session`으로 한 커밋에 `thread.compacted{ summary, firstKeptEventId, tokensBefore, details, usage, fromExtension }`와 새 접두 system item(`item.recorded`, kind `system`, 정렬 전체 도구 목록)을 가지 끝에 덧붙인다. 원본 이벤트는 지우지 않는다. `details`에는 `{ xeon: { reason, stepId }, readFiles, modifiedFiles }`를 둔다 [제안]. `details`는 모델에 보내지 않는다(`F.records.spec` §3.3). 이 커밋은 별도 커밋 지점 C7이고 커밋 키는 `compact:<threadId>:<stepId>:<reason>`이다. 키의 `stepId`는 같은 커밋의 `details.xeon.stepId`이고 §4.7 3번 `second_overflow` 판정과 같은 값이다(`L1.persistence.spec` §4.2 C7). 단계 끝 커밋(C5)에 넣지 않는다.
6. 시점: 임계·수동 컴팩션은 단계 사이에서만 한다. 오버플로우 복구 컴팩션(§4.7)은 같은 단계의 재요청 전에 한다. 어느 경우든 C7 커밋 하나다. 임계 검사는 core-loop가 단계 시작 전에 `shouldCompact`로 한다. 수동 `/compact`가 단계 진행 중에 오면 다음 단계 경계까지 미룬다 [제안].
7. 성공하면 `session.compact.after`(tap)를, 실패하거나 중단되면 `session.compact.failed`(tap)를 발화한다.
7a. 요약 모델은 `xeon.models.resolve("summary")`의 결과(역할 `summary`, 캐시 없음)이고 요약 응답 상한은 `min(0.8 × reserveTokens, 모델 maxTokens, 16,000)`이다. 상한 16,000 토큰은 `thread.compacted.summary`의 65,536자 한도 안에 들게 하려는 값이고, 그래도 넘으면 `summary_truncated`다 [구현: M2]. 확장이 준 요약(`session.compact.before`의 `compaction`)이 같은 한도를 넘거나 `firstKeptEventId`가 가지 위에 없으면 `cancelled`로 돌려준다.
7b. 새 접두의 재료: 컴팩션은 `AssembleOptions`를 받지 않으므로 서비스가 스레드마다 가장 최근 `assemble`의 `basePrompt`, `sections`, `tools`를 기억해 쓴다(재광고). 기억이 없으면(프로세스를 다시 띄운 뒤 첫 컴팩션) 가지 위 기록된 광고 상태를 그대로 옮기고, 접두가 없으면 새 접두 item 없이 `thread.compacted`만 커밋한다. 다음 `assemble`이 접두를 만들어 `readvertise(compaction)`으로 낸다 [구현: M2].
7c. 컴팩션 커밋은 `core.context` 생산자 핸들과 `IdFactory`가 있어야 한다. 둘 중 하나가 없으면 `compact`는 `skipped(disabled)`, `recoverOverflow`는 `fail(disabled)`다. 커밋은 `expectedLeaf`를 요약한 leaf로 걸어 요약하는 동안 가지가 자랐으면 `commit_failed`로 끝낸다. 지문에는 요약 문장을 넣지 않는다(재시도가 같은 키로 처음 커밋을 돌려받는다) [구현: M2].
8. 응답 검사: `error`와 `length` 종결은 실패다(`:585-593`). 도구 호출이 든 응답도 실패다(`:759-761`). 빈 요약 대상이면 `skipped`다(`:914`).

포크 범위 [제안]. 줄 수는 `_research/notes/L1-3.md` §1, §3, §11의 셈이다.

| 묶음 | 원본 줄 수 | 처리 | 포크 뒤 바뀌는 점 |
|---|---|---|---|
| 그대로 옮김: 설정, `calculateContextTokens`, `shouldCompact`, 프롬프트 4종, `getSummarizationFailure` | 174 | 복사 | `ThinkingLevel` → `ModelThinkingLevel`. 프롬프트는 `prompts.ts`로 분리 |
| 메시지 역할 결합: `estimateTokens`, `isCutPointMessage`, `isTurnStartMessage`, `getAssistantUsage` | 142 | 입력 타입 치환 | 입력이 `Message`와 `ItemRecord`. 턴 시작 판정은 `turnId` 비교로 바꾼다 |
| session-manager 결합: 컷 포인트 계열, `prepareCompaction`, `extractFileOperations` | 336 | 치환·재작성 | `SessionEntry` → `CutCandidate`, `CompactionEntry` → `thread.compacted`, `firstKeptEntryId` → `firstKeptEventId`, `fromHook` → `fromExtension` |
| pi 복구 생략 분기 `isRecoveryOmissionSuffix`(831-856) | 26 | 삭제 [제안] | F에 컨텍스트 편집 개념이 없다 |
| 모델 호출 결합: `compact`, `generateSummaryWithUsage`, `completeSummarization`, `generateTurnPrefixSummary` | 330 | 재작성 | 위치 인자 12~14개를 `SummarizeDeps` 주입으로 바꾼다. `completeSimple`·`retryAssistantCall` 직접 호출 대신 `xeon.models.complete` |
| 컴팩션 적용(투영): `session-manager.ts:439-588` | 150 | 재작성 | 조립 §4.1이 맡는다 |
| researcher가 확인할 부분 | — | — | 턴 분할 경로 약 139줄의 유지 여부, `bashExecution`·`branchSummary` 역할의 F 대응, codemode 중첩 호출 파일 추적(`utils.ts:30-33`). §10 미결 |

- 같은 디렉터리의 `branch-summarization.ts`(382줄)는 `completeSummarization`, `estimateTokens`, `getSummarizationFailure`를 가져다 쓴다(`branch-summarization.ts:19`). 떠난 가지 요약(§4.9)을 위해 프롬프트 `BRANCH_SUMMARY_PROMPT`(`:258`)와 함께 옮긴다.
- 토큰 추정은 pi-ai `utils/estimate.ts`(문자 3.5개당 1토큰)를 `xeon.models.tokens`로 쓴다. pi 컴팩션 내부 `estimateTokens`(문자 4개당 1토큰)는 쓰지 않는다 [제안]. 그래서 pi 테스트의 컷 위치 값은 이식할 때 다시 계산한다.

### 4.7 임계와 오버플로우 복구

임계:

- `shouldCompact`는 `contextTokens > contextWindow - reserveTokens`이면 참이다(pi `compaction.ts:267-269`, 비교는 `>`). `contextWindow`는 카탈로그의 `Model.contextWindow`(`AssembleOptions.contextWindow`, `ResolvedModel.model`)다.
- `contextTokens`는 `xeon.models.tokens.estimateContext(messages).tokens`다. 마지막 어시스턴트 사용량을 기준으로 그 뒤 메시지만 추정한다(pi-ai `estimateContextTokens`).
- 기본값 `reserveTokens` 16,384, `keepRecentTokens` 20,000. pi 런타임 기본값의 원천은 `coding-agent/src/core/settings-defaults.ts:8-12`이고, `compaction.ts:126-130`의 `DEFAULT_COMPACTION_SETTINGS`는 공개 export와 테스트용이다(`_research/notes/L1-3.md` §7). Xeon은 설정 기본값 한 곳(`settings.ts`)에만 둔다.
- `l1.context.autoCompact`가 거짓이면 항상 거짓이다.
- `contextTokens`는 컴팩션 머리와 기록된 접두를 반영한 모델 컨텍스트(`effectiveMessages`: 접두, 요약, 남긴 원문)의 추정이다. volatile과 이번 단계 변경 덧붙이기는 넣지 않는다. 바인딩의 모델이 카탈로그에 없으면(`rebind` 실패) 검사하지 않고 `{ should: false, tokens: 0, threshold: 0 }`이다 [구현: M2].

오버플로우 복구 [제안: 계획 v2 L1-e "단계당 한 번 컴팩션 후 재시도" 표기를 따른다]:

1. core-loop가 종결 메시지를 받으면 `xeon.models.classify(message, contextWindow)`로 분류한다. 분류는 pi-ai `isContextOverflow`(`utils/overflow.ts:137`)를 쓴다.
2. `context_overflow`면 core-loop가 `recoverOverflow(threadId, stepId, message, binding)`을 부른다.
3. 같은 `stepId`로 이미 `reason: "overflow"` 컴팩션이 있으면 `fail(second_overflow)`다. 판정은 가지 위 `thread.compacted.details.xeon.stepId`로 하므로 재개 뒤에도 같다.
4. 없으면 `compact({ reason: "overflow", stepId, willRetry: true })`를 한다. 성공하면 `retry`, 거부되면 `fail(compaction_cancelled)`, 실패하면 `fail(compaction_failed)`다.
5. core-loop는 `retry`면 같은 단계의 요청을 한 번 다시 보낸다. 두 번째 오버플로우는 턴을 오류로 끝낸다(`L1.loop.spec`).
6. M1에서는 2번 대신 `fail(disabled)`를 돌려준다. core-loop는 "컨텍스트 창을 넘었다"는 명확한 오류로 턴을 끝낸다. M2 마감부터 core-loop가 1~5번과 요청 전 `shouldCompact` 검사를 실제로 부른다(`L1.loop.spec` §4.2 규칙 2). 조립 루트가 `ids`와 `core.context` 생산자를 주지 않아 컴팩션이 꺼진 구성은 계속 `fail(disabled)`이고 `shouldCompact`만 참이어도 `compact`가 `skipped(disabled)`를 돌려준다.

- `autoCompact`가 거짓이면 오버플로우 복구도 하지 않고 `fail(disabled)`다. 수동 `compact`는 설정과 상관없이 한다 [구현: M2].
- `session.compact.before`는 fail-open 예외다(`F.extensions.spec` §4.1, adr.0017). 핸들러 예외는 그 핸들러를 결정 없음으로 보고 다음 핸들러로 간다. 그래서 확장 핸들러 예외가 오버플로우 복구 컴팩션을 막지 않는다. 취소는 핸들러가 `{ cancel: true }`를 돌려줄 때만 일어난다.

### 4.8 비파괴 규칙

[제안] 원본 이벤트를 지우지 않고 `thread.compacted`를 가지 끝에 덧붙인다(`F.records.spec` §4.6 4, 계획 v2 L1-e "비파괴 컴팩션 엔트리").

- 조립 때만 `firstKeptEventId` 앞 내용을 요약으로 바꾼다. 이벤트 수와 내용은 컴팩션 전후로 같다(컴팩션 커밋의 새 이벤트를 빼면).
- 분기: 컴팩션 뒤 그 앞 이벤트로 leaf를 옮기면 그 가지에는 머리가 없으므로 원문이 다시 조립된다.
- 머리는 가지 위 마지막 `thread.compacted` 하나만 쓴다. 이전 머리는 다음 요약의 `previousSummary`로만 남는다(pi `buildSessionContext` "only latest matters").

### 4.9 떠난 가지 요약 생성 주체

[미결] `thread.branch_summarized`를 누가 만들고 커밋하는가. `eng.context-map.design` §4.1에서 `session-core`는 `xeon.store`만 쓴다. 그래서 persistence가 context를 부를 수 없다.

| 안 | 순서 | 장점 | 단점 |
|---|---|---|---|
| A [제안] | 호출자(core-loop 또는 L4 host의 `/tree` 처리)가 `session.tree.before`(persistence 지점) 결과를 본 뒤 `context.summarizeBranch`로 초안을 받고, `session.threads.moveLeaf(threadId, target, { reason: "branch", summary, requestKey })`로 leaf 이동과 `thread.branch_summarized`를 한 커밋에 넣는다(`L1.persistence.spec` §3.8 `moveLeaf`) | 의존 방향이 context-map과 맞는다. 원자성이 유지된다 | 호출자가 순서를 알아야 한다 |
| B | context가 `summarizeBranch` 안에서 요약하고 `xeon.session`으로 leaf 이동까지 커밋한다 | 호출이 하나다 | leaf 이동 규칙이 context에 퍼진다. `session.tree.before` 발화 위치가 둘이 된다 |
| C | persistence가 leaf 이동 뒤 이벤트로 알리고 context가 구독해 나중에 요약을 덧붙인다 | 결합이 가장 느슨하다 | 이동과 요약이 다른 커밋이다. 크래시 사이에 요약 없는 가지가 남는다 |

- 확장이 `session.tree.before`에서 요약을 직접 주면(pi `SessionBeforeTreeResult.summary`) A안의 호출자는 `summarizeBranch`를 부르지 않는다.

### 4.9a 컴팩션 뒤 재주입 [구현: M2 마감 G2-01]

컴팩션은 요약 앞의 원문을 모델 컨텍스트에서 뺀다. 첫 turn에 L2.knowledge가 넣은 스킬 색인·메모리 스냅샷 블록(`customType` `knowledge.context`)과 색인 변경 메모(`knowledge.index-delta`)가 같이 접히면 모델이 스킬 목록과 메모리를 잃는다(감사 L2-05).

- 조립(`effectiveMessages`)이 가지 위 `firstKeptEventId` 앞 범위에서 허용 목록에 든 `customType`의 custom item을 찾아, 컴팩션 요약 메시지 바로 뒤에 가지 순서대로 다시 놓는다. 새 이벤트를 커밋하지 않고 매번 가지에서 같은 값으로 만들므로 재개 뒤에도 같은 바이트다. 남은 범위(`firstKeptEventId` 이후)에 있는 같은 종류의 item은 그 자리에 한 번만 나온다.
- 허용 목록은 `createContextService`의 `reinjectCustomTypes` 옵션이고 기본값은 `["knowledge.context", "knowledge.index-delta"]`다. L1은 L2를 import하지 않으므로 두 층이 이 문자열을 약속한다(`L2.knowledge.spec` §4.2.5). 빈 배열이면 재주입하지 않는다. 호스트가 다른 customType을 더하려면 옵션에 넘긴다.
- 이 재주입이 블록을 다시 모델 입력에 올리는 유일한 경로다. L2.knowledge는 컴팩션에서 세션 상태를 비워 전체 블록을 새로 넣지 않는다(`L2.knowledge.spec` §4.2.8). 그렇게 하면 다시 놓은 옛 블록과 새 블록이 한 요청에 둘 다 들어간다(M2 마감 재검토 결함 2, 실제 엔진 시험 `apps/host/test/int/compact-reinject.int.test.ts`). 그래서 컴팩션 뒤에 보이는 블록은 첫 turn 스냅샷 그대로이고, 그 뒤 변경은 `knowledge.index-delta`로 온다.
- 컴팩션을 하지 않은 가지는 영향이 없다. 임계 검사(`shouldCompact`)의 토큰 추정에도 재주입 메시지가 들어간다.
- 컴팩션 요약 입력에서 이 메시지들을 빼지는 않는다. 요약이 색인 내용을 한 번 더 담을 수 있으나 짧다 [제안].
- 최근 읽은 파일 재주입(`l1.context.reinjectRecentFiles`)은 §4.10에 남아 있다(M3).

### 4.10 2차

| 항목 | 규칙 [제안] | 근거 |
|---|---|---|
| 도구 결과 선제 제거 | 모델 호출 없이 보호 구간(최근 `keepRecentTokens`) 밖의 `toolResult` 중 `pruneThresholdChars`(기본 200자)를 넘는 결과를 짧은 표지 `[tool result pruned: <toolName>, <n> chars]`로 바꾼다. 조립 때만 바꾸고 원본은 둔다. 컴팩션 전 1단계로 실행한다 | her(200자 초과 오래된 결과), oc prune(`_research/item-catalog.md` L1-e) |
| 컴팩션 후 재주입(파일, 스킬 본문) | 새 접두 다음에 최근 읽은 파일 5개(`details.readFiles` 뒤쪽)와 호출된 스킬 본문을 `custom` 메시지로 다시 넣는다. 스킬 색인과 메모리 스냅샷 블록은 §4.9a로 M2에 구현했다. 본문은 도구 재실행 없이 블롭 원문에서 읽는다 | cc 최근 파일 5개, 스킬 본문 상한 |
| 추가 워크스페이스 루트 | 세션 생성 때 받은 루트 목록을 context 계층 절 `workspaceRoots`로 둔다. 쓰기 범위는 샌드박스 설정(`L0.sandbox.spec`)과 함께 정한다 | ACP 추가 루트 |
| 캐시 워밍 | 유휴 중 캐시 만료 전에 짧은 요청을 보낼지 정한다. 결정 전에 `request.cache.before`(chain)을 발화한다. 비용 계산은 카탈로그 단가와 `ModelPromptCache` 수명으로 한다 | pi `core/cache-warmer.ts` |

## 5. 실패와 경계 사례

| 사례 | 처리 |
|---|---|
| leaf가 thread에 없음 | `branch_not_found` |
| 가지에 `firstKeptEventId`가 없음(손상) | 머리를 무시하고 원문 전체로 조립, 경고 기록. 투영 오류로 올리지 않는다 [제안] |
| `context` 핸들러가 시스템 메시지를 지움 | 시스템 메시지는 핸들러에 넘기지 않으므로 지울 수 없다. 결과 뒤에 되돌린다 |
| `request.system.before` 핸들러가 접두를 바꿈 | 그대로 보낸다. 핸들러가 프롬프트와 도구 선언을 정하는 규칙은 pi와 같다. 경고 `cache_prefix_reset`을 남긴다 |
| 요약 응답에 도구 호출 | `summary_has_tool_call`, `session.compact.failed` |
| 요약이 `length`로 끊김 | `summary_truncated`, `session.compact.failed` |
| 요약 대상이 비어 있음 | `skipped(nothing_to_summarize)`. 지점을 발화하지 않는다 |
| `session.compact.before` 거부 | `cancelled`. 이벤트를 쓰지 않는다 |
| 같은 단계 두 번째 오버플로우 | `fail(second_overflow)` |
| 컴팩션 중 사용자 중단 | `aborted`, `session.compact.failed`. 부분 요약 사용량은 `xeon.models` 합산에만 남는다 |
| provider가 대화 중 도구 변경을 지원하지 않음 | `defer`, 다음 컴팩션에서 재광고 |
| 모델 전환 뒤 창이 작아짐 | 조립 뒤 추정이 임계를 넘으면 경고 `near_window`. 다음 단계 시작 전 임계 검사에서 컴팩션한다 |

## 6. 설정 노출

탭은 `sessions`다(`L4.settings-ui.spec` §4.1.1). 범위 약어는 `L1.models.spec` §6과 같다.

| 키 | 타입 | 기본값 | 범위 | 변경 적용 | 위젯 | 단계 |
|---|---|---|---|---|---|---|
| `l1.context.autoCompact` | boolean | `true` | M U P Lo S | nextTurn | toggle | M2 |
| `l1.context.reserveTokens` | integer 1024~262144 | `16384` | M U P Lo S | nextTurn | number(토큰) | M2 |
| `l1.context.keepRecentTokens` | integer 1024~262144 | `20000` | M U P Lo S | nextTurn | number(토큰) | M2 |
| `l1.context.compactionInstructions` | string(최대 4000자) | `""` | M U P Lo | nextTurn | text | M2 |
| `l1.context.pruneToolResults` | boolean | `false` | M U P Lo S | nextTurn | toggle | 2차 |
| `l1.context.pruneThresholdChars` | integer 50~100000 | `200` | M U P | nextTurn | number | 2차 |
| `l1.context.reinjectRecentFiles` | integer 0~20 | `5` | M U P | nextTurn | number | 2차 |
| `l1.context.cacheWarming` | `"off" \| "idle"` | `"off"` | M U | live | select | 2차 |

- 명령: `/compact [지침]`(수동 컴팩션), `xeon config set l1.context.autoCompact false`.
- 요약 모델은 `l1.models.routing.summary`(models 탭)다.

## 7. 확장 지점

### 7.1 발화하는 지점

| 지점 | kind | fold | 발화 위치 | F §7 배정 | 비고 |
|---|---|---|---|---|---|
| `context` | request | chain | §4.1 4번 | context, models | M1 지점. `ContextPayload{ messages }`, 패치는 교체 |
| `request.system.before` | request | chain | §4.1 5번 | 같음 | |
| `request.cache.before` | request | chain | §4.10 캐시 워밍(2차) | 같음 | 핸들러는 원본 payload를 받는다 |
| `session.compact.before` | session | first | §4.6 3번 | context | 거부하면 컴팩션하지 않는다 |
| `session.compact.after` | session | tap | §4.6 7번 | context | |
| `session.compact.failed` | session | tap | §4.6 7번 | context | |

- 컴팩션 지점 셋의 발화 주체: `F.extensions.spec` §7은 세 지점을 `L1.context.spec`에 배정한다. 컴팩션을 수행하는 쪽이 context이고, 준비 결과(`preparation`)를 지점 페이로드로 줄 수 있는 곳도, 거부 결정에 따라 요약 호출을 건너뛸 수 있는 곳도 context이기 때문이다.

### 7.2 페이로드 제안 (F 요청)

```ts
export interface SessionBeforeCompactPayload {
  readonly threadId: ThreadId;
  readonly reason: "manual" | "threshold" | "overflow";
  readonly willRetry: boolean;
  readonly preparation: {
    readonly firstKeptEventId: EventId;
    readonly tokensBefore: number;
    readonly isSplitTurn: boolean;
    readonly previousSummary: string | null;
    readonly messagesToSummarize: number;     // 개수만. 본문은 핸들러가 xeon.session으로 읽는다
  };
  readonly instructions: string | null;
}
export type SessionBeforeCompactDecision =
  | { readonly cancel: true; readonly reason: string }
  | { readonly cancel: false; readonly compaction: { readonly summary: string; readonly firstKeptEventId: EventId; readonly details: JsonValue | null } };
// FIRST_DENY.session_before_compact = { cancel: true, reason: "extension handler failed" }

export interface SessionCompactPayload {
  readonly threadId: ThreadId;
  readonly eventId: EventId;                  // thread.compacted
  readonly reason: "manual" | "threshold" | "overflow";
  readonly willRetry: boolean;
  readonly fromExtension: string | null;
  readonly tokensBefore: number;
}
export interface SessionCompactFailedPayload {
  readonly threadId: ThreadId;
  readonly reason: "manual" | "threshold" | "overflow";
  readonly errorMessage: string | null;       // 중단이면 null
}
```

- pi `SessionBeforeCompactEvent`의 `preparation: CompactionPreparation`, `branchEntries: SessionEntry[]`는 pi coding-agent 고유 타입이다. `F.extensions.spec` §3.3 규칙에 따라 F 타입으로 바꾸고, 큰 본문은 싣지 않는다 [제안]. pi의 `signal`은 디스패처 컨텍스트로 넘긴다.
- pi `SessionCompactEvent.compactionEntry`는 `eventId`로 바꿨다.

### 7.3 재생 계약

- 모든 핸들러는 다시 실행해도 되는 질의다(`F.extensions.spec` §4.3). `context`, `request.system.before` 핸들러가 결정적이지 않으면 접두 바이트 고정(수용 기준 1)이 깨진다. 이 조건은 핸들러 계약으로 두고 검사하지 않는다.
- `session.compact.before` 결정은 `thread.compacted.fromExtension`에 남는다. 재개 뒤 같은 컴팩션을 다시 하지 않는다.

### 7.4 post, drive, scope와의 관계

- post: core-context는 `post`를 쓰지 않는다. 컴팩션 완료는 `session.compact.after`(tap) 지점과 내구 이벤트 `thread.compacted`로 알리고 따로 post 항목을 만들지 않는다 [제안]. 확장이 `post`로 넣은 context 항목(custom item)은 조립 때 다른 custom item과 같은 규칙으로 변환한다(§4.1).
- drive: drive 임대 중에도 임계 컴팩션과 오버플로우 복구는 같은 규칙으로 돈다. 컴팩션은 단계 사이에서만 하므로(§4.6 6번) 임대 그룹이 `boundary.settle.before`(L1.loop 소유)로 계속 지시를 내도 다음 단계 시작 전의 임계 검사가 먼저 돈다. `session.compact.before`는 임대 여부와 상관없이 발화하고 임대 그룹을 따로 대하지 않는다 [제안]. 요약 호출은 turn의 assistant item이 아니므로 drive 토큰 예산(L1.loop.spec §4.7의 turn 사용량 합)에 넣지 않는다 [제안].
- scope: 확장이 꺼지면 그 확장의 `context`, `request.system.before`, `request.cache.before`, `session_*compact*` 핸들러는 X가 단계 경계에서 핸들러 스냅샷에서 뺀다(F.extensions.spec §4.5). 진행 중인 조립과 컴팩션은 시작 때의 스냅샷으로 끝까지 간다. 그래서 핸들러 제거는 다음 단계의 `assemble`부터 적용된다. 그 확장이 등록한 도구가 빠지는 일은 §4.3 도구 변경 규칙을 따른다.

## 8. 다른 문서와의 인터페이스

### 8.1 제공

| 이름 | 쓰는 문서 |
|---|---|
| `xeon.context`(`ContextService`), `AssembleOptions`, `AssembledContext`, `PendingSystemItem` | `L1.loop.spec` |
| `compact`, `CompactRequest`, `CompactOutcome`, `recoverOverflow` | `L1.loop.spec`, `L4.cli.spec`(`/compact`) |
| `summarizeBranch`, `BranchSummaryDraft` | `L1.persistence.spec`, `L4.host-service.spec` |
| 이벤트 `thread.compacted`, `thread.branch_summarized` 생산 | `F.records.spec`, `eng.events.design` |
| 캐시 표식 `CacheMarks` 계산 | `L1.models.spec` |

### 8.2 요구

| 이름 | 출처 |
|---|---|
| `ItemRecord`, `Message`, `SystemMessage`, `UserMessage`, `Usage`, `ModelThinkingLevel` | `F.conversation.spec` |
| `CompactedPayload`, `BranchSummarizedPayload`, `StepCheckpoint`, 분기 규칙 | `F.records.spec` |
| `orderTools`, `diffToolsets`, `toolsetFingerprint`, `OrderedTool`, `ToolsetDiff` | `F.capabilities.spec` §3.8 |
| `POINTS`의 6개 지점, `FIRST_DENY`, `CHAIN_RULES` | `F.extensions.spec` |
| `xeon.models`: `complete`(summary 역할), `tokens`, `classify`, `CachePolicy` | `L1.models.spec` |
| `xeon.session`: `readBranch`(가지 읽기), `commit`(컴팩션 커밋), `loadCheckpoint`(이전 바인딩), `threads.moveLeaf`의 `summary` 옵션 | `L1.persistence.spec` §3.3, §3.8 |
| `xeon.ext`: 지점 디스패치 | `X.primitives.spec` |
| 단계 시작 바인딩, `input.agent.before` 결과 절, 단계 커밋에 `pendingItems` 넣기 | `L1.loop.spec` |

### 8.3 F 요청 사항

1. F `@xeon/contracts/services`: §3.1 `context.ts`(서비스 인터페이스, review.decisions-2 D-04). `eng.context-map.design` §5.3의 `ContextService`(conversation) 표기를 services로 고친다.
2. `F.extensions.spec` §7.2: 페이로드를 §3.5 형식으로 확정한다. 컴팩션 지점 셋의 발화 주체는 §7에 반영됐다.
3. `F.records.spec` §3.3: `CompactedPayload.details`에 코어 예약 키 `xeon`(`{ reason, stepId }`)을 허용한다고 적는다. 또는 `reason`, `stepId`를 별도 필드로 둔다.
4. 이벤트 소유: `thread.compacted`, `thread.branch_summarized`의 생산자를 `core.context`로 둔다. `thread.` 영역의 나머지(`started`, `updated`, `closed`, `leaf_moved`)는 `core.persistence`다. `eng.context-map.design` §5.1의 `compaction.recorded`는 F 이름 `thread.compacted`로 고친다.

## 9. 수용 기준

1. 같은 이벤트 가지, 같은 `tools`, `basePrompt`, `sections`로 `assemble`을 두 번 부르면 `messages[0]`의 정규화 JSON 바이트와 `prefixHash`가 같다. 프로세스를 다시 띄운 뒤에도 같다.
2. 접두 고정 뒤 도구 하나를 더하면(`midConversationToolChanges: true`) `messages[0]`은 바뀌지 않고 `toolsAdded`에 그 도구만 담은 `SystemMessage`가 하나 늘어난다. `toolChange.action`은 `append`다.
3. 컴팩션 뒤 thread의 기존 내구 이벤트 수와 각 이벤트의 정규화 JSON이 컴팩션 전과 같다. 새로 생긴 이벤트는 `thread.compacted`와 접두 system `item.recorded` 둘뿐이다.
4. 컴팩션 뒤 `assemble` 결과에는 `firstKeptEventId` 앞의 사용자·어시스턴트 메시지가 없고 요약 메시지가 하나 있다. leaf를 컴팩션 앞 이벤트로 옮기면 원문이 다시 나온다.
5. 한 단계에서 오버플로우가 두 번 나면 첫 번째는 `retry`, 두 번째는 `fail(second_overflow)`다. 첫 컴팩션 뒤 프로세스를 다시 띄워도 두 번째 판정이 같다.
6. `session.compact.before` 핸들러가 `{ cancel: true }`를 돌려주면 `compact`는 `cancelled`이고 `thread.compacted`가 커밋되지 않는다. 핸들러가 예외를 던지면 그 핸들러만 건너뛰고 컴팩션이 이어진다(fail-open).
7. `shouldCompact`는 `contextTokens = contextWindow - reserveTokens`에서 거짓, 1 더 크면 참이다.
8. 요약 호출은 `summary` 역할과 `cacheRetention: "none"`으로 나간다(테이프 요청 기록으로 확인).
9. 컴팩션 실패(테이프 `error`) 때 `session.compact.failed`가 한 번 발화하고 이벤트는 쓰이지 않는다.
10. 이전 요약이 있는 두 번째 컴팩션은 `UPDATE_SUMMARIZATION_PROMPT`를 쓰고, 요약 입력에 이전 요약이 들어간다.

## 10. 미결 사항

1. [미결] 떠난 가지 요약의 생성 주체(§4.9). 제안은 A안.
2. (닫음) 컴팩션 지점 셋의 발화 주체는 `F.extensions.spec` §7이 context로 배정했다(§7.1).
3. [미결] 턴 분할 요약 경로 유지 여부. pi 방식(턴 앞부분 별도 요약, 약 139줄)과 durable 방식(턴 중간 assistant 컷 허용, 분할 없음) 중 하나(`_research/notes/L1-3.md` §12 (a)). 이 문서는 pi 방식을 쓴다.
4. [미결] pi 역할 `bashExecution`, `branchSummary`, `compactionSummary`의 F 대응. 이 문서는 `branchSummary`를 `thread.branch_summarized`, `compactionSummary`를 `thread.compacted`로 두고 `bashExecution`은 F에 대응이 없어 다루지 않는다(`_research/notes/L1-3.md` §12 (b)).
5. [미결] `CompactedPayload.details.xeon` 예약 키와 별도 필드 중 무엇으로 오버플로우 단계를 기록할지(§8.3 3).
6. [미결] `turnId`가 null인 항목의 분할 턴 판정(`_research/notes/L1-3.md` §12 (h))과 `customType`별 컷 후보 여부(같은 절 (i)).
7. [미결] 요약 호출 캐시 금지를 models 게이트웨이 규칙(역할별 기본 보존)으로 둘지, 컴팩션 호출 옵션으로 둘지. 이 문서는 두 곳 모두에 둔다(`L1.models.spec` §3.4 표, §3.2 `SummarizeDeps`).
8. [미결] volatile 계층 원천 중 git 상태의 제공 층. 날짜, 작업 디렉터리, 플랫폼은 L1.loop이 `environment` 항목으로, `input.agent.before`가 더한 프롬프트는 같은 층이 `instructions` 항목으로 넘긴다(`L1.loop.spec` §4.2 규칙 1) [구현: M2 마감].
9. [미결] 대화 중 도구 변경을 지원하지 않는 provider에서 추가 도구를 다음 컴팩션까지 미루는 규칙이 사용 경험에 맞는지. 대안은 그 provider에서만 재광고를 허용하고 캐시 손실을 받아들이는 것이다.
