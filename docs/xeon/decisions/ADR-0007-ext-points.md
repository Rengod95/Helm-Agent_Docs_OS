---
id: adr.0007
layer: adr
domain: extension-points
kind: adr
status: accepted
depends_on: [adr.0002, adr.0006]
binds: [xeon/packages/ext-host/**, xeon/packages/contracts/src/extensions/**, xeon/packages/group-kit/**]
---

# ADR-0007 확장 지점: on, post, drive, scope 네 연산

## 1. 상태와 날짜

- 상태: accepted
- 날짜: 2026-10-21
- [결정] 확장 지점은 `on`(fold `tap`/`first`/`chain`), `post`, `drive`(배타 임대), `scope` 네 연산이다(`_research/decisions-log.md` 2026-10-21 "계획 v2").
- [결정] Hermes식 학습 정책은 L3 학습 그룹이고 `drive`를 쓰지 않으며 Helm과 함께 켤 수 있다(같은 기록).
- 사용자가 확인한 범위는 연산 4개와 fold 3종까지다. 확장 지점 목록과 Helm 내부 설계는 "층 구성 계획 보완·합의 뒤 착수"로 남아 있다(`_research/decisions-log.md` 2026-10-21 결정(2차) 끝 문장). 그래서 이 ADR의 지점 종류 수(5개), 지점 이름 목록, 지점별 fold 배정은 [제안]이다.
- 개정: 2026-10-21 `review.decisions-2` U-01(§3.1·§3.6 켜기·끄기와 임대 교대 시점을 단계 경계로 읽음), U-06(§3.3 `tool_call` 인자 변경 미지원), U-12(§3.5 drive 상한 기본값을 pi 방식의 예외로 인정, 기본값은 설정 화면에서 조정). 결정을 뒤집지 않고 해석과 미결을 정한 보충이라 같은 ADR 안에서 고쳤다(`adr.readme` §1.4). 세 항목은 사용자 확인을 거친 [결정]이다(2026-10-22).

## 2. 맥락

- 사용자 의중: Helm 같은 의도(탐구, 새 관점, 모르는 분야 지식을 현재 작업에 적용)를 스킬이나 일반 플러그인으로 두면 모델에 강제력이 없다. 그래서 코드 수준에서 루프를 제어하고, 제2의 Helm 같은 사상도 루프에 붙였다 뗐다 할 수 있어야 한다(`_research/decisions-log.md` 2026-10-21 "사용자 의중").
- 사용자 지시: X-b 지점은 pi처럼 단순하게 재설계한다(`_research/decisions-log.md` 2026-10-21 결정(2차)).
- v1 안은 "강제 수준 5단계(관찰·차단·형성·주입·구동) + 지점 계약 5필드(강제 수준, 이벤트 모드, 실패 정책, 재생 규칙, 예산)"였다(`_research/layer-plan-v2-notes.md` "확장 지점: 원시 연산 네 개", `_research/ext-points.md` 목적 문단).
- pi의 실제 형태(`_research/ext-points.md §0`, `§1.2`, `§1.4`):
  - 이벤트는 41종이다(`EXT/types.ts:1377-1409`). 결과를 돌려받는 지점은 약 19개이고 나머지 약 22개는 관찰 전용이다.
  - 합성 규칙이 `runner.ts`의 `emit*` 메서드 14개에 흩어져 있다. 관찰 지점은 fail-open, `tool_call`은 fail-closed다.
  - 확장이 루프의 소유자가 되는 "구동" 연산이 없다. 가장 가까운 경로는 `turn_end`/`agent_before_settle`의 `continue:true` 1회 요청과 명령 핸들러 안의 `waitForIdle()` + `sendUserMessage()`다.
- pi durable은 훅 7개의 합성·실패 규칙을 표 한 장으로 선언한다(durable `docs/spec.md:2636-2660`). 훅은 커밋 전에 실행되고 크래시 뒤 다시 실행될 수 있으므로 "재실행 가능한 질의"라는 계약을 따른다(`spec.md:2640-2646`). 재생 때 `beforeTool`을 다시 실행하지 않는 규칙도 있다(`spec.md:3136-3170`, 3162-3163).
- Cordis는 디스패치 5모드(`emit`, `parallel`, `serial`, `bail`, `waterfall`)를 가지며 모드를 호출하는 쪽이 고른다(`_research/ext-points.md §4.3`). 배타 임대와 큐 모드는 없다(`_research/notes/arch-1.md §2` "없는 모드" 행). DI는 Cordis 하나다(ADR-0002 `./ADR-0002-di-cordis.md`).

## 3. 결정

### 3.1 원시 연산 네 개

[결정] 확장(L3 그룹 포함)이 루프에 개입하는 연산은 아래 넷뿐이다(`_research/layer-plan-v2-notes.md` "확장 지점: 원시 연산 네 개", `_research/ext-points.md §5` 안 1).

| 연산 | v1 단계 | 뜻 |
|---|---|---|
| `on(point, fn)` | 1 관찰, 2 차단, 3 형성 | 지점이 선언한 fold로 합성된다. fold가 `tap`이면 관찰, `first`면 차단, `chain`이면 형성이다 |
| `post(item, {when, requestId})` | 4 주입 | 입력 큐에 넣는다. `when`은 `steer`, `followUp`, `next` 중 하나다. 같은 `requestId`의 입력은 한 번만 들어간다 |
| `drive(fn)` | 5 구동 | 배타 임대다. 그룹당 한 슬롯이다. 호스트가 경계마다 마지막으로 커밋된 상태로 `fn`을 다시 호출한다. 효과는 `loop.turn`, `loop.spawn`, `post`로만 낸다. 상한은 `{maxTurns, maxSpawns, maxTokens}`다 |
| `scope(id, {state})` | (그룹) | 위 등록을 한 단위로 묶는다. 단계 경계에서 켜고 끈다(§3.6). 상태 레코드와 정리 동작을 함께 둔다 |

`post`의 `when` 세 값의 뜻은 다음과 같다(`_research/ext-points.md §5` 안 1 2번).

| `when` | 들어가는 시점 | pi 대응 |
|---|---|---|
| `steer` | 다음 도구 라운드 뒤 입력으로 들어간다 | `deliverAs: "steer"` |
| `followUp` | 에이전트 정착 뒤 입력으로 들어간다 | `deliverAs: "followUp"` |
| `next` | 경계 뒤 정확히 한 요청에 들어간다. 이 항목이 그 요청을 스스로 시작하는지, 다음 사용자 입력이 시작하는 요청에 붙기만 하는지는 [미결](§6) | `deliverAs: "nextTurn"`, 경계 지점의 `continue` |

### 3.2 fold 세 종류

[결정] 합성 방식은 확장이 고르지 않는다. 지점을 선언할 때 fold를 정한다(`_research/layer-plan-v2-notes.md` 같은 절).

| fold | 합성 | 핸들러 실패 시 | Cordis 구현 [제안] |
|---|---|---|---|
| `tap` | 모든 핸들러가 받는다. 반환값은 쓰지 않는다 | 기록하고 계속한다 | `parallel` 또는 `emit`을 핸들러별 try/catch로 감싼다. `emit`은 리스너 오류를 격리하지 않기 때문이다(`_research/notes/arch-1.md §2` emit 행) |
| `first` | 첫 결정이 이긴다 | 거부로 처리한다(fail-closed) | 동기 핸들러는 `bail`, 비동기는 `serial`. 래퍼는 지점 선언의 결정 스키마에 맞는 객체(예: `tool_call`의 `ToolCallDecision`)만 결정으로 본다. `bail`은 `0`, `''`, `NaN`도 결정으로 취급하기 때문이다(`arch-1.md §2` bail 판정 규칙 행) |
| `chain` | 앞 핸들러의 결과를 뒤 핸들러가 이어받는다 | 그 핸들러만 건너뛴다 | `waterfall`. `next` 호출 횟수 검사는 래퍼가 맡는다(`arch-1.md §5`) |

### 3.3 지점 종류

[제안] 지점은 `input`, `request`, `tool`, `boundary`, `session` 다섯 종류로 나눈다. 지점 이름은 pi 이벤트명을 따른다(`_research/layer-plan-v2-notes.md` 같은 절). 사용자가 확인한 범위는 연산 4개와 fold 3종까지이고, 종류 수와 이름은 합의 전이다(§1). `_research/decisions-log.md`의 "확장 지점 목록(5)"은 남은 결정 목록의 5번 항목을 뜻하고 종류 수가 아니다.

[제안] pi에서 결과를 돌려받는 이벤트(`_research/ext-points.md §1.2`)를 아래처럼 배정한다. 사용자 합의 전이므로 목록과 fold는 `X.primitives.spec`과 `F.extensions.spec`에서 확정한다. 아래 표는 `F.extensions.spec` §3.4(`../F/extensions/spec.md`) 지점 선언 표의 배정을 옮긴 것이고, 둘이 다르면 F 표가 정본이다.

| 종류 | 지점(pi 이벤트명) | fold [제안] |
|---|---|---|
| `input` | `input` | `chain`(transform) |
| `input` | `user_bash` | `first` |
| `input` | `before_agent_start` | `chain` |
| `request` | `context`, `context_with_system`, `cache_warming_decision`, `before_provider_request`, `before_provider_headers` | `chain` |
| `tool` | `tool_call` | `first`(`ToolCallDecision`). 허용·거부·결과 대체만 하고 인자 변경은 지원하지 않는다 [결정: review.decisions-2 U-06] |
| `tool` | `tool_result` | `chain` |
| `boundary` | `message_end` | `chain` |
| `boundary` | `turn_end`, `agent_before_settle` | `chain`(엔트리 추가 + 계속) [미결] |
| `session` | `project_trust` | `first` |
| `session` | `resources_discover` | `chain` |
| `session` | `session_before_switch`, `session_before_fork`, `session_before_compact`, `session_before_tree` | `first`(`cancel`) |

- 관찰 전용 이벤트 약 22개는 모두 `tap` 지점이다.
- [결정] 지점 선언(이름, fold, 페이로드 타입)은 F4(`xeon/packages/contracts/src/extensions`)에 둔다. L1과 X는 그 선언을 공유한다(`_research/foundation-plan.md §3` "층 순위와 의존 방향").

### 3.4 리소스 등록은 별도

[결정] 도구, 명령, provider 등록은 확장 지점에 넣지 않는다. 리소스 등록으로 따로 다루고 pi API(`registerTool`, `registerCommand`, `registerProvider` 등)를 따른다(`_research/layer-plan-v2-notes.md` 같은 절, `_research/ext-points.md §1.3`).

### 3.5 v1 계약 필드의 처리

[결정] v1 계약 필드 다섯 개 중 네 개는 연산과 fold에서 읽히는 규칙이 된다(`_research/layer-plan-v2-notes.md` 같은 절).

| v1 필드 | 처리 |
|---|---|
| 강제 수준 | 연산 이름과 fold에서 읽힌다 |
| 이벤트 모드 | 지점 선언의 fold가 된다. 큐는 `post`, 배타는 `drive`다 |
| 실패 정책 | 세 줄 규칙이다. `tap`은 기록 후 계속, `first`는 거부, `chain`은 그 핸들러만 건너뜀 |
| 재생 규칙 | 계약 하나다. "`on` 핸들러는 다시 실행해도 되는 질의다" |
| 예산 | `drive` 임대 상한 `{maxTurns, maxSpawns, maxTokens}`로만 남는다. 일반 대화 턴에는 기본 단계·비용 상한을 두지 않는다(pi 방식, `_research/decisions-log.md` "계획 v2"). drive 임대에는 기본 상한을 두고 pi 방식의 예외로 인정한다. 상한을 명시하지 않은 임대의 일반 기본값은 X 설정 `x.primitives.driveDefaultLimits`, Helm 덮어쓰기는 `l3.helm.driveLimits`이고 둘 다 기본 `{ maxTurns: 4, maxSpawns: 8, maxTokens: 400000 }`이다. 사용자는 설정 화면에서 조정한다. drive는 사용자 입력 없이 턴을 만들어 상한이 없으면 끝나지 않기 때문이다 [결정: review.decisions-2 U-12] |

### 3.6 임대와 켜고 끄기

- [결정] `drive` 임대는 한 번에 그룹 하나만 가진다. `on`, `post`, 백그라운드 위임은 여러 그룹이 함께 쓴다(`_research/layer-plan-v2-notes.md` "층 사이 규칙" 4번). 학습 그룹은 검토 포크를 L1-g 백그라운드 위임으로 돌리므로 Helm이 임대를 쥐고 있어도 함께 켤 수 있다("질문에 대한 답" Hermes 학습 루프 항목).
- [결정] 켜기와 끄기는 경계에서 적용되고, 정리는 Cordis dispose로 실행된다("층 사이 규칙" 5번. 원문 표기는 "턴 경계").
- [결정: review.decisions-2 U-01] 위 원문의 "턴 경계"는 단계 경계(step 종료 직후, 도구 결과 커밋 뒤)로 읽는다. 턴은 여러 단계로 이어질 수 있어 턴 끝까지 기다리면 긴 턴에서 토글이 늦게 적용된다. 단계 경계는 커밋된 상태만 보이는 가장 이른 안전 지점이고 턴 경계는 그 부분집합이다. 실행 중인 턴이 없으면 바로 적용한다(`X.primitives.spec` §4.5.5).
- [결정: review.decisions-2 U-01] drive 임대 교대도 단계 경계에서 적용한다. 반납은 단계 경계에서 기록하고, 진행 중인 `loop.turn()`은 끊지 않고 정착까지 진행한다(`X.primitives.spec` §4.5.3). 임대가 반납되면 루프 소유는 기본 소유자(사용자 입력)로 돌아간다. 디스패치는 시작 시 핸들러 목록을 스냅샷하므로 한 디스패치 도중 집합이 바뀌지 않는다(`_research/ext-points.md §5` 안 1 "재생·토글 보장", pi `runner.ts:269-271`).
- [제안] `drive` 함수는 마지막으로 커밋된 `scope` 상태로 다시 호출되어도 같은 진행을 내야 한다. 상태는 `scope`의 상태 레코드에만 두고 클로저 지역 변수에 두지 않는다. `loop.turn`의 결과는 엔트리로 커밋되고 `requestId`를 scope id와 턴 번호에서 파생해 중복 실행을 막는다(`_research/ext-points.md §5` 안 1, 안 3의 `drive` 규율).

### 3.7 인터페이스 초안

[제안] 이 절은 위 결정을 타입으로 옮긴 개념 스케치다. 이름과 모양은 `F.extensions.spec` §3.2~§3.3(`../F/extensions/spec.md`)이 정본이고, 연산 구현은 `X.primitives.spec`이 정한다. 아래는 F 시그니처의 발췌다.

```ts
// F.extensions.spec §3.2·§3.3 발췌
export type Fold = "tap" | "first" | "chain";
export type PointKind = "input" | "request" | "tool" | "boundary" | "session";
export type PostWhen = "steer" | "followUp" | "next";

export interface HandlerContext<S> {
  readonly scopeId: ScopeId;
  readonly state: Readonly<S>;        // 디스패치 시작 시점에 마지막으로 커밋된 scope 상태
  readonly threadId: ThreadId;
  readonly signal: AbortSignal;
}

/** fold에 따라 시그니처가 좁혀진다. tap: (payload, ctx) → void, first: (payload, ctx) → D | undefined,
 *  chain: (payload, current, ctx) → X | undefined. 모두 Promise 반환 허용 */
export type Handler<N extends PointName, S = unknown> = /* PointSignatures[N]의 fold로 분기 */;

/** tool_call(first)의 결정. 거부값 FIRST_DENY.tool_call = { block: true, reason: "extension handler failed", terminate: false } */
export interface ToolCallDecision { readonly block: true; readonly reason: string; readonly terminate?: boolean }

export interface PostOptions { readonly when: PostWhen; readonly requestId: string }   // requestId 1~64자
export interface PostReceipt { readonly requestId: string; readonly duplicate: boolean }

export interface DriveLimits { readonly maxTurns?: number; readonly maxSpawns?: number; readonly maxTokens?: number }
export interface LeaseBudget { readonly turns: number | null; readonly spawns: number | null; readonly tokens: number | null }

export interface LoopHandle {
  turn(input: TurnInput): Promise<TurnOutcome>;
  spawn(spec: SpawnSpec): Promise<SpawnOutcome>;
  readonly budget: LeaseBudget;       // 남은 예산. null은 상한 없음
  readonly signal: AbortSignal;       // 임대 회수 시 중단
}
export type DriveFn<S> = (loop: LoopHandle, state: Readonly<S>) => Promise<void>;

export interface ExtensionOps<S> {
  on<N extends PointName>(point: N, handler: Handler<N, S>): Unsubscribe;
  post(item: PostItem, options: PostOptions): Promise<PostReceipt>;
  drive(fn: DriveFn<S>, options?: { readonly limits?: DriveLimits }): void;
}

export interface ScopeDef<S> { readonly state?: StateDecl<S>; readonly defaultEnabled?: boolean }
export interface ScopeApi<S> extends ExtensionOps<S> {
  readonly id: ScopeId;
  state(): Readonly<S>;
  commit(next: S): Promise<Readonly<S>>;
  record(kind: RecordKind, subject: RecordSubject, payload: JsonValue): Promise<void>;
  onDispose(fn: () => void | Promise<void>): void;
  // readRecords, capability는 F 문서를 본다
}
export type ScopeFn = <S>(id: ScopeId, def: ScopeDef<S>, setup: (g: ScopeApi<S>) => void | Promise<void>) => ScopeHandle;
```

- `PointName`, `PointSignatures`, `TurnInput`, `TurnOutcome`, `SpawnSpec`, `SpawnOutcome`, `PostItem`, `ScopeId`, `StateDecl<S>`, `ScopeHandle`은 `F.extensions.spec` §3.2~§3.3이 정한다.
- `first` 지점의 결정 타입은 지점마다 F가 정한다(예: `tool_call`의 `ToolCallDecision`, `session_before_*`의 cancel 결정). 래퍼는 결정 스키마에 맞지 않는 truthy 값을 결정으로 보지 않는다(§3.2).
- `requestId`는 필수다. pi `sendMessage`/`sendUserMessage`를 `post`의 별칭으로 올리는 어댑터는 메시지 내용과 호출 순번에서 `requestId`를 파생한다.

### 3.8 Helm이 쓰는 모양

[제안] 개념 스케치다. 시그니처는 `F.extensions.spec` §3.2~§3.5(`../F/extensions/spec.md`)를 따르고, 다르면 F가 정본이다. `_research/layer-plan-v2-notes.md` "Helm이 보이는 모양(의사코드)"를 줄여 옮긴다. 원문의 `request`, `tool.before`, `turn.end`는 pi 이벤트명(`before_agent_start`, `tool_call`, `turn_end`)으로 바꿔 적었다. 내부 설계는 `L3.helm.spec`이 정한다.

```ts
const helm = scope("helm", { state: { schema: HelmStateSchema, initial: initialHelmState, version: 1 } }, (g) => {
  g.on("before_agent_start", (r, cur, ctx) => lensPatch(cur, ctx.state.phase));       // chain: 패치 반환
  g.on("tool_call", (c, ctx) => (ctx.state.phase === "diverge" && isWrite(c)
    ? { block: true, reason: "탐구 단계는 읽기 전용" } : undefined));                   // first: ToolCallDecision
  g.on("turn_end", (t) => { void g.record(SIGNAL_KIND, subjectOf(t), signal(t)); return undefined; }); // 패치 없음
  g.drive(async (loop, st) => { while (st.phase !== "done" && (loop.budget.turns ?? 1) > 0) { // 배타 임대
    const views = await Promise.all(lenses(st).map((l) => loop.spawn({ agent: "explorer", task: l })));
    st = await g.commit(reduce(st, views));
    await loop.turn({ input: applyPrompt(st) }); } });
});
helm.disable(); // ScopeHandle. 다음 단계 경계에서 임대 반납
```

## 4. 결과

### 4.1 좋은 점

- pi 확장 대부분을 거의 수정 없이 올릴 가능성이 높다. `pi.on`은 이름이 같은 `on`으로, `sendMessage`는 `post`로 대응한다. [가정] 실제로 올려 보지 않았고, pi 예제 80개 중 호환 비율은 추정이다(`_research/ext-points.md §5` 안 1 pi 호환, `§7`).
- 합성 규칙이 지점 선언 표 한 장에 모인다. pi `runner.ts`의 `emit*` 14개가 fold 3종으로 수렴한다(durable `spec.md:2636-2660`과 같은 형태).
- Helm과 학습 그룹이 공존한다. 임대는 Helm 하나가 쥐고 학습 그룹은 `on`과 백그라운드 위임만 쓴다.
- 새로 배울 개념이 `post`, `drive`, `scope` 세 단어다(`_research/ext-points.md §6` 표).

### 4.2 감수할 점

- `drive`가 async 함수이므로 재생 규율(상태를 `scope` 레코드에만 둔다) 위반을 타입으로 막지 못한다(`_research/ext-points.md §5` 안 1 단점, `_research/layer-plan-v2-notes.md` 남는 쟁점).
- `boundary` 지점의 "엔트리 추가 + 계속" 합성(pi `emitBoundary`)이 `chain` 하나로 표현되는지 검증하지 않았다(`_research/ext-points.md §5` 안 1 단점, `§6.1` 1번).
- `first`의 실패 처리를 거부로 고정하면 pi `tool_call`·`user_bash`의 fail-closed와 일치하지만, pi `session_before_compact`는 현재 fail-open이다(`_research/ext-points.md §6.1` 2번).
- `drive` 상한은 협조적인 코드에만 유효하다. 프로세스 격리 없이는 비협조적인 확장을 강제로 멈출 수 없다(durable `spec.md:5109-5123` 비목표, `_research/ext-points.md §6.1` 3번). 격리는 2차 선택 기능이다(ADR-0006 `./ADR-0006-process-service-mode.md` §4.2).
- `drive`, `post(next)`, `agent_before_settle`의 `continue`가 겹친다. 가벼운 연장은 `post`, 루프 소유는 `drive`라는 구분을 문서로 둔다(`_research/ext-points.md §5` 안 1 단점).
- Cordis 일반 `emit`은 전역으로 전달된다. 그룹이 같은 이벤트 이름을 쓰면 모든 그룹이 받는다(`_research/notes/arch-1.md §3`).

## 5. 대안

### 5.1 줄인 모델 3안

`_research/ext-points.md §5`의 세 안을 비교한다.

| 안 | 원시 연산 | 핵심 | 판정 |
|---|---|---|---|
| 안 1 `on`/`post`/`drive`/`scope` | 4 | 지점 타입에 fold를 두고 동사 넷으로 개입 | 채택. 안 3의 `drive` 규율(경계마다 커밋된 상태로 재호출, 효과는 `loop.turn`/`loop.spawn`/`post`로만)을 결합 |
| 안 2 `wrap(joint, (arg, next) => result)` | 4(실질 2: `wrap`, `tap`) | 이음매를 Koa형 양파로 감싼다 | 탈락. `next` 누락·중복 호출이 루프를 멈추거나 이중 실행하게 만든다. 재생과 경계 토글 보장이 가장 약하다 |
| 안 3 `decide` + `Command` + reducer | 5 | 핸들러는 결정 데이터만 반환하고 구동은 Command를 내는 순수 reducer | 탈락(규율만 차용). 보장은 가장 강하지만 pi와 가장 멀다. 명령형 pi 확장을 그대로 올릴 수 없다 |

`_research/ext-points.md §6` 비교표 요약:

| 기준 | 안 1 | 안 2 | 안 3 |
|---|---|---|---|
| 원시 연산 수 | 4 | 4(실질 2) | 5 |
| 새로 배울 개념 | post, drive, scope | next 규율 | Command, reducer, 이벤트 유니온 |
| v1 5필드 처리 | 4개 소멸, 예산만 drive에 | 4개 소멸, 재생은 규율 | 5개 소멸, 타입 검사 |
| 구동 통제 | 임대 + 상한 | 코드 자유도 큼 | 데이터, 감사 최강 |
| 경계 토글 | 호스트가 경계에서 적용 | `next` 사이 확인 규율 | 구조적 보장 |
| 재생 | async drive 규율 | wrap 규율(가장 약함) | 순수 reducer + requestId(가장 강함) |
| pi 호환 | 높음(on 1:1) | 중간(tool 쌍 접기) | 낮음~중간 |
| "pi처럼 단순" | 가장 가까움 | 개념은 가장 작음 | 가장 멂 |

### 5.2 기타 대안

| 대안 | 판정 | 이유 |
|---|---|---|
| v1 강제 수준 5단계 + 지점 계약 5필드 유지 | 탈락 | 5필드 중 4개는 지점 선언에서 유도되므로 확장 작성자가 쓸 필요가 없다(`_research/ext-points.md §0` 1번). 사용자가 pi처럼 단순한 재설계를 지시했다 |
| pi 이벤트 41종을 합성 규칙 선언 없이 그대로 사용 | 탈락 | 규칙이 `emit*` 14개 메서드에 흩어지고 지점이 늘 때마다 메서드가 늘어난다. 구동과 확장별 켜고 끄기가 없다(`_research/ext-points.md §1.5` 약점) |
| OpenAI Agents SDK식 가드레일(입출력 판정 분리) | 보류 | 이 런타임의 사용자는 본인이라 필요가 약하다. 필요하면 `first` 지점에 붙는 선택 플러그인으로 만든다(`_research/layer-plan-v2-notes.md` "질문에 대한 답" 가드레일 항목, `_research/decisions-log.md` "계획 v2" 가드레일 보류) |

## 6. 미결 사항

- [미결] fold를 3종으로 충분히 줄일 수 있는지. pi `emitBoundary`(entries 병합 + continue)와 `resources_discover`(누적)를 `chain`과 `tap`의 변종으로 흡수할 수 있는지 검토가 필요하다(`_research/ext-points.md §6.1` 1번).
- [미결] `first`의 실패를 거부로 고정할 때 pi `session_before_compact`(현재 fail-open) 같은 지점별 예외 표가 필요한지(`_research/ext-points.md §6.1` 2번).
- [미결] 비협조적인 확장 코드의 강제 종료는 프로세스 경계 없이 불가능하다. `drive` 상한이 협조적 코드에만 유효하다는 한계를 받아들일지, 그룹별 격리 선택지를 1차에 둘지(`_research/ext-points.md §6.1` 3번).
- [미결] 지점 종류 5개(`input`, `request`, `tool`, `boundary`, `session`), 지점 이름 목록, 지점별 fold 배정(§3.3). 사용자 합의 전이다(`_research/decisions-log.md` 2차).
- [미결] `post.when = next`가 경계 뒤 요청을 스스로 시작하는지, 다음 사용자 입력이 시작하는 요청에 붙기만 하는지(§3.1). §3.1 표의 pi 대응 가운데 경계 지점의 `continue`는 요청을 시작하는 쪽으로 읽힌다. pi `nextTurn`의 정확한 동작은 확인하지 않았다 [가정]. `product.usecases.spec` UC-1의 수용 기준은 이 결정 뒤에 확정한다.
- [결정: review.decisions-2 U-06] `tool_call`의 인자 변경(pi는 `event.input` 제자리 수정)은 지원하지 않는다. 인자를 바꾸면 의도 커밋과 실행 인자가 달라져 재생 판정이 복잡해진다. 필요하면 2차에 별도 chain 지점을 더한다.
- [결정: review.decisions-2 U-12] `drive` 임대 상한 기본값은 §3.5 예산 행이다. 설정 노출은 `L4.settings-ui.spec` "플러그인과 그룹" 탭의 drive 임대 상한 항목이다(`_research/layer-plan-v2-notes.md` "L4 설정 화면 구성안").
- [미결] 그룹 사이 이벤트 격리 정책. Cordis 일반 `emit`은 전역 전달이므로 그룹 접두사나 필터를 기본으로 둘지(`_research/notes/arch-1.md §8`).
- [가정] pi 확장 대부분이 거의 수정 없이 올라온다. 실제 이식은 검증하지 않았다(`_research/ext-points.md §7`).
