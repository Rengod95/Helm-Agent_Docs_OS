---
id: L1.loop.plan
layer: L1
domain: loop
kind: plan
status: draft
depends_on: [L1.loop.spec, L1.tasks.plan, L1.persistence.plan, L1.tools.plan, L1.models.plan, eng.testing.guide, eng.toolchain.guide]
binds: [xeon/packages/core-loop/**]
---

# L1 에이전트 루프 구현 계획 (loop)

대상 패키지는 `xeon/packages/core-loop`다. 현재는 스캐폴드(`src/index.ts`, `test/smoke.test.ts`, `"xeon": {"layer": "L1", "domain": "loop"}`)만 있다. 이 문서는 계획만 정하고 코드는 고치지 않는다. 인터페이스와 동작은 `L1.loop.spec`이 정본이다.

## 1. 목표와 마일스톤 배치

마일스톤 매핑은 `_research/layer-plan-v2.json` L1-b의 1차/2차/보류 표시와 `product.scope.spec` §4.3을 근거로 한 [제안]이다.

| 마일스톤 | 범위 | L1-b 구성요소(계획 단계) |
|---|---|---|
| M0(선행, 다른 패키지) | `contracts`의 F 타입(`AgentEventMapper` 시그니처, `StepCheckpoint`, `POINTS`, `BoundaryValue`), `platform-store`, `core-persistence` 커밋 API, `ext-host` 디스패치 최소형 | — |
| M1 걸어 다니는 골격 | agent-core 래퍼와 훅 연결, 이벤트 매퍼, 커밋 지점 T1~T4·T6, 단계 체크포인트, 재개 진입(`next` 판별자 전부), 입력 admit(`input` 지점), 모델 테이프 한 턴과 강제 종료 뒤 재개(`_research/foundation-plan.md` §6 M1 스모크), `l1.loop.maxSteps` | 턴 사이클(1차), 예산 pi 방식의 단계 상한·중단(1차), 단계 전 준비 훅(1차) |
| M2 L2 능력과 Helm(`product.scope.spec` §4.3) | 완료 게이트 횟수 상한(`l1.loop.gate.maxContinues`), drive 연동(`loop.turn` 멱등)의 정식 테스트, 추론 예산 설정 연결(`thinkingBudgets`), `user_bash` 진입점, `await_input` 재진입의 승인 응답 연결, 자식 thread turn 진입점 `runChildTurn`(L1.agents M2) | 완료 게이트(2차 구성요소의 앞당김), 예산의 추론 레벨별 토큰 예산(1차) |
| M3 | 목표 판정 소비 지점(`agent_before_settle` 핸들러 계약, `L2.work.spec`·`L1.agents.spec`과 함께) | (L2-e 목표 지속과 연결) |
| 2차(M3 이후) | 반복 감지(`l1.loop.repeat.*`) | 반복 감지(2차) |
| 제외 | 입출력 가드레일. 이름만 예약한다(`L1.loop.spec` §4.11) | 입출력 가드레일(보류) |

- drive 연동의 기본 경로(`LoopPort.runTurn`, `(scopeId, requestId)` 조회)는 M1 스모크의 "drive 그룹 토글이 단계 경계에서 적용"에 필요하므로 M1에 최소형을 둔다. 장애 주입을 포함한 정식 테스트는 M2다 [제안].
- 완료 게이트는 계획상 2차지만 drive와 목표 판정의 계속 지시가 M2·M3에 들어오므로 상한을 M2에 둔다 [제안]. `L1.readme` §9 표와 각주에 같은 배치를 적는다.

## 2. 패키지와 파일 배치

```text
xeon/packages/core-loop/
  package.json              # dependencies: "@earendil-works/pi-agent-core": "catalog:"(1.3.0 정확), "@xeon/contracts", "@xeon/ext-host"
  src/
    agent-wrapper.ts        # runAgentLoop([], context) 호출, AgentLoopConfig 조립, 훅 연결, run 거부 처리
    event-mapper.ts         # createAgentEventMapper(F 시그니처) + bindItem, 휘발 envelope 발신(n, afterSeq)
    checkpoint.ts           # 커밋 지점 T1~T4·T6의 CommitRequest 구성, StepCheckpoint 채우기, finalizeBoundary
    resume.ts               # next 판별자별 재진입, 열린 turn 찾기, 취소 의도 판정 연결
    budget.ts               # maxSteps, drive 토큰 상한, canContinue 계산
    completion-gate.ts      # 정착 후보 판정, 게이트 계속 횟수 상한 (M2)
    repeat-detector.ts      # 행동-관찰·행동-오류 반복 감지 (2차)
    thread-driver.ts        # thread별 turn 시작 직렬화, onQueued·정착 구독, admit 대기
    service.ts              # LoopService 조립: admit, LoopPort(runTurn, spawn, whenIdle, status), runChildTurn(M2), interrupt, resume, stopAtSafeBoundary, threadStatus
    settings.ts             # defineSettings("l1.loop", …)
    plugin.ts               # ext-host 플러그인 API로 xeon.loop 제공, xeon.tasks·session·tools·context·models·ext 주입
    index.ts
  test/
    tapes/                  # *.tape.jsonl (eng.testing.guide TS-04, TS-06)
    fixtures/
    event-mapper.test.ts
    checkpoint.test.ts
    checkpoint.fault.test.ts
    resume.int.test.ts
    budget.test.ts
    completion-gate.test.ts
    drive.int.test.ts
    child-turn.int.test.ts
    user-bash.test.ts
    agent-wrapper.contract.test.ts   # agent-core 1.3.0 계약(훅 순서, 이벤트 순서)
```

- 모델 테이프 가짜는 `eng.testing.guide` TS-04가 정한 `@xeon/core-models/testing`(`loadTape`, `tape`, `tapePlayer`, `contextHash`, `t`)을 테스트 파일에서만 import한다(DR-08, DR-14 예외 3). 테이프 파일은 `core-loop/test/tapes/`에 둔다(TS-06).
- `@earendil-works/pi-ai`는 import하지 않는다(DR-07, pi-ai 소유는 core-models). streamFn은 `xeon.models` 서비스에서 받고, 타입은 `@xeon/contracts/conversation`의 재노출 이름을 쓴다.
- 스모크 시나리오 테스트(`*.scenario.test.ts`)는 `apps/cli/test/`에 하나만 둔다(TS-01, TS-06). core-loop는 그 스모크가 쓰는 테이프 일부를 함께 만든다.

## 3. 작업 분해

작업 id는 층 이름(L1, L2)과 다른 도메인 plan의 id와 겹치지 않도록 `LP` 접두를 붙인다. 다른 plan의 작업은 "문서 id + 작업 id"로 적는다. 규모: S(반나절 이하), M(1~2일), L(3일 이상).

| id | 내용 | 선행 | 규모 | 마일스톤 |
|---|---|---|---|---|
| LP0 | F 요청 반영 확인: `ports.ts`와 `@xeon/contracts/services`의 L1 서비스 타입(FR-L1, review.decisions-2 D-04), `TurnStartedPayload.scopeId`(FR-L8), T3 체크포인트 허용(FR-L3), `turn.completed` 추가 행(FR-L4). 미반영이면 해당 동작을 [가정]으로 구현하지 않고 대기 | M0: contracts | S | M1 착수 조건 |
| LP1 | 래퍼와 훅 연결: `runAgentLoop([], context)`, `AgentLoopConfig` 조립(spec §3.2 표), streamFn의 `modelCalls` 슬롯 감싸기(M2에서 실제 상한), 재진입 금지, run 거부 → T6 `failed` | LP0, M0: core-persistence 커밋 API, L1.tasks.plan TK-1·TK-6 | M | M1 |
| LP2 | `AgentEventMapper` 구현과 골든 테스트: F.conversation §3.5.4 표 전 행, `bindItem`, 결정적 id 순서 | M0: contracts F.conversation 매퍼 타입 | M | M1 |
| LP3 | 휘발 이벤트 발신자: `VolatileEventEnvelope` 구성, `(threadId, turnId)`별 `n`, `afterSeq = headSeq()`, 50 ms 묶음, 16 KiB 자르기 | LP2, M0: core-persistence `headSeq`·휘발 피드 | S | M1 |
| LP4 | 단계 커밋 요청 구성: T1~T4·T6의 `CommitRequest`(persistence `commit` 인터페이스에 맞춤), 커밋 키 형식, 지문 원천, `StepCheckpoint` 채우기, `inputs.drain` 결합, `finalizeBoundary` | LP1, LP2, L1.tasks.plan TK-5 | M | M1 |
| LP5 | `next`별 재진입: `turn_start`, `request`(K1 포함), `tools`(intent 없는 호출을 agent-core `runToolCall`에 `xeon.tools`의 도구·훅을 넣어 실행), `await_input`(승인 대기 호출의 `restore` 뒤 `runToolCall` 재실행), `turn_end`, 취소 의도 → `closed`. 열린 turn 표식 | LP4, M0: core-persistence 열 때 복구, core-tools 파이프라인 인터페이스 | L | M1 |
| LP6 | 예산·상한 처리: `maxSteps`, drive turn 신호, `canContinue`, `l1.loop.*` 설정 정의, `thinkingBudgets` 전달(M2) | LP4 | S | M1(maxSteps), M2(추론 예산) |
| LP7 | 완료 게이트: 정착 후보 판정, `agent_before_settle` 발화 위치(`finishTurn`), 게이트 계속 상한과 휘발 알림 | LP4, LP6 | M | M1(발화), M2(상한) |
| LP8 | boundary 최종 검증: `finalizeBoundary` 규칙 1~5와 진단 로그 | LP4 | S | M1 |
| LP9 | `input` 지점 발화 위치 확정: `admit`의 input chain → `inputs.enqueue` 순서, 확장 post 비경유. runtime-flow 그림 수정 요청(FR-L7)과 L1.tasks.spec §7 일치 확인 | LP1, L1.tasks.plan TK-5 | S | M1 |
| LP10 | drive 연동: `runTurn`의 T1 build 안 `turnByRequestId` 조회와 `leaseEpoch` 펜싱, 열린 turn 이어 끝내기, thread 취소 신호 처리, `LoopTurnResult.usage` | LP5, LP6, M0: ext-host drive 최소형 | M | M1(최소), M2(정식 테스트) |
| LP11 | `stopAtSafeBoundary`: T4 뒤 결정 `end`, T6 생략, 시한 처리 | LP4 | S | M1 |
| LP12 | `user_bash` 진입점과 `await_input` 재진입의 승인 응답 연결 | LP5, L1.tools 승인 프로토콜 | M | M2 |
| LP13 | 목표 판정 소비 지점 계약 시험(가짜 판정 핸들러) | LP7, L1.agents 판정 API | S | M3 |
| LP14 | 반복 감지 | LP7, FR-L5 | M | 2차 |
| LP15 | 자식 thread turn `runChildTurn`(spec §4.13): requestId 멱등 조회, 자식 turn 노드(`openScope` 부모 subagent), `systemPrompt`·`model`·`ToolRunContext` 값 전달, 자식 한도(`child_limit`) | LP5, LP10, L1.agents.plan AG-2 | M | M2 |

선행 요약: contracts(F.conversation 매퍼 타입, F.records 체크포인트·휘발 envelope, F.extensions 지점 표), core-persistence 커밋 API, core-tools 파이프라인 인터페이스, core-tasks 서비스(L1.tasks.plan TK-1, TK-5, TK-6).

순서: LP0 → LP2 → LP3 → LP1 → LP4 → LP8 → LP9 → LP5 → LP6 → LP7 → LP10 → LP11. M2에서 LP12, LP15.

## 4. 채택 코드

| 대상 | 방식 | 정확한 버전·출처 | 바꿀 점 |
|---|---|---|---|
| `@earendil-works/pi-agent-core` | 그대로(npm 정확 고정) | 1.3.0. tarball sha1 `aec4d26bf7cdab5bca2a129f6a6dffc606c892db`(`_research/notes/L1-1.md` §1). bun catalog에 `"1.3.0"`(범위 없음) | 없음. `runAgentLoop`, 타입만 쓴다. `Agent`, `proxy`, `getDefaultStreamFn`은 쓰지 않는다 |
| `@earendil-works/pi-ai` | 그대로(npm 정확 고정), core-models 소유 | 1.3.0. bun catalog에 `"1.3.0"`. agent-core 1.3.0의 의존도 `1.3.0` 정확 고정이다(`_research/notes/L1-1.md` §2) | core-loop는 직접 import하지 않는다(DR-07). catalog 값은 core-models와 같은 한 줄을 쓴다 |
| 포크 후보 | 조건부 | agent-core 1.3.0 `src/agent-loop.ts`, `src/types.ts`(1.1.0 소스 `~/projects/_ref/pi-src/packages/agent/src`와 바이트 동일) | `L1.loop.spec` §3.3 판정표의 A4(실행 인자 교체)만 후보다. 포크 조건은 그 표를 따른다. 포크하면 `core-loop/vendor/pi-agent-core/`에 두 파일만 두고 `XEON-PATCH` 주석, 원본 sha1, 줄 범위를 적는다 |
| 루프 단계 정의 | 설계 근거 | durable `docs/spec.md` 3715-3868(phase 표), 3136-3170(재생 시 정책), `docs/design/12-runtime-engine.md` §3.4.3(순서 대조용) | 코드 없음 |

pi 패키지 업그레이드 체크리스트 [제안]. pi-ai CHANGELOG에는 minor마다 Breaking 절이 있다(`_research/packages.md` §1.1 pi-ai 행). agent-core 1.2.0·1.3.0 절은 비어 있다(`_research/notes/L1-1.md` §2).

1. 새 판의 tarball을 받아 `dist/*.js.map`의 `sourcesContent`로 TS 원본을 꺼낸다. 패키지 코드는 실행하지 않는다.
2. agent-core `agent-loop.ts`, `types.ts`, `index.ts`를 1.3.0과 비교한다. 훅 7종(`prepareRequest`, `prepareNextTurn`, `finishTurn`, `beforeToolCall`, `afterToolCall`, `getSteeringMessages`, `getFollowUpMessages`)의 시그니처와 호출 위치가 같은지 본다(`_research/notes/L1-1.md` §3 (a) 표 형식).
3. 이벤트 순서를 본다: `tool_execution_start`가 `beforeToolCall`보다 앞인지, 병렬 모드가 준비를 모두 끝낸 뒤 실행하는지, `finishTurn`이 `turn_end`보다 앞인지.
4. CHANGELOG(pi-ai, agent-core)의 Breaking 절을 읽고 `L1.loop.spec` §3.3 판정표의 각 행을 다시 판정한다.
5. `BeforeToolCallResult`에 인자 교체 필드가 생겼으면 포크 후보 A4를 닫는다.
6. `agent-wrapper.contract.test.ts`와 녹화 테이프 재생(`recordedFrom.piAi` 확인, TS-04)을 돌린다.
7. bun catalog 값과 core-models의 pi-ai 값을 한 커밋에서 함께 올린다.
8. 판정표와 이 체크리스트 결과를 `_research/notes/`에 남긴다.

## 5. 단위 테스트 목록

| 테스트 이름 | 파일 | 확인할 동작 | 마일스톤 |
|---|---|---|---|
| `mapper_maps_full_turn_event_sequence` | `event-mapper.test.ts` | 도구 호출 2개가 있는 turn의 `AgentEvent` 열 전체가 F.conversation §3.5.4 표 순서대로 알림으로 바뀐다(골든 파일) | M1 |
| `mapper_deterministic_given_ids` | `event-mapper.test.ts` | 같은 `init.ids`와 이벤트 열이면 출력 열이 같다. `startStepIndex`부터 센다 | M1 |
| `mapper_uses_bound_item_ids` | `event-mapper.test.ts` | `bindItem`으로 알린 steer 메시지·toolResult에는 새 id를 만들지 않는다 | M1 |
| `volatile_after_seq_not_behind_durable` | `event-mapper.test.ts` | 각 휘발 envelope의 `afterSeq` ≥ 그 step의 `step.started` seq, `n`이 turn마다 0부터 1씩 | M1 |
| `step_commit_includes_checkpoint_same_transaction` | `checkpoint.fault.test.ts` | T4 커밋에 `step.completed`와 `checkpoint.step`이 함께 있고, 커밋 전 장애 주입이면 둘 다 없다(spec §9-6) | M1 |
| `turn_start_records_input_before_turn_started` | `checkpoint.test.ts` | T1에서 입력 `item.recorded` seq < `turn.started` seq(spec §9-7) | M1 |
| `resume_request_phase_resends_request` | `resume.int.test.ts` | T4 뒤 끊고 재개하면 다음 단계 요청의 `contextHash`가 끊기지 않은 실행과 같다. T3 전(스트리밍 중)에 끊으면 같은 단계 요청을 다시 보낸다(spec §9-2) | M1 |
| `resume_tools_phase_uses_pending_tool_calls` | `resume.int.test.ts` | T3 체크포인트(`next: "tools"`)에서 재개하면 결과가 있는 호출은 다시 실행하지 않고 intent 없는 호출만 실행한 뒤 T4를 커밋한다 | M1 |
| `resume_abort_requested_closes_turn` | `resume.int.test.ts` | `turn.abort_requested`가 있는 열린 turn은 재개하지 않고 `turn.completed{interrupted}`로 닫힌다 | M1 |
| `default_has_no_step_cap` | `budget.test.ts` | 기본 설정에서 60단계 테이프가 끝까지 실행된다(spec §9-3) | M1 |
| `max_steps_ends_turn_as_interrupted` | `budget.test.ts` | `maxSteps = 3`이면 3단계 뒤 결정 `end`, `turn.completed{interrupted, error:"step_limit"}` | M1 |
| `drive_budget_stops_at_turns_cap` | `drive.int.test.ts` | 임대 turn 상한 2인 가짜 drive 함수가 세 번째 `loop.turn`에서 거부되고 임대가 `releasing`이 된다. 토큰 예산은 X가 `loop.turn` 호출 사이에서 검사하므로 실행 중인 turn은 끝까지 간다 | M2 |
| `drive_turn_same_request_id_replays` | `drive.int.test.ts` | 같은 `requestId`로 두 번 부르면 두 번째 `replayed: true`, `turn.started` 하나(spec §9-8) | M1 |
| `gate_stops_after_max_continues` | `completion-gate.test.ts` | `agent_before_settle`이 계속 `continue: true`여도 게이트 계속이 `maxContinues` 회를 넘지 않고 정착한다(spec §9-4) | M2 |
| `gate_ignores_continue_on_non_final_step` | `completion-gate.test.ts` | 도구 호출이 있는 단계의 `continue`는 세지 않는다 | M2 |
| `boundary_finalize_rejects_invalid_entries` | `checkpoint.test.ts` | 접두 없는 kind, `step.completed` 엔트리, 스키마 위반, 중복 id 각각에서 `{ entries: [], continue: false }`(spec §9-5) | M1 |
| `aborted_partial_stream_saved_as_aborted` | `resume.int.test.ts` | 스트리밍 중 `interrupt`면 부분 assistant item이 `stopReason: "aborted"`로 기록되고 `turn.completed{interrupted}`(spec §9-9) | M1 |
| `admit_fires_input_before_enqueue` | `agent-wrapper.contract.test.ts` | `input` chain이 `handled`면 `input.queued`가 없고, `transform`이면 바뀐 내용이 큐에 들어간다 | M1 |
| `wrapper_never_calls_run_agent_loop_continue` | `agent-wrapper.contract.test.ts` | 모든 turn 실행이 `runAgentLoop([], …)` 하나이고 넘긴 배열이 바뀌지 않는다(판정표 A1) | M1 |
| `stop_at_safe_boundary_leaves_turn_open` | `checkpoint.test.ts` | T4 뒤 멈추고 `turn.completed`가 없으며 재개 후보에 남는다 | M1 |
| `thinking_budgets_passed_through` | `agent-wrapper.contract.test.ts` | `xeon.models`가 준 `thinkingBudgets`와 추론 레벨이 `AgentLoopConfig`에 그대로 들어가고 loop가 값을 바꾸지 않는다(LP6) | M2 |
| `user_bash_first_deny_skips_shell` | `user-bash.test.ts` | `user_bash`(first)가 거부면 `runUserShell` 호출 0회, 허용이면 1회이고 결과 기록 방식이 `includeInContext`를 따른다(LP12) | M2 |
| `await_input_resumes_after_approval_response` | `resume.int.test.ts` | `await_input` 체크포인트에서 재개하면 모델 요청 0회, 승인 응답이 커밋된 뒤 같은 호출이 `runToolCall`로 실행되고 T4가 커밋된다(LP12) | M2 |
| `child_turn_uses_request_prompt_model_and_tool_context` | `child-turn.int.test.ts` | `runChildTurn`의 요청 본문 기본 프롬프트가 `systemPrompt`, 바인딩이 `model` 해석 결과이고, 도구 호출의 `ToolRunContext`가 요청 값과 같다(spec §9-12, LP15) | M2 |
| `child_turn_same_request_id_replays` | `child-turn.int.test.ts` | 같은 `requestId`로 두 번 부르면 두 번째 `replayed: true`, 자식 thread의 `turn.started` 하나(spec §9-11, LP15) | M2 |
| `judge_consumption_recorded_and_not_rerun` | `completion-gate.test.ts` | 가짜 판정 핸들러가 `agent_before_settle`에서 낸 확장 kind 엔트리가 T4에 기록되고, 재개 뒤 같은 단계에서 핸들러가 판정 API를 다시 부르지 않는다(LP13) | M3 |

## 6. 완료 기준

- §5의 해당 마일스톤 테스트가 통과한다.
- M1 스모크(`apps/cli` 시나리오 1개): 모델 테이프로 `xeon chat` 한 턴을 실행하고, 프로세스를 강제 종료한 뒤 재개하면 이벤트가 끊김 없이 이어진다(seq 무간격, 같은 turn의 `turn.completed` 하나). drive 그룹 토글이 단계 경계에서 적용된다(`_research/foundation-plan.md` §6).
- `cd xeon && just verify` 종료코드 0. 종료코드 2면 코드를 고치지 않고 보고한다.
- check-layers·dependency-cruiser에서 core-loop가 `@earendil-works/pi-ai`, `cordis`, 다른 `@xeon/core-*`를 import하지 않는다(테스트 파일의 `testing` 서브패스 제외, spec §9-10).
- `docs-route --check`가 이 문서와 spec을 해석한다.

## 7. 위험과 대응

| 위험 | 대응 |
|---|---|
| agent-core 1.3.0과 로컬 소스 1.1.0의 훅 시그니처 차이 | 조사 1번 결과를 반영한다. 1.3.0 TS는 1.1.0과 바이트 동일하고 훅 7종이 같다(`_research/notes/L1-1.md` §0). 아직 확인하지 않은 항목([가정]: CHANGELOG 빈 절의 뜻, pi-ai `validation.ts` 밖 변경)은 `agent-wrapper.contract.test.ts`가 동작으로 확인한다 |
| 훅이 모자라 포크 범위가 커진다 | `L1.loop.spec` §3.3 판정표 기준으로만 포크한다. 현재 후보는 A4 하나다. 새 부족이 나오면 판정표에 행을 더한 뒤 결정한다 |
| 휘발 이벤트 순서와 내구 커밋 순서가 어긋난다 | `afterSeq` 규칙 테스트(`volatile_after_seq_not_behind_durable`). 래퍼는 같은 turn의 커밋이 끝난 뒤 다음 휘발을 낸다 |
| `finishTurn` 안에서 정착 후보를 미리 판정하는 방식이 agent-core 판단과 어긋난다(정착 직전 훅 부재) | `agent-wrapper.contract.test.ts`에 도구 없음·`terminate`·steer 도착 경우를 넣어 agent-core가 실제로 `agent_end`로 가는지 대조한다. 어긋나면 판정표에 행을 더하고 포크 후보로 올린다 |
| 재개 때 컨텍스트 재구성이 결정적이지 않으면 요청이 달라진다 | 녹화 테이프 `context-hash` 모드(TS-04)로 재개 테스트를 돌린다. 불일치는 L1.context의 버그로 다룬다 |
| T3 체크포인트(FR-L3)를 F가 받지 않는다 | `tools` 재진입을 "T3의 assistant item과 효과 이벤트에서 도출"하는 방식으로 바꾼다. 체크포인트 없이도 같은 정보가 이벤트에 있다 |
| 유휴 입력의 두 커밋(`input.queued`, T1) 사이 끊김 | 입력이 queued로 남아 다음 시작에서 배치된다. `resume.int.test.ts`에 그 지점 끊김을 넣는다 |
