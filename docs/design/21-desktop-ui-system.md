# 21. 데스크톱 UI 시스템

- 작성: 2026-10-11, P14 UI. 2a단계 개정·4단계 보완 2026-10-12
- 상태: 4단계 보완판(2026-10-12). 기준 결정 1~64(브리프 §2), 조정자 판정 J-01~J-275(`docs/design/process/rulings-stage2a.md`)를 반영했다. 사용자 결정 41~43(React 19, 부품 직접 제작, 글래스모피즘, 휴대폰 응답, Caustic 토큰 복사와 neutral 축소)과 47~50(모바일 PWA, 휴대폰 알림 강도, iOS 26, shadcn 소스 복사)이 이 문서의 주된 근거다. 03(화면 ID·셸 영역·상태 라벨), 04(뷰 모델), 05(키보드·문구·자극 반응 흐름), 08(레코드 종류), 13(보장 수준), 15(지지 등급·라운드 마침), 16(평가 화면), 19(메서드·오류 코드), 20(앱 구조·연결 상태)에 맞췄다. 1단계 판은 `.helm-design-work/P14/21-stage1-backup.md`에 있다.
- 소유: 디자인 토큰, 타이포·레이아웃 규칙, 컴포넌트 목록과 계약(props, 상태, 키보드, 접근성), 시각화 컴포넌트, 화면 → 컴포넌트 매핑, UI 라이브러리 선택, 컴포넌트 단위 시각 테스트.
- 소유하지 않음: 화면 ID·이름과 정보 구조·상태 라벨(03), 화면별 레이아웃·뷰 모델 타입(04), 문구·키 배정(05), 프로토콜 메서드(19), 앱 구조·상태 동기화·라우팅·알림·트레이(20), 도메인 레코드 정의(08), 질문 레코드(11), 루프·다이얼·주의 예산(14), 자극·반응·선호 모델의 생성 규칙(15).

## 1. 목적과 범위

### 1.1 목적

Helm 데스크톱 앱(브리프 결정 19·41, 조정자 기본값 32)의 렌더러 계층을 구현자가 이 문서만 보고 만들 수 있게 한다. 이 계층은 데몬이 보낸 투영(projection)을 화면에 그리고, 사람의 조작을 "의도(intent)"로 만들어 앱 상태 계층(20)에 넘긴다. Helm 로직은 두지 않는다(결정 32).

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
| §3.12 | 부품별 키(05 §3.8 정본) |
| §3.13 | 모바일과 나눠 쓰는 경계(결정 42) |
| §3.14 | 글래스모피즘 시각 언어: 참고 출처, 표면 층위, 창 효과, 움직이는 장식(결정 41) |
| §6 | 파일·폴더 구조, 스토리북, 시각 테스트, 완료 기준 |

### 1.3 다루지 않는 것

- 앱 프로세스 구조, Tauri 설정, 클라이언트 저장소, 재접속, 라우팅, 알림 채널, 트레이, 키체인: 20.
- 화면 목록의 ID와 이름, 셸 영역, 내비게이션 구조, 상태 라벨: 03. 이 문서는 03 §3.6의 화면 ID를 쓴다.
- 화면별 레이아웃 상세와 모든 문구의 최종 문장: 04·05. 이 문서에 나오는 한국어 문구는 컴포넌트 계약을 설명하기 위한 자리 표시이며, 문구 키(§3.6.7)로 05의 정본 문구에 연결한다.
- TUI(결정 39, 조정자 기본값 33). 다만 모든 복합 컴포넌트가 선형 텍스트 표현을 갖게 해(§3.6.6) TUI와 같은 정보를 보이는지 비교할 수 있게 한다.
- 도메인 판정(가역성, 위험, 승격, 질문 전달 시점). 화면은 판정 결과를 보여 주기만 한다(결정 2·14).

### 1.4 표시 규칙

브리프 §5.2를 따른다. `[결정 n]`은 브리프 §2의 사용자 결정 번호에만 쓴다(판정 J-144). 조정자 기본값(브리프 결정 26~37)은 `[제안: 결정 n 기본값]`, 조정자 판정은 `[판정 n]`(브리프 결정 44~46) 또는 `[판정 J-nn]`(`rulings-stage2a.md`)으로 적는다. `[제안]`은 이 문서가 정한 것, `[가정]`은 확인되지 않은 전제다. 외부 사실은 `[원문]`(파일·문서 직접 확인), `[실험]`(이 작업 중 코드 실행으로 확인), `[검색]`(웹 확인), `[지식]`(재확인 안 함)을 붙인다.

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
| 14, 41, 기본값 32 | 화면은 상태를 직접 바꾸지 않는다. 조작은 의도로 올라가고, 받아들여진 결과만 스트림으로 돌아온다. 낙관적 도메인 갱신 금지(§3.6.4) |
| 17(불변조건 1~7) | 관찰·추측·판단·선택 구분, 완료 주장·결과 확인·전체 반영 구분, 모름·이견·낡음을 숨기지 않음을 시각 문법으로 강제(§3.5) |
| 19, 41, 기본값 32 | Tauri v2 + React 19 + TypeScript + Vite. 결정 41이 기본값 32의 "React 18"을 대체한다. UI 부품은 Helm이 직접 만들고(Caustic React 부품을 가져오지 않음), 시각 언어는 최근 에이전트 클라이언트를 참고한 글래스모피즘이다. 반투명 표면은 시각 표현이며 문장 규칙인 "의인화 금지"와 무관하다 |
| 42 | 휴대폰에서도 질문에 답할 수 있어야 한다(모바일 클라이언트는 데스크톱 MVP 다음 단계, 26). 토큰과 표현 부품은 모바일과 나눠 쓸 수 있게 경계를 둔다(§3.13) |
| 43 | Caustic 토큰은 복사해서 가져오고(npm·git 의존 없음), neutral 단계를 Helm에 맞게 줄여 다시 정한다(§3.2.2) |
| 판정 44 | Node 24 LTS, TypeScript 6.0(빌드 도구 기준) |
| 47, 49 | 모바일 클라이언트는 데몬이 서빙하는 PWA이고 최소 판은 iOS 26이다 [결정 47, 49]. `@helm/ui`·`@helm/ui-tokens`는 브라우저 표준만 쓰고 Tauri에 기대지 않는다(§3.13). iOS 26 Safari는 `backdrop-filter`를 접두사 없이 지원하므로 [지식] 유리 재질과 대비 관문 값은 데스크톱과 같다. 시각 테스트의 WebKit 판(§6.3)이 모바일 렌더의 근사다 |
| 48 | 휴대폰 알림은 `interrupt`·`notice` 질문까지 간다. 알림에서 열린 화면은 같은 `QuestionCard`를 `touch` 밀도로 쓴다 [결정 48] |
| 50 | shadcn/ui 소스를 복사해 Helm 코드로 고쳐 쓰는 것은 결정 41의 "부품 직접 제작"에 들어간다(§2.5.2) [결정 50] |
| 51, 52 | 구현 작업은 메인 오케스트레이터, 하위 조정자, 실작업자 3단계로 나눈다. 모델 구성은 결정 58이 정한다(결정 52 개정): 메인 Opus 5.5 medium~high, 하위 조정자 Sonnet 5.5 medium 또는 high(작업 난이도에 따라), 실작업자 Haiku 5.5 xhigh. UI 부품 구현은 §6.2 단위(U1~U9)로 나눠 실작업자에게 줄 수 있게 부품마다 계약·이야기·완료 기준을 이 문서에 둔다 [결정 51, 52] |
| 53 | 루프 계획은 혼합 방식이다. 기본은 모델이 계획 표시를 고르고 코드가 계획을 계산한다. 범위 밖이면 모델이 계획 전체를 설계하며, 그 계획에는 작성자 표시를 붙이고 이의를 받는다(§3.8.2). 방식 다이얼 `planAuthoring`은 다이얼 패널에 있고 MVP 노출 여섯 개에 든다. 전역 기본값은 MVP 설정 화면에서 고른다(§3.7.3 (14), [판정 J-192]) [결정 53] |
| 55 | MVP 도구에 웹 읽기(`web_fetch`)와 웹 검색(`web_search`)이 들어간다. 활동 줄에서 외부 조회로 표시하고, 가져온 내용은 신뢰하지 않는 외부 내용으로 그린다(§3.7.3 (9), E21) [결정 55] |
| 56 | 결과 확인 대기의 휴대폰 알림은 설정 값(알리지 않음, 하루 한 번 묶음, 즉시)이다. 결과 확인 패널은 알림 방식과 관계없이 같은 화면이다(§3.7.3 (11)) [결정 56] |
| 57 | Apple 개발자 프로그램이 없다고 보아 네이티브 iOS 경로는 이후에 검토한다. 이 문서의 휴대폰 열은 PWA 기준이다(§3.13) [결정 57] |
| 58 | 에이전트 구성은 난이도에 따라 정한다. 메인은 작업 전체의 마지막 검토를 맡고, 단계별 검토는 하위 조정자가 한다. 설계·구현 공통이며, 모델 구성은 위 51·52행의 값을 따른다 [결정 58] |
| 21, 22, 38, 기본값 26 | 원격 접속(Tailscale WSS 또는 SSH)과 끊김이 일상이다. 연결 상태와 투영 신선도를 항상 보인다 |
| 24 | macOS와 Windows. 두 웹뷰(WKWebView, WebView2)에서 같게 보여야 한다 |
| 25 | 문서와 화면에서 제품 사용 사례는 "유즈케이스" |
| 기본값 31 | 이벤트에 단조 증가 seq가 있다. 화면은 기준 시점을 감사 깊이에서 seq로, 그 밖의 깊이에서는 시각으로 표시한다 |
| 기본값 37 | UI 문구는 한국어. 한국어 타이포 규칙이 기본값 |

### 2.2 이 문서의 주요 선택 요약

각 항목의 근거는 표의 "절"에 있다.

| ID | 선택 | 표시 | 절 |
|---|---|---|---|
| UI-D01 | 컴포넌트는 표현 전용이다. 입력은 04의 뷰 모델, 출력은 19 메서드 이름을 쓴 `UiIntent`. 도메인 판정과 프로토콜 호출을 하지 않는다 | [제안], 결정 14와 기본값 32에서 도출 | §3.6 |
| UI-D02 | 사람의 결정 의도에는 화면이 본 뷰의 seq(`basisSeq`)를 붙인다. 낡은 카드에서 내린 결정은 데몬이 `3004 command.revisionConflict`로 거부한다 | [제안] | §3.6.3 |
| UI-D03 | 낙관적 도메인 갱신을 하지 않는다. React 19의 `useOptimistic`과 폼 action으로 도메인 의도를 보내지 않는다 | [제안] | §3.6.4 |
| UI-D04 | 색만으로 의미를 나타내지 않는다. N/E/M, 레코드 종류, 품질 상태는 라벨 + 아이콘 + 모양(테두리)으로 나타낸다 | [제안], 원천 §6.9 | §3.5 |
| UI-D05 | 숫자 confidence는 저장도 표시도 하지 않는다(J-19). 15의 지지 등급과 14의 질적 확신 등급을 글자로 보이고, 직접성·반대 근거 탐색·확인 못한 범위·다음 확인을 함께 둔다 | [판정 J-19 / 제안: 표시] | §3.5.6 |
| UI-D06 | 세 깊이(한눈에 / 검토 / 감사)를 모든 복합 컴포넌트의 공통 prop으로 둔다 | [제안] | §3.5.7 |
| UI-D07 | 원함 탐구 부품에는 "고르기" 행동이 없다. 질문 카드의 대안 표시는 순서만 바꾸고 개수를 줄이지 않는다 | [제안], 결정 18 | §3.9 |
| UI-D08 | 모든 복합 컴포넌트는 선형 텍스트 표현(`toLinearText`)을 갖는다 | [제안] | §3.6.6 |
| UI-D09 | React 19. 헤드리스는 Radix Primitives(`radix-ui` 1.8), 시작 소스는 shadcn/ui(radix 바탕)를 복사해 Helm 토큰으로 다시 입힌다. 스타일은 Tailwind CSS v4 + CSS 변수 토큰 + cva, 아이콘은 lucide-react | [결정 41: React 19·직접 제작, 결정 50: shadcn 소스 복사 / 제안: 라이브러리] | §2.5 |
| UI-D10 | 그래프·차트 라이브러리는 1차에 넣지 않는다 | [제안] | §2.5, §3.8 |
| UI-D11 | assistant-ui는 대화 스레드에만 쓴다. Interactables, 생성형 UI, AssistantTransport, Assistant Cloud, 도구 승인 콜백은 쓰지 않는다 | [제안] | §3.10 |
| UI-D12 | 글꼴은 Geist(라틴) → SUIT(한글) → Pretendard 순서. Geist·Geist Mono·SUIT를 앱에 넣어 배포한다. 한글이 들어가는 글자는 12px 미만으로 내리지 않는다 | [제안] | §3.2.3 |
| UI-D13 | Caustic 토큰을 **복사**해 Helm 토큰 원본(`packages/ui-tokens/src/tokens.ts`)으로 다시 쓴다. npm·git 의존이 없다. neutral은 16단계에서 11단계로 줄인다. 이름 접두사는 `--hm-` | [결정 43 / 제안: 방식] | §2.4, §3.2 |
| UI-D14 | 컴포넌트 카탈로그와 시각 테스트는 Storybook + Playwright 스크린샷(Chromium, WebKit 두 엔진) | [제안] | §6.3 |
| UI-D15 | 한국어 IME 조합 중 Enter는 제출하지 않는다. 한 글자 단축키는 `KeyboardEvent.code`로 판정한다(05 §3.8.1) | [제안] | §3.6.5 |
| UI-D16 | 시각 언어는 글래스모피즘이다. 떠 있는 층(크롬, 오버레이)만 유리이고, 읽는 글·목록·입력·카드는 불투명이다. 유리는 두 재질(크롬 84~86%, 오버레이 90%)만 쓰고, 유리 위 글자 대비를 최악 배경에서 검사한다 | [결정 41 / 제안: 규칙과 값] | §3.2.5, §3.14 |
| UI-D17 | 창 투명 효과: macOS는 `sidebar`(macOS 26부터 `liquidGlassRegular` 선택 가능), Windows 11은 `mica`. Windows의 `acrylic`·`blur`는 끌기·크기 조절 성능 문제로 쓰지 않는다. 설정으로 끌 수 있고 투명도 줄이기 설정을 따른다 | [제안] | §3.14.3 |
| UI-D18 | "빛은 에이전트" 규칙: 스펙트럼 테두리는 에이전트가 만든 초안·진행 중 작업에만 쓰고 장식으로 쓰지 않는다. 움직이는 장식은 진행 중 표시 하나만 쓰며 글자 상태가 항상 함께 있고 감소 모션에서 멈춘다 | [제안] | §3.5.5, §3.14.4 |
| UI-D19 | 토큰(`@helm/ui-tokens`)과 표현 부품(`@helm/ui`)은 플랫폼 중립 패키지로 두어 모바일 클라이언트(26)가 나눠 쓸 수 있게 한다. 데스크톱 전용(셸, 창 효과, 단축키)은 `apps/desktop`에 둔다 | [결정 42 / 제안: 경계] | §3.13 |

### 2.3 원천 체크리스트 대응

0단계 원천 정리의 "설계에 바로 쓸 체크리스트" 중 문서 21 항목과, 끝 목록에서 21에 걸리는 항목을 모두 적는다. "반영하지 않음"에는 이유를 적는다.

| 출처 | 항목 | 처리 | 위치 |
|---|---|---|---|
| helm-canon §21 | 권장 컴포넌트 이름(`GoalSummary`, `FocusRoom`, `PossibilityComparison`, `EvidenceView`, `ChoiceRecord`, `ActiveWorkCard`, `SinceLastVisit`, `ReviewGroup`) | 8 중 5 반영: `GoalSummary`, `PossibilityComparison`, `ActiveWorkCard`, `SinceLastVisit`, `EvidenceView`(역할이 더 분명한 `EvidenceInspector`로). 셋은 부품으로 만들지 않음: `FocusRoom`은 Concern 화면(`SCR-CONCERN-*`, 03·04)이고 화면 컨테이너는 20이 만든다. 21은 그 안의 부품 구성만 정한다(§3.11). `ChoiceRecord`는 선택 레코드 한 장을 `KindLabel`(선택) + `AuthorshipMark` + `QualityBadge` + `ChoiceImpactEcho`로 그리며 따로 이름 붙인 부품을 두지 않는다. `ReviewGroup`(팀 검토)은 1인 앱이라 만들지 않는다(결정 24) | §3.7, §3.11 |
| helm-canon §21 | 시각화: Inquiry Map(근거 체인), Integration Map, Decision Queue, Common Operating Picture, P07 가능성 비교 표 | 반영. Inquiry Map → `EvidenceChainTree`와 `InquiryBoard`, Decision Queue → `QuestionInbox`, Common Operating Picture → 홈의 `ConcernTree` + `SinceLastVisit`, 가능성 비교 표 → `PossibilityComparison`. Integration Map은 그래프로 그리지 않고 `ResultReviewPanel` 2단계의 반영 항목 목록(점검 일곱 칸별)과 `WholeUpdateBadge`로 만든다(영향 대상이 대개 수십 개 이하이고 목록이 키보드·스크린 리더에 낫다) | §3.7.3 (11), §3.8 |
| helm-canon §21 | 사실과 해석의 시각 구분, 불확실성 원인 우선, confidence 숫자 금지, 소수 반대 근거 유지 | 반영 | §3.5.2, §3.5.6, §3.8.1 |
| helm-canon §21 | 위험 버튼에 대상과 효과 표시. 상태 라벨 집합 | 반영. `ActionButton`의 `consequence` prop 필수 조건, 라벨 문구는 `@helm/ui-language`의 키로(J-103) | §3.6.3, §3.5.4 |
| helm-canon §21 | Agent 표현: 이름보다 역할과 맡긴 일, 의인화 금지 | 반영. `ActorLabel`은 아바타·이름·감정 표현을 받지 않는다 | §3.7.2 |
| helm-canon-2 §11 | 라벨 7종(Helm, Observed, Possible, Choice, Working, Review, Source)과 색 독립 표기 | 반영. 한국어 레코드 종류 라벨로 옮기고 아이콘·글자를 항상 함께 쓴다 | §3.5.2 |
| helm-canon-2 §11 | Gate 카드, Work Agreement echo, Completion 기준 행(✓/△), "전체 반영 N개 남음" 배지 | 반영. `QuestionCard`, `WorkAgreementEcho`, `ResultCriterionRow`, `WholeUpdateBadge`(화면 라벨은 03 §3.3.2 "결과 확인됨 · 반영 n개 남음") | §3.7.3 |
| helm-canon-2 §11 | 근거 drill-down의 source trace 필드 6개(시각, 명령·도구, 입력 범위, 출력 참조, 종료·오류, 출처 WorkUnit) | 반영. `SourceTrace` | §3.7.2 |
| helm-canon-2 §11 | material group 카드(최대 5 + 기타) | 반영. `MaterialChangeGroups`. 묶음 기준은 데몬 투영이 주는 묶음(Concern·WorkUnit·선택 영향)을 그대로 쓰고 경로로 다시 묶지 않는다(dogfood 001 권고, helm-canon-2 §8.7) | §3.7.3 |
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
| helm-canon-3 §7.1 C2·C3 | 대안 제시는 선택 요청에만, 2~3개로 줄이지 않음. 기본 표시 개수는 설정(`maxVisibleDecisions`, 14·11), 권리 게이트 질문은 개수 상한으로 숨기지 않음 | 반영 | §3.9 |
| conversation-extracts-4 d25 | assistant-ui를 Tauri에서 쓸 때의 제약, Background runs가 assistant-ui "run" 개념에 묶이는지, 요소 단위 반응 UI를 그 위에 만들 수 있는지, 생성형 UI 컴포넌트를 Helm 카드로 정의할 수 있는지 | 답함. Background runs·생성형 UI·Interactables는 쓰지 않고, 자극 보드는 직접 만든다 | §3.10 |
| conversation-extracts-4 20-8 | 원함 탐구 자극판: 요소 단위 반응, 이유 없는 반응 | 반영 | §3.8.3 |
| conversation-extracts-4 20-9·20-10 | 사람의 결정은 모델 도구 경로를 거치지 않는다. 모델의 앱 상태 수정은 커널 제안으로 보내고 받아들여진 것만 화면에 반영 | 반영(UI-D01, UI-D03, §3.10.2) | §3.6, §3.10 |
| conversation-extracts-4 20-11~20-13 | ExternalStoreRuntime + 자체 스트림, AssistantTransport 미사용, 독립 모드 요소(MIT, 소스 복사), Interactables 미사용, 생성형 UI 시험만, Assistant Cloud 불필요, OpenCode 런타임은 참고 구현 | 반영. 생성형 UI는 시험도 1차 범위에서 뺀다(이유 §3.10.4) | §3.10 |
| conversation-extracts-2 d-6 | 대비 압축 출력(프레임 2~3개 + 질문 하나)을 "고르기"가 아닌 "반응 받기"로 표현 | 화면 규칙 반영(접힌 항목도 반응 가능, 고르기 버튼 없음). 생성 규칙은 15 | §3.9 |
| conversation-extracts-1·2·3 끝 목록 | 문서 21에 배정된 항목 없음. 대화에서 사용자가 React 기반 설명을 원한 것(E1-144)과 시각화 요청(X3-10-07)은 기본값 32와 이 문서의 시각화 원칙으로 이어진다 | 해당 없음 | — |
| 브리프 §3.5 | "모델이 초안, 사람은 반응" 원칙(담당 P1·P2·P9) | 컴포넌트 수준 규칙을 더함: 초안 표시(`DraftMark`), 빈 양식 먼저 금지 | §3.9.5 |

### 2.4 Axiom·Caustic 검토와 사용 방식 [결정 41·43 / 제안: 방식]

#### 2.4.1 확인한 것 [원문]

저장소 `~/projects/axiom/code/axiom-design-system`(읽기 전용으로 확인, 2026-10-11·12)의 구성:

| 부분 | 내용 | 경로 |
|---|---|---|
| Axiom Studio | 디자인 시스템과 캔버스를 만드는 브라우저 앱. React 19.3, Tailwind 4.3, Radix | `apps/studio`, 루트 `package.json` |
| Foundation 1.0.0 문서 | Axiom Studio의 제품 명세(56개 문서). 구체 토큰 이름·값은 없다 | `docs/foundation/README.md` |
| Caustic | Studio 화면 부품 전체를 맡는 디자인 시스템. 양방향 git subtree. 패키지 `@caustic/tokens`·`react`·`spec`·`gateway`(모두 1.0.0, private) | `vendor/caustic/`, `SYNC.json`, `FOUNDATION.md` |
| Caustic의 시각 출처 | "Codex and Claude Code desktop: calm neutral chrome, 13px interface text, ink primary buttons", "iOS Liquid Glass: floating translucent layers with a specular rim, and concentric corners", 에이전트 전용 빛 스펙트럼(Lagoon·Mint·Amber) | `FOUNDATION.md` 1~9행 |
| Caustic 토큰 | 원본 `packages/tokens/src/tokens.mjs` 하나에서 CSS 변수, Tailwind 4 `@theme`, DTCG JSON을 생성. 원시 → 의미 → 컴포넌트 세 층. 색은 OKLCH. neutral(Graphite) 16단계, 색상 램프 5개 × 12단계. 다크·라이트는 `:root[data-theme]` + `prefers-color-scheme`, 밀도는 `:root[data-density="compact"]` | `packages/tokens/` |
| Caustic 유리 처방 | 반투명 채움, `backdrop-filter: blur() saturate(1.8)`, 위쪽 1px 반사광, 안쪽 테두리, 바깥 0.5px 경계, 대각선 광택 마스크. 재질 ultrathin 30%·blur 14 / thin 48%·20 / regular 66%·24 / thick 84%·36. `backdrop-filter`가 없으면 thick, 투명도 줄이기에서는 불투명 | `FOUNDATION.md` "Depth and materials", `dist/theme.css` 503~513행 |
| Caustic 정책 | 1 유리는 떠 있는 것에만(읽는 글·목록·입력은 불투명) / 2 빛은 에이전트 / 3 ink 먼저, 강조색은 한 화면에 한 번 / 4 두 목소리(사람 sans, 에이전트 serif, 기계 값 mono) / 5 동심 반경 / 6 대비는 빌드 관문 / 8 모션에는 일이 있다 / 9 입력칸이 자기 포커스를 그린다 | `FOUNDATION.md` "Policies" |
| Caustic 대비 관문 | 본문 7:1, 보조·placeholder 4.5:1, 비활성 3:1, 컨트롤 경계·포커스 3:1, 강조 위 라벨 4.5:1. 알파 토큰은 실제 배경에 합성해 잰다. 유리 위 글자는 캔버스와 채도 높은 내용 양쪽 위에서 잰다. 84/84 규칙 통과 | `FOUNDATION.md` "Contrast policy", `dist/contrast.json` |
| Caustic 한국어 규칙 | `:where(:lang(ko)) { word-break: keep-all; overflow-wrap: anywhere; }`, 한국어 제목 음수 자간 −0.01em 상한 | `packages/tokens/src/base.css` 29·52·53행 |
| React 부품 | 158개, peer `react ^19` | `packages/react/package.json` |
| 라이선스 | 루트 MIT("Copyright (c) 2026 Lee in"). Caustic에는 LICENSE 파일과 `license` 필드가 없다 | `LICENSE`, `vendor/caustic/` |

#### 2.4.2 사용 방식

| 대상 | 판단 |
|---|---|
| Caustic React 부품 | 쓰지 않는다(결정 41: UI 부품은 Helm이 직접 만든다). React 19라 기술적으로 막히지는 않지만, Helm 부품은 Helm 의미 규칙(§3.5, §3.9)을 계약으로 가져야 하고 디자인 도구용 부품이 많다. 파일 구성(`<id>.tsx`, `<id>.variants.ts`, `data-slot`)과 정적 규칙만 옮긴다(§3.6.1, §6.4) |
| Caustic 토큰 | **복사해서 다시 쓴다**(결정 43). npm·git 의존을 두지 않는다. Caustic `tokens.mjs`의 값과 의미 층 대응을 Helm 원본 `packages/ui-tokens/src/tokens.ts`로 옮기고, Helm 빌드 스크립트가 CSS 변수·Tailwind `@theme`·DTCG JSON·대비 보고서를 생성한다(§3.2.8). 접두사는 `--hm-` |
| neutral 램프 | 16단계 → 11단계로 줄인다(§3.2.2). Helm이 쓰는 의미 토큰이 실제로 참조하는 단계만 남겼다 |
| 색상 램프 5개 | 그대로 복사한다(accent=Lagoon 색상 205, success=Mint 158, warning=Amber 72, danger=Coral 25, info=Iris 295). 12단계 중 의미 토큰이 쓰는 단계만 내보낸다 |
| 쓰지 않는 의미 토큰 | `canvas-*`, `identity-*`, `media-*`, `--cs-studio-*`, 디자인 도구 전용 크기, `material.ultrathin/thin/regular`(Helm은 두 재질만, §3.2.5) |
| 유리 처방, 정책 1·2·3·5·6·8·9 | Helm `base.css`에 다시 적어 쓴다. 정책 4(에이전트 serif)는 1차에 쓰지 않는다(§3.2.3, U-20) |
| 대비 관문 | 같은 기준을 Helm 빌드에 둔다. 유리 위 글자는 최악 배경(§3.2.5)에서 잰다 |
| Foundation 문서 | 쓰지 않는다. Axiom Studio 제품 명세다 |
| 출처 표시 | `packages/ui-tokens/NOTICE.md`에 Caustic 출처(Axiom 저장소의 `vendor/caustic`, 복사한 커밋 `8c43d45…`, 복사한 파일과 날짜, 사용자 소유)와 바꾼 점(neutral 축소, 접두사, 뺀 토큰)을 적는다. Caustic에 라이선스 표시가 없으므로 소유자 확인 사실을 함께 적는다(U-07) |

복사 뒤에는 Caustic이 바뀌어도 Helm이 자동으로 따라가지 않는다. 다시 가져올 때는 사람이 차이를 보고 `tokens.ts`를 고친다.

### 2.5 UI 라이브러리 선택

외부 사실은 2026-10-11·12에 npm 레지스트리, 공식 문서, 패키지 소스로 확인했다. 확인 경로는 §8 출처에 있다.

#### 2.5.1 기준

1. React 19(결정 41)에서 동작하고 유지보수가 계속된다.
2. Tauri v2의 두 웹뷰(Windows WebView2, macOS WKWebView)에서 같게 동작한다.
3. 한국어 입력(IME)과 한국어 조판에 문제가 없다.
4. assistant-ui와 같은 바탕을 쓴다. 같은 일을 하는 라이브러리를 둘 들이지 않는다.
5. 부품을 Helm이 직접 소유한다(결정 41). 패키지에 숨은 스타일·동작이 적어야 한다.
6. 1인 개발이 유지할 수 있는 크기다.

#### 2.5.2 헤드리스 컴포넌트: Radix Primitives + shadcn/ui 소스 복사 [결정 50 / 제안: Radix 바탕 선택]

React 19에서는 ref가 일반 prop이라 1단계에서 문제였던 "shadcn 부품의 `forwardRef` 없음"이 사라졌다. 세 후보를 다시 비교했다.

| 후보 | 확인한 사실 | 판단 |
|---|---|---|
| **Radix(`radix-ui` 1.8.0)** | peer `react ^16.8 … ^19.0`, MIT [검색: npm]. shadcn의 new-york 스타일이 2026-02부터 통합 `radix-ui` 패키지를 쓴다 [검색: ui.shadcn.com changelog 2026-02]. assistant-ui 0.15.28이 `radix-ui ^1.7`에 의존한다 [검색: npm] | **채택.** assistant-ui가 이미 끌고 오므로 헤드리스 라이브러리가 하나로 유지된다. 위치 계산(floating-ui 내장)을 맡겨 CSS 앵커 위치(Safari 26부터)를 쓰지 않아도 된다 |
| Base UI(`@base-ui/react` 1.9.0) | 1.0 안정판 2025-12, peer `react ^17 \|\| ^18 \|\| ^19` [검색: npm]. shadcn이 2026-07-02부터 기본 바탕으로 쓴다("Radix is not being deprecated") [검색: ui.shadcn.com changelog 2026-07] | 기각. 품질은 좋으나 assistant-ui의 Radix와 두 라이브러리가 공존한다. Radix 유지 중단 신호가 없다 |
| React Aria Components 1.22.1 | peer React 19 포함, Apache-2.0, `ko-KR` 문자열 표, IME 조합 처리 [검색: npm, 패키지 소스] | 기각. 국제화가 가장 깊으나 Helm이 쓸 날짜·숫자 부품이 적고, 스타일 연결 방식이 Radix와 달라 assistant-ui 부품과 섞기 어렵다. 한국어 IME 문제는 Enter·단축키 판정(§3.6.5)으로 좁혀 직접 다룬다 |

shadcn/ui 소스 복사 [결정 50]: shadcn CLI 4.21(Tailwind v4, React 19, `React.ComponentProps` 방식) [검색: npm, ui.shadcn.com/docs/tailwind-v4]의 radix 바탕 부품을 **시작 소스로 복사**한다(`npx shadcn add`로 생성 후 저장소에 들임). 복사 뒤에는 Helm 소유 코드다: Helm 토큰 클래스로 다시 입히고, Helm 정적 규칙(§6.4)을 통과하게 고치고, 상태 이야기(§6.3)를 붙인다. shadcn 레지스트리를 런타임 의존으로 두지 않는다. shadcn 소스를 복사해 Helm 코드로 고쳐 쓰는 것은 결정 41의 "부품 직접 제작"에 들어간다 [결정 50]. 바탕을 Base UI가 아닌 Radix로 고른 것은 이 문서의 선택이다 [제안].

#### 2.5.3 스타일 방식: Tailwind CSS v4 + CSS 변수 토큰 + cva [제안]

| 후보 | 판단 |
|---|---|
| **Tailwind v4(4.3) + Helm CSS 변수 + `class-variance-authority` + `tailwind-merge`** | **채택.** Helm 토큰 빌드가 Tailwind 4 `@theme`을 생성한다(Caustic 방식). shadcn·assistant-ui 소스가 Tailwind v4로 쓰여 있다 [검색: r.assistant-ui.com, ui.shadcn.com]. 정적 검사(토큰 밖 클래스 금지)를 Caustic `studio-lint` 방식으로 만든다 |
| CSS Modules, vanilla-extract, CSS-in-JS 런타임 | 기각. 1단계와 같은 이유 |

Tailwind v4의 최소 브라우저는 Chrome 111, Safari 16.4다 [검색: tailwindcss.com/docs/compatibility].

#### 2.5.4 아이콘: lucide-react 1.55 [제안]

peer React 19 포함, ISC, 1.0부터 `aria-hidden` 기본 [검색: npm, lucide 1.0.1 릴리스]. Caustic과 같은 계열이고 선 두께 1.75 정책을 그대로 쓴다. Tabler(MIT)는 대안, Phosphor는 2025-05 이후 릴리스가 없어 기각 [검색: npm].

#### 2.5.5 그래프·차트: 1차에 넣지 않음 [제안]

1단계 판단을 유지한다. 근거 체인은 트리 목록, 루프 타임라인·Goal 이력은 세로 목록, 지표는 직접 그린 SVG. 필요해지면 `@xyflow/react` 12(peer `react >=17`, MIT) + `@dagrejs/dagre`(MIT), 시계열은 `@visx/*` 4(peer `react ^18 || ^19`) [검색: npm]. elkjs는 EPL-2.0/GPL 라이선스라 쓰지 않는다 [검색: npm]. Caustic도 차트를 직접 그린 SVG로 만든다 [원문: `apps/studio/src/theme-workspace/charts.ts`].

#### 2.5.6 그 밖의 라이브러리 [제안]

| 용도 | 선택 | 확인 |
|---|---|---|
| 긴 목록 가상화 | `@tanstack/react-virtual` 3.14 | peer React ≤19 [검색: npm] |
| 텍스트 차이 | `diff` 9.0(BSD-3-Clause), 어절 단위 | [검색: npm] |
| 마크다운 | `react-markdown` 10.1(peer `react >=18`, MIT) + `remark-gfm` 4.0(MIT). 원시 HTML 끔, 링크 스킴 제한 | [검색: npm] |
| 자동 높이 입력 | `react-textarea-autosize`(assistant-ui 의존). CSS `field-sizing`은 Safari 26.2부터라 쓰지 않음 | [검색: npm, MDN BCD] |
| 날짜 표시 | `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat`(`ko-KR`) | [지식] |
| 대화 스레드 | `@assistant-ui/react` 0.15.28 primitives + `useExternalStoreRuntime`. peer `react ^18 \|\| ^19` | [검색: npm], §3.10 |

#### 2.5.7 웹뷰 기준과 CSS 기능 [제안]

- Windows: WebView2 Evergreen(Edge Stable과 같이 갱신) [검색: learn.microsoft.com]. Windows 11에서 Mica 창 효과 가능, Windows 10은 창 효과 없이 불투명 대체(§3.14.3).
- macOS: WKWebView는 시스템 WebKit을 쓴다 [검색: v2.tauri.app/reference/webview-versions]. 기준 **Safari 18 이상**으로 올린다 [제안]. 이유: `backdrop-filter`가 접두사 없이 지원되는 첫 판이 Safari 18이다(17 이하는 `-webkit-` 접두사 필요) [검색: MDN BCD]. 접두사와 함께 쓰면 17.5에서도 동작하지만, 유리가 시각 언어의 중심이 된 이상 기준을 18(macOS 14 이상에서 갱신 가능)으로 둔다. Safari 26.x가 Sonoma·Sequoia에 배포되었다 [검색: eclecticlight.co 2026-08-18]. Tauri `minimumSystemVersion`은 14.0 유지(20).
- 시작할 때 `CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)')`를 검사해 실패하면 유리를 불투명으로 바꾼다(§3.14.2).

| 기능 | Safari | Chromium | Helm 처리 [검색: MDN browser-compat-data] |
|---|---|---|---|
| `backdrop-filter` | 18(접두사 없이), 9(`-webkit-`) | 76 | 두 속성을 함께 쓴다 |
| `prefers-reduced-transparency` | 지원 안 함 | 118 | WebView2에서는 미디어 쿼리, macOS는 Rust에서 OS 설정을 읽어 `data-transparency`로 넘긴다(20에 요구) |
| `prefers-contrast` | 14.1 | 96 | `more`에서 유리를 불투명으로 |
| `forced-colors` | 16 | 89 | Windows 고대비에서 유리·그림자 끔 |
| `oklch()`, `:has()`, `@layer`, `@container` | 15.4~16 | 105~111 | 사용 |
| `color-mix()`, `@property` | 16.2, 16.4 | 111, 85 | 사용 |
| `text-wrap: balance` / `pretty` | 17.4·17.5 / 26 | 114 / 117 | 점진 적용 |
| 앵커 위치, `field-sizing`, `@scope`, `overflow-anchor`, `interpolate-size` | 26~27 또는 없음 | — | 쓰지 않음(1단계와 같음) |
| `word-break: auto-phrase` | 미출시. Chrome도 일본어만 | | 쓰지 않음. 한국어는 `keep-all` [검색: developer.chrome.com css-i18n-features] |

#### 2.5.8 테스트·카탈로그 도구 [제안]

1단계와 같다. Storybook 10.6 + `@storybook/react-vite`(peer React 19 포함) + `@storybook/addon-vitest`, 시각 테스트는 `@playwright/test` `toHaveScreenshot`(Chromium·WebKit) [검색: npm, Storybook·Playwright 릴리스]. 외부 시각 비교 서비스(Chromatic, Argos)는 쓰지 않는다. 유리 표면은 스크린샷이 배경에 따라 달라지므로 이야기마다 고정 배경 이미지(채도 높은 그림 1장, 회색 단색 1장) 위에서 찍는다(§6.3).

#### 2.5.9 impeccable [검색 / 제안: 쓰는 방식]

- 확인한 것: impeccable은 Paul Bakaus가 만든 공개 디자인 스킬 묶음이다(Apache-2.0). Anthropic의 frontend-design 스킬을 넓혀 타이포·색·간격·모션·상호작용·반응형·UX 문구 참조 파일과 명령(`/audit`, `/critique`, `/polish` 등)을 둔다. Claude Code에서는 `/plugin marketplace add pbakaus/impeccable`로 들인다 [검색: emelia.io, mdskills.ai 정리 글. 원 저장소는 확인하지 않음].
- 이 환경: 설치되어 있지 않다. `~/.claude/skills`, 플러그인 목록, 조직 플러그인 카탈로그 검색에서 찾지 못했다 [실험: 2026-10-12]. 이 설계 작업에서는 쓰지 않았다.
- 쓰는 방식 [제안]: 구현 단계에서 사용자가 설치하면, 부품 구현 뒤 Storybook 이야기와 `just shot` 화면에 `/critique`(위계·밀도)와 `/audit`(대비·접근성)를 돌려 지적 사항을 이슈로 받는다. impeccable의 판단이 이 문서의 규칙(§3.5, §3.9, §3.14)과 다르면 이 문서가 우선하고, 다르게 할 근거가 있으면 이 문서를 고친다. impeccable을 빌드·테스트 의존으로 두지 않는다(대비·정적 검사는 Helm 스크립트가 맡는다).

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
| UP-9 | 의인화 금지(문장과 행위자 표시) | 아바타, 사람 이름, 감정 표현, 타이핑 애니메이션, "생각 중" 문구를 쓰지 않는다. 행위자는 역할과 맡긴 일로 표시한다. 반투명 표면·흐림 같은 시각 재질은 이 규칙과 무관하다(결정 41) | helm-canon §17.6 §7, v0.3 09 §6, 결정 41 |
| UP-10 | 언제 기준인지 보인다 | 투영을 그리는 화면은 기준 seq와 시각, 신선도를 보인다. 낡은 화면을 현재처럼 보이지 않는다 | helm-canon-2 §3.13, helm-canon-3 §6.4 P6 |
| UP-11 | 결정은 결과를 말한다 | 결정 버튼 문구는 결과를 말하고, 위험한 행동은 대상과 효과를 버튼에 넣는다. `[승인] [거절]`만 있는 묶음을 만들지 않는다 | helm-canon §17.6 §4, helm-canon-2 §3.7 |
| UP-12 | 애니메이션 없이도 이해된다 | 상태는 글자·정적 표시로 전달한다. 모션은 피드백(누름·호버)과 위치 이동을 돕고, 반복 모션은 "에이전트가 지금 일하는 중" 표시 하나에만 쓴다(§3.14.4). 감소 모션에서 반복·전환을 모두 끈다 | helm-canon-2 §3.14, Caustic 정책 8 |
| UP-13 | 정상 진행은 조용히 | 진행 이벤트마다 토스트·알림을 띄우지 않는다. 토스트는 사람이 방금 한 조작의 결과와 오류에만 쓴다 | helm-canon §17.6 §8, helm-canon-3 §6.16 |
| UP-14 | 유리는 떠 있는 것에만 | 크롬(창 머리, 레일, 상태 줄, 진행 중 서랍, 입력창 띠)과 오버레이(팝오버, 메뉴, 시트, 토스트, 명령 팔레트)만 유리다. 읽는 글, 목록, 카드, 입력칸, 자극, 근거 트리는 불투명 표면이다 | 결정 41, Caustic 정책 1 |
| UP-15 | 빛은 에이전트 | 스펙트럼(Lagoon·Mint·Amber) 테두리·빛은 에이전트가 만든 초안, 에이전트가 진행 중인 작업에만 쓴다. 장식으로 쓰지 않는다. 사람이 쓴 것과 에이전트가 쓴 것을 글자 라벨과 함께 구분하는 보조 수단이다 | Caustic 정책 2, §3.5.5 |
| UP-16 | ink 먼저, 강조색은 한 번 | 주 행동은 ink(거의 검정/밝힌 회색) 버튼. 강조색은 선택·포커스·링크·토글과 화면당 확인 행동 하나에만 쓴다. 상태 색은 상태만 뜻한다 | Caustic 정책 3 |

### 3.2 디자인 토큰

#### 3.2.1 층과 이름 [제안]

```text
층 1  원시     --hm-neutral-0…10, --hm-accent-600, --hm-space-2_5 …   부품은 읽지 않는다
층 2  의미     --hm-color-text-tertiary, --hm-material-chrome, --hm-control-md, --hm-elevation-2 …
층 3  Helm 의미 --helm-*  (층 2만 참조): N/E/M, 작성자, 품질, 신선도, 반응 표시
층 4  부품 지역 --hc-<부품>-<속성>  (층 2·3만 참조, 그 부품 파일 안에서만)
```

- 층 1·2는 Caustic 토큰을 복사해 다시 쓴 것이다(결정 43, §2.4.2). 의미 토큰 이름은 Caustic 이름에서 접두사만 `--cs-`를 `--hm-`로 바꿨다(예: `--cs-color-text-primary` → `--hm-color-text-primary`). 원래 이름을 아는 사람이 대응을 찾기 쉽게 하려는 것이다.
- Tailwind 클래스는 Helm 토큰 빌드가 생성한 `@theme` 이름(`bg-surface-base`, `text-text-primary`, `rounded-md`, `h-control-md`, `shadow-2`, `ease-standard`)과 Helm 유틸리티(`glass-chrome`, `glass-overlay`, `agent-rim`)만 쓴다.
- 리터럴 색, `dark:` 변형, 임의 값(`w-[123px]`), 색 알파 수정자(`bg-black/50`)는 금지한다(§6.4).
- 간격 단위는 4px(`--spacing: 4px`).

#### 3.2.2 색

**neutral 램프: 16단계 → 11단계** [결정 43 / 제안: 값]

Caustic Graphite(색상 260, 채도 ≤ 0.012) 16단계 중 Helm 의미 토큰이 실제로 참조하는 단계만 남겼다. 값은 Caustic 값을 그대로 쓴다. 뺀 단계: 25(0.985), 100(0.945), 150(0.925), 200(0.9), 800(0.32). 25를 쓰던 자리(라이트 `surface.raised`, 다크 `text.primary`, `ink.on`)는 0으로, 800을 쓰던 자리(라이트 `ink.hover`, 다크 `control.raised-hover`)는 7로 옮겼다. 옮긴 자리는 모두 대비가 같거나 높아진다(아래 대비 표).

| Helm 단계 | Caustic 원래 단계 | OKLCH | sRGB(계산) | 라이트 테마 용도 | 다크 테마 용도 |
|---|---|---|---|---|---|
| `neutral-0` | 0 | `oklch(0.995 0.001 260)` | `#FDFDFE` | 표면(카드·패널), 유리 채움, 반전 글자, 강조 위 글자 | 본문 글자(`text.primary`), ink 위 글자 |
| `neutral-1` | 50 | `oklch(0.97 0.003 260)` | `#F4F5F7` | 창 배경(`bg.app`) | — |
| `neutral-2` | 300 | `oklch(0.845 0.008 260)` | `#C9CCD1` | — | 보조 글자(`text.secondary`), 유리 위 3차 글자 |
| `neutral-3` | 400 | `oklch(0.65 0.011 260)` | `#8B8F96` | 비활성 글자, 컨트롤 경계, 꺼진 스위치 | 3차 글자, placeholder |
| `neutral-4` | 500 | `oklch(0.54 0.012 260)` | `#6B6F76` | — | 비활성 글자, 컨트롤 경계 |
| `neutral-5` | 600 | `oklch(0.48 0.012 260)` | `#5A5E65` | 3차 글자, placeholder | ink 호버 |
| `neutral-6` | 700 | `oklch(0.41 0.012 260)` | `#474B51` | 보조 글자 | ink(주 버튼) |
| `neutral-7` | 850 | `oklch(0.265 0.01 260)` | `#22252A` | ink 호버 | 올린 표면(`surface.raised`), 컨트롤 올림 |
| `neutral-8` | 900 | `oklch(0.225 0.009 260)` | `#191C20` | ink(주 버튼) | 표면(`surface.base`), 유리 채움 |
| `neutral-9` | 950 | `oklch(0.18 0.008 260)` | `#101215` | 본문 글자, 경계·채움 알파의 바탕색 | 창 배경(`bg.app`) |
| `neutral-10` | 1000 | `oklch(0.14 0.007 260)` | `#08090C` | 경고 단색 위 글자 | 상태·강조 단색 위 글자 |

sRGB 값은 OKLCH → sRGB 변환으로 계산했다 [실험: `.helm-design-work/P14/neutral_contrast.py`]. 정본은 OKLCH 값이다.

**의미 색** [원문: Caustic 의미 대응 / 제안: neutral 단계 이동]

| 의미 토큰(`--hm-color-…`) | 라이트 | 다크 | Helm 용도 |
|---|---|---|---|
| `bg-app` | neutral-1 | neutral-9 | 창 배경. 창 효과를 켜면 투명(§3.14.3) |
| `bg-inset` | neutral-9 / 0.04 | 검정 / 0.22 | M(실제 변화) 블록, 코드, 도구 입출력 |
| `bg-scrim` | neutral-9 / 0.24 | (Caustic 값) | 대화상자 뒤 |
| `surface-base` | neutral-0 | neutral-8 | 카드, 가운데 본문, 입력칸 |
| `surface-raised` | neutral-0 + `elevation-1` | neutral-7 | 인스펙터 고정 판, 펼친 카드 |
| `material-chrome` | neutral-0 / 0.84 | neutral-8 / 0.86 | 크롬 유리(§3.2.5) |
| `material-overlay` | neutral-0 / 0.90 | neutral-8 / 0.90 | 오버레이 유리 |
| `material-rim` / `-edge` / `-specular` / `-sheen` | 흰색 / 0.62, neutral-9 / 0.11, 흰색 / 0.95, 흰색 / 0.5 | 흰색 / 0.09, 검정 / 0.55, 흰색 / 0.17, 흰색 / 0.1 | 유리 테두리·반사광(Caustic 처방) |
| `text-primary` | neutral-9 | neutral-0 | 본문 |
| `text-secondary` | neutral-6 | neutral-2 | 보조 설명 |
| `text-tertiary` | neutral-5 | neutral-3 | 메타 정보(시각, ID). 유리 위에서는 쓰지 않는다 |
| `text-tertiary-on-glass` | neutral-6 | neutral-2 | 유리 위 메타 정보(아래 유리 표) |
| `text-placeholder` | neutral-5 | neutral-3 | 입력 안내 |
| `text-disabled` | neutral-3 | neutral-4 | 비활성 |
| `text-link`, `accent-text` | accent 465·118 | accent 815·105 | 링크, 근거 참조 |
| `border-subtle` / `default` / `strong` | neutral-9 / 0.07, 0.12, 0.2 | 흰색 / 0.06, 0.1, 0.17 | 구분선, 카드 테두리(장식), E 레코드 왼쪽 선 |
| `border-control` | neutral-3 | neutral-4 | 입력칸·N 카드 테두리(3:1 이상 필요한 경계) |
| `fill-hover` / `pressed` / `selected` | neutral-9 / 0.045, 0.075, 0.11 | 흰색 / 0.05, (Caustic), 0.12 | 호버, 눌림, 선택 |
| `control-raised` / `-hover` | neutral-0 / 0.8, 0.94 | neutral-7 / 0.76, 0.82 | 보조 버튼, 분할 컨트롤 손잡이, 현재 내비게이션 |
| `ink-solid` / `ink-hover` / `ink-on` | neutral-8 / 0.9, neutral-7 / 0.9, neutral-0 | neutral-6 / 0.86, neutral-5 / 0.86, neutral-0 | 주 행동 버튼(UP-16) |
| `accent-solid` / `-on` / `-soft` | `oklch(0.525 0.135 205)` / neutral-0 / `oklch(0.735 0.13 205 / 0.14)` | `oklch(0.735 0.13 205)` / neutral-10 / `… / 0.17` | 선택, 포커스, 토글, 화면당 확인 행동 하나 |
| `focus-ring` | accent-solid | accent-solid | 포커스 |
| `success-*`, `warning-*`, `danger-*`, `info-*` | Caustic 값(text 465·118, soft 815·105 알파, solid 525·135. warning solid 위 글자는 neutral-10) | Caustic 값(text 815·105, soft 635·142 / 0.2, solid 735·13 계열) | 상태만 뜻한다 |
| `diff-add` / `diff-remove` | Mint / Coral 알파 | 같음 | Goal 이력·초안 수정 차이 |
| `agent-spectrum-1..3` | Lagoon(accent 색상), Mint 158°, Amber 80° | 같음 | 에이전트 표시 전용(UP-15) |
| `agent-glow` | accent 300 / 0.45 | accent 400 / 0.35 | 진행 중 에이전트 카드 그림자 |

강조 색상(hue)은 Caustic 기본 205(Lagoon)다. Caustic이 24개 색상에서 강조 대비를 검사하므로 바꿔도 대비는 유지된다 [원문: `contrast.json` `hueSweep`]. Helm은 205를 쓴다.

**대비 결과** [실험: `.helm-design-work/P14/neutral_contrast.py`·`glass_table.py`, WCAG 2 상대 휘도]

불투명 표면:

| 테마 / 배경 | 본문 | 보조 | 3차 | 비활성 | 컨트롤 경계 |
|---|---|---|---|---|---|
| 라이트 / `surface-base`(n0) | 18.54 | 8.70 | 6.44 | 3.19 | 3.19 |
| 라이트 / `bg-app`(n1) | 17.24 | 8.09 | 5.99 | **2.96** | **2.96** |
| 다크 / `bg-app`(n9) | 18.54 | 11.70 | 5.82 | 3.72 | 3.72 |
| 다크 / `surface-base`(n8) | 16.86 | 10.64 | 5.29 | 3.38 | 3.38 |
| 다크 / `surface-raised`(n7) | 15.08 | 9.52 | 4.73 | 3.02 | 3.02 |

- 기준(Caustic과 같음): 본문 7:1, 보조·3차 4.5:1, 비활성 3:1, 컨트롤 경계 3:1.
- 라이트 `bg-app` 위의 비활성 글자와 컨트롤 경계가 2.96으로 3:1에 못 미친다. 규칙: **입력 컨트롤과 비활성 글자는 `bg-app` 위에 직접 놓지 않고 `surface-base` 위에 놓는다.** 정적 검사로는 잡기 어려워 시각 테스트의 대비 검사(§6.3)로 확인한다.

유리 표면(최악 배경 위 합성): 배경 후보는 두 테마의 창 배경·표면(n0, n1, n8, n9)과 채도 높은 색 15개(색상 25·72·158·205·295 × 명도 0.35·0.525·0.815), 그리고 순수 검정·흰색(창 효과로 바탕화면이 비칠 때의 최악)이다.

각 칸은 "창 배경·채도 높은 색 중 최악 / 순수 검정·흰색 중 최악"이다. 관문은 두 값 중 작은 쪽으로 판정한다.

| 재질 | 본문 | 보조 | 3차(`text-tertiary`) | 유리 위 3차(`text-tertiary-on-glass`) |
|---|---|---|---|---|
| 라이트 크롬 n0 / 0.84 | 13.14 / 12.79 | 6.17 / 6.00 | 4.57 / **4.44** | n6: 6.17 / 6.00 |
| 라이트 오버레이 n0 / 0.90 | 15.03 / 14.79 | 7.06 / 6.94 | 5.22 / 5.14 | n6: 7.06 / 6.94 |
| 다크 크롬 n8 / 0.86 | 11.00 / 10.96 | 6.95 / 6.92 | **3.45 / 3.44** | n2: 6.95 / 6.92 |
| 다크 오버레이 n8 / 0.90 | 12.60 / 12.57 | 7.95 / 7.93 | **3.95 / 3.94** | n2: 7.95 / 7.93 |
| (참고) Caustic regular 라이트 0.66 / 다크 0.62 | 8.39 / 4.78 | 3.94 / 3.02 | 2.92 / 1.50 | — |

- 크롬 재질 알파를 Caustic thick(0.84)으로 잡은 이유: 그 아래 재질(regular 이하)은 보조 글자가 4.5:1에 못 미친다. 크롬에는 보조 글자(위치 경로, 연결 상태)가 늘 있다.
- 3차 글자는 라이트 크롬에서 검정 바탕일 때 4.44, 다크 유리에서 3.44~3.95로 4.5:1에 못 미친다. 규칙: **두 테마 모두 유리 위의 3차 글자는 `text-tertiary-on-glass`를 쓴다.** 값은 라이트 neutral-6, 다크 neutral-2로 보조 글자와 같다. 유리 위에서는 3차와 보조를 글자 크기와 굵기로만 구분한다. 빌드 관문(§3.2.8 `contrastRules`)은 유리 위 3차 쌍을 이 토큰으로 검사한다.
- 상태 색 글자를 유리 위에 둘 때: 경고·위험·정보 글자(`warning-text` 등)는 라이트 크롬 최악 배경에서 4.84~5.04로 통과한다. 성공 글자(`success-text`, mint 700)는 4.42로 못 미치므로 유리 위에서는 점·아이콘(비글자 3:1)으로만 쓰고 글자는 `text-primary`로 쓴다 [실험: `.helm-design-work/P14/status_glass.py`].
- 비활성 글자와 컨트롤 경계는 유리 위에 두지 않는다. 유리 안의 컨트롤은 불투명 `control-raised` 바탕 위에 그린다.
- 창 효과(§3.14.3)로 바탕화면이 비쳐도 위 표의 마지막 열이 하한이다. 크롬 재질이 창 효과 위에 다시 덮이기 때문이다.

Helm 의미 토큰(`packages/ui-tokens/src/helm.css`) [제안]:

```css
:root {
  /* N: 방향(Goal, 선택, 작업 합의, 완료 기준). 실선 경계 */
  --helm-n-border: var(--hm-color-border-control);
  /* E: 이해(관찰, 추측, 판단, 근거). 왼쪽 선의 모양으로 단계 구분 */
  --helm-e-rule: var(--hm-color-border-strong);
  --helm-e-rule-observation: dotted; --helm-e-rule-guess: dashed; --helm-e-rule-finding: solid;
  /* M: 실제 변화. 안쪽 면 + 관찰 시각 */
  --helm-m-surface: var(--hm-color-bg-inset);
  /* 작성자: 에이전트 초안은 정적 스펙트럼 테두리 + "초안" 라벨 (UP-15) */
  --helm-draft-rim: linear-gradient(135deg, var(--hm-agent-spectrum-1), var(--hm-agent-spectrum-2), var(--hm-agent-spectrum-3));
  /* 품질 상태 */
  --helm-contested-fg: var(--hm-color-warning-text); --helm-contested-bg: var(--hm-color-warning-soft);
  --helm-stale-fg: var(--hm-color-warning-text); --helm-superseded-fg: var(--hm-color-text-tertiary);
  /* 질문 */
  --helm-rights-gate-bar: var(--hm-color-accent-solid); --helm-expiry-near-fg: var(--hm-color-warning-text);
  /* 신선도 */
  --helm-fresh-ok: var(--hm-color-success-text); --helm-fresh-stale: var(--hm-color-warning-text);
  --helm-fresh-rebuilding: var(--hm-color-info-text); --helm-fresh-failed: var(--hm-color-danger-text);
  /* 반응(자극 보드). 색과 함께 밑줄 모양으로 구분 */
  --helm-react-pos-bg: var(--hm-color-success-soft); --helm-react-neg-bg: var(--hm-color-danger-soft);
  --helm-react-reasonless-bg: var(--hm-color-info-soft);
  --helm-react-pos-underline: solid; --helm-react-neg-underline: wavy; --helm-react-reasonless-underline: dotted;
  /* 선택된 행: 배경 + 왼쪽 막대 3px (선택 배경만으로는 표면과 대비가 낮아 막대가 필요) */
  --helm-selected-bar: var(--hm-color-accent-solid); --helm-selected-bar-width: 3px;
  --helm-unseen-dot: var(--hm-color-accent-solid);
  /* 고정폭: 한글 글꼴을 더함 */
  --helm-font-mono: "Geist Mono", "SUIT", ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace;
  --helm-text-reading: 400 15px/24px var(--hm-font-ui);
}
```

N/E/M에 고유 색상을 주지 않는다. 상태 색상 4개와 강조 색상, 에이전트 스펙트럼이 이미 쓰이고 있어 세 세계에 색을 더 주면 겹친다. 세 세계는 테두리 모양, 아이콘, 라벨로 구분한다(§3.5.1).

#### 3.2.3 타이포와 한국어 규칙

글꼴 [제안]:

| 역할 | 글꼴 순서 | 파일 | 라이선스 |
|---|---|---|---|
| UI·본문 | `var(--hm-font-ui)` = `"Geist", "SUIT", "Pretendard Variable", "Pretendard", "Noto Sans KR", ui-sans-serif, system-ui, …` [원문: Caustic] | Geist Variable woff2(npm `geist`), SUIT Variable woff2(npm `@sun-typeface/suit` 2.0.5)를 앱에 넣고 `@font-face` 이름을 "Geist", "SUIT"로 등록한다 | Geist SIL OFL 1.1 [지식], SUIT OFL-1.1 [검색: github.com/sun-typeface/SUIT] |
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

Caustic의 `display`, `voice`, `voice-sm`, `thought`는 1차에 쓰지 않는다 [제안]. Caustic 정책 4(에이전트 문장은 serif)는 사람·에이전트 구분에 쓸모가 있으나, 한국어 serif(Noto Serif KR)를 앱에 더 넣어야 하고 Helm은 작성자를 라벨과 스펙트럼 테두리로 이미 구분한다(§3.5.5). 실제 사용 후 다시 본다(U-20). `thought`(기울임 사고 텍스트)는 사고 텍스트를 그리지 않는 규칙(§3.10.2)과 맞지 않아 쓰지 않는다.

한국어 줄바꿈·조판 규칙(`packages/ui-tokens/src/base.css`) [제안]:

```css
:root { font-family: var(--hm-font-ui); font-kerning: normal; }
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
- 한 줄 제목·라벨이 넘치면 말줄임(`text-overflow: ellipsis`)을 쓰되, 전체 문장은 툴팁 컴포넌트와 접근 가능한 이름으로 제공한다(`title` 속성은 쓰지 않는다).
- 말줄임은 한 줄 라벨에만 쓴다. 질문 문장, 반대 근거, 판단 문장은 줄여서 자르지 않는다(UP-6).
- 숫자와 단위는 붙여 쓴다(`3건`, `12분 전`). 상대 시간과 정확한 시각을 함께 둔다(`TimeStamp`, §3.7.2).

#### 3.2.4 간격

복사한 간격 토큰 `--hm-space-*`(Caustic 값, 4px 단위, 0~72px, 반 단계 1·2·3·5·6·7·9·10·14·18·26px) [원문]. Helm 사용 규칙 [제안]:

| 용도 | 기본 밀도 | 촘촘 밀도 |
|---|---|---|
| 카드 안쪽 여백 | 16px (`p-4`) | 12px (`p-3`) |
| 카드 사이 | 12px | 8px |
| 카드 안 항목 사이 | 8px | 6px |
| 절 사이 | 24px | 20px |
| 가운데 패널 좌우 여백 | 24px | 16px |
| 아이콘과 글자 사이 | 6px | 6px |
| 목록 행 높이 | 32px (`--hm-control-md`) | 28px |

#### 3.2.5 반경, 테두리, 그림자, 재질

반경·그림자 값은 Caustic 값을 복사한다 [원문]: 반경 none 0, 2xs 2, xs 4, sm 6, md 8, lg 10, xl 12, 2xl 16, 3xl 22, full 999. 그림자 `elevation-1..5`(짧은 접촉 그림자 + 긴 확산 그림자, 다크는 더 깊게). 동심 반경 규칙(안쪽 반경 = 바깥 반경 − 여백)을 따른다(Caustic 정책 5).

| 대상 | 반경 | 테두리 | 그림자 | 재질 |
|---|---|---|---|---|
| 버튼, 입력칸 | `sm` 6px | 입력칸 `border-control` 1px, 버튼 `control-edge` 0.5~1px | 버튼 `elevation-1` | 불투명 |
| 배지, 칩 | `xs` 4px(상태), `full`(개수) | 없음 또는 1px | 없음 | 불투명 |
| 카드 | `lg` 10px | N 카드 `--helm-n-border` 1px, 나머지 `border-default` 1px | 없음. 끌기 중 `elevation-3` | 불투명 |
| 크롬(창 머리, 레일, 상태 줄, 진행 중 서랍, 입력창 띠) | 창 모서리와 맞춤(동심) | `material-edge` 0.5px + `material-rim` 안쪽 1px | 없음(창에 붙음) | `glass-chrome` |
| 팝오버, 메뉴, 툴팁, 명령 팔레트, 토스트 | `md` 8px(툴팁 `sm`), 팔레트 `xl` | 같음 | `elevation-3`(팔레트 `elevation-4`) | `glass-overlay` |
| 대화상자, 시트 | `xl` 12px | 같음 | `elevation-4` | `glass-overlay`. 내용 영역(입력)은 불투명 판 |

유리 재질 두 개 [제안]:

| 유틸리티 | 채움 | 흐림 | 채도 | 쓰는 곳 |
|---|---|---|---|---|
| `glass-chrome` | `material-chrome`(라이트 n0/0.84, 다크 n8/0.86) | 24px | 1.8 | 크롬 |
| `glass-overlay` | `material-overlay`(n0/0.90, n8/0.90) | 36px | 1.8 | 오버레이 |

```css
/* packages/ui-tokens/src/base.css — Caustic 유리 처방을 옮긴 것 */
@utility glass-chrome { @apply glass; --hm-material: var(--hm-color-material-chrome); --hm-material-blur: 24px; }
@utility glass-overlay { @apply glass; --hm-material: var(--hm-color-material-overlay); --hm-material-blur: 36px; }
@utility glass {
  position: relative; contain: paint;
  background: var(--hm-material);
  -webkit-backdrop-filter: blur(var(--hm-material-blur)) saturate(1.8);
  backdrop-filter: blur(var(--hm-material-blur)) saturate(1.8);
  box-shadow: inset 0 1px 0 var(--hm-color-material-specular), inset 0 0 0 1px var(--hm-color-material-rim),
              0 0 0 0.5px var(--hm-color-material-edge);
}
/* 대체: 흐림을 못 쓰거나, 투명도 줄이기·고대비·강제 색일 때 불투명 */
:root[data-transparency="reduced"] .glass-chrome, :root[data-transparency="reduced"] .glass-overlay { background: var(--hm-color-surface-base); backdrop-filter: none; -webkit-backdrop-filter: none; }
@media (prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active) {
  .glass-chrome, .glass-overlay { background: var(--hm-color-surface-base); backdrop-filter: none; -webkit-backdrop-filter: none; }
}
```

Caustic의 대각선 광택 마스크(`::before`)는 크롬에는 쓰지 않고 오버레이에만 쓴다 [제안]. 크롬은 넓어서 광택이 장식으로 보이고, 큰 면적의 마스크 합성은 비용이 든다.

#### 3.2.6 모션

| 토큰 | 값 [원문: Caustic] | 용도 |
|---|---|---|
| `--hm-duration-instant` | 0ms | 감소 모션 설정일 때 모든 값 |
| `--hm-duration-quick` | 120ms | 호버, 눌림, 체크(ease-out) |
| `--hm-duration-base` | 200ms | 펼침·접힘, 탭 전환, 팝오버 |
| `--hm-duration-gentle` | 320ms | 시트·서랍(인스펙터, 진행 중 서랍) |
| `--hm-duration-agent` | 4800ms | 진행 중 표시의 한 바퀴(§3.14.4) |
| `--hm-ease-standard` / `-out` / `-in` | `cubic-bezier(0.2,0,0,1)` / `(0.2,0.8,0.2,1)` / `(0.4,0,1,1)` | 기본 / 들어옴 / 나감 |
| `--hm-ease-spring` | Caustic `linear(…)` 값 | 위치 이동(토글, 시트, 토스트) |

- 반복 모션은 "에이전트가 지금 일하는 중" 표시 하나만 쓴다(§3.14.4). 스피너 회전, 글자 반짝임(shimmer)은 쓰지 않는다. 진행 중 상태는 글자("확인 중 · 3/7")와 정적 막대가 항상 함께 있다.
- 스트림으로 들어와 바뀐 항목은 깜박이지 않는다. "새로 바뀜" 점(`--helm-unseen-dot`)을 사람이 볼 때까지 둔다.
- `@media (prefers-reduced-motion: reduce)`와 앱 설정 "움직임 줄이기"에서 모든 duration을 0으로 하고 반복을 멈춘다.

#### 3.2.7 크기, z-index, 밀도

- 컨트롤 높이: `--hm-control-*`(Caustic 값, 기본 md 32px), 입력 `--hm-field-md` 40px, 촘촘 밀도에서 한 단계씩 낮아진다(md 28px, field 36px) [원문].
- 아이콘: 12/14/16(기본)/20/24px, 선 두께 1.75 [원문: Caustic 정책]. Helm은 16px를 기본, 배지 안 12px.
- 클릭 대상 최소 24×24px(`--hm-hit-min`). 목록 행은 행 전체가 클릭 대상이다.
- z-index: `--hm-z-*`(Caustic 값, chrome 20, sticky 30, popover 40, dialog 60, toast 80, tooltip 90, palette 100) [원문].
- 밀도: `:root[data-density="regular" | "compact" | "touch"]`. 데스크톱 기본 `regular`, 사용자 설정(20 저장). `touch`는 모바일 클라이언트(26)용이며 컨트롤 최소 높이 44px, 목록 행 48px, 클릭 대상 44×44px로 올린다 [제안, 26과 맞춤].
- 글자 크기 배율: 사용자 설정 `100% | 112.5% | 125%`를 웹뷰 확대(Tauri 창의 zoom)로 처리하고 `:root { font-size }`는 바꾸지 않는다 [제안]. Caustic 토큰이 px 값이라 rem 배율이 적용되지 않기 때문이다. 확대 200%에서도 가로 스크롤 없이 쓸 수 있어야 한다(§3.3.4).

#### 3.2.8 토큰 원본과 생성 [결정 43 / 제안: 구성]

```text
packages/ui-tokens/                 @helm/ui-tokens — React·Tauri를 모름. 데스크톱·모바일이 같이 쓴다(§3.13)
  NOTICE.md                         Caustic 출처(Axiom vendor/caustic, 커밋 8c43d45…, 복사한 날짜), 바꾼 점, 소유자 확인
  src/tokens.ts                     원본: 원시(neutral 11, 색상 램프 5 × 쓰는 단계, 스펙트럼), 의미(라이트·다크), 간격·반경·크기·그림자·모션·z, 재질, 대비 규칙(아래 전체)
  src/helm.css                      Helm 의미 토큰(--helm-*)
  src/base.css                      유리·에이전트 테두리 유틸리티, 한국어 규칙, 타입 역할, 포커스 규칙
  scripts/build.ts                  대비 검사 → dist 생성. 규칙 하나라도 실패하면 종료 코드 1
  dist/tokens.css                   CSS 변수(:root, [data-theme], [data-density], [data-transparency])
  dist/theme.css                    Tailwind 4 @theme
  dist/tokens.{core,light,dark}.json  DTCG(모바일·문서 도구용)
  dist/tokens.js                    TS 상수(SVG 시각화가 CSS 변수 이름을 쓰게)
  dist/contrast.json                대비 보고서(규칙 × 테마, 강조 색상 24개 돌림)
apps/desktop/src/styles/app.css     @import 순서: tailwindcss → @helm/ui-tokens/dist/tokens.css(layer base) → theme.css → helm.css → base.css → fonts.css
```

`src/tokens.ts`는 아래 전체가 원본이다. 값은 Caustic `tokens.mjs`(커밋 `8c43d45…`)를 그대로 옮겼고, Helm이 바꾼 곳은 주석 `// Helm`으로 표시했다. Caustic에서 가져오지 않은 것: Studio 전용 의미 토큰(`bg.canvas`, `canvas.*`, `media.*`, `identity.*`, `chart.*`, `surface.translucent*`, `material.ultrathin|thin|regular`), Studio 배치 수치(`studio`), 부품 기하 중 Helm 부품이 쓰지 않는 것, 타입 역할 중 `display`·`voice*`·`thought`·Studio 전용 역할(§3.2.3), 모션 중 `spin`·`orb`·`shimmer`·`slide`·`scan`·`indeterminate`(§3.14.4).

```ts
// packages/ui-tokens/src/tokens.ts — 원본. dist/는 scripts/build.ts가 이 파일에서만 만든다.
export const meta = { name: 'Helm UI tokens', prefix: 'hm', source: 'Caustic 1.0.0 (axiom vendor/caustic @ 8c43d45)' } as const;

/* 색상 램프: 모든 색상이 같은 명도·채도 단면을 쓴다. Helm은 300~700만 쓴다(§3.2.2 의미 표) */
export const hueProfile = {
  L: { 300: 0.815, 400: 0.735, 500: 0.635, 600: 0.525, 700: 0.465 },
  C: { 300: 0.105, 400: 0.13, 500: 0.142, 600: 0.135, 700: 0.118 },
} as const;
export const hues = {
  accent: { hue: 205, live: true },   // Lagoon. 빌드가 24개 색상으로 돌려 대비를 검사한다
  mint: { hue: 158 }, amber: { hue: 72 }, coral: { hue: 25 }, iris: { hue: 295 },
} as const;

/* Graphite neutral. Helm: 16단계 → 11단계(§3.2.2). 주석은 Caustic 원래 단계 */
export const NEUTRAL_HUE = 260;
export const neutral = {
  0: [0.995, 0.001] /* 0 */,  1: [0.97, 0.003] /* 50 */,  2: [0.845, 0.008] /* 300 */, 3: [0.65, 0.011] /* 400 */,
  4: [0.54, 0.012] /* 500 */, 5: [0.48, 0.012] /* 600 */, 6: [0.41, 0.012] /* 700 */,  7: [0.265, 0.010] /* 850 */,
  8: [0.225, 0.009] /* 900 */, 9: [0.18, 0.008] /* 950 */, 10: [0.14, 0.007] /* 1000 */,
} as const satisfies Record<number, readonly [L: number, C: number]>;

/* 에이전트 스펙트럼: 장식 빛. 글자에 쓰지 않는다(UP-15) */
export const spectrum = [
  { L: 0.80, C: 0.13, hue: 'accent' },   // --hm-agent-spectrum-1
  { L: 0.86, C: 0.15, hue: 158 },        // --hm-agent-spectrum-2
  { L: 0.87, C: 0.14, hue: 80 },         // --hm-agent-spectrum-3
] as const;

/* 의미 색. 값 문법: "<램프>.<단계>" | "<램프>.<단계>/<알파>" | "white/<a>" | "black/<a>" */
export const semantic = {
  light: {
    'bg.app': 'neutral.1', 'bg.inset': 'neutral.9/0.04', 'bg.scrim': 'neutral.9/0.24',
    'surface.base': 'neutral.0', 'surface.raised': 'neutral.0',                      // Helm: 25 → 0, 높이는 elevation-1로
    'material.chrome': 'neutral.0/0.84', 'material.overlay': 'neutral.0/0.90',       // Helm: thick(0.84)과 0.90 두 개만
    'material.rim': 'white/0.62', 'material.edge': 'neutral.9/0.11', 'material.specular': 'white/0.95', 'material.sheen': 'white/0.5',
    'text.primary': 'neutral.9', 'text.secondary': 'neutral.6', 'text.tertiary': 'neutral.5', 'text.tertiary-on-glass': 'neutral.6',
    'text.placeholder': 'neutral.5', 'text.disabled': 'neutral.3', 'text.inverse': 'neutral.0', 'text.link': 'accent.700',
    'border.subtle': 'neutral.9/0.07', 'border.default': 'neutral.9/0.12', 'border.strong': 'neutral.9/0.2', 'border.control': 'neutral.3',
    'fill.hover': 'neutral.9/0.045', 'fill.pressed': 'neutral.9/0.075', 'fill.selected': 'neutral.9/0.11',
    'control.off': 'neutral.3', 'control.thumb': 'neutral.0', 'control.raised': 'neutral.0/0.8', 'control.raised-hover': 'neutral.0/0.94', 'control.edge': 'neutral.9/0.1',
    'ink.solid': 'neutral.8/0.9', 'ink.hover': 'neutral.7/0.9', 'ink.on': 'neutral.0', 'ink.on-muted': 'neutral.0/0.75', 'ink.kbd': 'white/0.09',  // Helm: 800 → 7, 25 → 0
    'accent.solid': 'accent.600', 'accent.hover': 'accent.700', 'accent.on': 'neutral.0', 'accent.text': 'accent.700',
    'accent.soft': 'accent.400/0.14', 'accent.border': 'accent.400/0.5',
    'success.solid': 'mint.600', 'success.on': 'neutral.0', 'success.text': 'mint.700', 'success.soft': 'mint.300/0.22',
    'warning.solid': 'amber.500', 'warning.on': 'neutral.10', 'warning.text': 'amber.700', 'warning.soft': 'amber.300/0.3',
    'danger.solid': 'coral.600', 'danger.on': 'neutral.0', 'danger.text': 'coral.700', 'danger.soft': 'coral.300/0.2',
    'info.solid': 'iris.600', 'info.on': 'neutral.0', 'info.text': 'iris.700', 'info.soft': 'iris.300/0.2',
    'diff.add': 'mint.400/0.18', 'diff.remove': 'coral.400/0.16', 'focus.ring': 'accent.600', 'agent.glow': 'accent.300/0.45',
  },
  dark: {
    'bg.app': 'neutral.9', 'bg.inset': 'black/0.22', 'bg.scrim': 'black/0.5',
    'surface.base': 'neutral.8', 'surface.raised': 'neutral.7',
    'material.chrome': 'neutral.8/0.86', 'material.overlay': 'neutral.8/0.90',       // Helm: Caustic thick 0.84 → 0.86
    'material.rim': 'white/0.09', 'material.edge': 'black/0.55', 'material.specular': 'white/0.17', 'material.sheen': 'white/0.1',
    'text.primary': 'neutral.0', 'text.secondary': 'neutral.2', 'text.tertiary': 'neutral.3', 'text.tertiary-on-glass': 'neutral.2',
    'text.placeholder': 'neutral.3', 'text.disabled': 'neutral.4', 'text.inverse': 'neutral.9', 'text.link': 'accent.300',
    'border.subtle': 'white/0.06', 'border.default': 'white/0.1', 'border.strong': 'white/0.17', 'border.control': 'neutral.4',
    'fill.hover': 'white/0.05', 'fill.pressed': 'white/0.08', 'fill.selected': 'white/0.12',
    'control.off': 'neutral.4', 'control.thumb': 'neutral.0', 'control.raised': 'neutral.7/0.76', 'control.raised-hover': 'neutral.7/0.82', 'control.edge': 'white/0.08',  // Helm: 800 → 7
    'ink.solid': 'neutral.6/0.86', 'ink.hover': 'neutral.5/0.86', 'ink.on': 'neutral.0', 'ink.on-muted': 'neutral.0/0.75', 'ink.kbd': 'white/0.09',
    'accent.solid': 'accent.400', 'accent.hover': 'accent.300', 'accent.on': 'neutral.10', 'accent.text': 'accent.300',
    'accent.soft': 'accent.400/0.17', 'accent.border': 'accent.400/0.45',
    'success.solid': 'mint.400', 'success.on': 'neutral.10', 'success.text': 'mint.300', 'success.soft': 'mint.500/0.2',
    'warning.solid': 'amber.400', 'warning.on': 'neutral.10', 'warning.text': 'amber.300', 'warning.soft': 'amber.500/0.2',
    'danger.solid': 'coral.400', 'danger.on': 'neutral.10', 'danger.text': 'coral.300', 'danger.soft': 'coral.500/0.2',
    'info.solid': 'iris.400', 'info.on': 'neutral.10', 'info.text': 'iris.300', 'info.soft': 'iris.500/0.2',
    'diff.add': 'mint.500/0.18', 'diff.remove': 'coral.500/0.18', 'focus.ring': 'accent.400', 'agent.glow': 'accent.400/0.35',
  },
} as const;

/* 크기 */
export const space = { 0: 0, 0.25: 1, 0.5: 2, 0.75: 3, 1: 4, 1.25: 5, 1.5: 6, 1.75: 7, 2: 8, 2.25: 9, 2.5: 10, 3: 12, 3.5: 14, 4: 16, 4.5: 18, 5: 20, 6: 24, 6.5: 26, 7: 28, 8: 32, 10: 40, 12: 48, 16: 64, 18: 72 } as const;
export const radius = { none: 0, '2xs': 2, xs: 4, sm: 6, md: 8, lg: 10, xl: 12, '2xl': 16, '3xl': 22, full: 999 } as const;
export const size = {
  control: { '2xs': 20, xs: 24, sm: 28, md: 32, lg: 40, xl: 48 },
  'control-compact': { '2xs': 18, xs: 22, sm: 24, md: 28, lg: 36, xl: 44 },
  'control-touch': { md: 44, row: 48 },                                              // Helm: 모바일 밀도(§3.2.7)
  field: { sm: 36, md: 40, lg: 44 }, 'field-compact': { sm: 32, md: 36, lg: 40 },
  icon: { xs: 12, sm: 14, md: 16, lg: 20, xl: 24 },
  component: {                                                                       // Helm 부품이 쓰는 것만
    check: 18, 'radio-dot': 7, 'kbd-h': 18, 'progress-h': 6, 'chip-h': 26, 'tab-h': 34, 'menu-item': 30, 'menu-min': 220,
    'switch-md-w': 46, 'switch-md-h': 28, 'switch-md-thumb': 24, 'switch-md-travel': 18,
    'popover-sm': 240, 'popover-md': 280, 'dialog-sm': 320, 'dialog-md': 480, 'dialog-lg': 640, 'sheet-md': 380,
    'toast-w': 360, 'textarea-min': 92, 'reading-max': 720, 'activity-dot': 12, 'selected-bar': 3,   // 마지막 셋은 Helm
  },
  'hit-min': 24, 'hit-min-touch': 44, 'field-font-touch': 16,                       // Helm: iOS 입력 확대 방지(§3.13)
} as const;
export const font = {
  ui: '"Geist", "SUIT", "Pretendard Variable", "Pretendard", "Noto Sans KR", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"Geist Mono", "SUIT", ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace',   // Helm: SUIT 더함
} as const;
// [글꼴, 크기, 줄 높이, 무게, 자간(em)]. 한국어 자간 보정은 base.css(§3.2.3)
export const type = {
  'title-1': ['ui', 26, 32, 600, -0.022], 'title-2': ['ui', 20, 26, 600, -0.016], 'title-3': ['ui', 15, 20, 600, -0.01],
  'title-4': ['ui', 13.5, 20, 600, -0.01], 'helm-reading': ['ui', 15, 24, 400, 0],   // Helm 추가
  body: ['ui', 14, 21, 400, -0.003], ui: ['ui', 13, 18, 400, -0.003], 'ui-strong': ['ui', 13, 18, 500, -0.003],
  'ui-sm': ['ui', 12, 18, 500, 0], footnote: ['ui', 12, 16, 400, 0], label: ['ui', 11.5, 14, 500, 0], caption: ['ui', 11, 14, 500, 0],
  mono: ['mono', 12, 18, 400, 0], 'mono-sm': ['mono', 11, 16, 500, 0],
} as const;
export const elevation = {
  light: {
    1: '0 1px 2px oklch(0.2 0.02 260 / 0.06)',
    2: '0 1px 2px oklch(0.2 0.02 260 / 0.05), 0 4px 12px -2px oklch(0.2 0.02 260 / 0.08)',
    3: '0 2px 4px oklch(0.2 0.02 260 / 0.04), 0 12px 28px -6px oklch(0.2 0.02 260 / 0.12)',
    4: '0 4px 8px oklch(0.2 0.02 260 / 0.05), 0 24px 48px -12px oklch(0.2 0.02 260 / 0.18)',
    5: '0 8px 16px oklch(0.2 0.02 260 / 0.06), 0 40px 80px -16px oklch(0.2 0.02 260 / 0.28)',
    agent: '0 8px 30px -12px var(--hm-color-agent-glow)',
  },
  dark: {
    1: '0 1px 2px oklch(0 0 0 / 0.3)',
    2: '0 1px 2px oklch(0 0 0 / 0.3), 0 4px 12px -2px oklch(0 0 0 / 0.35)',
    3: '0 2px 4px oklch(0 0 0 / 0.25), 0 12px 28px -6px oklch(0 0 0 / 0.45)',
    4: '0 4px 8px oklch(0 0 0 / 0.25), 0 24px 48px -12px oklch(0 0 0 / 0.55)',
    5: '0 8px 16px oklch(0 0 0 / 0.3), 0 40px 80px -16px oklch(0 0 0 / 0.65)',
    agent: '0 8px 30px -12px var(--hm-color-agent-glow)',
  },
} as const;
export const blur = { chrome: 24, overlay: 36 } as const;                         // Helm: 두 재질만(§3.2.5)
export const saturate = 1.8;
export const motion = {
  duration: { instant: 0, quick: 120, base: 200, gentle: 320, agent: 4800 },
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)', out: 'cubic-bezier(0.2, 0.8, 0.2, 1)', in: 'cubic-bezier(0.4, 0, 1, 1)', linear: 'linear',
    spring: 'linear(0, 0.009, 0.035 2.1%, 0.141, 0.281 6.7%, 0.723 12.9%, 0.938 16.7%, 1.017, 1.077, 1.121, 1.149 24.3%, 1.159, 1.163, 1.161, 1.154 29.9%, 1.129 32.8%, 1.051 39.6%, 1.017 43.1%, 0.991, 0.977 51%, 0.974 53.8%, 0.975 57.1%, 0.997 69.8%, 1.003 76.9%, 1)',
  },
} as const;
export const opacity = { disabled: 0.42, muted: 0.64 } as const;
export const z = { chrome: 20, sticky: 30, popover: 40, dialog: 60, toast: 80, tooltip: 90, palette: 100 } as const;

/* 대비 규칙. 빌드는 모든 테마 × 강조 색상 24개로 돈다. 하나라도 실패하면 종료 코드 1 */
export type ContrastRule =
  | { id: string; fg: string; bg: string; min: number; note: string }            // bg는 "<알파 토큰>@<바탕 토큰>" 합성 가능
  | { id: string; fg: string; glass: 'material.chrome' | 'material.overlay'; over: 'worst'; min: number; note: string };
const opaque = ['surface.base', 'surface.raised', 'bg.app'] as const;
export const contrastRules: ContrastRule[] = [
  ...opaque.map((bg) => ({ id: `body@${bg}`, fg: 'text.primary', bg, min: 7, note: '본문' })),
  ...opaque.map((bg) => ({ id: `secondary@${bg}`, fg: 'text.secondary', bg, min: 4.5, note: '보조' })),
  ...opaque.map((bg) => ({ id: `tertiary@${bg}`, fg: 'text.tertiary', bg, min: 4.5, note: '3차' })),
  { id: 'placeholder', fg: 'text.placeholder', bg: 'surface.base', min: 4.5, note: '입력 안내' },
  { id: 'disabled', fg: 'text.disabled', bg: 'surface.base', min: 3, note: '비활성. bg.app 위에는 두지 않는다(§3.2.2)' },
  { id: 'control-border', fg: 'border.control', bg: 'surface.base', min: 3, note: '입력칸·체크 경계(WCAG 1.4.11)' },
  { id: 'control-off', fg: 'control.off', bg: 'surface.base', min: 3, note: '꺼진 스위치' },
  { id: 'focus', fg: 'focus.ring', bg: 'surface.base', min: 3, note: '포커스(2.4.11)' },
  { id: 'link', fg: 'text.link', bg: 'surface.base', min: 4.5, note: '링크·근거 참조' },
  { id: 'selected-row', fg: 'text.primary', bg: 'fill.selected@surface.base', min: 7, note: '선택된 행' },
  { id: 'ink', fg: 'ink.on', bg: 'ink.solid', min: 7, note: '주 버튼' },
  { id: 'ink-hover', fg: 'ink.on', bg: 'ink.hover', min: 4.5, note: '주 버튼 호버' },
  { id: 'raised', fg: 'text.primary', bg: 'control.raised', min: 7, note: '보조 버튼' },
  { id: 'accent', fg: 'accent.on', bg: 'accent.solid', min: 4.5, note: '확인 행동 버튼' },
  { id: 'accent-text', fg: 'accent.text', bg: 'surface.base', min: 4.5, note: '강조 글자' },
  ...(['success', 'warning', 'danger', 'info'] as const).map((s) => ({ id: `${s}-badge`, fg: `${s}.text`, bg: `${s}.soft@surface.base`, min: 4.5, note: '상태 배지' })),
  ...(['success', 'warning', 'danger', 'info'] as const).map((s) => ({ id: `${s}-text`, fg: `${s}.text`, bg: 'surface.base', min: 4.5, note: '상태 글자(낡음·신선도·연결)' })),
  { id: 'danger-button', fg: 'danger.on', bg: 'danger.solid', min: 4.5, note: '위험 행동 버튼' },
  { id: 'diff-add', fg: 'text.primary', bg: 'diff.add@surface.base', min: 7, note: 'Goal·초안 차이' },
  { id: 'diff-remove', fg: 'text.primary', bg: 'diff.remove@surface.base', min: 7, note: 'Goal·초안 차이' },
  ...(['material.chrome', 'material.overlay'] as const).flatMap((glass) => [
    { id: `glass-body@${glass}`, fg: 'text.primary', glass, over: 'worst' as const, min: 7, note: '유리 위 본문' },
    { id: `glass-secondary@${glass}`, fg: 'text.secondary', glass, over: 'worst' as const, min: 4.5, note: '유리 위 보조' },
    { id: `glass-tertiary@${glass}`, fg: 'text.tertiary-on-glass', glass, over: 'worst' as const, min: 4.5, note: '유리 위 3차' },
    ...(['warning', 'danger', 'info'] as const).map((t) => ({ id: `glass-${t}@${glass}`, fg: `${t}.text`, glass, over: 'worst' as const, min: 4.5, note: '크롬의 연결·신선도 글자' })),
    { id: `glass-success-dot@${glass}`, fg: 'success.text', glass, over: 'worst' as const, min: 3, note: '성공 색은 유리 위에서 점(비글자)만' },
  ]),
];
/* 유리 최악 배경 후보: neutral 0·1·8·9, 색상 25·72·158·205·295 × (L 0.35 C 0.12, L 0.525 C 0.135, L 0.815 C 0.105), 순수 검정·흰색 */
export const glassBackdrops = { neutral: [0, 1, 8, 9], hues: [25, 72, 158, 205, 295], lc: [[0.35, 0.12], [0.525, 0.135], [0.815, 0.105]], pure: ['black', 'white'] } as const;
```

`agent-rim` 유틸리티(`base.css`):

```css
/* 정적 스펙트럼 테두리. 1.5px 테두리 자리에 그라데이션을 그리고 안쪽은 원래 표면을 둔다 */
@utility agent-rim {
  border: 1.5px solid transparent;
  background: linear-gradient(var(--hm-color-surface-base), var(--hm-color-surface-base)) padding-box,
              var(--helm-draft-rim) border-box;
}
@media (forced-colors: active) { .agent-rim { border-color: CanvasText; background: Canvas; } }
:root[data-transparency="reduced"] .agent-rim { background: var(--hm-color-surface-base); border-color: var(--hm-color-border-strong); }
```

**상태 → 토큰 대응** [제안]. 부품은 아래 표의 토큰만 쓴다. 색은 언제나 글자·아이콘·모양과 함께 쓴다(UP-4).

| 상태(값의 출처) | 글자 | 바탕·테두리 | 모양·아이콘 |
|---|---|---|---|
| 품질 `contested`(04 `QualityBadge`) | `--helm-contested-fg` | `--helm-contested-bg` | `CircleMinus` + "이의 걸림" |
| 품질 `stale` | `--helm-stale-fg` | 없음 | `History` + "낡음" + 이유 |
| 품질 `superseded` | `--helm-superseded-fg` | 없음 | "대체됨" + 새 레코드 링크 |
| 품질 `insufficient` | `text-secondary` | `border-default` 점선 | `CircleDashed` + "근거 부족" |
| 신선도 `current`·`refreshing` | `--helm-fresh-ok`(점만) | 없음 | 점 + 시각 |
| 신선도 `stale` | `--helm-fresh-stale` | 없음 | 점 + "기준 시점" 글자 |
| 신선도 `rebuilding` | `--helm-fresh-rebuilding` | 없음 | `RefreshCw`(회전 금지) + "다시 만드는 중" |
| 신선도 `failed` | `--helm-fresh-failed` | 없음 | `CircleX` + [다시 불러오기] |
| 연결 `connected` | `text-tertiary`(크롬에서는 `text-tertiary-on-glass`) | 없음 | `Wifi` |
| 연결 `slow`·`reconnecting`·`syncing`·`restarted`·`draining` | `warning-text` | 없음 | 점 + 글자 |
| 연결 `serverPcUnreachable`·`daemonUnreachable`·`authFailed`·`keychainDenied`·`sshFailed`·`wrongServer`·`versionMismatch` | `danger-text` | `DegradedBanner`: `danger-soft` | `WifiOff` + 사유 문장 + 행동 버튼 |
| 연결 `readOnly`·`safeMode` | `warning-text` | `DegradedBanner`: `warning-soft` | "읽기 전용"·"안전 모드" 글자 |
| 연결 `viewStale` | `--helm-fresh-stale` | 없음 | 점 + "기준 시점" 글자 |
| 질문 권리 게이트 | `text-primary` | 왼쪽 막대 `--helm-rights-gate-bar` | 글자 "권리 확인" |
| 질문 만료 임박 | `--helm-expiry-near-fg` | 없음 | `Timer` + 남은 시간 |
| 행동 `sending` | `ink-on` | `ink-solid` | 글자 "보내는 중", 버튼 잠금 |
| 행동 거부(`stale_rejected` 등) | `danger-text` | `danger-soft` | 카드 안 문장 + 다음 행동 |
| 선택된 행 | `text-primary` | `fill-selected` + `--helm-selected-bar` | 왼쪽 막대 3px |
| 새로 바뀜 | — | — | `--helm-unseen-dot` 점(움직이지 않음) |
| 에이전트 초안 | `text-primary` | `agent-rim` | "초안" 라벨 + 역할 |
| 진행 중 에이전트 | `text-secondary` | `elevation.agent`(`agent-glow`) | `AgentActivityIndicator` 12px + 글자 |
| 반응 좋음·싫음·이유 없음 | `text-primary` | `--helm-react-*-bg` | 밑줄 실선·물결·점선 |
| 상태 라벨 `blocked` | `warning-text` | 없음 | `TriangleAlert` |
| 위험 행동 버튼 | `danger-on` | `danger-solid` | 대상과 효과를 쓴 버튼 글자 |

위 표의 글자·바탕 쌍은 모두 `contrastRules`에 있다(표에 줄을 더하면 규칙도 더한다). 빌드 관문은 `contrastRules`의 `id`로 결과를 보고하고(`dist/contrast.json`), §6.3의 TK-09가 이 보고를 읽는다.

- 빌드는 Node 24 + TypeScript 6(판정 44)로 돈다. 생성물(`dist/`)은 저장소에 넣고(모바일·문서 도구가 빌드 없이 읽게) 손으로 고치지 않는다. `just ui-check`가 원본과 생성물이 맞는지 검사한다.
- Caustic의 생성기(`build.mjs`)는 복사하지 않고 같은 일을 하는 Helm 스크립트를 새로 쓴다. Caustic 생성기는 Studio 전용 출력(studio·canvas 토큰)과 묶여 있다 [원문].

#### 3.2.9 테마, 투명도, 고대비

- 테마: `:root[data-theme="light" | "dark"]`, 속성이 없으면 `prefers-color-scheme`(Caustic 방식) [원문]. 설정 `system | light | dark`, 기본 `system`. 저장은 20. 창 제목 표시줄과 창 효과의 밝기도 맞춘다(20).
- 투명도: `:root[data-transparency="full" | "reduced"]`. 설정 `system | full | reduced`, 기본 `system`. `system`일 때 Windows는 `prefers-reduced-transparency`(Chromium 118+), macOS는 WKWebView가 이 미디어 쿼리를 지원하지 않으므로 [검색: MDN BCD] Rust가 OS의 "투명도 줄이기" 설정을 읽어 웹뷰에 넘긴다(20에 요구). `reduced`이면 유리를 불투명 표면으로, 창 효과도 끈다.
- 고대비: `prefers-contrast: more`에서 유리를 불투명으로, `border-default`·`border-subtle`을 `border-control`로 올린다.
- Windows 강제 색(`forced-colors: active`): 유리·그림자·스펙트럼 테두리를 끄고, 포커스 링을 `outline: 2px solid CanvasText`로. 배경으로 의미를 나타내는 표시(선택된 행, 반응 하이라이트)는 테두리·밑줄·글자 표시가 함께 있어 남는다(UP-4).

### 3.3 레이아웃 그리드와 앱 셸

#### 3.3.1 셸 구성 [제안: 부품 / 03: 영역과 배치]

셸 영역의 이름과 배치는 03 §3.4.1(`RGN-*`)이 정한다. 이 문서는 영역마다 쓰는 부품과 시각 규칙을 정한다. 원천의 3단 셸(helm-canon-3 §6.5.1)을 03이 1인 데스크톱 앱에 맞게 줄인 것이다.

| 영역(03 §3.4.1) | 내용 | 부품 |
|---|---|---|
| `RGN-TOPBAR` | 앱 이름, 위치 경로, 명령 팔레트 입력, 연결 상태, 기준 시점 | `WindowHeader`, `ConnectionIndicator`, `FreshnessIndicator`, `PendingQuestionsIndicator` |
| `RGN-RAIL` | 최상위 내비게이션(MVP 여섯 항목, 2단계 일곱, 03 §3.5.2)과 사람 행동이 필요한 개수, "에이전트가 정한 것"은 새 항목이 있을 때 점(숫자 없음), 조건부 "복구" | `NavRail` |
| `RGN-BANNER` | 즉시 전달 질문, 연결 끊김, 복구 필요, 버전 불일치. 한 번에 하나, 나머지는 개수로 접음 | `Banner`, `DegradedBanner` |
| `RGN-STATUSLINE` | Concern 범위에서 Goal · Concern · 모드 · 지금 하는 일 · 맡긴 범위 · 다음 멈춤(helm-canon-2 §3.5 상태 표시줄) | `ScopeBar` |
| `RGN-MAIN` | 현재 화면 | 화면별(§3.11) |
| `RGN-INSPECTOR` | 선택한 객체의 출처, 근거, 작성자, 기준 시점, 관련 선택, 이의 기록. 기본으로 닫혀 있고 객체를 고르면 열린다 | `Inspector`, `EvidenceInspector` |
| `RGN-COMPOSER` | 현재 범위에 묶인 자연어 입력과 의미 미리보기. 범위를 입력창 앞에 항상 표시 | `ScopedComposer`, `SemanticPreview` |
| `RGN-RUNS` | 진행 중 서랍: 진행 중인 WorkUnit을 Goal ▸ Concern 트리로 묶고(03 §3.4.1), WorkUnit마다 지금 하는 일, 다음 확인 시점, 마지막 의미 있는 변화, 예외. run 평면 목록과 토큰 스트림 없음 | `ActiveRunDrawer` |

부품과 데이터 연결(저장소 → VM)은 20의 `apps/desktop/src/shell/`이 하고, 이 문서의 셸 부품은 표현만 한다(20 §3.9.1). 크롬 영역(`RGN-TOPBAR`, `RGN-RAIL`, `RGN-STATUSLINE`, `RGN-RUNS`, `RGN-COMPOSER`의 띠)은 `glass-chrome`, `RGN-MAIN`의 본문과 `RGN-INSPECTOR`의 내용은 불투명 표면이다(UP-14). 인스펙터를 서랍으로 띄울 때는 서랍 틀이 `glass-overlay`, 안의 내용 판은 불투명이다.

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
- 화면 머리(제목 + 화면 수준 행동)는 스크롤해도 위에 고정(`--hm-z-sticky`).

#### 3.3.4 확대와 작은 창

- 웹뷰 확대 200%에서 1280px 창은 CSS 너비 640px가 되어 760px 하한보다 좁다. 이때도 깨지지 않도록 760px 미만 CSS 너비에서는 레일 아이콘, 인스펙터 전체 너비 시트, 가운데 1열로 바꾸고 가로 스크롤은 표 안에서만 허용한다(WCAG 1.4.10 리플로우 [지식]). 창 최소 크기는 물리 크기 기준이라 확대와 별개다
- 그래서 §3.3.2의 기준은 CSS 너비(`window.innerWidth`)로 판정한다. 창의 물리 너비는 쓰지 않는다. 컨테이너 쿼리(`@container`)를 쓰면 패널 안 배치를 패널 너비로 바꿀 수 있다. 지원 범위는 §2.5.7의 웹뷰 기준에 따른다.

### 3.4 아이콘 [제안]

lucide-react를 쓴다(§2.5.4). 선 두께 1.75, 기본 16px. 아이콘은 혼자 의미를 지지 않는다. 글자 라벨과 함께 쓰거나, 아이콘만 있는 버튼에는 접근 가능한 이름과 툴팁을 둔다.

Helm 의미 아이콘 표(이름은 lucide 아이콘 이름. 표의 모든 아이콘이 `lucide-react` 1.55.0 패키지에 있음을 확인했다 [원문: npm 패키지 파일, 2026-10-12]. 구현에서는 타입 검사로 다시 확인한다):

| 의미 | 아이콘 | 의미 | 아이콘 |
|---|---|---|---|
| Goal | `Target` | Concern | `Focus` |
| 관찰 | `Eye` | 해석 | `Lightbulb` |
| 가능성 | `Split` | 판단 | `Scale` |
| 선택 | `Signpost` | 질문 | `CircleHelp` |
| 전제(가정) | `Pin` | 아직 모르는 점 | `CircleDashed` |
| 작업 합의 | `Handshake` | 결과 제출 | `PackageCheck` |
| 결과 확인 | `BadgeCheck` | 반영 항목 | `Layers` |
| 근거(지지) | `CirclePlus` | 반대 근거 | `CircleMinus` |
| 한정 | `Brackets` | 무효화 | `Ban` |
| 자극 | `Shapes` | 이유 없는 반응 | `Asterisk` |
| 파일 변경 | `FileDiff` | 실행·도구 | `Terminal` |
| 외부 상태·응답 | `Globe` | 권한 레이어 출처 | `ShieldCheck` |
| 최신 | `CircleCheck` | 낡음 | `History` |
| 다시 받는 중 | `RefreshCw`(회전 금지) | 실패 | `CircleX` |
| 연결됨 | `Wifi` | 끊김 | `WifiOff` |
| 사람 | `User` | 에이전트(역할 공통) | `Cpu` |
| 권고만(강제 안 됨) | `ShieldAlert` | 격리 없음(S0) | `ShieldOff` |
| 런타임·커널 | `Cog` | 스케줄러·만료점 | `Timer` |

루프는 아이콘 대신 이름 칩(`LoopChip`, 03 §3.3.7 라벨)으로 쓴다. 아이콘으로는 다섯 루프와 변형(원함 탐구, 탐침 등)을 구분하기 어렵다.

### 3.5 Helm 시각 문법

#### 3.5.1 N / E / M [제안]

| 세계 | 묻는 것 | 모양 | 아이콘 | 라벨(05가 확정) |
|---|---|---|---|---|
| N 방향 | 무엇을 하기로 했고 누가 받아들였나 | 카드 전체 실선 테두리 1px(`--helm-n-border`), 받아들여진 것은 제목 앞에 `BadgeCheck` | 레코드 종류 아이콘 | "방향" |
| E 이해 | 무엇을 알고 무엇을 의심하나 | 테두리 없이 왼쪽 선 2px. 관찰 점선, 추측 파선, 판단 실선 | 레코드 종류 아이콘 | "이해" |
| M 실제 변화 | 실제로 무엇이 바뀌었나 | 안쪽 면(`--helm-m-surface`), 첫 줄에 관찰 시각과 출처(파일@해시, 실행 id) | `FileDiff`, `Terminal`, `Globe` | "실제 변화" |

- 세 세계를 다른 탭으로 완전히 나누지 않는다. Concern 화면은 한 목록 안에서 세 세계의 레코드를 관계로 잇는다(helm-canon §17.2 "하나의 초점 안에서 연결").
- "방향/이해/실제 변화" 라벨은 사용자에게 보이는 라벨이다(helm-canon §17.2). N/E/M 기호는 감사 깊이에서만 보조로 쓴다.

#### 3.5.2 레코드 종류 표시 [제안]

`KindLabel`이 그린다. 라벨은 글자 + 아이콘. `kind` 값과 평면은 08 §3.20.1 레코드 종류 표가 정본이고, 화면 라벨은 03 §3.2.3·05 §3.10.8이 정한다(아래 라벨 열은 그 표를 옮긴 것이며 05 문구 키로 그린다). 대화 영역 라벨 7종(helm-canon-2 §3.5)과의 대응도 적는다.

| `kind`(08) | 화면 라벨 | 평면(08) | 원천 대화 라벨 |
|---|---|---|---|
| `observation` | 관찰 | E | Observed |
| `interpretation` | 해석(추측) | E | Possible |
| `possibility` | 가능성(추측) | E | Possible |
| `check` | 구분 확인 | E | — |
| `finding` | 판단 | E | — |
| `assumption` | 전제 | E | — |
| `open_question` | 아직 모르는 점 | E | — |
| `question` | 질문 | N/E | Choice |
| `choice` | 선택 | N | Choice |
| `objection` | 이의 | E | — |
| `agreement` | 작업 합의 | N | Working(합의 반향) |
| `result` | 결과 제출 | E | Review |
| `attestation` | 검증 기록 | E | Review |
| `acceptance` | 결과 확인 | N | Review |
| `integration` | 전체 반영 | N | Review |
| `obligation` | 반영 항목 | N | Review |
| `goal`, `concern`, `structure_change`, `boundary_item` | Goal, Concern, 구조 변경, 경계 항목 | N | — |
| `preference_model` | 선호 모델 | N | — |
| `prediction` | 예측 | E | — |
| `expectation` | 기대(응답 기다림) | N | — |
| `loop_plan`, `loop_transition`, `situation_assessment`, `mode_assignment` | 루프 계획, 루프 전환, 상황 판정, 모드 지정 | N, E, E, N | Working |
| `probe`, `watch` | 탐침, 지켜보기 | N | Working |
| `inquiry`, `lens` | 탐구, 렌즈 | E | — |
| `stimulus` | 자극 | E | — |
| `workunit`, `run`, `toolcall`, `thread` | 진행 작업, 실행, 실행 기록, 대화 | M(실행) | Source |
| `grant`, `policy_proposal`, `procedure`, `device` 등 P·A 평면 | 맡겨 둔 권한(J-116), 관찰 제안, 절차, 기기 | P, A | — |
| 에이전트 설명 문장 | 설명 | — | Helm |

- 완료 기준은 작업 합의의 필드이고(08) 레코드 종류 목록에 없다. 그리는 부품은 `ResultCriterionRow`다.
- 평면 열은 테두리 모양(§3.5.1)을 고르는 데 쓴다. P·A 평면 레코드는 세 세계 테두리를 쓰지 않고 설정 화면 모양으로 그린다.
- "판단"은 Finding만 가리킨다(브리프 §6). 승격 전 해석·가능성은 "추측"으로 묶어 부르되 라벨은 둘을 구분한다(불변조건 2).
- 대화 스레드 안의 에이전트 문장은 "설명"으로 표시하고 레코드로 다루지 않는다. 문장 안에서 레코드를 언급하면 레코드 칩으로 링크한다.

#### 3.5.3 품질 배지 [03 §3.3.6 값 / 제안: 표시 방식]

배지 값과 라벨은 03 §3.3.6, 뷰 모델의 값은 04 §3.0.2 `QualityBadge`(`insufficient | contested | stale | superseded`)다. `QualityBadge` 부품이 그린다. 단계 라벨(관찰·해석·가능성·판단)과 품질 배지는 다른 칸에 그린다(03 §3.3.6).

| 값 | 라벨(03) | 표시 방식 |
|---|---|---|
| `insufficient` | 근거 부족 | 추측 단계에만 붙는다. 회색 배지 + 한 줄 문장 |
| (`qualified`, `accepted`) | 배지 없음 | 판단으로 보인다 |
| `contested` | 이의 걸림 | 모든 깊이에서 보인다. 배지 + 한 줄("이의: …"). 접지 않는다 |
| `stale` | 낡음 | 모든 깊이에서 보인다. 배지 + 이유(`staleBecause`, 예 "근거 파일이 바뀜"(해시는 감사 깊이에서)) |
| `superseded` | 대체됨 | 대체한 레코드 링크. 본문은 흐리게 하지 않고 라벨로만 표시 |

- 배지만 있고 이유가 없는 `contested`·`stale`은 그리지 않는다. 이유가 비어 오면 "이유 없음(데이터 이상)"으로 쓰고 감사 깊이 링크를 둔다.
- 원천의 배지 중 `inferred`(추론됨), `policy-approved`(규칙으로 허용됨), `agent-generated`·`human-authored`·`policy-derived`(helm-canon-3 §6.9.1)는 작성자 표시(§3.5.5)로 그린다. `inferred`는 "에이전트 추론"으로, `policy-approved`는 "규칙에 따라"로 옮긴다.
- 같은 모델·같은 컨텍스트 계열 근거(`StatementView.correlatedWith`, 04 §3.0.2)에는 "같은 출처 계열" 표시를 붙인다(03 §3.3.6, canon §8.9 원칙 7).

#### 3.5.4 상태 라벨 집합 [03 §3.3 값]

상태 라벨의 값과 문구는 03 §3.3이 정본이다(진행 작업 §3.3.2, Concern §3.3.3, 선택 §3.3.4, 질문 §3.3.5, 루프·상황 유형 §3.3.7). 컴포넌트는 상태 값을 받아 `@helm/ui-language`의 라벨 키(03 표를 옮긴 것)로 그린다(J-103). 같은 상태를 화면마다 다른 말로 쓰지 않는다(helm-canon §17.2 원칙 5).

`StatusLabel`의 집합(`set`): `work`(03 §3.3.2, `interrupted` 포함), `concern`(§3.3.3), `choice`(§3.3.4), `question`(§3.3.5), `loop`(§3.3.7), `situation`(§3.3.7). product-language의 choice 상태 7종은 화면에서 쓰지 않는다(03 §3.3.1).

- "완료"는 `integrated`이고 반영 항목이 모두 처리·이관된 경우에만 단독으로 쓴다(03 §3.3.2). 그 전에는 `WholeUpdateBadge`가 "결과 확인됨 · 반영 n개 남음" 또는 "결과 확인됨 · 반영 미룸 n개"로 그린다(helm-canon-2 §3.12).
- 상태 라벨은 글자 + 모양(점·테두리)으로 그린다. 색은 보조다. 예: `blocked`(막힘)는 경고 색 글자와 `TriangleAlert` 아이콘, `interrupted`(중단됨(재시작))는 복구 화면 링크를 함께 둔다.

#### 3.5.5 작성자와 행위자 표시 [제안]

| 작성자 | 표시 | 컴포넌트 |
|---|---|---|
| 사람(소유자) | 기본값이라 따로 표시하지 않는다. 검토 깊이에서 "내가 정함" | `AuthorshipMark` |
| 에이전트 제안·초안 | 정적 스펙트럼 테두리(`agent-rim`, `--helm-draft-rim`, 움직이지 않음) + "초안" 또는 "에이전트 제안" + 역할(`작업`, `검증`, `중재`, `관찰`). 사람이 고친 칸은 테두리가 사라지고 "내가 고침" | `DraftMark`, `ActorLabel` |
| 에이전트가 정함(혼자 정한 결정) | "에이전트가 정함" + 묻지 않은 이유 한 줄 + 이의 행동 | `AutonomousChoiceItem` |
| 규칙(정책) | "규칙에 따라" + 규칙 이름 링크 | `AuthorshipMark` |
| 에이전트 추론(원천 `inferred`) | "에이전트 추론" + 역할. 기준 후보, 상황 판정처럼 모델이 추론한 값 | `AuthorshipMark` |
| 런타임·도구 | "실행 결과" + 도구 이름 | `SourceTrace` |
| 외부 | "외부 응답" + 출처 이름 | `SourceTrace` |

- "에이전트가 결정했습니다" 같은 문장을 쓰지 않는다. 혼자 정한 결정은 "맡긴 범위 안에서 에이전트가 정함", 추천은 "에이전트 추천"으로 쓴다(helm-canon §17.6 §7).
- 행위자 표시에 아바타, 사람 이름, 성격 표현을 쓰지 않는다(UP-9). `ActorLabel`은 `role`과 `assignment`(맡긴 일)만 받는다.
- 스펙트럼 테두리는 글자 라벨의 보조다. 강제 색·투명도 줄이기에서 테두리가 사라져도 라벨로 구분된다(UP-4, UP-15).

#### 3.5.6 확실성 표현 [판정 J-19 / 제안: 표시]

숫자 confidence는 저장도 표시도 하지 않는다(J-19). 확실성은 글자 등급과 네 칸으로 그린다.

| 표시 | 값과 화면 라벨(05가 문구 확정) | 출처 |
|---|---|---|
| 지지 등급(`SupportGradeLabel`) | `untested` 아직 확인 안 됨 / `weak` 약함 / `consistent` 일관됨 / `confirmed` 확인됨 / `contested` 이의 있음(03 §3.3.6) | 15 `SupportGrade`(가능성·기준 후보·판단 후보) |
| 확신 등급(`ConfidenceGradeLabel`) | `low` 낮음 / `medium` 보통 / `high` 높음 | 14 U-10(상황 판정 등) |
| 직접성 | `direct` 직접 관찰 / `indirect` 다른 관찰에서 추론 / `none` 근거 없음 | 04 `EvidenceChainView.nodes[].quality.direct` |
| 반대 근거 확인 | `searched_none` 찾아봤는데 없음 / `found` 남은 반대 근거 있음 / `not_searched` 찾아보지 않음 / `searching` 찾는 중 | 04 `counterSearch` |
| 확인하지 못한 범위 | 문장 목록 | 뷰 |
| 다음 확인 | 문장 하나(불확실성을 가장 줄일 확인) | 뷰 |

- 등급은 글자로 쓴다. 막대·별·퍼센트처럼 숫자처럼 읽히는 표시를 쓰지 않는다.
- 근거 개수로 강도를 표시하지 않는다(helm-canon §8.3). "근거 3개" 같은 숫자를 강도처럼 크게 쓰지 않는다. 반대 근거는 "남은 반대 근거 1건"처럼 개수를 쓴다. 남은 반대 근거가 있다는 사실 자체가 정보이기 때문이다.
- 모델이 쓴 문장 안의 확률 숫자는 화면이 막을 수 없다(E22). 런타임 규칙(12·15)에 요구한다.
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
// packages/ui/src/model/freshness.ts
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
/** 결정 버튼을 켤 수 있는가. 계산은 `@helm/client-react`의 `decisionsAllowed(conn, { serverFreshness })`(boolean, 20 §3.8.9) 한 곳이다.
 *  참: 사용자용 연결 상태 connected·slow·safeMode + 서버 freshness current. 앱 신선도 refreshing·낡음 표시로는 막지 않는다
 *  (04 §3.0.4 규칙 3, J-59, J-60). 컨테이너가 이 boolean과 막힘 사유 문구 키를 묶어 부품에 넘긴다. 26의 모바일 판도 같은 모양이다 */
export interface DecisionAvailability { allowed: boolean; reasonKey?: CopyKey }
```

| 경우 | 화면 표시(문구는 04 §3.0.4·05) | 결정 행동 |
|---|---|---|
| 모두 `current` | 창 머리에 작은 `CircleCheck` + "방금 갱신". 개발자 보기(`devView`, 20 §3.9.11)에서만 seq 숫자 | 가능 |
| `refreshing` | 이전 데이터 그대로, 1초 넘으면 작은 진행 표시 | 가능(J-59). 보낸 의도의 `basisSeq`가 낡았으면 데몬이 `revisionConflict`로 거부한다 |
| `rebuilding`(데몬) | 띠 "다시 맞추는 중" | 막음(짧음) |
| `stale`(서버 freshness) | 화면 머리 띠 "이 화면은 14:02 기준입니다 · 이유". "지금 하는 일" 같은 현재 시제 문구를 "14:02에 하던 일"로 바꾼다(04 §3.0.4 규칙 2) | 막음. 이유와 "쓰던 답은 저장해 두었습니다"를 버튼에 붙임 |
| `stale`(앱 신선도만, 다시 받기 세 번 실패) | 같은 띠 | 막지 않음. 결정 막기는 서버 freshness와 연결로만 판정한다(20 §3.8.9, 04 §3.0.4 규칙 3). 띠 문구로 사람이 판단한다 |
| `missing` | 빈 상태 "연결되면 볼 수 있습니다" | 없음 |
| `failed` | 오류 상태 + [다시 불러오기](05 §3.10.5) | 막음 |
| `omitted`가 있음 | 목록 끝에 "보이지 않은 항목: 실행 기록 14건(정상 반복)" 줄. 펼치면 감사 깊이 | — |

낡은 화면을 흐리게(투명도) 만들지 않는다. 글자 대비가 떨어지고 "읽을 수 없음"으로 오해된다. 띠와 문장으로 알린다 [제안].

### 3.6 컴포넌트 공통 계약 [제안]

#### 3.6.1 부품 파일과 코드 규칙

부품 하나는 폴더 하나다. Caustic의 부품 구성을 따른다(§2.4.2). 위치는 `packages/ui/src/`(플랫폼 중립, §3.13) 또는 `apps/desktop/src/ui/`(데스크톱 전용)다.

```text
<Name>/
  <Name>.tsx          컴포넌트. ref는 일반 prop으로 받아 DOM 루트에 넘긴다(React 19)
  <Name>.variants.ts  cva 변형(있을 때)
  <Name>.text.ts      선형 텍스트 표현 toLinearText(vm) (복합 부품만, §3.6.6)
  <Name>.stories.tsx  상태별 이야기(§6.3). 이야기 이름 = 상태 이름
  <Name>.test.tsx     동작·접근성 테스트
  index.ts            공개 내보내기
```

- DOM 루트에 `data-slot="<name>"`을 둔다(테스트와 스타일 훅).
- React 19 규칙 [제안]:
  - ref는 props로 받는다(`ref?: React.Ref<HTMLDivElement>`). `forwardRef`를 새로 쓰지 않는다. shadcn에서 복사한 부품도 이 형태다.
  - 컨텍스트는 `<Ctx value>`로 공급하고 `use(Ctx)`로 읽어도 된다.
  - `useOptimistic`을 쓰지 않는다(UI-D03). 도메인 상태를 미리 그리는 장치이기 때문이다.
  - 폼 action(`<form action>`, `useActionState`, `useFormStatus`)으로 도메인 의도를 보내지 않는다. 도메인 의도는 20의 `useCommand`(멱등 키·명령함·재전송)를 거쳐야 하기 때문이다. 순수 화면 입력(설정 검색 등)에는 써도 된다.
  - 문서 메타데이터 태그(`<title>` 등을 부품 안에서 렌더)는 쓰지 않는다. 창 제목은 20이 정한다.
  - React Compiler 사용 여부는 20이 정한다. 부품은 컴파일러 없이도 맞게 동작해야 한다(메모이제이션에 정확성을 기대지 않는다).
- 부품은 데이터 가져오기, 프로토콜 호출, 앱 저장소 접근을 하지 않는다. 입력은 VM(뷰 모델) props, 출력은 콜백(`onIntent`, `onNavigate`, 표시 상태 콜백)뿐이다. 저장소와 VM을 잇는 일은 화면 컨테이너(20 소유)가 한다.
- 부품 안에 도메인 판정을 넣지 않는다. 예: 질문이 권리 게이트인지, 만료점이 가까운지, 근거가 낡았는지는 VM이 값으로 준다. 부품은 그 값을 그린다(결정 14·32).
- 시각, 개수, 문구 조합은 부품이 계산해도 된다(표시 계산). 정렬 순서는 VM이 준 순서를 지킨다(대비 압축 순서는 데몬이 정한다, v0.3 04 §8).

#### 3.6.2 VM 타입: 04 뷰 모델을 쓴다

화면 데이터의 정본 타입은 04의 뷰 모델(04 §3.0.2 공통 타입과 각 화면 절의 `*View`)이고, 19가 `view.get`의 `data`로 보낸다(19 §3.6.3). 이 타입들은 `@helm/protocol`에 있다(19·06). UI 부품은 이 타입을 그대로 받거나, 그 일부(`Pick`, 배열 원소)를 받는다. UI가 같은 뜻의 타입을 다시 정의하지 않는다.

UI만의 타입은 다음뿐이다.

```ts
// packages/ui/src/model/common.ts
export type {
  RecordRef, RecordKind, Author, ViewMeta, Freshness, QualityBadge, StatementView,
  Gate, Delivery, QuestionScreenKind, ExpiryPoint, QuestionSummary, CommandIntentBase,
} from '@helm/protocol';                    // 04 §3.0.2
import type { CopyKey } from '@helm/ui-language';   // 05 §3.10.8 문구 키(J-103)
import type { BlobRef } from '@helm/protocol';     // 19 BlobRef
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

/** 사용자용 연결 상태. 값과 표기는 04 §3.0.4 표의 열여섯 상태다(camelCase, J-176·J-196·J-228). 20 §3.8.9가 `UserConnKind`를 이 값으로 대응시킨다.
 *  키체인 거부·SSH 실패·다른 서버도 04 표의 상태 값이다(J-176). 사유별 문장은 `ConnectionVM.reasonKey`(CopyKey)로 따로 받는다 */
export type ConnectionUiState =
  | 'connected' | 'slow' | 'reconnecting' | 'serverPcUnreachable' | 'daemonUnreachable'
  | 'authFailed' | 'keychainDenied' | 'sshFailed' | 'wrongServer' | 'versionMismatch'
  | 'readOnly' | 'syncing' | 'viewStale' | 'restarted' | 'draining' | 'safeMode';   // readOnly = 19 daemonMode readOnly, 화면 이름 "읽기 전용"(J-115)

/** 레코드 칩에 붙일 수 있는 화면 표시 정보. 모두 선택 항목이라 04 RecordRef를 그대로 넘겨도 된다 */
export interface RecordChipExtras {
  badges?: QualityBadge[];
  authoredBy?: Author;
  autonomous?: boolean;
  unseen?: boolean;            // 사람이 아직 보지 않은 변화 (04에 요구, §5.2)
  at?: string;
}

/** 근거·실행 기록의 출처 한 줄(helm-canon-2 §3.11의 6필드). 04 EvidenceChainView.nodes[].source와
 *  실행 기록 뷰의 toolcall 요약을 컨테이너가 이 모양으로 합쳐 넘긴다. 없는 필드는 그리지 않는다 */
export interface SourceTrace {
  kind: 'tool' | 'human' | 'external' | 'file';   // 04 source.kind
  ref: string;                                    // 04 source.ref (tc_… , 파일 경로, 외부 이름)
  hashOrCommit?: string;                          // 04 source.hashOrCommit. 바뀌면 낡음
  at?: IsoTime;                                   // 실행 시각
  tool?: string;                                  // 명령·도구 이름
  inputScope?: string;                            // 입력 범위(파일, 경로, 질의)
  output?: { blob?: BlobRef; summary?: string };   // 출력 참조
  exit?: { code?: number; errorKey?: CopyKey };   // 종료·오류
  workUnit?: RecordRef;                           // 출처 WorkUnit
}
```

이 문서의 TS 블록에서 행위자는 04의 `Author`(객체, `kind`로 구분)를 쓴다. 08의 `ActorRef`(문자열, 예 `agent:work`)는 저장 형식이며 부품이 직접 받지 않는다. `RecordRef`는 `@helm/protocol`의 한 정의(04 §3.0.2 모양, `kind`는 08 §3.20.1 리터럴에서 파생)만 쓴다(+ `RecordChipExtras`). 부품 props 초안(§3.7.3, §3.8)에 있는 뷰 모델 모양의 타입은 04 타입이 정해지기 전에 쓴 것이며, 아래 대응표대로 04 타입으로 바꾼다. 두 쪽이 다르면 04가 우선이고, 부품이 더 필요로 하는 필드는 §5.2에서 04에 요구한다.

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

부품은 사람의 조작을 `UiIntent`로 올린다. 의도의 이름과 인자는 19의 명령 메서드(19 §3.7.1 등록 표, §3.7.5)를 그대로 쓴다. UI가 따로 이름을 만들지 않는다. 메서드 → 커널 명령 대응은 19가, 의도 → `useCommand` 호출은 20이 한다(20 §3.9.7).

```ts
// packages/ui/src/model/intent.ts
import type { CommandMethodName, MethodMap } from '@helm/protocol';   // 19 §3.14
export interface IntentBase {
  /** 19의 idempotencyKey(ik_<ULID>). 20이 만든다. 같은 조작의 재전송은 같은 값 */
  idempotencyKey: string;
  /** 사람이 보고 결정한 뷰의 sourceSeq (04 CommandIntentBase, UI-D02) */
  basisSeq: number;
}
export type UiIntent<M extends CommandMethodName = CommandMethodName> =
  IntentBase & { method: M; params: Omit<MethodMap[M]['params'], 'idempotencyKey' | 'basisSeq'> };
```

부품별로 내는 의도(메서드 이름은 19 §3.7.5):

| 부품 | 메서드 |
|---|---|
| `QuestionCard`, `QuestionInbox` | `question.answer`, `question.proceedWithAssumption`, `question.requestReframe`, `question.requestInquiry`, `question.delegate`, `question.defer` |
| `ContestButton`(`OVL-CONTEST`) | `objection.file`(판정 J-111) |
| `AutonomousChoiceList` | `autonomous.markSeen`, `decision.confirm`(이대로 둔다), `objection.file` |
| `StimulusBoard` | `reaction.record`, `reaction.amend`, `reaction.withdraw`, `stimulusRound.close` |
| `PreferenceModelPanel` | 기준 확인은 질문(`question.answer`)으로 |
| `WorkAgreementDraft` | `agreement.confirm`, `agreement.revise`, `agreement.narrow`, `agreement.decline`, `agreement.correctUnderstanding` |
| `ResultReviewPanel` | `result.accept`(`decision`은 10 명령 값 다섯: `accept`·`accept_with_conditions`·`request_changes`·`reject`·`criteria_wrong`. 거절과 기준 틀림도 이 메서드다, 판정 J-123. 기록 값과의 대응은 판정 J-35), `obligation.confirmDone`, `obligation.defer`, `obligation.transfer`. 확인 뒤 되돌리기는 `objection.file`(판정 J-123: `result.reopen`은 쓰지 않는다) |
| `GoalHistory` | `goal.revise`, `goal.confirmRevision`, `goal.rejectRevision`, `goal.confirmAchieved` |
| Concern 머리 | `concern.revise`, `concern.hold`, `concern.resume`, `concern.close`, `loop.requestTransition`, `structure.request` |
| `HypothesisBoard` 등 탐구 보드 | `inquiry.requestFrame`, `inquiry.proposeCandidate`, `inquiry.markAssumption`, `inquiry.pinCheck`, `inquiry.requestDecision`, `inquiry.stop` |
| `DialPanel` | `dial.set`, `dial.unset`, `mode.set` |
| `ActiveWorkCard`, `ActiveRunDrawer` | `work.steer`, `work.pause`, `work.resume`, `work.stop`, `work.abort`, `work.requestBrief` |
| `ScopedComposer`, `ConversationThread` | `composer.submit`. 의미 미리보기는 `composer.preview`(read)의 `SemanticPreviewResult` |
| `SinceLastVisit` | `brief.acknowledge`, `brief.correct` |
| `RecoveryList` | `recovery.resolve` |
| `ObserverProposalCard` | `observerProposal.adopt`, `observerProposal.decline`, `observerProposal.snooze` |

탐색·표시 상태(펼침, 인스펙터 열기, 화면 이동)는 `onNavigate`, `onExpandedChange` 같은 콜백으로 올리고 `UiIntent`로 만들지 않는다. 화면 열람 기록(감사 깊이 열람은 `presence.report`의 `depth`, J-84, 16 §3.24)은 화면 컨테이너(20)가 보낸다. 부품은 보내지 않는다.

결정 버튼 규칙:

- 결정 의도를 보내는 버튼은 `ActionButton`만 쓴다. `ActionButton`은 `consequence` prop이 있으면 버튼 문구 아래나 옆에 대상과 효과를 쓴다(예: "1·2절만 김OO에게 보내기", 04 §3.4 `OptionView.actionLabel`). `tone="danger"` 또는 권리 게이트 버튼은 `consequence`가 없으면 개발 모드에서 오류를 던진다(UP-11).
- 한 카드 안에 "예/아니오" 두 버튼만 있는 배치를 만들지 않는다. 대안 행동(기준 고치기, 질문 다시 쓰기, 먼저 알아보기, 미루기, 이의 걸기)을 같은 카드의 "그 밖에" 줄로 항상 보인다(§3.9 R2, 04 §3.4).

#### 3.6.4 행동 수명주기와 낙관적 갱신 금지

`ActionButton`의 상태는 20의 `useCommand` 상태(20 §3.9.7: `idle | sending | waiting_reconnect | done | rejected | failed`)를 그린다. 상태 변화는 데몬 응답과 뷰 갱신만 일으킨다(UI-D03).

| 상태 | 이벤트 | 다음 상태 | 가드 | 부수 효과·표시 |
|---|---|---|---|---|
| `idle` | 누름 | `sending` | `availability.allowed` 참(§3.5.8) | `onIntent(intent)`. 버튼 "보내는 중"(정적 점 3개), 같은 버튼 다시 누를 수 없음 |
| `idle` | (가드 거짓) | `idle` | — | 버튼 비활성 + 이유 툴팁. 연결 문제면 "연결되면 보낼 수 있습니다. 쓰던 답은 저장해 두었습니다"(04 §3.0.4) |
| `sending` | 응답 성공 | `done` | — | "적용됨" 문장 2초(04 §3.0.6). 카드의 도메인 상태는 아직 바꾸지 않는다 |
| `done` | 뷰 갱신에 결과 반영 | (부품이 다시 그려짐) | — | 카드가 사라지면 다음 카드로 포커스(§3.6.5). 결과 영향은 `ChoiceImpactEcho` |
| `sending` | 거부: 낡은 기준(`3004 command.revisionConflict`, 19) | `rejected` | — | 오류의 `rebase`(대상 현재 요약)로 바뀐 칸을 강조하고 카드 위 띠 "화면을 연 뒤 상황이 바뀌어 이 답을 적용하지 않았습니다" + 바뀐 항목 강조 + 쓰던 답 유지(04 §3.0.5) |
| `sending` | 거부: 내용·자격·경로(10의 갈래 `content` / `authority` / `path`) | `rejected` | — | 거부 종류별 문장(04 §3.0.6 표, 05) |
| `sending` | 10초 동안 응답 없음 | `sending` | — | "서버가 아직 답하지 않았습니다. 연결 상태를 확인하는 중입니다"(04 §3.0.6) |
| `sending` | 연결 끊김·시간 초과 | `waiting_reconnect` | — | "연결되면 이어서 보냅니다". 20이 재접속 뒤 같은 멱등 키로 다시 보낸다(20 §3.9.7) |
| `waiting_reconnect` | 재전송 결과 | `done` 또는 `rejected` | — | 위와 같음 |
| `waiting_reconnect` | 24시간 지남 | `failed` | — | "보내지 못한 조작"으로 `SCR-CONNECT` 목록에 남음(20) |
| `rejected`, `failed` | 닫기 | `idle` | — | — |

- 화면은 사람이 누른 결과를 미리 그리지 않는다. 예: "결과 확인"을 눌러도 상태 라벨은 뷰가 `accepted`를 보낼 때 바뀐다.
- 연결이 없을 때 새 결정을 받아 쌓아 두지 않는다(04 ADR A4, 20 §3.9.7). 입력하던 글은 초안으로 보존한다(보존 위치는 20). 이미 보낸 뒤 끊긴 조작의 재전송만 20이 한다.
- 예외: 자극 반응은 관찰 기록이므로, 연결이 끊겨도 입력을 받아 "보내지 않음"으로 기기에 두고 다시 연결되면 사람이 "보내기"를 누른다(04 §3.9). `StimulusBoard`가 이 상태를 그린다.

#### 3.6.5 키보드, 포커스, IME

키 배정의 정본은 05 §3.8이다. 이 절은 부품이 키를 구현하는 규칙이다.

- 모든 기능은 키보드로 된다. 마우스 경로도 모두 있다(helm-canon-3 §6.11).
- 포커스 표시: 텍스트 입력칸은 자기 테두리를 `focus-field`(안쪽 1.5px)로 바꾸고 바깥 링을 더하지 않는다. 그 밖은 `focus-ring`(바깥 2px). `:focus-visible`에서만 그린다(Caustic 정책 9). 유리 위 포커스 링도 3:1 이상이다(`focus-ring`이 강조 단색이라 유리 최악 배경에서도 유지, §6.3에서 검사).
- 목록·트리·보드는 로빙 tabindex를 쓴다. 목록 전체가 Tab 한 번, 안에서는 화살표와 `J`/`K`.
- 카드가 결정으로 사라지면 포커스를 같은 목록의 다음 카드로, 없으면 목록 머리로 옮긴다(05 §3.9). 포커스를 잃어 `body`로 가지 않게 한다.
- 대화상자·시트는 포커스를 가두고, 닫으면 연 요소로 돌려준다(Radix 기본).
- 결정 의도(답하기, 허락, 가정대로 진행, 합의 확정, 결과 확인, 복귀 요약 확인, 라운드 마치기, 이의 보내기)는 포커스된 버튼의 Enter·Space로만 보낸다. 한 글자·조합 단축키로 결정을 보내지 않는다. 예외 셋(05 §3.8.1 규칙 6): 자극 반응(`1`~`5`, `N`, `M`, `R`), "봤음"(`S`), "안전하게 멈추기"(`P`). 여러 줄 입력의 제출은 Mod+Enter이며 이의 사유 칸의 Mod+Enter는 이의를 보낸다.
- **한 글자 단축키는 물리 키로 판정한다**: `KeyboardEvent.code`(`KeyM`, `Digit1`)를 쓰고 `key`를 쓰지 않는다. 한글 입력 상태에서도 동작하게 하려는 것이다(05 §3.8.1 규칙 3). 텍스트 입력에 포커스가 있으면 한 글자 단축키는 동작하지 않는다.
- **IME**: 모든 텍스트 입력 부품은 Enter 제출과 Esc 닫기 전에 조합 중인지 검사한다. 조합 중 Esc는 조합 취소가 먼저다.

```ts
// packages/ui/src/lib/keys.ts
export function isImeComposing(e: KeyboardEvent | React.KeyboardEvent): boolean {
  const n = 'nativeEvent' in e ? e.nativeEvent : e;
  // Safari(WKWebView)는 조합을 끝내는 Enter의 keydown에서 isComposing=false, keyCode=229를 준다 [지식]
  return n.isComposing || n.keyCode === 229;
}
/** 한 글자 단축키 판정. 입력칸 포커스·IME 조합·수정 키가 있으면 false */
export function matchSingleKey(e: KeyboardEvent, code: string): boolean;
```

#### 3.6.6 선형 텍스트 표현

복합 부품(§3.7.3, §3.8)은 `toLinearText(vm, depth): string`을 함께 낸다.

- 용도: (1) 스크린 리더 요약(`aria-describedby`로 연결한 숨긴 요약), (2) "텍스트로 복사", (3) 골든 테스트(§6.3), (4) TUI가 같은 정보를 보이는지 대조하는 기준.
- 규칙: 한 줄에 한 사실. 라벨을 앞에 둔다("반대 근거: …"). 색·아이콘에만 있던 정보가 모두 글자로 들어간다. 80자 폭에서 의미가 끊기지 않는다.
- 예(`QuestionCard`, 한눈에 깊이):

```text
[선택 필요] 1·2절 초안을 외부 리뷰어에게 보낼지 정해야 합니다. 지금 정하지 않으면 리뷰 마감(내일 10:00)을 넘깁니다.
왜 지금인가: 리뷰 마감이 내일 10:00입니다
추천: 1절만 먼저 보내기 (에이전트 추천)
다른 선택: 1·2절을 함께 보내기
답이 없으면: 보내지 않은 채 이 작업이 멈춰 있습니다
행동: 1절을 외부 리뷰어에게 보내기 | 1·2절을 외부 리뷰어에게 보내기 | 보내지 않기 | 범위 줄여 진행 | 내일 아침까지 미루기 | 이의 걸기
기준 시점: 3분 전
```

#### 3.6.7 문구 키 [J-103]

문구 사전은 `@helm/ui-language`(05 A9, 판정 §2)가 소유한다. 1단계의 `copy/ko.ts` 사전은 철회했다. 부품은 문장을 갖지 않고 **문구 키(와 인자)만 받는다**.

```ts
// packages/ui/src/model/copy.ts
import type { CopyKey } from '@helm/ui-language';          // 05 §3.10.8 키 목록
export interface CopyRef { key: CopyKey; args?: Record<string, string> }
/** 키 → 문장 변환기. 컨테이너가 @helm/ui-language로 만들어 공급자로 넘긴다 */
export type Translate = (ref: CopyRef) => string;
export const TranslateContext: React.Context<Translate>;
```

- 고정 표현 머리말(예: "왜 지금인가", "돌아온 뒤 달라진 점", "지금 하는 일", "확인된 것")도 키로 받는다. 키 묶음은 helm-canon §18.5 `fixed_sections`를 따르고 05가 확정한다.
- 데몬이 보내는 사용자용 문장도 `{ key, args }`(04 §3.0.2 `CopyKey`)로 오므로 같은 변환기로 그린다. 모르는 키는 키 이름을 그대로 보이지 않고 "(문구 없음)"으로 그리고 개발 모드에서 경고한다.
- 이야기·테스트는 `@helm/ui-language`의 실제 사전을 쓴다. 문구 테스트(금지 문구, R7)는 이 사전을 기준으로 한다(22).
- `product-language.yaml`을 문구 테스트 기준으로 쓴다는 원천 규칙(helm-canon §17.7 끝)은 05·22가 `@helm/ui-language`에 옮긴다.

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
| 오류 | 위험 색 글자 + 아이콘 + 문장 + 다음 행동 | 사람이 방금 한 조작의 오류는 `aria-live="polite"`로 한 번. `role="alert"`는 연결 끊김·즉시 전달 권리 게이트 배너에만(05 §3.9) |
| 빈 상태 | 무엇이 비었는지와 왜 그런지("아직 열린 질문이 없습니다. 질문은 에이전트가 기록하면 여기 모입니다") | — |
| 낡음 | §3.5.8 띠 | 띠는 `role="status"` |
| 오프라인 읽기 전용 | 결정 버튼 비활성 + 이유 | — |

스트림 갱신 알림(05 §3.9): 상태 변화는 `aria-live="polite"`로 짧게 알린다("적용됨: 질문 14"). 의미 있는 변화(05 §3.6.5의 일곱 사건, 상태 라벨 변경)만 알리고, 같은 카드는 30초에 한 번 이상 알리지 않으며, 화면 밖 변화는 영역 하나에 모아 "새 변화 3건"으로 묶는다. 진행 중 작업의 세부 갱신을 하나씩 읽지 않는다(helm-canon-3 §6.11). `role="alert"`는 연결 끊김 배너와 즉시 전달된 권리 게이트 배너에만 쓴다(05 §3.9).

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

Radix가 키보드·포커스·ARIA를 제공하는 부품은 Radix 동작을 그대로 쓰고, 이 표는 Helm이 더하는 규칙만 적는다. 시작 소스는 shadcn radix 바탕 부품을 복사한 것이고(§2.5.2), 복사 뒤 Helm 토큰·규칙으로 다시 입힌다. 모든 부품은 ref를 prop으로 받는다(React 19).

| 부품 | 바탕 | 목적과 Helm 규칙 | 키보드 | 접근성 |
|---|---|---|---|---|
| `Surface` | `div` | 재질 지정 판: `material: 'solid' \| 'raised' \| 'chrome' \| 'overlay'`. `chrome`·`overlay`는 유리 유틸리티(§3.2.5)를 붙이고 투명도 줄이기·흐림 미지원에서 불투명으로 바뀐다. 읽는 글을 담는 부품은 `solid`·`raised`만 받는다(타입으로 제한) | — | — |
| `Button` | `button`, Radix `Slot` | 탐색·표시 조작(결정 아님). 변형 `ink`(주 행동, UP-16)/`secondary`(`control-raised`)/`ghost`/`accent`(화면당 하나), 크기 `sm`/`md` | Enter, Space | 아이콘만이면 `aria-label` 필수(타입으로 강제) |
| `IconButton` | `Button` | 아이콘만 있는 버튼. `label` 필수, 툴팁 자동 | 같음 | `aria-label=label` |
| `ActionButton` | `Button` | 결정 의도 전송. §3.6.4 상태 기계 내장. `consequence` 규칙(§3.6.3) | Enter, Space. 단축키 없음 | 상태 변화를 `aria-live` 영역에 한 번 알림 |
| `RecordLink` | `a`(앱 내부 링크) | 레코드로 이동하거나 인스펙터를 연다. 레코드 종류 아이콘 포함 | Enter 이동, Shift+Enter 인스펙터 | 이름 = 종류 라벨 + 제목 |
| `TextField` | `input` | 한 줄 입력. IME 규칙(§3.6.5) | Enter 제출(조합 중 제외) | `label` 필수, 오류는 `aria-describedby` |
| `TextArea` | `react-textarea-autosize` | 여러 줄. 최소 3줄, 최대 12줄 뒤 스크롤 | ⌘/Ctrl+Enter 제출, Enter 줄바꿈 | 같음 |
| `Select` | Radix Select | 짧은 고정 목록에서 하나 고르기(설정용). 원함 탐구·질문 카드에서 쓰지 않는다(§3.9) | Radix | Radix |
| `Checkbox`, `Switch` | Radix | 설정, 반영 항목 체크 | Space | Radix |
| `RadioGroup` | Radix | 설정용만 | 화살표 | Radix |
| `SegmentedControl` | Radix ToggleGroup(single) | 다이얼 값(적게/보통/많이), 깊이 전환 | 화살표, Space | `aria-label` 필수 |
| `Tabs` | Radix Tabs | Concern 화면의 영역(상황, 탐구, 작업, 결과, 이력) | 화살표, Home/End | Radix |
| `Tooltip` | Radix Tooltip | 보조 설명. 필수 정보를 툴팁에만 두지 않는다 | 포커스 시 열림 | Radix |
| `Popover` | Radix Popover | 짧은 상세(질문의 임시 가정 설명). 틀은 `glass-overlay`, 글은 `text-primary`·`text-secondary`만 | Esc 닫기 | Radix |
| `HoverPreview` | Radix HoverCard | 레코드 칩 위에서 요약 미리보기(마우스 전용 보조) | 키보드 사용자는 Shift+Enter 인스펙터로 같은 정보 | 보조 수단 |
| `Dialog` | Radix Dialog | 이의 사유, 기준 수정처럼 짧은 입력. "계속할까요" 확인 대화상자를 만들지 않는다 | Esc, 포커스 가둠 | Radix |
| `Sheet` | Radix Dialog(측면) | 좁은 창의 인스펙터, 설정. 틀은 `glass-overlay`, 내용 판은 불투명 | 같음 | 같음 |
| `BottomSheet` | Radix Dialog(아래에서 올라옴) | 모바일(26)의 "그 밖에" 메뉴, 이의 사유, 미루기 선택. 손잡이(grabber)와 아래로 끌어 닫기, 높이 두 단계(절반·전체). 데스크톱에서는 쓰지 않는다. `touch` 밀도 전용 | Esc, 포커스 가둠, 닫기 버튼(끌기만으로 닫는 경로를 두지 않음) | `aria-modal`, 제목 필수 |
| `Menu` | Radix DropdownMenu | 보조 행동 묶음(복사, 감사 보기)과 질문 카드의 "그 밖에" 메뉴(05 §3.8.4 `M`). "그 밖에" 메뉴의 항목(기준 고치기, 질문 다시 쓰기, 먼저 알아보기, 에이전트가 정하게 두기, 미루기, 이의 걸기)은 펼친 질문 카드에서는 보이는 줄로도 둔다(§3.9 R2). 주 결정 버튼을 메뉴 안에 숨기지 않는다. 메뉴 판은 `glass-overlay`(메뉴 글자는 오버레이 재질에서 4.5:1 이상, §3.2.2) | Radix | Radix |
| `Toast` | Radix Toast | 사람이 방금 한 조작의 결과·오류. 진행 이벤트 금지(UP-13). 5초, 오류는 닫을 때까지. 판은 `glass-overlay` | F8로 토스트 영역 이동 | `aria-live="polite"` |
| `Disclosure` | Radix Collapsible | 접힘 영역("에이전트가 정한 것 4") | Enter, Space | `aria-expanded` |
| `ScrollArea` | 기본 스크롤 + CSS | Radix ScrollArea는 쓰지 않는다(기본 스크롤이 접근성·성능에 낫다 [지식]) | — | — |
| `Markdown` | `react-markdown` | 데몬이 보낸 마크다운 문장의 유일한 렌더러. 원시 HTML 끔, 링크 스킴 `https`·`helm`만, 그림은 `BlobImage`로만(E21, 20 §5.2) | 링크 Enter | 링크에 실제 주소를 `aria-describedby`로 |
| `BlobImage` | `img` | 데몬 blob(19 `BlobRef`, 표시 판 `variants`)을 그린다. 주소는 컨테이너가 `helm-blob` 경로로 준다. 503(연결 없음)이면 "연결되면 보입니다" 자리 표시, 그 밖의 실패는 대체 글 + [다시 불러오기](20 §5.2) | — | `alt` 필수 |
| `Banner` | `div` | 화면 머리 아래 띠(낡음, 저하, 오류) | 닫기 버튼(닫을 수 있는 띠만) | `role="status"` 또는 `alert` |
| `EmptyState`, `ErrorState` | `div` | 무엇이 비었나/무엇이 실패했나 + 다음 행동 | — | 제목은 제목 요소 |
| `Skeleton` | `div` | 정적 뼈대 | — | `aria-hidden` |
| `Kbd` | `kbd` | 단축키 표시(⌘ / Ctrl을 OS에 맞게) | — | — |
| `Splitter` | `div role="separator"` | 패널 너비 조절 | ←/→ 16px, Shift 64px | `aria-valuenow` |
| `VirtualList` | `@tanstack/react-virtual` | 200행이 넘는 목록 | 화살표, PageUp/Down, Home/End | `role="list"`/`grid`, `aria-setsize`·`aria-posinset` |
| `DataTable` | `table` | 정적 표. 첫 열 고정 | 행 사이 화살표(그리드 모드일 때) | `th scope` |

```ts
// packages/ui/src/primitives/ActionButton/ActionButton.tsx (props)
export interface ActionButtonProps {
  ref?: React.Ref<HTMLButtonElement>;    // React 19: ref는 일반 prop
  /** 결과를 말하는 문구 (helm-canon §17.6 §4). 예: "결과 확인", "이 선택으로 진행" */
  children: React.ReactNode;
  /** 보낼 의도. idempotencyKey·basisSeq는 컨테이너(20)가 채운다 */
  intent: UiIntent;
  /** 20의 useCommand().send를 감싼 함수. 결과는 상태로만 쓰고 화면을 미리 바꾸지 않는다 */
  onIntent: (intent: UiIntent) => Promise<CommandOutcomeView>;
  /** 20 useCommand의 현재 상태 (§3.6.4) */
  status: 'idle' | 'sending' | 'waiting_reconnect' | 'done' | 'rejected' | 'failed';
  /** 대상과 효과. tone="danger" 또는 rightsGate=true면 필수 */
  consequence?: { target: string; effect: string };
  tone?: 'primary' | 'secondary' | 'danger';
  rightsGate?: boolean;
  /** 결정 가능 여부 (§3.5.8, 20이 계산) */
  availability: DecisionAvailability;
  size?: 'sm' | 'md';
}
/** 20 CommandOutcome을 화면용으로 줄인 것 */
export type CommandOutcomeView =
  | { kind: 'ok' }
  | { kind: 'rejected'; reason: 'revision_conflict' | 'content' | 'authority' | 'path'; errorCode: number; messageKey: CopyKey; args?: Record<string, string>; rebase?: unknown }   // 19 §3.3.4, 10 갈래
  | { kind: 'expired' };
```

#### 3.7.2 L1 Helm 의미 부품 [제안]

```ts
// packages/ui/src/helm/props.ts — L1 부품 props 모음
export interface KindLabelProps { kind: RecordKind; /** 라벨 숨기고 아이콘만(좁은 칸). 이때도 aria-label은 남는다 */ compact?: boolean }
export interface QualityBadgeProps { badges: QualityBadge[]; staleBecause?: string; contestReason?: string; depth: Depth }   // 04 StatementView
export interface AuthorshipMarkProps { author: Author; autonomous?: boolean; depth: Depth }
export interface DraftMarkProps { author: Extract<Author, { kind: 'agent' }>; children: React.ReactNode; /** 사람이 이미 고친 초안 */ editedByHuman?: boolean }
export interface ActorLabelProps { actor: Author; /** 맡긴 일 한 줄(예 "본문 1절 초안"). 04 ActiveWorkCard.assignment */ assignment?: string }   // 아바타·이름 prop 없음 (UP-9)
export type StatusSet = 'work' | 'choice' | 'concern' | 'question';
export interface StatusLabelProps { set: StatusSet; value: string }
export interface LoopChipProps { loop: LoopId; /** 현재 위치 */ current?: boolean; planned?: boolean }
export type LoopId =
  | 'O' | 'I.fact' | 'I.want' | 'I.possibility' | 'I.outcome'
  | 'C.commit' | 'C.probe' | 'C.emergency'
  | 'A.confirm' | 'A.watch' | 'A.reflect'
  | 'S.split' | 'S.merge' | 'S.detach' | 'S.relocate' | 'S.recombine' | 'S.hold' | 'S.close';  // v0.3 03 §2.1, 최종은 14
export interface SituationChipProps { type: 'clear' | 'complicated' | 'complex' | 'chaotic' | 'disorder' | null; assessedBy?: Author; autonomous?: boolean; contested?: boolean }   // 04 ConcernNode.situation, null = 판정 전
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
  /** 고른 바라는 효과별 영향 미리보기 문구(04 이의 걸기 흐름). 부품은 영향을 계산하지 않고 받은 문구를 그린다 */
  impactPreview?: Partial<Record<'reopen' | 'ask_next_time' | 'note_only', CopyRef>>;
  makeIntent: (input: { reason?: string; desiredEffect: 'reopen' | 'ask_next_time' | 'note_only' }) => UiIntent;
  onIntent: ActionButtonProps['onIntent'];
  availability: ActionButtonProps['availability'];
}
export interface WholeUpdateBadgeProps { accepted: boolean; remaining: number }
/** 13 §3.11.5 보장 성질 G1~G8과 수준. run마다 데몬이 계산해 보낸다 */
export type EnforcementLevel = 'enforced' | 'detected' | 'advisory' | 'unavailable';
export interface EnforcementBadgeProps {
  properties: Array<{ id: 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6' | 'G7' | 'G8'; level: EnforcementLevel }>;
  depth: Depth;   // 한눈에: 가장 낮은 수준 하나 + "권고만" 경고, 검토: 성질별 표
}
export interface SandboxBadgeProps {
  level: 'S0' | 'S1b' | 'S1';
  /** S1b이고 허용 목록 실험 전이면 'pre_read_exposed'(13 §3.6.1). 쓰기는 막지만 홈 읽기 범위가 넓다 */
  flag?: 'pre_read_exposed';
}   // 13 §3.6.1. S0 = 격리 없음
export interface ArgsViewProps {
  args: unknown;                         // 13 argsPreview(가림을 거친 값). 원문 전체 또는 잘린 값
  truncated?: { totalBytes: number; full: BlobRef };   // 19 BlobRef. 잘렸으면 필수. 없으면 전체로 본다
  depth: Depth;
  /** 고쳐서 허락용 편집 칸. 권리 게이트 질문 카드에서만, 데스크톱에서만 준다. 고친 값과 지문을 넘기고, 전송은 컨테이너(20)가 한다 */
  editable?: { onEdited: (edit: { args: unknown; editedFingerprint: string }) => void };
}
export interface ScopeDiffProps { current: AgreementScope; requested: AgreementScope }   // 08 Scope(AgreementScope로 내보냄, 19 인증 Scope와 이름이 겹쳐 protocol이 요구, §5.2)
export interface SupportGradeLabelProps { grade: 'untested' | 'weak' | 'consistent' | 'confirmed' | 'contested' }   // 15
export interface ConfidenceGradeLabelProps { grade: 'low' | 'medium' | 'high' }   // 14 U-10
```

| 부품 | 목적 | 상태 | 키보드 | 접근성 |
|---|---|---|---|---|
| `KindLabel` | 레코드 종류 표시(§3.5.2) | 기본, `compact` | — | 아이콘 `aria-hidden`, 글자 또는 `aria-label` |
| `QualityBadge` | 품질 상태·옆길(§3.5.3). `contested`·`stale`은 이유 문장 동반 | 깊이별 표시 규칙 | — | 배지 글자 + 이유가 접근 가능한 이름에 포함 |
| `AuthorshipMark` | 작성자(§3.5.5) | 사람/에이전트/규칙/런타임/외부 | — | 글자 |
| `DraftMark` | 모델 초안 감싸기. 파선 테두리 + "초안 · 작업 에이전트" | 초안, 사람이 고친 초안("초안 · 내가 고침") | — | 영역 이름 "에이전트 초안" |
| `ActorLabel` | 역할과 맡긴 일 | — | — | 글자만 |
| `StatusLabel` | 상태 라벨(§3.5.4) | 집합별 값 | — | 글자 |
| `LoopChip` | 루프 이름 칩. 03 §3.3.7 라벨(`I.want` → "원함 탐구")을 쓰고 식별자(`I.want`)는 감사 깊이에서만 덧붙인다 | 기본, 현재(굵게 + 밑줄), 계획만(파선 테두리) | — | 이름 "원함 탐구 루프, 현재" |
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
| `ContestButton` | 이의 걸기. 누르면 `OVL-CONTEST` 대화상자로 사유 입력(선택 사항, 비워도 됨)과 바라는 효과(`desiredEffect`: 다시 열기 `reopen` / 다음부터 묻기 `ask_next_time` / 기록만 `note_only`, 08·11)를 고른 뒤 `objection.file`. "다음부터 묻기"는 같은 이의 한 번의 조작으로 끝나며 다이얼 화면으로 따로 보내지 않는다(11 §3.9.4: 종류별 예외 다이얼이 같은 트랜잭션에서 기록됨). 고른 효과의 영향 미리보기(`impactPreview`)는 보내기 전 같은 자리에 보인다(예: 다음부터 묻기는 "앞으로 '루프 전환'은 묻습니다(모든 Concern)"). 보낸 뒤 재결정 질문이 생기면 "다시 정할 질문: 질문 n [지금 정하기]"를 같은 자리에 둔다(04 이의 걸기 흐름) | 기본, 이미 이의 걸림, 보내는 중 | Enter | 대화상자 제목 "이의 걸기: <대상>" |
| `WholeUpdateBadge` | "결과 확인됨 · 반영 2개 남음"(03 §3.3.2). `remaining=0`일 때만 "완료" | — | — | 글자 |
| `EnforcementBadge` | run의 보장 수준(13 §3.11.5). 한눈에: 가장 낮은 수준이 `advisory`·`unavailable`이면 "권고만"(경고 색 + `ShieldAlert`). 검토: 성질(G1 파일 쓰기 범위, G2 실행 쓰기 범위, G3 실행 의도 선기록, G4 관찰 출처, G5 컨텍스트, G6 크래시 복구, G7 사람 결정 경로, G8 독립 검증)별 수준 표. 강제되지 않는 범위를 강제된 것처럼 보이지 않는다(13 §3.11, 01 PR-12) | 네 수준 | — | 표는 `table`, 수준은 글자 |
| `SandboxBadge` | 실행 격리 수준. `S1` "격리됨(마운트)", `S1b` "격리됨(systemd)", `S0` "격리 없음" 경고(위험 색 글자 + 아이콘, 항상 보임)(13 §3.6). `S1b`에는 "신호 격리 없음"(같은 uid 프로세스에 신호를 보낼 수 있음) 경고를 항상 함께 보이고, `flag`가 `pre_read_exposed`면 "허용 목록 실험 전 · 홈 읽기가 넓음"을 덧붙인다(13 §3.6.1 표) | 세 수준, 표지 한 개 | — | 글자 |
| `SupportGradeLabel` | 지지 등급 글자(§3.5.6). `contested`는 경고 색 | 다섯 값 | — | 글자 |
| `ConfidenceGradeLabel` | 확신 등급 글자(낮음/보통/높음) | 세 값 | — | 글자 |

이의 사유를 필수로 받지 않는다 [제안]. 이유를 말하지 못하는 이의도 받는다(결정 18의 "이유 없는 반응"과 같은 원리). 사유가 비면 "사유 없이 이의"로 기록되게 11에 요구한다.

#### 3.7.3 L2 Helm 복합 부품 [제안]

모든 L2 부품은 `depth: Depth`, `meta: ProjectionMeta`(화면 단위로 받으면 생략 가능), `onIntent`, `onNavigate`를 받는다. 아래 TS에서는 반복을 줄이려고 공통 props를 `L2Common`으로 묶는다.

```ts
// packages/ui/src/composites/common.ts
export interface L2Common {
  depth: Depth;
  onIntent: (intent: UiIntent) => Promise<CommandOutcomeView>;
  onNavigate: (target: NavTarget) => void;
  availability: DecisionAvailability;
  /** 컨테이너가 idempotencyKey·basisSeq를 채운 의도 생성기 */
  makeIntentBase: () => IntentBase;
}
export type NavTarget =
  | { type: 'record'; record: RecordRef; how: 'navigate' | 'inspect' }
  | { type: 'screen'; screen: ScreenId; params?: Record<string, string> }   // 03 §3.6 화면 ID
  | { type: 'audit'; seqRange?: [number, number]; recordId?: Id };
```

##### (1) `SinceLastVisit` 복귀 요약

- 목적: 사람이 돌아온 뒤 원본 기록을 읽지 않고 다음 행동을 고르게 한다(UC-06, `SCR-BRIEF`). 절 구성은 04 §3.2(ADR A3, 아홉 절)가 정한다.
- 입력: `BriefView`(04 §3.2). 절마다 렌더러가 따로 있다(가정대로 정해진 질문은 "에이전트가 정한 것"과 별도 줄로 펼쳐 두고 각 줄에 [이의 걸기], 판정 J-120): Goal과 바뀐 기준, 바뀐 것(N/E/M 각 `ChangeGroup` 최대 5 + 접힘), 평가, 선택 필요(`QuestionCard` 접힘), 확인하면 좋은 것, 진행 중 작업(`ActiveWorkCard` 한눈에), 예측과 가장 싼 방향 바꾸기 지점, 에이전트가 정한 것(종류별 개수, 접힘), 지금 읽지 않아도 되는 것(접힘), 복구 n.

```ts
export interface SinceLastVisitProps extends L2Common {
  view: BriefView;                      // 04 §3.2
  meta: ProjectionMeta;
  /** "확인함" → brief.acknowledge { upToSeq: view.coveredTo.seq }. 읽음과 이해 주장을 같게 보지 않으므로 사람이 명시적으로 누른다 (helm-canon-2 §3.10) */
  onAcknowledge: () => void;
  /** 항목 정정 → brief.correct */
  onCorrect: (item: RecordRef, note: string) => void;
  /** compact = 휴대폰(26)의 줄인 보기. 확인 의도에 compact: true를 싣는다(판정 J-137) */
  variant?: 'full' | 'compact';
}
```

- 휴대폰에서 줄여 본 반대 근거·이견 항목은 다음 데스크톱 복귀 요약에 "휴대폰에서 줄여 본 항목" 절로 다시 나온다. 절 내용은 뷰가 준다(판정 J-137, 04).

| 상태 | 표현 |
|---|---|
| 기본 | 절마다 고정 표현 머리말(§3.6.7) + 본문. 각 줄 끝에 출처 칩 |
| 변화 없음 | "마지막 확인(어제 23:10) 이후 바뀐 것이 없습니다" + 진행 중 작업과 다가오는 것만(04 §3.2) |
| 낡음·오프라인 | §3.5.8 띠. 현재 시제 문구를 기준 시각 문구로 |
| 매우 김 | 묶음마다 상위 항목만, 나머지 "n건 더"(접힘). 반대 근거·이의·막는 권리 게이트 질문은 접지 않는다. 막지 않는 권리 게이트(결과 확인 등)는 "결과 확인 n건"으로 접는다(판정 J-132) |

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
| "그 밖에" | 기준 고치기, 질문 다시 쓰기(`question.requestReframe`), 먼저 알아보기(`question.requestInquiry`), 에이전트가 정하게 두기(`question.delegate`, 정보 질문만. 사실 탐구 뒤 방향 선택의 권리 질문은 사람이 맡기기를 명시해 고른 때만, 판정 J-131), 미루기(`question.defer`, `L`), 이의 걸기(`OVL-CONTEST`, `!`). 펼친 카드에서는 보이는 링크 줄, 접힌 카드에서는 "그 밖에" 메뉴(`M`, 05 §3.8.4). 어느 쪽이든 빠지지 않는다(R2) |
| 가정대로 진행 | 정보 게이트에서만(`question.proceedWithAssumption`). 권리 게이트에는 없다(helm-canon-3 §7.1 C10) |
| 권리 질문의 실제 효과 | 권리 게이트 질문은 커널이 정한 구조 값(행동 종류, 대상, 범위, 도구 이름, 인자)을 "실제로 하는 일" 칸에 `ArgsView`로 그리고, 모델이 쓴 설명은 "에이전트 설명" 라벨 아래 다른 칸에 둔다. 두 칸을 한 문단으로 합치지 않는다. 버튼 문구(`actionLabel`)와 구조 값이 다르면 구조 값이 화면에 남는다(11 §3.2에 규칙 요구) |
| 범위 확대 질문(`scope_change`) | `ScopeDiff`로 현재 범위와 요청 범위를 08 `Scope` 칸별(행동 종류 `primitives`, 자원 `resources`, 보낼 곳 `sendTargets`, 예산 `budget`, 기한 `validUntil`, 대상 미리 모름 허용 `allowUnknownTargets`)로 나란히 놓고, 더해지는 값은 `ins`, 빠지는 값은 `del`로 표시한다. 값은 커널이 뷰에 넣은 구조 값만 쓴다. 모델 문장에서 범위를 읽어 내지 않는다(04에 VM 필드 `currentScope`·`requestedScope` 요구). 선택지에 구조화 `scope`가 있으면(판정 J-133) 그 선택지를 펼칠 때도 현재 범위 대비 `ScopeDiff`를 보인다 |
| 답한 뒤 | 명령 결과의 `impact`를 `ChoiceImpactEcho`로. 앱이 영향을 추측하지 않는다(04 §3.4) |
| 허락 행동(권리 게이트) | 허락(`question.answer`, `approve`), 범위 줄여 허락(`narrow_scope`), 하지 않기(`deny`)를 주 버튼에 둔다. 고쳐서 허락(`approve_edited`)은 `ArgsView`의 편집 칸(`editable`)에서 인자를 고쳐 `editedArgs`(blob)와 `editedFingerprint`를 `question.answer`로 보낸다. 원 호출을 닫고 새 호출을 만드는 일은 서버가 한 트랜잭션에서 한다(판정 J-117·J-121). 휴대폰에서는 인자 미리보기만 보이고 고치기는 데스크톱에서 한다(03 §3.12) |
| 웹 내용을 본 뒤의 `send` | 웹 내용을 본 run(`taint.web`)의 `send`는 합의가 허용해도 사람에게 묻는다. 승인 카드에 글자 "웹 내용을 본 뒤의 요청"을 보인다(18 §3.12 11번, [판정 J-190]). 색만으로 표시하지 않는다(UP-4) |
| 미루기 시각 경고 | 미루기 시각 선택지가 질문의 만료점보다 늦으면 고르기 전에 "만료점이 미룬 시각보다 먼저 옵니다. 그때 임시 가정이 확정됩니다."를 보인다(11 Q-E19, 05 §3.1.5). 권리 게이트면 "그동안 이 작업은 멈춰 있습니다"를 함께 보인다. 경고 여부는 VM이 준다(§5.3 04). 부품은 시각을 비교해 판정하지 않는다 |
| 정하면 생기는 일 | 답하면 함께 확인되는 판단(`bundledFinding`)이 있으면 "판단 n도 확인됨"을 같은 자리에 보인다. 이 판단 확인은 선택이 확정되는 같은 조작으로 닫힌다(14 §3.13.7) |

| 상태 | 표현 |
|---|---|
| `pending`/`delivered` | 기본. 머리에 화면 종류 라벨(03 §3.2.4)과 전달 방식·시각 |
| 만료점 가까움(`expires.approaching`) | 머리 경고 색 "만료점이 가까워 지금 전달했습니다 · 약 10분 남음" |
| 즉시로 승격됨 | 전달 칸 "협상 → 즉시(만료 임박)" |
| `assumed` | "답이 없어 09:00에 임시 가정대로 정해졌습니다" + 이의(04 §3.0.5) |
| 이미 처리됨, 철회, 찾을 수 없음, 낡은 기준 거부 | 04 §3.0.5 문장. 쓰던 답 유지 |
| 묶음 모드 | 질문을 차례로 쌓고 맨 아래 "고른 대로 보내기". 질문마다 의도를 따로 보낸다 |

`ArgsView`와 `ScopeDiff`는 승인·권리 질문, 작업 합의(`WorkAgreementDraft/Echo`), 실행 출처(`SourceTrace`)가 같이 쓰는 L1 부품이다. props는 §3.7.2 `helm/props.ts`에 둔다. 이 절에는 동작 규칙만 적는다.

- 인자는 잘린 채 보이지 않는다. 잘렸으면 머리에 "잘림 · 전체 n바이트"와 [전체 인자 보기]가 있고, 전체 보기는 `BlobRef`를 받아 같은 규칙으로 그린다. 잘린 인자의 허락 버튼(`approve`·`approve_edited`)은 전체 보기를 연 뒤에만 켜진다(04 질문 뷰의 `truncated` 규칙, 18 T18-38).
- 보이지 않는 문자는 코드 포인트로 바꿔 보인다: 제어 문자(U+0000~U+001F 중 탭·줄바꿈 제외, U+007F~U+009F), 양방향 제어(U+061C, U+200E, U+200F, U+202A~U+202E, U+2066~U+2069), 영폭 문자(U+200B~U+200D, U+2060, U+FEFF). 각각 `U+202E` 같은 고정폭 칩으로 그리고, 하나라도 있으면 머리에 "보이지 않는 문자 n개"를 경고 색으로 둔다. 같은 규칙을 경로와 URL에도 쓴다.
- 비밀 가림은 13·18의 마스킹기가 한다. 부품은 가린 자리를 "가림" 칩으로 그리고 값을 추측하지 않는다.

키보드: 카드 포커스에서 Space 펼침, Tab으로 버튼, 답 입력은 ⌘/Ctrl+Enter 제출. 결정에는 한 글자 단축키를 두지 않는다(§3.6.5). 접근성: 카드는 `article`, 제목은 질문 문장, 화면 종류 라벨이 제목 앞에 읽힌다("선택 필요, 질문 15: …").

##### (4) `QuestionInbox` 질문함

입력: `InboxView`(04 §3.3). 전달된 질문(데몬 정렬, 앱은 순서를 바꾸지 않음), 묶음, 곧 전달될 것, 최근 답한 것. 목록은 `VirtualList`. 행을 고르면 오른쪽에 펼친 `QuestionCard`(04: 행 선택 = 오른쪽에 `SCR-QUESTION`).

- 막는 권리 게이트 질문(작업이 멈춘 선택 요청, 합의 확인, 복구 선택)은 개수와 상관없이 모두 보인다(helm-canon-3 §7.1 C3). 막지 않는 권리 게이트 질문(결과 확인, Goal 확인)은 기록을 즉시 하고 전달은 다음 작업 경계나 검토 창에 하며, 홈에서는 접고 개수를 보인다(판정 J-132, 03 §3.2.4). 만료(사람이 정한 마감)가 임박한 막지 않는 권리 게이트는 `interrupt`로 올린다. 만료 임박 승격만 J-132의 예외다 [결정 64]. 홈 주의 카드의 기본 펼침 개수는 다이얼이 아닌 설정 `maxVisibleDecisions`(14 §3.10, 11 "화면 표시 수", 기본 3)이며 정보 질문과 막지 않는 권리 게이트 질문에 적용한다. 부품은 이 값을 prop `initiallyVisible`로 받는다.
- 키보드: J/K 행 이동, Enter 오른쪽 카드로 포커스(04 §3.3). 묶음 행 Enter = 묶음 모드.
- "다른 기기에서 답함" 행은 2초 뒤 최근 답한 것으로 옮긴다(04 §3.3). 옮길 때 포커스가 그 행에 있으면 다음 행으로 옮긴다.

##### (5) `ChoiceImpactEcho`

선택 직후 "이 선택으로 바뀐 것"(바뀐 작업 합의, 다시 확인할 레코드, 다시 볼 조건)을 보인다(helm-canon-2 §3.7). 데몬이 보낸 결과 투영을 그린다. 화면이 추측해 만들지 않는다. 함께 확인되는 판단이 있으면 "판단 n도 확인됨"을 목록 끝에 둔다.

```ts
export interface ChoiceImpactEchoProps extends L2Common {
  choice: RecordRef;
  changed: Array<{ text: string; records: RecordRef[] }>;
  invalidated: RecordRef[];             // 다시 확인 대상이 된 합의·투영
  reviewTrigger: string | null;
  /** 이 선택과 함께 확인되는 판단(04 QuestionView.bundledFinding). "판단 n도 확인됨"으로 보인다(14 §3.13.7) */
  bundledFinding?: RecordRef;
  onDismiss: () => void;
}
```

##### (6) `AutonomousChoiceList` 에이전트가 정한 것

입력: `AutonomousView`(04 §3.5). 종류별 묶음(루프, 상황 판정, 구조, 가정 확정, 라우팅, 진입, 선택)과 처리 중인 이의(`openContests`).

- 항목 한 줄: 무엇을 정했나, 묻지 않은 이유(`whyNotAsked`, 필수). 펼치면 대안·이유·다시 볼 조건·관련 질문·의존 수(`dependents`).
- 행동: 이의(`!`, `OVL-CONTEST` → `objection.file`), 봤음(`S`, `autonomous.markSeen`), 모두 봤음, 이대로 둔다(`decision.confirm`, 항목 또는 고른 항목 묶음). "봤음"은 열람 표시이고 "이대로 둔다"는 사람이 그 결정을 확인한 기록이다. 둘 다 이의를 걸 권리를 남긴다는 문장을 버튼 툴팁에 둔다(04 §3.5). 항목 단위 "봤음"은 19 `autonomous.markSeen` params에 항목 목록(`targets`)이 필요하다(§5.3). "봤음"을 누르라고 재촉하는 표시(빨간 개수 등)를 쓰지 않는다.
- 변형 `variant: 'full' | 'summary'`: `summary`는 휴대폰(26)과 복귀 요약 안에서 쓰며 종류별 개수와 항목 한 줄만 보이고 항목별 [봤음]을 두지 않는다. 이의와 "전체 보기"(데스크톱 `SCR-AUTO`로 이동)만 둔다.
- 처리 중인 이의는 맨 위 고정 구역에 둔다. 화면에서 사라진 이의 수가 0이어야 한다(v0.3 09 §5 Contestability 지표).
- `!`, `S`는 대화상자를 열거나 관찰(봤음)을 남기는 키라 §3.6.5의 "결정에는 한 글자 단축키 없음" 규칙에 걸리지 않는다. 이의 자체는 대화상자에서 버튼으로 보낸다.

##### (7) `WorkAgreementDraft`, `WorkAgreementEcho` 작업 합의

입력: `AgreementView`(04 §3.11). `WorkAgreementDraft`는 `SCR-AGREE`에서 에이전트가 만든 합의 초안을 보이고 사람이 칸별로 고치거나 반응한다(UC-07, helm-canon-3 §6.6.4). `WorkAgreementEcho`는 확정된 합의를 짧게 다시 보여 준다(helm-canon-2 §3.12 echo 형식: 결과, 할 수 있음, 할 수 없음, 제출할 근거, 멈출 때).

- 빈 양식으로 시작하지 않는다(UP-7, R5). 초안 전체를 `DraftMark`로 감싸고, 사람이 고친 칸은 "내가 고침"으로 바뀐다.
- 이전 합의보다 넓어진 칸(`widenedFromPrevious`)은 칸 옆에 "범위가 넓어짐: 이전 …"을 보인다. 넓어짐 판정은 데몬이 한다.
- 에이전트의 이해 재진술(`restatement`, check-back, helm-canon-3 G1)을 맨 위에 두고 "이해가 다름" 행동(`agreement.correctUnderstanding`)을 붙인다.
- 집행 수준(`enforcement: 'advisory'`)이면 머리에 "이 런타임에서는 맡긴 범위가 권고이며 강제되지 않습니다"를 항상 보인다(helm-canon-2 §3.13).
- 맡긴 범위 상세(`rangeDetail`, P04 §1 여덟 항목)는 검토 깊이에서. 권한 레이어 출처 항목은 `ShieldCheck`.
- 합의 카드의 주 내용은 커널이 가진 구조화된 값(경로, 명령, 네트워크 허용 여부)이고, 모델이 쓴 요약은 보조 줄이다(18 §3.x 요구, 04). 보장 수준(`EnforcementBadge`)과 실행 격리 수준(`SandboxBadge`)을 범위 칸 옆에 둔다(13).
- 합의 카드의 경고 구역은 합의 뷰의 경고 키 `warnings`를 문구 키로 그린다. 예: `network.proxy_fallback_ask`는 프록시 경로를 쓸 수 없어 네트워크를 쓰는 실행마다 사람 허락을 받는다는 뜻이다(13 §3.5.3, 판정 J-134). 경고는 범위 칸 옆에 두고 접지 않는다.
- 모델 제공자 구역: 이번 작업이 쓰는 모델 제공자를 작업 에이전트와 검증 에이전트별로 나열한다(04 §3.11). 화면 이름은 "모델 제공자", 코드는 `provider`다(판정 J-150).
- 행동: 이 합의로 맡기기(`agreement.confirm`, `consequence`에 범위 요약), 범위 줄여 진행(`agreement.narrow`), 칸 고치기(`agreement.revise`), 맡기지 않기(`agreement.decline`).
- "범위 줄여 진행"은 범위 칸의 구조 값 편집으로 받고 자연어로 받지 않는다: 허용 대상(경로·자원) 목록에서 빼기, 금지 행동 더하기, 멈출 조건 더하기. 편집 결과를 좁힌 `Scope`로 보낸다. 자연어 메모는 보조다. 19의 `agreement.narrow` params에 구조화 `Scope`가 필요하다(§5.3). 메서드 → 커널 명령 대응(상태 `proposed`면 확정+고침, `active`면 재협상)은 19 §3.7.1이 정본이다

##### (8) `ActiveWorkCard` 진행 작업 카드

입력: 04 §3.1의 `ActiveWorkCard` 타입(같은 이름). 줄 구성은 04 §3.0.7(지금 하는 일, 이 일을 하는 이유, 다음 단계, 맡긴 범위 + 집행 수준, 도움이 필요한 조건, 마지막 중요한 변화, 활동 요약, 예산).

- 항상 가능한 행동: 방향 바꾸기(`work.steer`), 기준 바꾸기(`SCR-AGREE`로 이동), 범위 줄여 진행(`agreement.narrow`), 안전하게 멈추기(`work.pause`), 요약 요청(`work.requestBrief`), 근거 보기, 작업 중단(`work.stop`, 위험 버튼. 확인 창의 버튼은 대상을 쓴 "WorkUnit 31 중단하기", `consequence`에 "진행 중인 실행을 멈추고 이미 생긴 변화를 보고"). 즉시 중지(`work.abort`)는 감사 깊이 메뉴에만 두고 결과 문장("작업 공간이 복구 필요 상태가 될 수 있습니다")을 버튼에 쓴다. 멈춤·중단·즉시 중지의 차이를 숨기지 않는다(helm-canon-2 §3.11).
- `enforcement: 'advisory'`면 맡긴 범위 줄에 "권고만"을 항상 보인다. run의 성질별 보장 수준은 `EnforcementBadge`, 실행 격리는 `SandboxBadge`로 보이고 `S0`이면 "격리 없음"을 항상 보인다(13 §3.11.5, §3.6).
- 에이전트 루프 상태(생각 중, 도구 실행 중)를 "생각 중" 문구나 애니메이션으로 그리지 않는다. `doingNow` 문장(의미 상태 언어, 05)을 그대로 쓴다(UP-9).
- 예산은 SVG 막대 + 글자("하위 호출 12/30 · 40분/2시간"). 단위는 14·12.

##### (9) `ToolActivityLine`

도구 실행을 한 줄로 압축한다. 예: "작업 · 원인 후보 비교 / 파일 4개 읽음 · 검색 2회 · 실제 변화 없음"(helm-canon-2 §3.11). 항상 따로 한 줄로 보이는 7종: 실제 변경 시작·완료, 외부·공유 효과, 권한 거부, 판단을 바꾸는 테스트 근거, 추천을 바꾸는 반대 근거, 지켜야 할 조건 충돌, 비용·시간·위험 임계 초과. 외부 조회(`web_fetch`·`web_search`, [결정 55])는 `reads`·`searches`에 세고 줄 글자에 "외부"를 붙인다(예: "외부 검색 2회"). 가져온 내용(웹 결과 본문, 브라우저 출력)은 신뢰하지 않는 외부 내용으로 그린다(E21, 18 §3.12 7번).

```ts
export interface ToolActivityVM {
  summary: { reads: number; searches: number; executes: number; writes: number; materialChange: boolean };
  alwaysShow: Array<{ type: 'material_change' | 'external_effect' | 'permission_denied' | 'finding_test' | 'counterevidence' | 'boundary_conflict' | 'threshold'; text: string; record?: RecordRef }>;
  calls: Array<{ toolCallId: Id; tool: string; trace: SourceTrace }>;   // 감사 깊이
}
```

##### (10) `MaterialChangeGroups`

실제 변화(M)를 묶음 카드로 보인다. 입력은 `ChangeGroup[]`(04 §3.2, 세계별 최대 5묶음 + 나머지 접힘, helm-canon-2 §8.2·§8.7). 묶음 기준은 데몬 투영이 준다(Concern·WorkUnit·선택 영향. 경로 기준이 아님). 묶음 카드: 제목, 변경 수, 묶은 이유(`why`), 펼치면 항목 칩과 `SourceTrace`. 접힌 묶음의 이름을 "그 밖에"에 보존한다. 변경 목록에 git 설정 파일(`.gitattributes`·`.gitmodules`·`.git*`)이나 새 `.git` 디렉터리가 있으면 그 항목을 "주의 항목"으로 접지 않고 보인다. 문장은 "git 설정 파일이 바뀌었습니다: (파일). 다음 git 실행에 영향을 줄 수 있습니다"다(04 §3.12).

##### (11) `ResultReviewPanel` 결과 확인 2단계

입력: `ReviewView`(04 §3.12). 1단계 결과 확인(Acceptance), 2단계 전체 반영(Integration)을 한 패널의 두 단계로 나눈다(helm-canon-3 §6.6.7). 결과 확인은 사람만 한다(v0.3 07 §2.4).

- 기준 행(`ResultCriterionRow`): 판정 기호(✓ 확인됨 / △ 일부 / ✗ 충족 못함 / ? 확인 못함)를 글자 라벨과 함께 쓰고, 근거 `StatementView` 칩, 낮춰진 이유(`downgradedReason`), 취향형이면(`tasteMode`) 사람의 판정 칸(`humanJudged`: 맞음 / 아님 / 모르겠음).
- 고정 표현 여섯 칸(확인된 것, 확인하지 못한 것, 남은 제한, 반대 근거, 전체 영향, 다시 확인할 조건)은 `sections`를 그대로 그린다.
- 독립 검증(`verification`)이 있으면 "검증 에이전트" 역할과 "다른 모델" 여부를 보인다.
- 1단계 행동(결과 확인 다섯 가지, 04 §3.12·05 §3.4.1): [결과 확인](`result.accept`, `decision: accept`), [조건 붙여 확인](`result.accept`, `decision: accept_with_conditions`, 조건 입력 필수. 조건 항목은 같은 트랜잭션에서 미룬 반영 항목이 된다, 판정 J-125), [수정 요청](`result.accept`, `decision: request_changes`, 기준 고르기와 자연어 메모). 그 밖에 줄에 [거절(해결 안 됨)](`result.accept`, `decision: reject`, 직전 I가 있으면 `reopenTo`를 기본으로 채우고 없으면 같은 행에서 고른다, 판정 J-24)과 [기준이 틀림](`result.accept`, `decision: criteria_wrong`, `reopenTo`는 I.fact 또는 I.want)을 둔다(판정 J-123, J-170). 값은 10 명령 값이고, 기록 값(08 `accepted`·`conditional`·`revision_requested`·`rejected`·`criteria_wrong`)과의 대응은 판정 J-35다. 버튼 이름은 05 문구 키를 쓴다(거절 버튼은 "거절(해결 안 됨)", 판정 J-170). 반대 근거가 남아 있으면 확인 버튼 옆에 "남은 반대 근거 1건"을 둔다(막지는 않는다. 판정은 사람 권리). 확인 못한 기준이 있으면 `consequence`에 "확인하지 못한 기준 1개를 남긴 채 확인".
- 반영 범위 합의(`integrationAgreement`, 판정 J-126): 에이전트가 결과 제출 때 만든 초안을 결과 확인 패널에 구조 값(대상, 허용 행동, 멈출 조건)으로 접지 않고 보인다. 결과 확인(accepted·conditional)과 함께 확정된다.
- 휴대폰(26)에서 같은 부품을 쓸 때: 산출물(본문·그림·변경 요약)을 연 뒤에만 [결과 확인]이 눌린다. 큰 산출물과 취향형 결과(`tasteMode`)는 휴대폰에서 확인 버튼 대신 미루기만 보인다(판정 J-139). 부품은 `surface: 'phone'`과 `outputsViewed`를 prop으로 받고, 판단은 뷰 값 `mobileReviewable`(04 §3.12, 판정 J-174)을 따른다. `mobileReviewable`이 거짓이면 확인 버튼을 그리지 않는다.
- 가벼운 작업 결과를 묶어 확인할 때(판정 J-132)도 같은 네 버튼을 쓴다. 간단판이라도 [결과 확인]·[수정 요청]과 "그 밖에"를 둔다(§3.9 R2).
- 승인됐지만 실행하지 않은 행동: 승인 대기 호출이 남은 채 결과가 제출되면 그 행동을 "승인됐지만 실행하지 않은 행동"으로 접지 않고 결과 확인 화면에 보인다. 그 뒤 온 승인은 실행하지 않는다(14 §3.12.3 F32, 04 §3.12 요구).
- 결과 확인 알림: 휴대폰 알림 방식(`notifications.resultReview`, [결정 56], 판정 J-189: 기본값 `none`)은 설정 값이다. 데스크톱은 결과 확인 대기를 배지로만 알리고, 데스크톱 OS 알림은 `notifications.resultReview`가 `immediate`일 때만 띄운다 [결정 60]. 알림에서 열린 결과 확인 화면도 이 부품을 같은 방식으로 쓰며, 알림 방식은 화면 구성을 바꾸지 않는다.
- 2단계: 점검 일곱 칸(`obligations[].checkpoint`, 04 §3.12)별 반영 항목 체크 목록. 행동: 처리됨(`obligation.confirmDone`), 미루기(`obligation.defer`), 다른 Concern으로 넘기기(`obligation.transfer`). `completeAllowed`가 참일 때만 `WholeUpdateBadge`가 "완료"를 그린다(UP-5). 원천의 Integration Map은 그래프로 그리지 않고 이 목록으로 대신한다(§2.3).

##### (12) `EvidenceInspector` 근거 인스펙터

선택한 판단·선택·결과·근거 하나의 근거 관계를 `RGN-INSPECTOR`에 보인다(helm-canon-3 §6.6.6). 넓게 보려면 `SCR-EVIDENCE`로 연다(03 §3.5.1). 입력은 `EvidenceChainView`(04 §3.15). 본체는 `EvidenceChainTree`(§3.8.1)이고, 머리에 `KindLabel`, `QualityBadge`, `CertaintyDescriptor`, 아래에 "이것이 바뀌면 다시 열리는 것"(`reopensIfChanged`)과 아직 모르는 점, 원본 위치를 둔다. 같은 모델·같은 컨텍스트에서 나온 근거는 "같은 출처 계열"로 묶어 표시한다(helm-canon-3 G7). 인스펙터 탭: 근거, 출처, 작성자·권한, 관련, 원본(감사 깊이).

##### (13) `SemanticPreview` 의미 미리보기

자연어 입력이 무엇으로 기록될지 데몬이 제안한 것을 보이고, 차이가 큰 부분만 확인받는다(helm-canon-3 §7.2 G13, helm-canon-2 §3.6). 사람이 이벤트 종류를 직접 고르게 하지 않는다.

```ts
import type { SemanticPreviewResult } from '@helm/protocol';   // 19 composer.preview 결과 (1단계 21 SemanticPreviewVM과 같은 모양)
export type SemanticPreviewChoice = { interpretationId: string } | { asChat: true };
export interface SemanticPreviewProps extends L2Common {
  vm: SemanticPreviewResult;
  /** composer.submit에 utteranceDraftId와 고른 해석을 함께 보낸다 */
  onChoose: (c: SemanticPreviewChoice) => void;
}
```

`impact="low"`인 해석만 있으면 미리보기를 띄우지 않고 보낸 뒤 짧은 반향("외부 배포를 금지했습니다 · 되돌리기")을 보인다. `high`가 있으면 입력창 위에 해석 카드를 띄우고 "이렇게 기록" / "그냥 대화로" / 고쳐 쓰기를 둔다. 원천 규칙(명확한 지시는 반향, 모호·고영향은 확인)을 따른다.

##### (14) `DialPanel` 다이얼 패널

입력: `DialsView`(04 §3.17). 현재 모드(누가 골랐는지, 이유, 중심 루프, 능력 켜짐/꺼짐, 이의), 다이얼 목록(값, 선택지, 어느 설정 층에서 온 값인지 `sourceLayer` 1~6, 바꿀 수 있는 범위, 루프별 값).

범위와 노출: 다이얼 값은 `DIAL_DEFS`(14 §3.11.2, 데이터는 `@helm/domain`)를 읽어 그린다. 바꿀 수 있는 범위는 user·Concern·지시 셋이며 Goal 범위는 없다(판정 J-136). MVP는 노출 여섯 개(기본 전달 방식, 질문 빈도, 예산, 자극 수, 탐구 깊이, 계획 작성 방식)만 그리고, 나머지는 시스템 기본값과 층 2·3 값으로 동작하며 화면에서 바꾸지 않는다. 2단계에서 열여섯 개를 모두 노출한다(14 §3.11.1). 루프 계획 방식 `planAuthoring`(결정 53, 판정 J-188)은 MVP 노출 여섯째 다이얼이다. 전역 기본값은 MVP 설정 화면(`SCR-SETTINGS`)에서 고르고, Concern별 값은 이 패널에서 바꾼다([결정 53], [판정 J-192]).

- 이산 값은 `SegmentedControl`, 숫자 범위 값은 숫자 입력(단위 표시)으로 그린다. 슬라이더를 쓰지 않는다(정확한 값과 키보드 조작이 낫다).
- 값마다 층 표시("이 Concern에서 바꿈", "모드 기본값", "시스템 기본값", v0.3 07 §6)와 "에이전트가 지금 하던 단계를 마친 뒤 반영" 안내(05 §3.10.8 화면 표기). 변경은 `dial.set`, 되돌리기는 `dial.unset`(위 층 값으로), 모드 변경은 `mode.set`.
- 접힌 안내 "다이얼이 바꾸지 못하는 것"(불변조건 1~7, v0.3 07 §7).
- 모드를 라우터가 골랐으면 "자동 선택 · 이의" 표시.

##### (15) `RecoveryList` 복구

입력: `RecoveryView`(04 §3.20). 재시작으로 중단된 WorkUnit과 결과를 모르는 외부 행동(helm-canon-3 G11, 조정자 기본값 30). 항목: 마지막 확인 지점, 중단된 도구와 요약, 다시 실행해도 안전한지(`rerunSafe`와 판정 출처: 도구 선언 / 권한 레이어), 외부 효과 여부(없음 / 있을 수 있음 / 일어남 / 모름), 가능한 행동. 행동은 `recovery.resolve`로 보내며 버튼 문구는 결과를 말한다: "마지막 확인 지점부터 다시 실행", "그대로 두기", "다시 계획", "확인 작업 만들기", "일어났다고 기록", "일어나지 않았다고 기록", "되돌리기"(helm-canon §17.6 §4). `rerunSafe: 'unsafe' | 'unknown'`이면 "다시 실행" 버튼에 `consequence`로 이유를 쓴다. 데몬이 읽기 전용(19 `readOnly`)이면 모든 버튼을 막고 이유를 보인다.

##### (16) `ObserverProposalCard` 관찰 에이전트 제안, `MetricTile` 평가 지표

`ObserverProposalCard` 입력: `ObserverProposalsView.proposals[]`(04 §3.18). 관찰 에이전트(조정자 기본값 35, 16)는 쓰기 권한이 없으므로 카드는 "제안"이다. 카드: 찾은 반복 패턴, 근거(세션 출처: Helm·pi·Claude Code·Codex, 기간, 횟수, 추정 절감과 계산식), 바뀌는 것(컨텍스트·합의·정책), 초안(마크다운 또는 변경 비교, 원시 HTML 끔), 주의 사항(주입 의심 경고 포함, 16 §3.24), 채택 뒤 효과(전·후 값). 행동: 채택(`observerProposal.adopt`), 고쳐서 채택, 기각(`observerProposal.decline { reason, scope }`, 사유 하나 고르기는 04 §3.18 선택지(이미 해결함 / 우연 / 원하지 않음 / 직접 하겠음 / 비용이 큼 / 기타)와 "이 종류는 다시 보지 않기"(`scope: "this" | "family_forever"`). 값 이름은 04·16이 정한다), 나중에(`observerProposal.snooze`). 기각 사유 고르기는 분류 입력이라 §3.9 R4의 단일 선택 부품 제한에 걸리지 않는다(`composites/rules/` 폴더).

`MetricTile` [제안, 16 §3.24 요구]: 평가 화면(`SCR-METRICS`, 03 §3.6)의 지표 하나. 값, 분자/분모/표본 수, 창(예: 14일), 정의 버전, 검토 신호(초기 가설값임을 표시), 14일 추세(일일 스냅샷 SVG 선, 점마다 접근 가능한 값), 근거 이벤트로 내려가기. 값의 좋고 나쁨을 색만으로 표시하지 않고 "검토 신호: 기준 0.2 초과" 같은 문장으로 쓴다. 점수·순위·연속 기록 표시는 쓰지 않는다.

##### (17) `DegradedBanner`

`RGN-BANNER`에 저하 상태를 띠로 보인다. 원천의 네 가지(helm-canon-2 §3.13)와 04 §3.0.4의 연결 상태를 합친다. 문구는 04·05.

| 종류 | 띠 내용 | 화면 동작 |
|---|---|---|
| 서버 응답 없음, 읽기 전용 | Helm 기록에 쓸 수 없어 결정이 막힘, 대화 초안은 보존. 읽기 전용은 사유별 문장(디스크 부족, 체인 검사 실패, 투영 갱신 반복 실패 `projection_fault`(판정 J-129) 등, 17·19 `readOnly` 사유) | 결정 버튼 비활성. 사람이 할 일이 있으면 [복구 선택 열기](`SCR-RECOVERY`) |
| 어댑터 능력 없음(맡긴 범위 권고 수준) | 맡긴 범위가 강제되지 않음 | `ActiveWorkCard`·`WorkAgreementDraft`에도 표시 |
| 뷰 낡음 | §3.5.8 | 읽기 가능, 그 화면 결정 막음 |
| 외부 결과 불확실 | 시간 초과를 실패로 단정하지 않음, 확인 작업 생성됨 | 해당 작업 카드 연결 |
| 연결 끊김, 인증 실패, 버전 불일치 | 04 §3.0.4 표 | 결정 막음, `SCR-CONNECT` 링크 |

한 번에 하나만 보이고 나머지는 "그 밖에 2건"으로 접는다(03 §3.4.1). 화면을 가리는 모달로 띄우지 않는다.

#### 3.7.4 셸 부품 [제안]

| 부품 | 목적 | 핵심 props | 키보드 | 접근성 |
|---|---|---|---|---|
| `WindowHeader` | 창 머리. 명령 팔레트 진입, 지표 셋 | `pending: PendingQuestionsVM`, `connection: ConnectionVM`(§3.8.5), `meta: ProjectionMeta`, `path: RecordRef[]`(위치 경로), `onOpenPalette` | ⌘/Ctrl+K | `banner` 영역 |
| `NavRail` | 최상위 이동 | `items: Array<{ screen: ScreenId; label; icon; count?: { value: number; kind: 'rights' \| 'info' \| 'neutral' }; dot?: boolean }>`(03 §3.5.2 순서. `dot`은 "에이전트가 정한 것"의 새 항목 표시로 숫자를 그리지 않는다), `current`, `collapsed` | ⌘/Ctrl+1~7, ↑/↓ | `nav`, `aria-current="page"` |
| `ScopeBar` | `RGN-STATUSLINE`: Goal · Concern · 모드 · 지금 하는 일 · 맡긴 범위 · 다음 멈춤(helm-canon-2 §3.5) | `goal?: RecordRef`, `concern: RecordRef`, `statusLine: ConcernView['statusLine']`, `loop?: string`(03 §3.3.7 식별자) | 칩마다 Enter 이동 | `nav aria-label="현재 범위"` |
| `Inspector` | 오른쪽 상세. 탭: 근거, 출처, 권한, 관련, 원본 | `subject?: RecordRef`, `tab`, `pinned`, `width` | ⌘/Ctrl+I 열고 닫기, Esc 닫기(시트일 때) | `complementary` |
| `ScopedComposer` | 현재 범위에 묶인 자연어 입력 + `SemanticPreview` | `scope: { kind: 'global' \| 'goal' \| 'concern' \| 'workUnit' \| 'question'; ref?: RecordRef }`(03 §3.4.1), `placeholderKey`, `draft`, `onDraftChange`, `preview?: SemanticPreviewResult` | ⌘/Ctrl+Enter 보내기, `/` 포커스(입력 밖에서), IME 규칙 | 입력의 라벨에 범위 이름 포함("Concern ‘블로그 방향’에 말하기") |
| `ActiveRunDrawer` | 진행 중 실행 요약 서랍. Goal ▸ Concern 트리로 묶어 보이고(03 §3.4.1, `role="tree"`, `ConcernTree`와 같은 키보드), 에이전트별 토큰 스트림 없음 | `works: ActiveWorkCard[]`(04 §3.1), `exceptions: RecordRef[]`, `open` | ⌘/Ctrl+J | `region`, 갱신은 §3.6.8 규칙 |
| `CommandPalette` | 이동, 레코드 찾기, 표시 조작 | `commands: Command[]`, `search(query): Promise<RecordRef[]>` | ⌘/Ctrl+K, ↑/↓, Enter | `combobox` + `listbox` |

```ts
export interface Command {
  id: string; label: string; group: 'navigate' | 'view' | 'record';
  shortcut?: string;
  /** 명령 팔레트에서 결정 의도를 보내지 않는다. 결정이 필요한 명령은 해당 카드로 이동만 한다 */
  run: () => void;
}
```

- 셸 부품은 데스크톱 전용이며 `apps/desktop/src/ui/shell/`에 둔다(§3.13). 재질: `WindowHeader`·`NavRail`·`ScopeBar`·`ActiveRunDrawer`·`ScopedComposer`의 띠는 `glass-chrome`, `CommandPalette`는 `glass-overlay`. 크롬 안의 글자는 본문·보조·`text-tertiary-on-glass`만 쓴다(§3.2.2).
- `ActiveRunDrawer` 머리의 진행 중 표시(`AgentActivityIndicator`, §3.14.4)는 진행 중인 run이 하나 이상일 때만 움직이고, "진행 중 2"처럼 글자가 항상 함께 있다.

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
  preview?: SemanticPreviewResult;
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
  at: IsoTime; author: Author;
}
```

### 3.8 시각화 [제안]

시각화 부품은 `ui/viz/`에 둔다. 공통 규칙: (1) 문장이 들어가는 구조는 그림보다 목록·트리로 그린다(§2.5.5), (2) 색만으로 관계·상태를 나타내지 않는다, (3) 모든 시각화는 `toLinearText`를 갖는다, (4) 그림이 아닌 표·목록 대체 보기를 따로 두지 않아도 되게 처음부터 목록 구조로 만든다.

#### 3.8.1 근거 체인 `EvidenceChainTree`

판단·선택·결과 확인 어디서든 근거를 따라 내려간다(v0.3 09 §4.7, 원천의 Inquiry Map, `SCR-EVIDENCE`와 인스펙터).

입력은 `EvidenceChainView`(04 §3.15)다. 뷰는 노드를 평탄한 목록(`nodes[]`, `parent`로 연결)으로 준다. 부품은 이를 트리로 바꿔 그린다.

```ts
// packages/ui/src/viz/EvidenceChainTree/buildTree.ts
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
계획  상황 파악 ✓ → 원함 탐구 ✓ → 탐침 ✓ → 지속 관찰 (건너뜀) → 약속 실행 ● → 확인·반영   (에이전트가 정함 · 이의)
실제  상황 파악 → 원함 탐구 → 탐침 → 구조: 나누기 → 원함 탐구 → 약속 실행             계획에 없던 전환 1

10/11 09:02  상황 파악     상황 판정: 복합 (에이전트 판정 · 이의)          산출: 상황 판정 1
10/11 09:10  원함 탐구     자극 6개 · 반응 14 · 기준 후보 3                  주요: 기준 후보 2
10/11 14:05  → 구조: 나누기  이유: '주제'와 '형식'의 선호가 따로 움직임  계기 관찰 31   (에이전트가 정함 · 이의)
             … 그 밖의 기록 14건 (펼치기)
```

- `LoopPlanStrip`: 계획 단계와 실제 경로를 두 줄로. 상태는 기호(✓ 끝남, ● 지금, 빈칸 예정, "건너뜀" 글자)와 글자로 쓴다. 건너뛴 루프에는 이유(`skipped`의 `reason`, 14 §3.8.1)를 바로 옆에 쓴다. 계획에 없던 전환(`planned: false`)을 오류로 표시하지 않고 정보로 표시한다(결정 5). 계획의 작성자(`authoredBy`)가 `model`이면 "모델이 설계한 계획"을, `code`면 "코드가 계산한 계획"을 `AuthorshipMark`로 보이고, 두 경우 모두 이의를 연결한다([결정 53], [판정 J-188]).
- 전환 항목: 출발 → 도착(03 §3.3.7 라벨), 이유, 계기 레코드 칩, 결정 주체, 혼자 정한 것이면 `ContestButton`, 이의 걸렸으면 배지.
- 구간 항목: 루프, 시작·끝, 산출물 종류별 개수(`outputs`), 주요 레코드(`notable`). 산출물 개수는 "무엇이 생겼나" 목록이며 진척 점수로 쓰지 않는다.
- 상황 판정·모드 변화는 같은 목록에 시간 순으로 끼운다.
- 세로 목록(`ol`)이다. 가로 시간 막대 그림을 쓰지 않는다. 한국어 이유 문장이 길고, 시간 간격보다 순서가 중요하기 때문이다.
- `LoopPathMini`: 최근 루프 5개를 칩으로 잇는 한 줄. `ConcernTree` 노드와 `ScopeBar`에서 쓴다.
- 키보드: 목록 화살표 이동, Enter 레코드 열기, 필터 전환 단축키는 05 §3.8. 접근성: 항목마다 "시각, 루프, 내용".

#### 3.8.3 자극 보드 `StimulusBoard`

원함 탐구(I.want, UC-01, `SCR-STIM`)의 반응 입력이다(v0.3 04 §3, 09 §4.6). 화면 배치·뷰 모델은 04 §3.9, 반응 종류·키·요소 고르기·라운드 마치기 흐름은 05 §3.2, 라운드를 닫는 규칙의 정본은 15 `roundClosable`이다. 이 절은 부품 계약과 시각 규칙만 정한다.

입력: `StimulusRoundView`, `ReactionView`(04 §3.9). 자극 내용은 글(`markdown` + 데몬이 나눈 요소 `elements: {id, range}`), 그림(`BlobRef`, 표시 판 `variants`), 링크(요약 + 요소). 요소 단위 반응의 대상은 데몬이 정한 요소 id, 글의 임의 구간(`textRange`, 05 §3.2.3), 그림 영역(정규화 사각형)이다.

```ts
export interface StimulusBoardProps extends L2Common {
  view: StimulusRoundView;              // 04 §3.9
  /** 선택한 자극 또는 요소 (반응 막대의 대상) */
  selection?: ReactionTarget;
  onSelectionChange: (s?: ReactionTarget) => void;
  /** 부분 고르기 모드 (05: E 키) */
  elementMode: boolean;
  onElementModeChange: (v: boolean) => void;
  /** 연결이 없을 때 기기에 둔 반응(보내지 않음). 보존은 20 */
  unsent: ReactionRecordParams[];
  onSendUnsent: () => void;
  /** 15 roundClosable 판정 결과를 뷰가 준다: 정보성 반응이 있는가, pickLike뿐인가 */
  closable: { informative: boolean; pickLikeOnly: boolean; empty: boolean };
}
export interface ReactionTarget { stimulusId: string; element?: string; textRange?: [number, number]; region?: [number, number, number, number] }
/** reaction.record 인자 (05 §3.2.2 ReactionIntent, 19 §3.7.5). 08·15 이름 대응은 05 §3.2.2 */
export interface ReactionRecordParams {
  concernId: string; roundNo: number; stimulusId: string;
  target?: Omit<ReactionTarget, 'stimulusId'>;
  kind: 'strength' | 'no_reason' | 'rewrite' | 'near' | 'triad_odd' | 'comment';
  strength?: -2 | -1 | 0 | 1 | 2;
  reason?: string; rewrite?: string;
  /** 세 개 비교: 사람은 비슷한 둘을 고르고 남은 하나가 different가 된다(08 triad, 15 §3.6) */
  triad?: { triadId: string; similar: [string, string]; why?: string; cannotSay?: boolean };
}
```

부품 규칙:

| 대상 | 규칙 |
|---|---|
| 순서와 라벨 | 뷰가 준 순서와 섞은 글자 라벨(A, B, …)을 그대로 쓴다. 정렬·필터 조작을 두지 않는다. 극단 자극 표시는 하지 않는다. 출처 종류(초안·레퍼런스·사례·비유)와 "다른 분야" 이름은 보인다(05 §3.2.1) |
| 카드 재질 | 자극 카드는 불투명 표면이다(UP-14). 자극 자체의 색·글꼴을 유리 효과가 바꾸지 않게 하려는 것이다. 보드 머리와 반응 막대만 `glass-chrome` |
| 요소 표시 | 부분 고르기 모드(`E`)에서 글의 요소마다 `[a1]` 표시, ↑↓로 요소 이동. 데몬이 요소별 평문 조각을 함께 주면 조각 단위로 감싼다(E9). 마우스로 요소 밖 임의 구간도 끌어 고를 수 있다(`textRange`). 고른 요소는 색과 함께 테두리와 요소 라벨로 표시한다(05 §3.2.3) |
| 그림 영역 | 마우스는 끌기, 키보드는 3×3 격자 칸을 화살표로 고르고 Space로 묶기 |
| 반응 막대 | 강도 다섯 단계(`1`~`5`, 글자 "아주 싫음 / 싫음 / 상관없음 / 좋음 / 아주 좋음" + 기호 −−/−/0/+/++), 이유 없이 아님(`N`), 가깝다 표시(`M`), 고쳐 말하기(`R`), 부분 고르기(`E`), 세 개 비교 띠로(`T`), 이유 칸(`Tab`, 비워도 됨), 마지막 반응 철회(Mod+Z). 키 배정은 05 §3.8.4 |
| 반응 표시 | 하이라이트 배경 + 밑줄 모양(좋음 실선, 싫음 물결, 이유 없음 점선, `--helm-react-*`). 그림은 사각형 테두리 모양 + 번호 |
| 세 개 비교 | 뷰에 `triad`가 있으면 격자 위 띠로. 사람은 "비슷한 둘"을 고르고(두 자극을 차례로 표시), 남은 하나가 "다른 하나"로 표시된 뒤 무엇이 다른지 이유 칸 또는 "말로 못 하겠음"이 열린다(08 `triad.similar`, 15 §3.6). 자극 하나만 누르는 입력은 두지 않는다. 좋은 것을 고르는 동작과 헷갈리기 때문이다. 가장 좋은 것을 묻지 않는다 |
| 비교 반응 | 15가 요구한 "A가 B보다 낫다"(`comparison`)는 두 자극을 끌어 놓는 입력으로 받는다(05 §3.2.2) |
| 기준 후보 | 라운드를 마치기 전에는 보이지 않는다(`revealAfterClose`, 05 §3.2.1 원칙 5) |
| 말한 것과 반응의 차이 | `statedVsRevealed`를 오른쪽 패널에 항상 보인다(v0.3 04 §3.4) |
| 반응 철회 | 지우지 않고 철회 기록(`reaction.withdraw`). 철회된 반응은 취소선 + "철회" |
| 라운드 마치기 | 05 §3.2.5의 상태 기계를 구현한다. 정보성 반응이 있으면 `stimulusRound.close`. 반응이 고르기에 가까운 것(`pickLike`: 가깝다 표시, 이유 없이 "아주 좋음"만)뿐이면 같은 라운드 안에서 선택 단계 하나("가깝다고 한 D에서 어느 부분이 가장 가깝나요?")를 제안하고, 사람이 "그대로 닫기"를 누르면 닫는다. 이때 15 규칙대로 다음 라운드에 세 개 비교가 들어간다고 알린다. 반응이 없을 때도 같은 방식으로 확인 후 닫는다. 입력을 강제하지 않는다(J-34) |
| 연결 끊김 | 반응을 "보내지 않음"으로 받아 두고, 다시 연결되면 "보내지 않은 반응 3개 보내기"를 사람이 누른다(04 §3.9, 이 문서 §3.6.4 예외). 반응은 관찰 기록이라 `basisSeq`가 낡아도 거부되지 않는다(라운드가 닫혔을 때만, 05 §3.2.2) |

반응은 하나씩 바로 기록된다(`reaction.record`). 반응은 관찰이므로 한 글자 단축키를 쓴다(§3.6.5 예외). 단축키는 반응 막대가 대상(자극·요소)을 가질 때만 동작한다. 자극 보드에는 `G`를 쓰지 않는다(05 §3.8.4, 두 키 이동과 겹침).

상태: 기본, 반응 있음, 보내지 않음(오프라인), 마침 확인(화면 안 선택 단계), 라운드 마침(읽기 전용, 기준 후보 공개), 다음 라운드 준비 중, 자극 불러오기 실패(그 카드만 [다시 불러오기]), 멈출 조건 충족 안내(04 §3.9).

접근성: 자극 카드는 `article`, 이름 = 라벨 + 출처 종류. 글 요소는 `mark`로 감싸고 반응 상태를 `aria-describedby`로 읽는다. 반응을 더하면 `aria-live`로 "D, 요소 a1에 좋음". 그림 영역 반응은 "G, 위 왼쪽 영역에 좋음". 이미지 자극은 대체 설명(15가 만듦)을 가진다.

`PreferenceModelPanel` 선호 모델: 입력 `PreferenceModelView`(04 §3.8). 기준(이름, 무게 글자 "높음·중간·낮음"(05 문구 키), 지지 등급 `SupportGradeLabel`, 근거 반응·반대 반응 칩, 확인 여부), 좋았던 예·싫었던 예(자극 칩), 말한 것과 반응의 차이(항상 펼침), 다시 볼 조건. 숫자 무게·확신도는 그리지 않는다(J-19). 근거 반응 수로 강도를 표시하지 않는다(05 §3.2.6). 기준 후보 확인은 질문(`QuestionCard`, 기준 확인: "넣기 / 고쳐서 넣기 / 넣지 않기")으로 하며, 패널에서 후보 문장을 바로 고쳐 쓸 수 있다(빈 칸에서 새로 쓰게 하지 않음).

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
  state: ConnectionUiState;             // §3.6.2, 04 §3.0.4 열여섯 상태(J-196)
  route: { kind: 'wss' | 'ssh'; name: string };   // 기본값 26, 결정 38, 20 §3.8.1 연결 프로필
  lastReceivedAt?: IsoTime;
  retry?: { attempt: number; nextAt: IsoTime };
  versions?: { app: string; daemon: string };
  /** 막힘 사유별 문구와 할 일 (20 §3.8.9). 키체인 거부·SSH 실패·다른 서버도 상태 값이다(J-176). 사유마다 이 문구 키를 받는다 */
  reasonKey?: CopyKey;
  action?: { labelKey: CopyKey; target: ScreenId };
}
```

| 상태(04 §3.0.4) | 창 머리 표시 | 펼침(팝오버) |
|---|---|---|
| 연결됨 | 점 + "연결됨 · <경로 이름>" | 경로, 마지막 수신 시각, 개발자 보기에서 seq |
| 느림 | 점(경고) + "연결 느림" | 원인 문장 |
| 다시 연결하는 중 | 점 + "다시 연결하는 중 · 12초 전 끊김" | 다음 시도 시각, [지금 다시 연결] |
| 다시 맞추는 중 | 점 + "맞추는 중" | — |
| 연결 안 됨 / 데몬 응답 없음 / 인증 실패 / 키체인 접근 필요 / SSH 연결 실패 / 다른 서버 / 버전 불일치 / 읽기 전용 / 안전 모드 | 점(위험) + 상태 이름 | 사유 문구(`reasonKey`)와 할 일(`SCR-CONNECT`, `SCR-RECOVERY`). 안전 모드는 17·19의 `daemon.exitSafeMode` 안내 |
| 뷰 낡음 / 서버 다시 시작됨 / 서버 종료 중 | 점(경고) + 상태 이름 | 뷰 낡음은 §3.5.8의 기준 시점 띠를 쓴다. 나머지는 사유 문구(`reasonKey`)를 보인다 |

점은 장식이고 상태는 항상 글자로 쓴다. 회전 아이콘을 쓰지 않는다(UP-12).

**`PendingQuestionsIndicator` 대기 질문**

```ts
export interface PendingQuestionsVM {
  choiceNeeded: number;                 // 선택 필요(권리 게이트)
  niceToCheck: number;                  // 확인하면 좋은 것
  approaching: number;                  // 만료점 가까움
}
```

창 머리와 레일의 질문함 배지에 "선택 필요 2"(강조 막대, 0이면 숨김)와 "확인하면 좋은 것 3"(보조 글자, 좁은 너비에서는 숫자만 보이고 접근 가능한 이름에 전체 라벨)을 따로 보인다. 만료 임박이 있으면 "곧 만료 1"을 경고 색 글자로 더한다. 누르면 `SCR-INBOX`. 같은 값을 트레이·메뉴 막대(20, `SCR-TRAY`)가 쓴다. 숫자가 늘어도 깜박이거나 소리를 내지 않는다. 알림은 전달 방식에 따라 11·20이 정한다.

**`AttentionBudgetMeter` 주의 예산** — 단위와 창은 14 §3.13.8이 정했다. 단위는 "주의 비용"(§3.13.5 가중치)이고 화면 이름은 "질문"이다. 창은 오늘(타임존 기준 0시부터 다음 0시까지)이다. `limit`은 데몬 설정 `dailyBudget`이며 다이얼이 아니다. 부품은 값의 뜻을 계산하지 않고 받은 값만 그린다.

```ts
export interface AttentionBudgetVM {
  unitLabel: CopyRef;                   // 화면 이름 "질문"(14 §3.13.8, 단위 "주의 비용")
  windowLabel: CopyRef;                 // "오늘"
  used: number;                         // 오늘 전달된 접점 비용 합
  scheduled?: number;                   // 다음 경계에 예약된 질문 비용 합
  limit?: number;                       // dailyBudget(데몬 설정). 없으면 막대 없이 숫자만
  nextBoundaryLabel?: CopyRef;          // "다음 묶음: 라운드 끝"(가장 가까운 예약 경계)
}
```

SVG 막대 하나(사용 / 예약 / 남음 세 칸, 칸마다 글자 라벨과 무늬 차이)와 문장 "오늘 질문 4 / 6 · 예약 2 · 다음 묶음: 라운드 끝". 질문함 머리와 다이얼 화면에 둔다. 점수·연속 기록 같은 게임 요소를 쓰지 않는다(helm-canon §21 01 항목 "게임화 금지"). 막대는 `limit`이 있을 때만 그린다. 남은 칸은 `limit - used - scheduled`(0 미만이면 0)다.

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
- 대비 압축 카드(`ContrastCard`, 05 §3.2.7): 대비마다 "얻는 것 · 잃는 것" 한 줄과 반응 버튼 넷 — "이걸 잃어도 괜찮음" / "이건 잃으면 안 됨" / "모르겠음" / "고쳐 말하기". 대비 중 하나를 고르는 버튼을 두지 않는다. 앞에 보이는 대비 수(`initiallyVisible`)의 기본값은 3이고 나머지는 접히되 펼쳐 반응할 수 있다(14 `frontSize`는 표시 설정이며 05·21이 정함, 14 §U 표). 반응은 `reaction.record`(관찰)로 간다. 정보 가치가 가장 큰 질문 하나는 질문 레코드로 질문함에 들어온다.
- 가능성 행에는 지지 등급(`SupportGradeLabel`)을 보이고, 한 모델 계열로만 발산했으면 탐구 머리에 "같은 모델 계열에서만 나옴"을 보인다(15 `diversity: "single_family"`, 03 §3.3.6).
- 예측 목록: 확인 날짜가 지난 예측은 결과와 함께 위로 올린다(정렬은 뷰).
- 탐구 진행 중이면 갱신은 라운드 경계 단위로 보이고 중간 결과에 "진행 중"을 붙인다(04 §3.8).

### 3.9 대안 고르기 UI를 만들지 않는 규칙 [제안: 규칙 / 결정 18: 원칙]

결정 18은 "대안 2~3개를 던지고 고르게 하는 상호작용"을 거부했다. 원함 탐구에서는 반응을 받고 기록하며, 모델이 초안을 쓰고 사람은 반응·수정한다. 이 원칙이 개별 화면 설계에서 다시 새어 들어오지 않도록 컴포넌트 API와 검사로 막는다.

| 규칙 | 내용 | 강제 방법 |
|---|---|---|
| R1 원함 탐구에는 선택지가 없다 | 원함 탐구에서 온 질문(`origin.inquiry === 'want'`)에서 `QuestionCard`는 추천·다른 선택·`pickOne` 답 형태를 그리지 않는다(04 §3.4). 자극 보드와 대비 카드에는 "가장 좋은 것 고르기" 행동이 없다. 고르기에 가까운 반응(`pickLike`)뿐인 라운드는 사람이 명시적으로 "그대로 닫기"를 눌러야 닫히고, 15 규칙대로 다음 라운드에 세 개 비교가 들어간다(J-34). 1단계의 "가깝다 표시만으로 마칠 수 없음" 가드는 철회했다. 답이 자극·가능성 id를 가리키는 질문(예: `topAfter`에 자극 id를 단 사실 질문)은 커널이 V-Q-03에서 거부하므로 화면에 오지 않는다. 그래도 그런 질문이 오면 `QuestionCard`는 답 칸에 자극 목록을 그리지 않고 개발 모드 경고를 낸다(판정 J-141) | 부품 내부 규칙(뷰에 값이 와도 그리지 않고 개발 모드 경고), 커널 V-Q-03(10·15), 05 §3.2.5 상태 기계. 테스트: §6.3 금지 패턴 테스트 |
| R2 결정 카드의 행동 묶음 | 질문 카드는 주 버튼(최대 3개) 밖에 "그 밖에"(기준 고치기, 질문 다시 쓰기, 먼저 알아보기, 에이전트가 정하게 두기(정보 질문만. 사실 탐구 뒤 방향 선택의 권리 질문은 사람이 맡기기를 명시해 고른 때만, 판정 J-131), 미루기, 이의 걸기)를 항상 둔다. 펼친 카드는 보이는 줄, 접힌 카드는 "그 밖에" 메뉴(`M`)(04 §3.4, 05 §3.8.4). `[승인] [거절]`, `[확인] [계속]`만 있는 버튼 줄을 만들지 않는다. 권리 게이트의 허락 버튼은 대상과 효과를 문구에 쓴다(`OptionView.actionLabel`) | `QuestionCard`가 "그 밖에"를 내부에서 만든다(화면이 뺄 수 없음). 테스트: 결정 의도 버튼만 있고 "그 밖에"가 없는 카드 이야기가 있으면 실패 |
| R3 대안 표시는 순서만 바꾼다 | 대비 압축은 보여 주는 순서만 정한다. 어떤 부품도 `maxOptions` 같은 자르기 prop을 갖지 않는다. `initiallyVisible`은 처음 보이는 개수이고, 나머지는 같은 자리에서 펼쳐 반응할 수 있다. "2개 중 고르세요" 같은 개수 문구를 쓰지 않는다 | 타입(자르기 prop 없음), 문구 테스트 |
| R4 고르기 부품의 사용 위치 제한 | `RadioGroup`, `Select`, 단일 선택 `SegmentedControl`은 설정·다이얼·필터·분류 입력(관찰 제안 기각 사유)에서만 쓴다. 사실 질문의 `pickOne` 답 형태(04 §3.4)는 `QuestionCard` 안의 전용 부품(`AnswerChoices`)으로만 그리고, 이 부품은 `origin.inquiry !== 'want'`일 때만 렌더된다. `ui/viz/inquiry/`, `ui/viz/StimulusBoard/`에서 단일 선택 부품을 가져오면 정적 검사가 실패한다 | `no-restricted-imports` 폴더 규칙(§6.4) |
| R5 초안 먼저 | 사람이 내용을 채워야 하는 부품(작업 합의, Goal 수정, 기준 수정)은 초안이 있는 상태로 열린다. 초안이 아직 없으면 빈 양식 대신 "초안을 만드는 중"과 직접 쓰기 선택을 보인다. 초안은 `DraftMark`로 표시하고 사람이 고친 칸은 "내가 고침"으로 바뀐다 | 부품 계약(`fields`가 비면 빈 상태 렌더러), 이야기 |
| R6 반응을 결정으로 취급하지 않음 | "가깝다 표시"(`near`), 세 개 비교의 답(`triad_odd`: 비슷한 둘과 다른 하나), 강한 좋음(`strength: 2`)은 반응 관찰로만 올라간다. 화면이 이를 선택(Choice)·완료로 표시하지 않는다 | `StimulusBoard`는 반응을 "기록됨"으로만 표시 |
| R7 금지 문구 | "A와 B 중 무엇을 원하시나요?", "어느 쪽이 좋으세요?", "어느 쪽입니까?", "둘 중 하나를 골라 주세요", "계속할까요?", `[승인] [거절]`. 원함 탐구 질문 문장에 "어느 쪽", "둘 중", "중 하나", "고르"가 들어가면 실패(판정 J-141) | 문구 테스트(05·22가 목록 확정) |

허용되는 것: 사실·가능성·결과 탐구 뒤의 결정 질문에서 추천과 가장 강한 다른 선택을 보이는 것(helm-canon-3 §7.1 C2). 셋 비교(레퍼토리 그리드)에서 비슷한 둘을 고르는 것(차이의 이유를 묻는 장치이며 고르기로 라운드를 끝내지 않는다, conversation-extracts-4 6-8 발췌자 메모). 다이얼 값 고르기(설정).

### 3.10 assistant-ui 활용 범위 [제안]

#### 3.10.1 쓰는 곳

| 쓰는 것 | 용도 | 확인 |
|---|---|---|
| `@assistant-ui/react` 0.15.28 primitives(`ThreadPrimitive`, `MessagePrimitive`, `ComposerPrimitive`) | 객체별 대화 스레드(`ConversationThread`)의 구조·키보드·스크롤 | peer `react ^18 \|\| ^19`, MIT. primitives는 "Stable"(3개월 이상 예고 후 폐기) [검색: npm, assistant-ui deprecation policy] |
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
| Elements(Approval card, Timeline, Flow graph, Background runs, Canvas split, Artifact card, Trace waterfall) | 독립 모드로 쓸 수 있고 MIT 소스 복사 방식이다 [검색: assistant-ui.com/elements]. 그러나 (1) 공통 표면이 `tw-shimmer` 반복 애니메이션을 끌어온다(UP-12와 충돌) [검색: r.assistant-ui.com 레지스트리], (2) Helm 유리 재질·토큰과 다른 스타일 체계(shadcn 기본 스타일)로 쓰여 있다, (3) Helm 의미(관계 라벨, 품질 상태, 행동 묶음)를 넣으면 거의 다시 쓰게 된다. 설치하지 않고, 배치를 참고할 때만 소스를 읽는다 |
| reasoning(사고) 파트 | 모델의 사고 텍스트는 근거가 아니다(helm-canon-3 G15). `convertMessage`에서 버린다 |
| 음성, 받아쓰기, 첨부 어댑터 | 1차 범위 밖. 첨부는 19의 HTTP 전송이 정해지면 다시 본다 |

#### 3.10.3 대화 기록 d25의 물음에 대한 답

| 물음(conversation-extracts-4 d25) | 답 |
|---|---|
| Tauri 데스크톱 앱에서 쓸 때의 제약 | primitives와 ExternalStoreRuntime은 Next.js가 필요 없고 Vite SPA에서 쓸 수 있다 [검색: CLI 템플릿, 런타임 문서]. 공식 Tauri 안내는 없고 작은 공개 사례만 있다 [검색: GitHub]. WKWebView의 `overflow-anchor` 미지원은 Viewport의 JS 스크롤로 해결된다. `assistant-cloud` 의존성이 `ai`, `@opentelemetry/*`를 peer로 선언해 설치 경고가 날 수 있다 [검색: npm]. pnpm `peerDependencyRules`로 정리한다(06·20) |
| Background runs가 assistant-ui "run" 개념에 묶이는가 | 독립 모드가 있어 묶이지 않는다 [검색: elements/background-inbox]. 그러나 Helm은 `ActiveRunDrawer`와 `ActiveWorkCard`를 직접 만든다(이유는 위 Elements 행) |
| 요소 단위 반응 UI를 그 위에 만들 수 있는가 | 만들 수 있으나 만들지 않는다. 자극 보드는 상태 화면이고, Interactables를 쓰지 않으므로 얻는 것이 없다. `StimulusBoard`를 직접 만든다 |
| 생성형 UI 컴포넌트를 Helm 카드로 정의할 수 있는가 | 정의할 수는 있으나(어휘 목록, 동작 핸들러) 쓰지 않는다(위 표) |

#### 3.10.4 고정과 교체 가능성

- `@assistant-ui/react`는 정확한 버전으로 고정한다(0.x이고 스타일 부품은 Beta). primitives만 쓰므로 영향 범위가 작다.
- assistant-ui 의존은 `ui/conversation/` 폴더 안에만 둔다. 다른 폴더가 `@assistant-ui/*`를 가져오면 정적 검사가 실패한다(§6.4). 맞지 않게 되면 이 폴더만 직접 구현으로 바꾼다. 대화 스레드는 Helm의 보조 화면이라 교체 비용이 작다(v0.3 13 §2.4).

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
| `SCR-SETTINGS` | 설정 | `SegmentedControl`(테마, 밀도, 계획 작성 방식 전역 기본값 `planAuthoring`[결정 53, 판정 J-192]), 글자 크기, 인스펙터 고정, 모델 제공자 목록(읽기 전용, 04 `SettingsView.providers`[판정 J-150]), 개발자 보기, 단축키 보기 | — |
| `SCR-ONBOARD` | 처음 연결 | `ConnectionIndicator`, 안내 카드(04 §3.22) | UC-04 |
| `SCR-RECORD` | 변화 기록 | `VirtualList` + `DataTable`, `SourceTrace`, `KindLabel` | 감사 |
| `SCR-TRAY` | 메뉴 막대·트레이 | 웹뷰 밖 OS 메뉴(20). 같은 `PendingQuestionsVM` 값을 쓴다 | UC-04 |
| `SCR-METRICS` | 평가 | `MetricTile` | UC-08 |
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

### 3.12 키보드 [05 §3.8이 정본]

키 배정은 05 §3.8(전역, 목록·트리, 화면별)을 그대로 구현한다. 이 문서는 구현 규칙(§3.6.5)과 부품별로 받는 키만 적는다.

| 부품 | 받는 키(05 §3.8) |
|---|---|
| `NavRail`, 셸 | Mod+1~7, Mod+K, Mod+[ / Mod+], Mod+I, Mod+J, Mod+\\, `/`, `?`, `G` 두 키 이동 |
| 목록·트리(`QuestionInbox`, `ConcernTree`, `EvidenceChainTree`, `AutonomousChoiceList`) | `J`/`K`/↑/↓, Enter, Space, →/←, Home/End, `F`, Shift+Enter(인스펙터) |
| `QuestionCard` | Tab(주 버튼 먼저), `L` 미루기 메뉴, `E` 근거 펼치기, `!` 이의, `M` "그 밖에" 메뉴 |
| `AutonomousChoiceList` | `S` 봤음, Shift+S 모두 봤음, `!` 이의 |
| Concern 화면 | `[` / `]` 탭(개요, 탐구, 작업, 이력, 대화), `!` 초점 항목 이의 |
| `StimulusBoard` | 화살표, `1`~`5`, `N`, `M`, `R`, `E`, `T`, Tab, Mod+Z |
| `ActiveWorkCard` | `P` 안전하게 멈추기/다시 시작, `D` 방향 바꾸기, `X` 작업 중단(확인 창 버튼 "WorkUnit 31 중단하기") |
| `ResultReviewPanel` | `E` 근거 펼치기 |
| `SinceLastVisit` | `J`/`K` 또는 `[`/`]` 절 이동 |
| `EvidenceChainTree` | →/← 노드 펼침, `O` 원본 보기 |
| 이의 걸기 창 | Mod+Enter 보내기, Esc 취소(조합 중이면 조합 취소 먼저) |
| 카드 공통 | `.` 깊이 한 단계 올리기 |

단축키는 설정에서 바꿀 수 있다(05 §3.8.1 규칙 7). 부품은 키를 하드코딩하지 않고 키 지도(`keymap`, 20 설정에서 읽어 컨테이너가 넘김)로 받는다.

### 3.13 모바일과 나눠 쓰는 경계 [결정 42 / 제안: 경계, 26과 맞춤]

결정 42로 휴대폰에서 질문에 답하는 모바일 클라이언트가 범위에 들어왔다(데스크톱 MVP 다음 단계). 구현 방식은 26(P15)이 정한다. 이 문서는 토큰과 부품 중 무엇을 플랫폼 중립으로 두는지 정한다. 20 §3.14의 코드 경계 표와 맞춘다. 모바일 열은 PWA를 기준으로 쓴다(결정 47). 네이티브 iOS 경로(26 경로 B)는 Apple 개발자 프로그램이 없다고 보아 이후에 검토하므로([결정 57]), 그때까지 표의 "네이티브 UI를 고르면" 조건은 적용하지 않는다.

| 층 | 패키지 | 내용 | 데스크톱 | 모바일(26이 React 웹 기술을 고를 때) |
|---|---|---|---|---|
| 토큰 | `@helm/ui-tokens`(`packages/ui-tokens`) | 토큰 원본, CSS 변수, Tailwind `@theme`, DTCG JSON, Helm 의미 토큰, 유리·한국어 base CSS(§3.2.8) | 씀 | 씀. 네이티브 UI를 고르면 DTCG JSON만 씀 |
| 표현 부품 | `@helm/ui`(`packages/ui`) | L0 기본 부품, L1 의미 부품, L2 복합 부품과 시각화 중 셸이 아닌 것, `model`(문구는 `@helm/ui-language` 키만 받음, J-103) | 씀 | 씀. 우선 범위: `QuestionCard`, `QuestionInbox`, 답 입력, `ContestButton`, `StimulusBoard`의 반응 막대, `FreshnessIndicator`, `ConnectionIndicator` |
| 데스크톱 전용 | `apps/desktop/src/ui` | 셸(`WindowHeader`, `NavRail`, `Inspector`, `Splitter`, `CommandPalette`, `ActiveRunDrawer`), 창 효과 연결, 단축키 구현 | 씀 | 모바일이 자기 셸을 둔다 |

[제안] `@helm/ui-tokens`와 `@helm/ui`는 데스크톱 MVP 때부터 별도 패키지로 만든다(판정 J-85). 처음부터 나누면 옮기는 비용이 없고 플랫폼 API 금지 규칙을 패키지 경계로 강제할 수 있다. 06 §3.4.17과 경계가 같다.

`@helm/ui`의 규칙:

1. `@tauri-apps/*`, Node 모듈, `@helm/client`, `@helm/client-react`, 플랫폼 API(창, 키체인, 알림, 파일)를 가져오지 않는다. 정적 검사로 막는다(§6.4, 20 §5.2 요구).
2. 마우스 호버에만 있는 정보나 행동을 두지 않는다. 호버 미리보기(`HoverPreview`)는 보조이고 같은 정보가 탭·포커스 경로로도 열린다.
3. 크기는 밀도로 바꾼다. 모바일은 `data-density="touch"`(컨트롤 44px, 클릭 대상 44×44px, §3.2.7). 부품은 px을 직접 쓰지 않고 크기 토큰을 쓴다.
4. 단축키는 부품에 하드코딩하지 않고 키 지도로 받는다(§3.12). 모바일에는 키 지도가 비어 있다.
5. 요소 단위 반응(자극 보드)은 터치에서 길게 눌러 요소 고르기, 두 손가락이 아닌 한 손가락 끌기로 그림 영역 고르기를 지원한다 [제안, 26과 맞춤].
6. 유리 재질은 모바일 GPU 비용이 크다. 모바일 기본값은 `data-transparency="reduced"`다(26의 답, U-22). 사용자가 설정에서 `full`로 바꿀 수 있다.
7. `touch` 밀도에서 글자 입력 칸의 글자 크기는 16px 이상이다(iOS Safari가 16px 미만 입력 칸에 초점이 가면 화면을 확대한다 [지식]). `size['field-font-touch']`(`--hm-size-field-font-touch`, §3.2.8) 토큰으로 둔다.
8. 부품이 `style` 속성으로 값을 넣는 곳(26의 CSP `style-src-attr` 검토용): `VirtualList`(행 위치 `transform`, 전체 높이), `Splitter`(패널 너비), Radix 떠 있는 층(`Popover`·`Menu`·`Tooltip`·`HoverPreview`의 위치 변수), `TextArea`(react-textarea-autosize 높이), `StimulusBoard` 그림 영역 표시(정규화 사각형 → 백분율 위치), `AttentionBudgetMeter`·`MetricTile`의 막대 길이(SVG 속성으로 그리므로 style 아님), `AgentActivityIndicator`(없음, 클래스만). 모두 React가 렌더 뒤 DOM `style` 속성 객체로 넣는 값이며 서버 렌더 HTML 문자열의 `style="…"`는 만들지 않는다. CSP가 이 방식을 막는지는 26이 실제 iOS 26 Safari에서 확인한다 [가정].

### 3.14 글래스모피즘 시각 언어 [결정 41 / 제안: 규칙]

#### 3.14.1 참고한 것과 가져온 것

결정 41은 "최근 에이전트 클라이언트(Codex, Claude Code 데스크톱 등)의 디자인 시스템을 참고한 글래스모피즘"을 정했다. 사용자의 Caustic이 이미 같은 출처를 정리했으므로(Caustic `FOUNDATION.md` 1~9행) Caustic의 정리를 1차 근거로 쓰고, 공개 자료로 확인한 것을 더했다.

| 출처 | 확인한 것 | Helm이 가져온 것 | 가져오지 않은 것 |
|---|---|---|---|
| Codex·Claude Code 데스크톱(Caustic의 정리) [원문: Caustic FOUNDATION] | 차분한 중립 크롬, 13px 인터페이스 글자, ink 주 버튼 | neutral 크롬, `ui` 역할 13/18, ink 주 버튼(UP-16) | — |
| Claude Code 데스크톱 [검색: https://code.claude.com/docs/en/desktop] | 여러 세션 사이드바, 세션 도구막대의 diff 통계 표시를 누르면 왼쪽 파일 목록·오른쪽 줄 단위 변경 보기, 줄마다 의견, PR·CI 상태 막대 | 진행 중 작업을 레일·서랍에 모아 보이기(`ActiveRunDrawer`), 결과 확인에서 기준·근거 목록(왼쪽)과 상세(오른쪽) 배치 | 세션(대화) 중심 사이드바. Helm 레일은 상태 화면 중심(결정 10) |
| Codex 앱 [검색: https://every.to/p/codex-vibe-check (2026-02), https://www.gradually.ai/en/changelogs/codex-app/] | 오른쪽 사이드바에 diff와 커밋 안 된 변경, PR 리뷰를 사이드바에서 | 인스펙터를 오른쪽에 두고 근거·출처·변경을 보이는 배치 | 대화 상자가 중심인 배치 |
| Apple Liquid Glass(WWDC 2025, macOS 26) [검색: https://developer.apple.com/videos/play/wwdc2025/310/] | 빛을 반사·굴절하는 반투명 재질, 창 구조 영역을 유리로 감쌈, 동심 반경 | 떠 있는 층만 유리(UP-14), 위쪽 반사광·안쪽 테두리, 동심 반경 | 굴절 렌즈 효과(웹뷰에서 재현 비용이 크고 글자 대비를 떨어뜨림) |
| Tauri v2 창 효과 [검색: https://v2.tauri.app/reference/config/ `windowEffects`·`WindowEffect`] | `windowEffects`의 `sidebar`·`underWindowBackground`·`hudWindow` 등(macOS), `liquidGlassRegular`·`liquidGlassClear`(macOS 26+), `mica`(Windows 11), `acrylic`·`blur`(끌기·크기 조절 성능 문제 명시) | §3.14.3 | `acrylic`, `blur` |
| Caustic 정책 | 유리는 떠 있는 것에만, 빛은 에이전트, ink 먼저, 동심 반경, 대비 관문, 입력칸 포커스 | UP-14~16, §3.2.5, §3.6.5 | 에이전트 serif(1차 제외, U-20), 회전하는 스펙트럼 테두리(정적으로 바꿈) |

Codex 앱의 구체 재질(반투명 사이드바 여부 등)은 위 두 자료에서 찾지 못했다 [검색: 위 두 URL, 2026-10-12]. 위 표의 Codex 행은 배치 관찰만 담는다.

#### 3.14.2 표면 층위

| 층 | 무엇 | 재질 | z(§3.2.7) |
|---|---|---|---|
| 0 창 바탕 | 창 배경. 창 효과를 켜면 OS 재질(바탕화면이 흐리게 비침) | `bg-app` 또는 투명 + 창 효과 | — |
| 1 크롬 | 창 머리, 레일, 상태 줄, 진행 중 서랍, 입력창 띠 | `glass-chrome` | chrome 20, sticky 30 |
| 2 본문 | 가운데 화면, 카드, 목록, 근거 트리, 자극 | 불투명 `surface-base`/`surface-raised` | — |
| 3 오버레이 | 팝오버, 메뉴, 툴팁, 토스트, 명령 팔레트, 대화상자·시트의 틀 | `glass-overlay` | popover 40 ~ palette 100 |

- 유리 아래로 스크롤되는 내용은 크롬 아래(창 머리·상태 줄 밑)뿐이다. 흐림은 스크롤마다 다시 계산되므로 동시에 보이는 흐림 영역을 셋(크롬 둘 + 오버레이 하나) 이하로 둔다 [제안].
- 유리 요소에는 `contain: paint`를 둔다. `will-change: backdrop-filter`는 쓰지 않는다(상시 합성 층이 늘어 메모리를 쓴다) [지식].
- `backdrop-filter`를 지원하지 않거나 투명도 줄이기·고대비·강제 색이면 불투명 표면으로 바꾼다(§3.2.5 CSS).

#### 3.14.3 창 효과(Tauri) [제안, 20이 구현]

| 플랫폼 | 효과 | 조건 |
|---|---|---|
| macOS 14~15 | `windowEffects.effects: ["sidebar"]`, `state: "followsWindowActiveState"`, 창 `transparent: true` | 레일 영역이 OS 재질을 받는다. 그 위에 `glass-chrome` 채움(84~86%)이 덮여 글자 대비 하한을 지킨다(§3.2.2 유리 표) |
| macOS 26+ | 설정에서 `liquidGlassRegular` 선택 가능, 기본은 `sidebar` | 같음 |
| Windows 11 | `mica`(테마를 따름) | `acrylic`·`blur`는 쓰지 않는다. Tauri 문서가 Windows 10 v1903+·Windows 11 22000/22621에서 끌기·크기 조절 성능 문제를 적고 있다 [검색: v2.tauri.app/reference/config] |
| Windows 10 | 효과 없음, `bg-app` 불투명 | Mica는 Windows 11 전용 [검색: https://v2.tauri.app/reference/config/ `WindowEffect` 설명] |

- 창 효과는 `transparent: true`가 필요하다 [검색: https://v2.tauri.app/reference/config/ `transparent`]. 웹뷰 `body` 배경은 투명, `bg-app`은 창 효과가 꺼졌을 때만 칠한다(`:root[data-window-effect="on"]`).
- Tauri 2.12.1부터 `macOSPrivateApi` 설정은 아무 일도 하지 않는다(API가 늘 켜짐) [검색: v2.tauri.app/reference/config]. 1인 앱이라 App Store 제약은 없다(결정 24).
- 설정 "창 투명 효과"(`system | on | off`, 기본 `system` = 투명도 줄이기 설정을 따름). 끄면 창 불투명, 유리는 웹뷰 안 흐림만 남는다.
- 창 효과는 20이 창을 만들 때 적용하고, 웹뷰에 `data-window-effect`를 넘긴다(§5.2).

#### 3.14.4 움직이는 장식 [결정 41: 판단해 씀 / 제안]

| 장식 | Helm 사용 | 이유 |
|---|---|---|
| 정적 스펙트럼 테두리(`agent-rim`, 회전 없음) | 에이전트 초안(`DraftMark`), 진행 중 작업 카드 | 작성자 구분의 보조(UP-15). 움직이지 않아 읽기를 방해하지 않는다 |
| 회전 스펙트럼(`AgentActivityIndicator`) | 진행 중 서랍 머리와 진행 중 작업 카드 머리의 작은 점 하나(12px). 진행 중인 run(루프 상태 `thinking`·`tool_running`)이 있을 때만 4.8초에 한 바퀴 | "에이전트가 지금 일하는 중"을 한눈에 알리는 유일한 반복 모션. "진행 중 2", "다음 행동을 고르는 중" 같은 글자가 항상 함께 있다(UP-12) |
| `agent-glow` 그림자 | 진행 중 작업 카드 | 정적 |
| orb(구멍 뚫린 원 회전), shimmer(글자 반짝임), 스캔 띠 | 쓰지 않는다 | 반짝이는 한국어 글자는 읽기 어렵고, 큰 회전체는 주의를 끈다. 한 화면에 반복 모션이 여럿이면 상태 표시로 읽히지 않고 장식으로 보인다 |

- 감소 모션(`prefers-reduced-motion`, 앱 설정)에서는 회전을 멈추고 정적 테두리로 바꾼다.
- 스펙트럼은 결정 버튼, 질문 카드, 사람이 쓴 내용에 쓰지 않는다.

## 4. 실패·예외·경계 사례

| # | 상황 | 처리 | 관련 |
|---|---|---|---|
| E1 | 사람이 낡은 카드에서 결정(보는 사이 질문이 바뀜, 반대 근거 추가) | 의도에 `basisSeq`를 붙여 보내고 데몬이 낡았다고 거부하면(`revisionConflict`) `rejected`. 04 §3.0.5 문장, 바뀐 칸 강조, 입력하던 글 유지 | §3.6.4, 19 |
| E2 | 결과 확인 패널을 보는 중 새 반대 근거 도착 | 패널 머리 띠 "확인하는 동안 반대 근거 1건이 추가됨 · 보기". 확인 버튼은 그대로 두되 보낸 의도는 E1 규칙을 따른다 | §3.7.3 (11) |
| E3 | 연결 끊김(오프라인) | 결정 버튼 비활성 + 이유. 읽기는 마지막 뷰(캐시)로. 초안 보존. 새 결정을 쌓아 두었다 보내지 않는다. 자극 반응만 "보내지 않음"으로 받아 둔다 | §3.6.4, 04 §3.0.4, 20 §3.9.7 |
| E4 | 보냈는데 응답 없음, 보내는 중 끊김 | 10초 뒤 안내 문장, 끊기면 `waiting_reconnect`. 20이 재접속 뒤 같은 멱등 키로 다시 보내고 데몬은 처음 결과를 돌려준다(19·20) | §3.6.4 |
| E5 | 데몬이 다시 시작함, 재접속 뒤 다시 맞춤 | 연결 상태 "다시 맞추는 중", 뷰는 마지막 캐시를 유지하고 새 뷰가 오면 한 번에 바꾼다. 바뀐 항목에 "다시 연결된 뒤 바뀜" 표시 1분(04 §3.0.4 규칙 4). 표시할 항목은 20의 `uiStore.changedSinceReconnect`를 컨테이너가 넘긴다. 포커스와 펼침 상태는 레코드 id로 다시 맞춘다 | §3.5.8, 19·20 |
| E6 | 투영 생성 실패 | 신선도 `failed`, 이유 띠, 결정 막음, [다시 불러오기] | §3.5.8 |
| E7 | 공백 없는 긴 문자열(URL, 경로, 해시, 붙여 쓴 한국어) | `overflow-wrap: anywhere`로 끊는다. 한 줄 라벨은 말줄임 + 툴팁. 질문·근거 문장은 자르지 않는다 | §3.2.3 |
| E8 | 한국어 IME 조합 중 Enter·Esc | Enter는 제출하지 않고 조합 확정만. Esc도 조합 중이면 대화상자를 닫지 않는다(조합 취소가 먼저) | §3.6.5 |
| E9 | 글 자극의 요소 구간이 렌더링된 글과 맞지 않음(마크다운 원문 구간, 결합 문자·이모지 경계) | 기본값: 데몬이 요소별 평문 조각을 함께 보내고 부품은 조각 단위로 감싼다(§3.8.3). 구간만 오면 렌더 뒤 평문에서 찾아 감싸고, 찾지 못한 요소는 "표시 위치를 찾지 못함"으로 목록에만 보인다. 경계 보정에는 `Intl.Segmenter`(grapheme)를 쓴다 [지식] | §3.8.3, 04·15 |
| E10 | 반응을 단 뒤 자극 본문이 바뀜 | 자극은 바뀌지 않는 레코드여야 한다(08에 요구). 바뀌면 새 자극으로 다루고 이전 반응은 이전 자극에 남는다. 화면은 "이 자극은 고쳐진 판이 있습니다"를 보인다 | §3.8.3, 08 |
| E11 | 그림 자극 불러오기 실패, 아주 큰 그림 | 대체 글 + "다시 받기". 그림은 데몬 HTTP에서 표시 크기에 맞춘 판을 받는다(19에 요구). 원본 크기는 감사 깊이에서 | 19 |
| E12 | 근거 트리에 순환, 공유 노드, 볼 수 없는 노드, 수천 노드 | `repeatOf` 참조, 고아 노드(`orphan`) "볼 수 없는 레코드" 표시, 지연 로딩(04에 요구), 500개 넘으면 가상화 | §3.8.1 |
| E13 | 질문이 한꺼번에 많이 생김 | 막는 권리 게이트 질문은 모두 보인다. 정보 질문과 막지 않는 권리 게이트 질문은 설정 `maxVisibleDecisions`개 뒤 접고 개수를 보인다(판정 J-132). 질문함은 가상 스크롤. 같은 질문 id는 한 번만 그린다(`alsoAskedBy`로 합쳐진 것은 "다른 Concern에서도 같은 질문" 표시). 알림 반복 금지는 11·20 | §3.7.3 (3)(4) |
| E14 | 답을 쓰는 동안 만료점이 지나 가정대로 확정됨 | 카드가 `assumed`로 바뀌어도 입력한 글을 버리지 않는다. "답이 없어 임시 가정대로 정해졌습니다. 이 글을 이의로 보내면 다시 열립니다" + [이의로 보내기](`objection.file`). 늦게 보낸 답은 데몬이 3008로 거부하고 확정된 값과 "이의로 보내기"를 돌려준다. 화면은 쓰던 답을 이의 초안으로 넘긴다(판정 J-120) | §3.7.3 (3), 04 §3.0.5, 19 |
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
| E31 | 유리 아래 스크롤로 프레임이 떨어짐(큰 흐림, 저사양 GPU) | 동시 흐림 영역 셋 이하, `contain: paint`. 그래도 느리면 설정 "투명 효과 끄기"로 불투명. 성능 기준은 §6.3 | §3.14.2 |
| E32 | 웹뷰가 `backdrop-filter`를 지원하지 않음 | 시작 시 기능 검사 → 유리를 불투명으로(§2.5.7) | §3.2.5 |
| E33 | 창 효과로 밝거나 어두운 바탕화면이 비침 | 크롬 채움 84~86%가 덮여 순수 검정·흰색 위에서도 본문 10.96:1 이상(§3.2.2). 유리 위 3차 글자는 `text-tertiary-on-glass` | §3.2.2, §3.14.3 |
| E34 | macOS에서 "투명도 줄이기"를 켬 | WKWebView는 미디어 쿼리를 모르므로 Rust가 OS 설정을 읽어 `data-transparency="reduced"`를 넘긴다(20). 그 전까지는 앱 설정으로 끌 수 있다 | §3.2.9 |
| E35 | 그림 blob 요청이 503(연결 없음) | `BlobImage`가 "연결되면 보입니다" 자리 표시, 다시 연결되면 자동으로 다시 받음(20 §5.2) | §3.7.1 |
| E36 | 창 효과를 켠 채 테마 전환 | 창 효과 밝기와 웹뷰 테마를 함께 바꾼다(20). 바뀌는 동안 깜박임을 줄이려 웹뷰 `bg-app`을 잠깐 칠하지 않는다 [가정] | §3.14.3 |

## 5. 다른 문서와의 인터페이스

### 5.1 이 문서가 제공하는 것

| 받는 문서 | 제공 |
|---|---|
| 03·04·05(P2) | 부품 목록과 계약(§3.7), 시각 문법(§3.5), 화면 → 부품 매핑(§3.11), 문구 키 연결(§3.6.7), 대안 고르기 금지 규칙의 부품 강제(§3.9), 부품별 키(§3.12), 글래스모피즘 층위(§3.14) |
| 20(P13) | `UiIntent`(§3.6.3), 행동 수명주기(§3.6.4), 셸 부품과 재질(§3.3, §3.14), 테마·밀도·투명도·창 효과 설정 값(§3.2.7, §3.2.9, §3.14.3), 웹뷰 기준(§2.5.7), `@helm/ui`·`@helm/ui-tokens`의 플랫폼 금지 규칙(§3.13) |
| 26(P15) | 모바일과 나눠 쓰는 토큰·부품 경계, `touch` 밀도, 터치 반응 입력(§3.13) |
| 19(P12) | 화면이 필요로 하는 데이터와 의도 목록 |
| 22·23 | 테스트 정의(§6.3), 구현 단위와 순서, 완료 기준(§6) |
| 06·07(P3·P4) | 새 패키지 `@helm/ui-tokens`, `@helm/ui`(§3.13), UI 의존성 목록(§6.5)과 `just` 레시피 요구 |

### 5.2 다른 문서에서 21에 온 요구의 처리

| 요구한 문서 | 요구 | 처리 |
|---|---|---|
| 01 §5.2 | 상태를 색에만 의존하지 않음, 확신도 숫자 금지, 에이전트 의인화 금지 | 반영: UP-4, §3.5.6(J-19), UP-9 |
| 03 §5.2 | 화면 ID로 매핑을 바꾸기, §3.3 라벨을 배지 값으로 | 반영: §3.11, §3.5.3·§3.5.4 |
| 03 §4 | 과분해 트리는 가상 스크롤 | 반영: `ConcernTree`(§3.7.3 (2)) |
| 03 IA-Q4 | 대화 탭에 assistant-ui | 답: 쓴다(§3.10) |
| 04 §5.2 | 질문 카드(접힘·펼침, 깊이별 필드), 진행 작업 카드, 자극 카드와 반응 막대, 근거 트리, 기준 판정 표, 반영 단계 목록, 다이얼 표 | 반영: §3.7.3 (3)(8)(11)(14), §3.8.1, §3.8.3 |
| 04 §4 | 모델 문장을 텍스트로만 그리고 HTML로 해석하지 않음 | 반영: `Markdown`(§3.7.1), E21 |
| 05 §5.2 | 반응 막대, 이의 걸기 창, 의미 미리보기 카드, 질문 카드의 키보드 동작과 접근성 구현 | 반영: §3.6.5, §3.6.8, §3.7.3 (3)(13), §3.8.3, §3.12 |
| 05 §3.8.1 | 단축키는 `KeyboardEvent.code`로, 결정은 버튼으로만, 예외 셋 | 반영: §3.6.5 |
| 05 §3.9 | 같은 카드 30초에 한 번, `role="alert"`는 연결 끊김·즉시 권리 게이트 배너만 | 반영: §3.6.8 |
| 05 §3.2.7, 14 `frontSize` | 대비 압축을 반응으로, 앞줄 수 | 반영: `ContrastCard`, 기본 3(§3.8.6) |
| 08·09 §5.2 | 거부 갈래 이름 `eligibility` → `authority` | 반영: `CommandOutcomeView`(§3.7.1) |
| 11 §5.2 | 이의 사유 선택, 가정 확정 뒤 답을 이의로, 이의 영향 미리보기, 권리 게이트 카드의 인자 미리보기와 고쳐 허락, 미루기 만료 경고 | 반영: `ContestButton`(영향 미리보기), E14, `QuestionCard`(허락 행동, 미루기 시각 경고), `ArgsView`(편집 칸) |
| 13 §5.2 | 성질별 보장 수준, 샌드박스 수준, "격리 없음"·"신호 격리 없음" 경고, `pre_read_exposed` 표지, 합의 경고 키 `network.proxy_fallback_ask` | 반영: `EnforcementBadge`, `SandboxBadge`(§3.7.2), `WorkAgreementDraft`(§3.7.3 (7)), 작업 카드 |
| 14 §5.2 (03·04·05·21) | (1) OPD+C 의무 id와 화면 요소 대응, (2) `DIAL_DEFS`와 범위 셋, MVP 노출 다섯 개, (3) 건너뛴 루프의 이유와 전환 이력, (4) 주의 예산 값, (5) 시간당 알림 상한과 휴대폰 조용한 시간 제안, (6) 보관 Concern 숨김, (7) 승인됐지만 실행하지 않은 행동과 반영 범위 초안, (8) 판단 확인 묶음, (9) 막지 않는 권리 게이트 접기, (10) run 목록의 Concern 트리 묶음 | (1) 03의 대응 표와 §3.11 매핑으로 반영. (2) §3.7.3 (14), MVP 여섯 개(판정 J-192). (3) §3.8.2. (4) §3.8.5. (5) 이 문서에 알림 설정 부품이 없어 해당 없음(20·26·05 소관). (6) 화면 목록 필터는 03·04 소관이고 `ConcernTree`는 필터 값을 받는다. (7) §3.7.3 (11). (8) §3.7.3 (3)·(5). (9) §3.7.3 (1)(4), §4 E13. (10) §3.3 `RGN-RUNS` |
| 16 §5.2 | 평가 화면 지표 타일, 감사 깊이 열람 수집 | 반영: `MetricTile`(§3.7.3 (16)). 감사 깊이 열람은 `presence.report`의 `depth`로 컨테이너(20)가 보냄(J-84) |
| 18 | 승인 화면은 커널의 구조화된 값을 보이고 모델 요약은 보조. 모델 제공자 목록, 결과 확인의 git 설정 파일 주의 항목, 잘린 인자의 허락 버튼 조건(T18-38) | 반영: `WorkAgreementDraft`(§3.7.3 (7)), `SCR-SETTINGS` 행(§3.11, 모델 제공자 목록), `MaterialChangeGroups`(§3.7.3 (10)), `ArgsView`(§3.7.3 (3)), TK-11. 웹 승인 표지(§3.7.3 (3)), 웹 결과 본문 자료 표시(§3.7.3 (9)) |
| 19 §5.2 | 메서드 대응은 19 §3.7.1, 낡은 기준은 `3004 command.revisionConflict`, `intentId`는 `idempotencyKey`, 의미 미리보기는 `composer.preview` 결과, 그림 표시 판은 `BlobRef.variants` | 반영: §3.6.3, §3.6.4, §3.7.3 (13), `BlobImage` |
| 20 §5.2 | (1) 신선도 다섯 값, (2) "다시 연결된 뒤 바뀜"은 `uiStore.changedSinceReconnect`, (3) blob 503 자리 표시, (4) 마크다운 원시 HTML 끔·스킴 제한, (5) 부품은 `@helm/client`·`platform`을 가져오지 않음, (6) `safeMode`, (7) `refreshing` 중 결정 막지 않음, (8) `decisionsAllowed`는 앱이 계산 | 반영: §3.5.8, E5, `BlobImage`·E35, `Markdown`·E21, §3.13·§6.4, J-60, J-59, `DecisionAvailability`, `ConnectionUiState` 값은 J-196에 따라 camelCase(§3.6.2) |
| 15 | 지지 등급 표시, 세 개 비교, `roundClosable`·`pickOnly` | 반영: `SupportGradeLabel`(라벨은 03 §3.3.6), §3.8.3, J-34·J-100 |
| 13 §3.10, 18 §3.11.6 | 승인 화면의 인자 미리보기: 전체 또는 잘림 표시와 전체 보기, 보이지 않는 문자의 코드 포인트 표시 | 반영: `ArgsView`(§3.7.3 (3)), TK-11 |
| 11 §3.2, 10 | 권리 질문에서 커널 구조 값과 모델 문장을 나눠 보이기, `scope_change` 질문의 현재 범위 대 요청 범위 | 반영: `QuestionCard` 규칙 표, `ScopeDiff` |
| 10·15 (판정 J-141) | 원함 탐구에서 답이 자극·가능성 id를 가리키는 질문 금지 | 반영: §3.9 R1·R7 |
| 22 §3.19 | 21 시험 ID(TK-nn) | 반영: §6.3 ID 열(TK-01~11) |
| 22 §5.2 | 기준 이미지 보관(Git 밖 + 잠금 파일), `ui-visual`은 verify 밖, 접근성 기준, 배경·글꼴 바이너리, 성능은 `just perf`, 토큰 전체·상태 대응표 | 반영: §6.3, §6.4, §6.1 고정 데이터, §3.2.8 |
| 23 §5.2 | 실제 웹뷰 성능 측정(SP-09), `ui-visual`을 UI 작업 완료 조건에, 부품 9개 단위 배정, ID 열 | 반영: §6.3, §6.4, §6.2 |
| 26 §5.2 | `BottomSheet`, `SinceLastVisit`·`AutonomousChoiceList` 변형, 모바일 투명도 `reduced`, 입력 글자 16px, `style` 속성 목록 | 반영: §3.7.1, §3.7.3 (1)(6), §3.13 |
| 15 §5 | 무게 문구 키, R7 "어느 쪽입니까", 세 개 비교는 비슷한 둘 고르기, 평문 조각, J-34 버튼 | 반영: §3.8.3, §3.9 R1·R7, §6.6 U7 |
| 06 §5 | `@helm/ui` 외부 의존과 `peerDependencyRules`, 패키지 경계 | 반영: §6.5(규칙 두지 않음), §3.13 |
| 03 §5.2 | 진행 중 서랍을 트리로, "에이전트가 정한 것" 배지는 점 | 반영: §3.3 `RGN-RUNS`·`RGN-RAIL`, `ActiveRunDrawer`, `NavRail` |
| 12 | (21에 요구 없음) | — |

### 5.3 다른 문서에 요구하는 것

2a 판에서 요구한 것 중 06(패키지), 20(창 효과·투명도·키 지도·최소 판·`UserConnState`), 23(U1 토큰), 26(공유 패키지·`touch` 밀도), 15(평문 조각)는 해당 문서에 들어갔다. 남은 것과 4단계에서 생긴 것만 적는다.

| 문서 | 요구 |
|---|---|
| 03 | (1) 원천 배지 `inferred`·`policy-approved`를 작성자 표시로 옮긴 것(§3.5.3)을 §3.3.6에 반영. (2) 지지 등급 화면 라벨(아직 확인 안 됨 / 약함 / 일관됨 / 확인됨 / 이의 있음)을 §3.3에 표로 둘 것(§3.5.6이 인용) |
| 04 | (1) 목록 항목의 `unseen`. (2) 글 자극 요소의 평문 조각(E9). (3) `GoalView` 버전 본문 조회. (4) `EvidenceChainView.nodes`의 깊이 지연 로딩. (5) 진행 작업 카드 뷰에 성질별 보장 수준과 `sandboxLevel`, 그 표지 `flag`(S1b의 `pre_read_exposed`, §3.7.2 `SandboxBadgeProps.flag`). (6) `scope_change` 질문 뷰에 `currentScope`·`requestedScope`(08 `Scope` 구조 값), 권리 질문 뷰에 커널 구조 값(행동 종류·대상·인자)과 모델 설명을 다른 필드로. (7) 인자 뷰에 `truncated { totalBytes, full: BlobRef }`. (8) 가벼운 작업 결과 확인, 승격 질문, Goal 수정 카드, 홈 선택 요청 카드가 `QuestionCard`의 "그 밖에"를 쓰게 하고, 간단판 버튼을 [결과 확인]·[수정 요청]으로(§3.9 R2). (9) 휴대폰 결과 확인 가능 여부 `mobileReviewable`(판정 J-139, J-174). (10) 홈 표시 개수를 다이얼이 아닌 설정 `maxVisibleDecisions`로 적기. (11) 합의 뷰에 경고 키 `warnings`(13 §3.5.3)와 모델 제공자 목록(작업·검증 에이전트별, 판정 J-150). (12) 질문 뷰에 고른 바라는 효과별 영향 미리보기 문구(이의 걸기 흐름)와 재결정 질문 참조. (13) 질문 뷰의 미루기 선택지별 만료 경고 여부(11 Q-E19). (14) 결과 확인 뷰에 승인됐지만 실행하지 않은 행동 목록(14 §3.12.3 F32). (15) 루프 계획 뷰의 건너뛴 단계 이유(`reason`)와 작성자(`authoredBy`, 결정 53, 판정 J-188). (16) 홈 주의 예산은 `AttentionBudgetVM`(14 §3.13.8 값)으로 준다. 04 `HomeView.attentionBudget`(다이얼 값)은 이 막대의 입력이 아니다. |
| 05 | (1) `@helm/ui-language` 키 생성 규칙과 키 표: 상태 라벨 `status.<집합>.<값>`(03 §3.3 전부), 연결 상태 문구 키 `label.connection.<상태>`(접두어 05 정본, 상태 값은 04 §3.0.4의 열여섯 값을 camelCase로 쓰며 §3.6.2 `ConnectionUiState`와 같다, 판정 J-176·J-196), 등급 라벨, 고정 표현 머리말, 버튼어(§3.10.5). 보간 문법(`{이름}`)과 인자 타입을 키별로. `CopyKey`는 키 문자열 타입 하나의 뜻으로만 쓴다. (2) 금지 문구 목록에 R7 문구("어느 쪽입니까", "둘 중 하나") 더하기. (3) 응답 이름 하나씩: 먼저 알아보기, 범위 줄여 진행, 에이전트가 정하게 두기, 미루기, 이의 걸기, 안전하게 멈추기(25 §응답 선택지 행과 같게). (4) 선호 기준 무게 라벨 "높음·중간·낮음" 키. (5) 질문 문장 예시를 §3.10.6 형("…정해야 합니다. 지금 정하지 않으면 …")으로. (6) 세 개 비교 입력을 08 `triad.similar`·15 §3.6대로 "비슷한 둘 고르기"로(05 §3.2.4의 "다른 하나 고르기"와 다름, 21은 08·15를 따랐다) |
| 10·15 | V-Q-03에 "I.want에서 답이 자극·가능성 id를 가리키는 질문 거부"(판정 J-141). 21은 이 질문이 화면에 오지 않는다고 본다 |
| 11 | §3.2에 "권리 질문 화면은 커널 구조 값을 보이고 모델 문장은 보조" 규칙. 21 `QuestionCard`가 이를 구현한다 |
| 13·18 | `argsPreview`가 전체 인자 또는 잘림 정보(`truncated`, 전체 blob)를 반드시 담을 것. 마스킹 자리 표시 형식 |
| 19 | (1) 이의 메서드 이름 `objection.file`(판정 J-111), `result.reopen` 삭제(판정 J-123). (2) `autonomous.markSeen`·`decision.confirm` params에 항목 단위 `targets`. (3) `agreement.narrow` params에 구조화 `Scope`. (4) 08 `Scope`를 `AgreementScope` 이름으로도 내보내기(19 인증 `Scope`와 겹침). 2a 요구(`impact`, 오류 kind, `variants`, 서버 시각)는 19가 반영했다 |
| 20 | `ConnectionUiState` 값(04 §3.0.4의 열여섯 개, camelCase, `readOnly` 포함, 판정 J-196)과 §3.8.9 대응표를 21 §3.6.2와 맞추고, `decisionsAllowed` 반환형 `boolean` 하나와 `reasonKey` 출처를 한 곳에 |
| 14 | 없음. 주의 예산의 단위·창·예약 몫은 14 §3.13.8이 정했고 §3.8.5가 따른다. 값을 주는 쪽은 04 §3.21(`attention.dailyBudget`, `attention.maxVisibleDecisions`) |
| 12·15 | 모델 문장에 숫자 확률을 쓰지 않게 하는 프롬프트 규칙(E22). 사용자 투영에서 사고 텍스트 제외 |
| 17·18 | 연결 진단 문장(경로별), 안전 모드·읽기 전용 사유 문장 키 |
| 22 | 색인의 21 TK-nn을 §6.3 ID 열로 맞추고 TK-11(인자 표시) 더하기. TK-02 통과 조건은 22 문장(영향도와 관계없이 위반 0)으로 맞췄다 |
| 23 | 21 부품을 WBS에 배정: §6.2의 U1~U9 단위와 부품 목록(§6.2에 23 M13a-04·05·08 배정대로 9개를 넣었다. 4단계에 생긴 `ArgsView`·`ScopeDiff`는 U3(L1, M13a-03)에 더할 것[판정 J-236]) |
| 24 | 이 문서 끝 ADR 후보 |

## 6. 구현 단위와 완료 기준

### 6.1 폴더 구조 [제안]

앱 구조(라우팅, 저장소, Tauri 설정, 화면 컨테이너)는 20이 정한다. UI 계층은 플랫폼 중립 패키지 둘과 데스크톱 전용 폴더 하나로 나눈다(§3.13). 세 곳 모두 앱 저장소, `@helm/client`, 플랫폼 API를 가져오지 않는다(§6.4 검사).

```text
packages/ui-tokens/            @helm/ui-tokens (§3.2.8) — 토큰 원본, 빌드, dist, NOTICE
packages/ui/                   @helm/ui
  .storybook/                  main.ts, preview.tsx(테마·밀도·깊이·투명도·고정 배경 도구막대)
  src/
    assets/fonts/              Geist, Geist Mono, SUIT woff2 + OFL 라이선스 파일
    styles/fonts.css
    model/                     common.ts, intent.ts, freshness.ts (04·19 타입을 다시 내보냄 + UI 전용 타입)
    lib/                       keys.ts(IME·단축키 판정), time.ts, segment.ts(Intl.Segmenter), linear.ts, cn.ts
    primitives/                L0 (§3.7.1) — Surface, Button, IconButton, ActionButton, RecordLink, TextField, TextArea, Select, Checkbox,
                               Switch, RadioGroup, SegmentedControl, Tabs, Tooltip, Popover, HoverPreview, Dialog, Sheet, Menu, Toast,
                               Disclosure, Banner, EmptyState, ErrorState, Skeleton, Kbd, VirtualList, DataTable, Markdown, BlobImage
    helm/                      L1 (§3.7.2) — KindLabel, QualityBadge, AuthorshipMark, DraftMark, ActorLabel, StatusLabel, LoopChip,
                               SituationChip, ModeChip, GateBadge, DeliveryBadge, AssumptionExpiry, TimeStamp, RecordChip, SourceTrace,
                               CertaintyDescriptor, SupportGradeLabel, ConfidenceGradeLabel, ReversibilityNote, ReviewTriggerLine,
                               DepthToggle, FreshnessIndicator, UnseenDot, ContestButton, WholeUpdateBadge, EnforcementBadge, SandboxBadge, ArgsView, ScopeDiff,
                               AgentActivityIndicator, icons.ts
    composites/                L2 (§3.7.3) — brief/, concern/, question/, autonomous/, agreement/, work/, review/, evidence/, input/,
                               rules/(DialPanel, ObserverProposalCard, MetricTile), status/(DegradedBanner)
    viz/                       §3.8 — EvidenceChainTree(+buildTree.ts), LoopTimeline, LoopPlanStrip, LoopPathMini, StimulusBoard,
                               PreferenceModelPanel, GoalHistory, ConnectionIndicator, PendingQuestionsIndicator, AttentionBudgetMeter,
                               inquiry/{InquiryBoard, HypothesisBoard, DivergenceTable, PossibilityComparison, ContrastCard, PredictionList, PremortemList}
    conversation/              ConversationThread, adapter.ts(ThreadMessageVM ↔ assistant-ui), toolkit.tsx
    fixtures/                  VM 고정 데이터(한국어, 긴 문장, 혼합 문자, 빈 값, 극단 값)와 유리 시험용 고정 배경 2종(실행 때 SVG·CSS 그라디언트로 그림, 바이너리 없음)
    index.ts
  tests/visual/                Playwright 시각 테스트(§6.3)
apps/desktop/src/ui/           데스크톱 전용 — shell/(WindowHeader, NavRail, ScopeBar, Inspector, Splitter, ScopedComposer, ActiveRunDrawer,
                               CommandPalette, AppShell), window-effect.ts(data-window-effect·data-transparency 연결 받기)
apps/desktop/src/styles/app.css
```

### 6.2 구현 순서 [제안]

| 단계 | 내용 | 먼저인 이유 |
|---|---|---|
| U1 | `@helm/ui-tokens`: Caustic 값 복사, neutral 11단계, 빌드 스크립트, 대비 관문(유리 최악 배경 포함), NOTICE. `app.css`, 글꼴, Storybook 설정, 정적 검사 | 모든 부품의 바탕. 대비가 빌드 관문 |
| U2 | L0 부품(`Surface`·유리 포함) + `ActionButton` 상태 기계 + 키·IME 도우미 | L1·L2가 쓴다 |
| U3 | L1 Helm 의미 부품(`ArgsView`·`ScopeDiff` 포함) + `model` 공통 타입 | 시각 문법 고정. `ArgsView`·`ScopeDiff`는 U4 질문 카드가 쓰므로 먼저 만든다([판정 J-236]) |
| U4 | C/A 부품: `QuestionCard`, `QuestionInbox`, `ChoiceImpactEcho`, `SemanticPreview`, `WorkAgreementDraft/Echo`, `ResultReviewPanel`, `AutonomousChoiceList`, `ContestButton` | 원천의 C/A 우선. 모바일(26)의 질문 답하기와 같은 부품 |
| U5 | 복귀·셸: `SinceLastVisit`, `MaterialChangeGroups`, `GoalSummary`, `ActiveWorkCard`, `ToolActivityLine`, `ConcernTree`, 셸 부품(유리 크롬, `ScopedComposer`), `AgentActivityIndicator`, 창 효과 연결, `FreshnessIndicator`, `ConnectionIndicator`, `PendingQuestionsIndicator`, `DegradedBanner` | UC-03·04·06 |
| U6 | 근거: `EvidenceChainTree`, `EvidenceInspector`, `CertaintyDescriptor`, `SourceTrace` | UC-02·05 |
| U7 | 원함 탐구: `StimulusBoard`, `PreferenceModelPanel`, `ContrastCard`, `GoalHistory` | UC-01·09 |
| U8 | 탐구 보드(`InquiryBoard`와 하위 시각화), `LoopTimeline`, `LoopPlanStrip`, `LoopPathMini`, `DialPanel`, `RecoveryList`, `ObserverProposalCard`, `MetricTile`, `AttentionBudgetMeter` | 14·15·16 의존 |
| U9 | `ConversationThread`(assistant-ui) | 보조 화면이라 뒤로 미룬다 |

### 6.3 스토리북과 테스트 [제안]

**이야기(story) 규칙**

- 부품마다 §3.6.8 상태 집합 중 해당 상태 전부, 깊이 셋(해당하면), 밀도 셋(`regular`, `compact`, 공유 부품은 `touch`)을 이야기로 둔다. 이야기 이름은 상태 이름(`Default`, `Stale`, `Contested`, `Sending`, `StaleRejected`, `Offline`, `Empty`, `LongKorean` …).
- 모든 이야기는 `fixtures`의 한국어 고정 데이터를 쓴다. 고정 데이터에는 공백 없는 긴 문자열, 영어·한국어 혼합, 이모지, 40자 넘는 제목, 근거 0개·1개·50개를 포함한다.
- Storybook 도구막대: 테마(라이트/다크/시스템), 밀도, 깊이, 확대(100/125/200%), 투명도(전체/줄임), 유리 아래 고정 배경(채도 높은 그림 / 회색 단색 / 없음).
- 유리 재질을 쓰는 부품(크롬·오버레이)은 고정 배경 두 가지 위에서 각각 이야기를 둔다. 유리 시각 결과가 배경에 따라 달라 기준 이미지를 고정하려는 것이다.

**테스트 종류**

ID는 22 §3.19의 색인이 인용한다(TK-nn). 행을 더할 때는 번호를 뒤에 붙이고 이미 쓴 번호를 바꾸지 않는다.

| ID | 종류 | 도구 | 대상 | 통과 조건 |
|---|---|---|---|---|
| TK-01 | 동작 | Storybook play 함수 + `@storybook/addon-vitest`(Vitest 브라우저 모드, Chromium) | 모든 L0~L2 | 이야기별 상호작용 시나리오 통과 |
| TK-02 | 접근성 | axe-core(`@storybook/addon-a11y`의 검사를 테스트에서 실행) | 모든 이야기 | WCAG 2.1 A·AA 규칙 위반 0(영향도와 관계없이). best-practice 규칙은 보고만 |
| TK-03 | 키보드 | play 함수 | 트리, 목록, 보드, 대화상자, 셸 | §3.12와 각 부품 키보드 표대로 이동·조작, 포커스가 `body`로 빠지지 않음 |
| TK-04 | IME | play 함수에서 `compositionstart/update/end`와 `keydown(isComposing=true)`, `keydown(keyCode=229)` 합성 | 모든 텍스트 입력 부품 | 조합 중 Enter·Esc가 제출·닫기를 일으키지 않음 |
| TK-05 | 선형 텍스트 골든 | Vitest(노드) | 모든 `toLinearText` | 고정 데이터 × 깊이별 출력이 골든 파일과 같음. 색·아이콘에만 있는 정보가 없는지 검토 |
| TK-06 | 금지 패턴 | Vitest + 렌더 검사 | §3.9 | (1) 원함 탐구 이야기에 결정 의도 버튼이 없음, (2) `StimulusBoard`·`ContrastCard`에 "가장 좋은 것 고르기" 행동이 없고, `pickLike`뿐인 라운드는 "그대로 닫기" 확인을 거쳐서만 닫힘(J-34), (3) 결정 의도 버튼만 있고 "그 밖에"가 없는 질문 카드가 없음, (4) 원함 탐구 출처 질문에 `options`·`pickOne`이 와도 렌더되지 않음, (5) R7 금지 문구가 렌더 결과에 없음, (6) 확률 숫자(`%`가 붙은 확신도)가 Helm 부품이 만든 글자에 없음, (7) 유리 재질 위에 입력칸·비활성 글자가 없음 |
| TK-07 | 행동 수명주기 | Vitest + 가짜 `onIntent` | `ActionButton`과 그것을 쓰는 부품 | §3.6.4 표의 모든 행(접수, 낡은 기준 거부, 그 밖 거부, 시간 초과, 연결 끊김, 투영 반영) |
| TK-08 | 시각 | `@playwright/test` `toHaveScreenshot`, 정적 Storybook 빌드를 대상으로 | 모든 이야기 × {chromium, webkit} × {light, dark} × 밀도 기본(촘촘은 L2만) | 픽셀 차이 2% 이하(`maxDiffPixelRatio: 0.02`, Caustic G4와 같은 값 [원문]), 크기 변화 0 |
| TK-09 | 대비 | `@helm/ui-tokens` 빌드의 대비 관문 | 모든 의미 토큰 조합(불투명 표면), 유리 재질 × 최악 배경(n0·n1·n8·n9, 채도 높은 색 15개, 순수 검정·흰색) 합성, 강조 색상 24개 돌림 | 본문 7:1, 보조·3차 4.5:1, 비활성 3:1, 컨트롤 경계·포커스 3:1. 하나라도 실패하면 빌드 실패. 렌더된 이야기에서도 axe 대비 검사(고정 배경 위) |
| TK-10 | 성능(22 PF-14, `just perf`) | Vitest 브라우저 모드 + Playwright 추적 | `EvidenceChainTree`(노드 2,000), `VirtualList`(행 10,000), `ConcernTree`(노드 500), 유리 크롬 아래 긴 목록 스크롤 | 펼침·접힘 한 번의 렌더 50ms 이하. 크롬 아래 스크롤에서 프레임 시간 중앙값 16.7ms 이하(Chromium·WebKit, 서버 기준) [제안] |
| TK-11 | 인자·특수 문자 표시 | Vitest + 렌더 검사 | `ArgsView`, `ScopeDiff`와 이를 쓰는 `QuestionCard`(권리 게이트·`scope_change`), `WorkAgreementDraft/Echo`, `SourceTrace` | (1) 도구 인자가 잘렸으면 "잘림" 표시와 [전체 인자 보기]가 있고 전체 보기에서 원문 전체가 보임, (2) 제어 문자·양방향 제어 문자(U+202A~202E, U+2066~2069)·영폭 문자(U+200B~200D, U+FEFF)가 `U+XXXX` 표시로 바뀌어 보임, (3) `scope_change` 카드가 현재 범위와 요청 범위의 차이를 칸 단위로 보임(§3.7.3 (3)), (4) 잘린 인자의 허락 버튼(`approve`·`approve_edited`)이 전체 보기 전에는 꺼져 있음, (5) 고쳐서 허락이 고친 인자의 `editedArgs`와 `editedFingerprint`를 `question.answer`로 보냄(§3.7.3 (3)) |

- 시각 테스트 기준 이미지의 환경·보관은 22 §3.12.2를 따른다: Git 밖 `~/projects/helm/design/visual-baselines/`에 두고 Git에는 잠금 파일(`packages/ui/tests/visual/baselines.lock.json`)만 넣는다. 글꼴 woff2는 저장소에 넣지 않고 빌드 때 npm 패키지(`geist`, `@sun-typeface/suit`)에서 복사한다. 유리 시험 배경은 SVG·CSS 그라디언트로 그려 바이너리를 두지 않는다.
- 기준 이미지는 WSL 서버에서 고정 버전 Playwright 브라우저로 만든다. 글꼴을 앱에 넣었으므로 시스템 글꼴 차이는 없다. 두 엔진의 결과를 따로 저장한다.
- WebKit(Playwright, Linux) 결과는 macOS WKWebView의 근사다. 실제 macOS 화면은 `just shot`의 Mac 판으로 사람이 비교한다(§6.4).
- 유리 크롬 아래 스크롤 성능은 서버 Playwright 값만으로 판정하지 않는다. 같은 장면(유리 크롬 아래 행 10,000 목록 스크롤)을 실제 웹뷰에서 잰다: macOS WKWebView는 Safari 웹 검사기의 타임라인, Windows WebView2는 DevTools 성능 패널. 기준은 TK-10과 같은 프레임 시간 중앙값 16.7ms 이하이고, 결과는 23 SP-09 기록에 남긴다. 기준을 못 넘으면 크롬 흐림을 24px에서 줄이거나 `glass-chrome`을 불투명으로 바꾸는 설정 기본값을 다시 정한다.
- 시각 테스트와 접근성 검사는 외부 서비스에 올리지 않는다(§2.5.8).
- impeccable(§2.5.9)을 사용자가 설치하면 `/critique`·`/audit` 결과를 보조 검토로 쓴다. 테스트 통과 조건에는 넣지 않는다.

### 6.4 정적 검사와 `just` 레시피 [제안]

정적 검사(`just ui-check`, `just verify`에 포함):

| 검사 | 내용 |
|---|---|
| 토큰 생성물 | `@helm/ui-tokens`의 `dist/`가 `src/tokens.ts`에서 다시 생성한 것과 같음. 대비 관문 통과 |
| 스타일 규칙 | `packages/ui/**`, `apps/desktop/src/ui/**`에서 리터럴 색(`#`, `rgb(`, `oklch(`), `dark:` 변형, 임의 값 클래스(`[...]`), 색 알파 수정자, `!important`, 인라인 `style`의 색 금지. Caustic `studio-lint` 규칙 이름(`literal-color`, `no-dark-variant`, `arbitrary-value`, `color-alpha`, `important`, `inline-style-color`)을 따른다 [원문: axiom `scripts/studio-lint.mjs`]. 예외는 `viz/`의 SVG 좌표 계산(색 제외) |
| 재질 규칙 | `glass-chrome`은 `apps/desktop/src/ui/shell/`과 `Surface material="chrome"`에서만, `glass-overlay`는 오버레이 부품(Popover, Menu, Toast, Dialog, Sheet, Tooltip, CommandPalette)에서만. `agent-rim`은 `DraftMark`·진행 중 작업 카드·`AgentActivityIndicator`에서만. Caustic의 `orb*`, `shimmer`, `spectrum-fill`, `frost`, `glass-thin` 등과 임의 `animate-*` 클래스 금지 |
| 가져오기 규칙 | `packages/ui-tokens`는 아무 런타임 패키지도 가져오지 않음. `packages/ui`·`apps/desktop/src/ui`는 `@tauri-apps/*`, Node 모듈, `@helm/client`, `@helm/client-react`, 앱 저장소, `platform`을 가져오지 않음(§3.13, 20 §5.2). `@assistant-ui/*`는 `conversation/`에서만. `RadioGroup`·`Select`·단일 선택 `SegmentedControl`은 `viz/inquiry/`, `viz/StimulusBoard/`에서 가져오지 않음(§3.9 R4). 층 규칙: `primitives` → (없음), `helm` → `primitives`, `composites`·`viz` → `primitives`·`helm`, `shell` → 전부 |
| React 19 규칙 | `forwardRef` 새로 쓰기 금지(ref는 prop). `useOptimistic` 금지. 부품 안 `<form action>`·`useActionState`로 `UiIntent` 보내기 금지(§3.6.1) |
| 위험 HTML | `dangerouslySetInnerHTML` 금지 |
| 문구 | 부품 안의 한국어 리터럴 문자열 금지(이야기·고정 데이터 제외). 문구는 `@helm/ui-language` 키로만(J-103) |
| 아이콘 | lucide 아이콘을 `packages/ui/src/helm/icons.ts`의 의미 표(§3.4)를 거쳐서만 가져옴(화면마다 다른 아이콘을 쓰지 않게) |

`just` 레시피 요구(정의는 06·23, 사용자 규칙상 빌드·검증은 레시피로만):

| 레시피 | 하는 일 |
|---|---|
| `just ui-storybook` | Storybook 개발 서버 |
| `just ui-tokens` | `@helm/ui-tokens` 빌드(대비 관문 포함) |
| `just ui-check` | 위 정적 검사 + 타입 검사 + 토큰 생성물 일치 |
| `just ui-test` | 동작·접근성·키보드·IME·골든·금지 패턴·수명주기·성능 테스트 |
| `just ui-visual` | 정적 Storybook 빌드 → Playwright 시각 테스트(chromium, webkit) |
| `just ui-visual-update` | 기준 이미지 다시 만들기(사람이 차이를 검토한 뒤) |
| `just shot` | 가짜 투영 고정 데이터로 앱 화면(03 화면 ID별)을 띄워 chromium·webkit으로 찍고 `docs/design` 쪽 디자인 기준(04가 정하면)과 나란히 놓는다 |
| `just shot-mac` | `run-on mac`으로 Mac에서 앱을 고정 데이터 모드로 띄우고 창을 찍는다 [가정: Tauri의 WebDriver 자동화가 macOS를 지원하지 않아 [지식] 화면 캡처 명령으로 찍는다] |

`just verify`는 `ui-check`와 `ui-test`를 포함한다. `ui-visual`은 `verify`에 넣지 않는다(22 D22-11). 화면이나 부품을 바꾼 작업의 완료 조건은 `just verify` + `just ui-visual` + `just shot` 비교다(22 §3.12.2, 23 §3.10). 성능 시험(TK-10)은 `just perf`가 돈다.

### 6.5 의존성 목록 [제안]

| 패키지 | 버전 고정 | 용도 |
|---|---|---|
| `react`, `react-dom` | 19.x(결정 41, 현재 19.3) | — |
| `radix-ui` | 1.8.x(peer React 19 포함) | 헤드리스 부품 |
| (시작 소스) shadcn CLI 4.21 radix 바탕 부품 | 생성 시점 고정, 저장소에 복사 | 기본 부품의 출발점. 런타임 의존 아님(§2.5.2) |
| `tailwindcss`, `@tailwindcss/vite` | 4.x | 스타일 |
| `class-variance-authority`, `tailwind-merge` | 0.7.x, 3.x | 변형, 클래스 병합 |
| `lucide-react` | 1.55.x | 아이콘 |
| `@tanstack/react-virtual` | 3.14.x | 가상화 |
| `react-textarea-autosize` | assistant-ui와 같은 버전 | 자동 높이 입력 |
| `react-markdown`, `remark-gfm` | 10.1.x(peer `react >=18`, MIT), 4.0.x(MIT) [검색: npm] | 모델·도구 문장의 마크다운. `skipHtml`, `urlTransform`으로 스킴 제한 |
| `diff` | 9.0.x(BSD-3-Clause) [검색: npm] | Goal·초안 차이 |
| `@assistant-ui/react` | 0.15.28 정확히 | 대화 스레드(§3.10) |
| `geist`, `@sun-typeface/suit` | 1.7.x, 2.0.5 | 글꼴 파일(빌드 때 woff2 복사) |
| 개발: `storybook`, `@storybook/react-vite`, `@storybook/addon-vitest`, `@storybook/addon-a11y` | 10.6.x | 카탈로그·테스트 |
| 개발: `vitest`, `@vitest/browser`, `playwright`, `@playwright/test`, `axe-core` | 고정 | 테스트 |
| `@helm/ui-tokens` 빌드: TypeScript 6, Node 24(판정 44), OKLCH 변환·대비 계산은 자체 코드(`culori` 등 외부 색 라이브러리를 쓸지는 구현자 선택) | — | 토큰 생성 |

`@helm/ui`의 런타임 외부 의존은 위 표의 `react`·`react-dom`(peer), `radix-ui`, `class-variance-authority`, `tailwind-merge`, `lucide-react`, `@tanstack/react-virtual`, `react-textarea-autosize`, `react-markdown`, `remark-gfm`, `diff`, `@assistant-ui/react`(`conversation/`만)다. 모두 React 19를 peer 범위에 넣고 있어 [검색: npm, 위 표] pnpm `peerDependencyRules`는 두지 않는다. 판을 올린 뒤 peer 경고가 나면 규칙으로 덮지 않고 판을 맞춘다(06 §3.4.17 요구에 대한 답).

들이지 않는 것: Caustic React 부품, shadcn 레지스트리 런타임 의존, Base UI, React Aria, assistant-ui Elements·스타일 부품, `@assistant-ui/generative-ui`, 차트·그래프 라이브러리(1차), elkjs, CSS-in-JS 런타임, 굴절(렌즈) 효과 라이브러리.

### 6.6 완료 기준

| 단위 | 완료 기준(테스트로 확인) |
|---|---|
| U1 토큰·스타일 | `@helm/ui-tokens` 빌드가 대비 관문을 통과하고(§3.2.2 표의 값 재현), 생성물이 원본과 일치. neutral이 11단계이고 Caustic 출처가 NOTICE에 있음. 라이트·다크·시스템, 투명도 전체·줄임, 창 효과 켬·끔 전환이 이야기에서 동작. `backdrop-filter` 미지원 모의에서 유리가 불투명으로 바뀜. 한국어 줄바꿈 규칙 적용 확인. 글꼴이 네트워크 요청 없이 그려짐(Playwright 외부 요청 0) |
| U2 L0 | 부품마다 상태 이야기 전부. axe 위반 0. IME·단축키(`KeyboardEvent.code`, 한글 입력 상태) 테스트 통과. `ActionButton` 수명주기 표의 모든 행 테스트 통과. `consequence` 없는 위험 버튼이 개발 모드에서 오류. 모든 부품이 ref prop을 DOM 루트에 넘김. `Surface`가 읽는 글 부품에 유리 재질을 허용하지 않음(타입 검사) |
| U3 L1 | 레코드 종류·품질·작성자·상태 라벨의 모든 값에 이야기와 선형 텍스트 골든. 알 수 없는 값(E30)에서 멈추지 않음 |
| U4 C/A 부품 | 질문 카드: 화면 종류 7종(03 §3.2.4)·깊이 3단계·상태 6종·만료 임박·즉시 승격·묶음 모드·낡은 기준 거부 이야기. "그 밖에" 줄 R2 테스트 통과. 원함 탐구 출처 질문에 추천·다른 선택·`pickOne` 렌더 없음. 결과 확인: 2단계, 네 판정, 확인하지 못한 기준이 있을 때 `consequence` 문구. 반영 항목이 남으면 "완료"가 렌더되지 않음 |
| U5 복귀·셸 | 복귀 요약 9절 모두 렌더, 변화 없음·100건 이상 이야기. 반대 근거·권리 게이트 질문이 접히지 않음. 셸 크롬이 유리, 본문이 불투명. 창 너비 3구간 시각 기준(03 §3.4.2). 확대 200%에서 가로 스크롤 없음(표 제외). 유리 아래 스크롤 성능 기준 |
| U6 근거 | `buildEvidenceTree` 단위 테스트(평탄 목록 → 트리, 공유·순환·고아 노드). 관계 고정 순서, 반대·무효화 비접힘, `repeatOf`, 고아 노드 "볼 수 없는 레코드", `not_searched` 경고, 낡음 표시 이야기. tree 키보드 테스트. 2,000노드 성능 기준 |
| U7 원함 탐구 | 글·그림·링크 자극 이야기. 요소 단위 반응을 마우스와 키보드(부분 고르기 모드, 그림 3×3 격자) 두 경로로 만드는 테스트. "라운드 마치기" 버튼은 언제나 눌린다. 정보성 반응이 있으면 바로 `stimulusRound.close`, `pickLike`뿐이거나 반응이 없으면 05 §3.2.5의 확인 단계(선택 단계 제안 → "그대로 닫기")를 거쳐서만 닫히고 다음 라운드 세 개 비교 안내가 보임(판정 J-34·J-100). 세 개 비교가 비슷한 둘을 고르게 하고 남은 하나의 다른 점을 묻는지. 요소 조각 감싸기와 위치를 못 찾은 요소 처리(E9). 오프라인 "보내지 않음" 반응과 다시 보내기. 기준 후보가 라운드 마친 뒤에만 보임. `statedVsRevealed` 항상 펼침. Goal 수정 제안 차이가 `ins`/`del`로 렌더 |
| U8 나머지 시각화 | 루프 타임라인: 계획 대비 실제(건너뜀 포함), 필터, 혼자 정한 전환의 이의. 발산 표: 세 칸 상태(`filled`·`empty`·`na`)와 해당 없음 이유. `MetricTile`: 값·표본·창·정의 버전·검토 신호·추세 SVG. 다이얼: 층 표시와 잠금. 주의 예산: 한도 있음·없음 |
| U9 대화 | ExternalStoreRuntime 연결 테스트(가짜 저장소): 보낸 글이 스트림 반영 전에는 스레드에 들어가지 않음, 사고 파트 미렌더, 승인 파트 미생성, `@assistant-ui/*` 가져오기가 폴더 밖에 없음 |
| 전체 | `just ui-check`, `just ui-test`, `just ui-visual` 통과. 원천 체크리스트 대응표(§2.3)의 "반영" 항목마다 해당 이야기 또는 테스트가 있음 |

## 7. 미결 사항

해결된 항목(1단계 번호 유지): U-01 화면 ID(03), U-02 화면 이름 "Concern"·"Goal"(03 A1, J-21), U-03 숫자 confidence(J-19: 저장·표시 안 함), U-06 React 19(결정 41), U-08 정보 질문 기본 개수(04 A5), U-09 기준 후보 공개 시점(04 §3.9), U-11 오프라인 결정 대기열 없음(J-02), U-12 감사 깊이 열람 수집(`presence.report.depth`, J-84), U-13 글꼴(Caustic 순서), U-16 이의 사유 선택(J-20), U-21 shadcn 소스 복사(결정 50), U-22 모바일 유리 기본값(26: `reduced`), U-05 주의 예산 단위(14 §3.13.8: 단위 "주의 비용", 화면 이름 "질문").

| ID | 질문 | 선택지 | 추천 기본값 |
|---|---|---|---|
| U-04 | 글 자극 요소의 표현 | 마크다운 원문 구간 / 렌더 뒤 평문 구간 / 요소별 평문 조각 | 요소별 평문 조각(15·04에 요구, E9) |
| U-07 | Caustic 라이선스 표시 | Caustic에 LICENSE 추가 / Helm NOTICE에 출처·허락 기록 | 둘 다. 소유자 확인 필요 |
| U-10 | 사람 메시지를 반영 전 회색 초안으로 보일지 | 안 보임 / 300ms 뒤 초안 | 300ms 뒤 "보내는 중" 초안(저장소에 넣지 않음, 20 `liveTextStore`와 맞춤) |
| U-14 | macOS 최소 버전과 웹뷰 기준 | Safari 17.5 / 18 / 26 | macOS 14.0, 웹뷰 기준 Safari 18(접두사 없는 `backdrop-filter`). 실제 Mac 버전을 사용자에게 확인 |
| U-15 | 강조 색상 | Caustic 기본 205 / Helm 고유 값 | 205 |
| U-17 | Goal 차이의 단위 | 글자 / 어절 / 문장 | 어절 |
| U-18 | `just shot-mac`의 캡처 방식 | 화면 캡처 명령 / 앱 내부 캡처 | `run-on mac` + 화면 캡처 명령 |
| U-19 | (해결) 문구 사전 | — | `@helm/ui-language`가 소유, 부품은 키만 받음(J-103, §3.6.7) |
| U-20 | 에이전트 문장을 serif로(Caustic 정책 4) | 1차 제외 / 적용(Noto Serif KR 번들) | 1차 제외. 2주 사용 뒤 작성자 구분이 부족하면 다시 본다 |
| U-23 | 창 효과 기본값 | 켬 / 끔 | macOS `sidebar` 켬, Windows 11 `mica` 켬, Windows 10 끔. 투명도 줄이기를 따름 |
| U-24 | macOS 26의 Liquid Glass 창 효과 | `sidebar` 유지 / `liquidGlassRegular` 기본 | `sidebar` 기본, 설정에서 선택. Liquid Glass 위에서도 크롬 채움을 덮으므로 대비는 §3.2.2 하한 이상 |
| U-25 | impeccable 사용 | 쓰지 않음 / 구현 단계 보조 검토 | 사용자가 설치하면 구현 단계 보조 검토(§2.5.9) |

## 8. 출처

브리프와 Helm 자료:

- `docs/design/process/00-design-brief.md` §2(결정 1~64, 특히 §2.4b 결정 41~44, §2.4c 결정 47~64), §2.5, §3, §5, §6
- `docs/design/process/rulings-stage2a.md` §1, §2, §3(J-19·J-20·J-21·J-34·J-59·J-60), §4, §7~§9 중 이 문서에 걸린 판정(J-123, J-131, J-132, J-136, J-141, J-150, J-170, J-174, J-176, J-188, J-189)
- `docs/design/process/sources/helm-canon.md` §8.3, §8.9, §10.8, §12.12, §17(friendly 문서 전체, 특히 §17.2 공유 언어, §17.6 UX 문구 지침, §17.7 기술 대응표), §18(product-language.yaml), §21 체크리스트
- `docs/design/process/sources/helm-canon-2.md` §3(CLI 경험 v0.2 전체), §8.6~§8.7(apps/helm-web), §11 체크리스트
- `docs/design/process/sources/helm-canon-3.md` §6(상용 데스크톱 에이전트 UX 조사 전체), §7.1 C1~C13, §7.2 G1~G16, §7.3 I4, §8 체크리스트
- `docs/design/process/sources/conversation-extracts-4.md` §4.8, §6, §13.4, §15, §20, §21 목록(d25 등)
- `docs/design/process/sources/conversation-extracts-1.md`, `-2.md`(d-6), `-3.md` 끝 목록
- `docs/v0.3/00-README.md` §2.4, §5; `02-core-concepts.md` §2~§4, §8, §9; `03-loops-and-transitions.md` §2.1, §8, §9; `04-inquiry-types.md` §2~§8; `06-asking-and-interruption.md` §3~§5; `07-modes-and-capabilities.md` §2~§7; `09-client-opdc.md` 전체; `13-stack-feasibility.md` §2.4; `14-alternative-structure.md` §5

함께 쓰이는 설계 문서(2026-10-12 판):

- `docs/design/03-ux-information-architecture.md` §3.2.2, §3.3(상태 라벨), §3.4(셸 영역), §3.5(내비게이션), §3.6(화면 ID), §3.7, §4, §5.2, §7 IA-Q4
- `docs/design/04-ux-screens.md` §2.3, §3.0(공통 타입·상태·명령 의도·카드 내용), §3.1~§3.26 각 화면의 뷰 모델, ADR 후보 A3~A5
- `docs/design/16-observer-and-metrics.md` §3.24(평가 화면); 판정 J-84(`presence.report.depth`), J-103(`@helm/ui-language`), 다른 문서 요구 표
- `docs/design/19-client-protocol.md` §3.6.3(`view.get`, `ViewResult`), §3.7.5 메서드 표
- `docs/design/20-desktop-app-architecture.md` §3.8.8~§3.8.9(연결 상태), §3.9.1(폴더), §3.9.3(React 19 기능의 쓰임), §3.9.7~§3.9.11(명령·신선도·오류 경계·assistant-ui·설정), §3.14(모바일 공유 경계), §5.2
- `docs/design/05-ux-interaction-and-copy.md` §3.2(자극 반응), §3.8(키보드), §3.9(접근성), §5.2
- `docs/design/13-tools-and-execution.md` §3.6(샌드박스 수준), §3.11.5(보장 성질), §5.2
- `docs/design/15-inquiry-engine.md` `SupportGrade`, `roundClosable`; `docs/design/14-loops-modes-orchestration.md` U-10, `frontSize`
- `docs/design/01-product-brief.md`, `08-domain-model.md`, `09-event-store.md`, `11-asking-and-autonomy.md`, `18-security.md`의 21 관련 요구

Axiom 저장소(읽기 전용, 2026-10-11) [원문]:

- `~/projects/axiom/code/axiom-design-system/README.md`, `AGENTS.md`, `LICENSE`, `package.json`
- `vendor/caustic/FOUNDATION.md`(시각 출처, 층, 색, 대비 정책, 재질, 모션, 정책 1~9), `CONTRIBUTING.md`, `SYNC.json`
- `vendor/caustic/packages/tokens/src/tokens.mjs`(neutral 단계와 의미 대응), `dist/theme.css` 503~527행(유리·에이전트 테두리 유틸리티)
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
- npm 레지스트리(2026-10-12): `radix-ui` 1.8.0, `@base-ui/react` 1.9.0, `react-aria-components` 1.22.1, `@assistant-ui/react` 0.15.28, `react` 19.3.0, `shadcn` 4.21.4, `tailwindcss` 4.3.3, `@tauri-apps/api` 2.12.3, `lucide-react` 1.55.0
- Tauri 설정 참조(`windowEffects`, `WindowEffect`, `transparent`, `macOSPrivateApi`): https://v2.tauri.app/reference/config/
- Claude Code 데스크톱: https://code.claude.com/docs/en/desktop ; Codex 앱 리뷰: https://every.to/p/codex-vibe-check , https://www.gradually.ai/en/changelogs/codex-app/ ; Apple Liquid Glass: https://developer.apple.com/videos/play/wwdc2025/310/
- impeccable 정리 글: https://emelia.io/hub/impeccable-ai-design-skill , https://www.mdskills.ai/plugins/impeccable
- MDN browser-compat-data 8.1.5: `backdrop-filter`, `prefers-reduced-transparency`, `prefers-contrast`, `forced-colors`
- Playwright 릴리스 1.62~1.64: https://github.com/microsoft/playwright/releases ; Storybook 마이그레이션: https://storybook.js.org/docs/releases/migration-guide ; Vitest 시각 회귀: https://vitest.dev/guide/browser/visual-regression-testing

[지식](재확인 안 함): WCAG 2.2 대비·리플로우 기준, WAI-ARIA tree 패턴, W3C Web Annotation Data Model(TextQuoteSelector, TextPositionSelector), Safari의 IME Enter `keyCode 229` 동작, `Intl.Segmenter` 지원, Geist·Geist Mono 라이선스(OFL), Tauri WebDriver의 macOS 미지원.

작업 중 실험 [실험]: `.helm-design-work/P14/contrast.py`(1단계, 버린 Helm 고유 팔레트의 대비 계산), `.helm-design-work/P14/neutral_contrast.py`(2a, neutral 11단계 sRGB 변환, 불투명·유리 최악 배경 대비), `.helm-design-work/P14/glass_table.py`(4단계, 유리 표의 검정·흰색 칸과 `text-tertiary-on-glass`), `.helm-design-work/P14/status_glass.py`(4단계, 유리 위 상태 색 글자).

## ADR 후보

24-adr.md는 P3가 소유한다. 아래는 옮길 후보다. 1단계 후보 2(React 18 유지)는 사용자 결정 41로 해소되어 뺐다.

### ADR 후보 21-1. Caustic 토큰을 복사해 Helm 토큰 원본으로 다시 쓰고 neutral을 11단계로 줄인다

- 상태: 제안(결정 43의 방식)
- 맥락: 결정 43(복사, 의존 없음, neutral 축소). Caustic 토큰은 React와 무관하게 생성되고 대비 관문을 통과한다. neutral 16단계 중 Helm 의미 토큰이 참조하는 단계는 11개다.
- 결정: `packages/ui-tokens/src/tokens.ts`에 값과 의미 대응을 옮기고 Helm 빌드가 CSS·Tailwind `@theme`·DTCG·대비 보고서를 생성한다. 접두사 `--hm-`. neutral 0·50·300·400·500·600·700·850·900·950·1000만 남기고 25·100·150·200·800을 뺀다. NOTICE에 출처를 적는다.
- 근거: 검증된 값과 대비 기준을 다시 만들지 않는다. 의존이 없어 Caustic 변경이 Helm을 깨지 않는다. 뺀 단계 자리는 대비가 같거나 높아진다(§3.2.2 표).
- 기각한 대안: (a) Caustic 고정 사본 + 해시 검사(1단계 안) — 결정 43의 단계 축소와 맞지 않고 이름이 섞인다. (b) npm·git 의존 — 결정 43. (c) Helm 고유 팔레트 — 같은 검증을 다시 해야 한다.
- 결과: Caustic 개선을 자동으로 받지 않는다. 다시 가져올 때 사람이 비교한다.

### ADR 후보 21-2. 유리는 떠 있는 층에만, 재질 두 개, 최악 배경 대비를 빌드 관문으로

- 상태: 제안(결정 41의 구체화)
- 맥락: 결정 41(글래스모피즘). 반투명 위 글자 대비는 뒤에 무엇이 있느냐에 따라 달라지고, 창 효과를 켜면 바탕화면이 비친다.
- 결정: 크롬(84~86%)과 오버레이(90%) 두 재질만 쓰고, 읽는 글·목록·입력·카드는 불투명. 유리 위 대비를 최악 배경(순수 검정·흰색 포함)에서 계산해 빌드 관문으로 둔다. 다크 유리 위 3차 글자는 보조 글자 색을 쓴다.
- 근거: Caustic regular(62~66%) 이하에서는 보조 글자가 4.5:1에 못 미친다(§3.2.2). Caustic 정책 1과 같은 방향이다.
- 기각한 대안: Caustic 재질 다섯 개 모두 사용, 본문까지 유리, 굴절(렌즈) 효과.
- 결과: 유리는 크롬·오버레이의 인상에 그치고, 본문 가독성은 불투명 표면과 같다.

### ADR 후보 21-3. 헤드리스 Radix + shadcn 소스 복사 + Tailwind v4 + lucide-react (React 19)

- 상태: 제안
- 맥락: 결정 41(React 19, 부품 직접 제작). React 19에서는 shadcn 부품의 `forwardRef` 문제가 없다. shadcn 기본 바탕은 2026-07부터 Base UI지만 Radix도 유지된다.
- 결정: `radix-ui` 1.8, shadcn radix 바탕 부품을 시작 소스로 복사해 Helm 소유 코드로 다시 입힌다. Tailwind v4 + cva, lucide-react 1.x.
- 근거: assistant-ui가 Radix에 의존해 헤드리스 라이브러리가 하나로 유지된다. 복사한 소스를 Helm 코드로 고쳐 쓰는 것은 결정 41에 들어간다(결정 50).
- 기각한 대안: Base UI(두 라이브러리 공존), React Aria(스타일 연결 방식 차이), 처음부터 작성(비용), Caustic React 부품(결정 41).
- 결과: 부품 품질의 출발점이 높고, 이후 변경은 Helm이 책임진다.

### ADR 후보 21-4. 창 효과는 macOS `sidebar`·Windows 11 `mica`만, `acrylic`·`blur`는 쓰지 않는다

- 상태: 제안
- 맥락: Tauri v2 `windowEffects`. 문서가 `acrylic`·`blur`의 끌기·크기 조절 성능 문제를 적는다. WKWebView는 `prefers-reduced-transparency`를 모른다.
- 결정: §3.14.3. 설정으로 끄고, OS 투명도 줄이기를 Rust가 읽어 따른다.
- 근거: 성능 문제가 문서화된 효과를 피한다. 크롬 채움(84~86%)을 창 효과 위에 덮으므로 바탕화면이 무엇이든 본문 대비가 10.96:1 이상이다(§3.2.2).
- 기각한 대안: 창 효과 없이 웹뷰 흐림만(인상이 약함), Windows `acrylic`(성능).
- 결과: Windows 10은 불투명. 창이 `transparent: true`라 20이 흰 깜박임 대책(`noRedirectionBitmap` 등)을 둔다.

### ADR 후보 21-5. 토큰과 표현 부품을 플랫폼 중립 패키지로 처음부터 나눈다

- 상태: 제안(결정 42의 구체화, 20 §3.14와 시점 차이)
- 맥락: 결정 42(휴대폰에서 답하기). 20 §3.14는 UI 부품을 지금은 데스크톱 안에 두고 26이 정하면 옮기는 안이다.
- 결정: `@helm/ui-tokens`, `@helm/ui`를 데스크톱 MVP 때부터 만들고, 셸만 `apps/desktop`에 둔다. 플랫폼 API 금지를 패키지 경계로 강제한다.
- 근거: 나중에 옮기는 비용이 없고 규칙을 정적 검사로 지킬 수 있다.
- 기각한 대안: 데스크톱 안에 두고 나중에 옮기기(20 §3.14 안).
- 결과: 06 패키지 목록이 둘 늘어난다.

### ADR 후보 21-6. assistant-ui는 대화 스레드의 primitives와 ExternalStoreRuntime만 쓴다

1단계 후보 4와 같다. React 19에서도 판단이 바뀌지 않는다(peer `^18 || ^19`). 상태·근거·결정은 1단계 판과 같다.

### ADR 후보 21-7. 대안 고르기 금지를 부품 API와 테스트로 강제한다

1단계 후보 5와 같다. J-34에 따라 "가깝다 표시만으로 마칠 수 없음" 가드를 철회하고 15의 `roundClosable`·`pickOnly`(다음 라운드 세 개 비교)와 05 §3.2.5의 확인 단계로 바꿨다.

### ADR 후보 21-8. 화면은 낙관적 도메인 갱신을 하지 않고 결정 의도에 기준 seq를 붙인다

1단계 후보 6과 같다. 04 A4, 20 §3.9.7, J-02와 하나로 합칠 수 있다. 낡은 기준 오류는 `3004 command.revisionConflict`(19), `refreshing` 중에는 막지 않는다(J-59).

### ADR 후보 21-9. 1차에 그래프·차트 라이브러리를 들이지 않는다

1단계 후보 7과 같다.

### ADR 후보 21-10. 부품 카탈로그는 Storybook, 시각 테스트는 Playwright 두 엔진 + 고정 배경

1단계 후보 8에 유리 고정 배경(§6.3)을 더했다.
