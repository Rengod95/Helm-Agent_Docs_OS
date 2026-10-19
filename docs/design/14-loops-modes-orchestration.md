# 14. 루프·모드·오케스트레이션

- 작성: 2026-10-11, P8 오케스트레이션
- 상태: 설계 초안(2026-10-14 갱신). 기준: 브리프 결정 1~64, 판정 `process/rulings-stage2a.md` J-01~J-351. 다른 문서 대조는 §3.20
- 소유: P8. 이 문서는 오케스트레이션 모듈(순수 코어 `@helm/kernel/orchestration`, 효과 부분 `@helm/runtime/orchestration`, §3.20.6)을 만드는 데 필요한 내용을 정한다.
- 기준: `docs/design/process/00-design-brief.md`(이하 "브리프"). 브리프와 다른 자료가 충돌하면 브리프를 따른다.
- 표시(브리프 §5.2, [판정 J-144]): `[결정 n]`은 사용자가 정한 브리프 결정 번호가 근거인 것, `[제안: 결정 n 기본값]`은 조정자 기본값(결정 26~32·34·36·37), `[판정 n]`(결정 44~46)·`[판정 J-nn]`은 조정자 판정, `[제안]`은 이 문서가 정한 것, `[가정]`은 확인되지 않은 전제다. 외부 사실은 `[원문]` `[실험]` `[검색]` `[지식]`으로 확인 수준을 적는다.
- 출처 표기: "v0.3 03 §6"은 `docs/v0.3/03-loops-and-transitions.md` §6, "대화 L2160"은 `docs/handoff/conversation-transcript-until-158.md` 2160행, "X3-2-19"는 `docs/design/process/sources/conversation-extracts-3.md`의 항목 ID, "canon §15.3"은 `sources/helm-canon.md` §15.3이다.

---

## 1. 목적과 범위

### 1.1 이 문서가 정하는 것

Helm의 루프(O, I, C, A, S와 그 변형)가 데몬 안에서 실제로 어떻게 돌아가는지를 정한다. 구체적으로는 다음이다.

1. 루프와 변형(루프 식별자 18개)마다 입력, 출력, 진입·종료 조건, 핵심 질문, 쓰는 능력, 만드는 레코드
2. 루프 계약을 데이터로 두는 스키마(TypeScript)와 전체 카탈로그
3. 10단계 계약, 루프의 세 크기, 루프 × 평면
4. 루프 전환 규칙, 재진입 가드, 의존 규칙(1~5)이 전환에 미치는 영향(오케스트레이션 측 동작)
5. 루프 계획 레코드의 생성·수정 알고리즘
6. 상황 판정(Cynefin 다섯 유형)의 계산 방법, 유형별 기본 조합, 유형이 바뀔 때의 처리
7. 모드(루프 계획 기본값 + 능력 부분집합 + 다이얼 값)의 목록과 정의 데이터, 라우팅
8. 다이얼 정본 목록(열여섯 항목, `planAuthoring`·`assumptionDeferOnDowntime` 포함)의 값 범위·기본값·설정 층 해석, Quick/Guided/Assured와의 관계
9. OICA = 흐름, NEMAP = 상태, OPD+C = 평가가 변경 경로의 어디에 걸리는지
10. 성숙도 L1~L5와 기능 단계
11. 거시 스케줄러: 여러 Concern의 우선순위, 동시 실행 수, 사람에게 가는 요청량(주의 예산), 작업 경계
12. C/A 우선과 사람 조작 2회 상한의 오케스트레이션 측 집행
13. 범주 한정과 진입 경로 세 가지(시작, 작업 중 제안, 직접 지정), 진입 조건의 런타임 동작
14. 오케스트레이터 알고리즘(한 Concern이 열려서 닫히기까지)과 크래시 후 재개
15. 클라이언트 없이 진행할 때의 규칙

### 1.2 다루지 않는 것

| 주제 | 소유 문서 |
|---|---|
| 레코드·엔티티의 최종 스키마, ID, 레코드별 상태 기계(Agreement, Outcome 등) | `08-domain-model.md` |
| 이벤트 envelope, 최종 이벤트 이름 카탈로그, 투영 테이블 | `09-event-store.md` |
| 단일 변경 경로, 명령 카탈로그, 의존 규칙의 집행(거부), 능력 행렬, 거부 분류 | `10-kernel.md` |
| 질문 레코드, 권리·정보 게이트 판정, 전달 방식 결정, 중재자, 가정 만료, 혼자 정한 결정의 기록 형식과 이의 흐름 | `11-asking-and-autonomy.md` |
| 에이전트 루프 실행, 모델 계층, 투영(컨텍스트) 생성, 타이머, 예산 집행, 크래시 복구의 실행 기록 | `12-runtime-engine.md` |
| 도구 모음, 제안 도구(`helm_*`), 범위 검사, 하위 호출, 런타임 어댑터 | `13-tools-and-execution.md` |
| 탐구 네 종류의 내부 절차, 발산 서브시스템, 멈춤 규칙 계산, 선호 모델 | `15-inquiry-engine.md` |
| 관찰 에이전트, 지표 정의와 반증 측정 | `16-observer-and-metrics.md` |
| 프로토콜 메서드, 클라이언트 접속 상태 신호 | `19-client-protocol.md` |
| 화면과 문구 | `03`~`05`, `21` |

이 문서는 위 문서들이 제공하는 기능을 "언제, 어떤 순서로, 어떤 조건에서" 부르는지를 정한다. 필요한 기능이 아직 정의되지 않았으면 §5.2에 요구로 적는다.

### 1.3 이 문서를 읽고 만드는 것

구현자는 이 문서로 순수 코어 `packages/kernel/src/orchestration/`와 효과 부분 `packages/runtime/src/orchestration/` 아래의 다음을 만든다(§6에 파일 단위 목록, 위치는 [판정 J-128]).

- 루프 계약·모드·다이얼의 데이터 파일과 TypeBox 스키마
- 순수 함수: 상황 판정 결정표, 루프 계획기, 전환 규칙 평가, 재진입 가드, 다이얼 해석, 진입 판정, 우선순위 계산
- `decide(view, event, ctx) → actions` 형태의 Concern 오케스트레이터(순수)와 그 실행기
- 거시 스케줄러(여러 Concern의 작업 요청 큐, 동시 실행 제한, 주의 예산, 작업 경계 이벤트)

---

## 2. 전제와 결정

### 2.1 브리프의 결정 중 이 문서가 기대는 것

| 번호 | 내용 | 이 문서에서의 쓰임 |
|---|---|---|
| 결정 3 | 모드는 페르소나가 아니다. 루프 계획 기본값, 능력 부분집합, 다이얼 값의 설정이다 | §3.10 모드 정의 데이터 |
| 결정 4 | 능력 = 원시 행동(read, write, execute, send, spawn, ask) + 기록 능력(observe, propose, attest, accept, integrate) | 루프 계약·모드의 능력 부분집합 |
| 결정 5 | 루프(O, I, C, A, S)는 한 작업 안에서 필요에 따라 조합하고 언제든 전환한다. 커널이 강제하는 것은 의존 규칙뿐이다 | §3.9 전환. 루프별 제약 중 의존 규칙이 아닌 것은 오케스트레이션 측(도구 노출)에서만 다룬다 |
| 결정 6 | 상황 유형(Cynefin 다섯 유형)은 바뀔 수 있는 상태다 | §3.7 재판정 |
| 결정 7 | 탐구는 네 종류(사실, 원함, 가능성, 결과) | I.fact, I.want, I.possibility, I.outcome |
| 결정 8 | 혼자 정한 결정을 기록하고 나중에 확인·이의를 걸 수 있다(불변조건 7) | 루프 계획, 전환, 상황 판정, 분해·병합, 모드 라우팅을 모두 이의 가능한 기록으로 남긴다 |
| 결정 9 | 외부 응답은 탐구 중 발견된 관찰로 다룬다 | 외부 대기는 별도 루프가 없다. 기대 기한 초과 전환(T16) |
| 결정 11 | Goal은 Concern 사이클로 정제된다. Concern은 10단계 과정을 돌릴 후보가 되는 상황 그 자체다 | Concern 하나 = 오케스트레이션 단위 |
| 결정 12 | 묻기 재설계(기록과 전달 분리, 두 게이트, 네 전달 방식, 가정 만료점). 다이얼 수치는 [제안] | 질문 다이얼의 범위·기본값은 [제안]. 전달 판정은 11이 한다 |
| 결정 14 | 모델은 제안하고 커널이 상태를 바꾼다. "모델이 구조화된 값을 선언할 수 있으면 결정은 코드가 한다" | 상황 판정, 진입 판정, 전환 판단을 모델 선언 + 코드 계산으로 만든다. 루프 계획도 표시 선언 + 코드 계산이 기본이고, 표시 밖 상황의 모델 초안만 결정 53의 예외다(§3.8.5) |
| 결정 15 | 의존 규칙 (1) write·send에는 C 필요 (2) "완료"에는 A 필요 (3) 판단 승격에는 I 근거 필요 [결정]. (4) 하위 Concern 재조합 후 닫힘 (5) Goal 변경 시 사람 확인 [제안] | §3.9.4 오케스트레이션 측 동작. 집행은 10 |
| 결정 16 | 질문 조건은 AND 기본 + 조건별 문턱 다이얼 [제안]. AND/OR 선택 옵션은 사용 후 결정 | 다이얼 `question.threshold.c1~c3` |
| 결정 17 | 불변조건 1~7은 어떤 모드·다이얼에서도 바뀌지 않는다 | 다이얼 해석기의 검증 규칙(§3.11.6) |
| 결정 18 | 대안 2~3개를 던지고 고르게 하는 상호작용은 거부. 원함 탐구는 반응을 받고 기록. "모델이 초안, 사람은 반응·수정" | 사람 접점은 모델이 초안을 만든 확인·반응으로만 설계한다 |
| 결정 22 | 진행 중인 작업은 클라이언트가 없어도 계속된다. 데몬이 상주한다 | §3.17 |
| 결정 29, 30 [제안: 결정 29·30 기본값] | 기준 원본은 Helm 이벤트 로그(SQLite). 실행 의도 → 실행 → 결과 순으로 기록하고 재시작 시 중단된 호출을 정리 | 오케스트레이터는 별도 상태 저장소를 두지 않는다. 상태는 로그의 투영이다(§3.16.5) |
| 결정 36, 44 [제안: 결정 36 기본값], [판정 44] | TypeScript strict, ESM, Vitest, TypeBox. 런타임은 Node 24 LTS, TypeScript 6.0(결정 44가 36을 대체) | 계약 데이터 스키마는 TypeBox |
| 결정 42, 47, 48 | 휴대폰에서 질문에 답한다. 모바일은 데몬이 서빙하는 PWA이고 알림은 Web Push다. 휴대폰 알림은 `interrupt`와 `notice` 강도까지 보낸다 | 부재 판정(§3.13.8)이 휴대폰 기기를 입력으로 받고, 주의 예산 규칙(§3.13.5)이 푸시 강도를 결정 48대로 둔다 |
| 결정 51 | 구현 작업의 에이전트는 3단계로 둔다 | §6 구현 단위는 23의 WBS가 등급·담당을 붙인다. 이 문서는 모듈 경계만 정한다. 모델 구성은 결정 58(개정)이 정한다 |
| 결정 55 | MVP 도구에 웹 읽기·검색(`web_fetch`, `web_search`)을 넣는다([판정 J-190]) | 근거 범위 다이얼 `inquiry.evidence_range`의 `web` 값을 MVP에서 쓸 수 있다(§3.11.1). 도구 노출은 13 |
| 결정 53 | 루프 계획은 혼합 방식이다. 기본은 모델이 계획 표시(`PlanFlags`)를 선언하고 코드가 계획을 계산한다. 표시로 나타낼 수 없는 상황이면 모델이 계획 초안을 내고 커널이 검사한다(10 §3.8.1). 방식은 다이얼 `planAuthoring`으로 고른다 | §3.8, §3.8.5, §3.11.1, ADR-14-12 |
| 결정 56 | 결과 확인 대기의 휴대폰 알림은 설정으로 고른다(알리지 않음 / 하루 한 번 묶음 / 즉시). 기본은 알리지 않음이다 | §3.13.5 규칙 7, 설정 `notifications.resultReview`(§3.13.2) |
| 결정 59 | `notifications.dndException`은 휴대폰 푸시에만 적용한다. 방해 금지 중에는 데스크톱 OS 알림을 띄우지 않는다 | §3.13.2 기기 설정 주석, §3.13.5 규칙 7 |
| 결정 60 | 결과 확인 대기는 데스크톱에서 배지로만 알린다. 데스크톱 OS 알림은 `notifications.resultReview`가 `immediate`일 때만 띄운다 | §3.13.5 규칙 7 |
| 결정 64 | 만료 임박 승격만 J-132의 예외다. 막지 않는 권리 게이트도 만료가 임박하면 `interrupt`로 올린다. 그 밖의 막지 않는 권리 질문은 다음 작업 경계에 전달한다 | §3.13.5 규칙 1, §3.13.8, §3.17 |

### 2.2 이 문서의 주요 설계 선택 [제안]

| 번호 | 선택 | 근거 |
|---|---|---|
| D1 | **Concern마다 현재 루프는 하나다.** 루프 하나 안에서는 WorkUnit 여러 개를 동시에 돌릴 수 있다(탐침, 발산 가지). 서로 다른 루프를 동시에 돌려야 하면 S.split으로 나눈다 | 화면에서 "지금 하는 일"이 하나로 보여야 Predictability가 성립한다(v0.3 09 §4.2). 의존 규칙 검사와 전환 기록이 단순해진다 |
| D2 | **루프 활성화 id = 그 루프로 들어온 루프 전환 레코드의 id(`lt_…`).** WorkUnit은 이 id를 가진다 | 새 레코드 종류 없이 "어느 루프 구간에서 한 일인가"를 추적한다 |
| D3 | **오케스트레이터는 순수 함수 `decide`와 실행기로 나눈다.** 상태는 이벤트 로그의 투영(ConcernView)에서 다시 만든다. 오케스트레이터 전용 저장소를 두지 않는다 | 결정 29. 가짜 모델 재생 테스트에서 같은 입력이면 같은 행동이 나와야 한다(X3-8-26). 메모리에만 있는 런타임 상태는 재시작에서 사라진다(canon-2 L13) |
| D4 | **루프 계약·모드·다이얼 정의는 TypeScript 데이터 상수 + TypeBox 스키마로 둔다.** 조건(가드, 종료 조건)은 이름으로 참조하는 순수 함수 레지스트리에 둔다 | X3-8-25 "명세를 실행 가능한 데이터로". YAML 대신 TS를 쓰면 타입 검사와 이름 참조 검사를 컴파일 시점에 한다 |
| D5 | **도구 집합은 WorkUnit 경계에서만 바뀐다.** 한 WorkUnit은 한 루프 활성화에 속하고, 루프가 바뀌면 새 WorkUnit을 연다 | 루프마다 도구 목록을 바꾸면 프롬프트 캐시가 깨진다(감사 §4). "쓰면 안 되는 도구는 차단하지 않고 아예 주지 않는다"(감사 §3.5)를 지키면서 캐시 손실을 경계에 모은다 |
| D6 | **상황 판정은 모델이 판정 질문에 답(근거 id 포함)을 선언하고, 유형은 코드의 결정표가 계산한다** | 결정 14. 익숙한 유형으로 기우는 경향을 줄인다(v0.3 05 §3.2) |
| D7 | **모든 사람 접점(합의 확인, 결과 확인, 기준 확인, 범위 초과, 권리 허락, 반응 라운드)은 질문 레코드로 만든다.** 거시 스케줄러는 하나의 큐로 주의 예산을 계산한다 | 결정 12. 접점마다 다른 경로를 두면 주의 예산을 셀 수 없다 |
| D8 | **주의 예산과 동시 실행 설정은 사용자 단위 설정(`OrchestrationSettings`)에 둔다. 다이얼 목록에 넣지 않는다.** 계획 작성 방식 `planAuthoring`만 예외로 다이얼이다 | 다이얼 정본 목록(v0.3 07 §3, 14항목)에는 `planAuthoring`([결정 53], [판정 J-188])과 `assumptionDeferOnDowntime`([판정 J-197])을 더했다. 계획 방식은 Concern별로 고르는 값이라 층 4·5를 쓰는 다이얼이다. 주의 예산은 사람 한 명의 용량이라 Concern과 무관하다 |
| D9 | **Quick/Guided/Assured는 다이얼 `proofBurden`(08 `assurance.proof_burden`)의 값 light/standard/heavy로 흡수한다. 화면 이름은 "가볍게/보통/엄격"이고 v0.2 이름은 화면에 쓰지 않는다(01 OQ-12, 10 K-4).** 기본은 standard(= v0.2 Guided) | v0.2 D3(canon §16.12), v0.3 07 §1 [제안]. 자동 상향은 허용, 하향은 사람만(canon-2 §3.9) |
| D10 | **Helm 소유 저장 공간(자극·초안 아티팩트 저장소)에 만드는 것은 `propose`로 분류하고 원시 행동 write로 보지 않는다.** 작업 대상(사용자 프로젝트 파일, 외부 시스템)을 바꾸는 것만 write다 | 원함 탐구가 자극을 만들 때마다 작업 합의를 요구하면 사람 조작이 늘어난다. v0.3 07 §2.2의 write 정의("작업 대상의 상태를 바꿈")와 맞다 |

### 2.3 용어

| 용어 | 뜻 |
|---|---|
| 루프 | O, I, C, A, S. "루프 계열(LoopFamily)"이라고도 쓴다 |
| 루프 식별자 | v0.3 03 §2.1의 18개: `O`, `I.fact`, `I.want`, `I.possibility`, `I.outcome`, `C.commit`, `C.probe`, `C.emergency`, `A.confirm`, `A.watch`, `A.reflect`, `S.split`, `S.merge`, `S.detach`, `S.relocate`, `S.recombine`, `S.hold`, `S.close` |
| 루프 활성화 | 한 Concern이 한 루프 식별자로 들어와서 나갈 때까지의 구간. id는 진입 전환 레코드 id |
| 단계(step) | 10단계 사이클(Sense … Reflect)의 한 단계. 루프 계약 안에서 WorkUnit의 목적을 정하는 하위 단위 |
| 루프 계약 | 루프 식별자마다 정한 데이터: 입력, 출력, 진입·종료 조건, 능력, 제안 종류, 사람 접점, OPD+C 의무, 예산 기본값 |
| 루프 계획 | Concern에서 쓸 루프 조합의 계획 레코드(`lp_`). 권고일 뿐이며 벗어나는 전환이 허용된다 |
| 루프 전환 | 한 루프에서 다른 루프로 옮긴 기록(`lt_`) |
| 상황 판정 | Concern의 Cynefin 유형 판정 기록(`sa_`) |
| 작업 요청(WorkRequest) | 오케스트레이터가 거시 스케줄러에 넣는 "이 WorkUnit을 돌려 달라"는 요청. 스케줄러가 실행을 허가하면 12가 WorkUnit을 실행한다 |
| 작업 경계 | 예약 전달 질문을 내보내고 다이얼 변경을 반영하는 지점. §3.13.6 목록 |
| 사람 접점 | 사람의 입력을 요청하는 지점. 모두 질문 레코드로 만든다(D7) |
| 사람 조작 | 사람 접점 하나에 사람이 답하는 일 한 번 |
| 주의 예산 | 하루·시간 단위로 사람에게 요청해도 되는 사람 조작의 양(§3.13.5) |
| 혼자 정한 결정 | 사람에게 묻지 않고 정한 선택. 11이 기록 형식과 이의 흐름을 소유한다. 이 문서는 어떤 오케스트레이션 결정이 여기에 해당하는지 정한다 |
| 상시 합의 | 사람이 미리 맡겨 둔 권한(08 Grant). 절차용과 비상용이 있다. 화면 이름은 "맡겨 둔 권한", 비상용은 "비상 합의"([판정 J-116]) |
| 가벼운 작업 | Concern으로 열지 않은 요청. 루프·상황 판정·탐구 없이 압축된 C/A로 처리한다(01 §3.6.4, 이 문서 §3.14.2) |

---

## 3. 명세 본문

### 3.1 OICA, NEMAP, OPD+C의 역할과 변경 경로상 위치 [제안]

세 묶음은 같은 종류의 대상이 아니다(대화 L2543–2549, X3-7-03).

| 묶음 | 다루는 것 | 답하는 질문 | Helm 런타임에서의 형태 | 소유 문서 |
|---|---|---|---|---|
| OICA(+S) | 흐름 | 지금 무엇을 하고 있고 다음에 무엇을 하는가 | 루프 계약, 루프 계획, 전환 규칙, Concern 오케스트레이션 상태 기계 | 14 |
| NEMAP | 상태 | 무엇이 기록되고, 누가 어떤 조건에서 그것을 바꿀 수 있는가 | N/E/M 레코드와 품질 상태(08), A 능력 행렬과 P 정책(10) | 08, 10 |
| OPD+C | 평가 | 사람이 이 일을 따라가고 예상하고 바꾸고 이의를 걸 수 있는가 | 루프 계약의 `opdc` 의무, 투영(12), 화면(03~05), 지표(16) | 14(의무 정의), 12, 16 |

모든 상태 변경은 하나의 경로를 지난다(v0.3 08 §2, 경로 자체의 정의는 `10-kernel.md`). 세 묶음은 이 경로의 다른 지점에 걸린다.

```text
입력: 모델 제안 / 사람 명령 / 도구 결과 / 타이머 / 오케스트레이터 명령
  │
  ├─ 1. 형식 검사        ← NEMAP: 레코드 종류와 칸, 참조 id 실재, 쓰기 시점 참조 제약 (08, 10)
  ├─ 2. 권한 검사        ← NEMAP의 A·P: 능력 행렬, 합의 범위, 권한 레이어 판정 입력 (10, 13)
  ├─ 3. 이벤트 기록      (09)
  ├─ 4. 세계 모델 갱신   ← NEMAP: N/E/M 레코드, 품질 상태 (08)
  ├─ 5. 규칙 평가        ← OICA: 의존 규칙 1~5(커널, 10) / 전환 규칙·재진입 가드·종료 조건(오케스트레이터, 14)
  ├─ 6. 투영과 감시      ← OPD+C: 루프 계약의 opdc 의무를 만족하는 투영(12), 지표 이벤트(16)
  └─ 7. 다음 단계 구성   ← OICA: 다음 루프 활성화, WorkRequest(도구 집합, 컨텍스트 명세, 예산) (14 → 12)
```

규칙 평가(5)는 두 부분으로 나뉜다.

- 커널(10) 안: 의존 규칙 위반이면 거부한다. 순수하고 동기적이다.
- 오케스트레이터(14) 안: 커밋된 이벤트를 받아 전환·종료·다음 작업을 정한다. 결과는 다시 명령으로 커널에 들어간다. 즉 오케스트레이터는 경로의 바깥에서 커밋된 이벤트를 구독하는 행위자(`runtime` 또는 `scheduler`)이고, 그 판단도 같은 경로를 다시 지난다.

이렇게 나누는 이유: 결정 5에 따라 커널이 루프에 대해 강제하는 것은 의존 규칙뿐이다. "I.want에서는 합의 초안을 제안하지 않는다" 같은 루프별 제약은 커널 불변조건이 아니며, 오케스트레이터가 그 루프의 WorkUnit에 해당 제안 도구를 주지 않는 방식으로 다룬다(D5).

### 3.2 루프의 세 크기 [제안]

사용자 요구 "운영 루프 구조(세부 및 거시 버전 둘 다)"(대화 L2173)와 X3-3-07에 따라 루프를 세 크기로 나눈다.

| 크기 | 무엇 | 런타임 대응 | 상태를 가진 곳 | 수명(X3-3-05) |
|---|---|---|---|---|
| 세부 | 10단계(Sense … Reflect) | 루프 활성화 안의 WorkUnit 목적(purpose)과 그 WorkUnit의 도구 집합·제출물·검사 | WorkUnit 레코드의 `purpose`, `step` | 몇 분~몇 시간 |
| 중간 | O, I, C, A, S와 변형(루프 식별자 18개) | Concern 오케스트레이션 상태 기계의 현재 루프, 루프 전환 | 루프 전환 레코드, 루프 계획 | 며칠(Concern 수명) |
| 거시 | 여러 Concern 사이의 일 | 거시 스케줄러: 우선순위, 동시 실행, 주의 예산, 작업 경계, 다시 볼 조건 타이머 확인, 복귀 시 복귀 요약 생성 요청 | 스케줄러 투영(로그에서 계산), 사용자 설정 | 프로젝트 수명(Goal: 몇 주~몇 달) |

- 하위 호출(몇 초~몇 분)은 WorkUnit 안의 일이며 13이 정한다.
- v0.2의 "거시 루프"는 S 루프의 Goal 수준 실행과 주의 배분 스케줄러를 합친 것으로 본다(v0.3 03 §4.5). 이 문서에서는 S 루프(Concern 구조 변경)와 거시 스케줄러(주의·자원 배분)를 따로 둔다. S는 레코드를 바꾸는 루프이고 스케줄러는 레코드를 바꾸지 않는 배분기다.
- 10단계는 감사가 지적한 흐름 표기 네 가지(10단계, episode, 기본 리듬, 8단계) 중 기준 표기다(감사 §3.6). 나머지는 §3.3.3에서 10단계에 대응시킨다.

### 3.3 10단계 계약 [제안]

#### 3.3.1 단계와 루프의 대응

| 단계 | 정의(canon §6.1, F00 §2) | 루프 | WorkUnit 목적(purpose) |
|---|---|---|---|
| Sense | 현재 상황과 변화를 감지한다 | O | `assess`(Frame과 한 WorkUnit) |
| Frame | 무엇이 문제인지, 무엇을 보존해야 하는지 정의한다 | O (I에서 재정의할 때도 쓴다) | `assess`(상황 판정과 문제 정의를 한 WorkUnit에서) |
| Diverge | 가능한 설명과 해결 방향을 복수로 만든다 | I.* | `diverge` |
| Investigate | 가설을 병렬로 검증하고 반대 증거를 찾는다 | I.fact, I.possibility, I.outcome | `investigate` |
| (Elicit) | 자극을 보이고 반응을 받는다(원함 탐구의 Investigate) | I.want | `elicit` |
| Deliberate | 대안, 기준, 불확실성, 파급 효과를 비교한다 | I.* → C | `deliberate`(판단 승격 요청, 선택 후보, 합의 초안) |
| Commit | 선택을 책임 있는 결정과 위임으로 바꾼다 | C.commit, C.probe | `draft_agreement` |
| Execute | 권한 범위 안에서 현실을 변경한다 | C.commit, C.probe, C.emergency | `execute`, `probe`, `stabilize` |
| Assure | 결과에 대한 주장과 증거가 충분한지 검토한다 | A.confirm, A.watch | `submit`, `verify`, `watch_sample`(제안 종류 아님, §3.5.6) |
| Integrate | 지역적 결과를 전체 목적과 시스템에 정합시킨다 | A.confirm | `integrate` |
| Reflect | 경험을 다음 탐구와 통치 규칙에 반영한다 | A.reflect | `reflect` |
| (Structure) | Concern을 나누고 합치고 옮긴다 | S.* | `structure`, `recombine` |

v0.3 03 §3.1을 따라 Frame은 O에 둔다(O와 I의 경계). canon §6.2의 [정리]는 Frame을 I에 두지만, Helm v0.3은 상황 판정을 O의 일로 정했고(v0.3 05 §3.2-1) 상황 판정과 문제 정의는 같은 입력을 읽으므로 한 WorkUnit에서 한다. Elicit와 Structure는 원전 10단계에 없는 이름이며 v0.3의 원함 탐구와 S 루프를 위해 더한 WorkUnit 목적이다.

#### 3.3.2 단계별 계약

X3-3-08의 표를 v0.3·브리프에 맞춰 고쳤다. effect class 검사는 빼고(결정 2) "요청 권한이 합의 범위 안인가"는 커널·권한 레이어 검사로 둔다.

| 단계 | 쓸 수 있는 원시 행동 | 모델이 제출하는 것(제안 종류, §3.5.3) | 코드가 검사하는 것 | 검사하는 곳 |
|---|---|---|---|---|
| Sense | read | `frame_packet`(요약 문장마다 레코드 id 참조, §3.5.6) | 요약 문장이 레코드를 참조하는가(A11) | 12(투영 규칙), 10(형식) |
| Frame | read | `frame_packet`, `situation_answers`, `loop_plan_draft`, `split_hint` | Goal 연결(A1), 판정 답의 근거 id 실재 | 10, 14(결정표) |
| Diverge | read, spawn(fork) | `possibility`(여러 개), `divergence_cell` | 가능성마다 구분할 다음 확인이 있는가, 결과가 같은 가능성 병합(A4) | 15 |
| Investigate | read, execute, spawn | `interpretation`, `evidence_link`, `counter_check`, `prediction` | 근거가 관찰 id를 참조하는가(A5) | 10 |
| Elicit | read, spawn(fork), ask | `stimulus`, `reaction_interpretation`, `criterion_candidate` | 자극 수 ≤ 다이얼 `inquiry.stimulus_count`, 반응 관찰 출처가 사람인가 | 15, 10 |
| Deliberate | read | `promote_request`, `choice_candidate`, `agreement_draft`, `question` | 승격 규칙(근거·구분 확인·반대 근거 탐색), 질문 조건 | 10, 11 |
| Commit | read | `agreement_draft`(목적, 완료 기준, 범위, 금지 행동, 제출할 근거, 멈출 조건 + 의도 재진술) | 사람 확정 또는 상시 합의 포함 증명 | 10, 11 |
| Execute | read, write, execute, spawn, send(합의 + 권리 게이트) | 도구 호출, `autonomous_choice` | 요청 권한 ⊆ 합의 범위, 관찰 자동 생성 | 10, 13 |
| Assure | read, execute, spawn(fresh) | `result_submission`(기준별 충족/미충족/확인 못함 + 근거 id), 검증 에이전트의 `counter_evidence`·`attest` | 근거 id 실재. 실재하지 않으면 그 기준은 "확인 못함"으로 기록(거부와 강등 구분, 감사 §3.6) | 10 |
| Integrate | read, write(반영 범위), execute | `obligation_resolution`, `obligation_deferral` | 반영 항목을 모두 처리했거나 명시적으로 미뤘는가 | 10 |
| Reflect | read | `reflection`, `change_proposal` | 변경 제안이 하나 이상이거나 "변경 없음" 이유가 있는가(canon §15.15 법칙 12) | 14 |
| Structure | read | `structure_op`(분해·병합·독립·재배치·보류·닫기), `boundary_item` | 개수·깊이 상한, 상위·Goal 연결 유지 | 10, 14 |

웹·브라우저 읽기 도구(`web_fetch`, `web_search`, 브라우저 읽기)를 넣는 조건은 원시 행동 `read`다. 합의 부여가 없어도 `read`가 있으면 기본으로 넣는다. 외부 효과인 `send`는 합의와 권리 게이트를 그대로 거친다([판정 J-205], [결정 55]). 도구를 어느 루프에 내줄지는 13이 정한다.

#### 3.3.3 다른 흐름 표기와의 대응

| 10단계 | episode(F09 §6) | 기본 리듬(F09 §10) | 8단계(P02 §1) | Guided 리듬(canon-2 §3.6) |
|---|---|---|---|---|
| Sense | Concern opened, Situation oriented | Orient | 1 돌아오기 | Resume/Start |
| Frame | Problem framed | Frame together | 2 목표와 초점 정하기 | Frame draft |
| Diverge, Investigate | Hypotheses investigated | (Autonomous interval) | 3 문제 관점과 가능성 살펴보기 | Investigate autonomously |
| Deliberate | Decision committed | Meaningful checkpoint, Decide/redirect | 4 중요한 선택하기 | consequential Choice only when needed |
| Commit | Work delegated | Delegate | 5 작업과 맡긴 범위 합의하기 | Work Agreement echo |
| Execute | (실행) | Autonomous interval | 6 자율 진행과 필요한 방향 수정 | autonomous interval with semantic checkpoints |
| Assure | Outcome claimed, Result accepted | Accept | 7 결과와 근거 확인하기 | Completion Claim, Result Review |
| Integrate | System integrated | Integrate | 8 전체에 반영 | Whole Update |
| Reflect | Practice reflected | Reflect | 8 다음을 배우기 | (없음) |

"Meaningful checkpoint"와 "semantic checkpoints"는 이 문서의 작업 경계(§3.13.6)로 구현한다. 중요한 단계 경계에서만 공동 pause를 만든다는 법칙 9(canon §15.15)와 같은 뜻이다.

### 3.4 루프 × 평면 [제안]

X3-7-14의 표를 v0.3 능력 정의(결정 4)와 S 루프로 고쳤다. "쓰기"는 해당 칸의 레코드를 제안(propose)하거나, 사람·커널이 확정하는 것을 포함한다. 모델이 직접 확정하는 칸은 없다(결정 14).

| 루프 | N 방향 | E 이해 | M 실제 | A: 쓰는 능력 | P: 걸리는 정책 |
|---|---|---|---|---|---|
| O | 읽기. 루프 계획·모드 라우팅 제안. Goal 수정 제안 | 읽기. 상황 판정·문제 정의 패킷(해석, 전제, 열린 질문) 제안 | 읽기 | read, spawn, ask / observe, propose | 컨텍스트 라우팅, 질문 전달(O는 예약 기본) |
| I.fact, I.possibility, I.outcome | 선택 후보·합의 초안 제안, Goal 수정 제안 | 쓰기: 해석, 가능성, 근거 연결, 반증 탐색, 예측. 판단은 승격 규칙 통과 시 커널이 씀 | 읽기, 측정·재현 실행(execute) | read, execute, spawn, ask / observe, propose | 근거 부담(`proofBurden`), 근거 범위, 질문 조건 |
| I.want | 쓰기: 선호 모델 기준 후보 제안, 기준 확정은 사람 | 쓰기: 반응 관찰(출처 사람), 반응 해석 | 읽기. 자극은 Helm 저장 공간에 둔다(D10) | read, spawn, ask / observe, propose | 자극 수, 라운드 경계 예약 전달 |
| C.commit | 쓰기: 작업 합의(확정은 사람 또는 상시 합의), 혼자 정한 선택 | 읽기. 실행 결과 관찰은 자동 | 쓰기: 합의 범위 안 | read, write, execute, spawn, ask, (send) / observe, propose | 합의 범위, 멈출 조건, 권리 게이트, 범위 초과 시 즉시 전달 |
| C.probe | 쓰기: 탐침 레코드, 탐침 묶음 합의 | 결과는 관찰로만(판단 아님) | 쓰기: 탐침 범위 안 | read, write, execute, spawn / observe, propose | 탐침 예산, 키울·접을 조건 |
| C.emergency | 미리 맺어 둔 비상 합의를 적용 | 읽기 | 쓰기: 비상 합의 범위 안 | 비상 합의가 허용한 원시 행동 / observe, propose | 비상 합의 범위, 범위 밖은 즉시 |
| A.confirm | 쓰기: 결과 확인(사람만), 반영 항목(커널), 다시 열기 | 쓰기: 근거, 반대 근거(검증 에이전트), stale 표시 | 읽기(결과). 반영 작업은 반영 범위 안 쓰기 | 작업 에이전트: read, execute, spawn / observe, propose. 검증 에이전트: + attest. 사람: accept, integrate | 독립성(만든 행위자는 증언·확인 불가), 증명 부담, 독립 검증 |
| A.watch | 판정(키우기·접기·계속) 제안 | 쓰기: 관찰 누적 | 읽기, 측정 | read, execute / observe, propose | 관찰 기간, 연장 상한 |
| A.reflect | 쓰기: 합의 템플릿·다이얼·절차 변경 제안 | 쓰기: 돌아보기 기록 | 없음 | read, spawn / observe, propose | 돌아보기로 정책 수정 제안(채택은 사람) |
| S.* | 쓰기: Concern 트리(분해·병합·독립·재배치·보류·닫기), 경계 항목 | 읽기 | 없음 | read / observe, propose | 개수·깊이 상한, 의존 규칙 4 |

### 3.5 루프 식별자와 루프 계약 스키마 [제안]

#### 3.5.1 식별자와 기본 타입

루프 식별자는 v0.3 03 §2.1 표를 그대로 쓴다. `S.hold`와 `S.close`는 표에서 한 행이지만 하는 일이 달라 식별자 둘로 둔다(v0.3 표의 "S.hold, S.close" 표기와 같다).

```ts
// packages/kernel/src/orchestration/contracts/types.ts
// 레코드 필드로 쓰이는 이름은 @helm/domain(08)이 소유한다. 이 문서는 다시 정의하지 않고 import한다.
import {
  LOOP_IDS, type LoopId, loopFamily, SITUATION_TYPES,      // 08 §3.15 (v0.3 03 §2.1의 18개)
  type Primitive, type RecordCapability,                   // 08 §3.3.3 (결정 4)
  type AgentRole,                                          // 08 §3.3: work | verifier | mediator | observer | router | branch
  type QuestionKind, type ExitOutcome, type WorkUnitKind,   // 08 §3.13, §3.15, §3.8
} from "@helm/domain";

export type LoopFamily = "O" | "I" | "C" | "A" | "S";
export const familyOf = (id: LoopId): LoopFamily => loopFamily(id);
export type SituationType = (typeof SITUATION_TYPES)[number];

export type StepId =
  | "sense" | "frame" | "diverge" | "investigate" | "elicit" | "deliberate"
  | "commit" | "execute" | "assure" | "integrate" | "reflect" | "structure";

export type WorkUnitPurpose =
  | "assess" | "diverge" | "investigate" | "elicit" | "deliberate"
  | "draft_agreement" | "execute" | "probe" | "stabilize" | "submit" | "verify"
  | "watch_sample" | "integrate" | "reflect" | "structure" | "recombine"
  // 루프 밖 WorkUnit(활성화 id 없음, §3.12.5-7)
  | "entry_assess" | "prediction_check";

// WorkUnitKind(08, 브리프 §6: inquiry | probe | change | integration), Primitive, RecordCapability,
// AgentRole은 위 import를 쓴다. 발산 가지 run의 역할은 08의 "branch"다(15 §3.1.1).
```

#### 3.5.2 루프 계약

```ts
// packages/kernel/src/orchestration/contracts/types.ts (계속)

/** 이름으로 참조하는 조건. 구현은 guards.ts의 순수 함수 레지스트리에 있다(§3.5.4). */
export interface PredicateRef {
  name: PredicateName;
  params?: Readonly<Record<string, string | number | boolean | readonly string[]>>;
  negate?: boolean;
}

export interface EntrySpec {
  /** 모두 참이어야 진입한다. */
  requires: readonly PredicateRef[];
  /** 거짓이면 어떻게 하는가. redirect는 다른 루프를 먼저 활성화한 뒤 다시 시도한다. */
  onUnmet:
    | { kind: "redirect"; to: LoopId }
    | { kind: "touchpoint"; touchpoint: HumanTouchpointKind }
    | { kind: "reject" };
}

/** 루프 계약의 종료 결과. 타입은 08 `ExitOutcome`(LoopTransition.exitOutcome 필드, 22값)을 import한다.
 *  값 목록과 뜻은 이 표가 정하고 08이 같은 목록을 둔다(08 §3.15 주석 "목록 정본은 14"). */
type ExitOutcomeValues =
  | "planned"            // O: 판정과 계획이 기록됨
  | "disorder"           // O: 판정 불가 → S.split
  | "stop_rule_met"      // I.*: 탐구 멈춤 규칙 충족(15가 계산)
  | "budget_exhausted"   // 예산 소진. 열린 질문을 그대로 넘긴다
  | "autonomy_exhausted" // 묻지 않고 진행할 라운드를 다 씀. 사람 답을 기다린다
  | "reframe_needed"     // 탐구 중 문제가 둘 이상으로 나뉨
  | "submitted"          // C.commit: 결과 제출됨
  | "scope_exceeded"     // C.*: 합의 범위 밖 요청
  | "stop_condition_met" // C.*: 합의의 멈출 조건 충족
  | "grow" | "fold" | "inconclusive" | "continue"   // C.probe, A.watch
  | "stabilized"         // C.emergency
  | "accepted_integrated"// A.confirm: 결과 확인 + 반영 항목 모두 처리·미룸
  | "revision_requested" | "rejected_unresolved" | "criteria_wrong"   // A.confirm
  | "reflected"          // A.reflect
  | "structured"         // S.*: 구조 동작 완료
  | "children_created"   // S.split
  | "closed";            // S.close
// 컴파일 검사: 두 목록이 같아야 한다
const _exitSame: [ExitOutcome] extends [ExitOutcomeValues] ? ([ExitOutcomeValues] extends [ExitOutcome] ? true : never) : never = true;

export type NextHint =
  | { kind: "plan" }                                   // 루프 계획의 다음 단계
  | { kind: "loop"; to: LoopId }
  | { kind: "loopByType"; byType: Partial<Record<SituationType, LoopId>>; fallback: LoopId }
  | { kind: "lastOfFamily"; family: LoopFamily; fallback: LoopId }   // 이 Concern에서 마지막으로 활성화된 그 계열 루프
  | { kind: "return" }                                 // 직전 루프로 돌아감(S 동작 뒤)
  | { kind: "reopenTo" }                               // 결과 확인의 acceptance.reopenTo(08: C.commit | I.fact | I.want)
  | { kind: "wait"; reason: WaitReason }
  | { kind: "close"; result: "completed" | "not_completed" };

export interface ExitOutcomeSpec {
  outcome: ExitOutcome;
  /** 모두 참이면 이 결과로 종료(AND). OR가 필요한 칸은 { anyOf }로 묶는다. 배열 순서가 우선순위다(앞이 먼저). */
  when: readonly (PredicateRef | { anyOf: readonly PredicateRef[] })[];
  next: NextHint;
}

export interface WorkUnitTemplate {
  purpose: WorkUnitPurpose;
  step: StepId;
  kind: WorkUnitKind;
  /** fresh: 새 컨텍스트, fork: 같은 시점 기록에서 분기(서로 결과를 못 봄), resume: 같은 활성화의 이전 WorkUnit 요약을 이어받음 */
  context: "fresh" | "fork" | "resume";
  repeat: "once" | "per_round" | "per_probe" | "per_obligation" | "per_sample";   // 발산 가지는 WorkUnit으로 두지 않고 단계 run의 자식 run으로 둔다(15 §3.1.1)
  /** 계약 전체 능력의 부분집합. 없으면 계약 전체 */
  primitives?: readonly Primitive[];
  proposalKinds?: readonly ContractProposalKind[];
  role: AgentRole;
  /** 12에 주는 모델 선택 힌트 */
  modelHint: "default" | "cheap" | "different_from_worker";
  /** 하나라도 참이면 이 WorkUnit을 생략한다(예: 활성 합의나 확정 대기 초안이 있으면 draft_agreement 생략) */
  skipWhen?: readonly PredicateRef[];
}

export interface LoopBudget {
  rounds?: number;          // I.*의 기본 라운드(다이얼 depth가 덮어씀)
  workUnits: number;        // 이 활성화에서 시작할 수 있는 WorkUnit 수 상한
  subcalls: number;         // 하위 호출 수 상한(다이얼 budget이 덮어씀)
  wallMinutes: number;      // 벽시계 시간 상한
}

export interface TouchpointSpec {
  kind: HumanTouchpointKind;
  gate: "rights" | "information";       // 판정 근거는 11. 여기 값은 기본값이다
  requiredForExit: boolean;              // 답 없이 종료할 수 없는가
  countsTowardCaCap: boolean;            // C/A 사람 조작 2회 상한에 세는가(§3.13.7)
}

export interface PlaneAccess {
  N: "none" | "read" | "propose";
  E: "none" | "read" | "propose";
  M: "none" | "read" | "write_in_scope";
}

export interface LoopContract {
  id: LoopId;
  family: LoopFamily;
  nameKo: string;
  goal: string;
  coreQuestions: readonly string[];
  steps: readonly StepId[];
  workUnits: readonly WorkUnitTemplate[];
  inputs: readonly ContextSection[];       // 진입 시 읽는 것
  outputs: readonly OutputRecord[];        // 이 루프가 만드는 레코드 종류
  entry: EntrySpec;
  exit: readonly ExitOutcomeSpec[];
  capabilities: {
    primitives: readonly Primitive[];
    records: readonly RecordCapability[];
  };
  /** 모드가 이 원시 행동을 허용하지 않으면 모드를 다시 라우팅한다(§3.10.4) */
  requiredPrimitives: readonly Primitive[];
  proposalKinds: readonly ContractProposalKind[];
  planes: PlaneAccess;
  /** 의존 규칙 1에 대한 이 루프의 요구 */
  agreement: "none" | "active" | "standing_emergency" | "probe_batch" | "integration";
  context: { include: readonly ContextSection[]; exclude?: readonly ContextSection[] };
  humanTouchpoints: readonly TouchpointSpec[];
  opdc: OpdcObligations;
  budgetDefaults: LoopBudget;
  maturityLevel: 1 | 2 | 3 | 4 | 5;
  /** 근거가 된 방법(canon-3 §3.3). 문서용 */
  methods: readonly string[];
}

/** 이 루프가 만드는 레코드 종류. 값은 08 레코드 `kind` 리터럴을 쓴다 */
export type OutputRecord =
  | "situation_assessment" | "loop_plan" | "loop_transition" | "mode_assignment"
  | "interpretation" | "possibility" | "assumption" | "open_question" | "finding"
  | "prediction" | "stimulus" | "observation" | "preference_model" | "question"
  | "choice" | "agreement" | "probe" | "watch" | "workunit" | "result" | "attestation"
  | "acceptance" | "obligation" | "reflection" | "policy_proposal"
  | "concern" | "structure_change" | "boundary_item" | "expectation" | "entry_assessment";

export type WaitReason =
  | "human"            // 사람 접점 답 대기
  | "external"         // 기대 레코드 기한 대기
  | "children"         // 하위 Concern 대기
  | "watch"            // A.watch 관찰 기간
  | "held"             // S.hold
  | "scheduler";       // 거시 스케줄러가 실행을 미룸(동시 실행·주의 예산)
```

#### 3.5.3 제안 종류와 사람 접점 종류

제안 종류는 모델(또는 하위 에이전트)이 커널에 낼 수 있는 후보의 종류다. 도구 이름과 입력 스키마는 13이 정한다. 이 문서는 루프 계약이 어떤 종류를 노출하는지만 정한다. 08 `ProposalKind`(능력 표의 제안 종류, 33값)는 커널 자격 검사의 단위이고, 아래 `ContractProposalKind`는 도구 노출 단위다. 이름이 겹치지 않게 따로 두고, 둘의 대응은 §3.5.6 표다.

```ts
export type ContractProposalKind =
  // O
  | "frame_packet" | "situation_answers" | "loop_plan_draft" | "split_hint"
  // 공통
  | "transition_request" | "question" | "goal_revise" | "autonomous_choice"
  // 루프 밖(진입 판정, 예측 점검)
  | "entry_signals" | "prediction_check"
  // I.*
  | "possibility" | "perspective" | "consequence" | "divergence_cell" | "interpretation" | "evidence_link" | "counter_check"
  | "prediction" | "promote_request" | "choice_candidate"
  | "stimulus" | "reaction_interpretation" | "criterion_candidate"
  // C.*
  | "agreement_draft" | "probe_definition" | "probe_verdict" | "stabilization_report"
  | "result_submission"
  // A.*
  | "counter_evidence" | "attest" | "obligation_resolution" | "obligation_deferral"
  | "watch_spec" | "watch_verdict" | "reflection" | "change_proposal"
  // S.*
  | "structure_op" | "boundary_item" | "recombine_summary";

/** 이 문서가 다루는 사람 접점. 값은 08 `QuestionKind`의 부분집합이며 이름을 새로 만들지 않는다. */
export type HumanTouchpointKind = Extract<QuestionKind,
  | "agreement_confirm"       // 작업 합의 확정 (C/A 상한 1회째). 탐침 묶음 합의도 이 종류(합의 kind = probe)
  | "result_review"           // 결과 확인. 답은 08 AcceptanceDecision 다섯 값, 화면 문구는 05 키 (C/A 상한 2회째)
  | "scope_change"            // 합의 범위 밖 요청
  | "send_approval"           // 권리 게이트 행동 승인(send, 권한 레이어가 권리 범주로 본 execute·write)
  | "goal_revision"           // Goal 수정 확인(의존 규칙 5)
  | "emergency_authorization" // 비상 합의가 없는 혼돈 상황
  | "criterion_confirm"       // 기준 후보를 선호 모델에 올릴지
  | "stimulus_round"          // 원함 탐구의 반응 요청
  | "finding_confirm"         // 결정에 쓰이는 판단의 사람 확인(v0.3 02 §2.1-5)
  | "choice"                  // 선택 요청(I.want 밖에서만, 08 R-23)
  | "watch_verdict"           // 지속 관찰 판정이 모호할 때
  | "structure_limit"         // S 개수·깊이 상한 초과
  | "progress_stall"          // 재진입 가드: 진전 없는 순환, 복구하지 못한 실행
  | "entry_suggestion"        // "Concern으로 열까요?"
  | "budget_extension"        // 예산 소진 후 계속할지
  | "submission_missing"      // 쓰기 후 결과 제출이 없음
  | "recovery">;              // 결과 불명 외부 행동(10·12가 만든다. 14는 막는 대기로만 읽는다)
```

사람 접점은 모두 질문 레코드로 만든다(D7). 게이트(권리·정보), 전달 방식, 임시 가정과 만료점은 11이 정한다. 위 표의 `gate` 기본값은 11의 판정 입력이다. 1판의 접점 이름(`scope_exceeded`, `rights_permission`, `goal_revise`, `probe_agreement`)은 쓰지 않는다(대응은 §3.20.1).

같은 접점을 두 곳에서 만들지 않도록 만드는 쪽을 정한다.

| 접점 | 만드는 쪽 |
|---|---|
| `agreement_confirm`, `scope_change`, `send_approval`, `goal_revision`, `result_review` | 커널(10): 해당 명령이 `needs_gate`가 되면 같은 트랜잭션에서 `question.recorded`. 오케스트레이터는 만들지 않고 묶기 권고만 낸다 |
| `criterion_confirm`, `stimulus_round`, `finding_confirm` | 15의 탐구 엔진(질문 제안) |
| `emergency_authorization`, `watch_verdict`, `structure_limit`(10 gate가 없을 때), `progress_stall`, `entry_suggestion`, `budget_extension`, `submission_missing`, `choice`(I.want에서 C.commit으로 옮긴 뒤의 "지금 정하기", §3.6.3) | 오케스트레이터(`question.raise`를 runtime 행위자, R 채널로 제출) |
| `recovery` | 커널(10, 결과 불명 보고와 같은 트랜잭션) |


#### 3.5.4 조건 레지스트리

조건은 `(view: ConcernView, ctx: GuardContext) => boolean` 형태의 순수 함수다. `ConcernView`는 §3.12.1, `GuardContext`는 해석된 다이얼·설정·현재 시각이다. 이름과 뜻은 다음과 같다. 15가 계산하는 것은 15가 낸 결과 이벤트를 읽기만 한다.

| 이름 | 참이 되는 조건 | 계산 위치 |
|---|---|---|
| `concern.hasGoal` | Concern에 활성 Goal 연결이 있다(A1) | 14 |
| `situation.is` (params.types) | 현재 상황 판정 유형이 목록 안에 있다 | 14 |
| `situation.assessedSinceActivation` | 이 활성화 시작 뒤 상황 판정 레코드가 생겼다 | 14 |
| `plan.recordedSinceActivation` | 이 활성화 시작 뒤 루프 계획 레코드가 생겼다 | 14 |
| `assessment.failedTimes` (params.n) | 판정 시도가 n번 거부되거나 결정표가 판정 불가를 냈다 | 14 |
| `agreement.active` | Concern에 활성(확정된) 작업 합의가 있다 | 14(08 상태 읽기) |
| `agreement.draftPending` | 확정 대기 중인 합의 초안이 있다 | 14 |
| `agreement.standingMatches` (params.kind) | 조건이 맞는 상시 합의(비상 합의 등)가 있다(§3.6.7) | 14 |
| `submission.exists` | 활성 합의(또는 탐구 결과)에 대한 결과 제출이 있다 | 14 |
| `submission.missingAfterWrite` | 이 활성화에서 write가 관찰됐는데 결과 제출이 없다 | 14 |
| `probes.defined` | 키울·접을 조건과 예산이 있는 탐침이 하나 이상 있다 | 14 |
| `probe.anyGrow` / `probe.allFold` | 탐침 판정 결과 | 14(판정 이벤트 읽기) |
| `watch.specDefined` | 관찰 신호·기간·키울·접을 조건이 있는 지속 관찰 명세가 있다 | 14 |
| `watch.periodEnded` / `watch.growMet` / `watch.foldMet` | 관찰 기간 종료, 판정 조건 충족 | 14 |
| `watch.extensionsLeft` | 연장 횟수가 남았다 | 14 |
| `inquiry.stopRuleMet` | 15의 멈춤 규칙 충족 이벤트가 이 활성화에 있다 | 15 |
| `inquiry.roundsReached` | 완료 라운드 수 ≥ 다이얼 `depth` | 14 |
| `autonomy.exhausted` | 사람 답 없이 완료한 라운드 수 ≥ 다이얼 `autonomy` | 14 |
| `budget.exhausted` | 활성화 예산(WorkUnit 수, 하위 호출, 시간) 중 하나를 다 썼다 | 14(09 `budget.charged`의 사용량을 활성화 단위로 합산. run·WorkUnit·탐구 한도는 `budget.exhausted` 이벤트로 받는다) |
| `scope.exceededEvent` | 이 활성화에서 범위 밖 요청이 gate(`gate.scope_expansion_required`, 10 ADR-K8)나 `workunit.scope_exceeded`·`agreement.violation_detected`가 됐다 | 14(10·09 읽기) |
| `stopCondition.met` | 합의의 멈출 조건 충족 선언이 기록됐다 | 14 |
| `emergency.stabilized` | 비상 합의의 안정화 조건이 충족됐다(§3.6.7) | 14 |
| `acceptance.verdict` (params.verdict) | 결과 확인 답(08 `AcceptanceDecision`: `accepted`, `conditional`, `revision_requested`, `rejected`, `criteria_wrong`)이 해당 값이다. 10 명령 값(`accept` 등)으로 비교하지 않는다 | 14 |
| `obligations.allClosed` | 반영 항목이 모두 처리 또는 명시적 미룸 | 14(08 상태 읽기) |
| `reflection.complete` | 돌아보기 기록에 변경 제안 ≥ 1 또는 "변경 없음" 이유가 있다 | 14 |
| `children.allTerminal` | 하위 Concern이 모두 닫힘·반영 완료·독립 상태다 | 14 |
| `structure.withinLimits` | 분해 결과가 개수·깊이 상한 안이다 | 14 |
| `structure.opRecorded` | 이 활성화에서 구조 동작이 커널에 받아들여졌다 | 14 |
| `revisit.met` | 보류의 다시 볼 조건이 충족됐다 | 14 |
| `directive.close` | 사람이 이 Concern을 명시적으로 닫으라고 했다(의존 규칙 4 예외) | 14 |
| `dial.equals` (params.dial, params.value) | 해석된 다이얼 값이 주어진 값과 같다. `independentVerification`의 `auto`는 `proofBurden === "heavy"`이면 `always`, 아니면 `off`로 바꿔 비교한다 | 14 |

```ts
export type PredicateName =
  | "concern.hasGoal" | "situation.is" | "situation.assessedSinceActivation" | "plan.recordedSinceActivation"
  | "assessment.failedTimes" | "agreement.active" | "agreement.draftPending" | "agreement.standingMatches"
  | "submission.exists" | "submission.missingAfterWrite" | "probes.defined" | "probe.anyGrow" | "probe.allFold"
  | "watch.specDefined" | "watch.periodEnded" | "watch.growMet" | "watch.foldMet" | "watch.extensionsLeft"
  | "inquiry.stopRuleMet" | "inquiry.roundsReached" | "autonomy.exhausted" | "budget.exhausted"
  | "scope.exceededEvent" | "stopCondition.met" | "emergency.stabilized" | "acceptance.verdict"
  | "obligations.allClosed" | "reflection.complete" | "children.allTerminal" | "structure.withinLimits"
  | "structure.opRecorded" | "revisit.met" | "dial.equals" | "directive.close";

export type GuardFn = (view: ConcernView, ctx: GuardContext, params?: PredicateRef["params"]) => boolean;
export type GuardRegistry = Readonly<Record<PredicateName, GuardFn>>;
export interface GuardContext {
  now: number;
  dials: ResolvedDials;              // 현재 루프 계열 기준으로 해석된 값
  settings: OrchestrationSettings;
  activationStartSeq: number;
}
```

새 조건을 더할 때는 이 표와 `guards.ts`의 레지스트리, 단위 테스트를 함께 고친다. 계약 데이터 로딩 시 모든 `PredicateRef.name`이 레지스트리에 있는지 검사한다(§6 완료 기준 C-1).

#### 3.5.5 컨텍스트 섹션과 OPD+C 의무

```ts
/** 12가 투영(모델 컨텍스트)으로 만드는 섹션 이름. 섹션별 내용 형식은 12가 정한다. */
export type ContextSection =
  | "goal" | "concern" | "parent_chain" | "boundary_items" | "children"
  | "situation" | "loop_plan" | "transitions" | "contests" | "rejections"
  | "agreement" | "criteria" | "procedure"
  | "recent_observations" | "open_questions" | "assumptions"
  | "findings" | "possibilities" | "predictions"
  | "preference_model" | "recent_reactions" | "stimuli"
  | "probes" | "watch_spec"
  | "submission" | "evidence" | "counter_evidence" | "obligations"
  | "human_ops" | "autonomous_decisions"
  | "choices";        // 이 Concern과 상위 Concern의 committed 선택(id, 정한 것, 다시 볼 조건). 원전 Context Compilation의
                      // "active Decisions/Constraints"(canon §13.10). 합의의 implementsChoices가 가리키는 선택은 12 섹션 표에서 필수

/** OPD+C 의무 id. 형식 "opdc:<o|p|d|c>.<이름>"([판정 J-112], [판정 J-149]). 16의 지표 ID(`opdc.o.*`, 점 표기)와
 *  같은 문자열이 되지 않게 묶음 뒤를 쌍점으로 잇는다. 각 id는 투영 필드(12)나 클라이언트 명령(19)에 하나 이상 대응해야 한다. */
export type OpdcId = `opdc:${"o" | "p" | "d" | "c"}.${string}`;

export interface OpdcObligations {
  observability: readonly OpdcId[];
  predictability: readonly OpdcId[];
  directability: readonly OpdcId[];
  contestability: readonly OpdcId[];
}
```

모든 루프 계약에 공통으로 붙는 의무(계약 데이터에 따로 적지 않고 로더가 더한다):

| id | 기준 | 뜻 | 근거 |
|---|---|---|---|
| `opdc:o.current_loop_mode_dials` | O | 현재 루프, 모드, 다이얼 값과 그 값이 온 설정 층 | v0.3 09 §4.2, §4.9 |
| `opdc:o.intent_and_reason` | O | 지금 하는 WorkUnit과 그 이유 | v0.3 09 §4.2 |
| `opdc:o.autonomous_decisions` | O | 이 Concern에서 에이전트가 정한 것(접힘, 종류별 개수) | 결정 8 |
| `opdc:p.next_step_and_stop` | P | 다음 예정 행동과 멈출 조건 | v0.3 09 §4.2, canon §10.7-1 |
| `opdc:p.assumptions_in_use` | P | 답을 받지 않고 진행 중인 임시 가정과 만료점 | v0.3 09 §4.2 |
| `opdc:p.loop_plan` | P | 루프 계획(남은 단계, 건너뛴 루프와 이유) | 이 문서 §3.8 |
| `opdc:d.edit_goal_criteria_dials` | D | 목표·기준·다이얼 수정이 다음 턴 경계에 반영됨 | X3-8-20 |
| `opdc:d.directive_loop` | D | 루프 직접 지정, 루프 계획 수정 | v0.3 03 §6 마지막 행 |
| `opdc:c.contest_autonomous` | C | 혼자 정한 결정(전환, 계획, 판정, 분해, 라우팅)에 이의 → 재개방 이벤트 | 결정 8, X3-8-20 |

루프별 의무는 §3.6의 각 계약 표 "OPD+C" 행에 적는다.

#### 3.5.6 제안 종류와 명령의 대응, 선언 도구 [제안, 13 §3.7.2 요구]

제안 종류는 두 부류다.

1. **기록 제안**: 모델이 커널에 바로 내는 제안. 도구 하나가 10 명령 하나 이상을 M 채널로 제출한다(13 TL-5).
2. **선언**: 모델은 값만 선언하고, 결정은 오케스트레이터가 가드·규칙으로 계산한 뒤 R 채널(`declaredBy` = 그 run)로 제출한다. 루프 전환, 구조 진입, 상황 판정 답, 진입 신호가 여기에 속한다. 모델이 `loop.transition`을 직접 내면 재진입 가드(§3.9.5)를 거치지 않기 때문이다. 선언 도구는 커널에 제출하지 않고, 런타임이 그 run을 다음 턴 경계에서 `run.ended(handed_off)`로 끝내면서 선언을 종료 기록에 싣는다(12 run 종료 사유 `handed_off`. 12에 `handoff` 필드 요구). 오케스트레이터는 `run.ended`를 받아 판단한다.

```ts
// RunHandoff와 EntryAssessmentDraft는 08 §3.18.1·§3.6.4의 정의를 import한다(레코드 정본 08).
import { RunHandoff, EntryAssessmentDraft } from "@helm/domain";
// 08 §3.18.1은 transition_request, split_hint, entry_signals, stabilized, situation_answers 다섯 변형을 정의한다. 아래 (1)·(2)는 그 가운데 transition_request의 trigger와 situation_answers 변형을 이 문서가 쓰는 형태로 적은 것이다(§5.2).
//  (1) transition_request에 trigger: DeclaredTrigger — 08 TransitionTrigger 중 모델이 선언할 수 있는 값.
//      전환 규칙(§3.9.2)이 T01·T05·T07·T15를 이 값으로 고른다.
export type DeclaredTrigger = "surprise" | "goal_conflict" | "shared_premise_conflict" | "situation_changed" | "merge_needed";
//  (2) situation_answers 변형 — O의 assess run이 판정 질문 답(§3.7.1 SituationAnswersProposal)을 선언하고 끝난다.
//      오케스트레이터가 classify로 유형을 계산해 situation.assess(R, declaredBy)를 낸다.
//      { kind: "situation_answers"; answers: SituationAnswer[]; parts?: { label; answers }[] }
// 09 run.ended payload와 10 RunEndPayload(이미 handoff?: RunHandoff)는 08 타입을 쓴다
```

| 제안 종류 | 부류 | 10 명령(2판) |
|---|---|---|
| `situation_answers` | 선언 | (handoff `situation_answers`) → 오케스트레이터가 `classify`(§3.7.2)로 유형·확신·대안을 계산해 `situation.assess`(R, `declaredBy` = assess run, `computedBy: "decision_table@1"`). 판정 기록의 제출자는 오케스트레이터 하나다 |
| `frame_packet`, 요청 형태 | 기록 | `concern.reframe`(문제 정의 패킷에 `planFlags`(계획 표시 일곱 개), `requestForm`을 함께) |
| `loop_plan_draft`(`steps`, `reason`) | 기록 | `loop_plan.record`(M 채널, 모델 초안). 검사와 대체는 커널이 한다(10 V-PLAN-01~07, §3.8.5). 오케스트레이터는 `validatePlan`을 부르지 않고 결과(`loop_plan.adopted`)를 받는다 |
| `situation_summary` | (없앰) | 복귀 요약은 12의 투영이다. O의 요약 문장은 `frame_packet`에 넣는다 |
| `transition_request` | 선언 | (handoff) → 오케스트레이터 `loop.transition` |
| `split_hint` | 선언 | (handoff) → 오케스트레이터 `loop.transition(→ S.split)` |
| `stabilization_report` | 선언 | (handoff `stabilized`) → T24 |
| `entry_signals` | 선언 | (handoff) → `concern.open` 또는 `entry.evaluate` |
| `structure_op`, `boundary_item`, `recombine_summary` | 기록(S 루프 안) | `structure.split`·`merge`·`detach`·`relocate`·`recombine`·`hold`·`close` |
| `question` | 기록 | `question.raise` |
| `goal_revise` | 기록 | `goal.revise`(제안) |
| `autonomous_choice` | 기록 | `choice.decide` |
| `possibility`, `divergence_cell`, `choice_candidate`, `perspective` | 기록 | `possibility.propose`(`perspective`는 `possibilityKind: perspective`, 15 §3.2) |
| `consequence` | 기록 | 15의 결과 선언(15 §3.4 대비 압축). 명령은 15·13이 정한 `possibility.propose` 주석 경로 |
| `interpretation`, `reaction_interpretation` | 기록 | `interpretation.propose`, `assumption.record` |
| `evidence_link`, `counter_check` | 기록 | 10 §3.11의 근거 연결·반증 탐색·구분 확인 명령 |
| `promote_request` | 기록 | `finding.promote` |
| `prediction`, `prediction_check` | 기록 | `prediction.propose`, `prediction.check` |
| `stimulus` | 기록 | `stimulus.create`, `stimulus.present` |
| `criterion_candidate` | 기록 | `preference.criterion.propose` |
| `agreement_draft` | 기록 | `agreement.propose`, `agreement.revise`, `agreement.request_scope_change`, `agreement.report_stop`, `agreement.discard`(1판 `agreement.decline_draft`) |
| `probe_definition`, `probe_verdict` | 기록 | `probe.define`, `probe.judge` |
| `result_submission` | 기록 | `result.submit`(탐구 결과도 `inquiry` 합의를 가리키는 `result.submit`, §3.20.1) |
| `counter_evidence`, `attest` | 기록 | 반대 근거 연결, `result.attest`(검증 에이전트) |
| `obligation_resolution`, `obligation_deferral` | 기록 | `obligation.propose`, `obligation.resolve`, `obligation.defer`(에이전트 제안 가능, 확정은 결과 확인에 묶음, 10 §3.11.8), `obligation.transfer` |
| `watch_spec`, `watch_verdict` | 기록 | `watch.define`, `watch.judge` |
| `watch_sample` | (없앰) | 표본은 도구 실행 관찰이다 |
| `reflection`, `change_proposal` | 기록 | `reflection.record`(`changeProposals`, `nextAgreementChange`) |

표의 `(없앰)`은 제안 종류에만 해당한다. 같은 이름의 작업 단위 목적(`watch_sample`, §3.3.1·§3.5.1)은 그대로 남는다.

`perspective`와 `consequence`는 15 §5.2 요구로 더한 종류다(I.fact, I.possibility, I.outcome 계약에 노출). 도구 이름(`helm_<kind>`)과 입력 스키마는 13이 이 표에서 만든다.

### 3.6 루프별 계약 [제안]

아래 표의 각 행이 `LoopContract` 필드 하나에 대응한다. 구현자는 표를 §3.6.12의 예시 형식으로 옮긴다. 공통 사항:

- 모든 루프는 제안 종류 `transition_request`, `question`, `goal_revise`를 노출한다(I.want의 `goal_revise`도 포함). 표에는 루프 고유의 것만 적는다.
- "다음" 칸의 `계획`은 루프 계획의 다음 단계, `직전 I`는 이 Concern에서 마지막으로 활성화된 I 계열 루프(없으면 괄호 안 값)다. `NextHint`의 `lastOfFamily`로 표현한다.
- I 계열의 라운드와 WorkUnit 순서는 15의 탐구 엔진이 정한다(§5.2 15 요구). 오케스트레이터는 계약의 예산·자율 정도·종료 조건만 집행한다.
- 예산 기본값은 [제안]이며 다이얼 `budget`, `depth`가 덮어쓴다.


#### 3.6.1 O 상황 파악

| 항목 | 내용 |
|---|---|
| 목표 | Concern의 현재 상태를 파악하고 상황 유형을 판정하고 다음 루프를 정한다 |
| 핵심 질문 | 무엇이 변했나 / 왜 중요한가 / 개입하지 않으면 무엇이 일어나나 / 누가 무엇을 맡고 있나(canon §15.3 O) / 이것은 어떤 종류의 상황인가(v0.3 05) |
| 단계 | Sense, Frame |
| 입력 | goal, concern, parent_chain, boundary_items, children, transitions, contests, recent_observations(직전 O 활성화 이후 커서부터), open_questions, assumptions, procedure(같은 종류 Concern의 절차 후보) |
| 출력 | situation_assessment, loop_plan, mode_assignment, interpretation·assumption·open_question(문제 정의 패킷), question |
| 진입 | 조건 없음. 어느 루프에서든 들어올 수 있다 |
| 종료 → 다음 | `planned`: 판정과 계획이 이 활성화에서 기록됨 → 계획 / `disorder`: 판정이 2번 실패했거나 판정 결과가 disorder → `S.split` / `budget_exhausted` → `S.split`(판정 불가로 본다, v0.3 05 §3.2-4) |
| 원시 행동 / 기록 능력 | read, spawn, ask / observe, propose |
| 필수 원시 행동 | read |
| 고유 제안 | `frame_packet`(요약 문장 포함), `situation_answers`, `loop_plan_draft`, `split_hint`, `agreement_draft`(명확하고 작은 작업으로 보일 때만, §3.16.4) |
| 평면 | N 제안, E 제안, M 읽기 |
| 합의 | 필요 없음 |
| WorkUnit | `assess`(Sense+Frame, fresh, work, default). 실패 시 1번 다시 실행 |
| 사람 접점 | 없음 |
| 기본 전달 | 예약(복귀 요약) |
| OPD+C | O `opdc:o.assessment_answers`(판정 질문 답과 근거) / C `opdc:c.contest_assessment` |
| 예산 | WorkUnit 2, 하위 호출 6, 10분 |
| 성숙도 | L1 |
| 방법 | Situation Awareness, Distributed Cognition, SBAR, ICS, Dewey(Frame) |

#### 3.6.2 I.fact 사실 탐구

| 항목 | 내용 |
|---|---|
| 목표 | 무엇이 그런가(원인, 사실)를 관찰 근거로 밝힌다 |
| 핵심 질문 | 무엇을 문제로 보고 있나 / 어떤 합리적 대안 설명이 있나 / 어떤 근거가 가설을 실제로 구분하나 / 정보를 더 모으는 것과 지금 행동하는 것 중 어느 쪽 가치가 큰가(canon §15.3 I) |
| 단계 | Diverge, Investigate, Deliberate |
| 입력 | goal, concern, situation, assumptions, open_questions, recent_observations, findings, possibilities, criteria |
| 출력 | interpretation, possibility(원인 후보), observation(도구 실행), finding(승격 규칙 통과 시 커널), prediction(관점별 예측), question, choice(후보), agreement(초안) |
| 진입 | `situation.is(disorder)`가 아니어야 함. 거짓이면 `S.split`으로 보낸다 |
| 종료 → 다음 | `reframe_needed`: 분해 힌트가 받아들여짐 → `S.split` / `stop_rule_met` → 계획 / `autonomy_exhausted` → 대기(human) / `budget_exhausted` → 계획(열린 질문을 넘김, v0.3 03 §3.2) |
| 원시 행동 / 기록 능력 | read, execute, spawn, ask / observe, propose |
| 필수 원시 행동 | read |
| 고유 제안 | `possibility`, `perspective`, `divergence_cell`, `interpretation`, `evidence_link`, `counter_check`, `prediction`, `promote_request`, `choice_candidate`, `agreement_draft`, `split_hint`, `autonomous_choice`, `probe_definition`(바꿔 봐야 아는 확인의 탐침 제안, 15 §3.5, T33) |
| 평면 | N 제안, E 제안, M 읽기(측정·재현 실행) |
| 합의 | 필요 없음(쓰기 없음). 실행이 작업 대상을 바꾸는지는 권한 레이어가 판정하고, 바꾼다고 판정되면 거부된다(13) |
| WorkUnit | `diverge`(once, 라운드 0. 가지는 그 run의 자식 run `branch`로 fork, 15 §3.1.1), `investigate`(per_round, resume), `deliberate`(once, 종료 직전) |
| 사람 접점 | `finding_confirm`(정보, 종료에 필요 없음). 묶는 곳: 사람이 그 판단을 근거로 선택을 하면 그 선택 요청(`choice`)에, 아니면 다음 C의 합의 확인 질문에 묶는다. 선택 요청에 묶이면 선택이 확정될 때 판단 확인도 함께 닫히고, 질문 화면은 "판단 n도 확인됨"을 보인다(§3.13.7) |
| 기본 전달 | 예약(라운드 경계). 작업이 막히는 질문만 협상(v0.3 06 §5) |
| OPD+C | O `opdc:o.hypotheses_and_counter`(관점별 예측, 지지·반대 근거, 다음 구분 확인) / C `opdc:c.contest_finding` |
| 예산 | 라운드 3, WorkUnit 12, 하위 호출 24, 60분 |
| 성숙도 | L2 |
| 방법 | Dewey Inquiry, Peirce Abduction, ACH, NASA Decision Analysis |

#### 3.6.3 I.want 원함 탐구

| 항목 | 내용 |
|---|---|
| 목표 | 자극과 반응으로 사용자가 원하는 것을 알아내 선호 모델을 만든다(결정 1, 18) |
| 핵심 질문 | 사용자는 무엇에 어떻게 반응하는가 / 말한 기준과 실제 반응은 어디서 다른가 / 가장 불확실한 기준을 확인할 자극은 무엇인가 / 선호 모델이 더 바뀌지 않는가 |
| 단계 | Diverge, Elicit, Deliberate |
| 입력 | goal, preference_model, recent_reactions, stimuli, criteria, open_questions |
| 출력 | stimulus, observation(반응, 출처 사람), interpretation(반응 해석), preference_model(새 버전, 기준 확정은 사람), question |
| 진입 | `situation.is(disorder)`가 아니어야 함. 거짓이면 `S.split` |
| 종료 → 다음 | `reframe_needed` → `S.split`(예: 주제와 형식의 선호가 따로 움직임, v0.3 03 §9.1) / `stop_rule_met`(선호 모델이 두 라운드 동안 바뀌지 않음, 15) → 계획 / `autonomy_exhausted` → 대기(human) / `budget_exhausted` → 계획 |
| 원시 행동 / 기록 능력 | read, spawn, ask / observe, propose. 자극·초안은 Helm 저장 공간에 둔다(D10). 작업 대상에 쓰려면 C가 필요하다 |
| 필수 원시 행동 | read, ask |
| 고유 제안 | `stimulus`, `reaction_interpretation`, `criterion_candidate`, `possibility`(다른 분야 레퍼런스 자극), `split_hint` |
| 평면 | N 제안(선호 모델), E 제안(반응 해석), M 읽기 |
| 합의 | 필요 없음 |
| WorkUnit | `elicit`(per_round. 자극 생성은 15가 fork 가지로 나눈다), `deliberate`(once, 끝에 한 번: 완료 기준 초안과 넘김 레코드. 15 §3.1.1) |
| 사람 접점 | `stimulus_round`(정보, 종료에 필요 없음. 반응이 없으면 `autonomy_exhausted`로 기다린다), `criterion_confirm`(정보) |
| 기본 전달 | 예약(라운드 경계) |
| OPD+C | O `opdc:o.criteria_candidates`(기준 후보와 확신 정도), `opdc:o.said_vs_reacted` / D `opdc:d.element_reaction`(요소 단위 반응, 이유 없는 반응, 고쳐 말하기) / C `opdc:c.contest_criterion` |
| 예산 | 라운드 4, WorkUnit 8, 하위 호출 24, 60분 (v0.3 08 §7 예시) |
| 성숙도 | L2 |
| 방법 | 레퍼토리 그리드, 비평 기반 추천, 선호 구성, Self-Determination Theory, Phronesis |

I.want 안에서는 선택 요청(`choice`)을 내지 않는다(결정 18, 08 R-23). 답이 자극·가능성 id를 가리키는 질문도 커널이 거부한다([판정 J-141], 10 V-Q-03). 사람이 탐구 화면에서 "지금 정하기"를 누르면 다음 순서로 처리한다.

1. 19 `inquiry.requestDecision` → 10 `inquiry.stop{decide_now}` → `inquiry.stopped{stopReason: human_decided}`(15 §3.1.5).
2. 오케스트레이터가 `inquiry.stopped`(사람의 멈춤, `then: decide_now`)를 받아 T20(사람 지시)으로 `loop.transition{I.* → 계획의 다음 C 루프, 없으면 C.commit, trigger: human_directive}`을 낸다. 진입 조건(`concern.hasGoal`)이 거짓이면 `O`로 돌린다. 이 순서는 I.want뿐 아니라 모든 I 계열에 같다(15 §3.1.5).
3. `loop.transitioned(to: C.commit)`을 받은 다음 `decide`에서 15가 만든 선택 요청 초안(15 §3.11.1)으로 `question.raise{kind: choice}`를 낸다(R). 커널의 R-23 검사는 질문을 낼 때의 현재 루프(`C.commit`)로 판정한다(08에 요구, §5.2).
4. 선택이 확정되면 `draft_agreement`부터 C.commit 계약대로 진행한다. 선택의 구조화 범위 안 합의는 확정 질문 없이 활성될 수 있다([판정 J-133], R-OP-2(a)).

#### 3.6.4 I.possibility 가능성 탐구

| 항목 | 내용 |
|---|---|
| 목표 | 무엇이 될 수 있는가(아직 없는 해법과 관점)를 만든다 |
| 핵심 질문 | 아직 비어 있는 방향은 무엇인가 / 같은 구조의 문제를 다른 분야는 어떻게 풀었나(Method Transfer) / 복사하면 안 되는 것은 무엇인가 / 실현 가능한 후보가 있나 |
| 단계 | Diverge, Investigate, Deliberate |
| 입력 | goal, assumptions, possibilities, findings, preference_model, criteria |
| 출력 | possibility, observation(작은 실현 가능성 확인), question, choice(후보), agreement(초안) |
| 진입 | `situation.is(disorder)`가 아니어야 함. 거짓이면 `S.split` |
| 종료 → 다음 | `reframe_needed` → `S.split` / `stop_rule_met`(발산 표의 빈 칸이 닫히고 실현 가능 후보 ≥ 1, 15) → 계획 / `autonomy_exhausted` → 대기(human) / `budget_exhausted` → 계획 |
| 원시 행동 / 기록 능력 | read, execute(쓰기 없는 실현 가능성 확인), spawn, ask / observe, propose |
| 필수 원시 행동 | read |
| 고유 제안 | `possibility`, `perspective`, `consequence`, `divergence_cell`, `evidence_link`, `choice_candidate`, `agreement_draft`, `split_hint`, `probe_definition`(탐침 제안, T33) |
| 평면 | N 제안, E 제안, M 읽기 |
| 합의 | 필요 없음 |
| WorkUnit | `diverge`(per_round: 라운드 0과 열린 칸이 남은 라운드만. 칸마다 자식 run `branch`, fork, 가지마다 다른 모델 가능, 15 §3.1.1), `investigate`(per_round), `deliberate`(per_round, 멈춤 판정) |
| 사람 접점 | 없음(질문은 정보 게이트로 생길 수 있음) |
| 기본 전달 | 예약(라운드 경계) |
| OPD+C | O `opdc:o.divergence_table`(채운 칸, 빈 칸, 해당 없음과 이유, 근거 유무) / C `opdc:c.contest_possibility` |
| 예산 | 라운드 2, WorkUnit 10, 하위 호출 30, 60분 |
| 성숙도 | L2 |
| 방법 | Method Transfer, 형태 분석(Zwicky), TRIZ, Double Diamond |

#### 3.6.5 I.outcome 결과 탐구

| 항목 | 내용 |
|---|---|
| 목표 | 하면 무엇이 일어나는지 예측하고, 주요 실패 경로마다 대응이나 감시 조건을 붙인다 |
| 핵심 질문 | 이 선택이 실패했다면 왜인가(사전 부검) / 어떤 부작용과 파급이 있나 / 언제 무엇으로 예측을 확인하나 |
| 단계 | Investigate, Deliberate |
| 입력 | goal, possibilities, findings, criteria, agreement(초안), predictions |
| 출력 | prediction(확인 날짜·조건), interpretation(실패 경로), question, agreement(초안의 멈출 조건 보강) |
| 진입 | 조건 없음 |
| 종료 → 다음 | `stop_rule_met`(주요 실패 경로마다 대응·감시 조건, 15) → 계획 / `autonomy_exhausted` → 대기(human) / `budget_exhausted` → 계획 |
| 원시 행동 / 기록 능력 | read, execute(시뮬레이션), spawn, ask / observe, propose |
| 필수 원시 행동 | read |
| 고유 제안 | `prediction`, `consequence`, `interpretation`, `agreement_draft`, `choice_candidate` |
| 평면 | N 제안, E 제안, M 읽기 |
| 합의 | 필요 없음 |
| WorkUnit | `investigate`(per_round), `deliberate`(once) |
| 부수 효과 | 예측 레코드의 확인 시각마다 12에 타이머를 건다(전환 T18) |
| 사람 접점 | 없음 |
| 기본 전달 | 예약(라운드 경계) |
| OPD+C | P `opdc:p.predictions_with_dates` / O `opdc:o.failure_paths` |
| 예산 | 라운드 2, WorkUnit 6, 하위 호출 16, 45분 |
| 성숙도 | L2 |
| 방법 | 사전 부검(Klein), 시나리오 계획, STPA |

#### 3.6.6 C.commit 약속형 C

| 항목 | 내용 |
|---|---|
| 목표 | 정한 것을 작업 합의 범위 안에서 실행하고, 결과를 기준별 근거와 함께 제출한다 |
| 핵심 질문 | 누가 무엇을 왜 맡았나 / 무엇을 스스로 정할 수 있나 / 완료를 어떤 근거로 주장해야 하나 / 어떤 조건에서 방향을 바꾸거나 위로 올려야 하나(canon §15.3 C) |
| 단계 | Commit, Execute (+ Assure의 제출) |
| 입력 | goal, choices(사람이 확정한 선택, 상위 Concern 포함), criteria, findings, possibilities, preference_model, agreement(또는 초안), procedure |
| 출력 | agreement(초안 → 확정), workunit(변경), observation(자동), choice(혼자 정한 선택), result(결과 제출, 반영 범위 초안 포함), question |
| 진입 | `concern.hasGoal`(A1). 거짓이면 `O`로 보내 Goal 연결을 제안하게 한다 |
| 종료 → 다음 | `submitted` → `A.confirm` / `scope_exceeded` → 대기(human, `scope_change` 접점) / `stop_condition_met` → 대기(human) / `budget_exhausted` → 대기(human, `budget_extension`) |
| 원시 행동 / 기록 능력 | read, write, execute, spawn, ask, send / observe, propose. send는 합의가 허용하고 권리 게이트를 통과한 경우만(권한 레이어 판정, 13) |
| 필수 원시 행동 | read, write |
| 고유 제안 | `agreement_draft`, `autonomous_choice`, `result_submission`, `split_hint` |
| 평면 | N 제안(합의), E 읽기, M 합의 범위 안 쓰기 |
| 합의 | 활성 합의 필요(의존 규칙 1). 합의 출처는 사람 확정, 상시 합의, 사람의 직접 지시 중 하나(§3.9.4) |
| WorkUnit | `draft_agreement`(once, fresh, 도구 read와 `agreement_draft`만. 활성 합의나 확정 대기 초안이 있으면 생략) → `execute`(합의 버전마다 once, resume) → `submit`(write가 관찰됐는데 제출이 없을 때만, once) |
| 사람 접점 | `agreement_confirm`(권리, 필수, C/A 상한에 셈), `scope_change`(권리, 필수, 정상 경로 밖: 상한에 세지 않고 사유와 함께 기록), `send_approval`(권리, 필수, 정상 경로 밖: 같음), `submission_missing`(정보). 정상 경로 밖 조작의 분류는 01 R-OP-4를 따른다(§3.13.7) |
| 기본 전달 | 협상. 범위 이탈은 즉시(v0.3 06 §5) |
| OPD+C | O `opdc:o.agreement`(여섯 항목과 의도 재진술) / P `opdc:p.stop_conditions` / D `opdc:d.edit_agreement` / C `opdc:c.scope_challenge` |
| 예산 | 활성 합의의 `scope.budget`(08 Budget: 실행 수, 도구 호출 수, 시간, 비용)이 있으면 그 값이 루프 기본값보다 먼저다. 합의 초안을 쓰는 모델이 작업 크기에 맞는 예산을 추정해 초안에 넣고, 사람은 합의 확인 화면에서 고친다. 합의에 예산이 없을 때의 기본값은 WorkUnit 4, 하위 호출 20, 120분. 시간은 이 활성화에서 실행 중이던 run들의 벽시계 시간 합이다(대기·큐 시간 제외, `wallMsUsed`) |
| 성숙도 | L3 |
| 방법 | Mission Command, Speech Acts, Management by Exception, WHO Surgical Checklist |

합의 초안은 작업 에이전트가 의도를 다시 말하는 문장(check-back)을 포함한다(canon-3 G1, Mission Command 규칙 2). 사람은 초안을 확정하거나 고친다. 사람이 고르기만 하는 선택지 목록은 만들지 않는다(결정 18).

`agreement_confirm` 답에 따른 처리(X3 Q1의 빠진 전이 중 오케스트레이션 측):

| 답 | 처리 |
|---|---|
| 확정 | 합의 활성화(10) → `execute` 요청. C/A 주기 시작(사람 조작 1) |
| 고쳐서 확정 | 사람이 고친 초안을 확정(합의 출처 human). 같은 처리. 사람 조작은 1로 센다 |
| 다시 써 달라(고칠 점 문장) | 사람 발화를 관찰로 넣고 `draft_agreement`를 한 번 더 요청. 재작성 요청과 이어지는 확정은 C/A 상한 계산에서 합의 확인 한 번으로 센다(같은 접점의 반복). 주의 예산에는 둘 다 센다 |
| 취소 | 합의 초안 폐기. 우회 지표 이벤트. 다음: 직전 I(없으면 `S.hold`, 다시 볼 조건 "사람이 다시 열 때") |
| 멈출 조건 충족 선언(실행 중) | `stop_condition_met` → 대기(human). 답에 따라 합의 개정(→ `execute`), 직전 I, `S.close` |

#### 3.6.7 C.probe 탐침형 C와 C.emergency 비상 합의

**C.probe**

| 항목 | 내용 |
|---|---|
| 목표 | 결과를 모르는 상태에서 작고 실패해도 되는 시도 여러 개로 정보를 얻는다(v0.3 03 §3.3) |
| 핵심 질문 | 무엇을 확인하려는가(가설) / 언제 키우고 언제 접나 / 얼마까지 쓰나 |
| 단계 | Commit, Execute |
| 입력 | goal, possibilities, preference_model, criteria, probes |
| 출력 | probe, agreement(탐침 묶음 합의), workunit(탐침), observation(결과는 판단으로 올리지 않고 관찰로 둔다), choice(탐침 판정) |
| 진입 | `concern.hasGoal` |
| 종료 → 다음 | `grow`(키울 조건을 만족한 탐침이 있음) → `C.commit`(그 탐침을 약속형으로 키움) / `fold`(모든 탐침이 접을 조건) → 직전 I(`I.possibility`) / `inconclusive`(실행은 끝났지만 판정에 시간이 필요) → 계획(보통 `A.watch`) / `budget_exhausted` → 직전 I(`I.possibility`) |
| 원시 행동 / 기록 능력 | read, write(탐침 범위), execute, spawn / observe, propose |
| 필수 원시 행동 | read, execute |
| 고유 제안 | `probe_definition`, `agreement_draft`, `probe_verdict` |
| 합의 | 탐침 묶음 합의(`probe_batch`). 모든 탐침이 쓰기 없이 Helm 저장 공간만 쓰면 합의를 생략한다 |
| WorkUnit | `draft_agreement`(once: 탐침 정의 + 묶음 합의 초안) → `probe`(per_probe, fresh, 동시 실행은 설정 `maxConcurrentPerConcern` 이하) |
| 사람 접점 | `agreement_confirm`(탐침 묶음 합의, 권리, 필수, C/A 상한에 셈) |
| 기본 전달 | 예약(라운드 경계) |
| OPD+C | O `opdc:o.probes`(가설, 키울·접을 조건, 예산, 진행) / D `opdc:d.stop_probe` |
| 예산 | WorkUnit 6, 하위 호출 30, 120분 |
| 성숙도 | L3 |
| 방법 | PDSA, Cynefin(탐침 → 감지 → 대응), 가역·비가역 판단(탐침 우선) |

탐침 판정 계산: 조건마다 `evaluator`가 `code`면 코드가 관찰 값으로 계산하고, `model`이면 모델의 `probe_verdict` 선언을 받고, `human`이면 정보 게이트 질문을 만든다. 탐침 하나라도 키울 조건을 만족하면 `grow`가 우선한다.

판정 값은 08·09 이름으로 기록한다. 탐침 하나의 판정은 `probe.concluded.outcome`(`grown`, `folded`, `inconclusive`, `exhausted`), 지속 관찰 판정은 `watch.judged.outcome`(`stable`, `regressed`, `inconclusive`)이다. 루프 종료 결과(`ExitOutcome`)는 이 값들에서 계산한다: 탐침 중 `grown`이 하나라도 있으면 `grow`, 모두 `folded`면 `fold`, 남은 것이 `inconclusive`면 `inconclusive`, 활성화 예산 소진이나 모든 탐침 `exhausted`면 `budget_exhausted`. 지속 관찰은 `stable` → `grow`, `regressed` → `fold`, `inconclusive`이고 연장이 남으면 `continue`, 연장을 다 쓰면 `watch_verdict` 접점이다.

```ts
// 탐침과 지속 관찰의 조건 형식. Probe 레코드의 최종 스키마는 08이 소유한다(이 필드들을 요구).
export interface Condition {
  id: string;
  description: string;                 // 사람이 읽는 문장
  signal: string;                      // 관찰할 신호 이름(예: "user_continue_intent", "lcp_ms")
  op: "gte" | "lte" | "eq" | "observed" | "declared";
  value?: number | string | boolean;
  evaluator: "code" | "model" | "human";
}
export interface ProbeSpec {
  hypothesis: string;
  growWhen: readonly Condition[];      // 하나라도 참이면 키움
  foldWhen: readonly Condition[];      // 하나라도 참이면 접음
  budget: { subcalls: number; wallMinutes: number };
  writesTarget: boolean;               // 작업 대상을 바꾸는가(합의 필요 여부)
}
export interface WatchSpec {
  signals: readonly { name: string; source: "tool" | "human" | "external"; sampler?: string }[];
  period: { untilEpochMs: number } | { boundaries: number };
  sampleEveryMs?: number;              // 없으면 기간 끝에 한 번
  growWhen: readonly Condition[];
  foldWhen: readonly Condition[];
  maxExtensions: number;               // 기본 2
}
```

**C.emergency**

| 항목 | 내용 |
|---|---|
| 목표 | 혼돈 상황에서 미리 맺어 둔 비상 합의 범위 안의 행동으로 먼저 안정시킨다(v0.3 03 §3.3) |
| 핵심 질문 | 피해를 멈추는 가장 작은 행동은 무엇인가 / 그 행동이 비상 합의 범위 안인가 / 안정됐는가 |
| 단계 | Execute |
| 입력 | concern, recent_observations, agreement(비상 합의) |
| 출력 | workunit(변경), observation, choice(혼자 정한 선택), 안정화 보고 |
| 진입 | `agreement.standingMatches(kind=emergency)`. 상황 판정 하나만으로는 참이 되지 않는다: 비상 합의의 `match` 조건이 서로 다른 출처(관찰의 출처 키가 다른 것) 근거 2개 이상, 또는 사람 출처 관찰 1개로 충족돼야 한다. 모델이 쓴 근거나 같은 출처의 반복은 하나로 센다. 거짓이면 `emergency_authorization` 접점(권리, 즉시) |
| 종료 → 다음 | `stabilized` → `O`(재판정) / `scope_exceeded` → 대기(human, 즉시) / `budget_exhausted` → 대기(human, 즉시) |
| 원시 행동 / 기록 능력 | 비상 합의가 허용한 원시 행동(보통 read, write, execute) / observe, propose |
| 필수 원시 행동 | read |
| 고유 제안 | `stabilization_report`, `autonomous_choice` |
| 합의 | 상시 비상 합의(`standing_emergency`) |
| WorkUnit | `stabilize`(once, fresh) |
| 사람 접점 | 비상 합의가 있으면 없음. 없으면 `emergency_authorization` |
| 기본 전달 | 범위 안은 묻지 않음, 범위 밖은 즉시 |
| 부수 효과 | 활성화 시 루프 계획 끝에 `A.reflect`(사후 검토)를 필수 단계로 넣는다. 비상 합의가 적용되는 순간 사람에게 `interrupt` 강도 알림을 보낸다(11에 전달 요청, 질문이 아닌 알림). 사람은 알림에서 바로 중지할 수 있다 |
| OPD+C | O `opdc:o.emergency_scope_and_actions` / P `opdc:p.stabilization_criteria` |
| 예산 | WorkUnit 3, 하위 호출 10, 30분 |
| 성숙도 | L3 |
| 방법 | ICS, HRO, Resilience Engineering |

상시 합의(비상 합의 포함)의 형식. 이 문서의 "상시 합의"는 08 Grant(사람이 미리 맡겨 둔 권한)다. 화면 이름은 "맡겨 둔 권한", 비상용은 "비상 합의"다([판정 J-116], 05). 레코드 스키마와 활성화 검증(인스턴스 범위 ⊆ 템플릿 범위)은 08·10이 소유하고, 이 문서는 오케스트레이터가 읽는 필드를 요구한다.

```ts
export interface StandingAgreementTemplate {
  id: string;                          // 08이 접두사를 정한다
  kind: "emergency" | "procedure";
  trigger: {
    situation?: SituationType;         // emergency는 "chaotic"
    concernKind?: string;              // 절차(procedure)가 적용되는 Concern 종류
    match: readonly Condition[];       // 예: signal "prod_error_rate" gte 0.05
  };
  agreement: {                         // 작업 합의 여섯 항목(브리프 §6)
    purpose: string;
    criteria: readonly string[];
    scope: unknown;                    // 범위 표현은 08·13
    forbidden: readonly string[];
    evidence: readonly string[];
    stopConditions: readonly string[];
  };
  allowedPrimitives: readonly Primitive[];
  stabilizedWhen?: readonly Condition[];   // emergency만
  confirmedBy: "human";
  confirmedAtMs: number;
  reviewAfterUse: boolean;             // emergency는 항상 true
}
```

#### 3.6.8 A.confirm 확인형 A

| 항목 | 내용 |
|---|---|
| 목표 | 결과가 명세대로 만들어졌는지 근거로 확인하고(결과 확인), 다른 관점·화면·작업에서도 맞는지 반영한다(전체 반영)(v0.3 03 §3.4) |
| 핵심 질문 | 왜 이 결과를 받아들여도 되나 / 명세대로 만들었는지와 올바른 것을 만들었는지 모두 확인했나 / 다른 작업의 전제와 기준선을 깨뜨렸나 / 환경이 바뀌면 어떻게 복구하고 결정을 다시 여나(canon §15.3 A) |
| 단계 | Assure, Integrate |
| 입력 | agreement, criteria, submission, evidence, counter_evidence, preference_model(취향형), obligations, predictions(도래한 것) |
| 출력 | 검증 에이전트의 counter_evidence·attestation, acceptance(사람), obligation(반영 항목, 커널), agreement(반영 범위, 결과 확인과 같은 트랜잭션), workunit(반영), question |
| 진입 | `submission.exists`. 거짓이면 `submission_missing` 접점. 오케스트레이터는 A.confirm으로 옮기기 전에 직전 C의 `submit` WorkUnit을 먼저 돌려 이 경우를 피한다(§3.9.4 규칙 2) |
| 종료 → 다음(앞이 우선) | `criteria_wrong`(사람이 "기준이 틀림") → 유형별: complex → `I.want`, 그 밖 → `I.fact` / `rejected_unresolved`("해결되지 않음") → 직전 I. 직전 I가 없으면 사람이 C 또는 I를 고른다(J-24) / `revision_requested` → `C.commit`(합의 유지, 진행 중으로) / `accepted_integrated`(결과 확인 + 반영 항목 모두 처리·미룸) → 계획(보통 `A.reflect` 또는 닫기) |
| 원시 행동 / 기록 능력 | 작업 에이전트: read, execute, spawn, write(반영 범위) / observe, propose. 검증 에이전트: read, execute, spawn / observe, propose(반대 근거만), attest |
| 필수 원시 행동 | read |
| 고유 제안 | `counter_evidence`, `attest`, `obligation_resolution`, `obligation_deferral` |
| 평면 | N 제안(결과 확인은 사람이 씀), E 제안(근거·반대 근거), M 읽기, 반영 범위 안 쓰기 |
| 합의 | 결과 확인에는 필요 없음. 반영 WorkUnit이 작업 대상을 바꾸면 반영 범위 합의가 필요하다(`integration`). 작업 에이전트가 결과를 제출할 때 반영 범위 초안을 함께 싣고(08 `ResultSubmission.integrationAgreementDraft`), 결과 확인 화면은 그 범위를 구조 값으로 접지 않고 보인다(04). 사람이 `result.accept`(accepted·conditional)에 `integrationAgreement`를 실어 보내면 커널이 같은 트랜잭션에서 `agreement.confirmed`(via 결과 확인)를 낸다 [판정 J-126]. 그래서 반영 범위 확정은 결과 확인과 같은 조작이고 C/A 상한(2회)을 넘지 않는다(§3.13.7). 사람이 반영 범위를 빼고 확인하면 반영 항목은 쓰기 없는 처리(미루기, 다른 Concern으로 넘기기)만 할 수 있다 |
| WorkUnit | `verify`(once, fresh, 역할 verifier, 작업자와 다른 모델 권장. 다이얼 `independentVerification`이 꺼짐이면 생략) → (사람 결과 확인) → `integrate`(per_obligation, fresh). 검증 run은 다른 WorkUnit과 같은 경로로만 시작한다: 오케스트레이터가 A.confirm 진입 뒤 `verify` WorkRequest를 스케줄러에 넣고, 스케줄러가 동시 실행 상한 안에서 허가한다. 커널 지시 `agent.request(verifier)`로 시작하는 경로는 쓰지 않는다(10에 요구, §5.2). 커널은 독립 검증이 요구되는 결과에 검증 기록(attestation 또는 "검증 실패" 표시)이 없으면 결과 확인 질문을 내지 않는다 |
| 사람 접점 | `result_review`(권리, 필수, C/A 상한에 셈). 답(08 `AcceptanceDecision`): `accepted` / `conditional` / `revision_requested` / `rejected` / `criteria_wrong`. 사람은 19 `result.accept` 하나로 답한다([판정 J-123], [판정 J-124]). 조건 붙여 확인의 조건은 같은 트랜잭션에서 미룬 항목(`deferred`, 다시 볼 조건 = 조건 문장)이 된다([판정 J-125]) |
| 기본 전달 | 즉시(결과 확인은 사람의 권리) |
| OPD+C | O `opdc:o.criteria_coverage`(기준별 충족/미충족/확인 못함과 근거), `opdc:o.counter_evidence`(반대 근거는 접지 않음, A9), `opdc:o.obligations` / C `opdc:c.reopen` |
| 예산 | WorkUnit 6, 하위 호출 20, 90분 |
| 성숙도 | L4 |
| 방법 | Assurance Cases, NASA Systems Engineering, HRO, Speech Acts |

- 결과 확인은 사람만 한다(A6). 이유는 두 가지다: 결과를 받아들이는 것은 책임을 지는 일이고, 작업한 모델이 자기 결과를 확인하면 같은 착각을 같은 방식으로 반복한다(대화 L3069, X3-9-23~24).
- 취향형 작업(상황 유형 complex, 선호 모델이 기준인 합의)의 결과 확인은 선호 모델과의 일치를 사용자가 판정하는 것이다. 불일치면 `criteria_wrong`으로 원함 탐구로 돌아간다(v0.3 03 §3.4).
- 탐구만 하는 Concern(쓰기 없음)도 "완료"로 닫으려면 A.confirm을 지난다(의존 규칙 2). 이때 제출물은 I 계열의 `deliberate` WorkUnit이 낸 탐구 결과 제출이다(08에 "합의 없는 탐구 결과 제출" 요구, §5.2).
- 반영 항목은 세 종류다: 관련 문서·테스트, 이 결과가 깨뜨린 이전 선택·전제, 다른 열린 Concern과의 충돌(X3-2-14). 모두 처리하거나 명시적으로 미루기 전까지 Concern은 "결과 확인됨"이고 "완료"가 아니다(A10).

#### 3.6.9 A.watch 지속 관찰형 A

| 항목 | 내용 |
|---|---|
| 목표 | 내보낸 결과나 탐침 결과를 정해진 기간 지켜보며 키우기·접기·계속을 정한다(v0.3 03 §3.4) |
| 핵심 질문 | 어떤 신호를 얼마 동안 보나 / 잘되는 쪽과 안 되는 쪽은 무엇인가 / 계속 볼 가치가 있나 |
| 단계 | Assure |
| 입력 | watch_spec, probes, predictions, recent_observations, preference_model |
| 출력 | observation(표본), choice(판정), question |
| 진입 | 조건 없음. 지속 관찰 명세가 없으면 첫 WorkUnit이 명세를 제안한다 |
| 종료 → 다음 | `grow` → `C.commit` / `fold` → 직전 I(`I.possibility`) / `continue`(기간 끝, 판정 조건 미충족, 연장 남음) → 머무름(연장) / 연장을 다 쓰면 `watch_verdict` 접점 |
| 원시 행동 / 기록 능력 | read, execute(측정) / observe, propose |
| 필수 원시 행동 | read |
| 고유 제안 | `watch_spec`, `watch_verdict` |
| 합의 | 필요 없음 |
| WorkUnit | (명세 없을 때) `deliberate`(once, `watch_spec`) → `watch_sample`(per_sample, fresh, cheap) |
| 상태 | 표본 사이에는 실행 중인 WorkUnit이 없다. Concern은 `waiting(watch)`이고 타이머가 다음 표본을 깨운다 |
| 사람 접점 | `watch_verdict`(정보, 판정이 모호하거나 연장을 다 썼을 때) |
| 기본 전달 | 예약 |
| OPD+C | O `opdc:o.watch_signals` / P `opdc:p.watch_period_and_criteria` |
| 예산 | WorkUnit 10, 하위 호출 10, 표본당 10분 |
| 성숙도 | L4 |
| 방법 | Management by Exception, Resilience Engineering, HRO, PDSA |

#### 3.6.10 A.reflect 돌아보기

| 항목 | 내용 |
|---|---|
| 목표 | 다음에 무엇을 다르게 할지 남기고, 컨텍스트·합의 템플릿·다이얼·절차 변경을 제안한다 |
| 핵심 질문 | 무엇이 예상과 달랐나 / 어떤 사람 조작이 필요 없었나 / 다음 합의에서 무엇을 바꿀까 / 같은 방식으로 반복해서 풀린 일인가(절차 후보) |
| 단계 | Reflect |
| 입력 | transitions, contests, rejections, human_ops, autonomous_decisions, agreement, submission, predictions(예측과 실제) |
| 출력 | reflection, change_proposal(합의 템플릿, 다이얼 조정, 절차 후보, 비상 합의 수정) |
| 진입 | 조건 없음 |
| 종료 → 다음 | `reflected`(`reflection.complete`) → 계획(보통 닫기) / `budget_exhausted` → 계획("돌아보기 못함"을 기록) |
| 원시 행동 / 기록 능력 | read, spawn / observe, propose |
| 필수 원시 행동 | read |
| 고유 제안 | `reflection`, `change_proposal` |
| 합의 | 필요 없음 |
| WorkUnit | `reflect`(once, fresh, cheap) |
| 사람 접점 | 없음. 변경 제안은 제안함으로 예약 전달되고 채택은 사람이 한다(관찰 에이전트의 제안과 같은 경로, 16) |
| OPD+C | O `opdc:o.reflection_and_proposals` |
| 예산 | WorkUnit 1, 하위 호출 4, 10분 |
| 성숙도 | L5 |
| 방법 | Reflective Practice, Resilience Engineering, Activity Theory, PDSA |

종료 조건은 "변경 제안이 하나 이상 있거나, 변경 없음과 그 이유가 있다"이다. 원전 법칙 12("Reflection은 다음 Context, Contract, Policy를 실제로 바꿔야 한다", canon §15.15)를 그대로 강제하면 바꿀 것이 없는 Concern도 억지로 제안을 만들게 된다. 그래서 "변경 없음 + 이유"를 허용하고, 실제 변경 채택률은 16이 지표로 본다. 잘된 적응(성공한 local adaptation)도 돌아보기에 기록한다(canon-3 G10).

#### 3.6.11 S 구조 루프

S의 일곱 동작은 공통 형식을 가진다: 원시 행동 read / 기록 능력 observe, propose / 평면 N(Concern 트리) 제안 / 합의 필요 없음 / WorkUnit `structure`(once, fresh) / 기본 전달 예약 / OPD+C O `opdc:o.tree_and_boundary`, C `opdc:c.contest_structure` / 방법 Viable System Model, ICS, NASA Systems Engineering. 구조 동작은 모두 혼자 정한 결정으로 기록되고 이의를 걸 수 있다(v0.3 03 §4.3-5).

| 식별자 | 하는 일 | 진입 조건 | 종료 → 다음 | 성숙도 |
|---|---|---|---|---|
| `S.split` | Concern을 하위 Concern 여럿으로 나누고 경계 항목을 기록한다 | 없음 | `children_created`(`structure.withinLimits`) → 상위는 대기(children), 하위마다 `O` / 상한 초과 → `structure_limit` 접점 | L2 |
| `S.merge` | 여러 Concern을 하나로 합친다. 나머지는 superseded로 닫힌다 | 합칠 Concern에 실행 중인 WorkUnit이 없음(있으면 다음 작업 경계까지 기다림) | `structured` → 합친 Concern은 `O`(재판정) | L2 |
| `S.detach` | 하위 Concern을 상위에서 떼어 독립 Concern으로 만든다(Goal 연결은 유지) | 없음 | `structured` → 떼어 낸 Concern은 `O`, 상위는 돌아감(`return`) | L2 |
| `S.relocate` | Concern을 다른 Goal 아래로 옮긴다 | 대상 Goal이 있음 | `structured` → 돌아감(`return`) | L2 |
| `S.recombine` | 하위 Concern들의 결과와 경계 항목을 모아 상위의 결과 제출을 만든다 | `children.allTerminal` | `structured` → `A.confirm`(상위의 재조합 결과 확인, 의존 규칙 4) | L4 |
| `S.hold` | 지금 다루지 않기로 하고 다시 볼 조건을 건다 | 없음 | `structured` → 대기(held). `revisit.met`이면 `O` | L2 |
| `S.close` | 완료가 아닌 종료(포기, 대체됨, 범위 밖, 질문만 답함) | `children.allTerminal` 또는 사람의 명시적 닫기(의존 규칙 4 예외) | `closed` → 닫기(not_completed) | L2 |

S 규칙(v0.3 03 §4.3 + 이 문서의 수치 [제안]):

1. 하위 Concern은 상위와 Goal 연결을 잃지 않는다(A1). `S.detach` 뒤에도 Goal 연결은 유지된다.
2. 상위는 하위가 모두 끝나고 `S.recombine` → `A.confirm`을 지나야 "완료"로 닫힌다(의존 규칙 4 [제안]). 사람이 명시적으로 닫으면 예외다(그 경우 `S.close`, 결과는 not_completed).
3. 하위의 상황 유형은 따로 판정한다(하위마다 `O`).
4. 나눌 때 경계 항목(공유 전제, 서로 영향을 주는 결정)을 하나 이상 기록하거나 "경계 항목 없음"과 이유를 기록한다. 하위의 투영에는 상위 Goal과 경계 항목이 항상 들어간다(맥락 소실 방지, v0.3 03 §4.4).
5. 상한: 한 Concern의 직접 하위 수 `maxChildren` 기본 7, 트리 깊이 `maxDepth` 기본 3(08 `structure.max_children`, `structure.max_depth`와 같은 값, §3.20.1). 넘으면 `structure_limit` 접점(정보 게이트, 협상)을 연다. 숫자는 설정으로 바꿀 수 있다(ICS 규칙 6, canon-3 C3). 7과 3은 ICS의 관리 가능 범위(3~7) 안의 시작값이다 [지식].
6. 병합 대상 Concern이 서로 다른 Goal에 있으면 병합 전에 `S.relocate`를 먼저 제안한다.

경계 항목은 08 §3.6.3 `BoundaryItem`(`boundaryKind`: `shared_premise`, `interacting_decision`, `interface`, `other`, 상태 `open`·`checked`·`dropped`, 09 `boundary_item.recorded`·`checked`·`dropped`)을 그대로 쓴다.

`S.recombine`의 WorkUnit은 경계 항목을 하나씩 확인해 `checked`(근거 `checkedRefs`)를 제안하거나, 깨졌으면 재조합 결과 제출의 미충족 기준과 반영 항목(`boundary_check`)으로 남긴다. 08에 `violated` 상태는 없다.

#### 3.6.12 계약 데이터 예시

두 계약을 데이터 형식 그대로 적는다. 나머지 16개는 §3.6.1~§3.6.11의 표를 같은 형식으로 옮긴다.

```ts
// packages/kernel/src/orchestration/contracts/catalog/c-commit.ts
import type { LoopContract } from "../types.js";

export const C_COMMIT: LoopContract = {
  id: "C.commit",
  family: "C",
  nameKo: "약속형 C",
  goal: "정한 것을 작업 합의 범위 안에서 실행하고 결과를 기준별 근거와 함께 제출한다",
  coreQuestions: [
    "누가 무엇을 왜 맡았나",
    "무엇을 스스로 정할 수 있나",
    "완료를 어떤 근거로 주장해야 하나",
    "어떤 조건에서 방향을 바꾸거나 위로 올려야 하나",
  ],
  steps: ["commit", "execute", "assure"],
  workUnits: [
    {
      purpose: "draft_agreement", step: "commit", kind: "change", context: "fresh", repeat: "once",
      primitives: ["read"], proposalKinds: ["agreement_draft", "question"],
      role: "work", modelHint: "default",
      skipWhen: [{ name: "agreement.active" }, { name: "agreement.draftPending" }],
    },
    {
      purpose: "execute", step: "execute", kind: "change", context: "resume", repeat: "once",
      role: "work", modelHint: "default",
    },
    {
      purpose: "submit", step: "assure", kind: "change", context: "resume", repeat: "once",
      primitives: ["read"], proposalKinds: ["result_submission", "question"],
      role: "work", modelHint: "default",
      skipWhen: [{ name: "submission.missingAfterWrite", negate: true }],
    },
  ],
  inputs: ["goal", "criteria", "findings", "possibilities", "preference_model", "agreement", "procedure"],
  outputs: ["agreement", "workunit", "observation", "choice", "result", "question"],
  entry: { requires: [{ name: "concern.hasGoal" }], onUnmet: { kind: "redirect", to: "O" } },
  exit: [
    { outcome: "scope_exceeded", when: [{ name: "scope.exceededEvent" }], next: { kind: "wait", reason: "human" } },
    { outcome: "stop_condition_met", when: [{ name: "stopCondition.met" }], next: { kind: "wait", reason: "human" } },
    { outcome: "submitted", when: [{ name: "submission.exists" }], next: { kind: "loop", to: "A.confirm" } },
    { outcome: "budget_exhausted", when: [{ name: "budget.exhausted" }], next: { kind: "wait", reason: "human" } },
  ],
  capabilities: {
    primitives: ["read", "write", "execute", "spawn", "ask", "send"],
    records: ["observe", "propose"],
  },
  requiredPrimitives: ["read", "write"],
  proposalKinds: [
    "agreement_draft", "autonomous_choice", "result_submission", "split_hint",
    "transition_request", "question", "goal_revise",
  ],
  planes: { N: "propose", E: "read", M: "write_in_scope" },
  agreement: "active",
  context: {
    include: ["goal", "concern", "agreement", "choices", "criteria", "findings", "assumptions",
              "open_questions", "recent_observations", "procedure", "boundary_items"],
    exclude: ["recent_reactions", "stimuli"],
  },
  humanTouchpoints: [
    { kind: "agreement_confirm", gate: "rights", requiredForExit: true, countsTowardCaCap: true },
    { kind: "scope_change", gate: "rights", requiredForExit: true, countsTowardCaCap: false },   // 정상 경로 밖(01 R-OP-4)
    { kind: "send_approval", gate: "rights", requiredForExit: true, countsTowardCaCap: false },
    { kind: "submission_missing", gate: "information", requiredForExit: false, countsTowardCaCap: false },
  ],
  opdc: {
    observability: ["opdc:o.agreement"],
    predictability: ["opdc:p.stop_conditions"],
    directability: ["opdc:d.edit_agreement"],
    contestability: ["opdc:c.scope_challenge"],
  },
  budgetDefaults: { workUnits: 4, subcalls: 20, wallMinutes: 120 },
  maturityLevel: 3,
  methods: ["Mission Command", "Speech Acts", "Management by Exception", "WHO Surgical Checklist"],
};
```

```ts
// packages/kernel/src/orchestration/contracts/catalog/a-confirm.ts
export const A_CONFIRM: LoopContract = {
  id: "A.confirm",
  family: "A",
  nameKo: "확인형 A",
  goal: "결과가 명세대로 만들어졌는지 근거로 확인하고 다른 관점·작업에서도 맞는지 반영한다",
  coreQuestions: [
    "왜 이 결과를 받아들여도 되나",
    "명세대로 만들었는지와 올바른 것을 만들었는지 모두 확인했나",
    "다른 작업의 전제와 기준선을 깨뜨렸나",
    "환경이 바뀌면 어떻게 복구하고 결정을 다시 여나",
  ],
  steps: ["assure", "integrate"],
  workUnits: [
    {
      purpose: "verify", step: "assure", kind: "inquiry", context: "fresh", repeat: "once",
      primitives: ["read", "execute", "spawn"], proposalKinds: ["counter_evidence", "attest"],
      role: "verifier", modelHint: "different_from_worker",
      skipWhen: [{ name: "dial.equals", params: { dial: "independentVerification", value: "off" } }],
    },
    {
      purpose: "integrate", step: "integrate", kind: "integration", context: "fresh", repeat: "per_obligation",
      primitives: ["read", "write", "execute"],
      proposalKinds: ["obligation_resolution", "obligation_deferral", "question"],
      role: "work", modelHint: "default",
    },
  ],
  inputs: ["agreement", "criteria", "submission", "evidence", "counter_evidence",
           "preference_model", "obligations", "predictions"],
  outputs: ["observation", "attestation", "acceptance", "obligation", "agreement", "workunit", "question"],
  entry: { requires: [{ name: "submission.exists" }], onUnmet: { kind: "touchpoint", touchpoint: "submission_missing" } },
  exit: [
    { outcome: "criteria_wrong", when: [{ name: "acceptance.verdict", params: { verdict: "criteria_wrong" } }],
      next: { kind: "reopenTo" } },          // 사람이 고른 acceptance.reopenTo(화면 기본값: complex면 I.want, 아니면 I.fact)
    { outcome: "rejected_unresolved", when: [{ name: "acceptance.verdict", params: { verdict: "rejected" } }],
      next: { kind: "reopenTo" } },          // 화면 기본값: 직전 I. 직전 I가 없으면 사람이 C 또는 I를 고른다(J-24)
    { outcome: "revision_requested", when: [{ name: "acceptance.verdict", params: { verdict: "revision_requested" } }],
      next: { kind: "loop", to: "C.commit" } },
    { outcome: "accepted_integrated",
      when: [{ name: "acceptance.verdict", params: { verdict: ["accepted", "conditional"] } },
             { name: "obligations.allClosed" }],
      next: { kind: "plan" } },
  ],
  capabilities: { primitives: ["read", "execute", "spawn", "write"], records: ["observe", "propose", "attest"] },
  requiredPrimitives: ["read"],
  proposalKinds: ["counter_evidence", "attest", "obligation_resolution", "obligation_deferral",
                  "transition_request", "question", "goal_revise"],
  planes: { N: "propose", E: "propose", M: "write_in_scope" },
  agreement: "integration",
  context: { include: ["goal", "agreement", "choices", "criteria", "submission", "evidence", "counter_evidence",
                       "obligations", "preference_model", "boundary_items"] },
  humanTouchpoints: [
    { kind: "result_review", gate: "rights", requiredForExit: true, countsTowardCaCap: true },
  ],
  opdc: {
    observability: ["opdc:o.criteria_coverage", "opdc:o.counter_evidence", "opdc:o.obligations"],
    predictability: [],
    directability: [],
    contestability: ["opdc:c.reopen"],
  },
  budgetDefaults: { workUnits: 6, subcalls: 20, wallMinutes: 90 },
  maturityLevel: 4,
  methods: ["Assurance Cases", "NASA Systems Engineering", "HRO", "Speech Acts"],
};
```

`dial.equals`는 해석된 다이얼 값을 비교하는 조건이다(§3.5.4 표에 더한다). 검증 WorkUnit의 생략 여부는 `independentVerification`이 `auto`일 때 `proofBurden === "heavy"`이면 실행으로 해석한다(§3.11.2).

나머지 16개 계약의 실행에 쓰이는 부분(진입, 종료, 능력, WorkUnit, 사람 접점, 예산)을 같은 형식으로 적는다. 사람이 읽는 필드(`goal`, `coreQuestions`, `methods`, `nameKo`)와 OPD+C 의무는 §3.6.1~§3.6.11 표에서 그대로 옮긴다. 종료 조건의 OR는 `anyOf`로 적는다(§3.5.2 `ExitOutcomeSpec.when`).

```ts
// packages/kernel/src/orchestration/contracts/catalog/core.ts
const P = (name: PredicateName, params?: PredicateRef["params"]): PredicateRef => ({ name, params });
const W = (purpose: WorkUnitPurpose, step: StepId, kind: WorkUnitKind, context: WorkUnitTemplate["context"],
           repeat: WorkUnitTemplate["repeat"], extra: Partial<WorkUnitTemplate> = {}): WorkUnitTemplate =>
  ({ purpose, step, kind, context, repeat, role: "work", modelHint: "default", ...extra });
const T = (kind: HumanTouchpointKind, gate: "rights" | "information", requiredForExit: boolean, countsTowardCaCap: boolean): TouchpointSpec =>
  ({ kind, gate, requiredForExit, countsTowardCaCap });
const notDisorder: EntrySpec = { requires: [{ name: "situation.is", params: { types: ["disorder"] }, negate: true }],
                                 onUnmet: { kind: "redirect", to: "S.split" } };
const I_EXITS = (stopNext: NextHint, budgetNext: NextHint): ExitOutcomeSpec[] => [
  { outcome: "reframe_needed", when: [P("structure.opRecorded")], next: { kind: "loop", to: "S.split" } },
  { outcome: "stop_rule_met", when: [P("inquiry.stopRuleMet")], next: stopNext },
  { outcome: "autonomy_exhausted", when: [P("autonomy.exhausted")], next: { kind: "wait", reason: "human" } },
  { outcome: "budget_exhausted", when: [{ anyOf: [P("budget.exhausted"), P("inquiry.roundsReached")] }], next: budgetNext },
];

export const CONTRACT_CORE: Record<Exclude<LoopId, "C.commit" | "A.confirm">, Partial<LoopContract>> = {
  "O": {
    entry: { requires: [], onUnmet: { kind: "reject" } },
    exit: [
      { outcome: "disorder", when: [{ anyOf: [P("assessment.failedTimes", { n: 2 }), P("situation.is", { types: ["disorder"] })] }],
        next: { kind: "loop", to: "S.split" } },
      { outcome: "planned", when: [P("situation.assessedSinceActivation"), P("plan.recordedSinceActivation")], next: { kind: "plan" } },
      { outcome: "budget_exhausted", when: [P("budget.exhausted")], next: { kind: "loop", to: "S.split" } },
    ],
    capabilities: { primitives: ["read", "spawn", "ask"], records: ["observe", "propose"] }, requiredPrimitives: ["read"],
    workUnits: [W("assess", "sense", "inquiry", "fresh", "once")],
    humanTouchpoints: [], budgetDefaults: { workUnits: 2, subcalls: 6, wallMinutes: 10 }, agreement: "none",
  },
  "I.fact": {
    entry: notDisorder, exit: I_EXITS({ kind: "plan" }, { kind: "plan" }),
    capabilities: { primitives: ["read", "execute", "spawn", "ask"], records: ["observe", "propose"] }, requiredPrimitives: ["read"],
    workUnits: [W("diverge", "diverge", "inquiry", "fresh", "once"), W("investigate", "investigate", "inquiry", "resume", "per_round"),
                W("deliberate", "deliberate", "inquiry", "resume", "once")],
    humanTouchpoints: [T("finding_confirm", "information", false, false)],
    budgetDefaults: { rounds: 3, workUnits: 12, subcalls: 24, wallMinutes: 60 }, agreement: "none",
  },
  "I.want": {
    entry: notDisorder, exit: I_EXITS({ kind: "plan" }, { kind: "plan" }),
    capabilities: { primitives: ["read", "spawn", "ask"], records: ["observe", "propose"] }, requiredPrimitives: ["read", "ask"],
    workUnits: [W("elicit", "elicit", "inquiry", "resume", "per_round"), W("deliberate", "deliberate", "inquiry", "resume", "once")],
    humanTouchpoints: [T("stimulus_round", "information", false, false), T("criterion_confirm", "information", false, false)],
    budgetDefaults: { rounds: 4, workUnits: 8, subcalls: 24, wallMinutes: 60 }, agreement: "none",
  },
  "I.possibility": {
    entry: notDisorder, exit: I_EXITS({ kind: "plan" }, { kind: "plan" }),
    capabilities: { primitives: ["read", "execute", "spawn", "ask"], records: ["observe", "propose"] }, requiredPrimitives: ["read"],
    workUnits: [W("diverge", "diverge", "inquiry", "fork", "per_round"), W("investigate", "investigate", "inquiry", "resume", "per_round"),
                W("deliberate", "deliberate", "inquiry", "resume", "per_round")],
    humanTouchpoints: [], budgetDefaults: { rounds: 2, workUnits: 10, subcalls: 30, wallMinutes: 60 }, agreement: "none",
  },
  "I.outcome": {
    entry: { requires: [], onUnmet: { kind: "reject" } },
    exit: I_EXITS({ kind: "plan" }, { kind: "plan" }).filter(e => e.outcome !== "reframe_needed"),
    capabilities: { primitives: ["read", "execute", "spawn", "ask"], records: ["observe", "propose"] }, requiredPrimitives: ["read"],
    workUnits: [W("investigate", "investigate", "inquiry", "resume", "per_round"), W("deliberate", "deliberate", "inquiry", "resume", "once")],
    humanTouchpoints: [], budgetDefaults: { rounds: 2, workUnits: 6, subcalls: 16, wallMinutes: 45 }, agreement: "none",
  },
  "C.probe": {
    entry: { requires: [P("concern.hasGoal")], onUnmet: { kind: "redirect", to: "O" } },
    exit: [
      { outcome: "grow", when: [P("probe.anyGrow")], next: { kind: "loop", to: "C.commit" } },
      { outcome: "fold", when: [P("probe.allFold")], next: { kind: "lastOfFamily", family: "I", fallback: "I.possibility" } },
      { outcome: "inconclusive", when: [P("probes.defined"), { name: "probe.anyGrow", negate: true }, { name: "probe.allFold", negate: true }],
        next: { kind: "plan" } },                                   // 탐침 WorkUnit이 모두 끝난 뒤에만 평가(§3.16.2)
      { outcome: "budget_exhausted", when: [P("budget.exhausted")], next: { kind: "lastOfFamily", family: "I", fallback: "I.possibility" } },
    ],
    capabilities: { primitives: ["read", "write", "execute", "spawn"], records: ["observe", "propose"] }, requiredPrimitives: ["read", "execute"],
    workUnits: [W("draft_agreement", "commit", "probe", "fresh", "once", { primitives: ["read"], skipWhen: [P("agreement.active")] }),
                W("probe", "execute", "probe", "fresh", "per_probe")],
    humanTouchpoints: [T("agreement_confirm", "rights", true, true)],
    budgetDefaults: { workUnits: 6, subcalls: 30, wallMinutes: 120 }, agreement: "probe_batch",
  },
  "C.emergency": {
    entry: { requires: [P("agreement.standingMatches", { kind: "emergency" })], onUnmet: { kind: "touchpoint", touchpoint: "emergency_authorization" } },
    exit: [
      { outcome: "scope_exceeded", when: [P("scope.exceededEvent")], next: { kind: "wait", reason: "human" } },
      { outcome: "stabilized", when: [P("emergency.stabilized")], next: { kind: "loop", to: "O" } },
      { outcome: "budget_exhausted", when: [P("budget.exhausted")], next: { kind: "wait", reason: "human" } },
    ],
    capabilities: { primitives: ["read", "write", "execute"], records: ["observe", "propose"] }, requiredPrimitives: ["read"],
    workUnits: [W("stabilize", "execute", "change", "fresh", "once")],
    humanTouchpoints: [T("emergency_authorization", "rights", true, false)],
    budgetDefaults: { workUnits: 3, subcalls: 10, wallMinutes: 30 }, agreement: "standing_emergency",
  },
  "A.watch": {
    entry: { requires: [], onUnmet: { kind: "reject" } },
    exit: [
      { outcome: "grow", when: [P("watch.growMet")], next: { kind: "loop", to: "C.commit" } },
      { outcome: "fold", when: [P("watch.foldMet")], next: { kind: "lastOfFamily", family: "I", fallback: "I.possibility" } },
      { outcome: "continue", when: [P("watch.periodEnded"), P("watch.extensionsLeft")], next: { kind: "wait", reason: "watch" } },
      { outcome: "inconclusive", when: [P("watch.periodEnded")], next: { kind: "wait", reason: "human" } },   // watch_verdict
    ],
    capabilities: { primitives: ["read", "execute"], records: ["observe", "propose"] }, requiredPrimitives: ["read"],
    workUnits: [W("deliberate", "assure", "inquiry", "fresh", "once", { skipWhen: [P("watch.specDefined")] }),
                W("watch_sample", "assure", "inquiry", "fresh", "per_sample", { modelHint: "cheap" })],
    humanTouchpoints: [T("watch_verdict", "information", false, false)],
    budgetDefaults: { workUnits: 10, subcalls: 10, wallMinutes: 10 }, agreement: "none",
  },
  "A.reflect": {
    entry: { requires: [], onUnmet: { kind: "reject" } },
    exit: [
      { outcome: "reflected", when: [P("reflection.complete")], next: { kind: "plan" } },
      { outcome: "budget_exhausted", when: [P("budget.exhausted")], next: { kind: "plan" } },
    ],
    capabilities: { primitives: ["read", "spawn"], records: ["observe", "propose"] }, requiredPrimitives: ["read"],
    workUnits: [W("reflect", "reflect", "inquiry", "fresh", "once", { modelHint: "cheap" })],
    humanTouchpoints: [], budgetDefaults: { workUnits: 1, subcalls: 4, wallMinutes: 10 }, agreement: "none",
  },
  // S 일곱 동작: 공통 능력·WorkUnit·예산, 진입과 종료만 다르다(§3.6.11)
  "S.split":     S({ entry: [], exit: [{ outcome: "children_created", when: [P("structure.opRecorded"), P("structure.withinLimits")], next: { kind: "wait", reason: "children" } }] }),
  "S.merge":     S({ entry: [], exit: [{ outcome: "structured", when: [P("structure.opRecorded")], next: { kind: "loop", to: "O" } }] }),
  "S.detach":    S({ entry: [], exit: [{ outcome: "structured", when: [P("structure.opRecorded")], next: { kind: "return" } }] }),
  "S.relocate":  S({ entry: [], exit: [{ outcome: "structured", when: [P("structure.opRecorded")], next: { kind: "return" } }] }),
  "S.recombine": S({ entry: [P("children.allTerminal")], exit: [{ outcome: "structured", when: [P("structure.opRecorded")], next: { kind: "loop", to: "A.confirm" } }] }),
  "S.hold":      S({ entry: [], exit: [{ outcome: "structured", when: [P("structure.opRecorded")], next: { kind: "wait", reason: "held" } }] }),
  "S.close":     S({ entry: [{ anyOf: [P("children.allTerminal"), P("directive.close")] }],
                     exit: [{ outcome: "closed", when: [P("structure.opRecorded")], next: { kind: "close", result: "not_completed" } }] }),
};
// S(): primitives ["read"], records ["observe", "propose"], workUnits [W("structure", "structure", "inquiry", "fresh", "once")],
//      humanTouchpoints [T("structure_limit", "information", false, false)], budget { workUnits: 1, subcalls: 4, wallMinutes: 10 }, agreement "none"
```

`P("directive.close")`(사람의 명시적 닫기)는 §3.5.4 표에 더하는 조건이다. 모드 여덟 개도 같은 방식으로 `MODE_CATALOG`에 둔다. §3.10.2 표의 각 행이 `ModeDefinition` 하나이고, `taste`와 `deliberate`는 아래 예시와 같으며 나머지 여섯은 표 값을 그대로 옮긴다(계획 템플릿 `by_situation` 또는 표의 순서, 다이얼은 표의 "다이얼(층 3)" 열을 `DialPatch`로). 지시문 템플릿(`instructions/*.md`)의 내용은 12 §3.5의 투영 섹션과 이 문서의 루프 목표·핵심 질문 문장으로 만들고, 문장 자체는 구현 단계에서 22의 재생 테스트로 고정한다.

### 3.7 상황 판정 [결정 6: 유형은 바뀌는 상태 / 제안: 계산 방법]

#### 3.7.1 판정 질문

모델은 유형을 직접 고르지 않는다. 고정된 판정 질문에 답하고 답마다 근거 레코드 id를 붙인다(결정 14, D6). 질문은 v0.3 05 §2의 판정 질문을 나눈 것이다.

| id | 질문 | 관련 유형 |
|---|---|---|
| `q.urgent_harm` | 지금 당장 무언가를 하지 않으면 피해가 커지는가 | chaotic |
| `q.no_time_for_cause` | 원인을 찾을 시간이 없는가 | chaotic |
| `q.done_before` | 이 작업을 전에 같은 방식으로 여러 번 했는가 | clear |
| `q.procedure_exists` | 정해진 절차나 스크립트가 있는가(절차 레지스트리 조회로 코드가 답을 채운다) | clear |
| `q.analysis_converges` | 시간을 들여 분석하면 정답에 가까운 답이 나오는가 | complicated |
| `q.expert_knows` | 이 분야의 전문가라면 답을 알 것인가 | complicated |
| `q.taste_or_reaction` | 정답이 사용자의 취향이나 다른 사람의 반응에 달려 있는가 | complex |
| `q.unpredictable` | 해 보기 전에는 결과를 예상할 수 없는가 | complex |
| `q.mixed_parts` | 이 상황 안에 성격이 다른 부분이 섞여 있는가(있으면 부분 목록을 함께 낸다) | disorder |

```ts
export type SituationQuestionId =
  | "q.urgent_harm" | "q.no_time_for_cause" | "q.done_before" | "q.procedure_exists"
  | "q.analysis_converges" | "q.expert_knows" | "q.taste_or_reaction" | "q.unpredictable"
  | "q.mixed_parts";

export interface SituationAnswer {
  questionId: SituationQuestionId;
  answer: "yes" | "no" | "unknown";
  evidence: readonly string[];         // 관찰·판단·해석 레코드 id. "yes"/"no"는 1개 이상 필수
  note?: string;
}

/** 모델이 내는 제안(situation_answers). */
export interface SituationAnswersProposal {
  concernId: string;
  answers: readonly SituationAnswer[];  // 아홉 질문 모두. 모르면 "unknown"
  parts?: readonly {                    // q.mixed_parts가 yes일 때
    label: string;
    answers: readonly SituationAnswer[];
  }[];
}

/** 커널에 기록되는 상황 판정. 최종 스키마는 08(sa_). */
export interface SituationAssessmentRecord {
  id: string;                          // sa_<ULID>
  concernId: string;
  type: SituationType;
  confidence: "low" | "medium" | "high";
  answers: readonly SituationAnswer[];
  alternative?: SituationType;         // 확신이 낮을 때 두 번째 후보
  parts?: readonly { label: string; type: SituationType }[];
  previousType?: SituationType;
  trigger: { eventId: string; signal?: ReassessSignal };
  computedBy: "decision_table@1";
  proposedBy: string;                  // agent:work 등
  decidedBy: "kernel";
  autonomous: true;
  whyNotAsked: string;                 // 예: "상황 판정은 이의 가능한 혼자 정한 결정(v0.3 05 §3.2-2)"
}
```

근거 없는 "yes"/"no"는 커널이 형식 검사에서 거부한다(내용 거부, v0.3 05 §3.2-5 "근거 없는 판정은 기록되지 않는다"). 근거가 없으면 "unknown"으로 답해야 한다.

#### 3.7.2 결정표

`classify(answers, parts) → { type, confidence, alternative }`. 순서대로 처음 맞는 규칙을 쓴다.

| 순서 | 조건 | 유형 |
|---|---|---|
| 1 | `q.urgent_harm` = yes 이고 `q.no_time_for_cause` = yes | chaotic |
| 2 | `q.mixed_parts` = yes 이고 `parts`가 2개 이상이며, 부분마다 이 표를 적용한 결과가 서로 다름 | disorder (부분 목록은 S.split 제안 재료) |
| 3 | 유형 점수 계산 후 최고 점수 유형이 둘 이상 같은 점수 | disorder |
| 4 | 답 중 "unknown"이 5개 이상 | disorder |
| 5 | 그 밖 | 최고 점수 유형 |

점수: clear = [`q.done_before`, `q.procedure_exists`]의 yes 수, complicated = [`q.analysis_converges`, `q.expert_knows`]의 yes 수, complex = [`q.taste_or_reaction`, `q.unpredictable`]의 yes 수. 단, `q.taste_or_reaction` = yes이면 complicated 점수에서 1을 뺀다(취향이 정답이면 분석으로 답이 나오지 않는다). `q.procedure_exists` = no이면 clear 점수는 최대 1이다.

확신 정도:

- high: 최고 점수 2, 둘째 점수 0, unknown 2개 이하
- medium: 최고 점수 2이고 둘째 1, 또는 최고 점수 1이고 둘째 0
- low: 그 밖. low이거나 medium이면 둘째 유형을 `alternative`로 적는다(v0.3 05 §3.2-3)

이 표는 [제안]이며 테스트 고정값으로 둔다. 표를 바꾸면 `computedBy`의 버전을 올린다.

#### 3.7.3 판정 알고리즘

```text
assessSituation(concern):
  1. O 활성화의 assess WorkUnit이 문제 정의 패킷(concern.reframe)을 기록한 뒤 situation_answers를 선언하고
     run을 handoff로 끝낸다(§3.5.6).
  2. 오케스트레이터가 classify를 계산해 situation.assess(R)를 낸다. 커널 형식 검사: 아홉 질문 모두 있음,
     yes/no 답의 근거 id 실재. 실패 → 거부(내용).
       거부되면 오케스트레이터는 같은 활성화에서 assess를 한 번 더 돌린다(거부 이유를 투영에 넣음).
       두 번째도 거부 → assessment.failedTimes(2) → O 종료 결과 disorder.
  3. q.procedure_exists는 모델 답을 쓰지 않고 코드가 절차 레지스트리(16이 제안, 사람이 채택한 절차)를 조회해 채운다.
       같은 종류의 Concern에 신뢰 상태가 active인 절차가 있으면 yes, 근거는 절차 레코드 id.
  4. classify()로 유형·확신·대안을 계산한다.
  5. 결과를 situation.assess 명령으로 커널에 보낸다(행위자 runtime, declaredBy = assess run, autonomous true).
  6. 유형이 disorder이고 parts가 있으면 parts를 S.split의 입력으로 남긴다.
```

#### 3.7.4 유형별 기본 조합 [제안: v0.3 05 §6과 대화 2차안(X4 9-15)]

v0.3 05 §6 표와 대화의 2차안(X4 9-15)을 합쳤다. 루프 계획의 기본값이다(§3.8).

| 유형 | 기본 조합 | 건너뛰는 루프(기록) | 다이얼 층 2 기본값(§3.11.4) |
|---|---|---|---|
| clear | `O → C.commit → A.confirm → (A.reflect)` | I: "명확 유형, 절차·모범 사례 적용" | 질문 적게, 탐구 없음, 증명 부담 light(자동 검증 근거) |
| complicated | `O → I.fact → (I.outcome) → C.commit → A.confirm → (A.reflect)` | 없음 | 질문 보통, 탐구 깊이 4 |
| complex | `O → (I.want 또는 I.possibility) ⇄ C.probe → A.watch → C.commit → A.confirm → (A.reflect)` | 없음 | 관점 폭 넓게, 전달 예약(라운드 경계) |
| chaotic | `C.emergency → O(재판정) → [새 유형의 조합] → A.reflect(필수)` | 처음에는 O, I | 비상 합의 범위 밖은 즉시 전달 |
| disorder | `O → S.split → [하위마다 각자 조합] → S.recombine → A.confirm → (A.reflect)` | C(상위에서는 직접 실행하지 않음) | 판정 근거 필수(다이얼 아님, 형식 검사) |

- 괄호 `( )`는 선택 단계다. `I.outcome`은 O의 문제 정의 패킷이 "부작용·파급이 큰 선택"을 표시했거나 모드가 deliberate일 때 넣는다. `A.reflect`는 증명 부담이 heavy이거나 C.emergency를 지났으면 필수, 그 밖에는 선택이다.
- `⇄`는 두 루프를 오가는 구간이다. 계획 단계 하나로 표현한다(§3.8.1의 `pairWith`).
- 명확 유형에서 자동 검증이 예상 밖 결과를 내면 O로 재판정한다(전환 T08).

#### 3.7.5 재판정 신호와 유형 변경 처리

재판정은 O 루프로의 전환이다(전환 T07). 신호(v0.3 05 §4.2 + 이 문서):

```ts
export type ReassessSignal =
  | "auto_verify_unexpected"       // 명확: 자동 검증이 예상 밖 → 명확에서 다른 유형으로
  | "inquiry_unstable"             // 사실 탐구가 예산을 다 써도 1순위가 안정되지 않음 → 복잡에서 복합으로
  | "reaction_vs_analysis"         // 사용자 반응이 분석 결과와 두 번 이상 어긋남 → 복잡에서 복합으로
  | "probe_pattern"                // 탐침이 일관된 패턴을 보임 → 복합에서 복잡으로
  | "stabilized"                   // 비상 조치 후 안정 → 혼돈에서 복합·복잡으로
  | "chaos_signal"                 // 피해가 커지는 중이라는 선언·관찰 → 어디서든 혼돈으로
  | "procedure_failed"             // 절차를 쓴 작업에서 예상 밖 결과
  | "human_request"                // 사람이 재판정을 지시
  | "contested";                   // 사람이 판정에 이의
```

신호의 출처: `auto_verify_unexpected`, `inquiry_unstable`, `stabilized`는 코드가 이벤트로 계산한다. `reaction_vs_analysis`, `probe_pattern`, `chaos_signal`은 모델이 `transition_request`(대상 O, 신호 포함)로 선언한다. `human_request`, `contested`는 사람 명령이다.

유형이 바뀌었을 때(새 판정의 type ≠ 이전 type) 오케스트레이터가 하는 일:

| 순서 | 처리 |
|---|---|
| 1 | 루프 계획을 새 유형의 기본 조합으로 다시 만든다(`cause: situation_changed`). 이미 지난 단계는 유지하고 현재 위치부터 새로 붙인다(§3.8.3) |
| 2 | 모드를 다시 라우팅한다(§3.10.3). 사용자가 직접 정한 모드(층 5·6)는 유지한다 |
| 3 | 다이얼 층 2(유형 기본값)를 바꾼다. 층 4~6의 사용자 값은 그대로 두며 계속 층 2보다 우선한다 |
| 4 | 실행 중인 WorkUnit: 새 유형이 chaotic이면 비상 범위 밖 WorkUnit을 즉시 멈추고(12의 중단 요청) `C.emergency`로 간다. 그 밖에는 다음 턴 경계에서 마무리하게 한다 |
| 5 | 이전 유형이 chaotic이면 비상 합의 적용을 끝내고(`agreement` 종료 요청, 10), 계획에 `A.reflect`(사후 검토)가 있는지 확인한다 |
| 6 | 이전 유형이 clear이고 절차를 쓰고 있었으면 `procedure_failed` 관찰을 남겨 16이 절차 신뢰도를 낮추게 하고, 이 Concern에서 그 절차를 더 쓰지 않는다(v0.3 05 §5) |
| 7 | 새 유형이 disorder이면 `S.split`으로 간다 |

재판정 가드(G3, §3.9.5): 같은 Concern에서 자동 재판정은 직전 판정 이후 새 근거(관찰·판단·사람 답)가 있을 때만, 24시간에 2번까지 한다. 넘으면 `progress_stall` 접점을 연다. 사람이 요청한 재판정은 이 가드를 받지 않는다.

### 3.8 루프 계획 [결정 8: 계획을 기록하고 이의를 받는다(대화 L3913 사용자 동의) / 결정 53: 혼합 방식, 기본은 표시 선언과 코드 계산(ADR-14-12, 판정 J-188)]

#### 3.8.1 레코드

루프 계획은 권고다. 계획을 벗어나는 전환은 허용되고, 벗어나면 계획을 새 버전으로 고친다(v0.3 03 §1-2). 계획을 만든 것과 고친 것은 모두 혼자 정한 결정이다(결정 8).

```ts
export interface PlanStep {
  key: string;                          // 계획 안에서 고유("s1", "s2" …). 버전이 바뀌어도 유지되는 단계는 같은 key
  loops: readonly LoopId[];             // 하나면 그 루프. 여럿이면 앞에서부터 필요한 것을 차례로 쓴다(예: ["I.want","I.possibility"])
  pairWith?: LoopId;                    // "⇄" 구간: loops와 pairWith를 오간다
  until?: readonly PredicateRef[];      // ⇄ 구간을 끝내는 조건(예: probe.anyGrow)
  optional: boolean;                    // 건너뛰어도 계획 이탈로 보지 않음
  reason?: string;
}

export type PlanCause =
  | "initial" | "situation_changed" | "deviation" | "mode_changed" | "directive"
  | "structure" | "contested" | "reopened" | "maturity_gate" | "procedure";

/** 08 LoopPlanCore와 같은 모양이다. id와 버전 메타는 08 Meta가 준다([판정 J-226], [판정 J-299]). */
export interface LoopPlanCore {
  concernId: string;
  situationAssessmentId: string | null;
  combo: readonly LoopId[];             // planDetail.steps를 펼친 루프 목록. 계획일 뿐이다
  planVersion: number;                  // 1부터. 이름 version은 RecordMeta와 겹쳐 planVersion으로 쓴다
  supersedes: string | null;            // 이전 버전 id
  planDetail: {
    modeId: ModeId | null;
    procedureId: string | null;
    steps: readonly PlanStep[];
    completedStepKeys: readonly string[]; // 이미 지난 단계
    skipped: readonly { loop: LoopId | LoopFamily; reason: string }[]; // 건너뛴 루프와 이유(v0.3 10 §1 비판 1: I 건너뛰기를 정상 경로로 인정하고 기록)
    flags: PlanFlags;                     // 계획을 만들 때 쓴 선언
    cause: PlanCause;
    proofBurdenRequired: { level: string; signals: readonly string[] } | null;   // 자동 상향(§3.11.7)
  };
  authoredBy: "code" | "model" | "human";   // 계획 본문을 쓴 쪽(J-188). 채널로 정한다(10 §3.8.1): model_tool → model, runtime → code, human_client → human
  reason: string;
  autonomy: Autonomy;                   // 채택한 쪽과 whyNotAsked(08 §3.4.5). decidedBy는 human, kernel(규칙 결정), agent:<역할>(모델 결정). authoredBy와 따로 적는다
}

/** O의 assess WorkUnit이 선언하는 계획 표시(frame_packet의 planFlags). 여섯 표시와 outOfPattern을 합친 일곱 개다. 스키마 정본은 08 §3.15다. */
export interface PlanFlags {
  wantDependent: Flag;              // 정답이 사용자 취향·가치 판단에 달림
  needsPossibilities: Flag;         // 알려진 해법이 없거나 부족함
  consequentialSideEffects: Flag;   // 선택이 부작용·파급을 가짐
  needsWrite: Flag;                 // 작업 대상을 바꿔야 끝남
  reviewOnly: Flag;                 // 이미 있는 결과를 확인하는 일
  artifactIsResult: Flag;           // 산출물(글·보고서·계획)이 곧 결과
  outOfPattern: Flag;               // 위 여섯 표시로 이 상황을 나타낼 수 없음(J-188). 근거 필수. 참이면 hybrid에서 모델 초안을 받는다(§3.8.5)
}
export interface Flag { value: boolean; evidence: readonly string[] }   // value가 참이면 evidence에 근거 id가 하나 이상 있어야 한다
```

현재 위치(cursor)는 레코드에 저장하지 않는다. 마지막 루프 전환과 계획의 `planDetail.steps`로 계산한다(`planPosition(view)`). 전환마다 계획 레코드를 다시 쓰지 않기 위해서다.

계획의 기본 경로는 표시 선언과 코드 계산이다. 계획은 "모델이 구조화된 값을 선언하고 코드가 계산"할 수 있는 결정이므로 결정 14에 맞는다. 모델이 자유롭게 쓴 계획은 검증할 기준이 없다. 사람은 계획을 직접 고칠 수 있다(`authoredBy: human`, `decidedBy: human`). 여섯 표시로 나타낼 수 없는 상황에서만 모델이 계획 초안을 낸다(결정 53). 그 초안도 기록되고 이의를 받으며, 커널이 의존 규칙을 검사한다(§3.8.5). 대화 L3913에서 사용자가 동의한 "모델이 계획을 제안하고, 기록되고, 이의를 걸 수 있다"의 세 조건은 혼합 방식에도 그대로 있다. 제안의 형식이 기본값에서 바뀌었으므로 그 변경은 ADR-14-12로 남긴다.

#### 3.8.2 생성 알고리즘

```text
buildPlan(input) → LoopPlanCore 초안(authoredBy: code) | NoRule
input = { situation, flags, mode, directive?, maturity, dials, procedure?, history, previousPlan? }

0. 규칙이 맞는지 확인
   flags.reviewOnly.value && flags.needsWrite.value  → NoRule("표시 충돌")   // 검증 Concern에 쓰기가 있을 수 없다
   // NoRule은 코드가 계획을 정하지 못한다는 뜻이다. 작성 경로(§3.8.5)가 hybrid에서 모델 초안을 연다

1. 기본 조합
   template = DEFAULT_COMBO[situation.type]                       // §3.7.4, 설정 층 2
   현재 모드(층 3 이상)의 planTemplate이 "by_situation"이 아니면 template = mode.planTemplate   // §3.10.2

2. 플래그로 다듬기
   complex:
     I 단계의 loops = [ flags.wantDependent ? "I.want" : null,
                        flags.needsPossibilities || !flags.wantDependent ? "I.possibility" : null ].filter
   complicated:
     flags.needsPossibilities          → I.fact 뒤에 I.possibility(optional=false) 삽입
     flags.consequentialSideEffects 또는 mode == deliberate → I.outcome(optional=false)
   clear:
     I는 건너뛴다. planDetail.skipped += {I, "명확 유형"}
   flags.reviewOnly                    → C 단계를 모두 빼고 [O, A.confirm]만 남긴다(검증 Concern)
   !flags.needsWrite && !flags.artifactIsResult
                                       → C.commit 단계를 빼고, I 단계 뒤에 A.confirm(탐구 결과 확인)을 둔다

3. 절차
   situation.type == clear 이고 procedure(신뢰 상태 active)가 있으면
     template의 C.commit 단계에 procedure의 상시 합의를 쓴다고 표시(reason "절차 P-…")

4. 돌아보기
   dials.proofBurden == heavy 또는 history에 C.emergency가 있으면 A.reflect.optional = false
   그 밖에는 optional = true

5. 성숙도
   features.enabledLoops에 없는 루프는 뺀다. planDetail.skipped += {loop, "기능 미활성"}(§3.15의 대체 동작)
   (§3.15. I가 빠지면 O의 문제 정의 패킷에서 바로 합의 초안을 만든다)

6. 직접 지정
   directive.loop가 있으면 그 루프를 첫 단계로 두고, template에서 그 루프 계열 다음 단계부터 이어 붙인다

7. 이력 합치기(수정일 때)
   planDetail.completedStepKeys = previousPlan의 지난 단계
   새 planDetail.steps = 지난 단계(그대로) + 현재 루프가 속한 단계부터의 새 template 꼬리

8. 의존 규칙 맞추기(계획 검증)
   C 계열 단계 뒤에 A.confirm이 없으면 붙인다                    // 의존 규칙 2
   S.split 뒤에 S.recombine과 A.confirm이 없으면 붙인다            // 의존 규칙 4
   고친 것은 reason에 적는다. 모델 초안은 고치지 않고 거부한다(§3.8.5 V-PLAN-05)

9. 이전 계획과 같으면 새 레코드를 만들지 않는다
```

#### 3.8.3 수정 시점

| 계기 | cause | 처리 |
|---|---|---|
| 첫 O 종료 | `initial` | buildPlan |
| 상황 유형 변경 | `situation_changed` | buildPlan(history 포함) |
| 계획에 없는 루프로 전환 | `deviation` | 전환은 그대로 진행. 지난 단계 + [도착 루프] + 그 계열 다음 단계부터의 template 꼬리로 다시 만든다 |
| 계획에 있지만 뒤에 있는 루프로 바로 전환 | (수정 없음) | 사이의 단계 중 optional이 아닌 것을 `planDetail.skipped`에 기록한 새 버전을 만든다(cause `deviation`) |
| 모드 변경 | `mode_changed` | buildPlan |
| 사람의 직접 지시(루프 지정, 계획 수정) | `directive` | 사람이 준 계획(`authoredBy: human`) 또는 buildPlan(directive)(`authoredBy: code`). decidedBy human |
| S 동작 | `structure` | 상위: 대기(children) 후 `S.recombine → A.confirm …`로. 하위: 각자 initial |
| 계획·전환에 이의 | `contested` | §3.12.4의 이의 처리 |
| 닫힌 Concern이 다시 열림 | `reopened` | O부터 initial과 같은 방식 |
| 기능 플래그 변경 | `maturity_gate` | 진행 중인 Concern은 다음 O에서 반영 |
| 절차 적용 | `procedure` | clear + 절차가 있을 때 |

계획 작성 경로(§3.8.5)는 `cause`를 바꾸지 않는다. 위 표의 `buildPlan`은 모두 §3.8.5의 경로 선택을 거친다. 모델 초안이 거부되어도 `cause`는 그대로이고, 본문의 출처는 `authoredBy`가, 거부 기록은 `command.rejected`와 `loop_plan.adopted`의 `modelDraftRejects`가 남긴다.

#### 3.8.4 다음 루프 정하기

```text
resolveNext(view, exitOutcome) → LoopId | Wait | Close
  // 0. 전환 규칙(§3.9)이 같은 이벤트로 발동했으면 그 결과가 우선한다(우선순위 표 §3.9.3)
  hint = contract(view.currentLoop).exit[outcome].next
  switch hint.kind:
    plan:          return nextInPlan(view.plan, planPosition(view), view)
    loop:          return hint.to
    lastOfFamily:  return lastActivated(view, hint.family) ?? hint.fallback
    loopByType:    return hint.byType[view.situation.type] ?? hint.fallback
    reopenTo:      return view.acceptance.reopenTo                  // 08 R-19가 rejected·criteria_wrong에 필수로 둔다
    return:        return previousLoopBefore(view, family "S")
    wait:          return Wait(hint.reason)
    close:         return Close(hint.result)

nextInPlan(plan, pos, view):
  step = plan.planDetail.steps[pos.index]
  if step.pairWith and not all(step.until):          // ⇄ 구간이 아직 안 끝남
      return (pos.loop == step.pairWith) ? firstUnfinished(step.loops, view) : step.pairWith
  if step.loops에 이번 활성화에서 아직 안 쓴 루프가 남고 그 루프가 필요하다고 표시됨:
      return 그 루프
  다음 단계 중 첫 단계의 loops[0]을 반환
  다음 단계가 없으면:
      Concern이 완료 조건(결과 확인 + 반영 항목 처리)을 만족 → Close(completed)
      아니면 → "O"(계획을 다시 세운다. 재진입 가드 G2가 적용됨)
```

도착 루프가 계획에서 현재 위치보다 뒤에 있으면 위치를 그 단계로 옮기고 §3.8.3 두 번째 행처럼 건너뛴 단계를 기록한다.

#### 3.8.5 작성 경로와 모델 초안 [결정 53, 판정 J-188]

계획 본문을 코드가 계산할지 모델이 초안을 낼지는 다이얼 `planAuthoring`이 정한다(§3.11.1, 기본 `hybrid`, MVP 설정 화면에서 고른다([판정 J-192])). 계획 표시(`PlanFlags`)는 세 방식 모두에서 O의 assess가 선언한다.

| `planAuthoring` | 초안을 요청하는 조건 | 초안이 왔을 때(커널 검사, 10 V-PLAN-02·03) |
|---|---|---|
| `computed` | 없음 | 거부한다(V-PLAN-02, `denied.plan_authoring_mode`). 재요청하지 않고 코드가 계획을 계산한다 |
| `hybrid`(기본) | `flags.outOfPattern.value`가 참이거나, `buildPlan`이 NoRule을 낸다 | `outOfPattern`이 거짓이고 `buildPlan`이 규칙으로 정하면 거부한다(V-PLAN-03, `policy.plan_draft_not_needed`). 그 밖에는 검사한다 |
| `model` | 언제나 | 검사한다(V-PLAN-03은 하지 않는다) |

요청이 필요하지 않으면 코드가 계획을 계산해 runtime 채널로 `loop_plan.record(authoredBy: code)`를 낸다. 요청이 필요하면 O의 assess WorkUnit을 같은 활성화에서 한 번 더 돌린다(입력 `planDraft: true`, 표시와 상황 유형을 함께 준다. 도구 묶음은 13 §3.7.2). 모델은 `loop_plan.record`에 `steps`와 `reason`을 실어 M 채널로 낸다(제안 종류 `loop_plan_draft`, §3.5.6). 초안은 커널 명령으로 들어가므로 검사도 커널이 한다.

검사는 10 §3.8.1의 V-PLAN-01~07이다. 의존·성숙도 검사(V-PLAN-04~06)는 14의 순수 함수 `validatePlan(steps, view, enabledLoops)`가 계산하고 커널이 그것을 부른다(`@helm/kernel/orchestration`, ADR-14-10, §6.1). 검사 내용은 이 절이, 검사 순서와 거부 코드는 10이 정본이다. 같은 검사를 코드 계산 계획에도 돌린다. 코드 계산 계획이 실패하면 `buildPlan`의 결함이다(C-4).

| 규칙(10) | 검사 | 거부 코드 |
|---|---|---|
| V-PLAN-01 형식 | `PlanStep` 형식(키 고유, `loops`는 루프 목록, `⇄` 구간의 `pairWith`·`until`), `flags`가 `PlanFlags`이고 `outOfPattern`이 참이면 근거 id가 기록에 있다 | `invalid.schema`, `invalid.evidence_not_found` |
| V-PLAN-02 방식 | `planAuthoring`이 `computed`가 아니다(모델 초안에만 적용) | `denied.plan_authoring_mode` |
| V-PLAN-03 불필요 | `hybrid`에서 `outOfPattern`이 거짓이고 `buildPlan`이 규칙으로 정하면 초안을 받지 않는다 | `policy.plan_draft_not_needed` |
| V-PLAN-04 규칙 1 (활성 합의 전 쓰기 금지) | 쓰기·발송 원시 행동을 내는 루프 단계는 계획에서 `C.commit` 단계 뒤에 있거나, Concern에 개정판이 현재인 활성 합의가 있다(의존 규칙 1) | `policy.plan_dependency_violation`(`dependency_rule:1`) |
| V-PLAN-05 규칙 2·4 (결과 뒤 결과 확인, 분할 뒤 재조합) | 각 C 계열 단계 뒤에 `A.confirm`이 있고, `S.split` 뒤에 `S.recombine`과 `A.confirm`이 있다(의존 규칙 2·4) | `policy.plan_dependency_violation`(`dependency_rule:2` 또는 `:4`) |
| V-PLAN-06 성숙도 관문 | 계획의 모든 루프가 `features.enabledLoops`에 켜져 있다(§3.15) | `policy.plan_maturity_gate`(`maturity:<loop>`) |

`planAuthoring: computed`에서 초안을 거부하는 것은 V-PLAN-02이고, `model`에서는 V-PLAN-03을 하지 않는다. 같은 Concern에서 V-PLAN-04~06 위반을 세는 `planDraftStrikes`는 10 커널 상태가 맡는다.

```text
// 초안 요청이 필요할 때(위 표). 모델이 loop_plan.record(steps, reason)을 M 채널로 낸다. 검사는 커널(10 §3.8.1)
// 1. V-PLAN-01·02·03 위반: 거부한다. 두 번째 위반으로 세지 않는다
// 2. V-PLAN-04~06(validatePlan) 위반:
//      planDraftStrikes = 0  → command.rejected(retryable: true, next: loop_plan.record, 사유), strikes = 1
//                               모델은 같은 run에서 한 번 더 낸다
//      planDraftStrikes = 1  → 거부하지 않는다. buildPlan 계획을 authoredBy: code, decidedBy: kernel로 기록한다.
//                               reason에 대체 사실을 적고 notice.plan_draft_fallback을 낸다. strikes = 0
// 3. 통과                    → loop_plan.adopted(authoredBy: model)
// 요청이 필요 없을 때는 runtime 채널이 buildPlan 계획을 authoredBy: code로 낸다.
// buildPlan이 NoRule을 내고 코드가 계획을 정할 수 없으면(computed, 또는 초안 두 번 위반 뒤) 골격 [O]을 쓰고 사람 접점 progress_stall("계획 표시가 서로 맞지 않습니다")을 연다.
```

계획 레코드의 `authoredBy`는 본문을 쓴 쪽, `decidedBy`는 받아들인 쪽이다(결정 8). 거부된 초안은 `command.rejected`로 남고(사유는 한국어 문장), 대체가 일어나면 계획의 `reason`과 `notice.plan_draft_fallback`이 대체 사실을 남긴다. `loop_plan.adopted`의 `modelDraftRejects`는 거부된 규칙 id를 시도 순서대로 싣는다(최대 2). 16은 `authoredBy`별 계획 이의 비율을 재고 `modelDraftRejects` 길이별 건수도 센다(§5.2). 화면은 `authoredBy: model`인 계획을 "모델이 설계한 계획"으로 보인다(04·05, §5.2). 사람이 고친 계획과 코드 계산 계획의 V-PLAN-04~06 위반은 그 자리에서 거부한다(10).

### 3.9 루프 전환 [결정 5, 8: 조합·전환 자유와 기록 / 제안: 규칙표·가드]

#### 3.9.1 전환 레코드

```ts
/** 08 TransitionRuleId는 패턴(^(T[0-9]{2}|EXIT|OPEN|REDIRECT)$)이다. 쓰는 값은 아래로 좁힌다. */
export type TransitionRuleId =
  | "T01" | "T02" | "T03" | "T04" | "T05" | "T07" | "T08" | "T09" | "T10" | "T11" | "T12"
  | "T13" | "T14" | "T15" | "T16" | "T17" | "T18" | "T20" | "T21" | "T22" | "T23" | "T24"
  | "T25" | "T26" | "T27" | "T28" | "T30" | "T31" | "T32" | "T33" | "EXIT" | "OPEN" | "REDIRECT";

/** 최종 스키마는 08(lt_). 이 id가 도착 루프 활성화의 id다(D2). */
export interface LoopTransitionRecord {
  id: string;                           // lt_<ULID>
  concernId: string;
  from: LoopId | null;                  // Concern을 연 첫 전환은 null
  to: LoopId;
  ruleId: TransitionRuleId;             // EXIT = 계약 종료 결과에 따른 이동, OPEN = 첫 진입, REDIRECT = 진입 조건 미충족으로 돌림
  exitOutcome?: ExitOutcome;
  trigger: { eventId: string; kind: string };   // 계기가 된 이벤트(관찰, 답, 타이머, 거부 등)
  reason: string;
  planDeviation: boolean;               // 계획에 없던 이동인가
  restart: boolean;                     // 같은 루프로 다시 들어감(G7)
  proposedBy: string;                   // 행위자
  decidedBy: "kernel" | "agent:<역할>" | "human";
  autonomous: boolean;                  // decidedBy가 human이 아니면 true
  whyNotAsked?: string;                 // autonomous면 필수(불변조건 7, 형식은 11)
  idempotencyKey: string;               // `${trigger.eventId}:${ruleId}` (G1)
}
```

전환 명령은 커널에 들어가 의존 규칙 검사를 받는다(10). 받아들여지면 같은 커밋에서 Concern의 현재 루프가 바뀐다(durable-spike 스파이크 2에서 "phase 전이와 루프 전환 기록이 같은 commit"을 확인했다, canon-2 §7.2.2 [실험]).

#### 3.9.2 전환 규칙표

v0.3 03 §6의 계기 19개(v0.2 재진입 규칙 6개 포함)와 이 문서에서 더한 것이다. "판단"은 누가 전환을 정하는지: kernel = 코드가 이벤트로 계산, agent:<역할> = 모델이 `transition_request`로 제안하고 코드가 가드를 검사, human = 사람 명령.

| id | 계기 | 출발 | 가드 | 도착 | 판단 | 출처 |
|---|---|---|---|---|---|---|
| T01 | 새로운 놀라운 관찰(예측·기대와 어긋남, 또는 모델이 surprise로 표시) | O, C.*, A.* | G1, G2 | `I.fact`(유형 변화가 의심되면 T07) | 예측 불일치는 kernel, 나머지 agent:<역할> | v0.2 재진입 1, canon-3 G5 |
| T02 | 탐구 중 Goal과의 충돌 발견 | I.* | – | 루프 유지. `goal_revision` 접점(의존 규칙 5, 커널이 만든다) | agent:<역할> | v0.2 재진입 2 |
| T03 | 실행 중 합의 범위 밖 요청(커널·권한 레이어가 막음) | C.* | – | 루프 유지, 대기(human). 답이 "탐구 필요"면 `I.fact` | kernel | v0.2 재진입 3 |
| T04 | 확인 중 근거 부족(기준이 "확인 못함" 또는 검증 에이전트의 반대 근거) | A.confirm | 결과 확인 전일 것 | `I.fact`(탐구 WorkUnit) 후 `A.confirm`으로 돌아옴 | kernel | v0.2 재진입 4 |
| T05 | 반영 중 공유 전제 충돌 | A.confirm | – | 루프 유지. 관련 선택·컨텍스트 무효화 명령(10), 영향받는 다른 Concern에 T27 | agent:<역할> | v0.2 재진입 5 |
| T07 | 상황 유형 변경 신호(§3.7.5) | 모든 루프 | G3 | `O`(재판정). `chaos_signal`이면 `C.emergency` | kernel 또는 agent:<역할> | v0.3 |
| T08 | 명확 유형에서 자동 검증이 예상 밖 결과 | A.confirm | situation = clear | `O` | kernel | v0.3 |
| T09 | 결과 확인에서 "해결되지 않음" | A.confirm | – | `reopenTo`(사람 선택, 08 `C.commit`·`I.fact`·`I.want`). 화면 기본값은 직전 I. 직전 I가 없으면 사람이 C 또는 I를 고른다([판정 J-24], U-26). 전환은 오케스트레이터가 낸다(10 `result.accept`는 루프 전환을 내지 않는다) | human | v0.3 |
| T10 | 결과 확인에서 수정 요청 | A.confirm | G4 | `C.commit`(합의 유지, 진행 중으로) | human | v0.3, X3-2-13 |
| T11 | 결과 확인에서 "기준이 틀림" | A.confirm | – | `reopenTo`(사람 선택). 화면 기본값은 complex면 `I.want`, 아니면 `I.fact` | human | X3-2-13 |
| T12 | 탐침이 키울 조건 충족 | C.probe, A.watch | – | `C.commit` | kernel(조건 evaluator가 agent:<역할>이면 agent:<역할>) | v0.3 |
| T13 | 탐침이 모두 접을 조건 충족 | C.probe, A.watch | – | 직전 I | kernel | v0.3 |
| T14 | 문제가 둘 이상으로 나뉨 | 모든 루프 | G8 | `S.split` | agent:<역할> | v0.3 |
| T15 | 여러 Concern이 같은 문제 | 모든 루프(거시) | 대상 Concern에 실행 중 WorkUnit 없음 | `S.merge` | agent:<역할>(O 또는 관찰 에이전트 제안) | v0.3 |
| T16 | 기대 기한 초과("응답 없음" 관찰) | 대기(external) | – | `O`. O의 계획 플래그로 이어서 정함 | kernel | v0.3, 결정 9 |
| T17 | 선호 모델 변경 | 모든 루프, 닫힌 Concern 포함 | 그 선호 모델 기준으로 확인된 결과가 있음 | 그 결과의 Concern을 다시 열고 `A.confirm`(재확인) | kernel | v0.3 |
| T18 | 예측 확인 시각 도래(12 타이머 `prediction_check` → 10 `timer.fire` → `question.recorded(prediction_check)`) | 모든 루프, 닫힌 Concern 포함 | – | 루프를 바꾸지 않고 루프 밖 점검 WorkUnit(`prediction_check`, §3.12.5-7)을 돌려 그 질문에 답할 근거를 만든다. `prediction.checked`가 불일치면 T01(닫힌 Concern은 다시 연다) | kernel | v0.3 |
| T20 | 사람의 직접 지시 | 모든 루프 | 의존 규칙만 | 지시한 루프 | human | v0.3 |
| T21 | 탐구 멈춤 규칙 충족("내 답이 계획을 더 바꾸지 않으면 C로") | I.* | – | 계획 다음 단계 | kernel(15 계산) | 감사 §3.1, X3-6-07 |
| T22 | 탐구 예산 소진 | I.* | – | 계획 다음 단계(열린 질문을 넘김) | kernel | v0.3 03 §3.2 |
| T23 | 결과 제출 | C.commit | – | `A.confirm` | kernel | X3-2-16 |
| T24 | 비상 조치 후 안정 | C.emergency | – | `O`(재판정) | agent:<역할> 선언 + kernel | v0.3 03 §9.2 |
| T25 | 지속 관찰 판정 | A.watch | – | 키움 `C.commit`, 접음 직전 I, 계속 머무름 | kernel 또는 human | v0.3 |
| T26 | 결과 확인 + 반영 완료 | A.confirm | – | 계획 다음(`A.reflect` 또는 닫기) | kernel | v0.3, A10 |
| T27 | 판단에 이의(새 관찰이 판단의 근거와 맞지 않음 → 판단 contested) | 모든 루프, 닫힌 Concern 포함 | – | `I.fact`(닫힌 Concern은 다시 연다) | 충돌 판정 agent:<역할>, 상태 변경 kernel | X3-3-10, X3-8-18 |
| T28 | 혼자 정한 결정에 사람이 이의 | 모든 루프 | – | 결정 종류별 처리(§3.12.4) | human | 결정 8 |
| T30 | 하위 Concern이 모두 끝남 | 대기(children) | – | `S.recombine` | kernel | 의존 규칙 4 |
| T31 | O에서 단순 작업으로 판정(clear, 진입 신호 2개 미만) | O | – | 강등(§3.14.5) 또는 가벼운 계획 | kernel | v0.3 01 §3.7 |
| T32 | 쓰기 뒤 결과 제출 없이 WorkUnit 종료 | C.commit | 이 활성화에서 처음 | `submit` WorkUnit(루프 유지). 두 번째면 `submission_missing` 접점 | kernel | X3-2-12 |
| T33 | 탐구가 탐침을 제안함(바꿔 봐야 아는 확인, 작은 실현 가능성 확인, 15 §3.5·§3.8) | I.* | `probes.defined` | `C.probe`(탐침 정의를 넘겨받음). 기능 꺼짐이면 `C.commit`의 합의 초안으로 | agent:<역할> 선언 + kernel | 15 §5.2 요구 |

T06(돌아보기 → P 수정 제안)과 T19(가정 만료점 도달 → 질문 즉시 승격)는 루프를 바꾸지 않는다. T06은 `A.reflect` 계약의 출력이고, T19는 11의 일이다. 번호는 v0.3 03 §6 표의 순서를 남기려고 비워 둔다. T29는 쓰지 않는다.

위 표는 사람이 읽는 요약이다. `firstMatchingRule`이 읽는 데이터는 아래 `TRANSITION_RULES`이고, 계기 이벤트(09 이름), 조건식, 우선순위(§3.9.3)를 코드로 적는다. 표와 데이터가 다르면 데이터가 맞고 표를 고친다.

```ts
// packages/kernel/src/orchestration/transitions/rules.ts
import type { HelmEvent } from "@helm/domain";   // 09 envelope. ev.type은 09 카탈로그 이름

export type RuleTarget =
  | { kind: "loop"; to: LoopId }
  | { kind: "reopenTo" }                        // acceptance.recorded.reopenTo (사람이 고른 값, 08 R-19)
  | { kind: "lastI"; fallback: LoopId }
  | { kind: "plan" }                            // 계획 다음 단계(§3.8.4)
  | { kind: "stay"; then?: "touchpoint" | "workunit"; purpose?: WorkUnitPurpose; touchpoint?: HumanTouchpointKind }
  | { kind: "objection" }                       // §3.12.4 표
  | { kind: "demote" };                         // §3.14.5

export interface TransitionRule {
  id: TransitionRuleId;
  priority: 1 | 2 | 3 | 4 | 5 | 6 | 7;          // §3.9.3 (8 EXIT, 9 계획 다음은 규칙 밖)
  on: readonly HelmEvent["type"][];             // 계기 이벤트
  from: readonly LoopId[] | "any" | "any_or_closed" | { wait: WaitReason };
  when: (v: ConcernView, ev: HelmEvent, c: GuardContext) => boolean;
  target: RuleTarget | ((v: ConcernView, ev: HelmEvent) => RuleTarget);
  decidedBy: "kernel" | "agent:<역할>" | "human" | ((ev: HelmEvent) => "kernel" | "agent:<역할>");
  guards: readonly GuardId[];                   // §3.9.5
  trigger: TransitionTrigger | ((ev: HelmEvent) => TransitionTrigger);   // 08 §3.15, 대응은 §3.9.7
}

const C_ALL = ["C.commit", "C.probe", "C.emergency"] as const;
const A_ALL = ["A.confirm", "A.watch", "A.reflect"] as const;
const I_ALL = ["I.fact", "I.want", "I.possibility", "I.outcome"] as const;
const ho = (ev: HelmEvent) => ev.type === "run.ended" && ev.payload.reason === "handed_off" ? ev.payload.handoff : null;

export const TRANSITION_RULES: readonly TransitionRule[] = [
  // 1. 사람의 결과 확인 답(T09~T11), 이의(T28). 사람 지시(T20)는 커널이 이미 전환을 기록했으므로 규칙이 아니라 §3.16.3의 후속 처리다
  { id: "T09", priority: 1, on: ["acceptance.recorded"], from: ["A.confirm"], when: (_, ev) => ev.payload.acceptance.decision === "rejected",
    target: { kind: "reopenTo" }, decidedBy: "human", guards: ["G1"], trigger: "unresolved" },
  { id: "T10", priority: 1, on: ["acceptance.recorded"], from: ["A.confirm"], when: (_, ev) => ev.payload.acceptance.decision === "revision_requested",
    target: { kind: "loop", to: "C.commit" }, decidedBy: "human", guards: ["G1"], trigger: "revision_requested" },
  { id: "T11", priority: 1, on: ["acceptance.recorded"], from: ["A.confirm"], when: (_, ev) => ev.payload.acceptance.decision === "criteria_wrong",
    target: { kind: "reopenTo" }, decidedBy: "human", guards: ["G1"], trigger: "criteria_wrong" },
  { id: "T28", priority: 1, on: ["objection.filed"], from: "any_or_closed", when: (_, ev) => ev.payload.objection.desiredEffect !== "note_only",
    target: { kind: "objection" }, decidedBy: "human", guards: ["G1"], trigger: "objection" },
  { id: "T20", priority: 1, on: ["inquiry.stopped"], from: I_ALL, when: (_, ev) => ev.payload.reason === "human" && ev.payload.then === "decide_now",   // "지금 정하기"(§3.6.3). then은 08·09 필드이고 값은 10 정본이다([판정 J-157])
    target: (v) => ({ kind: "loop", to: nextCInPlan(v) ?? "C.commit" }), decidedBy: "human", guards: ["G1"], trigger: "human_directive" },
  // 2. 혼돈 신호
  { id: "T07", priority: 2, on: ["run.ended"], from: "any", when: (_, ev) => ho(ev)?.kind === "transition_request" && ho(ev)!.signal === "chaos_signal",
    target: { kind: "loop", to: "C.emergency" }, decidedBy: "agent:<역할>", guards: ["G1", "G3"], trigger: "situation_changed" },
  // 4. 상황 유형 변경, 예상 밖 결과
  { id: "T07", priority: 4, on: ["run.ended", "attestation.recorded", "inquiry.stopped", "check.observed"], from: "any",   // 판정 이의는 T28
    when: (v, ev, c) => reassessSignal(v, ev, c) !== null && reassessSignal(v, ev, c) !== "chaos_signal",
    target: { kind: "loop", to: "O" }, decidedBy: (ev) => ev.type === "run.ended" ? "agent:<역할>" : "kernel", guards: ["G1", "G3"], trigger: "situation_changed" },
  { id: "T08", priority: 4, on: ["attestation.recorded", "check.observed"], from: ["A.confirm"],
    when: (v, ev) => v.situation?.type === "clear" && autoVerifyUnexpected(ev),
    target: { kind: "loop", to: "O" }, decidedBy: "kernel", guards: ["G1"], trigger: "unexpected_result" },
  // 5. 판단 이의, 놀라운 관찰
  { id: "T27", priority: 5, on: ["record.staled", "finding.withdrawn"], from: "any_or_closed", when: (v, ev) => staleFindingUsedBy(v, ev),
    target: { kind: "loop", to: "I.fact" }, decidedBy: "kernel", guards: ["G1", "G2"], trigger: "surprise" },
  { id: "T01", priority: 5, on: ["run.ended", "prediction.checked"], from: ["O", ...C_ALL, ...A_ALL],
    when: (_, ev) => ev.type === "prediction.checked" ? ev.payload.verdict === "failed"
                    : ho(ev)?.kind === "transition_request" && ho(ev)!.trigger === "surprise",
    target: { kind: "loop", to: "I.fact" }, decidedBy: (ev) => ev.type === "prediction.checked" ? "kernel" : "agent:<역할>", guards: ["G1", "G2"], trigger: "surprise" },
  // 6. 구조
  { id: "T14", priority: 6, on: ["run.ended"], from: "any", when: (_, ev) => ho(ev)?.kind === "split_hint",
    target: { kind: "loop", to: "S.split" }, decidedBy: "agent:<역할>", guards: ["G1", "G8"], trigger: "split_needed" },
  { id: "T15", priority: 6, on: ["run.ended"], from: "any", when: (v, ev) => ho(ev)?.kind === "transition_request" && ho(ev)!.trigger === "merge_needed" && v.current?.running.length === 0,
    target: { kind: "loop", to: "S.merge" }, decidedBy: "agent:<역할>", guards: ["G1"], trigger: "merge_needed" },
  { id: "T30", priority: 6, on: ["concern.completed", "concern.closed", "concern.merged"], from: { wait: "children" },
    when: (v) => v.childrenTerminal, target: { kind: "loop", to: "S.recombine" }, decidedBy: "kernel", guards: ["G1"], trigger: "plan" },
  // 7. 그 밖의 규칙
  { id: "T02", priority: 7, on: ["goal.revision_proposed"], from: I_ALL, when: () => true,
    target: { kind: "stay" }, decidedBy: "agent:<역할>", guards: ["G1"], trigger: "goal_conflict" },          // 질문은 커널이 만든다(goal_revision)
  { id: "T03", priority: 7, on: ["workunit.scope_exceeded", "agreement.scope_change_requested", "agreement.violation_detected"], from: C_ALL,
    when: () => true, target: { kind: "stay", then: "touchpoint", touchpoint: "scope_change" }, decidedBy: "kernel", guards: ["G1"], trigger: "out_of_scope" },
  { id: "T04", priority: 7, on: ["attestation.recorded", "claim.counter_searched"], from: ["A.confirm"],
    when: (v, ev) => v.acceptance === null && insufficientEvidence(ev),
    target: { kind: "loop", to: "I.fact" }, decidedBy: "kernel", guards: ["G1", "G2"], trigger: "insufficient_evidence" },
  { id: "T05", priority: 7, on: ["run.ended"], from: ["A.confirm"], when: (_, ev) => ho(ev)?.kind === "transition_request" && ho(ev)!.trigger === "shared_premise_conflict",
    target: { kind: "stay" }, decidedBy: "agent:<역할>", guards: ["G1"], trigger: "shared_premise_conflict" },  // 무효화 명령과 다른 Concern의 T27
  { id: "T12", priority: 7, on: ["probe.concluded", "watch.judged"], from: ["C.probe", "A.watch"],
    when: (v, ev) => ev.type === "probe.concluded" ? ev.payload.outcome === "grown" : ev.payload.outcome === "stable",
    target: { kind: "loop", to: "C.commit" }, decidedBy: "kernel", guards: ["G1"], trigger: "probe_grow" },
  { id: "T13", priority: 7, on: ["probe.concluded", "watch.judged"], from: ["C.probe", "A.watch"],
    when: (v, ev) => ev.type === "probe.concluded" ? allProbesFolded(v) : ev.payload.outcome === "regressed",
    target: { kind: "lastI", fallback: "I.possibility" }, decidedBy: "kernel", guards: ["G1", "G2"], trigger: "probe_fold" },
  { id: "T16", priority: 7, on: ["expectation.timed_out"], from: { wait: "external" }, when: () => true,
    target: { kind: "loop", to: "O" }, decidedBy: "kernel", guards: ["G1"], trigger: "expectation_timeout" },
  { id: "T17", priority: 7, on: ["preference_model.versioned"], from: "any_or_closed", when: (v, ev) => acceptedAgainstOldVersion(v, ev),
    target: { kind: "loop", to: "A.confirm" }, decidedBy: "kernel", guards: ["G1"], trigger: "preference_changed" },
  { id: "T18", priority: 7, on: ["question.recorded"], from: "any_or_closed", when: (_, ev) => ev.payload.question.kind === "prediction_check",
    target: { kind: "stay", then: "workunit", purpose: "prediction_check" }, decidedBy: "kernel", guards: ["G1"], trigger: "prediction_due" },
  { id: "T21", priority: 7, on: ["inquiry.stop_rule_met"], from: I_ALL, when: () => true,
    target: { kind: "plan" }, decidedBy: "kernel", guards: ["G1"], trigger: "plan" },
  { id: "T22", priority: 7, on: ["budget.exhausted"], from: I_ALL, when: (v, ev) => budgetScopeIsActivation(v, ev),
    target: { kind: "plan" }, decidedBy: "kernel", guards: ["G1"], trigger: "plan" },
  { id: "T23", priority: 7, on: ["result.submitted"], from: ["C.commit"], when: () => true,
    target: { kind: "loop", to: "A.confirm" }, decidedBy: "kernel", guards: ["G1"], trigger: "contract_exit" },
  { id: "T24", priority: 7, on: ["run.ended", "observation.recorded"], from: ["C.emergency"],
    when: (v, ev, c) => (ho(ev)?.kind === "stabilized" || ev.type === "observation.recorded") && emergencyStabilized(v, c),
    target: { kind: "loop", to: "O" }, decidedBy: "kernel", guards: ["G1"], trigger: "situation_changed" },
  { id: "T25", priority: 7, on: ["watch.judged"], from: ["A.watch"], when: (_, ev) => ev.payload.outcome === "inconclusive",
    target: { kind: "stay" }, decidedBy: "kernel", guards: ["G1"], trigger: "plan" },                    // 연장 또는 watch_verdict
  { id: "T26", priority: 7, on: ["obligation.resolved", "obligation.deferred", "obligation.transferred", "obligation.waived", "integration.completed"],
    from: ["A.confirm"], when: (v) => (v.acceptance?.decision === "accepted" || v.acceptance?.decision === "conditional") && v.obligations.open === 0,
    target: { kind: "plan" }, decidedBy: "kernel", guards: ["G1"], trigger: "plan" },
  { id: "T31", priority: 7, on: ["situation.assessed"], from: ["O"], when: (v, ev) => demotable(v, ev),
    target: { kind: "demote" }, decidedBy: "kernel", guards: ["G1"], trigger: "plan" },
  { id: "T32", priority: 7, on: ["workunit.concluded"], from: ["C.commit"], when: (v) => v.current!.writeObserved && v.submission === null,
    target: { kind: "stay", then: "workunit", purpose: "submit" }, decidedBy: "kernel", guards: ["G1"], trigger: "contract_exit" },  // 두 번째면 submission_missing
  { id: "T33", priority: 7, on: ["probe.planned"], from: I_ALL, when: (v) => v.probes.some(p => p.status === "planned"),
    target: { kind: "loop", to: "C.probe" }, decidedBy: "kernel", guards: ["G1"], trigger: "plan" },
];
```

`reassessSignal`, `autoVerifyUnexpected`, `staleFindingUsedBy`, `insufficientEvidence`, `allProbesFolded`, `acceptedAgainstOldVersion`, `budgetScopeIsActivation`, `emergencyStabilized`, `demotable`는 `transitions/signals.ts`의 순수 함수이고 단위 테스트를 각각 둔다. 같은 우선순위 안에서는 배열 순서가 먼저다. `firstMatchingRule`은 우선순위 오름차순, 배열 순서대로 `on`·`from`·`when`을 보고 처음 맞는 규칙 하나를 돌려준다.

#### 3.9.3 우선순위

같은 Concern에 여러 계기가 같은 처리 순서(같은 이벤트 배치)에서 생기면 다음 순서로 하나만 적용하고 나머지는 다음 이벤트에서 다시 평가한다.

1. 사람의 직접 지시(T20), 사람의 결과 확인 답(T09~T11), 이의(T28)
2. 혼돈 신호(T07의 `chaos_signal`)
3. 커널 거부에 대한 처리(§3.9.4 표)
4. 상황 유형 변경(T07), 예상 밖 결과(T08)
5. 판단 이의(T27), 놀라운 관찰(T01)
6. 구조(T14, T15, T30)
7. 그 밖의 규칙(T03, T04, T12, T13, T16~T18, T21~T26, T31, T32)
8. 계약 종료 결과의 다음(`EXIT`)
9. 계획 다음 단계

#### 3.9.4 의존 규칙이 전환에 미치는 영향 (오케스트레이션 측)

집행(거부)은 커널(10)이 한다. 오케스트레이터는 거부가 일어나지 않게 미리 맞추고, 거부되면 정해진 처리를 한다.

| 규칙 | 표시 | 오케스트레이터가 미리 하는 일 | 커널이 거부했을 때의 처리 |
|---|---|---|---|
| (1) write·send에는 C(작업 합의) 필요 | [결정 15] | write나 send가 들어 있는 WorkUnit은 활성 합의가 있을 때만 요청한다. 합의가 없으면 `draft_agreement` WorkUnit을 먼저 돌린다. 합의 출처 세 가지: 사람 확정(`agreement_confirm`), 상시 합의(비상·절차), 사람의 직접 지시에 범위가 들어 있음(지시 자체를 사람이 쓴 합의로 기록하고 요약을 되돌려 보여 준다, canon-2 §3.6 "명확한 직접 지시") | 거부된 도구 호출은 관찰이 아니다(canon-2 L20). WorkUnit이 같은 거부를 2번 받으면 마무리시키고 `scope_exceeded` 접점을 연다 |
| (2) "완료"에는 A 필요 | [결정 15] | Concern을 `completed`로 닫는 명령은 결과 확인(사람)과 반영 항목 처리가 끝난 뒤에만 보낸다. 탐구만 한 Concern도 A.confirm을 지난다. 완료가 아닌 종료는 `S.close`(not_completed) | `A.confirm`으로 전환한다. 제출이 없으면 직전 C의 `submit` WorkUnit을 돌린다 |
| (3) 판단 승격에는 I의 근거 필요 | [결정 15] | `promote_request`는 I.fact, I.outcome 계약에만 노출한다. 다른 루프의 추측은 판단으로 올리지 않는다 | 승격 거부는 정상 결과다. 같은 추측에 대한 승격 요청은 새 근거(관찰·반증 탐색)가 생기기 전까지 다시 보내지 않는다(G1의 변형) |
| (4) 하위 Concern이 있는 Concern은 재조합 확인 후에 닫힌다 | [제안] (결정 15가 [제안]으로 둔 규칙) | 하위가 모두 끝나면 `S.recombine`을 자동으로 활성화한다(T30). 상위의 닫기는 `S.recombine → A.confirm` 뒤에만 보낸다 | 상위를 대기(children)로 두고 하위 상태를 다시 확인한다. 사람이 명시적으로 닫으면 예외(`S.close`) |
| (5) Goal 변경은 사람 확인 | [제안] (결정 15가 [제안]으로 둔 규칙) | `goal_revise` 제안(10 `goal.revise`)은 커널이 항상 `goal_revision` 질문(권리 게이트)으로 만든다. 자동 적용하지 않는다. 답을 기다리는 동안 Concern은 계속 진행하되, 새 Goal 버전에 기대야 하는 C 활성화는 미룬다 | 해당 없음(오케스트레이터가 직접 변경을 보내지 않는다) |

규칙 (5)는 작은 정제까지 매번 사람 확인을 요구하므로 너무 엄격할 수 있다(v0.3 03 §5 끝). 이 문서는 규칙을 그대로 두고, 같은 Goal에 대한 수정 제안이 하루에 여러 건이면 한 질문으로 묶어 사람 조작을 줄인다(§3.13.5).

#### 3.9.5 재진입 가드

전환이 끝없이 반복되거나 진전 없이 오가는 것을 막는다(감사 §3.6 "재진입 규칙표의 가드 열"). 가드는 순수 함수이며 모두 이벤트 로그에서 계산한다.

| id | 이름 | 규칙 | 걸렸을 때 |
|---|---|---|---|
| G1 | 한 계기 한 번 | 같은 `(trigger.eventId, ruleId)`로는 전환을 한 번만 만든다(`idempotencyKey`). 재시작 후 다시 처리해도 같은 키라 커널이 중복을 버린다 | 무시 |
| G2 | 진전 없는 순환 | 직전 "진전 이벤트" 이후 이미 활성화한 루프 계열로 다시 들어가는 것을 순환 1회로 센다. 진전 이벤트: 새 판단, 기준·선호 모델 버전 변경, 합의 버전 변경, 결과 제출, 결과 확인 답, 상황 유형 변경, 사람의 답, 새 하위 Concern. 순환이 `maxCyclesWithoutProgress`(기본 3)에 이르면 | 전환하지 않고 `progress_stall` 접점(정보 게이트, 협상)을 연다. 사람 답은 진전 이벤트다 |
| G3 | 재판정 간격 | 자동 재판정(O)은 직전 판정 뒤 새 근거가 있을 때만, 24시간에 2번까지 | `progress_stall` 접점 |
| G4 | 수정 요청 반복 | 같은 합의에서 수정 요청(T10)이 `maxRevisionRounds`(기본 3)번째면 | `C.commit`으로 가는 대신 직전 I로 가자는 제안을 결과 확인 질문의 선택지에 넣는다(사람이 고름) |
| G5 | 예산 | 새 WorkUnit을 여는 전환은 Concern 예산(§3.13.2)이 남아 있을 때만 | 대기(human), `budget_extension` 접점 |
| G6 | C/A 사람 조작 상한 | §3.13.7(01 R-OP) | 묶기를 먼저 시도. 그래도 넘으면 진행하되 실행 기록에 남김 |
| G7 | 제자리 전환 | 현재 루프와 같은 식별자로의 전환은 `restart: true`와 이유가 있을 때만 | 무시하고 관찰로 남김 |
| G8 | 구조 상한 | S.split 결과가 `maxChildren`, `maxDepth` 안 | `structure_limit` 접점 |
| G9 | 막힌 행동 | 권리 게이트 답을 기다리는 행동과 같은 행동이 필요한 WorkUnit은 답이 올 때까지 요청하지 않는다 | 대기(human) |

사람이 지시한 전환(T20)과 이의 처리(T28)는 G2, G3, G4, G7을 받지 않는다. 의존 규칙과 G1, G5, G8은 받는다.

#### 3.9.6 혼자 정한 결정으로 기록하는 오케스트레이션 결정

다음은 모두 사람에게 묻지 않고 정한 것이므로 `autonomous: true`와 `whyNotAsked`를 가진 기록이 되고 이의를 걸 수 있다(v0.3 06 §4.2). 기록 형식과 화면 묶음은 11·04가 정한다.

| 결정 | 레코드 | whyNotAsked 기본 문구 [제안] |
|---|---|---|
| 루프 계획 생성·수정 | LoopPlanCore | "루프 계획은 권고이며 언제든 바꿀 수 있어 묻지 않았습니다" |
| 루프 전환(kernel, agent:<역할>) | LoopTransitionRecord | kernel: "규칙 {ruleId}에 따른 이동입니다", agent:<역할>: "모델이 {reason} 때문에 옮겼습니다. 되돌릴 수 있어 묻지 않았습니다" |
| 상황 판정 | SituationAssessmentRecord | "판정 질문의 답으로 계산했습니다. 이의를 걸면 다시 판정합니다" |
| S 동작(분해·병합·독립·재배치·보류) | 구조 이벤트 + Choice | "구조 변경은 되돌릴 수 있어 다음 작업 경계에 알립니다" |
| 모드 라우팅 | Choice(kind `mode_routing`) | "입력과 상황 유형으로 골랐습니다" |
| 진입 판정(Concern으로 열기, 가벼운 작업으로 두기, 제안) | 08 EntryAssessment(`entry.evaluated`, `decision`: `enter`·`suggest`·`light_work`, `autonomy` 필수) | "진입 신호 {n}개로 판정했습니다" |
| 강등(가벼운 작업으로 내리기) | 구조 변경(`structure.changed`, 동작 `close`, 사유 `demotion`) + 같은 요청의 가벼운 작업 | "명확한 작업으로 판정했습니다" |
| 가벼운 계획(Concern 유지) | LoopPlanCore(planDetail.cause `procedure` 또는 `initial`, reason "가벼운 계획") | "명확한 작업으로 판정했습니다" |
| 증명 부담 자동 상향 | LoopPlanCore의 `planDetail.proofBurdenRequired` | "다음 신호 때문에 올렸습니다: …" |

#### 3.9.7 규칙 id와 08 `TransitionTrigger`의 대응 [08 §5.2 요구 (2)]

`loop.transition`의 `trigger`(08 §3.15 `TransitionTrigger`)와 `ruleId`는 다음처럼 짝짓는다.

| ruleId | trigger | ruleId | trigger |
|---|---|---|---|
| T01 | `surprise` | T17 | `preference_changed` |
| T02 | `goal_conflict`(전환이 생길 때만) | T18 | `prediction_due` |
| T03 | `out_of_scope` | T20 | `human_directive` |
| T04 | `insufficient_evidence` | T21, T22, T26, T30, T31, T33 | `plan` |
| T05 | `shared_premise_conflict` | T23, T32 | `contract_exit` |
| T07, T24 | `situation_changed` | T25 | `probe_grow` / `probe_fold` / `plan`(판정에 따라) |
| T08 | `unexpected_result` | T27 | `surprise` |
| T09 | `unresolved` | T28 | `objection` |
| T10 | `revision_requested` | EXIT | `contract_exit` |
| T11 | `criteria_wrong` | OPEN | `open` |
| T12 | `probe_grow` | REDIRECT | `entry_redirect` |
| T13 | `probe_fold` | (쓰지 않음) | `reflection`(T06), `assumption_expiry`(T19)은 루프를 바꾸지 않는다 |
| T14 | `split_needed` | | |
| T15 | `merge_needed` | | |
| T16 | `expectation_timeout` | | |

커널은 루프 전환을 스스로 내지 않는다. 결과 확인 거절·기준 틀림(10 `result.accept`)과 이의(10 R-8)에서 커널은 레코드 상태, Concern 재개(종료 상태일 때만 `concern.reopened`), 영향받은 WorkUnit 멈춤(`workunit.paused(objection)`), 재결정 질문까지만 같은 트랜잭션에 남기고, 도착 루프는 오케스트레이터가 T09·T11(도착 = `reopenTo`)과 T28(§3.12.4)로 R 채널에 낸다. 이유 문장으로 도착 루프를 고르는 일은 코드 규칙과 모델 선언으로 나눠 오케스트레이터가 맡는다.

### 3.10 모드 [결정 3: 정의 / 제안: 목록·값·라우팅]

#### 3.10.1 정의 데이터

모드 = 루프 계획 기본값 + 능력 부분집합 + 다이얼 값(결정 3). 모드는 성격 설정(페르소나)이 아니며, 에이전트에게 "꼼꼼한 검토자" 같은 역할 문장을 주지 않는다. 모드가 붙는 단위는 Concern이고, WorkUnit은 Concern의 모드를 물려받는다(대화 L3481, X4 2-22). WorkUnit 하나만 다른 모드로 돌려야 하면 사람의 직접 지시(층 6)로 한다.

```ts
export type ModeId =
  | "orient" | "investigate" | "deliberate" | "taste"
  | "execute" | "verify" | "restructure" | "emergency";

export interface ModeDefinition {
  id: ModeId;
  nameKo: string;
  description: string;
  centerLoops: readonly LoopId[];
  /** 루프 계획 기본값. "by_situation"이면 상황 유형의 기본 조합(§3.7.4)을 쓴다 */
  planTemplate: readonly PlanStep[] | "by_situation";
  /** 능력 부분집합. 루프 계약 능력과 교집합을 취한다(§3.10.4) */
  capabilities: {
    primitives: readonly Primitive[];
    records: readonly RecordCapability[];
  };
  /** 다이얼 값(설정 층 3). 정의하지 않은 다이얼은 아래 층 값을 쓴다 */
  dials: DialPatch;
  fitsSituations: readonly SituationType[];
  /** 화면에서 먼저 보장할 OPD+C 기준(대화 X3-7-16의 "우선 보장할 기준", 감사 §3.5) */
  opdcFocus: readonly ("O" | "P" | "D" | "C")[];
  /** 원전 F06 §9 운영 모드와의 대응(문서용) */
  f06?: "Explore" | "Build" | "Stabilize" | "Incident" | "Reflect";
}
```

#### 3.10.2 모드 목록

v0.3 07 §4의 일곱 모드에 "선택 검토"(deliberate)를 더했다. 되돌리기 비싼 선택(UC-07)은 사실·가능성·결과 탐구를 함께 쓰는데, 원인 조사 모드는 사실 탐구 중심이고 취향 탐색 모드는 원함 탐구 중심이라 맞는 모드가 없었다. 이름은 탐구 이름과 겹치지 않게 지었다(v0.3 07 §4).

| id | 이름 | 중심 루프 | 계획 템플릿 | 원시 행동 | 기록 능력 | 다이얼(층 3) | 맞는 상황 | OPD+C 우선 | F06 |
|---|---|---|---|---|---|---|---|---|---|
| `orient` | 복귀 안내 | O | by_situation | read, spawn, ask | observe, propose | 전달 예약, 질문 문턱 모두 적게 | 모든 Concern의 첫 O(라우팅 전), 며칠 만에 돌아옴 | O, P | – |
| `investigate` | 원인 조사 | O, I.fact | by_situation | read, execute, spawn, ask | observe, propose | 전달 협상, 깊이 4, 근거 범위 문서까지 | complicated | O, C | Explore |
| `deliberate` | 선택 검토 | I.fact, I.possibility, I.outcome | `O → I.fact(선택) → I.possibility → I.outcome → C.commit → A.confirm → A.reflect` | read, write, execute, spawn, ask | observe, propose | 관점 폭 넓게, 깊이 3, 근거 범위 웹까지, 증명 부담 heavy, 독립 검증 always | complicated이면서 되돌리기 비싼 선택(UC-07) | C, P | Explore |
| `taste` | 취향 탐색 | O, I.want, I.possibility, C.probe, A.watch | by_situation | read, write, execute, spawn, ask | observe, propose | 전달 예약(라운드 경계), 관점 폭 넓게, 근거 범위 웹까지, 자극 수 8, 자율 1 | complex(취향형 작업, 흐린 목표, UC-01) | C, D | Explore |
| `execute` | 실행 | C.commit, A.confirm | by_situation | read, write, execute, spawn, ask, send | observe, propose | 전달 협상, 증명 부담 standard | clear, 결정이 끝난 complicated | P, D | Build |
| `verify` | 검증 | A.confirm | `O → A.confirm` | read, write, execute, spawn | observe, propose, attest | 질문 문턱 모두 적게(결과 확인만 즉시), 독립 검증 always | 리뷰·사실 확인 요청 | O, C | Stabilize |
| `restructure` | 구조 정리 | S.* | `O → S.split 또는 S.merge → (하위·대상 Concern의 계획)` | read | observe, propose | 전달 예약 | disorder, Concern이 엉킴 | O, C | – |
| `emergency` | 비상 | C.emergency, O | by_situation | read, write, execute(비상 합의 범위 안) | observe, propose | 범위 밖 전달 즉시, 자율 0 | chaotic | P, O | Incident |

- 원전 F06 §9의 Reflect 모드에 대응하는 모드는 두지 않는다. 돌아보기는 어느 모드에서든 `A.reflect` 루프로 한다.
- `verify` 모드의 `attest`는 검증 에이전트 역할(verifier) WorkUnit에만 의미가 있다. 작업 에이전트 역할 WorkUnit에는 능력 행렬(10)이 attest를 주지 않는다.
- 모드의 원시 행동은 그 모드를 집으로 삼는 루프(`LOOP_HOME_MODE`)의 계약 원시 행동과 WorkUnit 템플릿 원시 행동을 모두 덮는다. `taste`의 execute는 C.probe(필수)와 A.watch 측정 때문이고, `verify`의 write는 A.confirm의 `integrate` WorkUnit(반영 범위 합의 안 쓰기) 때문이다. write를 가진 모드라도 실제 쓰기는 활성 합의(의존 규칙 1)와 권한 레이어가 호출마다 좁힌다. 이 성질은 완료 기준 C-1이 검사한다.
- `send`는 `execute` 모드에만 있다. 다른 모드에서 send가 필요해지면 C.commit으로 가면서 모드 전환 규칙(§3.10.4)이 `execute`로 바꾼다. send는 언제나 권리 게이트를 지난다(v0.3 10 §2 "send는 기본값으로 항상 사람의 허락"). 합의의 `sendTargets`는 MVP 커널이 읽지 않으므로 보낼 곳이 합의에 적혀 있어도 질문을 건너뛰지 않는다([판정 J-91], 01 NFR-S-7).
- `ask`가 없는 모드(`restructure`)에서도 사람 접점 질문은 오케스트레이터가 만든다. `ask`는 모델이 질문을 제안하는 능력이다.

데이터 예시:

```ts
// packages/kernel/src/orchestration/modes/catalog.ts
export const MODE_TASTE: ModeDefinition = {
  id: "taste",
  nameKo: "취향 탐색",
  description: "정답이 취향이나 반응에 달린 작업. 자극을 보이고 반응을 받아 선호 모델을 만든다",
  centerLoops: ["O", "I.want", "I.possibility", "C.probe", "A.watch"],
  planTemplate: "by_situation",
  capabilities: {
    primitives: ["read", "write", "execute", "spawn", "ask"],   // execute: C.probe(필수)·A.watch 측정
    records: ["observe", "propose"],
  },
  dials: {
    defaultDelivery: "scheduled",
    perLoop: { I: { defaultDelivery: "scheduled" } },
    breadth: "wide",
    evidenceScope: "web",
    stimuliPerRound: 8,
    autonomy: 1,
  },
  fitsSituations: ["complex"],
  opdcFocus: ["C", "D"],
  f06: "Explore",
};

export const MODE_DELIBERATE: ModeDefinition = {
  id: "deliberate",
  nameKo: "선택 검토",
  description: "되돌리기 비싼 선택. 사실·가능성·결과를 탐구하고 엄격한 근거로 확인한다",
  centerLoops: ["I.fact", "I.possibility", "I.outcome"],
  planTemplate: [
    { key: "s1", loops: ["O"], optional: false },
    { key: "s2", loops: ["I.fact"], optional: true },
    { key: "s3", loops: ["I.possibility"], optional: false },
    { key: "s4", loops: ["I.outcome"], optional: false },
    { key: "s5", loops: ["C.commit"], optional: false },
    { key: "s6", loops: ["A.confirm"], optional: false },
    { key: "s7", loops: ["A.reflect"], optional: false },
  ],
  capabilities: {
    primitives: ["read", "write", "execute", "spawn", "ask"],
    records: ["observe", "propose"],
  },
  dials: {
    breadth: "wide",
    depth: 3,
    evidenceScope: "web",
    proofBurden: "heavy",
    independentVerification: "always",
  },
  fitsSituations: ["complicated"],
  opdcFocus: ["C", "P"],
  f06: "Explore",
};
```

#### 3.10.3 라우팅

라우터는 Concern의 모드를 고른다. v0.3 07 §5의 방식대로 라우팅이 기본 모드를 고르고, 사용자 설정이 그 위에 덮어쓴다. 라우터는 별도 모델 호출을 두지 않는다. O의 assess WorkUnit이 낸 선언(상황 판정, 계획 플래그, 요청 형태)을 코드가 표로 계산한다(결정 14).

요청 형태는 assess WorkUnit이 `frame_packet`에 함께 선언한다.

```ts
export type RequestForm =
  | "resume"      // "어디까지 했지"
  | "review"      // "~ 리뷰해줘", "사실 확인해줘"
  | "cause"       // 원인 불명 증상
  | "choose"      // 여러 방향 중 골라야 함
  | "taste"       // 취향·방향 잡기
  | "do"          // 정해진 일
  | "restructure" // 엉킨 일 정리
  | "incident"    // 장애·사고
  | "unknown";
```

결정표(위에서 처음 맞는 행):

| 순서 | 조건 | 모드 | decidedBy |
|---|---|---|---|
| 1 | 사용자가 모드를 직접 지정(층 5·6) | 지정한 모드 | human |
| 2 | 상황 유형 chaotic 또는 요청 형태 incident | `emergency` | kernel |
| 3 | 상황 유형 disorder 또는 요청 형태 restructure | `restructure` | kernel |
| 4 | 요청 형태 review 또는 계획 플래그 reviewOnly | `verify` | kernel |
| 5 | 요청 형태 resume | `orient` | kernel |
| 6 | 상황 유형 complex | `taste` | kernel |
| 7 | complicated이고 (요청 형태 choose 또는 플래그 consequentialSideEffects) | `deliberate` | kernel |
| 8 | complicated | `investigate` | kernel |
| 9 | clear | `execute` | kernel |
| 10 | 그 밖(판정 전) | `orient` | kernel |

과거 기록(같은 종류 Concern에서 쓰인 모드와 이의 여부, v0.3 07 §5.2)은 v1에서는 라우팅 입력으로 쓰지 않고, 라우팅 Choice에 이의가 걸린 비율만 지표로 남긴다(16). 이의가 걸린 라우팅 기록은 결정표 수정 제안의 자료가 된다(v0.3 07 §5.3). 결정표를 학습형으로 바꿀지는 미결(§7 U-08).

라우팅은 다음 시점에 다시 한다: 첫 O 종료, 상황 유형 변경, 사용자가 모드 지정을 해제함. 사용자가 지정한 모드(층 5·6)가 있으면 상황 유형이 바뀌어도 다시 라우팅하지 않고, 새 유형과 맞지 않으면 그 사실을 복귀 요약에 알린다(질문은 만들지 않는다).

#### 3.10.4 유효 능력과 모드 전환

WorkUnit 하나가 쓸 수 있는 능력은 다음의 교집합이다.

```text
유효 원시 행동 = 계약.capabilities.primitives
               ∩ 모드.capabilities.primitives
               ∩ WorkUnit 템플릿.primitives(있으면)
               ∩ 행위자 역할의 능력(10의 능력 행렬, A)
그리고 실행 시점에 P(합의 범위, 권한 레이어 판정)가 호출마다 더 좁힌다(10, 13).
하위 run(가지, 검증, 하위 호출)의 유효 원시 행동 ⊆ 부모 WorkUnit의 유효 원시 행동(12 §3.14가 집행).
읽기 목적의 execute라도 부모에 execute가 없으면 하위 run에 주지 않는다.
```

루프로 들어갈 때 `계약.requiredPrimitives ⊄ 모드.capabilities.primitives`이면 모드를 바꾼다.

```text
LOOP_HOME_MODE = {
  "O": "orient", "I.fact": "investigate", "I.want": "taste", "I.possibility": "deliberate",
  "I.outcome": "deliberate", "C.commit": "execute", "C.probe": "taste", "C.emergency": "emergency",
  "A.confirm": "verify", "A.watch": "taste", "A.reflect": "orient",
  "S.*": "restructure"
}
enterLoop(L):
  if required(L) ⊆ mode.primitives: 모드 유지
  else if 사용자가 지정한 모드(층 5·6): 모드 유지, 대신 모드 능력 부족을 사람 접점(scope_exceeded와 같은 처리)으로 알림
  else: mode = LOOP_HOME_MODE[L]; Choice(kind mode_routing, reason "루프 L에 필요한 원시 행동 X가 모드에 없음") 기록
```

**기능 플래그로 꺼진 모드.** 라우팅과 `LOOP_HOME_MODE`는 `features.enabledModes`에 없는 모드를 고르지 않고 다음 대체 모드를 쓴다: `verify` → `execute`, `deliberate` → `investigate`, `restructure` → `orient`, `emergency` → `orient`. MVP에서 A.confirm의 집 모드는 그래서 `execute`이고(검증 에이전트의 attest는 2단계 기능인 독립 검증과 함께 켜진다), 결정표 4행(review)은 `investigate`가 된다.

`I.possibility`의 집 모드를 `deliberate`로 둔 이유: 가능성 탐구가 필요한 상황은 선택을 앞둔 경우가 많다. complex 상황에서는 `taste` 모드가 이미 read를 가지므로 전환이 일어나지 않는다.

#### 3.10.5 원전 모드와의 관계

| 출처 | 모드 정의 | 이 문서의 처리 |
|---|---|---|
| 원전 F06 §9 | Explore / Build / Stabilize / Incident / Reflect. "Gate 임계치와 ContextProjection을 조정" | §3.10.2의 F06 열로 대응. 정의는 결정 3을 따른다(canon §20.3 #7) |
| 대화 [73] (X3-7-16~17) | 중심 루프 + 쓰는 평면 + 우선 보장할 OPD+C 기준 + profile 기본값. 다섯 모드(복귀, 탐구, 위임, 확인·반영, 돌아보기) | 평면은 루프 계약(§3.4)으로, OPD+C 기준은 `opdcFocus`로, profile은 다이얼 `proofBurden`으로 옮겼다 |
| 대화 [121] (X4 2-12, 4-27) | 묶음 탐색/실행/검증/복귀 안내(능력 + 질문 빈도 + 탐구 폭) | `investigate`·`taste`, `execute`, `verify`, `orient`로 이어진다 |
| v0.3 07 §4 | 일곱 모드 | 그대로 쓰고 `deliberate`를 더했다 |

### 3.11 다이얼 [제안: 목록(v0.3 07 §3)·범위·기본값·해석. 결정 12: 다이얼 수치는 제안]

표시 근거: 다이얼 열네 항목의 목록은 v0.3 07 §3에서 가져온 [제안]이다. 열다섯째 `planAuthoring`은 결정 53(사용자 2026-10-14)의 혼합 방식을 설정으로 고르게 하려고 [판정 J-188]로, 열여섯째 `assumptionDeferOnDowntime`은 [판정 J-197]로 더했다. 탐구 다이얼 다섯(7~11)은 대화 L3543에서 사용자가 대체로 동의했고, 그 밖의 다이얼은 사용자 결정이 없다. 결정 12는 "다이얼 수치는 [제안]"이라고 정했다.

#### 3.11.1 정본 목록

다이얼은 열여섯 항목이다(질문 문턱 세 키는 한 항목으로 묶었다). 열네 항목은 v0.3 07 §3에서 왔고, 열다섯째 `planAuthoring`은 [판정 J-188]로, 열여섯째 `assumptionDeferOnDowntime`은 [판정 J-197]로 더했다. 이 문서가 목록과 값의 뜻을 소유하며, 다이얼을 더하는 일은 판정으로만 한다. 저장·프로토콜 키는 08 §3.15 `DIAL_KEYS`이고(19 `dial.set`의 `key`), 질문 다이얼의 값 이름과 판정에서의 의미는 11 §3.16을 따른다. 08 `DIAL_KEYS`는 키 20개 = 다이얼 키 18개(항목 16) + 구조 설정 키 2개다([판정 J-221], [판정 J-300]). 구조 설정 키는 `structure.max_children`, `structure.max_depth`이며 정본 다이얼 항목에 들지 않는다(같은 저장 장치와 층을 쓴다).

| # | 08 키 | 이름 | 값 | 기본값(층 1) | 루프별 | MVP 노출(01 §3.8) | 의미 소유 |
|---|---|---|---|---|---|---|---|
| 1 | `question.threshold.c1` / `c2` / `c3` | 질문 조건 문턱(조건 1 정책이 처리 못함, 2 결과가 실질적으로 바뀜, 3 지금 묻는 가치) | 조건마다 `few` / `normal` / `many` | 모두 `normal` | 예 | "질문 빈도" 프리셋으로 | 11 §3.3.4 |
| 2 | `question.default_delivery` | 기본 전달 방식 | `immediate` / `negotiated` / `mediated` / `scheduled` | `negotiated`(McFarlane 권고) | 예 | 예 | 11 D-11 |
| 3 | `question.immediate_threshold` | 즉시 승격 문턱 | `high` / `normal` / `low` | `normal` | 예 | 아니오 | 11 D-2, D-8 |
| 4 | `question.expiry_margin` | 만료 여유 | 작업 경계 수 0~3 또는 분 | 경계 1개 전(시간형은 max(15분, 20%)) | 예 | 아니오 | 11 §3.6.3, 10·12(부팅 때 계산) |
| 5 | `question.kind_exceptions` | 종류별 예외 | 결정 종류 → `always_ask` / `never_ask` / 방식 지정 | 없음 | 아니오 | 아니오 | 11 D-4 |
| 6 | `question.per_loop` | 루프별 설정 | 루프 계열(O, I, C, A, S)마다 1~4번 값 | 아래 표 | – | 아니오 | 11 D-10, 14 |
| 7 | `inquiry.breadth` | 관점 폭 | `narrow` / `normal` / `wide`(행·열·렌즈 수 변환은 15 §3.4.2) | `normal` | 아니오 | 아니오 | 15 |
| 8 | `inquiry.depth` | 탐구 깊이 | 라운드 수 1~8 | 3 | 아니오 | 예 | 15, 14 |
| 9 | `inquiry.evidence_range` | 근거 범위 | `target` / `docs` / `web` | `docs` | 아니오 | 아니오 | 15, 13(문서 루트는 프로젝트 설정, 13 §3.2.3) |
| 10 | `inquiry.autonomy_rounds` | 자율 정도 | 사람 답 없이 진행할 라운드 수 0~8 | 2 | 아니오 | 아니오 | 14, 15 §3.4.11 |
| 11 | `inquiry.budget` | 예산 | `{ subcalls: 0~200, wallMinutes: 1~600, costUsd?: 0~100 }`. 활성화 하나에 적용 | 루프 계약 기본값 | 아니오 | 예 | 12(집행), 14(배분) |
| 12 | `inquiry.stimulus_count` | 자극 수 | 라운드당 자극 수 4~12 | 8(판정 J-06. 이후 라운드 수는 15 §3.6.3이 이 값에서 계산) | 아니오 | 예 | 15 |
| 13 | `assurance.proof_burden` | 증명 부담 | `light` / `standard` / `heavy`. 화면 이름 가볍게 / 보통 / 엄격(판정 J-12) | `standard` | 아니오 | 아니오 | 10(근거 부담), 14(계획) |
| 14 | `assurance.independent_verification` | 독립 검증 | `off` / `auto` / `always` | `auto` | 아니오 | 아니오(2단계 기능) | 14(검증 WorkUnit 요청), 10(결과 확인 전 검증 기록 확인), 12 |
| 15 | `planAuthoring` | 계획 작성 방식 | `computed` / `hybrid` / `model`(§3.8.5) | `hybrid` | 아니오 | 예([판정 J-192]) | 14 §3.8.5. 층 user·concern([결정 53], [판정 J-188]) |
| 16 | `assumptionDeferOnDowntime` | 데몬 정지 중 가정 만료 미루기 | `on` / `off`. 막지 않는 질문만 대상 | `on`([판정 J-142]) | 아니오 | 아니오 | 11 §3.6.3, 14 §3.11.5. 층은 08 저장 층 셋 전부([판정 J-136], [판정 J-197]) |
| – | `structure.max_children` / `structure.max_depth` | 구조 설정 | 2~12 / 1~5 | 7 / 3 | 아니오 | 아니오(3단계) | 14 §3.6.11, 10 V-STR-01 |

MVP 노출 다이얼 여섯 개(01 §3.8): 기본 전달 방식, 질문 빈도(1번 프리셋), 예산, 자극 수, 탐구 깊이, 계획 작성 방식([판정 J-192]). 나머지는 시스템 기본값과 층 2·3 값으로 동작하고 화면에서 바꿀 수 없다. 2단계에서 열여섯 항목을 모두 노출한다. 근거 범위 `web`은 결정 55에 따라 MVP 도구(`web_fetch`·`web_search`)가 있으므로 쓸 수 있다. 도구를 어느 루프에 내줄지는 13이 정한다.

`question.per_loop` 기본값(층 1, v0.3 06 §5, 11 D-10. 감사 §5.4가 지적한 I행의 "협상, 라운드 경계에 모아서" 혼동은 "예약(라운드 경계), 작업이 막히는 질문만 협상"으로 정리한다). 11 D-10(루프별 기본값)과 D-11(사용자 기본 방식)은 따로 판정하지 않는다. 11은 `resolveDials(…, loop)`가 낸 유효 `defaultDelivery` 하나를 쓴다([판정 J-143], §3.11.5). 사람이 층 4·5에 정한 최상위 `defaultDelivery`는 층 1의 루프별 값보다 우선한다.

| 루프 계열 | 기본 전달 방식 | 메모 |
|---|---|---|
| O | `scheduled`(복귀 요약) | |
| I | `scheduled`(라운드 경계) | 막히는 질문은 11 D-2가 올린다 |
| C | `negotiated` | 범위 이탈은 11 규칙으로 즉시 |
| A | `negotiated` | [판정 J-143]: 대화 [125]에서 사용자가 동의한 "가정하고 진행할 수 있는 질문은 사용자 기본값, 보통 협상"을 따른다. 결과 확인처럼 막는 권리 게이트의 즉시 전달은 11 D-2와 §3.13.5 규칙 1이 정하고, 이 값과 무관하다 |
| S | `scheduled` | |

"질문 빈도" 프리셋(v0.3 07 §3): `few` = 세 조건 모두 `few`, `normal` = 모두 `normal`, `many` = 모두 `many`. 프리셋은 다이얼 목록에 들지 않는 입력 편의다. 고르면 층 4나 5에 `question.threshold.c1~c3` 값이 기록된다.

AND/OR: 질문 조건은 AND 기본이다(결정 16). AND/OR 선택 옵션은 두지 않는다. 실제 사용 후 Concern당 질문 수와 혼자 정한 결정의 이의 비율을 보고 정한다(결정 16, 11 A-1, 지표는 16).

Parasuraman 등의 네 기능별 자동화 수준(정보 수집, 정보 분석, 결정 선택, 실행)은 `question.per_loop`로 표현한다: O ≈ 정보 수집, I ≈ 정보 분석, C의 합의 ≈ 결정 선택, C의 실행 ≈ 실행. 기능별 다이얼을 따로 두지 않는다(X4 b8, d11).

#### 3.11.2 타입과 정의 데이터

코드 안의 해석 결과 객체는 camelCase 필드를 쓰고, 저장·프로토콜은 08 키를 쓴다. 대응은 `DIAL_DEFS`의 `key`가 정한다.

```ts
// packages/kernel/src/orchestration/dials/types.ts
import type { TSchema } from "typebox";                  // 07 §3.11.8
import type { DialKey, DialLayer } from "@helm/domain";   // 08 §3.15. DialLayer는 저장 층(user | concern | instruction)
export type Level3 = "few" | "normal" | "many";        // 11 §3.16
export type Delivery = "immediate" | "negotiated" | "mediated" | "scheduled";
export type ExpiryMargin = { boundaries: 0 | 1 | 2 | 3 } | { minutes: number };   // 데몬 정지 중 미루기는 다이얼 assumptionDeferOnDowntime([판정 J-197])
export type PlanAuthoring = "computed" | "hybrid" | "model";     // 14 §3.8.5, [결정 53]

export interface QuestionDials {
  askThresholds: { c1: Level3; c2: Level3; c3: Level3 };
  defaultDelivery: Delivery;
  immediatePromotion: "high" | "normal" | "low";
  expiryMargin: ExpiryMargin;
}

export interface DialValues extends QuestionDials {
  kindExceptions: readonly { decisionKind: string; policy: "always_ask" | "never_ask" | Delivery }[];
  perLoop: Partial<Record<LoopFamily, Partial<QuestionDials>>>;
  breadth: "narrow" | "normal" | "wide";
  depth: number;                    // 1..8
  evidenceScope: "target" | "docs" | "web";
  autonomy: number;                 // 0..8
  budget: { subcalls: number; wallMinutes: number; costUsd?: number };
  stimuliPerRound: number;          // 4..12, 기본 8
  proofBurden: "light" | "standard" | "heavy";
  independentVerification: "off" | "auto" | "always";
  structure: { maxChildren: number; maxDepth: number };   // 구조 설정 키
  planAuthoring: PlanAuthoring;     // 루프 계획 작성 방식(§3.8.5). 층 1(기본 hybrid)·4·5만 쓴다
  assumptionDeferOnDowntime: "on" | "off";   // 데몬 정지 중 가정 만료 미루기([판정 J-142], [판정 J-197]). 막지 않는 질문만 대상. 기본 on
}

/** 한 층이 정한 값들. 깊은 병합(§3.11.5) */
export type DialPatch = {
  [K in keyof DialValues]?: K extends "askThresholds" | "budget" | "structure"
    ? Partial<DialValues[K]>
    : K extends "perLoop"
      ? Partial<Record<LoopFamily, Partial<QuestionDials>>>
      : DialValues[K];
};

/** 해석 순서(v0.3 07 §6). 08 DialLayer(저장 층 user | concern | instruction)와 다른 이름으로 둔다([판정 J-136]) */
export type DialPrecedence = 1 | 2 | 3 | 4 | 5 | 6;
export const PRECEDENCE_NAMES: Record<DialPrecedence, string> = {
  1: "시스템 기본값", 2: "상황 유형 기본값", 3: "모드", 4: "사용자 저장 설정",
  5: "이 Concern에서 바꾼 값", 6: "지금 이 지시",
};
/** 해석 순서와 08 DialLayer의 대응. 1~3은 저장하지 않는다(코드·데이터에서 계산). Goal 범위 층은 없다([판정 J-136]) */
export const STORED_LAYER: Record<4 | 5 | 6, DialLayer> = { 4: "user", 5: "concern", 6: "instruction" };
// 08 DialSetting.scopeId: user → null, concern → cn_ id, instruction → wu_ id(그 지시로 시작한 WorkUnit)

/** 해석 결과: 값과 그 값이 온 층(화면 표시용, v0.3 09 §4.9) */
export interface ResolvedDials {
  values: DialValues;
  provenance: { [path: string]: DialPrecedence };  // 예: "askThresholds.c3" → 5, "perLoop.I.defaultDelivery" → 1
  proofBurdenRequired?: { level: "heavy"; signals: readonly string[] };   // 자동 상향(§3.11.7)
}

/** 다이얼·설정 정의 데이터. 04 DialsView, 19 dial.set·settings.update의 값 검증, 21 표시가 읽는다.
 *  데이터 파일은 @helm/domain/src/dials.ts에 둔다(19 protocol이 kernel을 import하지 않게). 해석(resolve)은 kernel */
export interface SettingDef {
  key: DialKey | OrchestrationSettingKey;    // 다이얼은 08 키, 설정은 §3.13.2 경로("attention.dailyBudget")
  kind: "dial" | "structure" | "setting";
  nameKo: string;                            // 화면 이름 초안(최종 문구는 05)
  description: string;
  valueSchema: TSchema;                      // TypeBox. 범위와 enum 포함
  default: unknown;
  layers: readonly ("user" | "concern" | "instruction")[];   // 설정은 ["user"]. planAuthoring은 ["user", "concern"]
  perLoop: boolean;
  exposure: "mvp" | "stage2" | "stage3" | "hidden";
  owner: "11" | "14" | "15" | "12" | "10";   // 의미 소유 문서
}
export declare const DIAL_DEFS: readonly SettingDef[];      // §3.11.1 표 + §3.13.2 설정(attention.snoozeUntil·attention.quietHours, notifications.resultReview·resultReviewDigestAt, [판정 J-166], [판정 J-189], [판정 J-195])
```

`independentVerification: "auto"`의 해석: `proofBurden === "heavy"`이면 검증한다. 검증 WorkUnit은 오케스트레이터가 A.confirm 진입 뒤 스케줄러에 요청한다(§3.6.8).

다이얼 변경은 08 `DialSetting`과 09 이벤트 `dial.set`·`dial.unset`으로 기록된다. 사람은 19 `dial.set`·`dial.unset` 메서드(10 명령 같은 이름, 필드 이름은 08 `key`)로 바꾼다. 범위는 08 저장 층 셋(`user`, `concern`, `instruction`)뿐이고 Goal 범위 다이얼은 없다([판정 J-136]. 19·03·20의 Goal 범위는 지운다). 층 6(지시)은 `instruction` 층, `scopeId` = 그 지시로 시작한 WorkUnit id로 저장된다. 그 WorkUnit이 `concluded`·`cancelled`·`superseded`가 되면 해석에서 빠진다. 따로 `dial.unset`을 내지 않는다.

#### 3.11.3 설정 층

v0.3 07 §6의 우선순위를 그대로 쓴다. 아래 층일수록 위 층을 덮어쓴다. 표의 "층"은 해석 순서(`DialPrecedence`)이고, 08 `DialLayer`는 그중 저장되는 4~6의 이름이다([판정 J-136]).

| 해석 순서 | 이름 | 값이 오는 곳 | 기록 |
|---|---|---|---|
| 1 | 시스템 기본값 | §3.11.1 표(코드 상수) | 없음(버전으로 관리) |
| 2 | 상황 유형 기본값 | §3.11.4 표 | 상황 판정 레코드에서 계산 |
| 3 | 모드 | §3.10.2 표 | 모드 라우팅 Choice에서 계산 |
| 4 | 사용자 저장 설정 | 사용자가 설정 화면에서 바꾼 값 | 09 `dial.set`(08 층 `user`) |
| 5 | 이 Concern에서 사용자가 바꾼 값 | 다이얼 패널(v0.3 09 §4.9) | 09 `dial.set`(08 층 `concern`, `scopeId`) |
| 6 | 지금 이 지시 | 지시에 붙은 값(예: "이번엔 웹까지 찾아봐") | 지시 레코드. 지시로 시작한 WorkUnit이 끝나면 사라진다 |

`planAuthoring`은 층 1(기본 `hybrid`)과 층 4·5에서만 정한다. 층 2·3·6은 이 값을 정하지 않는다([판정 J-188]).

자동 상향(§3.11.7)은 층 사이에 끼우지 않고 해석 마지막에 적용한다: 자동 상향이 요구한 `proofBurden`은 층 1~4에서 온 값보다 높으면 그 값을 대신한다. 층 5·6(이 Concern이나 이 지시에서 사람이 직접 정한 값)이 더 낮으면 사람 값을 따르고, "요구보다 낮게 설정됨"을 표시한다(§3.11.7). 층 4(오래전에 저장한 일반 설정)는 특정 Concern의 위험 신호를 알고 정한 값이 아니므로 자동 상향보다 약하다.

#### 3.11.4 상황 유형 기본값(층 2)

v0.3 05 §6의 "다이얼 기본값" 열을 값으로 옮겼다.

| 유형 | 값 |
|---|---|
| clear | 질문 문턱 c1~c3 모두 `few`, `depth` 1, `proofBurden` `light`(자동 검증 근거로 충분), `independentVerification` `off` |
| complicated | 질문 문턱 c1~c3 모두 `normal`, `depth` 4 |
| complex | `breadth` `wide`, `defaultDelivery` `scheduled`, `perLoop.I.defaultDelivery` `scheduled` |
| chaotic | `defaultDelivery` `immediate`(비상 합의 범위 밖 질문), `autonomy` 0 |
| disorder | (없음. 판정 근거 필수는 형식 검사) |

#### 3.11.5 해석 알고리즘

```text
resolveDials(layers: DialPatch[DialPrecedence 1..6], loop?: LoopFamily) → ResolvedDials
  values = deepCopy(layers[1]) ; provenance = 모든 경로 → 1
  for layer in 2..6:
    patch = layers[layer]
    // 스칼라: 덮어씀
    for key in [defaultDelivery, immediatePromotion, expiryMargin, breadth, depth,
                evidenceScope, autonomy, stimuliPerRound, proofBurden, independentVerification, planAuthoring, assumptionDeferOnDowntime]:
      if patch[key] defined: values[key] = patch[key]; provenance[key] = layer
    // 객체: 필드 단위로 덮어씀
    for key in [askThresholds, budget, structure]:
      for field in patch[key]: values[key][field] = patch[key][field]; provenance[key.field] = layer
    // 목록: 같은 kind는 위 층 것이 이김
    kindExceptions = merge by kind
    // 루프별: 필드 단위
    for fam, q in patch.perLoop: for field in q: values.perLoop[fam][field] = q[field]; provenance[perLoop.fam.field] = layer

  if loop given:   // 특정 루프에서의 유효 질문 다이얼
    for field in QuestionDials:
      // 같은 층 안에서는 perLoop가 최상위 값보다 우선한다.
      // 층이 다르면 높은 층이 우선한다: 층 5의 최상위 defaultDelivery가 층 1의 perLoop.O.defaultDelivery보다 우선한다
      eff[field] = 가장 높은 층 L에서 (perLoop[loop][field] ?? 최상위[field])를 정의한 값
  validate(values)   // §3.11.6
  return
```

적용 시점(v0.3 09 §4.9 "값을 바꾸면 다음 턴 경계에서 반영"):

| 다이얼 | 실행 중인 WorkUnit에 반영되는 시점 |
|---|---|
| 1~6, 16(질문) | 즉시(11이 질문을 만들거나 전달할 때마다 해석값을 읽는다. 16은 부팅 때 만료 계산에도 읽는다, 10·12) |
| 7, 8, 9, 12(탐구) | 다음 라운드 경계 |
| 10(자율) | 다음 라운드 경계 |
| 11(예산) | 다음 턴 경계(12가 `prepareRequest` 직전에 다시 읽음). 낮춘 예산이 이미 쓴 양보다 작으면 그 턴 뒤 WorkUnit을 마무리시킨다 |
| 13, 14, planAuthoring | 다음 루프 활성화(계획과 WorkUnit 구성이 바뀌므로). `planAuthoring`은 다음 O 활성화부터 읽는다 |

#### 3.11.6 다이얼이 건드리지 못하는 것(검증 규칙)

어떤 층의 어떤 값도 불변조건 1~7을 바꾸지 못한다(결정 17, v0.3 07 §7). 해석기는 다음을 거부한다(`DialValidationError`, 거부 코드 `invalid.schema`, §4.3).

1. `kindExceptions`의 `never_ask`를 권리 게이트 종류에 거는 것. 검사 목록은 11 결정 종류 레지스트리에서 `humanOnly`인 질문 종류(`agreement_confirm`, `result_review`, `scope_change`, `send_approval`, `goal_revision`, `emergency_authorization`, `goal_achievement`, `policy_change`, `recovery` 등)와 권리 범주 `external.*`·`commitment_acceptance` 등으로 정해지는 종류 전부이고, 이 문서에 목록을 따로 두지 않는다. 권리 게이트는 정보 가치가 0이어도 묻는다(v0.3 06 §3.2).
2. 범위 밖 값(예: `inquiry.depth` 9, `inquiry.stimulus_count` 3).
3. 자동 상향이 요구한 값보다 낮은 `proofBurden`을 층 5·6이 아닌 곳에서 적용하는 것. 그런 값은 거부하지 않고 자동 상향 값으로 대체한다(사람만 Concern 단위로 낮출 수 있다).

다이얼은 얼마나 묻고, 얼마나 넓고 깊게 탐구하고, 얼마나 증명할지만 조절한다. 질문 빈도를 최소로 해도 작업 에이전트가 결과를 확인(accept)할 수 없고, 관찰과 추측의 구분도 그대로다.

#### 3.11.7 Quick/Guided/Assured와의 관계 [제안]

| v0.2 profile | 이 문서의 표현 | 근거 |
|---|---|---|
| Quick | `proofBurden: light`. 강도 프리셋 Quick = `{proofBurden: light, independentVerification: off, 질문 문턱 c1~c3 모두 few}`. 계획에서 O와 C.commit의 합의 초안을 한 WorkUnit으로 합칠 수 있다(§3.16.4 WorkUnit 합치기) | canon §16.6, canon-2 §3.9 |
| Guided(기본) | `proofBurden: standard`. 강도 프리셋 Guided = 시스템 기본값 | v0.2 D3(canon §16.12) |
| Assured | `proofBurden: heavy`. 강도 프리셋 Assured = `{proofBurden: heavy, independentVerification: always, 질문 문턱 c2: many}`. 계획에 `I.outcome`(complicated)과 필수 `A.reflect`를 넣는다 | canon §16.6 |

- 이름: 화면에는 Quick/Guided/Assured를 쓰지 않고 `proofBurden` 값의 이름 "가볍게/보통/엄격"을 쓴다(01 OQ-12 추천을 확정). 위 표의 "강도 프리셋"은 문서 안에서 v0.2와의 대응을 설명하는 이름이다. 프리셋을 고르는 화면이 있다면 고른 결과는 층 4나 5의 다이얼 값으로 기록된다.
- profile 불변(canon §16.6): 어느 강도에서도 의미 경계(기록과 진실, 관찰·해석·가능성·판단·선택 구분, 투영 읽기 전용, 권한 범위, 제출·확인·반영 구분, 모르는 것·이견·낡음 숨기지 않음)는 줄지 않는다. 브리프 불변조건 1~7과 같다.
- 자동 상향: 다음 신호 중 하나가 있으면 `proofBurden`을 `heavy`로 올린다. 올린 값은 다이얼 저장소에 쓰지 않는다(10의 `dial.set`은 사람만 보낸다). 다이얼 해석 때 계산하고, 그 근거는 루프 계획의 `planDetail.proofBurdenRequired`와 이유로 기록한다. 루프 계획은 혼자 정한 결정이므로 사람이 이의를 걸 수 있다.
  - 권한 레이어가 "사람 허락 필요" 또는 "복구 어려움"으로 판정한 행동이 합의 범위에 있음(되돌림 판정은 권한 레이어의 것, 결정 2)
  - O의 계획 플래그 `consequentialSideEffects`가 참이고 다른 열린 Concern·결정과 얽힘(경계 항목 또는 참조)이 있음
  - 원전의 깊이 조절 입력 후보(stakes, coupling, uncertainty, testability, value sensitivity, recoverability, canon-3 I5) 중 모델이 근거와 함께 "높음"으로 선언한 것이 둘 이상
- 하향: 사람만 한다(층 5·6에서). 자동 상향이 요구한 값보다 낮추면 "요구보다 낮게 설정됨" 표시를 남기고 진행한다. 조용히 낮추는 일은 없다(canon-2 §3.9 "silent downgrade 금지").
- 자동 하향은 없다. 위험이 사라졌다는 판단도 사람이 한다.

### 3.12 Concern 오케스트레이션 상태 기계 [제안]

#### 3.12.1 ConcernView

오케스트레이터는 Concern마다 다음 투영을 쓴다. 이 투영은 오케스트레이션 코어의 순수 리듀서 `reduceView(view, event) → view`로 이벤트 로그를 차례로 접어 만든다(D3). 09의 투영 테이블에 의존하지 않는 이유: `decide`가 "그 이벤트 시점의 상태"를 봐야 결정적이기 때문이다. 데몬 시작 시 열린 Concern(과 다시 열릴 수 있는 닫힌 Concern의 요약)의 뷰를 로그에서 다시 만들고, 09가 스냅숏 저장을 제공하면 스냅숏부터 접는다.

```ts
// packages/kernel/src/orchestration/concern/view.ts
import type { AcceptanceDecision, AgreementStatus, Activation, Probe } from "@helm/domain";  // 08 값을 그대로 쓴다(Static 타입)

export interface ConcernView {
  concernId: string;
  goalId: string | null;
  parentId: string | null;
  childIds: readonly string[];
  childrenTerminal: boolean;
  depth: number;                                   // 루트 0
  concernKind?: string;                            // 절차 매칭용 분류(16이 붙임)
  openedAtMs: number;
  pinnedByUser: boolean;                           // 사용자가 우선순위를 고정함

  situation: { type: SituationType; assessmentId: string; confidence: "low" | "medium" | "high";
               atSeq: number; parts?: readonly { label: string; type: SituationType }[] } | null;
  plan: LoopPlanCore | null;
  flags: PlanFlags | null;
  requestForm: RequestForm | null;

  current: {
    loop: LoopId;
    activationId: string;                          // lt_ id
    enteredSeq: number;
    enteredAtMs: number;
    rounds: number;
    roundsWithoutHuman: number;
    workUnitsStarted: number;
    subcallsUsed: number;
    wallMsUsed: number;
    running: readonly string[];                    // 실행 중 WorkUnit id(run.started 뒤 종결 전, interrupted·awaiting_* 포함)
    paused: readonly string[];                     // workunit.paused인 WorkUnit id(이의·합의 만료 등). 오케스트레이터는 이 WorkUnit을 다시 요청하지 않는다
    // 스케줄러 큐는 뷰에 두지 않는다. 큐는 뷰에서 다시 계산한다(§3.13.4)
    stopRuleMet: boolean;                          // 15 이벤트
    writeObserved: boolean;
    exitOutcome?: ExitOutcome;                     // 종료 결과가 정해졌으나 다음 전환이 아직 안 받아들여짐
  } | null;
  activations: readonly { activationId: string; loop: LoopId; enteredSeq: number;
                          exitedSeq?: number; outcome?: ExitOutcome }[];

  mode: { id: ModeId; layer: 3 | 5 | 6; choiceId: string };
  dialLayers: { 4?: DialPatch; 5?: DialPatch; 6?: DialPatch };
  proofBurdenRequired?: "heavy";                   // 자동 상향 요구

  agreement: { id: string; version: number; status: AgreementStatus;     // 08: proposed | active | fulfilled | released | declined | expired | superseded
               activation: Activation["mode"] | null;                   // 08: human | grant | choice_scope | rule | direct_instruction …
               confirmQuestionId?: string } | null;                     // proposed이고 확정 질문이 열려 있으면
  probes: readonly { id: string; status: Probe["status"] }[];                 // 08: planned | running | grown | folded | inconclusive | exhausted | cancelled
  watch: { spec: WatchSpec; extensionsUsed: number; nextSampleAtMs?: number } | null;
  submission: { id: string; atSeq: number } | null;
  acceptance: { id: string; decision: AcceptanceDecision; reopenTo: "C.commit" | "I.fact" | "I.want" | null; atSeq: number } | null;
  obligations: { open: number; deferred: number; closed: number };

  waits: readonly Wait[];
  caCycle: { agreementId: string; humanOps: number; touchpointIds: readonly string[] } | null;
  progress: { lastProgressSeq: number; cyclesWithoutProgress: number;
              autoReassessments24h: number; revisionRounds: number };
  entryPath: "start" | "promotion" | "direct" | "observer" | "split" | "reopen";
  closing: { requestedSeq: number } | null;        // 닫기 요청을 받았고 소유한 WorkUnit이 끝나기를 기다림(§3.12.5-3)
  closed: { result: "completed" | "not_completed"; atSeq: number } | null;
  model: { available: boolean; sinceMs: number };  // 12의 모델 가용 신호(§3.16.2). 모든 Concern에 같은 값
  lastProcessedSeq: number;
}
// 결과 확인 값은 08 AcceptanceDecision(accepted | conditional | revision_requested | rejected | criteria_wrong)을 쓴다.
// 10 명령 값(accept, accept_with_conditions, request_changes, reject, criteria_wrong)은 쓰지 않는다([판정 J-35]).

export type Wait =
  | { reason: "human"; questionId: string; touchpoint: HumanTouchpointKind; blocks: "nothing" | "action" | "workunit" | "concern"; runId: string | null }   // 08 BlockScope, 질문의 runId
  | { reason: "model"; sinceMs: number }                   // 제공자 장애(model_unreachable)로 끝난 run의 다음 요청을 미룸(§3.16.2)
  | { reason: "external"; expectationId: string; dueAtMs: number }
  | { reason: "children"; childIds: readonly string[] }
  | { reason: "watch"; nextSampleAtMs: number }
  | { reason: "held"; revisit: readonly Condition[] | { atMs: number } }
  | { reason: "scheduler"; since: number };
```

#### 3.12.2 상태

오케스트레이터 측 상태는 ConcernView에서 계산하는 값이다. 별도 필드로 저장하지 않는다.

| 상태 | 계산 조건 | 08 Concern 상태(v0.3 02 §4.2)와의 대응 |
|---|---|---|
| `opening` | Concern이 열렸고 첫 전환이 아직 없음 | 열림 |
| `working` | 현재 루프가 있고, 종결되지 않은 run이 있는 WorkUnit이 있거나 다음 WorkUnit을 요청할 수 있음 | 진행 중 |
| `waiting` | `waits`에 막는 대기(`blocks`가 `workunit`·`concern`인 사람 대기, 외부·하위·관찰·보류·제공자 대기)가 있고 진행할 다른 WorkUnit이 없음 | 대기. 대기 이유가 `result_review`면 결과 확인 대기 |
| `accepted` | 결과 확인 답이 `accepted`·`conditional`이고 반영 항목이 남음 | 결과 확인됨 |
| `integrated` | 반영 항목을 모두 처리·미룸, 아직 닫히지 않음 | 반영 완료 |
| `closing` | 닫기 요청을 받았고 소유한 WorkUnit이 아직 끝나지 않음(§3.12.5-3) | 닫히는 중(08 상태는 직전 값 유지) |
| `closed` | 닫힘 이벤트가 있음 | 닫힘 |
| (`reopened`) | 닫힌 뒤 다시 열림 이벤트 | 다시 열림. 곧바로 `opening`과 같이 처리 |

08의 Concern 상태는 이벤트에서 계산되는 투영 값이어야 한다(§5.2 08 요구). 오케스트레이터는 Concern 상태를 바꾸는 별도 명령을 보내지 않고, 전환·질문·결과 확인·닫기 명령의 결과로 상태가 바뀐다.

#### 3.12.3 상태 × 이벤트 표

이벤트 이름은 09 §3.4 카탈로그, 명령 이름은 10 §3.11이다(§3.18). "새 run 요청"은 언제나 스케줄러 큐를 거친다(§3.13.4). 다음 두 원칙이 표 전체에 걸린다.

- **run을 이어 가는 주체는 하나다.** 사람 대기 뒤 이어 가기는 대기 중인 run(`awaiting_human`·`awaiting_recovery`)이 있으면 12가 맡고(커널 지시 `run.signal(resume)` → `ended(handed_off)` + 같은 thread 새 run, [판정 J-38]), 없으면 14가 같은 WorkUnit의 새 run을 요청한다. 구분은 질문 레코드의 `runId`와 그 run의 상태로 한다. 크래시 뒤 `interrupted` run의 재개는 12가 맡는다. 14는 WorkUnit에 종결되지 않은 run(`queued`, `running`, `stopping`, `awaiting_*`, `interrupted`)이 있으면 그 WorkUnit의 새 run을 요청하지 않는다.
- **멈춘 WorkUnit은 다시 요청하지 않는다.** `workunit.paused`(이의, 합의 만료 등)인 WorkUnit은 `workunit.resumed`가 올 때까지 STAY다. 재개 판정(12 `decideResume`)도 같은 조건을 본다.

| 상태 | 이벤트 | 가드 | 다음 상태 | 부수 효과(오케스트레이터 행동) |
|---|---|---|---|---|
| (없음) | `concern.opened` | – | `opening` | 전환 명령(from null → 진입 경로별 첫 루프: 보통 `O`, 직접 지정이면 지정 루프, 혼돈 신호면 `C.emergency`), ruleId `OPEN` |
| `opening` | `loop.transitioned` | – | `working` | 다이얼 해석, 모드 확인(§3.10.4), `runtime.boundary(loop_transition)`, 계약의 첫 WorkUnit 템플릿으로 WorkRequest를 스케줄러에 넣음 |
| `working` | `run.ended(yielded)`, `workunit.concluded` | – | `working` 또는 아래 | 사용량 갱신 → 종료 조건 평가(§3.16.2). 종료면 `resolveNext` → 전환 명령. 아니면 계약의 다음 WorkUnit 요청 |
| `working` | `run.ended(handed_off)` + `handoff` | – | 규칙에 따름 | 선언(§3.5.6)을 전환 규칙으로 평가(T01, T05, T07, T14, T15, T24, 진입) |
| `working` | `run.ended(handed_off)`, `handoff` 없음 | – | `working` | 행동 없음. 같은 thread의 다음 run은 12가 이미 시작했다 |
| `working` | `run.ended(budget_exhausted)`, `run.ended(step_limit)` | WorkUnit이 끝나지 않았고 활성화 예산(G5)이 남음, 같은 WorkUnit에서 이 사유가 3번 미만 | `working` | 같은 WorkUnit, 같은 thread, `context.mode: resume`으로 새 run 요청(12 `RunSpec`, 진행 요약을 이어받음). 벽시계 감시로 끝난 run(12 `budget_exhausted`, code `wall_clock`)도 같다 |
| `working` | 같음 | 활성화 예산 소진 또는 3번째 | `waiting` | `budget_extension` 접점(진행 요약 형식은 §5, 12 §3.11.4가 이 형식을 따른다) |
| `working` | `run.ended(failed)`, `code = model_unreachable` | – | `waiting(model)` | 질문을 만들지 않는다([판정 J-109]). 12의 모델 가용 신호(`onModelAvailability`, §3.16.1)를 받으면 같은 WorkUnit의 새 run을 요청한다. 대기 중인 상태는 17 상태 화면과 복귀 요약에 보인다 |
| `working` | `run.ended(failed)`, 그 밖의 code(`settle_unresolved`, `recovery_error` 등) | 재시도 가능(읽기 전용 WorkUnit, 시도 < 2) | `working` | 같은 템플릿으로 다시 요청(새 idempotencyKey에 attempt 포함) |
| `working` | 같음 | 재시도 불가 | `waiting` | 정보 게이트 질문(`progress_stall`, "WorkUnit 실패", 근거는 run 종료 code)과 실패 관찰 |
| `working` | `run.ended(context_overflow)` | 같은 WorkUnit에서 처음 | `working` | `context.mode: fresh` + 직전 진행 요약으로 새 run 요청(12가 필수 섹션만 넣는다) |
| `working` | 같음 | 두 번째 | `waiting` | `progress_stall` 접점("작업 맥락이 모델 창을 넘음") |
| `working` | `run.ended(cancelled)` | 14의 `stopWork` 또는 닫기 요청 때문 | `working` 또는 `closing` | 전환·닫기 처리를 이어 간다 |
| `working` | 같음 | 사람이 멈춤(19 `work.abort`) | `working` | 같은 WorkUnit을 다시 요청하지 않는다. 다음 사람 입력이나 다른 계기까지 기다린다 |
| `working` | `run.ended(recovery_exhausted)` | – | `waiting` | `progress_stall`(§3.16.5) |
| `working` | `run.ended(superseded)` | – | 그대로 | 무시 |
| `working` | `run.interrupted` | – | `working` | 행동 없음. 재개는 12(§3.7.5) |
| `working` | `question.recorded`, `blocks: workunit`·`concern` | 대기 run이 없음 | `waiting` | 대기 등록(`runId` = 질문의 runId) |
| `working` | `question.recorded`, `blocks: action` | – | `working` | 그 호출만 승인 대기다. run은 계속한다(12 §3.13.1). 오케스트레이터는 같은 행동이 필요한 다른 WorkUnit을 요청하지 않는다(G9) |
| `working` | `command.rejected`(의존 규칙 거부, 10 §3.4.5. `code`로 구분) | – | `working` 또는 `waiting` | §3.9.4 처리 |
| `working` | `workunit.scope_exceeded`, `agreement.scope_change_requested`, `agreement.violation_detected` | 같은 WorkUnit에서 2번째 | `waiting` | WorkUnit 마무리 요청(`runtime.signal(wrap_up)`), `scope_change` 접점이 커널에서 이미 기록됐는지 확인 |
| `working` | `budget.exhausted`(scope = 활성화의 WorkUnit·탐구) | – | `waiting` 또는 다음 루프 | 계약 종료 결과 `budget_exhausted`의 다음. 대기면 `budget_extension` 접점 |
| `working` | `workunit.paused` | – | `working` 또는 `waiting` | 그 WorkUnit을 `paused`에 넣는다. 실행 중 run은 커널 지시가 멈춘다. 다른 WorkUnit은 계속 |
| `working` | `workunit.resumed` | – | `working` | `paused`에서 뺀다. 종결되지 않은 run이 없으면 같은 WorkUnit의 새 run을 요청한다 |
| `working` | 재판정 신호 | G3 통과 | `working` | T07: 실행 중 WorkUnit 마무리 요청(혼돈이면 중단), O로 전환 |
| `waiting` | 질문 종결: `question.answered`, `question.assumed`, `question.delegated`, `question.withdrawn`, `question.expired` | 대기하던 질문 | `working` | 대기 해제. 질문의 run이 `awaiting_human`이면 12가 이어 간다(14 행동 없음). 대기 run이 없으면 14가 답에 따라 처리한다(합의 확정 → execute 요청, 범위 변경 답 → 합의 개정·I·범위 줄이기, `progress_stall`·`budget_extension` 답 → 해당 처리). 권리 게이트 질문은 `assumed`가 되지 않는다(canon-3 C10) |
| `waiting` | 호출 종결: `toolcall.approved`, `toolcall.denied`, `approval.expired` | 승인 대기 호출 | `working` | 대기 run이 있으면 12가 이어 간다([판정 J-40], [판정 J-96]). 대기 run이 없고 WorkUnit이 끝나지 않았으면 14가 같은 thread에 새 run을 요청한다(trigger `approval_granted`, 같은 tcId로 실행). WorkUnit이 이미 결과를 제출했으면 새 run을 요청하지 않는다. 그 승인은 실행되지 않은 채 만료되고, 결과 확인 화면에 "승인됐지만 실행하지 않은 행동"으로 보인다(10에 요구: 승인 대기 호출이 남은 WorkUnit의 결과 제출 처리, §5.2) |
| `waiting(model)` | 모델 가용 신호 | – | `working` | 미뤘던 WorkUnit의 새 run 요청 |
| `waiting` | `expectation.timed_out`("응답 없음" 관찰) | – | `working` | T16: O로 전환 |
| `waiting(children)` | `concern.completed`·`concern.closed`·`concern.merged`(하위) | 하위가 모두 끝남 | `working` | T30: `S.recombine` 전환 |
| `waiting(watch)` | `watch.window_closed` | – | `working` | `watch_sample` WorkUnit 요청 |
| `waiting(held)` | `concern.reopened`(12 타이머 `hold_revisit` → 10) 또는 사람의 `concern.resume` → `concern.resumed` | – | `working` | O로 전환 |
| `working` | `acceptance.recorded`(`accepted` 또는 `conditional`) | – | `accepted` | 반영 항목 확인. 없으면 바로 `integrated` |
| `working` | `acceptance.recorded`(`revision_requested`, `rejected`, `criteria_wrong`) | – | `working` | T10, T09, T11(도착 = `reopenTo`) |
| `accepted` | `obligation.resolved`·`deferred`·`transferred`·`waived`, `integration.completed` | 열린 반영 항목 0 | `integrated` | T26: 계획 다음 |
| `integrated` | (T26 직후) | 계획의 `A.reflect`가 선택 단계 | `closed` | 곧바로 `concern.close`(result `completed`, 행위자 runtime) → `concern.completed`. 돌아보기는 닫힘을 기다리지 않는다(R-OP-5, 02 UC-07 단계 11). 돌아보기는 닫힌 뒤 루프 밖 WorkUnit `reflect`로 한 번 돌린다(§3.12.5-7) |
| `integrated` | (T26 직후) | `A.reflect`가 필수 단계(증명 부담 heavy, C.emergency를 지남) | `working` → `closed` | `A.reflect`로 전환하고 `reflection.recorded` 뒤 `concern.close`(result `completed`). 병합으로 끝나면 `merged`, 완료 아닌 종료는 `closed`(08 §5.2 요구 (4)) |
| 모든 상태 | `loop.transitioned`(행위자 human, 19 `loop.requestTransition` → 10 `loop.transition`(H)), `directive.applied`, `mode.assigned`(사람) | 의존 규칙 | 지시에 따름 | T20: 실행 중 WorkUnit 마무리, 새 활성화의 첫 WorkUnit 요청. 사람 지시는 커널이 이미 기록했으므로 전환 명령을 다시 내지 않는다 |
| 모든 상태(닫힘 포함) | `objection.filed` | `desiredEffect`가 `note_only`가 아님 | 처리에 따름 | T28, §3.12.4 |
| 모든 상태 | 사람의 닫기(19 `concern.close` → 10) | – | `closing` → `closed` | 실행 중 WorkUnit 취소(§3.12.5), 하위가 열려 있으면 사람 확인 질문 |
| `closed` | `concern.reopened`(T17, T18 불일치, T27, 이의) | – | `opening` | O로 전환, 계획 cause `reopened` |
| 모든 상태 | `agreement.declined`·`agreement.discarded`(사람이 초안을 맡기지 않음) | – | `working` | C.commit의 `agreement_confirm` "취소" 처리(§3.6.6): 직전 I로 전환(없으면 `S.hold`). WorkUnit은 `proposed`로 남는다 |
| 모든 상태 | `daemon.safe_mode_entered`(사유는 `crash_loop` 또는 `restored`. 업그레이드 되돌리기도 `restored`다, [판정 J-164]) | – | 그대로 | 스케줄러가 새 WorkRequest 허가를 멈춘다(§3.16.5-6). `daemon.safe_mode_exited`가 남으면 다시 허가한다([판정 J-165]) |

I 계열 단계 run은 15 §3.1.1의 `StageResult` 대응표대로 처리한다. `completed`(run `yielded`)면 다음 `planRound`, `stop`이 있으면 그 종료 결과. `awaiting_human`(run `yielded`)이면 `questionIds`를 `waits`에 넣고 반응·답이 오면 다음 `planRound`. 단계 run은 사람을 기다리며 살아 있지 않으므로 이 대기는 "대기 run 없음" 갈래다. `paused(budget)`(run `budget_exhausted`)면 활성화 예산 처리(G5), `paused(step_failed)`(run `failed`)면 `progress_stall`.

#### 3.12.4 이의 처리 (T28)

혼자 정한 결정에 사람이 이의를 걸면(19 `objection.file` → 10 `decision.contest` → `objection.filed`) 커널은 같은 트랜잭션에서 대상을 contested로 두고, Concern이 종료 상태면 `concern.reopened`, 영향받은 WorkUnit마다 `workunit.paused(objection)`, 재결정 질문 기록까지 한다(10 R-8, 11 §3.10). 루프 전환은 커널이 내지 않는다. 오케스트레이터가 아래 표대로 R 채널(`loop.transition`, ruleId `T28`, trigger `objection`)로 낸다. 커널은 이유 문장으로 도착 루프를 고를 수 없고, 같은 결정점의 재결정이 자율로 정해지지 않는다는 규칙(11 V-AUT-02)은 질문으로 지켜진다.

재결정 질문의 추천 초안: 커널은 추천 없이 질문을 기록한다(커널은 모델을 부르지 않는다). 오케스트레이터는 이의 이유를 사람 출처 관찰로 넣은 재결정 WorkUnit(목적 `deliberate`, fresh, 읽기 전용)을 요청하고, 그 run이 `question.raise`의 같은 `dedupeKey`로 추천을 더해 `question.updated`가 된다(11 §3.10.2, 02 L494).

| 이의 대상 | 오케스트레이터 처리 |
|---|---|
| 상황 판정 | `O`로 전환(재판정). 이의 내용을 사람 출처 관찰로 넣는다. 새 판정이 이전 판정을 대체한다 |
| 루프 전환 | 이의에 원하는 루프가 있으면 그 루프로(decidedBy human). 없으면 출발 루프로 되돌아가는 전환(`restart: true`) |
| 루프 계획 | 사람이 고친 계획이 있으면 그것을 기록(decidedBy human). 없으면 `O`에서 플래그를 다시 선언하게 한다 |
| 분해(`S.split`) | 하위 Concern을 다시 합치는 `S.merge`. 하위에서 한 일은 관찰과 레코드로 남는다 |
| 병합(`S.merge`) | 원래 Concern들을 서술 그대로 다시 연다(`concern.reopened`), 병합된 Concern은 `S.close` |
| 모드 라우팅 | 사람이 다른 모드를 지정했으면 층 5로 고정. 지정이 없으면 결정표의 다음 후보 모드 |
| 진입 판정: Concern으로 연 것 | 강등(§3.14.5): Concern을 `S.close`(not_completed, "진입 이의")로 닫고 가벼운 작업으로 이어 간다. 대상 id는 08 EntryAssessment 레코드다(08 ContestableId에 포함 요구, §5.2) |
| 진입 판정: 가벼운 작업으로 둔 것 | 직접 지정과 같이 Concern을 연다 |
| 강등 | Concern을 다시 연다 |
| 탐침 판정, 지속 관찰 판정 | 판정을 contested로 두고 그 루프를 다시 활성화(`restart: true`) |
| 증명 부담 자동 상향 | 사람이 정한 값을 Concern 층(08 `concern`)에 기록 |
| 작업 중 혼자 정한 선택(`impl.*`, `scope.*`, `value.*`) | 이의 이유가 근거를 문제 삼으면 `I.fact`, 그 선택으로 한 작업을 다시 해야 하면 `C.commit`(재작업, 11 §3.10.3). Concern이 닫혔으면 다시 열고 같은 규칙. 그 선택이 실행에 쓰였으면 계획에 `A.confirm`(재확인)을 넣는다 |
| 가정 확정으로 생긴 선택 | 전환 없음. 재결정 질문만 |
| Grant로 활성화한 합의 | 그 합의의 쓰기를 멈추고(`runtime.signal(wrap_up)`) 루프는 그대로. 커널이 낸 `agreement_confirm` 질문을 기다린다 |
| 범위를 줄인 합의 | `C.commit` |
| 판단·가능성·해석·관찰 | `I.fact` |
| 선호 모델 기준 | `I.want` |

이 표가 이의 뒤 전환의 정본이다(11 §3.10.1의 "전환 기본값" 표를 여기로 합쳤다). 모드 라우팅 이의는 루프를 바꾸지 않고 모드만 바꾼다.

이의로 멈춘 WorkUnit은 이의가 처리되고(`objection.resolved`) `workunit.resumed`가 올 때까지 다시 요청하지 않는다(§3.12.3 원칙).

#### 3.12.5 소유와 취소

pi-durable의 소유 규칙을 빌린다(X3-5-03).

1. Concern은 자기 WorkUnit을 소유하고, WorkUnit은 자기 하위 호출을 소유한다(13).
2. 취소는 아래에서 위로 전파된다. Concern을 닫거나 취소하면 오케스트레이터가 실행 중인 WorkUnit마다 12의 취소를 요청하고, 모든 WorkUnit의 종료 이벤트를 받은 뒤 닫기 명령을 보낸다. 12는 하위 호출을 먼저 정리한다.
3. 소유한 일이 남아 있으면 닫지 않는다. 닫기 요청을 받았는데 WorkUnit이 남아 있으면 `closing` 중으로 두고(ConcernView의 `current.running`이 비지 않음) 닫기 명령을 미룬다.
4. 하위 Concern은 상위가 소유하지 않는다. 상위를 사람이 닫을 때 하위가 열려 있으면 "하위도 닫을까요"를 묻는 사람 접점을 만든다(정보 게이트). 답이 없으면 하위는 `S.detach`로 독립시킨다.
5. 타이머 중 예측 확인(T18)은 Concern이 닫혀도 남는다. 지속 관찰 표본과 다시 볼 조건 타이머는 Concern이 닫히면 취소한다.
6. 하위 실행 기본값(X1 Q13): 발산 가지와 자극 생성은 fork(같은 시점 기록에서 분기, 서로의 결과를 보지 못함), 검증·탐침·반영은 fresh, 같은 활성화 안의 이어지는 WorkUnit은 resume. WorkUnit은 모두 오케스트레이터 입장에서 비동기(백그라운드)이고, WorkUnit 안의 하위 호출의 동기·비동기는 13이 정한다.
7. 루프 밖 WorkUnit: 진입 판정(`entry_assess`, Concern이 열리기 전, 보관 Concern 소속), 예측 점검(`prediction_check`, T18), 닫힌 뒤 돌아보기(`reflect`, 선택 단계일 때)는 루프 활성화에 속하지 않는다(D2의 예외). 셋 다 읽기 전용이고, 제안 종류는 각각 `entry_signals`, `prediction_check`, `reflection`·`change_proposal`뿐이며, 루프 상태를 바꾸지 않는다. 결과는 이벤트로 들어와 오케스트레이터가 판단한다.

### 3.13 거시 스케줄러와 주의 예산 [제안]

#### 3.13.1 하는 일과 하지 않는 일

거시 스케줄러는 여러 Concern 위에서 사람의 주의와 데몬의 실행 자원을 배분한다(X3-8-19). 12와의 경계는 판정 J-13을 따른다: 14는 논리 배분(우선순위, 주의 예산, 활성 Concern 수, 어떤 WorkRequest를 언제 허가할지), 12는 물리 상한(전역 run 수, 제공자 동시 요청, 도구 프로세스 수)과 타이머를 맡는다. 12의 대기열은 14가 허가한 요청만 받는다. 레코드를 바꾸지 않는 배분기다. 판단 결과는 이벤트(지표·경계)로만 남긴다.

| 하는 일 | 하지 않는 일(소유 문서) |
|---|---|
| Concern 우선순위 계산 | 질문 하나의 전달 방식 결정(11) |
| WorkRequest 큐 관리, 동시 실행 제한, 시작 허가 | WorkUnit 실행, 모델 호출, 비용 집행(12) |
| 주의 예산 계산, 사람 접점의 순서·묶음·미루기 권고 | 중재자의 전달 시점 판단(11. 중재자는 스케줄러의 주의 상태를 입력으로 읽는다) |
| 작업 경계 이벤트 발행 | 예약 전달 질문을 실제로 내보내는 일(11) |
| 다시 볼 조건·예측·기대 타이머가 울렸을 때 해당 Concern 오케스트레이터 깨우기 | 타이머 저장과 발화(12) |
| 사용자 복귀 시 복귀 요약 생성 요청 | 복귀 요약 투영 생성(12), 화면(04) |
| 새 Concern 활성화 순서 조절(활성 Concern 수 상한) | Concern 열기 판정(§3.14, 이 문서의 진입 게이트) |

#### 3.13.2 설정

주의 예산과 동시 실행은 사용자 단위 설정이다(D8). 다이얼과 같은 층 구조를 쓰지 않고, 사용자 설정과 시스템 기본값 두 층만 있다. 저장 위치는 §3.20.6(Helm 의미 값은 도메인 이벤트, 운영 한도는 설정 파일).

```ts
// packages/kernel/src/orchestration/macro/settings.ts
export interface OrchestrationSettings {
  attention: {
    dailyBudget: number;              // 하루 주의 비용 단위(§3.13.5). 기본 20
    interruptsPerHour: number;        // 권리 게이트가 아닌 즉시 전달 상한. 모든 기기 합. 기본 2
    maxVisibleDecisions: number;      // 홈 "지금 주의가 필요한 것"에 펼칠 카드 수. 막는 권리 게이트는 수와 무관하게 펼치고, 막지 않는 권리 게이트는 접고 개수를 보인다. 기본 3 (canon §12.10, 01 §3.7, 04 SC-02)
    reviewWindows: readonly { days: readonly (0|1|2|3|4|5|6)[]; start: string; end: string }[]; // 기본 매일 09:00~09:30 하나. 형식은 14 §3.13.2 {days, start, end}([판정 J-331])
    snoozeUntil: number | null;       // 방해 금지. "지금부터 1시간" 같은 일시 방해 금지(05 §3.7.4). 끝나면 null. 방해 금지는 이 값 하나다([판정 J-166])
    quietHours: { start: string; end: string } | null;   // 조용한 시간. 기본 null. 휴대폰 알림을 켤 때 23:00~08:00을 제안(§3.13.8). 19·04·20·26의 키 이름과 맞춘다([판정 J-195])
    timezone: string;                 // IANA. 기본 시스템
  };
  asking: {                           // 다이얼이 아닌 질문 설정(11 §3.16 요구). 의미는 11
    conditionCombine: "and";          // OR은 사용 후 결정(결정 16)
    similarTimeWindowMinutes: number; // 묶음 규칙의 "비슷한 시점" 창. 기본 10
    bundleSize: number;               // 중재자·예약 묶음 상한. 기본 3
    mediatorWaitMinutes: number;      // 기본 2
    approvalValidityHours: number;    // 권리 게이트 승인 유효 기간. 기본 24
  };
  presence: {                         // 접속 상태와 복귀 기준을 한 표로(05 요구 (3), §3.13.8)
    idleAfterMinutes: number;         // 데스크톱·TUI active 보고 유효 시간. 기본 5
    mobileActiveTtlMinutes: number;   // 휴대폰 active 보고 유효 시간. 기본 2([판정 J-119])
    awayAfterMinutes: number;         // 기본 30
    autoOpenBriefAfterAwayMinutes: number;  // 복귀 요약 자동 열기(04 SC-Q1). 기본 120
  };
  notifications: {                    // 알림 경로 설정(결정 56, [판정 J-189], [판정 J-195]). 아래 두 키가 의미 설정이다(settings.update, 09 setting.changed)
    resultReview: "none" | "daily_digest" | "immediate";   // 기본 none. §3.13.5 규칙 7
    resultReviewDigestAt: string;     // "HH:MM", 서버 시간대. 기본 "19:00". daily_digest일 때만 쓴다
    // 기기 설정 여섯 키 showContent·negotiated·dndException·sound·enabled·observer는 이 객체에 두지 않는다. `dndException`은 휴대폰 푸시에만 적용한다 [결정 59]. 기기가 저장하며, 값·기본값의 정본은 20 §3.9.11이다(휴대폰 26이 같은 이름을 쓴다). 내용 보이기 규칙은 05 §3.7.6이다([판정 J-237]). 기기별 시간당 상한 hourlyCap은 등재하지 않는다([판정 J-171]).
  };
  execution: {
    maxConcurrentWorkUnits: number;   // 데몬 전체. 기본 2
    maxConcurrentPerConcern: number;  // 한 Concern의 동시 WorkUnit(탐침). 발산 가지는 12의 자식 run이라 따로 센다. 기본 3
    maxActiveConcerns: number;        // working 상태 Concern 수. 기본 3. 설정으로 바꿀 수 있음(ICS 규칙 6)
    unattendedSpendCapUsd: number | null;  // 사람이 away인 동안 쓸 수 있는 모델 비용. 기본 null(12의 전역 예산만)
  };
  loops: {
    maxCyclesWithoutProgress: number; // G2. 기본 3
    maxRevisionRounds: number;        // G4. 기본 3
    maxAutoReassessmentsPerDay: number; // G3. 기본 2
    maxChildren: number;              // S 상한. 기본 7. 실제 값은 다이얼 저장소 키 structure.max_children의 해석값(§3.20.1)
    maxDepth: number;                 // S 상한. 기본 3. structure.max_depth
  };
  // 진입 문턱(2)은 01 §3.6.3이 고정했으므로 설정에 두지 않는다

  features: { enabledLoops: readonly LoopId[]; enabledModes: readonly ModeId[] };  // §3.15. 기본은 MVP 묶음
}
```

기본값 근거: `maxConcurrentWorkUnits` 2(12의 전역 활성 run 4보다 작게 두어 12 대기열은 물리 상한만 맡게 함, J-13)는 서버 조건(WSL 메모리 상한 10 GB, Wi-Fi 연결, 브리프 §2.5)과 모델 API 요청 한도를 고려한 보수적 시작값이다 [가정]. 실제 한도는 12의 예산·요청 한도와 함께 조정한다. `dailyBudget` 20은 시작값이며 16의 지표(전달된 질문 수, 이의 비율)로 조정한다. `notifications.resultReview`의 기본 `none`은 결정 56의 첫 선택지(알리지 않음, 복귀 요약에서 확인)이고 [판정 J-132]의 동작과 같다([판정 J-189]).

#### 3.13.3 Concern 우선순위

가중치 합 대신 사전식 비교 튜플을 쓴다. 설명하기 쉽고 테스트로 고정하기 쉽다. 원전의 Gate 우선순위 요소(결정 지연 비용, 사람 입력의 기대 가치, 남은 저비용 방향 전환 시간, 다른 일이 이 결정에 의존하는 정도, 맥락 재구성 비용, canon §12.10)를 튜플의 항목으로 옮겼다.

```ts
// 앞 항목부터 비교. 큰 값이 먼저
export function concernPriorityKey(v: ConcernView, now: number, s: OrchestrationSettings): readonly number[] {
  return [
    v.pinnedByUser ? 1 : 0,                                   // 사용자가 고정
    v.situation?.type === "chaotic" ? 1 : 0,                  // 혼돈
    hasPendingRightsAnswerToProcess(v) ? 1 : 0,               // 사람이 답한 권리 게이트를 처리해야 함
    dependentsBlockedCount(v),                                // 이 Concern을 기다리는 다른 Concern·질문 수
    -msUntilNearestDeadline(v, now),                          // 가정 만료점·기대 기한·예측 확인이 가까울수록 먼저
    isCaLoop(v.current?.loop) ? 1 : 0,                        // C/A 우선(§3.13.7)
    v.current?.running.length ? 1 : 0,                        // 이미 진행 중(맥락 재구성 비용)
    lastHumanTouchMs(v),                                      // 사람이 최근에 본 것
    -v.openedAtMs,                                            // 오래된 것
  ];
}
```


#### 3.13.4 실행 허가 알고리즘

Concern 오케스트레이터는 WorkUnit을 직접 시작하지 않고 WorkRequest를 스케줄러 큐에 넣는다.

```ts
// packages/kernel/src/orchestration/macro/work-request.ts
export interface WorkRequest {
  id: string;                         // 결정적: `wr:${activationId ?? concernId}:${purpose}:${ordinal}:${attempt}`. 12 run 레코드의 workRequestKey로 남는다
  idempotencyKey: string;             // = id. 트리거 이벤트와 무관하게 같은 일이면 같은 키
  concernId: string;                           // 루프 밖 WorkUnit도 Concern에 속한다. entry_assess는 프로젝트의 보관 Concern(lightWorkConcernId, ADR-14-9)
  activationId: string | null;                 // 루프 밖 WorkUnit은 null(§3.12.5-7)
  loop: LoopId | null;
  purpose: WorkUnitPurpose;
  step: StepId;
  kind: WorkUnitKind;
  role: AgentRole;
  modelHint: WorkUnitTemplate["modelHint"];
  context: { mode: "fresh" | "fork" | "resume"; sections: readonly ContextSection[]; forkFromSeq?: number };
  primitives: readonly Primitive[];      // 유효 원시 행동(§3.10.4)
  proposalKinds: readonly ContractProposalKind[];
  recordCaps: readonly RecordCapability[];
  agreementId?: string;
  dials: ResolvedDials;                        // 해석된 다이얼(12·15가 읽음)
  budget: { subcalls: number; wallMinutes: number; costUsd?: number };
  instructionsRef: { loop: LoopId | null; purpose: WorkUnitPurpose; modeId: ModeId };  // 지시문 템플릿 선택(12)
  workUnit: { id: string | null;               // 이어 가는 WorkUnit이면 그 id(resume, 승인 뒤 실행, 예산 소진 뒤 이어 가기)
              title: string; intent: string;   // workunit.propose 값. 템플릿 문장 + 모델 선언(합의 초안의 목적, 탐구 질문)에서 만든다
              threadId: string | null };      // 같은 thread에서 이어 갈 때
  directiveId?: string;                        // 층 6
  concurrencyClass: "work" | "probe";          // 12 물리 상한 분류. 탐침 WorkUnit만 probe(Concern당 동시 maxConcurrentPerConcern)
  turnReport?: "entry_signals";                // 가벼운 작업 run이 턴 끝마다 승격 신호를 보고(§3.14.4, 12 §3.4.9)
  createdSeq: number;
  attempt: number;
}
```

```text
admit(queue, running, settings, presence, now):
  if daemonMode != "normal": return                                       // safe mode·읽기 전용이면 허가하지 않는다(§3.16.5)
  candidates = queue를 (concernPriorityKey desc, request.createdSeq asc)로 정렬
  started = []
  for r in candidates:
    if running.total + started.length >= settings.execution.maxConcurrentWorkUnits: break
    if hasLiveRun(r.workRequestKey): continue                             // 12 run 레코드의 workRequestKey로 이미 시작된 것
    if runningFor(r.concernId) >= settings.execution.maxConcurrentPerConcern: continue
    if !isActiveConcern(r.concernId) and activeConcernCount >= settings.execution.maxActiveConcerns: continue
    if isAway(presence, now) and unattendedSpendExceeded(): continue      // §3.17
    if wouldRequestHumanSoon(r) and attentionExhausted(now): defer(r); continue   // 아래. 미룬 요청은 이번에 시작하지 않는다
    started.push(r)
  for r in started: execute(r)                                            // 아래 실행 순서

```

- `wouldRequestHumanSoon(r)`: WorkUnit 목적이 사람 접점을 거의 확실히 만드는 것(`draft_agreement`, `elicit`, 결과 확인 직전의 `verify`)인지. 주의 예산을 다 썼으면 이런 요청은 다음 검토 창이나 다음 날로 미룬다. 단 C/A 단계(`draft_agreement`, `verify`)는 혼돈 Concern이나 사람이 고정한 Concern이면 미루지 않는다.
- **실행 순서(14 실행기).** 허가된 요청마다: (1) 새 WorkUnit이면 `workunit.propose`(R, title·intent는 위 값) → `workunit.proposed`, (2) 합의가 필요한 WorkUnit이면 활성 합의 id를 싣는다(없으면 요청 자체를 만들지 않았다, §3.9.4), (3) `workunit.start`(R) → `workunit.started`, (4) 12 `startRun(RunSpec)`(§3.20.2 변환표, `workRequestKey` = 요청 id). 1판의 `workunit.open`은 쓰지 않는다(10 이름 `workunit.propose`). 각 제출의 멱등 키는 요청 id에서 만든다(`${id}:propose`, `${id}:start`).
- **큐 복구는 한 가지 방법만 쓴다.** 큐는 저장하지 않고 ConcernView에서 다시 계산한다. 재시작 때 열린 Concern마다 `continueActions`(§3.16.4)를 다시 돌려 WorkRequest를 만들고, 같은 id의 run이 이미 있으면(`hasLiveRun`) 버린다. WorkRequest의 id가 결정적이므로 이 계산은 같은 결과를 낸다. `work.requested`·`work.admitted`·`work.deferred`는 실행 기록(trace)일 뿐이고 복구 입력이 아니다(§3.20.5).
- 스케줄러는 새 이벤트가 커밋될 때, WorkUnit이 끝날 때, 타이머(최소 1분 간격)에 `admit`을 돈다.

#### 3.13.5 주의 예산

**단위.** 사람 조작 하나의 비용을 접점 종류별 가중치로 센다(주의 비용 단위). 원전의 attention cost를 세는 방법이 없었으므로(X3 Q16) 다음을 시작값으로 둔다.

| 사람 접점 | 비용 | 메모 |
|---|---|---|
| `send_approval`, `emergency_authorization` | 2 | 막는 권리 게이트. 예산이 없어도 즉시 전달한다 |
| `agreement_confirm`(탐침 묶음 포함), `scope_change` | 1 | 권리 게이트. 실행을 막으면 즉시, 아니면 다음 작업 경계 |
| `result_review`, `goal_revision` | 1 | 막지 않는 권리 게이트. 기록은 즉시, 전달은 다음 작업 경계 또는 검토 창. 만료(사람이 정한 마감) 임박 승격만 `interrupt`로 즉시 전달하는 예외다 [결정 64]. 가정 확정은 없다([판정 J-132]) |
| 가벼운 작업의 `result_review` | 0.5 | 같은 프로젝트의 가벼운 작업 결과 확인은 한 묶음으로 전달하고 한 화면에서 확인한다([판정 J-132], [판정 J-89]) |
| `stimulus_round` | 3 | 원함 탐구의 반응 라운드 |
| 그 밖의 정보 게이트 질문 | 1 | |
| 같은 전달에 묶인 둘째 질문부터 | 0.5 | 묶음 할인 |
| 복귀 요약 열람, "에이전트가 정한 것" 열람 | 0 | 사람이 원해서 보는 것 |

비용은 전달 시점(11의 `question.delivered`)에 센다. 기록만 된 질문은 비용이 없다(v0.3 06 §3.1).

**규칙.**

1. 권리 게이트 질문은 예산과 무관하게 전달된다. 예산은 이 질문들을 숨기지 않는다(canon-3 C3). 막는 권리 게이트는 즉시, 막지 않는 권리 게이트는 다음 작업 경계나 검토 창에 전달한다([판정 J-132]). 만료(사람이 정한 마감) 임박 승격만 `interrupt`로 즉시 전달하는 예외다 [결정 64]. 휴대폰 푸시는 결정 48대로 `interrupt`·`notice` 강도까지 보낸다 [결정 48].
2. 하루 사용량이 `dailyBudget`을 넘으면: 정보 게이트 질문 중 막지 않는(`blocks: nothing`) 것은 다음 검토 창(없으면 다음 날 첫 복귀)으로 미루라고 11에 권고한다(주의 상태 `over_budget`을 10 `KernelContext.attention`으로 넘기고, 11은 `PresenceSnapshot.attention`으로 읽는다). 사람 접점을 곧 만들 WorkRequest의 시작을 미룬다(§3.13.4).
3. 시간당 즉시 전달(권리 게이트 제외)이 `interruptsPerHour`를 넘으면 그다음 즉시 질문은 협상으로 낮추라고 권고한다. 상한을 넘은 알림은 데몬이 한 개로 묶어 보내고, 앱은 받은 묶음을 그대로 보인다([판정 J-198]). 즉시 승격(만료점 임박)은 이 상한에 걸리지 않는다.
4. 조용한 시간(`attention.quietHours`, §3.13.2)에는 권리 게이트 질문도 OS 알림을 보내지 않고 질문함에만 쌓는다(20). 사람이 없으면 어차피 기다린다(§3.17).
5. 같은 시점에 여러 질문이 있으면 묶음을 권고한다: 같은 Concern의 질문, 같은 Goal에 대한 `goal_revision`, 같은 종류의 정보 게이트 질문, 같은 프로젝트의 가벼운 작업 결과 확인. 묶음 구성은 11이 최종 결정한다.
6. "선택 필요" 목록의 순서: 막는 권리 게이트 → C/A 접점(`agreement_confirm`, `result_review`) → 막힌 정보 게이트 → 나머지. 같은 등급은 Concern 우선순위(§3.13.3) 순. 기본 표시는 `maxVisibleDecisions`개다. 막는 권리 게이트는 접지 않는다. 막지 않는 권리 게이트와 나머지는 접고 개수를 보인다(01 §3.7, [판정 J-132]).
7. **결과 확인 알림**(결정 56, [판정 J-189]). 결과 확인 질문의 기록과 전달은 J-132대로다. 결과 확인 대기는 데스크톱에서 배지로만 알린다. 데스크톱 OS 알림은 `notifications.resultReview`가 `immediate`일 때만 띄운다 [결정 60]. 방해 금지 중에는 데스크톱 OS 알림을 띄우지 않는다 [결정 59]. 설정 `notifications.resultReview`는 휴대폰 알림도 고른다. `none`(기본)은 알리지 않고 복귀 요약에서 확인하게 한다. `daily_digest`는 설정 시각(`notifications.resultReviewDigestAt`, 서버 시간대)에 울리는 타이머 목적 `result_review_digest`(`runtime_timers`)를 쓴다. 스케줄러가 설정 시각마다 다음 발화를 다시 건다. 발화하면 확인 대기 결과를 센다. 하나 이상이면 묶음 푸시 하나를 notice 강도로 낸다. 0이면 아무것도 보내지 않는다. 발화가 늦어도 한 번만 낸다(같은 목적의 중복은 §3.16.5-5로 거른다). 휴대폰은 `immediate`일 때 결과 확인 질문이 생길 때마다 notice 강도로 낸다. 두 경우 모두 §3.13.8의 조건(모든 데스크톱 기기 부재), 방해 금지(`attention.snoozeUntil`), 시간당 상한(`interruptsPerHour`)을 따른다. 휴대폰에서 결과를 확인하는 범위는 [판정 J-139]를 따른다.

**지표(16이 집계).** 하루 단위 사용량과 미룬 질문 수는 실행 기록(`attention.*`, 09 §3.11 trace)에 남기고, 16은 `question.delivered`·`question.delivery_planned`(09)에서 다시 계산할 수 있다. 그리고 자동 처리의 오류 쪽 신호로 혼자 정한 결정의 이의 수(놓친 질문, false negative 대리값)와 "답이 임시 가정과 같았던" 질문 수(불필요했던 질문, false positive 대리값)를 남긴다(canon-3 체크리스트 "false negative를 false positive와 함께 측정").

#### 3.13.6 작업 경계

예약 전달 질문을 내보내는 지점이고(v0.3 06 §3.1), 다이얼 변경이 반영되는 지점이다. 경계는 10 명령 `runtime.boundary`(R 채널, [판정 J-93])로 제출되고 09 이벤트 `boundary.reached`가 된다. 11은 이 이벤트를 받아 예약 질문을 전달한다(11 §3.5.1 `DeliveryTrigger`, X4 d7). 값 목록은 08 `WorkBoundaryKind` 일곱 값이다([판정 J-63]).

제출자는 14 하나다. Concern 단위 경계는 오케스트레이터가 계기 이벤트를 처리하는 `decide`에서, 전역 경계는 스케줄러가 낸다. 12·15 실행기는 경계를 제출하지 않는다. 같은 경계가 두 번 나거나 안 나는 일을 막기 위해서다. 멱등 키는 `boundary:${kind}:${계기 이벤트 id}`다.

```ts
// 값은 08 WorkBoundaryKind를 import한다. 계기와 제출자:
//  "round_end"        I.* 라운드 하나가 끝남. 계기 inquiry.round_ended. 제출: 14 오케스트레이터
//  "workunit_end"     WorkUnit 하나가 끝남. 계기 workunit.concluded 또는 그 WorkUnit의 마지막 run.ended. 제출: 14 오케스트레이터
//  "loop_transition"  루프 전환이 받아들여짐. 계기 loop.transitioned. 제출: 14 오케스트레이터
//  "concern_waiting"  Concern이 대기 상태로 들어감(더 할 일이 없음). 제출: 14 오케스트레이터
//  "user_return"      부재 → active(§3.13.8). 계기 presence.changed. 제출: 14 스케줄러
//  "review_window"    설정한 검토 창이 시작됨. 계기 스케줄러 시계. 제출: 14 스케줄러
//  "daily_rollover"   하루 예산 초기화 시각. 계기 스케줄러 시계. 제출: 14 스케줄러
import type { WorkBoundaryKind } from "@helm/domain";

export interface RuntimeBoundaryPayload {   // 10 runtime.boundary 페이로드 요구
  boundary: WorkBoundaryKind;
  concernId: string | null;   // user_return, review_window, daily_rollover는 null
  workUnitId: string | null;
  ref: string | null;         // 라운드 끝이면 탐구 id 등
}
```

"만료 여유"(다이얼 4)의 경계 수는 그 Concern의 `round_end`, `workunit_end`, `loop_transition` 경계를 센다. 11은 질문의 가정 만료점이 몇 경계 남았는지 계산할 때 이 정의를 쓴다.

#### 3.13.7 C/A 우선과 사람 조작 2회 상한

근거: 사용자는 네 루프 중 C와 A를 가장 많이 건너뛴다고 답했다(대화 L2019, X3-2-02). 건너뛴 이유가 마찰이라면 엔진이 묻는 횟수가 늘수록 다시 우회한다. 그래서 C/A 한 번에 사람이 하는 일은 고르기 두 번(합의 확인 한 번, 결과 확인 한 번)이 상한이고, 나머지는 모델이 초안을 채우고 엔진이 검사한다(대화 L2158–2160, X3-2-18~19). 원전 CLI-G01 유즈케이스도 Gate 2개로 끝났다(canon-2 체크리스트).

"C/A 우선"의 오케스트레이션 측 뜻:

1. **C와 A는 건너뛸 수 없다.** 의존 규칙 1·2(§3.9.4)로 write·send와 "완료"는 항상 C·A를 지난다. 오케스트레이터는 C와 A를 생략하는 계획을 만들지 않는다(§3.8.2 8단계).
2. **C/A의 사람 접점은 큐 앞에 둔다.** 정보 게이트 질문보다 `agreement_confirm`, `result_review`를 먼저 보이게 한다(§3.13.5 규칙 6). C/A 접점은 실행을 풀거나 Concern을 닫으므로 기다리는 비용이 크다.
3. **C/A 단계의 WorkRequest를 먼저 시작한다**(§3.13.3 튜플의 `isCaLoop`).
4. **남은 반영 항목은 복귀 요약 맨 위에 보인다**(X3-2-14). 오케스트레이터는 `obligations.open > 0`인 Concern을 복귀 요약 생성 요청에 표시한다.

사람 조작 상한의 집행. 셈법은 01 §3.5.2(R-OP-1~R-OP-6)를 따른다: 변경 WorkUnit 하나의 정상 경로(범위 확대, 권리 게이트, 수정 요청, 실패 없이 끝나는 경로)에서 결정 조작은 합의 확정 1회와 결과 확인 1회가 상한이다. 정상 경로 밖 조작(범위 확대 `scope_change`, 권리 게이트 `send_approval`, 수정 뒤 재확인, 다시 조사 뒤 새 합의, Goal 수정, 이의)은 상한에 넣지 않고 사유(`extraReason`, 01 R-OP-4)와 함께 센다. 그래서 C.commit 계약의 `scope_change`·`send_approval` 접점은 `countsTowardCaCap: false`다(§3.6.6). 원함 탐구의 반응은 상한 밖이다(R-OP-6).

오케스트레이터가 하는 일은 정상 경로에 접점이 더 생기지 않게 하는 것이다.

```text
beforeCreateTouchpoint(t, view):          // 오케스트레이터가 만들거나 커널이 만들 접점에 묶기 권고를 낼 때
  if t가 정상 경로 접점이 아님(01 R-OP-4의 사유가 있음): return create   // 상한 밖, 사유를 붙임
  normal = view.caCycle.humanOps            // 이 WorkUnit의 정상 경로 결정 조작 수(10 humanOps 조회)
  if normal + 1 <= 2: return create
  // 정상 경로에 셋째 접점이 생기려 함. 차례로 시도한다
  1. 묶기: 막히지 않는 질문이면 result_review 질문에 함께 싣는다(묶인 질문은 같은 조작 안에서 답한다)
  2. 범위를 줄여 진행: 합의 범위 안에서 할 수 있는 부분만 하고 나머지를 결과 제출의 "남은 일"로 넘기는 것을
     질문의 추천으로 둔다(Horvitz "불확실할수록 범위를 좁힌다", v0.3 06 §2.2)
  3. 그래도 필요하면 만든다. 이 경우는 설계 결함 신호이므로 실행 기록에 남기고 16이 CA 지표로 본다(01 §3.5.2 수용 조건)
```

- 합의 확정 질문을 아예 만들지 않는 경우(R-OP-2): (a) 사람이 직접 고른 선택의 구조화 범위(선택지의 `scope`) 안임을 커널이 증명할 수 있을 때([판정 J-90], [판정 J-133]. 가정 확정·맡기기로 생긴 선택은 근거가 아니다), (b) 명확한 직접 지시의 echo가 정책이 정한 작은 범위 안일 때. 오케스트레이터는 이 두 경우를 판정하지 않는다. 합의 초안을 제출할 때 근거 선택이 있으면 `activateViaChoice{choiceId}`를 싣고, 10이 판정해 `agreement.activated_by_choice`(a), `agreement.activated_by_grant`(Grant), 또는 확정 질문(`question.recorded(agreement_confirm)`)을 낸다.
- 상한은 사람의 권리(권리 게이트)를 막는 데 쓰지 않는다. 권리 게이트는 정상 경로 밖 조작으로 센다.
- 합의 초안의 필드를 사람에게 하나씩 묻지 않는다. 모델이 여섯 항목을 모두 채운 초안을 만들고 사람은 한 번에 확정하거나 고친다(canon §12.7).
- 반영 항목의 처리 방침(지금 처리, 미루기)은 결과 확인 1회 안에서 함께 고른다(R-OP-3, §3.6.8).
- 결정에 쓰이는 판단의 사람 확인(`finding_confirm`)은 사람이 그 판단을 근거로 선택을 하면 그 선택 요청에, 아니면 다음 C의 합의 확인 질문에 함께 싣는다. 합의가 (a)로 질문 없이 활성되는 흐름(UC-02)에서는 선택 요청에 묶이므로 판단 확인이 빠지지 않는다. 묶인 판단 확인은 선택이 확정되는 같은 조작으로 닫힌다(11 §3.2.2에 요구, 04 "정하면 생기는 일"에 "판단 n도 확인됨"을 보이게 요구).
- 반영 범위 합의는 결과 확인과 같은 조작으로 확정한다(`result.accept.integrationAgreement`, [판정 J-126], §3.6.8). 조건 붙여 확인의 조건 항목은 같은 조작에서 미룬 항목이 된다([판정 J-125]). 그래서 반영이 쓰기를 해도 정상 경로 조작은 2회다(AC-07-09).
- 돌아보기 한 줄은 조작으로 세지 않는다(R-OP-5). 모델이 초안을 쓰고 사람은 나중에 고칠 수 있다.

2주 우회율 지표(대화 L2161–2168)는 01 §3.5.3의 CA 지표로 정의되어 있고 16이 계산한다. 오케스트레이터가 따로 내는 지표 이벤트는 없다(§3.20.5). 계산 재료는 합의·결과·질문 이벤트, `HumanDecisionOp`, 범위 위반 이벤트(`agreement.violation_detected`, `workunit.scope_exceeded`, 게이트 거부의 `command.rejected`), 결과 제출의 "확인 못함" 기준, Concern별 열린 반영 항목이다.

#### 3.13.8 사람의 접속 상태와 시간 기준

스케줄러와 11은 사람의 접속 상태를 입력으로 쓴다. 형식은 11 §3.8.1 `PresenceSnapshot`(기기별 `state`·`sinceMs`·`clientKind`, `allAway`, `activeDevices`, `pushReachable`, `dnd`, `attention`, `focus`)이고, 19·17의 연결 계층이 연결 상태와 19 `presence.report`(휘발 알림)로 기기마다 상태를 정해 바뀔 때만 10 `presence.update`를 제출한다([판정 J-110]). 저장 값은 09 `PresenceState`(`active`, `idle`, `hidden`, `offline`)이고 `locked`는 없다([판정 J-118], [판정 J-119]). 상태가 바뀔 때만 영속 이벤트 `presence.changed`(09)를 남긴다([판정 J-64], J-46 유지). 전달 판정과 `user_return` 경계를 로그에서 재현하기 위해서다. 부재(away)는 저장하지 않고 아래 함수로 계산한다. 11 `urgencyOf`, 26 푸시 계획(`planPush`), `user_return` 판정은 모두 이 함수 하나를 쓴다([판정 J-119]).

```ts
// packages/kernel/src/orchestration/macro/presence.ts
import type { PresenceState, Device } from "@helm/domain";   // 09: "active" | "idle" | "hidden" | "offline"
type ClientKind = Device["clientKind"];                         // 08: "desktop" | "mobile" | "tui" | "cli"
export type AttentionState = "normal" | "over_budget" | "quiet_hours";   // 11 PresenceSnapshot.attention. 스케줄러가 계산

export interface DevicePresence { state: PresenceState; sinceMs: number; lastActiveReportMs: number; clientKind: ClientKind }

/** 기기 종류별 문턱. active 보고가 이 시간 넘게 없으면 그 기기를 idle로 본다(휴대폰은 화면이 꺼지면 보고가 멈춘다) */
export function activeTtlMs(kind: ClientKind, s: OrchestrationSettings): number {
  return (kind === "mobile" ? s.presence.mobileActiveTtlMinutes : s.presence.idleAfterMinutes) * 60_000;   // 기본 2분 / 5분
}

/** 기기 하나의 부재 판단 */
export function isDeviceAway(d: DevicePresence, now: number, s: OrchestrationSettings): boolean {
  if (d.state === "offline") return true;
  const effectiveActive = d.state === "active" && now - d.lastActiveReportMs < activeTtlMs(d.clientKind, s);
  if (effectiveActive) return false;
  const idleSince = d.state === "active" ? d.lastActiveReportMs + activeTtlMs(d.clientKind, s) : d.sinceMs;
  return now - idleSince >= s.presence.awayAfterMinutes * 60_000;   // idle·hidden(또는 낡은 active)이 30분 넘게 이어짐
}

/** 사람의 부재. 11 PresenceSnapshot.allAway가 이 값이다 */
export function isAway(p: { devices: ReadonlyMap<string, DevicePresence>; snoozed: boolean }, now: number, s: OrchestrationSettings): boolean {
  if (p.snoozed) return true;                               // 방해 금지(attention.snoozeUntil이 지금보다 뒤)는 부재로 본다(05 §3.7.4, [판정 J-166])
  for (const d of p.devices.values()) if (!isDeviceAway(d, now, s)) return false;
  return true;                                                       // 기기가 없으면 부재
}
```

`decide`와 스케줄러는 이 함수를 `ctx.now`(트리거 이벤트의 기록 시각, §3.16.1)로 부른다. 그래서 같은 로그를 다시 처리하면 같은 판단이 나온다.

`user_return`은 부재였던 사람의 데스크톱·TUI 기기가 `active`가 되는 전환이다(11 §3.8.1). 휴대폰이 `active`가 되는 것은 복귀로 보지 않는다. 밤에 권리 질문 하나를 답하려고 휴대폰을 열었을 때 예약 묶음이 휴대폰으로 쏟아지지 않게 하려는 것이다. 스케줄러가 `presence.changed`를 받아 판정하고 `runtime.boundary(user_return)`를 제출한다. 같은 복귀에서 두 번 판정돼도 멱등 키(`boundary:user_return:${presence.changed 이벤트 id}`)와 11의 묶음 ID로 한 번만 발화한다.

여러 문서가 쓰는 시간 기준을 한 표로 둔다(05 요구 (3)). 값은 §3.13.2 설정이며 [제안]이다.

| 기준 | 값 | 쓰는 곳 |
|---|---|---|
| active 보고가 끊긴 기기를 `idle`로 보는 시간 | 데스크톱·TUI 5분, 휴대폰 2분 | 11 전달 판정, `isDeviceAway` |
| 부재(away)로 보는 시간 | 모든 기기가 `offline`이거나 `idle`·`hidden`이 30분 | 11 전달 강도·푸시 계획, 14 `user_return` 경계, §3.17 |
| 복귀 요약을 자동으로 여는 부재 시간 | 2시간 | 04 SC-Q1, 20 |
| 관찰 지표의 "부재"·"장기 복귀" | 4시간·24시간 | 16 지표 정의(이 표의 앞 세 값과 독립. 지표용 구간) |

데스크톱·TUI의 부재 → `active` 전환 때 스케줄러는 `runtime.boundary(user_return)`(10)를 제출하고, 부재 시간이 자동 열기 기준 이상이면 복귀 요약 열기를 클라이언트에 알린다(19 뷰 갱신). 복귀 요약 투영은 12가 만든다. 자동 열기는 데스크톱·TUI 복귀에만 적용한다. 휴대폰은 탭 "복귀 요약"에서 연다([판정 J-173]).

알림 상한은 하나로 둔다. `interruptsPerHour`(기본 2, 권리 게이트의 즉시 전달과 만료 임박 승격 제외)는 데스크톱 OS 알림, 휴대폰 푸시를 모두 합친 사람 단위 상한이다. 05·20·26의 상한은 따로 두지 않고 이 값을 읽는다(§5.2, [판정 J-171]). 같은 질문의 데스크톱 알림과 휴대폰 푸시가 겹치지 않게, `notice` 강도의 휴대폰 푸시는 모든 데스크톱 기기가 부재일 때만 보낸다. `interrupt`는 결정 48대로 보낸다. 조용한 시간(`attention.quietHours`)의 기본값은 null이지만, 사람이 휴대폰 알림을 처음 켤 때 앱이 23:00~08:00을 제안값으로 보여 주고 고르게 한다(05·26에 요구). 만료 임박 승격의 강도는 막는 질문과 권리 게이트면 `interrupt`, 막지 않는 정보 질문이면 `notice`로 둔다(11에 요구). 만료(사람이 정한 마감) 임박 승격만 `interrupt`로 즉시 전달하는 예외다 [결정 64].

주의 예산의 데몬 쪽 값(`dailyBudget`, `interruptsPerHour`, `maxVisibleDecisions`, 검토 창, 조용한 시간)은 질문을 언제 놓을지에 영향을 준다. 기기의 알림 켜기·끄기는 기기 설정이라 이 문서의 설정에 두지 않는다.

21의 `AttentionBudgetVM`에 주는 값(21 요구): 단위 = "주의 비용"(§3.13.5 가중치, 화면 이름 "질문"), 창 = 오늘(타임존 기준 0시~다음 0시), `used` = 오늘 전달된 접점 비용 합, `scheduled` = 다음 경계에 예약된 질문 비용 합, `limit` = `dailyBudget`, 다음 묶음 = 가장 가까운 예약 경계.

### 3.14 범주 한정과 진입 경로 [제안]

#### 3.14.1 범주를 한정하는 이유

Helm은 모든 작업에 적용하지 않는다(v0.3 01 §3.1). 이유 네 가지(X3-6-10, 감사 §3.7). 제품 수준의 서술은 01이 소유하고, 여기서는 런타임 동작의 근거로만 적는다.

1. 비용이 이득을 넘는 작업이 대부분이다. Helm은 라운드·질문·기록·확인의 비용을 낸다. 이 비용은 문제 정의가 불확실하거나, 원하는 것을 아직 모르거나, 작업이 여러 날과 여러 작업에 걸칠 때 회수된다.
2. C와 A를 건너뛰게 된 이유와 같다. 마찰이 있으면 우회하고, 모든 작업에 걸면 우회 습관이 Helm이 필요한 작업까지 번진다(A12).
3. 기록이 쌓이는 곳이 일정해야 학습된다. 선호 기록, 제외 사유, 합의 템플릿 개선은 비슷한 모양의 문제가 반복될 때 의미가 있다. 모든 작업을 기록하면 노이즈가 대부분이 된다.
4. Quick 같은 가벼운 강도로는 부족하다. "전부 적용하되 가벼운 건 줄인다"도 결국 입구에서 분류해야 하므로, 입구 분류를 명시적으로 두는 편이 단순하다.

범주는 업무 분야 대신 문제의 모양으로 정한다(v0.3 01 §3.2).

#### 3.14.2 가벼운 작업 [제안, 01 §3.6.4를 따름]

Concern으로 열지 않은 요청은 "가벼운 작업"으로 처리한다(01 §3.6.4, ADR 후보 P1-4). 이 문서 초안의 "일반 세션"은 이 개념으로 바꿨다. 오케스트레이션 측 동작:

- Concern을 열지 않는다. 상황 판정, 루프 계획, 탐구, 모드 라우팅을 하지 않는다. 오케스트레이터의 Concern 상태 기계를 쓰지 않는다.
- 의존 규칙과 불변조건은 그대로 지킨다(결정 15, 17). write·send에는 작업 합의가 필요하지만 압축된 C(요청 echo + R-OP-2, 01 §3.5.2)로 충족한다. "완료"에는 결과 확인이 필요하지만 한 화면 확인으로 압축한다.
- 가벼운 작업은 프로젝트의 Goal에 연결된다. Goal이 없으면 자리표시 Goal("이름 없는 Goal")에 연결한다(01 §3.6.4, 스키마는 08).
- 가벼운 작업도 WorkUnit으로 실행한다. 08 WorkUnit과 12 RunSpec이 `concernId`를 필수로 요구하므로, 프로젝트마다 "가벼운 작업" 보관 Concern을 하나 두고 그 아래 WorkUnit으로 연다(01 OQ-05의 둘째 선택지 [제안], U-02). 보관 Concern에는 상황 판정·루프 계획·전환을 하지 않고, 오케스트레이터의 Concern 상태 기계도 돌리지 않는다. WorkRequest는 `activationId: null`, `loop: null`이고, 유효 원시 행동은 `execute` 모드와 같고, 제안 종류는 `agreement_draft`(echo), `result_submission`, `autonomous_choice`, `question`이다. 스케줄러의 동시 실행 제한을 받는다. 진입 판정 run(`entry_assess`)도 같은 보관 Concern에 속한다.
- 가벼운 작업의 턴 끝마다 승격 신호(§3.14.4)를 센다.

#### 3.14.3 진입 조건과 판정

진입 조건은 01 §3.6.3의 EC-1~EC-5다(v0.3 01 §3.3). 대화의 "되돌리기 비쌈"(X3-6-13)은 결정 2에 따라 빼고 "원하는 것이 취향에 달림"(EC-3)을 넣었다(결정 1). 이로써 취향형 작업이 범주 안에 들어온다(X3 Q11).

| ID | 조건 | 확인하는 질문 |
|---|---|---|
| EC-1 | 목표가 흐림 | 완료 기준을 한 문장으로 쓸 수 없는가 |
| EC-2 | 관점이나 해법이 나뉨 | 원인이나 해법 후보가 둘 이상인데 아직 어느 쪽인지 모르는가 |
| EC-3 | 원하는 것이 취향에 달림 | 정답이 사용자의 취향이나 가치 판단에 달려 있는가 |
| EC-4 | 오래 걸림 | 여러 세션이나 여러 날에 걸치는가 |
| EC-5 | 다른 것과 얽힘 | 다른 결정, 다른 작업, 다른 사람의 일에 영향을 주는가 |

판정 규칙과 타입(`EntrySignal`, `EntryAssessment`)은 01 §3.6.3을 그대로 쓴다. 요약:

판정 결과 값은 08 `EntryAssessmentCore.decision`(`enter`, `suggest`, `light_work`)이다. 01의 `skip`과 02의 `light`는 `light_work`로 읽는다. 판정 함수 이름은 `assessEntry` 하나이고 `decideEntry`는 쓰지 않는다. 진입 판정은 결과와 무관하게 `entry.evaluate`(R)로 기록하고, 강등은 `structure.changed`(S.close, 사유 `demotion`)로 기록한다. 따로 Choice를 만들지 않는다(01 요구).

1. 직접 지정(E3)이면 신호와 무관하게 진입한다.
2. 근거(`evidenceRefs`)가 없는 참 신호는 세지 않는다.
3. 제외 조건(해 보는 비용이 탐구 비용보다 작음)은 진입 규칙보다 우선한다. 단 EC-3이 참이면 제외 조건을 쓰지 않는다.
4. 근거 있는 참 신호가 2개 이상이면 진입, 아니면 가벼운 작업.
5. 문턱 2는 고정값이다. 다이얼로 두지 않는다(01 OQ-04). 2~4주 범주 지표를 본 뒤 다시 정한다.
6. 판정은 혼자 정한 결정으로 기록하고 이의를 받는다(§3.12.4). 판정 때문에 사람 조작을 늘리지 않는다. 묻지 않고 정하고, 틀렸으면 사람이 이의로 바꾼다(01 FX-01).

판정 함수(`assessEntry`)는 I/O 없는 순수 함수이므로 오케스트레이션 코어(§6.1의 `kernel/src/orchestration/entry`)에 둔다. 01 §6은 위치를 `packages/kernel/src/policy/entry.ts`로 제안했다. 두 위치는 같은 패키지(L1 `@helm/kernel`)이며 파일 이름은 10과 맞춘다. 신호 선언은 모델이 제안 종류 `entry_signals`로 낸다.

#### 3.14.4 진입 경로 세 가지

```text
가벼운 작업
  ├─ E1 시작 시 진입: 새 요청이 진입 조건 충족 → Concern으로 시작
  ├─ E2 작업 중 제안: 가벼운 작업에서 승격 신호 → "Concern으로 열까요?"
  │     └─ E2 변형: 관찰 에이전트가 외부 세션 로그·반복 패턴에서 찾아 제안(UC-08)
  └─ E3 직접 지정: 사람이 "Concern으로 열기"(대화의 /focus)
Concern 안에서 단순하다고 판명 → 가벼운 계획 또는 가벼운 작업으로 내림(강등, §3.14.5)
```

(대화 L2458–2465, X3-6-11, 01 §3.6.2)

| 경로 | 계기 | 런타임 동작 | 결정 조작(01 §3.5.2) | entryPath |
|---|---|---|---|---|
| E1 시작 | 사람이 "새 일"로 요청을 보냄(19). 요청에 Concern 지정이 없음 | 루프 밖 WorkUnit `entry_assess`(모델 `cheap`, 도구 read와 `entry_signals` 제안)를 돌린다 → `assessEntry` → `enter`면 `concern.open`(Goal은 §3.14.6) + 요청을 사람 출처 관찰로 연결, `light`면 가벼운 작업으로 시작 | 0 | `start` |
| E2 작업 중 제안 | 가벼운 작업의 턴 끝과 실행 마무리 직전(12의 턴 종료 이벤트)마다 승격 신호를 센다 | 신호 하나로 `entry_suggestion` 질문(정보 게이트, 협상, 임시 가정 "열지 않고 계속")을 만든다(01 §3.6.5). 같은 가벼운 작업에서 거절되면 그 작업 안에서는 다시 제안하지 않는다. 답이 "연다"면 가벼운 작업의 대화 요약과 관찰 id를 Concern에 연결해 연다 | 1(답할 때만, 정상 경로 밖) | `promotion` |
| E2 변형(관찰) | 16이 반복 마찰·잦은 정정을 찾아 제안 | 16의 제안을 받아 `entry_suggestion` 질문(예약 전달, 복귀 요약)을 만든다. 답이 "연다"면 제안의 근거(패턴, 세션 id, 빈도)를 관찰로 넣고 연다 | 1 | `observer` |
| E3 직접 지정 | 사람이 Concern 열기 명령(19) | 진입 판정 없이 연다. 첫 루프는 지정이 있으면 그 루프, 없으면 O | 0 | `direct` |

승격 신호 PS-1~PS-5(01 §3.6.5, v0.3 01 §3.7, X3-6-22). 코드가 이벤트로 세는 것과 모델이 선언하는 것을 나눈다.

| ID | 신호 | 계산 |
|---|---|---|
| PS-1 | 같은 확인(테스트·명령)이 세 번 실패 | 코드: 같은 명령 문자열·테스트 id의 실패 관찰 수 |
| PS-2 | 모델이 서로 다른 해법을 두 개 이상 꺼냄 | 모델 선언(턴 끝 구조화 출력의 `distinctSolutions ≥ 2`) + 코드 집계 |
| PS-3 | 작업 범위가 예상보다 커짐 | 코드: 합의 범위 밖 호출, 또는 바뀐 파일 수가 합의 때 추정의 2배 초과 |
| PS-4 | 사람이 "잘 모르겠는데", "이게 맞나"라고 말함 | 모델 분류(사람 발화 관찰) |
| PS-5 | 사람이 이유 없이 "뭔가 아니다"라고 반응 | 모델 분류(사람 발화 관찰) |

모델 선언 신호는 12가 가벼운 작업의 턴 끝에 붙이는 짧은 구조화 출력으로 받는다(§5.2 12 요구).

#### 3.14.5 강등

Concern 안에서 문제가 단순하다고 확인되면 두 가지 중 하나로 내린다(v0.3 01 §3.7, 01 §3.6.2). O 종료 시점에 판정한다(T31).

| 조건(코드) | 처리 |
|---|---|
| 상황 유형 clear, 확신 high, 계획 플래그가 모두 거짓, 진입 판정의 근거 있는 참 신호 수가 문턱과 같음(겨우 넘음), 경로가 `start`(사람이 직접 연 것이 아님) | 가벼운 작업으로 내림: Concern을 `S.close`(not_completed, 사유 `demotion`, "단순한 작업으로 판정")로 닫고 같은 요청을 가벼운 작업으로 이어 간다. 기록은 `structure.changed` 하나다(혼자 정한 결정, `autonomy` 포함) |
| 상황 유형 clear이고 위 조건 중 일부만 맞음, 또는 사람이 직접 연 Concern | 가벼운 계획: clear의 층 2 기본값이 이미 증명 부담 "가볍게"(light)다(§3.11.4). 여기에 O와 C.commit의 합의 초안을 한 WorkUnit에서 만드는 합치기를 켠다(§3.16.4). 사람이 정한 다이얼 값은 그대로 따른다 |

사람이 직접 연 Concern(`direct`)은 가벼운 작업으로 내리지 않는다. 사람이 정한 것을 모델 판정으로 뒤집지 않는다.

#### 3.14.6 Goal 연결

A1에 따라 Concern은 Goal에 연결되어야 write·send를 할 수 있다(감사 §3.4). Goal을 정하는 데 사람 조작이 하나 더 들지 않게 다음 규칙을 둔다 [제안, 01 OQ-05·FX-13과 같음].

1. 프로젝트마다 자리표시 Goal("이름 없는 Goal", 08 `placeholderGoalId`)을 둔다. 프로젝트를 만들 때 함께 만든다(01 §3.6.4).
2. Goal이 없는 프로젝트의 첫 요청(01 FX-13): 모델이 Goal 초안을 만들고(`goal.propose`) 사람은 SCR-GOAL 초안 카드에서 고치거나 확정한다. 확정 전까지 Concern은 자리표시 Goal에 연결해 진행한다. 08 E-02의 "Goal 없는 프로젝트에서 Concern 열기 거부"는 자리표시 Goal이 있으므로 일어나지 않는다(08에 문장 정리 요구, §5.2).
3. 새 Concern은 O에서 모델이 가장 맞는 Goal을 제안하고 코드가 연결한다(혼자 정한 결정). 맞는 Goal이 없으면 자리표시 Goal에 연결하고 새 Goal 초안(`goal.propose`)을 예약 전달로 만든다.
4. Goal 연결을 바꾸는 것은 `S.relocate`다.

#### 3.14.7 범주 지표

2~4주 뒤 01 §3.6.7의 CT 지표를 본다(v0.3 01 §3.8, X3-6-23). 오케스트레이터는 `entryPath`, 진입 판정 Choice, 강등, Goal·기준·문제 관점 변경 이벤트를 남기고 16이 계산한다.

| ID | 지표 | 해석 |
|---|---|---|
| CT-1 | Concern으로 연 작업 중 실제로 Goal, 완료 기준, 문제 관점이 바뀐 비율 | 거의 0이면 범주가 너무 넓다 |
| CT-2 | 가벼운 작업으로 처리했다가 나중에 방향을 다시 잡은 비율(승격, 같은 대상의 재작업) | 높으면 범주가 너무 좁거나 승격 신호가 약하다 |
| CT-3 | 진입 판정에 대한 이의 비율 | 높으면 신호 선언이나 문턱이 맞지 않는다 |

### 3.15 성숙도 L1~L5 [제안]

원전 운영 이론의 제품 성숙도 모델은 Level 0~5이고(canon §15.11), 대화는 Level 1~5를 루프에 1:1로 대응시켰다(X3-7-06). 브리프 §3.5의 "성숙도 L1~L5"는 이 대응이다. Level 0(Passive Docs Scaffold, 이전 Docs-Agent OS)은 범위 밖이다(canon §16.2 C1).

| 단계 | 이름(원전) | 루프·기능 | 오케스트레이션에서 켜지는 것 | 사용자 가치(원전) | 검증 지표(16) |
|---|---|---|---|---|---|
| L1 | Situation Recovery | O, 복귀 요약 | Concern 열기, O, 상황 판정, 루프 계획, 복귀 시 요약 요청, 작업 경계 | 시간 간격 이후 다시 참여 | 복귀 요약이 원본 로그 재열람을 줄이는가(H1) |
| L2 | Deliberative Inquiry | I.fact, I.want, I.possibility, I.outcome, S(분해·병합 등) | I 계열 계약, 15 연동, 재진입 가드 G2·G3 | 조기 수렴 감소, 근거 있는 판단 | 조기 수렴·결함 감소, 사람이 기준·관점을 바꾸는가(H3, H4) |
| L3 | Bounded Delegation | C.commit, C.probe, C.emergency | 합의 흐름, 범위 초과 처리, C/A 상한 집행 | 목적 일관성과 자율 실행의 결합 | 합의가 범위·권한 오해를 예방하는가(H2), 우회율 |
| L4 | Assured Integration | A.confirm, A.watch, S.recombine | 검증 WorkUnit, 결과 확인, 반영 항목, 재조합 | 지역 완료를 전체 결과로 | 제출과 확인 사이에서 결함이 발견되는가(H10) |
| L5 | Adaptive Institution(1인판) | A.reflect, 관찰 에이전트 제안, 절차(명확 유형), 다이얼 조정 제안 | 돌아보기, 절차 레지스트리 적용, 증명 부담 자동 상향 | 쓸수록 방식이 나아짐 | 돌아보기·제안이 실제 다음 합의·정책을 바꾸는 비율 |

원전 L5의 팀·조직 기억(cross-workspace learning, organizational memory, team Common Operating Picture)은 범위 밖이다(결정 24, canon-3 §6.13 Slice E). 1인판 L5는 여러 프로젝트(워크스페이스)에 걸친 개인 학습(선호 모델, 절차)까지만 다룬다. 상용 UX 조사의 Slice A~D는 L1~L4와 같은 순서다(Slice A Resumption = L1, B Concern Room = L2, C Bounded execution = L3, D Acceptance and Integration = L4, canon-3 §6.13). Slice A의 "active Gate 최대 3개"는 이 문서에서 표시 개수 설정 `maxVisibleDecisions`로 옮겼다(canon-3 C3).

**기능 플래그.** 실제로 켜고 끄는 단위는 루프 식별자다. 01 §3.8의 제품 단계표가 루프마다 단계를 정했기 때문이다. 설정 `features.enabledLoops`(운영 설정, §3.20.6)에 없는 루프는 계획에 넣지 않는다(§3.8.2 5단계, `skipped`에 "기능 미활성").

| 제품 단계(01 §3.8) | 켜지는 루프 | 켜지는 모드 | 그 밖 |
|---|---|---|---|
| MVP | O, I.fact, I.want, C.commit, A.confirm, A.reflect | orient, investigate, taste, execute | 상황 유형 clear·complicated·complex의 기본 조합. 노출 다이얼 6개(기본 전달 방식, 질문 빈도, 예산, 자극 수, 탐구 깊이, 계획 작성 방식([판정 J-192])). 나머지 다이얼은 시스템 기본값으로 동작한다 |
| 2단계 | + I.possibility, I.outcome, C.probe, A.watch | + verify, deliberate(I.possibility와 함께 켠다, 23 §3.5.4) | 다이얼 열여섯 항목 전부 노출, 독립 검증, 중재 전달, 기대 레코드 |
| 3단계 | + S 일곱 동작, C.emergency | + restructure, emergency | 혼돈·혼란 유형의 기본 조합, 의존 규칙 4 |

꺼진 루프를 가리키는 계획·전환은 다음으로 바꾼다.

| 꺼진 루프 | 대체 동작 |
|---|---|
| I.possibility, I.outcome | complicated 계획은 `O → I.fact → C.commit → A.confirm`. deliberate 모드는 쓰지 않는다(라우팅 표 7행을 investigate로) |
| C.probe, A.watch | complex 계획은 `O → I.want → C.commit → A.confirm → (A.reflect)`. 탐침 대신 원함 탐구의 자극(Helm 저장 공간)으로 시도한다 |
| S.* | 판정이 disorder면 `progress_stall`과 같은 정보 게이트 질문을 만들고(모델이 쓴 부분 목록과 부분별 추천 처리를 보이고 사람이 고칠 수 있게 함), 답이 오기 전까지는 대안 유형(`alternative`)으로 계획한다. T14·T15는 "다음 단계에서 가능" 표시로 복귀 요약에 남긴다 |
| C.emergency | 판정이 chaotic이면 `emergency_authorization` 즉시 질문. 사람이 직접 조치하거나 C.commit의 범위를 허락한다 |
| A.confirm | 끌 수 없다(의존 규칙 2). 설정 검증 오류 |

성숙도 L1~L5는 위 표의 루프 묶음이 어떤 사용자 가치를 검증하는지를 읽는 틀로 쓴다. 16의 검증 지표가 단계별로 나온 뒤 다음 루프 묶음을 켠다(01 §3.8 "증거 관문").

**구현 순서와의 관계.** 원전은 "각 Level은 앞 Level의 사용자 가치를 검증한 뒤 진행한다"고 하고(canon §15.11), 대화는 사용자가 C/A를 가장 많이 건너뛰므로 C/A부터 만들자고 했다(X3-8-28: 레코드·로그·권한 → C·A → O → I → 거시 스케줄러 → P 적응). 두 순서는 다른 질문에 대한 답이다. 성숙도 순서는 "어떤 사용자 가치를 먼저 검증하나", 구현 순서는 "어떤 코드를 먼저 짜나"다. 이 문서는 구현 순서를 23에 맡기고, 기능 플래그로 어느 순서로 만들든 켜고 끌 수 있게 한다. MVP 루프 묶음(위 표)은 L1·L3·L4와 L2 일부(I.fact, I.want)에 해당한다.

### 3.16 오케스트레이터 알고리즘 [제안]

#### 3.16.1 구조: decide와 실행기

```ts
// packages/kernel/src/orchestration/concern/decide.ts
export type OrchestratorAction =
  | { type: "command"; command: KernelCommand; idempotencyKey: string }     // 10의 명령(전환, 계획, 판정, 닫기 …)
  | { type: "requestWork"; request: WorkRequest }                         // 스케줄러 큐에 넣기
  | { type: "stopWork"; workUnitId: string; mode: "wrap_up" | "abort"; reason: string }  // 12
  | { type: "createTouchpoint"; touchpoint: TouchpointDraft }             // 11의 질문 생성
  | { type: "setTimer"; timer: TimerRequest }                             // 실행기가 12 타이머로 바꾼다
  | { type: "cancelTimer"; timerId: string }
  | { type: "emitMetric"; event: MetricEvent }                           // 16이 집계할 지표 이벤트
  | { type: "requestReturnBrief"; reason: string };                      // 12

export interface DecideContext {
  now: number;                          // 트리거 이벤트의 기록 시각(envelope recordedAt). 벽시계를 읽지 않는다
  settings: OrchestrationSettings;      // 트리거 이벤트 seq 시점의 설정 투영(setting.changed·dial.set까지)
  contracts: ContractRegistry;
  modes: ModeRegistry;
  guards: GuardRegistry;
  presence: PresenceSnapshot;           // 트리거 이벤트 seq 시점의 presence 투영(presence.changed까지)
  modelAvailable: boolean;              // 12 모델 가용 신호. 깨우기 입력(§3.12.3 waiting(model))에만 쓴다
  daemonMode: "normal" | "safeMode" | "readOnly" | "draining";   // 19 DaemonMode 이름([판정 J-282]). safeMode·readOnly·draining이면 requestWork는 큐에만 남는다
  ids: DerivedIdFactory;                // 제출 레코드 id를 멱등 키에서 결정적으로 만든다(10 §3.3 derivedIdFactory)
}

/** 순수 함수. 같은 입력이면 같은 출력. I/O 없음 */
export function decide(view: ConcernView, event: HelmEvent, ctx: DecideContext): OrchestratorAction[];

// 입출력 타입. 정의는 소유 문서에 있고 이 문서는 import만 한다
import type { HelmEvent } from "@helm/domain";                    // 09 §3.2 envelope + 카탈로그 payload 합집합
import type { KernelCommand, DerivedIdFactory } from "@helm/kernel";  // 10 §3.11 명령 합집합, §3.3 결정적 id
import type { PresenceSnapshot } from "@helm/domain";             // 11 §3.8.1(타입은 domain에 둔다)
import type { MetricEvent } from "@helm/domain";                  // 16
// kernel(L1)은 runtime(L4)을 import하지 않는다. 12의 RunSpec·TimerSpec으로 바꾸는 일은 runtime의 실행기가 한다(§3.20.2)
export interface TimerRequest { purpose: "watch_window" | "hold_revisit" | "prediction_check"; subjectId: string; atMs: number }

/** 11 질문 생성 입력에서 이 문서가 채우는 필드. 오케스트레이터는 이것을 10 question.raise(R) payload로 바꾼다 */
export interface TouchpointDraft {
  kind: HumanTouchpointKind;
  concernId: string;
  workUnitId: string | null;
  blocks: "nothing" | "action" | "workunit" | "concern";   // 08 BlockScope
  bundleWith?: readonly string[];          // 묶기 권고(질문 id)
  draftRef?: string;                       // 모델이 만든 초안 레코드 id. 선택: 모델 장애 때 만드는 접점(progress_stall 등)은 없다
  copyKey: string;                         // 05 문구 키. draftRef가 없으면 종류별 기본 문구 템플릿을 쓴다
  copyArgs: Readonly<Record<string, string | number>>;
  recommendation?: { optionKey: string; reason: string };
  extraReason?: string;                    // 08 HumanOpMeta.extraReason, 지표 계산에는 쓰지 않는다([판정 J-76])
}
```

`ContractRegistry`, `ModeRegistry`는 §3.5, §3.10의 카탈로그를 id로 찾는 읽기 전용 맵이다.

**멱등과 결정성.** 실행기는 행동을 차례로 실행한다. `command`의 멱등 키는 `${triggerEventId}:${ruleId}`(전환), `${triggerEventId}:${purpose}`(그 밖)이고, 게이트 뒤 재제출은 `:after:${questionId}`를 붙인다. 커널 지문(09 §3.9.1)이 payload를 포함하므로, 제출 payload에 들어가는 레코드 id(`loopTransitionId`, `questionId` 등)는 새 ULID로 만들지 않고 `ctx.ids.derive(idempotencyKey, kind)`로 만든다(10 §3.3에 요구). `now`는 트리거 이벤트의 기록 시각이고 설정·presence도 그 seq 시점의 투영이라, 크래시 뒤 같은 이벤트를 다시 처리하면 같은 payload가 나와 커널이 재생 결과(`replayed`)를 돌려준다. `requestWork`는 커널 명령이 아니므로 WorkRequest id(결정적, §3.13.4)를 12 run 레코드의 `workRequestKey`로 남겨 중복을 거른다(12에 요구).

```text
orchestratorLoop():                                    // 데몬 안에서 하나만 돈다
  cursor = loadCheckpoint("orchestrator")              // 마지막으로 끝까지 처리한 이벤트 seq. 없으면 0
  views = rebuildViews(eventLog, upTo = cursor)        // reduceView로 접기(스냅숏이 있으면 거기서부터)
  for ev in eventLog.tail(from = cursor + 1):          // 커밋 순서대로
    concernIds = routeEvent(ev)                        // 이 이벤트가 영향을 주는 Concern들
    for cid in concernIds:
      views[cid] = reduceView(views[cid], ev)          // 이 이벤트까지 반영한 뷰
      actions = decide(views[cid], ev, ctx)
      await execute(actions)                           // 명령은 커널에 동기 제출, 나머지는 각 문서의 API
    saveCheckpoint("orchestrator", ev.seq)             // 실행이 끝난 뒤에 저장(최소 한 번 처리)
  scheduler.admit()
```

- 이벤트 하나를 처리하는 동안 만든 명령의 결과 이벤트는 같은 루프의 다음 반복에서 처리된다. 오케스트레이터는 자기 명령의 결과를 기다리며 막히지 않는다.
- 체크포인트는 처리 위치를 적은 메모이고 정본 데이터는 들어 있지 않다. 지워져도 0부터 다시 처리하면 같은 키 때문에 중복이 생기지 않는다(느릴 뿐이다). 저장 위치는 09의 런타임 체크포인트 테이블이다(§5.2).
- `routeEvent`: 이벤트의 `concernId` 필드, 하위·상위 관계(하위 닫힘은 상위에도), 전역 이벤트(`boundary.reached(user_return)`, 설정 변경, `daemon.mode_changed`)는 열린 Concern 전체.
- **깨우기 입력.** 이벤트 로그 밖의 신호는 둘이다. 12의 모델 가용 신호(`onModelAvailability(available)`, 12의 `model_probe` 타이머가 낸다)와 12의 `boundary_clock` 타이머 알림(스케줄러가 받아 `runtime.boundary{review_window | daily_rollover}`를 낸다)이다. 모델 가용 신호의 처리: 실행기는 모델 가용 신호를 받으면 `waiting(model)` Concern마다 마지막 처리 이벤트로 `decide`를 다시 부르고 `ctx.modelAvailable`만 바꾼다. 이때 나오는 요청은 WorkRequest id가 같으므로 중복되지 않는다. 제공자 상태는 도메인 관찰로 만들지 않는다([판정 J-109]).

#### 3.16.2 이벤트 하나를 처리하는 순서

```text
decide(view, ev, ctx):
  actions = []
  if view.closed and ev가 다시 열기 계기(T17, T18 불일치, T27, 이의)가 아니면:
    return closedConcernActions(view, ev)                   // 루프 밖 WorkUnit(T18 예측 점검, 닫힌 뒤 선택 돌아보기)만

  // 1. 사용량·진전 갱신은 view 계산(투영)에서 이미 반영됨

  // 2. 전환 규칙(§3.9.2)을 우선순위(§3.9.3) 순서로 평가
  rule = firstMatchingRule(view, ev, ctx)
  if rule:
    guardResult = applyGuards(rule, view, ev, ctx)          // G1~G9
    if guardResult.blocked: return guardResult.actions      // progress_stall 접점 등
    return transitionActions(view, rule.target, rule, ev)   // §3.16.3

  // 3. 현재 루프의 종료 조건 평가(계약 exit 배열 순서)
  if view.current:
    outcome = evaluateExit(contract(view.current.loop), view, ctx)
    if outcome:
      next = resolveNext(view, outcome)                     // §3.8.4
      if next is Wait: return waitActions(view, next)        // 접점 생성 등
      if next is Close: return closeActions(view, next)
      return transitionActions(view, next, EXIT(outcome), ev)

  // 4. 종료가 아니면 다음 WorkUnit을 요청할지
  return continueActions(view, ctx)                          // §3.16.4
```

`evaluateExit`는 계약의 `exit` 배열을 앞에서부터 보고 `when`의 조건이 모두 참인 첫 항목을 고른다. 실행 중인 WorkUnit이 있으면 `budget_exhausted`, `scope_exceeded`, `acceptance.verdict`처럼 즉시 처리해야 하는 결과만 평가하고 나머지는 WorkUnit 종료 뒤에 평가한다.

#### 3.16.3 전환 행동

```text
transitionActions(view, target, rule, ev):
  // 진입 조건
  c = contract(target)
  if !all(c.entry.requires):
    switch c.entry.onUnmet.kind:
      redirect:   target = c.entry.onUnmet.to ; rule = REDIRECT          // 한 번만 돌린다. 돌린 곳의 진입 조건도 거짓이면 touchpoint
      touchpoint: return [createTouchpoint(onUnmet.touchpoint)]
      reject:     return [emitMetric(transition_rejected)]
  // 실행 중 WorkUnit 마무리
  for wu in view.current.running:
    actions += stopWork(wu, target == "C.emergency" or rule == T07(chaos) ? "abort" : "wrap_up")   // 10 runtime.signal{wrap_up | abort}
  // 전환 명령
  actions += command(loop.transition {from: view.current?.loop, to: target, ruleId, trigger: ev.id,
                     planDeviation: !inPlan(view.plan, target), autonomous, whyNotAsked,
                     idempotencyKey: `${ev.id}:${rule.id}` })
  // 계획 이탈이면 계획 수정 명령(§3.8.3)
  if planDeviation: actions += command(loop_plan.record(buildPlan(..., cause: "deviation")))
  // 모드 확인(§3.10.4)
  if required(target) ⊄ mode.primitives and mode.layer == 3: actions += command(mode.route(...))
  return actions
  // 새 활성화의 첫 WorkUnit 요청은 loop.transitioned 이벤트를 받은 다음 decide에서 한다
```

`stopWork`는 10 `runtime.signal`(R)로 낸다. `wrap_up`은 "다음 턴 경계에서 지금까지를 요약하고 끝내라"는 신호다(턴 경계 정지, 12의 `finishTurn` 계열 훅). `abort`는 즉시 중단이며 결과는 `run.ended(cancelled)`다. 10 `runtime.signal`에 `abort` 값을 더해 달라고 요구한다(§5.2).

#### 3.16.4 다음 WorkUnit 요청

```text
continueActions(view, ctx):
  c = contract(view.current.loop)
  if 활성화 예산(G5) 소진: return []                         // 다음 이벤트에서 exit(budget_exhausted)
  if 막는 대기(waits)가 있음: return []
  if view.closing: return []
  // 이미 요청했는지는 결정적 WorkRequest id로 스케줄러가 거른다(§3.13.4). 멈춘 WorkUnit(view.current.paused)은 이어 가지 않는다
  // I 계열은 라운드 구성을 15에 맡긴다
  if family == "I":
    if autonomy.exhausted: return []                           // exit(autonomy_exhausted)로 처리됨
    reqs = inquiryEngine.planRound(view, resolvedDials)        // 15가 WorkRequest 초안 목록을 줌
    return reqs.map(r => requestWork(clampToContract(r, c, mode)))
  // 그 밖: 계약의 WorkUnit 템플릿을 순서대로
  t = nextTemplate(c.workUnits, view)                          // skipWhen 참인 것은 건너뜀, repeat 규칙 적용
  if t == null: return []                                      // 할 일 없음 → 종료 조건 대기
  if t needs agreement and !view.agreement?.active and c.agreement in ["active","probe_batch","integration"]:
       t = draftAgreementTemplate                              // 의존 규칙 1을 미리 맞춤
  return [requestWork(buildRequest(view, c, t, ctx))]
```

`clampToContract`: 15가 만든 요청의 원시 행동·제안 종류를 계약과 모드의 교집합으로 줄이고, 예산을 활성화 잔여 예산 이하로 줄인다. 15는 계약 밖의 능력을 요청할 수 없다.

**WorkUnit 합치기(강도 Quick, clear 유형).** O 계약은 `agreement_draft` 제안 종류를 노출한다. assess WorkUnit의 지시문(12)은 "판정 답이 명확 유형을 가리키고(같은 방식으로 여러 번 했고 절차가 있음) 작업 대상을 바꿔야 끝나는 일이면 합의 초안까지 쓰라"고 한다. 사람이 Concern 단위로 증명 부담을 standard 이상으로 정했으면 이 지시를 넣지 않는다. 초안이 있으면 C.commit의 `draft_agreement` WorkUnit은 생략된다(`skipWhen: agreement.draftPending`). 판정 결과가 clear가 아니면 그 초안은 폐기한다(10에 초안 폐기 명령). 합의 확정은 여전히 사람(또는 상시 합의·직접 지시)이 한다. 합치기는 WorkUnit 수를 줄일 뿐 C를 생략하지 않는다(v0.2 Quick "O와 I를 한 번의 호출로", X3-3-09를 v0.3 의존 규칙에 맞춘 것).

#### 3.16.5 크래시 후 재개

결정 30에 따라 실행 의도 → 실행 → 결과 순으로 기록된다. run의 재개는 12가 소유한다(12 §3.7). 오케스트레이터 쪽 규칙:

1. 데몬이 시작되면 12가 먼저 이전 run을 `interrupted`로 정리하고, work run은 12가 자동 재개한다(최대 3회). 오케스트레이터는 종결되지 않은 run이 있는 WorkUnit을 다시 요청하지 않는다(§3.12.3 원칙). `queued`에서 끊긴 run도 12가 맡는다.
2. 오케스트레이터는 체크포인트부터 이벤트를 다시 처리한다. 모든 제출의 멱등 키가 결정적이므로 이미 받아들여진 명령은 재생 결과(`replayed`, 06 §3.4.6)로 돌아오고 중복이 생기지 않는다.
3. 오케스트레이터가 처리하는 끝맺음:
   - `run.ended(recovery_exhausted)`: 정보 게이트 질문 `progress_stall`("중단된 실행을 이어 가지 못했습니다", 근거는 12의 복구 기록)을 만들고 그 WorkUnit에 기대는 일을 멈춘다.
   - `run.ended(superseded)`: 무시한다(Concern이나 WorkUnit이 이미 끝남).
   - 검증 WorkUnit(`verify`) 실패: 오케스트레이터가 같은 검증을 한 번 더 요청한다. 두 번째도 실패하면 결과 확인 질문에 "독립 검증 실패"를 표시하게 한다(검증 시작 경로는 오케스트레이터 하나, §3.6.8). 가지 run 실패는 15에 맡긴다.
   - 결과를 모르는 외부 행동(`awaiting_recovery`, 질문 종류 `recovery`, [판정 J-44])은 10·12·11이 처리한다. 오케스트레이터는 그 질문을 막는 대기로 본다.
4. 스케줄러 큐는 저장하지 않는다. 재시작 때 ConcernView에서 WorkRequest를 다시 계산하고, 같은 id의 run이 있으면 버린다(§3.13.4).
5. 타이머는 12가 복원한다(catch-up, 기한·발화 간격은 12 §3.10.4). 오케스트레이터는 같은 대상·같은 목적의 중복 행동만 거른다: 같은 WorkRequest id, 같은 전환 멱등 키는 한 번만 나간다. 서로 다른 타이머 이벤트를 버리지 않는다.
6. 17의 safe mode 동안(사유는 `crash_loop`(최근 10분 비정상 부팅 3회) 또는 `restored`(백업 복원과 업그레이드 되돌리기 포함, [판정 J-164])) 스케줄러는 새 WorkRequest를 허가하지 않는다. 복원 직후에는 백업 시점에 진행 중이던 일이 이미 끝났을 수 있으므로, 사람이 복귀 요약을 보고 해제할 때까지 오케스트레이터는 명령만 내고 실행을 시작하지 않는다. 해제 주체와 이벤트는 [판정 J-165]를 따른다(19의 기기 또는 대화형 localAdmin이 내고 09 `daemon.safe_mode_exited`가 남는다). 백업 시점의 미소진 승인은 커널이 `approval.expired{reason: restored}`로 닫는다(10·12·17에 요구). 오케스트레이터는 이를 호출 종결로 처리한다(§3.12.3).

#### 3.16.6 한 Concern이 열려서 닫히기까지

```text
// 경로 1(시작 시 진입)으로 열린 Concern의 전체 흐름. 각 줄은 이벤트를 받은 decide 한 번이다. 이름은 09·10 정본.
on 새 일 입력(19 composer → 사람 출처 관찰):
  requestWork(entry_assess, concern = 프로젝트.lightWorkConcernId)   // 루프 밖 run, cheap
on run.ended(handed_off, handoff.kind = entry_signals):
  d = assessEntry(handoff.assessment)              // 01 §3.6.3 규칙(문턱 2 고정, EC-3 예외)
  command(entry.evaluate{decision: d.result, signals})        // 판정을 먼저 기록한다(이의 대상, §3.12.4)
  if d.result == enter: command(concern.open{goalId: pickGoal(), origin: human_start, entrySignals})
  else: startLightTask(request)                    // 가벼운 작업(§3.14.2)
on concern.opened(c):
  command(loop.transition{from: null, to: firstLoop(c), ruleId: OPEN, trigger: open})   // 보통 O
on loop.transitioned(to: O):
  requestWork(assess)                              // 판정 답 + 문제 정의 패킷(계획 표시 일곱 개, 요청 형태)
on run.ended(handed_off, handoff.kind = situation_answers):
  command(situation.assess{classify(answers)})     // R, declaredBy = assess run
on situation.assessed (같은 활성화에 concern.reframed가 있음):
  command(mode.route{…}) if changed                 // §3.10.3, R, declaredBy = assess run
  if 초안 요청이 필요 없음:                        // §3.8.5. planAuthoring, outOfPattern, NoRule로 정한다
    command(loop_plan.record(buildPlan(…, cause: initial), authoredBy: code))   // runtime 채널
  else: requestWork(assess, {planDraft: true})     // 모델이 loop_plan.record(steps)를 M 채널로 낸다. 검사는 커널(§3.8.5)
on loop_plan.adopted:
  exit(O, planned) → next = nextInPlan()           // 예: I.fact
  command(loop.transition{O → I.fact, ruleId: EXIT, trigger: contract_exit})
on loop.transitioned(to: I.fact):
  requestWork(inquiryEngine.planRound(...))         // 15. inquiry.opened, 라운드 1
on inquiry.round_ended:
  command(runtime.boundary{round_end})            // 14가 제출(§3.13.6). 11이 boundary.reached를 받아 예약 질문 전달
  if inquiry.stop_rule_met → T21 → next in plan (예: C.commit)
  else continue (G5, autonomy 확인, planRound)
on loop.transitioned(to: C.commit):
  if !agreement.active: requestWork(draft_agreement)
on agreement.proposed:                             // 합의 초안이 기록됨
  // 10이 R-OP-2 판정: 선택 범위 안이면 agreement.activated_by_choice, Grant면 agreement.activated_by_grant,
  // 아니면 같은 트랜잭션에서 question.recorded(agreement_confirm)
  advise bundle(finding_confirm들 → agreement_confirm)                // C/A 1회째(정상 경로)
on agreement.confirmed / agreement.activated_by_choice / agreement.activated_by_grant:
  requestWork(execute)                            // 첫 쓰기 전 되돌릴 지점은 13 §3.7.8이 만든다(합의 활성 뒤 첫 쓰기)
on run.ended(execute WorkUnit):
  if submission.missingAfterWrite: requestWork(submit)             // T32
on result.submitted:                                // 결과 제출에 반영 범위 초안(integrationAgreementDraft)이 실린다
  command(loop.transition{C.commit → A.confirm, ruleId: T23, trigger: contract_exit})
on loop.transitioned(to: A.confirm):
  if 독립 검증 필요(dial.equals independentVerification): requestWork(verify)   // 검증 시작 경로는 이것 하나
on question.recorded(result_review):                // 커널이 낸 결과 확인 질문. C/A 2회째
  (대기: human)
on acceptance.recorded(accepted | conditional):     // 같은 트랜잭션에 agreement.confirmed(반영 범위, J-126)
  for each obligation.added: requestWork(integrate) (반영 범위 안)
on obligation.resolved / obligation.deferred (모두 처리):
  T26 → A.reflect가 필수면 A.reflect로, 선택이면 바로
  command(concern.close{result: completed})        // → concern.completed(행위자 runtime). 의존 규칙 2 충족
  requestWork(reflect, 루프 밖)                     // 선택 돌아보기. 닫힘을 기다리게 하지 않는다(R-OP-5)
on reflection.recorded (필수 A.reflect였을 때):
  command(concern.close{result: completed})
```

### 3.17 클라이언트 없이 진행할 때 [결정 22: 계속 진행 / 제안: 규칙]

데몬은 클라이언트 연결과 무관하게 돈다. 사람이 부재일 때(`isAway`, §3.13.8) 오케스트레이터와 스케줄러는 다음 규칙을 따른다.

| 상황 | 동작 |
|---|---|
| 사람 입력이 필요 없는 일 | 그대로 진행한다(읽기 탐구, 탐침 실행, 반영 작업, 지속 관찰 표본, 타이머) |
| 막히지 않는 정보 게이트 질문 | 기록하고 임시 가정으로 진행한다(11). 전달은 예약(다음 복귀 요약)이며, 예약 전달은 강도 `digest`라 휴대폰 푸시가 없다(11 `urgencyOf`, [판정 J-322]) |
| 데몬이 멈춰 있던 동안 지난 가정 만료점 | 멈춘 시간이 만료 여유보다 길면 막지 않는 질문의 만료를 "복귀 + 30분"으로 미룬다(다이얼 16 `assumptionDeferOnDowntime`, 기본 `on`, [판정 J-142], [판정 J-197]). 계산은 부팅 때 10·12가 한다 |
| 막히는 질문(정보 게이트) | 그 질문에 기대는 WorkUnit만 멈춘다. 같은 Concern의 다른 일과 다른 Concern은 계속 |
| 권리 게이트(합의 확인, 결과 확인, 권리 허락, Goal 수정) | 기다린다. 막는 권리 게이트는 휴대폰 푸시(`interrupt`)로 알린다 [결정 48]. 만료(사람이 정한 마감) 임박 승격만 `interrupt`로 즉시 전달하는 예외다 [결정 64]. 권리 게이트 질문은 만료되어도 가정 확정(assumed)으로 가지 않는다(canon-3 C10, v0.3 06 §6 Q-15). 관련 작업만 멈추고 나머지는 계속 |
| 합의가 필요한 실행 | 합의 확인을 기다리는 동안 그 Concern은 C에서 대기한다. 상시 합의(절차·비상)가 맞으면 진행한다 |
| 결과 확인 대기 | Concern은 "결과 확인 대기"로 남는다. 다음 계획 단계 중 결과 확인에 기대지 않는 일(예: 같은 Goal의 다른 Concern)은 스케줄러가 진행한다 |
| 원함 탐구 | 반응 없이 `autonomy` 라운드까지만 진행하고 기다린다(`autonomy_exhausted`). 반응 없이 자극만 쌓지 않는다 |
| 혼돈 신호 | 맞는 비상 합의가 있으면 `C.emergency`로 진행. 없으면 `emergency_authorization` 질문을 만들고, 연결된 클라이언트가 없으면 다음 접속 때 가장 먼저 보인다. Helm은 사람 허락 없이 비상 조치를 하지 않는다 |
| 비용 | `unattendedSpendCapUsd`가 있으면 away 동안 그 이상 쓰지 않는다(스케줄러가 새 WorkUnit 시작을 멈춤). 12의 전역 예산은 항상 적용된다 |
| 새 Concern 활성화 | `maxActiveConcerns` 안에서 진행한다. 사람 접점을 곧 만들 Concern(I.want 시작, C.commit 시작)은 주의 예산 규칙(§3.13.5)대로 미룰 수 있다 |
| 사람이 돌아옴(부재 → `active`) | 작업 경계 `user_return` → 복귀 요약 생성 요청(12). 예약 질문이 전달된다(11). 남은 반영 항목과 권리 게이트가 맨 위 |

### 3.18 이벤트와 명령 [정본: 이벤트 09, 명령 10, 레코드 08]

이 문서가 쓰는 이름은 아래 정본 이름이다(판정 §1). 1판 후보 이름과의 대응은 §3.20.

**오케스트레이터가 보내는 명령(10 §3.11)**

행위자는 `runtime`, 채널은 R이다. 모델 선언을 반영한 제출은 `declaredBy`에 그 run을 넣고(레코드의 `Autonomy.decidedBy`는 그 run 역할), 코드 규칙만으로 정한 제출은 `declaredBy`를 비우고 `decidedBy: "kernel"`, `whyNotAsked: { kind: "rule", ruleId }`로 남긴다(08 §3.4.5, 10 §3.3.2, K-13).

| 명령(10) | 하는 일 | 결과 이벤트(09) |
|---|---|---|
| `concern.open` | Concern 열기(Goal, `origin`, 진입 신호) | `concern.opened` |
| `concern.reframe` | 문제 정의 패킷 반영 | `concern.reframed` |
| `concern.close` | 닫기(result `completed` / `not_completed`) | `concern.completed` / `concern.closed` |
| `concern.reopen` | 다시 열기 | `concern.reopened` + `loop.transitioned`(kernel) |
| `loop.transition` | 루프 전환 | `loop.transitioned`(+ 첫 활동이면 `concern.activated`) |
| `loop_plan.record` | 루프 계획 기록(`authoredBy`는 채널로 정한다. 거부된 초안은 `command.rejected`로 남는다, §3.8.5) | `loop_plan.adopted`(payload에 `authoredBy`, `modelDraftRejects`) |
| `situation.assess` | 상황 판정 기록 | `situation.assessed` |
| `mode.route` | 모드 라우팅 | `mode.assigned` |
| `structure.split`·`merge`·`detach`·`relocate`·`recombine`·`hold`·`close` | S 동작 | `structure.changed`(+ `concern.opened`, `boundary_item.recorded`, `concern.merged`, `concern.held`, `concern.closed`) |
| `probe.define` / `probe.judge` | 탐침 정의·판정 | `probe.planned` / `probe.concluded` |
| `watch.define` / `watch.judge` | 지속 관찰 정의·판정 | `watch.defined` / `watch.judged` |
| `reflection.record` | 돌아보기 기록 | `reflection.recorded` |
| `question.raise` | 오케스트레이터 접점 질문(§3.5.3 만드는 쪽 표) | `question.recorded`(+ 전달 이벤트) |
| `runtime.boundary` | 작업 경계(§3.13.6, 제출자는 14 하나) | `boundary.reached` |
| `runtime.signal` | 실행 중 run 정지 요청(`wrap_up`, `abort`. `abort`는 10에 추가 요구) | `run.stopping` → `run.ended` |
| `entry.evaluate` | 진입 판정 기록(Concern으로 열기·가벼운 작업으로 두기 모두) | `entry.evaluated` |
| `agreement.discard` | 확정 전 합의 초안 폐기(§3.16.4, R 허용) | `agreement.discarded` |
| `workunit.propose` / `workunit.start` | WorkUnit 열기와 시작(§3.13.4 실행 순서) | `workunit.proposed` / `workunit.started` |

`dial.set`은 사람만 보낸다. 10은 자동 상향용 R 채널을 열었지만 이 문서는 쓰지 않는다(§3.11.7: 자동 상향은 해석 때 계산하고 `planDetail.proofBurdenRequired`로 남긴다). 사람의 모드 지정은 19 `mode.set`이다(10에 명령 추가 요구, 판정 §1).

**오케스트레이터가 읽는 이벤트(09 §3.4)**

| 묶음 | 이벤트 |
|---|---|
| Concern·루프 | `concern.opened`, `concern.activated`, `concern.reframed`, `concern.reopened`, `concern.held`, `concern.resumed`, `concern.merged`, `concern.completed`, `concern.closed`, `loop.transitioned`, `loop_plan.adopted`, `situation.assessed`, `mode.assigned`, `structure.changed`, `entry.evaluated` |
| 합의·결과·반영 | `agreement.proposed`, `agreement.confirmed`, `agreement.activated_by_choice`(09에 추가 중, [판정 J-90]), `agreement.activated_by_grant`, `agreement.activated_by_rule`, `agreement.declined`, `agreement.discarded`, `agreement.expired`, `agreement.stop_condition_met`, `agreement.scope_change_requested`, `agreement.violation_detected`, `agreement.released`, `result.submitted`, `attestation.recorded`, `acceptance.recorded`, `obligation.added`, `obligation.resolved`, `obligation.deferred`, `obligation.transferred`, `obligation.waived`, `obligation.reopened`, `integration.completed` |
| 판단·이의·Goal | `finding.promoted`, `finding.withdrawn`, `record.staled`, `objection.filed`, `objection.resolved`, `choice.committed`, `choice.revoked`, `goal.revision_proposed`, `goal.revised`, `preference_model.versioned` |
| 질문·승인 | `question.recorded`, `question.updated`, `question.delivery_planned`, `question.delivered`, `question.escalated`, `question.answered`, `question.assumed`, `question.delegated`, `question.expired`, `question.withdrawn`, `toolcall.approved`, `toolcall.denied`, `approval.expired` |
| 실행 | `workunit.proposed`, `workunit.started`, `workunit.paused`, `workunit.resumed`, `workunit.concluded`, `workunit.scope_exceeded`, `workunit.cancelled`, `run.started`, `run.awaiting`, `run.ended`, `run.interrupted`, `budget.exhausted`, `command.rejected` |
| 시간·경계·데몬 | `boundary.reached`, `expectation.timed_out`, `prediction.checked`, `watch.window_closed`, `presence.changed`, `daemon.safe_mode_entered`, `daemon.safe_mode_exited`, `daemon.mode_changed` |
| 탐구 | `inquiry.opened`, `inquiry.round_ended`, `inquiry.stage_completed`, `inquiry.stop_rule_met`, `inquiry.stopped`, `possibility.proposed`, `stimulus.presented` |
| 탐침·관찰 | `probe.planned`, `probe.concluded`, `watch.defined`, `watch.judged` |
| 절차·제안 | `procedure.adopted`, `procedure.trust_changed`, `procedure.retired`, `reflection.recorded` |
| 다이얼·지시 | `dial.set`, `dial.unset`, `setting.changed`, `directive.applied` |

1판 이름은 쓰지 않는다: `question.raised` → `question.recorded`, `submission.rejected`·`submission.gated` → `command.rejected`(code로 구분), `contest.filed` → `objection.filed`, `agreement.accepted(delegated_grant)` → `agreement.activated_by_grant`·`agreement.activated_by_choice`, `scope.violation_detected` → `agreement.violation_detected`, `run.resumed` → 없음(같은 thread 새 run, [판정 J-38]), `scheduler.released` → 없음(스케줄러 허가는 trace), `agreement.decline_draft` → 명령 `agreement.discard`, `prediction.due` → `question.recorded(prediction_check)`, `work.requested` → trace([판정 J-33]).

오케스트레이터 자체 진행 기록(`work.requested`, `work.admitted`, `work.deferred`, `attention.*`, `guard.tripped`)은 실행 기록(trace)으로 남기고 도메인 이벤트로 두지 않는다(09 §3.11 운영 테이블 주석, 06 `appendTrace`). 정본 판단의 근거로 인용하지 않는다.

`run.ended`의 종료 사유는 08·12 `RunEndReason`이다(yielded, handed_off, cancelled, budget_exhausted, step_limit, failed, recovery_exhausted, superseded, context_overflow). 사유마다의 처리는 §3.12.3 표에 모두 있다. `failed`는 `code`로 나눈다(`model_unreachable`은 대기, 그 밖은 재시도 또는 질문). 결과를 모르는 외부 행동은 run 상태 `awaiting_recovery`와 질문 종류 `recovery`이고 run 종료 사유가 아니다.

### 3.19 예시 흐름

#### 3.19.1 UC-01 취향형 작업: 블로그 글 방향 잡기

v0.3 03 §9.1의 흐름을 오케스트레이션 단위로 옮겼다. "사람"은 사람 조작이다.

| # | 루프 | 오케스트레이터 동작 | 사람 |
|---|---|---|---|
| 1 | – | 요청 "블로그 글 방향을 잡고 싶다" → `entry_assess` → `assessEntry`: `goal_vague`, `taste_dependent` yes(근거 있음) → `entry.evaluated{decision: enter}` → 열기(경로 E1) | 0 |
| 2 | O | assess: 판정 답 `q.taste_or_reaction` yes, `q.unpredictable` yes → complex(high). 플래그 wantDependent. 라우팅 → `taste`. 계획 `O → (I.want 또는 I.possibility) ⇄ C.probe → A.watch → C.commit → A.confirm → (A.reflect)` | 0 |
| 3 | I.want | 라운드 1: 15가 도입부 자극 8개(다른 분야 레퍼런스 포함)를 Helm 저장 공간에 만듦(D10, 합의 불필요). `stimulus_round` 질문(예약, 라운드 경계) | 반응 1 |
| 4 | I.want | 반응 관찰 → 기준 후보 3개. `criterion_confirm` 질문(정보, 임시 가정 "적용")은 예약 | (나중에) |
| 5 | I.want → C.probe | 15 멈춤 규칙 아님. 라운드 2에서 "형식"과 "주제" 반응이 따로 움직임을 모델이 `split_hint`로 선언 → T14 | 반응 1 |
| 6 | S.split | 하위 "주제", "형식" + 경계 항목("도입부 장면이 주제 선택에 영향"). 상위는 대기(children). 하위마다 O → I.want … | 0 |
| 7 | (하위) C.probe | 짧은 초안 3개를 탐침으로(Helm 저장 공간, 합의 생략). 키울 조건 "사용자가 이어 쓰고 싶다고 함"(evaluator human) | 반응 1 |
| 8 | (하위) C.commit | 키움 → T12. 블로그 파일에 쓰기 → 합의 초안(선호 모델을 완료 기준으로) → `agreement_confirm` | C/A 1 |
| 9 | (하위) A.confirm | 제출 → `result_review`(선호 모델과의 일치 확인) | C/A 2 |
| 10 | 상위 S.recombine → A.confirm | 하위가 모두 끝남(T30). 경계 항목 확인 → 상위 결과 확인 | 1 |
| 11 | A.reflect | 선호 모델을 Goal에 연결하자는 변경 제안(Goal 수정 → `goal_revise`, 예약) | (나중에) |

위 흐름은 2·3단계 기능(C.probe, S.split)을 켠 경우다. MVP(§3.15)에서는 `O → I.want → C.commit → A.confirm → (A.reflect)`로 간다(02 UC-01). 사람 조작은 하위 C/A마다 2회, 반응 라운드마다 1회다. 반응 라운드는 원함 탐구의 본체이므로 C/A 상한에 세지 않고 주의 예산(비용 3)으로 센다.

#### 3.19.2 UC-18 비상 대응: 배포 후 장애(3단계 기능)

| # | 루프 | 오케스트레이터 동작 |
|---|---|---|
| 1 | – | 사람이 "배포 뒤 오류가 급증한다"(경로 3 직접 지정, 요청 형태 incident) → 첫 루프: 혼돈 신호이므로 `C.emergency` |
| 2 | C.emergency | 상시 비상 합의 "프로덕션 오류율 5% 이상이면 직전 배포로 롤백까지는 묻지 않음"이 맞음 → stabilize WorkUnit(롤백). 계획 끝에 `A.reflect` 필수 |
| 3 | C.emergency → O | 오류율 정상화 관찰 → 안정화 조건 충족 → T24 |
| 4 | O | 재판정: complicated(원인 분석 가능). 비상 합의 적용 종료. 라우팅 → `investigate`(사람이 지정하지 않았으므로) |
| 5 | I.fact → I.outcome | 원인 탐구 → 재배포 계획의 사전 부검 |
| 6 | C.commit → A.confirm | 수정 후 재배포(합의 확인 1, 결과 확인 1) |
| 7 | A.reflect | 비상 합의와 배포 절차 수정 제안 → 다음에는 명확 유형으로 처리 가능(v0.3 03 §9.2) |

### 3.20 다른 설계 문서와의 대조 결과 [제안]

정본은 이벤트 09, 명령 10, 레코드·질문 종류·ID 접두사 08, 프로토콜 메서드·오류 19, 화면 ID 03, 유즈케이스 02, 패키지 06, ADR 24다. 이 문서 본문은 정본 이름을 쓰고(§3.5, §3.11, §3.12, §3.13, §3.18), 이 절에는 맞춘 결과와 남은 충돌만 둔다.

#### 3.20.1 맞춘 것

| 대상 | 정본 | 이 문서에서 |
|---|---|---|
| 루프 식별자, 상황 유형, 확신 등급 | 08 §3.15 `LOOP_IDS`, `SituationTypeSchema`, §3.4.1 `Grade` | import해서 쓴다 |
| 판정 질문 9개, 답 `yes/no/unknown`, `parts`·`alternative`·`confidence`·`previousType`·`computedBy` | 08 §3.15 `SituationAnswer`, `SituationAssessmentCore` | §3.7.1과 같다 |
| 루프 계획 | 08 `LoopPlanCore`(`combo`, `planVersion`, `planDetail{steps, flags, completedStepKeys, skipped, cause, proofBurdenRequired, modeId, procedureId}`), 명령 `loop_plan.record`, 이벤트 `loop_plan.adopted` | §3.8.1의 `LoopPlanCore`는 이 저장 모양과 같다. `authoredBy`는 `planDetail` 밖의 최상위 필드다([판정 J-226]). 거부 기록은 09 `modelDraftRejects`로 남는다([판정 J-188]) |
| 루프 전환 | 08 `LoopTransitionCore`(`trigger`, `triggerRefs`, `skipped`, `ruleId`, `exitOutcome`, `triggerEventId`, `planDeviation`, `restart`, `autonomy`) | §3.9.1과 같다. trigger 대응은 §3.9.7. 멱등 키는 제출 envelope의 `idempotencyKey` |
| `decidedBy`, `whyNotAsked` | 08 §3.4.5: 규칙 결정은 `decidedBy: "kernel"`, `whyNotAsked: { kind: "rule", ruleId }`. 모델 선언 반영은 `runtime` + `declaredBy`(10 §3.3.2, K-13) | §3.18. 11이 쓴 이름 `rule_default`는 08 `rule`로 읽는다 |
| 모드 8개, 라우팅 기록 | 08 `MODE_IDS`, `ModeAssignment`, 이벤트 `mode.assigned`, 명령 `mode.route`(R 허용) | §3.10과 같다 |
| 다이얼 키와 층 | 08 `DIAL_KEYS`(키 20개 = 다이얼 키 18개(항목 16) + 구조 설정 키 2개), 저장 층 `DialLayer`(user, concern, instruction), 이벤트 `dial.set`·`dial.unset` | §3.11.1·§3.11.2. 해석 순서는 `DialPrecedence`(1~6)로 이름을 나눴다([판정 J-136]). Goal 범위 다이얼은 없다 |
| 구조 동작 | 08 `StructureChange`, 10 `structure.*`, 09 `structure.changed` | §3.6.11 |
| 경계 항목 | 08 §3.6.3 BoundaryItem(`shared_premise|interacting_decision|interface|other`, `open|checked|dropped`), 09 `boundary_item.recorded` | §3.6.11의 `violated`는 재조합에서 반영 항목(`boundary_check`)으로 남긴다 |
| 탐침 | 08 §3.16 Probe, 10 `probe.define`·`probe.judge`, 09 `probe.planned`·`probe.concluded(grown|folded|inconclusive|exhausted)` | `inconclusive`는 같은 이름. `exhausted`는 `budget_exhausted` 결과 |
| 지속 관찰 | 08 §3.16.2 Watch(`wt`, 판정 `stable|regressed|inconclusive`), 10 `watch.define`·`watch.judge`, 09 `watch.defined`·`watch.window_closed`·`watch.judged` | A.watch 결과 대응: `stable` → `grow`, `regressed` → `fold`, `inconclusive` → `continue` |
| 절차 | 08 §3.19.3 Procedure(`pd`, `trust: trial|trusted|demoted`, `planTemplate`, `standingGrantId`), 09 `procedure.adopted`·`trust_changed`·`retired` | `q.procedure_exists`: `trusted` → yes, `trial` → unknown(근거 `pd`) |
| 돌아보기 | 08 Reflection(`nextAgreementChange` 포함), 10 `reflection.record` | §3.6.10 |
| 질문 종류 | 08 §3.13 `QuestionKind` | §3.5.3 `HumanTouchpointKind`는 `QuestionKind`의 부분집합(`Extract`)이다. 1판 이름 대응: `scope_exceeded` → `scope_change`, `rights_permission` → `send_approval`, `goal_revise`(접점) → `goal_revision`, `probe_agreement` → `agreement_confirm`(합의 종류 probe), `tool_outcome_unknown` → `recovery` |
| 진입 | 08 `ConcernOrigin`(`human_start`, `promoted_from_work`, `human_designated`, `observer`, `structure`), 08 EntryAssessment(`decision`: `enter`, `suggest`, `light_work`, `autonomy`), 09 `entry.evaluated`, 01 §3.6.3 | §3.14.3. 강등은 `structure.changed`(사유 `demotion`) |
| 가벼운 작업 | 08 `Project.lightWorkConcernId`, Concern 종류 `light_work`, 판정 J-01 | §3.14.2 |
| 결과·반영 | 09 `result.submitted`(반영 범위 초안), `acceptance.recorded`(08 `AcceptanceDecision`, `reopenTo`, `integrationAgreementId`), `obligation.resolved`·`deferred`, 19 `result.accept`(10 명령 값), 10 `obligation.defer` | §3.6.8. 결과 확인은 `result.accept` 하나([판정 J-123], [판정 J-124]), 반영 범위는 같은 조작([판정 J-126]), 조건 붙여 확인 조건은 미룬 항목([판정 J-125]) |
| 작업 경계 명령 | 10 `runtime.boundary`(1판 `boundary.reach`), 09 `boundary.reached` | §3.13.6 |
| 접속 상태 | 11 §3.8.1 `PresenceSnapshot`, 09 `PresenceState`(active, idle, hidden, offline)와 상태가 바뀔 때만 남는 `presence.changed`([판정 J-64]), 19 `presence.report` | §3.13.8. 부재는 `isAway` 하나로 계산([판정 J-119]) |
| 실행 | 12 `startRun(RunSpec)`, 09 `run.*`, 08·09 `workunit.*` | §3.20.3(아래 변환표) |
| 탐구 엔진 | 15 §3.1.1 `planRound`(순수, `@helm/kernel/orchestration`, [판정 J-128]), 단계 run의 `runStage`, `StageResult`, 자식 가지 run, `StopDecision`, 이벤트 `inquiry.round_ended`·`stage_completed`·`stop_rule_met` | §3.6.2~§3.6.5, §3.12.3, §3.16.4. 라운드 끝 경계는 14가 `inquiry.round_ended`를 받아 `runtime.boundary(round_end)`로 제출 |
| 스케줄러 경계 | 판정 J-13 | §3.13.1 |
| 자극 수 | 판정 J-06: 8(최소 4) | §3.11.1 |
| Quick/Guided/Assured | 판정 J-12 | §3.11.7 |
| 거절 뒤 루프 | 판정 J-04: 08 `Acceptance.reopenTo`(C.commit, I.fact, I.want), 화면 기본 직전 I. [판정 J-24] | §3.6.8, T09·T11. 전환은 14가 낸다(10은 내지 않는다) |
| 선택 범위 안 합의 활성 | [판정 J-90], [판정 J-133]: 10 `agreement.propose{activateViaChoice}`, 08 `Activation.choice_scope`, 09 `agreement.activated_by_choice` | §3.13.7 |
| 오케스트레이션 코어 위치 | [판정 J-128]: `@helm/kernel/orchestration` | §3.20.6, §6.1 |

#### 3.20.2 WorkRequest → 12 RunSpec 변환

스케줄러가 허가한 WorkRequest마다 실행기는 §3.13.4의 실행 순서대로 (1) 새 WorkUnit이면 10 `workunit.propose`(08 WorkUnit에 `loop`, `loopTransitionId`, `purpose`, title·intent), (2) 10 `workunit.start`, (3) 12 `startRun(RunSpec)`을 부른다.

| WorkRequest | RunSpec(12 §3.2.1) |
|---|---|
| `loop` | `loopId` |
| `step` | `step` |
| `role` | `role`, `kind`(work 또는 verifier) |
| `modelHint` | `modelRole`(default → 역할 기본, cheap → subcall 후보, different_from_worker → `differentFamilyFrom: work`) |
| `context{mode, sections}` | `context{mode, include: sections, exclude: 계약.context.exclude, forkCursor}` |
| `primitives`, `proposalKinds` | 같은 이름 |
| `budget{subcalls, wallMinutes, costUsd}` | `RunBudget{subcalls, wallMs = wallMinutes × 60000, costUsd, workUnits}` |
| `activationId` | `trigger: { kind: "orchestrator", activationRef, workUnitId }` |
| `instructionsRef` | `instructions`(`contracts/instructions/<loop>.<purpose>.md` 템플릿으로 만든 문장. 섹션 순서는 12 §3.5.4 우선순위) |
| `workUnit.id`, `workUnit.threadId` | `workUnitId`, `threadId`(이어 갈 때 같은 thread, `context.mode: resume`) |
| `concernId` | `concernId`(가벼운 작업·진입 판정은 프로젝트의 `lightWorkConcernId`), `goalId`는 Concern의 Goal |
| `purpose`, `agreementId`, `dials`, `recordCaps`, `directiveId`, `id` | RunSpec에 없음. `purpose`·`agreementId`는 `workunit.propose`에, `dials`는 12가 규칙 슬롯(S3)을 만들 때 해석 결과를 다시 읽는다 |
| `id`(= `idempotencyKey`) | run 레코드의 `workRequestKey`(12에 요구). 같은 키의 run이 있으면 시작하지 않는다 |

#### 3.20.3 충돌과 처리 상태

| 번호 | 충돌 | 처리 |
|---|---|---|
| C14-1 | 작업 경계 목록 | 해결: [판정 J-63] 일곱 값. 08 `WorkBoundaryKind`, 09 `boundary.reached` 반영됨 |
| C14-2 | 접속 상태를 이벤트로 남길지 | 해결: [판정 J-64], [판정 J-119]. 상태가 바뀔 때만 `presence.changed`, 부재는 `isAway`(§3.13.8) |
| C14-3 | 모델이 M 채널로 루프 전환 | 해결: [판정 J-65]. 선언 도구(handoff)만 노출 |
| C14-4 | `run.ended(handed_off)`에 선언을 실을 필드 | 일부 해결: 08 `RunHandoff`·`Run.end.handoff`, 10 `RunEndPayload.handoff` 있음. 09 `run.ended` payload와 08 변형 두 가지(`trigger`, `situation_answers`)가 남음(§5.2) |
| C14-5 | 12의 Concern당 work run 1개 | 남음: 탐침 WorkUnit에 한해 `maxConcurrentPerConcern`(기본 3)까지 허용. 그 밖은 1개 |
| C14-6 | 실행 중 run의 정지 신호 | 일부 해결: 10 `runtime.signal(wrap_up)` 있음. `abort` 값은 없다(§5.2) |
| C14-7 | 진입 판정 문턱 | 해결: [판정 J-66] 고정 2 |
| C14-8 | 진입 판정 기록 명령 | 해결: 10 `entry.evaluate`(R) |
| C14-9 | 합의 초안 폐기의 R 채널 | 해결: 10 `agreement.discard`(M, R, H) |
| C14-10 | 사람의 모드 지정 명령 | 해결: 10 `mode.set`(H) |
| C14-11 | 질문 다이얼 값 이름 | 해결: 11의 `few`/`normal`/`many` |
| C14-12 | `dial.set`의 R 행 | 해결: [판정 J-66] R 행 삭제 |
| C14-13 | 검증 run 시작 경로가 둘(10 `agent.request(verifier)`와 14 `verify` WorkUnit) | 남음: 14 하나로(§3.6.8). 10이 `result.submit`의 `agent.request(verifier)` 효과를 빼야 한다(§5.2) |
| C14-14 | 질문 레코드의 runId로 run 이어 가기 주체를 나눔 | 남음: 12 §3.13·§3.7.5와 맞춰야 한다(§3.12.3 원칙, §5.2) |

#### 3.20.4 관찰 에이전트(16)의 요구에 대한 답

| 16 §5.2의 요구 | 답 |
|---|---|
| 절차 등록·신뢰도·강등과 사용 기록 | 채택은 16 §3.16대로 사람이 하고 `procedure.adopted`가 기록된다. 14는 적용(상황 판정의 `q.procedure_exists`, 계획 템플릿 `planDetail.procedureId`, 상시 Grant)과 사용 기록(성공은 Concern 완료, 실패는 `procedure_failed` 주석 관찰)을 맡는다. 신뢰 변경 제안은 16이 낸다 |
| `plan.deviated`를 언제 만드나 | 루프 전환의 도착 루프가 계획의 다음 단계와 다를 때(`planDeviation: true`), 사람의 직접 지시가 아니면 만든다. 정도: 선택 단계를 건너뜀 = low, 필수 단계를 건너뜀 = medium, 계획에 없던 루프 = high. 이 판단은 `loop.transitioned`의 `planDeviation`·`skipped`에서 결정적으로 계산되므로, 16의 지표 추출기가 만들고 오케스트레이터는 따로 기록하지 않는다(09에 이벤트가 필요하면 `loop.transitioned`에서 파생) |
| 합의 템플릿, 라우팅 규칙, 진입 규칙을 데이터로, `PolicyPatch.target`으로 | 라우팅 결정표(§3.10.3)와 합의 템플릿은 데이터다. `PolicyPatch.target` 값: `orchestration.routing`, `orchestration.agreement_templates`. 진입 문턱은 01이 고정했으므로 패치 대상이 아니다(바꾸려면 01 OQ-04 결정이 먼저) |
| Reflection의 "다음 합의에서 바꿀 것" | 08 `Reflection.nextAgreementChange` |

#### 3.20.5 오케스트레이터 자체 기록의 위치

10은 스케줄러 등에 별도 쓰기 경로를 두지 않는다(10 §3.2). 오케스트레이터 진행 기록은 도메인 이벤트가 아니다.

| 기록 | 위치 |
|---|---|
| `work.requested`, `work.admitted`, `work.deferred`, `attention.*`, `guard.tripped` | 실행 기록(06 `EngineTx.appendTrace`, 09 운영 테이블 주석). 재시작 때 큐는 ConcernView에서 다시 계산한다 |
| 작업 경계 | 10 `runtime.boundary` → 09 `boundary.reached` |
| 진입 판정 | `entry.evaluate`(R, 결과와 무관하게 먼저) → 09 `entry.evaluated`. 열면 이어서 `concern.open` |
| 승격 제안 | `question.raise(entry_suggestion)` → `question.recorded` |
| C/A 상한 위반 | 기록하지 않는다. 16이 01 `HumanDecisionOp`에서 계산한다 |

#### 3.20.6 패키지와 설정 위치 (06)

- 오케스트레이션 코어(계약·모드·다이얼 데이터, 결정표, 계획기, 전환 규칙, 가드, `reduceView`, `decide`, 진입 판정)는 I/O가 없으므로 L1 `@helm/kernel`의 하위 경로 `@helm/kernel/orchestration`에 둔다 [판정 J-128]. 15의 순수부(`planRound`, `roundClosable`, 탐구 투영)도 같은 경로에 있으므로 `decide`가 `planRound`를 부를 때 kernel이 runtime을 import하는 일은 없다. 이 경로에는 I/O 없는 함수만 둔다(06). 06 §3.4.6의 `createEngine({ policies: PolicySet })`가 "데이터로 둔 정책·모드·루프 계약(14)"을 받고, 10 §3.1.3의 `RuleBundle.loopContracts`도 이 데이터를 읽기 때문이다.
- 효과가 있는 부분(오케스트레이터 루프, 실행기, 스케줄러)은 L4 `@helm/runtime/orchestration`에 둔다(06 §3.4.10).
- 06 §3.10.1에 따라 Helm 의미에 속하는 값(다이얼, 구조 설정, 주의 예산, 질문 설정, 라우팅·합의 템플릿 패치)은 도메인 이벤트(`dial.set`, `setting.changed`)로 정본 DB에 둔다. 사람은 19 `dial.set`·`settings.update`로 바꾼다. 운영 한도(`maxConcurrentWorkUnits`, `maxConcurrentPerConcern`, `unattendedSpendCapUsd`, `features.*`)는 06의 설정 파일(`helmd.toml`)에 둔다. §3.13.2의 `OrchestrationSettings`는 이 둘을 합친 읽기 모델이다.

---

## 4. 실패·예외·경계 사례

### 4.1 사례 표

| # | 사례 | 처리 |
|---|---|---|
| F01 | 커널이 전환을 의존 규칙으로 거부 | §3.9.4의 처리. 거부는 관찰로 남는다(A14). 같은 전환을 같은 계기로 다시 보내지 않는다(G1) |
| F02 | 상황 판정이 두 번 거부(근거 없음) | O 종료 결과 `disorder` → `S.split`. 분해할 부분도 선언되지 않으면 `S.split` WorkUnit이 부분을 제안하고, 그것도 실패하면 `progress_stall` 접점("상황을 판정하지 못했습니다", 근거 부족 목록) |
| F03 | 판정 결정표가 disorder를 냈는데 `parts`가 없음 | `S.split` WorkUnit이 부분을 제안한다. 부분이 1개면 분해하지 않고 `complicated`(확신 low)로 계획하고 `alternative: complex`를 기록한다 |
| F04 | 진전 없는 순환(A → I → C → A …) | G2 → `progress_stall` 접점. 사람 답이 오기 전까지 그 Concern은 새 WorkUnit을 요청하지 않는다 |
| F05 | WorkUnit 실패(도구 오류, 제공자 영구 오류) | 읽기 전용이면 1번 재시도. 그 밖에는 `progress_stall` 정보 게이트 질문. 실패는 관찰로 남는다 |
| F05b | 제공자 장애(`run.ended(failed, model_unreachable)`) | 질문을 만들지 않고 `waiting(model)`. 12의 모델 가용 신호 뒤 같은 WorkUnit을 다시 요청한다([판정 J-109], §3.12.3) |
| F06 | WorkUnit 중단(데몬 재시작) | §3.16.5 |
| F07 | 예산 소진(활성화) | 계약의 `budget_exhausted` 결과. I 계열은 열린 질문을 넘기고 계획 다음으로, C 계열은 `budget_extension` 접점 |
| F08 | 사람이 의존 규칙과 충돌하는 지시("합의 없이 그냥 커밋해") | 지시에 범위가 있으면 지시를 사람이 쓴 합의로 기록하고(출처 `directive`) 요약을 되돌려 보여 준 뒤 진행한다. 범위가 없으면 모델이 범위를 채운 합의 초안을 만들고 사람 확인 1회 |
| F09 | 혼돈인데 비상 합의가 없음 | `emergency_authorization` 즉시 질문. 답이 올 때까지 쓰기 없음. 읽기 탐구(I.fact)는 진행 |
| F10 | 비상 합의 범위 밖 행동이 필요 | `scope_change` 질문 즉시. 범위 안 행동은 계속 |
| F11 | 안정화 선언이 거짓(오류가 다시 오름) | 새 `chaos_signal` → T07 → `C.emergency` 재진입. 같은 Concern에서 세 번째면 G2 |
| F12 | Goal이 없는 Concern에서 C로 가려 함 | 일어나지 않는다: Concern은 열릴 때 자리표시 Goal("이름 없는 Goal")에라도 연결된다(§3.14.6, 01 FX-13). Goal 초안 확정은 예약 전달이고, 그동안 자리표시 Goal로 진행한다 |
| F13 | 하위 수·깊이 상한 초과 | G8 → `structure_limit` 접점(협상). 답이 "그대로"면 이번 분해에 한해 상한을 넘겨 기록한다 |
| F14 | 하위가 열린 상위를 사람이 닫음 | 하위도 닫을지 묻는 접점. 답이 없으면 하위를 `S.detach`(§3.12.5) |
| F15 | 병합하려는 Concern에서 WorkUnit 실행 중 | 다음 `workunit_end` 경계까지 미룸. 실행 중 C(쓰기)가 있으면 그 C의 결과 제출 뒤까지 미룸 |
| F16 | 닫힌 Concern에 이의, 예측 불일치, 판단 contested | 다시 연다(`concern.reopen`). 계획 cause `reopened`. 결과가 다른 Concern의 합의에 쓰였으면 그 Concern에도 T27 |
| F17 | 같은 이벤트 배치에서 여러 규칙 발동 | §3.9.3 우선순위로 하나만 적용, 나머지는 다음 이벤트에서 다시 평가 |
| F18 | 사람이 서로 다른 클라이언트에서 충돌하는 지시를 보냄 | 커널 커밋 순서대로 처리한다. 뒤 지시가 앞 지시를 덮고, 덮인 지시는 "뒤 지시로 덮임"으로 복귀 요약에 남긴다 |
| F19 | 다이얼 값이 범위 밖이거나 권리 게이트에 never_ask | `DialValidationError`. 변경 명령을 커널이 거부한다(`invalid.schema`, 내용 거부, §4.3). 클라이언트에 그 코드를 준다 |
| F20 | 15가 계약 밖 능력을 요청 | `clampToContract`가 줄이고 `orchestration.guard_tripped(contract_clamp)` 지표 |
| F21 | 모델이 자기 결과를 확인하려 함(accept 제안) | 어느 계약에도 accept 제안 종류가 없어 그런 도구가 노출되지 않는다. 우회 시도는 10이 자격 거부 |
| F22 | 쓰기 후 결과 제출 없이 끝남 | T32: submit WorkUnit 1회. 그래도 없으면 `workunit.pause{reason: submission_missing}`(08 PauseReason에 값 요구)와 `submission_missing` 접점. 12의 턴 끝 "한 번 더" 요청은 WorkUnit당 1회로 제한해 무한 반복을 막는다(X2 d-2) |
| F23 | 프롬프트 캐시를 깨는 도구 목록 변경 | WorkUnit 경계에서만 도구가 바뀐다(D5). 활성화 중 모드가 바뀌어도 실행 중 WorkUnit의 도구는 그대로이고 다음 WorkUnit부터 바뀐다 |
| F24 | 타이머 폭주(데몬이 오래 꺼졌다 켜짐) | 발화 간격과 순서는 12 §3.10.4. 오케스트레이터는 같은 대상·같은 목적의 중복 행동만 거른다(§3.16.5-5). 지난 가정 만료는 "복귀 + 30분"으로 미뤄진다([판정 J-142]) |
| F25 | 체크포인트 손실 | 0부터 재처리. 키 중복으로 부작용 없음. 처리 시간만 늘어난다 |
| F26 | 주의 예산이 다 찬 상태에서 권리 게이트 | 예산과 무관하게 전달(§3.13.5-1). 사용량은 센다 |
| F27 | 사람이 부재(`isAway`)이고 Concern 전부가 사람을 기다림 | 스케줄러는 새 WorkUnit을 시작하지 않는다. 타이머만 발화한다. 복귀 시 복귀 요약 |
| F28 | 기능 플래그에서 A.confirm을 끔 | 설정 검증 오류(§3.15) |
| F29 | 상황 판정과 사용자 지정 모드가 맞지 않음(예: chaotic인데 taste 지정) | 사용자 지정 모드를 유지하되 C.emergency 진입은 모드 규칙(§3.10.4)에서 모드 능력 부족이면 사람 접점으로 알림. 복귀 요약에 불일치 표시 |
| F30 | I 계열 루프에서 사람 답이 계속 없음 | `autonomy` 라운드 뒤 대기. 정보 게이트 질문은 만료점에서 승격(11. 막지 않는 정보 질문은 `notice`). 권리 게이트가 아니면 가정 확정 후 진행 |
| F31 | 백업에서 복원한 뒤 첫 부팅 | 17이 남긴 복원 표지 뒤 안전 모드([판정 J-152]). 스케줄러는 새 WorkRequest를 허가하지 않고, 미소진 승인은 커널이 만료시킨다. 사람이 복귀 요약을 보고 19로 해제하면(09 `daemon.safe_mode_exited`, [판정 J-165]) 재개한다(§3.16.5-6) |
| F32 | 승인 대기 호출이 남은 채 WorkUnit이 결과를 제출한 뒤 승인이 옴 | 새 run을 요청하지 않는다. 결과 확인 화면에 "승인됐지만 실행하지 않은 행동"으로 보인다(§3.12.3) |
| F33 | 이의로 WorkUnit이 멈춘 상태에서 run이 `yielded`로 끝남 | 멈춘 WorkUnit은 다시 요청하지 않는다. 이의 처리 뒤 `workunit.resumed`가 오면 이어 간다(§3.12.3, §3.12.4) |
| F34 | run이 요청 수 상한(`step_limit`)·예산 상한·벽시계 감시로 끝났는데 WorkUnit이 덜 끝남 | 활성화 예산이 남으면 같은 WorkUnit·같은 thread에서 `resume`으로 다시 요청(최대 3번), 아니면 `budget_extension`(§3.12.3) |
| F35 | 모델 계획 초안이 V-PLAN-04~06에서 거부됨 | 첫 위반은 `command.rejected`(retryable)로 모델에 돌아가 같은 run에서 한 번 더 낸다. 두 번째 위반은 커널이 코드 계산 계획을 `authoredBy: code`로 기록하고 `notice.plan_draft_fallback`을 낸다(§3.8.5) |
| F36 | `planAuthoring: computed`인데 모델이 계획 초안을 냄 | `denied.plan_authoring_mode`로 거부하고 재요청하지 않는다. 코드 계산 계획을 쓴다. 두 번째 위반으로 세지 않는다(V-PLAN-02, §3.8.5) |
| F37 | 표시 `outOfPattern`에 근거가 없거나 근거 id가 기록에 없음 | 커널 V-PLAN-01이 거부한다(`invalid.schema` 또는 `invalid.evidence_not_found`). F02와 같은 방식으로 한 번 다시 선언한다 |
| F38 | 표시 충돌(`reviewOnly`와 `needsWrite`가 함께 참) | `buildPlan`이 NoRule을 낸다. hybrid에서는 초안을 요청하고, computed에서는 골격 `[O]`과 `progress_stall` 접점을 연다(§3.8.2 0단계, §3.8.5) |

### 4.2 경계 사례 결정

1. **산출물형 작업(글, 보고서)에서 C와 A가 겹칠 때**(v0.3 10 §4.1-1): 초안은 원함 탐구의 자극이거나(Helm 저장 공간, C 불필요) 탐침이다. 사용자 파일·외부 시스템에 최종본을 쓰는 순간이 C.commit이다. 초안 하나하나를 WorkUnit으로 두되 합의는 탐침 묶음 하나로 묶는다. "완료"는 최종본의 A.confirm 뒤다.
2. **I만 쓰는 작업**: 탐구 결과 제출 → A.confirm(사람이 판단·보고를 확인) → 닫기. 쓰기가 없으면 합의도 없다.
3. **A만 쓰는 작업**(검증 요청): `verify` 모드, 계획 `O → A.confirm`. 제출물은 사람이 가져온 결과물(제출 행위자 human).
4. **O만 쓰는 작업**("어디까지 했지"): Concern을 열지 않는다. 복귀 요약 투영 요청(12)으로 처리한다.
5. **사람이 루프를 직접 지정해 계획과 다르게 감**: T20. 계획 수정(cause `directive`, decidedBy human). 혼자 정한 결정이 아니므로 이의 대상이 아니다.

### 4.3 오류 코드

오케스트레이터가 내는 거부와 오류(클라이언트 응답과 로그)는 10 거부 코드로 낸다. 프로토콜 오류 번호와 응답 형식은 19가 정하고, 이 표는 어떤 사례에 어느 거부 코드를 쓰는지 정한다. 이 문서의 `ORCH_*` 이름은 쓰지 않는다([19의 요구], §5.3).

| 10 거부 코드 | 사례 |
|---|---|
| `invalid.schema` | 다이얼 값이 범위 밖이거나 권리 게이트에 `never_ask`(10 V-POL-01), 설정 값의 형식·범위·조합 위반(A.confirm을 끔, F28), 없는 루프 식별자, 계약 데이터 적재 실패(V-POL-01의 적재 실패와 같은 코드. 데몬 시작 실패) |
| `policy.plan_maturity_gate` | 기능 플래그로 꺼진 루프 지정(계획 검사 V-PLAN-06과 같은 코드, `maturity:<loop>`) |
| `policy.loop_entry_condition` | 지정한 루프의 진입 조건이 거짓이고 돌릴 곳(`onUnmet`)이 없음([판정 J-191]) |
| `conflict.invalid_transition` | 닫힌 Concern에 다시 열기가 아닌 지시(08 상태 기계에 없는 조합) |
| `policy.structure_cap_exceeded` | 구조 상한 초과(사람 확인 전). `needs_gate`로 질문을 만든다(08 R-32) |

---

## 5. 다른 문서와의 인터페이스

### 5.1 이 문서가 제공하는 것

| 대상 문서 | 제공하는 것 | 위치 |
|---|---|---|
| 08 | `ExitOutcome` 값 목록, `RunHandoff` 모양, `HumanTouchpointKind`(`QuestionKind` 부분집합), LoopPlanCore·LoopTransitionRecord·SituationAssessmentRecord의 필요 필드, ProbeSpec·WatchSpec·Condition, BoundaryItem, StandingAgreementTemplate의 필요 필드 | §3.5.2, §3.5.3, §3.5.6, §3.6.7, §3.6.11, §3.7.1, §3.8.1, §3.9.1 |
| 09 | 오케스트레이터가 내는 이벤트 목록, ConcernView를 만드는 데 읽는 이벤트, 런타임 체크포인트 | §3.12.1, §3.16.1, §3.18 |
| 10 | 오케스트레이터가 보내는 명령 목록, 의존 규칙의 오케스트레이션 측 동작과 거부 처리, 루프별 제약이 커널 불변조건에 들지 않는다는 경계 | §3.1, §3.9.4, §3.18 |
| 11·26 | 사람 접점 종류와 기본 게이트, C/A 상한과 묶기 규칙, 작업 경계 목록과 `boundary.reached`, 주의 예산 상태, 부재 함수 `isAway`, 루프별 전달 기본값(`resolveDials` 유효값) | §3.5.3, §3.11.1, §3.13.5~§3.13.8 |
| 12 | WorkRequest 형식과 결정적 id, 컨텍스트 섹션 이름(`choices` 포함), 정지 요청(wrap_up/abort), 예산 배분, 복귀 요약 요청 시점, `RunEndReason`별 처리, 재시도 규칙 | §3.5.5, §3.12.3, §3.13.4, §3.16 |
| 13 | WorkUnit별 유효 원시 행동·제안 종류 집합(도구 노출 기준), D10(Helm 저장 공간은 propose) | §3.5.3, §3.10.4, §2.2 |
| 15 | 탐구 루프 계약(예산, 자율, 종료 결과), `planRound` 호출 규약, 다이얼 7~12의 해석값 | §3.6.2~§3.6.5, §3.11 |
| 16 | 지표 이벤트(C/A 우회율, 주의 예산, 가드 발동, 진입·범주 지표, 라우팅 이의, 계획 작성자별 기록), 성숙도 단계별 검증 지표 대응 | §3.13.5, §3.13.7, §3.14.7, §3.15, §3.8.1 |
| 03·04·05·21 | 화면에 보일 OPD+C 의무 id, 모드·다이얼·설정 층 표시, 루프 계획·전환 이력(작성자 `authoredBy` 포함), 사람 접점 종류 | §3.5.5, §3.6, §3.8.1 |
| 19 | 사람 명령(루프 지정, 계획 수정, 모드 지정, 다이얼 변경, Concern 열기·닫기, 이의)과 접속 상태 입력 | §3.12.3, §3.13.8 |
| 22 | 결정적 decide 함수, 고정된 결정표·라우팅 표·우선순위 튜플(속성 테스트 대상) | §3.7.2, §3.10.3, §3.13.3, §3.16 |
| 23 | 루프 기능 플래그와 제품 단계별 묶음 | §3.15 |

### 5.2 다른 문서에 요구하는 것

이미 반영된 요구는 뺐다(반영 위치는 §3.20.1, 처리 상태는 §3.20.3). 남은 요구만 적는다.

| 문서 | 요구 |
|---|---|
| 02 | UC-03의 범위 확대·권리 게이트(push) 조작은 C/A 상한 밖, 사유와 함께 센다(§3.13.7, 01 R-OP-4). 14 계약의 `scope_change`·`send_approval`은 `countsTowardCaCap: false`다 |
| 03·04·05·21 | (1) OPD+C 의무 id는 `opdc:<o\|p\|d\|c>.<이름>`([판정 J-149], §3.5.5)이고 id마다 화면 요소를 둔다. (2) 다이얼 패널은 `DIAL_DEFS`(§3.11.2)를 읽고, 범위는 user·Concern·지시 셋뿐이다(Goal 범위 없음, [판정 J-136]). MVP는 노출 다섯 개만. (3) 루프 계획(건너뛴 루프와 이유)과 전환 이력. (4) 주의 예산 막대는 §3.13.8의 값으로. (5) 시간당 알림 상한은 데몬 `interruptsPerHour` 하나이고 앱 상한(3)을 따로 두지 않는다. 휴대폰 알림을 켤 때 조용한 시간 23:00~08:00을 제안값으로 보인다(§3.13.8). (6) 보관 Concern(`light_work`)은 Concern 목록에서 숨기고 "가벼운 작업"으로. (7) 결과 확인 화면은 반영 범위 초안을 구조 값으로 접지 않고 보이고([판정 J-126]), "승인됐지만 실행하지 않은 행동"을 보인다(§3.12.3). (8) 선택 요청의 "정하면 생기는 일"에 묶인 판단 확인("판단 n도 확인됨")을 보인다(§3.13.7). (9) 막지 않는 권리 게이트와 가벼운 작업 결과 확인 묶음은 홈에서 접고 개수를 보인다([판정 J-132]). (10) run 목록은 Concern 트리로 묶어 보이고 평면 목록으로 보고하지 않는다(03 `RGN-RUNS`). (11) 계획의 `authoredBy`가 `model`이면 "모델이 설계한 계획"으로 표시하고, `code`이고 `modelDraftRejects`가 두 건이면 "모델 초안 두 번 거부, 코드가 계산"을 보인다. 문구와 위치는 04·05가 정한다([판정 J-188]) |
| 06 | (1) `@helm/kernel/orchestration`에는 I/O 없는 함수만 둔다는 문장과, 15 순수부(`planRound`, `roundClosable`, 탐구 투영)도 같은 경로라는 것([판정 J-128]). (2) 운영 한도와 `features.*`를 `helmd.toml` 스키마에 |
| 08 | (1) `RunHandoff.transition_request`에 `trigger: DeclaredTrigger`, 변형 `situation_answers`를 더한다(§3.5.6). (2) `Inquiry.stop`의 `then`(`'proceed' \| 'handoff' \| 'decide_now'`, 10 정본)을 둔다. 14는 `then === 'decide_now'`로 "지금 정하기"를 계산한다(§3.6.3, T20). `decideNow` 불리언은 두지 않는다([판정 J-157]). (4) E-02 문장을 FX-13(자리표시 Goal로 진행)과 맞춘다(§3.14.6). (5) `Device.clientKind`의 타입 이름 `ClientKind`를 내보낸다(§3.13.8). (6) `SettingDef`·`DIAL_DEFS` 데이터 파일을 `@helm/domain`에 둔다(값과 뜻은 14 §3.11, 19가 import). (7) `LoopPlanCore`에 `authoredBy`(code·model·human)를, `PlanFlags`에 `outOfPattern: Flag`를 더한다(§3.8.1, [판정 J-188]). (8) `DIAL_KEYS`에 `planAuthoring`(층 user·concern)을 더한다(§3.11.1, [결정 53]). (9) `inquiry.stopped`의 `then`은 08 값과 같은 이름이다([판정 J-157]). (10) `DIAL_KEYS`에 `assumptionDeferOnDowntime`을 더한다(§3.11.1, [판정 J-197]) |
| 09 | (1) `run.ended` payload에 `handoff: Nullable(RunHandoff)`(08 정의, C14-4). (2) `inquiry.stopped`에 `then`(08과 같은 값, [판정 J-157]). 15 §3.1.5의 `human_decided`가 `then`을 `note`에 싣는 곳은 이 필드로 옮긴다. (3) `agreement.activated_by_choice`([판정 J-90], 10이 이미 씀). (4) 이벤트 tail API와 Concern별 필터, 런타임 체크포인트 테이블(`orchestrator` 커서, 선택적으로 ConcernView 스냅숏). (5) `loop_plan.adopted` payload의 `authoredBy`와 `modelDraftRejects`(규칙 id, 최대 2)를 §3.8.5와 맞춘다([판정 J-188]). (6) `runtime_timers`의 목적 `result_review_digest`를 더한다([판정 J-189], §3.13.5 규칙 7). (7) `setting.changed`는 `attention.snoozeUntil`·`attention.quietHours`와 `notifications.*`의 변경도 기록한다([판정 J-166], [판정 J-189], [판정 J-195]) |
| 10 | (1) `runtime.signal`에 `abort`(C14-6, §3.16.3). (2) `result.submit`에서 검증 에이전트 run을 여는 `agent.request(verifier)` 효과를 빼고, 독립 검증이 요구되는 결과는 검증 기록이 있을 때만 결과 확인 질문을 낸다(C14-13, §3.6.8). (3) 오케스트레이터 제출 payload의 레코드 id를 멱등 키에서 결정적으로 만드는 `derivedIdFactory` 규칙을 §3.3에(§3.16.1, V6-011). (4) 승인 대기 호출이 남은 WorkUnit의 결과 제출: 승인 대기를 결과 제출에 "실행하지 않은 행동"으로 싣고, 그 뒤 온 승인은 실행하지 않는다(§3.12.3, F32). (5) 복원 표지 뒤 미소진 승인을 `approval.expired{restored}`로 닫는다([판정 J-152]). (6) 증명 부담 값별로 바뀌는 것과 바뀌지 않는 것 표(V1-048). (7) `question.raise`(R)로 오케스트레이터 접점 질문(§3.5.3 표의 오케스트레이터 몫, "지금 정하기" 뒤 `choice` 포함)을 받기. (8) 루프 계획 초안 검사 V-PLAN-01~07과 거부 코드, 대체 흐름은 10 §3.8.1이 정본이다. 14 §3.8.5는 그 규칙 번호와 코드를 인용한다. `validatePlan`(V-PLAN-04~06)과 `buildPlan`은 10 커널이 부르는 순수 함수다([판정 J-188], [판정 J-128]). (9) 계획 방식 `planAuthoring`은 `resolveDials`의 유효값으로 읽는다(10 P-12, §3.11.5) |
| 11 | (1) `urgencyOf`·푸시 계획·`user_return`은 14 `isAway` 하나를 쓴다([판정 J-119]). (2) D-10·D-11은 `resolveDials`의 유효 `defaultDelivery` 하나로 판정하고, A 계열 층 1은 `negotiated`([판정 J-143]). (3) 만료 임박 승격 강도: 막는 질문·권리 게이트는 `interrupt`, 막지 않는 정보 질문은 `notice`(§3.13.8). (4) `interruptsPerHour`는 모든 기기 합. (5) `finding_confirm` 묶기: 그 판단을 근거로 한 선택 요청이 있으면 거기에, 아니면 합의 확인에(§3.13.7). (6) 재결정 질문은 추천 없이 기록하고, 14가 요청한 재결정 run이 `question.updated`로 추천을 더한다(§3.12.4). (7) 막지 않는 권리 게이트는 기록 즉시, 전달은 다음 작업 경계 또는 검토 창([판정 J-132]). (8) 결과 확인 알림(§3.13.5 규칙 7)에서 `notifications.resultReview`가 `immediate`이면 결과 확인 질문의 강도를 `notice`로 준다. `daily_digest`이면 질문 강도는 `digest`로 두고, 묶음 푸시 하나(notice)만 14의 타이머 발화 뒤에 낸다. `none`이면 `digest`다([판정 J-189]). (9) 방해 금지는 `attention.snoozeUntil` 하나다. 11 §3.16 표의 "방해 금지"(데몬 설정)와 `KernelContext.attention`의 방해 금지 값은 이 설정을 읽도록 바꾼다([판정 J-166]) |
| 12 | (1) §3.20.2 WorkRequest → RunSpec 변환과 run 레코드의 `workRequestKey`. (2) 모델 가용 신호 `onModelAvailability(available)`를 실행기에 알린다(§3.16.1, [판정 J-109]). (3) 사람 대기 뒤 이어 가기 주체: 대기 run이 있으면 12, 없으면 14(C14-14). 이 기준을 §3.13과 §3.7.5(`decideResume`)에 적고, `decideResume`은 `workunit.paused`인 WorkUnit을 재개하지 않는다. (4) 질문 종결(answered·assumed·delegated·withdrawn·expired)과 호출 종결(approved·denied·approval.expired)을 대기 해제 사건으로(§3.12.3). (5) 막는 범위 `action`인 승인 대기는 그 호출만 멈추고 run은 계속한다. (6) 벽시계 감시로 끝나는 run의 종료 사유와, 같은 WorkUnit·같은 thread의 `resume` 이어 가기 RunSpec. (7) `budget_extension` 진행 요약 형식은 §5.3 12행. (8) 복원 표지 뒤 첫 부팅은 안전 모드(run 자동 재개·에이전트 타이머 없음, [판정 J-152]). (9) 12는 작업 경계를 제출하지 않는다(§3.13.6). (10) 탐침 WorkUnit의 Concern당 동시 run(C14-5). (11) 가벼운 작업의 턴 끝 구조화 출력(`distinctSolutions`, 사람 발화 분류, 예상 범위)(§3.14.4). (12) 타이머 목적 `result_review_digest`의 저장과 발화, 발화 뒤 중복 제거(§3.13.5 규칙 7, §3.16.5-5, [판정 J-189]) |
| 13 | (1) §3.5.6 표로 `helm_<kind>` 도구를 만든다. 선언 도구(`transition_request`, `split_hint`, `entry_signals`, `stabilization_report`, `situation_answers`)는 커널에 제출하지 않고 handoff로 run을 끝낸다. `loop_plan_draft`는 선언 도구가 아니다. 모델 초안은 M 채널의 `loop_plan.record`(`steps`, `reason`)로 낸다(10 §3.8.1). 도구 이름은 13이 정한다. `transition_request`의 입력에 `trigger`(§3.5.6 `DeclaredTrigger`)를 둔다. (2) `situation_answers`는 선언 도구가 되었으므로 도구가 `situation.assess`를 내지 않는다. 판정 계산과 제출은 오케스트레이터가 한다(V6-071). (3) Helm 저장 공간에 만드는 것은 propose로 분류(D10) |
| 15 | (1) 라운드 끝 경계는 15 실행기가 제출하지 않는다. 14가 `inquiry.round_ended`를 받아 낸다(§3.13.6). (2) 예측의 `checkPlan`을 T18 점검에 씀. (3) 탐침 제안은 `probe_definition` 제안 + T33 |
| 16 | (1) `plan.deviated`는 `loop.transitioned`의 `planDeviation`·`skipped`에서 지표 추출기가 계산(§3.20.4). (2) C/A 지표는 01 `HumanDecisionOp`에서. (3) 지표 ID와 14 의무 ID(`opdc:`)를 다른 레지스트리로 둔다([판정 J-149]). (4) 계획 이의 비율을 `LoopPlanCore.authoredBy`(code·model·human)별로 잰다. `modelDraftRejects`의 길이별 건수도 센다([판정 J-188]) |
| 17 | (1) 데몬 시작 순서: 저장소 → 12 복구 → 오케스트레이터 루프(뷰 재구성) → 스케줄러. (2) 복원·업그레이드 되돌리기 뒤 안전 모드 진입 이벤트(`daemon.safe_mode_entered`, 사유 `restored`)와 정상 모드 복귀(`daemon.safe_mode_exited`, 해제 주체와 CLI는 [판정 J-165], [판정 J-153])를 14가 읽는다([판정 J-152]) |
| 19 | (1) `dial.set`·`dial.unset`의 `key`는 08 `DialKey`, 범위는 user·concern·instruction(Goal 범위 삭제, [판정 J-136]), `value`는 `DIAL_DEFS[key].valueSchema`로 검증. (2) `settings.update`의 키와 값 스키마는 `DIAL_DEFS`의 `kind: "setting"`. (3) `mode.set`의 값은 08 `MODE_IDS`. (4) §4.3의 거부 코드는 10 거부 코드다. `ORCH_*` 이름은 쓰지 않으며, 19 §3.3의 `orch.*` 임시 대응은 §4.3 표로 바꾼다. (5) 의미 설정 `attention.snoozeUntil`(방해 금지), `attention.quietHours`(조용한 시간), `notifications.resultReview`, `notifications.resultReviewDigestAt`은 `settings.update`로 바꾼다. 키 검증은 `DIAL_DEFS`의 `kind: "setting"` 항목을 쓴다([판정 J-166], [판정 J-189], [판정 J-195]) |
| 20·26 | (1) 시간당 알림 상한은 데몬 `interruptsPerHour` 하나(모든 기기 합). (2) `notice` 강도의 휴대폰 푸시는 모든 데스크톱 기기가 부재일 때만. (3) 휴대폰 알림을 켤 때 조용한 시간 23:00~08:00 제안. (4) 부재 2시간 이상 뒤 복귀 시 복귀 요약 자동 열기(§3.13.8). (5) 26 §3.3: 휴대폰이 `active`가 되는 것은 `user_return`이 아니다(11 §3.8.1). 26 L459의 "휴대폰 active → user_return 발화" 문장을 고친다. (6) 결과 확인 묶음 푸시(§3.13.5 규칙 7)는 26 `planPush`로 낸다. 타이머 `result_review_digest`가 울린 뒤 notice 강도로 보내고, 방해 금지·시간당 상한·데스크톱 부재 조건을 따른다([판정 J-189]) |
| 22 | (1) §6.2 완료 기준 C-1~C-29를 테스트 계층에 배치. (2) 14 의무 ID와 16 지표 ID 레지스트리에 같은 문자열이 없는지 검사([판정 J-149]). (3) §6.2 C-4의 모델 초안 경로를 가짜 모델 `faux:helm`([판정 J-169])으로 재생한다([판정 J-188]) |
| 23 | (1) 기능 플래그 단계별 기본값은 23 §3.5.4와 같다(§3.15, `deliberate`는 2단계). (2) ADR-14-12를 24에 옮길 때 구현 순서에 영향 없음 |
| 24 | ADR-14-1~14-12를 색인에 올린다. ADR-14-10은 [판정 J-128]로 채택. ADR-14-12(루프 계획 혼합 방식: 표시 선언과 코드 계산, 표시 밖 상황은 모델 초안과 코드 검사)는 [결정 53], [판정 J-188]로 채택한 것으로 색인에 올린다 |
| 25 | 용어 등록: 계획 작성 방식(`planAuthoring`: computed·hybrid·model), 표시 밖 상황(`outOfPattern`), 모델 계획 초안(`loop_plan_draft`), 계획 검사(`validatePlan`), 계획 작성자(`authoredBy`: code·model·human), 가정 만료 미루기 다이얼(`assumptionDeferOnDowntime`, [판정 J-197]). 혼동 주의 칸에 계획 표시(`PlanFlags`)와 계획 초안의 차이를 적는다([판정 J-188]) |

### 5.3 다른 문서가 14에 요구한 것과 처리

| 요구한 문서 | 요구 | 처리 |
|---|---|---|
| 01 | 진입 판정 EC-3 예외 | §3.14.3 규칙 3 |
| 01 | 가벼운 작업(일반 세션)에 의존 규칙 (1)(2)를 압축 형태로(OQ-14) | 판정 J-01. §3.14.2 |
| 01 | MVP 모드 4종, MVP 노출 다이얼 5개, 명확·복잡·복합 기본 조합 | §3.15 기능 표, §3.11.1 MVP 열, §3.7.4. MVP 노출 다이얼은 [판정 J-192]로 여섯 개다 |
| 01 | Quick/Guided/Assured 관계(OQ-12) | §3.11.7, 판정 J-12 |
| 02 | MVP 복합 조합에서 C.probe·A.watch 생략(UC-01), I 건너뜀 기록(UC-07), 정지 규칙 전환, 강등(UC-15), 다이얼 층(UC-12) | §3.15, §3.8.1 `planDetail.skipped`, T21, §3.14.5, §3.11.3 |
| 03 | 루프 화면 이름("약속 실행" = C.commit, "확인·반영" = A.confirm) 확인 | 받아들인다. 루프 계약의 `nameKo`는 문서용이고 화면 이름은 03이 정한다 |
| 03 | 사람 접점 종류와 질문 화면 종류의 대응 | §3.5.3 표와 08 `QuestionKind`(§3.20.1). 화면 대응은 03 §3.2.4 |
| 03 | `maxVisibleDecisions` 3을 홈 주의 카드 수로 | §3.13.2 |
| 04 | 다이얼 정의를 데이터로(이름, 값, 설명, 편집 범위, 출처 층) | `SettingDef`, `DIAL_DEFS`(§3.11.2) |
| 04·05 | 주의 예산 "다이얼" 등록(홈 카드 3, 시간당 알림 3, 복귀 요약 자동 열기 기준) | 다이얼이 아닌 설정으로 등록(D8): `attention.maxVisibleDecisions` 3, `presence.autoOpenBriefAfterAwayMinutes` 120. 시간당 OS 알림 상한은 앱 쪽 기기 설정(§3.13.8) |
| 05 | 앱 쪽·데몬 쪽 주의 예산이 다른 층임을 적기, "지금부터 1시간" 방해 금지, 부재 기준 통일 | §3.13.8, `attention.snoozeUntil`, 시간 기준 표 |
| 08 | `DialKey`별 값 스키마·기본값, 구조 상한 7·3 | §3.11.1, §3.11.2 |
| 08 | `TransitionTrigger`와 규칙 id 대응 | §3.9.7 |
| 08 | 규칙 결정은 `kernel`, 모델 선언 반영은 `runtime` + `declaredBy` | §3.18 |
| 08 | Concern 종료 상태 `completed`·`merged`·`closed` | §3.12.3 |
| 08 | Goal 개정 시 진행 중 WorkUnit을 멈출지(U-16) | 멈추지 않는다. 표시만 하고, 개정된 Goal에 기대는 다음 C 활성화부터 새 버전을 쓴다(§3.9.4 규칙 5). 08 추천과 같다 |
| 09 | 규칙 결정 행위자, 단계 진행은 trace | §3.18, §3.20.5 |
| 10 | 루프 계약 데이터에 진입 규칙(신호 문턱), 구조 상한, 루프별 전달 기본값 | 진입 문턱은 계약 데이터의 상수 2(01 고정), 구조 상한은 구조 설정 키(§3.11.1), 루프별 전달 기본값은 `question.per_loop` 층 1(§3.11.1) |
| 10 | 다이얼 정본에 11 §3.16 질문 다이얼과 증명 부담·독립 검증 | §3.11.1 |
| 10 | K-4 Quick/Guided/Assured | (a) 증명 부담 값 이름. §3.11.7 |
| 10 | 오케스트레이터 명령에 `declaredBy` | §3.18 |
| 10 | 미룸은 에이전트 제안 허용 | §3.5.6 `obligation.defer` |
| 11 | 질문 설정을 `OrchestrationSettings`에, 루프별 전달 기본값, 경계 목록 확정과 `user_return`, 주의 상태 전달, `rule_default` | §3.13.2 `asking`, §3.11.1, §3.13.6, §3.13.8, §3.20.1(`rule`) |
| 12 | `RunSpec.instructions`와 섹션 순서 | 지시문 템플릿 `contracts/instructions/*.md`, 섹션 순서는 12 우선순위(§3.20.2) |
| 12 | `budget_extension` 접점이 받을 진행 요약 형식 | `{ done: string[]; remaining: string[]; spent: RunBudgetUsage; reasonToContinue: string; recommendedExtra: { subcalls?: number; wallMinutes?: number; costUsd?: number }; alternative: "narrow_scope" 또는 "stop_here" }`. 이 형식이 정본이고 12 §3.11.4가 따른다. 12의 하드 예산 초과 `run.end` 요약을 이 형식으로 채운다. 질문 선택지 키는 `extend`(추천 증액으로 계속), `narrow_scope`(범위를 줄여 계속), `stop_here`(여기서 멈추고 제출)이고 02 UC-03 A3의 세 버튼과 같은 순서다. 문구는 05 문구 키 |
| 12 | 하위 run 실패 시 재시도 판단 | 검증 WorkUnit은 한 번 더, 가지 run은 15, 그 밖은 정보 질문(§3.16.5) |
| 13 | `ContractProposalKind`와 도구 대응 | §3.5.6 |
| 13 | `EvidenceToolset`의 문서 루트 설정 위치 | 13의 설정 키 `tools.docRoots`(프로젝트 단위)를 따른다. 14 설정에는 두지 않는다. 14는 다이얼 `inquiry.evidence_range`만 정한다 |
| 13 | 선언 도구 입력 스키마(`RunHandoff`)와 이름(`helm_declare_transition`, `helm_declare_split`, `helm_entry_signals`, `helm_declare_stabilized`) 확인 | 확인한다. 스키마는 08 `RunHandoff`. 추가 선언 `situation_answers`의 도구 이름은 13이 같은 규칙으로 정한다(예: `helm_declare_situation`), §5.2 13 |
| 12 | `concurrencyClass: 'probe'`, `turnReport`, `boundary_clock` 알림 → `runtime.boundary`, `model_probe` → 재요청, `RunEndReason`·code 전체 처리, 승인 뒤 새 run, runId로 이어받기 주체 구분, `choices` 섹션, paused WorkUnit 요청 안 함 | §3.13.4 WorkRequest, §3.16.1 깨우기 입력, §3.12.3, §3.5.5 |
| 10 | 주의 예산 상태를 `KernelContext.attention`으로, 오케스트레이터 명령 이름(§3.11.3·§3.11.11) | §3.13.5 규칙 2, §3.18 |
| 11 | 재결정 질문 추천은 14가 `question.updated`로, 이의 뒤 전환표를 14로, `user_return`은 데스크톱·TUI 복귀만, `user_return`과 `presence.changed`의 묶음 ID | §3.12.4, §3.13.8 |
| 19 | 다이얼 키·값 스키마와 `OrchestrationSettings` 스키마를 `@helm/domain`에 | §3.11.2 `DIAL_DEFS` 위치 |
| 03 | 의무 ID 형식, 질문 종류 08, 홈 접기(J-132), `DialPrecedence` | §3.5.5, §3.5.3, §3.13.5 규칙 6, §3.11.2 |
| 05·20 | 앱 쪽 알림 상한을 데몬과 다른 층으로 적기 | 받아들이지 않는다. 시간당 알림 상한은 `interruptsPerHour` 하나(모든 기기 합)로 둔다(V5-020, 20 Q-23). §3.13.8 |
| 15 | `diverge` 템플릿 반복, 가지는 자식 run, I.want `deliberate` | I.fact는 라운드 0 한 번, I.possibility는 per_round(열린 칸이 있을 때), I.want는 `elicit` per_round + `deliberate` 끝에 한 번(§3.6.2~§3.6.4, 15 §3.1.1 표와 같음) |
| 15 | `planRound`·`runStage` 계약, 종료 결과 대응 | §3.16.4, §3.20.1 |
| 15 | `breadth`·`stimuliPerRound`·`autonomy` 해석 | 값과 기본은 §3.11.1(자극 수 8, J-06), 변환은 15 |
| 15 | 실현 가능성·`probe` 확인에서 나온 탐침 제안 처리 | T33(§3.9.2) |
| 15 | 선호 모델 변경 → I.want 재진입 | T17 |
| 15 | 제안 종류에 `stimulus`, `perspective`, `consequence` | §3.5.3, §3.5.6 |
| 16 | 절차 등록·신뢰도·사용 기록, `plan.deviated`, 정책 패치 대상, 돌아보기 구조화 | §3.20.4 |
| 19 | `dial.set` 스키마, 모드 이름, `OrchestrationSettings` 스키마, `LoopId` | §3.11.2 `DIAL_DEFS`, 08 `MODE_IDS`, §3.13.2, 08 `LOOP_IDS` |
| 21 | 주의 예산 단위·창·예약 몫, 다이얼 키와 값 목록 | §3.13.8, §3.11.1 |
| 01 | 진입·강등 기록을 `entry.evaluated`와 `structure.changed` 하나로, `assessEntry`/`decideEntry` 이름 통일 | §3.14.3, §3.9.6. 이름은 `assessEntry` 하나, 결과 값은 08 `enter`·`suggest`·`light_work` |
| 01 | 직전 I가 없을 때 `reopenTo`를 사람이 고름, C.commit에서 합의 예산이 루프 기본 예산보다 먼저, `model_unreachable` 회복 입력 | U-26·T09, §3.6.6 예산 행, §3.12.3·§3.16.1 |
| 01·02 | `concern.completed`는 돌아보기를 기다리지 않음 | §3.12.3: 선택 돌아보기는 닫힌 뒤 루프 밖 WorkUnit. 필수일 때(증명 부담 heavy, C.emergency)만 먼저 돈다 |
| 01 | C.commit의 권리 게이트·범위 초과를 C/A 상한 밖으로 | §3.6.6, §3.6.12 `countsTowardCaCap: false`, §3.13.7 |
| 15 | "지금 정하기" 뒤 루프 전환(계획의 다음 C, 없으면 C.commit)과 `question.raise(choice)` 순서 | §3.6.3, T20 데이터 |
| 15 | `StageResult` 대응표를 대기 처리에 씀 | §3.12.3 끝 문단 |
| 22·23 | §6.2 "메모리 SQLite"를 임시 디렉터리의 실제 파일로 | §6.2 머리말 |
| 22 | `model_unreachable` 대기와 회복 신호 뒤 재요청, 부재 파생 함수를 순수 함수로 | §3.12.3, §3.16.1, `macro/presence.ts`(§6.1), C-26·C-29 |
| 23 | `deliberate` 모드의 단계, `features` 기본값 | §3.15 표: 2단계에 `verify`, `deliberate` |
| 26 | 부재 함수에 기기 종류별 문턱(휴대폰 2분, 데스크톱 5분), `locked` 삭제, 11 타입 이름 `PresenceView`로 | 문턱과 `locked` 삭제는 §3.13.8에 반영. 타입 이름은 11 §3.8.1의 현재 정의 `PresenceSnapshot`을 따른다(11이 소유. 11이 이름을 바꾸면 14도 따른다) |
| 25·16 | OPD+C 의무 ID 형식 `opdc:<기준>.<이름>` | §3.5.5, 모든 계약 표([판정 J-149]) |
| 19 (P12) | §4.3 오류 코드 `ORCH_*`를 10 거부 코드(`policy.*` 등)로 낸다 | §4.3 표를 10 거부 코드로 바꿨다. 10이 정한 코드를 인용했고, 진입 조건 거짓 1건은 10이 정한 `policy.loop_entry_condition`으로 냈다([판정 J-191]). `ORCH_*` 이름은 폐기한다. 19 §3.3의 `orch.*` 임시 대응은 19가 바꾼다(§5.2 19 행) |

---

## 6. 구현 단위와 완료 기준

### 6.1 파일 구성

오케스트레이션 코어(순수)는 L1 `@helm/kernel`, 효과가 있는 부분은 L4 `@helm/runtime`에 둔다(§3.20.6).

```text
packages/kernel/src/orchestration/          # @helm/kernel/orchestration. I/O 없음
  contracts/
    types.ts                  # §3.5 타입 (LoopId 등은 @helm/domain에서 import)
    catalog/*.ts              # 루프 계약 18개(§3.6)
    instructions/*.md         # 루프·목적별 지시문 템플릿(12 RunSpec.instructions 재료, §3.20.3)
    registry.ts               # 로딩·검증(TypeBox), 공통 OPD+C 의무 추가
    guards.ts                 # 조건 레지스트리(§3.5.4)
  modes/
    types.ts, catalog.ts      # §3.10
    router.ts                 # 라우팅 결정표(데이터), LOOP_HOME_MODE
  dials/
    types.ts, defaults.ts     # §3.11.1, §3.11.4 층 2 값. DIAL_DEFS 데이터 자체는 @helm/domain/src/dials.ts(19가 읽음)
    resolve.ts                # 층 해석, 검증, 자동 상향 계산
  situation/
    classify.ts               # 결정표(§3.7.2)
    signals.ts                # 재판정 신호(§3.7.5)
  plan/
    build.ts                  # buildPlan(§3.8.2)
    validate.ts               # validatePlan(§3.8.5). V-PLAN-04~06 의존·성숙도 검사(순수, 10 커널이 부른다)
    position.ts               # planPosition, nextInPlan, resolveNext(§3.8.4)
  transitions/
    rules.ts                  # TRANSITION_RULES T01~T33(§3.9.2), 우선순위(§3.9.3)
    signals.ts                # 규칙 조건의 순수 함수(reassessSignal 등)
    guards.ts                 # G1~G9(§3.9.5)
    dependency.ts             # 의존 규칙 사전 맞춤과 거부 처리(§3.9.4)
  concern/
    view.ts                   # ConcernView 타입, reduceView 리듀서, 상태 계산(§3.12)
    decide.ts                 # decide(§3.16.2~§3.16.4)
    contests.ts               # 이의 처리(§3.12.4)
  entry/
    assess-entry.ts           # 01 §3.6.3의 판정(§3.14.3)
    promotion.ts              # 승격 신호 집계(§3.14.4)
    demotion.ts               # §3.14.5
  macro/
    priority.ts               # concernPriorityKey(§3.13.3)
    admit.ts                  # admit(§3.13.4)
    attention.ts              # 주의 예산(§3.13.5)
    boundaries.ts             # 작업 경계 종류(§3.13.6)
    ca-cap.ts                 # C/A 상한과 묶기(§3.13.7)
    presence.ts               # isAway, isDeviceAway(§3.13.8). 11·26·22 하네스가 import하는 순수 함수
  features.ts                 # 루프 기능 플래그(§3.15)
packages/runtime/src/orchestration/         # @helm/runtime/orchestration. 효과
  settings.ts                 # OrchestrationSettings 읽기 모델(도메인 설정 + 운영 설정, §3.20.6)
  executor.ts                 # 행동 실행: engine.submit(06), 12 startRun, 11 질문 제출
  to-run-spec.ts              # WorkRequest → RunSpec 변환(§3.20.3)
  loop.ts                     # orchestratorLoop(§3.16.1), 체크포인트
  scheduler.ts                # 큐와 admit 실행, 경계 제출
  index.ts
```

### 6.2 완료 기준

각 항목은 Vitest 테스트로 확인할 조건이다. "재생 테스트"는 가짜 모델(정해진 제안 순서) + 실제 커널 + 임시 디렉터리의 실제 SQLite 파일(09 §6.2 공통 기준, 또는 저장소 없는 `@helm/engine/testing`)로 이벤트 로그를 재생하는 테스트다(22).

| id | 모듈 | 테스트로 확인할 조건 |
|---|---|---|
| C-1 | contracts/registry | 18개 계약이 모두 로딩된다. 모든 `PredicateRef.name`이 레지스트리에 있다. 모든 계약의 `requiredPrimitives ⊆ capabilities.primitives`. 기능 단계(MVP, 2단계, 3단계)마다 각 루프의 집 모드(꺼진 모드는 대체 모드, §3.10.4)의 원시 행동이 그 계약의 `requiredPrimitives`와 모든 WorkUnit 템플릿 원시 행동을 덮는다. 모든 `exit`의 `next`가 존재하는 루프를 가리킨다. 공통 OPD+C 의무 9개가 모든 계약에 붙는다. 계약 하나에서 조건 이름을 틀리게 바꾸면 `ORCH_CONTRACT_INVALID` |
| C-2 | contracts/guards | §3.5.4 표의 조건마다 참·거짓 사례 테스트 |
| C-3 | situation/classify | §3.7.2 표의 각 행에 대한 사례. 같은 답이면 같은 결과. "unknown" 5개 → disorder. taste yes + analysis yes → complex 쪽(취향 감점). 확신 high/medium/low 경계 사례 |
| C-4 | plan/build | 유형 다섯 개 × 플래그 조합의 기대 계획(스냅숏). C 계열 뒤에 A.confirm이 항상 있다(속성 테스트: 무작위 플래그·모드·유형에서). S.split 뒤에 S.recombine과 A.confirm이 있다. clear는 I를 `planDetail.skipped`에 기록한다. 같은 입력이면 같은 계획. 모델 초안 경로(§3.8.5): `planAuthoring` 세 값 × `outOfPattern` 참·거짓 × 표시 충돌에서 경로가 표와 같다. 위반 초안은 `retryable` 거부로 한 번 돌아가고, 두 번째 위반이면 `notice.plan_draft_fallback`과 코드 계획(`authoredBy: code`)이 남는다. `computed`의 초안은 `denied.plan_authoring_mode`로 거부된다 |
| C-5 | plan/position | 계획 뒤쪽 루프로 바로 갈 때 사이의 필수 단계가 `planDetail.skipped`에 기록된다. `⇄` 구간에서 I와 C.probe가 번갈아 나온다. 계획 끝에서 완료 조건이 없으면 O |
| C-6 | transitions/rules | `TRANSITION_RULES`의 T01~T33 각각: 계기 이벤트(09 이름)를 주면 기대 도착과 ruleId·trigger가 나온다. 표(§3.9.2)의 모든 id가 데이터에 있다. 우선순위: 사람 지시와 혼돈 신호가 같은 배치면 사람 지시가 먼저. T09·T11의 도착은 `acceptance.reopenTo`다 |
| C-7 | transitions/guards | G1: 같은 이벤트를 두 번 넣어도 전환 명령은 같은 키 하나. G2: 진전 없이 A→I→C→A를 세 번 돌면 세 번째에 `progress_stall` 접점이 나오고 전환이 없다. G3: 새 근거 없는 자동 재판정은 막힌다. G4: 수정 요청 3번째에 결과 확인 선택지에 I 제안이 들어간다. G7, G8, G9 사례 |
| C-8 | transitions/dependency | 활성 합의 없이 write가 있는 WorkUnit을 요청하지 않는다(속성 테스트: 무작위 이벤트 순서에서 write 템플릿 WorkRequest는 항상 `agreementId`를 가진다). 결과 확인 전 `concern.close(completed)` 명령을 내지 않는다(속성 테스트). `goal_revise`는 항상 사람 접점이 된다 |
| C-9 | modes/router | §3.10.3 표의 각 행 사례. 사용자 지정 모드는 상황 유형이 바뀌어도 유지된다. investigate 모드에서 C.commit으로 가면 execute로 바뀌고 Choice가 기록된다 |
| C-10 | dials/resolve | 층 우선순위: 층 5 최상위 값이 층 1의 perLoop 값보다 우선한다. 같은 층에서는 perLoop가 최상위보다 우선한다. A 계열의 유효 `defaultDelivery` 기본은 `negotiated`다([판정 J-143]). `kindExceptions` never_ask를 권리 게이트 종류에 걸면 `ORCH_DIAL_INVALID`. 범위 밖 값 거부. 자동 상향 heavy가 층 4 light보다 우선하고, 층 5 light가 있으면 사람 값을 따르되 "요구보다 낮음" 표시가 남는다. provenance가 값마다 맞는 층을 가리킨다 |
| C-11 | entry | 01 §6의 진입 판정 완료 기준(근거 있는 참 신호 2개 → enter, 근거 없는 신호 무시, EC-3 참이면 제외 규칙 무시, 직접 지정은 enter, 결정성)을 같은 코드로 통과. 승격 제안은 신호 하나로 1건 기록되고 거절 뒤 같은 가벼운 작업에서 다시 기록되지 않는다. 사람이 직접 연 Concern은 가벼운 작업으로 강등되지 않는다 |
| C-12 | macro/priority, admit | 우선순위 튜플 사례(고정 > 혼돈 > …). 동시 실행 상한을 넘겨 허가하지 않는다(속성 테스트). 활성 Concern 상한. away + 비용 상한 초과 시 새 WorkUnit을 허가하지 않는다 |
| C-13 | macro/attention | 권리 게이트는 예산 초과에도 전달 권고가 나온다. 예산 초과 시 막히지 않는 정보 게이트는 미루기 권고. 시간당 즉시 상한. 묶음 할인 계산 |
| C-14 | macro/ca-cap | UC-07 정상 경로 대본에서 정상 경로 결정 조작이 2건 이하, R-OP-2 대본에서 1건(01 §3.5.2 수용 조건). 셋째 정상 경로 접점(막히지 않는 정보 게이트)은 결과 확인 질문에 묶인다. 범위 초과·권리 게이트는 정상 경로 밖 사유로 분류된다 |
| C-15 | macro/boundaries | 라운드 끝, WorkUnit 끝, 루프 전환, 대기 진입, 복귀, 검토 창, 하루 교체에서 `boundary.reached`가 정확히 한 번 나온다. 제출자는 14뿐이다(12·15 가짜 실행기가 경계를 내면 테스트 실패) |
| C-16 | concern/decide 재생 | §3.16.6 흐름을 가짜 모델로 재생해 이벤트 로그가 스냅숏과 같다. 같은 대본을 두 번 돌리면 같은 로그(결정성) |
| C-17 | concern/decide 재생 | §3.19.1(UC-01)과 §3.19.2(UC-18 혼돈) 흐름 재생. UC-01에서 C/A 주기당 사람 조작이 2를 넘지 않는다 |
| C-18 | concern/decide 속성 | 무작위 이벤트 순서(가짜 모델 제안 무작위, 사람 답 무작위)에서: Concern당 현재 루프는 하나다. 닫힌 Concern은 다시 열기 계기 없이 루프 WorkUnit을 요청하지 않는다(루프 밖 `prediction_check`·`reflect`만 허용). 모든 자동 전환에 `whyNotAsked`가 있다. 결과 확인 없이 completed로 닫히지 않는다 |
| C-19 | concern/contests | §3.12.4 표의 각 행: 이의 이벤트를 주면 기대 처리 행동이 나온다 |
| C-20 | loop(복구) | 이벤트 처리 중간(명령 실행 뒤, 체크포인트 저장 전)에 프로세스를 죽이고 다시 시작하면 중복 명령이 생기지 않는다. 체크포인트를 지우고 다시 시작해도 최종 로그가 같다. write가 있던 interrupted WorkUnit은 다시 요청되지 않고 질문이 생긴다 |
| C-21 | 클라이언트 없음 | 접속 상태 away로 §3.17 표의 각 행을 재생: 권리 게이트는 assumed가 되지 않는다, 원함 탐구는 autonomy 라운드 뒤 멈춘다, 비상 합의가 없으면 쓰기가 없다, 복귀 시 복귀 요약 요청이 한 번 나온다 |
| C-22 | features | MVP 묶음에서 complex 계획이 `O → I.want → C.commit → A.confirm`이다. I.possibility를 끄면 계획에 없고 `skipped`에 이유가 있다. A.confirm을 끄면 `ORCH_SETTINGS_INVALID`. disorder 판정은 S가 꺼져 있으면 질문과 대안 유형 계획이 된다 |
| C-23 | 도구 안정성 | 한 WorkUnit이 실행되는 동안 모드·다이얼이 바뀌어도 그 WorkUnit의 유효 원시 행동·제안 종류는 바뀌지 않는다(D5) |
| C-24 | concern/view | 같은 이벤트 열을 처음부터 접은 뷰와 중간 스냅숏부터 접은 뷰가 같다. 이벤트 순서를 바꾸지 않는 한 `reduceView`는 결정적이다. §3.12.2 상태 계산이 표의 조건과 맞다 |
| C-25 | concern/decide 결정성 | 같은 트리거 이벤트를 벽시계를 바꿔 두 번 처리해도 같은 명령 payload(파생 id 포함)가 나온다. 크래시 뒤 재처리에서 커널이 `replayed`를 돌려주고 3006(같은 키 다른 내용)이 나오지 않는다 |
| C-26 | concern/decide 재생 | `run.ended(failed, model_unreachable)` 뒤 질문이 생기지 않고 `waiting(model)`이 된다. 모델 가용 신호 뒤 같은 WorkUnit의 새 run이 한 번 요청된다(22 FI-23) |
| C-27 | concern/decide 재생 | §3.12.3의 `RunEndReason` 아홉 값 각각과 `StageResult`(15 §3.1.1) 셋에 기대 행동이 있다. 질문 종결 다섯 가지와 호출 종결 세 가지 각각에서, 대기 run이 있으면 14가 run을 요청하지 않고 없으면 한 번 요청한다 |
| C-28 | macro/admit | `daemon.safe_mode_entered{reason: restored}` 뒤에는 새 WorkRequest를 허가하지 않는다. `workunit.paused(objection)`인 WorkUnit은 요청되지 않는다. 미룬(`defer`) 요청은 같은 `admit`에서 시작되지 않는다 |
| C-29 | macro/presence | `isAway`: 휴대폰 active 보고가 2분, 데스크톱 5분 끊기면 idle로 보고, 모든 기기가 30분 idle·hidden이거나 offline이면 부재. 방해 금지(`attention.snoozeUntil`)는 부재. `locked` 값은 타입에 없다 |

---

## 7. 미결 사항

| id | 질문 | 선택지 | 추천 기본값 |
|---|---|---|---|
| U-01 | 의존 규칙 5(Goal 변경은 사람 확인)를 작은 정제에도 적용하나(v0.3 03 §5 끝) | (a) 항상 확인 (b) 작은 정제는 혼자 정한 결정으로 기록하고 이의 가능 | (a). 대신 같은 Goal의 수정 제안을 하루 단위로 묶는다(§3.9.4). 2주 사용 후 Goal 수정 질문 수를 보고 다시 본다 |
| U-02 | 가벼운 작업을 어디에 연결하나(01 OQ-05) | (a) 자리표시 Goal에 연결, Concern 없음 (b) 프로젝트별 "가벼운 작업" 보관 Concern 아래 WorkUnit | 해결: 판정 J-01, 08 `lightWorkConcernId` |
| U-03 | 루프 계획을 누가 정하나(v0.3 10 §4.2-6) | (a) 작업 에이전트가 계획을 씀 (b) 라우터가 정함 (c) 모델은 표시를 선언하고 코드가 계산 (d) (c)에 더해 표시 밖 상황에서 모델 초안 | (d) 혼합(결정 53, [판정 J-188], §3.8.5). 2주 뒤 16의 `authoredBy`별 이의 비율로 다시 본다 |
| U-04 | Quick/Guided/Assured 이름을 화면에 남기나(v0.3 10 §4.1-4) | (a) 이름 유지 (b) 증명 부담 값 이름("가볍게/보통/엄격") (c) 없앰 | 해결: 판정 J-12 |
| U-05 | 주의 예산 수치(하루 20, 시간당 즉시 2, 접점별 비용) | 수치 조정 | 시작값으로 쓰고 2주 뒤 16의 지표(전달 수, 이의 비율, 답이 가정과 같았던 비율)로 조정 |
| U-06 | S 상한(하위 7, 깊이 3) | 3~7 사이 | 해결: 08과 같은 7·3 |
| U-07 | 동시 실행 수(데몬 2, Concern당 3, 활성 Concern 3) | 서버 자원·API 한도에 따라 | 2 / 3 / 3. 17·12의 실제 측정 후 조정 |
| U-08 | 라우팅에 과거 기록을 쓸지(v0.3 07 §5.2) | (a) 규칙표만 (b) 같은 종류 Concern의 과거 모드를 동점 해소에 사용 (c) 학습형 | (a). 라우팅 이의 비율이 높으면 (b) |
| U-09 | 상황 유형을 값 하나로 둘지 분포로 둘지(v0.3 10 §4.1-3) | (a) 값 하나 + 확신 + 대안 (b) 유형별 확신 분포 | (a) |
| U-10 | 확신을 숫자로 둘지(canon-3 C4) | (a) 질적 등급(low/medium/high) (b) 0~1 숫자 | (a). 화면에 숫자 확률을 보이지 않는다 |
| U-11 | 질문 조건 AND/OR 선택 옵션(결정 16) | 사용 후 결정 | 옵션 없음(AND). 결정 16대로 사용 후 판단 |
| U-12 | 접속 상태 시간(active 보고 유효 데스크톱 5분·휴대폰 2분, 부재 30분) | 수치 | 5분·2분 / 30분([판정 J-119]) |
| U-13 | 진입 판정에서 "해 보는 비용이 작음"을 넘는 신호 수 | 문턱 + 0 / + 1 / 제외 조건 절대 | 해결: 01 §3.6.3 규칙(EC-3 예외, 그 밖은 제외 조건 우선)을 따른다 |
| U-14 | 돌아보기의 종료 조건(원전 법칙 12와의 관계) | (a) 변경 제안 필수 (b) 변경 제안 또는 "변경 없음 + 이유" | (b). 채택률을 16이 본다 |
| U-15 | 결정에 쓰이는 판단의 사람 확인(`finding_confirm`)이 권리 게이트인가 | (a) 정보 게이트, 합의 확인에 묶음 (b) 권리 게이트 | (a). 11이 확정 |
| U-16 | 반영 항목을 커널이 정책으로 닫을 수 있나(integrate 능력) | (a) 근거 있는 종결은 커널이 닫음, 미루기는 사람 (b) 모두 사람 | 해결: 08 Obligation 규칙 6, 10 ADR-K7 |
| U-17 | "항상 Concern으로 열기" 같은 사용자 선호 설정을 둘지 | 둘지 말지 | 두지 않는다. 직접 지정(경로 3)으로 충분하다 |
| U-18 | MVP 루프 묶음 | 01 §3.8 표 그대로 / 줄임 | 01 §3.8 표 그대로(§3.15). 23이 마일스톤과 맞춤 |
| U-19 | 계획 이탈마다 새 계획 버전을 만드는 기록량 | (a) 매번 새 버전 (b) 이탈은 전환 레코드의 `planDeviation`만, 계획은 O에서만 고침 | (a). 화면에서는 최신 버전과 차이만 보인다 |
| U-20 | 비상 합의를 누가 언제 만드나 | (a) 사람이 설정 화면에서 미리 (b) 첫 혼돈 상황 뒤 A.reflect가 제안하고 사람이 채택 | (a)와 (b) 둘 다. 화면은 04 |
| U-21 | 절차(procedure) 레코드와 신뢰 관리의 소유 | 08 / 16 / 14 | 해결: 레코드 08 §3.19.3, 신뢰 변경 16, 적용 14 |
| U-22 | away 동안 비용 상한 기본값 | null / 금액 | null(12의 전역 예산만). 사용자가 정한다 |
| U-23 | 지속 관찰 연장 횟수 | 1~3 | 2 |
| U-24 | 오케스트레이터의 규칙 기반 제출 채널(§3.20.2) | (a) 10이 R 채널을 연다 (b) 결정적 코드를 agent 역할(`agent:router` 등)로 감싸 M 채널로 보낸다 | 해결: 10이 R 채널과 `declaredBy`를 열었다(10 §3.3.2, K-13) |
| U-25 | 08과 10의 이름이 서로 다른 것(질문 종류 `agreement_confirm`/`commitment_acceptance`, 계획 이벤트 `loop_plan.adopted`/`loop_plan.set`, 진입 신호, `whyNotAsked` 변형) | 08 기준 / 10 기준 | 해결: 판정 §1(이벤트 09, 명령 10, 레코드·질문 종류 08) |
| U-26 | 결과 확인 거절 뒤 도착 루프 기본값 | (a) 직전 I(v0.3 03 §6) (b) C.commit(10의 파생 재개) | 해결: 판정 J-04는 `reopenTo`, 기본은 직전 I. 판정 J-24: 직전 I가 없는 Concern(I를 건너뜀)이면 결과 확인 질문에서 사람이 C(`C.commit`) 또는 I(`I.fact`, complex면 `I.want`)를 고른다. 기본값으로 정하지 않는다 |
| U-27 | 탐침이 아닌 결과의 지속 관찰 레코드 | (a) 08에 Watch 레코드 추가 (b) Prediction 여러 개와 확인 타이머로 대신 | 해결: 08 §3.16.2 Watch |
| U-28 | 모델의 루프 전환·분해 선언을 어떻게 받나(C14-3) | (a) 선언 도구가 run을 `handed_off`로 끝내며 선언을 싣는다 (b) 08에 "전환 요청" 레코드를 두고 M 채널로 기록 (c) 모델이 `loop.transition`을 바로 내고 오케스트레이터가 사후에 고침 | 해결: [판정 J-65] (a)(§3.5.6). 09·10에 `handoff` 필드가 남은 요구다 |

---

## 8. 출처

### 8.1 자료

| 자료 | 쓴 곳 |
|---|---|
| `docs/design/process/00-design-brief.md` 결정 1~64, §2.5, §3, §5, §6 | 전체 |
| `docs/v0.3/03-loops-and-transitions.md` §1~§9 | §3.6, §3.8, §3.9, §3.19 |
| `docs/v0.3/05-situation-types.md` §2~§6 | §3.7 |
| `docs/v0.3/06-asking-and-interruption.md` §3, §5, §7 | §3.11.1, §3.13, §3.17 |
| `docs/v0.3/07-modes-and-capabilities.md` §1~§7 | §3.10, §3.11 |
| `docs/v0.3/09-client-opdc.md` §4, §5 | §3.5.5, §3.11.5 |
| `docs/v0.3/01-scope-and-motivation.md` §3, §4 | §3.14 |
| `docs/v0.3/02-core-concepts.md` §2~§9 | §3.6, §3.8 |
| `docs/v0.3/08-runtime-architecture.md` §2~§10 | §3.1, §3.6, §3.16 |
| `docs/v0.3/10-critique-and-open-questions.md` §2~§4 | §4.2, §7 |
| `docs/v0.3/14-alternative-structure.md` | 참고(브리프 결정으로 대체된 배치. 오케스트레이션 설계에 직접 쓴 내용 없음) |
| `docs/v0.3/audit/audit-report.md` §2, §3.4~§3.7, §4, §5.4 | §2.2, §3.2, §3.9.5, §3.14, 부록 A |
| `sources/helm-canon.md` §6, §10.3, §12.9~§12.10, §15, §16, §20.3, §21 | §3.1, §3.3, §3.10.5, §3.11.7, §3.13, §3.15 |
| `sources/helm-canon-2.md` §3.6~§3.9, §7.2, §10, §11 | §3.3.3, §3.9.1, §3.11.7, §3.13.7 |
| `sources/helm-canon-3.md` §3.3, §5.1, §6.13, §7, §8 | §3.6(방법), §3.13, §3.15 |
| `sources/conversation-extracts-3.md` 전체(특히 X3-2, X3-3, X3-6, X3-7, X3-8) | 전체 |
| `sources/conversation-extracts-4.md` 전체(특히 2장, 4~11장) | §3.6~§3.11 |
| `sources/conversation-extracts-2.md` §6, §7 | §3.1, §3.11.7 |
| `sources/conversation-extracts-1.md` 목록 Q13 | §3.12.5 |
| `sources/pi-api-facts-1.md` agent-core 훅(`prepareRequest`, `finishTurn`, `getFollowUpMessages`) | §3.11.5, §3.16.3의 12 요구(턴 경계 정지). pi API의 직접 사용은 12·13 소유 |
| 대화 원문 L2155–2168(사람 조작 2회 상한, 2주 지표), L2740–2766(모드 계약, 거시 스케줄러) | §3.13.7, §3.5 [원문 확인] |
| 같은 시기에 작성 중인 설계 문서(2026-10-11 23시 무렵의 판): `01-product-brief.md` §3.5.2, §3.6, §3.8, OQ-04·05·12 / `06-system-architecture.md` §3.2, §3.4.6, §3.4.10, §3.10 / `08-domain-model.md` §3.4~§3.22 / `10-kernel.md` §3.1~§3.14, §5.2 / `12-runtime-engine.md` §1.2, §3.2~§3.11, §3.16 / `15-inquiry-engine.md` §3.1 / `16-observer-and-metrics.md` §3.16, §3.22, §5.2 | §3.14, §3.15, §3.13.7, §3.16.5, §3.20. 이 문서들은 아직 바뀌는 중이므로 2단계 통합 때 다시 대조한다 |

외부 지식의 확인 수준: Cynefin(Snowden & Boone 2007) [지식], McFarlane(2002) 네 전달 방식 [원문: v0.3 06 §2.4 기록], Parasuraman·Sheridan·Wickens(2000) [지식: v0.3 06 §2.3 기록], ICS 관리 가능 범위 3~7 [지식], 프롬프트 캐시와 도구 목록 변경의 관계 [감사 §4 기록, 재확인 안 함].

### 8.2 부록 A: 원천 체크리스트 반영표

과업 지시 2)에 따라 각 원천의 "설계에 바로 쓸 체크리스트"와 끝 목록에서 14에 해당하는 항목의 반영 위치를 적는다.

**helm-canon.md §21 (14)**

| 항목 | 반영 |
|---|---|
| 10단계 사이클과 단계별 입력·출력·조건(§6.1~§6.2) | §3.3.1~§3.3.2. 단계별 입력·출력은 루프 계약의 입력·출력 행(§3.6)으로 옮겼다. 원전의 Decision 상태 전이(Framed, AlternativesIdentified 등)는 08의 레코드 상태 기계 소유라 여기서 다루지 않는다 |
| episode(§6.3), 리듬 4판(§6.5) | §3.3.3. F04 §6과 F06 §9의 리듬은 F09 §10과 같은 순서라 F09 열로 대표했다 |
| 네 루프 목표·흐름·primitive·핵심 질문(§15.3) | 목표·핵심 질문은 §3.6. 원전 primitive(CommonOperatingPicture 등)의 레코드 대응은 08 소유. 화면 대응은 03 |
| 결합 그림과 재진입 6(§15.4, §6.6) | §3.9.2 T01~T05(+T06은 A.reflect 출력) |
| 브리프 다섯 루프와의 대응(§20.3 #6) | §2.3, §3.5.1 |
| 모드 5(F06 §9)와 브리프 모드 정의의 차이(§12.9, §20.3 #7) | §3.10.5 |
| 성숙도 L0~L5(§15.11) | §3.15 |
| 주의력 예산(§12.10) | §3.13.2~§3.13.5. `maximum_active_gates: 3`은 표시 개수로 옮김 |
| OPD+C(§10.3) | §3.1, §3.5.5 |
| Q/G/A와 모드·다이얼의 관계(§16.6) | §3.11.7 |
| OICA = 흐름, NEMAP = 상태, OPD+C = 평가 | §3.1 |

**helm-canon-2.md §11 (14)**

| 항목 | 반영 |
|---|---|
| Q/G/A 정의·전환·silent downgrade 금지를 모드·다이얼로 재정의 | §3.11.7 |
| Guided 리듬과 루프 대응 | §3.3.3 |
| durable-spike 스파이크 2의 Concern 상태 기계(phase, waiting, 지속 타이머, 전환 기록 같은 commit) | §3.9.1(같은 커밋), §3.12(대기 상태), §3.16(폴링 대신 이벤트 구동), 타이머는 12 |
| C/A 우선과 사람 조작 2회 상한 근거(사용자 진술, CLI-G01 Gate 2개) | §3.13.7 |
| 의존 규칙과 실행 후보 대응(Completion은 active Agreement 필요, Integration은 accepted 뒤, 판단 승격에는 근거) | §3.9.4, §3.6.8. 집행 세부는 10 |

**helm-canon-3.md §8 (14)**

| 항목 | 반영 |
|---|---|
| 루프 근거 표에 방법 대응 | §3.6 각 계약의 "방법" 행 |
| Concern 트리 = Workstream 묶음, run을 평면 목록으로 보고하지 않음, 활성 Concern 수 상한은 다이얼(고정값 금지) | 활성 Concern 수 상한은 고정값이 아닌 설정 `maxActiveConcerns`(§3.13.2). 다이얼로 두지 않은 이유는 D8. run 평면 목록 금지는 화면 규칙이라 03·04에 맡긴다 |
| 루프 전환 경계를 phase boundary로, 비가역 경계 판정은 권한 레이어 결과 | 작업 경계 `loop_transition`(§3.13.6), 권한 레이어 판정 입력(§3.9.4, §3.11.7) |
| 돌아보기는 Context·합의·정책 중 하나를 실제로 바꾸는 제안을 내야 끝남. 성공한 적응도 기록 | §3.6.10. "변경 없음 + 이유"를 허용하도록 바꿨다(U-14) |
| 깊이 다이얼 입력 후보(stakes, coupling, uncertainty, testability, value sensitivity, recoverability) | §3.11.7 자동 상향 입력 |
| 주의 예산: Gate queue와 활성 Concern 수를 사람의 주의 용량에, false negative·positive 함께 측정 | §3.13.4~§3.13.5 |
| 작업 합의 시 의도 재진술(check-back)과 모순 제기 경로 | §3.6.6, OPD+C `opdc:c.scope_challenge` |
| 성숙도 L1~L5와 UX Slice A~E(L5 팀 단계 범위 밖) | §3.15 |

**conversation-extracts-3.md 목록 (14 관련)**

| 항목 | 반영 |
|---|---|
| X3-7-20 다섯 모드의 진입·종료·활성 도구·생성 레코드·OPD+C 명세 | §3.6(루프 계약), §3.10(모드) |
| X3-8-30 런타임 명세(모드 계약, 재진입 규칙표) | §3.6, §3.9 |
| Q1 C/A 상태 기계의 빠진 전이 | 오케스트레이션 측은 §3.6.6 답 처리 표. 레코드 상태 기계는 08·10 |
| Q3 사람 조작 2회 상한을 수치·규칙으로 | 01 R-OP-1~R-OP-6의 고정 규칙(설정 아님)을 오케스트레이션 측에서 지킴, §3.13.7 |
| Q4 2주 지표의 수집 위치 | 오케스트레이터가 이벤트를 남기고 16이 집계(§3.13.7) |
| Q10 진입 신호 형식, 문턱을 다이얼로 둘지 | §3.14.3. 문턱은 설정 |
| Q11 취향 작업의 범주 위치 | 진입 조건 `taste_dependent`(§3.14.3) |
| Q12 대화의 모드 정의와 결정 3의 대응 | §3.10.5 |
| Q15 계층 상태 기계 vs 조합. S의 위치 | D1(현재 루프 하나), §3.2(10단계는 WorkUnit 목적), §3.6.11(S는 구조 루프) |
| Q16 주의 예산 단위와 배분 알고리즘, 선택 요청 병합 | §3.13.3~§3.13.5 |
| Q18 성숙도 0~5 vs 1~5 | §3.15(원전은 0~5, L0 범위 밖) |
| Q21 사람이 없을 때의 감시 실행 주체 | 데몬의 스케줄러와 12의 타이머(§3.13.1, §3.17) |

**conversation-extracts-4.md 목록 (14 관련)**

| 항목 | 반영 |
|---|---|
| a3 탐구 다이얼(폭·깊이·근거 범위·자율·예산) | §3.11.1 |
| b3 묶음 표의 질문 빈도·탐구 폭 값 | §3.10.2 다이얼 열 |
| b4 라우터 결정의 기록·이의 | §3.9.6, §3.10.3 |
| b9 I를 건너뛰는 경로의 기록 | LoopPlanCore `planDetail.skipped`(§3.8.1) |
| d4 AND/OR 옵션, 문턱 수치 | §3.11.1, U-11 |
| d7 작업 경계 목록 | §3.13.6 |
| d9 integrate의 소유자, send·ask가 들어가는 모드 | §3.10.2 메모, §5.2 10 요구, U-16 |
| d10 Q/G/A를 남길지 | §3.11.7, U-04 |
| d11 기능별 질문 다이얼 | `perLoop`로 표현(§3.11.1) |
| d12 I 건너뛴 기록 형식 | `planDetail.skipped`(§3.8.1) |
| d13 탐침 키울·접을 조건 스키마, 지속 관찰 종료 조건 | §3.6.7 `ProbeSpec`, `WatchSpec`, §3.6.9 |
| d14 비상 합의 형식과 범위 | §3.6.7 `StandingAgreementTemplate` |
| d15 재판정 트리거와 재진입 규칙 | §3.7.5, §3.9.5 G3 |
| d16 S 상한 수치, 경계 항목 스키마, 동작 정의 | §3.6.11 |
| d17 의존 규칙 4·5의 문구와 집행 지점 | §3.9.4 |

**그 밖**

| 항목 | 반영 |
|---|---|
| conversation-extracts-1 Q13: 하위 실행 fresh/fork, 동기·백그라운드 기본값, 소유 트리 | §3.12.5 |
| conversation-extracts-2 d-4: 언제 발산하고 언제 바로 실행하나 | 계획 플래그와 기본 조합(§3.8.2). 발산 내부는 15 |
| conversation-extracts-2 d-7: Gate 빈도 초기값 | 질문 다이얼 기본값(§3.11.1), 주의 예산(§3.13.5) |
| 감사 §3.6 "흐름 표기 네 가지 중 기준" | §3.2(10단계가 기준), §3.3.3 |
| 감사 §3.6 "모드가 붙는 단위" | §3.10.1 |
| 감사 §3.7 "묶음별 개발 예시(CI 간헐 실패 등)" | 반영하지 않음. 제품 범위 예시는 01 소유(v0.3 01 §3.5에 목록이 있다) |
| 감사 §3.5 "모드 정의에서 우선 보장할 OPD+C 기준이 빠진 이유, 09 §5 Predictability에 현재 모드 표시" | `opdcFocus`(§3.10.1), 공통 의무 `opdc:o.current_loop_mode_dials`(§3.5.5) |
| 감사 §3.5 "그 단계에서 쓰면 안 되는 도구는 아예 주지 않는다" | D5, §3.10.4 |
| 감사 §3.5 "명세를 데이터로 두는 다섯 대상" | 모드 계약·재진입 규칙표는 이 문서(§3.6, §3.9), 스키마는 08, 능력 행렬·정책은 10 |
