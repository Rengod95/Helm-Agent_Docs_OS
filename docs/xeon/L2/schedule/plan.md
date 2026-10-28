---
id: L2.schedule.plan
layer: L2
domain: schedule
kind: plan
status: draft
depends_on: [L2.schedule.spec, F.capabilities.plan, L0.process.plan, L0.os.plan, L1.agents.plan]
binds: [xeon/packages/cap-schedule/**]
---

# L2 예약과 백그라운드 구현 계획 (schedule)

`L2.schedule.spec`을 `xeon/packages/cap-schedule`(`@xeon/cap-schedule`)와 F 정의 파일로 옮기는 계획이다. 절 번호(§)는 따로 적지 않으면 그 스펙의 것이다.

## 1. 목표와 마일스톤 배치

마일스톤 정의는 `product.scope.spec` §4.3을 따른다. M0·M1은 [결정: `_research/foundation-plan.md` §5 P4], M2·M3 배치는 [제안]이다.

- `product.scope.spec` §4.1 I13에 따라 예약, 원격, 알림은 M3다. 이 패키지의 전체 범위가 M3다.
- 계획 v2(`_research/layer-plan-v2.json` L2-h)의 단계 표기는 루프와 웨이크업, 백그라운드 작업 모니터, 다중 세션 관리가 2차이고, 예약 실행과 원격 제어가 보류다.[^v2] 3차 결정이 예약·원격·알림을 범위에 넣었으므로(`_research/decisions-log.md` 2026-10-21 결정(3차)) 이 계획은 다섯 능력 모두를 M3에 둔다. 루프는 서비스 모드가 필요 없지만 `cap-schedule` 묶음으로 함께 만든다(`product.scope.spec` §4.1 아래 해설).

[^v2]: `product.scope.spec` §4.1 I4 해설: "3차 결정이 범위에 넣은 항목(공유 서비스 모드, 예약 실행, 원격 제어, 사용자 알림)은 JSON 표기가 '2차' 또는 '보류'여도 1차로 본다." layer-plan-v2.json과 3차 결정이 다르면 3차 결정을 따른다. 루프·모니터·다중 세션의 '2차' 표기는 3차 결정이 직접 다루지 않았지만, 같은 패키지로 묶기 위해 M3로 당긴다 [제안].

### 1.1 M0·M1·M2

- 이 패키지의 구현 작업은 없다. 스캐폴드(`package.json`, `src/index.ts`, `test/smoke.test.ts`)는 P0에서 이미 있다.
- M2에 하는 일은 H1(F 정의와 카탈로그)뿐이다 [제안]. Helm(M2)이 `schedule.timers` 정의를 참조해 컴파일될 수 있게 하려는 것이다. 정의만 있고 provider가 없으면 Helm은 선택 의존으로 건너뛴다.

### 1.2 M3 내부 순서

| 순서 | 묶음 | 작업 | 서비스 모드 | 선행 |
|---|---|---|---|---|
| S1 | 앱 프로세스 안에서 도는 루프·웨이크업·세션 목록 | H2, H3, H5 | 필요 없음 | `L1.tasks` post, `L0.os` 타이머, `L1.persistence` 커밋 |
| S2 | 작업 상태 분류와 감시 | H4 | 필요 없음(분리 실행만 필요) | `L0.process` 레지스트리, `L1.agents` 백그라운드 위임 |
| S3 | 서비스 모드 위의 예약 실행 | H6, H7, H8, H9 | 필요 | `L4.host-service` 서비스 모드(SV-01~SV-08), `L0.store` 임대 |
| S4 | 원격 승인 중계 | H10 | 필요 | `L4.host-service` 원격 연결 인증(로컬 소켓 + SSH 터널·사설망) |

- H11(설정 키)은 S1부터 묶음마다 그 묶음의 키를 더한다.
- S1·S2는 서비스 모드와 무관하게 끝낼 수 있다. S3는 `L4.host-service.plan` §1.4(M3 서비스 모드)와 같은 시기에 진행한다. 서비스 모드가 늦어지면 S3의 틱 루프(H7)는 앱 호스트 모드(`startTick({ mode: "app" })`)로 먼저 검증한다.
- S4는 M3에 둔다 [결정: review.decisions-2 U-11]. 원격 연결은 로컬 서비스 소켓을 SSH 터널이나 사설망으로 잇는 방식이고, 내장 TLS + 토큰 WebSocket 전송은 2차다.

### 1.3 M3 이후(2차)

- OS 서비스 등록 뒤 재부팅 자동 시작(`product.scope.spec` §4.2 N3). 이 패키지의 변경은 없다. 재부팅 직후 놓친 실행 처리(§4.4.4)가 이미 들어 있다.
- 기존 세션을 대상으로 하는 예약(spec §10 미결 12), 모바일 푸시(spec §10 미결 3).

## 2. 패키지와 파일 배치

```
xeon/packages/contracts/src/
  capabilities/defs/schedule.ts       # H1. 정의 5개와 공통 스키마(spec §3.1~§3.6)
  records/catalog/schedule.ts         # H1. SCHEDULE_EVENT_CATALOG, payload 스키마(spec §3.7)

xeon/packages/cap-schedule/
  package.json             # exports ".", "./host", "./testing". xeon { layer: "L2", domain: "schedule" }
  tsconfig.json
  migrations/
    0001_cap_schedule.sql  # 세션 밖 테이블(cap_schedule_timers, cap_schedule_runs). scoped 핸들로 적용
  src/
    index.ts               # 플러그인 진입: 매니페스트, provider 등록, 투영기 등록, 설정 그룹
    manifest.ts            # provides 5개, optional [work.goals]
    settings.ts            # defineSettings("l2.schedule", …)  (H11)
    context.ts             # CallContext 해석, requestId 파생(loop:, wake:, watch:, timer:)
    loops/
      model.ts             # 종료 조건 판정, 상한·만료, 판정 순서(순수)  (H2)
      runner.ts            # 반복 상태 기계, agent_settled 연결, 재시작 정리  (H2)
      shell-condition.ts   # 셸 조건 실행 포트(xeon.exec)  (H2)
      wakeup.ts            # 웨이크업 대체 규칙, 투입  (H3)
      service.ts           # start, stop, status, list, wakeup, done
    jobs/
      classify.ts          # 출처별 4상태 분류(순수)  (H4)
      adapters.ts          # L0.process, L1.agents 어댑터  (H4)
      watch.ts             # 감시, regex 부분 집합 검사(순수)  (H4)
      service.ts           # spawn, list, status, stop, watch, unwatch
    sessions/
      runtime.ts           # 세션 실행 상태 계산(순수)  (H5)
      service.ts           # list, create, worktreeCreate/List/Remove  (H5)
    timers/
      cron.ts              # cron 해석·다음 기한 계산 래퍼(H6 채택 결과를 경계에서 감쌈)
      due.ts               # 놓친 실행 정책 표, 최소 간격, 시간당 상한(순수)  (H8)
      store.ts             # cap_schedule_timers·runs 읽기·쓰기(scoped)  (H6)
      service.ts           # create, list, cancel, runs  (H6)
    tick/
      host.ts              # SchedulerHost, createSchedulerHost(spec §3.9)  (H7)
      lease.ts             # scheduler 임대 획득·하트비트·펜싱 감쌈  (H7)
      tick.ts              # 틱 절차(spec §4.4.3)  (H7)
      run.ts               # 실행 시작·복구·결과·워치독(spec §4.4.5)  (H9)
    remote/
      policy.ts            # 원격 답 정책(순수)  (H10)
      pending.ts           # 대기 요청 요약(마스킹 규칙)  (H10)
      service.ts           # status, pending, respond  (H10)
    projection/
      ddl.ts               # 세션 투영 테이블 DDL(spec §3.8)  (H2, H4)
      projector.ts         # Projector "cap.schedule"
    testing/
      index.ts             # fakeScheduleDeps(가짜 tasks·session·agents·process·os·lease 포트), 시계 도우미
  test/
    *.test.ts              # §5 목록
```

- 세션 밖 테이블은 마이그레이션 파일 하나로 둔다. 적용 방식(scoped 핸들의 마이그레이션 API)은 `L0.store.spec`을 따른다 [가정].
- `./host` 서브패스는 `SchedulerHost`만 연다. `apps/host`(조립 루트)만 import한다.
- 같은 층 패키지(`cap-work`, `cap-dialog`)를 import하지 않는다(DR-02). `work.goals`는 `ServiceKey`로만 쓴다.

## 3. 작업 분해

규모: S(1일 이하), M(2~3일), L(4일 이상).

| id | 내용 | 선행 | 규모 | 순서 |
|---|---|---|---|---|
| H1 | F `defs/schedule.ts` 정의 5개와 공통 스키마, 서비스 묶음 `ScheduleService`·`ScheduleServiceName`·`SCHEDULE_CAPABILITIES`(spec §3.11), F `records/catalog/schedule.ts` 15종 카탈로그(`CatalogEntry`, `F.records.spec` §3.3.2). ID 접두 `lop`·`wak`·`tmr`·`wch`는 F.conversation §3.2.1 `LocalIdPrefix`를 쓴다. 함께 요청할 F 변경: 도구 없는 능력 허용. `schedule` 영역, `TYPE_PREFIX_OWNERS` 행, `CallOptions.context`는 F에 이미 있으므로 확인만 한다. `validateCapability` 0건 테스트 | `F.capabilities.plan` M0, `F.records.plan` M0 | M | M2 |
| H2 | loops 모델: 종료 조건 4종 판정과 순서, 상한·만료, 반복 상태 기계, 셸 조건 실행 포트, `schedule.loop_*` 커밋, 투영(`cap_schedule_loops`), 재시작 정리 | H1, `L1.persistence.plan` 투영기 등록 | M | S1 |
| H3 | `schedule_wakeup`·`loop_done` 도구와 post 연결: 웨이크업 대체 규칙, 정착 대기 뒤 투입, `wake:`·`loop:` 키, `interval.self` | H2, `L1.tasks` post | S | S1 |
| H4 | jobs: 출처별 4상태 분류, 승인 대기 보조 투영, L0.process·L1.agents 어댑터, `spawn`·`stop`, 감시와 regex 부분 집합 검사, `schedule.watch_*` | H1, `L0.process.plan` 레지스트리·출력 구독, `L1.agents.plan` 백그라운드 위임 | M | S2 |
| H5 | sessions: 실행 상태 목록(소유자 표시, 상태, 작업 수), `create`(워크트리 포함), 워크트리 연산 3개와 도구(기본 꺼짐) | H1, `L0.os.plan` 워크트리 연산, `L1.persistence` 세션 생성·소유 표시 조회 | S | S1 |
| H6 | timers 저장(`cap_schedule_timers`, `request_id` 멱등)과 cron 파서 선택: 후보 비교 뒤 정확 버전 고정(§4.1), cron·at 다음 기한 계산, 시간대·일광 절약 규칙, `create`·`list`·`cancel`·`runs`와 도구 3개 | H1, `L0.store` scoped 핸들 | M | S3 |
| H7 | 틱 루프와 `sys_leases` `scheduler` 임대: `SchedulerHost`, 획득·하트비트·펜싱, 틱 절차, `pendingSchedules`·`liveSchedulerTasks`, `startTick` 모드(service, app) | H6, `L0.store.plan` 임대 API, `L4.host-service.plan` HS-39·HS-40 | M | S3 |
| H8 | 놓친 실행·중복 방지: 정책 표(`skip`·`once`·`all`), 따라잡기 상한, 최소 간격, 시간당 상한, claim 기본 키와 펜싱 | H6, H7 | S | S3 |
| H9 | 예약 세션 생성과 결과 전달: 세션 생성 키, `run_started`(origin 표식), 프롬프트 post(`timer:` 키), 재시작 복구, `run_finished`, 워치독(600초) | H7, H8, `L1.persistence` 세션 생성 `creationKey`(§4.10.1) | M | S3 |
| H10 | remote 승인 중계: 정책 검사, 대기 요청 요약(마스킹), `respond` → `xeon.approvals`, `schedule.remote_responded`, host 연결 지점 | H1, `L4.host-service` 원격 연결 인증(U-11) | S | S4 |
| H11 | 설정 키 `l2.schedule.*`(spec §6)와 도구 노출 키 연결, `whenServiceOff`·`ensureOnCreate` 동작 | H1 | S | S1~S4 |

선행 관계 요약: H1 → (H2 → H3), H4, H5, H6 → H7 → H8 → H9, H10. 다른 층 선행은 `L0.process`(H4), `L1.agents`(H4), `L4.host-service` 서비스 모드(H7, H9)와 원격 연결 인증(H10)이다.

## 4. 채택 코드

### 4.1 조사 항목: cron 표현식 파서

`_research/packages.md`에는 cron 파서 판정이 없다(L2-e "크론과 스케줄 | 설계/보 | 설계 | hermes `cron/` | 보류 유지", 271행). 그래서 H6의 첫 일로 아래 후보를 비교하고 하나를 정확 버전으로 고정한다. 버전은 2026-10-21 `npm view` 결과이며 채택 전에 다시 확인한다.

| 후보 | 버전 | 라이선스 | 의존 | 확인할 것 |
|---|---|---|---|---|
| `croner` | 10.0.1 | MIT | 없음 | 5필드 모드 고정 옵션, 일·요일 OR 규칙(spec §4.4.2), `Intl` 기반 시간대 계산의 일광 절약 처리, Bun 1.4에서 테스트 통과, `bun build --compile` 산출물에 포함 |
| `cron-parser` | 5.10.2 | MIT | `luxon` ^3.7.2 | 같은 항목 + 전이 의존 `luxon`의 정확 고정 가능 여부와 번들 크기 |
| 자체 구현 | 없음 | 없음 | 없음 | 5필드 해석(약 200줄)과 시간대 다음 기한 계산(약 200줄). 일광 절약 경계 테스트를 직접 써야 한다 |

- 판정 기준: (1) spec §4.4.2 규칙을 옵션으로 맞출 수 있다, (2) 전이 의존이 없거나 정확 고정할 수 있다, (3) 가짜 시계로 테스트할 수 있다(현재 시각을 인자로 받는 API), (4) 유지 상태.
- [제안] 의존이 없는 `croner`를 먼저 검증한다. 어느 패키지든 `timers/cron.ts`에서 감싸 경계 밖으로 패키지 타입이 나가지 않게 한다(`eng.context-map.design` CM-03).
- 내려받은 패키지의 코드를 문서 작성 단계에서 실행하지 않았다. 검증은 H6에서 워크스페이스에 추가한 뒤 테스트로 한다.

### 4.2 그대로 쓰는 패키지

| 패키지 | 버전 | 라이선스 | 쓰는 곳 |
|---|---|---|---|
| `typebox` | 1.3.27 (워크스페이스 catalog) | MIT | 정의(F), 입력 검사 |

- regex 부분 집합 검사(spec §4.2.3)는 패키지를 쓰지 않는다. 역참조(`\1`), 전후방 탐색(`(?=`, `(?!`, `(?<=`, `(?<!`)과 중첩 수량자를 거부하는 작은 검사기를 직접 둔다 [제안].

### 4.3 설계 이식(코드를 가져오지 않음)

| 원본 | 경로·근거 | 가져오는 것 | 바꿀 점 |
|---|---|---|---|
| Hermes `cron/` | `cron/jobs.py`(저장, 원자 쓰기, 프로세스 간 잠금), `cron-internals.md`(60초 틱, 잡마다 새 에이전트), `cron/AGENTS.md`(유휴 600초 워치독), `cron/scheduler_provider.py`(놓친 잡 되살리기)(`_research/refs/hermes.md` §3.10.4) | 잡마다 새 세션, 워치독 규칙, 놓친 잡 처리 | JSON 파일 대신 SQLite 테이블, 파일 잠금 대신 `sys_leases` 임대·펜싱, 틱 15초 |
| Claude Code `CronCreate`·`ScheduleWakeup`·`/loop` | `_research/refs/claude-code.md` 148~149행(세션 범위 크론, 7일 만료, Stop 훅의 `session_crons`), `_research/l2e.md` §3.4 D1·D2 | 웨이크업 도구 모양, 세션 범위 루프, 만료 기본값 | 세션 범위 크론은 루프·웨이크업으로, 세션 독립 예약은 `timers`로 나눈다 |
| omp `/loop` | `_research/l2e.md` §3.4 D2("/loop, --until 셸 조건, 한도") | 셸 종료 코드 조건과 반복 한도 | 4종 조건과 판정 순서를 계약으로 고정 |
| Warp Request 이벤트 | `_research/l2e.md` §7 | "입력 필요" 한 상태로 묶기 | 승인 이벤트에서 파생 |

## 5. 단위 테스트 목록

`eng.testing.guide`를 따른다. 시계는 `manualClock`, ID는 `fixedIdFactory`, 저장은 `openTestStore`(실제 `bun:sqlite`)다. 프로세스(`L0.process`), 위임(`L1.agents`), 입력 큐(`L1.tasks`), 셸 실행(`fakeExec`), 타이머·파일 감시·워크트리(`L0.os`), 네트워크(원격 연결)는 모두 가짜다. 테스트 안에서 실제 시간을 기다리지 않는다(TS-03).

### 5.1 정의 (H1)

| 테스트 | 확인할 동작 |
|---|---|
| `defs.validate.test.ts` › 다섯 정의 이슈 0건 | `validateCapability` 경고 포함 0건(수용 기준 6) |
| › 집합 충돌 없음 | 다른 L2 정의와 함께 `validateCapabilitySet`에 `tool_name_conflict` 없음 |
| › toInput·toContent 순수성 | 같은 입력 반복 호출이 같은 출력 |
| › schedule_create cron·at 둘 다 | `toInput` 결과가 메서드 입력 검사에서 `invalid_input` |
| `catalog.test.ts` › kind 형식과 소유 | 15종이 `schedule.` 접두, `owns("cap.schedule", kind)` 참 |

### 5.2 cron·at 계산 (H6) — 가짜 시계

| 테스트 | 확인할 동작 |
|---|---|
| `cron.test.ts` › 매시 정각 | `0 * * * *`의 다음 기한이 다음 정각 |
| › 일·요일 OR | `0 9 1 * MON`이 1일과 월요일 모두에 실행 |
| › 시간대 고정 | `tz: "Asia/Seoul"` 타이머가 시스템 시간대를 바꿔도 같은 기한 |
| › 봄 일광 절약 | 건너뛴 02:30 기한이 다음 유효 시각으로 미뤄짐(`America/New_York`) |
| › 가을 일광 절약 | 두 번 나오는 01:30에 한 번만 실행 |
| › 미지원 문법 | 6필드, `@reboot`, `L`이 `cron_invalid`, `detail.field` |
| › at 과거 | `at_in_past` |
| › at 한 번 실행 | 실행 뒤 `enabled = 0`, `next_due_at = NULL` |
| › 최소 간격 | `*/1 * * * *`가 `interval_clamped` 경고, 틱이 300초 안의 기한을 `skipped(min_interval)` |
| › create 멱등 | 같은 `requestId` 두 번에 타이머 하나 |
| › 상한 | `maxActive` 초과 `timer_limit_reached` |

### 5.3 놓친 실행 정책 표 (H8)

| 테스트 | 확인할 동작 |
|---|---|
| `due.test.ts` › skip | 놓친 기한 5개가 모두 `skipped(missed)`, 실행 0 |
| › once | 놓친 기한 5개 중 마지막 하나만 실행(`missed: true`), 나머지 `skipped` |
| › once + 제때 기한 | 제때 기한만 실행, 놓친 것은 모두 `skipped` |
| › all | 오래된 순으로 실행, `maxCatchUpRuns` 초과분 `skipped` |
| › 따라잡기 시간 상한 | 25시간 전 기한은 정책과 무관하게 `skipped` |
| › 늦음 유예 | 기한 + 119초는 제때, + 121초는 놓침 |
| › 시간당 상한 | 21번째 실행이 `skipped(rate_limited)` |
| › 다음 기한 | 처리한 마지막 기한 뒤 `now` 이후 첫 기한 |

### 5.4 임대 경합 (H7, H8)

| 테스트 | 확인할 동작 |
|---|---|
| `lease.test.ts` › 두 틱 프로세스 | 같은 `openTestStore` 파일을 연 두 `SchedulerHost` 중 하나만 `holding: true` |
| › 한 기한 한 실행 | 두 호스트가 같은 시각에 claim을 시도해도 `cap_schedule_runs` 행 하나, 세션 생성 호출 하나, post 하나(수용 기준 3) |
| › 임대 만료 인수 | 소유자 하트비트를 멈추고 가짜 시계 30초 → 다른 쪽이 epoch를 올려 인수 |
| › 좀비 틱 펜싱 | 인수 뒤 이전 소유자의 claim 트랜잭션이 `lease_lost`로 롤백되고 쓴 행이 없다 |
| › renew 실패 | 틱이 멈추고 그 틱의 claim이 없다 |
| › stopTick | 임대 행이 지워지고 진행 중 실행은 그대로 |

### 5.5 루프 종료 4종과 만료 (H2, H3)

| 테스트 | 확인할 동작 |
|---|---|
| `loops.model.test.ts` › count | `count: 3`에서 세 번째 반복 정착 뒤 `loop_stopped(count)`, 네 번째 post 없음 |
| › duration | 가짜 시계가 `seconds`를 넘긴 뒤 `duration`. 대기 중에 넘으면 다음 반복을 투입하지 않는다 |
| › shell | `fakeExec`가 종료 코드 1, 1, 0을 내면 세 번째 반복 뒤 `shell` |
| › shell 실패 3회 | 명령 실행 오류 3회 연속이면 `error` |
| › model | 반복 turn에서 `loop_done`이 불리면 정착 뒤 `model` |
| › 판정 순서 | `model`과 `count`가 같은 경계에서 맞으면 `model` |
| › maxIterations | 설정 상한이 입력보다 작으면 설정 상한에서 `max_iterations` |
| › 만료 | 168시간 경과에 `expired` |
| › goal | 가짜 `work.goals`가 완료를 돌려주면 `goal`. provider가 없으면 `start`가 `goal_unavailable` |
| › goal 이중 투입 없음 | 가짜 목표 `continuation: "external"`에서 반복 경계마다 post 키가 `loop:` 하나다. `continuation: "self"` 목표로 `start`하면 `invalid_input`(spec §9-7) |
| › 한 세션 하나 | 두 번째 `start`가 `loop_already_running` |
| › post 키 멱등 | 반복 n의 `loop_iterated` 커밋 뒤 실패를 주입하고 재시도해도 post가 한 번 |
| `wakeup.test.ts` › 대체 | 세 번 호출하면 마지막 하나만 `pending`, 앞의 둘 `replaced` |
| › 정착 대기 | 기한에 turn이 진행 중이면 정착 뒤 투입 |
| › self 간격 | 반복 중 웨이크업이 없으면 `model` 사유로 멈춤 |
| `restart.test.ts` › host_exit 정리 | 투영에 `running` 루프가 있고 메모리 타이머가 없으면 `session.start`에서 `host_exit` 기록, 자동 재시작 없음 |

### 5.6 jobs 상태 전이 (H4)

| 테스트 | 확인할 동작 |
|---|---|
| `classify.test.ts` › agent 전이 | `agent.spawned` → working, 자식 세션 `approval.requested` → needs_input, `approval.resolved` → working, `agent.settled` → done |
| › 승인 대기를 입력 필요로 | kind `tool`, `question`, `plan` 모두 needs_input |
| › process 전이 | running → working, exited 0 → done(succeeded), exited 1 → done(failed), killed → stopped |
| › loop 전이 | 사유별 done/stopped 대응(spec §4.2.1 표) |
| › run 전이 | started → working, 승인 대기 → needs_input, finished → done, stalled → stopped |
| `jobs.service.test.ts` › 분리 실행 거부 | 서비스 모드 꺼짐에서 `detached: true`가 `unavailable` + `service_mode_off` |
| › 동시 상한 | `maxConcurrent` 초과 `job_limit_reached` |
| `watch.test.ts` › 일치와 상한 | 가짜 프로세스 출력이 regex에 맞으면 post 1회(`watch:<id>:1`), `maxMatches` 도달 시 `max_matches` |
| › regex 거부 | `(a)\1`, `(?=x)`가 `pattern_rejected` |
| › 출력 마스킹 | `excerpt`가 500자 이하이고 가짜 비밀 문자열이 없다 |

### 5.7 유휴 종료 조건 입력 (H7)

| 테스트 | 확인할 동작 |
|---|---|
| `host.idle.test.ts` › 대기 예약 계산 | 켜진 cron 1 + 진행 중 실행 1이면 `pendingSchedules() = 2`, 꺼진 타이머·끝난 at은 세지 않는다 |
| › decideIdle 결합 | `L4.host-service`의 `decideIdle`에 이 값을 넣어 연결 0·live 0·대기 예약 0일 때만 `idle: true`, 대기 예약만 있으면 `reason: "schedules"`(수용 기준 2) |
| › 다른 프로세스 변경 반영 | 다른 연결이 타이머를 만든 뒤 다음 틱에서 값이 갱신된다 |
| › 루프의 live 계산 | 도는 루프 1이면 `liveSchedulerTasks() = 1` |

### 5.8 예약 실행과 결과 (H9)

| 테스트 | 확인할 동작 |
|---|---|
| `run.test.ts` › 클라이언트 없이 실행 | 서비스 모드 가짜 호스트에서 연결 0인 채 가짜 시계를 기한까지 진행 → 새 세션에 `run_started`, 턴 정착 뒤 `run_finished`(수용 기준 1의 단위 판) |
| › origin 표식 | `run_started.origin`이 `"timer"`이고 세션 생성에 `origin: "timer"` |
| › claim 뒤 재시작 | `claimed` 행만 있는 상태에서 다시 시작하면 같은 키로 세션 하나 |
| › started 뒤 재시작 | 투입 전이면 post를 다시 하고, 결과 불명 턴이면 `failed(host_exit)` |
| › 워치독 | 진행 중 턴의 마지막 이벤트 뒤 600초 → interrupt 1회와 `run_stalled` |
| › 승인 대기는 멈춤 아님 | 승인 대기 세션은 600초가 지나도 중단하지 않는다 |
| › whenServiceOff autoStart | 서비스 꺼짐에서 `create`가 자동 기동을 요청하고, 기동하면 저장한다. 가짜 호스트가 기동에 실패하면 `unavailable` + `service_mode_off`와 조치 안내, 저장 없음 [결정: review.decisions-2 U-23] |
| › whenServiceOff reject | 서비스 꺼짐에서 `create`가 `unavailable` + `service_mode_off`, 저장 없음 |
| › whenServiceOff keepWithWarning | 저장하고 `runs_only_while_app_open` 경고 |

### 5.9 원격 인증과 정책 (H10)

| 테스트 | 확인할 동작 |
|---|---|
| `remote.policy.test.ts` › 꺼짐 | `remote.enabled: false`에서 `respond`가 `remote_disabled` |
| › always 거부 | `remember: "always"`가 `remember_not_allowed` |
| › 응답 전달과 감사 | 가짜 `xeon.approvals`가 1회 호출되고 `remote_responded` 커밋 |
| › 요약 마스킹 | `pending.summary`에 도구 인자 원문과 가짜 비밀 값이 없다 |
| `remote.auth.test.ts` › 토큰 없는 접속 | 가짜 원격 전송에서 토큰 없는 연결이 `host.hello` 처리 전에 닫힌다(L4 호스트 테스트 도우미 사용, 수용 기준 5) |
| › 비루프백 무인증 기동 거부 | 비루프백 주소 + 인증 꺼짐 설정으로 서비스 시작이 실패한다 |
| › 토큰 참조 | `tokenRef`가 `secret://` 형식이 아니면 설정 검사(D3)가 거부 |

## 6. 완료 기준

- M3 종료 조건(`product.scope.spec` §4.4 M3) 가운데 이 패키지가 맡는 항목:
  - 예약(UC-4): "서비스 모드에서 클라이언트를 모두 종료해도 예약 실행 이벤트가 기록되고, 연결 0·live task 0·대기 예약 0일 때만 유예 뒤 종료한다." 단위 판은 §5.7·§5.8이고, 통합 확인은 `L4.host-service.plan`의 서비스 모드 테스트와 함께 한다.
  - 원격(UC-5, M3): "서비스는 비루프백 리스너를 열지 않고, 터널로 들어온 토큰 없는 원격 접속은 초기화 전에 끊긴다." §5.9.
- `cd xeon && just verify`가 종료코드 0이다.
- spec §9 수용 기준 1~7 대응: 1 → §5.8 + host-service 통합, 2 → §5.7, 3 → §5.4, 4 → §5.5, 5 → §5.9, 6 → §5.1, 7 → §5.5 `› goal 이중 투입 없음`.
- `check-layers`와 dependency-cruiser가 같은 층 import 0건을 확인한다. `./host` 서브패스는 `apps/host`만 import한다.
- 커버리지 기준 줄 0.8, 함수 0.8 [제안]. 판정 로직 대부분이 순수 함수다.

## 7. 위험과 대응

| # | 위험 | 영향 | 대응 |
|---|---|---|---|
| 1 | 서비스 모드 선행 의존으로 일정 지연 | S3·S4가 `L4.host-service` 서비스 모드(M3)에 묶인다 | S1·S2를 먼저 끝낸다. 틱 루프는 앱 호스트 모드로 먼저 검증한다(§1.2). 서비스 모드 통합은 마지막 주에 둔다 |
| 2 | 재부팅 뒤 예약 지연(OS 등록 2차) | 사용자가 앱을 열 때까지 예약이 돌지 않는다 | 놓친 실행 정책 기본 `once`, 따라잡기 24시간 상한. L4가 "놓친 예약 n건 실행/건너뜀"을 보여 주도록 `runs`의 `skipped` 기록을 남긴다 |
| 3 | 임대 만료·좀비 틱 | 멈췄다 깨어난 프로세스가 같은 기한을 다시 실행 | epoch 펜싱(쓰기 트랜잭션 안 `holds(tx, token)`, `L0.store.spec` §3.1), claim 기본 키, 세션 생성·post 키의 세 겹(spec §4.4.4). 경합 테스트 §5.4 |
| 4 | 원격 보안(무인증 금지 검증) | 비루프백 무인증 리스너가 생기면 기기 전체가 노출된다 | 금지 규칙은 L4가 기동 시 강제하고, 이 패키지는 정책·감사와 `allowedScopes: managed, user` 제한을 둔다. §5.9에 거부 테스트 |
| 5 | 예약 폭주 비용 상한 | 1분 cron이나 많은 타이머가 모델 비용을 키운다 | 최소 간격 300초, 시간당 실행 상한 20, 켜진 타이머 상한 50, `schedule_create` 도구는 L1.tools 승인 정책 대상 [제안: 기본 ask] |
| 6 | cron 파서 채택 지연 | H6이 막힌다 | 후보 비교 기준을 미리 정했다(§4.1). 둘 다 실패하면 자체 구현(약 400줄)으로 간다 |
| 7 | 세션 생성 requestId 멱등 미지원 | 재시작 복구에서 빈 실행 세션이 하나 더 생길 수 있다 | spec §10 미결 5의 대안(계획한 `threadId` 선기록 + 지정 ID 생성)을 L1.persistence에 요청. 받기 전에는 빈 고아 세션을 실행 기록과 대조해 표시 |
| 8 | 루프가 서비스 유휴 종료를 막음 | 서비스 모드에서 끝나지 않는 루프가 서비스를 계속 살려 둔다 | 루프는 반드시 상한과 만료가 있다(spec §4.1.2). `liveSchedulerTasks` 포함 여부는 spec §10 미결 11 |
