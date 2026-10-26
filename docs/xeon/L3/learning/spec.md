---
id: L3.learning.spec
layer: L3
domain: learning
kind: spec
status: draft
depends_on: [adr.0015, F.extensions.spec, F.records.spec, F.capabilities.spec, F.conversation.spec, F.wire-settings.spec, X.primitives.spec, L3.group-kit.spec, L2.knowledge.spec, L1.agents.spec, L1.tools.spec, L1.loop.spec, eng.events.design, eng.context-map.design, product.usecases.spec, review.m3-design-inputs]
binds: [xeon/packages/group-learning/**]
---

# L3 학습 그룹 (learning)

## 1. 목적과 범위

학습 그룹은 Hermes 자기 개선 루프(`_research/refs/hermes.md` §3.10.1)의 정책 부분을 L3 의도 그룹으로 옮긴다. 정책은 언제 검토할지, 무엇을 후보로 볼지, 후보를 어떤 절차로 반영할지를 뜻한다. 이 문서는 정책을 안전 기본값으로 정한다.

- [결정] 학습 그룹은 L3 기본 그룹이다. `drive`를 쓰지 않으므로 Helm과 함께 켤 수 있다(`_research/decisions-log.md` 2026-10-21 계획 v2, `_research/layer-plan-v2-notes.md` "Hermes 학습 루프를 별도 그룹으로", F.extensions.spec §4.6).
- [결정] 저장(스킬, 메모리, 세션 검색, 변경 원장)은 L2-d(L2.knowledge.spec, 패키지 `cap-knowledge`)가 소유한다. 학습 그룹은 정책만 가진다(eng.context-map.design 3절 협력 규칙 5).
- [결정] 검토 포크는 L1-g 백그라운드 위임(L1.agents.spec, 패키지 `core-agents`)으로 실행한다(eng.context-map.design 3절 협력 규칙 4, F.extensions.spec §4.6, `architecture/runtime-flow/design.md` §4.5).
- [결정: adr.0015] on 핸들러에서 `requestId` 멱등 `g.delegate`를 부를 수 있다. 검토 포크는 `agent_settled` 핸들러에서 바로 시작한다(§4.3). 재실행되는 코드의 효과 분류는 §4.10이다.

### 1.0 M3 설계 개정 (2026-10-26)

M3 설계 단계(사용자 결정 2026-10-25의 순서)에서 이 문서를 M3 구현 기준으로 고쳤다. 입력은 `review.m3-design-inputs` §4.2(L-IN-01~L-IN-19)와 §4.4 요구 목록, ADR-0015다. 바뀐 점:

- 재실행 효과 분류를 ADR-0015 표에 맞췄다(§4.10). on 핸들러는 능력 메서드를 부르지 않는다. 대기열 복원과 만료 판정은 재실행되지 않는 명령 경로로 옮겼고(§4.5 규칙 7), 지점 `session_start`는 쓰지 않는다.
- 검토 포크의 완료는 부모 대화의 내구 이벤트 `agent.settled`로 안다(§4.3). 보고 post는 부모 모델 입력에 넣지 않는 안을 기준으로 썼다 [미결 D-M3-03].
- 포크 지점을 `{ at: "item" }`으로 바꿨다. L1-g는 `{ at: "event" }`를 `agents.invalid_request`로 거부한다(L1.agents.spec §4.1 3번).
- 한 대화에서 동시에 도는 검토는 하나다(상태 `inFlightReviewId`, §4.2).
- Result 종류를 §3.9에 모았다. 예상 가능한 실패는 값으로 돌려준다(eng.typescript.guide TY-11).
- 사용자 결정이 필요한 항목은 `[미결 D-M3-NN]`으로 표시했다. 번호는 `review.m3-design-inputs` §3이다. 결정 전에는 각 항목의 권고안으로 설계를 적었다.

### 1.1 정하는 것

- 학습 트리거: 카운터 상태 `LearningState`, 카운터 갱신 규칙, 임계 판정 순수 함수
- 검토 포크: `g.delegate` 호출 형식, 도구 허용 범위, 반복·토큰 한도, 재귀 방지, 멱등 키, 검토 프롬프트의 요구 사항
- 승인 대기열: `Proposal` 타입, 상태 전이, 비공개 기록(`grp.learning.proposal.*`, `grp.learning.fork.*`)과 투영(`x_learning_*`), L2-d 적용 어댑터의 호출 규칙
- 메타인지 피드백 제안(`kind: "feedback"`)
- 공개 레코드 8종(`grp.learning.*`)의 payload 스키마와 읽는 쪽 계약
- 설정 키 `l3.learning.*`와 명령 `/learning queue|review|history`
- 2차 구성요소(큐레이터, 학습 이력, 스크립트 제안)의 경계 조건(§4.8)
- Result 종류(§3.9)와 재실행되는 코드의 효과 분류(§4.10, ADR-0015)
- F·X·L1·L2에 요구하는 인터페이스(§8.1)

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
  defaultEnabled: true,            // [미결 D-M3-02] 권고 a(기본 켬)
  usesDrive: false,
  usesPost: false,                 // [제안] 그룹은 post를 부르지 않는다. 완료 보고는 L1-g 코어 경로다(§7)
  points: ["agent_start", "turn_end", "agent_settled"],
  // 내구 이벤트 구독: 코어 kind "agent.settled"(§4.3 완료 통지). 선언 위치는 요구 REQ-LN-02(§8.1)
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
  /** 아직 agent.settled를 받지 못한 검토의 requestId. 없으면 null. 한 대화에 하나만 둔다(§4.2 규칙 0) [제안] */
  inFlightReviewId: Type.Union([Type.String({ maxLength: 48 }), Type.Null()]),
  /** 마지막으로 agent.settled를 받은 검토의 requestId. 없으면 null. 자식이 §4.3의 4번 커밋보다 먼저 정착한 경우를 4번이 알아보는 표지다 [제안] */
  settledReviewId: Type.Union([Type.String({ maxLength: 48 }), Type.Null()]),
  /** 연속 위임 실패 수(§5 사례 7). 위임 성공 때 0 */
  delegateFailures: Type.Integer({ minimum: 0 }),
  /** 2차 큐레이터: 마지막 실행 시각(epoch ms). 1차에서는 null 고정 */
  curatorLastRunAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
});
export type LearningState = Static<typeof LearningStateSchema>;

export const INITIAL_LEARNING_STATE: LearningState = {
  userTurnsSinceReview: 0,
  toolIterationsSinceSkillWrite: 0,
  lastReviewId: null,
  epoch: 0,
  inFlightReviewId: null,
  settledReviewId: null,
  delegateFailures: 0,
  curatorLastRunAt: null,
};

export const learningGroup = defineGroup<LearningState>({
  manifest,
  state: { schema: LearningStateSchema, initial: INITIAL_LEARNING_STATE, version: 1 },
  setup: (g: GroupApi<LearningState>) => {
    registerTriggers(g);      // triggers.ts: agent_start, turn_end, agent_settled
    registerSettledWatch(g);  // review/fork.ts: 코어 이벤트 agent.settled 구독, 검토 종료 기록(§4.3)
    registerProposeTool(g);   // review/policy.ts: g.registerTool로 learning_propose 도구
    registerCommands(g);      // commands.ts: g.registerCommand("learning", …). 대기열 복원·만료는 여기서(§4.5 규칙 7)
    g.onDispose(() => g.cancelDelegates("group_disabled"));   // [미결 D-M3-04] 권고 b(즉시 취소)
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

/**
 * turn 입력 출처. F TurnOrigin [제안](요구 REQ-LN-01). delegation은 위임 자식 대화의 turn,
 * drive는 drive 함수의 loop.turn이다
 */
export type TurnOrigin = "user" | "scheduled" | "remote" | "delegation" | "drive" | "other";

/** turn 하나 동안 핸들러가 모은 값. agent_settled에서 한 번 반영한다 */
export interface TurnTally {
  readonly turnId: TurnId;
  /** agent_settled 페이로드의 값(REQ-LN-01). 필드가 없는 동안은 "user"로 본다 */
  readonly origin: TurnOrigin;
  readonly status: "completed" | "aborted" | "error";
  readonly hasFinalAnswer: boolean;
  /** turn_end에서 센 값. 도구 결과가 하나 이상인 step 수 */
  readonly toolIterations: number;
  readonly skillWritten: boolean;
}

export type ReviewReason = "user_turns" | "tool_iterations";

export type TriggerSkipWhy = "excluded" | "below_threshold" | "disabled" | "in_flight";

export type TriggerDecision =
  | { readonly kind: "skip"; readonly next: LearningState; readonly why: TriggerSkipWhy }
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
  /** upToItemId: 이번 turn의 마지막 내구 item. agent_settled 페이로드의 lastItemId(REQ-LN-01) */
  readonly parent: { readonly threadId: ThreadId; readonly upToItemId: ItemId };
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

/** 코어 이벤트 agent.settled에서 학습 그룹이 읽는 필드(L1.agents.spec §3.5). 구독 핸들러 입력 */
export interface ReviewSettled {
  readonly requestId: string;
  readonly childThreadId: ThreadId;
  readonly status: "completed" | "aborted" | "error";
  /** L1-g의 상한 종료 표지. 없으면 status로만 나눈다 [가정] */
  readonly limitHit: "steps" | "tokens" | null;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number } | null;
}

/** 순수 함수. agent.settled를 검토 종료 결과로 바꾼다. 학습 그룹 검토가 아니면 ignore */
export function reviewFinishOutcome(state: LearningState, settled: ReviewSettled):
  | { readonly kind: "ignore" }
  | { readonly kind: "finished"; readonly next: LearningState; readonly outcome: "completed" | "aborted" | "error" | "budget" };
```

`buildReviewSpec`이 채우는 `DelegateSpec` 필드:

| 필드 | 값 | 근거 |
|---|---|---|
| `agent` | `"learning-review"` | §3.1 매니페스트 `components.agents`, L3.learning.plan §2 `agents/learning-review.md` |
| `task` | `review/prompts.ts`가 만든 검토 지시(§4.4) | |
| `requestId` | `learning:review:<epoch>` 또는 `learning:review:manual:<n>`. 1~48자 | L3.group-kit.spec §3.4(보고 키 `:report`를 붙여 64자 안) |
| `report` | 넣지 않는다 [미결 D-M3-03] 권고 a. b안으로 정해지면 `{ customType: "grp.learning.review.result", display: false, when: "next" }` | §4.3 완료 통지, 요구 REQ-LN-08(`report` 선택 필드) |
| `toolPolicy` | `{ allow: [...], keepParentList: true, denyHint }` | 아래 허용 목록, §4.3 |
| `limits` | `{ maxSteps: l3.learning.review.maxIterations, maxInputTokens: reviewTokenBudget(...) }` | §4.3 표, L1.agents.spec §3.2 `ChildLimits` |
| `model` | `l3.learning.review.model`. null이면 넣지 않는다(정의의 model) | §6.1 |
| `fork` | `{ at: "item", itemId: parent.upToItemId }` | §4.3 시작 순서 1, L1.agents.spec §3.2 `ForkPoint`. `at: "event"`는 L1-g가 `agents.invalid_request`로 거부한다(L1.agents.spec §4.1 3번) |

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
  | { readonly ok: false; readonly reason: ProposeRefusal; readonly hint: string };

/** 도구 결과로 돌려주는 거부 사유. 모델이 고쳐 다시 부를 수 있는 값이다 */
export type ProposeRefusal =
  | "base_missing" | "base_stale" | "op_not_allowed" | "invalid" | "limit"
  | "name_exists"       // create인데 같은 이름의 스킬이 있음. patch와 baseHash로 다시 제안하라는 안내(§4.5 규칙 4)
  | "unavailable";      // 지식 능력이 없거나 일시 실패. 후보 없음
```

- 도구는 `g.registerTool`로 등록한다(L3.group-kit.spec §3.2, X `hostOf(g).registerTool`, X.primitives.spec §4.8). 도구 결과 3채널 형식은 F.conversation.spec §3.6을 따른다.
- 이 도구는 파일을 바꾸지 않는다. 후보 행을 대기열에 넣는 것만 한다(§4.5).
- 같은 도구를 주 대화의 모델도 볼 수 있다. 캐시 접두를 위해 부모와 포크의 도구 배열을 같게 두기 때문이다(§4.3). 주 대화에서 부른 제안도 같은 대기열로 들어가고 같은 승인 규칙을 따른다 [제안].
- 읽기 선행 가드: `patch`, `replace`, `archive`, `remove`는 `baseHash`가 필수이고, 도구 실행 시점에 L2-d 읽기로 구한 현재 해시와 같아야 한다. 다르면 `base_stale`을 돌려준다. Hermes의 "패치 전 같은 검토 안에서 다시 읽기" 가드(`hermes.md` §3.10.1 (다), `tools/skill_manager_guards.py:211-221`)를 해시 비교로 옮긴 것이다 [제안].
- 한 검토에서 받을 후보 수 상한은 8개다 [제안]. 넘으면 `limit`.
- 대상 범위: 입력에 범위 필드가 없다. 도구로 만든 후보는 모두 사용자 범위(`user`) 스킬이다. 프로젝트 범위는 승인 화면에서 사용자가 고를 때만 쓴다 [미결 D-M3-09] 권고 c(§4.5 규칙 8).
- 신뢰 표지: 도구 실행 문맥의 `caller.afterUntrusted`(L2.knowledge.spec §4.6.3, 요구 REQ-LN-01)가 참이면 후보에 `afterUntrusted: true`를 적는다. 검토 포크는 부모 스냅샷을 복제하므로 부모가 웹·MCP 결과를 읽은 뒤면 참이다. 승인 화면은 이 후보에 경고를 보인다 [제안].
- 실행 문맥: 이 도구는 재실행되는 코드가 아니다. 도구 `execute` 안의 능력 호출(`knowledge.skills.view`, `knowledge.memory.read`, `knowledge.ledger.scan`, `knowledge.search.query`)은 ADR-0015 대상이 아니고 L1.tools의 효과 3단 커밋을 따른다(ADR-0015 §3.1 1번). 비공개 기록은 도구 호출 id를 디스패치 키로 쓴다(요구 REQ-LN-03, 쓰는 대화는 REQ-LN-04).

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
  /** 적용 범위. 스킬만 의미가 있다. 기본 user, 승인 때 사용자가 project로 바꿀 수 있다(§4.5 규칙 8) */
  scope: Type.Union([Type.Literal("user"), Type.Literal("project")]),
  /** 신뢰할 수 없는 입력(웹, MCP 결과)을 읽은 뒤 만든 후보(§3.5) */
  afterUntrusted: Type.Boolean(),
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
  | { readonly kind: "approve"; readonly proposalId: ProposalId; readonly revision: number; readonly scope?: "user" | "project" }
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
  /** 스킬 범위. project는 사용자가 승인 화면에서 고른 경우만(§4.5 규칙 8) */
  readonly scope: "user" | "project";
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
| `grp.learning.proposal.decided` | `{ id, revision, status: "approved" \| "rejected", reason, decidedAt, scope }` | 사용자 결정. `scope`는 승인 때 고른 범위(§4.5 규칙 8) |
| `grp.learning.proposal.applied` | `{ id, ledgerId, afterHash }` | L2-d 적용 성공 |
| `grp.learning.proposal.apply_failed` | `{ id, reason, nextStatus: "pending" \| "rejected" }` | L2-d 적용 실패 |
| `grp.learning.proposal.reverted` | `{ id, ledgerId }` | 원장 롤백 성공 |
| `grp.learning.proposal.expired` | `{ id, at }` | 만료 판정 |

- 쓰기 경로 [결정: review.decisions-2 T-21]: 비공개 기록은 X 연산 `ScopeApi.recordPrivate(kind, payload)`로 쓴다. 이 문서가 기대는 조건은 다음과 같다. (1) kind는 자기 접두 `grp.<name>.*`(플러그인은 `x.<name>.*`)만 받는다. (2) `readsRecordKinds`와 다른 그룹의 `readRecords`로 조회되지 않는다. (3) 큰 값(`Proposal.diff`, 제안 본문)은 blob으로 분리하고 이벤트에는 참조만 싣는다. (4) 멱등 키는 공개 `record`와 같은 규칙 `rec:<scope 해시>:<dispatchKey>:<n>`이고, 재실행된 같은 호출은 `replayed`다. (5) 이 kind들은 매니페스트 `recordKinds`(`learningRecordKindDecls`)에 선언하지 않는다. 공개 kind와 같은 이름, 영역 `state`, 다른 접두는 `record_private_invalid`로 거부된다. (6) 핸들러 안의 호출은 따로 커밋된다. 공개 `record`는 payload 상한 16 KiB이고 다른 그룹이 읽을 수 있는 kind라 이 용도에 쓰지 않는다. group-kit `GroupApi`는 이 연산을 그대로 전달한다(L3.group-kit.spec §3.2). 연산 정의는 X.primitives.spec §4.6.5다.
- 대체안(scope 상태 `commit`)의 한계: 상태 문서 상한은 64 KiB이고(L3.group-kit.spec §3.6) `Proposal.diff`는 최대 200,000자, 제안 본문은 최대 100,000자다. 그래서 대기열 전체를 상태에 둘 수 없다. 대체안을 쓰려면 상태에는 대기열 색인(`id`, `kind`, `op`, `target`, `status`, `revision`, `bodyHash`, `baseHash`, `reason`, `ledgerId`)만 두고 본문·diff는 상태 밖에 둬야 한다. 상태 밖 위치 후보는 L2-d 제안 대기열(`knowledge.ledger.proposals`, L2.knowledge.spec §4.5.2)과의 통합이고, 이는 대기열 소유(아래 항목)와 같은 결정이다. `recordPrivate`가 정해졌으므로(review.decisions-2 T-21) 이 문서는 대체안을 쓰지 않는다.
- 대기열 소유 [제안](L-IN-09. 다른 문서와의 맞춤은 §10 미결 8): 학습 후보는 이 그룹의 대기열(`x_learning_proposals`)에 두고, L2-d `cap_knowledge_proposals`(주 대화·하위 에이전트의 쓰기 대기)와 합치지 않는다. 이유는 셋이다. (1) 학습 후보는 근거 이벤트, 검토 id, 피드백 신호, 충돌 대상, 사용자 수정(`edit`)을 가지며 L2 `ProposalSchema`에 이 필드가 없다. (2) L2.knowledge.spec §4.5.2 마지막 항목이 이미 "자기 대기열을 가진 L3 그룹은 사람의 결정 뒤 증거와 함께 쓰기 메서드를 부른다"로 두 대기열을 전제한다. (3) 승인은 증거(`ApprovalEvidence`)로 한 번만 하므로 승인이 두 번 생기지 않는다(L-IN-16). 사용자에게는 한 화면으로 보인다. L4 승인 화면은 두 출처를 한 목록에 합치고 출처 열을 둔다(요구 REQ-LN-10). `review.m3-design-inputs` REQ-L2-02의 단일 대기열 제안과 다른 답이므로 L2.knowledge.spec §10 미결 3·22와 함께 확인한다.

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
| `x_learning_proposals` | `id`, `session_id`, `kind`, `op`, `target`, `status`, `reason`, `revision`, `body_hash`, `base_hash`, `diff`, `rationale`, `evidence_json`, `review_id`, `conflicts_with`, `destructive`, `scope`, `after_untrusted`, `ledger_id`, `created_at`, `updated_at` | `id` |
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
  readonly scope: Proposal["scope"];
  readonly afterUntrusted: boolean;
  /** L4 통합 목록의 출처 열(REQ-LN-10). 이 그룹의 행은 항상 "learning" */
  readonly source: "learning";
}
```

1. 목록: `/learning queue --json` 명령 결과(`readonly ProposalView[]`). [가정] 데스크톱은 명령 결과를 wire 명령 호출로 받는다. wire 메서드 이름은 F.wire-settings.spec과 L4.desktop.spec이 정한다.
2. 결정: `/learning queue approve|reject|edit|revert <id>` 명령(§6.2). 명령 인자는 `ProposalDecision`과 1:1이다.
3. 알림: `grp.learning.skill.proposed`, `grp.learning.memory.proposed`, `grp.learning.feedback.proposed`, `grp.learning.review.finished` 레코드가 생기면 L4가 배지를 갱신한다. [가정] L4는 세션 피드 구독으로 레코드 이벤트를 받는다. 검토 결과는 부모 대화의 모델 입력에 들어가지 않으므로 이 배지와 대기열이 사용자에게 보이는 유일한 경로다 [미결 D-M3-03] 권고 a. OS 알림은 내지 않는다 [제안]. 승인할 일이 급하지 않고 알림 피로를 늘리기 때문이다.
4. 범위 선택: 스킬 후보의 승인 단추 옆에 범위(사용자, 프로젝트) 선택을 둔다. 기본은 사용자다. 결정 명령은 `--scope project`로 같은 값을 넘긴다 [미결 D-M3-09] 권고 c.

### 3.9 Result 종류 (`results.ts`)

예상 가능한 실패는 판별 유니온 값으로 돌려준다. `throw`와 `Bug`는 프로그래머 오류(스키마 위반 상수, 불가능한 전이)에만 쓴다(eng.typescript.guide TY-11). 오류를 삼키는 `catch`를 두지 않는다. 핸들러 안에서 X 연산이 던지는 `PrimitiveError`는 잡지 않고 tap 규칙(기록 후 계속)에 맡긴다.

```ts
/** 대기열 결정·적용의 결과. 명령 처리기와 L4 화면이 받는다 */
export type DecisionResult =
  | { readonly ok: true; readonly proposal: ProposalView; readonly applied: boolean }
  | { readonly ok: false; readonly error: LearningError };

/** 적용 어댑터 결과를 대기열 전이로 바꾼 값. 순수 함수 applyOutcome(result)의 반환형 */
export type ApplyTransition =
  | { readonly kind: "applied"; readonly ledgerId: string; readonly afterHash: string }
  | { readonly kind: "rejected"; readonly reason: "scan_failed" | "apply_failed" }
  | { readonly kind: "backToPending"; readonly reason: "base_stale" }
  | { readonly kind: "retry"; readonly detail: string };          // io, 능력 일시 실패. approved 유지

/** 명령 진입 때의 지연 정리 결과(§4.5 규칙 7) */
export interface QueueSweep {
  readonly expired: readonly ProposalId[];
  readonly retried: readonly { readonly id: ProposalId; readonly transition: ApplyTransition }[];
}

export type LearningError =
  | { readonly kind: "learning.notFound"; readonly proposalId: string }
  | { readonly kind: "learning.revisionMismatch"; readonly proposalId: string; readonly current: number }
  | { readonly kind: "learning.closed"; readonly proposalId: string; readonly status: Proposal["status"] }
  | { readonly kind: "learning.scopeNotAllowed"; readonly proposalId: string }     // memory·feedback 후보에 project 범위
  | { readonly kind: "learning.knowledgeUnavailable" }                            // requires 미충족 또는 서비스 없음
  | { readonly kind: "learning.settingsUnavailable" }                             // fail-closed(§4.1)
  | { readonly kind: "learning.reviewBusy"; readonly requestId: string }          // /learning review 때 진행 중 검토 있음
  | { readonly kind: "learning.delegateFailed"; readonly cause: DelegateError };
```

| 결과 타입 | 만드는 곳 | 순수 여부 | 절 |
|---|---|---|---|
| `TriggerDecision` | `applyTurn` | 순수 | §3.3, §4.2 |
| `reviewStartOutcome` 반환형 | `DelegateResult` 분류 | 순수 | §3.4, §4.3 |
| `reviewFinishOutcome` 반환형 | `agent.settled` 분류 | 순수 | §3.4, §4.3 |
| `ProposeResult`, `ProposeRefusal` | `learning_propose` 실행 | 검사는 순수, 해시 조회는 능력 호출 | §3.5 |
| `ApplyTransition` | `KnowledgeChangeApi.apply`·`rollback` 결과 분류 | 순수 | §3.6, §4.5 |
| `QueueSweep` | 명령 진입 지연 정리 | 능력 호출 포함 | §4.5 규칙 7 |
| `DecisionResult`, `LearningError` | `/learning queue` 결정 명령 | 능력 호출 포함 | §4.5, §6.2 |

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
| `agent_start` | tap | 이 대화의 turn 집계표(`TurnTally`)를 `turnId`로 연다 |
| `turn_end` | chain(값을 바꾸지 않고 `undefined`를 돌려준다) | `toolResults`가 하나 이상이고 이 `stepId`를 처음 보면 `toolIterations += 1`. 도구 이름이 `skill_manage` 또는 `learning_propose`이면 `skillWritten = true` |
| `agent_settled` | tap | 페이로드의 `origin`, `status`, `hasFinalAnswer`로 집계표를 닫고 `applyTurn`으로 판정한다. `review`이면 §4.3의 순서로 포크를 시작하고 상태를 커밋한다. `skip`이면 상태만 커밋한다 |
| 내구 이벤트 `agent.settled` | 구독(REQ-LN-02) | `reviewFinishOutcome`으로 검토 종료를 기록하고 `inFlightReviewId`를 비운다(§4.3 완료 통지) |

- `tool_execution_end` 대신 `turn_end`를 쓴다 [제안]. `ToolExecutionEndPayload`에는 `stepId`가 없어 step 중복을 막을 수 없고(`xeon/packages/contracts/src/extensions/points/tool.ts`), `TurnEndPayload`는 `stepId`와 `toolResults`를 가진다(F.extensions.spec §3.4 `points/boundary.ts`). `turn_end`의 fold는 chain이지만 학습 핸들러는 값을 바꾸지 않으므로 다른 그룹의 결과와 캐시 접두에 영향이 없다.
- 스킬 쓰기 판정 [제안]: 도구 이름만 본다. `skill_manage`는 L2 스킬 쓰기 도구이고 모든 연산이 쓰기다(L2.knowledge.spec §3.6). `learning_propose`는 종류와 무관하게 스킬 작업으로 본다. 입력을 보지 않으므로 `tool_execution_end`의 `input` 필드(REQ-F-04)를 기다리지 않는다.
- `session_start`는 쓰지 않는다. 대기열 복원과 만료는 읽기가 필요해서 on 핸들러에 둘 수 없다(ADR-0015 §3.2, `review.m3-design-inputs` D-M3-31 행 8). §4.5 규칙 7의 명령 경로로 옮겼다.

`applyTurn(state, tally, settings, enabled)` 규칙:

0. 진행 중 검토 [제안]: `state.inFlightReviewId`가 null이 아니면 3의 카운터 갱신만 하고 검토를 시작하지 않는다(`skip/in_flight`). 한 대화에서 검토 포크는 하나만 돈다. 위임 상한 귀속(REQ-L1-03)이 정해지기 전에도 학습 그룹이 만드는 백그라운드 자식 수가 대화당 1로 묶인다.
1. `enabled`가 거짓이면 `skip/disabled`이고 상태를 바꾸지 않는다.
2. 제외: `origin`이 `scheduled`, `remote`, `delegation`, `drive`, `other`이거나, `status`가 `aborted`나 `error`이거나, `hasFinalAnswer`가 거짓이면 사용자 turn 수를 올리지 않고 검토도 시작하지 않는다(`skip/excluded`). 도구 반복 수는 올린다. Hermes는 중단·비대화형에서 검토를 끄지만 카운터 증가는 그대로 둔다(`hermes.md` §3.10.1 (가) 1, 2, 5).
3. 갱신: `origin = "user"`이면 `userTurnsSinceReview += 1`. `toolIterationsSinceSkillWrite += tally.toolIterations`. `tally.skillWritten`이면 `toolIterationsSinceSkillWrite = 0`(Hermes `tool_executor.py:744-747`).
4. 판정: `userTurnsSinceReview >= settings.userTurns`이면 `user_turns`, `toolIterationsSinceSkillWrite >= settings.toolIterations`이면 `tool_iterations`를 사유에 넣는다. 사유가 없으면 `skip/below_threshold`.
5. 검토: 사유가 하나 이상이면 `epoch' = epoch + 1`, `requestId = reviewRequestId(epoch')`. 다음 상태는 두 카운터 0, `lastReviewId = requestId`, `inFlightReviewId = requestId`, `delegateFailures = 0`, `epoch = epoch'`다. 사유와 무관하게 두 카운터를 함께 0으로 둔다 [제안]. Hermes는 사유별로 따로 되돌리지만 검토 한 번이 두 신호를 모두 본다.

- 입력 출처 판정: `AgentSettledPayload`에 `origin`, `status`, `hasFinalAnswer`, `lastItemId`를 더하도록 요구한다(REQ-LN-01, `review.m3-design-inputs` REQ-F-06). 지금 페이로드는 `{ turnId, aborted }`뿐이다(F.extensions.spec §3.4). 필드가 들어오기 전 임시 규칙: `origin`은 `user`, `status`는 `aborted`면 `aborted` 아니면 `completed`, `hasFinalAnswer`는 참으로 본다. `lastItemId`가 없으면 검토를 시작하지 않는다(포크 지점을 정할 수 없다).
- 검토 포크 대화 판정: 위임 자식 대화의 turn은 `origin = "delegation"`이라 규칙 2로 제외된다. 그룹 핸들러가 자식 대화에서도 발화하는지(REQ-L1-04)와 무관하게 성립한다. 재귀 방지는 이 규칙과 `toolPolicy`(위임 도구 없음) 두 겹이다.
- Helm drive가 연 turn(`origin = "drive"`)은 사용자 turn으로 세지 않는다(§4.9).
- step 중복 방지: 집계표는 센 `stepId` 집합을 가진다. 재생으로 다시 발화한 같은 `turn_end`는 다시 세지 않는다.
- 커밋 빈도 [제안]: 상태 커밋은 turn당 1회(`agent_settled`)다. 예외로 `agent.settled` 구독 핸들러가 검토당 1회 커밋한다(§4.3). `agent_start`, `turn_end`의 집계는 프로세스 메모리의 집계표에만 둔다. 집계표는 효과가 아니므로 ADR-0015 표의 대상이 아니다. 집계표 값은 `requestId` 재료로 쓰지 않는다(ADR-0015 §3.4 2번). 집계표는 `turnId`로 구분하고 커밋 뒤 버린다. 크래시로 집계표를 잃으면 그 turn의 증가분만 잃는다. 결과는 검토가 한 turn 늦어지는 것뿐이므로 받아들인다.
- 임계는 설정 키 `l3.learning.trigger.userTurns`(기본 10), `l3.learning.trigger.toolIterations`(기본 10)로 바꾼다. 0은 그 사유를 끈다는 뜻이다 [제안].

### 4.3 검토 포크

시작 순서(`agent_settled` 핸들러, 판정이 `review`일 때):

1. 스냅샷 범위를 정한다: 부모 `threadId`와 이번 turn의 마지막 내구 item id(`AgentSettledPayload.lastItemId`, REQ-LN-01).
2. 다른 그룹의 레코드는 읽지 않는다 [결정: review.decisions-2 D-10]. 검토 입력은 1의 스냅샷뿐이다.
3. `g.delegate(buildReviewSpec(...))`를 부르고 `reviewStartOutcome`으로 결과를 나눈다.
   - `{ ok: true, receipt: { status: "accepted" } }`: `grp.learning.fork.started`를 쓴다(쓰기 경로는 §3.7.1).
   - `{ ok: true, receipt: { status: "duplicate" } }`: 이미 시작한 검토이므로 이벤트를 다시 쓰지 않는다.
   - `{ ok: false, error }`: 위임을 만들지 못했다. `next` 대신 카운터만 갱신하고 `delegateFailures += 1`인 상태를 커밋한다(`epoch`, `inFlightReviewId`는 그대로). 다음 turn에 같은 `epoch + 1`로 다시 시도한다(§5 사례 7). `group.delegateInvalid`는 프로그래머 오류이므로 진단으로 남긴다.
4. 커밋 직전에 `g.state()`를 다시 읽는다. `settledReviewId`가 이 `requestId`와 같으면 자식이 이미 정착한 것이므로 `inFlightReviewId = null`로, 아니면 `inFlightReviewId = requestId`로 두고 `g.commit(next)`로 카운터 0, `epoch`, `lastReviewId`, `inFlightReviewId`를 커밋한다.

- 순서 근거: 3을 4보다 먼저 한다. 3과 4 사이에서 크래시가 나면 같은 지점이 다시 발화하고(F.extensions.spec §4.3), 커밋되지 않은 상태로 같은 `epoch + 1`을 계산하므로 같은 `requestId`가 나온다. L1-g는 `duplicate`를 돌려주고 4가 다시 실행된다. 4를 먼저 하면 크래시 뒤 카운터가 0이 되어 검토를 잃는다.
- 선후 경합 [제안]: 3과 4 사이에 자식이 정착해 `agent.settled` 구독 핸들러가 4보다 먼저 돌 수 있다(예: 즉시 오류). 이때 구독 핸들러는 `inFlightReviewId`가 아직 비어 있어 비울 대상이 없다. 그래서 구독 핸들러는 항상 `settledReviewId`를 커밋하고(아래 처리 2번), 4는 위처럼 `settledReviewId`를 보고 `inFlightReviewId`를 세우지 않는다. 이 규칙이 없으면 4가 이미 끝난 검토의 `inFlightReviewId`를 세워 `/learning` 명령을 부르기 전까지 새 검토가 시작되지 않는다.
- on 핸들러 효과 규칙 [결정: adr.0015]: on 핸들러에서 `requestId` 멱등 `g.delegate`를 부를 수 있다. 코어(L1-g)가 (부모 대화, `requestId`) 멱등을 보장하고, 그 기억은 재시작 뒤에도 남아야 한다(REQ-L1-01). 키 `learning:review:<epoch>`는 커밋된 상태의 `epoch`에서 만들므로 결정적이다(ADR-0015 §3.4). 옛 대체안(검토 요청 레코드 + L1-g 워커)은 쓰지 않는다. 학습 그룹의 재실행 효과 전체는 §4.10 표다.
- 수동 검토 `/learning review`는 명령 처리기(재실행되지 않는 코드)에서 같은 순서를 밟는다. 키는 `learning:review:manual:<epoch+1>`이고, `inFlightReviewId`가 있으면 `learning.reviewBusy`를 돌려준다.

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
| 동시 실행 | 대화당 하나(`inFlightReviewId`, §4.2 규칙 0). 프로세스 전체 상한은 L1-g 백그라운드 풀이 정한다(REQ-L1-03) | [제안] |

완료 통지:

- 수단 [제안]: 학습 그룹은 부모 대화의 코어 내구 이벤트 `agent.settled`(L1.agents.spec §3.5)를 구독한다. L1-g는 백그라운드 자식이 정착하면(완료, 취소, 오류, 상한) 이 이벤트를 부모 대화에 커밋한다. 구독 핸들러는 `requestId`가 `learning:review:`로 시작하고 위임 주체가 이 scope인 이벤트만 받는다(REQ-LN-02). 구독 핸들러도 재실행되는 코드라 효과는 §4.10 표를 따른다.
- 처리: `reviewFinishOutcome(state, settled)`가 `finished`이면 (1) `grp.learning.fork.finished`(`recordPrivate`), (2) `grp.learning.review.finished`(`record`), (3) 커밋 순서로 쓴다. 3번 커밋은 `settledReviewId = requestId`를 항상 두고, `requestId`가 `inFlightReviewId`와 같으면 `inFlightReviewId = null`도 함께 둔다. 세 쓰기 모두 디스패치 키(구독한 이벤트 id) 기반 멱등 키라 재실행돼도 한 번이다. `requestId`가 `inFlightReviewId`와 다르면(비어 있거나 분기로 되돌아감) 기록과 `settledReviewId` 커밋만 하고 `inFlightReviewId`는 바꾸지 않는다. 이 구독 커밋은 §4.2 커밋 빈도 규칙의 예외다.
- `outcome`: `status = completed`이면 `completed`, `aborted`이면 `aborted`, `error`이면 `error`, `limitHit`이 있으면 `budget`이다. 제출된 후보 id는 이 검토 id(`reviewId`)를 가진 `grp.learning.proposal.created` 기록에서 투영이 모은다. 핸들러는 읽지 않는다.
- 사용량: `agent.settled.usage`를 `grp.learning.fork.finished.usage`와 `x_learning_reviews`에 남긴다. 부모 합계에 더하는 일은 화면이 한다(L1.agents.spec §3.5 사용량 귀속 [제안]).
- 완료 보고 post [미결 D-M3-03] 권고 a: `DelegateSpec.report`를 넣지 않는다. L1-g는 `agent.settled`만 커밋하고 보고 입력(`input.queued`)을 만들지 않는다. 검토 결과는 부모 대화의 모델 입력에 들어가지 않는다. 프롬프트 캐시를 깨지 않고 토큰을 늘리지 않는다. 이를 위해 group-kit `DelegateSpec.report`와 L1 `DelegateRequest.report`를 선택 필드로 바꾸도록 요구한다(REQ-LN-08, REQ-L1-05).
  - b안으로 정해지면: `report: { customType: "grp.learning.review.result", display: false, when: "next" }`를 넣는다. `next`는 turn을 시작하지 않는다(ADR-0013). 보고 본문은 다음 사용자 turn의 모델 입력에 들어간다. 나머지 규칙은 같다.
  - `kind: "user"`는 어느 안에서도 쓰지 않는다. 사용자 발화처럼 대화에 섞이기 때문이다(`_research/notes/L3-1.md` §3.3).
- 구독이 없을 때의 대체 [제안]: REQ-LN-02가 늦어지면 `/learning` 명령 진입 때(§4.5 규칙 7) `g.delegateStatus(inFlightReviewId)`(REQ-LN-08, L1 `AgentService.status`)로 상태를 조회하고, `settled`이면 구독 핸들러와 같은 기록을 명령 처리기에서 쓴다. 이 경로에서는 다음 명령 전까지 `inFlightReviewId`가 남아 새 검토가 늦어진다.

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
| `pending` | 만료(`l3.learning.queue.expiryDays`) | `expired` | 명령 진입 지연 정리(규칙 7) |
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
3. 적용 멱등: `idempotencyKey = "learning:apply:<proposalId>:<revision>"`. 결정 처리 중 크래시가 나면 다음 명령 진입 때(규칙 7) `approved` 행을 다시 적용한다. L2-d가 같은 키에 첫 결과를 돌려준다. 이 보장은 L2 쓰기 메서드의 `idempotent: true` 선언과 적합성 시험으로 확인한다(REQ-LN-09, ADR-0015 §6 [가정]).
4. 충돌 처리 [제안](L-IN-08, 옛 §10 미결 5를 닫는다):
   - 같은 이름: `create`인데 같은 이름의 스킬이 있으면 `learning_propose`가 `name_exists`를 돌려준다. 모델은 `knowledge.skills.view`로 읽고 `patch`와 `baseHash`로 다시 제안한다. 같은 이름의 후보가 대기열에 둘 생기지 않는다.
   - 유사 스킬: L2-d 검색이 유사 스킬을 돌려주면 `conflictsWith`를 채운다. 후보는 그대로 두고 승인 화면이 두 스킬을 나란히 보인다.
   - 자동 병합은 하지 않는다. 사용자가 고르는 길은 셋이다: 승인(새 스킬로 둠), 거절, 수정(`edit`)으로 기존 스킬의 `patch` 후보로 바꿈. 두 스킬을 합치는 일은 2차 큐레이터의 LLM 통합 몫이다(§4.8.1).
5. 승인 중 원본 변경: 승인 시점과 적용 시점 사이에 원본이 바뀌면 L2-d가 `base_stale`을 돌려주고 후보는 `pending`으로 돌아간다(위 표). 사용자는 새 diff를 보고 다시 결정한다.
6. 결정 경로: 결정은 사용자 명령(§6.2) 처리기 안에서 한다. 명령 처리기는 재실행되는 코드가 아니므로 ADR-0015 표의 대상이 아니고 L2-d 호출을 직접 할 수 있다. 결정 이벤트(`grp.learning.proposal.decided`)를 먼저 커밋하고 적용을 부른다. 적용 호출은 `ApprovalEvidence{ source: "learning.queue", proposalId, revision, decidedAt }`를 싣는다. L2-d는 이 증거를 믿을 때 자기 승인 요청을 내지 않으므로 승인이 한 번이다(L-IN-16). 증거를 믿는 조건(`l2.knowledge.write.trustedEvidenceSources`에 `learning.queue`가 있음)은 요구 REQ-LN-09다. 믿지 않으면 L2-d가 승인 요청을 한 번 더 내고, 학습 그룹은 그 결과를 `approval_required`로 받아 `approved`에 둔다.
7. 지연 정리 [제안]: `/learning` 명령 처리기는 진입 때마다 먼저 `sweepQueue`를 돌린다. (1) `approved`이고 `applied`가 아닌 행의 적용을 같은 `idempotencyKey`로 다시 부른다. (2) 만료 시각이 지난 `pending` 행을 `expired`로 바꾼다. (3) `inFlightReviewId`가 있고 구독 경로가 없으면 §4.3 대체 조회를 한다. 시각은 명령 문맥의 주입 시계를 쓴다. L4 승인 화면은 목록을 `/learning queue --json`으로 받으므로 화면을 열 때도 정리가 돈다. 옛 `session_start` 복원은 on 핸들러 안의 읽기와 능력 쓰기라 ADR-0015 §3.2에서 허용되지 않는다(능력 쓰기는 `idempotent: true` 선언이 있으면 허용되지만 대상 행을 고르는 읽기가 막힌다). `approved` 미적용 행은 결정 명령 도중 프로세스가 끝날 때만 생기므로 다음 명령까지 미뤄도 사용자가 보는 상태와 어긋나지 않는다.
8. 범위 선택 [미결 D-M3-09] 권고 c: 스킬 후보의 기본 범위는 `user`다. `approve`에 `scope: "project"`가 있으면 적용 어댑터가 `KnowledgeChange.scope = "project"`로 부른다. 메모리·피드백 후보에 `project`를 주면 `learning.scopeNotAllowed`다. 모델 도구 경로(`learning_propose`, `skill_manage`)는 프로젝트 범위를 고를 수 없다. a안으로 정해지면 범위 선택을 빼고 `user`로 고정한다. b안이면 도구 입력에 범위를 더하고 승인 화면이 그 값을 보인다.

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

M3 1차 범위 밖이고 M4 이후에 둔다(`product/scope/spec.md` 4.5, `_research/layer-plan-v2.json` L3-c 단계 '2차', `review.m3-design-inputs` L-IN-18). 경계 조건만 정한다.

#### 4.8.1 큐레이터 (`curator/`)

- 실행 조건: `l3.learning.curator.enabled`가 참이고, 마지막 실행 뒤 `intervalHours`(기본 168)가 지났고, 마지막 사용자 활동 뒤 `minIdleHours`(기본 2)가 지났을 때. 처음 관측하면 `curatorLastRunAt`만 기록하고 한 간격 뒤에 첫 실행한다(`hermes.md` §3.10.1 (마), curator.py:160-182).
- 결정적 단계: 14일 미사용 스킬은 `stale` 표시, 30일 미사용 스킬은 `archive` 후보. 고정(pin)된 스킬과 예약 작업이 참조하는 스킬은 제외한다. 사용 0회 스킬은 생성 뒤 최소 14일 유예한다(curator.py:209-263).
- 대상: L2-d가 "에이전트 생성" 표시를 붙인 스킬만. 사용자가 만든 스킬, 번들 스킬은 대상이 아니다(skill_manager_tool.py:731-767, skill_usage.py:291-297).
- [제안] 결정적 단계의 `archive`도 `Proposal(kind: "skill", op: "archive")`로 대기열을 거친다. Hermes는 바로 옮긴다.
- LLM 통합: `l3.learning.curator.llmConsolidate`가 참일 때만 돈다. 검토 포크와 같은 위임 경로와 허용 목록을 쓰고, 결과는 대기열을 거친다. 실행 전 L2-d 백업을 요청한다 [가정: L2-d 백업 API](curator_backup.py:1-6).
- 트리거 수단: (a) 명령 진입 지연 확인, (b) L2-h 예약(`cap-schedule`) 등록. 2차라 M4 이후에 정한다(L-IN-18, §10).

#### 4.8.2 학습 이력 (`history/`)

- `x_learning_proposals`와 L2-d 원장(`knowledge.ledger.list`·`show`)을 시간순으로 합쳐 보여 준다. 항목에서 되돌리기를 하면 §4.5 `revert` 경로를 쓴다(`hermes.md` §4.2 journey, learning_mutations).

#### 4.8.3 스크립트 제안 (`scripts/`)

- 같은 순서의 셸 명령 묶음이 서로 다른 turn에서 최소 3회 반복되면 [가정: 최소 반복 횟수] 검토 포크가 `kind: "script"`, `op: "create"` 후보를 만든다. 형태는 스크립트 파일 또는 슬래시 명령이다.
- 적용은 L2-d 쓰기 API를 쓴다. 스크립트를 실행하지 않는다.

### 4.9 Helm과의 공존

- 학습 그룹은 `drive`를 호출하지 않는다. 매니페스트 `usesDrive: false`이고 `validateUsage`가 `drive_undeclared`로 막는다.
- Helm이 임대를 가진 동안에도 on 핸들러와 `g.delegate`는 임대와 무관하게 동작한다(F.extensions.spec §4.6 "on, post, 백그라운드 위임은 여러 그룹이 함께 쓴다").
- Helm drive가 만든 turn(`loop.turn`)은 `origin = "drive"`라 사용자 turn으로 세지 않는다 [제안]. 도구 반복 수는 센다. 출처 표지는 REQ-LN-01이다.
- Helm의 유휴 자율 turn [미결 D-M3-06]이 허용되어도 같은 규칙이다. 자율 turn만 이어지는 동안 사용자 turn 사유로는 검토가 시작되지 않는다.
- 안전 모드 [미결 D-M3-07] 권고 a: 안전 모드에서는 X 로더가 학습 그룹을 싣지 않는다. 대기열은 남고, 다시 켜면 그대로 보인다. 진행 중이던 검토는 §5 사례 5와 같게 처리한다.

### 4.10 재실행되는 코드의 효과 (ADR-0015)

학습 그룹에서 재실행되는 코드는 on 핸들러 세 개(`agent_start`, `turn_end`, `agent_settled`)와 `agent.settled` 구독 핸들러다. drive 함수는 없다. 각 코드가 내는 효과와 ADR-0015 §3.2 표의 근거:

| 코드 | 효과 | ADR-0015 분류 | 멱등 근거 |
|---|---|---|---|
| `agent_start` | 없음(메모리 집계표) | 해당 없음 | 효과가 아니다 |
| `turn_end` | 없음(메모리 집계표). 반환 `undefined` | 해당 없음 | `stepId` 집합으로 중복 계수를 막는다 |
| `agent_settled` | `g.delegate(spec)` | `g.delegate`: on 핸들러 허용 | 코어(L1-g)의 (부모 대화, `learning:review:<epoch>`) 멱등. 재시작 뒤에도 유지(REQ-L1-01) |
| `agent_settled` | `g.recordPrivate("grp.learning.fork.started", …)` | `recordPrivate` 허용 | X 커밋 키 `rec:<scope 해시>:<dispatchKey>:<n>` |
| `agent_settled` | `g.commit(next)` | `commit` 허용 | X 상태 커밋 멱등 키(재실행은 `replayed`) |
| `agent.settled` 구독 | `recordPrivate`(`fork.finished`), `record`(`review.finished`), `commit` | 모두 허용 | 디스패치 키(구독한 이벤트 id) 기반 커밋 키 |

- 능력 메서드: on 핸들러는 능력 메서드를 부르지 않는다. 읽기도 부르지 않는다(ADR-0015 §3.2 [제안], `review.m3-design-inputs` D-M3-31 행 8). 능력 호출은 도구 `execute`(§3.5)와 명령 처리기(§4.5)에만 있다.
- 선언 없는 쓰기: 없다. 요청 레코드와 워커(ADR-0015 §3.5)를 쓰지 않는다.
- `post`: 부르지 않는다(`usesPost: false`). D-M3-03 b안의 보고 post는 L1-g 코어 경로가 넣으므로 그룹 효과가 아니다.
- 결정적 키: `requestId`의 재료는 커밋된 `epoch`뿐이다. 집계표, 시각, 난수는 쓰지 않는다.
- 시험: "재생 2회, 효과 1회"(ADR-0015 §3.6)를 §9 수용 기준 17·18과 L3.learning.plan §5 `replay.*` 시험으로 확인한다.

## 5. 실패와 경계 사례

| # | 사례 | 처리 |
|---|---|---|
| 1 | 포크 실패(모델 오류) 또는 취소 | `grp.learning.fork.finished{outcome: "error" \| "aborted"}`. 이미 제출된 후보는 그대로 둔다. 후보가 없으면 아무것도 대기열에 넣지 않는다. 카운터는 시작 때 이미 0이므로 다음 임계에서 다시 시도한다(UC-3 대안 흐름) |
| 2 | 포크가 예산이나 반복 상한에 걸림 | `outcome: "budget"`. 사례 1과 같게 처리한다 |
| 3 | 사전 스캔 또는 적용 스캔 실패(비밀 포함 등) | 후보는 `rejected/scan_failed`. 본문을 레코드와 로그에 남기지 않는다 |
| 4 | 승인과 적용 사이 원본 스킬 변경 | L2-d `base_stale` → `pending`으로 되돌림, 새 diff 표시(§4.5 규칙 5) |
| 5 | 학습 그룹 비활성화 중 포크 진행 | [미결 D-M3-04] 권고 b(즉시 취소): 비활성화 적용 때 `onDispose`에서 `g.cancelDelegates("group_disabled")`를 부른 뒤 `g.commit`으로 `inFlightReviewId = null`을 커밋한다(`onDispose` 안의 커밋 허용 여부는 REQ-X-12 [가정]). L1-g는 이 scope가 주체인 백그라운드 자식을 모두 취소하고 `agent.settled{ status: "aborted" }`를 커밋한다. 학습 그룹이 꺼져 있으므로 구독 핸들러는 돌지 않는다. `onDispose`에서 커밋하지 못하는 구성이면 `inFlightReviewId`가 남고, 다시 켠 뒤 첫 명령 진입 때 대체 조회(§4.3)로 비운다. 취소 전에 제출된 후보는 `pending`으로 남고, 다시 켜면 대기열을 그대로 보인다. a안이면 `onDispose`에서 아무것도 하지 않고, c안이면 다시 켠 뒤 그 검토의 후보를 `rejected`로 닫는다 |
| 6 | 재개 뒤 같은 지점 재발화 | 같은 `requestId`로 `g.delegate` → `duplicate`. 포크는 하나만 있다(§4.3) |
| 7 | `agent_settled` 핸들러 안에서 `g.delegate`가 `{ ok: false }`를 돌려주거나 예외 | `{ ok: false }`(`group.delegateUnavailable`, `group.disabling`, `group.delegateFailed`, `group.delegateInvalid`)이면 카운터만 갱신하고 `delegateFailures += 1`을 커밋한다(§4.3 3). 예외는 tap 규칙대로 기록하고 계속하며 상태를 커밋하지 않는다. 다음 turn에 같은 `epoch + 1`로 다시 시도한다. `delegateFailures`가 3이 되면 그 판정에서 검토를 포기하고 카운터를 0, `delegateFailures`를 0으로 커밋한다 [제안] |
| 8 | 포크가 쓰기 도구를 부름 | 실행 거부, 거부 사유 반환(§4.3). 후보는 생기지 않는다 |
| 9 | 포크가 `baseHash` 없이 patch 제안 | `learning_propose`가 `base_missing`을 돌려준다. 후보 없음 |
| 10 | 분기로 이전 지점으로 되돌아감 | scope 상태가 그 지점 값으로 돌아간다(`inFlightReviewId` 포함). 같은 `epoch`가 다시 나와 `requestId`가 겹치면 `duplicate`로 포크를 시작하지 않는다. 되돌아간 상태에 남은 `inFlightReviewId`는 그 검토의 `agent.settled`가 이미 커밋되어 있으면 다음 명령 진입의 대체 조회로 비운다. 대기열 행은 세션 단위이므로 분기와 무관하게 남는다 [제안] |
| 11 | 설정 읽기 실패 | 검토를 시작하지 않는다(fail-closed, §4.1). 대기열 적용도 미룬다 |
| 12 | L2-d 능력 미제공(`requires` 미충족) | 트리거와 포크를 시작하지 않는다. `/learning queue`는 "지식 저장소 없음"을 보여 준다. 로드 거부 여부는 X.loading-trust.spec이 정한다 |
| 13 | 같은 대상에 대한 두 후보가 동시에 `pending` | 둘 다 둔다. 하나가 `applied`가 되면 다른 하나는 다음 적용 때 `base_stale`로 `pending`에 머문다 |
| 14 | 검토가 진행 중인데 임계에 다시 도달 | `skip/in_flight`. 카운터는 계속 센다. 검토가 끝나 `inFlightReviewId`가 비면 다음 `agent_settled`에서 판정한다(§4.2 규칙 0) |
| 15 | `agent.settled` 구독 경로가 없음(REQ-LN-02 미반영) | `inFlightReviewId`가 남아 새 검토가 시작되지 않는다. `/learning` 명령 진입 때 `g.delegateStatus`로 조회해 비운다(§4.3 대체). 명령을 쓰지 않으면 검토가 한 번만 돈다. 그래서 REQ-LN-02는 M3 학습 그룹 착수의 선행 조건이다(L3.learning.plan §3) |
| 16 | 위임 자식이 정착했는데 부모 대화가 삭제됨 | L1-g는 `agent.settled`를 남기지 않을 수 있다(L1.agents.spec §5 7번). 부모 대화가 없으므로 그 대화의 학습 상태도 없다. 대기열의 그 검토 후보는 세션 단위로 남는다 |
| 17 | `AgentSettledPayload.lastItemId` 없음 | 검토를 시작하지 않고 카운터를 유지한다(`skip/excluded`로 기록하지 않는다). REQ-LN-01이 들어오기 전에는 학습 그룹이 검토를 시작할 수 없다 |
| 18 | 승인 때 `scope: "project"`인데 L2-d가 프로젝트 쓰기를 거부 | 적용 결과 `approval_required` 또는 `invalid`. 후보는 `approved`에 남고 사용자에게 사유를 보인다. 범위를 `user`로 바꿔 다시 승인할 수 있다 |

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
- 학습 그룹 켜기·끄기 키는 X 로더 예약 키 `ext.learning.enabled` 하나다(F.extensions.spec §6, X.loading-trust.spec §4.5, F.wire-settings.spec §3.8.3). 내장 그룹도 같은 키를 쓰고 학습 그룹은 이 키를 `defineSettings`로 선언하지 않는다. 기본값은 매니페스트 `defaultEnabled`(§3.1, [미결 D-M3-02])가 정한다. 값 속성은 X.loading-trust.spec §6 정의를 따른다: `runtimeChange` `live`(요청을 기록하고 적용은 다음 단계 경계), `allowedScopes` managed·user·project·local·session.
- `l3.learning.review.maxIterations` 기본 16은 pi 방식(기본 상한 없음)의 예외다 [결정: review.decisions-2 U-22]. 검토 포크는 사용자 입력 없이 실행되는 경로라 drive 임대 상한(U-12)과 같은 이유로 상한을 둔다.
- 설정 키 `l3.learning.queue.expiryDays`는 조정자 공통 목록에 없던 키다. 승인 피로 대응(L3.learning.plan §7)에 필요해서 더했다.

### 6.2 명령

| 명령 | 동작 | 차수 |
|---|---|---|
| `/learning queue [--json] [--status <s>]` | 대기열 목록(`ProposalView[]`) | 1차 |
| `/learning queue show <id>` | diff, 근거 이벤트, 사유 | 1차 |
| `/learning queue approve <id> [--revision <n>] [--scope user\|project]` | 승인 → 적용. `--scope`는 스킬 후보만([미결 D-M3-09]) | 1차 |
| `/learning queue reject <id> [--note <text>]` | 거절 | 1차 |
| `/learning queue edit <id>` | 본문 편집기 열기 → `edit` 결정 | 1차 |
| `/learning queue revert <id>` | 원장 롤백 | 1차 |
| `/learning review [--cancel]` | 임계와 무관하게 지금 검토 시작(`requestId = learning:review:manual:<epoch+1>`) 또는 진행 중 검토 취소 | 1차 |
| `/learning history [--since <date>]` | 학습 이력 시간순 보기 | 2차 |

- 명령은 `g.registerCommand("learning", …)`로 등록한다(L3.group-kit.spec §3.2, X `hostOf(g).registerCommand`). CLI는 `xeon` 대화 입력에서, 데스크톱은 승인 화면 버튼에서 같은 명령을 부른다.
- 모든 하위 명령은 진입 때 지연 정리(§4.5 규칙 7)를 먼저 하고, 결과를 `DecisionResult`·`QueueSweep`(§3.9) 값으로 돌려준다. `--json` 출력은 이 값을 그대로 직렬화한다.

## 7. 확장 지점

| 연산 | 사용 | 내용 |
|---|---|---|
| `on` tap | 2개 | `agent_start`, `agent_settled`(§4.2) |
| 내구 이벤트 구독 | 1개 | 코어 `agent.settled`(§4.3, REQ-LN-02) |
| `on` first | 없음 | 쓰기 거부는 L1 실행 검사(`DelegateSpec.toolPolicy`, §3.4)가 한다. 그룹의 `tool_call` 핸들러로 하지 않는다 [제안]. 그룹 핸들러가 어느 대화에 적용되는지 F에 규칙이 없기 때문이다 |
| `on` chain | 1개 | `turn_end`. 도구 반복만 세고 `undefined`를 돌려준다(§4.2). 시스템 프롬프트, 컨텍스트를 바꾸지 않는다(캐시 접두 보존) |
| `post` | 쓰지 않음 | `usesPost: false`. 완료 보고는 L1-g 코어 경로이고 [미결 D-M3-03] 권고 a에서는 보고 자체가 없다(§4.3) |
| `drive` | 쓰지 않음 | `usesDrive: false` |
| `scope` | 주 scope `learning` | 상태 `LearningState`(§3.2) |
| 위임 | `g.delegate`, `g.delegateStatus`, `g.cancelDelegates` | 검토 포크 시작·조회·취소(§4.3, §5 사례 5). F 4연산 밖이며 group-kit이 제공한다. on 핸들러의 `g.delegate`는 ADR-0015로 허용된다(§4.10) |

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

### 8.1 하위 층 요구 (M3 설계)

학습 그룹 M3 구현의 선행 조건이다. `대응` 열은 `review.m3-design-inputs` §4.4의 요구 번호다. 그 번호가 없는 항목은 이 문서가 새로 요구한다.

| ID | 받는 문서 | 요구 | 대응 | 학습 그룹에서 쓰는 곳 |
|---|---|---|---|---|
| REQ-LN-01 | `F.extensions.spec` §3.4, `L1.loop.spec` | `AgentSettledPayload`에 `origin: TurnOrigin`(`user`, `scheduled`, `remote`, `delegation`, `drive`, `other`), `status: "completed" \| "aborted" \| "error"`, `hasFinalAnswer: boolean`, `lastItemId: ItemId \| null`을 더한다. 도구 실행 문맥의 `caller.afterUntrusted`를 확장 도구 `execute`에도 넘긴다 | REQ-F-06 확장 | §4.2, §4.3 1, §3.5 |
| REQ-LN-02 | `F.extensions.spec`, `X.primitives.spec` | 그룹이 부모 대화의 코어 내구 이벤트 `agent.settled`를 구독하는 수단. 위임 주체가 그 scope인 이벤트만 넘긴다. 구독 핸들러는 재실행되는 코드이고 효과는 ADR-0015 on 핸들러 열을 따른다. 디스패치 키는 이벤트 id다 | `review.m3-design-inputs` §3.8 A-22 | §4.3 완료 통지 |
| REQ-LN-03 | `X.primitives.spec` §4.6.5 | `recordPrivate`·`record`·`commit`을 확장 도구 `execute`와 명령 처리기에서 부를 때의 ambient(디스패치 키 = 도구 호출 id 또는 명령 호출 id) | REQ-X-06 확장 | §3.5, §4.5 |
| REQ-LN-04 | `X.primitives.spec` | 도구 `execute`가 위임 자식 대화에서 실행될 때 기록이 쓰이는 대화를 정한다. [제안] 도구가 실행된 대화(자식)에 쓰고, 투영 `x_learning_proposals`는 세션 단위로 모은다 | 새 요구 | §3.5, §3.7 |
| REQ-LN-05 | `L1.agents.spec` | (부모 대화, `requestId`) 위임 멱등을 세션 DB에 남겨 재시작 뒤에도 유지 | REQ-L1-01 | §4.3, §4.10 |
| REQ-LN-06 | `L1.agents.spec` §3.3 | 주체 단위 취소 `CancelTarget{ ownerScopeId }`. 취소된 자식도 `agent.settled{ aborted }`를 남긴다 | REQ-L1-02 | §5 사례 5 |
| REQ-LN-07 | `L1.agents.spec` §3.5 | `agent.settled` payload에 `requestId`, 위임 주체(`origin.owner`), `status`, 상한 종료 표지(`limitHit`), `usage`를 싣는다 | 새 요구 | §3.4 `ReviewSettled` |
| REQ-LN-08 | `L3.group-kit.spec` §3.2, §3.4, `L1.agents.spec` §3.2 | `DelegateSpec.report`·`DelegateRequest.report` 선택화(없으면 보고 입력을 만들지 않음), `GroupApi.delegateStatus(requestId)`, `GroupApi.cancelDelegates(reason)` | REQ-L1-05 | §3.4, §4.3, §5 사례 5 |
| REQ-LN-09 | `L2.knowledge.spec` §3.2·§3.3·§3.5·§4.5·§4.9 | 쓰기 메서드와 `ledger.rollback`에 `idempotent: true`와 `replay: "safe"`(같은 `requestId`에 원장의 첫 결과)를 선언하고 적합성 시험을 둔다. 내장 그룹 증거 source `learning.queue`를 믿는 기본 규칙(D-11의 L3 설정 채우기). 스킬 쓰기 입력의 `scope: "project"`는 사용자 승인 증거가 있을 때만 받는다 | REQ-L2-01, REQ-L2-03 | §4.5 규칙 3·6·8 |
| REQ-LN-10 | `L4.desktop.spec`, `L4.cli.spec`, `review.m3-plan` M3-18 | 승인 화면이 학습 대기열(`/learning queue --json`)과 `cap_knowledge_proposals`를 한 목록에 합치고 출처 열을 둔다. 스킬 후보의 범위 선택과 `afterUntrusted` 경고 | REQ-L2-02(다른 답, D-M3-32 a안) | §3.7.1, §3.8 |
| REQ-LN-11 | `L1.agents.spec`, `L1.tools.spec` | 검토 포크 도구 정책 `tools.allow`·`keepParentList`의 실행 시점 거부와 `denyHint`. 확장 도구 티어에서 `learning_propose`가 허용 목록에 들어갈 수 있어야 한다 | REQ-F-10 | §3.4 |

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
17. (ADR-0015 재생 2회, 효과 1회) 검토를 시작하는 `agent_settled` 핸들러를 같은 커밋 상태와 같은 페이로드로 두 번 실행하고 그 사이 프로세스를 재시작해도, 가짜 위임 서비스의 자식 생성 계수는 1이고 `grp.learning.fork.started` 행은 1개이며 상태 커밋은 한 번만 반영된다.
18. (ADR-0015) `agent.settled` 구독 핸들러를 같은 이벤트로 두 번 실행해도 `grp.learning.fork.finished`, `grp.learning.review.finished`가 각 1개이고 `inFlightReviewId`는 null이다.
19. 학습 그룹의 on 핸들러와 구독 핸들러 실행 중 `g.capability` 호출은 0회다(능력 래퍼 계측).
20. `inFlightReviewId`가 있는 동안 임계를 넘어도 `g.delegate` 호출은 0회이고, 검토가 끝난 뒤 다음 `agent_settled`에서 한 번 불린다.
21. ([미결 D-M3-03] a안) 검토가 끝난 뒤 부모 대화의 다음 모델 요청 입력에 `grp.learning.review.result` 항목이 없고, 부모 대화에 `input.queued{ source.type: "delegation" }`이 없다.
22. ([미결 D-M3-04] b안) 검토 포크가 도는 중 학습 그룹을 끄면 그 자식의 `agent.settled{ status: "aborted" }`가 커밋되고, 그 뒤 자식 대화에 새 모델 요청이 없다.
23. 위임 자식 대화(`origin = "delegation"`)와 drive turn(`origin = "drive"`)은 `userTurnsSinceReview`를 올리지 않는다.
24. ([미결 D-M3-09] c안) `learning_propose`로 만든 스킬 후보의 `scope`는 `user`이고, `approve --scope project`일 때만 적용 어댑터가 `scope: "project"`로 L2-d를 부른다. 메모리 후보에 `--scope project`를 주면 `learning.scopeNotAllowed`다.
25. `create` 대상과 같은 이름의 스킬이 있으면 `learning_propose`가 `name_exists`를 돌려주고 대기열 행이 생기지 않는다.
26. 결정 명령 도중 적용 전에 프로세스를 끊고 다시 띄운 뒤 아무 `/learning` 명령을 부르면, 같은 `idempotencyKey`로 적용이 한 번 더 불리고 L2-d 원장 행은 1개다.
27. 검토 시작 순서(§4.3 3, 4번) 사이에 자식이 정착해 `agent.settled` 구독 핸들러가 먼저 돌아도 4번 커밋 뒤 `inFlightReviewId`는 null이고 다음 임계 도달 때 검토가 시작된다.
28. 검토 중 그룹을 끄고 다시 켜면 `inFlightReviewId`가 null이다. `onDispose`에서 커밋하는 구성에서는 `/learning` 명령 진입 없이도 그렇다.

## 10. 미결 사항

M3 설계 개정(2026-10-26)에서 옛 번호를 정리했다. 닫은 항목은 근거와 함께 남긴다.

사용자 결정(번호는 `review.m3-design-inputs` §3):

1. [미결 D-M3-02] 학습 그룹 기본 켬(옛 미결 8). 권고 a(켬). 설계는 a 기준이다(§3.1 `defaultEnabled: true`).
2. [미결 D-M3-03] 검토 결과의 전달(옛 미결 4). 권고 a(부모 모델 입력에 넣지 않음). 설계는 a 기준이고 b안의 차이를 §4.3에 적었다.
3. [미결 D-M3-04] 그룹을 끌 때 진행 중 검토 포크(옛 미결 7). 권고 b(즉시 취소). 설계는 b 기준이고 a·c안의 차이를 §5 사례 5에 적었다.
4. [미결 D-M3-06] 유휴 중 자율 turn. 학습 그룹은 어느 답이든 `origin = "drive"` turn을 사용자 turn으로 세지 않는다(§4.9). 설계 영향 없음.
5. [미결 D-M3-07] 안전 모드의 내장 그룹. 권고 a(끔). §4.9에 적었다.
6. [미결 D-M3-08] 메모리 정본 위치. 학습 그룹은 L2-d 쓰기 API만 쓰므로 어느 답이든 이 문서의 설계는 바뀌지 않는다.
7. [미결 D-M3-09] 프로젝트 스킬에 대한 에이전트 쓰기. 권고 c. 설계는 c 기준이다(§4.5 규칙 8, §3.8 4번).

설계 질문:

8. [미결 D-M3-32] 대기열 소유. 권고 a(대기열 둘 유지). 이 문서는 학습 그룹 소유를 유지하고 L4가 두 출처를 한 목록으로 보이는 안을 [제안]했다(§3.7.1, REQ-LN-10). `review.m3-design-inputs` REQ-L2-02는 `cap_knowledge_proposals` 하나로 합치는 안이다. L2.knowledge.spec §10 미결 3·22를 고치는 작업에서 둘 중 하나로 맞춘다.
9. [미결] 패키지 `xeon.domain` 값(옛 미결 3). group-kit 쪽 `kit` 대 `group-kit`. `review.m3-design-inputs` G-IN-13이 `group-kit`으로 맞추는 안을 따른다(M3-35). 학습 그룹(`learning`)은 영향이 없다.
10. [미결] `agent.settled` 구독 수단(REQ-LN-02)의 F 형태. 매니페스트 선언 필드와 `GroupApi` 연산 이름은 F·X 계약 트랙이 정한다. 정해지기 전에는 §4.3 대체 경로(명령 진입 조회)만 동작한다.
11. [미결] 대화당 검토 1개(`inFlightReviewId`) 외의 프로세스 전체 상한. L1-g 백그라운드 풀 상한(REQ-L1-03)이 정해지면 그 값을 따른다.
12. [가정] `ApprovalEvidence{ source: "learning.queue" }`를 L2-d가 믿도록 하는 기본 설정 경로(REQ-LN-09). L2 문서가 D-11에 맞춰 정한다.

닫힌 항목:

- (닫힘) [결정: review.decisions-2 T-21] 비공개 기록 쓰기 경로. kind 형식은 F.records.spec §3.2의 `grp.<groupId>.<영역>.<이름>`이고, 공개 레코드는 `grp.learning.*`, 비공개 기록은 `grp.learning.proposal.*`·`grp.learning.fork.*`를 X `ScopeApi.recordPrivate(kind, payload)`로 쓴다(§3.7.1). eng.events.design·eng.context-map.design의 옛 밑줄 접두 예제와 정규식 정정은 그 문서 쪽 변경이다.
- (닫힘) [결정: adr.0015] on 핸들러 외부 효과와 검토 포크 시작(옛 미결 2). on 핸들러의 `requestId` 멱등 `g.delegate`를 허용한다. 옛 대체안(요청 레코드 + L1-g 워커)은 지웠다(§4.3, §4.10).
- (닫힘) [제안] 기존 스킬과 충돌하는 후보의 병합 규칙(옛 미결 5, L-IN-08). 같은 이름은 `name_exists`로 막고, 유사 스킬은 표시만 하며, 자동 병합은 하지 않는다(§4.5 규칙 4).
- (닫힘) 큐레이터 트리거 수단(옛 미결 6, L-IN-18). 2차라 M4 이후에 정한다(§4.8.1).
- (닫힘) 도구 정책의 형태(옛 미결 10). L3.group-kit.spec §3.4 `DelegateToolPolicy`가 허용·차단을 둘 다 받는다. 학습 그룹은 허용 목록을 쓴다(§3.4).
- (닫힘) 서비스 키 체계(옛 미결 11). `review.m3-design-inputs` §3.8 A-01(F는 `ServiceKey<Api>`만 두고 X 래퍼가 타입을 복원)로 닫는다. 학습 그룹은 `KnowledgeSkillsKey` 등 L2.knowledge.spec §1의 키를 그대로 쓴다.
- (닫힘) [제안] 그룹 on 핸들러가 위임 자식 대화에서도 발화하는지(옛 미결 12, L-IN-05). 학습 그룹은 `origin = "delegation"` 제외 규칙으로 어느 답에서도 같게 동작한다(§4.2). 발화 범위 자체는 REQ-L1-04가 정한다.
