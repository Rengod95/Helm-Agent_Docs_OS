# 25. 용어집

- 작성: 2026-10-12, T3(2b단계), 같은 날 4단계 보완. 기준: 브리프 결정 1~57, 조정자 판정 J-01~J-190, 설계 문서 01~26의 4단계 진행 중 판. 2b단계 대조는 12:47 판(`.helm-design-work/T3/snap0`)에서 시작해 13:42 판까지, §4.1의 줄 번호는 3단계 검증 1차 점검(`.helm-design-work/V2/A-n55-status.md`) 기준이다
- 이 문서는 이후 문체·용어 검증(3단계 V7), 구현, UI 문구(`@helm/ui-language`)의 기준이다.

## 1. 목적과 범위

### 1.1 목적

설계 문서 01~24가 쓰는 말을 한곳에 모은다. 항목마다 한국어 이름, 영어·코드 식별자, 정의, 화면 표시 이름, 정의한 문서·절, 혼동하기 쉬운 말을 적는다. 같은 대상을 문서마다 다르게 부른 곳은 §4 불일치 표에 모아 3단계 검증과 4단계 보완의 입력으로 넘긴다.

### 1.2 다루는 것

- 분야별 용어(§3.1~§3.11), 문서 표기와 구현 계획·테스트 용어(§3.12)
- 식별자 체계: ID 접두사(§3.13), 이벤트·명령·메서드 이름 규칙(§3.14), 오류·거부 코드(§3.15), 가설·지표 ID(§3.16), 문서 안 ID(§3.17)
- 금지·주의 표현(§3.18)
- 이름 불일치 표(§4)

### 1.3 다루지 않는 것

- 용어의 정의를 새로 만들지 않는다. 정의는 정본 문서의 것을 줄여 옮기고, 정본 문서·절을 함께 적는다. 정본끼리 다르면 §4에 적고 처리 제안을 붙인다. 정본으로 표시하는 것은 판정이나 소유 규칙이 있는 경우뿐이다.
- 이벤트 카탈로그 전체, 명령 전체, 메서드 전체, 화면 문구 키 전체를 다시 싣지 않는다. 목록의 정본은 09 §3.4, 10 §3.11, 19 §3.7, 05 §3.10.8·§3.11과 `@helm/ui-language`다. 이 문서는 이름 규칙과 자주 헷갈리는 이름만 싣는다.
- 22(테스트 전략), 23(구현 계획), 26(모바일 클라이언트)은 이 문서를 쓰는 동안 나왔다. 23이 등록을 요구한 말, 22 §1.3의 말, 26 결정 표의 이름만 넣었고 본문 대조는 4단계에서 한다(§5 M-01).

## 2. 규칙

### 2.1 정본을 정하는 순서

1. 브리프(`process/00-design-brief.md`)의 결정 1~57과 조정자 판정(`process/rulings-stage2a.md`, J-01~J-190).
2. 이름 소유 문서(판정 §1): 이벤트 이름·payload는 09 §3.4, 레코드 종류·필드·질문 종류·ID 접두사는 08(접두사 정본은 08 §3.2.2), 명령 이름은 10 §3.11, 프로토콜 메서드·오류 코드는 19, 화면 ID는 03, 유즈케이스 ID는 02, 패키지 경계는 06, 거부 갈래 이름은 10.
3. 화면 표시 이름은 03 §3.2·§3.3(객체 이름, 상태 라벨)과 05 §3.10(문구 지침, 용어집 초안 화면 열)을 따른다. 둘이 다르면 §4에 적는다.
4. 원전(foundations·friendly·product-language.yaml) 이름은 항목의 "혼동 주의" 칸과 부록 A 대응표에 적는다. 화면과 설계 본문은 브리프 §6과 위 정본의 이름을 쓴다(helm-canon-3 §1.3).

### 2.2 항목 표 읽는 법

| 열 | 뜻 |
|---|---|
| 용어 | 설계 본문에서 쓰는 한국어 이름. Goal, Concern, WorkUnit, Method Transfer는 영어 그대로가 정본 이름이다(J-21, 브리프 결정 13) |
| 식별자 | 영어 이름, 타입 이름, enum 값, ID 접두사, 이벤트·명령 이름. 코드 표기로 쓴다 |
| 뜻 | 한두 문장. 정본 문서의 정의를 줄였다 |
| 화면 | 사용자 화면에 보이는 이름(03·05·04 기준). "—"는 화면에 쓰지 않음, "개발자 보기"는 감사 깊이(03 §3.10)에서만 보임 |
| 정의 문서 | 정의한 문서·절. "08 §3.13"처럼 적는다 |
| 혼동 주의 | 비슷한 말과의 차이, 쓰지 않는 말. 쓰지 않는 말은 "쓰지 않음:" 뒤에 적는다 |

### 2.3 표기 규칙

- 설계 문서 본문은 한국어 한다체로 쓰고, 화면 문구는 합니다체·명사형 라벨·결과를 말하는 버튼을 쓴다(05 §3.10.3).
- 화면 문구에는 Goal과 Concern 말고 영어 명사를 쓰지 않는다(03 IA-03, 05 §3.10.3). WorkUnit은 번호 표기("WorkUnit 31")에만 쓴다(05 §3.10.8).
- 원론 용어(Normative, Claim, Acceptance 등)와 이벤트 이름은 개발자 보기에서만 괄호로 보조한다(03 §3.2.1).
- 영어 식별자는 코드 표기를 쓴다(브리프 §5.1). 이벤트는 `<대상>.<과거형>`(09 §3.3), 명령은 `<대상>.<명령형>`(10 §3.11), 메서드는 `<대상>.<camelCase 동사>`(19 §3.7.1)다.
- 같은 개념은 모든 화면과 TUI에서 같은 이름을 쓴다(03 §3.2.1, canon §17.2 원칙 5).

### 2.4 이 용어집을 쓰는 방법

- 문체·용어 검증(V7)은 §3의 "쓰지 않음"과 §3.18 금지 표현으로 문서를 검사하고, §4 표의 "다른 이름"이 남아 있는지 본다.
- 구현자는 식별자 열을 타입·상수 이름으로 쓴다. 식별자가 없거나 문서마다 다르면 §4의 정본 열을 쓴다.
- UI 문구 목록(`@helm/ui-language`, 05 §3.10.8)은 화면 열을 출발점으로 한다. 상태 라벨 목록은 §3.3 표와 03 §3.3이 같아야 한다.
- 새 용어가 필요하면 정본 문서에 먼저 정의하고, 이 문서에 항목을 더한다. 이 문서에만 있는 정의는 만들지 않는다. 예외로 이 문서가 정본인 이름은 §4.1 N-53(제공자)과 §3.11의 OPD+C 의무 ID 형식이다.

### 2.5 문서 구성과 브리프 §5.3의 대응

이 문서는 실행되는 부품을 정하지 않으므로 브리프 §5.3의 여덟 절을 다음처럼 대응시킨다.

| 브리프 §5.3 절 | 이 문서 |
|---|---|
| 1 목적과 범위 | §1 |
| 2 전제와 결정 | §2(정본 순서, 표기 규칙). 기대는 결정은 브리프 결정 13·25·37과 판정 J-09·J-10·J-21·J-111~J-116·J-144다 |
| 3 명세 본문 | §3 |
| 4 실패·예외·경계 사례 | 해당 없음(실행 동작이 없다). 이름이 문서마다 다른 경계는 §4에 모은다 |
| 5 다른 문서와의 인터페이스 | 제공: §3·§3.13~§3.18을 문체·용어 검증, 구현, `@helm/ui-language`에 준다. 요구: §4.1 "처리 담당 문서" 열이 문서별 요구다 |
| 6 구현 단위와 완료 기준 | 해당 없음(코드 단위가 없다). 다만 `@helm/ui-language`의 상태 라벨·금지 표현 목록이 §3.3·§3.18과 같은지 05 §6 문구 테스트가 검사하고, 카탈로그 이름은 23 D23-10 동기화 검사가 본다 |
| 7 미결 사항 | §5 |
| 8 출처 | §6, 부록 A |

## 3. 본문

### 3.1 이론·개념

| 용어 | 식별자 | 뜻 | 화면 | 정의 문서 | 혼동 주의 |
|---|---|---|---|---|---|
| 원함 발견 | want discovery | Helm의 출발 동기. 사람이 글로 쓴 요구와 실제 요구가 다를 수 있고, 자극을 비교해 본 뒤에야 원하는 것을 알게 된다는 전제 | — | 브리프 결정 1, 01 PR-03 | 원함 탐구(`I.want`)는 이 동기를 위한 루프다. 둘을 같은 말로 쓰지 않는다 |
| 발산 | divergence | 원함 발견을 위해 여러 관점·후보·자극을 만드는 방법. 15의 발산 서브시스템 일곱 단계로 실행한다 | — | 브리프 결정 1, 15 §3.4 | 선택지를 많이 만드는 것 자체가 목표가 아니다(01 PR-03). 대안 2~3개를 주고 고르게 하는 상호작용은 거부되었다(결정 18) |
| 초안·반응 원칙 | recognition over recall | 모델이 초안을 쓰고 사람은 반응·수정한다. 사람에게 빈칸을 채우게 하지 않는다 | — | 브리프 결정 18, 01 PR-01 | 승인 버튼만 주는 확인(approval theater)과 다르다 |
| 다섯 평면 | N, E, M, A, P (`plane`) | 세계 모델의 다섯 구분. N 방향(Normative), E 이해(Epistemic), M 실제(Material), A 참여자·능력(Authority), P 정책(Policy) | 방향 / 이해 / 실제 변화(N/E/M만, 03 §3.9) | 08 §3.1.1, 09 §3.2 `plane` | 화면에 Normative·Epistemic·Material을 쓰지 않는다(05 §3.10.9). 관찰은 E에 속한다(M 아님, 08 §3.1.2) |
| A/P 판별 질문 | — | "일하는 도중에 상황이 바뀌면 답도 바뀌는가?" 바뀌면 P(정책), 언제나 같으면 A(능력) | — | 브리프 §6, 08 §3.1.1, 10 §3.6.1 | A의 "Authority"는 권한 레이어(결정 2)와 다르다 |
| NEMAP | — | 상태 묶음. 무엇이 기록되고 누가 어떤 조건에서 바꿀 수 있는가(N/E/M 레코드, A 능력표, P 정책) | — | 08 §3.1.3, 14 §3.1 | OICA·OPD+C와 같은 종류의 대상이 아니다(흐름·평가) |
| OICA(+S) | O, I, C, A, S | 흐름 묶음. 지금 무엇을 하고 다음에 무엇을 하는가(루프 계약, 계획, 전환) | — | 14 §3.1 | 여기의 A(Assure 계열 루프)와 평면 A(능력)는 다르다 |
| OPD+C | Observability, Predictability, Directability, Contestability | 평가 묶음. 사람이 일을 따라가고(O) 예상하고(P) 방향을 바꾸고(D) 이의를 걸 수 있는가(C) | — | 03 §3.1.3, 14 §3.5.5, 16 §3.23.2 | OPD+C의 O·P는 루프 O, 평면 P와 다르다. 화면에 원어를 쓰지 않는다 |
| OPD+C 장기 관찰·제어 공간 | — | 결정 10의 클라이언트 주 구현 대상. 대화 중심이 아닌 상태 중심 UI | — | 브리프 결정 10, 03 §3.1 | 대화 화면(`SCR-THREAD`)은 보조 수단이다(01 PR-08) |
| 불변조건 1~7 | INV1~INV7 | v0.3 불변조건. 1 기록과 진실은 다르다, 2 관찰·추측·판단·선택은 다르다, 3 투영은 정본을 쓰지 않는다, 4 권한은 범위를 가진다, 5 완료 주장·결과 확인·전체 반영은 다르다, 6 모르는 것·이견·낡은 상태는 숨기지 않는다, 7 혼자 정한 결정도 기록되며 이의를 걸 수 있다 | — | 브리프 결정 17, 08 §3.24.1, 10 §3.16.1 | 원전 불변 I1~I12(F05), F01 1~8과 번호가 다르다(08 §3.24.3) |
| 공리 A1~A15 | A1~A15 | foundations 선언문의 열다섯 공리. 10이 분류·집행 지점·보장 수준·위반 테스트를 모두 대응한다 | — | 10 §3.15, helm-canon-3 §1.3 | A12는 지표 묶음 이름(`a12.*`, 16)으로도 쓰인다. 평면 A와 다르다 |
| 의존 규칙 | dependency rules (1)~(5) | (1) write·send에는 작업 합의 필요 (2) "완료"에는 결과 확인 필요 (3) 판단 승격에는 I의 근거 필요 (4) 하위 Concern 재조합 후 닫힘 (5) Goal 변경 시 사람 확인 [제안] | — | 브리프 결정 15, 08 §3.24.2, 10 §3.8 | 커널이 루프에 대해 강제하는 것은 의존 규칙뿐이다(결정 5). 루프별 제약은 오케스트레이터의 도구 배분이다(14 §3.1) |
| 커널 원칙 | — | 모델은 제안하고 커널이 상태를 바꾼다. 모델이 구조화된 값을 선언할 수 있으면 결정은 코드가 한다 | — | 브리프 결정 14, 01 PR-07, 10 §3.14 | "커널이 판단한다"라고 쓰지 않는다. "판단"은 Finding만 가리킨다 |
| 결정 주체 분류 | — | 결정마다 모델·코드·사람 중 누가 정하는지 정한 표 | — | 10 §3.14 | 각 행은 [제안]이다 |
| 단일 변경 경로 | — | 모든 상태 변경이 지나는 일곱 단계: 형식 검사, 권한 검사, 이벤트 기록, 세계 모델 갱신, 규칙 평가, 투영과 감시, 다음 단계 구성 | — | 10 §3.2, 08 §3.1.3, 14 §3.1 | 이벤트를 직접 쓰는 경로는 없다(`path.adapter_cannot_append_event`) |
| 정본 | canonical source, 기준 원본 | Helm 이벤트 로그(SQLite). 모든 상태는 로그에서 다시 만들 수 있어야 한다 | — | 브리프 결정 29, 09 §3.1 | pi 세션 파일, pi-durable 저장소, 관찰 캐시, trace는 정본이 아니다 |
| 투영 | projection, read model | 정본을 읽어 만든 화면이나 모델 컨텍스트. 정본을 쓰지 않는다 | 화면에 쓰지 않음 | 브리프 §6·결정 13, 09 §3.1, 19 §1.4 "뷰" | 쓰지 않음: Method Transfer를 "투영"으로, 상황 인식 3단계 Projection을 "투영"으로(→ 예측). 09의 투영 테이블(`p_*`)과 12의 컨텍스트 투영, 19의 뷰가 모두 이 뜻이다 |
| 상황 유형 | situation type (Cynefin), `SituationType` | Concern이 어떤 종류의 일인지. 바뀔 수 있는 상태다: `clear` 명확, `complicated` 복잡, `complex` 복합, `chaotic` 혼돈, `disorder` 혼란 | 상황 유형(정해진 방법이 있는 일 · 분석이 필요한 일 · 해 봐야 아는 일 · 먼저 막아야 하는 일 · 아직 유형을 모르는 일) | 브리프 결정 6, 08 §3.15, 14 §3.7, 03 §3.3.7 | 쓰지 않음: 난이도(구현 작업의 난이도 등급은 §3.12). 화면에서 명확·복잡·복합·혼돈·혼란을 도움말 괄호 밖에 쓰지 않는다. 설계 본문과 개발자 보기는 두 글자 이름을 쓰고, "복잡"(complicated)과 "복합"(complex)을 바꿔 쓰지 않는다. 화면 이름은 §5 M-13의 (b)다 |
| 능력 | capability | 원시 행동 여섯(`read`, `write`, `execute`, `send`, `spawn`, `ask`)과 기록 능력 다섯(`observe`, `propose`, `attest`, `accept`, `integrate`) | — | 브리프 결정 4, 08 §3.3.3 | 모드의 능력 부분집합(14 §3.10)은 이 목록의 부분집합이다 |
| 능력표 | `CAPABILITY_TABLE` | 행위자별 원시 행동·기록 능력·제안 종류를 고정한 표(A). 커널의 자격 거부 판정 입력 | — | 08 §3.3.4, 10 §3.6.2 | 상황 조건은 정책(P)이며 능력표에 없다 |
| 제안 종류(커널) | `ProposalKind`(08) | 행위자가 `propose`로 낼 수 있는 레코드 종류(`interpretation`, `choice`, `agreement` …) | — | 08 §3.3.4 | 14의 `ProposalKind`(`situation_summary`, `frame_packet` …)는 모델 출력 종류로 다른 목록이다. 대응은 10 §3.11.11 (3) |
| 행위자 | actor, `ActorRef` | 이벤트를 만든 주체: `human`, `agent:<role>`, `runtime`, `kernel`, `scheduler`, `external:<name>`, `migration` | — | 브리프 §3.3, 08 §3.3.2 | 행위자 문자열은 인증 신원이 아니다. 실제 출처는 `via`다 |
| 에이전트 역할 | `AgentRole` | `work` 작업 에이전트, `verifier` 검증 에이전트, `mediator` 중재자, `observer` 관찰 에이전트, `router` 라우터, `branch` 발산 가지·하위 호출 | 작업 에이전트, 검증 에이전트, 중재자, 관찰 에이전트. 라우터와 가지는 화면에서 "에이전트"로 쓴다[제안] | 08 §3.3.2 | 14 §3.5.1의 `AgentRole`에는 `branch`가 없다(§4 N-15) |
| 실제 출처 | `via` | 행위자의 실제 출처: 기기(`device`), 로컬 CLI(`local_cli`), 보조 프로세스(`process`), 실행(`run`), 시스템(`system`) | — | 08 §3.3.2, 09 §3.2 | 커널은 `human` 문자열을 믿지 않고 인증된 `via`로 사람 여부를 판단한다 |
| 권한 레이어 | authority layer | 행동의 가역성·위험 등급·effect class를 판별하는 Helm 밖의 층. Helm은 그 판정을 입력으로 받는다 | — | 브리프 결정 2, 10 §3.6.5, 01 PR-12 | Helm이 가역성을 판정하지 않는다. "되돌리기 비쌈"은 진입 조건에서 뺐다(01 ADR P1-3) |
| 품질 상태 | `Quality` | 레코드의 단계 하나(`captured`, `structural`, `qualified`, `accepted`)와 독립 플래그 셋(`contestedBy`, `stale`, `supersededBy`) | 배지: 근거 부족, 이의 걸림, 낡음, 대체됨(03 §3.3.6) | 08 §3.4.3, §3.21 | 단계와 품질 플래그를 한 칸에 섞지 않는다(03 §3.3.6). 숫자 신뢰도는 없다(J-19) |
| 낡음 | stale, `StaleReason` | 기대던 근거·Goal·합의·선호 기준·M이 바뀌어 다시 볼 필요가 생긴 상태. 이유 여덟 가지(`material_changed` 등) | 낡음 · (이유 한 줄) | 08 §3.4.3, §3.21.3 | 레코드를 지우지 않는다. "다시 볼 조건 충족"은 이유 `review_trigger_fired`의 화면 라벨이다 |
| 다시 볼 조건 | review trigger, `Trigger` | 결정·판단·선호 기준을 다시 검토할 조건. 종류: `at`, `before_loop`, `before_primitive`, `boundary`, `record_state`, `record_changed`, `manual` | 다시 볼 조건 | 08 §3.4.4 | 원전 ReopenTrigger. 가정 만료점(`assumptionExpires`)도 같은 `Trigger` 타입을 쓴다 |
| 관계 | `Link`, `LinkRel` | 레코드 사이의 관계. 근거(`supports`, `challenges`, `qualifies`, `invalidates`), 시간, 구조, N–E–M(`justifies`, `authorizes`, `fulfills`, `reveals`) 관계 | — | 08 §3.4.8 | 원전에서도 Evidence는 첨부물이 아닌 관계로 정의된다 |
| 근거 / 반대 근거 | evidence / counter evidence | 판단·선택·결과 확인을 지지하거나 약하게 하는 관찰과의 관계 | 근거 / 반대 근거 | 08 §3.9.1, 03 §3.2.3 | "근거 관계"는 레코드가 아니다(이의 대상은 될 수 있다, 08 `ObjectionTarget.link`) |
| 근거 체인 | evidence chain | 판단·선택·결과 확인의 근거를 원본까지 따라가는 화면 투영 | 근거 체인(`SCR-EVIDENCE`) | 03 §3.6 | — |
| 추측 | — | 해석과 가능성을 묶어 부르는 이름. 레코드는 둘로 나뉜다 | 해석, 가능성(묶어 말할 때 추측) | 브리프 §6, 05 §3.10.8 | 쓰지 않음(일반 화면): 가설, 믿음 |
| 판단 승격 | promotion, `finding.promote` | 해석·가능성이 근거, 반대 근거 탐색, 구분 확인, 출처 독립성을 갖춰 판단(Finding)이 되는 것. 승격 때 새 레코드가 생긴다 | — | 10 §3.9(정본, J-18), 08 §3.9.5 `promotionMissing` | 판단의 품질 단계 `accepted`와 다른 일이다 |
| 반대 근거 탐색 | counter search, `counterChecked` | 승격 전에 반대 근거를 찾아본 기록 | — | 08 §3.9.1, 15 §3.5.5 | — |
| 출처 독립성 | `evidence.correlated` | 같은 도구 호출·자극·모델 출력에서 온 근거는 하나로 센다는 승격 조건 | 독립 출처 n / 상관됨 | 10 §3.9, J-18 | 에이전트끼리의 합의는 독립 근거가 아니다(03 §3.3.6) |
| 기록과 전달의 분리 | — | 질문을 기록하는 일과 사람에게 전달하는 일을 따로 정한다 | — | 브리프 결정 12, 11 §3.1 | 기록된 질문은 주의 비용이 없다. 비용은 전달 때 센다(14 §3.13.5) |
| 범주 한정 | — | 모든 작업에 Helm의 전 과정을 적용하지 않고 진입 조건을 채운 작업만 Concern으로 연다 | — | 01 PR-10, §3.6, 14 §3.14 | — |
| 진입 조건 신호 | `EntrySignal`, EC-1~EC-5 | `goal_vague` 목표가 흐림, `paths_diverge` 관점·해법이 나뉨, `taste_dependent` 취향에 달림, `long_running` 오래 걸림, `entangled` 다른 것과 얽힘. 모델은 신호만 표시하고 판정은 코드가 한다(고정 문턱 2) | — | 01 §3.6.3, 08 §3.6.1, 14 §3.14.3, J-66 | 15의 발산 신호 S1~S6과 다르다 |
| 진입 경로 | E1, E2, E3 | E1 시작 시 진입, E2 작업 중 제안(승격), E3 직접 지정 | — | 01 §3.6, 14 §3.14.4 | 08 `ConcernOrigin`의 `human_start`, `promoted_from_work`, `human_designated`와 대응 |
| 승격 신호 | `PS-1`~`PS-5` | 가벼운 작업을 하는 동안 Concern 열기를 제안할 근거가 되는 다섯 신호. PS-1 같은 확인이 세 번 실패한다, PS-2 모델이 서로 다른 해법을 둘 이상 꺼낸다, PS-3 작업 범위가 합의 때 추정보다 커진다, PS-4 사용자가 "잘 모르겠는데" 같은 말을 한다, PS-5 사용자가 이유를 밝히지 못한 채 "뭔가 아니다"라고 반응한다. 신호가 나오면 E2 경로로 Concern 열기를 질문으로 기록한다 [제안] | — | 01 §3.6.5 | 판단 승격(`finding.promote`, 10 §3.9)과 다르다. 승격 신호는 Concern 열기 제안의 근거이고, 판단 승격은 해석을 판단(Finding)으로 올리는 절차다 |
| 가벼운 작업 | light work | Concern으로 열지 않은 요청. 루프·상황 판정·탐구 없이 압축된 C/A로 처리하고, 프로젝트마다 하나인 보관 Concern(`kind: light_work`) 아래에 둔다 | 가벼운 작업 | 01 §3.6.4, 14 §3.14.2, J-01 | 의존 규칙 (1)(2)는 가벼운 작업에도 적용된다(J-01) |
| C/A 우선 | — | 작업 합의(C)와 결과 확인(A)을 빠뜨리지 않고 먼저 만든다. 사용자가 가장 많이 건너뛰는 부분이라는 진술에서 나왔다 | — | 01 §3.5, 14 §3.13.7, 11 §3.15 | — |
| 사람 조작 2회 상한 | R-OP-1 | 변경 WorkUnit 하나의 정상 경로에서 사람의 결정 조작은 2회(합의 확정, 결과 확인)를 넘지 않는다. R-OP-2는 합의 확정 질문을 만들지 않는 압축 조건 | — | 01 §3.5.2, 02 §2.6 | 질문 하나에 담긴 여러 기준은 결정 1회다(J-23) |
| 사람 조작 | D, I, 보기 | D 결정 조작(Helm이 낸 요청에 대한 결정 입력), I 입력(사람이 먼저 시작한 입력과 원함 탐구 반응), 보기(세지 않음) | — | 01 §3.5.2, 02 §2.6, 14 §2.3 | 초안을 고쳐 확정해도 D는 1이다 |
| 정상 경로 | normal path | 변경 WorkUnit의 사람 조작 중 상한(R-OP-1) 안에 드는 것. 이벤트 종류로 계산한다 | — | 01 §3.5.2, J-76 | 08 `HumanOpMeta.followedRecommendation`(추천을 그대로 따랐는가)과 뜻이 다르다(J-76). 01·16은 아직 `onNormalPath` 필드 이름을 쓴다(§4 N-06) |
| 증거 관문 | G0, G1, G2 | 제품 단계 사이에 실사용 증거를 얻는 관문. G0 탐구 엔진 평가(15 E0, MVP 실사용 시작 조건), G1 MVP→2단계(G1-1~G1-5), G2 2단계→3단계. 구현은 멈추지 않고 관문은 기능 활성화 단계로 지킨다 | — | 01 §3.8.4, 23 §3.5, J-11 | 재진입 가드 G1~G9(14), 보장 성질 G1~G8(13)과 모양이 같다 |
| 기능 활성화 단계 | A2, A3 | G1 기록 뒤 2단계 기능을 켜는 단계(A2), G2 기록 뒤 3단계 기능을 켜는 단계(A3). 그 전에는 기본 꺼짐으로 운영 데몬에 들어갈 수 있다 | — | 23 §3.5, D23-3 | 공리 A1~A15, 07 패치 A1~A7과 모양이 같다 |
| 제품 단계 | MVP, 2단계, 3단계 | 기능을 켜는 순서. 루프 식별자 단위의 기능 플래그(`features.enabledLoops`)로 켠다 | — | 01 §3.8, 14 §3.15 | 설계 작업의 "1단계·2a단계·2b단계"(작업 단계)와 다르다 |
| 성숙도 | L1~L5 | 원전 제품 성숙도(Situation Recovery … Adaptive Institution)를 루프 묶음에 대응시킨 읽기 틀 | — | 14 §3.15 | 구현 순서가 아니다(23이 정한다) |
| 루프의 세 크기 | 세부·중간·거시 | 세부 = 10단계(WorkUnit 목적), 중간 = 루프 식별자 18개, 거시 = 여러 Concern 사이(거시 스케줄러) | — | 14 §3.2 | 하위 호출은 WorkUnit 안의 일이다(13) |
| 10단계 | Sense, Frame, Diverge, Investigate, (Elicit), Deliberate, Commit, Execute, Assure, Integrate, Reflect, (Structure) | 세부 루프의 기준 표기. Elicit·Structure는 v0.3을 위해 더한 WorkUnit 목적이다 | — | 14 §3.3 | 원전의 episode, 기본 리듬, 8단계 표기와의 대응은 14 §3.3.3 |
| approval theater | 형식적 승인 | 답이 결과를 바꾸지 않는 확인을 반복하는 것("계속할까요?") | — | 01 X-13, 05 §3.1.5, 11 V-Q-03 | 커널 거부 `policy.question_without_choice`. 지표 `q.approval_theater` |

### 3.2 레코드

레코드 종류·필드·접두사의 정본은 08이다. 레코드는 이벤트를 접어 얻은 투영의 모양이며 레코드를 직접 쓰는 API는 없다(08 §3.1.4). 접두사 전체는 §3.13.

| 용어 | 식별자 | 뜻 | 화면 | 정의 문서 | 혼동 주의 |
|---|---|---|---|---|---|
| 프로젝트 | `Project`, `pj` | Helm이 다루는 작업 폴더 묶음(`rootPaths`). 만들 때 자리표시 Goal과 가벼운 작업 Concern이 함께 생긴다 | 프로젝트 | 08 §3.5.1, 09 §3.4.1 | 제품 폴더(`~/projects/<제품>`)와 같은 뜻으로 쓰지 않는다. 관리 대상 폴더 = `rootPaths`(16 §1.5) |
| Goal | `Goal`, `gl` | 프로젝트 단위 궁극 목표. Concern 사이클을 거치며 정제되고 버전을 가진다 | Goal | 브리프 결정 11, 08 §3.5.2 | 화면 이름은 영어 그대로(J-21, 03 A1). 쓰지 않음: 목표, 목적, Purpose. 작업 합의의 "목적"(`purpose`)과 다르다 |
| Goal 버전 | `goalVersion`, `p_goal_versions` | Goal의 특정 시점 내용. 수정이 확정될 때 1 오른다 | Goal 버전 | 08 §3.5.2, 03 §3.2.3 | — |
| Goal 수정 제안 | `goal.revision_proposed`, `pendingRevision` | 원함 탐구 등에서 나온 Goal 서술·성공 조건 수정안. 확정은 사람(의존 규칙 5) | Goal 확인 | 08 §3.22.1, 03 §3.2.4 | 질문 종류 `goal_revision` |
| Concern | `Concern`, `cn` | 10단계 과정을 돌릴 후보가 되는 상황 그 자체(문제, 기회, 위험, 불확실성, 취향 결정, 반복 마찰, 외부 요청) | Concern | 브리프 결정 11, 08 §3.6.1 | 화면 이름은 영어 그대로(J-21). 쓰지 않음: 초점, 이슈, 태스크, 스레드. "주의가 필요한 상황"(v0.2 정의)으로 설명하지 않는다 |
| Concern 종류 | `ConcernKind` | `problem`, `opportunity`, `risk`, `uncertainty`, `taste`, `friction`, `external_request`, `light_work` | — | 08 §3.6.1 | `light_work`는 프로젝트마다 하나인 보관 Concern이다 |
| 하위 Concern | `parentConcernId` | S 루프가 나눈 Concern. 재조합 후 상위가 닫힌다(의존 규칙 4) | 하위 Concern | 08 §3.6, 14 §3.6.11 | — |
| 구조 결정 | `StructureChange`, `sc` | S 루프의 나누기·합치기·떼어 내기·옮기기·다시 합치기·보류·닫기 결정 | — | 08 §3.6.2 | 이벤트는 `structure.changed` 하나(op 값) |
| 경계 항목 | `BoundaryItem`, `bd` | 나눈 부분 사이에 걸친 것. 재조합 때 확인한다 | 경계 항목 | 08 §3.6.3 | 런타임의 작업 경계(`boundary.reached`)와 다르다. 이벤트는 `boundary_item.*` |
| WorkUnit | `WorkUnit`, `wu` | Concern 안의 실행 단위. 종류 `inquiry` 탐구, `probe` 탐침, `change` 변경, `integration` 반영 | 진행 작업(번호 표기: WorkUnit 31) | 브리프 §6, 08 §3.7 | 쓰지 않음(화면): 태스크, 잡, 런. Run(`rn`)과 다르다: WorkUnit 하나에 Run 여러 개 |
| 재작업 | `WorkUnit.reworkOf` | 이의·거절(해결 안 됨) 뒤 같은 대상을 다시 하는 WorkUnit. 원인 `ct`·`qs`·`ac` | — | 08 §3.7, 11 §3.10.3, J-54 | 쓰지 않음: Rework 레코드(`rw`), `rework.*` 이벤트(08 §10.2) |
| 관찰 | `Observation`, `ob` | 실제 실행 기록(도구 결과, 외부 응답)이나 사람이 직접 본 것을 출처로 갖는 E 레코드. 모델 행위자는 만들 수 없다 | 관찰 | 브리프 §6, 08 §3.8.1 | 외부의 말은 "그렇게 말했다"가 관찰이다. 쓰지 않음: 사실(관찰 전체를 가리킬 때) |
| 관찰 종류 | `obsKind` | `tool_result`, `tool_interrupted`, `utterance`(사람 발화), `reaction`(반응), `external_response`, `no_response`, `derived`, `material_change` | — | 08 §3.8.1 | 반응은 관찰의 한 종류다(08 A08-6) |
| 주석 | `Annotation`, `annKind` | 관찰에 붙이는 표시: `surprise`, `near_miss`, `repeated_correction`, `measurement_doubt`, `procedure_failed` | — | 08 §3.8.1 | 16 측정 범주의 `surprise.reported`(놀람 보고)와 다르다 |
| 전제 | `Assumption`, `as` | 확인하지 않고 임시로 믿는 것. 질문의 임시 가정도 전제(`origin.kind = question`)로 남는다 | 전제 | 08 §3.8.2 | 쓰지 않음: 임시 가정 레코드 `wa`, `working_assumption.*`(08 §10.2) |
| 열린 질문 | `OpenQuestion`, `oq` | 알면 선택이 달라질 수 있는 모르는 점 | 아직 모르는 점 | 08 §3.8.3 | 사람에게 묻는 질문(`Question`, `qs`)과 다르다 |
| 해석 | `Interpretation`, `in` | 관찰이 무엇을 뜻하는지 설명한 추측. 관찰을 참조하지 않으면 전제로 강등된다 | 해석 | 08 §3.9.2 | — |
| 가능성 | `Possibility`, `ps` | 확인 중인 설명이나 해법(추측). 종류 `cause`, `perspective`, `solution`, `preference_criterion`, `failure_path` | 가능성 | 08 §3.9.3 | 쓰지 않음(일반 화면): 가설. 기준 후보도 가능성 레코드다 |
| 구분 확인 | `DiscriminatingCheck`, `dc` | 경쟁하는 가능성들이 서로 다른 결과를 예측하는 확인. 모든 예측이 같으면 거부된다 | 구분 확인 / 다음 확인 | 08 §3.9.4, 15 §3.5.3 | 탐침(`pb`)과 다르다. 이벤트 `check.*`. 사람의 다음 확인 고정은 `check.pin` → `check.pinned`·`check.unpinned` |
| 판단 | `Finding`, `fd` | 근거, 반대 근거 탐색, 구분 확인을 거쳐 승격된 E 레코드 | 판단 | 브리프 §6, 08 §3.9.5 | 이 문서 묶음에서 "판단"은 Finding만 가리킨다. 쓰지 않음: 결론, 사실. 에이전트 문구 "판단했습니다"도 쓰지 않는다(05 §3.10.7) |
| 선택 | `Choice`, `ch` | 앞으로 무엇을 하기로 정한 것. 사람이 고르거나 맡긴 범위 안의 정책이 적용될 때만 생긴다 | 선택 | 브리프 §6, 08 §3.10.1 | 추천은 선택이 아니다. 쓰지 않음: 결정(Decision), 승인 |
| 추천 | `recommendation` | 에이전트가 권하는 선택지. 질문의 필드 | 추천 | 08 §3.13, 03 §3.2.3 | 쓰지 않음: 추천을 가리켜 "선택" |
| 이의 | `Objection`, `ct` | 사람이 선택·판단·판정 등에 반대한 기록. 이유는 선택 입력(J-20) | 이의 | 08 §3.10.2 | 쓰지 않음: Contest 레코드, `contest.*` 이벤트(J-30), 반대, 거부, 신고. 검증 에이전트의 반대 의견은 반대 근거나 증언이다 |
| 작업 합의 | `Agreement`, `ag` | 목적, 완료 기준, 범위, 금지 행동, 제출할 근거, 멈출 조건을 담은 C 레코드 | 작업 합의 | 브리프 §6, 08 §3.11.1 | 쓰지 않음: 계약, 위임 계약, Commitment. 진행 상태(멈춤 등)는 WorkUnit에 둔다 |
| 완료 기준 | `Criterion`, `cr` | 결과를 받아들일 수 있는 상태. 작업 합의에 딸린다 | 완료 기준 | 08 §3.11.1 | 원전 AcceptanceCriterion, product-language ResultCondition. 선호 모델의 "기준"과 다르다 |
| 맡긴 범위 | `Agreement.scope` + 금지 행동 + 멈출 조건 | 무엇을 스스로 해도 되고 언제 멈춰야 하는가를 묶어 부르는 이름 | 맡긴 범위 | 03 §3.2.3, 05 §3.10.8 | 쓰지 않음(화면): 권한 범위, Authority Envelope, 자율성 수준 |
| 멈출 조건 | `stopConditions` | 충족되면 작업을 멈추고 사람에게 묻는 조건 | 멈출 조건 | 08 §3.11.1 | 원전 EscalationTrigger, product-language HelpTrigger("도움이 필요한 조건") |
| 맡겨 둔 권한 | `Grant`, `gr`, `grantKind: standing \| emergency` | 사람이 미리 맡긴 권한. `emergency`가 비상 합의다 | 맡겨 둔 권한 / 비상 합의 | 08 §3.11.2, J-116 | 비상 합의는 별도 레코드가 아니다. 쓰지 않음: "상시 합의", "맡긴 권한"(작업 합의·맡긴 범위와 헷갈림) |
| 결과 제출 | `ResultSubmission`, `rs` | 일을 맡은 쪽이 완료 기준을 만족했다고 알리는 E 레코드. 기준별 충족·미충족·확인 못함과 근거 | 결과 제출 | 08 §3.12 | 쓰지 않음: "완료", 결과 제출을 "확인됨"으로 |
| 증언 | `Attestation`, `at` | 검증 에이전트가 결과 제출에 남기는 확인·반대 판정 | 검증 결과(개발자 보기: 증언) | 08 §3.12 | 결과를 만든 실행 계통은 증언할 수 없다(`denied.producer_cannot_attest`) |
| 결과 확인 | `Acceptance`, `ac`, `AcceptanceDecision` | 사람이 근거와 남은 제한을 보고 결과를 받아들이는 N 레코드. 기록 값(08) `accepted`, `conditional`, `revision_requested`, `rejected`, `criteria_wrong`. 명령 값(10 `result.accept`) `accept`, `accept_with_conditions`, `request_changes`, `reject`, `criteria_wrong` | 결과 확인 / 조건 붙여 확인 / 수정 요청 / 거절(해결 안 됨) / 기준이 틀림 | 08 §3.12, 10 §3.11.8, J-35 | 결과 확인은 사람만 한다. 쓰지 않음: 승인, 수락, 결과 거절(거절 버튼은 "거절(해결 안 됨)", J-170). 두 값 집합은 J-35로 둘 다 유지하고 대응은 08 §10.4다. 10 §3.11.11과 19 §3.7.1은 명령에 기록 값을 적었다(§4 N-04) |
| 전체 반영 | `Integration`, `ig` | 반영 항목을 모두 처리한 상태 | 전체 반영 | 08 §3.12 | 결과 확인(명세대로 만들었는가)과 전체 반영(올바른 것을 만들었는가)은 다르다(불변조건 5) |
| 반영 항목 | `IntegrationObligation`, `io` | 결과 확인 뒤 다른 작업·문서·결정과 맞추어야 할 것. 상태 `open`, `resolved`, `deferred`, `transferred`, `waived` | 반영 항목 | 08 §3.12 | 쓰지 않음: 후속 작업. 이벤트는 `obligation.*` |
| 돌아보기 | `Reflection`, `rf` | A.reflect의 기록. 다음 합의·다이얼·절차 변경 제안을 담는다 | 돌아보기 | 08 §3.12 | product-language LearningReview |
| 질문 | `Question`, `qs` | 묻기의 기록. 전달은 별도 결정이다. 게이트, 임시 가정, 가정 만료점을 가진다 | 질문(표시 번호 "질문 14", TUI 인자 `q14`) | 브리프 §6, 08 §3.13, 11 §3.2 | 쓰지 않음(화면): 게이트, 알림. 열린 질문(`oq`)과 다르다 |
| 기대 | `Expectation`, `ex` | 밖에 요청하고 응답을 기다리는 기한 있는 기록. 기한이 지나면 "응답 없음" 관찰이 생긴다 | 응답 기대 | 08 §3.14.1 | 쓰지 않음: 대기 |
| 예측 | `Prediction`, `pr` | 하면 무엇이 일어날지에 대한 예상과 확인 시점. 판정 `held`, `failed`, `partial`, `indeterminate` | 예측 | 08 §3.14.2, J-29 | 쓰지 않음: 전망, 투영. 원전 SA Level 3 Projection은 예측으로 옮긴다 |
| 루프 계획 | `LoopPlan`, `lp` | Concern에서 쓸 루프 조합의 계획. 권고이며 벗어나는 전환이 허용된다 | 루프 계획 | 08 §3.15, 14 §3.8 | 혼자 정한 결정 표시(`Autonomy`)를 가진다 |
| 계획 표시 | `PlanFlags` | 루프 계획의 근거 표시 묶음. 모델이 구조화된 값으로 선언하고 코드가 계획을 계산한다. 여섯 표시는 14 §3.8.1이 정본이고 `outOfPattern`을 더해 일곱이다. 표시마다 근거 id가 하나 이상 있다 | 계획 표시 | 14 §3.8.1, 08 §3.15, [결정 53], [판정 J-188] | 쓰지 않음: 플래그, 계획 플래그 |
| `outOfPattern` 표시 | `outOfPattern`(`PlanFlags`의 일곱째 표시) | 여섯 표시로 이 상황을 나타낼 수 없을 때 참이다. 근거가 필수다. `hybrid`에서 참이면 모델이 계획 초안을 낸다 | —(화면에는 "모델이 설계한 계획" 표시로만 보인다) | 14 §3.8.1, 08 §3.15, [판정 J-188] | 맡긴 범위 밖(`scope_exceeded`, §3.3)과 다르다. 계획 계산 규칙의 범위 밖이라는 뜻이다 |
| 계획 작성 주체 | `LoopPlanCore.authoredBy`(`code`·`model`·`human`) | 계획 본문을 누가 썼는가. 채택한 쪽(`decidedBy`)과 따로 적는다. `code`는 코드가 계산한 계획, `model`은 계획 검사를 통과한 모델 초안, `human`은 사람이 고친 계획이다. 계획 이의 비율은 `authoredBy`별로 센다 | 계산한 계획(`code`) / 모델이 설계한 계획(`model`). `human`의 화면 이름은 없다(§5 M-15) | 14 §3.8.1, 08 §3.15, [판정 J-188] | 쓰지 않음: AI 계획, 자동 계획. 채택 기록(`decidedBy`)과 다르다 |
| 루프 전환 | `LoopTransition`, `lt` | 한 루프에서 다른 루프로 옮긴 기록 | 루프 전환 | 08 §3.15, 14 §3.9 | — |
| 상황 판정 | `SituationAssessment`, `sa` | Concern의 상황 유형 판정 기록. 판정 질문 아홉 개의 답에서 결정표로 계산한다 | 상황 판정 | 08 §3.15, 14 §3.7 | 상황 유형(값)과 상황 판정(레코드)을 구분한다 |
| 모드 배정 | `ModeAssignment`, `md` | Concern(또는 WorkUnit)에 모드를 정한 기록. 라우터가 고르면 혼자 정한 결정 | 모드 | 08 §3.15, 14 §3.10.3 | 이벤트 `mode.assigned`. 사람 명령 `mode.set`, 라우터 명령 `mode.route` |
| 다이얼 설정 | `DialSetting`, 층 `user`·`concern`·`instruction` | 저장되는 다이얼 값(설정 층 4~6) | 다이얼 | 08 §3.15, 14 §3.11.3 | 층 1~3(시스템, 상황 유형, 모드)은 코드·데이터이며 저장하지 않는다 |
| 탐침 | `Probe`, `pb` | 결과를 모르는 상태의 작은 시도. 키울 조건과 접을 조건이 있다 | 탐침 | 브리프 §6, 08 §3.16.1 | "탐침"은 C.probe 전용이다(J-10). 복귀 점검(resumption check)을 탐침이라 부르지 않는다. 쓰지 않음: 실험(일반), 시도 |
| 지속 관찰 | `Watch`, `wt` | A.watch의 관찰 기간·표본·판정 기록 | 지속 관찰 | 08 §3.16.2 | 관찰 에이전트와 다르다 |
| 탐구 실행 | `Inquiry`, `iq` | I 루프 활성화 한 번의 탐구. 발산 표와 라운드를 가진다 | 탐구 | 08 §3.17.1, 15 §1.4 | 탐구 네 종류(`InquiryKind`)는 `fact`, `want`, `possibility`, `outcome` |
| 자극 | `Stimulus`, `st` | 원함 탐구에서 반응을 받으려고 보여 주는 구체적인 것(시안, 초안 일부, 레퍼런스, 사례, 비유). 만든 뒤 내용이 바뀌지 않는다 | 자극 | 08 §3.17.3 | 쓰지 않음: 옵션, 선택지, 후보안 |
| 반응 | `ReactionPayload`(관찰 `obsKind: reaction`) | 자극이나 가능성에 대한 사람의 반응. 요소 단위, 강도, 이유 없는 반응, 비교, 세 개 비교, 고쳐 말하기, "가깝다" | 반응 | 08 §3.17.4 | 하나를 고르는 형태의 반응 타입은 없다(결정 18). 질문의 답이 아니다 |
| 선호 모델 | `PreferenceModel`, `pm` | 원함 탐구로 찾은 기준과 무게, 좋았던·싫었던 자극, 말한 기준과 실제 반응의 차이. 층 `goal`·`user` | 선호 모델 | 08 §3.17.5, 15 §3.7 | 쓰지 않음: 취향 프로필. 숫자 confidence 없음(J-19) |
| 선호 기준 | `PreferenceCriterion` | 사람이 확정한 선호 모델의 기준. 상태 `confirmed`, `retired` | 기준 | 08 §3.17.5 | 완료 기준(`cr`)과 다르다 |
| 기준 후보 | 가능성 `possibilityKind: preference_criterion` | 반응에서 추론한 숨은 기준(추측). 사람이 확인하면 선호 기준이 된다 | 기준 후보 | 08 §3.9.3, 03 §3.2.3 | — |
| 렌즈 | `Lens`, `ln` | Method Transfer에 쓰는 다른 분야의 방법·사고방식 카드 | 다른 분야 방법(렌즈) | 08 §3.17.2, 15 §3.9 | 쓰지 않음: 투영, Projection |
| 에이전트 실행 | `Run`, `rn` | 런타임이 모델 루프를 한 번 돌리는 실행. 재개 때 같은 `runId`의 새 `attempt` | 진행 작업 안의 실행(화면에 따로 이름 없음) | 08 §3.18.1, 12 | WorkUnit과 다르다. "런"을 화면에 쓰지 않는다 |
| 도구 호출 | `ToolCall`, `tc` | 모델이 요청한 도구 실행 하나. 의도(started) → 실행 → 결과 순으로 기록한다 | 도구 활동 | 08 §3.18.2, 12, 13 | — |
| 실행 대화 흐름 | `Thread`, `th` | 같은 WorkUnit의 run들이 이어 쓰는 대화 흐름 | 대화 | 08 §3.18.3, 12 | 화면 `SCR-THREAD`(Concern에 딸린 대화)와 범위가 다르다 |
| 되돌릴 지점 | `RollbackPoint`, `rb` | 임시 가정 아래 첫 쓰기 전에 남기는 복원 지점 | 되돌릴 지점 | 08 §3.18.3, 11 §3.12 | 원전 `rollback_point` |
| 기기 | `Device`, `dv` | 데몬에 붙는 클라이언트 기기(Mac·Windows 앱, 휴대폰, TUI) | 기기 | 08 §3.19.1, 18 | 토큰 원문은 저장하지 않는다(해시만, J-71) |
| 페어링 코드 | `PairingCode`, `pc` | 새 기기를 등록할 때 쓰는 짧은 수명의 코드 | 페어링 코드 | 08 §3.19.1, 18 | 실패 사유를 화면에서 구분하지 않는다(J-81) |
| 관찰 제안 | `PolicyProposal`, `pp` | 관찰 에이전트가 기록에서 찾은 반복 패턴과 수정안(절차·스킬·스크립트·정책 등 13종) | 관찰 제안 | 08 §3.19.2, 16 §3.15 | 쓰지 않음: 인사이트, 추천. 기각(`dismissed`)은 커널의 거부와 다르다 |
| 절차 | `Procedure`, `pd`, 신뢰 `trial`·`trusted`·`demoted` | 채택된 계획 템플릿과 상시 합의 묶음 | 절차 | 08 §3.19.3, 16 §3.16 | — |
| 혼자 정한 결정 표시 | `Autonomy`, `HumanDecision` \| `AutonomousDecision` | 결정 레코드 여섯 종류(`ch`, `lp`, `lt`, `sa`, `sc`, `md`)와 결정 블록 다섯 곳에 붙는 "누가 어떻게 정했는가" | — | 08 §3.4.5 | 별도 레코드가 아니다. §3.5 "혼자 정한 결정" |
| 사람 조작 메타 | `HumanOpMeta` | 사람 결정 이벤트 payload의 선택 필드: `followedRecommendation`, `extraReason`, `editedDraft` | — | 08 §3.4.5, J-76 | 01의 `HumanDecisionOp.onNormalPath`와 뜻이 다르다(§4 N-06) |
| 레코드 메타 | `RecordMeta`, `revisionSeq` | 모든 레코드의 공통 메타. `revisionSeq`는 사람에게 의미 있는 변경 때만 오른다 | — | 08 §3.4.2 | 낡음 검사는 `basisSeq`와 `revisionSeq`를 비교한다(J-79) |
| 실제 참조 | `MaterialRef` | M을 저장하지 않고 가리키는 참조(파일@해시, 커밋, URL, 실행 id) | 원본 | 08 §3.4.6 | — |
| blob 참조 | `BlobRef`, `bl`, `sha256:<hex>` | 큰 내용을 내용 해시로 가리키는 참조 | — | 08 §3.4.7, 09 §3.12 | — |

### 3.3 상태와 화면 라벨

상태의 정본은 08 §3.22이고 화면 라벨의 정본은 03 §3.3이다. 같은 라벨 문자열을 두 상태 집합에 쓰지 않는다(03 §3.3.1).

| 대상 | 정본 상태 → 화면 라벨 | 정의 문서 | 혼동 주의 |
|---|---|---|---|
| WorkUnit | `proposed` 준비 중, `negotiating` 합의 확인 필요, `delegated` 맡김, `in_progress` 진행 중(수정 요청 뒤 "수정 중"), `paused` 멈춤 계열, `scope_exceeded` 선택 필요(범위 밖), `submitted` 결과 확인 필요, `accepted` 결과 확인됨 · 반영 n개 남음, `integrated` 완료, `rejected` 결과 거절됨, `concluded` 탐구 끝남, `cancelled` 중단됨(사람), `superseded` 다른 작업으로 대체됨 | 08 §3.7·§3.22.3, 03 §3.3.2 | "완료"는 `integrated`일 때만 단독으로 쓴다(03 IA-08). 재시작 중단은 run 상태로 표시한다(WorkUnit 상태에 없음) |
| 멈춤 종류 | `pauseKind`: `human` 멈춤, `blocking_question` 막힘(질문 n), `stop_condition` 멈출 조건, `violation` 범위 위반 감지, `grant_revoked` 맡겨 둔 권한 철회(J-116), `agreement_expired` 합의 만료, `budget` 예산 다 씀 | 08 §3.7, 03 §3.3.2 | — |
| 작업 합의 | `proposed` 합의 초안, `active` 맡김 중, `fulfilled` 합의 채움, `released` 합의 풀림, `declined` 합의 취소됨, `expired` 합의 만료됨, `superseded` 새 합의로 바뀜 | 08 §3.11.1·§3.22.4, 03 §3.3.2 | 11 1판의 합의 상태(blocked, suspended 등)는 쓰지 않는다(08 §10.2) |
| Concern(저장) | `open`, `active`, `held`, `completed`, `closed`, `merged` | 08 §3.6.1 | 화면은 표시 상태를 쓴다 |
| Concern(표시) | `ConcernDisplayStatus`: `open` 열림, `active` 진행 중, `waiting` 대기, `awaiting_review` 결과 확인 대기, `reviewed` 결과 확인됨, `completed` 반영 완료, `held` 보류, `reopened` 다시 열림, `closed` 닫힘, `merged` 다른 Concern에 합쳐짐 | 08 §3.6.1, 09 `v_concern_display`, 03 §3.3.3 | Concern에는 "완료"를 쓰지 않는다. 14의 오케스트레이터 상태(`opening`, `working`, `waiting`, `accepted`, `integrated`, `closed`)는 계산 값이며 화면 라벨이 아니다(14 §3.12.2) |
| Goal | `proposed` Goal 초안, `active` 진행 중, `paused` 잠시 멈춤, `achievement_claimed` 이뤄졌다는 주장, `achieved` 이뤄짐, `superseded` 다른 Goal로 대체됨, `retired` 그만둠 | 08 §3.5.2, 03 §3.3.3 | — |
| 선택 | 상태 `committed`, `superseded`, `revoked`와 정한 방식: 내가 정함, 규칙에 따라 정해짐, 에이전트가 정함, 가정대로 정해짐, 비상 합의로 정해짐, 맡겨서 정해짐, 이의 걸림, 다시 볼 조건 충족, 낡음, 다른 선택으로 대체됨, 취소됨 | 08 §3.10.1, 03 §3.3.4 | product-language의 choice 상태 7개(질문 정리 중 … 전체 반영됨)는 쓰지 않는다(03 §3.3.1) |
| 질문 | `pending` 기록됨, `delivered` 전달됨, `answered` 답함, `assumed` 가정대로 정해짐, `withdrawn` 철회됨, `expired` 의미 없어짐, `delegated` 에이전트에게 맡김(J-114) | 08 §3.13·§3.22.7, 03 §3.3.5 | 03·04·05의 질문 상태 목록에 아직 `delegated`가 없다(§4 N-12). 질문 상태 `scheduled`는 없다(`pending` + `plannedDelivery`) |
| 결과 제출 | `submitted`, `accepted`, `conditionally_accepted`, `revision_requested`, `rejected`, `criteria_wrong`, `stale`, `superseded` | 08 §3.12 | 결과 확인 값(`AcceptanceDecision`)과 이름이 비슷하지만 다른 집합이다 |
| 이의 | `open`, `upheld`, `withdrawn`, `dismissed`, `noted` | 08 §3.10.2 | `noted`는 `desiredEffect = note_only`. 대상에 이의 표시가 붙지 않는다 |
| 전제 | `active`, `confirmed`, `invalidated`, `retired` | 08 §3.8.2 | — |
| 가능성 | `open`, `rejected`, `undecidable`, `promoted`, `confirmed`, `superseded`, `withdrawn`, `dismissed`, `merged` | 08 §3.9.3 | `dismissed`(사람이 이유 없이 치움)와 `rejected`(반대 근거로 기각)를 구분한다 |
| 관찰 제안 | `open`, `deferred`, `accepted`, `applying`, `applied`, `dismissed`, `withdrawn`, `expired`, `reverted` | 08 §3.19.2, 16 §3.15.3 | 기각 범위 `this` · `family_forever`(J-75) |
| 에이전트 실행 | `RunStatus`: `queued`, `running`, `stopping`, `awaiting_human`, `awaiting_recovery`, `interrupted`, `ended`. 종료 이유 `yielded`, `handed_off`, `cancelled`, `budget_exhausted`, `step_limit`, `failed`, `recovery_exhausted`, `superseded`, `context_overflow` | 08 §3.18.1, 12 §3.2 | 화면 라벨 "중단됨(재시작) · 자동 재개 중", "복구 선택 필요"(J-115)는 run 상태를 겹쳐 보인 것이다(03 §3.3.2). 사람 대기 뒤에는 `ended(handed_off)` + 같은 thread의 새 run(J-38). `run.resumed`는 없다 |
| 도구 호출 | `ToolCallStatus`: `requested`, `blocked`, `awaiting_approval`, `denied`, `started`, `not_executed`, `replaying`, `completed`, `interrupted`, `outcome_uncertain`, `recovered` | 08 §3.18.2·§3.22.14 | `interrupted`(로컬 쓰기 중단, 질문 없음)와 `outcome_uncertain`(외부 결과 불명, recovery 질문)을 구분한다(J-44) |
| 품질 배지 | `captured`·`structural` 근거 부족, `qualified`·`accepted` 배지 없음, `contestedBy` 이의 걸림, `stale` 낡음, `supersededBy` 대체됨 | 08 §3.4.3, 03 §3.3.6 | 작성자 표시(사람 작성, 에이전트 작성, 정책 적용, 외부)는 품질 배지가 아니다 |

### 3.4 루프·모드·다이얼

| 용어 | 식별자 | 뜻 | 화면 | 정의 문서 | 혼동 주의 |
|---|---|---|---|---|---|
| 루프 | O, I, C, A, S (`LoopFamily`) | O 상황 파악, I 탐구, C 실행(약속·탐침·비상), A 확인·관찰·돌아보기, S 구조. 한 작업 안에서 필요에 따라 조합하고 언제든 전환한다 | 루프 이름으로 보인다 | 브리프 결정 5, 14 §2.3 | 쓰지 않음(화면): 단계, 페이즈. "루프 계열(LoopFamily)"과 같은 말이다 |
| 루프 식별자 | `LoopId` (18개) | `O`, `I.fact`, `I.want`, `I.possibility`, `I.outcome`, `C.commit`, `C.probe`, `C.emergency`, `A.confirm`, `A.watch`, `A.reflect`, `S.split`, `S.merge`, `S.detach`, `S.relocate`, `S.recombine`, `S.hold`, `S.close` | 아래 행 | 08 §3.15 `LOOP_IDS`, 14 §3.5.1 | 브리프 §6 초안의 `S.*`는 일곱 식별자를 가리킨다 |
| 상황 파악 | `O` | 현재 상황과 변화를 감지하고 문제를 정의한다(Sense, Frame) | 상황 파악 | 14 §3.6.1, 03 §3.3.7 | — |
| 사실 탐구 | `I.fact` | 원인·사실을 경쟁 가능성과 구분 확인으로 찾는 탐구 | 사실 탐구 | 14 §3.6.2, 15 §3.5 | — |
| 원함 탐구 | `I.want` | 자극에 대한 반응으로 숨은 기준을 찾는 탐구. 하나 고르기 질문을 쓰지 않는다 | 원함 탐구 | 14 §3.6.3, 15 §3.6 | 원함 발견(동기)과 다르다 |
| 가능성 탐구 | `I.possibility` | 새 해법·방향 후보를 넓히는 탐구. Method Transfer 렌즈를 쓴다 | 가능성 탐구 | 14 §3.6.4, 15 §3.8 | 가능성 레코드(`ps`)와 이름이 겹친다. 루프를 말할 때는 "가능성 탐구"라고 쓴다 |
| 결과 탐구 | `I.outcome` | 하면 무엇이 일어날지 예측과 실패 경로로 따지는 탐구 | 결과 탐구 | 14 §3.6.5, 15 §3.10 | — |
| 약속 실행 | `C.commit` | 작업 합의를 맺고 정한 것을 실행하는 C | 약속 실행 | 14 §3.6.6, 03 §3.3.7 | 14 계약의 `nameKo` "약속형 C"는 개발자 보기 이름이다. 모드 "실행"(`execute`)과 겹치지 않게 "약속 실행"이라고 쓴다 |
| 탐침 | `C.probe` | 결과를 모르는 상태에서 작게 해 보며 아는 C. 키울 조건과 접을 조건이 있다 | 탐침 | 14 §3.6.7 | "탐침형 C"는 개발자 보기 이름. "탐침"은 이 루프와 Probe 레코드에만 쓴다(J-10) |
| 비상 합의 | `C.emergency` | 혼돈 상황에서 미리 맺어 둔 비상 Grant의 범위로 안정화하는 C | 비상 합의 | 14 §3.6.7, 08 §3.11.2 | 3단계 기능 |
| 확인·반영 | `A.confirm` | 결과 제출을 확인하고 반영 항목을 처리하는 A | 확인·반영 | 14 §3.6.8 | 사람 접점 "결과 확인"과 겹치지 않게 "확인·반영"이라고 쓴다. "확인형 A"는 개발자 보기 이름 |
| 지속 관찰 | `A.watch` | 탐침·변경 뒤 관찰을 쌓아 키우기·접기·계속을 판정하는 A | 지속 관찰 | 14 §3.6.9 | — |
| 돌아보기 | `A.reflect` | 경험을 다음 합의·다이얼·절차 변경 제안으로 옮기는 A | 돌아보기 | 14 §3.6.10 | — |
| 구조 | `S.*` | 구조: 나누기(`split`) / 합치기(`merge`) / 떼어 내기(`detach`) / 옮기기(`relocate`) / 다시 합치기(`recombine`) / 보류(`hold`) / 닫기(`close`) | 구조: 나누기 … 닫기 | 14 §3.6.11, 03 §3.3.7 | 거시 스케줄러와 다르다: S는 레코드를 바꾸는 루프, 스케줄러는 배분기(14 §3.2) |
| 루프 활성화 | loop activation | 한 Concern이 한 루프 식별자로 들어와서 나갈 때까지의 구간. id는 진입 전환 레코드 id | — | 14 §2.3 | — |
| 루프 계약 | loop contract | 루프 식별자마다 정한 데이터: 입력, 출력, 진입·종료 조건, 능력, 제안 종류, 사람 접점, OPD+C 의무, 예산 기본값 | — | 14 §3.5.2 | 작업 합의(계약이라고 부르지 않음)와 다르다 |
| 단계 | step, `StepId` | 10단계 사이클의 한 단계. 루프 계약 안에서 WorkUnit의 목적을 정한다 | — | 14 §2.3, §3.3 | 제품 단계(MVP·2단계·3단계), 탐구 단계(앵커링 …)와 다르다 |
| WorkUnit 목적 | `WorkUnitPurpose` | `assess`, `diverge`, `investigate`, `elicit`, `deliberate`, `draft_agreement`, `execute`, `probe`, `stabilize`, `submit`, `verify`, `watch_sample`, `integrate`, `reflect`, `structure`, `recombine`, `entry_assess`, `prediction_check` | — | 14 §3.5.1 | WorkUnit 종류(`workKind`: inquiry, probe, change, integration)와 다르다 |
| 제안 종류(모델 출력) | `ProposalKind`(14) | 루프 계약이 모델에 노출하는 출력 종류(`situation_summary`, `frame_packet`, `possibility`, `agreement_draft`, `result_submission` …) | — | 14 §3.5.3 | 08의 같은 이름 타입과 다르다. 10 명령 대응은 10 §3.11.11 (3) |
| 사람 접점 | `HumanTouchpointKind` | 사람 입력을 요청하는 지점. 모두 질문 레코드로 만든다 | 질문함 종류(03 §3.2.4) | 14 §3.5.3 | 최종 이름은 08 `QuestionKind`(예: `rights_permission` → `send_approval`, `goal_revise` → `goal_revision`, `scope_exceeded` → `scope_change`) |
| 선언 도구 | declaration tool | 모델이 구조화된 값을 선언하고 결정은 코드가 하는 도구 방식. 모델의 루프 전환도 이 방식이며 1차 런타임은 M 채널 `loop.transition` 도구를 노출하지 않는다 | — | 14 §3.5.6, J-65 | — |
| 전환 규칙 | T01~T28 | 루프 전환을 정하는 규칙표(계기, 출발, 가드, 도착, 판단 주체)와 우선순위 | — | 14 §3.9.2~§3.9.3 | 테스트 ID(T-CR-01 등), 관찰 실행 트리거 T1~T8(16 §3.3.1)과 다르다 |
| 재진입 가드 | re-entry guard, G1~G9(14) | 전환이 끝없이 반복되거나 진전 없이 오가는 것을 막는 순수 함수 가드(한 계기 한 번, 진전 없는 순환, 재판정 간격, 수정 요청 반복, 예산, C/A 상한, 제자리 전환, 구조 상한, 막힌 행동) | — | 14 §3.9.5 | 증거 관문 G1·G2(01)와 이름이 겹친다. 문서에서는 "재진입 가드 G2"처럼 앞말을 붙인다 |
| 모드 | mode, `ModeId` | 루프 계획 기본값 + 능력 부분집합 + 다이얼 값의 설정. Concern에 붙고 WorkUnit은 물려받는다 | 모드 | 브리프 결정 3, 14 §3.10 | 쓰지 않음: 페르소나, 역할, 프로필. 에이전트에게 성격 문장을 주지 않는다. 원전 Double Diamond의 발산·수렴 국면(canon-3 I8)은 모드가 아니다. 14·15는 Double Diamond를 방법으로만 쓴다 |
| 모드 여덟 | `orient`, `investigate`, `deliberate`, `taste`, `execute`, `verify`, `restructure`, `emergency` | 복귀 안내, 원인 조사, 선택 검토, 취향 탐색, 실행, 검증, 구조 정리, 비상 | 같은 한국어 이름 | 14 §3.10.2, 08 §3.15, 03 §3.3.7 | 모드 이름은 탐구 이름과 겹치지 않게 지었다. "실행" 모드와 루프 "약속 실행"을 구분한다 |
| 모드 라우팅 | `mode.route`, 라우터 `agent:router` | 상황·진입 조건·입력 형태·명시·이력 신호로 모드를 고르는 일 | — | 14 §3.10.3 | 사람이 고르면 `mode.set`(10 §3.11.11) |
| 다이얼 | dial, `DIAL_KEYS` | 질문·탐구·자율성의 정도를 조절하는 값. 정본 목록은 열다섯 개다(v0.3 07 §3의 열네 개와 `planAuthoring`, [결정 53]) | 다이얼 | 14 §3.11.1, 08 §3.15 | 쓰지 않음: 슬라이더, 레벨. `structure.max_children`·`max_depth`는 정본 다이얼 열다섯 개에 들지 않는 구조 설정 키다 |
| 계획 방식 | dial `planAuthoring`(값 `computed`·`hybrid`·`model`, 기본 `hybrid`, 층 `user`·`concern`) | 루프 계획을 누가 설계하는가. `computed`는 코드가 계산하고 모델 초안을 받지 않는다. `hybrid`(기본)는 계획 표시를 모델이 선언하고 코드가 계획을 계산하며, 범위 밖 표시가 참이거나 맞는 계산 규칙이 없으면 모델 초안을 받는다. `model`은 언제나 모델이 계획 전체를 설계한다. 모델 초안은 제안 종류 `loop_plan_draft`(`steps`)로 내고, 검사를 두 번 어기면 코드 계산 계획을 쓰고 그 사실을 기록한다 | 계획 방식: 코드 계산만 / 혼합(기본) / 모델 설계 | 08 §3.15, 14 §3.11.1, 05 §3.6.6, [결정 53], [판정 J-188] | 쓰지 않음: 설계 모드, 플랜 모드. 키 `planAuthoring`은 점 표기가 없어 다이얼 키 형식 `<묶음>.<이름>`의 예외다(08 정의). 층 `instruction`에는 두지 않는다 |
| 질문 조건 문턱 | `question.threshold.c1`~`c3`, `few`·`normal`·`many` | 정보 게이트 조건 1~3의 문턱 | 질문 빈도(프리셋) | 14 §3.11.1 #1, 11 §3.3.4 | "질문 빈도" 프리셋은 다이얼 목록에 들지 않는 입력 편의다 |
| 기본 전달 방식 | `question.default_delivery` | 즉시·협상·중재·예약 중 기본값. 기본은 협상 | 기본 전달 방식 | 14 §3.11.1 #2 | — |
| 즉시 승격 문턱 | `question.immediate_threshold` | 막힘의 지연 비용이 이 값을 넘으면 즉시 전달 | — | 14 #3, 11 D-2 | — |
| 만료 여유 | `question.expiry_margin` | 가정 만료점 전 몇 경계(또는 분) 남았을 때 즉시로 올리는가 | — | 14 #4, 11 §3.6.3 | — |
| 종류별 예외 | `question.kind_exceptions` | 결정 종류별 `always_ask`·`never_ask`·방식 지정 | — | 14 #5 | — |
| 루프별 설정 | `question.per_loop` | 루프 계열마다 질문 다이얼 값 | — | 14 #6 | — |
| 관점 폭 | `inquiry.breadth`, `narrow`·`normal`·`wide` | 발산 표의 행·열·렌즈 수 | 관점 폭 | 14 #7, 15 §3.4.2 | 발산 강도(`off`·`narrow`·`wide`, 15)와 다르다 |
| 탐구 깊이 | `inquiry.depth` | 라운드 수 1~8 | 탐구 깊이 | 14 #8 | — |
| 근거 범위 | `inquiry.evidence_range`, `target`·`docs`·`web` | 탐구가 근거를 찾는 범위 | 근거 범위 | 14 #9, 15 §3.3.3 | — |
| 자율 정도 | `inquiry.autonomy_rounds` | 사람 답 없이 진행할 라운드 수 0~8 | — | 14 #10 | — |
| 예산 | `inquiry.budget` | 하위 호출 수, 벽시계 분, 비용(USD) 상한. 활성화 하나에 적용 | 예산 | 14 #11, 12(집행) | 월 모델 비용 상한(J-22, 기본 USD 50 [가정])과 다르다 |
| 자극 수 | `inquiry.stimulus_count` | 라운드당 자극 수 4~12, 기본 8 | 자극 수 | 14 #12, J-06 | — |
| 증명 부담 | `assurance.proof_burden`, `light`·`standard`·`heavy` | 결과·판단에 요구하는 근거의 무게 | 가볍게 / 보통 / 엄격 | 14 #13, J-12 | 쓰지 않음(화면): Quick/Guided/Assured. 강도 프리셋은 문서 안 대응 설명 이름이다(14 §3.11.7) |
| 독립 검증 | `assurance.independent_verification`, `off`·`auto`·`always` | 검증 에이전트 요청 여부 | 독립 검증 | 14 #14 | 2단계 기능 |
| 설정 층 / 다이얼 해석 순서 | `DialLayer`(저장 층 `user`·`concern`·`instruction`), `DialPrecedence`(해석 순서 층 1~6) | 해석 순서: 1 시스템 기본값, 2 상황 유형 기본값, 3 모드, 4 사용자 저장 설정, 5 이 Concern에서 바꾼 값, 6 지금 이 지시. 아래 층이 위 층을 덮는다. 저장되는 것은 4~6뿐이다 | 값이 어느 층에서 왔는지 표시 | 08 §3.15, 14 §3.11.3, J-136 | Goal 범위 다이얼은 없다(J-136). 쓰지 않음: `DialScope`의 `global`·`goal`(§4 N-07) |
| 자동 상향 | auto escalation | 위험 신호가 있으면 해석 때 `proofBurden`을 `heavy`로 올린다. 저장하지 않고 루프 계획에 근거를 남긴다 | 요구보다 낮게 설정됨(사람이 낮춘 경우) | 14 §3.11.7 | 자동 하향은 없다 |
| 주의 예산 | attention budget, `OrchestrationSettings.attention` | 하루·시간 단위로 사람에게 요청해도 되는 사람 조작의 양(주의 비용 단위로 셈) | 주의 예산 | 14 §3.13.5, 05 §3.7.3 | 권리 게이트 질문은 예산과 무관하게 전달된다 |
| 작업 경계 | `WorkBoundaryKind` (일곱 값) | 예약 전달 질문을 내보내고 다이얼 변경을 반영하는 지점: `round_end`, `workunit_end`, `loop_transition`, `concern_waiting`, `user_return`, `review_window`, `daily_rollover` | — | 14 §3.13.6, J-63, 08 §3.4.4 | 명령 `runtime.boundary` → 이벤트 `boundary.reached`. 경계 항목(`bd`)과 다르다. 쓰지 않음: `concern_switch`, `daily_digest`(1판) |
| 검토 창 | review window | 사용자가 정한 질문 검토 시간대. 작업 경계 `review_window` | 검토 창 | 14 §3.13.6, 11 §3.5.2 | — |
| 거시 스케줄러 | macro scheduler | 여러 Concern 사이의 논리 배분(우선순위, 주의 예산, 활성 Concern) | — | 14 §3.13, J-13 | 물리 상한과 타이머는 12 스케줄러다(J-13). 행위자 `scheduler`(타이머)와도 다르다 |
| 작업 요청 | `WorkRequest` | 오케스트레이터가 거시 스케줄러에 넣는 "이 WorkUnit을 돌려 달라"는 요청. 12의 `RunSpec`으로 바뀐다 | — | 14 §2.3, §3.20.2 | trace `work.requested`·`work.admitted`·`work.deferred`로 따라간다(09 TraceKind) |
| 오케스트레이터 | orchestrator | 커밋된 이벤트를 구독해 전환·종료·다음 작업을 정하고 명령으로 다시 내는 런타임 부품 | — | 14 §3.1, §3.16 | 구현 작업 에이전트의 1단계 "메인 오케스트레이터"(§3.12)와 다른 말이다. 커널 밖이다. 행위자는 `runtime`(모델 선언 반영, `declaredBy`) 또는 `kernel`(코드 규칙) |
| Concern 오케스트레이션 상태 | `ConcernView` 상태 | `opening`, `working`, `waiting`, `accepted`, `integrated`, `closed`(+`reopened`). 저장하지 않는 계산 값 | — | 14 §3.12.2 | 08 Concern 표시 상태와 이름이 일부 같지만 다른 집합이다 |
| 루프 × 평면 | — | 루프마다 N/E/M에서 무엇을 읽고 쓰는지, 어떤 능력·정책이 걸리는지 정한 표 | — | 14 §3.4 | — |
| 진입 판정 | `entry.evaluate`, `entry.evaluated` | 새 요청의 진입 신호를 세어 Concern으로 열지 가벼운 작업으로 둘지 정한 기록 | 진입 판정 결과 | 14 §3.14.3, 10 §3.11.11 | 이의를 걸 수 있다(01 E1) |

### 3.5 묻기·자율성

| 용어 | 식별자 | 뜻 | 화면 | 정의 문서 | 혼동 주의 |
|---|---|---|---|---|---|
| 질문 레코드 | `Question`, `qs` | 묻기의 기록. 전달은 별도 결정이다 | 질문 | 08 §3.13, 11 §3.2 | §3.2 "질문" |
| 질문 종류 | `QuestionKind` (29개 + `other`) | 질문이 무엇을 묻는지. 예: `choice`, `criterion_confirm`, `agreement_confirm`, `result_review`, `scope_change`, `send_approval`, `goal_revision`, `fact`, `recovery`, `policy_change`, `goal_achievement` | 화면 종류로 묶어 보인다(03 §3.2.4) | 08 §3.13(정본), 11 §3.2.2 | 11 1판 이름(`decision_point`, `scope_expansion`, `action_approval`, `commitment_acceptance`, `result_acceptance`, `entry_confirm`, `stop_next`, `structure_cap`)은 쓰지 않는다(08 §10.2, J-26). `tool_outcome_unknown`은 `recovery`로 쓴다 |
| 화면 질문 종류 | 선택 요청, 정보 질문, 기준 확인·반응 요청, 판단 확인, 합의 확인, 결과 확인, Goal 확인, 예산 확인, 복구 선택, 관찰 제안 | 질문 종류를 화면에서 묶은 이름 | 선택 필요 / 확인하면 좋은 것 / 기준 확인 / 반응 요청 / 판단 확인 / 합의 확인 / 결과 확인 / Goal 확인 / 예산 확인 / 복구 선택 / 관찰 제안 | 03 §3.2.4 | "선택 요청"(원전 ChoiceRequest, DecisionGate)은 권리 게이트 질문 묶음의 이름이다 |
| 질문 형식 | `QuestionForm` | 응답 선택지를 정하는 형식: `answer`, `confirm_candidate`, `approve_action`, `result_review`, `choose_one`, `reaction` | — | 11 §3.2.3 | `choose_one`은 원함 탐구에서 금지(08 R-23, `policy.want_inquiry_pick_question`) |
| 응답 선택지 | `AnswerValue.option`, 형식별 필수 선택지 | 질문 형식이 정하는 답의 종류(추천대로, 가정대로, 다른 답, 확정·거절, 허락·고쳐서 허락·하지 않기, 기준 고치기, 먼저 알아보기, 범위 줄여 진행, 결과 확인). 질문마다 저장하지 않고 형식에서 정한다 | 허락 / 고쳐서 허락 / 하지 않기 / 추천대로 정하기 / 고쳐서 정하기 / 가정대로 진행 / 기준 고치기 / 질문 다시 쓰기 / 먼저 알아보기 / 범위 줄여 진행(권리 허락 질문에서는 "범위 줄여 허락") / 에이전트가 정하게 두기 / 미루기 | 11 §3.2.3, 05 §3.1.5 | 맡기기·다시 쓰기 요청·미루기는 답 값에 넣지 않고 별도 명령·이벤트로 남긴다(J-47: `question.delegate`→`question.delegated`, `question.request_reframe`→`question.reframe_requested`, `question.defer`→`question.deferred`). 19 §3.7.1은 아직 답 값으로 적었다(§4 N-03). 합의 확인·결과 확인 질문은 `question.answer`로 받지 않고 19 전용 메서드(`agreement.confirm`, `result.accept`)로 받는다(J-124) |
| 권리 게이트 | rights gate | 사람만 정할 권리가 있는 결정. 답이 올 때까지 해당 행동을 막고, 임시 가정과 시간 만료가 없다 | 선택 필요(설명할 때: 사람이 정할 일) | 브리프 결정 12, 11 §3.3.1, J-49 | 쓰지 않음(화면): 게이트. 침묵을 승인으로 해석하지 않는다(01 X-12). 마감은 사람이 정한 경우만 "마감"으로 보인다 |
| 권리 범주 | `RightsCategory` (10개) | `spend_money`, `speak_for_user`, `affect_others`, `disclose_data`, `irreversible_external`(권한 레이어 판정), `goal_change`, `result_acceptance`, `commitment_acceptance`, `policy_change`, `authority_expansion`(커널이 명령 종류로 앎) | — | 08 §3.13, 11 §3.3.1 | — |
| 정보 게이트 | information gate | 사람의 답이 정보로서 가치가 있는 결정. 조건 1~3이 모두 참(AND)일 때 묻는다 | 확인하면 좋은 것(설명할 때: 알려 주면 좋은 것) | 브리프 결정 12·16, 11 §3.3.2~§3.3.4 | 조건별 문턱은 다이얼이다. AND/OR 선택 옵션은 두지 않는다 |
| 질문 조건 1~3 | `c1`, `c2`, `c3`, `AskEvaluation` | 1 정책이 처리하지 못함, 2 결과가 실질적으로 바뀜, 3 지금 묻는 가치가 주의 비용보다 큼 | — | 08 §3.4.5·§3.13, 11 §3.3.4 | — |
| 게이트 판정 갈래 | `rights`, `policy`, `autonomous`, `digest`, `ask` | 결정점 하나를 권리 질문, 정책대로 처리, 혼자 정하기, 묶음 질문 + 임시 가정, 질문으로 나누는 판정 결과 | — | 11 §3.4 | `ask`는 다시 `with_assumption`, `with_scope_reduction`, `blocking`으로 나뉜다 |
| 결정점 | `DecisionPoint`, `decisionPointKey` | 에이전트가 선언하는 "여기서 정할 것이 있다"는 지점과 그 식별 키. 이의가 걸린 결정점은 다시 혼자 정하지 않는다 | — | 11 §3.3.2, 08 §3.4.5 | — |
| 결정 종류 | `decisionKind` | 결정 종류 레지스트리 키. 종류별 형식·예외 다이얼·지표에 쓴다 | — | 11 §3.3.3, 08 §3.4.5 | 질문 종류(`QuestionKind`)와 다른 목록이다 |
| 막힘 범위 | `BlockScope`: `nothing`, `action`, `workunit`, `concern` | 답이 없을 때 무엇이 멈추는가 | 막힘 | 08 §3.13, 11 §3.2 | `nothing`이면 막지 않는 질문 |
| 전달 방식 | `DeliveryMode`: `immediate`, `negotiated`, `mediated`, `scheduled` | 질문이 언제 사람 앞에 놓이는가: 즉시, 협상(사람이 볼 때를 정함), 중재(중재자가 정함), 예약(작업 경계·복귀·시각) | 즉시 / 볼 때 보면 됨(협상) / 중재자가 정함 / 묶어서 전달(예약) | 브리프 결정 12, 08 §3.13, 11 §3.5 | 기본은 협상(01 PR-06) |
| 알림 강도 | `urgency`: `interrupt`, `notice`, `digest` | 전달할 때 계산해 `question.delivered`에 남기는 세기. 레코드에 저장하지 않는다 | 끼어들기 / 알림 / 묶음 | 11 §3.5.1, 09 `question.delivered`, J-52 | 05 §3.1.2는 `notify`라고 쓴다(§4 N-17). 전달 방식은 "언제", 알림 강도는 "얼마나 세게"를 정한다 |
| 전달 경로·표시 방식 | `channel`(09), `surface`(11) | `question.delivered`의 전달 경로 필드와 표시 방식 배열 | — | J-52 | 둘을 섞어 쓰지 않는다 |
| 발화 조건 | `DeliveryTrigger`: `now`, `at`, `boundary`, `with_result_review` | 예약 전달을 내보내는 조건 | "라운드 3 끝에 묶어서 전달" 같은 문장 | 11 §3.5.1 | 08에는 `plannedDelivery`의 `at`·`boundary` Trigger로 저장한다 |
| 전달 계획 | `question.delivery_planned`, `delivery.planned`, `plannedDelivery` | 중재자·규칙이 정한 질문별 전달 계획과 묶음 전달 기록 | 곧 전달될 것 | 09 §3.4.9, J-51, 08 §3.13 | 묶음은 `delivery.planned`와 질문별 이벤트를 모두 남긴다(J-51). 전달 계획은 혼자 정한 결정 블록을 가진다 |
| 즉시 승격 | escalation | 협상·중재·예약 질문이 만료점에 가까워져 즉시로 바뀌는 것 | 만료점이 가까워 지금 전달했습니다 | 11 D-3, 05 §3.1.2 | 이때만 같은 질문에 두 번째 알림을 보낸다 |
| 질문 병합 | `dedupeKey`, `question.updated`, `notice.question_merged` | 같은 미해결 질문을 하나로 합치는 것 | — | 11 §3.5.5, J-50 | 같은 질문을 여러 번 알리지 않는다(01 X-11) |
| 임시 가정 | working assumption, `Question.assumption` → 전제 `as` | 답을 받기 전까지 에이전트가 따르는 기본값. 정보 게이트·비막힘 질문에만 둔다 | 임시 가정 / 사용 중인 가정 | 브리프 §6, 11 §3.6.1 | 쓰지 않음: 기본값, `wa` 레코드. 권리 게이트에는 없다(`invalid.assumption_on_rights_gate`) |
| 가정 만료점 | `assumptionExpires`(`Trigger`) | 넘기면 답이 바뀌었을 때 되돌리는 비용이 커지는 지점. 도달하면 임시 가정을 확정한다 | 만료점 | 브리프 §6, 08 §3.13, 11 §3.6.2 | 쓰지 않음: 데드라인. 원전 last-cheap-point. 권리 게이트의 "마감"과 다르다 |
| 가정 확정 | `question.assumed`, `assumption_expired` | 만료점까지 답이 없어 임시 가정을 선택으로 확정한 것. 혼자 정한 결정에 들어간다 | 가정대로 정해짐 | 08 §3.22.7, 11 §3.6.3 | 쓰지 않음: 가정 확정을 "답함"으로(05 §3.10.9) |
| 늦은 답 | `command.alreadyResolved`(3008), `assumedValue` | 가정 확정 뒤 들어온 답. 3008로 거부하고 응답에 확정된 값과 다음 행동 "이의로 보내기"를 싣는다. 화면은 쓰던 답을 이의 초안으로 넘긴다 | 이미 가정대로 정해졌습니다(이의로 보내기) | J-120 | 2b 판의 "받아서 기록"(08 §10.2)은 J-120으로 바뀌었다 |
| 중재자 | mediator, `agent:mediator` | 질문 전달 시점과 묶음을 정하는 에이전트(중재 전달 방식). 질문과 사람 상태만 읽는다 | 중재자 | 브리프 §6, 11 §3.7 | 2단계 기능 |
| 사람 접속 상태 | presence, `PresenceState`: `active`, `idle`, `hidden`, `offline` | 기기별 활동 상태. 상태가 바뀔 때만 `presence.changed`로 남긴다. 부재(away)는 저장하지 않고 14 §3.13.8의 파생 함수로 계산하며, 기기 종류별 문턱(휴대폰 active 2분, 데스크톱 5분)을 그 함수의 입력으로 둔다 | — | 09 §3.2, J-46, J-64, J-119 | `locked`는 쓰지 않는다(J-118, J-119). `online`·`away`를 저장 값으로 쓰지 않는다(§4 N-02). `urgencyOf`, 푸시 계획, 복귀 판정은 모두 부재 파생 함수를 쓴다 |
| 방해 금지·조용한 시간 | DND, quiet hours | 알림 강도를 묶음으로 낮추는 사용자 설정. 기록과 전달 기록은 그대로 한다 | 방해 금지 | 05 §3.7.4, 11 §3.5.1 | 방해 금지 = 자리에 없음으로 다룬다 |
| 혼자 정한 결정 | autonomous decision, `AutonomousDecision` | 사람에게 묻지 않고 정한 선택과 그에 준하는 기록(루프 계획·전환, 상황 판정, 구조 결정, 모드 배정, 가정 확정 등). `whyNotAsked`를 반드시 남기고 이의를 받을 수 있다 | 에이전트가 정한 것 | 브리프 결정 8·§6, 08 §3.4.5, 11 §3.9 | 쓰지 않음(화면): 자율 결정, 피드. 별도 레코드를 두지 않고 결정 레코드의 `Autonomy` 블록으로 표시한다 |
| 묻지 않은 이유 | `whyNotAsked` | `info_gate`(조건 거짓), `assumption_expired`, `within_grant`, `emergency`, `auto_verifiable`, `delegated_by_human`, `rule` | 묻지 않은 이유: … / 규칙에 따라 정해짐 / 가정대로 정해짐 / 비상 합의로 정해짐 / 맡겨서 정해짐 / 에이전트가 정함 | 08 §3.4.5, 03 §3.3.4 | 11 1판 이름 `delegated`·`rule_default`는 쓰지 않는다(11 §2.4 대응표). 원전 `why_not_asked` |
| 확인(혼자 정한 결정) | `decision.confirm`, `decision.confirmed`, `confirmedSeq` | 사람이 혼자 정한 결정을 보고 "이대로 둔다"고 확인한 것. 상태는 바꾸지 않는다 | 이대로 두기 | 10 §3.11.5, 08 §3.4.3 | 결과 확인(`ac`)과 다르다 |
| 봤음 표시 | `autonomous.mark_seen`, `autonomous.seen` | "에이전트가 정한 것"을 어디까지 봤는지 표시 | 봤음 | 10 §3.11.11, 09 | 확인·승인이 아니다(21 §3.7.3) |
| 이의 걸기 | 메서드 `objection.file` → 명령 `decision.contest` → 이벤트 `objection.filed` | 사람이 대상 레코드나 근거 관계에 이의를 거는 조작. 결과 확인 뒤 되돌리기도 이 조작이다(J-123) | 이의 걸기(`OVL-CONTEST`) | J-111, 10 §3.11.5, 05 §3.3, 08 §3.10.2 | 쓰지 않음: 메서드 `contest.file`(J-111), 이벤트 `contest.filed`·`decision.contested`(J-30), 명령 `finding.contest`, 메서드 `result.reopen`(J-123) |
| 바라는 처리 | `desiredEffect`: `reopen`, `ask_next_time`, `note_only` | 이의를 건 사람이 바라는 처리. 되돌리기(revert)는 `reopen` + 재작업이다 | 다시 열기 / 다음에는 묻기 / 기록만 | 08 §3.10.2, J-53, 05 §3.3.3 | 11의 `desired` 필드 이름은 쓰지 않는다 |
| 이의 대상 | `ObjectionTarget`: `record`(+`itemKey`), `link` | 레코드(또는 레코드 안 항목)나 근거 관계 하나 | — | 08 §3.10.2, J-36 | 19의 `criterionVerdict` 형식은 쓰지 않는다(J-36) |
| 재결정 | redecide | 이의 뒤 같은 결정점을 다시 정하는 것. 혼자 다시 정하지 않고 사람에게 묻는다 | — | 11 §3.10.2 | 거부 코드 `policy.redecide_after_objection` |
| 범위를 줄여 진행 | scope-reduced progress, `Agreement.narrowedScope` | 질문과 무관한 독립 부분만 계속하는 것 | 범위 줄여 진행(권리 허락 질문에서는 "범위 줄여 허락") | 11 §3.11, 08 §3.11.1 | 범위 줄이기도 혼자 정한 결정 블록을 가진다. 쓰지 않음: 범위 축소, 권리 질문 밖의 "범위 줄여 허락" |
| 자동 검증 가능한 선택 | `auto_verifiable`, `choiceKind: auto_verified` | 검증 관찰로 맞는지 확인할 수 있는 선택은 에이전트가 정한다 | 에이전트가 정함 | 11 §3.13, 08 §3.4.5 | 검증 관찰이 없으면 `policy.verification_missing` |
| 승인과 인자 지문 | `Question.approval`, `approvalFingerprint`, `ap`, `approval.*`, `editedFrom` | 권리 게이트 허락은 그 도구 호출의 인자 지문에만 유효하고 1회 소진된다. 그대로 허락하면 같은 도구 호출 ID로 이어 가고(J-40), 고쳐서 허락(`approve_edited`)하면 원 호출을 `denied(edited_by_human)`로 닫고 원 tcId와 질문 id에서 결정적으로 만든 새 tcId(`editedFrom` = 원 tcId)가 같은 트랜잭션에서 intend한다 | 허락 / 인자 고쳐 허락 | 08 §3.13, 11 §3.14, J-40, J-48, J-117, J-121 | ApprovalToken 레코드는 없다(`ap`는 질문 안 블록 id). 유효 기간은 `approval.expiresAt` |
| 사람 행동 요청 | — | 사람의 답·확인이 필요한 모든 요청. 모두 질문함에 들어온다 | 질문함(`SCR-INBOX`) | 03 §3.2.4, IA-02 | 쓰지 않음: 받은 편지함, 알림함 |
| 선택 필요 목록 | — | 권리 게이트 → C/A 접점 → 막힌 정보 게이트 → 나머지 순서의 목록. 기본 표시 `maxVisibleDecisions`개 | 지금 정할 것 | 14 §3.13.5 규칙 6, 04 §3.3 | 권리 게이트는 접지 않는다 |
| 질문 문장 구성 | `text`, `whyNow`, `options`, `recommendation`, `strongestAlternative`, `unknowns`, `delayImpact`, `reviewTrigger` | 지금 정할 것, 왜 지금, 선택지와 추천, 가장 강한 다른 선택, 모르는 점, 미뤘을 때의 영향, 다시 볼 조건 | 고정 표현(05 §3.10.4) | 08 §3.13 | — |
| 질문 사유 | `QuestionReason` | 왜 사람이 정해야 하는가: `value_conflict`, `high_uncertainty`, `authority_boundary`, `disagreement`, `acceptance`, `integration`, `missing_context` | 문구 키 `question.reason.<값>` | 08 §3.13, 05 §3.1.5 | `irreversible`은 뺐다(결정 2) |

### 3.6 탐구

| 용어 | 식별자 | 뜻 | 화면 | 정의 문서 | 혼동 주의 |
|---|---|---|---|---|---|
| 탐구 | inquiry, `InquiryKind`: `fact`, `want`, `possibility`, `outcome` | 사실·원함·가능성·결과 네 종류의 I 루프 활동 | 탐구(`SCR-INQUIRY`) | 브리프 결정 7, 15 | "관점 탐구"는 따로 두지 않는다(O 루프에서 다룸) |
| 탐구 실행 | `Inquiry`, `iq` | I 루프 활성화 한 번의 탐구. 단계 WorkUnit 여러 개로 실행된다 | 탐구 | 15 §1.4, 08 §3.17.1 | — |
| 라운드 | round | 탐구 종류별로 정한 한 번의 순환. 멈춤 조건의 "두 라운드"는 이 단위다 | 라운드 n | 15 §1.4 | 라운드 마치기는 사람이 명시하면 고르기만 한 라운드도 닫힌다(J-34) |
| 발산 서브시스템 | divergence subsystem | ① 앵커링 ② 발산 ③ 검토 ④ 대비 압축 + 질문 하나 ⑤ 반응 수집 ⑥ 반응 → N 전이 ⑦ 정지 규칙의 일곱 단계 | — | 15 §3.4.1 | 탐구 단계는 10단계(14)의 "단계"와 다르다 |
| 발산 강도 | `off`, `narrow`, `wide` | I 루프 안에서 발산을 얼마나 넓게 할지. 신호와 관점 폭 다이얼로 코드가 정한다 | — | 15 §3.4.2 | 관점 폭 다이얼(`narrow`·`normal`·`wide`)과 값이 다르다 |
| 발산 신호 | S1~S6 | S1 목표가 흐림, S2 "뭘 원하는지 모르겠다", S3 잦은 정정, S4 취향에 달림, S5 관점·해법이 나뉨, S6 이유 없는 부정 반응 | — | 15 §3.4.2 | S 루프, 샌드박스 수준 S0·S1·S1b·S2(13), 성공 기준 SC-n과 다르다 |
| 앵커링 | anchoring, `inquiry.anchored` | 확실한 것, 모호한 것, 암묵 가정을 나누는 첫 단계 | — | 15 §3.4.4 | — |
| 다섯 방향 | `Direction`: `up`, `down`, `side`, `invert`, `lens` | 관점을 만드는 방향: 위로(목적 사다리), 아래로(분해), 옆으로(대안), 뒤집기(실패·후회), 렌즈(Method Transfer) | — | 15 §3.4.5, 08 §3.17.1 | — |
| 관점 행 | perspective, `Perspective`, `p<n>` | 발산 표의 행. 다섯 방향 중 하나로 만든 관점 | 관점 | 15 §1.4, 08 §3.17.1 | 가능성 종류 `perspective`(사실 탐구 1단계 관점)와 연결된다 |
| 발산 표 | divergence table, cell | 관점 행 × 열의 표. 빈 칸마다 독립 가지가 채운다 | — | 15 §3.4.5 | — |
| 가지 | branch, `agent:branch` | 발산 표의 칸 하나를 채우는 독립 하위 실행. 다른 가지의 결과를 보지 못한다 | — | 15 §1.4, 08 §3.3.2 | — |
| 가지별 다른 모델 | `diversity: single_family` | 가지마다 다른 모델 계열을 쓰는 것. 한 계열뿐이면 그렇게 표시한다 | 같은 모델 계열로 발산함 | 15 §3.4.6, 03 §3.3.6 | — |
| 역할 호출 | role call | 정해진 출력 스키마로 모델을 한 번 부르는 일. 단순 호출과 하위 실행(sub-run) 두 형태 | — | 15 §1.4 | — |
| 적대적 검토 | adversarial review | 근거 확인과 함께 각 후보에 반대 근거를 붙여 보는 검토 단계 | — | 15 §3.4.7 | 검증 에이전트의 증언과 다르다 |
| 중복 병합 | `possibility.merge`, `merged_into` | 결과가 같은 가능성을 하나로 합치는 것 | — | 15 §3.4.8 | — |
| 대비 압축 | contrast compression, `contrast.presented` | 결과가 다른 순서로 정렬해 앞줄만 보이는 것(순서만 바꾸고 지우지 않는다) | — | 15 §3.4.9, 05 §3.2.7 | — |
| 앞줄 | front row | 대비 압축이 앞에 보이는 항목. 나머지는 접히지만 펼쳐서 반응할 수 있다 | — | 15 §1.4 | — |
| 질문 하나 | one question | 대비 압축 뒤 사람에게 던지는 가장 가치 있는 질문 하나 | — | 15 §3.4.10 | — |
| 반응 → N 전이 | — | 반응에서 기준 후보 → 선호 모델, Goal 수정 제안, Concern 재정의 제안을 만드는 단계 | — | 15 §3.4.12 | 브리프 §3.1 관계 "E reveals N" |
| 개인 이력 | personal history | 반응과 기각을 남겨 다음 발산에 쓰는 기록 | — | 15 §3.4.13 | — |
| 정지 규칙 | stop rule, `inquiry.stop_rule_met` | 반응이 더 이상 계획을 바꾸지 않으면(계획 지문이 안정) C로 전환을 제안한다 | — | 15 §3.4.14 | — |
| 계획 지문 | `PlanFingerprint` | 정지 규칙 판정에 쓰는 현재 계획 상태의 요약 해시 | — | 15 §1.4, §3.4.14 | 승인의 인자 지문과 다르다 |
| 자극 방향 | `same_domain`, `cross_domain`, `extreme`, `contrast_pair`, `refinement` | 자극을 만든 방향 | — | 08 §3.17.3, 15 §3.6.3 | — |
| 통제 쌍 | `contrast_pair`, `controlledFor` | 기준 하나만 다른 자극 쌍. 구분 확인에 쓴다 | — | 08 §3.17.3, 15 §3.6.6 | — |
| 특징 | `facets` | 자극이 선언한 특징(예: 도입부 방식) | — | 08 §3.17.3 | — |
| 요소 단위 반응 | `ElementSelector`: `whole`, `element`, `text_range`, `region` | 자극의 일부에 대한 반응 | 요소 고르기 | 08 §3.17.3, 05 §3.2.3 | — |
| 강도 | `intensity` -2~2 | 아주 싫음 ~ 아주 좋음 | 강도 | 08 §3.17.4 | 알림 강도(`urgency`)와 다르다 |
| 이유 없는 반응 | `reason: null` | "이유는 모르겠는데 이건 아니다". 근거로 쓴다 | 이유 없이 아님 | 08 §3.17.4, 05 §3.2.2 | 정상 반응이다. 화면이 이유를 강요하지 않는다 |
| 세 개 비교 | triad | 셋 중 둘은 비슷하고 하나는 다른데 무엇 때문인가를 묻는 반응(레퍼토리 그리드). 말 못 하겠음(`cannotSay`)도 받는다 | 세 개 비교 | 08 §3.17.4, 05 §3.2.4 | 질문 종류 `triad`가 따로 있다 |
| 고쳐 말하기 | `rephrase` | "이것과 비슷한데 더 짧게" 같은 반응 | 고쳐 말하기 | 08 §3.17.4 | — |
| 가깝다 | `near` | 방향만 알려 주는 표시. 정보성 반응으로 세지 않는다 | 가깝다 | 08 §3.17.4 | — |
| 고르기만 한 라운드 | `pickOnly` | 정보성 반응 없이 고르기와 같은 반응만 있는 라운드 | — | 15 §3.4.14, 16 `inq.pick_only_round_ratio` | 원함 탐구는 고르기로 끝내지 않는다(05 A6). 사람이 명시하면 닫히고 다음 라운드에 세 개 비교를 넣는다(J-34) |
| 말한 기준과 실제 반응의 차이 | `statedVsRevealed`, `preference.divergence_noted` | 사람이 말한 기준과 반응에서 나온 기준의 차이. 숨기지 않고 남긴다 | 말한 기준과 실제 반응 | 08 §3.17.5, 15 §3.6.5 | SC-4, G1-3의 측정 대상 |
| 선호 모델 두 층 | `scope: goal \| user` | Goal 안의 기준과 Goal을 넘어 쓰는 사용자 층 기준. 사용자 층 기준은 Goal에서 다시 확인한다(`inheritedFrom`) | — | 15 §3.7.2, 08 §3.17.5 | — |
| 지지 등급 | `SupportGrade`: `untested`, `weak`, `consistent`, `confirmed`, `contested` | 숫자 신뢰도 대신 코드가 계산하는 질적 등급. 저장하지 않는다 | 아직 확인 안 됨 / 약함 / 일관됨 / 확인됨 / 이의 있음 | 15 §3.2.4, J-19 | 쓰지 않음: confidence 숫자, "신뢰도 n%". 14의 질적 확신 등급(`Grade`, 08 §3.4.1)과 다르다 |
| 무게 | `weight`: `high`, `medium`, `low` | 선호 기준의 서열. 확률이 아니며 사람에게 확인받는다 | 무게 | 15 §3.2.4, 08 §3.17.5 | — |
| 원인 후보 / 해법 / 실패 경로 | `possibilityKind`: `cause`, `solution`, `failure_path` | 사실·가능성·결과 탐구가 만드는 가능성의 종류 | 가능성 | 08 §3.9.3 | — |
| 사전 부검 | pre-mortem | 결과 탐구에서 "실패했다면 왜인가"를 뒤집기 방향으로 만드는 단계 | — | 15 §3.4.1, §3.10 | — |
| 작은 실현 가능성 확인 | — | 가능성 탐구에서 후보가 실제로 될지 가볍게 확인하는 것 | — | 15 §3.8.3 | 탐침(C.probe)과 다르다 |
| Method Transfer | Method Transfer | 다른 분야의 방법·사고방식을 지금 문제에 적용하는 가능성 탐구 안의 동작 | 다른 분야 방법(렌즈) | 브리프 결정 13, 15 §3.9 | 쓰지 않음: 투영, Projection |
| 렌즈 seed | — | 처음에 넣어 두는 렌즈 35개 | — | 15 §3.9.6 | — |
| REPL 방식 탐구 | REPL workspace, `helm.subcall`, `helm.wsGet`·`wsPut`·`wsList`·`wsDel`, `helm.emit` | 큰 입력의 사실 확인에서 코드로 하위 호출을 지휘하는 방식. 실행 사이 값은 비정본 작업 공간에 둔다 | — | 15 §3.12, J-98 | 쓰지 않음: RLM 방식, pi `store`. REPL 작업 공간은 정본이 아니다. 13의 REPL 도구, 09 trace `repl.workspace_written`과 연결 |
| 탐구 예산 | `inquiry.budget` | 탐구 활성화 하나의 하위 호출·시간·비용 상한 | 탐구 예산 | 14 #11, 15 §3.13.3 | — |
| E0 평가 | E0~E4 | 커널 연결 전에 발산 서브시스템의 효과를 평가 하네스로 보는 실험 | — | 15 §3.15.2 | H-I1~H-I4, H-R1 측정에 쓴다 |

### 3.7 런타임·도구

| 용어 | 식별자 | 뜻 | 화면 | 정의 문서 | 혼동 주의 |
|---|---|---|---|---|---|
| 런타임 | `@helm/runtime`, `RunEngine` | WorkUnit·루프 실행, 탐구 엔진 구동, 커널 연결점, 컨텍스트 투영, 컴팩션, 크래시 복구, 타이머 스케줄러, 오케스트레이터를 담는 Helm 자체 런타임. 런타임 어댑터의 1차 구현이다 | — | 06 §3.4.10, 12 §2.1 | 행위자 `runtime`(코드가 낸 기록), 외부 런타임(Claude Code 등)과 구분한다 |
| 에이전트 루프 | `@helm/agent`, `@helm/vendor-pi-agent-core` | pi-agent-core를 포크한 범용 모델 루프. Helm 도메인을 모른다 | — | 07 §3.4, 12 §3.4, 결정 28 | — |
| run | `Run`, `rn` | 에이전트 루프 한 번의 구동. Concern 하나와 thread 하나에 속한다 | 화면에 따로 이름 없음 | 12 §1.3, 08 §3.18.1 | §3.2 "에이전트 실행" |
| run 종류 | `RunKind`: `work`, `verifier`, `mediator`, `branch`, `subrun`, `observer`, `router`, `inquiry`(08) | 실행 주체의 종류. `inquiry`는 pi 루프 대신 탐구 엔진 `runStage`를 구동한다(J-97) | — | 08 §3.18.1, 12 §3.2.1 | 12의 `RunKind`에는 `observer`·`router`가 없다(§4 N-23) |
| thread | `Thread`, `th` | 같은 모델 대화 기록을 이어 쓰는 run들의 계보. 사람 결정을 기다리다 끝난 run 뒤에는 같은 thread의 새 run이 이어 간다(J-38) | 대화 | 12 §1.3, 08 §3.18.3 | — |
| attempt | `attempt` | 같은 run을 이어서 구동한 횟수(1부터). 크래시 뒤 재개하면 1 오른다 | — | 12 §1.3 | 재개 횟수(`recoveryAttempts`, 상한 3)와 다르다 |
| 이어받기 | `ended(handed_off)` + 새 run, trigger `question_answered`·`approval_granted`·`recovery_resolved` | 답·승인·복구 기록이 오면 기다리던 run을 닫고 같은 thread의 새 run이 이어 가는 방식 | — | 12 §3.2.2, J-38, J-96 | `run.resumed` 이벤트는 없다. `handed_off`는 선언 인계(선언 도구로 끝난 run)에도 쓰인다 |
| 사람 대기 | `run.await` → `run.awaiting`, 상태 `awaiting_human`·`awaiting_recovery` | 막는 질문이나 결과 불명 해소를 기다리며 턴 경계에서 루프를 끝낸 상태 | — | 12 §3.13.1 | 부팅 때 그대로 둔다(J-39) |
| turn | turn | 모델 응답 하나와 그 응답의 도구 호출 배치 | — | 12 §1.3 | 턴 경계는 정리 정지·steer가 들어가는 지점이다 |
| stage | `Stage`: `inference`, `tools`, `compaction`, `settlement`, `idle`, trace `run.stage` | run이 지금 어느 단계에 있는지. 레코드 필드에 두지 않고 trace로 남긴다 | — | 12 §3.2.3, J-32 | 19의 `RunPhase`(일곱 값)와 대응이 없다(§4 N-26) |
| 커널 연결점 | `message_end`(이벤트 싱크), `beforeToolCall`, `afterToolCall`, `prepareRequest` | 포크 루프에서 기록·커널 검사로 넘어가는 네 훅 | — | 12 §3.4, 브리프 결정 28, J-14 | — |
| 지시 | `Directive`: `run.signal{pause, abort, wrap_up, continue, resume}`, `notify`, `agent.request` 등 | 커밋 뒤 커널이 런타임에 넘기는 일. 이벤트가 아니다 | — | 10 §3.1.4, 12 §3.12.4 | 1판 `KernelEffect` |
| 정리 정지 | `wrap_up`, `run.stop` | 다음 턴 경계에서 정리 알림을 한 번 주고 멈추는 정지 | 안전하게 멈추기 | 12 §3.4.9, 10 §3.11.11 | 즉시 끊기(`abort`, `run.cancel`)와 다르다 |
| 실행 입력 | `RunInput`, `ri`, 방식 `steer`·`follow_up`·`interrupt` | 실행 중 run에 들어가는 사람 입력. 입력 큐(inbox)를 거친다 | 방향 바꾸기 | 12 §3.12 | — |
| 모델 계층 | `@helm/ai`, `ModelGateway` | pi-ai를 얇은 인터페이스 뒤에 둔 패키지. 역할 해석, 스트림, 재시도·대체, 사용량을 한곳에서 한다 | — | 12 §3.3, 결정 27 | — |
| 모델 역할 | `ModelRole`: `work`, `verifier`, `mediator`, `branch`, `subrun`, `summarizer`, `subcall`, `observer`, `router`, `inquiry`, `image` | 설정에서 후보 모델 목록을 고르는 키 | — | 12 §3.3.2 | 행위자 역할(`AgentRole`)과 목록이 다르다 |
| 모델 요청 | `mr`, `requestId` | 제공자 요청 하나. 재시도는 같은 `mr`의 시도 번호로 센다 | — | 12 §1.3 | — |
| 제공자 | `provider`(코드), `ProviderHealth` | 모델 API를 내는 회사·서비스 | 모델 제공자 | 12 §3.3, 이 문서가 정본(§4 N-53) | 설계 본문은 "제공자", 화면은 "모델 제공자", 코드 식별자는 `provider`로 쓴다. 쓰지 않음: 본문의 "provider"(코드 표기 밖), "공급자" |
| 비밀 저장소 | `SecretStore`, `SecretStoreCredentialStore` | 데몬이 시작 때 `secrets run` 자식 로더로 받은 비밀을 두는 메모리 저장소와, 거기서 모델 키를 읽는 구현 | — | 17 §3.8, 18 §3.10, 12 §3.3.4, 결정 45, J-57 | 비밀 원본은 SOPS 파일이다. 환경 변수 방식은 일회성 레시피·테스트만 |
| 컨텍스트 투영 | `cp`, `projectionId`, `run.context_projected`, `ProjectionManifest` | 모델 요청 하나에 쓴 모델 컨텍스트와 그 메타. 정본을 읽어 만들고 정본을 쓰지 않는다(A11) | — | 12 §3.5, J-16 | `cx`는 연결 id다 |
| 투영 원칙 | PJ-1~PJ-9 | 정본 비쓰기, 결정성, manifest, 필수 범주 fail-closed, 앞부분 불변 등 | — | 12 §3.5.1 | — |
| 슬롯 | S1~S8 | 요청 메시지를 이루는 자리: 머리 시스템(S1~S4), snapshot(S5), transcript(S6), delta(S7), notice(S8) | — | 12 §3.5.2 | 샌드박스 수준 S0~S2, 발산 신호 S1~S6과 모양이 같다 |
| 주입 메시지 | `<helm_context>`, `<helm_notice>`, `<untrusted>` | 런타임이 thread에 덧붙이는 상태·알림 메시지와 바깥 글을 감싸는 경계 | — | 12 §3.5.2, 18 §3.12 | 사람 발화와 구분해 `origin`으로 기록한다 |
| 필수 범주 | `agreement`, `criteria`, `counter_evidence`, `contests`, `open_questions`, `assumptions` 등 | 생략하지 않는 컨텍스트 섹션. 이것만으로 창을 넘으면 요청하지 않는다(fail-closed, `context_overflow`) | — | 12 §3.5.4~§3.5.5 | — |
| 컴팩션 | compaction, `cs`, 1단계 생략(`elide`)·2단계 요약(`summarize`) | 대화 서술만 줄이고 상태는 직후 새 snapshot으로 다시 넣는 정리 | — | 12 §3.6 | 상태(정본)를 요약하지 않는다 |
| 크래시 복구 | CR-1~CR-7, `RuntimeLifecycle.recover` | 실행 의도 → 실행 → 결과 순서 기록과, 재시작 때 중단된 run·도구 호출을 정리하는 절차 | 복구(`SCR-RECOVERY`) | 12 §3.7, 결정 30 | 데몬 모드 "복구"와 섞지 않는다(§4 N-28) |
| 자동 재개 | `decideResume`, `recover:<runId>:<attempt>` | 중단된 run을 같은 runId의 새 attempt로 다시 시작하는 것(최대 3회, 5초 간격) | 중단됨(재시작) · 자동 재개 중 | 12 §3.7.5 | 재개 예산을 다 쓰면 `recovery_exhausted`(종료 이유) |
| 재실행 등급 | `replay`: `never`·`safe`, `replayGuard` | 재시작 뒤 같은 인자로 다시 실행해도 되는지 도구가 선언한 값. 기본 `never` | — | 13 §3.1, 12 §3.7.2 | — |
| 결과 불명 | `toolcall.interrupted` / `toolcall.outcome_uncertain` | 실행했는지 알 수 없는 도구 호출. 외부 효과가 없으면 질문 없이 `interrupted`, 있으면 `outcome_uncertain` + `recovery` 질문 | 결과를 모르는 외부 행동 | 12 §3.7.3, J-05, J-44 | 쓰지 않음: `tool_outcome_unknown`(§4 N-13), `toolcall.outcome_unknown` |
| 외부 효과 | `externalEffect` | 발송, 원격 쓰기, 네트워크처럼 작업 공간 밖에 효과가 생길 수 있는지 | — | 13 §3.1, 12 §3.7.3 | 결과 불명 처리와 복구 질문 게이트를 정한다(J-05) |
| 실행 소유권·펜싱 | `RunHandle{runId, attempt, epoch}`, `fence` | 데몬 하나가 유일한 writer이고 그 안에서 run attempt 하나가 run을 소유한다. 쓰기마다 epoch·attempt를 대조한다 | — | 12 §3.8 | 시간 lease는 두지 않는다 |
| 타이머 스케줄러 | 도메인 타이머(`p_timers`, `timer.fire`), 시스템 타이머(`runtime_timers`, `tm`) | 기한·트리거를 발화하는 12의 단일 타이머 | — | 12 §3.10, J-13 | 14의 거시 스케줄러(논리 배분)와 다르다 |
| 예산 계정·원장 | `BudgetAccount`, `budget.charged`, `budget.exhausted`, `p_budget` | run·WorkUnit·활성화·합의·탐구·일·월·관찰 계정에 사용량을 함께 차감하는 기록 | 예산 | 12 §3.11 | 월 상한은 설치 때 묻고 답이 없으면 USD 50(J-22) |
| 하위 실행 / 역할 호출 / 하위 호출 | `RunKind: subrun` / role call(`ModelPort.call`) / `helm_subcall` | 읽기 도구로 과제를 하는 자식 run / run 없는 단일 모델 호출 / 모델이 도구로 부르는 새 모델 호출 한 번 | — | 12 §3.14, 13 §3.8.2, 15 §1.4 | 하위 호출 결과는 관찰이 아니다 |
| 검증 에이전트 run | `RunKind: verifier` | 결과 제출을 새 컨텍스트에서 다른 계열 모델로 확인하는 run | 검증 에이전트 | 12 §3.14.2 | 쓰지 않음(화면): 검증자, 리뷰어 봇 |
| 독립성 표시 | `independence: same_model` | 다른 계열 모델을 고르지 못하고 같은 모델로 떨어졌음을 남긴 표시 | 같은 모델 계열로 발산함 | 12 §3.3.3 | — |
| 도구 | `HelmToolSpec`, `ToolKind`: `basic`, `helm`, `declaration`, `subcall`, `repl`, `mcp`, `subrun_submit` | 도구 하나의 선언과 구현 계약 | 도구 활동 | 13 §3.1 | — |
| 기본 도구 | `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls` | coding-agent에서 포크한 원시 행동 도구. MVP에서 `grep`은 확장한다(페이지 `skip`, 파일당 상한, `paths[]`) | — | 13 §3.3, §3.3.8 | — |
| 웹 읽기 도구 | `web_fetch` | 외부 웹 페이지를 읽는 MVP 도구. 데몬이 직접 받고 본문 변환은 네트워크 없는 작업자가 한다. [결정 55] | — | 13 §1.3·§3.2.4, [판정 J-190 (1)] | 서버 측 `web_fetch`(Anthropic 제공)는 MVP에서 쓰지 않는다(13 §3.2.4) |
| 웹 검색 | `web_search` | Helm 함수 도구. 검색 질의를 제공자 인터페이스 뒤에서 부른다. 기본 Brave, 예비 Tavily(설정 `tools.webSearch`). [결정 55] | — | 13 §1.3·§3.2.4, [판정 J-190 (1)] | 서버 측 `web_search`는 MVP에서 쓰지 않는다. 질의는 제공자에게 전송된다(13 §3.2.4) |
| 브라우저 도구 | `browser_*` | 브라우저를 조작하는 도구 묶음. browserd(Node + playwright-core)가 실행한다. MVP 후반에 읽기 멤버를 먼저 두고, 클릭·입력과 요청 가로채기를 다음에 둔다. [결정 55] | — | 13 §3.2.5, [판정 J-190 (1)] | Stagehand는 모델 어댑터를 거칠 수 있을 때만 선택 확장이고 oh-my-pi는 의존성으로 쓰지 않는다(J-190). 멤버 이름은 제공자 툴셋 `browser_toolset_*`을 따르며 [검색] 수준이다 |
| 컴퓨터 사용 | `computer_*` | 화면을 보고 마우스·키보드를 조작하는 도구. 실행마다 새 Xvfb를 샌드박스 안에 띄우고 세션 시작 때 한 번 승인한다. 외부 효과는 `uncertain`이다. 이후 1차 단계이고 MVP에는 없다. [결정 55] | — | 13 §3.2.6, [판정 J-190 (1)] | Windows 호스트 조작은 하지 않는다(J-190) |
| 해시라인 편집 | `RunSpec.editMode`(`replace`·`hashline`, 기본 `replace`), 해시라인 태그(4자리 16진) | `edit` 도구의 모델별 입력 방식. 해시라인 모드는 파일 내용에서 만든 짧은 태그를 모델에게 보이는 별칭으로 쓰고, 실제 guard는 sha256이다. 낡은 태그를 자동으로 고치지 않는다. [결정 55] | — | 13 §1.3·§3.3.7, [판정 J-190 (1)] | 해시라인 태그는 guard가 아니다. 포크 파일을 고치지 않고 도구 레이어가 직접 구현한다(13 §3.3.7) |
| 신뢰 불가 표식 | — | 웹·브라우저 출력을 투영에서 신뢰 불가 표식으로 감싼다. 스크린샷은 최근 3장만 모델 문맥에 남긴다 | — | 13 §3.1, §3.2.4~§3.2.6, [판정 J-190 (4)] | — |
| 제안 도구 | `helm_<명령 이름>`, primitive 없음 | 모델이 10 명령을 모델 채널로 내는 도구. 도구 호출 기록과 명령을 한 트랜잭션에 남기고 관찰은 만들지 않는다 | — | 13 §3.7, J-43 | 모델용 도구에 사람 권한 명령(결과 확인, 합의 확정, 답, 이의 등)은 없다 |
| 선언 도구 | `helm_declare_transition`, `helm_declare_split`, `helm_entry_signals`, `helm_declare_stabilized` | 커널 명령 없이 값만 선언하고 run을 넘기는 도구 | — | 13 §3.7.1, 14 §3.5.6, J-65 | 07은 "선언 도구"를 "투영에서 모델에게 선언한 도구"라는 뜻으로도 쓴다(§4 N-38) |
| 조회 도구 | `helm_query` | Helm 기록을 조회하는 읽기 도구. 결과는 도구 결과 관찰이 된다 | — | 13 §3.7.6 | — |
| 도구 묶음 | loadout | 한 run에서 모델에게 선언하는 도구 집합. run 안에서는 바꾸지 않는다 | — | 13 §1.3, 12 §3.5 | — |
| 자원 URI / 자원 패턴 | `ResourceUri`(`file:`, `net:`, `mcp:`, `blob:`, `helm_draft:`), `ResourcePattern` | 도구 대상과 범위 검사 대상을 적는 문자열과 그 패턴 | — | 13 §3.4.1, 08 §3.18.2 | — |
| 공개 인터넷 범위 | `net:public` | 공개 인터넷 전체를 가리키는 자원 값. 루프백·사설·링크 로컬·CGNAT·tailnet은 뺀다. 외부 탐색은 막지 않는다. [결정 55] | — | 13 §1.3·§3.4.1, [판정 J-190 (2)] | 내부망으로 들어가는 요청만 막는다. 차단 방식은 J-134 |
| 웹 내용 표식 | `taint.web` | 웹 내용(`web_fetch`·`web_search`·브라우저 결과)을 한 번이라도 본 run에 다는 표식. 이후 `send`는 언제나 사람에게 묻는다 | — | 13 §1.3·§3.10.1, [판정 J-190 (3)] | J-91과 같은 방향이다 |
| 쓰기 범위 검사 | `effectiveScope`, `writableRoots`, `observedChanges` | 합의 범위 밖 쓰기를 막는 방법 묶음: 파일 도구는 데몬의 경로·범위 검사, bash는 마운트 격리, 실행 전후 변경 감지로 보완 | — | 13 §3.5 | bash 우회(W-1) 대응이다 |
| 보호 경로 | protected paths, `security.protectedPaths` | 도구가 읽거나 쓰지 못하는 경로(데몬 데이터, 비밀, 소켓 등). 늘릴 수 있고 줄일 수 없다 | — | 18 §3.11.5, 13 §3.4.3, J-45 | 거부는 `policy.forbidden_resource` |
| 샌드박스 수준 | `S0`, `S1b`, `S1`, `S2` | 도구 실행 격리 수준. S1 bubblewrap(기본), S1b `systemd-run --user`, S0 격리 없음(운영자 설정 때만), S2 오버레이 스테이징(이후) | 격리 없음 경고 | 13 §1.3, §3.6, 18 §3.11.2 | S1a는 없다. 루프백 바인딩은 격리 경계가 아니다(결정 46) |
| 보장 수준 | `enforced`, `detected`, `advisory`, `unavailable` | 성질별로 실행 전 차단, 실행 뒤 감지, 지시문뿐, 불가 | 권고(강제되지 않음) | 13 §1.3, §3.11.5, 06 §3.13.4 | 도구 호출 단위의 집행 시점 `pre`·`post_hoc`·`advisory`(08 `enforcement`)와 값 이름이 다르다(§4 N-37) |
| 권한 레이어 호출 | `PermissionLayer.classify`, `ActionDescriptor`, `PermissionVerdict{decision: allow·deny·ask}` | 도구 행동을 판정하는 순수 함수와 그 입출력. 규칙은 18이 정한다 | — | 13 §3.10, 18 §3.11.6 | §3.1 "권한 레이어" |
| 런타임 어댑터 | `RuntimeAdapter`, `CapabilityManifest`, `NeutralEventSink` | 자체·외부 런타임을 Helm에 연결하는 계약과 능력 선언, 중립 신호 수신 | — | 13 §3.11, 06 §3.13, 결정 34 | 중립 신호 `kind`(밑줄 표기)는 09 이벤트가 아니다. 06에는 점 표기 옛 이름이 남아 있다(§4 N-35) |
| 런타임 저장 포트 | `RuntimeStorePort` | 런타임이 정본을 읽는 길(조회, 커널 스냅숏, trace, blob, 커서, 운영 테이블 upsert). 타입은 domain, 구현은 engine이 맡아 주입한다 | — | J-127, 06 | runtime → store import는 금지다 |
| 런타임 능력 등급 | Level A Bridge, B Observe, C Directed, D Native (`deriveLevel`) | 어댑터 능력 목록에서 계산하는 등급. 저장하지 않는다. 성질(G1~G8)별 보장 수준과 함께 쓴다 | — | 13 §3.11.3, ADR-13-04 | 자체 런타임은 Level D다. 성숙도 L1~L5(14)와 다르다 |
| 어댑터 적합성 시험 | AC-01~AC-14, `runAdapterConformance` | 모든 어댑터가 같은 대본으로 통과해야 하는 시험 | — | 13 §3.11.7 | 02의 유즈케이스 수용 기준 AC-<UC>-<nn>과 모양이 겹친다 |
| REPL 도구 | `helm_repl`, `ReplPort` | pi-codemode 샌드박스에서 스크립트로 하위 호출을 지휘하는 도구 | — | 13 §3.8.3, 15 §3.12, J-98 | §3.6 "REPL 방식 탐구" |
| MCP 도구 | `mcp:<server>/<tool>`, `McpServerConfig` | MCP 서버가 내는 도구. stdio 서버는 샌드박스 단위로 띄운다 | — | 13 §3.9 | — |
| 공통 개인 하네스 | `agent-kit`(구상 이름, 별도 도구) | 스킬, AGENTS.md, 훅 정책을 여러 런타임에 같이 쓰도록 동기화하는 개인 자산. Helm 범위 밖이다. Helm은 그 자산을 바꾸는 제안까지만 만든다. [결정 54] | — | 01 NS-08·OQ-16 (a), 18 §1.3 | 관찰 에이전트가 내는 정책 제안(`PolicyProposal`, 16 §3.15)은 범위 안이다. 동기화만 범위 밖이다 |
| vendor 포크 / 고정 의존 / 참고 | vendor fork, pinned dependency, reference | pi 소스를 `vendor/`로 복사해 소유하는 방식 / 정확한 버전으로 묶는 의존 / 코드 없이 설계만 참고 | — | 07 §1.3 | 기준 태그는 `v1.1.0`(결정 44) |

### 3.8 저장·이벤트·커널

| 용어 | 식별자 | 뜻 | 화면 | 정의 문서 | 혼동 주의 |
|---|---|---|---|---|---|
| 이벤트 로그 | event log, `events` | 정본. 커널이 기록한 불변 전이 기록의 순서열(SQLite, WAL, 해시 체인) | 변화 기록(`SCR-RECORD`, 감사 깊이) | 브리프 결정 29, 09 §3.1 | 내용의 진실을 보장하지 않는다(불변조건 1) |
| 영속 이벤트 | event, `EventEnvelope`, `ev` | seq를 받아 기록된 이벤트. 재전송 대상이다 | — | 09 §3.2, 19 §1.4 | 휘발 이벤트와 다르다 |
| 이벤트 envelope | `v`, `seq`, `id`, `type`, `typeVersion`, `category`, `plane`, `occurredAt`, `recordedAt`, `actor`, `via`, `authority`, `subject`, `refs`, `scope`, `commandId`, `causationId`, `correlationId`, `bootEpoch`, `provenance`, `redactions`, `payload` | 이벤트 하나의 공통 틀 | — | 09 §3.2 | 클라이언트로 나가는 형태는 `DeliveredEvent`(해시 대신 무효화 태그) |
| seq | `seq`, `Seq` | 전역 단조 증가, 빈칸 없는 이벤트 번호. 순서는 seq로만 판단한다 | 개발자 보기에서만 숫자. 기본은 상대 시간 | 09 D09-2, 08 §3.2.1 | ID의 시각 부분으로 순서를 판단하지 않는다 |
| 이벤트 범주 | `EventCategory`: `domain`, `governance`, `runtime`, `kernel`, `system`, `measurement` | 이벤트의 종류 묶음. `measurement`는 도메인 상태를 바꾸지 않는 실험 측정(16) | — | 09 §3.2 | 평면(`plane`)과 다르다. `system` 범주는 `plane`이 null |
| 효력 시각 / 기록 시각 | `occurredAt` / `recordedAt` | 일이 일어난 시각과 데몬이 기록한 시각 | 표시는 사용자 시간대 | 09 §3.2, 08 §3.3.1 | 저장은 epoch ms, 프로토콜은 ISO 8601 UTC(브리프 §3.3) |
| 권한 근거 | `authority`, `AuthorityBasis` `<kind>:<ref>` | 상태 변경 이벤트가 기대는 근거(능력, 사람, 질문, 합의, Grant, 정책, 규칙, 타이머, 부팅, 마이그레이션, 복구) | — | 09 §3.2, J-27 | 10의 구조화 `authorityBasis`는 이 문자열로 저장한다 |
| 이벤트 이름 규칙 | `<대상>.<과거형 동사>` | 소문자 snake_case, 점 하나. 금지 접두사 `projection.`, `ui.`, `notification.`, 평면 접두사, 벤더 이름 | — | 09 §3.3 | 명령은 명령형이다(`agreement.confirm` → `agreement.confirmed`) |
| 이벤트 카탈로그 | `EVENT_META` | 이벤트 이름·범주·행위자·subject·상태 효과·payload의 정본 목록(개수 표기는 §4 N-49) | — | 09 §3.4(정본, 판정 §1) | 1판 이름 대응은 08 §10.3, 10 §3.4.6, 12 §3.16 |
| 휘발 이벤트 | `VolatileEvent`: `run.text_delta`, `run.thinking_delta`, `run.toolcall_args_delta`, `toolcall.output_delta`, `run.step_progress`, `store.head`, `device.heartbeat` | 화면 갱신용 흐름. 저장하지 않고 seq를 받지 않는다 | — | 09 §3.5, 19 §3.6.4 | 19는 "휘발 스트림"이라 부른다. 같은 대상이다 |
| 실행 기록 | trace, `TraceKind` | 해시 체인·State 밖의 실행 기록 테이블. 모델 요청, 컨텍스트 압축, 입력 큐, run stage, 탐구 단계, 작업 요청, 주의 상태 | 개발자 보기 | 09 D09-11, §3.7 TraceKind | 이벤트가 아니다. 목록에 없는 kind는 쓰지 않는다. 16의 "트레이스"(외부 로그를 공통 스키마로 바꾼 기록, 16 §1.5)와 다르다 |
| 투영 테이블 | `p_*`, read model | 이벤트를 접어 만든 테이블. 이벤트를 쓰는 같은 트랜잭션에서 갱신한다 | — | 09 §3.11, D09-5 | 언제든 `events`에서 다시 만들 수 있다 |
| 주의 항목 | `p_attention` | 복귀 요약·홈에 올릴 열린 이의, 낡음, 없어야 할 공백 등 | — | 09 §3.11.4 | — |
| 운영 상태 | operational state | 이벤트에서 재구성할 필요가 없는 값(기기 마지막 접속, 소비자 커서, 외부 로그 오프셋, 도구 출력 임시 버퍼, 푸시 토큰 원문) | — | 09 §3.1, J-71, J-77 | `source_cursors`는 관찰 캐시에 둔다(J-77) |
| blob | `blobs`, `BlobRef` | 큰 내용. 내용 해시로 가리킨다 | — | 09 §3.12 | — |
| 해시 체인 | `prevHash`, `hash` | `SHA-256(prevHash + "\n" + canonicalJson(envelope))`로 이은 사슬 | — | 09 §3.2.2, §3.10 | — |
| HMAC 체크포인트 | `HELM_LEDGER_HMAC_KEY` | 체인 끝을 비밀 키로 서명해 두는 점검 지점 | — | 09 §3.10.3, J-69 | 필수 비밀이다(J-69) |
| 정규화 JSON | `canonicalJson` (RFC 8785) | 해시와 멱등 지문 계산에 쓰는 정규화 직렬화 | — | 09 §3.2.1 | — |
| 부팅 epoch | `bootEpoch`, `ownerEpoch` | 데몬 부팅마다 새로 정하는 ULID. 다른 epoch에서 온 쓰기를 막는 펜싱에 쓴다 | — | 09 D09-10, §3.8, 08 §3.18.1 | `path.stale_epoch`(접수), `path.fenced`(쓰기 트랜잭션) |
| 단일 쓰기 보장 | `data/helmd.lock`, `BEGIN EXCLUSIVE`, `acquireInstanceLock`(`@helm/store/admin`) | 데몬 하나만 쓰도록 잠금 파일과 배타 트랜잭션을 쓴다 | — | 09 §3.8.1, 17 §3.1.4, 판정 §2, J-101 | 1판의 소켓 bind 잠금은 쓰지 않는다 |
| 쓰기 트랜잭션 | `store.transaction(fn)`, `commitBatch` | store가 제공하는 동기 대화형 쓰기 트랜잭션. 같은 트랜잭션 안의 명령마다 KernelState를 덧씌운 사본으로 갱신하고, 롤백하면 버린다. `commitBatch`는 그 위의 편의 함수다 | — | J-148, 09 §3.16 | 투영 갱신이 실패하면 롤백한다(J-129, 09 D09-5) |
| 명령 | command, `CommandEnvelope`, `cm` | 행위자가 상태를 바꾸려는 의도. 아직 일어난 일이 아니다. 결과와 함께 `commands`에 저장한다 | — | 09 §3.1, §3.9, 10 §3.3 | 1판 `Submission`(`sb_`)은 쓰지 않는다 |
| 명령 채널 | `H` human_client, `M` model_tool, `X` aux_agent, `R` runtime, `S` scheduler, `A` adapter | 명령이 들어오는 경로. 채널과 행위자 조합이 맞아야 한다 | — | 10 §3.3.2, §3.11 | 위반은 `denied.channel` |
| 멱등 키 | `idempotencyKey`, `ik` | 사용자 의도 하나에 붙이는 키. 다시 보내도 한 번만 적용된다 | — | 09 §3.9, 19 §3.9 | 같은 키에 다른 내용이면 `conflict.idempotency_key_reuse`(19 3006) |
| 기준 seq / 대상 revisionSeq | `basisSeq` / `revisionSeq` | 사람이 결정을 내릴 때 본 화면의 seq와 대상 레코드의 마지막 의미 있는 변경 seq. 대상이 더 뒤면 낡은 화면에서 내린 결정으로 거부한다 | 화면을 연 뒤 상황이 바뀌어 … | 10 §3.3.4, 19 §3.9.3, J-79 | 거부 `conflict.version_mismatch`(19 3004 `command.revisionConflict`) |
| 커널 | `@helm/kernel`, `decide`, `react`, `apply` | I/O 없는 순수 함수 묶음. 제출을 검증해 이벤트 초안을 내고, 파생 규칙을 적용하고, 상태를 접는다 | — | 10 §3.1 | 1판 `KernelEffect`·`evolve`는 `Directive`·`apply`(10 §3.4.6) |
| 결정 결과 | `accepted`, `rejected`, `needs_gate`, `conflict`, `error` | 커널 판정의 다섯 결과 | — | 10 §3.1.4, §3.4.5 | 19 응답 `status: applied`·`gated`와 대응(19 §3.3.4) |
| 거부 세 갈래 | `RejectionClass`: `content`, `authority`, `path` | 내용(누가 보냈어도 거부), 자격(다른 행위자였다면 통과), 경로(정해진 길을 거치지 않음) | 오류 문구 `err.intent.rejected.*` | 08 §3.23, 10 §3.4.1(정본, 판정 §1) | 쓰지 않음: `qualification`, `eligibility`. 범위 밖 쓰기는 자격(`gate.scope_expansion_required`), 금지 자원은 내용(`policy.forbidden_resource`) |
| 강등 | `downgraded.*` | 거부하지 않고 낮춰서 받아들인 것(근거 없는 `met` → `unverified`, 관찰 없는 해석 → 전제) | — | 10 §3.4.4 | 거부와 다르다 |
| 알림(커널) | `notice.*` | 받아들이면서 붙이는 알림(질문 병합, 타이머 무효, 사전 차단 없이 받음, 텍스트 자름) | — | 10 §3.4.4 | 화면 문구 키 범주 `notice.*`(05)와 이름이 겹친다 |
| 파생 규칙 | `react`, R-1… | 커밋된 이벤트에서 같은 트랜잭션의 파생 이벤트를 만드는 규칙(낡음 전파 등) | — | 10 §3.13 | 08 쓰기 시점 제약 R-01~R-53과 번호 체계가 다르다 |
| 검증 규칙 | V-PATH, V-CH, V-FORM, V-VER, V-CAP, V-STA, V-AUT-01 … | 커널이 명령마다 적용하는 규칙 ID | — | 10 §3.7 | 11의 V-Q-01 등도 같은 체계다 |
| 쓰기 시점 참조 제약 | R-01~R-53 | 관계가 가리키는 대상이 존재하고 상태가 맞는지를 쓰기 시점에 검사하는 표 | — | 08 §3.20.2, 10 §3.10 | 01의 R-OP-1·2(사람 조작 규칙)와 다르다 |
| 커널 사후 검사 | V-INV | 커밋 뒤 불변조건을 다시 확인하는 검사 | — | 10 §3.16.3 | — |
| 읽기 전용 모드 | `read_only`, `readOnlyReasons` | 부팅 무결성 실패, 디스크 부족, 운영자 지정, 반복되는 투영 갱신 실패(`projection_fault`)로 조회만 되는 데몬 모드. 부팅 무결성 실패로 들어갈 때는 이벤트를 남기지 않는다 | 읽기 전용(사유별 문장) | 09 §3.10.5, 17, J-67, J-115, J-129 | 안전 모드(`safe_mode`, 크래시 루프 전용)와 다르다. 화면 이름은 "읽기 전용"이다. 쓰지 않음: "복구 모드", `recovery_mode`(§4 N-28) |
| 업캐스터 | upcaster, `typeVersion` | payload 버전이 바뀐 이벤트를 읽을 때 새 모양으로 바꾸는 함수. 이벤트 이름은 바꾸지 않는다 | — | 09 §3.3, §3.13.3 | — |
| 무효화 태그 | `invalidates`, `dependsOn` | 뷰가 기대는 대상(레코드 ID나 `@inbox` 같은 집계 이름). 이벤트와 겹치면 뷰가 낡은 것이다 | — | 19 §1.4, §3.6.3 | — |
| 저장소 ID | `storeId` | 이벤트 저장소의 정체. 새로 만들거나 백업에서 복원해 seq 연속성이 끊기면 바뀐다 | — | 19 §1.4, 20 §1.4 | — |
| 관찰 캐시 | `observer.db` | 관찰 에이전트의 비정본 저장소(트레이스, 후보, 외부 로그 커서) | — | 16 §3.20, J-77 | 지워져도 정본은 그대로다. 기각 기억은 정본 이벤트에서 읽는다(16 OB-5) |

### 3.9 데몬·보안·프로토콜

| 용어 | 식별자 | 뜻 | 화면 | 정의 문서 | 혼동 주의 |
|---|---|---|---|---|---|
| 데몬 | `helmd`, `@helm/daemon`, `helmd.service` | WSL2 서버에 상주하는 Helm 본체. Node 프로세스 하나이고 정본 DB의 유일한 writer다 | 서버(연결 문구), 데몬(설정·개발자 보기) | 17 §1.4, §3.1, 결정 20·22 | 화면에서는 "서버" 또는 "Helm 서버"로 쓴다(05 §3.11) |
| 패키지와 레이어 | `@helm/*`, L0~L6, L3', L6c | 패키지 목록·책임·의존 방향. 정본은 06이다 | — | 06 §3.2~§3.4, 판정 §2 | 21의 부품 층 L0~L2와 이름이 겹친다 |
| 클라이언트 코어 | `@helm/client`, `HelmClient` | 전송 독립 클라이언트 코어. 연결, 재전송, 구독, 진행 중 명령을 맡고 `@helm/protocol`에만 의존한다. 데스크톱·모바일·TUI가 함께 쓴다 | — | 판정 §2, 19 §3.14, 06 §3.4.13 | 쓰지 않음: 클라이언트 SDK |
| 문구 패키지 | `@helm/ui-language` | 문구 키, 한국어 문구, 상태 라벨, 조사 처리, 오류 코드 → 문구 키, 금지 표현 검사. I/O 없음 | — | 05 §3.10.8, 06 §3.4.16, J-31, J-103 | 앱 안 `copy/`에 문구를 두지 않는다(J-103). 20 §3.9.11에 `src/copy/`가 남아 있다(§4 N-33) |
| 내부 운영 모드 | `OpsMode`: `starting`, `recovering`, `ready`, `safe_mode`, `read_only`, `draining`(+`stopped`) | 데몬 수명주기 상태 | — | 17 §3.4.1, §3.11.1 | 클라이언트에 보이는 값은 19 `DaemonMode` |
| 데몬 모드(프로토콜) | `DaemonMode`: `normal`, `safeMode`, `readOnly`, `draining` | 클라이언트에 알리는 데몬 상태 | 연결됨 / 안전 모드 · 작업 멈춤 / 읽기 전용 / 서버가 곧 다시 시작됩니다 | 19 §3.4.4, 17 §3.4.1, J-115 | `readOnly`의 화면 이름은 "읽기 전용"이다. 화면 문서의 "복구 모드"(`recovery_mode`, `err.daemon.recoveryMode`)는 J-115로 바뀐다(§4 N-28) |
| 안전 모드 | `safe_mode`, `daemon.safe_mode_entered`·`exited`, `runtime.exit_safe_mode` | 크래시 루프(10분 안 비정상 부팅 3회)를 감지하면 자동 재개·에이전트 타이머·관찰 에이전트·새 실행 허가를 멈추고 사람 확인을 기다리는 모드. 질문 답과 조회는 된다 | 안전 모드 | 17 §1.4, §3.4.6, 12 §3.7.6 | 읽기 전용 모드와 다르다(J-67) |
| 읽기 전용 모드(운영) | `read_only`, 사유 `integrity_suspect`, `disk_critical`, `operator`, `projection_fault` | 상태를 바꾸는 명령을 거절하고 조회·구독만 받는 모드 | 읽기 전용(사유별 문장) | 17 §3.4.1, 09 §3.10.5, J-67, J-129 | §3.8 같은 이름 행 참고. 부팅 무결성 실패는 이벤트 없이 이 모드로 시작한다 |
| 드레이닝 | `draining`, `server.shutdown` | 종료·재시작 준비 중. 새 연결을 받지 않고 진행 중 요청을 마친다 | 서버가 곧 다시 시작됩니다 | 17 §3.4.3, 19 | 오류로 보이지 않는다(05 `notice.daemon.draining`) |
| 부팅 기록 | `daemon.booted{bootEpoch, previousEpoch, previousCleanShutdown, mode}` | 부팅마다 남기는 시스템 이벤트 | 서버가 {time}에 다시 시작되었습니다 | 09 §3.4.13 | 17·12는 `epoch`·`prevEpoch`·`prevClean`, `daemon.started`, `bootId`를 쓴다(§4 N-16) |
| 릴리스 | release, `/srv/volumes/helm/app/releases/<id>/` | 한 git 커밋에서 빌드한 데몬·CLI 묶음 | — | 17 §1.4 | — |
| 설정 파일 | `helmd.toml`, `helmd.local.toml` | 데몬 설정(TOML). 로컬 오버라이드는 `.local` | — | 06 ADR-06-11, 판정 §2 | — |
| 데이터 위치 | `/srv/volumes/helm/data/helm.sqlite`, `data/helmd.lock` | 정본 DB와 단일 인스턴스 잠금 | — | 판정 §2, 17 §3.2, 09 §3.6 | `~/projects` 아래에 두지 않는다(브리프 §2.5) |
| 관리 CLI | `helm`, `helm ops …`, `helm doctor`, `helm pair`, `helm export` | 서버에서 쓰는 관리 명령 | — | 17 §3.15, 06 §3.16, J-68 | `helm ops verify`, `helm export`(J-68) |
| 상태 확인 | `GET /healthz` → `ok`·`degraded`·`critical`·`starting`·`draining`, `daemon.status` | 인증 없는 생존 확인과 인증된 상세 상태 | 서버 상태 | 17 §3.11, 19 §3.7.8 | `/healthz` 형식은 17 소유(판정 §2) |
| 리스너 | `ListenerKind`: `tailnet`(127.0.0.1:7840, serve 외부 8448), `loopback`(127.0.0.1:7841, `ssh -W`), `local`(Unix 소켓 `/run/user/1000/helm/rpc.sock`) | 데몬이 연결을 받는 세 입구 | 연결 방식: Tailscale / SSH | 판정 §2, 17 §3.5, 18 §3.4, 19 §3.2.1 | 쓰지 않음: `tailscale`·`ssh`(리스너 값으로), 포트 7801. 08 Via와 26은 `tailscale`·`ssh`를 쓴다(§4 N-01). 루프백은 격리 경계가 아니다(결정 46) |
| 경로 | route, `wss`·`ssh` | 앱이 한 서버로 연결하는 방법 하나 | — | 20 §1.4, 19 §3.2.2~§3.2.3 | 리스너와 다른 층이다(경로 `ssh` → 리스너 `loopback`) |
| 주체 | `Principal`: `device`, `localAdmin`, `runtime`, (`observer`) | 연결·제출이 인증된 주체 | — | 18 §3.5 | 행위자(`ActorRef`)와 다른 층이다. 기록 출처는 `via`(`local_cli` 등). `local` 리스너의 사람 결정은 TUI나 TTY CLI에서 확인 문자열을 넣은 경우만 받고, 비대화 localAdmin은 읽기와 관리만 한다(J-135) |
| 연결 범위 | `scope`: `read`, `decide`, `devices`, `devicesLimited`, `admin` | 연결이 부를 수 있는 메서드 범위 | — | 19 §3.4.6, 18 §3.5 | 맡긴 범위·이벤트 `scope`와 다르다 |
| 기기 토큰 | `helm_dt_` + base64url(32바이트) | 페어링 때 발급하는 기기별 bearer 토큰. 서버는 해시만, 앱은 OS 키체인에 원문을 둔다. 절대 365일, 유휴 90일 | — | 18 §3.8, D18-01 | 원격 인증의 필수 요소. Tailscale 신원 헤더·whois는 추가 조건일 뿐이다 |
| 페어링 | pairing, 흐름 A(코드, `POST /pair`), 흐름 B(SSH 발급, `helm pair`·`admin.issueDevice`) | 새 기기를 등록하고 기기 토큰을 발급하는 절차 | 페어링 | 18 §3.7 | 실패 사유를 화면에서 구분하지 않는다(J-81, 1009) |
| 노드 묶기 | node binding, `tailnetNodeId` | 기기 토큰을 페어링 때 본 tailnet 노드에 묶는 규칙 | — | 18 §3.6.1, D18-02 | — |
| 업그레이드 전 검사 | `preflight` | TCP 리스너가 WebSocket 업그레이드 전에 Host·Origin·신원 헤더·Bearer 형식·연결 수를 보는 검사 | — | 18 §3.4.3 | — |
| 신뢰 경계 | 경계 A(같은 uid), B(기기 토큰), C(도구 샌드박스) | 18의 신뢰 경계 셋. Helm은 경계 A를 지키지 않고 C를 직접 만든다 | — | 18 §3.3 | — |
| 정본 HMAC 키 | `HELM_LEDGER_HMAC_KEY` | 해시 체인 체크포인트를 서명하는 필수 비밀 | — | 18 §3.10.5, 09 §3.10.3, J-69 | — |
| 도구 환경 허용 목록 | R-2 | 도구 프로세스에 넘기는 환경 변수 목록. `HELM_RUN_ID`처럼 비밀 아닌 것만 | — | 18 §3.11.1, J-17 | 그 밖의 `HELM_*`는 넘기지 않는다 |
| 마스킹기 | `Redactor`, 민감 필드 `sensitiveFields`, envelope `redactions` | 비밀을 텍스트·객체에서 지우는 공통 함수와, 저장본에는 두고 사본에서 지우는 필드 | — | 18 §3.10.4, 09 §3.2 | 16의 관찰 입력 마스킹과 규칙을 공유한다 |
| 감사 기록 | 정본 이벤트(`auth.*`, `device.*`, `tools.*`, `auth.policy_relaxed`) | 보안 감사는 별도 파일 없이 정본 이벤트로 남긴다 | — | 18 §3.13, D18-10 | — |
| 18 ID | `AS-*`(자산), `T-*`(공격 경로, 분류 N·H·L·P·M·S·B·R·W), `R-1`~`R-12`(격리 요구), `D18-nn`, `S-nn` | 18의 자산·위협·요구·결정·실패 사례 번호 | — | 18 §3.1~§3.2, §3.11.1 | 16 가정 AS-1~AS-5, 26 가정 AS-M1~와 모양이 겹친다 |
| 전송 | JSON-RPC 2.0 over WebSocket | 클라이언트-데몬 프로토콜. 큰 데이터는 HTTP | — | 결정 31, 19 §3.2~§3.3 | — |
| 핸드셰이크 | `hello`, `hello.challenge`, `HelloResult` | 연결 뒤 첫 교환. 서버 챌린지 → 클라이언트 hello → 인증·버전·기능 협상 | — | 19 §3.4 | — |
| 위치 | position `{storeId, seq}` | 이벤트 구독이 빠짐없이 보냈다고 보장하는 seq. 결정 31의 `lastSeq` | — | 19 §1.4, 20 §1.4 | — |
| 재전송 / 스냅샷 경로 | replay, `replay.outOfRange`(2001) | 재접속 때 위치 다음부터 영속 이벤트를 다시 보내는 것과, 그럴 수 없을 때 뷰를 새로 받는 경로 | 접속하지 않은 동안의 이전 기록 일부는 생략했습니다 | 19 §3.5 | — |
| 뷰 | view, `view.get`, `ViewResult{data, asOfSeq, dependsOn, freshness}` | 데몬이 정본을 읽어 만든 화면 투영. 무효화 태그로 낡음을 안다 | — | 19 §1.4, §3.6.3, §3.7.4 | §3.1 "투영" |
| 뷰 신선도 | 서버 `freshness`: `current`, `stale`, `rebuilding`, `failed` / 앱 `ClientFreshness`: `current`, `refreshing`, `stale`, `missing`, `failed` | 데몬이 붙이는 신선도와 앱이 연결 상태·캐시로 계산하는 신선도 | 이 화면은 {time} 기준입니다 | 19 §3.6.3, 20 §3.9.8 | `refreshing` 중에는 결정을 막지 않는다(J-59) |
| 휘발 스트림 | `stream.subscribe`, `stream.chunk`(`StreamPart`) | 로그에 남지 않는 실시간 조각(토큰 텍스트, 도구 출력, 진행 표시) | — | 19 §1.4, §3.6.4 | 09의 "휘발 이벤트"와 같은 대상. 스트림 끝 이유는 12 `RunEndReason`과 다르다(§4 N-11) |
| presence 보고 | `presence.report{state, screen, objectId, depth}` | 클라이언트가 활동 상태와 보는 화면을 데몬에 알리는 알림. 데몬은 상태가 바뀔 때만 `presence.changed`를 남긴다 | — | 19 §3.7.8, J-46, J-84 | 감사 깊이 열람은 `depth` 필드로 알린다(`#audit` 접미 쓰지 않음, J-84). 보고 값은 `active`·`idle`·`hidden`이고 `locked`는 보내지 않는다(J-118, J-119) |
| 클라이언트 연결 상태 | `HelmClient.state`: `idle`, `connecting`, `handshaking`, `syncing`, `ready`, `backoff`, `needsUser`, `closed` | 19 클라이언트 연결 상태 기계 | 연결 상태 표시(§3.10 `ConnectionUiState`) | 19 §3.10.2 | — |
| 전송 실패 | `TransportFailure`: `network`, `httpStatus`, `daemonUnreachable`, `blocked`, `other` | 전송 계층 실패의 종류. `blocked`는 사람이 고쳐야 풀리는 실패로 자동 재시도를 멈춘다 | — | 19 §3.14, J-62 | — |
| 다운로드 티켓 | ticket | 헤더를 붙일 수 없는 HTTP 다운로드 URL에 넣는 짧은 수명의 무작위 값. 기기 토큰과 별개 | — | 19 §1.4, §3.11 | — |
| 모바일 클라이언트 | `@helm/mobile`, PWA(`/m/`), Web Push(VAPID), `__Host-helm_dt` 쿠키 | 휴대폰에서 질문에 답하는 2단계 클라이언트. 데몬이 서빙하는 홈 화면 웹 앱과 데몬이 직접 보내는 Web Push. 알림은 강도 `interrupt`·`notice` 질문까지, 최소 판은 iOS 26 | 화면 `SCR-M-*` | [결정 47], [결정 48], [결정 49], 26, J-118 | 결정 19("웹이 아니다")는 데스크톱에 적용한다. 푸시 등록 원문은 운영 테이블에, 이벤트에는 해시만(J-71) |
| 푸시 | Web Push, VAPID(RFC 8292) | 데몬이 Apple 푸시 서비스로 직접 보내는 알림(RFC 8030·8291). 강도 `interrupt`·`notice` 전달에만 보낸다. 어떤 기기든 `active`면 보내지 않는다. 문구는 키와 인자로 싣는다. [결정 47], [결정 48] | — | 26 §2.4(MOB-D02·D05·D07) | 사용자 화면은 "알림"을 쓴다(05 §3.7). 이 말은 설계 본문과 전송 구현에 쓴다 |
| 푸시 등록 | `PushRegistration`(08 Device의 `push`), `push_tokens`(09 운영 테이블), `tokenHint` | 기기가 푸시를 받도록 등록한 정보. 등록 원문은 운영 테이블 `push_tokens`에 두고, 이벤트와 Device에는 해시·끝 자리·호스트·설정만 둔다. 화면 표시는 `tokenHint` 하나다 | — | 26 §3.4.6, 26 §2.4(MOB-D06), [판정 J-71] | 푸시 등록 원문은 운영 상태다(§3.8 `operational state`). 이벤트에 싣지 않는다 |
| 경로 B | 경로 B(Tauri v2 iOS + APNs 직접 송신), 값 `apns`(예약) | 네이티브 iOS 경로. Apple 개발자 프로그램이 지금 없다고 보고 이후에 검토한다. 1차 푸시 채널은 `webpush`만이다. [결정 47], [결정 57] | — | 26 §3.1.5·MOB-D11, 08·09 `provider` 예약 | 지금의 모바일 방식은 데몬이 서빙하는 홈 화면 웹 앱(PWA)과 Web Push다(결정 47). 경로 B는 열어 둔 대안이다 |

### 3.10 앱·UI·모바일

| 용어 | 식별자 | 뜻 | 화면 | 정의 문서 | 혼동 주의 |
|---|---|---|---|---|---|
| 상태 중심 UI | UP-1 | 첫 영역에 대화 대신 Goal·Concern·질문·진행 작업 같은 상태를 두는 UI | — | 결정 10, 03 §3.1, 21 §3.1 | 대화는 객체에 딸린 보조 수단이다 |
| 화면 ID | `SCR-*`, `OVL-*`, `RGN-*`, `SCR-M-*` | 화면, 겹쳐 뜨는 화면, 셸 영역, 모바일 화면의 식별자 | — | 03 §3.6, §3.12(정본, 판정 §1) | 21·20은 화면 키를 `SCR-*`로 쓴다. 26의 `SCR-M-ONBOARD`는 03에 없다(§4 N-31) |
| 홈 | `SCR-HOME` | 지금 주의가 필요한 것과 모든 Goal·Concern의 상태를 한곳에서 보는 화면 | 홈 | 03 §3.6 | 원전 CommonOperatingPicture, product-language "오늘·전체 상황" |
| 복귀 요약 | `SCR-BRIEF`, `brief` 뷰, `brief.acknowledge` | 마지막으로 확인한 지점 이후 달라진 점과 지금 할 일 | 복귀 요약 | 03 §3.6, 12 §3.5.9, 05 §3.10.4 | 쓰지 않음: 브리핑, 요약(단독). 화면을 연 것과 "여기까지 봤음"(acknowledge)을 구분한다 |
| 복귀 확인 지점 | `brief.acknowledged`, `acknowledgedSeq`(확인 cursor) | 사람이 "여기까지 봤음"을 누른 seq. 사람 단위로 하나이고 기기마다 두지 않는다. 화면을 여는 것만으로는 옮기지 않는다. 다음 복귀 요약의 시작점이다 | 여기까지 봤음 | 02 UC-06 AC-06-01, 21 §3.5.8 | 휴대폰 확인은 `compact: true`를 싣고, 줄여 본 반대 근거·이견은 다음 데스크톱 요약에 남는다(J-137) |
| 질문함 | `SCR-INBOX`, `SCR-M-INBOX` | 사람 행동이 필요한 모든 요청을 한곳에서 처리하는 화면 | 질문함 | 03 §3.6, IA-02 | — |
| 에이전트가 정한 것 | `SCR-AUTO` | 묻지 않고 정한 것을 확인하고 이의를 거는 화면 | 에이전트가 정한 것(내비게이션 "정한 것") | 03 §3.6 | §3.5 "혼자 정한 결정" |
| 근거 체인 / 자극 보드 / 루프 이력 / 변화 기록 | `SCR-EVIDENCE` / `SCR-STIM` / `SCR-LOOPS` / `SCR-RECORD` | 근거를 원본까지 따라가는 화면 / 원함 탐구 반응 화면 / 루프 계획·전환·판정 이력 / 원본 이벤트(감사 깊이) | 같은 이름 | 03 §3.6 | 변화 기록 열람은 "원본 기록 내려가기"로 센다(16) |
| 복구 화면 | `SCR-RECOVERY` | 재시작으로 중단된 작업과 결과를 모르는 외부 행동을 처리하는 화면 | 복구 | 03 §3.6, 04 §3.20 | 데몬 읽기 전용 모드와 다르다. "복구"는 이 화면과 복구 선택 질문에만 쓴다(J-115, §4 N-28) |
| 이의 걸기 | `OVL-CONTEST` | 객체 하나에 이의를 거는 겹친 화면 | 이의 걸기 | 03 §3.6, 05 §3.3 | ID의 contest는 레코드 Objection(`ct`)을 가리킨다 |
| 셸 영역 | `RGN-TOPBAR`, `RGN-RAIL`, `RGN-BANNER`, `RGN-STATUSLINE`, `RGN-MAIN`, `RGN-INSPECTOR`, `RGN-COMPOSER`, `RGN-RUNS` | 앱 창의 고정 영역 | 위쪽 상태 막대, 내비게이션, 배너, 상태 줄, 본문, 검사 패널, 입력창, 진행 중 서랍 | 03 §3.4.1 | — |
| 입력창 | `RGN-COMPOSER`, `composer.preview`, `composer.submit` | 현재 범위(전역, Goal, Concern, WorkUnit, 질문)에 귀속되는 자연어 입력. 보내기 전에 의미 미리보기를 보인다 | 입력창(범위 표시: "Concern 12에 말하기") | 03 §3.4.1, 05 §3.5, 12 §3.5.10 | 전역 대화창이 아니다 |
| 세 깊이 | `glance`, `review`, `audit` | 한눈에 / 검토 / 감사 | 한눈에 / 검토 / 감사 | 03 §3.10, 21 §3.5.7 | 질문 깊이(`light`·`normal`·`deep`, "가볍게 확인·일반·깊은 검토", 08 §3.13)와 다르다 |
| 표시 번호 | `displayNo`, `p_display_no` | 레코드 종류별 생성 순서로 매기는 화면 번호 | "질문 14" | 03 §3.2.6, 12 §3.5.8 | — |
| 개발자 보기 | developer view | 원론 용어, 이벤트 이름, 레코드 ID, seq를 보이는 설정 | 개발자 보기 | 03 §3.2.1, §3.10 | — |
| 문구 키 | `<범주>.<대상>.<항목>`, `CopyKey` | 모든 화면 문구를 키로 두는 체계. 데몬은 시스템 문장을 키와 인자로 보내고 앱이 문장을 만든다 | — | 05 §3.10.8, J-31, J-103 | 모델이 쓴 문장은 키 없이 원문과 작성자 표시로 보낸다 |
| 상태 라벨 | `StatusLabel`, 집합 `work`·`concern`·`choice`·`question`·`loop`·`situation` | 정본 상태를 화면 이름으로 옮긴 라벨 | §3.3 | 03 §3.3, 21 §3.5.4 | 같은 라벨 문자열을 두 집합에 쓰지 않는다 |
| 작성자 표시 | `AuthorshipMark`, `ActorLabel` | 사람 작성, 에이전트 작성(역할), 정책 적용, 외부 행위자를 구분하는 표시 | 내가 정함, 작업 에이전트 · … | 03 §3.3.6, 21 §3.5.5 | 품질 배지가 아니다 |
| 초안 표시 | `DraftMark` | 에이전트가 만든 초안 표시. 사람이 고친 칸은 "내가 고침"으로 바뀐다 | 초안 / 내가 고침 | 21 §3.5.5 | — |
| 확실성 표현 | `CertaintyDescriptor` | 숫자 대신 지지 등급·확신 등급과 직접성, 반대 근거 확인, 확인하지 못한 범위, 다음 확인으로 그리는 표현 | — | 21 §3.5.6, J-19 | — |
| 명령 의도 | `UiIntent` | 부품이 올리는 사람 조작. 19 명령 메서드 이름을 그대로 쓴다 | — | 04 §3.0.6, 21 §3.6.3 | 커널 명령 이름과의 대응은 10 §3.11.11 |
| 결정 가능 여부 | `decisionsAllowed`, `DecisionAvailability` | 연결과 신선도로 결정 버튼을 켤지 정하는 값. 연결이 없으면 결정을 막고 초안으로 보존한다 | — | 20 §3.8.9, J-02, J-59 | — |
| 진행 중 명령함 | in-flight outbox, store `pending` | 보냈지만 응답을 받지 못한 명령. 재접속 때 같은 멱등 키로 다시 보낸다 | 보내지 못한 조작 | 20 §1.4, §3.9.5 | 응답 전에 끊긴 명령만 다시 보낸다(J-02) |
| 화면용 연결 상태 | `ConnectionUiState`: `connected`, `slow`, `reconnecting`, `resyncing`, `disconnected`, `daemon_unresponsive`, `auth_failed`, `version_mismatch`, `recovery_mode`(→ J-115에 따라 읽기 전용), `safe_mode` | 화면이 그리는 연결 상태 | 연결됨 / 연결 느림 / 다시 연결하는 중 / 맞추는 중 / 연결 안 됨 / Helm 서버가 응답하지 않음 / 인증 필요 / 버전 맞지 않음 / 읽기 전용 / 안전 모드 | 21 §3.6.2, 20 §3.8.9, 04 §3.0.4, J-60, J-115 | 값 `recovery_mode`의 이름은 21이 J-115에 맞춰 정한다(§4 N-28) |
| 연결 프로필 | `ServerProfile` | 서버 하나와 그 서버의 경로 목록, 기기 ID | 연결 | 20 §1.4, §3.4.1 | 쓰지 않음: 접속 프로필 |
| 클라이언트 저장소 | IndexedDB `helm-desktop`, `IdbClientStateStorage` | 서버별 위치·뷰 캐시·진행 중 명령·초안 저장소 | — | 20 §3.9.5 | 정본이 아니다 |
| OS 알림 | `question.delivered` + `surface`·`urgency` | 데몬의 전달 기록을 실시간으로 받았을 때만 띄우는 OS 알림. 기본은 내용 숨김 | OS 알림(제목 "Helm") | 20 §3.10.1, 05 §3.7, J-03 | 앱이 전달 여부를 정하지 않는다(05 IX-01) |
| 내용 숨김 | `notif.hidden.title`·`notif.hidden.body.count`·`notif.hidden.body.plain`(문구 키), `notifications.showContent`(휴대폰 설정, 기본 꺼짐) | 알림의 기본 내용. 제목은 "Helm"이고, 본문은 개수를 알 때 "확인할 일이 {n}건 있습니다.", 모를 때 "확인할 일이 있습니다."다. 질문 내용은 사용자가 켤 때만 싣는다. 휴대폰 서비스 워커의 대체 문구는 `PUSH_FALLBACK_BODY`다 | — | 05 §3.7.6, 26 §2.4(MOB-D07), [제안, 판정 J-03] | OS 알림 행과 기본값은 같다. 휴대폰에서 내용을 보일지는 기기 설정이 정한다(26 MOB-D07) |
| 결과 확인 알림 설정 | `notifications.resultReview`(`none`·`daily_digest`·`immediate`, 기본 `none`), `notifications.resultReviewDigestAt`(`HH:MM`, 기본 "19:00", 서버 시간대), 타이머 목적 `result_review_digest`(`runtime_timers`) | 결과 확인 대기 결과를 휴대폰 알림으로 어떻게 알릴지 고르는 의미 설정. `none`은 알리지 않고 복귀 요약에서 확인한다. `daily_digest`는 설정 시각에 확인 대기 결과가 하나 이상이면 묶음 푸시 1개(강도 `notice`)를 보낸다. `immediate`는 결과 확인 질문이 전달될 때마다 `notice` 푸시를 보낸다. 방해 금지(J-166)와 시간당 상한(J-171)을 따르고, 휴대폰 확인 범위는 J-139 그대로다. [결정 56] | 결과 확인 알림(알리지 않음 · 하루 한 번 묶음 푸시 · 즉시 푸시) | 05 §3.7.8, 14 §3.13.2·§3.13.6, 12 §3.10.6, 26 §2.4(MOB-D14), [판정 J-189] | 쓰지 않음: 리뷰 알림. 설정 변경은 `settings.update`(19), 기록은 `setting.changed`(09)다 |
| 트레이 | `SCR-TRAY`, `TraySummary` | 메뉴 막대·트레이 메뉴 | 메뉴 막대·트레이 | 03 §3.6, 20 §3.10.2 | — |
| 빠른 입력 | quick capture, `shortcuts.quickCapture` | 앱이 등록하는 유일한 전역 단축키 | 빠른 입력 | 20 §3.10.4 | — |
| 디자인 토큰 | `--hm-*`(원시·의미), `--helm-*`(Helm 의미), `@helm/ui-tokens` | 토큰 층 1~4. Caustic 값을 복사하고 neutral은 11단계로 줄였다 | — | 21 §3.2, 결정 43 | Caustic에 의존하지 않는다 |
| 유리 재질 | `glass-chrome`, `glass-overlay` | 크롬과 오버레이에만 쓰는 반투명 재질. 읽는 글과 목록은 불투명 표면에 둔다 | — | 21 §3.2, UP-14, 결정 41 | 시각 표현이며 문장 규칙의 의인화 금지와 무관하다(결정 41) |
| 에이전트 스펙트럼 | `agent-spectrum-1..3`, `--helm-draft-rim` | 에이전트 초안 테두리와 진행 중 표시에만 쓰는 색 | — | 21 §3.2.2, UP-15 | 장식으로 쓰지 않는다 |
| 세 세계 표시 | `World`: `N`, `E`, `M` | 방향·이해·실제 변화를 테두리 모양·아이콘·라벨로 구분하는 시각 문법 | 방향 / 이해 / 실제 변화 | 21 §3.5.1, 03 §3.9 | 21 표는 결과 제출을 N, 자극을 M으로 둔다(08은 둘 다 E, §4 N-21) |
| 부품 층 | L0 기본 부품, L1 Helm 의미 부품, L2 복합 부품 | 21의 부품 층 | — | 21 §3.7 | 06 패키지 레이어 L0~L6과 이름이 겹친다 |
| 밀도 | `data-density`: `regular`, `compact`, `touch` | 컨트롤·행 크기 묶음. `touch`는 모바일용 | — | 21 §3.2.7 | — |
| 모바일 화면 | `SCR-M-INBOX`, `SCR-M-QUESTION`, `SCR-M-BRIEF`, `SCR-M-AUTO`, `SCR-M-WORK`, `SCR-M-CONNECT`, `SCR-M-SETTINGS` | 답하기 중심의 화면 부분집합(2단계) | 질문함 / 질문 / 요약 / 에이전트가 정한 것 / 진행 중 / 연결 / 설정 | 03 §3.12, 26 | 휴대폰에서 답하지 않는 형식은 "데스크톱에서 답하기"와 미루기만 둔다 |
| TUI | `@helm/tui` | SSH로 WSL에 들어가 쓰는 pi-tui 기반 클라이언트(3단계) | — | 결정 33·39, 03 §3.11 | — |

### 3.11 지표·가설

| 용어 | 식별자 | 뜻 | 화면 | 정의 문서 | 혼동 주의 |
|---|---|---|---|---|---|
| 지표 | metric, `<묶음>.<이름>` | 정본 이벤트에서 코드로 계산하는 결정적 투영. 커널·런타임·다이얼에 자동으로 들어가지 않는다 | 평가(`SCR-METRICS`) | 16 §3.21, OB-7 | 작업 에이전트의 컨텍스트에 넣지 않는다(OB-8) |
| 지표 사실 | metric fact, `metric_fact` | 이벤트 하나에서 결정적으로 뽑은 측정 단위 값 | — | 16 §1.5, §3.22 | 16의 사실 이름(`contest`, `submission` 등)은 지표 계산 안의 이름이다 |
| 검토 신호 | review signal | 지표 임계값을 넘었을 때 보이는 신호. 성공·실패 판정으로 쓰지 않는다 | 검토 신호 | 16 §3.21 원칙 7, OB-12 | 임계값은 모두 [제안]이며 첫 14일 기준선 뒤 고친다 |
| 표본 부족 | `minSample` | 비율 지표의 표본이 모자랄 때 값 대신 보이는 표시 | 표본 부족 | 16 §3.21 원칙 5 | — |
| 복귀 에피소드 | `ReturnEpisode`, `returnAt`, `awayMs` | 4시간 이상 부재 뒤 첫 활동. 24시간 이상이면 장기 복귀(H1 대상) | — | 16 §3.23.1 | — |
| 첫 유효 행동 | first valid action | 복귀 뒤 처음 받아들여진 사람 결정·작성 입력. 보기는 제외 | — | 16 §3.23.1 | — |
| 원본 기록 내려가기 | raw log fallback | 복귀 뒤 첫 유효 행동 전에 감사 깊이를 연 것 | — | 16 §3.23.1 | — |
| 2주 우회율 | CA-1~CA-7 + 16이 더한 셋 | C/A를 건너뛰는 정도를 재는 지표 묶음(합의 우회·취소율, 범위 초과 차단 수, 근거 없이 제출된 기준, 결과 확인까지 시간, 열린 반영 항목, 정상 경로 조작 수, 정상 경로 밖 조작 사유 등) | — | 01 §3.5.3, 16 §3.23.3 | CA-n은 별칭이고 지표 ID 정본은 `ca.*`(16) |
| 복귀 점검 | resumption check, `resumption_check.*`, `resumptionCheck.*` | 복귀 때 상황 인식을 재려고 건너뛸 수 있게 묻는 짧은 점검. 측정 범주. 채점 말은 일치 · 부분 일치 · 불일치다 | 복귀 점검 | 16 §3.27.3, J-10, J-78 | 쓰지 않음: 탐침, SA probe, resumption probe, `probe.answer`(10 §3.11.11 대응표에 남아 있음, §4 N-39). 채점 말 "맞음·부분·틀림"도 쓰지 않는다(05 §3.10.8) |
| 자기보고 | self report, `self_report.recorded` | 경험(부담, 탐색 질문 5개 등)을 사람이 직접 남긴 측정 | — | 16 §3.27.4 | — |
| 놀람 보고 | `surprise.report`, `surprise.reported` | 사람이 "예상 못 했다"고 표시한 측정 | — | 10 §3.11.11, 16 | 관찰 주석 `surprise`와 다르다 |
| 화면 열람 기록 | `view.opened`, `dwellBucket` | 정해진 다섯 화면(복귀 요약, 에이전트가 정한 것, 결과 확인, 질문, 감사 깊이)을 떠날 때 남기는 측정 이벤트 | — | 16 §3.23.1, 10 `view.record` | 프로토콜 `presence.report`에서 데몬이 만든다 |
| ABAB 교대 실험 | — | 1인 N-of-1 실험 설계 | — | 16 §3.27.2, OB-10 | — |
| 채팅 기준선 | `ext.*`, `BaselineTally` | 외부 에이전트 세션 로그로 대신하는 비교 기준선 | — | 16 §3.23.10, OB-10 | — |
| 반증 가설 H1~H10 | H1~H10 | foundations/08 §3의 가설 열 개. 번호 그대로 쓴다 | — | 16 §3.25, 01 §3.10.1, J-09 | "H1~H8"이라고 쓰지 않는다(원문은 열 개) |
| v0.3 가설 V1~V7 | V1~V7 | v0.3 10 §3의 H1~H7. 이름이 겹쳐 V로 부른다 | — | 01 §3.10.1, 16 §3.26.1, J-09 | v0.3 원문의 "H6(Method Transfer)"은 이 묶음의 V6이다 |
| 새 가설 V8·V9 | V8, V9 | V8 C/A를 강제해도 2회 상한 안에서는 우회가 늘지 않는다, V9 초안·반응이 빈칸 채우기보다 낫다 | — | 01 §3.10.2 | — |
| 탐구 엔진 가설 | H-I1~H-I4, H-R1 | 15가 정한 발산·REPL 가설 | — | 15 §3.15.5, 16 §3.26.3 | H·V와 겹치지 않는다 |
| 카드·종합 가설 | `<파일 이름>:<원래 ID>` | 방법 카드·종합 문서의 가설을 파일 이름을 붙여 부르는 형식(예: `situation-awareness:SA-H1`) | — | 16 §3.26.2, OB-9 | 카드 ID가 서로 겹치므로 접두 없이 쓰지 않는다 |
| 성공 기준 | SC-1~SC-6 | 제품 성공 기준 여섯 | — | 01 §3.10.3 | — |
| 진입 범주 지표 | CT-1~CT-3 | 재정의율, 늦은 방향 전환율, 진입 판정 이의율(별칭). 정본 ID `entry.*` | — | 01 §3.6.7, 16 §3.23.6 | — |
| 지표 묶음 접두 | `opdc.o/p/d/c.*`, `ca.*`, `q.*`, `ad.*`, `entry.*`, `inq.*`, `out.*`, `int.*`, `stale.*`, `ctx.*`, `sit.*`, `s.*`, `a12.*`, `draft.*`, `want.*`, `exp.*`, `obs.*`, `proc.*`, `cost.*`, `ext.*`, `rt.*` | 16 지표 ID의 묶음. 형식은 점으로만 잇는 `<묶음>.<이름>`이다 | — | 16 §3.23 | 14 OPD+C 의무 ID와 형식이 다르다(아래 행, §4 N-24). `s.*`는 S 루프 지표다 |
| OPD+C 의무 ID | `opdc:<o\|p\|d\|c>.<이름>`(예: `opdc:o.intent_and_reason`) | 루프 계약이 투영과 화면에 요구하는 OPD+C 의무의 식별자. `obs.*`를 쓰지 않고 `opdc` 계열로 두며, 묶음 뒤를 쌍점으로 잇는다(J-149, J-112 보완). 16 지표 ID(`opdc.o.unlinked_m_changes` 등 점 표기)와 섞이지 않는다 | — | J-112·J-149, 14 §3.5.5, 03 §3.1.3 | 지표 ID와 의무 ID는 다른 레지스트리다(지표 16, 의무 14 루프 계약). 같은 문자열을 두 레지스트리에 두지 않는 검사를 22가 둔다 |
| 16 설계 결정 | OB-1~OB-12 | 관찰 에이전트·지표의 주요 결정 번호 | — | 16 §2.2 | 관찰(`ob`) 접두사와 다르다 |
| 16 가정 | AS-1~AS-5 | 외부 로그 위치 등 확인 대기 가정 | — | 16 §2.3 | 전제 레코드 `as`와 다르다 |
| 관찰 실행 | observer run, `or`(제안) | 관찰 에이전트 프로세스가 한 번 떠서 작업 하나를 끝내는 단위 | — | 16 §1.5 | `or`은 08 §3.2.2 접두사 목록에 없다(§4 N-20) |
| 관찰 에이전트 | observer agent, `agent:observer` | 기록과 허용 폴더의 외부 세션 로그를 읽어 반복 패턴을 찾고 수정안을 제안하는 별도 일회성 프로세스. 쓰기 권한이 없다 | 관찰 에이전트 | 브리프 §6, 16 §3.1 | 결정적 수집·탐지·지표는 MVP, 모델 판정·제안은 2단계(J-07). 쓰지 않음: 옵저버, 관찰자 |
| 탐지기 | detector, D1~D13 | 반복 패턴을 찾는 결정적 코드 | — | 16 §3.10.1 | 결정 ID(D08-1, D09-2 등)와 다르다 |
| 서명 / 패밀리 | `signature`, `family` | 후보 패턴의 정규화 특징 해시와 비슷한 서명 묶음. 기각 기억의 단위 | — | 16 §3.11 | — |
| 허용 폴더 | allowed folders | 외부 세션 로그 관찰을 허용한 프로젝트 폴더. 세션 cwd가 이 아래인 세션만 읽는다 | — | 16 §1.5, J-08 | Mac에서 연 세션은 대상 밖 |
| 비밀 마스킹 | masking | 관찰 입력에서 비밀을 가리는 1차·2차 규칙 | — | 16 §3.8, 18 §3.10.4 | — |
| 효과 측정 | `effective`, `harmful` | 채택한 제안이 패턴을 줄였는지 7·14·28일에 판정 | — | 16 §3.17 | — |
| 통합 보고 | digest | 관찰 에이전트 결과를 묶어 보이는 보고 | — | 16 §3.18 | 알림 강도 `digest`, 판정 갈래 `digest`와 같은 단어다. 문맥으로 구분하고 화면에서는 "묶음"과 "통합 보고"로 나눈다 |

### 3.12 문서 표기

| 표기 | 뜻 | 정의 문서 |
|---|---|---|
| `[결정]`, `[결정 n]` | 사용자(제품 소유자)가 정한 것. 사용자 결정 번호에만 쓴다 | 브리프 §5.2, J-144 |
| `[제안: 결정 n 기본값]` | 브리프 §2.3의 조정자 기본값 | 브리프 §5.2, J-144 |
| `[판정 n]`, `[판정 J-nn]` | 조정자 판정. `[판정 n]`은 브리프 결정 44~46, `[판정 J-nn]`은 rulings-stage2a의 판정 | 브리프 §5.2, J-144 |
| 규범 키워드 | MUST·SHOULD·MAY(canon §2.1)는 쓰지 않는다. 설계 문서는 `[결정]`·`[제안]`·`[가정]`과 한다체 서술로 요구 강도를 적는다 | 브리프 §5.2 |
| `[제안]` | 설계자가 정한 것 | 브리프 §5.2 |
| `[가정]` | 확인되지 않은 전제 | 브리프 §5.2 |
| `[원문]`, `[실험]`, `[검색]`, `[지식]` | 외부 사실의 확인 수준: 소스·문서 직접 확인, 코드 실행 확인, 검색, 재확인 안 한 지식 | 브리프 §5.2 |
| `[정리]` | 원전 요약 문서에서 정리자가 붙인 해석 | helm-canon-3 |
| 결정 n | 브리프 §2의 결정 번호(1~57). §2.3의 26~37은 조정자 기본값(그중 33·35는 사용자가 확인함), 44~46은 조정자 판정이고 나머지는 사용자 결정이다 | 브리프 §2 |
| J-nn | 조정자 판정(J-01~J-190). §7 판정의 K-nn은 `stage4/rulings-needed.md`의 쟁점 번호다 | rulings-stage2a §3·§6·§7·§8·§9 |
| [v0.3 §5-n], v0.3 NN §x | v0.3 개념 문서와 그 결정 목록 | 브리프 §2 |
| canon, canon-2, canon-3 | 원전 요약(`helm-canon.md`, `-2`, `-3`) | 브리프 §4 |
| 발췌n, 대화 Lnnn | 대화 발췌 문서와 대화 원문 줄 번호 | 브리프 §4 |
| F00~F10, P00~P07 | foundations 문서, friendly(Product Foundations) 문서 | helm-canon §1~§18 |
| 화면 문구 | 합니다체. 설계 본문은 한다체 | 05 §3.10.3 |
| 유즈케이스 | 제품 사용 사례는 "유즈케이스"라고 쓴다. "시나리오"는 결과 탐구·테스트 시나리오에도 쓰이므로 피한다 | 브리프 결정 25, §5.1 |

**구현 계획·테스트 용어(22·23).** 두 문서는 이 문서를 쓰는 동안 나왔다. 23 §5.2가 등록을 요구한 말과 22 §1.3의 말만 넣었다(§5 M-01).

| 용어 | 식별자 | 뜻 | 화면 | 정의 문서 | 혼동 주의 |
|---|---|---|---|---|---|
| 마일스톤 | M0~M19 | 구현 순서의 묶음. 뼈대는 패키지 의존 순서(domain → store·kernel → engine → runtime → orchestration → daemon → 앱) | — | 23 §3.3, D23-1 | — |
| 작업 분해 | WBS, `M<n>-<nn>` | 마일스톤 안의 작업 목록. 작업마다 내용, 산출 파일, 근거 절, 완료 조건, 난이도 등급, 담당 단계, 모델을 둔다 | — | 23 §3.4 | — |
| 갈래 | — | 병렬로 진행하는 작업 줄기와 그 브랜치. 통합 브랜치는 `impl/helm-v1` | — | 23 §3.6, D23-8 | — |
| 임계 경로 | critical path | 가장 긴 의존 사슬 | — | 23 §3.6 | — |
| 스파이크 | spike | 위험이 큰 작업 전에 해 보는 확인. 실패하면 정해 둔 대체 경로로 간다 | — | 23 §3.7, D23-6 | — |
| G1 창 | — | MVP 실사용 14일. 이 동안 운영 데몬 갱신은 결함 수정과 기본 꺼짐 코드만 | — | 23 §3.5.3, D23-5 | — |
| 관문 기록 Concern | — | 관문 결과를 결과 확인으로 기록하는 Concern("Helm 사용 평가") | — | 23 §3.2 HT-19 | — |
| 사람 작업 | HT-nn, HD-n | 구현 전·중에 사람이 해야 할 일과 확인 | — | 23 §3.2 | — |
| 추적 ID | `<문서 번호>/<그 문서의 ID>` | 테스트 제목 앞에 붙이는 식별자(예: `10/PT-04`, `02/AC-07-01`). 문서 사이 ID 충돌을 없앤다 | — | 22 §1.3, D22-2 | — |
| 테스트 계층 / 결정성 등급 | D0·D1·D2 | 테스트 묶음과 결정성 수준(바이트 동일, 의미 동일, 통계·사람 판정) | — | 22 §1.3, §3.1 | — |
| 대본 / 모델 테이프 | `ScenarioScript`, `*.tape.jsonl` | 유즈케이스 흐름을 적은 데이터와 가짜 모델 응답 열 | — | 22 §1.3, §3.5.4, §3.8.1 | — |
| 픽스처 | `F-*` | 테스트 출발 상태. 명령을 실행해 만든다 | — | 22 §3.6, 02 §2.7 | — |
| 종료 지점 | kill point | 장애 주입 시험에서 데몬을 강제 종료하는 이름 붙은 위치 | — | 22 §3.9.2 | — |
| 비밀 카나리아 | — | 테스트용 가짜 비밀. 끝난 뒤 어디에도 원문이 없는지 검사한다 | — | 22 §3.11.2 | — |
| 카탈로그 동기화 검사 | `scripts/docs/check-catalog.ts` | 이벤트·명령·메서드·오류 코드의 코드 등록 표와 설계 표가 같은지 보는 `just verify` 검사 | — | 23 D23-10 | — |
| 골든 파일 | `*.golden.jsonl`·`*.golden.txt`·`*.golden.json` | 테스트가 출력과 바이트 단위로 비교하는 커밋된 기대 출력(이벤트 열, 선형 텍스트, 스키마 스냅숏 등). 갱신은 `HELM_GOLDEN_UPDATE=1`일 때만 한다 | — | 22 §1.3, §3.4.1, §3.5.2 | — |
| 플래키 / 플래키 격리 | `quarantine.json`(격리 목록) | 플래키는 코드와 입력이 같은데 결과가 바뀌는 테스트다. 격리는 플래키를 기한 7일의 격리 목록에 올리는 것이다. D0 계층 플래키는 격리도 허용하지 않는다. 재시도로 플래키를 숨기지 않는다 | — | 22 §1.3, §3.4.1, §3.18.1, D22-12 | — |
| 메인 오케스트레이터 | 1단계 | 구현 에이전트 3단계의 1단계(모델 Opus 5.5, 추론 high, [결정 52]). 마일스톤 진행, 갈래와 하위 조정자 배정, 중간 병합 지점과 마일스톤 끝의 통합 판단, 설계 변경 판정을 맡는다. 행을 직접 구현하지 않는다 | — | 23 §3.1.1, D23-13, [결정 51] | 런타임 "오케스트레이터"(§3.4)와 다르다. 이것은 구현 과정에서 일하는 에이전트의 단계이고, 런타임 오케스트레이터는 Helm 제품 안의 부품이다. 문서에서는 "메인 오케스트레이터"로 쓰고 "오케스트레이터"만 단독으로 쓰지 않는다 |
| 하위 조정자 | 2단계 | 구현 에이전트 3단계의 2단계(모델 Sonnet 5.5 medium, [결정 52]). 마일스톤이나 갈래 하나를 맡아 WBS 행을 실작업자 작업으로 나누고 배정하며, 결과를 검토해 갈래 브랜치에 합친다. 등급 D 행은 직접 맡는다 | — | 23 §3.1.1, §3.1.2, D23-13, [결정 51] | 런타임 "오케스트레이터"와 다르다(위 메인 오케스트레이터 행). 설계 단계의 "조정자"(판정을 내는 쪽)와도 다르다 |
| 실작업자 | 3단계 | 구현 에이전트 3단계의 3단계(모델 Haiku 5.5 max, [결정 52]). 파일·모듈 단위 구현, 테스트 작성, 기계적 변환을 맡는다. 자기 worktree에서 `just verify`를 통과시킨 뒤 넘긴다 | — | 23 §3.1.1, D23-13, [결정 51] | 런타임 "오케스트레이터"·런타임 어댑터와 다르다. 근거 절에 없는 결정은 하지 않는다(23 §3.1.1) |
| 난이도 등급 | 등급 A·B·C·D | 구현 작업마다 매기는 난이도 등급. A 기계적, B 표준, C 어려움, D 판단. WBS 행마다 매기고 등급으로 담당 단계와 모델을 정한다 | — | 23 §3.1.2, D23-13 | 상황 유형(§3.1: 명확·복잡·복합·혼돈·혼란)과 다른 말이다. 런타임 능력 등급(Level A~D, §3.7)과 글자만 같다 |
| 중간 병합 지점 | — | 다른 갈래의 행이 기다리는 선행 행까지 끝나면 1단계가 그 갈래 브랜치를 통합 브랜치에 병합하는 지점. 병합은 사용자 확인 뒤에 하며, 같은 날 생긴 지점은 한 번의 확인으로 묶는다 | — | 23 §3.6.3, D23-8, HD-6 | 마일스톤 끝의 통합 판단(§3.6)과 다르다 |

문서 안 ID가 겹치는 문제(§3.17, §4 N-55)는 22의 추적 ID 형식으로 테스트에서는 풀린다. 설계 문서 사이 인용에도 같은 형식("10/E-6")을 쓸 수 있다.

### 3.13 ID 체계 (08 §3.2 정본)

형식: `<prefix>_<ULID>`. 접두사는 소문자 두 글자, ULID는 Crockford base32 26자(첫 글자 0~7)다. ULID 부분은 대문자로 저장·비교한다. 순서는 seq로만 판단한다(08 §3.2.1). blob은 ID 대신 `sha256:<64 hex>`로 가리킨다.

화면과 TUI는 ULID 대신 표시 번호를 쓴다: `<종류 이름> <번호>`("질문 14", "Concern 12"), TUI 인자는 접두사 + 번호(`q14`, `cn12`, `qs`만 `q`로 줄임). 번호는 인스턴스 전체에서 종류별로 생성 seq 순서대로 매긴다(03 §3.2.6). 감사 깊이의 보조 표시는 `<접두사>_<마지막 6자>`다(08 §3.2.1).

접두사 목록(08 §3.2.2, 58개). "레코드 아님"은 이벤트·trace·질문 안 블록에 나오는 식별자다.

| 접두사 | 대상 | 접두사 | 대상 | 접두사 | 대상 |
|---|---|---|---|---|---|
| `pj` | Project | `gl` | Goal | `cn` | Concern |
| `sc` | StructureChange 구조 결정 | `bd` | BoundaryItem 경계 항목 | `wu` | WorkUnit |
| `ob` | Observation 관찰(반응 포함) | `as` | Assumption 전제 | `oq` | OpenQuestion 열린 질문 |
| `in` | Interpretation 해석 | `ps` | Possibility 가능성 | `fd` | Finding 판단 |
| `dc` | DiscriminatingCheck 구분 확인 | `ch` | Choice 선택 | `ct` | Objection 이의 |
| `ag` | Agreement 작업 합의 | `cr` | Criterion 완료 기준 | `gr` | Grant 맡겨 둔 권한 |
| `rs` | ResultSubmission 결과 제출 | `at` | Attestation 증언 | `ac` | Acceptance 결과 확인 |
| `ig` | Integration 전체 반영 | `io` | IntegrationObligation 반영 항목 | `rf` | Reflection 돌아보기 |
| `qs` | Question 질문 | `ex` | Expectation 기대 | `pr` | Prediction 예측 |
| `lp` | LoopPlan 루프 계획 | `lt` | LoopTransition 루프 전환 | `sa` | SituationAssessment 상황 판정 |
| `md` | ModeAssignment 모드 배정 | `pb` | Probe 탐침 | `wt` | Watch 지속 관찰 |
| `iq` | Inquiry 탐구 실행 | `st` | Stimulus 자극 | `pm` | PreferenceModel 선호 모델 |
| `ln` | Lens 렌즈 | `rn` | Run 에이전트 실행 | `tc` | ToolCall 도구 호출 |
| `th` | Thread 실행 대화 흐름 | `rb` | RollbackPoint 되돌릴 지점 | `dv` | Device 기기 |
| `pc` | PairingCode 페어링 코드 | `pp` | PolicyProposal 관찰 제안 | `pd` | Procedure 절차 |
| `ev` | 이벤트(레코드 아님) | `cm` | 명령(레코드 아님) | `cx` | 연결 id(레코드 아님, 18·19) |
| `mr` | 모델 요청 id(레코드 아님, 12) | `cp` | 컨텍스트 투영 id(레코드 아님, 12, J-16) | `cs` | 컴팩션 요약 id(레코드 아님) |
| `ms` | 메시지 id(레코드 아님) | `bl` | blob id(레코드 아님) | `up` | 업로드 세션 id(레코드 아님, 19) |
| `ri` | 실행 입력 id(레코드 아님) | `tm` | 런타임 타이머 id(레코드 아님) | `ap` | send 승인 id(질문 안 블록) |
| `ik` | 클라이언트 멱등 키(레코드 아님) | | | | |

쓰지 않는 접두사: `wa`(임시 가정 → `as`), `rw`(재작업 → WorkUnit `reworkOf`), `sb`(1판 Submission → `cm`), 컨텍스트 투영의 `cx`(→ `cp`, `cx`는 연결 id). 정본에 없는 접두사 `or`(관찰 실행, 16)는 §4 N-20.

### 3.14 이름 규칙

| 대상 | 규칙 | 예 | 정본 |
|---|---|---|---|
| 이벤트 | `<대상>.<과거형 동사>`, snake_case, 점 하나 | `question.recorded`, `loop_plan.adopted` | 09 §3.3 |
| trace 종류 | `<대상>.<동사>` 형태지만 이벤트가 아니다. 09 TraceKind 목록만 쓴다 | `model.requested`, `work.admitted`, `inquiry.step_started` | 09 §3.7 |
| 휘발 이벤트 | 이벤트와 같은 모양, `volatile: true` | `run.text_delta` | 09 §3.5 |
| 명령 | `<대상>.<명령형>`, 하위 동작은 점을 더 쓸 수 있다 | `agreement.confirm`, `goal.revision.confirm`, `inquiry.round.close` | 10 §3.11 |
| Helm 제안 도구 | `helm_` + 명령 이름의 점을 밑줄로 | `helm_possibility_propose` | 10 §3.11.11 (3), 13 §3.7 |
| 프로토콜 메서드 | `<대상>.<camelCase 동사>`, JSON-RPC 2.0 | `question.proceedWithAssumption`, `view.get`, `$/cancelRequest` | 19 §3.7.1 |
| 오류 종류 | `<영역>.<camelCase>` | `command.revisionConflict`, `auth.challengeStale` | 19 §3.3.4 |
| 커널 거부 코드 | `^(invalid\|not_found\|conflict\|policy\|denied\|gate\|path)\.[a-z0-9_.]+$` | `gate.scope_expansion_required` | 08 §3.23, 10 §3.4.4 |
| 화면 문구 키 | `<범주>.<대상>.<항목>[.<변형>]`, 범주 `label`, `status`, `action`, `notice`, `err`, `notif`, `help`, `empty` | `err.intent.staleBasis`, `action.question.assume` | 05 §3.10.8 |
| 화면 ID | `SCR-<이름>`, `OVL-<이름>`, `RGN-<이름>`, 모바일 `SCR-M-<이름>` | `SCR-INBOX`, `OVL-CONTEST`, `RGN-BANNER` | 03 §3.6, §3.12 |
| 다이얼 키 | `<묶음>.<이름>` | `assurance.proof_burden` | 08 §3.15 `DIAL_KEYS`, 14 §3.11.1 |
| 지표 ID | `<묶음>.<이름>` | `ca.agreement_bypass_rate` | 16 §3.23 |
| 결정 종류 키 | `^[a-z][a-z0-9_.]{1,63}$` | — | 08 §3.4.5, 11 §3.3.3 |
| 패키지 | `@helm/<이름>`, 가져온 pi는 `@helm/vendor-pi-<이름>` | `@helm/kernel`, `@helm/client`, `@helm/ui-language` | 06, 판정 §2 |

같은 대상을 두 계층에서 다르게 부르는 것은 규칙에 따른 것이다. 예: 사람이 질문에 답하면 메서드 `question.answer` → 명령 `question.answer` → 이벤트 `question.answered`. 명령과 메서드가 다른 이름이면 대응의 정본은 10 §3.11.11 (2)다.

### 3.15 오류·거부 코드 체계

**프로토콜 오류 코드(19 §3.3.4).** JSON-RPC 예약 범위에는 표준 다섯(-32700, -32600, -32601, -32602, -32603 `internal`)만 쓰고, Helm 코드는 영역별 1000~5999 양의 정수를 쓴다. 클라이언트는 `code` 또는 `data.kind`로 분기하고, 화면 문구는 `kind`와 `details`로 05가 만든다(`message`는 개발자용 영어).

| 범위 | 영역 | 대표 코드 |
|---|---|---|
| 1xxx | 핸드셰이크·인증·페어링·범위·속도 | 1001 `handshake.required`, 1003 `protocol.unsupported`, 1004 `auth.failed`, 1005 `auth.revoked`, 1007 `auth.challengeStale`, 1008 `auth.methodNotAllowed`, 1009 `pairing.invalidCode`, 1010 `scope.forbidden`, 1011 `rateLimited` |
| 2xxx | 재전송·구독·뷰 | 2001 `replay.outOfRange`, 2004 `view.unknown`, 2005 `view.targetNotFound`, 2006 `view.notReady`, 2008 `run.notFound` |
| 3xxx | 명령 | 3001 `command.rejected.content`, 3002 `command.rejected.authority`, 3003 `command.rejected.path`, 3004 `command.revisionConflict`, 3005 `command.targetNotFound`, 3006 `idempotency.keyReused`, 3007 `command.inProgress`, 3008 `command.alreadyResolved`, 3009 `command.superseded` |
| 4xxx | 파일·업로드 | 4001 `blob.tooLarge`, 4002 `blob.notFound`, 4003 `upload.notFound`, 4004 `upload.incomplete`, 4005 `upload.hashMismatch`, 4006 `ticket.limit`, 4007 `blob.gone` |
| 5xxx | 데몬·런타임 | 5001 `daemon.draining`, 5002 `daemon.busy`, 5003 `daemon.readOnly`, 5004 `request.cancelled`, 5005 `request.timeout`, 5006 `runtime.unavailable`, 5007 `feature.disabled` |

**커널 거부 코드(10 §3.4.4).** 접두사로 갈래가 정해진다: `invalid.*`·`not_found.*`·`conflict.*`(일부)·`policy.*` → 내용(3001), `denied.*`·`gate.*` → 자격(3002), `path.*` → 경로(3003). `conflict.version_mismatch` → 3004, `conflict.already_resolved` → 3008, `conflict.superseded` → 3009, `conflict.idempotency_key_reuse` → 3006. 강등 `downgraded.*`와 알림 `notice.*`는 거부가 아니다. 커널 오류 `kernel.*`는 -32603이다.

**화면 오류 문구 키(05 §3.11).** 19 코드와 문구 키의 대응은 05 §3.11 첫 표가 정한다. 05 표는 3002를 `command.rejected.qualification`으로 적었다(§4 N-18).

### 3.16 가설·지표 ID 요약

| ID | 대상 | 정본 |
|---|---|---|
| H1~H10 | foundations/08 반증 가설 | 16 §3.25, 01 §3.10.1, J-09 |
| V1~V7 | v0.3 10 §3 가설(원래 H1~H7) | 01 §3.10.2, 16 §3.26.1, J-09 |
| V8, V9 | 01이 더한 가설(C/A 2회 상한과 우회, 초안·반응) | 01 §3.10.2 |
| H-I1~H-I4, H-R1 | 탐구 엔진 가설 | 15 §3.15.5 |
| `<파일>:<ID>` | 방법 카드·종합 가설(SA-H1, AC-H1, CD-H1 …) | 16 §3.26.2 |
| SC-1~SC-6 | 제품 성공 기준 | 01 §3.10.3 |
| G1-1~G1-5, G2 | 증거 관문 기록 항목 | 01 §3.8.4 |
| CA-1~CA-7 | C/A 지표 별칭(정본 `ca.*`) | 01 §3.5.3, 16 §3.23.3 |
| CT-1~CT-3 | 진입 범주 지표 별칭(정본 `entry.*`) | 01 §3.6.7, 16 §3.23.6 |
| OB-1~OB-12 | 관찰·지표 설계 결정 | 16 §2.2 |
| `opdc.*` … `rt.*` | 지표 ID | 16 §3.23 |

### 3.17 문서 안 ID 체계

문서 안 ID는 문서마다 따로 매긴다. 같은 모양의 ID가 여러 문서에 있으므로(예: 10 E-6과 15 E-6, 11 R-2와 18 R-2, 06 O-12와 15 O-12) 다른 문서에서 인용할 때는 문서 번호를 붙인다("10 E-6").

| ID | 뜻 | 문서 |
|---|---|---|
| UC-01~UC-19 | 유즈케이스 | 02 §3.1 (정본, 판정 §1) |
| AC-<UC>-<nn> | 유즈케이스 수용 기준(Given/When/Then) | 02 |
| UQ-nn | 02의 미결 사항 | 02 |
| PR-01~PR-13 | 제품 원칙 | 01 §3.3 |
| X-01~X-14 | 금지하는 경험 | 01 §3.3.1 |
| EC-1~EC-5, E1~E3 | 진입 조건 신호, 진입 경로 | 01 §3.6 |
| R-OP-1, R-OP-2 | 사람 조작 상한과 합의 압축 | 01 §3.5.2 |
| NFR-<영역>-n | 비기능 요구 | 01 §3.11 |
| OQ-nn, OQ-16-nn | 미결 사항(01, 16) | 01 §7, 16 §7 |
| IA-nn, IX-nn | 03·05의 주요 선택 | 03 §2.2, 05 §2.2 |
| A1~A9(03·05), A08-n, OBS-ADR-n, ADR 후보 P1-n | 문서 끝 ADR 후보 | 각 문서 끝 |
| ADR-SS-NN, ADR-P0-Dn | 확정 ADR. `SS`는 문서 번호(`00`은 브리프, 결정 번호와 같음) | 24 §2.1 |
| D08-n, D09-n, D17-n, D18-n, APP-Dnn, P-nn, OB-n | 문서별 설계 결정 | 08, 09, 17, 18, 20, 19, 16 |
| R-01~R-53 | 쓰기 시점 참조 제약 | 08 §3.20.2 |
| V-PATH, V-CH, V-FORM …, V-Q-nn, V-AS-nn, V-MED-nn, V-POL-nn, V-INV-nn | 커널·질문 검증 규칙 | 10 §3.7, 11 §3.2.4 |
| G-K1 …, PT-nn, K-nn, E-nn | 커널 상태 전이 가드, 속성 테스트, 미결, 실패 사례 | 10 |
| D-1~D-n(11) | 전달 방식 규칙 | 11 §3.5.2 |
| T01~T28, G1~G9(14), U-nn, C14-n | 전환 규칙, 재진입 가드, 미결, 남은 충돌 | 14 |
| S1~S6(15), O-n(15) | 발산 신호, 미결 | 15 |
| T1~T8(16), D1~D13(16), AS-n | 관찰 실행 트리거, 탐지기, 가정 | 16 |
| T-Enn(13), S-nn(18), R-n(18) | 도구 위협 사례, 보안 실패 사례, 보안 요구 | 13, 18 |
| U-RT-n, T-CR-nn, E-nn(12) | 런타임 구현 단위, 복구 테스트, 실패 사례 | 12 |
| A1~A7, T1~T14(07) | pi 포크 패치 ID(pi-agent-core, coding-agent 도구·이미지 유틸). 코드에는 `// HELM-PATCH <ID>: <이유>` | 07 §1.3 |
| F-<이름> | 테스트 fixture(예: `F-base`) | 02 §2.7 |
| J-nn | 조정자 판정 | rulings-stage2a |
| H-1~H-5 | 홈랩 변경 요청 | rulings-stage2a §5 |

모양이 겹치는 ID: 홈랩 요청 H-1~H-5와 가설 H1~H10, 07 패치 A1~A7과 공리 A1~A15, 07 패치 T1~T14와 16 관찰 트리거 T1~T8·14 전환 규칙 T01~T28, 14 재진입 가드 G1~G9와 01 증거 관문 G1·G2, 15 발산 신호 S1~S6과 13 샌드박스 수준 S0~S2. 다른 문서에서 인용할 때는 "홈랩 H-1", "07 패치 A3", "재진입 가드 G2"처럼 앞말이나 문서 번호를 붙인다.

### 3.18 금지·주의 표현

**설계 문서 문체(브리프 §5.1).**

| 쓰지 않는 표현 | 대신 |
|---|---|
| '축' | 기준, 차원, 묶음, 항목 |
| '박다' | 넣다, 적다, 고정하다 |
| '가른다', '갈라진다' | 나눈다, 구분한다, 정한다, 나뉜다 |
| '닿다' | 이르다, 연결되다, 전달되다 |
| 사물을 주어로 세운 의인화("연구가 ~에 도달했다", "코드가 쥐고 있다", "~가 막아 줬다", "품는다", "이긴다", 발견에 쓰는 "드러났다") | 행위자나 사실을 주어로 쓴다. "확인했다", "나왔다", "~로 막았다" |
| "A가 아니라 B다" 식 짧은 구호 반복 | 차이를 문장으로 설명한다 |
| 제품 사용 사례를 "시나리오"로 | 유즈케이스 |

**화면 문구 금지(05 §3.10.9).** 화면 문구, 알림, 오류, TUI 출력에 쓰지 않는다. 05 §6의 문구 테스트가 공유 문구 목록 전체를 검사한다.

| 범주 | 쓰지 않는 표현 |
|---|---|
| 승인 노동 | "승인", "거절"(단독 버튼), "계속할까요?", "진행할까요?", "확인할까요?", "May I continue", "Approve", "Deny" |
| 완료 뭉뚱그리기 | "완료"(전체 반영 전), "성공적으로 완료", "모든 작업 완료", "문제없습니다" |
| 확신 숫자 | "신뢰도 n%", "확신도 n%", "정확도 n%"(근거 설명 대신) |
| 의인화 | 에이전트 주어의 "생각합니다", "느낍니다", "믿습니다", "기억합니다", "원합니다", "이해했습니다", "죄송합니다", "제가", 에이전트 이름·아바타 |
| 사물 의인화 | "시스템이 판단했습니다", "데이터가 말해 줍니다", "결과가 드러났습니다", "코드가 막아 줬습니다" |
| 브리프 금지어 | '축', '박다', '가른다', '닿다' |
| 군사·의료·항공 용어 | "지휘", "명령하달", "부하", "작전", "타임아웃"(수술 체크리스트 뜻), "사인아웃", "브리핑", "디브리핑" |
| 막연한 오류 | "오류가 발생했습니다"(원인 없이), "실패했습니다"(다음 행동 없이), "알 수 없는 오류" |
| 진행 표시 | "로딩 중...", "Agent is working…", "처리 중입니다"(무엇을 하는지 없이) |
| 알림 | "Helm notification", "새 알림이 있습니다", "긴급" |
| 원론 용어(일반 화면) | Normative, Epistemic, Material, Hypothesis, Claim, Commitment, Delegation Contract, Authority Envelope, Acceptance, Integration, Assurance, Escalation, Context Projection, 투영, 게이트 |
| 혼동 | 추천을 "선택했습니다"로, 결과 제출을 "확인됨"으로, 가정 확정을 "답함"으로 |
| 구호 | "A가 아니라 B입니다" 식 짧은 대구, 과장 수식("완벽한", "똑똑한", "놀라운") |

버튼은 05 §3.10.5를 따른다: "확인" → "이 선택으로 진행" 또는 "(대상)을 (효과)하기", "승인" → "결과 확인"이나 대상과 효과, "거절" → "수정 요청"·"거절(해결 안 됨)"(결과 확인 화면)·"(대상)을 하지 않기", "계속" → "맡긴 범위 안에서 다시 시작", "취소" → "작업 중단"·"닫기", "자세히" → "근거 보기"·"전체 영향 보기"·"펼치기", "다시 시도" → "마지막 확인 지점부터 다시 실행"·"다시 불러오기", "Escalate" → "내 선택이 필요함".

**주의할 말(이 문서가 모은 것).**

| 말 | 주의 |
|---|---|
| 판단 | Finding만 가리킨다. 커널·시스템·에이전트가 "판단했다"고 쓰지 않는다. 에이전트 문구는 "정했습니다", "추천합니다" |
| 투영 | 정본을 읽어 만든 화면·컨텍스트에만 쓴다. Method Transfer, 예측에 쓰지 않는다 |
| 탐침 | C.probe와 Probe 레코드에만 쓴다. 복귀 점검을 탐침이라 하지 않는다(J-10) |
| 완료 | 화면에서는 전체 반영까지 끝났을 때만 단독으로 쓴다. Concern에는 "반영 완료"·"닫힘" |
| 확인 | 결과 확인(`ac`), 합의 확인(`agreement_confirm`), 혼자 정한 결정 확인(`decision.confirm`), 기준 확인, 복귀 점검이 모두 "확인"을 쓴다. 단독 버튼 "확인"은 쓰지 않고 앞말을 붙인다 |
| 선택 | 사람이 정했거나 정책이 적용된 Choice만. 추천을 선택이라 하지 않는다 |
| 질문 | 사람에게 묻는 Question(`qs`). 모르는 점은 열린 질문(`oq`) |
| 이의 / 반대 근거 / 기각 / 거부 | 이의는 사람만 건다. 검증 에이전트는 반대 근거·증언을 낸다. 기각은 사람이 관찰 제안을 받아들이지 않은 것, 거부는 커널의 판정 |
| 범위 | 맡긴 범위(합의의 scope 묶음), 근거 범위(다이얼), 연결 범위(`scope`, 19 §3.4.6), 이벤트 소속(`EventScope`)이 모두 "범위"다. 앞말을 붙인다 |
| 예산 | 탐구·실행 예산(`inquiry.budget`), 주의 예산(14), 관찰 비용 예산(16 §3.19), 월 모델 비용 상한(J-22)을 구분한다 |
| 경계 | 작업 경계(`boundary.reached`)와 경계 항목(`bd`)을 구분한다 |
| digest | 알림 강도 `digest`(묶음), 판정 갈래 `digest`, 관찰 통합 보고(digest)를 구분한다 |
| 신뢰 | 숫자 신뢰도는 쓰지 않는다. 절차 신뢰(`trial`·`trusted`·`demoted`)는 절차 레코드의 상태다 |
| 런타임 | 행위자 `runtime`, 패키지 `@helm/runtime`, 외부 런타임 어댑터(Claude Code 등)를 구분한다 |

## 4. 이름 불일치 표

같은 대상을 문서마다 다르게 부른 곳이다. 정본은 판정 §1의 소유 규칙과 J-판정을 따랐다. 1판 이름 대응표(08 §10, 10 §3.4.6·§3.11.1, 11 §2.4, 12 §3.16)에 "옛 이름 → 새 이름"으로 적힌 것은 불일치로 세지 않는다.

- 열 "남은 곳"은 3단계 검증 1차 점검(`.helm-design-work/V2/A-n55-status.md`, 2026-10-12)의 문서:줄이다. 다른 문서가 4단계에서 고치는 중이므로 이 문서는 해소 여부를 판정하지 않는다. 5단계 재검증은 "처리 담당 문서"가 "처리 내용"대로 고쳤는지를 본다.
- 심각도: 높음 = 구현자가 다른 식별자·값을 만들 수 있음, 중간 = 문서끼리 뜻이나 이름이 어긋나 확인이 필요함, 낮음 = 표기만 다름.
- "처리 담당 문서"의 첫 문서가 정본 쪽이다. 정본이 바뀌어야 하는 줄은 정본 문서를 먼저 적었다.

### 4.1 불일치 표

| 번호 | 정본 이름 | 다른 이름 | 남은 곳(문서:줄) | 근거·판정 | 심각도 | 처리 담당 문서 | 처리 내용 |
|---|---|---|---|---|---|---|---|
| N-01 | 리스너 `tailnet`·`loopback`·`local` | Via `listener: "tailscale" \| "ssh" \| "local"` | 08:376, 26:408·998 | 판정 §2, 19 `ListenerKind` | 높음 | 08, 26 | 08 Via와 26을 정본 값으로. envelope `via.listener`에 기록되는 값이다 |
| N-02 | 저장 값 `active`·`idle`·`hidden`·`offline`, 부재는 14 §3.13.8 파생 함수 | `'online' \| 'idle' \| 'away'`, `away → online`, `locked` | 11:579·644·877·890, 10:693·1372·1398, 26:451·460, 14:2353·2433·2796, 09 `PresenceState`의 `locked` | J-119, J-118 | 높음 | 09, 14, 10, 11, 19, 26 | 09에서 `locked`를 뺀다. 14가 부재 파생 함수와 기기별 문턱(휴대폰 2분, 데스크톱 5분)을 적고 10·11·26의 판정식이 그 함수를 쓴다. 19 보고 타입은 세 값 |
| N-03 | 10 §3.11.11 (2) 메서드 → 명령 대응 | 19 "커널 명령" 열의 옛 대응(`question.requestReframe`·`question.delegate` → `question.answer`, `reaction.amend` → `observation.annotate`, `inquiry.round_end`, `agreement.revise` → `agreement.confirm`, `concern.revise` → `concern.reframe`, `mode.set` → `mode.route`, `work.steer`·`stop`·`abort` → 12 RunInput·`workunit.cancel`, `recovery.resolve` → `toolcall.resolve_unknown`)와 "10에 요구" 여덟 줄 | 19:1083~1137 | 판정 §1, J-47, J-123 | 높음 | 19 | 19 "커널 명령" 열을 10 §3.11.11 (2)로 맞춘다. `result.reopen` 행은 지운다(J-123) |
| N-04 | 결과 확인 명령 값 `accept`·`accept_with_conditions`·`request_changes`·`reject`·`criteria_wrong`, 기록 값 `accepted`·`conditional`·`revision_requested`·`rejected`·`criteria_wrong` | 명령 자리에 기록 값(19), 세 번째 값 묶음 `AcceptanceVerdict`(`"revision"`) | 19:1107~1110, 14:1140·2090 | J-35, J-123 | 높음 | 19, 14 | 19는 명령 값, 14는 08 기록 값. 결과 확인 전 거절·기준 틀림은 `result.accept`(decision `reject`·`criteria_wrong`, `reopenTo`), 확인 뒤 되돌리기는 `objection.file`(J-123) |
| N-05 | 이의 대상 `{kind: "record", id, itemKey}` / `{kind: "link", from, to, rel}` | `criterionVerdict`, `evidenceLink`, `{kind: "evidenceLink", fromId, toId}` | 04:990·1354·1497, 15:1931 | J-36, 08 §3.10.2 | 높음 | 04, 15 | 08 형식으로 |
| N-06 | 08 `HumanOpMeta` `followedRecommendation`·`extraReason`(자유 문장)·`editedDraft`. 정상 경로는 이벤트 종류로 계산 | 이벤트 필드 `onNormalPath`(01·02), 사유 코드 열거형 `extraReason`(01), "08 `HumanOpMeta.onNormalPath`"(16) | 01:387·388·395·409·410·1028, 02:285·418·523·655·1148, 11:1132, 16:1599·2419, 22:546·808·1049 | J-76 | 높음 | 01, 02, 16, 11, 22 | 정상 경로와 사유 코드는 16 지표 사실의 계산값으로 적는다. 같은 이름 `extraReason`에 다른 타입을 두지 않는다 |
| N-07 | 저장 층 `DialLayer`(`user`·`concern`·`instruction`), 해석 순서 `DialPrecedence`, Goal 범위 없음 | `DialScope = "global" \| {goalId} \| {concernId}`, 경로 `?scope=global\|goal\|concern` | 19:1432~1435, 03:574·613, 20:864, 04:1573 | J-136 | 높음 | 08, 14, 19, 03, 20 | 14는 해석 순서를 `DialPrecedence`로 이름 바꾸고 08 `DialLayer`와 대응을 적는다. 19·03·20에서 Goal 범위를 지운다 |
| N-08 | Goal 상태 `achievement_claimed`(+`proposed`·`retired`) | `achieved_claimed` | 04:1546 | 08 §3.22.1 | 높음 | 04 | 08 값으로 |
| N-09 | kind `boundary_item`, `result`, `obligation`, `toolcall` | `"boundary"`, `"criterion"`, `outcome_submission`, `integration_obligation`, `tool_call` | 04:96, 21:698·700·708 | 08 §3.20.1 | 높음 | 04, 21 | 08 kind로 |
| N-10 | `DaemonMode` `normal`·`safeMode`·`readOnly`·`draining` | `"read_only_recovery"` | 04:1825 | 19 §3.4.4 | 높음 | 04 | 19 값으로 |
| N-11 | 12 `RunEndReason` | 스트림 끝 이유 `completed`·`paused`·`stopped`·`aborted`·`failed` | 19:985 | 12 §3.2.1 | 높음 | 19 | 12 값을 그대로 |
| N-12 | 질문 상태 일곱(`delegated` 포함), 화면 라벨 "에이전트에게 맡김" | `delegated` 없는 여섯, "정본은 11" | 03:365~376, 04:158, 05:204 | J-114, 08 §3.13 | 중간 | 03, 05, 04 | 라벨을 더하고 정본 표기를 08로 |
| N-13 | 08 `QuestionKind` | 14 `HumanTouchpointKind`(`scope_exceeded`, `rights_permission`, `goal_revise`, `probe_agreement`), `tool_outcome_unknown` | 14:305·369·454~466·479·2002·2093·2323·2324, 11:1283 | J-26 | 중간 | 14, 11 | 14 타입을 없애고 08 `QuestionKind`를 쓴다. `tool_outcome_unknown`은 `recovery` |
| N-14 | 09 이벤트 이름 | `question.raised`, `submission.rejected`·`submission.gated`, `contest.filed`, `agreement.accepted`, `scope.violation_detected`, `run.resumed` | 14:479·2130·2145·2396·2403·2836 | J-25·J-30·J-33·J-38 | 중간 | 14 | `question.recorded`, `command.rejected`, `objection.filed`, `agreement.activated_by_grant`, `agreement.violation_detected`로. `run.resumed`는 지운다 |
| N-15 | `AgentRole` 여섯(`branch` 포함) | `branch` 없는 다섯 | 14:284, 04:110, 03:221 | 08 §3.3.2 | 중간 | 14, 04, 03 | 14는 08에서 import. 화면에서는 라우터·가지를 "에이전트"로 보인다(V5-047) |
| N-16 | `daemon.booted{bootEpoch, previousEpoch, previousCleanShutdown}` | `daemon.started`, `epoch`·`prevEpoch`·`prevClean`, `bootId` | 17:501·519·521, 12:1306·1320·1341·1346·1403 | 09 §3.4.13 | 중간 | 17, 12 | 09 필드 이름으로 |
| N-17 | 알림 강도 `interrupt`·`notice`·`digest` | `notify` | 05:73·78 | J-52 | 중간 | 05 | `notice`로 |
| N-18 | 거부 갈래 `authority`, 19 kind `command.rejected.authority` | `command.rejected.qualification` | 05:870 | 판정 §1 | 중간 | 05 | 대응표를 고친다 |
| N-19 | 08 상태 값(Agreement, Probe, Expectation, Obligation, BoundaryItem, `ConcernOrigin`) | 14 `draft`·`pending_confirm`·`ended`, `defined`·`grow`·`fold`, `violated`, `entryPath`; 04 `grow_met`·`fold_met`, `waiting`·`answered`, `done`·`in_progress` | 14:1016·2073·2075·2085, 04:1199·1200·1372 | 08 §3.22 | 중간 | 14, 04 | 뷰 타입도 08 상태 값을 쓴다. 묶음 표시는 다른 이름의 계산 필드로 |
| N-20 | 08 접두사 목록에 `or`(관찰 실행, 레코드 id 아님) | 목록에 없는 `or_` | 16:229·303, 17:244 | J-113 | 중간 | 08 | 08 §3.2.2 "레코드 id가 아닌 식별자"에 더한다 |
| N-21 | 평면: 결과 제출 E, 자극 E | 결과 제출 N, 자극 M | 21:698·707 | 08 §3.2.2 | 중간 | 21 | 08로 |
| N-22 | `Grade = low \| medium \| high` | `"mid"` | 16:1942·2169 | 08 §3.4.1 | 중간 | 16 | `medium` |
| N-23 | 08 `RunKind` 여덟(`observer`·`router` 포함) | 12 `RunKind`(둘 없음) | 12:190~198 | 08 §3.18.1, J-97 | 중간 | 12, 08 | 하나로 맞춘다(정본 08) |
| N-24 | 14 OPD+C 의무 ID `opdc:<o\|p\|d\|c>.<이름>`, 16 지표 ID `<묶음>.<이름>` | 의무 ID `obs.*`(14·03), 지표 `obs.*`·`opdc.o.*`(16) | 14:574~576·663·687·711·735·760, 03:124~136, 16:1781 | J-112·J-149, 이 문서 §3.11 | 중간 | 14, 03, 16 | 14·03은 의무 ID를 쌍점 형식으로. 16 지표 ID는 그대로 둔다 |
| N-25 | 결과 확인 행동 라벨 하나: "조건 붙여 확인", "거절(해결 안 됨)" | "조건부 확인", "결과 거절" | 03:215, 05:401·406·408·605, 04:1305·1346, 14:456·923, 21:1413, 02:324·652 | 03 §3.3.1, J-170 | 중간 | 05, 03, 04, 21 | 05 문구 키 하나로. 버튼 "거절(해결 안 됨)"은 J-170이 05 정본으로 정했다. 화면 라벨 정본은 03·05. 03:311 상태 라벨 "결과 거절됨"은 WorkUnit 상태 이름이라 그대로 둔다 |
| N-26 | 12 stage(trace) 다섯 값 | 19 `RunPhase` 일곱 값 | 19:984·987·997 | J-32 | 중간 | 12, 19 | 12가 phase 목록과 stage 대응을 소유하고 19가 참조 |
| N-27 | "복구 선택"("판단"은 Finding 전용) | "복구 판단", "복구 판단 필요" | 03:240·245·320·492·550·806·935, 04:267·388·553·587·1787·1816·1923·2016, 05:98·461·531·558, 20:1353, 26:32·134·735·810 | J-115 | 중간 | 03, 05, 04, 20, 26 | "복구 선택"으로 |
| N-28 | 화면 이름 "읽기 전용"(17 `read_only`, 19 `readOnly`) | "복구 모드", `recovery_mode`, `err.daemon.recoveryMode` | 02:806, 04:204·1729·1749·1818·2022, 05:883·913, 20:764·1551, 21:877·1447·1461·1718, 26:909 | J-115 | 중간 | 05, 21, 02, 04, 20, 26 | 05 문구 키와 21 `ConnectionUiState` 값부터 바꾼다. "복구"는 `SCR-RECOVERY`에만 |
| N-29 | Grant 화면 이름 "맡겨 둔 권한", 비상 Grant "비상 합의" | "맡긴 권한", "상시 합의", "미리 맺어 둔 합의" | 14:203·235·497·780·879·1402, 05:392, 08:3046, 02:159·1063, 03:316 | J-116 | 중간 | 03, 05, 14, 02, 08 | 화면 라벨은 03·05. 설계 본문도 "상시 합의"를 쓰지 않는다 |
| N-30 | `io` 반영 항목, `ig` 전체 반영 | "전체 반영 항목" | 21:700·1087 | 03 §3.2.3 | 중간 | 21 | "반영 항목" |
| N-31 | 03 §3.12 모바일 화면 ID | `SCR-M-ONBOARD` | 26:34·57·356·357·390·731·895·898 | 판정 §1 | 중간 | 03, 26 | 03에 더하거나 26이 다른 ID를 쓴다 |
| N-32 | 가설 ID H1~H10, V1~V9 | 06 데몬 책임 라벨 `H1`~`H8`, 어댑터 원칙 `V1`~`V8` | 06:816~823·1413~1420 | J-09 | 중간 | 06(인용하는 16·24) | 06 라벨에 접두어(예: `DH-1`, `AP-1`) |
| N-33 | 문구 사전 `@helm/ui-language` | 앱 문구 상수 `src/copy/` | 20:820·1246 | J-103 | 중간 | 20 | `@helm/ui-language`로 |
| N-34 | 메서드 `objection.file`, 명령 `decision.contest`, 레코드 Objection, 이벤트 `objection.*` | 메서드 `contest.file` | 19:67·1088, 04:797·938·990·1354·1421·1497·1959·2036, 05:137·360, 10:1551, 15:1931, 21:936·937·1228·1365, 26:854 | J-111 | 중간 | 19, 04, 05, 10, 15, 21, 26 | 19 등록 표부터 `objection.file`로. 화면 ID `OVL-CONTEST`, 부품 `ContestButton`, 16 지표 이름의 contest는 그대로 둔다 |
| N-35 | 13 §3.11.3 중립 신호 `kind`(밑줄 표기) | 점 표기 `session.started`, `tool.requested`, `turn.ended`, `run.ended` 등 | 06:1437~1443 | 13 §3.11.3 | 중간 | 06 | 13 이름을 참조 |
| N-36 | 고쳐서 허락: 원 호출 `denied(edited_by_human)` + 결정적 새 tcId(`editedFrom`), 한 트랜잭션 | 같은 tcId(11·08·09), 원 호출 참조 없음(12) | 11:1112·1258·1480, 08:3531, 09:888, 12:1752, 13:799~806 | J-117, J-121 | 높음 | 08, 09, 10, 11, 12, 13 | 08 전이·필드 `editedFrom`, 09 `toolcall.approved`·`denied(edited_by_human)`, 11 표·시험, 12 실행 절차, 13 prepare·권한 재판정을 J-121대로 |
| N-37 | 13 보장 수준(run 성질)과 08 집행 시점(호출 단위) | (두 값 집합) | 13:47·174가 대응을 적음 | — | 낮음 | (없음) | 2b 판에서 해소 |
| N-38 | "선언 도구" = 값만 선언하고 run을 넘기는 Helm 도구 | "선언 도구" = 투영에서 모델에게 노출한 도구 | 07:738·887·938·1269 | 13 §3.7.1, J-65 | 낮음 | 07 | "노출한 도구"로 |
| N-39 | 메서드 `resumptionCheck.answer`·`score` | `probe.answer`·`probe.score` | 10:1531·1579, 23:590 | J-10, J-78 | 낮음 | 10, 23 | 고친다 |
| N-40 | 가설 서술(foundations/08 원문) | H3·H4·H5·H7·H9 문장이 01과 16에서 다름. H5는 뜻이 다름 | 01:773~779, 16:2011·2089 | J-09 | 중간 | 16, 01 | 원문 문장 하나로(§5 M-09) |
| N-41 | 03 §3.2.4 화면 질문 종류 열 | 04 `QuestionScreenKind` 일곱 | 04:142 | 03 §3.2.4 | 중간 | 04 | 03 묶음에 맞춘다 |
| N-42 | 19 `resultId` | `submissionId` | 04:1344·1345·1356 | 10 §3.4.6 | 중간 | 04 | 이름만 바꾼다 |
| N-43 | 오케스트레이션 순수 코어 `@helm/kernel/orchestration`(15 순수부 포함) | `packages/runtime/src/orchestration/core/…` | 14:53·250·290·1027·1104·1684·2032·2201·2273·2587 | J-128 | 중간 | 06, 14, 15 | 06이 "I/O 없는 함수만"을 적고 14·15 경로를 고친다 |
| N-44 | `correlatedWith`(04 VM) | `sameSourceFamily` | 21:728 | 04 §3.0.2 | 중간 | 21 | 04 이름으로 |
| N-45 | 혼자 정한 결정 | "자율 결정" | 10(13곳), 11(3곳), 08:3916, 02:1191, 22, 23 | 브리프 §6 | 낮음 | 10, 11, 08, 02, 22, 23 | 한 문서 안에서 하나로. 화면에는 쓰지 않는다 |
| N-46 | 검증 에이전트 | "검증자" | 04:1310, 21:1412(화면 문구), 14(10곳), 08(3곳), 07(2곳) | 브리프 §6 | 낮음(04·21은 중간) | 04, 21, 14, 08, 07 | 화면 문구는 "검증 에이전트" |
| N-47 | 이미 반영된 상태 | 낡은 설명 문장 | 17:481, 20:703·765·770, 14:2365·2938, 03:290·469, 19:570, 16:2381 | — | 낮음 | 17, 20, 14, 03, 19, 16 | 각 문서가 지운다 |
| N-48 | run 종료 이유 `recovery_exhausted` | 상태 목록에 `recovery_exhausted` | 03:320 | 08 §3.18.1 | 낮음 | 03 | "`ended(recovery_exhausted)`"로 |
| N-49 | 개수는 카탈로그에서 센다 | 이벤트 수 271·274·275, 접두사 57·58 | 09:1060·2301·2447·2484, 08:187·3773·3948 | — | 낮음 | 09, 08 | 숫자를 적지 않거나 카탈로그에서 센 값으로 |
| N-50 | Via `local_cli` | `createdBy.kind = "local_admin"` | 08:2969, 22:672·759 | 08 §3.3.2 | 낮음 | 08, 22 | 맞춘다. 환경 변수 `HELM_LISTEN_SSH_PORT`는 J-102대로 유지 |
| N-51 | 03 §3.6 화면 ID | `SCR-CONCERN` | 03:522 | 03 §3.6 | 낮음 | 03 | 목록에 더하거나 `SCR-CONCERN-OVERVIEW`로 |
| N-52 | 복귀 점검(J-10) | "복귀 probe" | 02:195 | J-10 | 낮음 | 02 | 원천 인용이 아니면 "복귀 점검" |
| N-53 | 본문 "제공자", 화면 "모델 제공자", 코드 `provider` | 본문의 "provider", "공급자" | 07(42곳), 12(13곳), 22(14곳)의 provider, 06(11곳)·18(11곳)·04 §3.21의 공급자 | 이 문서가 정본(§3.7) | 낮음 | 07, 12, 22, 06, 18, 04, 19, 23, 26 | 코드 표기 밖에서는 "제공자", 화면은 "모델 제공자" |
| N-54 | 무게 화면 이름 "높음·중간·낮음" | "중요함/보통/덜 중요함" | 21:1669 | 05 §3.2.6 | 낮음 | 21 | 05를 따른다 |
| N-55 | 인용할 때 문서 번호를 붙인다(22 추적 ID 형식 `<문서>/<ID>`) | 모양이 같은 문서 안 ID(06 S0~S9·R1~R14·H·V, 12 S1~S8, 13 G1~G8·AC-01~14, 14 G1~G9, 16 AS-1~5, 18 AS-*·R-1~12) | 06, 12, 13, 14, 16, 18, 02 | §3.17 | 낮음 | (각 문서) | ID는 그대로 두고 인용 형식만 지킨다. 새 ID는 접두어로 구분한다 |

### 4.2 2b단계 작업 중 해소된 것

이 문서를 처음 쓰는 동안(12:47~13:40) 고쳐져 표에서 뺀 것: 09가 `check.pinned`·`check.unpinned`를 더함(J-95), 11 `AnswerValue`에서 맡기기·다시 쓰기·미루기를 별도 명령으로 뺌(J-47), 11의 1판 질문 종류 이름 정리, 13의 포트 7801과 갈래 `qualification` 제거, 13·11의 `submission.rejected`·`scope.violation_detected`·`toolcall.dropped` 제거, 12의 투영 접두사 `cx` 제거(대응표에만 남음), 10 `result.accept` 대응표가 명령 값으로 바뀜.

### 4.3 확인했으나 불일치가 없던 것

루프 식별자 18개와 화면 이름, 모드 ID 8개와 이름, 다이얼 저장 키 18개, 접두사 `wa`·`rw`·`sb`·컨텍스트 투영 `cx`(대응표 밖 사용 없음), 숫자 confidence 잔존(J-19), Goal·Concern의 "목표·초점" 화면 이름(J-21), "탐침"을 복귀 점검에 쓴 곳(J-10), 설정 파일·데이터·잠금·소켓 경로와 `helmd.service`, 포트 7840·7841·8448.

보조 자료: 문서별 불일치 전체 목록(약 500행)은 `.helm-design-work/T3/helperA-inconsistencies.md`와 `helperB-terms.md` §4에 있다(커밋하지 않음). 이 표는 그중 구현에 영향이 있는 것과 여러 문서에 걸친 것을 골랐다.

## 5. 미결 사항

판정으로 닫힌 것도 번호를 남긴다.

| ID | 사항 | 선택지 | 추천 기본값 또는 결과 |
|---|---|---|---|
| M-01 | 22(테스트 전략), 23(구현 계획), 26(모바일 클라이언트)의 용어 | (a) 세 문서가 끝난 뒤 항목을 더한다 (b) 작성 중인 판에서 모두 뽑는다 | (a). 이 판에는 23이 등록을 요구한 말, 22 §1.3, 26 결정 표와 결정 47~49·52~57의 이름만 넣었다(§3.2, §3.4, §3.7, §3.9, §3.10, §3.12). 세 문서의 본문 용어 대조는 5단계 재검증 뒤 한다 |
| M-02 | 이의 메서드 이름 | — | 닫힘: `objection.file`(J-111). 처리는 §4 N-34 |
| M-03 | 결과 확인 값 두 집합(명령 값·기록 값) | (a) 두 집합 유지 (b) 기록 값 하나로 통일 | (a) J-35. 19 메서드 params는 10 명령 값(§4 N-04). `result.reopen`은 쓰지 않는다(J-123) |
| M-04 | 알림 강도의 화면 이름 | (a) 끼어들기·알림·묶음(05) (b) 화면에 보이지 않음 | (a) 05 §3.1.2. 값 이름은 `notice`(§4 N-17) |
| M-05 | 문구 키 범주 `notice.*`(05)와 커널 알림 코드 `notice.*`(10) | (a) 그대로 (b) 커널 쪽을 `note.*`로 | (a). 서로 다른 계층(화면 문구 키, 커널 결과 코드)에만 나온다. 문서에서는 "커널 알림 코드"라고 앞말을 붙인다 |
| M-06 | OPD+C 의무 ID와 관찰 지표 ID | — | 닫힘: 14 쪽을 `opdc` 계열로(J-112). 의무 ID 형식은 `opdc:<기준>.<이름>`(쌍점 구분)이고 16 지표 ID `opdc.o.*`는 그대로 둔다(J-149, §3.11). 처리는 §4 N-24 |
| M-07 | 관찰 실행 ID 접두사 `or` | — | 닫힘: 08에 추가(J-113). 처리는 §4 N-20 |
| M-08 | 새 이름을 만들 때의 등록 절차 | (a) 정본 문서에 먼저 정의하고 25에 항목 추가 (b) 25에 먼저 등록 | (a) §2.4 |
| M-09 | 가설 서술의 기준 문장(§4 N-40) | (a) foundations/08 원문 문장 (b) 01의 짧은 문장 (c) 16의 문장 | (a). H5는 뜻이 달라 원문 확인이 먼저다. 16 소유 |
| M-10 | Question `delegated`의 화면 라벨 | — | 닫힘: "에이전트에게 맡김"(J-114) |
| M-11 | "복구 판단"과 "복구 모드" | — | 닫힘: "복구 선택", "읽기 전용"(J-115) |
| M-12 | Grant의 화면 이름 | — | 닫힘: "맡겨 둔 권한", 비상 Grant는 "비상 합의"(J-116) |
| M-13 | 상황 유형 화면 라벨(V5-047: "복잡"과 "복합"이 한 글자 차이) | (a) 라벨 그대로 두고 한 줄 도움말을 항상 붙인다 (b) 라벨을 풀어 쓴다: 명확 → "정해진 방법이 있는 일", 복잡 → "분석이 필요한 일", 복합 → "해 봐야 아는 일", 혼돈 → "먼저 막아야 하는 일", 혼란 → "아직 유형을 모르는 일" | 닫힘: (b). 03 §3.3.7과 05 §3.10.8이 풀어 쓴 이름을 화면에 쓴다. 홈 트리 한 줄에서 두 글자 라벨은 구분이 어렵다는 것이 근거였다. 설계 본문과 개발자 보기는 두 글자 이름을 그대로 쓴다 |
| M-14 | 원전 화면 이름 셋(Assurance, ContextProjection, Escalation)의 화면 표기 | 부록 A의 대응 | 닫힘: 부록 A대로. 05 §3.10.8에 세 행이 들어갔다 |
| M-15 | 사람이 고친 계획(`authoredBy` `human`)의 화면 이름 | (a) 05 §3.10.8과 §3.6.6에 행을 더한다 (b) 화면 이름 없이 "모델이 설계한 계획"·"계산한 계획"만 쓰고, `human`은 개발자 보기에만 둔다 | 열림(새 이름 요구). 05 §3.10.8과 §3.6.6에는 `human`의 이름이 없다. 이름을 정하는 것은 05 몫이다 |

## 6. 출처

- 브리프: `docs/design/process/00-design-brief.md` §2(결정 1~57), §3(공통 계약), §5.1(문체), §5.2(표시, J-144), §5.3(문서 구성), §6(용어집 초안)
- 조정자 판정: `docs/design/process/rulings-stage2a.md` §1(이름 소유), §3·§6·§7·§8·§9의 J-01~J-190. 이 판에 반영한 주요 판정: J-09, J-10, J-12, J-19, J-21, J-26, J-30, J-35, J-46, J-52, J-63, J-76, J-78, J-111~J-121, J-123, J-124, J-127~J-129, J-135~J-137, J-144, J-148, J-149, J-151, J-170, J-187~J-190
- 3단계 검증 1차: `docs/design/process/verification/round-1/` V1(V1-009, V1-023, V1-032, V1-070, V1-078~V1-080), V2(V2-001, V2-047, V2-055), V5(V5-047), V7(V7-018, V7-023, V7-027~V7-029, V7-048), 점검 자료 `.helm-design-work/V2/A-n55-status.md`, `.helm-design-work/V1/E2-canon1b.md` P-10, `F1-canon2.md` P-8, `F2-canon3.md` P8
- 설계 문서 01~26의 용어·정의 절. 주로 01 §3.3·§3.5·§3.6·§3.10, 02 §2·§3.1, 03 §3.2·§3.3·§3.6·§3.10·§3.12, 05 §3.1·§3.6.6·§3.7.8·§3.10·§3.11, 08 §3.1~§3.25·§10, 09 §3.1~§3.5·§3.7, 10 §3.4·§3.11, 11 §2.4·§3.2~§3.6, 12 §1.3, 13 §1.3·§3.11, 14 §2.3·§3.1~§3.15, 15 §1.4·§3.2·§3.4, 16 §1.5·§2.2·§3.21~§3.26, 17 §1.4, 19 §1.4·§3.3·§3.7, 20 §1.4, 22 §1.3, 23 §2.2·§3.1.1·§3.1.2·§3.6.3·§5.2, 24 §2, 26 §2.4·§3.1.5·§3.4.6
- 원천: `docs/design/process/sources/helm-canon.md` §2.1(규범 키워드), §17.2(공유 언어), §17.6(UX 문구 지침), §18(product-language.yaml 전체), `helm-canon-2.md` §1.10·§1.14·§3.8·§3.10, `helm-canon-3.md` §1.3(원전 어휘와 v0.3·브리프 어휘 대응, 공리·불변조건 번호), §7.3 I8
- 이름 대조 보조 자료(커밋하지 않음): `.helm-design-work/T3/`의 이벤트 카탈로그 추출(`events09.json`), 카탈로그 밖 이벤트 모양 이름 목록(`ev-noncatalog*.txt`), 메서드 대조(`methods19.txt`), 보조 조사(`helperA-inconsistencies.md`, `helperB-terms.md`), 첫 대조 시점 사본(`snap0/`)

## 부록 A. 원전 product-language 대응

canon §17.2·§18(product-language.yaml)의 이름을 이 설계의 이름에 대응시킨다. 화면 열은 03·05가 정본이다. 05 §3.10.8에 행이 없는 것만 [제안]으로 적는다.

### A.1 terms 32개

| key | 원전 화면 이름(PY label) | 원론(foundation) | 이 설계 | 화면 |
|---|---|---|---|---|
| goal | 목표 | Purpose | Goal, 작업 합의 `purpose` | Goal(J-21) |
| focus | 초점 | Concern | Concern | Concern(J-21) |
| current_picture | 현재 상황 | SituationModel | 투영 + 상황 판정(`sa`) | Concern 개요 |
| problem_view | 문제 관점 | ProblemFrame | 가능성 `perspective`, 관점 행 | 관점 |
| observation | 관찰 | Observation | `ob` | 관찰 |
| interpretation | 해석 | Inference | `in` | 해석 |
| possibility | 가능성 | Hypothesis | `ps` | 가능성 |
| finding | 판단 | Claim | `fd` | 판단 |
| evidence | 근거 | Evidence | 관찰 + 근거 관계 | 근거 |
| challenging_evidence | 반대 근거 | Counterevidence | `challenges`·`invalidates` 관계 | 반대 근거 |
| assumption | 전제 | Assumption | `as` | 전제 |
| open_question | 아직 모르는 점 | Uncertainty | `oq` | 아직 모르는 점 |
| choice | 선택 | Decision | `ch` | 선택 |
| result_condition | 완료 기준 | AcceptanceCriterion | `cr` | 완료 기준 |
| review_trigger | 다시 볼 조건 | ReopenTrigger | `reviewTrigger`(`Trigger`) | 다시 볼 조건 |
| promise | 약속 | Commitment | 작업 합의(`ag`)에 합침 | 쓰지 않음 |
| work_agreement | 작업 합의 | DelegationContract | `ag` | 작업 합의 |
| allowed_range | 맡긴 범위 | AuthorityEnvelope | 합의 범위·금지 행동·멈출 조건 | 맡긴 범위 |
| work | 진행 작업 | WorkUnit | `wu` | 진행 작업 |
| result_submission | 결과 제출 | CompletionClaim | `rs` | 결과 제출 |
| result_review | 결과 확인 | Acceptance | `ac` | 결과 확인 |
| result | 실제 결과 | Outcome | `ResultSubmission.materialChanges` + 관찰 | 실제 결과(결과 확인 화면 안) |
| whole_update | 전체 반영 | Integration | `ig` + `io` | 전체 반영 / 반영 항목 |
| learning_review | 돌아보기 | Reflection | `rf`, `A.reflect` | 돌아보기 |
| brief | 복귀 요약 | ReturnBrief | `brief` 뷰 | 복귀 요약 |
| choice_request | 선택 요청 | DecisionGate | 권리 게이트 질문 | 선택 필요 |
| change_record | 변화 기록 | Event | 이벤트 로그 | 변화 기록(`SCR-RECORD`) |
| automation_rule | 자동화 규칙 | Policy | 정책(P), 관찰 제안 채택 결과 | 규칙(예: "규칙에 따라 정해짐") |
| boundary | 지켜야 할 조건 | Constraint | Goal "지킬 것", 합의 금지 행동 | 지킬 것 / 금지 행동 |
| human_owner | 사람 책임자 | HumanActor | `human` | 나 |
| agent_delegate | Agent 담당 | AgentActor | `agent:<role>` | 역할 이름(작업 에이전트 등) |
| reviewer | 결과 확인자 | Acceptor | `human`(결과 확인은 사람만) | 결과 확인: 나 |

### A.2 navigation 6, fixed_sections 4, 상태 집합

- navigation(오늘·초점·진행 작업·선택·근거·자동화 규칙)은 03 §3.5.2의 레일(홈, 질문함, 에이전트가 정한 것, Concern, Goal, 관찰 제안, 설정, 조건부 복구)로 바뀌었다. 대응은 03 §3.5.2 표가 정본이다. "근거"는 레일에 두지 않고 객체에서 근거 체인(`SCR-EVIDENCE`)으로 들어간다.
- fixed_sections 4(brief, choice_request, active_work, result_review)는 05 §3.10.4 고정 표현이 그대로 받고 항목을 더했다.
- work_statuses 14와 choice_statuses 7은 03 §3.3이 받았다. choice 상태 7개는 화면에서 쓰지 않는다(03 §3.3.1, "결과 확인됨" 라벨 충돌 해소).

### A.3 avoid_as_default_ui_labels 16

| 원론 이름 | 원전 기본 표현 | 이 설계의 화면 표기 |
|---|---|---|
| Normative / Epistemic / Material | 방향 / 이해 / 실제 변화 | 같음(03 §3.9) |
| Concern | 초점 | Concern(J-21로 바뀜) |
| ProblemFrame | 문제 관점 | 관점 |
| Hypothesis | 가능성 | 가능성 |
| Claim | 판단 | 판단 |
| Commitment | 약속 | 작업 합의(약속은 쓰지 않음) |
| DelegationContract | 작업 합의 | 작업 합의 |
| AuthorityEnvelope | 맡긴 범위 | 맡긴 범위 |
| WorkUnit | 진행 작업 | 진행 작업 |
| Acceptance | 결과 확인 | 결과 확인 |
| Integration | 전체 반영 | 전체 반영 |
| Assurance | 근거 검토 | 결과 확인 화면의 "확인된 것 / 확인하지 못한 것 / 반대 근거" 절로 보이고 따로 이름 붙이지 않는다 |
| Escalation | 도움 요청 / 선택 필요 | 진행 작업의 "도움이 필요한 조건", 사람에게 올라온 결정은 "선택 필요"·버튼 "내 선택이 필요함"(05 §3.10.5) |
| Context Projection | 맞춤 상황 / 복귀 요약 | 화면에 쓰지 않는다. 사람이 보는 것은 "복귀 요약", 모델 컨텍스트는 개발자 보기에서 "컨텍스트 투영" |
