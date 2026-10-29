---
id: L2.schedule.spec
layer: L2
domain: schedule
kind: spec
status: draft
depends_on: [F.capabilities.spec, F.extensions.spec, F.wire-settings.spec, adr.0006, L0.process.spec, L0.os.spec, L0.store.spec, L1.tasks.spec, L1.agents.spec, L2.work.spec, eng.transactions.design]
binds: [xeon/packages/cap-schedule/**]
---

# L2 예약과 백그라운드 (schedule)

패키지: `@xeon/cap-schedule`. 서비스 이름: `xeon.schedule`(`ScheduleService`). 능력 ID: `schedule.loops`, `schedule.jobs`, `schedule.sessions`, `schedule.timers`, `schedule.remote`. 이벤트 접두사: `schedule.`. 테이블 접두사: `cap_schedule_`.

## 1. 목적과 범위

계획 v2 하위 층 L2-h "예약과 백그라운드"(`_research/layer-plan-v2.json` L2-h)의 능력 다섯 개를 정한다. 시간이 지나면 다시 일하는 기능(루프, 웨이크업, 예약)과 백그라운드 작업의 상태를 보는 기능(작업 모니터, 세션 목록), 다른 기기에서 답하는 기능(원격 승인)을 묶는다.

이 도메인의 기능은 공유 서비스 모드(`xeon service`, ADR-0006)가 필요한지로 둘로 나뉜다. 계획 v2의 L2-h 메모가 이 구분을 적었다: "앱이 켜져 있는 동안만 도는 항목(루프, 모니터)은 데몬 없이 됩니다. 앱을 닫아도 도는 항목(예약, 분리 실행, 원격)은 L0-d 공유 서비스 모드가 필요합니다." 이 문서는 기능마다 상주 수준을 적고(§1.2), 서비스 모드가 꺼졌을 때의 동작을 정한다(§4.4.6).

정하는 것:

- 능력 정의 5개의 TypeBox 완성형(§3.2~§3.6). 정의 파일은 F `xeon/packages/contracts/src/capabilities/defs/schedule.ts`다.
- 루프와 웨이크업: 종료 조건 4종, 상한, 만료, 같은 세션 반복 규칙(§4.1).
- 작업 상태 분류(작업 중, 입력 필요, 완료, 중지)와 감시(§4.2).
- 세션 목록과 세션별 작업 디렉터리, 워크트리 연산의 노출(§4.3).
- 예약 실행: cron·at, 틱과 실행권 임대, 놓친 실행 정책, 중복 방지, 감시 워치독, 유휴 종료와의 관계(§4.4).
- 원격 승인 중계와 인증 요구(§4.5).
- `schedule.*` 이벤트 카탈로그와 `cap_schedule_` 테이블(§3.7, §3.8). 설정 키 `l2.schedule.*`(§6).

다루지 않는 것:

- 프로세스 레지스트리, 분리(detached) spawn: `L0.process.spec`. 쓰기 소유 판정(OS 잠금 + `sys_leases.epoch` 펜싱): `L0.store.spec`, `L1.persistence.spec` [결정: review.decisions-2 U-09].
- 워크트리 격리 자체, 파일 감시, OS 알림, 타이머 원시 기능: `L0.os.spec`, `L0.sandbox.spec`.
- 임대 테이블 `sys_leases`와 펜싱: `L0.store.spec`, `eng.transactions.design` §3.3.
- 서브에이전트 백그라운드 위임과 그 결과 전달: `L1.agents.spec`.
- 입력 큐와 전달 모드: `L1.tasks.spec`(`xeon.tasks`).
- 서비스 프로세스 수명, 등록 파일, 유휴 종료 판정 함수, 원격 연결의 수용과 인증: `L4.host-service.spec`. 원격은 로컬 서비스 소켓을 SSH 터널이나 사설망으로 연결하는 방식이고, 내장 TLS + 토큰 WebSocket은 2차다 [결정: review.decisions-2 U-11].
- 목표 판정: `L2.work.spec`(`work.goals`). 이 문서는 선택 의존으로만 쓴다.
- 예약 세션에서 어떤 그룹 동작을 끌지 정하는 규칙: L3 그룹 문서(§4.4.8 경계).
- OS 서비스 등록(launchd, systemd)과 재부팅 뒤 자동 시작: 2차(`product.scope.spec` §4.2 N3).

### 1.1 소유 경계표

[제안] 이 도메인은 소유 범위가 얇다. 대부분의 실행 수단은 L0·L1·L4가 갖고, 이 도메인은 "언제", "몇 번", "어떤 상태로 보이나"만 갖는다. 아래 표로 경계를 고정한다.

| 이 층이 소유하는 것 | 호출만 하는 것 (소유자) | 다른 층이 소유하는 것 |
|---|---|---|
| 루프 정의, 종료 조건 판정, 반복 횟수, 만료와 `schedule.loop_*` 이벤트 | 입력 큐 투입 `xeon.tasks` post (`L1.tasks.spec`) | 입력 큐, 전달 모드, `input.*`(L1.tasks) |
| 웨이크업 예약과 `schedule.wakeup_*` | 타이머 `xeon.os` (`L0.os.spec`) | 시계·타이머 원시 기능(L0.os) |
| 셸 종료 조건의 판정(종료 코드 비교) | 명령 실행 `xeon.exec`·`xeon.sandbox` (`L0.exec.spec`, `L0.sandbox.spec`) | 실행 환경과 격리 정책(L0) |
| 작업 상태 분류 규칙(4상태)과 감시(`watch`) | 프로세스 목록·출력 `xeon.process` (`L0.process.spec`), 위임 실행 `xeon.agents` (`L1.agents.spec`) | 프로세스 레지스트리(L0.process), 백그라운드 위임과 자식 세션(L1.agents) |
| 세션 실행 목록(소유자, 상태, 작업 디렉터리) | 세션 생성 `xeon.session` (`L1.persistence.spec`), 워크트리 연산 `xeon.os` | 워크트리 격리(L0.os·L0.sandbox), 쓰기 소유(OS 잠금 + `sys_leases.epoch` 펜싱, L0.store·L1.persistence) |
| 타이머 정의 테이블, 실행 기록 테이블, 틱 알고리즘, 놓친 실행 정책 | 임대 `xeon.store` lease API, 자원 `scheduler` (`L0.store.spec`) | `sys_leases`(L0.store), 틱을 돌리는 프로세스의 수명(L4.host-service) |
| 대기 예약 수 계산(`pendingSchedules`) | 없음 | 유휴 종료 판정 `decideIdle`(L4.host-service) |
| 원격 승인 중계 정책과 감사 기록 | 승인 응답 `xeon.approvals` (`L1.tools.spec`) | 원격 연결 수용, 토큰 인증(L4.host-service). 비루프백 리스너는 1차에 열지 않는다(U-11) |
| 알림 대상 이벤트 kind(`schedule.run_finished` 등) | 없음 | 알림 채널(`dialog.notify`, [제안] §4.5.4), 알림 라우팅(L4.host-service HS-42), OS 알림(L0.os) |
| 예약 세션 표식(`schedule.run_started`) | 없음 | 예약 세션에서의 그룹 정책(L3) |

### 1.2 상주 수준

[제안] `_research/l2e.md` §6의 기준이다. 0은 요청 처리 중 메모리만 쓴다. 1은 앱(세션 프로세스)이 살아 있어야 한다. 2는 앱을 닫아도 독립 프로세스가 있어야 하므로 서비스 모드가 필요하다. `L2.readme` §8 표와 같다.

| 기능 | 능력 | 상주 수준 | 서비스 모드 꺼짐일 때 | 근거 |
|---|---|---|---|---|
| 루프 | `schedule.loops` | 1 | 앱이 켜져 있는 동안 돈다. 앱을 닫으면 멈춘다 | `_research/l2e.md` §6 D2 |
| 웨이크업 | `schedule.loops` | 1 | 같다 | `_research/l2e.md` §6 D2 |
| 작업 모니터 목록·상태 | `schedule.jobs` | 1 | 앱 안의 작업만 보인다 | `_research/l2e.md` §6 D3 |
| 분리 실행(앱 종료 뒤 계속) | `schedule.jobs` `spawn({detached: true})` | 2 | `unavailable`, `detail.reason: "service_mode_off"` | `_research/l2e.md` §6 D3 |
| 세션 목록 | `schedule.sessions` | 1 | 이 프로세스가 아는 세션과 DB의 세션이 보인다 | `_research/l2e.md` §6 D4 |
| 공유 관제(여러 클라이언트) | `schedule.sessions` | 2 | 클라이언트마다 따로 본다 | `_research/l2e.md` §6 D4 |
| 예약 실행 | `schedule.timers` | 2 | §4.4.6 설정에 따라 거부 또는 경고 후 보관 | `_research/l2e.md` §6 D1, ADR-0006 §3.5 |
| 원격 승인 | `schedule.remote` | 2 | `unavailable`, `service_mode_off` | `_research/l2e.md` §6 D6 |
| 모바일 푸시 | [미결] §4.5.4 | 2 | 없음 | `_research/l2e.md` §6 B4 |

- 수준 1 기능은 서비스 모드가 켜져 있으면 서비스 프로세스 안에서 돈다. 그 세션의 쓰기 소유자가 서비스이기 때문이다(ADR-0006 §3.6 1번). 그래서 서비스 모드에서는 앱을 닫아도 루프가 계속된다. 서비스 모드가 꺼져 있으면 세션을 연 CLI나 데스크톱 엔진 안에서 돈다.

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 루프 (loop) | 같은 세션에 같은 프롬프트를 반복 투입하는 정의. 반복 한 번이 iteration이다 |
| 웨이크업 (wakeup) | 모델이나 그룹이 "n초 뒤 이 프롬프트로 다시 깨워 달라"고 남긴 일회성 예약. 같은 세션에 투입한다 |
| 종료 조건 | 루프를 멈추는 조건 4종: 횟수, 시간, 셸 종료 코드, 모델 선언(§4.1.2) |
| 작업 (job) | 백그라운드에서 도는 단위. 출처는 위임 에이전트, 백그라운드 프로세스, 루프, 예약 실행이다 |
| 입력 필요 (needs_input) | 작업이 사용자 답을 기다리는 상태. 승인 대기와 질문 대기를 묶는다 |
| 타이머 (timer) | cron 또는 at으로 정한 예약. 기한마다 새 세션을 만들어 실행한다 |
| 기한 (dueAt) | 타이머가 실행되어야 하는 시각(epoch ms) |
| 실행 (run) | 타이머의 기한 하나에 대한 실행. `(timerId, dueAt)` 쌍으로 식별한다 |
| 틱 (tick) | 만기된 타이머를 찾아 실행을 시작하는 주기 작업 |
| 실행권 | `sys_leases`의 `scheduler` 자원 임대. 이것을 쥔 프로세스 하나만 틱을 돌린다 |
| 대기 예약 | 다음 기한이 있는 켜진 타이머와 시작했지만 끝나지 않은 실행. 유휴 종료를 막는다 |
| 원격 클라이언트 | 다른 기기에서 SSH 터널이나 사설망을 거쳐 서비스 로컬 소켓에 붙고 원격 토큰으로 인증한 클라이언트(`L4.host-service.spec` §4.11, U-11) |

## 3. 인터페이스

정의 코드는 `F.capabilities.spec` §3.9 예시처럼 export 상수의 타입 주석을 생략했다. 실제 파일은 `isolatedDeclarations` 때문에 export마다 명시 타입 주석을 단다.

### 3.1 공통 스키마

```ts
// xeon/packages/contracts/src/capabilities/defs/schedule.ts (1/6)
import { Type, type Static } from "typebox";
import { ULID_PATTERN, ThreadIdSchema, TurnIdSchema } from "../../conversation/index.ts";
import { defineCapability, serviceKey, type ToolContent } from "../index.ts";

/** 지역 ID. 접두는 F.conversation.spec §3.2.1 LocalIdPrefix 표(lop, wak, tmr, wch)이고 LocalIdFactory로 만든다. 패턴은 localIdPattern(prefix)와 같다 */
export const LoopIdSchema = Type.String({ pattern: `^lop_${ULID_PATTERN}$` });
export const WakeupIdSchema = Type.String({ pattern: `^wak_${ULID_PATTERN}$` });
export const TimerIdSchema = Type.String({ pattern: `^tmr_${ULID_PATTERN}$` });
export const WatchIdSchema = Type.String({ pattern: `^wch_${ULID_PATTERN}$` });

/** F.extensions.spec PostWhen과 같은 값 집합 */
export const PostWhenSchema = Type.Union([Type.Literal("steer"), Type.Literal("followUp"), Type.Literal("next")]);

export const PromptSchema = Type.String({ minLength: 1, maxLength: 8000 });
export const EpochMsSchema = Type.Integer({ minimum: 0 });

/** 작업 상태 4종. needs_input = 승인 대기 + 질문 대기(§4.2.1) */
export const JobStateSchema = Type.Union([
  Type.Literal("working"), Type.Literal("needs_input"), Type.Literal("done"), Type.Literal("stopped"),
]);
export type JobState = Static<typeof JobStateSchema>;

export const JobSourceSchema = Type.Union([
  Type.Literal("agent"), Type.Literal("process"), Type.Literal("loop"), Type.Literal("run"),
]);
/** 작업 참조. id 형식은 출처마다 다르다: agent=자식 ThreadId, process=L0 프로세스 id, loop=LoopId, run="<TimerId>@<dueAt>" */
export const JobRefSchema = Type.Object({
  source: JobSourceSchema,
  id: Type.String({ minLength: 1, maxLength: 96 }),
});
```

### 3.2 `schedule.loops`

```ts
// defs/schedule.ts (2/6)
export const LoopUntilSchema = Type.Union([
  /** 반복 횟수 */
  Type.Object({ type: Type.Literal("count"), iterations: Type.Integer({ minimum: 1, maximum: 1000 }) }),
  /** 시작부터 경과 시간 */
  Type.Object({ type: Type.Literal("duration"), seconds: Type.Integer({ minimum: 60, maximum: 2_592_000 }) }),
  /** 반복이 끝날 때마다 실행한 셸 명령의 종료 코드가 successExitCode면 멈춘다 */
  Type.Object({
    type: Type.Literal("shell"),
    command: Type.String({ minLength: 1, maxLength: 4096 }),
    cwd: Type.Optional(Type.String({ maxLength: 4096 })),
    successExitCode: Type.Optional(Type.Integer({ minimum: 0, maximum: 255, default: 0 })),
    timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 600 })),
  }),
  /** 모델이 loop_done 도구로 끝을 선언하면 멈춘다 */
  Type.Object({ type: Type.Literal("model") }),
]);

export const LoopIntervalSchema = Type.Union([
  /** 반복이 끝나고 seconds 뒤 다음 반복 */
  Type.Object({ type: Type.Literal("fixed"), seconds: Type.Integer({ minimum: 0, maximum: 86_400 }) }),
  /** 모델이 schedule_wakeup으로 다음 간격을 정한다. 반복 중 웨이크업이 없으면 루프가 끝난다(§4.1.3) */
  Type.Object({ type: Type.Literal("self") }),
]);

export const LoopStopReasonSchema = Type.Union([
  Type.Literal("count"), Type.Literal("duration"), Type.Literal("shell"), Type.Literal("model"),
  Type.Literal("goal"), Type.Literal("max_iterations"), Type.Literal("expired"),
  Type.Literal("user"), Type.Literal("host_exit"), Type.Literal("error"),
]);

export const LoopViewSchema = Type.Object({
  loopId: LoopIdSchema,
  threadId: ThreadIdSchema,
  prompt: PromptSchema,
  until: LoopUntilSchema,
  interval: LoopIntervalSchema,
  status: Type.Union([Type.Literal("running"), Type.Literal("waiting"), Type.Literal("stopped")]),
  iteration: Type.Integer({ minimum: 0 }),
  maxIterations: Type.Integer({ minimum: 1 }),
  startedAt: EpochMsSchema,
  expiresAt: EpochMsSchema,
  /** 다음 반복 예정 시각. 반복 중이거나 멈췄으면 null */
  nextAt: Type.Union([EpochMsSchema, Type.Null()]),
  goalId: Type.Union([Type.String(), Type.Null()]),
  stoppedReason: Type.Union([LoopStopReasonSchema, Type.Null()]),
});
export type LoopView = Static<typeof LoopViewSchema>;

export const WakeupViewSchema = Type.Object({
  wakeupId: WakeupIdSchema,
  threadId: ThreadIdSchema,
  dueAt: EpochMsSchema,
  prompt: PromptSchema,
  loopId: Type.Union([LoopIdSchema, Type.Null()]),
  status: Type.Union([Type.Literal("pending"), Type.Literal("fired"), Type.Literal("cancelled")]),
});

export const ScheduleLoops = defineCapability({
  id: "schedule.loops",
  version: "1.0.0",
  description: "같은 세션을 종료 조건까지 반복하고, 정한 시간 뒤 다시 깨운다. 앱(또는 서비스)이 살아 있는 동안만 돈다.",
  service: {
    methods: {
      start: {
        description: "루프를 시작한다. 첫 반복을 다음 경계에 투입한다.",
        input: Type.Object({
          threadId: Type.Optional(ThreadIdSchema),
          prompt: PromptSchema,
          until: LoopUntilSchema,
          interval: Type.Optional(LoopIntervalSchema),           // 기본 { type: "fixed", seconds: 0 }
          maxIterations: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
          expiresInHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 720 })),
          /** work.goals 목표. 판정이 끝나면 멈춘다(선택 의존, §4.1.4) */
          goalId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
        }),
        output: LoopViewSchema,
        replay: "safe",
        errors: {
          loop_already_running: { description: "이 세션에 이미 도는 루프가 있음", retryable: false },
          goal_unavailable: { description: "goalId를 줬지만 work.goals provider가 없음", retryable: false },
        },
      },
      stop: {
        description: "루프를 멈춘다. 진행 중인 반복은 끝까지 간다.",
        input: Type.Object({ loopId: LoopIdSchema }),
        output: LoopViewSchema,
        replay: "safe",
      },
      status: {
        description: "루프 상태를 돌려준다.",
        input: Type.Object({ loopId: LoopIdSchema }),
        output: LoopViewSchema,
        replay: "safe",
      },
      list: {
        description: "루프 목록.",
        input: Type.Object({
          threadId: Type.Optional(ThreadIdSchema),
          status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("stopped"), Type.Literal("all")])),
        }),
        output: Type.Object({ items: Type.Array(LoopViewSchema) }),
        replay: "safe",
      },
      wakeup: {
        description: "delaySeconds 뒤 이 세션에 prompt를 투입한다. 세션에 대기 중인 웨이크업이 있으면 바꾼다.",
        input: Type.Object({
          threadId: Type.Optional(ThreadIdSchema),
          delaySeconds: Type.Integer({ minimum: 30, maximum: 86_400 }),
          prompt: PromptSchema,
        }),
        output: WakeupViewSchema,
        replay: "safe",
        errors: {
          wakeup_expired_loop: { description: "연결된 루프가 이미 멈춤", retryable: false },
        },
      },
      done: {
        description: "모델 선언으로 현재 세션의 루프를 끝낸다.",
        input: Type.Object({
          threadId: Type.Optional(ThreadIdSchema),
          loopId: Type.Optional(LoopIdSchema),
          reason: Type.Optional(Type.String({ maxLength: 500 })),
        }),
        output: Type.Object({ loop: Type.Union([LoopViewSchema, Type.Null()]) }),
        replay: "safe",
      },
    },
  },
  tools: [
    {
      name: "schedule_wakeup",
      label: "다시 깨우기 예약",
      description:
        "delaySeconds 뒤 이 세션에서 prompt로 다시 작업을 이어 간다. 기다려야 결과가 나오는 일(빌드, 배포, 외부 응답)에 쓴다. " +
        "앱이 닫히면 실행되지 않는다. 한 세션에 대기 중인 웨이크업은 하나다.",
      method: "wakeup",
      parameters: Type.Object({
        delaySeconds: Type.Integer({ minimum: 30, maximum: 86_400 }),
        prompt: PromptSchema,
      }),
      toInput: (p) => ({ delaySeconds: p.delaySeconds, prompt: p.prompt }),
      toContent: (out) => ({
        content: [{ type: "text", text: `wakeup ${out.wakeupId} at ${new Date(out.dueAt).toISOString()}` }],
      }),
      replay: "safe",
      executionMode: "sequential",
      hints: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    },
    {
      // [제안] 종료 조건이 model인 루프에서만 광고한다(§4.1.2)
      name: "loop_done",
      label: "루프 끝내기",
      description: "현재 루프의 목표를 이뤘거나 더 할 일이 없을 때 루프를 끝낸다.",
      method: "done",
      parameters: Type.Object({ reason: Type.Optional(Type.String({ maxLength: 500 })) }),
      toInput: (p) => (p.reason === undefined ? {} : { reason: p.reason }),
      toContent: (out) => ({
        content: [{ type: "text", text: out.loop === null ? "no active loop" : `loop ${out.loop.loopId} stopped` }],
      }),
      replay: "safe",
      executionMode: "sequential",
      hints: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    },
  ],
});
export const ScheduleLoopsKey = serviceKey(ScheduleLoops);
```

- `schedule_wakeup`의 `toContent`가 `new Date(...).toISOString()`을 쓰지만 입력(`dueAt`)만으로 결과가 정해지므로 순수 결정 함수다(`F.capabilities.spec` §4.2 부속 규칙 1). 시각을 읽지 않는다.
- 루프 시작 도구는 두지 않는다. 루프는 사용자 명령(`/loop`, `L4.cli.spec`)이나 그룹 코드가 시작한다 [제안]. 모델이 스스로 반복하려면 `schedule_wakeup`을 쓴다. 근거: Claude Code `/loop`는 사용자 명령이고 모델 쪽 도구는 `ScheduleWakeup`이다(`_research/l2e.md` §3.4 D2).

### 3.3 `schedule.jobs`

```ts
// defs/schedule.ts (3/6)
export const JobViewSchema = Type.Object({
  job: JobRefSchema,
  /** 작업이 속한 세션. process는 시작한 세션, agent는 부모 세션 */
  threadId: Type.Union([ThreadIdSchema, Type.Null()]),
  title: Type.String({ maxLength: 200 }),
  state: JobStateSchema,
  /** done일 때 결과. 그 밖에는 null */
  outcome: Type.Union([Type.Literal("succeeded"), Type.Literal("failed"), Type.Null()]),
  /** needs_input일 때 기다리는 승인 id들 */
  waitingApprovals: Type.Array(Type.String()),
  detached: Type.Boolean(),
  startedAt: EpochMsSchema,
  endedAt: Type.Union([EpochMsSchema, Type.Null()]),
});
export type JobView = Static<typeof JobViewSchema>;

export const WatchSourceSchema = Type.Union([
  /** 작업 상태 변화 */
  Type.Object({ type: Type.Literal("job"), job: JobRefSchema }),
  /** 백그라운드 프로세스 출력 줄 */
  Type.Object({
    type: Type.Literal("processOutput"),
    processId: Type.String({ minLength: 1, maxLength: 96 }),
    stream: Type.Optional(Type.Union([Type.Literal("stdout"), Type.Literal("stderr"), Type.Literal("both")])),
  }),
  /** 파일 변경(L0.os 파일 감시) */
  Type.Object({ type: Type.Literal("file"), path: Type.String({ minLength: 1, maxLength: 4096 }) }),
]);

export const WatchFilterSchema = Type.Union([
  Type.Object({ type: Type.Literal("any") }),
  Type.Object({ type: Type.Literal("states"), states: Type.Array(JobStateSchema, { minItems: 1, maxItems: 4 }) }),
  /** RE2 부분 집합으로 해석한다(§4.2.3). 역참조·전후방 탐색 금지 */
  Type.Object({ type: Type.Literal("regex"), pattern: Type.String({ minLength: 1, maxLength: 512 }) }),
]);

export const WatchViewSchema = Type.Object({
  watchId: WatchIdSchema,
  threadId: ThreadIdSchema,
  source: WatchSourceSchema,
  filter: WatchFilterSchema,
  notify: PostWhenSchema,
  matches: Type.Integer({ minimum: 0 }),
  maxMatches: Type.Integer({ minimum: 1 }),
  status: Type.Union([Type.Literal("active"), Type.Literal("stopped")]),
});

export const ScheduleJobs = defineCapability({
  id: "schedule.jobs",
  version: "1.0.0",
  description: "백그라운드 작업(위임 에이전트, 프로세스, 루프, 예약 실행)의 상태를 4종으로 분류하고 감시한다.",
  service: {
    methods: {
      spawn: {
        description: "백그라운드 작업을 시작한다. 실행은 L1.agents 또는 L0.process가 한다.",
        input: Type.Object({
          threadId: Type.Optional(ThreadIdSchema),
          task: Type.Union([
            Type.Object({
              kind: Type.Literal("agent"),
              prompt: PromptSchema,
              agent: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
            }),
            Type.Object({
              kind: Type.Literal("process"),
              command: Type.String({ minLength: 1, maxLength: 4096 }),
              cwd: Type.Optional(Type.String({ maxLength: 4096 })),
            }),
          ]),
          title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
          /** 참이면 앱을 닫아도 계속(상주 수준 2, 서비스 모드 필요). 기본 거짓 */
          detached: Type.Optional(Type.Boolean()),
        }),
        output: JobViewSchema,
        replay: "unsafe",
        errors: {
          job_limit_reached: { description: "동시 백그라운드 작업 상한을 넘음", retryable: true },
        },
      },
      list: {
        description: "작업 목록.",
        input: Type.Object({
          threadId: Type.Optional(ThreadIdSchema),
          states: Type.Optional(Type.Array(JobStateSchema, { minItems: 1, maxItems: 4 })),
          sources: Type.Optional(Type.Array(JobSourceSchema, { minItems: 1, maxItems: 4 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 100 })),
        }),
        output: Type.Object({ items: Type.Array(JobViewSchema) }),
        replay: "safe",
      },
      status: {
        description: "작업 하나의 상태.",
        input: Type.Object({ job: JobRefSchema }),
        output: JobViewSchema,
        replay: "safe",
      },
      stop: {
        description: "작업을 멈춘다. 위임은 취소, 프로세스는 종료 신호, 루프는 stop, 예약 실행은 턴 중단.",
        input: Type.Object({ job: JobRefSchema }),
        output: JobViewSchema,
        replay: "safe",
      },
      watch: {
        description: "출처를 감시해 필터에 맞으면 세션에 입력을 넣는다.",
        input: Type.Object({
          threadId: Type.Optional(ThreadIdSchema),
          source: WatchSourceSchema,
          filter: WatchFilterSchema,
          notify: Type.Optional(PostWhenSchema),                   // 기본 "next"
          maxMatches: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 1 })),
        }),
        output: WatchViewSchema,
        replay: "safe",
        errors: {
          watch_limit_reached: { description: "세션당 감시 상한을 넘음", retryable: false },
          pattern_rejected: { description: "regex가 허용 부분 집합 밖", retryable: false },
        },
      },
      unwatch: {
        description: "감시를 멈춘다.",
        input: Type.Object({ watchId: WatchIdSchema }),
        output: WatchViewSchema,
        replay: "safe",
      },
    },
  },
  tools: [
    // [제안] 세 도구 모두 기본 노출 꺼짐(l2.schedule.tools.jobs). L1.agents의 위임 도구, workspace.shell의 bash와 겹치기 때문이다
    {
      name: "job_spawn",
      label: "백그라운드 작업 시작",
      description: "서브에이전트 작업을 백그라운드로 시작하고 바로 돌아온다. 결과는 끝나면 입력으로 들어온다.",
      method: "spawn",
      parameters: Type.Object({
        prompt: PromptSchema,
        agent: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
        title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      }),
      toInput: (p) => ({
        task: p.agent === undefined ? { kind: "agent", prompt: p.prompt } : { kind: "agent", prompt: p.prompt, agent: p.agent },
        ...(p.title === undefined ? {} : { title: p.title }),
      }),
      outputSchema: JobViewSchema,
      toContent: (out) => ({
        content: [{ type: "text", text: `job ${out.job.source}:${out.job.id} ${out.state}` }],
        structuredContent: out,
      }),
      replay: "unsafe",
      executionMode: "sequential",
      hints: { readOnly: false, destructive: false, idempotent: false, openWorld: false },
    },
    {
      name: "job_status",
      label: "작업 상태 보기",
      description: "백그라운드 작업 목록과 상태(작업 중, 입력 필요, 완료, 중지)를 본다.",
      method: "list",
      parameters: Type.Object({
        states: Type.Optional(Type.Array(JobStateSchema, { minItems: 1, maxItems: 4 })),
      }),
      toInput: (p) => (p.states === undefined ? {} : { states: p.states }),
      toContent: (out) => ({
        content: [{
          type: "text",
          text: out.items.map((j) => `${j.job.source}:${j.job.id} ${j.state} ${j.title}`).join("\n") || "no jobs",
        }],
      }),
      replay: "safe",
      executionMode: "parallel",
      hints: { readOnly: true, openWorld: false },
    },
    {
      name: "monitor_start",
      label: "감시 시작",
      description: "작업 상태나 프로세스 출력을 감시하다가 조건에 맞으면 알린다. 폴링 대신 쓴다.",
      method: "watch",
      parameters: Type.Object({
        source: WatchSourceSchema,
        filter: WatchFilterSchema,
        maxMatches: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      }),
      toInput: (p) => ({
        source: p.source,
        filter: p.filter,
        ...(p.maxMatches === undefined ? {} : { maxMatches: p.maxMatches }),
      }),
      outputSchema: WatchViewSchema,
      toContent: (out) => ({
        content: [{ type: "text", text: `watch ${out.watchId} active` }],
        structuredContent: out,
      }),
      replay: "safe",
      executionMode: "sequential",
      hints: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    },
  ],
});
export const ScheduleJobsKey = serviceKey(ScheduleJobs);
```

- `spawn`은 `replay: "unsafe"`다. 위임 에이전트와 프로세스 시작은 결과가 불명일 때 다시 실행하면 작업이 둘이 된다. L1.agents와 L0.process가 `requestId` 멱등을 보장하면 `"safe"`로 넓힐 수 있다(§10 미결 7).

### 3.4 `schedule.sessions`

```ts
// defs/schedule.ts (4/6)
export const WorktreeViewSchema = Type.Object({
  path: Type.String(),
  branch: Type.Union([Type.String(), Type.Null()]),
  head: Type.Union([Type.String({ pattern: "^[0-9a-f]{40}$" }), Type.Null()]),
  /** 이 워크트리를 작업 디렉터리로 쓰는 세션들 */
  threadIds: Type.Array(ThreadIdSchema),
});

export const SessionRuntimeViewSchema = Type.Object({
  threadId: ThreadIdSchema,
  workspace: Type.Union([Type.String(), Type.Null()]),
  worktree: Type.Union([WorktreeViewSchema, Type.Null()]),
  /** 세션 쓰기 소유자 표시값(ADR-0006 §3.6 4번). 틀릴 수 있다 */
  owner: Type.Union([Type.Literal("cli"), Type.Literal("app"), Type.Literal("service"), Type.Null()]),
  state: Type.Union([Type.Literal("idle"), Type.Literal("working"), Type.Literal("needs_input")]),
  /** 이 세션에서 도는 작업 수(루프, 위임, 프로세스) */
  activeJobs: Type.Integer({ minimum: 0 }),
  lastActivityAt: EpochMsSchema,
});

export const ScheduleSessions = defineCapability({
  id: "schedule.sessions",
  version: "1.0.0",
  description: "세션 실행 목록(소유자, 상태, 작업 디렉터리)과 세션별 작업 디렉터리·워크트리 연산.",
  service: {
    methods: {
      list: {
        description: "세션 실행 상태 목록. 제목·라벨은 artifacts.sessions가 소유한다.",
        input: Type.Object({
          workspace: Type.Optional(Type.String({ maxLength: 4096 })),
          states: Type.Optional(Type.Array(
            Type.Union([Type.Literal("idle"), Type.Literal("working"), Type.Literal("needs_input")]),
            { minItems: 1, maxItems: 3 },
          )),
          cursor: Type.Optional(Type.String({ maxLength: 128 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
        }),
        output: Type.Object({
          items: Type.Array(SessionRuntimeViewSchema),
          nextCursor: Type.Union([Type.String(), Type.Null()]),
        }),
        replay: "safe",
      },
      create: {
        description: "새 세션을 만든다. worktree를 주면 워크트리를 만들고 그 경로를 작업 디렉터리로 쓴다.",
        input: Type.Object({
          workspace: Type.Optional(Type.String({ maxLength: 4096 })),
          title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
          worktree: Type.Optional(Type.Object({
            branch: Type.String({ minLength: 1, maxLength: 200 }),
            base: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
          })),
        }),
        output: SessionRuntimeViewSchema,
        replay: "safe",
        errors: {
          not_a_repository: { description: "workspace가 git 저장소가 아님", retryable: false },
          branch_exists: { description: "같은 이름의 브랜치가 이미 있음", retryable: false },
        },
      },
      worktreeCreate: {
        description: "워크트리를 만든다. 격리 실행은 L0이 한다.",
        input: Type.Object({
          repo: Type.Optional(Type.String({ maxLength: 4096 })),     // 생략하면 현재 세션 workspace
          branch: Type.String({ minLength: 1, maxLength: 200 }),
          base: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
        }),
        output: WorktreeViewSchema,
        replay: "safe",
        errors: {
          not_a_repository: { description: "repo가 git 저장소가 아님", retryable: false },
          branch_exists: { description: "같은 이름의 브랜치가 이미 있음", retryable: false },
        },
      },
      worktreeList: {
        description: "워크트리 목록.",
        input: Type.Object({ repo: Type.Optional(Type.String({ maxLength: 4096 })) }),
        output: Type.Object({ items: Type.Array(WorktreeViewSchema) }),
        replay: "safe",
      },
      worktreeRemove: {
        description: "워크트리를 지운다. 커밋하지 않은 변경이 있으면 force 없이 거부한다.",
        input: Type.Object({
          path: Type.String({ minLength: 1, maxLength: 4096 }),
          force: Type.Optional(Type.Boolean()),
        }),
        output: Type.Object({ removed: Type.Boolean() }),
        replay: "unsafe",
        errors: {
          worktree_dirty: { description: "커밋하지 않은 변경이 있음", retryable: false },
          worktree_in_use: { description: "작업 중인 세션이 이 워크트리를 씀", retryable: true },
        },
      },
    },
  },
  tools: [
    // [제안] 기본 노출 꺼짐(l2.schedule.tools.worktree). 선택 기능이고 파일 시스템을 크게 바꾸기 때문이다
    {
      name: "worktree_create",
      label: "워크트리 만들기",
      description: "현재 저장소에 새 브랜치 워크트리를 만든다. 병렬 실험을 서로 격리할 때 쓴다.",
      method: "worktreeCreate",
      parameters: Type.Object({
        branch: Type.String({ minLength: 1, maxLength: 200 }),
        base: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      }),
      toInput: (p) => (p.base === undefined ? { branch: p.branch } : { branch: p.branch, base: p.base }),
      replay: "safe",
      executionMode: "sequential",
      hints: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    },
    {
      name: "worktree_list",
      label: "워크트리 목록",
      description: "현재 저장소의 워크트리 목록을 본다.",
      method: "worktreeList",
      parameters: Type.Object({}),
      toInput: () => ({}),
      replay: "safe",
      executionMode: "parallel",
      hints: { readOnly: true, openWorld: false },
    },
    {
      name: "worktree_remove",
      label: "워크트리 지우기",
      description: "워크트리를 지운다. 커밋하지 않은 변경이 있으면 실패한다.",
      method: "worktreeRemove",
      parameters: Type.Object({ path: Type.String({ minLength: 1, maxLength: 4096 }) }),
      toInput: (p) => ({ path: p.path }),
      replay: "unsafe",
      executionMode: "sequential",
      hints: { readOnly: false, destructive: true, idempotent: false, openWorld: false },
    },
  ],
});
export const ScheduleSessionsKey = serviceKey(ScheduleSessions);
```

- `worktree_list`의 `parameters`는 빈 객체이고 메서드 입력에는 선택 필드 `repo`가 있어 두 스키마가 다르다. 그래서 `toInput`을 둔다(`tool_input_mismatch` 회피).
- 세 워크트리 도구는 `toContent`가 없어 기본 렌더링(출력의 키 정렬 JSON)을 쓴다.

### 3.5 `schedule.timers`

```ts
// defs/schedule.ts (5/6)
export const TimerSpecSchema = Type.Union([
  /** 5필드 cron(분 시 일 월 요일). 초 필드와 @reboot는 받지 않는다(§4.4.2) */
  Type.Object({
    type: Type.Literal("cron"),
    expr: Type.String({ minLength: 9, maxLength: 128 }),
    tz: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),   // IANA. 생략하면 시스템 시간대
  }),
  /** 한 번. RFC 3339 시각 */
  Type.Object({ type: Type.Literal("at"), at: Type.String({ format: "date-time" }) }),
]);

export const MissedPolicySchema = Type.Union([Type.Literal("skip"), Type.Literal("once"), Type.Literal("all")]);

export const RunStatusSchema = Type.Union([
  Type.Literal("claimed"), Type.Literal("started"), Type.Literal("finished"),
  Type.Literal("skipped"), Type.Literal("stalled"), Type.Literal("failed"),
]);

export const RunViewSchema = Type.Object({
  timerId: TimerIdSchema,
  dueAt: EpochMsSchema,
  status: RunStatusSchema,
  threadId: Type.Union([ThreadIdSchema, Type.Null()]),
  missed: Type.Boolean(),
  startedAt: Type.Union([EpochMsSchema, Type.Null()]),
  endedAt: Type.Union([EpochMsSchema, Type.Null()]),
  reason: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
});

export const TimerViewSchema = Type.Object({
  timerId: TimerIdSchema,
  spec: TimerSpecSchema,
  prompt: PromptSchema,
  title: Type.Union([Type.String(), Type.Null()]),
  workspace: Type.Union([Type.String(), Type.Null()]),
  missed: MissedPolicySchema,
  enabled: Type.Boolean(),
  nextDueAt: Type.Union([EpochMsSchema, Type.Null()]),
  lastRun: Type.Union([RunViewSchema, Type.Null()]),
  createdAt: EpochMsSchema,
  createdBy: Type.Object({
    threadId: Type.Union([ThreadIdSchema, Type.Null()]),
    producer: Type.String({ maxLength: 96 }),     // "user" | "model" | "x.<ext>" | "grp.<group>"
  }),
});
export type TimerView = Static<typeof TimerViewSchema>;

export const ScheduleWarningSchema = Type.Union([
  /** 서비스 모드가 꺼져 있어 앱이 열려 있을 때만 실행된다(§4.4.6) */
  Type.Literal("runs_only_while_app_open"),
  /** 다음 기한이 l2.schedule.timers.minIntervalSeconds보다 가까움 */
  Type.Literal("interval_clamped"),
]);

function renderTimer(out: { timer: TimerView; warnings: readonly string[] }): ToolContent {
  const next = out.timer.nextDueAt === null ? "none" : new Date(out.timer.nextDueAt).toISOString();
  return {
    content: [{ type: "text", text: `timer ${out.timer.timerId} next=${next}${out.warnings.length ? ` warnings=${out.warnings.join(",")}` : ""}` }],
  };
}

export const ScheduleTimers = defineCapability({
  id: "schedule.timers",
  version: "1.0.0",
  description: "cron·at 예약. 기한마다 새 세션을 만들어 프롬프트를 실행한다. 서비스 모드에서 앱을 닫아도 돈다.",
  service: {
    methods: {
      create: {
        description: "예약을 만든다.",
        input: Type.Object({
          spec: TimerSpecSchema,
          prompt: PromptSchema,
          title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
          workspace: Type.Optional(Type.String({ maxLength: 4096 })),
          missed: Type.Optional(MissedPolicySchema),           // 생략하면 l2.schedule.timers.missedPolicy
          enabled: Type.Optional(Type.Boolean()),               // 기본 참
        }),
        output: Type.Object({ timer: TimerViewSchema, warnings: Type.Array(ScheduleWarningSchema) }),
        replay: "safe",
        errors: {
          cron_invalid: {
            description: "cron 식이나 시간대를 해석할 수 없음",
            retryable: false,
            detail: Type.Object({ field: Type.String(), message: Type.String() }),
          },
          at_in_past: { description: "at 시각이 이미 지남", retryable: false },
          timer_limit_reached: { description: "켜진 예약이 l2.schedule.timers.maxActive를 넘음", retryable: false },
        },
      },
      list: {
        description: "예약 목록.",
        input: Type.Object({
          enabled: Type.Optional(Type.Boolean()),
          cursor: Type.Optional(Type.String({ maxLength: 128 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
        }),
        output: Type.Object({ items: Type.Array(TimerViewSchema), nextCursor: Type.Union([Type.String(), Type.Null()]) }),
        replay: "safe",
      },
      cancel: {
        description: "예약을 지운다. 이미 시작한 실행은 끝까지 간다.",
        input: Type.Object({ timerId: TimerIdSchema }),
        output: TimerViewSchema,
        replay: "safe",
      },
      runs: {
        description: "예약의 실행 기록.",
        input: Type.Object({
          timerId: TimerIdSchema,
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 20 })),
        }),
        output: Type.Object({ items: Type.Array(RunViewSchema) }),
        replay: "safe",
      },
    },
  },
  tools: [
    {
      name: "schedule_create",
      label: "예약 만들기",
      description:
        "정해진 시각(at)이나 주기(cron, 5필드)에 새 세션에서 prompt를 실행하도록 예약한다. 사용자가 예약을 요청했을 때만 쓴다.",
      method: "create",
      parameters: Type.Object({
        cron: Type.Optional(Type.String({ minLength: 9, maxLength: 128 })),
        at: Type.Optional(Type.String({ format: "date-time" })),
        tz: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
        prompt: PromptSchema,
        title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      }),
      // cron과 at 중 정확히 하나. 둘 다 있거나 없으면 at 쪽 스키마 검사에서 거부된다(§4.4.2 마지막 항목)
      toInput: (p) => ({
        spec: p.cron !== undefined && p.at === undefined
          ? (p.tz === undefined ? { type: "cron", expr: p.cron } : { type: "cron", expr: p.cron, tz: p.tz })
          : { type: "at", at: p.at ?? "" },
        prompt: p.prompt,
        ...(p.title === undefined ? {} : { title: p.title }),
      }),
      toContent: renderTimer,
      replay: "safe",
      executionMode: "sequential",
      hints: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    },
    {
      name: "schedule_list",
      label: "예약 목록",
      description: "예약 목록과 다음 실행 시각을 본다.",
      method: "list",
      parameters: Type.Object({ enabled: Type.Optional(Type.Boolean()) }),
      toInput: (p) => (p.enabled === undefined ? {} : { enabled: p.enabled }),
      toContent: (out) => ({
        content: [{
          type: "text",
          text: out.items.map((t) =>
            `${t.timerId} ${t.spec.type === "cron" ? t.spec.expr : t.spec.at} next=${t.nextDueAt ?? "none"} ${t.title ?? ""}`,
          ).join("\n") || "no timers",
        }],
      }),
      replay: "safe",
      executionMode: "parallel",
      hints: { readOnly: true, openWorld: false },
    },
    {
      name: "schedule_cancel",
      label: "예약 취소",
      description: "예약을 지운다.",
      method: "cancel",
      parameters: Type.Object({ timerId: TimerIdSchema }),
      toInput: (p) => ({ timerId: p.timerId }),
      toContent: (out) => ({ content: [{ type: "text", text: `timer ${out.timerId} cancelled` }] }),
      replay: "safe",
      executionMode: "sequential",
      hints: { readOnly: false, destructive: true, idempotent: true, openWorld: false },
    },
  ],
});
export const ScheduleTimersKey = serviceKey(ScheduleTimers);
```

- `schedule_cancel`의 `parameters`는 메서드 입력과 같은 모양이지만 `toInput`을 둔다. 정의가 같아도 이 문서의 모든 도구에 `toInput`을 두어 규칙을 하나로 맞춘다.
- `schedule_create`의 `cron`·`at` 둘 중 하나 규칙은 JSON Schema `oneOf`로 표현할 수 있지만 provider 호환을 위해 단순 객체로 두고 `toInput`이 at 스키마(`format: "date-time"`)의 실패로 거부를 만든다. [가정] L1.tools가 `toInput` 결과를 메서드 입력 스키마로 다시 검사한다. 검사하지 않으면 provider가 `invalid_input`을 낸다.

### 3.6 `schedule.remote`

```ts
// defs/schedule.ts (6/6)
export const PendingRequestSchema = Type.Object({
  approvalId: Type.String({ minLength: 1, maxLength: 64 }),
  threadId: ThreadIdSchema,
  /** approval.requested의 종류. L2가 쓰는 kind 넷(L2.readme §5.7). review는 L1.tools 요청([미결] L2.readme §10 미결 14) */
  kind: Type.Union([Type.Literal("tool"), Type.Literal("question"), Type.Literal("plan"), Type.Literal("review")]),
  /** 원격 화면용 요약. 비밀 값과 도구 출력 원문을 담지 않는다(§4.5.2) */
  summary: Type.String({ maxLength: 500 }),
  requestedAt: EpochMsSchema,
});

export const ScheduleRemote = defineCapability({
  id: "schedule.remote",
  version: "1.0.0",
  description: "원격 클라이언트가 승인과 질문에 답하는 흐름의 정책과 중계. 전송은 L4가 소유한다.",
  service: {
    methods: {
      status: {
        description: "원격 승인 기능 상태.",
        input: Type.Object({}),
        output: Type.Object({
          enabled: Type.Boolean(),
          /** L4 원격 연결 상태. off: 설정 꺼짐, listening: 서비스 소켓에서 원격 토큰 연결을 받는 중, unavailable: 서비스 모드 꺼짐 */
          transport: Type.Union([Type.Literal("off"), Type.Literal("listening"), Type.Literal("unavailable")]),
          remoteClients: Type.Integer({ minimum: 0 }),
        }),
        replay: "safe",
      },
      pending: {
        description: "모든 세션의 답을 기다리는 요청(승인, 질문).",
        input: Type.Object({ threadId: Type.Optional(ThreadIdSchema) }),
        output: Type.Object({ items: Type.Array(PendingRequestSchema) }),
        replay: "safe",
      },
      respond: {
        description: "원격 클라이언트의 답을 승인 프로토콜로 전달한다.",
        input: Type.Object({
          approvalId: Type.String({ minLength: 1, maxLength: 64 }),
          decision: Type.Union([Type.Literal("allow"), Type.Literal("deny"), Type.Literal("answer")]),
          answer: Type.Optional(Type.Unknown()),
          remember: Type.Optional(Type.Union([Type.Literal("once"), Type.Literal("thread"), Type.Literal("always")])),
          /** L4 host가 인증한 원격 클라이언트 id. 모델·그룹은 이 메서드를 부르지 않는다 */
          clientId: Type.String({ minLength: 1, maxLength: 64 }),
        }),
        output: Type.Object({ applied: Type.Boolean() }),
        replay: "safe",
        errors: {
          remote_disabled: { description: "l2.schedule.remote.enabled가 거짓", retryable: false },
          respond_not_allowed: { description: "이 종류의 요청에 원격 답을 허용하지 않음", retryable: false },
          remember_not_allowed: { description: "원격에서 always를 고를 수 없음", retryable: false },
        },
      },
    },
  },
  tools: [],
});
export const ScheduleRemoteKey = serviceKey(ScheduleRemote);
```

- `schedule.remote`는 도구가 없는 능력이다. 도구 없는 능력의 허용은 `F.capabilities.spec` §4.4 [미결]이다. 허용되지 않으면 이 능력은 서비스 정의 없이 `cap-schedule` 내부 API(`SchedulerHost`, §3.9)로 옮긴다(§10 미결 8).
- `respond`의 입력은 F wire `approval.respond` params(`F.wire-settings.spec` §3.3.1)에 `clientId`를 더한 모양이다.

### 3.7 이벤트 카탈로그 (`schedule.*`)

[제안] 소유 생산자 id는 `cap.schedule`(`eng.context-map.design` §5.1). 카탈로그 파일은 `xeon/packages/contracts/src/records/catalog/schedule.ts`이고 `CatalogEntry`(`F.records.spec` §3.3) 배열 `SCHEDULE_EVENT_CATALOG`를 export한다(`F.records.spec` §3.3.2 도메인 소유 카탈로그, `L2.readme` §5.9). 모두 version 1, 내구다. 휘발 type은 두지 않는다(`schedule.` 휘발은 예약). `schedule` 영역과 `TYPE_PREFIX_OWNERS`의 `schedule.` → `cap.schedule` 행은 `F.records.spec` §3.3.2에 있다. 모든 이벤트는 세션 이벤트이고 envelope `threadId`가 대상 세션이다.

<!-- catalog:schedule:start -->
| kind | durable | payload 스키마 | 기록하는 세션 | 생산 시점 |
|---|---|---|---|---|
| `schedule.loop_started` | 예 | `LoopStartedPayloadSchema` | 루프 세션 | `loops.start` |
| `schedule.loop_iterated` | 예 | `LoopIteratedPayloadSchema` | 루프 세션 | 반복 투입 직후 |
| `schedule.loop_stopped` | 예 | `LoopStoppedPayloadSchema` | 루프 세션 | 종료 조건, `stop`, 만료, 호스트 종료 정리 |
| `schedule.wakeup_scheduled` | 예 | `WakeupScheduledPayloadSchema` | 대상 세션 | `loops.wakeup` |
| `schedule.wakeup_fired` | 예 | `WakeupFiredPayloadSchema` | 대상 세션 | 웨이크업 투입 직후 |
| `schedule.wakeup_cancelled` | 예 | `WakeupCancelledPayloadSchema` | 대상 세션 | 새 웨이크업으로 대체, 루프 멈춤, 호스트 종료 정리 |
| `schedule.timer_created` | 예 | `TimerCreatedPayloadSchema` | 만든 세션(있을 때만) | `timers.create` 감사 기록 |
| `schedule.timer_cancelled` | 예 | `TimerCancelledPayloadSchema` | 취소한 세션(있을 때만) | `timers.cancel` 감사 기록 |
| `schedule.run_started` | 예 | `RunStartedPayloadSchema` | 실행 세션(새 세션) | 예약 실행 시작 |
| `schedule.run_stalled` | 예 | `RunStalledPayloadSchema` | 실행 세션 | 워치독이 멈춘 실행을 중단 |
| `schedule.run_finished` | 예 | `RunFinishedPayloadSchema` | 실행 세션 | 실행 세션의 턴 종결 뒤 |
| `schedule.watch_started` | 예 | `WatchStartedPayloadSchema` | 감시 세션 | `jobs.watch` |
| `schedule.watch_matched` | 예 | `WatchMatchedPayloadSchema` | 감시 세션 | 필터 일치와 입력 투입 |
| `schedule.watch_stopped` | 예 | `WatchStoppedPayloadSchema` | 감시 세션 | `unwatch`, 상한, 출처 종료 |
| `schedule.remote_responded` | 예 | `RemoteRespondedPayloadSchema` | 승인 요청 세션 | `remote.respond` 감사 기록 |
<!-- catalog:schedule:end -->

```ts
// xeon/packages/contracts/src/records/catalog/schedule.ts
export interface LoopStartedPayload {
  loopId: string;
  prompt: string;
  until: { type: "count"; iterations: number } | { type: "duration"; seconds: number }
       | { type: "shell"; command: string; cwd: string | null; successExitCode: number; timeoutSeconds: number }
       | { type: "model" };
  interval: { type: "fixed"; seconds: number } | { type: "self" };
  maxIterations: number;
  expiresAt: number;                // epoch ms. 시작 커밋 전에 주입 시계로 계산
  goalId: string | null;
  startedBy: string;                // "user" | "model" | "x.<ext>" | "grp.<group>"
}
export interface LoopIteratedPayload { loopId: string; iteration: number; requestId: string }
export interface LoopStoppedPayload {
  loopId: string;
  reason: "count" | "duration" | "shell" | "model" | "goal" | "max_iterations" | "expired" | "user" | "host_exit" | "error";
  iterations: number;
  detail: string | null;            // shell 종료 코드, 오류 요약 등. 500자 이하
}
export interface WakeupScheduledPayload {
  wakeupId: string; dueAt: number; prompt: string; loopId: string | null; toolCallId: string | null;
  replaces: string | null;          // 대체한 이전 wakeupId
}
export interface WakeupFiredPayload { wakeupId: string; requestId: string; firedAt: number }
export interface WakeupCancelledPayload { wakeupId: string; reason: "replaced" | "loop_stopped" | "host_exit" | "user" }
export interface TimerCreatedPayload {
  timerId: string;
  spec: { type: "cron"; expr: string; tz: string | null } | { type: "at"; at: string };
  title: string | null;
  missed: "skip" | "once" | "all";
}
export interface TimerCancelledPayload { timerId: string }
export interface RunStartedPayload {
  timerId: string;
  dueAt: number;
  firedAt: number;
  missed: boolean;                  // 놓친 기한을 따라잡은 실행이면 참
  /** 예약 세션 표식. L3 그룹이 예약 세션에서 자기 동작을 줄이는 근거로 읽는다(§4.4.8) */
  origin: "timer";
  requestId: string;                // timer:<timerId>:<dueAt>
}
export interface RunStalledPayload { timerId: string; dueAt: number; idleSeconds: number }
export interface RunFinishedPayload {
  timerId: string; dueAt: number;
  outcome: "completed" | "aborted" | "failed" | "awaiting_approval";
}
export interface WatchStartedPayload {
  watchId: string; source: JsonValue; filter: JsonValue; notify: "steer" | "followUp" | "next"; maxMatches: number;
}
export interface WatchMatchedPayload { watchId: string; match: number; requestId: string; excerpt: string }   // excerpt 500자 이하, 마스킹 후
export interface WatchStoppedPayload { watchId: string; reason: "user" | "max_matches" | "source_ended" | "host_exit" }
export interface RemoteRespondedPayload {
  approvalId: string; clientId: string; decision: "allow" | "deny" | "answer"; remember: "once" | "thread" | null;
}
```

- 타이머 자체(정의, 다음 기한)와 실행 기록은 세션 밖 상태라 이벤트가 정본이 아니다(§3.8). `schedule.timer_created`·`timer_cancelled`는 대화 맥락에서 누가 예약을 만들었는지 남기는 감사 기록이다. 세션 없이(설정 화면, CLI 명령) 만든 예약은 이 이벤트가 없다.
- `schedule.run_finished`와 `schedule.run_stalled`는 알림 대상 kind다(`L4.host-service.spec` HS-42 "사건을 낸 층의 이벤트 kind로 정한다").
- `schedule.watch_matched.excerpt`는 프로세스 출력 일부라 L0.secrets 마스킹을 거친 텍스트만 싣는다.

### 3.8 테이블 (`cap_schedule_`)

[제안] 두 종류가 섞인다(`L2.readme` §5.4). 세션 투영 테이블은 `cap.schedule` 투영기가 쓰고 재생으로 다시 만든다. 세션 밖 상태 테이블은 `xeon.store.scoped`로 쓰고 재생 대상이 아니다.

```sql
-- 세션 투영 (투영기 cap.schedule, 재생 가능)
CREATE TABLE cap_schedule_loops (
  loop_id        TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL,
  prompt         TEXT NOT NULL,
  until_json     TEXT NOT NULL,
  interval_json  TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('running','stopped')),
  iteration      INTEGER NOT NULL,
  max_iterations INTEGER NOT NULL,
  started_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL,
  goal_id        TEXT,
  stopped_reason TEXT,
  started_seq    INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX cap_schedule_loops_one_running ON cap_schedule_loops(session_id) WHERE status = 'running';

CREATE TABLE cap_schedule_wakeups (
  wakeup_id  TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  due_at     INTEGER NOT NULL,
  prompt     TEXT NOT NULL,
  loop_id    TEXT,
  status     TEXT NOT NULL CHECK (status IN ('pending','fired','cancelled'))
) STRICT;

CREATE TABLE cap_schedule_watches (
  watch_id    TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  source_json TEXT NOT NULL,
  filter_json TEXT NOT NULL,
  notify      TEXT NOT NULL,
  matches     INTEGER NOT NULL,
  max_matches INTEGER NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('active','stopped'))
) STRICT;

CREATE TABLE cap_schedule_session_runs (       -- 실행 세션 ↔ 타이머 대응(run_started/finished에서)
  session_id TEXT PRIMARY KEY,
  timer_id   TEXT NOT NULL,
  due_at     INTEGER NOT NULL,
  outcome    TEXT
) STRICT;

-- 세션 밖 상태 (xeon.store.scoped, 재생 대상 아님)
CREATE TABLE cap_schedule_timers (
  timer_id      TEXT PRIMARY KEY,
  spec_type     TEXT NOT NULL CHECK (spec_type IN ('cron','at')),
  cron_expr     TEXT,
  tz            TEXT,
  at_ms         INTEGER,
  prompt        TEXT NOT NULL,
  title         TEXT,
  workspace     TEXT,
  missed        TEXT NOT NULL CHECK (missed IN ('skip','once','all')),
  enabled       INTEGER NOT NULL CHECK (enabled IN (0,1)),
  next_due_at   INTEGER,                 -- NULL: 더 실행할 기한 없음
  last_due_at   INTEGER,
  created_at    INTEGER NOT NULL,
  created_by    TEXT NOT NULL,
  created_in    TEXT,                    -- 만든 세션 id
  cancelled_at  INTEGER,
  rev           INTEGER NOT NULL,        -- 낙관적 동시성
  request_id    TEXT UNIQUE              -- create 호출의 requestId. 같은 키 재호출은 저장된 타이머를 돌려준다
) STRICT;
CREATE INDEX cap_schedule_timers_due ON cap_schedule_timers(next_due_at) WHERE enabled = 1;

CREATE TABLE cap_schedule_runs (
  timer_id     TEXT NOT NULL,
  due_at       INTEGER NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('claimed','started','finished','skipped','stalled','failed')),
  missed       INTEGER NOT NULL CHECK (missed IN (0,1)),
  session_id   TEXT,
  lease_epoch  INTEGER NOT NULL,         -- 이 행을 쓴 scheduler 임대의 epoch(펜싱 확인용)
  claimed_at   INTEGER NOT NULL,
  started_at   INTEGER,
  ended_at     INTEGER,
  reason       TEXT,
  PRIMARY KEY (timer_id, due_at)
) STRICT;
CREATE INDEX cap_schedule_runs_open ON cap_schedule_runs(status) WHERE status IN ('claimed','started');
```

- `cap_schedule_runs`의 기본 키 `(timer_id, due_at)`가 같은 기한의 중복 실행을 막는 첫 장치다(§4.4.4).
- `timers.create`의 `replay: "safe"`는 `request_id` 유일 제약에 기댄다. 같은 `requestId`로 다시 부르면 새 타이머를 만들지 않고 저장된 타이머를 돌려준다. `requestId` 없이 부른 서비스 호출은 멱등이 없다. `worktreeCreate`도 같은 브랜치의 워크트리가 기대 경로에 이미 있으면 `branch_exists` 대신 그 워크트리를 돌려준다. 그래서 재실행이 효과를 두 번 내지 않는다.
- 세션 투영 테이블은 `session_id` 열을 두어 세션 삭제 때 함께 지워진다(`eng.context-map.design` §5.2). 세션 밖 테이블은 세션 삭제와 무관하다. 실행 세션이 지워지면 `cap_schedule_runs.session_id`는 낡은 값이 되고, 목록은 그 세션을 "삭제됨"으로 보인다.
- 실행 기록 보관: 타이머마다 최근 `l2.schedule.timers.keepRuns`(기본 100)건만 남기고 오래된 `finished`·`skipped` 행을 지운다.

### 3.9 호스트 연동 인터페이스 (`SchedulerHost`)

[제안] 틱 시작·정지와 대기 예약 수는 능력 메서드로 두지 않는다. 모델이나 그룹이 부를 일이 아니고, 호스트가 동기로 읽어야 하기 때문이다(`L4.host-service.spec` `ActivityPort.snapshot()`은 동기). `cap-schedule`이 패키지 export로 내고 조립 루트(`apps/host`)만 import한다(`eng.context-map.design` §4.3 "조립 루트만: 모든 패키지 import").

```ts
// xeon/packages/cap-schedule/src/tick/host.ts
export interface SchedulerHost {
  /** scheduler 임대를 얻으려 시도하고, 얻으면 틱을 시작한다. 이미 돌고 있으면 아무것도 하지 않는다 */
  startTick(options: { readonly mode: "service" | "app" }): Promise<{ readonly holding: boolean }>;
  /** 틱을 멈추고 임대를 반납한다. 진행 중 실행은 멈추지 않는다 */
  stopTick(): Promise<void>;
  /** ActivitySnapshot.pendingSchedules에 쓴다. 켜진 타이머 중 next_due_at이 있는 수 + claimed·started 실행 수 */
  pendingSchedules(): number;
  /** 루프·웨이크업·감시 중 이 프로세스 메모리에서 도는 것의 수. ActivitySnapshot.liveTasks에 더한다 [제안] */
  liveSchedulerTasks(): number;
  onChange(listener: () => void): () => void;
}
export function createSchedulerHost(deps: SchedulerHostDeps): SchedulerHost;
```

- `pendingSchedules()`는 DB의 대기 예약을 센다. 그래서 틱을 돌리지 않는 프로세스(임대를 못 얻은 앱)도 같은 값을 낸다. 서비스가 이 값으로 유휴 종료를 판정한다(ADR-0006 §3.4, §4.4.7).
- 값은 메모리 캐시이고 타이머 생성·취소·실행 상태 변화 때 갱신된다. 다른 프로세스가 바꾼 경우를 위해 틱마다 DB에서 다시 센다.

### 3.10 요구하는 하위 서비스 [가정]

이 능력이 쓰는 부분만 적는다. 정본은 괄호 안 문서다.

```ts
// L0.store.spec §3.1 (xeon.store) — 임대. 동기 Result를 돌려준다
//   acquire(resource: LeaseResource, holder: LeaseHolder): Result<LeaseToken, LeaseError>
//   renew(token: LeaseToken): Result<void, LeaseError>         // 소유가 바뀌었으면 lease_lost
//   release(token: LeaseToken): Result<void, LeaseError>
//   holds(tx: SqlTx, token: LeaseToken): boolean               // 쓰기 트랜잭션 안에서 행을 새로 읽어 대조(TX-10)
//   keepAlive(token: LeaseToken, onLost: (resource: LeaseResource) => void): Disposable
type LeaseUsedBySchedule = Pick<LeaseService, "acquire" | "renew" | "release" | "holds" | "keepAlive">;   // resource는 "scheduler"
// L1.tasks.spec (xeon.tasks)
interface TaskPostApi {
  post(threadId: ThreadId, item: PostItem, options: PostOptions): Promise<PostReceipt>;
  interrupt(threadId: ThreadId): Promise<boolean>;
}
// L1.persistence.spec (xeon.session)
interface SessionApiUsedBySchedule {
  create(input: { workspace?: string; title?: string; origin?: "timer" }, options: { requestId: string }): Promise<{ threadId: ThreadId }>;
  commit(input: { threadId: ThreadId; producer: "cap.schedule"; requestId: string; drafts: readonly { kind: string; payload: unknown }[] }):
    Promise<{ replayed: boolean }>;
  lastDurableAt(threadId: ThreadId): number | null;    // 워치독(§4.4.5)
}
// L1.agents.spec (xeon.agents)
interface AgentApiUsedBySchedule {
  spawnBackground(input: { parentThreadId: ThreadId; prompt: string; agent?: string; detached: boolean },
                  options: { requestId: string }): Promise<{ childThreadId: ThreadId }>;
  cancel(childThreadId: ThreadId): Promise<void>;
}
// L0.process.spec (xeon.process)
interface ProcessApiUsedBySchedule {
  list(): readonly { id: string; threadId: ThreadId | null; command: string; state: "running" | "exited" | "killed"; exitCode: number | null; startedAt: number; endedAt: number | null }[];
  onOutput(id: string, listener: (chunk: { stream: "stdout" | "stderr"; text: string }) => void): () => void;
  onExit(id: string, listener: (code: number | null) => void): () => void;
  spawnBackground(input: { command: string; cwd?: string; threadId: ThreadId; detached: boolean }): Promise<{ id: string }>;
  kill(id: string): Promise<void>;
}
// L0.os.spec §3.10 (xeon.os)
//   time.scheduler.setTimeout(fn: () => void, ms: number): TimerHandle / clearTimeout(handle)   (§3.4)
//   watch(root: string, opts: WatchOptions, onBatch: (changes: readonly FileChange[]) => void):
//     Promise<Result<WatchHandle, WatchError>>   (§3.8, 2차. root가 앱 디렉터리 하위가 아니면 outside_app_dirs)
//   notify는 쓰지 않는다. 알림 채널은 dialog.notify 소관이다(§4.5.4)
type OsUsedBySchedule = Pick<OsService, "time" | "watch">;
// 워크트리 연산(create, list, remove)은 L0.os.spec에 없다. [미결] §10 미결 13
```

- `eng.context-map.design` §4.1 schedule 행의 (d)열은 `xeon.store`, `xeon.tasks`, `xeon.process`, `xeon.os`다. 이 문서는 `xeon.session`(세션 생성·커밋), `xeon.agents`(위임 작업), `xeon.approvals`(입력 필요 분류, 원격 답), `xeon.exec`·`xeon.sandbox`(셸 종료 조건)를 더 쓴다. 개정 요청은 §10 미결 4다.

### 3.11 서비스 묶음

```ts
// defs/schedule.ts (끝부분)
/** schedule 도메인 묶음 타입(L2.readme §5.6). Cordis에 등록하지 않는다. 등록은 능력마다 cap:<id> 바인딩이다 */
export interface ScheduleService {
  readonly loops: CapabilityApi<typeof ScheduleLoops>;
  readonly jobs: CapabilityApi<typeof ScheduleJobs>;
  readonly sessions: CapabilityApi<typeof ScheduleSessions>;
  readonly timers: CapabilityApi<typeof ScheduleTimers>;
  readonly remote: CapabilityApi<typeof ScheduleRemote>;
}
/** 묶음 이름. eng.context-map.design §5.3 표의 이름이고 Cordis 등록 이름이 아니다 */
export const ScheduleServiceName = "xeon.schedule" as const;
export const SCHEDULE_CAPABILITIES = [ScheduleLoops, ScheduleJobs, ScheduleSessions, ScheduleTimers, ScheduleRemote] as const;
```

- 인터페이스 이름 `ScheduleService`는 `eng.context-map.design` §5.3 표를 따른다. consumer는 `ScopeApi.capability(ScheduleLoopsKey)`처럼 능력 단위 키로 API를 얻는다(`L2.readme` §5.6). `SchedulerHost`(§3.9)는 이 묶음에 넣지 않는다. 호스트 연동용이고 능력 API가 아니기 때문이다.

## 4. 동작 규칙

### 4.1 루프와 웨이크업

#### 4.1.1 반복 방식

- 루프는 같은 세션에 같은 프롬프트를 `post`로 반복 투입한다. `PostItem`은 `{ kind: "user", content: prompt }`, `when`은 `"next"`, `requestId`는 `loop:<loopId>:<iteration>`이다. `next`는 다음 경계 뒤에 모델 요청을 정확히 한 번 일으키는 입력이다(`F.extensions.spec` §4.4).
- 한 세션에 도는 루프는 하나다(`loop_already_running`). 투영의 부분 유일 인덱스가 같은 규칙을 강제한다.
- 반복 경계는 그 반복이 만든 turn의 정착이다. provider는 `boundary.settle.after`(F.extensions.spec #26, tap) 핸들러에서 반복 종료를 감지한다. 핸들러는 판정만 하고, 다음 투입은 커밋 밖에서 한다(TX-01).
- 반복 n의 투입 순서: (1) 종료 조건 판정, (2) 멈추지 않으면 간격만큼 대기, (3) `schedule.loop_iterated { iteration: n }` 커밋, (4) post. (3)과 (4) 사이에 프로세스가 죽어도 재시작 뒤 같은 `requestId`로 post하면 한 번만 들어간다.
- 사용자 입력이 루프 반복 사이에 끼어도 루프는 계속된다. 사용자가 루프를 멈추려면 `stop`(명령 `/loop stop`)을 쓴다.
- 근거: Claude Code `/loop`(같은 세션 반복, 세션이 열려 있어야 함, 7일 만료), omp `/loop --until`, Hermes `/loop`의 `LOOP_COMPLETE`(`_research/l2e.md` §3.4 D2, `_research/refs/claude-code.md` 148행).

#### 4.1.2 종료 조건 4종과 상한

| 조건 | 판정 시점 | 판정 | 멈춤 사유 |
|---|---|---|---|
| 횟수 `count` | 반복 정착 뒤 | `iteration ≥ iterations` | `count` |
| 시간 `duration` | 반복 정착 뒤, 대기 중 타이머 | `now - startedAt ≥ seconds`. 대기 중에 넘으면 다음 반복을 투입하지 않는다 | `duration` |
| 셸 `shell` | 반복 정착 뒤 | 명령을 `xeon.exec`(샌드박스 정책 적용)로 실행해 종료 코드가 `successExitCode`면 멈춘다. 시간 초과는 "조건 미충족"으로 본다. 실행 자체가 3회 연속 실패하면 `error` | `shell` |
| 모델 `model` | 반복 중 | 반복 turn 안에서 `loop_done` 도구가 불리면 그 turn이 정착할 때 멈춘다. 이 조건의 루프에서만 `loop_done`을 광고한다 | `model` |

- 모든 루프는 종료 조건과 별도로 두 상한을 갖는다.
  - 반복 상한 `maxIterations`: 입력값과 설정 `l2.schedule.loops.maxIterations` 중 작은 값. 도달하면 `max_iterations`.
  - 만료 `expiresAt`: 시작 + `expiresInHours`(기본·상한 설정 `l2.schedule.loops.maxLifetimeHours`, 기본 168시간). Claude Code의 7일 만료를 참고값으로 쓴다(`_research/refs/claude-code.md` 148행). 도달하면 `expired`.
- 판정 순서는 `model` → `goal` → `count` → `shell` → `duration` → `max_iterations` → `expired`다. 여러 조건이 같은 경계에서 맞으면 앞의 사유를 기록한다.
- 셸 조건 명령의 승인: 루프를 사용자 명령으로 시작했으면 명령도 사용자가 정한 것이므로 반복마다 승인을 묻지 않는다. 그룹 코드가 시작했으면 시작 때 `xeon.approvals`에 `tool` kind 승인을 한 번 요청한다 [제안]. 셸 명령은 매 반복 다시 실행되기 때문이다. 승인 정책 자체는 L1.tools가 정한다.
- 상한 없는 루프는 만들 수 없다. 근거: "상한 없는 루프는 비용 사고로 이어진다"(`_research/items-from-refs.md` L1-b 종료 조건 집합 행).

#### 4.1.3 간격과 웨이크업

- `interval.fixed`: 반복 정착 뒤 `seconds` 대기. 0이면 바로 다음 반복이다. 대기는 `xeon.os`의 `time.scheduler.setTimeout`으로 한다(`L0.os.spec` §3.4). 최소값은 설정 `l2.schedule.loops.minIntervalSeconds`(기본 0)다.
- `interval.self`: 반복 turn 안에서 `schedule_wakeup`이 불리면 그 기한에 다음 반복을 투입한다. 불리지 않으면 모델이 계속할 뜻이 없다고 보고 `model` 사유로 멈춘다. Claude Code의 동적 `/loop`가 `ScheduleWakeup`으로 간격을 정하는 방식이다(`_research/l2e.md` §3.4 D2).
- 루프 밖 웨이크업: 루프가 없는 세션에서 `schedule_wakeup`을 부르면 일회성 웨이크업이다. 기한이 되고 그 세션의 진행 중 turn이 정착해 있으면 `post({ kind: "user", content: prompt }, { when: "next", requestId: "wake:<wakeupId>" })`로 투입하고 `schedule.wakeup_fired`를 커밋한다. turn이 진행 중이면 정착을 기다렸다가 투입한다.
- 한 세션에 대기 중인 웨이크업은 하나다. 새 웨이크업은 이전 것을 `wakeup_cancelled { reason: "replaced" }`로 바꾼다 [제안]. 모델이 웨이크업을 쌓아 폭주하지 않게 하려는 것이다.
- 웨이크업 지연 범위는 30초~24시간이다. 24시간이 넘는 대기는 `schedule.timers`를 쓴다.

#### 4.1.4 목표 판정과의 결합

- `goalId`를 주면 `work.goals`를 선택 의존(`optional`)으로 부른다(`L2.readme` §6). provider가 없으면 `goal_unavailable`이다.
- [제안] 한 스레드에서 다음 턴을 투입하는 L2 주체는 하나다. `goalId`를 가진 루프(`schedule.loops`)에서는 루프가 반복마다 다음 턴을 투입하고 `work.goals`는 판정만 기록하며 post하지 않는다. 목표의 `continuation`이 `"external"`이면 이 규칙이 적용되고, `schedule.loops.start`는 `continuation: "self"` 목표를 거부한다(`L2.readme` §4.2, `L2.work.spec` §4.3.5). 그래서 `goal:<goalId>:<n>` post와 `loop:<loopId>:<iteration>` post가 같은 스레드에 함께 들어가지 않는다. `start`는 `work.goals.status({ goalId })`의 `goal.continuation`이 `"external"`이 아니면 `invalid_input`(`detail.reason: "goal_continuation_self"`)이다.
- 반복 정착 뒤 `work.goals.status({ goalId })`가 완료(판정 통과)를 돌려주면 `goal` 사유로 멈춘다. 판정 모델 호출과 판정 횟수 상한은 `work.goals`의 것이다(`foundation-plan.md` §1 결정 4). 이 능력은 결과만 읽는다.
- 루프는 목표 판정을 직접 하지 않는다. `goalId`가 없으면 목표와 무관하게 위 4종 조건으로만 멈춘다.

#### 4.1.5 앱 종료와 서비스 모드

- 루프·웨이크업·감시의 대기는 프로세스 메모리의 타이머다. 그래서 세션을 실행하던 프로세스가 끝나면 멈춘다. 서비스 모드가 꺼진 상태에서 앱이나 CLI를 닫으면 루프가 멈춘다는 뜻이다. `start`는 서비스 모드가 꺼져 있을 때 결과의 사용자 표시용 문구로 이 점을 알린다(L4가 표시).
- 서비스 모드에서는 세션의 쓰기 소유자가 서비스다(ADR-0006 §3.6). 클라이언트가 모두 끊겨도 서비스가 루프를 계속 돌린다. 이 동안 서비스는 `liveSchedulerTasks() > 0`이므로 유휴 종료하지 않는다(§3.9) [제안: ActivitySnapshot.liveTasks에 루프를 포함].
- 재시작 정리: 세션을 연 프로세스는 `session.start`(#30) 때 투영에 `running`인 루프와 `pending` 웨이크업·`active` 감시가 있고 자기 메모리에 해당 타이머가 없으면 `schedule.loop_stopped { reason: "host_exit" }`, `wakeup_cancelled { reason: "host_exit" }`, `watch_stopped { reason: "host_exit" }`를 커밋한다. 자동으로 다시 시작하지 않는다 [제안]. ADR-0006 §3.6 5번의 자동 재개 기본값 꺼짐과 맞춘다. L4가 "루프를 다시 시작" 제안을 보여 줄 수 있다.

### 4.2 백그라운드 작업 모니터

#### 4.2.1 상태 분류

[제안] 출처마다 아래 표로 4상태를 정한다. "입력 필요"는 승인 대기와 질문 대기를 하나로 묶는다. Warp가 명령 승인, 권한 요청, 유휴 프롬프트를 "입력 필요" 한 상태로 묶는 방식을 따른다(`_research/l2e.md` §7 Warp Request 이벤트).

| 출처 | working | needs_input | done | stopped |
|---|---|---|---|---|
| `agent`(L1.agents 위임) | `agent.spawned` 뒤 | 자식 세션에 해결되지 않은 `approval.requested`(kind 무관)가 있음 | `agent.settled` 결과가 성공(`succeeded`) 또는 실패(`failed`) | 취소로 정착 |
| `process`(L0.process) | `running` | 판정하지 않는다 [가정: 프로세스의 입력 대기는 알 수 없음] | `exited`(종료 코드 0이면 `succeeded`) | `killed` |
| `loop` | `running` | 루프 세션에 해결되지 않은 승인 요청 | `count`·`duration`·`shell`·`model`·`goal` 사유로 멈춤 | `user`·`host_exit`·`expired`·`max_iterations`·`error` |
| `run`(예약 실행) | `started` | 실행 세션에 해결되지 않은 승인 요청 | `finished`(턴 결과 `completed`면 `succeeded`) | `stalled`, `skipped`, `failed` |

- 승인 대기 판정은 이벤트로 한다. `cap.schedule` 투영기가 `approval.requested`·`approval.resolved`를 읽어 세션별 대기 수를 세는 보조 테이블을 둔다 [제안]. `p_approvals`는 다른 컨텍스트 테이블이라 읽지 않는다(CM-02).
- `agent` 출처의 목록은 `agent.spawned`·`agent.settled` 이벤트 투영에서 나온다. `process` 출처는 L0.process의 메모리 레지스트리를 그때그때 읽는다. 그래서 프로세스 작업은 프로세스를 띄운 엔진 프로세스 안에서만 보인다.

#### 4.2.2 시작과 멈춤

- `spawn({ task: { kind: "agent" } })`는 `xeon.agents.spawnBackground`로, `{ kind: "process" }`는 `xeon.process.spawnBackground`로 넘긴다. 실행과 결과 전달은 그 서비스가 한다. 위임 결과가 부모 입력 큐에 들어가는 규칙(`deleg:<childSessionId>:done`, `eng.transactions.design` §4.8)도 L1.agents의 것이다.
- `detached: true`는 상주 수준 2다. 서비스 모드가 꺼져 있으면 `unavailable`, `detail.reason: "service_mode_off"`다(`L2.readme` §8).
- 동시 백그라운드 작업 상한은 `l2.schedule.jobs.maxConcurrent`(기본 8)다. 넘으면 `job_limit_reached`(retryable).
- `stop`은 출처별로 위임 취소(`xeon.agents.cancel`), 프로세스 종료(`xeon.process.kill`), 루프 `stop`, 실행 세션 턴 중단(`xeon.tasks.interrupt`)을 부른다.

#### 4.2.3 감시

- `watch`는 출처 이벤트를 구독하다가 필터에 맞으면 감시 세션에 `post({ kind: "user", content: 알림 문구 }, { when: notify, requestId: "watch:<watchId>:<match>" })`를 넣고 `schedule.watch_matched`를 커밋한다. `match`는 1부터 센다. `maxMatches`에 이르면 `watch_stopped { reason: "max_matches" }`다.
- 알림 문구는 출처와 일치 내용 요약(500자 이하, 마스킹 후)이다. 프로세스 출력 전체를 넣지 않는다.
- `regex` 필터는 선형 시간 엔진이 처리할 수 있는 부분 집합만 받는다. 역참조와 전후방 탐색이 있으면 `pattern_rejected`다 [제안]. 프로세스 출력에 정규식 폭주(ReDoS)를 일으키는 패턴이 걸리지 않게 하려는 것이다.
- 세션당 활성 감시 상한은 `l2.schedule.jobs.maxWatches`(기본 16)다.
- 근거: Claude Code `Monitor` 도구(`_research/refs/claude-code.md` 63행), omp `/jobs`(`_research/l2e.md` §3.4 D3).

#### 4.2.4 긴 bash 자동 백그라운드 전환 [미결]

oh-my-pi는 오래 걸리는 bash를 자동으로 백그라운드로 돌린다(`_research/l2e.md` §3.4 D3). 이 전환의 책임이 어디인지 정하지 않았다.

| 후보 | 내용 | 장점 | 단점 |
|---|---|---|---|
| L1.tools | 도구 실행 시간 초과 시 결과를 "백그라운드로 계속"으로 바꾸고 L0.process에 넘긴다 | 모든 오래 걸리는 도구에 같은 규칙 | 도구 결과 계약(`input_required`와 다른 새 상태)이 필요 |
| L2.workspace.shell | bash 도구가 `background` 옵션과 시간 초과 전환을 갖는다 | 셸 도구의 지식이 한 곳에 | 다른 도구에는 적용되지 않는다 |
| schedule.jobs | jobs가 bash 도구 결과를 가로채 전환한다 | 없음 | 도구 실행 경로에 L2가 끼어 들어 의존 방향이 꼬인다 |

- 작성자 제안은 L2.workspace.shell이 전환하고, 전환된 프로세스는 L0.process 레지스트리에 올라가 `schedule.jobs`가 `process` 출처로 분류만 하는 것이다.

### 4.3 다중 세션과 워크트리

- `list`는 세션의 실행 상태(소유자 표시, idle·working·needs_input, 작업 수, 마지막 활동)를 돌려준다. 제목과 라벨은 `artifacts.sessions`가 소유하고, 두 능력은 서로 부르지 않는다. L4 세션 목록 화면이 `threadId`로 두 결과를 합친다 [제안].
- 상태 계산: 진행 중 turn이 있으면 working, 해결되지 않은 승인 요청이 있으면 needs_input(우선), 그 밖에 idle이다. turn 진행 여부는 `turn.started`·`turn.completed`(또는 `turn.ended`) 이벤트 투영으로 센다.
- 소유자 표시는 그 세션의 `sys_leases` 행(`kind`, `host`, `epoch`)에서 온다. 별도 소유자 표시 열은 두지 않는다 [결정: review.decisions-2 U-09]. 표시값은 틀릴 수 있으며 판단 근거로 쓰지 않는다. 읽는 경로는 `xeon.session`의 조회 API다 [가정].
- `create`의 `worktree`는 워크트리를 만든 뒤 그 경로를 `workspace`로 세션을 만든다. 워크트리 연산(만들기, 목록, 지우기)은 `L0.os.spec`에 없다. [미결] L0.os에 연산 추가를 요청할지, `xeon.exec`로 `git worktree`를 실행할지 정한다(§10 미결 13). 워크트리 격리(파일 시스템 경계, 샌드박스 허용 경로)는 L0(`L0.os.spec`, `L0.sandbox.spec`)의 것이다.
- `worktreeRemove`는 그 워크트리를 쓰는 세션 중 working인 것이 있으면 `worktree_in_use`다.
- 워크트리 도구 노출 [제안]: 기본 꺼짐(`l2.schedule.tools.worktree: false`). 선택 기능이고, 켜면 모델이 브랜치와 디렉터리를 만들고 지울 수 있다. 서비스 메서드는 항상 쓸 수 있으므로 L4 명령(`/worktree`)과 그룹은 영향을 받지 않는다.
- 근거: `_research/l2e.md` §3.4 D4, 상주 수준 1(공유 관제는 2, §6).

### 4.4 예약 실행

[결정] 예약·원격·알림은 범위에 포함된다(`_research/decisions-log.md` 2026-10-21 결정(3차), `_research/foundation-plan.md` §1 결정 2). 계획 v2는 예약 실행을 "보류"로 두었으나 3차 결정이 덮어쓴다(`product.scope.spec` §4.1 I4 해설, I13).

#### 4.4.1 실행 형태

- 기한마다 새 세션을 만든다. 실행 세션의 작업 디렉터리는 타이머의 `workspace`(없으면 사용자 기본 작업 디렉터리 [가정: L1.persistence 기본값])다. 근거: Hermes는 잡마다 새 AIAgent를 만든다(`_research/refs/hermes.md` §3.10.4).
- 실행 세션의 첫 입력은 타이머 `prompt`다. 이전 실행 세션의 대화는 이어받지 않는다. 이어받아야 하는 작업은 프롬프트나 그룹 코드가 산출물·메모리를 읽어 해결한다.
- 기존 세션을 대상으로 하는 예약은 1차에 두지 않는다 [제안]. 기존 세션은 다른 클라이언트가 쓰기 소유를 쥐고 있을 수 있어 잠금 충돌이 생긴다. 필요하면 `schedule.loops`의 웨이크업을 쓴다.

#### 4.4.2 cron과 at

- cron은 5필드(분 시 일 월 요일)다. `*`, `,`, `-`, `/`와 월·요일 이름(`JAN`, `MON`)을 받는다. 초 필드, `@reboot`, `L`·`W`·`#`은 받지 않는다 [제안]. 6필드 식이나 미지원 문법은 `cron_invalid`다.
- 일(day-of-month)과 요일이 모두 `*`가 아니면 둘 중 하나만 맞아도 실행한다(전통 cron 규칙) [제안]. 해석 라이브러리의 기본값이 다르면 이 규칙에 맞게 옵션을 정한다(`L2.schedule.plan` §4.1).
- 시간대: `tz`(IANA 이름)가 있으면 그 시간대 벽시계로 계산한다. 없으면 타이머를 만든 시점의 시스템 시간대를 `tz`로 고정해 저장한다. 그래서 기기의 시간대가 나중에 바뀌어도 예약 시각이 움직이지 않는다 [제안].
- 일광 절약 시간: 건너뛴 벽시계 시각(봄)의 기한은 그 다음 유효 시각으로 미룬다. 두 번 나오는 시각(가을)은 첫 번째에만 실행한다 [제안].
- `at`은 RFC 3339 시각이다. 이미 지난 시각은 `at_in_past`다. 한 번 실행한 뒤 타이머는 `enabled = 0`, `next_due_at = NULL`이 된다.
- 최소 간격: cron의 연속 두 기한 사이가 `l2.schedule.timers.minIntervalSeconds`(기본 300초)보다 짧으면 만들 때 경고 `interval_clamped`를 내고, 틱은 직전 실행 기한부터 최소 간격이 지나지 않은 기한을 건너뛴다(`skipped`, 사유 `min_interval`).
- `schedule_create` 도구에서 `cron`과 `at`이 둘 다 있거나 둘 다 없으면 `toInput`이 빈 `at`을 만들고 메서드 입력 검사가 `invalid_input`으로 거부한다.

#### 4.4.3 틱과 실행권

- 틱은 `scheduler` 자원 임대를 쥔 프로세스 하나만 돌린다(`eng.context-map.design` §4.4 11행, `eng.transactions.design` §8). 임대 획득·하트비트·펜싱 규칙은 `eng.transactions.design` §3.3 그대로다(5초 하트비트, 30초 만료, epoch 펜싱).
- 누가 임대를 시도하나(`L4.host-service.spec` HS-39, HS-40):
  - 서비스 모드가 켜져 있으면 서비스 프로세스가 `startTick({ mode: "service" })`를 부른다.
  - 서비스 모드가 꺼져 있으면 in-process·stdio 호스트가 `startTick({ mode: "app" })`를 부른다. 여러 앱이 동시에 열려 있어도 임대로 하나만 돈다.
  - 서비스 모드가 켜져 있는데 앱 호스트가 임대를 얻는 일은 없다. 앱 호스트는 이 모드에서 `startTick`을 부르지 않는다.
- 틱 주기는 `l2.schedule.timers.tickSeconds`(기본 15초)다. Hermes는 60초다(`_research/refs/hermes.md` §3.10.4). 15초를 고른 이유는 at 예약의 지연을 줄이려는 것이고, 틱 한 번의 비용은 색인 하나를 읽는 SELECT 하나다.
- 틱 한 번의 절차:
  1. `renew`가 `lease_lost`를 돌려주면 임대를 잃은 것이다. 틱을 멈추고 이번 틱을 버린다.
  2. `SELECT … FROM cap_schedule_timers WHERE enabled = 1 AND next_due_at <= now`.
  3. 타이머마다 §4.4.4의 기한 목록을 계산하고, 기한마다 실행을 `claim`한다.
  4. claim한 실행을 시작한다(§4.4.5). 시작은 틱 밖의 비동기 작업이다. 다음 틱을 막지 않는다.
  5. `cap_schedule_runs`에서 `started`인 실행의 워치독을 검사한다(§4.4.5).

#### 4.4.4 놓친 실행과 중복 방지

놓친 기한: `now - dueAt > l2.schedule.timers.lateGraceSeconds`(기본 120초)인 기한이다. 서비스가 떠 있지 않았거나(재부팅, 수동 종료) 기기가 잠들어 있던 동안 생긴다. 2차 OS 등록 전에는 재부팅 뒤 사용자가 앱이나 CLI를 열어 `ensure`가 서비스를 띄울 때까지 놓친 기한이 쌓인다(ADR-0006 §4.2).

[제안] 정책 표(타이머마다 `missed`, 기본은 설정 `l2.schedule.timers.missedPolicy` = `"once"`):

| 정책 | 놓친 기한 처리 | 제때 기한 처리 | 쓰임 |
|---|---|---|---|
| `skip` | 모두 `skipped`(사유 `missed`)로 기록하고 실행하지 않는다 | 실행 | 시각 자체가 의미 있는 작업(매시 알림) |
| `once` | 가장 늦은 놓친 기한 하나만 실행(`missed: true`), 나머지는 `skipped` | 실행. 같은 틱에 제때 기한도 있으면 제때 기한만 실행하고 놓친 것은 모두 `skipped` | 결과가 최신이면 되는 작업(문헌 점검, 요약). 기본값 |
| `all` | 오래된 순으로 모두 실행. 단 `l2.schedule.timers.maxCatchUpRuns`(기본 10)까지, 넘는 것은 `skipped` | 실행 | 기한마다 결과가 필요한 작업(일별 보고) |

- 공통 상한: `l2.schedule.timers.maxCatchUpHours`(기본 24시간)보다 오래된 기한은 정책과 무관하게 `skipped`다.
- `skipped` 기록도 `cap_schedule_runs`에 남긴다. 사용자가 실행 기록에서 무엇을 건너뛰었는지 본다.
- 다음 기한 계산: 처리한 마지막 기한 뒤의 첫 기한을 `now` 이후로 잡아 `next_due_at`에 쓴다.

중복 방지는 세 겹이다.

1. claim: 쓰기 트랜잭션 안에서 먼저 `holds(tx, token)`(`L0.store.spec` §3.1)으로 임대를 대조하고, 거짓이면 아무것도 쓰지 않는다. 참이면 같은 트랜잭션에서 `INSERT INTO cap_schedule_runs(timer_id, due_at, status = 'claimed', lease_epoch = token.epoch, …) ON CONFLICT DO NOTHING`과 타이머의 `next_due_at`·`last_due_at`·`rev` 갱신을 한 트랜잭션에 넣는다. 행이 이미 있으면 그 기한은 누가 처리했거나 처리 중이므로 건너뛴다. 펜싱 덕분에 임대를 잃은 늦은 틱은 아무것도 쓰지 못한다.
2. 세션 생성 키: `xeon.session` `threads.create`의 `creationKey: "timer:<timerId>:<dueAt>:create"`(`L1.persistence.spec` §4.10.1 생성 멱등, `thread_creation_keys`). 재시작 뒤 새 `threadId`로 다시 불러도 처음 만든 thread를 `replayed: true`로 돌려주므로 세션이 하나만 생긴다.
3. 입력 키: 실행 세션에 `post(…, { when: "next", requestId: "timer:<timerId>:<dueAt>" })`(`eng.transactions.design` §4.8 예약 실행 행). 같은 기한의 입력은 한 번만 큐에 들어간다.

- 키 길이: `timer:` 6 + `tmr_<ULID>` 30 + `:` 1 + epoch ms 13 = 50자. `:create` 7자를 더해도 57자로 64자 안이다.

#### 4.4.5 실행, 결과, 워치독

- 실행 시작 순서: (1) 세션 생성(키 2), (2) `cap_schedule_runs`를 `started`, `session_id` 기록(펜싱), (3) 실행 세션에 `schedule.run_started` 커밋, (4) 프롬프트 post(키 3).
- 재시작 복구: 틱을 시작할 때 `claimed`이거나 `started`인데 `run_finished`가 없는 실행을 찾는다. `claimed`는 (1)부터 다시 한다(키가 같아 중복이 없다). `started`는 세션의 턴 상태를 보고, 진행 중 턴이 없고 투입된 입력도 없으면 (4)를 다시 한다. 턴이 결과 불명으로 끝났으면 `failed`(사유 `host_exit`)로 닫는다 [제안]. 자동 재개 기본값 꺼짐(ADR-0006 §3.6 5번)과 맞춘다.
- 결과: 실행 세션의 턴이 정착하면(`boundary.settle.after`) `schedule.run_finished { outcome }`을 커밋하고 실행 행을 `finished`로 바꾼다. `outcome`은 턴 결과(`completed`, `aborted`, `failed`, `awaiting_approval`)다. 알림은 호스트가 이 이벤트 kind로 라우팅한다(HS-42).
- 승인 대기: 실행 세션이 승인을 기다리면 `outcome: "awaiting_approval"`로 끝나고 작업 상태는 needs_input이다. 승인은 로컬 클라이언트나 원격(§4.5)으로 답한다. 예약 실행의 도구 승인 정책을 따로 둘지(Hermes는 cron에서 승인을 거부한다, `_research/refs/hermes.md` 78행)는 L1.tools의 일이다. [제안] L1.tools에 "세션 origin이 timer이면 승인 요청을 거부할지 대기할지" 설정을 요청한다(§10 미결 6).
- 워치독: `started` 실행 세션에서 진행 중 턴이 있고 마지막 내구 이벤트 뒤 `l2.schedule.timers.runIdleTimeoutSeconds`(기본 600초)가 지나면 `xeon.tasks.interrupt`로 턴을 중단하고 `schedule.run_stalled`를 커밋한다. 실행 행은 `stalled`다. 진행 중인 세션은 자르지 않고 멈춘 세션만 중단하는 Hermes 규칙을 따른다(`_research/refs/hermes.md` §3.10.4 "유휴 600초 워치독"). 승인 대기 중인 세션은 멈춘 것으로 보지 않는다.
- 비용 상한: 최근 1시간 안에 시작한 실행이 `l2.schedule.timers.maxRunsPerHour`(기본 20)에 이르면 새 기한을 `skipped`(사유 `rate_limited`)로 기록한다. 예약 폭주가 모델 비용을 키우지 않게 하려는 것이다.

#### 4.4.6 서비스 모드가 꺼져 있을 때의 생성

설정 `l2.schedule.timers.whenServiceOff`가 동작을 정한다.

| 값 | `create` 동작 | 이후 실행 |
|---|---|---|
| `"autoStart"` (기본) | 서비스 자동 기동을 시도한다. 기동하면 저장한다. 실패하면 `unavailable`, `detail.reason: "service_mode_off"`와 조치 안내(`detail.hint`: 서비스 모드 켜기, `xeon service start`)를 싣고 저장하지 않는다 | 서비스가 틱을 돌린다 |
| `"reject"` | `unavailable`, `detail.reason: "service_mode_off"`와 조치 안내. 저장하지 않는다 | 없음 |
| `"keepWithWarning"` | 저장하고 결과 `warnings`에 `runs_only_while_app_open`을 싣는다 | 앱 호스트가 임대를 쥐는 동안(앱이 열려 있는 동안)만 틱이 돈다. 앱을 닫은 동안의 기한은 다음에 앱을 열 때 놓친 실행 정책을 따른다 |

- 기본값은 `"autoStart"`다 [결정: review.decisions-2 U-23]. 서비스 모드 자동 기동은 결정 2의 1차 범위이고, 기동에 실패하면 거부하므로 사용자가 "예약했는데 안 돌았다"를 겪지 않는다. `L2.readme` §8의 수준 2 규칙과 같다. UC-4 대안 흐름("앱을 닫으면 멈춘다는 점을 예약 생성 때 표시한다")은 `"keepWithWarning"`이 구현한다.
- 자동 기동 요청 경로는 `l2.schedule.service.ensureOnCreate`와 같은 클라이언트 호스트 `ensure`다. 요청 경로는 `L4.host-service.spec`이 정한다 [가정].
- 서비스 모드가 켜져 있는데 서비스가 떠 있지 않으면 `create`는 저장한 뒤, `l2.schedule.service.ensureOnCreate`(기본 참)이면 클라이언트 호스트에 `ensure`를 요청한다. 요청 경로는 `L4.host-service.spec`이 정한다 [가정].

#### 4.4.7 유휴 종료와의 관계

- 서비스는 연결 0, live task 0, 대기 예약 0일 때만 유예 뒤 종료한다(ADR-0006 §3.4, §3.7 4번). 대기 예약이 있으면 유휴 종료가 성립하지 않는다.
- 대기 예약 수는 `SchedulerHost.pendingSchedules()`다: `enabled = 1 AND next_due_at IS NOT NULL`인 타이머 수 + `claimed`·`started` 실행 수. 서비스 호스트가 `ActivitySnapshot.pendingSchedules`에 넣고 `decideIdle`이 읽는다(`L4.host-service.spec` SV-04).
- 그래서 켜진 cron 타이머가 하나라도 있으면 서비스는 사실상 계속 살아 있다. 이는 의도한 동작이다. 사용자가 서비스를 멈추고 싶으면 `xeon service stop`을 쓰고, 그동안의 기한은 놓친 실행 정책을 따른다.

#### 4.4.8 예약 세션과 L3 그룹의 경계

- Hermes는 cron 세션에서 학습 관련 동작(메모리 쓰기 등)을 제한한다(`_research/refs/hermes.md` 91행 자식 차단 도구 목록의 `cronjob_manage`, `memory`). Xeon에서 "예약 세션에서는 학습 검토를 끈다" 같은 규칙은 L3 그룹 소관이다.
- 이 능력이 하는 일은 표식뿐이다. 실행 세션의 첫 이벤트로 `schedule.run_started { origin: "timer" }`를 남긴다. L3 그룹은 자기 투영기에서 이 kind를 읽어 그 세션을 예약 세션으로 알아본다. `xeon.session.create`의 `origin: "timer"`도 같은 정보를 세션 메타에 남긴다 [가정].
- 이 능력은 L3 그룹을 부르지 않고 L3 그룹의 설정도 읽지 않는다. 이 문서는 L3 그룹 이름을 쓰지 않는다 [결정: review.decisions-2 D-11].

#### 4.4.9 M3b 구현 범위: 트리거 상태 기계 [결정: 오케스트레이터 기본값, M3b B1-SCH]

`xeon/packages/cap-schedule`은 M3b에서 능력 정의(F)와 cron 식 없이 포트 뒤의 상태 기계로 먼저 들어간다. 트리거는 다섯 종류다.

| 종류 | 기한 | 비고 |
|---|---|---|
| `interval` | 생성 시각 + 간격, 이후 간격마다 | 간격은 300초 이상. 미만이면 생성이 `interval_too_short`로 거부된다 |
| `at` | 지정한 시각 한 번 | 지난 시각은 `at_in_past`. 실행하거나 건너뛴 뒤 꺼진다 |
| `file_watch` | 기한 없음. 경로가 바뀐 뒤 디바운스가 지나면 다음 틱에서 실행 | 틱 주기보다 짧은 디바운스는 틱 주기로 처리된다. 감시자가 이 프로세스에 있으므로 대기 예약 수에 센다 |
| `remote` | 기한 없음. `fire` 호출 때만 | 대기 예약 수에 세지 않는다 |
| `loop` | 실행이 정착한 뒤 간격 뒤에 다시 실행 | `maxIterations`와 `expiresAtMs`가 필수다. 대기 예약이 아니라 live task로 센다(`liveSchedulerTasks`, M3-10) |

- 모든 실행은 세션 종류 `cron`의 새 세션이고, 입력 출처는 `{ type: "schedule" }`이라 비대화(`interactive: false`)다. 승인은 `l1.tools.unattended.*`를 따르고 명령은 `l0.exec.unattendedTimeoutMs` 상한을 받는다(M3-16).
- 놓친 기한은 `once`로 1회만 따라잡는다. 가장 늦은 기한이 제때(120초 안)면 그것만 실행하고, 놓쳤으면 24시간 안일 때만 `missed`로 하나를 실행한다. 나머지는 요약 한 건(`skippedCount`)으로 `skipped` 기록한다. 최소 간격 300초와 시간당 실행 상한(20)은 `file_watch`·`remote` 포함 모든 트리거에 적용하고 루프의 반복 사이에는 최소 간격을 따로 두지 않는다.
- 같은 항목의 이전 실행이 `claimed`·`started`이면 새 기한은 `overlap`으로 건너뛴다.
- 상태(항목, 실행 기록)는 `ScheduleStore` 포트로 저장한다. claim을 저장하지 못하면 실행을 시작하지 않는다. 재시작하면 `claimed`는 같은 키(`<scheduleId>:<dueAt>`)로 다시 시작하고 `started`는 `host_exit`로 닫으며, 실행 중이던 루프는 `host_exit`로 멈추고 다시 시작하지 않는다.
- [결정: 오케스트레이터 기본값, M3b B1-SCH2] 능력 정의와 와이어가 들어왔다. 능력 ID는 `schedule.entries`(F `capabilities/defs/schedule.ts`)이고, §3.5의 cron 기반 `schedule.timers`와 다른 능력이다. 메서드는 `create`, `list`, `cancel`, `fire`이고 모델 도구는 `schedule_create` 하나다. wire는 `schedule.create`, `schedule.list`, `schedule.cancel`, `schedule.fire`(F `wire/schedule.ts`)다. 분류는 `list`만 읽기 전용이다. `create`, `cancel`, `fire`는 효과가 있는 쓰기로 분류하지 않는다(`requestId` 기억 전까지 멱등이 아니다, ADR-0015 §3.3).
- [결정: 오케스트레이터 기본값, M3b B1-SCH2] 저장소는 처음 쓰일 때 한 번 읽는다(`open()`, 지연 읽기). 읽기가 실패하면(상태 파일이 손상되어 해석하지 못하는 경우를 포함한다) `create`·`cancel`·`fire`·`start`는 `store_failed`를 돌려주고 아무것도 쓰지 않으며, `start`는 틱과 감시를 켜지 않는다. 엔진은 읽지 못한 파일을 빈 상태로 덮어쓰지 않는다. 사용자가 파일을 고치거나 지워야 한다. 실패는 기억하지 않으므로 다음 호출이 다시 읽는다.
- [결정: 오케스트레이터 기본값, M3b B1-SCH2] 모델 도구 `schedule_create`는 실행 등급 `exec`로 등록한다(`tools.register`의 정책 `{ schedule_create: { risk: "exec" } }`). 예약은 사용자 없이 나중의 실행을 만들므로 기본 모드에서 승인을 묻는다.
- [결정: 오케스트레이터 기본값, M3b B1-SCH2] 플러그인 `cap-schedule`(`schedulePlugin`)은 능력 `schedule.entries`(1.0.0)를 제공하고, 서비스는 호스트가 만들어 `schedulePlugin({ service })`로 넘긴다. 틱과 상태 저장소는 호스트가 맡고 플러그인은 서비스를 시작하지 않는다. 도구 서비스가 없으면 능력만 올리고 도구는 올리지 않으며 예외를 던지지 않는다. 능력 API(`createScheduleApi`)는 엔진의 `Result` 실패를 `CapabilityError`의 `code`로 바꾼다.
- 이 단계에 없는 것: cron 식과 시간대, `schedule.*` 기록(이벤트)의 생산자, 임대 기반 다중 프로세스 틱, CLI 예약 명령. 호스트가 파일 저장소와 단일 프로세스 틱으로 조립하고 나머지는 [미결]로 둔다.

### 4.5 원격 제어

#### 4.5.1 경계

- 원격 사용은 1차(M3)다. 원격 클라이언트는 서비스의 로컬 소켓에 SSH 터널이나 사설망(Tailscale 등)으로 연결한다. 서비스는 비루프백 리스너를 열지 않는다. 내장 TLS + 토큰 WebSocket은 2차다 [결정: review.decisions-2 U-11].
- 연결 수용, 토큰 발급·저장, 인증 절차는 `L4.host-service.spec` 소관이다.
- 이 문서가 정하는 것: 원격 클라이언트가 승인과 질문에 답하는 흐름, 원격 기능의 켜기·끄기 정책, 감사 기록, 인증 요구 사항.

#### 4.5.2 흐름

1. 원격 클라이언트가 SSH 터널이나 사설망을 거쳐 서비스 로컬 소켓에 접속한다. L4가 `host.hello` 전에 원격 토큰으로 인증하고, 이 토큰으로 연결을 원격으로 표시한다 [가정: `L4.host-service.spec`]. 인증 실패는 hello 전에 연결을 끊는다(`L4.host-service.spec` §4.11).
2. 클라이언트는 호스트 계약(F wire)의 `thread.list`, `events.subscribe`로 세션과 이벤트를 본다. 어느 세션이 답을 기다리는지는 `schedule.remote.pending`(호스트가 중계)이나 `approval.requested` 이벤트로 안다.
3. 클라이언트가 `approval.respond`(F wire §3.3.1)를 보낸다. 호스트는 연결이 원격이면 `schedule.remote.respond({ ...params, clientId })`로 넘기고, 로컬이면 기존 경로(`ApprovalPort.respond`)를 쓴다 [제안].
4. `respond`는 정책을 검사한다: `l2.schedule.remote.enabled`가 거짓이면 `remote_disabled`, `l2.schedule.remote.allowRespond`가 거짓이면 `respond_not_allowed`, `remember: "always"`는 `remember_not_allowed`다. "항상 허용" 같은 영구 정책 변경은 로컬에서만 하게 하려는 것이다 [제안].
5. 통과하면 `xeon.approvals`에 응답하고, 승인 요청이 있던 세션에 `schedule.remote_responded`를 커밋한다.
- 질문 도구(`dialog.ask`)와 계획 승인(`work.plans`), 리뷰(`artifacts.reviews`, kind `review`는 [미결] `L2.readme` §10 미결 14)는 모두 같은 승인 프로토콜을 쓰므로 원격 답도 같은 경로다(결정 5, `product.usecases.spec` "질문·계획 승인" 행).
- `pending.summary`는 승인 요청의 표시용 요약에서 만든다. 도구 인자 원문과 출력 원문, 비밀 값을 넣지 않는다. 원격 화면이 잃어버리거나 엿보이는 기기에 있을 수 있기 때문이다.

#### 4.5.3 인증 요구

- 비루프백 주소의 무인증 리스너는 금지다. 서비스는 그런 설정으로 기동하지 않는다(ADR-0006 §3.7 5번, `product.usecases.spec` UC-5). 1차는 비루프백 리스너 자체를 열지 않는다(U-11).
- 토큰은 설정에 값으로 두지 않고 `secret://` 참조로만 둔다(`l2.schedule.remote.tokenRef`, `F.wire-settings.spec` §3.8.1 `SecretRef`, D2·D3 규칙).
- 토큰 없는 원격 접속은 초기화(`host.hello`) 전에 끊긴다. 거부는 운영 로그에 남긴다.
- `l2.schedule.remote.enabled`의 기본은 거짓이다. 켜도 서비스 모드가 꺼져 있으면 `status.transport`는 `unavailable`이다. 터널·사설망 설정은 사용자 몫이고 이 능력은 열지 않는다.
- 이 설정의 `allowedScopes`는 `managed`, `user`다. 저장소의 프로젝트 파일이 원격 접속을 켜지 못하게 하려는 것이다(`F.wire-settings.spec` §4.7 4번의 범위 제한 키 예와 같은 이유).

#### 4.5.4 알림과 푸시 [미결]

- OS 알림은 L0.os, 알림 라우팅(연결이 없을 때 OS 알림)은 L4.host-service HS-42다. 이 능력은 알림 대상 이벤트(`schedule.run_finished`, `schedule.run_stalled`, 작업이 needs_input으로 바뀜)를 낼 뿐이다.
- 모바일 푸시를 포함한 알림 채널은 모두 `dialog.notify`가 소유하고, `schedule.remote`는 원격 클라이언트의 승인·질문 응답 중계만 맡으며 `schedule`은 알림 대상 이벤트를 낼 뿐이다 [제안]. 확정은 `L2.readme` §10 미결 15다. 다른 후보는 `schedule.remote`가 원격 클라이언트 등록과 함께 푸시 채널도 소유하는 안이다. 알림 채널이 한 곳에 있어야 무엇을 어디로 받을지 정하는 사용자 설정이 하나로 모이므로 앞의 안을 제안한다(§10 미결 3).

## 5. 실패와 경계 사례

| # | 사례 | 처리 |
|---|---|---|
| 1 | 같은 세션에 루프 두 번 시작 | `loop_already_running` |
| 2 | 셸 조건 명령이 계속 실패(명령 없음) | 3회 연속이면 `error` 사유로 멈춘다 |
| 3 | 반복 중 사용자가 앱을 닫음(서비스 꺼짐) | 루프가 멈춘다. 다음 열기에서 `host_exit`로 정리(§4.1.5) |
| 4 | 웨이크업 기한에 세션이 turn 진행 중 | 정착 뒤 투입. 기한보다 늦게 들어갈 수 있다 |
| 5 | 웨이크업을 연달아 세 번 호출 | 마지막 것만 남고 앞의 둘은 `replaced` |
| 6 | 두 프로세스가 같은 틱을 처리하려 함 | 임대로 하나만 틱을 돌린다. 임대 경계에서 겹쳐도 claim 기본 키와 펜싱으로 한 번만 실행된다(수용 기준 3) |
| 7 | 임대를 쥔 프로세스가 멈춤(좀비) | 하트비트가 끊겨 30초 뒤 만료. 다른 프로세스가 epoch를 올려 인수한다. 늦게 깨어난 이전 소유자의 쓰기는 펜싱으로 거부된다 |
| 8 | claim 뒤 세션 생성 전에 종료 | 재시작 복구가 같은 키로 이어서 한다(§4.4.5) |
| 9 | 재부팅 뒤 하루 지나 서비스가 뜸 | 놓친 실행 정책 적용. 기본 `once`는 마지막 놓친 기한 하나만 실행 |
| 10 | cron 식 오류, 없는 시간대 | `cron_invalid`, `detail.field` |
| 11 | 일광 절약 전환 | §4.4.2 규칙 |
| 12 | 실행 세션이 승인을 기다리며 멈춤 | 워치독이 중단하지 않는다. needs_input, 알림 |
| 13 | 실행 세션이 모델 응답 없이 멈춤 | 600초 뒤 중단, `run_stalled` |
| 14 | 실행 폭주(1분 cron) | 최소 간격(300초) 경고와 건너뛰기, 시간당 상한 |
| 15 | 서비스 모드 꺼짐에서 예약 생성 | 기본 자동 기동 시도. 실패하면 `unavailable` + `service_mode_off`와 조치 안내. 설정으로 거부나 경고 후 보관 |
| 16 | 서비스 모드 꺼짐에서 원격·분리 실행 | 자동 기동 시도, 실패하면 `unavailable` + `service_mode_off`(`L2.readme` §8) |
| 17 | 원격 클라이언트가 `remember: "always"` | `remember_not_allowed` |
| 18 | 토큰 없는 원격 접속 | L4가 hello 전에 끊는다(수용 기준 5) |
| 19 | 감시 regex에 역참조 | `pattern_rejected` |
| 20 | 프로세스 작업을 띄운 엔진이 끝남 | L0.process 메모리 레지스트리가 사라진다. 목록에서 빠진다. `detached` 프로세스는 서비스 안에서만 남는다 |
| 21 | 워크트리 삭제 시 사용 중 세션 | `worktree_in_use` |
| 22 | 타이머 생성 뒤 시간대 설정 변경 | 저장한 `tz`로 계산해 예약 시각이 그대로다 |

## 6. 설정 노출

키 문법은 `l2.schedule.<이름>`이다. 모두 `layer: "L2"`, `since: "0.1.0"`이다. `ui.tab`은 주로 `execution`이고, 파일로만 바꾸는 세부 값은 `advanced`, 토큰 참조는 `secrets`, 도구 켜기는 `tools`다(`L2.readme` §7.2).

| 키 | 타입 | 기본값 | range | runtimeChange | allowedScopes | ui.tab | secret | 비고 |
|---|---|---|---|---|---|---|---|---|
| `l2.schedule.loops.maxIterations` | integer | 50 | min 1, max 1000 | live | managed, user, project, local, session | execution | false | 화면 |
| `l2.schedule.loops.maxLifetimeHours` | integer | 168 | min 1, max 720 | live | managed, user, project, local | execution | false | 화면. 루프 만료 기본·상한 |
| `l2.schedule.loops.minIntervalSeconds` | integer | 0 | min 0, max 3600 | live | managed, user, project, local | advanced | false | 파일만 |
| `l2.schedule.loops.shellTimeoutSeconds` | integer | 60 | min 1, max 600 | live | managed, user, project, local | advanced | false | 파일만 |
| `l2.schedule.jobs.maxConcurrent` | integer | 8 | min 1, max 64 | live | managed, user, local | execution | false | 화면 |
| `l2.schedule.jobs.maxWatches` | integer | 16 | min 1, max 128 | live | managed, user, local | advanced | false | 파일만 |
| `l2.schedule.timers.maxActive` | integer | 50 | min 1, max 1000 | live | managed, user | execution | false | 화면. 예약 목록 상한 |
| `l2.schedule.timers.missedPolicy` | string | `"once"` | enum `skip`, `once`, `all` | live | managed, user | execution | false | 화면. 타이머별 값이 없을 때 |
| `l2.schedule.timers.maxCatchUpHours` | integer | 24 | min 0, max 720 | live | managed, user | execution | false | 화면 |
| `l2.schedule.timers.maxCatchUpRuns` | integer | 10 | min 1, max 100 | live | managed, user | advanced | false | 파일만 |
| `l2.schedule.timers.lateGraceSeconds` | integer | 120 | min 0, max 3600 | live | managed, user | advanced | false | 파일만 |
| `l2.schedule.timers.minIntervalSeconds` | integer | 300 | min 60, max 86400 | live | managed, user | advanced | false | 파일만 |
| `l2.schedule.timers.maxRunsPerHour` | integer | 20 | min 1, max 1000 | live | managed, user | execution | false | 화면. 비용 상한 |
| `l2.schedule.timers.tickSeconds` | integer | 15 | min 5, max 300 | restart | managed, user | advanced | false | 파일만 |
| `l2.schedule.timers.runIdleTimeoutSeconds` | integer | 600 | min 60, max 86400 | live | managed, user | advanced | false | 파일만. 워치독 |
| `l2.schedule.timers.keepRuns` | integer | 100 | min 10, max 10000 | live | managed, user | advanced | false | 파일만 |
| `l2.schedule.timers.whenServiceOff` | string | `"autoStart"` | enum `autoStart`, `reject`, `keepWithWarning` | live | managed, user | execution | false | 화면 |
| `l2.schedule.service.ensureOnCreate` | boolean | true | — | live | managed, user | execution | false | 화면. 서비스 모드 연동 |
| `l2.schedule.remote.enabled` | boolean | false | — | restart | managed, user | execution | false | 화면, 명령(`xeon service remote on`) |
| `l2.schedule.remote.allowRespond` | boolean | true | — | live | managed, user | execution | false | 화면 |
| `l2.schedule.remote.tokenRef` | string(`SecretRef`) | 없음 | — | restart | managed, user | secrets | true | 화면(비밀 탭). 값은 `secret://<name>` |
| `l2.schedule.tools.timers` | boolean | true | — | nextTurn | managed, user, project, local, session | tools | false | 화면. `schedule_*` 도구 노출 |
| `l2.schedule.tools.wakeup` | boolean | true | — | nextTurn | managed, user, project, local, session | tools | false | 화면. `schedule_wakeup`, `loop_done` |
| `l2.schedule.tools.jobs` | boolean | false | — | nextTurn | managed, user, project, local, session | tools | false | 화면. `job_*`, `monitor_start` |
| `l2.schedule.tools.worktree` | boolean | false | — | nextTurn | managed, user, project, local, session | tools | false | 화면. `worktree_*` |

- 안전 상한(`l2.schedule.timers.maxRunsPerHour`, `l2.schedule.timers.minIntervalSeconds`, `l2.schedule.timers.maxActive`, `l2.schedule.loops.maxIterations`, `l2.schedule.loops.maxLifetimeHours`)은 pi 방식(기본 상한 없음)의 예외다. 사용자 입력 없이 실행되는 경로라 상한이 없으면 무한 실행된다 [결정: review.decisions-2 U-22].
- 타이머·원격 키의 `allowedScopes`를 `managed`, `user`로 좁힌 이유: 예약과 원격은 기기 단위 기능이고, 저장소를 받는 것만으로 예약 폭주나 원격 접속이 켜지지 않게 하려는 것이다.
- `l2.schedule.remote.tokenRef`는 D2·D3 규칙에 따라 `default`가 없고 `ui.widget`은 `"secret"`이다.
- `l2.schedule.remote.enabled`와 서비스 사용 설정(`l0.process.service.enabled`, `L0.process.spec` §6)은 다른 키다. 서비스 로컬 소켓 위치는 설정 키가 없고 `L0.process.spec` §4.4가 `<runtimeDir>/xeon.sock`으로 정한다.
- L4 노출 구분: "화면"은 설정 화면 항목, "명령"은 CLI 명령(`/loop`, `/schedule`, `/jobs`, `/worktree`, `xeon service remote`)이 같은 서비스 메서드를 쓰는 경우, "파일만"은 `ui`가 없는 키다. 명령 이름은 `L4.cli.spec`이 정한다.

## 7. 확장 지점

| 지점 / 연산 | 이 능력의 쓰임 |
|---|---|
| `boundary.settle.after` (#26, tap) | 루프 반복 경계, 웨이크업 투입 시점, 예약 실행 결과(§4.1.1, §4.1.3, §4.4.5). `dispatch: detached` |
| `session.start` (#30, tap) | 재시작 정리(§4.1.5) |
| `session.shutdown` (#39, tap) | 이 세션의 메모리 타이머를 지운다. 이벤트는 쓰지 않는다(다음 열기 때 정리) |
| post | `xeon.tasks.post`로 반복·웨이크업·감시·예약 입력을 넣는다. 키 형식 `loop:`, `wake:`, `watch:`, `timer:` |
| drive | 쓰지 않는다. 다음 턴 시작은 post로만 한다(`L2.readme` §4.2) |
| scope | 능력이 꺼지면 도구가 다음 단계 경계에서 빠진다. 도는 루프는 멈추지 않는다 [제안]. 끄려면 `stop`을 쓴다 |

- 그룹 사용 예: 탐구 그룹은 "제2 관점 재검토" 루프를 `count` 조건과 `goalId`로 시작하고, 매주 문헌 점검을 `timers.create`로 만든다(`_research/l2e.md` §3.4 D1·D2 L3 예).

## 8. 다른 문서와의 인터페이스

제공:

| 이름 | 쓰는 문서 |
|---|---|
| `ScheduleLoops`, `ScheduleJobs`, `ScheduleSessions`, `ScheduleTimers`, `ScheduleRemote`와 각 `*Key` | L3 그룹 문서, `L4.cli.spec`, `L4.desktop.spec` |
| `ScheduleService`, `ScheduleServiceName`, `SCHEDULE_CAPABILITIES`(§3.11) | `L2.readme` §5.6, `X.primitives.spec` |
| `SchedulerHost`, `createSchedulerHost` | `L4.host-service.spec`(HS-39~HS-41, `ActivityPort.pendingSchedules`) |
| `SCHEDULE_EVENT_CATALOG`와 payload 타입 | `F.records.spec`, `L4.host-service.spec`(알림 대상 kind) |
| `schedule.run_started { origin: "timer" }` 표식 | L3 그룹 문서 |
| `cap_schedule_*` DDL, 투영기 `cap.schedule` | `L1.persistence.spec`(투영기 등록), `L0.store.spec`(scoped 핸들) |
| 설정 그룹 `l2.schedule` | `L4.settings-ui.spec` |

요구:

| 이름 | 출처 |
|---|---|
| `defineCapability`, `CallOptions`(`context: CallContext`, `L2.readme` §5.8) | `F.capabilities.spec` |
| `PostItem`, `PostOptions`, `PostWhen`, 지점 #26·#30·#39 | `F.extensions.spec` |
| `SettingDef`, `SecretRef`, `approval.respond` params | `F.wire-settings.spec` |
| `schedule` 도메인 영역과 `SCHEDULE_EVENT_CATALOG` 등록(§3.3.2), `CatalogEntry` | `F.records.spec` |
| `LocalIdPrefix`(`lop`·`wak`·`tmr`·`wch`), `LocalIdFactory` | `F.conversation.spec` §3.2.1 |
| 프로세스 레지스트리, 출력 구독, 분리 spawn | `L0.process.spec` |
| 타이머(`time.scheduler`), 파일 감시(`watch`), 워크트리 연산([미결] §10 미결 13) | `L0.os.spec` |
| `sys_leases` `scheduler` 임대, scoped 핸들 | `L0.store.spec` |
| post, interrupt | `L1.tasks.spec` |
| 백그라운드 위임과 취소 | `L1.agents.spec` |
| 세션 생성(requestId 멱등, origin), 커밋, 마지막 이벤트 시각 | `L1.persistence.spec` |
| 승인 응답 | `L1.tools.spec` |
| 목표 상태 조회(선택) | `L2.work.spec` |
| 서비스 수명, 유휴 판정, 원격 연결 인증, 알림 라우팅 | `L4.host-service.spec`, ADR-0006 |
| 임대·펜싱·requestId 형식 | `eng.transactions.design` §3.3·§4.7·§4.8 |

## 9. 수용 기준

1. 서비스 모드에서 1분 뒤 at 예약을 만들고 모든 클라이언트 연결을 끊으면, 기한에 새 실행 세션이 생기고 그 세션에 `schedule.run_started`와 `schedule.run_finished`가 기록된다(`product.usecases.spec` UC-4).
2. `SchedulerHost.pendingSchedules()`는 켜진 타이머와 진행 중 실행이 하나라도 있으면 0보다 크고, 이 값과 연결 수·live task 수를 넣은 `decideIdle`은 셋이 모두 0일 때만 유휴로 판정한다. 마지막 at 실행이 끝나 대기 예약이 0이 되면 유예 뒤 종료 판정이 난다.
3. 같은 DB를 연 두 프로세스가 동시에 `startTick`을 불러도 한 기한의 실행은 하나다: `cap_schedule_runs`에 그 기한 행이 하나이고, 실행 세션이 하나이고, 입력 큐 투입이 하나다. 임대를 잃은 쪽이 늦게 claim을 시도하면 펜싱으로 거부된다.
4. 루프가 종료 조건 4종 각각에서 멈춘다: `count: 3`은 세 번째 반복 뒤, `duration`은 가짜 시계가 기한을 넘긴 뒤, `shell`은 가짜 실행 환경이 종료 코드 0을 낸 반복 뒤, `model`은 `loop_done`이 불린 반복 뒤에 `schedule.loop_stopped`가 그 사유로 기록되고 다음 반복이 투입되지 않는다.
5. 원격 연결에 토큰 없이 접속하면 `host.hello` 처리 전에 연결이 끊기고, 비루프백 주소와 인증 꺼짐 설정으로는 서비스가 기동하지 않는다. `l2.schedule.remote.enabled`가 거짓이면 `schedule.remote.respond`가 `remote_disabled`다.
6. `ScheduleLoops`, `ScheduleJobs`, `ScheduleSessions`, `ScheduleTimers`, `ScheduleRemote` 다섯 정의 각각에 `validateCapability`를 돌리면 이슈 0건이다(경고 포함). 도구 없는 `ScheduleRemote`가 F의 도구 없는 능력 허용(F.capabilities.spec §4.4 [미결])과 함께 확정된다.
7. `continuation: "external"` 목표의 `goalId`로 루프를 돌리면 반복 경계마다 입력 큐 투입이 `loop:<loopId>:<iteration>` 키 하나이고 `goal:` 키 투입이 없다. `continuation: "self"` 목표의 `goalId`로 `start`하면 `invalid_input`이다(이중 투입 검사, `L2.work.spec` §9-11과 공동).

## 10. 미결 사항

1. [결정: review.decisions-2 U-11] 원격은 1차(M3)이고 로컬 서비스 소켓을 SSH 터널이나 사설망으로 연결하는 방식이다. 내장 TLS + 토큰 WebSocket은 2차다. 이 문서의 `schedule.remote`는 서비스가 없으면 `status.transport: "unavailable"`로 동작한다.
2. [결정: review.decisions-2 K-09] 새 ID 접두 `lop`, `wak`, `tmr`, `wch`는 F.conversation.spec §3.2.1 `LocalIdPrefix` 표의 지역 ID로 둔다.
3. [미결] 모바일 푸시와 알림 채널의 소유(§4.5.4). 모바일 푸시를 포함한 알림 채널은 모두 `dialog.notify`가 소유하고, `schedule.remote`는 원격 클라이언트의 승인·질문 응답 중계만 맡으며 `schedule`은 알림 대상 이벤트를 낼 뿐이다 [제안]. 확정은 `L2.readme` §10 미결 15다.
4. [미결] `eng.context-map.design` §4.1 schedule 행 (d)열에 `xeon.session`, `xeon.agents`, `xeon.approvals`, `xeon.exec`, `xeon.sandbox`를 더하는 개정(§3.10).
5. 닫힘. 세션 생성 멱등은 `L1.persistence.spec` §4.10.1의 `creationKey`(`thread_creation_keys`)로 한다(§4.4.4 둘째 장치).
6. [미결] 예약 실행 세션의 승인 정책(§4.4.5): 대기(제안, 알림·원격으로 답함) 또는 거부(Hermes cron 방식). L1.tools.spec에 세션 origin 기반 설정을 요청한다.
7. [미결] `jobs.spawn`의 replay 정책. L1.agents·L0.process가 `requestId` 멱등을 보장하면 `"safe"`로 넓힌다.
8. [미결] 도구 없는 능력(`schedule.remote`)의 허용(F.capabilities.spec §4.4). 허용되지 않으면 `cap-schedule` 내부 API로 옮긴다.
9. [미결] 긴 bash 자동 백그라운드 전환의 책임(§4.2.4): L1.tools, L2.workspace.shell(제안), schedule.jobs.
10. [결정: 오케스트레이터 기본값, M3b B1-SCH] 기본 `once`와 최소 간격 300초로 구현했다(§4.4.9). 사용자 확인은 남아 있다. 원래 항목: 놓친 실행 기본 정책 `once`와 최소 간격 300초 같은 기본값의 사용자 확인. ADR-0006 §3.5가 이 문서에 넘긴 [미결: L2.schedule.spec](놓친 예약 따라잡기 여부)은 §4.4.4 표로 제안하고 확정은 사용자에게 받는다.
11. [결정: 오케스트레이터 기본값, M3b B1-SCH] 넣는다(M3-10, `liveSchedulerTasks`). 원래 항목: 루프를 `ActivitySnapshot.liveTasks`에 넣을지(§3.9, §4.1.5). 넣으면 서비스 모드에서 루프가 도는 동안 유휴 종료하지 않는다. `L4.host-service.spec` `ActivitySnapshot` 정의와 맞춘다.
12. [미결] 기존 세션을 대상으로 하는 예약(§4.4.1). 1차에서 제외를 제안한다.
13. [미결] 워크트리 연산의 위치(§3.10, §4.3). `L0.os.spec`의 `OsService`에는 워크트리 연산이 없다. L0.os에 `worktree.create/list/remove` 추가를 요청하거나, `xeon.exec`로 `git worktree` 명령을 실행하는 안 중에서 정한다. `watch`의 `root`가 앱 디렉터리 하위로 제한되는 것(`L0.os.spec` §3.8)도 작업 디렉터리의 파일 감시(`source.type: "file"`)와 맞지 않으므로 함께 요청한다.
