---
id: review.m5-turn-record-metrics
layer: meta
domain: review
kind: spec
status: draft
depends_on: [adr.0023, review.m5-drive-isolation, review.m5-profile-project-loader, F.records.spec, F.wire-settings.spec, F.conversation.spec, X.operations.spec, X.primitives.spec, L1.tools.spec, L1.agents.spec, L1.context.spec, L4.host-service.spec]
binds: []
---


# 턴 기록, 지표, 지난 턴에 돌려 보기, 테스트 실행의 기록 (turn-record) [M5d 초안]

> **마일스톤 설계 스펙(상태 draft).** 턴 기록, 지표, 지난 턴에 돌려 보기, 테스트 실행의 기록(M5d)을 정한다. 층 스펙(`docs/xeon/<층>/<도메인>/spec.md`)은 이 문서를 구현하는 트랙이 코드와 같은 커밋에서 바꾼다. 이 문서는 층 스펙을 대신하지 않고 구현 전에 합의할 내용을 모은 것이다.
>
> **이 문서가 바꿀 층 스펙:** `docs/xeon/F/records/spec.md`, `docs/xeon/F/wire-settings/spec.md`, `docs/xeon/F/conversation/spec.md`, `docs/xeon/X/operations/spec.md`, `docs/xeon/X/primitives/spec.md`, `docs/xeon/L1/tools/spec.md`, `docs/xeon/L1/agents/spec.md`, `docs/xeon/L1/context/spec.md`, `docs/xeon/L4/host-service/spec.md`.
>
> **원천:** `_notes/design/lc/spec/m5d-turn-record-metrics.md`(저장소 밖 메모, 2026-11-17 마지막 맞춤본). 문서 이름 대응: M5c = `docs/xeon/review/m5/profile-project-loader.md`, M5d = `turn-record-metrics.md`, M5e = `hooks-core-boundary.md`, 엔진 설계 = `drive-isolation.md`(모두 같은 폴더), 화면 스펙 = `docs/xeon/review/m6/craft-flows.md`, 요구 = `docs/xeon/review/m5-plan.md`, 일정 = `m5-plan.md`와 `m6-plan.md`, 개념과 결정 = `docs/xeon/decisions/ADR-0023-plugin-profile-core.md`. 옛 이름 대응: "PRD" = `m5-plan.md`(R번호 그대로, "PRD §7"은 §14), "craft-flow"·"flow" = 화면 스펙 제1부(흐름 n), "개념 문서" = ADR-0023(대체한 절은 ADR §6), "로드맵" = `m5-plan.md` §7과 `m6-plan.md`. 코드 경로의 `path:line`은 `m4/cyP` 워크트리 읽기 시점의 값이다.

코드 위치는 한 곳이 아니다. 기록 수집은 `ext-host`, `core-tools`, `core-context`, `core-loop`에, 저장과 집계는 `apps/host/src/assembly/measure/`에, wire 계약은 `contracts/src/wire-settings/wire/`에 둔다. 이 문서는 개념 문서(`docs/xeon/decisions/ADR-0023-plugin-profile-core.md` §2, §3.13), 흐름 문서(`docs/xeon/review/m6/craft-flows.md` 제1부 흐름 3.2·3.5·3.6·8), 요구 문서(`docs/xeon/review/m5-plan.md` R12, R16, R18, R19, R23), 엔진 설계(`docs/xeon/review/m5/drive-isolation.md`)를 근거로 한다. 사용자 결정은 [결정]으로, 이 문서의 선택은 [제안]으로 표시한다.

이 문서가 의존하지만 아직 구현되지 않은 것: 프로필·프로젝트·로더(M5c, 스펙은 `profile-project-loader.md`에 있다), Drive 단계 함수와 프레임 스택(E1~E3), 격리 1·2단계(P1·P2), Hook 정리(R21). 이 문서는 그쪽이 낼 값(프로필 id와 개정, 플러그인 버전 id, 프레임 스택, 플러그인 프로세스)을 [가정]으로 받아 쓴다. 각 가정은 §10에 모아 둔다.

**통합 정리(2026-11-17, `_notes/design/lc/spec/consolidation-log.md`).** 교차 점검 둘의 결과를 반영했다. 같은 말은 엔진 설계 통합본의 "공통 어휘"를 따른다: 플러그인 정체는 이름(`pluginId`), 버전 정체(`versionId`)는 검토본의 내용 해시와 초안의 `draft:<draftId>:<해시 앞 8자>`이고 기록 필드는 `versionId` 하나다. 훅 결정값(`block`, `ask`, `replace`)은 F §4.2가, 기록된 결과값은 이 문서의 §3.2가 정의하고 둘의 대응표는 F §4.5에 있다. 프레임 종료 사유는 저장된 `lease.released.reason` 값 그대로다. U1(주도 명령 결과의 내구 기록)과 U3(같은 위치 합치기)은 2026-11-17에 사용자가 정해 본문에 반영했다. 화면은 `docs/xeon/review/m6/craft-flows.md`가 맡는다.

## 1. 목적과 범위

### 1.1 정하는 것

| 요구 | 이 문서가 정하는 것 | 절 |
|---|---|---|
| R12 | 턴 기록의 저장 위치, 블록별 기록 내용, Hook 결과 일곱 가지, 막음과 고장의 구분, 크기·보존·개인정보 | §3.1~§3.4, §4.1~§4.4 |
| R19 | 플러그인별 컨텍스트 비용(항상 / Drive 중 / 필요할 때)의 귀속과 프롬프트 캐시 깨짐의 귀속 | §3.3, §4.5 |
| R18 | 지표 정의와 계산 방식, "살펴볼 것" 규칙, 근거를 테스트 대화로 넘기는 방식 | §3.6, §4.7, §5, §6 |
| R16(엔진) | 지난 턴에 돌려 보기, 테스트 실행 기록의 표지와 지표 제외, 초안 버전 비교의 데이터 | §3.7, §4.6, §4.8 |
| R23(데이터) | 흔적(조용한 고침, 현재 Drive 프레임 스택)이 읽는 데이터와 그 갱신 사건 | §4.9 |
| 흐름 §3.2·§3.5·§3.6 | 테스트 화면의 "그 자리 관찰", 흔적에서 턴 기록으로 이동, 관찰에서 고치기로 증거 넘기기 | §3.5, §4.7, §4.9 |

### 1.2 다루지 않는 것

| 항목 | 소유 |
|---|---|
| 화면(턴 기록 화면, 지표 화면, 테스트 화면, 흔적의 모양, 문구) | M6 Craft 화면 스펙(`docs/xeon/review/m6/craft-flows.md`) |
| 프로필, 프로젝트, 로더, 일회 덧씌우기의 의미와 저장 | M5c 프로필·프로젝트·로더 스펙. 이 문서는 값을 기록만 한다 |
| 단계 함수, 프레임 스택, 플러그인 프로세스의 동작 | Drive·격리 스펙(E1~E3, P1~P2) |
| Hook 이름 정리 | Hook 정리 스펙(R21). 이 문서는 기록된 훅 이름 문자열을 바꾸지 않는다 |
| 테스트 대화 창이 증거를 받아 자기 프롬프트에 넣는 방식 | R17 테스트 대화: Craft 화면 스펙(`docs/xeon/review/m6/craft-flows.md`) |
| 지침을 "따랐나" 판정 | 불가능(§5.2, §11) |
| 관찰 값(훅 시간·결과, 재료, 광고)을 대화 로그(`events`)에 새 종류로 더하는 일 | 하지 않는다(§3.1 결정). 상태 사건(`profile.applied`)은 M5c가 더한다. 주도 명령 결과의 내구 기록은 [결정: 2026-11-17 사용자, U1](엔진 설계 §1.1) |

### 1.3 지키는 제약

- 기록은 모델에게 보이지 않는다. 시스템 프롬프트, 환경 블록, 도구 설명, 메시지 어느 것도 기록 때문에 바뀌지 않는다(§4.1 규칙 7, AC-1).
- 수집은 읽기 전용이다. 수집기는 훅 결과, 도구 결과, 조립 결과를 바꾸지 못한다.
- 이 기기의 데이터는 밖으로 보내지 않는다(옛 `craft-plan.md` §8의 원칙이고 이 문서가 정본이다).

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 턴 기록 (turn record) | 한 턴에서 블록마다 일어난 일의 저장된 기록. 단계 기록(`StepRecord`)과 턴 요약(`TurnRecord`)으로 이루어진다 |
| 재료 (material) | 컨텍스트 조립이 모델 요청에 실은 지침 한 덩어리. 플러그인 하나가 낸다 |
| 호출 기록 (call record) | 도구 호출 하나의 기록. 그 호출 앞뒤에서 돈 훅 기록을 품는다 |
| 훅 실행 (hook run) | 핸들러 한 번의 실행. 기록된 결과는 기존 다섯(`modified`, `passed`, `blocked`, `failed`, `skipped`)이고 `reason`, 핸들러가 낸 결정값 `decision`(`none`/`block`/`ask`/`replace`), 물음 정보 `ask`가 따로 붙는다. 화면의 여섯 값(`pass`, `modified`, `asked`, `blocked`, `error`, `timeout`)은 이 저장값에서 파생한다(F §4.5 대응표) |
| 판정 (verdict) | 도구 호출 하나의 결말. 막음(뜻을 가진 거부)과 고장(실패로 인한 거부)을 다른 값으로 둔다. 훅이 결과를 대신 줌, 서브에이전트 막음, 무인 거부, 취소된 물음도 값이 있다(§3.2) |
| 범위 (scope kind) | 기록이 어떤 대화에서 나왔나: `live`, `overlay_reviewed`, `overlay_draft`, `test` |
| 지난 턴에 돌려 보기 (backtest) | 기록된 도구 호출에 후보 Hook을 다시 적용해 "걸렸을 것"을 보는 일. 모델도 도구도 실행하지 않는다 |
| 테스트 실행 | 초안 플러그인을 기준 프로필에 얹은 임시 구성으로 에이전트를 돌리는 일 [결정: 2026-11-17 사용자]. 기존 `testRun`(Test run) 통로를 쓴다. 이 일을 보이는 화면의 장소 이름은 "테스트"다 [결정: 2026-11-17 사용자]. Craft 전용 AI 대화는 "테스트 대화"다 |
| 플러그인 정체, 버전 정체 | `pluginId` = 플러그인 이름. `versionId` = 검토본은 내용 해시 `sha256:<hex>`, 초안은 `draft:<draftId>:<해시 앞 8자>`(엔진 설계 공통 어휘, M5c §4.6.1). 저장 열과 기록 필드는 모두 `versionId`다. wire 차원(`Dim`)과 `compare.by`의 이름은 `pluginVersion`이고 그 값은 `versionId`다(wire 이름이 정본이다) |
| 근거 참조 (evidence ref) | 살펴볼 것이 가리키는 턴·호출·훅 실행의 id 묶음. 내용을 담지 않는다 |
| 어림 토큰 | 글자 수 / 4 올림. `core-context`가 이미 쓰는 규칙이다(`packages/core-context/src/assemble.ts:225`) |

이 문서는 `terms.json`의 금지 별칭을 쓰지 않는다. 기록된 저장 문자열(`lease.acquired` 등)은 그대로 인용한다.

## 3. 인터페이스

### 3.1 저장 위치 [제안: 근거와 대안 비교]

지금 코드에는 저장 층이 둘 있다. 이 문서의 출발점이 요구 문서의 "턴 기록은 메모리에만 있다"와 다르므로 먼저 밝힌다.

| 층 | 무엇이 | 어디에 | 근거 |
|---|---|---|---|
| 링 버퍼 | 훅 실행 기록 | 메모리만. 재시작하면 비어 있다 | `packages/ext-host/src/operations/trace-buffer.ts:1`, `docs/xeon/X/operations/spec.md` §4.8.3 마지막 줄 |
| 측정 저장소 | 턴 요약, 모델 호출, 훅 실행 행, 단계 구성(`ctx`), 캐시 사건, 핸들러 실패 | 대화 DB와 따로인 `measure.db` 파일. 원본 30일, 일별 집계는 계속 | `apps/host/src/assembly/measure/store.ts:73`, `recorder.ts:407`, `docs/xeon/L4/host-service/spec.md` §4.20 |

링 버퍼를 `turn.completed` 때 읽어 `measure.db`에 `hook` 행으로 옮기는 코드가 이미 있다(`recorder.ts:436~460`). 그래서 훅 결과의 시간과 결과는 지금도 재시작 뒤에 남는다. 없는 것은 다음이다.

1. 훅 행에 도구 호출 id가 없다. 어느 호출 앞뒤에서 돌았는지 알 수 없다(`dispatchKey`에는 있으나 `trace-buffer.ts`가 버린다, `pipeline.ts:511`).
2. 도구 호출 단위 행이 없다(판정, 소요, 결과 크기).
3. 재료, 도구 광고, 스킬 목록과 읽음 기록이 없다. `sections`가 비어 있다(`packages/core-loop/src/loop/prepare-request.ts:95`).
4. 프로필, 덧씌우기, 초안 표지가 없다. 테스트 실행 표지는 메모리 `Set`과 `Map`뿐이다(`packages/ext-host/src/primitives/host.ts:584`, `apps/host/src/assembly/ports.ts:284`, `apps/host/src/assembly/m4/profile-test-run-port.ts:94`).
5. 쓰는 때가 `turn.completed` 하나다. 도중에 프로세스가 죽으면 그 턴의 훅 행은 전부 없다.
6. 대화를 지워도 행이 남는다(`packages/core-persistence/src/retention.ts:34`의 `onRemoved`를 측정 저장소가 받지 않는다).
7. 일별 집계 키가 `(day, kind, metric)`라 플러그인별 장기 집계를 못 만든다(`store.ts:73` 스키마).

세 가지 저장 방안을 견주었다.

| 방안 | 장점 | 단점 |
|---|---|---|
| A. 대화 로그에 새 이벤트 종류를 더한다(예: `trace.step_recorded`) | 커밋과 원자적이다. 대화를 지우면 함께 지워진다 | 2026-11-03 [결정] "이벤트 로그의 구조는 바꾸지 않는다"(`docs/xeon/L4/host-service/spec.md` §4.20)와 어긋난다. 훅 시간처럼 매번 달라지는 값이 로그에 들어가면 `replayDrive`의 같음 검사를 흔든다(`packages/contracts/src/wire-settings/wire/devkit.ts:401`의 `ReplayReportShape`). 원격 기기로 가는 `events.batch`가 커진다. F.records 카탈로그 43종과 문서 대조 시험도 고쳐야 한다(`packages/contracts/src/records/catalog/index.ts:73`) |
| B. 코어 투영기 테이블(`p_*`)에 투영한다 | 이벤트에서 다시 만들 수 있다 | 투영은 이벤트만 입력으로 받는다(`docs/xeon/L1/persistence/spec.md` §4.5.1). 훅 실행은 이벤트가 아니라 입력이 없다 |
| **C. `measure.db`를 넓힌다** | 기존 결정과 맞다. 보존, 끄기, 일별 접기, 읽기 wire가 이미 있다. 로그를 건드리지 않는다 | 쓰기가 커밋과 원자적이지 않다(커밋 뒤 마이크로태스크). 대화 삭제 연동과 마이그레이션을 새로 만들어야 한다 |

[제안] C를 고른다. 기록은 "관찰한 사실(시간, 결과, 귀속)"을 `measure.db`가 갖고, "내용(인자, 결과 본문, 사용자 입력)"은 대화 로그가 이미 갖는다. 두 쪽은 `(threadId, turnId, toolCallId)`로 이어진다. 지난 턴에 돌려 보기는 두 쪽을 함께 읽는다(§4.8). 원자성은 포기하는 대신 쓰는 때를 단계 끝으로 당겨 잃는 양을 한 단계로 묶는다(§4.1 규칙 1, 규칙 5).

기존 `measure_raw`, `measure_daily`와 그 `kind`(`turn`, `call`, `hook`, `ctx`, `cache`, `handler_failed`, `body`), wire `measure.turn`, `measure.daily`는 이름도 뜻도 바꾸지 않는다. 새 구조는 같은 파일에 `tr_` 접두 테이블로 더한다(§3.4). `hook` 행은 데스크톱이 옮겨 갈 때까지 계속 쓴다 [제안].

### 3.2 기록 스키마 (저장 문자열 정본)

아래는 `contracts`의 새 파일 `wire-settings/wire/turn-record.ts`에 둘 TypeBox 스키마의 TypeScript 요약이다 [제안]. 기존 이름 `TraceHandlerResult`(`packages/contracts/src/extensions/trace-types.ts:48`), `StepComposition`, `StepContextWarning`(`packages/contracts/src/conversation/lifecycle.ts:256`, `:302`)은 그대로 쓰고 바꾸지 않는다.

```ts
export type RecordLevel = "full" | "log_only" | "none";
export type ScopeKind = "live" | "overlay_reviewed" | "overlay_draft" | "test" | "craft";
export type CallerKind = "main" | "subagent" | "plugin";   // plugin이면 CallRecord.callerPlugin이 이름(F의 호출 주체 `plugin:<이름>`)

export interface TurnRecord {
  readonly schema: 1;
  readonly threadId: string;
  readonly turnId: string;
  /** 하위 에이전트 대화의 턴이면 부모 쪽 자리(agent.spawned) */
  readonly parent: { threadId: string; turnId: string | null; toolCallId: string | null; scopeId: string | null } | null;
  readonly origin: "user" | "scheduled" | "remote" | "delegation" | "drive" | "other"; // turn.started.origin
  readonly startedAt: number;
  readonly endedAt: number | null;
  /** open: 아직 진행 중. lost: 프로세스가 죽어 turn.completed가 없다 */
  readonly status: "completed" | "interrupted" | "failed" | "open" | "lost";
  readonly level: RecordLevel;
  /** 이 턴의 모든 단계 기록이 저장됐나 */
  readonly complete: boolean;
  readonly scope: ScopeKind;
  /**
   * rev는 턴 시작 값. 한 턴 안에서 프로필 개정이 단계 경계마다 바뀔 수 있으므로(M5c §4.1.6) 바뀐 곳을 `profileRevChanges`에 적는다.
   * `source`: `thread`는 쓰인 id가 대화가 저장한 id와 같을 때, `builtin`은 저장한 id가 없거나 저장한 프로필이 없어 `default`를 쓸 때다. `inherited`: 부모 턴의 `agent.spawned`로 만든 하위 대화면 참이다 [제안, §4.10 규칙 61~62]
   */
  readonly profile: { id: string; rev: number; source: "thread" | "builtin"; inherited: boolean } | null;
  readonly profileRevChanges: { stepIndex: number; rev: number }[];
  readonly overlay: OverlayMark | null;
  /** 테스트 실행 대화의 구성(M5c §4.8.1). 테스트 실행이 아니면 null. 초안 버전 id가 여기 있다(덧씌우기가 아니라 대화 전체의 구성이라 `overlay`는 null이다) */
  readonly testRun: { runGroupId: string | null; baseProfileId: string; drafts: { plugin: string; draftId: string; versionId: string }[] } | null;
  /** 이 턴에서 시작한 자식 대화의 목록(규칙 24). 부모 턴 기록이 자식 대화를 찾는 길 */
  readonly children: { childThreadId: string; agent: string; status: "running" | "completed" | "failed" | "interrupted"; used: { turns: number; tokens: number } | null }[];
  readonly frames: FrameMark[];           // Drive 프레임 스택: 턴 시작 때의 스택과 턴 안의 변화
  readonly steps: StepRecord[];
  readonly turnHooks: HookRun[];          // 단계 밖 훅. 묶음 이름은 F의 위치 종류: boundary(conversation-start, input-received, before-turn-end)와 컨텍스트 조립 앞의 첫 훅(`input.agent.before`)과, 턴이 열리기 전에 실행되어 다음 턴의 단계 0에 붙은 `thread.start`·`input.user.before`·`input.bash.before`(`preTurn: true`, 규칙 17의 2 [제안]). 이 훅은 `steps[0].hooks`에 되풀이하지 않는다(단계 번호 0을 첫 모델 단계와 함께 쓰므로 훅 이름 `thread.start`·`input.user.before`·`input.bash.before`·`input.agent.before`·`boundary.turn.before`와 `preTurn`으로 가른다 [제안]) [구현: enB5, `isTurnLevelHook`]
  readonly continues: { atMs: number; plugin: string; decided: "continue" | "stop"; reason: string | null }[];
  readonly skills: { listed: string[]; listedOmitted: number; read: { name: string; plugin: string; via: "model" | "user"; stepIndex: number; tokens: number }[] };
  readonly cost: PluginCost[];            // 파생값(§3.3)
  /** 가벼운 길(읽기 전용)의 플러그인 호출 한 줄씩. 파이프라인 길의 호출은 CallRecord(caller: "plugin")로 간다(F §5.3 U-2) */
  readonly pluginCalls: PluginCallLine[];
  /** 플러그인 프로세스의 표준오류 꼬리. 길이 상한, 시크릿 마스킹(엔진 설계 §3.2) */
  readonly pluginStderr: { plugin: string; versionId: string | null; bytes: number; tail: string }[];
  readonly flags: TurnFlags;
  readonly elided: Partial<Record<"hooks" | "calls" | "materials" | "tools" | "skills", number>>;
}

/** M5c `profile.applied.overlay`를 그대로 옮긴 것이다. 정본은 M5c §3.2 */
export interface OverlayMark {
  readonly kind: "once" | "draft";
  readonly plugins: { id: string; versionId: string; draftId?: string }[];   // draftId가 있으면 초안
  readonly until: "turn" | "release";
  /** 덧씌운 도구 때문에 이 턴의 도구 목록이 바뀌어 캐시가 깨졌나(화면 스펙 흐름 8) */
  readonly toolsetChanged: boolean;
}

export interface FrameMark {
  readonly depth: number;                 // 프레임 깊이(frameDepth). 0은 기본 턴 흐름
  readonly plugin: string | null;         // 0이면 null
  readonly versionId: string | null;      // lease.acquired.contentHash
  readonly leaseId: string | null;
  readonly parentLeaseId: string | null;
  readonly enteredAtMs: number;           // 턴 시작 기준 ms. 턴 전에 들어왔으면 0
  readonly exitedAtMs: number | null;
  /** 저장된 lease.released.reason 값 그대로(이름을 새로 짓지 않는다). 아래 대응표가 화면 표시를 정한다 */
  readonly exitReason: "done" | "budget" | "error" | "idle" | "revoked" | "restart" | "waiting" | "disabled" | null;
  /** 아래 프레임이 이 프레임의 끝으로 받은 last 값. 맡기기가 취소되어 돌아온 경우가 handoff_aborted다(종료 사유가 아니다) */
  readonly lowerResumedWith: "handoff_done" | "handoff_aborted" | "user" | null;
  readonly limits: { maxTurns?: number; maxSpawns?: number; maxTokens?: number };
  /** 한도 소비량. 예산 도달을 설명한다(엔진 설계 §2.3). 세는 사건과 범위는 §4.4 규칙 23 [제안] */
  readonly used: { turns: number; spawns: number; tokens: number };
  /** 이 프레임이 주도 중에 받은 사용자 메시지 수(§4.4 규칙 23 (d), 맨 위 프레임만 [제안]) */
  readonly userMessages: number;
}

export interface StepRecord {
  readonly stepIndex: number;
  readonly stepId: string;
  readonly modelCalls: ModelCall[];       // 보통 1개. 판정·요약 호출은 role로 구분
  readonly materials: Material[];
  readonly advertised: Advertised;
  readonly cache: CacheBreak | null;
  readonly hooks: HookRun[];              // 컨텍스트·요청·단계 끝 훅(도구 호출에 묶이지 않은 것)
  readonly calls: CallRecord[];
  readonly composition: StepComposition | null; // step.completed.composition의 사본
  readonly recorded: boolean;
}

export interface ModelCall {
  readonly role: "main" | "judge" | "summary" | "search" | "review" | "title" | "drive";   // drive = 주도 함수의 model 명령
  /** drive일 때 명령이 준 자유 문자열(≤64자). 그 밖에는 null */
  readonly label: string | null;
  readonly provider: string;
  readonly modelId: string;
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly firstTokenMs: number | null;
  readonly usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** provider_retry 알림 수와 기다린 시간 합(회복 전 시도) */
  readonly retries: number;
  readonly retryWaitMs: number;
  readonly stopReason: string;
}

/** 재료. 지침 한 덩어리. 값 자체는 저장하지 않는다 */
export interface Material {
  readonly plugin: string;
  readonly versionId: string | null;
  readonly registrationId: string | null;
  /** always: 항상 실림. drive: Drive 중에만. on_demand: 읽을 때(스킬 본문, 활성화한 도구 설명) */
  readonly kind: "always" | "drive" | "on_demand";
  readonly material: "instruction" | "skill_index" | "skill_body" | "memory" | "hook_text" | "tool_defs";
  /** 파일 경로 해시, 스킬 이름, 도구 이름 등 사람이 알아볼 이름. 내용이 아니다 */
  readonly ref: string;
  readonly tokens: number;
  readonly truncated: boolean;
  /** 예산 때문에 싣지 못한 항목 수(스킬 색인) */
  readonly omitted: number | null;
  readonly itemId: string | null;
  /** hook_text 귀속이 선언이 아니라 추정이면 inferred */
  readonly attribution: "declared" | "inferred" | "shared";
}

export interface Advertised {
  readonly count: number;
  readonly tokens: number;
  readonly deferredCount: number;
  readonly removedCount: number;
  readonly fingerprint: string;
  readonly byPlugin: { plugin: string; count: number; tokens: number; deferred: number; activated: number }[];
  /** 도구별. 턴 안에서 처음 광고된 단계 기준이고 상한 256개 */
  readonly tools: { name: string; plugin: string; tokens: number; state: "advertised" | "deferred" | "activated"; called: number }[];
}

export interface CacheBreak {
  /** 제공자가 알린 캐시 읽기·쓰기로 깨짐을 관찰했나 */
  readonly observed: boolean;
  readonly causes: { kind: "prefix_reset" | "toolset" | "section" | "model_switch" | "ttl" | "compaction" | "overlay_tools" | "unknown";
                      plugin: string | null; registrations: string[]; evidence: "declared" | "inferred" }[];
  readonly cacheRead: number; readonly cacheWrite: number;
  readonly priorCacheRead: number | null; readonly priorCacheWrite: number | null;
}

export interface CallRecord {
  readonly toolCallId: string;
  readonly parentToolCallId: string | null;
  readonly tool: string;
  readonly plugin: string;                // 도구를 낸 플러그인(§4.5 규칙 17)
  readonly caller: CallerKind;
  readonly callerPlugin: string | null;   // caller가 plugin일 때 이름
  /** 호출이 들어온 길(F §4.6 PluginCallRequest.via). 모델이 부른 호출이면 null */
  readonly via: "hook" | "tool" | "command" | "method" | "drive" | "effect" | null;
  readonly risk: "read" | "write" | "exec";
  readonly capability: { id: string; method: string } | null;
  readonly callKey: string;               // 인자 정규화 JSON의 HMAC 16 hex(대화별 소금이 아닌 설치별 소금)
  readonly targetKey: string | null;      // 도구가 선언한 대상 경로 집합의 HMAC. 없으면 null
  readonly afterUntrusted: boolean;
  readonly verdict: Verdict;
  readonly blockedBy: { plugin: string | null; hook: string | null; registrationId: string | null } | null;
  readonly hooks: HookRun[];              // tool.call.before, guard.tool.before, tool.result 등 이 호출에 묶인 것
  readonly policy: { effect: "allow" | "ask" | "deny"; tier: string | null } | null;
  readonly approval: { approvalId: string; decision: "allow" | "deny" | "answer"; resolvedBy: string; waitMs: number;
                       /** 바깥 플러그인 호출의 승인을 물려받아 카드가 안 뜬 경우(F §5.3 U-11)의 바깥 approvalId */
                       inheritedFrom: string | null } | null;
  readonly exec: { startedAtMs: number; durationMs: number | null; status: "ok" | "error" | "interrupted" | "abandoned"; effectId: string | null } | null;
  readonly result: { tokens: number; bytes: number; truncated: boolean; isError: boolean; itemId: string | null } | null;
}

/** 저장 문자열 열네 가지. 막음(intent)과 고장(fault)이 다른 값이다 */
export type Verdict =
  | "allowed"             // 실행됨
  | "blocked_hook"        // tool.call.before 핸들러가 막는 결정을 냄(뜻을 가진 거부)
  | "blocked_hook_fault"  // tool.call.before 핸들러의 실패·시간 초과·검사 실패가 거부로 대체됨
  | "blocked_guard"       // guard.tool.before 핸들러가 막는 결정을 냄
  | "blocked_guard_fault" // guard.tool.before 핸들러 실패가 거부로 대체됨
  | "denied_policy"       // 정책 규칙이 거부
  | "denied_human"        // 사람이 물음(정책 ask 또는 훅의 ask)에 거부로 답함
  | "denied_noninteractive" // 사람이 없는 실행이라 묻지 않고 거부(approval.resolvedBy: "noninteractive"). 훅 묻기가 무인 정책으로 거부된 경우 포함
  | "replaced_hook"       // tool.call.before의 replace가 실행 없이 결과를 대신 줌(effectId null)
  | "blocked_spawn"       // agent.spawn.before가 서브에이전트 생성을 막음(spawn의 판정)
  | "cancelled_ask"       // ask.human.before가 카드를 취소함
  | "aborted"             // 턴 중단
  | "invalid_args"        // 스키마 검증 실패
  | "unavailable";        // 도구 이름을 못 찾음

export interface HookRun {
  readonly hook: string;                  // 기록 당시의 훅 이름 문자열. 나중에 바꾸지 않는다
  readonly registrationId: string;
  readonly plugin: string;
  readonly versionId: string | null;
  readonly sourceKind: "plugin" | "external_hook" | "builtin";
  readonly seq: number;                   // 같은 디스패치 안의 실행 순서
  /** 이 행이 어느 대상에 묶였나. 도구 호출 훅은 toolCallId, ask.human.*는 approvalId, agent.spawn.*는 spawnRequestId와 childThreadId */
  readonly subject: { toolCallId?: string; approvalId?: string; spawnRequestId?: string; childThreadId?: string };
  readonly toolCallId: string | null;     // subject.toolCallId의 사본(기존 필드, 거르기용)
  readonly result: TraceHandlerResult;    // modified | passed | blocked | failed | skipped (기존 다섯)
  /** failed의 이유: threw | timeout | result_invalid | merge_rejected | process_exit | process_killed(격리 프로세스가 스스로 끝남 | 엔진이 시간 초과로 종료, 엔진 설계 §3.3) */
  readonly reason: TraceFailureReason | null;
  /** 핸들러가 낸 결정값(F §4.2). block이면 result는 blocked, ask·replace·cancel·answer이면 result는 modified가 아니라 passed로 두고 이 필드가 뜻을 싣는다 */
  readonly decision: "none" | "block" | "ask" | "replace" | "cancel" | "answer";   // cancel·answer는 ask.human.before 전용(F §4.3.1)
  /** ask: 사람 대기 메타데이터. via가 decision이면 핸들러가 {ask:true}를 돌려줘 코어가 카드를 띄운 것, awaitUser이면 핸들러가 직접 사람을 기다린 것(두 길이 모두 존재한다) */
  readonly ask: { via: "decision" | "awaitUser"; waits: number; waitMs: number; approvalId: string | null; answer: "allow" | "deny" | "answer" | "cancelled" | "expired" | "noninteractive" | null } | null;
  readonly ms: number;                    // 활성 시간(사람 응답 대기 제외)
  readonly atMs: number;
  readonly size: number;                  // modified일 때 바뀐 크기
  readonly skippedBy: string | null;
  readonly decisionText: string | null;   // blocked의 사유. 시크릿을 가리고 200자까지
  readonly late?: true;                   // 단계 끝 커밋 뒤에 끝난 실행(§7 분리 실행). 행은 시작된 단계에 쓰고, tr_hook에서는 subject_json에 late: true로 싣는다(열 없음)
  /** 턴이 열리기 전에 실행됐다(`thread.start`, `input.user.before`, `input.bash.before`). 단계 0(`turnHooks`)에만 든다. 있으면 `true`, 없으면 생략한다 [제안, 규칙 17의 2] */
  readonly preTurn?: true;
}

/** 비용 숫자와 근거. M5c의 카드 cost와 profile.preview.cost도 같은 모양을 import한다 */
export type CostBasis = "measured" | "estimated" | "declared" | "unknown";   // measured: 턴 기록, estimated: 정적으로 센 값, declared: 매니페스트 선언, unknown: 알 수 없음
export interface CostFigures { always: number | null; drive: number | null; onDemand: number | null; toolCount: number | null; basis: CostBasis }
export interface PluginCost { plugin: string; always: number; drive: number; onDemand: number; shared: boolean }   // 턴 기록의 파생값(basis는 항상 measured)
export interface PluginCallLine { plugin: string; capability: string; method: string; requestKey: string; ok: boolean; ms: number; via: string; toolCallId: string | null }
export interface TurnFlags {
  blockedIntent: number; blockedFault: number; deniedPolicy: number; deniedHuman: number;
  deniedNoninteractive: number; replaced: number; cancelledAsk: number;
  asked: number; modified: number; timedOut: number; failed: number;
  drive: boolean; cacheBreak: boolean; subagents: number; truncatedMaterials: number; draftActive: boolean;
  untrackedWrite: boolean;                // 쓰기 위험 등급 대체 도구가 코어 서비스 호출 없이 성공함(F §5.5 P-4)
}
```

[구현: `apps/host/src/assembly/measure/turn-rows.ts`의 `turnFlagsOf(draft, turnHooks)`가 턴을 닫을 때 센다. 호출은 판정마다 한 번, 훅 실행은 `record_json`에 든 행마다 한 번이다(턴 밖 훅과 늦은 행을 포함하고, 호출에 붙은 복사본은 따로 세지 않는다). `blockedIntent`는 `blocked_hook`·`blocked_guard`·`blocked_spawn`, `blockedFault`는 `*_fault`, `deniedPolicy`·`deniedHuman`·`deniedNoninteractive`·`replaced`·`cancelledAsk`는 같은 이름의 판정이다. `asked`는 승인 id별로 한 번(호출의 승인과 훅의 결정 물음이 같은 카드면 한 번)이고, 승인 id가 없는 훅 물음(`awaitUser`)은 실행마다 한 번이다. 승인을 물려받은 호출은 세지 않는다. `modified`는 `result = modified` 훅 실행이다. `failed`는 `result = failed`에서 시간 초과를 뺀 것, `timedOut`은 `reason = timeout`인 것이다(일곱 갈래의 '오류'와 '시간 초과'에 맞춘다). `drive`는 턴의 프레임이 하나라도 있을 때, `subagents`는 이 턴의 `agent.spawned`로 만든 자식 대화 수다(`turn-writer.ts`의 `rememberChild`가 센다. `children` 목록은 아직 비운다). `draftActive`는 턴 범위가 `overlay_draft`일 때다. 범위는 지금 `tr_thread`에서만 정해져 이 값은 거짓이다(덧씌우기 초안 표지는 남음, §4.6 규칙 31). `untrackedWrite`는 항상 거짓이다. 대체 도구가 코어 서비스 호출을 셌는지 보는 `observedCoreCalls` 계측이 없고, 실행된 호출에는 모두 `effectId`가 있어 `effectId`로는 가를 수 없다 [미구현: F §5.5 P-4 3]. 칸은 줄이기 전 기록에서 센다(상한 때문에 버린 행은 세지 않고 `elided`가 센다). 같은 값을 `tr_turn.flags` 정수 열에 쓴다: `TURN_FLAG_KEYS`의 i번째 칸이 `1 << i`이고, 불린 칸은 참일 때, 수 칸은 0보다 클 때 켜진다(`turnFlagBitsOf`). `turnRecord.list`의 `flags` 거르기가 `(flags & mask) <> 0`으로 읽는다. `tr_daily`에는 플래그를 접지 않는다(접기는 훅·호출·지표 카운터만 한다). 시험: `turn-flags.test.ts`(판정, 훅, 물음, 프레임, 비트를 손으로 만든 값으로 비교), `turn-record-write.test.ts`(`tr_turn.flags`와 `record_json.flags`의 일치, 하위 대화 수]

판정과 훅 결과의 대응(규칙 12~14가 정본):

| 사건 | `HookRun.result` / `reason` | `CallRecord.verdict` | 로그에 이미 있는 증거 |
|---|---|---|---|
| `tool.call.before`가 `block: true` 결정 | `blocked` | `blocked_hook` | toolResult `details.outcome: "blocked"`, `code: "denied_by_extension"`(`pipeline.ts:161`) |
| 같은 훅의 핸들러가 던짐·시간 초과·스키마 위반 | `failed` / `threw`·`timeout`·`result_invalid` | `blocked_hook_fault` | toolResult `details.outcome: "threw"`. 시간 초과와 던짐은 로그에서 구분되지 않는다(`pipeline.ts:511~520`) |
| `guard.tool.before` 막음 / 실패 | `blocked` / `failed` | `blocked_guard` / `blocked_guard_fault` | `details.code: "denied_by_guard"` |
| 핸들러가 사람에게 물음(`awaitUser`) 뒤 허용 | 최종 결과(보통 `passed`) + `ask.answer: "allow"` | `allowed` | `approval.requested/resolved`(원천 `origin.source.scopeId`) |
| 같은 물음에 거부 | `blocked` + `ask.answer: "deny"` | `denied_human` 또는 `blocked_hook` [제안: 핸들러가 거부 결정을 냈으면 `blocked_hook`] | 같음 |
| 정책이 물음을 띄우고 사람이 거부 | 훅 행 없음 | `denied_human` | `approval.resolved{decision:"deny"}` |
| `tool.call.before`가 `{ ask: true }`를 내고 사람이 허용 | `passed` + `decision: "ask"`, `ask.via: "decision"`, `ask.answer: "allow"` | `allowed` | `approval.requested/resolved`(`ruleId: hook:<이름>`, `resolvedBy: "extension"`이 아니라 사람) |
| 같은 물음에 사람이 거부 | `passed` + `decision: "ask"`, `ask.answer: "deny"` | `denied_human` | 같음 |
| `ask`를 냈는데 사람이 없는 실행 | `passed` + `decision: "ask"`, `ask.answer: "noninteractive"` | `denied_noninteractive` | `approval.resolved{resolvedBy:"noninteractive"}` |
| `tool.call.before`가 `{ replace }`를 냄 | `passed` + `decision: "replace"` | `replaced_hook` | toolResult `details.hook: "replaced"`, `effectId: null` |
| `agent.spawn.before`가 막음 / `ask` 거부 / `replace{report}` | `blocked` / `passed`+`decision:"ask"` / `passed`+`decision:"replace"` | `blocked_spawn` / `denied_human`·`denied_noninteractive`(서브에이전트 안에서 묻기는 거부) / `replaced_hook` | `agent.spawned`가 없거나 보고만 있음 |
| `ask.human.before`가 `{ cancel }` / `{ answer }`(질문 카드만) | `passed` + `decision: "cancel"` / `"answer"`, `subject.approvalId` | `cancelled_ask`(그 카드를 띄우려던 호출의 판정) / 호출 판정에 영향 없음 | `approval.resolved{resolvedBy:"extension"}` |
| 격리 프로세스가 죽거나 종료됨 | `failed` / `process_exit`, `process_killed` | 훅 종류에 따라 `blocked_*_fault` 또는 통과 | 표준오류 꼬리(`pluginStderr`) |

"시간 초과"는 `result: "failed"`, `reason: "timeout"`로 저장한다. 기존 trace의 다섯 결과 이름을 바꾸지 않기 위한 선택이다. 화면은 일곱 갈래(통과, 고침, 물음, 막음, 오류, 시간 초과, 건너뜀)를 `result`, `reason`, `decision`, `ask`에서 계산한다. F §4.5의 여섯 값(`pass`, `modified`, `asked`, `blocked`, `error`, `timeout`)은 저장값이 아니라 같은 입력에서 파생한 표시값이고 변환표는 F §4.5가 정본이다(`blocked`·`failed`가 `error`/`timeout`으로, `decision: "ask"`가 `asked`로). 훅 결정값은 F §4.2, 기록된 결과값은 여기 `HookRun`이 한 번씩만 정의한다. 기존 `awaitUser` 길(`ask.via: "awaitUser"`)과 새 결정값 길(`"decision"`)은 둘 다 기록한다.

### 3.3 플러그인별 비용 귀속

`PluginCost`는 턴 기록의 파생값이다(저장 열이 아니라 `tr_turn.record_json`에 함께 넣어 두는 요약). 정적으로 센 값과 합치려면 `CostFigures`(필드 `always`, `drive`, `onDemand`, `toolCount`, `basis`)를 쓴다. M5c의 카드와 `profile.preview.cost`는 정적 추정(`basis`가 `declared`·`unknown`)이고 `profileCost.get`은 측정(`measured`)과 정적(`estimated`)을 합쳐 같은 필드명으로 낸다.

| 열 | 정의 | 원천 |
|---|---|---|
| `always` | 그 턴에서 `Material.kind = "always"`의 어림 토큰 합 + 광고된(지연이 아닌) 도구 정의 토큰 합. 단계마다 같은 재료이므로 턴 값은 마지막 단계 기준 한 번만 센다 | `StepRecord.materials`, `Advertised.byPlugin` |
| `drive` | `kind = "drive"` 재료의 토큰 합. 그 플러그인이 맨 위 프레임이었던 단계만 | 같음 + `FrameMark` |
| `onDemand` | 스킬 본문(`skill_view` 결과 토큰)과 `tool_search`로 활성화한 도구의 정의 토큰 | `CallRecord.result.tokens`, `Advertised.tools[state="activated"]` |
| `shared` | 귀속을 한 플러그인에 못 정하고 훅 묶음에 나눠 줄 수 없는 토큰이 있으면 참 | §4.5 규칙 16 |

프로필 합계는 같은 열을 프로필 단위로 합한 것이다. 턴이 없는 프로필(새 프로필)은 재료와 도구 정의를 정적으로 세어 `basis: "estimated"`로 돌려준다(§3.5 `profileCost.get`). `drive` 열은 주도 중에만 싣는 지침이 훅으로 들어가므로 정적 원천이 없다: 정적 값은 `null`/`unknown`이고 측정에서만, 귀속 추정(`attribution: "inferred"`)으로 채운다(§4.5 규칙 27).

### 3.4 저장 테이블 (`measure.db`)

`apps/host/src/assembly/measure/store.ts`의 `SCHEMA`(`:73`)는 `CREATE TABLE IF NOT EXISTS`만 쓰고 버전이 없다. 이 문서는 `PRAGMA user_version`을 쓰는 단순 마이그레이션을 더한다(1 = 기존, 2 = 이 문서) [제안]. 모든 새 테이블은 대화 삭제 때 `thread_id`로 지운다(§4.4 규칙 9).

| 테이블 | 키 | 주요 열 | 비고 |
|---|---|---|---|
| `tr_meta` | `key` | `install_salt`, `schema` | `callKey`, `targetKey`의 HMAC 소금 |
| `tr_thread` | `thread_id` | `scope_kind`, `test_base_profile`, `test_target`, `run_group_id`, `input_hash`, `created_at`, `draft_json` | 테스트 실행 표지의 내구 사본. 계측이 꺼져도 쓴다 |
| `tr_turn` | `(thread_id, turn_id)` | `started_at`, `ended_at`, `status`, `origin`, `scope_kind`, `profile_id`, `profile_rev`, `profile_rev_changes_json`, `overlay_json`, `plugin_stderr_json`, `level`, `complete`, `model`, `flags`(정수 비트), `record_json`, `record_bytes`, `started_event_id` | `record_json`은 `TurnRecord` 전체. 열은 거르기용 사본 |
| `tr_step` | `(thread_id, turn_id, step_index)` | `model`, `input`, `output`, `cache_read`, `cache_write`, `retries`, `adv_count`, `adv_tokens`, `deferred_count`, `toolset_fp`, `recorded` | |
| `tr_call` | `(thread_id, tool_call_id)` | `turn_id`, `step_index`, `tool`, `plugin`, `caller`, `caller_plugin`, `via`, `inherited_from`, `verdict`, `blocked_plugin`, `blocked_hook`, `call_key`, `target_key`, `exec_ms`, `exec_status`, `result_tokens`, `result_truncated`, `result_item_id`, `meta_json`(위험 등급, 기능, 힌트, `afterUntrusted`) | 인덱스 `(plugin, verdict)`, `(call_key)` |
| `tr_hook` | `(thread_id, turn_id, step_index, seq_global)` | `hook`, `registration_id`, `plugin`, `version_id`, `tool_call_id`, `subject_json`, `decision`, `result`, `reason`, `ask_via`, `ask_waits`, `ask_ms`, `ask_answer`, `ms`, `at_ms`, `size`, `skipped_by`, `decision_text` | 인덱스 `(plugin, hook, result)` |
| `tr_material` | `(thread_id, turn_id, step_index, ref, plugin)` | `kind`, `material`, `tokens`, `truncated`, `omitted`, `item_id`, `attribution` | 단계마다 같은 재료는 처음 나타난 단계에만 쓰고 이후 단계는 `tr_step.toolset_fp`와 `materials_fp`로 같음을 표시한다 [제안] |
| `tr_tooluse` | `(thread_id, turn_id, tool)` | `plugin`, `tokens`, `state`, `called` | 턴당 도구마다 한 행 |
| `tr_skill` | `(thread_id, turn_id, skill)` | `plugin`, `listed`, `read`, `via`, `step_index`, `tokens` | |
| `tr_frame` | `(thread_id, turn_id, lease_id)` | `depth`, `plugin`, `version_id`, `parent_lease_id`, `entered_at_ms`, `exited_at_ms`, `exit_reason`, `lower_resumed_with`, `limits_json`, `used_json`, `user_messages` | `exit_reason`은 저장된 `lease.released.reason` 값 |
| `tr_plugincall` | `(thread_id, turn_id, seq)` | `plugin`, `capability`, `method`, `request_key`, `ok`, `ms`, `via`, `tool_call_id` | 가벼운 길의 호출 한 줄(`pluginCalls`) |
| `tr_cache` | `(thread_id, turn_id, step_index, n)` | `observed`, `kind`, `plugin`, `registrations`, `evidence`, `cache_read`, `cache_write`, `prior_cache_read`, `prior_cache_write` | 기존 `measure_raw kind=cache` 행은 그대로 둔다 |
| `tr_daily` | `(day, subject, plugin, ref, model, profile, scope_kind, caller, counter)` | `n`, `sum`, `min`, `max`, `hist_json` | 원본을 접을 때 채운다(§4.7 규칙 31) |
| `tr_mark` | `(thread_id, turn_id, ref)` | `mark`(`followed`/`not_followed`), `plugin`, `marked_at` | 사용자가 "지침을 따랐나"를 누른 표시(§3.8). 관찰이 아니라 사용자 입력이지만 대화 로그에 더하지 않고 `measure.db`에만 둔다. [제안] 표시는 보존 기간이 지나도 지우지 않는다, 대화를 지우면 함께 지운다. 턴이 접혀도 표시는 접기 대상이 아니다(§5의 지표 가운데 표시를 읽는 것이 없다 [근거: §5 지표 표, 규칙 38]). [구현: `turn-tables.ts`의 `TURN_CHILD_TABLES_KEPT_BY_PRUNE`을 `store.ts`의 `deleteTurn`이 건너뛴다. `forgetThread`는 그대로 지운다. 시험: `turn-record-store.test.ts`] |
| `tr_finding_state` | `finding_id` | `state`, `dismissed_at`, `snooze_until`, `fingerprint` | |
| `tr_backtest_run`, `tr_backtest_item` | `run_id`, `(run_id, tool_call_id)` | 요청, 상태, 항목 결과(§3.7) | 보존은 원본과 같다 |

대화 로그(`events`, `p_*`)에는 관찰 값을 더하지 않는다(훅 시간·결과, 재료, 광고처럼 매번 달라지고 재생 같음 검사를 흔드는 값). 대화 로그에 더하는 상태 사건(`profile.applied`, `lease.acquired`의 선택 필드)은 M5c와 엔진 설계가 정하고 이 문서는 읽기만 한다. 주도 명령 결과의 내구 기록은 [결정: 2026-11-17 사용자, U1]로 대화 로그에 상태 사건 하나(예: `drive.command_settled`)를 더한다(이름은 [제안]). 이 문서의 방안 A 거부는 "관찰 값"에 대한 것이고 이 상태 사건은 관찰이 아니라 재시작 복원용 상태라 충돌하지 않는다. 기록되지 않는 턴 밖 명령(`model`, `tool`, `commit`, `yield`)은 `StepRecord`가 아니라 `FrameMark`의 명령 수, `pluginCalls`, `CallRecord`(caller `plugin`)로 잡힌다.

### 3.5 wire 메서드와 알림

소유 패키지는 계약이 `packages/contracts/src/wire-settings/wire/`, 처리기가 `apps/host/src/handlers/`(새 하위 폴더 `m5/`), 원천 포트가 `apps/host/src/assembly/measure/` 아래다 [제안]. 메서드 이름은 기존 규칙(`<영역>.<동작>`: `trace.turn`, `testRun.phase`, `measure.turn`)을 따른다. 오류 코드는 코어 범위 3000~3999의 3500~3599를 쓴다 [제안: 3500~3599, 지금 3300~3499까지 쓰였다(`wire/errors.ts:568`, `:636`)].

공통: 계측이 꺼져 있거나 저장소를 못 열었다고 해서 오류를 내지 않는다. 기존 패턴(`measure.turn`, `trace.turn`)처럼 값에 `enabled`, `level`을 싣는다.

| 메서드 | params | result | 오류 |
|---|---|---|---|
| `turnRecord.list` | `{ threadId, cursor?, limit?(기본 50, 최대 200), scope?: ScopeKind[], flags?: (keyof TurnFlags)[] }` | `{ enabled, level, items: TurnSummary[], next: string \| null }` | 없는 대화는 3001(기존) |
| `turnRecord.get` | `{ threadId, turnId, detail?: "summary" \| "full" }` | `{ enabled, level, record: TurnRecord \| null, absent: "never_recorded" \| "purged" \| "off" \| null }` | `3501 turnRecord.turnNotFound`(로그에도 없는 턴) |
| `turnRecord.watch` | `{ threadId }` | `{ sub, level }` | 3001 |
| `turnRecord.unwatch` | `{ sub }` | `{}` | |
| 알림 `turnRecord.delta` | `{ sub, threadId, turnId, stepIndex: number \| null, rows: DeltaRow[], final: boolean }` | | 한 알림 최대 100행, 100 ms 안의 것은 묶는다 [제안] |
| `metrics.catalog` | `{}` | `{ metrics: MetricDef[] }`(§5의 행) | |
| `metrics.query` | `{ metrics: string[](≤16), filter: MetricFilter, groupBy?: Dim[], compare?: { by: "pluginVersion" \| "model" \| "profileRev", a: string, b: string } }` | `{ window, rows: { key: Record<Dim,string>; values: Record<string, MetricValue> }[], notes: MetricNote[] }` | `3511 metrics.unknownMetric`, `3512 metrics.filterInvalid` |
| `findings.list` | `{ profileId?, period?, state?: "open" \| "dismissed" }` | `{ asOf, dataRevision, findings: Finding[] }` | |
| `findings.evidence` | `{ findingId, cursor? }` | `{ items: EvidenceRef[], next }` | `3531 findings.notFound` |
| `findings.dismiss` | `{ findingId, until?: number }` | `{}` | 3531 |
| `profileCost.get` | `{ profileId, basis?: "measured" \| "estimated" }` | `{ profileId, rev, basis, nTurns, plugins: PluginCost[], total: PluginCost }` | 프로필 없음은 기존 `profile.notFound` |
| `backtest.run` | `{ candidate: { pluginId, versionId }, hook: ReplayableHook, scope: { profileId?, threadIds?, turns?: {threadId, turnId}[], lastTurns?(기본 20, 최대 50), sinceMs?, include?: ScopeKind[](기본 ["live"]) } }` | `{ runId }` | `3521 backtest.candidateNotFound`, `3522 backtest.hookNotReplayable`, `3524 backtest.isolationUnavailable`, `3525 backtest.busy` |
| `backtest.status` | `{ runId }` | `{ state: "queued" \| "running" \| "done" \| "cancelled" \| "failed", done: number, total: number }` | `3523 backtest.runNotFound` |
| `backtest.result` | `{ runId, cursor? }` | `{ summary: BacktestSummary, items: BacktestItem[], notReproducible: string[], next }` | 3523 |
| `backtest.cancel` | `{ runId }` | `{}` | 3523 |
| 알림 `backtest.progress` | `{ runId, done, total }` | | |
| `testRun.compare` | `{ threadIds: string[](2~8) }` | `{ sameInput: boolean, columns: {threadId, label, versionIds}[], rows: CompareRow[] }` | `testRun.notATestRun`(기존 3312) |

타입 요약:

```ts
type ReplayableHook = "tool.call.before" | "guard.tool.before" | "tool.result";
type Dim = "plugin" | "ref" | "hook" | "model" | "profile" | "pluginVersion" /* = versionId */ | "scope" | "caller" | "day";
interface MetricFilter {
  profileId?: string; plugin?: string; modelVersion?: string;
  period: { days: number } | { from: number; to: number };     // 기본 { days: 30 }
  scopes?: ScopeKind[];                                         // 기본 ["live", "overlay_reviewed"]
  caller?: "main" | "subagent" | "any";                         // 기본 "any"
}
interface MetricValue {
  value: number | null; n: number; denom?: number;
  state: "exact" | "approx" | "insufficient_sample" | "unavailable";
  reason?: "measurement_off" | "not_recorded" | "needs_loader" | "beyond_retention" | "undefined_without_labels";
}
/** 근거 참조의 정본. M5c의 검토 증거가 이것을 import한다. 지난 턴에 돌려 본 결과는 backtest 변형이다 */
type EvidenceRef =
  | { kind: "turn" | "call" | "hook" | "material" | "skill"; threadId: string; turnId: string; stepIndex?: number; toolCallId?: string; hookSeq?: number }
  | { kind: "backtest"; backtestRunId: string; toolCallId?: string };
interface Finding {
  id: string; ruleId: string; ruleVersion: number;
  subject: { kind: "instruction" | "skill" | "tool" | "hook" | "drive" | "block"; plugin: string; ref: string | null };   // kind가 block이면 ref는 F의 BlockId(context|model|tools|ask|agents|record)
  impact: { unit: "tokens_per_turn" | "hits" | "turns"; value: number };
  metrics: Record<string, MetricValue>;
  evidence: EvidenceRef[]; evidenceTotal: number;               // 대표 50개 + 총수
  next: { kind: "fix" | "promote" | "remove"; target: "craft_chat" | "profile"; label: string }[];
  state: "open" | "dismissed";
}
```

F의 `blocks.applied.handlers[].outcome24h`는 `metrics.query`를 `period: { from, to }`(24시간)로 불러 지표 `hook.outcomes`를 인용한다(일 단위 `{ days }`가 아니다).

`ThreadSummary.testRun`(`packages/contracts/src/wire-settings/wire/methods.ts:526`)의 `TestRunMarker`는 선택 필드 `kind`, `draft`, `runGroupId`를 더한다 [제안]. 기존 `profileId`, `target`, `paused`는 그대로다.

기존 `trace.turn`은 유지한다. 메모리 버퍼에 없고 `tr_hook`에 있으면 그 행으로 채워 `retained: true`를 돌려주고 항목에 `source: "store"`를 더한다 [제안]. 그래야 재시작 뒤에도 Y4의 "최근 실행" 줄이 비지 않는다.

### 3.6 설정 키

기존 키는 그대로다: `x.operations.trace.enabled`(`nextTurn`), `x.operations.trace.retentionDays`(30, `live`), `x.operations.trace.storeRequestBody`(끔)(`packages/ext-host/src/operations/settings-keys.ts:216~245`). 뜻이 하나 넓어진다: 원본 보관은 `tr_` 테이블에도 적용된다.

| 키 | 타입 | 기본 | 변경 시점 | 뜻 |
|---|---|---|---|---|
| `x.operations.trace.maxTurnBytes` | integer(16384~4194304) | 262144 | `nextTurn` | 한 턴의 `record_json` 상한. 넘으면 §4.1 규칙 8대로 줄인다 |
| `x.operations.trace.testRunsAlwaysOn` | boolean | true | `nextTurn` | 켜면 테스트 실행 대화는 `trace.enabled`가 꺼져 있어도 기록한다(§4.1 규칙 4) |
| `x.operations.metrics.minSample` | integer | 20 | `live` | 비율·분포 지표를 내는 최소 표본 |
| `x.operations.metrics.defaultWindowDays` | integer | 30 | `live` | 기본 집계 창 |
| `x.operations.findings.enabled` | boolean | true | `live` | 살펴볼 것 계산 켜기 |
| `x.operations.findings.overrides` | record(규칙 id → 숫자 임계 묶음) | `{}` | `live` | §6 임계 덮어쓰기 |
| `x.operations.backtest.maxTurns` | integer | 50 | `live` | 한 번에 돌릴 턴 상한 |
| `x.operations.backtest.maxCalls` | integer | 2000 | `live` | 호출 상한 |
| `x.operations.backtest.callTimeoutMs` | integer | 5000 | `live` | 후보 훅 한 번의 시간 상한(실제 훅 예산 30초와 따로) |
| `x.operations.backtest.totalTimeoutMs` | integer | 120000 | `live` | 한 번 돌리기의 전체 시간 상한 |

### 3.7 지난 턴에 돌려 보기의 결과 형태

```ts
interface BacktestItem {
  toolCallId: string; threadId: string; turnId: string; tool: string;
  live: { verdict: Verdict; humanDecision: "allow" | "deny" | null; blockedBy: string | null;
          laterSignals: ("approval_denied" | "turn_rewound")[] };
  // 후보의 결과도 F §4.5와 같은 변환을 쓴다: decision(block/ask/replace)과 HookRun.result·reason에서 파생. replace는 막음·물음처럼 newly_caught로 센다(후보가 실행을 대신했을 것)
  candidate: { result: "pass" | "block" | "modify" | "ask" | "replace" | "failed" | "timeout" | "skipped"; reason: string | null; ms: number };
  class:
    | "newly_caught"                    // 후보가 막거나 물었다. 실제로는 실행됐다
    | "already_stopped"                 // 실제로도 정책이나 다른 훅이 막았다. 후보가 이르지 않았을 호출
    | "agrees_block"                    // 후보와 실제 훅 둘 다 막았다
    | "would_block_allowed_by_human"    // 후보가 막았을 호출을 사람이 허용한 적이 있다(과한 차단 가능)
    | "passes_same"
    | "candidate_fault"                 // 후보가 던지거나 시간 초과(막음이 아니다)
    | "unreplayable";
  skippedBy?: string;                   // class가 already_stopped일 때 먼저 멈춘 훅의 이름(§4.8 규칙 49). 그 밖에는 없다 [제안]
  nondeterministic?: true;              // 같은 입력을 두 번 돌려 결과가 달랐다(§4.8 규칙 48) [제안]
  unreplayableReason?: "tool_unknown" | "args_missing" | "blob_expired" | "thread_deleted" | "result_not_stored";
}
interface BacktestSummary {
  turns: number; calls: number; replayed: number;
  counts: Record<BacktestItem["class"], number>;
  similarNotCaught: { toolCallId: string; similarTo: string; why: "same_tool_same_target" | "arg_overlap" ; score: number | null }[]; // 최대 20
  candidateFaults: { threw: number; timeout: number };
}
```

결과는 프로세스 메모리에 둔다. 재시작하면 사라지고, 같은 실행의 결과는 그 프로세스 안에서만 읽을 수 있다 [제안]. 저장 표 `tr_backtest_run`과 `tr_backtest_item`(§3.4)은 wire 등록과 타입을 넣은 이 단계에서 만들지 않는다. 처리기와 실행기가 생기는 단계에서 정한다 [제안].

### 3.8 화면용 보조 읽기와 타입 [M6 요청 M5d-3~7 반영]

```ts
// 요약과 알림 행(화면이 목록과 그 자리 관찰에 쓴다)
export interface TurnSummary {
  readonly threadId: string; readonly turnId: string; readonly startedAt: number; readonly endedAt: number | null;
  readonly status: TurnRecord["status"]; readonly scope: ScopeKind; readonly complete: boolean;
  readonly profileId: string | null; readonly stepCount: number; readonly callCount: number;
  readonly flags: TurnFlags; readonly frameDepthMax: number; readonly childCount: number;
}
export type DeltaRow =
  | { kind: "step"; stepIndex: number; step: StepRecord }
  | { kind: "hook"; stepIndex: number | null; hook: HookRun }
  | { kind: "call"; stepIndex: number; call: CallRecord }
  | { kind: "frame"; frame: FrameMark }
  | { kind: "child"; child: TurnRecord["children"][number] }
  | { kind: "turn"; status: TurnRecord["status"]; complete: boolean };
export interface MetricDef { readonly id: string; readonly label: { ko: string; en: string }; readonly unit: string; readonly kind: "count" | "ratio" | "tokens" | "ms"; readonly appliesTo: ("instruction" | "skill" | "tool" | "hook" | "drive" | "block")[]; readonly definitionNote: string | null }
export interface MetricNote { readonly metric: string; readonly code: "insufficient_sample" | "confounded" | "measurement_off" | "partial_window"; readonly text: string | null }
export interface CompareRow { readonly row: string; readonly values: Record<string, { value: number | string | null; state: MetricValue["state"] }>; readonly observation: boolean }   // 표본 하나의 비교면 observation: true
```

추가 읽기와 쓰기 (오류는 3500~3599):

| 메서드 | params | result | 오류 |
|---|---|---|---|
| `turnRecord.search` | `{ plugin: string; hook?: string; outcome?: HookOutcome; period: { days: number } \| { from: number; to: number }; scopes?: ScopeKind[]; cursor?; limit?(기본 50, 최대 200) }` | `{ items: { threadId; turnId; hookSeq: number \| null; plugin; outcome; at: number }[]; next }` | `3512`(`metrics.filterInvalid`와 같은 필터 검사) |
| `findings.bundle` | `{ findingId }` | `{ bundle: { findingId; ruleId; subject; impact; metrics: Record<string, MetricValue>; evidence: EvidenceRef[]; evidenceTotal: number }, bytes: number }`(16 KiB 이하, id·해시·숫자만. 규칙 43) | `3531 findings.notFound` |
| `turnRecord.mark` | `{ threadId; turnId; plugin: string; mark: "followed" \| "not_followed" }` | `{}` | `3501`, `extension.notFound` |

`turnRecord.mark`의 규칙: 표시는 Inject만 하는 플러그인(훅이 없어 "따랐나"를 기록으로 판정할 수 없는 지침·스킬)에만 받는다. 값은 지표 "따랐나"(사용자 표시)의 유일한 원천이고 자동 판정과 섞지 않는다(상태 `approx`, 이유 `user_marked`). `tr_mark`에 쓰고 대화 로그에 더하지 않는다. `testRun`과 `craft` 범위에서도 받는다. 이것이 §11 미결 6을 닫는다.

적용하지 않은 요청: M5d-2(Hook 결과 어휘 정렬)와 M5d-8(`profile.source`의 `project_default` 삭제)은 통합 정리에서 이미 반영됐다(F §4.5 변환표, §3.2). M5d-1은 `ScopeKind`의 `craft`(위 §3.2와 규칙 36), M5d-6은 `TurnRecord.children`으로 적용했다.

## 4. 동작 규칙

번호는 시험과 §9 수용 기준이 인용한다.

### 4.1 기록의 수집과 저장

1. [제안] 쓰는 때는 단계 끝이다. 수집기는 `TurnDraft`를 메모리에 모으고 `step.completed` 커밋이 피드에 나온 뒤(`recorder.ts:407`의 `onCommit`) 그 단계의 `StepRecord` 행들을 한 묶음으로 마이크로태스크에서 쓴다. 턴 요약(`tr_turn`)은 `turn.completed` 뒤에 쓰고, 단계 기록이 하나라도 있으면 턴 시작 때 `status: "open"` 행을 먼저 쓴다.
2. 수집기가 읽는 곳은 넷뿐이다: 디스패처(훅 실행), 도구 파이프라인(호출 판정), 컨텍스트 조립(재료, 광고), 턴 진행 코드(`core-loop`: 모델 호출, 재시도 알림). 읽기 전용 싱크(`record(...)` 한 방향 호출)로 받고 반환값이 호출 경로로 돌아가지 않는다.
3. `level` 값: 켜져 있고 저장소가 열렸으면 `full`. `trace.enabled`가 꺼졌으면 `log_only`. 저장소를 못 열었고 로그도 못 읽으면 `none`.
4. [제안] 테스트 실행 대화(`tr_thread.scope_kind = "test"`)는 `x.operations.trace.testRunsAlwaysOn`이 참이면 `trace.enabled`가 꺼져 있어도 `full`로 기록한다. 테스트 화면의 목적이 관찰이기 때문이다.
5. 단계 도중 프로세스가 죽으면 그 단계의 기록은 없다. 다음 열기 때 `status: "open"` 턴은 `lost`로 바꾸고 `complete: false`로 둔다. 로그에 `step.completed`가 있는데 `tr_step` 행이 없는 단계는 읽을 때 `recorded: false`로 보인다. 잃는 양은 많아야 한 단계다.
6. 계측을 켜는 값은 Turn이 처음 보일 때 한 번 읽는다(`X.operations.spec` §4.8.3의 기존 규칙). 같은 턴 안에서 바꿔도 그 턴은 처음 값을 따른다.
7. 기록은 모델에게 보이지 않는다. 수집기는 (a) 메시지를 만들지 않고, (b) 도구 설명·이름·스키마를 바꾸지 않고, (c) 시스템 프롬프트와 환경 블록에 줄을 더하지 않고, (d) 요청 본문을 바꾸지 않는다. `callKey`, `targetKey`, 재료 id는 저장소 안에만 있다. 켠 상태와 끈 상태에서 같은 입력의 모델 요청 본문이 바이트 단위로 같아야 한다(AC-1).
8. 상한(턴당): 훅 500, 호출 500, 재료 200, 도구 행 256, 스킬 이름 256. `maxTurnBytes`를 넘으면 순서대로 줄인다: 재료의 `ref` 문자열 → `Advertised.tools` → 훅의 `decisionText` → 훅 행(오래된 `passed`부터). 줄인 수는 `elided`에 센다. 줄인 뒤에도 넘으면 단계 기록은 유지하고 `record_json`은 요약으로 대체하며 `complete: false`다.
9. [제안] 대화가 지워지면(`threads.remove`, 보관 정리 `onRemoved`: `retention.ts:34`) `measure.db`가 `tr_*`의 그 `thread_id` 행을 같은 호출 안에서 지운다. `tr_daily`는 대화 단위 값이 없으므로 남는다. 일별 집계에는 대화 id, 도구 인자, 훅 사유가 들어가지 않는다.
10. 원본 보관은 `x.operations.trace.retentionDays`다. 시간이 지난 `tr_*` 행은 `tr_daily`로 접은 뒤 지운다(규칙 31). 접기는 기존 `prune`과 같은 트랜잭션에서 한다. 표시(`tr_mark`)는 예외다(§3.4 [제안]).
11. 개인정보. 저장하지 않는 것: 프롬프트·메시지 본문, 도구 인자 값, 도구 결과 본문, 시크릿 값, 훅 입력 payload, 훅이 고친 내용. 저장하는 것 가운데 사람이 쓴 문자열은 둘이다: 훅 `decisionText`(200자, `mask` 적용)와 스킬·도구·플러그인 이름. 요청 본문은 기존 `storeRequestBody`가 켜졌을 때만, 기존 규칙대로 가린 뒤 저장한다. 인자와 대상은 설치별 소금으로 HMAC한 짧은 값(`callKey`, `targetKey`)만 둔다. 내용이 필요하면 대화 로그를 읽는다(§4.8 규칙 40).

### 4.2 훅 실행 기록

12. 훅 실행 한 번이 `HookRun` 하나다. 결과 `result`와 `reason`은 기존 정의(`X.operations.spec` §4.8.2)를 그대로 쓰고 `reason`에 `process_exit`, `process_killed`를 더한다(저장 문자열 추가). 새로 더하는 것은 `toolCallId`, `subject`(`approvalId`, `spawnRequestId`, `childThreadId`), `decision`, `ask`(`via` 포함), `plugin`, `versionId`, `sourceKind`, `decisionText`, 그리고 같은 디스패치 안의 순서 `seq`다. 새 훅 넷(`ask.human.*`, `agent.spawn.*`)도 같은 모양으로 받는다.
13. `toolCallId`는 디스패치 키 접미(`<stepId>:tool.call.before:<toolCallId>` 등, `pipeline.ts:511`, `:550`, `:1150`)에서 얻는다. 접미가 없는 디스패치는 `null`이다.
14. 물음 기록. 길이 둘이다. (a) 핸들러가 `awaitUser`(`packages/ext-host/src/primitives/user-wait.ts:7`)로 직접 사람을 기다린 횟수와 기다린 시간 합을 `ask.waits`, `ask.waitMs`에 세고 `ask.via: "awaitUser"`로 둔다. (b) 핸들러가 결정값 `{ ask: true }`를 돌려줘 코어가 카드를 띄운 경우는 `decision: "ask"`, `ask.via: "decision"`이고 `waitMs`는 카드의 `requested`와 `resolved` 차이다. 승인 요청 id를 알면 `ask.approvalId`에 둔다. `ask.answer`는 그 승인의 `approval.resolved`(`decision`, `resolvedBy`)에서 온다. `ms`는 기존대로 활성 시간이다(사람 대기 제외). 물음이 없으면 `ask`는 `null`이다.
15. 막음과 고장의 구분. 호출의 `verdict`는 합치기의 결과와 `FirstOutcome.substituted`(`packages/ext-host/src/primitives/dispatch-types.ts:80`)로 정한다. `substituted`가 거짓이고 결정이 거부면 `blocked_hook` 또는 `blocked_guard`, 참이거나 디스패처 예외면 `*_fault`다. 결과 대신 주기는 `replaced_hook`이다. `tool.call.before`·`agent.spawn.before`의 합치기는 [결정: 2026-11-17 사용자, U3]으로 F §5.1 H-2(`block > replace > ask`. 모든 핸들러가 돈 뒤 정하는 것과 두 위치에만 쓰는 것은 [제안])다: `CallRecord.blockedBy`는 이긴 핸들러이고 진 핸들러의 행은 `passed`/`modified`로 두되 `decision`에 낸 값을 그대로 적는다. `skipped`+`skippedBy`는 `guard.*`와 다른 first 훅에서만 생긴다. 이 구분은 저장 열 `verdict`로 남고 §6의 모든 규칙이 막음과 고장을 섞지 않는다.
16. 외부 훅 단위(`fresnel-hooks-<훅 id>`)는 지금처럼 자기 행을 숨기고 훅마다 `hook:<id>` 행을 낸다(`X.operations.spec` §4.8.2). `plugin`은 그 훅 설정을 둔 플러그인(또는 프로젝트)이고, 로더가 모르면 `external-hook:<id>`다 [제안]. `sourceKind: "external_hook"`.
17. 같은 디스패치에서 앞 핸들러가 멈춰 뒤 핸들러가 `skipped`인 행은 `skippedBy`를 그대로 기록한다. H-2([결정: 2026-11-17 사용자, U3])에서는 이런 행이 `guard.*`와 다른 first 훅에서만 생긴다. 이 값이 "후보 훅이 앞 훅 때문에 이르지 못함"의 근거다(§4.8 규칙 49).

17의 2. [제안, 2026-11-18] 턴이 열리기 전에 실행된 훅은 다음 턴의 단계 0 항목이다. 대상은 훅 이름으로 정한다: `thread.start`, `input.user.before`, `input.bash.before`. 이 훅들의 키는 요청 id나 대화 id라 `trn_` 접두가 없다. 열린 현재 턴이 없을 때 받은 것만 다음 턴을 기다리며, 대화마다 최대 8항목을 붙잡는다(가장 먼저 받은 것부터 버린다). 현재 턴이 열려 있으면 그 턴의 단계 0에 붙는다(입력이 실행 중인 턴 도중 들어온 경우 포함). 다음 턴이 열리면 기다리던 항목을 그 턴의 단계 0으로 옮기고 `pre: true`를 단다(기록에서는 `preTurn: true`). `boundary.turn.after`를 받은 턴은 닫힌 것으로 보며 현재 턴이 되지 않는다. 닫힌 뒤 같은 턴 키로 오는 훅(`boundary.settle.after`)은 그 턴에 붙되 현재로 다시 세우지 않는다. 계측이 꺼져 있으면 기다리는 항목을 붙이지 않고, 기다리던 항목도 버린다(§7 계측 꺼짐). 턴 전 항목의 `atMs`는 0이다. 알려진 한계: 실행 중인 턴이 있을 때 들어와 다음 턴으로 넘어가는 `followUp` 입력의 `input.user.before`는 실행 중인 턴에 붙는다. 큐에 넣을지는 훅이 끝난 뒤에야 정해져 디스패치 시점에 가를 수 없다(§11 17) [근거: `packages/core-loop/src/service.ts`의 `input.user.before` 디스패치가 큐 결정보다 앞선다].

### 4.3 호출 기록

18. 도구 호출 하나는 파이프라인 단계 1~11(`docs/xeon/L1/tools/spec.md` §4.2)을 지나며 `CallRecord`가 채워진다. 판정은 처음 확정된 단계가 정한다: 스키마 검증 실패 `invalid_args`, 이름 없음 `unavailable`, 훅 5a·5c2 `blocked_*`, 훅의 결과 대신 주기 `replaced_hook`, 정책 5b `denied_policy`, 승인 5c 거부 `denied_human`(사람이 없는 실행이면 `denied_noninteractive`), 중단 `aborted`, 그 밖은 `allowed`. [제안: M5d-1 구현] 세부는 다음과 같다. 승인이 사람 없이 해결되면 턴 중단으로 취소된 것이면 `aborted`, 그 밖의 취소·만료·대체는 `cancelled_ask`다. 정책의 무인 거부(`decision.reason`이 `noninteractive`)는 `denied_noninteractive`다. 실행 전에 턴이 멈춰 닫힌 호출(`not_executed`)은 `aborted`, 잘린 응답의 호출(`truncated`)은 `invalid_args`다. 의도를 쓴 호출을 닫을 때 실행을 시작한 적이 있으면(`effect.exec` 커밋) `allowed`(결과 불명)이고, 없으면 닫는 이유로 정한다. 사용자 셸(`runUserShell`)의 호출은 `caller: "main"`, `via: "command"`다. 저장 실패와 내부 오류로 닫힌 호출은 열네 판정 가운데 맞는 값이 없어 줄을 남기지 않는다(§11 15번). 모델이 부르지 않은 호출(플러그인 코드, 주도 함수의 `tool` 명령, 훅 안의 호출)도 같은 파이프라인이라 같은 `CallRecord`를 갖고 `caller: "plugin"`, `callerPlugin`, `via`가 적힌다.
19. 막힌 호출에는 효과 이벤트가 없으므로(`L1.tools.spec` §4.2 부속 규칙) `exec`는 `null`이고 `effectId`도 없다. 호출의 원래 인자는 어시스턴트 항목의 `toolCall` 블록에 있다.
20. `callKey`는 어시스턴트 `toolCall.arguments`의 정규화 JSON(`canonicalJson`)에 설치별 소금으로 HMAC한 앞 16 hex다. 실행된 호출은 `effect.intent.argsHash`(`packages/contracts/src/records/effects.ts:40`)와 별개다. 소금이 있어야 인자 값을 사전 대입으로 되짚는 일을 막는다.
21. `targetKey`는 도구가 `locks`로 선언한 정규 경로 집합(`L1.tools.spec` §4.2 단계 7b)의 HMAC이다. 선언이 없는 도구(`bash`, 대부분의 MCP·확장 도구)는 `null`이다.
22. 하위 에이전트 호출은 자식 대화의 턴에 속하고 `caller: "subagent"`다. 부모 턴 요약에는 자식 호출 수만 센다(`flags.subagents`). 플러그인이 부른 호출은 `caller: "plugin"`이고 `callerPlugin`이 `plugin:<이름>`의 이름이다.

### 4.4 Drive, 하위 에이전트, 물음

23. Drive 프레임은 `lease.acquired`(`packages/contracts/src/records/catalog/extension-ops.ts:100`), `lease.released`와 `turn.started.scopeId`로 만든다. E3이 `parent`, `depth`, `contentHash`를 `lease.acquired`에 더하면(`docs/xeon/review/m5/drive-isolation.md` §2.6) 그 값을 `FrameMark`의 `parentLeaseId`, `depth`, `versionId`로 옮긴다. 더하기 전의 기록은 깊이 0·1로 읽는다 [가정]. `exitReason`은 저장된 `lease.released.reason`(`disabled`, `budget`, `error`, `idle`, `revoked`, `restart`, `waiting`, 새 값 `done`)을 그대로 적고 화면 표시는 읽는 쪽이 푼다: `revoked` = 사용자 중지(또는 사용자 명령에 의한 교체. 중지 때 이 값으로 반납한다, 커밋 `117b90719`), `disabled` = 프로필에서 빠짐, `done` = 단계 함수가 끝냄, `waiting` = 맡기기로 아래 프레임이 기다림(해제가 아니라 상태). 맡기기가 취소되어 아래 프레임이 돌아오는 것(`handoff_aborted`)은 종료 사유가 아니라 아래 프레임의 `lowerResumedWith`다. 한도 소비량은 `used`, 주도 중에 받은 사용자 메시지 수는 `userMessages`다(내용은 대화 로그가 갖는다). [구현 2026-11-18, 트랙 enC2m] 호스트 기록기(`turn-writer.ts`)가 `lease.acquired`·`lease.released`로 대화별 스택을 따르고, 턴 시작 때 열려 있던 프레임(`enteredAtMs` 0)과 턴 안의 변화를 `record.frames`와 `tr_frame` 행(`level: full`만)으로 쓴다. `depth`는 코어를 0으로 세므로 `lease.acquired.depth`에 1을 더하고, `plugin`은 `scopeId`다. 코어 프레임(깊이 0, `leaseId` 없음)은 `tr_frame`의 기본 키(`lease_id`)에 담을 수 없어 쓰지 않는다. `used`와 `userMessages`는 사건으로 센다 [제안, 2026-11-18]. (a) `turn.started`의 `origin: "drive"`는 `turns`를 1 올린다(엔진의 drive `turn` 명령에 맞춘다. 사용자 턴과 다른 출처의 턴은 세지 않는다). (b) `agent.spawned`의 `owner.kind: "drive"`는 `spawns`를 1 올린다(drive `spawn` 명령. `owner.leaseId`가 가리는 프레임과 그 아래 프레임에 더한다). (c) 열린 프레임이 있는 동안 대화의 모델 호출은 `usage.totalTokens`를 `tokens`에 더한다. (a)~(c)는 맨 위 프레임과 그 아래 프레임 모두에 더한다. 엔진 `charge`(`packages/ext-host/src/primitives/lease.ts`)가 맨 위 임대와 그 아래 임대에 더하는 것과 같다. 이것은 초기 제안 "맨 위 프레임만"과 다르다. 아래 프레임의 한도 검사는 위 프레임의 소비를 포함하므로 그 값을 맞추려고 바꿨다. (d) `input.queued`(출처 사용자, 항목 사용자)는 `userMessages`를 맨 위 프레임에만 1 올린다. 임대가 받은 메시지(`claimUserInput`)는 사건을 남기지 않아 세지 않는다(§11 18). `lowerResumedWith`는 실리는 사건이 없어 null이다(§11 19). 턴이 시작할 때 열린 프레임 값을 복사하므로, 여러 턴에 걸친 프레임은 누적된 값을 싣는다. 열은 `tr_frame.used_json`과 `user_messages`다(`used_turns` 같은 열은 없다 [근거: `apps/host/src/assembly/measure/turn-tables.ts`의 `tr_frame` 정의]). 구현은 `turn-writer.ts`의 `chargeFrames`·`queuedUserMessage`·`spawnCharge`다.
24. 하위 에이전트는 `agent.spawned`, `agent.settled`(`packages/contracts/src/records/catalog/agent.ts:76`, `:120`)로 부모 쪽 자리와 한도 도달(`limitHit`)을 얻는다. 자식 대화의 턴은 따로 `tr_turn`을 갖고 `parent` 링크와 부모와 같은 프로필 표지(`inherited: true`)를 단다(R13). 부모 턴 기록은 자식 목록(`TurnRecord.children`: `childThreadId`, `agent`, `status`, 사용량)만 품는다.
25. 사람에게 묻기는 `approval.requested/resolved`(`origin.toolCallId`, `origin.source.scopeId`, `decision`, `resolvedBy`)를 호출 기록의 `approval`과 훅 행의 `ask`로 잇는다. 응답을 기다린 시간은 `requested`와 `resolved`의 `recordedAt` 차이다.

### 4.5 컨텍스트 귀속 (R19)

26. [제안] 재료는 컨텍스트 조립이 내는 속성이다. `AssembledContext`(`packages/contracts/src/services/`)에 `materials: Material[]`을 더하고 `assembleContext`(`packages/core-context/src/assemble.ts:264`)가 채운다. 재료 토큰은 `composition`과 같은 어림이다.
27. 재료의 소유 플러그인을 정하는 규칙(위가 먼저):
    - 로더가 읽은 Inject 재료(지침 파일, 스킬 색인)는 그 선언의 플러그인과 `when`(`always` / `drive` / `on_demand`)을 쓴다 [가정: 로더 스펙이 `when`을 낸다]. `attribution: "declared"`.
    - `input.agent.before`가 낸 메시지는 디스패처가 체인 합치기에서 핸들러별 기여를 알려 주면(`ChainOutcome.contributions`, 새 필드 [제안], `dispatch-types.ts:93`) 그 핸들러의 플러그인이다. `declared`.
    - 기여를 모르는 훅 메시지(`context` 훅의 전체 재작성)는 `composition.injected` 하나로만 잡히고 `plugin`은 적용한 핸들러 플러그인 목록의 첫 값, `attribution: "shared"`, `PluginCost.shared: true`다. 개별 플러그인으로 쪼개지 않는다. 쪼갤 입력이 없다.
    - Drive 전용(`kind: "drive"`)은 선언에서만 정한다. 훅이 낸 메시지는 기여 플러그인이 그 턴의 맨 위 프레임이고 훅 입력에 `driver`가 자기라고 와 있으면 `drive`로 적되 `attribution: "inferred"`다.
    - 기본 프롬프트(`base-prompt`)는 코어가 선언한다: `plugin: "core"`, `attribution: "declared"`, `versionId: null` [제안].
    - 안내(`prompt-addition`, 기본 프롬프트 뒤에 `input.agent.before`가 더한 부분)는 기여한 핸들러가 하나뿐이면 그 플러그인이 `declared`다. 둘 이상이면 어느 쪽인지 정하지 않으므로 `core`가 `shared`다 [제안].
    [구현: 기본 프롬프트와 안내는 `packages/core-context/src/assemble.ts`의 `materialsOf`가 낸다(`CORE_OWNER`). 안내의 출처는 `packages/core-loop/src/loop/before-start.ts`가 `CollectOutcome.contributed`의 길이로 정해 `TurnRun.state.promptAdditionOwner`에 두고(`contributed`는 값을 돌려준 핸들러 전체라서 메시지만 더한 핸들러도 센다. 그래서 같은 턴에 색인 블록을 더한 지식 플러그인이 있으면 출처를 정하지 못해 `core`/`shared`가 된다. 기여를 핸들러별 체인으로 나누는 새 필드 `ChainOutcome.contributions` [제안]이 생기면 줄인다), `prepare-request.ts`가 `AssembleOptions.promptAdditionOwner`로 넘긴다. 이 값을 바꿔도 모델 요청 본문의 바이트는 같다(`context-trace.test.ts`의 바이트 비교). 절 키가 `plugin:`으로 시작하지 않는 절(예: `project`)은 아직 `none`이다. 기본값 목록에 없어 바꾸지 않았다(미결)]
28. 도구 광고는 `AdvertisedToolset`(`packages/contracts/src/services/tools.ts:288`)에서 온다. 광고 도구 수, 어림 토큰(`textTokens(canonicalJson(tool.wire))`, 광고 지문이 같으면 이전 계산을 재사용한다), 지연 도구 수, 제거 수, 지문을 `Advertised`에 둔다. 도구의 소유 플러그인은 `ToolRef.capability`(`packages/contracts/src/capabilities/tool-spec.ts:87`)로 정한다: 기능 id는 그 기능을 내놓은 기본 제공 플러그인, `ext.<이름>`은 그 플러그인, `mcp.<서버>`는 그 서버를 선언한 플러그인(로더가 안다 [가정]).
29. 스킬. 색인에 실린 이름(`buildSkillIndexBlock`의 `included`, `omitted`: `packages/cap-knowledge/src/skills/prompt-block.ts:57`)을 `skills.listed`에, 읽음은 `skill_view`(`packages/core-context/src/skill-bodies.ts:12`) 호출의 `name` 인자로 센다. 사용자가 명령으로 부른 스킬은 `via: "user"`다 [가정: 일회 사용 스펙이 부른 사실을 턴 입력에 남긴다]. 일반 `read` 도구로 `SKILL.md`를 읽은 것은 세지 않는다(§5.2의 한계).
    [구현: 색인과 기억 블록은 조립 입력에 들어오지 않고 `cap-knowledge`가 사용자 정의 메시지(`knowledge.context`)로 실으므로, `packages/cap-knowledge/src/turn-context.ts`가 블록을 만들 때 그 사실을 턴 기록 싱크(`TurnRecordSink`, `contracts/src/extensions/turn-record-sink.ts`, 포트 `fresnel.turnRecord`)로 알린다. 사건은 `skill_index`(`listed`, `omitted`, `tokens`)와 `memory`(`tokens`)다. 색인 블록의 어림 토큰은 블록 글자 수 / 4 올림이다. 블록이 이력에 남아 모델이 턴마다 보므로, 블록이 실린 대화의 `input.agent.before`가 도는 turn마다 같은 값을 다시 알린다. 수집기(`apps/host/src/assembly/measure/turn-writer.ts`의 `turnRecord`)는 그 대화의 열린 턴에 붙이고, 턴 안의 모든 단계에 `kind: "always"` 재료로 싣는다(`turn-context.ts`의 `blockMaterialsOf`). 소유 이름은 `knowledge`다. 기능 id `knowledge.skills`·`knowledge.memory`의 앞 이름이고 도구 광고의 `pluginOfCapability`와 같은 규칙이다(`cap-knowledge`라는 확장 이름을 쓰지 않는다) [제안]. `skills.listed`에는 색인에 실린 이름을, `listedOmitted`에는 예산 때문에 못 실은 수를 쓴다. 한계: (a) 델타 메시지로 바뀐 색인은 알리지 않는다(처음 블록의 값을 계속 쓴다), (b) 재시작 뒤 이어 받은 대화는 블록 사실을 모르므로 알리지 않는다, (c) `input.agent.before`가 돌지 않는 turn(재개 진입과 `skipBeforeStart`인 진입)은 알리지 않는다, (d) `tr_skill`의 `listed` 행은 아직 쓰지 않는다(턴 기록의 `skills.listed`만 채운다)]
30. 캐시 깨짐 귀속. 깨짐 후보는 이미 기록되는 경고에서 얻는다: `cache_prefix_reset`(`plugins`, `owners`: `assemble.ts:364`), `tools_deferred`(`added`, `removed`), `cache_reset_model_switch`, 그리고 `measure` 기록기의 만료 판정(`recorder.ts:180~212`: 캐시 쓰기 1000 이상이며 앞 호출의 두 배 넘고 읽기가 반 아래). 귀속은 다음 순서로 한다.
    - 구조 경고가 있고 제공자 사용량도 깨짐을 보이면 `observed: true`, 원인은 경고의 종류. `prefix_reset`은 경고의 `plugins`, `toolset`은 추가·제거된 도구의 소유 플러그인, 절 변경은 절 소유 플러그인, 덧씌운 도구는 `overlay_tools`와 그 플러그인.
    - 구조 경고는 있는데 사용량이 깨짐을 안 보이면 `observed: false`(예측만).
    - 사용량만 깨짐을 보이고 경고가 없으면 `ttl`(앞 호출과 간격이 5분을 넘음), `compaction`(`thread.compacted`가 같은 단계 앞에 있음), 아니면 `unknown`.
    - 원인 한 개가 한 플러그인으로 정해지지 않으면 `plugin: null`이고 `registrations`에 후보 목록을 둔다.
    - `evidence`: 경고에서 온 것은 `declared`, 시간·사용량에서 추정한 것은 `inferred`다.

### 4.6 범위 표지와 시험 기록

31. 범위는 턴마다 정해 `tr_turn.scope_kind`에 쓴다.
    - `live`: 일반 대화에서 프로필이 정한 플러그인만 돈 턴.
    - `overlay_reviewed`: 일회 덧씌우기로 검토된 플러그인이 얹힌 턴(R15).
    - `overlay_draft`: 실제 대화에 초안을 얹은 턴(화면 스펙 흐름 8). 초안 버전 id(`draft:<draftId>:<해시 앞 8자>`)가 `overlay.plugins[].versionId`에 있고 `draftId`가 채워진다. 이 표지의 정본은 여기이고, 호스트 기록기가 M5c의 `profile.applied.overlay[].draftId`로부터 만든다.
    - `test`: 테스트 실행 대화의 모든 턴.
    - `craft`: 테스트 대화(Craft 전용 AI 대화, M5c §4.8)의 모든 턴. 표지는 `thread.started.craftChat`에서 호스트 기록기가 만든다.
32. 테스트 실행 표지는 대화를 만들 때(`thread.create { testRun }`, `ports.ts:304`) `tr_thread`에 내구로 쓴다. `ext-host`의 `openThread(…, { testRun: true })`(`ports.ts:668`)는 재시작 뒤에도 `tr_thread`를 읽어 표지를 되살린다. 지금은 메모리 `Set`뿐이라 재시작하면 Test run이 일반 대화가 되고 그 기록이 지표에 섞인다. 표지 기록은 계측 꺼짐과 무관하게 쓴다.
33. 지표 기본 필터는 `scopes: ["live", "overlay_reviewed"]`다. `overlay_draft`, `test`, `craft`는 명시로 넣어야 나온다. `overlay_reviewed`는 프로필에 없던 플러그인의 지표를 보려는 쓰임이 있어서 플러그인 지표에는 넣고 프로필 비용 지표에서는 뺀다 [제안].
34. 같은 입력으로 여러 번 돌린 Test run은 `run_group_id`로 묶는다. `input_hash`는 첫 사용자 입력의 `callKey`와 같은 방식 HMAC이다. `testRun.compare`는 `input_hash`가 같으면 `sameInput: true`, 아니면 `false`로 경고만 한다. [구현: enB5, `turn-writer.ts`의 `inputHashOfQueued`가 테스트 실행 대화의 첫 사용자 `input.queued`에서 글 부분을 `\n`으로 이어 쓴다. 원문은 저장하지 않는다]
35. 초안 버전 비교(`testRun.compare`)는 대화별 요약을 나란히 놓는다: 턴·단계 수, 토큰과 비용, 호출 열거(도구 이름 순서), `verdict`별 수, 플러그인별 훅 결과 수, 로드된 재료. 모델의 응답이 매번 달라지므로 표본 한 개 비교는 "관찰"이라고 표시한다(`sample: 1`). 케이스와 반복을 갖춘 비교는 기존 순수 모듈 `compareRuns`, `planRuns`(`docs/xeon/L4/host-service/spec.md` §4.21, `apps/host/src/assembly/eval/compare.ts`)를 재사용하고 판정(`improved`, `regressed`, `indistinguishable`)을 그대로 낸다. 연결은 이 문서가 하지 않고 테스트 화면 스펙이 한다 [제안].
36. `craft` 범위의 표지는 대화를 만들 때 `tr_thread.scope_kind = craft`로 내구 기록하고(규칙 32와 같은 방식, 계측 꺼짐과 무관) 모든 턴이 이를 따른다. 빌더 플러그인과 숨은 `craft` 프로필의 지표를 오염하지 않게 하려는 것이다. 테스트 대화 안에서 돈 `testRun`은 별개의 대화(`test`)다.

### 4.7 지표 계산

36. 창은 기본 30일(`defaultWindowDays`)이고 필터는 `MetricFilter`다. 필터는 `tr_turn`의 열로 걸고 플러그인·훅·모델·프로필은 하위 테이블 열로 건다.
37. 계산은 읽을 때 한다(on read). 원본 창 안은 `tr_*`를 SQL로 훑는다. 창이 원본 보관 기간을 넘으면 넘는 날은 `tr_daily`를 쓴다. 증분 투영은 두지 않는다. 이유: 질의 수가 적고(사람이 화면을 열 때), 정의가 바뀌면 원본에서 다시 계산할 수 있어야 한다.
38. `tr_daily`는 원본을 접을 때 (day, subject, plugin, ref, model, profile, scope_kind, caller)별로 카운터를 더한다. 카운터는 지표의 분자·분모와 같다(§5의 "집계" 열). 시간 분포는 2의 거듭제곱 구간 20칸 히스토그램(`hist_json`)으로 접는다. 그래서 보관 기간을 넘는 창에서는 비율·합·개수·근사 분위수를 낼 수 있고, 호출 간 이웃 판정이 필요한 지표는 접기 전에 분류를 끝내 카운터로 접는다(§5.1).
39. 모든 값은 `MetricValue`로 돌려준다. `n`이 `minSample` 아래이면 `insufficient_sample`이다. 계측이 꺼진 구간이 창에 섞여 있으면 그 구간의 턴 수를 `notes`에 알린다(`measurement_off`), 0으로 채우지 않는다.
40. 비교(`compare`)는 `pluginVersion`, `model`, `profileRev`로 그룹을 나누어 같은 지표를 두 줄로 낸다. 두 그룹 사이에 다른 차원이 함께 바뀌었으면 `notes`에 `confounders`로 적는다(예: 플러그인 버전은 바뀌었는데 모델도 바뀜). 인과를 말하지 않는다.
41. 살펴볼 것은 `findings.list`가 읽을 때 계산하고 `(profileId, period, dataRevision)`로 캐시한다. `dataRevision`은 `tr_turn`의 가장 큰 rowid다. 증거는 대표 50개(최근 것 우선, 같은 대화가 한 번에 5개를 넘지 않게)와 총수를 낸다. 총 목록은 `findings.evidence`로 쪽 단위로 읽는다.
42. 사용자가 치운 발견(`dismiss`)은 근거 지문(`fingerprint` = 규칙 id + 대상 + 지표 값을 10% 단위로 줄인 값)이 크게 바뀌면(두 배 이상) 다시 열린다 [제안].
43. 증거를 테스트 대화로 넘기는 방식. 발견의 `next[].target: "craft_chat"`은 `{ ruleId, subject, window, metrics, evidence: EvidenceRef[](≤50), suggested }` 묶음을 만든다. 묶음은 16 KiB 이하이고 id, 해시, 숫자만 담는다. 테스트 대화 창(R17 스펙)이 이것을 맥락으로 받고 내용이 필요하면 `turnRecord.get`과 대화 로그 읽기로 푼다. 사용자는 문제를 다시 설명하지 않는다(`docs/xeon/review/m6/craft-flows.md` §3.6). 고친 초안을 같은 증거로 시험하려면 `backtest.run`의 `scope.turns`에 증거의 `(threadId, turnId)`를 넘긴다.

### 4.8 지난 턴에 돌려 보기 (R16 엔진 쪽)

44. 돌려 볼 수 있는 훅은 `tool.call.before`, `guard.tool.before`, `tool.result` 셋이다(`ReplayableHook`). 그 밖의 훅은 `3522 backtest.hookNotReplayable`이다.

    | 훅 | 가능 | 이유 |
    |---|---|---|
    | `tool.call.before`, `guard.tool.before` | 예 | 입력 payload(`ToolCallPayload`: `toolName`, `input`, `risk`, `capability`, `hints`, `caller`, `parentToolCallId`: `packages/contracts/src/extensions/hooks/tool.ts:51`)를 기록에서 만들 수 있다 |
    | `tool.result` | 조건부 | 저장된 결과 본문이 있어야 한다. 저장된 본문은 당시 활성 `tool.result` 훅을 이미 거친 값이고 시크릿이 가려져 있다. 그래서 "근사"이고 항목에 `result_not_stored`로 건너뛴 호출을 센다 |
    | `input.user.before`, `input.agent.before` | 아니오(1차) | 사용자 원문이 훅 적용 전 값인지 로그에서 확인하지 못했다 [미결] |
    | 컨텍스트·요청·모델 훅, `boundary.*`, 컴팩션 | 아니오 | 입력인 조립 전 메시지 전체가 저장되지 않는다(`storeRequestBody`는 훅을 거친 뒤, 켰을 때만). 모델 반응에 달려 있어 기록만으로 결과를 못 낸다 |
    | 관찰 전용 훅(tap) | 제공하지 않음 | 결과를 바꾸지 않으므로 돌려 볼 값이 없다 |

45. 입력 재구성. 호출 하나의 payload는 어시스턴트 항목의 `toolCall`(이름, `arguments`)과 `CallRecord.meta_json`(기록 당시의 `risk`, `capability`, `hints`, `afterUntrusted`, `caller`)으로 만든다. 현재 도구 레지스트리에서 다시 읽지 않는다. 레지스트리가 바뀌어도 같은 입력이다. 인자는 로그의 값(256 KiB 초과는 blob)이다. 로그나 blob이 없으면 `unreplayable`이다.
46. 실행하지 않는다. 호출은 도구를 실행하지 않고, 후보의 결정만 얻는다. 후보는 격리된 플러그인 프로세스(P1)에서 돈다. 엔진은 요청에 `replay: true` 플래그를 싣는다(엔진 설계 §3.2의 경계 규약). 후보 코드가 호스트 API를 부르는 길은 다음으로 막는다: `commit`, `record`, `post`는 성공 응답을 주되 버리고, 기능(`capability()`) 호출과 `tool` 명령 길은 모두 `replay_mode_denied`로 거부한다. 거부가 일어나면 그 호출은 `candidate_fault`로 센다. 상태 읽기는 후보의 현재 커밋된 상태의 사본(실행 중 쓰기는 사본에만 반영)이다.
47. 순서. 기록된 순서대로(대화별, 시각순) 후보 한 개를 한 호출씩 부른다. 병렬로 하지 않는다. 시간 상한은 호출마다 `callTimeoutMs`, 전체 `totalTimeoutMs`다.
48. 후보가 비결정적이면(시각, 난수, 외부 입력, 사본 밖 상태) 결과가 실제 사용과 다를 수 있다. 결과에 `stateful: true`를 달지 못한다(후보 코드를 분석하지 않는다). 대신 같은 입력을 연속 두 번 돌려 결과가 다르면 항목에 `nondeterministic`을 단다 [제안].
49. 분류(`BacktestItem.class`)는 후보 결과와 실제 `verdict`의 짝으로 정한다.
    - 후보가 막음·물음이고 실제 `allowed` → `newly_caught`. 실제로 `denied_human`이 아니라 사람이 허용했으면(`approval.decision = allow`) 추가로 `would_block_allowed_by_human`.
    - 후보가 `replace`이고 실제 `allowed`이면 `newly_caught`로 센다.
    - 후보가 막음이고 실제도 막혔다 → 실제가 다른 훅이면 `agrees_block`, 정책·사람이면 `already_stopped`.
    - `guard.*`와 다른 first 훅에서 앞 핸들러가 멈춰 뒤 핸들러(후보 자리)가 이르지 못했을 호출은 `already_stopped`로 두고 `skippedBy`를 보인다. 후보를 단독으로 돌릴 뿐 앞 훅과의 순서를 모사하지 않는다.
    - 후보가 던지거나 시간 초과이면 `candidate_fault`다. 막음이 아니다.
    - 그 밖에는 `passes_same`.
50. "사용자가 나중에 되돌렸나"는 기록에서 얻을 수 있는 두 신호만 단다(`laterSignals`): 그 호출의 승인이 `deny`로 해결됨(`approval_denied`), 그 턴이 `thread.leaf_moved { reason: "rewind" }`로 가지 밖이 됨(`turn_rewound`). 파일을 되돌렸는지는 모른다. 되감기는 파일을 되돌리지 않고(`packages/contracts/src/records/session-service.ts:337`의 주석) 파일 되돌림 기록이 로그에 없기 때문이다. 이 두 신호는 "되돌렸다"가 아니라 "그런 신호가 있다"로만 보인다.
51. "비슷하지만 못 잡은 것"(`similarNotCaught`)은 설명 가능한 두 규칙으로만 낸다: 후보가 막은 호출과 같은 도구에 같은 `targetKey`(`same_tool_same_target`), 또는 같은 도구에서 문자열 인자 토큰 집합의 겹침(자카드)이 0.6 이상(`arg_overlap`, 점수 동봉). 후보가 통과시킨 호출만 대상이고 최대 20개다. 대상 인자 문자열은 로그에서 읽어 계산하고 결과에는 `toolCallId`만 싣는다.
52. 한도. 한 번에 최대 `maxTurns`(50) 턴, `maxCalls`(2000) 호출, 동시에 한 번만 돈다(`backtest.busy`). 기본 범위는 `live` 범위만이다. 테스트 실행과 초안 덧씌움 기록은 `include`로 넣어야 한다. 보관 기간이 지난 턴은 대상이 아니다. 삭제된 대화는 `thread_deleted`로 센다.
53. 재현하지 못하는 것은 결과마다 고정 식별자 목록 `notReproducible`로 함께 돌려준다(순서대로 `model_reaction_after_block`, `later_call_order_and_count`, `other_plugin_hook_interaction`, `human_answer_to_ask`, `candidate_time_or_external_state`, `candidate_network_side_effects`. 문장은 화면이 카탈로그로 그린다 [제안]. 실행별 사유는 항목의 `unreplayableReason`과 요약이 맡는다): (1) 막힌 뒤 모델이 어떻게 반응했을지(다른 호출을 했을지, 멈췄을지), (2) 이후 호출 순서와 수(막았다면 그 뒤가 달라진다), (3) 다른 플러그인 훅과의 상호작용(후보 단독 평가), (4) 사람이 물음에 어떻게 답했을지(기록된 답만 있다), (5) 후보가 시각·외부 상태에 기대는 부분, (6) 후보의 네트워크 부작용(격리 1·2단계는 네트워크를 막지 않는다: `docs/xeon/review/m5/drive-isolation.md` §3.4). (6)을 위해 후보를 처음 돌리기 전 한 줄로 알린다 [제안].
54. 후보는 `versionId`로 정해진다. 초안(`draft:…`)은 검토 전에도 돌려 볼 수 있다(R2 확정: 초안은 테스트 화면에서 검토 없이 돈다). 후보가 격리 프로세스에서 돌 수 없으면(P1 전, 후보가 코드 없는 Inject 전용) `3524` 또는 `3522`다.

### 4.9 대화 안의 흔적 (R23 데이터)

55. 막음과 고장의 흔적은 기록이 없어도 만들 수 있다. 막힌 호출의 toolResult 항목이 `details { code, hook, extension, outcome, reason }`를 이미 대화 로그에 갖는다(`pipeline.ts:161~188`). 이 칩은 `level: none`에서도 보인다. 다만 `outcome: "threw"`는 던짐과 시간 초과를 구분하지 않는다. 구분은 기록(`HookRun.reason`)이 있어야 나온다.
56. 조용한 고침(`result: "modified"`)은 로그에 흔적이 없다. 데이터는 `HookRun`이고 앵커는 `{ toolCallId | itemId | turnId }`다. 호출 기록의 `result.itemId`는 `effect.result.resultItemId`(`packages/contracts/src/records/effects.ts`)와 같다. 무엇이 바뀌었는지(차이)는 저장하지 않는다. 크기(`size`)만 남는다. 필요하면 테스트 화면에서 같은 입력으로 다시 돌린다 [미결: 고친 전후를 옵트인으로 저장할지].
57. 갱신 사건은 둘이다. (a) 기존 대화 로그 이벤트: `lease.acquired/released`, `turn.started.scopeId`, `approval.requested/resolved`, `agent.spawned/settled`가 현재 프레임과 물음 카드를 계속 갱신한다. (b) 새 알림 `turnRecord.delta`: 훅 결과와 호출 판정을 단계 끝보다 먼저(메모리 수집기에서 바로) 보낸다. 화면이 열린 대화는 `turnRecord.watch`를 한 번 걸고, 닫힌 턴은 `turnRecord.get`으로 읽는다.
58. 현재 Drive 프레임 스택(`기본 › Helm › 검증`)은 로그 이벤트에서 클라이언트가 만든다. `group.driveLock`(기존 W-42)은 주도자 하나를 돌려 주므로(`docs/xeon/F/wire-settings/spec.md` 표) E3이 프레임 목록으로 바꾸는 시점에 이 스펙도 `FrameMark`를 같은 모양으로 맞춘다 [가정].
59. 흔적에서 턴 기록으로 가는 이동은 `turnRecord.get { threadId, turnId }`와 `EvidenceRef`다. 대화의 항목은 이미 `turnId`를 갖는다.

### 4.10 프로필 표지 (R16 데이터)

60. [제안] 턴 기록의 `profile`(id, 개정)과 `tr_turn.profile_id`, `profile_rev`는 턴이 시작할 때 정한다. 값은 그 턴 앞에 있는 같은 대화의 마지막 `profile.applied`다(M5c §4.1.5, 턴 밖의 경계에서 적용된 것도 든다). 그런 사건이 없으면(새 대화의 첫 턴, 또는 기록기를 켠 뒤 처음 보는 대화) 대화의 `PluginSetPort.resolve`가 주는 현재 값을 쓰고, 포트도 없으면 `default`와 개정 0이다. 조립이 포트를 기록기에 넘기는 일은 아직 연결하지 않았다 [미결] [근거: apps/host/src/assemble.ts:1317, `startMeasurement`에 `pluginSet` 한 줄을 더한다]. 연결 전에는 기록기를 켠 뒤 처음 보는 대화의 시작 값이 `default`·0이 된다.
61. [제안] `source`: `thread`는 쓰인 프로필 id가 대화가 저장한 id(`thread.started`·`thread.updated`의 `profileId`)와 같을 때, `builtin`은 그 밖일 때다. 저장한 id가 없어 `default`를 쓰면 `builtin`이다. 저장한 프로필이 없어 `default`를 쓰면(`profile.applied { reason: "profile_missing" }`) 역시 `builtin`이다. 저장한 프로필이 없었다는 사실은 턴 기록의 칸이 없어 싣지 않는다. 기록기가 저장한 id를 모르면 포트 값에서 되짚고, 포트도 없으면 적용된 값에서 되짚는다(기본이 아닌 id는 저장한 id로만 쓰이므로 그것이 저장한 id다). 포트 값에서 되짚을 때는 저장한 id가 `default`인지 가릴 수 없어 `builtin`으로 본다.
62. [제안] `inherited`: 이 대화가 부모 턴의 `agent.spawned`(`childThreadId`)로 만들어진 하위 대화면 참이다(규칙 24). 자식의 `thread.started.profileId`는 생성 때의 부모 값이고(M5c §4.1.15), `agent.spawned`는 자식의 첫 턴보다 먼저 커밋되므로 자식 턴이 시작할 때 이미 안다.
63. [제안] `profileRevChanges`: 턴 안의 `profile.applied`는 단계 경계에서 온다. 그 사건은 경계가 끝낸 단계의 `step.completed`와 같은 커밋에 있다. 개정이 직전 값(시작 값 또는 직전 바뀜)과 다르면 `{ stepIndex, rev }`를 더한다. `stepIndex`는 그 경계가 끝낸 단계의 다음 번호다(턴의 첫 단계는 0). 마지막 단계 뒤의 경계는 실행되지 않을 단계 번호를 가질 수 있다. 프로필 id만 바뀌고 개정이 같으면 줄을 더하지 않는다(스키마의 `profileRevChanges`는 id 칸을 두지 않는다). `tr_turn.profile_rev_changes_json`은 배열이 비면 null이고 아니면 `record_json`의 같은 배열을 직렬화한 값이다.

## 5. 지표 정의 표

창은 모두 `MetricFilter.period`(기본 30일)이고 계산은 읽을 때 한다(§4.7 규칙 37). "집계"는 `tr_daily`에 접는 카운터이기도 하다. 가능 열: 예 = 기록만으로 정확, 근사 = 기록만으로 정의되지만 어림이 들어감, 부분 = 일부 경우만, 아니오 = 기록만으로 안 됨.

| ID | 대상 | 정의 | 원천 필드 | 집계 | 기록만으로 가능한가 |
|---|---|---|---|---|---|
| `inst.loaded_turns` | 지침 | 플러그인 P의 `always` 재료가 하나라도 실린 턴 수 | `tr_material(plugin, kind="always")` | 턴 수. 분모는 프로필 턴 수 | 예 |
| `inst.tokens` | 지침 | 실린 턴의 `always` 재료 어림 토큰 합의 p50·p95·합 | `Material.tokens` | 턴별 합 → 분위수(히스토그램) | 근사(글자 수 / 4) |
| `inst.truncated` | 지침 | `truncated = true` 재료가 있는 턴 수와 비율 | `Material.truncated`, `omitted` | 개수, 분모는 `inst.loaded_turns` | 부분: 잘림을 재료 출처가 알려 주는 경우(스킬 색인 예산, 로더의 파일 크기 한도)만 |
| `inst.defied` | 지침 | §5.1-①의 정의 | `tr_material`, `tr_hook`(결과 `blocked`·`ask`) | 분자 `defied_turns`, 분모 `inst.loaded_turns` | 근사: 플러그인 단위, 규칙 단위가 아님 |
| `skill.listed_turns` | 스킬 | 색인에 이름이 실린 채로 컨텍스트에 있던 턴 수 | `TurnRecord.skills.listed` | 턴 수 | 예 |
| `skill.read_turns` | 스킬 | `skill_view`로 읽힌 턴 수 | `skills.read` | 턴 수 | 부분: `skill_view`로만 센다 |
| `skill.activation_rate` | 스킬 | `read_turns / listed_turns` | 위 둘 | 비율 | 부분. 목록에 있었다고 필요했던 것은 아니다 |
| `skill.read_origin` | 스킬 | 읽음의 `via` 분포(모델 / 사용자) | `skills.read.via` | 개수 | 예(`via`를 일회 사용 스펙이 줄 때) |
| `skill.activation_by_model` | 스킬 | 모델 버전별 `activation_rate`와 두 모델 사이의 차 | `ModelCall.modelId`(턴의 첫 main 호출) | 모델별 카운터 | 근사. §5.1-③ |
| `skill.never_read` | 스킬 | 창 안에서 목록에 `n ≥ minSample`턴 실렸으나 읽힘 0 | 위 | 개수 | 부분(`skill_view` 한정) |
| `tool.calls` | 도구 | 호출 수(막힌 호출 제외 / 포함 둘을 모두 냄) | `tr_call` | 개수 | 예 |
| `tool.error_rate` | 도구 | 실행된 호출 중 `exec.status = error` 또는 `result.isError` | `tr_call.exec_status` | 비율 | 예 |
| `tool.duration` | 도구 | 실행 시간 p50·p95 | `exec.durationMs` | 히스토그램 | 예 |
| `tool.result_tokens` | 도구 | 결과 어림 토큰 p50·p95 | `result.tokens` | 히스토그램 | 근사 |
| `tool.never_called` | 도구 | 광고 도구 중 창 안에서 호출 0이고 `n ≥ minSample`턴 광고됨. 그 도구들의 정의 어림 토큰 합 | `tr_tooluse(state, called, tokens)` | 도구별 카운터 | 예(§5.1-④) |
| `tool.deferred_activation` | 도구 | 지연 도구 중 활성화된 비율 | `Advertised.tools[state]` | 비율 | 예 |
| `hook.runs` | 훅 | (플러그인, 훅)별 실행 수 | `tr_hook` | 개수 | 예 |
| `hook.outcomes` | 훅 | `result`, `reason`, `ask`로 만든 일곱 갈래 분포 | `tr_hook` | 개수 | 예 |
| `hook.ask_answers` | 훅 | 물음에 대한 답 분포(허용·거부·답함·취소·만료·비대화형) | `ask.answer` | 개수 | 예(훅이 물을 수 있게 되는 시점부터. 지금 정책 승인은 훅 행이 아니다) |
| `hook.duration` | 훅 | 활성 시간 p50·p95·max | `ms` | 히스토그램 | 예 |
| `hook.fault_rate` | 훅 | `failed / runs`, 시간 초과 `reason = timeout` 별도 | `result`, `reason` | 비율 | 예 |
| `hook.hit_rate` | 훅 | `(blocked + modified + 물음) / runs` | `tr_hook` | 비율 | 예 |
| `hook.shadowed` | 훅 | `skipped`이고 `skippedBy` 있는 비율(앞 훅 때문에 이르지 못함) | `skippedBy` | 비율 | 예 |
| `hook.post_block` | 훅 | 막힌 뒤 모델의 다음 행동 분포 | `tr_call(call_key, target_key, tool, step_index)` | 접기 전에 분류해 분류별 개수 | 부분. §5.1-② |
| `drive.entries` | Drive | 플러그인이 맨 위 프레임이 된 횟수 | `tr_frame`, `lease.acquired` | 개수 | 예 |
| `drive.usage_vs_limit` | Drive | 쓴 턴·서브에이전트·토큰과 `limits` 대비 | `tr_turn`(scopeId), `agent.spawned.owner`, `limits_json` | 합, 비율 | 예(자식 토큰 포함 규칙은 E3 한도 상속을 따른다) |
| `drive.exit_reasons` | Drive | 반납 사유 분포(끝남, 한도 소진, 오류, 사용자 중지, 제거, 재시작) | `exit_reason` | 개수 | 예 |
| `drive.asks` | Drive | Drive 중 사람에게 물은 횟수 | `approval.requested`, 프레임 | 개수 | 예 |
| `block.time_split` | 블록 | 턴 시간을 모델 대기, 도구 실행, 훅, 사람 대기, 나머지로 나눔 | `ModelCall.durationMs`, `exec.durationMs`(구간 합집합), `HookRun.ms`, 승인 `waitMs` | 합 | 근사: 병렬 호출은 구간 합집합으로 센다. "나머지"는 남는 값 |
| `block.compactions` | 블록 | 컴팩션 횟수 | `thread.compacted` | 개수 | 예(로그) |
| `block.cache_hit_rate` | 블록 | `cacheRead / (input + cacheRead + cacheWrite)` | `ModelCall.usage` | 합의 비율 | 근사: 제공자마다 칸 뜻이 다르다. 칸이 없으면 `unavailable` |
| `block.cache_breaks` | 블록 | 캐시 깨짐 횟수와 비율 | `tr_cache` | 개수 | 부분: 관찰(`observed`)과 예측을 나눠 센다 |
| `block.cache_breaks_by_plugin` | 블록 | 플러그인별 귀속 깨짐 수와 `unknown` 비율 | `tr_cache.plugin`, `evidence` | 개수 | 근사. §5.1-⑤ |
| `ver.compare` | 버전 | 위 지표를 `pluginVersion`, `model`, `profileRev`로 나눠 비교 | 각 행의 `plugin_version`, `profile_rev` | 그룹별 카운터 | 근사: 교란이 `confounders`로 보인다 |
| `cost.always` / `cost.drive` / `cost.on_demand` | 비용 | `PluginCost` 열의 평균·p95 | `Material`, `Advertised`, 프레임 | 턴별 합 | 근사(글자 수 / 4) |

### 5.1 어려운 지표의 정의와 한계

**① 지침이 있는데도 같은 플러그인의 훅이 막거나 물은 횟수** (`inst.defied`)

- 정의: 플러그인 P와 턴 T에 대해 (a) T의 어느 단계에서 P의 `always` 재료(또는 P가 맨 위 프레임인 단계의 `drive` 재료)가 실렸고, (b) T 안의 도구 호출 c의 훅 실행 h가 있어 `h.plugin = P`이며 `h.result = "blocked"` 또는 `h.ask ≠ null`이고, (c) c의 `verdict`가 `blocked_hook`, `blocked_guard`, `denied_human` 중 하나(고장이 아니다)인 경우다. `defied_turns`는 이런 T의 수, `defied_calls`는 c의 수다. 비율의 분모는 `inst.loaded_turns`다.
- 한계: (1) 플러그인 하나가 지침 여러 개와 훅 여러 개를 가질 수 있어 그 훅이 막은 일이 그 지침이 말한 일인지 기록만으로 모른다. 같은 플러그인이라는 이유로 묶는다. (2) 훅이 없는 플러그인(지침만 든)은 지침이 안 지켜져도 기록에 신호가 없다. 이 경우는 이 지표를 낼 수 없다(`undefined_without_labels`). 사람이 턴 기록에서 "이 줄은 지침 위반"을 표시하는 길이 필요하나 이 문서 범위 밖이다 [미결]. (3) 지침을 따른 덕에 훅이 안 걸린 턴은 분모에만 들어간다. 높은 비율은 "지침만으로 부족하다"의 신호이고 낮은 비율이 "지침이 잘 지켜진다"를 뜻하지는 않는다.
- 규칙 단위로 맞추는 길(훅 결정과 지침에 같은 `ruleId`를 붙이는 선언)은 플러그인 매니페스트의 일이다. 정하면 이 지표가 "정확"이 된다 [미결].

**② 막힌 뒤 모델이 한 일** (`hook.post_block`)

보수적이고 설명 가능한 분류만 한다. 막은 호출 b(`verdict ∈ {blocked_hook, blocked_guard, denied_human}`, 고장은 제외)마다, 같은 턴에서 b 다음 단계와 그다음 단계(앞으로 보기 2단계 [제안])의 도구 호출을 살핀다.

| 분류 | 조건 |
|---|---|
| `stopped` | 앞으로 보는 2단계 안에 도구 호출이 없다(텍스트로 답하고 끝났거나 사용자에게 돌려줌) |
| `repeat` | 같은 도구, 같은 `callKey`: 같은 시도를 되풀이 |
| `rewrite` | 같은 도구, 같은 `targetKey`(null 아님), 다른 `callKey`: 같은 대상에 다른 모양으로 시도 |
| `rewrite_text` | `targetKey`가 없는 도구에서 같은 도구, 문자열 인자 토큰 겹침 ≥ 0.8, 다른 `callKey` (신뢰 낮음) |
| `other_tool_same_target` | 다른 도구, 같은 `targetKey`(null 아님) |
| `different_path` | 위에 해당하지 않는 도구 호출 |

- 여러 해당이 있으면 `repeat` > `rewrite` > `other_tool_same_target` > `rewrite_text` > `different_path` 순으로 가장 강한 것을 쓴다.
- "우회 의심"은 `rewrite`, `other_tool_same_target`, `rewrite_text`의 합이다. 화면에서 "우회"라고 단정하지 않는다.
- 한계: 모델의 의도를 알 수 없다. `targetKey`는 파일 경로를 선언한 도구에만 있다. `bash`로 막힌 명령을 다른 문법의 `bash` 명령으로 우회한 것은 `rewrite_text`의 토큰 겹침이 높을 때만 잡히고, 도구가 다른 우회(`rm`을 막으니 `python -c`를 씀)는 잡히지 않는다. 그래서 이 지표는 `state: "approx"`이고 `bash` 전용 분류는 낮은 신뢰로 따로 표시한다.
- 접기: 분류는 턴 기록을 쓸 때(턴 끝) 끝내고 분류별 카운터로 `tr_daily`에 접는다.
- [구현: 인자 토큰 목록] 토큰은 `packages/core-tools/src/call-trace.ts`의 `argTokensOf`가 만든다. 최상위 문자열 인자를 키 순서로 읽고, 글자·결합 기호·숫자가 아닌 곳에서 나누고, 소문자로 하고, 두 글자 미만을 버리고, 64글자로 자르고, 처음 나온 순서로 중복을 뺀 뒤 64개까지 남긴다. 이 정의는 이 문서가 정하지 않은 것을 수집기가 정한 값이다 [제안]. 계약 `ToolCallTraceEvent`는 원본 목록 `argTokens`와 예전 어림 토큰 수 `argTokenCount`를 싣는다. 원본 목록은 프로세스 안에서만 쓰인다. 호스트 기록기(`turn-rows.ts`의 `maskedArgTokensOf`)가 토큰마다 `callKey`와 같은 방식(설치 소금의 HMAC, 앞 16 hex)으로 가려 `tr_call.meta_json.argTokens`에 쓰고, `argTokenCount`는 그대로 둔다. 원본 토큰은 어느 저장 행에도 들어가지 않는다([근거: `turn-record-write.test.ts`의 인자 토큰 시험]). 같은 소금이면 같은 단어는 같은 값이라 겹침(자카드)은 가린 값끼리 잰다. 숫자 모양의 옛 `argTokens`는 목록이 아니므로 `not_recorded`로 읽힌다. `hook.post_block.rewrite_text`는 목록이 있는 막힌 호출이 한 번이라도 있을 때만 값을 내고, 없으면 `not_recorded`다(0으로 세지 않는다).

**③ 모델 버전별 스킬 발동률** (`skill.activation_by_model`)

- 단위는 턴이다. 모델 버전은 그 턴의 첫 main 모델 호출의 `modelId`로 정하고, 한 턴 안에서 모델이 바뀐 턴은 이 지표에서 뺀다(`mixed_model`로 센다).
- 한계: 발동률은 "필요했는데 읽혔나"가 아니라 "목록에 있었는데 읽혔나"이다. 일의 종류가 바뀌어도 값이 변한다. 그래서 한 모델의 절대 값에 의미를 두지 않고 같은 스킬에서 두 모델 구간의 차이를 신호로 쓴다(§6 규칙). 표본이 `minSample` 미만인 구간은 `insufficient_sample`이다. 프로필·플러그인 버전이 같이 바뀌었으면 `confounders`를 단다.

**④ 한 번도 안 불린 도구와 그 설명 토큰** (`tool.never_called`)

- 창 안에서 `state ∈ {advertised, activated}`로 `n ≥ minSample`개 턴에 나타났는데 `called = 0`인 도구. 그 도구들의 정의 어림 토큰을 턴당 평균과 합으로 낸다. 지연 도구는 이름 목록만 싣고 있으므로 정의 토큰을 세지 않고 `deferred_activation`으로 따로 본다.
- 한계: "안 불렸다"는 지금 프로필·작업에서 필요 없었다는 뜻일 뿐 영원히 필요 없다는 뜻이 아니다. 창과 작업 종류가 좁으면 틀린다. 표시할 때 창과 턴 수를 같이 보인다.

**⑤ 플러그인별 캐시 깨짐** (`block.cache_breaks_by_plugin`)

- 귀속의 근거는 §4.5 규칙 30이다. 깨짐이 일어났다는 것(관찰)과 어느 플러그인 탓인가(귀속)는 다른 확실성이다. 관찰은 제공자 사용량에서 오지만 이유를 알려 주는 경로가 없다(`docs/xeon/L4/host-service/spec.md` §4.20 `cache` 행 [미결]). 귀속은 구조 경고(우리 쪽 선언)와 시간 추정이다.
- 그래서 지표는 항상 `observed`와 `predicted_only`를 나눠 보이고, 플러그인 귀속 중 `evidence = inferred`와 `unknown`의 비율을 같이 낸다.

## 6. 살펴볼 것 규칙 표

각 규칙은 `ruleId`, 버전, 대상, 조건, 임계 [제안], 보이는 근거, 다음 걸음이다. 임계는 `x.operations.findings.overrides`로 덮어쓴다. 모든 규칙은 `scopes = [live, overlay_reviewed]`의 기록만 보고 `minSample`(기본 20) 미만이면 발동하지 않는다. 모든 발견은 다음 걸음을 하나 이상 가진다(`docs/xeon/review/m6/craft-flows.md` R7). "고치기"는 근거를 들고 테스트 대화 창을 연다(§4.7 규칙 43). "올리기"는 권고를 강제(Hook, 막기)로 올리는 초안 요청이다. "빼기"는 프로필 편집으로 간다.

| ruleId | 대상 | 조건 | 임계 [제안] | 보이는 근거 | 다음 걸음 |
|---|---|---|---|---|---|
| `unused_tools` | 도구(플러그인 단위) | 한 플러그인의 광고 도구 중 `tool.never_called` 비율이 임계 이상이고 정의 토큰이 임계 이상 | 비율 ≥ 50%, 토큰 ≥ 500 / 턴, 창 30일, 광고 턴 ≥ 30 | 도구 목록(이름, 토큰), 광고된 턴 수, 창 | 빼기: 프로필에서 빼기. 고치기: 지연 노출로 돌리기 |
| `ask_always_denied` | 훅 | 훅이 물은 횟수 중 거부 비율이 높음 | 물음 ≥ 5, 거부 ≥ 90% | 물음 호출 목록(호출 id), 답 분포 | 올리기: 막기로 올리기(물음 제거, 막음) |
| `ask_always_allowed` | 훅 | 물은 횟수 중 허용 비율이 높음 | 물음 ≥ 10, 허용 ≥ 95% | 같음 | 고치기: 조건 좁히기. 빼기 |
| `hook_slow_faulty` | 훅 | `fault_rate`가 높거나 p95가 예산의 일정 비율 이상 | 실행 ≥ 50이고 (`fault_rate` ≥ 3% 또는 p95 ≥ 예산의 50%). 시간 초과는 따로 센다 | 분포, 실패 이유 분포, 가장 느린 호출 | 고치기 |
| `hook_never_reached` | 훅 | `hook.shadowed` 비율이 높음(앞 훅이 늘 먼저 끝냄) | 실행 ≥ 50, shadowed ≥ 95% | 가로막는 훅(`skippedBy`) | 고치기: 순서 바꾸기. 빼기 |
| `skill_activation_drop` | 스킬 | 같은 스킬의 `activation_rate`가 두 모델 구간 사이에서 크게 떨어짐 | 각 구간 목록에 실린 턴 ≥ 20, 절대 차 ≥ 20%p, 비 ≤ 0.5 | 두 구간 값, 모델 이름, 구간 경계, 교란 | 고치기: 설명 고치기 |
| `skill_never_read` | 스킬 | 목록에 실렸는데 읽히지 않음 | 목록 턴 ≥ 50, 읽힘 0, 창 30일 | 목록 턴 수, 색인 토큰 | 고치기: 설명 고치기. 빼기 |
| `cache_break_by_plugin` | 블록 | 한 플러그인에 귀속된 캐시 깨짐이 많음 | 30일 ≥ 10회 또는 그 플러그인 턴의 ≥ 20%. `unknown` 비율을 같이 표시 | 깨진 단계 목록, 원인 종류, `observed` 여부 | 고치기: 주입 위치 바꾸기 |
| `instruction_defied` | 지침 | `inst.defied` 비율이 높음 | 지침 실린 턴 ≥ 20, 비율 ≥ 30% | 그 턴들, 걸린 훅과 호출 | 올리기: Hook으로 올리기(이미 훅이 있으면 지침 고치기) |
| `instruction_truncated` | 지침 | 잘린 재료가 있는 턴 비율이 높음 | 비율 ≥ 10% | 잘린 재료, 생략 수 | 고치기: 지침 줄이기 |
| `repeat_after_block` | 훅 | 막은 뒤 `repeat`와 우회 의심의 합이 높음 | 막음 ≥ 10, 합 ≥ 40% | 막은 호출과 다음 호출 쌍, 분류, 신뢰 표시 | 고치기: 막은 사유 문구 고치기 |
| `drive_budget_exhausted` | Drive | 반납 사유 `budget` 비율이 높음 | Drive ≥ 5, 한도 소진 ≥ 30% | 한도, 사용량, 소진 단계 | 고치기: 한도 바꾸기, 단계 고치기 |

중요도 순서는 `impact`로 정한다: 토큰을 세는 규칙은 `tokens_per_turn`, 나머지는 영향받은 턴 수 또는 횟수. 단위가 다른 것끼리는 비교하지 않고 단위별로 묶어 보여 준다.

## 7. 실패와 경계 사례

| 사례 | 처리 |
|---|---|
| 턴 도중 프로세스가 죽음 | 규칙 5. 마지막 단계까지의 기록은 있고 그 단계는 없다. 턴은 `lost`다. 재개된 턴은 새 `turnId`가 아니면 같은 턴에 이어 쓰지 않고 `complete: false`로 둔다 [제안] |
| 계측 꺼짐 | `level: log_only`. 로그에서 파생되는 것만 보인다: 단계 구성, 캐시 경고, 사용량, 효과·승인·하위 에이전트·Drive 사건, 막힌 호출의 `details`. 훅 결과·시간·`ask`·재료·광고·스킬은 `null`이고 0으로 채우지 않는다. 지표는 `unavailable: measurement_off`. 테스트 실행 대화는 `testRunsAlwaysOn`이 참이면 예외다 |
| `measure.db`를 못 엶 | `level: none`, 기존 `measure.open_failed`와 같이 대화를 막지 않는다. `tr_thread`가 없어 테스트 실행 표지는 메모리로 폴백한다. 이 경우 지표도 없으므로 섞일 데이터가 없다 |
| 턴이 매우 큼(수백 호출) | 규칙 8의 상한. 넘은 수는 `elided`. `record_json` 상한을 넘으면 요약 + `complete: false`. 집계 카운터는 상한과 무관하게 센다 |
| 하위 에이전트 | 규칙 24. 자식 턴이 따로 기록되고 `parent`로 이어진다. 플러그인 지표는 `caller: any`가 기본이라 자식 호출도 센다. 자식이 부모보다 오래 돌아도(백그라운드) 자식 기록은 독립으로 완결된다. 사용자 중지는 백그라운드 자식도 멈추므로(엔진 설계 §2.4 [결정]) 그 자식의 턴 상태는 `interrupted`다. 부모 턴 요약의 `subagents`는 부모 턴 시점까지의 수다 |
| 되감기, 가지 | 기록은 가지와 무관하게 쌓이고 지표는 모든 가지를 센다(일어난 일이고 비용을 썼다). `turnRecord.list`는 `started_event_id`로 현재 가지 소속(`active` / `abandoned`)을 읽을 때 붙인다. `thread.leaf_moved`는 기록을 지우지 않는다. 가지로 만든 새 대화(`forked_from`)는 공통 접두 턴의 기록을 복사하지 않는다. 그래서 같은 턴이 두 번 세어지지 않는다 |
| 대화 삭제 | 규칙 9. 증거가 가리키던 대화가 없으면 발견의 증거 수가 줄고(`evidenceTotal`을 다시 센다) 돌려 보기는 `thread_deleted`로 센다 |
| 플러그인 삭제·이름 변경, 검토본 보관(5개)을 넘은 버전 | 기록에는 당시 문자열이 남는다(보관을 넘어 지워진 `versionId`는 해시만 남는다). 화면은 모르는 플러그인을 "(삭제됨)"으로 보인다. 훅 이름 정리(R21)가 훅 이름을 바꿔도 저장된 문자열은 바꾸지 않고 읽는 쪽이 별칭표로 푼다(`docs/xeon/review/m5/drive-isolation.md` §2.6의 같은 원칙) |
| 병렬 도구 호출 | 훅·호출의 `atMs`가 겹친다. 시간 분해는 구간 합집합이라 이중 계산이 없다 |
| 훅이 분리(detached)로 턴 뒤에 끝남 | 이미 쓴 단계 뒤에 도착한 행은 다음 쓰기 묶음에 `late: true`로 붙인다. `late`는 기록이 늦었다는 표시일 뿐이고, F가 요구하는 "이벤트 처리의 지연이 턴의 결과를 바꾸지 못한다"와 같은 말이다: 늦게 끝난 행은 이미 정착한 턴의 결과를 바꾸지 않는다 [구현: 턴을 닫을 때 `writeHooks`로 `tr_hook`에 한 번 쓴다. 턴 행이 쓰인 뒤에 끝난 실행은 쓰지 않는다(위 §8 남은 일)] |
| 두 기기·원격 | `measure.db`는 호스트마다 하나다. 원격 클라이언트는 wire로 읽고 기록은 동기화하지 않는다("이 기기의 턴 기록") |
| 시계가 뒤로 감 | 행은 `recorded_at`이 아니라 쓰는 순서(rowid)로 정렬한다. 일별 접기는 UTC 날짜 기준이라 영향이 작다 |
| 마이그레이션 실패 | 새 테이블만 만들지 못한다. 기존 `measure_raw` 쓰기는 계속하고 `level: none`으로 읽힌다 |

## 8. 지금 코드와의 차이

크기: S 반나절 이하, M 1~2일, L 3일 이상 [제안: 어림]. 줄 번호는 `cyP 워크트리`의 읽은 시점 기준이다.

| 위치 | 변경 | 크기 |
|---|---|---|
| `packages/contracts/src/extensions/trace-types.ts:64` (`TraceHandlerEntry`) | 선택 필드 `toolCallId`, `subject`, `decision`, `ask`, `source`를 더한다(스키마의 `additionalProperties: false` 때문에 `Type.Optional`로). 다섯 결과 이름(`:48`)은 그대로. [구현: `toolCallId`만, `:80`과 스키마 `:119`. 나머지는 다른 트랙. 2026-11-18: 턴 전 항목 표지 `pre`를 `TraceTurnEntry`에 더했다(스키마 항목 `pre`, 규칙 17의 2). 기록 쪽 `HookRun.preTurn`도 더했다] | S |
| `packages/ext-host/src/operations/trace-buffer.ts:56~210` | `TraceRecord`에 `toolCallId`(디스패치 키 접미), `plugin`, `versionId`, `subject`, `decision`, `ask`, `decisionText`, `seq` 추가. `MAX_*` 상수를 설정으로 연결 | M. [구현: `toolCallId`, `plugin`, `versionId`(null), `sourceKind`, `decision`, `ask`를 `dispatchOf`에서 싣는다. 출처와 결정은 디스패처(`dispatch.ts`의 `identityOf`, `noteOk`)와 외부 훅 실행기(`runner.ts`)가 낸다. 물음 대기는 `user-wait.ts`의 `WaitTally`가 센다. `subject`, `decisionText`, `seq`는 아직 없다. 2026-11-18: 턴 전 항목은 `waiting` 자리에 대화마다 8개까지 붙잡고, 다음 턴이 열리면 그 턴의 단계 0이 된다(`pre: true`, 규칙 17의 2). `boundary.turn.after`를 받은 턴은 닫히고, 그 뒤 턴 키가 없는 훅은 닫힌 턴에 붙지 않는다. 계측이 꺼져 있으면 붙이지 않는다. 시험은 `trace-buffer.test.ts`의 턴 전 항목 시험 일곱] |
| `packages/ext-host/src/primitives/user-wait.ts:7`, `dispatch-types.ts:130` | `awaitUser`가 대기 횟수와 시간을 실행 기록에 알린다 | S |
| `packages/ext-host/src/primitives/dispatch-types.ts:93` | `ChainOutcome`에 `contributions`(핸들러별 기여)를 더한다. 격리 뒤에는 엔진 쪽 합치기에서 채운다 | M |
| `packages/core-tools/src/pipeline.ts:511`, `:550`, `:1150`, `:149~188` | 호출마다 `CallRecord` 싱크에 판정, 훅 묶음, 정책·승인, 소요·결과 크기를 보낸다. `hookDenialDetails`에 시간 초과와 던짐을 가를 선택 필드 `fault`를 더한다 | M. [구현: 싱크는 F `extensions/tool-call-trace.ts`(`ToolCallTraceSink`), 줄 만들기는 `core-tools/src/call-trace.ts`, 판정은 거부를 낸 자리가 정한다. `fault` 필드는 더하지 않았다(`details.outcome`이 `threw`를 이미 구분한다). 훅 묶음은 `blockedBy`와 `CallRecord.hooks`로 옮겼다. 훅 행의 `toolCallId` 묶음은 `apps/host` 수집기가 한다. `hooks`에 든 훅 행은 `step.hooks`에도 그대로 남는다(§3.2의 '호출에 묶이지 않은 것'과 다르다, [미결 §11 16번]). 가벼운 길(`capability-guard.ts`의 `light`)의 줄은 아래 `capability-guard.ts` 행의 싱크가 낸다(이 행의 파이프라인 길과 따로 간다) [정정 2026-11-18: 이전에는 "줄을 남기지 않는다"고 적었으나 커밋 `e8da3a778`로 싱크가 생겼다]. [구현: 인자 토큰은 `argTokensOf`(`call-trace.ts`)가 원본 목록 `argTokens`로 싣고 `argTokenCount`에 어림 토큰 수를 둔다. 원본 목록은 호스트 기록기가 `maskedArgTokensOf`로 가린 뒤에만 저장한다(§5.1-②)]] |
| `packages/core-context/src/assemble.ts:230`, `:264~430`, `packages/contracts/src/services/`의 `AssembledContext` | `materials`, 광고 요약, 캐시 원인(도구·절 귀속 포함)을 낸다. `toolset-diff.ts`가 추가·제거 도구의 소유 플러그인을 알린다 | M. [구현: `AssembledContext.materials`(`assemble.ts`의 `materialsOf`)와 싱크 `ContextTraceSink`(`contracts/src/extensions/context-trace.ts`). 캐시 원인은 기록기가 `step.completed`의 경고와 사용량으로 정한다(`apps/host/.../turn-context.ts`의 `cacheBreakOf`). 기본 프롬프트의 소유는 `core`, 안내의 소유는 출처 핸들러 또는 `core`(§4.5 규칙 27)다. 스킬 색인과 기억 재료는 이 함수가 싣지 않고 `cap-knowledge`의 턴 기록 싱크가 알린다(아래 `prompt-block.ts` 행). `AssembleOptions.promptAdditionOwner`는 `before-start.ts`·`prepare-request.ts`가 넘긴다. 요청 본문은 같다(`context-trace.test.ts`)] |
| `packages/core-loop/src/loop/prepare-request.ts:95`, `:111`, `step-end.ts:266`, `provider-retry.ts:8` | 단계 끝에서 `StepRecord`를 수집기에 넘긴다. 재시도 알림 수와 대기 시간을 센다. `sections: {}`는 Inject가 들어오는 M5c에서 채운다 | M. [구현: `prepare-request.ts`가 `step_context`를, `step-end.ts`가 `skill_read`를 싱크로 넘긴다(`loop/context-trace.ts`). 재시도 알림은 아직 세지 않는다] |
| `xeon/packages/cap-knowledge/src/skills/prompt-block.ts:57`, `xeon/packages/cap-knowledge/src/turn-context.ts:86` | 색인의 `included`, `omitted`, 토큰을 수집기에 알린다(모델 입력은 그대로). 플러그인은 수집기를 직접 import하지 않으므로 `contracts`에 읽기 전용 싱크 포트(`TurnRecordSink`)를 정의하고 수집기(`ext-host`, `apps/host`)가 구현한다 | S. [구현: 싱크는 `contracts/src/extensions/turn-record-sink.ts`(`TurnRecordSink`, `TurnBlockEvent`), 포트는 `ports.ts`의 `TurnRecordPortKey`(`fresnel.turnRecord`)다. `turn-context.ts`의 `introduce`가 블록 사실(`listed`, `omitted`, 어림 토큰)을 만들고 `beforeAgentStart`가 턴마다 `report`로 알린다. 싱크가 던지면 `knowledge.turn_record_failed` 경고 하나를 남기고 메시지는 그대로다. 플러그인은 `plugin.ts`에서 `optionalPort`로 포트를 얻는다. 조립은 `apps/host/src/assemble.ts`가 `platform-turn-record` 등록으로 싱크를 올리고 `recorder.ts`의 `offerTurnRecord`로 수집기에 잇는다. 소유 이름은 `knowledge`다 [제안]. 시험: `turn-record-report.test.ts`(이름과 수와 토큰 정확 값, 싱크 실패, 알림이 메시지를 바꾸지 않음)] |
| `packages/ext-host/src/primitives/capability-guard.ts:215~260`(`light` 길) | 읽기 전용 플러그인 호출의 `tr_plugincall` 줄을 남긴다. | M. [구현: 가드는 턴 id를 모르므로 턴 없이 `PluginCallTraceSink`(`contracts/src/extensions/plugin-call-trace.ts`, 포트 `fresnel.pluginCallTrace`)로 대화 id, 호출한 플러그인, 기능, 메서드, 인자 해시, 성공 여부, 시간, 길, 도구 호출 id를 알리고 호스트 기록기가 그 대화의 열린 턴에 붙인다. 줄은 턴을 닫을 때 `tr_plugincall`과 `record_json.pluginCalls`에 쓴다. 열린 턴이 없거나 `log_only`면 버리고, 턴당 500줄을 넘는 줄은 버린다[제안]. `on` 핸들러 안의 읽기 전용 호출은 재실행 검사가 거절하므로 줄은 확장 메서드, drive 함수, 도구 `execute`에서만 나온다] |
| `apps/host/src/assembly/measure/store.ts:73`, `:172` | `user_version` 마이그레이션, `tr_*` 테이블, 접기를 `tr_daily`까지 넓힘, `forgetThread` [구현: `windowBundles`와 `planTurnFolds`가 `tr_step`, `tr_cache`, `tr_frame`을 같은 접기로 읽는다] | L |
| `apps/host/src/assembly/measure/recorder.ts:298~530` | 쓰는 때를 `step.completed`로 당김, 새 행 쓰기, `hook` 행 병행, 범위·프로필 표지 | L. [구현: 턴 행 `open`·최종, 단계 행과 `tr_hook`, `log_only`, 열 때 `markLostTurns`, 범위 `test`. 쓰기 로직은 `turn-writer.ts`와 `turn-rows.ts`. 늦은 행: 단계 끝 뒤에 끝난 실행을 턴을 닫을 때 `late: true`로 한 번 쓰고(`lateHooksOf`, `writeHooks`), 턴 훅(step 0)은 `turnHooks`에 든다. 승인 답은 호출 줄의 `approval`에서 잇는다. 요청 id 키의 입력 훅(`input.user.before`, `input.bash.before`)과 대화 시작 훅(`thread.start`)은 턴이 열릴 때 단계 0으로 붙는다(§4.2 규칙 17의 2, 2026-11-18). 남음: 턴 완료 커밋 뒤에 끝나는 실행(`boundary.turn.after`, `boundary.settle.after`)은 턴 행이 이미 정착한 뒤라 쓰지 않는다. 열린 턴 도중 들어와 다음 턴으로 가는 `followUp` 입력의 훅은 실행 중인 턴에 붙는다(§11 17). 프로필 표지와 덧씌우기는 남음. 프레임의 `used`와 `userMessages`는 `turn-writer.ts`의 `chargeFrames`·`queuedUserMessage`·`spawnCharge`가 센다(§4.4 규칙 23, 2026-11-18). 턴 플래그는 `turnFlagsOf`·`turnFlagBitsOf`(`turn-rows.ts`)가 닫을 때 세고 `tr_turn.flags` 비트로도 쓴다. `subagents`는 `agent.spawned`를 `turn-writer.ts`의 `rememberChild`가 턴에 붙여 센다. `untrackedWrite`는 계측이 없어 거짓, `draftActive`는 범위가 `overlay_draft`일 때 참이지만 그 범위를 아직 아무도 쓰지 않는다] |
| `packages/core-persistence/src/retention.ts:34`, `:123`, `threads.remove` 경로 | `onRemoved`가 측정 저장소 삭제를 부른다 | S. [구현: `service.ts:127`의 `removed`가 두 경로를 잇고 `SessionDeps.onThreadRemoved`(`deps.ts`)로 조립 루트가 `forgetThread`를 건다] |
| `apps/host/src/assembly/ports.ts:285`, `:319`, `:430`, `:686`, `profile-test-run-port.ts:94`, `packages/ext-host/src/primitives/host.ts:584` | 테스트 실행 표지를 `tr_thread`로 옮겨 재시작 뒤에도 유지 | M. [구현: `measure/test-run-marks.ts`가 `tr_thread`에 쓰고 되살린다. `host.ts:584`의 Set은 그대로다] |
| `packages/contracts/src/wire-settings/wire/` 새 파일들, `methods.ts:2414`(알림 표), `errors.ts:568~636` | §3.5의 메서드·알림·오류 3500대. [구현: 지난 턴에 돌려 보기 `backtest.*` 네 메서드, 알림 `backtest.progress`, 오류 3521~3525를 `wire/backtest.ts`와 `turn-record-methods.ts`에 등록했다. 처리기는 2026-11-18에 `apps/host/src/handlers/m5/backtest.ts`가 채웠고 알림은 `handlers/events.ts`가 보낸다] `TestRunMarker`(`profile-test-run.ts:268`) 필드 추가 | M |
| `apps/host/src/handlers/` 새 `m5/`, `apps/host/src/assembly/measure/read.ts` | 처리기와 읽기 포트, `metrics.query` 계산, 발견 계산 [구현: M5d-1 층 4. `block.*`(시간 나눔, 캐시), `drive.*`(프레임)를 `metrics.ts`에 더하고 행이 없으면 `not_recorded`다. 비교는 `pluginVersion`·`profileRev`를 원본 턴으로 나눈다(`compareByGroups`). 발견 규칙 8과 12를 더했다. `profileCost.get`의 정적 줄은 프로필 플러그인 이름만 낸다. 미구현: 지침·도구 정의 어림(로더 대기), 모델 대기(단계 시간이 행에 없음), 컴팩션 횟수(행에 없음, `not_recorded`)] | L | 층 5 [구현: `turnRecord.watch·unwatch`와 알림 `turnRecord.delta`(`handlers/m5/watch.ts`, 사건 버스 `turn-events.ts`), `absent`의 `purged`(`turn-read.ts`, 기록 시각 `tr_meta.recording_since`, `turn-log.ts`로 로그 확인), 크기 상한(`turn-fit.ts`), `testRunsAlwaysOn`(`turn-writer.ts` `levelOf`). 훅 행의 추적 버퍼는 계측 꺼짐에서 아직 비므로 테스트 실행의 훅 행은 `trace.enabled`가 꺼지면 빈다]
| 후보를 돌리는 실행기(ext-host와 플러그인 프로세스) | `backtest.*`. P1 이후에만 가능. 그 전에는 `3524`로 거절 [구현 2026-11-18: 후보 실행기는 `packages/ext-host/src/isolation/candidate-runner.ts`, 서비스는 `apps/host/src/assembly/backtest/service.ts`다. 격리 자식을 띄울 수 없으면 `3524`다(`assembly/backtest/isolation.ts`). 한계는 §11 22~29] | L |
| `packages/ext-host/src/operations/settings-keys.ts:216` | §3.6의 새 키 [구현: `x.operations.backtest.*` 네 키를 정의했다. 범위 값은 [제안]이고 이 키를 읽는 실행기는 아직 없다] | S |
| `apps/desktop/src/views/workbench/craft-source.ts:119`, `apps/desktop/src/views/craft/turn-flow.ts:229`, `apps/desktop/src/views/panels/context/context-model.ts:125` | M6의 일. 읽기를 `turnRecord.get`으로 옮기고 구성 표를 플러그인별로 낸다. 이 문서는 데이터만 | M(M6) |
| 문서 | `docs/xeon/X/operations/spec.md` §4.8.3 마지막 줄("메모리에만 둔다"에 `measure.db` 사본 사실 추가), `L4/host-service/spec.md` §4.20, `F/wire-settings/spec.md` §3.3 표 | S |

## 9. 수용 기준

번호 뒤는 근거 요구다.

1. (R12, 제약) 같은 대화 입력을 계측 켠 상태와 끈 상태로 돌려 모델 요청 본문(가림 뒤)이 바이트 단위로 같다. 수집기가 시스템 프롬프트, 도구 목록, 메시지를 바꾸지 않는다. [구현: M5d-1, `packages/core-loop/test/context-trace.test.ts`가 메시지, 도구 정의, 추론 옵션을 직렬화해 바이트로 비교한다. 싱크가 던져도 같다. 가림 장치를 켠 본문은 이 시험이 다루지 않는다]
2. (R12) 앱을 다시 열어도 지난 턴의 `turnRecord.get`이 훅 실행, 호출, 재료, 광고, 스킬을 돌려준다. 하나의 턴에서 `blocked_hook`과 `blocked_hook_fault`(시간 초과)가 서로 다른 `verdict` 값으로 저장된다. [부분 구현: 재료, 광고, 스킬, 캐시 행을 저장하고 `store.readTurn`으로 읽는 것을 시험한다(`turn-context-write.test.ts`). `turnRecord.get` 등록과 다시 연 뒤의 시험은 단계 M5에서 한다]
3. (R12) 도구 호출 앞뒤에서 돈 훅이 그 호출의 `toolCallId`와 함께 기록되고, 같은 턴에서 호출마다 훅 목록이 맞다.
4. (R12) 훅이 사람에게 물으면(`awaitUser`) `ask.waits ≥ 1`, `ask.answer`가 `approval.resolved`와 같고 `ms`는 사람 대기를 뺀 값이다. [부분 구현: `awaitUser` 횟수와 대기 시간, 결정 `ask`의 승인 id와 답은 `hook-identity.test.ts`와 `turn-record-write.test.ts`가 시험한다. `awaitUser` 길의 답은 아직 없다(null)]
5. (R12) 단계 도중 프로세스를 죽이면 마지막 완료 단계까지의 기록이 남고 턴은 `lost`로 읽힌다. 잃은 단계는 `recorded: false`다.
6. (R12) `trace.enabled`를 끄면 새 턴은 `level: log_only`이고 훅 값은 `null`이며 지표는 `measurement_off`다. 켜면 다음 턴부터 `full`이다.
7. (R12) 대화를 지우면 그 `thread_id`의 `tr_*` 행이 없어진다. `tr_daily`에 대화 id, 인자, 사유가 없다.
8. (R12) 턴당 상한을 넘는 합성 턴(훅 600, 호출 600)이 `elided` 수와 함께 저장되고 `record_json`이 `maxTurnBytes` 이하다. [구현 일부: M5d-1 층 5. `turn-fit.test.ts`가 줄이기 순서와 셈을 값으로 확인하고, 요약 뒤 단계 행이 남는 것을 `turn-record-write.test.ts`가 본다. 600개 합성 턴 자체는 시험하지 않는다]
9. (R12) 시크릿이 든 훅 사유와 인자가 저장된 행 어디에도 평문으로 없다.
10. (R19) 재료를 낸 플러그인이 둘인 턴에서 `PluginCost.always`가 각자 합과 `composition` 합(`injected` 포함)의 차이 안에서 맞는다. 귀속을 못 정한 훅 메시지는 `shared`로 표시된다. [구현 일부: `turn-context-write.test.ts`의 `the_skill_index_and_memory_blocks_...`가 두 소유자(`alpha` 재료, `knowledge` 블록)를 한 턴에 두고 `PluginCost.always`를 정확한 값으로 본다. `alpha`는 첫 단계의 재료 12와 광고 도구 10이 있으나 비용에는 마지막 단계 재료가 들지 않으므로 광고 도구 10만 든다. `knowledge`는 색인 201, 기억 90, 광고 도구 4다. `composition` 합과의 차이 검사와 `shared` 훅 메시지의 시험은 아직 두지 않았다. 기본 프롬프트(`core`)와 안내 소유자는 `materials.test.ts`, `context-trace.test.ts`(core-context, core-loop)가 본다]
11. (R19) 지연 도구를 `tool_search`로 활성화한 턴의 `Advertised.tools`가 `state: "activated"`이고 `PluginCost.onDemand`에 그 정의 토큰이 있다.
12. (R19) 도구를 추가한 프로필 전환 뒤 첫 단계에서 `tr_cache.kind = "toolset"`과 그 플러그인이 귀속된다. 같은 단계에 사용량이 깨짐을 안 보이면 `observed: false`다. [부분 구현: `cacheBreakOf`가 `tools_deferred` 경고의 추가·제거 도구가 한 플러그인에 속할 때만 그 플러그인을 쓰고, 사용량이 안 깨지면 `observed: false`로 쓴다(`turn-context.test.ts`와 `turn-context-write.test.ts`). 프로필 전환이 도구를 더하는 경로는 M5c 대기이고, 지금의 경고는 대화 중 도구 변경이 미뤄질 때만 난다]
13. (R19) `profileCost.get`이 턴이 없는 프로필에도 `basis: "estimated"`로 합계를 낸다. [부분 구현: 플러그인 줄은 프로필의 이름으로 만들고 칸은 null, `basis: "unknown"`이다. 지침과 도구 정의의 어림은 로더(M5c enC3)가 낼 때까지 null이다(`turn-read.test.ts`)]
14. (R18) `metrics.catalog`가 §5의 모든 지표를 `feasible` 구분과 함께 낸다. `metrics.query`가 `minSample` 미만을 `insufficient_sample`로 낸다.
15. (R18) 같은 합성 데이터에서 `inst.defied`가 §5.1-①의 정의대로 계산되고, 고장(`*_fault`) 판정은 분자에서 빠진다.
16. (R18) `hook.post_block`이 합성 시나리오 다섯(반복, 같은 대상 다시 쓰기, 다른 도구 같은 대상, 무관한 호출, 멈춤)을 각각의 분류로 낸다. `bash` 우회는 `rewrite_text`로만 분류된다. [구현: `turn-record-write.test.ts`의 "막힘 뒤 재시도" 시험이 같은 턴의 막힌 셸 호출과 재시도를 기록기→저장소→`metrics`로 지나게 한다. 토큰 다섯이 여섯 가운데 겹치는 재시도(0.833 ≥ 0.8)는 `rewrite_text`, 겹치지 않는 재시도는 `different_path`가 되어 `hook.post_block` 2, `rewrite_text` 0.5(분모 2), `different_path` 0.5를 낸다. 값이 `not_recorded`가 아니다. 나머지 분류(반복, 다시 쓰기, 다른 도구 같은 대상, 멈춤)는 `turn-read.test.ts`의 순수 분류 시험이 값으로 본다. 다섯 시나리오를 모두 기록기로 지나게 하는 시험은 남음]
17. (R18) 보관 기간을 넘긴 창에서 `skill.activation_rate`, `hook.outcomes`, `tool.never_called`가 `tr_daily`에서 같은 값(원본에서 계산한 값과 일치)으로 나온다. `hook.post_block`도 같다. [구현: 블록, 캐시, 주도 카운터도 같은 시험(`turn-read.test.ts`, 접은 뒤 `metrics.query` 값이 같다)으로 확인한다]
18. (R18) 모델이 바뀐 합성 데이터에서 `skill_activation_drop`이 발동하고, `minSample` 미만이면 발동하지 않는다. 발견마다 `next`가 하나 이상이다.
19. (R18) 발견의 증거 참조로 `turnRecord.get`이 해당 턴을 돌려주고, 묶음 크기가 16 KiB 이하이며 내용 문자열이 없다.
20. (R18) `dismiss`한 발견이 근거 값이 두 배 이상 바뀌면 다시 열린다.
21. (R16) 후보 Hook을 `backtest.run`으로 최근 N턴에 돌리면 실행된 도구가 하나도 없다(효과 이벤트가 늘지 않는다). 요청의 `replay: true` 아래에서 후보가 `capability()`를 부르면 `replay_mode_denied`이고 그 호출은 `candidate_fault`다. [구현 2026-11-18, 일부: 후보 실행기의 라우터가 `replay: true` 요청의 쓰기를 버리고 `capability()`를 `replay_mode_denied`로 거부한다(`packages/ext-host/test/isolation/candidate-runner.test.ts`, `engine-calls.test.ts`). 실제 엔진 시험 `apps/host/test/int/backtest-real.int.test.ts`는 돌려 보기 전후의 턴 기록, 대화 목록, 지표, 기록된 호출 수가 같음을 값으로 본다. 효과 이벤트 수는 세지 않는다. 후보가 쓰기를 시도하는 것은 플러그인 코드에서 볼 수 없다(§11 29)]
22. (R16) 합성 기록에서 후보가 실제로 실행된 호출을 막으면 `newly_caught`, 사람이 허용했던 호출이면 추가로 `would_block_allowed_by_human`이 된다. 후보가 던지면 `candidate_fault`이고 막음으로 세지 않는다. [구현 2026-11-18: `apps/host/test/assembly/backtest/classify.test.ts`의 "every class is reached by its rule of §4.8 rule 49"와 `service.test.ts`의 "the summary counts every class, the calls seen, the calls replayed, and the candidate faults"가 분류와 고장 셈을 본다. 실제 엔진 시험 `backtest-real.int.test.ts`는 `newly_caught` 호출과 `passes_same` 호출을 하나씩 낸다. 사람이 허용한 호출의 `would_block_allowed_by_human`은 실제 엔진 시험이 만들지 않는다]
23. (R16) 결과에 `notReproducible` 여섯 항목이 항상 있다. 지원하지 않는 훅은 `3522`다. [구현 2026-11-18: `apps/host/test/handlers/backtest.test.ts`의 "each backtest.run failure reaches the wire with its own code, kind and retryable flag"가 3521, 3522, 3524, 3525를 값으로 보고, 3523과 커서 오류는 같은 파일의 다음 시험들이 본다. 실제 엔진 시험 `backtest-real.int.test.ts`가 여섯 항목을 값으로 본다. 3522의 서비스 쪽은 `service.test.ts`의 "a candidate with no code (inject only) and a hook with no handler both answer hook_not_replayable"이다]
24. [구현 일부: M5d-1 층 5, 항상 켜기 `turn-record-write.test.ts`(켠 때와 끈 때)] (R16) 테스트 실행 대화를 만들고 앱을 다시 시작해도 그 대화의 `scope_kind`가 `test`이고 기본 지표에 들지 않는다. `overlay_draft` 턴도 같다.
25. (R16) 같은 입력으로 만든 테스트 실행 둘에서 `testRun.compare`가 `sameInput: true`와 `verdict`·훅 결과 수 비교를 낸다. 입력이 다르면 `false`다.
26. [미구현: 알림은 단계 행을 쓴 뒤에만 간다(M5d-1 층 5). 단계 끝 전의 `modified` 행은 아직 없다] (R23) 훅이 `tool.result`를 고친 호출에서 `turnRecord.delta`가 단계 끝 전에 `modified` 행을 보낸다. 닫은 뒤 다시 열어 `turnRecord.get`으로 같은 행을 읽는다. [구현 2026-11-18, 턴 전 훅: 턴이 열리기 전에 실행된 훅은 턴이 열릴 때 단계 0으로 붙고, 턴을 닫을 때 `turnHooks`에 `preTurn: true`로 쓰인다. 이 알림에는 싣지 않는다. 턴 훅은 단계 끝 전 알림으로 보내지 않는다는 점은 그대로다. 시험: `turn-record-write.test.ts`의 "hooks that ran before the turn are its step 0 hooks…"]
27. (R23) 계측이 꺼져 있어도 막힌 호출의 toolResult `details`만으로 막음 칩의 데이터가 있다.
28. (R23, R13) 하위 에이전트 자식 대화의 턴 기록이 `parent`와 부모와 같은 프로필 표지를 가진다.
29. 성능. 계측 켠 턴과 끈 턴의 디스패치·턴 시간 차이를 기존 `dispatch_overhead_trace_on_vs_off` 벤치(`docs/xeon/X/operations/spec.md` §4.8.5)와 같은 방식으로 재서 기록한다. 지금 기준값이 없으므로 이 문서도 수치를 정하지 않는다. 단계당 쓰기 묶음이 모델 호출 경로를 기다리게 하지 않는다(`measure` 기존 TX-09 규칙). [측정: 2026-11-18, loaded dev machine, 수치는 `docs/xeon/L4/host-service/spec.md` §4.20. 명세에 기준값이 없어 판정하지 않는다. 동기 구간은 단계당 p95 0.26 ms 이하, 연기된 쓰기는 단계당 p95 0.7~9.4 ms, 계측 켬과 끔의 턴 차이는 p50 2.0~22.4 ms다]. 뒤쪽 쓰기(연기된 쓰기)는 턴당 상위 5%(p95) 5 ms 이하 [제안, 사용자 확인 전]. [구현: 2026-11-18] 쓰기 묶음 하나가 트랜잭션 하나다(`MeasureStore.batch`, `recorder.ts` `flush`). 묶음 안의 쓰기는 저장점이고, 던진 작업은 `measure.op_failed`로 남긴 뒤 나머지를 계속 쓴다. 쓰기 문장은 저장소가 쥐고 다시 쓰며, WAL은 `synchronous = NORMAL`이다(`store.ts` `openMeasureStore`, 근거는 `L4/host-service/spec.md` §4.20). 측정(2026-11-18, 부하 있는 개발 기기, `just benchmark --turn-record`, 턴당 뒤쪽 쓰기 ms p50/p95): 바꾸기 전 1단계 1.65/11.3, 20단계·호출 10 19.5/27.0(부하 평균 170 안팎). 바꾼 뒤 1단계 1.19/7.5, 20단계·호출 10 15.6/21.9(부하 평균 6). 두 측정의 부하가 달라 직접 비교하지 않는다. 같은 프로세스에서 같은 쓰기를 번갈아 돌린 비교(20단계·호출 10)에서는 쓰기마다 따로 커밋하던 옛 방식 10.3/11.6, 묶은 뒤 같은 값 10.0/11.6이고, 묶기만 하고 임시 저장소를 기본값으로 두면 52.7/61.7이었다(저장점 비용). 곧 묶기와 준비된 문장 재사용의 이득은 크지 않고 짧은 턴의 중앙값과 꼬리에서만 보인다. 상위 5% 5 ms 이하 [제안]은 어떤 시나리오에서도 충족하지 못한다. 남은 비용은 커밋마다의 WAL 쓰기와 자동 체크포인트, 무작위 키 보조 색인(WAL 프레임 751 대 320)이고, 체크포인트를 커밋 밖으로 옮겨 봤으나 효과가 작아 되돌렸다. 색인을 줄이는 일과 턴당 한 번 커밋(단계 행이 턴 끝에 보임)은 사용자 결정이다
30. (R12) 훅이 `{ ask: true }`를 낸 호출에서 `HookRun.decision = "ask"`, `ask.via = "decision"`이고 사람이 허용하면 `verdict = allowed`, 거부하면 `denied_human`이다. 사람이 없는 실행이면 `denied_noninteractive`다. `awaitUser`로 직접 기다린 핸들러는 `ask.via = "awaitUser"`로 기록된다. [구현: 결정 `ask`와 승인 잇기는 `turn-record-write.test.ts`의 승인 잇기 시험이 시험한다]
31. (R12) `tool.call.before`의 `replace`는 `verdict = replaced_hook`이고 `effectId`가 없다. `agent.spawn.before`의 막음은 `blocked_spawn`, `ask.human.before`의 취소는 `cancelled_ask`다. 새 훅 행에는 `subject.approvalId` 또는 `subject.spawnRequestId`가 있다.
32. (R12) 플러그인 코드가 부른 파일 쓰기 호출이 `CallRecord`(`caller = "plugin"`, `callerPlugin`, `via`)로 남고, 읽기 전용 호출은 `pluginCalls` 한 줄로 남는다. 중첩 호출이 승인을 물려받으면 `approval.inheritedFrom`이 채워진다. `untracked_write`는 `flags.untrackedWrite`로 읽힌다.
33. (R23) 프레임 표지의 `exitReason`이 저장된 `lease.released.reason` 값과 같다(사용자 중지는 `revoked`). 한도 도달을 `used`와 `limits`로 설명할 수 있다. [구현 2026-11-18: `exitReason`은 저장된 `lease.released.reason`을 그대로 싣는다. `used`와 `userMessages`는 §4.4 규칙 23의 사건으로 센다(엔진 `charge`와 같은 범위). `lowerResumedWith`는 null이다(§11 19). 시험: `turn-record-write.test.ts`의 "the frame's used counts and user messages follow the durable events…"가 닫은 뒤와 다시 연 뒤의 값을 비교한다]
34. (R12) 플러그인 프로세스의 표준오류가 `pluginStderr`에 길이 상한과 시크릿 마스킹을 거쳐 남고, 프로세스가 죽은 훅은 `reason = process_exit` 또는 `process_killed`다.
35. (R16) 한 턴 안에서 프로필 개정이 바뀌면 `profileRevChanges`에 바뀐 단계가 남는다. `TurnRecord.profile.source`에 `project_default`는 없다.
36. (R16) 테스트 대화(`craftChat`)의 턴이 `scope = craft`로 기록되고 지표 기본 필터에서 빠진다. 계측이 꺼져 있어도 표지는 내구로 남는다.
    [구현 상태, 2026-11-18] 대화를 만들 때 `tr_thread`에 `scope_kind = craft` 표지를 쓴다(`assembly/measure/test-run-marks.ts`의 `remember(…, "craft")`, `assembly/ports.ts`의 `threads.create`). 턴 기록기는 그 표지를 저장소에서 읽으므로 재시작 뒤에도 같은 범위다. 기본 지표 범위는 `live`와 `overlay_reviewed`뿐이라 `craft`와 `test`는 기본에서 빠진다(`turn-read.ts` `DEFAULT_SCOPES`). 계측이 꺼졌을 때 craft 턴을 항상 적는 일(`testRunsAlwaysOn`과 같은 규칙)은 하지 않았다. 시험: `test/assembly/measure/turn-record-write.test.ts`(재시작), `turn-read.test.ts`(기본 필터와 `scopes: ["craft"]`).
37. (R16) 테스트 실행 대화의 `TurnRecord.testRun`이 기준 프로필과 초안 버전 id를 싣고 `overlay`는 null이다. `thread.create { testRun: true }`로 만든 대화는 표지에 기준 프로필이 없으므로 턴이 돈 프로필이 기준이다 [제안, 구현: enB5].
38. (R23) `TurnRecord.children`이 자식 대화 목록을 싣고 `turnRecord.search`가 여러 대화에 걸쳐 플러그인이 일한 턴을 찾는다.
39. (R17, R18) `findings.bundle`이 16 KiB 이하로 id·해시·숫자만 낸다. `turnRecord.mark`는 Inject만 하는 플러그인에만 받고 대화 로그에 새 기록을 더하지 않는다.

## 10. 다른 스펙과 맞이르는 곳

| 상대 | 받는 것 | 주는 것 |
|---|---|---|
| Drive·격리(E1~E3, P1~P2) | 프레임 스택(`lease.acquired`의 `parent`, `depth`, `contentHash`)과 반납 사유 값(저장된 `lease.released.reason`). `tool`·`model` 명령이 호출·모델 호출 기록에 들어오는 길(`model`은 role `drive`). 후보를 돌릴 플러그인 프로세스와 요청 플래그 `replay: true`(기능 호출 거부, 쓰기 버림: 엔진 설계 §3.2). 플러그인 프로세스의 표준오류와 종료 실패 이유(`docs/xeon/review/m5/drive-isolation.md` §3.2·§3.6). 주도 명령 결과의 내구 기록은 [결정: 2026-11-17 사용자, U1] | `backtest.*`가 후보 실행을 요청하는 계약. 프레임을 턴 기록에 옮기는 모양 `FrameMark` |
| 프로필·프로젝트·로더(M5c) | 프로필 id·개정, 대화의 프로필 출처(`thread`, `builtin`), 버전 정체 `versionId`, Inject 재료의 `when`과 소유 선언(M5c §4.5.10), `mcp.<서버>`의 소유 플러그인, `profile.applied.overlay`(덧씌우기 표지), 사용자가 부른 스킬·명령 표지(`turn.started.invoked`) | `profileCost.get`, 프로필 단위 지표, 프로필 변경이 비용에 주는 영향(R19) |
| Hook 정리(R21) | 새 훅 이름, 블록 앞뒤 훅, 사람에게 묻기·서브에이전트의 앞뒤 새 훅(`docs/xeon/decisions/ADR-0023-plugin-profile-core.md` §3.4), 결정값 `block`/`ask`/`replace`, 합치기 규칙 H-2([결정: 2026-11-17 사용자, U3]), 변환표 F §4.5, 호출 주체 `plugin:<이름>`과 호출의 `via` | 저장된 훅 이름 문자열 불변 원칙, 별칭표를 읽는 쪽 규칙, 기록된 결과값의 정의(§3.2). 새 훅이 생기면 `HookRun`이 같은 모양으로 받는다 |
| Craft 화면(M6d, M6e: `docs/xeon/review/m6/craft-flows.md`) | 화면 요구(턴 기록, 지표, 살펴볼 것, 테스트 화면의 그 자리 관찰) | 이 문서의 wire 전부. `findings.list`의 `next`, `EvidenceRef`, 근거 묶음(§4.7 규칙 43) |
| 테스트 대화(R17, `docs/xeon/review/m6/craft-flows.md`) | 근거 묶음을 맥락으로 받는 쪽의 규칙 | 근거 참조와 `turnRecord.get`/`backtest.run(scope.turns)` |
| `L4.host-service` | `measure.db` 소유와 `measure.*` wire | §3.1의 확장과 마이그레이션 |
| `X.operations` | `trace.*` 설정과 링 버퍼 | §3.6의 새 키, 링 버퍼를 단계 끝마다 비우는 규칙 [제안: 링 버퍼는 단계 끝 이후에도 `trace.turn` 호환을 위해 지금처럼 유지한다] |

## 11. 미결 (제안 기본값 포함)

| # | 질문 | 제안 기본값 |
|---|---|---|
| 1 | 저장 위치 C(`measure.db` 확장)를 확정할지. 요구 문서는 대화 로그·투영 테이블을 묻고 있다 | C. 이유와 대안은 §3.1 |
| 2 | 계측이 꺼진 동안의 Test run을 기록할지(`testRunsAlwaysOn`) | 기록한다 |
| 3 | 막은 뒤 행동 분류의 앞으로 보기 길이와 `rewrite_text` 겹침 임계 | 2단계, 0.8 |
| 4 | `tool.result`와 `input.*` 훅을 지난 턴에 돌려 보기에 넣을지 | `tool.result`는 근사로 넣고 `input.*`는 뺀다. 사용자 원문 저장 시점 확인 뒤 재검토 |
| 5 | 훅이 고친 전후를 옵트인으로 저장할지(`storeRequestBody` 같은 설정) | 저장하지 않는다. 크기만 |
| 7 | 지침과 훅에 같은 `ruleId`를 선언하게 할지(지표 ①을 정확하게) | Later. M5c의 매니페스트에 `ruleId` 필드가 없으므로 지금은 만들지 않고 플러그인 단위 근사를 쓴다 |
| 8 | `overlay_reviewed` 턴을 플러그인 지표에 넣을지 | 넣고 프로필 비용에서는 뺀다 |
| 9 | 발견 임계값(§6) 확정 | 표의 값. 사용자 데이터를 한 달 쌓은 뒤 조정 |
| 10 | 후보 훅의 네트워크 부작용을 막을 수 없다는 고지(격리 3단계 전) | 처음 한 번 알림 대신 검토함 카드의 고정 안내(`m5-plan.md` R27 [권고: 메인 세션, 확인 대기])로 일원화한다 |
| 11 | `hook` 행 병행 기록을 언제 끝낼지 | 데스크톱이 `turnRecord.*`로 옮긴 뒤 |
| 12 | 쓰는 때 `step.completed` 뒤의 비원자성(한 단계 손실)을 받아들일지 | 받아들인다. 로그에 사실이 남아 있으므로 `log_only`로 복원 가능 |
| 14 | `measure.db` 마이그레이션 방식(`user_version`) | 위 제안대로 |
| 15 | 저장 실패와 내부 오류로 닫힌 도구 호출의 판정. 열네 판정 가운데 맞는 값이 없다 [근거: `packages/core-tools/src/pipeline.ts`의 `prepareCall`·`commitIntent`의 저장 실패 닫기] | 줄을 남기지 않는다. 새 판정 값을 더할지 사용자 확인 |
| 16 | `CallRecord.hooks`에 붙인 훅 행을 `StepRecord.hooks`에서 빼서 §3.2 주석(도구 호출에 묶이지 않은 것)과 맞출지 | 지금은 둘 다에 둔다(기존 `step.hooks` 값을 바꾸지 않으려고). 사용자 확인 뒤 뺀다 [근거: `apps/host/src/assembly/measure/turn-rows.ts`의 `stepRecordOf`] |
| 17 | 실행 중인 턴이 있을 때 들어온 `followUp` 입력의 `input.user.before`를 실행 중인 턴과 다음 턴 가운데 어디에 붙일지(§4.2 규칙 17의 2) | 실행 중인 턴에 붙는다. 정확히 하려면 `input.user.before` 디스패치가 큐 결정(`claimUserInput`, `enqueue`) 뒤에 나오거나 결정을 실어야 한다 [근거: `packages/core-loop/src/service.ts`의 `input.user.before` 디스패치가 큐 결정보다 앞선다] |
| 18 | 임대가 받은 사용자 메시지(`claimUserInput`의 받은 편지함)는 사건이 없어 `userMessages`에서 빠진다(§4.4 규칙 23 (d)) | 지금은 `input.queued`(출처 사용자)만 센다. 임대가 메시지를 받았다는 사건을 E3에서 더할지 정한다 [근거: `packages/ext-host/src/primitives/lease.ts`의 `claimUserInput`] |
| 19 | `lowerResumedWith`(`handoff_done`, `handoff_aborted`, `user`)의 원천 사건 | 없다. null로 둔다. 맡기기 사건이 `last` 값을 싣게 되면 옮긴다. `lease.released`는 사유만 싣는다 [근거: `packages/contracts/src/records/catalog/extension-ops.ts`의 `LeaseReleasedPayloadSchema`] |
| 20 | 한도 토큰을 총 토큰(`totalTokens`, 캐시 토큰 포함)으로 셀지, 입력과 출력만 셀지(초기 제안은 입력과 출력) | 총 토큰. 엔진 `tokensOf`가 `totalTokens`를 더하므로 입력과 출력만 세면 캐시 적중 때 엔진 카운터보다 작게 보인다. 턴 밖 모델 호출(제목 등)도 열린 프레임 동안이면 센다. 엔진은 drive 명령과 `models.complete`의 토큰만 더하므로 이 부분은 근사다 |
| 21 | 뒤쪽 쓰기 예산(턴당 p95 5 ms 이하, §9 29번)을 확정할지. 측정값은 §4.20 측정 줄과 §9 29번에 있고 지금 판정하지 않는다 | 제안 값으로 둔다. 사용자 확인 전까지 예산 위반을 실패로 보지 않는다 |
| 22 | 되감기 표지(`turn_rewound`)를 내지 않는다. `TurnRecord`에 되감기 표지가 없어 `BacktestItem.live.laterSignals`에는 `approval_denied`만 들어간다 | 되감기 표지를 턴 기록에 더할지 정한다 [근거: `apps/host/src/assembly/backtest/service.ts`의 `liveOf`] |
| 23 | `hints`가 `CallRecord`에 없어 후보에 싣지 않는다 | `CallRecord`에 힌트를 더할지 정한다 [근거: `apps/host/src/assembly/backtest/payload.ts`의 `toolCallPayloadOf`] |
| 24 | 하위 에이전트 호출의 `caller` 이름이 기록에 없어 후보에는 `"subagent"`로 준다 | 기록에 하위 에이전트 이름을 더할지 정한다 [근거: `apps/host/src/assembly/backtest/service.ts`의 `replayEntry`, `callerIdOf(call) ?? "subagent"`] |
| 25 | 후보의 설정 값은 `{}`다. 돌려 보기는 후보가 읽는 설정 값을 넘기지 않는다 | 현재 설정 값을 넘길지 정한다 [근거: `service.ts`의 `start`, `runner.open`의 `settings: {}`] |
| 26 | 후보의 상태는 선언된 초기 상태다. 실제로 커밋된 상태는 읽지 않는다 | 커밋된 상태를 넘길지 정한다. 넘기면 §4.8 규칙 53의 재현 불가 목록과 맞춘다 [근거: `packages/ext-host/src/isolation/candidate-runner.ts`의 `CandidateHandler.initialState` 주석] |
| 27 | `tool.result` 돌려 보기는 저장된 결과 항목이 있어야 한다. 없으면 `result_not_stored`로 센다 | 결과 항목의 저장 범위를 정한다 [근거: `service.ts`의 `replayEntry`] |
| 28 | 돌려 보기 결과는 프로세스 메모리에만 있다. `tr_backtest_run`, `tr_backtest_item` 표가 없어 재시작하면 사라진다 | §3.7의 [제안]대로 둔다. 저장이 필요하면 사용자 확인 뒤 표를 더한다 |
| 29 | 후보가 받은 `replay: true` 요청 플래그는 플러그인 코드에서 볼 수 없다. 쓰기가 버려지는 사실은 값으로 직접 보이지 않고, 실제 엔진 시험의 전후 비교로만 간접으로 본다 | 쓰기 시도를 결과로 드러내는 시험 방법을 정한다 |

가정(이 문서가 다른 스펙이 낼 값이라고 가정한 것): `versionId`, Inject 재료의 `when`·소유 선언(M5c §4.5.10이 낸다), `mcp.<서버>` 소유 플러그인, 사용자가 부른 스킬·명령 표지, `lease.acquired`의 `parent`·`depth`·`contentHash`, 플러그인 프로세스와 `replay` 플래그. 전부 이 문서의 외부 의존이고 없는 동안 해당 필드는 `null`로 기록된다.

## 12. 요구 추적표

| 요구 | 절 | 비고 |
|---|---|---|
| R12 턴 기록 저장, 블록별 내용, 훅 결과 구분 | §3.1, §3.2, §3.4, §4.1~§4.4, §7, AC 1~9 | 막음과 시간 초과는 `verdict`와 `reason`으로 구분 |
| R12 플러그인 호출(가벼운 길 포함), 호출 주체, 승인 상속, 표준오류, 훅의 결정값(ask·replace) | §3.2 `HookRun`, `CallRecord`, `PluginCallLine`, `pluginStderr`, §4.2 규칙 12~17, §4.3 규칙 18·22, AC 30~34 | 훅 결과 값의 파생 표시는 F §4.5 |
| R12 컨텍스트 조립(재료, 스킬, 도구 광고) | §3.2 `Material`, `Advertised`, §4.5 | 재료 귀속의 일부는 로더에 의존 |
| R12 모델 호출(모델, 토큰, 캐시, 재시도) | §3.2 `ModelCall`, §4.1 | 재시도는 알림 수 집계가 새로 필요 |
| R12 도구 실행, 사람에게 묻기, 서브에이전트, 턴 종료 훅, 프레임 스택, 프로필·덧씌우기·초안 표지 | §3.2, §4.3, §4.4, §4.6 | 턴 종료 훅의 "계속" 결정은 `continues` |
| R19 플러그인별 비용, 프로필 합계, 캐시 깨짐 귀속 | §3.3, §4.5, §5 `cost.*`, §5.1-⑤, `profileCost.get` | 훅이 통째로 다시 쓴 메시지는 `shared` |
| R18 지표 | §5, §4.7 | 어려운 다섯은 §5.1 |
| R18 살펴볼 것과 다음 걸음 | §6, §4.7 규칙 41~43 | |
| R16 지난 턴에 돌려 보기 | §4.8, §3.7, `backtest.*` | 모델 반응은 재현 불가(규칙 53) |
| R16 테스트 실행 기록과 지표 제외, 초안 버전 비교 | §4.6, `testRun.compare`, `tr_thread` | 그 자리 관찰 화면은 M6d |
| R16, R17 테스트 대화의 `craft` 범위, 테스트 실행의 `testRun`, 자식 목록, `turnRecord.search`·`findings.bundle`·`turnRecord.mark` | §3.2, §3.8, §4.6 규칙 36, 수용 36~39 | M6 요청 M5d-1·3~7 |
| R16 그 자리 관찰의 데이터 | §3.5 `turnRecord.watch`, `turnRecord.delta`, §4.9 | |
| R23 데이터(조용한 고침, 프레임 스택, 흔적에서 이동) | §4.9 | 고친 내용의 차이는 저장하지 않음 |
| craft-flow §3.2 | §4.6, §4.8, §3.5 | |
| craft-flow §3.5 | §4.9 | |
| craft-flow §3.6 | §6, §4.7 규칙 43 | |

배치하지 못했거나 불완전한 것:

- "지침을 따랐나"의 판정(`docs/xeon/review/m5-plan.md` §7 열린 것): 기록만으로 불가능하다. 훅이 걸린 경우(`inst.defied`)만 신호가 있다. Inject만 하는 초안의 시험은 "실렸나, 읽혔나"까지만 기록이 있고 "따랐나"는 없다.
- 고친 내용이 무엇이었나(전후 차이): 저장하지 않는다(미결 5).
- "되돌렸나": 대화 되감기와 물음 거부만. 파일 되돌림은 신호가 없다.
- 훅이 사람에게 물을 수 있는 정식 결정 모양: 지금 훅 결정은 `block`뿐이다(`packages/contracts/src/extensions/hooks/tool.ts:84`). 사람 대기는 핸들러 안의 `awaitUser`뿐이다. Hook 정리(R21)가 "물음" 결과를 정하면 `ask`의 원천이 달라질 수 있다.
