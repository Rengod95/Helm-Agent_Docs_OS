# 12. 런타임 엔진

- 작성: P7 런타임, 2026-10-11 (1단계 초안)
- 상태: 설계 초안. 2단계 통합에서 06·07·08·09·10·11·13·14·15·16·17·19와 이름을 맞춘다.
- 함께 읽을 문서: `process/00-design-brief.md`(이하 "브리프"), [13 도구와 실행](13-tools-and-execution.md), [06 시스템 아키텍처](06-system-architecture.md), [10 커널](10-kernel.md), [14 루프·모드·오케스트레이션](14-loops-modes-orchestration.md), [15 탐구 엔진](15-inquiry-engine.md)
- 표시 규칙: 브리프 §5.2. `[결정 n]`은 브리프 §2의 결정 번호다. `[제안]`은 이 문서가 정한 것, `[가정]`은 확인하지 않은 전제다. 외부 사실은 `[원문]`(소스·문서 직접 확인), `[실험]`(이번에 실행해 확인), `[검색]`, `[지식]`(재확인 안 함)으로 표시한다.
- 출처 줄임말: `pi-facts-1`·`pi-facts-2`는 `process/sources/pi-api-facts-*.md`, `extracts-N`은 `process/sources/conversation-extracts-N.md`, `canon`·`canon-2`·`canon-3`은 `process/sources/helm-canon*.md`, `cases`는 `process/sources/pi-cases-notes.md`, `S4/<사례>`는 `.helm-design-work/S4/<사례>.md`, `pi-src/`는 `~/projects/_ref/pi-src`(커밋 `cdaf6c2`), `P7/`은 `.helm-design-work/P7/`(이 문서의 실험), `대화 L<n>`은 `docs/handoff/conversation-transcript-until-158.md`의 행이다.

## 1. 목적과 범위

### 1.1 이 문서가 정하는 것

구현자가 이 문서와 13만 보고 `@helm/ai`, `@helm/agent`, `@helm/runtime`의 실행 부분(루프 구동, 커널 연결, 투영 생성, 복구, 스케줄러, 예산)을 만들 수 있게 하는 것이 목적이다.

1. run·thread·turn·attempt의 정의와 run 상태 기계 (§3.2)
2. 모델 계층 `@helm/ai`: 인터페이스, 제공자 설정, 키 주입, 모델 역할과 대체, 재시도, 사용량·비용 기록, 이미지 입력 (§3.3)
3. pi-agent-core 포크 루프와 커널 연결점 네 곳(이벤트 싱크의 `message_end`, `beforeToolCall`, `afterToolCall`, `prepareRequest`)의 정확한 동작, 순서, 실패 처리 (§3.4)
4. A11 투영(모델 컨텍스트) 생성 알고리즘: 슬롯, 배치 순서, 크기, 캐시 친화 배치, 생략 보고. 화면 투영의 공통 규약과 복귀 요약 생성 절차 (§3.5)
5. 컴팩션 (§3.6)
6. 실행 의도 → 실행 → 결과 기록과 크래시 복구: 부팅 복구 알고리즘, replay 정책, "결과 불명" 표식과 모델 안내 문구, 복구 예산, 크래시 루프 차단 (§3.7)
7. 실행 소유권: boot_epoch 펜싱, run 단위 소유 (§3.8)
8. 동시 실행과 직렬화 단위 (§3.9)
9. 스케줄러·타이머 (§3.10)
10. 예산: 토큰·비용·시간·횟수, 초과 시 동작 (§3.11)
11. 사용자 입력이 실행 중 run에 들어가는 방식(steering, follow-up, interrupt) (§3.12)
12. 사람 결정 대기와 승인된 행동의 실행 (§3.13)
13. 하위 에이전트 실행(검증 에이전트, 중재자, 발산 가지, 하위 실행, 역할 호출) (§3.14)
14. 15·16이 쓰는 포트(`ModelPort` 등)의 구현 계약 (§3.15)

### 1.2 다루지 않는 것

| 주제 | 소유 문서 |
|---|---|
| 도구 목록·입력 스키마·잘림 규칙, Helm 제안 도구, 경로 정책, 범위 검사, 샌드박스 격리, MCP 연결, 하위 호출 도구, 런타임 어댑터 인터페이스 | 13 |
| pi 패키지를 vendor할지 고정 의존할지, 파일 단위 포크 계획, 라이선스 고지 | 07 (이 문서는 포크에 필요한 변경 목록만 요구한다, §3.4.1) |
| 명령·제안 카탈로그, 검증 규칙, 거부 세 갈래, 효과(effect) 종류, `pendingTimers`·`checkSettle`·`mustIncludeRefs`·`allowedCommands` 조회 함수 | 10 |
| 질문 레코드, 전달 방식 결정, 가정 만료의 의미, 승인 토큰, 중재자 판정 규칙 | 11 |
| 이벤트 envelope, SQLite DDL, 해시 체인, 투영 테이블, 백업 | 09 |
| 레코드 타입과 ID 접두사 확정 | 08 |
| 루프 계약, WorkUnit 템플릿, 모드·다이얼, 루프 활성화와 WorkUnit 생성(오케스트레이션), 주의 예산 | 14 |
| 탐구 실행(발산, 가지 배정, REPL 방식 탐구의 의미) | 15 |
| 관찰 에이전트의 마이닝·제안 | 16 |
| 데몬 프로세스·systemd·단일 인스턴스 락·저장 경로 | 17 |
| 위협 모델, 비밀 저장, 기기 인증 | 18 |
| 프로토콜 메서드·휘발 스트림 형식 | 19 |
| 화면별 표시 데이터의 내용 | 03·04 |

### 1.3 용어

| 용어 | 뜻 |
|---|---|
| run (`rn_`) | 에이전트 루프 한 번의 구동. 계기(사용자 입력, 타이머, 커널 효과, 오케스트레이터)에서 시작해 루프가 멈출 때까지(`agent_end`)다. 한 run은 Concern 하나와 thread 하나에 속하고, 보통 WorkUnit 하나에 속한다 |
| thread (`th_`) [제안, 08에 요구] | 같은 모델 대화 기록을 이어 쓰는 run들의 계보. 사람 결정을 기다리느라 run이 끝나도 답이 오면 같은 thread에서 새 run이 이어간다. 19의 `thread` 뷰가 이것을 보여 준다 |
| attempt | 같은 run을 이어서 구동한 횟수(1부터). 크래시 뒤 재개하면 attempt가 1 오른다. 펜싱 토큰의 일부다(§3.8) |
| turn | 모델 응답 하나와 그 응답의 도구 호출 배치. pi-agent-core의 `turn_start`~`turn_end`와 같다 [원문 `pi-src/packages/agent/src/agent-loop.ts:163-321`] |
| model request (`mr_`) [제안] | 제공자 요청 하나. turn마다 하나다. 재시도는 같은 `mr_`의 시도 번호로 센다 |
| tool call (`tc_`) | 모델이 낸 도구 호출 하나. 제공자가 붙인 ID(`toolu_…` 등)는 `providerCallId`로 따로 둔다 |
| 투영 (`cx_`) [제안] | 요청 하나에 쓴 모델 컨텍스트. 정본을 읽어 만들고 정본을 쓰지 않는다(브리프 §6). manifest를 남긴다(§3.5.6) |
| 주입 메시지 | 런타임이 thread에 덧붙이는 상태 메시지(`<helm_context>`). 사용자 발화와 구분해 기록한다(§3.5.2) |
| 실행 기록(runtime trace) | 메시지 본문, 모델 요청·응답 메타데이터, 주입 메시지, 컴팩션 요약처럼 도메인 레코드는 아니지만 복구와 투영 재구성에 필요한 기록. 09의 런타임 기록 테이블에 정본 이벤트와 같은 트랜잭션으로 쓴다(§3.4.10) |
| stage | thread가 지금 어느 단계에 있는지: `inference`, `tools`, `compaction`, `settlement`, `idle` (cases §3.5 happy-agent의 pending stage를 따름) |

## 2. 전제와 결정

### 2.1 브리프 결정과 이 문서의 귀결

| 결정 | 내용 | 이 문서의 귀결 |
|---|---|---|
| 14 | 모델은 제안하고 커널이 상태를 바꾼다 | 런타임은 상태를 바꾸지 않는다. 도구 호출 의도·결과, run 수명, 타이머 발화를 모두 10의 제출(Submission)로 보낸다(§3.4). 모델의 Helm 도구 호출도 같은 경로를 지난다 |
| 15(1) | write·send에는 작업 합의 필요 | `beforeToolCall`이 커널 판정을 받기 전에는 어떤 쓰기·발송 도구도 실행하지 않는다(§3.4.5) |
| 17 | 불변조건 1~7 불변 | 투영은 정본을 쓰지 않는다(불변조건 3): 투영 코드는 읽기 API만 쓴다(§3.5). 혼자 정한 결정 기록은 10이 검사한다 |
| 22 | 클라이언트 없이 작업 계속 | 실행 상태는 모두 데몬 SQLite에 있다. 클라이언트 연결 여부는 run에 영향이 없다 |
| 23, 27, 28 | 자체 런타임, pi-ai는 얇은 인터페이스 뒤, pi-agent-core 포크, 커널 검사는 루프 훅 네 곳 | §3.3, §3.4 |
| 29 | 기준 원본은 Helm 이벤트 로그. pi 세션 파일·pi-durable 저장소를 기준 원본으로 쓰지 않는다 | pi의 `SessionManager`·JSONL 세션 저장을 쓰지 않는다. 모델 컨텍스트는 요청마다 로그에서 다시 만든다(§3.5) |
| 30 | 실행 의도 → 실행 → 결과 기록, 재시작 시 "중단됨" 정리, 안전한 도구만 재실행, OpenCode write-ahead claim 참고 | §3.7 |
| 31 | 이벤트에 단조 증가 seq, 큰 데이터는 HTTP | 스트리밍 델타는 정본 로그에 넣지 않고 휘발 스트림으로 보낸다(§3.4.4, 19 P-08) |
| 34 | 런타임 어댑터 인터페이스를 지금 정의, 1차 구현은 자체 런타임 | 이 문서의 RunEngine이 1차 어댑터다. 인터페이스는 13 §3.11 |
| 36 | TypeScript strict, Node 22 LTS(06이 조정), TypeBox, better-sqlite3 | 저장소 쓰기는 동기다. 트랜잭션 안에서 `await`하지 않는다(§3.9.2) |
| 12 | 묻기 재설계, 가정 만료점 | 스케줄러가 시각 계기를 맡는다. 판정은 10·11 |
| §2.5 | 비밀은 SOPS, `secrets run`으로 프로세스 환경에 주입 | 모델 API 키는 데몬 환경변수에서만 읽는다(§3.3.4). 도구 자식 프로세스에는 넘기지 않는다(13 §3.6) |

### 2.2 원천에서 가져온 사실

| 사실 | 확인 | 이 문서에서 |
|---|---|---|
| `beforeToolCall`의 `args`는 `structuredClone`한 검증 결과이고 그 객체가 `execute()`로 간다. 훅에서 고치면 실행에 반영되고 transcript의 `toolCall.arguments`는 원래 값으로 남는다 | [원문] `pi-src/packages/ai/src/utils/validation.ts:317-349`, `pi-src/packages/agent/src/agent-loop.ts` `prepareToolCall`; [실험] pi-facts-1 실험 A1 | 모델이 낸 인자와 실행된 인자를 따로 기록한다(§3.4.5) |
| 루프는 `stopReason`이 `toolUse`가 아니어도 도구 호출을 실행한다. `length`면 모두 실행하지 않고 오류 결과를 만든다 | [원문] `agent-loop.ts` `runLoop`의 `message.stopReason === "length"` 분기, `failToolCallsFromTruncatedMessage` | §3.4.3 |
| `prepareRequest`가 돌려준 `context`의 `messages` 배열에 루프가 이후 응답·결과를 `push`한다 | [원문] `agent-loop.ts` `runLoop`(`currentContext = requestUpdate.context ?? currentContext` 뒤 `currentContext.messages.push`), pi-facts-1 0장 3 | 요청마다 새 배열을 넘긴다(§3.4.8) |
| 도구 결과 메시지에는 `structuredContent`가 없다. `afterToolCall`의 `result`와 `tool_execution_end` 이벤트의 `result`에는 있다 | [원문] `agent-loop.ts` `createToolResultMessage`, `emitToolExecutionEnd` | `afterToolCall`에서 기록한다(§3.4.6) |
| 병렬 모드에서 준비(검증·`beforeToolCall`)는 순서대로 하나씩, 실행만 동시, 결과 메시지는 배치가 모두 끝난 뒤 원래 순서로 발행 | [원문] `agent-loop.ts` `executeToolCallsParallel` | 결과는 `afterToolCall`에서 개별로 기록하고 결과 메시지 발행 시점에 기대지 않는다 |
| `beforeToolCall`이 끝난 뒤 abort를 보면 실행하지 않고 "Operation aborted" 결과를 만든다. 이때 `afterToolCall`은 불리지 않는다 | [원문] `agent-loop.ts` `prepareToolCall` | 의도 기록 뒤 실행하지 않은 호출을 따로 표시한다(§3.4.7, 포크 변경 F-3) |
| 이벤트 싱크(`emit`)는 루프가 `await`한다. 저수준 `runAgentLoop`도 마찬가지다 | [원문] `agent-loop.ts` `runAgentLoop`·`runLoop`의 `await emit(...)` | `message_end` 기록이 끝나야 도구 준비가 시작된다 |
| `runAgentLoopContinue`는 마지막 메시지가 assistant면 throw한다 | [원문] `agent-loop.ts:139-141` | 재개 컨텍스트는 마지막이 user·toolResult가 되도록 만든다(§3.7.5) |
| `AgentTool.replay?: "never" \| "safe"`는 타입에만 있고 루프는 읽지 않는다 | [원문] `pi-src/packages/agent/src/types.ts:489-490`, pi-facts-1 0장 13 | 런타임 복구가 읽는다. 기본값 `never`(§3.7.2) |
| pi-agent-core에는 재시도 정책이 없다. pi-ai는 `retryAssistantCall`, `isRetryableAssistantError`, `isContextOverflow`를 제공한다 | [원문] `pi-src/packages/ai/src/utils/retry.ts`, `utils/overflow.ts:137` | 재시도는 런타임이 한 겹으로만 한다(§3.3.6) |
| pi-durable `pi.tool`: `call` 단계에서 최종 인자와 replay 정책을 담아 `execute` 단계로 커밋, 재시작으로 `execute`에서 다시 열리면 저장 정책과 현재 정책이 모두 safe일 때만 재실행, 아니면 interrupted 오류 결과 | [원문] `pi-src/packages/durable/docs/spec.md` §8.4(3869-3927행), §5.2(1917-1933행) | §3.7 |
| 재시작으로 매달린 호출은 재실행하지 않고 재개 턴의 도구 집합을 replay-safe로 좁힌다 | [원문] cases §7.5, S4/openclaw-runtime §2.3 (`openclaw/src/agents/main-session-recovery/main-session-restart-recovery-resume-policy.ts:129-160`) | §3.7.5 |
| 도구 배치를 실행 전에 commit, 결과는 first-writer-wins, 마지막 결과와 다음 stage를 같은 트랜잭션에 | [원문] cases §3.5 (`happy-agent/.../AgentBase.ts:320-337, 4280-4285`) | §3.4.4, §3.4.6 |
| 비안전 호출은 재시작 뒤 오류 결과로 닫는다 | [원문] cases §3.5 (`happy-agent/.../AgentBase.ts:4296-4304`), pi-fabric `src/durable/agent.ts:98-105` | §3.7.4 |
| 스트리밍 델타를 저장하면 저널이 응답 길이의 제곱으로 자란다 | [원문] cases §6, S4/pi-fabric §9(b) (`pi-fabric/src/durable/agent.ts:16-20`) | 델타는 정본에 넣지 않는다 |
| 영속 재시도 예산 3회, 고정 dispatch ID, 크래시 루프 차단(5분에 비정상 부팅 3회) | [원문] S4/openclaw-runtime §2.3 | §3.7.5, §3.7.6 |
| 스케줄러: 다음 시각 계산만 라이브러리로, 타이머 하나 60초 상한, 재시작 때 실행 중 작업은 interrupted, catch-up 상한 5·간격 5초·에이전트 작업 2분 지연 | [원문] S4/openclaw-runtime §3.1, cases §12.1-9 | §3.10 |
| 깨어날 절대 시각을 저장, 대기 전에 도착한 답은 first-emit-wins로 보관 | [원문] cases §8.4 (absurd `sql/absurd.sql:1692-1915`, `sdks/typescript/src/index.ts:414-427`) | §3.10, §3.13 |
| pi 자체 retry와 세션 저장을 그대로 두면 이중 재시도·이중 기록이 생긴다 | [원문] cases §12.1-10, S4/openclaw §2 (`openclaw/CHANGELOG/2026.5.22.md:226,255,270`) | §3.3.6, §3.4.1 |
| 사람을 기다리며 도구 호출을 붙잡지 않는다(질문을 게시하고 run을 끝낸 뒤 답이 follow-up으로 깨운다) | [원문] S4/pi-web §5 (`pi-web/src/server/sessions/askUserTool.ts:94-104`) | §3.13 |
| Mastra는 사람 대기 시한이 없고 답이 대기보다 먼저 오면 오류가 난다 | [실험] `docs/v0.3/audit/mastra-review.md` §5 | §3.13.2 |
| OpenCode v2: 턴을 시작할 때 execution claim을 시작 이벤트와 같은 트랜잭션에 기록하고, 재시작 때 이어 실행하며 재개 횟수를 센다. "recovery is a property of the database, never of a shutdown hook" | [원문] `docs/v0.3/audit/backend-oss-research.md` §1.2 | §3.7.1 |
| v0.2 실행 후보 런타임: 상태 6개, step·tool-call 한도, steering·취소 의미(cooperative, atomic 지연, uncertain → awaiting_recovery), cursor에 묶인 Gate, 컨텍스트 우선순위 5단계·fail-closed | [원문] canon-2 §4.5, §4.7, §9.10, §9.11 | §3.2, §3.5, §3.12 |
| ContextProjection 상태 기계(Requested → Materialized → Delivered / Refreshed / Invalidated / Expired)와 필수 메타데이터 | [원문] canon §11.9 | §3.5.6 |
| Context Compilation은 반대 증거 보존을 제약 조건으로 둔다 | [원문] canon §13.10 | §3.5, §3.6 |

### 2.3 이 문서의 주요 설계 선택 [제안]

| 번호 | 선택 | 이유 |
|---|---|---|
| RT-1 | 루프는 pi-agent-core의 저수준 `runAgentLoop`/`runAgentLoopContinue`를 쓰고 `Agent` 클래스는 쓰지 않는다 | `Agent`는 메시지·큐·상태를 메모리에 갖는다. Helm은 그 상태를 SQLite에 두므로 두 벌이 된다(cases §12.2-3). 저수준 함수도 싱크를 `await`한다 |
| RT-2 | 모델 컨텍스트는 요청마다 로그에서 다시 만들고, 상태 변화는 thread 끝에 덧붙이는 주입 메시지로 전한다(앞부분을 고치지 않는다) | A11 집행. 앞부분이 바뀌지 않으므로 프롬프트 캐시가 유지된다(§3.5.3) |
| RT-3 | 도구 호출마다 `toolcall.intend` 제출(커널 판정 + 의도 커밋)을 실행 직전에, `toolcall.complete`를 결과 직후에 한 트랜잭션으로 커밋한다 | 결정 30. 의도 기록이 없으면 실행되지 않았다는 것이 확실하다 |
| RT-4 | 재시작 뒤 결과 없는 호출은 replay가 의도 시점과 현재 모두 `safe`일 때만 저장된 실행 인자로 다시 실행한다. 쓰기 도구는 해시 조건부 재적용을 둔다(13 §3.3). 나머지는 "결과 불명"으로 닫고 재개 첫 턴의 도구를 읽기·Helm 도구로 좁힌다 | 결정 30, cases §12.1-1·2 |
| RT-5 | 사람 결정이 필요하면 run을 끝낸다(`awaiting_human`). 도구 호출을 붙잡고 기다리지 않는다. 답이 오면 같은 thread의 새 run이 이어간다 | 재시작에 강하다. 매달린 도구 호출이 생기지 않는다 |
| RT-6 | 승인이 필요한 행동은 승인 뒤 모델이 다시 내지 않고 런타임이 저장된 실행 계획(정확한 인자)을 실행한다 | 승인과 실행 인자의 불일치를 없앤다(mastra-review §4 인자 지문, S4/openclaw-runtime §4.3 `systemRunPlan`) |
| RT-7 | 데몬 하나가 유일한 writer이고, run 단위 소유는 `(runId, attempt, bootEpoch)` 펜싱 토큰으로 지킨다 | 1인용 단일 데몬에서는 시간 lease가 필요 없다(S4/openclaw-runtime §5 피할 것 1) |
| RT-8 | 스케줄러는 메모리 힙 하나와 `setTimeout` 하나(최대 60초)로 돈다. 도메인 타이머의 원천은 커널 상태(`pendingTimers`)이고, 시스템 타이머(관찰 주기 등)만 런타임 테이블에 둔다 | 10 §3.1.5. 타이머 정본을 두 곳에 두지 않는다 |
| RT-9 | 모델 재시도는 `@helm/ai` 한 곳에서만 한다. pi-ai 제공자의 `maxRetries`는 0으로 둔다 | 이중 재시도 방지 |

## 3. 명세 본문

### 3.1 구성과 패키지 배치 [제안]

06 §3.3의 패키지 목록을 따른다. 이 문서가 소유하는 코드는 다음 위치에 둔다.

```text
packages/ai/src/                 @helm/ai (L3')
  gateway.ts        ModelGateway: 역할 해석, 스트림, 재시도, 대체, 사용량 계산
  config.ts         AiConfig 스키마(TypeBox)와 기본값
  credentials.ts    EnvCredentialStore (pi-ai CredentialStore 구현, 읽기 전용)
  roles.ts          ModelRole 레지스트리, 역할별 요구(이미지, 다른 계열)
  usage.ts          UsageRecord 계산(pi-ai calculateCost 사용)
  images.ts         이미지 입력 정규화(크기 조정은 07이 정한 이미지 모듈)
packages/agent/src/              @helm/agent (L3') pi-agent-core 포크. 07이 vendor 방식을 정한다
  loop.ts           runAgentLoop / runAgentLoopContinue (포크 변경 F-1~F-7 적용)
  types.ts
packages/runtime/src/            @helm/runtime (L4)
  run/engine.ts     RunEngine: run 시작·재개·중지, 루프 구동, 커널 연결점 (§3.4)
  run/hooks.ts      이벤트 싱크, beforeToolCall, afterToolCall, prepareRequest, finishTurn
  run/journal.ts    실행 기록 쓰기(engine.transact 위의 얇은 층), 펜싱 검사 (§3.8)
  run/inputs.ts     사용자 입력 inbox (§3.12)
  run/subagents.ts  검증·중재·가지·하위 실행 (§3.14)
  projection/model.ts     모델 컨텍스트 투영 (§3.5)
  projection/sections/*.ts  ContextSection 렌더러 (§3.5.4)
  projection/compaction.ts  컴팩션 (§3.6)
  projection/views.ts       화면 투영 공통 규약 (§3.5.8)
  recovery/boot.ts  부팅 복구 (§3.7.3)
  recovery/policy.ts replay 판정, 재개 정책 (§3.7.2, §3.7.5)
  scheduler/*.ts    단일 타이머 스케줄러 (§3.10)
  budget/*.ts       예산 원장과 집행 (§3.11)
  ports/*.ts        ModelPort, SubRunPort, ReplPort 구현 (§3.15)
  adapter/          런타임 어댑터 계약(13 §3.11)과 1차 어댑터
```

의존 방향(06 §3.2): `runtime` → `engine`, `ai`, `agent`, `tools`, `kernel`(순수 조회 함수만), `domain`. `agent`·`ai`·`tools`는 `engine`·`store`를 모른다. 모델 루프 코드에서 기록 계층으로 가는 경로는 `runtime/run/hooks.ts`뿐이다.

런타임이 상태를 바꾸는 방법은 두 가지다. 둘 다 06의 `@helm/engine`을 지난다.

| 쓰기 | API(06·09에 요구) | 내용 | 커널 판정 |
|---|---|---|---|
| 제출 | `engine.submit(submission)` / `tx.submit(...)` | 10의 명령: `run.start`, `run.end`, `toolcall.intend`, `toolcall.complete`, `toolcall.interrupt`, 모델의 Helm 제안 도구, `timer.fire` 등 | 받음 |
| 실행 기록 | `tx.appendTrace(records)` | 메시지 본문, 모델 요청 manifest와 응답 메타데이터, 주입 메시지, 컴팩션 요약, 입력 inbox 상태, 예산 원장 | 받지 않음. 형식 검사와 펜싱 검사만 |

한 트랜잭션 안에서 둘을 함께 쓸 수 있어야 한다(`engine.transact(fn)`, fn은 동기). 실행 기록은 도메인 레코드가 아니므로 판단·결과의 근거로 인용할 수 없다(10 V-REF-02는 관찰 레코드만 근거로 받는다).

### 3.2 run·thread 모델과 상태 기계

#### 3.2.1 타입

```ts
// packages/runtime/src/run/types.ts (공유 타입은 @helm/domain에 둔다)
export type RunKind =
  | 'work'       // 작업 에이전트. WorkUnit 실행
  | 'verifier'   // 검증 에이전트 (§3.14.2)
  | 'mediator'   // 중재자 (§3.14.3)
  | 'branch'     // 발산 가지 (§3.14.4, 15)
  | 'subrun';    // 하위 실행: 읽기 도구를 쓰는 새 컨텍스트 실행 (§3.14.5, 15 SubRunPort)

export type RunTrigger =
  | { kind: 'human_input'; inputId: RunInputId }
  | { kind: 'orchestrator'; activationRef: string; workUnitId: WorkUnitId }   // 14
  | { kind: 'kernel_effect'; effectId: string }                              // 10 KernelEffect
  | { kind: 'question_answered'; questionId: QuestionId }
  | { kind: 'approval_granted'; approvalId: string }
  | { kind: 'timer'; timerId: string }
  | { kind: 'recovery'; previousAttempt: number };

export interface RunSpec {
  runId: RunId;
  kind: RunKind;
  threadId: ThreadId;
  parentRunId?: RunId;              // 하위 run이면 부모. 소유 트리 (§3.14.1)
  concernId: ConcernId;
  workUnitId?: WorkUnitId;
  goalId: GoalId;
  workspaceRoot: string;            // 절대 경로. 08이 Concern/WorkUnit 필드로 정한다
  role: AgentRole;                  // 10 AgentRole: work | verifier | mediator | observer | router
  modelRole: ModelRole;             // §3.3.3
  loopId: LoopId;                   // 14
  step?: StepId;                    // 14
  primitives: readonly PrimitiveAction[];    // 14 WorkUnitTemplate.primitives ∩ 모드 능력
  proposalKinds: readonly ProposalKind[];    // 14 WorkUnitTemplate.proposalKinds
  context: {
    mode: 'fresh' | 'fork' | 'resume';       // 14 WorkUnitTemplate.context
    include: readonly ContextSection[];      // 14 LoopContract.context
    exclude: readonly ContextSection[];
    forkCursor?: number;                     // mode=fork면 공통 시작 cursor
    excludeThreads?: readonly ThreadId[];    // 형제 가지의 기록을 보지 않음 (§3.14.4)
  };
  instructions: string;             // 루프·단계 지시문(14가 제공하는 문장). 시스템 rules 절에 들어간다
  budget: RunBudget;                // §3.11
  trigger: RunTrigger;
  restrictFirstTurnToSafeTools?: boolean;  // 재개 첫 턴 제한 (§3.7.5)
}

export type RunStatus =
  | 'queued' | 'running' | 'stopping'
  | 'awaiting_human'      // 비종결: 사람 답 대기. 답이 오면 같은 thread의 새 run (§3.13)
  | 'awaiting_recovery'   // 비종결: 결과 불명 외부 행동을 사람이 해소해야 함 (§3.7.4)
  | 'interrupted'         // 비종결: 재시작으로 끊김. 재개 여부 판정 대기 (§3.7.5)
  | 'ended';              // 종결

export type RunEndReason =
  | 'yielded'             // 모델이 도구 호출 없이 멈춤. WorkUnit 종료 여부는 커널·14가 판정
  | 'handed_off'          // awaiting_human으로 넘김 뒤 답이 와서 다음 run이 이어받음
  | 'cancelled'           // 사람 또는 커널 효과(runtime.signal abort)로 중지
  | 'budget_exhausted'
  | 'step_limit'          // 요청 수 상한
  | 'failed'              // 복구할 수 없는 오류 (원인 코드 별도)
  | 'recovery_exhausted'  // 재개 예산 소진
  | 'superseded'          // 같은 thread에 새 run이 시작돼 대체됨
  | 'context_overflow';   // 필수 컨텍스트만으로 창을 넘음 (§3.5.5 fail-closed)
```

#### 3.2.2 run 상태 기계

| 상태 | 사건 | 가드 | 다음 상태 | 부수 효과 |
|---|---|---|---|---|
| (없음) | `startRun(spec)` | 같은 thread에 활성 run이 없음, 동시 실행 상한 안 (§3.9) | `queued` | `run.start` 제출 (WorkUnit·역할·부모·트리거 기록) |
| (없음) | `startRun(spec)` | 같은 thread에 활성 run이 있음 | 거부 `runtime.thread_busy` | 호출자는 입력을 inbox에 넣는다(§3.12) |
| `queued` | 슬롯 확보 | 예산 남음 | `running` | attempt=1, `ownerEpoch`=현재 epoch, stage=`inference` |
| `running` | 루프 `agent_end` | `finishTurn`이 끝을 냄, 열린 사람 대기 없음 | `ended(yielded)` | `run.end` 제출 |
| `running` | 커널 결정 `needs_gate`로 대기 필요(§3.13) | 질문이 아직 답 없음 | `awaiting_human` | 루프를 턴 경계에서 끝냄. 질문 ID 기록 |
| `running` | `cancel()` 또는 효과 `runtime.signal abort` | 실행 중 도구가 모두 취소 가능(§3.12.3) | `stopping` → `ended(cancelled)` | 제공자 요청 abort, cooperative 도구 abort |
| `running` | `cancel()` | atomic/none 도구 실행 중 | `stopping` | 현재 도구가 끝난 뒤 다음 단계 전에 멈춤 |
| `stopping` | 실행 중 도구 모두 정착 | - | `ended(cancelled)` | `run.end` |
| `running` | 예산 하드 상한 도달 | - | `stopping` → `ended(budget_exhausted)` | 진행 요약을 담은 질문 생성 요청(§3.11.4) |
| `running` | 요청 수 상한 | - | `ended(step_limit)` | 같은 처리 |
| `running` | 결과 불명 외부 행동(send 계열) | 도구가 `uncertain` 반환 | `awaiting_recovery` | 사람 해소 질문 (§3.7.4) |
| `running` | 복구 불가 오류(제공자 영구 오류, 펜싱 실패 등) | 재시도·대체 소진 | `ended(failed)` | 원인 코드 기록 |
| `running` / `stopping` / `queued` | 데몬 재시작 | 이전 epoch 소유 | `interrupted` | §3.7.3 정리 |
| `interrupted` | 재개 판정 통과 (§3.7.5) | 재개 예산 남음, safe mode 아님 | `running` | attempt+1, 같은 runId로 `run.start` 재제출(10에 요구: interrupted run의 재시작 허용) |
| `interrupted` | 재개 판정 실패 | - | `ended(recovery_exhausted)` 또는 그대로 대기(safe mode) | 복귀 요약에 복구 항목 |
| `awaiting_human` | 질문 답(`question.answered`) 또는 승인 | 같은 thread | `ended(handed_off)` + 새 run `queued` | 새 run은 trigger=`question_answered` |
| `awaiting_human` | 질문 철회·만료로 가정 확정 | 정보 게이트 | 같음 | 새 run이 가정 확정 사실을 주입받아 이어감 |
| `awaiting_human` | `cancel()` | - | `ended(cancelled)` | |
| `awaiting_recovery` | 사람 해소(`toolcall.recover`, 10 §3.11.7) | 결과: `confirmed_applied` / `confirmed_not_applied` / `manual_review` | `ended(handed_off)` + 새 run | 해소 결과를 주입하고 이어감 |
| 임의 활성 | 부모 run 취소 | - | `stopping` → `ended(cancelled)` | 소유 트리 위에서 아래로 취소 (§3.14.1) |

종결 뒤의 쓰기는 펜싱이 거부한다(§3.8).

#### 3.2.3 thread stage

stage는 run 행에 둔다. 마지막 도구 결과와 다음 stage를 같은 트랜잭션에 쓴다(cases §3.5, happy-agent `AgentBase.ts:4280-4285`). 재시작 뒤 어느 지점에서 끊겼는지를 꼬리 해석 없이 안다.

| stage | 들어가는 시점 | 재시작 때 의미 |
|---|---|---|
| `inference` | 요청 manifest 커밋(`model.requested`) | 응답이 없으면 요청을 버리고 다시 요청한다 |
| `tools` | assistant 메시지 커밋에 도구 호출이 있을 때 | 결과 없는 호출을 §3.7.2로 정리한다 |
| `compaction` | 요약 생성 시작 | 요약 미완료면 버리고 다음 요청 전에 다시 판정한다 |
| `settlement` | `finishTurn`이 끝내기 전 검사를 실행 중 | `checkSettle`을 다시 돌린다 |
| `idle` | run 종결, `awaiting_*` | 해당 없음 |

### 3.3 모델 계층 `@helm/ai`

#### 3.3.1 원칙 [결정 27 / 제안: 세부]

- pi-ai의 `Models`(`createModels()` + 필요한 제공자 팩토리만 `setProvider`)를 얇은 인터페이스 `ModelGateway` 뒤에 둔다 [원문 `pi-src/packages/ai/src/models.ts:150-242, 992`]. `providers/all.ts`(42개 전부)는 쓰지 않는다(pi-facts-1 §9.2).
- `@helm/ai` 밖에서는 pi-ai 타입 중 메시지·이벤트·`Usage`·`Model` 데이터 타입만 쓴다. 제공자 객체, `CredentialStore`, 재시도 도우미는 `@helm/ai` 안에서만 쓴다.
- 모델은 함수가 아닌 데이터다 [원문 pi-facts-1 §2.3]. 설정 파일은 `provider/id` 문자열로 모델을 가리키고 시작 때 해석한다.
- 런타임이 루프에 주는 `streamFn`은 `gateway.streamFor(runCtx)`가 만든다. 계약: 요청 실패로 throw하지 않고 `stopReason: "error" | "aborted"` 최종 메시지로 끝낸다 [원문 `pi-src/packages/agent/src/types.ts:20-37`].

#### 3.3.2 인터페이스

```ts
// packages/ai/src/gateway.ts
import type { AssistantMessage, AssistantMessageEventStream, Model, Api, Usage,
  TranscriptContext, SimpleStreamOptions } from './pi.js';   // pi-ai 재수출(07)

export type ModelRole =
  | 'work' | 'verifier' | 'mediator' | 'branch' | 'subrun'
  | 'summarizer'       // 컴팩션 요약 (§3.6)
  | 'subcall'          // 도구 없는 단일 호출 (13 helm_subcall, 15 ModelPort)
  | 'observer'         // 16
  | 'router';          // 14 모드 라우터

export interface ModelRef { provider: string; id: string }            // 예 { provider: 'anthropic', id: 'claude-…' }

export interface RoleRequirements {
  needsImages?: boolean;          // 이미지 입력이 있는 요청
  minContextWindow?: number;
  differentFamilyFrom?: ModelRef; // 검증·가지 독립성 (§3.3.3)
  preferIndex?: number;           // 가지별 다른 모델: 후보 목록에서 순번 (15 §3.4.6)
}

export interface ResolvedModel {
  ref: ModelRef;
  model: Model<Api>;
  thinking: ThinkingLevel;        // 'off' | 'minimal' | … | 'max' (pi-ai clampThinkingLevel로 조정)
  maxOutputTokens: number;
  cacheRetention: 'none' | 'short' | 'long';
  fallbacks: readonly ModelRef[]; // 대체 순서
}

export interface ModelGateway {
  resolve(role: ModelRole, req?: RoleRequirements): ResolvedModel;          // 후보가 없으면 throw AiConfigError
  /** pi-agent-core StreamFn 모양. 재시도·대체를 감싼다 */
  streamFor(ctx: StreamCallContext): (model: Model<Api>, context: TranscriptContext,
    options?: SimpleStreamOptions) => AssistantMessageEventStream;
  /** 도구 없는 단일 호출. 구조화 출력이면 스키마 검증과 재시도(최대 2회 추가) */
  complete<T = string>(req: CompleteRequest<T>): Promise<CompleteResult<T>>;
  usageOf(message: AssistantMessage, ref: ModelRef): UsageRecord;
  health(): ProviderHealth[];                                               // 17 상태 확인용
}

export interface StreamCallContext {
  runId: RunId; requestId: ModelRequestId; role: ModelRole;
  resolved: ResolvedModel;
  sessionKey: string;             // 캐시 키. threadId를 쓴다 (pi-ai StreamOptions.sessionId)
  onAttempt: (a: AttemptInfo) => void;    // 재시도·대체 시도마다 실행 기록으로 남긴다
  signal: AbortSignal;
}

export interface CompleteRequest<T> {
  role: ModelRole; requirements?: RoleRequirements;
  system: string; messages: readonly Message[];          // pi-ai Message
  outputSchema?: TSchema;                                 // TypeBox. 있으면 JSON 출력 강제·검증
  maxOutputTokens: number;
  memoKey?: string;                                       // 같은 키의 성공 결과가 기록에 있으면 재사용 (§3.15)
  budget: BudgetLease;                                    // §3.11
  attribution: { runId?: RunId; toolCallId?: ToolCallId; concernId?: ConcernId; account: BudgetAccount };
  signal?: AbortSignal;
}
export type CompleteResult<T> =
  | { ok: true; value: T; message: AssistantMessage; usage: UsageRecord; ref: ModelRef; fromMemo: boolean }
  | { ok: false; error: AiError; usage?: UsageRecord };

export type AiError =
  | { kind: 'auth'; provider: string; message: string }               // 키 없음·거부. 재시도 안 함
  | { kind: 'rate_limited'; retryAfterMs?: number }
  | { kind: 'overloaded' | 'transient'; message: string }
  | { kind: 'context_overflow' }                                      // pi-ai isContextOverflow
  | { kind: 'schema'; message: string; attempts: number }
  | { kind: 'aborted' }
  | { kind: 'budget'; message: string }
  | { kind: 'permanent'; message: string };

export interface UsageRecord {
  input: number; output: number; cacheRead: number; cacheWrite: number; reasoning?: number;
  totalTokens: number;
  costUsd: number;            // pi-ai calculateCost. 단가가 0이거나 모르면 0과 costKnown=false
  costKnown: boolean;
  provider: string; model: string; durationMs?: number;
}
```

#### 3.3.3 역할과 모델 선택 [제안]

설정은 데몬 설정 파일(06 §3.10이 위치와 형식 소유)의 `ai` 절이다.

```ts
// packages/ai/src/config.ts
export interface AiConfig {
  providers: Record<string, {
    enabled: boolean;
    baseUrl?: string;                       // 프록시·호환 엔드포인트
    headers?: Record<string, string>;       // 비밀 금지. 키는 env로만
    apiKeyEnv?: readonly string[];          // 이 제공자가 읽을 환경변수 이름. 기본은 pi-ai 제공자 기본값
    maxConcurrent?: number;                 // 제공자별 동시 요청 상한. 기본 4
  }>;
  roles: Record<ModelRole, {
    candidates: readonly string[];          // 'anthropic/claude-…' 형식. 앞이 우선
    thinking?: ThinkingLevel;               // 기본 'medium'(work), 'low'(mediator·subcall·summarizer)
    maxOutputTokens?: number;               // 기본 min(model.maxTokens, 16384)
    cacheRetention?: 'none' | 'short' | 'long';  // 기본 work·verifier·branch='short', 나머지 'none'
    differentFamilyFrom?: ModelRole;        // verifier: 'work'
  }>;
  retry: { maxRetries: number; baseDelayMs: number; maxDelayMs: number };   // 기본 4, 2000, 60000
  fallbackOn: readonly ('rate_limited' | 'overloaded' | 'transient' | 'auth')[]; // 기본 ['overloaded','transient']
}
```

`resolve(role, req)` 알고리즘:

```text
resolve(role, req):
  cands = config.roles[role].candidates (없으면 roles.work.candidates)
  cands = 해석 가능한(제공자 enabled, 키 있음, 모델 존재) 것만
  if req.needsImages: cands = cands.filter(m => m.input.includes("image"))
  if req.minContextWindow: cands = cands.filter(m => m.contextWindow >= req.minContextWindow)
  if req.differentFamilyFrom:
     다른 제공자 우선 → 같은 제공자의 다른 모델 → 둘 다 없으면 같은 모델을 쓰되 결과에 independence:'same_model' 표시
  if req.preferIndex: 후보를 그 순번부터 회전
  if cands 비어 있음: throw AiConfigError(code 'ai.no_model_for_role', role, req)
  primary = cands[0]; fallbacks = cands[1..]
  thinking = clampThinkingLevel(primary, roleCfg.thinking)   # pi-ai models.ts:1235-1257
```

- 검증 에이전트는 `differentFamilyFrom: work`가 기본이다(브리프 §6 검증 에이전트: "가능하면 다른 모델"). 같은 모델로 떨어지면 검증 결과에 `independence: 'same_model'`을 남기고 화면에 보인다(18·21).
- 가지별 다른 모델(15 §3.4.6)은 `preferIndex`로 후보를 돌려 고른다. 후보 수보다 가지가 많으면 순환한다.
- 14의 `modelHint`(`default` | `cheap` | `different_from_worker`)는 각각 역할 기본, `subcall` 역할 후보, `differentFamilyFrom: work`로 바꾼다.

#### 3.3.4 키 주입 [결정 §2.5 / 제안: 구현]

- 데몬은 `just` 레시피가 `secrets run`으로 띄운다(17). 모델 API 키는 데몬 프로세스 환경변수에만 있다. Helm 쪽 별도 비밀 저장소는 없다.
- `EnvCredentialStore`는 pi-ai `CredentialStore`를 구현한다 [원문 `pi-src/packages/ai/src/auth/types.ts:65-94`]. `read(providerId)`는 설정의 `apiKeyEnv` 또는 제공자 기본 환경변수 이름으로 `process.env`를 읽어 `{ type: 'api_key', key }`를 돌려준다. `modify`·`delete`는 `ai.credentials_readonly` 오류를 던진다. OAuth 구독 로그인은 1차 범위 밖이다(§7 O-12-08).
- 시작 때 키를 메모리에 복사해 둔다. 이후 `process.env`의 해당 이름은 지운다(`delete process.env[name]`). 자식 프로세스가 상속하지 않게 하는 1차 조치다. `/proc/<pid>/environ`에는 시작 시 환경이 남으므로 도구 프로세스는 pid 네임스페이스로 분리한다(13 §3.6.4) [지식: `/proc/<pid>/environ`은 exec 시점 환경 블록을 보여 준다].
- 키 값은 이벤트, 실행 기록, 로그, 오류 메시지, 투영에 넣지 않는다. `@helm/ai`가 만드는 오류 문자열은 키 패턴(18의 마스킹 규칙)을 지운 뒤 내보낸다. 도구 출력의 비밀 대조 마스킹은 13 §3.6.4.
- `.env.example`에 적을 키 이름(17·18과 맞춘다): `ANTHROPIC_API_KEY=`, `OPENAI_API_KEY=`, `GEMINI_API_KEY=`, `OPENROUTER_API_KEY=`. 설정에서 켠 제공자의 키가 없으면 그 제공자는 `health()`에 `missing_key`로 보이고 후보에서 빠진다.

#### 3.3.5 스트림 호출 [제안]

`streamFor(ctx)`가 만드는 함수는 다음을 한다.

```text
stream(model, context, options):
  opts = { ...options,
           apiKey: undefined,                # 제공자 auth가 EnvCredentialStore로 해석
           sessionId: ctx.sessionKey,        # 캐시 키
           cacheRetention: ctx.resolved.cacheRetention,
           maxRetries: 0,                    # pi-ai 자체 재시도 끔 (RT-9)
           maxTokens: ctx.resolved.maxOutputTokens,
           reasoning: thinking,
           signal: ctx.signal,
           metadata: { helm_run: ctx.runId, helm_request: ctx.requestId } }   # 512자 상한
  return retryingStream(attempt => models.streamSimple(currentModel, context, opts))
```

`retryingStream`은 pi-ai `retryAssistantCall`의 정책 형태를 따르되 스트림 단위로 감싼다 [원문 `pi-src/packages/ai/src/utils/retry.ts:116-262`].

1. 시도의 최종 메시지가 `stopReason: "error"`이고 `isRetryableAssistantError`가 참이며 **아직 어떤 콘텐츠 이벤트(`text_delta`, `toolcall_start` 등)도 소비자에게 내보내지 않았으면** 백오프(지수, 지터, `retryAfterMs` 우선) 뒤 다시 시도한다. 이미 내보낸 뒤라면 재시도하지 않고 오류 메시지를 그대로 끝낸다(루프가 `stopReason: error`로 끝나고 run이 §3.4.3 규칙으로 다시 요청한다).
2. 재시도가 `maxRetries`를 넘고 오류 종류가 `fallbackOn`에 있으면 다음 대체 모델로 바꿔 처음부터 시도한다. 대체는 run이 끝날 때까지 유지하고 `model.switched` 실행 기록을 남긴다. 제공자가 바뀌면 pi-ai `transformMessages`가 thinking 블록과 도구 호출 ID를 바꾼다 [원문 `pi-src/packages/ai/src/api/transform-messages.ts:64-235`].
3. `context_overflow`(pi-ai `isContextOverflow`)는 재시도하지 않는다. run이 컴팩션 후 한 번 다시 요청한다(§3.6.2).
4. `auth`는 재시도하지 않는다. `fallbackOn`에 `auth`가 있을 때만 대체한다.
5. 모든 시도는 `ctx.onAttempt`로 실행 기록(`model.attempted`: 시도 번호, 모델, 오류 종류, 대기 시간)을 남긴다.

제공자 동시 요청 수는 제공자별 세마포어(`maxConcurrent`)로 묶는다. 대기 시간은 예산의 벽시계에 포함된다.

#### 3.3.6 pi 쪽 재시도·세션 기능을 끄는 목록 [제안]

| pi 기능 | 처리 | 근거 |
|---|---|---|
| pi-ai 제공자 내장 재시도(`maxRetries`) | 0 | 이중 재시도(cases §12.1-10, openclaw `2026.5.22.md:255`) |
| pi-ai `cacheRetention`·`sessionId` | Helm이 명시 | 캐시 키를 thread로 고정 |
| coding-agent `SessionManager`, 세션 JSONL, 자동 컴팩션, 자동 재시도 | 쓰지 않는다(가져오지 않음) | 결정 29, 이중 기록 방지 |
| agent-core 전역 기본 `streamFn`(`setDefaultStreamFn`), `streamProxy` | 쓰지 않는다 | 테스트 간 상태 공유 방지(pi-facts-1 §9.1) |
| pi-ai `CredentialStore` 쓰기, OAuth | 쓰지 않는다(읽기 전용 env) | §3.3.4 |

#### 3.3.7 사용량과 비용 기록 [제안]

- 모든 assistant 최종 메시지는 `usage`를 가진다 [원문 `pi-src/packages/ai/src/types.ts:446-467`]. `usageOf`는 pi-ai `calculateCost(model, usage)`로 비용을 계산한다 [원문 `pi-src/packages/ai/src/models.ts:1200-1222`]. 단가가 모두 0이면 `costKnown: false`로 둔다(구독형·로컬 모델).
- `model.responded` 실행 기록에 `UsageRecord`, `durationMs`, `stopReason`, `responseModel`을 남긴다. 같은 트랜잭션에서 예산 원장(§3.11)에 차감한다.
- 중단(`aborted`) 응답의 부분 사용량도 기록한다(pi-ai는 중단 응답에도 usage를 채운다 [원문 pi-facts-1 §2.9]).
- 크래시로 응답을 받지 못한 요청은 `model.request_abandoned`로 닫고 비용을 `unknown`으로 둔다. 예산에는 그 요청의 입력 토큰 추정치만큼 보수적으로 차감한다(§3.11.3).
- 사용량은 도메인 이벤트가 아니다(canon-2 §1.22: token usage를 자동으로 domain Event로 만들지 않는다). 다만 합의 예산 검사(10 V-POL-04)를 위해 `toolcall.intend` 제출에 현재 합의 단위 사용량 요약을 넣는다(§3.4.5).

#### 3.3.8 이미지 입력 [제안]

- 자극(`st_`) 같은 이미지는 HTTP로 올라와 blob 저장소(09·17)에 내용 주소(`sha256:…`)로 저장된다(19 P-13). 기록에는 blob 참조만 둔다.
- 투영을 만들 때 blob을 읽어 pi-ai `ImageContent { type: 'image', data: base64, mimeType }`로 바꾼다 [원문 `pi-src/packages/ai/src/types.ts:414-444`].
- 모델의 `inputLimits.images`(`resize.maxWidth/maxHeight/maxBytes/jpegQuality`, `maxPerMessage`, `maxPerRequest`)를 지킨다 [원문 `pi-src/packages/ai/src/providers/model-schema.ts:48-84`]. 크기 조정 코드는 pi-ai에 없으므로 07이 정하는 이미지 모듈(coding-agent `utils/image-process.ts` 포크 후보)을 쓴다. 조정한 결과는 `sha256` 키로 캐시한다(같은 blob을 매 요청 다시 조정하지 않음, 캐시도 결정적이어야 투영 바이트가 같다).
- 이미지가 필요한 run은 `resolve(role, { needsImages: true })`로 모델을 고른다. 후보가 없으면 run을 시작하지 않고 `ai.no_model_for_role`로 사람에게 알린다. 이미지를 받지 못하는 모델로 대체되면 pi-ai가 자리표시 텍스트로 바꾸므로(pi-facts-1 §2.11-1) 대체 후보에서도 이미지 미지원 모델을 뺀다.
- 요청당 이미지 수가 `maxPerRequest`를 넘으면 오래된 주입 이미지부터 `[image elided: sha256:… — reload with helm_query]` 텍스트로 바꾼다(§3.5.7).

### 3.4 루프 포크 `@helm/agent`와 커널 연결점

#### 3.4.1 포크 범위와 변경 목록 [결정 28 / 제안: 변경 목록, 07에 요구]

`@helm/agent`는 pi-agent-core의 `agent-loop.ts`, `types.ts`를 포크한다. `agent.ts`(`Agent` 클래스), `proxy.ts`, `stream-fn.ts`는 쓰지 않는다(RT-1, §3.3.6). 루프 알고리즘(pi-facts-1 §3.4)은 그대로 두고 다음만 바꾼다. 07은 이 요구를 패치 A1~A7로 받았다(07 D07-3, §3.5): F-1 → A2(`hook_error` 종류 추가), F-2 → A4, F-3 → A1(루프가 받은 배열을 복사), F-4 → A5(별도 이벤트 `tool_execution_executing`), F-5 → A6, F-6 → A7, 중단 시 남은 호출도 결과를 받게 하는 A3. 아래 표는 요구의 원래 모양이고 이름은 07을 따른다.

| ID | 변경 | 이유 | 시험 |
|---|---|---|---|
| F-1 | `AgentToolCallOutcome`과 `tool_execution_end` 이벤트에 `executed: boolean`, `rejection?: { kind: 'unknown_tool' \| 'invalid_args' \| 'blocked' \| 'aborted_before_execute' \| 'truncated_response'; message: string }`을 더한다 | 현재는 실행하지 않은 결과와 실행한 오류 결과를 이벤트로 구분할 수 없다. `beforeToolCall` 뒤 abort로 실행하지 않은 호출(`prepareToolCall`의 두 번째 abort 검사)을 의도 기록과 맞춰 닫아야 한다 | 다섯 경우를 faux 대본으로 재현해 `executed`·`rejection.kind` 확인 |
| F-2 | `BeforeToolCallResult`에 `args?: unknown`을 더한다. 주어지면 루프가 그 값을 도구 스키마로 다시 검증한 뒤 `execute()`에 넘긴다. 검증 실패면 `invalid_args` 결과 | 지금은 `args` 객체를 제자리에서 고쳐야 실행에 반영된다(문서 계약 아님, pi-facts-1 0장 1). Helm은 정규화한 절대 경로 등 "실행된 인자"를 명시적으로 넘기고 기록한다 | 훅이 바꾼 인자가 `execute`에 가고 transcript의 `toolCall.arguments`는 원래 값인지 |
| F-3 | `prepareRequest`가 돌려준 `context`를 루프가 소유한다는 것을 타입 주석과 테스트로 고정한다(코드 변경 없음). Helm은 매 요청 새 배열을 넘긴다 | pi-facts-1 0장 3 | 넘긴 배열과 다음 요청 배열이 다른 객체이고, 이전 배열에 루프가 push한 것이 다음 투영에 영향이 없는지 |
| F-4 | `tool_execution_start`를 `beforeToolCall` 뒤로 옮기지 않는다(현재처럼 준비 전에 발행). 대신 이벤트에 `phase: 'requested'`를 넣고, 실행 직전에 `tool_execution_start`를 `phase: 'executing'`으로 한 번 더 낸다 | 화면이 "검사 중"과 "실행 중"을 나눠 보인다(19 휘발 스트림) | 이벤트 순서 스냅숏 |
| F-5 | `setDefaultStreamFn`·`getDefaultStreamFn`·`streamProxy`를 내보내지 않는다. `runAgentLoop`의 `streamFn` 인자를 필수로 바꾼다 | 전역 상태 제거 | 타입 검사 |
| F-6 | `finishTurn`이 error/aborted 응답에도 불린다는 현재 동작을 유지하고, 결정 무시를 문서화한다 | Helm은 이때 stage 정리만 한다 | 기존 테스트 유지 |
| F-7 | 포크 재동기화 때 내보내기 표면 무결성 테스트를 둔다(07 소유) | cases §12.1-10 (`pi-web/src/server/piSdkIntegrity.test.ts`) | 07 |

도구별 취소 신호(atomic 도구에 abort를 전달하지 않기)는 루프를 바꾸지 않고 13의 도구 래퍼가 처리한다(13 §3.1).

#### 3.4.2 루프 설정 [제안]

```ts
// packages/runtime/src/run/engine.ts (요지)
const config: AgentLoopConfig = {
  model: resolved.model,                     // §3.3.3. prepareRequest가 요청마다 다시 정할 수 있다
  reasoning: resolved.thinking === 'off' ? undefined : resolved.thinking,
  convertToLlm: (msgs) => msgs as Message[], // 투영이 이미 pi-ai Message만 만든다(커스텀 메시지 없음)
  // transformContext: 쓰지 않는다. 컨텍스트 결정은 prepareRequest 한 곳
  getApiKey: undefined,                      // EnvCredentialStore가 해석 (§3.3.4)
  toolExecution: 'parallel',                 // 도구별 executionMode가 sequential이면 배치 전체가 순차 (pi 규칙)
  prepareRequest: hooks.prepareRequest,      // 연결점 4 (§3.4.8)
  beforeToolCall: hooks.beforeToolCall,      // 연결점 2 (§3.4.5)
  afterToolCall: hooks.afterToolCall,        // 연결점 3 (§3.4.6)
  finishTurn: hooks.finishTurn,              // §3.4.9
  getSteeringMessages: inputs.takeSteering,  // §3.12
  getFollowUpMessages: inputs.takeFollowUp,  // §3.12
  prepareNextTurn: undefined,                // 컴팩션은 prepareRequest에서 (§3.6)
};
await runAgentLoop(initialPrompts, initialContext, config, hooks.sink, abortController.signal, gateway.streamFor(ctx));
```

- `initialContext`는 투영으로 만든 컨텍스트다. `initialPrompts`는 이번 run을 연 입력(이미 inbox에서 커밋되어 있음)이다. 재개 run은 `runAgentLoopContinue(projectedContext, …)`를 쓴다(§3.7.5).
- 도구 객체(`AgentTool`)는 13의 `HelmToolSpec`을 루프용으로 감싼 것이다(13 §3.1).

#### 3.4.3 한 turn의 순서

```text
[prepareRequest]  펜싱 확인 → 예산 사전 검사 → 투영 생성(필요하면 주입·컴팩션 커밋) → model.requested 커밋(stage=inference) → 새 messages 배열 반환
      │
[stream]          휘발 스트림으로 조각 전달 (정본 기록 없음)
      │
[sink: message_end(assistant)]  한 트랜잭션: assistant 메시지 + model.responded(사용량) + 예산 차감
      │                          + 도구 호출 배치(tc_ 발급, state=requested) + stage(tools | settlement)
      │  ── stopReason ∈ {error, aborted}: 도구 없음, finishTurn(무시됨), agent_end → run 수준 처리(§3.4.9)
      │  ── stopReason = length 이고 도구 호출 있음: 모두 실행하지 않음 → F-1 rejection 'truncated_response'
      │  ── 그 밖(stop, toolUse 모두): 도구 호출을 실행한다 (pi 동작 유지)
      ▼
for each 도구 호출 (준비는 순서대로 하나씩):
  [validate]        이름 해석, prepareArguments, 스키마 검증 ── 실패: 즉시 결과(F-1 unknown_tool / invalid_args)
  [beforeToolCall]  펜싱 → 13 prepare(경로 정규화, 대상, 샌드박스, 사전 해시) → 권한 레이어 판정
                    → (Helm 제안 도구가 아니면) 한 트랜잭션: toolcall.intend 제출 + 기록 (state=intended | blocked | gated)
                    → 허용이면 {args: 실행 인자}, 아니면 {block, reason}
  [execute]         병렬 가능한 것은 동시에. 진행 조각은 휘발 스트림
  [afterToolCall]   13 postprocess(잘림, 전체 출력 blob, 변경 감지, 비밀 마스킹)
                    → 한 트랜잭션: toolcall.complete 제출(관찰 생성은 커널) + 결과 본문 기록 (first-writer-wins)
                      + 배치의 마지막 결과면 stage=inference
      │
[sink: tool_execution_end]  F-1의 executed=false이면 not_executed 기록(의도가 있었으면 toolcall.interrupt{not_executed})
[sink: message_end(toolResult)]  결과가 기록되어 있는지 확인만 한다(본문은 이미 있음)
      │
[finishTurn]      사람 대기 확인 → checkSettle(10) → 예산·요청 수·취소 확인 → end | continue | 기본
[getSteeringMessages]  inbox에서 steering 입력을 커밋(delivered)하고 돌려준다
      └─ 다음 turn
```

#### 3.4.4 연결점 1: 이벤트 싱크

이벤트 싱크(`AgentEventSink`)는 루프가 `await`한다 [원문 `agent-loop.ts` `runAgentLoop`]. 싱크 안의 기록은 동기 트랜잭션이므로 싱크가 돌아온 시점에 기록이 끝나 있다.

| 이벤트 | 처리 | 기록 |
|---|---|---|
| `agent_start`, `turn_start`, `turn_end` | 메모리 상태(현재 turn 번호)만 | 없음 |
| `message_start` / `message_update` (assistant) | 휘발 스트림 `stream.chunk`(19 P-08)로 보낸다. run마다 조각 번호 `n`. `partial`은 공유 객체이므로 보낼 때 필요한 필드만 복사한다 [원문 pi-facts-1 §2.5] | 없음 (cases §12.1-6) |
| `message_end` (assistant) | 아래 트랜잭션 A | 있음 |
| `message_start`/`message_end` (user) | 이 메시지가 이미 기록되어 있는지 확인한다(`messageId`로). 모든 사용자·주입 메시지는 루프에 넘기기 전에 커밋한다(§3.12) | 없음(중복 확인만). 없으면 버그로 보고 즉시 기록 |
| `message_start`/`message_end` (toolResult) | 결과가 기록되어 있는지 확인한다 | 없음 |
| `tool_execution_start`, `tool_execution_executing`(07 A5) | 휘발 스트림 `tool.progress`(검사 중 / 실행 중) | 없음 |
| `tool_execution_update` | 휘발 스트림. 진행 조각은 기록하지 않는다 | 없음 |
| `tool_execution_end` | `executed=false`면 트랜잭션 C. 아니면 없음(결과는 afterToolCall에서 기록) | 경우에 따라 |
| `agent_end` | run 종료 처리(§3.4.9) | `run.end` 제출 |

트랜잭션 A (assistant 메시지 확정, "배치 선커밋"):

```text
tx:
  fence(handle)                                          # §3.8
  appendTrace message.committed { messageId, threadId, runId, requestId, role:'assistant',
       content (thinking·signature 포함, 그대로), stopReason, errorMessage?, responseModel, timestamp }
  appendTrace model.responded { requestId, usage: UsageRecord, durationMs, stopReason, attempts }
  budget.charge(run, usage)                              # §3.11
  for (i, call) in toolCalls(message):
      tcId = newId('tc')
      appendTrace toolcall.requested { tcId, providerCallId: call.id, index: i, toolName: call.name,
                                       modelArgs: call.arguments, requestId, messageId }
  stage = toolCalls.length > 0 ? 'tools' : 'settlement'
```

- 모델이 낸 인자(`modelArgs`)는 여기서 원래 값 그대로 남는다. 실행된 인자는 트랜잭션 B에 따로 남는다.
- 같은 메시지를 두 번 커밋하지 않는다(`messageId` 유일). 재시작 뒤 같은 요청을 다시 보내 다른 응답을 받으면 새 `messageId`를 받는다.
- thinking 블록은 같은 제공자로 이어갈 때 필요하므로 그대로 저장한다(pi-ai가 제공자가 바뀌면 변환한다). 화면에는 보이지 않는다(canon-3 G15: raw chain-of-thought는 노출 대상도 근거도 아님).

#### 3.4.5 연결점 2: `beforeToolCall`

```text
beforeToolCall({ assistantMessage, toolCall, args, context }, signal):
  h = runHandle
  if not journal.fenceOk(h):                               return { block: true, terminate: true, reason: R.superseded }
  tc   = journal.toolCallByProvider(h.runId, toolCall.id)   # 트랜잭션 A에서 만든 기록
  spec = tools.registry.get(toolCall.name)                  # 13 HelmToolSpec
  if h.restrictToSafe and not spec.safeForRecoveryTurn:     → block(R.restart_safe_turn)        # §3.7.5
  if spec.primitive ∉ h.spec.primitives:                    → block(R.primitive_not_allowed)    # 14 능력 부분집합

  # 13: 정규화와 실행 준비. 파일을 바꾸지 않는다. 실패하면 경로 정책 거부
  prep = spec.prepare(args, toolCtx(h))
       # → { executedArgs, targets: ResourceUri[], targetsKnown, sandbox?: SandboxSpec,
       #     replayGuard?: { kind:'file_hash', path, before, after } , pathDenials: [] }
  if prep.pathDenials 있음:                                 → tx: trace toolcall.denied_by_path_policy; block(R.path_policy(prep))

  if spec.kind == 'helm':                                   # Helm 제안 도구 (13 §3.7)
       return { args: prep.executedArgs }                   # 의도 기록 없음. execute 안에서 제출과 결과가 한 트랜잭션 (원자)

  verdict = permission.classify({ primitive, tool, executedArgs, targets, targetsKnown, sandbox, cwd, concern })   # 13·18
  d = tx(() => {
        fence(h)
        dec = tx.submit({ type: 'toolcall.intend', channel: 'runtime', actor: { kind: 'runtime' },
                          correlation: { goalId, concernId, workUnitId, runId: h.runId, toolCallId: tc.id },
                          contextRef: h.contextRefOf(tc.requestId),      # 10 V-FORM-06
                          permission: verdict,                            # 10 V-FORM-08
                          idempotencyKey: `intend:${tc.id}`,
                          payload: { toolCallId: tc.id, providerCallId: toolCall.id, tool: spec.name,
                                     toolVersion: spec.version, primitive: spec.primitive,
                                     modelArgs: toolCall.arguments, executedArgs: prep.executedArgs,
                                     argsFingerprint: fingerprintArgs(spec.name, prep.executedArgs),   # @helm/domain 공유 정규화 (13 §3.7.7, 11 §3.14)
                                     agreementId: h.activeAgreementId(), approvalId: h.approvalFor(tc), purpose: h.purposeOf(tc),
                                     targets: prep.targets, targetsKnown: prep.targetsKnown,
                                     sandbox: summarize(prep.sandbox), replay: spec.replay,
                                     replayGuard: prep.replayGuard, cancellation: spec.cancellation,
                                     agreementUsage: budget.agreementUsage(h) } })
        trace toolcall.state { tcId, state: map(dec.status), decisionRef: dec.submissionId, questionId: dec.gate?.questionId }
        return dec })
  switch d.status:
    'accepted'   → return { args: prep.executedArgs }                                   # F-2
    'rejected'   → return { block: true, reason: formatRejection(d.rejection) }        # code, message, missing, next (10 §3.4.2)
    'needs_gate' → h.pendingGates.add(d.gate.questionId)
                   return { block: true, reason: formatGate(d) }                       # "사람 확인 대기 중(qs_…). 이 호출은 실행되지 않았다"
    'conflict'   → return { block: true, reason: formatConflict(d) }                   # 다시 시도 가능
    'error'      → opslog.error; return { block: true, reason: R.kernel_error }
  예외(저장 실패 등) → return { block: true, terminate: true, reason: R.journal_unavailable }; h.failAfterTurn('journal_unavailable')
```

규칙:

- **의도 커밋 없이는 실행하지 않는다.** 저장 실패, 펜싱 실패, 커널 오류는 모두 차단으로 끝난다(fail-closed).
- 모델이 낸 인자와 실행된 인자는 각각 `modelArgs`, `executedArgs`로 남는다. `argsFingerprint`는 승인 토큰의 인자 지문 대조(10 P-3, 11 §3.14)와 재실행 동일성 검사에 쓴다. 10 §3.11.7의 `ToolCallIntendPayload`가 커널에 들어가는 최소 필드이고, 나머지(모델 인자, 실행 인자, 샌드박스 요약, guard)는 실행 기록에 같은 트랜잭션으로 남긴다.
- 원시 행동이 `read`인 호출은 커널이 검사만 하고 의도 이벤트를 만들지 않는다(10 §3.11.7 빠른 경로). 런타임 실행 기록에는 `intended` 상태가 남는다. 읽기 도구는 `replay: 'safe'`라 복구에 커널 의도 이벤트가 필요 없다.
- 차단 사유 문장은 10 §3.4.2의 `code`, `message`, `missing`, `next`만 모델에게 준다. 형식: `[helm:blocked] <code>: <message> | missing: … | next: …`. 문장은 10이 한국어로 만든다.
- `needs_gate`이면 질문이 생긴다(10 §3.4.5). 같은 배치의 나머지 호출은 각자 검사를 받는다. 턴이 끝나면 `finishTurn`이 run을 `awaiting_human`으로 넘긴다(§3.4.9).
- `contextRef`는 이 도구 호출을 낸 assistant 메시지의 요청(`mr_`)에 쓴 투영이다(§3.5.6).
- Helm 제안 도구는 의도 기록을 따로 두지 않는다. 도구 `execute`가 제안 제출과 결과 기록을 한 트랜잭션으로 하므로 "실행했는지 모르는" 상태가 생기지 않는다(13 §3.7.3).

#### 3.4.6 연결점 3: `afterToolCall`

```text
afterToolCall({ toolCall, args, result, isError, context }, signal):
  h = runHandle; tc = journal.toolCallByProvider(h.runId, toolCall.id)
  if spec.kind == 'helm': return undefined                    # 결과는 execute 안에서 이미 기록
  post = spec.postprocess(result, isError, tc, h)               # 13: 모델용 잘림, 전체 출력 blob, 비밀 마스킹,
                                                                #     변경 감지(ChangeSet), materialRefs(file@hash)
  if not journal.fenceOk(h):
       opslog.warn('late result after fence', tc)               # 기록하지 않는다. 새 attempt가 결과 불명으로 처리
       return { content: post.modelContent, isError: true }
  tx:
    fence(h)
    existing = journal.completionOf(tc.id)
    if existing: return existing.modelResult                    # first-writer-wins
    dec = tx.submit({ type: 'toolcall.complete', channel: 'runtime', actor: { kind:'runtime' },
                      correlation: {…, toolCallId: tc.id}, idempotencyKey: `complete:${tc.id}`,
                      payload: { toolCallId: tc.id, outcome: isError ? 'failed' : 'succeeded',   # 10 ToolCallCompletePayload
                                 observationId: newId('ob'),                   # 런타임이 미리 만든 관찰 ID (10 §3.11.7)
                                 output: { contentHash, ref: blobRef, summary },
                                 durationMs, exitCode?, contentDigest: sha256(post.modelContent),
                                 structuredContent: post.structured,            # outputSchema 있는 도구
                                 observedChanges: post.changes,                 # 13 ChangeSet. 대상 미상 실행의 사후 검사
                                 materialRefs: post.materialRefs, blobRefs: post.blobRefs,
                                 enforcement: post.enforcement } })             # 'pre' | 'post_hoc' | 'advisory'
    trace toolcall.result { tcId, modelContent: post.modelContent, details: post.details,
                            structuredContent: post.structured, isError, truncated: post.truncation }
    if 배치의 결과 없는 호출이 이것뿐: stage = 'inference'
    if dec.notices 있음: h.pendingNotices.push(dec.notices)      # 다음 요청의 주입 메시지로 (§3.5.2)
    if dec.status == 'needs_gate': h.pendingGates.add(dec.gate.questionId)   # 예: 사후 검사에서 범위 밖 변경
  return { content: post.modelContent, details: post.details, isError, structuredContent: post.structured }
```

- `structuredContent`는 결과 메시지에 들어가지 않으므로(§2.2) 여기서 기록한다. 모델이 보는 내용은 `content`뿐이다.
- 모델용 결과 본문 끝에 `[helm] observation ob_… recorded for this result`를 붙인다. 모델이 근거로 인용할 관찰 ID를 알게 한다(13 §3.7.1).
- 관찰(`ob_`)은 커널이 `toolcall.complete`를 받아 만든다(10, "관찰은 도구 호출 ID를 출처로": extracts-2 X2-6-14). 런타임은 관찰 ID만 미리 정하고 관찰 레코드는 만들지 않는다.
- 실행이 throw한 경우도 루프가 오류 결과로 바꿔 `afterToolCall`이 불린다 [원문 `agent-loop.ts` `executePreparedToolCall`]. 이때 `outcome: 'failed'`다.
- 13의 도구가 `uncertain`(외부 결과를 알 수 없음, 예: 발송 뒤 응답 유실)을 돌려주면 `toolcall.complete` 대신 `toolcall.outcome_unknown { requiresHuman: true }`를 제출하고 run을 `awaiting_recovery`로 보낸다(§3.7.4, canon-2 §4.7).

#### 3.4.7 즉시 결과

| 경우 | 의도 기록 | 처리(싱크의 `tool_execution_end`, F-1) |
|---|---|---|
| 도구 이름 없음 (`unknown_tool`) | 없음 | trace `toolcall.not_executed { reason }`. 모델에게는 루프가 만든 오류 결과 |
| 인자 검증 실패 (`invalid_args`) | 없음 | 같음 |
| 응답이 출력 한도로 잘림 (`truncated_response`) | 없음 | 같음. 문구는 pi 원문 그대로 [원문 `agent-loop.ts` `failToolCallsFromTruncatedMessage`] |
| `beforeToolCall` 차단 (`blocked`) | 커널 결정(rejected / needs_gate)이 이미 기록됨 | 추가 기록 없음 |
| `beforeToolCall` 뒤 abort로 실행 안 함 (`aborted_before_execute`) | 있음(accepted) | `toolcall.interrupt { reason: 'cancel' }` 제출(10). 실행 기록에 `not_executed`를 남겨 의도를 "실행 안 함"으로 닫는다 |
| 병렬 배치에서 abort 뒤 시작 안 한 호출 | 있음 | 같음 |
| 순차 배치에서 abort 뒤 남은 호출 | 없음(준비 전) | 07 패치 A3로 이 호출들도 `executed: false`, `rejection.kind: 'aborted_before_execute'` 결과를 받는다. `toolcall.not_executed { reason: 'aborted' }`. A3가 없는 경우를 대비해 투영은 결과 없는 호출에 같은 문구의 결과를 넣는다(§3.5.5 단계 4) |

#### 3.4.8 연결점 4: `prepareRequest`

```text
prepareRequest({ context, model, thinkingLevel }, signal):
  h = runHandle
  if not journal.fenceOk(h): abort(h); return                       # 스트림이 aborted로 끝난다
  b = budget.preRequest(h, estimate)                                 # §3.11.3
  if b.hardExceeded: h.endAfterThisTurn('budget_exhausted'); abort(h); return
  resolved = h.currentModel()                                        # 대체로 바뀌었으면 그 모델
  px = projection.build(h, { model: resolved, cursor: store.cursor() })   # §3.5.5. 필요하면 주입·컴팩션을 커밋
  if px.failClosed: h.endAfterThisTurn('context_overflow'); abort(h); return
  tx: fence(h); trace model.requested { requestId: newId('mr'), projection: px.manifest, model: resolved.ref,
                                        thinking: resolved.thinking }; stage = 'inference'
  h.contextRefs.set(requestId, { projectionId: px.id, sourceCursor: px.cursor, policyVersion: px.policyVersion })
  return { context: { messages: px.messages /* 새 배열 */, tools: px.tools }, model: resolved.model,
           thinkingLevel: resolved.thinking }
```

- **요청마다 새 `messages` 배열**을 돌려준다. 루프는 그 배열에 응답과 결과를 push하지만 Helm은 다음 요청에서 다시 로그로 만들므로 영향이 없다(F-3).
- 루프가 `prepareRequest` 직전에 붙인 steering 메시지는 이미 기록되어 있으므로 투영에 들어 있다(§3.12).
- `px.tools`는 루프가 실행할 수 있는 도구 집합이고, `px.messages`의 시스템 메시지 재생 결과(`getCurrentTools`)와 같아야 한다 [원문 `pi-src/packages/ai/src/utils/transcript.ts:58`]. 다르면 투영 오류로 run을 실패시킨다(테스트로 막는다).
- `prepareRequest`는 큐를 폴링하지 않는다 [원문 `pi-src/packages/agent/src/types.ts` `prepareRequest` 주석].

#### 3.4.9 `finishTurn`과 run 종료

```text
finishTurn(turn, signal):
  h = runHandle
  if turn.message.stopReason in {error, aborted}: return          # 결정은 루프가 무시함. run 수준 처리는 agent_end 뒤
  tx: stage = 'settlement'
  # 1. 사람 대기
  for q in h.pendingGates:
     if kernelState.question(q).status in {answered, assumed}:    # 답이 먼저 와 있으면(first-emit-wins) 이어간다
        h.pendingGates.delete(q); inputs.injectAnswer(h, q)       # 다음 요청에 답을 주입
  if h.pendingGates 비어 있지 않음: h.endReason = 'awaiting_human'; return { action: 'end' }
  # 2. 취소·예산·요청 수
  if h.cancelRequested: return { action: 'end' }
  if budget.hard(h) or h.requestCount >= h.spec.budget.maxRequests: h.endReason = …; return { action: 'end' }
  # 3. 끝내기 전 검사 (도구 호출이 없어 루프가 멈추려는 경우에만 의미가 있다)
  if turn.toolResults 비어 있음 and not inputs.hasPending(h):
     s = kernel.checkSettle(kernelState, h.runId)                 # 10 §3.1.5
     if s.items 있음 and h.nudges[s.key] < 2:
        h.nudges[s.key]++; inputs.enqueueRuntimeNotice(h, renderSettleNotice(s))   # steering으로 다음 요청에 들어감
        return { action: 'continue' }
     if s.items 있음: trace settle.unresolved { items }            # 두 번 넘게 반복하지 않는다 (extracts-2 d-2)
  # 4. 출력 한도로 끊긴 텍스트 응답
  if turn.message.stopReason == 'length' and turn.toolResults 비어 있음 and h.lengthNudges < 1:
     h.lengthNudges++; inputs.enqueueRuntimeNotice(h, 'Your previous response hit the output limit. Continue from where it stopped.')
     return { action: 'continue' }
  return undefined
```

루프가 끝난 뒤(`runAgentLoop`가 돌아온 뒤):

```text
afterLoop(h, lastMessage):
  if lastMessage.stopReason == 'error':
     e = classify(lastMessage)
     if e.kind == 'context_overflow' and not h.overflowRetried: compaction.force(h); h.overflowRetried = true; continueRun(h)
     elif e.retryableAtRunLevel and h.runRetries < 2: sleep(backoff); h.runRetries++; continueRun(h)
     else end(h, 'failed', e)
  elif lastMessage.stopReason == 'aborted':
     end(h, h.endReason ?? 'cancelled')
  else:
     end(h, h.endReason ?? 'yielded')                              # awaiting_human이면 상태만 바꾸고 run.end는 handed_off 때
continueRun(h): runAgentLoopContinue(projectionFor(h), config, sink, signal, streamFn)   # 투영은 마지막이 user/toolResult
```

- `run.end` 제출에는 종료 사유, 요청 수, 도구 호출 수, 사용량 합계를 넣는다. WorkUnit 상태 전이는 커널이 이 제출과 14의 종료 조건으로 판정한다.
- 제공자 오류 메시지(`stopReason: error`)는 기록에 남지만 투영에서는 뺀다(pi-ai도 뺀다 [원문 pi-facts-1 §2.11-4]).

#### 3.4.10 실행 기록 타입

```ts
// @helm/domain/runtime-trace.ts [제안, 09가 테이블로 정한다]
export type TraceRecord =
  | { kind: 'message.committed'; messageId: MessageId; threadId: ThreadId; runId: RunId; requestId?: ModelRequestId;
      role: 'user' | 'assistant'; origin: 'human' | 'injection' | 'runtime_notice' | 'model' | 'summary';
      message: Message;                               // pi-ai Message 그대로 (이미지는 blob 참조로 치환)
      injection?: InjectionMeta }                     // §3.5.2
  | { kind: 'model.requested'; requestId: ModelRequestId; runId: RunId; projection: ProjectionManifest;
      model: ModelRef; thinking: ThinkingLevel }
  | { kind: 'model.attempted'; requestId: ModelRequestId; attempt: number; model: ModelRef; error?: AiError['kind'];
      delayMs?: number }
  | { kind: 'model.responded'; requestId: ModelRequestId; usage: UsageRecord; stopReason: StopReason;
      durationMs?: number; responseModel?: string }
  | { kind: 'model.request_abandoned'; requestId: ModelRequestId; cause: 'restart' | 'fenced'; estimatedInputTokens: number }
  | { kind: 'model.switched'; runId: RunId; from: ModelRef; to: ModelRef; reason: string }
  | { kind: 'toolcall.requested'; tcId: ToolCallId; providerCallId: string; runId: RunId; requestId: ModelRequestId;
      messageId: MessageId; index: number; toolName: string; modelArgs: unknown }
  | { kind: 'toolcall.state'; tcId: ToolCallId; state: ToolCallState; decisionRef?: SubmissionId; questionId?: QuestionId }
  | { kind: 'toolcall.denied_by_path_policy'; tcId: ToolCallId; denials: PathDenial[] }      // 13 §3.4
  | { kind: 'toolcall.not_executed'; tcId: ToolCallId; reason: 'unknown_tool' | 'invalid_args' | 'truncated_response' | 'aborted' }
  | { kind: 'toolcall.result'; tcId: ToolCallId; modelContent: (TextContent | ImageRef)[]; details?: unknown;
      structuredContent?: unknown; isError: boolean; truncated?: TruncationInfo }
  | { kind: 'context.injected'; injectionId: string; threadId: ThreadId; digest: string }   // 본문은 message.committed
  | { kind: 'context.compacted'; summaryId: SummaryId; threadId: ThreadId; range: [MessageId, MessageId];
      firstKeptMessageId: MessageId; tokensBefore: number; tokensAfterEstimate: number;
      requiredIds: string[]; missingAfterRetry: string[]; usage: UsageRecord }
  | { kind: 'run.stage'; runId: RunId; stage: Stage }
  | { kind: 'input.queued' | 'input.delivered' | 'input.dropped'; inputId: RunInputId; … }                  // §3.12
  | { kind: 'budget.charged'; account: BudgetAccount; delta: BudgetDelta; source: string }                  // §3.11
  | { kind: 'settle.unresolved'; runId: RunId; items: string[] }
  | { kind: 'recovery.decided'; runId: RunId; decision: RecoveryDecision };                                // §3.7

export type ToolCallState =
  | 'requested'      // 모델이 냄 (트랜잭션 A)
  | 'blocked'        // 커널 rejected / 경로 정책 / 펜싱
  | 'gated'          // needs_gate (질문 생김)
  | 'not_executed'   // 즉시 결과
  | 'intended'       // 의도 커밋됨 (실행 직전)
  | 'completed'      // 결과 커밋됨 (ok | error | uncertain)
  | 'interrupted'    // 재시작으로 결과 불명 (§3.7.4)
  | 'replayed'       // 저장된 인자로 재실행되어 completed로 이어짐
  | 'resolved';      // 사람 해소 (§3.7.4)
```

커널 쪽 도구 호출 이벤트(`toolcall.intended`, `toolcall.completed`, `toolcall.interrupted`, `toolcall.resolved`)의 이름과 payload는 09·10이 확정한다. 실행 기록의 `toolcall.state`는 같은 사실을 런타임 복구용으로 빠르게 찾기 위한 색인이며, 둘이 어긋나면 커널 이벤트가 우선한다.

### 3.5 모델 컨텍스트 투영 (A11)

#### 3.5.1 원칙

| 번호 | 원칙 | 근거 |
|---|---|---|
| PJ-1 | 모델이 받는 컨텍스트는 정본(이벤트 로그와 실행 기록)을 읽어 만든 투영이다. 투영은 정본을 쓰지 않는다. 다만 투영을 만드는 과정에서 "무엇을 주입했는가"(주입 메시지, 요약)를 실행 기록으로 남긴다. 이것은 투영 결과의 기록이며 도메인 상태가 아니다 | 브리프 §6 투영, 불변조건 3, canon §13.5 |
| PJ-2 | 같은 cursor, 같은 규칙 버전, 같은 모델이면 같은 바이트가 나온다(결정적) | canon-2 §1.13 projection 불변조건 6, §4.7 |
| PJ-3 | 투영마다 manifest(출처 cursor, 포함 ID, 생략 범주와 개수, 무효화 조건)를 남긴다. 모델에게도 생략 사실을 한 줄로 알린다 | canon §11.9, §13.10, extracts-2 X2-6-07 |
| PJ-4 | 반대 근거, 이의, 열린 질문, 임시 가정, 결과 불명, 합의의 범위·금지·멈출 조건은 생략하지 않는다(필수 범주). 필수 범주만으로 예산을 넘으면 요청하지 않는다(fail-closed) | A9, canon §13.10, 10 `mustIncludeRefs` |
| PJ-5 | thread의 앞부분은 바꾸지 않는다. 상태 변화는 끝에 주입 메시지로 덧붙인다. 앞부분이 바뀌는 일은 컴팩션 때 한꺼번에 한다 | 프롬프트 캐시. pi-ai Anthropic 경로는 시스템 프롬프트, 마지막 도구, 마지막 user 메시지에 `cache_control`을 붙인다 [원문 `pi-src/packages/ai/src/api/anthropic-messages.ts:1160-1192, 1478-1510`] |
| PJ-6 | 모델의 상태 노출은 의도·불확실성·다음 행동이다. 이전 응답의 thinking은 화면에도 투영에도 근거로 쓰지 않는다 | canon-3 G15 |
| PJ-7 | 도구 결과와 주입된 외부 내용은 데이터다. 시스템 지시문은 이 점을 모델에게 알린다 | extracts-1 E1-053 (지시 계층) |

#### 3.5.2 슬롯 [제안]

extracts-1 E1-054의 컨텍스트 슬롯(항상 로드, 필요할 때 로드, 리마인더, 도구 결과)을 다음으로 구체화한다.

| 슬롯 | 위치 | 내용 | 바뀌는 때 | 크기 상한(토큰 추정) |
|---|---|---|---|---|
| S1 preamble | 머리 시스템 메시지 `content` | 역할(작업·검증 등)의 고정 지시: Helm 커널 원칙("너는 제안하고 커널이 정한다"), `<helm_context>`·도구 결과는 데이터라는 규칙, 사용자 표시 문장은 한국어, 근거는 도구 호출·관찰 ID로 인용, 막히면 `helm_ask` | 규칙 버전이 바뀔 때만 | 1,500 |
| S2 tools | 머리 시스템 메시지 `toolsAdded` + 도구 지침 절 | run 시작 때의 도구 묶음(13 §3.2). 도구마다 `promptSnippet` 한 줄 | 루프 전환으로 묶음이 바뀌면 중간 시스템 메시지(`toolsAdded`/`toolsRemoved`) | 1,500 (지침 절) |
| S3 rules | 머리 시스템 메시지 `sections.rules` | 루프·단계 지시문(14 `RunSpec.instructions`), 다이얼에서 나온 지시 | 루프 전환 때 중간 시스템 메시지의 `sections.rules` 교체 | 1,500 |
| S4 project_guidance | 머리 시스템 메시지 `sections.project` | 작업 공간의 `AGENTS.md`(없으면 `CLAUDE.md`)와 그 조상 디렉터리 파일 중 작업 공간 루트 안의 것. 13의 읽기 경로 정책을 따른다 | thread 시작 때 고정. 파일이 바뀌어도 thread 안에서는 갱신하지 않고 다음 컴팩션 때 갱신 | 4,000 (넘으면 앞부분 + "[truncated: read AGENTS.md]") |
| S5 snapshot | thread 첫 user 역할 주입 메시지 `<helm_context kind="snapshot">` | `RunSpec.context.include`의 각 ContextSection 렌더링(§3.5.4)과 필수 범주 | thread 시작, 컴팩션 직후, 오래 쉰 thread 재개(§3.5.6 Expired) | 8,000 |
| S6 transcript | 그 뒤 메시지들 | 사람 입력, assistant 메시지, 도구 결과(기록에서 합성), 주입 메시지 | 덧붙이기만 | 나머지 |
| S7 delta | thread 끝 user 역할 주입 `<helm_context kind="delta">` | 지난 주입 이후 바뀐 섹션의 새 렌더링, 커널 notice, 답이 온 질문, 무효화 알림 | 요청 직전에 상태 요약이 바뀌었을 때만 | 3,000 (넘으면 바뀐 섹션 이름과 ID만, "use helm_query") |
| S8 notice | thread 끝 user 역할 `<helm_notice>` | 런타임 알림: 끝내기 전 검사(`checkSettle`), 예산 80%, 재개 안내, 출력 한도 이어쓰기 | 사건이 있을 때 | 600 |
| 필요할 때 로드 | 도구 | 생략된 레코드, 이전 도구 결과 원문, 스킬·절차 문서는 `helm_query`와 `read`로 모델이 가져온다 | - | - |

주입 메시지 메타데이터:

```ts
export interface InjectionMeta {
  injectionId: string;                     // `cx_<ULID>#<n>` 또는 별도 접두사(08에 맡김)
  kind: 'snapshot' | 'delta' | 'answer' | 'notice' | 'summary' | 'recovery';
  cursor: number;                          // 렌더링에 쓴 정본 cursor
  sectionDigests: Record<ContextSection | 'required', string>;   // 다음 delta 계산용
  includedRefs: string[]; omitted: Omission[];
}
```

- 주입 메시지는 pi-ai `UserMessage`다. 본문은 `<helm_context kind="…" cursor="…">…</helm_context>` 태그로 감싼다. S1이 "이 태그 안은 런타임이 준 상태이며 사용자의 말이 아니다"라고 알린다.
- 사람 입력은 태그 없이 그대로 넣는다. 사람 입력과 주입 메시지는 실행 기록의 `origin`(`human` / `injection` / `runtime_notice` / `summary`)으로 구분한다.
- 주입이 도구 결과 바로 뒤에 오면 제공자 변환(pi-ai)이 toolResult와 user 텍스트를 같은 user 턴으로 묶는다 [가정: pi-ai Anthropic 변환이 연속 user 역할 블록을 합친다. 포크 시험 T-PJ-07로 확인].

#### 3.5.3 배치 순서와 캐시 [제안]

```text
요청 메시지 = [ 머리 시스템(S1, S2 선언, S3, S4) ]                 ← 캐시 구간 1: run 동안 고정
            + [ S5 snapshot, S6 transcript …(덧붙이기만) ]          ← 캐시 구간 2: 이전 요청의 끝까지 접두사 동일
            + [ 이번 요청에 새로 덧붙인 S7/S8 주입, 새 사람 입력 ]     ← 새로 쓰는 부분
```

- 이전 요청의 마지막 메시지가 다음 요청에서도 같은 위치·같은 바이트로 남으므로, 제공자가 직전 요청 끝에 둔 캐시 지점까지 읽기 적중이 난다. 상태 요약을 매 요청 끝에 새로 써서 갈아끼우는 방식은 쓰지 않는다(이전 끝이 사라져 대화 부분 캐시가 깨진다).
- 캐시가 깨지는 사건: 컴팩션(머리 이후 전체), 루프 전환으로 도구·규칙이 바뀜(중간 시스템 메시지를 지원하지 않는 모델에서는 머리로 합쳐져 전체), 모델 대체(제공자 캐시가 다름). 이 사건마다 `model.requested` manifest에 `cacheBreak: '<reason>'`을 남긴다(16이 캐시 효율을 잰다).
- `sessionId`는 `threadId`로 고정한다(pi-ai가 제공자별 캐시 키로 쓴다 [원문 pi-facts-1 §2.5 `StreamOptions.sessionId`]).
- 도구 선언은 13 레지스트리의 정렬 순서(이름순)로 낸다. 같은 묶음이면 같은 바이트다.

#### 3.5.4 섹션 렌더러 [제안]

ContextSection 이름과 각 루프가 포함할 섹션은 14 §3(`LoopContract.context`)이 소유한다. 이 문서는 렌더링 규칙과 크기, 우선순위를 정한다. 렌더러는 순수 함수다: `render(section, kernelView, runSpec, budget) → { text, includedRefs, omitted }`.

| 등급 | 섹션 | 내용(레코드 ID와 한 줄 요약) | 기본 상한 |
|---|---|---|---|
| 필수 | `agreement`, `criteria` | 활성 합의: 목적, 완료 기준(ID별), 범위(13 자원 패턴), 금지 행동, 제출할 근거, 멈출 조건, 만료 | 1,500 |
| 필수 | `counter_evidence` | 미해결 반대 근거(관찰 ID, 대상 레코드, 한 줄) | 800 |
| 필수 | `contests` | 열린 이의 | 500 |
| 필수 | `open_questions` | 열린 질문(게이트, 임시 가정, 만료점). 권리 게이트를 먼저 | 800 |
| 필수 | `assumptions` | 사용 중인 임시 가정과 만료점 | 500 |
| 필수 | (자동) `recovery` | 결과 불명 도구 호출, 재개 안내 (§3.7.4) | 600 |
| 필수 | (자동) `must_include` | 10 `mustIncludeRefs(state, concernId)` 중 위 섹션에 없는 것 | 600 |
| 높음 | `goal`, `concern`, `situation`, `loop_plan` | Goal 버전과 문장, Concern 서술, 상황 유형, 루프 계획 | 1,000 |
| 높음 | `submission`, `evidence` | 결과 제출과 기준별 근거(검증 run) | 1,500 |
| 높음 | `findings`, `recent_observations` | 판단(ID, 문장, 근거 수), 최근 관찰 12개(역순) | 1,500 |
| 보통 | `possibilities`, `predictions`, `probes`, `watch_spec`, `procedure`, `boundary_items`, `parent_chain`, `children`, `obligations` | 레코드별 한 줄 | 각 800 |
| 보통 | `preference_model`, `recent_reactions`, `stimuli` | 원함 탐구(15). 자극 이미지는 blob을 이미지 블록으로(§3.3.8), 상한 4장 | 각 1,000 |
| 낮음 | `transitions`, `rejections`, `autonomous_decisions`, `human_ops` | 이력 | 각 500 |

채우는 순서와 생략:

```text
renderSnapshot(include, view, budget=8000):
  required = 필수 섹션 ∪ (include에 없어도 비어 있지 않은 필수 섹션)   # 필수는 include와 무관하게 넣는다
  out = []; used = 0
  for s in required: r = render(s, compact=false); out += r; used += r.tokens
  if used > budget:
     for s in required: r = render(s, compact=true)             # ID + 8단어 요약
     if 여전히 > budget: return FAIL_CLOSED(required ids)        # §3.5.5
  for tier in [높음, 보통, 낮음]:
     for s in include ∩ tier (14가 준 순서):
        r = render(s, remaining=budget-used)                     # 레코드를 최신순으로 넣다가 상한에서 멈춤
        out += r; used += r.tokens
        if r.omitted: omissions += { category: s, count, reason: 'context-budget' }
  out += "omitted: " + omissions 요약 + " — use helm_query to load"   # 생략 사실을 모델에게 알린다
```

- 각 레코드 줄은 `[<id>] <종류> <품질 상태> — <한 줄>` 형식이다. 품질 상태(`contested`, `stale` 등)를 숨기지 않는다(원전 불변 6 "모르는 것, 이견, 낡은 상태는 숨기지 않는다").
- 수치(빈도, 개수)는 코드가 계산한 값만 넣는다.
- 비밀 패턴 마스킹(18의 규칙)을 렌더링 결과에 적용한다.

#### 3.5.5 생성 알고리즘

```text
projection.build(h, { model, cursor }):
  view  = kernel.viewAt(cursor, h.spec.concernId)            # 순수 조회. 10 §3.1.5
  thr   = journal.thread(h.spec.threadId)                    # 메시지, 주입, 요약, 도구 결과 기록
  # 1. 머리 시스템 메시지
  head  = thr.headSystem ?? renderHead(h.spec, rulesVersion)  # thread 시작 때 한 번 만들어 기록(message.committed origin=injection)
  # 2. thread 시작(첫 요청)이면 snapshot 주입을 커밋
  if thr.messages 비어 있음 or thr.needsSnapshot:
       snap = renderSnapshot(h.spec.context.include, view)
       if snap == FAIL_CLOSED: return failClosed(snap.requiredIds)
       commitInjection(h, 'snapshot', snap, cursor)
  # 3. 상태 변화가 있으면 delta 주입을 커밋
  digests = sectionDigests(view, h.spec.context.include ∪ 필수)
  changed = digests ≠ thr.lastInjectedDigests 인 섹션
  notices = h.pendingNotices ∪ kernel notices ∪ 답이 온 질문 ∪ 무효화
  if changed 또는 notices:
       commitInjection(h, 'delta', renderDelta(changed, notices, view), cursor)
  if 루프 전환으로 도구·규칙이 바뀜: commitSystemChange(h, toolsAdded, toolsRemoved, sections.rules)
  # 4. 메시지 열 만들기 (덧붙이기만)
  msgs = [head] + thr.messagesSince(thr.lastSummary)          # 요약이 있으면 [요약 주입, 요약 직후 snapshot, 남긴 메시지…]
  msgs = msgs.map(m => m.role=='toolResult' ? synthesizeFromRecord(m) : m)   # 도구 결과는 toolcall.result 기록에서
  for 결과 기록이 없는 도구 호출(abort로 결과 없음):
       msgs에 그 호출 바로 뒤로 isError 결과 "No result provided (not executed)." 삽입      # pi-ai 채움과 같은 문구
  msgs = msgs.filter(m => not (m.role=='assistant' and m.stopReason in {error, aborted}))  # pi-ai와 같은 규칙
  msgs = resolveBlobs(msgs, model)                            # 이미지 blob → ImageContent, 모델 한도 적용
  # 5. 크기
  est = estimateTokens(thr, msgs)                             # 아래 추정식
  if est > softLimit(model) and not h.compactedThisRequest: compaction.run(h, 'soft'); return build(h, …)   # §3.6
  if est > hardLimit(model): compaction.run(h, 'full'); return build(h, …)
  if est > hardLimit(model) after full: return failClosed('window')
  # 6. 필수 확인
  missing = mustIncludeRefs(view) − (thr의 snapshot·delta·요약에 들어간 ID 합집합)
  if missing: commitInjection(h, 'delta', renderRequired(missing)); 다시 4~5
  tools = toolsFor(h, view)                                   # 13 §3.2: 14 proposalKinds ∩ 10 allowedCommands, primitives
  return { id: newId('cx'), messages: msgs (새 배열), tools, cursor, manifest, policyVersion }
```

토큰 추정(pi coding-agent 컴팩션 방식을 따름 [원문 pi-facts-1 §4.8]):

```text
estimateTokens(thr, msgs):
  base = 직전 응답의 usage.input + usage.cacheRead + usage.cacheWrite (같은 모델일 때)
  new  = 직전 요청 이후 덧붙인 메시지의 글자 수 / 4 + 이미지 수 × 1,200
  if 직전 응답이 없거나 모델이 바뀜: return 전체 글자 수 / 4 + 이미지 × 1,200
  return base + new
softLimit = 0.75 × contextWindow
hardLimit = contextWindow − (maxOutputTokens + 8,192)
```

fail-closed: 필수 범주만으로 상한을 넘으면 요청을 보내지 않는다. run은 `ended(context_overflow)`로 끝나고 커널에 `run.end`로 알린다. 14·11이 더 큰 컨텍스트 모델로 다시 시도할지 사람에게 물을지 정한다. 런타임은 조용히 필수 항목을 버리지 않는다(canon-2 §4.7 fail-closed).

#### 3.5.6 manifest와 상태 [제안]

```ts
export interface ProjectionManifest {
  projectionId: string;                    // cx_<ULID>. 10 ContextRef.projectionId
  threadId: ThreadId; runId: RunId; requestId: ModelRequestId;
  purpose: 'execution' | 'deliberation' | 'review' | 'mediation' | 'handoff';   // canon §11.9
  sourceCursor: number;                    // 10 ContextRef.sourceCursor
  policyVersion: string;                   // 투영 규칙 버전 + 루프 계약 버전 + 도구 레지스트리 버전의 해시
  model: ModelRef;
  head: { hash: string; sections: { name: string; hash: string; tokens: number }[] };
  tools: { names: string[]; hash: string };
  transcript: { firstMessageId?: MessageId; lastMessageId?: MessageId; count: number;
                summaryId?: SummaryId; elided: { tcId: ToolCallId; originalTokens: number }[] };
  injectionsThisRequest: string[];
  includedRefs: string[];                  // snapshot·delta·요약에 들어간 레코드 ID 전체(정렬)
  omitted: { category: string; count: number; reason: 'context-budget' | 'excluded-by-contract' | 'sibling-branch' }[];
  requiredRefs: string[];                  // mustIncludeRefs 결과. 모두 includedRefs에 있어야 함
  tokenEstimate: number; images: number;
  invalidationTriggers: string[];          // 예 'agreement:ag_…@r3', 'goal:gl_…@v2', 'question:qs_…'
  cacheBreak?: 'compaction' | 'loadout' | 'model_switch' | 'snapshot_refresh';
  bytesHash: string;                       // 직렬화한 messages+tools의 sha256. 결정성 시험
}
```

ContextProjection 상태(canon §11.9)와의 대응:

| 원전 상태 | Helm에서 | 사건 |
|---|---|---|
| Requested | `prepareRequest` 진입 | |
| Materialized | `build` 완료, manifest 생성 | |
| Delivered | `model.requested` 커밋 뒤 제공자 요청 | |
| Refreshed | 다음 요청의 새 `cx_` | 상태 변화는 delta 주입으로 |
| Invalidated | 응답을 기다리는 동안 `invalidationTriggers`에 걸린 이벤트가 커밋됨 | 응답의 도구 호출은 그대로 `beforeToolCall`에서 **현재 상태**로 검사한다(낡은 투영으로 범위를 우회할 수 없다). 다음 요청에 delta가 들어간다 |
| Expired | thread가 6시간 넘게 쉬었다가 재개 [제안] | delta 대신 새 snapshot 주입(`cacheBreak: snapshot_refresh`) |

#### 3.5.7 잘라내기와 생략 규칙 [제안]

- 도구 결과의 1차 잘림은 13(도구별, 기본 2,000줄/50KB)이 한다. 런타임은 그 결과를 그대로 넣는다.
- 오래된 큰 도구 결과의 생략(elision)은 컴팩션 1단계에서만 한다(§3.6). 덧붙이기만 하는 원칙(PJ-5)을 지키기 위해서다. 생략된 결과는 `[elided tool result tc_… (≈N tokens). Reload with helm_query {"toolResult":"tc_…"} or re-run a read.]`로 바뀐다. 원문은 기록에 남는다.
- 이미지가 모델 한도를 넘으면 오래된 주입 이미지부터 `[image elided: sha256:…]`로 바꾼다. 이것도 컴팩션 시점에 한다. 한도를 넘는 새 이미지 주입은 렌더러가 미리 줄인다.
- 형제 발산 가지의 기록은 `excludeThreads`로 뺀다(`omitted.reason: 'sibling-branch'`, §3.14.4).

#### 3.5.8 화면 투영 공통 규약과 복귀 요약 [제안]

화면별 표시 데이터의 내용은 03·04가, 구독·패치 전송은 19가 소유한다. 이 문서는 모든 화면 투영이 지킬 공통 규약과 복귀 요약 생성 절차를 정한다(03 §691, 16 "복귀 요약 12 소유"의 요구).

```ts
export interface ViewEnvelope<T> {
  viewId: string;                 // 예 'concern:cn_…:detail'
  kind: string;                   // 03 화면 ID와 대응
  sourceSeq: number;              // 이 뷰를 만든 이벤트 로그 seq. 19 asOfSeq
  generatedAt: EpochMs;
  freshness: 'current' | 'stale' | 'degraded';   // degraded: 투영 갱신 실패(10 상자 10)
  omitted: { category: string; count: number; reason: string }[];
  drillDown: Record<string, string>;              // 표시 항목 → 원본 레코드 ID
  data: T;
}
```

규칙:

1. 화면 투영은 순수 함수로 계산한다(`view(kind, state, params) → ViewEnvelope`). 쓰기 API를 import하지 않는다(06 P5).
2. 같은 로그로 두 번 만들면 같은 결과가 나온다. 표시 번호(03 IA-07)는 Concern 안에서 레코드 종류별 생성 순서로 매기고, 로그에서 다시 계산한다. 화면이 번호를 계산하지 않는다.
3. 숫자(개수, 비율, 시간)는 코드가 계산한다. 모델이 쓴 문장 안의 숫자를 화면 수치로 쓰지 않는다.
4. 모든 항목은 원본 레코드로 내려갈 수 있다(`drillDown`).
5. 투영 갱신이 실패해도 커밋을 되돌리지 않는다. 해당 뷰를 `degraded`로 표시하고 다시 만든다(10 상자 10).

복귀 요약(UC-06) 생성:

```text
returnBrief(since = 사람이 마지막으로 확인한 cursor(brief.acknowledged, 03), now):
  changes = 이벤트 로그 (since, now] 를 Concern·WorkUnit별로 묶음 (경로별 나열 금지, 그룹 최대 5개 + 나머지 접힘: canon-2 L5)
  sections (순서와 이름은 04가 확정. 기본안은 canon-3 §7.3 I4. 질문 관련 절의 순서는 11 §3.8.2: 선택 필요(권리·막는 질문) → 미룬 반영 항목 → 확인하면 좋은 것 → 에이전트가 정한 것):
    1 Goal과 바뀐 기준   2 바뀐 것(N/E/M)   3 평가(깨진 가정, 약한 신호, 이의)   4 선택 필요(권리 게이트 우선)
    5 확인하면 좋은 것(임시 가정으로 진행 중)   6 진행 중 작업(다음 예정, 멈출 조건)
    7 예측(개입하지 않으면, 가정 만료점)   8 에이전트가 정한 것(접힘)   9 지금 읽지 않아도 되는 것(접힘)
    + 복구 항목(G11): interrupted run, 결과 불명 도구 호출, 재개 예산 상태 (§3.7)
    + 관찰 에이전트 절(16 요구, 접힘)
  각 항목: 원본 ID, 출처 seq. 수치는 코드 계산
  그룹마다 한 줄 서술이 필요하면 summarizer 역할 호출(§3.15)로 쓴다. 입력은 그 그룹의 레코드 요약뿐이고,
  출력은 레코드 ID를 인용해야 하며(없으면 서술 없이 목록만), 결과는 (since, now, 그룹 해시)로 캐시한다
```

복귀 요약은 화면 투영이다. 정본이 아니며, 모델 서술은 근거로 인용되지 않는다(RLM 적용 지점 1, extracts-3 X3-3-11: 루트는 투영된 요약만 보고 필요하면 조회로 내려간다).

### 3.6 컴팩션

#### 3.6.1 위치와 원칙 [제안]

- Helm의 정본 상태(Goal, 합의, 판단, 질문 등)는 thread 대화 기록 밖, 커널 상태에 있다. 그래서 컴팩션은 대화 서술만 줄이고, 상태는 컴팩션 직후 새 snapshot 주입으로 다시 넣는다. pi coding-agent처럼 요약 하나에 상태를 모두 담지 않는다.
- 요약은 투영 산출물이다. 실행 기록(`context.compacted`)으로 남지만 도메인 레코드가 아니며 근거로 인용할 수 없다.
- 요약이 반대 근거, 이의, 열린 질문, 미충족 기준을 지우지 않는다는 것을 코드로 검사한다(A9, canon §13.10).
- 덧붙이기 원칙(PJ-5) 때문에 앞부분을 바꾸는 일(오래된 큰 도구 결과 생략, 이미지 생략, 요약)은 모두 컴팩션 때 한꺼번에 한다.

#### 3.6.2 발동 조건

| 조건 | 단계 |
|---|---|
| 추정 토큰 > `softLimit`(창의 75%) | 1단계(생략)만 |
| 1단계 뒤에도 > `hardLimit`(창 − 출력 상한 − 8,192) | 2단계(요약) |
| 제공자가 컨텍스트 초과 오류(`isContextOverflow`)를 냄 | 2단계 후 한 번만 다시 요청 (§3.4.9) |
| 모델 대체로 창이 작아짐 | 새 모델 기준으로 위 판정 |
| 사람이 요청(19 메서드, 이름은 19) | 2단계 |

컴팩션은 `prepareRequest` 안에서 요청 전에 실행한다(pi는 턴 사이와 프롬프트 전에 한다 [원문 pi-facts-1 §4.8]). 시작할 때 stage를 `compaction`으로 커밋한다.

#### 3.6.3 1단계: 생략

```text
elide(thread):
  recent = 마지막 3개 turn
  for 도구 결과 m in thread (recent 밖):
     if tokens(m) > 1,500: m을 생략 표시로 바꿈 (§3.5.7 문구), elided += (tcId, tokens)
  for 이미지 in 주입 메시지 (recent 밖, 모델 이미지 한도 초과분): 자리표시로
  tx: trace context.compacted { kind: 'elide', elided, tokensBefore, tokensAfterEstimate }
```

생략 결정은 이 기록으로 고정된다. 다음 투영은 같은 생략을 다시 적용한다(결정적).

#### 3.6.4 2단계: 요약

```text
summarize(thread, model):
  keep = min(20,000, 0.25 × contextWindow) 토큰
  cut  = 뒤에서부터 keep에 이를 때까지 거슬러 간 지점에서 가장 가까운 메시지 경계
         - 도구 호출과 그 결과 사이를 자르지 않는다 (배치의 결과를 모두 같은 쪽에 둔다)
         - 한 turn이 keep보다 크면 그 turn 안 assistant 메시지 앞에서 자른다 (pi split turn)
  range = (직전 요약의 firstKept, cut)   # 직전 요약이 있으면 갱신 요약 (pi와 같음)
  required = mustIncludeRefs(view) ∪ range 안에서 언급된 ID 중 { 반대 근거, 이의, 열린 질문, 미충족·확인 못함 기준, 결과 불명 호출 }
  input = serialize(range)   # [User]/[Assistant]/[Assistant tool calls]/[Tool result] 텍스트, 도구 결과는 2,000자 (pi compaction/utils.ts:114 방식)
  r = gateway.complete({ role: 'summarizer', system: SUMMARY_PROMPT, messages: [prev summary?, input, required 목록],
                         outputSchema: SummarySchema, maxOutputTokens: 4,000, budget: run 계정 })
  missing = required − ids(r.value)
  if missing: r = 다시 한 번(누락 목록을 명시해)
  missing = required − ids(r.value)
  if missing: r.value.appendix = renderRequired(missing)   # 커널 상태에서 결정적으로 만든 목록을 덧붙임
  tx:
    trace message.committed { origin: 'summary', role: 'user', <helm_context kind="summary">…</helm_context> }
    trace context.compacted { kind: 'summarize', summaryId, range, firstKeptMessageId: cut 뒤 첫 메시지,
                              tokensBefore, tokensAfterEstimate, requiredIds: required, missingAfterRetry: missing, usage }
    thread.needsSnapshot = true                                # 다음 build가 새 snapshot을 주입 (S4도 다시 읽음)
```

```ts
// 요약 출력 스키마 (TypeBox로 정의)
interface Summary {
  objective: string;                 // 이 thread가 하던 일
  progress: string[];                // 끝낸 것
  decisions: { text: string; refs: string[] }[];   // 정한 것 (레코드 ID 인용)
  openItems: { refs: string[]; text: string }[];   // 열린 것: 반대 근거, 이의, 질문, 미충족 기준
  nextSteps: string[];
  criticalContext: string[];         // 놓치면 안 되는 사실 (인용 ID 포함)
  filesRead: string[]; filesModified: string[];     // 실행 기록에서 코드가 채운다(모델 출력 무시)
}
```

- 요약 프롬프트는 pi coding-agent의 형식(Goal, Constraints & Preferences, Progress, Key Decisions, Next Steps, Critical Context)을 출발점으로 쓴다 [원문 pi-facts-1 §4.8]. 07이 해당 파일을 포크할지 참고만 할지 정한다.
- `filesRead`, `filesModified`는 모델 출력이 아니라 실행 기록(도구 호출의 대상)에서 코드가 채운다.
- 요약 호출은 `cacheRetention: 'none'`, 별도 캐시 키를 쓴다(pi와 같음).
- 컴팩션 중 크래시: 요약이 커밋되지 않았으면 버리고 다음 요청 때 다시 판정한다.

### 3.7 크래시 복구

#### 3.7.1 기록 순서와 불변식 [결정 30 / 제안: 세부]

| ID | 불변식 | 집행 |
|---|---|---|
| CR-1 | 루프가 보는 사람·주입 메시지는 루프에 넘기기 전에 커밋되어 있다 | §3.12, 싱크의 확인 |
| CR-2 | assistant 메시지와 그 도구 호출 배치는 도구 준비 전에 커밋되어 있다 | 트랜잭션 A, 싱크 `await` |
| CR-3 | 도구는 커밋된 `toolcall.intend`(accepted) 없이 실행되지 않는다. Helm 제안 도구는 제출과 결과가 한 트랜잭션이다 | §3.4.5 |
| CR-4 | 의도마다 종결 기록은 정확히 하나다: `completed`(ok/error/uncertain) 또는 `interrupted`(not_executed/unknown). 먼저 쓴 것이 이긴다 | `toolCallId` 유일 제약(09), first-writer-wins |
| CR-5 | run의 상태, attempt, ownerEpoch, stage, 재개 횟수는 커밋되어 있다. 재시작 처리는 이 기록만 보고 정한다. 종료 훅은 보조다("recovery is a property of the database, never of a shutdown hook", OpenCode v2, backend-oss-research §1.2) | §3.7.3 |
| CR-6 | 효과(effect)는 커밋된 이벤트에서 다시 계산할 수 있다 | 10 §3.1.4 |
| CR-7 | 스트리밍 조각과 진행 중 응답은 저장하지 않는다. 크래시 때 그 응답은 버리고 같은 run에서 다시 요청한다 | cases §12.1-2 (happy-agent `block_reset`), §12.1-6 |

#### 3.7.2 replay 정책

도구는 pi-agent-core의 `replay?: 'never' | 'safe'`를 선언한다(기본 `never`) [원문 `pi-src/packages/agent/src/types.ts:489-490`]. Helm은 여기에 `replayGuard`를 더한다(13 §3.1). 도구별 값은 13 §3.3 표가 소유하며 요약은 다음과 같다.

| 도구 | replay | guard | 재시작 뒤 처리 |
|---|---|---|---|
| `read`, `grep`, `find`, `ls`, `helm_query` | `safe` | 없음 | 재개할 때 저장된 실행 인자로 다시 실행 |
| `write`, `edit` | `safe` | `file_hash` (의도 시점 파일 해시 `before`, 적용 뒤 예상 해시 `after`) | 현재 해시 = `after` → "재시작 전 적용됨"으로 결과 합성. = `before` → 다시 실행. 그 밖 → 결과 불명 |
| `bash` | `never` | 없음 | 결과 불명. 변경 감지 결과를 안내에 붙인다 |
| Helm 제안 도구 | 해당 없음 | - | 원자적이라 의도만 남은 상태가 없다 |
| `helm_subcall` | `safe` | 없음 | 다시 호출(외부 효과 없음, 비용만 다시 듦) |
| MCP 도구 | 설정값, 기본 `never` | 설정 | 기본은 결과 불명 |
| `helm_code`(REPL) | `never` | 없음 | 결과 불명. 스크립트 안 개별 도구 호출은 각자의 기록으로 판정 |

판정:

```text
replayDecision(tc):
  cur = registry.get(tc.tool)
  if tc.replayAtIntent != 'safe' or cur?.replay != 'safe':        return CLOSE_UNKNOWN   # 의도 시점과 현재 모두 safe여야 함
  if majorVersion(tc.toolVersion) != majorVersion(cur.version):     return CLOSE_UNKNOWN   # 인자 스키마가 바뀜
  g = tc.replayGuard
  if g?.kind == 'file_hash':
     h = hashFile(g.path)                                             # 없으면 'absent'
     if h == g.after:  return SYNTHESIZE_APPLIED
     if h == g.before: return REPLAY
     return CLOSE_UNKNOWN
  return REPLAY
```

- "의도 시점 선언 AND 현재 선언"은 pi-durable과 pi-fabric의 규칙이다. 나중에 safe로 바꾼 선언으로 과거 호출의 재실행을 허가할 수 없다 [원문 cases §12.1-1, pi-fabric `tests/durable-agent.test.ts:60-77`].
- REPLAY는 저장된 실행 인자로 하되 `beforeToolCall`을 다시 거친다(새 `toolcall.intend`, 멱등 키 `intend:<tc>:replay:<attempt>`). 그 사이 합의가 철회됐을 수 있기 때문이다. pi-durable은 재실행 때 `beforeTool`을 건너뛰지만 Helm은 커널 검사를 다시 한다. 재검사에서 거부되면: guard가 `before`를 증명한 쓰기는 `not_executed`로, 그 밖은 결과 불명으로 닫는다.
- REPLAY는 run을 재개할 때만 한다. run을 재개하지 않으면(§3.7.5) 결과 불명 또는 실행 안 함으로 닫는다.

#### 3.7.3 부팅 복구 알고리즘

```text
boot():
  0. 17: 단일 인스턴스 락 획득, DB 열기, 09 무결성 검사. 실패면 읽기 전용 복구 모드(09·17)
  1. epoch = newULID()
     tx: trace daemon.booted { epoch, pid, procStartTime, version, prevEpoch, prevClean: 이전 daemon.stopped{clean} 유무 }
  2. safeMode = crashLoopCheck()                                   # §3.7.6
  3. 커널 상태 재구성 (09 checkpoint + 이후 이벤트, 10 evolve)
  4. for run in runs where status ∈ {queued, running, stopping} and ownerEpoch != epoch:
        reconcileRun(run, epoch)                                    # 실행 중이던 run 정리 (OpenClaw의 시작 시점 고아 표시와 같은 역할)
     for run in runs where status ∈ {awaiting_human, awaiting_recovery}: 그대로 둔다 (§3.7.7)
  5. 효과 outbox: 미처리 효과를 다시 계산해 전달 (10 effectsFor)
  6. scheduler.rebuild(boot=true)                                   # §3.10.4 catch-up 상한
  7. if not safeMode: recovery.scheduleResumptions()               # §3.7.5. 5초 뒤부터 하나씩
  8. 리스너 시작(17). 클라이언트는 복구 중에도 붙을 수 있고 run은 interrupted·resuming으로 보인다

reconcileRun(run, epoch):
  tx:
    for tc in run의 도구 호출:
      case tc.state
        'requested' (의도 없음):  trace toolcall.not_executed { reason: 'restart' }; 결과 본문 = NOT_EXECUTED 문구
        'gated' | 'blocked' | 'not_executed' | 'completed' | 'resolved': 그대로
        'intended':
          d = replayDecision(tc)
          if d == SYNTHESIZE_APPLIED: submit toolcall.complete { outcome: 'ok', recovered: 'hash_verified' }; 결과 = RECOVERED 문구
          elif d == REPLAY: trace recovery.decided { tc, plan: 'replay' }                 # 재개 때 실행
          else: ch = tools.changeDetector.diffSince(tc.sandboxSnapshotRef)              # 13 §3.5.4. 없으면 'not_measurable'
                submit toolcall.outcome_unknown { reason: run.prevClean ? 'shutdown' : 'crash',          # 10 §3.11.7
                                            detectedChanges: ch, externalEffect: tc.primitive == 'send' or spec.externalEffect }
                trace toolcall.result { 결과 본문 = UNKNOWN 문구(ch) }
    if 열린 model.requested(응답 없음): trace model.request_abandoned { cause: 'restart', estimatedInputTokens }
    if stage == 'compaction': 요약 미커밋분 버림
    submit run.end { runId, outcome: 'interrupted', reason: cause }   # 10 RunEndPayload. run 행 status → interrupted(비종결)
    if 결과 불명으로 닫은 호출 중 externalEffect가 있음:
       submit 사람 해소 질문 요청 (11 §3.14·질문 종류 tool_outcome_unknown) → status awaiting_recovery
```

#### 3.7.4 "결과 불명" 표식과 모델 안내 문구 [제안]

도구 결과 본문(모델이 보는 문장)은 영어로 둔다(도구 설명과 같은 언어. §7 O-12-06). 화면 표기는 한국어다.

| 경우 | 모델용 결과 본문 | 화면 표기 | `isError` |
|---|---|---|---|
| UNKNOWN | `[helm:interrupted] The Helm daemon restarted while this tool call was running (tc_…, started <ISO>). Its outcome is unknown: it may not have run, may have run partially, or may have completed. Do not assume success or failure. Inspect the current state (read the affected files or run a read-only status command) before repeating it. <changes>` | 결과 불명 | true |
| `<changes>` | `Changes detected under the writable paths since the call started: <path (modified/created/deleted)>, … (N more).` / `No changes were detected under the writable paths.` / `Changes could not be measured for this call.` | 변경 감지 결과 | - |
| `<last output>` | 09 `volatile_scratch`에 남은 마지막 출력 조각(최대 8 KiB)이 있으면 `Last output before the restart:` 뒤에 붙인다 | 마지막 출력 | - |
| NOT_EXECUTED | `[helm:not_executed] This tool call did not run: the Helm daemon restarted before execution. Re-issue it if it is still needed.` | 실행 안 됨 | true |
| RECOVERED | `[helm:recovered] This change was applied before the restart (the file hash matches the expected result).` | 재시작 전 적용 확인 | false |
| REPLAYED | 정상 결과 앞에 `[helm:replayed after restart] ` | 재시작 뒤 다시 실행 | 결과대로 |
| 외부 행동 해소 대기 | `[helm:awaiting_confirmation] This external action may or may not have taken effect. A human has been asked to confirm (qs_…). Do not repeat it.` | 사람 확인 대기 | true |

사람 해소(외부 효과가 있는 호출): 질문 선택지는 "적용됨", "적용 안 됨", "직접 확인 작업 만들기"다(v0.2 실행 후보의 `confirmed_applied`, `confirmed_not_applied`, `manual_review`, canon-2 §9.11). 답은 `toolcall.recover`(사람 채널, 10 §3.11.7)로 들어오고 커널이 `toolcall.recovered`를 남긴다. 10은 `toolcall.outcome_unknown`마다 막는 질문(종류 `recovery`)을 만든다. 이 문서는 외부 효과가 없는 로컬 쓰기의 결과 불명은 모델이 확인하게 하고 사람 질문을 만들지 않기를 제안한다(`requiresHuman: externalEffect`, 10에 요구). 런타임은 해소 결과를 주입 메시지로 넣고 같은 thread에서 이어간다. 맹목적 재실행으로 중복 외부 효과가 생기는 것을 막는다(canon-2 §4.7, L12).

#### 3.7.5 재개 정책, 예산, 포기

```text
decideResume(run):
  if safeMode:                                   return STAY      # 사람이 재개 명령을 내릴 때까지
  if run.kind ∈ {mediator}:                      end(run, 'superseded'); return   # 다음 주기에 다시 뜸
  if run.kind ∈ {subrun, branch, verifier}:      end(run, 'failed', cause='interrupted'); 부모(14·15)에 알림; return
                                                 # 하위 실행은 자동 재실행하지 않고 부모가 정한다 (S4/openclaw-runtime §2.3)
  if Concern 닫힘 or WorkUnit 종결:               end(run, 'superseded'); return
  if run.status == awaiting_recovery:            return STAY
  if run.recoveryAttempts >= 3:                  end(run, 'recovery_exhausted'); 복귀 요약 복구 항목; return
  tx: run.recoveryAttempts += 1; trace recovery.decided { plan: 'resume', dispatchId: `recover:${run.id}:${run.interruptionCycle}` }
                                                 # 차감을 디스패치 전에 커밋 (OpenClaw: 디스패치 전 차감)
  queue(resumeRun(run), delay = 5s × 순번)        # 한 번에 하나씩

resumeRun(run):
  h = handle(run.id, attempt = run.attempt + 1, epoch)
  tx: submit run.start { runId, attempt, … }      # 같은 runId 재시작(10에 요구). status → running, ownerEpoch = epoch
  for tc in REPLAY 계획: beforeToolCall 경로로 intend → 실행 → complete  (실패하면 §3.7.2 규칙으로 닫음)
  inject(h, kind='recovery', renderRecovery(interrupted calls, outcomes, changes))
  h.restrictToSafe = 결과 불명으로 닫은 호출 중 primitive ∈ {write, execute, send}가 있음      # 재개 첫 turn의 도구 제한
  runAgentLoopContinue(projection(h), …)          # 투영의 마지막은 도구 결과나 주입 메시지이므로 continue 가능
  첫 turn이 끝나면 h.restrictToSafe = false
  재개 run이 turn 하나를 정상으로 끝내면 run.interruptionCycle을 닫고 recoveryAttempts = 0
```

- 재개 첫 turn에서 쓸 수 있는 도구는 `replay: 'safe'` 도구와 Helm 제안 도구뿐이다(13 `safeForRecoveryTurn`). 모델이 상태를 확인한 뒤 다음 turn에서 다시 실행하게 한다(cases §12.1-2, openclaw `resume-policy.ts:129-160`).
- 재개 디스패치가 모델 요청 전에 거부되면(저장 오류 등) 차감을 되돌린다. 요청이 나간 뒤 실패하면 차감을 유지한다(OpenClaw 규칙: 수락 전 거부는 환불, 불확실하면 유지).
- 같은 dispatchId로 두 번 재개하지 않는다(재개 디스패치 기록이 있으면 건너뜀).
- 포기한 run은 복귀 요약의 복구 항목(G11)에 "마지막 확인 지점부터 다시 실행 / 그대로 두기 / 확인 작업 만들기"로 보인다(03 `SCR-RECOVERY`).

#### 3.7.6 크래시 루프 차단

- `daemon.booted` 기록 중 `prevClean = false`인 것이 최근 10분 안에 3회 이상이면 safe mode로 시작한다 [제안. OpenClaw는 5분에 3회, S4/openclaw-runtime §2.3].
- safe mode: run 자동 재개 안 함, 에이전트 run을 시작하는 타이머 발화 보류(알림 계열만 발화), 관찰 에이전트 실행 안 함. 클라이언트에 `safeMode: true`와 이유(최근 비정상 부팅 목록)를 보인다(19·17).
- safe mode 진입은 run의 재개 횟수를 차감하지 않는다.
- 사람이 관리 CLI 또는 앱에서 해제하면(명령 이름은 17·19) 일반 모드로 바꾸고 §3.7.5를 실행한다.

#### 3.7.7 정상 종료와 사람 대기 중 재시작

- 정상 종료(17이 SIGTERM과 종료 예산을 정함): 새 run·입력 접수를 멈춘다 → 제공자 요청을 abort한다 → cooperative 도구를 abort하고 atomic 도구는 끝나기를 기다린다(종료 예산 안에서) → 남은 run을 `run.end { outcome: 'interrupted', reason: 'shutdown' }`으로 제출 → `daemon.stopped { clean: true }`. 이 절차가 실패해도 다음 부팅의 §3.7.3이 같은 결과를 만든다(CR-5).
- `awaiting_human` run과 질문, 승인 레코드는 재시작 뒤에도 그대로다. OpenClaw는 재시작 때 대기 중 승인을 취소하지만(S4/openclaw-runtime §4.3), Helm은 1인 사용자가 휴대폰으로 늦게 답하는 경우를 위해 유지한다. 승인으로 실행할 계획은 한 번만 쓰인다(§3.13).

### 3.8 실행 소유권

#### 3.8.1 두 층 [제안]

| 층 | 소유자 | 수단 | 소유 문서 |
|---|---|---|---|
| 프로세스 | 데몬 하나가 DB의 유일한 writer | OS가 쥐는 단일 인스턴스 락(형제 락 파일에 SQLite 쓰기 트랜잭션을 프로세스 수명 동안 잡는 방식 후보, cases §12.1-4) | 17 |
| run | 그 데몬 안의 run attempt 하나 | 펜싱 토큰 `(runId, attempt, bootEpoch)` | 이 문서 |

시간 기반 lease(만료·heartbeat)는 두지 않는다. 데몬이 하나이므로 "다른 소유자가 살아 있는가"를 시간으로 추정할 필요가 없다. 재시작하면 epoch가 바뀌어 이전 소유는 모두 무효가 된다(RT-7).

#### 3.8.2 펜싱 검사

```ts
export interface RunHandle { readonly runId: RunId; readonly attempt: number; readonly epoch: string }

// run/journal.ts. 런타임의 모든 쓰기 트랜잭션 첫 줄
function fence(tx: Tx, h: RunHandle): void {
  const r = tx.read.run(h.runId);                       // 09 runs 투영 테이블
  if (!r || r.ownerEpoch !== h.epoch || r.attempt !== h.attempt || !['running','stopping'].includes(r.status))
    throw new FencedError(h, r);                        // 트랜잭션 전체가 롤백됨
}
```

펜싱이 막는 경우:

1. 취소 신호를 무시한 도구가 run이 끝난 뒤 결과를 돌려준다 → `afterToolCall`의 기록이 거부되고, 그 호출은 결과 불명으로 남는다(새 attempt가 정리).
2. run 수준 재시도·재개로 attempt가 바뀐 뒤 이전 attempt의 비동기 콜백이 쓰려 한다.
3. 재시작 뒤 이전 epoch의 무엇이든(같은 프로세스에서는 일어나지 않지만 테스트로 보장).

claim과 스냅숏을 섞지 않는다: 펜싱 검사는 트랜잭션 안에서 행을 새로 읽는다. 시작 때 읽은 run 행을 재사용하지 않는다(OpenClaw 최신 커밋의 경쟁 조건, S4/openclaw-runtime §2.1).

#### 3.8.3 자식 프로세스

- 도구 자식 프로세스는 샌드박스에서 `--die-with-parent`와 pid 네임스페이스로 실행해 데몬이 죽으면 함께 죽는다(13 §3.6). 고아 프로세스가 남지 않는다.
- 관리 대상 장기 프로세스(MCP stdio 서버 등)는 pid와 프로세스 시작 시각을 실행 기록에 남기고, 부팅 때 확실히 일치하는 잔존물만 정리한다(S4/paseo §5 관리 프로세스 원장).

### 3.9 동시 실행

#### 3.9.1 직렬화 단위 [제안]

| 단위 | 규칙 | 이유 |
|---|---|---|
| thread | 활성 run은 최대 1개 | 모델 대화 기록이 하나의 순서를 가져야 한다 |
| Concern | 활성 `work` run은 기본 1개(다이얼 후보 `concernWorkConcurrency`, 기본 1). `verifier`·`branch`·`subrun`·`mediator`는 함께 돌 수 있다 | 같은 합의 아래 두 작업 run이 같은 파일을 바꾸면 의미 충돌을 사람이 따라가기 어렵다 |
| 작업 공간(realpath 루트) | 쓰기 계열 도구 실행(`write`, `edit`, 쓰기 가능한 루트가 있는 `bash`, 쓰기로 선언한 MCP)은 작업 공간 단위로 배타. 읽기 도구는 동시에 | 경로 검사와 쓰기 사이의 경쟁(심볼릭 링크 바꿔치기 등, 13 §3.4.4)을 없앤다. pi의 경로별 `withFileMutationQueue`를 포함한다 |
| 전역 | 활성 run 최대 4, 제공자별 동시 요청 `maxConcurrent`(기본 4), 동시 도구 프로세스 최대 4 | WSL 메모리 상한 10 GB(브리프 §2.5) 안에서 운영 |
| 커널 | 모든 제출은 단일 writer 안에서 하나씩 | 10 상자 0 |

두 Concern의 합의가 같은 파일을 쓰는 의미 충돌은 커널이 판정한다(10 P-11). 런타임은 물리적 직렬화만 한다.

#### 3.9.2 저장소 접근 규칙

- `better-sqlite3`는 동기 API다(결정 36). 런타임의 트랜잭션 함수는 동기이고 짧다. 트랜잭션 안에서 `await`, 모델 호출, 도구 실행, 파일 해시 계산(큰 파일)을 하지 않는다. 해시 계산과 변경 감지는 트랜잭션 전에 끝낸다.
- 커밋 순서는 이벤트 루프 순서다. `decide`는 트랜잭션 안에서 현재 상태를 읽으므로 판정과 append 사이에 다른 커밋이 끼지 않는다.

#### 3.9.3 대기열

run 시작 요청이 상한을 넘으면 `queued`로 둔다. 순서: 사람이 시작한 run > 답·승인으로 이어지는 run > 오케스트레이터(14)가 시작한 run > 타이머 > 배경(관찰 등). 같은 등급은 먼저 온 순서. 10분 넘게 기다린 run은 한 등급 올린다(굶주림 방지).

### 3.10 스케줄러·타이머

#### 3.10.1 타이머의 원천 [제안]

| 원천 | 정본 | 예 |
|---|---|---|
| 도메인 타이머 | 커널 상태. `pendingTimers(state)`(10 §3.1.5)로 매번 다시 만든다. 효과 `timer.schedule`/`timer.cancel`은 갱신 신호다 | 질문 만료 여유·만료, 예약 전달 시각, 기대 기한, 예측 확인일, 합의 만료, 다시 볼 조건의 시각 부분, 관찰 기간(A.watch) |
| 시스템 타이머 | 런타임 테이블 `runtime_timers`(09에 요구) | 관찰 에이전트 주기, 중재자 재평가 주기, 예산 창 초기화, 재개 지연, run 벽시계 감시, 유지보수(17: WAL 체크포인트, 백업 스냅숏 계기) |
| 경계 계기(시각 아님) | 런타임이 제출하는 `boundary.reach`(11 §3.6, `BoundaryReachPayload`) | 가정 만료점이 "작업 경계"로 정의된 경우(v0.3 06 §3.4 예 "본문 2절 작성 시작 전"): turn 끝, run 끝, WorkUnit 끝, 사용자 복귀(presence) |

#### 3.10.2 타입

```ts
export type TimerTrigger =
  | { kind: 'at'; at: EpochMs }                          // 절대 시각만 저장 (absurd sleepUntil, cases §8.4)
  | { kind: 'every'; everyMs: number; anchor: EpochMs }
  | { kind: 'cron'; expr: string; tz: string };          // 다음 시각 계산에만 cron 라이브러리 사용 [제안: croner]

export interface TimerEntry {
  timerId: string;                  // 도메인: 10이 정한 ID, 시스템: `tm_<ULID>`
  source: 'kernel' | 'system';
  purpose: TimerPurpose;            // 아래 표
  subject?: AnyId;
  trigger: TimerTrigger;
  nextFireAt: EpochMs;
  missed: 'coalesce' | 'skip';      // 놓친 실행 처리
  singleFlight: boolean;            // 이전 발화의 일이 끝나지 않았으면 이번 발화를 합침
  startsAgentRun: boolean;          // 부팅 직후 catch-up 지연 대상
}
```

#### 3.10.3 알고리즘

```text
scheduler:
  heap: nextFireAt 최소 힙
  rebuild(boot):
     heap = pendingTimers(kernelState).map(toEntry) ∪ runtime_timers
     if boot: catchUp()
     arm()
  arm():
     clearTimeout(t)
     next = heap.peek()?.nextFireAt
     delay = next ? clamp(next - Date.now(), 0, 60_000) : 60_000      # 최대 60초마다 깨어나 시계 점프·WSL 일시정지에 대비
     t = setTimeout(tick, max(delay, 0))
  tick():
     now = Date.now()
     due = heap.popWhile(e => e.nextFireAt <= now)
     for e in due (nextFireAt 순): fire(e, now)
     arm()
  fire(e, now):
     if e.singleFlight and inFlight.has(e.timerId): (coalesce) 다음 시각으로만 옮김
     if e.source == 'kernel':
        engine.submit({ type: 'timer.fire', channel: 'scheduler', actor: { kind: 'scheduler' },
                        idempotencyKey: `timer:${e.timerId}:${e.nextFireAt}`,
                        payload: { timerId: e.timerId, purpose: e.purpose, subject: e.subject,
                                   dueAt: e.nextFireAt, firedAt: now, lateMs: now - e.nextFireAt } })
        # 커널이 판정. 이미 끝난 대상이면 notice.timer_noop (10). 같은 키 재발화는 저장된 결과 재생
     else: systemHandlers[e.purpose](e, now)
     if 반복 트리거: e.nextFireAt = nextAfter(e.trigger, now); heap.push(e); tx: runtime_timers 갱신
  onCommit(effects):                                                    # 10 효과 전달 경로에서 호출
     timer.schedule → heap.upsert; timer.cancel → heap.remove; arm()
```

#### 3.10.4 놓친 실행과 부팅 catch-up

- 데몬이 꺼져 있던 동안 지난 타이머는 부팅 때 한 번씩만 발화한다(`coalesce`). 같은 타이머의 여러 지난 슬롯을 여러 번 돌리지 않는다.
- 부팅 직후 즉시 발화는 최대 5개, 나머지는 5초 간격으로 늦춘다. `startsAgentRun` 타이머는 부팅 후 2분 뒤부터 발화한다(사람 개입과 복구가 먼저 자리 잡게). 근거: S4/openclaw-runtime §3.1 (`DEFAULT_MAX_MISSED_JOBS_PER_RESTART = 5`, 5초 stagger, 에이전트 작업 2분 지연).
- `skip` 타이머(중재자 주기 등)는 놓친 슬롯을 건너뛰고 다음 미래 시각으로 옮긴다(S4/paseo §6).
- 발화에는 `lateMs`가 실린다. 커널·11은 늦게 발화한 가정 만료를 판정할 때 이 값을 쓴다.
- 재시작 때 실행 중이던 시스템 작업(관찰 실행 등)은 "interrupted"로 기록하고 자동 재실행하지 않는다. 다음 주기에 다시 돈다.

#### 3.10.5 답이 대기보다 먼저 도착하는 경우

대기 등록을 메모리에 두지 않는다. 질문의 답은 커밋된 이벤트(`question.answered`)이고, run은 끝내기 전에 질문 상태를 먼저 조회한다(§3.4.9 1단계). 답이 run 종료보다 먼저 와도, 나중에 와도 같은 결과가 된다(absurd `emit_event` first-write-wins와 `await_event`의 "발행된 이벤트 먼저 조회" 순서, cases §8.4; Mastra의 실패 사례, mastra-review §5).

#### 3.10.6 타이머 목록 [제안]

| purpose | 원천 | 트리거 | 놓침 | singleFlight | run 시작 | 의미 소유 |
|---|---|---|---|---|---|---|
| `question_escalation` (만료 여유: 즉시 승격) | kernel | at | coalesce | - | 아니오(알림) | 11 |
| `question_expiry` (가정 만료 → 가정 확정 또는 만료) | kernel | at | coalesce | - | 가정 확정 뒤 대기 run이 있으면 예(§3.2.2) | 11 |
| `rights_deadline` (권리 게이트 마감) | kernel | at | coalesce | - | 아니오 | 11 |
| `mediator_timeout` (중재 결정 기한) | kernel | at | coalesce | - | 아니오 | 11 |
| `daily_digest` (예약 전달 묶음) | kernel | cron(사용자 시간대) | coalesce | 예 | 아니오(알림) | 11 |
| `expectation_deadline` (기대 레코드 기한 → "응답 없음" 관찰) | kernel | at | coalesce | - | 아니오 | 10·14 |
| `prediction_check` (예측 확인일 → A 루프) | kernel | at | coalesce | - | 예(14가 활성화) | 14·15 |
| `agreement_expiry`, `authority_expiry` | kernel | at | coalesce | - | 아니오 | 10 |
| `review_trigger` (다시 볼 조건의 시각 부분) | kernel | at | coalesce | - | 예 | 14 |
| `watch_window` (A.watch 관찰 기간) | kernel | every | coalesce | 예 | 예 | 14 |
| `observer.cycle` (관찰 에이전트 주기) | system | cron 기본 `0 18 * * *` + 유휴 계기 | coalesce | 예 | 별도 프로세스 | 16 |
| `mediator.cycle` (중재자 재평가) | system | every 15분 + presence 변화 | skip | 예 | 예(중재자) | 11 |
| `budget.window_reset` (일일 예산 초기화) | system | cron `0 0 * * *` 사용자 시간대 | coalesce | - | 아니오 | 이 문서 |
| `run.recovery_resume` | system | at | coalesce | 예(run별) | 예 | 이 문서 |
| `run.wall_watchdog` | system | at(run 시작 + wallMs) | coalesce | - | 아니오(중지) | 이 문서 |
| `maintenance.*` | system | cron | coalesce | 예 | 아니오 | 17 |

도메인 타이머의 purpose 이름은 10 `TimerPurpose`·11이 소유하며 위 표는 그 문서들의 초안 이름을 따른다. 시간대는 데몬 설정의 사용자 시간대(기본 `Asia/Seoul`)를 쓴다. 저장은 epoch ms 정수다(브리프 §3.3).

### 3.11 예산

#### 3.11.1 계정과 차원 [제안]

```ts
export type BudgetAccount =
  | { kind: 'run'; runId: RunId }
  | { kind: 'workUnit'; workUnitId: WorkUnitId }
  | { kind: 'activation'; activationRef: string }      // 14 LoopBudget (workUnits, subcalls, wallMinutes)
  | { kind: 'agreement'; agreementId: AgreementId }    // 10 AgreementView.budget. 검사는 커널 V-POL-04
  | { kind: 'daily'; day: string }                     // 사용자 시간대 날짜
  | { kind: 'observer'; day: string };                 // 16

export interface BudgetLimits {
  requests?: number; toolCalls?: number; subcalls?: number;
  inputTokens?: number; outputTokens?: number;
  costUsd?: number; wallMs?: number; workUnits?: number;
}
export interface RunBudget extends BudgetLimits { softRatio: number }   // 기본 0.8
export interface BudgetLease { account: BudgetAccount; reserved: BudgetLimits; leaseId: string }   // 15 하위 호출용
```

기본값(모두 [제안], 다이얼·설정이 덮어씀):

| run 종류 | requests | toolCalls | wall | costUsd |
|---|---|---|---|---|
| work | 40 | 200 | 60분 | 3 |
| verifier | 15 | 80 | 30분 | 1 |
| branch | 12 | 40 | 20분 | 0.5 |
| subrun | 8 (15 `maxTurns`) | 40 | 15분 | 0.5 |
| mediator | 3 | 10 | 2분 | 0.05 |
| 일일 전체 | - | - | - | 30 (경고 80%) |

#### 3.11.2 원장

- 사용량은 실행 기록 `budget.charged`로 남는다(사용량을 낳은 기록과 같은 트랜잭션). 잔액은 원장을 합산한 투영이다(09 투영 테이블). 같은 사용량은 해당하는 모든 계정(run, workUnit, activation, agreement, daily)에 함께 차감한다.
- `BudgetLease`: 15의 역할 호출·하위 실행은 호출 전에 상한을 예약하고 끝나면 실제 사용량으로 정산한다. 예약은 원장에 `reserved`로 들어가며 정산 때 해제된다. 크래시로 정산이 안 된 예약은 부팅 때 실제 사용량 기록으로 정산한다.

#### 3.11.3 집행 지점

| 지점 | 검사 | 넘으면 |
|---|---|---|
| `prepareRequest` | 추정 요청 비용(추정 입력 토큰 × 입력 단가 + 출력 상한 × 출력 단가)과 요청 수가 남은 한도 안인가 | 하드: 요청하지 않고 run 종료 |
| 트랜잭션 A | 실제 사용량 차감 | 소프트 문턱을 처음 넘으면 다음 요청에 S8 알림 |
| `beforeToolCall` | 도구 호출 수, 하위 호출 수. 합의 예산은 커널이 판정(10 V-POL-04) | 차단(`content.budget_exhausted`) |
| `finishTurn` | 하드 한도 | `{action:'end'}` |
| `run.wall_watchdog` | 벽시계 | 취소 절차(§3.12.3)로 멈춤 |
| run 시작 | 일일 한도 | `queued` 유지, 사람에게 알림 |

응답을 받지 못한 요청(크래시)은 추정 입력 토큰을 비용으로 차감한다(보수적). 단가를 모르는 모델(`costKnown: false`)은 토큰 차원만 검사한다.

#### 3.11.4 초과 시 동작

- 소프트(기본 80%): S8 알림을 한 번 주입한다. 문구: `[helm:budget] <dimension> is at 80% (<used>/<limit>). Prioritize finishing the current step and submitting evidence; ask if the remaining work does not fit.` 화면에는 예산 표시가 바뀐다(G16).
- 하드(100%): 진행 중인 도구 배치는 끝낸다(새 요청 없음). run을 `ended(budget_exhausted)`로 끝내고 `run.end`에 진행 요약을 싣는다. 14의 `budget_extension` 접점(14 §3)이 사람에게 묻는다. 질문 내용은 "계속할까요?"가 아니라 줄어든 불확실성(이번 run에서 만든 관찰·판단·제출), 남은 일(열린 기준·질문), 대안(범위 줄이기, 멈추기, 정해진 양만큼 늘리기)이다(canon-3 G16, 11의 금지 질문 종류 `content.question_forbidden_kind`). 요약의 수치는 코드가 기록에서 센다.
- 일일 한도: 새 run은 `queued`(사유 `budget_daily`)로 두고 사람에게 알린다. 실행 중 run은 현재 turn을 끝내고 멈춘다. 자정(사용자 시간대) 초기화 타이머가 대기열을 다시 연다.

### 3.12 사용자 입력이 실행 중 run에 들어가는 방식

#### 3.12.1 타입

```ts
export interface RunInput {
  inputId: RunInputId;               // 클라이언트가 만든 멱등 키(19). 같은 ID는 한 번만 받는다
  concernId: ConcernId; threadId?: ThreadId;   // 없으면 Concern의 현재 work thread
  text: string; images?: BlobRef[];
  mode: 'steer' | 'follow_up' | 'interrupt';
  actor: { kind: 'human'; deviceId?: DeviceId } | { kind: 'runtime' };   // runtime: 끝내기 전 검사 알림 등
  receivedAt: EpochMs;
}
```

19의 `conversation.send`가 `RunInput`이 된다(메서드 이름은 19 소유). 사람 발화를 "사람 출처 관찰"로 남기는 명령은 10이 정한다. 런타임은 그 관찰 ID를 메시지 기록에 연결한다.

#### 3.12.2 전달 규칙 [제안]

| 대상 thread 상태 | mode | 동작 |
|---|---|---|
| 활성 run 없음 | 무엇이든 | 커밋(`input.queued` + `input.delivered` + `message.committed`) 후 새 run 시작 |
| `running` (추론 중) | `steer` | inbox에 커밋. 현재 turn의 도구 배치가 끝난 뒤 다음 요청 전에 들어간다(pi steering 규칙 [원문 `pi-src/packages/agent/src/types.ts` `getSteeringMessages` 주석]) |
| `running` | `follow_up` | 모델이 멈출 지점에서만 들어간다 |
| `running` | `interrupt` | 진행 중 제공자 요청을 abort하고(중단된 응답은 기록하되 투영에서 뺌), cooperative 도구를 abort한 뒤 steering으로 이어간다. atomic/none 도구가 실행 중이면 끝날 때까지 미룬다(`steering.deferred`를 화면에 알림) |
| `awaiting_human` | 무엇이든 | 이 run은 끝난 상태다. 새 run을 시작하고 입력을 넣는다. 열린 질문은 그대로 열려 있다 |
| `interrupted` / `awaiting_recovery` | 무엇이든 | inbox에 쌓고, 재개 run의 첫 요청에 들어간다. 사람이 입력한 것은 재개 판정에서 "사람이 시작한 run" 등급으로 올린다 |

- `getSteeringMessages`/`getFollowUpMessages`는 inbox에서 대기 입력을 꺼내 **커밋한 뒤** 돌려준다(`input.delivered` + `message.committed`, CR-1). 꺼내는 개수는 `one-at-a-time`(pi 기본과 같음)이다.
- 입력과 다음 행동 변화 사이의 turn 수를 기록한다(Directability 지표, extracts-3 X3-8-20).
- 실행 중 run의 합의·기준을 바꾸는 사람 명령(합의 수정 등)은 입력이 아니라 사람 채널 명령이다. 커널이 받으면 다음 요청의 delta 주입으로 모델에게 알려진다. 이미 나간 도구 호출은 `beforeToolCall`이 바뀐 상태로 검사한다.

#### 3.12.3 취소 의미 (canon-2 §4.7, L12)

| 실행 중인 것 | 취소 동작 | 표시 |
|---|---|---|
| 제공자 요청 | abort. 부분 응답은 `aborted`로 기록하고 투영에서 뺌 | 취소됨 |
| `cancellation: immediate` / `cooperative` 도구 | abort 신호 전달. 끝나면 결과 기록 | 취소됨 |
| `atomic` 도구 | 신호를 전달하지 않음. 끝날 때까지 기다린 뒤 다음 단계 전에 멈춤 | "현재 작업 뒤 정지" |
| `none` 도구 (외부 행동) | 신호를 전달하지 않음. 응답을 잃으면 결과 불명(§3.7.4) | "외부 결과 아직 모름" |

"반쯤 끝난 트랜잭션을 취소했다"고 표시하지 않는다(canon-2 §4.7).

#### 3.12.4 presence와 경계 제출 (11 §3.8, §3.6의 요구) [제안]

| 제출 | 언제 | 규칙 |
|---|---|---|
| `presence.update` (런타임 채널) | 클라이언트 연결·해제, 앱 전면·후면, 보고 있는 Concern 변경(19가 알려 줌) | 상태 변화와 초점 변경만 낸다. 30초 안의 반복 변경은 합쳐 마지막 값 하나로 낸다(11 §3.8). 데몬 재시작 직후에는 "연결 없음"으로 한 번 낸다 |
| `boundary.reach { boundary: 'round_end' }` | 15의 탐구 라운드가 끝났다고 실행기가 알릴 때 | 15가 런타임을 통해 낸다 |
| `boundary.reach { boundary: 'loop_transition' / 'workunit_end' }` | 해당 커널 이벤트가 커밋된 직후 | 커널이 이미 이벤트로 알 수 있으면 내지 않는다(11 §3.6 표의 대응 이벤트) |
| `boundary.reach { boundary: 'concern_switch' }` | `presence.changed`의 초점 변경 | presence 제출로 대신한다 |

경계 제출은 멱등 키 `boundary:<kind>:<ref>`로 한 번만 낸다.

### 3.13 사람 결정 대기와 승인된 행동의 실행

#### 3.13.1 대기 [제안]

- 커널이 `needs_gate`를 돌려주면(도구 호출 의도, 제안 도구) 질문이 생긴다(10 §3.4.5, 11). 런타임은 해당 호출을 실행하지 않고, 턴이 끝나면 run을 끝낸다(`awaiting_human`). 도구 호출을 붙잡은 채 기다리지 않는다(RT-5, pi-web `askUserTool.ts:94-104`의 방식).
- 모델의 `helm_ask`도 같다. 질문이 "막히는" 질문(`blocking: true`)이면 대기, 아니면 임시 가정으로 계속 진행한다(11).
- 질문의 전달 시점·방식은 11이 정한다. 런타임은 대기 사실만 커밋한다.
- 답(`question.answered`), 가정 확정(`question.assumed`), 승인(`approval.issued`, 11 §3.14)이 커밋되면 커널 효과(`runtime.signal resume|continue`, 10)가 온다. 런타임은 같은 thread에서 새 run을 시작하고 답을 `<helm_context kind="answer">`로 주입한다. 원래 제출은 커널이 자동 재실행하지 않는다(10 §3.4.5). 모델이 다시 내거나, 승인 계획이면 아래처럼 런타임이 실행한다.

#### 3.13.2 승인된 행동의 실행 (RT-6)

```text
gate가 도구 호출 승인(권리 게이트, 10 P-2·P-3)인 경우:
  의도 제출이 needs_gate(`rights_gate_required`)면 런타임은 막힌 호출의 실행 계획 { tool, executedArgs, argsFingerprint, sandbox 요약, 대상 }을 실행 기록에 남기고 질문 ID와 연결한다(11 §3.14 토큰은 지문만 가지므로)
  사람이 승인하면(사람 채널) 커널이 승인 토큰(`approval.issued`, 지문·대상·만료)을 만든다. `approve_edited`면 토큰 지문은 고친 인자의 것이고, 고친 인자 본문은 답 payload로 온다(11에 요구)
  runtime:
    tc' = 새 도구 호출(origin: 'approval', approvalId, replyTo: 원래 tc)
    beforeToolCall 경로로 toolcall.intend 제출 (approvalId 포함) → 커널이 지문 대조·1회 소진(P-3)을 같은 트랜잭션에서
    실행 → toolcall.complete
    결과를 thread에 주입: <helm_context kind="answer"> approved action tc' result … </helm_context>
    같은 thread의 새 run이 이어간다
```

- 모델은 승인된 행동을 다시 내지 않는다. 승인 때 본 인자와 실행 인자가 같다는 것이 지문으로 보장된다(mastra-review §4 "승인과 실제 실행 인자 묶기", S4/openclaw-runtime §4.3 "승인 시점의 실행 plan 저장").
- 승인이 거절되면 거절 사실을 주입하고 이어간다. 승인이 만료되면(11) 만료 사실을 주입한다.
- 승인 계획은 한 번만 실행된다. 재시작 뒤에도 소진 기록(커널 이벤트)으로 판정한다.

### 3.14 하위 에이전트 실행

#### 3.14.1 소유 트리와 취소

- 하위 run은 `parentRunId`를 가진다. 부모 run을 취소하면 자식 run을 먼저 취소하고(위에서 아래로), 자식이 모두 정착한 뒤 부모가 종결된다(pi-durable structured concurrency, spec §5.5 [원문 pi-facts-1 §7.2]; extracts-3 X3-5-03).
- 커널 효과로 시작한 검증 에이전트·중재자 run은 부모 run이 없다. 소유는 대상 레코드(결과 제출, 질문)다. 그 대상이 닫히면 run을 취소한다.
- 자식 run의 사용량은 부모의 계정(activation, workUnit)에도 차감한다. 자식 예산은 부모 잔액을 넘지 않는다.

#### 3.14.2 검증 에이전트 [제안]

| 항목 | 값 |
|---|---|
| 계기 | 커널 효과 `agent.request { role: 'verifier', subjects: [resultId] }`(10) 또는 14의 A.confirm `verify` WorkUnit |
| 컨텍스트 | `fresh`. 새 thread. 작업 run의 대화 기록을 보지 않는다(분기가 아님, v0.3 08 §9). 섹션: goal, agreement, criteria, submission, evidence, counter_evidence (14 A.confirm 템플릿) |
| 모델 | 역할 `verifier`, `differentFamilyFrom: work` (§3.3.3). 같은 모델로 떨어지면 `independence: 'same_model'` 기록 |
| 도구 | `read`, `grep`, `find`, `ls`, `bash`(쓰기 가능한 루트 없음, 네트워크 없음, 13 §3.6), `helm_query`, 제안 도구 중 `counter_evidence`·`attest`·`question` (10 능력표의 verifier propose 범위) |
| 출력 | 제안 도구로만. 반대 근거, 증언, 질문 |
| 예산 | §3.11.1 표 |
| 독립성 검사 | 커널이 한다(10 P-5: 결과 작성 run 계통의 행위자는 증언 불가) |

#### 3.14.3 중재자 [제안]

| 항목 | 값 |
|---|---|
| 계기 | 커널 효과 `agent.request { role: 'mediator' }`, `mediator.cycle` 타이머, presence 변화(사용자 복귀·이탈, 11) |
| 컨텍스트 | 호출마다 `fresh`(상태 없는 판정). 입력: 열린 질문 목록(게이트, 만료점, 가정), 사용자 상태(활동 여부, 마지막 응답 시각, 보고 있는 Concern) (v0.3 06 §3.7) |
| 모델 | 역할 `mediator`(싼 모델) |
| 도구 | `helm_query`, 제안 도구 `delivery.plan`(10 능력표). 파일 도구 없음 |
| 출력 | 질문별 전달 시점과 묶음 제안. 커널이 기록하고 11이 적용 |
| 예산 | 요청 3 |

#### 3.14.4 발산 가지 [제안]

| 항목 | 값 |
|---|---|
| 계기 | 15의 실행기가 `SubRunPort`로 요청(14 WorkUnit 템플릿 `context: 'fork'`, `repeat: 'per_branch'`) |
| 컨텍스트 | 가지마다 새 thread. snapshot은 공통 `forkCursor`의 상태로 렌더링한다(모든 가지가 같은 시점에서 시작). 이후 delta에서 형제 가지 run이 만든 레코드는 뺀다(`excludeThreads`, `omitted.reason: 'sibling-branch'`). 서로의 결과를 보지 않는다(A4, v0.3 08 §9) |
| 모델 | 역할 `branch`, `preferIndex` = 가지 순번(가지별 다른 모델, 15 §3.4.6) |
| 도구 | 15가 정한 근거 범위 도구 묶음(`EvidenceToolset`, 13 §3.2) + 가지가 낼 수 있는 제안 도구 |
| 동시성 | 한 번에 최대 4 가지(전역 상한 안) |

#### 3.14.5 하위 실행(15 `SubRunPort.run`) [제안]

- 새 thread, `context: 'fresh'`. 과제 문장(`task`)이 첫 사람 역할 입력이다(actor `runtime`, origin `injection`).
- 도구: `toolset`(`read_target` | `read_docs` | `read_web`, 13 §3.2) + 결과 제출 도구 `helm_submit_subrun_result`. 이 도구의 입력 스키마는 `spec.outputSchema`다. 호출되면 결과를 기록하고 `terminate: true`로 run을 끝낸다.
- `maxTurns`(기본 8)를 요청 수 상한으로 쓴다. 상한까지 제출이 없으면 `{ ok: false, error: { kind: 'schema', … } }`.
- 돌려주는 값(`SubRunResult`): 제출값, 실행된 도구 호출 ID, 그 결과로 커널이 만든 관찰 ID, 사용량, 모델. 하위 실행의 모델 출력은 관찰이 아니다(15 R5).
- 크래시로 끊긴 하위 실행은 재개하지 않고 실패로 돌려준다. 15가 메모 키로 다시 실행할지 정한다(15 §3.1.7).

#### 3.14.6 역할 호출(15 `ModelPort.call`, 13 `helm_subcall`)

- 도구 없는 단일 모델 호출이다. run을 만들지 않고 호출 기록(`model.requested`/`model.responded`, `attribution`: 부모 run·도구 호출·Concern)만 남긴다.
- `memoKey`가 있고 같은 키의 성공 호출 기록이 있으면 다시 부르지 않고 그 결과를 돌려준다(`fromMemo: true`). 크래시 뒤 15의 행동 재실행이 비용을 다시 쓰지 않게 한다.
- 출력 스키마가 있으면 JSON 출력을 검증하고 실패 시 2회까지 다시 요청한다(검증 오류를 메시지로 붙임). 그래도 실패면 `schema` 오류.
- 하위 호출 출력은 관찰이 아니다. 기록할 가치가 있으면 호출자가 제안 명령으로 커널에 보낸다.

#### 3.14.7 관찰 에이전트

관찰 에이전트는 별도 프로세스다(16, 06 §3.1.2 ④). 런타임의 몫은 다음뿐이다.

- `observer.cycle` 타이머와 유휴 계기에서 데몬이 `helm-observer`를 띄우도록 효과를 낸다(single-flight: 이전 실행이 남아 있으면 건너뜀).
- 관찰 에이전트의 모델 호출은 데몬의 역할 호출 경로를 지난다(16 OB-3과 같음). API 키가 관찰 프로세스에 들어가지 않고 예산 계정 `observer`와 2차 마스킹을 데몬 한 곳에서 집행한다. 관찰 자식과의 통신 형식(Node IPC 또는 표준 입출력 JSON 줄)은 16·17이 정한다.

### 3.15 포트 구현 계약 (15·16이 쓰는 것)

| 포트 | 정의 | 구현 |
|---|---|---|
| `ModelPort.call(req)` | 15 §3.1.2 | `gateway.complete({ role: req.role, outputSchema: req.outputSchema, memoKey: req.memoKey, budget: req.lease, … })`. `RoleCallResult.runId`에는 부모 run ID를 넣는다(역할 호출은 run이 아님) |
| `ModelPort.generateImages` | 15 | pi-ai `generateImages`(이미지 모델 역할이 설정된 경우만). 없으면 포트에 메서드가 없다 |
| `SubRunPort.run(spec)` | 15 §3.1.2 | §3.14.5 |
| `ReplPort` | 15 §3.12 | 13 §3.8 |
| `KernelPort` | 15 §3.1.2 | `engine.submit` / 읽기 투영(06·10). 런타임 소유 아님 |
| `llm.complete`(관찰) | 16 | `ModelPort.call`과 같은 경로, 계정 `observer` |

`BudgetLease` 의미: 호출 전에 `reserved`만큼 계정에서 예약한다. 예약이 안 되면(잔액 부족) 호출하지 않고 `budget` 오류. 끝나면 실제 사용량으로 정산하고 남은 예약을 푼다.

### 3.16 이름 목록 (09·10에 요구)

| 종류 | 이름 | 비고 |
|---|---|---|
| 런타임 채널 명령(10·11 소유) | `run.start`(재시작 포함), `run.end`(outcome `interrupted` 포함), `toolcall.intend`, `toolcall.complete`, `toolcall.interrupt`, `toolcall.outcome_unknown`, `toolcall.recover`(런타임이 해시로 증명할 때), `boundary.reach`, `presence.update`, `rollback.register` | 10 §3.11.7, 11 §3.6·§3.8·§3.12에 있음. 재시작 허용과 `requiresHuman`만 요구 |
| 사람 채널 명령(10 소유) | `toolcall.recover`, `run.cancel`(또는 19 `run.stop`의 내부 명령), `runtime.exit_safe_mode` | 뒤 둘은 새로 요구 |
| 스케줄러 채널 명령 | `timer.fire` | 10 §3.3.2 |
| 커널 이벤트(09 소유) | `run.started`, `run.ended`, `toolcall.intended`, `toolcall.completed`, `toolcall.interrupted`, `toolcall.outcome_unknown`, `toolcall.recovered`, `approval.consumed`, `boundary.reached`, `presence.changed` | 10·11이 정한 이름 |
| 실행 기록(09 테이블) | `message.committed`, `model.requested`, `model.attempted`, `model.responded`, `model.request_abandoned`, `model.switched`, `toolcall.requested`, `toolcall.state`, `toolcall.denied_by_path_policy`, `toolcall.not_executed`, `toolcall.result`, `context.injected`, `context.compacted`, `run.stage`, `input.queued`, `input.delivered`, `input.dropped`, `budget.charged`, `settle.unresolved`, `recovery.decided`, `daemon.booted`, `daemon.stopped` | 도메인 이벤트 아님 |
| 휘발 스트림(19 소유) | `stream.chunk`(assistant 조각), `tool.progress`(F-4 phase, 진행 조각), `run.partial` | seq 없음 |
| ID 접두사(08 소유) | `th`(thread), `mr`(model request), `cx`(projection), `cs`(compaction summary), `ri`(run input), `tm`(system timer), `ms`(message) | 제안 |

09 초안(§3.4.12, §3.5)은 런타임 기록을 정본 로그의 `runtime` 범주 이벤트로 두었다. 이 문서의 실행 기록 종류는 다음 09 이벤트에 대응한다. 실행 기록을 별도 테이블(`appendTrace`)로 둘지 정본 로그의 runtime 범주 이벤트로 둘지는 09·06이 정하고, 이 문서의 알고리즘은 어느 쪽이든 "같은 트랜잭션, 커널 판정 없이 형식·펜싱 검사만"이면 된다.

| 이 문서 | 09 초안 | 10 초안 | 비고 |
|---|---|---|---|
| `message.committed` | `run.message_recorded` | - | 본문은 blob |
| `model.requested`(manifest) | `run.context_projected` | `ContextRef` | |
| `model.responded`, `model.attempted`, `model.request_abandoned`, `model.switched` | 없음 | - | 09에 요구 |
| `toolcall.requested` | `toolcall.requested` | - | 같음 |
| 커널 rejected / needs_gate | `toolcall.blocked`, `toolcall.approval_requested` | `submission.rejected`, `submission.gated` | 09·10이 맞출 것 |
| 의도 커밋 | `toolcall.started`("실행 전에 커밋") | `toolcall.intended` | 이름 불일치. 09·10이 맞출 것 |
| `toolcall.not_executed`(재시작, 의도 없음) | `toolcall.dropped` | - | |
| 결과 불명 | `toolcall.outcome_uncertain` | `toolcall.outcome_unknown` | 이름 불일치 |
| 재실행 | `toolcall.replay_started` | - | |
| 사람·런타임 해소 | `toolcall.recovered` | `toolcall.recovered` | 같음 |
| `input.delivered` | `run.steered` | - | |
| run 상태 | `run.awaiting`, `run.resumed`, `run.interrupted`, `run.recovered`, `run.completed`, `run.failed`, `run.cancelled` | `run.started`, `run.ended` | 09가 더 세분. 10의 `run.end` outcome과 대응 |
| 휘발 조각 | `run.text_delta`, `run.thinking_delta`, `run.toolcall_args_delta`, `toolcall.output_delta`, `run.step_progress` | - | 19의 `stream.chunk`·`tool.progress`와 이름을 맞출 것 |

## 4. 실패·예외·경계 사례

| 번호 | 사례 | 처리 | 근거 |
|---|---|---|---|
| E-01 | assistant `message_end` 기록 중 저장 오류 | 싱크가 throw → 루프가 오류 응답으로 끝남(`Agent`가 아닌 저수준 루프에서는 예외가 `runAgentLoop` 밖으로 나온다) → run `failed(journal_unavailable)`. 도구는 하나도 준비되지 않았다(CR-2) | §3.4.4 |
| E-02 | `toolcall.intend` 커밋 실패 | 차단 + run 실패 예약. 실행하지 않는다 | CR-3 |
| E-03 | 실행은 끝났는데 `toolcall.complete` 커밋 실패 | 결과를 메모리에 두고 1회 재시도. 그래도 실패하면 run 실패. 재시작 뒤 이 호출은 의도만 있는 상태 → §3.7.2 판정 | CR-4 |
| E-04 | 도구가 abort를 무시하고 run 종료 뒤 결과를 냄 | 펜싱이 기록을 거부. 결과는 버리고 운영 로그에 남김. 의도는 다음 정리에서 결과 불명 | §3.8.2 |
| E-05 | 모델이 같은 제공자 호출 ID를 한 thread에서 두 번 냄 | 두 번째는 `runtime.duplicate_tool_call_id`로 차단(실행 안 함). pi-ai가 다음 요청에서 ID를 정규화하므로 대화는 이어진다 | canon-2 §9.11 |
| E-06 | `stopReason: stop`인데 도구 호출이 있음 | 정상 실행(pi 동작) | §2.2 |
| E-07 | `stopReason: length`, 도구 호출 있음 | 모두 실행 안 함, `truncated_response` 기록 | §3.4.7 |
| E-08 | `stopReason: length`, 텍스트만 | 한 번 이어쓰기 알림 후 continue | §3.4.9 |
| E-09 | 제공자 429·과부하 | `@helm/ai` 재시도(최대 4) → 대체 모델 → 그래도 실패면 run 수준 재시도 2회 → `failed` | §3.3.5 |
| E-10 | 키 없음·인증 거부 | 재시도 없음. 해당 제공자 `health: auth_failed`. 후보에서 다른 제공자로 대체(설정 `fallbackOn`에 auth가 있을 때만), 없으면 run `failed` + 사람 알림 | §3.3.4 |
| E-11 | 컨텍스트 초과 오류 | 2단계 컴팩션 후 한 번 다시 요청. 또 초과면 `context_overflow` 종료 | §3.6.2 |
| E-12 | 필수 범주만으로 창 초과 | fail-closed, 요청하지 않음 | §3.5.5 |
| E-13 | 요약이 필수 ID를 빠뜨림 | 1회 재요청, 그래도 빠지면 결정적 부록 | §3.6.4 |
| E-14 | 투영 도구 집합과 시스템 메시지 선언 불일치 | 버그. run 실패, 운영 로그. 시험으로 막는다 | §3.4.8 |
| E-15 | 응답을 기다리는 동안 합의가 철회됨 | 응답의 쓰기 호출은 `beforeToolCall`에서 현재 상태로 검사 → `no_active_agreement` 거부. 다음 요청에 delta | §3.5.6 Invalidated |
| E-16 | 합의 재협상(범위 변경) 중 run 실행 | 바뀐 범위가 다음 호출부터 적용. delta 주입. 실행 중 bash는 시작 때의 쓰기 가능 루트로 끝까지 간다(샌드박스는 실행 중 바꾸지 않음) | canon §9.9 |
| E-17 | 커널 효과 `runtime.signal abort` | §3.12.3 취소 의미 | 10 §3.1.4 |
| E-18 | 질문 답이 run 종료보다 먼저 도착 | `finishTurn`이 상태 조회로 받아 이어감 | §3.10.5 |
| E-19 | 같은 승인으로 두 번 실행 시도 | 커널이 1회 소진 검사로 두 번째 의도를 거부 | §3.13.2 |
| E-20 | 크래시: 스트리밍 중 | 응답 버림, `model.request_abandoned`, 재개 때 다시 요청 | CR-7 |
| E-21 | 크래시: 의도 커밋 뒤 실행 전 | 결과 불명(실행 여부를 알 수 없음. 의도와 실행 사이는 짧지만 0이 아니다). 쓰기 도구는 해시 guard로 구분 | §3.7.2 |
| E-22 | 크래시: 실행 뒤 결과 커밋 전 | 같음. bash는 변경 감지 결과를 안내에 붙임 | §3.7.4 |
| E-23 | 크래시: 컴팩션 요약 생성 중 | 요약 버림, 다음 요청에서 재판정 | §3.6.4 |
| E-24 | 크래시 루프 | safe mode | §3.7.6 |
| E-25 | 재개 3회 실패 | `recovery_exhausted`, 복귀 요약 복구 항목 | §3.7.5 |
| E-26 | 데몬이 꺼진 동안 타이머 시각 지남 | 부팅 catch-up(상한 5, 간격 5초, run 시작 타이머 2분 지연), `lateMs` 전달 | §3.10.4 |
| E-27 | WSL 일시정지·시계 점프 | 60초마다 깨어나 다시 계산. 뒤로 간 시계는 이른 발화를 만들지 않음(절대 시각 비교) | §3.10.3 |
| E-28 | 일일 예산 소진 | 새 run 대기, 현재 turn 뒤 정지, 자정 초기화 | §3.11.4 |
| E-29 | 이미지가 필요한데 이미지 모델 없음 | run 시작 안 함, `ai.no_model_for_role` 알림 | §3.3.8 |
| E-30 | 검증 에이전트가 작업 모델과 같은 모델로 떨어짐 | 실행하되 `independence: same_model` 기록·표시 | §3.3.3 |
| E-31 | 같은 thread에 run 시작 요청이 겹침 | 두 번째는 `thread_busy`, 입력은 inbox로 | §3.2.2 |
| E-32 | 사람이 `awaiting_human` thread에 새 입력 | 새 run 시작, 질문은 열린 채 | §3.12.2 |
| E-33 | 끝내기 전 검사 항목이 계속 남음 | 2회 알림 뒤 `settle.unresolved` 기록하고 끝냄(무한 반복 방지) | §3.4.9, extracts-2 d-2 |
| E-34 | 모델 출력의 터미널 제어 문자 | 기록은 원문. 클라이언트로 보내는 휘발 조각과 화면 투영에서 C0·C1 제어 문자(줄바꿈·탭 제외)를 지운다(19·20에 요구) | canon-2 §9.11 |
| E-35 | 모델 서술이 상태 라벨("완료", "관찰됨")을 흉내 냄 | 화면의 상태 표시는 레코드에서만 만든다. assistant 텍스트에서 상태를 추출하지 않는다 | canon-2 §4.5 |
| E-36 | 실행 중 루프 전환(커널이 다른 루프로 전환) | 다음 요청의 머리 뒤에 중간 시스템 메시지로 도구·규칙 교체, 캐시 깨짐 기록 | §3.5.3 |
| E-37 | 6시간 넘게 쉰 thread 재개 | 새 snapshot 주입 | §3.5.6 |
| E-38 | 관찰 프로세스 실행 중 다음 주기 | single-flight로 건너뜀 | §3.10.6 |

## 5. 다른 문서와의 인터페이스

### 5.1 이 문서가 제공하는 것

| 대상 | 제공 |
|---|---|
| 13 | 커널 연결 훅이 도구 스펙에 요구하는 함수(`prepare`, `postprocess`, `replay`, `replayGuard`, `safeForRecoveryTurn`, `cancellation`)를 부르는 순서와 시점(§3.4.5, §3.4.6), 결과 불명 판정에서 쓰는 변경 감지 호출(§3.7.3) |
| 10 | 런타임 채널 제출의 내용과 시점(§3.4, §3.16), `contextRef`(§3.5.6), 경계 계기(`boundary.reach`), presence(`presence.update`), 타이머 발화(`timer.fire`) |
| 11 | 질문 대기 중 run 종료와 답 뒤 재개(§3.13), 예약 전달·만료 타이머 발화(§3.10.6), 중재자 run(§3.14.3) |
| 14 | `RunSpec`(WorkUnit 템플릿 → run), run 종료 사유, 예산 소진 요약(§3.11.4), `startRun` API |
| 15 | `ModelPort`, `SubRunPort` 구현, 가지 실행(§3.14.4), 역할 모델 배정(`preferIndex`) |
| 16 | 실행 기록(사용량, 캐시 깨짐, 차단·재시도·복구), 관찰 주기 타이머, 관찰 모델 호출 경로 |
| 17 | 부팅 복구 절차와 정상 종료 순서(§3.7.3, §3.7.7), safe mode, 상태 확인용 `gateway.health()` |
| 19 | 휘발 스트림 내용(`stream.chunk`, `tool.progress`, `run.partial`), run 상태 값, thread 개념, 화면 투영 공통 envelope(§3.5.8) |
| 03·04 | 화면 투영 공통 규약, 복귀 요약 생성 절차와 복구 항목 |

### 5.2 다른 문서에 요구하는 것

| 문서 | 요구 |
|---|---|
| 06 | `engine.transact(fn)` 안에서 `submit`과 `appendTrace`를 함께 쓰는 API. 실행 기록 append는 커널 판정 없이 형식·펜싱 검사만 |
| 07 | 포크 변경 F-1~F-7(§3.4.1). pi-ai Anthropic 경로에서 연속 user 역할(toolResult 뒤 주입 텍스트) 처리 확인(시험 T-PJ-07). pi-ai OpenAI Responses 경로가 서버 쪽 대화 상태(`store`, `previous_response_id`)를 쓰지 않는지 확인 [가정: 무상태 요청]. 요약 프롬프트·직렬화(coding-agent `compaction/*`)를 포크할지 참고할지. 이미지 크기 조정 모듈 |
| 08 | ID 접두사 `th`, `mr`, `cx`, `cs`, `ri`, `tm`, `ms`. Concern 또는 WorkUnit의 `workspaceRoot` 필드. run 레코드(상태, attempt, ownerEpoch, stage, recoveryAttempts, parentRunId, threadId) |
| 09 | 실행 기록 테이블(§3.4.10 `TraceRecord`), `toolCallId` 종결 기록 유일 제약(first-writer-wins), 예산 원장 투영, `runtime_timers` 테이블, blob 저장(내용 주소) |
| 10 | (1) `run.start`가 interrupted run을 같은 runId·더 큰 attempt로 다시 시작하는 것을 허용. (2) `toolcall.outcome_unknown`에 `requiresHuman`(외부 효과 여부)을 두고 참일 때만 막는 질문을 만들 것. (3) 해시 guard로 적용이 증명된 의도에 런타임이 `toolcall.complete`를 낼 수 있게(완료 없음 상태에서). (4) `run.cancel`, `runtime.exit_safe_mode` 명령. (5) 작업 공간 밖 쓰기 부여를 가진 합의 거부. `toolcall.complete`에서 관찰을 만드는 규칙(사후 범위 검사 `observedChanges` 포함). `checkSettle`이 돌려줄 항목의 키(`s.key`)와 알림 문장. `mustIncludeRefs`. 승인 계획 저장 위치(11과 함께) |
| 11 | 질문 종류 `tool_outcome_unknown`(결과 불명 외부 행동 해소). 승인 레코드에 실행 계획(인자·지문) 저장과 1회 소진. 재시작 뒤 승인 유지 |
| 14 | `RunSpec`의 `instructions`(루프·단계 지시문)와 ContextSection 순서. `budget_extension` 접점이 받을 진행 요약 형식. 하위 run 실패 시 재시도 판단 |
| 15 | §3.12 REPL 절과 `ReplPort`를 13 §3.8과 맞춤. 하위 실행 크래시 시 메모 키 재실행 |
| 16 | 캐시 효율(`cacheBreak`)·재시도·복구 지표를 실행 기록에서 읽는 방법 |
| 17 | 단일 인스턴스 락, 부팅 순서에서 §3.7.3의 위치, 종료 예산, safe mode 해제 명령, 사용자 시간대 설정 |
| 18 | 모델 키 마스킹 규칙(오류 문자열), 렌더링 결과 비밀 패턴 마스킹 |
| 19 | 휘발 스트림의 제어 문자 제거, `run.partial`, 컴팩션 요청 메서드, safe mode 표시, 관찰 프로세스용 모델 호출 메서드 |
| 03·04 | 복귀 요약 절 순서 확정(§3.5.8 기본안), 복구 화면(`SCR-RECOVERY`)이 쓰는 run·도구 호출 상태 |

## 6. 구현 단위와 완료 기준

테스트는 `@helm/testkit`(06)의 faux 제공자 대본(pi-ai `fauxProvider`, 고정 `api` 값: pi-facts-1 §2.10), 임시 SQLite, 가짜 시계, 고정 ULID 생성기를 쓴다.

| 단위 | 파일 | 완료 기준 (테스트로 확인) |
|---|---|---|
| U-AI-1 게이트웨이 | `packages/ai/src/gateway.ts`, `config.ts`, `roles.ts` | T-AI-01 역할별 후보 해석: 이미지 요구, 다른 계열 요구, `preferIndex` 회전. T-AI-02 후보 없음 → `ai.no_model_for_role`. T-AI-03 재시도: 콘텐츠 이벤트 전 오류는 재시도, 후 오류는 재시도 안 함. T-AI-04 대체: 재시도 소진 후 다음 후보, `model.switched` 기록. T-AI-05 `maxRetries: 0`이 제공자에 전달됨 |
| U-AI-2 키 | `credentials.ts` | T-AI-06 env에서 키를 읽고 `process.env`에서 지움. T-AI-07 `modify` 호출은 오류. T-AI-08 오류 문자열에 키 값 없음(키를 넣은 가짜 오류로 확인) |
| U-AI-3 사용량 | `usage.ts` | T-AI-09 `calculateCost` 결과와 `costKnown`. T-AI-10 중단 응답의 부분 사용량 기록 |
| U-AG-1 포크 | `packages/agent/src/loop.ts` | T-AG-01~05 F-1의 다섯 경우 `executed`·`rejection.kind`. T-AG-06 F-2 인자 교체가 `execute`에 가고 transcript 인자는 원래 값. T-AG-07 F-3 배열 소유. T-AG-08 stopReason `stop`에서도 도구 실행. T-AG-09 `length`면 실행 안 함 |
| U-RT-1 훅·기록 | `run/hooks.ts`, `run/journal.ts` | T-RT-01 한 turn의 기록 순서가 §3.4.3과 같다(기록 스냅숏). T-RT-02 의도 커밋 실패 시 실행 0회. T-RT-03 모델 인자와 실행 인자가 따로 남는다. T-RT-04 `structuredContent`가 결과 기록에 있다. T-RT-05 결과 first-writer-wins(같은 tc 두 번 완료 시 처음 것 유지). T-RT-06 Helm 제안 도구는 의도 기록 없이 제출과 결과가 한 트랜잭션. T-RT-07 `needs_gate` 뒤 run이 `awaiting_human`, 매달린 도구 호출 없음 |
| U-RT-2 run 상태 | `run/engine.ts` | T-RT-08 §3.2.2 표의 모든 행(상태 × 사건) 시험. T-RT-09 같은 thread 동시 시작 거부. T-RT-10 run 수준 재시도 2회 |
| U-RT-3 투영 | `projection/model.ts`, `sections/*` | T-PJ-01 같은 cursor·규칙·모델 → 같은 `bytesHash`(결정성). T-PJ-02 요청마다 새 배열. T-PJ-03 앞부분 불변: 컴팩션·전환이 없으면 요청 n의 메시지 열이 요청 n+1의 접두사. T-PJ-04 필수 범주 ID가 모두 `includedRefs`에 있다(속성 테스트: 무작위 상태). T-PJ-05 필수 초과 → fail-closed, 요청 0회. T-PJ-06 생략 보고(`omitted`)와 모델용 생략 문장. T-PJ-07 toolResult 뒤 주입 메시지가 pi-ai 변환을 통과(Anthropic·OpenAI 변환 스냅숏). T-PJ-08 도구 집합 = 시스템 메시지 재생 결과. T-PJ-09 형제 가지 기록 제외 |
| U-RT-4 컴팩션 | `projection/compaction.ts` | T-CP-01 도구 호출과 결과 사이를 자르지 않는다. T-CP-02 필수 ID 누락 시 재요청 → 부록. T-CP-03 요약 직후 새 snapshot 주입. T-CP-04 생략 결정이 결정적 |
| U-RT-5 복구 | `recovery/*` | T-CR-01 스트리밍 중 kill → 재시작 → 요청 버림·재요청. T-CR-02 의도 뒤 kill: `read`는 재실행, `bash`는 결과 불명 문구, `write`는 해시 guard 세 경우(applied / before / 변경됨). T-CR-03 의도 없음 → 실행 안 함 기록. T-CR-04 "의도 시점 safe AND 현재 safe": 나중에 safe로 바꿔도 재실행 안 함. T-CR-05 재개 첫 turn 도구 제한. T-CR-06 재개 예산 3회 후 `recovery_exhausted`. T-CR-07 비정상 부팅 3회/10분 → safe mode, 자동 재개 0회. T-CR-08 send 결과 불명 → `awaiting_recovery` + 질문. T-CR-09 kill 시점을 무작위로 바꾼 장애 주입 100회에서 CR-1~CR-4 위반 0(22와 함께) |
| U-RT-6 소유권 | `run/journal.ts` | T-OW-01 종결 뒤 늦은 결과 기록 거부. T-OW-02 attempt가 바뀐 뒤 이전 attempt 쓰기 거부. T-OW-03 이전 epoch 소유 run 정리 |
| U-RT-7 동시성 | `run/engine.ts` | T-CC-01 같은 작업 공간 쓰기 도구 배타. T-CC-02 전역·제공자 상한. T-CC-03 대기열 우선순위와 굶주림 방지 |
| U-RT-8 스케줄러 | `scheduler/*` | T-SC-01 타이머 하나, 지연 ≤ 60초. T-SC-02 부팅 catch-up 상한 5·간격·run 타이머 2분 지연. T-SC-03 같은 타이머 재발화의 멱등(같은 키). T-SC-04 시계 점프 앞뒤. T-SC-05 single-flight. T-SC-06 cron 다음 시각(사용자 시간대) |
| U-RT-9 예산 | `budget/*` | T-BG-01 소프트 문턱 알림 1회. T-BG-02 하드 문턱 후 새 요청 0회, 진행 요약 제출. T-BG-03 lease 예약·정산, 크래시 뒤 정산. T-BG-04 일일 한도 대기와 자정 초기화 |
| U-RT-10 입력 | `run/inputs.ts` | T-IN-01 steering이 다음 요청 마지막 사용자 메시지로 들어감(pi 실험 A1-8과 같음). T-IN-02 follow-up은 멈출 지점에서만. T-IN-03 interrupt: 추론 abort, cooperative abort, atomic 지연. T-IN-04 같은 `inputId` 두 번 → 한 번만 |
| U-RT-11 하위 실행 | `run/subagents.ts`, `ports/*` | T-SA-01 부모 취소가 자식을 먼저 취소. T-SA-02 검증 run이 작업 thread 메시지를 보지 않음. T-SA-03 하위 실행 제출 도구로 종료·`SubRunResult`. T-SA-04 역할 호출 메모 재사용. T-SA-05 승인 계획 실행이 지문을 대조하고 1회만 |
| U-RT-12 화면 투영 규약 | `projection/views.ts` | T-VW-01 같은 로그 → 같은 뷰와 표시 번호. T-VW-02 투영 실패 시 `degraded`, 커밋 유지. T-VW-03 복귀 요약 그룹 ≤ 5, 항목마다 출처 seq |

통합 시나리오(22로 넘김): extracts-3 X3-4-11의 한 turn 흐름(읽기 → 해석 제안 → 합의 없이 쓰기 차단 → 합의 제안 → 사람 확인 → 쓰기 → 결과 제출 → 사람 확인)을 faux 대본으로 돌려, 모든 기록과 거부가 §3.4.3 순서로 남는지 확인한다. durable-spike 스파이크 1의 c1~c7과 같은 결과가 나와야 한다(canon-2 §7.2.1).

## 7. 미결 사항

| 번호 | 질문 | 선택지 | 추천 기본값 |
|---|---|---|---|
| O-12-01 | 같은 Concern의 작업 run 동시 수 | 1 / 다이얼 | 1, 다이얼 후보로 둠 |
| O-12-02 | 재개 첫 turn 도구 제한을 항상 할지 | 항상 / 쓰기·실행 결과 불명이 있을 때만 / 안 함 | 결과 불명이 있을 때만 |
| O-12-03 | 결과 불명 쓰기의 자동 되돌리기 | 없음 / git 추적 파일만 / 스테이징 격리(13 S2)일 때만 | 없음. 모델이 확인하고 사람이 판단 |
| O-12-04 | 크래시 루프 기준 | 5분 3회(OpenClaw) / 10분 3회 | 10분 3회 |
| O-12-05 | 재시작 때 대기 중 승인 유지 | 유지 / 취소(OpenClaw) | 유지, 1회 소진 |
| O-12-06 | 모델용 고정 문구 언어 | 영어 / 한국어 | 영어(도구 설명·pi 문구와 같은 언어). 사용자 표시 문장은 한국어로 쓰라는 지시를 S1에 둔다 |
| O-12-07 | 예산 기본값 | §3.11.1 표 | 표의 값. 2주 사용 뒤 16 지표로 보정 |
| O-12-08 | 구독형 OAuth 로그인(pi-ai OAuth) | 1차 제외 / 포함 | 제외. env 키만 |
| O-12-09 | 복귀 요약 그룹 서술에 모델을 쓸지 | 쓰지 않음(목록만) / summarizer 역할 | summarizer, 실패하면 목록만 |
| O-12-10 | thread 재개 시 새 snapshot 기준 | 6시간 / 루프 전환마다 / 안 함 | 6시간 |
| O-12-12 | v0.2 실행 후보의 "provider turn" JSON 계약(blocks·gate·finish 상호 배제) 채택 | 채택 / 채택 안 함 | 채택 안 함. pi-agent-core의 텍스트 + 도구 호출 형식을 쓰고, 상태 라벨은 기록에서만 만들며(E-35), 사람 확인 요청은 `helm_ask`·`needs_gate` 경로로 한다 |
| O-12-13 | 투영 머리의 `AGENTS.md` 등 프로젝트 지침을 넣을지 | 넣음 / 넣지 않음(도구로 읽게) | 넣음, 4,000 토큰 상한 |

## 8. 출처

- 브리프: `docs/design/process/00-design-brief.md` 결정 2, 12, 14, 15, 17, 22, 23, 27~31, 34, 36, §2.5, §3.
- pi 소스(`~/projects/_ref/pi-src`, 커밋 `cdaf6c2`) [원문]:
  - `packages/agent/src/agent-loop.ts`(`runAgentLoop`, `runAgentLoopContinue`, `runLoop`, `streamAssistantResponse`, `executeToolCalls*`, `prepareToolCall`, `executePreparedToolCall`, `finalizeExecutedToolCall`, `createToolResultMessage`, `failToolCallsFromTruncatedMessage`, `runToolCall`)
  - `packages/agent/src/types.ts`(`StreamFn` 계약 20-37행, `AgentLoopConfig` 193-342행, `AgentToolResult`·`AgentTool` 424-499행, `replay` 489-490행)
  - `packages/ai/src/types.ts`(메시지·`Usage`), `models.ts`(`createModels`, `calculateCost`, `clampThinkingLevel`), `auth/types.ts`(`CredentialStore`, `ApiKeyCredential`), `utils/retry.ts`, `utils/overflow.ts`, `utils/transcript.ts`, `api/transform-messages.ts`, `api/anthropic-messages.ts`(캐시 지점 1160-1192, 1478-1510행), `providers/model-schema.ts`(이미지 한도)
  - `packages/durable/docs/spec.md` §5.2(1917-1933행), §8.4(3869-3927행)
- 0단계 정리: `pi-api-facts-1.md`(0장, §2, §3, §4.7-4.8, §7, §9.3), `pi-api-facts-2.md`(0장, §1.3, §11), `pi-cases-notes.md`(§1, §3.5-3.6, §6.5, §7.5, §8.3-8.6, §10.5, §12), `conversation-extracts-1.md`(E1-053~054, E1-085, E1-100, Q8, Q11), `conversation-extracts-2.md`(X2-1-04~14, X2-6-07, X2-6-13~14, d-1, d-2), `conversation-extracts-3.md`(X3-3-11, X3-4-11, X3-5-03~04, X3-8-20~22), `conversation-extracts-4.md`(13-8~13-9, 14-12, 16-6~16-8, d21), `helm-canon.md`(§9.9, §11.9, §13.5, §13.10, §21 12항), `helm-canon-2.md`(§1.13, §1.21-1.22, §4.5, §4.7-4.8, §7.2, §9.10-9.11, §10 L11~L14, §11 12항), `helm-canon-3.md`(§7.2 G11, G15, G16, §21 12항).
- 사례 메모: `.helm-design-work/S4/openclaw-runtime.md`(§2.1-2.3, §3.1-3.3, §4.3, §5), `pi-fabric.md`(§5, §8, §9(b)·(c)), `pi-web.md`(§5, §9), `paseo.md`(§5-6, §8).
- v0.3: `docs/v0.3/08-runtime-architecture.md`(§2, §8-10), `12-implementation-architecture.md`(§5-8, §12), `14-alternative-structure.md`(§3-4), `audit/mastra-review.md`(§4-5, §9), `audit/backend-oss-research.md`(§1.2, §2.2-2.3).
- 다른 설계 문서(초안 시점): `06-system-architecture.md`(§2.3, §3.1-3.3), `10-kernel.md`(§3.1-3.7), `14-loops-modes-orchestration.md`(§3 LoopContract, ContextSection, ProposalKind), `15-inquiry-engine.md`(§2.3, §3.1.2), `16-observer-and-metrics.md`, `19-client-protocol.md`(P-08, P-11).

## ADR 후보

### ADR-12-01 모델 컨텍스트는 요청마다 로그에서 다시 만들고 상태 변화는 끝에 덧붙인다

- 상태: 제안
- 맥락: A11(컨텍스트는 시점별 투영)과 결정 29(기준 원본은 이벤트 로그)를 지키면서 프롬프트 캐시를 살려야 한다. pi-agent-core의 `prepareRequest`는 요청마다 컨텍스트를 바꿀 수 있지만 돌려준 배열을 루프가 변경한다.
- 결정: `prepareRequest`에서 매 요청 로그로 새 배열을 만든다. 상태 요약은 thread 시작의 snapshot과 이후 delta 주입 메시지로 끝에 덧붙인다. 앞부분을 바꾸는 작업은 컴팩션 때만 한다.
- 근거: 결정적 투영(재현·감사 가능), 덧붙이기만 하므로 직전 요청 끝까지 캐시 적중, pi 세션 저장과의 이중 기록 없음.
- 기각한 대안: (a) pi `Agent`의 메모리 대화 + `transformContext`로 상태 끼우기 — 메모리 상태와 로그가 두 벌이 된다. (b) 매 요청 끝에 상태 요약을 새로 써서 갈아끼우기 — 이전 요청의 끝이 사라져 대화 부분 캐시가 깨진다. (c) 시스템 프롬프트에 상태를 넣고 매번 갱신 — 캐시 전체가 깨진다.
- 결과: 주입 메시지가 대화에 쌓이므로 컴팩션이 이를 정리한다. 투영 manifest로 "모델이 무엇을 보았는가"를 요청마다 확인할 수 있다.

### ADR-12-02 도구 호출은 실행 직전 의도 커밋, 결과 직후 완료 커밋, 재시작 뒤 safe만 재실행

- 상태: 제안
- 맥락: 결정 30. pi-agent-core에는 내구성 기록이 없다. 사례(pi-fabric, happy-agent, openclaw)가 같은 규칙에 모였다.
- 결정: `beforeToolCall`에서 커널 판정과 의도를 한 트랜잭션으로 커밋한 뒤에만 실행한다. `afterToolCall`에서 결과를 first-writer-wins로 커밋한다. 재시작 뒤에는 의도 시점과 현재 선언이 모두 `replay: 'safe'`인 호출만 커널 재검사 후 다시 실행하고, 쓰기 도구는 파일 해시 guard로 판정한다. 나머지는 결과 불명으로 닫고 재개 첫 turn의 도구를 safe 도구로 좁힌다.
- 근거: 의도가 없으면 실행되지 않았다는 것이 확실하다. 해시 guard로 흔한 쓰기 도구의 중복·누락을 구분한다. 외부 효과는 사람이 해소한다.
- 기각한 대안: (a) 메시지 단위 체크포인트만(absurd pi 패턴) — 도구 실행 중 크래시를 구분 못 한다(cases §8.6). (b) 모든 도구 재실행 — 중복 외부 효과. (c) 재시작 때 모든 run 취소 — 클라이언트 없이 계속(결정 22)과 맞지 않는다.
- 결과: 도구마다 replay·guard·cancellation 선언이 필수가 된다(13). 크래시 시험(장애 주입)이 필요하다(22).

### ADR-12-03 사람 결정을 기다리는 동안 run을 끝내고, 승인된 행동은 런타임이 저장된 계획으로 실행한다

- 상태: 제안
- 맥락: 질문 답은 몇 시간·며칠 뒤에 올 수 있다(UC-03, UC-04). 대기 중 재시작, 답이 먼저 오는 경쟁, 승인 뒤 인자 변경 위험이 있다.
- 결정: `needs_gate`면 run을 `awaiting_human`으로 끝낸다(매달린 도구 호출 없음). 답·승인은 커밋된 이벤트이고 같은 thread의 새 run이 이어간다. 도구 승인은 의도 때 저장한 실행 계획(인자·지문)을 런타임이 실행하고 1회 소진한다.
- 근거: pi-web ask 패턴, absurd first-emit-wins, Mastra 실험의 실패 사례, OpenClaw의 승인 계획 고정.
- 기각한 대안: (a) 도구 호출 안에서 사람 답을 기다림 — 재시작에 약하고 매달린 호출이 생긴다. (b) 승인 뒤 모델이 같은 호출을 다시 냄 — 인자가 달라질 수 있다.
- 결과: 승인 레코드가 실행 계획을 가져야 한다(10·11). 모델은 승인 결과를 주입 메시지로 받는다.

### ADR-12-04 실행 소유권은 단일 데몬 + run attempt 펜싱 토큰으로 지키고 시간 lease를 두지 않는다

- 상태: 제안
- 맥락: 데몬은 하나다(결정 20·22, 17). OpenClaw는 claim·lease·fence·epoch·receipt가 겹쳐 순서 버그가 이어졌다(S4/openclaw-runtime §5).
- 결정: 프로세스 수준은 17의 단일 인스턴스 락, run 수준은 `(runId, attempt, bootEpoch)`를 쓰기 트랜잭션마다 행을 새로 읽어 대조한다.
- 근거: 1인용 단일 프로세스에서 생존 추정이 필요 없다. 늦은 비동기 콜백을 막는 데 충분하다.
- 기각한 대안: 시간 lease와 heartbeat(Mastra 10초 갱신·30초 만료) — 여러 워커가 없으면 비용만 든다.
- 결과: 워커 프로세스를 나중에 도입하면 lease가 필요해진다(이때 ADR 갱신).

### ADR-12-05 스케줄러는 단일 타이머 + 절대 시각, 도메인 타이머의 정본은 커널 상태

- 상태: 제안
- 맥락: 가정 만료, 기대 기한, 예측 확인일, 관찰 주기 등 재시작을 넘는 시각 계기가 많다(v0.3 08 §10). WSL은 일시정지·시계 점프가 있다.
- 결정: 메모리 힙 + `setTimeout` 하나(최대 60초). 도메인 타이머는 `pendingTimers(state)`로 다시 만들고, 시스템 타이머만 런타임 테이블에 둔다. 발화는 멱등 키를 가진 `timer.fire` 제출이다. 부팅 catch-up은 상한·간격·지연을 둔다.
- 근거: S4/openclaw-runtime §3.1, absurd `sleepUntil`, 10 §3.1.5.
- 기각한 대안: systemd 타이머로 개별 발화(호스트 의존, 도메인 타이머 수가 많음), 엔진 도입(Mastra·OpenWorkflow: 상태 저장소가 둘이 된다, mastra-review §0).
- 결과: 커널 상태 변경 뒤 효과로 힙을 갱신해야 한다. 경계 계기는 별도 제출(`boundary.reach`, 11)로 처리한다.
