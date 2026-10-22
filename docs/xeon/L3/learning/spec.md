---
id: L3.learning.spec
layer: L3
domain: learning
kind: spec
status: draft
depends_on: [F.extensions.spec, F.records.spec, F.capabilities.spec, F.conversation.spec, F.wire-settings.spec, L3.group-kit.spec, L2.knowledge.spec, L1.agents.spec, L1.tools.spec, eng.events.design, eng.context-map.design, product.usecases.spec]
binds: [xeon/packages/group-learning/**]
---

# L3 학습 그룹 (learning)

## 1. 목적과 범위

학습 그룹은 Hermes 자기 개선 루프(`_research/refs/hermes.md` §3.10.1)의 정책 부분을 L3 의도 그룹으로 옮긴다. 정책은 언제 검토할지, 무엇을 후보로 볼지, 후보를 어떤 절차로 반영할지를 뜻한다. 이 문서는 정책을 안전 기본값으로 정한다.

- [결정] 학습 그룹은 L3 기본 그룹이다. `drive`를 쓰지 않으므로 Helm과 함께 켤 수 있다(`_research/decisions-log.md` 2026-10-21 계획 v2, `_research/layer-plan-v2-notes.md` "Hermes 학습 루프를 별도 그룹으로", F.extensions.spec §4.6).
- [결정] 저장(스킬, 메모리, 세션 검색, 변경 원장)은 L2-d(L2.knowledge.spec, 패키지 `cap-knowledge`)가 소유한다. 학습 그룹은 정책만 가진다(eng.context-map.design 3절 협력 규칙 5).
- [결정] 검토 포크는 L1-g 백그라운드 위임(L1.agents.spec, 패키지 `core-agents`)으로 실행한다(eng.context-map.design 3절 협력 규칙 4, F.extensions.spec §4.6, `architecture/runtime-flow/design.md` §4.5).

### 1.1 정하는 것

- 학습 트리거: 카운터 상태 `LearningState`, 카운터 갱신 규칙, 임계 판정 순수 함수
- 검토 포크: `g.delegate` 호출 형식, 도구 허용 범위, 반복·토큰 한도, 재귀 방지, 멱등 키, 검토 프롬프트의 요구 사항
- 승인 대기열: `Proposal` 타입, 상태 전이, 비공개 기록(`grp.learning.proposal.*`, `grp.learning.fork.*`)과 투영(`x_learning_*`), L2-d 적용 어댑터의 호출 규칙
- 메타인지 피드백 제안(`kind: "feedback"`)
- 공개 레코드 8종(`grp.learning.*`)의 payload 스키마와 읽는 쪽 계약
- 설정 키 `l3.learning.*`와 명령 `/learning queue|review|history`
- 2차 구성요소(큐레이터, 학습 이력, 스크립트 제안)의 경계 조건(§4.8)

### 1.2 다루지 않는 것

- 스킬·메모리 파일 형식, 저장 위치, 저장 API의 정본 이름, 쓰기 스캔 규칙, 원장 형식: L2.knowledge.spec이 정한다. 이 문서의 `KnowledgeChangeApi`(§3.6)는 학습 그룹 안 어댑터(`proposals/apply.ts`)의 모양이고, L2 메서드로 옮기는 대응은 L2.knowledge.spec §3.9 표를 따른다.
- 백그라운드 위임의 실행, 자식 대화 생성, 도구 실행 검사, 사용량 집계: L1.agents.spec, L1.tools.spec.
- 승인 화면의 배치와 문구: L4(`L4.desktop.spec`, `L4.cli.spec`, `L4.settings-ui.spec`). 이 문서는 요구 인터페이스(§3.8)만 정한다.
- 검토 프롬프트의 문구 본문: 구현 단계(L3.learning.plan LR-07)에서 쓴다. 이 문서는 요구 사항(§4.4)만 정한다.
- 그룹 정의 API(`defineGroup`, `GroupApi`)의 구현: L3.group-kit.spec.

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 학습 트리거 | 사용자 turn 수와 도구 반복 수를 세어 검토 시작 여부를 정하는 규칙 |
| 사용자 turn | F.conversation.spec §2의 turn 가운데 사용자 대화 입력으로 시작한 것. 예약 실행, 원격 자동 입력, 검토 포크 자신의 turn은 제외한다(§4.2) |
| 도구 반복 | 도구 호출을 하나 이상 실행한 step 하나. Hermes의 "도구 반복 1회"(`hermes.md` §3.10.1 (가) 2)에 대응한다 |
| 단계 경계 | F.conversation.spec §2의 정의. step이 끝나고 다음 step이 시작되기 전 시점 |
| 검토 포크 | 부모 대화 스냅샷을 읽고 스킬·메모리·피드백 후보를 제안하는 백그라운드 자식 대화. L1-g가 실행한다 |
| epoch | 검토 시작 순번. 1부터 단조 증가한다. 검토 포크의 멱등 키에 들어간다 |
| 후보(Proposal) | 검토 포크나 사용자 명령이 만든 변경 제안. 승인 대기열의 한 행이다 |
| 적용 | 승인된 후보를 L2-d 쓰기 API로 저장소에 반영하는 일. 원장 기록은 L2-d가 한다 |
| 제안 도구 | 검토 포크가 후보를 제출하는 모델 도구 `learning_propose`(§3.5) |
| 파괴적 연산 | 기존 내용을 바꾸거나 없애는 연산. 스킬 `patch`·`archive`, 메모리 `replace`·`remove` |

## 3. 인터페이스

코드는 `xeon/packages/group-learning/src/`에 둔다. 파일 배치는 L3.learning.plan §2가 정한다. 타입 이름 중 F와 group-kit 소유 이름은 import해서 쓴다.

### 3.1 매니페스트 (`manifest.ts`)

```ts
import { defineManifest } from "@xeon/contracts/extensions";
import { learningRecordKindDecls } from "./records.ts";

export const manifest = defineManifest({
  schemaVersion: 1,
  name: "learning",
  version: "0.1.0",
  displayName: "학습",
  description: "세션에서 스킬·메모리·작업 방식 피드백 후보를 찾아 승인 대기열에 올린다",
  layer: "L3",
  kind: "group",
  entry: "./src/index.ts",
  defaultEnabled: true,            // [미결] 기본 켬 여부(§10 미결 8)
  usesDrive: false,
  usesPost: true,
  points: ["agent_start", "tool_execution_end", "agent_settled", "session_start"],
  requires: [                                // L2.knowledge.spec §1 능력 4개
    { id: "knowledge.skills", range: "^1.0.0" },
    { id: "knowledge.memory", range: "^1.0.0" },
    { id: "knowledge.search", range: "^1.0.0" },
    { id: "knowledge.ledger", range: "^1.0.0" },
  ],
  optional: [],
  recordKinds: learningRecordKindDecls,     // §3.7의 8종(2차 1종 포함)
  readsRecordKinds: [],                      // 다른 그룹의 레코드를 읽지 않는다 [결정: review.decisions-2 D-10]
  components: { agents: ["./agents/learning-review.md"] },   // 검토 포크 정의(§3.4, L1.agents.spec §4.9)
  trust: { level: "builtin" },
});
```

- 능력 ID는 L2.knowledge.spec §1의 네 능력이다. 이 문서의 옛 [가정] 이름과의 대응은 L2.knowledge.spec §3.9 표를 따른다: 읽기(`knowledge.skills.view`, `knowledge.memory.read`, `knowledge.search.query`), 쓰기(`knowledge.skills.create`·`edit`·`patch`·`writeFile`·`remove`, `knowledge.memory.add`·`replace`·`remove`), 원장(`knowledge.ledger.list`·`show`·`rollback`), 스캔(`knowledge.ledger.scan`). 서비스 키는 `KnowledgeSkillsKey`, `KnowledgeMemoryKey`, `KnowledgeSearchKey`, `KnowledgeLedgerKey`다.
- 스캔은 `knowledge.ledger.scan`으로 따로 노출된다(L2.knowledge.spec §3). 그래서 사전 스캔(§4.6 2단계)은 `knowledge.ledger`가 제공되면 항상 돌 수 있다.
- 위임 서비스(`xeon.agents`)는 능력이 아니므로 `requires`에 넣지 않는다(F.extensions.spec §3.1에 위임 필드가 없다). 학습 그룹은 group-kit의 `GroupApi.delegate`(§3.4)로만 위임한다. `GroupApi.delegate`가 매니페스트 선언을 요구할지는 L3.group-kit.spec이 정한다 [가정].
- `components.agents`의 `learning-review` 정의 파일은 그룹 패키지 안에 둔다. L1.agents.spec §4.9는 확장 경로(매니페스트 `components.agents`)의 정의 읽기를 M2에 둔다. 정의의 `tools`에는 §3.4 허용 목록을 넣고 위임 도구를 넣지 않는다(재귀 방지, §4.3).
- `readsRecordKinds`는 빈 목록이다 [결정: review.decisions-2 D-10]. 그룹 사이 레코드는 F에 스키마가 없으므로 학습 그룹은 Helm을 비롯한 다른 그룹의 레코드를 읽지 않는다. 검토 포크의 입력은 부모 대화 스냅샷뿐이다.

### 3.2 그룹 정의와 상태 (`index.ts`, `state.ts`)

```ts
import { Type, type Static } from "typebox";
import { defineGroup, type GroupApi } from "@xeon/group-kit";

export const LearningStateSchema = Type.Object({
  /** 마지막 검토 이후 센 사용자 turn 수 */
  userTurnsSinceReview: Type.Integer({ minimum: 0 }),
  /** 마지막 스킬 쓰기(또는 검토) 이후 센 도구 반복 수 */
  toolIterationsSinceSkillWrite: Type.Integer({ minimum: 0 }),
  /** 마지막으로 시작한 검토의 requestId. 없으면 null. 1~48자(L3.group-kit.spec §3.4) */
  lastReviewId: Type.Union([Type.String({ maxLength: 48 }), Type.Null()]),
  /** 마지막으로 시작한 검토의 순번. 0은 검토 이력 없음 */
  epoch: Type.Integer({ minimum: 0 }),
  /** 2차 큐레이터: 마지막 실행 시각(epoch ms). 1차에서는 null 고정 */
  curatorLastRunAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
});
export type LearningState = Static<typeof LearningStateSchema>;

export const INITIAL_LEARNING_STATE: LearningState = {
  userTurnsSinceReview: 0,
  toolIterationsSinceSkillWrite: 0,
  lastReviewId: null,
  epoch: 0,
  curatorLastRunAt: null,
};

export const learningGroup = defineGroup<LearningState>({
  manifest,
  state: { schema: LearningStateSchema, initial: INITIAL_LEARNING_STATE, version: 1 },
  setup: (g: GroupApi<LearningState>) => {
    registerTriggers(g);      // triggers.ts: agent_start, tool_execution_end, agent_settled
    registerQueue(g);         // proposals/queue.ts: session_start, 만료 판정
    registerProposeTool(g);   // review/policy.ts: g.registerTool로 learning_propose 도구
    registerCommands(g);      // commands.ts: g.registerCommand("learning", …)
  },
});
export default learningGroup;
```

- `defineGroup`의 인자(`manifest`, `state`, `settings`, `setup`)는 L3.group-kit.spec §3.2 `GroupDef<S>`다. 도구·명령 등록은 `GroupApi.registerTool`, `GroupApi.registerCommand`(같은 절)로 한다.
- `LearningState`는 scope 상태 문서다. F.extensions.spec §3.2 `StateDecl`로 선언하고 `g.commit`으로만 바꾼다. [가정] scope 상태는 대화(thread)마다 따로 있고 분기를 따라간다(eng.events.design 9절 "확장 상태도 분기·되감기·재개를 따라간다").

### 3.3 임계 판정 순수 함수 (`triggers.ts`)

```ts
export interface TriggerSettings {
  readonly userTurns: number;        // l3.learning.trigger.userTurns
  readonly toolIterations: number;   // l3.learning.trigger.toolIterations
}

/** turn 하나 동안 tap 핸들러가 모은 값. agent_settled에서 한 번 반영한다 */
export interface TurnTally {
  readonly turnId: TurnId;
  readonly origin: "user" | "scheduled" | "remote" | "review" | "other";
  readonly status: "completed" | "aborted" | "error";
  readonly hasFinalAnswer: boolean;
  readonly toolIterations: number;
  readonly skillWritten: boolean;
}

export type ReviewReason = "user_turns" | "tool_iterations";

export type TriggerDecision =
  | { readonly kind: "skip"; readonly next: LearningState; readonly why: "excluded" | "below_threshold" | "disabled" }
  | { readonly kind: "review"; readonly next: LearningState; readonly requestId: ReviewRequestId; readonly reasons: readonly ReviewReason[] };

/** 순수 함수. 시계·난수·I/O를 쓰지 않는다 */
export function applyTurn(state: LearningState, tally: TurnTally, settings: TriggerSettings, enabled: boolean): TriggerDecision;

/** "learning:review:<epoch>" 형식. 1~48자. group-kit이 ":report"를 붙여 보고 post 키(64자 한도)로 쓰기 때문이다(L3.group-kit.spec §3.4) */
export type ReviewRequestId = `learning:review:${number}`;
export function reviewRequestId(epoch: number): ReviewRequestId;
```

### 3.4 검토 포크 호출 (`review/fork.ts`)

`GroupApi.delegate`는 group-kit이 F의 `ScopeApi`에 더하는 연산이다. 학습 그룹은 group-kit의 `DelegateSpec`(L3.group-kit.spec §3.4)을 그대로 만들어 넘기고, 결과는 `DelegateResult`(`{ ok: true, receipt } | { ok: false, error }`)로 받는다. 학습 그룹은 위임 타입을 따로 정의하지 않는다.

```ts
import type { DelegateError, DelegateResult, DelegateSpec } from "@xeon/group-kit";

/** 검토 포크 서브에이전트 정의 이름. 정의 파일은 그룹 패키지 agents/learning-review.md(매니페스트 components.agents) */
export const REVIEW_AGENT = "learning-review";
/** 완료 보고 customType. 자기 grp.learning. 접두(L3.group-kit.spec §3.4 DelegateReport) */
export const REVIEW_RESULT_TYPE = "grp.learning.review.result";

export function buildReviewSpec(input: {
  readonly parent: { readonly threadId: ThreadId; readonly upToEventId: EventId };
  /** reviewRequestId(epoch) 또는 수동 검토 "learning:review:manual:<n>". 1~48자 */
  readonly requestId: string;
  readonly reasons: readonly ReviewReason[];
  readonly settings: LearningSettings;
  readonly contextWindow: number | null;
}): DelegateSpec;

export function reviewTokenBudget(contextWindow: number | null, override: number | null): number;

/** DelegateResult를 학습 그룹의 다음 동작으로 바꾼다. 순수 함수 */
export function reviewStartOutcome(result: DelegateResult):
  | { readonly kind: "started"; readonly childThreadId: ThreadId }      // receipt.status "accepted"
  | { readonly kind: "already"; readonly childThreadId: ThreadId }      // receipt.status "duplicate"
  | { readonly kind: "retryLater"; readonly error: DelegateError };                 // ok: false
```

`buildReviewSpec`이 채우는 `DelegateSpec` 필드:

| 필드 | 값 | 근거 |
|---|---|---|
| `agent` | `"learning-review"` | §3.1 매니페스트 `components.agents`, L3.learning.plan §2 `agents/learning-review.md` |
| `task` | `review/prompts.ts`가 만든 검토 지시(§4.4) | |
| `requestId` | `learning:review:<epoch>` 또는 `learning:review:manual:<n>`. 1~48자 | L3.group-kit.spec §3.4(보고 키 `:report`를 붙여 64자 안) |
| `report` | `{ customType: "grp.learning.review.result", display: false, when: "followUp" }` [제안] | §4.3 완료 통지 |
| `toolPolicy` | `{ allow: [...], keepParentList: true, denyHint }` | 아래 허용 목록, §4.3 |
| `limits` | `{ maxSteps: l3.learning.review.maxIterations, maxInputTokens: reviewTokenBudget(...) }` | §4.3 표, L1.agents.spec §3.2 `ChildLimits` |
| `model` | `l3.learning.review.model`. null이면 넣지 않는다(정의의 model) | §6.1 |
| `fork` | `{ at: "event", eventId: parent.upToEventId }` | §4.3 시작 순서 1, L1.agents.spec §3.2 `ForkPoint` |

- `reviewTokenBudget(w, null)`: `w`가 null이면 120,000, 아니면 `min(floor(w * 0.75), 600_000)`이다. `override`가 있으면 그 값이다(§6).
- 기본 허용 목록 `toolPolicy.allow` [제안]. 도구 이름으로 적는다(L1.agents.spec §3.2 `ChildToolPolicy.allow`):
  - 제안 도구 `learning_propose`
  - L2 지식 읽기 도구 `skill_view`, `knowledge_search`, `session_scroll`, `session_read`(L2.knowledge.spec §3의 모델 도구 중 `readOnly` 도구)
  - 작업 공간 읽기 도구 `read`, `grep`, `find`, `ls` [가정: L2.workspace.spec의 도구 이름]
  - 위 목록 밖 도구(쓰기, 편집, 셸, 웹, 위임, 사용자 질문, `skill_manage`·`memory_manage` 같은 지식 쓰기 도구)는 모두 거부한다.
- `denyHint`는 "후보는 `learning_propose`로 제출한다"를 담는다(§4.3 쓰기 거부).
- 도구 정책의 허용·차단 방식은 L3.group-kit.spec §3.4가 정한다(둘 다 받는다). 학습 그룹은 허용 목록을 쓴다.

### 3.5 제안 도구 (`review/policy.ts`)

```ts
export const LEARNING_PROPOSE_TOOL = "learning_propose";

export const ProposeInputSchema = Type.Object({
  kind: Type.Union([Type.Literal("skill"), Type.Literal("memory"), Type.Literal("feedback")]),
  op: ProposalOpSchema,                                   // §3.6
  target: Type.String({ minLength: 1, maxLength: 128 }),  // 스킬 이름 또는 메모리 영역 이름
  /** 새 내용 전체(create, add) 또는 통합 diff(patch, replace) */
  body: Type.String({ minLength: 1, maxLength: 100_000 }),
  /** patch·replace·archive·remove에서 필수. knowledge.skills.view·knowledge.memory.read가 돌려준 내용 해시 */
  baseHash: Type.Optional(Type.String({ pattern: "^[0-9a-f]{64}$" })),
  rationale: Type.String({ minLength: 1, maxLength: 2_000 }),
  /** 근거가 된 부모 대화 이벤트 id. 1개 이상 */
  evidenceEventIds: Type.Array(Type.String(), { minItems: 1, maxItems: 32 }),
});

export type ProposeResult =
  | { readonly ok: true; readonly proposalId: ProposalId; readonly status: "pending" | "rejected" }
  | { readonly ok: false; readonly reason: "base_missing" | "base_stale" | "op_not_allowed" | "invalid" | "limit"; readonly hint: string };
```

- 도구는 `g.registerTool`로 등록한다(L3.group-kit.spec §3.2, X `hostOf(g).registerTool`, X.primitives.spec §4.8). 도구 결과 3채널 형식은 F.conversation.spec §3.6을 따른다.
- 이 도구는 파일을 바꾸지 않는다. 후보 행을 대기열에 넣는 것만 한다(§4.5).
- 같은 도구를 주 대화의 모델도 볼 수 있다. 캐시 접두를 위해 부모와 포크의 도구 배열을 같게 두기 때문이다(§4.3). 주 대화에서 부른 제안도 같은 대기열로 들어가고 같은 승인 규칙을 따른다 [제안].
- 읽기 선행 가드: `patch`, `replace`, `archive`, `remove`는 `baseHash`가 필수이고, 도구 실행 시점에 L2-d 읽기로 구한 현재 해시와 같아야 한다. 다르면 `base_stale`을 돌려준다. Hermes의 "패치 전 같은 검토 안에서 다시 읽기" 가드(`hermes.md` §3.10.1 (다), `tools/skill_manager_guards.py:211-221`)를 해시 비교로 옮긴 것이다 [제안].
- 한 검토에서 받을 후보 수 상한은 8개다 [제안]. 넘으면 `limit`.

### 3.6 승인 대기열 (`proposals/queue.ts`, `proposals/apply.ts`, `proposals/scan.ts`)

```ts
export type ProposalId = string;   // "prop_" + ULID. eng.domain-types.guide 브랜드 규칙을 따른다 [가정]

export const ProposalKindSchema = Type.Union([
  Type.Literal("skill"), Type.Literal("memory"), Type.Literal("feedback"),
  Type.Literal("script"),          // 2차(§4.8.3)
]);

/** 삭제 연산은 없다. 스킬은 archive만 둔다 */
export const ProposalOpSchema = Type.Union([
  Type.Literal("create"),          // skill, script: 새로 만듦
  Type.Literal("patch"),           // skill: 기존 본문 수정(파괴적)
  Type.Literal("add_file"),        // skill: 지원 파일 추가(references, templates, scripts, assets)
  Type.Literal("archive"),         // skill: 보관 영역으로 이동(파괴적)
  Type.Literal("add"),             // memory, feedback: 항목 추가
  Type.Literal("replace"),         // memory: 항목 교체(파괴적)
  Type.Literal("remove"),          // memory: 항목 제거(파괴적)
]);

export const ProposalStatusSchema = Type.Union([
  Type.Literal("pending"), Type.Literal("approved"), Type.Literal("rejected"),
  Type.Literal("applied"), Type.Literal("reverted"), Type.Literal("expired"),
]);

/** ProposalSchema가 참조하므로 먼저 선언한다 */
export const ProposalReasonSchema = Type.Union([
  Type.Literal("user_rejected"), Type.Literal("scan_failed"), Type.Literal("base_stale"),
  Type.Literal("op_not_allowed"), Type.Literal("apply_failed"), Type.Literal("ttl"),
  Type.Literal("rollback_refused"),
]);

export const ProposalSchema = Type.Object({
  id: Type.String(),
  kind: ProposalKindSchema,
  op: ProposalOpSchema,
  target: Type.String({ minLength: 1, maxLength: 128 }),
  /** 표시용 diff. create·add는 빈 기준에 대한 diff다 */
  diff: Type.String({ maxLength: 200_000 }),
  /** 적용 때 넘길 새 내용의 blob 해시(eng.events.design EV-04) */
  bodyHash: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  baseHash: Type.Union([Type.String({ pattern: "^[0-9a-f]{64}$" }), Type.Null()]),
  rationale: Type.String({ maxLength: 2_000 }),
  evidenceEventIds: Type.Array(Type.String(), { maxItems: 32 }),
  status: ProposalStatusSchema,
  /** 만든 검토의 requestId(1~48자). 사용자 명령이나 주 대화에서 온 후보는 null */
  reviewId: Type.Union([Type.String({ maxLength: 48 }), Type.Null()]),
  /** 기존 스킬과 겹치는 대상이 있으면 그 이름. diff로 표시한다(§4.5) */
  conflictsWith: Type.Union([Type.String(), Type.Null()]),
  destructive: Type.Boolean(),
  /** 거절·실패 사유 코드 */
  reason: Type.Union([ProposalReasonSchema, Type.Null()]),
  /** 적용 뒤 L2-d 원장 항목 id */
  ledgerId: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.Integer(),       // 생산자가 넣은 시각(epoch ms). 투영은 시계를 읽지 않는다
  updatedAt: Type.Integer(),
  revision: Type.Integer({ minimum: 1 }),
});
export type Proposal = Static<typeof ProposalSchema>;

export type ProposalDecision =
  | { readonly kind: "approve"; readonly proposalId: ProposalId; readonly revision: number }
  | { readonly kind: "reject"; readonly proposalId: ProposalId; readonly note?: string }
  | { readonly kind: "edit"; readonly proposalId: ProposalId; readonly body: string }
  | { readonly kind: "revert"; readonly proposalId: ProposalId };
```

L2-d 쓰기 어댑터의 모양이다. 학습 그룹 안 인터페이스이고, 구현(`proposals/apply.ts`)은 L2.knowledge.spec §3.9 대응표대로 L2 메서드를 부른다: `apply` → `knowledge.skills.create`·`edit`·`patch`·`writeFile`·`remove` 또는 `knowledge.memory.add`·`replace`·`remove`(`approval: ApprovalEvidence`, `CallOptions.requestId = idempotencyKey`), `scan` → `knowledge.ledger.scan`, `rollback` → `knowledge.ledger.rollback`. L2 실패 코드는 `scan_blocked` → `scan_failed`, `approval_denied` → `approval_required`, `invalid_input` → `invalid`, `rollback_conflict` → `hash_mismatch`로 옮긴다. 학습 그룹은 `g.capability(<ServiceKey>)`로만 얻고 `cap-knowledge`를 import하지 않는다(eng.context-map.design CM-05).

```ts
export interface KnowledgeChange {
  readonly kind: "skill" | "memory" | "script";
  readonly op: Static<typeof ProposalOpSchema>;
  readonly target: string;
  readonly body: string;
  readonly baseHash: string | null;
  /** L2-d가 "에이전트 생성" 표시를 붙이는 근거. 큐레이터 대상 판정에 쓴다(§4.8.1) */
  readonly createdBy: "agent";
}

export interface KnowledgeChangeApi {
  scan?(change: KnowledgeChange, ctx: { readonly signal: AbortSignal }): Promise<
    { readonly ok: true } | { readonly ok: false; readonly findings: readonly { readonly rule: string; readonly severity: "block" | "warn" }[] }>;
  apply(change: KnowledgeChange, opts: {
    /** 같은 키의 두 번째 호출은 첫 결과를 돌려준다 */
    readonly idempotencyKey: `learning:apply:${string}`;
    /** 학습 대기열에서 사용자가 승인했다는 증거. L2-d가 자기 승인 정책에 쓴다 */
    readonly approval: { readonly source: "learning.queue"; readonly proposalId: string; readonly revision: number; readonly decidedAt: number };
    readonly signal: AbortSignal;
  }): Promise<
    | { readonly ok: true; readonly ledgerId: string; readonly afterHash: string }
    | { readonly ok: false; readonly reason: "scan_failed" | "base_stale" | "approval_required" | "invalid" | "io"; readonly detail?: string }>;
  rollback?(ledgerId: string, opts: { readonly idempotencyKey: `learning:revert:${string}`; readonly signal: AbortSignal }): Promise<
    { readonly ok: true; readonly ledgerId: string } | { readonly ok: false; readonly reason: "hash_mismatch" | "not_found" | "io" }>;
}
```

### 3.7 이벤트, 투영, 레코드 (`records.ts`)

#### 3.7.1 비공개 기록 `grp.learning.proposal.*`, `grp.learning.fork.*`

F.records.spec §3.2 규칙 2의 그룹 kind 형식 `grp.<groupId>.<영역>.<이름>`을 쓴다(F.records.spec §3.1.2 대조표의 F 정본). 비공개 기록이라 매니페스트 `readsRecordKinds`로 노출되지 않고 다른 그룹은 읽지 않는다. 검토 실행 기록은 공개 레코드 `grp.learning.review.finished`(§3.7.3)와 이름이 겹치지 않도록 영역을 `fork`로 둔다 [제안].

| kind | payload | 쓰는 때 |
|---|---|---|
| `grp.learning.fork.started` | `{ requestId, epoch, childThreadId, reasons, parentThreadId }` | 위임 접수(`accepted`) 직후 |
| `grp.learning.fork.finished` | `{ requestId, outcome: "completed" \| "aborted" \| "error" \| "budget", proposalIds, usage }` | 포크 종료 통지를 받았을 때 |
| `grp.learning.proposal.created` | `Proposal`(status `pending` 또는 `rejected`) | 제안 도구 처리 |
| `grp.learning.proposal.edited` | `{ id, revision, diff, bodyHash }` | 사용자 수정 |
| `grp.learning.proposal.decided` | `{ id, revision, status: "approved" \| "rejected", reason, decidedAt }` | 사용자 결정 |
| `grp.learning.proposal.applied` | `{ id, ledgerId, afterHash }` | L2-d 적용 성공 |
| `grp.learning.proposal.apply_failed` | `{ id, reason, nextStatus: "pending" \| "rejected" }` | L2-d 적용 실패 |
| `grp.learning.proposal.reverted` | `{ id, ledgerId }` | 원장 롤백 성공 |
| `grp.learning.proposal.expired` | `{ id, at }` | 만료 판정 |

- 쓰기 경로 [결정: review.decisions-2 T-21]: 비공개 기록은 X 연산 `ScopeApi.recordPrivate(kind, payload)`로 쓴다. 이 문서가 기대는 조건은 다음과 같다. (1) kind는 자기 접두 `grp.<name>.*`(플러그인은 `x.<name>.*`)만 받는다. (2) `readsRecordKinds`와 다른 그룹의 `readRecords`로 조회되지 않는다. (3) 큰 값(`Proposal.diff`, 제안 본문)은 blob으로 분리하고 이벤트에는 참조만 싣는다. (4) 멱등 키는 공개 `record`와 같은 규칙 `rec:<scope 해시>:<dispatchKey>:<n>`이고, 재실행된 같은 호출은 `replayed`다. (5) 이 kind들은 매니페스트 `recordKinds`(`learningRecordKindDecls`)에 선언하지 않는다. 공개 kind와 같은 이름, 영역 `state`, 다른 접두는 `record_private_invalid`로 거부된다. (6) 핸들러 안의 호출은 따로 커밋된다. 공개 `record`는 payload 상한 16 KiB이고 다른 그룹이 읽을 수 있는 kind라 이 용도에 쓰지 않는다. group-kit `GroupApi`는 이 연산을 그대로 전달한다(L3.group-kit.spec §3.2). 연산 정의는 X.primitives.spec §4.6.5다.
- 대체안(scope 상태 `commit`)의 한계: 상태 문서 상한은 64 KiB이고(L3.group-kit.spec §3.6) `Proposal.diff`는 최대 200,000자, 제안 본문은 최대 100,000자다. 그래서 대기열 전체를 상태에 둘 수 없다. 대체안을 쓰려면 상태에는 대기열 색인(`id`, `kind`, `op`, `target`, `status`, `revision`, `bodyHash`, `baseHash`, `reason`, `ledgerId`)만 두고 본문·diff는 상태 밖에 둬야 한다. 상태 밖 위치 후보는 L2-d 제안 대기열(`knowledge.ledger.proposals`, L2.knowledge.spec §4.5.2)과의 통합이고, 이는 §10 미결 9(대기열 소유)와 같은 결정이다. `recordPrivate`가 정해졌으므로(review.decisions-2 T-21) 이 문서는 대체안을 쓰지 않는다. 미결 9가 L2-d 소유로 정해지면 이 절을 다시 쓴다.

#### 3.7.2 투영 `x_learning_*`

```ts
/** 투영기. I/O와 시계를 쓰지 않는다(eng.events.design EV-06) */
export const learningProjector = {
  name: "ext.learning",
  version: 1,
  tables: ["x_learning_proposals", "x_learning_reviews"],
  ddl: [PROPOSALS_DDL, REVIEWS_DDL],
  kinds: [
    "grp.learning.fork.started", "grp.learning.fork.finished",
    "grp.learning.proposal.created", "grp.learning.proposal.edited", "grp.learning.proposal.decided",
    "grp.learning.proposal.applied", "grp.learning.proposal.apply_failed",
    "grp.learning.proposal.reverted", "grp.learning.proposal.expired",
  ],
  apply: applyLearningEvent,
} as const;
```

| 테이블 | 열 | 키 |
|---|---|---|
| `x_learning_proposals` | `id`, `session_id`, `kind`, `op`, `target`, `status`, `reason`, `revision`, `body_hash`, `base_hash`, `diff`, `rationale`, `evidence_json`, `review_id`, `conflicts_with`, `destructive`, `ledger_id`, `created_at`, `updated_at` | `id` |
| `x_learning_reviews` | `request_id`, `session_id`, `epoch`, `child_thread_id`, `outcome`, `proposal_count`, `input_tokens`, `output_tokens`, `started_seq`, `finished_seq` | `(session_id, request_id)` |

#### 3.7.3 공개 레코드 `grp.learning.*`

`ScopeApi.record`로 쓴다(F.extensions.spec §3.6, §4.8). 주제(`RecordSubject`)는 `{ type: "thread", id: <부모 threadId> }`다. 모든 payload의 `version`은 1이다.

```ts
const Base = {
  proposalId: Type.String(),
  target: Type.String({ maxLength: 128 }),
  reviewId: Type.Union([Type.String({ maxLength: 64 }), Type.Null()]),
};

export const SkillProposedV1 = Type.Object({
  ...Base,
  op: Type.Union([Type.Literal("create"), Type.Literal("patch"), Type.Literal("add_file"), Type.Literal("archive")]),
  summary: Type.String({ maxLength: 200 }),        // 한 줄 요약. 본문은 싣지 않는다
  conflictsWith: Type.Union([Type.String(), Type.Null()]),
});
export const SkillApprovedV1 = Type.Object({ ...Base, revision: Type.Integer({ minimum: 1 }) });
export const SkillRejectedV1 = Type.Object({
  ...Base,
  reason: Type.Union([Type.Literal("user_rejected"), Type.Literal("scan_failed"), Type.Literal("base_stale"), Type.Literal("op_not_allowed"), Type.Literal("ttl")]),
});
export const SkillAppliedV1 = Type.Object({
  ...Base,
  ledgerId: Type.String(),
  /** L2-d 검색에서 찾을 때 쓰는 스킬 이름. 본문은 knowledge.skills.view로 읽는다 */
  skillName: Type.String({ maxLength: 128 }),
});
export const MemoryProposedV1 = Type.Object({
  ...Base,
  op: Type.Union([Type.Literal("add"), Type.Literal("replace"), Type.Literal("remove")]),
  area: Type.Union([Type.Literal("user"), Type.Literal("environment")]),
  summary: Type.String({ maxLength: 200 }),
});
export const FeedbackProposedV1 = Type.Object({
  ...Base,
  /** 교정·좌절 신호의 종류(§4.7) */
  signal: Type.Union([Type.Literal("style_correction"), Type.Literal("workflow_correction"), Type.Literal("frustration"), Type.Literal("repeated_mistake")]),
  summary: Type.String({ maxLength: 200 }),
});
export const ReviewFinishedV1 = Type.Object({
  reviewId: Type.String({ maxLength: 48 }),
  outcome: Type.Union([Type.Literal("completed"), Type.Literal("aborted"), Type.Literal("error"), Type.Literal("budget")]),
  proposalCount: Type.Integer({ minimum: 0 }),
  inputTokens: Type.Integer({ minimum: 0 }),
  outputTokens: Type.Integer({ minimum: 0 }),
});
/** 2차 */
export const ScriptProposedV1 = Type.Object({
  ...Base,
  form: Type.Union([Type.Literal("script"), Type.Literal("slash_command")]),
  occurrences: Type.Integer({ minimum: 1 }),
  summary: Type.String({ maxLength: 200 }),
});

export const learningRecordKindDecls: readonly RecordKindDecl[] = [
  { kind: "grp.learning.skill.proposed", version: 1, description: "스킬 후보가 대기열에 들어감", payload: SkillProposedV1 },
  { kind: "grp.learning.skill.approved", version: 1, description: "사용자가 스킬 후보를 승인함", payload: SkillApprovedV1 },
  { kind: "grp.learning.skill.rejected", version: 1, description: "스킬 후보가 거절됨(사용자, 스캔, 만료)", payload: SkillRejectedV1 },
  { kind: "grp.learning.skill.applied", version: 1, description: "승인된 스킬 변경이 L2-d에 반영됨", payload: SkillAppliedV1 },
  { kind: "grp.learning.memory.proposed", version: 1, description: "메모리 후보가 대기열에 들어감", payload: MemoryProposedV1 },
  { kind: "grp.learning.feedback.proposed", version: 1, description: "작업 방식 피드백 후보가 대기열에 들어감", payload: FeedbackProposedV1 },
  { kind: "grp.learning.review.finished", version: 1, description: "검토 포크가 끝남", payload: ReviewFinishedV1 },
  { kind: "grp.learning.script.proposed", version: 1, description: "(2차) 반복 명령 묶음의 스크립트 후보", payload: ScriptProposedV1 },
];
```

- 레코드에는 본문을 싣지 않는다. 본문은 승인 뒤 L2-d에만 있다. 레코드 크기는 F.records.spec의 envelope 상한(256 KiB) 안에 있다.

### 3.8 L4 승인 화면 요구 인터페이스

승인 화면은 L4(`apps/desktop`, `apps/cli`)가 소유한다. 학습 그룹은 서비스를 제공하지 않으므로(eng.context-map.design 3절 협력 규칙 7) 화면은 아래 두 경로만 쓴다.

```ts
/** 화면이 그리는 한 행. x_learning_proposals 행과 같은 필드에서 만든다 */
export interface ProposalView {
  readonly id: ProposalId;
  readonly kind: Proposal["kind"];
  readonly op: Proposal["op"];
  readonly target: string;
  readonly status: Proposal["status"];
  readonly destructive: boolean;
  readonly diff: string;
  readonly rationale: string;
  readonly evidence: readonly { readonly eventId: string; readonly threadId: ThreadId }[];
  readonly conflictsWith: string | null;
  readonly reason: Proposal["reason"];
  readonly revision: number;
}
```

1. 목록: `/learning queue --json` 명령 결과(`readonly ProposalView[]`). [가정] 데스크톱은 명령 결과를 wire 명령 호출로 받는다. wire 메서드 이름은 F.wire-settings.spec과 L4.desktop.spec이 정한다.
2. 결정: `/learning queue approve|reject|edit|revert <id>` 명령(§6.2). 명령 인자는 `ProposalDecision`과 1:1이다.
3. 알림: `grp.learning.skill.proposed`, `grp.learning.memory.proposed`, `grp.learning.feedback.proposed`, `grp.learning.review.finished` 레코드가 생기면 L4가 배지를 갱신한다. [가정] L4는 세션 피드 구독으로 레코드 이벤트를 받는다.

## 4. 동작 규칙

### 4.1 안전 기본값 (Hermes 대비)

[제안] 아래 기본값은 Hermes 기본값을 반대로 둔 것이다(`hermes.md` §4.3 첫 항목 "기본 무승인 자기 수정", `_research/ref-synthesis.md` 확장 지점 발견 5).

| 항목 | Hermes 기본 | 학습 그룹 기본 | Hermes 근거 위치 |
|---|---|---|---|
| 쓰기 승인 | 꺼짐. 스킬·메모리 쓰기가 승인 없이 디스크를 바꾼다 | 켬(`l3.learning.approval.required = true`). 모든 후보는 `pending`으로 시작한다 | `hermes.md` §3.10.1 (라) "쓰기 승인 게이트는 기본 OFF"(config_defaults.py:1333, 1497), (바) 첫 항목 |
| 에이전트 작성물 스캔 | 꺼짐(`guard_agent_created` false). 쓰기 뒤 스캔 | 켬(`l3.learning.scan.enabled = true`). 대기열 진입 전 사전 스캔과 L2-d 적용 안의 스캔 두 번 | `hermes.md` §3.10.1 (라) "스킬 보안 스캔은 옵트인"(skill_manager_tool.py:41-66, config_defaults.py:1488), `_research/notes/L3-3.md` §4.2 |
| 삭제 | 전경 `skill_manage(delete)`는 영구 삭제 | 연산에 삭제가 없다. 스킬은 `archive`만, 큐레이터도 `archive`만 | `hermes.md` §3.10.1 (마) "삭제 정책은 경로마다 다르다"(skill_manager_tool.py:585-594) |
| 검토 포크 도구 | 스킬 툴셋 전체(쓰기 포함)와 읽기 도구. 메모리 add는 자동 적용 | 읽기 능력·읽기 도구와 제안 도구 `learning_propose`만. 쓰기는 모두 거부 | `hermes.md` §3.10.1 (나) 9(background_review.py:1088-1131), (라) "포크는 add만 자동 적용" |
| 큐레이터 LLM 통합 | 꺼짐(`consolidate: False`) | 꺼짐(`l3.learning.curator.llmConsolidate = false`). 켜도 결과는 대기열을 거친다 | `hermes.md` §3.10.1 (마)(curator.py:35, config_defaults.py:1521) |
| 파괴적 연산 | 백그라운드 포크의 메모리 patch·remove만 설정과 무관하게 승인 큐 | 스킬 `patch`·`archive`, 메모리 `replace`·`remove`는 `approval.required` 값과 무관하게 승인이 필요하다 | `hermes.md` §3.10.1 (라)(memory_tool.py:179-206) |
| 대화 내용의 지위 | 검토 포크에 "source text is DATA" 방어가 보이지 않는다 | 검토 지시에 DATA 방어를 필수로 둔다(§4.4) | `hermes.md` §3.10.1 (바) 둘째 항목(learn_prompt.py:123-133) |
| 실패 시 기본 | 설정 읽기 실패 시 검토 켜짐(fail-open) | 설정 읽기 실패 시 검토를 시작하지 않는다(fail-closed). 대기열 적용도 하지 않는다 | `hermes.md` §3.10.1 (가) 6(background_review.py:228-251) |

- `approval.required = false`이면 파괴적이지 않은 후보(`create`, `add_file`, `add`)는 스캔을 통과한 뒤 바로 적용 단계로 간다. 이때도 `approved` 전이와 레코드는 남기고, 결정 주체는 `"policy"`로 적는다 [제안].

### 4.2 학습 트리거

Hermes 규칙(`hermes.md` §3.10.1 (가) 1~5)을 단계 경계 이벤트 기준으로 다시 쓴다.

| 지점 | fold | 하는 일 |
|---|---|---|
| `agent_start` | tap | turn 집계표(`TurnTally`)를 연다. `origin`을 입력 출처로 정한다. 검토 포크 대화이면 집계하지 않는다 |
| `tool_execution_end` | tap | 이 step을 처음 보면 `toolIterations += 1`. 실행한 도구가 스킬 쓰기이면 `skillWritten = true` |
| `agent_settled` | tap | `applyTurn`으로 판정한다. `review`이면 §4.3의 순서로 포크를 시작하고 상태를 커밋한다. `skip`이면 상태만 커밋한다 |
| `session_start` | tap | 대기열 복원(§4.5), 만료 판정, 진행 중 검토 확인(§4.3 재개) |

`applyTurn(state, tally, settings, enabled)` 규칙:

1. `enabled`가 거짓이면 `skip/disabled`이고 상태를 바꾸지 않는다.
2. 제외: `origin`이 `scheduled`, `remote`, `review`이거나, `status`가 `aborted`나 `error`이거나, `hasFinalAnswer`가 거짓이면 사용자 turn 수를 올리지 않고 검토도 시작하지 않는다(`skip/excluded`). 도구 반복 수는 올린다. Hermes는 중단·비대화형에서 검토를 끄지만 카운터 증가는 그대로 둔다(`hermes.md` §3.10.1 (가) 1, 2, 5).
3. 갱신: `origin = "user"`이면 `userTurnsSinceReview += 1`. `toolIterationsSinceSkillWrite += tally.toolIterations`. `tally.skillWritten`이면 `toolIterationsSinceSkillWrite = 0`(Hermes `tool_executor.py:744-747`).
4. 판정: `userTurnsSinceReview >= settings.userTurns`이면 `user_turns`, `toolIterationsSinceSkillWrite >= settings.toolIterations`이면 `tool_iterations`를 사유에 넣는다. 사유가 없으면 `skip/below_threshold`.
5. 검토: 사유가 하나 이상이면 `epoch' = epoch + 1`, `requestId = reviewRequestId(epoch')`. 다음 상태는 두 카운터 0, `lastReviewId = requestId`, `epoch = epoch'`다. 사유와 무관하게 두 카운터를 함께 0으로 둔다 [제안]. Hermes는 사유별로 따로 되돌리지만 검토 한 번이 두 신호를 모두 본다.

- 입력 출처 판정: [가정] `AgentStartPayload`나 turn 레코드에 입력 출처(사용자, 예약, 원격)가 있다. 없으면 L1.loop.spec에 필드 추가를 요청한다. 그 전까지는 모든 turn을 `user`로 본다.
- 검토 포크 대화 판정: [가정] `HandlerContext.threadId`가 학습 그룹이 시작한 자식 대화이면(`x_learning_reviews.child_thread_id`에 있음) 집계하지 않는다. 그룹 핸들러가 자식 대화에서도 발화하는지는 F에 규칙이 없다(`_research/notes/L3-1.md` §6 마지막 항목). 발화하지 않으면 이 검사는 쓰이지 않는다.
- 스킬 쓰기 판정: `ToolExecutionEndPayload`의 능력 필드(F.extensions.spec §7 "페이로드의 `capability` 필드")가 `knowledge.skills` 능력의 쓰기 메서드(`create`, `edit`, `patch`, `writeFile`, `remove`)이거나, 도구가 `learning_propose`이고 `kind = "skill"`이면 스킬 쓰기로 본다 [제안]. 제안만 하고 아직 적용하지 않은 경우도 포함한다. 방금 스킬을 다뤘다면 검토가 필요 없다는 Hermes의 이유가 같게 성립한다.
- step 중복 방지: [가정] `ToolExecutionEndPayload`에 `stepId`가 있다. 집계표는 센 `stepId` 집합을 가진다. 같은 step의 두 번째 도구, 또는 재생으로 다시 발화한 같은 지점은 다시 세지 않는다. `stepId`가 없으면 도구 실행 1회를 반복 1회로 센다.
- 커밋 빈도 [제안]: 상태 커밋은 turn당 1회(`agent_settled`)다. `agent_start`, `tool_execution_end`의 집계는 프로세스 메모리의 집계표에만 둔다. 집계표는 `turnId`로 구분하고 커밋 뒤 버린다. 크래시로 집계표를 잃으면 그 turn의 증가분만 잃는다. 결과는 검토가 한 turn 늦어지는 것뿐이므로 받아들인다.
- 임계는 설정 키 `l3.learning.trigger.userTurns`(기본 10), `l3.learning.trigger.toolIterations`(기본 10)로 바꾼다. 0은 그 사유를 끈다는 뜻이다 [제안].

### 4.3 검토 포크

시작 순서(`agent_settled` 핸들러, 판정이 `review`일 때):

1. 스냅샷 범위를 정한다: 부모 `threadId`와 이번 turn의 마지막 내구 이벤트 id.
2. 다른 그룹의 레코드는 읽지 않는다 [결정: review.decisions-2 D-10]. 검토 입력은 1의 스냅샷뿐이다.
3. `g.delegate(buildReviewSpec(...))`를 부르고 `reviewStartOutcome`으로 결과를 나눈다.
   - `{ ok: true, receipt: { status: "accepted" } }`: `grp.learning.fork.started`를 쓴다(쓰기 경로는 §3.7.1).
   - `{ ok: true, receipt: { status: "duplicate" } }`: 이미 시작한 검토이므로 이벤트를 다시 쓰지 않는다.
   - `{ ok: false, error }`: 위임을 만들지 못했다. 4를 하지 않고 핸들러를 끝낸다. 다음 turn에 같은 `epoch + 1`로 다시 시도한다(§5 사례 7). `group.delegateInvalid`는 프로그래머 오류이므로 진단으로 남긴다.
4. `g.commit(next)`로 카운터 0, `epoch`, `lastReviewId`를 커밋한다.

- 순서 근거: 3을 4보다 먼저 한다. 3과 4 사이에서 크래시가 나면 같은 지점이 다시 발화하고(F.extensions.spec §4.3), 커밋되지 않은 상태로 같은 `epoch + 1`을 계산하므로 같은 `requestId`가 나온다. L1-g는 `duplicate`를 돌려주고 4가 다시 실행된다. 4를 먼저 하면 크래시 뒤 카운터가 0이 되어 검토를 잃는다.
- on 핸들러 효과 규칙 [제안]: F.extensions.spec §4.3은 on 핸들러의 외부 효과를 `post`, `commit`, `record`로 제한한다. 학습 그룹은 여기에 "requestId 멱등 `g.delegate`"를 네 번째 허용 효과로 더하는 규칙을 요구한다. 근거는 `post`와 같은 성질(대화 범위 멱등 키, 두 번째 호출은 아무것도 만들지 않음)이다. 이 규칙이 F에 들어가지 않으면 대체안은 `agent_settled`에서 검토 요청 레코드만 커밋하고 L1-g 워커가 요청마다 한 번 위임을 시작하는 방식이다(`_research/notes/L3-1.md` §3.4). 확정은 §10 미결 2다.

포크 실행 속성:

| 속성 | 규칙 | 근거 |
|---|---|---|
| 스냅샷 | 부모 대화의 지정 범위를 L1-g가 구조적으로 복제한다. 포크는 부모 기록을 바꾸지 못한다 | `hermes.md` §3.10.1 (가) 6(turn_finalizer.py:96) |
| 도구 허용 | 실행 허용은 §3.4 `toolPolicy.allow`의 지식 읽기 도구, 작업 공간 읽기 도구, `learning_propose`뿐이다. 광고 도구 배열은 부모와 같게 두고 실행 시점에 거른다(`keepParentList: true`) | `hermes.md` §3.10.1 (나) 9 |
| 쓰기 거부 | 허용 밖 도구 호출은 실행하지 않고 도구 결과로 거부 사유를 돌려준다. 사유 문장에 "후보는 `learning_propose`로 제출한다"를 넣는다. 같은 검토에서 거부가 3회 이어지면 검토를 끝낸다 [제안]. Hermes 주석의 "거부 반복 시 루프 굶음" 사고를 막는다 | `hermes.md` §3.10.1 (나) 9 |
| 최대 반복 | `l3.learning.review.maxIterations`(기본 16) step. `DelegateSpec.limits.maxSteps`로 넘긴다 | `hermes.md` §3.10.1 (나) 10(background_review.py:173) |
| 토큰 예산 | 입력 토큰 합계 상한. 기본은 컨텍스트 창의 75%, 상한 600k, 창 크기를 모르면 120k [제안: Hermes 값을 기본으로]. `DelegateSpec.limits.maxInputTokens`로 넘긴다 | `hermes.md` §3.10.1 (나) 10(background_review.py:180-182) |
| 재귀 방지 | 포크 대화에서는 학습 트리거가 돌지 않는다(카운터 0과 같은 효과). `learning-review` 정의와 `toolPolicy.allow`에는 위임 도구가 없다 | `hermes.md` §3.10.1 (나) 11 |
| 사용량 귀속 | 포크의 토큰 사용량은 부모 세션 사용량에 합산한다. `grp.learning.fork.finished.usage`에도 남긴다 [가정: L1.agents.spec이 부모 귀속 집계를 제공] | `hermes.md` §3.10.1 (나) 11 |
| 캐시 접두 공유 | [가정] L1.agents.spec이 부모 이력 fork와 같은 모델·시스템 프롬프트·도구 배열 유지를 지원한다. 네 조건(모델, 도구 배열 순서 포함, 시스템 프롬프트, 메시지 접두)이 모두 같을 때만 공유된다. 그래서 검토 지시는 마지막 user 메시지로 넣고 시스템 프롬프트를 바꾸지 않는다. `review.model`이 부모와 다르면 공유를 기대하지 않는다 | `_research/notes/L3-1.md` §3.6, `hermes.md` §3.10.1 (나) 8 |
| 부모 중단 | 백그라운드 위임은 부모 abort가 전파되지 않는다. 학습 그룹은 부모 turn 중단과 무관하게 포크를 둔다. 명시 취소는 그룹 비활성화(§5 사례 5)와 `/learning review --cancel`뿐이다 | `_research/notes/L3-1.md` §3.7 |

완료 통지:

- 포크가 끝나면 학습 그룹은 결과(종료 상태, 사용량, 제출된 후보 id)를 받아 `grp.learning.fork.finished`와 `grp.learning.review.finished`를 쓴다.
- 완료 보고: group-kit `DelegateSpec.report`는 필수 필드다(L3.group-kit.spec §3.4). 그래서 L1-g는 자식 정착 뒤 부모 대화에 `PostItem{ kind: "context", customType: "grp.learning.review.result", display: false }`를 `when: "followUp"`, `requestId: "<requestId>:report"`로 넣는다(L1.agents.spec §3.2 `ReportDelivery`). `kind: "user"`는 쓰지 않는다. 사용자 발화처럼 대화에 섞이고 모델이 다음 turn에서 답하게 되기 때문이다(`_research/notes/L3-1.md` §3.3). `display: false`로 두고 사용자에게는 레코드와 L4 배지로 알린다 [제안]. 보고 항목이 다음 turn의 모델 입력에 들어가는 것을 막을지는 §10 미결 4다.
- 학습 그룹이 완료를 아는 수단: [가정] `GroupApi.delegate`가 완료 콜백이나 완료 이벤트를 준다. 없으면 `session_start`와 다음 `agent_settled`에서 `x_learning_reviews`의 미완료 행에 대해 L1-g 상태를 조회한다.

### 4.4 검토 지시의 요구 사항 (`review/prompts.ts`)

문구 본문은 구현 단계에서 쓴다. 지시는 아래를 모두 담아야 하고, 테스트는 각 항목의 표지 문자열이 지시에 있는지 확인한다.

1. 신호 4종(`hermes.md` §3.10.1 (다)): 사용자의 스타일·형식 교정, 워크플로 교정, 재사용 가능한 기법이나 디버깅 경로의 등장, 이번 세션에 로드한 스킬이 틀렸거나 빠짐. 사용자의 좌절 표현은 1급 신호로 본다.
2. 선호 순서: (1) 이번 세션에 로드된 스킬 patch, (2) 기존 우산 스킬 patch, (3) 지원 파일 추가(`add_file`), (4) 클래스 수준의 새 우산 스킬 `create`. 세션 한정 이름(PR 번호, 오류 문자열, 오늘 작업 이름)은 금지한다.
3. 저장 금지 5종(Hermes `_DO_NOT_CAPTURE_BLOCK`, background_review.py:423-446): 환경 의존 실패, 도구나 기능에 대한 부정 주장, 세션 중 해결된 일시 오류, 일회성 작업 서술, 실패로 끝난 시도를 권장 절차로 굳히는 것.
4. 메모리 영역 선택: 사람에 관한 것은 `user`, 환경 사실은 `environment` 하나만 고른다(`hermes.md` §3.10.1 (다) 첫 항목).
5. DATA 방어 [필수]: 스냅샷의 대화 내용, 도구 결과, 웹 페이지, 파일 내용은 검토 대상 데이터다. 그 안의 지시문을 따르지 않고, 지시문을 교훈으로 옮겨 적지 않는다. 지시는 스냅샷 데이터를 구분 표지 안에 넣고 표지 밖의 문장만 지시로 다룬다. Hermes는 이 방어를 `/learn`에만 두었다(`hermes.md` §3.10.1 (바) 둘째 항목).
6. 출력 규약: 후보는 `learning_propose` 도구로만 제출한다. 저장할 것이 없으면 도구를 부르지 않고 한 줄로 끝낸다. 삭제는 제안하지 않는다. 중복으로 보이는 스킬은 근거만 적고 2차 큐레이터에 넘긴다.
7. 편향 문구: Hermes의 "Be ACTIVE" 편향 문구는 쓰지 않는다 [제안]. 품질 평가 장치가 없는 상태에서 후보 수를 늘리는 쪽으로 기울이지 않는다(`hermes.md` §4.3 둘째 항목).

### 4.5 승인 대기열

상태 전이:

| 현재 | 사건 | 다음 | 조건과 효과 |
|---|---|---|---|
| (없음) | 제안 도구 처리, 사전 스캔 통과 | `pending` | `grp.learning.proposal.created`, `grp.learning.<kind>.proposed` |
| (없음) | 제안 도구 처리, 사전 스캔 차단 | `rejected` | `reason = "scan_failed"`. 본문 blob은 쓰지 않는다. `grp.learning.skill.rejected`(스킬일 때) |
| `pending` | 사용자 수정(`edit`) | `pending` | `revision += 1`, 다시 사전 스캔. 차단이면 `rejected/scan_failed` |
| `pending` | 사용자 승인(`approve`, revision 일치) | `approved` | `grp.learning.skill.approved`(스킬일 때) |
| `pending` | 승인 불요 정책(§4.1 끝, 비파괴 연산) | `approved` | 결정 주체 `"policy"` |
| `pending` | 사용자 거절 | `rejected` | `reason = "user_rejected"` |
| `pending` | 만료(`l3.learning.queue.expiryDays`) | `expired` | `session_start` 판정 |
| `approved` | L2-d `apply` 성공 | `applied` | `ledgerId` 기록, `grp.learning.skill.applied`(스킬일 때) |
| `approved` | L2-d `apply` 실패 `scan_failed` | `rejected` | `reason = "scan_failed"` |
| `approved` | L2-d `apply` 실패 `base_stale` | `pending` | `reason = "base_stale"`, 새 diff를 다시 계산해 보여 준다 |
| `approved` | L2-d `apply` 실패 `io` 등 | `approved` | 재시도 대상. 같은 `idempotencyKey`로 다시 부른다 |
| `applied` | 사용자 되돌림, L2-d `rollback` 성공 | `reverted` | `grp.learning.proposal.reverted` |
| `applied` | 되돌림 거부(`hash_mismatch`) | `applied` | `reason = "rollback_refused"`, 사용자에게 알림 |
| `rejected`, `expired`, `reverted` | 모든 사건 | 그대로 | 종료 상태 |

규칙:

1. 승인 전 불변 [UC-3]: `pending`, `rejected`, `expired` 상태의 후보는 L2-d 쓰기 API를 호출하지 않는다. 스킬 디렉터리와 메모리 파일은 바뀌지 않는다. 후보 본문은 세션 DB의 blob으로만 있다.
2. 적용은 L2-d 쓰기 API(`KnowledgeChangeApi.apply`)만 쓴다. 학습 그룹은 파일 시스템 도구나 `cap-workspace`로 스킬·메모리 파일을 쓰지 않는다. L2-d의 쓰기 승인, 스캔, 원장을 건너뛰는 옵션을 넘기지 않는다.
3. 적용 멱등: `idempotencyKey = "learning:apply:<proposalId>:<revision>"`. 결정 처리 중 크래시가 나면 `session_start`에서 `approved` 행을 다시 적용한다. L2-d가 같은 키에 첫 결과를 돌려준다 [가정].
4. 충돌 표시: 제안 대상과 같은 이름의 스킬이 있거나 L2-d 검색이 유사 스킬을 돌려주면 `conflictsWith`를 채우고 diff를 기존 본문 기준으로 만든다. 자동 병합은 하지 않는다. 병합 규칙은 §10 미결 5다.
5. 승인 중 원본 변경: 승인 시점과 적용 시점 사이에 원본이 바뀌면 L2-d가 `base_stale`을 돌려주고 후보는 `pending`으로 돌아간다(위 표). 사용자는 새 diff를 보고 다시 결정한다.
6. 결정 경로: 결정은 사용자 명령(§6.2) 처리기 안에서 한다. 명령 처리기는 on 핸들러가 아니므로 L2-d 호출을 직접 할 수 있다. 결정 이벤트를 먼저 커밋하고 적용을 부른다.
7. 대기열 복원: `session_start`에서 `x_learning_proposals`를 읽어 `approved`이고 `applied`가 아닌 행의 적용을 재시도하고, 만료 시각이 지난 `pending` 행을 `expired`로 바꾼다. 시각은 `session_start` 페이로드의 시각을 쓴다 [가정]. 핸들러 안에서 `Date.now`를 직접 읽지 않는다.

### 4.6 사전 스캔 (`proposals/scan.ts`)

1. 학습 그룹 자체 검사(항상): 크기 한도, 대상 이름 형식, 연산과 종류 조합(§3.6 `ProposalOpSchema` 주석), 파괴적 연산의 `baseHash` 존재.
2. L2-d 스캔(`l3.learning.scan.enabled`가 참이고 `knowledge.ledger`가 제공될 때. `knowledge.ledger.scan`): 비밀 패턴, 주입 패턴, 유출 패턴. `block` 결과가 하나라도 있으면 `rejected/scan_failed`다.
3. 스캔 규칙의 정본은 L2-d다. 학습 그룹은 결과만 쓴다. 스캔 결과의 `findings`는 `x_learning_proposals`에 규칙 이름만 남기고, 걸린 문자열은 남기지 않는다(비밀 재노출 방지).
4. `scan.enabled = false`여도 L2-d `apply` 안의 스캔은 L2-d 설정을 따른다. 학습 설정으로 L2-d 스캔을 끌 수 없다.

### 4.7 메타인지 피드백 (`feedback.ts`, M3)

- 신호: 사용자 교정(스타일·형식, 워크플로)과 좌절 표현. 검토 포크가 스냅샷에서 찾는다(§4.4 신호 4종).
- 후보: `kind: "feedback"`, `op: "add"`, `target: "user/work-style"` [제안]. 본문은 "작업 방식 규칙 한 문장 + 이유 한 절" 형식이다(`hermes.md` §3.10.1 (다) 저작 규칙).
- 적용: 승인되면 L2-d 메모리 `user` 영역에 항목으로 추가한다 [제안]. 별도 저장소를 만들지 않는다.
- 피드백 신호가 있어도 임계를 앞당기지 않는다(M3) [제안]. 신호 감지 비용을 주 대화에 더하지 않기 위해서다.
- `grp.learning.feedback.proposed` 레코드는 L4 표시용이다. 다른 그룹은 읽지 않는다 [결정: review.decisions-2 D-10].

### 4.8 2차 구성요소

M3 1차 범위 밖이다(`product/scope/spec.md` 4.5, `_research/layer-plan-v2.json` L3-c 단계 '2차'). 경계 조건만 정한다.

#### 4.8.1 큐레이터 (`curator/`)

- 실행 조건: `l3.learning.curator.enabled`가 참이고, 마지막 실행 뒤 `intervalHours`(기본 168)가 지났고, 마지막 사용자 활동 뒤 `minIdleHours`(기본 2)가 지났을 때. 처음 관측하면 `curatorLastRunAt`만 기록하고 한 간격 뒤에 첫 실행한다(`hermes.md` §3.10.1 (마), curator.py:160-182).
- 결정적 단계: 14일 미사용 스킬은 `stale` 표시, 30일 미사용 스킬은 `archive` 후보. 고정(pin)된 스킬과 예약 작업이 참조하는 스킬은 제외한다. 사용 0회 스킬은 생성 뒤 최소 14일 유예한다(curator.py:209-263).
- 대상: L2-d가 "에이전트 생성" 표시를 붙인 스킬만. 사용자가 만든 스킬, 번들 스킬은 대상이 아니다(skill_manager_tool.py:731-767, skill_usage.py:291-297).
- [제안] 결정적 단계의 `archive`도 `Proposal(kind: "skill", op: "archive")`로 대기열을 거친다. Hermes는 바로 옮긴다.
- LLM 통합: `l3.learning.curator.llmConsolidate`가 참일 때만 돈다. 검토 포크와 같은 위임 경로와 허용 목록을 쓰고, 결과는 대기열을 거친다. 실행 전 L2-d 백업을 요청한다 [가정: L2-d 백업 API](curator_backup.py:1-6).
- 트리거 수단: (a) `session_start` 뒤 지연 확인, (b) L2-h 예약(`cap-schedule`) 등록. §10 미결 6이다.

#### 4.8.2 학습 이력 (`history/`)

- `x_learning_proposals`와 L2-d 원장(`knowledge.ledger.list`·`show`)을 시간순으로 합쳐 보여 준다. 항목에서 되돌리기를 하면 §4.5 `revert` 경로를 쓴다(`hermes.md` §4.2 journey, learning_mutations).

#### 4.8.3 스크립트 제안 (`scripts/`)

- 같은 순서의 셸 명령 묶음이 서로 다른 turn에서 최소 3회 반복되면 [가정: 최소 반복 횟수] 검토 포크가 `kind: "script"`, `op: "create"` 후보를 만든다. 형태는 스크립트 파일 또는 슬래시 명령이다.
- 적용은 L2-d 쓰기 API를 쓴다. 스크립트를 실행하지 않는다.

### 4.9 Helm과의 공존

- 학습 그룹은 `drive`를 호출하지 않는다. 매니페스트 `usesDrive: false`이고 `validateUsage`가 `drive_undeclared`로 막는다.
- Helm이 임대를 가진 동안에도 on 핸들러와 `g.delegate`는 임대와 무관하게 동작한다(F.extensions.spec §4.6 "on, post, 백그라운드 위임은 여러 그룹이 함께 쓴다").
- Helm drive가 만든 turn(`loop.turn`)은 입력 출처가 `user`가 아니면 사용자 turn으로 세지 않는다 [제안]. 출처 표지는 §4.2의 [가정]을 따른다.

## 5. 실패와 경계 사례

| # | 사례 | 처리 |
|---|---|---|
| 1 | 포크 실패(모델 오류) 또는 취소 | `grp.learning.fork.finished{outcome: "error" \| "aborted"}`. 이미 제출된 후보는 그대로 둔다. 후보가 없으면 아무것도 대기열에 넣지 않는다. 카운터는 시작 때 이미 0이므로 다음 임계에서 다시 시도한다(UC-3 대안 흐름) |
| 2 | 포크가 예산이나 반복 상한에 걸림 | `outcome: "budget"`. 사례 1과 같게 처리한다 |
| 3 | 사전 스캔 또는 적용 스캔 실패(비밀 포함 등) | 후보는 `rejected/scan_failed`. 본문을 레코드와 로그에 남기지 않는다 |
| 4 | 승인과 적용 사이 원본 스킬 변경 | L2-d `base_stale` → `pending`으로 되돌림, 새 diff 표시(§4.5 규칙 5) |
| 5 | 학습 그룹 비활성화 중 포크 진행 | [제안] 비활성화 적용 때 `onDispose`에서 진행 중 포크에 취소를 요청한다. 취소 전에 제출된 후보는 `pending`으로 남는다. 다시 켜면 대기열을 그대로 보여 준다. 취소 경로는 L1.agents.spec이 정한다 [가정]. 완료까지 둘지 취소할지는 §10 미결 7 |
| 6 | 재개 뒤 같은 지점 재발화 | 같은 `requestId`로 `g.delegate` → `duplicate`. 포크는 하나만 있다(§4.3) |
| 7 | `agent_settled` 핸들러 안에서 `g.delegate`가 `{ ok: false }`를 돌려주거나 예외 | `{ ok: false }`(`group.delegateUnavailable`, `group.disabling`, `group.delegateFailed`, `group.delegateInvalid`)와 예외 모두 상태를 커밋하지 않는다. 예외는 tap 규칙대로 기록하고 계속한다. 다음 turn에 같은 `epoch + 1`로 다시 시도한다. 연속 3회 실패하면 `lastReviewId`에 실패를 남기고 카운터를 0으로 둔다 [제안] |
| 8 | 포크가 쓰기 도구를 부름 | 실행 거부, 거부 사유 반환(§4.3). 후보는 생기지 않는다 |
| 9 | 포크가 `baseHash` 없이 patch 제안 | `learning_propose`가 `base_missing`을 돌려준다. 후보 없음 |
| 10 | 분기로 이전 지점으로 되돌아감 | scope 상태가 그 지점 값으로 돌아간다. 같은 `epoch`가 다시 나와 `requestId`가 겹치면 `duplicate`로 포크를 시작하지 않는다. 대기열 행은 세션 단위이므로 분기와 무관하게 남는다 [제안] |
| 11 | 설정 읽기 실패 | 검토를 시작하지 않는다(fail-closed, §4.1). 대기열 적용도 미룬다 |
| 12 | L2-d 능력 미제공(`requires` 미충족) | 트리거와 포크를 시작하지 않는다. `/learning queue`는 "지식 저장소 없음"을 보여 준다. 로드 거부 여부는 X.loading-trust.spec이 정한다 |
| 13 | 같은 대상에 대한 두 후보가 동시에 `pending` | 둘 다 둔다. 하나가 `applied`가 되면 다른 하나는 다음 적용 때 `base_stale`로 `pending`에 머문다 |

## 6. 설정 노출

### 6.1 설정 키

F.wire-settings.spec §3.8의 `SettingDef`로 선언한다(`settings.ts`, `defineSettings("l3.learning", …)`). 키 접두는 내장 그룹 규칙 `l3.learning.`이다(F.wire-settings.spec §3.8.3 3번). 화면 탭은 모두 `plugins`다.

| 키 | 타입 | 기본 | 범위 | runtimeChange | allowedScopes | 위젯 |
|---|---|---|---|---|---|---|
| `l3.learning.trigger.userTurns` | integer | 10 | 0~1000 | `nextTurn` | user, project, session | number |
| `l3.learning.trigger.toolIterations` | integer | 10 | 0~1000 | `nextTurn` | user, project, session | number |
| `l3.learning.review.maxIterations` | integer | 16 [결정: review.decisions-2 U-22] | 1~64 | `nextTurn` | user, project | number |
| `l3.learning.review.tokenBudget` | integer \| null | `null`(자동: 창의 75%, 상한 600k, 미상 120k) | 1,000~2,000,000 | `nextTurn` | user, project | number |
| `l3.learning.review.model` | string \| null | `null`(부모 모델) | | `nextTurn` | user, project | select |
| `l3.learning.approval.required` | boolean | `true` | | `live` | user, project | toggle |
| `l3.learning.scan.enabled` | boolean | `true` | | `live` | user, project | toggle |
| `l3.learning.queue.expiryDays` | integer | 30 [제안] | 1~365 | `live` | user | number |
| `l3.learning.curator.enabled` | boolean | `false`(2차) | | `restart` | user | toggle |
| `l3.learning.curator.intervalHours` | integer | 168 | 1~8,760 | `live` | user | number |
| `l3.learning.curator.minIdleHours` | integer | 2 | 0~720 | `live` | user | number |
| `l3.learning.curator.llmConsolidate` | boolean | `false` | | `live` | user | toggle |

- `approval.required`와 `scan.enabled`를 `false`로 바꾸는 화면에는 경고 문구를 둔다(L4.settings-ui.spec) [제안]. 파괴적 연산은 이 값과 무관하게 승인이 필요하다는 설명을 `ui.help`에 넣는다.
- 학습 그룹 켜기·끄기 키는 X 로더 예약 키 `ext.learning.enabled` 하나다(F.extensions.spec §6, X.loading-trust.spec §4.5, F.wire-settings.spec §3.8.3). 내장 그룹도 같은 키를 쓰고 학습 그룹은 이 키를 `defineSettings`로 선언하지 않는다. 기본값은 매니페스트 `defaultEnabled`(§3.1)가 정한다. 값 속성은 X.loading-trust.spec §6 정의를 따른다: `runtimeChange` `live`(요청을 기록하고 적용은 다음 단계 경계), `allowedScopes` managed·user·project·local·session.
- `l3.learning.review.maxIterations` 기본 16은 pi 방식(기본 상한 없음)의 예외다 [결정: review.decisions-2 U-22]. 검토 포크는 사용자 입력 없이 실행되는 경로라 drive 임대 상한(U-12)과 같은 이유로 상한을 둔다.
- 설정 키 `l3.learning.queue.expiryDays`는 조정자 공통 목록에 없던 키다. 승인 피로 대응(L3.learning.plan §7)에 필요해서 더했다.

### 6.2 명령

| 명령 | 동작 | 차수 |
|---|---|---|
| `/learning queue [--json] [--status <s>]` | 대기열 목록(`ProposalView[]`) | 1차 |
| `/learning queue show <id>` | diff, 근거 이벤트, 사유 | 1차 |
| `/learning queue approve <id> [--revision <n>]` | 승인 → 적용 | 1차 |
| `/learning queue reject <id> [--note <text>]` | 거절 | 1차 |
| `/learning queue edit <id>` | 본문 편집기 열기 → `edit` 결정 | 1차 |
| `/learning queue revert <id>` | 원장 롤백 | 1차 |
| `/learning review [--cancel]` | 임계와 무관하게 지금 검토 시작(`requestId = learning:review:manual:<epoch+1>`) 또는 진행 중 검토 취소 | 1차 |
| `/learning history [--since <date>]` | 학습 이력 시간순 보기 | 2차 |

- 명령은 `g.registerCommand("learning", …)`로 등록한다(L3.group-kit.spec §3.2, X `hostOf(g).registerCommand`). CLI는 `xeon` 대화 입력에서, 데스크톱은 승인 화면 버튼에서 같은 명령을 부른다.

## 7. 확장 지점

| 연산 | 사용 | 내용 |
|---|---|---|
| `on` tap | 4개 | `agent_start`, `tool_execution_end`, `agent_settled`, `session_start`(§4.2) |
| `on` first | 없음 | 쓰기 거부는 L1 실행 검사(`DelegateSpec.toolPolicy`, §3.4)가 한다. 그룹의 `tool_call` 핸들러로 하지 않는다 [제안]. 그룹 핸들러가 어느 대화에 적용되는지 F에 규칙이 없기 때문이다 |
| `on` chain | 없음 | 시스템 프롬프트, 컨텍스트를 바꾸지 않는다(캐시 접두 보존) |
| `post` | 선택 | §4.3 완료 통지 경로가 `post(kind: "context")`로 정해지면 쓴다. 지금은 쓰지 않아도 되도록 둔다. 매니페스트는 `usesPost: true`로 선언한다 |
| `drive` | 쓰지 않음 | `usesDrive: false` |
| `scope` | 주 scope `learning` | 상태 `LearningState`(§3.2) |
| 위임 | `g.delegate` | 검토 포크(§4.3). F 4연산 밖이며 group-kit이 제공한다 |

## 8. 다른 문서와의 인터페이스

제공:

| 이름 | 쓰는 문서 |
|---|---|
| 레코드 8종 `grp.learning.*`와 payload 스키마(§3.7.3) | L4.desktop.spec(배지). 다른 그룹은 읽지 않는다 [결정: review.decisions-2 D-10] |
| `ProposalView`, `ProposalDecision`, `/learning` 명령 | L4.desktop.spec, L4.cli.spec |
| 설정 키 `l3.learning.*` | L4.settings-ui.spec |
| `grp.learning.proposal.*`, `grp.learning.fork.*` 비공개 기록, `x_learning_*` 투영 | 학습 그룹 내부. eng.context-map.design 5.1·5.2절 소유표 항목 |
| 서브에이전트 정의 이름 `learning-review`(정의 파일 `agents/learning-review.md`) | L1.agents.spec |

읽는 쪽 계약(L4 표시):

- 레코드는 본문을 싣지 않는다. 본문이 필요하면 `grp.learning.skill.applied.skillName`으로 `knowledge.skills.view`를 부른다.
- `proposed` 레코드는 승인 전 후보다. 읽는 쪽은 `proposed`만 보고 스킬이 존재한다고 가정하지 않는다. 존재가 확정된 것은 `applied`뿐이다.
- 같은 `proposalId`에 대해 `proposed` → (`approved` →) `applied` 또는 `rejected` 순서로 나온다. `approved`와 `applied`는 스킬 종류에만 있다. 메모리·피드백의 적용 여부는 L2-d 검색으로 확인한다.
- 레코드 `version`이 아는 값보다 크면 F.extensions.spec §5 사례 9를 따른다.

요구:

| 이름 | 출처 |
|---|---|
| `ExtensionManifest`, `defineManifest`, `ScopeApi`, `HandlerContext`, `RecordKindDecl`, `GroupRecord`, `RecordSubject`, 지점 페이로드 타입 | F.extensions.spec |
| `ThreadId`, `TurnId`, `EventId`, 단계 경계 정의, 도구 결과 3채널 | F.conversation.spec, F.records.spec |
| `CapabilityId`, `ServiceKey`, `ToolName` | F.capabilities.spec |
| `SettingDef`, `defineSettings` | F.wire-settings.spec |
| `defineGroup`, `GroupDef<S>`, `GroupApi<S>`(`settings()`, `delegate(spec)`, `metrics`, `registerTool`, `registerCommand`), `DelegateSpec`, `DelegateResult`. 비공개 기록 연산은 X `ScopeApi.recordPrivate`를 그대로 전달받는다(§3.7.1, review.decisions-2 T-21) | L3.group-kit.spec §3.2, §3.4 |
| 백그라운드 위임 접수·완료·취소(§3.3 `AgentService`), 스냅샷 복제(`ForkPoint`), 도구 정책(`ChildToolPolicy`), 상한(`ChildLimits`), `learning-review` 정의 적재(§4.9), 사용량 부모 귀속, 캐시 접두 공유 | L1.agents.spec |
| 실행 시점 도구 허용 검사와 거부 결과 | L1.tools.spec |
| `knowledge.*` 능력 ID, 서비스 키, `KnowledgeChangeApi` 대응 메서드, 스캔, 원장, 롤백, "에이전트 생성" 표시 | L2.knowledge.spec |
| 비공개 기록 연산 `ScopeApi.recordPrivate`(§3.7.1, review.decisions-2 T-21) | X.primitives.spec §4.6.5, F.extensions.spec §3.2 |
| 확장 kind 형식, 테이블 접두 규칙 | F.records.spec §3.2, eng.context-map.design 5.2절 |

## 9. 수용 기준

1. (UC-3) 카운터 임계를 넘는 테이프 세션을 실행하면 검토 포크가 백그라운드로 한 번 실행되고 후보가 대기열에 들어가며, 승인 전에는 스킬 디렉터리와 메모리 파일의 내용이 바뀌지 않는다.
2. (UC-3) Helm이 drive 임대를 가진 상태에서도 학습 그룹의 트리거와 검토 포크가 동작한다.
3. 사용자 turn이 `trigger.userTurns - 1`회이고 도구 반복이 `trigger.toolIterations - 1`회인 세션에서 `g.delegate` 호출은 0회다.
4. `pending`, `rejected`, `expired` 후보만 있는 상태에서 L2-d `apply` 호출은 0회이고, 스킬 디렉터리와 메모리 파일의 해시가 세션 전후로 같다.
5. 같은 `epoch`에 대해 `agent_settled`를 두 번 발화시키고(재생 모의) 프로세스를 재시작해도 L1-g가 만든 자식 대화는 1개다.
6. 학습 그룹이 켜진 모든 테스트에서 `drive` 호출은 0회다(`validateUsage` 기록과 X 호출 계측).
7. 검토 포크가 쓰기 도구(`write`, `edit`, `bash` 등)를 부르면 도구 결과에 거부 사유와 `learning_propose` 안내가 돌아오고, 그 호출로는 후보가 생기지 않는다. 후보는 `learning_propose` 호출로만 생긴다.
8. 중단된 turn, 예약 실행 turn, 검토 포크 대화의 turn은 `userTurnsSinceReview`를 올리지 않는다.
9. 스킬 쓰기가 있는 turn 뒤 `toolIterationsSinceSkillWrite`는 0이다.
10. 사전 스캔이 `block`을 돌려주면 후보 상태는 `rejected`이고 `reason`은 `scan_failed`이며 본문 문자열이 레코드와 투영에 없다.
11. `approval.required = false`여도 `patch`, `archive`, `replace`, `remove` 후보는 `pending`에 머문다.
12. 레코드 8종의 payload 예시가 각 스키마를 통과하고, `validateManifest`가 매니페스트를 오류 없이 통과한다.
13. 검토 지시에 신호 4종, 선호 순서, 저장 금지 5종, DATA 방어 표지 문자열이 모두 있다.
14. `/learning queue revert`는 L2-d `rollback`만 부르고, 성공하면 상태가 `reverted`다.
15. 비공개 기록 9종의 kind가 모두 `grp.learning.` 접두와 F `RECORD_KIND_PATTERN`(4마디)을 따르고, `learningProjector.kinds`와 §3.7.1 표가 같은 집합이다. 이 9종은 `learningRecordKindDecls`에 없고, `recordPrivate`로 쓴 행은 `visibility: "private"`로 커밋된다. 다른 그룹의 `readRecords`로 이 kind를 조회하면 0건이다(X.primitives.spec §9 29).
16. `diff`가 16 KiB를 넘는 제안을 만들고 프로세스를 재시작해 재생하면 `x_learning_proposals`의 `diff`가 원문과 같고, 승인된 제안의 재적용과 만료 판정 결과가 재시작 전과 같다.

## 10. 미결 사항

1. [결정: review.decisions-2 T-21] 비공개 기록 쓰기 경로. kind 형식은 F.records.spec §3.2의 `grp.<groupId>.<영역>.<이름>`이고, 공개 레코드는 `grp.learning.*`, 비공개 기록은 `grp.learning.proposal.*`·`grp.learning.fork.*`를 X `ScopeApi.recordPrivate(kind, payload)`로 쓴다(§3.7.1). 대체안(상태 색인 + 본문의 L2-d 대기열 통합)은 쓰지 않는다. eng.events.design·eng.context-map.design의 옛 밑줄 접두 예제와 정규식 정정은 그 문서 쪽 변경이다.
2. [미결] on 핸들러 외부 효과 금지(F.extensions.spec §4.3)와 검토 포크 시작의 관계. 이 문서는 "requestId 멱등 `g.delegate`만 on 핸들러에서 허용"하는 규칙을 제안한다(§4.3). F가 받아들이지 않으면 요청 레코드 + L1-g 워커 방식으로 바꾼다. 가장 큰 쟁점이다.
3. [미결] 패키지 `xeon.domain` 값. `group-kit/package.json`의 `xeon.domain`은 `kit`이고 `routes.yaml` layout 도메인 이름은 `group-kit`이다. 학습 그룹(`learning`)은 일치하지만 group-kit 쪽 값을 맞춰야 `docs-route`와 check-layers가 같은 이름을 쓴다.
4. [미결] 검토 완료 보고가 부모 대화의 모델 입력에 들어가는 것을 허용할지. group-kit `DelegateSpec.report`가 필수라 L1-g는 `kind: "context"`, `display: false` 항목을 넣는다(§4.3). 턴을 시작하지 않는 기록 모드를 둘지, 모델 입력에서 뺄지는 L1.agents.spec과 F.extensions.spec §4.4가 함께 정한다.
5. [미결] 기존 스킬과 충돌하는 후보의 병합 규칙. 지금은 diff 표시와 사용자 수정만 있다(§4.5 규칙 4).
6. [미결] 큐레이터 트리거 수단: `session_start` 뒤 지연 확인과 L2-h 예약 중 무엇을 쓸지(§4.8.1).
7. [미결] 그룹 비활성화 때 진행 중 검토 포크를 취소할지 완료까지 둘지(§5 사례 5).
8. [미결] 학습 그룹 기본 켬 여부(매니페스트 `defaultEnabled`). 승인 기본 켬으로 안전하지만 검토 한 번에 약 3만 토큰이 든다(`hermes.md` §3.10.1 (가) 5).
9. [미결] 제안 대기열의 소유. eng.context-map.design 4.1절은 L2-d의 `cap_knowledge_*`에 "제안 대기열"을 두고, 이 문서와 `layer-plan-v2.json` L3-c는 학습 그룹에 둔다(`_research/notes/L3-3.md` C2). 이 문서는 학습 그룹 소유로 썼다.
10. (닫힘) 도구 정책의 형태. L3.group-kit.spec §3.4 `DelegateToolPolicy`가 L1.agents.spec §3.2 `ChildToolPolicy`와 같이 허용·차단을 둘 다 받는다. 학습 그룹은 허용 목록을 쓴다(§3.4).
11. [미결] 서비스 키 체계. 능력 ID와 키 이름은 L2.knowledge.spec §1, §3.9가 정했다(`knowledge.skills` 등, `KnowledgeSkillsKey` 등). F의 능력 단위 `ServiceKey`와 eng.context-map.design의 `xeon.knowledge` 도메인 이름의 대응은 아직 남는다(`_research/notes/L3-3.md` C1, C3).
12. [미결] 그룹 on 핸들러가 자식 대화(검토 포크)에서도 발화하는지(§4.2).
