# 08. 도메인 모델

- 소유: P5 (도메인)
- 작성: 2026-10-11, 1단계 초안
- 패키지: `@helm/domain` (브리프 §3.1)
- 기준 결정: 브리프 결정 1~64(사용자 결정 1~25·33·35·38~43·47~64, 조정자 기본값 26~32·34·36·37, 조정자 판정 44~46), 판정 J-01~J-351
- 함께 읽을 문서: [09-event-store.md](09-event-store.md) (이벤트 envelope, 카탈로그, 저장), `10-kernel.md` (명령, 검증 규칙 집행), `11-asking-and-autonomy.md` (질문 전달, 혼자 정한 결정의 흐름), `14-loops-modes-orchestration.md` (루프·모드·다이얼), `15-inquiry-engine.md` (탐구 실행)

## 1. 목적과 범위

### 1.1 목적

Helm이 기록하는 모든 레코드와 엔티티의 타입, ID, 행위자, 관계, 쓰기 시점 참조 제약, 품질 상태, 상태 기계를 정한다. 구현자가 이 문서와 09만 보고 `@helm/domain`의 타입·스키마·상태 전이 표를 만들 수 있어야 한다.

### 1.2 다루는 것

1. 세계 모델 `<N, E, M | A, P>`에서 각 레코드의 소속과 NEMAP의 역할 (§3.1)
2. ID 형식과 접두사 최종 목록 (§3.2)
3. 시간 표기, 행위자(actor) 문법, 역할, 능력표(A) (§3.3)
4. 공통 타입: 레코드 메타, 품질 상태, 혼자 정한 결정 표시(Autonomy), 참조, 실제(M) 참조, blob 참조 (§3.4)
5. 레코드 타입 전부 (TypeBox 스키마, §3.5~§3.19)
6. 관계 종류와 쓰기 시점 참조 제약 (§3.20)
7. 품질 상태 전이 (§3.21)
8. 상태 기계 표 (§3.22)
9. 거부 세 갈래의 타입 (§3.23)
10. 불변조건과 타입 수준 대응 (§3.24)
11. 원전 어휘와의 대응 (§3.25)

### 1.3 다루지 않는 것

| 다루지 않는 것 | 소유 문서 |
|---|---|
| 이벤트 envelope, 이벤트 이름 카탈로그, SQLite 저장, 투영 테이블 | 09 |
| 명령(command) 이름과 카탈로그, 검증 순서, 정책 계산, 거부 코드 전체 목록, 공리 A1~A15 집행 대응 | 10 |
| 질문 전달 방식의 결정 규칙, 중재자 동작, 가정 만료 판정 순서, 혼자 정한 결정의 표시와 이의 흐름 | 11 |
| 에이전트 루프, 컨텍스트(투영) 생성 알고리즘, 크래시 복구 절차, 스케줄러 | 12 |
| 도구 목록, 원시 행동과 도구의 대응, 권한 레이어 연결, bash 우회 검사 | 13 |
| 루프 계약(데이터), 전환 규칙, 모드 정의, 다이얼 의미와 기본값, 주의 예산 | 14 |
| 탐구 네 종류의 실행 절차, 발산 표 계산, 자극 선택, 멈춤 판정 | 15 |
| 관찰 에이전트의 마이닝과 제안 생성, 지표 | 16 |
| 기기 페어링 절차, 토큰 발급, 위협 모델 | 18 |
| 프로토콜 메시지 형식 | 19 |

이 문서는 위 문서들이 쓰는 레코드의 "모양"과 "쓰기 시점에 반드시 성립해야 하는 참조"를 정한다. 그 레코드를 언제 누가 만드는지의 절차는 각 소유 문서가 정한다.

## 2. 전제와 결정

### 2.1 브리프 결정에서 이 문서가 따르는 것

| 근거 | 이 문서에서의 반영 |
|---|---|
| [결정] 2 effect class·가역성 판별은 Helm 범위 밖 | 어떤 레코드에도 effect class(R0~R4)나 가역성 등급 필드를 두지 않는다. 권한 레이어의 판정은 도구 호출 레코드의 `permission`에 불투명한 값으로만 받는다 (§3.18) |
| [결정] 4 능력 두 층 | `Primitive`(read, write, execute, send, spawn, ask)와 `RecordCapability`(observe, propose, attest, accept, integrate) 두 타입 (§3.3) |
| [결정] 5 루프 O, I, C, A, S | `LoopId` 식별자 (§3.15). Concern 상태 기계는 루프 위치와 따로 둔다 |
| [결정] 6 상황 유형은 바뀔 수 있는 상태 | 상황 판정을 레코드(`sa`)로 두고 새 판정이 이전 판정을 대체한다 |
| [결정] 7 탐구 네 종류 | `InquiryKind` (§3.17) |
| [결정] 8 혼자 정한 결정 기록·이의 | 결정 성격의 레코드 전부에 `Autonomy` 블록을 둔다. `why_not_asked`는 autonomous일 때 필수 (§3.4.5) |
| [결정] 9 외부 응답은 관찰 | `Observation.source.kind = "external"` (§3.8) |
| [결정] 11 Goal 정의, Concern 정의 | §3.5, §3.6 |
| [결정] 12 질문 레코드와 가정 만료점, 권리·정보 게이트 | §3.13 |
| [결정] 14 모델은 제안하고 커널이 상태를 바꾼다 | 모든 레코드는 이벤트로만 생긴다. 레코드 타입은 투영 결과의 모양이다 (§3.1.4) |
| [결정] 15(1)~(3) 의존 규칙 | 쓰기 시점 참조 제약 R-05, R-17, R-13 (§3.20) |
| [제안] 15(4)(5) | 제약 R-34, R-35. [제안]으로 표시한다 |
| [결정] 53 루프 계획 혼합 | 계획 작성 방식 다이얼 `planAuthoring`(14 §3.11.1), `PlanFlags.outOfPattern`과 `LoopPlanCore.authoredBy`(§3.15), 제안 종류 `loop_plan_draft`(§3.3.4). 계획 검사 규칙은 R-29와 10이 집행한다 |
| [결정] 17 불변조건 1~7 | §3.24에서 타입 수준 대응을 적는다 |
| [결정] 18 대안 2~3개 고르기 거부, 반응 기록 | 원함 탐구에는 고르기형 질문 타입이 없다. 반응(Reaction) 타입이 요소 단위 반응과 이유 없는 반응을 받는다 (§3.17) |
| [결정] 24 혼자 쓰는 앱 | 사람 행위자는 `human` 하나다. 팀·CollectiveActor·다중 사용자 권한은 두지 않는다 |
| [제안: 결정 29 기본값] 기준 원본은 이벤트 로그 | 레코드의 현재 상태는 이벤트를 접어서 얻는다. 레코드 테이블을 정본으로 두지 않는다 (09 §3.11) |
| [제안] 36 TypeBox | 스키마는 `typebox` 1.x로 쓴다. pi-ai와 같은 패키지다 (`~/projects/_ref/pi-src/packages/ai/src/index.ts:1-2`가 `typebox`를 다시 내보냄) [원문] |
| 브리프 §3.2, §3.3 | ID 접두사와 행위자 문법의 초기값을 이 문서에서 확정한다 |

### 2.2 이 문서가 새로 정한 것 [제안]

| 번호 | 결정 | 근거 |
|---|---|---|
| D08-1 | 판단(Finding)은 승격 때 새로 생기는 레코드(`fd`)다. 추측(해석·가능성)의 상태 값으로 두지 않는다. 원래 추측은 `promoted` 상태로 남는다 | 판단 승격은 커널 이벤트로만 일어나야 한다(대화 L2232, X3-3-10). 승격 시점의 근거를 고정해 두어야 나중에 근거가 낡았는지 볼 수 있다. 브리프 §3.2가 `in`, `ps`, `fd`를 따로 둔다 |
| D08-2 | 구분 확인(discriminating check)을 레코드(`dc`)로 둔다. 관찰 전에 결과 라벨과 후보별 예측을 선언하고, 관찰 뒤 라벨을 분류하면 커널이 후보별 일치·불일치를 계산한다 | "모델이 구조화된 값을 선언할 수 있으면 결정은 코드가 한다"(브리프 결정 14). helm-toy와 v0.2 커널 어디에도 구분 확인 필드가 없었다(helm-canon-2 §11 08 체크리스트) |
| D08-3 | 품질 상태를 단계(level) 하나와 독립 플래그 셋(contested, stale, superseded)으로 나눈다 | v0.3 02 §9.1은 직선 단계와 옆길 상태를, v0.2 커널 §10은 세 직교 필드를 썼다. 받아들여진 선택이 동시에 낡고 이의가 걸릴 수 있으므로 옆길 상태는 단계와 독립이다 |
| D08-4 | 혼자 정한 결정을 따로 레코드로 만들지 않고 결정 레코드(`ch`, `lp`, `lt`, `sa`, `sc`, `md`)의 `Autonomy` 블록으로 표시한다. "에이전트가 정한 것" 화면은 이 블록이 있는 레코드의 투영이다 | v0.3 02 §8.2, v0.3 06 §4.2. 루프 계획·전환·상황 판정·분해·라우팅이 각자 레코드를 가지므로 한 블록으로 통일하는 편이 단순하다 |
| D08-5 | 반응은 `Observation`의 한 종류(`kind: "reaction"`)다 | v0.3 04 §3.2 3단계 "반응은 관찰로 기록된다". 반응 전용 ID를 만들면 관찰과 반응 두 경로가 생긴다 |
| D08-6 | 이의를 레코드(`ct`, Objection)로 둔다 | 이의가 처리되지 않고 사라진 수를 0으로 지키려면(OPD+C Contestability 지표, v0.3 09 §5) 이의마다 상태가 있어야 한다 |
| D08-7 | 프로젝트(`pj`)를 둔다. Goal은 프로젝트에 속한다. 데몬 하나가 여러 프로젝트를 한 DB에 담는다 | Goal은 "프로젝트 단위 궁극 목표"(브리프 결정 11). 여러 프로젝트를 한 홈에서 보는 요구(audit-report §2, "A 작업에 몰입한 동안 B, C 상태를 한 곳에서") |
| D08-8 | 모든 선택(Choice)은 근거 E 레코드를 하나 이상 참조한다. 근거는 판단·가능성뿐 아니라 관찰·해석·전제·선호 기준도 될 수 있다 | 대화 L2716 "Choice는 Finding이나 Possibility를 참조"를 기본으로 하되, 사소한 혼자 정한 결정(변수 이름)과 취향형 선택(선호 기준이 근거)까지 덮기 위해 범위를 넓혔다. 넓힌 사실을 §7 미결에 적는다 |
| D08-9 | 관계는 링크(`Link`) 하나의 타입으로 표현하고 종류(`rel`)로 구분한다. 관계에는 만든 이벤트(seq), 만든 행위자, 근거가 붙는다 | foundations/01 §5 "관계는 단순 링크가 아니라 종류, 생성자, 시점, 근거를 가져야 한다"(helm-canon §7.8) |
| D08-10 | 신뢰도를 숫자로 저장하지도 표시하지도 않는다(판정 J-19). 질적 등급(`low`/`medium`/`high`, 15의 `SupportGrade`)과 근거 목록만 둔다 | helm-canon-3 §7.1 C4. 원전 여러 곳이 숫자 확률을 피하라고 했다. v0.3 04 §3.4의 `confidence: 0.8`은 쓰지 않는다 |
| D08-11 | 타입 이름은 브리프 §3.2·§6의 이름(Goal, Concern, WorkUnit, Choice, Agreement 등)을 쓴다. friendly 문서의 Product Domain 이름(Focus, WorkAgreement, ResultSubmission 등)은 §3.25 대응표에만 둔다 | 브리프가 원전보다 우선한다(브리프 머리말). P06의 "public API는 Product Domain 이름 우선" 규칙은 따르지 않으며 이유를 ADR 후보 A08-5에 적는다 |
| D08-12 | 레코드 버전은 사람에게 의미 있는 변경만 올리는 `revisionSeq`와 모든 변경을 따르는 `lastSeq` 둘이다 | 근거 링크·주석이 붙을 때마다 버전이 오르면 사람이 본 화면으로 낸 답이 이유 없이 충돌로 막힌다(19). 어느 이벤트가 버전을 올리는지는 09 카탈로그의 `bumpsRevision`이 정한다 |
| D08-13 | 레코드 안의 결정 블록(합의 활성화, 범위 줄이기, 탐침·지속 관찰 판정, 질문 전달 계획)도 `Autonomy`를 가지며 이의 대상이다 | 10·11이 이 다섯 결정을 혼자 정한 결정으로 다룬다. 따로 레코드를 만들지 않고 결정이 일어난 레코드 안에 둔다(D08-4와 같은 이유) |
| D08-14 | Run의 진행 단계(stage)와 모델 요청 기록은 09의 trace에 둔다. 레코드·이벤트로 남기지 않는다 | 도메인 상태(State)는 이벤트만으로 다시 만들어져야 한다. 실행 재개에만 쓰는 운영 정보를 섞으면 재구성이 무거워진다 |

### 2.3 원전 사이 불일치에서 고른 판본

| 주제 | 원전 판본 | 이 문서의 선택 |
|---|---|---|
| 세계 모델 | F01 세 세계 / F05 다섯 상태 공간 / F10 `<N,E,M \| A,P>` | F10 판본(v0.2 D2 수락). N/E/M은 의미 세계, A/P는 통치 평면 |
| Claim 상태 기계 | F02 §8 / F05 §6 (helm-canon §20.2 #4) | 둘 다 그대로 쓰지 않는다. 추측(`in`, `ps`)의 상태와 판단(`fd`)의 상태를 따로 둔다. F05의 UnderInvestigation·Undetermined는 가능성 상태 `open`·`undecidable`로 옮긴다 (§3.22.10) |
| Evidence 상태 기계 | F02 §8 / F05 §7 | Evidence를 독립 엔티티로 두지 않는다. 근거는 관찰과 링크의 조합이다(helm-canon-3 §1.3 "Evidence는 관계"). Captured·Qualified는 관찰의 품질 단계로, Linked는 링크 존재로, Stale·Invalidated는 품질 플래그로 옮긴다 |
| Decision 상태 기계 | F03 §8 / F05 §5 | v0.3 Choice는 결정된 순간에만 생긴다(브리프 §6 "선택은 사람이 고르거나 맡긴 범위의 정책이 적용될 때만"). Open~Deliberating은 질문(`qs`)과 가능성으로 옮기고, Choice는 `committed`에서 시작한다 (§3.22.12) |
| 위임 상태 기계 | F03 §2 CfA / F05 §4 WorkUnit | WorkUnit(§3.22.3)과 Agreement(§3.22.4) 둘로 나눈다. 대화 X3-2-16의 C/A 상태 기계를 기준으로 하고 F05 보조 전이를 붙인다 |
| Integration 원전 6단계 (F05 §10) | 단계 상태 기계 | 단계를 상태로 두지 않는다. 반영 항목(Obligation)의 종류와 상태로 표현하고, 모든 항목이 닫히거나 넘겨지거나 미뤄지면 `integration.completed`다(§3.12, §3.22.6) |
| Decision의 Implementing·Validated·Integrated (F03 §8) | Decision 상태 | Choice는 committed에서 시작해 superseded·revoked로만 간다. 구현 진행은 `Choice.implementedBy`(합의)와 그 WorkUnit 상태에서 계산하고 저장하지 않는다 |
| "완료"의 기준 | Integrated / Closed (helm-canon §20.2 #18) | "완료" = WorkUnit `integrated`, Concern `completed`. Closed는 완료하지 않고 끝낸 상태다 |
| 판단의 뜻 | friendly 판단 = Claim / F10 Finding = 수락된 Claim | 브리프 §6을 따라 "판단"은 Finding만 가리킨다 |

## 3. 명세 본문

### 3.1 세계 모델과 레코드 분류

#### 3.1.1 다섯 평면

[제안: v0.3 02 §1·§6·§7, v0.2 D2. 능력 두 층만 결정 4]

```text
WorkspaceState(t) = <N(t), E(t), M(t) | A(t), P(t)>
State(seq_n)      = fold(apply, State0, Events[1..n])
```

| 평면 | 뜻 | 이 문서의 레코드 | 누가 바꾸는가 |
|---|---|---|---|
| N 방향 | 하기로 한 것, 지킬 것, 원하는 것 | Project, Goal, Concern, StructureChange, BoundaryItem, Choice, Agreement(+Criterion), Grant의 목적·범위 부분, Acceptance, Integration(+Obligation), Question, Expectation, LoopPlan, Probe, PreferenceModel, ModeAssignment, Reflection | 사람, 또는 사람이 확인한 제안, 또는 맡긴 범위 안의 정책 |
| E 이해 | 안다고 주장하는 것과 모르는 것 | Observation(반응 포함), Assumption, OpenQuestion, Interpretation, Possibility, Finding, DiscriminatingCheck, ResultSubmission, Attestation, Prediction, LoopTransition, SituationAssessment, Objection, Inquiry, Stimulus, Lens | 모델은 제안만 한다. 관찰은 런타임·사람·외부·타이머만 만든다. 승격은 커널만 한다 |
| M 실제 | 실제로 존재하거나 바뀐 것 | 저장하지 않는다. `MaterialRef`(파일@해시, 커밋, URL, 실행 id)로 참조만 한다. WorkUnit, Run, ToolCall은 M을 바꾸는 실행의 기록이다 | 도구 실행 |
| A 참여자·능력 | 누가 어떤 종류의 일을 할 수 있는가 (상황과 무관한 고정 표) | Actor 문법, 능력표(§3.3.4), Device | 코드에 고정. 기기는 사람이 등록 |
| P 정책 | 지금 이 상황에서 해도 되는가 | Grant, Agreement의 범위, DialSetting, PolicyProposal | 사람. 관찰 에이전트는 수정안만 제안 |

판별 질문(브리프 §6): "일하는 도중에 상황이 바뀌면 답도 바뀌는가?" 바뀌면 P, 언제나 같으면 A.

평면 사이 관계(v0.3 02 §1.2, 각 관계는 §3.20의 쓰기 시점 제약이 된다):

```text
E justifies N    근거와 판단이 선택을 정당화한다         → R-15
N authorizes M   선택과 작업 합의가 변경을 허가한다       → R-05
M updates E      실행 결과가 믿음과 가설을 바꾼다         → R-06
M fulfills N     결과가 목표와 약속을 충족한다            → R-19
E reveals N      자극에 대한 반응에서 원하는 것을 알아낸다 → R-36
```

#### 3.1.2 관찰은 E다

"네트워크 탭을 보니 2초"는 E에 속한다(v0.3 02 §1.1, 대화 L2957–2973). M은 세상 그 자체이고 Helm은 저장하지 않는다. 관찰 레코드는 "언제, 어떤 실행이나 사람이 무엇을 보았다"는 E 기록이며, 참조한 M(`materialRefs`)의 해시를 함께 남겨 M이 바뀌면 낡음을 알 수 있게 한다(§3.21).

#### 3.1.3 NEMAP, OICA, OPD+C의 역할

[근거: 대화 L2543–2549 (X3-7-03), 브리프 §3.5 "OICA = 흐름, NEMAP = 상태, OPD+C = 평가"]

| 묶음 | 역할 | 이 저장소에서의 형태 | 소유 문서 |
|---|---|---|---|
| NEMAP | 상태: 무엇이 기록되고 누가 바꿀 수 있는가 | 레코드 타입(이 문서), 능력표(A), 정책 입력(P), 이벤트(09) | 08, 10 |
| OICA(+S) | 흐름: 지금 어떤 일을 하고 있는가 | 루프 계획·전환 레코드, 루프 계약 데이터 | 14 |
| OPD+C | 평가: 사람이 따라가고 바꿀 수 있는가 | 투영과 지표. 레코드에는 이의(`ct`), 혼자 정한 결정 표시, 다음 예정이 들어간다 | 16, 03~05 |

단일 변경 경로(v0.3 08 §2)에서 각 묶음이 걸리는 지점:

| 경로 단계 (v0.3 08 §2) | 걸리는 묶음 | 이 문서가 주는 것 |
|---|---|---|
| 1. 형식 검사 | NEMAP | 레코드 스키마, ID 형식, 쓰기 시점 참조 제약(§3.20)의 "참조 대상이 존재하고 상태가 맞는가" 부분 |
| 2. 권한 검사 | A, P | 능력표(§3.3.4), 범위 타입(Agreement.scope, Grant), 권한 레이어 판정 타입 |
| 3. 이벤트 기록 | NEMAP | 이벤트 payload 타입(09) |
| 4. 세계 모델 갱신 | NEMAP | 상태 기계 표(§3.22), 품질 상태 전이(§3.21) |
| 5. 규칙 평가 | OICA, P | 루프 식별자, 질문·기대·예측의 타이머 필드 |
| 6. 투영과 감시 | OPD+C | 레코드의 표시 필드(title, summary), Autonomy, 품질 플래그 |
| 7. 다음 단계 구성 | OICA | 모드 배정, 루프 계획 |

루프 × 평면 표(대화 L2615–2622)와 그 S 루프 확장은 14가 소유한다.

#### 3.1.4 레코드와 이벤트의 관계

- 레코드는 이벤트를 접어서 얻은 투영 결과의 모양이다. 레코드를 직접 쓰는 API는 없다.
- 레코드를 만드는 이벤트의 payload는 각 레코드의 `*Core` 스키마(만들 때 정하는 필드)다. 상태(`status`), 품질(`quality`), 메타(`RecordMeta`)는 커널과 투영기가 채운다.
- 이벤트 이름과 payload의 정본 목록은 09 §3.4다. 이 문서의 상태 기계 표는 09의 이벤트 이름을 쓴다.

### 3.2 ID

#### 3.2.1 형식 [근거: 브리프 §3.2 공통 계약 / 접두사 확정은 이 문서]

```text
<prefix>_<ULID>
prefix = 소문자 두 글자 (§3.2.2 표)
ULID   = Crockford base32 26자, 첫 글자 0~7 (48비트 ms 시각 + 80비트 난수)
예: cn_01JA2Z7Q8M3XK4V9TB6N0PRWES
```

- 대소문자: ULID 부분은 대문자로 저장하고 비교한다. 입력에서 소문자를 받으면 대문자로 바꾼 뒤 검증한다.
- ID의 시각 부분은 생성 순서의 힌트일 뿐이다. 순서는 이벤트 `seq`로만 판단한다(helm-canon-2 §1.8 "순서 의미를 ID 문자열에 의존하지 않는다").
- ID는 한 번 정하면 바뀌지 않는다. 제목·경로가 바뀌어도 같은 레코드다(F01 §6).
- 커널은 순수 함수라서 ID를 직접 만들지 않는다. 쓰기 경로(`@helm/store` 또는 명령을 만드는 쪽)가 `IdFactory`를 주입한다. 테스트에서는 결정적 팩토리를 쓴다.
- 짧은 표시용 ID: 화면은 `<prefix>_<마지막 6자>`를 보조 표시로 쓸 수 있다. 저장과 프로토콜에는 쓰지 않는다.

#### 3.2.2 접두사 최종 목록

브리프 §3.2의 24개(굵게)와 이 문서가 더한 36개다. 아래쪽 18개는 정렬(§10)에서 다른 문서의 요구로 더했다. `cx`·`mr`·`cp`·`cs`·`ms`·`up`·`ri`·`tm`·`ap`·`ik`·`or`은 레코드 id가 아닌 식별자(이벤트·trace·질문 안 블록에 나옴)이며 형식만 이 문서가 정한다.

| 접두사 | 대상 | 평면 | 정의 | 접두사 | 대상 | 평면 | 정의 |
|---|---|---|---|---|---|---|---|
| `pj` | Project | N | §3.5 | **`gl`** | Goal | N | §3.5 |
| **`cn`** | Concern | N | §3.6 | `sc` | StructureChange (S 루프 결정) | N | §3.6 |
| `bd` | BoundaryItem (경계 항목) | N | §3.6 | **`wu`** | WorkUnit | M 실행 | §3.7 |
| **`ob`** | Observation (반응 포함) | E | §3.8 | `as` | Assumption (전제) | E | §3.8 |
| `oq` | OpenQuestion (열린 질문) | E | §3.8 | **`in`** | Interpretation (해석) | E | §3.9 |
| **`ps`** | Possibility (가능성) | E | §3.9 | **`fd`** | Finding (판단) | E | §3.9 |
| `dc` | DiscriminatingCheck (구분 확인) | E | §3.9 | **`ch`** | Choice (선택) | N | §3.10 |
| `ct` | Objection (이의) | E | §3.10 | **`ag`** | Agreement (작업 합의) | N | §3.11 |
| `cr` | Criterion (완료 기준) | N | §3.11 | `gr` | Grant (맡겨 둔 권한, 비상 합의 포함) | P | §3.11 |
| **`rs`** | ResultSubmission (결과 제출) | E | §3.12 | `at` | Attestation (검증 증언) | E | §3.12 |
| **`ac`** | Acceptance (결과 확인) | N | §3.12 | `ig` | Integration (전체 반영) | N | §3.12 |
| `io` | IntegrationObligation (반영 항목) | N | §3.12 | `rf` | Reflection (돌아보기) | N | §3.12 |
| **`qs`** | Question (질문) | N/E | §3.13 | **`ex`** | Expectation (기대) | N | §3.14 |
| **`pr`** | Prediction (예측) | E | §3.14 | **`lp`** | LoopPlan (루프 계획) | N | §3.15 |
| **`lt`** | LoopTransition (루프 전환) | E | §3.15 | **`sa`** | SituationAssessment (상황 판정) | E | §3.15 |
| `md` | ModeAssignment (모드 배정) | N | §3.15 | **`pb`** | Probe (탐침) | N | §3.16 |
| `iq` | Inquiry (탐구 실행) | E | §3.17 | **`st`** | Stimulus (자극) | E | §3.17 |
| **`pm`** | PreferenceModel (선호 모델) | N | §3.17 | `ln` | Lens (Method Transfer 렌즈) | E | §3.17 |
| **`rn`** | Run (에이전트 실행) | M 실행 | §3.18 | **`tc`** | ToolCall (도구 호출) | M 실행 | §3.18 |
| **`dv`** | Device (클라이언트 기기) | A | §3.19 | `pp` | PolicyProposal (관찰 에이전트 제안) | P | §3.19 |
| **`ev`** | 이벤트 | - | 09 §3.2 | `cm` | 명령(command) | - | 09 §3.9, 10 |
| `pc` | PairingCode (페어링 코드) | A | 18 | `cx` | 연결(connection) id | - | 18·19 |
| `th` | Thread (실행 대화 흐름) | M 실행 | §3.18, 12 | `mr` | 모델 요청 id | - | 12 |
| `cp` | 컨텍스트 투영 id | - | 12 | `cs` | 컴팩션 요약 id | - | 12 |
| `ms` | 메시지 id | - | 12 | `rb` | RollbackPoint (되돌릴 지점) | M | §3.18.3 |
| `pd` | Procedure (절차) | P | §3.19.3 | `wt` | Watch (지속 관찰) | N | §3.16.2 |
| `bl` | blob id | - | §3.4.7 | `up` | 업로드 세션 id | - | 19 |
| `ri` | 실행 입력 id | - | 12 | `tm` | 런타임 타이머 id | - | 12, 09 §3.7 |
| `ap` | send 승인 id (질문 안) | - | §3.13, 11 | `ik` | 클라이언트 멱등 키 | - | 19 P-09, 09 §3.9 |
| `or` | 관찰 실행 id | - | 16 (판정 J-113) | `ea` | EntryAssessment (진입 판정) | N | §3.6.4 |

브리프 표에 있는 "판단(Finding) `fd`", "선택 `ch`" 등은 그대로 쓴다. 반응은 `ob`(D08-5), 이의는 `ct`(D08-6)다. blob은 ID 대신 내용 해시 `sha256:<64 hex>`로 가리킨다(§3.4.7).

#### 3.2.3 스키마

```ts
// @helm/domain/src/ids.ts
import { Type, type Static, type TSchema } from "typebox";

export const ID_PREFIXES = [
  "pj", "gl", "cn", "sc", "bd", "wu", "ob", "as", "oq", "in", "ps", "fd", "dc",
  "ch", "ct", "ag", "cr", "gr", "rs", "at", "ac", "ig", "io", "rf", "qs", "ex",
  "pr", "lp", "lt", "sa", "md", "pb", "iq", "st", "pm", "ln", "rn", "tc", "dv",
  "pp", "ev", "cm",
  // 1단계 정렬에서 더한 것 (§10)
  "pc", "cx", "th", "mr", "cp", "cs", "ms", "rb", "pd", "wt", "bl", "up", "ri", "tm", "ap", "ik", "or", "ea",
] as const;
export type IdPrefix = (typeof ID_PREFIXES)[number];

/** Crockford base32, 첫 글자 0~7 */
export const ULID_PATTERN = "[0-7][0-9A-HJKMNP-TV-Z]{25}";
export const ID_PATTERN = `^(${ID_PREFIXES.join("|")})_${ULID_PATTERN}$`;

export type IdOf<P extends IdPrefix> = `${P}_${string}`;

export const Id = <P extends IdPrefix>(prefix: P) =>
  Type.Unsafe<IdOf<P>>(Type.String({ pattern: `^${prefix}_${ULID_PATTERN}$` }));

/** 여러 접두사 중 하나 */
export const IdAny = <P extends IdPrefix>(...prefixes: readonly P[]) =>
  Type.Unsafe<IdOf<P>>(Type.String({ pattern: `^(${prefixes.join("|")})_${ULID_PATTERN}$` }));

export const AnyRecordId = Type.Unsafe<IdOf<IdPrefix>>(Type.String({ pattern: ID_PATTERN }));

export interface IdFactory {
  /** 단조 ULID. 같은 ms 안에서는 난수부를 1 증가시킨다 */
  next<P extends IdPrefix>(prefix: P): IdOf<P>;
}

export declare function prefixOf(id: string): IdPrefix | null; // 형식이 틀리면 null
export declare function isId<P extends IdPrefix>(id: unknown, prefix: P): id is IdOf<P>;
export declare function normalizeId(input: string): string;     // ULID 부분 대문자화, 앞뒤 공백 제거
```

ID 타입 별칭(이후 스키마에서 쓴다):

```ts
export const ProjectId = Id("pj");      export const GoalId = Id("gl");
export const ConcernId = Id("cn");      export const StructureChangeId = Id("sc");
export const BoundaryItemId = Id("bd"); export const WorkUnitId = Id("wu");
export const ObservationId = Id("ob");  export const AssumptionId = Id("as");
export const OpenQuestionId = Id("oq"); export const InterpretationId = Id("in");
export const PossibilityId = Id("ps");  export const FindingId = Id("fd");
export const CheckId = Id("dc");        export const ChoiceId = Id("ch");
export const ObjectionId = Id("ct");    export const AgreementId = Id("ag");
export const CriterionId = Id("cr");    export const GrantId = Id("gr");
export const ResultId = Id("rs");       export const AttestationId = Id("at");
export const AcceptanceId = Id("ac");   export const IntegrationId = Id("ig");
export const ObligationId = Id("io");   export const ReflectionId = Id("rf");
export const QuestionId = Id("qs");     export const ExpectationId = Id("ex");
export const PredictionId = Id("pr");   export const LoopPlanId = Id("lp");
export const LoopTransitionId = Id("lt"); export const AssessmentId = Id("sa");
export const ModeAssignmentId = Id("md"); export const ProbeId = Id("pb");
export const InquiryId = Id("iq");      export const StimulusId = Id("st");
export const PreferenceModelId = Id("pm"); export const LensId = Id("ln");
export const RunId = Id("rn");          export const ToolCallId = Id("tc");
export const DeviceId = Id("dv");       export const PolicyProposalId = Id("pp");
export const EventId = Id("ev");        export const CommandId = Id("cm");
export const PairingCodeId = Id("pc");  export const ConnectionId = Id("cx");
export const ThreadId = Id("th");       export const ModelRequestId = Id("mr");
export const ContextProjectionId = Id("cp"); export const CompactionId = Id("cs");
export const MessageId = Id("ms");      export const RollbackPointId = Id("rb");
export const ProcedureId = Id("pd");    export const WatchId = Id("wt");
export const BlobId = Id("bl");         export const UploadId = Id("up");
export const RunInputId = Id("ri");     export const RuntimeTimerId = Id("tm");
export const ApprovalId = Id("ap");      export const IdempotencyKeyId = Id("ik");
export const ObserverRunId = Id("or");  export const EntryAssessmentId = Id("ea");

/** 타입 별칭 규칙: 모든 Id 상수 X에 대해 `export type XT = Static<typeof X>`를 둔다 (10이 쓰는 XxxIdT 이름).
 *  템플릿 리터럴 타입이라 컴파일 타임에는 접두사만 보장되고, ULID 형식은 런타임 검사로만 보장된다 */
export type ProjectIdT = Static<typeof ProjectId>;   // … 위 상수마다 같은 형식으로 하나씩

/** 추측과 판단 (Claim 계열) */
export const ClaimId = IdAny("in", "ps", "fd");
/** E 근거로 쓸 수 있는 레코드 (선택의 basis, D08-8) */
export const EvidenceRecordId = IdAny("ob", "in", "ps", "fd", "as", "pm");
```

### 3.3 시간과 행위자

#### 3.3.1 시간 [근거: 브리프 §3.3 공통 계약]

```ts
// @helm/domain/src/time.ts
/** 저장: Unix epoch 밀리초 정수 (UTC). 프로토콜 변환은 19가 한다 */
export const Ms = Type.Integer({ minimum: 0 });
export type Ms = Static<typeof Ms>;
export const DurationMs = Type.Integer({ minimum: 0 });

export interface Clock { now(): Ms } // 커널에는 주입한다. Date.now()를 직접 읽지 않는다
```

- 이벤트는 `occurredAt`(효력 시각)과 `recordedAt`(기록 시각)을 따로 가진다(09 §3.2). 늦게 들어온 외부 관찰은 과거 seq에 끼워 넣지 않고 현재 seq에 기록하되 `occurredAt`을 원래 시각으로 둔다(helm-canon-2 §1.8).
- 기한(`dueAt`, `expiresAt`, `checkAt`)은 항상 절대 시각(ms)으로 저장한다. 상대 시간("2시간 뒤")은 기록 시점에 절대 시각으로 바꾼다. 재시작 뒤에도 같은 시각에 깨어나게 하기 위해서다(mastra-review §9 "절대 시각 기반 sleepUntil") [원문].

#### 3.3.2 행위자 문법 [근거: 브리프 §3.3 공통 계약 / 확정: 이 문서]

```text
ActorRef = "human"
         | "agent:" AgentRole
         | "runtime" | "kernel" | "scheduler"
         | "external:" ExternalName
         | "migration"
AgentRole    = "work" | "verifier" | "mediator" | "observer" | "router" | "branch"
ExternalName = [a-z0-9][a-z0-9._@-]{0,62}
```

| 행위자 | 뜻 | 대표 예 |
|---|---|---|
| `human` | 제품 소유자 한 명. 결정 24에 따라 사람 행위자는 하나다 | 합의 확인, 결과 확인, Goal 수정 확정, 질문 답 |
| `agent:work` | 작업 에이전트. Concern·WorkUnit의 일을 한다 | 추측·가능성·합의 초안 제안, 결과 제출 |
| `agent:verifier` | 검증 에이전트. 새 컨텍스트, 가능하면 다른 모델 (v0.3 08 §9) | 반대 근거 제안, 증언(attest) |
| `agent:mediator` | 중재자. 질문 전달 시점과 묶음 (v0.3 06 §3.7) | `question.delivery_planned` |
| `agent:observer` | 관찰 에이전트. 쓰기 권한 없음 (브리프 §6) | 정책·절차 수정안 제안 |
| `agent:router` | 모드 라우터 (v0.3 07 §5) | 모드 배정 |
| `agent:branch` | 발산 가지·자극 생성 등 하위 호출 (`spawn`으로 생긴 실행) | 가능성 후보, 자극 후보 |
| `runtime` | Helm 런타임 코드(모델 아님) | 도구 결과를 관찰로 기록, 실행 시작·종료 |
| `kernel` | 커널이 규칙으로 만든 파생 이벤트 | 판단 승격, 낡음 전파, 가정 확정, 정책 적용 |
| `scheduler` | 타이머 | 기대 기한 초과, 예측 확인일 도래, 합의 만료 |
| `external:<name>` | 외부 행위자. 관찰의 출처로만 등장한다 | 메일 답장한 리뷰어 |
| `migration` | 가져오기·마이그레이션 | 이전 JSONL 가져오기(선택 기능, 09 §3.13.4) |

규칙:

1. 행위자 문자열은 인증 신원이 아니다(helm-canon-2 §1.8). 사람의 명령은 `via`(기기 id 또는 로컬 CLI)로, 에이전트의 제안은 `via.runId`로 실제 출처를 함께 기록한다. 커널은 `human` 문자열이 아니라 인증된 `via`로 사람 여부를 판단한다(10 소유, 18 인증).
2. `external:*`는 이벤트를 만드는 행위자가 될 수 없다. 외부 응답은 런타임(메일 읽기 도구)이나 사람(대신 전함)이 관찰로 기록하고, 관찰의 `source.actor`에 외부 행위자를 적는다.
3. 같은 역할의 에이전트가 여러 실행에 동시에 있을 수 있다. 개별 실행은 `rn` ID로 구분한다.

```ts
// @helm/domain/src/actor.ts
export const AGENT_ROLES = ["work", "verifier", "mediator", "observer", "router", "branch"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];
export const AgentRoleSchema = Enum(AGENT_ROLES);

export const ACTOR_PATTERN =
  "^(human|runtime|kernel|scheduler|migration|agent:(work|verifier|mediator|observer|router|branch)|external:[a-z0-9][a-z0-9._@-]{0,62})$";
export type ActorRef =
  | "human" | "runtime" | "kernel" | "scheduler" | "migration"
  | `agent:${AgentRole}` | `external:${string}`;
export const ActorRefSchema = Type.Unsafe<ActorRef>(Type.String({ pattern: ACTOR_PATTERN }));
export const AgentActorSchema = Type.Unsafe<`agent:${AgentRole}`>(
  Type.String({ pattern: "^agent:(work|verifier|mediator|observer|router|branch)$" }),
);
export const ExternalActorSchema = Type.Unsafe<`external:${string}`>(
  Type.String({ pattern: "^external:[a-z0-9][a-z0-9._@-]{0,62}$" }),
);

/** 행위자의 실제 출처. 이벤트 envelope의 via 필드와 같은 타입 */
export const Via = Type.Union([
  Type.Object({
    kind: Type.Literal("device"), deviceId: DeviceId,
    listener: Type.Optional(Enum(["tailnet", "loopback", "local"])),   // 19 ListenerKind (판정 §2)
    connectionId: Type.Optional(Id("cx")),                                                                         // 18·19
  }, { additionalProperties: false }),
  /** interactive: 대화형 연결의 종류([판정 J-135], 18 §3.5 규칙 6). null은 비대화 localAdmin(스크립트, 타이머, SSH 발급)이다 */
  Type.Object({ kind: Type.Literal("local_cli"), uid: Type.Integer({ minimum: 0 }), interactive: Nullable(Enum(["tui", "tty_cli"])) }, { additionalProperties: false }),
  /** 실행(rn)이 아닌 보조 프로세스. 1차는 관찰 에이전트 프로세스 (16) */
  Type.Object({ kind: Type.Literal("process"), name: Type.Literal("observer"), pid: Type.Optional(Type.Integer()) }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal("run"), runId: RunId, toolCallId: Type.Optional(ToolCallId),
    /** 실행 시도 번호 (12). 펜싱은 ownerEpoch와 attempt를 함께 비교한다 */
    attempt: Type.Optional(Type.Integer({ minimum: 1 })),
  }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("system") }, { additionalProperties: false }),
]);
export type Via = Static<typeof Via>;
```

`local_cli`는 서버에서 관리 CLI(`@helm/cli`)를 실행한 경우다. Node에는 소켓 피어 uid를 읽는 기본 API가 없으므로(18 §3) 근거는 소켓 파일 권한(소유자만 접근)이다. `uid`는 데몬 자신의 uid를 적는다. 인정 조건은 18이 정한다. `interactive`는 대화형 연결이면 `tui` 또는 `tty_cli`이고, 비대화형이면 `null`이다. 사람 결정은 대화형 연결에서만 받는다([판정 J-135]).

#### 3.3.3 능력 두 층 [결정 4]

```ts
// @helm/domain/src/capability.ts
export const PRIMITIVES = ["read", "write", "execute", "send", "spawn", "ask"] as const;
export type Primitive = (typeof PRIMITIVES)[number];
export const PrimitiveSchema = Enum(PRIMITIVES);

export const RECORD_CAPABILITIES = ["observe", "propose", "attest", "accept", "integrate"] as const;
export type RecordCapability = (typeof RECORD_CAPABILITIES)[number];
export const RecordCapabilitySchema = Enum(RECORD_CAPABILITIES);
```

#### 3.3.4 능력표 A (고정 데이터)

v0.3 07 §2.4 표를 데이터로 옮긴다. 이 표는 상황과 무관한 A다. 상황 조건(P)은 10이 정책으로 덧붙인다. 커널은 이 표를 읽어 "자격" 거부를 판정한다(§3.23).

```ts
// @helm/domain/src/capability-table.ts
export type ProposalKind =
  | "interpretation" | "possibility" | "assumption" | "open_question" | "check"
  | "promotion" | "choice" | "agreement" | "agreement_scope_change" | "result"
  | "question" | "expectation" | "prediction" | "loop_plan" | "loop_plan_draft" | "loop_transition"
  | "situation" | "structure_change" | "mode" | "probe" | "stimulus"
  | "preference_criterion" | "reflection" | "obligation" | "counter_evidence"
  | "goal" | "goal_revision" | "delivery_plan" | "policy_proposal" | "procedure_candidate"
  | "concern" | "workunit" | "inquiry" | "annotation";

export interface CapabilityRow {
  primitives: readonly Primitive[];
  record: readonly RecordCapability[];
  /** propose가 있을 때 허용되는 제안 종류. "all"은 제한 없음 */
  proposeKinds: readonly ProposalKind[] | "all";
}

export const ALL_PROPOSAL_KINDS: readonly ProposalKind[] = [/* 위 union의 모든 값 */];
const WORK_AGENT_KINDS = ALL_PROPOSAL_KINDS.filter(
  (k) => !["delivery_plan", "policy_proposal", "procedure_candidate", "mode"].includes(k),
);

export const CAPABILITY_TABLE: Readonly<Record<
  "human" | `agent:${AgentRole}` | "runtime" | "kernel" | "scheduler" | "migration",
  CapabilityRow
>> = {
  "human":          { primitives: ["read", "write", "execute", "send", "spawn"], record: ["observe", "propose", "attest", "accept", "integrate"], proposeKinds: "all" },
  "agent:work":     { primitives: ["read", "write", "execute", "send", "spawn", "ask"], record: ["observe", "propose"], proposeKinds: WORK_AGENT_KINDS },
  "agent:verifier": { primitives: ["read", "execute", "spawn", "ask"], record: ["observe", "propose", "attest"], proposeKinds: ["counter_evidence", "check", "annotation", "question"] },
  "agent:mediator": { primitives: ["read"], record: ["observe", "propose"], proposeKinds: ["delivery_plan"] },
  "agent:observer": { primitives: ["read", "spawn"], record: ["observe", "propose"], proposeKinds: ["policy_proposal", "procedure_candidate", "annotation"] },
  "agent:router":   { primitives: ["read"], record: ["observe", "propose"], proposeKinds: ["mode"] },
  "agent:branch":   { primitives: ["read", "spawn"], record: ["observe", "propose"], proposeKinds: ["possibility", "stimulus", "interpretation", "prediction"] },
  /** declaredBy가 있는 제출은 그 run 역할의 행으로 검사한다 (10 §3.3.2) */
  "runtime":        { primitives: [], record: ["observe"], proposeKinds: [] },
  /** 코드 규칙만으로 정한 구조 결정 (14 rule, 10 decidedBy kernel) */
  "kernel":         { primitives: [], record: ["observe", "propose", "integrate"],
                      proposeKinds: ["loop_plan", "loop_transition", "situation", "structure_change", "mode", "concern", "question", "workunit", "obligation"] },
  "scheduler":      { primitives: [], record: ["observe"], proposeKinds: [] },
  "migration":      { primitives: [], record: ["observe", "propose"], proposeKinds: ["choice"] },
};
```

`runtime` 행위자가 `declaredBy`(모델 선언을 반영한 run id. envelope에는 `via = { kind: "run", runId }`로 남는다)와 함께 낸 구조 명령은 그 run 역할의 행으로 검사하고, 만들어진 레코드의 `Autonomy.decidedBy`는 그 역할이다(10 K-13). `declaredBy` 없이 코드 규칙으로 정한 것은 `kernel` 행으로 검사한다. `agent:work`는 `delivery_plan`, `policy_proposal`, `procedure_candidate`, `mode`를 뺀 모든 종류를 제안할 수 있다. `goal`, `goal_revision`, `agreement`, `result`, `choice`(혼자 정한 결정)는 제안할 수 있지만 확정은 사람(accept)이나 정책이 한다. `ProposalKind`의 이름과 명령의 대응은 10이 정한다. `loop_plan_draft`(계획 플래그와 모델 계획 초안)는 작업 에이전트가 낸다. 모델이 계획 전체를 쓰는 것은 다이얼 `planAuthoring`이 허용할 때뿐이다([판정 J-188]).

표의 근거와 해석:

| 행 | 근거 | 비고 |
|---|---|---|
| 사람의 `ask` 없음 | v0.3 07 §2.4 사람 ask "-" | 사람이 사람에게 묻는 기록은 없다 |
| 작업 에이전트 accept·attest·integrate 없음 | A6, 대화 L3250–3257 능력표 | integrate는 v0.3 07 §2.3 "반영 완료 표시". 반영 항목을 닫는 것은 사람이나 커널(근거 관찰이 있을 때)만 한다. [제안] 대화 21(d) d9 "integrate의 소유자 미정"을 이렇게 정한다 |
| 검증 에이전트 write·send 없음, propose는 반대 근거만 | 대화 L3257 정정 | `counter_evidence`, `check`, `annotation`만 |
| 중재자 read는 질문·사용자 상태만 | v0.3 07 §2.4 | 읽기 범위 제한은 투영(12)이 집행한다 |
| `runtime`·`kernel`·`scheduler`의 observe | v0.3 07 §2.3 "실제 생성은 런타임이 하며, 행위자는 출처가 됨" | 모델 행위자는 관찰을 직접 만들 수 없다(R-06) |
| `kernel`의 integrate | 반영 항목 중 "관련 테스트 통과" 같이 관찰로 확인되는 것은 커널이 닫는다 | §3.22.6 |

능력표에 없는 것: 같은 결과를 만든 행위자의 증언 금지, 합의 범위 안에서만 write 같은 상황 조건은 P다(대화 L3286–3298). P는 10이 정한다. 그 판정에 필요한 데이터(결과 작성자 `producerRuns`, 합의 범위)는 이 문서의 레코드에 있다.

### 3.4 공통 타입

#### 3.4.1 스키마 도우미

```ts
// @helm/domain/src/schema.ts  (다른 domain 파일을 import하지 않는다. 순환 import를 막기 위해 도우미와 공용 열거는 이 파일과 enums.ts에만 둔다)
import { Type, type TSchema, type TObject, type TLiteral, type TUnion, type TProperties } from "typebox";
export const Obj = <P extends TProperties>(props: P) =>
  Type.Object(props, { additionalProperties: false });
export const Nullable = <T extends TSchema>(t: T) => Type.Union([t, Type.Null()]);
/**
 * 문자열·숫자 열거. 배열을 .map(Type.Literal)로 바꾸면 Static 타입이 never가 되므로 [실험],
 * 열거는 모두 이 도우미로 쓴다. 튜플 타입을 그대로 받아 리터럴 유니온을 만든다.
 */
export const Enum = <const T extends readonly (string | number)[]>(values: T) =>
  Type.Union(values.map((v) => Type.Literal(v)) as unknown as { -readonly [K in keyof T]: TLiteral<T[K]> });
/**
 * 닫힌 객체 둘을 합친다. Type.Intersect([닫힌 객체, 닫힌 객체])는 어떤 값도 통과하지 못하므로 [실험] 쓰지 않는다.
 * TypeBox 1.x에는 Composite가 없어 속성을 펼쳐 새 닫힌 객체를 만든다.
 */
export const Merge = <A extends TProperties, B extends TProperties>(a: TObject<A>, b: TObject<B>) =>
  Obj({ ...a.properties, ...b.properties } as A & B);
/** 닫힌 객체 하나와 닫힌 객체 유니온을 합친다: 유니온의 변형마다 Merge */
export const MergeEach = <A extends TProperties, U extends TObject[]>(base: TObject<A>, union: TUnion<U>) =>
  Type.Union(union.anyOf.map((v) => Merge(base, v)) as unknown as { [K in keyof U]: TObject<A & U[K]["properties"]> });
/** 화면에 보이는 한 줄 */
export const Title = Type.String({ minLength: 1, maxLength: 200 });
/** 서술. 긴 원문은 blob으로 둔다(§3.4.7) */
export const Text = Type.String({ minLength: 1, maxLength: 4000 });
export const ShortText = Type.String({ minLength: 1, maxLength: 500 });
export const Grade = Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]);
export const Plane = Enum(["N", "E", "M", "A", "P"]);
/** 이벤트 seq. 1부터 시작하는 전역 단조 정수 (09 §3.2) */
export const Seq = Type.Integer({ minimum: 1 });
/** 어느 레코드의 어느 판을 보고 결정했는가. 낙관적 동시성에 쓴다 (09 §3.9.4) */
export const RevisionRef = Obj({ id: AnyRecordId, revisionSeq: Seq });
```

- 텍스트 길이 상한을 넘는 입력은 거부하지 않고 앞부분만 남긴 뒤 원문을 blob에 두고 `RecordMeta.textOverflow`에 적는다. 거부하면 사람 입력이 사라지기 때문이다. 자르기는 명령을 받는 쪽(10)이 스키마 검사 전에 한다.
- 빈 문자열은 허용하지 않는다(`minLength: 1`). 내용이 비어 있지 않아도 뜻이 없는 입력(`ㅇ`, `ㅁㄴㅇ`)은 스키마로 막지 않는다. 그런 입력은 품질 단계가 `qualified`로 올라가지 못하게 해서 다룬다(§3.21, helm-canon-2 §1.10 "language heuristic만으로 사람 입력을 삭제·거부하지 않음").

#### 3.4.2 레코드 메타

```ts
export const RecordMeta = Obj({
  id: AnyRecordId,
  plane: Plane,
  /** 소속 프로젝트. 프로젝트와 무관한 전역 레코드(Device, Lens, 전역 PolicyProposal)는 null */
  projectId: Nullable(ProjectId),
  createdSeq: Seq,
  createdAt: Ms,
  createdBy: ActorRefSchema,
  createdVia: Via,
  /**
   * 사람 판단에 영향을 주는 변경을 마지막으로 한 이벤트의 seq (19·20의 revisionSeq와 같은 값).
   * 전달·표시 같은 운영성 이벤트는 올리지 않는다 (09 EVENT_META.bumpsRevision). 낙관적 동시성의 기준
   */
  revisionSeq: Seq,
  /** revisionSeq가 바뀐 횟수 + 1 (1부터). 화면 표시와 19 RecordRef.revision에 쓴다. 비교는 revisionSeq로 한다 */
  revision: Type.Integer({ minimum: 1 }),
  /** 이 레코드를 마지막으로 바꾼 이벤트의 seq (모든 변경). 투영 디버깅·증분 조회용 */
  lastSeq: Seq,
  updatedAt: Ms,
  /** 길이 상한을 넘은 텍스트 필드의 원문 (§3.4.1). 레코드 필드에는 앞부분만 남는다 */
  textOverflow: Type.Array(Obj({ field: Type.String({ minLength: 1 }), blob: BlobRef })),
});
export type RecordMeta = Static<typeof RecordMeta>;
```

모든 레코드 타입은 `RecordMeta`의 필드, 자기 `kind` 리터럴, `*Core` 필드, 상태 필드를 가진다. 아래 레코드 스키마에서는 `...Meta`로 줄여 적는다.

```ts
const Meta = RecordMeta.properties;
```

#### 3.4.3 품질 상태 [제안: D08-3]

```ts
// @helm/domain/src/quality.ts
export const QualityLevel = Type.Union([
  Type.Literal("captured"),   // 원시 입력은 있으나 의미 필드가 비었거나 해석되지 않음
  Type.Literal("structural"), // 스키마와 참조 무결성을 갖춤
  Type.Literal("qualified"),  // 타입별 자격 근거가 갖춰짐 (§3.21.2)
  Type.Literal("accepted"),   // 권한 있는 주체나 정책이 기준선으로 받아들임
]);
export const StaleReason = Type.Union([
  Type.Literal("material_changed"),      // 참조한 M의 해시가 바뀜
  Type.Literal("evidence_stale"),        // 근거로 쓴 관찰·판단이 낡음
  Type.Literal("goal_revised"),          // 기대던 Goal 버전이 바뀜
  Type.Literal("agreement_renegotiated"),// 기대던 합의 개정판이 바뀜
  Type.Literal("assumption_invalidated"),
  Type.Literal("preference_changed"),    // 선호 모델 기준이 바뀜
  Type.Literal("review_trigger_fired"),  // 다시 볼 조건 충족
  Type.Literal("validity_expired"),      // 유효 기간 끝
]);
export const Quality = Obj({
  level: QualityLevel,
  /** 열린 이의(ct)와 해소되지 않은 반대 근거 관찰(ob)의 id */
  contestedBy: Type.Array(IdAny("ct", "ob")),
  stale: Nullable(Obj({ reason: StaleReason, causeRef: Type.String({ minLength: 1 }), sinceSeq: Seq })),
  supersededBy: Nullable(AnyRecordId),
  /** 혼자 정한 결정을 사람이 보고 확인함 (decision.confirmed, 10·11). 상태는 바꾸지 않는다. Autonomy가 있는 레코드만 */
  confirmedSeq: Nullable(Seq),
});
export type Quality = Static<typeof Quality>;

/** 화면 표시용 하나의 값. superseded > contested > stale > level */
export type QualityDisplay = "superseded" | "contested" | "stale" | Static<typeof QualityLevel>;
export declare function qualityDisplay(q: Quality): QualityDisplay;
```

- `absent`(기록 없음)는 레코드의 상태가 아니다. 투영에서 "있어야 할 레코드가 없음"(예: Goal 없음, 활성 선택 없음)을 표시할 때만 쓴다(09 §3.11 `p_attention`).
- 품질 상태를 바꾸는 이벤트는 §3.21에 있다. 품질 상태는 덮어쓰지 않고 이벤트로만 바뀐다(대화 L2722).

#### 3.4.4 다시 볼 조건과 기한 트리거

```ts
// @helm/domain/src/triggers.ts
/** 커널·스케줄러가 기계적으로 판정할 수 있는 조건. label은 사람에게 보이는 문장 */
/** 작업 경계 (11 WorkBoundaryKind, 14 확정) */
export const WorkBoundaryKind = Enum(["round_end", "workunit_end", "loop_transition", "concern_waiting", "user_return",
  "review_window", "daily_rollover"]);
export const Trigger = Type.Union([
  Obj({ kind: Type.Literal("at"), at: Ms, label: ShortText }),
  Obj({ kind: Type.Literal("before_loop"), loop: LoopIdSchema, label: ShortText }),
  /** resources가 있으면 그 자원에 처음 그 동작을 하기 전 (11 §3.6.2). 패턴 문법은 13 ResourcePattern */
  Obj({ kind: Type.Literal("before_primitive"), primitive: PrimitiveSchema,
        resources: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 4096 }))), label: ShortText }),
  /** 작업 경계 n번째 (11 §3.6.2) */
  Obj({ kind: Type.Literal("boundary"), boundary: WorkBoundaryKind,
        count: Type.Integer({ minimum: 1 }), concernId: Nullable(ConcernId), label: ShortText }),
  Obj({
    kind: Type.Literal("record_state"), recordId: AnyRecordId,
    state: Type.String({ minLength: 1 }), label: ShortText,
  }),
  Obj({ kind: Type.Literal("record_changed"), recordId: AnyRecordId, label: ShortText }),
  /** 기계 판정이 안 되는 조건. 관찰 에이전트·검증 에이전트가 충족을 제안하고 커널이 기록한다.
   *  MVP에서는 사람이 "다시 보기"를 눌러 충족시킨다. 측정 지표 조건(observation_metric)의 자동 판정은 2단계로 둔다([판정 J-138]) */
  Obj({ kind: Type.Literal("manual"), label: ShortText }),
]);
export type Trigger = Static<typeof Trigger>;
```

쓰이는 곳: Choice·Finding·PreferenceModel의 `reviewTrigger`, Question의 `assumptionExpires`, Prediction의 `check`, Obligation의 `revisitTrigger`. `manual` 트리거만 있는 레코드는 시간이 지나도 자동으로 낡지 않으므로, 투영은 이를 "사람이 보는 조건"으로 따로 표시한다.

#### 3.4.5 혼자 정한 결정 표시 (Autonomy) [결정 8, 불변조건 7 / 구조: D08-4]

```ts
// @helm/domain/src/autonomy.ts
/** 정보 게이트의 세 조건 (v0.3 06 §2.1): 1 정책이 처리 못함, 2 결과가 실질적으로 바뀜, 3 지금 묻는 가치 > 주의 비용 */
export const GateCondition = Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3)]);

export const WhyNotAsked = Type.Union([
  /** 정보 게이트 조건 중 거짓인 것. 1이 거짓이면 policyRef 필수 */
  Obj({
    kind: Type.Literal("info_gate"),
    falseConditions: Type.Array(GateCondition, { minItems: 1, uniqueItems: true }),
    policyRef: Type.Optional(Type.String({ minLength: 1 })),
    note: ShortText,
  }),
  /** 질문의 가정 만료점까지 답이 없어 임시 가정을 확정함 (v0.3 06 §3.6) */
  Obj({ kind: Type.Literal("assumption_expired"), questionId: QuestionId }),
  /** 사람이 미리 맡겨 둔 권한 안 (§3.11.2) */
  Obj({ kind: Type.Literal("within_grant"), grantId: GrantId }),
  /** 비상 합의 (혼돈 상황, v0.3 03 §3.3) */
  Obj({ kind: Type.Literal("emergency"), grantId: GrantId }),
  /** 자동으로 검증할 수 있는 선택은 에이전트가 정한다 (대화 L3403) */
  Obj({ kind: Type.Literal("auto_verifiable"), verification: Type.Array(ObservationId, { minItems: 1 }) }),
  /** 사람이 질문에 "맡긴다"고 답함 (03·05·19 question.delegate) */
  Obj({ kind: Type.Literal("delegated_by_human"), questionId: QuestionId }),
  /** 데이터로 둔 규칙(루프 계약, 기본 조합)이 정함 (14 structural_default). 규칙 id는 14 */
  Obj({ kind: Type.Literal("rule"), ruleId: Type.String({ minLength: 1, maxLength: 64 }), note: Nullable(ShortText) }),
]);
export type WhyNotAsked = Static<typeof WhyNotAsked>;

export const HumanDecision = Obj({
  autonomous: Type.Literal(false),
  decidedBy: Type.Literal("human"),
  /** 질문에 답해서 정한 경우 */
  viaQuestion: Type.Optional(QuestionId),
});
export const AutonomousDecision = Obj({
  autonomous: Type.Literal(true),
  decidedBy: Type.Union([AgentActorSchema, Type.Literal("kernel"), Type.Literal("scheduler")]),
  whyNotAsked: WhyNotAsked,
  /** 결정 종류 레지스트리 키 (11 §3.3.3). 16 지표가 쓴다 */
  decisionKind: Type.String({ pattern: "^[a-z][a-z0-9_.]{1,63}$" }),
  /** 같은 결정점을 식별하는 키. 이의가 걸린 결정점에 이의 뒤 다시 혼자 정하지 않는다 (10 PT-13, 11 §3.10) */
  decisionPointKey: Type.String({ minLength: 1, maxLength: 200 }),
});
export const Autonomy = Type.Union([HumanDecision, AutonomousDecision]);
export type Autonomy = Static<typeof Autonomy>;
```

규칙:

1. `Autonomy`를 가지는 레코드: Choice(`ch`), LoopPlan(`lp`), LoopTransition(`lt`), SituationAssessment(`sa`), StructureChange(`sc`), ModeAssignment(`md`). v0.3 06 §4.2의 "혼자 정한 결정에 포함되는 것" 여섯 종류다. 질문의 가정 확정은 Choice(`whyNotAsked.kind = "assumption_expired"`)로 남는다. 정렬(§10)에서 10·11의 요구로 레코드 안의 결정 블록 다섯 곳을 더했다: Grant로 한 합의 활성화(`Activation.grant.autonomy`), 범위 줄이기(`Agreement.narrowedScope.autonomy`), 탐침 판정(`Probe.outcome.autonomy`), 지속 관찰 판정(`Watch.verdict.autonomy`), 질문 전달 계획(`Question.plannedDelivery.autonomy`). 이것들도 이의 대상이다.
2. 이 레코드들은 모두 이의 대상이다. `contestable` 필드를 따로 두지 않는다. 이의를 막는 예외가 타입에 없다는 것이 불변조건 7의 타입 수준 표현이다.
3. 권리 게이트 결정은 autonomous가 될 수 없다(§3.10 Choice 스키마의 두 변형). 권리 게이트의 판별은 권한 레이어(돈, 대리 발언, 외부 영향)와 Helm(Goal 변경, 결과 확인)이 한다(v0.3 06 §3.2).

사람 결정의 조작 메타(01 `HumanDecisionOp`, 16 §5.2. 01의 `onNormalPath`는 이름을 `followedRecommendation`으로 바꿨다, J-76): 별도 레코드를 두지 않는다. 사람 결정 이벤트(`question.answered`, `agreement.confirmed`, `acceptance.recorded`, 사람의 `choice.committed`, `objection.filed`, `policy_proposal.accepted`·`dismissed`)의 payload에 선택 필드로 싣는다.

```ts
export const HumanOpMeta = Obj({
  /** 질문·초안의 추천을 그대로 따랐는가 (화면의 추천 버튼). 01의 C/A "정상 경로"는 이벤트 종류로 계산하며 이 값과 다르다 (판정 J-76) */
  followedRecommendation: Type.Boolean(),
  /** 사람이 덧붙인 이유 (선택) */
  extraReason: Nullable(ShortText),
  /** 사람이 초안을 고쳐서 냈는가. 고친 내용은 이벤트 payload 본문에 있다 */
  editedDraft: Type.Boolean(),
});
```

#### 3.4.6 실제(M) 참조

```ts
// @helm/domain/src/material.ts
export const Sha256 = Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
export const MaterialRef = Type.Union([
  Obj({ kind: Type.Literal("file"), projectId: ProjectId, path: Type.String({ minLength: 1 }),
        contentHash: Nullable(Sha256), gitCommit: Type.Optional(Type.String({ pattern: "^[0-9a-f]{7,64}$" })) }),
  Obj({ kind: Type.Literal("git_commit"), projectId: ProjectId, repoPath: Type.String({ minLength: 1 }),
        commit: Type.String({ pattern: "^[0-9a-f]{7,64}$" }) }),
  Obj({ kind: Type.Literal("url"), url: Type.String({ minLength: 1, maxLength: 2048 }),
        retrievedHash: Nullable(Sha256) }),
  Obj({ kind: Type.Literal("blob"), hash: Sha256 }),
  Obj({ kind: Type.Literal("external"), system: Type.String({ minLength: 1 }), externalId: Type.String({ minLength: 1 }) }),
]);
export type MaterialRef = Static<typeof MaterialRef>;
```

- M은 복사하지 않고 참조한다(대화 L2191, L2723). 파일은 경로와 그 시점 내용 해시를 함께 둔다. `contentHash`가 `null`이면 그 관찰은 해시 기반 낡음 판정을 받을 수 없으며, 투영은 이를 "확인 불가"로 표시한다.
- 경로는 프로젝트 루트 기준 상대 경로다. 프로젝트 루트 밖 경로는 `kind: "external"`로 적는다.

#### 3.4.7 blob 참조

```ts
export const BlobRef = Obj({
  /** 19·20이 내려받기에 쓰는 id. 같은 내용이면 같은 id (blobs 행의 id) */
  blobId: Id("bl"),
  hash: Sha256,
  bytes: Type.Integer({ minimum: 0 }),
  mediaType: Type.String({ minLength: 1, maxLength: 127 }),
  /** 앞부분 미리보기. 이벤트 envelope에 그대로 들어가므로 짧게 */
  preview: Type.Optional(Type.String({ maxLength: 500 })),
});
export type BlobRef = Static<typeof BlobRef>;
```

- 19의 BlobRef(`sha256` 접두사 없는 hex, `size`)와 20의 BlobRef(`mime`)는 이 타입의 프로토콜·앱 표현이다. 변환은 19가 한다.
- 긴 텍스트(도구 출력 전문, 모델 메시지 본문, 자극 이미지, 도구 인자)는 blob에 두고 레코드와 이벤트에는 `BlobRef`만 둔다. 저장 방식과 보존은 09 §3.12.
- 비밀 값이 blob에 들어갈 수 있으므로, 관찰을 기록하기 전에 런타임이 비밀 패턴을 가린다(12·13 소유. helm-kernel-v02 `context.mjs`의 SECRET_KEY 정규식이 출발점이다 [원문]).

#### 3.4.8 관계(Link) [제안: D08-9]

```ts
// @helm/domain/src/link.ts
export const LinkRel = Type.Union([
  // 근거 관계 (foundations/02 §3)
  Type.Literal("supports"), Type.Literal("challenges"), Type.Literal("qualifies"), Type.Literal("invalidates"),
  // 시간 관계 (foundations/01 §6)
  Type.Literal("supersedes"), Type.Literal("reopens"), Type.Literal("derived_from"),
  // 구조 관계
  Type.Literal("belongs_to"), Type.Literal("child_of"), Type.Literal("split_from"), Type.Literal("merged_into"),
  // N–E–M 관계
  Type.Literal("justifies"),   // E → N (선택의 근거)
  Type.Literal("authorizes"),  // N → 실행 (합의 → WorkUnit·ToolCall)
  Type.Literal("fulfills"),    // 결과 → 기준
  Type.Literal("reveals"),     // 반응 관찰 → 선호 기준
  Type.Literal("depends_on"),  // 낡음 전파 경로 (§3.21.3)
  Type.Literal("answers"),     // 답 → 질문
  Type.Literal("contests"),    // 이의 → 대상
]);
export const Link = Obj({
  from: AnyRecordId,
  to: AnyRecordId,
  rel: LinkRel,
  createdSeq: Seq,
  createdBy: ActorRefSchema,
  /** 이 관계를 세운 근거. 선택 사항이지만 supports/challenges에는 note를 권한다 */
  note: Type.Optional(ShortText),
});
export type Link = Static<typeof Link>;
```

관계의 근거(`note`)는 선택이다. 관계 대부분은 레코드 필드(`basis`, `evidence`, `reworkOf` 등)에서 파생되어 그 레코드와 이벤트가 근거이기 때문이다. 근거 링크(`supports`·`challenges`)를 사람이나 에이전트가 따로 걸 때는 `claim.evidence_linked`에 이유를 남긴다.

F01 §5 핵심 관계 13(helm-canon §7.8)과의 대응:

| F01 관계 | 08 표현 |
|---|---|
| Purpose frames Concern | Concern.goalId (Goal = Purpose) |
| Concern is_interpreted_as ProblemFrame | `concern.reframed` + 같은 트랜잭션의 Choice(문제 관점), Concern.frameChoiceId |
| ProblemFrame generates Hypothesis | Possibility.origin(관점·칸) |
| Hypothesis predicts Claim | Possibility의 `ifTrue`·DiscriminatingCheck 예측 라벨 |
| Evidence supports/challenges Claim | `supports`, `challenges`, `qualifies`, `invalidates` |
| Claim informs Decision | `justifies` (Choice.basis) |
| Decision authorizes DelegationContract | Choice.implementedBy, `authorizes` |
| Actor undertakes Commitment | Agreement.performer, Activation |
| Commitment is_executed_by WorkUnit | WorkUnit.agreementId, `authorizes` |
| WorkUnit changes Artifact | ResultSubmission.materialChanges (MaterialRef) |
| Outcome satisfies/fails Commitment | `fulfills`, Acceptance.decision |
| Integration aligns Outcome + Purpose + System | Integration과 반영 항목(Obligation) |
| Reflection revises Frame/Policy/Model | Reflection.nextAgreementChange, `derived_from` |

링크는 레코드를 만들 때 함께 생기거나(`basis`, `evidence` 필드에서 파생) 별도 이벤트로 생긴다(`claim.evidence_linked`). 링크 투영 테이블은 09 §3.11의 `p_links`다. 링크를 지우는 이벤트는 없다. 잘못 건 링크는 `invalidates` 관계의 새 링크나 이의로 다룬다(foundations/01 §6 "삭제는 의미적 폐기").

### 3.5 Project, Goal

#### 3.5.1 Project [제안: D08-7]

데몬 하나가 여러 프로젝트를 다룬다. 프로젝트는 Goal의 묶음이며, 도구가 접근할 수 있는 폴더와 관찰 에이전트가 읽을 세션 로그 폴더를 정한다(결정 35).

```ts
// @helm/domain/src/records/project.ts
export const ProjectCore = Obj({
  name: Title,
  slug: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,62}$" }),
  /** 절대 경로. 도구의 기본 작업 범위 후보. 실제 허용 범위는 작업 합의와 13이 정한다 */
  rootPaths: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  /** 이 프로젝트에서 외부 에이전트 세션 로그를 관찰할지 (결정 35). 대상은 세션 cwd가 rootPaths 아래인 세션이고,
   *  로그 위치는 런타임별 홈 폴더다 (판정 J-08, 16). Mac에서 연 세션은 서버에 로그가 없으므로 대상 밖이다 (한계) */
  observeExternalSessions: Type.Boolean(),
  /** 런타임별 세션 로그 위치를 기본값과 다르게 둘 때만 */
  sessionLogRootOverride: Nullable(Type.String({ minLength: 1 })),
});
export const ProjectStatus = Type.Union([Type.Literal("active"), Type.Literal("archived")]);
export const Project = Obj({
  ...Meta, kind: Type.Literal("project"), ...ProjectCore.properties, status: ProjectStatus,
  /** 프로젝트를 만들 때 함께 만드는 자리표시 Goal("이름 없는 Goal")과 가벼운 작업 보관 Concern (01 §3.6.4, 14) */
  placeholderGoalId: GoalId,
  lightWorkConcernId: ConcernId,
});
```

- `Project.projectId`(RecordMeta)는 자기 자신의 id다.
- 프로젝트 경로는 `~/projects/<제품>/code/...` 같은 Syncthing 동기화 폴더일 수 있다. Helm의 DB는 이 경로에 두지 않는다(09 §3.6.1, 17 §3.2).

#### 3.5.2 Goal [결정 11 / 필드·상태: 제안]

Goal은 프로젝트 단위의 궁극 목표이며 Concern 사이클을 거치며 정제된다. Goal은 버전을 가진다(F10 C7 "versioned normative entity").

```ts
// @helm/domain/src/records/goal.ts
export const GoalContent = Obj({
  statement: Text,                                                   // 이루려는 것
  successConditions: Type.Array(ShortText, { minItems: 1 }),          // 무엇이 되면 이뤄졌다고 보는가
  preservationConstraints: Type.Array(ShortText),                     // 잃으면 안 되는 것
  nonGoals: Type.Array(ShortText),
});
export const GoalCore = Obj({
  projectId: ProjectId,
  parentGoalId: Nullable(GoalId),
  content: GoalContent,
  /** 프로젝트마다 하나 있는 자리표시 Goal("이름 없는 Goal"). 사람 확인 없이 만들어지며 실제 Goal로 정제되면 superseded */
  placeholder: Type.Boolean(),
});
export const GoalStatus = Type.Union([
  Type.Literal("proposed"), Type.Literal("active"), Type.Literal("paused"),
  Type.Literal("achievement_claimed"), Type.Literal("achieved"),
  Type.Literal("superseded"), Type.Literal("retired"),
]);
export const GoalRevisionDraft = Obj({
  content: GoalContent,
  /** 수정의 계기. Concern과 그 안의 관찰·반응·판단 */
  basis: Obj({ concernId: Nullable(ConcernId), refs: Type.Array(EvidenceRecordId, { minItems: 1 }) }),
  reason: ShortText,
  proposedBy: ActorRefSchema,
  proposedSeq: Seq,
  questionId: QuestionId, // Goal 수정은 권리 게이트 질문으로 사람에게 간다
});
export const Goal = Obj({
  ...Meta,
  kind: Type.Literal("goal"),
  ...GoalCore.properties,
  /** 현재 확정된 내용의 버전. activate 때 1 */
  goalVersion: Type.Integer({ minimum: 0 }),
  status: GoalStatus,
  pendingRevision: Nullable(GoalRevisionDraft),
  preferenceModelIds: Type.Array(PreferenceModelId),
  quality: Quality,
});

/** 버전 이력 한 행. 투영 테이블 p_goal_versions (09 §3.11) */
export const GoalVersion = Obj({
  goalId: GoalId,
  goalVersion: Type.Integer({ minimum: 1 }),
  content: GoalContent,
  changedSeq: Seq,
  changedBy: Type.Literal("human"),
  basis: Nullable(GoalRevisionDraft.properties.basis),
  reason: Nullable(ShortText),
});
```

- 상태 기계: §3.22.1.
- 다른 레코드가 Goal에 기댈 때는 `{ goalId, goalVersion }`을 함께 저장한다(Agreement, Choice). Goal 버전이 오르면 이전 버전에 기댄 합의는 낡음(`goal_revised`)으로 표시되고 "다시 확인 대상"이 된다(v0.3 02 §3.3, 09 §4.8).
- Goal 변경 확정은 사람만 한다(의존 규칙 5, [제안]). 작은 문구 정제까지 사람 확인이 필요한지는 §7 미결 U-01.

```ts
export const GoalRef = Obj({ goalId: GoalId, goalVersion: Type.Integer({ minimum: 1 }) });
```

### 3.6 Concern, StructureChange, BoundaryItem

#### 3.6.1 Concern [결정 11 / 필드·상태: 제안]

Concern은 10단계 과정을 돌릴 후보가 되는 상황 그 자체다(문제, 기회, 위험, 불확실성, 취향 결정, 반복 마찰, 외부 요청 — v0.3 02 §4.1).

```ts
// @helm/domain/src/records/concern.ts
export const ConcernKind = Type.Union([
  Type.Literal("problem"), Type.Literal("opportunity"), Type.Literal("risk"),
  Type.Literal("uncertainty"), Type.Literal("taste"), Type.Literal("friction"),
  Type.Literal("external_request"),
  Type.Literal("light_work"),   // 프로젝트마다 하나. Helm 범주 밖 가벼운 작업의 WorkUnit을 모은다 (14)
  Type.Literal("gate_record"),  // 관문 기록 자리 ("Helm 사용 평가", 23 §3.5.3). 16 T6 평가 보고가 관찰로 붙고 G1 기록은 이 Concern의 결과 확인이다
]);
/** 진입 조건 신호 (대화 L2469–2477). 모델은 신호만 표시하고 진입 판정은 코드가 한다 (14) */
/** 01 §3.6.3 EC-1~5, 14가 쓰는 이름. "되돌리기 비쌈"은 결정 2로 빼고 취향 의존을 넣었다 */
export const EntrySignal = Type.Union([
  Type.Literal("goal_vague"),       // 완료 기준을 한 문장으로 못 씀
  Type.Literal("paths_diverge"),    // 원인·해법 후보가 둘 이상
  Type.Literal("taste_dependent"),  // 정답이 취향·반응에 달림
  Type.Literal("long_running"),     // 여러 세션·여러 날
  Type.Literal("entangled"),        // 다른 결정·작업에 영향
]);
export const ConcernOrigin = Type.Union([
  Obj({ kind: Type.Literal("human_start") }),                                    // 시작 시 직접
  Obj({ kind: Type.Literal("promoted_from_work"), runId: RunId, signals: Type.Array(ShortText, { minItems: 1 }) }), // 작업 중 신호
  Obj({ kind: Type.Literal("human_designated") }),                                // /focus 같은 직접 지정
  Obj({ kind: Type.Literal("observer"), policyProposalId: Nullable(PolicyProposalId) }), // UC-08
  Obj({ kind: Type.Literal("structure"), structureChangeId: StructureChangeId }), // S 루프가 만든 하위
]);
export const ConcernCore = Obj({
  goalId: GoalId,
  parentConcernId: Nullable(ConcernId),
  title: Title,
  /** 어떤 상황인가, 왜 다룰 가치가 있는가 */
  description: Text,
  concernKind: ConcernKind,
  origin: ConcernOrigin,
  entrySignals: Type.Array(EntrySignal, { uniqueItems: true }),
  /** 이 Concern의 도구 실행 기본 작업 루트 (12·13). 프로젝트 rootPaths 중 하나이거나 그 아래 */
  workspaceRoot: Nullable(Type.String({ minLength: 1 })),
});
export const ConcernStatus = Type.Union([
  Type.Literal("open"),       // 만들어짐, 아직 루프 활동 없음
  Type.Literal("active"),     // 진행 중 (다시 열림 포함)
  Type.Literal("held"),       // S.hold 보류
  Type.Literal("completed"),  // 완료: 결과 확인과 전체 반영까지 끝남 (의존 규칙 2)
  Type.Literal("closed"),     // 완료하지 않고 끝냄
  Type.Literal("merged"),     // S.merge로 다른 Concern에 합쳐짐
]);
export const Concern = Obj({
  ...Meta,
  kind: Type.Literal("concern"),
  ...ConcernCore.properties,
  status: ConcernStatus,
  /** 최신 루프 전환의 to. 루프 활동 전에는 null */
  currentLoop: Nullable(LoopIdSchema),
  loopPlanId: Nullable(LoopPlanId),
  situationAssessmentId: Nullable(AssessmentId),
  modeAssignmentId: Nullable(ModeAssignmentId),
  mergedInto: Nullable(ConcernId),
  /** 현재 문제 관점을 정한 선택 (재정의, A3). 처음에는 null */
  frameChoiceId: Nullable(ChoiceId),
  reopenCount: Type.Integer({ minimum: 0 }),
  lastReopen: Nullable(Obj({ seq: Seq, causeRef: AnyRecordId })),
});
```

- 저장 상태는 위 여섯이다. v0.3 02 §4.2의 "대기", "결과 확인 대기", "결과 확인됨"은 하위 레코드에서 계산하는 표시 상태다(09 §3.7이 정한 `@helm/store/src/views/concern-display.ts`의 함수가 계산). 저장 상태로 두면 하위 레코드와 어긋날 수 있기 때문이다.

```ts
/** 투영이 계산하는 표시 상태 (저장하지 않음). 우선순위 위에서 아래 */
export type ConcernDisplayStatus =
  | "merged" | "closed" | "completed" | "held"
  | "reopened"         // 다시 열린 뒤 아직 새 루프 활동 없음
  | "awaiting_review"  // 결과 제출(rs)이 확인을 기다림
  | "reviewed"         // 결과 확인됨, 반영 항목 남음
  | "waiting"          // 진행 가능한 일이 없고 질문·기대·타이머를 기다림
  | "active" | "open";
```

- Concern을 열 때 Goal이 반드시 있어야 한다(R-01, A1). 빠르게 적어 둔 Concern도 프로젝트의 Goal 하나에 연결한다. Goal이 하나도 없는 프로젝트에서는 먼저 Goal 제안을 만든다(§4 E-02).

#### 3.6.2 StructureChange (S 루프 결정) [제안]

S 루프의 동작(분해, 병합, 독립, 재배치, 재조합, 보류, 닫기)은 혼자 정한 결정으로 기록한다(v0.3 03 §4.3 규칙 5).

```ts
export const StructureOp = Type.Union([
  Type.Literal("split"), Type.Literal("merge"), Type.Literal("detach"),
  Type.Literal("relocate"), Type.Literal("recombine"), Type.Literal("hold"), Type.Literal("close"),
]);
export const StructureChangeCore = Obj({
  op: StructureOp,
  sourceConcernIds: Type.Array(ConcernId, { minItems: 1 }),
  /** split: 새로 만든 하위, merge: 합쳐진 대상 하나, detach: 떼어 낸 것, 나머지: 빈 배열 */
  resultConcernIds: Type.Array(ConcernId),
  /** relocate: 옮겨 갈 Goal */
  targetGoalId: Nullable(GoalId),
  /** split에서 경계 항목이 없다고 판단한 경우의 이유. 경계 항목 0개면 필수 */
  noBoundaryReason: Nullable(ShortText),
  /** hold: 다시 볼 조건 (필수, R-48). 충족되면 09 p_timers의 hold_revisit이 Concern을 다시 연다 */
  revisit: Nullable(Trigger),
  reason: Text,
  autonomy: Autonomy,
});
export const StructureChange = Obj({
  ...Meta, kind: Type.Literal("structure_change"), ...StructureChangeCore.properties,
  boundaryItemIds: Type.Array(BoundaryItemId),
  status: Type.Union([Type.Literal("applied"), Type.Literal("superseded")]),
  quality: Quality,
});
```

#### 3.6.3 BoundaryItem (경계 항목)

나눈 부분 사이에 걸치는 것(공유 전제, 서로 영향을 주는 결정, 인터페이스)이다. 재조합할 때 확인한다(v0.3 03 §4.3 규칙 4).

```ts
export const BoundaryItemCore = Obj({
  structureChangeId: StructureChangeId,
  concernIds: Type.Array(ConcernId, { minItems: 2 }),
  boundaryKind: Type.Union([
    Type.Literal("shared_premise"), Type.Literal("interacting_decision"),
    Type.Literal("interface"), Type.Literal("other"),
  ]),
  description: Text,
});
export const BoundaryItem = Obj({
  ...Meta, kind: Type.Literal("boundary_item"), ...BoundaryItemCore.properties,
  status: Type.Union([Type.Literal("open"), Type.Literal("checked"), Type.Literal("dropped")]),
  checkedRefs: Type.Array(EvidenceRecordId),
});
```

하위 Concern 개수와 깊이 상한은 다이얼(14 소유)로 두고, 넘으면 커널이 사람에게 묻는다(v0.3 03 §4.3 규칙 6). 기본값 [제안]: 하위 7개, 깊이 3.

#### 3.6.4 EntryAssessment (진입 판정) [제안]

사람 요청이 Helm Concern으로 들어갈지(가벼운 작업으로 끝낼지)를 정한 혼자 정한 결정이다. "에이전트가 정한 것"에 보이고 이의 대상이다(02 AC-01-01·AC-05-01). 가벼운 작업으로 판정되면 Concern이 없으므로 프로젝트의 가벼운 작업 보관 Concern(`Project.lightWorkConcernId`) 아래에 둔다.

```ts
// @helm/domain/src/records/entry-assessment.ts
/** 모델이 선언하는 부분 (14 RunHandoff entry_signals). 결정은 코드가 01의 고정 문턱 2로 계산한다 (판정 J-66) */
export const EntryAssessmentDraft = Obj({
  signals: Type.Array(Obj({ signal: EntrySignal, value: Type.Boolean(), evidence: Type.Array(AnyRecordId), note: Nullable(ShortText) })),
  requestObservationId: ObservationId,
});
export const EntryAssessmentCore = Obj({
  ...EntryAssessmentDraft.properties,
  /** 판정을 둔 Concern: 열린 Concern, 또는 가벼운 작업 보관 Concern */
  concernId: ConcernId,
  decision: Type.Union([Type.Literal("enter"), Type.Literal("suggest"), Type.Literal("light_work")]),
  metCount: Type.Integer({ minimum: 0 }),
  autonomy: Autonomy,
});
export const EntryAssessment = Obj({
  ...Meta, kind: Type.Literal("entry_assessment"), ...EntryAssessmentCore.properties,
  status: Type.Union([Type.Literal("current"), Type.Literal("superseded")]),
  quality: Quality,
});
```

이벤트는 `entry.evaluated`다(09 §3.4.2). `suggest`면 같은 트랜잭션에 `entry_suggestion` 질문이 생긴다(14).

### 3.7 WorkUnit

WorkUnit은 Concern 안의 실행 단위다(탐구, 탐침, 변경, 반영 — 브리프 §6). 런타임에서는 에이전트 실행(`rn`) 하나 이상의 묶음이다.

```ts
// @helm/domain/src/records/workunit.ts
export const WorkUnitKind = Type.Union([
  Type.Literal("inquiry"),      // I: 조사, 측정, 자료 수집, 자극 생성
  Type.Literal("probe"),        // C.probe: 결과를 모르는 상태의 작은 시도
  Type.Literal("change"),       // C.commit: 정한 것을 실행
  Type.Literal("integration"),  // A: 결과를 다른 작업과 맞추기
]);
export const WorkUnitCore = Obj({
  concernId: ConcernId,
  workKind: WorkUnitKind,
  title: Title,
  /** 실행 전에 선언하는 계획과 예상 결과 (OPD+C Predictability, 대화 L2768–2777) */
  intent: Text,
  expectedOutcome: ShortText,
  /** 이 일에서 쓸 예정인 원시 행동. write나 send가 있으면 작업 합의가 필요하다 (R-05) */
  plannedPrimitives: Type.Array(PrimitiveSchema, { uniqueItems: true }),
  inquiryId: Nullable(InquiryId),
  probeId: Nullable(ProbeId),
  integrationId: Nullable(IntegrationId),
  parentWorkUnitId: Nullable(WorkUnitId),
  /** 14: 이 WorkUnit을 연 루프와 그 활성화 전환, 목적 */
  loop: Nullable(LoopIdSchema),
  loopTransitionId: Nullable(LoopTransitionId),
  purpose: Nullable(ShortText),
  workspaceRoot: Nullable(Type.String({ minLength: 1 })),   // 없으면 Concern의 값 (12·13)
  /** 재작업이면 그 출처 (10 G-K2, 11 §3.10.3). 재작업은 새 레코드 종류 없이 WorkUnit으로 표현한다.
   *  생성 필드라 workunit.proposed payload로 실어 보낸다 */
  reworkOf: Nullable(Obj({
    workUnitId: WorkUnitId,
    cause: IdAny("ct", "qs", "ac"),          // 가정 무효로 인한 재작업은 qs ([판정 J-54])
    /** 재작업 단계 (선택, 11 §3.10.3) */
    steps: Type.Array(Type.Union([
      Obj({ kind: Type.Literal("rollback"), rollbackPointId: RollbackPointId }),
      Obj({ kind: Type.Literal("redo"), description: ShortText }),
      Obj({ kind: Type.Literal("compensate"), description: ShortText }),
    ])),
  })),
});
export const WorkUnitStatus = Type.Union([
  Type.Literal("proposed"),
  Type.Literal("negotiating"),     // 범위 확인 중: 합의 초안이 사람 확인을 기다림
  Type.Literal("delegated"),       // 맡김 완료: 합의 활성, 아직 시작 전
  Type.Literal("in_progress"),     // 진행 중
  Type.Literal("paused"),          // 멈출 조건, 사람 지시, 막힘 질문, 합의 만료, 범위 위반 감지
  Type.Literal("scope_exceeded"),  // 선택 필요: 범위 밖 호출이 차단되고 사람의 선택을 기다림
  Type.Literal("submitted"),       // 결과 확인 필요
  Type.Literal("accepted"),        // 결과 확인됨, 반영 항목 남음
  Type.Literal("integrated"),      // 완료
  Type.Literal("concluded"),       // 탐구·탐침 WorkUnit이 멈춤 조건이나 예산으로 끝남
  Type.Literal("rejected"),        // 결과 거절 또는 기준이 틀림
  Type.Literal("cancelled"),
  Type.Literal("superseded"),
]);
export const PauseReason = Obj({
  pauseKind: Type.Union([
    Type.Literal("stop_condition"), Type.Literal("human"), Type.Literal("blocking_question"),
    Type.Literal("agreement_expired"), Type.Literal("violation"), Type.Literal("budget"),
    Type.Literal("grant_revoked"),   // 활성화 근거였던 Grant가 철회됨 (10)
    Type.Literal("submission_missing"), // 진행 요청을 되풀이해도 결과 제출이 없음 (14·02 E1)
  ]),
  ref: Nullable(AnyRecordId),
  note: Nullable(ShortText),
});
export const WorkUnit = Obj({
  ...Meta, kind: Type.Literal("workunit"), ...WorkUnitCore.properties,
  status: WorkUnitStatus,
  agreementId: Nullable(AgreementId),     // 현재 합의
  latestResultId: Nullable(ResultId),
  pause: Nullable(PauseReason),
  modeAssignmentId: Nullable(ModeAssignmentId),
  correctionCount: Type.Integer({ minimum: 0 }), // 수정 요청을 받은 횟수
});
```

- `workKind`가 `inquiry`이고 `plannedPrimitives`에 write·send가 없으면 합의 없이 시작할 수 있다(의존 규칙 1의 반대 방향, 대화 L2129 "읽기만 하는 작업은 합의 없이 진행").
- 원함 탐구의 초안·시안 같은 Helm 저장 공간 산출물은 제안(propose)으로 기록한다(write로 보지 않는다)(14 D10, 15). 프로젝트 파일을 쓰는 탐구 WorkUnit은 압축된 합의(Grant, 사람이 고른 선택의 범위, 직접 지시)를 가진다(v0.3 03 §5 "C는 짧게 압축될 수 있음").
- 재작업 경로(11 방식): 결과 제출 뒤 이의·가정 무효·결과 확인 거절로 재작업이 필요하면, 커널이 `reworkOf`를 가진 새 WorkUnit을 만들고 원 WorkUnit은 같은 트랜잭션에서 `superseded`가 된다(§3.22.3). 재작업 범위가 원 WorkUnit의 활성 합의 범위 안이면 그 합의 아래에서 사람 조작 없이 시작한다. 새 합의는 만들지 않고, 새 WorkUnit의 `agreementId`가 기존 합의를 가리킨다(R-05). 이때 합의는 `released`되지 않는다. 범위 밖이면 제안이 `gate.scope_expansion_required`로 거부된다. 이 승계 규칙의 명령 쪽 검사는 10 §3.6이 정한다([판정 J-158]). 결과 확인의 수정 요청(`revision_requested`)은 같은 WorkUnit을 `in_progress`로 되돌린다. 재작업 WorkUnit과 다른 경로다([판정 J-180]). 결과 확인 횟수 계산에서 재작업 WorkUnit은 정상 경로로 세지 않고 재작업으로 센다(16).
- 상태 기계: §3.22.3.

### 3.8 E 레코드 1: Observation, Assumption, OpenQuestion

#### 3.8.1 Observation [결정 9 / 근거: 브리프 §6 용어집 "관찰" / 필드: 제안]

관찰은 실제 실행 기록(도구 결과, 외부 응답, 사람의 발화와 반응, 타이머가 만든 응답 없음, 실제 변화 감지)을 출처로 갖는 E 레코드다. 모델은 관찰을 만들 수 없다(R-06). 모델의 도구 호출 결과가 관찰이 되며, 이때 행위자는 `runtime`이고 모델은 출처(`source.runId`)로만 남는다(v0.3 07 §2.3).

```ts
// @helm/domain/src/records/observation.ts
const ObsCommon = {
  concernId: Nullable(ConcernId),   // 실행에서 온 관찰은 WorkUnit의 Concern
  workUnitId: Nullable(WorkUnitId),
  observedAt: Ms,                   // 효력 시각. 도구 완료 시각, 외부 응답 수신 시각 등
  summary: Text,                    // 한두 문장. 해석을 넣지 않는다
  content: Nullable(BlobRef),       // 원문 (도구 출력 전문, 메일 본문 등)
  data: Type.Optional(Type.Record(Type.String(), Type.Unknown())), // 구조화 값. 직렬화 16 KiB 이하
  materialRefs: Type.Array(MaterialRef), // 관찰 시점의 M 참조 (해시 포함)
};

export const ToolSource = Obj({ kind: Type.Literal("tool"), runId: RunId, toolCallId: ToolCallId });
export const HumanSource = Obj({
  kind: Type.Literal("human"),
  via: Via,                      // device 또는 local_cli만 허용 (커널 검사)
  commandId: CommandId,
  /** 사람이 외부에서 들은 것을 전한 경우 */
  relayedFrom: Nullable(ExternalActorSchema),
});
export const ExternalSource = Obj({
  kind: Type.Literal("external"),
  actor: ExternalActorSchema,
  channel: ShortText,            // "mail", "github-review" 등
  externalId: Type.String({ minLength: 1, maxLength: 512 }), // 원 시스템의 식별자 (멱등 키)
  contentHash: Nullable(Sha256),
  receivedVia: Type.Union([ToolSource, Obj({ kind: Type.Literal("human"), commandId: CommandId })]),
  expectationId: Nullable(ExpectationId),
});
export const TimerSource = Obj({ kind: Type.Literal("timer"), expectationId: ExpectationId, dueAt: Ms });
export const WatcherSource = Obj({
  kind: Type.Literal("watcher"),
  detector: Type.Union([Type.Literal("fs_watch"), Type.Literal("git_scan"), Type.Literal("diff_check")]),
  runId: Nullable(RunId),        // diff_check는 실행 단위 사후 검사 (13)
});

export const ObservationCore = Type.Union([
  Obj({ ...ObsCommon, obsKind: Type.Literal("tool_result"), source: ToolSource, isError: Type.Boolean() }),
  /** 재시작·취소로 끝을 모르는 도구 실행. "부분적으로 실행됐을 수 있음" */
  Obj({ ...ObsCommon, obsKind: Type.Literal("tool_interrupted"), source: ToolSource,
        interruption: Type.Union([Type.Literal("restart"), Type.Literal("cancel"), Type.Literal("outcome_uncertain")]) }),
  /** 사람의 발화 (자연어 메시지, 사람이 직접 본 것을 알려 줌) */
  Obj({ ...ObsCommon, obsKind: Type.Literal("utterance"), source: HumanSource }),
  /** 자극에 대한 반응 (§3.17.4) */
  Obj({ ...ObsCommon, obsKind: Type.Literal("reaction"), source: HumanSource, reaction: ReactionPayload }),
  /** 외부 응답. 관찰되는 것은 "그 사람이 그렇게 말했다"는 사실이다. 내용의 참은 해석으로 따로 다룬다 (v0.3 02 §2.3) */
  Obj({ ...ObsCommon, obsKind: Type.Literal("external_response"), source: ExternalSource }),
  /** 기대 기한이 지나도 응답이 없음 (v0.3 03 §7.2) */
  Obj({ ...ObsCommon, obsKind: Type.Literal("no_response"), source: TimerSource }),
  /** 여러 도구 결과를 스크립트로 가공한 값 (15 REPL 탐구). 출처 = 스크립트 도구 호출 + 입력 도구 호출들 */
  Obj({ ...ObsCommon, obsKind: Type.Literal("derived"), source: ToolSource,
        inputs: Type.Array(ToolCallId, { minItems: 1 }) }),
  /** 참조된 M이 바뀌었음 */
  Obj({ ...ObsCommon, obsKind: Type.Literal("material_change"), source: WatcherSource,
        changed: Type.Array(Obj({ before: MaterialRef, after: Nullable(MaterialRef) }), { minItems: 1 }) }),
]);
export type ObservationCore = Static<typeof ObservationCore>;

export const Annotation = Obj({
  annKind: Type.Union([
    Type.Literal("surprise"),             // 예측·기대·선언된 확인 결과와 다름 (좋은 쪽 포함)
    Type.Literal("near_miss"),            // 거의 일어날 뻔한 문제
    Type.Literal("repeated_correction"),  // 같은 정정이 반복됨
    Type.Literal("measurement_doubt"),    // 측정 환경 때문에 믿기 어려움
    Type.Literal("procedure_failed"),     // 절차를 적용했는데 실패함 (16 §3.17, 사람만 단다)
  ]),
  note: ShortText,
  expectedRef: Nullable(IdAny("pr", "ex", "dc", "wu", "lp", "pd")),
  valence: Nullable(Type.Union([Type.Literal("good"), Type.Literal("bad"), Type.Literal("neutral")])),
  by: ActorRefSchema,
  seq: Seq,
});

export const Observation = MergeEach(
  Obj({
    ...Meta, kind: Type.Literal("observation"), quality: Quality, annotations: Type.Array(Annotation),
    /** 출처 신뢰 정도 (13): enforced 도구 결과 > advisory > 사람 전언 > 외부 */
    sourceConfidence: Type.Union([Type.Literal("enforced"), Type.Literal("advisory"), Type.Literal("reported")]),
    /** 반응 철회·정정 (04·15·19). 관찰은 바뀌지 않고 근거 계산에서만 빠진다 */
    retracted: Nullable(Obj({ by: ActorRefSchema, seq: Seq, supersededBy: Nullable(ObservationId) })),
  }),
  ObservationCore,
);
```

- 외부 응답은 `summary`를 "<누가> <무엇을> 말했다/보냈다" 형태로 쓴다. 내용을 사실로 옮기려면 해석(`in`)을 따로 만든다.
- 사람의 발화도 관찰이다(대화 L2229). 사람이 구조화 명령(합의 확인, 결과 확인)을 보낸 것은 그 명령의 이벤트로 기록하고 관찰을 만들지 않는다.
- 차단된 도구 호출은 실행되지 않았으므로 관찰이 아니다(helm-canon-2 L20). 차단 기록은 도구 호출 레코드와 `toolcall.blocked` 이벤트에 남는다. 실행 후 오류는 `isError: true`인 관찰이다.
- 주석(annotation)은 관찰을 바꾸지 않고 덧붙는 E 정보다. 놀라움(Surprise), 아차 사고(near miss), 반복 정정을 따로 레코드로 두지 않고 관찰 태그로 둔다(helm-canon-3 §8 08 체크리스트 G5·G6).
- 관찰의 품질: 출처가 검증되면(도구 호출이 실제로 있고 이 관찰이 그 결과, 사람 명령이 인증된 기기에서 옴) 기록 시점에 `qualified`다. 출처를 확인할 수 없는 가져오기 데이터는 `captured`다.

#### 3.8.2 Assumption (전제)

근거 관찰 없이 진행하기 위해 임시로 참으로 둔 것이다(F02 §2 "부채이며 실패 영향과 검증 트리거를 가진다"). 관찰을 참조하지 않은 해석 제안은 거부하지 않고 전제로 기록한다(대화 L2231, "거부와 강등의 구분" audit §3.6).

```ts
// @helm/domain/src/records/assumption.ts
export const AssumptionCore = Obj({
  concernId: ConcernId,
  statement: Text,
  origin: Type.Union([
    Obj({ kind: Type.Literal("downgraded_interpretation"), proposedBy: ActorRefSchema }),
    Obj({ kind: Type.Literal("question"), questionId: QuestionId }), // 질문의 임시 가정
    Obj({ kind: Type.Literal("declared") }),
  ]),
  whyNeeded: Nullable(ShortText),
  failureImpact: Nullable(ShortText),
  howToTest: Nullable(ShortText),
  /** origin이 question이면 null이다. 그 전제의 만료는 질문의 assumptionExpires가 다룬다(같은 시각에 두 타이머가 겹치지 않게) */
  reviewTrigger: Nullable(Trigger),
});
export const AssumptionStatus = Type.Union([
  Type.Literal("active"), Type.Literal("confirmed"), Type.Literal("invalidated"), Type.Literal("retired"),
]);
export const Assumption = Obj({
  ...Meta, kind: Type.Literal("assumption"), ...AssumptionCore.properties,
  status: AssumptionStatus, quality: Quality,
  resolution: Nullable(Obj({ refs: Type.Array(EvidenceRecordId), by: ActorRefSchema, seq: Seq })),
});
```

`invalidated`가 되면 이 전제에 기대는 레코드(`depends_on` 링크)가 낡음(`assumption_invalidated`)으로 표시된다(F05 I11).

#### 3.8.3 OpenQuestion (열린 질문)

아직 모르는 점이다. 사람에게 묻는 질문(`qs`)과 다르다. 탐구 예산이 다 되어 넘기는 열린 질문, 근거 체인에서 "반대 근거 검토 → 열린 질문으로 남음"(v0.3 09 §4.7)이 여기에 해당한다.

```ts
export const OpenQuestionCore = Obj({
  concernId: ConcernId,
  inquiryId: Nullable(InquiryId),
  text: Text,
  relatedRefs: Type.Array(AnyRecordId),
});
export const OpenQuestion = Obj({
  ...Meta, kind: Type.Literal("open_question"), ...OpenQuestionCore.properties,
  status: Type.Union([Type.Literal("open"), Type.Literal("resolved"), Type.Literal("dropped")]),
  resolvedBy: Type.Array(EvidenceRecordId),
});
```

### 3.9 E 레코드 2: Claim 스키마 (해석, 가능성, 판단, 구분 확인)

[결정 15(3) "판단 승격에는 I의 근거 필요" / 근거: 브리프 §6 용어집 "판단", §3.5 Claim 스키마 담당 P5 / 필드 구성: 제안]

"추측"은 해석(`in`)과 가능성(`ps`)의 묶음 이름이다. 레코드는 둘로 나눈다(브리프 §6). 판단(`fd`)은 추측이 승격 규칙을 통과했을 때 커널이 새로 만드는 레코드다(D08-1).

#### 3.9.1 근거 링크와 반대 근거 탐색

```ts
// @helm/domain/src/records/claim.ts
export const EvidenceRelation = Type.Union([
  Type.Literal("supports"),    // 뒷받침
  Type.Literal("challenges"),  // 맞지 않음 (반대 근거)
  Type.Literal("qualifies"),   // 범위·조건을 좁힘
  Type.Literal("invalidates"), // 근거 자체를 무효로 만듦 (반대 근거의 강한 형태)
]);
export const CounterResolution = Obj({
  resolutionKind: Type.Union([
    Type.Literal("explained"),         // 다른 관찰로 설명됨
    Type.Literal("measurement_error"), // 측정 환경 문제
    Type.Literal("out_of_scope"),      // 주장 범위 밖으로 좁힘 (scope 수정과 함께)
  ]),
  refs: Type.Array(EvidenceRecordId),  // 에이전트가 처리할 때는 1개 이상 필수 (R-11)
  note: ShortText,
  by: ActorRefSchema,
  seq: Seq,
});
export const EvidenceLink = Obj({
  /** 근거 대상. 승격 조건은 관찰(ob)만 센다. 판단(fd)은 전제로 인용할 때만 */
  target: IdAny("ob", "fd"),
  relation: EvidenceRelation,
  directness: Type.Union([Type.Literal("direct"), Type.Literal("indirect")]), // F02 Directness
  coverage: Type.Union([Type.Literal("full"), Type.Literal("partial")]),      // F02 Coverage
  note: Nullable(ShortText),                                                  // F02 Relevance
  linkedBy: ActorRefSchema,
  linkedSeq: Seq,
  /** challenges·invalidates에만 쓴다. null이면 해소되지 않은 반대 근거 */
  resolution: Nullable(CounterResolution),
});

/** "반증을 찾아봤는데 없었다"를 기록하는 단위 (대화 L3125–3135 counterChecked의 확장) */
export const CounterSearch = Obj({
  description: ShortText,                                    // 무엇을 어떻게 찾아봤나
  observations: Type.Array(ObservationId, { minItems: 1 }),  // 탐색 실행의 결과 관찰. 실행 기록이 있어야 한다
  found: Type.Array(ObservationId),                          // 그중 challenges로 링크한 것
  by: ActorRefSchema,
  seq: Seq,
});
```

- `counterChecked`(helm-toy, 대화 L3127)는 저장하지 않고 `counterSearches.length >= 1`로 계산한다. 반대 근거 탐색도 실행 기록으로 남아야 한다(audit-report §3.5). 찾아보지 않아서 없는 것과 찾아봤는데 없는 것을 구분하는 것이 이 구조의 목적이다(대화 L3135).
- `counterEvidence`(helm-toy)는 `relation`이 `challenges` 또는 `invalidates`인 링크다. 별도 배열로 저장하지 않고 계산한다.
- 근거 품질 여덟 차원(F02 §3)과의 대응: Provenance = 관찰의 `source`, Relevance = 링크 `note`, Directness·Coverage = 링크 필드, Reliability = 출처 종류(도구 결과 > 사람 전언 > 외부 응답), Freshness = 관찰의 품질 `stale`, Independence = 투영이 계산하는 독립성 키(아래), Falsifiability = 가능성의 `falsifier`.
- 독립성: 같은 모델·같은 컨텍스트의 실행에서 나온 근거는 서로 독립이 아니다(F02 §9 원칙 7). 투영은 관찰마다 독립성 키를 계산한다. 도구 결과는 `tool:<toolName>:<execution.fingerprint>`, 사람 출처는 `human`, 외부 출처는 `external:<actor>`, 모델 실행이 만든 산출(자극 등)을 근거로 쓴 경우는 `run:<rootRunId>`. 파생 관찰(`derived`, REPL 집계)의 키는 입력 도구 호출들의 키 집합이다(스크립트마다 새 키를 만들지 않는다). 파생 관찰의 `statement`는 코드 템플릿으로만 만들고, 승격 근거로 쓸 때 커널이 입력에서 같은 값을 다시 계산해 일치를 확인한다(15 §3.12.6). 화면은 근거 개수 대신 독립 키 수와 직접성을 보여 준다(helm-canon §8.3 "근거 다섯 개를 근거 하나보다 자동으로 강하다고 표시하지 않는다").

#### 3.9.2 해석 (Interpretation)

```ts
const ClaimCommon = {
  concernId: ConcernId,
  inquiryId: Nullable(InquiryId),
  statement: Text,
  scope: Nullable(ShortText),   // 이 주장이 적용되는 범위
};
const ClaimState = {
  evidence: Type.Array(EvidenceLink),
  counterSearches: Type.Array(CounterSearch),
  checkIds: Type.Array(CheckId),
  quality: Quality,
};
export const InterpretationCore = Obj({
  ...ClaimCommon,
  method: ShortText,                                      // 어떻게 추론했나 (F02 Inference)
  basis: Type.Array(ObservationId, { minItems: 1 }),      // 참조한 관찰. 0개면 전제로 강등 (R-07)
});
export const Interpretation = Obj({
  ...Meta, kind: Type.Literal("interpretation"), ...InterpretationCore.properties, ...ClaimState,
  status: Type.Union([
    Type.Literal("active"), Type.Literal("promoted"), Type.Literal("retracted"), Type.Literal("superseded"),
  ]),
  promotedTo: Nullable(FindingId),
});
```

`basis`의 관찰은 만들 때 `supports` 링크로도 들어간다(`evidence`의 초기값).

#### 3.9.3 가능성 (Possibility)

```ts
export const PossibilityKind = Type.Union([
  Type.Literal("cause"),                // 사실 탐구의 원인 후보
  Type.Literal("perspective"),          // 문제를 보는 관점 (사실 탐구 1단계)
  Type.Literal("solution"),             // 가능성 탐구의 해법·방향
  Type.Literal("preference_criterion"), // 원함 탐구의 기준 후보 (v0.3 04 §3.2 4단계)
  Type.Literal("failure_path"),         // 결과 탐구의 실패 경로
]);
export const PossibilityOrigin = Obj({
  kind: Type.Union([Type.Literal("direction"), Type.Literal("lens"), Type.Literal("human"), Type.Literal("review"), Type.Literal("reaction_inference")]),
  /** 기준 후보를 찾은 방법 (15 근거 규칙이 "stated"를 구분한다) */
  method: Nullable(Type.Union([Type.Literal("triad"), Type.Literal("rephrase"), Type.Literal("pattern"), Type.Literal("stated")])),
  perspectiveKey: Nullable(Type.String({ minLength: 1, maxLength: 64 })),
  cellKey: Nullable(Type.String({ minLength: 1, maxLength: 64 })),   // 발산 표의 칸 (§3.17.1)
  lensId: Nullable(LensId),                                           // Method Transfer 렌즈
  branchRunId: Nullable(RunId),                                       // 이 후보를 만든 하위 호출
});
export const PossibilityCore = Obj({
  ...ClaimCommon,
  possibilityKind: PossibilityKind,
  /** 아래 셋은 cause·perspective에서 필수, solution·preference_criterion·failure_path에서는 선택 (15) */
  ifTrue: Nullable(ShortText),      // 맞다면 무엇이 관찰되어야 하는가 (예측)
  falsifier: Nullable(ShortText),   // 무엇이 관찰되면 틀린가 (반박 조건)
  nextCheck: Nullable(ShortText),   // 구분할 다음 확인 (대화 L2216 Diverge 단계의 검사 항목)
  origin: PossibilityOrigin,
  /** 15: 해법의 결과("X를 원하면 A를 얻고 B를 잃는다"), 기준 명세, 실현 가능성 */
  consequences: Type.Array(ShortText),
  /** 기준 키별 결과 표시: 나아짐 1, 같음 0, 나빠짐 -1 (15 §3.4.9). 숫자는 방향 표시이며 확률이 아니다 */
  consequenceMarks: Nullable(Type.Record(Type.String({ minLength: 1, maxLength: 16 }),
    Type.Union([Type.Literal(-1), Type.Literal(0), Type.Literal(1)]))),
  criterion: Nullable(Type.Record(Type.String(), Type.Unknown())),   // preference_criterion의 CriterionSpec (15)
  feasibility: Type.Union([Type.Literal("unchecked"), Type.Literal("feasible"), Type.Literal("infeasible")]),
  /** 근거 링크 초기값. 비어 있으면 "근거 없음"으로 표시 (v0.3 04 §4.4) */
  initialEvidence: Type.Array(Obj({
    target: IdAny("ob", "fd"), relation: EvidenceRelation, note: Nullable(ShortText),
  })),
  /** 가능성 탐구의 다른 분야 사례 출처 (관찰이 아닌 인용) */
  citations: Type.Array(Obj({ title: ShortText, url: Nullable(Type.String({ maxLength: 2048 })), retrievedBy: Nullable(ToolCallId) })),
});
export const PossibilityStatus = Type.Union([
  Type.Literal("open"),
  Type.Literal("rejected"),     // 반대 근거로 기각 (근거 refs 필수)
  Type.Literal("undecidable"),  // 예산 안에서 구분 불가
  Type.Literal("promoted"),     // 판단으로 승격됨
  Type.Literal("confirmed"),    // 선호 기준으로 확정됨 (preference_criterion만)
  Type.Literal("superseded"),
  Type.Literal("withdrawn"),    // 제안자가 거둠
  Type.Literal("dismissed"),    // 사람이 이유 없이 치움 (15 possibility.dismiss)
  Type.Literal("merged"),       // 다른 가능성에 합쳐짐 (mergedInto)
]);
export const Possibility = Obj({
  ...Meta, kind: Type.Literal("possibility"),
  ...Type.Omit(PossibilityCore, ["initialEvidence"]).properties,
  ...ClaimState,
  status: PossibilityStatus,
  promotedTo: Nullable(IdAny("fd", "pm")),
  mergedInto: Nullable(PossibilityId),
  pinned: Type.Boolean(),       // 대비 압축에서 접지 않음 (15)
  statusBasis: Nullable(Obj({ refs: Type.Array(EvidenceRecordId), note: ShortText, seq: Seq })),
});

/** 투영 계산값 (저장하지 않음). Inquiry Map의 strengthened/weakened (paper-v0 §5.2.1) */
export type SupportTrend = "none" | "strengthened" | "weakened" | "mixed";
/** 15 §3.3의 질적 지지 등급. 계산값이며 저장하지 않는다. 숫자 confidence는 저장도 표시도 하지 않는다 (판정 J-19) */
export type SupportGrade = "untested" | "weak" | "consistent" | "confirmed" | "contested";
```

- 인용(`citations`)은 근거 링크가 아니다. 다른 분야 사례 출처는 가능성 탐구의 근거 규칙(v0.3 04 §4.4)에 들어가지만, 승격 조건의 근거(관찰)로는 세지 않는다. 문서를 실제로 읽은 도구 실행이 있으면 그 관찰을 `supports`로 링크한다.

#### 3.9.4 구분 확인 (DiscriminatingCheck) [제안: D08-2]

구분 확인은 결과가 추측에 따라 달라지는 관찰이다(v0.3 02 §2.2). 관찰하기 전에 결과 라벨과 후보별 예측을 선언해 둔다. 관찰 뒤 결과 라벨을 정하면 커널이 후보별 일치·불일치를 계산한다. 이렇게 하면 "어떤 확인이 구분력이 있었는가"를 모델의 사후 서술 대신 선언과 결과의 비교로 정할 수 있다.

```ts
// @helm/domain/src/records/check.ts
export const OutcomeLabel = Type.String({ minLength: 1, maxLength: 80 });
export const CheckTarget = Type.Union([
  Obj({ kind: Type.Literal("claim"), claimId: ClaimId }),
  /** 아직 레코드가 없는 경쟁 설명. 경쟁 추측이 하나뿐일 때 쓴다 */
  Obj({ kind: Type.Literal("alternative"), statement: ShortText }),
]);
export const CheckPrediction = Obj({
  target: CheckTarget,
  /** 이 후보가 맞다면 나올 결과 라벨들 (outcomes의 부분집합) */
  expects: Type.Array(OutcomeLabel, { minItems: 1, uniqueItems: true }),
});
export const DiscriminatingCheckCore = Obj({
  concernId: ConcernId,
  inquiryId: Nullable(InquiryId),
  question: ShortText,   // 무엇을 확인하는가
  method: ShortText,     // 어떻게 (도구·명령·측정, 원함 탐구면 자극 쌍)
  /** 서로 배타적인 결과 라벨 */
  outcomes: Type.Array(OutcomeLabel, { minItems: 2, maxItems: 8, uniqueItems: true }),
  predictions: Type.Array(CheckPrediction, { minItems: 2 }),
  /** 모델이 선언한 비용. 확인 순서 계산에 쓴다 (v0.3 04 §2.2 3단계, 15) */
  cost: Obj({
    unit: Type.Union([Type.Literal("minutes"), Type.Literal("tool_calls"), Type.Literal("subcalls"), Type.Literal("attention")]),
    estimate: Type.Number({ minimum: 0 }),
  }),
  /** 원함 탐구: 반응이 선호에 따라 달라지는 자극 (v0.3 04 §3.2 5단계) */
  stimulusIds: Type.Array(StimulusId),
});
export const CheckVerdict = Obj({
  target: CheckTarget,
  verdict: Type.Union([Type.Literal("consistent"), Type.Literal("inconsistent")]),
});
export const DiscriminatingCheck = Obj({
  ...Meta, kind: Type.Literal("check"), ...DiscriminatingCheckCore.properties,
  status: Type.Union([Type.Literal("declared"), Type.Literal("observed"), Type.Literal("void")]),
  observation: Nullable(Obj({
    observationIds: Type.Array(ObservationId, { minItems: 1 }),
    outcome: OutcomeLabel,
    classifiedBy: ActorRefSchema,
    seq: Seq,
    /** 관찰이 선언보다 먼저 있었으면 true. 사후 선언은 승격 조건에 세지 않는다 */
    posthoc: Type.Boolean(),
  })),
  /** 커널이 계산: consistent ⇔ outcome ∈ expects */
  verdicts: Type.Array(CheckVerdict),
  /** 사람이 이 확인을 다음 순서로 고정함 (check.pinned, 10 check.pin, J-95). 코드의 확인 순서 계산보다 앞선다 */
  pinned: Nullable(Obj({ seq: Seq, via: Via })),
  quality: Quality,
});
```

쓰기 시점 규칙(R-12, R-13 요약):

1. 모든 `expects`는 `outcomes`의 부분집합이다.
2. 모든 예측의 `expects` 집합이 같으면 구분력이 없으므로 거부한다(`invalid.check_not_discriminating`). "모든 후보가 같은 결과를 예측하면 그 확인을 쓰지 않음"(v0.3 04 §2.4).
3. 관찰된 결과 라벨은 `outcomes` 안에 있어야 한다. 어느 예측도 그 라벨을 포함하지 않으면 확인은 기록되고, 관찰에 `surprise` 주석이 붙는다.
4. 결과 라벨의 분류(관찰 → 라벨)는 모델이 제안할 수 있다. 분류자는 `classifiedBy`로 남는다. 분류를 검증 에이전트가 하도록 할지는 15가 정한다.

#### 3.9.5 판단 (Finding) [결정: 승격 조건(브리프 결정 15(3)) / 레코드 구조: D08-1]

```ts
// @helm/domain/src/records/finding.ts
export const FindingCore = Obj({
  fromClaimId: IdAny("in", "ps"),
  concernId: ConcernId,
  /** 원래 진술을 다듬을 수 있으나 범위를 넓히면 안 된다 (커널은 scope 필드로만 검사) */
  statement: Text,
  scope: ShortText,                       // F05 Claim 평가 scope
  confidenceBasis: ShortText,             // F05 confidence_basis. 숫자 아님 (D08-10)
  invalidationTriggers: Type.Array(Trigger),
  reviewTrigger: Nullable(Trigger),
  /** 승격 시점의 근거를 고정한다 */
  promotionBasis: Obj({
    supports: Type.Array(ObservationId, { minItems: 1 }),
    checks: Type.Array(CheckId, { minItems: 1 }),
    counterSearchCount: Type.Integer({ minimum: 1 }),
    atSeq: Seq,
  }),
});
export const FindingConfirmation = Obj({
  status: Type.Union([Type.Literal("unconfirmed"), Type.Literal("confirmed")]),
  by: Nullable(Type.Literal("human")),
  seq: Nullable(Seq),
  /** direct: 판단 확인 명령, choice_commit: 사람이 이 판단을 근거로 선택을 확정 */
  via: Nullable(Type.Union([Type.Literal("direct"), Type.Literal("choice_commit")])),
});
export const Finding = Obj({
  ...Meta, kind: Type.Literal("finding"), ...FindingCore.properties,
  evidence: Type.Array(EvidenceLink),       // 승격 뒤에도 링크가 계속 붙는다
  counterSearches: Type.Array(CounterSearch),
  confirmation: FindingConfirmation,
  status: Type.Union([Type.Literal("active"), Type.Literal("withdrawn"), Type.Literal("superseded")]),
  quality: Quality,
});
```

승격 조건 (커널 집행은 10, 판정 함수는 `@helm/domain/src/rules/promotion.ts`의 순수 함수로 둔다). 정본은 10 §3.9 규칙(V-PRO-01~)이며 판정 J-18을 따른다. 아래 함수는 그 규칙 중 레코드만 보고 계산할 수 있는 부분(근거, 구분 확인과 사후 선언 제외, 반대 근거)에 출처 독립성(`evidence.correlated`)을 더한 것이다. 독립성 키는 §3.9.1의 규칙으로 계산한다. 15는 이 함수를 그대로 쓴다:

```ts
export interface PromotionView {
  observation(id: string): Observation | undefined;
  check(id: string): DiscriminatingCheck | undefined;
}
export type PromotionMissing =
  | "evidence.support"        // 근거 관찰 없음
  | "evidence.unqualified"    // 근거 관찰의 품질이 qualified 미만이거나 낡음
  | "check.discriminating"    // 구분 확인 없음
  | "counter.search"          // 반대 근거 탐색 기록 없음
  | `counter.unresolved:${string}` // 해소되지 않은 반대 근거 (관찰 id)
  | "evidence.correlated"     // 출처 독립성 부족 (10 V-PRO-02)
  | "claim.not_current";      // 추측 자체가 낡았거나 대체됨

export function promotionMissing(claim: Interpretation | Possibility, view: PromotionView): PromotionMissing[] {
  const missing: PromotionMissing[] = [];
  const supports = claim.evidence.filter((l) => l.relation === "supports" && l.target.startsWith("ob_"));
  const usable = supports.filter((l) => {
    const o = view.observation(l.target);
    return o && (o.quality.level === "qualified" || o.quality.level === "accepted") && !o.quality.stale;
  });
  if (supports.length === 0) missing.push("evidence.support");
  else if (usable.length === 0) missing.push("evidence.unqualified");

  const self = claim.id;
  const discriminating = claim.checkIds.map((id) => view.check(id)).filter((c) =>
    c && c.status === "observed" && c.observation && !c.observation.posthoc &&
    c.verdicts.some((v) => v.target.kind === "claim" && v.target.claimId === self && v.verdict === "consistent") &&
    c.verdicts.some((v) => !(v.target.kind === "claim" && v.target.claimId === self) && v.verdict === "inconsistent"));
  if (discriminating.length === 0) missing.push("check.discriminating");

  if (claim.counterSearches.length === 0) missing.push("counter.search");
  for (const l of claim.evidence) {
    if ((l.relation === "challenges" || l.relation === "invalidates") && l.resolution === null) {
      missing.push(`counter.unresolved:${l.target}`);
    }
  }
  if (claim.quality.stale || claim.quality.supersededBy) missing.push("claim.not_current");
  return missing;
}
```

- 조건 다섯(v0.3 02 §2.1) 중 1~4는 위 함수다. 5("결정에 쓰이는 판단이라면 사람이 확인")는 판단의 `confirmation`이다. 승격 직후 판단은 `qualified`이고, 사람이 확인하면 `accepted`가 된다. 사람이 이 판단을 근거로 선택을 확정하면 같은 트랜잭션에서 확인으로 기록한다(`via: "choice_commit"`).
- 승격 뒤 새 반대 근거가 링크되면 판단은 `contested`가 되고 Concern이 다시 열린다(대화 L2234). "맞지 않는다"의 판정은 모델(검증 에이전트)의 제안이고, 상태 변경은 커널이 한다.
- helm-toy와의 차이: helm-toy는 promote 시점에 근거가 도구 결과인지 개수만 봤다(helm-canon-3 X3-10-05). 이 함수는 근거 관찰의 품질과 낡음까지 본다.

### 3.10 N 레코드 1: Choice, Objection

#### 3.10.1 Choice (선택) [결정 8 / 근거: 브리프 §6 용어집 정의 / 필드: 제안]

선택은 앞으로의 기준선을 바꾸는 규범적 결정이다. 사람이 고르거나, 맡긴 범위 안에서 에이전트나 정책이 정할 때만 생긴다. 추천은 선택이 아니다.

```ts
// @helm/domain/src/records/choice.ts
export const ChoiceAlternative = Obj({
  label: ShortText,
  ref: Nullable(IdAny("ps", "fd")),
  whyNot: Nullable(ShortText),   // 고르지 않은 이유 (F03 Decision 보존 항목)
});
const ChoiceCommon = {
  concernId: ConcernId,
  question: ShortText,                 // 무엇을 정했나 (decision question)
  decision: Text,                      // 고른 것 (selected option)
  selectedRef: Nullable(IdAny("ps", "fd")),
  alternatives: Type.Array(ChoiceAlternative, { minItems: 1 }), // 현상 유지도 대안이 될 수 있다
  rationale: Text,
  evaluationCriteria: Type.Array(ShortText),
  /** E justifies N (D08-8) */
  basis: Type.Array(EvidenceRecordId, { minItems: 1 }),
  consequences: Type.Array(ShortText), // 받아들이는 결과
  whyNow: Nullable(ShortText),
  goal: GoalRef,                       // 결정 시점의 Goal 버전
  reviewTrigger: Nullable(Trigger),
  /** 이 선택이 대체하는 이전 선택 */
  supersedes: Nullable(ChoiceId),
  choiceKind: Type.Union([
    Type.Literal("general"),
    Type.Literal("assumption_confirmed"), // 질문 가정 확정에서 나옴
    Type.Literal("auto_verified"),        // 자동 검증 결과로 정함
  ]),
};
/** 사람이 정한 선택의 core. 권리 게이트 결정은 이 변형만 가능. 19 ChoiceCommitParams.core와 10 ChoiceCommitPayload.core가 이 이름을 쓴다 */
export const ChoiceHumanCore = Obj({ ...ChoiceCommon, gate: Type.Union([Type.Literal("rights"), Type.Literal("information")]),
        autonomy: HumanDecision });
export const ChoiceCore = Type.Union([
  ChoiceHumanCore,
  /** 혼자 정한 결정. 정보 게이트만 */
  Obj({ ...ChoiceCommon, gate: Type.Literal("information"),
        autonomy: AutonomousDecision /* whyNotAsked 필수 */ }),
]);
export const ChoiceStatus = Type.Union([
  Type.Literal("committed"), Type.Literal("superseded"), Type.Literal("revoked"),
]);
export const Choice = MergeEach(
  Obj({ ...Meta, kind: Type.Literal("choice"), status: ChoiceStatus, quality: Quality,
        implementedBy: Type.Array(AgreementId) }),
  ChoiceCore,
);
```

- `reviewTrigger`가 `null`이어도 기록은 되지만 품질은 `structural`에 머문다. 단, 혼자 정한 결정이고 `whyNotAsked`가 `info_gate`이며 거짓 조건에 2(결과가 실질적으로 바뀌지 않음)가 있으면 다시 볼 조건 없이 `qualified`가 될 수 있다(변수 이름 같은 사소한 결정, v0.3 06 §4.2 예시 CH-22).
- 사람이 정한 선택의 `reviewTrigger`가 충족되면(`record.staled`의 원인 `review_trigger_fired`, §3.4.3) 같은 결정점의 재결정 질문을 낸다. 이 규칙은 MVP에 넣는다. 측정 지표 조건(`observation_metric`)의 자동 판정은 2단계로 둔다([판정 J-138]).
- 원전 Decision 보존 항목 13(F03 §8)과의 대응: decision question = `question`, why now = `whyNow`, decision owner = `autonomy.decidedBy`, alternatives = `alternatives`, evaluation criteria = `evaluationCriteria`, supporting and counterevidence = `basis` + 근거 레코드의 링크, assumptions and uncertainty = `basis` 안의 전제·열린 질문 참조, reversibility and blast radius = 두지 않음(결정 2), selected option = `decision`, consequences = `consequences`, dissent = 이 선택을 대상으로 한 이의(`ct`), implementation commitments = `implementedBy`, review and reopen triggers = `reviewTrigger`.
- 근거가 해석·전제뿐인 선택(판단·가능성·관찰·선호 기준이 근거에 없음)은 기록하되 품질을 `structural`로 둔다([판정 J-145], ADR A08-7).
- 품질이 `qualified` 미만인 선택은 활성 기준선으로 투영되지 않는다. 투영은 이를 주의 항목으로 보인다(helm-canon-2 §1.10의 `ㅇ` 사례).

#### 3.10.2 Objection (이의) [제안: D08-6]

```ts
// @helm/domain/src/records/objection.ts
/** 이의를 걸 수 있는 레코드 (런타임·통치 레코드 제외) */
export const ContestableId = IdAny(
  "ch", "lp", "lt", "sa", "sc", "md", "ea", // 결정 레코드 (Autonomy 보유)
  "ac",                                 // 결과 확인 (사람 결정. 확인 뒤 되돌리기는 이의로, 판정 J-123)
  "fd", "in", "ps", "as", "ob",         // 이해 레코드
  "pm", "dc", "pr", "gl", "ag", "rs", "qs",
);
export const ObjectionTarget = Type.Union([
  Obj({ kind: Type.Literal("record"), id: ContestableId,
        /** 선호 모델 기준, 결과 제출의 기준별 판정(`rs` + 기준 id)처럼 레코드 안 항목 */
        itemKey: Nullable(Type.String({ minLength: 1, maxLength: 64 })) }),
  /** 근거 관계 하나 (03·05·19) */
  Obj({ kind: Type.Literal("link"), from: AnyRecordId, to: AnyRecordId, rel: LinkRel }),
]);
export const ObjectionCore = Obj({
  target: ObjectionTarget,
  reason: Nullable(ShortText),         // 이유 없는 이의도 받는다 (선택 입력, J-20)
  /** 이유 종류 (선택, 16 H3·H7·H9 집계용). 05 이의 화면의 선택 칩 */
  reasonKind: Nullable(Enum(["wrong_evidence", "missed_counter", "wrong_value", "wrong_scope", "should_have_asked", "other"])),
  /** 커널이 정한다: record 대상은 그 레코드의 Concern, link 대상은 from 레코드의 Concern. 프로젝트 수준 레코드(gl 등)면 그 프로젝트의 가벼운 작업 보관 Concern */
  concernId: ConcernId,
  /** 사람이 바라는 처리 (03·05·19). note_only는 다시 열지 않고 기록만 */
  desiredEffect: Type.Union([Type.Literal("reopen"), Type.Literal("ask_next_time"), Type.Literal("note_only")]),
});
export const ObjectionStatus = Type.Union([
  Type.Literal("open"),
  Type.Literal("upheld"),     // 대상이 새 레코드로 대체되거나 철회됨
  Type.Literal("withdrawn"),  // 사람이 거둠
  Type.Literal("dismissed"),  // 사람이 검토 후 대상을 유지하기로 함
  Type.Literal("noted"),      // desiredEffect = note_only: 기록만 하고 대상은 그대로 (contested 표시 없음)
]);
export const Objection = Obj({
  ...Meta, kind: Type.Literal("objection"), ...ObjectionCore.properties,
  status: ObjectionStatus,
  resolution: Nullable(Obj({ by: ActorRefSchema, seq: Seq, refs: Type.Array(AnyRecordId), note: Nullable(ShortText) })),
});
```

- 이의는 사람만 건다(R-16). 검증 에이전트의 반대 의견은 반대 근거 링크나 증언(`at`)으로 기록한다.
- 이의가 열리면 대상의 품질에 `contestedBy`가 붙고 관련 Concern이 다시 열린다(v0.3 06 §4.3). 열린 이의는 복귀 요약의 주의 항목이며, 처리되지 않고 사라진 이의 수 0이 OPD+C Contestability 지표다(v0.3 09 §5).
- 이의가 `upheld`가 되는 조건: 대상을 대체하는 새 레코드(`supersedes`)가 생기거나 대상이 철회(`revoked`, `withdrawn`)됨. 커널이 같은 트랜잭션에서 처리한다.

### 3.11 N 레코드 2: Agreement, Criterion, Grant

#### 3.11.1 Agreement (작업 합의) [결정 15(1) / 근거: 브리프 §6 용어집 정의(목적, 완료 기준, 범위, 금지 행동, 제출할 근거, 멈출 조건) / 필드·상태: 제안]

```ts
// @helm/domain/src/records/agreement.ts
export const ResourceScope = Type.Union([
  /** 프로젝트 루트 기준 경로 glob. "**"로 끝나면 그 아래 전부 */
  Obj({ kind: Type.Literal("path"), projectId: ProjectId, pattern: Type.String({ minLength: 1, maxLength: 512 }) }),
  Obj({ kind: Type.Literal("service"), name: Type.String({ pattern: "^[a-z0-9][a-z0-9._-]{0,62}$" }) }),
  Obj({ kind: Type.Literal("url_prefix"), prefix: Type.String({ minLength: 1, maxLength: 2048 }) }),
  /** 13 ResourceUri의 net:<host> | net:public. host가 "public"이면 공개 인터넷 전체(루프백·사설·CGNAT·tailnet 제외)다. 이 종류의 읽기(web_search·web_fetch·브라우저 읽기)는 합의 부여 없이 기본 허용이다. 외부 효과(send)는 권리 게이트를 그대로 거친다 ([결정 55], [판정 J-190] (2), [판정 J-205]) */
  Obj({ kind: Type.Literal("net"), host: Type.String({ minLength: 1, maxLength: 253 }) }),
  /** 13 ResourceUri의 mcp:<server>/<tool> (tool은 * 허용) */
  Obj({ kind: Type.Literal("mcp"), server: Type.String({ minLength: 1 }), tool: Type.String({ minLength: 1 }) }),
  /** Helm 데이터 디렉터리의 Concern별 초안 공간 (13 draft_only 프리셋) */
  Obj({ kind: Type.Literal("helm_draft"), concernId: ConcernId }),
]);
export const Budget = Obj({
  maxRuns: Nullable(Type.Integer({ minimum: 1 })),
  maxToolCalls: Nullable(Type.Integer({ minimum: 1 })),
  maxDurationMs: Nullable(DurationMs),
  maxCostUsd: Nullable(Type.Number({ minimum: 0 })),
});
/** 맡긴 범위. effect class는 없다 (결정 2) */
export const Scope = Obj({
  primitives: Type.Array(PrimitiveSchema, { minItems: 1, uniqueItems: true }),
  resources: Type.Array(ResourceScope, { minItems: 1 }),
  /** 보낼 곳 목록. MVP 커널은 이 필드를 읽지 않으며 send는 언제나 권리 게이트다 ([판정 J-91], 01 NFR-S-7).
   *  사전 허락 목록으로 쓰는 것은 2단계에서 검토한다 */
  sendTargets: Type.Array(ShortText),
  budget: Budget,
  validUntil: Nullable(Ms),
  /** 대상을 실행 전에 알 수 없는 execute(13 targetsKnown = false)를 허용하는가. 허용하면 사후 검사(enforcement post_hoc) */
  allowUnknownTargets: Type.Boolean(),
});
/** 에이전트의 의도 재진술 (canon-3 G1, Mission Command 규칙 2, 10 §3.11) */
export const CheckBack = Obj({
  understoodPurpose: ShortText,
  expectedEndState: ShortText,
  firstSteps: Type.Array(ShortText),
  willStopWhen: Type.Array(ShortText),
  proceedsAutomatically: Type.Array(ShortText),
});
export const Criterion = Obj({
  id: CriterionId,
  text: ShortText,
  /** 제출할 근거: 무엇으로 충족을 보일지 */
  evidenceExpected: ShortText,
  verification: Type.Union([
    Type.Literal("test"), Type.Literal("measurement"), Type.Literal("review"),
    Type.Literal("preference_match"),   // 취향형: 선호 모델과의 일치를 사람이 판정 (v0.3 03 §3.4)
    Type.Literal("other"),
  ]),
  /** 선호 모델 기준에서 온 완료 기준 (v0.3 04 §3.5) */
  fromPreference: Nullable(Obj({ preferenceModelId: PreferenceModelId, criterionKey: Type.String({ minLength: 1 }) })),
  addedInRevision: Type.Integer({ minimum: 1 }),
});
export const AgreementContent = Obj({
  purpose: Text,                                          // 목적: 왜, 원하는 끝 상태
  criteria: Type.Array(Criterion, { minItems: 1 }),       // 완료 기준
  scope: Scope,                                           // 범위
  forbidden: Type.Array(ShortText),                       // 금지 행동
  forbiddenResources: Type.Array(ResourceScope),          // 구조화된 금지 범위 (scope보다 우선)
  stopConditions: Type.Array(ShortText, { minItems: 1 }), // 멈출 조건
  preserve: Type.Array(ShortText),                        // 보존할 것 (Mission Command, helm-canon-3 G3)
  nonGoals: Type.Array(ShortText),
  checkpoint: Nullable(ShortText),                        // 예상되는 관찰 가능한 진행 지점
});
export const AgreementKind = Type.Union([
  Type.Literal("commit"), Type.Literal("probe"), Type.Literal("integration"),
  Type.Literal("inquiry"),   // 쓰기 없는 탐구를 규칙으로 활성화 (10 §3.11.6). Helm 저장 공간 산출물은 propose다
  Type.Literal("emergency"), // 비상 합의에서 활성화 (C.emergency)
]);
export const AgreementCore = Obj({
  workUnitId: WorkUnitId,
  concernId: ConcernId,
  agreementKind: AgreementKind,
  goal: GoalRef,
  implementsChoices: Type.Array(ChoiceId),   // N authorizes M의 출발점
  performer: AgentActorSchema,
  content: AgreementContent,
});
export const AgreementStatus = Type.Union([
  Type.Literal("proposed"),   // 범위 확인 중
  Type.Literal("active"),     // 맡김 완료 이후
  Type.Literal("fulfilled"),  // 결과가 확인됨
  Type.Literal("released"),   // 사람이 끝냄, 또는 WorkUnit 거절·취소로 끝남
  Type.Literal("declined"),   // 제안 단계에서 사람이 취소
  Type.Literal("expired"),    // validUntil 지남
  Type.Literal("superseded"), // 같은 WorkUnit의 새 합의로 대체
]);
export const Activation = Type.Union([
  Obj({ mode: Type.Literal("human"), seq: Seq, via: Via }),
  Obj({ mode: Type.Literal("grant"), grantId: GrantId, activatedBy: AgentActorSchema, autonomy: AutonomousDecision, seq: Seq }),
  /** 01 R-OP-2 (a): 사람이 직접 고른 선택의 구조화 범위 안 합의 ([판정 J-133]). 가정 확정·맡기기로 생긴 선택은 근거가 아니다 */
  Obj({ mode: Type.Literal("choice_scope"), choiceId: ChoiceId, questionId: QuestionId, optionKey: Type.String({ minLength: 1 }), seq: Seq }),
  /** 결과 확인과 같은 조작으로 확정한 반영 범위 합의 ([판정 J-126]) */
  Obj({ mode: Type.Literal("result_acceptance"), acceptanceId: AcceptanceId, seq: Seq }),
  /** 01 R-OP-2 (b): 사람의 직접 지시를 되읽은 합의 (지시 발화 관찰) */
  Obj({ mode: Type.Literal("direct_instruction"), observationId: ObservationId, seq: Seq }),
  /** 14: 쓰기 없는 탐구 합의를 규칙으로 활성화 */
  Obj({ mode: Type.Literal("rule"), ruleId: Type.String({ minLength: 1 }), seq: Seq }),
]);
export const Agreement = Obj({
  ...Meta, kind: Type.Literal("agreement"),
  ...Type.Omit(AgreementCore, ["content"]).properties,
  revision: Type.Integer({ minimum: 1 }),
  content: AgreementContent,                 // 현재 개정판
  status: AgreementStatus,
  activation: Nullable(Activation),
  pendingScopeChange: Nullable(Obj({ requested: Scope, reason: ShortText, questionId: QuestionId, seq: Seq })),
  /** 11 §3.11: 개정판을 바꾸지 않고 일시적으로 좁힌 범위. 범위 검사는 이것을 먼저 본다 (10 §3.6.6) */
  narrowedScope: Nullable(Obj({ scope: Scope, reason: ShortText, linkedQuestionId: Nullable(QuestionId), autonomy: Autonomy, seq: Seq })),
  /** 에이전트의 의도 재진술. 제안 때 함께 낸다. 사람 직접 작성이면 null */
  checkBack: Nullable(CheckBack),
  violations: Type.Array(Obj({ observationId: ObservationId, note: ShortText, seq: Seq })),
  quality: Quality,
});

/** 개정판 이력. 투영 p_agreement_revisions */
export const AgreementRevision = Obj({
  agreementId: AgreementId, revision: Type.Integer({ minimum: 1 }), content: AgreementContent,
  seq: Seq, by: ActorRefSchema, reason: Nullable(ShortText),
});
```

- 완료 기준은 개정판을 넘어 같은 `cr` id를 유지한다. 개정에서 바뀐 기준은 새 id를 받는다.
- 재작업 WorkUnit이 기존 합의 아래에서 시작하면 합의의 `workUnitId`는 처음 맡긴 WorkUnit을 그대로 가리킨다. 현재 연결은 `WorkUnit.agreementId`가 정한다([판정 J-158]).
- 사람이 합의를 바꾸면(조종, steering) 새 개정판이 생기고 이전 개정판 기준으로 낸 결과 제출은 낡는다(helm-kernel-v02 F5 [실험]).
- 원전 Delegation Contract 필드(F01 §4, F03 §3)와의 대응: requester = 사람(고정), performer = `performer`, purpose = `purpose`와 `goal`, conditions_of_satisfaction = `criteria`, authority_envelope = `scope`·`forbidden*`, evidence_obligations = `criteria[].evidenceExpected`, escalation_triggers = `stopConditions`, acceptor = 사람(고정, A6), integration_target = Concern과 Integration 레코드, review_at = `scope.validUntil`.
- 상태 기계: §3.22.4.

#### 3.11.2 Grant (맡겨 둔 권한, 비상 합의) [제안]

사람이 미리 맡겨 둔 범위다. 이 범위 안의 합의는 에이전트가 사람 확인 없이 활성화할 수 있다(압축된 C, v0.3 03 §5 예외). 비상 합의(C.emergency)는 혼돈 상황에만 쓰는 Grant다(v0.3 03 §3.3). helm-kernel-v02의 Authority Grant [실험]에서 effect class를 뺀 형태다.

```ts
// @helm/domain/src/records/grant.ts
export const GrantCore = Obj({
  grantKind: Type.Union([Type.Literal("standing"), Type.Literal("emergency")]),
  projectId: ProjectId,
  grantee: AgentActorSchema,
  purpose: Text,
  scope: Scope,
  expiresAt: Ms,                                           // 필수. 만료 없는 위임은 없다
  stopConditions: Type.Array(ShortText, { minItems: 1 }),  // 활성화된 합의가 반드시 포함해야 함
  appliesTo: Obj({
    concernIds: Nullable(Type.Array(ConcernId, { minItems: 1 })), // null이면 프로젝트 전체
    agreementKinds: Type.Array(AgreementKind, { minItems: 1 }),
    /** emergency: 현재 상황 판정이 이 유형일 때만 */
    situation: Nullable(SituationTypeSchema),
  }),
  /** 사람이 이 위임을 말한 발화 관찰 */
  sourceInstruction: Nullable(ObservationId),
  maxActivations: Nullable(Type.Integer({ minimum: 1 })),
});
export const Grant = Obj({
  ...Meta, kind: Type.Literal("grant"), ...GrantCore.properties,
  status: Type.Union([Type.Literal("active"), Type.Literal("revoked"), Type.Literal("expired"), Type.Literal("exhausted")]),
  activations: Type.Array(Obj({ agreementId: AgreementId, seq: Seq })),
});
```

포함 검사(`RequestedAuthority ⊆ CurrentAuthorityGrant`, 대화 L2128, F10 §6)는 10이 집행한다. 이 문서는 검사에 쓰는 데이터만 정한다. 비교 대상: `primitives ⊆`, 모든 `resources`가 Grant의 `resources`에 덮임, `sendTargets ⊆`, 각 `budget` 항목 ≤, 합의 `validUntil ≤ expiresAt`, 합의 `stopConditions ⊇` Grant `stopConditions`, `performer = grantee`, `agreementKind ∈ appliesTo.agreementKinds`, 비상이면 Concern의 현재 상황 판정 유형 = `appliesTo.situation`. 하나라도 어긋나면 사람 확인이 필요하다("이미 한 번 맡겼다"로 권한이 이어지지 않음, F10 §6).

### 3.12 A 루프 레코드: ResultSubmission, Attestation, Acceptance, Integration, Obligation, Reflection

[결정 15(2), 불변조건 5 / 필드: 제안. 출처: 대화 L2133–2141 (X3-2-11~15)]

```ts
// @helm/domain/src/records/assurance.ts
export const CriterionResult = Obj({
  criterionId: CriterionId,
  status: Type.Union([Type.Literal("met"), Type.Literal("unmet"), Type.Literal("unverified")]),
  /** 근거는 관찰 id만 (도구 결과, 사람·외부 출처) */
  evidence: Type.Array(ObservationId),
  /** 에이전트가 관찰 없이 문장으로만 낸 근거. 있으면 status는 unverified로 강등된다 */
  claimedText: Nullable(ShortText),
  downgraded: Type.Boolean(),
  note: Nullable(ShortText),
});
export const ResultSubmissionCore = Obj({
  workUnitId: WorkUnitId,
  agreementId: AgreementId,
  agreementRevision: Type.Integer({ minimum: 1 }),
  concernId: ConcernId,
  summary: Text,
  criteriaResults: Type.Array(CriterionResult, { minItems: 1 }),
  materialChanges: Type.Array(MaterialRef),          // 실제로 바뀐 것 (M 참조)
  limitations: Type.Array(ShortText),                // 알려진 한계 (검증하지 못한 범위 포함)
  unexpectedConsequences: Type.Array(ShortText),
  remainingUncertainty: Type.Array(ShortText),
  invalidationTriggers: Type.Array(Trigger),
  /** 결과 확인 때 반영 항목이 될 후보 (10 R-1 (a)). 레코드에 있어야 이벤트로 재구성할 수 있다 */
  integrationCandidates: Type.Array(Obj({ kind: ObligationKind, description: ShortText, targetRefs: Type.Array(AnyRecordId) })),
  /** 반영 WorkUnit의 합의 초안 (14 §3.6.8, [판정 J-126]). 결과 확인 화면에 구조 값으로 보인다 */
  integrationAgreementDraft: Nullable(Obj({ agreementId: AgreementId, content: AgreementContent })),
  /** 제출 시점에 승인을 기다리던 호출. 없으면 키를 뺀다 (10 §3.11.8). 뒤에 온 승인은 이 호출을 실행하지 않고 not_executed(approval_expired)로 닫는다 (10 §3.11.9) */
  awaitingApprovalCalls: Type.Optional(Type.Array(ToolCallId)),
  /** 휴대폰에서 이 결과를 확인할 수 있는지. 제출 시점에 런타임이 26 §3.5.4 기준으로 정해 싣는다. 재작업으로 새 제출이 생기면 그 제출에서 다시 정한다. 04 §3.12의 뷰는 이 값을 그대로 보인다 ([판정 J-203], [판정 J-225]) */
  mobileReviewable: Type.Boolean(),
});
export const ResultStatus = Type.Union([
  Type.Literal("submitted"),               // 결과 확인 필요
  Type.Literal("accepted"),
  Type.Literal("conditionally_accepted"),
  Type.Literal("revision_requested"),
  Type.Literal("rejected"),
  Type.Literal("criteria_wrong"),          // 기준 자체가 틀림 → I로
  Type.Literal("stale"),                   // 합의가 개정되어 기준이 바뀜
  Type.Literal("superseded"),              // 같은 WorkUnit의 새 제출
]);
export const ResultSubmission = Obj({
  ...Meta, kind: Type.Literal("result"), ...ResultSubmissionCore.properties,
  status: ResultStatus,
  /** 이 결과를 만든 실행들 (독립성 P 판정 입력, 대화 21(d) d20) */
  producerRunIds: Type.Array(RunId),
  /** 제출 뒤 관찰 (10 §3.13.1, 02 UC-03 단계 11). 제출 뒤 같은 WorkUnit의 호출에서 나온 관찰을 결과 확인 화면에 붙여 보이려고 기록에 쌓는다. 제출 payload에는 없다 */
  postSubmitObservations: Type.Array(ObservationId),
  attestationIds: Type.Array(AttestationId),
  acceptanceId: Nullable(AcceptanceId),
  quality: Quality,
});

export const AttestationCore = Obj({
  resultId: ResultId,
  criterionId: Nullable(CriterionId),
  verdict: Type.Union([Type.Literal("supports"), Type.Literal("challenges"), Type.Literal("insufficient")]),
  /** 검증 에이전트가 직접 실행해 얻은 관찰 */
  observations: Type.Array(ObservationId),
  note: Text,
  verifierRunId: RunId,
  model: Obj({ provider: Type.String({ minLength: 1 }), id: Type.String({ minLength: 1 }) }),
});
export const Attestation = Obj({ ...Meta, kind: Type.Literal("attestation"), ...AttestationCore.properties, quality: Quality });

export const AcceptanceDecision = Type.Union([
  Type.Literal("accepted"),            // 확인
  Type.Literal("conditional"),         // 조건 붙여 확인
  Type.Literal("revision_requested"),  // 수정 요청 (합의 유지, 진행 중으로)
  Type.Literal("rejected"),            // 거절
  Type.Literal("criteria_wrong"),      // 기준이 틀림 (I로)
]);
export const AcceptanceCore = Obj({
  resultId: ResultId,
  workUnitId: WorkUnitId,
  concernId: ConcernId,
  decision: AcceptanceDecision,
  /** conditional이면 1개 이상. 각 조건은 반영 항목이 된다 */
  conditions: Type.Array(ShortText),
  criteriaReview: Type.Array(Obj({
    criterionId: CriterionId,
    verdict: Type.Union([Type.Literal("confirmed"), Type.Literal("not_confirmed"), Type.Literal("waived")]),
    note: Nullable(ShortText),
  })),
  note: Nullable(ShortText),
  /** rejected·criteria_wrong일 때 어디로 다시 여는가 (X3-2-16 "다시 열림 C 또는 I로", 14 U-26).
   *  직전 I가 있으면 클라이언트가 그 루프를 기본값으로 채워 보내고, 없으면 사람이 고른다 ([판정 J-24]) */
  reopenTo: Nullable(Type.Union([Type.Literal("C.commit"), Type.Literal("I.fact"), Type.Literal("I.want")])),
  /** 반영 처리 방침 (04·05 결과 확인 화면, 10 R-1). defer_limits면 한도 항목을 같은 트랜잭션에서 미룬다 */
  obligationPolicy: Type.Union([Type.Literal("proceed_all"), Type.Literal("defer_limits")]),
  /** 반영 범위 합의를 같은 조작으로 확정함 ([판정 J-126]). 결과 제출의 integrationAgreementDraft를 가리킨다 */
  integrationAgreementId: Nullable(AgreementId),
});
export const Acceptance = Obj({
  ...Meta, kind: Type.Literal("acceptance"), ...AcceptanceCore.properties,
  decidedBy: Type.Literal("human"),
  /** 생성자와 확인자의 독립성 표시 (Assurance Cases 규칙 7, F05 §4) */
  independence: Obj({
    producerRunIds: Type.Array(RunId),
    attestationIds: Type.Array(AttestationId),
    verifierDistinctModel: Type.Boolean(),
  }),
});

export const IntegrationCore = Obj({
  acceptanceId: AcceptanceId, resultId: ResultId, workUnitId: WorkUnitId, concernId: ConcernId,
});
export const Integration = Obj({
  ...Meta, kind: Type.Literal("integration"), ...IntegrationCore.properties,
  status: Type.Union([Type.Literal("open"), Type.Literal("completed")]),
  obligationIds: Type.Array(ObligationId),
});

export const ObligationKind = Type.Union([
  Type.Literal("docs_tests"),           // 바뀐 파일과 관련된 문서·테스트
  Type.Literal("broken_premise"),       // 이 결과가 깨뜨린 이전 선택·전제
  Type.Literal("concern_conflict"),     // 다른 열린 Concern과의 충돌
  Type.Literal("acceptance_condition"), // 조건 붙여 확인의 조건
  Type.Literal("boundary_check"),       // S 루프 경계 항목 확인
  Type.Literal("recombine"),            // 하위 Concern 결과의 재조합 확인
  Type.Literal("goal_revision_check"),  // Goal 개정으로 다시 확인할 합의·선택
  Type.Literal("post_review"),          // 이의·재작업 뒤 다시 볼 것 (11)
  Type.Literal("other"),
]);
export const ObligationCore = Obj({
  integrationId: Nullable(IntegrationId),  // 재조합·Goal 개정 항목은 Concern에 직접 붙는다
  concernId: ConcernId,
  obligationKind: ObligationKind,
  description: Text,
  targetRefs: Type.Array(AnyRecordId),
  createdFrom: Type.Union([
    Obj({ kind: Type.Literal("kernel_rule"), rule: Type.String({ minLength: 1 }) }),
    Obj({ kind: Type.Literal("proposal"), by: ActorRefSchema }),
    Obj({ kind: Type.Literal("condition"), acceptanceId: AcceptanceId }),
  ]),
});
export const ObligationStatus = Type.Union([
  Type.Literal("open"), Type.Literal("resolved"), Type.Literal("deferred"),
  Type.Literal("transferred"), Type.Literal("waived"),
]);
export const Obligation = Obj({
  ...Meta, kind: Type.Literal("obligation"), ...ObligationCore.properties,
  status: ObligationStatus,
  resolution: Nullable(Obj({ refs: Type.Array(AnyRecordId), note: Nullable(ShortText), by: ActorRefSchema, seq: Seq })),
  /** 명시적 미루기: 이유와 다시 보일 조건 (대화 Q2) */
  deferral: Nullable(Obj({ reason: ShortText, revisitTrigger: Trigger, by: ActorRefSchema, seq: Seq })),
  transferredTo: Nullable(IdAny("cn", "wu")),
});

export const ReflectionCore = Obj({
  concernId: ConcernId,
  workUnitId: Nullable(WorkUnitId),
  /** "다음 합의에서 바꿀 것" 한 줄 (X3-2-15). 선택 사항이므로 레코드가 없을 수도 있다 */
  text: ShortText,
  aim: Type.Union([Type.Literal("agreement_template"), Type.Literal("policy"), Type.Literal("procedure"), Type.Literal("other")]),
  /** 14가 다음 합의 초안에 반영할 구조화한 변경. 없으면 text만 */
  nextAgreementChange: Nullable(Obj({
    part: Enum(["criteria", "scope", "forbidden", "stop_conditions", "evidence_required", "budget"]),
    change: ShortText,
  })),
});
export const Reflection = Obj({ ...Meta, kind: Type.Literal("reflection"), ...ReflectionCore.properties });
```

규칙 요약:

1. 결과 제출의 기준 결과는 해당 개정판의 모든 기준을 덮어야 한다(R-17, helm-kernel-v02 `policy.completion_evidence_incomplete` [실험]).
2. 근거가 관찰이 아니면 거부하지 않고 그 기준을 `unverified`로 강등한다(X3-2-11 "근거가 모델이 쓴 문장뿐이면 해당 기준은 확인 못함"). 존재하지 않는 관찰 id(지어낸 id)는 강등이 아니라 거부한다(`invalid.evidence_not_found`, helm-toy 거부 4·17).
3. 결과 확인은 사람만 한다(A6, 능력표). 검증 에이전트의 증언은 확인이 아니다.
4. 반영 항목이 하나라도 `open`이면 WorkUnit은 `accepted`(결과 확인됨)이고 완료(`integrated`)가 아니다(X3-2-14, A10).
5. `deferred` 항목은 처리된 것으로 보지만 복귀 요약 맨 위에 계속 보인다(X3-2-14). 다시 보일 조건(`revisitTrigger`)이 충족되면 `open`으로 돌아간다.
6. 반영 항목을 닫는 능력(integrate, 10 R-21과 같다): `docs_tests`·`boundary_check`·`recombine`은 근거 관찰 1개 이상과 함께 커널이 닫는다. `broken_premise`, `concern_conflict`, `acceptance_condition`, `goal_revision_check`는 사람만 닫는다. `post_review`·`other`는 사람이 닫는다. 면제(`obligation.waived`)는 종류와 무관하게 사람만 한다. 미루기는 에이전트가 제안할 수 있으며 미룬 사실과 이유가 복귀 요약에 보인다.

### 3.13 Question (질문) [결정 12 (구조) / 다이얼 수치·세부 필드: 제안]

질문 레코드는 묻기의 기록이다. 전달은 별도 결정이다(v0.3 06 §3.1). 전달 규칙과 중재자 동작은 11이 정한다.

```ts
// @helm/domain/src/records/question.ts
export const QuestionKind = Type.Union([
  Type.Literal("choice"),             // 선택 요청 (원함 탐구에서는 금지, R-23)
  Type.Literal("criterion_confirm"),  // 기준 후보를 선호 모델에 올려도 되는가
  Type.Literal("agreement_confirm"),  // 합의 확인 (사람 조작 1회)
  Type.Literal("result_review"),      // 결과 확인 (사람 조작 1회)
  Type.Literal("scope_change"),       // 범위 초과 → 선택 필요
  Type.Literal("send_approval"),      // 권리 게이트 행동 승인 (send와, 권한 레이어가 권리 범주로 본 execute·write를 함께 다룬다. 11의 action_approval)
  Type.Literal("goal_revision"),      // Goal 수정 확정
  Type.Literal("fact"),               // 사실을 묻는 정보 질문
  Type.Literal("reference_scope"),    // 참고 자료 범위
  Type.Literal("stop_condition"),     // 멈출 조건 충족 후 진행 여부
  Type.Literal("situation_confirm"),  // 상황 판정 확인
  // 아래는 정렬(§10)에서 더한 종류. 문장과 선택지는 05·11·14·15
  Type.Literal("emergency_authorization"), // 혼돈 상황의 비상 합의 확인 (14)
  Type.Literal("entry_suggestion"),   // Concern 진입 제안 (14)
  Type.Literal("progress_stall"),     // 진척 정체 (14)
  Type.Literal("structure_limit"),    // 구조 상한 초과 (14)
  Type.Literal("watch_verdict"),      // 지속 관찰 판정 확인 (14)
  Type.Literal("finding_confirm"),    // 판단 승격 확인 (14)
  Type.Literal("submission_missing"), // 결과 제출 없이 끝난 일 (14)
  Type.Literal("budget_extension"),   // 예산 늘리기 (12·14)
  Type.Literal("stimulus_round"),     // 다음 자극 묶음 반응 요청 (14·15)
  Type.Literal("triad"),              // 세 개 비교 (15)
  Type.Literal("reframe_confirm"),    // 문제 다시 세우기 확인 (15)
  Type.Literal("recovery"),           // 결과가 불확실한 도구 호출의 해소 (10·12)
  Type.Literal("semantic_conflict"),  // 결과가 다른 Concern의 선택과 의미상 충돌 (10 R-6, 11)
  Type.Literal("scope_violation"),    // 사후 검사에서 범위 밖 변경 발견 (10·11)
  Type.Literal("prediction_check"),   // 예측 확인 시점 (11·15)
  Type.Literal("kernel_error"),       // 커널이 판정하지 못함. 사람이 진행 여부를 정함 (11)
  Type.Literal("policy_change"),      // 관찰 에이전트 제안의 채택 여부 (16)
  Type.Literal("goal_achievement"),   // Goal 달성 확인 (권리 게이트, result_acceptance 범주, 형식 confirm_candidate. J-55)
  Type.Literal("other"),
]);
/** 왜 사람이 정해야 하는가 (paper-v0 Decision Gate reason에서 irreversible 제외, 결정 2) */
export const QuestionReason = Type.Union([
  Type.Literal("value_conflict"), Type.Literal("high_uncertainty"), Type.Literal("authority_boundary"),
  Type.Literal("disagreement"), Type.Literal("acceptance"), Type.Literal("integration"),
  Type.Literal("missing_context"),
]);
/** 11 RightsCategory. 앞 다섯은 권한 레이어(18), 뒤 다섯은 커널이 명령 종류로 안다 */
export const RightsCategory = Enum([
  "spend_money", "speak_for_user", "affect_others", "disclose_data", "irreversible_external",
  "goal_change", "result_acceptance", "commitment_acceptance", "policy_change", "authority_expansion",
]);
const Level3 = Grade;
/** 11 AskEvaluation: 정보 게이트 조건 1~3의 값과 문턱, 결과 */
export const AskEvaluation = Obj({
  c1: Obj({ value: Type.Boolean(), covered: Enum(["none", "kind_default", "system_policy", "user_policy"]),
            policyId: Nullable(Type.String({ maxLength: 64 })), threshold: Level3 }),
  c2: Obj({ value: Type.Boolean(), level: Type.Number(), threshold: Level3, unknownTreatedAs: Type.Number() }),
  c3: Obj({ value: Type.Boolean(), score: Type.Number(), threshold: Level3 }),
  combinator: Type.Literal("and"),
  forcedByObjection: Type.Boolean(),
  result: Enum(["policy", "autonomous", "digest", "ask"]),
});
/** 답이 없을 때 무엇이 멈추는가 (11 §3.2). nothing이면 막지 않는 질문 */
export const BlockScope = Type.Union([
  Type.Literal("nothing"), Type.Literal("action"), Type.Literal("workunit"), Type.Literal("concern"),
]);
export const DeliveryMode = Type.Union([
  Type.Literal("immediate"), Type.Literal("negotiated"), Type.Literal("mediated"), Type.Literal("scheduled"),
]);
const QuestionCommon = {
  concernId: ConcernId,
  workUnitId: Nullable(WorkUnitId),
  runId: Nullable(RunId),
  loop: Nullable(LoopIdSchema),
  questionKind: QuestionKind,
  reasons: Type.Array(QuestionReason, { minItems: 1, uniqueItems: true }),
  /** 질문 문장 구성 (v0.3 06 §3.4): 지금 정할 것, 왜 지금, 선택지와 추천, 가장 강한 다른 선택, 모르는 점, 미뤘을 때의 영향, 다시 볼 조건 */
  text: Text,
  whyNow: Nullable(ShortText),
  options: Type.Array(Obj({
    key: Type.String({ minLength: 1, maxLength: 32 }), label: ShortText, ref: Nullable(AnyRecordId),
    consequence: Nullable(ShortText),
    /** 이 선택지를 사람이 고르면 그 범위 안 합의를 확인 없이 활성할 수 있다 (R-OP-2(a), [판정 J-133]).
     *  커널 값 그대로 질문 화면에 보이고, 합의 범위 ⊆ 이 범위를 커널이 검사한다 */
    scope: Nullable(Scope),
  })),
  /** Decision Gate 필드 중 화면에 보이는 것 (04 §3.3). 질문 판단 기준, 선택의 결과, 이 답으로 생기는 약속 미리보기 */
  criteria: Type.Array(ShortText),
  consequences: Type.Array(ShortText),
  commitmentPreview: Nullable(ShortText),
  recommendation: Nullable(Obj({ optionKey: Type.String({ minLength: 1 }), why: ShortText })),
  strongestAlternative: Nullable(ShortText),
  unknowns: Type.Array(ShortText),
  delayImpact: Nullable(ShortText),
  reviewTrigger: Nullable(ShortText),
  evidence: Type.Array(AnyRecordId),
  /** 질문 대상: 합의 확인 → ag, 결과 확인 → rs, send 승인 → tc, Goal 수정 → gl */
  subjectRef: Nullable(AnyRecordId),
  /** send 승인: 도구 이름 + 정규화 인자의 해시. 승인은 이 지문의 호출 1회에만 쓰인다 (mastra-review §4) */
  approvalFingerprint: Nullable(Sha256),
  /** 답 형식 (Mastra suspendSchema/resumeSchema에 해당). JSON Schema */
  answerSchema: Type.Unsafe<Record<string, unknown>>(Type.Object({}, { additionalProperties: true })),
  delivery: Obj({ mode: DeliveryMode, decidedBy: ActorRefSchema }),
  batchKey: Nullable(Type.String({ minLength: 1, maxLength: 64 })),
  /** 정보 게이트 판정 기록 (11 AskEvaluation). 사람 접점 질문은 null */
  askEvaluation: Nullable(AskEvaluation),
  /** 질문 카드의 깊이 (04·11): 가볍게 / 일반 / 깊은 검토 */
  depth: Type.Union([Type.Literal("light"), Type.Literal("normal"), Type.Literal("deep")]),
  /** 같은 것을 묻는 질문 병합 키 (11 dedupe). 같은 키의 열린 질문이 있으면 question.updated로 합친다 */
  dedupeKey: Nullable(Type.String({ minLength: 1, maxLength: 200 })),
  /** 이 질문이 정하는 결정점 (AutonomousDecision과 같은 키 체계) */
  decisionKind: Nullable(Type.String({ pattern: "^[a-z][a-z0-9_.]{1,63}$" })),
  decisionPointKey: Nullable(Type.String({ minLength: 1, maxLength: 200 })),
  /** 권리 질문의 마감. 사람이 정한 경우에만 있다([판정 J-49], 11 V-Q-10): 사람 채널 명령이 만든 질문이거나 `question.deferred`와 함께 사람이 준 마감이다. 정보 게이트 질문과 시스템이 정한 질문은 null이다. 지나면 expired(가정으로 진행하지 않는다). 09 p_timers rights_deadline */
  deadline: Nullable(Ms),
  /** 가정하고 진행할 때 되돌릴 지점 (RollbackPoint, §3.18.3) */
  rollbackPointIds: Type.Array(RollbackPointId),
  /** 막고 있는 행동 (권리 게이트의 도구 호출 등) */
  blockedAction: Nullable(IdAny("tc", "ag", "wu", "rs")),
};
export const QuestionCore = Type.Union([
  /** 권리 게이트: 임시 가정으로 진행하지 않는다. 만료되어도 assumed로 가지 않는다 (helm-canon-3 C10) */
  Obj({ ...QuestionCommon, gate: Type.Literal("rights"), blocks: BlockScope,
        rightsCategories: Type.Array(RightsCategory, { minItems: 1, uniqueItems: true }),
        whyLocalInsufficient: Type.Null(), assumptionAnswer: Type.Null(),
        assumption: Type.Null(), assumptionExpires: Type.Null() }),
  /** 정보 게이트, 막힘: 답 없이는 이 일이 멈춘다 */
  Obj({ ...QuestionCommon, gate: Type.Literal("information"),
        blocks: Type.Union([Type.Literal("action"), Type.Literal("workunit"), Type.Literal("concern")]),
        rightsCategories: Type.Array(RightsCategory, { maxItems: 0 }),
        /** 에이전트가 혼자 정할 수 없는 이유 (Subsidiarity 규칙 2, 11 V-Q-01) */
        whyLocalInsufficient: ShortText, assumptionAnswer: Type.Null(),
        assumption: Type.Null(), assumptionExpires: Nullable(Trigger) }),
  /** 정보 게이트, 막히지 않음: 임시 가정과 가정 만료점이 필수 */
  Obj({ ...QuestionCommon, gate: Type.Literal("information"), blocks: Type.Literal("nothing"),
        rightsCategories: Type.Array(RightsCategory, { maxItems: 0 }),
        whyLocalInsufficient: ShortText,
        /** 임시 가정을 답 값으로 쓴 것. matchesAssumption 비교에 쓴다 (11 §3.6.4) */
        assumptionAnswer: Type.Unknown(),
        assumption: Obj({ text: ShortText, assumptionId: AssumptionId }),
        assumptionExpires: Trigger }),
]);
export const QuestionStatus = Type.Union([
  Type.Literal("pending"), Type.Literal("delivered"), Type.Literal("answered"),
  Type.Literal("assumed"), Type.Literal("withdrawn"), Type.Literal("expired"),
  /** 사람이 "맡긴다"고 답함 (question.delegated). 이후 결정은 whyNotAsked = delegated_by_human */
  Type.Literal("delegated"),
]);
export const Question = MergeEach(
  Obj({
    ...Meta, kind: Type.Literal("question"),
    status: QuestionStatus,
    /** 중재자·규칙이 정한 전달 계획 (11 delivery.planned). 혼자 정한 결정이며 이의 대상 */
    plannedDelivery: Nullable(Obj({ at: Nullable(Ms), boundary: Nullable(Trigger), bundleId: Nullable(Type.String({ minLength: 1, maxLength: 64 })),
                                    autonomy: Autonomy, seq: Seq })),
    /** 사람이 질문을 본 시각 (question.seen) */
    seenAt: Nullable(Ms),
    /** 병합된 원 제출 수 (question.updated) */
    mergedCount: Type.Integer({ minimum: 0 }),
    deliveredAt: Nullable(Ms),
    deliveredTo: Type.Array(DeviceId),
    escalations: Type.Array(Obj({
      to: Type.Literal("immediate"),
      cause: Type.Union([Type.Literal("expiry_near"), Type.Literal("human"), Type.Literal("policy")]),
      seq: Seq,
    })),
    answer: Nullable(Obj({
      value: Type.Unknown(), by: Type.Literal("human"), via: Via, seq: Seq,
      /** 임시 가정과 같은 답이었는가 (v0.3 06 §7 지표). 정보 게이트·비막힘만 */
      matchesAssumption: Nullable(Type.Boolean()),
    })),
    /** 가정 확정 때 만든 선택 */
    resolutionChoiceId: Nullable(ChoiceId),
    /** send 승인이 소진된 도구 호출. 사람이 인자를 고쳐 승인하면 subjectRef와 다른 새 도구 호출일 수 있다 (11 §3.14) */
    consumedByToolCallId: Nullable(ToolCallId),
    /** send 승인 (11 §3.14 ApprovalToken). 레코드 종류를 따로 두지 않고 질문 안에 둔다. 한 번 쓰면 consumed */
    approval: Nullable(Obj({
      approvalId: Id("ap"),
      fingerprint: Sha256,
      expiresAt: Ms,
      status: Type.Union([Type.Literal("issued"), Type.Literal("consumed"), Type.Literal("expired"), Type.Literal("revoked")]),
      seq: Seq,
    })),
    /** 사람이 "나중에"를 고른 기록 (question.deferred, 19). 상태는 그대로 */
    deferrals: Type.Array(Obj({ until: Nullable(Trigger), via: Via, seq: Seq })),
    /** 사람이 질문을 다시 세워 달라고 함 (question.reframe_requested). 새 질문이 오면 이 질문은 withdrawn */
    reframeRequest: Nullable(Obj({ note: Nullable(ShortText), seq: Seq })),
  }),
  QuestionCore,
);
```

- 권리 게이트 질문은 임시 가정을 갖지 않는다. 막는 범위(`blocks`)는 보통 `action`이고, 막히는 것은 그 질문의 대상 행동뿐이다. 아직 시도하지 않은 행동을 미리 묻는 권리 질문은 `blocks = "nothing"`일 수 있다(11). 같은 Concern의 다른 일은 계속된다(v0.3 06 §6 Q-15). 이 범위 판정은 11·12가 한다.
- 원함 탐구(`loop = "I.want"`)에서 `questionKind = "choice"`이고 선택지가 2개 이상인 질문은 거부한다(결정 18, v0.3 06 §3.4 끝). 원함 탐구의 질문은 기준 후보 확인(`criterion_confirm`)이나 사실 질문이다.
- 사람 조작 2회 상한(대화 L2160): 합의 확인(`agreement_confirm`)과 결과 확인(`result_review`)이 C/A의 두 번이다. 그 밖의 질문을 줄이는 규칙은 11·14가 정한다.
- 상태 기계: §3.22.7.

### 3.14 Expectation, Prediction

#### 3.14.1 Expectation (기대) [제안: v0.3 03 §7.2]

외부에 요청을 보낼 때 남기는 기한 있는 기록이다. 응답이 없는 것은 관찰되지 않으므로, 기한이 지나면 스케줄러가 "응답 없음" 관찰을 만든다.

```ts
// @helm/domain/src/records/expectation.ts
export const ExpectationCore = Obj({
  concernId: ConcernId,
  to: ExternalActorSchema,
  what: ShortText,
  channel: ShortText,
  sentVia: Type.Union([
    Obj({ kind: Type.Literal("tool"), toolCallId: ToolCallId }),          // send 도구 호출
    Obj({ kind: Type.Literal("human_report"), commandId: CommandId }),    // 사람이 보냈다고 알림
  ]),
  sentAt: Ms,
  dueAt: Ms,                       // 절대 시각. 기본값은 11이 정한다 ([제안] 72시간)
});
export const Expectation = Obj({
  ...Meta, kind: Type.Literal("expectation"), ...ExpectationCore.properties,
  status: Type.Union([
    Type.Literal("open"), Type.Literal("fulfilled"), Type.Literal("timed_out"),
    Type.Literal("late_fulfilled"), Type.Literal("cancelled"),
  ]),
  responseObservationIds: Type.Array(ObservationId),
  noResponseObservationId: Nullable(ObservationId),
});
```

#### 3.14.2 Prediction (예측) [결정 7(결과 탐구) / 레코드: 제안]

```ts
// @helm/domain/src/records/prediction.ts
export const PredictionCore = Obj({
  concernId: ConcernId,
  inquiryId: Nullable(InquiryId),
  choiceId: Nullable(ChoiceId),
  statement: Text,
  basis: Type.Array(IdAny("ob", "in", "ps", "fd"), { minItems: 1 }),
  failurePaths: Type.Array(Obj({
    path: ShortText, mitigation: Nullable(ShortText), watchSignal: Nullable(ShortText),
    impact: Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]), // 서열. 확률 아님 (15)
  })),
  /** 확인할 날짜나 조건과 방법. 기계 판정할 수 없는 트리거(manual)는 거부 (v0.3 04 §5.6) */
  check: Obj({ trigger: Trigger, method: ShortText }),
});
export const Prediction = Obj({
  ...Meta, kind: Type.Literal("prediction"), ...PredictionCore.properties,
  status: Type.Union([Type.Literal("open"), Type.Literal("checked"), Type.Literal("void")]),
  result: Nullable(Obj({
    verdict: Type.Union([Type.Literal("held"), Type.Literal("failed"), Type.Literal("partial"), Type.Literal("indeterminate")]),
    observations: Type.Array(ObservationId),
    note: Nullable(ShortText),
    by: ActorRefSchema,
    seq: Seq,
  })),
  quality: Quality,
});
```

예측 확인 결과는 모델 품질 평가 자료가 된다(v0.3 04 §5.5, 16). `failed`이면 관련 관찰에 `surprise` 주석이 붙고, 상황 재판정 신호가 된다(v0.3 05 §4.2, 14).

### 3.15 루프와 상황: LoopId, LoopPlan, LoopTransition, SituationAssessment, ModeAssignment

[결정 5(루프 조합과 전환), 6(상황 유형은 바뀌는 상태) / 레코드: 제안. 루프의 의미와 전환 규칙은 14]

```ts
// @helm/domain/src/loop.ts
export const LOOP_IDS = [
  "O",
  "I.fact", "I.want", "I.possibility", "I.outcome",
  "C.commit", "C.probe", "C.emergency",
  "A.confirm", "A.watch", "A.reflect",
  "S.split", "S.merge", "S.detach", "S.relocate", "S.recombine", "S.hold", "S.close",
] as const; // v0.3 03 §2.1
export type LoopId = (typeof LOOP_IDS)[number];
export const LoopIdSchema = Enum(LOOP_IDS);
export const loopFamily = (l: LoopId): "O" | "I" | "C" | "A" | "S" => l[0] as never;

export const SITUATION_TYPES = ["clear", "complicated", "complex", "chaotic", "disorder"] as const;
export const SituationTypeSchema = Enum(SITUATION_TYPES);

// @helm/domain/src/records/loop-plan.ts
/** 계획 단계와 계기 이름의 정본은 14 §3.8 (PlanStep, PlanCause). 08은 저장 모양만 정한다 */
export const PlanStep = Obj({
  key: Type.String({ minLength: 1, maxLength: 16 }),        // 버전이 바뀌어도 유지되는 단계는 같은 key
  loops: Type.Array(LoopIdSchema, { minItems: 1 }),
  pairWith: Nullable(LoopIdSchema),                         // "⇄" 구간
  until: Type.Array(Type.String({ minLength: 1, maxLength: 64 })), // 14 PredicateRef
  optional: Type.Boolean(),
  reason: Nullable(ShortText),
});
/** 계획 플래그 한 개. 값과 무관하게 근거 id를 하나 이상 가진다 (14 §3.8) */
export const Flag = Obj({ value: Type.Boolean(), evidence: Type.Array(AnyRecordId, { minItems: 1 }) });
/** O의 assess WorkUnit이 선언하는 계획 플래그. 여섯 표시는 14 §3.8 정본이다. outOfPattern은 여섯 표시로 이 상황을 나타낼 수 없을 때 참이며, 근거가 필수다 ([판정 J-188]) */
export const PlanFlags = Obj({
  wantDependent: Flag,              // 정답이 사용자 취향·가치 판단에 달림
  needsPossibilities: Flag,         // 알려진 해법이 없거나 부족함
  consequentialSideEffects: Flag,   // 선택이 부작용·파급을 가짐
  needsWrite: Flag,                 // 작업 대상을 바꿔야 끝남
  reviewOnly: Flag,                 // 이미 있는 결과를 확인하는 일
  artifactIsResult: Flag,           // 산출물(글·보고서·계획)이 곧 결과
  outOfPattern: Flag,               // 여섯 표시와 계산 규칙의 범위 밖 ([판정 J-188])
});
export const LoopPlanCore = Obj({
  concernId: ConcernId,
  situationAssessmentId: Nullable(AssessmentId),
  combo: Type.Array(LoopIdSchema, { minItems: 1 }),   // planDetail.steps를 펼친 루프 목록. 계획일 뿐 (v0.3 03 §1)
  /** 14 §3.8.1 계획 정의의 나머지 (D-14 정렬). 이름 `version`은 RecordMeta와 겹쳐 planVersion으로 쓴다 */
  planVersion: Type.Integer({ minimum: 1 }),
  planDetail: Obj({
    steps: Type.Array(PlanStep, { minItems: 1 }),
    /** 계획을 만들 때 쓴 선언 (14 §3.8.1 flags). 근거 id를 가진 PlanFlags다. 문자열 목록이 아니다 */
    flags: PlanFlags,
    completedStepKeys: Type.Array(Type.String({ minLength: 1, maxLength: 16 })),
    /** 건너뛴 루프(또는 루프 계열)와 이유. 14 §3.8.1이 이유를 만든다 [판정 J-347] */
    skipped: Type.Array(Obj({ loop: Type.String({ minLength: 1, maxLength: 16 }), reason: ShortText })),
    cause: Enum(["initial", "situation_changed", "deviation", "mode_changed", "directive",
      "structure", "contested", "reopened", "maturity_gate", "procedure"]),
    proofBurdenRequired: Nullable(Obj({ level: Type.String({ minLength: 1 }), signals: Type.Array(ShortText) })),
    modeId: Nullable(ModeId),
    procedureId: Nullable(ProcedureId),
  }),
  /** 계획 내용을 쓴 주체 ([판정 J-188] (5)). code: buildPlan이 계산. model: 모델 초안이 계획 검사를 통과함. human: 사람이 고침. 채택 주체는 autonomy.decidedBy다 */
  authoredBy: Enum(["code", "model", "human"]),
  reason: Text,
  autonomy: Autonomy,
  supersedes: Nullable(LoopPlanId),
});
export const LoopPlan = Obj({
  ...Meta, kind: Type.Literal("loop_plan"), ...LoopPlanCore.properties,
  status: Type.Union([Type.Literal("active"), Type.Literal("superseded")]),
  quality: Quality,
});

/** 전환 계기 (v0.3 03 §6 표의 행) */
export const TransitionTrigger = Type.Union([
  Type.Literal("plan"),                    // 루프 계획대로
  Type.Literal("surprise"),                // 새로운 놀라운 관찰
  Type.Literal("goal_conflict"),           // 탐구 중 목적 충돌
  Type.Literal("out_of_scope"),            // 실행 중 권한 밖 문제
  Type.Literal("insufficient_evidence"),   // 확인 중 근거 부족
  Type.Literal("shared_premise_conflict"), // 반영 중 공유 전제 충돌
  Type.Literal("reflection"),              // 돌아보기 결과
  Type.Literal("situation_changed"),       // 상황 유형 변경
  Type.Literal("unexpected_result"),       // 명확 상황에서 예상 밖 결과
  Type.Literal("unresolved"),              // 결과 확인에서 해결 안 됨
  Type.Literal("revision_requested"),      // 결과 확인에서 수정 요청
  Type.Literal("criteria_wrong"),          // 기준이 틀림
  Type.Literal("probe_grow"), Type.Literal("probe_fold"),
  Type.Literal("split_needed"), Type.Literal("merge_needed"),
  Type.Literal("expectation_timeout"),     // 기대 기한 초과
  Type.Literal("preference_changed"),
  Type.Literal("prediction_due"),
  Type.Literal("assumption_expiry"),
  Type.Literal("objection"),               // 이의로 다시 열림
  Type.Literal("human_directive"),         // 사용자의 직접 지시
  Type.Literal("contract_exit"),           // 루프 계약의 종료 결과 (14 ruleId EXIT)
  Type.Literal("open"),                    // Concern을 연 첫 진입 (14 ruleId OPEN)
  Type.Literal("entry_redirect"),          // 진입 조건 미충족으로 돌림 (14 ruleId REDIRECT)
]);
/** 14 §3.9.2 규칙 id. T01~T32와 EXIT, OPEN, REDIRECT. 규칙과 TransitionTrigger의 대응표는 14 */
export const TransitionRuleId = Type.String({ pattern: "^(T[0-9]{2}|EXIT|OPEN|REDIRECT)$" });
/** 14 ExitOutcome. 목록 정본은 14 */
/** 루프 계약 종료 결과. 값 목록의 정본은 14 §3.5(ExitOutcome)이며 08은 같은 값을 저장 스키마로 둔다.
 *  14가 값을 바꾸면 이 열거를 함께 고친다(이름은 @helm/domain 한 곳에서만 정의한다) */
export const ExitOutcome = Enum([
  "planned", "disorder", "stop_rule_met", "budget_exhausted", "autonomy_exhausted", "reframe_needed",
  "submitted", "scope_exceeded", "stop_condition_met", "grow", "fold", "inconclusive", "continue", "stabilized",
  "accepted_integrated", "revision_requested", "rejected_unresolved", "criteria_wrong", "reflected", "structured",
  "children_created", "closed",
]);
export const LoopTransitionCore = Obj({
  concernId: ConcernId,
  workUnitId: Nullable(WorkUnitId),
  from: Nullable(LoopIdSchema),
  to: LoopIdSchema,
  trigger: TransitionTrigger,
  triggerRefs: Type.Array(AnyRecordId),    // 계기가 된 관찰·레코드
  reason: Text,
  /** 계획에서 건너뛴 루프. I를 건너뛴 O → C도 정상이며 건너뛴 사실만 기록한다 (대화 L3614) */
  skipped: Type.Array(LoopIdSchema),
  ruleId: TransitionRuleId,
  exitOutcome: Nullable(ExitOutcome),
  /** 계기 이벤트 (14 trigger.eventId). 멱등 키 `${triggerEventId}:${ruleId}`의 앞부분 */
  triggerEventId: Nullable(EventId),
  planDeviation: Type.Boolean(),           // 계획에 없던 이동
  restart: Type.Boolean(),                 // 같은 루프로 다시 들어감 (14 G7). from = to일 때만 true
  autonomy: Autonomy,
});
export const LoopTransition = Obj({
  ...Meta, kind: Type.Literal("loop_transition"), ...LoopTransitionCore.properties, quality: Quality,
});

// @helm/domain/src/records/situation.ts
/** 판정 질문 id 9개 (14 §3.7.1). 질문 문장과 판정표는 14 */
export const SituationQuestionId = Enum([
  "q.urgent_harm", "q.no_time_for_cause", "q.done_before", "q.procedure_exists",
  "q.analysis_converges", "q.expert_knows", "q.taste_or_reaction", "q.unpredictable", "q.mixed_parts",
]);
export const SituationAnswer = Obj({
  questionId: SituationQuestionId,
  answer: Type.Union([Type.Literal("yes"), Type.Literal("no"), Type.Literal("unknown")]),
  /** yes·no는 1개 이상 (R-47). 절차 레지스트리로 채운 q.procedure_exists는 pd id */
  evidence: Type.Array(IdAny("ob", "in", "fd", "pd")),
  note: Nullable(ShortText),
});
export const SituationAssessmentCore = Obj({
  concernId: ConcernId,
  situation: SituationTypeSchema,
  /** 판정 질문의 답과 근거 (v0.3 05 §2 판정 질문). 근거 없는 판정은 기록하지 않는다 (05 §3.2 규칙 5) */
  answers: Type.Array(SituationAnswer, { minItems: 1 }),
  /** q.mixed_parts = yes일 때 부분별 판정 (disorder → S.split 재료) */
  parts: Type.Array(Obj({ label: ShortText, situation: SituationTypeSchema })),
  alternative: Nullable(SituationTypeSchema),  // 확신이 낮으면 대안 유형
  confidence: Grade,                           // 숫자 아님 (D08-10)
  previousType: Nullable(SituationTypeSchema),
  trigger: Obj({ eventId: Nullable(EventId), signal: Nullable(Type.String({ minLength: 1, maxLength: 32 })) }),
  /** 판정표 버전 (예: "decision_table@1", 14) */
  computedBy: Type.String({ pattern: "^[a-z_]+@[0-9]+$" }),
  autonomy: Autonomy,
  supersedes: Nullable(AssessmentId),
});
export const SituationAssessment = Obj({
  ...Meta, kind: Type.Literal("situation_assessment"), ...SituationAssessmentCore.properties,
  status: Type.Union([Type.Literal("current"), Type.Literal("superseded")]),
  quality: Quality,
});

// @helm/domain/src/records/mode.ts
/** 모드 8개 (14 §3.10.2). 이름과 뜻의 정본은 14 */
export const MODE_IDS = ["orient", "investigate", "deliberate", "taste", "execute", "verify", "restructure", "emergency"] as const;
export const ModeId = Enum(MODE_IDS);
export const ModeAssignmentCore = Obj({
  target: IdAny("cn", "wu"),
  mode: ModeId,
  signals: Type.Array(Obj({
    signal: Type.Union([
      Type.Literal("situation"), Type.Literal("entry_conditions"), Type.Literal("input_form"),
      Type.Literal("explicit"), Type.Literal("history"),
    ]),
    ref: Nullable(AnyRecordId),
    note: ShortText,
  }), { minItems: 1 }),
  autonomy: Autonomy,   // 라우터가 고르면 autonomous (v0.3 07 §5.3)
  supersedes: Nullable(ModeAssignmentId),
});
export const ModeAssignment = Obj({
  ...Meta, kind: Type.Literal("mode_assignment"), ...ModeAssignmentCore.properties,
  status: Type.Union([Type.Literal("active"), Type.Literal("superseded")]),
  quality: Quality,
});

// @helm/domain/src/records/dial.ts
/** 다이얼 정본 목록. DIAL_KEYS 키 20개 = 다이얼 키 18개(항목 16) + 구조 설정 키 2개. 다이얼 키 18개는 v0.3 07 §3의 14개 + assurance 2 + 계획 작성 방식 1 + 가정 보류 다이얼 1이다 ([판정 J-197], [판정 J-221], [판정 J-300]). 구조 설정 키 2개는 구조 상한이다. 키 이름과 값의 의미는 14가 확정한다. 의미 설정(다이얼이 아닌 설정, 예: 주의 예산)은 이 목록에 들지 않는다 */
export const DIAL_KEYS = [
  "question.threshold.c1", "question.threshold.c2", "question.threshold.c3",
  "question.default_delivery", "question.immediate_threshold", "question.expiry_margin",
  "question.kind_exceptions", "question.per_loop",
  "inquiry.breadth", "inquiry.depth", "inquiry.evidence_range", "inquiry.autonomy_rounds",
  "inquiry.budget", "inquiry.stimulus_count",
  "assurance.proof_burden", "assurance.independent_verification",
  "structure.max_children", "structure.max_depth",
  "planAuthoring",   // 루프 계획 작성 방식 ([결정 53], [판정 J-188])
  "assumptionDeferOnDowntime", // 데몬 정지 중 가정 만료 미루기를 끄는 장치. 점 표기 예외 ([판정 J-197], [판정 J-221])
] as const;
export const DialKey = Enum(DIAL_KEYS);
/** 저장되는 층만 (v0.3 07 §6의 4~6층). 1~3층(시스템, 상황 유형, 모드)은 코드·데이터.
 *  14의 해석 순서(1~6)는 DialPrecedence라는 다른 이름이다. 대응: user = 4, concern = 5, instruction = 6.
 *  Goal 범위 다이얼은 두지 않는다([판정 J-136]) */
export const DialLayer = Type.Union([Type.Literal("user"), Type.Literal("concern"), Type.Literal("instruction")]);
/** 루프 계획 작성 방식 ([결정 53], [판정 J-188]). 값은 computed | hybrid | model이다. computed: 코드가 계획을 계산하고 모델 초안을 받지 않는다. hybrid: 기본값. outOfPattern이 참이거나 buildPlan에 맞는 규칙이 없을 때만 모델이 계획 전체 초안을 낸다. model: 언제나 모델이 초안을 낸다 */
// 다이얼 정의 항목 (14 SettingDef 형식, 데이터는 §6 dials.ts): key "planAuthoring", kind "dial", valueSchema Enum(["computed", "hybrid", "model"]), default "hybrid", layers ["user", "concern"]. instruction 층에는 두지 않는다
export const DialSetting = Obj({
  layer: DialLayer,
  scopeId: Nullable(IdAny("cn", "wu")),  // user 층은 null
  key: DialKey,
  value: Type.Unknown(),                  // 값 스키마는 14의 키별 정의로 검증
  setBy: ActorRefSchema,
  seq: Seq,
  reason: Nullable(ShortText),
});
```

- Concern의 `currentLoop`은 마지막 `LoopTransition.to`다. 루프 전환은 혼자 정한 결정이며 이의 대상이다(v0.3 03 §1 원칙 3).
- 의존 규칙 검사(write·send에는 C, 완료에는 A, 승격에는 I 근거)는 전환 뒤의 행동에서 집행한다(10). 전환 자체는 검사하지 않는다. 루프 전환 레코드는 어떤 루프로든 옮길 수 있다(결정 5).
- 상황 판정이 바뀌면 이전 판정은 `superseded`가 되고, 루프 계획 재제안이 따른다(14).
- 계획 작성 방식(`planAuthoring`, [결정 53], [판정 J-188])은 다이얼이다(14 §3.11.1). `computed`는 코드가 계획을 계산하고 모델 초안을 받지 않는다. `hybrid`(기본)는 `PlanFlags.outOfPattern`이 참이거나 `buildPlan`에 맞는 규칙이 없을 때만 모델이 계획 전체 초안(제안 종류 `loop_plan_draft`, payload `steps`)을 낸다. `model`은 언제나 모델이 초안을 낸다.
- 모델 초안은 10의 계획 검사(활성 합의 전 쓰기 금지, 결과 뒤 결과 확인, 성숙도 관문 등 의존 규칙)를 통과해야 `loop_plan.adopted`가 된다. 위반이면 사유와 함께 모델에 한 번 돌려준다. 두 번째도 위반이면 코드 계산 계획을 쓰고(`authoredBy = code`) 그 사실을 거부 기록으로 남긴다(10, 09).
- `authoredBy`는 계획 내용을 누가 썼는가이고, `autonomy.decidedBy`는 누가 채택했는가다. 기록과 이의(결정 8)는 두 값 모두에 그대로 적용된다. 계획 이의 비율(16)은 `authoredBy`별로 센다.
- `PlanFlags`의 모든 플래그는 근거 id를 하나 이상 가진다(14 §3.8). `outOfPattern`이 참이면 근거에 여섯 표시로 이 상황을 나타낼 수 없는 이유를 적는다([판정 J-188]).

### 3.16 Probe, Watch [제안: v0.3 03 §3.3]

#### 3.16.1 Probe (탐침)

```ts
// @helm/domain/src/records/probe.ts
export const ProbeCore = Obj({
  concernId: ConcernId,
  workUnitId: WorkUnitId,             // workKind = "probe"
  hypothesisId: PossibilityId,        // 확인하려는 가설
  growCondition: ShortText,           // 키울 조건 (사람이 읽는 문장)
  foldCondition: ShortText,           // 접을 조건
  /** 기계 판정용 조건. 술어 이름과 인자 형식은 14 §3.12 (PredicateRef) */
  conditions: Obj({
    grow: Type.Array(Obj({ predicate: Type.String({ minLength: 1, maxLength: 64 }), args: Type.Record(Type.String(), Type.Unknown()) })),
    fold: Type.Array(Obj({ predicate: Type.String({ minLength: 1, maxLength: 64 }), args: Type.Record(Type.String(), Type.Unknown()) })),
  }),
  budget: Budget,
  watchSignals: Type.Array(ShortText),
});
export const Probe = Obj({
  ...Meta, kind: Type.Literal("probe"), ...ProbeCore.properties,
  status: Type.Union([
    Type.Literal("planned"), Type.Literal("running"), Type.Literal("grown"),
    Type.Literal("folded"), Type.Literal("inconclusive"), Type.Literal("exhausted"), Type.Literal("cancelled"),
  ]),
  outcome: Nullable(Obj({ observations: Type.Array(ObservationId, { minItems: 1 }), note: ShortText, autonomy: Autonomy, seq: Seq })),
});
```

탐침 결과는 관찰로 기록되고(판단으로 바로 올리지 않는다), 다시 I나 A로 넘어간다(v0.3 03 §3.3). `grown`이면 약속형 C의 새 합의를 제안하는 루프 전환이 따른다. `inconclusive`는 예산 안에서 어느 조건도 충족되지 않은 판정이며, 14의 `exitOutcome = inconclusive`와 같다.

#### 3.16.2 Watch (지속 관찰) [제안: 14 U-27 (a)]

탐침이 아닌 결과(반영한 변경, 비상 조치)를 기간을 두고 지켜보는 레코드다(A.watch). 판정은 혼자 정한 결정이며 이의 대상이다.

```ts
// @helm/domain/src/records/watch.ts
export const WatchCore = Obj({
  concernId: ConcernId,
  workUnitId: Nullable(WorkUnitId),
  subject: IdAny("ig", "ac", "gr", "rs", "pb"),   // 지켜볼 대상
  signals: Type.Array(Obj({ description: ShortText, predicate: Nullable(Type.String({ minLength: 1, maxLength: 64 })) }), { minItems: 1 }),
  window: Trigger,                                  // 언제 판정하는가 (보통 at)
  goodIf: ShortText,
  badIf: ShortText,
});
export const Watch = Obj({
  ...Meta, kind: Type.Literal("watch"), ...WatchCore.properties,
  status: Type.Union([Type.Literal("watching"), Type.Literal("judged"), Type.Literal("cancelled")]),
  verdict: Nullable(Obj({
    outcome: Type.Union([Type.Literal("stable"), Type.Literal("regressed"), Type.Literal("inconclusive")]),
    observations: Type.Array(ObservationId),
    autonomy: Autonomy,
    seq: Seq,
  })),
  quality: Quality,
});
```

이벤트는 `watch.defined`, `watch.window_closed`, `watch.judged`, `watch.cancelled`다(09 §3.4.10). 기한 타이머는 09 `p_timers`의 `watch_window`다.

### 3.17 탐구 레코드: Inquiry, Stimulus, Reaction, PreferenceModel, Lens

[결정: 탐구 네 종류(결정 7), 원함 탐구에서 반응 기록(결정 18), Method Transfer 이름(결정 13) / 레코드: 제안. 실행 절차는 15]

#### 3.17.1 Inquiry와 발산 표

```ts
// @helm/domain/src/records/inquiry.ts
export const InquiryKind = Type.Union([
  Type.Literal("fact"), Type.Literal("want"), Type.Literal("possibility"), Type.Literal("outcome"),
]);
/** 15 Direction. 발산 방향 */
export const Direction = Enum(["up", "down", "side", "invert", "lens"]);
export const Perspective = Obj({
  key: Type.String({ pattern: "^p[0-9]{1,3}$" }),
  label: ShortText,
  lensId: Nullable(LensId),               // Method Transfer 렌즈로 만든 관점 (v0.3 04 §4.2: 최소 하나)
  predicts: Nullable(ShortText),          // 이 관점이 맞다면 관찰될 것 (사실 탐구 1단계)
  refutedBy: Nullable(ShortText),         // 반박 조건
  /** 아래 셋은 15 §3.4 발산 표의 행 */
  possibilityId: Nullable(PossibilityId),
  direction: Nullable(Direction),
  /** 렌즈 전이 단계 기록 (15 TransferSteps). 모양은 15 */
  transfer: Nullable(Type.Record(Type.String(), Type.Unknown())),
});
export const DivergenceCell = Obj({
  key: Type.String({ pattern: "^p[0-9]{1,3}:t[0-9]{1,2}$" }),
  perspectiveKey: Type.String({ minLength: 1 }),
  targetIndex: Type.Integer({ minimum: 0 }),
  state: Type.Union([Type.Literal("empty"), Type.Literal("filled"), Type.Literal("not_applicable")]),
  reason: Nullable(ShortText),           // not_applicable은 이유가 있어야 닫힌다 (v0.3 04 §4.2)
  possibilityIds: Type.Array(PossibilityId),
  branchRunId: Nullable(RunId),
});
export const InquiryCore = Obj({
  concernId: ConcernId,
  workUnitId: Nullable(WorkUnitId),
  /** 이 탐구에 쓰인 WorkUnit 전부 (가지 실행 포함, 15) */
  workUnitIds: Type.Array(WorkUnitId),
  inquiryKind: InquiryKind,
  loop: LoopIdSchema,                     // I.fact | I.want | I.possibility | I.outcome
  question: Text,
  budget: Obj({
    rounds: Type.Integer({ minimum: 1 }),
    subcalls: Type.Integer({ minimum: 0 }),
    durationMs: Nullable(DurationMs),
  }),
  dialSnapshot: Type.Record(Type.String(), Type.Unknown()), // 시작 시점 다이얼 값
  perspectives: Type.Array(Perspective),
  /** 발산 표의 열(바꾸는 대상). 기본값은 15 */
  targets: Type.Array(ShortText),
});
export const Inquiry = Obj({
  ...Meta, kind: Type.Literal("inquiry"), ...InquiryCore.properties,
  status: Type.Union([Type.Literal("open"), Type.Literal("stopped")]),
  rounds: Type.Array(Obj({
    n: Type.Integer({ minimum: 0 }),      // 0 = 사람 입력 전 준비 라운드 (15)
    /** 계획 지문. 멈춤 판정 입력 (15 §3.4.14). 중복 실행은 단계 멱등 키가 막는다 */
    planHash: Nullable(Sha256),
    startedSeq: Seq,
    closedSeq: Nullable(Seq),
    /** 라운드 끝의 1순위 후보 또는 선호 모델 버전. 멈춤 판정 입력 (v0.3 04 §1 표) */
    leaderRef: Nullable(AnyRecordId),
    leaderVersion: Nullable(Type.Integer({ minimum: 1 })),
  })),
  cells: Type.Array(DivergenceCell),
  used: Obj({ rounds: Type.Integer({ minimum: 0 }), subcalls: Type.Integer({ minimum: 0 }), durationMs: DurationMs }),
  stop: Nullable(Obj({
    /** 정본 값. 15 StopReason과 10 payload는 이 값으로 옮긴다:
     *  kind_condition_met·plan_stable 등 15의 멈춤 규칙 충족 → stop_condition, 10 human_decided → human */
    reason: Type.Union([
      Type.Literal("stop_condition"), Type.Literal("budget"), Type.Literal("human"),
      Type.Literal("transition"), Type.Literal("superseded"), Type.Literal("concern_closed"),
    ]),
    /** 멈춘 뒤 할 일. 10 inquiry.stop.then과 같은 값이다(정본은 10). decide_now이면 14가 "지금 정하기" 표시를 계산한다 ([판정 J-157]) */
    then: Enum(["proceed", "handoff", "decide_now"]),
    note: Nullable(ShortText),
    seq: Seq,
  })),
  openQuestionIds: Type.Array(OpenQuestionId),
});
```

paper-v0 Inquiry Map의 phase(`sensing | framing | diverging | investigating | deliberating | closed`)는 저장하지 않는다. v0.3에서 이 단계들은 루프(O, I)와 라운드로 표현된다. 화면이 phase 라벨을 원하면 루프 위치와 라운드에서 계산한다.

#### 3.17.2 Lens (Method Transfer 렌즈)

```ts
// @helm/domain/src/records/lens.ts
export const LensCore = Obj({
  name: ShortText,
  /** 출처 네 갈래 (15 §3.9). seed = docs/research/method-transfer-map.md·method-cards/ */
  origin: Type.Union([
    Obj({ kind: Type.Literal("seed"), mapRef: Type.String({ minLength: 1, maxLength: 200 }),
          seedVersion: Type.String({ minLength: 1, maxLength: 64 }) }),
    Obj({ kind: Type.Literal("user"), note: Nullable(ShortText) }),
    Obj({ kind: Type.Literal("observer_proposal"), proposalId: PolicyProposalId }),
    /** 탐구 실행 하나에만 쓰는 임시 렌즈 (등급 D). 라이브러리에는 사람이 추가할 때만 들어간다 */
    Obj({ kind: Type.Literal("model_open"), inquiryId: InquiryId }),
  ]),
  field: ShortText,                 // 분야 분류 (값 목록은 15 ResearchField)
  sourceDomain: ShortText,          // 원래 분야
  structureStatement: Text,         // 분야 용어 없는 구조 서술. 선택 검색 키
  structureTags: Type.Array(Type.String({ minLength: 1, maxLength: 48 })), // 15 StructureTag
  principle: Text,                  // 환경과 무관하게 유지되는 원리
  doNotCopy: Type.Array(ShortText), // 복사하면 안 되는 것 (v0.3 04 §4.3 5단계)
  transferRisk: ShortText,
  sourceGrade: Enum(["A", "B", "C", "D"]), // 원 분야 근거 등급
  evidenceStatus: Enum(["exploratory", "supported", "rejected", "superseded"]), // Helm 전이 근거
  pinned: Type.Boolean(),           // 사람이 지정한 렌즈. 다음 selectLenses에서 먼저 고른다. 기본 false (15 §3.9.2, [판정 J-233])
});
export const Lens = Obj({
  ...Meta, kind: Type.Literal("lens"), ...LensCore.properties,
  status: Type.Union([Type.Literal("active"), Type.Literal("retired")]),
  /** 사람이 고친 렌즈는 새 seed 버전으로 덮지 않는다 (15) */
  userModified: Type.Boolean(),
});
```

`model_open` 렌즈는 라이브러리 투영에서 빼고 그 탐구에서만 보인다. 렌즈 이벤트는 `lens.added`, `lens.updated`, `lens.retired`, `lens_seed.loaded`다(09 §3.4.11, §3.4.13). 렌즈별 채택·거절 기록(v0.3 04 §4.3 "렌즈 라이브러리")은 저장하지 않고 `Possibility.origin.lensId`와 그 상태에서 계산한다.

#### 3.17.3 Stimulus (자극)

```ts
// @helm/domain/src/records/stimulus.ts
export const ElementSelector = Type.Union([
  Obj({ kind: Type.Literal("whole") }),
  Obj({ kind: Type.Literal("element"), key: Type.String({ minLength: 1, maxLength: 64 }) }),
  Obj({ kind: Type.Literal("text_range"), start: Type.Integer({ minimum: 0 }), end: Type.Integer({ minimum: 0 }) }),
  /** 이미지 영역. 0~1 정규화 좌표 */
  Obj({ kind: Type.Literal("region"), x: Type.Number({ minimum: 0, maximum: 1 }), y: Type.Number({ minimum: 0, maximum: 1 }),
        w: Type.Number({ minimum: 0, maximum: 1 }), h: Type.Number({ minimum: 0, maximum: 1 }) }),
]);
export const StimulusCore = Obj({
  inquiryId: InquiryId,
  concernId: ConcernId,
  round: Type.Integer({ minimum: 1 }),   // 첫 자극 라운드는 1. Inquiry.rounds[].n = 0은 사람 입력 전 준비 라운드다. 라운드 키는 inquiryId + round
  content: Type.Union([
    Obj({ kind: Type.Literal("text"), text: Text }),
    Obj({ kind: Type.Literal("blob"), blob: BlobRef, title: ShortText }),       // 이미지·긴 초안 (HTTP로 전송, 결정 31)
    Obj({ kind: Type.Literal("link"), url: Type.String({ minLength: 1, maxLength: 2048 }), title: ShortText,
          snapshot: Nullable(BlobRef) }),
  ]),
  source: Type.Union([
    Obj({ kind: Type.Literal("generated"), runId: RunId, toolCallId: Nullable(ToolCallId) }),
    Obj({ kind: Type.Literal("external"), url: Type.String({ minLength: 1, maxLength: 2048 }),
          citation: ShortText, retrievedBy: ToolCallId }),
    Obj({ kind: Type.Literal("human"), commandId: CommandId }),
  ]),
  direction: Type.Union([
    Type.Literal("same_domain"), Type.Literal("cross_domain"), Type.Literal("extreme"),
    Type.Literal("contrast_pair"),  // 기준 하나만 다른 자극 쌍 (구분 확인)
    Type.Literal("refinement"),
  ]),
  lensId: Nullable(LensId),
  pairWith: Nullable(StimulusId),
  checkId: Nullable(CheckId),
  /** 요소 단위 반응을 받기 위한 요소 목록 (선택) */
  elements: Type.Array(Obj({ key: Type.String({ minLength: 1, maxLength: 64 }), label: ShortText, selector: ElementSelector })),
  /** 모든 형태 필수. TUI와 반응 해석, vision 모델이 없을 때 쓴다 (15) */
  altText: ShortText,
  /** 자극 형태 (15 §3.6, 04 StimulusRoundView). 구조 자극은 content.kind = text(Markdown 목록)이고 form = structure */
  form: Enum(["text", "structure", "image", "reference", "analogy"]),
  /** 선언한 특징. 예: { "도입부 방식": "장면 묘사", "길이": "긺" } (15 §3.6) */
  facets: Type.Record(Type.String({ minLength: 1, maxLength: 48 }), Type.String({ maxLength: 200 })),
  /** 통제 쌍이면 바꾼 특징 키. 선언 밖 특징이 다르면 15가 null로 둔다 (통제 안 됨) */
  controlledFor: Nullable(Type.Array(Type.String({ minLength: 1, maxLength: 48 }))),
});
export const Stimulus = Obj({
  ...Meta, kind: Type.Literal("stimulus"), ...StimulusCore.properties,
  status: Type.Union([Type.Literal("created"), Type.Literal("presented"), Type.Literal("withdrawn")]),
  presentation: Nullable(Obj({ order: Type.Integer({ minimum: 0 }), shuffleSeed: Type.String({ minLength: 1 }), seq: Seq })),
});
```

자극의 내용(`StimulusCore`)은 만든 뒤 바뀌지 않는다(21 E10). 바꿔야 하면 새 자극을 만들고 이전 것은 `withdrawn`으로 둔다. 반응은 항상 그때 본 자극 하나를 가리키므로, 반응과 자극의 대응이 나중에 흐려지지 않는다. 상태와 `presentation`만 바뀐다.

#### 3.17.4 Reaction (반응 payload)

반응은 `Observation(obsKind = "reaction")`이다(D08-5). 하나를 고르는 형태만 있는 반응 타입은 없다(결정 18).

```ts
export const Intensity = Enum([-2, -1, 0, 1, 2]); // 아주 싫음 ~ 아주 좋음
export const ReactionPayload = Obj({
  /** 반응 대상. 가능성에 대한 반응도 같은 형식으로 받는다 (15 §3.4.11) */
  subjectRef: IdAny("st", "ps"),
  inquiryId: InquiryId,
  target: ElementSelector,                 // 요소 단위 반응 (v0.3 09 §4.6)
  intensity: Nullable(Intensity),
  /** null이면 이유 없는 반응 ("이유는 모르겠는데 이건 아니다"). 이것도 근거로 쓴다 (v0.3 04 §3.2) */
  reason: Nullable(ShortText),
  /** 두 자극 비교. 둘 다 아니면 neither (19 comparison.preferred = neither) */
  comparison: Nullable(Type.Union([
    Obj({ kind: Type.Literal("prefer"), better: StimulusId, worse: StimulusId }),
    Obj({ kind: Type.Literal("neither"), pair: Type.Array(StimulusId, { minItems: 2, maxItems: 2 }) }),
  ])),
  /** 세 개 비교 (레퍼토리 그리드): 둘은 비슷하고 하나는 다른데 무엇 때문인가 */
  triad: Nullable(Obj({
    similar: Type.Array(StimulusId, { minItems: 2, maxItems: 2 }),
    different: StimulusId,
    why: Nullable(ShortText),
    cannotSay: Type.Boolean(),             // "무엇 때문인지 말 못 하겠다". true면 why는 null
  })),
  rephrase: Nullable(ShortText),           // "이것과 비슷한데 더 짧게" (비평 기반)
  /** "가깝다" 표시. 방향만 알려 주며 정보성 반응으로 세지 않는다 (15 O-12) */
  near: Type.Boolean(),
});
```

쓰기 시점 규칙: `intensity`, `comparison`, `triad`, `rephrase`, `near` 중 하나 이상이 있어야 한다. `reason`만 있는 반응도 받는다(이유 서술이 곧 반응). 대상이 자극이면 `presented` 상태여야 하고, 가능성이면 `withdrawn`·`dismissed`·`merged`가 아니어야 한다(R-38). 반응 철회는 `observation.retracted`로 기록하고(15·19), 철회된 반응은 선호 모델 근거에서 빠지며 그 근거로 선 기준은 `stale`이 된다.

#### 3.17.5 PreferenceModel (선호 모델)

```ts
// @helm/domain/src/records/preference.ts
export const PreferenceCriterion = Obj({
  key: Type.String({ pattern: "^c[0-9]{1,3}$" }),
  /** 사용자 층에서 가져와 이 Goal에서 다시 확인한 기준 (15 §3.7.2) */
  inheritedFrom: Nullable(PreferenceModelId),
  name: ShortText,
  weight: Grade,
  status: Type.Union([Type.Literal("confirmed"), Type.Literal("retired")]),
  fromPossibilityId: PossibilityId,                        // 기준 후보 (preference_criterion)
  support: Type.Array(ObservationId, { minItems: 1 }),     // 반응 관찰 (E reveals N)
  counter: Type.Array(ObservationId),
  confirmedSeq: Seq,
  reviewTrigger: Nullable(Trigger),
  quality: Quality,                                        // 기준별 contested·stale
});
export const PreferenceModelCore = Obj({
  /** 사용자 층(user)은 Goal을 넘어 쓰는 기준. user이면 goalId·originConcernId는 null (15 §3.7.2) */
  scope: Type.Union([Type.Literal("goal"), Type.Literal("user")]),
  goalId: Nullable(GoalId),
  originConcernId: Nullable(ConcernId),
  title: ShortText,
});
export const PreferenceModel = Obj({
  ...Meta, kind: Type.Literal("preference_model"), ...PreferenceModelCore.properties,
  modelVersion: Type.Integer({ minimum: 1 }),   // 기준 집합이나 무게가 바뀔 때 1 증가
  criteria: Type.Array(PreferenceCriterion),
  likedStimuli: Type.Array(StimulusId),
  dislikedStimuli: Type.Array(StimulusId),
  /** 말한 기준과 실제 반응의 차이를 숨기지 않고 남긴다 (v0.3 04 §3.4) */
  statedVsRevealed: Type.Array(Obj({
    stated: ShortText, revealed: ShortText, evidence: Type.Array(ObservationId, { minItems: 1 }), seq: Seq,
    shownToUserSeq: Nullable(Seq),   // 사용자에게 보인 시점 (숨기지 않음의 기록)
  })),
  status: Type.Union([Type.Literal("active"), Type.Literal("superseded")]),
  quality: Quality,
});
```

- 명령 하나가 기준 여러 개를 바꾸면 `modelVersion`은 1만 오른다(`preference_model.versioned` 한 번).
- 선호 모델을 Goal에 잇는 것(`goalId`)은 Goal 버전을 올리지 않는다. Goal 내용을 바꾸려면 `goal.revision_proposed`를 따로 낸다(02 UC-01 단계 16과 AC-01-15는 15·02가 이 규칙으로 맞춘다).
- 기준 후보는 가능성(`possibilityKind = "preference_criterion"`)으로 시작한다. 사람이 확인하면(`criterion_confirm` 질문의 답) 선호 모델의 기준이 되고 원래 가능성은 `confirmed`가 된다(v0.3 04 §3.2 6단계).
- 선호 모델의 버전 안정성("기준과 무게가 두 라운드 동안 바뀌지 않음", v0.3 04 §3.3)은 `Inquiry.rounds[].leaderVersion`과 `modelVersion`을 비교해 15가 계산한다.
- v0.3 04 §3.4 예시의 `confidence: 0.8`은 쓰지 않는다(D08-10). 화면은 지지 반응 수, 반대 반응 수, 독립 자극 수를 보여 준다.

### 3.18 실행 레코드: Run, ToolCall, Thread, RollbackPoint

[제안: 결정 29·30 기본값(기준 원본은 이벤트 로그, 실행 의도 → 실행 → 결과 기록) / 레코드: 제안. 상태 기계, 복구 절차, 실행 의도의 필드 의미는 12·13이 정하고 08은 저장 모양을 정한다]

#### 3.18.1 Run (에이전트 실행)

```ts
// @helm/domain/src/records/run.ts
/** 12 RunKind */
/** 12 RunKind와 같다. inquiry: 탐구 엔진이 구동하는 단계 run (15, [판정 J-97]). 관찰 에이전트 실행은 or_ 관찰 실행(16)으로 기록하고 run으로 두지 않는다.
 *  라우터는 별도 run 없이 subcall로 돈다. 12의 RunPhase와 stage 대응은 12가 소유하고 19가 참조한다 */
export const RunKind = Enum(["work", "verifier", "mediator", "branch", "subrun", "inquiry"]);
export const RunCore = Obj({
  runKind: RunKind,
  role: AgentRoleSchema,                  // observer, router 값은 run 레코드에 쓰지 않는다 (RunKind 6값, [판정 J-97])
  threadId: ThreadId,
  parentRunId: Nullable(RunId),           // spawn으로 생긴 하위 실행
  rootRunId: RunId,                       // 최상위 실행 (독립성 판정에 씀). 최상위면 자기 id
  goalId: Nullable(GoalId),
  concernId: Nullable(ConcernId),
  workUnitId: Nullable(WorkUnitId),
  inquiryId: Nullable(InquiryId),
  model: Obj({ provider: Type.String({ minLength: 1 }), id: Type.String({ minLength: 1 }), thinking: Nullable(Type.String()) }),
  modeId: Nullable(ModeId),
  loop: Nullable(LoopIdSchema),
  workspaceRoot: Nullable(Type.String({ minLength: 1, maxLength: 4096 })),
  adapter: Obj({ id: Type.String({ minLength: 1 }), version: Type.String({ minLength: 1 }) }), // 1차는 Helm 자체 런타임
  /** 외부 런타임 어댑터의 세션 참조 (13·16). 관찰 에이전트가 drivenByHelm 판별에 쓴다 */
  adapterSessionRef: Nullable(Obj({ source: Type.String({ minLength: 1 }), nativeSessionId: Type.String({ minLength: 1 }),
                                    path: Nullable(Type.String({ maxLength: 4096 })) })),
  /** 시작 계기 (12 RunTrigger). 모양은 12 */
  trigger: Type.Record(Type.String(), Type.Unknown()),
  /** 12 RunBudget. softRatio에 이르면 마무리 신호 */
  budget: Obj({
    requests: Type.Integer({ minimum: 1 }), toolCalls: Type.Integer({ minimum: 0 }), subcalls: Type.Integer({ minimum: 0 }),
    inputTokens: Type.Integer({ minimum: 0 }), outputTokens: Type.Integer({ minimum: 0 }),
    costUsd: Type.Number({ minimum: 0 }), wallMs: Type.Integer({ minimum: 0 }),
    workUnits: Nullable(Type.Integer({ minimum: 0 })),
    softRatio: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
  }),
  /** 12 ModelRole (work, verifier, mediator, branch, subrun, summarizer, subcall, observer 등). 목록은 12 */
  modelRole: Type.String({ minLength: 1, maxLength: 32 }),
  /** 14 루프 단계 id */
  step: Nullable(Type.String({ minLength: 1, maxLength: 64 })),
  /** 런타임 보장 수준 (12 G1~G8): 실제로 막음 / 사후 감지 / 권고 / 불가 */
  guarantees: Type.Record(Type.String({ pattern: "^G[1-8]$" }),
    Enum(["enforced", "detected", "advisory", "unavailable"])),
  /** 이 실행에 준 도구·능력 목록의 해시 (12·13) */
  capabilityManifestHash: Sha256,
  /** run 단위 오염 상태 (12 §3.2.5). 처음에는 거짓이고, 웹·브라우저 결과가 모델에게 들어가면 참이 된다.
   *  같은 thread로 넘긴 새 run과 하위 run이 물려받으며, 하위 run이 세운 값은 부모 run에도 올린다. 참인 run의 send는 합의가 허용해도 사람에게 묻는다 ([결정 55], [판정 J-190] (3), [판정 J-215]) */
  taint: Obj({ web: Type.Boolean() }),
});
/** 12 RunStatus. ended만 종결 */
export const RunStatus = Type.Union([
  Type.Literal("queued"), Type.Literal("running"), Type.Literal("stopping"),
  Type.Literal("awaiting_human"),     // 사람 답 대기. 답이 오면 같은 thread의 새 run
  Type.Literal("awaiting_recovery"),  // 결과 불명 외부 행동의 해소 대기
  Type.Literal("interrupted"),        // 재시작으로 끊김. 재개 판정 대기
  Type.Literal("ended"),
]);
/** 12 RunEndReason */
export const RunEndReason = Enum([
  "yielded", "handed_off", "cancelled", "budget_exhausted", "step_limit", "failed",
  "recovery_exhausted", "superseded", "context_overflow",
]);
/** 모델이 선언할 수 있는 전환 계기 (14 §3.5.6 DeclaredTrigger). TransitionTrigger 가운데 모델이 고르는 값 */
export const DeclaredTrigger = Enum(["surprise", "goal_conflict", "shared_premise_conflict", "situation_changed", "merge_needed"]);
/** run.ended(handed_off)에 싣는 모델 선언 (14 §3.5.6). 오케스트레이터가 가드·규칙으로 판단한다 */
export const RunHandoff = Type.Union([
  Obj({ kind: Type.Literal("transition_request"), to: LoopIdSchema, trigger: DeclaredTrigger, signal: Nullable(Type.String({ maxLength: 32 })),
        reason: ShortText, refs: Type.Array(AnyRecordId) }),
  Obj({ kind: Type.Literal("split_hint"), parts: Type.Array(Obj({ label: ShortText, statement: ShortText }), { minItems: 2 }),
        reason: ShortText, refs: Type.Array(AnyRecordId) }),
  Obj({ kind: Type.Literal("entry_signals"), assessment: EntryAssessmentDraft }),
  Obj({ kind: Type.Literal("stabilized"), refs: Type.Array(AnyRecordId) }),
  /** O의 assess run이 판정 질문 답을 선언하고 끝난다. 유형은 오케스트레이터가 classify로 계산한다 (14 §3.7.1). answers는 아홉 질문 모두이고 모르면 unknown이다 */
  Obj({ kind: Type.Literal("situation_answers"), answers: Type.Array(SituationAnswer, { minItems: 9 }),
        parts: Type.Optional(Type.Array(Obj({ label: ShortText, answers: Type.Array(SituationAnswer, { minItems: 1 }) }), { minItems: 2 })) }),
]);
export const Usage = Obj({
  inputTokens: Type.Integer({ minimum: 0 }), outputTokens: Type.Integer({ minimum: 0 }),
  cacheReadTokens: Type.Integer({ minimum: 0 }), cacheWriteTokens: Type.Integer({ minimum: 0 }),
  costUsd: Nullable(Type.Number({ minimum: 0 })),
});
export const Run = Obj({
  ...Meta, kind: Type.Literal("run"), ...RunCore.properties,
  status: RunStatus,
  /** 같은 runId의 몇 번째 시작인가. 재개마다 1 증가 (12) */
  attempt: Type.Integer({ minimum: 1 }),
  /** 이 시도를 소유한 부팅 epoch (09 §3.8, ULID 문자열). 다른 epoch에서 온 쓰기는 path.stale_epoch */
  ownerEpoch: Type.String({ pattern: "^[0-9A-HJKMNP-TV-Z]{26}$" }),
  recoveryAttempts: Type.Integer({ minimum: 0 }),
  steps: Type.Integer({ minimum: 0 }),
  toolCallCount: Type.Integer({ minimum: 0 }),
  usage: Usage,
  awaiting: Nullable(Obj({ kind: Type.Union([Type.Literal("question"), Type.Literal("recovery")]), ref: IdAny("qs", "tc") })),
  endedAt: Nullable(Ms),
  end: Nullable(Obj({ reason: RunEndReason, code: Nullable(Type.String()), note: Nullable(ShortText),
                      /** handed_off일 때 모델 선언 (14 §3.5.6) */
                      handoff: Nullable(RunHandoff) })),
});
```

#### 3.18.2 ToolCall (도구 호출)

```ts
// @helm/domain/src/records/toolcall.ts
/** 권한 레이어의 판정. Helm은 해석하지 않고 기록·표시만 한다 (결정 2, helm-canon-3 §7.1 C1) */
export const PermissionVerdict = Obj({
  decision: Type.Union([Type.Literal("allow"), Type.Literal("deny"), Type.Literal("ask")]),
  source: Type.Union([Type.Literal("permission_layer"), Type.Literal("kernel"), Type.Literal("agreement")]),
  reasonCode: Type.String({ minLength: 1, maxLength: 64 }),
  /** 권한 레이어가 권리 게이트 대상(돈, 대리 발언, 외부 영향)으로 분류했는가 */
  rightsGate: Type.Boolean(),
  /** 권리 범주 (11 RightsCategory: spend_money 등). 이름 목록은 11 */
  rightsCategories: Type.Array(Type.String({ pattern: "^[a-z][a-z0-9_]{1,47}$" })),
  /** 되돌릴 수 있는가에 대한 권한 레이어의 설명. 표시만 하고 판정에 쓰지 않는다 (결정 2) */
  /** hard와 unknown은 "되돌릴 수 없음"으로 본다. 10·11의 임시 가정 아래 거부(V-AS-02)는 이 두 값에 적용한다.
   *  값을 정하는 것은 권한 레이어이고(결정 2), Helm은 값을 읽어 위 규칙에만 쓴다 */
  reversibility: Nullable(Type.Union([Type.Literal("reversible"), Type.Literal("hard"), Type.Literal("unknown")])),
  /** execute가 실제로 쓰기처럼 동작하는가에 대한 권한 레이어의 판정. 모르면 null */
  mutating: Nullable(Type.Boolean()),
  /** 외부 효과(보내기, 네트워크)가 있을 수 있는가. 결과 불명일 때 권리·정보 게이트 구분에 쓴다 (판정 J-05).
   *  `'uncertain'`은 효과를 알 수 없는 호출(컴퓨터 사용 도구)에 쓰며, send와 같이 권리 게이트를 거친다 ([판정 J-206]) */
  externalEffect: Type.Union([Type.Boolean(), Type.Literal("uncertain")]),
  info: Nullable(ShortText),
});
/** 13 ResourceUri (file:, net:, mcp:, helm_draft:) */
export const ResourceUri = Type.String({ minLength: 3, maxLength: 4096 });
/** 13 ResourcePattern (글롭 허용). 문법과 덮임 판정 함수는 13, 타입은 @helm/domain에 둔다 */
export const ResourcePattern = Type.String({ minLength: 1, maxLength: 4096 });
export const ToolCallCore = Obj({
  runId: RunId,
  providerCallId: Type.String({ minLength: 1, maxLength: 128 }), // 모델이 붙인 호출 id. 실행 안에서 유일
  requestId: Nullable(Id("mr")),       // 이 호출을 낸 모델 요청
  messageId: Nullable(Id("ms")),       // 이 호출이 들어 있는 어시스턴트 메시지
  index: Type.Integer({ minimum: 0 }), // 한 응답 안의 호출 순서
  toolName: Type.String({ minLength: 1, maxLength: 128 }),
  /** 읽기 전용 제안 도구처럼 기본 동작에 대응하지 않는 호출은 null (12·13) */
  primitive: Nullable(PrimitiveSchema),
  /** 모델이 낸 인자 원문 (requested 때) */
  modelArgs: BlobRef,
  replay: Type.Union([Type.Literal("safe"), Type.Literal("never")]),  // 기본 never (pi-durable unsafe와 같음 [원문])
  cancellation: Type.Union([
    Type.Literal("immediate"), Type.Literal("cooperative"), Type.Literal("atomic"), Type.Literal("none"),
  ]),
  /** 이 호출의 목적 (10 ToolCallIntendPayload). verification은 V-AUT-03, counter_search는 반증 탐색 */
  purpose: Enum(["work", "counter_search", "verification", "stimulus", "rollback"]),
  parentToolCallId: Nullable(ToolCallId), // REPL·codemode 안의 중첩 호출
});
/** 실행 의도 (toolcall.started 때 정해짐, 13 prepare 결과) */
export const ToolCallExecution = Obj({
  executedArgs: BlobRef,               // 정규화한 인자 (절대 경로 등)
  fingerprint: Sha256,                 // 13 fingerprint(toolName, executedArgs). send 승인과 대조
  toolVersion: Type.String({ minLength: 1, maxLength: 64 }),
  targets: Type.Array(ResourceUri),
  targetsKnown: Type.Boolean(),
  /** 범위 검사를 언제 했나. post_hoc = 대상 미상 실행의 사후 검사, advisory = 감지 불가 (10 V-INV-04, 13) */
  enforcement: Type.Union([Type.Literal("pre"), Type.Literal("post_hoc"), Type.Literal("advisory")]),
  replayGuard: Nullable(Obj({ kind: Type.Literal("file_hash"), path: Type.String(), before: Type.String(), after: Type.String() })),
  /** 13 샌드박스 수준 */
  sandbox: Nullable(Obj({
    level: Enum(["S0", "S1b", "S1", "S2"]),
    unit: Type.String({ minLength: 1, maxLength: 128 }),   // helm-tool-<tcId>. 실행 전에 정해진다 (13 §3.6.7)
    writableRoots: Type.Array(Type.String({ minLength: 1, maxLength: 4096 })),
    network: Type.Union([Type.Literal("none"), Type.Literal("proxy")]),   // proxy: 네트워크 네임스페이스 분리 + 데몬 CONNECT 프록시 경유 (13 §3.6.3, [판정 J-134])
  })),
  /** 실행 직전 대조용 작업 공간 파일의 내용 해시 목록 (13 §3.7.7). 승인 대기 중 바뀌면 실행하지 않는다 */
  targetsDigest: Type.Array(Sha256),
  snapshotRef: Nullable(BlobRef),
  /** write·send(및 권한 레이어가 mutating으로 본 execute)는 필수 (R-05) */
  agreementRef: Nullable(Obj({ agreementId: AgreementId, revision: Type.Integer({ minimum: 1 }) })),
  /** 실행 시점에 기대고 있던 임시 가정. 이의·가정 무효 때 영향 계산(10 impactOf)에 쓴다 */
  underAssumptions: Type.Array(AssumptionId),
  bootEpoch: Type.String({ pattern: "^[0-9A-HJKMNP-TV-Z]{26}$" }),
  intentSeq: Seq,
});
/** 실행되지 않은 이유. aborted는 cancel로 적는다 (12). batch_stopped는 턴의 도구 배치에서 앞 호출이 실패해 뒤 호출을 실행하지 않은 경우다 (12 §3.4.3, RT-11, [판정 J-214]) */
export const NotExecutedReason = Enum(["restart", "cancel", "steering", "superseded", "unknown_tool", "invalid_args", "truncated_response", "approval_expired", "batch_stopped"]);
export const ToolCallStatus = Type.Union([
  Type.Literal("requested"),          // 모델이 호출함, 검사 전
  Type.Literal("blocked"),            // 커널·권한 레이어·합의 범위에서 차단 (실행 안 됨)
  Type.Literal("awaiting_approval"),  // 권리 게이트 질문 대기
  Type.Literal("denied"),             // 사람이 거절
  Type.Literal("started"),            // 실행 의도 기록 완료 (write-ahead). 이 뒤에 실제 실행
  Type.Literal("not_executed"),       // 의도 없이 끝남 (재시작, 취소, 조종). 관찰 없음
  Type.Literal("replaying"),          // 재시작 후 safe 재실행 중
  Type.Literal("completed"),          // 결과 기록됨 (오류 결과 포함)
  Type.Literal("interrupted"),        // 실행 중 취소·조종으로 끝남
  Type.Literal("outcome_uncertain"),  // 외부 결과 불확실. 복구 증거를 기다림
  Type.Literal("recovered"),          // 사람·검증으로 결과가 정리됨
]);
export const ToolCall = Obj({
  ...Meta, kind: Type.Literal("toolcall"), ...ToolCallCore.properties,
  status: ToolCallStatus,
  permission: Nullable(PermissionVerdict),
  block: Nullable(Obj({ rejectionClass: RejectionClassSchema, code: Type.String({ minLength: 1 }), reason: ShortText })),
  approvalQuestionId: Nullable(QuestionId),
  /** 고쳐서 허락(approve_edited)으로 생긴 호출이면 원 호출 ([판정 J-117·J-121]). 새 tcId는 원 tcId와 질문 id에서
   *  결정적으로 만든다: tc_ + ULID(sha256("edited:" + 원 tcId + ":" + qsId)의 앞 80비트, 시각부는 원 호출 createdAt) */
  editedFrom: Nullable(Obj({ toolCallId: ToolCallId, questionId: QuestionId })),
  /** denied의 사유. 승인 대기 중의 만료와 취소는 not_executed(approval_expired·cancel)로 닫으며 denied로 쓰지 않는다 (10, 12) */
  denial: Nullable(Obj({ reason: Type.Union([Type.Literal("human"), Type.Literal("edited_by_human")]) })),
  execution: Nullable(ToolCallExecution),
  notExecuted: Nullable(Obj({ reason: NotExecutedReason })),
  result: Nullable(Obj({
    /** 관찰. primitive = null인 제안 도구는 관찰을 만들지 않으므로 null (판정 J-43) */
    observationId: Nullable(ObservationId), isError: Type.Boolean(), exitCode: Nullable(Type.Integer()),
    content: Nullable(BlobRef), structuredContent: Nullable(BlobRef), durationMs: DurationMs,
    /** 모델에 돌려준 내용(잘린 것)과 전체 출력 */
    modelContent: Nullable(BlobRef), fullOutput: Nullable(BlobRef),
    truncation: Nullable(Obj({ originalBytes: Type.Integer({ minimum: 0 }), keptBytes: Type.Integer({ minimum: 0 }) })),
    /** 부팅 복구에서 결과를 정한 방법: replayGuard 해시 확인 / 재실행 */
    recovered: Nullable(Type.Union([Type.Literal("hash_verified"), Type.Literal("replayed")])),
  })),
  recovery: Nullable(Obj({
    resolution: Type.Union([
      Type.Literal("confirmed_applied"), Type.Literal("confirmed_not_applied"), Type.Literal("manual_review"),
    ]),
    evidence: Type.Array(ObservationId),
    by: ActorRefSchema,
    seq: Seq,
  })),
});
```

- 도구 호출 하나의 결과 관찰은 하나다. 관찰의 멱등 키는 `toolCallId`다(09 §3.9.3).
- 차단된 호출(`blocked`), 실행되지 않은 호출(`not_executed`), 제안 도구(`primitive = null`) 호출은 관찰을 만들지 않는다. 모델에게는 차단 이유가 도구 결과로 돌아가지만, 그것은 런타임이 대화에 넣는 메시지일 뿐 E 레코드가 아니다(helm-canon-2 L20).
- 읽기 빠른 경로: `primitive = read`이고 대상이 정해진 호출은 `toolcall.requested`·`started`·`completed`를 한 트랜잭션에 함께 남길 수 있다(12 §3.4, 10 K-3). 이때 R-06의 "started 커밋 뒤 실행" 순서는 의도 기록과 결과 기록이 같은 커밋이라는 사실로 대신한다. 쓰기·보내기·실행에는 이 경로를 쓰지 않는다.
- 메시지 본문(사용자 입력, 모델 출력)은 런타임 이벤트 `run.message_recorded`의 blob에 둔다(09 §3.4.12). 사람의 자연어 입력은 같은 트랜잭션에서 `utterance` 관찰도 만든다.

#### 3.18.3 Thread, RollbackPoint

```ts
// @helm/domain/src/records/thread.ts
/** 실행 대화 흐름 (12). 같은 thread의 run들이 대화 기록을 이어 쓴다 */
export const Thread = Obj({
  ...Meta, kind: Type.Literal("thread"),
  concernId: ConcernId,
  workUnitId: Nullable(WorkUnitId),
  purpose: RunKind,   // RunKind와 같은 값 집합. observer는 뺀다([판정 J-97]). inquiry는 더한다 (12 요구 (5))
  forkedFrom: Nullable(Obj({ threadId: ThreadId, cursor: Type.Integer({ minimum: 0 }) })),
  status: Type.Union([Type.Literal("open"), Type.Literal("closed")]),
  activeRunId: Nullable(RunId),
});

// @helm/domain/src/records/rollback-point.ts
/** 가정하고 진행할 때 되돌릴 지점 (11 §3.12) */
export const RollbackPointCore = Obj({
  concernId: ConcernId,
  workUnitId: Nullable(WorkUnitId),
  /** 합의의 되돌릴 지점 (02 AC-07-15). 합의 활성화 때 등록한 것 */
  agreementId: Nullable(AgreementId),
  mechanism: Type.Union([Type.Literal("git_ref"), Type.Literal("snapshot_blob"), Type.Literal("manual")]),
  /** git 커밋·ref 이름, 또는 작업 공간 스냅숏 blob (09 blobs) */
  ref: Type.Union([Obj({ kind: Type.Literal("git"), repo: Type.String({ minLength: 1 }), ref: Type.String({ minLength: 1 }) }),
                   Obj({ kind: Type.Literal("blob"), blob: BlobRef }),
                   Obj({ kind: Type.Literal("note"), text: ShortText })]),
  coversTargets: Type.Array(ResourceUri),
  forAssumptions: Type.Array(AssumptionId),
  limitations: Type.Array(ShortText),        // 되돌릴 수 없는 부분 (외부 전송 등)
});
export const RollbackPoint = Obj({
  ...Meta, kind: Type.Literal("rollback_point"), ...RollbackPointCore.properties,
  status: Type.Union([Type.Literal("available"), Type.Literal("used"), Type.Literal("expired")]),
});
```

이벤트는 `thread.opened`, `thread.closed`, `rollback_point.registered`, `rollback_point.used`, `rollback_point.expired`다(09 §3.4.12).

되돌릴 지점의 만료: 지점이 가리키는 전제가 모두 `confirmed`·`retired`가 된 뒤 바로 만료하지 않는다. 가정 확정(질문 assumed)으로 confirmed된 전제는 늦은 이의로 다시 무효가 될 수 있으므로, 이의 가능 기간(설정, 기본 7일)이 지난 뒤에 `rollback_point.expired`를 낸다(11 §3.12). 합의 활성 때 만든 지점(`agreementId`)은 그 합의가 fulfilled·released된 뒤 같은 기간이 지나면 만료한다.

#### 3.18.4 `@helm/domain/model` (모델 데이터 타입)

저장·전송되는 모델 데이터(메시지, 콘텐츠 블록, 도구 선언, 사용량, thinking 수준, stopReason)의 타입은 하위 경로 `@helm/domain/model`에 둔다. 타입 목록과 모양은 07 §3.9.2를 그대로 받는다(pi-ai 1.1.0과 같은 모양, 07 I5 컴파일 시험). 이 문서는 이름·위치와 불투명 필드 표시만 정한다.

- 위치: `packages/domain/src/model.ts`, 하위 경로 `@helm/domain/model`. 레코드 타입(`@helm/domain`)과 하위 경로를 나눈다. 08의 `MessageId`(`ms`)는 메시지 기록의 id이고, 메시지 본문 타입은 `@helm/domain/model`의 `Message`다. 이름이 겹치지 않도록 레코드 쪽에서는 `Message`라는 타입 이름을 쓰지 않는다.
- 이름: 07 §3.9.2의 이름 그대로(`JsonValue`, `JsonObject`, `ThinkingLevel`, `StopReason`, `ProviderStopReason`, `TextContent`, `ThinkingContent`, `ImageContent`, `ToolCall`, `GrammarFormat`, `ConstrainedSampling`, `ToolDeclaration`, `Usage`, `SystemMessage`, `UserMessage`, `AssistantMessage`, `ProviderAssistantMessage`, `ToolResultMessage`, `Message`, `ProviderMessage`, `ModelRef`). 이 하위 경로의 `Usage`·`ToolCall`은 레코드 쪽 `Usage`(§3.18.1 run 사용량 집계)·`ToolCall`(§3.18.2 레코드)과 다른 타입이다. 같은 파일에서 함께 쓸 때는 `import * as model from "@helm/domain/model"`로 이름 공간을 나눈다.
- `Provider*` 타입은 `@helm/ai` 경계 안에서만 쓴다. 이벤트·trace·프로토콜에는 저장용 판(`StopReason`, `AssistantMessage`, `Message`)만 들어간다.
- 불투명 필드: 제공자 이어가기 값 5개(`textSignature`, `thinkingSignature`, `redacted`, `thoughtSignature`, `namespace`)는 pi와 같은 자리(최상위 선택 필드)에 두고, 스키마에 다음 표시를 붙인다.

```ts
// @helm/domain/src/schema.ts
/** 제공자가 다음 요청에서 다시 받아야 하는 값. Helm 코드는 읽거나 분기하지 않고 저장·재전송만 한다 */
export const Opaque = <T extends TSchema>(t: T) => Type.Optional({ ...t, "x-helm-opaque": true } as T);
// 사용: TextContentSchema = Obj({ type: Type.Literal("text"), text: Type.String(), textSignature: Opaque(Type.String()) })
```

  - 검사: 06 의존 규칙 스크립트(R7과 같은 곳)가 `@helm/ai` 밖에서 이 다섯 이름을 속성 접근으로 읽는 코드를 찾으면 실패한다. 저장(이벤트 payload의 blob 본문)과 재전송(투영이 메시지를 그대로 넘김)은 객체를 통째로 다루므로 걸리지 않는다.
  - 화면·관찰 입력에는 보이지 않는다. 19 재전송에서 메시지 본문은 blob이므로 envelope에 나타나지 않는다.

### 3.19 통치 레코드: Device, PairingCode, PolicyProposal, Procedure

[레코드의 존재와 공통 메타: 이 문서 / 필드 의미와 절차: Device·PairingCode는 18, PolicyProposal·Procedure는 16과 14]

#### 3.19.1 Device, PairingCode

```ts
// @helm/domain/src/records/device.ts  (페어링 절차, 토큰 형식, 수명은 18 §3.7~3.8)
/** 기기 종류. 18·20·26의 값과 같다 */
export const ClientKind = Enum(["desktop", "mobile", "tui", "cli"]);
export const DeviceCore = Obj({
  name: Title,
  /** 모바일 PWA도 ios다([결정 47·49], 26). Android는 지원 대상이 아니지만 값은 남겨 둔다 */
  platform: Enum(["macos", "windows", "linux", "ios", "android", "tui", "cli"]),
  /** desktop | mobile | tui | cli (18·20·26). 모바일 기기([결정 42·47])도 같은 레코드다 */
  clientKind: ClientKind,
  pairedVia: Type.Union([Type.Literal("code"), Type.Literal("ssh")]),
  /** 기기 토큰을 싣는 방식 (26 §3.3.3, 18). 모바일 PWA는 cookie, 그 밖은 header */
  credentialCarrier: Enum(["header", "cookie"]),
  /** 코드로 페어링했으면 그 코드와 코드를 만든 주체 (18 도난 대응의 연쇄 폐기) */
  pairedFrom: Nullable(Obj({ codeId: PairingCodeId, createdBy: Type.Union([Obj({ kind: Type.Literal("localAdmin") }),
                                                                        Obj({ kind: Type.Literal("device"), deviceId: DeviceId })]) })),
});
/** 26 §3.4.6. 1차는 webpush만 받는다. apns는 26 경로 B 예약 */
export const PushRegistration = Obj({
  provider: Enum(["webpush", "apns"]),
  /** webpush: sha256(endpoint URL), apns: sha256(기기 토큰). 원문은 09 운영 테이블 push_tokens */
  tokenHash: Sha256,
  /** 화면·진단용. tokenHash 16진수 앞 8자 */
  tokenHint: Type.String({ pattern: "^[0-9a-f]{8}$" }),
  endpointHost: Type.String({ minLength: 1, maxLength: 253 }),
  minUrgency: Enum(["interrupt", "notice"]),        // 기본 notice ([결정 48]). 내용 표시 여부는 기기 설정(26 MOB-D07)
  vapidKeyId: Nullable(Type.String({ pattern: "^[0-9a-f]{12}$" })),
  registeredAt: Ms,
});
export const Device = Obj({
  ...Meta, kind: Type.Literal("device"), ...DeviceCore.properties,   // projectId = null
  status: Type.Union([Type.Literal("active"), Type.Literal("expired"), Type.Literal("revoked")]),
  /** bearer 토큰의 SHA-256. 토큰 원문은 저장하지 않는다. 09 EVENT_META.sensitiveFields: 재전송·투영 응답·관찰 입력에서 뺀다 */
  tokenHash: Sha256,
  tokenId: Type.String({ pattern: "^[0-9a-f]{12}$" }),          // sha256(토큰) 앞 12자. 로그·화면용
  prevTokenHash: Nullable(Obj({ hash: Sha256, validUntil: Ms })),
  tailnetNodeId: Nullable(Type.String({ minLength: 1, maxLength: 128 })),
  tailnetLogin: Nullable(Type.String({ minLength: 1, maxLength: 256 })),
  pairedAt: Ms,
  expiresAt: Ms,
  revokedAt: Nullable(Ms),
  revokeReason: Nullable(ShortText),
  /** 기기 공개 키 (18 §3.9 `publicKey?`, 이후 단계의 요청 서명용) */
  publicKey: Nullable(Type.String({ minLength: 1, maxLength: 1024 })),
  /** 푸시 알림 등록 (device.push_registered). 원문은 09 운영 테이블 `push_tokens`([판정 J-71]) */
  push: Nullable(PushRegistration),
});

// @helm/domain/src/records/pairing-code.ts
export const PairingCode = Obj({
  ...Meta, kind: Type.Literal("pairing_code"),
  codeHash: Sha256,                                              // 민감 필드
  createdBy: Type.Union([Obj({ kind: Type.Literal("localAdmin") }), Obj({ kind: Type.Literal("device"), deviceId: DeviceId })]),
  intendedName: Nullable(Title),
  expiresAt: Ms,
  attemptsLeft: Type.Integer({ minimum: 0, maximum: 5 }),
  status: Enum(["active", "consumed", "expired", "exhausted", "cancelled"]),
  consumedByDeviceId: Nullable(DeviceId),
});
```

- 기기의 접속 여부는 `device.connected`·`device.disconnected`와 `presence.changed` 이벤트로 남는다(09 §3.4.13). 마지막 인증 시각(`last_auth_at`, 18 §3.6.1의 유휴 만료 계산 입력)과 마지막 접속 시각(`last_seen_at`) 같은 잦은 값은 운영 테이블 `device_presence`에 둔다(09). 투영과 커널 판정은 이벤트만 쓴다.
- 토큰 해시를 이벤트에 두는 이유는 결정 29(모든 상태는 로그에서 재구성)다. 해시로 토큰을 만들 수 없지만 필요 없는 곳에는 보내지 않는다(18 §3.10).

#### 3.19.2 PolicyProposal (관찰 에이전트 제안)

```ts
// @helm/domain/src/records/policy-proposal.ts  (종류, 근거 형식, 상태 기계, 효과 판정은 16 §3.12~3.17)
export const PolicyProposalKind = Enum([
  "procedure", "skill", "script", "tool_promotion", "guard", "policy", "agreement_template",
  "context", "routing", "entry_criteria", "divergence_category", "lens", "demotion",
]);
export const PolicyProposalCore = Obj({
  proposalKind: PolicyProposalKind,
  changes: Enum(["procedure", "tooling", "policy", "agreement", "context"]),
  /** 같은 계열 제안 묶음 (기각 기억의 단위) */
  family: Type.String({ minLength: 1, maxLength: 128 }),
  detector: Type.String({ minLength: 1, maxLength: 64 }),
  title: Title,
  rationale: Text,
  evidence: Type.Array(Obj({
    kind: Type.Union([Type.Literal("event"), Type.Literal("record"), Type.Literal("session_log")]),
    ref: Type.String({ minLength: 1, maxLength: 1024 }), // ev_/레코드 id/세션 로그 경로#오프셋
    note: Nullable(ShortText),
  }), { minItems: 1 }),
  /** 패턴 서명. 기각된 서명은 새 근거 없이 다시 제안하지 않는다 (audit §3.2) */
  signature: Sha256,
  /** 제출 당시 초안 전체 (16 ProposalDraft). 모양은 16 */
  draft: BlobRef,
  /** 설정 변경형 제안의 대상과 값 (16 patch) */
  patch: Nullable(Obj({
    target: Enum(["dial", "policy_rule", "orchestration.routing", "orchestration.agreement_templates"]),
    value: Type.Unknown(),   // target별 모양은 16 PolicyPatch
  })),
  targetProjectId: Nullable(ProjectId),
});
export const PolicyProposal = Obj({
  ...Meta, kind: Type.Literal("policy_proposal"), ...PolicyProposalCore.properties,
  status: Enum(["open", "deferred", "accepted", "applying", "applied", "dismissed", "withdrawn", "expired", "reverted"]),
  decision: Nullable(Obj({
    kind: Type.Union([Type.Literal("accepted"), Type.Literal("dismissed"), Type.Literal("deferred")]),
    reason: Nullable(Type.String({ minLength: 1, maxLength: 32 })),   // 16 선택지
    scope: Nullable(Type.Union([Type.Literal("this"), Type.Literal("family_forever")])),
    deferUntil: Nullable(Ms),
    edits: Nullable(BlobRef),
    via: Via,
    seq: Seq,
  })),
  application: Nullable(Obj({ concernId: Nullable(ConcernId), settingSeq: Nullable(Seq), artifactRefs: Type.Array(Type.String()) })),
  effect: Nullable(Obj({
    checkpoints: Type.Array(Type.Record(Type.String(), Type.Unknown())),
    verdict: Nullable(Enum(["effective", "ineffective", "inconclusive", "harmful"])),
  })),
});
```

- 관찰 에이전트는 쓰기 권한이 없다(브리프 §6). 제안 기록(`policy_proposal.submitted`, `evidence_updated`, `withdrawn`)만 만든다. 채택·기각·미룸은 사람이, 적용(`applied`)은 커널이 기록한다.

#### 3.19.3 Procedure (절차) [16 §3.16·3.17, 14 §3.7]

```ts
// @helm/domain/src/records/procedure.ts
export const ProcedureCore = Obj({
  title: Title,
  /** 적용 대상 Concern 종류와 상황 (14가 q.procedure_exists 판정에 쓴다) */
  appliesTo: Obj({ concernKinds: Type.Array(ConcernKind, { minItems: 1 }), signature: Nullable(Sha256), note: Nullable(ShortText) }),
  /** 계획 템플릿 (14 PlanStep 목록) */
  planTemplate: Type.Array(PlanStep, { minItems: 1 }),
  /** 맡겨 둔 권한(사람이 미리 맡긴 Grant). 화면 이름은 "맡겨 둔 권한"이다 ([판정 J-116]) */
  standingGrantId: Nullable(GrantId),
  sourceProposalId: Nullable(PolicyProposalId),
  body: Nullable(BlobRef),                     // 절차 본문 (스킬 문서 등)
});
export const Procedure = Obj({
  ...Meta, kind: Type.Literal("procedure"), ...ProcedureCore.properties,
  trust: Type.Union([Type.Literal("trial"), Type.Literal("trusted"), Type.Literal("demoted")]),
  // 사용 횟수·실패 수는 레코드에 두지 않는다. 16의 지표(metric_fact)에서 계산한다
  status: Type.Union([Type.Literal("active"), Type.Literal("retired")]),
});
```

절차 채택은 사람이 한다(`procedure.adopted`, 16 §3.16). 신뢰 변경은 `procedure.trust_changed`다. `trusted`이면 상황 판정 질문 `q.procedure_exists`의 답이 yes, `trial`이면 unknown이다(14 §3.7). 사용 실패는 `procedure_failed` 주석이 붙은 관찰로 남고, 실패가 반복되면 관찰 에이전트가 `demotion` 제안을 낸다.

### 3.20 관계와 쓰기 시점 참조 제약

[결정 15(1)~(3)은 R-05·R-17·R-13에 해당. 나머지 제약은 제안: 브리프 §3.5 요구(담당 P5). 출처: 대화 L2712–2719 (X3-8-08) "관계 = 쓰기 시점 제약"]

#### 3.20.1 레코드 종류 표

| `kind` | 접두사 | 평면 | 만드는 이벤트 (09) | Autonomy | 품질 |
|---|---|---|---|---|---|
| `project` | pj | N | `project.created` | - | - |
| `goal` | gl | N | `goal.proposed`, `goal.activated` | - | O |
| `concern` | cn | N | `concern.opened` | - | - |
| `structure_change` | sc | N | `structure.changed` | O | O |
| `boundary_item` | bd | N | `boundary_item.recorded` | - | - |
| `workunit` | wu | M 실행 | `workunit.proposed` | - | - |
| `observation` | ob | E | `observation.recorded` | - | O |
| `assumption` | as | E | `assumption.recorded` | - | O |
| `open_question` | oq | E | `open_question.recorded` | - | - |
| `interpretation` | in | E | `interpretation.proposed` | - | O |
| `possibility` | ps | E | `possibility.proposed` | - | O |
| `check` | dc | E | `check.declared` | - | O |
| `finding` | fd | E | `finding.promoted` | - | O |
| `choice` | ch | N | `choice.committed` | O | O |
| `objection` | ct | E | `objection.filed` | - | - |
| `agreement` | ag | N | `agreement.proposed` | 활성화·좁히기 블록 | O |
| `grant` | gr | P | `grant.issued` | - | - |
| `result` | rs | E | `result.submitted` | - | O |
| `attestation` | at | E | `attestation.recorded` | - | O |
| `acceptance` | ac | N | `acceptance.recorded` | - | - |
| `integration` | ig | N | `integration.opened` | - | - |
| `obligation` | io | N | `obligation.added` | - | - |
| `reflection` | rf | N | `reflection.recorded` | - | - |
| `question` | qs | N/E | `question.recorded` | 전달 계획 블록 | - |
| `expectation` | ex | N | `expectation.created` | - | - |
| `prediction` | pr | E | `prediction.recorded` | - | O |
| `loop_plan` | lp | N | `loop_plan.adopted` | O | O |
| `loop_transition` | lt | E | `loop.transitioned` | O | O |
| `situation_assessment` | sa | E | `situation.assessed` | O | O |
| `mode_assignment` | md | N | `mode.assigned` | O | O |
| `probe` | pb | N | `probe.planned` | 판정 블록 | - |
| `watch` | wt | N | `watch.defined` | 판정 블록 | O |
| `inquiry` | iq | E | `inquiry.opened` | - | - |
| `lens` | ln | E | `lens.added` | - | - |
| `stimulus` | st | E | `stimulus.created` | - | - |
| `preference_model` | pm | N | `preference_model.created` | - | O |
| `run` | rn | M 실행 | `run.started` | - | - |
| `toolcall` | tc | M 실행 | `toolcall.requested` | - | - |
| `thread` | th | M 실행 | `thread.opened` | - | - |
| `rollback_point` | rb | M | `rollback_point.registered` | - | - |
| `device` | dv | A | `device.paired` | - | - |
| `pairing_code` | pc | A | `pairing.code_created` | - | - |
| `policy_proposal` | pp | P | `policy_proposal.submitted` | - | - |
| `procedure` | pd | P | `procedure.adopted` | - | - |
| `entry_assessment` | ea | N | `entry.evaluated` | O | O |

"품질 O"인 레코드만 `quality` 필드를 가진다. 나머지는 상태(`status`)만으로 충분한 진행 기록이다. "블록"은 레코드 안의 결정 블록만 `Autonomy`를 가진다는 뜻이다(§3.4.5 규칙 1).

```ts
// @helm/domain/src/records/kinds.ts
/** 위 표의 kind 열 전부. 레코드 종류의 리터럴 유니온이다 (19 레코드 조회와 09 투영 테이블이 쓴다) */
export const RecordKind = Enum([
  "project", "goal", "concern", "structure_change", "boundary_item", "workunit", "observation",
  "assumption", "open_question", "interpretation", "possibility", "check", "finding", "choice",
  "objection", "agreement", "grant", "result", "attestation", "acceptance", "integration",
  "obligation", "reflection", "question", "expectation", "prediction", "loop_plan", "loop_transition",
  "situation_assessment", "mode_assignment", "probe", "watch", "inquiry", "lens", "stimulus",
  "preference_model", "run", "toolcall", "thread", "rollback_point", "device", "pairing_code",
  "policy_proposal", "procedure", "entry_assessment",
]);
```

#### 3.20.2 쓰기 시점 참조 제약 표

각 행은 "이 이벤트가 기록되려면 반드시 성립해야 하는 참조와 상태"다. 커널이 형식 검사·권한 검사 단계에서 집행한다(10). 위반의 거부 갈래(§3.23)를 함께 적는다. "현재"는 대체·철회·낡음이 아닌 상태를 뜻한다.

| ID | 이벤트 | 반드시 참조할 것과 조건 | 근거 | 위반 시 |
|---|---|---|---|---|
| R-01 | `concern.opened` | `goalId`의 Goal이 `active` 또는 `paused`이고 같은 프로젝트. `parentConcernId`가 있으면 그 Concern이 `open`·`active`이고 같은 Goal이거나 그 Goal의 하위 Goal 아래 | A1, F01 불변 1 | 내용 |
| R-02 | `workunit.proposed` | Concern이 `open`·`active`. `parentWorkUnitId`는 같은 Concern | F01 불변 1 | 내용 |
| R-03 | `agreement.proposed`, `agreement.revised` | WorkUnit이 `proposed`·`negotiating`(또는 기존 합의를 대체할 때 `in_progress`·`paused`). `goal`이 Concern Goal의 현재 버전. 기준 1개 이상, 멈출 조건 1개 이상. `scope.resources`의 path 자원이 프로젝트 `rootPaths` 안 (`helm_draft` 자원은 예외) | 브리프 §6 작업 합의, I1 | 내용 |
| R-04 | `agreement.confirmed`, `agreement.activated_by_grant` | 확인: 행위자 `human` + 인증된 `via`, 합의가 `proposed`이고 사람이 본 버전과 같음. Grant 활성화: Grant가 `active`이고 §3.11.2의 포함 검사 통과 | A6, F10 §6 | 자격 / 내용 |
| R-05 | `toolcall.started` (primitive가 write·send이거나, 권한 레이어가 `mutating = true`로 본 execute) | `agreementRef`가 이 실행의 WorkUnit의 `agreementId`가 가리키는 `active` 합의 현재 개정판이고(재작업 WorkUnit은 원 WorkUnit의 합의를 가리킨다, [판정 J-158]) 그 Concern의 Goal이 `active`(아니면 `policy.goal_not_active`, [판정 J-130]). 호출 대상이 `scope` 안이고 `forbiddenResources` 밖. send는 언제나 지문이 같은 미소진 승인이 있어야 한다(`sendTargets`는 읽지 않는다, [판정 J-91]). 검사 대상 run은 제출 envelope의 `via.runId`다. 승인 뒤 재제출이면 레코드의 runId와 같은 thread의 run이어야 한다(J-96) | **결정 15(1)**, N authorizes M, I9 | 자격 (`gate.scope_expansion_required`: 범위 밖이면 `scope_change` 질문으로 이어짐, 10 ADR-K8) / 내용(합의 없음·개정판 불일치) |
| R-06 | `observation.recorded` | 행위자가 `runtime`·`kernel`·`scheduler`·`human`(인증된 via) 중 하나. 출처별: tool → 도구 호출이 이 실행의 것이고 `started`·`replaying` 상태이며 아직 결과 관찰이 없음. human → 명령 id. external → 수신 경로 유효, (`channel`, `actor`, `externalId`) 조합이 처음이거나 내용 해시가 같음. timer → 기대가 `open`이고 기한 도래. watcher → 바뀐 참조 1개 이상. derived → `inputs`가 모두 실재. 예외: 읽기 빠른 경로(§3.18.2)는 같은 트랜잭션의 `toolcall.started` 뒤에 둔다 | **M updates E**, F01 불변 4, 대화 L1758 | 자격(모델 행위자) / 내용 |
| R-07 | `interpretation.proposed` | `basis`의 관찰 1개 이상이 존재하고 품질 `qualified` 이상. 0개면 거부하지 않고 `assumption.recorded`(origin `downgraded_interpretation`)로 바꿔 기록 | 대화 L2231 | 강등 |
| R-08 | `possibility.proposed` | Concern 현재. `possibilityKind`가 cause·perspective면 `ifTrue`, `falsifier`, `nextCheck` 존재. `origin`의 칸·렌즈·하위 실행이 실재하고 그 탐구에 속함. `initialEvidence` 대상 실재 | 대화 L2216 | 내용 |
| R-09 | `claim.evidence_linked` | 추측이 현재 상태(`in`: active, `ps`: open, `fd`: active). 대상 관찰이 실재하고 품질 `structural` 이상. 같은 (주장, 대상, 관계) 중복 금지. 관찰이 아닌 것(해석·모델 문장)을 근거로 링크할 수 없음(판단 `fd`를 `qualifies`·전제로 인용하는 것만 예외) | helm-toy 거부 4, A5 | 내용 |
| R-10 | `claim.counter_searched` | 관찰 1개 이상이 실재하고 출처가 도구·사람·외부이며, 주장이 생긴 뒤의 seq. `found`의 관찰마다 같은 이벤트 묶음에서 `challenges` 링크가 생김 | 대화 L3135 | 내용 |
| R-11 | `claim.counter_resolved` | 해소할 링크가 실재하고 미해소. 사람은 `note`만으로 가능, 에이전트는 `refs` 1개 이상 필수 | F02 §5 | 내용 |
| R-12 | `check.declared` | 예측 2개 이상, 모든 `expects ⊆ outcomes`, 모든 `expects` 집합이 같지 않음, 대상 주장들이 같은 Concern에서 현재 | v0.3 04 §2.4 | 내용 |
| R-13 | `check.observed`, `finding.promoted` | 확인: 상태 `declared`, 관찰 실재, `outcome ∈ outcomes`. 승격: `promotionMissing()`이 빈 배열(§3.9.5) | **결정 15(3)**, v0.3 02 §2.1 | 내용 |
| R-14 | `finding.confirmed` | 행위자 `human`, 판단이 `active`·`unconfirmed` | v0.3 02 §2.1 조건 5 | 자격 |
| R-15 | `choice.committed` | Concern 현재. `basis` 1개 이상 실재·현재. 대안 1개 이상. `goal`이 현재 버전. 권리 게이트면 사람. autonomous면 `whyNotAsked` 검증: `info_gate`에 조건 1 거짓이면 `policyRef` 필수, `within_grant`·`emergency`는 Grant가 Concern을 덮음, `assumption_expired`는 같은 트랜잭션의 `question.assumed`, `auto_verifiable`은 관찰이 `qualified`. `supersedes`는 같은 Concern의 현재 선택 | **E justifies N**, 불변조건 7, I6 | 내용 / 자격 |
| R-16 | `objection.filed` | 행위자 `human`. 대상이 `ContestableId`(또는 실재하는 링크)이고 대체되지 않음. `itemKey`는 `criterion:<cr>`·`evidence:<ob>` 형식이고 대상 안에 실재 | A15, 불변조건 7 | 자격 / 내용 |
| R-17 | `result.submitted` | WorkUnit `in_progress`. 합의 `active`, `agreementRevision`이 현재 개정판. `criteriaResults`의 기준 id 집합 = 현재 개정판 기준 id 집합. 근거 관찰 id가 실재(없으면 거부). 관찰이 아닌 근거는 기준을 `unverified`로 강등 | **결정 15(2)**, I3, X3-2-11 | 내용 / 강등 |
| R-18 | `attestation.recorded` | 행위자 `agent:verifier` 또는 `human`. 결과가 `submitted`. 검증 실행의 `rootRunId`가 결과 `producerRunIds`의 루트와 다름 | P 독립성 (대화 L3298) | 자격(P) |
| R-19 | `acceptance.recorded` | 행위자 `human`. 결과 `submitted`이고 개정판이 현재. `conditional`이면 조건 1개 이상. `rejected`·`criteria_wrong`이면 `reopenTo` 필수(값은 C.commit·I.fact·I.want). `integrationAgreementId`가 있으면 결과 제출의 초안과 같은 합의이고 `proposed` | **M fulfills N**, A6, I4 | 자격 / 내용 |
| R-20 | `integration.opened` | 확인 결정이 `accepted`·`conditional` (커널이 같은 트랜잭션에서 만든다) | A10 | - |
| R-21 | `obligation.resolved`, `obligation.waived` | §3.12 규칙 6의 종류별 행위자. 커널이 닫을 때는 근거 관찰 1개 이상 | A10 | 자격 / 내용 |
| R-22 | `integration.completed` | `open` 반영 항목 0개 (`deferred`는 허용) | A10, I12 | 내용 |
| R-23 | `question.recorded` | Concern 현재. 루프 조건은 질문을 낼 때 Concern의 현재 루프로 판정한다(탐구를 멈추고 C로 전환한 뒤 낸 선택 질문은 허용). 게이트·막는 범위(`blocks`)·가정 조합이 §3.13 스키마의 세 변형 중 하나. 같은 `dedupeKey`의 열린 질문이 있으면 새 질문 대신 `question.updated`. `loop = I.want`이고 `questionKind = choice`이고 선택지 2개 이상이면 거부. `send_approval`이면 `subjectRef`의 도구 호출이 `awaiting_approval`이고 지문이 같음. 비막힘 정보 질문이면 같은 트랜잭션에서 전제(`as`) 생성. `deadline`은 권리 게이트 질문에만 두고, 사람 채널 명령이 만든 질문이거나 사람이 `question.deferred`와 함께 준 마감일 때만 둔다(11 V-Q-10, [판정 J-49]) | **결정 12, 18** | 내용 |
| R-24 | `question.answered` | 행위자 `human`. 상태 `pending`·`delivered`(assumed면 `conflict.already_resolved`, [판정 J-120]). `agreement_confirm`·`result_review`가 아님([판정 J-124]). 답이 `answerSchema`를 통과. 사람이 본 질문 버전과 현재 버전이 같음 | 결정 12, L14(cursor-bound gate) | 자격 / 내용 / 충돌 |
| R-25 | `question.assumed` | 행위자 `kernel`·`scheduler`. 정보 게이트·비막힘. `now ≥ assumptionExpires`(시각 트리거면 커널 `ctx.now` 기준. 데몬 정지 중 지난 만료는 [판정 J-142]대로 미룰 수 있다). 같은 트랜잭션에서 `choice.committed`(assumption_confirmed) | 결정 12, helm-canon-3 C10 | 내용 |
| R-26 | `expectation.created` | `sentVia`의 도구 호출이 `completed`이고 primitive send, 또는 사람 알림 명령. `dueAt > sentAt` | v0.3 03 §7.2 | 내용 |
| R-27 | `prediction.recorded` | `basis` 1개 이상. `check.trigger.kind ≠ "manual"` | v0.3 04 §5.6 | 내용 |
| R-28 | `prediction.checked` | 관찰 1개 이상, 또는 행위자 `human` | v0.3 04 §5.5 | 내용 |
| R-29 | `loop_plan.adopted` | Concern 현재. 조합 1개 이상. `planDetail.flags`의 `Flag`마다 근거 1개 이상(`outOfPattern` 포함). `authoredBy = model`이면 모델 초안이 10의 계획 검사를 통과한 것이다. Autonomy 규칙 | 결정 5, 결정 14·53([판정 J-188]) | 내용 |
| R-30 | `loop.transitioned` | Concern 현재. `from`이 Concern의 `currentLoop`과 같음. Autonomy 규칙 | 결정 5 | 충돌 |
| R-31 | `situation.assessed` | 답들의 근거 합계 1개 이상. `supersedes`가 현재 판정 | v0.3 05 §3.2 규칙 5 | 내용 |
| R-32 | `structure.changed` (split) | 원 Concern `active`. 하위 개수·깊이가 다이얼 상한 이하(넘으면 사람 질문). 경계 항목 1개 이상 또는 `noBoundaryReason` | v0.3 03 §4.3 규칙 1·4·6 | 내용 |
| R-33 | `structure.changed` (recombine) | 모든 하위 Concern이 `completed`·`closed`·`merged`. 경계 항목이 모두 `checked`·`dropped` | v0.3 03 §4.3 규칙 2 | 내용 |
| R-34 | `concern.completed` | 하위 Concern 모두 종료(사람이 명시적으로 닫는 경우 예외) **[제안: 결정 15(4)]**. WorkUnit 모두 종료 상태. Concern 안에 `accepted`·`conditional` 결과 확인 1개 이상(**결정 15(2)**). Integration 모두 `completed`. 이 Concern 레코드를 대상으로 한 열린 이의 0개 | 결정 15(2), (4), 불변조건 7 | 내용 |
| R-35 | `goal.activated`, `goal.revised`, `goal.achieved`, `goal.superseded`, `goal.retired` | 행위자 `human` **[제안: 결정 15(5)]** | A6 | 자격 |
| R-36 | `preference.criterion_confirmed` | 행위자 `human`. 원 가능성이 `preference_criterion`이고 `open`. 지지 반응 관찰 1개 이상 | **E reveals N** | 자격 / 내용 |
| R-37 | `stimulus.created` | 탐구가 `open`이고 종류가 want·possibility. 출처 참조 실재 | v0.3 04 §3.2 | 내용 |
| R-38 | `observation.recorded` (reaction) | 대상이 자극이면 `presented`, 가능성이면 `open`·`pinned`. 반응 필드 하나 이상 | 결정 18 | 내용 |
| R-39 | `probe.planned` | WorkUnit `workKind = probe`. 가설이 현재 가능성 | v0.3 03 §3.3 | 내용 |
| R-40 | `policy_proposal.submitted` | 행위자 `agent:observer`. 근거 1개 이상. 같은 서명이 `dismissed`(scope `family_forever` 포함)된 적 있으면 그 뒤 seq의 새 근거가 있어야 함 | audit §3.2 | 자격 / 내용 |
| R-41 | `grant.issued`, `grant.revoked` | 행위자 `human`. `expiresAt > now` | F10 §6 | 자격 |
| R-42 | `run.started` | `ownerEpoch` = 현재 부팅 epoch. 재개(`attempt > 1`)면 같은 runId가 `interrupted`·`awaiting_*`. work 역할은 WorkUnit이 `delegated`·`in_progress`이거나, 쓰기 없는 탐구 WorkUnit이 `proposed` | 결정 30 | 경로 / 내용 |
| R-43 | 실행이 낸 모든 쓰기 (`toolcall.*`, 제안 명령, `declaredBy` 구조 명령) | 제출 envelope의 `via.runId` 실행이 `running`·`stopping`이고 `ownerEpoch`·`attempt`가 현재 값과 같음. 예외: 부팅 복구(`internal:recovery`)가 이전 epoch run에 대해 쓰는 `run.awaiting`·`question.recorded`(결과 불명 호출의 recovery 질문, [판정 J-122]), `run.interrupted`·`run.ended`(superseded·failed·recovery_exhausted)·`toolcall.not_executed`·`toolcall.interrupted`·`toolcall.outcome_uncertain`·`toolcall.completed`(recovered hash_verified) | 결정 30, 09 §3.8.3 | 경로 |
| R-44 | `mode.assigned` | 대상이 현재 | v0.3 07 §5 | 내용 |
| R-45 | `pairing.code_created`, `device.paired`, `device.revoked` | 코드 생성·폐기: 행위자 `human`, `via`가 `local_cli` 또는 다른 `active` 기기. 페어링: 행위자 `runtime`이고 같은 트랜잭션에서 `active` 코드가 `consumed`가 되거나, SSH 발급이면 행위자 `human` + `local_cli` (18 §3.7) | 18 | 자격 |
| R-46 | `record.staled`, `record.revalidated` | 원인 참조(`causeRef`)가 실재 | A13 | 내용 |
| R-47 | `situation.assessed` | 답이 yes·no인 질문마다 근거 1개 이상. `q.mixed_parts = yes`이면 `parts` 2개 이상. `computedBy`가 알려진 판정표 버전 | 14 §3.7 | 내용 |
| R-48 | `structure.changed` (hold) | `revisit` 존재 | 14, v0.3 03 §4.3 | 내용 |
| R-49 | `loop.transitioned` | `restart = true`면 `from = to`이고 이유 있음. `ruleId = OPEN`이면 `from = null`. `planDeviation`이 현재 계획과 맞음 | 14 G7 | 내용 |
| R-50 | `watch.defined`, `watch.judged` | 대상 실재. 판정은 `watching`이고 관찰 1개 이상 또는 행위자 `human` | 14 U-27 | 내용 |
| R-51 | `agreement.narrowed` | 합의 `active`. 좁힌 범위 ⊆ 현재 개정판 범위 | 10·11 §3.11 | 내용 |
| R-52 | `procedure.adopted`, `procedure.trust_changed` | 채택: 행위자 `human`. 신뢰 변경: `trusted`로 올리는 것은 `human`, `demoted`는 `human` 또는 채택된 `demotion` 제안 | 16 §3.16 | 자격 |
| R-53 | `preference_model.created` | `scope = goal`이면 `goalId`·`originConcernId` 존재, `user`이면 둘 다 null | 15 §3.7.2 | 내용 |
| R-54 | `rollback_point.registered` | `ref`가 가리키는 git ref나 blob이 실재 | 11 §3.12 | 내용 |
| R-55 | `decision.confirmed` | 행위자 `human`. 대상이 모두 Autonomy(또는 결정 블록)를 가진 레코드이고 autonomous | 10·11 | 자격 / 내용 |
| R-56 | `agreement.activated_by_choice` | 근거 선택(`ch`)이 사람이 직접 고른 것(`autonomy.decidedBy = human`, 가정 확정·맡기기가 아님). 그 선택을 낸 질문 선택지의 `scope`가 있고 합의 `scope` ⊆ 그 범위(primitives·resources·budget·validUntil). send가 있으면 활성은 되지만 send마다 권리 게이트는 그대로 ([판정 J-91·J-133]) | 01 R-OP-2(a) | 내용 |

굵은 글씨가 브리프 결정과 직접 대응하는 제약이다. 관계식 다섯(§3.1.1)은 R-15(E justifies N), R-05(N authorizes M), R-06(M updates E), R-19(M fulfills N), R-36(E reveals N)이다.

#### 3.20.3 링크 생성 규칙

이벤트가 기록될 때 투영기가 다음 링크를 만든다(별도 이벤트 없이 payload에서 파생). 링크 이벤트를 따로 두지 않는 이유: 같은 사실을 두 이벤트로 기록하면 어긋날 수 있다.

| 이벤트 | 생기는 링크 |
|---|---|
| `concern.opened` | concern `belongs_to` goal, concern `child_of` parent |
| `interpretation.proposed` | basis 관찰 각각 → interpretation `supports`; interpretation `depends_on` 각 관찰 |
| `claim.evidence_linked` | 대상 → 주장 (`relation`); 주장 `depends_on` 대상 (supports일 때) |
| `finding.promoted` | finding `derived_from` 원 주장; finding `depends_on` promotionBasis의 관찰·확인 |
| `choice.committed` | basis 각각 → choice `justifies`; choice `depends_on` basis; choice `supersedes` 이전 선택 |
| `agreement.proposed` | agreement `authorizes` workunit; agreement `depends_on` implementsChoices, goal |
| `toolcall.started` | agreement `authorizes` toolcall |
| `result.submitted` | result `fulfills` 각 기준(`cr`는 합의 내부 id이므로 to = 합의 id, note에 기준 id); result `depends_on` agreement |
| `objection.filed` | objection `contests` 대상 |
| `question.answered` | (답이 만든 레코드) `answers` question |
| `preference.criterion_confirmed` | 지지 반응 관찰 각각 → preference_model `reveals` |
| `structure.changed` | split: 하위 `split_from` 원; merge: 원 `merged_into` 대상 |
| `record.superseded` | 새 레코드 `supersedes` 옛 레코드 |
| `concern.reopened` | 원인 레코드 `reopens` concern |

### 3.21 품질 상태 전이

#### 3.21.1 단계(level)

```text
captured ──(구조 완성)──> structural ──(자격 근거 충족)──> qualified ──(권한 있는 수락)──> accepted
```

- 단계는 오르기만 한다. 내려가는 일은 없다. 근거가 약해진 경우는 플래그(contested, stale)로 표시한다.
- 대부분의 레코드는 기록 시점에 커널이 단계를 계산해 `structural` 이상으로 시작한다. `captured`는 해석되지 않은 가져오기 데이터와, 의미 필드가 비어 들어온 사람 입력(빠르게 적어 둔 선택 등)에만 쓴다.

#### 3.21.2 타입별 자격(qualified)과 수락(accepted) 조건

| 레코드 | qualified 조건 | accepted 조건 |
|---|---|---|
| Observation | 출처 검증 통과 (R-06) | - (관찰은 수락 대상이 아니다) |
| Assumption | `whyNeeded`, `howToTest` 존재 | `confirmed` 상태 |
| Interpretation | `basis` 관찰이 모두 `qualified` | - |
| Possibility | 근거 링크(supports) 1개 이상 | - (판단·선호 기준으로 승격되면 원 레코드는 promoted/confirmed) |
| DiscriminatingCheck | `observed`이고 `posthoc = false` | - |
| Finding | 승격 시점에 qualified | `confirmation.status = confirmed` |
| Choice | 근거 1개 이상, 대안 1개 이상, `rationale` 존재, `reviewTrigger` 존재(사소한 혼자 정한 결정 예외, §3.10.1) | 사람 결정이거나, 혼자 정한 결정이 맡긴 범위 안의 정책을 통과해 기록됨 |
| Agreement | 모든 필드 존재(R-03) | `active` |
| ResultSubmission | 기준마다 근거 관찰 1개 이상 또는 `unverified` 명시 | 결과 확인이 `accepted`·`conditional` |
| Attestation | 검증 에이전트 관찰 1개 이상 | - |
| Prediction | 기계 판정 가능한 확인 트리거와 방법 | - |
| LoopPlan, LoopTransition, ModeAssignment | 이유와 Autonomy 존재 | 사람 결정이거나 이의 없이 기록됨 |
| SituationAssessment | 답별 근거 합계 1개 이상 | 사람 확인(`situation_confirm` 질문) 또는 이의 없이 기록됨 |
| StructureChange | 경계 항목 또는 이유 | 사람 결정이거나 이의 없이 기록됨 |
| Goal | `successConditions` 1개 이상 | `active` |
| PreferenceModel (기준별) | 지지 반응 1개 이상 | 사람 확인(항상, R-36) |

"이의 없이 기록됨"은 기록 시점에 accepted로 둔다는 뜻이다. 혼자 정한 결정은 맡긴 범위 안의 정책을 통과했으므로 기준선이 되고, 이의가 걸리면 contested가 된다. accepted를 이의가 없어야만 주는 방식(시간이 지나야 accepted)은 택하지 않았다. 판정 시점이 모호해지기 때문이다.

#### 3.21.3 플래그

| 플래그 | 켜는 이벤트 | 끄는 이벤트 |
|---|---|---|
| contested | `objection.filed`(대상에 ct 추가), `claim.evidence_linked`(relation `challenges`·`invalidates`, 대상이 판단·accepted 선택의 근거일 때 ob 추가) | `objection.resolved`(dismissed·withdrawn), `claim.counter_resolved` |
| stale | `record.staled` (원인: §3.4.3 `StaleReason`) | `record.revalidated` |
| superseded | `record.superseded` (새 레코드의 `supersedes`) | 없음 (끝 상태) |

낡음 전파(커널 규칙, F05 I10·I11, 대화 L2723):

```text
onStale(root, reason, causeRef):
  queue = [root]; seen = {}
  while queue not empty:
    x = queue.pop()
    for each link L where L.rel == "depends_on" and L.to == x:
      y = L.from
      if y in seen or y.quality.stale or y.quality.supersededBy: continue
      emit record.staled { recordId: y, reason: (x is observation ? "evidence_stale" : reason), causeRef: x }
      seen.add(y); queue.push(y)
```

- 이 함수는 한 트랜잭션 안에서 끝난다. 전파 깊이 상한은 두지 않는다. `depends_on` 링크는 종류 순서(관찰·전제 < 해석·가능성·구분 확인 < 판단 < 선택·선호 모델 < 합의 < 결과 제출)의 뒤쪽에서 앞쪽으로만 생기도록 커널이 검사하므로 순환이 없고 전파는 끝난다. 관찰은 `depends_on`을 갖지 않는다.
- 원인별 시작점: 파일 변경(`material_change` 관찰) → 그 경로·이전 해시를 `materialRefs`에 가진 관찰. Goal 개정 → 이전 `goalVersion`에 기댄 합의·선택. 합의 개정 → 이전 개정판의 결과 제출. 전제 무효화 → 그 전제. 다시 볼 조건 충족 → 그 레코드.
- 낡은 레코드는 지우지 않는다. 투영은 낡은 기준선을 주의 항목으로 보인다(불변조건 6).

### 3.22 상태 기계

표기: `→`는 다음 상태. "가드"는 쓰기 시점 제약(§3.20) 외에 그 전이에만 있는 조건. "부수 효과"는 커널이 같은 트랜잭션에서 함께 기록하는 이벤트다. 표에 없는 (상태, 이벤트) 조합은 거부한다(`conflict.invalid_transition`, 내용 갈래). 상태 기계는 `@helm/domain/src/machines/*.ts`에 데이터로 둔다(대화 L2809 "명세를 실행 가능한 데이터로").

```ts
// @helm/domain/src/machines/types.ts
export interface Transition<S extends string, E extends string> {
  from: S | "∅";                 // ∅ = 레코드가 아직 없음
  on: E;                         // 09 이벤트 타입
  to: S;
  guard?: string;                // 가드 id. 구현은 10 커널 (rules/<id>.ts)
  effects?: readonly string[];   // 같은 트랜잭션에서 함께 기록되는 이벤트 타입
}
export type Machine<S extends string, E extends string> = {
  kind: string; states: readonly S[]; terminal: readonly S[]; transitions: readonly Transition<S, E>[];
};
```

#### 3.22.1 Goal

| 현재 | 이벤트 | 다음 | 가드 | 부수 효과 |
|---|---|---|---|---|
| ∅ | `goal.proposed` (에이전트·사람) | proposed | R-35는 확정에만 | 권리 게이트 질문 `goal_revision` (사람이 제안하면 생략) |
| ∅ | `goal.activated` (사람 직접 생성) | active | 행위자 human | `goalVersion = 1` |
| proposed | `goal.activated` | active | 행위자 human | `goalVersion = 1`, 질문 answered |
| proposed | `goal.retired` | retired | 행위자 human | 질문 answered(거절) |
| active | `goal.revision_proposed` | active | 근거 1개 이상, 대기 중 수정안 없음 | `pendingRevision` 설정, 권리 게이트 질문 |
| active | `goal.revised` | active | 행위자 human | `goalVersion + 1`, `pendingRevision = null`, 이전 버전에 기댄 합의·선택에 `record.staled(goal_revised)`, Concern마다 `goal_revision_check` 반영 항목 (v0.3 09 §4.8 "다시 확인 대상") |
| active | `goal.revision_rejected` | active | 행위자 human | `pendingRevision = null` |
| active | `goal.paused` | paused | 행위자 human | - |
| paused | `goal.resumed` | active | 행위자 human | - |
| active | `goal.achievement_claimed` | achievement_claimed | 성공 조건별 근거 1개 이상 | 권리 게이트 질문 |
| achievement_claimed | `goal.achieved` | achieved | 행위자 human | 하위 Concern 중 열린 것은 주의 항목 |
| achievement_claimed | `goal.achievement_rejected` | active | 행위자 human | - |
| active, paused | `goal.superseded` | superseded | 행위자 human, 대체 Goal id | `record.superseded` |
| proposed, active, paused, achievement_claimed | `goal.retired` | retired | 행위자 human | 열린 Concern은 주의 항목 |

종료: achieved, superseded, retired.

#### 3.22.2 Concern

| 현재 | 이벤트 | 다음 | 가드 | 부수 효과 |
|---|---|---|---|---|
| ∅ | `concern.opened` | open | R-01 | - |
| open | `concern.activated` (커널: 첫 루프 전환·WorkUnit 시작·탐구 시작) | active | - | - |
| open, active | `concern.reframed` | (그대로) | 같은 트랜잭션에 문제 관점을 정한 `choice.committed` (R-15) | `description`·`frameChoiceId` 갱신. 이전 관점에 기댄 열린 탐구는 주의 항목 (발산 반응의 N 전이 `concern.reframe`, audit §3.1) |
| open, active | `concern.held` (S.hold) | held | `structure.changed` op hold와 같은 트랜잭션 | 진행 중 실행 일시 정지 요청(12) |
| held | `concern.resumed` | active | - | - |
| open, active | `concern.completed` | completed | R-34 | - |
| open, active, held | `concern.closed` | closed | 사람: 언제나(`force`면 열린 WorkUnit 취소, 반영 항목 waived·deferred). 에이전트(S.close): 열린 WorkUnit·반영 항목 0 | 사람 강제 종료는 남은 항목을 기록 |
| open, active, held | `concern.merged` (S.merge) | merged | 대상 Concern 현재 | 열린 질문·WorkUnit을 대상으로 이전하는 이벤트(`workunit.superseded`, `question.withdrawn`+재기록)는 11·14 |
| completed, closed | `concern.reopened` | active | 원인 참조: 이의, 다시 볼 조건, 늦은 외부 응답, 사람 지시 | `reopenCount + 1`, `lastReopen` |
| active, held | `concern.reopened` | active | 원인 참조 | `reopenCount + 1` (진행 중에 이의가 걸린 경우도 기록) |

종료: merged. completed와 closed는 다시 열 수 있다.

표시 상태(`ConcernDisplayStatus`)의 계산은 09 §3.7이 정한 `@helm/store/src/views/concern-display.ts`의 함수가 한다.

#### 3.22.3 WorkUnit

[출처: 대화 L2145–2152 (X3-2-16) C/A 상태 기계, F05 §4 보조 전이]

| 현재 | 이벤트 | 다음 | 가드 | 부수 효과 |
|---|---|---|---|---|
| ∅ | `workunit.proposed` | proposed (재작업이고 범위 안이면 delegated) | R-02. 재작업이면 재작업 범위가 원 WorkUnit의 활성 합의 범위 안이어야 한다([판정 J-158]) | 범위 안이면 `agreementId`를 그 합의로 채운다. 범위 밖이면 `gate.scope_expansion_required`로 거부 |
| proposed | `agreement.proposed` | negotiating | R-03 | 질문 `agreement_confirm` (사람 조작 1회) |
| negotiating | `agreement.revised` | negotiating | - | 질문 갱신 |
| negotiating | `agreement.confirmed`, `agreement.activated_by_grant`, `agreement.activated_by_choice`, `agreement.activated_by_rule` | delegated | R-04, R-56 | - |
| negotiating | `agreement.declined`, `agreement.discarded` | proposed | declined: 행위자 human. discarded: 확정 전 초안 폐기(14) | 질문 withdrawn |
| proposed | `workunit.started` | in_progress | 쓰기 없는 탐구(`plannedPrimitives`에 write·send 없음) | - |
| delegated | `workunit.started` | in_progress | - | - |
| in_progress | `workunit.scope_exceeded` (커널: R-05 위반 차단) | scope_exceeded | - | 질문 `scope_change` (즉시), 실행 `run.awaiting` |
| scope_exceeded | `workunit.scope_resolved` (허락: `agreement.renegotiated` 동반 / 거절) | in_progress | 행위자 human | 허락이면 합의 새 개정판 |
| scope_exceeded | `agreement.proposed` (새 합의로 다시 맡김) | negotiating | 사람이 "범위 다시 정하기"를 고름 | 이전 합의 superseded |
| in_progress | `workunit.paused` | paused | 원인: 멈출 조건, 사람, 막힘 질문, 합의 만료, 범위 위반 감지, 예산 | 실행 일시 정지 요청 |
| paused | `workunit.resumed` | in_progress | 원인 해소 (질문 답, 사람 지시) | - |
| in_progress | `result.submitted` | submitted | R-17 | 질문 `result_review` (사람 조작 1회), 독립 검증 다이얼이 켜져 있으면 검증 실행 요청 |
| submitted | `acceptance.recorded` (accepted, conditional) | accepted | R-19 | `integration.opened`, 반영 항목들 `obligation.added`, 합의 `agreement.fulfilled` |
| submitted | `acceptance.recorded` (revision_requested) | in_progress | R-19 | `correctionCount + 1`. 합의는 그대로 |
| submitted | `acceptance.recorded` (rejected, criteria_wrong) | rejected | R-19 | 합의 `agreement.released`. 루프 전환은 커널이 내지 않고 14가 `reopenTo`로 `loop.transitioned`(T09·T11)를 낸다. Concern이 종료 상태일 때만 `concern.reopened` |
| submitted | `agreement.renegotiated` | in_progress | 행위자 human | 제출 결과 `record.staled(agreement_renegotiated)` |
| accepted | `integration.completed` | integrated | R-22 | - |
| in_progress | `workunit.concluded` | concluded | `workKind`가 inquiry·probe | 탐구 `inquiry.stopped` 또는 탐침 `probe.concluded`와 함께 |
| proposed, negotiating, delegated, in_progress, paused, scope_exceeded | `workunit.cancelled` | cancelled | 사람, 또는 Concern 종료·병합 | 합의 released, 실행 취소 요청, 열린 질문 expired |
| proposed, negotiating, delegated, in_progress, paused | `workunit.superseded` | superseded | 대체 WorkUnit id | 위와 같음 |
| submitted, accepted | `workunit.superseded` (재작업) | superseded | 같은 트랜잭션의 `workunit.proposed`에 `reworkOf.workUnitId` = 이 WorkUnit (11 §3.10.3) | 열린 결과 확인 질문 withdrawn. 결과 제출은 superseded. 활성 합의는 released하지 않는다(새 WorkUnit이 이어 쓴다, §3.7) |

종료: integrated, concluded, rejected, cancelled, superseded.

- "결과 확인 필요 --거절/기준이 틀림--> 다시 열림(C 또는 I로)"(X3-2-16)은 WorkUnit을 `rejected`로 끝내고 Concern 수준에서 루프 전환으로 이어 간다. 같은 WorkUnit을 되살리지 않는다. 기록이 단순해지고, 거절된 시도가 이력에 그대로 남는다(A14).
- 대화 X3-2-16에 없던 전이(Q1)를 채웠다: 범위 확인 중의 수정(`agreement.revised`)과 취소(`agreement.declined`), 멈출 조건(`workunit.paused`), 합의 만료(`agreement.expired` → paused), 조건부 확인의 조건(반영 항목 `acceptance_condition`).

#### 3.22.4 Agreement

| 현재 | 이벤트 | 다음 | 가드 | 부수 효과 |
|---|---|---|---|---|
| ∅ | `agreement.proposed` | proposed | R-03 | `revision = 1` |
| proposed | `agreement.revised` (사람 수정 또는 에이전트 재제안) | proposed | - | `revision + 1` |
| proposed | `agreement.confirmed` | active | R-04 (human) | `activation.mode = human` |
| proposed | `agreement.activated_by_grant` | active | R-04 (grant) | `activation.mode = grant`, Grant 활성화 횟수 + 1. 복귀 요약의 "에이전트가 정한 것"에 표시 |
| proposed | `agreement.activated_by_choice` | active | R-56 (사람이 직접 고른 선택의 범위 ⊇ 합의 범위, [판정 J-133]) | `activation.mode = choice_scope` |
| proposed | `agreement.activated_by_rule` | active | 쓰기 없는 탐구 합의 (10 §3.11.6) | `activation.mode = rule` |
| proposed | `agreement.confirmed` (via 결과 확인) | active | 반영 범위 합의. 같은 트랜잭션의 `acceptance.recorded`(accepted·conditional)가 `integrationAgreement`로 확정 ([판정 J-126]) | `activation.mode = result_acceptance`(`acceptanceId`), `via` = 결과 확인 명령 |
| proposed | `agreement.declined`, `agreement.discarded` | declined | declined: 행위자 human. discarded: 확정 전 초안 폐기 | - |
| active | `agreement.narrowed` | active | R-51 | `narrowedScope` 설정 |
| active | `agreement.restored` | active | `narrowedScope` 있음 | `narrowedScope = null` (또는 `restoredTo`) |
| active | `agreement.scope_change_requested` | active | 대기 중 요청 없음 | `pendingScopeChange`, 질문 `scope_change` |
| active | `agreement.renegotiated` | active | 행위자 human (또는 scope_change 질문의 허락 답) | `revision + 1`, 이전 개정판 기준 결과 제출 stale, 실행에 컨텍스트 갱신 요청 |
| active | `agreement.stop_condition_met` | active | 멈출 조건 문구 지정 | WorkUnit `workunit.paused(stop_condition)`, 질문 `stop_condition` |
| active | `agreement.violation_detected` | active | 근거 관찰(사후 diff 검사 등) | WorkUnit paused(violation), 주의 항목, 질문 (13의 bash 우회 감지 경로) |
| active | `agreement.fulfilled` (커널) | fulfilled | 이 합의의 결과가 accepted·conditional | - |
| active | `agreement.expired` (스케줄러) | expired | `now ≥ scope.validUntil` | WorkUnit paused(agreement_expired) |
| active, proposed | `agreement.released` | released | 사람, 또는 WorkUnit rejected·cancelled | - |
| proposed, active | `record.superseded` | superseded | 같은 WorkUnit의 새 합의 | - |

종료: fulfilled, released, declined, expired, superseded.

원전 대응(helm-canon-3 G2, F05 §8 Commitment): Request = proposed, Counter = revised, Accept = confirmed, Renegotiate = renegotiated, Breach = violation_detected(합의를 끝내지 않고 멈춤), Release·Withdraw = released, Fulfilled = fulfilled. Transferred(이관)는 1인 앱에서 에이전트 사이 이관이 WorkUnit 대체(`workunit.superseded`)로 표현되므로 두지 않는다.

#### 3.22.5 ResultSubmission, Acceptance

| 현재 | 이벤트 | 다음 | 가드 | 부수 효과 |
|---|---|---|---|---|
| ∅ | `result.submitted` | submitted | R-17 | 같은 WorkUnit의 이전 submitted 결과는 superseded |
| submitted | `attestation.recorded` | submitted | R-18 | `attestationIds` 추가. verdict가 challenges면 결과 확인 질문에 표시 |
| submitted | `acceptance.recorded` | accepted / conditionally_accepted / revision_requested / rejected / criteria_wrong (결정값에 따름) | R-19 | §3.22.3 |
| submitted | `record.staled` (agreement_renegotiated) | stale | - | - |
| submitted | `record.superseded` | superseded | 새 제출 | - |

Acceptance는 만든 뒤 바뀌지 않는다. 사람이 확인을 되돌리려면 그 결과 확인(`ac`)이나 결과(`rs`)에 이의를 건다([판정 J-123]).

- 조건 붙여 확인(conditional)의 조건은 같은 트랜잭션에서 `acceptance_condition` 반영 항목이 되고 곧바로 `deferred`(revisitTrigger = 조건 문장의 `manual` 또는 사람이 고른 Trigger)가 된다. 사람 조작은 결과 확인 한 번으로 끝난다(AC-07-09, [판정 J-125]).
- 결과 확인 때 고른 반영 처리 방침 `obligationPolicy`(proceed_all / defer_limits)를 Acceptance에 남기고, 커널 규칙 R-1(10)이 같은 트랜잭션에서 그 방침대로 항목을 만들고 미룬다.

#### 3.22.6 Integration, Obligation

| 대상 | 현재 | 이벤트 | 다음 | 가드 | 부수 효과 |
|---|---|---|---|---|---|
| Integration | ∅ | `integration.opened` | open | R-20 | 커널 규칙이 만든 반영 항목들 (`obligation.added`): 바뀐 파일의 관련 문서·테스트, 결과가 깨뜨린 선택·전제, 다른 열린 Concern과의 충돌, 조건 붙여 확인의 조건 (X3-2-14) |
| Integration | open | `integration.completed` (커널) | completed | R-22 | WorkUnit integrated |
| Obligation | ∅ | `obligation.added` | open | - | - |
| Obligation | open | `obligation.resolved` | resolved | R-21 | 마지막 open이면 `integration.completed` |
| Obligation | open | `obligation.deferred` | deferred | 이유와 다시 보일 조건 | 마지막 open이면 `integration.completed`. 복귀 요약 맨 위 |
| Obligation | deferred | `obligation.reopened` (스케줄러·커널: 조건 충족, 또는 사람) | open | - | 통합이 completed였으면 WorkUnit은 integrated 유지, Concern 주의 항목 |
| Obligation | open, deferred | `obligation.transferred` | transferred | 대상 Concern·WorkUnit 현재 | 대상 쪽에 새 반영 항목 |
| Obligation | transferred | `obligation.reopened` (사람) | open | 넘긴 쪽 항목이 아직 open·deferred | 넘긴 쪽 항목은 같은 트랜잭션에서 `obligation.waived`(사유 "되돌림") |
| Obligation | open, deferred | `obligation.waived` | waived | 행위자 human | - |

#### 3.22.7 Question

[출처: v0.3 06 §3.5, 대화 L3793–3801 (d5)]

| 현재 | 이벤트 | 다음 | 가드 | 부수 효과 |
|---|---|---|---|---|
| ∅ | `question.recorded` | pending | R-23 | 비막힘이면 전제 `assumption.recorded` |
| pending, delivered | `question.updated` (커널, dedupe 병합) | (그대로) | 같은 `dedupeKey` | 근거 합집합, `blocks`는 강한 쪽, 만료는 이른 쪽, `mergedCount + 1` |
| pending | `question.delivery_planned` (중재자·커널) | pending | - | `plannedDelivery`(Autonomy 포함), 전달 타이머 (09 `p_timers`) |
| delivered | `question.seen` | delivered | 사람 기기 | `seenAt` |
| pending, delivered | `question.deferred` (사람 "나중에") | pending | - | `deferrals`에 추가, 다시 전달할 타이머. 마감(`deadline`)을 함께 주면 권리 질문에만 설정한다([판정 J-49]) |
| pending, delivered | `question.reframe_requested` (사람) | (그대로) | - | 에이전트가 새 질문을 만들면 이 질문은 `withdrawn` |
| pending, delivered | `question.delegated` (사람 "맡긴다") | delegated | 정보 게이트만 | 이어지는 결정은 `whyNotAsked = delegated_by_human` |
| pending | `question.delivered` (전달기) | delivered | - | `deliveredAt`, `deliveredTo` |
| pending, delivered | `question.escalated` | (그대로) | 전달 방식이 이미 immediate가 아님 | 즉시 전달 |
| pending, delivered | `question.answered` | answered | R-24 | `matchesAssumption` 계산. 다르면 전제 `assumption.invalidated`(낡음 전파). 종류별 효과: `choice` → `choice.committed`(human), `criterion_confirm` → `preference.criterion_confirmed`(항목별 적용은 10 §3.11.9), `scope_change` → `workunit.scope_resolved`, `send_approval` → `toolcall.approved`/`denied`, `goal_revision` → `goal.revised`/`goal.revision_rejected`, `recovery` → `toolcall.recovered`(사람 답의 발화를 같은 트랜잭션의 `utterance` 관찰로 만들어 `evidence`에 넣는다) |
| pending, delivered | (전용 명령) `agreement.confirmed`·`declined`·`revised`, `acceptance.recorded` | answered | `agreement_confirm`·`result_review` 질문은 19 전용 메서드(`agreement.confirm`, `result.accept`)로만 닫힌다. 이 두 종류에 `question.answer`가 오면 `policy.answer_option_not_allowed` ([판정 J-124]) | 질문 `answer`에 전용 명령 결과 요약 |
| pending, delivered | `question.assumed` (커널·스케줄러) | assumed | R-25 | `choice.committed`(assumption_confirmed, autonomous), 전제 `assumption.confirmed` |
| pending, delivered (triad·stimulus_round) | 반응 관찰(`observation.recorded` reaction, `questionId`) | answered | 질문이 가리킨 자극·가능성에 대한 반응 | triad는 첫 반응으로, stimulus_round는 라운드 마감(`inquiry.round_ended`)으로 answered. 반응 없이 라운드가 닫히면 `question.withdrawn`(round_closed) |
| pending, delivered | `question.withdrawn` | withdrawn | 행위자: 질문을 만든 쪽 또는 커널 | 전제 retired |
| pending, delivered | `question.expired` (커널·스케줄러) | expired | Concern 종료·병합, WorkUnit 취소, 대상 레코드 종료, 또는 권리 질문의 `deadline` 지남 | 전제 retired. 권리 질문이면 대상 행동은 실행되지 않은 채 끝남 |
| answered (send_approval) | `approval.issued` | answered | 허락 답 | `approval.status = issued`, 만료 타이머 |
| answered | `approval.consumed` / `approval.expired` | answered | 지문이 같은 `toolcall.started` / 만료 시각 | `approval.status` 갱신 |

종료: answered, withdrawn, expired, delegated, assumed. assumed 뒤 도착한 답은 `conflict.already_resolved`(3008)로 거부하고, 응답에 확정된 값(`assumedValue`)과 다음 행동 "이의로 보내기"를 싣는다. 화면은 쓰던 답을 이의 초안으로 넘긴다([판정 J-120]). 11이 쓰는 `scheduled`는 `pending`이면서 `plannedDelivery`가 있는 상태로 표현한다(§10).

- 권리 게이트 질문은 assumed가 될 수 없다(스키마, R-25). 가정 만료점이 없으므로 만료로 진행되지 않고 대상 행동이 계속 막힌다(helm-canon-3 C10).
- 기록과 전달은 다른 이벤트다(`question.recorded` / `question.delivered`, 결정 12). 같은 질문에 알림을 반복하지 않는다(v0.3 09 §6). 알림 재발송은 프로토콜·앱의 일이며 이벤트를 만들지 않는다.

#### 3.22.8 Expectation

| 현재 | 이벤트 | 다음 | 가드 | 부수 효과 |
|---|---|---|---|---|
| ∅ | `expectation.created` | open | R-26 | 기한 타이머 |
| open | `expectation.fulfilled` | fulfilled | 같은 트랜잭션의 `observation.recorded`(external_response, expectationId) | - |
| open | `expectation.timed_out` (스케줄러) | timed_out | `now ≥ dueAt` | `observation.recorded`(no_response). 루프 전환 제안(14) |
| timed_out | `expectation.fulfilled` (늦은 응답) | late_fulfilled | 위와 같음 | 관련 Concern이 종료 상태면 `concern.reopened` |
| open | `expectation.cancelled` | cancelled | - | - |

#### 3.22.9 Probe, Prediction

| 대상 | 현재 | 이벤트 | 다음 | 가드 | 부수 효과 |
|---|---|---|---|---|---|
| Probe | ∅ | `probe.planned` | planned | R-39 | - |
| Probe | planned | `workunit.started` (탐침 WorkUnit) | running | - | - |
| Probe | running | `probe.concluded` (outcome grown·folded·inconclusive·exhausted) | grown / folded / inconclusive / exhausted | 관찰 1개 이상. 판정 블록의 Autonomy 규칙 | `workunit.concluded`. grown이면 약속형 C 전환 제안, folded면 I 전환 제안 (v0.3 03 §6) |
| Watch | ∅ | `watch.defined` | watching | R-50 | `watch_window` 타이머 |
| Watch | watching | `watch.window_closed` (스케줄러) | watching | 기한 도래 | 판정 요청 (14) |
| Watch | watching | `watch.judged` | judged | R-50 | regressed면 루프 전환 제안 (14) |
| Watch | watching | `watch.cancelled` | cancelled | - | 타이머 해제 |
| Probe | planned, running | `probe.cancelled` | cancelled | - | WorkUnit cancelled |
| Prediction | ∅ | `prediction.recorded` | open | R-27 | 확인 타이머 |
| Prediction | open | `prediction.checked` | checked | R-28 | failed면 관찰에 surprise 주석 |
| Prediction | open | `prediction.voided` | void | 연결 선택이 대체됨 등 이유 | - |

#### 3.22.10 Interpretation, Possibility, Assumption, OpenQuestion

| 대상 | 현재 | 이벤트 | 다음 | 가드 | 부수 효과 |
|---|---|---|---|---|---|
| Interpretation | ∅ | `interpretation.proposed` | active | R-07 | 링크 |
| Interpretation | active | `finding.promoted` | promoted | R-13 | - |
| Interpretation | active | `interpretation.retracted` | retracted | - | - |
| Interpretation | active | `record.superseded` | superseded | - | - |
| Possibility | ∅ | `possibility.proposed` | open | R-08 | 링크 |
| Possibility | open | `possibility.rejected` | rejected | 근거 refs 1개 이상 | - |
| Possibility | open | `possibility.marked_undecidable` | undecidable | 탐구가 멈춤(예산·조건) | 열린 질문 기록 권장 |
| Possibility | open, undecidable | `finding.promoted` | promoted | R-13 | - |
| Possibility | open | `preference.criterion_confirmed` | confirmed | R-36 | - |
| Possibility | open | `possibility.withdrawn` | withdrawn | 제안자 | - |
| Possibility | open | `possibility.dismissed` | dismissed | 사람 (근거 없이 내려도 됨, 15) | - |
| Possibility | open | `possibility.merged` | merged | `mergedInto`가 같은 Concern의 open 가능성 | 근거 링크는 병합 대상에서도 보임 |
| Possibility | open | `possibility.pinned` / `possibility.unpinned` | open | 사람 | `pinned` 토글 (상태 아님) |
| Possibility | open, undecidable | `record.superseded` | superseded | - | - |
| Assumption | ∅ | `assumption.recorded` | active | - | - |
| Assumption | active | `assumption.confirmed` | confirmed | 근거 refs 또는 사람, 또는 질문 assumed | - |
| Assumption | active, confirmed | `assumption.invalidated` | invalidated | 근거 refs 또는 사람 | 낡음 전파(assumption_invalidated) |
| Assumption | active | `assumption.retired` | retired | - | - |
| OpenQuestion | ∅ / open | `open_question.recorded` / `open_question.resolved`, `open_question.dropped` | open / resolved, dropped | resolved는 refs 1개 이상 | - |

가능성의 strengthened·weakened(paper-v0 Hypothesis status)는 저장하지 않고 근거 링크에서 `SupportTrend`로 계산한다.

#### 3.22.11 Finding

| 현재 | 이벤트 | 다음 | 가드 | 부수 효과 |
|---|---|---|---|---|
| ∅ | `finding.promoted` | active (unconfirmed, qualified) | R-13 | 원 주장 promoted |
| active | `finding.confirmed` | active (confirmed, accepted) | R-14 | - |
| active | `claim.evidence_linked` (challenges·invalidates) | active (contested) | - | Concern이 종료 상태면 `concern.reopened` (대화 L2234) |
| active | `finding.withdrawn` | withdrawn | 사람, 또는 반대 근거 해소 실패 후 에이전트 제안 + 사람 확인 | 이 판단에 기댄 선택에 낡음 전파 |
| active | `record.superseded` | superseded | - | 낡음 전파 |

#### 3.22.12 Choice, Objection

| 대상 | 현재 | 이벤트 | 다음 | 가드 | 부수 효과 |
|---|---|---|---|---|---|
| Choice | ∅ | `choice.committed` | committed | R-15 | 사람 결정이 미확인 판단을 근거로 하면 `finding.confirmed(via choice_commit)`. `supersedes`가 있으면 `record.superseded` |
| Choice | committed | `objection.filed` | committed (contested) | R-16 | Concern 다시 열림 (§3.22.2) |
| Choice | committed | `record.superseded` | superseded | 새 선택 | 이 선택을 대상으로 한 열린 이의는 `objection.resolved(upheld)` |
| Choice | committed | `choice.revoked` | revoked | 행위자 human | 위와 같음, 이 선택을 구현하는 합의에 낡음 전파 |
| Objection | ∅ | `objection.filed` | open | R-16 | 대상 contested |
| Objection | ∅ | `objection.filed` (desiredEffect note_only) | noted | R-16 | 대상 contested 아님. 기록만 |
| Objection | open | `objection.resolved` (upheld·withdrawn·dismissed) | upheld / withdrawn / dismissed | upheld: 대상이 대체·철회됨(커널). withdrawn: 사람, 또는 이의 검토 전에 대상이 이미 대체·철회되어 커널이 닫음(10 G-K6). dismissed: 사람 | 대상 `contestedBy`에서 제거 |
| 결정 레코드 | (상태 그대로) | `decision.confirmed` (사람) | (그대로) | R-55 | `quality.confirmedSeq` |

같은 이의 흐름이 LoopPlan, LoopTransition, SituationAssessment, StructureChange, ModeAssignment에도 적용된다. 이 레코드들의 상태는 `active`·`current`·`applied` → `superseded` 하나뿐이다.

#### 3.22.13 Run

[출처: 12 §3.2.2가 정본이다. 아래는 08 레코드에 남는 전이만 옮긴 것이다]

| 현재 | 이벤트 | 다음 | 가드 | 부수 효과 |
|---|---|---|---|---|
| ∅ | `run.queued` | queued | 같은 thread에 활성 run 없음 | - |
| queued, interrupted | `run.started` (attempt) | running | R-42 | `ownerEpoch = 현재`, interrupted에서 오면 `attempt + 1`, `recoveryAttempts + 1` |
| running | `run.awaiting` (question / recovery) | awaiting_human / awaiting_recovery | 막힘 질문 / 결과 불명 호출 | - |
| running | `run.stopping` | stopping | 취소·마무리 신호 | 진행 중 도구 취소 방식에 따름(13) |
| queued, running, stopping | `run.interrupted` (부팅 복구, `internal:recovery`) | interrupted | `ownerEpoch` ≠ 현재 epoch. `awaiting_*`는 부팅 때 그대로 둔다([판정 J-39], 늦게 오는 답을 받기 위해) | 시작됐던 도구 호출 정리(§3.22.14). 결과 불명 외부 호출이 있으면 run을 interrupted로 두지 않고 `run.awaiting(recovery)`로 옮긴다. 이때 `run.ended`는 내지 않는다([판정 J-122]) |
| awaiting_human, awaiting_recovery | `run.ended` (handed_off) | ended | 답·복구 기록이 옴. 멱등 키 `handoff:<awaitingRunId>` | 같은 thread에 새 run이 이어받는다([판정 J-38]). 대기 상태에서 running으로 돌아가지 않는다 |
| awaiting_human, awaiting_recovery | `run.ended` (cancelled) | ended | 그 WorkUnit이 종결됨(10 react: WorkUnit 종결 → 비종결 run에 abort) | 열린 질문 withdrawn |
| queued, running, stopping, awaiting_*, interrupted | `run.ended` (reason) | ended | 12 RunEndReason | `end`, `endedAt` |

재개(interrupted → running)는 같은 runId의 새 attempt이며, 디스패치 키는 `recover:<runId>:<attempt>`다(12). 12 §3.2.3의 stage(inference, tools, compaction, settlement, idle)는 레코드에 두지 않는다. 같은 트랜잭션의 trace `run.stage`(09 §3.7)에 남고 부팅 복구가 그것을 읽는다. 도메인 상태(State)는 이벤트만으로 다시 만들어지고, stage는 실행 재개에만 쓰이는 운영 정보이기 때문이다.

종료: ended 하나. 이유는 `end.reason`(yielded, handed_off, cancelled, budget_exhausted, step_limit, failed, recovery_exhausted, superseded, context_overflow)이다. 정상 종료(데몬 종료)로 끊긴 run의 코드는 17의 `daemon_shutdown` 하나로 쓴다([판정 J-122]). 재개는 같은 runId의 새 attempt다(12 §3.7.5).

#### 3.22.14 ToolCall

[출처: 결정 30, pi-durable `pi.tool` task의 call/execute 단계 (`~/projects/_ref/pi-src/packages/durable/docs/spec.md:3869-3927`, pi-api-facts-1 §7.3) [원문], helm-kernel-v02 agent-runtime의 uncertain/recovery [실험], 12 §3.4]

| 현재 | 이벤트 | 다음 | 가드 | 부수 효과 |
|---|---|---|---|---|
| ∅ | `toolcall.requested` | requested | R-43 | `modelArgs` |
| requested | `toolcall.blocked` | blocked | 커널·권한 레이어·합의 범위·경로 정책 판정 | 범위 밖이면 `scope_change` 질문 (R-05) |
| requested | `toolcall.approval_requested` | awaiting_approval | 권리 게이트 (권한 레이어 `rightsGate = true`, send, 또는 `externalEffect = 'uncertain'` [판정 J-206]) | 질문 `send_approval`(즉시) |
| awaiting_approval | `toolcall.approved` | requested | 질문 answered(그대로 허락) | `approval.issued`. 같은 tcId로 실행한다(J-40) |
| awaiting_approval | `toolcall.denied` (edited_by_human) | denied | 질문 answered(고쳐서 허락, [판정 J-121]) | 같은 트랜잭션에 새 호출의 `toolcall.requested`(`editedFrom`)와 그 호출을 위한 `approval.issued`. 새 호출은 런타임이 13 prepare와 권한 판정을 다시 한 뒤 `toolcall.started`를 내고, 커널은 지문을 승인과 대조한다 |
| awaiting_approval | `toolcall.denied` (human) | denied | 질문 answered(거절) | - |
| awaiting_approval | `toolcall.not_executed` (approval_expired) | not_executed | 승인 질문이 만료됨(§3.22.7 `question.expired`) 또는 승인 만료 시각이 지남 | 같은 트랜잭션에 `approval.expired`. 실행 전에 끝났음이 확실하다 (10, 12) |
| awaiting_approval | `toolcall.not_executed` (cancel) | not_executed | 합의 취소, Concern 닫힘, run 취소 (11) | 질문 withdrawn |
| requested (승인됨) | `toolcall.not_executed` (approval_expired) | not_executed | `approval_expiry` 타이머. 같은 트랜잭션에 `approval.expired` | - |
| requested | `toolcall.started` | started | R-05, R-43. **실행 전에 커밋** (write-ahead) | `execution` 채움. send면 `approval.consumed` |
| requested | `toolcall.not_executed` (NotExecutedReason) | not_executed | 시작 기록 없이 끝남. 실행되지 않았음이 확실 | - |
| started, replaying | `toolcall.not_executed` (cancel·superseded) | not_executed | 실행 직전 취소되어 프로세스를 띄우지 않았음이 확실 (12) | - |
| started | `toolcall.completed` (outcome completed) | completed | - | `observation.recorded(tool_result)`. 사후 검사(`enforcement = post_hoc`)에서 범위 밖 변경이면 `scope_violation` 질문 |
| started | `toolcall.interrupted` | interrupted | 협조형 취소·조종, 또는 부팅 복구에서 replay가 never | `observation.recorded(tool_interrupted)` |
| started, replaying | `toolcall.outcome_uncertain` | outcome_uncertain | 도구가 외부 결과 불확실을 보고, 또는 부팅 복구에서 외부 효과가 있는 호출(같은 배치의 REPLAY 대상도 함께, [판정 J-122]) | `observation.recorded(tool_interrupted, outcome_uncertain)`, `run.awaiting(recovery)`, `recovery` 질문(외부 효과가 있을 때) |
| started | `toolcall.replay_started` | replaying | 실행 재개 때 커널 재검사(합의·권한)를 통과한 뒤(판정 J-41). 저장된 replay와 현재 도구 정책이 모두 safe | - |
| started | `toolcall.completed` (recovered hash_verified) | completed | 부팅 복구에서 `replayGuard.after` 해시가 실제 파일과 같음 | 관찰 |
| replaying | `toolcall.completed` | completed | - | 관찰 |
| interrupted, outcome_uncertain | `toolcall.recovered` | recovered | 사람 또는 검증 관찰 | 해결 기록 |

종료: blocked, denied, not_executed, completed, recovered. interrupted는 복구 기록이 없어도 종료로 본다(재실행하지 않음). run을 ended로 바꾸는 트랜잭션은 그 run이 시작한 started·replaying 호출을 함께 닫는다(외부 효과가 있으면 outcome_uncertain, 없으면 interrupted). 부팅 정리는 run과 무관하게 started·replaying인 모든 호출을 대상으로 하며(09 §3.8.2), requested인 호출은 유효한 승인이 있으면 그대로 두고 없으면 not_executed(restart)로 닫는다. 읽기 빠른 경로는 requested → started → completed를 한 트랜잭션에 남긴다(§3.18.2). `primitive = null`인 제안 도구(Helm 제안 도구)도 세 이벤트를 한 트랜잭션에 남기고 관찰을 만들지 않는다(판정 J-43). 사람이 승인한 행동은 같은 tcId로 `toolcall.approved` → `started`가 되고 `approval.consumed`가 같은 트랜잭션에 남는다(판정 J-40).

#### 3.22.15 Grant, Device, PairingCode, PolicyProposal, Procedure, Stimulus, Inquiry, PreferenceModel, Thread, RollbackPoint

| 대상 | 전이 (현재 --이벤트--> 다음) |
|---|---|
| Grant | ∅ --`grant.issued`--> active; active --`grant.revoked`--> revoked; active --`grant.expired`(스케줄러)--> expired; active --`grant.exhausted`(활성화 횟수 소진, 커널)--> exhausted |
| Device | ∅ --`device.paired`--> active; active --`device.renamed`·`device.token_rotated`·`device.bound_to_node`--> active; active --`device.expired`(스케줄러)--> expired; active·expired --`device.revoked`--> revoked (18) |
| PairingCode | ∅ --`pairing.code_created`--> active; active --`pairing.code_consumed`--> consumed; active --`pairing.code_failed`(attemptsLeft 0)--> exhausted; active --`pairing.code_expired`--> expired; active --`pairing.code_cancelled`--> cancelled (18 §3.7.4) |
| PolicyProposal | 16 §3.15.3이 정본: ∅ --`submitted`--> open; open --`evidence_updated`--> open; open --`accepted`·`dismissed`·`deferred`·`withdrawn`·`expired`--> 각 상태; deferred --`reopened`--> open; accepted --`application_opened`--> applying; accepted·applying --`applied`--> applied; applying --`application_abandoned`--> dismissed; applied --`effect_measured`--> applied; applied --`reverted`--> reverted (이름 앞 `policy_proposal.` 생략) |
| Procedure | ∅ --`procedure.adopted`--> active(trial); active --`procedure.trust_changed`--> active(trial·trusted·demoted); active --`procedure.retired`--> retired |
| Thread | ∅ --`thread.opened`--> open; open --`thread.closed`--> closed |
| RollbackPoint | ∅ --`rollback_point.registered`--> available; available --`rollback_point.used`--> used; available --`rollback_point.expired`--> expired |
| Stimulus | ∅ --`stimulus.created`--> created; created --`stimulus.presented`--> presented; created·presented --`stimulus.withdrawn`--> withdrawn |
| Inquiry | ∅ --`inquiry.opened`--> open; open --`inquiry.anchored`·`round_started`·`round_ended`·`stage_completed`·`perspective_added`·`cell_closed`·`stop_rule_met`--> open; open --`inquiry.stopped`--> stopped |
| PreferenceModel | ∅ --`preference_model.created`--> active; active --`preference.criterion_confirmed`·`criterion_revised`·`criterion_retired`--> active(`modelVersion + 1`, 같은 트랜잭션에 `preference_model.versioned`); active --`preference.example_marked`·`divergence_noted`--> active; active --`record.superseded`--> superseded |
| LoopPlan 등 결정 레코드 | ∅ --생성 이벤트--> active·current·applied; --`record.superseded`--> superseded |

### 3.23 거부 세 갈래 [제안: 브리프 §3.5 요구(P5·P6 담당) / 분류 기준: 대화 L3220–3224]

```ts
// @helm/domain/src/rejection.ts
export const RejectionClass = ["content", "authority", "path"] as const;
export const RejectionClassSchema = Enum(RejectionClass);
/**
 * content   내용: 누가 보냈어도 거부 (스키마, 참조, 상태, 승격 조건, 범위 밖 내용)
 * authority 자격: 같은 내용을 다른 행위자가 보냈다면 통과 (능력표 A, 정책 P의 행위자 조건)
 * path      경로: 정해진 변경 경로를 거치지 않음 (이벤트 직접 제출, 투영 어휘 쓰기, 낡은 epoch)
 */
export const REJECTION_CODE_PATTERN = "^(invalid|not_found|conflict|policy|denied|gate|path)\\.[a-z0-9_.]+$";
export declare function rejectionClassOf(code: string): (typeof RejectionClass)[number];
```

| 코드 접두사 | 갈래 | 예 (전체 목록은 10) |
|---|---|---|
| `invalid.*` | 내용 | `invalid.schema`, `invalid.evidence_not_found`, `invalid.check_not_discriminating` |
| `not_found.*` | 내용 | `not_found.record` |
| `conflict.*` | 내용 | `conflict.invalid_transition`, `conflict.version_mismatch`, `conflict.already_resolved`. 같은 멱등 키·다른 지문은 거부 코드 대신 저장소 결과 `key_reused`다(09 §3.9.2) |
| `policy.*` | 내용 | `policy.promotion_requirements`, `policy.want_inquiry_pick_question`, `policy.forbidden_resource` |
| `denied.*`, `gate.*` | 자격 | `denied.capability`, `gate.human_required`, `gate.scope_expansion_required`, `denied.producer_cannot_attest` |
| `path.*` | 경로 | `path.adapter_cannot_append_event`, `path.projection_is_derived`, `path.stale_epoch`, `path.direct_store_write` |

- helm-toy 거부 8건의 분류(대화 L3220–3224): 내용 3·4·7·10·17, 자격 5·19, 경로 21. helm-kernel-v02 결과 코드의 대응은 helm-canon-2 §9.3 끝.
- 범위 밖 호출은 자격 갈래(`gate.scope_expansion_required`)다(10 ADR-K8을 따른다). 같은 호출이 사람의 범위 확장 답이 있으면 통과하므로 "누가 허락했는가"의 문제로 본다. 거부 기록과 함께 선택 요청(`scope_change` 질문)을 연다. 금지 자원(`forbiddenResources`)은 확장으로도 통과하지 않으므로 내용 갈래(`policy.forbidden_resource`)다. 1판의 `policy.scope_exceeded`는 쓰지 않는다.
- 강등(`downgraded.*`)은 거부가 아니다. 결과 상태 `accepted`에 강등 코드를 붙여 돌려준다(R-07, R-17).
- 거부된 시도도 기록에 남는다(A14). 기록 방식은 09 §3.9(`command.rejected` 이벤트, 게이트면 `gateQuestionId` 포함).
- 계획 검사(10 §3.8.1)로 거부된 기록의 `ruleId`는 V-PLAN-01~07 가운데 하나다([판정 J-188]).
- 다른 문서의 1판 코드(`content.*`, `qualification.*`, `eligibility.*`)는 위 접두사로 옮긴다. 대응은 10 §3.4.6이 정본이다.

### 3.24 불변조건과 타입 수준 대응

[결정 17. 공리 A1~A15의 집행 지점·위반 테스트 전체는 10이 소유한다. 이 절은 타입과 쓰기 시점 제약으로 지키는 부분만 적는다]

#### 3.24.1 v0.3 불변조건 1~7

| 번호 | 불변조건 | 타입·스키마 수준에서 지키는 방법 | 런타임 검사(10) |
|---|---|---|---|
| 1 | 기록과 진실은 다르다 | 이벤트 envelope의 기록 정보(actor, via, recordedAt)와 payload를 분리(09). 레코드에 "참/거짓" 필드가 없고 품질 상태로만 표현. 외부 관찰의 summary는 "말했다" 형식. 판단에 `scope`, `invalidationTriggers` 필수 | 승격 조건 |
| 2 | 관찰, 추측(해석·가능성), 판단, 선택은 다르다 | 서로 다른 `kind`·접두사·스키마. 한 레코드의 종류를 바꾸는 이벤트가 없음. 판단은 승격 때 새 레코드로만 생김. 관찰은 모델 행위자가 못 만듦(R-06). 관찰 없는 해석은 전제로 강등(R-07) | R-06, R-07, R-13 |
| 3 | 투영은 정본을 쓰지 않는다 | 이벤트 타입 목록에 `projection.`으로 시작하는 이름이 없음(09 §3.3). 투영 전용 값(복귀 요약 id 등)은 레코드 id 형식이 아님. 표시 상태(`ConcernDisplayStatus`, `SupportTrend`)는 저장 타입에 없음 | `path.projection_is_derived` |
| 4 | 권한은 범위를 가진다 | `Agreement.content.scope`, `Grant.scope` 필수. write·send 도구 호출에 `agreementRef` 필수(R-05). effect class 필드 없음(결정 2) | R-04, R-05 |
| 5 | 완료 주장, 결과 확인, 전체 반영은 다르다 | `rs`, `ac`, `ig` 세 레코드. WorkUnit 상태 submitted / accepted / integrated. Acceptance의 `decidedBy`는 `human` 리터럴 | R-17, R-19, R-22, R-34 |
| 6 | 모르는 것, 이견, 낡은 상태는 숨기지 않는다 | `OpenQuestion`, `Quality.contestedBy`, `Quality.stale`, 해소되지 않은 반대 근거 링크, `limitations`·`remainingUncertainty` 필드. 삭제 이벤트 없음 | 투영의 주의 항목(09 `p_attention`) |
| 7 | 혼자 정한 결정도 기록되며 이의를 걸 수 있다 | 결정 레코드 여섯 종류에 `Autonomy` 필수. autonomous면 `whyNotAsked` 필수(스키마 변형). `ContestableId`에 결정 레코드 전부 포함. `contestable: false`를 표현할 방법이 없음 | R-15, R-16 |

#### 3.24.2 의존 규칙 (결정 15)

| 규칙 | 표시 | 대응 |
|---|---|---|
| (1) write·send에는 작업 합의(C) | [결정] | R-05 (`toolcall.started`의 `agreementRef`) |
| (2) "완료"에는 결과 확인(A) | [결정] | R-34 (`concern.completed`), WorkUnit `integrated`는 `acceptance.recorded` 뒤에만 |
| (3) 판단 승격에는 I의 근거 | [결정] | R-13 (`promotionMissing`) |
| (4) 하위 Concern 재조합 후 닫힘 | [제안] | R-33, R-34 |
| (5) Goal 변경 시 사람 확인 | [제안] | R-35 |

#### 3.24.3 원전 불변조건과의 대응

F05 전역 불변 I1~I12 (helm-canon §11.12):

| 원전 | 대응 |
|---|---|
| I1 Active WorkUnit has valid DelegationContract | WorkUnit `delegated`·`in_progress`는 `agreementId`의 합의가 `active`일 때만 (쓰기 없는 탐구 WorkUnit은 합의 없음. 결정 15(1)이 write·send에만 합의를 요구하므로 원전보다 좁다) |
| I2 Contract authority ⊆ requester's authority | 요청자는 사람 하나다. Grant 포함 검사(§3.11.2) |
| I3 ClaimingComplete has evidence for every required criterion | R-17 (기준 전부 덮음, 근거 없으면 unverified로 표시) |
| I4 Accepted has an authorized acceptor | R-19 (human) |
| I5 Integrated has a verified integration target | R-22 (반영 항목 처리) |
| I6 Committed Decision has alternatives, rationale, reopen trigger | Choice 스키마(대안 1개 이상, rationale) + 품질 qualified 조건(reviewTrigger) |
| I7 ContextProjection references a reproducible source state | 런타임 이벤트 `run.context_projected`의 `sourceSeq`(09) |
| I8 Superseding entity links to the entity it replaces | `supersedes` 필드와 `record.superseded` |
| I9 Material mutation links to an authorized WorkUnit or emergency policy | R-05 (비상 Grant 포함) |
| I10 Normative baseline changes invalidate affected projections | 낡음 전파(§3.21.3) + 투영 무효화(09·12) |
| I11 Evidence invalidation re-evaluates dependent Claims and Decisions | 낡음 전파 |
| I12 Closed WorkUnit has no unresolved obligations hidden beneath it | R-22, Concern 강제 종료 시 남은 항목 기록 |

F01 존재론 불변 1~8: 1 → R-02, 2 → Choice 스키마, 3 → 종류별 스키마(Claim이 종류를 밝힘 = `kind`), 4 → R-06과 관찰 품질, 5 → Agreement의 performer·criteria 필수, 6 → `ResultSubmission.materialChanges`와 관찰을 의도(`intent`)와 분리, 7 → 09 투영 메타, 8 → ID가 경로·세션과 무관(§3.2).

F10 profile 불변 6: "Authority는 scope와 effect class를 가진다"는 v0.3 불변조건 4로 바뀌었다(effect class 제외). 나머지 다섯은 v0.3 불변 1·2·3·5·6과 같다. Quick/Guided/Assured와 다이얼의 관계는 14가 정한다.

### 3.25 원전 어휘와의 대응

원론(foundations) 개념 → 이 문서의 레코드. 브리프 §6과 helm-canon-3 §1.3을 따랐다. Product Domain 이름(P06)은 화면 문구와 용어집(25)이 쓰는 이름이다.

| 원론 개념 | 이 문서 | Product Domain (P06) | 비고 |
|---|---|---|---|
| Purpose | Goal, Agreement `purpose` | Goal | 프로젝트 수준이면 Goal, 위임 수준이면 합의의 목적 |
| Concern | Concern | Focus | |
| SituationModel | 투영 + SituationAssessment | CurrentPicture | 엔티티로 저장하지 않음 |
| ProblemFrame | Possibility(`perspective`), Inquiry `perspectives` | ProblemView | |
| Hypothesis | Interpretation / Possibility | Possibility | |
| Claim | Interpretation·Possibility(후보), Finding(수락) | Finding | "판단"은 Finding만 |
| Evidence, EvidenceLink | Observation + `EvidenceLink` | Evidence | 독립 엔티티 아님 |
| Counterevidence | `challenges`·`invalidates` 링크 | ChallengingEvidence | |
| Assumption | Assumption | Assumption | |
| Uncertainty, Question | OpenQuestion | OpenQuestion | 사람에게 묻는 질문은 Question |
| Decision | Choice | Choice | |
| DecisionGate | Question | ChoiceRequest | 기록과 전달 분리 |
| AcceptanceCriterion | Criterion | ResultCondition | |
| Commitment, DelegationContract | Agreement | WorkAgreement, Promise | |
| AuthorityEnvelope | Agreement `scope`, Grant | AllowedRange | effect class 없음 |
| EscalationTrigger | Agreement `stopConditions` | HelpTrigger | |
| ReopenTrigger | `reviewTrigger` (Trigger) | ReviewTrigger | |
| WorkUnit | WorkUnit | Work | |
| CompletionClaim | ResultSubmission | ResultSubmission | |
| Acceptance / Assurance | Acceptance (+ Attestation) | ResultReview | |
| Integration | Integration + Obligation | WholeUpdate | |
| Reflection | Reflection, PolicyProposal | LearningReview | |
| Outcome | `ResultSubmission.materialChanges` + 관찰 | Result | M은 참조만 |
| Artifact, ExecutionTrace | MaterialRef, Run, ToolCall | WorkOutput, RunRecord | |
| Event (LedgerEvent) | 이벤트 (09) | ChangeRecord | |
| ContextProjection | `run.context_projected` 메타 + 투영 | ContextView | 정본 아님, 레코드 아님 |
| ReturnBrief, COP, InquiryMap | 투영 (12, 03~05) | Brief, Overview, ExploreView | |
| HumanActor / AgentActor / ToolActor | `human` / `agent:<role>` / `runtime` + ToolCall | Person / Agent / Tool | |
| CollectiveActor | 없음 | Team | 결정 24 |
| Surprise, WeakSignal, near miss | Observation `annotations` | UnexpectedChange, EarlyWarning | |
| Handoff | Run 재개(같은 runId의 새 attempt, `run.started`), WorkUnit 대체 | Handoff | 1인 앱 |
| Conflict | Obligation(`concern_conflict`), 이의 | Conflict | `ConflictDetected` 이벤트는 두지 않음 (§7 U-09) |
| Experiment, discriminating experiment | DiscriminatingCheck, Probe | - | |
| Request | Agreement `proposed` | - | |
| Exception | WorkUnit `scope_exceeded`, `agreement.violation_detected` | OutsideRange | |

## 4. 실패·예외·경계 사례

| ID | 상황 | 처리 | 근거 |
|---|---|---|---|
| E-01 | 같은 ID가 두 번 생성됨 (팩토리 오류, 테스트 고정 시계) | 저장 단계에서 유일 제약 위반 → 트랜잭션 롤백, `conflict.id_exists`. 팩토리는 같은 ms 안에서 난수부를 1 증가시켜 단조성을 지킨다 | §3.2 |
| E-02 | Goal이 정해지지 않은 프로젝트에서 Concern을 열려 함 | 프로젝트를 만들 때 자리표시 Goal(`placeholder: true`, 화면 이름은 01 FX-13)이 함께 생기므로 Concern은 그 아래 열린다(거부하지 않는다). 01·14와 같다. 자리표시 Goal 아래 Concern이 있으면 Goal 초안 카드(04 SCR-GOAL)를 주의 항목으로 보인다. Goal id가 아예 틀린 경우만 `invalid.goal_link`(10 코드) | R-01 |
| E-03 | 관찰을 참조하지 않은 해석 제안 | 거부하지 않고 전제(`as`)로 기록, 결과 코드 `downgraded.assumption`. 모델에게 강등 사실을 돌려준다 | R-07 |
| E-04 | 존재하지 않는 관찰 id를 근거로 제출 (지어낸 근거) | `invalid.evidence_not_found` 거부. 거부도 `command.rejected`로 기록 | R-09, R-17, helm-toy 4·17 |
| E-05 | 결과 제출의 근거가 모델이 쓴 문장뿐 | 해당 기준을 `unverified`로 강등(`downgraded: true`). 제출 자체는 받는다 | X3-2-11 |
| E-06 | 모든 후보가 같은 결과를 예측하는 구분 확인 | `invalid.check_not_discriminating` 거부 | R-12 |
| E-07 | 구분 확인 결과가 어느 예측에도 없음 | 기록하고 관찰에 `surprise` 주석. 어느 후보도 consistent가 아니므로 승격에 쓰이지 않음. 새 가능성 제안의 계기(14·15) | §3.9.4 |
| E-08 | 관찰을 본 뒤에 구분 확인을 선언함 | `posthoc: true`로 기록. 승격 조건에 세지 않음 | §3.9.4 |
| E-09 | 확인된 판단에 새 반대 근거가 링크됨 | 판단 contested, Concern 다시 열림, 그 판단을 근거로 한 선택은 주의 항목. 판단을 자동으로 철회하지 않는다 | §3.22.11, 대화 L2234 |
| E-10 | 사람이 `ㅇ`, `ㅁㄴㅇ` 같은 입력으로 선택을 기록 | 받는다. 품질 `structural`(다시 볼 조건·근거 부족 시)이므로 활성 기준선으로 투영되지 않고 주의 항목에 보인다. 문자열 휴리스틱으로 거부하지 않는다 | helm-canon-2 §1.10, C6 |
| E-11 | 권리 게이트 질문이 답 없이 오래 남음 | assumed로 가지 않음. 대상 행동만 막고 나머지 일은 계속. 복귀 요약 "선택 필요" 맨 위 | §3.22.7 |
| E-12 | 가정 확정 뒤 다른 답이 늦게 옴 | 질문 answered, 가정 확정 선택 contested, Concern 다시 열림. 이미 가정으로 진행한 작업의 되돌리기는 `rollbackPoint`를 근거로 11·14가 정함 | §3.22.7 |
| E-13 | 이미 철회·만료된 질문에 답이 옴 | `conflict.invalid_transition`. 답 내용은 `command.rejected` payload에 남는다. 앱은 "이 질문은 더 이상 필요하지 않습니다"를 보인다(05) | R-24 |
| E-14 | 사람이 본 뒤 바뀐 질문·합의에 답함 (예: 렌더링 뒤 합의 개정) | `conflict.version_mismatch` + 현재 레코드를 돌려줌. 옛 버전에 대한 확정은 기록되지 않는다 | helm-canon-2 L14 |
| E-15 | 결과 제출 뒤 사람이 합의 기준을 바꿈 | 결과 stale, WorkUnit in_progress. 옛 기준으로 낸 결과로는 확인할 수 없다 | helm-kernel-v02 F5 [실험] |
| E-16 | 진행 중에 Goal이 개정됨 | 이전 버전에 기댄 합의·선택에 stale 표시, Concern마다 `goal_revision_check` 반영 항목. 진행 중인 WorkUnit을 자동으로 멈추지는 않는다 [제안]. 멈출지는 미결 U-16 | §3.22.1 |
| E-17 | 재시작 뒤 이전 실행의 도구 결과가 늦게 도착 | `path.stale_epoch` 거부. 그 도구 호출은 부팅 복구에서 이미 interrupted로 정리됨 | R-43, 09 §3.8.3 |
| E-18 | 같은 도구 결과가 두 번 들어옴 | 도구 호출당 결과 관찰 하나. 두 번째는 멱등 재생(09 §3.9) | R-06 |
| E-19 | 같은 외부 id가 다른 내용으로 다시 들어옴 | `conflict.external_observation_changed`. 내용이 바뀐 사실은 사람 주의 항목 | helm-kernel-v02 [실험] |
| E-20 | 판단의 근거 파일이 바뀜 | 근거 관찰 stale → 판단·선택으로 낡음 전파 → 주의 항목. 다시 확인해 같은 결과면 `record.revalidated` | §3.21.3, A13 |
| E-21 | 분해가 하위 개수·깊이 상한을 넘음 | 기록하지 않고 사람 질문(needs_gate). 사람이 허락하면 상한을 넘는 분해를 기록 | R-32 |
| E-22 | 경계 항목을 확인하지 않고 재조합 | `policy.boundary_unchecked` 거부 | R-33 |
| E-23 | 열린 이의가 있는데 Concern 완료 시도 | `policy.open_objections` 거부 | R-34 |
| E-24 | 진행 중 WorkUnit이 있는 Concern을 병합 | WorkUnit을 대상 Concern으로 대체하거나 취소한다. 어느 쪽인지는 S 루프 결정의 내용이며 14가 정한다 | §3.22.2 |
| E-25 | WorkUnit 없는 실행 (라우터, 중재자, 관찰 에이전트) | `workUnitId`·`concernId`가 null인 실행을 허용. 이 실행들은 write·send를 하지 않는다(능력표) | §3.18 |
| E-26 | 관찰 에이전트가 기각된 제안을 다시 냄 | 기각 뒤의 새 근거가 없으면 `policy.duplicate_proposal` 거부 | R-40 |
| E-27 | 기기가 폐기된 뒤 그 기기에서 명령이 옴 | `denied.device_revoked` (자격). 18 | R-45 |
| E-28 | 클라이언트가 보낸 시각이 서버와 다름 | 사람 명령의 `occurredAt`은 데몬 수신 시각. 클라이언트 시각은 payload의 참고 값으로만 | §3.3.1 |
| E-29 | 텍스트가 길이 상한을 넘음 | 앞부분만 필드에 두고 원문은 blob (`textOverflow`) | §3.4.1 |
| E-30 | 원함 탐구에서 "A와 B 중 고르세요" 질문 | `policy.want_inquiry_pick_question` 거부 | R-23, 결정 18 |
| E-31 | 작업 에이전트가 결과 확인을 보냄 | `denied.capability` (자격). 기록 남음 | 능력표, helm-toy 19 |
| E-32 | 결과를 만든 실행 계열의 검증 에이전트가 증언 | `denied.producer_cannot_attest` (자격, P) | R-18 |
| E-33 | 다른 Concern의 선택을 대체하려 함 | `invalid.cross_concern_supersede` | R-15 |
| E-34 | 확인 날짜·방법이 없는 예측 | `invalid.prediction_uncheckable` | R-27 |
| E-35 | 기한이 이미 지난 기대 | `invalid.due_in_past` | R-26 |
| E-36 | 반영이 끝난 뒤 미뤄 둔 반영 항목의 조건이 충족됨 | 항목 open으로 돌아감, WorkUnit은 integrated 유지, Concern 주의 항목 [제안] | §3.22.6 |
| E-37 | 서로를 대상으로 하는 병합 (A→B, B→A) | 두 번째 병합의 대상이 merged 상태이므로 `conflict.invalid_transition` | §3.22.2 |
| E-38 | 순환을 만드는 `depends_on` 링크 | 종류 순서 위반으로 거부 (`invalid.dependency_order`) | §3.21.3 |
| E-39 | 근거 관찰의 품질이 captured (출처 확인 불가 가져오기) | 링크는 허용, 승격 조건에서는 `evidence.unqualified` | §3.9.5 |
| E-40 | 모델이 낸 계획 초안이 계획 검사를 두 번 어김 | 첫 위반은 사유와 함께 모델에 한 번 돌려준다. 두 번째 위반이면 코드 계산 계획을 `authoredBy = code`로 채택하고 그 사실을 거부 기록으로 남긴다 | R-29, [판정 J-188] (4) |

## 5. 다른 문서와의 인터페이스

### 5.1 이 문서가 제공하는 것

| 받는 문서 | 제공하는 것 |
|---|---|
| 09 | 레코드 `*Core` 스키마(이벤트 payload의 본체), 레코드 종류 표(§3.20.1), 링크 생성 규칙(§3.20.3), 품질·상태 전이 표(투영기 구현 기준), ID·행위자·Via·시간 타입 |
| 10 | 쓰기 시점 제약 R-01~R-56와 가드 id, 상태 기계 데이터, 능력표(A), `promotionMissing()`, `Autonomy`·`WhyNotAsked` 검증 대상, 거부 갈래 타입, 낡음 전파 규칙 |
| 11 | Question(`blocks`, `dedupeKey`, `approval`, `plannedDelivery`)·Choice·Assumption·Objection·RollbackPoint 스키마, 질문 상태 기계, `Trigger` 타입(가정 만료점), 권리·정보 게이트의 스키마 변형, `decisionKind`·`decisionPointKey` |
| 12 | Run·ToolCall·Thread 스키마와 상태 기계, `ownerEpoch`, `ToolCallExecution`, 관찰 출처 타입, `BlobRef`, Expectation·Prediction의 타이머 필드, 접두사 `th`·`mr`·`cp`·`cs`·`ms`·`ri`·`tm` |
| 13 | `Primitive`, `PermissionVerdict`, `Scope`·`ResourceScope`(net·mcp·helm_draft, `allowUnknownTargets`), `ToolCallExecution`(targets, targetsDigest, enforcement, replayGuard, sandbox.unit), `agreement.violation_detected` |
| 14 | `LoopId`, `SituationType`, `SituationQuestionId`, LoopPlan(`planDetail`)·LoopTransition(`ruleId`, `exitOutcome`)·SituationAssessment·ModeAssignment(`ModeId` 8개)·StructureChange·BoundaryItem 스키마, `TransitionTrigger`, `DialKey`·`DialSetting`, `planAuthoring` 다이얼 정의, `PlanFlags`·`Flag`, `DeclaredTrigger`, `EntrySignal`, Probe, Watch, Procedure |
| 15 | Inquiry·DivergenceCell·Perspective·Stimulus·ReactionPayload·PreferenceModel·Lens·DiscriminatingCheck 스키마, Possibility의 `possibilityKind`·`origin` |
| 16 | PolicyProposal·Procedure 스키마, Observation 주석(반복 정정, 아차 사고), 지표 계산에 쓸 필드(질문의 `matchesAssumption`, Autonomy, 이의 상태) |
| 18 | Device·PairingCode 스키마(`tokenHash`, `codeHash`), `Via`(`listener`, `connectionId`), 사람 인증 판단에 쓰는 필드 |
| 19 | 레코드 스키마(프로토콜이 투영 결과를 실어 보냄). 시각은 ms 정수이며 ISO 변환은 19 |
| 03·04·05·21 | 표시 상태(`ConcernDisplayStatus`, `QualityDisplay`, `SupportTrend`), 레코드별 표시 필드, 원전 어휘 대응(§3.25) |
| 25 | 용어 대응표(§3.25), 레코드 이름과 한국어 이름 |

### 5.2 다른 문서에 요구하는 것

정렬(§10)을 거친 뒤 남은 요구다.

| 문서 | 요구 |
|---|---|
| 01·02 | 1판 이벤트 이름(`choice.decided`, `submission.gated`, `decision.contested` 등)을 09 카탈로그 이름으로 바꾼다. 대응은 §10.3 |
| 09 | §3.20.1의 생성 이벤트와 §3.22의 이벤트 이름을 카탈로그에 그대로 둔다. 투영기는 §3.20.3 링크 생성 규칙을 따른다 (같은 P5가 작성). (1) `inquiry.stopped` payload에 `then`, `loop_plan.adopted` payload에 `authoredBy`를 싣는다([판정 J-157], [판정 J-188]). (2) `toolcall.denied`의 `reason`은 `human`·`edited_by_human`만 쓴다. 승인 대기 만료는 `toolcall.not_executed`(approval_expired)다(§3.22.14). (3) 운영 테이블 `device_presence`에 `last_auth_at` 열을 더한다(§3.19.1, [판정 J-159]) |
| 10 | (0) 예측 확인 결과 `undeterminable`을 08 이름 `indeterminate`로 바꾼다. (1) R-01~R-56를 명령 검증에 구현한다. (2) `ProposalKind`와 명령 이름 대응표. (3) 버전 검사(V-VER-01)를 커널에서 하고 저장소는 하지 않는다는 09 §3.8.4 결정을 따른다. (4) `concern.reframe` 명령은 같은 트랜잭션에 `choice.committed`(다시 세운 문제의 선택)를 만든다(§3.22.2). autonomy를 이벤트에 따로 붙이지 않는다. (5) `KernelContext.presence`는 영속 이벤트 `presence.changed`에서 만든 투영으로 읽는다(재현 가능) |
| 11 | (0) `WhyNotAsked`의 `delegated`·`rule_default`를 `delegated_by_human`·`rule`로, Objection `desired`를 `desiredEffect`로 바꾼다. (1) 질문 종류를 §3.13 `QuestionKind`로 옮긴다(대응은 §10.2). (2) 임시 가정은 `as`(origin question)를 쓰고 `wa` 레코드를 두지 않는다. (3) 이의는 `ct` Objection(대상: 레코드 또는 링크, `desiredEffect`)으로, 재작업은 WorkUnit `reworkOf`로, 승인 토큰은 `Question.approval`로 옮긴다. (4) assumed 뒤 늦은 답은 3008로 거부하고 이의로 보낸다([판정 J-120], §3.22.7). 11 §3.6.4의 늦은 답 처리를 지운다. (5) 가정 확정 Choice는 만료 때 만든다(R-25). (6) `WhyNotAsked` 이름 대응: information_gate_false→`info_gate`, policy→`within_grant` 또는 `rule`, auto_verified→`auto_verifiable`, structural_default→`rule` |
| 12 | (1) 부팅 복구에서 Run·ToolCall 상태 기계(§3.22.13~14)를 따른다. (2) 커널 이벤트 이름은 `toolcall.started`(의도), `toolcall.outcome_uncertain`, `toolcall.not_executed`를 쓴다. (3) 컨텍스트 투영 id 접두사를 `cx`에서 `cp`로 바꾼다(`cx`는 18·19의 연결 id). (4) 사람 메시지를 `utterance` 관찰로 같은 트랜잭션에 기록한다. (5) 도구 출력을 관찰로 남기기 전에 비밀을 가린다 |
| 13 | (1) 도구마다 `primitive`(없으면 null), `replay`(safe·never), `cancellation` 선언. (2) 권한 레이어 판정을 `PermissionVerdict`(rightsCategories, reversibility 포함)로 넘김. (3) `ToolCallExecution`의 `targets`, `targetsKnown`, `enforcement`, `replayGuard`, `snapshotRef`를 채운다. (4) `ResourceScope` 덮임 판정 함수(net·mcp·helm_draft 포함) |
| 14 | (1) `DialKey`별 값 스키마와 기본값, 구조 상한 기본값(이 문서 [제안] 7·3). (2) `TransitionTrigger`와 규칙 id(T01~T32, EXIT, OPEN, REDIRECT)의 대응표. (3) 오케스트레이터의 규칙 결정은 `kernel` 행위자(`declaredBy` 없음) 또는 `runtime` + `declaredBy`로 보낸다. (4) Concern 종료 상태로 `completed`·`merged`·`closed`를 모두 다룬다. (5) Goal 개정 시 진행 중 WorkUnit을 멈출지(U-16) |
| 15 | (0) 승격 판정은 08 `promotionMissing`(J-18)을 그대로 쓴다. (1) 구분 확인 결과 라벨을 누가 분류하는가(U-14). (2) `Perspective.transfer`, `Lens.field`, `structureTags`의 값 목록을 데이터 파일로 둔다. (3) 가능성 반응을 `subjectRef = ps_`로 보낸다 |
| 16 | (1) PolicyProposal 서명(`signature`) 계산 규칙과 `draft` blob 모양. (2) 절차 레코드 사용 기록(`procedure_failed` 주석). (3) 계획 이의 비율을 `LoopPlanCore.authoredBy`별로 잰다([판정 J-188] (7)) |
| 17 | 없음 (09에서 요구) |
| 18 | (1) `local_cli` 사람 인정 조건(유닉스 소켓 권한과 uid). (2) Device·PairingCode 필드는 §3.19.1이 18 §3.7~3.8을 옮긴 것이다. 바뀌면 08을 함께 고친다 |
| 19 | (1) 레코드 스키마를 프로토콜 타입으로 다시 정의하지 않고 `@helm/domain`에서 가져다 쓴다. (2) 거부 갈래 이름 `qualification`을 `authority`로 바꾼다. (3) `contest.filed`는 `objection.filed`다. (4) presence 값은 09 `PresenceState` |
| 21 | 거부 갈래 이름 `eligibility`를 `authority`로 바꾼다 |
| 25 | §3.25를 용어집에 옮기고 한국어 UI 이름을 확정한다 (Concern의 UI 이름 포함) |
| 01·02·16·22 | `HumanOpMeta.followedRecommendation`(J-76)과 자유 문장 `extraReason`으로 맞추고, 정상 경로는 이벤트 종류로 계산한다. 02 UC-05 E1(대체된 결정에 이의)은 3009 거부로, UC-13 단계 2의 측정 Trigger 자동 판정은 2단계로([판정 J-138]) |
| 03·04·05 | 질문 상태 `delegated` 라벨 "에이전트에게 맡김"(J-114), Grant "맡겨 둔 권한"·"비상 합의"(J-116). 이의 화면에 `reasonKind` 선택 칩. 04 `StimulusRoundView.form`은 `Stimulus.form`에서 읽는다. 04 질문 카드의 criteria·consequences·commitmentPreview는 Question 필드에서 읽는다. 03·04·05는 모델이 설계한 계획에 `authoredBy`로 그 사실을 표시한다([판정 J-188] (6)) |
| 10 | `toolcall.skip`의 core 동반과 started·replaying → not_executed 가드(J-104), 결과 확인 명령 값 대응(J-35), `concernId` 도출 규칙(§3.10.2), 반영 범위 합의(J-126)·`obligationPolicy`, `agreement.activated_by_choice`(R-56), Goal retired 뒤 `policy.goal_not_active`(J-130), V-PRO-02 독립성 키에 파생 관찰 규칙, 탐침·관찰 판정 값은 08 값, F05 I6 재검토 조건은 "선택 항목, 없으면 structural"(08 §3.10.1)로, observedChanges는 ChangeSet, R-43·R-05의 검사 run은 `via.runId`(E-17), WorkUnit 종결 → 대기 run abort(react), 재작업 WorkUnit의 합의 승계 규칙(§3.7, [판정 J-158]). 모델 계획 초안의 검사 규칙과 거부 코드, 두 번째 위반의 처리(§3.15, [판정 J-188] (4)). 승인 대기 만료는 `toolcall.not_executed`(approval_expired)로 쓴다(§3.22.14) |
| 11·12 | approve_edited 새 tcId 규칙과 `editedFrom`(J-121), 부팅 복구 J-122, run.ended handoff(`RunHandoff`), RunKind 6값(observer·router 제외, inquiry 포함), 되돌릴 지점 만료 규칙(§3.18.3) |
| 14 | ExitOutcome 값 22개를 08과 같게 유지, `ProposalKind`는 14에서 다른 이름으로(08 ProposalKind와 겹침), DialPrecedence(J-136), RunHandoff·EntryAssessmentDraft는 08 정의를 쓴다. `PlanFlags`(outOfPattern 포함)와 `loop_plan_draft`의 `steps`는 §3.15의 `PlanStep`·`PlanFlags`를 쓴다. 다이얼 `planAuthoring`은 14 §3.11.1 정의를 쓴다 |
| 15 | 탐구 멈춤 이유를 08 값으로 옮기는 대응표, `Stimulus.form`, 첫 자극 라운드 1, 라운드 키 inquiryId + round, 탐구 단계 trace 이름 `inquiry.step_started`·`completed`·`failed` |
| 16 | `objection.resolved`의 결과 분류(reversed·modified)는 desiredEffect와 뒤따른 이벤트(record.superseded, workunit 재작업)로 계산한다. 지표 DDL은 09 §3.7을 정본으로 참조 |
| 19 | 반응 comparison `neither`, triad 질문 `questionId`, 이의 noReason은 `reason = null`로, 반영 항목 params는 08 Trigger·reason 필수 |

## 6. 구현 단위와 완료 기준

패키지: `@helm/domain` (의존: `typebox` 1.x만. Node 내장 모듈과 파일·네트워크·시계·난수를 직접 쓰지 않는다. 시계와 ID 팩토리는 주입)

| 파일 | 내용 | 완료 기준 (테스트) |
|---|---|---|
| `src/ids.ts` | 접두사, `Id()`, `IdFactory` 인터페이스, `prefixOf`, `isId`, `normalizeId` | `ID_PREFIXES`의 접두사가 모두 다름. 잘못된 ULID(I·L·O·U 포함, 27자, 첫 글자 8) 거부. 고정 시계에서 팩토리가 1만 개를 만들 때 모두 다르고 사전순이 생성순과 같음 |
| `src/time.ts`, `src/actor.ts`, `src/capability.ts` | Ms, ActorRef, Via, Primitive, RecordCapability | 행위자 패턴: `agent:planner`, `external:`(빈 이름), `Human` 거부 |
| `src/capability-table.ts` | 능력표 A | 작업 에이전트에 accept·attest·integrate 없음. 검증 에이전트에 write·send·accept 없음. 사람에 ask 없음. 관찰 에이전트 proposeKinds가 세 종류뿐 |
| `src/schema.ts`, `src/quality.ts`, `src/autonomy.ts`, `src/triggers.ts`, `src/material.ts`, `src/link.ts` | 공통 타입 | autonomous인데 whyNotAsked 없는 값 거부. `info_gate`에 빈 falseConditions 거부. `qualityDisplay` 우선순위 표 테스트 |
| `src/records/*.ts` | §3.5~§3.19 레코드 (§3.20.1 표의 모든 종류) | 모든 스키마가 `Compile()`로 컴파일됨. 레코드 종류마다 유효 fixture 1개 이상과 무효 fixture 3개 이상(필수 필드 누락, 잘못된 접두사, 추가 필드). Question 세 변형의 교차 조합(권리+가정 있음, 비막힘+가정 없음) 거부. Choice 권리 게이트 + autonomous 거부 |
| `src/loop.ts` | LoopId, SituationType | v0.3 03 §2.1 표와 같은 18개 |
| `src/features.ts` | `FeatureKey`, `FEATURE_TABLE: Readonly<Record<FeatureKey, { stage: 1 \| 2 \| 3; default: boolean; note: string }>>` (값은 23 §3.5.4, 구조는 06 §3.10.3) | 2단계·3단계 키는 모두 기본 `false` |
| `src/dials.ts` | `SettingDef` 타입과 `DIAL_DEFS` 데이터. 항목은 `kind`가 `dial`·`structure`·`setting`인 것이고, 다이얼 키 하나에 항목 하나다. 값과 뜻은 14 §3.11·§3.13.2가 정하고 19가 읽는다. 의미 설정은 `DIAL_KEYS`에 들지 않는다 | 모든 `DIAL_KEYS`에 항목이 하나씩 있다. `planAuthoring`의 기본값은 `hybrid`이고 층은 `user`·`concern`뿐이다. `dial.set`의 키가 `DIAL_KEYS` 밖이면 거부 |
| `src/schema.ts`, `src/enums.ts` | 스키마 도우미(`Obj`, `Nullable`, `Enum`, `Merge`, `MergeEach`, `Opaque`)와 여러 파일이 쓰는 열거(ObligationKind, EntrySignal 등). 다른 domain 파일을 import하지 않는다 | 순환 import 검사(madge 등)에서 domain 안 순환 0. ESM 적재 때 TDZ 오류 없음 |
| `src/rules/promotion.ts` | `promotionMissing()` | helm-toy 시나리오(`experiments/helm-toy/helm.mjs`)를 이 타입으로 옮긴 fixture에서 거부 3·7·10에 해당하는 경우 각각 `evidence.support`, `counter.search`, `counter.unresolved:*`를 내고, C2 경로는 빈 배열. 사후 확인만 있을 때 `check.discriminating` |
| `src/rules/dependency-order.ts` | `canDependOn(fromKind, toKind)` | §3.21.3의 종류 순서. 역방향 거부 |
| `src/rules/constraints.ts` | R-01~R-56를 데이터로 (`{ id, event, guard, rejection }`) | 모든 R의 `event`가 09 카탈로그에 있음(교차 테스트). `guard` id가 10에 구현되었는지는 이 패키지의 완료 기준이 아니라 23 M3-08(커널)의 완료 기준이다 |
| `src/machines/*.ts` | §3.22 상태 기계 데이터 | (1) 모든 상태가 ∅에서 도달 가능. (2) 같은 (from, on) 쌍이 두 번 나오지 않음. (3) 종료 상태에서 나가는 전이는 표에 명시된 것(reopen 계열)뿐. (4) 모든 `on`과 `effects`가 09 카탈로그 이벤트 |
| `src/rejection.ts` | 거부 갈래 | 코드 접두사 → 갈래 매핑. 패턴 밖 코드는 예외 |
| `src/index.ts` | 공개 export | `@helm/domain`에서 `projection`이라는 이름의 이벤트·명령 타입을 내보내지 않음(정적 검사) |

공통 완료 기준:

1. `tsc --strict` 통과, `@helm/domain`이 `node:` 모듈을 import하지 않음(의존 검사 규칙은 06이 정한다).
2. 모든 레코드 스키마에 대해 `Static<typeof X>` 타입이 내보내진다.
3. 스키마 검증 성능: 컴파일된 검사기로 관찰 1만 개 검증이 200ms 이하 [가정: WSL2, Ryzen 5 6650H].
4. `just verify`의 domain 단계가 위 테스트를 모두 실행한다(레시피 이름은 06·23).

## 7. 미결 사항

| ID | 질문 | 선택지 | 추천 기본값 |
|---|---|---|---|
| U-01 | Goal의 작은 문구 정제까지 사람 확인이 필요한가 (v0.3 03 §5 끝의 우려) | (a) 모든 개정 사람 확인 (b) 성공 조건·보존 제약이 안 바뀌는 문구 수정은 혼자 정한 결정으로 | (a). 의존 규칙 5가 [제안]이므로 실제 사용 뒤 (b)를 검토 |
| U-02 | 선택의 근거 범위 (D08-8) | (a) 판단·가능성만 (대화 원안) (b) E 레코드 전반 | 닫음: (b)이고 해석·전제만 근거면 `structural`([판정 J-145], A08-7) |
| U-03 | 반응을 관찰의 한 종류로 둘지 | (a) 관찰 종류 (b) 별도 레코드 `rx` | (a) |
| U-04 | Concern을 열 때 Goal이 반드시 있어야 하는가 | (a) 필수 (b) 초안 상태에서 Goal 없이 허용 | (a). 프로젝트를 만들 때 기본 Goal을 함께 만든다(05·02) |
| U-05 | 반영 항목을 커널이 닫는 범위 | (a) 관찰로 확인되는 항목만 (b) 사람만 | (a) |
| U-06 | 혼자 정한 결정을 기록 즉시 accepted로 볼지 | (a) 즉시 (b) 이의 없이 일정 시간이 지나면 | (a) |
| U-07 | send 사전 허락 대상(`sendTargets`) | (a) 허락 목록 허용 (b) send는 항상 호출마다 승인 | 닫음: (b). MVP 커널은 `sendTargets`를 읽지 않는다. 사전 허락 목록은 2단계에서 검토한다([판정 J-91]) |
| U-08 | 기대 기본 기한 | 24h / 72h / 다이얼 | 72h를 다이얼 기본값으로 (11 확정) |
| U-09 | 의미 충돌(`ConflictDetected`, F05 §13)을 따로 레코드로 둘지 | (a) 반영 항목 `concern_conflict`와 이의로 표현 (b) Conflict 레코드 | (a). 1인 앱에서 동시 다중 에이전트 충돌이 드물다. 다중 WorkUnit 병렬이 늘면 다시 본다 |
| U-10 | 타입 이름을 Product Domain 이름(Focus, WorkAgreement)으로 할지 | (a) 브리프 이름 (b) P06 이름 | (a). ADR 후보 A08-5 |
| U-11 | 신뢰도 숫자 | (a) 질적 등급만 (b) 내부 정렬용 숫자 허용 | (a). 정렬이 필요하면 15가 계산값으로 쓰고 저장하지 않음 |
| U-12 | 하위 Concern 상한 | 하위 7개·깊이 3 / 다른 값 | 7·3을 다이얼 기본값으로 (14 확정) |
| U-13 | 판단 진술이 원 주장보다 범위를 넓혔는지 검사 | (a) 검사하지 않음(scope 필드만) (b) 검증 에이전트 확인 | (a). 의미 검사는 커널이 할 수 없다. 확인 질문에서 사람이 본다 |
| U-14 | 구분 확인 결과 라벨 분류자 | (a) 작업 에이전트 (b) 검증 에이전트 (c) 다이얼 | 15 확정: 다이얼 `assurance.independent_verification`(MVP 기본 off). off = 작업 쪽, auto = 1위 후보의 구분 확인만 검증 에이전트, always = 전부 |
| U-15 | Quick/Guided/Assured 이름 유지 | v0.3 07 §1 | 이 문서는 다루지 않는다. 다이얼 `assurance.proof_burden`으로만 둔다. 14 확정 |
| U-16 | Goal 개정 시 진행 중 WorkUnit 처리 | (a) 표시만 (b) 자동 일시 정지 | (a). 14 확정 |
| U-17 | 범위 밖 호출의 거부 갈래 | (a) 자격 `gate.scope_expansion_required` (10) (b) 내용 `policy.scope_exceeded` (1판) | (a). 금지 자원만 내용 갈래 |
| U-18 | 권리 질문이 막지 않을 수 있는가 | (a) `blocks = nothing` 허용, 가정은 금지 (11) (b) 항상 막음 | (a) |
| U-19 | send 승인을 별도 레코드로 둘지 | (a) `Question.approval` 블록 (b) ApprovalToken 레코드 `ap` (11) | (a). 접두사 `ap`만 둔다 |
| U-20 | 이의 대상 단위 | (a) 레코드·링크 (b) 이벤트 id (11) | (a). 이벤트는 레코드 변경의 기록이고, 화면과 영향 계산은 레코드를 본다 |
| U-21 | Run의 stage를 레코드에 둘지 | (a) trace에만 (b) 레코드 필드 | (a). 도메인 상태와 운영 정보를 섞지 않는다 |

## 8. 출처

- 브리프: `docs/design/process/00-design-brief.md` §2 결정 2·4·5·6·7·8·9·11·12·13·14·15·17·18·24·29·30·36·53, §3.2·§3.3·§3.5·§6
- 판정: `docs/design/process/rulings-stage2a.md` §7~§9 가운데 이 문서를 고칠 문서로 든 항목(J-120·121·122·124·125·126·133·136·138·145, J-156~J-158·J-180, J-188)
- v0.3: `docs/v0.3/00-README.md` §2.4(불변조건 1~7), `02-core-concepts.md` §1~§9, `03-loops-and-transitions.md` §2.1·§3·§4·§5·§6·§7·§8, `04-inquiry-types.md` §1~§9, `05-situation-types.md` §3·§4·§6, `06-asking-and-interruption.md` §3·§4·§5·§7, `07-modes-and-capabilities.md` §2·§3·§6·§7, `08-runtime-architecture.md` §2·§4·§5·§7·§10, `09-client-opdc.md` §4·§5·§6
- 원전 정리: `sources/helm-canon.md` §7(존재론), §8(인식론), §9.3·§9.5·§9.8·§9.10, §11(형식 상태 모델), §13, §16, §17.7, §20, §21(08 체크리스트)
- `sources/helm-canon-2.md` §1.7~§1.14, §1.27, §4.1, §5.2, §9.1~§9.5, §9.14~§9.15, §10, §11(08 체크리스트)
- `sources/helm-canon-3.md` §1.3, §5.1.5, §5.2.5, §7.1~§7.3, §8(08 체크리스트)
- 대화 발췌: `sources/conversation-extracts-3.md` X3-2-07~X3-2-20, X3-3-03~X3-3-10, X3-8-07~X3-8-18, X3-9-25~X3-9-30, X3-10-03~X3-10-10, §11.4 Q1·Q2·Q14·Q19·Q20; `conversation-extracts-4.md` 0-1~0-6, 1-3~1-18, 2-1~2-4, 5-10~5-13, 8-3~8-5, 9-3~9-16, 10-3·10-5, 11-4, 21(d) d5·d9·d16·d18·d19·d20; `conversation-extracts-2.md` X2-6-14, 9.d d-10·d-12
- 실행 후보 코드 [원문]: `experiments/helm-kernel-v02/contracts/*.json`, `src/kernel.mjs`(transition, 포함 검사), `src/sqlite-kernel.mjs`, `src/migration.mjs`; `experiments/helm-toy/helm.mjs`(helm-canon-3 X3-10-05 경유)
- 감사·조사: `docs/v0.3/audit/audit-report.md` §2·§3.4~§3.6·§3.10·§5; `mastra-review.md` §4·§5·§9 (suspend/resume 스키마, 승인-인자 지문, 절대 시각 타이머)
- pi [원문]: `~/projects/_ref/pi-src/packages/ai/src/index.ts:1-2`(typebox 재수출), `packages/durable/docs/spec.md:1917-1933`(effect sandwich), `:3869-3927`(pi.tool task), `packages/durable/src/harness/types.ts:289-290`(replay 기본 unsafe) — pi-api-facts-1 §7.3 경유. typebox 1.3.27의 `Type.Object`·`Type.Union`·`Type.Unsafe`·`Compile` 동작은 `experiments/pi-lab/node_modules/typebox`로 [실험] 확인

## 10. 다른 문서와의 정렬 기록

1판을 쓴 뒤 01~07, 10~21, 24를 읽고 맞춘 결과다. 다른 문서가 이 문서보다 먼저 쓰여 이름이 다른 경우가 많았다. 이 절은 무엇을 받아들였고 무엇을 받아들이지 않았는지를 남긴다. 받아들이지 않은 항목은 §5.2에 요구로 옮겼다.

### 10.1 받아들인 것

| 출처 문서 | 받아들인 내용 | 반영 위치 |
|---|---|---|
| 12 | 접두사 `th`, `mr`, `cs`, `ms`, `ri`, `tm`(단 컨텍스트 투영은 `cp`). Run 상태 7개와 종료 이유 9개, `attempt`, `ownerEpoch`(ULID 문자열), `recoveryAttempts`, `threadId`. ToolCall의 `modelArgs`·`executedArgs` 분리, `toolcall.not_executed`, 읽기 빠른 경로. `workspaceRoot` | §3.2, §3.7, §3.18, §3.22.13~14 |
| 13 | `ResourceScope`의 net·mcp·helm_draft, `targets`·`targetsKnown`·`enforcement`·`replayGuard`·`snapshotRef`, replay `never` | §3.11.1, §3.18.2 |
| 14 | 진입 신호 이름, `LoopPlan.planDetail`·`planVersion`, `LoopTransition.ruleId`·`exitOutcome`·`planDeviation`·`restart`, 상황 판정 질문 id 9개와 `parts`·`previousType`·`computedBy`, 모드 8개, 질문 종류 9개, Watch(`wt`), Procedure(`pd`), `Reflection.nextAgreementChange`, `WhyNotAsked.rule`, 가벼운 작업 Concern, WorkUnit `loop`·`purpose`, 커널 행위자의 규칙 결정 | §3.5~§3.7, §3.13, §3.15, §3.16.2, §3.19.3, §3.3.4 |
| 15 | Inquiry `workUnitIds`·관점 행 필드·`planHash`·라운드 0·`concern_closed`, Possibility 확장과 상태 dismissed·merged·`pinned`, Stimulus `altText`·`facets`·`controlledFor`, Reaction `subjectRef`·`near`·`cannotSay`, PreferenceModel `scope`·`inheritedFrom`·`shownToUserSeq`, Lens 필드, Prediction `impact`, 관찰 `derived`·`retracted` | §3.8, §3.9.3, §3.14.2, §3.17 |
| 16 | PolicyProposal 종류 13개·상태 9개·`family`·`detector`·`patch`·`draft`, 효과 판정 `harmful`, Procedure 신뢰 `trial`·`trusted`·`demoted`, `Project.observeExternalSessions` | §3.5.1, §3.19.2~3 |
| 18 | Device·PairingCode 필드, 민감 필드(`tokenHash`, `codeHash`) 표시, Via의 `listener`·`connectionId` | §3.3.2, §3.19.1 |
| 19·20·06 | `RecordMeta.revisionSeq`(사람에게 의미 있는 변경만 올림)와 `RevisionRef`, 질문 미룸·위임·다시 세우기, Objection의 결과 제출 대상·링크 대상·`desiredEffect`, `BlobRef.blobId`, 업로드 `up` | §3.4, §3.10.2, §3.13 |
| 10 | 범위 밖 = 자격 갈래(`gate.scope_expansion_required`), `AutonomousDecision.decisionKind`·`decisionPointKey`, `Agreement.checkBack`·`narrowedScope`, `Scope.allowUnknownTargets`, `WorkUnit.reworkOf`, PauseReason `grant_revoked`, 검증 에이전트의 질문 제안, `runtime` + `declaredBy`, 이의 자동 철회(G-K6), `decision.confirmed` | §3.4.5, §3.11.1, §3.7, §3.22.12, §3.23 |
| 11 | RollbackPoint(`rb`), 질문 `blocks`·`dedupeKey`·`deadline`·`rollbackPointIds`·`blockedAction`·`approval`·`seenAt`, 전달 계획의 Autonomy, 권리 질문 마감 만료, `rightsCategories`·`reversibility`, 반영 항목 `post_review` | §3.13, §3.18.3, §3.18.2, §3.12 |
| 01 | 합의 활성화 경로 `choice_scope`, `direct_instruction` (R-OP-2) | §3.11.1 |

### 10.2 받아들이지 않은 것과 대응

| 출처 | 제안 | 이 문서의 처리 | 이유 |
|---|---|---|---|
| 11 | 임시 가정 레코드 `wa` | `as`(origin question) | 같은 사실(근거 없이 둔 전제)을 두 레코드로 나누면 낡음 전파가 두 갈래가 된다. 10도 `as`를 쓴다 |
| 11 | ApprovalToken `ap` 레코드 | `Question.approval` 블록, 접두사 `ap`만 | 승인은 질문의 답에서만 생기고 질문과 수명을 같이한다 |
| 11 | Contest의 이벤트 id 대상, 상태 rework_* | Objection(레코드·링크 대상), 재작업은 WorkUnit `reworkOf` | U-20 |
| 11 | Rework `rw` 레코드 | WorkUnit `reworkOf` | 10 23:45 판이 이미 같은 결정 |
| 11 | 질문 상태 `scheduled` | `pending` + `plannedDelivery` | 상태 수를 늘리지 않고 계산한다 |
| 11 | assumed 뒤 늦은 답 거부 | 거부(3008)하고 이의로 보냄 | [판정 J-120]으로 11 쪽을 따랐다. 사람이 쓴 답은 이의 초안으로 넘어가 기록이 사라지지 않는다 |
| 11 | 혼자 정한 결정의 상태(recorded, confirmed, contested 등) | `quality`(contestedBy, supersededBy)와 `confirmedSeq`에서 계산 | 상태 필드를 따로 두면 품질과 어긋날 수 있다 |
| 11 | `*.review_flagged`, `policy.adjustment_suggested` | 낡음 플래그(`record.staled`), 커널의 정책 조정 제안은 trace | 커널은 제안 레코드를 만들지 않는다. 정책 제안은 관찰 에이전트의 일이다(R-40) |
| 11 | Agreement 상태 blocked·in_progress·suspended·cancelled·stopped | 진행 상태는 WorkUnit에 둔다(`paused`, `cancelled` 등). 합의는 범위의 기록이다 | 합의와 일의 상태를 한곳에 섞지 않는다 |
| 12 | Run `stage`를 레코드에 | trace `run.stage` | U-21 |
| 10 | `concern.reframed`에 autonomy | 같은 트랜잭션의 `choice.committed` | 문제 다시 세우기는 선택이다. 선택 레코드가 이의·낡음 규칙을 이미 가진다 |

11의 질문 종류 이름 대응: decision_point→`choice`, scope_expansion→`scope_change`, action_approval→`send_approval`, commitment_acceptance→`agreement_confirm`, result_acceptance→`result_review`, goal_*_confirm→`goal_revision`, entry_confirm→`entry_suggestion`, stop_next→`stop_condition`, structure_cap→`structure_limit`, semantic_conflict·scope_violation·recovery·prediction_check·kernel_error는 같은 이름.

### 10.3 1판 이벤트 이름 대응 (01·02·10·11에서 쓰인 것)

| 1판 이름 | 09 이름 |
|---|---|
| `question.raised` | `question.recorded` |
| `submission.rejected`, `submission.gated` | `command.rejected`(status rejected·needs_gate) + 게이트면 `question.recorded` |
| `choice.decided` | `choice.committed` |
| `working_assumption.created` | `assumption.recorded` (origin question) |
| `decision.contested`, `contest.resolved` | `objection.filed`, `objection.resolved` |
| `situation.acknowledged` | `brief.acknowledged` |
| `toolcall.intended`, `toolcall.dropped`, `toolcall.outcome_unknown` | `toolcall.started`, `toolcall.not_executed`, `toolcall.outcome_uncertain` |
| `agreement.accepted` (Grant) | `agreement.activated_by_grant` |
| `loop_plan.set`, `mode.routed`, `probe.resolved`, `concern.split` | `loop_plan.adopted`, `mode.assigned`, `probe.concluded`, `structure.changed`(split) |
| `integration.obligation_transferred`, `integration.obligation_added` | `obligation.transferred`, `obligation.added` |
| `run.completed`, `run.failed`, `run.cancelled`, `run.recovered` | `run.ended`(reason), 재개는 `run.started`(attempt) |
| `boundary.recorded` (경계 항목) | `boundary_item.recorded` (`boundary.reached`는 런타임 경계 도달) |

### 10.4 2a단계 통합 (조정자 판정 rulings-stage2a 반영)

| 출처 | 반영 |
|---|---|
| J-08 | `Project.observeExternalSessions`: 세션 cwd가 rootPaths 아래인 세션, 로그는 런타임별 홈 폴더, Mac에서 연 세션은 대상 밖 |
| J-18 | `promotionMissing`에 `evidence.correlated`(출처 독립성). 승격 규칙 정본은 10 §3.9 |
| J-19 | 숫자 confidence 없음. 15 `SupportGrade`는 계산값으로만 둔다 |
| 19 | 접두사 `ik`, `RecordMeta.revision` |
| 18·결정 42 | Device `platform`에 ios·android·web, `clientKind` mobile, `publicKey`, `push`(형식은 26) |
| 04·11 | Question `depth` |
| 02 | RollbackPoint `agreementId`. 관찰 종류 대응: human_utterance → `utterance`, resumption_probe → 측정 `resumption_check.*`(09), brief_feedback → `brief.corrected`(09) |
| 01·16 | `HumanOpMeta`(사람 결정 이벤트 payload의 선택 필드), `followedRecommendation`(J-76), 주석 `procedure_failed`, `Procedure.uses` 제거(지표에서 계산), `patch.target` 4종 |
| 21 | 자극 내용은 바뀌지 않는다(§3.17.3) |
| 10 (J-35) | 결과 확인 값 대응: 명령 값(10) accept → 기록 값 `accepted`, accept_with_conditions → `conditional`, request_changes → `revision_requested`, reject → `rejected`, criteria_wrong → `criteria_wrong` |
| 10 (J-95) | DiscriminatingCheck `pinned` |
| 15 | `RunKind` inquiry(J-97), `Possibility.consequenceMarks`, `planHash` 뜻(멈춤 판정 입력), U-14 확정 |
| 11 | Question `askEvaluation`(구조)·`whyLocalInsufficient`(정보 게이트 필수)·`rightsCategories`(권리 게이트 1개 이상, 10개 값)·`assumptionAnswer`(정보·비막힘), `WorkBoundaryKind` 7개, `goal_achievement`(J-55), `reworkOf.steps`(J-54), 권리 마감은 사람이 정한 경우만(J-49), Trigger `boundary` 변형과 `before_primitive.resources`, `send_approval`은 11의 action_approval을 포함, 고친 인자의 새 도구 호출이 승인을 소진할 수 있음. 11의 `delegated`·`rule_default`는 08 이름 `delegated_by_human`·`rule`, Objection `desired`는 `desiredEffect`를 쓴다(11이 고친다) |
| 13 | `ResourcePattern` 타입 |

## 부록 A. 원천 체크리스트 반영표

### A.1 `helm-canon.md` §21 "08"

| 항목 | 반영 |
|---|---|
| 엔티티 총목록과 제품 이름, F01 핵심 엔터티 16, v0.2 새 개념 | §3.25 대응표, §3.5~§3.19 |
| 세계·평면 소속, 세 세계 관계 4 | §3.1.1 (관계 5개, E reveals N 포함) |
| 필수 속성: Concern 6필드 | Concern: id, title, description(why_it_matters), owner = 사람 고정(결정 24라 필드 없음), status, related_purposes = `goalId` |
| DelegationContract 필드 | §3.11.1 끝 대응 |
| Decision 보존 13 | §3.10.1 대응 (reversibility는 결정 2로 제외) |
| Claim 평가 7 | Finding: scope, confidenceBasis, invalidationTriggers, reviewTrigger. support_level·unresolved_counterevidence는 근거 링크에서 계산. valid_from = `createdSeq`·`promotionBasis.atSeq` |
| Evidence 품질 8차원과 관계 4 | §3.9.1 |
| ContextProjection 메타데이터 | 레코드가 아니다. 09 `run.context_projected` payload로 |
| 관계 13 + 관계 메타 + supersedes/invalidates/reopens/derived_from | §3.4.8 `LinkRel`, `Link` (invalidates는 근거 관계와 시간 관계에 함께 쓴다) |
| 상태 기계 7개와 문서 간 불일치 | §2.3 판본 선택, §3.22 |
| 의미 품질 상태 8 | §3.4.3 (absent는 투영 전용) |
| 행위자 4종과 능력, 브리프 #4 대응 | §3.3 (CollectiveActor 없음, 결정 24) |
| 판단 = Finding만 | §2.3, §3.9 |
| Product Domain 이름 사용 여부, foundationRef | A08-5, §3.25 |

### A.2 `helm-canon-2.md` §11 "08"

| 항목 | 반영 |
|---|---|
| 후보 어휘 41개와 실행 후보 13개의 차이, `legacy.choice.capture`·`authority.grant`·`agreement.activate` | 명령 이름은 10 소유. 이벤트 대응은 09 부록 A. `authority.grant` → `grant.issued`, `agreement.activate` → `agreement.activated_by_grant`, legacy capture → 09 §3.13.4(선택 기능) |
| 품질 상태 세 개와 값, Choice 외 확장 | A08-3으로 대체(단계 + 플래그), §3.21.2에서 레코드별 확장 |
| qualificationBasis 다섯 필드 | Choice: sourceRefs = `basis`, scope = Concern·`goal`, evidenceRelation = 근거 레코드의 링크, accountableAcceptor = `autonomy.decidedBy`, reviewTrigger = `reviewTrigger` |
| Authority Grant·requestedAuthority·Work Agreement·Completion·Integration 필드 | §3.11.1, §3.11.2(effect class 제외), §3.12 |
| Claim 스키마 + 구분 확인 | §3.9 |
| 거부 세 갈래와 결과 코드 대응 | §3.23 |
| 쓰기 시점 참조 제약 후보 | §3.20.2 (R-09, R-17, R-22, R-15) |
| 정본 semantic trace 후보, `goal.link`, `obligation.transfer` | 09 부록 B 예시 흐름. `goal.link` → Concern의 `goalId`와 `structure.changed(relocate)`, `obligation.transfer` → `obligation.transferred` |
| 이벤트 이름 접두사 규칙 (normative./epistemic.) | 09 §3.3에서 다룬다. 평면 접두사 대신 카탈로그의 `plane` 열 |
| Delegation Contract 상태 8, Inquiry phase 6, Hypothesis status 6, Gate reason 7, Acceptance 4값 | Agreement 상태(§3.22.4), Inquiry phase는 저장하지 않음(§3.17.1), Possibility 상태(§3.9.3, strengthened·weakened는 계산), Question reasons(irreversible 제외, §3.13), Acceptance 결정 5값(criteria_wrong 추가, §3.12) |
| 행위자 identity (자유 문자열은 인증 신원 아님), actor.kind, observer.kind | §3.3.2 규칙 1, `Via` |

### A.3 `helm-canon-3.md` §8 "08"

| 항목 | 반영 |
|---|---|
| §1.3 용어 대응표를 레코드 이름 결정에 사용 | §3.25 |
| 작업 합의의 why·end state·보존할 가치·non-goal·이탈 허용 기준·owner·delegate·acceptor·checkpoint | `purpose`(why + end state), `preserve`, `nonGoals`, `checkpoint`, `performer`. owner·acceptor는 사람 고정. 이탈 허용 기준은 `stopConditions`로 표현 |
| 작업 합의 상태 기계의 요청·반대 제안·재협상·위반·철회 | §3.22.4 대응 문단 |
| 근거 관계 종류와 provenance·scope·freshness·독립성·diagnosticity | §3.9.1 (diagnosticity는 구분 확인 레코드) |
| Surprise를 관찰 하위 종류로 | 주석(`annotations.annKind = surprise`)으로 (§3.8.1) |
| near miss, 반복 correction | 주석 `near_miss`, `repeated_correction` |
| snapshot과 handoff 구분 | 1인 앱에서 handoff는 실행 재개와 WorkUnit 대체로 표현(§3.25). 별도 레코드 없음 |
| 선택·판단의 review_trigger와 무효화 전파, Goal 버전 기록 | `reviewTrigger`, §3.21.3 낡음 전파, `GoalRef` |
| `confidence` 필드 처리 | D08-10 (숫자 없음) |
| 결과 확인의 생성자·확인자 독립성 필드 | `Acceptance.independence` |

### A.4 대화 발췌의 열린 질문 중 08 담당

| 항목 | 반영 |
|---|---|
| X3 Q1 C/A 상태 기계의 빠진 전이 | §3.22.3 끝 |
| X3 Q2 반영 항목의 명시적 미루기 | `Obligation.deferral`, §3.22.6 |
| X3 Q14 품질 상태 전이표 | §3.21 |
| X3 Q15 Concern 계층 상태 기계 vs 루프 조합 | Concern 생애 상태와 루프 위치(`currentLoop`)를 분리. 루프는 의존 규칙만 강제(결정 5) |
| X3 Q19 구분 확인 기록 방식 | §3.9.4 |
| X3 Q20 거부 분류 체계 | §3.23 |
| X4 d5 질문 상태 기계 전이 조건, 가정 만료점 표현 | §3.22.7, `Trigger` |
| X4 d9 integrate 소유자 | §3.3.4 (사람, 관찰로 확인되는 항목은 커널) |
| X4 d16 S 루프 상한·경계 항목 스키마·연산 정의 | §3.6.2, §3.6.3, U-12 |
| X4 d18 예측 확인 타이머와 결과 기록 | §3.14.2, 타이머는 09 `p_timers` |
| X4 d19 기대 기한 기본값, 응답 없음 관찰의 행위자 | 72h [제안] (U-08), 행위자 `scheduler` |
| X4 d20 결과 작성자 추적 | `ResultSubmission.producerRunIds`, `Run.rootRunId` |
| X2 d-10 A를 참여자로 볼지 능력으로 볼지 | A = 참여자의 능력표(고정). §3.1.1 |
| X2 d-12 외부 응답·사람 직접 관찰의 출처 | `ObservationSource`의 human·external 변형 |
