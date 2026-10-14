# M-style 기계 검사 결과 (설계 문서 01~26, 2차 검증)

- 대상: `docs/design/01-*.md`~`26-*.md` 26개 문서. 설계 문서는 읽기만 하며 수정하지 않는다.
- 방법: grep과 `python3 -I` 스크립트로 검사한다. 스크립트와 중간 산출물은 스크래치패드에 두고 문서 디렉터리에는 두지 않는다. git 명령, `.helm/private/` 읽기, 하위 에이전트 호출은 하지 않는다.
- 기준: 브리프 §5.1 금지어, §5.2 표시 규칙, J-194의 `[결정 n]` 허용 번호(1~25, 33, 35, 38~43, 47~57)를 적용한다.
- 표기: 위치는 `문서파일:줄`로 적는다. 발췌는 큰따옴표 대신 작은따옴표로 바꾸고 “ ” 안에 넣는다. 금지어는 인용 안에서만 나온다.

## 0. 결과 요약

| 항목 | 결과 | 세부 |
|---|---|---|
| (1) '축' | 위반 0 | 단독 인용 5줄(오탐), 합성어 233회(오탐) |
| (1) '박다/박는/박아' | 위반 0 | 금지어 목록·용어집 인용 5줄(오탐) |
| (1) '가른다/갈라진' | 위반 0 | 인용 5줄(오탐) |
| (1) '닿다/닿는/닿아' | 위반 0 | 인용 4줄(오탐) |
| (1) '시나리오' 제품 사용 사례 뜻 | 위반 후보 3줄 | 01:986, 09:2775, 14:2758 |
| (1) 'A가 아니라 B다' 꼴 | 30건 | 3회 이상 반복: 09(5), 20(4), 10(3), 15(3) |
| (1) 사물 의인화('품는다', '이긴다', '쥐고 있다') | 확정 5건 | 후보 1건(14:3724), 인용 오탐 1줄 |
| (2) 표 열 수 | 불일치 4건 | 10:865, 20:1540, 25:238, 26:1206 |
| (3) 코드 블록 ``` 짝 | 위반 0 | 619개 블록, 열린 채 남은 블록 0 |
| (4) [결정 n] 허용 번호 밖 | 위반 4건 | 번호 26·27·28·29·32 (혼합 대괄호 안의 제안 절) |
| (5) 변경 표시(본문) | 312줄 | K1 공정 단계 153, K2 판 표기 93, K3 검증 차수 10, K4 반영·정렬 43, K5 이전 판 서술 13 |
| (5) 변경 표시(머리말, 참고) | 33줄 | 본문 집계에서 뺐다 |
| (6) 머리말 기준 결정 범위 | 26/26 일치 | 1~57. 라벨은 문서마다 다르다 |

## 1. 금지어와 문체 (항목 1)

### 1-1. '축'

- 판정: 위반 없다. 단독으로 쓰인 '축'은 5줄이며 모두 금지어 목록이나 용어집 인용이다. 아래 줄은 오탐으로 뺀다.
  - `01-product-brief.md:103`
  - `05-ux-interaction-and-copy.md:812`
  - `05-ux-interaction-and-copy.md:1000`
  - `25-glossary.md:826`
  - `25-glossary.md:843`
- 합성어 오탐: '압축' 124회, '단축'(단축키 포함) 92회, '축소' 15회, '구축' 2회. 합계 233회. 모두 '축'의 합성어이며 금지어로 세지 않는다.

### 1-2. '박다/박는/박아'

- 판정: 위반 없다. '박다' 검출 5줄은 모두 인용이다: 01:103, 05:812, 05:1000, 25:827, 25:843.
- 다른 단어 오탐: '샌드박스' 254회, '임박' 31회, '반박' 13회, '깜박이다' 8회, '압박' 2회, '박자' 3회, '박동' 2회. 동사 '박다' 용법은 없다.

### 1-3. '가른다/갈라진'

- 판정: 위반 없다. 검출 5줄은 모두 인용이다: 01:103, 05:812, 05:1000, 25:828, 25:843.

### 1-4. '닿다/닿는/닿아'

- 판정: 위반 없다. 검출 4줄은 모두 인용이다: 05:812, 05:1000, 25:829, 25:843.

### 1-5. '시나리오'가 제품 사용 사례 뜻으로 쓰인 곳

- 검출: 67줄(73회). 판정 결과는 아래와 같다. 나머지 57줄은 결과 탐구 시나리오(사전 부검, 시나리오 셋 등)와 테스트 시나리오(ScenarioScript, 적합성·E2E·장애·통합 시나리오 등)라서 허용한다.
- 위반 후보(유즈케이스라 써야 함) 3줄:
  - `01-product-brief.md:986` — “…런타임을 바꿔도 Goal, 선택, 합의, 남은 위험이 같아야 한다(foundations/10 §9 시나리오의 10단계)…”. 제품 사용 흐름의 10단계를 가리킨다. 원 문서 절 제목을 인용한 것이면 표기 예외로 볼 수 있으므로 확인한다.
  - `09-event-store.md:2775` — “시나리오 후보 `goal.link`, `obligation.transfer`”. 행 머리에 뜻을 정한 정의가 없다. 제품 사용 사례의 후보라면 '유즈케이스 후보'로 바꾼다.
  - `14-loops-modes-orchestration.md:2758` — “원전 CLI-G01 시나리오도 Gate 2개로 끝났다”. 사용 흐름을 가리키므로 '유즈케이스'가 맞다.
- 경계 사례(허용으로 판정, 확인 권고) 4줄:
  - `08-domain-model.md:4051` — 실험 스크립트 시나리오(`helm-toy`)를 픽스처로 옮긴 내용. 테스트 성격이라 허용한다.
  - `09-event-store.md:2557` — “유즈케이스 시나리오 이벤트 열(22 `tests/scenarios/golden/*.golden.jsonl`)”. 골든 테스트 데이터라 허용한다. 복합어 '유즈케이스 시나리오'는 정리할 여지가 있다.
  - `22-testing-strategy.md:1451` — “시나리오 `UC-07/review-notice`”. 테스트 대본 이름이라 허용한다.
  - `22-testing-strategy.md:1972` — “유즈케이스 시나리오 이벤트 열”. 골든 테스트 데이터라 허용한다.
- 용어 규칙 진술 인용(오탐) 3줄: `02-usecases-and-scenarios.md:7`(규칙 문장), `25-glossary.md:667`(규칙 문장), `25-glossary.md:832`(금지 표현 목록).

### 1-6. 'A가 아니라 B다' 꼴 대구 (문서별 건수)

- 기준: 한 문장(또는 표 칸, '/' 목록 항목)에 '가/이 아니라'가 있고 그 문장이 '다'로 끝나는 경우만 센다. 규칙 진술 인용 3줄(05:812, 06:92, 06:336)과 원문 인용 1줄(17:116)은 뺐다.

| 문서 | 건수 | 문서 | 건수 |
|---|---|---|---|
| 01 | 1 | 14 | 1 |
| 02 | 0 | 15 | 3 |
| 03 | 1 | 16 | 0 |
| 04 | 0 | 17 | 2 |
| 05 | 2 | 18 | 0 |
| 06 | 0 | 19 | 2 |
| 07 | 0 | 20 | 4 |
| 08 | 1 | 21 | 0 |
| 09 | 5 | 22 | 1 |
| 10 | 3 | 23 | 0 |
| 11 | 1 | 24 | 0 |
| 12 | 0 | 25 | 1 |
| 13 | 2 | 26 | 0 |
- 합계: 30건. 3회 이상 반복되는 곳은 09(5), 20(4), 10(3), 15(3)이다.

### 1-7. 사물 의인화

- 판정: 사물 주어에 금지 동사를 쓴 확정 위반 4줄(5건)이다:
  - `02-usecases-and-scenarios.md:671` — “마지막 쓰기가 조용히 이기지 않는다”. 기술 관용구('last write wins')를 옮긴 것이지만 사물을 주어로 쓴 '이긴다' 계열이다.
  - `22-testing-strategy.md:635` — “마지막 쓰기가 이기지 않음”.
  - `22-testing-strategy.md:1008` — “마지막 쓰기가 이기지 않음”.
  - `24-adr.md:659` — “서버가 런타임을 품음”, “pi가 Helm을 품음”(2건). 배치 이름을 설명하는 문장이다.
- 위반 후보 1줄: `14-loops-modes-orchestration.md:3724` — “'해 보는 비용이 작음'을 이기는 신호 수”. 신호 수가 비용을 이긴다는 은유다. 확인이 필요하다.
- 인용 오탐 1줄: `25-glossary.md:830`(금지 사례 목록의 '코드가 쥐고 있다', '품는다', '이긴다').
- 검출 전체: '품', '이긴', '이기', '쥐' 계열 845회. 대부분은 명사 합성어(제품·품질·부품·시제품 등)와 명사형 '-기'(줄이기·붙이기 등)라서 오탐이다.

## 2. 표 열 수 (항목 2)

- 검사: 표 1380개, 본문 행 16498행. 이스케이프된 `\|`와 코드 스팬 안의 `|`는 열 구분으로 세지 않았다.
- 불일치 4건:
  - `10-kernel.md:865` — 헤더 2열(L835), 행 7열. 행 머리: “| `policy_proposal` | `policy.change.propose` | X(observer), H | propose/policy_proposal |”
  - `20-desktop-app-architecture.md:1540` — 헤더 4열(L1534), 행 5열. 행 머리: “| `app-dev` | 서버 | Vite 개발 서버 + 브라우저 대체 실행으로 개발 데몬에 붙음(06 정의, 개발 전용). 브라우저는 헤더를 붙일 수 없으므로 ”
  - `25-glossary.md:238` — 헤더 4열(L221), 행 6열. 행 머리: “| 배치 중단 | `batch_stopped`(`NotExecutedReason`) | 순차 배치에서 앞 호출이 실패·차단·승인 대기로 멈추면 뒤 호출을 실행하지”
  - `26-mobile-client.md:1206` — 헤더 2열(L1192), 행 3열. 행 머리: “| 17 | (1) 릴리스에 `web/mobile/`. (2) `helm pair --mobile [--qr]`, `helm push test --device`.”

## 3. 코드 블록 ``` 짝 (항목 3)

- 판정: 위반 없다. 26개 문서 모두 열린 블록이 닫혀 있다. 블록은 619개이다. 문서별 수는 9장에 있다.

## 4. [결정 n] 표기 (항목 4)

- 위반 4건(번호 7회). 모두 대괄호가 `[결정 …]`로 시작하고, 같은 대괄호 안의 `제안:` 절에 사용자 결정이 아닌 번호가 들어 있는 혼합 표기다:
  - `01-product-brief.md:127` — 번호 [26, 27, 28, 29]. 원문 “[결정 19~23, 33, 38, 41; 제안: 결정 26·27·28·29 기본값]”
  - `06-system-architecture.md:283` — 번호 [32]. 원문 “[결정 41; 제안: 결정 32 기본값]”
  - `17-daemon-and-operations.md:76` — 번호 [26]. 원문 “[결정 21, 제안: 결정 26 기본값]”
  - `19-client-protocol.md:213` — 번호 [26]. 원문 “[결정 21, 제안: 결정 26 기본값, 모바일은 결정 47]”
- 판단: 사용자 결정 목록과 제안 절을 한 대괄호에 섞었다. 사용자 결정 부분은 `[결정 …]`에 두고, 제안 절은 `[제안: 결정 n 기본값]`으로 따로 적는다(01:7의 표시 규칙). 엄격히 대괄호 시작 항목만 보면 위반은 0건이다.
- 허용으로 본 것: `[제안: 결정 n 기본값]` 형식 61회(표시 규칙이 정한 조정자 기본값 표기). 번호 없는 `[결정]` 45회. 설명 문장의 자리표시 `[결정 n]` 12줄(03:40, 01:7, 06:6, 07:7, 11:4, 12:6, 14:7, 16:5, 20:60, 21:52, 25:652, 26:6)이다.
- 머리말 일관성 점검: 08·09 머리말의 '사용자 결정 1~25·38~43·47~57, 조정자 기본값 26~37'은 33·35를 조정자 기본값으로 분류한다. 그러나 J-194 허용 목록은 33·35를 사용자 결정으로 본다. 두 기준이 어긋나므로 확인이 필요하다(08:6, 09:6).
- 대괄호 밖 `결정 n`(사용자 결정이 아닌 번호)은 J-194 규칙 대상이 아니라서 세지 않았다.

## 5. 변경 표시: 작업 이력 문구 (항목 5)

- 기준: 본문만 본다. 머리말(첫 `## ` 제목 이전)은 5.6에 따로 둔다. 한 줄은 한 범주에만 넣는다(우선순위 K3 > K1 > K2 > K5 > K4).
- K1 공정 단계 표지: 2a·2b 단독 토큰, '1단계 초안·판·정렬', 'N단계 보완·통합·검증·정렬·판정·대조·개정·정리', 검토 단계 표 '(4단계)'. 제품 출시 단계(2단계 기능, 3단계 TUI 등)는 넣지 않는다.
- K2 판(版) 표기: 'N판'(1판, 2판 등), '보완판', '2026-10-1x 판'. 14:3783의 '리듬 4판'은 다른 문서의 판을 가리키는지 확인이 필요하여 K2에 넣었다.
- K3 검증 차수: '검증 N차', 'N차 검증', '3단계 검증'.
- K4 반영·정렬 이력: 다른 문서나 판정에 반영되었다고 적은 서술과 '옮겼다·지웠다·맞췄다'류 개정 서술. UI 문구와 제품 상태값('반영됨', '읽음 표시')은 뺀다.
- K5 이전 판 서술: 'v0.3에서/의/은/과' 형태의 서술. 'v0.3 NN §' 형태의 출처 인용은 뺀다(5.6 참고).
- 브리프 예시 표지 점검: '4d'와 'W5'는 본문에서 검출되지 않았다. 'W1~W4'는 위협 ID이고 '14d' 등은 기간 표기다. '4c'는 머리말 3건(04, 11, 20)과 본문 '4c 조사' 2건(18:1239, 22:2048)에 있으며, 10-kernel의 '4c 내용'·'상자 4c'는 구조 라벨이다. '반영함'은 1회(09:500)이며 제품 동작 서술이라 뺀다.

### 5.1 K3 검증 차수 (10줄)

- `15-inquiry-engine.md:2842` — “…·J-127·J-128·J-141·J-144, 브리프 결정 47~51과 §5.2, 검증 1차(`process/verification/round-1/` V1~V7)의 15 관련…”
- `17-daemon-and-operations.md:1826` — “…ign-work/coordinator/stage4/by-owner/P11.md`, 검증 1차 `process/verification/round-1/V1~V7`, 09 §3.8…”
- `18-security.md:1240` — “…ign-work/coordinator/stage4/by-owner/P11.md`, 검증 1차 `process/verification/round-1/V1~V7`, 26 2판(`…”
- `19-client-protocol.md:2837` — “…§3.3~§3.4·§5.2, 22 §5.2, 23 §5.2, 07 §3.11.8; 검증 1차 결과(`docs/design/process/verification/round-1/…”
- `23-implementation-plan.md:970` — “…자가 추측한다 | §3.9 절차. 이 문서 §5.2에 지금 아는 불일치를 적었다. 3단계 검증에서 더 나올 수 있다 |”
- `23-implementation-plan.md:1346` — “6. 3단계 검증에서 나온 지적을 반영한다.”
- `25-glossary.md:10` — “…쉬운 말을 적는다. 같은 대상을 문서마다 다르게 부른 곳은 §4 불일치 표에 모아 3단계 검증과 4단계 보완의 입력으로 넘긴다.”
- `25-glossary.md:877` — “- 열 '남은 곳'은 3단계 검증 1차 점검(`.helm-design-work/V2/A-n55-status.md`,…”
- `25-glossary.md:977` — “- 3단계 검증 1차: `docs/design/process/verification/round-1…”
- `26-mobile-client.md:1295` — “검증 1차 지적: `docs/design/process/verification/round-1…”

### 5.2 K1 공정 단계 표지 (153줄)

- `01-product-brief.md:262` — “각 원칙에 판정 질문을 붙인다. 판정 질문은 설계 검토와 2단계 검증에서 '이 설계가 원칙을 지키는가'를 확인하는 데 쓴다.”
- `01-product-brief.md:1037` — “| 08 | (4단계) `HumanOpMeta.followedRecommendation`(J-76)은 받…”
- `01-product-brief.md:1039` — “| 10 | (4단계) R-OP-2 (a): 합의 범위 ⊆ 사람이 직접 고른 선택 범위 검사와 활성 경로…”
- `01-product-brief.md:1043` — “| 14 | (4단계) 진입·강등 기록 방식을 09 `entry.evaluated`와 `structure…”
- `01-product-brief.md:1056` — “### 5.3 다른 문서가 이 문서에 요구한 것과 처리 (2a)”
- `03-ux-information-architecture.md:854` — “2a단계 요구 가운데 각 문서가 반영한 것(09 이벤트 이름, 06 `@helm/ui-…”
- `04-ux-screens.md:2265` — “…정본이고 19 §3.7.1이 그 표를 옮긴다. 이 문서는 대응표를 두지 않는다. 2a단계 요구 가운데 반영된 것(19 `tray`·`settings` 뷰, 복귀 요약…”
- `04-ux-screens.md:2328` — “- 21(P14) 1단계 초안 UI-D02, UI-D03, UI-D05, UI-D08, UI-D11, UI-D1…”
- `05-ux-interaction-and-copy.md:1237` — “2a단계 요구 가운데 반영된 것(11의 권리 게이트 비가정·문장 키·응답 처리·이의 기…”
- `06-system-architecture.md:361` — “…을 따르고 패키지를 더한다 [제안, ADR-06-17(ADR-06-03을 대체). 2a 판정 §2]. 더한 것: `engine`, `client`, `client-rea…”
- `06-system-architecture.md:395` — “…쓰고 연결 로직은 클라이언트만 쓰므로 `protocol`과 나눈다(판정 §2) | 1단계 초안은 이 코어를 `@helm/protocol/client` 하위 경로로 접었다. 그러…”
- `06-system-architecture.md:710` — “- 1단계 초안은 이 코어를 `@helm/protocol/client` 하위 경로로 접었다. 2a…”
- `06-system-architecture.md:748` — “…t`), 21(`ui-tokens`·`ui`), 26(모바일에서의 쓰임). 21이 2a단계 개정을 마치면 경계를 다시 확인한다.”
- `06-system-architecture.md:1273` — “…검증에 쓸 수 있다(`helm config schema`). 17 §3.3.1은 2a단계에서 이 형식(`helmd.toml` + `helmd.local.toml`)으로…”
- `06-system-architecture.md:1872` — “2a단계에서 01~21의 1단계 판과 판정(`process/rulings-stage2a…”
- `06-system-architecture.md:1944` — “### 5.4 4단계 보완에서 다른 문서에 요구하는 것”
- `06-system-architecture.md:2010` — “- `docs/design/process/rulings-stage2a.md`(2a단계 조정자 판정 §1~§9)”
- `06-system-architecture.md:2029` — “- `docs/design/01-product-brief.md`(P1 1단계 초안), `.helm-design-work/P1/notes.md`(MVP 범위)”
- `06-system-architecture.md:2030` — “- 다른 설계 문서 1단계 초안(작성 중 확인, 맞춘 결정은 §5.2): `07-pi-reuse-and-fork.…”
- `06-system-architecture.md:2031` — “- 2a단계에 다시 읽은 설계 문서(2026-10-12 판): 01(ADR P1-5, NF…”
- `07-pi-reuse-and-fork.md:1419` — “| M1 | (해결, 2a) 12 F-4(같은 `tool_execution_start`를 phase로 두 번…”
- `07-pi-reuse-and-fork.md:1453` — “- 2a단계(2026-10-12): `process/rulings-stage2a.md`(판…”
- `08-domain-model.md:239` — “// 1단계 정렬에서 더한 것 (§10)”
- `08-domain-model.md:4223` — “### 10.4 2a단계 통합 (조정자 판정 rulings-stage2a 반영)”
- `09-event-store.md:2714` — “### 10.3 2a단계 통합”
- `10-kernel.md:125` — “| 08 | 1단계 판의 범위 밖 호출을 내용 갈래로 분류(§3.23) | 자격 갈래 `gate.scop…”
- `10-kernel.md:127` — “…pdate`, `checkSettle` | 이 이름으로 정의한다 (§3.11.7, 2a단계에서 12 이름에 맞춤) |”
- `10-kernel.md:185` — “…state.presence)로 읽는다(08 §5.2 (5), 09 §3.4.13, 2a 정렬) */”
- `10-kernel.md:243` — “/** 09 §3.2 envelope 중 커널이 채우는 부분 (2a 정렬: 판정 J-27, 정렬 기록 §B). seq·해시·시각은 engine·09가…”
- `10-kernel.md:478` — “#### 3.3.4 동시성: 대상 revisionSeq [2a단계 정렬: 08 §3.4.2, 09 §3.9.4]”
- `10-kernel.md:535` — “…보내도 거부되므로 내용 갈래 `policy.forbidden_resource`다(2a 판정 §1, 08이 이미 따름). 1판·2판의 `policy.forbidden_r…”
- `10-kernel.md:598` — “…nt | rejected | 합의의 금지 행동·금지 자원, 권한 레이어 deny (2a 판정 §1. 2판의 `denied.forbidden_action`) |”
- `10-kernel.md:865` — “…ubmitted`. 권리 질문을 만들지 않는다: 채택 명령 자체가 사람의 결정이다(2a 판정 J-74). 제안은 관찰 피드와 복귀 요약에 보인다 | `policy.pro…”
- `10-kernel.md:1180` — “08이 정렬 때 더한 R-47~R-55의 집행 명령 [2a단계 정렬]:”
- `10-kernel.md:1196` — “명령 이름은 이 문서가 정본이다(2a단계 판정). 이벤트 이름은 09 §3.4 카탈로그를 따른다. 프로토콜에서 사람 명…”
- `10-kernel.md:1212` — “…ion을 그대로 쓴다(decisionKind·decisionPointKey 포함, 2a 정렬) */”
- `10-kernel.md:1244` — “…rrupt`·`toolcall.report_unknown` | 12 §3.7.3 (2a) |”
- `10-kernel.md:1245` — “…all.report_unknown`, `toolcall.recover` | 12 (2a) |”
- `10-kernel.md:1246` — “…greement.discard` | 09 `agreement.discarded` (2a) |”
- `10-kernel.md:1247` — “…time.boundary`(payload는 14 §3.13.6) | 조정자 지시 (2a) |”
- `10-kernel.md:1315` — “….transition` | R, H (M은 1차 런타임에서 도구로 노출하지 않음, 2a 판정 J-65) | propose/loop_transition | R-30(fro…”
- `10-kernel.md:1377` — “…08(`held`·`failed`·`partial`·`indeterminate`, 2a 판정 J-29) | `prediction.checked` (+ failed면 관찰…”
- `10-kernel.md:1405` — “…itemKey } | { kind: 'link', from, to, rel } (2a 판정 J-36)”
- `10-kernel.md:1406` — “…?: string;                          // 선택 입력 (2a 판정 J-20)”
- `10-kernel.md:1517` — “…// 14 §3.13.6 BoundaryReached. 경계 일곱 값 (2a 판정 J-63)”
- `10-kernel.md:1534` — “(표 계속) 사람 대기 뒤 이어가기는 12 방식이다(2a 판정 J-38): 답이나 복구 기록이 커밋되면 런타임은 기다리던 run을 `run…”
- `10-kernel.md:1543` — “…` 뒤) `toolcall.started` + `approval.consumed`(2a 판정 J-40). 제안 도구(원시 행동 없음)는 `requested`·`start…”
- `10-kernel.md:1545` — “…replaying` (12 §3.7.3) | 08 §3.22.14의 구분을 따른다(2a 판정 J-44, J-05): `externalEffect`가 `true`나 `un…”
- `10-kernel.md:1558` — “…·`completed`와 결과 관찰을 한 트랜잭션에 남길 수 있다(12 §3.4, 2a단계에서 08에 맞춤). 쓰기·보내기·실행에는 쓰지 않는다(§7 K-3).”
- `10-kernel.md:1580` — “…ted | rejected | criteria_wrong). 대응은 08 §10 (2a 판정 J-35)”
- `10-kernel.md:1639` — “…// 09 §3.11.3 p_timers kind와 같은 이름 (2a)”
- `10-kernel.md:1647` — “…ing; scope?: 'this' | 'family_forever' }   // 2a 판정 J-75 // accept(고친 채택 포함)/reject”
- `10-kernel.md:1655` — “…의 범위 안. 질문 다이얼은 11 §3.16. 런타임 자동 상향 행은 두지 않는다(2a 판정 J-66, 진입 문턱은 01의 고정값 2) | `dial.set` / `di…”
- `10-kernel.md:1665` — “#### 3.11.11 2a단계에서 더한 명령과 외부 이름 대응 [제안, 2a단계 판정 §1]”
- `10-kernel.md:1667` — “2a단계 판정은 10을 명령 이름의 정본으로 정하고, 다른 문서가 쓰는 명령 의도·메서…”
- `10-kernel.md:2310` — “2a단계에서 다시 정리했다. 08·09가 받아들인 요구(범위 밖 갈래, `decisio…”
- `10-kernel.md:2314` — “…8 (P5) | (1) 11 §5.2의 질문 필드·`Trigger` 확장. (2) 2a 판정 J-35: 결과 확인 명령 값과 기록 값 대응 한 줄(§10). (3) J-…”
- `10-kernel.md:2338` — “…받으며 프로젝트별 '가벼운 작업' 보관 Concern 아래에서 압축형으로 충족한다(2a 판정 J-01). 규칙 5는 §3.8에서 MVP부터 집행. 사람 결정 경로는 V-…”
- `10-kernel.md:2429` — “| K-3 | 읽기 도구의 의도 이벤트 | (a) 남김 (b) 읽기 빠른 경로 | 2a단계에서 (b)로 정리됨: 08 §3.18.2의 읽기 빠른 경로(한 트랜잭션에 re…”
- `10-kernel.md:2430` — “| K-4 | Quick/Guided/Assured의 위치 | 2a 판정 J-12로 정리됨: 증명 부담 다이얼 값 가볍게/보통/엄격, 기본 보통 |…”
- `10-kernel.md:2431` — “| K-5 | 범위 밖 호출의 갈래 | 2a 판정 §1로 정리됨: 자격(`gate.scope_expansion_required…”
- `10-kernel.md:2439` — “| K-12 | 명령 수 (2a에서 약 150개) | (a) 그대로 (b) 일부를 페이로드 kind로 합침 | (…”
- `10-kernel.md:2572` — “- 상태: 2a단계 판정으로 채택 (조정자 판정 §1)”
- `10-kernel.md:2577` — “- 결과: 08이 2a단계 전에 이미 따랐다(08 §10.1). 범위 밖 = `gate.scope_exp…”
- `11-asking-and-autonomy.md:86` — “…`approval.issued`·`consumed`·`expired`로 기록한다(2a 판정 J-48). 별도 레코드 종류는 두지 않는다.”
- `11-asking-and-autonomy.md:88` — “…ce)는 상태가 바뀔 때만 영속 이벤트 `presence.changed`로 남긴다(2a 판정 J-46·J-64).** 전달 판정이 presence에 따라 달라지므로 같은…”
- `11-asking-and-autonomy.md:99` — “…ne`)는 사람이 정한 경우만이고, 지나면 행동을 하지 않은 채 `expired`(2a 판정 J-49) | Speech Acts 규칙 6, 08 §3.22.7 |”
- `11-asking-and-autonomy.md:105` — “…2·13·14·15·16·19·20이 1판·2판 이름을 인용했으므로 대응을 남긴다(2a 판정 J-26, J-33, 08 §10.2·§10.3).”
- `11-asking-and-autonomy.md:107` — “| 1판 | 2판 | 2a판 (08·09 정본) |”
- `11-asking-and-autonomy.md:176` — “| `deadline` | 권리 질문의 마감. 사람이 정한 경우만 둔다(2a 판정 J-49, §3.3.1 규칙 4) |”
- `11-asking-and-autonomy.md:221` — “질문 종류는 08 `QuestionKind`다(2a 판정 J-26). 종류마다 게이트, 응답 형식, 막는 범위, 기본 전달을 레지스트…”
- `11-asking-and-autonomy.md:235` — “…change.accept`·`reject`·`defer`) 자체가 사람의 결정이다(2a 판정 J-74). 종류는 08 목록에 남는다 |”
- `11-asking-and-autonomy.md:251` — “`recovery` 질문의 게이트(2a 판정 J-05): 외부 효과가 있었을 수 있는 행동의 결과를 사람이 확인하는 것은…”
- `11-asking-and-autonomy.md:266` — “…on.answer)의 값. 미루기·맡기기·다시 세우기는 답이 아니라 따로 명령이다(2a 판정 J-47) */”
- `11-asking-and-autonomy.md:283` — “…t). 기록 값은 08 AcceptanceDecision이며 대응은 08 §10 (2a 판정 J-35) */”
- `11-asking-and-autonomy.md:365` — “…ine`)이 지났을 때만 `question.expired`다(08 §3.22.7, 2a 판정 J-49). 마감이 지나면 대상 행동은 하지 않은 채 끝난다. 침묵을 거절로…”
- `11-asking-and-autonomy.md:576` — “…// 09 question.delivered.urgency (2a 판정 J-52)”
- `11-asking-and-autonomy.md:585` — “/** 14 §3.13.6 작업 경계 일곱 값 (2a 판정 J-63). 09 boundary.reached도 이 값을 쓴다 */”
- `11-asking-and-autonomy.md:712` — “…은 키가 있으면 새 질문을 만들지 않고 `question.updated`로 합친다(2a 판정 J-50, 08 §3.22.7): 근거 합집합, `blocks`는 강한 쪽(…”
- `11-asking-and-autonomy.md:717` — “#### 3.5.6 전달 payload (19·20 요구, 2a 판정 J-52)”
- `11-asking-and-autonomy.md:864` — “…·26). 사람이 이의를 걸면 §3.10의 흐름(재결정 질문, 재작업)으로 간다. 2a판의 '받아서 이의와 같은 효과' 처리는 지웠다. 09 EVENT_META에서 `q…”
- `11-asking-and-autonomy.md:918` — “…isionKind: 'delivery.timing'`)를 같은 트랜잭션에 기록한다(2a 판정 J-51). 계획에 없는 pending 질문은 대기 시간이 지나면 런타임이…”
- `11-asking-and-autonomy.md:924` — “#### 3.8.1 presence (2a 판정 J-46·J-64)”
- `11-asking-and-autonomy.md:1026` — “…itemKey } | { kind: 'link', from, to, rel } (2a 판정 J-36)”
- `11-asking-and-autonomy.md:1028` — “…t_time' | 'note_only';   // 08 ObjectionCore (2a 판정 J-53). 되돌리기를 바라면 reopen + 재작업”
- `11-asking-and-autonomy.md:1033` — “…위자는 사람(채널 human_client, 08 R-16). 이유는 선택 입력이다(2a 판정 J-20). `note_only`면 기록만 하고 대상을 contested로…”
- `11-asking-and-autonomy.md:1099` — “…anceId, steps? }`(08 §3.7 형식 + 선택 필드 `steps`, 2a 판정 J-54)를 넣는다. 가정이 뒤집힌 경우 cause는 그 질문(`qs`)이다…”
- `11-asking-and-autonomy.md:1162` — “### 3.14 권리 게이트 승인과 인자 지문 [제안, 2a 판정 J-40·J-48]”
- `11-asking-and-autonomy.md:1472` — “2a단계에서 다시 정리했다. 08·09가 받아들인 것(질문 `blocks`·`dedup…”
- `11-asking-and-autonomy.md:1476` — “…ources`(§3.6.2). (3) 질문 종류 `goal_achievement`(2a 판정 J-55). (4) `reworkOf.steps`(선택, J-54). (5)…”
- `11-asking-and-autonomy.md:1583` — “| A-3 | 권리 게이트 시간 만료 | 2a 판정 J-49로 정리됨: 시스템이 정하지 않고, 사람이 정한 마감(`deadlin…”
- `11-asking-and-autonomy.md:1585` — “| A-5 | presence를 기준 원본에 둘까 | 2a 판정 J-46·J-64로 정리됨: 상태가 바뀔 때만 영속 `presence.cha…”
- `11-asking-and-autonomy.md:1593` — “| A-13 | 질문 갱신 이벤트 | 2a 판정 J-50으로 정리됨: `question.updated` | - |”
- `11-asking-and-autonomy.md:1594` — “| A-14 | 08에 없는 질문 종류 | 2a 정렬로 08이 대부분 더했다. 남은 것은 `goal_achievement`(J-5…”
- `11-asking-and-autonomy.md:1706` — “…변경을 막지 못한다. 시간 창 승인 — 범위가 넓다. 고친 인자도 같은 tcId(2a판) — 원 인자와 실행 인자가 한 호출에 섞이고 권한 재판정 기록이 없다.”
- `11-asking-and-autonomy.md:1729` — “- 상태: 2a단계 판정으로 채택 (J-46, J-64). 2판의 'presence는 이벤트가 아…”
- `12-runtime-engine.md:2215` — “#### 3.16.3 1단계 이름 → 2a 이름 (09 정본 기준, 판정 J-33)”
- `12-runtime-engine.md:2217` — “| 1단계 12·13 | 2a (09 이벤트 / 10 명령 / 09 trace) |”
- `12-runtime-engine.md:2383` — “### 5.4 4단계 보완에서 다른 문서에 요구하는 것”
- `12-runtime-engine.md:2482` — “…2·J-160·J-164·J-165·J-179·J-183·J-189·J-190)와 4c 조사(`.helm-design-work/coordinator/stage4c/resear…”
- `12-runtime-engine.md:2491` — “- 다른 설계 문서(2a 시점): 01(NFR-C-1·2·6, NFR-O-3, NFR-P-5), 02(UC…”
- `13-tools-and-execution.md:1722` — “- 다른 설계 문서(2a 시점): 01(MVP 도구), 02(UC-02·07·10), 05(§3.10),…”
- `14-loops-modes-orchestration.md:3770` — “…, §3.13.7, §3.16.5, §3.20. 이 문서들은 아직 바뀌는 중이므로 2단계 통합 때 다시 대조한다 |”
- `15-inquiry-engine.md:645` — “…을 거쳐 08의 레코드가 된다. 명령 이름은 10 §3.11.4와 §3.11.11(2a단계에 더한 탐구 명령), 이벤트 이름은 09 §3.4다. 10에 아직 없는 명령…”
- `15-inquiry-engine.md:2841` — “| 2a단계: `process/rulings-stage2a.md`(판정 §1, J-06,…”
- `16-observer-and-metrics.md:2559` — “2a단계의 C-1~C-7은 판정 J-74~J-78, J-84로 모두 해소되었다. 남은…”
- `16-observer-and-metrics.md:2687` — “| 설계 문서 2a 판(2026-10-12): 01 §3.5·§3.8.4·§3.10, 03 §3.6,…”
- `17-daemon-and-operations.md:1565` — “…AIL이면 2로 끝) (2) `ops/bin/build-release HEAD` (2a) 월 비용 상한을 묻는다. 답(USD)은 `~/.config/helm/helmd.…”
- `17-daemon-and-operations.md:1830` — “- 다른 설계 문서(1단계 초안): `docs/design/06-system-architecture.md` §2,…”
- `18-security.md:1239` — “- 4c 조사: `.helm-design-work/coordinator/stage4c/resea…”
- `18-security.md:1243` — “- 다른 설계 문서(1단계 초안): `06-system-architecture.md` §2, `12-runtime…”
- `19-client-protocol.md:2838` — “- 2a단계에서 맞춘 문서: 08 §3.2·§3.4.2·§3.4.7·§3.13·§3.15(…”
- `19-client-protocol.md:2843` — “- 다른 설계 문서(1단계 초안): 01 §NFR·FX-16; 03 §3.2.3~§3.6, §5.2; 04 §3.…”
- `20-desktop-app-architecture.md:110` — “…갖고, 앱은 경로 선택기와 사용자용 상태 계산(순수 함수)만 둔다 | [제안], 2a단계 수정 | §3.8.8, §3.9.3 |”
- `20-desktop-app-architecture.md:681` — “…3.8.8 연결 상태: 19 `HelmClient`와 앱의 경로 선택기 [제안, 2a단계에서 19 §3.10·§3.14에 맞춰 다시 씀]”
- `20-desktop-app-architecture.md:989` — “…# 3.9.4 프로토콜 클라이언트: 19의 `HelmClient`를 쓴다 [제안, 2a단계에서 19 §3.14에 맞춰 다시 씀]”
- `20-desktop-app-architecture.md:1018` — “…코어 사본을 앱에서 고치지 않는다. 필요한 기능은 19에 요구해 코어에 더한다. 2a단계 요구(`blocked`, `retryNow()`, `lastMessageAt`…”
- `20-desktop-app-architecture.md:1796` — “2a단계 요구 중 반영된 것(19의 `TransportFailure.blocked`·`…”
- `20-desktop-app-architecture.md:1907` — “- 2a단계: `docs/design/process/rulings-stage2a.md`(판…”
- `20-desktop-app-architecture.md:1908` — “…특히 J-115, J-118, J-119, J-120, J-136, J-144), 4단계 보완 묶음(`.helm-design-work/coordinator/stage4/by-o…”
- `20-desktop-app-architecture.md:1909` — “- 다른 설계 문서(1단계 초안, 2026-10-11 읽음): `03-ux-information-architect…”
- `21-desktop-ui-system.md:224` — “1단계 판단을 유지한다. 근거 체인은 트리 목록, 루프 타임라인·Goal 이력은 세로 목록,…”
- `21-desktop-ui-system.md:2357` — “2a 판에서 요구한 것 중 06(패키지), 20(창 효과·투명도·키 지도·최소 판·`U…”
- `21-desktop-ui-system.md:2367` — “…greementScope` 이름으로도 내보내기(19 인증 `Scope`와 겹침). 2a 요구(`impact`, 오류 kind, `variants`, 서버 시각)는 19가…”
- `21-desktop-ui-system.md:2604` — “…, `.helm-design-work/P14/neutral_contrast.py`(2a, neutral 11단계 sRGB 변환, 불투명·유리 최악 배경 대비), `.he…”
- `21-desktop-ui-system.md:2657` — “…에서도 판단이 바뀌지 않는다(peer `^18 || ^19`). 상태·근거·결정은 1단계 판과 같다.”
- `22-testing-strategy.md:1334` — “21은 2a에서 개정되었다(결정 41~43: React 19, 직접 만든 부품, 글래스모피즘,…”
- `22-testing-strategy.md:2048` — “- 4c 조사(판정 J-190의 근거): `.helm-design-work/coordinator…”
- `22-testing-strategy.md:2049` — “…§3.14, §6 / 21 §3.2.5, §6.1, §6.3, §6.4, §6.6(2a 개정판) / 26 §2.4, §3.6.2, §6. 시작 때(12:42 무렵)와 끝…”
- `23-implementation-plan.md:383` — “…< 5 ms, `impactOf` p95 < 50 ms. 기록을 남긴다. 넘으면 1단계 판정(§3.1.3-14) | B | 3단계 | `H → S` |”
- `23-implementation-plan.md:782` — “…[제안]', 13 §3.10.1, 01 §3.8.2 | M6-19, M7-20 | 1단계 판정 기록과 13 갱신 커밋. 판정 뒤 M20-02의 완료 조건을 확정한다 | D |…”
- `23-implementation-plan.md:1344` — “…ID·하네스 위치는 반영했다(§3.1.3-6, §3.1.3-13, §3.10). 2b단계 뒤 교차 확인에서 남은 차이(§5.2 22 요구)를 정리한다.”
- `23-implementation-plan.md:1367` — “…설계 문서: `docs/design/01`~`21`, `24`(2026-10-12 2a 진행 중 판). 특히 01 §3.8, 각 문서 §5·§6·§7.”
- `23-implementation-plan.md:1369` — “…m-design-work/coordinator/{pending-launch.md, 2a-common.txt, stage2-and-3-templates.md}`.”
- `24-adr.md:167` — “| ADR-21-01~10 | 21 데스크톱 UI 시스템의 후보(2a 개정판) | §8.19 |”
- `24-adr.md:202` — “- 상태: 대체됨 → ADR-14-07(2a 판정 J-12: 증명 부담 다이얼 `proofBurden` 값 가볍게/보통/엄격,…”
- `24-adr.md:355` — “…ribe` 또는 저수준 루프의 `emit`)의 `message_end`에 연결한다(2a 판정 J-14 문구).”
- `24-adr.md:435` — “…로 읽는다. 로그 경로는 런타임별 홈 폴더이고, Mac에서 연 세션은 대상 밖이다(2a 판정 J-08, 한계로 기록). 관찰 에이전트는 별도 일회성 프로세스로 DB를 읽…”
- `24-adr.md:655` — “…(19~21은 조정자 판정을 옮긴 것). 상태는 따로 적지 않았으면 '제안'이다. 2a단계에서 바뀐 상태는 각 ADR 첫 줄에 적는다.”
- `24-adr.md:766` — “- 기각한 대안: JSON(주석을 쓸 수 없다. 17 1단계 판이 `helmd.json`을 적었고 2a 판정 §2로 TOML에 맞췄다), JSON…”
- `24-adr.md:767` — “- 결과: 06 §3.10의 스키마·핫 리로드 표. 모르는 키는 오류. 2a단계에 운영 한도(`orchestration`, 14), 월 비용 상한(`budge…”
- `24-adr.md:823` — “- 상태: 제안(2a 판정 §2를 반영) · 날짜: 2026-10-12 · 결정자: P3, 조정자 판정…”
- `24-adr.md:878` — “…다. 소유 문서가 정한 뒤 그 문서의 'ADR 후보' 절에 적으면 §8로 옮긴다. 2a단계에서 옮긴 것은 '→ ADR-SS-NN'을 붙였다. 붙지 않은 행은 아직 후보다…”
- `24-adr.md:902` — “2a단계(2026-10-12)에 01~21 각 문서 끝 'ADR 후보' 절의 항목을 옮…”
- `24-adr.md:913` — “### 8.1 옮긴 방식 (2026-10-12, 2a단계)”
- `24-adr.md:919` — “- 21은 2a단계에서 전면 개정했다. 21 행은 개정판(2026-10-12 12:50)의 후보를…”
- `24-adr.md:1130` — “### 8.19 21 데스크톱 UI 시스템 (2a 개정판의 원 번호 21-1~21-10)”
- `24-adr.md:1132` — “21은 2a단계에서 전면 개정했고 후보 번호를 21-1~21-10으로 다시 붙였다. 1단계 판…”
- `24-adr.md:1309` — “…1~05, 07~23, 26의 'ADR 후보' 절(2026-10-12 판. 21은 2a 개정판)”
- `25-glossary.md:128` — “…s`)로 켠다 | — | 01 §3.8, 14 §3.15 | 설계 작업의 '1단계·2a단계·2b단계'(작업 단계)와 다르다 |”
- `25-glossary.md:327` — “…초안으로 넘긴다 | 이미 가정대로 정해졌습니다(이의로 보내기) | J-120 | 2b 판의 '받아서 기록'(08 §10.2)은 J-120으로 바뀌었다 |”
- `25-glossary.md:921` — “…두 값 집합) | 13:47·174가 대응을 적음 | — | 낮음 | (없음) | 2b 판에서 해소 |”
- `25-glossary.md:941` — “### 4.2 2b단계 작업 중 해소된 것”

### 5.3 K2 판(版) 표기 (93줄)

- `01-product-brief.md:1063` — “| 08·09 | 1판 이벤트 이름을 09로, `HumanOpMeta`, 활성 방식 `choice_sco…”
- `02-usecases-and-scenarios.md:100` — “이벤트 이름은 09 §3.4 카탈로그를 쓴다(조정자 판정 §1). 1판 이름과의 대응은 08 §10.3이 정본이다. 이 문서가 자주 쓰는 이벤트:”
- `02-usecases-and-scenarios.md:1231` — “| 08·09 | 1판 이벤트 이름을 09 카탈로그로, RollbackPoint `agreementId`…”
- `02-usecases-and-scenarios.md:1232` — “…, 반영 항목 닫기, 질문 묶임, 동시 명령 충돌 | §3.24(10 §3.4.4 2판 코드), ADR P1-7을 10 R-21에 맞춤, CX-01과 AC-07-13을…”
- `03-ux-information-architecture.md:858` — “…delegated`, `EntryAssessment`). 진입 판정 레코드는 08 2판에 반영되었다 |”
- `03-ux-information-architecture.md:861` — “| 14 | 14 2판에 반영되었다(루프 이름, `opdc:` 의무 ID, 08 `QuestionKind…”
- `03-ux-information-architecture.md:862` — “| 19 | 19 2판에 반영되었다(다이얼 범위 전역·Concern, `record.locate`, 자극…”
- `03-ux-information-architecture.md:864` — “| 21 | 21 2판에 반영되었다(화면 키, 진행 중 서랍 트리, 정한 것 배지 점, 지지 등급·작성자…”
- `03-ux-information-architecture.md:867` — “| 26 | §3.12를 26 2판(§3.5, §5.2 03 요구)에 맞췄다(`SCR-M-ONBOARD`, `choo…”
- `04-ux-screens.md:1480` — “…ected`, 기준이 틀림 = `criteria_wrong`([판정 J-35]). 1판의 `result.acceptWithConditions`·`result.reques…”
- `04-ux-screens.md:2269` — “…missionCore.mobileReviewable`([판정 J-225])은 08 2판에 반영되어 이 문서가 읽는다 |”
- `04-ux-screens.md:2275` — “…운드 닫는 계기 셋, `revealAfterClose.otherField`는 15 2판에 반영되었다. 남은 요구 없음 |”
- `04-ux-screens.md:2278` — “…pt.decision`, 라운드 키 `inquiryId + roundNo`는 19 2판에 반영되었다. (3) `view:settings`에 `notifications.r…”
- `05-ux-interaction-and-copy.md:1241` — “| 08 | `reasonKind`는 08 2판에 반영되었다. 남은 요구 없음 |”
- `05-ux-interaction-and-copy.md:1244` — “| 14 | 14 2판에 반영되었다(`interruptsPerHour` 하나, `attention.sno…”
- `06-system-architecture.md:707` — “…바일은 브라우저가 쿠키를 붙이며, TUI·CLI는 `localAdmin`을 쓴다. 1판의 `credentials` 선택 인자는 없앴다(판정 J-118, 19 §3.14)…”
- `06-system-architecture.md:1893` — “…15 빌드 형태 §3.12.4, 16 린트·형식 §3.12.1, 17 패키지 경계 2판 §3.3·§3.4, 18 기능 플래그 §3.10.3, 19 `RuntimeStor…”
- `07-pi-reuse-and-fork.md:1115` — “…그 | 위와 같은 JSONL. 헤더 `version`은 1.1.0에서 3이고, 1·2판 파일은 pi가 읽을 때 이전한다. 엔트리 11종(`session-format.md…”
- `08-domain-model.md:3846` — “…과하지 않으므로 내용 갈래(`policy.forbidden_resource`)다. 1판의 `policy.scope_exceeded`는 쓰지 않는다.”
- `08-domain-model.md:3850` — “- 다른 문서의 1판 코드(`content.*`, `qualification.*`, `eligibili…”
- `08-domain-model.md:4013` — “| 01·02 | 1판 이벤트 이름(`choice.decided`, `submission.gated`,…”
- `08-domain-model.md:4085` — “…equired` (10) (b) 내용 `policy.scope_exceeded` (1판) | (a). 금지 자원만 내용 갈래 |”
- `08-domain-model.md:4171` — “1판을 쓴 뒤 01~07, 10~21, 24를 읽고 맞춘 결과다. 다른 문서가 이 문서…”
- `08-domain-model.md:4206` — “### 10.3 1판 이벤트 이름 대응 (01·02·10·11에서 쓰인 것)”
- `08-domain-model.md:4208` — “| 1판 이름 | 09 이름 |”
- `09-event-store.md:1792` — “…알 수 없다. 사람은 '다시 시도'를 누를 때 새 키를 쓴다(19·20). 10 1판은 conflict를 이벤트 없이 결과만 저장한다고 적었으나 거부된 시도도 기록에…”
- `09-event-store.md:1937` — “kind 이름은 12·10과 같다. 10 1판 이름의 대응: agreement_valid_until → `agreement_ex…”
- `09-event-store.md:2513` — “| 01·02·11 | 1판 이벤트 이름을 이 카탈로그 이름으로 바꾼다. 대응은 08 §10.3 |”
- `09-event-store.md:2517` — “| 12 | (0) 본문의 1판 이름 `run.completed`·`failed`·`cancelled`·`reco…”
- `09-event-store.md:2628` — “…돌), 버전 검사 없음(옛 화면으로 확정하는 일이 생김), 모든 변경에 버전 올림(1판), 저장소가 decide 전에 비교(1판, 충돌 종류를 못 나눔).”
- `09-event-store.md:2655` — “- 기각한 대안: 소켓 bind 잠금(1판. 소켓이 tmpfs의 `$XDG_RUNTIME_DIR`로 옮겨져 데이터 디렉터리와…”
- `09-event-store.md:2687` — “1판을 쓴 뒤 06, 10~21, 24를 읽고 맞춘 결과다.”
- `10-kernel.md:109` — “…커밋 뒤 실행할 일은 `Directive`(06의 이름 제안을 채택)로 돌려준다. 1판의 `KernelEffect`는 effect class와 단어가 겹쳐 바꿨다(06…”
- `10-kernel.md:508` — “아래 표는 1판의 네 종류 구분을 채널로 옮긴 참고다.”
- `10-kernel.md:688` — “#### 3.4.6 1판 이름 대응”
- `10-kernel.md:690` — “1판(같은 날 먼저 쓴 판)을 참조한 12·15·16·19를 위해 바뀐 이름을 적는다.”
- `10-kernel.md:692` — “| 1판 | 2판 |”
- `10-kernel.md:1206` — “#### 3.11.1 공통 타입과 1판 명령 이름 대응”
- `10-kernel.md:1221` — “1판에서 바뀐 명령 이름(15·16·19가 1판을 참조했다):”
- `10-kernel.md:1223` — “| 1판 | 2판 | 이유 |”
- `10-kernel.md:1458` — “| `agreement.discard` (2판 `agreement.decline_draft`, 같은 명령으로 받음) | M, R…”
- `10-kernel.md:1780` — “| `objection.file` (19, 판정 J-111. 2판 이름 `contest.file`) | `decision.contest` (대상:…”
- `10-kernel.md:1941` — “…ind`로 거부한다(V-FORM 확장). 그래서 전파에 깊이 상한을 두지 않는다. 1판의 깊이 6 상한은 뺀다.”
- `10-kernel.md:2318` — “…) 표에서 생성(도구 이름 = `helm_` + 명령 이름). 13 §3.7.2의 1판 이름(`helm_concern_split`, `helm_rework_plan`,…”
- `11-asking-and-autonomy.md:680` — “…ices, settings, now)`를 불러 푸시를 보낼 휴대폰을 고른다. 26 2판의 규칙 요지 [결정 48]: 휴대폰의 기본 `minUrgency`는 `notice…”
- `11-asking-and-autonomy.md:768` — “…as_`)의 `origin.kind = 'question'`이다(08 §3.8). 1판의 별도 레코드(`wa`)는 두지 않는다. 비막힘 정보 질문을 기록하는 트랜잭션에서…”
- `11-asking-and-autonomy.md:945` — “…resence에 따라 달라지므로 같은 로그로 판정을 다시 해 볼 수 있어야 한다. 2판의 'presence는 이벤트가 아니다'(구 ADR-A7)를 뒤집었다.”
- `11-asking-and-autonomy.md:1082` — “재작업은 새 레코드 종류 없이 WorkUnit으로 표현한다 [제안]. 1판의 `rework.*` 이벤트는 두지 않는다.”
- `11-asking-and-autonomy.md:1590` — “…허용 + 복귀 요약 표시(08) (b) 사람만 | (a). 08 규칙 6과 맞춤. 1판 추천(b)을 바꿨다. 피드에 보이고 사람은 `obligation.reopen` |”
- `11-asking-and-autonomy.md:1703` — “…있다. Mastra는 승인을 인자 지문에 묶고 한 번 쓰면 소진하는 예시를 둔다. 1판은 별도 토큰 레코드(`ap`)를, 2판은 질문 필드와 도구 호출 상태만을 제안했다…”
- `11-asking-and-autonomy.md:1720` — “- 상태: 제안 (1판의 `wa` 레코드를 바꿈)”
- `11-asking-and-autonomy.md:1721` — “- 맥락: 1판은 임시 가정을 전제와 다른 레코드로 두었다. 08은 전제(`as`)에 `origi…”
- `11-asking-and-autonomy.md:1730` — “- 맥락: 1판은 재생과 결정성을 위해 presence를 이벤트로 남기자고 했고, 2판은 19의…”
- `11-asking-and-autonomy.md:1733` — “- 기각한 대안: 모든 접속 변화 영속(1판) — 양이 많다. 이벤트 없이 ctx만(2판) — 전달 판정을 재현할 수 없다.”
- `12-runtime-engine.md:422` — “…가하면 14의 실행기가 WorkUnit을 연다(10의 WorkUnit 시작 명령, 1판 이름 `workunit.open`은 쓰지 않는다). 그 제출이 커밋된 뒤 `sta…”
- `14-loops-modes-orchestration.md:480` — “…과 만료점은 11이 정한다. 위 표의 `gate` 기본값은 11의 판정 입력이다. 1판의 접점 이름(`scope_exceeded`, `rights_permission`,…”
- `14-loops-modes-orchestration.md:618` — “| 제안 종류 | 부류 | 10 명령(2판) |”
- `14-loops-modes-orchestration.md:640` — “…`agreement.report_stop`, `agreement.discard`(1판 `agreement.decline_draft`) |”
- `14-loops-modes-orchestration.md:2696` — “…pec)`(§3.20.2 변환표, `workRequestKey` = 요청 id). 1판의 `workunit.open`은 쓰지 않는다(10 이름 `workunit.prop…”
- `14-loops-modes-orchestration.md:3250` — “이 문서가 쓰는 이름은 아래 정본 이름이다(판정 §1). 1판 후보 이름과의 대응은 §3.20.”
- `14-loops-modes-orchestration.md:3294` — “1판 이름은 쓰지 않는다: `question.raised` → `question.rec…”
- `14-loops-modes-orchestration.md:3355` — “…ointKind`는 `QuestionKind`의 부분집합(`Extract`)이다. 1판 이름 대응: `scope_exceeded` → `scope_change`, `ri…”
- `14-loops-modes-orchestration.md:3359` — “| 작업 경계 명령 | 10 `runtime.boundary`(1판 `boundary.reach`), 09 `boundary.reached` | §3…”
- `14-loops-modes-orchestration.md:3783` — “| episode(§6.3), 리듬 4판(§6.5) | §3.3.3. F04 §6과 F06 §9의 리듬은 F09 §10과…”
- `16-observer-and-metrics.md:2540` — “| 10 §5.2 | 1판 이름(`submission.rejected`, `choice.decided`)을…”
- `19-client-protocol.md:1254` — “- 1판의 `device.rotateToken`(JSON-RPC 결과로 토큰을 돌려줌)은…”
- `19-client-protocol.md:1255` — “- 1판의 `contest.file`은 `objection.file`로, `result.a…”
- `19-client-protocol.md:2403` — “…붙이고, 모바일은 브라우저가 쿠키를 붙이며, TUI는 `localAdmin`이다. 1판의 `credentials` 선택 인자는 없앴다(결정 47, 판정 J-118).”
- `20-desktop-app-architecture.md:904` — “…s` 자산 해석 순서]. 브라우저 대체 실행(§3.13.3)과 같은 코드를 쓴다. 1판의 7.18.4 고정은 React 18 때문이었고 결정 41로 풀렸다.”
- `21-desktop-ui-system.md:2562` — “함께 쓰이는 설계 문서(2026-10-12 판):”
- `22-testing-strategy.md:1982` — “…`storeId`·`deviceId`(FI-29·FI-30). (4) CT-24의 1판 이름(`content.ref_not_found`)을 10 코드로. (5) §6.4…”
- `23-implementation-plan.md:1345` — “5. 26 1판의 §6을 M17에 옮겼다. 26이 바뀌면 M17을 다시 맞춘다.”
- `24-adr.md:135` — “| ADR-06-17 | 패키지 경계 2판: `client` 복원, 클라이언트 공용층(L6c), vendor 3개 | 제안…”
- `24-adr.md:613` — “- 기각한 대안: 한 단계 구조(23 1판).”
- `24-adr.md:821` — “### ADR-06-17 패키지 경계 2판: `client` 복원, 클라이언트 공용층(L6c), vendor 3개”
- `24-adr.md:1017` — “…ttention` | 10 `KernelContext`, 06 §3.4.4. 11 2판의 'presence는 이벤트가 아니다'를 뒤집음 |”
- `24-adr.md:1297` — “…26: ADR-26-01~06으로 옮겼다(§8.22). ADR-26-05는 26 2판(결정 48 반영)으로 맞췄다.”
- `24-adr.md:1302` — “- 14·26: ADR-14-12(채택)와 ADR-26-05 요지는 각 문서 본문(2026-10-14 판)에 맞췄다. 두 문서가 다시 바뀌면 이 절을 다시 맞춘다.”
- `25-glossary.md:225` — “…새 합의로 바뀜 | 08 §3.11.1·§3.22.4, 03 §3.3.2 | 11 1판의 합의 상태(blocked, suspended 등)는 쓰지 않는다(08 §10.2…”
- `25-glossary.md:291` — “…다르다. 쓰지 않음: `concern_switch`, `daily_digest`(1판) |”
- `25-glossary.md:305` — “…보인다(03 §3.2.4) | 08 §3.13(정본), 11 §3.2.2 | 11 1판 이름(`decision_point`, `scope_expansion`, `acti…”
- `25-glossary.md:332` — “…겨서 정해짐 / 에이전트가 정함 | 08 §3.4.5, 03 §3.3.4 | 11 1판 이름 `delegated`·`rule_default`는 쓰지 않는다(11 §2.4…”
- `25-glossary.md:411` — “…넘기는 일. 이벤트가 아니다 | — | 10 §3.1.4, 12 §3.12.4 | 1판 `KernelEffect` |”
- `25-glossary.md:483` — “…목록(개수 표기는 §4 N-49) | — | 09 §3.4(정본, 판정 §1) | 1판 이름 대응은 08 §10.3, 10 §3.4.6, 12 §3.16 |”
- `25-glossary.md:494` — “…쓴다 | — | 09 §3.8.1, 17 §3.1.4, 판정 §2, J-101 | 1판의 소켓 bind 잠금은 쓰지 않는다 |”
- `25-glossary.md:496` — “…ommands`에 저장한다 | — | 09 §3.1, §3.9, 10 §3.3 | 1판 `Submission`(`sb_`)은 쓰지 않는다 |”
- `25-glossary.md:500` — “…초안을 내고, 파생 규칙을 적용하고, 상태를 접는다 | — | 10 §3.1 | 1판 `KernelEffect`·`evolve`는 `Directive`·`apply`(…”
- `25-glossary.md:729` — “…`as`), `rw`(재작업 → WorkUnit `reworkOf`), `sb`(1판 Submission → `cm`), 컨텍스트 투영의 `cx`(→ `cp`, `cx…”
- `25-glossary.md:875` — “…문서마다 다르게 부른 곳이다. 정본은 판정 §1의 소유 규칙과 J-판정을 따랐다. 1판 이름 대응표(08 §10, 10 §3.4.6·§3.11.1, 11 §2.4, 12…”
- `25-glossary.md:943` — “…rValue`에서 맡기기·다시 쓰기·미루기를 별도 명령으로 뺌(J-47), 11의 1판 질문 종류 이름 정리, 13의 포트 7801과 갈래 `qualification`…”
- `26-mobile-client.md:216` — “결정 47을 정한 근거는 1판의 비교(§3.1.2)다: 계정·만료 없이 푸시를 받고, 데스크톱과 화면 코드를 공…”
- `26-mobile-client.md:1266` — “1판의 U-2(웹 기술 사용), U-3(iOS 판), U-4(알림 강도), U-5(An…”
- `26-mobile-client.md:1293` — “설계 문서(2026-10-12 판): `docs/design/process/00-design-brief.md`(결정…”

### 5.4 K4 반영·정렬 이력 (43줄)

- `01-product-brief.md:1213` — “| 발췌 4 (a) a1~a28 | 브리프 결정에 반영됨. a23(기획 먼저)은 이 문서와 02, a24·a25는 §3.1.2·§3.11.…”
- `03-ux-information-architecture.md:682` — “02 1단계의 임시 화면 키(`scr.*`)는 02가 더 쓰지 않으므로 대응표를 지웠다. 02는 이 절의 화면 ID를 쓴다.”
- `04-ux-screens.md:1455` — “…리뷰 의견 미반영                              [미루기]”
- `06-system-architecture.md:1994` — “| O-09 | (해소) 설정 파일 형식 | - | TOML(판정 §2). 17이 맞췄다 |”
- `07-pi-reuse-and-fork.md:134` — “기존 조사 정정(cases §1-3, §13.2)을 이 문서에 반영했다.”
- `07-pi-reuse-and-fork.md:1378` — “각 문서를 다시 읽고 이미 반영된 요구는 지웠다. 남은 요구만 적는다. 판정 번호는 `process/rulings-stage2a.…”
- `07-pi-reuse-and-fork.md:1382` — “| 06 | 대부분 반영됨(vendor 3개, §3.4.1 pi 대응, `@helm/ai/pi`, `@hel…”
- `07-pi-reuse-and-fork.md:1386` — “…ol_execution_executing`)는 12 §3.4.1·§3.4.4 표에 반영됨(M1 해결). 남은 것: (1) §3.1 배치도의 `packages/agent/s…”
- `07-pi-reuse-and-fork.md:1389` — “| 16 | 반영됨(§3.15 외부 pi 세션 로그 행, §3.18.1 `watch`, §3.18.4…”
- `09-event-store.md:2733` — “…`indeterminate`), J-30(`objection.filed`) 채택을 반영했다 |”
- `09-event-store.md:2835` — “02 §3.10 기본 흐름을 이벤트로 옮겼다. seq는 예시다. 같은 줄 묶음(┐)은 한 트랜잭션이다. 단계 번호는 02 표의…”
- `12-runtime-engine.md:1748` — “…대기열은 우선순위를 다시 매기지 않는다. 논리 우선순위는 14가 허가 순서로 이미 반영했다.”
- `13-tools-and-execution.md:941` — “…언 명령)가 들어오며, 선언 넷은 선언 도구로 표시된다. 위 표는 그 결과를 미리 반영했다(`situation_summary`·`watch_sample` 행 없음). 10…”
- `14-loops-modes-orchestration.md:2126` — “…준은 `opdcFocus`로, profile은 다이얼 `proofBurden`으로 옮겼다 |”
- `14-loops-modes-orchestration.md:2278` — “v0.3 05 §6의 '다이얼 기본값' 열을 값으로 옮겼다.”
- `14-loops-modes-orchestration.md:2622` — “…에 의존하는 정도, 맥락 재구성 비용, canon §12.10)를 튜플의 항목으로 옮겼다.”
- `14-loops-modes-orchestration.md:2970` — “…대 3개'는 이 문서에서 표시 개수 설정 `maxVisibleDecisions`로 옮겼다(canon-3 C3).”
- `14-loops-modes-orchestration.md:3304` — “v0.3 03 §9.1의 흐름을 오케스트레이션 단위로 옮겼다. '사람'은 사람 조작이다.”
- `14-loops-modes-orchestration.md:3394` — “…08 `WorkBoundaryKind`, 09 `boundary.reached` 반영됨 |”
- `14-loops-modes-orchestration.md:3782` — “…3.1~§3.3.2. 단계별 입력·출력은 루프 계약의 입력·출력 행(§3.6)으로 옮겼다. 원전의 Decision 상태 전이(Framed, AlternativesIdent…”
- `15-inquiry-engine.md:802` — “…크고 요청이 모호하거나 충돌할 때만 발산한다'(대화 L1566)를 신호 규칙으로 옮겼다.”
- `15-inquiry-engine.md:1564` — “…ope`, `inheritedFrom`, `shownToUserSeq`)는 08에 반영되었다. 엔진은 필드를 다음 뜻으로 쓴다.”
- `15-inquiry-engine.md:1728` — “…proposalId}` · model_open `{inquiryId}`)은 08에 반영되었다. 08은 `field`·`structureTags`를 문자열로 두고 값 목록은…”
- `15-inquiry-engine.md:1878` — “원리와 전이 위험은 지도 원문(helm-canon-3 §3.2)을 줄여 옮겼다. 분야, 구조 서술, 태그, 등급은 이 문서의 [제안]이다. 등급의 뜻은 원전 §…”
- `15-inquiry-engine.md:1953` — “v0.3 04 §5.3을 엔진의 출력 타입으로 옮겼다. 기록은 10 `prediction.propose` → `prediction.re…”
- `15-inquiry-engine.md:2798` — “…만 / 사용자 층 + Goal 층 | 두 층(§3.7.2). 08 §3.17.5에 반영됨 |”
- `15-inquiry-engine.md:2943` — “- 상태: 제안 (08 §3.17.5에 반영됨)”
- `16-observer-and-metrics.md:2515` — “| 08 | (1) 접두사 `or`는 반영됨(J-113). (2) Objection `reasonKind`는 반영됨(08 §3…”
- `16-observer-and-metrics.md:2517` — “…observer.report.submit`의 `form`별 이벤트(§3.4.2)는 반영됨. 사람 명령 payload 마스킹 지점(J-147)을 10 접수 단계 표에 적는다…”
- `16-observer-and-metrics.md:2528` — “…생성(M15-08)과 T6 기준일(M15-09)은 16 §3.27.6·§3.3에 반영했다 |”
- `17-daemon-and-operations.md:166` — “…eue·inbox 파일은 쓰지 않는다(결정 29). 이중 트리거는 16 §3.3이 반영했고, 17은 그 실행 주체가 `helmd` 스케줄러(12)라는 것과 데몬이 꺼진 동…”
- `18-security.md:1195` — “…cade`. (8) 다운로드 티켓은 19 §3.11.2가 정본(18 §3.8.2를 맞췄다). (9) `policy.files`에 기기당 대기 업로드 총량·동시 세션 상한(…”
- `19-client-protocol.md:137` — “…` 결과의 `features`로, `invariants`는 적합성 테스트 항목으로 옮겼다 | §3.4.4, §3.7, §6.3 |”
- `19-client-protocol.md:155` — “| pi-api-facts-2 §6.1 대응표 전체 | 각 행을 반영했다. 전송 추상(리스너와 프로토콜 처리기 분리), strict JSON 검사와 한도…”
- `19-client-protocol.md:1140` — “…(합의 확정·결과 확인은 전용 메서드), J-136(Goal 범위 다이얼 없음)을 반영했다. 10 표와 이 표가 다르면 10 표를 고치게 한다(§5.2). 종류: `ctl…”
- `20-desktop-app-architecture.md:1679` — “…연결 상태, 딥 링크 표, IndexedDB 이름, 폐기·만료 규칙)를 이 판에 반영했다.”
- `20-desktop-app-architecture.md:1806` — “…`storage.dbName`), 딥 링크 해석 표, 폐기·만료 규칙을 이 판으로 맞췄다. |”
- `21-desktop-ui-system.md:308` — “…트 `ink.hover`, 다크 `control.raised-hover`)는 7로 옮겼다. 옮긴 자리는 모두 대비가 같거나 높아진다(아래 대비 표).”
- `21-desktop-ui-system.md:2372` — “…표시) 더하기. TK-02 통과 조건은 22 문장(영향도와 관계없이 위반 0)으로 맞췄다 |”
- `23-implementation-plan.md:1216` — “…와 `done.ts` 판정(ADR-23-09)은 22 §3.8.2·§3.17.1과 맞췄다. 22 색인의 마일스톤 칸에는 이 문서 §6.1의 WBS ID를 쓴다. (2) §…”
- `24-adr.md:1071` — “…| 선호 모델을 사용자 층과 Goal 층 두 층으로 | 제안(08 §3.17.5에 반영됨) | Goal 층이 기본, 두 Goal 이상에서 확정된 기준만 사람 확인으로 사용…”
- `24-adr.md:1296` — “- 21: 개정판(12:50 판)으로 옮겼다. 21이 3단계 전에 후보를 더 고치면 같은 번호로 고친다. ADR-21-05와…”
- `24-adr.md:1298` — “- 22·23: 옮겼다(§8.20·§8.21). 25는 ADR 후보가 없다.”

### 5.5 K5 이전 판 서술 (13줄)

- `01-product-brief.md:78` — “### 2.2 원전·v0.3과 다른 점”
- `03-ux-information-architecture.md:296` — “…14·choice 7 라벨(canon §18.3·§18.4)을 출발점으로 하고, v0.3에서 생긴 상태(질문, 루프, 상황 유형)를 더한다.”
- `03-ux-information-architecture.md:297` — “…집합 7개(질문 정리 중 … 전체 반영됨)를 화면에서 쓰지 않는 방식으로 푼다. v0.3에서 선택 이전 단계(질문 정리, 선택지 검토, 선택 필요)는 질문 상태(§3.3.5)…”
- `03-ux-information-architecture.md:529` — “| 자동화 규칙 | 다이얼·모드(`SCR-DIALS`)와 설정, 관찰 제안 | v0.3에서 자동화 규칙은 모드·다이얼·정책(P)으로 나뉘었다 |”
- `03-ux-information-architecture.md:946` — “…eue, Delegation Board, Assurance View가 따로 있다. v0.3은 질문을 기록과 전달로 나누고 권리 게이트에 결과 확인과 Goal 변경을 넣었다.”
- `04-ux-screens.md:2372` — “- 맥락: 원전과 v0.3의 복귀 요약 구성이 문서마다 다르다(canon-3 I4: SA 3칸, SBAR 5칸…”
- `04-ux-screens.md:2374` — “- 근거: P05 고정 표현 다섯을 모두 포함하고, v0.3의 권리·정보 게이트 구분과 혼자 정한 결정을 더하며, Return Brief 계약…”
- `08-domain-model.md:2672` — “…tigating | deliberating | closed`)는 저장하지 않는다. v0.3에서 이 단계들은 루프(O, I)와 라운드로 표현된다. 화면이 phase 라벨을 원하면…”
- `08-domain-model.md:4136` — “- 맥락: 결정 8과 불변조건 7. v0.3은 Choice에 표시 필드를 더한다고 했지만 루프 계획·전환·상황 판정·분해·라우팅…”
- `08-domain-model.md:4145` — “…nt, ResultSubmission)을 MUST로 둔다. 브리프 §3.2·§6과 v0.3은 Concern, Agreement 등을 쓴다.”
- `10-kernel.md:2466` — “…전이 08 §3.22.4. Decision 7단계 상태 기계는 채택하지 않았다: v0.3에서 Choice는 사람 확정·정책 적용 때만 생기는 레코드이고(08 §2.3) 'Fr…”
- `14-loops-modes-orchestration.md:195` — “…I의 경계). canon §6.2의 [정리]는 Frame을 I에 두지만, Helm v0.3은 상황 판정을 O의 일로 정했고(v0.3 05 §3.2-1) 상황 판정과 문제 정의…”
- `15-inquiry-engine.md:1681` — “…설계하는 연구 방법이었고(`docs/research/README.md` §3), v0.3에서 가능성 탐구 안의 동작으로 옮겼다(v0.3 04 §4.3). 사용자가 '다른 산업…”

### 5.6 머리말 작업 이력 표지 (본문 밖, 33줄, 참고)

본문 집계에서 뺐다. 머리말에도 같은 종류의 표지가 있으므로 함께 정리하는 것이 좋다.

- `01-product-brief.md:3` — “- 작성: P1 기획, 2026-10-11 (1단계 초안)”
- `01-product-brief.md:4` — “- 상태: 설계 초안. 2단계 통합에서 03·06·14·16과 맞춘다.”
- `02-usecases-and-scenarios.md:3` — “- 작성: P1 기획, 2026-10-11 (1단계 초안)”
- `03-ux-information-architecture.md:4` — “- 상태: 4단계 보완판(2026-10-12). 기준 결정 범위는 브리프 결정 1~57이고, 조정자 판정(`process/rulings-stage2a.md` §1~§11, J-01~J-240)을 따른다. 이벤트 09”
- `04-ux-screens.md:4` — “- 상태: 4c 보완판(2026-10-14). 기준 결정 범위는 브리프 결정 1~57이고 조정자 판정(`process/rulings-stage2a.md` §1~§11, J-01~J-240)을 따른다. 화면 ID와 이”
- `05-ux-interaction-and-copy.md:4` — “- 상태: 4단계 보완판(2026-10-14). 기준 결정 범위는 브리프 결정 1~57이고 조정자 판정(`process/rulings-stage2a.md` §1~§11, J-01~J-240)을 따른다. 응답 선택지와”
- `06-system-architecture.md:3` — “- 작성: P3 아키텍트, 2026-10-11 (1단계 초안), 2026-10-12 (2a단계 통합, 4단계 보완)”
- `06-system-architecture.md:4` — “- 상태: 설계 초안 3판. 기준은 브리프 결정 1~57과 `process/rulings-stage2a.md`(이하 '판정') J-01~J-240이다. 모바일 클라이언트는 결정 42·47에 따라 데몬이 서빙하는 PW”
- `07-pi-reuse-and-fork.md:3` — “- 작성: P4 pi 전문, 2026-10-11 (1단계 초안), 2026-10-12 (2a단계 통합, 4단계 보완)”
- `08-domain-model.md:4` — “- 작성: 2026-10-11, 1단계 초안”
- `09-event-store.md:4` — “- 작성: 2026-10-11, 1단계 초안”
- `10-kernel.md:4` — “- 상태: 4단계 보완판 (2026-10-14). 기준 브리프 결정 1~57, 조정자 판정 J-01~J-240. 이전: 4단계 보완판 (2026-10-12), 2a단계 통합판. 조정자 판정(`process/rulin”
- `11-asking-and-autonomy.md:4` — “- 상태: 4c 보완판 (2026-10-14). 기준 브리프 결정 1~57, 조정자 판정 J-01~J-240. 표기는 브리프 §5.2(판정 J-144)를 따른다: `[결정 n]`은 사용자 결정만, 조정자 기본값은 `”
- `12-runtime-engine.md:3` — “- 작성: P7 런타임, 2026-10-11 (1단계 초안), 2026-10-12 2a단계 통합과 4단계 보완”
- `13-tools-and-execution.md:3` — “- 작성: P7 런타임, 2026-10-11 (1단계 초안), 2026-10-12 2a단계 통합과 4단계 보완”
- `15-inquiry-engine.md:3` — “- 문서 번호: 15. 소유: P9(탐구). 작성: 2026-10-11. 상태: 4단계 보완판(2026-10-12). 기준은 브리프 결정 1~57과 조정자 판정(`process/rulings-stage2a.md`)이”
- `16-observer-and-metrics.md:5` — “- 상태: 4단계 보완판(2026-10-12). 기준 결정 범위는 브리프 결정 1~57과 판정 J-01~J-240이다. 이벤트 이름은 09 §3.4, 명령 이름은 10 §3.11, 프로토콜 메서드는 19, 레코드·접”
- `17-daemon-and-operations.md:4` — “- 상태: 4단계 보완판(2026-10-14). 기준 결정은 브리프 결정 1~57과 조정자 판정(`process/rulings-stage2a.md` J-01~J-240)이다. 이벤트 이름과 payload는 09, 명”
- `18-security.md:4` — “- 상태: 보완판(2026-10-14). 기준 결정은 브리프 결정 1~57과 조정자 판정(`process/rulings-stage2a.md` J-01~J-240)이다. 모바일은 결정 47~49와 판정 J-118대로 ”
- `19-client-protocol.md:4` — “- 상태: 4단계 보완판(2026-10-12). 기준 결정은 브리프 결정 1~57과 조정자 판정(`docs/design/process/rulings-stage2a.md` J-01~J-240)이다. 이벤트 이름은 09”
- `20-desktop-app-architecture.md:3` — “- 작성: P13(데스크톱 앱), 2026-10-11. 1단계 초안”
- `20-desktop-app-architecture.md:4` — “- 상태: 4c 보완판(2026-10-14). 기준 결정은 브리프 결정 1~57과 판정 `rulings-stage2a.md`(§1~§11, J-01~J-240)다. 03·04·05·06·07·09·11·16·17·1”
- `21-desktop-ui-system.md:3` — “- 작성: 2026-10-11, P14 UI. 2a단계 개정·4단계 보완 2026-10-12”
- `21-desktop-ui-system.md:4` — “- 상태: 4단계 보완판(2026-10-12). 기준 결정 1~57(브리프 §2), 조정자 판정 J-01~J-240(`docs/design/process/rulings-stage2a.md`)를 반영했다. 사용자 결정”
- `22-testing-strategy.md:3` — “- 작성: 2026-10-12, T1(2b단계 테스트 전략). 기준 결정은 브리프 결정 1~57이다. 01~21, 24, 26과 조정자 판정(`docs/design/process/rulings-stage2a.md`)”
- `22-testing-strategy.md:4` — “- 상태: 2b단계 초안. T2의 23(구현 계획)과 교차 확인 예정.”
- `23-implementation-plan.md:3` — “- 작성: 2026-10-12, T2(2b단계).”
- `23-implementation-plan.md:4` — “- 상태: 4단계 보완판. 브리프 결정 1~57, `process/rulings-stage2a.md`의 판정 J-01~J-240, 2026-10-14 시점의 01~22·24~26을 기준으로 했다. 22(테스트 전략)”
- `24-adr.md:3` — “- 작성: P3 아키텍트, 2026-10-11 (1단계 초안), 2026-10-12 (2a단계: 결정 41~46, 다른 문서 ADR 후보 옮기기; 4단계: 결정 47~51, 판정 J-119~J-151, 26 후보; ”
- `24-adr.md:4` — “- 상태: 설계 초안 3판. 기준은 브리프 결정 1~57과 판정 J-01~J-240이다.”
- `25-glossary.md:3` — “- 작성: 2026-10-12, T3(2b단계), 같은 날 4단계 보완. 기준: 브리프 결정 1~57, 조정자 판정 J-01~J-240, 설계 문서 01~26의 4단계 진행 중 판. 2b단계 대조는 12:47 판(`”
- `26-mobile-client.md:3` — “- 작성: 2026-10-12, P15 모바일 (2a단계에 추가된 문서)”
- `26-mobile-client.md:4` — “- 상태: 2판. 브리프 결정 1~57(§2.4b·§2.4c)과 조정자 판정(`process/rulings-stage2a.md` J-01~J-240)을 따른다. 1판 뒤에 나온 사용자 결정 47(PWA·Web Pus”

- 참고로 세지 않은 출처 표기: 'v0.3 NN §' 형태 인용 753회, '대화 L…' 출처 268회, 'X3-…' 출처 222회, 기간 표기 '7d·14d·28d·30d·90d' 81회, 검사 묶음 라벨 '상자 4a~4c' 10회(10-kernel 구조 라벨), 유즈케이스 단계 번호 '3a·9a·12a' 등, 위협 ID 'T-W1~W4', 테스트 ID 'T18-07b'.

## 6. 머리말 기준 결정 범위 (항목 6)

- 판정: 26개 문서 머리말 모두 '1~57'이다. 라벨은 문서마다 다르다. '기준 결정 범위'는 01, 02, 03, 04, 05, 16 여섯 문서에만 있고, 나머지는 '기준 결정', '기준 브리프 결정', '기준은', '브리프 결정 1~57' 등을 쓴다. 라벨 통일은 선택 사항이다.

| 문서 | 머리말 줄 | 판정 |
|---|---|---|
| 01-product-brief.md | 6 | 1~57 일치 (기준 결정 범위 라벨) |
| 02-usecases-and-scenarios.md | 6 | 1~57 일치 (기준 결정 범위 라벨) |
| 03-ux-information-architecture.md | 4 | 1~57 일치 (기준 결정 범위 라벨) |
| 04-ux-screens.md | 4 | 1~57 일치 (기준 결정 범위 라벨) |
| 05-ux-interaction-and-copy.md | 4 | 1~57 일치 (기준 결정 범위 라벨) |
| 06-system-architecture.md | 4 | 1~57 일치 |
| 07-pi-reuse-and-fork.md | 4 | 1~57 일치 |
| 08-domain-model.md | 6 | 1~57 일치 |
| 09-event-store.md | 6 | 1~57 일치 |
| 10-kernel.md | 4 | 1~57 일치 |
| 11-asking-and-autonomy.md | 4 | 1~57 일치 |
| 12-runtime-engine.md | 4 | 1~57 일치 |
| 13-tools-and-execution.md | 4 | 1~57 일치 |
| 14-loops-modes-orchestration.md | 4 | 1~57 일치 |
| 15-inquiry-engine.md | 3 | 1~57 일치 |
| 16-observer-and-metrics.md | 5 | 1~57 일치 (기준 결정 범위 라벨) |
| 17-daemon-and-operations.md | 4 | 1~57 일치 |
| 18-security.md | 4 | 1~57 일치 |
| 19-client-protocol.md | 4 | 1~57 일치 |
| 20-desktop-app-architecture.md | 4 | 1~57 일치 |
| 21-desktop-ui-system.md | 4 | 1~57 일치 |
| 22-testing-strategy.md | 3 | 1~57 일치 |
| 23-implementation-plan.md | 4 | 1~57 일치 |
| 24-adr.md | 4 | 1~57 일치 |
| 25-glossary.md | 3 | 1~57 일치 |
| 26-mobile-client.md | 4 | 1~57 일치 |

## 7. 환경 메모

- `just --list`와 `just verify`는 모두 `error: no justfile found`를 낸다. `just verify`의 종료코드는 1이었다. 이 저장소와 상위 디렉터리에 justfile이 없으므로 검사 실패가 아니라 환경 문제로 보고한다(CLAUDE.md 종료코드 2 계열). justfile을 새로 만들지 않았고 코드도 고치지 않았다.
- 설계 문서는 수정하지 않았다. 이 파일만 새로 만들었다.

## 8. 오탐으로 뺀 것 (요지)

- '축': 압축·단축(단축키 포함)·축소·구축 합성어 233회, 금지어 목록과 용어집 인용 5줄.
- '박': '샌드박스'·'임박'·'반박'·'깜박'·'압박'·'박자'·'박동' 등 다른 단어 계열 313회.
- '가른·갈라', '닿': 전부 금지어 목록이나 용어집 인용이다. 동사 용법은 없다.
- '시나리오': 테스트 시나리오·결과 탐구 시나리오 57줄을 허용으로 봤다. 규칙 진술 인용 3줄도 뺐다.
- 의인화: '품·이기·쥐' 계열 845회 중 명사(제품·품질·부품 등)와 명사형 '-기'가 대부분이다. 인용 3건(25:830)은 뺐다.
- 'A가 아니라 B다': 규칙 진술과 원문 인용 4줄을 뺐다. '아니라면', '아니라고' 같은 비대구 용법은 세지 않았다.
- 표: 이스케이프된 `\|`와 코드 스팬 안의 `|`는 열 구분으로 세지 않았다.
- [결정 n]: 번호 없는 '[결정]', 자리표시 '[결정 n]'(12줄), '[제안: 결정 n 기본값]' 형식은 위반으로 세지 않았다.
- 변경 표시: 출처 표기(대화 L·X3), 'v0.3 NN §' 인용, 기간·단계 번호·검사 묶음 라벨·위협 ID, 브리프 절 번호 '§2.4c', 작업 디렉터리 경로 '.helm-design-work'(83회), 판정 파일 'rulings-stage2a.md'(48회)는 뺐다.

## 9. 문서별 집계

### 8.1 위반·후보

| 문서 | '축' 위반 | '박다·가른다·닿다' 위반 | 시나리오 후보 | 의인화 위반(후보) | A가 아니라 B다 | 표 열 불일치 | 코드 블록 불균형 | [결정 n] 위반 | 기준 범위 불일치 |
|---|---|---|---|---|---|---|---|---|---|
| 01-product-brief.md | 0 | 0 | 1 | 0(0) | 1 | 0 | 0 | 1 | 0 |
| 02-usecases-and-scenarios.md | 0 | 0 | 0 | 1(0) | 0 | 0 | 0 | 0 | 0 |
| 03-ux-information-architecture.md | 0 | 0 | 0 | 0(0) | 1 | 0 | 0 | 0 | 0 |
| 04-ux-screens.md | 0 | 0 | 0 | 0(0) | 0 | 0 | 0 | 0 | 0 |
| 05-ux-interaction-and-copy.md | 0 | 0 | 0 | 0(0) | 2 | 0 | 0 | 0 | 0 |
| 06-system-architecture.md | 0 | 0 | 0 | 0(0) | 0 | 0 | 0 | 1 | 0 |
| 07-pi-reuse-and-fork.md | 0 | 0 | 0 | 0(0) | 0 | 0 | 0 | 0 | 0 |
| 08-domain-model.md | 0 | 0 | 0 | 0(0) | 1 | 0 | 0 | 0 | 0 |
| 09-event-store.md | 0 | 0 | 1 | 0(0) | 5 | 0 | 0 | 0 | 0 |
| 10-kernel.md | 0 | 0 | 0 | 0(0) | 3 | 1 | 0 | 0 | 0 |
| 11-asking-and-autonomy.md | 0 | 0 | 0 | 0(0) | 1 | 0 | 0 | 0 | 0 |
| 12-runtime-engine.md | 0 | 0 | 0 | 0(0) | 0 | 0 | 0 | 0 | 0 |
| 13-tools-and-execution.md | 0 | 0 | 0 | 0(0) | 2 | 0 | 0 | 0 | 0 |
| 14-loops-modes-orchestration.md | 0 | 0 | 1 | 0(1) | 1 | 0 | 0 | 0 | 0 |
| 15-inquiry-engine.md | 0 | 0 | 0 | 0(0) | 3 | 0 | 0 | 0 | 0 |
| 16-observer-and-metrics.md | 0 | 0 | 0 | 0(0) | 0 | 0 | 0 | 0 | 0 |
| 17-daemon-and-operations.md | 0 | 0 | 0 | 0(0) | 2 | 0 | 0 | 1 | 0 |
| 18-security.md | 0 | 0 | 0 | 0(0) | 0 | 0 | 0 | 0 | 0 |
| 19-client-protocol.md | 0 | 0 | 0 | 0(0) | 2 | 0 | 0 | 1 | 0 |
| 20-desktop-app-architecture.md | 0 | 0 | 0 | 0(0) | 4 | 1 | 0 | 0 | 0 |
| 21-desktop-ui-system.md | 0 | 0 | 0 | 0(0) | 0 | 0 | 0 | 0 | 0 |
| 22-testing-strategy.md | 0 | 0 | 0 | 2(0) | 1 | 0 | 0 | 0 | 0 |
| 23-implementation-plan.md | 0 | 0 | 0 | 0(0) | 0 | 0 | 0 | 0 | 0 |
| 24-adr.md | 0 | 0 | 0 | 2(0) | 0 | 0 | 0 | 0 | 0 |
| 25-glossary.md | 0 | 0 | 0 | 0(0) | 1 | 1 | 0 | 0 | 0 |
| 26-mobile-client.md | 0 | 0 | 0 | 0(0) | 0 | 1 | 0 | 0 | 0 |

### 8.2 변경 표시와 참고 집계

| 문서 | K1 공정 단계 | K2 판 표기 | K3 검증 차수 | K4 반영·정렬 | K5 이전 판 서술 | 머리말 표지 | 참고: v0.3 인용 | 참고: 대화 L | 참고: X3 |
|---|---|---|---|---|---|---|---|---|---|
| 01-product-brief.md | 5 | 1 | 0 | 1 | 1 | 2 | 44 | 52 | 4 |
| 02-usecases-and-scenarios.md | 0 | 3 | 0 | 0 | 0 | 1 | 42 | 20 | 0 |
| 03-ux-information-architecture.md | 1 | 5 | 0 | 1 | 4 | 1 | 18 | 5 | 2 |
| 04-ux-screens.md | 2 | 4 | 0 | 1 | 2 | 1 | 43 | 1 | 6 |
| 05-ux-interaction-and-copy.md | 1 | 2 | 0 | 0 | 0 | 1 | 29 | 1 | 12 |
| 06-system-architecture.md | 11 | 2 | 0 | 1 | 0 | 2 | 8 | 7 | 11 |
| 07-pi-reuse-and-fork.md | 2 | 1 | 0 | 5 | 0 | 1 | 3 | 0 | 5 |
| 08-domain-model.md | 2 | 7 | 0 | 0 | 3 | 1 | 115 | 39 | 29 |
| 09-event-store.md | 1 | 7 | 0 | 2 | 0 | 1 | 9 | 4 | 7 |
| 10-kernel.md | 39 | 12 | 0 | 0 | 1 | 1 | 29 | 5 | 27 |
| 11-asking-and-autonomy.md | 32 | 10 | 0 | 0 | 0 | 1 | 44 | 5 | 11 |
| 12-runtime-engine.md | 5 | 1 | 0 | 1 | 0 | 1 | 8 | 0 | 13 |
| 13-tools-and-execution.md | 1 | 0 | 0 | 1 | 0 | 1 | 3 | 0 | 15 |
| 14-loops-modes-orchestration.md | 1 | 9 | 0 | 7 | 1 | 0 | 127 | 16 | 38 |
| 15-inquiry-engine.md | 2 | 0 | 1 | 7 | 1 | 1 | 114 | 51 | 5 |
| 16-observer-and-metrics.md | 2 | 1 | 0 | 3 | 0 | 1 | 37 | 34 | 11 |
| 17-daemon-and-operations.md | 2 | 0 | 1 | 1 | 0 | 1 | 6 | 0 | 0 |
| 18-security.md | 2 | 0 | 1 | 1 | 0 | 1 | 3 | 0 | 0 |
| 19-client-protocol.md | 2 | 3 | 1 | 3 | 0 | 1 | 8 | 0 | 0 |
| 20-desktop-app-architecture.md | 8 | 1 | 0 | 2 | 0 | 2 | 3 | 0 | 0 |
| 21-desktop-ui-system.md | 5 | 1 | 0 | 2 | 0 | 2 | 28 | 0 | 1 |
| 22-testing-strategy.md | 3 | 1 | 0 | 0 | 0 | 2 | 1 | 1 | 14 |
| 23-implementation-plan.md | 5 | 1 | 2 | 1 | 0 | 2 | 0 | 0 | 5 |
| 24-adr.md | 15 | 6 | 0 | 3 | 0 | 2 | 20 | 27 | 6 |
| 25-glossary.md | 4 | 12 | 3 | 0 | 0 | 1 | 11 | 0 | 0 |
| 26-mobile-client.md | 0 | 3 | 1 | 0 | 0 | 2 | 0 | 0 | 0 |

### 8.3 표·블록 규모

| 문서 | 표 | 본문 행 | 코드 블록 |
|---|---|---|---|
| 01-product-brief.md | 47 | 525 | 5 |
| 02-usecases-and-scenarios.md | 54 | 489 | 1 |
| 03-ux-information-architecture.md | 39 | 455 | 3 |
| 04-ux-screens.md | 56 | 463 | 48 |
| 05-ux-interaction-and-copy.md | 53 | 667 | 7 |
| 06-system-architecture.md | 49 | 581 | 21 |
| 07-pi-reuse-and-fork.md | 38 | 400 | 17 |
| 08-domain-model.md | 49 | 714 | 66 |
| 09-event-store.md | 52 | 680 | 28 |
| 10-kernel.md | 63 | 1005 | 32 |
| 11-asking-and-autonomy.md | 57 | 594 | 23 |
| 12-runtime-engine.md | 52 | 599 | 41 |
| 13-tools-and-execution.md | 41 | 518 | 27 |
| 14-loops-modes-orchestration.md | 86 | 1084 | 44 |
| 15-inquiry-engine.md | 81 | 788 | 55 |
| 16-observer-and-metrics.md | 88 | 859 | 32 |
| 17-daemon-and-operations.md | 42 | 491 | 28 |
| 18-security.md | 42 | 452 | 11 |
| 19-client-protocol.md | 39 | 660 | 41 |
| 20-desktop-app-architecture.md | 51 | 542 | 21 |
| 21-desktop-ui-system.md | 70 | 779 | 36 |
| 22-testing-strategy.md | 83 | 981 | 6 |
| 23-implementation-plan.md | 55 | 707 | 3 |
| 24-adr.md | 26 | 297 | 1 |
| 25-glossary.md | 27 | 791 | 0 |
| 26-mobile-client.md | 40 | 377 | 22 |

