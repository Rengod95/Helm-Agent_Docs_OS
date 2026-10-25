---
id: L1.loop.plan
layer: L1
domain: loop
kind: plan
status: draft
depends_on: [L1.loop.spec, L1.tasks.plan, L1.persistence.plan, L1.tools.plan, L1.models.plan, eng.testing.guide, eng.toolchain.guide, adr.0009]
binds: [xeon/packages/core-loop/**]
---

# L1 에이전트 루프 구현 계획 (loop)

대상 패키지는 `xeon/packages/core-loop`다. M1 구현(`bcd77b4`)은 pi-agent-core `runAgentLoop` 위의 래퍼(`agent-wrapper.ts`)로 되어 있다. adr.0009에 따라 pi-agent-core 루프를 포크한 자체 루프로 옮긴다. 이행 작업은 §3의 LP16~LP21이다. 이 문서는 계획만 정하고 코드는 고치지 않는다. 인터페이스와 동작은 `L1.loop.spec`이 정본이다.

## 1. 목표와 마일스톤 배치

마일스톤 매핑은 `_research/layer-plan-v2.json` L1-b의 1차/2차/보류 표시와 `product.scope.spec` §4.3을 근거로 한 [제안]이다.

| 마일스톤 | 범위 | L1-b 구성요소(계획 단계) |
|---|---|---|
| M0(선행, 다른 패키지) | `contracts`의 F 타입(`AgentEventMapper` 시그니처, `StepCheckpoint`, `POINTS`, `BoundaryValue`), `platform-store`, `core-persistence` 커밋 API, `ext-host` 디스패치 최소형 | — |
| M1 걸어 다니는 골격 | 자체 루프(진입점 `runTurn(entry)`, 단계 함수, 도구 배치), 이벤트 매퍼, 커밋 지점 T1~T4·T6, 단계 체크포인트, 재개 진입(`next` 판별자 전부), 입력 admit(`input` 지점), 모델 테이프 한 턴과 강제 종료 뒤 재개(`_research/foundation-plan.md` §6 M1 스모크), `l1.loop.maxSteps` | 턴 사이클(1차), 예산 pi 방식의 단계 상한·중단(1차), 단계 전 준비 훅(1차) |
| M2 L2 능력과 Helm(`product.scope.spec` §4.3) | 완료 게이트 횟수 상한(`l1.loop.gate.maxContinues`), drive 연동(`loop.turn` 멱등)의 정식 테스트, 추론 예산 설정 연결(`thinkingBudgets`), `user_bash` 진입점, `await_input` 재진입의 승인 응답 연결, 자식 thread turn 진입점 `runChildTurn`(L1.agents M2) | 완료 게이트(2차 구성요소의 앞당김), 예산의 추론 레벨별 토큰 예산(1차) |
| M3 | 목표 판정 소비 지점(`agent_before_settle` 핸들러 계약, `L2.work.spec`·`L1.agents.spec`과 함께) | (L2-e 목표 지속과 연결) |
| 2차(M3 이후) | 반복 감지(`l1.loop.repeat.*`) | 반복 감지(2차) |
| 제외 | 입출력 가드레일. 이름만 예약한다(`L1.loop.spec` §4.11) | 입출력 가드레일(보류) |

- drive 연동의 기본 경로(`LoopPort.runTurn`, `(scopeId, requestId)` 조회)는 M1 스모크의 "drive 그룹 토글이 단계 경계에서 적용"에 필요하므로 M1에 최소형을 둔다. 장애 주입을 포함한 정식 테스트는 M2다 [제안].
- 완료 게이트는 계획상 2차지만 drive와 목표 판정의 계속 지시가 M2·M3에 들어오므로 상한을 M2에 둔다 [제안]. `L1.readme` §9 표와 각주에 같은 배치를 적는다.

## 2. 패키지와 파일 배치

자체 루프 이행(adr.0009) 뒤의 배치다. M1 구현(`bcd77b4`)의 `agent-wrapper.ts`(1,395줄)와 `pi-bridge.ts`는 없앤다.

```text
xeon/packages/core-loop/
  package.json              # dependencies: "@xeon/contracts", "@xeon/ext-host", "typebox". pi-agent-core·pi-ai 없음
  UPSTREAM.json             # pi-agent-core 1.3.0 출처, copiedPaths, notCopied, modifications (adr.0009 §3.6)
  LICENSE.pi                # pi 저장소 MIT LICENSE 원문 사본
  src/
    loop/                   # 자체 루프 본체. 원본 대응이 있는 파일은 머리에 출처 주석
      types.ts              # TurnEntry, ToolCallResume, StepNext, LoopFailure, TurnRunSpec (내부)
      turn-run.ts           # TurnRun(상태와 도우미): 단계 함수가 나눠 쓰는 값, 커밋·모델·도구 실행 맥락
      sink.ts               # 이벤트 싱크: 매퍼 + tap 발화만, 커밋하지 않는다
      run-turn.ts           # runTurn(ctx, spec), requestLoop, 진입 분기. 원본 runLoop 안쪽 반복(163-321)
      finish-turn.ts        # T6: 소유 작업 정착 뒤 turn.completed, agent_end tap
      prepare-request.ts    # 모델 바인딩, 도구 광고, 커밋된 이벤트로 컨텍스트 조립
      open-step.ts          # agent_start, 단계 시작 알림, S1(T2) 커밋, turn_start tap, 배치 입력 메시지 이벤트
      stream-response.ts    # modelCalls 슬롯, streamFn 호출, 부분 메시지 처리. 원본 streamAssistantResponse(381-476)
      commit-response.ts    # message_end chain, 도구 선언 차이 item, C3(T3) + next:"tools" 체크포인트
      tool-batch.ts         # 순차·병렬 스케줄, 이벤트 순서, 취소 시 not_executed, length 절단, terminate. 원본 508-692
      step-end.ts           # turn_end·agent_before_settle chain, 정착 후보, finalizeBoundary, 계속 판정, C5(T4) + drain → StepNext
      before-start.ts       # before_agent_start chain, prestart 커밋
    event-mapper.ts         # createAgentEventMapper(F 시그니처) + bindItem
    volatile.ts             # 휘발 envelope 발신(n, afterSeq, 묶음, 자르기)
    checkpoint.ts           # finalizeBoundary, StepCheckpoint 채우기
    commits.ts              # T1~T6 CommitRequest 구성, 커밋 키
    commit.ts               # commitWithRetry. 결과는 Result
    resume.ts               # 마지막 체크포인트 → TurnEntry. 열린 turn 찾기, 취소 의도 판정
    budget.ts               # maxSteps, drive 신호, canContinue
    completion-gate.ts      # 정착 후보 판정, 게이트 계속 상한 (M2)
    repeat-detector.ts      # 반복 감지 (2차)
    thread-gate.ts          # thread별 turn 시작 직렬화(구동기)
    turn-start.ts           # T1
    service.ts              # LoopService 조립
    settings.ts             # defineSettings("l1.loop", …)
    plugin.ts               # ext-host 플러그인 API로 xeon.loop 제공
    index.ts
  test/
    tapes/                  # *.tape.jsonl (eng.testing.guide TS-04, TS-06)
    support/                # 가짜 서비스, 하네스
    loop/run-turn.test.ts
    loop/stream-response.test.ts
    loop/tool-batch.test.ts
    loop/step-end.test.ts
    loop/upstream-parity.test.ts     # 원본 agent-loop 시험에서 옮긴 이벤트 순서 사례
    event-mapper.test.ts
    checkpoint.test.ts
    checkpoint.fault.test.ts
    resume.test.ts
    budget.test.ts
    completion-gate.test.ts
    drive.test.ts
    child-turn.int.test.ts
    user-bash.test.ts
    loop.contract.test.ts            # 확장 지점·커밋 순서, import 검사 (이전 agent-wrapper.contract.test.ts)
```

- 모델 테이프 가짜는 `eng.testing.guide` TS-04가 정한 `@xeon/core-models/testing`(`loadTape`, `tape`, `tapePlayer`, `contextHash`, `t`)을 테스트 파일에서만 import한다(DR-08, DR-14 예외 3). 테이프 파일은 `core-loop/test/tapes/`에 둔다(TS-06).
- `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`는 import하지 않는다(DR-07, adr.0009). streamFn과 도구 선언 차이 계산은 `xeon.models` 서비스에서 받고, 대화 타입은 `@xeon/contracts/conversation`의 F 정의를 쓴다.
- `loop/` 아래 파일 중 원본 함수에서 출발한 것(`run-turn.ts`, `stream-response.ts`, `tool-batch.ts`)은 머리에 출처 주석을 단다. 원본 구조에서 벗어난 줄에는 `// XEON-PATCH: <id>`를 단다. 나머지는 자체 코드다.
- 스모크 시나리오 테스트(`*.scenario.test.ts`)는 `apps/cli/test/`에 하나만 둔다(TS-01, TS-06). core-loop는 그 스모크가 쓰는 테이프 일부를 함께 만든다.

## 3. 작업 분해

작업 id는 층 이름(L1, L2)과 다른 도메인 plan의 id와 겹치지 않도록 `LP` 접두를 붙인다. 다른 plan의 작업은 "문서 id + 작업 id"로 적는다. 규모: S(반나절 이하), M(1~2일), L(3일 이상).

| id | 내용 | 선행 | 규모 | 마일스톤 |
|---|---|---|---|---|
| LP0 | F 요청 반영 확인: `ports.ts`와 `@xeon/contracts/services`의 L1 서비스 타입(FR-L1, review.decisions-2 D-04), `TurnStartedPayload.scopeId`(FR-L8), T3 체크포인트 허용(FR-L3), `turn.completed` 추가 행(FR-L4). 미반영이면 해당 동작을 [가정]으로 구현하지 않고 대기 | M0: contracts | S | M1 착수 조건 |
| LP1 | (완료, LP16~LP21로 대체) 래퍼와 훅 연결: `runAgentLoop([], context)`, `AgentLoopConfig` 조립, streamFn의 `modelCalls` 슬롯 감싸기, 재진입 금지, run 거부 → T6 `failed` | LP0, M0: core-persistence 커밋 API, L1.tasks.plan TK-1·TK-6 | M | M1 |
| LP2 | `AgentEventMapper` 구현과 골든 테스트: F.conversation §3.5.4 표 전 행, `bindItem`, 결정적 id 순서 | M0: contracts F.conversation 매퍼 타입 | M | M1 |
| LP3 | 휘발 이벤트 발신자: `VolatileEventEnvelope` 구성, `(threadId, turnId)`별 `n`, `afterSeq = headSeq()`, 50 ms 묶음, 16 KiB 자르기 | LP2, M0: core-persistence `headSeq`·휘발 피드 | S | M1 |
| LP4 | 단계 커밋 요청 구성: T1~T4·T6의 `CommitRequest`(persistence `commit` 인터페이스에 맞춤), 커밋 키 형식, 지문 원천, `StepCheckpoint` 채우기, `inputs.drain` 결합, `finalizeBoundary` | LP1, LP2, L1.tasks.plan TK-5 | M | M1 |
| LP5 | `next`별 재진입: `turn_start`, `request`(K1 포함), `tools`, `await_input`(승인 대기 호출의 `restore` 뒤 `tools.prepare` 재실행), `turn_end`, 취소 의도 → `closed`. 열린 turn 표식. 자체 루프 이행 뒤에는 `resume.ts`가 `TurnEntry`만 만들고 실행은 `runTurn`이 한다(LP19) (N-03 완료 2026-10-24: 닫는 재진입이 정착한 turn 노드에 작업을 등록하지 않는다. 시험 `closing_an_open_turn_logs_no_run_rejection`) | LP4, M0: core-persistence 열 때 복구, core-tools 파이프라인 인터페이스 | L | M1 |
| LP6 | 예산·상한 처리: `maxSteps`, drive turn 신호, `canContinue`, `l1.loop.*` 설정 정의, `thinkingBudgets` 전달(M2) (M2 완료 2026-10-24: 시험 `thinking_budgets_passed_through`) | LP4 | S | M1(maxSteps), M2(추론 예산) |
| LP7 | 완료 게이트: 정착 후보 판정, `agent_before_settle` 발화 위치(`endStep`), 게이트 계속 상한과 휘발 알림 (M2 완료 2026-10-24: 설정 `l1.loop.gate.maxContinues`, 시험 `completion-gate.test.ts`. 상한 알림 `turn.updated.notice` gate_limit은 L1F에서 연결: `gate_limit_notice`) | LP4, LP6 | M | M1(발화), M2(상한) |
| LP8 | boundary 최종 검증: `finalizeBoundary` 규칙 1~5와 진단 로그 | LP4 | S | M1 |
| LP9 | `input` 지점 발화 위치 확정: `admit`의 input chain → `inputs.enqueue` 순서, 확장 post 비경유. runtime-flow 그림 수정 요청(FR-L7)과 L1.tasks.spec §7 일치 확인 | LP1, L1.tasks.plan TK-5 | S | M1 |
| LP10 | drive 연동: `runTurn`의 T1 build 안 `turnByRequestId` 조회와 `leaseEpoch` 펜싱, 열린 turn 이어 끝내기, thread 취소 신호 처리, `LoopTurnResult.usage` (M2 완료 2026-10-24: 시험 `drive-budget.test.ts`. 횟수 상한은 X가 거부하고 토큰은 `loop.budget`으로 보고한다) | LP5, LP6, M0: ext-host drive 최소형 | M | M1(최소), M2(정식 테스트) |
| LP11 | `stopAtSafeBoundary`: T4 뒤 결정 `end`, T6 생략, 시한 처리 | LP4 | S | M1 |
| LP12 | `user_bash` 진입점과 `await_input` 재진입의 승인 응답 연결 (`await_input` 재진입 완료 2026-10-24: 시험 `await_input_resumes_after_approval_response`, 열린 turn을 닫을 때 그 turn의 미해결 승인 취소. `user_bash`는 L1F에서 완료: `user-bash.ts`, 시험 `user-bash.test.ts`) | LP5, L1.tools 승인 프로토콜 | M | M2 |
| LP13 | 목표 판정 소비 지점 계약 시험(가짜 판정 핸들러) | LP7, L1.agents 판정 API | S | M3 |
| LP14 | 반복 감지 | LP7, FR-L5 | M | 2차 |
| LP15 | 자식 thread turn `runChildTurn`(spec §4.13): requestId 멱등 조회, 자식 turn 노드(`openScope` 부모 subagent), `systemPrompt`·`model`·`ToolRunContext` 값 전달, 자식 한도(`child_limit`) (M2 완료 2026-10-24: `runChildTurn`, 시험 `child-turn.int.test.ts`) | LP5, LP10, L1.agents.plan AG-2 | M | M2 |
| LP16 | (완료 2026-10-23) F 타입 이행: `contracts/src/conversation/agent.ts`에 `AgentMessage`(닫힌 유니온), `AgentEvent`, `AgentTool`, `AgentToolResult`, `AgentToolCall`, `AgentToolUpdateCallback`, `ToolExecutionMode`, `AgentContext` 정의(`F.conversation.spec` §3.1.1). `pi.ts`에서 agent-core 재노출 제거, `hierarchy.ts` 선언 병합 제거, `AgentToolHooks` 제거. `pi-types.test.ts`의 agent-core 항등 검사를 F 정의 검사로 바꾼다 | — | M | 이행 1 |
| LP17 | (완료 2026-10-23) 루프 본체 포크: `loop/stream-response.ts`, `loop/tool-batch.ts`, `loop/run-turn.ts`. 원본 `agent-loop.ts` 1.3.0의 해당 함수를 옮기고 spec §3.2·§3.3대로 고친다. `UPSTREAM.json`, `LICENSE.pi`, 출처 주석. pi-ai 값 함수 호출은 `xeon.models` 메서드로 바꾼다 | LP16, LP18 | L | 이행 2 |
| LP18 | (완료 2026-10-23) 이웃 계약 바꾸기(다른 plan과 함께): `ToolService`의 `hooks`·`toAgentTools`·`observe`·`closeUnexecuted`를 `prepare`·`execute`·`settleRejected` 단계 계약으로(`L1.tools.plan`), `ModelService`에 도구 선언 차이 계산과 streamFn 안 정규화(`L1.models.plan`). 첫 테스트로 typebox 검증이 pi-ai `validateToolArguments`와 같은 결과를 내는지 확인(adr.0009 §6 [가정]) | LP16 | M | 이행 2 |
| LP19 | (완료 2026-10-23) 단계 함수와 진입점: `open-step.ts`, `commit-response.ts`, `step-end.ts`, `before-start.ts`. `agent-wrapper.ts`의 `executeTurn`·`finishStep`·`replayTools`·`runPendingCall`·`emit` 본문을 단계 함수로 나눠 옮긴다. `resume.ts`는 `TurnEntry`만 만든다. 커밋 실패는 `Result`로 돌린다(throw 제거, `RunFailure` 예외 제거) | LP17 | L | 이행 3 |
| LP20 | (완료 2026-10-23) 정리: `agent-wrapper.ts`, `pi-bridge.ts`, `streams.ts`의 pi 대응 부분 삭제. `core-loop`·`contracts`의 `package.json`과 bun catalog에서 `@earendil-works/pi-agent-core` 제거, `bun.lock` 갱신. `check-layers.ts` `MODULE_OWNERS`의 pi-agent-core 행을 owners `[]`로. `plugin.ts` 설명 문구 수정 | LP19 | S | 이행 4 |
| LP21 | (완료 2026-10-23) 시험 이행: §5의 이행 시험 추가, `agent-wrapper.contract.test.ts` → `loop.contract.test.ts`(이름과 `runAgentLoop` 사례 교체), 기존 테이프·결정성 시험이 그대로 통과하는지 확인 | LP19 | M | 이행 4 |

선행 요약: contracts(F.conversation 매퍼 타입, F.records 체크포인트·휘발 envelope, F.extensions 지점 표), core-persistence 커밋 API, core-tools 파이프라인 인터페이스, core-tasks 서비스(L1.tasks.plan TK-1, TK-5, TK-6).

순서: LP0 → LP2 → LP3 → LP1 → LP4 → LP8 → LP9 → LP5 → LP6 → LP7 → LP10 → LP11(M1 완료). 자체 루프 이행은 LP16 → LP18 → LP17 → LP19 → LP20·LP21이고 M2 작업(LP12, LP15)보다 먼저 한다. 이행 동안 기존 시험(테이프, 결정성, 재개, 장애 주입)은 계속 통과해야 한다.

## 4. 채택 코드

| 대상 | 방식 | 정확한 버전·출처 | 바꿀 점 |
|---|---|---|---|
| `@earendil-works/pi-agent-core` `agent-loop.ts` | 포크(자체 루프로 재설계, adr.0009) | 1.3.0. tarball sha1 `aec4d26bf7cdab5bca2a129f6a6dffc606c892db`, `dist/*.js.map` `sourcesContent`(1.1.0 소스 `~/projects/_ref/pi-src/packages/agent/src`와 바이트 동일, `_research/notes/L1-1.md` §0). MIT, Copyright (c) 2025 Mario Zechner | 옮기는 함수: `runLoop` 안쪽 반복(163-321), `streamAssistantResponse`(381-476), `failToolCallsFromTruncatedMessage`(478-506), `executeToolCalls*`(508-660), `shouldTerminateToolBatch`(690-692). 바꾸는 점은 `L1.loop.spec` §3.2·§3.3 |
| `@earendil-works/pi-agent-core` `types.ts` | 설계 참고 | 같은 판 | F `conversation/agent.ts`가 이름과 필드를 따른다(`any` 제거, 닫힌 유니온) |
| `@earendil-works/pi-agent-core` `agent.ts`, `proxy.ts`, `stream-fn.ts`, `agentLoop`, `agentLoopContinue`, `declareToolChanges`, `runToolCall` | 옮기지 않음 | — | `UPSTREAM.json`의 `notCopied`에 적는다. `declareToolChanges`는 `xeon.models`가 pi-ai 함수로 대신한다 |
| `@earendil-works/pi-ai` | 그대로(npm 정확 고정), core-models 소유 | 1.3.0, bun catalog `"1.3.0"` | core-loop는 import하지 않는다(DR-07) |
| 루프 단계 정의 | 설계 근거 | durable `docs/spec.md` 3715-3868(phase 표), 3136-3170(재생 시 정책), `docs/design/12-runtime-engine.md` §3.4.3(순서 대조용) | 코드 없음 |

포크 수행 규칙:

1. 원본은 npm tarball을 풀어 `sourcesContent`에서 꺼내거나 `~/projects/_ref/pi-src`에서 읽는다. 어느 쪽도 실행하지 않는다. `_ref`에는 쓰지 않는다.
2. `UPSTREAM.json`: `upstream: "https://github.com/earendil-works/pi"`, `package: "@earendil-works/pi-agent-core"`, `version: "1.3.0"`, `tarballSha1`, `license: "MIT"`, `copiedPaths`(원본 함수와 줄 범위 → Xeon 파일), `notCopied`, `modifications`(XEON-PATCH id 목록).
3. `LICENSE.pi`: pi 저장소 루트 `LICENSE` 원문. 배포물 서드파티 고지에도 넣는다(adr.0003 §3.4).
4. 출처 주석과 `XEON-PATCH` 표지는 adr.0009 §3.6 형식이다.

업스트림 추종 [결정: adr.0009 §3.7]. pi-agent-core 새 판은 따라가지 않는다. 루프 버그를 고칠 때 원본에 같은 수정이 있는지 참고로 본다. 옮기면 `UPSTREAM.json` `modifications`에 원본 판과 함수를 적는다. pi-ai 판 올림은 `L1.models.plan`의 체크리스트를 따르고, core-loop 쪽 확인은 녹화 테이프 재생(`recordedFrom.piAi`, TS-04)과 `loop.contract.test.ts`다.

## 5. 단위 테스트 목록

| 테스트 이름 | 파일 | 확인할 동작 | 마일스톤 |
|---|---|---|---|
| `mapper_maps_full_turn_event_sequence` | `event-mapper.test.ts` | 도구 호출 2개가 있는 turn의 `AgentEvent` 열 전체가 F.conversation §3.5.4 표 순서대로 알림으로 바뀐다(골든 파일) | M1 |
| `mapper_deterministic_given_ids` | `event-mapper.test.ts` | 같은 `init.ids`와 이벤트 열이면 출력 열이 같다. `startStepIndex`부터 센다 | M1 |
| `mapper_uses_bound_item_ids` | `event-mapper.test.ts` | `bindItem`으로 알린 steer 메시지·toolResult에는 새 id를 만들지 않는다 | M1 |
| `volatile_after_seq_not_behind_durable` | `turn.test.ts` | 각 휘발 envelope의 `afterSeq` ≥ 그 step의 `step.started` seq, `n`이 turn마다 0부터 1씩 | M1 |
| `step_commit_includes_checkpoint_same_transaction` | `checkpoint.fault.test.ts` | T4 커밋에 `step.completed`와 `checkpoint.step`이 함께 있고, 커밋 전 장애 주입이면 둘 다 없다(spec §9-6) | M1 |
| `turn_start_records_input_before_turn_started` | `turn.test.ts` | T1에서 입력 `item.recorded` seq < `turn.started` seq(spec §9-7) | M1 |
| `resume_request_phase_resends_request` | `resume.int.test.ts` | T4 뒤 끊고 재개하면 다음 단계 요청의 `contextHash`가 끊기지 않은 실행과 같다. T3 전(스트리밍 중)에 끊으면 같은 단계 요청을 다시 보낸다(spec §9-2) | M1 |
| `resume_tools_phase_uses_pending_tool_calls` | `resume.test.ts` | T3 체크포인트(`next: "tools"`)에서 재개하면 결과가 있는 호출은 다시 실행하지 않고 intent 없는 호출만 실행한 뒤 T4를 커밋한다 | M1 |
| `resume_abort_requested_closes_turn` | `resume.test.ts` | `turn.abort_requested`가 있는 열린 turn은 재개하지 않고 `turn.completed{interrupted}`로 닫힌다 | M1 |
| `default_has_no_step_cap` | `budget.test.ts` | 기본 설정에서 60단계 테이프가 끝까지 실행된다(spec §9-3) | M1 |
| `max_steps_ends_turn_as_interrupted` | `budget.test.ts` | `maxSteps = 3`이면 3단계 뒤 결정 `end`, `turn.completed{interrupted, error:"step_limit"}` | M1 |
| `drive_budget_stops_at_turns_cap` | `drive.int.test.ts` | 임대 turn 상한 2인 가짜 drive 함수가 세 번째 `loop.turn`에서 거부되고 임대가 `releasing`이 된다. 토큰 예산은 X가 `loop.turn` 호출 사이에서 검사하므로 실행 중인 turn은 끝까지 간다 | M2 |
| `drive_turn_same_request_id_replays` | `drive.test.ts` | 같은 `requestId`로 두 번 부르면 두 번째 `replayed: true`, `turn.started` 하나(spec §9-8) | M1 |
| `gate_stops_after_max_continues` | `completion-gate.test.ts` | `agent_before_settle`이 계속 `continue: true`여도 게이트 계속이 `maxContinues` 회를 넘지 않고 정착한다(spec §9-4) | M2 |
| `gate_ignores_continue_on_non_final_step` | `completion-gate.test.ts` | 도구 호출이 있는 단계의 `continue`는 세지 않는다 | M2 |
| `boundary_finalize_rejects_invalid_entries` | `checkpoint.test.ts` | 접두 없는 kind, `step.completed` 엔트리, 스키마 위반, 중복 id 각각에서 `{ entries: [], continue: false }`(spec §9-5) | M1 |
| `aborted_partial_stream_saved_as_aborted` | `resume.test.ts` | 스트리밍 중 `interrupt`면 부분 assistant item이 `stopReason: "aborted"`로 기록되고 `turn.completed{interrupted}`(spec §9-9) | M1 |
| `admit_fires_input_before_enqueue` | `loop.contract.test.ts` | `input` chain이 `handled`면 `input.queued`가 없고, `transform`이면 바뀐 내용이 큐에 들어간다 | M1 |
| `workspace_has_no_pi_agent_core_dependency` | `loop.contract.test.ts` | core-loop·contracts 소스와 모든 `package.json`에 `@earendil-works/pi-agent-core`가 없다(spec §9-10, adr.0009) | 이행 |
| `stop_at_safe_boundary_leaves_turn_open` | `checkpoint.fault.test.ts` | T4 뒤 멈추고 `turn.completed`가 없으며 재개 후보에 남는다 | M1 |
| `thinking_budgets_passed_through` | `loop.contract.test.ts` | `xeon.models`가 준 단계 바인딩의 `thinkingBudgets`와 추론 레벨이 streamFn 요청에 그대로 들어가고 loop가 값을 바꾸지 않는다(LP6) | M2 |
| `user_bash_first_deny_skips_shell` | `user-bash.test.ts` | `user_bash`(first)가 거부면 `runUserShell` 호출 0회, 허용이면 1회이고 결과 기록 방식이 `includeInContext`를 따른다(LP12) | M2 |
| `user_bash_runs_the_command_and_records_it_for_the_model` | `user-bash.test.ts` | `!명령`은 caller main·대화형 맥락으로 `runUserShell`을 한 번 부르고 `custom` item 하나(`core.loop.user_bash`)가 기록된다. `!!`는 item 없이 `includeInContext: false`다 | M2 |
| `user_bash_replace_and_refusals` | `user-bash.test.ts` | 핸들러의 결과 대체는 실행 0회 `replaced: true`이고 item이 남는다. 도구 쪽이 실행 전에 닫은 명령(`not_executed`)은 `denied`다. 0이 아닌 종료는 `completed`이고 종료 코드·전체 출력 경로가 본문에 든다 | M2 |
| `a command that ran but could not be recorded is not run again: the retry only records` | `user-bash.test.ts` | 기록 커밋이 busy로 모두 실패한 요청은 오류 값이고 `runUserShell`은 1회다. 같은 `requestId` 재호출은 셸을 다시 부르지 않고 `custom` item 하나를 기록하며, 그 뒤 호출은 같은 결과를 돌려준다 | M2 |
| `user_bash_cwd_follows_the_thread` | `user-bash.test.ts` | 작업 디렉터리가 다른 두 대화에서 `user_bash` 핸들러가 받는 페이로드의 `cwd`가 각각 그 대화의 디렉터리(`/work/alpha`, `/work/beta`)다. 옵션이 `undefined`를 돌려주면 `cwd`는 빈 문자열이다 | M2 |
| `user_bash_idempotent_and_concurrent_with_a_turn` | `user-bash.test.ts` | 같은 `requestId`는 한 번만 실행되고 같은 결과다. 없는 대화는 `thread_not_found`. turn이 도구를 기다리는 동안 불러도 turn이 정상 정착한다 | M2 |
| `gate_limit_notice` | `completion-gate.test.ts` | 상한에 막힌 단계에서 휘발 `turn.updated`에 `notice{gate_limit, limit}`가 한 번 나가고 내구 기록에는 없다. 핸들러가 계속을 원하지 않으면 알림이 없다 | M2 |
| `await_input_resumes_after_approval_response` | `resume.int.test.ts` | `await_input` 체크포인트에서 재개하면 모델 요청 0회, 승인 응답이 커밋된 뒤 같은 호출이 `runTurn({ kind: "tools" })`의 `tools.prepare`·`execute`로 실행되고 T4가 커밋된다(LP12) | M2 |
| `child_turn_uses_request_prompt_model_and_tool_context` | `child-turn.int.test.ts` | `runChildTurn`의 요청 본문 기본 프롬프트가 `systemPrompt`, 바인딩이 `model` 해석 결과이고, 도구 호출의 `ToolRunContext`가 요청 값과 같다(spec §9-12, LP15) | M2 |
| `child_turn_same_request_id_replays` | `child-turn.int.test.ts` | 같은 `requestId`로 두 번 부르면 두 번째 `replayed: true`, 자식 thread의 `turn.started` 하나(spec §9-11, LP15) | M2 |
| `judge_consumption_recorded_and_not_rerun` | `completion-gate.test.ts` | 가짜 판정 핸들러가 `agent_before_settle`에서 낸 확장 kind 엔트리가 T4에 기록되고, 재개 뒤 같은 단계에서 핸들러가 판정 API를 다시 부르지 않는다(LP13) | M3 |
| `stream_response_emits_start_updates_and_one_message_end_for_a_normal_stream` | `loop/stream-response.test.ts` | `start` 뒤 델타마다 부분 메시지가 바뀌고 `done`·`error`에서 `result()`의 최종 메시지를 낸다(원본 381-476 사례) | 이행 |
| `stream_response_handles_a_stream_that_ends_without_a_start_event` | `loop/stream-response.test.ts` | `start` 없이 끝난 스트림도 `message_start`·`message_end`를 한 번씩 낸다(원본 381-476 사례) | 이행 |
| `stream_response_keeps_no_context_array_between_requests` | `loop/stream-response.test.ts` | 스트리밍 동안 루프가 넘긴 컨텍스트 값을 바꾸지 않는다(`Object.freeze`한 입력으로 실행) | 이행 |
| `parallel_batch_end_events_in_completion_order_results_in_source_order` | `loop/tool-batch.test.ts` | 늦게 끝나는 첫 호출과 빨리 끝나는 둘째 호출: `tool_execution_end`는 둘째·첫째 순, toolResult 메시지는 첫째·둘째 순(원본 586-660) | 이행 |
| `sequential_mode_when_any_tool_is_sequential` | `loop/tool-batch.test.ts` | 호출 중 하나의 `executionMode`가 `"sequential"`이면 실행이 겹치지 않는다 | 이행 |
| `abort_mid_batch_settles_rest_as_not_executed` | `loop/tool-batch.test.ts` | 첫 호출 뒤 취소하면 남은 호출이 같은 배치 안에서 `settleRejected(…, "not_executed")`로 닫히고 C5 전 결과 없는 toolCall이 0개다(spec §9-15) | 이행 |
| `length_stop_settles_all_calls_as_truncated` | `loop/tool-batch.test.ts` | `stopReason: "length"` 응답의 도구 호출은 `execute`가 0회이고 모두 `truncated`로 닫힌다 | 이행 |
| `terminate_only_when_every_result_terminates` | `loop/tool-batch.test.ts` | 결과 둘 중 하나만 `terminate`면 다음 요청, 둘 다면 정착 후보 | 이행 |
| `step_end_returns_placed_steer_without_callback` | `loop/step-end.test.ts` | C5의 `drain`이 고른 steer가 `StepNext.placed`로 돌아오고 다음 요청 컨텍스트에 들어간다. 정착 후보 판정은 steer가 있으면 거짓 | 이행 |
| `a_failed_step_commit_ends_the_turn_as_failed_without_throwing` | `loop/run-turn.test.ts` | 가짜 세션이 T3에서 `err`를 내면 `runTurn`이 거부(reject)되지 않고 T6 `failed{loop_rejected}`를 시도하며 도구 `execute`는 0회다 | 이행 |
| `resume_entries_use_main_path_step_functions` | `loop/run-turn.test.ts` | `tools`·`request`·`turn_end` 진입에서 같은 테이프의 끊기지 않은 실행과 내구 이벤트 열이 같다(spec §9-16) | 이행 |
| `each_step_commits_three_plus_three_per_tool_call` | `turn.test.ts` | 진짜 core-loop를 대역 저장소 위에서 돌려 한 단계가 커밋 3개(S1, C3, C5)와 도구 호출마다 3개(E1, E2, E3)를 쓰는지 커밋 키로 센다. 도구 호출 0~3개(spec §4.2) | 이행 |
| `upstream_event_order_cases` | `loop/upstream-parity.test.ts` | 원본 `packages/agent/test/agent-loop.test.ts`에서 고른 사례(도구 없는 응답, 도구 1개, 병렬 2개, steer 주입, 오류 응답, 중단)의 `AgentEvent` 순서가 같다. 사례는 옮겨 적고 원본 코드는 실행하지 않는다 | 이행 |

## 6. 완료 기준

- §5의 해당 마일스톤 테스트가 통과한다.
- M1 스모크(`apps/cli` 시나리오 1개): 모델 테이프로 `xeon chat` 한 턴을 실행하고, 프로세스를 강제 종료한 뒤 재개하면 이벤트가 끊김 없이 이어진다(seq 무간격, 같은 turn의 `turn.completed` 하나). drive 그룹 토글이 단계 경계에서 적용된다(`_research/foundation-plan.md` §6).
- `cd xeon && just verify` 종료코드 0. 종료코드 2면 코드를 고치지 않고 보고한다.
- check-layers·dependency-cruiser에서 core-loop가 `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, `cordis`, 다른 `@xeon/core-*`를 import하지 않는다(테스트 파일의 `testing` 서브패스 제외, spec §9-10). 워크스페이스 `bun.lock`에 `@earendil-works/pi-agent-core`가 없다.
- 이행 완료: `agent-wrapper.ts`, `pi-bridge.ts`가 없고, core-loop 소스에 `as unknown as`와 `typescript/no-unsafe-type-assertion` 예외 주석이 0건이다. `UPSTREAM.json`, `LICENSE.pi`, 출처 주석이 있다.
- `docs-route --check`가 이 문서와 spec을 해석한다.

## 7. 위험과 대응

| 위험 | 대응 |
|---|---|
| 포크 과정에서 원본의 스트림·배치 순서 규칙을 놓친다 | `loop/upstream-parity.test.ts`에 원본 시험 사례를 옮겨 적고, M1 테이프·결정성 시험을 이행 내내 유지한다 |
| 이행이 core-loop·core-tools·core-models·contracts에 걸쳐 한 번에 커진다 | LP16(F 타입) → LP18(이웃 계약) → LP17·LP19(루프) → LP20·LP21(정리) 순서로 나누고, 각 단계에서 `just verify`를 통과시킨다 |
| 휘발 이벤트 순서와 내구 커밋 순서가 어긋난다 | `afterSeq` 규칙 테스트(`volatile_after_seq_not_behind_durable`). 래퍼는 같은 turn의 커밋이 끝난 뒤 다음 휘발을 낸다 |
| typebox 검증이 pi-ai `validateToolArguments`의 정규화(선택 null, `Value.Convert`)와 다르다 | LP18 첫 테스트로 대조하고, 다르면 `xeon.models`가 pi-ai 함수를 감싼 `Result` 메서드를 쓴다(adr.0009 §3.5) |
| 재개 때 컨텍스트 재구성이 결정적이지 않으면 요청이 달라진다 | 녹화 테이프 `context-hash` 모드(TS-04)로 재개 테스트를 돌린다. 불일치는 L1.context의 버그로 다룬다 |
| T3 체크포인트(FR-L3)를 F가 받지 않는다 | `tools` 재진입을 "T3의 assistant item과 효과 이벤트에서 도출"하는 방식으로 바꾼다. 체크포인트 없이도 같은 정보가 이벤트에 있다 |
| 유휴 입력의 두 커밋(`input.queued`, T1) 사이 끊김 | 입력이 queued로 남아 다음 시작에서 배치된다. `resume.int.test.ts`에 그 지점 끊김을 넣는다 |
