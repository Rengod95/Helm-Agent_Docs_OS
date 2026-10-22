---
id: adr.0009
layer: adr
domain: agent-loop
kind: adr
status: accepted
depends_on: [adr.0003, adr.0004, adr.0007]
binds: [xeon/packages/core-loop/**, xeon/packages/contracts/src/conversation/**]
---

# ADR-0009 자체 에이전트 루프: pi-agent-core 루프 포크와 의존 제거

## 1. 상태와 날짜

- 상태: accepted
- 날짜: 2026-10-22
- [결정] pi-agent-core에 의존하지 않는다. pi-agent-core 1.3.0(MIT)의 루프를 core-loop로 포크해 Xeon 자체 에이전트 루프로 다시 설계한다. pi-agent-core는 구현·설계 참고로만 쓴다. pi-ai는 provider 층 의존으로 유지하고 부족분만 포크한다(사용자 지시 2026-10-22, 열린 차단 항목 응답 "pi agent core는 포크 떠서 Xeon 자체 에이전트 루프로 재설계").
- 근거 기록: `_research/decisions-log.md` 2026-10-21 첫 결정 "pi agent-core 루프는 고정 커밋으로 가져와 자체 유지"와 같은 방향이다. `_research/foundation-plan.md` §2 모델·루프 행의 "pi-agent-core 1.3.0 정확 고정 + 훅 래핑"은 이 ADR이 대체한다.
- 대체 범위: ADR-0003 §3.2 마지막 항목(L1-b 모델 호출부의 `pi-agent-core` 정확 고정 + 훅 래핑)을 대체한다. ADR-0003의 나머지 결정(durable env·tools·images·truncate 포크, 커널 직접 구현)은 그대로다.

## 2. 맥락

M1 구현(`bcd77b4`)은 `@earendil-works/pi-agent-core` 1.3.0의 `runAgentLoop`를 turn 하나의 실행 본체로 쓰고, Xeon 동작은 훅 7종과 이벤트 싱크로 붙였다(`L1.loop.spec` §3.2 이전 판). 구현에서 드러난 사실은 다음과 같다.

### 2.1 래퍼 비용

- `core-loop/src/agent-wrapper.ts`가 1,395줄이다. 커밋 지점 T2·T3는 싱크(`emit`)의 `switch` 안에서, T4는 `finishTurn` 훅 안에서 커밋한다. 루프의 단계 순서가 훅 호출 순서에 묶여 있어 커밋 순서를 코드에서 한눈에 읽을 수 없다.
- agent-core는 단계 중간부터 시작할 수 없다. 그래서 재개 `next: "tools"`·`await_input` 경로는 래퍼가 `runToolCall`로 도구 단계를 따로 돈다(`replayTools`, `runPendingCall`). 같은 도구 단계 규칙이 두 벌 있다.
- 재개 `request` 진입은 `step.started`가 이미 기록된 단계를 다시 열 때 `adoptFirstStep` 표시로 싱크의 T2를 건너뛴다. 루프 바깥 상태로 루프 안 동작을 고친다.
- steer 배치는 T4 커밋 결과를 `state.placedSteer`에 담아 두고 `getSteeringMessages` 콜백이 꺼내 가는 방식이다. 큐 의미를 Xeon이 정하는데 전달은 pi 콜백 시점을 따른다.
- `runAgentLoop([], { messages: [], tools: [] }, …)`로 빈 문맥을 넘기고 `prepareRequest` 훅에서 문맥을 바꿔 끼운다. 루프가 가진 메모리 배열(`context.messages`)은 쓰지 않는데 루프는 그 배열에 계속 push한다(판정표 A1).
- 중단 시 순차·병렬 모두 `break`로 남은 호출에 결과가 없다(판정표 A3). 래퍼가 단계 끝에서 `closeUnexecuted`로 메운다.
- `finishTurn` 결정은 `stopReason`이 `error`·`aborted`일 때 무시된다. 래퍼는 이를 알고 판정 순서를 맞춘다.

### 2.2 타입 경계와 단언

- F `contracts`가 pi-agent-core를 타입 의존으로 가진다(`conversation/pi.ts` 재노출, `hierarchy.ts`의 `declare module "@earendil-works/pi-agent-core"` 선언 병합). F 계약이 외부 패키지의 모듈 이름과 병합 규칙에 묶인다.
- pi의 `AgentEvent`·`AgentTool`은 `any`를 쓴다(`args: any`, `result: any`, `partialResult: any`, `TDetails = any`). 래퍼는 `tool_execution_end.result`의 `terminate`를 `unknown` 좁히기로 다시 읽는다.
- `core-loop/src/pi-bridge.ts`가 읽기 전용 배열을 가변 배열로 복사하는 함수 8개와 `as unknown as` 단언 하나(`toPiStream`)를 둔다. F의 `AssistantMessageEventStream`은 소비 계약 인터페이스이고 pi-ai의 같은 이름은 `#private` 클래스라서, agent-core `StreamFn`에 넘길 때 단언이 필요하다. 이 단언은 루프를 외부 패키지에 맡긴 구조에서 생긴다(`eng.typescript.guide` TY 규칙의 단언 금지 예외로 남아 있다).
- `AgentToolHooks`는 pi에 없는 이름이라 F가 `Required<Pick<AgentLoopConfig, …>>`로 파생한다. `ToolService.hooks()`·`observe()`가 pi 훅 모양과 pi 이벤트 모양을 L1 서비스 계약에 끌어온다.

### 2.3 버전 추종

- pi-agent-core는 pi-ai와 typebox를 정확 고정한다(1.3.0 `package.json`: `@earendil-works/pi-ai` 1.3.0, `typebox` 1.3.27). pi-ai를 올리면 agent-core도 같은 판으로 올려야 하고, 그때마다 훅 7종의 시그니처·호출 위치·이벤트 순서를 다시 대조해야 한다(`L1.loop.plan` §4 업그레이드 체크리스트 8단계).
- 훅 의미는 문서 주석으로만 정해져 있고 CHANGELOG에 빈 절이 있다(`_research/notes/L1-1.md` §2). 의미가 바뀌어도 타입 검사에 걸리지 않는다.
- Xeon 계층 설계(단계 경계 커밋 S1·C3·E1~E3·C5, 확장 지점 on·post·drive·scope, drive 임대)는 pi 루프 바깥에서 붙인 것이라, pi 판이 바뀔 때마다 래퍼를 다시 맞춰야 한다.

### 2.4 포크 대상의 크기

- agent-core 1.3.0 TS 원본은 2,519줄이다(`agent-loop.ts` 949, `agent.ts` 613, `types.ts` 539, `proxy.ts` 393, `stream-fn.ts` 20, `index.ts` 5). 1.3.0 `dist/*.js.map`의 `sourcesContent`는 1.1.0 소스(`~/projects/_ref/pi-src/packages/agent/src`)와 바이트 동일하다(`_research/notes/L1-1.md` §0). tarball sha1은 `aec4d26bf7cdab5bca2a129f6a6dffc606c892db`다.
- Xeon이 쓰는 부분은 `agent-loop.ts`의 `runLoop`, `streamAssistantResponse`, 도구 배치 실행(순차·병렬), `failToolCallsFromTruncatedMessage`와 `types.ts`의 메시지·도구·이벤트 타입이다. `Agent` 클래스, `proxy.ts`, `stream-fn.ts`(전역 기본 streamFn), `agentLoop`·`agentLoopContinue`의 `EventStream` 포장은 쓰지 않는다.
- 루프가 부르는 pi-ai 값 함수는 6개다: `EventStream`, `getCurrentTools`, `getToolStateChanges`, `normalizeContext`, `toToolDeclaration`, `validateToolArguments`(`agent-loop.ts:6-17`). DR-07에 따라 pi-ai 값 import는 core-models만 한다.
- 라이선스는 MIT다(`Copyright (c) 2025 Mario Zechner`, pi 저장소 루트 `LICENSE`). npm tarball에는 LICENSE 파일이 없고 `package.json`의 `"license": "MIT"`만 있다.

## 3. 결정

### 3.1 의존 제거와 소유

1. [결정] `@earendil-works/pi-agent-core`를 워크스페이스 의존에서 뺀다. `core-loop`, `contracts`의 `package.json`, bun catalog, `contracts/src/conversation/pi.ts` 재노출, `hierarchy.ts` 선언 병합, `core-loop/src/pi-bridge.ts`, 테스트(`pi-types.test.ts`의 agent-core 항등 검사)에서 모두 지운다. 이후 어느 패키지도 pi-agent-core를 import하지 않는다. `eng.dependency-rules.guide` DR-07 소유 표에서 그 행을 "전부 금지"로 바꾼다.
2. [결정] pi-ai는 그대로 의존한다. 소유는 `core-models`(DR-07)이고, F는 `import type`·`export type`으로 재노출한다(`F.conversation.spec` §3.1).
3. [결정] 루프 본체는 `core-loop`가 소유한다. 포크한 코드도 `core-loop` 안에 둔다(ADR-0003 §3.4와 같은 배치 규칙: 포크를 소비하는 패키지 안).

### 3.2 F 타입

[결정] 루프가 내고 받는 타입은 F `@xeon/contracts/conversation`이 직접 정의한다. pi-ai 타입(메시지, 콘텐츠 블록, 스트림 이벤트, `Tool`, `Usage` 등)은 계속 재노출한다.

| 이름 | 처리 |
|---|---|
| `AgentMessage` | F 정의. `Message \| XeonCustomMessage` 닫힌 유니온. 선언 병합(`CustomAgentMessages`)은 없앤다. 확장 구분은 지금처럼 `customType`으로 한다 |
| `AgentEvent` | F 정의. 변형 `type` 이름은 pi와 같게 둔다(확장 지점 이름과 `F.conversation.spec` §3.5.4 대응표가 이 이름을 쓴다). `any` 필드는 `JsonObject`, `AgentToolResult`, `JsonValue`로 좁힌다 |
| `AgentTool`, `AgentToolResult`, `AgentToolCall`, `AgentToolUpdateCallback`, `ToolExecutionMode`, `AgentContext` | F 정의. `AgentTool`은 pi-ai `Tool`을 확장한다. `TDetails` 기본값은 `JsonValue`다 |
| `BeforeToolCall*`, `AfterToolCall*`, `AgentToolHooks`, `CustomAgentMessages` | 없앤다. 도구 실행은 §3.4의 `ToolService` 단계 계약으로 넘긴다 |
| `StreamFn`, `AssistantMessageEventStream` | 지금처럼 F가 소비 계약으로 적는다. pi-ai 클래스는 이 인터페이스를 만족한다(타입 테스트). 루프가 받는 쪽도 F 타입이므로 단언이 필요 없다 |

- `AgentEvent`·`AgentTool` 정의는 pi-agent-core 1.3.0 `types.ts`에서 출발한다. 같은 필드 이름을 쓰는 이유는 기록된 이벤트 payload(`item.recorded`의 메시지, `effect.result`의 결과 레코드)가 pi 메시지 모양을 그대로 담기 때문이다.

### 3.3 core-loop 자체 루프

[결정] turn 하나는 Xeon 루프 함수 호출 하나다. 루프는 진입점, 단계 순서, 커밋 지점, 확장 지점 발화, 취소, 입력 큐 소비를 직접 정한다. 훅 콜백으로 바깥 동작을 끼우지 않는다.

옮겨 오는 것(포크, 원본 구조 유지):

| 원본(`agent-loop.ts`, 1.3.0) | Xeon 위치 | 바꾸는 점 |
|---|---|---|
| `runLoop` 안쪽 반복(163-321): 도구 호출이 있거나 대기 메시지가 있으면 다음 요청 | `core-loop/src/loop/run-turn.ts` | 바깥 반복(follow-up 큐)은 뺀다. followUp은 새 turn이다(`F.extensions.spec` §4.4). 단계 경계마다 커밋 지점을 명시 단계로 부른다 |
| `streamAssistantResponse`(381-476): 부분 메시지 교체, `done`·`error`에서 최종 메시지, 시작 이벤트 없는 응답 처리 | `core-loop/src/loop/stream-response.ts` | 문맥 배열에 push하지 않는다. 결과 메시지와 이벤트만 낸다. `getApiKey`·`apiKey` 처리는 없앤다(core-models가 키를 임대한다) |
| `failToolCallsFromTruncatedMessage`(478-506): `stopReason: "length"`면 도구 호출 전부 실패 결과 | `core-loop/src/loop/tool-batch.ts` | 결과 기록은 core-tools 단계 계약(`settleRejected`)으로 한다 |
| `executeToolCallsSequential`·`Parallel`(530-660): 준비는 차례로, 허용된 호출은 병렬 실행, `tool_execution_end`는 완료 순, 결과 메시지는 원래 순서 | `core-loop/src/loop/tool-batch.ts` | 준비·실행·마감 각 단계를 core-tools에 넘긴다(§3.4). 중단 시 `break` 대신 남은 호출을 같은 배치 안에서 `not_executed`로 닫는다 |
| `shouldTerminateToolBatch`(690-692): 배치의 모든 결과가 `terminate`일 때만 멈춤 | `core-loop/src/loop/tool-batch.ts` | 그대로 |
| `types.ts` 메시지·도구·이벤트 타입 | F `contracts/src/conversation/agent.ts` | §3.2 |

다시 설계하는 것:

| 주제 | pi 방식 | Xeon 루프 |
|---|---|---|
| 진입점 | `runAgentLoop`(새 프롬프트), `runAgentLoopContinue`(마지막이 assistant면 거부) | `runTurn(entry)` 하나. `entry.kind`가 `fresh`, `request`(다음 또는 끊긴 단계 요청), `tools`(T3 뒤 도구 단계 중간), `turn_end`다. 재개 `next` 판별자가 그대로 진입점이 된다(`L1.loop.spec` §4.5) |
| 단계 경계 커밋 | 없음(래퍼가 싱크·훅에서 커밋) | 루프 단계 함수가 순서대로 부른다: T1/C2 → S1(`step.started`) → 요청 → `message_end` chain → C3(응답, `next:"tools"` 체크포인트) → 도구 배치(E1~E3는 core-tools) → `turn_end`·`agent_before_settle` chain → C5(`step.completed` + 체크포인트 + 엔트리 + 배치) → … → C6. 커밋 실패는 값(`Result`)으로 돌아와 run을 끝낸다 |
| 확장 지점 | 없음(이벤트만) | on: 단계 함수가 지점을 직접 발화한다(tap은 커밋 뒤, chain은 커밋 전). post: C5의 `inputs.drain` 결과가 다음 요청 앞에 붙는다. drive: `LoopPort.runTurn` 진입과 단계 경계의 drive 신호 확인. scope: C5 뒤 적용된 토글을 다음 S1의 도구 광고가 읽는다 |
| 문맥 | 루프가 `context.messages` 배열을 들고 push | 루프는 메시지 배열을 들고 있지 않다. 요청마다 L1.context가 커밋된 이벤트에서 다시 만든다. 단계 안 메시지(응답, 도구 결과)는 커밋된 뒤에만 다음 요청에 들어간다 |
| 모델·추론 레벨 변경 | `prepareRequest`·`prepareNextTurn` 반환값 | S1 직전에 xeon.models가 단계 바인딩을 정한다. 체크포인트 `model` 필드와 같은 값이다 |
| 도구 선언 차이 | 루프 안 `declareToolChanges`(pi-ai 값 함수 사용) | core-models가 감싼 함수로 차이를 구하고 system item으로 기록한다. 기록 위치는 지금과 같은 C3다 |
| steer·aside·next | `getSteeringMessages` 콜백 | C5 커밋 안의 `inputs.drain`이 고른 메시지를 단계 결과로 돌려받아 다음 요청 앞에 둔다. 콜백이 없다 |
| follow-up | `getFollowUpMessages` 콜백, 바깥 반복 | 없음. 새 turn |
| 완료 게이트 | `finishTurn`의 `{action:"continue"}` | 단계 결과 `next: "request"`를 직접 고른다. 정착 후보 판정과 게이트 상한은 루프 코드다 |
| 취소 | `AbortSignal` 인자, 단계마다 `signal?.aborted` 확인 | turn 범위 노드의 `CancelScope`(ADR-0003 §3.1, `L1.tasks.spec` §3.2)를 받는다. 확인 위치는 요청 전, 스트림 뒤, 순차 호출 사이, 병렬 실행 전, 단계 끝이다. 중단되면 남은 호출을 같은 배치 안에서 닫고 C5까지 간다 |
| 오류 처리 | 훅이 던지면 run 실패, `convertToLlm` 등은 "던지지 말 것" 계약 | 예상 가능한 실패(커밋 `busy`·`err`, 모델 해석 실패, 컨텍스트 조립 실패, 도구 거부)는 `Result`와 판별 유니온으로 돌려준다. `Bug`는 루프 불변식 위반(열린 단계 없이 C5 등)에만 던진다(`eng.typescript.guide` TY-11) |
| 이벤트 싱크 | 이벤트마다 `await emit` | 싱크는 매퍼(휘발 알림)와 tap 발화만 한다. 커밋하지 않는다 |
| 전역 상태 | `getDefaultStreamFn`, `setDefaultStreamFn` | 없음. streamFn은 항상 인자다 |

### 3.4 도구 실행 넘김

[결정] 도구 한 호출의 준비·실행·마감은 core-tools가 하고, 배치 스케줄(순차·병렬, 이벤트 순서, 중단, `terminate` 규칙, `length` 실패)은 core-loop가 한다. `ToolService`의 `toAgentTools`·`hooks`·`observe`와 core-loop의 `runToolCall` 사용은 단계 계약으로 바꾼다 [제안: 이름과 시그니처는 `L1.tools.spec` §3.3에서 정한다].

```ts
// F @xeon/contracts/services tools.ts (개요). 실패는 값으로 돌려준다
export type CallPreparation =
  | { readonly kind: "ready"; readonly call: PreparedCall }          // 정책 허용, E1 intent 커밋됨
  | { readonly kind: "settled"; readonly outcome: ToolCallOutcome }; // 미발견·인자 오류·거부·중단: 결과까지 기록됨

export interface ToolStepPort {
  /** 도구 조회, 인자 준비·검증, tool_call 지점, 정책·승인, E1. 차례로 부른다 */
  prepare(call: AgentToolCall, assistant: AssistantMessage, run: ToolRunContext): Promise<CallPreparation>;
  /** E2, 실행, tool_result chain, E3 + toolResult item. 병렬로 불러도 된다 */
  execute(call: PreparedCall, onUpdate: AgentToolUpdateCallback, run: ToolRunContext): Promise<ToolCallOutcome>;
  /** 실행하지 않은 호출을 이유와 함께 닫는다(중단, length 절단) */
  settleRejected(calls: readonly AgentToolCall[], reason: "not_executed" | "truncated", run: ToolRunContext): Promise<readonly ToolCallOutcome[]>;
}
```

- 인자 검증은 core-tools가 typebox로 한다. pi-ai `validateToolArguments`의 정규화(선택 null 제거, `Value.Convert`)가 필요하면 core-models가 그 함수를 감싸 `Result`로 돌려주는 메서드를 둔다. pi-ai 값 import는 core-models 밖으로 나가지 않는다(DR-07).
- `afterToolCall` 병합 규칙(`content`만 바꾸면 `structuredContent`를 버림, 얕은 필드 교체)은 core-tools의 `tool_result` 처리로 옮긴다(`agent-loop.ts:859-910`).
- 재개 때 결과 불명 효과의 재실행은 지금처럼 `ToolService.rerun(intent)`이다.

### 3.5 pi-ai 값 함수 감싸기

[결정] 루프가 쓰던 pi-ai 값 함수는 core-models가 `ModelService`에서 감싼다. core-loop는 pi-ai를 import하지 않는다.

| pi-ai 함수 | 감싸는 곳 |
|---|---|
| `normalizeContext` | 구현에서 F `StreamFn`의 컨텍스트 인자를 `Context`(`messages`만)로 바꿨다. `TranscriptContext`는 `normalizeContext`만 만들 수 있어 루프가 만들 수 없다. 정규화는 `Models.streamSimple` 안에서 pi-ai가 한다(이행 때 확인). 루프는 변환(`convertToLlm`, L1.context)만 한다 |
| `getCurrentTools`, `getToolStateChanges`, `toToolDeclaration` | 감싸지 않았다. L1.context가 고정 접두의 `toolsAdded`로 선언하고 `pendingItems`로 돌려주므로 `declareTools`는 필요 없었다(이행 때 확인) |
| `validateToolArguments` | 필요할 때 `ModelService` 메서드로 감싸 `Result`로 돌려준다(§3.4) |
| `EventStream` | 쓰지 않는다. 루프는 싱크 함수만 쓴다 |

### 3.6 출처와 라이선스

[결정] 포크 기록은 ADR-0003 §3.4 규칙을 따른다.

- 원본: `https://github.com/earendil-works/pi`, `packages/agent/src/{agent-loop.ts,types.ts}`, npm `@earendil-works/pi-agent-core@1.3.0`(tarball sha1 `aec4d26bf7cdab5bca2a129f6a6dffc606c892db`)의 `dist/*.js.map` `sourcesContent`. 1.1.0 소스와 바이트 동일하다.
- `core-loop/UPSTREAM.json`: `upstream`, `version: "1.3.0"`, `license: "MIT"`, `copiedPaths`(원본 함수 → Xeon 파일), `notCopied`(`agent.ts`, `proxy.ts`, `stream-fn.ts`, `agentLoop`, `agentLoopContinue`, `declareToolChanges`), `modifications`.
- `core-loop/LICENSE.pi`: pi 저장소 루트 `LICENSE`(MIT) 원문 사본.
- 옮긴 함수가 있는 파일 머리에 출처 주석을 단다: `// Derived from pi-agent-core 1.3.0 agent-loop.ts <함수 이름> (MIT, Copyright (c) 2025 Mario Zechner). See LICENSE.pi.`
- 원본 구조에서 벗어난 줄에는 `// XEON-PATCH: <id>`를 단다. 자체 설계로 새로 쓴 파일(`step-end.ts` 등)에는 달지 않는다.
- 배포물 서드파티 고지에 pi(MIT) 항목을 넣는다(ADR-0003 §3.4 마지막 항목과 같은 파일).
- 원본 코드를 받을 때는 tarball을 풀어 읽기만 한다. 패키지 코드나 `~/projects/_ref`의 코드를 실행하지 않는다.

### 3.7 업스트림 추종

[결정] pi-agent-core 새 판을 따라가지 않는다. 버그 수정이나 개선이 필요할 때만 원본 diff를 읽고 해당 부분을 손으로 옮긴다. 옮기면 `UPSTREAM.json`의 `modifications`에 원본 판과 함수를 적는다. pi-ai 판 올림은 core-models 소관이고 루프 계약 테스트(`L1.loop.plan` §5)로 확인한다.

## 4. 결과

### 4.1 좋은 점

- 커밋 지점과 확장 지점의 순서가 루프 코드의 순서와 같다. 훅 호출 순서를 대조하는 계약 테스트와 업그레이드 체크리스트가 필요 없다.
- 재개가 일반 진입점이 된다. `tools`·`await_input`·`request` 재진입을 위한 별도 경로(`replayTools`, `runPendingCall`, `adoptFirstStep`)가 사라진다.
- 단언과 복사 함수가 사라진다. `pi-bridge.ts`의 `as unknown as`와 배열 복사 8개를 지운다. F 타입이 `any` 없이 닫힌다.
- F 계약이 외부 패키지의 선언 병합에 묶이지 않는다. `contracts`의 외부 타입 의존은 pi-ai 하나로 줄어든다.
- typebox 정확 고정을 가진 외부 패키지가 pi-ai 하나로 줄어든다(review.decisions-2 U-24).
- 중단 때 남은 호출, 정착 직전 지점, 게이트 계속처럼 훅으로 우회하던 항목(`L1.loop.spec` 이전 판 §3.3 판정표 A1·A3·A4·A5와 추가 2행)을 루프 코드에서 직접 정한다. A4(실행 인자 교체)는 포크 조건 없이 2차 chain 지점 도입 때 core-tools 계약으로 더할 수 있다.

### 4.2 감수할 점

- 루프 코드를 직접 유지한다. 원본 기준 약 600줄(`runLoop`, `streamAssistantResponse`, 도구 배치)을 옮기고, 래퍼 1,395줄을 다시 나눈다.
- pi 루프의 버그 수정을 자동으로 받지 않는다. §3.7의 수동 추종만 있다.
- pi 생태계 확장(pi-coding-agent 확장 등)이 pi-agent-core 타입을 기대하면 그대로 붙지 않는다. Xeon 확장 API는 F 타입을 쓰므로 영향은 X 가상 모듈(`X.loading-trust.spec` §4 가상 모듈 표의 `@earendil-works/pi-agent-core` 행)에 한정된다. 제공 여부는 §6 미결로 둔다.
- 이행 중 core-loop, core-tools, contracts, core-models가 한 묶음으로 바뀐다. 이행 순서는 `L1.loop.plan` §3 LP16~LP21이다.

## 5. 대안

| 안 | 내용 | 채택하지 않은 이유 |
|---|---|---|
| A. 의존 유지 + 훅 래핑(이전 결정) | npm 1.3.0 정확 고정, 훅 7종 래핑 | §2의 래퍼 비용, 단언, 판마다 훅 의미 재대조 |
| B. vendor 포크(원본 파일 그대로 + 패치) | `agent-loop.ts`, `types.ts`를 `core-loop/vendor/`에 두고 `XEON-PATCH`로 최소 수정(이전 판 판정표의 포크 후보 방식) | 원본 구조(훅 콜백, 메모리 문맥 배열, `any` 타입)가 남아 래퍼 비용이 그대로다. 패치가 커질수록 원본과 대조하는 이점도 줄어든다 |
| C. 처음부터 새로 작성 | pi 코드를 보지 않고 설계 | 검증된 스트림 처리·병렬 배치 순서 규칙을 다시 찾아야 한다. MIT라 옮겨 쓰는 비용이 낮다 |
| D. pi-ai도 함께 제거 | provider 층까지 자체 구현 | provider 수와 provider별 차이 처리가 크다. 사용자 결정은 pi-ai 유지다 |

## 6. 미결 사항

- [미결] X 가상 모듈 `@earendil-works/pi-agent-core`(pi 확장 호환용)를 계속 제공할지, 제공하면 F 타입으로 별칭을 둘지(`X.loading-trust.spec` §4 가상 모듈 표). 그 문서 §10에 같은 미결을 더한다.
- [미결] 도구 선언 차이 system item을 C3에 둘지 S1에 둘지. 이 ADR은 지금 위치(C3)를 유지한다. S1로 옮기면 요청 전에 기록되어 재개 때 요청 컨텍스트 재구성이 단순해진다.
- [가정] core-tools가 typebox만으로 pi-ai `validateToolArguments`와 같은 결과를 낼 수 있다. 다르면 §3.5 표의 감싸기 메서드를 쓴다. 이행 작업 LP18의 첫 테스트로 확인한다.

## 7. 이행 기록

이행(`L1.loop.plan` LP16~LP21)은 2026-10-23에 끝났다. 설계와 달라진 점을 적는다. 결정은 바뀌지 않았다.

- 도구 단계 계약(§3.4): `ToolService`의 `prepare`·`execute`·`settleRejected`와 함께 `rerun`도 `ToolCallOutcome`을 돌려준다. `ToolCallOutcome`은 `toolCall`, `state`(`executed`·`rejected`·`not_executed`·`truncated`), `result`, `isError`, `durationMs`, 기록한 `message`와 `itemId`(결과 기록 커밋이 실패하면 `null`)를 가진다. 거부·중단·절단 호출의 toolResult item도 core-tools가 기록한다(`effectId: null`). 루프는 toolResult item을 직접 커밋하지 않는다. `ToolService.settledItem`은 없앴다.
- `afterToolCall` 병합 규칙(§3.4 둘째 항목)은 옮길 대상이 없다. core-tools가 결과를 직접 만들므로 "덮어쓰기 객체"가 없고, `structuredContent` 처리는 `execute`의 마감이 한다.
- tool tap 3종(`tool_execution_*`)은 core-tools가 `prepare`·`execute`·`settleRejected` 안에서 발화한다. 이전의 `ToolService.observe`는 없다.
- 인자 검증(§3.4 첫째 항목): core-tools `validate.ts`가 pi-ai `validateToolArguments`의 TypeBox 경로를 옮겼다. 사례 시험(`validate.test.ts`)으로 같은 결과를 고정했다. §6 [가정]은 TypeBox 스키마에 대해 성립했다. TypeBox 표지가 없는 순수 JSON Schema(MCP 도구)의 coerce 경로는 옮기지 않았고 M2 cap-mcp에서 `ModelService`의 감싸기 메서드(§3.5)로 더한다.
- `ToolMeta.executionMode`를 더했다. 루프가 배치를 순차·병렬로 정할 때 쓴다.
- F `StreamFn`의 컨텍스트 인자를 `TranscriptContext`에서 `Context`로 바꿨다(§3.5 표). `declareTools`는 만들지 않았다(L1.context가 접두의 `toolsAdded`로 선언한다).
- 단계 반복은 `StepNext.kind === "request"`인 동안 꼬리 호출(`requestLoop`)로 이어진다. `no-await-in-loop` 예외를 두지 않기 위해서다.
- `StepNext`는 `request`·`settle`·`stop` 셋이다. 승인 대기(`await_input`)는 도구 단계의 대기 체크포인트가 맡고, 한도 도달(`step_limit`·`external`)은 `settle`과 turn 상태(`endReason`)로 T6 status에 반영한다.
- `AgentTool.prepareArguments`는 F 타입에서 뺐다(인자 준비는 `prepare`가 한다).
- 포크 기록: `core-loop/UPSTREAM.json`, `LICENSE.pi`, `PATCHES.md`, `test/fork-records.test.ts`(패치 id 세 곳 일치와 출처 주석 검사). 패치 id는 슬러그다(`entry-points`, `no-outer-loop`, `step-functions`, `no-context-array`, `no-api-key`, `model-slot`, `batch-cancel`, `batch-length`, `batch-record`).
- `check-layers.ts`에는 `MODULE_OWNERS` 표가 없다(DR-07의 표는 문서뿐이다). 층 검사는 각 `package.json`의 의존 선언과 import 일치로 한다. 이행 뒤 어느 `package.json`에도 pi-agent-core가 없고 `bun.lock`에서 사라졌다.
- 타입 시험 파일 이름은 기존 관례를 따라 `agent-types.test.ts`, `no-pi-agent-core.test.ts`다(`F.conversation.plan`은 `.type-test.ts`로 적었다).
