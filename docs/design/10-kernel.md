# 10. 커널

- 소유: P6 커널
- 상태: 2a단계 통합판 (2026-10-12). 조정자 판정(`process/rulings-stage2a.md`)과 08·09 정렬을 반영했다. 그 전: 1단계 초안 2판 (2026-10-11). 1판을 쓴 뒤 08·09·06·12·13·14·15·16·19의 초안을 읽고 이름과 타입을 맞췄다. 이벤트 이름은 09 카탈로그(§3.4)를 따르고, 카탈로그에 없는 것은 §5.2에서 09에 요구한다. 1판 이름을 참조한 문서를 위해 §3.4.6과 §3.11.1에 이전 이름 대응표를 둔다.
- 패키지: `@helm/kernel` (`packages/kernel/`). 커널을 감싸 트랜잭션을 실행하는 `@helm/engine`은 06 §3.4.6
- 함께 읽을 문서: [11 묻기와 자율성](11-asking-and-autonomy.md), [08 도메인 모델](08-domain-model.md), [09 이벤트 저장소](09-event-store.md), [06 시스템 아키텍처](06-system-architecture.md), [12 런타임 엔진](12-runtime-engine.md), [13 도구와 실행](13-tools-and-execution.md), [14 루프·모드·오케스트레이션](14-loops-modes-orchestration.md), [15 탐구 엔진](15-inquiry-engine.md)

## 1. 목적과 범위

### 1.1 목적

커널은 Helm의 상태를 바꾸는 판정을 하는 유일한 코드다. 모델, 사람, 런타임, 스케줄러, 외부 어댑터, 보조 에이전트는 모두 타입이 정해진 **제출**(명령 envelope)을 넣을 수 있을 뿐이고, 커널이 규칙을 적용해 받아들인 것만 이벤트가 되어 기준 원본(이벤트 로그)에 들어간다. 브리프 결정 14("모델은 제안하고, 커널이 상태를 바꾼다")를 코드 구조로 옮긴 것이 이 패키지다.

구현자가 이 문서와 08만 보고 `@helm/kernel`을 만들 수 있게 다음을 정한다.

- 단일 변경 경로와 경로 위 각 단계의 책임
- 커널 순수성 계약(입출력, 결정성, 시각과 ID)
- 제출 envelope, 결과 형식, 거부 세 갈래와 거부 코드
- 명령 카탈로그 전체(이름, 입력 타입, 필요한 능력, 검증 규칙, 만드는 이벤트, 거부 코드)
- 검증 규칙 목록, 의존 규칙 1~5, 판단 승격 규칙, 쓰기 시점 참조 제약의 집행
- A(능력표)와 P(정책)의 판별, 정책 평가, 범위 안의 정책 적용
- 결정 주체 분류
- 공리 A1~A15 전체 대응, 불변조건(v0.3 1~7과 원전 불변조건)의 집행 지점
- 불변조건 속성 테스트와 가짜 모델 재생 테스트의 경계
- 벤더 중립 커널 인터페이스

### 1.2 다루는 것

| 범위 | 절 |
|---|---|
| 순수 함수 `decide`, `apply`, `react`와 조회 함수 | §3.1 |
| 단일 변경 경로 | §3.2 |
| 제출 envelope, 채널, 행위자 | §3.3 |
| 결과 형식, 거부 세 갈래, 코드 | §3.4 |
| 커널이 읽는 상태 | §3.5 |
| A/P, 능력표, 정책, 권한 레이어 입력, 범위 검사, 권한 이어 쓰기 | §3.6 |
| 검증 규칙 목록 | §3.7 |
| 의존 규칙 1~5 | §3.8 |
| 판단 승격 규칙 | §3.9 |
| 쓰기 시점 참조 제약 | §3.10 |
| 명령 카탈로그 | §3.11 |
| 커널이 집행하는 상태 전이 | §3.12 |
| 커밋과 함께 일어나는 파생 규칙 | §3.13 |
| 결정 주체 분류 | §3.14 |
| 공리 A1~A15 대응 | §3.15 |
| 불변조건 집행 지점 | §3.16 |
| 테스트 설계 | §3.17 |
| 벤더 중립 커널 인터페이스 | §3.18 |

### 1.3 다루지 않는 것

| 다루지 않는 것 | 소유 |
|---|---|
| 질문 레코드의 생애, 게이트 판정, 전달 방식, 가정 만료, 중재자, 혼자 정한 결정의 확인·이의 흐름 | [11](11-asking-and-autonomy.md) (같은 P6. 커널은 11의 규칙을 집행한다) |
| 레코드 스키마, 레코드 상태 기계, 쓰기 시점 제약 R-01~R-55의 정의, ID 접두사, 행위자 문법, 품질 상태 구조, 낡음 전파 함수 | 08 |
| 이벤트 envelope, 이벤트 이름 최종 카탈로그, SQLite DDL, 해시 체인, 멱등 inbox, 투영 테이블 | 09 |
| 트랜잭션 실행, 멱등 키 조회, 커밋 뒤 지시 전달(`@helm/engine`) | 06 §3.4.6, 09 |
| 에이전트 루프, 컨텍스트(투영) 생성과 A11의 생성 쪽 집행, 크래시 복구, 스케줄러 실행 | 12 |
| 도구 정의, 원시 행동과 도구 대응, 자원 표현, bash 우회 방지 구현, 권한 레이어(effect class·가역성·권리 대상 판별), 런타임 어댑터 | 13, 18 |
| 루프 계약 데이터, 모드, 다이얼 정본, 루프 전환 계기, 상황 판정 절차, 진입 규칙, 주의 예산 | 14 |
| 탐구 네 종류의 실행, 발산, 선호 모델 갱신 규칙, 자극 선택 | 15 |
| 지표 수집과 반증 측정 | 16 |
| 프로토콜 메서드 이름과 오류 코드 번호 | 19 |

브리프 결정 2에 따라 커널은 effect class와 가역성을 판별하지 않는다. 권한 레이어가 판별한 결과를 입력으로 받아 기록과 질문에 연결한다(§3.6.5).

### 1.4 표기

- `[결정]`은 브리프 §2 결정 번호를 근거로 적을 수 있는 것만 붙이고 번호를 함께 적는다. `[제안]`은 설계자가 정한 것, `[가정]`은 확인되지 않은 전제다.
- 외부 사실에는 `[원문]`, `[실험]`, `[검색]`, `[지식]`을 붙인다.
- "제출"은 커널에 들어오는 명령 envelope 하나, "이벤트"는 커널이 받아들여 만든 기록, "거부"는 받아들이지 않은 결과다.
- 레코드·필드 이름은 08을 따른다. "판단"은 Finding(`fd`)만 가리킨다. 해석(`in`)과 가능성(`ps`)을 묶어 "추측"이라고 부른다.
- 명령 이름은 `<대상>.<동사>`(현재형)이며 이 문서가 소유한다. 이벤트 이름은 `<대상>.<과거형 동사>`이며 08 §3.20.1·§3.22의 이름을 쓴다. 최종 카탈로그는 09가 정한다.

## 2. 전제와 결정

### 2.1 브리프 결정과 이 문서의 귀결

| 브리프 결정 | 이 문서에서의 귀결 |
|---|---|
| 2 effect class·가역성은 Helm 범위 밖 | 커널은 권한 레이어 판정(`PermissionVerdict`, 08 §3.18)을 입력으로만 받는다. 커널 안에 R0~R4 표가 없다 (§3.6.5) [결정] |
| 4 능력 = 원시 행동 6 + 기록 능력 5 | 능력표(A)는 08 §3.3.4의 데이터를 쓰고, 명령마다 필요한 기록 능력과 제안 종류를 정한다 (§3.6.2) [결정] |
| 5 루프 조합·전환 자유, 커널은 의존 규칙만 | 커널은 루프 순서를 강제하지 않는다. 루프 전환 명령은 의존 규칙과 상태 일치만 검사한다 (§3.8) [결정] |
| 8 혼자 정한 결정 기록·이의 (불변조건 7) | 자율 결정은 08 `Autonomy`(autonomous, whyNotAsked)가 없으면 거부된다. 이의(`objection.filed`)는 자율 결정 레코드 전부에 열려 있다 (§3.11.5, 11) [결정] |
| 12 묻기 재설계 | 질문 레코드와 전달 결정의 규칙은 11이 정하고 커널이 집행한다. 다이얼 수치는 [제안] [결정: 구조] |
| 14 모델은 제안, 커널이 상태 변경. 결정 주체 분류 원칙 | 단일 변경 경로(§3.2)와 결정 주체 분류(§3.14). 분류 표의 각 행은 [제안] [결정: 원칙] |
| 15 의존 규칙 (1)~(3) [결정], (4)·(5) [제안] | §3.8. 08의 R-05, R-34, R-13, R-33·R-34, R-35와 같은 규칙이다 |
| 17 불변조건 1~7은 모드·다이얼과 무관 | 다이얼과 정책 데이터는 §3.16의 검사를 끌 수 없다. 규칙 데이터 적재 때 검사한다 (§3.6.4) [결정] |
| 18 대안 2~3개 고르기 거부, 반응 기록 | 원함 탐구(I.want)에서 "하나 고르기" 질문을 거부한다 (11 V-Q-03, 08 R-23) [결정] |
| 22 클라이언트 없이 작업 계속 | 커널은 사람의 접속 여부를 컨텍스트로 받을 뿐 결정을 미루지 않는다 (11 §3.8) [결정] |
| 23·28 자체 런타임, pi-agent-core 훅에 커널 검사 연결 | 런타임은 `beforeToolCall`에서 `toolcall.intend`, `afterToolCall`에서 `toolcall.complete`를 제출한다 (§3.18) [결정] |
| 29 기준 원본은 Helm 이벤트 로그 | 커널은 이벤트만 만든다. 상태는 이벤트를 접어서 얻는다 (§3.1) [결정] |
| 30 크래시 복구: 의도 → 실행 → 결과 | 도구 실행은 `toolcall.started`(실행 의도)가 커밋된 뒤에만 일어난다 (§3.11.7) [결정] |
| 34 벤더 중립 어댑터 인터페이스를 지금 정의 | 커널 입력은 런타임과 무관한 형식이다. 런타임 능력에 따라 보장 수준을 낮추고 기록한다 (§3.18) [결정] |
| 36 TypeScript strict, ESM, Node 22, Vitest, TypeBox | 스키마는 08의 `typebox` 스키마를 컴파일한 검사기로 검증한다. 속성 테스트는 Vitest + fast-check [제안] |

### 2.2 이 문서의 주요 [제안]

1. 커널은 세 순수 함수 `decide`, `apply`, `react`로 이루어진다. 결정(명령 → 이벤트)과 적용(이벤트 → 상태)을 나누는 decider 구조다 [지식]. 시계·난수를 쓰지 않는다. 시각은 `KernelContext.now`, 새 ID는 `KernelContext.newId`(06 §3.4.4)로만 받고, `@helm/engine`은 같은 제출을 다시 결정하면 같은 ID가 나오는 파생 구현을 넣는다(§3.1.3).
2. 결과 상태는 다섯 가지다: `accepted`, `rejected`, `needs_gate`, `conflict`, `error`. `needs_gate`는 사람이 답하면 풀리는 거부이며, 같은 결정 안에서 질문 레코드를 만든다.
3. 거부는 세 갈래(`content` 내용, `authority` 자격, `path` 경로, 08 §3.23)로 분류하고, 판정 순서를 고정해 같은 제출이 언제나 같은 갈래가 되게 한다. 범위 밖 쓰기는 자격 갈래로 둔다. 08 §3.23은 내용 갈래를 제안했으며, 이 차이와 이유는 §3.4.1에 적는다.
4. 거부도 이벤트로 남긴다(`command.rejected`, 08 §3.23과 같은 이름). 도구 호출의 차단은 08 ToolCall 상태 기계대로 `toolcall.requested` + `toolcall.blocked`로 남긴다. 거부 기록은 관찰 레코드가 아니어서 판단의 근거로 쓸 수 없다(§3.4.5).
5. 낙관적 동시성은 전역 cursor가 아니라 대상 레코드의 `revisionSeq`(08 `RecordMeta.revisionSeq` = 사람 판단에 영향을 주는 변경을 마지막으로 한 이벤트 seq)와 사람이 본 화면의 `basisSeq`로 검사한다. Helm은 사람이 없을 때도 작업이 계속되어 전역 cursor가 계속 움직이므로 전역 비교는 사람의 답을 거의 항상 충돌시킨다(§3.3.4).
6. 근거 참조에서 없는 관찰 ID는 거부하고(지어낸 근거), 관찰이 아닌 서술만 있으면 거부하지 않고 강등한다(해석 → 전제, 완료 기준 → `unverified`). 대화 X3-2-11과 감사 §3.6의 "거부와 강등의 구분", 08 R-07·R-17과 같다.
7. 사람의 결정 명령은 사람 클라이언트 채널로만 받는다. 모델·런타임 채널로 들어온 사람 명령은 자격 거부(`denied.channel`)다(L21, 18 §5.2의 요구).
8. 커밋 뒤 실행할 일은 `Directive`(06의 이름 제안을 채택)로 돌려준다. 1판의 `KernelEffect`는 effect class와 단어가 겹쳐 바꿨다(06 §3.4.6, 감사 §5.5).

### 2.3 원천 대비 바뀐 점

| 원천 | 원천의 내용 | 이 문서 | 이유 |
|---|---|---|---|
| v0.2 실행 후보 `transition(command, state)` (`experiments/helm-kernel-v02/src/kernel.mjs`, 원전 정리 2 §9.2) | 명령 13개, Choice qualification, Authority Grant 포함 검사, 모든 명령에 `expectedCursor` | 명령 약 90개. Claim 승격, 질문, 자율 결정, 루프, 구조 추가. 동시성은 레코드 version | Goal·Concern·탐구·질문이 실행 후보에 없었다(원전 정리 2 §9.15) |
| helm-toy (`experiments/helm-toy/helm.mjs`) | 자격을 `actor !== "human"`으로 검사. 승격은 근거 ≥1, counterChecked, 반대 근거 0 | 자격은 능력표와 채널로 검사. 승격은 08 `promotionMissing()`(구분 확인, 근거 품질·신선도 포함)에 출처 독립성 검사를 더함 | L18, 브리프 §3.5, 08 D08-2 |
| v0.3 08 §2 경로 7단계 | 형식 → 권한 → 이벤트 기록 → 갱신 → 규칙 평가 → 투영 → 다음 단계 | 경로 → 형식 → 자격 → 정책·내용 → 결정 → 파생(react) → 사후 검사 → 커밋 → 투영 → 지시 | 규칙 평가에서 나는 거부(감사 §3.5)를 커밋 전에 판정하기 위해 파생을 커밋 앞에 둔다 |
| 대화 X3-8-06 | "거부된 제안도 관찰로 기록한다" | 거부는 이벤트로 기록하되 관찰 레코드로 만들지 않는다 | L20 "실행된 도구 결과만 관찰이다". 거부 기록이 근거로 인용되면 "모델이 X를 시도했다"가 세상에 대한 사실처럼 쓰인다 |

### 2.4 다른 초안과 맞춘 것

| 문서 | 맞춘 것 | 이 문서의 처리 |
|---|---|---|
| 08 | 레코드 스키마, 상태 기계(§3.22), 쓰기 시점 제약 R-01~R-55, 행위자 문자열 문법과 `Via`, `revisionSeq`, 품질 구조(level + contestedBy·stale·supersededBy), `Autonomy`·`WhyNotAsked`, 구분 확인 레코드(`dc`)와 `promotionMissing()`, 이의 레코드(`ct` Objection), 질문의 임시 가정 = 전제 레코드(`as`, origin question), Grant(비상 포함), ToolCall 상태, 이벤트 이름, 거부 코드 접두사 규칙(`invalid`·`not_found`·`conflict`·`policy`·`denied`·`gate`·`path`) | 모두 채택. 커널은 08의 레코드를 만들고 바꾸는 명령과 판정을 정한다 |
| 08 | 범위 밖 호출을 내용 갈래로 분류(§3.23) | 채택하지 않는다. 자격 갈래 `gate.scope_expansion_required`로 둔다(§3.4.1). 08 §5.2의 질문 (3)에 대한 답이다 |
| 06 | `@helm/engine`이 트랜잭션·멱등·커밋·지시를 맡고 커널은 순수. `KernelContext`(now, newId, policyVersion), `apply`, `Directive` | 채택. `EngineInput` 네 종류와 이 문서의 명령 envelope 대응은 §3.3.5 |
| 12 | 런타임 채널 명령 `run.start`(재시작 포함), `run.end`(interrupted 포함), `run.await`, `toolcall.intend`, `toolcall.complete`, `toolcall.interrupt`, `toolcall.report_unknown`(12의 `toolcall.outcome_unknown`), `toolcall.recover`, `runtime.boundary`(12의 `boundary.reach`), `presence.update`, `checkSettle` | 이 이름으로 정의한다 (§3.11.7, 2a단계에서 12 이름에 맞춤) |
| 14 | 오케스트레이터 명령 `concern.open`·`close`·`reopen`, `loop.transition`, `loop_plan.record`, `situation.assess`, `mode.route`, `structure.*`, `probe.define`·`judge`, `watch.define`·`judge`, `reflection.record`. 런타임(오케스트레이터)이 모델 선언을 반영해 보내는 경로 | 이 이름으로 정의한다. 런타임 채널 제출은 선언한 run을 `declaredBy`로 남긴다 (§3.3.2) |
| 15 | `claim.record_counter_search`, `claim.declare_discrimination`, `claim.bind_discrimination`, `finding.promote`, `goal.revision.propose`, 반증 탐색의 `purpose: "counter_search"` | 유지한다. 구분 확인 명령은 08 `dc` 레코드를 만든다 (§3.11.4) |
| 16 | `policy.change.propose`, `procedure.candidate.propose`, 보고 명령, 사람의 채택·기각·나중에 | 채택. 보고 명령 `observer.report.submit` 추가 (§3.11.10) |
| 19 | 사람 명령의 `basisSeq` → `expect` 변환, `conflict.already_resolved`·`conflict.superseded`, `decision.contest`, 거부의 `next` | 채택 (§3.3.4, §3.4.4, §3.11.5) |

## 3. 명세 본문

### 3.1 커널의 모양 [제안]

#### 3.1.1 세 함수

```ts
// packages/kernel/src/index.ts
export function decide(state: KernelState, cmd: CommandEnvelope, ctx: KernelContext): Decision;

/** 커밋된 이벤트 하나를 상태에 적용한다. 08 §3.1.1 `State(seq_n) = fold(apply, State0, Events[1..n])` */
export function apply(state: KernelState, event: CommittedEvent): KernelState;

/** decide 안에서 호출된다. 받아들인 초안을 적용한 상태에서 같은 트랜잭션에 넣을 파생 이벤트를 만든다 */
export function react(
  before: KernelState, after: KernelState, drafts: readonly EventDraft[], ctx: KernelContext,
): readonly EventDraft[];
```

- `decide`: 제출 하나에 대한 결과(받아들임·거부·질문 필요·충돌·오류), 이벤트 초안, 커밋 뒤 지시를 돌려준다. 상태를 바꾸지 않는다.
- `apply`: 커밋된 이벤트를 상태에 적용한다. 이벤트를 거부하지 않는다(이미 검사를 통과했다). 모르는 이벤트 타입은 상태를 바꾸지 않고 `state.diagnostics`에 남긴다. 레코드의 `revisionSeq`(사람 판단에 영향을 주는 이벤트만)·`lastSeq`를 그 이벤트의 seq로 바꾸고 링크(08 §3.20.3)를 만든다.
- `react`: 결과 확인 → 통합·반영 항목 생성, 근거 낡음 → 의존 레코드 낡음 전파 같은 규칙을 적용한다(§3.13).

06 §3.4.4의 공개 API 개요(`decide(view, input, ctx)`, `apply(state, events)`)와 같은 구조다. `apply`가 이벤트 하나를 받는 형태로 정하고, 여러 이벤트는 `events.reduce(apply, state)`로 적용한다.

#### 3.1.2 순수성 계약

| 규칙 | 내용 | 검사 |
|---|---|---|
| R-PURE-1 | 파일, 네트워크, 데이터베이스, 프로세스 환경, 시계, 난수, 타이머, 콘솔을 쓰지 않는다 | 06 §3.5.3의 ESLint 규칙 R4·R5. `packages/kernel`의 의존은 `@helm/domain`과 `typebox`뿐 |
| R-PURE-2 | 같은 `(state, cmd, ctx)`는 언제나 같은 `Decision`을 낸다 | 속성 테스트 PT-01 (§3.17) |
| R-PURE-3 | 판정에 쓰는 현재 시각은 `ctx.now` 하나다. 제출의 `issuedAt`은 기록만 한다. 페이로드의 기한 값(만료 시각 등)은 절대 시각으로 비교한다 | PT-01, 리뷰 |
| R-PURE-4 | 입력 객체를 바꾸지 않는다 | 테스트에서 입력을 깊이 동결한 뒤 호출 |
| R-PURE-5 | 규칙 평가 순서가 고정이다. 같은 상자에서 여러 규칙이 실패하면 첫 실패를 결과 코드로, 나머지를 `alsoFailed`로 | 단위 테스트 |
| R-PURE-6 | `react`는 새 초안이 없을 때까지 반복하고 최대 8회다. 넘으면 `status: 'error'`, `kernel.reaction_overflow`, 커밋 없음 | 단위 테스트 |
| R-PURE-7 | 반환 직전에 사후 검사(§3.16.3)를 돌린다. 실패하면 `kernel.invariant_violation`, 커밋 없음 | 단위 테스트 |

#### 3.1.3 컨텍스트, 시각, ID

```ts
export interface KernelContext {
  /** 커밋 시각. engine이 트랜잭션 시작 때 한 번 읽어 넣는다. epoch ms (08 Ms) */
  readonly now: Ms;
  /** 이 결정 직전의 마지막 이벤트 seq */
  readonly cursor: Seq;
  /** 새 레코드 ID. 06 §3.4.4. engine은 아래 파생 구현을 넣는다 */
  newId<P extends IdPrefix>(prefix: P): IdOf<P>;
  /** 규칙 데이터 묶음과 그 버전 (06의 policyVersion) */
  readonly rules: RuleBundle;
  /** 데몬 운영 상태 중 커널이 읽는 것: 방해 금지, 주의 예산 상태(14 §3.13.5). 사람의 접속 상태는 ctx가 아니라
   *  영속 이벤트 presence.changed에서 만든 상태(state.presence)로 읽는다(08 §5.2 (5), 09 §3.4.13, 2a 정렬) */
  readonly attention: { readonly dnd: boolean; readonly budget: 'normal' | 'over_budget' | 'quiet_hours' };
}

export interface RuleBundle {
  readonly version: string;                         // 규칙 데이터의 내용 해시. 이벤트 provenance에 남는다
  readonly capabilities: typeof CAPABILITY_TABLE;   // 08 §3.3.4
  readonly commandSpecs: Readonly<Record<CommandType, CommandSpec>>;   // §3.11
  readonly proposalKindOf: Readonly<Partial<Record<CommandType, ProposalKind>>>; // §3.6.2
  readonly decisionKinds: DecisionKindRegistry;     // 11 §3.3.3
  readonly questionKinds: QuestionKindRegistry;     // 11 §3.2.2
  readonly systemPolicies: readonly PolicyRule[];   // §3.6.4
  readonly loopContracts: LoopContractTable;        // 14 소유. 커널은 읽기만
  readonly machines: MachineTable;                  // 08 §3.22를 데이터로 (`@helm/domain/src/machines`)
}
```

engine이 넣는 `newId`의 파생 구현 [제안]:

```ts
// packages/engine/src/ids.ts (커널 밖. 06의 IdFactory 계약을 따른다)
export function derivedIdFactory(now: Ms, commandId: CommandId): KernelContext['newId'] {
  let ordinal = 0;
  return (prefix) => {
    // ULID = 48비트 시각(now) + 80비트 = sha256(`${commandId}:${ordinal++}`)의 앞 10바이트
    // 08 §3.2.1 형식: `${prefix}_${ULID}` (Crockford base32, 첫 글자 0~7)
    return makeId(prefix, now, sha256(`${commandId}:${ordinal - 1}`).slice(0, 10));
  };
}
```

- 같은 제출을 다시 결정해도(커밋 실패 뒤 재시도) 같은 ID가 나오므로, 멱등 재시도와 결정성 테스트(PT-11)가 성립한다.
- 제출자가 만드는 레코드(모델이 제안하는 가능성 등)는 제출자가 페이로드에 ID를 넣는다(런타임·클라이언트의 ULID 생성기). 커널은 형식과 중복만 검사한다(V-FORM-02·04). 커널이 만드는 레코드(판단, 통합, 반영 항목, 커널이 여는 질문 등)만 `newId`를 쓴다.
- 이벤트 ID(`ev_`)와 seq는 09가 append할 때 붙인다. `EventDraft`에는 없다.

#### 3.1.4 결정 결과

```ts
export type DecisionStatus = 'accepted' | 'rejected' | 'needs_gate' | 'conflict' | 'error';

export interface Decision {
  readonly status: DecisionStatus;
  readonly commandId: CommandId;
  /** accepted: 도메인 이벤트 + 파생. rejected: command.rejected (도구 호출이면 toolcall.requested + toolcall.blocked).
   *  needs_gate: command.rejected(gate) 또는 toolcall.requested + toolcall.approval_requested, + question.recorded 와 전달 이벤트.
   *  conflict, error: 빈 배열 */
  readonly events: readonly EventDraft[];
  readonly directives: readonly Directive[];
  readonly rejection?: Rejection;              // rejected, needs_gate, conflict
  readonly notices: readonly Notice[];         // accepted여도 강등·병합 등을 알림
  readonly createdRefs: readonly AnyRecordIdT[];
  readonly gate?: { readonly questionId: QuestionIdT };
}

/** 09 §3.2 envelope 중 커널이 채우는 부분 (2a 정렬: 판정 J-27, 정렬 기록 §B). seq·해시·시각은 engine·09가 채운다 */
export interface EventDraft {
  readonly type: EventType;                    // 09 §3.4 카탈로그 이름. 예 'possibility.proposed'
  readonly category: EventCategory;            // 09 §3.2 (domain | governance | runtime | kernel | system | measurement)
  readonly plane: Plane | null;                // N/E/M/A/P. 거부 기록은 대상 평면 또는 null (system은 범주이지 평면이 아니다)
  readonly actor: ActorRef;                    // 08 §3.3.2 문자열. 커널 파생은 'kernel'
  readonly via: Via;                           // 08 §3.3.2
  readonly subject: AnyRecordIdT | null;       // 주 대상 하나. null은 09 §3.2 규칙 3의 예외(시스템, brief.acknowledged, 사용자 층 dial.*)
  readonly refs: readonly AnyRecordIdT[];      // 나머지 관련 레코드
  readonly payload: Readonly<Record<string, unknown>>; // 09 §3.4.15 payload
  readonly authority: readonly string[];       // `<kind>:<ref>` 문자열 (kind: human_command | agreement | grant | policy | question | rule | capability). 거부 기록은 빈 배열 (09 §3.2 규칙 4)
  readonly commandId: CommandId;
  readonly causationId: string;                // 원인 명령 또는 이벤트. kernel·scheduler 행위자 이벤트는 필수 (09 요구 (10))
  readonly correlationId: string;              // Correlation을 09 형식 문자열로
  readonly scope: { readonly projectId: ProjectIdT | null; readonly concernId?: ConcernIdT };
  readonly enforcement?: EnforcementLevel;     // 도구 관련 이벤트 (§3.18)
  readonly provenance: { readonly rulesVersion: string; readonly contextRef?: ContextRef; readonly adapterId: string };
}

/** 커널 안에서 쓰는 구조화 근거. 이벤트에 쓸 때 `<kind>:<ref>` 문자열로 바꾼다 (09 요구 (5)) */
export type AuthorityBasis =
  | { readonly kind: 'human_command'; readonly via: Via }
  | { readonly kind: 'agreement'; readonly agreementId: AgreementIdT; readonly revision: number }
  | { readonly kind: 'grant'; readonly grantId: GrantIdT }
  | { readonly kind: 'policy'; readonly policyId: string }
  | { readonly kind: 'question_answer'; readonly questionId: QuestionIdT }
  | { readonly kind: 'rule'; readonly ruleId: string }        // 커널 파생 규칙
  | { readonly kind: 'capability'; readonly actor: ActorRef; readonly capability: RecordCapability };

/** 커밋 뒤 engine이 런타임·데몬에 넘길 일. 커밋된 이벤트에서 다시 계산할 수 있어야 한다 */
export type Directive =
  | { readonly kind: 'timer.schedule'; readonly timerId: string; readonly at: Ms; readonly purpose: TimerPurpose; readonly subject: AnyRecordIdT }
  | { readonly kind: 'timer.cancel'; readonly timerId: string }
  | { readonly kind: 'notify'; readonly deliveryId: string; readonly questionIds: readonly QuestionIdT[]; readonly urgency: 'interrupt' | 'notice' | 'digest'; readonly batchKey?: string }   // 11 §3.5.3·§3.5.6. deliveryId = 발화 사건 seq + 질문 ID에서 파생
  | { readonly kind: 'run.signal'; readonly runId: RunIdT; readonly signal: 'pause' | 'resume' | 'abort' | 'continue' | 'wrap_up'; readonly reason: string; readonly payloadRef?: AnyRecordIdT }
  | { readonly kind: 'agent.request'; readonly role: 'mediator' | 'verifier' | 'observer'; readonly purpose: string; readonly subjects: readonly AnyRecordIdT[] }
  | { readonly kind: 'workunit.start'; readonly workUnitId: WorkUnitIdT }
  | { readonly kind: 'projection.invalidate'; readonly scope: ProjectionScope };
```

지시는 engine이 커밋 뒤 처리한다(06 `onDirective`). 09는 outbox를 두지 않고 내부 소비자 커서로 처리하므로(09 A09-4), 크래시로 처리하지 못한 지시는 커서 이후 이벤트에 `directivesFor(state, events)`를 다시 돌려 만든다. 타이머는 이벤트로 기록하지 않는다. 정본은 레코드 필드(기한, 만료점, 다시 볼 조건)이고 09 `p_timers` 투영과 커널의 `pendingTimers(state)`가 같은 필드에서 계산한다(09 §3.11.3, 12 RT-8). `timer.schedule`·`timer.cancel` 지시는 스케줄러가 다음 깨어날 시각을 앞당기게 하는 힌트다.

#### 3.1.5 조회 함수 (순수)

| 함수 | 쓰는 곳 | 내용 |
|---|---|---|
| `pendingTimers(state): TimerSpec[]` | 12 스케줄러 | 질문 만료 여유·만료, 예약 전달 시각, 기대 기한, 예측 확인일, 합의·Grant 만료, 다시 볼 조건의 시각 부분, 관찰 기간(A.watch) |
| `checkSettle(state, runId): SettleCheck` | 12 `finishTurn` | 턴을 끝내기 전에 처리할 항목. 항목 키 목록은 §3.18.2 |
| `allowedCommands(state, actor, correlation): CommandType[]` | 12·13 도구 목록 구성 | 지금 이 행위자에게 의미 있는 명령. 런타임은 여기 없는 Helm 도구를 모델에게 주지 않는다 |
| `mustIncludeRefs(state, concernId): AnyRecordId[]` | 12 투영 생성(A9) | 투영에서 빠지면 안 되는 레코드: 미해소 반대 근거 링크의 관찰, 품질 플래그(contested·stale)가 켜진 레코드, 열린 질문, 활성 전제, 결과 불확실 도구 호출, 열린 이의 |
| `impactOf(state, recordId): ImpactSet` | 11 이의·재작업 | 대상에 기대는 레코드(`depends_on` 링크의 역방향)와 그 아래 도구 호출 (§3.13.3) |
| `autonomousDecisions(state, filter)` | 03·04·05 "에이전트가 정한 것" | `Autonomy.autonomous = true`인 레코드와 `agreement.activated_by_grant`, 확인·이의 상태 |
| `humanOps(state, workUnitId): number` | 11 §3.15 | WorkUnit에 귀속된 사람 결정 조작 수 |
| `viewAt(state, concernId)` | 12 투영 생성 | Concern 하나의 커널 뷰(레코드 묶음과 품질). 투영의 원재료 |
| `explain(state, cmd, ctx): Explanation` | 개발자 화면, 19 오류 응답 | `decide`와 같은 경로를 돌며 규칙별 통과·실패를 모두 돌려준다. 이벤트는 만들지 않는다 |

### 3.2 단일 변경 경로 [결정: 원칙(브리프 14) / 제안: 상자 구성]

모든 상태 변화는 다음 경로 하나로만 일어난다. 데몬 안의 자체 런타임(브리프 23)도 같은 경로를 쓴다("내부 package라는 이유로 raw Event append, authority bypass를 허용하지 않는다", 원전 정리 2 §1.4).

```text
 제출자 (모델 도구 / 사람 클라이언트 / 런타임·오케스트레이터 / 스케줄러 / 어댑터 / 보조 에이전트)
   │  CommandEnvelope (§3.3)
   ▼
 [0] 접수 — @helm/engine (06 §3.4.6, 09)
     인증된 채널·행위자·via 부착, 멱등 키 조회(같은 키·같은 지문 → 저장된 결과, 다른 지문 → conflict)
     single writer 직렬화, ctx.now·cursor·newId·attention 확정, 실행 lease epoch 검사(08 R-43)
   │
   ▼  ── decide (순수) ──
 [1] 경로·채널        이벤트 envelope 제출 금지, 투영 어휘 금지, 스키마 버전, 채널과 행위자 조합, 명령의 허용 채널
 [2] 형식             TypeBox 스키마, ID 형식, 참조 ID 존재와 종류, 같은 Concern 범위, 대상 revisionSeq ≤ basisSeq(동시성)
 [3] 자격 (A)         행위자 역할의 기록 능력과 제안 종류(08 §3.3.4), 원시 행동
 [4] 정책·내용 (P)    4a 권한: 합의 범위, 금지, 예산, 권리 게이트 승인, 권한 이어 쓰기, 독립성, 사람 결정 필요
                      4b 의존 규칙 1~5
                      4c 내용: 상태 전이(08 §3.22), 쓰기 시점 제약(08 R-xx), 승격, 질문(11), 자율 결정 기록, 구조 상한
 [5] 결정             accepted / rejected / needs_gate(질문 생성) / conflict
 [6] 이벤트 초안       도메인 이벤트 또는 거부 기록. ID(newId), authority, causationId, enforcement
 [7] 파생 (react)     적용한 상태에서 같은 트랜잭션에 넣을 파생 이벤트 (§3.13). 최대 8회
 [8] 사후 검사        V-INV (§3.16.3)
 [9] 지시 계산        타이머, 알림, run 신호, 보조 에이전트 요청
   │  Decision
   ▼  ── 커널 밖 ──
 [10] 커밋 — engine  한 트랜잭션: 이벤트 append(해시 체인) + 명령 결과 + 투영 갱신(09 A09-4). 실패하면 아무것도 남지 않음
 [11] 투영 갱신        커널 상태 = apply, 읽기 모델 테이블(09) 갱신, 구독자에게 seq 이벤트(19)
 [12] 지시 전달        onDirective → 런타임·스케줄러·알림
```

| 상자 | 책임 | 실패 시 | 소유 |
|---|---|---|---|
| 0 접수 | 행위자 인증 결과·via를 envelope에 붙이고, 멱등 조회와 직렬화, lease 검사를 한다. 커널은 접수가 붙인 행위자를 믿는다 | 인증 실패는 커널까지 오지 않는다(19). 낡은 epoch는 `path.stale_epoch` | 06, 09, 17, 18 |
| 1 경로·채널 | 들어온 길과 보낸 쪽이 맞는지 본다 | 경로 위반은 `path.*`, 채널·행위자 위반은 `denied.channel`(자격) | 10 |
| 2 형식 | 모양과 참조가 맞는지 본다 | 내용 갈래 `invalid.*`·`not_found.*`. revisionSeq 충돌은 `conflict` | 10, 08 |
| 3 자격(A) | 이 역할이 이 종류의 일을 할 수 있는지 본다 | 자격 갈래 `denied.*` | 10, 08 |
| 4a 권한(P) | 지금 이 범위·시점·행위자에게 허용되는지 본다 | 사람이 풀 수 있으면 `needs_gate`(질문), 아니면 자격 갈래 거부 | 10, 11 |
| 4b 의존 규칙 | 합의·확인·근거 의존을 본다 | 규칙별 (§3.8) | 10 |
| 4c 내용 | 상태 전이, 근거, 참조 제약, 질문 형식, 자율 결정 기록을 본다 | 내용 갈래. 강등이면 `accepted` + `downgraded.*` | 10, 08, 11 |
| 5~9 | 이벤트를 만든다 | 파생 폭주·사후 검사 실패는 `error`(커밋 없음) | 10 |
| 10 커밋 | 원자적 append | 트랜잭션 실패면 결과 없음. 같은 멱등 키로 재시도 | 06, 09 |
| 11 투영 갱신 | 상태와 읽기 모델 갱신 | 투영 실패는 커밋을 되돌리지 않는다. 투영을 degraded로 표시하고 다시 만든다(원전 정리 2 §1.21) | 09, 12 |
| 12 지시 전달 | 알림·예약·신호 | 재시도. 지시는 이벤트에서 다시 계산 가능 | 06, 12, 17 |

경로 밖에서 상태를 바꾸려는 시도:

| 시도 | 막는 곳 | 기록 |
|---|---|---|
| 런타임·어댑터가 이벤트 envelope를 직접 제출 | 상자 1 `path.adapter_cannot_append_event` | `command.rejected` |
| 투영 어휘(`projection.*`)로 제출 | 상자 1 `path.projection_is_derived` | `command.rejected` |
| 끊긴 부팅 epoch의 실행이 쓰기를 보냄 | 상자 0 `path.stale_epoch` (08 R-43) | `command.rejected` |
| 모델이 bash로 DB 파일을 고침 | 이벤트 로그는 `~/projects` 밖 `/srv/volumes/helm/`(브리프 §2.5)에 있고 도구 범위에 들어갈 수 없다(13). 그래도 바뀌면 09 해시 체인 검사가 읽을 때 잡는다 | 09 무결성 진단, 읽기 전용 복구 모드 (`path.direct_store_write`) |
| 커널 상태 객체를 직접 변경 | 상태는 동결된 값이며 프로세스 밖에 노출되지 않는다 | 해당 없음 (helm-toy 시도 21은 테스트로 재현, §3.17.4) |

### 3.3 제출 envelope [제안]

#### 3.3.1 타입

```ts
// @helm/domain (06 §3.4.1의 `Command` 타입이 이것이다)
export interface CommandEnvelope<T extends CommandType = CommandType> {
  readonly schema: 'helm.command.v1';
  readonly commandId: CommandIdT;          // `cm_<ULID>` (08 §3.2.2). 제출자가 만든다
  readonly type: T;                        // 명령 이름 (§3.11)
  readonly actor: ActorRef;                // 08 §3.3.2. 접수(상자 0)가 인증 결과로 채운다
  readonly via: Via;                       // 08 §3.3.2. 접수가 채운다 (device | local_cli | run | system)
  readonly channel: CommandChannel;        // 접수가 연결 종류로 채운다
  readonly declaredBy?: RunIdT;            // 런타임(오케스트레이터)이 모델 선언을 반영해 보낼 때 그 run (14)
  readonly issuedAt: Ms;                   // 제출자 시계. 기록용
  readonly idempotencyKey: string;         // 범위: channel | actor | viaKey | key (09 §3.9.1)
  readonly basisSeq?: Seq;                 // 사람이 본 화면의 seq (19). 사람 확정 명령은 필수 (§3.3.4)
  readonly expect?: readonly RevisionRef[];// 08 §3.4.2 { id, revisionSeq }. 레코드를 직접 지정할 때만 (선택)
  readonly correlation: Correlation;
  readonly contextRef?: ContextRef;        // 모델 채널이면 필수 (A11, V-FORM-06)
  readonly payload: CommandPayload<T>;
  readonly provenance: { readonly adapterId: string; readonly externalRunId?: string; readonly sourceRefs?: readonly string[] };
}

export type CommandChannel =
  | 'human_client'   // 데스크톱 앱, TUI, 관리 CLI의 사람 조작 (19)
  | 'model_tool'     // 모델이 Helm 제안 도구를 호출 (13)
  | 'runtime'        // 데몬 안 런타임·오케스트레이터: 도구 의도·결과, 실행 수명, 경계, 모델 선언 반영
  | 'scheduler'      // 타이머 발화
  | 'adapter'        // 외부 응답 수집기, 이후 단계의 외부 런타임 어댑터
  | 'aux_agent'      // 중재자, 검증 에이전트, 관찰 에이전트, 라우터의 구조화 출력
  | 'migration';     // 가져오기 (09)

export interface Correlation {
  readonly projectId?: ProjectIdT; readonly goalId?: GoalIdT; readonly concernId?: ConcernIdT;
  readonly workUnitId?: WorkUnitIdT; readonly runId?: RunIdT; readonly toolCallId?: ToolCallIdT;
}

export interface ContextRef {             // 모델이 이 제안을 낼 때 본 투영. 12가 투영을 만들 때 붙인다
  readonly projectionId: string;
  readonly sourceSeq: Seq;
  readonly policyVersion: string;
}
```

#### 3.3.2 채널과 행위자의 허용 조합

| 채널 | 허용 행위자 | via | 비고 |
|---|---|---|---|
| `human_client` | `human` | device, local_cli | 사람의 확정·답·이의·다이얼 변경은 이 채널로만 (L21). 접수가 인증 주체를 확인한다: 주체가 `device` 또는 `localAdmin`일 때만 사람 결정 명령을 받는다(18 T18-19). 런타임·관찰 경로에서 온 사람 결정 명령은 `denied.channel` |
| `model_tool` | `agent:work`, `agent:verifier`, `agent:branch` | run | 모델의 propose 계열. 행위자 역할은 run 등록(`run.started`의 role)에서 접수가 채운다 |
| `aux_agent` | `agent:mediator`, `agent:verifier`, `agent:observer`, `agent:router` | run 또는 system | 보조 에이전트의 구조화 출력 |
| `runtime` | `runtime` | system 또는 run | 도구 의도·결과, 실행 수명, 경계. 모델 선언을 반영한 구조 명령은 `declaredBy`에 run을 넣는다 |
| `scheduler` | `scheduler` | system | `timer.fire`만 |
| `adapter` | `runtime` | system | 외부 응답 관찰(`external:*`는 관찰의 출처로만 등장, 08 §3.3.2 규칙 2) |
| `migration` | `migration` | system | 가져오기 명령 (09) |

`kernel` 행위자는 제출하지 않는다. 커널 파생 이벤트에만 쓰인다.

`declaredBy`가 있는 런타임 제출: 오케스트레이터(14)가 모델이 선언한 값으로 계산해 보내는 구조 명령(루프 전환, 계획, 상황 판정, 구조 동작, 탐침 판정 등)이다. 커널은 `declaredBy`의 run이 실재하고 `running`인지(08 R-43), 그 run 역할의 제안 종류에 명령이 포함되는지(능력표) 검사한다. 이 명령이 만드는 레코드의 `Autonomy.decidedBy`는 그 run의 역할(`agent:work` 등)이다. 모델 선언 없이 코드 규칙만으로 정한 것이면 `declaredBy`를 비우고 `Autonomy.decidedBy = 'kernel'`, `whyNotAsked`는 정책 근거로 남긴다.

#### 3.3.3 명령 스펙

```ts
export interface CommandSpec<T extends CommandType = CommandType> {
  readonly type: T;
  readonly payloadSchema: TSchema;
  readonly channels: readonly CommandChannel[];
  readonly requires:
    | { readonly record: RecordCapability; readonly proposalKind?: ProposalKind }
    | { readonly system: 'runtime' | 'scheduler' | 'migration' };
  readonly humanOnly: boolean;                       // 사람 결정 명령 (채널 human_client만)
  readonly subjects: (p: CommandPayload<T>, s: KernelView) => readonly AnyRecordIdT[];  // 낡음 검사 대상 (19 요구, §3.11.12 표)
  readonly evaluate: (s: KernelState, cmd: CommandEnvelope<T>, ctx: KernelContext) => Outcome;
}

export type Outcome =
  | { readonly kind: 'accept'; readonly drafts: readonly EventDraft[]; readonly notices?: readonly Notice[] }
  | { readonly kind: 'reject'; readonly rejection: Rejection; readonly drafts?: readonly EventDraft[] } // 도구 차단 기록 등
  | { readonly kind: 'gate'; readonly rejection: Rejection; readonly question: QuestionDraft; readonly drafts?: readonly EventDraft[] };
```

#### 3.3.4 동시성: 대상 revisionSeq [2a단계 정렬: 08 §3.4.2, 09 §3.9.4]

- 모든 레코드는 `revisionSeq`(08 `RecordMeta.revisionSeq`, 사람 판단에 영향을 주는 변경을 마지막으로 한 이벤트의 seq)를 가진다. 전달·열람 같은 운영성 이벤트는 올리지 않는다(09 `EVENT_META.bumpsRevision`). `apply`가 갱신한다.
- 사람 확정 명령(스펙 `humanOnly`)은 `basisSeq`(사람이 본 화면의 seq, 19)를 싣는다. 커널은 스펙의 `subjects()`가 돌려준 각 레코드의 `revisionSeq > basisSeq`면 충돌로 본다(09 §3.9.4). 레코드를 직접 지정해야 하면 `expect: RevisionRef[]`를 쓴다. 검사는 커널(`decide` 상자 2)이 하고 저장소는 하지 않는다(09 요구 (3)).
- 불일치면 `status: 'conflict'`, `conflict.version_mismatch`, `rejection.rebase`에 대상 레코드의 현재 요약. 대상이 이미 끝난 상태(답함·확정·철회)면 `conflict.already_resolved`, 대체됐으면 `conflict.superseded`로 나눈다. 19는 이 둘을 3008·3009로 대응한다. 19가 요구한 `content.already_resolved`·`content.superseded`는 이 두 코드다(갈래는 내용, 상태는 conflict).
- 충돌도 `command.rejected`(status conflict)로 기록한다(09 §3.9.2, A14).
- 모델·런타임 채널의 제출은 `basisSeq`가 선택이다. 새 레코드를 만드는 제안은 대상이 없다. 상태 전이 전제는 상자 4c의 상태 검사가 본다.
- 전역 직렬화는 engine의 single writer가 맡는다. 커널은 전역 cursor 일치를 요구하지 않는다. 08 R-30(`loop.transitioned`의 `from` = 현재 루프)처럼 레코드 필드로 표현된 동시성 조건은 그대로 검사한다.

#### 3.3.5 06 `EngineInput`과의 대응

06 §3.4.6의 `EngineInput` 네 종류는 engine 층의 입력이며, engine이 이를 `CommandEnvelope`로 바꿔 커널에 넣는다.

| `EngineInput.kind` | 채널 | 대표 명령 |
|---|---|---|
| `command` | human_client, runtime, scheduler 외 사람·시스템 명령 | `question.answer`, `result.accept`, `run.start` |
| `proposal` | model_tool, aux_agent, runtime(`declaredBy`) | `possibility.propose`, `toolcall.intend`, `loop.transition` |
| `observation` | runtime, adapter, human_client | `observation.record`, `toolcall.complete` |
| `timer` | scheduler | `timer.fire` |

06의 `SubmitResult`(`accepted`, `rejected`, `conflict`, `replayed`)에는 `needs_gate`가 없다. engine은 커널의 `needs_gate`를 `rejected`와 구분해 돌려준다(06에 요구, §5.2).

### 3.4 결과 형식과 거부 세 갈래

#### 3.4.1 세 갈래 [결정: 분류(브리프 §3.5) / 제안: 정의와 순서]

| 갈래 | 08 이름 | 정의 | 판정 기준 | helm-toy 시도 |
|---|---|---|---|---|
| 내용 | `content` | 제출 내용이나 상태 전제가 규칙에 맞지 않는다 | 같은 제출을 누가 보냈어도 거부된다 | 3, 4, 7, 10, 17 |
| 자격 | `authority` | 보낸 행위자에게 그 일을 할 능력(A)이 없거나, 지금 상황에서 그 행위자에게 권한(P)이 없다 | 능력이나 권한을 가진 행위자가 보냈다면 통과한다 | 5, 19 |
| 경로 | `path` | 커널이 정한 길을 거치지 않았다 | 내용·행위자와 무관하게 길이 틀렸다 | 21 |

범위 밖 쓰기의 갈래: 08 §3.23은 "같은 행위자라도 범위를 넓히면 통과하므로 자격이 아니다"라는 이유로 내용 갈래를 제안했다. 이 문서는 자격 갈래로 둔다. 이유:

1. 합의의 범위는 그 WorkUnit의 수행자에게 맡긴 권한(Authority Envelope, 원전 F03 §5)이다. 권한 밖이라는 것은 "이 행위자가 지금 이 일을 할 자격이 없다"이며, 범위를 가진 사람(직접 행동하는 사람)이나 범위가 넓은 다른 합의의 수행자가 보냈다면 통과한다. helm-toy의 판정 기준(다른 행위자였다면 통과)에 맞는다.
2. v0.2 실행 후보도 권한 부족을 `gate.work_agreement_authority_required`로 두었고 원전 정리 2 §9.3은 이를 자격으로 분류했다.
3. 08의 코드 접두사 규칙(`gate.*` = 자격)과도 맞는다. 범위 밖 호출은 사람에게 범위 확대를 묻는 `needs_gate`가 되므로 코드는 `gate.scope_expansion_required`다.

같은 논리로 합의 없는 쓰기(`denied.agreement_required`), 권리 게이트 승인 없음(`gate.approval_required`)도 자격 갈래다. 금지 자원·금지 행동(합의의 `forbiddenResources`·`forbidden`, 권한 레이어의 deny)은 누가 보내도 거부되므로 내용 갈래 `policy.forbidden_resource`다(2a 판정 §1, 08이 이미 따름). 1판·2판의 `policy.forbidden_resource`은 이 코드로 옮겼다. 내용 갈래는 "누가 언제 보내도 틀린 것"(지어낸 근거, 상태 전이 위반, 승격 조건 미달, 기준 누락, 금지 자원)으로 한정한다.

자격 갈래 안에서 A(고정 능력) 실패와 P(상황 권한) 실패를 `rejection.basis: 'A' | 'P'`로 구분한다.

#### 3.4.2 거부 형식

```ts
export type RejectionClass = 'content' | 'authority' | 'path';     // 08 §3.23

export interface Rejection {
  readonly class: RejectionClass;
  readonly basis?: 'A' | 'P';                  // authority일 때
  readonly code: RejectionCode;                // §3.4.4. 08 REJECTION_CODE_PATTERN을 따른다
  readonly ruleId: RuleId;                     // §3.7 규칙 ID 또는 08 R-xx
  readonly message: string;                    // 한국어. 모델에게 그대로 돌려줄 문장
  readonly missing: readonly string[];         // 예: ['capability:accept'], ['scope:write:path:src/**'], ['check.discriminating']
  readonly offending: readonly { readonly path: string; readonly value?: unknown }[];
  readonly alsoFailed: readonly RuleId[];
  readonly retryable: boolean;                 // 상태가 바뀌면 같은 내용으로 통과할 수 있는가
  readonly next: readonly NextAction[];        // 사람 채널에서도 채운다 (19 요구)
  readonly rebase?: Readonly<Record<string, unknown>>; // conflict일 때 대상의 현재 요약
}
export interface NextAction { readonly command: CommandType; readonly hint: string }
export interface Notice { readonly code: NoticeCode; readonly subject: AnyRecordIdT; readonly message: string }
```

모델에게 돌려주는 것은 `code`, `message`, `missing`, `next`다(12가 `[helm:blocked] <code>: <message> | missing: … | next: …` 형식으로 넣는다). 문장은 짧게 쓴다. 예: "근거 `ob_…`는 기록에 없다. 실제 도구 결과의 관찰 ID를 쓰거나, 근거가 없으면 그 기준을 확인 못함으로 제출하라."

#### 3.4.3 판정 순서

```text
1. 경로: 이벤트 envelope, 투영 어휘, 스키마 버전 (path.*)
2. 채널: 채널과 행위자 조합, 명령의 허용 채널, 사람 전용·시스템 전용 명령 (denied.channel, authority A)
3. 형식: 스키마 → ID 형식 → 참조 존재 → 참조 종류 → 같은 범위 (invalid.*, not_found.*)
4. 대상 revisionSeq (conflict.*)
5. 자격 A: 능력표의 기록 능력, 제안 종류, 원시 행동 (denied.*)
6. 권한 P: 합의 범위·금지·예산 → 권리 게이트 승인 → 권한 이어 쓰기 → 독립성 → 사람 결정 필요 (denied.*, gate.*)
7. 의존 규칙 1~5 (§3.8)
8. 내용: 상태 전이 → 쓰기 시점 제약 → 승격 → 질문 → 자율 결정 기록 → 구조 상한 (invalid.*, conflict.invalid_transition, policy.*)
```

형식(3)을 자격(5)보다 먼저 보는 이유: 모양이 틀린 제출은 누가 보냈어도 거부되므로 결과가 행위자에 따라 달라지지 않게 내용 갈래로 둔다. 상태 전이(8)를 자격(5·6)보다 늦게 보는 이유: helm-toy 시도 19처럼 모델의 결과 확인은 "제출된 결과가 있든 없든" 자격 거부로 일관되게 보여야 한다.

#### 3.4.4 코드 목록

08 §3.23의 접두사 규칙(`^(invalid|not_found|conflict|policy|denied|gate|path)\.[a-z0-9_.]+$`)을 따른다. 갈래는 접두사로 정해진다(`invalid`·`not_found`·`conflict`·`policy` → 내용, `denied`·`gate` → 자격, `path` → 경로). 19가 프로토콜 오류 번호와 대응시킨다.

| 코드 | 갈래 | 상태 | 뜻 |
|---|---|---|---|
| `path.adapter_cannot_append_event` | path | rejected | 이벤트 envelope를 제출함 |
| `path.projection_is_derived` | path | rejected | `projection.`으로 시작하는 명령 |
| `path.schema_version_unsupported` | path | rejected | `schema` 값이 지원 목록 밖 |
| `path.stale_epoch` | path | rejected | 끊긴 부팅 epoch의 실행이 쓰기를 보냄 (08 R-42·R-43, 접수에서 판정) |
| `path.fenced` | path | rejected | 쓰기 트랜잭션의 부팅 epoch가 현재가 아님 (09 §3.7 fencing. engine이 판정, 09 요구 (8)) |
| `path.store_read_only` | path | rejected | 저장소가 읽기 전용 모드 (09 §3.10.5, 17). 프로토콜 계층에서 먼저 거절되지만(19 5003) 내부 제출을 위해 둔다 |
| `path.direct_store_write` | path | (진단) | 해시 체인 불일치. 제출 거부가 아니라 09의 무결성 진단 |
| `denied.channel` | authority(A) | rejected | 채널과 행위자 조합이 §3.3.2 밖, 사람 전용 명령이 다른 채널로 옴, 시스템 명령을 다른 채널이 보냄 |
| `denied.capability` | authority(A) | rejected | 역할에 필요한 기록 능력이나 원시 행동이 없음 |
| `denied.proposal_kind` | authority(A) | rejected | 역할의 제안 종류 밖 (08 `proposeKinds`) |
| `denied.agreement_required` | authority(P) | rejected | 쓰기·실행·발송에 활성 합의 없음 (의존 규칙 1). 다음 행동: `agreement.propose` |
| `policy.forbidden_resource` | content | rejected | 합의의 금지 행동·금지 자원, 권한 레이어 deny (2a 판정 §1. 2판의 `denied.forbidden_action`) |
| `denied.producer_cannot_attest` | authority(P) | rejected | 결과를 만든 실행 계통이 증언·확인하려 함 (08 R-18) |
| `denied.grant_not_applicable` | authority(P) | rejected | Grant의 대상자·종류·상황이 맞지 않음 (비상 Grant를 혼돈 아닌 상황에서 씀 등) |
| `gate.scope_expansion_required` | authority(P) | needs_gate | 대상이 합의 범위 밖 → 범위 확대 질문 |
| `gate.approval_required` | authority(P) | needs_gate | 권리 게이트 대상인데 유효한 승인 없음 |
| `gate.approval_mismatch` | authority(P) | needs_gate | 승인 질문의 지문이 다르거나 이미 소진됨 |
| `gate.grant_insufficient` | authority(P) | needs_gate | 권한 이어 쓰기에서 요청 ⊄ Grant |
| `gate.human_required` | authority(P) | needs_gate | 사람이 정할 결정(Goal 변경, 정책이 덮지 않는 확정 등) |
| `invalid.schema` | content | rejected | 페이로드 스키마 위반 (텍스트 길이 초과는 거부하지 않고 자른다, 08 §3.4.1) |
| `invalid.event_too_large` | content | rejected | 이벤트 하나가 09의 크기 상한을 넘음 (blob으로 옮겨야 함, 09 요구 (8)) |
| `invalid.unknown_command` | content | rejected | 등록되지 않은 명령 |
| `invalid.id_format` | content | rejected | ID 형식·접두사 위반 |
| `invalid.evidence_not_found` | content | rejected | 근거·기준선으로 댄 관찰·레코드 ID가 기록에 없음 (지어낸 근거, 08 §3.12 규칙 2) |
| `not_found.record` | content | rejected | 그 밖의 참조 ID가 기록에 없음 |
| `invalid.ref_kind` | content | rejected | 참조 종류가 틀림 |
| `invalid.ref_out_of_scope` | content | rejected | 다른 Concern 트리·프로젝트의 레코드를 근거로 씀 |
| `invalid.goal_link` | content | rejected | Goal이 없거나 현재 아님 (A1, 08 R-01) |
| `invalid.agreement_content` | content | rejected | 기준·멈출 조건 없음, 범위가 프로젝트 밖 (08 R-03) |
| `invalid.check_not_discriminating` | content | rejected | 구분 확인의 예측이 모두 같음 (08 R-12) |
| `invalid.why_not_asked` | content | rejected | 자율 결정에 `whyNotAsked`가 없거나 검증 실패 (불변조건 7, 08 R-15) |
| `invalid.question_shape` | content | rejected | 질문의 게이트·막힘·가정 조합, 필수 응답 선택지 누락 (11 V-Q-01·02, 08 R-23) |
| `invalid.observation_source` | content | rejected | 관찰 출처가 규칙 밖 (08 R-06) |
| `invalid.assumption_on_rights_gate` | content | rejected | 권리 게이트 질문에 임시 가정 (11 V-Q-04) |
| `conflict.duplicate_id` | content | rejected | 이미 있는 ID로 생성 |
| `conflict.invalid_transition` | content | rejected | 08 §3.22 상태 기계에 없는 (상태, 이벤트) 조합 |
| `conflict.agreement_revision_stale` | content | rejected | 결과 제출이 현재 개정판이 아님 (08 R-17) |
| `conflict.version_mismatch` | content | conflict | 대상 `revisionSeq > basisSeq` |
| `conflict.already_resolved` | - | conflict | 대상이 이미 답함·확정·철회 |
| `conflict.superseded` | - | conflict | 대상이 대체됨 |
| `conflict.idempotency_key_reuse` | - | conflict | 같은 멱등 키에 다른 지문 (engine 접수) |
| `conflict.external_observation_changed` | content | conflict | 같은 외부 관찰 멱등 키에 다른 내용 (09 §3.9.3, 09 요구 (8)) |
| `policy.criteria_incomplete` | content | rejected | 결과 제출이 현재 개정판의 기준을 모두 다루지 않음 (08 R-17) |
| `policy.promotion_requirements` | content | rejected | 판단 승격 조건 미달. `missing`에 08 `PromotionMissing` 값과 `evidence.correlated` (§3.9) |
| `policy.basis_required` | content | rejected | Choice 근거(`basis`)가 없거나 현재 아님 (E justifies N, 08 R-15) |
| `policy.acceptance_required` | content | rejected | 결과 확인 없이 "완료" (의존 규칙 2) |
| `policy.obligations_open` | content | rejected | 반영 항목이 남은 채 완료 |
| `policy.subconcerns_open` | content | rejected | 하위 Concern 재조합 전 완료 (의존 규칙 4) |
| `policy.want_inquiry_pick_question` | content | rejected | 원함 탐구에서 하나 고르기 질문 (결정 18, 08 R-23) |
| `policy.question_without_choice` | content | rejected | "계속할까요" 같은 실질 선택 없는 질문 (approval theater, 11 V-Q-03) |
| `policy.question_not_needed` | content | rejected | 에이전트가 물으려 했으나 판정이 정책대로·혼자 정하기 (11 V-Q-08). 다음 행동: `choice.decide` |
| `policy.rollback_point_required` | content | rejected | 임시 가정 아래 첫 쓰기 전에 되돌릴 지점 없음 (11 V-AS-03) |
| `policy.irreversible_under_assumption` | content | rejected | 임시 가정 아래 발송·되돌릴 수 없는 행동 (11 V-AS-02) |
| `policy.structure_cap_exceeded` | content | needs_gate | 하위 Concern 수·깊이 상한 초과 → 질문 (08 R-32) |
| `policy.budget_exhausted` | content | rejected | 합의·루프 예산 초과 |
| `policy.verification_missing` | content | rejected | 자동 검증 정책으로 정한다면서 검증 관찰이 없음 |
| `policy.redecide_after_objection` | content | rejected | 이의가 걸린 결정점을 다시 혼자 정하려 함 (11 §3.10) |
| `policy.delivery_after_expiry` | content | rejected | 중재자 전달 계획의 시각·경계가 그 질문의 만료 여유보다 늦음 (11 V-MED-03) |
| `policy.answer_option_not_allowed` | content | rejected | 질문 종류가 허용하지 않는 응답 선택지(예: 권리 게이트에 `accept_assumption`·`delegate`) (11 V-Q-07) |
| `policy.proposal_signature_rejected` | content | rejected | 기각된 정책 제안 서명을 새 근거 없이 다시 냄 (08 R-40) |

강등과 알림(`accepted`와 함께 돌려줌):

| 코드 | 뜻 |
|---|---|
| `downgraded.criterion_unverified` | 관찰 근거 없이 `met`으로 낸 기준을 `unverified`로 (08 R-17) |
| `downgraded.interpretation_to_assumption` | 관찰을 참조하지 않은 해석을 전제로 (08 R-07) |
| `notice.question_merged` | 같은 `dedupeKey`의 열린 질문에 합침 (11 §3.5.5) |
| `notice.timer_noop` | 이미 끝난 대상의 타이머 |
| `notice.enforcement_degraded` | 사전 차단 없이 받아들임 (§3.18) |
| `notice.text_truncated` | 길이 상한 초과 텍스트를 자르고 원문을 blob에 둠 (08 §3.4.1) |

오류(`status: 'error'`, 커밋 없음): `kernel.reaction_overflow`, `kernel.invariant_violation`.

#### 3.4.5 거부와 질문의 기록 [제안]

| 결과 | 커밋되는 이벤트 | 이유 |
|---|---|---|
| `accepted` | 도메인 이벤트 + 파생 | |
| `rejected` (도구 호출 아님) | `command.rejected` 하나. payload: 명령 타입, 행위자, via, 갈래, 코드, 규칙 ID, `missing`, 대상 refs, `contextRef` | A14. 관찰 에이전트가 반복 거부를 읽는다. 레코드는 바뀌지 않는다 |
| `rejected` (`toolcall.intend`) | `toolcall.requested` + `toolcall.blocked` (`block.rejectionClass`, `code`, `reason`) | 08 ToolCall 상태 기계(§3.22.14). 도구 호출 레코드에 차단 사유가 남는다 |
| `needs_gate` (도구 호출) | `toolcall.requested` + `toolcall.approval_requested` 또는 `toolcall.blocked`(범위 밖은 08 R-05대로 `workunit.scope_exceeded` 동반) + `question.recorded` + 전달 이벤트 | 08 §3.22.3, §3.22.14 |
| `needs_gate` (그 밖) | `command.rejected`(`gateQuestionId` 포함) + `question.recorded` + 전달 이벤트 | 자격 부족을 사람에게 묻는 질문으로 바꾼다 |
| `conflict` | 없음 | 기술적 경합. engine이 결과만 저장한다 |
| `error` | 없음 | 커널 버그. 운영 로그(17)와 제출자에게 오류 |

`command.rejected`는 `plane: 'system'`이며 어떤 도메인 레코드도 만들지 않는다. 판단·결과의 근거로 인용할 수 없다(근거는 관찰 레코드만, 08 R-09). 같은 멱등 키의 재시도는 engine이 저장된 결과를 돌려주므로 거부 이벤트가 겹치지 않는다.

`needs_gate` 뒤 답이 오면: 도구 호출은 08 ToolCall 상태 기계대로 `toolcall.approved`(→ `requested`)로 돌아가 같은 도구 호출 ID로 이어 간다. 그 밖의 제출은 제출자가 새 멱등 키로 다시 보낸다(커널이 자동 재실행하지 않는다). 런타임은 정지하기 전에 질문 상태를 먼저 확인한다. 답이 정지보다 먼저 도착할 수 있기 때문이다(Mastra 검토 §5 [실험]).

#### 3.4.6 1판 이름 대응

1판(같은 날 먼저 쓴 판)을 참조한 12·15·16·19를 위해 바뀐 이름을 적는다.

| 1판 | 2판 |
|---|---|
| 갈래 `qualification` | `authority` (08 §3.23) |
| `path.event_append_forbidden` | `path.adapter_cannot_append_event` |
| `path.projection_vocabulary` | `path.projection_is_derived` |
| `path.channel_not_allowed`, `path.channel_actor_mismatch`, `path.system_command` | `denied.channel` (자격) |
| `content.schema_invalid` / `id_format` / `duplicate_id` | `invalid.schema` / `invalid.id_format` / `conflict.duplicate_id` |
| `content.ref_not_found` | 근거면 `invalid.evidence_not_found`, 그 밖은 `not_found.record` |
| `content.ref_wrong_kind` / `ref_out_of_scope` | `invalid.ref_kind` / `invalid.ref_out_of_scope` |
| `content.state_precondition` | `conflict.invalid_transition` (끝난 대상은 `conflict.already_resolved`·`conflict.superseded`) |
| `content.goal_link_missing`, `content.criteria_missing` | `invalid.goal_link`, `invalid.agreement_content` |
| `content.criteria_incomplete`, `content.agreement_revision_stale` | `policy.criteria_incomplete`, `conflict.agreement_revision_stale` |
| `content.promotion_*` | `policy.promotion_requirements` + `missing` |
| `content.choice_unjustified` | `policy.basis_required` |
| `content.autonomy_meta_missing` | `invalid.why_not_asked` |
| `content.completion_requires_acceptance` / `open_obligations` / `subconcerns_open` | `policy.acceptance_required` / `policy.obligations_open` / `policy.subconcerns_open` |
| `content.question_options_incomplete` | `invalid.question_shape` |
| `content.question_forbidden_kind` | `policy.want_inquiry_pick_question` 또는 `policy.question_without_choice` |
| `content.question_not_needed` | `policy.question_not_needed` |
| `content.*` 나머지 (`rollback_point_required`, `irreversible_under_assumption`, `structure_cap_exceeded`, `budget_exhausted`, `verification_missing`, `contest_redecide_autonomous`) | `policy.*` 같은 이름 (`policy.redecide_after_objection`) |
| `qualification.capability_missing` / `propose_scope` | `denied.capability` / `denied.proposal_kind` |
| `qualification.no_active_agreement` / `forbidden_action` | `denied.agreement_required` / `policy.forbidden_resource` |
| `qualification.out_of_scope` / `rights_gate_required` / `approval_mismatch` / `grant_insufficient` / `human_decision_required` | `gate.scope_expansion_required` / `gate.approval_required` / `gate.approval_mismatch` / `gate.grant_insufficient` / `gate.human_required` |
| `qualification.independence` | `denied.producer_cannot_attest` |
| `conflict.subject_revision_mismatch` | `conflict.version_mismatch` |
| `notice.criterion_unverified`, `notice.interpretation_as_assumption` | `downgraded.criterion_unverified`, `downgraded.interpretation_to_assumption` |
| 이벤트 `submission.rejected`, `submission.gated` | `command.rejected` (게이트면 `gateQuestionId`) |
| `Submission`, `submissionId`(`sb_`) | `CommandEnvelope`, `commandId`(`cm_`) |
| `KernelEffect`, `evolve` | `Directive`, `apply` |
| `revision`, `RevisionExpectation` | `basisSeq`, `RevisionRef`(revisionSeq) (08 §3.4.2, 19) |

### 3.5 커널이 읽는 상태 [제안]

`KernelState`는 이벤트를 접어 만든 불변 값이며 09 §3.16 `KernelView`의 메모리 구현이다(09 요구 (1)). `decide`는 `KernelView`와 `KernelContext`만 읽는다. engine은 메모리에 하나를 유지하고(single writer), 시작할 때 09의 `kernel_snapshots`와 그 뒤 이벤트로 다시 만든다. 레코드 타입은 08이 정한 그대로 쓴다.

```ts
export interface KernelState {
  readonly seq: Seq;
  /** kind별 레코드 지도. 키는 08 §3.20.1의 kind */
  readonly records: {
    readonly project: ReadonlyMap<ProjectIdT, Project>;
    readonly goal: ReadonlyMap<GoalIdT, Goal>;
    readonly concern: ReadonlyMap<ConcernIdT, Concern>;
    readonly structure_change: ReadonlyMap<StructureChangeIdT, StructureChange>;
    readonly boundary_item: ReadonlyMap<BoundaryItemIdT, BoundaryItem>;
    readonly workunit: ReadonlyMap<WorkUnitIdT, WorkUnit>;
    readonly observation: ReadonlyMap<ObservationIdT, Observation>;
    readonly assumption: ReadonlyMap<AssumptionIdT, Assumption>;
    readonly open_question: ReadonlyMap<OpenQuestionIdT, OpenQuestion>;
    readonly interpretation: ReadonlyMap<InterpretationIdT, Interpretation>;
    readonly possibility: ReadonlyMap<PossibilityIdT, Possibility>;
    readonly check: ReadonlyMap<CheckIdT, DiscriminatingCheck>;
    readonly finding: ReadonlyMap<FindingIdT, Finding>;
    readonly choice: ReadonlyMap<ChoiceIdT, Choice>;
    readonly objection: ReadonlyMap<ObjectionIdT, Objection>;
    readonly agreement: ReadonlyMap<AgreementIdT, Agreement>;
    readonly grant: ReadonlyMap<GrantIdT, Grant>;
    readonly result: ReadonlyMap<ResultIdT, ResultSubmission>;
    readonly attestation: ReadonlyMap<AttestationIdT, Attestation>;
    readonly acceptance: ReadonlyMap<AcceptanceIdT, Acceptance>;
    readonly integration: ReadonlyMap<IntegrationIdT, Integration>;
    readonly obligation: ReadonlyMap<ObligationIdT, Obligation>;
    readonly reflection: ReadonlyMap<ReflectionIdT, Reflection>;
    readonly question: ReadonlyMap<QuestionIdT, Question>;
    readonly expectation: ReadonlyMap<ExpectationIdT, Expectation>;
    readonly prediction: ReadonlyMap<PredictionIdT, Prediction>;
    readonly loop_plan: ReadonlyMap<LoopPlanIdT, LoopPlan>;
    readonly loop_transition: ReadonlyMap<LoopTransitionIdT, LoopTransition>;
    readonly situation_assessment: ReadonlyMap<AssessmentIdT, SituationAssessment>;
    readonly mode_assignment: ReadonlyMap<ModeAssignmentIdT, ModeAssignment>;
    readonly probe: ReadonlyMap<ProbeIdT, Probe>;
    readonly inquiry: ReadonlyMap<InquiryIdT, Inquiry>;
    readonly stimulus: ReadonlyMap<StimulusIdT, Stimulus>;
    readonly preference_model: ReadonlyMap<PreferenceModelIdT, PreferenceModel>;
    readonly lens: ReadonlyMap<LensIdT, Lens>;
    readonly run: ReadonlyMap<RunIdT, Run>;
    readonly toolcall: ReadonlyMap<ToolCallIdT, ToolCall>;
    readonly policy_proposal: ReadonlyMap<PolicyProposalIdT, PolicyProposal>;
    readonly rollback_point: ReadonlyMap<RollbackPointIdT, RollbackPoint>;  // 08 §3.18.3
    readonly watch: ReadonlyMap<WatchIdT, Watch>;                 // 08 §3.16.2 (`wt`)
    readonly procedure: ReadonlyMap<ProcedureIdT, Procedure>;     // 08 §3.19.3 (`pd`)
    readonly thread: ReadonlyMap<ThreadIdT, Thread>;              // 08 §3.18.3 (`th`)
    readonly device: ReadonlyMap<DeviceIdT, Device>;              // 08 §3.19.1 (주체 검사)
    readonly pairing_code: ReadonlyMap<PairingCodeIdT, PairingCode>;
  };
  readonly presence: ReadonlyMap<DeviceIdT, 'online' | 'idle' | 'away'>;  // presence.changed에서 (11 §3.8.1)
  readonly links: LinkIndex;              // 08 Link. from·to 양방향 색인 (낡음 전파, 영향 계산)
  readonly policies: readonly PolicyRule[];   // 사람이 정한 정책·관찰 제안 수락분 (§3.6.4)
  readonly dials: DialState;              // 14 정본 다이얼 값 (dial.set 이벤트에서)
  readonly humanOpsByWorkUnit: ReadonlyMap<WorkUnitIdT, number>;
  readonly objectedDecisionPoints: ReadonlySet<string>;   // 이의가 걸린 결정점 키 (11 V-AUT-02)
  readonly bootEpoch: string;             // 현재 부팅 epoch, ULID 문자열 (08 R-42, 09 daemon.booted)
  readonly diagnostics: readonly string[];
}
```

커널이 판정에 쓰는 08 필드(빠지면 구현이 막히는 것):

| 레코드 | 필드 |
|---|---|
| 모든 레코드 | `RecordMeta`(`revisionSeq`, `lastSeq`, `createdBy`, `createdVia`, `createdSeq`), `status`, `quality`(있는 것) |
| Concern | `goalId`, `parentConcernId`, `status`, `currentLoop`, `situationAssessmentId` |
| WorkUnit | `workKind`, `plannedPrimitives`, `status` |
| Observation | `source`(tool·human·external·timer·watcher), `materialRefs`(해시), `quality` |
| Interpretation·Possibility | `evidence`(EvidenceLink: target, relation, resolution), `counterSearches`, `checkIds`, `origin.branchRunId` |
| DiscriminatingCheck | `predictions`, `outcomes`, `observation.posthoc`, `verdicts` |
| Choice | `basis`, `autonomy`, `goal`(버전), `supersedes` |
| Agreement | `content.scope`(primitives, resources, sendTargets, budget, validUntil), `content.forbidden*`, `content.stopConditions`, `revision`, `status`, `activation` |
| Grant | `grantKind`, `grantee`, `scope`, `expiresAt`, `stopConditions`, `appliesTo`, `status`, `maxActivations` |
| ToolCall | `primitive`, `fingerprint`, `agreementRef`, `status`, `approvalQuestionId`, `bootEpoch` |
| ResultSubmission | `agreementRevision`, `criteriaResults`, `producerRunIds` |
| Question | `gate`, `blocking`, `assumption`, `assumptionExpires`, `approvalFingerprint`, `status`, `consumedByToolCallId` |
| Run | `role`, `rootRunId`, `attempt`, `ownerEpoch`(ULID), `status` |

### 3.6 A와 P

#### 3.6.1 판별 [결정: 판별 질문(브리프 §6) / 제안: 커널 배치]

> 일하는 도중에 상황이 바뀌면 답도 바뀌는가? 바뀌면 P, 언제나 같으면 A다. (대화 L3288, v0.3 02 §7.1)

| 규칙 | A/P | 커널 위치 |
|---|---|---|
| 작업 에이전트는 결과를 확인(accept)할 수 없다 | A | 상자 3 능력표 |
| 검증 에이전트는 파일을 쓸 수 없다 | A | 상자 3 능력표(원시 행동 write 없음) + 13 도구 목록 |
| 작업 에이전트는 합의된 범위 안에서만 쓸 수 있다 | P | 상자 4a 합의 범위 |
| 결과를 만든 행위자는 그 결과를 증언·확인할 수 없다 | P | 상자 4a 독립성 (08 `producerRunIds`, `rootRunId`로 계산, 08 R-18) |
| 되돌리기 어려운 행동은 사람이 승인한 뒤에만 | P | 상자 4a 권리 게이트. 판별은 권한 레이어 (브리프 결정 2) |
| 사람은 결과를 확인할 수 있다 | A | 상자 3 |
| 자동으로 검증할 수 있는 선택은 에이전트가 정한다 | P | 정책 규칙 `system.auto_verifiable` (§3.6.4, 11 §3.13) |

판별 요령(대화 L3300): 금지 문장인지 허용 문장인지는 상관없다. 능력표의 X 칸도 A다. "할 수 있다"로 시작해도 조건이 합의 상태에 따라 달라지면 P다.

#### 3.6.2 능력표 (A) [결정: 두 층(브리프 4) / 제안: 칸과 대응]

능력표 데이터는 08 §3.3.4 `CAPABILITY_TABLE`을 그대로 쓴다(사람, `agent:work`·`verifier`·`mediator`·`observer`·`router`·`branch`, `runtime`·`kernel`·`scheduler`·`migration`). 커널은 명령 스펙의 `requires`와 이 표를 비교한다(V-CAP-01~03).

- `integrate`의 소유(대화 열린 질문 d9): 08 §3.12 규칙 6을 따른다. 사람은 integrate로 반영 항목을 닫고, `kernel`은 관찰로 확인되는 종류(`docs_tests`, `boundary_check`)를 에이전트가 낸 근거 관찰과 함께 닫는다. 작업 에이전트는 integrate가 없고 해소를 **제안**(`obligation.resolve`, propose)한다. 이렇게 하면 표의 X 칸을 유지하면서 반영 항목마다 사람 조작이 필요하지 않다(14 §5.2 요구 (5)·(6)).
- v0.2의 "decide within scope"는 능력으로 두지 않는다. 범위 안에서 에이전트가 정하는 일은 propose가 P(합의 범위와 정책)를 통과해 자율 결정으로 기록되는 것이다(v0.3 07 §2.3).
- 원시 행동의 사용은 `toolcall.intend`에서 검사한다. 도구가 어떤 원시 행동인지는 13의 도구 레지스트리가 선언하고, 권한 레이어 판정이 `mutating`으로 보정한다(08 `PermissionVerdict`).

명령과 08 `ProposalKind`의 대응(08 §5.2의 요구 (2)). propose 능력이 필요한 명령은 아래 제안 종류가 역할의 `proposeKinds`에 있어야 한다.

| ProposalKind | 명령 |
|---|---|
| `interpretation` | `interpretation.propose` |
| `possibility` | `possibility.propose`, `preference.criterion.propose`(종류 preference_criterion) |
| `assumption` | `assumption.record` |
| `open_question` | `open_question.record` |
| `check` | `claim.declare_discrimination`, `claim.bind_discrimination` |
| `counter_evidence` | `claim.link_evidence`(relation challenges·invalidates), `claim.record_counter_search` |
| `promotion` | `finding.promote`, `claim.resolve_counter` |
| `choice` | `choice.decide` |
| `agreement` | `agreement.propose`, `agreement.revise`, `agreement.activate`, `agreement.discard` |
| `agreement_scope_change` | `agreement.request_scope_change`, `agreement.narrow`, `agreement.restore` |
| `result` | `result.submit` |
| `question` | `question.raise`, `question.withdraw`(자기 질문) |
| `expectation` | `expectation.create` |
| `prediction` | `prediction.propose`, `prediction.check` |
| `loop_plan` | `loop_plan.record` |
| `loop_transition` | `loop.transition` |
| `situation` | `situation.assess` |
| `structure_change` | `structure.split`·`merge`·`detach`·`relocate`·`recombine`·`hold`·`close` |
| `mode` | `mode.route` |
| `probe` | `probe.define`, `probe.judge`, `watch.define`, `watch.judge` |
| `stimulus` | `stimulus.create`, `stimulus.present` |
| `preference_criterion` | (위 `possibility`에 포함) |
| `reflection` | `reflection.record` |
| `obligation` | `obligation.propose`, `obligation.resolve`, `obligation.defer`, `obligation.transfer` |
| `goal` | `goal.propose`, `goal.achievement.claim` |
| `goal_revision` | `goal.revision.propose` |
| `delivery_plan` | `delivery.plan` |
| `policy_proposal` | `policy.change.propose` | X(observer), H | propose/policy_proposal | R-40, V-POL-01(금지 패치, 16 §3.12.4) | `policy_proposal.submitted`. 권리 질문을 만들지 않는다: 채택 명령 자체가 사람의 결정이다(2a 판정 J-74). 제안은 관찰 피드와 복귀 요약에 보인다 | `policy.proposal_signature_rejected`, `invalid.schema` |
| `procedure_candidate` | `procedure.candidate.propose` |
| `concern` | `concern.open`, `concern.reframe`, `concern.reopen` |
| `workunit` | `workunit.propose`, `workunit.start`, `workunit.conclude` |
| `inquiry` | `inquiry.open`, `inquiry.round`, `inquiry.stop` (15가 정의) |
| `annotation` | `observation.annotate` |

#### 3.6.3 정책 (P) 평가 순서 [제안]

| 순서 | 정책 | 입력 | 실패 결과 |
|---|---|---|---|
| P-1 | 합의 범위 | 활성 합의의 `scope`(primitives, resources, sendTargets, budget, validUntil), `forbidden`·`forbiddenResources`, 좁혀진 범위(11 §3.11) | `denied.agreement_required` / `gate.scope_expansion_required` / `policy.forbidden_resource` / `policy.budget_exhausted` |
| P-2 | 권리 게이트 | 권한 레이어 판정 `rightsGate`, 커널이 아는 권리(Goal 변경, 결과 확인, 합의 확정, 정책 변경, 권한 확대) | `gate.approval_required` |
| P-3 | 승인 대조 | 승인 질문의 지문과 소진 여부 (11 §3.14) | `gate.approval_mismatch` |
| P-4 | 권한 이어 쓰기 | Grant와 합의 (§3.6.7) | `gate.grant_insufficient` / `denied.grant_not_applicable` |
| P-5 | 독립성 | 결과 `producerRunIds`의 루트와 증언·확인 실행의 루트 | `denied.producer_cannot_attest` |
| P-6 | 사람 결정 | 명령 스펙 `humanOnly`, 정보 게이트 판정(11 §3.3) | `gate.human_required` |
| P-7 | 의존 규칙 1~5 | §3.8 | 규칙별 |
| P-8 | 질문 정책 | 정책 규칙(항상 묻기, 묻지 않기, 자동 검증), 다이얼, 결정 종류 (11 §3.3) | 11 §3.4의 갈래 |
| P-9 | 신선도 | stale 근거로 새 승격·확정 금지 | `policy.promotion_requirements`(evidence.unqualified) |
| P-10 | 구조 상한 | 하위 Concern 수·깊이 다이얼 (14, 기본 7·3) | `policy.structure_cap_exceeded`(gate) |
| P-11 | 의미 충돌 | 활성 합의들의 쓰기 범위 겹침 | 받아들이되 파생 질문 (§3.13 R-6) |

#### 3.6.4 정책 규칙 데이터와 "범위 안의 정책 적용"

선택(Choice)은 사람이 고르거나 **맡긴 범위 안의 정책이 적용될 때만** 생긴다(브리프 §6). 정책이 적용된 Choice는 `Autonomy.autonomous = true`, `whyNotAsked = { kind: 'info_gate', falseConditions: [1], policyRef }`(08 §3.4.5)로 남는다.

```ts
export interface PolicyRule {
  readonly id: string;                       // 'system.<name>' 또는 수락된 PolicyProposal의 pp_ id
  readonly version: number;
  readonly kind: 'autonomy' | 'always_ask' | 'never_ask' | 'delivery' | 'independence';
  readonly appliesTo: readonly string[];     // 결정 종류 레지스트리 키(11 §3.3.3). 접두사 와일드카드 'impl.*'
  readonly when?: PolicyCondition;           // 커널이 평가할 수 있는 구조화 조건만
  readonly effect: PolicyEffect;
  readonly source: 'system' | 'user' | 'observer_proposal';
  readonly acceptedBySeq?: Seq;              // user·observer_proposal이면 사람 확정 이벤트
}
export type PolicyCondition =
  | { readonly all: readonly PolicyCondition[] }
  | { readonly any: readonly PolicyCondition[] }
  | { readonly loopIs: readonly LoopId[] }
  | { readonly declared: { readonly field: 'outcomeDifference' | 'autoVerifiable' | 'canProceedWithAssumption'; readonly in: readonly (string | boolean)[] } }
  | { readonly concernIn: readonly ConcernIdT[] }
  | { readonly noRightsGate: true };
export type PolicyEffect =
  | { readonly kind: 'decide_autonomously'; readonly requireVerification?: boolean }
  | { readonly kind: 'ask' }
  | { readonly kind: 'deliver'; readonly mode: DeliveryMode }
  | { readonly kind: 'require_independent_attest' };
```

시스템 정책 기본값 [제안]:

| ID | kind | 적용 | 효과 | 근거 |
|---|---|---|---|---|
| `system.auto_verifiable` | autonomy | 선언 `autoVerifiable = true`, 권리 게이트 없음 | 혼자 정하기, 검증 관찰 필수 | 대화 L3403 판정 연습 c, 감사 §3.10 |
| `system.no_material_difference` | never_ask | 선언 `outcomeDifference = 'none'` | 묻지 않음 (조건 2 거짓) | 대화 L3397 판정 연습 a |
| `system.rights` | always_ask | 권리 게이트가 있는 결정 | 질문 | v0.3 06 §3.2 |
| `system.structure_defaults` | autonomy | `plan.loop`, `plan.structure` 종류(14의 상황별 기본 조합·S 규칙 안) | 혼자 정하기 | v0.3 03 §8.1, 06 §4.2 |
| `system.independent_verifier` | independence | 결과 확인 직전, 다이얼 "독립 검증" 켜짐 | 검증 에이전트 증언 요구 | v0.3 07 §3 |

정책 데이터가 불변조건을 끄지 못하게 하는 검사(브리프 결정 17):

- V-POL-01: `never_ask`·`decide_autonomously`는 권리 게이트가 있는 결정, 결과 확인, Goal 변경, 정책 변경, 합의 확정에 적용될 수 없다. 규칙 적재(`loadRuleBundle`)와 `policy.change.accept` 처리 때 검사한다. 16 §3.12.4의 금지 패치 목록을 이 검사로 집행한다.
- 정책 평가는 상자 4에서만 일어난다. 상자 1~3과 사후 검사(V-INV)는 정책을 읽지 않는다.

#### 3.6.5 권한 레이어 판정 입력 [결정: 판별은 권한 레이어(브리프 2) / 제안: 형식]

`toolcall.intend`에는 권한 레이어(13·18)의 판정이 붙어 온다. 기록되는 부분은 08 §3.18 `PermissionVerdict`(decision, source, reasonCode, rightsGate, mutating, info)이고, 커널이 범위 검사에 쓰는 입력은 다음 확장이다(13·08에 요구).

```ts
export interface PermissionInput {
  readonly verdict: PermissionVerdict;              // 08 §3.18
  readonly targets: readonly TargetRef[];           // 대상 자원. 08 ResourceScope와 비교 가능한 형태
  readonly targetsKnown: boolean;                   // bash처럼 대상을 미리 알 수 없으면 false
  readonly sendTarget?: string;                     // send의 받는 곳 (08 Scope.sendTargets와 비교)
  readonly enforcement: 'pre' | 'post_hoc' | 'advisory'; // 이 런타임이 실행 전에 막을 수 있는가 (§3.18)
}
export type TargetRef =
  | { readonly kind: 'path'; readonly projectId: ProjectIdT; readonly path: string }   // 프로젝트 루트 기준, 심볼릭 링크 해석 뒤 (13)
  | { readonly kind: 'service'; readonly name: string }
  | { readonly kind: 'url'; readonly url: string };
```

- `verdict.decision = 'deny'`면 커널은 `policy.forbidden_resource`으로 막는다(권한 레이어가 막은 것도 거부로 기록, A14).
- `verdict.rightsGate = true`면 P-2 권리 게이트를 적용한다. 권리 범주(돈, 대리 발언, 타인 영향, 정보 유출, 비가역 외부)의 분류는 권한 레이어가 `reasonCode`로 준다.
- `targetsKnown = false`인 실행(execute)은 합의 범위를 실행 전에 검사할 수 없다. 합의가 대상 미상 실행을 허용하면(13·08에 `allowUnknownTargets` 필드 요구) 받아들이고 `enforcement: 'post_hoc'`으로 기록해 `toolcall.complete`의 작업 공간 변경 목록으로 사후 검사한다. 허용하지 않으면 `gate.scope_expansion_required`로 묻는다.

#### 3.6.6 범위 검사 [제안]

범위 타입은 08 §3.11.1 `Scope`(primitives, resources: `ResourceScope`[], sendTargets, budget, validUntil)와 `forbiddenResources`를 쓴다.

```text
covers(agreement, primitive, targets, sendTarget, now):
  scope = agreement.narrowedScope ?? agreement.content.scope        # 11 §3.11
  if primitive == 'read': return ok                                  # 의존 규칙 1은 write·send만. 읽기 범위는 13이 도구 쪽에서 제한
  if primitive ∉ scope.primitives: missing += "primitive:"+primitive
  if scope.validUntil != null and now >= scope.validUntil: missing += "agreement:valid"
  for t in targets:
     if any f in agreement.content.forbiddenResources: match(f, t): forbidden += t        # 금지가 우선 (08)
     elif not any r in scope.resources: match(r, t): missing += "scope:"+primitive+":"+show(t)
  if primitive == 'send' and sendTarget ∉ scope.sendTargets: needsApproval = true        # 08 Scope 주석: 비어 있으면 send마다 권리 게이트
  budget: 합의 아래 run 수, 도구 호출 수, 경과 시간, 비용이 scope.budget 이하

match(r: ResourceScope, t: TargetRef):
  path: 같은 projectId이고 glob 일치. '**'는 '/'를 포함한 0개 이상, '*'는 '/' 없는 0개 이상 (08 ResourceScope 주석)
  service: 이름이 같음
  url_prefix: t.url이 prefix로 시작
```

v0.2 실행 후보의 `scopeCovers`(접두사 `**`만)는 작은 계약이었다(원전 정리 2 §4.6 남은 한계). 위 규칙은 glob 두 기호로 넓히되 정규식은 허용하지 않는다(판정 결과를 사람이 읽을 수 있게).

#### 3.6.7 권한 이어 쓰기 [제안]

"한 번 맡겼다고 권한이 이어지지 않는다"(원전 F10 §6, 대화 X2-7-22). 사람이 미리 맡겨 둔 범위(08 §3.11.2 Grant) 안에 새 작업 합의가 포함된다는 것을 커널이 증명하면, 그 합의는 사람 조작 없이 활성화된다(`agreement.activated_by_grant`). 사람 조작 2회 상한(11 §3.15)을 지키는 주된 장치다. 비교 항목은 08 §3.11.2 끝의 목록 그대로다.

```text
contains(grant, agreement, performerRun, state, now):
  missing = []
  if grant.status != active:                               missing += "grant:active"
  if grant.expiresAt <= now:                               missing += "grant:not_expired"
  if grant.maxActivations != null and |grant.activations| >= maxActivations: missing += "grant:activations"
  if role(performerRun) != grant.grantee or agreement.performer != grant.grantee: missing += "grant:grantee"
  if agreement.agreementKind ∉ grant.appliesTo.agreementKinds: missing += "grant:agreement_kind"
  if grant.appliesTo.concernIds != null and agreement.concernId ∉ (그 Concern들과 하위): missing += "grant:concern"
  if grant.grantKind == 'emergency' and currentSituation(agreement.concernId) != grant.appliesTo.situation: missing += "grant:situation"
  s = agreement.content.scope ; g = grant.scope
  if s.primitives ⊄ g.primitives:                          missing += "primitive:" + 차집합
  for r in s.resources: if not patternContains(g.resources, r): missing += "resource:" + show(r)
  if s.sendTargets ⊄ g.sendTargets:                         missing += "send:" + 차집합
  for k in budget 항목: if s.budget[k] == null or s.budget[k] > g.budget[k] (g가 null이 아니면): missing += "budget:"+k
  if s.validUntil == null or s.validUntil > grant.expiresAt: missing += "valid_until<=grant"
  for c in grant.stopConditions: if c ∉ agreement.content.stopConditions: missing += "stop:"+c
  return missing                                            # 비어 있으면 활성화. 상황 불일치는 denied.grant_not_applicable, 나머지는 gate.grant_insufficient
```

`patternContains`는 보수적이다. `a/**` ⊇ `a/**`, `a/**` ⊇ `a/b/**`, `a/*` ⊇ `a/b.ts`만 참이고 판정할 수 없는 조합은 거짓이다("확대가 안전하다는 증거가 없으면 허가가 아니다", L10). 14 §5.2 요구 (3)의 "인스턴스 범위 ⊆ 템플릿 범위"가 이 검사다.

### 3.7 검증 규칙 목록 [제안]

규칙 ID는 `V-<묶음>-<번호>`다. 08의 쓰기 시점 제약 R-01~R-55은 커널이 그대로 집행하며 규칙 ID로 `R-xx`를 쓴다(§3.10). 표의 "상자"는 §3.2의 상자 번호다.

| 규칙 ID | 상자 | 내용 | 실패 코드 |
|---|---|---|---|
| V-PATH-01 | 1 | 이벤트 envelope가 아니다 (필드 `seq`·`eventId` 또는 schema에 `.event.`) | `path.adapter_cannot_append_event` |
| V-PATH-02 | 1 | 타입이 `projection.`으로 시작하지 않는다 | `path.projection_is_derived` |
| V-PATH-03 | 1 | `schema`가 지원 버전이다 | `path.schema_version_unsupported` |
| V-CH-01 | 1 | 채널과 행위자·via 조합이 §3.3.2 표 안이다 | `denied.channel` |
| V-CH-02 | 1 | 명령 스펙의 `channels`에 채널이 있다. `humanOnly` 명령은 `human_client`만 | `denied.channel` |
| V-CH-03 | 1 | `declaredBy`가 있으면 그 run이 `running`이고 현재 epoch다 | `path.stale_epoch` / `not_found.record` |
| V-FORM-01 | 2 | 명령 타입이 등록되어 있다 | `invalid.unknown_command` |
| V-FORM-02 | 2 | 페이로드가 스키마를 만족한다. 텍스트 길이 초과는 자르고 notice (08 §3.4.1) | `invalid.schema` |
| V-FORM-03 | 2 | 모든 ID가 08 형식이고 접두사가 필드 종류와 맞다 | `invalid.id_format` |
| V-FORM-04 | 2 | 새로 만드는 ID가 상태에 없다 | `conflict.duplicate_id` |
| V-FORM-05 | 2 | 참조 ID가 상태에 있다. 근거·기준선 참조면 `invalid.evidence_not_found` | `not_found.record` / `invalid.evidence_not_found` |
| V-FORM-06 | 2 | 모델 채널(`model_tool`) 제출에 `contextRef`가 있고 `sourceSeq ≤ ctx.cursor` (A11) | `invalid.schema` |
| V-FORM-07 | 2 | 근거·참조가 같은 프로젝트, 같은 Concern 트리(상위·하위·병합 이력) 또는 Goal 공용 레코드다 | `invalid.ref_out_of_scope` |
| V-FORM-08 | 2 | `toolcall.intend`에 `PermissionInput`이 있다 | `invalid.schema` |
| V-VER-01 | 2 | `subjects()`의 각 레코드가 `revisionSeq ≤ basisSeq`이고 `expect`가 있으면 같다. 사람 전용 명령은 `basisSeq` 필수 | `conflict.version_mismatch` / `conflict.already_resolved` / `conflict.superseded` |
| V-CAP-01 | 3 | 행위자 역할이 명령의 기록 능력을 가진다 (08 CAPABILITY_TABLE) | `denied.capability` |
| V-CAP-02 | 3 | propose 명령의 제안 종류(§3.6.2)가 역할의 `proposeKinds`에 있다 | `denied.proposal_kind` |
| V-CAP-03 | 3 | 도구 호출의 원시 행동이 실행 역할의 원시 행동에 있다 | `denied.capability` |
| V-POL-01 | 4a·적재 | 정책 데이터가 권리·결과 확인·Goal 변경·정책 변경·합의 확정에 자율·묻지 않기를 적용하지 않는다 | 적재 실패 / `invalid.schema` |
| V-POL-02 | 4a | 쓰기·실행(mutating)·발송 대상이 활성 합의 범위 안이다 (P-1, 08 R-05) | `denied.agreement_required` / `gate.scope_expansion_required` |
| V-POL-03 | 4a | 금지 행동·금지 자원이 아니고 권한 레이어 판정이 deny가 아니다 | `policy.forbidden_resource` |
| V-POL-04 | 4a | 합의 예산·유효 기간 안이다 | `policy.budget_exhausted` / `conflict.invalid_transition` |
| V-POL-05 | 4a | 권리 게이트 대상이면 지문이 같은 미소진 승인 질문이 허락으로 답해졌다 (08 R-05) | `gate.approval_required` / `gate.approval_mismatch` |
| V-POL-06 | 4a | 권한 이어 쓰기 포함 검사 (§3.6.7, 08 R-04) | `gate.grant_insufficient` / `denied.grant_not_applicable` |
| V-POL-07 | 4a | 증언·확인 실행의 루트가 결과 생산 실행의 루트와 다르다 (08 R-18) | `denied.producer_cannot_attest` |
| V-POL-08 | 4a | 사람이 정할 결정을 사람이 아닌 행위자가 확정하지 않는다 (08 R-14, R-19, R-35, R-36 등의 "행위자 human") | `gate.human_required` |
| V-DEP-1 ~ V-DEP-5 | 4b | 의존 규칙 (§3.8) | 규칙별 |
| V-STA-01 | 4c | (현재 상태, 만들 이벤트)가 08 §3.22 상태 기계에 있다 | `conflict.invalid_transition` |
| R-01 ~ R-55 | 4c | 08 §3.20.2 쓰기 시점 제약 (§3.10) | 08 표의 갈래에 맞는 코드 |
| V-PRO-01 ~ V-PRO-02 | 4c | 판단 승격 (§3.9) | `policy.promotion_requirements` |
| V-AUT-01 | 4c | 자율 결정에 `Autonomy`가 있고 `whyNotAsked`가 검증된다 (08 R-15) | `invalid.why_not_asked` |
| V-AUT-02 | 4c | 이의가 걸린 결정점은 다시 혼자 정하지 않는다 (11 §3.10) | `policy.redecide_after_objection` |
| V-AUT-03 | 4c | 자동 검증 정책으로 정하는 결정은 검증 관찰을 참조한다 | `policy.verification_missing` |
| V-Q-01 ~ V-Q-09 | 4c | 질문 규칙 (11 §3.2.4) | 질문 코드 |
| V-AS-01 ~ V-AS-03 | 4c | 임시 가정과 되돌릴 지점 (11 §3.6.5) | 가정 코드 |
| V-MED-01 ~ V-MED-05 | 4c | 중재자 전달 계획 제약 (11 §3.7) | 중재 코드 |
| V-INV-01 ~ V-INV-12 | 사후 | 결정 결과에 대한 커널 자체 검사 (§3.16.3) | `kernel.invariant_violation` |

### 3.8 의존 규칙 1~5

v0.3 03 §5. 루프 조합과 전환은 자유이고 커널이 강제하는 것은 이 다섯뿐이다(브리프 결정 5). 다이얼·모드·정책은 규칙 1~3을 끌 수 없다. 14 §5.2 요구 (2)에 따라 거부 사유에 규칙 번호를 넣는다(`rejection.missing`에 `dependency_rule:<n>`).

| 번호 | 규칙 | 표시 | 집행 | 위반 시 |
|---|---|---|---|---|
| 1 | write나 send를 하려면 C(작업 합의)가 있어야 한다. 짧게 압축된 C도 된다. 비상 합의 예외 | [결정] 브리프 15(1) | `toolcall.intend`에서 원시 행동이 write·send이거나, execute인데 권한 레이어가 `mutating = true` 또는 `targetsKnown = false`이면 그 실행 WorkUnit의 `active` 합의 현재 개정판이 대상을 덮어야 한다 (V-POL-02, 08 R-05). "압축된 C"는 사람이 확정한 Grant 안에서 활성화된 합의(`activated_by_grant`)다. 비상 합의는 `grantKind: 'emergency'` Grant로 활성화된 합의이며 Concern의 현재 상황 판정이 `chaotic`일 때만 쓸 수 있다 | 합의 없음: `denied.agreement_required`, 다음 행동 `agreement.propose`. 범위 밖: `gate.scope_expansion_required` |
| 2 | "완료"라고 하려면 A(결과 확인)를 거쳐야 한다 | [결정] 브리프 15(2) | 다음 전이는 결과 확인이 필요하다: WorkUnit `accepted`·`integrated`(08 R-19, R-22), Concern `completed`(08 R-34), Goal `achieved`(08 R-35). 결과 확인은 사람 능력(accept)이므로 이 규칙은 A6과 함께 "에이전트만으로 완료 불가"를 만든다. 탐구·탐침 WorkUnit의 `concluded`는 완료가 아니라 멈춤이다 | `policy.acceptance_required`, 반영 항목 남음은 `policy.obligations_open` |
| 3 | 판단으로 올리려면 I의 근거가 있어야 한다 | [결정] 브리프 15(3) | `finding.promote`가 §3.9를 통과해야 한다(08 R-13). "I의 근거"는 탐구 활동이 남긴 관찰(도구 결과, 반응, 외부 응답), 구분 확인, 반증 탐색 기록이다. 승격 시점에 어느 루프가 활성인지는 보지 않는다(루프 조합이 자유이므로) | `policy.promotion_requirements` |
| 4 | 하위 Concern이 있는 Concern은 재조합 확인 뒤에 닫힌다. 사람이 명시적으로 닫는 경우 예외 | [제안] 브리프 15(4) | `concern.close(result: completed)`는 하위가 모두 종료이고 재조합(`structure.changed` op recombine, 08 R-33)이 있어야 한다(08 R-34). 사람이 `concern.close(result: not_completed, force: true)`로 닫으면 남은 하위와 경계 항목을 기록한다(08 §3.22.2) | `policy.subconcerns_open` |
| 5 | Goal을 바꾸려면 사람이 확인해야 한다 | [제안] 브리프 15(5) | Goal의 활성화·개정·달성·대체·은퇴는 행위자 human만(08 R-35). 에이전트 제안은 `goal.revision.propose` → 질문(권리 `goal_change`) | `gate.human_required` |

규칙 5 보완 [제안]: v0.3 03 §5는 "작은 정제까지 매번 사람 확인은 너무 엄격할 수 있다"고 적었다. 규칙은 유지하고 비용은 전달 방식으로 줄인다. Goal 수정 제안 질문은 막지 않는 권리 질문으로, 알림 강도 `notice`로 놓이고 사람이 돌아왔을 때 묶어서 확인한다(11 §3.5). 확정 전에는 이전 버전의 Goal이 기준이다.

Concern 밖 작업(01의 "가벼운 작업")도 규칙 1·2를 받는다(2a 판정 J-01). 위치는 프로젝트마다 하나인 "가벼운 작업" 보관 Concern(14 §3.14.2) 아래 WorkUnit이고, 규칙 1은 직접 지시 echo 합의(사람 채널 `agreement.propose` + `confirmNow`, 08 활성화 경로 `direct_instruction`) 또는 승인된 정책의 Grant로, 규칙 2는 한 화면 결과 확인(`result.accept`)으로 충족한다. 커널은 보관 Concern을 다른 Concern과 같게 검사하고 예외를 두지 않는다.

루프 전환(`loop.transition`)의 검사: 전환 자체는 막지 않는다. 08 R-30(`from` = 현재 루프)만 본다. 도착 루프가 `C.*`인데 활성 합의가 없으면 받아들이되 notice로 알린다(전환은 자유, 쓰기를 할 때 규칙 1이 막는다). 14 §5.2 요구 (7): 루프별 제약(루프 계약의 허용 제안 종류 등)은 커널 불변조건이 아니며, 커널은 루프 계약 위반을 거부하지 않는다. 그 검사는 14의 오케스트레이터가 한다.

### 3.9 판단 승격 규칙 [결정: 근거 필요(브리프 15(3)) / 제안: 세부]

#### 3.9.1 구조

승격의 재료는 08 §3.9의 레코드다.

- 근거: 추측의 `evidence`(EvidenceLink: target `ob_`, relation supports·challenges·qualifies·invalidates, resolution)
- 반증 탐색: `counterSearches`(CounterSearch: 실행한 관찰 1개 이상, found)
- 구분 확인: `checkIds` → DiscriminatingCheck(`dc`): 관찰 전에 결과 라벨과 후보별 예측을 선언하고(`claim.declare_discrimination`), 관찰 뒤 결과 라벨을 정하면(`claim.bind_discrimination`) 커널이 후보별 일치·불일치(`verdicts`)를 계산한다. 관찰이 선언보다 먼저 있었으면 `posthoc: true`이며 승격 조건에 세지 않는다.

구분 확인은 모델이 구조화된 값(결과 라벨, 후보별 예측)을 선언하고 판정은 코드가 하는 결정 주체 원칙의 예다(08 D08-2).

#### 3.9.2 규칙

| 규칙 | 조건 | 실패 시 `missing` |
|---|---|---|
| V-PRO-01 | 08 `promotionMissing(claim, view)`가 빈 배열이다. 포함 조건: 근거 관찰(supports) 1개 이상이고 그중 `qualified` 이상·낡지 않은 것 1개 이상 / 이 추측과 일치하고 다른 후보와 불일치한, 사후가 아닌 구분 확인 1개 이상 / 반증 탐색 1개 이상 / 미해소 반대 근거 없음 / 추측 자체가 낡거나 대체되지 않음 | `evidence.support`, `evidence.unqualified`, `check.discriminating`, `counter.search`, `counter.unresolved:<ob>`, `claim.not_current` |
| V-PRO-02 | 출처 독립성: 지지 근거 관찰의 독립성 키(08 §3.9.1: 도구 `tool:<toolName>:<argsHash>`, 사람 `human`, 외부 `external:<actor>`, 모델 실행 산출 `run:<rootRunId>`)가 둘 이상이거나, 하나뿐이면 그 관찰이 구분 확인의 관찰이다. 같은 키의 반복 관찰은 하나로 센다. 같은 모델·같은 루트 실행에서 나온 추측끼리의 일치는 근거로 세지 않는다(원전 F02 §9 원칙 7) | `evidence.correlated` |

평가 순서는 08 `promotionMissing`의 순서(근거 → 구분 확인 → 반증 탐색 → 미해소 반대 근거 → 현재성) 다음에 V-PRO-02다. 실패하면 `policy.promotion_requirements`, `missing`에 모든 실패 값을 넣는다(한 번에 다 알려 준다).

helm-toy와의 대응: helm-toy의 "근거 없음"은 `evidence.support`, "반증을 찾아보지 않음"은 `counter.search`, "반대 근거 있음: T2"는 `counter.unresolved:<T2의 ob>`다. helm-toy에 없던 구분 확인과 출처 독립성이 더해졌다.

#### 3.9.3 승격 결과

```ts
interface FindingPromotePayload {
  findingId: FindingIdT;                 // 제출자가 만든다
  claimId: InterpretationIdT | PossibilityIdT;
  statement: string;                     // 원래 진술을 다듬을 수 있으나 scope를 넓히면 안 됨 (08 §3.9.5)
  scope: string;
  confidenceBasis: string;
  invalidationTriggers: Trigger[];       // 08 §3.4.4
  reviewTrigger: Trigger | null;
  usage: 'inquiry' | 'decision';         // 결정에 쓰일 판단인가 (v0.3 02 §2.1 조건 5)
}
```

- 통과하면 `finding.promoted`(행위자 kernel, `promotionBasis`에 근거·구분 확인·반증 탐색 수·seq를 고정), 원래 추측은 `promoted`. 판단 품질은 `qualified`, `confirmation.status = 'unconfirmed'`.
- `usage: 'decision'`이면 질문(종류 `finding_confirm`, 정보 게이트, 막지 않음)을 함께 만든다. 사람이 `finding.confirm`하거나 그 판단을 근거로 `choice.commit`하면 확인된다(08 §3.9.5 `via: choice_commit`). 다이얼 "증명 부담"이 높음이면 결정(Choice)은 확인된 판단만 근거로 쓸 수 있다(V-POL 확장) [제안].
- 승격 뒤 반대 근거가 링크되면 판단은 contested 플래그가 켜지고 Concern이 다시 열린다(08 §3.22.11). 판단 문장을 고치려면 새로 승격하고 이전 판단을 대체한다(덮어쓰지 않음, 원전 통치 불변 7).

### 3.10 쓰기 시점 참조 제약 [결정: 관계의 존재(v0.3 02 §1.2) / 제안: 집행]

v0.2 관계식을 레코드가 쓰이는 순간의 참조 조건으로 바꾼 것(대화 X3-8-08, 감사 §3.5)은 08 §3.20.2의 R-01~R-55이다. 커널은 이 표를 그대로 집행한다. 이 절은 집행 방식과 08 표의 갈래를 커널 코드로 옮기는 규칙만 정한다.

| 관계 | 08 제약 | 커널 집행 지점 | 명령 |
|---|---|---|---|
| E justifies N | R-15: Choice는 근거 E 레코드(`ob`, `in`, `ps`, `fd`, `as`, `pm`) 1개 이상 | 상자 4c | `choice.commit`, `choice.decide` |
| N authorizes M | R-05: write·send(·mutating execute) 도구 호출의 `started`는 활성 합의 현재 개정판 참조 | 상자 4a(V-POL-02) | `toolcall.intend` |
| M updates E | R-06: 관찰은 runtime·kernel·scheduler·human(인증된 via)만, 출처별 조건 | 상자 3·4c | `toolcall.complete`, `observation.record`, `timer.fire` |
| M fulfills N | R-19: 결과 확인은 사람, 결과 `submitted`, 현재 개정판 | 상자 4a·4c | `result.accept` |
| E reveals N | R-36: 선호 기준 확정은 사람, 지지 반응 관찰 1개 이상 | 상자 4a·4c | `preference.criterion.confirm` |

08 표의 "위반 시" 갈래를 코드로 옮기는 규칙:

- "내용": 참조 없음은 `not_found.record`(근거면 `invalid.evidence_not_found`), 조건 불만족은 해당 `invalid.*`·`policy.*`, 상태 불일치는 `conflict.invalid_transition`.
- "자격": 행위자 조건은 `gate.human_required`(사람에게 물을 수 있을 때) 또는 `denied.capability`.
- "강등": `accepted` + `downgraded.*` (R-07, R-17).
- "충돌": `conflict.version_mismatch`(R-24, R-30).
- "경로": `path.stale_epoch`(R-42, R-43).

08이 정렬 때 더한 R-47~R-55의 집행 명령 [2a단계 정렬]:

| 08 제약 | 내용 (요약) | 명령 |
|---|---|---|
| R-47 | 상황 판정: yes·no 답마다 근거, `mixed_parts`면 `parts` 2개 이상, `computedBy`가 알려진 판정표 | `situation.assess` |
| R-48 | 구조 보류에 `revisit` | `structure.hold` |
| R-49 | 루프 전환의 `restart`·`ruleId = OPEN`·`planDeviation` 조건 | `loop.transition` |
| R-50 | 지속 관찰 정의·판정 | `watch.define`, `watch.judge` |
| R-51 | 범위 줄이기는 활성 합의, 좁힌 범위 ⊆ 현재 개정판 범위 | `agreement.narrow` |
| R-52 | 절차 채택·신뢰 변경은 사람(강등은 채택된 강등 제안도) | `procedure.adopt`, `procedure.set_trust` |
| R-53 | 선호 모델 범위별 필수 필드 | `preference_model.create` |
| R-54 | 되돌릴 지점의 ref가 실재 | `rollback.register` |
| R-55 | 결정 확인은 사람, 대상이 모두 autonomous 결정 | `decision.confirm` |

### 3.11 명령 카탈로그 [제안]

명령 이름은 이 문서가 정본이다(2a단계 판정). 이벤트 이름은 09 §3.4 카탈로그를 따른다. 프로토콜에서 사람 명령은 domain action마다 메서드 하나로 운반하고(19 P-09), 19 메서드와 04 명령 의도가 어느 명령에 대응하는지는 §3.11.11 표가 정본이다. 19 §3.7.1의 "커널 명령" 열은 이 표에 맞춘다.

표 읽는 법:

- **채널**: `H` human_client, `M` model_tool, `X` aux_agent, `R` runtime(오케스트레이터 포함, `declaredBy`), `S` scheduler, `A` adapter.
- **능력**: 필요한 기록 능력과 제안 종류(`propose/possibility` 등). 사람 전용은 `accept` 등과 함께 "사람 전용"을 적는다. 시스템 명령은 `sys:runtime` 등.
- **규칙**: 공통 규칙(V-PATH, V-CH, V-FORM, V-VER, V-CAP, V-STA, V-AUT-01)은 모든 명령에 적용하므로 생략하고, 명령별 규칙만 적는다.
- **이벤트**: 받아들였을 때 커밋되는 이벤트. `+`는 같은 트랜잭션의 파생 이벤트(§3.13 또는 08 상태 기계의 부수 효과).
- **페이로드**: 레코드를 만드는 명령의 페이로드는 08의 `<레코드>Core` 스키마에 새 레코드 ID를 더한 것이다(예: `PossibilityProposePayload = { possibilityId } & PossibilityCore`). 아래 TS 블록은 08 Core에 없는 필드와 레코드를 만들지 않는 명령만 적는다.

#### 3.11.1 공통 타입과 1판 명령 이름 대응

```ts
// @helm/domain
export type LoopId = Static<typeof LoopIdSchema>;      // 08 §3.15. 14 정본 (O, I.fact … S.close)

/** 혼자 정한 결정은 08 §3.4.5 AutonomousDecision을 그대로 쓴다(decisionKind·decisionPointKey 포함, 2a 정렬) */
export type AutonomyMeta = Static<typeof AutonomousDecision>;

/** 근거 참조 입력. 레코드에는 08 EvidenceLink로 저장된다 */
export type EvidenceInput =
  | { readonly kind: 'record'; readonly id: string }   // ob·fd 등 실재해야 함 (없으면 invalid.evidence_not_found)
  | { readonly kind: 'statement'; readonly text: string }; // 서술. 근거로 세지 않음 (강등 대상)
```

1판에서 바뀐 명령 이름(15·16·19가 1판을 참조했다):

| 1판 | 2판 | 이유 |
|---|---|---|
| `authority.grant`, `authority.revoke` | `grant.issue`, `grant.revoke` | 08 Grant 레코드 |
| `agreement.accept` | `agreement.confirm` | 08 이벤트 `agreement.confirmed`, 04·19 의도 이름 |
| `agreement.cancel` | `agreement.decline`(제안 단계), `agreement.release`(활성 뒤) | 08 상태 `declined`·`released` |
| `agreement.change.propose` | `agreement.request_scope_change` | 08 `agreement.scope_change_requested` |
| `agreement.stop` | `agreement.report_stop` | 08 `agreement.stop_condition_met` |
| `agreement.invoke_emergency` | `agreement.activate`(비상 Grant로) | 08: 비상 합의는 `grantKind: 'emergency'` Grant |
| `agreement.suspend`, `agreement.resume` | `workunit.pause`, `workunit.resume` | 08: 멈춤은 WorkUnit 상태 |
| `workunit.open`, `workunit.complete` | `workunit.propose`, `workunit.conclude` | 08 이벤트 이름 |
| `loop.plan.set` | `loop_plan.record` | 14 |
| `concern.split` 등 구조 명령 | `structure.split`·`merge`·`detach`·`relocate`·`recombine`·`hold`·`close` | 14, 08 StructureChange |
| `concern.close`(reason done/dropped/merged) | `concern.close`(result completed/not_completed) | 14, 08 `completed`·`closed` |
| `probe.start`, `probe.resolve` | `probe.define`, `probe.judge` | 14 |
| `expectation.register` | `expectation.create` | 08 `expectation.created` |
| `prediction.resolve` | `prediction.check` | 08 `prediction.checked` |
| `finding.reject` | `finding.withdraw` | 08 `finding.withdrawn` |
| `finding.contest`, `decision.contest` | `decision.contest`(대상: 08 `ContestableId` 전부) | 08: 이의는 Objection 하나, 사람만 |
| `contest.resolve` | `objection.withdraw`, `objection.dismiss` | 08 `objection.resolved`(withdrawn·dismissed). upheld는 커널 파생 |
| `integration.obligation.*` | `obligation.propose`·`resolve`·`defer`·`transfer`·`waive` | 08 Obligation |
| `result.report_verification` | `result.attest` | 08 Attestation 하나로 |
| `run.interrupt` | `run.end`(outcome interrupted) + 호출별 `toolcall.skip`·`toolcall.interrupt`·`toolcall.report_unknown` | 12 §3.7.3 (2a) |
| `toolcall.outcome_unknown`(명령), `toolcall.resolve_unknown`(2판) | `toolcall.report_unknown`, `toolcall.recover` | 12 (2a) |
| `agreement.decline_draft` | `agreement.discard` | 09 `agreement.discarded` (2a) |
| `boundary.reach`(1판, 12가 씀) | `runtime.boundary`(payload는 14 §3.13.6) | 조정자 지시 (2a) |
| `policy.set`, `policy.retire` | `policy.change.accept`로 합침 (사람이 직접 만든 제안도 PolicyProposal로) | 08 PolicyProposal, 16 |
| `presence.update` | 없음 (presence는 운영 상태, ctx로) | 08 §3.19 끝, 19 `presence.report` |
| `situation.acknowledge` | `brief.acknowledge` | 09 `brief.acknowledged`, 19 |
| `question.seen` | 없음 (열람은 19 `presence.report`의 운영 기록) | 19 §3.7.8 |
| `rework.plan`, `rework.complete` | `workunit.propose`(`reworkOf`), `result.submit` | 11 §3.10.3 |

#### 3.11.2 Project, Goal

```ts
interface GoalProposePayload { goalId: GoalIdT; core: GoalCore; activateNow?: boolean } // activateNow는 사람만 (08 goal.activated)
interface GoalDecisionPayload { goalId: GoalIdT }                                     // activate, achieve, retire
interface GoalRevisionProposePayload { goalId: GoalIdT; changes: Partial<GoalCore>; basis: EvidenceInput[]; reason: string }
interface GoalRevisionDecidePayload { goalId: GoalIdT; edits?: Partial<GoalCore> }      // confirm(수정 확정, 사람 고침 허용) / reject
interface GoalRevisePayload { goalId: GoalIdT; changes: Partial<GoalCore>; reason: string } // 사람 직접 개정
interface GoalStatePayload { goalId: GoalIdT; reason: string; supersededBy?: GoalIdT }
interface GoalAchievementClaimPayload { goalId: GoalIdT; evidence: { successCondition: string; refs: EvidenceInput[] }[] }
```

| 명령 | 채널 | 능력 | 규칙 | 이벤트 | 주요 거부 |
|---|---|---|---|---|---|
| `project.create` | H | accept, 사람 전용 | 08 §3.5.1 | `project.created` | `invalid.schema` |
| `goal.propose` | H, M | propose/goal | `activateNow`는 사람만 | `goal.proposed` (사람 activateNow: `goal.activated`) / 에이전트: + `question.recorded`(종류 goal_revision, 권리) | `denied.capability` |
| `goal.activate` | H | accept, 사람 전용 | R-35 | `goal.activated` (+ 질문 answered) | `gate.human_required` |
| `goal.revision.propose` | H, M, R | propose/goal_revision | 근거 1개 이상, 대기 중 수정안 없음 (08 §3.22.1) | `goal.revision_proposed` + `question.recorded`(goal_revision, 권리, 막지 않음) | `conflict.invalid_transition` |
| `goal.revision.confirm` | H | accept, 사람 전용 | R-35, V-VER-01 | `goal.revised` + 이전 버전에 기댄 합의·선택 `record.staled(goal_revised)` + Concern마다 `obligation.added(goal_revision_check)` + 질문 answered | `conflict.version_mismatch` |
| `goal.revision.reject` | H | accept, 사람 전용 | R-35 | `goal.revision_rejected` | |
| `goal.revise` | H | accept, 사람 전용 | R-35 | `goal.revised` + 위와 같은 파생 | |
| `goal.pause` / `goal.resume` / `goal.supersede` / `goal.retire` | H | accept, 사람 전용 | R-35 | `goal.paused` / `goal.resumed` / `goal.superseded` + `record.superseded` / `goal.retired` | |
| `goal.achievement.claim` | M, H, R | propose/goal | 성공 조건별 근거 1개 이상 | `goal.achievement_claimed` + `question.recorded`(권리 result_review 계열) | `invalid.evidence_not_found` |
| `goal.achievement.confirm` / `goal.achievement.reject` | H | accept, 사람 전용 | R-35, V-DEP-2 | `goal.achieved` / `goal.achievement_rejected` | |

#### 3.11.3 Concern, 구조(S), 루프, 상황, 모드, WorkUnit

```ts
interface ConcernOpenPayload { concernId: ConcernIdT; core: ConcernCore }   // origin, entrySignals 포함 (08 §3.6.1)
interface ConcernReframePayload { concernId: ConcernIdT; title?: string; description: string; basis: EvidenceInput[]; reason: string; autonomy?: AutonomyMeta }
interface ConcernClosePayload { concernId: ConcernIdT; result: 'completed' | 'not_completed'; reason: string; force?: boolean } // force는 사람만
interface ConcernReopenPayload { concernId: ConcernIdT; cause: AnyRecordIdT; toLoop: LoopId; reason: string }
interface StructurePayload {                           // structure.<op>
  structureChangeId: StructureChangeIdT;
  core: StructureChangeCore;                           // op, sourceConcernIds, resultConcernIds, targetGoalId, reason, autonomy (08 §3.6.2)
  newConcerns?: { concernId: ConcernIdT; core: ConcernCore }[];        // split
  boundaryItems?: { boundaryItemId: BoundaryItemIdT; core: Omit<BoundaryItemCore, 'structureChangeId'> }[];
  boundaryChecks?: { boundaryItemId: BoundaryItemIdT; status: 'checked' | 'dropped'; refs: EvidenceInput[] }[]; // recombine
}
interface LoopPlanRecordPayload { loopPlanId: LoopPlanIdT; core: LoopPlanCore }          // 08 §3.15 (autonomy 포함)
interface LoopTransitionPayload { loopTransitionId: LoopTransitionIdT; core: LoopTransitionCore }
interface SituationAssessPayload { assessmentId: AssessmentIdT; core: SituationAssessmentCore } // answers(근거 id) 포함, 14 요구 (4)
interface ModeRoutePayload { modeAssignmentId: ModeAssignmentIdT; core: ModeAssignmentCore }
interface WorkUnitProposePayload { workUnitId: WorkUnitIdT; core: WorkUnitCore }         // intent, expectedOutcome, plannedPrimitives
interface WorkUnitStatePayload { workUnitId: WorkUnitIdT; reason: string; cause?: AnyRecordIdT }
interface WorkUnitConcludePayload { workUnitId: WorkUnitIdT; summary: string; refs: AnyRecordIdT[] }
interface ProbeDefinePayload { probeId: ProbeIdT; core: ProbeCore }
interface ProbeJudgePayload { probeId: ProbeIdT; outcome: 'grown' | 'folded' | 'exhausted'; basis: ObservationIdT[]; autonomy?: AutonomyMeta }
interface WatchDefinePayload { workUnitId: WorkUnitIdT; signals: string[]; windowUntil: Ms; growIf: string; foldIf: string } // A.watch (14)
interface WatchJudgePayload { workUnitId: WorkUnitIdT; outcome: 'grow' | 'fold' | 'continue'; basis: ObservationIdT[]; autonomy?: AutonomyMeta }
```

| 명령 | 채널 | 능력 | 규칙 | 이벤트 | 주요 거부 |
|---|---|---|---|---|---|
| `concern.open` | H, M, R | propose/concern | R-01. 에이전트·런타임이 `promoted_from_work`로 열면 진입 규칙(14 데이터: 신호 수 ≥ 다이얼 문턱)을 코드가 적용. 미달이면 질문 "초점으로 열까요?"(정보 게이트) | `concern.opened` / 미달: needs_gate(`question.recorded`) | `invalid.goal_link`, `gate.human_required` |
| `concern.reframe` | H, M, R | propose/concern | 근거 1개 이상(서술 허용). 같은 트랜잭션에 다시 세운 문제의 선택(`choice.committed`, R-15)을 만들고 Autonomy는 그 선택에 둔다(08 §3.22.2, 08 요구 (4)) | `choice.committed` + `concern.reframed`(`frameChoiceId`) | `invalid.why_not_asked`, `policy.basis_required` |
| `concern.close` | H, R | accept(사람) / propose(S.close, 런타임) | completed: R-34(의존 규칙 2·4). not_completed: 사람은 언제나(`force`면 남은 WorkUnit 취소·반영 항목 기록), 에이전트는 열린 WorkUnit·반영 항목 0 | `concern.completed` / `concern.closed` | `policy.acceptance_required`, `policy.subconcerns_open`, `policy.obligations_open` |
| `concern.reopen` | H, M, R | propose/concern | 원인 참조 실재 (08 §3.22.2) | `concern.reopened` + `loop.transitioned`(kernel) | |
| `structure.split`·`merge`·`detach`·`relocate`·`recombine`·`hold`·`close` | M, R, H | propose/structure_change | R-32(분해 상한, 경계 항목), R-33(재조합), 에이전트면 autonomy | `structure.changed` + split: 하위마다 `concern.opened`, 경계 항목마다 `boundary_item.recorded` / merge: `concern.merged` / hold: `concern.held` / close: `concern.closed` | `policy.structure_cap_exceeded`(gate), `policy.subconcerns_open` |
| `loop_plan.record` | M, R, H | propose/loop_plan | R-29 | `loop_plan.adopted` | |
| `loop.transition` | R, H (M은 1차 런타임에서 도구로 노출하지 않음, 2a 판정 J-65) | propose/loop_transition | R-30(from = 현재 루프), R-49, §3.8 끝 문단. 모델은 선언 도구로 전환 사유를 내고 오케스트레이터가 `declaredBy`와 함께 보낸다(14 ADR-14-11) | `loop.transitioned` (+ 첫 루프 활동이면 `concern.activated`) | `conflict.version_mismatch` |
| `situation.assess` | M, R, H | propose/situation | R-31 | `situation.assessed` (+ 유형이 바뀌면 루프 계획 `record.staled(review_trigger_fired)`) | `invalid.evidence_not_found` |
| `mode.route` | X(router), R, H | propose/mode | R-44, autonomy | `mode.assigned` | `denied.proposal_kind` |
| `workunit.propose` | M, R, H | propose/workunit | R-02 | `workunit.proposed` | |
| `workunit.start` | R | sys:runtime | 08 §3.22.3: 쓰기 없는 탐구는 proposed에서, 그 밖은 delegated에서 | `workunit.started` | `conflict.invalid_transition` |
| `workunit.pause` / `workunit.resume` | H, R | accept(사람) / sys:runtime | 원인 기록 | `workunit.paused` / `workunit.resumed` (+ run 신호) | |
| `workunit.cancel` | H | accept, 사람 전용 | | `workunit.cancelled` + 합의 `agreement.released`, 질문 `question.expired` | |
| `workunit.conclude` | M, R | propose/workunit | `workKind`가 inquiry·probe | `workunit.concluded` (+ `inquiry.stopped` 또는 `probe.concluded`) | `conflict.invalid_transition` |
| `probe.define` | M, R, H | propose/probe | R-39 | `probe.planned` | |
| `probe.judge` | M, R, H | propose/probe | 관찰 1개 이상, 에이전트면 autonomy | `probe.concluded` (+ grown: C.commit 전환 제안, folded: I 전환 제안) | |
| `watch.define` / `watch.judge` | M, R, H | propose/probe | R-50. 08 §3.16.2 Watch(`wt`): 기간·신호 필수 / 판정 `outcome: stable | regressed | inconclusive`, 관찰 1개 이상 또는 사람, 에이전트면 `verdict.autonomy` | `watch.defined` / `watch.judged` | |

#### 3.11.4 이해(E): 관찰, 추측, 구분 확인, 판단, 전제, 예측, 기대, 선호

```ts
interface ObservationRecordPayload { observationId: ObservationIdT; core: ObservationCore } // human·external·watcher 출처만 (tool은 toolcall.complete)
interface ObservationAnnotatePayload { observationId: ObservationIdT; annotation: Omit<Annotation, 'by' | 'seq'> }
interface InterpretationProposePayload { interpretationId: InterpretationIdT; core: InterpretationCore } // basis 0개면 전제로 강등 (R-07)
interface PossibilityProposePayload { possibilityId: PossibilityIdT; core: PossibilityCore }
interface ClaimLinkEvidencePayload {
  claimId: InterpretationIdT | PossibilityIdT | FindingIdT; target: ObservationIdT | FindingIdT;
  relation: 'supports' | 'challenges' | 'qualifies' | 'invalidates';
  directness: 'direct' | 'indirect'; coverage: 'full' | 'partial'; note: string | null;
}
interface ClaimCounterSearchPayload { claimId: InterpretationIdT | PossibilityIdT | FindingIdT; description: string; observations: ObservationIdT[]; found: ObservationIdT[] }
interface ClaimResolveCounterPayload { claimId: InterpretationIdT | PossibilityIdT | FindingIdT; target: ObservationIdT; resolution: Omit<CounterResolution, 'by' | 'seq'> }
interface ClaimDeclareDiscriminationPayload { checkId: CheckIdT; core: DiscriminatingCheckCore }        // 관찰 전에 선언
interface ClaimBindDiscriminationPayload { checkId: CheckIdT; observationIds: ObservationIdT[]; outcome: string } // 결과 라벨 분류
// FindingPromotePayload: §3.9.3
interface FindingDecidePayload { findingId: FindingIdT; reason?: string }                 // confirm / withdraw
interface AssumptionRecordPayload { assumptionId: AssumptionIdT; core: AssumptionCore }    // origin declared (question은 커널이 만듦)
interface AssumptionDecidePayload { assumptionId: AssumptionIdT; refs: EvidenceInput[]; note?: string } // confirm / invalidate / retire
interface OpenQuestionRecordPayload { openQuestionId: OpenQuestionIdT; core: OpenQuestionCore }
interface PredictionProposePayload { predictionId: PredictionIdT; core: PredictionCore }
interface PredictionCheckPayload { predictionId: PredictionIdT; result: 'held' | 'failed' | 'partial' | 'indeterminate'; observations: ObservationIdT[] }
interface ExpectationCreatePayload { expectationId: ExpectationIdT; core: ExpectationCore } // dueAt 기본 72시간 (08 §5.2 요구 (3)) [제안]
interface ExpectationFulfillPayload { expectationId: ExpectationIdT; observationId: ObservationIdT }
interface PreferenceCriterionProposePayload { possibilityId: PossibilityIdT; core: PossibilityCore & { possibilityKind: 'preference_criterion' }; reactionRefs: ObservationIdT[] }
interface PreferenceCriterionDecidePayload { preferenceModelId: PreferenceModelIdT; possibilityId: PossibilityIdT; criterionKey: string; weight?: Grade }
interface StimulusCreatePayload { stimulusId: StimulusIdT; core: StimulusCore }
```

| 명령 | 채널 | 능력 | 규칙 | 이벤트 | 주요 거부 |
|---|---|---|---|---|---|
| `observation.record` | H(발화·반응), A(외부), R(감시) | observe | R-06, R-38(반응), 출처 종류와 채널 일치 | `observation.recorded` (+ 출처 watcher면 낡음 전파 §3.13, 외부 응답이 기대를 채우면 `expectation.fulfilled`) | `invalid.observation_source`, `denied.capability`(모델) |
| `observation.annotate` | M, X, H | propose/annotation | 관찰 실재 | `observation.annotated` | |
| `interpretation.propose` | M, H, R | propose/interpretation | R-07 | `interpretation.proposed` 또는 강등: `assumption.recorded`(origin downgraded_interpretation) + `downgraded.interpretation_to_assumption` | |
| `interpretation.retract` | M, H | propose/interpretation | 제안자 또는 사람 | `interpretation.retracted` | |
| `possibility.propose` | M, X(branch), H, R | propose/possibility | R-08 | `possibility.proposed` | `invalid.evidence_not_found` |
| `possibility.reject` / `possibility.mark_undecidable` / `possibility.withdraw` | M, H | propose/possibility | 08 §3.22.10 (reject는 근거 1개 이상) | `possibility.rejected` / `possibility.marked_undecidable` / `possibility.withdrawn` | |
| `claim.link_evidence` | M(work·verifier), H | propose/counter_evidence(challenges·invalidates) 또는 propose/possibility(supports·qualifies) | R-09. 검증 에이전트는 challenges·invalidates만 (08 proposeKinds) | `claim.evidence_linked` (+ 대상이 판단·accepted 선택의 근거면 contested 플래그, Concern 종료 상태면 `concern.reopened`) | `invalid.evidence_not_found`, `denied.proposal_kind` |
| `claim.record_counter_search` | M, H | propose/counter_evidence | R-10 | `claim.counter_searched` (+ found마다 `claim.evidence_linked(challenges)`) | `invalid.evidence_not_found` |
| `claim.resolve_counter` | M, H | propose/promotion | R-11 (에이전트는 refs 1개 이상) | `claim.counter_resolved` | |
| `claim.declare_discrimination` | M, X(verifier), H | propose/check | R-12 | `check.declared` | `invalid.check_not_discriminating` |
| `claim.bind_discrimination` | M, X(verifier), H | propose/check | R-13(확인) | `check.observed` (+ 커널이 `verdicts` 계산, 어느 예측에도 없는 라벨이면 관찰에 surprise 주석) | `conflict.invalid_transition` |
| `finding.promote` | M, H, R | propose/promotion | V-DEP-3, V-PRO-01·02 (R-13) | `finding.promoted`(kernel) (+ usage decision: `question.recorded` 종류 finding_confirm) | `policy.promotion_requirements` |
| `finding.confirm` | H | accept, 사람 전용 | R-14 | `finding.confirmed` | `gate.human_required` |
| `finding.withdraw` | H | accept, 사람 전용 | 08 §3.22.11 | `finding.withdrawn` + 의존 선택 낡음 전파 | |
| `assumption.record` | M, H, R | propose/assumption | | `assumption.recorded` | |
| `assumption.confirm` / `assumption.invalidate` / `assumption.retire` | M, H | propose/assumption | 근거 refs 또는 사람 | `assumption.confirmed` / `assumption.invalidated`(+ 낡음 전파) / `assumption.retired` | |
| `open_question.record` / `open_question.resolve` / `open_question.drop` | M, H, R | propose/open_question | resolve는 refs 1개 이상 | `open_question.recorded` / `open_question.resolved` / `open_question.dropped` | |
| `prediction.propose` | M, H, R | propose/prediction | R-27 | `prediction.recorded` + 지시 `timer.schedule` | |
| `prediction.check` | M, H, R | propose/prediction | R-28. 결과 이름은 08(`held`·`failed`·`partial`·`indeterminate`, 2a 판정 J-29) | `prediction.checked` (+ failed면 관찰 surprise 주석, 근거로 쓴 선택 `record.staled(review_trigger_fired)`) | |
| `prediction.void` | M, H | propose/prediction | 이유 | `prediction.voided` | |
| `expectation.create` | M, R | propose/expectation | R-26 | `expectation.created` + 지시 `timer.schedule` | |
| `expectation.fulfill` | R, A | sys:runtime | 같은 트랜잭션의 외부 응답 관찰 | `expectation.fulfilled` (늦으면 `late_fulfilled` 상태) + `timer.cancel` | |
| `expectation.cancel` | M, H | propose/expectation | | `expectation.cancelled` | |
| `preference.criterion.propose` | M | propose/possibility | R-08 + 반응 관찰 1개 이상(E reveals N의 후보 쪽) | `possibility.proposed`(kind preference_criterion) (+ 15가 정한 조건이면 `question.recorded` 종류 criterion_confirm) | `invalid.evidence_not_found` |
| `preference.criterion.confirm` / `preference.criterion.reject` | H | accept, 사람 전용 | R-36 | `preference.criterion_confirmed` / `possibility.rejected` | `gate.human_required` |
| `stimulus.create` / `stimulus.present` / `stimulus.withdraw` | M, X(branch), R | propose/stimulus | R-37 | `stimulus.created` / `stimulus.presented` / `stimulus.withdrawn` | |
| `inquiry.*`, `preference_model.*`, `lens.add` | 15 정의 | propose/inquiry 등 | 15 | 08 §3.22.15 | |

관찰 생성 주체: 모델은 `observation.record`를 쓸 수 없다(08 R-06, 능력표의 work 에이전트 observe는 런타임이 도구 결과를 기록할 때 출처가 되는 것). 도구 결과 관찰은 `toolcall.complete`가 만든다.

#### 3.11.5 선택, 혼자 정한 결정, 확인, 이의

```ts
interface ChoiceCommitPayload {          // 사람
  choiceId: ChoiceIdT; core: Omit<ChoiceCommon, 'choiceKind'> & { gate: 'rights' | 'information' };
  viaQuestion?: QuestionIdT;
}
interface ChoiceDecidePayload {          // 에이전트. 커널이 11의 게이트 판정을 돌린다
  choiceId: ChoiceIdT; core: Omit<ChoiceCommon, 'choiceKind'>;
  decisionPoint: DecisionPoint;          // 11 §3.3.2. 모델이 선언하는 구조화 값
  verification?: { observationIds: ObservationIdT[]; perOption: { label: string; passed: ObservationIdT[]; failed: ObservationIdT[] }[] };
}
interface ChoiceRevokePayload { choiceId: ChoiceIdT; reason: string }
interface DecisionConfirmPayload { targets: AnyRecordIdT[] }               // 혼자 정한 결정 확인 (일괄)
interface DecisionContestPayload {                                          // 이의 = Objection
  objectionId: ObjectionIdT;
  target: ObjectionTarget;                  // 08: { kind: 'record', id: ContestableId, itemKey } | { kind: 'link', from, to, rel } (2a 판정 J-36)
  reason?: string;                          // 선택 입력 (2a 판정 J-20)
  desiredEffect: 'reopen' | 'ask_next_time' | 'note_only';   // 08 (J-53). 되돌리기를 바라면 reopen + 재작업
}
interface ObjectionDecidePayload { objectionId: ObjectionIdT; note?: string } // withdraw / dismiss
```

| 명령 | 채널 | 능력 | 규칙 | 이벤트 | 주요 거부 |
|---|---|---|---|---|---|
| `choice.commit` | H | accept, 사람 전용 | R-15 | `choice.committed`(HumanDecision) (+ 미확인 판단을 근거로 하면 `finding.confirmed(via choice_commit)`, supersedes면 `record.superseded`, 질문에서 왔으면 질문 answered) | `policy.basis_required` |
| `choice.decide` | M, R | propose/choice | R-15, 11 §3.4 판정, V-AUT-01~03 | 11 §3.4 갈래별: 정책·혼자 정하기 → `choice.committed`(AutonomousDecision). 묶음·가정하고 묻기 → `question.recorded` + `assumption.recorded`(origin question). 선택은 아직 만들지 않는다. 답이 오면 사람 `choice.committed`, 만료되면 `question.assumed` + `choice.committed`(assumption_confirmed, 08 R-25). 범위 줄이기·막는 질문·권리 → needs_gate(`command.rejected` + `question.recorded`) | `gate.human_required`, `policy.verification_missing`, `policy.redecide_after_objection` |
| `choice.revoke` | H | accept, 사람 전용 | 08 §3.22.12 | `choice.revoked` + 열린 이의 `objection.resolved(upheld)`, 구현 합의 낡음 전파 | |
| `decision.confirm` | H | accept, 사람 전용 | 대상이 Autonomy 레코드 또는 `activated_by_grant` 합의 | `decision.confirmed` (R-55. 레코드 상태는 바뀌지 않고 `quality.confirmedSeq`만) | `conflict.invalid_transition` |
| `decision.contest` | H | accept, 사람 전용 | R-16 | `objection.filed` + 11 §3.10 파생(영향 표시, Concern 재개, 재작업 요구) | `gate.human_required`(사람 아님), `not_found.record` |
| `objection.withdraw` / `objection.dismiss` | H | accept, 사람 전용 | 08 §3.22.12 | `objection.resolved`(withdrawn / dismissed) | |

추천은 Choice가 아니다(v0.3 02 §2, 원전 P5). 모델의 추천은 질문의 `recommendation`이나 가능성 레코드로 남고 Choice를 만들지 않는다.

#### 3.11.6 Grant와 작업 합의 (C)

```ts
interface GrantIssuePayload { grantId: GrantIdT; core: GrantCore }        // 08 §3.11.2 (standing·emergency)
interface GrantRevokePayload { grantId: GrantIdT; reason: string }
interface AgreementProposePayload {
  agreementId: AgreementIdT; core: AgreementCore;                         // 08 §3.11.1
  checkBack: CheckBack;                                                   // 에이전트의 의도 재진술 (아래)
  activateViaGrant?: GrantIdT;                                            // 권한 이어 쓰기로 바로 활성화
  confirmNow?: boolean;                                                   // 사람이 직접 만들 때
}
interface CheckBack {                   // canon-3 G1, Mission Command 규칙 2. 08에 필드 요구
  understoodPurpose: string; expectedEndState: string; firstSteps: string[];
  willStopWhen: string[]; proceedsAutomatically: string[];
}
interface AgreementRevisePayload { agreementId: AgreementIdT; content: AgreementContent; reason: string }
interface AgreementDecidePayload { agreementId: AgreementIdT; edits?: Partial<AgreementContent> } // confirm(사람 고침 허용)/decline
interface AgreementActivatePayload { agreementId: AgreementIdT; grantId: GrantIdT; autonomy: AutonomyMeta }
interface AgreementScopeChangePayload { agreementId: AgreementIdT; requested: Scope; reason: string; basis: EvidenceInput[] }
interface AgreementRenegotiatePayload { agreementId: AgreementIdT; content: AgreementContent; reason: string; fromQuestion?: QuestionIdT }
interface AgreementNarrowPayload { agreementId: AgreementIdT; narrowed: Scope; reason: string; linkedQuestionId?: QuestionIdT; autonomy: AutonomyMeta } // 11 §3.11
interface AgreementRestorePayload { agreementId: AgreementIdT; reason: string }
interface AgreementReportStopPayload { agreementId: AgreementIdT; stopCondition: string; observations: ObservationIdT[] }
interface AgreementReleasePayload { agreementId: AgreementIdT; reason: string }
```

| 명령 | 채널 | 능력 | 규칙 | 이벤트 | 주요 거부 |
|---|---|---|---|---|---|
| `grant.issue` | H | accept, 사람 전용 | R-41 | `grant.issued` | |
| `grant.revoke` | H | accept, 사람 전용 | R-41 | `grant.revoked` + 이 Grant로 활성화된 진행 중 WorkUnit `workunit.paused(grant_revoked)` | |
| `agreement.propose` | M, R, H | propose/agreement | R-03, check-back 필수(에이전트). `activateViaGrant`면 §3.6.7 (R-04) | `agreement.proposed` + WorkUnit `negotiating` + (a) Grant 통과: `agreement.activated_by_grant`(autonomy within_grant 또는 emergency) (b) 사람 confirmNow: `agreement.confirmed` (c) 그 밖: `question.recorded`(agreement_confirm, 권리) | `invalid.agreement_content`, `gate.grant_insufficient`, `denied.grant_not_applicable` |
| `agreement.revise` | M, H | propose/agreement | 상태 `proposed` | `agreement.revised` + 질문 갱신 | `conflict.invalid_transition` |
| `agreement.confirm` | H | accept, 사람 전용 | R-04, V-VER-01 | `agreement.confirmed` (+ 고침이 있으면 먼저 `agreement.revised`) + 질문 answered, 사람 조작 +1 | `conflict.version_mismatch` |
| `agreement.decline` | H | accept, 사람 전용 | 상태 `proposed` | `agreement.declined` + 질문 answered | |
| `agreement.discard` (2판 `agreement.decline_draft`, 같은 명령으로 받음) | M, R, H | propose/agreement 또는 사람 | 상태 `proposed`(확정 전 초안). 에이전트는 자기 제안만 (14 §3.16.4) | `agreement.discarded` | `conflict.invalid_transition` |
| `agreement.activate` | M, R | propose/agreement | §3.6.7 (R-04), autonomy | `agreement.activated_by_grant` | `gate.grant_insufficient` |
| `agreement.request_scope_change` | M, R | propose/agreement_scope_change | 상태 `active`, 대기 중 요청 없음. 좁히기만이면 `agreement.narrow` 안내 | `agreement.scope_change_requested` + `question.recorded`(scope_change, 권리 authority_expansion) | |
| `agreement.renegotiate` | H | accept, 사람 전용 | 상태 `active` | `agreement.renegotiated`(revision+1) + 이전 개정판 기준 결과 제출 `record.staled(agreement_renegotiated)` + 실행 컨텍스트 갱신 지시 | |
| `agreement.narrow` | M, R | propose/agreement_scope_change | 좁힌 범위 ⊆ 현재 유효 범위, autonomy (11 §3.11) | `agreement.narrowed` (R-51, `narrowedScope.autonomy`) | `gate.scope_expansion_required` |
| `agreement.restore` | M, R, H | propose/agreement_scope_change | 11 §3.11 규칙 3 | `agreement.restored` | `conflict.invalid_transition` |
| `agreement.report_stop` | M, R | propose/agreement | 멈출 조건 문구가 합의에 있음 | `agreement.stop_condition_met` + `workunit.paused(stop_condition)` + `question.recorded`(stop_condition) | |
| `agreement.release` | H | accept, 사람 전용 | 상태 `active`·`proposed` | `agreement.released` (+ WorkUnit 취소 또는 대체 안내) | |

비상 합의: 사람이 평상시에 `grant.issue`(grantKind emergency, appliesTo.situation chaotic, agreementKinds emergency)로 미리 맡겨 둔다. 혼돈 상황에서 에이전트는 `agreement.propose`(agreementKind emergency) + `activateViaGrant`로 사람 조작 없이 활성화한다. 활성화는 혼자 정한 결정(`whyNotAsked.kind = 'emergency'`)이며, 같은 트랜잭션에 반영 항목(사후 검토, 종류 other)이 생겨 사람이 확인하기 전까지 Concern이 완료되지 않는다(v0.3 03 §3.3).

#### 3.11.7 실행과 도구 호출 (M)

12 §5.2의 요구대로 정의한다.

```ts
interface RunStartPayload { runId: RunIdT; core?: RunCore; attempt: number; ownerEpoch: string }  // 08 §3.18. 재시작이면 core 없이 같은 runId, attempt+1 (12)
interface RunEndPayload {                                                                 // 12 RunEndPayload
  runId: RunIdT;
  outcome: 'ended' | 'interrupted';                    // interrupted: 부팅 복구로 비종결 정지 (12 §3.7.3)
  reason: RunEndReason;                                // 08 §3.18.1 종료 이유
  code?: string; note?: string; usage?: Usage; previousEpoch?: string;
}
interface RunAwaitPayload { runId: RunIdT; kind: 'question' | 'recovery'; ref: QuestionIdT | ToolCallIdT }
interface RunResumePayload { runId: RunIdT; attempt: number }
interface ToolCallIntendPayload {
  toolCallId: ToolCallIdT; core: ToolCallCore;          // 08 §3.18: runId, providerCallId, toolName, primitive, args(blob), argsHash, fingerprint, replay, cancellation, agreementRef, parentToolCallId
  permission: PermissionInput;                          // §3.6.5
  purpose?: 'work' | 'counter_search' | 'verification' | 'stimulus' | 'rollback';   // rollback: 11 §3.12
  approvalQuestionId?: QuestionIdT;                     // 권리 게이트 승인 대조 (11 §3.14)
}
interface ToolCallCompletePayload {
  toolCallId: ToolCallIdT;
  outcome: 'completed' | 'uncertain';                   // uncertain: 외부 결과 불확실 (08 outcome_uncertain)
  observation: { observationId: ObservationIdT; core: ObservationCore };   // obsKind tool_result 또는 tool_interrupted(outcome_uncertain)
  observedChanges?: { target: TargetRef; beforeHash: string | null; afterHash: string | null }[]; // 사후 범위 검사
  durationMs: number;
  recovered?: 'hash_verified';                          // 12 §3.7.3: 해시 guard로 적용이 증명된 결과 없는 의도를 런타임이 닫을 때
}
interface ToolCallInterruptPayload { toolCallId: ToolCallIdT; reason: 'cancel' | 'steering'; observation: { observationId: ObservationIdT; core: ObservationCore } }
interface ToolCallNotExecutedPayload { toolCallId: ToolCallIdT; reason: 'restart' | 'cancel' | 'steering' | 'superseded' }   // 08 notExecuted
interface ToolCallReportUnknownPayload {                                                  // 12 §3.7.3의 toolcall.outcome_unknown
  toolCallId: ToolCallIdT; reason: 'shutdown' | 'crash' | 'tool_uncertain';
  detectedChanges: ChangeSet | 'not_measurable';      // 13 §3.5.4
  externalEffect: boolean;                            // send 또는 네트워크·외부 효과 선언 (J-05). 런타임이 원시 행동과 도구 선언에서 계산
  observation: { observationId: ObservationIdT; core: ObservationCore };
}
interface ToolCallRecoverPayload { toolCallId: ToolCallIdT; resolution: 'confirmed_applied' | 'confirmed_not_applied' | 'manual_review'; evidence: ObservationIdT[] }
interface RuntimeBoundaryPayload {                    // 14 §3.13.6 BoundaryReached. 경계 일곱 값 (2a 판정 J-63)
  kind: 'round_end' | 'workunit_end' | 'loop_transition' | 'concern_waiting' | 'user_return' | 'review_window' | 'daily_rollover';
  concernId?: ConcernIdT;                              // Concern 단위 경계. user_return·review_window·daily_rollover는 전역
  atMs: Ms;
  workUnitId?: WorkUnitIdT; ref?: AnyRecordIdT;
} // 09 boundary.reached (09 enum을 이 일곱 값으로 맞추는 것은 J-63)
interface PresenceUpdatePayload { deviceId: DeviceIdT; state: 'online' | 'idle' | 'away' }   // 09 presence.changed. 데몬이 연결·19 presence.report를 모아 상태가 바뀔 때만
interface MaterialChangePayload { observationId: ObservationIdT; core: ObservationCore & { obsKind: 'material_change' } }
// RollbackRegisterPayload: 11 §3.12
```

| 명령 | 채널 | 능력 | 규칙 | 이벤트 | 주요 거부 |
|---|---|---|---|---|---|
| `run.queue` | R | sys:runtime | R-43 준비 조건 | `run.queued` | |
| `run.start` | R | sys:runtime | R-42. 새 run이면 `core` 필수. 상태 `interrupted`인 run은 같은 runId·`attempt = 이전 + 1`로 다시 시작할 수 있다(12 요구 (1)) | `run.started`(attempt, ownerEpoch) | `path.stale_epoch`, `conflict.invalid_transition` |
| `run.await` | R | sys:runtime | 질문(`needs_gate`, 막힘) 또는 결과 불명 해소 대기 | `run.awaiting` | |

(표 계속) 사람 대기 뒤 이어가기는 12 방식이다(2a 판정 J-38): 답이나 복구 기록이 커밋되면 런타임은 기다리던 run을 `run.end(reason handed_off)`로 닫고 같은 thread에서 새 run을 `run.queue`·`run.start`로 연다. `run.resume` 명령은 두지 않는다. 부팅 때 `awaiting_*` run은 그대로 둔다(J-39, 늦은 답 수용).

| 명령 | 채널 | 능력 | 규칙 | 이벤트 | 주요 거부 |
|---|---|---|---|---|---|
| `run.end` | R | sys:runtime | 08 §3.22.13. `outcome: interrupted`는 부팅 복구(12 §3.7.3)에서만, 실행의 epoch < 현재 epoch | `run.ended`(reason) / `run.interrupted`(previousEpoch, statusBefore) | |
| `run.record_message` | R | sys:runtime | 실행 `running`·`stopping` | `run.message_recorded` (+ 사람 입력이면 `observation.recorded`(utterance), 08 §3.18.2) | |
| `run.record_context` | R | sys:runtime | 같음 | `run.context_projected` (A11, 12 §3.5.6) | |
| `toolcall.intend` | R, A | sys:runtime (행위자 검사는 `runId`의 역할로 V-CAP-03) | V-FORM-08, V-CAP-03, V-POL-02~05, V-DEP-1, R-05, R-43, V-AS-02·03(11) | 허용: `toolcall.requested` + `toolcall.started`(실행 의도, `enforcement`, 임시 가정 목록). 승인된 호출은 같은 `toolCallId`로 다시 내고(상태 `requested`, `toolcall.approved` 뒤) `toolcall.started` + `approval.consumed`(2a 판정 J-40). 제안 도구(원시 행동 없음)는 `requested`·`started`·`completed`를 한 트랜잭션에 남기고 관찰을 만들지 않는다(J-43). 거부: `toolcall.requested` + `toolcall.blocked`. 범위 밖: + `workunit.scope_exceeded` + `question.recorded`(scope_change). 권리: `toolcall.requested` + `toolcall.approval_requested` + `question.recorded`(send_approval) | `denied.agreement_required`, `gate.scope_expansion_required`, `policy.forbidden_resource`, `gate.approval_required`, `gate.approval_mismatch`, `policy.rollback_point_required`, `policy.irreversible_under_assumption`, `policy.budget_exhausted` |
| `toolcall.complete` | R, A | sys:runtime | 08 R-06(도구 호출이 `started`·`replaying`이고 결과 관찰 없음. `recovered: hash_verified`면 `interrupted`도 허용, 12 요구 (3)), 사후 범위 검사(`observedChanges` ⊆ 범위) | `toolcall.completed` + `observation.recorded`(tool_result). `outcome: uncertain`이면 `toolcall.report_unknown`과 같은 처리. 범위 밖 변경: + `agreement.violation_detected` + `workunit.paused(violation)` + 질문(`scope_violation`) | `conflict.invalid_transition` |
| `toolcall.report_unknown` | R | sys:runtime | 상태 `started`·`replaying` (12 §3.7.3) | 08 §3.22.14의 구분을 따른다(2a 판정 J-44, J-05): `externalEffect = true`(send, 네트워크 등 외부 효과가 있을 수 있음)면 `toolcall.outcome_uncertain` + 관찰(tool_interrupted) + `run.awaiting(recovery)` + `question.recorded`(종류 `recovery`, 권리 게이트, `blocks: workunit`). 아니면 `toolcall.interrupted` + 관찰(tool_interrupted)만 남기고 질문을 만들지 않는다. 모델이 상태를 읽어 확인한다 | `conflict.invalid_transition` |
| `toolcall.skip` | R | sys:runtime | 상태 `requested`(실행 전) | `toolcall.not_executed`(reason) | |
| `toolcall.interrupt` | R | sys:runtime | 상태 `started` | `toolcall.interrupted` + `observation.recorded`(tool_interrupted) | |
| `toolcall.recover` | H, R | accept(사람) / sys:runtime(증거 관찰이 있을 때) | 상태 `interrupted`·`outcome_uncertain`. 사람은 `recovery` 질문의 답으로, 런타임은 증거 관찰로 | `toolcall.recovered` (+ 질문 answered, 재개 지시) | `conflict.already_resolved` |
| `rollback.register` | R | sys:runtime | 11 §3.12, R-54. 데몬이 직접 만든 지점(13 §3.7.8)만. 같은 WorkUnit의 합의가 활성 | `rollback_point.registered` | `conflict.invalid_transition` |
| `runtime.boundary` | R | sys:runtime | Concern·WorkUnit 실재. 경계 종류는 일곱 값(J-63). 스케줄러(14)가 낸다 | `boundary.reached` (+ 예약 질문 전달 지시, 경계형 만료 판정, 11 §3.5.3) | |
| `presence.update` | R | sys:runtime | 같은 기기의 직전 상태와 다를 때만(같으면 `notice.timer_noop`과 같은 무시) | `presence.changed`(state, previous) (+ away → online이면 복귀 발화, 11 §3.8) | |
| `material.change.observe` | R | sys:runtime | R-06(watcher) | `observation.recorded`(material_change) + 낡음 전파(§3.13) | |

- **의도 → 실행 → 결과**: 모든 도구 호출은 `toolcall.started`가 커밋된 다음에 실행된다(08 R-05, 브리프 결정 30). 읽기 호출도 같다. 08 R-06이 도구 결과 관찰에 `started` 상태를 요구하기 때문이다. 예외는 08 §3.18.2의 읽기 빠른 경로다: `primitive = read`이고 대상이 정해진 호출은 `toolcall.intend`가 결과와 함께 와서 `requested`·`started`·`completed`와 결과 관찰을 한 트랜잭션에 남길 수 있다(12 §3.4, 2a단계에서 08에 맞춤). 쓰기·보내기·실행에는 쓰지 않는다(§7 K-3).
- **임시 가정 표시**: 커널은 `toolcall.started`에 그 WorkUnit에서 활성인 질문 전제(`as`, origin question) 목록을 넣는다. 모델이 선언하지 않는다. 이의·재작업 영향 계산(§3.13.3)이 이 목록을 쓴다.

#### 3.11.8 결과 제출, 결과 확인, 전체 반영 (A)

```ts
interface ResultSubmitPayload {
  resultId: ResultIdT;
  core: Omit<ResultSubmissionCore, 'criteriaResults'> & {
    criteriaResults: { criterionId: CriterionIdT; status: 'met' | 'unmet' | 'unverified'; evidence: EvidenceInput[]; note: string | null }[];
  };
  integrationCandidates: { obligationId: ObligationIdT; kind: ObligationKind; description: string; targetRefs: AnyRecordIdT[] }[];
}
interface ResultAttestPayload { attestationId: AttestationIdT; core: AttestationCore }    // 08 §3.12
interface ResultAcceptPayload {                          // 사람. 결과 확인 다섯 결정
  acceptanceId: AcceptanceIdT;
  decision: 'accept' | 'accept_with_conditions' | 'request_changes' | 'reject' | 'criteria_wrong';  // 명령 값. 기록 값은 08 AcceptanceDecision
  // (accepted | conditional | revision_requested | rejected | criteria_wrong). 대응은 08 §10 (2a 판정 J-35)
  core: Omit<AcceptanceCore, 'decision'>;                // conditions, criteriaReview, reopenTo(거절·기준이 틀림이면, 기본 직전 I, 14 U-26)
  deferObligations?: { obligationId: ObligationIdT; reason: string; revisitTrigger: Trigger }[];
  bundledAnswers?: { questionId: QuestionIdT; answer: AnswerValue }[];   // 결과 확인과 함께 답한 질문 (11 §3.15)
}
interface ObligationProposePayload { obligationId: ObligationIdT; core: ObligationCore }
interface ObligationResolvePayload { obligationId: ObligationIdT; refs: EvidenceInput[]; note?: string }
interface ObligationDeferPayload { obligationId: ObligationIdT; reason: string; revisitTrigger: Trigger }
interface ObligationTransferPayload { obligationId: ObligationIdT; to: ConcernIdT | WorkUnitIdT; reason: string }
interface ObligationWaivePayload { obligationId: ObligationIdT; reason: string }
interface ReflectionRecordPayload { reflectionId: ReflectionIdT; core: ReflectionCore }
```

| 명령 | 채널 | 능력 | 규칙 | 이벤트 | 주요 거부 |
|---|---|---|---|---|---|
| `result.submit` | M, R | propose/result | R-17: WorkUnit `in_progress`, 합의 `active` 현재 개정판, 기준 id 집합 일치, 근거 관찰 실재. 서술뿐인 `met`은 `unverified`로 강등 | `result.submitted` + WorkUnit `submitted` + `question.recorded`(result_review, 권리) (+ 다이얼 독립 검증: 지시 `agent.request(verifier)`) + 좁힌 범위였으면 `limitations`에 자동 문장(11 §3.11) | `policy.criteria_incomplete`, `conflict.agreement_revision_stale`, `invalid.evidence_not_found` |
| `result.attest` | X(verifier), M(verifier), H | attest | R-18 | `attestation.recorded` (+ challenges면 결과 확인 질문에 연결) | `denied.producer_cannot_attest` |
| `result.accept` | H | accept, 사람 전용 | R-19, V-VER-01, 독립 검증 다이얼이 켜졌으면 증언 존재 | `acceptance.recorded` + 08 §3.22.3·§3.22.5 효과: accepted·conditional → `integration.opened` + `obligation.added`(§3.13 R-1) + `agreement.fulfilled` (+ 항목 0이면 `integration.completed`) / revision_requested → WorkUnit `in_progress` / rejected·criteria_wrong → WorkUnit `rejected`, `agreement.released`, `concern.reopened`(reopenTo C 또는 I). 묶인 답은 각 질문 answered. 미룸 목록은 `obligation.deferred` | `gate.human_required`, `conflict.invalid_transition` |
| `obligation.propose` | M, R | propose/obligation | 통합 `open` 또는 Concern 직접 | `obligation.added` | |
| `obligation.resolve` | M, R(propose), H(integrate) | propose/obligation 또는 integrate | R-21: `docs_tests`·`boundary_check`·`recombine`은 근거 관찰 1개 이상이면 커널이 닫음. `broken_premise`·`concern_conflict`·`acceptance_condition`·`goal_revision_check`는 사람만 | `obligation.resolved`(행위자 kernel 또는 human) (+ 마지막이면 `integration.completed`, WorkUnit `integrated`) | `gate.human_required`, `invalid.evidence_not_found` |
| `obligation.defer` | M, R, H | propose/obligation | 이유와 다시 보일 조건 (08 §3.12 규칙 6: 에이전트도 제안 가능, 복귀 요약 맨 위) | `obligation.deferred` | |
| `obligation.transfer` | M, R, H | propose/obligation | 대상 현재 | `obligation.transferred` + 대상 쪽 `obligation.added` | |
| `obligation.waive` | H | accept, 사람 전용 | R-21 | `obligation.waived` | |
| `obligation.reopen` | H | accept, 사람 전용 | 상태 `deferred`·`transferred`(에이전트가 미루거나 넘긴 것을 사람이 되돌림, 11 §3.9.1) | `obligation.reopened` | `conflict.invalid_transition` |
| `reflection.record` | H, M, R | propose/reflection | | `reflection.recorded` | |

미룸의 사람 조작: 결과 확인과 함께 미루면(`deferObligations`) 사람 조작이 늘지 않는다. 결과 확인 뒤 에이전트가 미루면 미룬 사실과 이유가 복귀 요약 맨 위에 남는다(08 §3.12 규칙 5·6, 대화 X3-2-14). 14 §5.2 요구 (5)는 미룸을 사람 답으로만 하자고 했으나 08과 맞춰 에이전트 제안을 허용하고 표시로 보완한다 [제안].

#### 3.11.9 질문 (상세는 11)

| 명령 | 채널 | 능력 | 이벤트 | 정의 |
|---|---|---|---|---|
| `question.raise` | M, X(verifier), R | propose/question | 11 §3.4 판정 갈래별 (`question.recorded`, 같은 `dedupeKey`면 `question.updated`, 전달 이벤트, 전제) | 11 §3.2, §3.4, §3.5 |
| `question.answer` | H | accept, 사람 전용 | `question.answered` + 종류별 효과(08 §3.22.7) + 가정 비교 (+ 권리 승인이면 `toolcall.approved`·`approval.issued`) | 11 §3.6.4, §3.14 |
| `question.defer` | H | accept, 사람 전용 | `question.deferred`(until: Trigger) | 11 §3.18 (19 `question.defer`) |
| `question.delegate` | H | accept, 사람 전용 | `question.delegated` (정보 게이트만, 상태 delegated) | 11 §3.2.3 (19 `question.delegate`) |
| `question.request_reframe` | H | accept, 사람 전용 | `question.reframe_requested` | 11 §3.2.3 (19 `question.requestReframe`) |
| `question.escalate` | H | accept, 사람 전용 | `question.escalated(cause human)` + 전달 지시 ("지금 보기") | 11 §3.18 |
| `question.mark_seen` | H | observe | `question.seen` (revisionSeq를 올리지 않음) | 11 §3.17 |
| `question.withdraw` | M, R, H | propose/question 또는 사람 | `question.withdrawn` | 11 §3.17 |
| `question.mark_delivered` | R | sys:runtime | `question.delivered`(deliveryId, channel, surface[], category, urgency interrupt·notice·digest, 문구 키, target, deviceIds; 2a 판정 J-52) | 11 §3.5.3·§3.5.6 (09: 전달 기록 행위자는 runtime) |
| `delivery.plan` | X(mediator), R | propose/delivery_plan / sys:runtime(대기 초과) | `delivery.planned`(묶음) + 질문별 `question.delivery_planned`(Autonomy 포함) | 11 §3.7 |
| `autonomous.mark_seen` | H | observe | `autonomous.seen`(upToSeq, targets) | 11 §3.9.3 (19 `autonomous.markSeen`) |
| `brief.acknowledge` | H | accept, 사람 전용 | `brief.acknowledged` (사람이 이해했다고 표시한 seq) | 11 §3.8 |
| `brief.correct` | H | accept, 사람 전용 | `brief.corrected` | 04 복귀 요약 줄 정정 (`brief.correct`) |
| (재작업) | M, R | propose/workunit | 별도 명령 없음. `workunit.propose`에 `reworkOf`(08 §3.7)를 넣어 `workunit.proposed`, 끝은 보통의 `result.submit` | 11 §3.10.3 |

#### 3.11.10 시간, 다이얼, 정책 제안, 관찰 에이전트, 가져오기

```ts
interface TimerFirePayload { timerId: string; purpose: TimerPurpose; subject: AnyRecordIdT; dueAt: Ms }
type TimerPurpose =                                   // 09 §3.11.3 p_timers kind와 같은 이름 (2a)
  | 'question_delivery' | 'question_escalation' | 'question_expiry' | 'rights_deadline' | 'approval_expiry'
  | 'expectation_deadline' | 'prediction_check' | 'agreement_expiry' | 'authority_expiry'
  | 'watch_window' | 'hold_revisit' | 'obligation_revisit' | 'review_trigger' | 'proposal_reopen' | 'device_expiry';
// mediator_timeout은 레코드 필드가 아니라 런타임 일정이다(12 runtime_timers). 발화하면 런타임이 delivery.plan 대기 초과·runtime.boundary(daily_rollover·review_window)로 제출한다
interface DialSetPayload { dial: string; scope: DialScope; value: unknown }   // 14 정본
interface DialUnsetPayload { dial: string; scope: DialScope }
interface PolicyChangeProposePayload { policyProposalId: PolicyProposalIdT; core: PolicyProposalCore; draft?: ProposalDraft } // 16 §3.15.1
interface PolicyChangeDecidePayload { policyProposalId: PolicyProposalIdT; edits?: unknown; reason?: string; scope?: 'this' | 'family_forever' }   // 2a 판정 J-75 // accept(고친 채택 포함)/reject
interface PolicyChangeDeferPayload { policyProposalId: PolicyProposalIdT; until: Ms }   // 09 policy_proposal.deferred{until: Ms}
interface ObserverReportPayload { reportId: string; window: { fromSeq: Seq; toSeq: Seq }; metrics: Record<string, number>; refs: string[] } // 16 요구 (2)
```

| 명령 | 채널 | 능력 | 규칙 | 이벤트 | 주요 거부 |
|---|---|---|---|---|---|
| `timer.fire` | S | sys:scheduler | 대상이 그 타이머를 기다리는 상태인지. 아니면 받아들이고 `notice.timer_noop` | 목적별(09 §3.11.3 표): `question_delivery` → 전달 지시(기록은 런타임의 `question.mark_delivered`), `question_escalation` → `question.escalated`, `question_expiry` → `question.assumed`(+ 가정 확정 선택), `rights_deadline` → `question.expired`, `approval_expiry` → `approval.expired`, `expectation_deadline` → `expectation.timed_out` + `observation.recorded`(no_response), `prediction_check` → 예측 확인 질문, `agreement_expiry` → `agreement.expired` + `workunit.paused`, `authority_expiry` → `grant.expired`, `watch_window` → `watch.window_closed`, `hold_revisit` → `concern.reopened`, `obligation_revisit` → `obligation.reopened`, `review_trigger` → `record.staled(review_trigger_fired)`, `proposal_reopen` → `policy_proposal.reopened`, `device_expiry` → `device.expired` | |
| `dial.set` / `dial.unset` | H | accept, 사람 전용 | 값이 14 다이얼 정의 범위 안. 질문 다이얼은 11 §3.16. 런타임 자동 상향 행은 두지 않는다(2a 판정 J-66, 진입 문턱은 01의 고정값 2) | `dial.set` / `dial.unset` | `invalid.schema` |
| `policy.change.propose` | X(observer), H | propose/policy_proposal | R-40, V-POL-01(금지 패치) | `policy_proposal.submitted` + `question.recorded`(권리 policy_change, 막지 않음, 예약 전달) | `policy.proposal_signature_rejected`, `invalid.schema` |
| `procedure.candidate.propose` | X(observer) | propose/procedure_candidate | R-40 | `policy_proposal.submitted`(proposalKind procedure) | |
| `policy.change.accept` | H | accept, 사람 전용 | V-POL-01, 고친 채택이면 `edits` 재검사, 패치의 `from`이 현재 값과 같은지(16 요구 (5)) | `policy_proposal.accepted` (+ 정책 규칙 상태 반영. 파일을 바꾸는 제안(`changes` = procedure·tooling·context, 16 §3.13)이면 같은 트랜잭션에 적용 Concern 파생: `concern.opened`(origin observer, 대상 프로젝트, 제목은 제안 요약) + `policy_proposal.application_opened`. 적용은 일반 C·A를 거친다(16 OB-6, 요구 (6)). 적용 Concern이 닫히면 `policy_proposal.applied`, 버려지면 `application_abandoned`) | `conflict.version_mismatch` |
| `policy.change.reject` / `policy.change.defer` | H | accept, 사람 전용 | 사유·범위(`this` 또는 `family_forever`, J-75) / 다시 볼 시각 | `policy_proposal.dismissed` / `policy_proposal.deferred` | |
| `observer.report.submit` | X(observer, 채널 aux_agent) | observe | 16 §3.15.1 `ObserverSubmission`. `form`별로 이벤트가 다르다(16 요구 (2)): `evidence_update` → `policy_proposal.evidence_updated`, `effect_report` → `policy_proposal.effect_measured`, `withdraw` → `policy_proposal.withdrawn`, `run_started`·`run_finished`·`run_failed`(감독기가 대신 냄) → `observer_run.started`·`completed`·`failed`, `digest`·`evaluation`·`outside_changes`·`baseline`·`correction_signal` → `observer_report.recorded`(측정 범주, 본문 blob) | 각 이벤트 | `invalid.schema`, `not_found.record` |
| `migration.*` | migration | sys:migration | 09 | 09 | |

관찰 에이전트는 기록 능력 observe·propose만 가지며 정책을 직접 바꿀 수 없다. 반복 예외·반복 질문 유형은 정책 수정 제안으로 올라가고 사람이 확인한다. 자동 권한 확대는 하지 않는다(canon-3 MBE-H3, Subsidiarity 규칙 6).

#### 3.11.11 2a단계에서 더한 명령과 외부 이름 대응 [제안, 2a단계 판정 §1]

2a단계 판정은 10을 명령 이름의 정본으로 정하고, 다른 문서가 쓰는 명령 의도·메서드 중 10에 없는 것을 10이 더하게 했다. 이 절이 그 목록이다. 이벤트 이름은 09 §3.4 카탈로그다.

**(1) 더한 명령**

| 명령 | 채널 | 능력 | 규칙 | 이벤트 | 요구한 문서 |
|---|---|---|---|---|---|
| `expectation.revise` | M, H | propose/expectation 또는 사람 | 상태 `open`. 기한을 앞당기는 것만 에이전트 혼자 | `expectation.revised` | 04, 19 |
| `agreement.correct_understanding` | H | accept, 사람 전용 | 합의 `proposed`, 고칠 check-back 부분과 메모(04 "이해가 다름") | `agreement.revised`(checkBack 고침 요청 표시). 에이전트가 이해 문장을 다시 쓰고 확정 전에 다시 보인다 | 19, 04 |
| `structure.request` | H | accept, 사람 전용 | 사람의 구조 요청(분해·병합·보류 등 `op`). 커널은 해당 `structure.*`와 같은 검사를 하고 HumanDecision으로 기록한다 | `structure.changed` | 19, 04 |
| `mode.set` | H | accept, 사람 전용 | 08 ModeAssignment, HumanDecision. 라우터의 지정은 `mode.route` | `mode.assigned` | 04·19 `mode.set` (사람의 모드 지정) |
| `entry.evaluate` | R | sys:runtime | 01 §3.6.3 진입 판정(신호 수 ≥ 고정 문턱 2, J-66). 가벼운 작업으로 두는 판정도 기록 | `entry.evaluated` (+ 열면 `concern.open` 또는 `entry_suggestion` 질문) | 14 |
| `runtime.signal` | R | sys:runtime | 대상 실행 `running`. 신호 `wrap_up`(다음 턴 경계에서 정리하고 정지), `continue`(checkSettle 뒤 한 번 더) | `wrap_up`이면 `run.stopping` + 지시 `run.signal(wrap_up)`. `continue`는 이벤트 없이 지시만 | 14 요구 (5) |
| `concern.update` | H, M, R | accept 또는 propose/concern | 서술·Goal 연결 고치기(08 Concern 필드). Goal을 바꾸면 R-34 | `concern.updated` | 04·19 `concern.revise` |
| `concern.resume` | H, R | accept 또는 propose/structure | 상태 `held`, `revisit` 충족 또는 사람 | `concern.resumed` | 04·19 `concern.resume` |
| `inquiry.open` | R, M | propose/inquiry | 15 §3.3: Concern 열림, 같은 Concern·같은 루프의 열린 탐구 없음 | `inquiry.opened` (발산 강도·신호 포함) | 15 |
| `inquiry.anchor` | R | propose/inquiry | 15 §3.5 앵커링 결과 | `inquiry.anchored` | 15 |
| `inquiry.perspective.add` | R, M, H | propose/inquiry 또는 사람 | 가능성(`possibilityKind = perspective`)이 같은 트랜잭션에 있거나 실재. 사람은 04 "관점 더 보기" | `inquiry.perspective_added` | 15, 04 `inquiry.requestFrame(add)` |
| `inquiry.cell.update` | R, M | propose/inquiry | 칸이 실재. 닫는 갱신만 이벤트를 남긴다 | `inquiry.cell_closed` (열림·진행 표시는 실행 기록) | 15 |
| `inquiry.round.start` / `inquiry.round.close` | R, H | propose/inquiry / 사람(라운드 마치기) | 15 `roundClosable` | `inquiry.round_started` / `inquiry.round_ended` (+ `runtime.boundary(round_end)`과 같은 발화) | 15, 04·19 `stimulusRound.close` |
| `inquiry.stage.complete` | R | propose/inquiry | 15 단계 기록 | `inquiry.stage_completed` | 15 |
| `inquiry.stop` | R, H | propose/inquiry / 사람 | 15 §3.3 멈춤 이유. 사람은 `human_decided`(04 "지금 정하기"는 같은 명령에 `decide_now`, 이어서 런타임이 `choice` 질문을 낸다) | `inquiry.stop_rule_met`(규칙 충족이면) + `inquiry.stopped` | 15, 04·19 `inquiry.stop`·`requestDecision` |
| `possibility.dismiss` / `possibility.merge` / `possibility.pin` / `possibility.unpin` | M, R, H | propose/possibility 또는 사람 | 08 §3.9.3 상태. 병합은 생존 가능성 지정과 링크 `merged_into`. 병합된 가능성에 열린 이의가 있으면 생존 쪽으로 옮겨 다시 연다(15 요구) | `possibility.dismissed` / `possibility.merged` / `possibility.pinned` / `possibility.unpinned` | 15, 04 `inquiry.requestFrame(merge)` |
| `boundary_item.record` / `boundary_item.check` / `boundary_item.drop` | M, R, H | propose/structure_change 또는 사람 | 08 §3.6.3 경계 항목. 확인은 근거 관찰 1개 이상 | `boundary_item.recorded` / `boundary_item.checked` / `boundary_item.dropped` | 14, 08 |
| `lens.add` / `lens.update` / `lens.retire` | H (add는 R도) | 사람 / propose/lens | 15 §3.10 렌즈 필드 | `lens.added` / `lens.updated` / `lens.retired` | 15 |
| `preference_model.create` | M, R | propose/preference_model | R-53 | `preference_model.created` | 15, 08 |
| `preference.criterion.revise` / `preference.criterion.retire` | H | accept, 사람 전용 | 기준이 `confirmed` | `preference.criterion_revised` / `preference.criterion_retired` | 15, 08 |
| `reaction.amend` / `reaction.withdraw` | H | accept, 사람 전용 | 대상 관찰이 `obsKind: reaction`이고 사람이 만든 것 | `observation.annotated`(이유 덧붙임) / `observation.retracted` | 04·19 `reaction.amend`·`withdraw` |
| `check.pin` | H | accept, 사람 전용 | 구분 확인(`dc`)이 `declared` | (09에 요구: `check.pinned`. 그 전까지 실행 기록) | 04·19 `inquiry.pinCheck` |
| `run.steer` | H | accept, 사람 전용 | 실행 `running` | `run.steered` (12가 입력 큐에 넣음) | 04·19 `work.steer` |
| `run.stop` | H | accept, 사람 전용 | 실행 `running`·`awaiting_*` | `run.stopping` + 지시 `run.signal(wrap_up)`(다음 턴 경계에서 정지, 14 요구 (5)) | 04·19 `work.stop` |
| `run.cancel` | H | accept, 사람 전용 | 같음 | `run.stopping` + 지시 `run.signal(abort)`. 런타임이 끝나면 `run.end(reason cancelled)` | 12 요구 (4), 04·19 `work.abort` |
| `runtime.exit_safe_mode` | H(주체 localAdmin 또는 관리 권한 기기) | accept, 사람 전용 | 데몬 모드 `safe_mode`(17) | `daemon.safe_mode_exited` | 12 요구 (4), 19 `daemon.exitSafeMode` |
| `procedure.adopt` / `procedure.set_trust` / `procedure.retire` | H | accept, 사람 전용 | R-52 | `procedure.adopted` / `procedure.trust_changed` / `procedure.retired` | 16, 08 |
| `surprise.report` | H | observe | 측정 범주(도메인 상태 불변) | `surprise.reported` | 16, 19 |
| `resumption_check.open` / `answer` / `score` | R / H / R | sys:runtime / observe / sys:runtime | 측정 범주. "복귀 점검"(2a 판정 J-10) | `resumption_check.opened` / `answered` / `scored` | 16, 19 `probe.answer`·`probe.score` |
| `self_report.submit` | H | observe | 측정 범주 | `self_report.recorded` | 16, 19 |
| `view.record` | R | sys:runtime | 19 `presence.report`의 화면 변화에서 데몬이 만든다 | `view.opened` | 16, 19 |
| `experiment.set_condition` | H | accept, 사람 전용 | 측정 범주 | `experiment.condition_set` | 16 |

측정 범주 명령은 의존 규칙과 쓰기 시점 제약을 거치지 않는다(도메인 레코드를 만들지 않는다). 채널·행위자와 스키마만 검사한다.

`device.*`, `pairing.*`, `setting.change`, `admin.*`는 커널 판정 규칙이 없는 통치 명령이다. 이름은 19 메서드를 snake_case로 옮긴 것(`device.rename`, `device.revoke`, `device.rotate_token`, `device.expire_tokens`, `pairing.create_code`)이고, 의미와 주체 검사는 18·17이 정한다. engine은 채널·주체 검사(§3.3.2) 뒤 해당 이벤트(`device.*`, `pairing.code_*`)를 커널 판정 없이 기록한다 [제안]. `setting.change`(19 `settings.update`, 14 `OrchestrationSettings`·11 §3.16 질문 설정)는 09에 이벤트가 없다(§5.2 09 요구).

**(2) 19 메서드·04 의도 → 10 명령 (정본 대응표)**

| 19 메서드 (= 04 의도) | 10 명령 |
|---|---|
| `question.answer` | `question.answer` |
| `question.proceedWithAssumption` | `question.answer`(`accept_assumption`). 권리 게이트면 `policy.answer_option_not_allowed` |
| `question.requestReframe` | `question.request_reframe` |
| `question.requestInquiry` | `question.answer`(`experiment_first`) |
| `question.delegate` | `question.delegate` |
| `question.defer` | `question.defer` |
| (질문 열람) | `question.mark_seen` |
| `contest.file` | `decision.contest` (대상: 08 `ObjectionTarget`, 레코드 또는 근거 링크·기준 판정 항목) |
| `autonomous.markSeen` | `autonomous.mark_seen` (일괄 "이대로 둔다"는 `decision.confirm`) |
| `reaction.record` / `amend` / `withdraw` | `observation.record`(사람 반응, `reactionTo`) / `reaction.amend` / `reaction.withdraw` |
| `stimulusRound.close` | `inquiry.round.close` |
| `agreement.confirm` / `revise` / `narrow` / `decline` | `agreement.confirm` / `agreement.revise`(활성 뒤는 `agreement.renegotiate`) / `agreement.narrow` / `agreement.decline` |
| `agreement.correctUnderstanding` | `agreement.correct_understanding` |
| `result.accept` / `acceptWithConditions` / `requestRevision` | `result.accept`(명령 값 accept / accept_with_conditions / request_changes, 거절·기준이 틀림 포함. 기록 값 대응은 J-35). 거절이면 `reopenTo` |
| `result.reopen` | `decision.contest`(대상 `rs` 또는 결과 확인 `ac`) |
| `obligation.confirmDone` / `defer` / `transfer` | `obligation.resolve` / `obligation.defer` / `obligation.transfer` |
| `goal.revise` / `confirmRevision` / `rejectRevision` / `confirmAchieved` | `goal.revise` / `goal.revision.confirm` / `goal.revision.reject` / `goal.achievement.confirm` |
| `concern.propose` / `revise` / `hold` / `resume` / `close` | `concern.open` / `concern.update` / `structure.hold` / `concern.resume` / `concern.close` |
| `loop.requestTransition` | `loop.transition` |
| `structure.request` | `structure.request`(사람. 에이전트·런타임은 `structure.split`·`merge`·…) |
| `inquiry.requestFrame` | `inquiry.perspective.add`(add) / `possibility.merge`(merge) |
| `inquiry.proposeCandidate` | `possibility.propose`(사람 작성 추측) |
| `inquiry.markAssumption` | `assumption.record` |
| `inquiry.pinCheck` | `check.pin` |
| `inquiry.requestDecision` | `inquiry.stop`(`decide_now`) |
| `inquiry.stop` | `inquiry.stop` |
| `expectation.revise` | `expectation.revise` |
| `dial.set` / `dial.unset` / `mode.set` | `dial.set` / `dial.unset` / `mode.set` |
| `observerProposal.adopt` / `decline` / `snooze` | `policy.change.accept` / `policy.change.reject` / `policy.change.defer` |
| `work.steer` / `pause` / `resume` / `stop` / `abort` | `run.steer` / `workunit.pause` / `workunit.resume` / `run.stop` / `run.cancel` |
| `work.requestBrief`, `composer.preview` | 커널 명령 아님 (12 투영·해석) |
| `composer.submit` | 커널 명령 아님. 12가 받아 `run.record_message`(+ utterance 관찰)를 런타임 채널로 낸다 |
| `brief.acknowledge` / `correct` | `brief.acknowledge` / `brief.correct` |
| `recovery.resolve` | `toolcall.recover` |
| `daemon.exitSafeMode` | `runtime.exit_safe_mode` |
| `surprise.report` / `probe.answer` / `probe.score` / `selfReport.submit` | `surprise.report` / `resumption_check.answer` / `resumption_check.score` / `self_report.submit` |
| `device.*`, `admin.*` | 통치 명령 (위 (1) 끝 문단) |
| `settings.update` | `setting.change` (위 (1) 끝 문단) |

**(3) 제안 종류(08 §3.3.4, 14 §3.5.3) → 10 명령.** 13의 Helm 제안 도구는 이 표에서 생성한다(도구 이름 = `helm_` + 명령 이름의 점을 밑줄로).

| 제안 종류 | 10 명령 |
|---|---|
| `situation_summary` | `concern.update`(요약) |
| `frame_packet` | `concern.reframe` (+ 같은 트랜잭션 `choice.committed`, 08 §3.22.2) |
| `situation_answers` | `situation.assess` |
| `loop_plan_draft` | `loop_plan.record` |
| `split_hint`, `structure_op`, `boundary_item`, `recombine_summary` | `structure.*`, `boundary_item.record`·`check`·`drop` |
| `transition_request` | `loop.transition` |
| `question` | `question.raise`, `question.withdraw` |
| `goal_revise` | `goal.revision.propose` |
| `autonomous_choice` | `choice.decide` |
| `entry_signals` | `concern.open`(entrySignals, origin) 또는 `question.raise`(entry_suggestion) |
| `prediction_check`, `prediction` | `prediction.check`, `prediction.propose` |
| `possibility`, `divergence_cell`, `choice_candidate` | `possibility.propose`, `inquiry.cell.update` |
| `interpretation`, `reaction_interpretation` | `interpretation.propose`, `assumption.record` |
| `evidence_link` | `claim.link_evidence`, `claim.resolve_counter` |
| `counter_check` | `claim.record_counter_search`, `claim.declare_discrimination`, `claim.bind_discrimination` |
| `promote_request` | `finding.promote` |
| `stimulus` | `stimulus.create`, `stimulus.present` |
| `criterion_candidate` | `preference.criterion.propose` |
| `agreement_draft` | `agreement.propose`, `agreement.revise`, `agreement.activate`, `agreement.request_scope_change`, `agreement.narrow`, `agreement.restore`, `agreement.discard` |
| `probe_definition`, `probe_verdict` | `probe.define`, `probe.judge` |
| `stabilization_report` | `agreement.report_stop`(비상 합의의 안정화 조건 충족) |
| `result_submission` | `result.submit`, `workunit.conclude`(탐구 WorkUnit) |
| `counter_evidence` | `claim.link_evidence`(counter), `result.attest`(반대 판정 포함) |
| `attest` | `result.attest` |
| `obligation_resolution` | `obligation.resolve`, `obligation.transfer`, `obligation.propose` |
| `obligation_deferral` | `obligation.defer` (에이전트 제안 허용, 08 §3.12 규칙 6) |
| `watch_spec` | `watch.define` |
| `watch_sample` | `observation.annotate`(도구 결과 관찰에 표본 해석을 단다. 관찰 자체는 도구 결과로 생긴다, R-06) |
| `watch_verdict` | `watch.judge` |
| `reflection`, `change_proposal` | `reflection.record`(변경 제안 포함). Goal·정책 변경은 각각 `goal.revision.propose`, 사람의 `policy.change.propose` |
| (중재자) | `delivery.plan` |
| (항상) | `expectation.create`, `concern.open`(승격 제안), `goal.achievement.claim`, `workunit.propose`(재작업 `reworkOf`) |

#### 3.11.12 사람 명령의 낡음 검사 대상 (`subjects()`, 19 요구 (2))

`basisSeq`와 비교할 레코드 목록이다(§3.3.4). 명령이 레코드를 새로 만들기만 하면 그 레코드가 기대는 대상을 넣는다.

| 사람 명령 | `subjects()` |
|---|---|
| `question.answer`, `question.defer`, `question.delegate`, `question.request_reframe`, `question.escalate` | 질문, 질문의 `subjectRef`, 추천 선택지가 가리키는 레코드 |
| `agreement.confirm`, `agreement.revise`, `agreement.decline`, `agreement.narrow`, `agreement.renegotiate`, `agreement.release` | 합의, 그 합의가 구현하는 선택(`implementsChoices`), 현재 Goal |
| `result.accept` | 결과 제출, 그 합의, 결과 제출 뒤의 증언(`at`) |
| `obligation.resolve`·`defer`·`transfer`·`waive`·`reopen` | 반영 항목, 통합(`ig`) |
| `goal.revision.confirm`·`reject`, `goal.revise`, `goal.achievement.confirm` | Goal 현재 버전, 수정 제안 |
| `choice.commit`, `choice.revoke` | 질문(있으면), 근거 레코드(`basis`), 대체할 선택 |
| `decision.contest` | 대상 레코드(링크면 양 끝) |
| `decision.confirm`, `autonomous.mark_seen` | 대상 결정 레코드 |
| `objection.withdraw`·`dismiss` | 이의, 대상 레코드 |
| `concern.open`·`update`·`close`·`reopen`·`resume`, `structure.*`, `loop.transition`, `mode.set` | Concern(상위 포함), 현재 루프 전환 레코드 |
| `finding.confirm`, `preference.criterion.*` | 판단 또는 가능성·선호 모델, 지지 근거 |
| `policy.change.accept`·`reject`·`defer` | 정책 제안, 패치 대상의 현재 값 |
| `toolcall.recover` | 도구 호출, `recovery` 질문 |
| `run.steer`·`stop`·`cancel`, `workunit.pause`·`resume`·`cancel` | 실행 또는 WorkUnit |
| `dial.set`·`unset`, `brief.*`, `question.mark_seen`, 측정 명령 | 없음 (낡음 검사를 하지 않는다) |

거부의 `next`는 사람 채널에서도 채운다(19 요구 (5)). 예: 낡음 충돌이면 `{ action: 'reload', subjects }`, 권리 게이트면 `{ action: 'open_question', questionId }`.

### 3.12 커널이 집행하는 상태 전이 [제안]

레코드 상태 기계는 08 §3.22가 정하고 `@helm/domain/src/machines/*.ts`에 데이터로 둔다. 커널은 이 데이터를 읽어 V-STA-01(표에 없는 (상태, 이벤트) 조합은 `conflict.invalid_transition`)을 집행하고, 가드 ID(08 `Transition.guard`)를 `packages/kernel/src/rules/<id>.ts`로 구현한다. 대화 X3-2-16의 C/A 상태 기계는 08 §3.22.3(WorkUnit)과 §3.22.4(Agreement)로 나뉘어 들어갔고, 빠진 전이(범위 확인 중 수정·취소, 멈출 조건, 만료, 조건부 확인)도 08이 채웠다.

C/A 흐름을 명령으로 따라가면 다음과 같다(08 상태 이름).

| 단계 | 명령 | WorkUnit | Agreement | 사람 조작 |
|---|---|---|---|---|
| 일 제안 | `workunit.propose` | proposed | - | |
| 합의 초안 (check-back 포함) | `agreement.propose` | negotiating | proposed | |
| 사람이 고침 | `agreement.confirm`(edits) 또는 `agreement.revise` | negotiating | proposed (revision+1) | |
| 확정 | `agreement.confirm` | delegated | active | 1 |
| 또는 Grant 안에서 활성화 | `agreement.propose`+`activateViaGrant` / `agreement.activate` | delegated | active (activation grant) | 0 |
| 시작 | `workunit.start` | in_progress | active | |
| 범위 밖 쓰기 시도 | `toolcall.intend` → needs_gate | scope_exceeded | active | (질문) |
| 범위 허락 | `question.answer`(scope_change 허락) | in_progress | active (renegotiated) | 질문 답 |
| 멈출 조건 | `agreement.report_stop` | paused | active | (질문) |
| 결과 제출 | `result.submit` | submitted | active | |
| 결과 확인 | `result.accept`(accepted·conditional) | accepted | fulfilled | 2 |
| 반영 | `obligation.resolve`·`defer`·`transfer` | integrated (마지막 항목) | fulfilled | |
| 수정 요청 | `result.accept`(revision_requested) | in_progress | active | |
| 거절·기준 틀림 | `result.accept`(rejected·criteria_wrong) | rejected | released | Concern이 C 또는 I로 다시 열림 |

08 표에 더해 커널이 거는 가드:

| 가드 | 전이 | 조건 | 근거 |
|---|---|---|---|
| G-K1 | `workunit.started`(change·probe) | 합의 `active`이고 check-back이 있다 | canon-3 G1 |
| G-K2 | 재작업이 필요한 WorkUnit(열린 이의나 뒤집힌 임시 가정의 쓰기 영향이 있음, 11 §3.10.3)의 새 쓰기 (`toolcall.started`) | 그 영향을 `reworkOf`로 가리키는 WorkUnit이 있고, 쓰기가 그 WorkUnit에서 나온다 | 11 §3.10.3 |
| G-K3 | `toolcall.started`(write) | 좁혀진 범위가 있으면 그 범위로 검사 | 11 §3.11 |
| G-K4 | `concern.completed` | 이 Concern 레코드를 대상으로 한 열린 이의 0개 (08 R-34) + 이 Concern 아래 결정 레코드에 열린 이의 0개 | 불변조건 7, 16 요구 (7) 고아 이의 방지 |
| G-K5 | `record.superseded`, `choice.revoked`의 대상에 열린 이의가 있음 | 같은 트랜잭션에서 `objection.resolved(upheld)`를 만든다 (08 §3.22.12) | 16 요구 (7) |
| G-K6 | `concern.closed`(force)·`concern.merged`의 하위 레코드에 열린 이의가 있음 | 이의를 대상 Concern으로 옮기거나(merged) `objection.resolved(withdrawn, note: concern_closed)`로 남기고 복귀 요약에 보인다 | 16 요구 (7) |

### 3.13 파생 규칙 (`react`) [제안]

#### 3.13.1 규칙 목록

`react`는 다음 규칙을 순서대로 적용하고 새 초안이 생기면 그것까지 포함해 다시 돈다(최대 8회). 파생 이벤트의 행위자는 `kernel`, `causationId`는 원래 제출, `authorityBasis`는 `{ kind: 'rule', ruleId }`다. 08 상태 기계의 "부수 효과" 열은 이 규칙들로 구현한다.

| ID | 계기 | 파생 | 근거 |
|---|---|---|---|
| R-1 | `acceptance.recorded`(accepted·conditional) | `integration.opened` + 반영 항목: (a) 결과 제출의 `integrationCandidates` (b) 확인 조건(`acceptance_condition`) (c) 커널 계산: 이 WorkUnit이 바꾼 파일을 `materialRefs`로 가진 관찰에 기댄 판단·선택 → `broken_premise`, 쓰기 대상이 겹치는 다른 활성 합의 → `concern_conflict`, 하위 Concern이 있으면 `recombine`, enforcement가 advisory·post_hoc였던 쓰기가 있으면 "사후 범위 확인"(other). 항목 0이면 `integration.completed` | 대화 X3-2-14, 원전 F05 §10, 08 §3.22.6 |
| R-2 | `observation.recorded`(material_change) | 08 §3.21.3 `onStale`: 바뀐 경로의 이전 해시를 가진 관찰에서 시작해 `depends_on` 역방향으로 `record.staled` 전파 | A13, 08 §3.21.3 |
| R-3 | `claim.evidence_linked`(challenges·invalidates) 대상이 판단이거나 accepted 선택의 근거 | 대상 contested 플래그(`contestedBy`에 관찰), Concern이 종료 상태면 `concern.reopened` | 대화 X3-3-10, 08 §3.21.3 |
| R-4 | `goal.revised` | 이전 버전에 기댄 합의·선택 `record.staled(goal_revised)`, Concern마다 `obligation.added(goal_revision_check)`, 투영 무효화 지시 | 08 §3.22.1, 원전 I10 |
| R-5 | `obligation.resolved`·`deferred`·`transferred`·`waived` | 통합의 남은 open 항목이 0이면 `integration.completed` + WorkUnit `integrated` | A10, 08 R-22 |
| R-6 | `agreement.confirmed`·`agreement.activated_by_grant` | 같은 프로젝트의 다른 `active` 합의와 쓰기 자원이 겹치면 `question.recorded`(semantic_conflict, 정보 게이트, 나중 합의의 겹치는 쓰기를 막음) | 원전 F05 §13 "last-write-wins 하지 않는다", F07 §11 |
| R-7 | 질문 관련 이벤트 | 11 §3.17의 부수 효과(가정 비교, 전제 확정·무효화, 승인 대조, 막힌 WorkUnit 재개 지시, 경계 사건에 따른 전달 지시) | 11 |
| R-8 | `objection.filed` | 대상 contested, 영향 계산(§3.13.3) 결과 레코드는 표시만, Concern 재개, 쓰기 영향이 있으면 재작업 필요 표시(상태에서 계산, 이벤트 없음, 주의 항목), 결정점 키를 이의됨으로 | 11 §3.10 |
| R-9 | `toolcall.completed`·`toolcall.started` | 합의 예산(도구 호출 수, 실행 수, 경과 시간)이 다 찼으면 `agreement.stop_condition_met(budget)` + `workunit.paused` | 대화 X3-6-22 |
| R-10 | `prediction.checked`(failed) | 그 예측을 근거로 한 선택 `record.staled(review_trigger_fired)` | v0.3 04 결과 탐구 |
| R-11 | `question.assumed` | `choice.committed`(assumption_confirmed, AutonomousDecision `assumption_expired`), 전제 `assumption.confirmed` | 08 §3.22.7 |
| R-12 | 다시 볼 조건(`Trigger`)의 기계 판정 충족: `record_state`, `record_changed`, `before_loop`, `before_primitive` 종류가 이번 이벤트로 충족됨 | `record.staled(review_trigger_fired)` | A13, 08 §3.4.4 |

`record.staled`는 품질 플래그만 바꾸고 단계(level)를 바꾸지 않는다(08 §3.21.1). 사람이 확정한 레코드도 플래그가 켜질 뿐 커널이 결정을 뒤집지 않는다.

#### 3.13.2 낡음 전파의 끝

08 §3.21.3은 `depends_on` 링크가 종류 순서의 뒤에서 앞으로만 생기도록 커널이 검사하므로 순환이 없다고 정했다. 커널은 링크를 만드는 이벤트에서 이 순서(관찰·전제 < 해석·가능성·구분 확인 < 판단 < 선택·선호 모델 < 합의 < 결과 제출)를 검사하고, 어긋나면 `invalid.ref_kind`로 거부한다(V-FORM 확장). 그래서 전파에 깊이 상한을 두지 않는다. 1판의 깊이 6 상한은 뺀다.

#### 3.13.3 영향 계산 (`impactOf`)

11의 이의·재작업과 R-8이 쓴다.

```text
impactOf(state, subject):
  records = closure(links where rel == 'depends_on', reverse, from subject)   # subject에 기대는 레코드 전부. 사람 확정 레코드는 목록에 넣되 humanAccepted 표시
  agreements = { a in records ∪ agreementsDependingOn(subject) }              # 합의의 depends_on(implementsChoices, goal)
  calls = { tc : tc.status ∈ {started, completed, interrupted, outcome_uncertain}
                 and tc.seq > createdSeq(subject)
                 and (subject ∈ tc.underAssumptions or tc.agreementRef.agreementId ∈ agreements) }
  writes = ∪ targets(tc) for tc in calls where primitive ∈ {write} or (execute and mutating)
  sends  = { tc in calls : primitive == 'send' }                              # 되돌릴 수 없음 → 보상 반영 항목
  rollbackPoints = { rb in state.records.rollback_point :
                     rb.status == 'available' and covers(rb.coversTargets, writes) and rb.registeredSeq < min(seq of calls) }   # 11 §3.12
  return { records, calls, writes, sends, rollbackPoints }
```

### 3.14 결정 주체 분류 [결정: 원칙(브리프 14) / 제안: 각 행]

원칙: **모델이 구조화된 값을 선언할 수 있으면 결정 자체는 코드가 한다.**

| 결정 | 분류 | 모델이 선언하는 값 | 코드가 하는 일 | 문서 |
|---|---|---|---|---|
| 관찰 생성 | 코드 | 없음 | 도구 결과·발화·외부 메시지·타이머·감시에서 생성 | §3.11.7, 08 R-06 |
| 해석인가 전제인가 | 코드 | 관찰 참조 목록 | 참조 유무로 분류 (대화 X2-6-14) | 08 R-07 |
| 구분 확인의 판정 | 모델 선언 + 코드 계산 | 결과 라벨, 후보별 예측, 관찰된 라벨 | 일치·불일치 계산, 사후 여부 | 08 §3.9.4 |
| 추측 → 판단 승격 | 코드 + 사람(결정에 쓰이는 판단) | 근거 링크, 구분 확인, 반증 탐색 | `promotionMissing`, 출처 독립성 | §3.9 |
| 완료 기준 충족 여부 | 모델 선언 + 코드 강등 + 사람 확인 | 기준별 상태와 근거 | 근거 실재 검사, 서술뿐이면 unverified | §3.11.8 |
| 결과 확인 | 사람 | | | A6 |
| Goal 변경 | 사람 | 수정 제안 | 질문 생성 | §3.8 규칙 5 |
| 선호 기준 확정 | 사람 | 기준 후보, 반응 근거 | 참조 검사 | 15 |
| 질문이 있는가 (정보 게이트 조건 1~3) | 모델 선언 + 코드 계산 | 결정 종류, 결과 차이, 기본 선택이 틀릴 가능성, 자동 검증 가능, 가정 가능 | 정책 적용(조건 1), 문턱 비교(조건 2·3), AND | 11 §3.3 |
| 권리 게이트 대상인가 | 권한 레이어 판정 + 코드 | 없음(도구 인자) | `rightsGate` 반영, 커널이 아는 권리 범주 | 11 §3.3.1 |
| 전달 방식과 시점 | 코드 + 중재자(중재 방식일 때) | 중재자: 사용자 부하 추정, 묶음 | 규칙 표, 중재자 계획 제약 검사 | 11 §3.5, §3.7 |
| 가정 확정 | 코드 | 만료점 | 만료 도달 판정 | 11 §3.6 |
| 범위를 줄여 진행 | 모델 선언 + 코드 검사 | 좁힌 범위 | ⊆ 검사 | 11 §3.11 |
| 자동 검증 가능한 선택 | 모델 선언 + 코드 검사 | 검증 계획, 후보별 통과·실패 관찰 | 검증 관찰 실재·출처 검사 | 11 §3.13 |
| 합의 범위 안인가 | 코드 | 없음(대상은 권한 레이어) | 패턴 매칭 | §3.6.6 |
| 권한 이어 쓰기 | 코드 | 합의 초안 | 포함 검사 | §3.6.7 |
| 진입 조건(초점으로 열기) | 모델 선언 + 코드 계산 | 진입 신호 | 신호 수 ≥ 문턱 (14 데이터) | §3.11.3 |
| 상황 유형 | 모델 선언 + 코드 기록, 사람 이의 가능 | 판정 질문 답과 근거 | 기록, 자율 결정 표시 | 14 |
| 루프 전환 | 모델 제안 + 코드(의존 규칙, 현재 루프 일치) | 출발·도착·계기 | 의존 규칙, R-30 | §3.8 |
| 구조 루프 동작 | 모델 제안 + 코드(상한·경계 검사), 사람 이의 가능 | 하위 목록, 경계 항목 | 상한, Goal 연결 | §3.11.3 |
| 반영 항목 목록 | 모델 선언 + 코드 계산 | 반영 후보 | 참조 그래프로 추가 항목 계산 | R-1 |
| 반영 항목 해소 | 모델 제안 + 코드 검사 / 사람 | 해소 근거 | 근거 실재와 종류별 행위자 검사 | §3.11.8 |
| 근거 낡음 | 코드 | 없음 | 해시 비교와 전파 | R-2 |
| 의미 충돌 | 코드(겹침 탐지) + 사람 | 없음 | 쓰기 자원 교집합 | R-6 |
| 이의 영향 범위 | 코드 | 없음 | `depends_on` 폐포 | §3.13.3 |
| 발산할 곳, 확인 순서, 다음 자극, 탐구 멈춤 | 15 | | | 15 |
| 선택의 질, 관점 다양성, 예측 정확도, 요약 문장의 질 | 측정 | | | 16 |
### 3.15 공리 A1~A15 대응 [결정: 대응 대상(브리프 §3.5) / 제안: 각 칸]

보장 수준:

- **G1 코드 보장**: 모델이 무엇을 내든 위반 상태가 기준 원본에 들어가지 않는다. 런타임이 사전 가로채기를 지원할 때 성립한다(§3.18).
- **G2 구조 보장**: 기록 형식, 구분, 전이는 코드가 보장한다. 내용의 질(해석, 다양성, 요약 문장)은 모델에 달렸고 측정한다.
- **G3 상호작용 설계**: 필요한 명령·선택지가 있다는 것을 커널이 보장하고, 사람이 실제로 쓰는지는 UX(05)와 측정(16)이 본다.
- **G4 측정만**: 커널이 집행하지 않는다. 지표로 본다.

대화의 세 차례 대응(발췌 2 X2-6-03, 발췌 3 X3-5-04, 발췌 4 2-32)과 v0.3 08 §5를 합쳤다. effect class 판별이 Helm 범위에서 빠졌으므로(브리프 결정 2) A7은 권한 레이어와의 경계로 다시 적었다.

| 공리 | 분류 | 집행 지점 (상자·규칙) | 보장 | 위반 테스트 | 운영 지표 (16) | 출처 방법 (canon-3 §3.3) |
|---|---|---|---|---|---|---|
| A1 목적이 태스크보다 먼저 | 코드 | 상자 4c R-01(Concern은 현재 Goal 필수), 상자 4a V-POL-02(쓰기·발송은 Goal에 연결된 Concern의 합의 아래) | G1 | Goal 없는 Concern 생성 → `invalid.goal_link`. Goal이 `retired`인 Concern의 합의로 쓰기 → 거부 | Goal 연결 없는 M 변경 수(목표 0) | Collective Intentionality, Mission Command, VSM |
| A2 진척은 정당화된 상태 변화 | 모델 + 코드 | 완료 주장은 근거 필수(§3.11.8 강등), 승격 규칙(§3.9), 결과 확인은 사람 | G2 | 근거 없는 `met` 기준 → `unverified` notice. 근거 없는 승격 → 거부 | 정당화된 전이 수 대비 활동량(도구 호출 수), 완료 주장과 확인 사이에서 발견된 결함 수 | Dewey, PDSA, Assurance Case |
| A3 문제 정의는 작업 결과의 일부 | 모델 + 코드 | `concern.reframe` 명령이 항상 열려 있음, 처음 요청은 Concern `statement`이고 프레임은 별도 필드, 프레임 변경 이벤트 보존 | G2 | 프레임 변경 뒤 이전 프레임 이벤트가 남아 있는가. 처음 요청이 프레임으로 자동 복사되지 않는가 | 프레임·기준이 바뀐 Concern 비율 (대화 X3-6-23) | Dewey, Double Diamond |
| A4 병렬성은 가설 다양성에 먼저 | 모델 + 코드 | 가능성 레코드의 `branchId`·`lens`, 승격 V-PRO-02(같은 출처·같은 가지 근거 중복 금지), 발산 구조는 15 | G2 | 같은 가지의 추측 두 개가 서로를 근거로 승격 → 거부 | 가지별 가능성 수, 구분 확인 수, 반대 근거 탐색률 (원전 H3) | Peirce, Double Diamond |
| A5 사실·추론·가설·결정·약속은 다른 상태 | 코드 (분류 정확도는 모델) | 레코드 종류별 명령 분리, R-06(관찰은 실행 출처), R-07(참조 없는 해석은 전제), 자동 승격 없음 | G1(구분) / G2(분류 정확도) | 모델이 지어낸 ID로 근거 연결 → `invalid.evidence_not_found`. 모델이 `observation.record` → `denied.capability` | 근거 없는 추측 비율, 강등 notice 수 | Peirce, Speech Acts, ACH |
| A6 에이전트는 제안, 사람은 최종 약속의 저자 | 코드 | 상자 3 능력표(accept는 사람만), 상자 1 V-CH-02(사람 확정 명령은 사람 채널만), 13 도구 목록에 accept 계열 없음 | G1 | 작업 에이전트가 `result.accept`·`choice.commit`·`goal.revision.confirm`·`agreement.confirm` → 거부. 모델 채널로 `human` 행위자 제출 → `denied.channel` | - | Phronesis, Labor–Work–Action, NIST AI RMF |
| A7 자율성은 위험 적응적 권한 범위 | 코드 (위험 판별은 권한 레이어) | 상자 4a V-POL-02~06: 합의 범위, 권리 게이트(권한 레이어 판정 입력), 승인 대조, 권한 이어 쓰기 | G1(사전 가로채기 있는 런타임) / 사후 검사·advisory로 낮아짐 (§3.18) | 범위 밖 쓰기 → needs_gate. 권리 게이트 발송을 승인 없이 → needs_gate. 확대된 합의를 부여로 활성화 → needs_gate | 범위 초과 차단 수(2주 지표 2), advisory로 실행된 쓰기 수 | Supervisory Control, Mission Command, WHO Checklist, STPA |
| A8 결정은 낮은 수준에서, 예외만 상향 | 모델 + 코드 | 11 게이트 판정(조건 1은 정책 데이터로 코드, 조건 2·3은 모델 선언 + 코드 문턱), V-AUT-01(묻지 않으면 why_not_asked) | G2 | 권리 범주 없는 결과 차이 none 결정을 질문으로 만들면 notice 없이 자율 결정이 되는가. why_not_asked 없는 자율 결정 → 거부 | Concern당 전달 질문 수, 답이 임시 가정과 같았던 비율, 종류별 이의 비율 (v0.3 06 §7) | Subsidiarity, MBE, Supervisory Control, Requisite Variety |
| A9 요약은 결정에 필요한 차이를 보존 | 코드 (요약 문장의 질은 모델) | `mustIncludeRefs`(§3.1.5)를 12가 투영·컴팩션에서 검사. 반대 근거·이견·모름은 요약문이 아닌 별도 필드 | G2 | 열린 반대 근거가 있는 Concern의 투영에서 그 ID가 빠지면 12의 검사가 실패하는가 | 투영 누락 검사 실패 수 | ICS, HRO, ACH, Requisite Variety |
| A10 완료 주장·수락·통합 구분 | 코드 | 결과 제출·확인·반영이 다른 명령(§3.11.8), V-DEP-2, R-1·R-5, §3.12 | G1 | 반영 항목이 남은 Concern 닫기 → 거부. 에이전트의 결과 확인 → 거부. 결과 제출만으로 `integrated` 상태가 되지 않음 | 열린 반영 항목 수, 확인까지 시간 (2주 지표 4·5) | Speech Acts, NASA SE, Assurance Case |
| A11 컨텍스트는 시점별 투영 | 코드 (생성 쪽 집행은 12) | V-FORM-06(모델 제출은 `contextRef` 필수), 이벤트 provenance에 `contextRef`, V-PATH-02(투영 어휘로 쓰기 금지). 투영 메타데이터(대상, 관심사, 출처 cursor, 생성 시각, 무효화 조건)는 12가 만든다 | G1(추적) / 12의 투영 생성 규칙 | `contextRef` 없는 모델 제출 → 거부. 판단 이벤트에서 그때 본 투영을 찾을 수 있는가 | 투영 stale 상태에서 낸 제안 수 | Distributed Cognition, SA, SBAR |
| A12 자동화가 이해를 낮추면 실패 | 측정 | 커널 집행 없음. 커널은 측정 재료(사람 조작 수, 질문 수, 이의 수, 복귀 요약 확인 cursor)를 이벤트로 남긴다 | G4 | 해당 없음 | 복귀 시 상황 질문 정답률, 정정 빈도, 원본 로그 재열람, 2주 우회율 (16) | Ironies of Automation, SA, Joint Activity |
| A13 결정과 증거는 낡는다 | 코드 (조건 감지 일부는 모델) | R-2 해시 기반 낡음 전파, `reviewTrigger` 필드, `pendingTimers`의 다시 볼 조건, 예측 확인일 | G1(해시·시각 조건) / G2(서술 조건) | 근거 파일 해시가 바뀌면 판단이 `stale`이 되는가. stale 근거로 승격 → 거부 | stale 근거로 내려진 선택 수 | NASA DA, Assurance defeater, STPA |
| A14 실패와 이견은 학습 신호 | 모델 + 코드 | 거부를 `command.rejected`로 기록(§3.4.5), 실패·중단 도구 결과도 관찰, contested·unknown이 일급 상태, 이벤트는 지우지 않음 | G1(기록) / G2(활용) | 거부된 제출 뒤 로그에 거부 이벤트가 있는가. 실패한 도구 결과가 관찰로 남는가 | 반복 거부 패턴, 이의 처리되지 않고 사라진 수(목표 0) | Reflective Practice, Activity Theory, HRO, CRM, Resilience |
| A15 상호작용은 공동 저작 | UI 설계 + 코드 검사 | V-Q-02(형식별 필수 응답 선택지. 결정점 질문은 기준 수정·질문 재구성·먼저 실험·연기·범위 줄이기), V-Q-03(계속할까요 금지, I.want의 하나 고르기 금지), 방향 수정 명령(`concern.reframe`, `agreement.renegotiate`, `dial.set`)이 모든 상태에서 열림 | G3 | 선택지 없는 질문 → 거부. 원함 탐구에서 하나 고르기 질문 → 거부 | 사람이 직접 바꾼 기준·재정의 비율, 질문에서 추천이 아닌 선택지를 고른 비율 | Phronesis, Coactive Design, SDT |

A15 선택지의 결론 [제안]: 대화의 두 목록(X2-6-08 "추천 선택, 기준 수정, 질문 재구성, 먼저 실험, 연기", X2-7-27 "질문 재구성" 없음)과 Horvitz의 중간 선택지(범위 줄이기)를 합쳐, 결정점 질문(형식 `answer`)에는 기준 수정, 질문 재구성, 먼저 실험, 연기, 범위 줄이기 다섯 가지를 필수로 둔다. 후보 확인·행동 허락·결과 확인 형식은 형식에 맞는 필수 묶음을 따로 둔다(11 §3.2.3). "추천 선택"은 추천이 있을 때만 붙는다. 원함 탐구에서는 선택지 나열 대신 반응(요소 단위, 이유 없는 반응 포함)을 받는다(브리프 결정 18). 문구는 05가 정한다.

### 3.16 불변조건 집행 지점

#### 3.16.1 v0.3 불변조건 1~7 [결정: 불변(브리프 17)]

| 번호 | 불변조건 | 집행 지점 | 다이얼·정책으로 끌 수 있나 | 사후 검사 |
|---|---|---|---|---|
| 1 | 기록과 진실은 다르다 | 이벤트는 "누가 무엇을 주장·관찰했는가"를 남긴다. 관찰의 출처 구분(08 `ObservationCore.source`, 외부 응답은 "말했다" 형식), 품질 상태, 판단의 `scope`·`invalidationTriggers`, 결과 확인의 `criteriaReview`(확인 못 한 기준 표시) | 아니오 | V-INV-01: 관찰 초안의 출처 종류가 제출 채널과 맞다(tool은 runtime, human은 human_client, external은 adapter·runtime) |
| 2 | 관찰, 추측(해석·가능성), 판단, 선택은 다르다 | 종류별 명령, R-06, R-07, §3.9 승격, R-15, Choice는 사람 또는 정책 | 아니오 | V-INV-02: `finding.promoted`는 커널 행위자로만, V-PRO 통과 기록 포함. `choice.committed`의 `autonomy`는 HumanDecision이거나 whyNotAsked가 검증된 AutonomousDecision |
| 3 | 투영은 정본을 쓰지 않는다 | V-PATH-01·02, 투영 생성 코드(12)는 제출 채널이 없음, 클라이언트는 명령만 보냄 | 아니오 | V-INV-03: 초안 타입이 `projection.`으로 시작하지 않음 |
| 4 | 권한은 범위를 가진다 | 합의 `scope`, V-POL-02~06, 권한 이어 쓰기 포함 검사 | 아니오 (범위 값은 사람이 정함) | V-INV-04: `toolcall.started`(write·send·mutating execute)는 활성 합의(비상 Grant 활성화 포함)를 참조 |
| 5 | 완료 주장, 결과 확인, 전체 반영은 다르다 | 다른 명령, V-DEP-2, R-1·R-5 | 아니오 | V-INV-05: `acceptance.recorded`의 행위자는 human. `integration.completed`는 남은 항목 0일 때만 |
| 6 | 모르는 것, 이견, 낡은 상태는 숨기지 않는다 | contested·stale 상태, `mustIncludeRefs`, 거부 기록, `outcome_uncertain`, 사후 구분 확인(`posthoc`) 표시 | 아니오 | V-INV-06: 상태를 `accepted`로 올리는 이벤트가 contested·stale 레코드를 근거로 쓰지 않음 |
| 7 | 혼자 정한 결정도 기록되며 이의를 걸 수 있다 | V-AUT-01, `decision.contest`가 모든 자율 이벤트에 열림, 이의 뒤 자율 재결정 금지(V-AUT-02) | 아니오 | V-INV-07: 행위자가 agent이고 N평면 결정(Choice, 루프 계획, 전환, 상황, 구조, 라우팅, 가정 확정)인 이벤트는 `autonomy`를 가짐 |

#### 3.16.2 원전 불변조건의 처리 [제안]

브리프 결정 17은 v0.3 1~7을 기준으로 한다. 원전의 불변조건 집합(원전 정리 1 §20.3 #19)을 아래처럼 대응시킨다. "처리"는 채택(커널이 집행), 대응(v0.3 불변으로 흡수), 다른 문서, 범위 밖 중 하나다.

| 원전 | 내용 요약 | v0.3 | 처리와 집행 지점 |
|---|---|---|---|
| F05 I1 | Active WorkUnit은 유효한 DelegationContract | 4 | 채택: change·probe WorkUnit의 쓰기는 활성 합의 (V-POL-02) |
| F05 I2 | 위임 권한 ⊆ 요청자 권한 | 4 | 채택: 권한 이어 쓰기 포함 검사 (§3.6.7). 1인이라 요청자 = 사람 |
| F05 I3 | ClaimingComplete는 모든 필수 기준의 근거 | 5 | 채택 + 수정: 기준 전부 포함은 거부, 근거 없는 기준은 강등 (§3.11.8) |
| F05 I4 | Accepted는 권한 있는 수락자 | 5 | 채택: accept 능력 (V-CAP-01) |
| F05 I5 | Integrated는 검증된 통합 대상 | 5 | 채택: 반영 항목 해소에 근거 (§3.11.8) |
| F05 I6 | Committed Decision은 대안, 근거, 재개 조건 | 2 | 채택: Choice 필드 `alternatives`, `rationale`, `reviewTrigger`(사람 확정은 필수, 자율은 선택) |
| F05 I7 | ContextProjection은 재현 가능한 원천 상태 참조 | 3 | 채택: `contextRef.sourceSeq` (V-FORM-06), 생성은 12 |
| F05 I8 | 대체 엔티티는 대체 대상 연결 | 1 | 채택: 대체는 `record.superseded`와 새 레코드의 `supersedes` 링크 (08 §3.20.3) |
| F05 I9 | Material mutation은 권한 있는 WorkUnit 또는 비상 정책 | 4 | 채택: 의존 규칙 1 + 비상 합의 |
| F05 I10 | 규범 기준선 변경은 관련 투영 무효화 | 3, 6 | 채택: R-4, 지시 `projection.invalidate` |
| F05 I11 | 근거 무효화는 의존 Claim·Decision 재평가 | 6 | 채택: R-2 |
| F05 I12 | Closed WorkUnit 아래 숨은 미해결 의무 없음 | 5, 6 | 채택: V-DEP-2, `policy.obligations_open` |
| F01 존재론 1 | WorkUnit은 Purpose 또는 Concern 연결 | - | 채택: `workunit.propose`에 Concern 필수 (A1) |
| F01 존재론 2 | Decision은 선택자, 대안, 근거, 시점, 재검토 조건 | 2, 7 | 채택: Choice 필드 + 이벤트 시각, 자율이면 AutonomyMeta |
| F01 존재론 3 | Claim은 인식적 종류를 밝힘 | 2 | 대응: 레코드 종류 자체가 인식적 종류(해석·가능성·판단) |
| F01 존재론 4 | Evidence는 출처와 획득 시점 없이 검증 증거가 될 수 없음 | 1, 2 | 채택: 관찰 출처 필수(R-06), 시각은 이벤트 |
| F01 존재론 5 | Commitment는 책임 주체와 만족 조건 필요 | 5 | 채택: 합의의 기준 ≥1, 확정 주체 기록 |
| F01 존재론 6 | Outcome은 의도와 분리해 실제 결과 기록 | 1 | 채택: `toolcall.started`와 `toolcall.completed`·관찰 분리 |
| F01 존재론 7 | ContextProjection은 정본으로 역추적 가능 | 3 | 채택: `contextRef` |
| F01 존재론 8 | 파일 경로·세션은 객체 정체성을 정하지 않음 | - | 채택: ID는 `<prefix>_<ULID>`, 경로·세션은 참조 필드 |
| F03 통치 1 | 자율 실행은 유효한 Authority Envelope | 4 | 채택: 의존 규칙 1 |
| F03 통치 2 | 권한 범위 ≤ 도구 능력 | 4 | 다른 문서: 13이 도구 능력과 범위를 대조. 커널은 원시 행동 능력표만 |
| F03 통치 3 | 규범 판단을 사실 추론으로 위장 금지 | 2 | 대응: N·E 레코드 분리. 원함 탐구의 선호는 N(선호 모델), 사실 판단은 E |
| F03 통치 4 | 고위험 작업에서 완료 선언자와 수락자 독립 | 5 | 채택: 결과 확인은 사람만, 증언은 독립성(V-POL-07) |
| F03 통치 5 | 비가역 외부 행위는 명시 권한 | 4 | 채택 + 수정: 비가역 판별은 권한 레이어, 커널은 권리 게이트와 지문 승인 대조 (브리프 결정 2) |
| F03 통치 6 | 불확실성·권한 초과는 Escalation Event | 6 | 채택: needs_gate → `command.rejected`(gate) 또는 `toolcall.blocked`·`approval_requested` + 질문 |
| F03 통치 7 | Decision 변경은 supersede/reopen 관계 | 1 | 채택: `record.superseded`, `choice.revoke`. 덮어쓰기 명령 없음 |
| F03 통치 8 | 인간은 언제든 Frame·Purpose·Constraint 재검토, 파급 확인 | - | 채택: `concern.reframe`, `goal.revision.*`, `agreement.renegotiate`가 사람에게 항상 열림, R-4 |
| F04 co-agency 1 | 공유 Purpose와 역할 | - | 채택: A1, 행위자 역할 |
| F04 co-agency 2 | 상대 상태 관측 가능 | 6 | 다른 문서: 투영(12), 화면(03·04) |
| F04 co-agency 3 | 자율 실행은 예상 경로와 예외 조건 노출 | 6 | 채택: `workunit.propose`의 `intent`·`expectedOutcome`(08 WorkUnitCore), 합의 `checkBack`·`stopConditions` |
| F04 co-agency 4 | 방향 수정 비용이 비선형으로 늘지 않음 | - | 다른 문서: 14·16 측정. 커널은 수정 명령이 어느 상태에서나 같은 비용(명령 1개)이도록 함 |
| F04 co-agency 5 | 사용자는 프레임과 주장을 반박 가능 | 7 | 채택: `decision.contest`(대상: 판단·추측·선택 등 08 `ContestableId`) |
| F04 co-agency 6 | 인간 참여는 목적·프레임·대안·수락에 집중 | - | 채택: 사람 조작 2회 상한 (11 §3.15), 승인 극장 질문 금지 (V-Q-03) |
| F04 co-agency 7 | 성능은 공동 시스템 수준 평가 | - | 다른 문서: 16 |
| F05 Event 1~5 | 필수 필드, 권한 근거, 원인 ID, 보정은 새 이벤트, 외부 결과 해시 | 1 | 채택: `EventDraft`의 `authority`·`causationId` 필수, 도구 결과 `contentHash` 필수, 수정 명령 없음. envelope 필드는 09 |
| F10 최소 법칙 1 | 모든 material mutation은 Goal/Concern과 권한 근거 | 4 | 채택: 의존 규칙 1 + A1 |
| F10 최소 법칙 2 | 기록의 존재와 내용의 진실·품질·수락 구분 | 1 | 채택: 품질 상태 |
| F10 최소 법칙 3 | 관찰·해석·가능성·판단·선택 자동 승격 금지 | 2 | 채택: 승격은 명시 명령 + 규칙 |
| F10 최소 법칙 4 | Choice는 대안, 근거, 권한 주체, review trigger | 2 | 채택 |
| F10 최소 법칙 5 | Authority는 WorkUnit과 action class별 범위 | 4 | 채택 + 수정: action class 대신 원시 행동과 자원 패턴 (브리프 결정 2·4) |
| F10 최소 법칙 6 | 결과 제출·수락·반영 별도 전이 | 5 | 채택 |
| F10 최소 법칙 7 | Projection은 정본 불변, cursor·포함 정책·freshness | 3 | 채택(정본 불변) + 다른 문서(메타데이터는 12) |
| F10 최소 법칙 8 | unknown·dissent·counterevidence는 일급 상태 | 6 | 채택 |
| F10 최소 법칙 9 | 의미 충돌을 파일 충돌과 별도 탐지 | - | 채택(최소): R-6 |
| F10 최소 법칙 10 | 특정 runtime 없이 의미 상태를 읽고 내보냄 | - | 다른 문서: 09 export |
| F10 최소 법칙 11 | 자동화가 복귀·예측·방향 수정 능력을 낮추면 실패 | - | 다른 문서: 16 (A12) |
| F10 최소 법칙 12 | 안정 schema는 cross-runtime 증거 뒤 승격 | - | 범위 밖(1인, 자체 런타임 우선): 스키마 버전 정책은 09 |
| F10 profile 불변 6 | 기록≠진실, 다섯 구분, 투영 불변, Authority는 scope와 effect class, 제출·수락·반영 구분, unknown 숨기지 않음 | 1~6 | 대응: v0.3 1~6. "effect class를 가진다"는 권한 레이어로 넘어감(v0.3 00 §2.4 4번) |
| F09 법칙 1 | Purpose 없는 WorkUnit 실행 안 함 | - | 채택: A1 |
| F09 법칙 2 | 처음 프롬프트를 완성된 ProblemFrame으로 취급 안 함 | - | 채택(구조): A3 |
| F09 법칙 3 | Observation, Inference, Hypothesis, Decision 혼합 금지 | 2 | 채택 |
| F09 법칙 4 | 병렬성은 경쟁 가설에 먼저 | - | 다른 문서: 15 (커널은 V-PRO-02) |
| F09 법칙 5 | Request, Commitment, Completion Claim, Acceptance 구분 | 5 | 채택: 질문·합의·결과·확인이 다른 레코드 |
| F09 법칙 6 | 자율성은 WorkUnit의 Authority Envelope | 4 | 채택 |
| F09 법칙 7 | Decision은 가장 낮은 유능한 수준, 상향 이유 설명 | 7 | 채택: 11 게이트, 질문의 `reasons`·`whyLocalInsufficient` (11 §3.2) |
| F09 법칙 8 | 정상 반복은 압축, 차이는 보존 | 6 | 다른 문서: 12 (`mustIncludeRefs`) |
| F09 법칙 9 | 중요한 단계 경계에서만 공동 pause | - | 채택: 11 예약 전달(작업 경계) |
| F09 법칙 10 | 수락은 Evidence, 한계, reopen trigger | 5 | 채택: 결과 제출의 `limitations`·`remainingUncertainty`, 확인의 `criteriaReview`, 다시 볼 조건 |
| F09 법칙 11 | local completion은 Integration 전까지 닫히지 않음 | 5 | 채택 |
| F09 법칙 12 | Reflection은 Context·Contract·Policy를 실제로 바꿔야 | - | 다른 문서: 14(A.reflect 종료 조건), 16 |

#### 3.16.3 커널 사후 검사 (V-INV) [제안]

`decide`는 반환 직전에 결과 초안 전체를 대상으로 다음을 검사한다. 하나라도 실패하면 `status: 'error'`, `code: 'kernel.invariant_violation'`으로 아무것도 커밋하지 않는다. 사후 검사는 정책·다이얼을 읽지 않는다. 버그가 불변조건을 깨는 이벤트를 만들더라도 기준 원본에 들어가지 않게 하는 두 번째 방어선이다.

| ID | 검사 |
|---|---|
| V-INV-01 | `observation.recorded`의 출처 종류가 제출 채널과 맞다(tool ↔ runtime, human ↔ human_client, external ↔ adapter·runtime, timer ↔ scheduler, watcher ↔ runtime) |
| V-INV-02 | `finding.promoted`의 행위자가 kernel이고 payload에 V-PRO 통과 증빙(근거 ID, 구분 확인 ID, 반증 탐색 ID)이 있다 |
| V-INV-03 | 초안 타입이 `projection.`으로 시작하지 않는다 |
| V-INV-04 | write·send·mutating execute의 `toolcall.started`가 활성 합의(비상 Grant 활성화 포함)를 참조하고 그 대상이 범위 안이거나 `enforcement`가 `post_hoc`·`advisory`다 |
| V-INV-05 | `acceptance.recorded`, `goal.activated`, `goal.revised`, `goal.achieved`, `agreement.confirmed`, `policy_proposal.accepted`, `finding.confirmed`, `preference.criterion_confirmed`, `objection.filed`, `grant.issued`의 행위자가 human이다. `choice.committed`는 human이거나 AutonomousDecision이다 |
| V-INV-06 | 품질 단계를 accepted로 올리는 이벤트가 contested·stale 플래그가 켜진 레코드를 근거로 쓰지 않는다 (사람이 그 사실을 보고 확정한 경우는 이벤트에 `acknowledgedFlags`로 남기고 허용) |
| V-INV-07 | 08 `Autonomy`를 가지는 레코드(ch, lp, lt, sa, sc, md)를 만드는 이벤트에 `autonomy`가 있고, 행위자가 human이 아니면 `autonomous: true`와 `whyNotAsked`가 있다 |
| V-INV-08 | 모든 초안에 `authority` ≥1, `causationId`, `subject`가 있다. 예외는 09 §3.2 규칙 3·4: 거부 기록(`command.rejected`)은 authority가 빈 배열, 시스템 이벤트·`brief.acknowledged`·사용자 층 `dial.*`은 subject가 null (09 요구 (7)) |
| V-INV-09 | 권리 게이트 질문에 `question.assumed`가 없다 |
| V-INV-10 | `integration.completed`가 있으면 그 결과 확인의 남은 반영 항목이 0이다 |
| V-INV-11 | 거부·gate 결과의 이벤트는 `command.rejected`, `question.*`, `assumption.recorded`(질문 전제), `toolcall.requested`·`blocked`·`approval_requested`, `workunit.scope_exceeded`, `agreement.scope_change_requested`뿐이다 |
| V-INV-12 | 새 레코드 ID가 상태와 초안 안에서 유일하다 |

### 3.17 테스트 설계 [제안]

커널 테스트, 런타임 재생 테스트, 모델 품질 평가를 나눈다(v0.3 08 §6, 대화 X3-8-26·27). 커널 테스트는 모델을 쓰지 않는다. 전체 테스트 전략은 22가 정하고, 여기서는 커널이 보장해야 할 것을 적는다.

#### 3.17.1 단위 테스트

- 명령마다: 정상 1건, 공통 거부(채널·능력·스키마) 각 1건, 명령별 거부 코드마다 1건. 갈래와 코드가 기대값과 같은지 본다.
- 규칙마다: V-* 규칙 ID별 통과·실패 사례.
- 파생 규칙 R-1~R-12: 계기 이벤트를 넣고 파생 이벤트 목록을 비교.
- 순수성: 입력을 `deepFreeze`한 뒤 `decide` 호출, 같은 입력 두 번 호출 결과의 깊은 동등.

#### 3.17.2 불변조건 속성 테스트 (fast-check [지식])

생성기:

```ts
// packages/kernel/test/property/arbitraries.ts
// 1. 시드 상태: Goal 1~2, Concern 1~4, 합의 0~3, 관찰 0~10을 정상 명령 순서로 만든 상태
// 2. 제출 생성기: 행위자(human | agent:work | agent:verifier | agent:mediator | agent:observer | agent:router
//    | agent:branch | runtime | scheduler | migration) × via × 채널(7종, 일부러 틀린 조합 포함) × 명령 타입(전체)
//    × 페이로드(스키마 맞는 것 70%, 틀린 것 30%)
// 3. 참조 생성기: 기존 ID 60%, 지어낸 ID 20%, 다른 종류 ID 10%, 서술 10%
// 4. 시간 생성기: ctx.now는 단조 증가, 사이에 timer.fire를 무작위로 끼움 (pendingTimers에서 고름)
// 5. 순서: 길이 1~200의 제출 열. 각 단계: decide → accepted면 events를 apply로 적용
```

각 단계 뒤 검사(모든 생성 열에서 참이어야 한다):

| ID | 검사 |
|---|---|
| PT-01 | 결정성: 같은 `(state, cmd, ctx)`로 `decide`를 두 번 부르면 깊은 동등 |
| PT-02 | 재생 동등: 지금까지 커밋된 이벤트를 빈 상태에서 `reduce(apply)`한 결과 = 단계별로 유지한 상태 |
| PT-03 | 거부·gate·conflict·error 결과는 V-INV-11 목록 밖의 레코드를 바꾸지 않는다 |
| PT-04 | 모든 판단(fd)은 관찰 근거 ≥1, 구분 확인 ≥1, 반증 탐색 ≥1을 승격 시점에 가졌다 |
| PT-05 | `acceptance.recorded`, `goal.revised`, `agreement.confirmed`, `finding.confirmed`의 행위자는 human뿐. HumanDecision인 `choice.committed`도 human뿐 |
| PT-06 | write·send·mutating execute의 `toolcall.started`는 그 시점에 활성 합의 범위 안(또는 post_hoc·advisory 표시) |
| PT-07 | `completed` Concern은 결과 확인이 있고, 통합 모두 completed, 하위 Concern 종료, 열린 이의 0 |
| PT-08 | Autonomy 레코드를 human이 아닌 행위자가 만들면 언제나 `autonomous: true`와 검증된 `whyNotAsked`가 있다 |
| PT-09 | 권리 게이트 질문은 `assumed` 상태가 되지 않는다 |
| PT-10 | 이벤트 타입 중 `projection.`으로 시작하는 것이 없다 |
| PT-11 | 멱등: 같은 제출(같은 commandId)을 다시 결정하면 같은 결과와 같은 파생 ID |
| PT-12 | stale·contested 플래그가 켜진 레코드를 근거로 accepted 단계가 새로 생기지 않는다(사람의 `acknowledgedFlags` 제외) |
| PT-13 | 이의가 걸린 결정점(decisionPointKey)에 이의 뒤 자율 결정 이벤트가 없다 |
| PT-14 | 모든 커밋 이벤트는 V-INV-08을 만족한다(예외 포함) |
| PT-15 | 권리 게이트 승인 질문은 도구 호출 하나에만 소진된다(`consumedByToolCallId`가 한 번만 설정) |
| PT-16 | `integration.completed`는 남은 항목 0일 때만 |
| PT-17 | Goal 버전이 오르는 이벤트는 human 행위자의 `goal.revision.confirm`에서만 |
| PT-18 | 자격 거부(authority, basis A)는 같은 제출의 행위자를 그 능력을 가진 역할로 바꿨을 때 그 규칙에서 통과한다(분류 일관성) |
| PT-19 | 내용 거부는 행위자를 human으로 바꿔도 같은 코드로 거부된다(분류 일관성. 사람 전용 채널은 바꿔서 시험) |

실패한 열은 fast-check가 최소 열로 줄인다. 최소 열은 회귀 대본으로 `test/regressions/`에 저장한다.

#### 3.17.3 가짜 모델 재생 테스트의 경계

| 층 | 무엇을 재생하나 | 보장하는 것 | 보장하지 않는 것 | 소유 |
|---|---|---|---|---|
| 커널 대본 | 정해진 제출 열 (JSON) | 같은 입력 → 같은 이벤트 로그(골든 파일), 거부 갈래·코드 | 런타임 훅 연결, 모델 동작 | 10 |
| 런타임 재생 | pi-ai faux 공급자의 정해진 응답(도구 호출 열) → 실제 런타임 루프 → 커널 | 훅 지점에서 제출이 만들어지는가, 거부가 모델에게 돌아가는가, 막힌 질문에서 run이 멈추고 답에서 재개되는가 | 모델이 맞게 판단하는가 | 12, 22 |
| 모델 품질 평가 | 실제 모델 | 관점 다양성, 예측 정확도, 요약 누락, 선호 모델 안정성, 자율 결정 이의 비율 | 커널 규칙 (커널 테스트가 이미 보장) | 16, 22 |

규칙: 커널 테스트에 모델 응답을 넣지 않는다. 런타임 재생 테스트의 기대값은 이벤트 로그(타입과 핵심 필드)이며 모델 문장을 비교하지 않는다. 모델 품질이 낮아도 커널 테스트는 실패하지 않아야 하고, 커널 규칙이 깨지면 모델 품질과 관계없이 실패해야 한다.

#### 3.17.4 첫 대본: helm-toy 거부 8건

감사 §3.5의 요구대로 helm-toy의 21개 시도를 커널 명령으로 옮겨 첫 대본으로 쓴다(`packages/kernel/test/scripts/helm-toy.json`). 갈래는 helm-toy의 분류(내용 3·4·7·10·17, 자격 5·19, 경로 21, 대화 L3220–3224, 08 §3.23)와 같아야 한다.

| helm-toy n | 원래 action | 커널 제출 | 기대 결과 |
|---:|---|---|---|
| 1 | runtime tool/result T1 | `toolcall.intend`(read) → `toolcall.complete` (런타임) | accepted, 관찰 ob_T1 |
| 2 | model claim/propose C1 | `possibility.propose`(근거 링크 없음, `ifTrue`·`falsifier`·`nextCheck` 있음) | accepted |
| 3 | model claim/promote C1 | `finding.promote`(C1) | rejected 내용 `policy.promotion_requirements`, missing에 `evidence.support` |
| 4 | model claim/link T9 | `claim.link_evidence`(형식은 맞지만 기록에 없는 관찰 ID) | rejected 내용 `invalid.evidence_not_found` |
| 5 | model tool/result T9 | 모델 채널에서 `toolcall.complete` | rejected 자격 `denied.channel` (시스템 명령) |
| 6 | link C1 support T1 | `claim.link_evidence`(supports) | accepted |
| 7 | promote C1 (반증 탐색 없음) | `finding.promote` | rejected 내용 `policy.promotion_requirements`, missing에 `counter.search`(+ `check.discriminating`) |
| 8~9 | T2 결과, C1 counter T2 | `toolcall.complete`, `claim.record_counter_search`(found T2) | accepted, C1에 challenges 링크 |
| 10 | promote C1 (반대 근거) | `finding.promote` | rejected 내용, missing에 `counter.unresolved:<ob_T2>` |
| 11~15 | C2 제안, 근거, 구분 확인, 반증 탐색, 승격 | `possibility.propose`(C2) → `claim.declare_discrimination`(outcomes ["db_dominant", "network_dominant"], C2 expects db_dominant, C1 expects network_dominant) → T2 관찰 → `claim.bind_discrimination`(db_dominant) → `claim.link_evidence`(C2 supports T2) → T3 실행 → `claim.record_counter_search`(C2, found 없음) → `finding.promote`(C2) | accepted, `finding.promoted`. 구분 확인이 관찰보다 먼저 선언되어야 한다(먼저 관찰했다면 posthoc로 세지 않음) |
| 16~18 | T4, result/submit 지어낸 근거, 정상 제출 | (a) 근거에 없는 관찰 ID → rejected `invalid.evidence_not_found` (b) 근거가 서술뿐인 `met` 기준 → accepted + `downgraded.criterion_unverified` (c) 근거 ob_T4 → accepted | 대화 X3-2-11의 강등과 helm-toy의 거부를 둘 다 시험 |
| 19 | model result/accept | 모델 채널 `result.accept` | rejected 자격 `denied.channel`. 같은 채널이 허용되는 경우의 능력 차원 시험은 사람 채널을 흉내 낸 검증 에이전트 run(접수가 행위자를 run 역할로 채우므로 `agent:verifier`)에서 `denied.channel` 또는 aux 채널의 `denied.capability` |
| 20 | human result/accept | 사람 채널 `result.accept` | accepted, R-1 통합·반영 항목 |
| 21 | 상태 직접 수정 | 상태 객체에 대입 | `TypeError`(동결), 상태 불변. 별도로 이벤트 envelope 제출 → `path.adapter_cannot_append_event` |

#### 3.17.5 v0.2 실행 후보 57개 테스트의 재사용

원전 정리 2 §9.14의 57개 중 커널에 해당하는 것(guided-001 9, client 3 중 역할별 surface, authority 5, context 3 중 결정성)을 새 명령으로 옮긴다. 옮길 때의 대응: `choice.qualify`·`choice.commit` → 승격 + `choice.commit`, `agreement.offer` → `agreement.propose`, `completion.submit` → `result.submit`, `result.accept` → 같음, `integration.start/complete` → R-1·R-5. F1(쓰레기 입력 `ㅇ`)은 `migration.*`(09)과 품질 상태 `captured` 유지로 옮긴다.

### 3.18 벤더 중립 커널 인터페이스 [결정: 인터페이스를 지금 정의(브리프 34) / 제안: 형식]

#### 3.18.1 원칙

- 커널 입력은 런타임과 무관한 `CommandEnvelope`이다. pi, Claude Code, Codex, ACP의 이벤트 이름을 커널 어휘로 쓰지 않는다(원전 정리 2 §1.3 P1).
- 런타임 어댑터(13)는 자기 런타임의 훅에서 제출을 만들어 커널에 넣고, 결과를 런타임 방식으로 되돌린다(차단, 오류 결과, 계속).
- 런타임에 능력이 없으면 멈추지 않고 보장 수준을 낮춰 동작하며, 낮아진 수준을 이벤트(`enforcement`)와 화면에 표시한다(대화 X3-8-22, 감사 §3.8).

#### 3.18.2 런타임이 넘겨야 하는 것

| 커널 검사 | 런타임이 넘기는 값 | 넘기는 시점 (자체 런타임 = pi-agent-core 포크) |
|---|---|---|
| 의존 규칙 1, 합의 범위, 권리 게이트, 승인 대조, 가정 아래 쓰기 | `toolcall.intend`: 08 `ToolCallCore`(runId, providerCallId, toolName, primitive, args blob, `fingerprint`, agreementRef), `PermissionInput`(08 `PermissionVerdict` + 대상, `targetsKnown`, enforcement), 승인 질문 ID | `beforeToolCall` (`agent/src/agent-loop.ts`의 인자 검증 뒤·실행 전. 이 훅이 받는 `args`는 실행에 그대로 쓰이는 복사본이다 [원문: pi-api-facts-1 §0 1]). 지문은 이 `args`로 계산한다 |
| 관찰 생성, 사후 범위 검사, 실패도 신호 | `toolcall.complete`: 결과 해시, 결과 참조, 요약, 작업 공간 변경 목록, durationMs, 관찰 ID | `afterToolCall`. 차단된 호출에는 `afterToolCall`이 오지 않으므로 [원문: pi-api-facts-1 실험 A1 3번] 차단 기록은 커널의 `toolcall.blocked`로 남는다 |
| A11 추적 | 모델이 본 투영의 `contextRef` | `prepareRequest`에서 투영을 넣을 때 12가 ID를 붙이고, 그 run의 모델 채널 제출에 첨부 |
| 턴 종료 검사 (C/A 우선) | `checkSettle(runId)` 조회 | 턴 종료 판단 직전(12가 위치 결정). 남은 항목이 있으면 한 번 더 진행 요청, 최대 2회(무한 반복 방지, 발췌 2 d-2) |
| 독립 검증 | 검증 run이 새 컨텍스트이며 작업 run의 계통이 아님 | `run.start`의 `parentRunId`, 역할 verifier |
| 크래시 복구 | 재시작 시 의도(`started`)만 있고 완료가 없는 호출 목록과 처리 방식 | 12가 `run.end`(outcome interrupted)와 호출별 `toolcall.skip`·`toolcall.interrupt`·`toolcall.report_unknown`·재실행 `toolcall.intend`를 제출(12 §3.7.3) |

#### 3.18.3 런타임 능력과 보장 수준

v0.3 08 §8의 다섯 능력과 커널 검사의 관계다.

| 런타임 능력 | 있을 때 | 없을 때 (보장 수준을 낮춰 동작) | 이벤트 `enforcement` |
|---|---|---|---|
| 도구 호출을 실행 전에 가로챔 | 사전 차단 (G1) | 격리된 작업 공간에서 실행하고 끝난 뒤 변경 목록으로 범위를 사후 검사. 범위 밖이면 `agreement.violation_detected`, WorkUnit 정지, 질문. 반영(merge)은 사람 확인 뒤 | `pre` / `post_hoc` |
| 도구 결과를 ID와 함께 돌려줌 | 관찰 출처 = 도구 호출 ID | 어댑터가 ID를 부여. 관찰 주석(08 Annotation)으로 "어댑터가 붙인 ID"를 남긴다 | - |
| 턴 경계에서 멈추거나 계속하게 함 | 질문으로 막힌 run을 멈추고 답에서 재개, `checkSettle` | 실행 단위를 작게 나눠 매번 새로 실행. 막힌 질문이 있으면 다음 실행을 시작하지 않음 | - |
| 새 컨텍스트를 만듦 | 검증·중재를 새 컨텍스트로 | 별도 프로세스로 실행 | - |
| 대상 자원을 미리 알 수 있음 (권한 레이어) | 실행 전 범위 검사 | `targetsKnown=false`: §3.6.5 규칙. 합의가 허용하지 않으면 질문 | `post_hoc` |
| 위 어느 것도 강제할 수 없음 (지시만 전달) | - | 커널은 기록과 사후 검사만 한다. 화면에 "맡긴 범위는 권고이며 실제로 막지 않습니다"를 표시(원전 CLI 경험 §17) | `advisory` |

이벤트와 투영은 `enforced`와 `advisory`를 구분해 보인다(원전 정리 2 L16 "능력 결손은 숨기지 않는다"). advisory로 실행된 쓰기는 반영 항목 "사후 범위 확인"을 자동으로 만든다(R-1 확장) [제안].

#### 3.18.4 어댑터 적합성 테스트 (13에 요구)

같은 커널 대본(§3.17.4 포함)을 각 어댑터에서 가짜 모델로 실행해 같은 도메인 이벤트 열(타입, 행위자 종류, 대상, 핵심 페이로드)이 나오는지 본다. provenance(어댑터 ID)는 달라도 된다(원전 정리 2 §9.14 adapter-conformance). 광고한 능력과 실제 결과가 다르면 어댑터 실패다.


## 4. 실패·예외·경계 사례

| # | 사례 | 처리 |
|---|---|---|
| E-1 | 커밋 트랜잭션이 실패함 | 아무것도 남지 않는다. 제출자는 같은 멱등 키로 재시도한다. engine의 파생 `newId`는 commandId에서 나오므로 재시도해도 같은 ID다 |
| E-2 | 같은 멱등 키로 다른 내용을 보냄 | engine 접수에서 `conflict.idempotency_key_reuse`. 커널까지 오지 않는다 |
| E-3 | 두 기기에서 같은 질문에 동시에 답함 | 먼저 커밋된 답이 질문 `revisionSeq`를 올린다. 나중 답은 `conflict.already_resolved`와 현재 질문 요약을 받는다(06 F19) |
| E-4 | 검증 증언과 사람의 결과 확인이 동시에 옴 | `attestation.recorded`가 결과 제출의 `revisionSeq`를 올리므로, 증언 전 화면에서 누른 확인은 `conflict.version_mismatch`가 된다. 사람은 새 반대 근거를 본 뒤 다시 확인한다 |
| E-5 | 데몬이 꺼져 있다가 켜져서 지난 타이머가 한꺼번에 발화 | 스케줄러는 `dueAt` 순서로 `timer.fire`를 보낸다. 만료 여유 타이머가 만료 시각보다 늦게 처리되면 커널은 승격을 건너뛰고 만료 규칙을 적용한다(11 §3.6.3). 이미 끝난 대상의 타이머는 `notice.timer_noop` |
| E-6 | 규칙 데이터(RuleBundle)가 바뀜 | 커밋된 이벤트는 `apply`로만 재생하므로 다시 판정되지 않는다. 새 결정부터 새 규칙을 쓴다. 이벤트 provenance의 `rulesVersion`으로 어떤 규칙에서 받아들였는지 추적한다 |
| E-7 | 로그에 모르는 이벤트 타입이 있음 | `apply`는 상태를 바꾸지 않고 `diagnostics`에 남긴다. 데몬은 쓰기를 막고 읽기 전용으로 띄운다(09·17) |
| E-8 | 파생 규칙이 수렴하지 않음 | `kernel.reaction_overflow`, 커밋 없음. 운영 로그에 제출과 규칙 경로를 남긴다 |
| E-9 | 사후 검사(V-INV) 실패 | `kernel.invariant_violation`, 커밋 없음. 버그로 다룬다. 같은 제출은 계속 실패하므로 런타임은 해당 WorkUnit을 멈추고 질문(종류 other, `kernel_error` 사유)을 남긴다 |
| E-10 | 도구 실행 중 합의가 만료되거나 Grant가 철회됨 | 이미 `started`인 호출의 완료는 받아들이고 관찰로 남긴다. 그 뒤의 의도는 거부된다. 완료 때 사후 범위 검사는 그대로 한다 |
| E-11 | bash로 범위 밖 파일을 바꿈 | 사전 검사를 통과했더라도(`targetsKnown = false` + 허용) 완료의 `observedChanges`에서 범위 밖 변경이 나오면 `agreement.violation_detected`, WorkUnit `paused(violation)`, 질문(정보 게이트, 막음). 되돌릴 지점이 있으면 질문에 되돌리기 선택지를 넣는다 |
| E-12 | 권리 게이트 승인 뒤 모델이 인자를 바꿔 발송하려 함 | 지문 불일치로 `gate.approval_mismatch`. 새 인자로 다시 묻는다 |
| E-13 | 모델이 `contextRef`를 지어냄 | 커널은 `sourceSeq ≤ ctx.cursor`와 형식만 검사한다. `projectionId`의 실재 검사는 12가 런타임 단계에서 한다. 이 값은 런타임이 붙이므로 모델이 직접 넣지 못하게 하는 것이 주 방어다 |
| E-14 | 모델 채널 제출의 행위자 역할이 run 등록 역할과 다름 | 접수가 행위자를 run 등록(`run.started`의 role)에서 채운다. 제출자가 쓴 역할은 무시된다. 등록되지 않은 run이면 `denied.channel` |
| E-15 | needs_gate 뒤 답을 받았는데 그사이 상태가 바뀜 | 다시 보낸 제출은 처음부터 다시 검사된다. 도구 호출은 `toolcall.approved` 뒤 `requested`로 돌아가 같은 검사를 다시 받는다 |
| E-16 | 모델이 거부를 계속 반복함 | 같은 멱등 키 재시도는 이벤트를 늘리지 않는다. 다른 키의 반복은 `command.rejected`·`toolcall.blocked`가 쌓이고 12의 step·tool-call 한도가 run을 끝낸다. 16이 반복 거부 패턴을 집계한다 |
| E-17 | 삭제 요청 | 삭제 명령은 없다. 폐기는 `record.superseded`, `goal.retire`, `concern.close(not_completed)`로 표현하고 이력은 남는다(원전 F01 §6 "삭제 = 의미적 폐기", 08 §3.4.8) |
| E-18 | 하위 Concern을 사람이 강제로 닫음 (규칙 4 예외) | 남은 하위·WorkUnit·반영 항목을 기록하고 복귀 요약에 보인다(08 §3.22.2) |
| E-19 | 비상 Grant로 활성화하려는데 상황 판정이 chaotic이 아님 | `denied.grant_not_applicable`. 에이전트는 상황 재판정(`situation.assess`)부터 한다. 비상 합의 남용을 막는다 |
| E-20 | 같은 프로젝트에 활성 합의가 둘이고 쓰기 범위가 겹침 | R-6 질문. 나중에 활성화된 합의의 겹치는 쓰기만 막는다 |
| E-21 | 외부 응답이 기대 기한 뒤에 도착 | 관찰은 그대로 기록되고 기대는 `late_fulfilled`(08 §3.22.8). 이미 만든 "응답 없음" 관찰은 지우지 않는다. 관련 Concern이 종료 상태면 다시 연다 |
| E-22 | 사람이 클라이언트 없이 오래 부재 | 커널 결정은 미루지 않는다. 전달·가정 처리는 11 §3.8 |
| E-23 | 데몬 모드가 `ready`·`safe_mode`가 아님 (17) | 프로토콜 계층(19 5001·5003)이 커널 앞에서 거절한다. 내부 제출(런타임·스케줄러)은 engine이 `path.store_read_only`·`path.fenced`로 거부한다. 커널 판정 규칙에는 모드 검사를 넣지 않는다(17 §5.2 질문에 대한 답) |
| E-24 | 텍스트 필드가 길이 상한을 넘음 | 거부하지 않고 앞부분만 남기고 원문은 blob(`textOverflow`)으로, `notice.text_truncated` (08 §3.4.1). 사람 입력이 사라지지 않게 |
| E-25 | 뜻 없는 사람 입력(`ㅇ`, `ㅁㄴㅇ`)으로 선택을 확정 | 스키마로 막지 않는다. 품질 단계가 qualified로 오르지 않아 활성 기준선이 되지 않고 주의 항목으로 보인다(08 §3.10.1, 원전 C6) |

## 5. 다른 문서와의 인터페이스

### 5.1 이 문서가 제공하는 것

| 대상 | 제공 |
|---|---|
| 06 | `decide`/`apply`/`react`, `KernelContext`, `Decision`, `Directive`, `Rejection`의 최종 형태(06 §5.2 요구). `EngineInput` 대응(§3.3.5) |
| 08 | 08 레코드를 만들고 바꾸는 명령 카탈로그(§3.11), `ProposalKind` 대응(§3.6.2), R-01~R-55의 코드 대응(§3.10), 범위 밖 갈래에 대한 답(§3.4.1) |
| 09 | `EventDraft` 형식, 이벤트 이름 사용 목록(§3.11 표), 거부 기록 이벤트(`command.rejected`), 결정성 계약(`ctx.now`, 파생 `newId`), `apply` |
| 11 | 단일 변경 경로, `needs_gate` 형식, 영향 계산(`impactOf`), 승인 대조 위치(P-3) |
| 12 | `checkSettle`, `pendingTimers`, `mustIncludeRefs`, `allowedCommands`, `viewAt`, 지시 목록, 런타임 채널 명령(§3.11.7) |
| 13 | `toolcall.intend`·`toolcall.complete` 입력 형식, `PermissionInput`, 보장 수준 표, 어댑터 적합성 대본 |
| 14 | 의존 규칙 집행과 거부 사유의 규칙 번호, 오케스트레이터 명령(§3.11.3), 루프 계약을 읽는 자리 |
| 15 | 승격 규칙, 추측·근거·구분 확인·반증 탐색 명령 |
| 16 | 측정 재료 이벤트(거부, 자율 결정, 확인·이의, 사람 조작 수), 공리별 지표 열, 관찰 에이전트 명령 |
| 19 | 거부 코드와 갈래, 명령 목록, `subjects()`(낡음 검사 대상), `next` |
| 05·04·20·21 | 거부 메시지 형식, `enforcement` 표시 요구 |
| 22·23 | 속성 테스트 PT-01~19, 첫 대본, 재생 테스트 경계 |

### 5.2 다른 문서에 요구하는 것

2a단계에서 다시 정리했다. 08·09가 받아들인 요구(범위 밖 갈래, `decisionKind`·`decisionPointKey`, `narrowedScope`·`checkBack`·`allowUnknownTargets`, `reworkOf`, `rb`, `decision.confirmed`, `agreement.narrowed`·`restored`, `watch.*`, `rollback_point.*`, `boundary.reached`, `policy_proposal.deferred`, `command.rejected` payload)는 뺐다.

| 대상 | 요구 |
|---|---|
| 08 (P5) | (1) 11 §5.2의 질문 필드·`Trigger` 확장. (2) 2a 판정 J-35: 결과 확인 명령 값과 기록 값 대응 한 줄(§10). (3) J-54 `reworkOf.steps`(선택). (4) J-55 질문 종류 `goal_achievement`. (5) J-38에 따라 `run.resumed`·awaiting 재진입 전이 제거(이 문서는 `run.resume` 명령을 뺐다). (6) `Check`(구분 확인)에 사람의 순서 고정(`pinned`) 표시 |
| 09 (P5) | (1) J-63: `boundary.reached.boundary`를 일곱 값(round_end, workunit_end, loop_transition, concern_waiting, user_return, review_window, daily_rollover)으로. (2) J-52: `question.delivered`에 `channel`(경로)과 `surface`(표시 방식 배열), `urgency`는 interrupt·notice·digest. (3) `check.pinned` 이벤트(§3.11.11 `check.pin`). (4) `setting.change`의 기록 이벤트(`setting.changed`) 또는 설정을 이벤트로 남기지 않는다는 결정. (5) `question.answered`에 `matchesRecommendation`(16) |
| 06 (P3) | `SubmitResult`에 `needs_gate`(질문 ID 포함). `KernelContext.attention`(방해 금지, 주의 예산 상태). presence는 ctx가 아니라 상태다. engine이 넣는 `newId`를 파생 구현(§3.1.3)으로 |
| 12 (P7) | (1) 명령 이름을 이 문서로: `toolcall.report_unknown`(12의 `toolcall.outcome_unknown`), `toolcall.recover`, `runtime.boundary`(12의 `boundary.reach`, payload는 14 §3.13.6), `presence.update`, `run.await`, `run.record_message`, `run.record_context`, `toolcall.skip`. (2) `run.end`는 08 `RunEndReason`, 사람 대기 뒤에는 `handed_off` + 같은 thread 새 run(J-38). (3) 읽기 빠른 경로와 제안 도구 호출의 한 트랜잭션 기록(J-43). (4) 결과 불명은 `externalEffect`를 계산해 보낸다(J-05, J-44). (5) 지시 `run.signal(wrap_up)` 처리 |
| 13 (P7) | (1) Helm 제안 도구를 §3.11.11 (3) 표에서 생성(도구 이름 = `helm_` + 명령 이름). 13 §3.7.2의 1판 이름(`helm_concern_split`, `helm_rework_plan`, `helm_contest_resolve` 등)을 바꾼다. 1차 런타임은 `loop.transition`을 도구로 내놓지 않는다(J-65). (2) 코드 이름 `content.rollback_point_required` → `policy.rollback_point_required`. (3) 지문 정규화 함수를 `@helm/domain`에. (4) 금지 자원 거부는 `policy.forbidden_resource` |
| 14 (P8) | (1) 오케스트레이터 명령은 §3.11.3·§3.11.11의 이름(`runtime.boundary`, `entry.evaluate`, `runtime.signal`, `mode.route`, `structure.*`, `probe.*`, `watch.*`). (2) 규칙 기반 결정의 `whyNotAsked`는 08 `rule`. (3) 질문 종류는 08 `QuestionKind`. (4) 주의 예산 상태를 `KernelContext.attention`으로 |
| 15 (P9) | (1) 명령 이름은 §3.11.11 (1)(`inquiry.open`·`anchor`·`perspective.add`·`cell.update`·`round.start`·`round.close`·`stage.complete`·`stop`, `possibility.dismiss`·`merge`·`pin`·`unpin`, `lens.*`). (2) 구분 확인 선언 페이로드는 08 `DiscriminatingCheck`. (3) 예측 결과 이름은 08(`indeterminate`). (4) 반증 탐색 도구 호출에 `purpose: 'counter_search'` |
| 16 (P10) | (1) `observer.report.submit` → `observer_report.recorded`, 실행 수명도 `observer.report.submit`(16 §3.15.1 표). (2) 기각은 `policy_proposal.dismissed`. (3) 측정 명령 이름(§3.11.11): `surprise.report`, `resumption_check.*`, `self_report.submit`, `view.record`, `experiment.set_condition` |
| 18 (P11) | (1) 통치 명령(`device.*`, `pairing.create_code`, `admin.*`)의 주체 규칙. (2) 사람 결정 명령의 주체(`device`·`localAdmin`)를 접수에서 확인하는 방법(§3.3.2). (3) `runtime.exit_safe_mode`를 부를 수 있는 주체 |
| 19 (P12) | (1) §3.7.1 "커널 명령" 열을 §3.11.11 (2) 표로. 19가 요구한 `content.already_resolved`·`content.superseded`는 `conflict.already_resolved`·`conflict.superseded`(갈래 내용, 상태 conflict)로 3008·3009. (2) `subjects()`는 §3.11.12. (3) 이의 대상은 08 `ObjectionTarget`(J-36). (4) 거부 갈래 이름은 `authority`(`qualification` 아님) |
| 04 (P2) | 명령 의도 대응은 §3.11.11 (2) 표. 사람의 모드 지정은 `mode.set` |
| 22·23 | §3.17 테스트를 전략과 순서에 반영. 커널과 C/A 명령을 가장 먼저 구현(브리프 §3.5 C/A 우선, 대화 X3-8-28) |

### 5.3 다른 문서가 이 문서에 요구한 것과 처리

| 요구한 문서 | 요구 | 처리 |
|---|---|---|
| 01 | R-OP-2 두 경우의 검사, 가벼운 작업의 압축된 C, 의존 규칙 (5) MVP 집행, 사람 결정은 사람 경로로만 | (a) Grant 포함 검사(§3.6.7). (b) 직접 지시 echo는 사람 채널 `agreement.propose` + `confirmNow`(08 활성화 경로 `direct_instruction`). 가벼운 작업도 의존 규칙 (1)(2)를 받으며 프로젝트별 "가벼운 작업" 보관 Concern 아래에서 압축형으로 충족한다(2a 판정 J-01). 규칙 5는 §3.8에서 MVP부터 집행. 사람 결정 경로는 V-CH-02 |
| 02 | 거부 사유 코드, R-OP-2, 반영 항목 위임 닫기, 질문 cursor 묶임(CX-01), 같은 cursor 충돌(AC-07-13) | §3.4.4. 반영 항목 중 관찰로 확인되는 종류(`docs_tests`, `boundary_check`, `recombine`)는 에이전트 제안 + 근거로 커널이 닫는다(R-21, §3.11.8). 질문 답은 `basisSeq`로 묶이고(§3.3.4), 같은 질문에 두 답이 오면 뒤의 것이 `conflict.already_resolved` |
| 04 | 명령 의도 최종 이름, 모든 결정 명령의 `basisSeq`와 낡음 거부 구분 | §3.11.11 (2), §3.3.4(`conflict.version_mismatch`·`already_resolved`·`superseded`) |
| 06 | `EngineInput`·`SubmitResult`·`Rejection`·`Directive`의 최종 타입, `KernelContext`로만 시각·ID | §3.1, §3.3.5. `needs_gate`를 06에 요구 |
| 07 | 커널 도구 검사가 실행 인자를 바꾸는 경우 A4의 `{ args }` | 커널은 인자를 바꾸지 않는다. 사람이 고쳐 허락한 인자(`toolcall.approved.editedArgs`, J-40)와 권한 레이어의 정규화는 런타임이 `beforeToolCall`의 `{ args }`로 넘긴다(12 §3.4.5). 원래 인자는 `modelArgs`, 실행 인자는 `executedArgs`(08) |
| 08 | R-01~R-55 구현, `ProposalKind` 대응, 버전 검사는 커널, `concern.reframe`의 `choice.committed`, presence는 영속 이벤트에서, `indeterminate` | §3.10(R-47~R-55 표 포함), §3.11.11 (3), §3.3.4, §3.11.3, §3.5(`state.presence`), §3.11.4 |
| 09 | `KernelView`, 거부·충돌·게이트 모두 `command.rejected`(J-25), 버전 검사 커널, 멱등 범위, authority 문자열(J-27), plane null, V-INV-08 예외, 코드 추가, TimerPurpose, `causationId` | §3.5, §3.1.4, §3.3.4, §3.3.1, `EventDraft`(§3.1.4), V-INV-08, §3.4.4, §3.11.10 |
| 12 | interrupted run의 새 attempt, 결과 불명 `requiresHuman`, 해시 증명 적용, `run.cancel`, `runtime.exit_safe_mode`, 작업 공간 밖 쓰기 부여 거부, `checkSettle` 키, `mustIncludeRefs`, 승인 계획 저장 | `run.start` 재시작(§3.11.7), `toolcall.report_unknown`의 `externalEffect`(J-05·J-44), `toolcall.complete.recovered = hash_verified`, §3.11.11 `run.cancel`·`runtime.exit_safe_mode`, 작업 공간 밖 쓰기 부여는 `invalid.agreement_content`(V-POL-01), §3.18.2, 승인 계획은 도구 호출 레코드(`modelArgs`·`approvedArgs`)와 질문 `approval`(11 §3.14) |
| 13 | `x-helm-generated` 주석, 작업 공간 밖 쓰기 부여 거부, 대응 명령 없는 제안 종류, `net:` 자원 | 명령 스펙의 `payloadSchema`에 커널이 채우는 필드를 `x-helm-generated`로 표시한다. 제안 종류 대응은 §3.11.11 (3)(남은 것 없음). `net:` 자원은 08 `ResourceScope`를 범위 검사(§3.6.6)에 그대로 쓴다 |
| 14 | R 채널 명령, `situation.assess` 필드, `openedVia` observer, `reopenTo`, `wrap_up`, 합의 초안 폐기, 탐구 합의 규칙 활성화, `ruleId`, 질문 종류 | §3.11.3(R 허용), R-47·08 `SituationAssessmentCore`(숫자 확신 없음, J-19), 08 `ConcernOrigin.kind = observer`, `result.accept`의 `reopenTo`(기본 직전 I), `runtime.signal`, `agreement.discard`, `agreement.propose`의 탐구 합의(쓰기 없음)는 `agreement.activated_by_rule`, 거부 `ruleId` 유지, 08 `QuestionKind`. `entry.evaluate`, `mode.set` 추가 |
| 15 | 탐구 명령, `claim.declare_discrimination` 페이로드, `prediction.check` 결과 이름, 멱등 키, 반응 기록과 `stimulus.present`를 I.want 밖에서도 | §3.11.11 (1). 모든 명령은 envelope의 `idempotencyKey`를 가진다(엔진 명령은 `engine:<inquiryId>:<step>` 형식 권장). 반응 기록·자극 제시의 루프 제한은 두지 않는다(I.possibility, I.fact 대비 화면 허용) |
| 16 | 제안 페이로드, `observer.report.submit`, 채택·기각·나중에, 금지 패치 검사, `patch.from` 비교, 적용 Concern 파생, 고아 이의 | §3.11.10, V-POL-01, G-K4~G-K6 |
| 17 | 데몬 모드가 준비 아닐 때의 거부 | E-23 |
| 18 | 사람 결정 명령은 `human_client` + 주체 `device`·`localAdmin`만 | §3.3.2, V-CH-02, `denied.channel` |
| 19 | 커널 명령 이름 확정, `subjects()`, `content.already_resolved`·`superseded`, `decision.contest` 대상 확장, 사람 채널 `next` | §3.11.11 (2), §3.11.12, §3.3.4, 08 `ObjectionTarget`(record + itemKey, link), §3.11.12 끝 |

## 6. 구현 단위와 완료 기준

### 6.1 파일 구성

```text
packages/kernel/
  package.json              # 의존: @helm/domain, typebox. 그 밖 금지 (06 R4·R5)
  src/
    index.ts                # decide, apply, react, 조회 함수, loadRuleBundle 공개
    context.ts              # KernelContext, RuleBundle, loadRuleBundle (V-POL-01 적재 검사)
    decide.ts               # 상자 1~9 실행, 결과 조립, 사후 검사 호출
    path.ts                 # V-PATH, V-CH
    form.ts                 # V-FORM, V-VER (TypeBox 컴파일 검사기 캐시), 텍스트 자르기
    capability.ts           # V-CAP (08 CAPABILITY_TABLE + ProposalKind 대응)
    policy/
      scope.ts              # covers, match, patternContains
      grant.ts              # contains (권한 이어 쓰기)
      rights.ts             # 권리 게이트, 승인 대조 (11 §3.14)
      independence.ts       # 결과 생산 실행 루트 계산
      policies.ts           # PolicyRule 평가
    rules/
      dependency.ts         # V-DEP-1~5
      constraints/          # 08 R-01~R-55 (파일 하나에 R 하나, 08 가드 id와 같은 이름)
      promotion.ts          # V-PRO-01·02 (08 promotionMissing 사용)
      autonomy.ts           # V-AUT-01~03
      machines.ts           # V-STA-01 (08 machines 데이터 해석)
      guards.ts             # G-K1~G-K6
    commands/               # 명령 스펙 (payloadSchema, channels, requires, humanOnly, subjects, evaluate)
      project-goal.ts concern-structure.ts loop.ts workunit.ts epistemic.ts check-finding.ts
      choice-objection.ts grant-agreement.ts run-toolcall.ts result-obligation.ts question.ts(11)
      time-dial-policy.ts observer.ts registry.ts
    apply/                  # 이벤트 타입별 적용, revisionSeq·humanOps·links·objectedDecisionPoints 갱신
    react/                  # R-1 ~ R-12
    asking/                 # 11의 게이트 판정, 전달 결정, 만료 계산 (11 §6)
    queries/                # pendingTimers, checkSettle, allowedCommands, mustIncludeRefs,
                            # impactOf, autonomousDecisions, humanOps, viewAt, explain
    directives.ts           # directivesFor(state, events)
    invariants.ts           # V-INV-01~12
  test/
    unit/                   # 명령·규칙·파생별
    property/               # PT-01~19, arbitraries.ts
    scripts/                # helm-toy.json, guided-001.json, c-a-flow.json, absent-user.json(11)
    golden/                 # 대본별 기대 이벤트 열
    regressions/            # fast-check 최소화 결과
```

### 6.2 완료 기준

| 단위 | 테스트로 확인할 조건 |
|---|---|
| 순수성 | ESLint R4·R5 위반 0건. `decide`를 같은 입력으로 1,000회 호출해 결과 해시 동일. 입력 동결 상태에서 예외 없음 |
| 경로·채널·형식·자격 | 모든 명령 × 허용되지 않은 채널 조합이 `denied.channel`. 모든 propose 명령 × 제안 종류 없는 역할이 `denied.proposal_kind`. 이벤트 envelope 제출은 `path.adapter_cannot_append_event` |
| 거부 분류 | PT-18·19 통과. 모든 코드가 08 `REJECTION_CODE_PATTERN`을 만족하고 `rejectionClassOf(code)`가 `rejection.class`와 같다 |
| 명령 카탈로그 | §3.11 표의 모든 명령에 정상 1건과 표의 주요 거부 코드마다 1건 |
| 08 제약 | R-01~R-55 각각 위반 사례 1건 이상이 08 표의 갈래로 거부(강등은 강등) |
| 상태 기계 | 08 §3.22 표의 모든 전이가 해당 명령으로 일어나고, 표에 없는 조합은 `conflict.invalid_transition` |
| 의존 규칙 | 규칙 1~5 각각 위반 사례 거부, 예외(Grant 활성화, 비상 Grant, 사람 force)는 통과, 거부 `missing`에 규칙 번호 |
| 승격 | helm-toy 대본 21단계가 §3.17.4 표의 결과와 같다. 사후 구분 확인은 승격에 세지 않는다 |
| 권한 | 원전 정리 2 §4.6 authority fixture 5개(비확장 활성화, 확대 시 gate, 멈출 조건 누락, 만료, 자기 Grant 불가)에 해당하는 08 Grant 판본 통과 |
| C/A 흐름 | 대화 X3-4-11 "한 턴의 흐름"을 대본으로: 합의 없는 쓰기 거부 → 합의 제안(check-back)·확정 → 쓰기 → 결과 제출 → 확인 → 반영 항목 → 완료. 사람 조작 2회. Grant 판본은 사람 조작 2회(Grant 발급 + 결과 확인) |
| 파생 | R-1~R-12 각 계기 → 기대 파생 이벤트. 낡음 전파가 순환 없이 끝남 |
| 속성 | PT-01~19를 시드 100개 × 열 길이 200으로 통과 (CI는 시드 20개) |
| 사후 검사 | V-INV 각 항목을 일부러 깨는 가짜 명령 스펙으로 `kernel.invariant_violation` 확인 |
| 성능 | 이벤트 10만 건 상태에서 `decide` p95 < 5ms(영향 계산 제외), `impactOf` p95 < 50ms [제안 목표] |
| 재생 | 대본별 골든 이벤트 열과 동일. 빈 상태에서 `reduce(apply)` = 단계별 상태 (PT-02) |

## 7. 미결 사항

| # | 질문 | 선택지 | 추천 기본값 |
|---|---|---|---|
| K-1 | 거부를 기준 원본에 남길까 | (a) 이벤트로 남김 (b) 운영 로그에만 | (a). A14와 관찰 에이전트 입력. 양이 문제가 되면 같은 run·같은 코드 연속 거부를 하나로 묶는 압축을 09가 검토 |
| K-2 | 동시성 검사 단위 | (a) 대상 revisionSeq와 basisSeq (b) 전역 cursor(v0.2) | (a). 사람 부재 중 작업이 계속되므로 |
| K-3 | 읽기 도구의 의도 이벤트 | (a) 남김 (b) 읽기 빠른 경로 | 2a단계에서 (b)로 정리됨: 08 §3.18.2의 읽기 빠른 경로(한 트랜잭션에 requested·started·completed). 제안 도구 호출도 같음(J-43) |
| K-4 | Quick/Guided/Assured의 위치 | 2a 판정 J-12로 정리됨: 증명 부담 다이얼 값 가볍게/보통/엄격, 기본 보통 | - |
| K-5 | 범위 밖 호출의 갈래 | 2a 판정 §1로 정리됨: 자격(`gate.scope_expansion_required`), 금지 자원은 내용(`policy.forbidden_resource`) | - |
| K-6 | 결정에 쓰이는 판단의 사람 확인 | (a) 질문(막지 않음)으로 확인 (b) 확인 없이 qualified로 사용 | (a). 증명 부담 다이얼이 낮으면 (b) |
| K-7 | 에이전트의 반영 항목 미룸 | (a) 허용 + 복귀 요약 맨 위 표시(08) (b) 사람만(14 요구) | (a). 08과 맞춤. 2주 지표 "열린 반영 항목 수"에 미룬 항목을 따로 센다 |
| K-8 | 자원 패턴 문법 | (a) glob 두 기호 (b) 정규식 | (a). 13이 확정 |
| K-9 | 거부 이벤트를 복귀 요약에 보일까 | (a) 개수만 (b) 목록 (c) 안 보임 | (a). 03·04가 확정 |
| K-10 | 의미 충돌(R-6) 탐지 범위 | (a) 쓰기 자원 겹침 (b) 모델 판정까지 | (a) |
| K-11 | 파생 반복 한도(8) | 수치 | 그대로 두고 운영 로그로 조정 |
| K-12 | 명령 수 (2a에서 약 150개) | (a) 그대로 (b) 일부를 페이로드 kind로 합침 | (a). 명령 이름이 감사 기록의 의미 단위다. 구현은 가족별 파일로 나눈다 |
| K-13 | 런타임(오케스트레이터)이 보내는 구조 명령의 행위자 | (a) `runtime` + `declaredBy` (b) 모델 run의 `agent:*` | (a). 14가 런타임 행위자로 보내기로 했고, 결정 주체는 `Autonomy.decidedBy`(선언한 run의 역할)로 남는다 |

## 8. 출처

### 8.1 참고한 자료

| 자료 | 위치 | 쓴 곳 |
|---|---|---|
| 설계 브리프 | `docs/design/process/00-design-brief.md` 결정 2, 4, 5, 8, 12, 14, 15, 17, 18, 22, 23, 28~30, 34, 36, §3, §3.5 | 전체 |
| 다른 설계 초안 | `docs/design/08-domain-model.md`(§3.2~§3.4, §3.8~§3.13, §3.18~§3.24, §5.2), `06-system-architecture.md`(§3.4.4, §3.4.6, §5.2), `12-runtime-engine.md`(§5.2), `14-loops-modes-orchestration.md`(§3.18, §5.2), `15-inquiry-engine.md`(§3.13), `16-observer-and-metrics.md`(§5.2), `19-client-protocol.md`(P-09, §3.7, §5.2), `01`·`02`·`04`·`07`·`17`·`18`의 §5.2 | §2.4, §5.3 |
| v0.3 개정 문서 | `docs/v0.3/00-README.md` §2.4(불변조건), 02 §1~§9, 03 §3·§5·§6, 06 §3·§4, 07 §2·§3, 08 §2·§4·§5·§6·§8 | §2, §3 |
| 감사 보고 | `docs/v0.3/audit/audit-report.md` §3.4, §3.5, §3.6, §3.10, §4 | §3.4, §3.9, §3.15, §3.17.4 |
| Mastra 검토 | `docs/v0.3/audit/mastra-review.md` §4(승인-인자 지문), §5(suspend/resume, 선도착 답) [원문·실험] | §3.4.5 |
| 장난감 커널 | `experiments/helm-toy/helm.mjs` [원문] | §3.4.1, §3.9, §3.17.4 |
| 원전 정리 1 | `sources/helm-canon.md` §5, §9, §10, §11.12, §12, §13, §16, §20, §21 | §3.6, §3.15, §3.16 |
| 원전 정리 2 | `sources/helm-canon-2.md` §1.3, §1.8, §1.10~1.12, §1.14, §1.23, §1.25, §4.6, §7.3, §9.2~9.4, §9.14, §10, §11 | §2.3, §3.6.7, §3.17 |
| 원전 정리 3 | `sources/helm-canon-3.md` §3.3, §4.11~4.14, §7.1, §7.2, §8 | §3.15, §3.6.4 |
| 대화 발췌 1~4 | `sources/conversation-extracts-1.md` E1-059~064, `-2.md` §6(X2-6-02~19), 9.d, `-3.md` X3-2·X3-3-10·X3-4-11·X3-5-04·X3-8·X3-9-25~31·X3-10, `-4.md` 1-3, 1-5~1-18, 1-28·1-29, 1-31~1-36, 9-4, 9-19, 11-4, 21(d) | 전체 |
| pi API 확인 자료 | `sources/pi-api-facts-1.md` §0 1·3·4, 훅 표(`agent/src/agent-loop.ts`, `agent/src/types.ts`) [원문·실험] | §3.18.2 |

### 8.2 원천 체크리스트 반영

| 원천 항목 | 반영 위치 / 반영하지 않은 이유 |
|---|---|
| canon-1 §21 10: 공리 A1~A15 전체 대응, A11 투영 규칙, A15 선택지 | §3.15 (A11 생성 쪽은 12) |
| canon-1 §21 10: 불변조건 집합 전부와 v0.3 1~7 대응표 | §3.16.1, §3.16.2 |
| canon-1 §21 10: Decision 전이 규칙 7, WorkUnit 진입 조건, Claim·Evidence 승격 규칙 | 승격 §3.9, WorkUnit 진입 08 R-02(커널 집행), 합의 전이 08 §3.22.4. Decision 7단계 상태 기계는 채택하지 않았다: v0.3에서 Choice는 사람 확정·정책 적용 때만 생기는 레코드이고(08 §2.3) "Framed → AlternativesIdentified → Deliberating"은 질문(11)과 가능성·탐구(15)가 맡는다. 7단계의 "결정 질문·소유자·why-now"는 Choice·질문 필드, "대안과 현상 유지"는 Choice `alternatives`, "권한 있는 행위자·근거·재검토 조건"은 R-15와 `reviewTrigger`로 반영 |
| canon-1 §21 10: `RequestedAuthority ⊆ CurrentAuthorityGrant`, "이미 맡겼다"로 권한 이어지지 않음 | §3.6.7 |
| canon-1 §21 10: 자동 승격 금지, 쓰레기 입력이 blind spot 없음으로 승격되지 않음, 독립성 표시 | §3.9, E-25, V-POL-07 + 08 Acceptance `independence` |
| canon-1 §21 10: `ConflictDetected` + 별도 Concern, last-write-wins 금지, 의미적 lease | R-6 질문. 별도 Concern 자동 생성은 하지 않았다(커널이 Concern을 만들면 진입 규칙과 맞지 않음). 사람이나 에이전트가 질문 답으로 Concern을 연다. lease는 합의의 `implementsChoices`·`goal` 의존과 쓰기 자원으로 대신한다 |
| canon-1 §21 10: 위반 Event는 거부하거나 명시적 예외 Decision → 거부 분류 | §3.4. 예외 Decision은 사람 force(규칙 4)와 `acknowledgedFlags`(V-INV-06)로 한정 |
| canon-1 §21 10: Quick/Guided/Assured와 모드·다이얼 관계를 미결로 | §7 K-4 |
| canon-2 §11 10: 단일 변경 경로, adapter Event append 금지, projection 어휘 쓰기 금지 | §3.2, V-PATH-01·02 |
| canon-2 §11 10: Command 전이 표 13행을 출발점으로 | §3.11, 대응 §3.17.5 |
| canon-2 §11 10: 권한 포함 검사 알고리즘과 scope 규칙 한계 | §3.6.6, §3.6.7 |
| canon-2 §11 10: Policy 출력 형태와 write result 형태 | `Decision`·`Rejection`(§3.1.4, §3.4.2). v0.2 `require_evidence`는 내용 거부, `require_gate`는 `needs_gate`, `conflict`는 같은 이름 |
| canon-2 §11 10: Effect class R0~R4는 판정 범위 밖, 선언·표시만 | §3.6.5 |
| canon-2 §11 10: Gate rule 3조건과 4조건 정리, Gate Event와 알림 분리, 중복 알림 금지 | 11 §3.3, §3.5, V-Q-05 |
| canon-2 §11 10: idempotency key 범위, 지문 비교, external observation 범위 | engine 접수(06·09)에 요구(§5.2). 외부 관찰의 멱등은 08 R-06(channel, actor, externalId) |
| canon-2 §11 10: expectedCursor 필수와 rebase | 대상 revisionSeq와 basisSeq로 바꿈(§3.3.4, K-2), rebase 응답 유지 |
| canon-2 §11 10: 의미 충돌과 semantic intent | R-6 |
| canon-2 §11 10: 불변조건 테스트 57개, acceptance 13개, helm-toy 8건 첫 대본 | §3.17.4, §3.17.5. acceptance 13개 중 커널 해당(4 우회 금지, 7 Event 위조 불가, 8 last-write-wins 없음, 9 projection 어휘, 10 낮은 품질 승격 금지, 12 enforced·advisory 구분, 13 재시도 중복 없음)은 PT·V-INV로. 나머지(제품 순서, 두 runtime 통과 등)는 브리프 결정 34에 따라 이후 단계 |
| canon-2 §11 10: 공리 대응표에 paper Foundation 추적 | §3.15 "출처 방법" 열 (canon-3 §3.3 대응) |
| canon-3 §8 10: 공리 표 출처 방법 열 | §3.15 |
| canon-3 §8 10: 발화와 상태 전이 분리 | §3.2, §3.14 |
| canon-3 §8 10: 완료 주장 → 확인 → 반영을 다른 명령으로, 완료 주장을 바로 확인으로 바꾸는 경로 차단 | §3.11.8, V-INV-05 |
| canon-3 §8 10: 반증 조건 없는 추측 승격 불가, 같은 원천 근거 중복 금지, 다수 에이전트 합의 불인정 | 08 R-08(`falsifier` 필수), V-PRO-01·02 |
| canon-3 §8 10: 근거 무효화 시 의존 판단·선택 전파 | R-2, R-3 (08 §3.21.3) |
| canon-3 §8 10: Goal 변경, 상위 목적 재해석은 권리 게이트 | 의존 규칙 5, 질문 goal_revision(권리) |
| canon-3 §7.2 G2: Request → Offer/Counteroffer → Commitment → Breach/Renegotiation | 08 §3.22.4 대응(Request = proposed, Counter = revised, Accept = confirmed, Renegotiate = renegotiated, Breach = violation_detected)을 명령으로 집행 (§3.11.6, §3.12) |
| canon-3 §7.2 G13: semantic preview | 결정 주체 원칙으로 흡수: 자연어 발화는 제안 초안이 되고(12·05), 상태 변경은 명령으로만 |
| 발췌 3 Q1 C/A 상태 기계 빠진 전이 | 08 §3.22.3·§3.22.4(08이 채움), §3.12 흐름표 |
| 발췌 3 Q7 도구 이름 통일 | 명령 `agreement.propose`, `result.submit`. 모델 도구 이름(`helm_*`)은 13이 명령에 대응 |
| 발췌 3 Q13 능력 7개와 두 층 대응 | §3.6.2 (08 §3.3.4) |
| 발췌 3 Q14 품질 상태 전이표 | 08 §3.21. 커널은 그 이벤트를 만든다 |
| 발췌 3 Q17 단일 변경 경로 상자 순서 | §3.2 |
| 발췌 3 Q19 Claim 스키마의 구분 확인 | 08 `dc` + §3.9 |
| 발췌 3 Q20 거부 분류 체계 | §3.4 |
| 발췌 4 d9 integrate 소유, send·ask 묶음 | §3.6.2. 모드 묶음은 14 |
| 발췌 4 d17 의존 규칙 4·5 문구와 집행 지점 | §3.8 |
| 발췌 4 d20 자기 결과 증언 금지를 위한 결과 작성자 추적 | V-POL-07, 08 `producerRunIds`·`rootRunId` |
| 발췌 2 d-2 "한 번 더 진행" 무한 반복 | §3.18.2 최대 2회 |
| 발췌 2 d-12 관찰 출처(외부 응답, 사람 관찰) | 08 `ObservationCore.source` 다섯 종류 |
| 발췌 1 E1-063 도구 승격 기준, bash 감싸기 | 13 소유. 커널은 `targetsKnown`과 사후 검사로 받는다 (§3.6.5, §3.18.3) |

## ADR 후보

### ADR-K1 단일 변경 경로와 순수 커널 (decide / apply / react)

- 상태: 제안
- 맥락: 브리프 결정 14는 "모델은 제안하고, 커널이 상태를 바꾼다"를 정했다. v0.2 실행 후보는 `transition(command, state)` 하나에 저장 계층이 붙어 Claim·질문·파생 규칙을 넣을 자리가 없었다. 06은 커널을 순수 패키지로, 트랜잭션을 `@helm/engine`으로 나눴다.
- 결정: 커널을 세 순수 함수로 나눈다. `decide`가 판정과 이벤트 초안, `react`가 같은 트랜잭션의 파생 이벤트, `apply`가 상태 적용을 맡는다. 시각은 `ctx.now`, 새 ID는 `ctx.newId`이며 engine은 commandId에서 파생하는 구현을 넣는다. 반환 전에 사후 검사(V-INV)를 돈다.
- 근거: 같은 입력 같은 이벤트(속성 테스트 가능), 재생은 `apply`만으로 가능, 파생 규칙에서 나는 거부(감사 §3.5)를 커밋 전에 판정, 버그가 불변조건을 깨는 이벤트를 커밋하지 못함.
- 기각한 대안: (a) 이벤트 뒤 규칙 평가를 비동기로 — 파생 실패가 기준 원본에 반쯤 반영된 상태를 남긴다. (b) 커널이 ULID를 직접 생성 — 결정성이 깨진다.
- 결과: engine은 single writer로 상태를 메모리에 둔다. 규칙 데이터 버전을 이벤트에 남긴다.

### ADR-K2 대상 레코드 revisionSeq 기반 낙관적 동시성

- 상태: 제안
- 맥락: v0.2는 모든 명령에 전역 `expectedCursor`를 요구했다. Helm은 사람이 없을 때도 작업이 계속되어 전역 cursor가 계속 움직인다.
- 결정: 사람 확정 명령은 화면이 본 `basisSeq`를 싣고, 커널이 `subjects()`의 각 레코드에 대해 `revisionSeq > basisSeq`면 충돌로 거부한다(08 §3.4.2, 09 §3.9.4). 전역 직렬화는 engine이 맡는다.
- 근거: 사람이 본 화면이 낡았을 때만 충돌이 난다. cursor에 묶인 Gate(L14)의 목적을 유지한다.
- 기각한 대안: 전역 cursor — 사람의 답이 거의 항상 충돌한다. 검사 없음 — 낡은 화면 위의 결정을 막지 못한다.
- 결과: 증언 같은 사건도 대상 revisionSeq를 올려 사람이 새 정보를 보게 한다.

### ADR-K3 거부를 이벤트로 기록하되 관찰로 만들지 않음

- 상태: 제안
- 맥락: A14와 대화 X3-8-06은 거부된 제안도 기록하라고 한다. L20은 차단된 호출은 관찰이 아니라고 한다.
- 결정: `command.rejected`(도구 호출은 `toolcall.blocked`)를 기준 원본에 남기되 관찰 레코드는 만들지 않는다.
- 근거: 관찰 에이전트가 반복 거부를 읽을 수 있고, 거부 기록이 판단의 근거로 인용되지 않는다.
- 기각한 대안: 운영 로그에만 — A14 위반, 관찰 에이전트 입력 손실. 관찰로 기록 — 근거 오염.
- 결과: 로그 양이 늘 수 있다(K-1).

### ADR-K4 없는 근거 ID는 거부, 서술만 있으면 강등

- 상태: 제안
- 맥락: helm-toy는 지어낸 근거를 거부하고, 대화 X3-2-11은 서술뿐인 기준을 "확인 못함"으로 기록하라고 했다. 08 R-07·R-17도 같다.
- 결정: 근거 입력을 레코드 ID와 서술 두 종류로 받는다. 형식은 맞지만 없는 ID는 `invalid.evidence_not_found`, 서술은 받아들이되 근거로 세지 않고 강등한다.
- 근거: 지어내기와 정직한 서술을 구분한다. 모델이 "근거 없음"을 숨기지 않고 서술로 남길 수 있다.
- 기각한 대안: 서술도 거부 — 모델이 근거 없는 기준을 빼거나 ID를 지어내게 만든다.
- 결과: 결과 확인 화면이 `unverified` 기준을 따로 보인다.

### ADR-K5 사람 결정 명령과 시스템 명령은 채널로 먼저 막는다

- 상태: 제안
- 맥락: helm-toy는 모델의 결과 확인과 도구 결과 위조를 자격 거부로 분류했다. L21과 18은 사람의 결정이 모델 도구 경로를 거치면 안 된다고 했다.
- 결정: 사람 전용 명령은 `human_client` 채널(via device·local_cli)만, 시스템 명령은 `runtime`·`scheduler` 채널만 허용한다. 위반은 자격 갈래 `denied.channel`이고 판정 순서의 두 번째다.
- 근거: 모델이 사람 행위자를 흉내 낼 경로가 없다. 능력표는 같은 채널을 쓰는 역할들 사이를 나눈다.
- 기각한 대안: 행위자 필드 검사만 — 행위자 값 위조에 기대게 된다.
- 결과: helm-toy 5·19는 `denied.channel`(자격)로 재현된다.

### ADR-K6 integrate는 에이전트 제안 + 커널 근거 검사

- 상태: 제안 (08 §3.12 규칙 6과 같음)
- 맥락: 작업 에이전트는 integrate가 없다. 반영 항목마다 사람이 닫으면 사람 조작 2회 상한을 넘는다.
- 결정: 에이전트는 근거와 함께 해소를 제안하고, 관찰로 확인되는 종류는 커널이 근거 관찰 실재를 확인해 닫는다. 판단이 필요한 종류(깨진 전제, Concern 충돌, 확인 조건)는 사람만 닫는다.
- 근거: 능력표를 바꾸지 않고 사람 조작을 늘리지 않으며, 근거 없는 해소는 막힌다.
- 기각한 대안: 에이전트에 integrate 부여 — A10이 약해진다. 사람만 — 2회 상한 초과.
- 결과: 반영 항목 해소 이벤트에 근거 관찰이 남는다.

### ADR-K7 판단 승격에 구분 확인 레코드와 출처 독립성

- 상태: 제안 (구분 확인 레코드는 08 D08-2)
- 맥락: 브리프 §3.5와 감사 §3.5는 구분 확인을 요구했으나 helm-toy와 v0.2 모두 필드가 없었다.
- 결정: 승격은 08 `promotionMissing()`(근거 품질·신선도, 사후가 아닌 구분 확인, 반증 탐색, 미해소 반대 근거)에 출처 독립성 검사를 더한다.
- 근거: 결정 주체 원칙(모델 선언 + 코드 계산). 원전 ACH·Abduction 규칙, F02 §9 원칙 7.
- 기각한 대안: 모델에게 "구분 확인인가"를 판정하게 함 — 코드가 집행할 수 없다. 출처 독립성 없음 — 같은 도구를 여러 번 돌려 근거 수를 늘릴 수 있다.
- 결과: 15의 탐구 절차에 선언 단계가 들어간다.

### ADR-K8 범위 밖 쓰기는 자격 갈래

- 상태: 2a단계 판정으로 채택 (조정자 판정 §1)
- 맥락: 브리프 §3.5는 거부 세 갈래를 P5·P6에 함께 맡겼다. 08은 범위 밖 호출을 내용 갈래(`policy.scope_exceeded`)로 제안했다.
- 결정: 자격 갈래 `gate.scope_expansion_required`로 둔다. 합의 없는 쓰기, 권리 게이트 승인 없음도 자격 갈래다. 금지 자원은 누가 보내도 거부되므로 내용 갈래 `policy.forbidden_resource`다.
- 근거: 합의 범위는 수행자에게 맡긴 권한이며, 권한을 가진 다른 행위자(직접 행동하는 사람, 범위가 넓은 합의의 수행자)가 보냈다면 통과한다(helm-toy 판정 기준). v0.2도 권한 부족을 자격으로 분류했다. 08의 접두사 규칙(`gate.*` = 자격)과 맞는다.
- 기각한 대안: 내용 갈래 — "누가 보냈어도 거부"라는 내용 갈래 정의와 맞지 않는다(사람은 합의 없이 직접 행동할 수 있다).
- 결과: 08이 2a단계 전에 이미 따랐다(08 §10.1). 범위 밖 = `gate.scope_expansion_required`, 금지 자원 = `policy.forbidden_resource`.
