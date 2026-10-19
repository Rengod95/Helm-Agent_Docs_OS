# 12. 구현 아키텍처와 세부 설계

> 상태: 설계 후보
> 대상 스택: pi-durable 1.1.0 (런타임), pi-ai 1.1.0 (모델), assistant-ui 0.15 (대화 UI), React 18 CSR (클라이언트)
> 근거: 이 문서의 pi-durable 관련 설계는 v0.3 작업 중 실행한 스파이크 두 개로 확인했다([13 §3](13-stack-feasibility.md)).
>
> **갱신**: 런타임 경로 검토는 [14](14-alternative-structure.md)로 넘어갔고, 클라이언트는 2026-10-11 결정(웹이 아님, 데스크톱 앱 우선)으로 바뀌었다. §1.1, §1.2(원격 접속은 이제 범위 안), §2, §3 apps, §11, §13, §14 M3, §15-1의 웹 클라이언트 서술은 폐기 예정이며 15 기획 문서에서 다시 정한다.

## 1. 목표와 범위

### 1.1 이 설계가 만드는 것

개인용 Helm 런타임과 클라이언트. [00~11](00-README.md)의 개념을 다음 형태로 구현한다.

- **helm-kernel**: Helm 규칙을 집행하는 순수 모듈. 런타임 import 없음.
- **helm-durable**: kernel을 pi-durable 위에 올리는 어댑터. 문서, 도구, 훅, task.
- **helm-server**: 하나의 Node 프로세스. pi-durable Harness를 소유하고, 클라이언트와 HTTP·WebSocket으로 통신.
- **helm-web**: React 18 CSR 클라이언트. 상태 중심 화면 + assistant-ui 기반 대화 패널.

### 1.2 범위 밖

- 에이전트 권한 레이어의 위험 판정 로직 자체 (인터페이스만 정의, §10)
- 여러 사용자, 원격 배포, 인증
- 모바일 클라이언트

## 2. 전체 구성

```text
┌──────────────────────────── helm-web (브라우저, React 18) ───────────────────────────┐
│  상태 화면: 홈 · Concern 상세 · 질문함 · 에이전트가 정한 것 · 탐구 보드 · 다이얼     │
│  대화 패널: assistant-ui (ExternalStoreRuntime) + helm_* 도구 렌더러                 │
│  클라이언트 스토어 (zustand): 서버 스트림을 받아 그대로 반영. 정본 아님              │
└───────────────▲───────────────────────────────────────────────┬──────────────────────┘
                │ WebSocket: 상태 연산 스트림                     │ HTTP: 명령
┌───────────────┴──────────────── helm-server (Node 22, 프로세스 1개) ─────────────────┐
│  명령 API ─→ helm-kernel (순수 규칙) ─→ helm-durable 어댑터 ─→ pi-durable Harness    │
│                                                                    │                  │
│  스트림 팬아웃 ←─ watchEvents / viewState / watchDoc / taskGraph ───┘                  │
│  권한 레이어 (인터페이스)        모델: pi-ai (실제 공급자 / faux)                      │
└──────────────────────────────────────┬───────────────────────────────────────────────┘
                                       │
                 저장소: SQLite 파일 하나 (~/.helm/<workspace>.sqlite)
                 작업 공간: NodeExecutionEnv(cwd = 프로젝트 폴더)
```

원칙:

1. **정본은 서버의 pi-durable 저장소 하나뿐이다.** 클라이언트 스토어는 서버 상태의 사본이다.
2. **pi-durable 저장소는 프로세스 하나만 연다.** pi-durable에는 프로세스 간 락이 없다. 관찰 에이전트와 타이머도 같은 프로세스 안의 task로 돈다.
3. **모델은 도구로 제안만 한다.** 사람의 결정은 HTTP 명령으로만 들어오고, 서버가 host commit으로 기록한다. 모델에게는 결정 도구가 없다.

## 3. 저장소 구조

```text
helm/
  packages/
    helm-kernel/          순수 TS. pi 의존성 없음
      src/schema/           레코드, 이벤트, 제안, 명령 타입 (zod)
      src/rules/            승격, 의존 규칙, 전환, 구조 루프 규칙
      src/questions/        게이트, 전달 방식 결정, 만료점
      src/inquiry/          발산 표 빈 칸, 확인 순서, 다음 자극, 멈춤 판정
      src/situation/        판정 질문, 기본 조합
      src/modes/            모드 묶음과 루프 계약 (데이터 로더)
      src/projection/       투영 생성 (순수 함수)
      contracts/*.yaml      루프 계약, 모드 묶음, 다이얼 기본값
    helm-protocol/        서버와 클라이언트가 공유하는 메시지 타입
    helm-durable/         pi-durable 어댑터
      src/docs.ts           defineDoc / defineDocFamily
      src/tools/            원시 도구 래퍼, helm_* 제안 도구
      src/hooks.ts          beforeTool, onYield, beforeCompact
      src/tasks/            concern, workunit, verifier, question-scheduler, timers, observer
      src/sections.ts       투영 섹션
      src/extension.ts      defineExtension 묶음
      src/commands.ts       사람 명령 → host commit
    helm-server/          HTTP + WebSocket
    helm-permission/      권한 레이어 인터페이스와 기본 구현
  apps/
    helm-web/             Vite + React 18 + assistant-ui
  experiments/
    durable-spike/        v0.3 스파이크 (helm-spike.mjs, concern-task-spike.mjs)
```

## 4. 데이터 매핑: Helm 레코드 → pi-durable 구성요소

### 4.1 단위의 대응

| Helm | pi-durable | 이유 |
|---|---|---|
| 워크스페이스 (프로젝트) | Harness + SQLite 파일 하나 | 저장소 하나에 프로세스 하나 |
| Goal, Concern 트리, 선호 모델, 정책·다이얼, 렌즈 라이브러리 | session 범위 문서 (family, key = id) | 여러 대화에 걸치는 상태 |
| Concern 하나 | 대화 하나 (ownerless) + `helm.concern` task 하나 | Concern의 기록과 상태 기계 |
| Concern의 E/N 레코드 (관찰, 추측, 판단, 질문, 합의, 결과, 루프 계획, 전환, 상황 판정, 예측, 기대) | 그 대화의 conversation 범위 문서 `helm.concern` (history: rewindable) | 시점별 조회(snapshotAsOf), 대화 변경과 같은 commit |
| WorkUnit | Concern task가 소유한 `helm.workunit` task + 그 task가 소유한 하위 대화 | 취소 전파, 완료 대기 |
| 발산 분기 | 같은 항목에서 만든 fork 대화들 | 같은 시점에서 시작, 서로 결과를 못 봄 |
| 검증 에이전트 | 새 대화 (fork 아님), 다른 모델, 읽기·실행 도구만 | 독립성 |
| 관찰 | 원시 도구 래퍼(wrap)가 실행 후 문서에 기록 + 원본 `pi.tool-result` 항목 | 스파이크로 확인 |
| 거부된 시도 | `pi.tool-result` 항목의 `blocked` 진단 + 문서의 rejected 목록 | 스파이크로 확인 |
| 사람의 결정 | 서버 명령 → host `conversation.commit` + `helm.human` 항목 | 모델 도구 경로 없음 |
| 혼자 정한 결정 | Choice 레코드 (autonomous: true) | 06 §4 |
| 타이머 (기대 기한, 예측 확인일, 만료점, 다시 볼 조건) | background task의 `runtime.sleep(until)` | 재시작 후에도 유지됨을 스파이크로 확인 |
| 투영 | `section("helm-projection")`, 복귀 요약 API | 섹션 변경은 transcript에 위치를 가진 시스템 항목으로 남음 |
| 요약(컴팩션) | `CompactionTask`의 `beforeCompact` 훅에서 Helm 요약 제공 | A9 |

### 4.2 문서 정의

```ts
// session 범위: 워크스페이스 전체
export const GoalDocs = defineDocFamily<GoalState, { text: string }>({
  kind: "helm.goal", version: 1, scope: "session",
  initial: (seed) => ({ text: seed.text, version: 1, history: [], preferenceModelIds: [] }),
});
export const ConcernIndex = defineDoc<ConcernIndexState>({
  kind: "helm.concern-index", version: 1, scope: "session",
  initial: () => ({ concerns: {} }),   // id → { conversationId, parentId, goalId, situation, loop, status }
});
export const PreferenceModels = defineDocFamily<PreferenceModel, { goalId: string }>({ ... scope: "session" });
export const PolicyDoc = defineDoc<PolicyState>({ kind: "helm.policy", version: 1, scope: "session", ... });

// conversation 범위: Concern 하나
export const ConcernDoc = defineDoc<ConcernState>({
  kind: "helm.concern", version: 1, scope: "conversation",
  history: "rewindable", fork: "current",
  initial: () => emptyConcernState(),
});
```

주의: session 문서는 처음 `tx.doc()`으로 쓰기 전까지 존재하지 않는다(스냅숏이 undefined). 서버 시작 시 초기화 commit을 한 번 실행한다.

### 4.3 ConcernState (요약)

```ts
type ConcernState = {
  id: string; goalId: string; parentId?: string;
  situation: SituationAssessment | null;
  loopPlan: LoopPlan | null;
  currentLoop: LoopId;               // "O" | "I.fact" | "I.want" | "I.possibility" | "I.outcome" | "C.commit" | "C.probe" | "A.confirm" | "A.watch" | "S"
  transitions: LoopTransition[];
  observations: Observation[];       // id = tool call id 또는 human:<n> 또는 external:<n>
  claims: Record<string, Claim>;     // 추측과 판단. status: guess | finding | contested | stale | superseded
  questions: Record<string, Question>;
  agreements: Record<string, Agreement>;
  probes: Record<string, Probe>;
  results: Record<string, Result>;   // submitted | accepted | conditional | rejected
  integration: IntegrationItem[];
  predictions: Record<string, Prediction>;
  expectations: Record<string, Expectation>;
  choices: Record<string, Choice>;   // autonomous 포함
  rejected: Rejection[];             // 커널이 거부한 제안
  inquiry: InquiryBoard | null;      // 발산 표, 자극, 반응, 기준 후보
};
```

## 5. 커널과 어댑터의 경계

### 5.1 커널 인터페이스

커널은 상태와 입력을 받아 결정만 돌려준다. 저장소를 모른다.

```ts
// helm-kernel
export type KernelInput =
  | { kind: "proposal"; actor: ActorRef; proposal: Proposal }      // 모델이 helm_* 도구로 보낸 것
  | { kind: "command";  actor: HumanRef; command: HumanCommand }   // 사람이 HTTP로 보낸 것
  | { kind: "observation"; source: ObservationSource; data: ObservationData }
  | { kind: "timer"; timer: TimerRef };

export type KernelDecision =
  | { ok: true;  events: HelmEvent[]; effects: Effect[] }
  | { ok: false; reason: string; events: HelmEvent[] };            // 거부도 이벤트를 남김

export type Effect =
  | { kind: "configure"; conversation: "self" | ConcernRef; loop: LoopId; mode: ModeId }
  | { kind: "spawnWorkUnit"; agreementId: string }
  | { kind: "spawnBranches"; cells: CellRef[] }
  | { kind: "spawnVerifier"; resultId: string }
  | { kind: "scheduleQuestion"; questionId: string; delivery: Delivery; at?: number }
  | { kind: "setTimer"; timer: TimerSpec }
  | { kind: "notify"; target: "client"; payload: Notice };

export function decide(state: KernelView, input: KernelInput, policy: Policy): KernelDecision;
export function apply(state: ConcernState, events: HelmEvent[]): ConcernState;   // 순수 reducer
```

### 5.2 어댑터의 일

```text
helm_* 도구 execute() 또는 서버 명령
  → 현재 문서 스냅숏 읽기
  → kernel.decide()
  → ok면 api.commit(tx → tx.doc(ConcernDoc) 에 kernel.apply 결과 반영)   ← 문서와 대화가 같은 commit
  → effects 실행 (configure, createTask, fork 등)
  → 거부면 rejected 기록 후 도구 오류로 반환 (모델이 이유를 봄)
```

훅(`beforeTool`, `onYield`)은 문서를 읽을 수만 있고 쓸 수 없다(HookApi는 DocumentReader). 그래서:

- 막는 판단은 훅에서 한다 (읽기만 필요).
- 기록이 필요한 일은 도구 래퍼나 도구 본체, 또는 서버 명령에서 한다.

이 제약은 스파이크로 확인했다.

## 6. Concern task: 루프 상태 기계

### 6.1 phase 설계

```ts
const ConcernTask = defineTask<ConcernInput, ConcernCheckpoint, ConcernResult>({
  name: "helm.concern", version: 1,
  initial: (input) => ({ phase: "orient" }),
  phases: {
    orient,        // 상황 판정 요청, 루프 계획 확정 → plan
    plan,          // 루프 계획에 따라 첫 루프 진입 → loop
    loop,          // 현재 루프의 계약대로 대화 configure, 사용자 입력·모델 실행 대기
    awaitHuman,    // 권리 게이트나 즉시 질문의 답 대기
    awaitChildren, // WorkUnit·분기·검증자 task 대기 (status: "waiting", on: [...])
    recombine,     // 구조 루프: 하위 Concern 결과 재조합 확인
    closed,
  },
  abort,           // 하위 task부터 취소됨(pi-durable 기본 동작), 자기 효과 정리
});
```

- 각 phase는 반드시 checkpoint를 바꾸거나 종료를 commit해야 한다. 진전 없이 반환하면 pi-durable이 task를 fault로 처리한다.
- 루프 전환은 `loop` phase 안에서 checkpoint의 `currentLoop`를 바꾸는 commit이다. 전환 레코드와 같은 commit에 들어간다.
- 하위 대기는 `{ status: "waiting", on: [ids], policy }`로 한다. 대기 중에는 코드가 돌지 않는다.

### 6.2 사람 결정 대기

스파이크에서는 `sleep` + 재확인(폴링)으로 구현했고 재시작 후에도 동작했다. 실제 구현에서는 다음 중 하나로 바꾼다.

- 사람 명령이 들어오면 서버가 해당 Concern task를 깨우는 이벤트를 남기고, task는 그 이벤트를 기다림
- TaskRuntime의 DocumentObserver로 문서 변경을 관찰 (API 세부 확인 필요)

### 6.3 모드 적용

루프나 모드가 바뀌면 Concern 대화의 agent를 다시 설정한다.

```ts
await configure(tx, concernConversationId, {
  tools: modeContract.tools,                 // 이 루프에서 쓸 원시 도구 + helm_* 도구만
  instructions: modeContract.instructions,   // 루프별 지시
  extensions: { add: [HelmCore, ...modeContract.extensions] },
});
```

pi-durable은 시스템 프롬프트 섹션과 도구 변경을 transcript에 위치를 가진 항목으로 남긴다. 그래서 "모델이 어떤 판단을 할 때 어떤 모드와 투영을 보고 있었는지"를 나중에 확인할 수 있다.

## 7. 모델에게 주는 도구

### 7.1 원시 행동

| 원시 행동 | 구현 | 비고 |
|---|---|---|
| read | `@earendil-works/pi-durable/tools`의 read | 관찰 래퍼 적용 |
| write | write, edit | 관찰 래퍼 + beforeTool 범위 검사 |
| execute | bash | 관찰 래퍼. 권한 레이어 판정 |
| send | Helm 전용 도구 (예: 외부 발송 어댑터) | 항상 권한 레이어 → 대부분 권리 게이트 |
| spawn | Helm이 effect로 직접 실행. 모델에게는 helm_* 제안 도구로만 노출 | 분기·검증자는 커널이 만든다 |
| ask | `helm_question` | 질문 레코드 |

관찰 래퍼(스파이크에서 확인한 방식):

```ts
const observe = (tool) => wrapTool(tool, (inner) => ({
  ...inner,
  execute: async (args, api, ctx) => {
    const res = await inner.execute(args, api, ctx);
    await api.commit(async (tx) => {
      const d = await tx.doc(ConcernDoc, api.conversationId);
      d.observations.push({ id: api.callId, tool: inner.name, args, at: Date.now(), ref: hashRefs(res) });
    }, ctx);
    return res;
  },
}));
// defineExtension({ tools: [read, write, edit, bash], wraps: [observe(read), observe(write), ...] })
```

`wrapTool`은 도구가 아니라 래퍼라서 `tools`가 아닌 `wraps`에 넣는다(스파이크 중 확인).

### 7.2 helm_* 제안 도구

| 도구 | 쓰는 루프 | 커널 검사 |
|---|---|---|
| helm_assess_situation | O | 판정 질문 답과 근거 필수 |
| helm_propose_plan | O | 루프 계획 형식 |
| helm_frame | O, I | 예측·반박 조건·근거 관찰 id |
| helm_interpret | I | 참조한 관찰 id 실재 |
| helm_possibility | I.possibility | 근거 있거나 "추측" 표시, 발산 표 칸 지정 |
| helm_declare_predictions | I.fact | 후보별 예측과 비용 (확인 순서 계산 입력) |
| helm_stimulus | I.want | 자극 형식, 다른 분야 레퍼런스 비율 |
| helm_criterion_candidate | I.want | 근거가 된 반응 관찰 id |
| helm_predict | I.outcome | 확인 날짜·방법 필수 |
| helm_question | 모든 루프 | 임시 가정, 만료점, 게이트 |
| helm_propose_agreement | C | 범위, 기준, 근거, 멈춤 조건 |
| helm_propose_probe | C.probe | 키울·접을 조건, 예산 |
| helm_submit_result | C → A | 근거가 관찰 id인지 |
| helm_propose_transition | 모든 루프 | 의존 규칙 |
| helm_propose_split / merge | S | 상한, 경계 항목 |

결과 확인, Goal 수정 확정, 선호 기준 확정, 이의는 모델 도구가 없다. 사람 명령으로만 들어온다.

## 8. 훅

| 훅 | 하는 일 |
|---|---|
| ToolTask.beforeTool | ① 현재 모드의 원시 행동 허용 여부 ② write 대상이 합의 범위 안인지 ③ 권한 레이어 판정이 "사람 필요"면 차단하고 권리 게이트 질문 생성을 안내 |
| GenerationTask.onYield | 현재 루프의 종료 조건 확인. 예: 쓰기를 했는데 결과 제출이 없으면 한 번 더 진행 요청. 반복 방지는 memo로 |
| GenerationTask.beforeRequest | 필요하면 요청 메시지에 최신 투영을 덧붙임 (보통은 section으로 충분) |
| CompactionTask.beforeCompact | 커널의 projection으로 요약 생성. 열린 반대 근거 id가 모두 포함됐는지 검사 |

## 9. 서버 API

### 9.1 명령 (HTTP POST)

| 경로 | 본문 | 동작 |
|---|---|---|
| /goals | { text } | Goal 생성 |
| /concerns | { goalId, text, parentId? } | Concern 대화 + task 생성 |
| /concerns/:id/input | { text, whenBusy } | 사용자 입력 (steer / followUp) |
| /concerns/:id/abort | - | 실행 중단 |
| /decisions | { concernId, kind, targetId, payload } | 사람 결정. kind: agree, revise-agreement, accept, accept-conditional, request-changes, reject, answer, assume, contest, revise-goal, confirm-criterion, set-dial, reopen |
| /reactions | { concernId, stimulusId, reactions[] } | 원함 탐구의 반응 (요소 단위, 강도, 이유 없음, 고쳐 말하기) |

모든 결정은 서버에서 kernel.decide를 거친다. 결과는 HTTP 응답으로 짧게 돌려주고, 상태 변화는 스트림으로 퍼진다.

### 9.2 스트림 (WebSocket)

```ts
// 클라이언트 → 서버
{ type: "subscribe", topics: ["index", "concern:<id>", "conversation:<convId>", "tasks"] }

// 서버 → 클라이언트
{ type: "snapshot", topic, value }        // 구독 시작 시 현재 상태
{ type: "ops", topic, ops }               // pi-durable watch의 연산 (문서·대화)
{ type: "events", topic, events }         // watchEvents의 에이전트 이벤트 (메시지 스트리밍)
{ type: "notice", notice }                // 질문 전달 등
```

- 늦게 접속하거나 재접속하면 현재 상태부터 받는다. pi-durable의 watch가 늦게 합류한 쪽에 현재 view를 주는 방식을 그대로 쓴다.
- 대화의 메시지 스트리밍은 `watchEvents`(실험 단계 API)를, 문서와 task는 `watchDoc`, `taskGraph`를 쓴다.

## 10. 권한 레이어 인터페이스

Helm 범위 밖이지만 연결 지점은 정한다.

```ts
export interface PermissionLayer {
  classify(action: { primitive: Primitive; tool: string; args: unknown; cwd: string }, ctx: PermissionContext):
    Promise<{ verdict: "allow" | "needs-human" | "deny"; reason: string; rightsGate?: boolean }>;
}
```

- 초기 구현: 규칙 몇 개 (send는 항상 needs-human, 작업 공간 밖 쓰기는 deny 등)
- 이후: 모델 기반 판정으로 교체 가능
- beforeTool 훅이 이 결과를 받아 차단하고, 커널이 권리 게이트 질문을 만든다.

## 11. 클라이언트

### 11.1 구성

| 영역 | 구현 |
|---|---|
| 앱 골격 | Vite + React 18 CSR + 라우터 |
| 상태 | zustand 스토어 하나. WebSocket 메시지를 그대로 반영. 서버 상태의 사본 |
| 대화 패널 | assistant-ui `useExternalStoreRuntime`. messages는 스토어의 Concern 대화 항목에서 변환 |
| helm_* 도구 표시 | assistant-ui 도구 렌더러. 예: helm_propose_agreement → 합의 카드(확인·수정 버튼), helm_submit_result → 결과 카드(확인·조건부·수정 요청·거절) |
| 상태 화면 | 직접 구현 (§11.3) |

### 11.2 assistant-ui 연결

```tsx
const runtime = useExternalStoreRuntime({
  messages: useHelm((s) => s.conversations[convId]?.entries ?? []),
  convertMessage: entryToThreadMessage,            // pi.user / pi.assistant / pi.tool-result → ThreadMessageLike
  isRunning: useHelm((s) => s.conversations[convId]?.running ?? false),
  onNew: (m) => api.post(`/concerns/${concernId}/input`, { text: textOf(m), whenBusy: "followUp" }),
  onCancel: () => api.post(`/concerns/${concernId}/abort`),
  // onAddToolResult는 쓰지 않는다: helm_* 도구는 서버에서 실행되고, 사람 결정은 /decisions로 간다
});
```

- 도구 카드의 버튼은 assistant-ui의 tool result가 아니라 `/decisions` 명령을 보낸다. 사람의 결정이 모델 도구 경로를 거치지 않게 하기 위해서다.
- assistant-ui의 도구 UI 등록 API는 최근 `Toolkit` / `Tools()` 방식으로 바뀌었고 이전 방식(`makeAssistantToolUI`)은 deprecated다. 버전을 고정한다.

### 11.3 상태 화면

[09](09-client-opdc.md)의 화면 구성을 따른다. 각 화면이 읽는 스트림 주제:

| 화면 | 주제 |
|---|---|
| 홈 (Goal, Concern 트리, 복귀 요약) | index, tasks |
| Concern 상세 (루프 이력, 다음 예정, 사용 중인 가정, 하위 Concern) | concern:<id> |
| 질문함 | 모든 concern의 questions |
| 에이전트가 정한 것 | 모든 concern의 choices (autonomous) |
| 탐구 보드 (사실·원함·가능성·결과) | concern:<id>.inquiry |
| 근거 체인 | concern:<id>.observations / claims + conversation 항목 |
| 다이얼 | policy, concern 모드 |

## 12. 대표 흐름

### 12.1 약속과 확인 (스파이크로 확인한 흐름)

```text
사용자 입력 → Concern 대화 실행
모델: read_note (관찰 c1 기록)
모델: write_note → beforeTool: 합의 없음 → 차단 (blocked 진단 남음)
모델: helm_propose_agreement → 문서에 proposed
화면: 합의 카드 → 사용자 [확인] → POST /decisions agree → host commit
사용자 입력 "진행" → 모델: write_note 범위 밖 → 차단
모델: write_note 범위 안 → 관찰 c5
모델: "작성했습니다" → onYield: 제출 없음 → 계속 요청
모델: helm_submit_result(지어낸 근거) → 오류 반환
모델: helm_submit_result([c5]) → submitted
화면: 결과 카드 → 사용자 [확인] → accepted (actor: human)
```

### 12.2 원함 탐구 한 라운드

```text
Concern task (loop = I.want) → configure(원함 탐구 모드)
모델: helm_stimulus × n (일부는 분기 대화에서 생성, 서로 못 봄)
화면: 자극판 → 사용자 요소 단위 반응 → POST /reactions → 관찰로 기록
모델: helm_criterion_candidate (근거: 반응 관찰 id)
커널: 기준별 불확실성 계산 → 다음 자극 요구 사항을 투영에 넣음
… 라운드 반복 …
커널: 기준이 두 라운드 동안 안정 → 멈춤 → 화면에 기준 확인 요청
사용자 [확인] → 선호 모델(session 문서)에 기록, Goal에 연결
```

### 12.3 재시작

```text
서버 프로세스 종료 → 재시작 → Harness.open(같은 SQLite) → harness.resume()
→ 실행 중이던 Concern task가 마지막 checkpoint부터 재개 (스파이크로 확인)
→ 실행 중이던 도구 호출은 replay: "safe"면 다시 실행, 아니면 모델에게 중단 사실 전달
→ 클라이언트 재접속 시 현재 상태 스냅숏부터 수신
```

## 13. 테스트 전략

| 층 | 방법 |
|---|---|
| helm-kernel | 단위 테스트 + 무작위 입력 순서 속성 테스트 (불변조건 7개) |
| helm-durable | faux 공급자로 대본을 짠 통합 테스트. 스파이크 두 개가 첫 테스트가 됨. 재시작 테스트 포함 |
| helm-server | 명령 → 스트림 결과 검증 |
| helm-web | Playwright로 주요 흐름 (합의 카드, 결과 확인, 질문함, 이의) |
| 모델 품질 | 별도 평가 (예측 정확도, 선호 모델 안정, 이의 비율) |

## 14. 단계별 계획

| 단계 | 내용 | 완료 기준 | 크기 |
|---|---|---|---|
| M0 스파이크 | pi-durable 통합 지점 확인 | 완료 ([13 §3](13-stack-feasibility.md)) | 완료 |
| M1 커널 핵심 | schema, 승격, 의존 규칙, 질문 게이트, projection. helm.mjs를 TS로 옮기고 확장 | 불변조건 속성 테스트 통과 | M |
| M2 C/A 어댑터 | ConcernDoc, 관찰 래퍼, helm_propose_agreement·submit_result, beforeTool·onYield, Concern task(orient → loop → awaitChildren → closed), WorkUnit task | 12.1 흐름이 faux 대본과 실제 모델 모두에서 동작 | M |
| M3 서버와 웹 골격 | 명령 API, WebSocket 스트림, React 앱, assistant-ui 대화 패널, 합의·결과 카드, 에이전트가 정한 것 | 브라우저에서 12.1 흐름 수행, 새로고침 후 상태 복원 | M |
| M4 질문과 끼어들기 | 질문 레코드, 전달 방식, 만료점, 질문 스케줄러 task, 질문함 화면 | 사용자 부재 → 복귀 요약에 질문이 묶여 나옴 | M |
| M5 탐구 | 원함 탐구(자극판, 기준 후보, 선호 모델), 가능성 탐구(발산 표, 분기, 렌즈 라이브러리), 결과 탐구(예측 레코드, 타이머) | 실제 취향형 작업 하나를 끝까지 수행 | L |
| M6 상황 유형과 구조 루프 | 상황 판정, 루프 계획·전환, S 루프(분해·병합·재조합), 비상 합의 | 혼란 → 분해 → 하위별 조합 시나리오 통과 | M |
| M7 관찰 에이전트와 학습 | 이의 기록 기반 다이얼 조정 제안, 반복 패턴 → 절차 후보 | 제안이 생성되고 사람이 확인 | M |
| M8 두 번째 어댑터 | pi coding agent 확장 어댑터 (또는 다른 런타임) | 같은 커널로 다른 런타임에서 12.1 흐름 수행 | M |

M1~M3을 먼저 끝내고 2주 정도 실제로 써 본 뒤 M4 이후 순서를 다시 정한다. Helm 성숙도 모델의 "앞 단계의 사용자 가치를 확인한 뒤 다음 단계로" 원칙을 따른다.

## 15. 결정이 필요한 것

1. 클라이언트를 웹으로 먼저 만드는 것 (v0.2 D1 "CLI first"를 이 문서는 웹 우선으로 바꿔 제안한다. 상태 중심 화면을 TUI로 구현하기 어렵기 때문이다)
2. 워크스페이스당 SQLite 파일 하나 vs 전체 하나
3. 첫 실제 모델 공급자
4. 사람 결정 대기를 폴링에서 이벤트 기반으로 바꾸는 방식 (§6.2)
