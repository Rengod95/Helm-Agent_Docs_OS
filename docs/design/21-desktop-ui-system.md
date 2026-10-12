# 21. 데스크톱 UI 시스템

- 작성: 2026-10-11, P14 UI
- 상태: 1단계 초안. 작성 중에 나온 03(화면 ID, 셸 영역, 상태 라벨), 04(뷰 모델, 화면 규칙), 19(명령 메서드, 뷰 메타), 20(앱 구조, 연결·명령 상태)의 2026-10-11 판에 맞췄다. 05(문구·키보드)는 이 시점에 없어 문구 키와 키 배정은 자리 표시다.
- 소유: 디자인 토큰, 타이포·레이아웃 규칙, 컴포넌트 목록과 계약(props, 상태, 키보드, 접근성), 시각화 컴포넌트, 화면 → 컴포넌트 매핑, UI 라이브러리 선택, 컴포넌트 단위 시각 테스트.
- 소유하지 않음: 화면 ID·이름과 정보 구조·상태 라벨(03), 화면별 레이아웃·뷰 모델 타입(04), 문구·키 배정(05), 프로토콜 메서드(19), 앱 구조·상태 동기화·라우팅·알림·트레이(20), 도메인 레코드 정의(08), 질문 레코드(11), 루프·다이얼·주의 예산(14), 자극·반응·선호 모델의 생성 규칙(15).

## 1. 목적과 범위

### 1.1 목적

Helm 데스크톱 앱(브리프 결정 19·32)의 렌더러 계층을 구현자가 이 문서만 보고 만들 수 있게 한다. 이 계층은 데몬이 보낸 투영(projection)을 화면에 그리고, 사람의 조작을 "의도(intent)"로 만들어 앱 상태 계층(20)에 넘긴다. Helm 로직은 두지 않는다(결정 32).

Helm 클라이언트는 대화 중심 UI와 다른 상태 중심 UI다(결정 10). 이 문서는 그 차이를 컴포넌트 계약으로 옮긴다. 기준은 다음 셋이다.

1. 사람이 며칠 만에 돌아와도 상태를 복원하고(Observability, Predictability), 필요한 곳만 고치고(Directability), 이의를 걸 수 있어야 한다(Contestability). (v0.3 09 §1, §5)
2. 모델이 초안을 만들고 사람은 반응·수정한다(결정 18). 빈 양식을 먼저 내밀지 않는다.
3. 대안 2~3개를 던지고 고르게 하는 상호작용을 만들지 않는다(결정 18). 이 규칙을 컴포넌트 API 수준에서 막는다(§3.9).

### 1.2 다루는 것

| 절 | 내용 |
|---|---|
| §2.4 | 사용자의 Axiom 디자인 시스템 저장소 검토와 사용 범위 판단 |
| §2.5 | UI 라이브러리 선택(헤드리스 컴포넌트, 스타일 방식, 아이콘, 그래프·차트, 가상화, 글꼴)과 근거 |
| §3.1 | UI 원칙 |
| §3.2 | 디자인 토큰(색, 간격, 타이포, 반경, 그림자, 모션, 크기, 밀도), 다크·라이트, 한국어 타이포 |
| §3.3 | 레이아웃 그리드와 앱 셸 |
| §3.4 | 아이콘 |
| §3.5 | Helm 시각 문법(N/E/M, 레코드 종류, 품질 상태, 작성자, 신선도, 세 깊이) |
| §3.6 | 컴포넌트 공통 계약(props 규칙, 상태 집합, 의도, 키보드, 접근성, 선형 텍스트) |
| §3.7 | 컴포넌트 목록과 각 계약 |
| §3.8 | 시각화(근거 체인, 루프 타임라인, 자극 보드, Goal 이력, 상태 지표, 발산 표·가능성 비교·예측) |
| §3.9 | 대안 고르기 UI를 만들지 않는 컴포넌트 규칙 |
| §3.10 | assistant-ui 활용 범위 |
| §3.11 | 화면 → 컴포넌트 매핑 |
| §3.12 | 키보드 규칙과 키 배정 초안 |
| §6 | 파일·폴더 구조, 스토리북, 시각 테스트, 완료 기준 |

### 1.3 다루지 않는 것

- 앱 프로세스 구조, Tauri 설정, 클라이언트 저장소, 재접속, 라우팅, 알림 채널, 트레이, 키체인: 20.
- 화면 목록의 ID와 이름, 셸 영역, 내비게이션 구조, 상태 라벨: 03. 이 문서는 03 §3.6의 화면 ID를 쓴다.
- 화면별 레이아웃 상세와 모든 문구의 최종 문장: 04·05. 이 문서에 나오는 한국어 문구는 컴포넌트 계약을 설명하기 위한 자리 표시이며, 문구 키(§3.6.7)로 05의 정본 문구에 연결한다.
- TUI(결정 33·39). 다만 모든 복합 컴포넌트가 선형 텍스트 표현을 갖게 해(§3.6.6) TUI와 같은 정보를 보이는지 비교할 수 있게 한다.
- 도메인 판정(가역성, 위험, 승격, 질문 전달 시점). 화면은 판정 결과를 보여 주기만 한다(결정 2·14).

### 1.4 표시 규칙

브리프 §5.2를 따른다. `[결정 n]`은 브리프 §2의 결정 번호, `[제안]`은 이 문서가 정한 것, `[가정]`은 확인되지 않은 전제다. 외부 사실은 `[원문]`(파일·문서 직접 확인), `[실험]`(이 작업 중 코드 실행으로 확인), `[검색]`(웹 확인), `[지식]`(재확인 안 함)을 붙인다.

## 2. 전제와 결정

### 2.1 브리프 결정에서 오는 제약

| 브리프 결정 | UI 시스템에 주는 제약 |
|---|---|
| 1, 18 | 원함 탐구는 자극 → 반응(요소 단위, 이유 없는 반응 포함) → 기록. 하나 고르기만으로 끝나는 UI 금지. 모델 초안 + 사람 반응·수정이 기본 상호작용 |
| 2 | 가역성·위험 값을 화면에서 계산하지 않는다. 표시할 때는 출처(권한 레이어)를 함께 적는다 |
| 8, 17(불변조건 7) | "에이전트가 정한 것"을 모아 보이고, 항목마다 이의 걸기를 둔다 |
| 10 | 홈에는 대화 대신 상태(Goal, Concern, 질문, 진행 작업)를 둔다. 대화는 객체에 딸린 보조 수단 |
| 11 | Goal 이력 시각화가 필요하다. Goal 변경은 사람이 확인한다 |
| 12 | 질문 카드는 게이트(권리·정보), 전달 방식, 임시 가정, 가정 만료점을 보여 준다 |
| 14, 32 | 화면은 상태를 직접 바꾸지 않는다. 조작은 의도로 올라가고, 받아들여진 결과만 스트림으로 돌아온다. 낙관적 도메인 갱신 금지(§3.6.4) |
| 17(불변조건 1~7) | 관찰·추측·판단·선택 구분, 완료 주장·결과 확인·전체 반영 구분, 모름·이견·낡음을 숨기지 않음을 시각 문법으로 강제(§3.5) |
| 19, 32 | Tauri v2 + React 18 + TypeScript + Vite. React 19 전용 API를 쓰지 않는다 |
| 21, 22, 38 | 원격 접속(Tailscale WSS 또는 SSH)과 끊김이 일상이다. 연결 상태와 투영 신선도를 항상 보인다 |
| 24 | macOS와 Windows. 두 웹뷰(WKWebView, WebView2)에서 같게 보여야 한다 |
| 25 | 문서와 화면에서 제품 사용 사례는 "유즈케이스" |
| 31 | 이벤트에 단조 증가 seq가 있다. 화면은 "어느 seq 기준으로 본 것인지"를 표시할 수 있다 |
| 37 | UI 문구는 한국어. 한국어 타이포 규칙이 기본값 |

### 2.2 이 문서의 주요 선택 요약

각 항목의 근거는 표의 "절"에 있다.

| ID | 선택 | 표시 | 절 |
|---|---|---|---|
| UI-D01 | 컴포넌트는 표현 전용이다. 입력은 뷰 모델(VM), 출력은 `UiIntent`. 도메인 판정과 프로토콜 호출을 하지 않는다 | [제안], 결정 14·32에서 도출 | §3.6 |
| UI-D02 | 사람의 결정 의도에는 화면이 본 투영의 seq(`basisSeq`)를 붙인다. 낡은 카드에서 내린 결정은 데몬이 거부할 수 있다 | [제안] | §3.6.3 |
| UI-D03 | 낙관적 도메인 갱신을 하지 않는다. 버튼은 "보내는 중"만 표시하고 결과는 스트림으로 받는다 | [제안] | §3.6.4 |
| UI-D04 | 색만으로 의미를 나타내지 않는다. N/E/M, 레코드 종류, 품질 상태는 라벨 + 아이콘 + 모양(테두리)으로 나타낸다 | [제안], 원천 §6.9 | §3.5 |
| UI-D05 | confidence 숫자를 화면에 내지 않는다. 직접성, 남은 반대 근거, 확인하지 못한 범위, 다음 확인으로 표현한다 | [제안] | §3.5.6 |
| UI-D06 | 세 깊이(한눈에 / 검토 / 감사)를 모든 복합 컴포넌트의 공통 prop으로 둔다 | [제안] | §3.5.7 |
| UI-D07 | 원함 탐구 컴포넌트에는 "선택지" prop이 없다. 질문 카드의 대안 표시는 순서만 바꾸고 개수를 줄이지 않는다 | [제안], 결정 18 | §3.9 |
| UI-D08 | 모든 복합 컴포넌트는 선형 텍스트 표현(`toLinearText`)을 갖는다. 스크린 리더 요약, 복사, 골든 테스트, TUI 대조에 쓴다 | [제안] | §3.6.6 |
| UI-D09 | 스타일은 Tailwind CSS v4 + CSS 변수 토큰, 헤드리스는 Radix Primitives, 아이콘은 lucide-react | [제안] | §2.5 |
| UI-D10 | 그래프·차트 라이브러리는 1차에 넣지 않는다. 근거 체인은 트리, 루프 타임라인은 목록, 상태 지표는 SVG로 직접 그린다 | [제안] | §2.5, §3.8 |
| UI-D11 | assistant-ui는 객체별 대화 스레드에만 쓴다. Interactables, 생성형 UI, AssistantTransport, Assistant Cloud, 도구 승인 콜백은 쓰지 않는다 | [제안] | §3.10 |
| UI-D12 | 글꼴은 Caustic의 글꼴 순서(Geist → SUIT → Pretendard)를 따르고, Geist·Geist Mono·SUIT 파일을 앱에 넣어 배포한다. 원격 글꼴을 쓰지 않는다. 한글이 들어가는 글자는 12px 미만으로 내리지 않는다 | [제안] | §3.2.3 |
| UI-D13 | 사용자의 Axiom 저장소에 들어 있는 Caustic 디자인 시스템 중 **토큰 층만** 고정 사본으로 가져와 원시·의미 토큰으로 쓰고, 그 위에 Helm 의미 토큰(`--helm-*`)을 얹는다. Caustic React 부품(React 19 전용)과 Axiom Foundation 문서는 쓰지 않는다 | [제안] | §2.4 |
| UI-D14 | 컴포넌트 카탈로그와 시각 테스트는 Storybook + Playwright 스크린샷(Chromium, WebKit 두 엔진)으로 한다 | [제안] | §6.3 |
| UI-D15 | 한국어 IME 조합 중 Enter는 제출하지 않는다(`isComposing` 또는 keyCode 229 검사). 모든 텍스트 입력 컴포넌트의 완료 기준 | [제안] | §3.6.5 |

### 2.3 원천 체크리스트 대응

0단계 원천 정리의 "설계에 바로 쓸 체크리스트" 중 문서 21 항목과, 끝 목록에서 21에 걸리는 항목을 모두 적는다. "반영하지 않음"에는 이유를 적는다.

| 출처 | 항목 | 처리 | 위치 |
|---|---|---|---|
| helm-canon §21 | 권장 컴포넌트 이름(`GoalSummary`, `FocusRoom`, `PossibilityComparison`, `EvidenceView`, `ChoiceRecord`, `ActiveWorkCard`, `SinceLastVisit`, `ReviewGroup`) | 반영. `FocusRoom`은 `ConcernRoom`으로 바꾼다(브리프 §6 용어집이 Concern을 도메인 이름으로 쓴다. 화면 라벨은 05가 정한다). `EvidenceView`는 역할이 더 분명한 이름 `EvidenceInspector`로 쓴다. `ReviewGroup`(팀 검토)은 1인 앱이라 만들지 않는다(결정 24) | §3.7 |
| helm-canon §21 | 시각화: Inquiry Map(근거 체인), Integration Map, Decision Queue, Common Operating Picture, P07 가능성 비교 표 | 반영. Inquiry Map → `EvidenceChainTree`와 `InquiryBoard`, Decision Queue → `QuestionInbox`, Common Operating Picture → 홈의 `ConcernTree` + `SinceLastVisit`, 가능성 비교 표 → `PossibilityComparison`. Integration Map은 그래프로 그리지 않고 `WholeUpdatePanel`의 영향 목록으로 만든다(영향 대상이 대개 수십 개 이하이고 목록이 키보드·스크린 리더에 낫다) | §3.8 |
| helm-canon §21 | 사실과 해석의 시각 구분, 불확실성 원인 우선, confidence 숫자 금지, 소수 반대 근거 유지 | 반영 | §3.5.2, §3.5.6, §3.8.1 |
| helm-canon §21 | 위험 버튼에 대상과 효과 표시. 상태 라벨 집합 | 반영. `ActionButton`의 `consequence` prop 필수 조건, 라벨 집합은 05가 확정할 때까지 `copy/labels.ts` 자리 표시 | §3.6.3, §3.5.4 |
| helm-canon §21 | Agent 표현: 이름보다 역할과 맡긴 일, 의인화 금지 | 반영. `ActorLabel`은 아바타·이름·감정 표현을 받지 않는다 | §3.7.2 |
| helm-canon-2 §11 | 라벨 7종(Helm, Observed, Possible, Choice, Working, Review, Source)과 색 독립 표기 | 반영. 한국어 레코드 종류 라벨로 옮기고 아이콘·글자를 항상 함께 쓴다 | §3.5.2 |
| helm-canon-2 §11 | Gate 카드, Work Agreement echo, Completion 기준 행(✓/△), "전체 반영 N개 남음" 배지 | 반영. `QuestionCard`, `WorkAgreementEcho`, `ResultCriterionRow`, `WholeUpdateBadge` | §3.7.3 |
| helm-canon-2 §11 | 근거 drill-down의 source trace 필드 6개(시각, 명령·도구, 입력 범위, 출력 참조, 종료·오류, 출처 WorkUnit) | 반영. `SourceTrace` | §3.7.2 |
| helm-canon-2 §11 | material group 카드(최대 5 + 기타) | 반영. `MaterialChangeGroups`. 묶음 기준은 경로가 아니라 데몬 투영이 주는 묶음(Concern·WorkUnit·선택 영향)을 그대로 쓴다(dogfood 001 권고, helm-canon-2 §8.7) | §3.7.3 |
| helm-canon-2 §11 | helm-web 토큰(light-dark 쌍)은 참고 | 반영하지 않음. Caustic 토큰을 쓰기로 했고(§2.4), 테마 전환도 Caustic 방식(`data-theme` 속성 + `prefers-color-scheme`)을 따른다. CSS `light-dark()` 함수는 쓰지 않는다 | §3.2.9 |
| helm-canon-2 §11(20 항목) | 상태 기계 4개(루프, WorkUnit, 연결, 투영 신선도)를 하나의 status로 합치지 않음. Gate의 cursor binding을 UI에 반영(stale 카드 표시) | 표시 쪽만 반영. 연결 상태와 투영 신선도를 서로 다른 지표로 그린다. 결정 의도에 `basisSeq`를 붙이고, 데몬이 낡았다고 거부하면 카드에 "바뀐 내용 보기"를 띄운다 | §3.8.5, §3.6.3 |
| helm-canon-3 §8 | N/E/M 시각 문법: N은 선택·합의 카드(solid boundary), E는 판단·근거 관계(qualified state), M은 산출물·diff·실행(observed timestamp). 색만으로 구분하지 않음. 세 영역을 다른 탭으로 완전히 나누지 않음 | 반영 | §3.5.1 |
| helm-canon-3 §8 | progressive disclosure 세 깊이(Glance/Review/Audit) | 반영. 한국어 이름 한눈에 / 검토 / 감사 | §3.5.7 |
| helm-canon-3 §8 | 상태 배지: stale, contested, inferred, policy-approved, agent-generated, human-authored, policy-derived. 배지와 문장을 함께 | 반영. `QualityBadge`, `AuthorshipMark` | §3.5.3, §3.5.5 |
| helm-canon-3 §8 | 컴포넌트 후보: 복귀 요약 블록, 질문 카드(collapsed/expanded), 진행 작업 카드, 근거 inspector, 결과 확인 2단계 패널, 근거 체인 트리, 루프 타임라인(의미 있는 이벤트만 기본), 자극판, 발산 표 | 반영 | §3.7, §3.8 |
| helm-canon-3 §8 | confidence 숫자 대신 직접성·남은 반대 근거·검증하지 못한 범위 표시 컴포넌트 | 반영. `CertaintyDescriptor` | §3.7.2 |
| helm-canon-3 §8 | assistant-ui를 쓸 경우 chat은 각 객체의 discussion thread로, 전역 chat을 홈으로 두지 않음 | 반영 | §3.10 |
| helm-canon-3 §7.2 G8 | 투영의 신선도와 source cursor 표시 | 표시 쪽 반영(`FreshnessIndicator`). 생성 규칙은 12·19 | §3.5.8 |
| helm-canon-3 §7.2 G14 | 세 깊이, N/E/M 문법, 의미 상태 언어 | 반영(문구는 05) | §3.5 |
| helm-canon-3 §7.2 G15 | raw chain-of-thought는 근거가 아니다. 의도·불확실성·다음 행동을 보인다 | 반영. 모델의 사고 텍스트를 표시하는 컴포넌트를 만들지 않는다. 대화 스레드에서도 reasoning 파트는 렌더링하지 않는다 | §3.10.3 |
| helm-canon-3 §7.1 C1 | 가역성을 Helm이 계산하지 않음. Gate 카드에 "되돌릴 수 있음"을 표시하려면 출처가 권한 레이어임을 함께 표시 | 반영. `ReversibilityNote`는 `source: 'permission-layer'`가 있을 때만 그린다 | §3.7.2 |
| helm-canon-3 §7.1 C2·C3 | 대안 제시는 선택 요청에만, 2~3개로 줄이지 않음. 기본 표시 개수는 다이얼, 권리 게이트 질문은 개수 상한으로 숨기지 않음 | 반영 | §3.9 |
| conversation-extracts-4 d25 | assistant-ui를 Tauri에서 쓸 때의 제약, Background runs가 assistant-ui "run" 개념에 묶이는지, 요소 단위 반응 UI를 그 위에 만들 수 있는지, 생성형 UI 컴포넌트를 Helm 카드로 정의할 수 있는지 | 답함. Background runs·생성형 UI·Interactables는 쓰지 않고, 자극 보드는 직접 만든다 | §3.10 |
| conversation-extracts-4 20-8 | 원함 탐구 자극판: 요소 단위 반응, 이유 없는 반응 | 반영 | §3.8.3 |
| conversation-extracts-4 20-9·20-10 | 사람의 결정은 모델 도구 경로를 거치지 않는다. 모델의 앱 상태 수정은 커널 제안으로 보내고 받아들여진 것만 화면에 반영 | 반영(UI-D01, UI-D03, §3.10.2) | §3.6, §3.10 |
| conversation-extracts-4 20-11~20-13 | ExternalStoreRuntime + 자체 스트림, AssistantTransport 미사용, 독립 모드 요소(MIT, 소스 복사), Interactables 미사용, 생성형 UI 시험만, Assistant Cloud 불필요, OpenCode 런타임은 참고 구현 | 반영. 생성형 UI는 시험도 1차 범위에서 뺀다(이유 §3.10.4) | §3.10 |
| conversation-extracts-2 d-6 | 대비 압축 출력(프레임 2~3개 + 질문 하나)을 "고르기"가 아닌 "반응 받기"로 표현 | 화면 규칙 반영(접힌 항목도 반응 가능, 고르기 버튼 없음). 생성 규칙은 15 | §3.9 |
| conversation-extracts-1·2·3 끝 목록 | 문서 21에 배정된 항목 없음. 대화에서 사용자가 React 기반 설명을 원한 것(E1-144)과 시각화 요청(X3-10-07)은 결정 32와 이 문서의 시각화 원칙으로 이어진다 | 해당 없음 | — |
| 브리프 §3.5 | "모델이 초안, 사람은 반응" 원칙(담당 P1·P2·P9) | 컴포넌트 수준 규칙을 더함: 초안 표시(`DraftMark`), 빈 양식 먼저 금지 | §3.9.5 |

### 2.4 Axiom 디자인 시스템 검토와 판단 [제안]

#### 2.4.1 확인한 것 [원문]

저장소 `~/projects/axiom/code/axiom-design-system`(읽기 전용으로 확인, 2026-10-11)의 구성은 다음과 같다.

| 부분 | 내용 | 경로 |
|---|---|---|
| Axiom Studio | 디자인 시스템과 캔버스를 만드는 브라우저 앱. React 19.3, Tailwind 4.3, Radix, IndexedDB | `apps/studio`, 루트 `package.json` |
| Foundation 1.0.0 문서 | Axiom Studio의 제품 명세(56개 문서). DTCG 2025.10을 기준으로 삼는다는 정책과 `TokenDefinition` 같은 모델은 있으나 구체 토큰 이름·값은 없다 | `docs/foundation/README.md`, `docs/foundation/syntax/foundation-and-token-semantics.md` |
| Caustic | Studio의 화면 부품 전체를 담당하는 별도 디자인 시스템. 양방향 git subtree로 들어와 있다. 패키지 `@caustic/tokens`, `@caustic/react`, `@caustic/spec`, `@caustic/gateway`(모두 1.0.0, private) | `vendor/caustic/`, `vendor/caustic/SYNC.json`, `vendor/caustic/FOUNDATION.md` |
| Caustic 토큰 | 원본 `packages/tokens/src/tokens.mjs` 하나에서 `dist/caustic.tokens.css`(CSS 변수), `dist/theme.css`(Tailwind 4 `@theme`), DTCG JSON(`tokens.core/light/dark.json`)을 생성한다. 원시(`--cs-neutral-850`) → 의미(`--cs-color-text-tertiary`) → 컴포넌트(`--cs-control-md`) 세 층. 색은 OKLCH. 다크·라이트는 `:root[data-theme]`와 `prefers-color-scheme`, 밀도는 `:root[data-density="compact"]` | `vendor/caustic/packages/tokens/` |
| Caustic 대비 검사 | 빌드 관문. 본문 7:1, 보조·placeholder 4.5:1, 비활성 3:1, 컨트롤 경계·포커스 3:1, 강조색은 색상 24개를 돌려 검사. 결과 `dist/contrast.json` | `vendor/caustic/FOUNDATION.md`, `dist/contrast.json` |
| Caustic 한국어 규칙 | `:where(:lang(ko)) { word-break: keep-all; overflow-wrap: anywhere; }`, 한국어 제목의 음수 자간을 −0.01em으로 제한, 캡션 +0.02em | `vendor/caustic/packages/tokens/src/base.css` 29·52·53행 |
| Caustic React 부품 | 158개(일반 UI, 디자인 도구용, 에이전트 대화용). Radix 13개 패키지, cva, tailwind-merge, lucide-react 0.468 | `vendor/caustic/packages/react/` |
| React 버전 | `@caustic/react` peerDependencies `react ^19`. `forwardRef`를 쓰지 않고 `ref`를 일반 prop으로 받는다(React 19 방식). `modal.tsx`가 `use()`(42·47행)와 `<Context value>` 공급자(96행)를 쓴다. 셋 다 React 18에 없다 | `packages/react/package.json`, `packages/react/src/components/modal/modal.tsx`, `CONTRIBUTING.md` |
| 시각 검사 | Caustic G0~G6 관문(토큰·대비, 명세 잠금, 정적 규칙, Chromium 렌더·axe, 픽셀 비교 2%, 정책, 패키징). 문서 앱은 Vite + React, Storybook 없음 | `vendor/caustic/packages/gateway/src/checks/`, `vendor/caustic/apps/docs` |
| 라이선스 | 루트 MIT("Copyright (c) 2026 Lee in"). Caustic에는 LICENSE 파일과 `license` 필드가 없다. 원본 위치는 `SYNC.json`의 로컬 Windows 경로뿐이다 | `LICENSE`, `vendor/caustic/SYNC.json` |
| 글꼴 | `--cs-font-ui: "Geist", "SUIT", "Pretendard Variable", "Pretendard", "Noto Sans KR", …`, `--cs-font-mono: "Geist Mono", …`. SUIT를 Pretendard보다 앞에 둔 것은 소유자 결정(ADR-0052 O3). 글꼴 파일은 Caustic에 없고 Studio가 npm 패키지(`geist`, `@sun-typeface/suit`)로 넣는다 | `dist/caustic.tokens.css` 295~297행, `apps/studio/src/fonts.css` |

#### 2.4.2 판단: 토큰 층만 가져온다

| 선택지 | 판단 |
|---|---|
| 그대로 쓰기(토큰 + React 부품) | 기각. React 부품이 React 19를 요구한다. Helm은 결정 32로 React 18이다. React 18에서는 `ref`가 prop으로 전달되지 않아 부품 루트에 붙인 ref가 조용히 빠지고, `use()`와 `<Context value>`는 없다. 158개 부품을 React 18용으로 고치면 Caustic의 명세 잠금(`locks.json`)과 어긋나 두 벌을 따로 유지하게 된다 |
| **일부 쓰기: 토큰 층** | **채택.** 토큰 CSS는 React와 무관하다. 대비 관문을 통과한 값, 다크·라이트 전환 방식, 밀도 전환, 한국어 줄바꿈 규칙, Tailwind 4 `@theme` 연결이 이미 있다. Helm이 쓰려는 스타일 방식(§2.5)과 같은 Tailwind 4다. 소유자의 다른 제품과 화면 인상이 맞는다 |
| 일부 쓰기: 부품 구조만 참고 | 함께 채택. 부품 파일 구성(`<id>.tsx`, `<id>.variants.ts`(cva), `<id>.fixture.tsx`, `data-slot` 속성)과 정적 규칙(리터럴 색 금지, `dark:` 금지, 토큰 밖 클래스 금지)을 Helm 부품 규칙으로 옮긴다(§3.6.1, §6.4). 코드는 복사하지 않는다 |
| Foundation 문서 | 쓰지 않음. Axiom Studio 제품 명세이고 다른 제품이 쓸 토큰 명세가 아니다 |
| 쓰지 않기(Helm 고유 토큰) | 기각. 대비 검사·다크 모드·밀도를 처음부터 다시 만들고 검증해야 한다. 이 작업 중 Helm 고유 팔레트 초안을 만들어 대비를 계산해 봤으나(`.helm-design-work/P14/contrast.py` [실험]), Caustic 값이 같은 기준 이상을 이미 만족하므로 버렸다 |

가져오는 범위와 방식:

1. `vendor/caustic/packages/tokens/dist/caustic.tokens.css`와 `dist/theme.css`를 `apps/desktop/src/ui/tokens/caustic/`에 고정 사본으로 둔다. `SYNC.json`(원본 커밋, 파일별 sha256)을 함께 두고, `just ui-check`가 사본과 해시가 맞는지 검사한다(§6.4). 자동 동기화는 하지 않는다. 갱신은 사람이 의도해서 한다.
2. Caustic `base.css`는 가져오지 않는다. 재질(glass, frost), 에이전트 표시 애니메이션(orb, shimmer, spectrum), 캔버스 규칙이 Helm 원칙(의인화 금지, 애니메이션 없이도 이해 가능)과 맞지 않거나 쓸 데가 없다. 한국어 줄바꿈 규칙과 타입 역할 클래스는 Helm `base.css`에 다시 적는다(§3.2.3).
3. Caustic 토큰 중 Helm이 쓰는 것: 중립 색, 의미 색(텍스트·표면·테두리·채움·포커스·상태 4종·diff), 간격, 반경, 컨트롤 크기, 그림자(elevation), 모션 시간(0~480ms만), 이징, z-index, 타입 역할, 밀도. 쓰지 않는 것: `material-*`, `canvas-*`, `media-*`, `agent-glow`, `--cs-studio-*`, 디자인 도구 전용 `--cs-size-*`, 480ms를 넘는 반복 애니메이션 시간, `voice`·`thought` 타입 역할.
4. Helm 의미 토큰(`--helm-*`, §3.2.2)은 Caustic 의미 토큰만 참조한다. Caustic 원시 토큰을 직접 읽지 않는다.
5. 라이선스: Caustic에 라이선스 표시가 없다. 소유자가 같으므로 쓰는 데 문제는 없을 것으로 본다 [가정]. 가져오기 전에 Caustic 저장소에 LICENSE를 더하거나, Helm `apps/desktop/src/ui/tokens/caustic/NOTICE.md`에 출처와 사용 허락을 적는다(§7 미결 U-07).

React 19로 올리면 Caustic React 부품도 쓸 수 있다. 이 선택은 결정 32를 바꾸는 일이라 이 문서에서 정하지 않고 ADR 후보로 남긴다(ADR 후보 2).

### 2.5 UI 라이브러리 선택

외부 사실은 2026-10-11에 npm 레지스트리, 공식 문서, 패키지 소스(tarball)로 확인했다. 확인 경로는 §8 출처에 있다.

#### 2.5.1 기준

1. React 18에서 ref 전달과 동작이 보장된다(결정 32).
2. Tauri v2의 두 웹뷰(Windows WebView2, macOS WKWebView)에서 같게 동작한다.
3. 한국어 입력(IME)과 한국어 조판에 문제가 없다.
4. assistant-ui, Caustic 토큰과 같은 바탕을 쓴다. 같은 일을 하는 라이브러리를 둘 들이지 않는다.
5. 1인 개발이 유지할 수 있는 크기다.

#### 2.5.2 헤드리스 컴포넌트: Radix Primitives(`radix-ui` 통합 패키지) [제안]

| 후보 | 확인한 사실 | 판단 |
|---|---|---|
| **Radix(`radix-ui` 1.7.0)** | peer `react ^16.8 … ^18 … ^19`, MIT [검색: npm] | **채택.** assistant-ui가 이미 `radix-ui ^1.7.0`에 의존한다 [검색: npm `@assistant-ui/react` 0.15.27]. Caustic 부품도 Radix다. 새 의존성을 하나 덜 들이고, 소유자가 익숙한 구조를 따른다. 위치 계산은 Radix 내부의 floating-ui가 하므로 CSS 앵커 위치(Safari 26부터)를 쓰지 않아도 된다 |
| Base UI(`@base-ui/react` 1.9.0) | 1.0 안정판 2025-12, peer `react ^17 \|\| ^18 \|\| ^19`, IME 조합 대기 처리 있음 [검색: npm, tarball]. shadcn이 2026-07부터 기본 바탕으로 쓴다 [검색: ui.shadcn.com changelog] | 기각. assistant-ui가 Radix를 끌고 오므로 두 헤드리스 라이브러리를 함께 갖게 된다 |
| React Aria Components 1.22.1 | peer React 18 포함, Apache-2.0, `ko-KR` 문자열 표, 날짜·숫자 국제화, IME 조합 처리 [검색: npm, tarball] | 기각. 국제화가 가장 깊으나 Helm은 날짜 선택기·숫자 입력 같은 국제화 부품이 거의 필요 없다. 스타일 연결 방식(렌더 prop, data 속성)이 Radix와 달라 assistant-ui 기본 부품과 섞기 어렵다. 한국어 IME 문제는 Enter 처리 하나로 좁혀 직접 다룬다(§3.6.5) |

shadcn/ui CLI로 부품을 생성하지 않는다 [제안]. 현재 shadcn 부품은 `forwardRef` 없이 `React.ComponentProps`로 쓰여 React 18에서 ref가 전달되지 않는다 [검색: ui.shadcn.com/docs/tailwind-v4]. Helm 기본 부품은 Radix 위에 `forwardRef`로 직접 쓴다.

#### 2.5.3 스타일 방식: Tailwind CSS v4 + CSS 변수 토큰 + cva [제안]

| 후보 | 판단 |
|---|---|
| **Tailwind v4 + Caustic/Helm CSS 변수 + `class-variance-authority` + `tailwind-merge`** | **채택.** Caustic 토큰이 Tailwind 4 `@theme`을 제공한다(§2.4). assistant-ui 스타일 부품과 shadcn 계열 소스가 Tailwind v4로 쓰여 있어 참고 소스를 옮기기 쉽다 [검색: r.assistant-ui.com 레지스트리 소스]. 정적 검사(토큰 밖 클래스 금지)를 Caustic `studio-lint` 방식으로 만들 수 있다 |
| CSS Modules + CSS 변수 | 기각. 토큰 연결은 되지만 Caustic `theme.css`와 assistant-ui 참고 소스를 다시 써야 한다 |
| vanilla-extract, CSS-in-JS 런타임 | 기각. 빌드 도구가 하나 늘고, 런타임 CSS-in-JS는 스트림 갱신이 잦은 화면에서 비용이 있다 [지식] |

Tailwind v4의 최소 브라우저는 Chrome 111, Safari 16.4다 [검색: tailwindcss.com/docs/compatibility]. 웹뷰 기준은 §2.5.7.

#### 2.5.4 아이콘: lucide-react 1.x [제안]

| 후보 | 확인한 사실 | 판단 |
|---|---|---|
| **lucide-react 1.55.0** | peer React 18 포함, ISC. 1.0부터 `aria-hidden` 기본값 [검색: npm, lucide 1.0.1 릴리스 노트] | **채택.** Caustic과 같은 아이콘 계열이다(Caustic은 0.468). 1.x의 `aria-hidden` 기본값이 "아이콘은 장식, 의미는 글자" 원칙(UP-4)과 맞는다 |
| Tabler Icons 3.49 | MIT, peer React ≥16 [검색: npm] | 기각. 비슷한 선 아이콘이며 바꿀 이유가 없다 |
| Phosphor 2.1.10 | 2025-05 이후 릴리스 없음 [검색: npm] | 기각 |

#### 2.5.5 그래프·차트: 1차에 넣지 않음 [제안]

| 대상 | 1차 방식 | 이후 필요할 때 |
|---|---|---|
| 근거 체인 | 트리 목록(`role="tree"`) 직접 구현 | 관계가 많아 트리로 읽기 어려우면 `@xyflow/react` 12.12(peer `react >=17`, MIT) + `@dagrejs/dagre` 3.1(MIT) [검색: npm] |
| 루프 타임라인 | 세로 목록 + 작은 SVG 경로 | — |
| Goal 이력 | 세로 버전 목록 + 차이 표시 | — |
| 주의 예산, 연결 상태 | SVG 막대 직접 구현 | 시계열 차트가 필요하면 `@visx/*` 4.0(peer `react ^18 \|\| ^19`) [검색: npm] |

- elkjs는 쓰지 않는다. 라이선스가 EPL-2.0 또는 GPL-3.0이다 [검색: npm].
- react-chrono는 `react ^19.2.3`을 요구해 쓸 수 없다 [검색: npm].
- Recharts 3.10은 React 18을 지원하나 `react-is`를 peer로 요구한다 [검색: npm]. 1차에 필요한 차트가 없어 넣지 않는다.
- 근거: Helm 시각화는 대부분 문장이 많은 계층·시간 구조다. 그래프 그림보다 목록이 한국어 문장을 담기 좋고 키보드·스크린 리더로 읽힌다. Caustic도 차트를 직접 그린 SVG로 만든다 [원문: `apps/studio/src/theme-workspace/charts.ts`].

#### 2.5.6 그 밖의 라이브러리 [제안]

| 용도 | 선택 | 확인 |
|---|---|---|
| 긴 목록 가상화(변화 기록, 감사 이벤트, 큰 근거 트리) | `@tanstack/react-virtual` 3.14 | peer React 16.8~19 [검색: npm] |
| 텍스트 차이(Goal 이력, 초안 수정) | `diff`(jsdiff)의 어절(공백) 단위 비교 | [지식] |
| 자동 높이 입력창 | `react-textarea-autosize`(assistant-ui가 이미 의존) | [검색: npm]. CSS `field-sizing`은 Safari 26.2부터라 쓰지 않는다 [검색: MDN BCD] |
| 표 | 직접 구현. 정렬·필터가 필요한 표(변화 기록)는 `@tanstack/react-table` 9.2(peer `>=18`) | [검색: npm] |
| 날짜 표시 | `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat`(`ko-KR`) | [지식] |
| 대화 스레드 | `@assistant-ui/react` 0.15.27 primitives + `useExternalStoreRuntime` | §3.10 |

#### 2.5.7 웹뷰 기준과 피할 CSS [제안]

- Windows: WebView2 Evergreen(Edge Stable과 같이 갱신) [검색: learn.microsoft.com WebView2 distribution]. 최신 Chromium 기능을 쓸 수 있다.
- macOS: WKWebView는 시스템 WebKit을 쓰고 지원이 끝난 macOS는 갱신되지 않는다 [검색: v2.tauri.app/reference/webview-versions]. 기준을 **Safari 17.5 이상(WebKit)**으로 둔다. Tauri `minimumSystemVersion`은 `14.0`(Sonoma)로 두고 20에 요구한다. Safari 26.x가 Sonoma·Sequoia에 배포되었으므로 갱신된 기기는 기준을 넘는다 [검색: eclecticlight.co 2026-08-18].
- 시작할 때 `CSS.supports('color', 'oklch(0.5 0.1 200)')`와 `CSS.supports('selector(:has(a))')`를 검사해 실패하면 "이 macOS의 웹 엔진이 오래되어 화면이 깨질 수 있습니다"라는 띠를 띄운다(§4).

피하거나 대체하는 CSS(웹뷰 지원 하한 기준) [검색: MDN browser-compat-data 8.1.5]:

| 기능 | Safari 지원 | Helm 처리 |
|---|---|---|
| `oklch()`, `:has()`, `@layer`, `@container` | 15.4~16 | 사용 |
| `color-mix()`, `@property` | 16.2, 16.4 | 사용(Tailwind v4가 씀) |
| CSS 중첩, `light-dark()`, `@starting-style`, `text-wrap: balance`, popover 속성 | 17.2~17.5 | 사용 가능. 단 테마는 `data-theme` 방식 |
| View Transitions | 18 | 쓰지 않음(모션 원칙 UP-12) |
| `content-visibility`, `scrollbar-width`, `scrollbar-color` | 18~26.2 | 점진 적용만(없어도 동작) |
| `text-wrap: pretty` | 26 | 점진 적용만 |
| 앵커 위치(`anchor-name`, `position-area`) | 26(부분) | 쓰지 않음. Radix(floating-ui)가 계산 |
| `field-sizing: content` | 26.2 | 쓰지 않음. JS 자동 높이 |
| `@scope` | 26.4 | 쓰지 않음 |
| `overflow-anchor` | 27 | 쓰지 않음. 대화 자동 스크롤은 JS(assistant-ui Viewport) |
| `interpolate-size`, `calc-size()` | 없음 | 쓰지 않음 |
| `word-break: auto-phrase` | 미출시. Chrome도 일본어만 | 쓰지 않음. 한국어는 `keep-all` + `overflow-wrap: anywhere` [검색: developer.chrome.com css-i18n-features] |
| `text-spacing-trim` | 없음 | 쓰지 않음 |

#### 2.5.8 테스트·카탈로그 도구 [제안]

| 후보 | 확인한 사실 | 판단 |
|---|---|---|
| **Storybook 10.6 + `@storybook/react-vite`** | peer React 18 포함, Vite 5~8, ESM 전용, Node 20.19+/22.12+ [검색: npm, Storybook 마이그레이션 문서] | **채택(카탈로그).** 상태별 이야기(story)를 컴포넌트 계약의 살아 있는 명세로 쓴다 |
| **`@storybook/addon-vitest`** | test-runner를 대체하도록 설계됨, Vitest 3~5 지원 [검색: Storybook 문서, npm] | **채택(상호작용·접근성 테스트).** 이야기를 Vitest 브라우저 모드로 실행 |
| **`@playwright/test` `toHaveScreenshot`** | 1.64에서 WebP 기준 이미지 저장 가능 [검색: Playwright 릴리스] | **채택(시각 테스트).** 정적 Storybook을 Chromium과 WebKit 두 엔진으로 찍는다. WebKit 엔진이 macOS WKWebView에 가장 가까운 근사다 [지식] |
| Playwright 실험적 컴포넌트 테스트 | 1.63에서 더 갱신하지 않는다고 발표 [검색: Playwright 1.63 릴리스] | 기각 |
| Ladle 5.1 | 2025-11 이후 릴리스 없음 [검색: npm] | 기각 |
| Chromatic, Argos 같은 외부 서비스 | 외부 업로드가 필요 | 기각. 사용자 지침상 외부 서비스 업로드는 명시 요청이 있을 때만 |

## 3. 명세 본문

### 3.1 UI 원칙 [제안]

| ID | 원칙 | 컴포넌트에 주는 규칙 | 근거 |
|---|---|---|---|
| UP-1 | 상태 먼저, 대화는 보조 | 홈과 Concern 화면의 첫 영역에 대화 스레드를 두지 않는다. 대화는 객체(Concern, 질문, 작업 합의, 결과 제출)에 붙은 접히는 스레드다 | 결정 10, v0.3 09 §2, helm-canon-3 §6.4 P1 |
| UP-2 | 차이 먼저, 기록은 필요할 때 | 기본 목록은 "마지막 확인 이후 의미 있는 변화"만 보인다. 모든 이벤트는 감사 깊이에서 연다 | helm-canon-3 §6.4 P2, §6.8 |
| UP-3 | 세 깊이 | 복합 컴포넌트는 `depth: 'glance' \| 'review' \| 'audit'`를 받는다 | helm-canon-3 §6.9.3 |
| UP-4 | 의미는 글자·아이콘·모양으로, 색은 보조 | 색만 다른 두 상태를 만들지 않는다. 모든 상태 표시에 글자 라벨이 있다 | helm-canon-3 §6.9.1, helm-canon-2 §3.5 |
| UP-5 | 구분해야 하는 것은 다르게 보인다 | 관찰 / 추측(해석·가능성) / 판단 / 선택, 결과 제출 / 결과 확인 / 전체 반영은 서로 다른 컴포넌트·라벨로 그린다. 하나의 "완료" 표시로 합치지 않는다 | 불변조건 2·5, helm-canon §17.7 MUST NOT |
| UP-6 | 모름·이견·낡음을 숨기지 않는다 | 반대 근거, 이의, stale 표시는 접지 않는다. 대비 압축에서도 접지 않는다 | 불변조건 6, A9, v0.3 09 §4.5 |
| UP-7 | 초안을 내밀고 반응을 받는다 | 사람이 채워야 하는 빈 양식을 첫 화면으로 내지 않는다. 모델 초안을 보여 주고 고치기·반응·이의를 받는다 | 결정 18 |
| UP-8 | 고르기만 있는 상호작용 금지 | §3.9의 규칙 | 결정 18 |
| UP-9 | 의인화 금지 | 아바타, 이름, 감정 표현, 타이핑 애니메이션, "생각 중" 문구를 쓰지 않는다. 행위자는 역할과 맡긴 일로 표시한다 | helm-canon §17.6 §7, v0.3 09 §6 |
| UP-10 | 언제 기준인지 보인다 | 투영을 그리는 화면은 기준 seq와 시각, 신선도를 보인다. 낡은 화면을 현재처럼 보이지 않는다 | helm-canon-2 §3.13, helm-canon-3 §6.4 P6 |
| UP-11 | 결정은 결과를 말한다 | 결정 버튼 문구는 결과를 말하고, 위험한 행동은 대상과 효과를 버튼에 넣는다. `[승인] [거절]`만 있는 묶음을 만들지 않는다 | helm-canon §17.6 §4, helm-canon-2 §3.7 |
| UP-12 | 애니메이션 없이도 이해된다 | 상태는 정적 표시로 전달하고 모션은 위치 이동을 돕는 데만 쓴다. `prefers-reduced-motion`에서 모든 모션을 끈다 | helm-canon-2 §3.14 |
| UP-13 | 정상 진행은 조용히 | 진행 이벤트마다 토스트·알림을 띄우지 않는다. 토스트는 사람이 방금 한 조작의 결과와 오류에만 쓴다 | helm-canon §17.6 §8, helm-canon-3 §6.16 |

### 3.2 디자인 토큰

#### 3.2.1 층과 이름 [제안]

```text
층 1  Caustic 원시     --cs-neutral-850, --cs-accent-600, --cs-space-2_5 …      Helm 코드는 읽지 않는다
층 2  Caustic 의미     --cs-color-text-tertiary, --cs-control-md, --cs-elevation-2 …
층 3  Helm 의미        --helm-*  (층 2만 참조. 글꼴 이름 목록만 예외)
층 4  컴포넌트 지역    --hc-<컴포넌트>-<속성>  (층 2·3만 참조, 해당 컴포넌트 파일 안에서만 정의)
```

- Tailwind 클래스는 Caustic `theme.css`가 노출한 이름(`bg-surface-base`, `text-text-primary`, `rounded-md`, `h-control-md`, `shadow-2`, `ease-standard`)과 Helm `theme.helm.css`가 더하는 이름(`text-helm-…`, `border-helm-…`)만 쓴다.
- 리터럴 색, `dark:` 변형, 임의 값(`w-[123px]`), 색 알파 수정자(`bg-black/50`)는 금지한다(§6.4 정적 검사).
- 간격 단위는 4px(`--spacing: 4px`). Tailwind 숫자 간격(`p-3` = 12px)을 쓴다.

#### 3.2.2 색

Caustic 의미 색 중 Helm이 쓰는 것과 값 [원문: `vendor/caustic/packages/tokens/dist/caustic.tokens.css`]. 강조 색상(hue)은 Caustic 기본값 205를 쓴다.

| 토큰 | 라이트 | 다크 | Helm에서의 용도 |
|---|---|---|---|
| `--cs-color-bg-app` | `oklch(0.97 0.003 260)` | `oklch(0.18 0.008 260)` | 창 배경, 레일 |
| `--cs-color-surface-base` | `oklch(0.995 0.001 260)` | `oklch(0.225 0.009 260)` | 가운데 패널, 카드 |
| `--cs-color-surface-raised` | `oklch(0.985 0.002 260)` | `oklch(0.265 0.01 260)` | 인스펙터, 팝오버, 대화상자 |
| `--cs-color-bg-inset` | `oklch(0.18 0.008 260 / 0.04)` | `oklch(0 0 0 / 0.22)` | M(실제 변화) 블록, 코드, 도구 입출력 |
| `--cs-color-border-subtle` | `oklch(0.18 0.008 260 / 0.07)` | `oklch(1 0 0 / 0.06)` | 목록 구분선 |
| `--cs-color-border-default` | `oklch(0.18 0.008 260 / 0.12)` | `oklch(1 0 0 / 0.1)` | 카드 테두리(장식) |
| `--cs-color-border-control` | `oklch(0.65 0.011 260)` | `oklch(0.54 0.012 260)` | 입력·N 카드 테두리(3:1 이상 필요한 경계) |
| `--cs-color-border-strong` | `oklch(0.18 0.008 260 / 0.2)` | `oklch(1 0 0 / 0.17)` | E 레코드 왼쪽 선 |
| `--cs-color-text-primary` | `oklch(0.18 0.008 260)` | `oklch(0.985 0.002 260)` | 본문 |
| `--cs-color-text-secondary` | `oklch(0.41 0.012 260)` | `oklch(0.845 0.008 260)` | 보조 설명 |
| `--cs-color-text-tertiary` | `oklch(0.48 0.012 260)` | `oklch(0.65 0.011 260)` | 메타 정보(시각, ID, seq) |
| `--cs-color-text-disabled` | `oklch(0.65 0.011 260)` | `oklch(0.54 0.012 260)` | 비활성 |
| `--cs-color-text-link` | `oklch(0.465 0.118 205)` | `oklch(0.815 0.105 205)` | 링크, 근거 참조 |
| `--cs-color-accent-solid` / `-on` | `oklch(0.525 0.135 205)` / `oklch(0.995 0.001 260)` | `oklch(0.735 0.13 205)` / `oklch(0.14 0.007 260)` | 주 행동 버튼, 포커스 링 |
| `--cs-color-accent-soft` | `oklch(0.735 0.13 205 / 0.14)` | `oklch(0.735 0.13 205 / 0.17)` | 선택된 행 배경(왼쪽 막대와 함께) |
| `--cs-color-fill-hover` / `-selected` | `… / 0.045` / `… / 0.11` | `oklch(1 0 0 / 0.05)` / `/ 0.12` | 호버, 눌림 |
| `--cs-color-focus-ring` | 강조색 solid와 같음 | 같음 | 포커스 |
| `--cs-color-success-text` / `-soft` | `oklch(0.465 0.118 158)` / `oklch(0.815 0.105 158 / 0.22)` | `oklch(0.815 0.105 158)` / `oklch(0.635 0.142 158 / 0.2)` | 확인됨, 연결됨, 긍정 반응 |
| `--cs-color-warning-text` / `-soft` | `oklch(0.465 0.118 72)` / `oklch(0.815 0.105 72 / 0.3)` | `oklch(0.815 0.105 72)` / `oklch(0.635 0.142 72 / 0.2)` | 이의 걸림, 낡음, 만료점 임박, 저하 |
| `--cs-color-danger-text` / `-soft` / `-solid` | `oklch(0.465 0.118 25)` / `… 25 / 0.2)` / `oklch(0.525 0.135 25)` | `oklch(0.815 0.105 25)` / `oklch(0.635 0.142 25 / 0.2)` / `oklch(0.735 0.13 25)` | 오류, 실패, 부정 반응, 위험 행동 버튼 |
| `--cs-color-info-text` / `-soft` | `oklch(0.465 0.118 295)` / `oklch(0.815 0.105 295 / 0.2)` | `oklch(0.815 0.105 295)` / `oklch(0.635 0.142 295 / 0.2)` | 다시 만드는 중, 안내, 이유 없는 반응 |
| `--cs-color-diff-add` / `-remove` | `oklch(0.735 0.13 158 / 0.18)` / `oklch(0.735 0.13 25 / 0.16)` | `… / 0.18` | Goal 이력·초안 수정의 차이 |

대비: Caustic 빌드 관문이 위 텍스트 토큰을 표면 토큰 위에서 본문 7:1, 보조 4.5:1, 비활성 3:1, 컨트롤 경계·포커스 3:1로 검사한다 [원문: `dist/contrast.json`, 예: 라이트 `text.primary`/`surface.base` 18.54, `text.secondary`/`surface.base` 8.7]. Helm 의미 토큰은 이 토큰만 참조하므로 같은 대비를 따른다. Helm이 새 조합(예: `warning-text` 위 `warning-soft`)을 쓰면 §6.3의 대비 테스트에 그 조합을 더한다.

Helm 의미 토큰(`apps/desktop/src/ui/tokens/helm.css`) [제안]:

```css
:root {
  /* N: 방향(Goal, 선택, 작업 합의, 완료 기준). 실선 경계 */
  --helm-n-border: var(--cs-color-border-control);
  --helm-n-border-style: solid;
  /* E: 이해(관찰, 추측, 판단, 근거). 왼쪽 선의 모양으로 단계 구분 */
  --helm-e-rule: var(--cs-color-border-strong);
  --helm-e-rule-guess: dashed;      /* 해석·가능성(추측) */
  --helm-e-rule-finding: solid;     /* 판단 */
  --helm-e-rule-observation: dotted;/* 관찰 */
  /* M: 실제 변화(파일, 실행, 외부 상태). 안쪽 들어간 면 + 관찰 시각 */
  --helm-m-surface: var(--cs-color-bg-inset);

  /* 글꼴: Caustic 고정폭 순서에 한글 글꼴을 더함 */
  --helm-font-mono: "Geist Mono", "SUIT", ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace;
  /* 한국어 문단용 타입 역할 */
  --helm-text-reading: 400 15px/24px var(--cs-font-ui);

  /* 작성자 */
  --helm-draft-border: var(--cs-color-accent-solid);  /* 모델 초안: 점선 + "초안" 라벨 */
  --helm-draft-border-style: dashed;
  /* 품질 상태 옆길 */
  --helm-contested-fg: var(--cs-color-warning-text);
  --helm-contested-bg: var(--cs-color-warning-soft);
  --helm-stale-fg: var(--cs-color-warning-text);
  --helm-superseded-fg: var(--cs-color-text-tertiary);
  /* 질문 */
  --helm-rights-gate-bar: var(--cs-color-accent-solid);
  --helm-expiry-near-fg: var(--cs-color-warning-text);
  /* 신선도·연결 */
  --helm-fresh-ok: var(--cs-color-success-text);
  --helm-fresh-stale: var(--cs-color-warning-text);
  --helm-fresh-rebuilding: var(--cs-color-info-text);
  --helm-fresh-failed: var(--cs-color-danger-text);
  /* 반응(자극 보드). 색과 함께 밑줄 모양으로 구분 */
  --helm-react-pos-bg: var(--cs-color-success-soft);
  --helm-react-neg-bg: var(--cs-color-danger-soft);
  --helm-react-reasonless-bg: var(--cs-color-info-soft);
  --helm-react-pos-underline: solid;
  --helm-react-neg-underline: wavy;
  --helm-react-reasonless-underline: dotted;
  /* 선택된 행 */
  --helm-selected-bar: var(--cs-color-accent-solid);
  --helm-selected-bar-width: 3px;
  /* 새로 바뀐 항목(사람이 아직 보지 않음) */
  --helm-unseen-dot: var(--cs-color-accent-solid);
}
```

N/E/M에 고유 색상을 주지 않는다 [제안]. Caustic의 상태 색상 4개(158, 72, 25, 295)와 강조 색상(205)이 이미 쓰이고 있어 세 세계에 색을 더 주면 상태 색과 겹친다. 세 세계는 테두리 모양, 아이콘, 라벨로 구분한다(§3.5.1). 원천도 "고정 색을 줄 수는 있지만 라벨과 아이콘을 함께 쓴다"고만 한다(helm-canon-3 §6.9.2).

#### 3.2.3 타이포와 한국어 규칙

글꼴 [제안]:

| 역할 | 글꼴 순서 | 파일 | 라이선스 |
|---|---|---|---|
| UI·본문 | `var(--cs-font-ui)` = `"Geist", "SUIT", "Pretendard Variable", "Pretendard", "Noto Sans KR", ui-sans-serif, system-ui, …` [원문: Caustic] | Geist Variable woff2(npm `geist`), SUIT Variable woff2(npm `@sun-typeface/suit` 2.0.5)를 앱에 넣고 `@font-face` 이름을 "Geist", "SUIT"로 등록한다 | Geist SIL OFL 1.1 [지식], SUIT OFL-1.1 [검색: github.com/sun-typeface/SUIT] |
| 고정폭(ID, 경로, 도구 입출력, 코드) | `var(--helm-font-mono)` = `"Geist Mono", "SUIT", ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace`. Caustic `--cs-font-mono`에 한글 글꼴 "SUIT"를 더한 Helm 토큰 [제안] | Geist Mono Variable woff2 | SIL OFL 1.1 [지식] |

- 순서는 Caustic `--cs-font-ui`(소유자 결정 O3)를 따른다. 라틴 글자는 Geist, 한글은 Geist에 없으므로 SUIT로 넘어간다. 고정폭 안의 한글은 SUIT로 나오므로 칸이 맞지 않는다. 고정폭 블록은 대부분 도구 입출력(감사 깊이)이라 받아들인다.
- 글꼴은 `@font-face`로 앱 묶음에 넣는다. 원격 글꼴(CDN)을 쓰지 않는다. 오프라인에서도 같아야 하고, Tauri CSP를 좁게 두기 위해서다(20의 CSP와 맞춘다).
- `font-display: block`을 쓰지 않고 `swap`을 쓴다. 로컬 파일이라 깜박임은 첫 프레임에 그친다.
- `font-variant-numeric: tabular-nums`를 숫자 칸(시각, 개수, seq)에 쓴다.

타입 역할 [원문: Caustic 값] / [제안: Helm 용도와 추가 역할]:

| 역할 | 값(무게 크기/줄 높이) | 자간 | Helm 용도 |
|---|---|---|---|
| `title-1` | 600 26px/32px | 한국어 −0.01em | 화면 제목(드물게) |
| `title-2` | 600 20px/26px | 한국어 −0.01em | Concern·Goal 제목 |
| `title-3` | 600 15px/20px | 한국어 −0.01em | 카드 제목, 절 제목 |
| `title-4` | 600 13.5px/20px | −0.01em | 카드 안 소제목, 고정 표현 머리말("왜 지금인가") |
| `helm-reading` (Helm 추가) | 400 15px/24px | 0 | 복귀 요약 문장, 자극 본문, 초안 본문, 질문 문장. 한국어 문단 줄 높이 1.6 |
| `body` | 400 14px/21px | −0.003em | 일반 문단, 카드 본문(줄 높이 1.5) |
| `ui` / `ui-strong` | 400·500 13px/18px | −0.003em | 버튼, 메뉴, 한 줄 라벨. 여러 줄이 될 수 있는 한국어에는 쓰지 않는다 |
| `ui-sm` | 500 12px/18px | 0 | 배지, 칩 |
| `footnote` | 400 12px/16px | 0 | 메타 정보. 한국어가 들어가는 가장 작은 크기 |
| `label` / `caption` | 500 11.5px/14px, 500 11px/14px | 0, 한국어 +0.02em | 라틴·숫자만(ID, 단축키, 개수). 한글 금지 [제안] |
| `mono` / `mono-sm` | 400 12px/18px, 500 11px/16px | 0 | ID, seq, 경로, 도구 입출력 |

Caustic의 `display`, `voice`, `voice-sm`, `thought`는 쓰지 않는다. `thought`(기울임 사고 텍스트)는 원칙 UP-9와 맞지 않는다.

한국어 줄바꿈·조판 규칙(`apps/desktop/src/ui/styles/base.css`) [제안]:

```css
:root { font-family: var(--cs-font-ui); font-kerning: normal; }
:where(:lang(ko)) {
  word-break: keep-all;        /* 어절 단위 줄바꿈 */
  overflow-wrap: anywhere;     /* 공백 없는 긴 문자열(URL, ID, 경로)은 어디서든 끊는다 */
  line-break: strict;          /* 닫는 괄호·문장부호가 줄 머리에 오지 않게 */
  hyphens: manual;
}
:where(:lang(ko)) :is(p, li, dd, .helm-reading) { text-wrap: pretty; }   /* 지원하지 않는 엔진은 무시 */
:where(h1, h2, h3, .title-1, .title-2) { text-wrap: balance; }
:where(code, kbd, samp, .mono) { word-break: normal; overflow-wrap: anywhere; font-variant-ligatures: none; }
.helm-num { font-variant-numeric: tabular-nums; }
:lang(ko) :is(.title-1, .title-2, .title-3) { letter-spacing: -0.01em; }  /* Caustic base.css 52행과 같음 */
```

- 문서 루트에 `lang="ko"`를 둔다. 영어 고유 이름(Concern, Goal)이 섞여도 `lang`을 바꾸지 않는다. 사용자가 쓴 영어 문단(자극, 원문 인용)은 데몬이 주는 언어 정보가 있을 때만 `lang`을 붙인다.
- 한 줄 제목·라벨이 넘치면 말줄임(`text-overflow: ellipsis`)을 쓰되, 전체 문장은 `title` 속성이 아니라 툴팁 컴포넌트와 접근 가능한 이름으로 제공한다.
- 말줄임은 한 줄 라벨에만 쓴다. 질문 문장, 반대 근거, 판단 문장은 줄여서 자르지 않는다(UP-6).
- 숫자와 단위는 붙여 쓴다(`3건`, `12분 전`). 상대 시간과 정확한 시각을 함께 둔다(`TimeStamp`, §3.7.2).

#### 3.2.4 간격

Caustic `--cs-space-*`(4px 단위, 0~72px, 반 단계 1·2·3·5·6·7·9·10·14·18·26px) [원문]. Helm 사용 규칙 [제안]:

| 용도 | 기본 밀도 | 촘촘 밀도 |
|---|---|---|
| 카드 안쪽 여백 | 16px (`p-4`) | 12px (`p-3`) |
| 카드 사이 | 12px | 8px |
| 카드 안 항목 사이 | 8px | 6px |
| 절 사이 | 24px | 20px |
| 가운데 패널 좌우 여백 | 24px | 16px |
| 아이콘과 글자 사이 | 6px | 6px |
| 목록 행 높이 | 32px (`--cs-control-md`) | 28px |

#### 3.2.5 반경, 테두리, 그림자

| 대상 | 반경 | 테두리 | 그림자 |
|---|---|---|---|
| 버튼, 입력 | `radius-sm` 6px | 입력은 `border-control` 1px | 없음 |
| 배지, 칩 | `radius-xs` 4px (상태 배지), `radius-full` (개수 표시) | 없음 또는 1px | 없음 |
| 카드 | `radius-lg` 10px | N 카드 `--helm-n-border` 1px, 나머지 `border-default` 1px | 없음. 끌기 중에만 `shadow-3` |
| 팝오버, 메뉴, 툴팁 | `radius-md` 8px | `border-default` | `shadow-3` |
| 대화상자, 시트 | `radius-xl` 12px | `border-default` | `shadow-4` |
| 토스트 | `radius-md` 8px | `border-default` | `shadow-3` |

Caustic의 동심 반경 규칙(안쪽 반경 = 바깥 반경 − 여백)을 따른다 [원문: `FOUNDATION.md`].

#### 3.2.6 모션

| 토큰 | 값 | 용도 |
|---|---|---|
| `--cs-duration-instant` | 0ms | 감소 모션 설정일 때 모든 값 |
| `--cs-duration-quick` | 120ms | 호버, 눌림, 체크 |
| `--cs-duration-base` | 200ms | 펼침·접힘, 탭 전환, 팝오버 |
| `--cs-duration-gentle` | 320ms | 시트·서랍(인스펙터, 진행 실행 서랍) |
| `--cs-duration-slow` | 480ms | 쓰지 않음(예약) |
| `--cs-ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | 기본 |
| `--cs-ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | 들어오는 요소 |
| `--cs-ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | 나가는 요소 |

- 반복 애니메이션(스피너 회전, shimmer, orb)을 쓰지 않는다. 진행 중은 정적 글자("확인 중 · 3/7")와 막대로 표시한다. 예외: 사람이 방금 누른 버튼의 "보내는 중"은 120ms 뒤부터 정적 점 3개 표시(애니메이션 없음).
- 스트림으로 들어와 바뀐 항목은 깜박이지 않는다. "새로 바뀜" 점(`--helm-unseen-dot`)을 사람이 그 항목을 볼 때까지 둔다.
- `@media (prefers-reduced-motion: reduce)`에서 모든 duration을 0으로 덮는다.

#### 3.2.7 크기, z-index, 밀도

- 컨트롤 높이: Caustic `--cs-control-*`(기본 md 32px), 입력 `--cs-field-md` 40px, 촘촘 밀도에서 한 단계씩 낮아진다(md 28px, field 36px) [원문].
- 아이콘: 12/14/16(기본)/20/24px, 선 두께 1.75 [원문: Caustic 정책]. Helm은 16px를 기본, 배지 안 12px.
- 클릭 대상 최소 24×24px(`--cs-hit-min`). 목록 행은 행 전체가 클릭 대상이다.
- z-index: Caustic `--cs-z-*`(chrome 20, sticky 30, popover 40, dialog 60, toast 80, tooltip 90, palette 100) [원문].
- 밀도: `:root[data-density="regular" | "compact"]`. 기본 `regular`. 사용자 설정이며 20의 설정 저장소에 둔다.
- 글자 크기 배율: 사용자 설정 `100% | 112.5% | 125%`를 `:root { font-size }`가 아니라 웹뷰 확대(Tauri 창의 zoom)로 처리한다 [제안]. Caustic 토큰이 px 값이라 rem 배율이 적용되지 않기 때문이다. 확대 200%에서도 가로 스크롤 없이 쓸 수 있어야 한다(§3.3.4).

#### 3.2.8 토큰 파일과 생성

```text
apps/desktop/src/ui/tokens/
  caustic/caustic.tokens.css   Caustic 고정 사본(수정 금지)
  caustic/theme.css            Caustic Tailwind 4 @theme 고정 사본(수정 금지)
  caustic/SYNC.json            { causticCommit, files: { "<name>": "<sha256>" }, copiedAt }
  caustic/NOTICE.md            출처와 사용 허락
  helm.css                     Helm 의미 토큰(--helm-*), 라이트·다크
  theme.helm.css               Helm 토큰을 Tailwind @theme에 노출(--color-helm-*)
  tokens.ts                    TS에서 쓸 토큰 이름 상수(SVG 그리기용 CSS 변수 이름)
apps/desktop/src/ui/styles/
  app.css                      @import 순서: tailwindcss → caustic.tokens.css(layer base) → theme.css → helm.css → theme.helm.css → base.css → fonts.css
  base.css                     리셋 보완, 한국어 규칙, 타입 역할 클래스, 포커스 규칙
  fonts.css                    @font-face (로컬 파일)
```

```ts
// apps/desktop/src/ui/tokens/tokens.ts
export const cssVar = {
  textPrimary: 'var(--cs-color-text-primary)',
  textTertiary: 'var(--cs-color-text-tertiary)',
  borderSubtle: 'var(--cs-color-border-subtle)',
  borderStrong: 'var(--cs-color-border-strong)',
  accent: 'var(--cs-color-accent-solid)',
  warning: 'var(--cs-color-warning-text)',
  danger: 'var(--cs-color-danger-text)',
  success: 'var(--cs-color-success-text)',
  info: 'var(--cs-color-info-text)',
} as const;
export type CssVarName = keyof typeof cssVar;
```

SVG로 그리는 시각화(§3.8)는 색을 `cssVar`로만 받는다. JS에서 색 값을 계산하지 않는다.

#### 3.2.9 테마 전환과 고대비

- `:root[data-theme="light" | "dark"]`, 속성이 없으면 `prefers-color-scheme`를 따른다(Caustic 방식) [원문]. 설정값은 `system | light | dark`, 기본 `system`. 저장은 20.
- 앱 창 제목 표시줄 색은 Tauri 창 테마와 맞춘다(20).
- Windows 고대비(`forced-colors: active`): WebView2에서 강제 색이 적용된다 [지식]. 이때 배경으로 의미를 나타내는 표시(선택된 행, 반응 하이라이트)가 사라지므로 모든 경우에 테두리·밑줄·글자 표시가 함께 있어야 한다(UP-4가 이것을 보장한다). `@media (forced-colors: active)`에서 포커스 링을 `outline: 2px solid CanvasText`로 바꾼다.
- `prefers-contrast: more`에서 `border-default`, `border-subtle`을 `border-control`로 올린다.

### 3.3 레이아웃 그리드와 앱 셸

#### 3.3.1 셸 구성 [제안: 부품 / 03: 영역과 배치]

셸 영역의 이름과 배치는 03 §3.4.1(`RGN-*`)이 정한다. 이 문서는 영역마다 쓰는 부품과 시각 규칙을 정한다. 원천의 3단 셸(helm-canon-3 §6.5.1)을 03이 1인 데스크톱 앱에 맞게 줄인 것이다.

| 영역(03 §3.4.1) | 내용 | 부품 |
|---|---|---|
| `RGN-TOPBAR` | 앱 이름, 위치 경로, 명령 팔레트 입력, 연결 상태, 기준 시점 | `WindowHeader`, `ConnectionIndicator`, `FreshnessIndicator`, `PendingQuestionsIndicator` |
| `RGN-RAIL` | 최상위 내비게이션 일곱 항목(03 §3.5.2)과 사람 행동이 필요한 개수, 조건부 "복구" | `NavRail` |
| `RGN-BANNER` | 즉시 전달 질문, 연결 끊김, 복구 필요, 버전 불일치. 한 번에 하나, 나머지는 개수로 접음 | `Banner`, `DegradedBanner` |
| `RGN-STATUSLINE` | Concern 범위에서 Goal · Concern · 모드 · 지금 하는 일 · 맡긴 범위 · 다음 멈춤(helm-canon-2 §3.5 상태 표시줄) | `ScopeBar` |
| `RGN-MAIN` | 현재 화면 | 화면별(§3.11) |
| `RGN-INSPECTOR` | 선택한 객체의 출처, 근거, 작성자, 기준 시점, 관련 선택, 이의 기록. 기본으로 닫혀 있고 객체를 고르면 열린다 | `Inspector`, `EvidenceInspector` |
| `RGN-COMPOSER` | 현재 범위에 묶인 자연어 입력과 의미 미리보기. 범위를 입력창 앞에 항상 표시 | `ScopedComposer`, `SemanticPreview` |
| `RGN-RUNS` | 진행 중 서랍: WorkUnit마다 지금 하는 일, 다음 확인 시점, 마지막 의미 있는 변화, 예외. 토큰 스트림 없음 | `ActiveRunDrawer` |

부품과 데이터 연결(저장소 → VM)은 20의 `apps/desktop/src/shell/`이 하고, 이 문서의 `ui/shell/` 부품은 표현만 한다(20 §3.9.1).

#### 3.3.2 창 너비별 배치 [03 §3.4.2를 따름]

| 창 너비(CSS px) | 레일 | 인스펙터 | 비고 |
|---|---|---|---|
| ≥ 1280 | 펼침 232px | 열면 고정 표시 360px(320~520 조절) | 다섯 영역 모두 |
| 1024~1279 | 펼침 232px | 오른쪽 서랍(시트)으로 덮음 | |
| 760~1023 | 아이콘만 56px | 서랍 | |
| < 760 | 지원하지 않음. 최소 창 크기 760×560(03 §3.4.2, 20 §3.9.2) | | |

- 가운데의 읽기 열(복귀 요약, 질문 문장, 초안)은 최대 720px로 제한한다. 한국어 한 줄 45~50자 정도다 [제안]. 보드·표(자극 보드, 발산 표, 근거 체인)는 가운데 전체 너비를 쓴다. 자극 보드는 인스펙터를 닫고 연다(04 §3.9).
- 패널 너비 조절은 키보드로도 된다(구분선에 포커스 후 ←/→ 16px, Shift와 함께 64px) [제안].
- 인스펙터 고정 여부와 너비는 사용자 설정(20 저장).

#### 3.3.3 가운데 영역 격자

- 카드 목록: 1열 쌓기. 카드 사이 12px(촘촘 8px).
- 보드: `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`, 간격 12px. 자극 카드 최소 280px.
- 표: 가로 스크롤을 허용하되 첫 열 고정(`position: sticky`).
- 화면 머리(제목 + 화면 수준 행동)는 스크롤해도 위에 고정(`--cs-z-sticky`).

#### 3.3.4 확대와 작은 창

- 웹뷰 확대 200%에서 1280px 창은 CSS 너비 640px가 되어 760px 하한보다 좁다. 이때도 깨지지 않도록 760px 미만 CSS 너비에서는 레일 아이콘, 인스펙터 전체 너비 시트, 가운데 1열로 바꾸고 가로 스크롤은 표 안에서만 허용한다(WCAG 1.4.10 리플로우 [지식]). 창 최소 크기는 물리 크기 기준이라 확대와 별개다
- 그래서 §3.3.2의 기준은 창의 물리 너비가 아니라 CSS 너비(`window.innerWidth`)로 판정한다. 컨테이너 쿼리(`@container`)를 쓰면 패널 안 배치를 패널 너비로 바꿀 수 있다. 지원 범위는 §2.5.7의 웹뷰 기준에 따른다.

### 3.4 아이콘 [제안]

lucide-react를 쓴다(§2.5.4). 선 두께 1.75, 기본 16px. 아이콘은 혼자 의미를 지지 않는다. 글자 라벨과 함께 쓰거나, 아이콘만 있는 버튼에는 접근 가능한 이름과 툴팁을 둔다.

Helm 의미 아이콘 표(이름은 lucide 아이콘 이름. 고정한 lucide 버전에서 존재를 타입 검사로 확인한다):

| 의미 | 아이콘 | 의미 | 아이콘 |
|---|---|---|---|
| Goal | `Target` | Concern | `Focus` |
| 관찰 | `Eye` | 해석 | `Lightbulb` |
| 가능성 | `Split` | 판단 | `Scale` |
| 선택 | `Signpost` | 질문 | `CircleHelp` |
| 전제(가정) | `Pin` | 아직 모르는 점 | `CircleDashed` |
| 작업 합의 | `Handshake` | 결과 제출 | `PackageCheck` |
| 결과 확인 | `BadgeCheck` | 전체 반영 | `Layers` |
| 근거(지지) | `CirclePlus` | 반대 근거 | `CircleMinus` |
| 한정 | `Brackets` | 무효화 | `Ban` |
| 자극 | `Shapes` | 이유 없는 반응 | `Asterisk` |
| 파일 변경 | `FileDiff` | 실행·도구 | `Terminal` |
| 외부 상태·응답 | `Globe` | 권한 레이어 출처 | `ShieldCheck` |
| 최신 | `CircleCheck` | 낡음 | `History` |
| 다시 받는 중 | `RefreshCw`(회전 금지) | 실패 | `CircleX` |
| 연결됨 | `Wifi` | 끊김 | `WifiOff` |
| 사람 | `User` | 에이전트(역할 공통) | `Cpu` |
| 런타임·커널 | `Cog` | 스케줄러·만료점 | `Timer` |

루프(O, I, C, A, S)는 아이콘 대신 글자 칩(`LoopChip`)으로 쓴다. 아이콘으로는 다섯 루프와 변형(I.want, C.probe 등)을 구분하기 어렵다.

### 3.5 Helm 시각 문법

#### 3.5.1 N / E / M [제안]

| 세계 | 묻는 것 | 모양 | 아이콘 | 라벨(05가 확정) |
|---|---|---|---|---|
| N 방향 | 무엇을 하기로 했고 누가 받아들였나 | 카드 전체 실선 테두리 1px(`--helm-n-border`), 받아들여진 것은 제목 앞에 `BadgeCheck` | 레코드 종류 아이콘 | "방향" |
| E 이해 | 무엇을 알고 무엇을 의심하나 | 테두리 없이 왼쪽 선 2px. 관찰 점선, 추측 파선, 판단 실선 | 레코드 종류 아이콘 | "이해" |
| M 실제 변화 | 실제로 무엇이 바뀌었나 | 안쪽 면(`--helm-m-surface`), 첫 줄에 관찰 시각과 출처(파일@해시, 실행 id) | `FileDiff`, `Terminal`, `Globe` | "실제 변화" |

- 세 세계를 다른 탭으로 완전히 나누지 않는다. Concern 화면은 한 목록 안에서 세 세계의 레코드를 관계로 잇는다(helm-canon §17.2 "하나의 초점 안에서 연결").
- "방향/이해/실제 변화" 라벨은 개발자용 표시가 아니라 사용자 라벨이다(helm-canon §17.2). N/E/M 기호는 감사 깊이에서만 보조로 쓴다.

#### 3.5.2 레코드 종류 표시 [제안]

`KindLabel`이 그린다. 라벨은 글자 + 아이콘. 대화 영역 라벨 7종(helm-canon-2 §3.5)은 다음으로 옮긴다.

| 레코드 종류(08 이름 가정) | 화면 라벨(자리 표시) | 세계 | 원천 대화 라벨 |
|---|---|---|---|
| `observation` | 관찰 | E | Observed |
| `interpretation` | 해석(추측) | E | Possible |
| `possibility` | 가능성(추측) | E | Possible |
| `finding` | 판단 | E | — |
| `assumption` | 전제 | E | — |
| `open_question` | 아직 모르는 점 | E | — |
| `question` | 질문 | N/E | Choice |
| `choice` | 선택 | N | Choice |
| `agreement` | 작업 합의 | N | Working(합의 반향) |
| `criterion` | 완료 기준 | N | — |
| `outcome_submission` | 결과 제출 | N | Review |
| `acceptance` | 결과 확인 | N | Review |
| `integration_obligation` | 전체 반영 항목 | N | Review |
| `preference_model` | 선호 모델 | N | — |
| `prediction` | 예측 | E | — |
| `expectation` | 기대(응답 기다림) | N | — |
| `loop_transition` | 루프 전환 | E | Working |
| `situation_assessment` | 상황 판정 | E | — |
| `probe` | 탐침 | N | Working |
| `stimulus` | 자극 | M | — |
| `tool_call`·`run` | 실행 기록 | M | Source |
| 에이전트 설명 문장 | 설명 | — | Helm |

- "판단"은 Finding만 가리킨다(브리프 §6). 승격 전 해석·가능성은 "추측"으로 묶어 부르되 라벨은 둘을 구분한다(불변조건 2).
- 대화 스레드 안의 에이전트 문장은 "설명"으로 표시하고 레코드가 아니다. 문장 안에서 레코드를 언급하면 레코드 칩으로 링크한다.

#### 3.5.3 품질 배지 [03 §3.3.6 값 / 제안: 표시 방식]

배지 값과 라벨은 03 §3.3.6, 뷰 모델의 값은 04 §3.0.2 `QualityBadge`(`insufficient | contested | stale | superseded`)다. `QualityBadge` 부품이 그린다. 단계 라벨(관찰·해석·가능성·판단)과 품질 배지는 다른 칸에 그린다(03 §3.3.6).

| 값 | 라벨(03) | 표시 방식 |
|---|---|---|
| `insufficient` | 근거 부족 | 추측 단계에만 붙는다. 회색 배지 + 한 줄 문장 |
| (`qualified`, `accepted`) | 배지 없음 | 판단으로 보인다 |
| `contested` | 이의 걸림 | 모든 깊이에서 보인다. 배지 + 한 줄("이의: …"). 접지 않는다 |
| `stale` | 낡음 | 모든 깊이에서 보인다. 배지 + 이유(`staleBecause`, 예 "근거 파일이 바뀜 · 해시 a1b2→c3d4") |
| `superseded` | 대체됨 | 대체한 레코드 링크. 본문은 흐리게 하지 않고 라벨로만 표시 |

- 배지만 있고 이유가 없는 `contested`·`stale`은 그리지 않는다. 이유가 비어 오면 "이유 없음(데이터 이상)"으로 쓰고 감사 깊이 링크를 둔다.
- 원천의 배지 중 `inferred`(추론됨), `policy-approved`(규칙으로 허용됨), `agent-generated`·`human-authored`·`policy-derived`(helm-canon-3 §6.9.1)는 품질 배지가 아니라 작성자 표시(§3.5.5)로 그린다. `inferred`는 "에이전트 추론"으로, `policy-approved`는 "규칙에 따라"로 옮긴다.
- 같은 모델·같은 컨텍스트 계열 근거(`StatementView.sameSourceFamily`, 04 §3.0.2)에는 "같은 출처 계열" 표시를 붙인다(03 §3.3.6, canon §8.9 원칙 7).

#### 3.5.4 상태 라벨 집합 [03 §3.3 값]

상태 라벨의 값과 문구는 03 §3.3이 정본이다(진행 작업 §3.3.2, Concern §3.3.3, 선택 §3.3.4, 질문 §3.3.5, 루프·상황 유형 §3.3.7). 컴포넌트는 상태 값을 받아 `copy/labels.ts`(03 표를 옮긴 것)로 그린다. 같은 상태를 화면마다 다른 말로 쓰지 않는다(helm-canon §17.2 원칙 5).

`StatusLabel`의 집합(`set`): `work`(03 §3.3.2, `interrupted` 포함), `concern`(§3.3.3), `choice`(§3.3.4), `question`(§3.3.5), `loop`(§3.3.7), `situation`(§3.3.7). product-language의 choice 상태 7종은 화면에서 쓰지 않는다(03 §3.3.1).

- "완료"는 `integrated`이고 반영 항목이 모두 처리·이관된 경우에만 단독으로 쓴다(03 §3.3.2). 그 전에는 `WholeUpdateBadge`가 "결과 확인됨 · 반영 n개 남음" 또는 "결과 확인됨 · 반영 미룸 n개"로 그린다(helm-canon-2 §3.12).
- 상태 라벨은 글자 + 모양(점·테두리)으로 그린다. 색은 보조다. 예: `blocked`(막힘)는 경고 색 글자와 `TriangleAlert` 아이콘, `interrupted`(중단됨(재시작))는 복구 화면 링크를 함께 둔다.

#### 3.5.5 작성자와 행위자 표시 [제안]

| 작성자 | 표시 | 컴포넌트 |
|---|---|---|
| 사람(소유자) | 기본값이라 따로 표시하지 않는다. 검토 깊이에서 "내가 정함" | `AuthorshipMark` |
| 에이전트 제안·초안 | 파선 테두리(`--helm-draft-border`) + "초안" 또는 "에이전트 제안" + 역할(`작업`, `검증`, `중재`, `관찰`) | `DraftMark`, `ActorLabel` |
| 에이전트가 정함(혼자 정한 결정) | "에이전트가 정함" + 묻지 않은 이유 한 줄 + 이의 행동 | `AutonomousChoiceItem` |
| 규칙(정책) | "규칙에 따라" + 규칙 이름 링크 | `AuthorshipMark` |
| 에이전트 추론(원천 `inferred`) | "에이전트 추론" + 역할. 기준 후보, 상황 판정처럼 모델이 추론한 값 | `AuthorshipMark` |
| 런타임·도구 | "실행 결과" + 도구 이름 | `SourceTrace` |
| 외부 | "외부 응답" + 출처 이름 | `SourceTrace` |

- "에이전트가 결정했습니다" 같은 문장을 쓰지 않는다. 혼자 정한 결정은 "맡긴 범위 안에서 에이전트가 정함", 추천은 "에이전트 추천"으로 쓴다(helm-canon §17.6 §7).
- 행위자 표시에 아바타, 사람 이름, 성격 표현을 쓰지 않는다(UP-9). `ActorLabel`은 `role`과 `assignment`(맡긴 일)만 받는다.

#### 3.5.6 확실성 표현 [제안]

`CertaintyDescriptor`가 숫자 확률 대신 네 칸을 그린다(helm-canon-3 §6.6.6, C4).

| 칸 | 값 | 예 |
|---|---|---|
| 직접성 | `direct`(직접 관찰) / `indirect`(다른 관찰에서 추론) / `none`(근거 없음) | "직접 확인: 측정 2회" |
| 반대 근거 확인 | `searched_none`(찾아봤는데 없음) / `found`(남은 반대 근거 있음) / `not_searched`(찾아보지 않음) / `searching` | "반대 근거를 찾아봤지만 없었음" |
| 확인하지 못한 범위 | 문장 목록 | "모바일 환경은 확인하지 못함" |
| 다음 확인 | 문장 하나(불확실성을 가장 줄일 확인) | "모바일 재현 테스트" |

- 근거 개수로 강도를 표시하지 않는다(helm-canon §8.3 원천). 근거 목록은 펼쳐 볼 수 있으나 "근거 3개" 같은 요약 숫자를 강도처럼 크게 쓰지 않는다. 반대 근거는 "남은 반대 근거 1건"처럼 개수를 쓴다. 남은 반대 근거가 있다는 사실 자체가 정보이기 때문이다.
- 레코드에 숫자 `confidence`가 있어도(v0.3 04 §3.4 선호 모델 예) 한눈에·검토 깊이에서 그리지 않는다. 감사 깊이의 원본 레코드 보기에서만 원본 필드로 보인다. 숫자를 둘지는 08·15가 정한다.
- `none`(근거 없음)인 가능성은 근거 있는 가능성과 다른 묶음에 둔다(v0.3 04 §4.4).

#### 3.5.7 세 깊이 [제안]

| 깊이 | 한국어 | 보이는 것 | 기본 위치 |
|---|---|---|---|
| `glance` | 한눈에 | 지금 중요한 차이와 행동. 카드 한 장에 3~6줄 | 홈, 질문함 목록, 진행 실행 서랍 |
| `review` | 검토 | 기준, 근거, 반대 근거, 결과, 예상 경로 | 카드 펼침, Concern 화면, 결과 확인 |
| `audit` | 감사 | 원본 이벤트, seq, 도구 입출력, 출처, 레코드 id, 원본 필드 | 인스펙터의 "원본" 탭, 변화 기록 |

- 모든 복합 컴포넌트는 `depth` prop을 받고, 깊이를 올리는 행동(펼치기, 인스펙터 열기)을 제공한다.
- 깊이와 상관없이 항상 보이는 것: 반대 근거가 있다는 사실, 이의, 낡음, 권리 게이트 질문, 확인하지 못한 범위가 있다는 사실(UP-6).
- 감사 깊이를 연 횟수는 원천의 "raw-log fallback" 지표 후보다(helm-canon-3 §6.14). 수집 여부는 16이 정한다(§5.2).

#### 3.5.8 신선도와 기준 시점 [04 §3.0.4·20 §3.9.8 상태 / 제안: 부품]

신선도에는 두 출처가 있다. 데몬이 뷰에 붙이는 `ViewMeta.freshness`(04 §3.0.2, 19 `ViewResult.freshness`: `current | stale | rebuilding | failed`)와, 앱이 연결 상태와 캐시로 계산하는 클라이언트 신선도(20 §3.9.8: `current | refreshing | stale | missing | failed`)다. 부품은 둘을 함께 받는다.

```ts
// apps/desktop/src/ui/model/freshness.ts
import type { ViewMeta } from '@helm/protocol';          // 04 §3.0.2 (sourceSeq = 19 asOfSeq)
export type ClientFreshness = 'current' | 'refreshing' | 'stale' | 'missing' | 'failed';   // 20 §3.9.8
export interface ProjectionMeta {
  view: ViewMeta;                 // sourceSeq, generatedAt, freshness, staleReason, omitted
  client: ClientFreshness;
  /** 클라이언트가 마지막으로 받은 시각. "14:02 기준" 문구에 쓴다 */
  receivedAt: string;
  /** 사람이 "확인함"을 누른 seq. 복귀 요약의 기준 (helm-canon-2 §3.10) */
  acknowledgedSeq?: number;
}
/** 결정 버튼을 켤 수 있는가: 연결 live(느림 포함) + 클라이언트 current + 뷰 current (04 §3.0.4, 20 §3.9.7) */
export function decisionsAllowed(conn: ConnectionUiState, m: ProjectionMeta): boolean;
```

| 경우 | 화면 표시(문구는 04 §3.0.4·05) | 결정 행동 |
|---|---|---|
| 모두 `current` | 창 머리에 작은 `CircleCheck` + "방금 갱신". 개발자 보기(`devView`, 20 §3.9.11)에서만 seq 숫자 | 가능 |
| `refreshing` | 이전 데이터 그대로, 1초 넘으면 작은 진행 표시 | 가능하지 않음(1초 미만이면 버튼 상태 변화 없이 대기) |
| `rebuilding`(데몬) | 띠 "다시 맞추는 중" | 막음(짧음) |
| `stale`(어느 쪽이든) | 화면 머리 띠 "이 화면은 14:02 기준입니다 · 이유". "지금 하는 일" 같은 현재 시제 문구를 "14:02에 하던 일"로 바꾼다(04 §3.0.4 규칙 2) | 막음. 이유와 "쓰던 답은 저장해 두었습니다"를 버튼에 붙임 |
| `missing` | 빈 상태 "연결되면 볼 수 있습니다" | 없음 |
| `failed` | 오류 상태 + "다시 시도" | 막음 |
| `omitted`가 있음 | 목록 끝에 "보이지 않은 항목: 실행 기록 14건(정상 반복)" 줄. 펼치면 감사 깊이 | — |

낡은 화면을 흐리게(투명도) 만들지 않는다. 글자 대비가 떨어지고 "읽을 수 없음"으로 오해된다. 띠와 문장으로 알린다 [제안].

### 3.6 컴포넌트 공통 계약 [제안]

#### 3.6.1 부품 파일과 코드 규칙

부품 하나는 폴더 하나다. Caustic의 부품 구성을 따른다(§2.4.2).

```text
<Name>/
  <Name>.tsx          컴포넌트. DOM 루트는 forwardRef로 감싼다
  <Name>.variants.ts  cva 변형(있을 때)
  <Name>.text.ts      선형 텍스트 표현 toLinearText(vm) (복합 부품만, §3.6.6)
  <Name>.stories.tsx  상태별 이야기(§6.3). 이야기 이름 = 상태 이름
  <Name>.test.tsx     동작·접근성 테스트
  index.ts            공개 내보내기
```

- DOM 루트에 `data-slot="<name>"`을 둔다(테스트와 스타일 훅).
- React 18 API만 쓴다. `use()`, `<Context value>` 공급자, ref-as-prop, `useActionState`, `useOptimistic`, 폼 action을 쓰지 않는다. ref가 필요한 부품은 `forwardRef`를 쓴다.
- 부품은 데이터 가져오기, 프로토콜 호출, 앱 저장소 접근을 하지 않는다. 입력은 VM(뷰 모델) props, 출력은 콜백(`onIntent`, `onNavigate`, 표시 상태 콜백)뿐이다. 저장소와 VM을 잇는 일은 화면 컨테이너(20 소유)가 한다.
- 부품 안에 도메인 판정을 넣지 않는다. 예: 질문이 권리 게이트인지, 만료점이 가까운지, 근거가 낡았는지는 VM이 값으로 준다. 부품은 그 값을 그린다(결정 14·32).
- 시각, 개수, 문구 조합은 부품이 계산해도 된다(표시 계산). 정렬 순서는 VM이 준 순서를 지킨다(대비 압축 순서는 데몬이 정한다, v0.3 04 §8).

#### 3.6.2 VM 타입: 04 뷰 모델을 쓴다

화면 데이터의 정본 타입은 04의 뷰 모델(04 §3.0.2 공통 타입과 각 화면 절의 `*View`)이고, 19가 `view.get`의 `data`로 보낸다(19 §3.6.3). 이 타입들은 `@helm/protocol`에 있다(19·06). UI 부품은 이 타입을 그대로 받거나, 그 일부(`Pick`, 배열 원소)를 받는다. UI가 같은 뜻의 타입을 다시 정의하지 않는다.

UI만의 타입은 다음뿐이다.

```ts
// apps/desktop/src/ui/model/common.ts
export type {
  RecordRef, RecordKind, Author, ViewMeta, Freshness, QualityBadge, StatementView,
  Gate, Delivery, QuestionScreenKind, ExpiryPoint, QuestionSummary, CommandIntentBase,
} from '@helm/protocol';                    // 04 §3.0.2
// 화면별 뷰 모델(HomeView, BriefView, InboxView, QuestionView, AutonomousView, ConcernNode, ConcernView, ActiveWorkCard,
// InquiryView, PreferenceModelView, StimulusRoundView, ReactionView, AgreementView, ReviewView, LoopTimelineView,
// EvidenceChainView, GoalView, DialsView, ObserverProposalsView, RecoveryView)도 같은 곳에서 가져온다 (04 각 화면 절)

/** `<prefix>_<ULID>` (브리프 §3.2), ISO 8601 UTC (브리프 §3.3) */
export type Id = string;
export type IsoTime = string;
/** 03 §3.6의 화면 ID (`SCR-*`, `OVL-*`) */
export type ScreenId = `SCR-${string}` | `OVL-${string}`;
/** 세 깊이 (§3.5.7) */
export type Depth = 'glance' | 'review' | 'audit';
/** 세 세계 (§3.5.1). 뷰 모델에 없으면 RecordKind에서 표로 정한다(ui/model/world.ts) */
export type World = 'N' | 'E' | 'M';

/** 사용자용 연결 상태 (04 §3.0.4의 아홉 상태). 20의 ConnState에서 20이 만든다 */
export type ConnectionUiState =
  | 'connected' | 'slow' | 'reconnecting' | 'disconnected' | 'daemon_unresponsive'
  | 'auth_failed' | 'version_mismatch' | 'recovery_mode' | 'resyncing';

/** 레코드 칩에 붙일 수 있는 화면 표시 정보. 모두 선택 항목이라 04 RecordRef를 그대로 넘겨도 된다 */
export interface RecordChipExtras {
  badges?: QualityBadge[];
  authoredBy?: Author;
  autonomous?: boolean;
  unseen?: boolean;            // 사람이 아직 보지 않은 변화 (04에 요구, §5.2)
  at?: string;
}
```

이 문서의 다른 절에 있는 TS 블록에서 `ActorRef`는 04의 `Author`, `RecordRef`는 04의 `RecordRef`(+ `RecordChipExtras`)를 뜻한다. 부품 props 초안(§3.7.3, §3.8)에 있는 뷰 모델 모양의 타입은 04 타입이 정해지기 전에 쓴 것이며, 아래 대응표대로 04 타입으로 바꾼다. 두 쪽이 다르면 04가 우선이고, 부품이 더 필요로 하는 필드는 §5.2에서 04에 요구한다.

| 부품 | 받는 04 뷰 모델 |
|---|---|
| `SinceLastVisit` | `BriefView`(04 §3.2) |
| `GoalSummary` | `HomeView.goals[]`, `GoalView` |
| `ConcernTree` | `ConcernNode[]`(04 §3.1) |
| `ActiveWorkCard` | `ActiveWorkCard`(04 §3.1, 같은 이름의 타입) |
| `QuestionCard`(접힘) / (펼침) | `QuestionSummary` / `QuestionView['q']`(04 §3.4) |
| `QuestionInbox` | `InboxView`(04 §3.3) |
| `ChoiceImpactEcho` | 명령 결과의 `impact`(19 `CommandResult`) |
| `AutonomousChoiceList` | `AutonomousView`(04 §3.5) |
| `ScopeBar`, Concern 머리 | `ConcernView.statusLine`, `ConcernView.situation`, `ConcernView.loopPlan` |
| `HypothesisBoard`, `DivergenceTable`, `PossibilityComparison`, `PredictionList`, `PreferenceModelPanel` | `InquiryView.fact/possibility/outcome/want`, `PreferenceModelView`(04 §3.8) |
| `StimulusBoard` | `StimulusRoundView`, `ReactionView`(04 §3.9) |
| `WorkAgreementDraft`·`WorkAgreementEcho` | `AgreementView`(04 §3.11) |
| `ResultReviewPanel` | `ReviewView`(04 §3.12) |
| `LoopTimeline`, `LoopPlanStrip` | `LoopTimelineView`(04 §3.13), `ConcernView.loopPlan` |
| `EvidenceChainTree`, `EvidenceInspector` | `EvidenceChainView`(04 §3.15) |
| `GoalHistory` | `GoalView`(04 §3.16) |
| `DialPanel` | `DialsView`(04 §3.17) |
| `ObserverProposalCard` | `ObserverProposalsView.proposals[]`(04 §3.18) |
| `RecoveryList` | `RecoveryView`(04 §3.20) |
| `ConnectionIndicator` | `ConnectionUiState` + 20 연결 정보 |
| `MetricTile` | 16 §3.24의 지표 값(평가 화면) |

#### 3.6.3 의도(`UiIntent`)

부품은 사람의 조작을 `UiIntent`로 올린다. 의도의 이름과 인자는 19의 명령 메서드(19 §3.7.5 표)를 그대로 쓴다. UI가 따로 이름을 만들지 않는다. 메서드 → 커널 명령 대응은 19가, 의도 → `useCommand` 호출은 20이 한다(20 §3.9.7).

```ts
// apps/desktop/src/ui/model/intent.ts
import type { CommandMethod, CommandParams } from '@helm/protocol';   // 19
export interface IntentBase {
  /** 20이 만든 멱등 키(ik_ULID). 같은 조작의 재전송은 같은 값 (19·20) */
  intentId: string;
  /** 사람이 보고 결정한 뷰의 sourceSeq (04 CommandIntentBase, UI-D02) */
  basisSeq: number;
}
export type UiIntent<M extends CommandMethod = CommandMethod> = IntentBase & { method: M; params: CommandParams<M> };
```

부품별로 내는 의도(메서드 이름은 19 §3.7.5):

| 부품 | 메서드 |
|---|---|
| `QuestionCard`, `QuestionInbox` | `question.answer`, `question.proceedWithAssumption`, `question.requestReframe`, `question.requestInquiry`, `question.delegate`, `question.defer` |
| `ContestButton`(`OVL-CONTEST`) | `contest.file` |
| `AutonomousChoiceList` | `autonomous.markSeen`, `contest.file` |
| `StimulusBoard` | `reaction.record`, `reaction.amend`, `reaction.withdraw`, `stimulusRound.close` |
| `PreferenceModelPanel` | 기준 확인은 질문(`question.answer`)으로 |
| `WorkAgreementDraft` | `agreement.confirm`, `agreement.revise`, `agreement.narrow`, `agreement.decline`, `agreement.correctUnderstanding` |
| `ResultReviewPanel` | `result.accept`, `result.acceptWithConditions`, `result.requestRevision`, `result.reopen`, `obligation.confirmDone`, `obligation.defer`, `obligation.transfer` |
| `GoalHistory` | `goal.revise`, `goal.confirmRevision`, `goal.rejectRevision`, `goal.confirmAchieved` |
| Concern 머리 | `concern.revise`, `concern.hold`, `concern.resume`, `concern.close`, `loop.requestTransition`, `structure.request` |
| `HypothesisBoard` 등 탐구 보드 | `inquiry.requestFrame`, `inquiry.proposeCandidate`, `inquiry.markAssumption`, `inquiry.pinCheck`, `inquiry.requestDecision`, `inquiry.stop` |
| `DialPanel` | `dial.set`, `dial.unset`, `mode.set` |
| `ActiveWorkCard`, `ActiveRunDrawer` | `work.steer`, `work.pause`, `work.resume`, `work.stop`, `work.abort`, `work.requestBrief` |
| `ScopedComposer`, `ConversationThread` | `composer.submit` |
| `SinceLastVisit` | `brief.acknowledge`, `brief.correct` |
| `RecoveryList` | `recovery.resolve` |
| `ObserverProposalCard` | `observerProposal.adopt`, `observerProposal.decline`, `observerProposal.snooze` |

탐색·표시 상태(펼침, 인스펙터 열기, 화면 이동)는 `UiIntent`가 아니라 `onNavigate`, `onExpandedChange` 같은 콜백으로 올린다. 화면 열람 기록(`view.opened`, 16 §3.24)은 부품이 아니라 화면 컨테이너(20)가 보낸다.

결정 버튼 규칙:

- 결정 의도를 보내는 버튼은 `ActionButton`만 쓴다. `ActionButton`은 `consequence` prop이 있으면 버튼 문구 아래나 옆에 대상과 효과를 쓴다(예: "1·2절만 김OO에게 보내기", 04 §3.4 `OptionView.actionLabel`). `tone="danger"` 또는 권리 게이트 버튼은 `consequence`가 없으면 개발 모드에서 오류를 던진다(UP-11).
- 한 카드 안에 "예/아니오" 두 버튼만 있는 배치를 만들지 않는다. 대안 행동(기준 고치기, 질문 다시 쓰기, 먼저 탐구, 미루기, 이의)을 같은 카드의 "그 밖에" 줄로 항상 보인다(§3.9 R2, 04 §3.4).

#### 3.6.4 행동 수명주기와 낙관적 갱신 금지

`ActionButton`의 상태는 20의 `useCommand` 상태(20 §3.9.7: `idle | sending | waiting_reconnect | done | rejected | failed`)를 그린다. 상태 변화는 데몬 응답과 뷰 갱신만 일으킨다(UI-D03).

| 상태 | 이벤트 | 다음 상태 | 가드 | 부수 효과·표시 |
|---|---|---|---|---|
| `idle` | 누름 | `sending` | `decisionsAllowed(conn, meta)` 참(§3.5.8) | `onIntent(intent)`. 버튼 "보내는 중"(정적 점 3개), 같은 버튼 다시 누를 수 없음 |
| `idle` | (가드 거짓) | `idle` | — | 버튼 비활성 + 이유 툴팁. 연결 문제면 "연결되면 보낼 수 있습니다. 쓰던 답은 저장해 두었습니다"(04 §3.0.4) |
| `sending` | 응답 성공 | `done` | — | "적용됨" 문장 2초(04 §3.0.6). 카드의 도메인 상태는 아직 바꾸지 않는다 |
| `done` | 뷰 갱신에 결과 반영 | (부품이 다시 그려짐) | — | 카드가 사라지면 다음 카드로 포커스(§3.6.5). 결과 영향은 `ChoiceImpactEcho` |
| `sending` | 거부: 낡은 기준(`stale_basis`) | `rejected` | — | 카드 위 띠 "화면을 연 뒤 상황이 바뀌어 이 답을 적용하지 않았습니다" + 바뀐 항목 강조 + 쓰던 답 유지(04 §3.0.5) |
| `sending` | 거부: 내용·자격·경로 | `rejected` | — | 거부 종류별 문장(04 §3.0.6 표, 05) |
| `sending` | 10초 동안 응답 없음 | `sending` | — | "서버가 아직 답하지 않았습니다. 연결 상태를 확인하는 중입니다"(04 §3.0.6) |
| `sending` | 연결 끊김·시간 초과 | `waiting_reconnect` | — | "연결되면 이어서 보냅니다". 20이 재접속 뒤 같은 멱등 키로 다시 보낸다(20 §3.9.7) |
| `waiting_reconnect` | 재전송 결과 | `done` 또는 `rejected` | — | 위와 같음 |
| `waiting_reconnect` | 24시간 지남 | `failed` | — | "보내지 못한 조작"으로 `SCR-CONNECT` 목록에 남음(20) |
| `rejected`, `failed` | 닫기 | `idle` | — | — |

- 화면은 사람이 누른 결과를 미리 그리지 않는다. 예: "결과 확인"을 눌러도 상태 라벨은 뷰가 `accepted`를 보낼 때 바뀐다.
- 연결이 없을 때 새 결정을 받아 쌓아 두지 않는다(04 ADR A4, 20 §3.9.7). 입력하던 글은 초안으로 보존한다(보존 위치는 20). 이미 보낸 뒤 끊긴 조작의 재전송만 20이 한다.
- 예외: 자극 반응은 사람의 결정이 아니라 관찰이므로, 연결이 끊겨도 입력을 받아 "보내지 않음"으로 기기에 두고 다시 연결되면 사람이 "보내기"를 누른다(04 §3.9). `StimulusBoard`가 이 상태를 그린다.

#### 3.6.5 키보드, 포커스, IME

- 모든 기능은 키보드로 된다. 마우스 경로도 모두 있다(helm-canon-3 §6.11).
- 포커스 표시: 텍스트 입력은 Caustic `focus-field`(안쪽 1.5px), 그 밖은 `focus-ring`(바깥 2px) [원문: Caustic]. `:focus-visible`에서만 그린다.
- 목록·트리·보드는 로빙 tabindex를 쓴다. 목록 전체가 Tab 한 번, 안에서는 화살표.
- 카드가 결정으로 사라지면 포커스를 같은 목록의 다음 카드로, 없으면 목록 머리로 옮긴다. 포커스를 잃어 `body`로 가지 않게 한다.
- 대화상자·시트는 포커스를 가두고, 닫으면 연 요소로 돌려준다(Radix 기본).
- 한 글자 단축키는 이동·펼침, 관찰(자극 반응, 봤음), 대화상자 열기에만 쓴다. 결정 의도는 포커스된 버튼의 Enter/Space로만 보낸다 [제안]. 실수로 결정이 나가지 않게 하기 위해서다.
- **IME**: 모든 텍스트 입력 부품은 Enter 제출 전에 조합 중인지 검사한다.

```ts
// apps/desktop/src/ui/lib/ime.ts
export function isImeComposing(e: React.KeyboardEvent): boolean {
  // Safari(WKWebView)는 조합을 끝내는 Enter의 keydown에서 isComposing=false, keyCode=229를 준다 [지식]
  return e.nativeEvent.isComposing || e.keyCode === 229;
}
```

  제출 키: 한 줄 입력은 Enter, 여러 줄 입력(Composer, 이의 사유)은 ⌘Enter(Windows Ctrl+Enter), Enter는 줄바꿈. 이 규칙은 05의 키보드 절과 맞춘다.

#### 3.6.6 선형 텍스트 표현

복합 부품(§3.7.3, §3.8)은 `toLinearText(vm, depth): string`을 함께 낸다.

- 용도: (1) 스크린 리더 요약(`aria-describedby`로 연결한 숨긴 요약), (2) "텍스트로 복사", (3) 골든 테스트(§6.3), (4) TUI가 같은 정보를 보이는지 대조하는 기준.
- 규칙: 한 줄에 한 사실. 라벨을 앞에 둔다("반대 근거: …"). 색·아이콘에만 있던 정보가 모두 글자로 들어간다. 80자 폭에서 의미가 끊기지 않는다.
- 예(`QuestionCard`, 한눈에 깊이):

```text
[선택 필요 · 권리 게이트] 초안을 외부 리뷰어에게 보내도 될까요?
왜 지금: 리뷰 마감이 내일 10시입니다
추천: 1절만 먼저 보내기 (에이전트 추천)
가장 강한 다른 선택: 전체를 보내기
임시 가정: 보내지 않고 대기 · 만료점: 내일 09:00 (14시간 뒤)
행동: 추천대로 진행 | 다른 선택 | 범위 줄이기 | 조건까지 미루기 | 질문에 이의
기준: seq 1234 (3분 전)
```

#### 3.6.7 문구 키

부품 안의 고정 문구는 `copy` 모듈의 키로 쓴다. 정본 문장은 05가 정한다. 1차 구현은 i18n 라이브러리 없이 타입 있는 사전으로 둔다(UI 언어가 한국어 하나, 결정 37).

```ts
// apps/desktop/src/ui/copy/ko.ts  (문장은 05 확정 전 자리 표시)
export const ko = {
  'question.section.whyNow': '왜 지금인가',
  'question.section.recommendation': '추천',
  'question.section.strongestAlternative': '가장 강한 다른 선택',
  'question.section.unknowns': '아직 모르는 점',
  'question.section.reversibility': '되돌릴 수 있나',
  'question.section.reviewTrigger': '다시 볼 조건',
  'question.assumption': '임시 가정',
  'question.expiry': '가정 만료점',
  'brief.section.changed': '돌아온 뒤 달라진 점',
  'brief.section.whyItMatters': '왜 중요한가',
  'brief.section.ifLeft': '그대로 두면',
  'brief.section.choiceNeeded': '지금 선택이 필요함',
  'brief.section.canSkip': '지금 읽지 않아도 됨',
  'work.section.doingNow': '지금 하는 일',
  'work.section.because': '이 일을 하는 이유',
  'work.section.next': '다음 단계',
  'work.section.range': '맡긴 범위',
  'work.section.helpWhen': '도움이 필요한 조건',
  'work.section.lastChange': '마지막 중요한 변화',
  'review.section.confirmed': '확인된 것',
  'review.section.unconfirmed': '확인하지 못한 것',
  'review.section.limits': '남은 제한',
  'review.section.challenging': '반대 근거',
  'review.section.impact': '전체 영향',
  'review.section.recheck': '다시 확인할 조건',
} as const;
export type CopyKey = keyof typeof ko;
```

데몬이 보내는 사용자용 문장은 문구 키와 인자(`{ key, args }`, 04 §3.0.2 `CopyKey`)로 오므로, 부품은 같은 사전으로 `t(key, args)`를 그린다. 모르는 키는 키 이름을 그대로 보이지 않고 "(문구 없음: 키)"로 그리고 개발 모드에서 경고한다. 고정 표현 묶음은 helm-canon §18.5 `fixed_sections`를 따른다. `product-language.yaml`을 문구 테스트의 기준으로 쓴다는 원천 규칙(helm-canon §17.7 끝)은 22·05와 맞춘다(§5.2).

#### 3.6.8 공통 상태 집합과 접근성

모든 부품은 해당하는 상태를 모두 구현하고, 상태마다 이야기(story)를 둔다(§6.3).

| 상태 | 표현 | 접근성 |
|---|---|---|
| 기본 | — | 역할(role)과 접근 가능한 이름 |
| 호버 | `fill-hover` 배경 | — |
| 포커스 | `focus-ring`/`focus-field` | `:focus-visible` |
| 눌림·선택 | `fill-selected` 또는 `accent-soft` + 왼쪽 막대 3px | `aria-pressed`/`aria-selected`/`aria-current` |
| 비활성 | `text-disabled`, 커서 기본 | `aria-disabled="true"`(포커스는 받게 해 이유 툴팁을 읽게 한다) |
| 로딩(투영 받는 중) | 뼈대(skeleton) 정적 블록, 반짝임 없음 | `aria-busy="true"` |
| 보내는 중 | §3.6.4 | `aria-live="polite"`로 "보내는 중" 한 번 |
| 오류 | 위험 색 글자 + 아이콘 + 문장 + 다음 행동 | `role="alert"`는 사람이 방금 한 조작의 오류에만. 배경 오류는 `status` |
| 빈 상태 | 무엇이 비었는지와 왜 그런지("아직 열린 질문이 없습니다. 질문은 에이전트가 기록하면 여기 모입니다") | — |
| 낡음 | §3.5.8 띠 | 띠는 `role="status"` |
| 오프라인 읽기 전용 | 결정 버튼 비활성 + 이유 | — |

스트림 갱신 알림: 화면 밖에서 들어온 변화는 `aria-live="polite"` 영역 하나에 모아서 알린다. 같은 영역에 15초에 한 번 이하로 "새 변화 3건"처럼 묶는다 [제안]. 진행 중 작업의 세부 갱신을 하나씩 읽지 않는다(helm-canon-3 §6.11 "screen reader가 과도하게 반복하지 않음").

### 3.7 컴포넌트 목록

세 층으로 나눈다. 아래 층은 위 층을 모른다.

| 층 | 폴더 | 내용 | 의존 |
|---|---|---|---|
| L0 기본 부품 | `ui/primitives/` | 버튼, 입력, 메뉴, 대화상자 같은 범용 부품 | Radix, cva, 토큰 |
| L1 Helm 의미 부품 | `ui/helm/` | 레코드 종류·품질·작성자·상태·신선도 표시 같은 작은 Helm 부품 | L0, `ui/model` |
| L2 Helm 복합 부품 | `ui/composites/`, `ui/viz/` | 카드, 패널, 시각화 | L0, L1 |
| 셸 | `ui/shell/` | 창 머리, 레일, 인스펙터, 입력창, 서랍 | L0~L2 |
| 대화 | `ui/conversation/` | assistant-ui 기반 객체별 스레드 | L0, L1, `@assistant-ui/react` |

#### 3.7.1 L0 기본 부품 [제안]

Radix가 키보드·포커스·ARIA를 제공하는 부품은 Radix 동작을 그대로 쓰고, 이 표는 Helm이 더하는 규칙만 적는다.

| 부품 | 바탕 | 목적과 Helm 규칙 | 키보드 | 접근성 |
|---|---|---|---|---|
| `Button` | `button`, Radix `Slot` | 탐색·표시 조작(결정 아님). 변형 `primary`/`secondary`/`ghost`, 크기 `sm`/`md` | Enter, Space | 아이콘만이면 `aria-label` 필수(타입으로 강제) |
| `IconButton` | `Button` | 아이콘만 있는 버튼. `label` 필수, 툴팁 자동 | 같음 | `aria-label=label` |
| `ActionButton` | `Button` | 결정 의도 전송. §3.6.4 상태 기계 내장. `consequence` 규칙(§3.6.3) | Enter, Space. 단축키 없음 | 상태 변화를 `aria-live` 영역에 한 번 알림 |
| `RecordLink` | `a`(앱 내부 링크) | 레코드로 이동하거나 인스펙터를 연다. 레코드 종류 아이콘 포함 | Enter 이동, Shift+Enter 인스펙터 | 이름 = 종류 라벨 + 제목 |
| `TextField` | `input` | 한 줄 입력. IME 규칙(§3.6.5) | Enter 제출(조합 중 제외) | `label` 필수, 오류는 `aria-describedby` |
| `TextArea` | `react-textarea-autosize` | 여러 줄. 최소 3줄, 최대 12줄 뒤 스크롤 | ⌘/Ctrl+Enter 제출, Enter 줄바꿈 | 같음 |
| `Select` | Radix Select | 짧은 고정 목록에서 하나 고르기(설정용). 원함 탐구·질문 카드에서 쓰지 않는다(§3.9) | Radix | Radix |
| `Checkbox`, `Switch` | Radix | 설정, 전체 반영 항목 체크 | Space | Radix |
| `RadioGroup` | Radix | 설정용만 | 화살표 | Radix |
| `SegmentedControl` | Radix ToggleGroup(single) | 다이얼 값(적게/보통/많이), 깊이 전환 | 화살표, Space | `aria-label` 필수 |
| `Tabs` | Radix Tabs | Concern 화면의 영역(상황, 탐구, 작업, 결과, 이력) | 화살표, Home/End | Radix |
| `Tooltip` | Radix Tooltip | 보조 설명. 필수 정보를 툴팁에만 두지 않는다 | 포커스 시 열림 | Radix |
| `Popover` | Radix Popover | 짧은 상세(질문의 임시 가정 설명) | Esc 닫기 | Radix |
| `HoverPreview` | Radix HoverCard | 레코드 칩 위에서 요약 미리보기(마우스 전용 보조) | 키보드 사용자는 Shift+Enter 인스펙터로 같은 정보 | 보조 수단 |
| `Dialog` | Radix Dialog | 이의 사유, 기준 수정처럼 짧은 입력. "계속할까요" 확인 대화상자를 만들지 않는다 | Esc, 포커스 가둠 | Radix |
| `Sheet` | Radix Dialog(측면) | 좁은 창의 인스펙터, 설정 | 같음 | 같음 |
| `Menu` | Radix DropdownMenu | 보조 행동 묶음(복사, 감사 보기). 결정 행동을 메뉴 안에 숨기지 않는다 | Radix | Radix |
| `Toast` | Radix Toast | 사람이 방금 한 조작의 결과·오류. 진행 이벤트 금지(UP-13). 5초, 오류는 닫을 때까지 | F8로 토스트 영역 이동 | `aria-live` |
| `Disclosure` | Radix Collapsible | 접힘 영역("에이전트가 정한 것 4") | Enter, Space | `aria-expanded` |
| `ScrollArea` | 기본 스크롤 + CSS | Radix ScrollArea는 쓰지 않는다(기본 스크롤이 접근성·성능에 낫다 [지식]) | — | — |
| `Markdown` | `react-markdown` | 데몬이 보낸 마크다운 문장의 유일한 렌더러. 원시 HTML 끔, 링크 스킴 `https`·`helm`만, 그림은 데몬 HTTP 출처만(E21) | 링크 Enter | 링크에 실제 주소를 `aria-describedby`로 |
| `Banner` | `div` | 화면 머리 아래 띠(낡음, 저하, 오류) | 닫기 버튼(닫을 수 있는 띠만) | `role="status"` 또는 `alert` |
| `EmptyState`, `ErrorState` | `div` | 무엇이 비었나/무엇이 실패했나 + 다음 행동 | — | 제목은 제목 요소 |
| `Skeleton` | `div` | 정적 뼈대 | — | `aria-hidden` |
| `Kbd` | `kbd` | 단축키 표시(⌘ / Ctrl을 OS에 맞게) | — | — |
| `Splitter` | `div role="separator"` | 패널 너비 조절 | ←/→ 16px, Shift 64px | `aria-valuenow` |
| `VirtualList` | `@tanstack/react-virtual` | 200행이 넘는 목록 | 화살표, PageUp/Down, Home/End | `role="list"`/`grid`, `aria-setsize`·`aria-posinset` |
| `DataTable` | `table` | 정적 표. 첫 열 고정 | 행 사이 화살표(그리드 모드일 때) | `th scope` |

```ts
// apps/desktop/src/ui/primitives/ActionButton/ActionButton.tsx (props)
export interface ActionButtonProps {
  /** 결과를 말하는 문구 (helm-canon §17.6 §4). 예: "결과 확인", "이 선택으로 진행" */
  children: React.ReactNode;
  /** 보낼 의도. intentId·basisSeq는 컨테이너(20)가 채운다 */
  intent: UiIntent;
  /** 20의 useCommand().send를 감싼 함수. 결과는 상태로만 쓰고 화면을 미리 바꾸지 않는다 */
  onIntent: (intent: UiIntent) => Promise<CommandOutcomeView>;
  /** 20 useCommand의 현재 상태 (§3.6.4) */
  status: 'idle' | 'sending' | 'waiting_reconnect' | 'done' | 'rejected' | 'failed';
  /** 대상과 효과. tone="danger" 또는 rightsGate=true면 필수 */
  consequence?: { target: string; effect: string };
  tone?: 'primary' | 'secondary' | 'danger';
  rightsGate?: boolean;
  /** 결정 가능 여부 판단 재료 (§3.5.8 decisionsAllowed) */
  availability: { connection: ConnectionUiState; meta: ProjectionMeta };
  size?: 'sm' | 'md';
}
/** 20 CommandOutcome을 화면용으로 줄인 것 */
export type CommandOutcomeView =
  | { kind: 'ok' }
  | { kind: 'rejected'; reason: 'stale_basis' | 'content' | 'eligibility' | 'path'; messageKey: string; args?: Record<string, string> }
  | { kind: 'expired' };
```

#### 3.7.2 L1 Helm 의미 부품 [제안]

```ts
// apps/desktop/src/ui/helm/props.ts — L1 부품 props 모음
export interface KindLabelProps { kind: RecordKind; /** 라벨 숨기고 아이콘만(좁은 칸). 이때도 aria-label은 남는다 */ compact?: boolean }
export interface QualityBadgeProps { quality?: QualityState; flags?: QualityFlag[]; depth: Depth }
export interface AuthorshipMarkProps { author: ActorRef; autonomous?: boolean; depth: Depth }
export interface DraftMarkProps { author: Extract<ActorRef, { type: 'agent' }>; children: React.ReactNode; /** 사람이 이미 고친 초안 */ editedByHuman?: boolean }
export interface ActorLabelProps { actor: ActorRef }   // 아바타·이름 prop 없음 (UP-9)
export type StatusSet = 'work' | 'choice' | 'concern' | 'question';
export interface StatusLabelProps { set: StatusSet; value: string }
export interface LoopChipProps { loop: LoopId; /** 현재 위치 */ current?: boolean; planned?: boolean }
export type LoopId =
  | 'O' | 'I.fact' | 'I.want' | 'I.possibility' | 'I.outcome'
  | 'C.commit' | 'C.probe' | 'C.emergency'
  | 'A.confirm' | 'A.watch' | 'A.reflect'
  | 'S.split' | 'S.merge' | 'S.detach' | 'S.relocate' | 'S.recombine' | 'S.hold' | 'S.close';  // v0.3 03 §2.1, 최종은 14
export interface SituationChipProps { type: 'clear' | 'complicated' | 'complex' | 'chaotic' | 'disorder' | null; assessedBy?: ActorRef; autonomous?: boolean; contested?: boolean }   // 04 ConcernNode.situation, null = 판정 전
export interface ModeChipProps { modeId: string; label: string; /** 라우터가 고른 것(혼자 정한 결정) */ routed?: boolean }
export interface GateBadgeProps { gate: 'rights' | 'information' }
export interface DeliveryBadgeProps { delivery: 'immediate' | 'negotiated' | 'mediated' | 'scheduled' }
export interface AssumptionExpiryProps {
  assumption: string;
  /** 04 §3.0.2 ExpiryPoint: description, estimatedAt?, approaching. "가까워짐"은 데몬이 판정한다 (v0.3 06 §3.6) */
  expires?: ExpiryPoint;
}
export interface TimeStampProps { at: IsoTime; /** 상대 시간과 정확한 시각을 함께 */ mode?: 'relative+exact' | 'exact' }
export interface RecordChipProps { record: RecordRef; onOpen?: (r: RecordRef, how: 'navigate' | 'inspect') => void }
export interface SourceTraceProps { trace: SourceTrace; depth: Depth; onOpenOutput?: (ref: string) => void }
export interface CertaintyDescriptorProps {
  directness: 'direct' | 'indirect' | 'none';
  /** 04 EvidenceChainView.root.counterSearch와 같은 값 */
  counter: { state: 'searched_none' } | { state: 'found'; remaining: RecordRef[] } | { state: 'not_searched' } | { state: 'searching' };
  unverifiedScope: string[];
  nextCheck?: string;
  depth: Depth;
}
export interface ReversibilityNoteProps {
  /** 권한 레이어 판정만 받는다 (결정 2, C1) */
  source: 'permission-layer';
  text: string;
  /** 되돌리는 비용이 커지는 지점(가정 만료점과 같은 개념) */
  lastCheapPoint?: string;
}
export interface ReviewTriggerLineProps { trigger: string | null }
export interface DepthToggleProps { value: Depth; onChange: (d: Depth) => void; allowed?: Depth[] }
export interface FreshnessIndicatorProps { meta: ProjectionMeta; showSeq: boolean }
export interface UnseenDotProps { unseen: boolean }
export interface ContestButtonProps {
  target: RecordRef;
  /** 이미 이의가 걸렸으면 이의 내용을 보여 주고 다시 걸 수 없음 */
  existing?: { reason?: string; at: IsoTime };
  makeIntent: (reason?: string) => UiIntent;
  onIntent: ActionButtonProps['onIntent'];
  availability: ActionButtonProps['availability'];
}
export interface WholeUpdateBadgeProps { accepted: boolean; remaining: number }
```

| 부품 | 목적 | 상태 | 키보드 | 접근성 |
|---|---|---|---|---|
| `KindLabel` | 레코드 종류 표시(§3.5.2) | 기본, `compact` | — | 아이콘 `aria-hidden`, 글자 또는 `aria-label` |
| `QualityBadge` | 품질 상태·옆길(§3.5.3). `contested`·`stale`은 이유 문장 동반 | 깊이별 표시 규칙 | — | 배지 글자 + 이유가 접근 가능한 이름에 포함 |
| `AuthorshipMark` | 작성자(§3.5.5) | 사람/에이전트/규칙/런타임/외부 | — | 글자 |
| `DraftMark` | 모델 초안 감싸기. 파선 테두리 + "초안 · 작업 에이전트" | 초안, 사람이 고친 초안("초안 · 내가 고침") | — | 영역 이름 "에이전트 초안" |
| `ActorLabel` | 역할과 맡긴 일 | — | — | 글자만 |
| `StatusLabel` | 상태 라벨(§3.5.4) | 집합별 값 | — | 글자 |
| `LoopChip` | 루프 글자 칩(`I.want` → "I 원함") | 기본, 현재(굵게 + 밑줄), 계획만(파선 테두리) | — | 이름 "원함 탐구 루프, 현재" |
| `SituationChip` | 상황 유형 + 판정 주체 | 사람 판정 / 에이전트 판정(이의 가능) | — | 글자 |
| `ModeChip` | 모드. 라우팅된 것이면 "자동 선택" 표시와 이의 연결 | 기본, 라우팅됨 | — | 글자 |
| `GateBadge` | 권리 게이트 "선택 필요" / 정보 게이트 "확인하면 좋은 것" | — | — | 글자 |
| `DeliveryBadge` | 전달 방식(즉시·협상·중재·예약). 검토 깊이부터 | — | — | 글자 |
| `AssumptionExpiry` | 임시 가정 + 만료점(`description`, 추정 시각이 있으면 상대 시간). `approaching`이면 경고 색과 "곧 만료" | 기본, 임박, 지남(가정 확정됨) | — | 시각은 `TimeStamp` |
| `TimeStamp` | "12분 전 · 10월 11일 14:02" | — | — | `<time datetime>` |
| `RecordChip` | 본문 안 레코드 참조 | 기본, 낡음, 대체됨, 사라짐(삭제·권한 없음) | Enter 이동, Shift+Enter 인스펙터 | 링크 |
| `SourceTrace` | 출처 6필드(§3.6.2). 한눈에: 도구·시각, 검토: 입력 범위·종료, 감사: 전부 + 출력 열기 | 출력 없음, 출력 큼(HTTP로 받기), 해시 불일치(낡음) | 출력 열기 Enter | 정의 목록(`dl`) |
| `CertaintyDescriptor` | 확실성 네 칸(§3.5.6) | `not_searched`는 경고 표시 | — | 칸마다 라벨 |
| `ReversibilityNote` | 권한 레이어 판정만 표시. 출처 아이콘 `ShieldCheck` + "권한 레이어 판정" | — | — | 글자 |
| `ReviewTriggerLine` | "다시 볼 조건: …". 없으면 "다시 볼 조건 없음"(빈 칸을 숨기지 않음) | — | — | 글자 |
| `DepthToggle` | 세 깊이 전환 | — | 화살표 | `SegmentedControl` |
| `FreshnessIndicator` | 기준 seq·신선도(§3.5.8) | 네 신선도 | 눌러서 상세 팝오버 | `role="status"` |
| `UnseenDot` | 사람이 보지 않은 변화 | — | — | "새 변화" 숨긴 글자 |
| `ContestButton` | 이의 걸기. 누르면 `OVL-CONTEST` 대화상자로 사유 입력(선택 사항, 비워도 됨) 후 `contest.file` | 기본, 이미 이의 걸림, 보내는 중 | Enter | 대화상자 제목 "이의 걸기: <대상>" |
| `WholeUpdateBadge` | "결과 확인됨 · 전체 반영 2개 남음". `remaining=0`일 때만 "완료" | — | — | 글자 |

이의 사유를 필수로 받지 않는다 [제안]. 이유를 말하지 못하는 이의도 받는다(결정 18의 "이유 없는 반응"과 같은 원리). 사유가 비면 "사유 없이 이의"로 기록되게 11에 요구한다.

#### 3.7.3 L2 Helm 복합 부품 [제안]

모든 L2 부품은 `depth: Depth`, `meta: ProjectionMeta`(화면 단위로 받으면 생략 가능), `onIntent`, `onNavigate`를 받는다. 아래 TS에서는 반복을 줄이려고 공통 props를 `L2Common`으로 묶는다.

```ts
// apps/desktop/src/ui/composites/common.ts
export interface L2Common {
  depth: Depth;
  onIntent: (intent: UiIntent) => Promise<CommandOutcomeView>;
  onNavigate: (target: NavTarget) => void;
  availability: { connection: ConnectionUiState; meta: ProjectionMeta };
  /** 컨테이너가 intentId·basisSeq를 채운 의도 생성기 */
  makeIntentBase: () => IntentBase;
}
export type NavTarget =
  | { type: 'record'; record: RecordRef; how: 'navigate' | 'inspect' }
  | { type: 'screen'; screen: ScreenId; params?: Record<string, string> }   // 03 §3.6 화면 ID
  | { type: 'audit'; seqRange?: [number, number]; recordId?: Id };
```

##### (1) `SinceLastVisit` 복귀 요약

- 목적: 사람이 돌아온 뒤 원본 기록을 읽지 않고 다음 행동을 고르게 한다(UC-06, `SCR-BRIEF`). 절 구성은 04 §3.2(ADR A3, 아홉 절)가 정한다.
- 입력: `BriefView`(04 §3.2). 절마다 렌더러가 따로 있다: Goal과 바뀐 기준, 바뀐 것(N/E/M 각 `ChangeGroup` 최대 5 + 접힘), 평가, 선택 필요(`QuestionCard` 접힘), 확인하면 좋은 것, 진행 중 작업(`ActiveWorkCard` 한눈에), 예측과 가장 싼 방향 바꾸기 지점, 에이전트가 정한 것(종류별 개수, 접힘), 지금 읽지 않아도 되는 것(접힘), 복구 n.

```ts
export interface SinceLastVisitProps extends L2Common {
  view: BriefView;                      // 04 §3.2
  meta: ProjectionMeta;
  /** "확인함" → brief.acknowledge { upToSeq: view.coveredTo.seq }. 읽음과 이해 주장을 같게 보지 않으므로 사람이 명시적으로 누른다 (helm-canon-2 §3.10) */
  onAcknowledge: () => void;
  /** 항목 정정 → brief.correct */
  onCorrect: (item: RecordRef, note: string) => void;
}
```

| 상태 | 표현 |
|---|---|
| 기본 | 절마다 고정 표현 머리말(§3.6.7) + 본문. 각 줄 끝에 출처 칩 |
| 변화 없음 | "마지막 확인(어제 23:10) 이후 바뀐 것이 없습니다" + 진행 중 작업과 다가오는 것만(04 §3.2) |
| 낡음·오프라인 | §3.5.8 띠. 현재 시제 문구를 기준 시각 문구로 |
| 매우 김 | 묶음마다 상위 항목만, 나머지 "n건 더"(접힘). 반대 근거·이의·권리 게이트 질문은 접지 않는다 |

키보드: 절 사이 이동 단축키(05 §3.8), 절 안 화살표. "확인함"은 버튼. 접근성: 절마다 `section`과 제목, 선형 텍스트 요약.

##### (2) `GoalSummary`, `ConcernTree`

`GoalSummary` 입력: `HomeView.goals[]`(현재 버전, 확인 이후 바뀐 기준 수, 확인 기다리는 수정 제안) 또는 `GoalView`. 수정 제안이 있으면 "Goal 확인 요청"을 머리에 둔다.

`ConcernTree` 입력: `ConcernNode[]`(04 §3.1). WAI-ARIA tree 패턴이다.

```ts
export interface ConcernTreeProps extends L2Common {
  roots: ConcernNode[];                  // 04 §3.1
  /** 기본 펼침: needsHuman인 노드와 그 조상만 (v0.3 09 §4.1, 03 §4) */
  expandedIds: Set<Id>;
  onExpandedChange: (ids: Set<Id>) => void;
  filter: 'needs_human' | 'active' | 'all';
}
```

- 노드 한 줄: 상태 라벨(03 §3.3.3), 제목, 상황 유형 칩(`null`이면 "판정 전"), 현재 루프 칩(03 §3.3.7 라벨), 모드, 기다리는 것(`waitingFor`), 사람이 필요하면 표시.
- 키보드: ↑/↓ 이동, →/← 펼침·접힘, Enter 열기(`SCR-CONCERN-OVERVIEW`), Shift+Enter 인스펙터, `*` 형제 모두 펼침.
- 들여쓰기는 6단계까지, 그 아래는 위치 경로로 보인다. 노드가 많으면 펼친 노드를 평탄화해 가상 스크롤로 그린다(03 §4: 화면 쪽 상한은 두지 않는다).
- 구조 루프가 나눈 하위 Concern은 "나눔 · 에이전트가 정함"과 이의 연결.

##### (3) `QuestionCard` 질문 카드

- 목적: 질문 레코드(11)를 사람에게 보이고 답·가정 수용·미루기·이의를 받는다. 접힌 카드(홈·복귀 요약·질문함 목록)와 펼친 카드(`SCR-QUESTION`) 둘을 그린다. 필드, 깊이(`light | normal | deep`)별 펼침, 행동 버튼 구성은 04 §3.0.7·§3.4가 정한다. 원천의 Decision Gate 카드(helm-canon-3 §6.6.3)와 v0.3 질문함을 합친 것이다.

```ts
export type QuestionCardProps = L2Common & (
  | { mode: 'collapsed'; q: QuestionSummary; onOpen: () => void }
  | { mode: 'expanded'; q: QuestionView['q']; meta: ProjectionMeta; impact?: ChoiceImpactEchoProps }
);
```

부품이 지키는 규칙(04 규칙을 부품 계약으로 옮긴 것):

| 규칙 | 부품 동작 |
|---|---|
| 원함 탐구에서 온 질문(`origin.inquiry === 'want'`) | `recommendation`, `options`가 와도 그리지 않고 개발 모드에서 경고를 남긴다(§3.9 R1). 답 형태는 `yesNo`·`text`만 허용, `pickOne`이면 경고 |
| 다른 선택 | `options`를 VM 순서대로. 처음에는 추천과 가장 강한 다른 선택만 보이고 나머지는 "+n"으로 접되 펼쳐서 고를 수 있다. 개수를 줄이지 않는다(R3) |
| 반대 근거 | 접힌 상태에서도 개수와 가장 강한 것 한 줄(04 §3.4) |
| 되돌릴 수 있나 | `reversibility.source === 'permission_layer'`일 때만 `ReversibilityNote`로. 없으면 "판정 없음" |
| 주 버튼 | 최대 3개. 버튼 문구는 `OptionView.actionLabel`(대상·효과). 권리 게이트 버튼은 `rightsGate` |
| "그 밖에" 줄 | 기준 고치기, 질문 다시 쓰기(`question.requestReframe`), 먼저 탐구(`question.requestInquiry`), 맡기기(`question.delegate`), 미루기(`question.defer`), 이의(`OVL-CONTEST`)를 메뉴가 아니라 보이는 링크 줄로 항상 둔다(R2) |
| 가정대로 진행 | 정보 게이트에서만(`question.proceedWithAssumption`). 권리 게이트에는 없다(helm-canon-3 §7.1 C10) |
| 답한 뒤 | 명령 결과의 `impact`를 `ChoiceImpactEcho`로. 앱이 영향을 추측하지 않는다(04 §3.4) |

| 상태 | 표현 |
|---|---|
| `pending`/`delivered` | 기본. 머리에 화면 종류 라벨(03 §3.2.4)과 전달 방식·시각 |
| 만료점 가까움(`expires.approaching`) | 머리 경고 색 "만료점이 가까워 지금 전달했습니다 · 약 10분 남음" |
| 즉시로 승격됨 | 전달 칸 "협상 → 즉시(만료 임박)" |
| `assumed` | "답이 없어 09:00에 임시 가정대로 정해졌습니다" + 이의(04 §3.0.5) |
| 이미 처리됨, 철회, 찾을 수 없음, 낡은 기준 거부 | 04 §3.0.5 문장. 쓰던 답 유지 |
| 묶음 모드 | 질문을 차례로 쌓고 맨 아래 "고른 대로 보내기". 질문마다 의도를 따로 보낸다 |

키보드: 카드 포커스에서 Space 펼침, Tab으로 버튼, 답 입력은 ⌘/Ctrl+Enter 제출. 결정에는 한 글자 단축키를 두지 않는다(§3.6.5). 접근성: 카드는 `article`, 제목은 질문 문장, 화면 종류 라벨이 제목 앞에 읽힌다("선택 필요, 질문 15: …").

##### (4) `QuestionInbox` 질문함

입력: `InboxView`(04 §3.3). 전달된 질문(데몬 정렬, 앱은 순서를 바꾸지 않음), 묶음, 곧 전달될 것, 최근 답한 것. 목록은 `VirtualList`. 행을 고르면 오른쪽에 펼친 `QuestionCard`(04: 행 선택 = 오른쪽에 `SCR-QUESTION`).

- 권리 게이트 질문은 개수와 상관없이 모두 보인다(helm-canon-3 §7.1 C3). 홈 주의 카드의 기본 펼침 개수(04 ADR A5, 기본 3)는 정보 질문에만 적용한다.
- 키보드: J/K 행 이동, Enter 오른쪽 카드로 포커스(04 §3.3). 묶음 행 Enter = 묶음 모드.
- "다른 기기에서 답함" 행은 2초 뒤 최근 답한 것으로 옮긴다(04 §3.3). 옮길 때 포커스가 그 행에 있으면 다음 행으로 옮긴다.

##### (5) `ChoiceImpactEcho`

선택 직후 "이 선택으로 바뀐 것"(바뀐 작업 합의, 다시 확인할 레코드, 다시 볼 조건)을 보인다(helm-canon-2 §3.7). 데몬이 보낸 결과 투영을 그린다. 화면이 추측해 만들지 않는다.

```ts
export interface ChoiceImpactEchoProps extends L2Common {
  choice: RecordRef;
  changed: Array<{ text: string; records: RecordRef[] }>;
  invalidated: RecordRef[];             // 다시 확인 대상이 된 합의·투영
  reviewTrigger: string | null;
  onDismiss: () => void;
}
```

##### (6) `AutonomousChoiceList` 에이전트가 정한 것

입력: `AutonomousView`(04 §3.5). 종류별 묶음(루프, 상황 판정, 구조, 가정 확정, 라우팅, 진입, 선택)과 처리 중인 이의(`openContests`).

- 항목 한 줄: 무엇을 정했나, 묻지 않은 이유(`whyNotAsked`, 필수). 펼치면 대안·이유·다시 볼 조건·관련 질문·의존 수(`dependents`).
- 행동: 이의(`!`, `OVL-CONTEST` → `contest.file`), 봤음(`S`, `autonomous.markSeen`), 모두 봤음. "봤음"은 승인이 아니며 이의를 걸 권리가 남는다는 문장을 버튼 툴팁에 둔다(04 §3.5). "봤음"을 누르라고 재촉하는 표시(빨간 개수 등)를 쓰지 않는다.
- 처리 중인 이의는 맨 위 고정 구역에 둔다. 화면에서 사라진 이의 수가 0이어야 한다(v0.3 09 §5 Contestability 지표).
- `!`, `S`는 대화상자를 열거나 관찰(봤음)을 남기는 키라 §3.6.5의 "결정에는 한 글자 단축키 없음" 규칙에 걸리지 않는다. 이의 자체는 대화상자에서 버튼으로 보낸다.

##### (7) `WorkAgreementDraft`, `WorkAgreementEcho` 작업 합의

입력: `AgreementView`(04 §3.11). `WorkAgreementDraft`는 `SCR-AGREE`에서 에이전트가 만든 합의 초안을 보이고 사람이 칸별로 고치거나 반응한다(UC-07, helm-canon-3 §6.6.4). `WorkAgreementEcho`는 확정된 합의를 짧게 다시 보여 준다(helm-canon-2 §3.12 echo 형식: 결과, 할 수 있음, 할 수 없음, 제출할 근거, 멈출 때).

- 빈 양식으로 시작하지 않는다(UP-7, R5). 초안 전체를 `DraftMark`로 감싸고, 사람이 고친 칸은 "내가 고침"으로 바뀐다.
- 이전 합의보다 넓어진 칸(`widenedFromPrevious`)은 칸 옆에 "범위가 넓어짐: 이전 …"을 보인다. 넓어짐 판정은 데몬이 한다.
- 에이전트의 이해 재진술(`restatement`, check-back, helm-canon-3 G1)을 맨 위에 두고 "이해가 다름" 행동(`agreement.correctUnderstanding`)을 붙인다.
- 집행 수준(`enforcement: 'advisory'`)이면 머리에 "이 런타임에서는 맡긴 범위가 권고이며 강제되지 않습니다"를 항상 보인다(helm-canon-2 §3.13).
- 맡긴 범위 상세(`rangeDetail`, P04 §1 여덟 항목)는 검토 깊이에서. 권한 레이어 출처 항목은 `ShieldCheck`.
- 행동: 이 합의로 맡기기(`agreement.confirm`, `consequence`에 범위 요약), 범위 좁히기(`agreement.narrow`), 칸 고치기(`agreement.revise`), 맡기지 않기(`agreement.decline`).

##### (8) `ActiveWorkCard` 진행 작업 카드

입력: 04 §3.1의 `ActiveWorkCard` 타입(같은 이름). 줄 구성은 04 §3.0.7(지금 하는 일, 이 일을 하는 이유, 다음 단계, 맡긴 범위 + 집행 수준, 도움이 필요한 조건, 마지막 중요한 변화, 활동 요약, 예산).

- 항상 가능한 행동: 방향 바꾸기(`work.steer`), 기준 바꾸기(`SCR-AGREE`로 이동), 범위 좁히기(`agreement.narrow`), 안전하게 멈추기(`work.pause`), 요약 요청(`work.requestBrief`), 근거 열기, 중단(`work.stop`, 위험 버튼, `consequence`에 "진행 중인 실행을 취소하고 이미 생긴 변화를 보고"). 즉시 중지(`work.abort`)는 감사 깊이 메뉴에만 두고 결과 문장("작업 공간이 복구 필요 상태가 될 수 있습니다")을 버튼에 쓴다. 멈춤·중단·즉시 중지의 차이를 숨기지 않는다(helm-canon-2 §3.11).
- `enforcement: 'advisory'`면 맡긴 범위 줄에 "권고만"을 항상 보인다.
- 에이전트 루프 상태(생각 중, 도구 실행 중)를 "생각 중" 문구나 애니메이션으로 그리지 않는다. `doingNow` 문장(의미 상태 언어, 05)을 그대로 쓴다(UP-9).
- 예산은 SVG 막대 + 글자("하위 호출 12/30 · 40분/2시간"). 단위는 14·12.

##### (9) `ToolActivityLine`

도구 실행을 한 줄로 압축한다. 예: "작업 · 원인 후보 비교 / 파일 4개 읽음 · 검색 2회 · 실제 변화 없음"(helm-canon-2 §3.11). 항상 따로 한 줄로 보이는 7종: 실제 변경 시작·완료, 외부·공유 효과, 권한 거부, 판단을 바꾸는 테스트 근거, 추천을 바꾸는 반대 근거, 지켜야 할 조건 충돌, 비용·시간·위험 임계 초과.

```ts
export interface ToolActivityVM {
  summary: { reads: number; searches: number; executes: number; writes: number; materialChange: boolean };
  alwaysShow: Array<{ type: 'material_change' | 'external_effect' | 'permission_denied' | 'finding_test' | 'counterevidence' | 'boundary_conflict' | 'threshold'; text: string; record?: RecordRef }>;
  calls: Array<{ toolCallId: Id; tool: string; trace: SourceTrace }>;   // 감사 깊이
}
```

##### (10) `MaterialChangeGroups`

실제 변화(M)를 묶음 카드로 보인다. 입력은 `ChangeGroup[]`(04 §3.2, 세계별 최대 5묶음 + 나머지 접힘, helm-canon-2 §8.2·§8.7). 묶음 기준은 데몬 투영이 준다(Concern·WorkUnit·선택 영향. 경로 기준이 아님). 묶음 카드: 제목, 변경 수, 묶은 이유(`why`), 펼치면 항목 칩과 `SourceTrace`. 접힌 묶음의 이름을 "그 밖에"에 보존한다.

##### (11) `ResultReviewPanel` 결과 확인 2단계

입력: `ReviewView`(04 §3.12). 1단계 결과 확인(Acceptance), 2단계 전체 반영(Integration)을 한 패널의 두 단계로 나눈다(helm-canon-3 §6.6.7). 결과 확인은 사람만 한다(v0.3 07 §2.4).

- 기준 행(`ResultCriterionRow`): 판정 기호(✓ 확인됨 / △ 일부 / ✗ 충족 못함 / ? 확인 못함)를 글자 라벨과 함께 쓰고, 근거 `StatementView` 칩, 낮춰진 이유(`downgradedReason`), 취향형이면(`tasteMode`) 사람의 판정 칸(`humanJudged`: 맞음 / 아님 / 모르겠음).
- 고정 표현 여섯 칸(확인된 것, 확인하지 못한 것, 남은 제한, 반대 근거, 전체 영향, 다시 확인할 조건)은 `sections`를 그대로 그린다.
- 독립 검증(`verification`)이 있으면 검증자 역할과 "다른 모델" 여부를 보인다.
- 1단계 행동: 결과 확인(`result.accept`), 조건부 확인(`result.acceptWithConditions`, 조건 입력 필수), 수정 요청(`result.requestRevision`), 다시 조사(`result.reopen`). 반대 근거가 남아 있으면 확인 버튼 옆에 "남은 반대 근거 1건"을 둔다(막지는 않는다. 판정은 사람 권리). 확인 못한 기준이 있으면 `consequence`에 "확인하지 못한 기준 1개를 남긴 채 확인".
- 2단계: 점검 여섯 칸(`obligations[].checkpoint`)별 반영 항목 체크 목록. 행동: 처리됨(`obligation.confirmDone`), 미루기(`obligation.defer`), 다른 Concern으로 넘기기(`obligation.transfer`). `completeAllowed`가 참일 때만 `WholeUpdateBadge`가 "완료"를 그린다(UP-5). 원천의 Integration Map은 그래프로 그리지 않고 이 목록으로 대신한다(§2.3).

##### (12) `EvidenceInspector` 근거 인스펙터

선택한 판단·선택·결과·근거 하나의 근거 관계를 `RGN-INSPECTOR`에 보인다(helm-canon-3 §6.6.6). 넓게 보려면 `SCR-EVIDENCE`로 연다(03 §3.5.1). 입력은 `EvidenceChainView`(04 §3.15). 본체는 `EvidenceChainTree`(§3.8.1)이고, 머리에 `KindLabel`, `QualityBadge`, `CertaintyDescriptor`, 아래에 "이것이 바뀌면 다시 열리는 것"(`reopensIfChanged`)과 아직 모르는 점, 원본 위치를 둔다. 같은 모델·같은 컨텍스트에서 나온 근거는 "같은 출처 계열"로 묶어 표시한다(helm-canon-3 G7). 인스펙터 탭: 근거, 출처, 작성자·권한, 관련, 원본(감사 깊이).

##### (13) `SemanticPreview` 의미 미리보기

자연어 입력이 무엇으로 기록될지 데몬이 제안한 것을 보이고, 차이가 큰 부분만 확인받는다(helm-canon-3 §7.2 G13, helm-canon-2 §3.6). 사람이 이벤트 종류를 직접 고르게 하지 않는다.

```ts
export interface SemanticPreviewVM {
  utteranceDraftId: Id;
  interpretations: Array<{
    id: string;
    /** 질문 / 제약 변경 / 선택 / 요청 / 기준 변경 / 이의 / 단순 대화 */
    as: 'question' | 'constraint_change' | 'choice' | 'request' | 'criterion_change' | 'contest' | 'chat';
    summary: string;                    // "외부 배포를 금지하고 로컬 변경·테스트까지만 맡긴 범위로 둡니다"
    affects: RecordRef[];
    impact: 'low' | 'high';             // 데몬 판정. high면 확인 필요
  }>;
}
export type SemanticPreviewChoice = { interpretationId: string } | { asChat: true };
export interface SemanticPreviewProps extends L2Common { vm: SemanticPreviewVM; onChoose: (c: SemanticPreviewChoice) => void }
```

`impact="low"`인 해석만 있으면 미리보기를 띄우지 않고 보낸 뒤 짧은 반향("외부 배포를 금지했습니다 · 되돌리기")을 보인다. `high`가 있으면 입력창 위에 해석 카드를 띄우고 "이렇게 기록" / "그냥 대화로" / 고쳐 쓰기를 둔다. 원천 규칙(명확한 지시는 반향, 모호·고영향은 확인)을 따른다.

##### (14) `DialPanel` 다이얼 패널

입력: `DialsView`(04 §3.17). 현재 모드(누가 골랐는지, 이유, 중심 루프, 능력 켜짐/꺼짐, 이의), 다이얼 목록(값, 선택지, 어느 설정 층에서 온 값인지 `sourceLayer` 1~6, 바꿀 수 있는 범위, 루프별 값).

- 이산 값은 `SegmentedControl`, 숫자 범위 값은 숫자 입력(단위 표시)으로 그린다. 슬라이더를 쓰지 않는다(정확한 값과 키보드 조작이 낫다).
- 값마다 층 표시("이 Concern에서 바꿈", "모드 기본값", "시스템 기본값", v0.3 07 §6)와 "다음 턴 경계에 반영" 안내. 변경은 `dial.set`, 되돌리기는 `dial.unset`(위 층 값으로), 모드 변경은 `mode.set`.
- 접힌 안내 "다이얼이 바꾸지 못하는 것"(불변조건 1~7, v0.3 07 §7).
- 모드를 라우터가 골랐으면 "자동 선택 · 이의" 표시.

##### (15) `RecoveryList` 복구

입력: `RecoveryView`(04 §3.20). 재시작으로 중단된 WorkUnit과 결과를 모르는 외부 행동(helm-canon-3 G11, 결정 30). 항목: 마지막 확인 지점, 중단된 도구와 요약, 다시 실행해도 안전한지(`rerunSafe`와 판정 출처: 도구 선언 / 권한 레이어), 외부 효과 여부(없음 / 있을 수 있음 / 일어남 / 모름), 가능한 행동. 행동은 `recovery.resolve`로 보내며 버튼 문구는 결과를 말한다: "마지막 확인 지점부터 다시 실행", "그대로 두기", "다시 계획", "확인 작업 만들기", "일어났다고 기록", "일어나지 않았다고 기록", "되돌리기"(helm-canon §17.6 §4). `rerunSafe: 'unsafe' | 'unknown'`이면 "다시 실행" 버튼에 `consequence`로 이유를 쓴다. 데몬이 읽기 전용 복구 모드면 모든 버튼을 막고 이유를 보인다.

##### (16) `ObserverProposalCard` 관찰 에이전트 제안, `MetricTile` 평가 지표

`ObserverProposalCard` 입력: `ObserverProposalsView.proposals[]`(04 §3.18). 관찰 에이전트(결정 35, 16)는 쓰기 권한이 없으므로 카드는 "제안"이다. 카드: 찾은 반복 패턴, 근거(세션 출처: Helm·pi·Claude Code·Codex, 기간, 횟수, 추정 절감과 계산식), 바뀌는 것(컨텍스트·합의·정책), 초안(마크다운 또는 diff, 원시 HTML 끔), 주의 사항(주입 의심 경고 포함, 16 §3.24), 채택 뒤 효과(전·후 값). 행동: 채택(`observerProposal.adopt`), 고쳐서 채택, 기각(`observerProposal.decline`, 사유 하나 고르기: 16의 `not_useful | wrong_pattern | already_handled | too_costly | other`), 나중에(`observerProposal.snooze`). 기각 사유 고르기는 결정 질문이 아니라 분류 입력이라 §3.9 R4의 단일 선택 부품 제한에 걸리지 않는다(`composites/rules/` 폴더).

`MetricTile` [제안, 16 §3.24 요구]: 평가 화면(16이 제안한 `SCR-METRICS`, 03이 화면 목록에 넣을지 정함)의 지표 하나. 값, 분자/분모/표본 수, 창(예: 14일), 정의 버전, 검토 신호(초기 가설값임을 표시), 14일 추세(일일 스냅샷 SVG 선, 점마다 접근 가능한 값), 근거 이벤트로 내려가기. 값의 좋고 나쁨을 색만으로 표시하지 않고 "검토 신호: 기준 0.2 초과" 같은 문장으로 쓴다. 점수·순위·연속 기록 표시는 쓰지 않는다.

##### (17) `DegradedBanner`

`RGN-BANNER`에 저하 상태를 띠로 보인다. 원천의 네 가지(helm-canon-2 §3.13)와 04 §3.0.4의 연결 상태를 합친다. 문구는 04·05.

| 종류 | 띠 내용 | 화면 동작 |
|---|---|---|
| 커널·데몬 응답 없음, 복구 모드 | Helm 기록에 쓸 수 없어 결정이 막힘, 대화 초안은 보존 | 결정 버튼 비활성 |
| 어댑터 능력 없음(맡긴 범위 권고 수준) | 맡긴 범위가 강제되지 않음 | `ActiveWorkCard`·`WorkAgreementDraft`에도 표시 |
| 뷰 낡음 | §3.5.8 | 읽기 가능, 그 화면 결정 막음 |
| 외부 결과 불확실 | 시간 초과를 실패로 단정하지 않음, 확인 작업 생성됨 | 해당 작업 카드 연결 |
| 연결 끊김, 인증 실패, 버전 불일치 | 04 §3.0.4 표 | 결정 막음, `SCR-CONNECT` 링크 |

한 번에 하나만 보이고 나머지는 "그 밖에 2건"으로 접는다(03 §3.4.1). 화면을 가리는 모달로 띄우지 않는다.

#### 3.7.4 셸 부품 [제안]

| 부품 | 목적 | 핵심 props | 키보드 | 접근성 |
|---|---|---|---|---|
| `WindowHeader` | 창 머리. 명령 팔레트 진입, 지표 셋 | `pending: PendingQuestionsVM`, `connection: ConnectionVM`(§3.8.5), `meta: ProjectionMeta`, `path: RecordRef[]`(위치 경로), `onOpenPalette` | ⌘/Ctrl+K | `banner` 영역 |
| `NavRail` | 최상위 이동 | `items: Array<{ screen: ScreenId; label; icon; count?: { value: number; kind: 'rights' \| 'info' \| 'neutral' } }>`(03 §3.5.2 순서), `current`, `collapsed` | ⌘/Ctrl+1~7, ↑/↓ | `nav`, `aria-current="page"` |
| `ScopeBar` | `RGN-STATUSLINE`: Goal · Concern · 모드 · 지금 하는 일 · 맡긴 범위 · 다음 멈춤(helm-canon-2 §3.5) | `goal?: RecordRef`, `concern: RecordRef`, `statusLine: ConcernView['statusLine']`, `loop?: string`(03 §3.3.7 식별자) | 칩마다 Enter 이동 | `nav aria-label="현재 범위"` |
| `Inspector` | 오른쪽 상세. 탭: 근거, 출처, 권한, 관련, 원본 | `subject?: RecordRef`, `tab`, `pinned`, `width` | ⌘/Ctrl+I 열고 닫기, Esc 닫기(시트일 때) | `complementary` |
| `ScopedComposer` | 현재 범위에 묶인 자연어 입력 + `SemanticPreview` | `scope: { kind: 'global' \| 'goal' \| 'concern' \| 'workUnit' \| 'question'; ref?: RecordRef }`(03 §3.4.1), `placeholderKey`, `draft`, `onDraftChange`, `preview?: SemanticPreviewVM` | ⌘/Ctrl+Enter 보내기, `/` 포커스(입력 밖에서), IME 규칙 | 입력의 라벨에 범위 이름 포함("Concern ‘블로그 방향’에 말하기") |
| `ActiveRunDrawer` | 진행 중 실행 요약 서랍. 에이전트별 토큰 스트림 없음 | `works: ActiveWorkCard[]`(04 §3.1), `exceptions: RecordRef[]`, `open` | ⌘/Ctrl+J | `region`, 갱신은 §3.6.8 규칙 |
| `CommandPalette` | 이동, 레코드 찾기, 표시 조작 | `commands: Command[]`, `search(query): Promise<RecordRef[]>` | ⌘/Ctrl+K, ↑/↓, Enter | `combobox` + `listbox` |

```ts
export interface Command {
  id: string; label: string; group: 'navigate' | 'view' | 'record';
  shortcut?: string;
  /** 명령 팔레트에서 결정 의도를 보내지 않는다. 결정이 필요한 명령은 해당 카드로 이동만 한다 */
  run: () => void;
}
```

명령 팔레트는 이동과 표시만 한다 [제안]. 결정을 팔레트에서 바로 보내면 근거와 반대 근거를 보지 않고 결정하게 된다(A15).

#### 3.7.5 대화 부품 [제안]

`ConversationThread`(`ui/conversation/`)는 객체 하나에 붙은 대화를 보인다. 상세는 §3.10.

```ts
export interface ConversationRef { threadId: Id; owner: RecordRef }
export interface ConversationThreadProps {
  ref_: ConversationRef;                // (prop 이름 충돌을 피해 ref_)
  messages: ThreadMessageVM[];          // 20이 데몬 투영에서 만든다
  isRunning: boolean;
  onSend: (text: string) => Promise<CommandOutcomeView>;     // composer.submit 의도로 바뀐다 (19)
  onCancel?: () => void;                            // 진행 중 응답 중단 → work.stop 또는 19의 취소 메서드
  preview?: SemanticPreviewVM;
  collapsed: boolean;
  onCollapsedChange: (v: boolean) => void;
}
export interface ThreadMessageVM {
  id: Id; role: 'user' | 'assistant' | 'system';
  parts: Array<
    | { type: 'text'; text: string }
    | { type: 'record'; record: RecordRef }                 // 레코드 칩
    | { type: 'tool'; toolCallId: Id; activity: ToolActivityVM }
  >;
  at: IsoTime; author: ActorRef;
}
```

### 3.8 시각화 [제안]

시각화 부품은 `ui/viz/`에 둔다. 공통 규칙: (1) 문장이 들어가는 구조는 그림보다 목록·트리로 그린다(§2.5.5), (2) 색만으로 관계·상태를 나타내지 않는다, (3) 모든 시각화는 `toLinearText`를 갖는다, (4) 그림이 아닌 표·목록 대체 보기를 따로 두지 않아도 되게 처음부터 목록 구조로 만든다.

#### 3.8.1 근거 체인 `EvidenceChainTree`

판단·선택·결과 확인 어디서든 근거를 따라 내려간다(v0.3 09 §4.7, 원천의 Inquiry Map, `SCR-EVIDENCE`와 인스펙터).

입력은 `EvidenceChainView`(04 §3.15)다. 뷰는 노드를 평탄한 목록(`nodes[]`, `parent`로 연결)으로 준다. 부품은 이를 트리로 바꿔 그린다.

```ts
// apps/desktop/src/ui/viz/EvidenceChainTree/buildTree.ts
export interface EvidenceTreeNode {
  /** 이 트리 안에서만 유일한 키(레코드 id + 경로) */
  key: string;
  node: EvidenceChainView['nodes'][number] | { root: EvidenceChainView['root'] };
  /** 같은 레코드가 트리 위쪽에 이미 있으면 그 key. 자식은 비운다 (공유·순환 처리) */
  repeatOf?: string;
  /** parent가 목록에 없음(권한·삭제·아직 안 받음) */
  orphan?: boolean;
  children: EvidenceTreeNode[];
}
/** 순수 함수. 관계별 고정 순서(무효화 → 반대 → 한정 → 지지)로 자식을 묶고, 같은 관계 안은 뷰 순서를 지킨다 */
export function buildEvidenceTree(view: EvidenceChainView): EvidenceTreeNode;

export interface EvidenceChainTreeProps extends L2Common {
  view: EvidenceChainView;
  expanded: Set<string>;
  onExpandedChange: (s: Set<string>) => void;
  selected?: string;
  onSelect: (key: string) => void;       // 인스펙터 연동
}
```

그리는 규칙:

```text
판단 15  첫 화면 지연의 주원인은 순차 요청          반대 근거: 찾아봤음, 1건 남음
├─ 반대   관찰 8  데스크톱도 1.9s인데 불만 적음          → 아직 모르는 점으로 남음
├─ 한정   관찰 11 측정은 3G 모의 환경에서만 함           간접 · 일부 범위
├─ 지지   관찰 2  첫 렌더 전 API 4개 순차 호출           도구 실행 · 10월 11일 13:40 · 직접
└─ 지지 [구분 확인] 관찰 9  3번째 요청 제거 시 LCP 4.1s → 2.9s   도구 실행 · 커밋 a1b2c3 [낡음: 파일이 바뀜]
```

- 관계는 글자 라벨(지지/반대/한정/무효화) + 아이콘(§3.4)으로 쓴다. 연결선은 장식이다.
- 자식은 관계별 고정 순서로 묶는다. 반대·무효화 근거가 아래로 밀려 안 보이는 일을 막는다(UP-6). 반대·무효화 노드는 깊이와 상관없이 접지 않는다. 지지 노드는 한눈에 깊이에서 첫 2개만 보이고 "지지 근거 더 보기"로 접는다(개수를 강도처럼 쓰지 않으려고 "n개" 대신 "더 보기").
- 근거 품질(`quality`)은 `CertaintyDescriptor`의 칸으로 옮긴다: `direct` → 직접성, `fresh` → 낡음 배지, `coverage` → "일부 범위", `independentOf` → "같은 출처 계열" 표시, `falsifier` → 검토 깊이의 "이것이 관찰되면 틀림". 숫자 점수는 없다(§3.5.6).
- 루트의 반대 근거 탐색 상태(`counterSearch`): `searched_none` "반대 근거를 찾아봤지만 없었음", `found` "남은 반대 근거 n건", `searching` "찾는 중", `not_searched` 경고 "반대 근거를 찾아보지 않음". 판단 승격 규칙상 판단에 `not_searched`는 생기지 않아야 하므로(v0.3 02 §2.1) 나타나면 데이터 이상으로 보고 감사 깊이에 seq를 보인다.
- 출처(`source`): 종류(도구·사람·외부·파일), 참조, 해시·커밋. 펼치면 `SourceTrace`.
- `repeatOf`는 "위의 관찰 2와 같음"으로 쓰고 그 노드로 이동하는 링크를 둔다. `orphan`은 "볼 수 없는 레코드"로 쓴다.
- 트리 아래에 아직 모르는 점(`unknowns`)과 "이것이 바뀌면 다시 열리는 것"(`reopensIfChanged`)을 둔다.
- 깊이: 한눈에 = 루트와 직접 자식 한 줄씩. 검토 = 3단계까지 펼침. 감사 = 레코드 id, seq, 출처 전체.
- 노드가 500개를 넘으면 펼친 노드만 평탄화해 `VirtualList`로 그린다(tree 의미는 `aria-level`·`aria-setsize`·`aria-posinset`으로 유지).

키보드: WAI-ARIA tree 패턴(↑/↓, →/←, Home/End, Enter 이동, Shift+Enter 인스펙터, `*` 형제 펼침). 접근성: 노드 이름 = "관계, 종류 번호: 제목, 상태". 예: "반대 근거, 관찰 8: 데스크톱도 1.9s인데 불만 적음, 아직 모르는 점으로 남음".

#### 3.8.2 루프 타임라인 `LoopTimeline`, `LoopPlanStrip`, `LoopPathMini`

한 Concern이 어떤 루프를 거쳤고 언제 왜 바뀌었는지 보인다(v0.3 09 §4.2, v0.3 03 §8, `SCR-LOOPS`).

입력: `LoopTimelineView`(04 §3.13: 구간 `segments`, 전환 `transitions`, 상황 판정 변화, 모드 변화)와 `ConcernView.loopPlan`(계획 단계와 상태 `done | current | planned | skipped`).

```ts
export interface LoopTimelineProps extends L2Common {
  view: LoopTimelineView;               // 04 §3.13
  plan: ConcernView['loopPlan'];
  /** meaningful이 기본 (helm-canon-3 §6.8). 뷰 파라미터 detail과 같은 값 */
  detail: 'meaningful' | 'all';
  onDetailChange: (d: 'meaningful' | 'all') => void;
}
```

```text
계획  O ✓ → I.want ✓ → C.probe ✓ → A.watch (건너뜀) → C.commit ● → A.confirm      (에이전트가 정함 · 이의)
실제  O → I.want → C.probe → S.split → I.want → C.commit                          계획에 없던 전환 1

10/11 09:02  상황 파악     상황 판정: 복합 (에이전트 판정 · 이의)          산출: 상황 판정 1
10/11 09:10  원함 탐구     자극 6개 · 반응 14 · 기준 후보 3                  주요: 기준 후보 2
10/11 14:05  → 구조: 나누기  이유: '주제'와 '형식'의 선호가 따로 움직임  계기 관찰 31   (에이전트가 정함 · 이의)
             … 그 밖의 기록 14건 (펼치기)
```

- `LoopPlanStrip`: 계획 단계와 실제 경로를 두 줄로. 상태는 기호(✓ 끝남, ● 지금, 빈칸 예정, "건너뜀" 글자)와 글자로 쓴다. 계획에 없던 전환(`planned: false`)을 오류로 표시하지 않고 정보로 표시한다(결정 5).
- 전환 항목: 출발 → 도착(03 §3.3.7 라벨), 이유, 계기 레코드 칩, 결정 주체, 혼자 정한 것이면 `ContestButton`, 이의 걸렸으면 배지.
- 구간 항목: 루프, 시작·끝, 산출물 종류별 개수(`outputs`), 주요 레코드(`notable`). 산출물 개수는 "무엇이 생겼나" 목록이며 진척 점수로 쓰지 않는다.
- 상황 판정·모드 변화는 같은 목록에 시간 순으로 끼운다.
- 세로 목록(`ol`)이다. 가로 시간 막대 그림을 쓰지 않는다. 한국어 이유 문장이 길고, 시간 간격보다 순서가 중요하기 때문이다.
- `LoopPathMini`: 최근 루프 5개를 칩으로 잇는 한 줄. `ConcernTree` 노드와 `ScopeBar`에서 쓴다.
- 키보드: 목록 화살표 이동, Enter 레코드 열기, 필터 전환 단축키는 05 §3.8. 접근성: 항목마다 "시각, 루프, 내용".

#### 3.8.3 자극 보드 `StimulusBoard`

원함 탐구(I.want, UC-01, `SCR-STIM`)의 반응 입력이다(v0.3 04 §3, 09 §4.6). 화면 배치·상호작용·뷰 모델은 04 §3.9, 흐름 규칙은 05 §3.2가 정본이다. 이 절은 부품 계약과 시각 규칙만 정한다.

입력: `StimulusRoundView`, `ReactionView`(04 §3.9). 자극 내용은 글(`markdown` + 데몬이 나눈 요소 `elements: {id, range}`), 그림(데몬 HTTP `url`), 링크(요약 + 요소). 요소 단위 반응의 대상은 데몬이 정한 요소 id와 그림 영역(정규화 사각형)이다.

```ts
export interface StimulusBoardProps extends L2Common {
  view: StimulusRoundView;              // 04 §3.9
  /** 선택한 자극 또는 요소 (반응 막대의 대상) */
  selection?: { stimulus: string; element?: string; region?: [number, number, number, number] };
  onSelectionChange: (s: StimulusBoardProps['selection']) => void;
  /** 부분 고르기 모드 (04: E 키) */
  elementMode: boolean;
  onElementModeChange: (v: boolean) => void;
  /** 연결이 없을 때 기기에 둔 반응(보내지 않음). 보존은 20 */
  unsent: ReactionRecordParams[];
  onSendUnsent: () => void;
}
/** reaction.record의 인자 (19 §3.7.5). 아래 kind는 04 ReactionView.kind와 같다 */
export type ReactionRecordParams = {
  target: { stimulus: string; element?: string; region?: [number, number, number, number] };
  kind: 'strength' | 'no_reason' | 'rewrite' | 'near' | 'triad_odd' | 'comment';
  strength?: -2 | -1 | 0 | 1 | 2;
  reason?: string; rewrite?: string; triadId?: string;
};
```

부품 규칙:

| 대상 | 규칙 |
|---|---|
| 순서와 라벨 | 뷰가 준 순서와 섞은 글자 라벨(A, B, …)을 그대로 쓴다. 정렬·필터 조작을 두지 않는다(첫 자극 끌림 방지, v0.3 04 §3.2). 극단 자극 표시는 하지 않는다(04 §3.9). 출처 종류(초안·레퍼런스·사례·비유)와 "다른 분야" 이름은 보인다 |
| 요소 표시 | 부분 고르기 모드에서 글의 요소마다 `[a1]` 같은 표시. 요소 구간(`range`)은 데몬이 준 것이다. 부품은 마크다운을 렌더링한 뒤 요소를 감싸야 하므로 `range`가 렌더 전 원문 기준인지 렌더 뒤 평문 기준인지 15·04가 정해야 한다(§5.2). 기본값 [제안]: 데몬이 요소별 평문 조각을 함께 보내고, 부품은 조각 단위로 감싼다 |
| 그림 영역 | 마우스는 끌기, 키보드는 3×3 격자 칸을 화살표로 고르고 Space로 묶기. 결과는 정규화 사각형 |
| 반응 막대 | 강도 다섯 단계(글자 "아주 싫음 / 싫음 / 상관없음 / 좋음 / 아주 좋음" + 기호 −−/−/0/+/++), 이유 없이 아님, 고쳐 말하기, 부분 고르기, 가깝다 표시, 이유 입력(선택). 이유를 요구하지 않는다(결정 18) |
| 반응 표시 | 하이라이트 배경 + 밑줄 모양(좋음 실선, 싫음 물결, 이유 없음 점선, §3.2.2 `--helm-react-*`). 그림은 사각형 테두리 모양 + 번호. 색만으로 구분하지 않는다 |
| 세 개 비교 | 뷰에 `triad`가 있으면 격자 위 띠로. "다른 하나"를 고르고 이유 또는 "말로 못 하겠음". 가장 좋은 것을 고르는 UI가 아니다 |
| 기준 후보 | 라운드를 마치기 전에는 보이지 않는다(`revealAfterClose`, 04 §3.9). 반응이 기준 후보에 끌리지 않게 한다 |
| 말한 것과 반응의 차이 | `statedVsRevealed`를 오른쪽 패널에 항상 보인다. 이 차이가 Helm의 출발 가정이 실제로 일어난 사례다(v0.3 04 §3.4) |
| 반응 철회 | 지우지 않고 철회 기록(`reaction.withdraw`). 철회된 반응은 취소선 + "철회" |
| 라운드 마치기 | `stimulusRound.close`. 켜지는 조건은 05 §3.2.5가 정한다. 부품의 기본 가드 [제안]: "가깝다 표시"(`near`)만 있고 다른 반응이 없으면 끄고, "어떤 부분이 가까웠는지 표시하면 다음 자극이 정확해집니다"와 "이유는 모르겠지만 좋음/아님" 빠른 버튼을 보인다(§3.9 R1). 모든 자극에 반응하라고 요구하지 않는다 |
| 연결 끊김 | 반응을 "보내지 않음"으로 받아 두고, 다시 연결되면 "보내지 않은 반응 3개 보내기"를 사람이 누른다(04 §3.9, §3.6.4 예외) |

반응은 하나씩 바로 기록된다(`reaction.record`, 04 §3.9). 반응은 사람의 결정이 아니라 관찰이므로 한 글자 단축키(04: `1`~`5`, `N`, `R`, `E`, `G`)를 쓴다. §3.6.5의 "결정에는 한 글자 단축키 없음" 규칙에 걸리지 않는다. 단축키는 반응 막대가 대상(자극·요소)을 가질 때만 동작한다.

상태: 기본, 반응 있음, 보내지 않음(오프라인), 라운드 마침(읽기 전용, 기준 후보 공개), 다음 라운드 준비 중, 자극 불러오기 실패(그 카드만 "다시"), 멈춤 조건 충족 안내(04 §3.9).

접근성: 자극 카드는 `article`, 이름 = 라벨 + 출처 종류. 글 요소는 `mark` 요소로 감싸고 반응 상태를 `aria-describedby`로 읽는다. 반응을 더하면 `aria-live`로 "D, 요소 a1에 좋음". 그림 영역 반응은 "G, 위 왼쪽 영역에 좋음"처럼 격자 이름으로 읽는다.

`PreferenceModelPanel` 선호 모델: 입력 `PreferenceModelView`(04 §3.8). 기준(이름, 무게 글자 high/medium/low → "중요함/보통/덜 중요함", 근거 반응·반대 반응 칩, 확인 여부), 좋았던 예·싫었던 예(자극 칩), 말한 것과 반응의 차이(항상 펼침), 다시 볼 조건. 무게·확신도 숫자는 그리지 않는다(§3.5.6). 기준 후보 확인은 질문(`QuestionCard`, 04 §3.4 기준 확인)으로 한다.

#### 3.8.4 Goal 이력 `GoalHistory`

Goal이 Concern 사이클을 거치며 어떻게 바뀌었는지 보인다(결정 11, v0.3 09 §4.8, UC-09, `SCR-GOAL`).

입력: `GoalView`(04 §3.16: 현재 버전, 상태, 서술·성공 조건·지킬 것, 상위·하위 Goal, 선호 모델, 확인 기다리는 수정 제안, 버전 이력).

```ts
export interface GoalHistoryProps extends L2Common {
  view: GoalView;                       // 04 §3.16
  /** 두 버전 비교. 버전 본문은 04 view:goal에 버전 파라미터로 요청한다고 가정 [가정] */
  compare?: [number, number];
  onCompareChange: (v?: [number, number]) => void;
  versionBodies?: Record<number, { statement: string; successCriteria: string[]; preserve: string[] }>;
}
```

- 맨 위: 확인 기다리는 수정 제안(`pendingRevision`) 카드. 초안 형식(UP-7, `DraftMark`). 칸별 차이(`changes[].before/after`)를 어절 단위로 보인다. 지운 부분은 `del`(취소선 + `diff-remove` 배경), 더한 부분은 `ins`(밑줄 + `diff-add` 배경). 계기(`triggers`)와 다시 확인 대상이 될 작업 합의(`affectedAgreements`)를 함께 보인다. 행동: 확인(`goal.confirmRevision`, `consequence`: "작업 합의 2개가 다시 확인 대상이 됨"), 고쳐서 확인(칸 편집 후 `goal.revise`), 거절(`goal.rejectRevision`). 이 확인은 질문(`SCR-QUESTION`의 Goal 확인)으로도 들어온다.
- 아래: 버전 세로 목록(최신 먼저, 제목에 그렇게 적음). 버전마다 바뀐 칸, 계기(어느 Concern의 어느 관찰·반응), 확인한 사람. 두 버전을 골라 비교.
- 하위 Goal로 나뉜 경우 "하위 Goal로 나뉨"과 링크.
- 긴 문장의 차이는 바뀌지 않은 어절을 앞뒤 5어절만 남기고 접는다.
- 접근성: 차이는 `ins`/`del` 요소라 스크린 리더가 "삽입", "삭제"로 읽는다. 버전 목록은 `ol`.

#### 3.8.5 상태 지표

연결 상태, 뷰 신선도, 진행 중 작업 상태, 도메인 상태를 하나의 "상태"로 합치지 않는다(helm-canon-2 §3.16, 20 §3.8.8).

**`ConnectionIndicator` 연결 상태** — 상태 판정과 문구는 04 §3.0.4·20 §3.8.9. 부품은 다음을 받아 그린다.

```ts
export interface ConnectionVM {
  state: ConnectionUiState;             // §3.6.2, 04 §3.0.4의 아홉 상태
  route: { kind: 'tailscale_wss' | 'ssh'; name: string };   // 결정 26·38, 20 §3.8.1 연결 프로필
  lastReceivedAt?: IsoTime;
  retry?: { attempt: number; nextAt: IsoTime };
  versions?: { app: string; daemon: string };
  /** 막힘 사유별 할 일 (20 §3.8.9) */
  action?: { labelKey: string; target: ScreenId };
}
```

| 상태(04 §3.0.4) | 창 머리 표시 | 펼침(팝오버) |
|---|---|---|
| 연결됨 | 점 + "연결됨 · <경로 이름>" | 경로, 마지막 수신 시각, 개발자 보기에서 seq |
| 느림 | 점(경고) + "연결 느림" | 원인 문장 |
| 다시 연결하는 중 | 점 + "다시 연결하는 중 · 12초 전 끊김" | 다음 시도 시각, "지금 다시 시도" |
| 다시 맞추는 중 | 점 + "맞추는 중" | — |
| 연결 안 됨 / 데몬 응답 없음 / 인증 실패 / 버전 불일치 / 복구 모드 | 점(위험) + 상태 이름 | 사유와 할 일(`SCR-CONNECT`, `SCR-RECOVERY`) |

점은 장식이고 상태는 항상 글자로 쓴다. 회전 아이콘을 쓰지 않는다(UP-12).

**`PendingQuestionsIndicator` 대기 질문**

```ts
export interface PendingQuestionsVM {
  choiceNeeded: number;                 // 선택 필요(권리 게이트)
  niceToCheck: number;                  // 확인하면 좋은 것
  approaching: number;                  // 만료점 가까움
}
```

창 머리와 레일의 질문함 배지에 "선택 필요 2"(강조 막대, 0이면 숨김)와 "확인 3"(보조 글자)을 따로 보인다. 만료 임박이 있으면 "곧 만료 1"을 경고 색 글자로 더한다. 누르면 `SCR-INBOX`. 같은 값을 트레이·메뉴 막대(20, `SCR-TRAY`)가 쓴다. 숫자가 늘어도 깜박이거나 소리를 내지 않는다. 알림은 전달 방식에 따라 11·20이 정한다.

**`AttentionBudgetMeter` 주의 예산** — 주의 예산의 단위와 배분은 14가 정한다(브리프 §3.5). 04 `HomeView.attentionBudget`은 다이얼 값(숫자 하나)이다. 부품은 단위를 모르는 채로 그린다.

```ts
export interface AttentionBudgetVM {
  unitLabel: string;                    // 14가 정한 단위의 표시 이름 ("질문", "분")
  windowLabel: string;                  // "오늘", "이번 복귀까지"
  used: number;
  scheduled?: number;                   // 예약되어 다음 경계에 전달될 몫
  limit?: number;                       // 없으면 막대 없이 숫자만
  nextBoundaryLabel?: string;           // "다음 묶음: 라운드 끝"
}
```

SVG 막대 하나(사용 / 예약 / 남음 세 칸, 칸마다 글자 라벨과 무늬 차이)와 문장 "오늘 질문 4 / 6 · 예약 2 · 다음 묶음: 라운드 끝". 질문함 머리와 다이얼 화면에 둔다. 점수·연속 기록 같은 게임 요소를 쓰지 않는다(helm-canon §21 01 항목 "게임화 금지"). 14가 더 자세한 값을 주기 전까지 1차 구현은 `limit = HomeView.attentionBudget`, `used = 전달된 질문 수`로 그린다 [가정].

#### 3.8.6 탐구 보드 `InquiryBoard`와 하위 시각화

`InquiryBoard`는 `SCR-INQUIRY`의 본문이다. 입력은 `InquiryView`(04 §3.8)이고, 탐구 종류 탭(`kinds`: 라운드, 멈춤 진행, 예산)에 따라 하위 부품을 고른다(v0.3 09 §4.5). 모든 탐구 보드에서 대비 압축을 적용한다: 뷰가 준 순서로 앞의 항목을 보이고 나머지를 접되(`folded`), 접힌 항목도 펼쳐 반응할 수 있고 반대 근거·이견은 접지 않는다.

| 탐구 | 하위 부품 | 입력(04 §3.8) | 보이는 것 |
|---|---|---|---|
| 사실(I.fact) | `HypothesisBoard` | `fact` | 관점(`frames`: 예측과 반박 조건), 후보(지지·반대 `StatementView`, 순위), 다음 구분 확인(`nextChecks`: "이 확인으로 구분되는 후보: A, C", 비용, 순서 이유, 사람이 고정한 것), 후보별 반대 근거 탐색 상태, 승격된 판단 |
| 원함(I.want) | `StimulusBoard` 진입, `PreferenceModelPanel`, 기준 후보 목록 | `want` | 라운드 목록, 선호 모델, 기준 후보와 확인 질문, 말한 것과 반응의 차이 |
| 가능성(I.possibility) | `DivergenceTable`, `PossibilityComparison` | `possibility` | 발산 표, 렌즈로 만든 관점 표시, 가능성(근거 유무로 묶음, 같은 출처 계열 표시) |
| 결과(I.outcome) | `PredictionList`, `PremortemList` | `outcome` | 예측(근거, 실패 경로와 대응·감시 신호, 확인 날짜·방법, 결과), 사전 부검, 세 시나리오 |

- 발산 표 칸: `filled` ●, `empty` ○, `na` · 기호와 글자 라벨을 함께 쓴다. 해당 없음은 이유(`naReason`)를 칸 안에 쓴다. 칸을 누르면 그 칸의 가능성. 표는 `table`, 칸 이름 = "관점 2 × 도구: 채워짐, 가능성 1개".
- 가능성 비교는 P07 표 형식(가능성 / 지지 근거 / 반대 근거 / 다음 확인, helm-canon §17.8)이다. 행마다 고르기 버튼을 두지 않는다. 행 행동은 "이 가능성에 말하기"(범위 입력창), "근거 보기", "후보 제안"(`inquiry.proposeCandidate`), "이의". 가능성 사이의 선택이 필요하면 런타임이 질문 레코드를 만들고 `QuestionCard`로 나타난다(`inquiry.requestDecision`로 사람이 요청할 수도 있다).
- 사실 탐구의 다음 확인 고정(`inquiry.pinCheck`), 관점 요청(`inquiry.requestFrame`), 전제 표시(`inquiry.markAssumption`), 탐구 멈춤(`inquiry.stop`)은 각 항목의 행동으로 둔다.
- 예측 목록: 확인 날짜가 지난 예측은 결과와 함께 위로 올린다(정렬은 뷰).
- 탐구 진행 중이면 갱신은 라운드 경계 단위로 보이고 중간 결과에 "진행 중"을 붙인다(04 §3.8).

### 3.9 대안 고르기 UI를 만들지 않는 규칙 [제안: 규칙 / 결정 18: 원칙]

결정 18은 "대안 2~3개를 던지고 고르게 하는 상호작용"을 거부했다. 원함 탐구에서는 반응을 받고 기록하며, 모델이 초안을 쓰고 사람은 반응·수정한다. 이 원칙이 개별 화면 설계에서 다시 새어 들어오지 않도록 컴포넌트 API와 검사로 막는다.

| 규칙 | 내용 | 강제 방법 |
|---|---|---|
| R1 원함 탐구에는 선택지가 없다 | 원함 탐구에서 온 질문(`origin.inquiry === 'want'`)에서 `QuestionCard`는 추천·다른 선택·`pickOne` 답 형태를 그리지 않는다(04 §3.4). 자극 보드는 "가깝다 표시"(`near`)만으로 라운드를 마칠 수 없다(기본 가드, 최종 조건은 05 §3.2.5). 자극 보드에는 "가장 좋은 것 고르기" 행동이 없다 | 부품 내부 규칙(뷰에 값이 와도 그리지 않고 개발 모드 경고). 테스트: §6.3 금지 패턴 테스트 |
| R2 결정 카드의 행동 묶음 | 질문 카드는 주 버튼(최대 3개) 밖에 "그 밖에" 줄(기준 고치기, 질문 다시 쓰기, 먼저 탐구, 맡기기, 미루기, 이의)을 메뉴에 숨기지 않고 항상 보인다(04 §3.4). `[승인] [거절]`, `[확인] [계속]`만 있는 버튼 줄을 만들지 않는다. 권리 게이트의 허락 버튼은 대상과 효과를 문구에 쓴다(`OptionView.actionLabel`) | `QuestionCard`가 "그 밖에" 줄을 내부에서 만든다(화면이 뺄 수 없음). 테스트: 결정 의도 버튼만 있고 "그 밖에" 줄이 없는 카드 이야기가 있으면 실패 |
| R3 대안 표시는 순서만 바꾼다 | 대비 압축은 보여 주는 순서만 정한다. 어떤 부품도 `maxOptions` 같은 자르기 prop을 갖지 않는다. `initiallyVisible`은 처음 보이는 개수이고, 나머지는 같은 자리에서 펼쳐 반응할 수 있다. "2개 중 고르세요" 같은 개수 문구를 쓰지 않는다 | 타입(자르기 prop 없음), 문구 테스트 |
| R4 고르기 부품의 사용 위치 제한 | `RadioGroup`, `Select`, 단일 선택 `SegmentedControl`은 설정·다이얼·필터·분류 입력(관찰 제안 기각 사유)에서만 쓴다. 사실 질문의 `pickOne` 답 형태(04 §3.4)는 `QuestionCard` 안의 전용 부품(`AnswerChoices`)으로만 그리고, 이 부품은 `origin.inquiry !== 'want'`일 때만 렌더된다. `ui/viz/inquiry/`, `ui/viz/StimulusBoard/`에서 단일 선택 부품을 가져오면 정적 검사가 실패한다 | `no-restricted-imports` 폴더 규칙(§6.4) |
| R5 초안 먼저 | 사람이 내용을 채워야 하는 부품(작업 합의, Goal 수정, 기준 수정)은 초안이 있는 상태로 열린다. 초안이 아직 없으면 빈 양식 대신 "초안을 만드는 중"과 직접 쓰기 선택을 보인다. 초안은 `DraftMark`로 표시하고 사람이 고친 칸은 "내가 고침"으로 바뀐다 | 부품 계약(`fields`가 비면 빈 상태 렌더러), 이야기 |
| R6 반응을 결정으로 취급하지 않음 | "가깝다 표시"(`near`), 세 개 비교의 "다른 하나"(`triad_odd`), 강한 좋음(`strength: 2`)은 반응 관찰로만 올라간다. 화면이 이를 선택(Choice)·완료로 표시하지 않는다 | `StimulusBoard`는 반응을 "기록됨"으로만 표시 |
| R7 금지 문구 | "A와 B 중 무엇을 원하시나요?", "어느 쪽이 좋으세요?", "계속할까요?", `[승인] [거절]` | 문구 테스트(05·22가 목록 확정) |

허용되는 것: 사실·가능성·결과 탐구 뒤의 결정 질문에서 추천과 가장 강한 다른 선택을 보이는 것(helm-canon-3 §7.1 C2). 셋 비교(레퍼토리 그리드)에서 "다른 하나"를 고르는 것(차이의 이유를 묻는 장치이며 고르기로 라운드를 끝내지 않는다, conversation-extracts-4 6-8 발췌자 메모). 다이얼 값 고르기(설정).

### 3.10 assistant-ui 활용 범위 [제안]

#### 3.10.1 쓰는 곳

| 쓰는 것 | 용도 | 확인 |
|---|---|---|
| `@assistant-ui/react` 0.15.27 primitives(`ThreadPrimitive`, `MessagePrimitive`, `ComposerPrimitive`) | 객체별 대화 스레드(`ConversationThread`)의 구조·키보드·스크롤 | peer `react ^18 \|\| ^19`, MIT. primitives는 "Stable"(3개월 이상 예고 후 폐기) [검색: npm, assistant-ui deprecation policy] |
| `useExternalStoreRuntime` | 메시지와 영속성을 Helm이 소유. `messages`, `isRunning`, `onNew`, `onCancel`, `convertMessage`만 쓴다 | `onNew`가 일을 시작하고 일찍 돌아가는 방식(소켓 메시지 전송)을 문서가 다룬다 [검색: docs/runtimes/custom/external-store] |
| `defineToolkit`(`type: 'backend'`, 렌더 전용) | 대화 안의 도구 실행을 `ToolActivityLine`으로 그린다 | 도구 UI 등록은 toolkit 방식이고 `makeAssistantToolUI`는 폐기 예정 [검색: docs/tools/tool-ui, migrations/toolkit-tools] |
| `ThreadPrimitive.Viewport` 자동 스크롤 | 새 메시지 따라가기. WKWebView는 `overflow-anchor`가 Safari 27부터라 CSS로 할 수 없다 [검색: MDN BCD] | [지식: Viewport가 JS로 자동 스크롤] |

연결 구조:

```text
데몬 이벤트(seq) ──19──▶ 앱 저장소(20) ──selector──▶ ThreadMessageVM[] ──convertMessage──▶ ExternalStoreRuntime ──▶ ConversationThread
사람 입력 ──ComposerPrimitive──▶ onNew(text) ──▶ UiIntent composer.submit ──▶ 20 useCommand ──▶ 19 ──▶ 커널(conversation.input)
                                                        (화면에 메시지를 먼저 넣지 않는다. 데몬이 기록한 메시지가 스트림으로 돌아올 때 그린다: UI-D03)
```

- 사람 메시지를 보낸 직후에는 입력창 아래에 "보내는 중"만 보이고, 데몬이 기록한 사람 발화가 스트림으로 돌아오면 스레드에 나타난다. 지연이 체감되면(300ms 이상) 보낸 글을 "보내는 중" 상태의 회색 말풍선으로 보일 수 있으나, 이것은 화면 표시용 초안이며 저장소에 넣지 않는다 [제안].
- 대화 스레드는 홈이 아니다. Concern의 대화 탭(`SCR-THREAD`, 03 §3.6)과, 질문·작업 합의·결과 확인 화면 안의 접힌 객체 스레드로 붙는다(UP-1). 전역 대화 화면을 두지 않는다. 03 IA-Q4(대화 탭에 assistant-ui를 쓸지)에 대한 답: 쓴다(UI-D11).

#### 3.10.2 쓰지 않는 곳과 이유

| 기능 | 쓰지 않는 이유 |
|---|---|
| 상태 화면 전체(홈, Concern 트리, 질문함, 근거 체인, 다이얼, 에이전트가 정한 것, Goal 이력) | assistant-ui에 대응 요소가 없거나(v0.3 14 §5.2) Helm 의미 규칙(§3.5, §3.9)을 따라야 한다 |
| 도구 승인(`approval`, `respondToApproval`, `onRespondToToolApproval`), Approval card | 사람의 결정은 모델 도구 경로를 거치지 않고 데몬의 결정 메서드로 간다(conversation-extracts-4 20-9). 승인/거절 두 갈래 구조가 §3.9 R2와 맞지 않는다. `onRespondToToolApproval`을 넣지 않으면 승인 응답이 능력 오류를 던진다 [검색: `@assistant-ui/core` d.ts]. 그래서 승인 파트를 메시지에 만들지 않는다(`convertMessage`가 만들지 않음) |
| `onAddToolResult`, `onResumeToolCall` | 같은 이유. 도구 결과는 런타임만 기록한다(v0.3 02 §8.1 관찰) |
| `onEdit`, `onReload`, `setMessages`(가지 전환) | 지난 메시지를 고치거나 다시 생성하면 기록을 다시 쓰는 것처럼 보인다. Helm 기록은 덧붙이기만 한다. 다시 말하려면 새 메시지를 보낸다 |
| Interactables(`unstable_useInteractable`) | 모델의 편집이 커널을 거치지 않고 앱 상태에 바로 적용된다(v0.3 14 §5.1). 모델은 제안만 한다(결정 14) |
| 생성형 UI(`@assistant-ui/generative-ui` 0.0.2, `aui()` 컴파일러 플러그인) | 패키지가 매우 초기다 [검색: npm]. 모델이 화면을 조립하면 §3.9 규칙(선택지 개수, 행동 묶음)을 부품 계약으로 보장할 수 없다. 가능성 비교는 `PossibilityComparison`으로 직접 만든다. 원천은 "시험만"이었으나 1차 범위에서 시험도 하지 않는다 |
| Component Tools, `makeAssistantVisible`, Model Context | 모델이 앱 화면을 읽고 조작하는 통로다. 모델 컨텍스트는 데몬의 투영(12)에서만 만든다(불변조건 3, A11) |
| AssistantTransport | HTTP fetch 기반 상태 스트림이고 형식이 SSE로 바뀔 예정이다 [검색: docs/runtimes/custom/assistant-transport]. Helm은 JSON-RPC over WebSocket + seq 재전송이다(결정 31) |
| Assistant Cloud | 외부 SaaS다 [검색: docs/cloud/pricing]. 영속성은 데몬이 맡고, 외부 서비스에 기록을 올리지 않는다 |
| Elements(Approval card, Timeline, Flow graph, Background runs, Canvas split, Artifact card, Trace waterfall) | 독립 모드로 쓸 수 있고 MIT 소스 복사 방식이다 [검색: assistant-ui.com/elements]. 그러나 (1) 공통 표면이 `tw-shimmer` 반복 애니메이션을 끌어온다(UP-12와 충돌) [검색: r.assistant-ui.com 레지스트리], (2) `forwardRef` 없이 쓰여 React 18에서 ref가 전달되지 않는다, (3) Helm 의미(관계 라벨, 품질 상태, 행동 묶음)를 넣으면 거의 다시 쓰게 된다. 설치하지 않고, 배치를 참고할 때만 소스를 읽는다 |
| reasoning(사고) 파트 | 모델의 사고 텍스트는 근거가 아니다(helm-canon-3 G15). `convertMessage`에서 버린다 |
| 음성, 받아쓰기, 첨부 어댑터 | 1차 범위 밖. 첨부는 19의 HTTP 전송이 정해지면 다시 본다 |

#### 3.10.3 대화 기록 d25의 물음에 대한 답

| 물음(conversation-extracts-4 d25) | 답 |
|---|---|
| Tauri 데스크톱 앱에서 쓸 때의 제약 | primitives와 ExternalStoreRuntime은 Next.js가 필요 없고 Vite SPA에서 쓸 수 있다 [검색: CLI 템플릿, 런타임 문서]. 공식 Tauri 안내는 없고 작은 공개 사례만 있다 [검색: GitHub]. WKWebView의 `overflow-anchor` 미지원은 Viewport의 JS 스크롤로 해결된다. `assistant-cloud` 의존성이 `ai`, `@opentelemetry/*`를 peer로 선언해 설치 경고가 날 수 있다 [검색: npm]. pnpm `peerDependencyRules`로 정리한다(06·20) |
| Background runs가 assistant-ui "run" 개념에 묶이는가 | 독립 모드가 있어 묶이지 않는다 [검색: elements/background-inbox]. 그러나 Helm은 `ActiveRunDrawer`와 `ActiveWorkCard`를 직접 만든다(이유는 위 Elements 행) |
| 요소 단위 반응 UI를 그 위에 만들 수 있는가 | 만들 수 있으나 만들지 않는다. 자극 보드는 대화 스레드가 아니라 상태 화면이고, Interactables를 쓰지 않으므로 얻는 것이 없다. `StimulusBoard`를 직접 만든다 |
| 생성형 UI 컴포넌트를 Helm 카드로 정의할 수 있는가 | 정의할 수는 있으나(어휘 목록, 동작 핸들러) 쓰지 않는다(위 표) |

#### 3.10.4 고정과 교체 가능성

- `@assistant-ui/react`는 정확한 버전으로 고정한다(0.x이고 스타일 부품은 Beta). primitives만 쓰므로 영향 범위가 작다.
- assistant-ui 의존은 `ui/conversation/` 폴더 안에만 둔다. 다른 폴더가 `@assistant-ui/*`를 가져오면 정적 검사가 실패한다(§6.4). 맞지 않게 되면 이 폴더만 직접 구현으로 바꾼다. 대화 스레드는 Helm의 주 화면이 아니라 교체 비용이 작다(v0.3 13 §2.4).

### 3.11 화면 → 컴포넌트 매핑 [제안, 화면 ID는 03 §3.6]

화면 ID와 화면별 레이아웃은 03 §3.6과 04 §3.x가 정한다. 아래는 각 화면이 쓰는 부품이다.

| 화면 ID | 화면 | 주 컴포넌트 | 유즈케이스 |
|---|---|---|---|
| `SCR-HOME` | 홈 | `GoalSummary`, "마지막 확인 이후" 띠(`SinceLastVisit` 요약 판), 주의 카드(`QuestionCard` 접힘), `ActiveWorkCard`(한눈에), 다가오는 것 목록(`AssumptionExpiry`, `TimeStamp`), `ConcernTree` | UC-03, UC-06 |
| `SCR-BRIEF` | 복귀 요약 | `SinceLastVisit`, `MaterialChangeGroups`, `QuestionCard`(접힘), `ActiveWorkCard`, `AutonomousChoiceList`(개수, 접힘) | UC-06, UC-05 |
| `SCR-INBOX` | 질문함 | `QuestionInbox`, `QuestionCard`(오른쪽 펼침), `AttentionBudgetMeter` | UC-04, UC-07 |
| `SCR-QUESTION` | 질문 | `QuestionCard`(펼침), `ReversibilityNote`, `CertaintyDescriptor`, `ChoiceImpactEcho`, `ConversationThread`(접힘) | UC-02, UC-04, UC-07 |
| `SCR-AUTO` | 에이전트가 정한 것 | `AutonomousChoiceList`, `ContestButton` | UC-05 |
| `SCR-CONCERNS` | Concern | `ConcernTree`(전체) | — |
| `SCR-CONCERN-OVERVIEW` | Concern 개요 | `ScopeBar`, `SituationChip`, `LoopPlanStrip`, `ActiveWorkCard`, `AssumptionExpiry` 목록, `QuestionCard`(접힘), 판단 목록(`KindLabel`+`QualityBadge`), 최근 선택, `ConcernTree`(하위) | UC-01~03 |
| `SCR-INQUIRY` | 탐구 | `InquiryBoard`(`HypothesisBoard`, `DivergenceTable`, `PossibilityComparison`, `PredictionList`, `PremortemList`, `PreferenceModelPanel`) | UC-01, UC-02 |
| `SCR-STIM` | 자극 보드 | `StimulusBoard`, `PreferenceModelPanel`(라운드 마친 뒤) | UC-01 |
| `SCR-WORK` | 작업 | `ActiveWorkCard`, `WorkAgreementEcho`, `ToolActivityLine`, `MaterialChangeGroups`, 탐침 카드(키울·접을 조건) | UC-03, UC-07 |
| `SCR-AGREE` | 작업 합의 | `WorkAgreementDraft`, `DraftMark`, `ConversationThread`(접힘) | UC-07 |
| `SCR-REVIEW` | 결과 확인 | `ResultReviewPanel`, `ResultCriterionRow`, `WholeUpdateBadge`, `EvidenceInspector`(인스펙터) | UC-07 |
| `SCR-LOOPS` | 루프 이력 | `LoopTimeline`, `LoopPlanStrip`, `ContestButton` | UC-05 |
| `SCR-THREAD` | 대화 | `ConversationThread`, `SemanticPreview` | — |
| `SCR-EVIDENCE` | 근거 체인 | `EvidenceChainTree`, `EvidenceInspector`, `CertaintyDescriptor`, `SourceTrace` | UC-02, UC-05 |
| `SCR-GOALS`, `SCR-GOAL` | Goal, Goal 상세 | `GoalSummary`, `GoalHistory`, `PreferenceModelPanel` | UC-09, UC-01 |
| `SCR-DIALS` | 다이얼·모드 | `DialPanel`, `ModeChip`, `AttentionBudgetMeter` | — |
| `SCR-OBSERVER` | 관찰 제안 | `ObserverProposalCard` | UC-08 |
| `SCR-CONNECT` | 연결·기기 | `ConnectionIndicator`(펼친 판), 연결 경로 목록, 기기 목록·폐기, 보내지 못한 조작 목록(20) | UC-04 |
| `SCR-RECOVERY` | 복구 | `RecoveryList`, `DegradedBanner` | UC-03 |
| `SCR-SETTINGS` | 설정 | `SegmentedControl`(테마, 밀도), 글자 크기, 인스펙터 고정, 개발자 보기, 단축키 보기 | — |
| `SCR-ONBOARD` | 처음 연결 | `ConnectionIndicator`, 안내 카드(04 §3.22) | UC-04 |
| `SCR-RECORD` | 변화 기록 | `VirtualList` + `DataTable`, `SourceTrace`, `KindLabel` | 감사 |
| `SCR-TRAY` | 메뉴 막대·트레이 | 웹뷰 밖 OS 메뉴(20). 같은 `PendingQuestionsVM` 값을 쓴다 | UC-04 |
| (16 제안) `SCR-METRICS` | 평가 | `MetricTile` | UC-08 |
| `OVL-PALETTE` | 명령 팔레트 | `CommandPalette` | — |
| `OVL-CONTEST` | 이의 걸기 | `ContestButton`의 대화상자 | UC-05 |
| `OVL-SHORTCUTS` | 단축키 | `Dialog` + `Kbd` 목록 | — |
| 셸(`RGN-*`) | — | `WindowHeader`, `NavRail`, `Banner`/`DegradedBanner`, `ScopeBar`, `Inspector`, `ScopedComposer`, `SemanticPreview`, `ActiveRunDrawer`, `Toast` | — |

유즈케이스별 화면 경로는 03 §3.7이 정본이다. 유즈케이스마다 핵심 부품만 적는다(UC ID는 02).

| UC | 핵심 부품 |
|---|---|
| UC-01 취향형 작업의 원함 탐구 | `StimulusBoard`, `PreferenceModelPanel`, `QuestionCard`(기준 확인) |
| UC-02 원인 조사 | `HypothesisBoard`, `EvidenceChainTree`, `CertaintyDescriptor` |
| UC-03 여러 날 걸리는 작업 | `SinceLastVisit`, `ActiveWorkCard`, `ActiveRunDrawer`, `RecoveryList` |
| UC-04 외부에서 접속해 질문에 답하기 | `ConnectionIndicator`, `PendingQuestionsIndicator`, `QuestionCard` |
| UC-05 혼자 정한 결정 확인과 이의 | `AutonomousChoiceList`, `ContestButton`, `EvidenceInspector`, `LoopTimeline` |
| UC-06 복귀 요약 | `SinceLastVisit`, `FreshnessIndicator` |
| UC-07 되돌리기 비싼 선택(C와 A) | `QuestionCard`, `WorkAgreementDraft`, `ResultReviewPanel` |
| UC-08 반복 마찰 개선 제안 | `ObserverProposalCard`, `MetricTile` |
| UC-09 Goal 정제 | `GoalHistory`, `QuestionCard`(Goal 확인) |

### 3.12 키보드 [제안, 정본은 05 §3.8]

키 배정의 정본은 05 §3.8이다. 03·04에 이미 정해진 키(명령 팔레트 Mod+K, 뒤로 Mod+[, 질문함 J/K, 에이전트가 정한 것 `!`·`S`, 자극 보드 `1`~`5`·`N`·`R`·`E`·`G`)는 그대로 쓴다. 이 문서는 부품이 지킬 규칙과 부품 안의 키만 정한다. Mod는 macOS ⌘, Windows Ctrl.

| 키 | 동작 | 범위 | 출처 |
|---|---|---|---|
| Mod+K | 명령 팔레트 | 전역 | 03 §3.5.1 |
| Mod+[ / Esc | 뒤로(이동 이력) / 팝오버·시트 닫기 | 전역 | 03 §3.5.1 |
| Mod+I | 인스펙터 열기·닫기 | 전역 | 제안 |
| Mod+J | 진행 중 서랍 열기·닫기 | 전역 | 제안 |
| `/` | 범위 입력창에 포커스(입력 중이 아닐 때) | 전역 | 제안 |
| Mod+Enter | 여러 줄 입력 보내기 | 입력 | 제안 |
| ↑ ↓ ← → Home End | 목록·트리·보드 이동 | 부품 | WAI-ARIA 패턴 |
| J / K | 목록 행 이동 | 질문함 등 목록 | 04 §3.3 |
| Space | 카드 펼침·접힘 | 카드 | 제안 |
| Enter / Shift+Enter | 열기(이동) / 인스펙터에서 열기 | 레코드 칩·트리 | 제안 |
| `.` | 포커스된 카드의 깊이 한 단계 올리기 | 카드 | 제안 |
| `!`, `S` | 이의 대화상자 열기, 봤음 | `SCR-AUTO` | 04 §3.5 |
| `1`~`5`, `N`, `R`, `E`, `G` | 강도 반응, 이유 없이 아님, 고쳐 말하기, 부분 고르기, 가깝다 | `SCR-STIM` | 04 §3.9 |
| `?` | 단축키 보기(`OVL-SHORTCUTS`) | 전역 | 03 §3.6 |

부품 규칙:

- 사람의 결정(질문 답, 합의 확정, 결과 확인, Goal 확인, 다이얼 변경)을 보내는 한 글자 단축키를 두지 않는다. 결정은 포커스된 버튼의 Enter/Space로만 보낸다(§3.6.5). 관찰(자극 반응, 봤음)과 대화상자 열기는 한 글자 키를 쓸 수 있다.
- 한 글자 단축키는 입력 요소에 포커스가 있거나 IME 조합 중이면 동작하지 않는다.

## 4. 실패·예외·경계 사례

| # | 상황 | 처리 | 관련 |
|---|---|---|---|
| E1 | 사람이 낡은 카드에서 결정(보는 사이 질문이 바뀜, 반대 근거 추가) | 의도에 `basisSeq`를 붙여 보내고 데몬이 낡았다고 거부하면(`stale_basis`) `rejected`. 04 §3.0.5 문장, 바뀐 칸 강조, 입력하던 글 유지 | §3.6.4, 19 |
| E2 | 결과 확인 패널을 보는 중 새 반대 근거 도착 | 패널 머리 띠 "확인하는 동안 반대 근거 1건이 추가됨 · 보기". 확인 버튼은 그대로 두되 보낸 의도는 E1 규칙을 따른다 | §3.7.3 (11) |
| E3 | 연결 끊김(오프라인) | 결정 버튼 비활성 + 이유. 읽기는 마지막 뷰(캐시)로. 초안 보존. 새 결정을 쌓아 두었다 보내지 않는다. 자극 반응만 "보내지 않음"으로 받아 둔다 | §3.6.4, 04 §3.0.4, 20 §3.9.7 |
| E4 | 보냈는데 응답 없음, 보내는 중 끊김 | 10초 뒤 안내 문장, 끊기면 `waiting_reconnect`. 20이 재접속 뒤 같은 멱등 키로 다시 보내고 데몬은 처음 결과를 돌려준다(19·20) | §3.6.4 |
| E5 | 데몬이 다시 시작함, 재접속 뒤 다시 맞춤 | 연결 상태 "다시 맞추는 중", 뷰는 마지막 캐시를 유지하고 새 뷰가 오면 한 번에 바꾼다. 바뀐 항목에 "다시 연결된 뒤 바뀜" 표시 1분(04 §3.0.4 규칙 4). 포커스와 펼침 상태는 레코드 id로 다시 맞춘다 | §3.5.8, 19·20 |
| E6 | 투영 생성 실패 | 신선도 `failed`, 이유 띠, 결정 막음, "다시 시도" | §3.5.8 |
| E7 | 공백 없는 긴 문자열(URL, 경로, 해시, 붙여 쓴 한국어) | `overflow-wrap: anywhere`로 끊는다. 한 줄 라벨은 말줄임 + 툴팁. 질문·근거 문장은 자르지 않는다 | §3.2.3 |
| E8 | 한국어 IME 조합 중 Enter·Esc | Enter는 제출하지 않고 조합 확정만. Esc도 조합 중이면 대화상자를 닫지 않는다(조합 취소가 먼저) | §3.6.5 |
| E9 | 글 자극의 요소 구간이 렌더링된 글과 맞지 않음(마크다운 원문 구간, 결합 문자·이모지 경계) | 기본값: 데몬이 요소별 평문 조각을 함께 보내고 부품은 조각 단위로 감싼다(§3.8.3). 구간만 오면 렌더 뒤 평문에서 찾아 감싸고, 찾지 못한 요소는 "표시 위치를 찾지 못함"으로 목록에만 보인다. 경계 보정에는 `Intl.Segmenter`(grapheme)를 쓴다 [지식] | §3.8.3, 04·15 |
| E10 | 반응을 단 뒤 자극 본문이 바뀜 | 자극은 바뀌지 않는 레코드여야 한다(08에 요구). 바뀌면 새 자극으로 다루고 이전 반응은 이전 자극에 남는다. 화면은 "이 자극은 고쳐진 판이 있습니다"를 보인다 | §3.8.3, 08 |
| E11 | 그림 자극 불러오기 실패, 아주 큰 그림 | 대체 글 + "다시 받기". 그림은 데몬 HTTP에서 표시 크기에 맞춘 판을 받는다(19에 요구). 원본 크기는 감사 깊이에서 | 19 |
| E12 | 근거 트리에 순환, 공유 노드, 볼 수 없는 노드, 수천 노드 | `repeatOf` 참조, 고아 노드(`orphan`) "볼 수 없는 레코드" 표시, 지연 로딩(04에 요구), 500개 넘으면 가상화 | §3.8.1 |
| E13 | 질문이 한꺼번에 많이 생김 | 권리 게이트 질문은 모두 보인다. 정보 질문은 홈 주의 카드 기본 개수(04 ADR A5) 뒤 접음. 질문함은 가상 스크롤. 같은 질문 id는 한 번만 그린다(`alsoAskedBy`로 합쳐진 것은 "다른 Concern에서도 같은 질문" 표시). 알림 반복 금지는 11·20 | §3.7.3 (3)(4) |
| E14 | 답을 쓰는 동안 만료점이 지나 가정대로 확정됨 | 카드가 `assumed`로 바뀌어도 입력한 글을 버리지 않는다. "답이 없어 임시 가정대로 정해졌습니다. 이 글을 이의로 보내면 다시 열립니다" + "이의로 보내기"(`contest.file`) | §3.7.3 (3), 04 §3.0.5, 11 |
| E15 | 걸어 둔 이의가 오래 처리되지 않음 | `AutonomousChoiceList` 맨 위 "처리 기다림" 묶음에 남는다. 사라지지 않는다 | v0.3 09 §5 |
| E16 | 기기 시계와 데몬 시계가 다름 | 상대 시간("3분 전")은 데몬 시각 기준 오프셋으로 계산한다(19의 handshake에 서버 시각 요구). 정확한 시각은 로컬 시간대로 | 19 |
| E17 | 시간대 변경, 여름 시간 | 저장·전송은 UTC, 표시만 로컬(브리프 §3.3). `Intl.DateTimeFormat`이 처리 | — |
| E18 | 번들 글꼴 불러오기 실패 | 시스템 글꼴(Apple SD Gothic Neo, Malgun Gothic)로 넘어간다. 크기·줄 높이 토큰이 px라 배치가 크게 깨지지 않는다 | §3.2.3 |
| E19 | 오래된 macOS WebKit | 시작 시 기능 검사 실패 → 띠. 동작은 막지 않는다 | §2.5.7 |
| E20 | Windows 고대비, 확대 200% | §3.2.9, §3.3.4 | — |
| E21 | 모델·도구·외부가 만든 내용에 HTML·스크립트·추적 이미지·위조 링크 | 모든 모델·도구·외부 내용은 신뢰하지 않는 텍스트로 그린다. `dangerouslySetInnerHTML` 금지. 마크다운은 `Markdown` 부품 하나로만 렌더링한다: 원시 HTML 끔, 링크 스킴은 `https`와 `helm`만(20 §5.2 요구), 그림은 데몬 HTTP 출처만(CSP, 20·18). 외부 링크는 앱 안에서 열지 않고 시스템 브라우저로 넘기며 주소를 보인다. 제어 문자·표시 위조는 데몬이 정화한다(04 §4) | 18, 20 |
| E22 | 모델이 쓴 문장 안에 "확신도 90%" 같은 숫자 | 화면이 막을 수 없다. 부품은 숫자 확률을 더하지 않고, 런타임 프롬프트 규칙(12·15)에 요구한다 | §3.5.6 |
| E23 | Concern 트리가 매우 깊음(구조 루프 분해 반복) | 들여쓰기는 6단계까지, 그 아래는 경로(위치 줄)로 보인다 | §3.7.3 (2) |
| E24 | 아주 긴 Goal 문장의 차이 | 바뀌지 않은 어절은 앞뒤 5어절만 남기고 접는다 | §3.8.4 |
| E25 | 같은 레코드를 두 창(또는 화면 두 곳)에서 봄 | 부품은 상태가 없어 같은 VM이면 같게 그린다. 펼침 상태 공유 여부는 20 | 20 |
| E26 | 레코드 칩의 대상이 삭제·대체·권한 없음 | 칩을 지우지 않고 "볼 수 없음"·"대체됨 → 새 레코드"로 그린다(04 §3.0.5 "찾을 수 없음") | §3.7.2 |
| E27 | 스크린 리더에 진행 갱신이 쏟아짐 | 15초 묶음 알림 하나 | §3.6.8 |
| E28 | 다이얼 값을 바꿨는데 정책이 고정한 값 | `locked` 이유를 보이고 컨트롤 비활성 | §3.7.3 (14) |
| E29 | 진행 작업의 맡긴 범위가 권고 수준(외부 런타임 어댑터) | 카드 머리에 항상 표시, 감출 수 없음 | §3.7.3 (8) |
| E30 | 화면 ID, 레코드 종류, 상태 값을 모르는 값(새 데몬 버전) | `KindLabel`·`StatusLabel`은 "알 수 없는 값(<값>)"으로 그리고 감사 깊이 링크를 둔다. 오류로 화면을 멈추지 않는다 | §3.7.2 |

## 5. 다른 문서와의 인터페이스

### 5.1 이 문서가 제공하는 것

| 받는 문서 | 제공 |
|---|---|
| 03·04·05(P2) | 화면을 구성할 부품 목록과 계약(§3.7), 시각 문법(§3.5), 화면 → 부품 매핑 초안(§3.11), 고정 표현 문구 키(§3.6.7), 대안 고르기 금지 규칙의 부품 강제(§3.9), 키보드 지도 초안(§3.12) |
| 20(P13) | 부품이 요구하는 VM 타입(`ui/model`), `UiIntent` 목록(§3.6.3), 행동 수명주기(§3.6.4), 셸 부품과 레이아웃 규칙(§3.3), 테마·밀도·글자 크기 설정 값, 웹뷰 기준(§2.5.7) |
| 19(P12) | 화면이 필요로 하는 데이터 목록(§5.2)과 의도 목록 |
| 22(테스트) | 부품 이야기·시각 테스트·접근성 테스트·IME 테스트·선형 텍스트 골든·금지 패턴 테스트 정의(§6.3) |
| 23(구현 계획) | 구현 단위와 순서, 완료 기준(§6) |
| 06·07(P3·P4) | UI 쪽 의존성 목록(§6.5)과 `just` 레시피 요구 |

### 5.2 다른 문서에 요구하는 것

| 문서 | 요구 |
|---|---|
| 03 | (1) 16이 제안한 평가 화면(`SCR-METRICS`)을 화면 목록에 넣을지 결정. (2) 원천 배지 `inferred`·`policy-approved`를 품질 배지가 아니라 작성자 표시로 옮긴 것(§3.5.3)을 §3.3.6에 반영. (3) 03 §4의 "가상 스크롤로 그린다"(21)에 대해: `ConcernTree`·`QuestionInbox`·`SCR-RECORD`가 가상 스크롤을 쓴다고 답함 |
| 04 | (1) 부품이 더 필요로 하는 뷰 필드: `RecordRef`나 목록 항목에 `unseen`(사람이 아직 보지 않은 변화), `StimulusRoundView` 글 요소에 평문 조각(§3.8.3, E9), `GoalView` 버전 본문 조회(§3.8.4 [가정]), `EvidenceChainView.nodes`의 깊이 지연 로딩(노드가 많을 때). (2) 홈 주의 카드 기본 개수(ADR A5)가 정보 질문에만 적용됨을 확인. (3) 04 §3.0.2 `ViewMeta`의 `sourceSeq`와 19 `asOfSeq`가 같은 값임을 한 이름으로 맞추기 |
| 05 | `copy/ko.ts`의 정본 문장(05 §3.10.8 문구 목록), 키보드 절(§3.8)과 §3.12 맞추기, 금지 문구 목록(§3.9 R7), 의미 상태 언어(`doingNow` 문장 규칙), 라운드 마치기 조건(§3.2.5)에 "가깝다 표시만으로는 마칠 수 없음" 반영 여부 |
| 08 | 근거 관계 종류(`supports/challenges/qualifies/invalidates`)와 근거 품질 속성(04 `EvidenceChainView.nodes[].quality`의 출처), 자극 레코드를 바뀌지 않는 레코드로 둘 것(E10), 숫자 `confidence`를 레코드에 둘지(§3.5.6, U-03) |
| 11 | 이의 사유를 선택 사항으로 받기("사유 없이 이의" 기록). 가정 확정 뒤 들어온 답을 이의로 처리하는 규칙(E14) |
| 12 | 사용자 투영에 모델 사고 텍스트를 넣지 않을 것. 모델 문장에 숫자 확률을 쓰지 않도록 하는 프롬프트 규칙(E22). 대화 스레드 투영에서 reasoning 파트 제외 |
| 14 | 주의 예산의 단위·창·예약 몫(`AttentionBudgetVM`, §3.8.5). 다이얼 정본 키와 값 목록(04 `DialsView`의 출처) |
| 15 | 글 자극의 요소를 평문 조각으로 함께 보내기(E9). 세 개 비교 데이터. 대비 압축 순서와 접힘(`folded`) 기준 |
| 16 | `MetricTile`(§3.7.3 (16))이 16 §3.24의 지표 값 형식으로 충분한지 확인. 감사 깊이 열람은 16의 정의대로 `view.opened { depth: "audit" }`로 수집하며, 보내는 쪽은 화면 컨테이너(20)다 |
| 17·18 | 연결 진단 문장(경로별), 기기 토큰 만료·폐기 상태 |
| 19 | (1) `CommandResult`에 선택 영향(`impact`) 목록(§3.7.3 (5)). (2) 거부 사유 분류(`stale_basis`, 내용, 자격, 경로)를 `CommandOutcomeView`로 줄일 수 있게 오류 `kind` 유지. (3) 그림 자극의 표시 크기 판 HTTP 경로(E11). (4) handshake의 서버 시각(E16) |
| 20 | (1) `ConnState` → `ConnectionUiState`(04 §3.0.4 아홉 상태) 변환, `decisionsAllowed` 계산. (2) 화면 컨테이너: 뷰 → 부품 props, `UiIntent` → `useCommand`. (3) 초안 보존(답, 이의 사유, 보내지 않은 반응). (4) 설정 저장(테마, 밀도, 글자 크기, 인스펙터 고정·너비). (5) CSP에 로컬 글꼴과 데몬 HTTP 그림 출처. (6) `minimumSystemVersion` 14.0(§2.5.7). (7) 웹뷰 확대(글자 크기 설정)를 Tauri 창 zoom으로 |
| 22 | §6.3 테스트를 테스트 계층에 넣고, 시각 기준 이미지를 만드는 환경(서버, 고정 Playwright 브라우저) 결정 |
| 06·23 | `just` 레시피 추가: `ui-storybook`, `ui-test`, `ui-visual`, `ui-visual-update`, `ui-check`, `shot`, `shot-mac`(§6.4). pnpm `peerDependencyRules`(assistant-cloud의 peer 경고). 문구·라벨 공유 패키지(03 ADR, 20 §3.9.1 `copy/`)와 `ui/copy`의 관계 정리 |
| 24 | 이 문서 끝 ADR 후보 |

## 6. 구현 단위와 완료 기준

### 6.1 폴더 구조 [제안]

앱 구조(라우팅, 저장소, Tauri 설정)는 20이 정한다. UI 계층은 `apps/desktop/src/ui/` 아래에 둔다. 이 폴더는 앱 저장소와 프로토콜을 가져오지 않는다(§6.4 검사).

```text
apps/desktop/
  .storybook/                 main.ts, preview.tsx(테마·밀도·깊이 전환 도구막대, app.css 적용)
  src/ui/
    tokens/                   §3.2.8 (caustic 고정 사본, helm.css, theme.helm.css, tokens.ts)
    styles/                   app.css, base.css, fonts.css
    assets/fonts/             Geist, Geist Mono, SUIT woff2 + OFL 라이선스 파일
    model/                    common.ts, intent.ts, 화면별 VM 타입(question.ts, evidence.ts, stimulus.ts …)
    copy/                     ko.ts, labels.ts
    lib/                      ime.ts, time.ts(상대·정확 시각), segment.ts(Intl.Segmenter), linear.ts(선형 텍스트 도우미), cn.ts(tailwind-merge)
    primitives/               L0 (§3.7.1) — Button, IconButton, ActionButton, RecordLink, TextField, TextArea, Select, Checkbox, Switch,
                              RadioGroup, SegmentedControl, Tabs, Tooltip, Popover, HoverPreview, Dialog, Sheet, Menu, Toast,
                              Disclosure, Banner, EmptyState, ErrorState, Skeleton, Kbd, Splitter, VirtualList, DataTable
    helm/                     L1 (§3.7.2) — KindLabel, QualityBadge, AuthorshipMark, DraftMark, ActorLabel, StatusLabel, LoopChip,
                              SituationChip, ModeChip, GateBadge, DeliveryBadge, AssumptionExpiry, TimeStamp, RecordChip, SourceTrace,
                              CertaintyDescriptor, ReversibilityNote, ReviewTriggerLine, DepthToggle, FreshnessIndicator, UnseenDot,
                              ContestButton, WholeUpdateBadge
    composites/               L2 (§3.7.3)
      brief/                  SinceLastVisit, GoalSummary
      concern/                ConcernTree
      question/               QuestionCard, QuestionInbox, ChoiceImpactEcho
      autonomous/             AutonomousChoiceList, AutonomousChoiceItem
      agreement/              WorkAgreementDraft, WorkAgreementEcho
      work/                   ActiveWorkCard, ToolActivityLine, MaterialChangeGroups, RecoveryList
      review/                 ResultReviewPanel, ResultCriterionRow, WholeUpdatePanel
      evidence/               EvidenceInspector
      input/                  SemanticPreview
      rules/                  DialPanel, ObserverProposalCard
      status/                 DegradedBanner
    viz/                      §3.8 — EvidenceChainTree, LoopTimeline, LoopPlanStrip, LoopPathMini, StimulusBoard, PreferenceModelPanel,
                              GoalHistory, ConnectionIndicator, PendingQuestionsIndicator, AttentionBudgetMeter,
                              inquiry/{InquiryBoard, HypothesisBoard, DivergenceTable, PossibilityComparison, PredictionList, PremortemList}
    shell/                    WindowHeader, NavRail, ScopeBar, Inspector, ScopedComposer, ActiveRunDrawer, CommandPalette, AppShell
    conversation/             ConversationThread, adapter.ts(ThreadMessageVM ↔ assistant-ui), toolkit.tsx
    fixtures/                 VM 고정 데이터(한국어, 긴 문장, 혼합 문자, 빈 값, 극단 값). 이야기와 테스트가 같이 쓴다
    index.ts
  tests/visual/               Playwright 시각 테스트(§6.3)
```

### 6.2 구현 순서 [제안]

| 단계 | 내용 | 먼저인 이유 |
|---|---|---|
| U1 | 토큰 사본, `app.css`, 글꼴, `base.css`, Storybook 설정, 정적 검사 | 모든 부품의 바탕 |
| U2 | L0 부품 + `ActionButton` 상태 기계 + IME 도우미 | L1·L2가 쓴다 |
| U3 | L1 Helm 의미 부품 + `ui/model` 공통 타입 | 시각 문법 고정 |
| U4 | C/A 부품: `QuestionCard`, `QuestionInbox`, `WorkAgreementDraft/Echo`, `ResultReviewPanel`, `AutonomousChoiceList`, `ContestButton` | 원천의 C/A 우선(브리프 §3.5, 사용자가 가장 건너뛴 루프) |
| U5 | 복귀: `SinceLastVisit`, `ActiveWorkCard`, `ConcernTree`, 셸 부품, `FreshnessIndicator`, `ConnectionIndicator`, `PendingQuestionsIndicator` | UC-03·04·06 |
| U6 | 근거: `EvidenceChainTree`, `EvidenceInspector`, `CertaintyDescriptor`, `SourceTrace` | UC-02·05 |
| U7 | 원함 탐구: `StimulusBoard`, `PreferenceModelPanel`, `GoalHistory` | UC-01·09. 반응 스키마가 15·08에서 정해진 뒤 |
| U8 | 탐구 보드 나머지, `LoopTimeline`, `DialPanel`, `RecoveryList`, `ObserverProposalCard`, `AttentionBudgetMeter` | 14·15·16 의존 |
| U9 | `ConversationThread`(assistant-ui) | 주 화면이 아니라 뒤로 미룬다 |

### 6.3 스토리북과 테스트 [제안]

**이야기(story) 규칙**

- 부품마다 §3.6.8 상태 집합 중 해당 상태 전부, 깊이 셋(해당하면), 밀도 둘을 이야기로 둔다. 이야기 이름은 상태 이름(`Default`, `Stale`, `Contested`, `Sending`, `StaleRejected`, `Offline`, `Empty`, `LongKorean` …).
- 모든 이야기는 `ui/fixtures`의 한국어 고정 데이터를 쓴다. 고정 데이터에는 공백 없는 긴 문자열, 영어·한국어 혼합, 이모지, 40자 넘는 제목, 근거 0개·1개·50개를 포함한다.
- Storybook 도구막대: 테마(라이트/다크/시스템), 밀도, 깊이, 확대(100/125/200%).

**테스트 종류**

| 종류 | 도구 | 대상 | 통과 조건 |
|---|---|---|---|
| 동작 | Storybook play 함수 + `@storybook/addon-vitest`(Vitest 브라우저 모드, Chromium) | 모든 L0~L2 | 이야기별 상호작용 시나리오 통과 |
| 접근성 | axe-core(`@storybook/addon-a11y`의 검사를 테스트에서 실행) | 모든 이야기 | serious·critical 위반 0 |
| 키보드 | play 함수 | 트리, 목록, 보드, 대화상자, 셸 | §3.12와 각 부품 키보드 표대로 이동·조작, 포커스가 `body`로 빠지지 않음 |
| IME | play 함수에서 `compositionstart/update/end`와 `keydown(isComposing=true)`, `keydown(keyCode=229)` 합성 | 모든 텍스트 입력 부품 | 조합 중 Enter·Esc가 제출·닫기를 일으키지 않음 |
| 선형 텍스트 골든 | Vitest(노드) | 모든 `toLinearText` | 고정 데이터 × 깊이별 출력이 골든 파일과 같음. 색·아이콘에만 있는 정보가 없는지 검토 |
| 금지 패턴 | Vitest + 렌더 검사 | §3.9 | (1) 원함 탐구 이야기에 결정 의도 버튼이 없음, (2) `StimulusBoard`가 `near`만 있을 때 라운드 마치기 비활성이고 "가장 좋은 것 고르기" 행동이 없음, (3) 결정 의도 버튼만 있고 "그 밖에" 줄이 없는 질문 카드가 없음, (3-1) 원함 탐구 출처 질문에 `options`·`pickOne`이 와도 렌더되지 않음, (4) R7 금지 문구가 렌더 결과에 없음, (5) confidence 숫자(`%`가 붙은 확률)가 Helm 부품이 만든 글자에 없음 |
| 행동 수명주기 | Vitest + 가짜 `onIntent` | `ActionButton`과 그것을 쓰는 부품 | §3.6.4 표의 모든 행(접수, 낡은 기준 거부, 그 밖 거부, 시간 초과, 연결 끊김, 투영 반영) |
| 시각 | `@playwright/test` `toHaveScreenshot`, 정적 Storybook 빌드를 대상으로 | 모든 이야기 × {chromium, webkit} × {light, dark} × 밀도 기본(촘촘은 L2만) | 픽셀 차이 2% 이하(`maxDiffPixelRatio: 0.02`, Caustic G4와 같은 값 [원문]), 크기 변화 0 |
| 대비 | 토큰 조합 검사 스크립트 | Helm 의미 토큰 조합(`--helm-*` 전경/배경 쌍) | 본문 7:1, 보조 4.5:1, 경계·포커스 3:1 (Caustic 기준과 같음) |
| 성능 | Vitest 브라우저 모드 | `EvidenceChainTree`(노드 2,000), `VirtualList`(행 10,000), `ConcernTree`(노드 500) | 펼침·접힘 한 번의 렌더가 50ms 이하(Chromium, 서버 기준) [제안] |

- 시각 테스트 기준 이미지는 WSL 서버에서 고정 버전 Playwright 브라우저로 만든다. 글꼴을 앱에 넣었으므로 시스템 글꼴 차이는 없다. 두 엔진의 결과를 따로 저장한다.
- WebKit(Playwright, Linux) 결과는 macOS WKWebView의 근사다. 실제 macOS 화면은 `just shot`의 Mac 판으로 사람이 비교한다(§6.4).
- 시각 테스트와 접근성 검사는 외부 서비스에 올리지 않는다(§2.5.8).

### 6.4 정적 검사와 `just` 레시피 [제안]

정적 검사(`just ui-check`, `just verify`에 포함):

| 검사 | 내용 |
|---|---|
| Caustic 사본 해시 | `tokens/caustic/*`가 `SYNC.json`의 sha256과 같음 |
| 스타일 규칙 | `ui/**`에서 리터럴 색(`#`, `rgb(`, `oklch(`), `dark:` 변형, 임의 값 클래스(`[...]`), 색 알파 수정자, `!important`, 인라인 `style`의 색 금지. Caustic `studio-lint` 규칙 이름(`literal-color`, `no-dark-variant`, `arbitrary-value`, `color-alpha`, `important`, `inline-style-color`)을 따른다 [원문: axiom `scripts/studio-lint.mjs`]. 예외는 `viz/`의 SVG 좌표 계산(색 제외) |
| 금지 유틸리티 | `glass*`, `frost`, `orb*`, `shimmer`, `spectrum-*`, `agent-rim`, `agent-glow`, `animate-*` 클래스 금지 |
| 가져오기 규칙 | `ui/**`는 앱 저장소·프로토콜 클라이언트·Tauri API를 가져오지 않음. `@assistant-ui/*`는 `ui/conversation/`에서만. `RadioGroup`·`Select`·단일 선택 `SegmentedControl`은 `composites/question/`, `viz/inquiry/`, `viz/StimulusBoard/`에서 가져오지 않음(§3.9 R4). 층 규칙: `primitives` → (없음), `helm` → `primitives`, `composites`·`viz` → `primitives`·`helm`, `shell` → 전부 |
| React 18 규칙 | `use(` 호출, `<X.Provider` 없이 컨텍스트를 공급자로 쓰는 JSX, `useActionState`, `useOptimistic`, `useFormStatus` 금지 |
| 위험 HTML | `dangerouslySetInnerHTML` 금지 |
| 문구 | 부품 안의 한국어 리터럴 문자열 금지(이야기·고정 데이터·`copy/` 제외). 고정 문구는 문구 키로 |
| 아이콘 | lucide 아이콘을 `ui/helm/icons.ts`의 의미 표(§3.4)를 거쳐서만 가져옴(화면마다 다른 아이콘을 쓰지 않게) |

`just` 레시피 요구(정의는 06·23, 사용자 규칙상 빌드·검증은 레시피로만):

| 레시피 | 하는 일 |
|---|---|
| `just ui-storybook` | Storybook 개발 서버 |
| `just ui-check` | 위 정적 검사 + 타입 검사 |
| `just ui-test` | 동작·접근성·키보드·IME·골든·금지 패턴·수명주기·성능 테스트 |
| `just ui-visual` | 정적 Storybook 빌드 → Playwright 시각 테스트(chromium, webkit) |
| `just ui-visual-update` | 기준 이미지 다시 만들기(사람이 차이를 검토한 뒤) |
| `just shot` | 가짜 투영 고정 데이터로 앱 화면(03 화면 ID별)을 띄워 chromium·webkit으로 찍고 `docs/design` 쪽 디자인 기준(04가 정하면)과 나란히 놓는다 |
| `just shot-mac` | `run-on mac`으로 Mac에서 앱을 고정 데이터 모드로 띄우고 창을 찍는다 [가정: Tauri의 WebDriver 자동화가 macOS를 지원하지 않아 [지식] 화면 캡처 명령으로 찍는다] |

`just verify`는 `ui-check`와 `ui-test`를 포함한다. `ui-visual`은 시간이 걸리므로 `verify`에 넣을지는 22·23이 정한다(기본값: UI 파일이 바뀐 변경에서만).

### 6.5 의존성 목록 [제안]

| 패키지 | 버전 고정 | 용도 |
|---|---|---|
| `react`, `react-dom` | 18.x(결정 32) | — |
| `radix-ui` | 1.7.x | 헤드리스 부품 |
| `tailwindcss`, `@tailwindcss/vite` | 4.x | 스타일 |
| `class-variance-authority`, `tailwind-merge` | 0.7.x, 3.x | 변형, 클래스 병합 |
| `lucide-react` | 1.55.x | 아이콘 |
| `@tanstack/react-virtual` | 3.14.x | 가상화 |
| `react-textarea-autosize` | assistant-ui와 같은 버전 | 자동 높이 입력 |
| `react-markdown`, `remark-gfm` | 10.1.x(peer `react >=18`, MIT), 4.0.x(MIT) [검색: npm] | 모델·도구 문장의 마크다운. `skipHtml`, `urlTransform`으로 스킴 제한 |
| `diff` | 9.0.x(BSD-3-Clause) [검색: npm] | Goal·초안 차이 |
| `@assistant-ui/react` | 0.15.27 정확히 | 대화 스레드(§3.10) |
| `geist`, `@sun-typeface/suit` | 1.7.x, 2.0.5 | 글꼴 파일(빌드 때 woff2 복사) |
| 개발: `storybook`, `@storybook/react-vite`, `@storybook/addon-vitest`, `@storybook/addon-a11y` | 10.6.x | 카탈로그·테스트 |
| 개발: `vitest`, `@vitest/browser`, `playwright`, `@playwright/test`, `axe-core` | 고정 | 테스트 |

들이지 않는 것: shadcn CLI 생성 부품, Base UI, React Aria, assistant-ui Elements·스타일 부품, `@assistant-ui/generative-ui`, 차트·그래프 라이브러리(1차), elkjs, CSS-in-JS 런타임.

### 6.6 완료 기준

| 단위 | 완료 기준(테스트로 확인) |
|---|---|
| U1 토큰·스타일 | Caustic 사본 해시 검사 통과. 라이트·다크·시스템 전환이 이야기에서 동작. 한국어 줄바꿈 규칙 적용 확인(긴 문장 이야기 시각 기준). Helm 의미 토큰 대비 검사 통과. 글꼴 파일이 번들에 있고 네트워크 요청 없이 그려짐(Playwright에서 외부 요청 0) |
| U2 L0 | 부품마다 상태 이야기 전부. axe 위반 0. IME 테스트 통과. `ActionButton` 수명주기 표의 모든 행 테스트 통과. `consequence` 없는 위험 버튼이 개발 모드에서 오류 |
| U3 L1 | 레코드 종류·품질·작성자·상태 라벨의 모든 값에 이야기와 선형 텍스트 골든. 알 수 없는 값(E30)에서 멈추지 않음 |
| U4 C/A 부품 | 질문 카드: 화면 종류 7종(03 §3.2.4)·깊이 3단계·상태 6종·만료 임박·즉시 승격·묶음 모드·낡은 기준 거부 이야기. "그 밖에" 줄 R2 테스트 통과. 원함 탐구 출처 질문에 추천·다른 선택·`pickOne` 렌더 없음. 결과 확인: 2단계, 네 판정, 확인하지 못한 기준이 있을 때 `consequence` 문구. 반영 항목이 남으면 "완료"가 렌더되지 않음 |
| U5 복귀·셸 | 복귀 요약 9절 모두 렌더, 변화 없음·100건 이상 이야기. 반대 근거·권리 게이트 질문이 접히지 않음. 레일·인스펙터·서랍 창 너비 3구간 시각 기준. 확대 200%에서 가로 스크롤 없음(표 제외) |
| U6 근거 | `buildEvidenceTree` 단위 테스트(평탄 목록 → 트리, 공유·순환·고아 노드). 관계 고정 순서, 반대·무효화 비접힘, `repeatOf`, 고아 노드 "볼 수 없는 레코드", `not_searched` 경고, 낡음 표시 이야기. tree 키보드 테스트. 2,000노드 성능 기준 |
| U7 원함 탐구 | 글·그림·링크 자극 이야기. 요소 단위 반응을 마우스와 키보드(부분 고르기 모드, 그림 3×3 격자) 두 경로로 만드는 테스트. `near`만 있을 때 라운드 마치기 비활성(R1). 세 개 비교가 "다른 하나"를 묻는지. 요소 조각 감싸기와 위치를 못 찾은 요소 처리(E9). 오프라인 "보내지 않음" 반응과 다시 보내기. 기준 후보가 라운드 마친 뒤에만 보임. `statedVsRevealed` 항상 펼침. Goal 수정 제안 차이가 `ins`/`del`로 렌더 |
| U8 나머지 시각화 | 루프 타임라인: 계획 대비 실제(건너뜀 포함), 필터, 혼자 정한 전환의 이의. 발산 표: 세 칸 상태(`filled`·`empty`·`na`)와 해당 없음 이유. `MetricTile`: 값·표본·창·정의 버전·검토 신호·추세 SVG. 다이얼: 층 표시와 잠금. 주의 예산: 한도 있음·없음 |
| U9 대화 | ExternalStoreRuntime 연결 테스트(가짜 저장소): 보낸 글이 스트림 반영 전에는 스레드에 들어가지 않음, 사고 파트 미렌더, 승인 파트 미생성, `@assistant-ui/*` 가져오기가 폴더 밖에 없음 |
| 전체 | `just ui-check`, `just ui-test`, `just ui-visual` 통과. 원천 체크리스트 대응표(§2.3)의 "반영" 항목마다 해당 이야기 또는 테스트가 있음 |

## 7. 미결 사항

| ID | 질문 | 선택지 | 추천 기본값 |
|---|---|---|---|
| U-01 | (해결) 화면 ID | — | 03 §3.6의 `SCR-*` 사용(§3.11) |
| U-02 | (해결) Concern·Goal의 화면 이름 | — | 영어 "Concern", "Goal"(03 §3.2.2, ADR 후보 A1) |
| U-03 | 숫자 `confidence`를 레코드에 둘지, 화면 어디까지 보일지 | 레코드에도 없음 / 레코드에만, 화면은 감사 깊이만 / 화면에도 | 레코드는 08·15가 정하고, 화면은 감사 깊이의 원본 필드에서만 보임(§3.5.6) |
| U-04 | 글 자극 요소의 표현 | 마크다운 원문 구간 / 렌더 뒤 평문 구간 / 요소별 평문 조각 | 요소별 평문 조각(15·04에 요구, E9) |
| U-05 | 주의 예산 단위 | 질문 수 / 예상 검토 분 / 둘 다 | 14가 정함. 부품은 단위 표시 이름만 받음 |
| U-06 | React 19로 올려 Caustic React 부품을 쓸지 | React 18 유지(결정 32) / React 19 전환 | React 18 유지. ADR 후보 2 |
| U-07 | Caustic 라이선스 표시 | Caustic 저장소에 LICENSE 추가 / Helm NOTICE에 출처·허락 기록 | 둘 다. 소유자 확인이 필요 |
| U-08 | 정보 질문의 기본 펼침 개수 | 3 / 5 / 다이얼 | 04 ADR A5(기본 3)를 따름. 권리 게이트는 개수와 상관없이 모두 |
| U-09 | (해결) 자극 반응 중 기준 후보를 보일지 | — | 라운드를 마친 뒤에만(04 §3.9 `revealAfterClose`) |
| U-10 | 사람 메시지를 스트림 반영 전에 회색 초안으로 보일지 | 안 보임 / 300ms 뒤 초안 표시 | 300ms 뒤 "보내는 중" 초안 표시(저장소에 넣지 않음). 20 §3.9.10의 `liveTextStore`와 맞춘다 |
| U-11 | (해결) 오프라인 결정 대기열 | — | 두지 않음(04 ADR A4, 20 §3.9.7). 이미 보낸 조작의 재전송만 20 |
| U-12 | (해결) UI 상호작용 지표 수집 | — | 16의 `view.opened`(depth 포함)를 화면 컨테이너(20)가 보낸다 |
| U-13 | 글꼴 | Caustic 순서(Geist + SUIT) / Pretendard 단일 | Caustic 순서. 소유자의 다른 제품과 맞춘다 |
| U-14 | macOS 최소 버전 | 13.3(Safari 16.4, Tailwind 하한) / 14.0 / 15.0 | 14.0, 웹뷰 기준 Safari 17.5. 실제 Mac의 macOS 버전을 사용자에게 확인 |
| U-15 | 강조 색상(hue) | Caustic 기본 205 / Helm 고유 값 | 205. Caustic이 24개 색상에서 대비를 검사하므로 바꿔도 대비는 유지된다 [원문: contrast.json hueSweep] |
| U-16 | 이의 사유를 필수로 받을지 | 필수 / 선택 | 선택("사유 없이 이의"도 기록) |
| U-17 | Goal 차이의 단위 | 글자 / 어절 / 문장 | 어절 |
| U-18 | `just shot-mac`의 캡처 방식 | 화면 캡처 명령 / 앱 내부 캡처 기능 | 화면 캡처 명령(`run-on mac`). 20이 고정 데이터 모드(가짜 투영)를 앱에 둘지 정함 |
| U-19 | 문구·라벨을 TUI와 공유하는 패키지 | 공유 패키지(03 ADR, 20 `copy/`) / 데스크톱 안 | 공유 패키지가 생기면 `ui/copy`는 그 패키지를 다시 내보내기만 한다. 그 전까지 `apps/desktop/src/ui/copy` |

## 8. 출처

브리프와 Helm 자료:

- `docs/design/process/00-design-brief.md` §2(결정 1~40), §2.5, §3, §5, §6
- `docs/design/process/sources/helm-canon.md` §8.3, §8.9, §10.8, §12.12, §17(friendly 문서 전체, 특히 §17.2 공유 언어, §17.6 UX 문구 지침, §17.7 기술 대응표), §18(product-language.yaml), §21 체크리스트
- `docs/design/process/sources/helm-canon-2.md` §3(CLI 경험 v0.2 전체), §8.6~§8.7(apps/helm-web), §11 체크리스트
- `docs/design/process/sources/helm-canon-3.md` §6(상용 데스크톱 에이전트 UX 조사 전체), §7.1 C1~C13, §7.2 G1~G16, §7.3 I4, §8 체크리스트
- `docs/design/process/sources/conversation-extracts-4.md` §4.8, §6, §13.4, §15, §20, §21 목록(d25 등)
- `docs/design/process/sources/conversation-extracts-1.md`, `-2.md`(d-6), `-3.md` 끝 목록
- `docs/v0.3/00-README.md` §2.4, §5; `02-core-concepts.md` §2~§4, §8, §9; `03-loops-and-transitions.md` §2.1, §8, §9; `04-inquiry-types.md` §2~§8; `06-asking-and-interruption.md` §3~§5; `07-modes-and-capabilities.md` §2~§7; `09-client-opdc.md` 전체; `13-stack-feasibility.md` §2.4; `14-alternative-structure.md` §5

함께 쓰이는 설계 문서(2026-10-11 판, 작성 중):

- `docs/design/03-ux-information-architecture.md` §3.2.2, §3.3(상태 라벨), §3.4(셸 영역), §3.5(내비게이션), §3.6(화면 ID), §3.7, §4, §5.2, §7 IA-Q4
- `docs/design/04-ux-screens.md` §2.3, §3.0(공통 타입·상태·명령 의도·카드 내용), §3.1~§3.26 각 화면의 뷰 모델, ADR 후보 A3~A5
- `docs/design/16-observer-and-metrics.md` §3.24(평가 화면, `view.opened`), 다른 문서 요구 표
- `docs/design/19-client-protocol.md` §3.6.3(`view.get`, `ViewResult`), §3.7.5 메서드 표
- `docs/design/20-desktop-app-architecture.md` §3.8.8~§3.8.9(연결 상태), §3.9.1(폴더), §3.9.7~§3.9.11(명령·신선도·오류 경계·assistant-ui·설정)

Axiom 저장소(읽기 전용, 2026-10-11) [원문]:

- `~/projects/axiom/code/axiom-design-system/README.md`, `AGENTS.md`, `LICENSE`, `package.json`
- `vendor/caustic/FOUNDATION.md`, `CONTRIBUTING.md`, `SYNC.json`
- `vendor/caustic/packages/tokens/dist/caustic.tokens.css`, `theme.css`, `contrast.json`; `packages/tokens/src/base.css`
- `vendor/caustic/packages/react/package.json`, `src/components/modal/modal.tsx`
- `vendor/caustic/packages/gateway/src/checks/`(G0~G6)
- `apps/studio/src/caustic.css`, `apps/studio/src/fonts.css`, `scripts/studio-lint.mjs`, `apps/studio/src/theme-workspace/charts.ts`
- `docs/foundation/README.md`, `docs/foundation/syntax/foundation-and-token-semantics.md`

외부 자료 [검색, 2026-10-11 확인]:

- npm 레지스트리: `@assistant-ui/react`(0.15.27), `@assistant-ui/core`(0.3.26 타입 정의), `@assistant-ui/generative-ui`, `@assistant-ui/vite`, `assistant-cloud`, `radix-ui`(1.7.0), `@base-ui/react`(1.9.0), `react-aria-components`(1.22.1), `lucide-react`(1.55.0), `@tabler/icons-react`, `@phosphor-icons/react`, `@xyflow/react`(12.12.0), `@dagrejs/dagre`, `elkjs`, `recharts`, `@visx/visx`, `@tanstack/react-virtual`, `@tanstack/react-table`, `react-chrono`, `storybook`(10.6.1), `@storybook/react-vite`, `tw-shimmer`, `shadcn`, `react-markdown`(10.1.0), `remark-gfm`(4.0.1), `diff`(9.0.0)
- assistant-ui 문서: https://www.assistant-ui.com/llms.txt, `/docs/runtimes/custom/external-store.md`, `/docs/runtimes/custom/assistant-transport.md`, `/docs/tools/tool-ui`, `/docs/migrations/toolkit-tools.md`, `/docs/migrations/deprecation-policy.md`, `/docs/tools/interactables.md`, `/docs/tools/generative-ui.md`, `/docs/base-ui.md`, `/docs/cli.md`, `/docs/installation.md`, `/docs/cloud/pricing.md`, `/elements/approval-card.md`, `/elements/timeline.md`, `/elements/flow-graph.md`, `/elements/background-inbox.md`; 레지스트리 https://r.assistant-ui.com
- shadcn: https://ui.shadcn.com/docs/tailwind-v4, changelog 2026-07 Base UI 기본, 2026-07 React Aria, 2026-02 radix-ui
- Tailwind 호환성: https://tailwindcss.com/docs/compatibility
- Tauri 웹뷰: https://v2.tauri.app/reference/webview-versions/ ; WebView2 배포: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
- Safari 26.6.1(Sonoma·Sequoia): https://eclecticlight.co/2026/08/18/apple-has-released-an-update-to-safari-26-6-1-for-sequoia-and-sonoma/
- CSS 지원: MDN browser-compat-data 8.1.5(`@mdn/browser-compat-data`); Chrome CSS i18n: https://developer.chrome.com/blog/css-i18n-features
- 글꼴: https://github.com/orioncactus/pretendard , https://github.com/sun-typeface/SUIT
- Playwright 릴리스 1.62~1.64: https://github.com/microsoft/playwright/releases ; Storybook 마이그레이션: https://storybook.js.org/docs/releases/migration-guide ; Vitest 시각 회귀: https://vitest.dev/guide/browser/visual-regression-testing

[지식](재확인 안 함): WCAG 2.2 대비·리플로우 기준, WAI-ARIA tree 패턴, W3C Web Annotation Data Model(TextQuoteSelector, TextPositionSelector), Safari의 IME Enter `keyCode 229` 동작, `Intl.Segmenter` 지원, Geist·Geist Mono 라이선스(OFL), Tauri WebDriver의 macOS 미지원.

작업 중 실험 [실험]: `.helm-design-work/P14/contrast.py`(버린 Helm 고유 팔레트의 대비 계산).

## ADR 후보

24-adr.md는 P3가 소유한다. 아래는 옮길 후보다.

### ADR 후보 1. Caustic 토큰 층을 Helm 데스크톱 UI의 원시·의미 토큰으로 쓴다

- 상태: 제안
- 맥락: 결정 32(Tauri v2 + React 18). 사용자의 Axiom 저장소에 Caustic 디자인 시스템이 있고, 토큰은 React와 무관한 CSS·Tailwind 4 `@theme`·DTCG JSON으로 생성되며 대비 관문을 통과한다. React 부품은 React 19 전용이다.
- 결정: `caustic.tokens.css`와 `theme.css`를 고정 사본(해시 검사)으로 가져와 층 1·2로 쓰고, Helm 의미 토큰(`--helm-*`)을 층 3으로 얹는다. `base.css`의 재질·에이전트 애니메이션과 React 부품, Axiom Foundation 문서는 쓰지 않는다.
- 근거: 검증된 대비·다크 모드·밀도·한국어 줄바꿈 규칙을 다시 만들지 않는다. 소유자의 다른 제품과 화면 인상이 맞는다. Helm 스타일 방식(Tailwind 4)과 같다.
- 기각한 대안: (a) Caustic 전체 사용 — React 19 요구. (b) Helm 고유 토큰 — 같은 검증을 다시 해야 한다. (c) Axiom Foundation 문서 — 토큰 명세가 아니다.
- 결과: Caustic이 바뀌어도 Helm은 의도한 갱신 때만 따라간다. Caustic에 라이선스 표시가 필요하다(U-07). 강조 색상 205를 쓴다.

### ADR 후보 2. React 18을 유지하고 Caustic React 부품을 쓰지 않는다

- 상태: 제안
- 맥락: Caustic 부품은 ref-as-prop, `use()`, `<Context value>`를 써서 React 18에서 동작이 다르거나 없다. 결정 32는 사용자가 React 18 CSR 시니어라는 이유로 React 18을 정했다.
- 결정: React 18을 유지한다. Helm 기본 부품은 Radix 위에 `forwardRef`로 직접 쓴다.
- 근거: 결정 32. 158개 부품을 React 18용으로 고치면 Caustic 명세 잠금과 어긋난 두 벌을 유지하게 된다.
- 기각한 대안: React 19로 올리고 Caustic 부품 사용(결정 32를 바꿔야 하고, 사용자 확인 필요). Caustic 부품을 React 18용으로 포크.
- 결과: 기본 부품 약 30개를 직접 만든다. React 19 전환을 다시 검토할 때 이 ADR을 대체한다.

### ADR 후보 3. 헤드리스 Radix + Tailwind v4 + lucide-react

- 상태: 제안
- 맥락: React 18 지원, 두 웹뷰, 한국어, assistant-ui와 같은 바탕이 필요하다. shadcn 기본 바탕이 Base UI로 바뀌었고 shadcn 부품은 `forwardRef`를 쓰지 않는다.
- 결정: `radix-ui` 통합 패키지, Tailwind v4 + cva + tailwind-merge, lucide-react 1.x. shadcn CLI 생성 부품을 쓰지 않는다.
- 근거: assistant-ui가 이미 `radix-ui`에 의존해 헤드리스 라이브러리를 하나로 유지한다. Caustic `theme.css`가 Tailwind 4다. lucide 1.x의 `aria-hidden` 기본값.
- 기각한 대안: Base UI(두 라이브러리 공존), React Aria(국제화가 가장 깊으나 Helm에 필요한 부품이 적고 스타일 연결이 다름), CSS Modules, CSS-in-JS.
- 결과: macOS 웹뷰 하한이 Safari 16.4(Tailwind) 이상, Helm 기준은 17.5.

### ADR 후보 4. assistant-ui는 객체별 대화 스레드의 primitives와 ExternalStoreRuntime만 쓴다

- 상태: 제안
- 맥락: v0.3 13·14와 대화 [151]~[155]의 조사. 결정 14(모델은 제안, 커널이 변경), 결정 31(WebSocket + seq).
- 결정: §3.10.1만 쓰고 §3.10.2는 쓰지 않는다. 의존은 `ui/conversation/` 안에만 둔다.
- 근거: 사람의 결정이 모델 도구 경로를 거치지 않아야 하고, 모델이 앱 상태를 직접 바꾸는 기능이 커널을 우회한다. Elements는 반복 애니메이션 의존과 React 18 ref 문제가 있다.
- 기각한 대안: Elements로 상태 화면 구성(v0.3 14 §5.2 권고), 생성형 UI로 가능성 비교, AssistantTransport, 대화 패널도 직접 구현(교체 비용이 작아 지금은 assistant-ui를 쓴다).
- 결과: 대화 패널 교체가 쉽다. 상태 화면 부품은 모두 직접 만든다.

### ADR 후보 5. 대안 고르기 금지를 컴포넌트 API와 테스트로 강제한다

- 상태: 제안
- 맥락: 결정 18. 원천 UX 조사에는 "Choose alternative" 같은 고르기 행동이 남아 있다(helm-canon-3 §7.1 C2).
- 결정: §3.9의 R1~R7.
- 근거: 원칙을 문서로만 두면 화면마다 다시 들어온다. 타입·정적 검사·렌더 테스트로 막는다.
- 기각한 대안: 문구 지침으로만 관리.
- 결과: 원함 탐구 부품은 선택지 prop이 없다. 결정 질문의 대안 표시는 허용하되 개수를 줄이지 않는다.

### ADR 후보 6. 화면은 낙관적 도메인 갱신을 하지 않고 결정 의도에 기준 seq를 붙인다

- 상태: 제안
- 맥락: 결정 14·31·32, 원천의 cursor binding(helm-canon-2 L14). 같은 방향의 결정이 04 ADR 후보 A4(연결이 끊기거나 화면이 낡으면 결정을 막고 초안만 보존)와 20 §3.9.7에 있다. 이 후보는 부품 쪽 규칙만 다룬다. 2단계에서 셋을 하나의 ADR로 합칠 수 있다.
- 결정: UI-D02, UI-D03, §3.6.4.
- 근거: 커널만 상태를 바꾼다. 낡은 화면에서 내린 결정을 데몬이 알아볼 수 있어야 한다.
- 기각한 대안: 낙관적 갱신 후 되돌리기, 오프라인 결정 대기열.
- 결과: 느린 연결에서 결정이 반영되기까지 "반영 기다리는 중"이 보인다. 19에 `stale_basis` 오류와 멱등 키가 필요하다.

### ADR 후보 7. 1차에 그래프·차트 라이브러리를 들이지 않는다

- 상태: 제안
- 맥락: Helm 시각화는 한국어 문장이 많은 계층·시간 구조다.
- 결정: 근거 체인은 트리, 루프 타임라인·Goal 이력은 목록, 지표는 SVG.
- 근거: 키보드·스크린 리더 접근성, 의존성 크기, Caustic도 SVG를 직접 그린다.
- 기각한 대안: React Flow + dagre 관계 그래프, Recharts·visx. elkjs(라이선스).
- 결과: 관계가 복잡해지면 React Flow + dagre를 다시 검토한다.

### ADR 후보 8. 부품 카탈로그는 Storybook, 시각 테스트는 Playwright 두 엔진

- 상태: 제안
- 맥락: 두 웹뷰(WebView2, WKWebView), 사용자 규칙(`just verify`, `just shot`), 외부 업로드 제한.
- 결정: Storybook 10 + addon-vitest(동작·접근성), Playwright `toHaveScreenshot`(chromium·webkit, 2%).
- 근거: React 18 지원, Playwright 실험적 CT 동결, WebKit 엔진이 WKWebView의 근사.
- 기각한 대안: Ladle(정체), Playwright CT, Chromatic·Argos(외부 서비스).
- 결과: 실제 macOS 화면은 `just shot-mac`으로 사람이 확인한다.
