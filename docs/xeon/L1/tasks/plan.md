---
id: L1.tasks.plan
layer: L1
domain: tasks
kind: plan
status: draft
depends_on: [L1.tasks.spec, eng.testing.guide, eng.toolchain.guide, eng.dependency-rules.guide]
binds: [xeon/packages/core-tasks/**]
---

# L1 태스크 엔진 구현 계획 (tasks)

대상 패키지는 `xeon/packages/core-tasks`다. 현재는 스캐폴드(`src/index.ts`, `test/smoke.test.ts`, `package.json`의 `"xeon": {"layer": "L1", "domain": "tasks"}`)만 있다. 이 문서는 계획만 정하고 코드는 고치지 않는다. 인터페이스와 동작은 `L1.tasks.spec`이 정본이다.

## 1. 목표와 마일스톤 배치

마일스톤 매핑은 `_research/layer-plan-v2.json` L1-a의 1차/2차 표시와 `product.scope.spec` §4.3을 근거로 한 [제안]이다.

| 마일스톤 | 범위 | L1-a 구성요소(계획 단계) |
|---|---|---|
| M0(선행, 다른 패키지) | `contracts`의 F 타입(`F.extensions`, `F.records`, `F.wire-settings`), `ext-host` 플러그인 API 최소형, `platform-store`·`core-persistence`의 커밋·투영 인터페이스. core-tasks 코드는 없다 | — |
| M1 걸어 다니는 골격 | 범위 트리와 취소(의도 기록, 정착 순서), steer·followUp 내구 큐(재개 시 복원), 멱등 post, 도구 병렬과 파일 직렬화(키 큐), 서비스 등록 | 범위 트리(1차), 취소 전파(1차), 병렬 도구 실행(1차), 내구 입력 큐 steer·followUp(1차) |
| M2 승인 통합과 Helm 서브에이전트 | 동시 상한 풀 세 개와 교착 방지, 설정 노출(`l1.tasks.*` 다섯 키), `next`·`aside` 모드, 서브에이전트 풀(Helm 렌즈 N개 탐구, UC-2) | 동시 실행 상한(1차), 내구 입력 큐 next·aside(1차) |
| 2차(M3 이후) | 수락과 완료 분리(ACP v2), 병렬 interrupt 다중 재개 | 수락과 완료 분리(2차), 병렬 interrupt 재개(`_research/packages.md` §4.3, 2차) |

- M1에 동시 상한을 넣지 않는 이유 [제안]: M1 도구는 `read`, `ls`, `bash` 셋이고 서브에이전트가 없다(`product.scope.spec` §4.3 M1). 상한이 없어도 M1 스모크는 성립한다. 교착 방지 규칙(C1~C4)은 서브에이전트가 들어오는 M2와 함께 시험한다.
- `next`·`aside`를 M2로 미루는 이유: F 계약이 맞지 않는다(`L1.tasks.spec` §4.9, FR-T4). M1에서는 `mode_not_supported`를 돌려준다.

## 2. 패키지와 파일 배치

```text
xeon/packages/core-tasks/
  package.json            # exports ".": "./src/index.ts", "./testing": "./src/testing/index.ts"
  src/
    scope.ts              # TaskScope 구현, 허용 부모 표, AbortSignal.any 연결, settle()
    limiter.ts            # Limiter, Slot, FIFO 대기열, suspendWhile (M2)
    keyed-queue.ts        # KeyedQueue (file-mutation-queue.ts 포크, shared/exclusive)
    input-queue.ts        # InputQueue: enqueue/peek/drain/withdraw/draftQueued, InputQueuePort 구현(TaskService.enqueue), 배치 선택 표, requestId 판정
    service.ts            # TaskService 조립: root, abort 순서, activity 집계, close()
    settings.ts           # defineSettings("l1.tasks", …) 다섯 키
    plugin.ts             # ext-host 플러그인 API로 xeon.tasks 등록, dispose → close() 연결
    index.ts              # plugin, settings 공개. 타입은 @xeon/contracts/services에서 온다
    testing/index.ts      # 다른 패키지 테스트용 memoryTasks(메모리 TaskService 가짜)
  test/
    scope.test.ts
    abort.test.ts
    limiter.test.ts
    keyed-queue.test.ts
    input-queue.test.ts
    input-queue.int.test.ts      # 실제 SQLite(platform-store testing)로 재시작 복원
    abort.fault.test.ts          # 의도 커밋 장애 주입
    settings.test.ts
    fixtures/
```

- 타입 위치: `TaskService`와 관련 타입, 서비스 이름 상수는 `@xeon/contracts/services`에 둔다(FR-T5) [결정: review.decisions-2 D-04]. core-tasks는 구현만 한다. 다른 L1 패키지가 core-tasks를 import하지 않게 하기 위해서다(`eng.dependency-rules.guide` DR-14).
- 서비스 등록은 ext-host의 플러그인 API로만 한다. `cordis` import는 금지다(ADR-0002 §3 4번, DR-07 `cordis` 행). Cordis Fiber 해제와 범위 트리의 연결은 `plugin.ts` 한 곳에만 둔다.
- 의존: `@xeon/contracts`(F), `@xeon/ext-host`(X, 플러그인 API). 테스트 전용 devDependencies: `@xeon/platform-store/testing`(테스트 파일에서만 import, DR-08·DR-14 예외 3). F에는 `./testing` 서브패스가 없다. 시계·ID 대역은 이 패키지 `test/` 안에 F `Clock`·`IdFactory` 인터페이스로 만든다 [결정: review.decisions-2 U-03].

## 3. 작업 분해

규모: S(반나절 이하), M(1~2일), L(3일 이상). 선행의 `M0:`은 다른 패키지 작업이다.

| id | 내용 | 선행 | 규모 | 마일스톤 |
|---|---|---|---|---|
| TK-0 | F 요청 반영 확인: `@xeon/contracts/services`의 `TaskService` 타입(FR-T5), `input.*`·`turn.abort_requested` 카탈로그 항목과 payload 스키마(FR-T1, FR-T2. F.records.spec §3.3에 있음), `TxView.inputByRequestId`·`queuedInputs`·`turnAbortRequested`(L1.persistence) | M0: contracts F.extensions·F.records 타입, M0: core-persistence 커밋 API | S | M1 착수 조건 |
| TK-1 | `scope.ts`: 범위 트리, 허용 부모 표(spec §4.1), `AbortSignal.any([부모, 자기])`, 백그라운드 노드의 root 연결, `track`, `settle()`(아래에서 위), `parent_settled`·`invalid_parent` Bug | TK-0 | M | M1 |
| TK-2 | `service.ts`의 `abort`: 의도 기록기 호출 → 커밋 → 신호 → cascade 의도 → `settle` 반환. `busy` 재시도(같은 요청), `lease_lost` 처리, `already_*` 상태, `{ background: true }` 순회. `close()` | TK-1, M0: core-persistence `commit` | M | M1 |
| TK-3 | `keyed-queue.ts`: `file-mutation-queue.ts` 포크. Chord 제거, 키 산출 제거(L1.tools.plan TL-17로 이전), 키별 FIFO와 shared/exclusive 상태, 다중 키 사전순 획득, 대기 중 취소 제거 | TK-1(owner 신호) | S | M1 |
| TK-4 | `limiter.ts`: 풀 세 개, FIFO, 대기 중 취소 제거, `suspendWhile`, C4 재진입 Bug, 설정 값 변경 반영(새 획득부터) | TK-1, TK-6(설정 읽기) | M | M2 |
| TK-5 | `input-queue.ts`: `enqueue`(커밋 안 requestId 판정, 출처 키, 신원만 담는 지문, 확장 post도 `input.queued` 하나, `post.accepted`는 retire(review.decisions-2 U-05)), `TaskService.enqueue`(`InputQueuePort`), `draftQueued`, `peek`(투영 읽기), `drain`(배치 선택 표, `consumedSeq`, `drafts`), `withdraw`, `onQueued`(커밋 후 알림) | TK-0, M0: platform-store·core-persistence 투영 인터페이스 | M | M1(steer·followUp), M2(next·aside) |
| TK-6 | `service.ts` 조립과 `settings.ts`(`l1.tasks.*` 다섯 키, D1~D9), `plugin.ts`(ext-host 플러그인 API로 `xeon.tasks` 제공, `xeon.session` 주입, dispose → `close()`), `activity()`·`onActivity` | TK-1, TK-2, TK-3, TK-5, M0: ext-host 플러그인 API | S | M1(서비스), M2(limits 키 노출) |
| TK-7 | 재개 시 큐 복원: 열 때 `p_inputs` 재읽기, `consumedSeq` 일관성 검사와 진단, 자동 재개 꺼짐일 때 queued 유지 | TK-5, M0: core-persistence 열 때 복구 | S | M1 |
| TK-8 | `next`·`aside` 모드: `L1.tasks.spec` §4.9 결정 반영(B안이면 stepEnd `continuing` 규칙과 turnStart 부착) | TK-5, 사용자 결정(§4.9 [미결]) | S | M2 |
| TK-9 | 서브에이전트 풀 연결 시험: core-agents와 함께 렌즈 N개 탐구 테이프로 `subagents`·`modelCalls` 기본값 조정 | TK-4, L1.agents.plan의 자식 실행 | M | M2 |
| TK-10 | 수락과 완료 분리(2차): queued 입력의 수락 알림, `input.placed`·`input.withdrawn` 클라이언트 표시 규칙(F.wire-settings와 함께) | TK-5 | M | 2차 |
| TK-11 | 병렬 interrupt 다중 재개(2차): 한 단계의 여러 승인 대기를 id별 응답 맵으로 한 번에 재개(LangGraph, durable `waiting` + allSettled) | L1.tools 승인 프로토콜 | M | 2차 |

순서: TK-0 → TK-1 → (TK-3, TK-5) → TK-2 → TK-6 → TK-7 → (M2) TK-4 → TK-8 → TK-9.

### 3.1 M2 구현 상태 (2026-10-24, 레인 L1B)

| id | 상태 | 위치 |
|---|---|---|
| TK-4 | 완료 | `limiter.ts`(FIFO, 대기 중 취소, C4 재진입 Bug, `suspendWhile`, 상한은 얻을 때마다 읽음), `service.ts`(풀 세 개) |
| TK-6(M2) | 완료 | `settings.ts`(`limits.tools`·`subagents`·`modelCalls` 추가, `TasksSettingsSource.limit(pool)`) |
| TK-8 | 완료 | `input-queue.ts`(`drain`의 next·aside 배치, `aside` 사용자 전용, `onQueued` 시작 가능 모드만). 결정 D7: B안 + aside 1안, F `PostWhen` 변경 없음 |
| TK-9 | 완료(풀 단위) | `limiter.test.ts`의 서브에이전트 풀 시험(렌즈형 자식 8개/상한 3, 부모 취소 때 대기열 비움). 렌즈 N개 탐구 테이프로 기본값을 조정하는 일은 HM 통합 때 한다 |

## 4. 채택 코드

| 대상 | 방식 | 정확한 출처 | 바꿀 점 |
|---|---|---|---|
| 같은 파일 직렬화 큐 | 포크 | `~/projects/_ref/pi-src/packages/durable/src/tools/file-mutation-queue.ts`(pi 커밋 `cdaf6c2`, 55줄, MIT) | (1) `import type { Context } from "@earendil-works/chord"`와 `context` 인자를 지우고 `owner: TaskScope`의 신호로 대체(ADR-0003 `CancelScope` 치환과 같은 목적) (2) `mutationKey`·`canonical`(7-26행)은 L1.tools로 옮김(키 산출은 L1.tools.plan TL-17) (3) 꼬리 사슬 `Map<string, Promise<void>>`를 키별 FIFO와 shared/exclusive 상태로 바꿈 (4) 다중 키 사전순 획득 (5) 대기 중 취소 제거. 파일 머리에 원본 경로·커밋·라이선스를 적는다 |
| 큐 모드 의미 | 참고만 | agent-core `PendingMessageQueue`(`~/projects/_ref/pi-src/packages/agent/src/agent.ts:143-174`, `@earendil-works/pi-agent-core` 1.3.0과 바이트 동일, `_research/notes/L1-1.md` §2) | 코드는 가져오지 않는다. `one-at-a-time`은 첫 항목, `all`은 전부(`peek`·`drain`, 159-169행) 의미만 따른다. DR-07상 core-tasks는 agent-core를 import할 수 없다 |
| 배치 선택 규칙 | 참고만 | durable `src/harness/inbox.ts` `applyBoundary`(같은 커밋 기준), `docs/spec.md` 2297-2321 | 지점별 steer·followUp 선택을 Xeon 지점(`turnStart`, `stepEnd`)으로 옮긴다. write 항목과 head·stale 규칙은 가져오지 않는다 |
| 소유 트리·취소 순서 | 설계 근거 | durable `docs/spec.md` 1972-2060(§5.4), 2156-2200(§5.5) | 코드 없음. 의도 → 신호 → 정착(아래에서 위)만 따른다 |
| 범위 해제 트리 | 참고만 | `xeon/vendor/cordis` Fiber(`fiber.ts:103`, 273-338, 453-463) | import하지 않는다(ADR-0002). 플러그인 dispose 연결만 `plugin.ts`에서 ext-host API로 한다 |
| 외부 npm 패키지 | 없음 | — | `typebox`(설정 스키마)는 소유 제한이 없다(DR-07 표 아래 항목) |

## 5. 단위 테스트 목록

모든 테스트는 수동 시계와 고정 IdFactory를 쓴다(`eng.testing.guide` TS-03). 실제 시간을 기다리지 않는다.

| 테스트 이름 | 파일 | 확인할 동작 | 마일스톤 |
|---|---|---|---|
| `scope_abort_cascades_to_children` | `abort.test.ts` | turn을 abort하면 tool 노드, 소유 subagent 노드, 그 아래 turn·tool의 `signal`이 모두 켜지고 `settled`는 자식이 모두 정착한 뒤 이행한다(spec §9-1) | M1 |
| `background_scope_survives_parent_abort` | `abort.test.ts` | `background: true` subagent는 부모 thread·turn abort에도 신호가 켜지지 않고, `{ background: true }` abort에는 켜진다(spec §9-2) | M1 |
| `abort_intent_recorded_before_signal` | `abort.fault.test.ts` | 의도 커밋 성공 뒤에만 신호가 켜진다. `before_commit` 장애 주입이면 신호가 켜지지 않고 이벤트가 없다. 이벤트 열에서 `turn.abort_requested` seq < 같은 turn의 `effect.result`·`turn.completed` seq(spec §9-3) | M1 |
| `abort_twice_returns_already_aborting` | `abort.test.ts` | 두 번째 abort는 `already_aborting`이고 의도 이벤트는 하나 | M1 |
| `settle_order_bottom_up` | `scope.test.ts` | 손자 → 자식 → 부모 순서로 `settle()`이 이행한다 | M1 |
| `open_scope_rejects_invalid_parent` | `scope.test.ts` | 허용 부모 표 밖 조합과 `thread` 아래 비백그라운드 subagent는 Bug | M1 |
| `keyed_queue_serializes_same_realpath` | `keyed-queue.test.ts` | 같은 키 exclusive 두 작업의 실행 구간이 겹치지 않고, 다른 키 두 작업은 겹친다(spec §9-8) | M1 |
| `keyed_queue_shared_then_exclusive` | `keyed-queue.test.ts` | 같은 키 shared 둘은 겹치고 뒤의 exclusive는 둘이 끝난 뒤 시작한다. exclusive 대기 중 뒤의 shared는 기다린다 | M1 |
| `keyed_queue_abort_removes_waiter` | `keyed-queue.test.ts` | 대기 중 owner 취소 시 대기열에서 빠지고 `AbortReason`으로 거부된다 | M1 |
| `keyed_queue_multi_key_no_deadlock` | `keyed-queue.test.ts` | 키 집합 {a,b}와 {b,a}를 동시에 요청해도 둘 다 끝난다(사전순 획득) | M1 |
| `post_duplicate_request_id_enqueues_once` | `input-queue.int.test.ts` | 같은 (thread, 출처, requestId) 두 번이면 내용이 달라도 `input.queued` 하나, 두 번째 `duplicate: true`, 같은 `inputId`, `key_reused` 없음(spec §9-4) | M1 |
| `post_same_request_id_other_source_is_distinct` | `input-queue.int.test.ts` | 사용자와 확장이 같은 문자열 requestId를 써도 각각 들어간다 | M1 |
| `queue_restored_after_restart` | `input-queue.int.test.ts` | queued 두 건을 커밋하고 저장소를 닫았다 다시 열면 `peek`가 같은 두 건을 같은 순서로 돌려준다(spec §9-7) | M1 |
| `steer_vs_followup_drain_order` | `input-queue.test.ts` | `stepEnd`에서는 steer만 고르고(one-at-a-time이면 첫 항목, all이면 전부) followUp은 고르지 않는다. `turnStart`에서는 가장 오래된 steer·followUp 하나를 고른다(spec §9-9) | M1 |
| `drain_consumed_seq_matches_selection` | `input-queue.test.ts` | `consumedSeq`가 선택한 입력의 최대 seq이고 선택이 없으면 직전 값 | M1 |
| `withdraw_skips_placed_inputs` | `input-queue.int.test.ts` | placed 입력은 거두지 않고 수에 세지 않는다 | M1 |
| `next_attached_only_when_continuing` | `input-queue.test.ts` | §4.9 B안(결정 D7): `stepEnd`에서 `continuing: true`이거나 steer를 방금 골랐을 때만 `next`·`aside`를 함께 고르고, 아니면 남긴다. 유휴 thread는 `turnStart`에서 시작 가능 입력이 있을 때 그보다 앞선 것만 붙는다. `onQueued`는 steer·followUp에만 부른다(TK-8) | M2 |
| `aside_mode_per_decision` | `input-queue.test.ts` | 결정 D7 1안: 사용자·CLI 입력만 `aside`로 들어가고 확장·위임·예약 출처는 `mode_not_supported`다(TK-8) | M2 |
| `limiter_blocks_over_cap_and_dequeues_on_abort` | `limiter.test.ts` | 상한 2에서 세 번째 acquire가 대기하고, owner 취소 시 대기열 0, `AbortReason` 거부. 반납 시 FIFO 다음 대기자가 얻는다(spec §9-5) | M2 |
| `limiter_no_deadlock_parent_waits_child` | `limiter.test.ts` | `tools`·`subagents` 상한 1, 깊이 3 사슬(도구 → 자식 → 도구 → 손자)이 `suspendWhile`로 모두 정착한다(spec §9-6) | M2 |
| `limiter_slot_reentry_is_bug` | `limiter.test.ts` | 같은 노드가 같은 풀 슬롯을 두 번 얻으면 Bug(C4) | M2 |
| `limiter_capacity_change_applies_to_new_acquire` | `limiter.test.ts` | 상한을 줄여도 쥔 슬롯은 유지되고 새 획득부터 적용 | M2 |
| `settings_defs_pass_checks` | `settings.test.ts` | 다섯 키가 `checkSettingDef`, `buildCatalog`를 통과하고 키·기본값·range가 spec §6 표와 같다(spec §9-10) | M1(queue 키), M2(limits 키) |

## 6. 완료 기준

- §5의 해당 마일스톤 테스트가 모두 통과한다.
- `cd xeon && just verify` 종료코드 0. 종료코드 2(환경 문제)면 코드를 고치지 않고 보고한다.
- `check-layers`와 dependency-cruiser에서 core-tasks가 다른 `@xeon/core-*`, `cordis`, `@earendil-works/*`를 import하지 않는다(spec §9-11, DR-07, DR-14).
- `docs-route --check`가 이 문서와 spec의 `binds`, `depends_on`을 해석한다.
- M1: `L1.loop.plan`의 M1 스모크(모델 테이프 한 턴, 강제 종료 뒤 재개)에서 큐 입력이 복원되고 turn 취소가 정착한다.
- M1: "도구 병렬과 파일 직렬화(키 큐)"의 사용 쪽은 core-tools다. 잠금 키 산출과 `locks.run` 호출은 `L1.tools.plan` TL-17이 구현하고 `same_realpath_writes_serialized`로 확인한다. 이 패키지는 `KeyedQueue` 자체(TK-3)만 맡는다.
- M2: 설정 화면 생성기(`L4.settings-ui.spec`)가 execution 탭에 다섯 항목을 낸다.

## 7. 위험과 대응

| 위험 | 대응 |
|---|---|
| 소유 트리 모델(dur)과 Cordis Fiber 해제 순서가 다르다. Fiber 최상위 effect 해제는 서로 기다리지 않는다(ADR-0002 §3.1 scope 행) | 범위 트리는 core-tasks가 따로 가진다. Fiber와의 연결은 `plugin.ts` 어댑터 한 곳에서만 한다. dispose 때는 `close()`(신호만, 의도 없음) 하나를 부른다 |
| 상한 기본값의 근거가 약하다(`modelCalls` 16은 선례 없음) | 설정으로 연다. M2에서 렌즈 N개 탐구 테이프(TK-9)로 조정하고 spec §6 표를 고친다 |
| `aside`·`next`의 F 계약이 맞지 않는다(`PostWhen`에 aside 없음, next 시작 여부 미정) | F 요청 사항(FR-T4)과 [미결]로 올린다. M1은 구현하지 않고 `mode_not_supported`를 돌려준다 |
| F 코드 반영(FR-T1, FR-T2의 카탈로그 코드, FR-T5)이 늦으면 M1이 막힌다 | TK-0을 착수 조건으로 둔다. 다른 L1 패키지가 core-tasks를 직접 import하는 임시 우회는 하지 않는다(DR-14) |
| `TxView` 메서드가 L1.persistence에 없으면 커밋 안 중복 판정을 못 한다 | L1.persistence.plan에 요구를 올린다. 없을 때 커밋 밖 사전 조회로 대신하지 않는다(경쟁 조건) |
| cascade 의도 커밋이 크래시로 빠진다 | 재개 판정이 소유 사슬에서 도출한다(spec §4.8 3항). `abort.fault.test.ts`에 cascade 전 끊김 경우를 넣는다 |
| 키 큐가 프로세스 밖(`bash`, 다른 프로세스)의 쓰기를 막지 못한다 | 원본과 같은 한계로 문서에 둔다. 다중 프로세스 쓰기는 세션 잠금(L0.process, ADR-0006)이 막는다 |
