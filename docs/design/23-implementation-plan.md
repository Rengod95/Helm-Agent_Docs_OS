# 23. 구현 계획

- 작성: 2026-10-12, T2(2b단계).
- 상태: 4단계 보완판. 브리프 결정 1~51, `process/rulings-stage2a.md`의 판정 J-01~J-148, 01~22·24~26의 2026-10-12 판을 기준으로 했다. 22(테스트 전략)와 26(모바일)의 레시피·추적 ID·하네스 위치·모바일 작업을 이 계획에 맞췄다.
- 소유: 구현 에이전트 3단계의 운영 규칙과 작업 난이도 등급, 구현 전 사람 작업과 확인 순서, 마일스톤과 그 순서, 작업 분해(WBS), 증거 관문(G0·G1·G2)의 일정과 기능 활성화 단계, 병렬 갈래, 스파이크와 대체 경로, 미결 사항의 처리 시점, 구현 중 설계 변경 절차.
- 소유하지 않음: 각 단위의 상세 명세와 완료 기준(각 문서 §6), 테스트 계층·도구·테스트 ID 체계(22), 기능 플래그의 구조(06 §3.10.3), 레시피의 내용(06·07·15·17·20·21), 모바일 클라이언트의 방식(26).

## 1. 목적과 범위

### 1.1 이 문서가 정하는 것

제품 소유자는 설계가 끝난 뒤 Helm을 한 번에 구현한다(브리프 §1). 이 문서는 그 구현을 구현 에이전트가 표를 따라 진행할 수 있는 순서와 단위로 나눈다.

1. 구현을 시작하기 전에 사람이 할 일과 그 확인 순서(§3.2).
2. 구현 에이전트 3단계의 역할, 난이도 등급 기준, 작업 분할 규칙(§3.1)[결정 51].
3. 마일스톤 M0~M19의 목표, 선행, 완료 기준, 예상 규모(§3.3, §3.4).
4. 마일스톤별 작업 분해(WBS). 작업 하나마다 내용, 산출 파일, 근거 문서·절, 완료 조건, 난이도 등급, 담당 단계, 모델을 둔다(§3.4).
5. 증거 관문 G0·G1·G2를 마일스톤과 기능 활성화 단계 사이에 두는 방법과 기능 플래그 기본값(§3.5).
6. 병렬 갈래와 임계 경로(§3.6).
7. 위험이 큰 작업, 먼저 하는 스파이크, 각 위험의 대체 경로(§3.7).
8. 각 문서의 미결 사항 중 구현 전에 정할 것, 측정으로 정할 것, 기본값으로 진행할 것(§3.8).
9. 구현 중 설계를 바꾸는 절차(§3.9).
10. just 레시피의 도입 시점과 `just verify` 구성의 변화(§3.10).

### 1.2 다루지 않는 것

- 날짜 일정. 1인과 에이전트로 구현하므로 달력 일정을 두지 않는다. 규모는 상대 크기와 소스 줄 수 범위로만 적는다 [가정].
- 테스트를 어느 계층에 두고 어떤 도구로 돌리는지(22). 이 문서는 각 문서 §6의 테스트 ID를 완료 조건으로 인용만 한다.
- 이후 단계(외부 런타임 어댑터, MCP, 이미지 생성 자극, 자동 업데이트)의 구현 세부. 범위 밖으로 표시하고 계기만 적는다(§3.4.21).
- 모바일 클라이언트의 방식과 화면 명세(26). 이 문서는 26 §6의 단위를 M17 표(이 문서 §3.4.18)로 옮기기만 한다.
- 다른 설계 문서의 내용 수정. 고칠 것은 §5.2에 적는다.

### 1.3 읽는 법

- 구현 에이전트: §3.1(작업 규칙) → 맡은 마일스톤의 §3.4 표 → 표의 "근거" 열에 적힌 문서 절. 표의 완료 조건이 그 문서 §6과 다르면 그 문서 §6을 따르고 §3.9 절차로 이 표를 고친다.
- 제품 소유자: §3.2(사람 작업), §3.5(관문), §3.7(스파이크), §3.8.1(구현 전 결정할 것).

## 2. 전제와 결정

### 2.1 이 문서가 기대는 결정

| 근거 | 내용 | 이 문서에 미치는 것 |
|---|---|---|
| 브리프 §1(제품 소유자의 요청, design-log §0) | 설계가 끝난 뒤 한 번에 구현한다 | 2단계·3단계 기능까지 구현 범위에 넣는다(M16~M19) |
| [판정 J-11], 01 ADR 후보 P1-5(채택) | 한 번에 구현하되 2단계 기능은 G1 기록 전까지 기본 꺼짐 | 관문은 기능 활성화 단계 A2·A3로 지키고 구현 순서는 막지 않는다(§3.5) |
| [결정 19], [결정 39] | 데스크톱 앱 먼저, SSH TUI는 이후 단계 | M13(데스크톱) → M19(TUI) |
| [결정 42], [결정 47]~[결정 49] | 휴대폰 응답은 데스크톱 MVP 다음 단계. 데몬이 서빙하는 PWA와 Web Push, 알림은 `interrupt`·`notice`, 최소 iOS 26, Android 제외 | M17, 2단계 플래그 `clients.mobile` |
| [결정 41], [결정 50] | 데스크톱 React 19, 부품 직접 제작(shadcn 소스 복사 포함) | M13a |
| [결정 51] | 구현 에이전트 3단계(1단계 메인 오케스트레이터 Opus 5.5 high, 2단계 하위 조정자 Opus 5.5 medium 또는 Sonnet 5.5 medium, 3단계 실작업자 Sonnet 5.5 medium 또는 Haiku 5.5 max). WBS 작업마다 난이도 등급과 담당 단계·모델을 적는다 | §3.1.1·§3.1.2, §3.4 모든 표의 등급·담당·모델 열, §3.9.2 |
| [판정 44] | Node 24 LTS, TypeScript 6.0, pi 기준 `v1.1.0` | M0 도구 고정, M5 vendor 기준 |
| [판정 45] | 데몬은 시작 단계에서 비밀을 받아 메모리에만 둔다 | M11-03, 사람 작업 HT-04·HT-12 |
| [판정 46] | 루프백 바인딩은 격리 경계가 아니다 | 리스너 인증(M11-04)과 도구 격리(M6-10)를 MVP 필수로 둔다 |
| [결정 40] | 설계 문서는 `docs/design/`, push는 사용자 확인 뒤 | 구현 브랜치도 같은 규칙(§3.1.1) |
| 사용자 규칙(`~/.claude/CLAUDE.md`) | 빌드·검증·배포는 just 레시피로만. `just verify` 통과 = 완료. 종료 코드 2는 환경 문제로 보고하고 코드를 고치지 않는다. iOS·macOS 빌드는 Mac(`run-on mac`). 커밋은 브랜치에서, push·PR·병합은 사용자 확인 뒤. 화면은 `just shot`으로 비교 | 모든 WBS 행의 공통 완료 조건(§3.1) |
| 01 §3.8 | 단계표(MVP·2단계·3단계·이후), MVP 완료 기준 5개, 관문 G0·G1·G2 | 마일스톤 경계와 M15 완료 기준 |
| 06 §3.3·§3.4.1 | 패키지 목록과 의존 허용 표 | 의존 그래프(§3.3)의 원본 |

### 2.2 이 문서의 결정 요약 [제안]

| ID | 결정 | 근거 절 |
|---|---|---|
| D23-1 | 마일스톤의 뼈대는 패키지 의존 순서다(domain → store·kernel → engine → runtime → orchestration → daemon → 앱). 각 마일스톤 안에서는 C/A를 먼저 만든다(10 §5.2, 11 §5.2, 브리프 §3.5, 대화 X3-8-28) | §3.3 |
| D23-2 | `store`와 `kernel`은 둘 다 `domain`에만 의존하므로 M1 뒤에 병렬로 만든다. `protocol`과 vendor·UI 시스템도 이른 갈래로 띄운다 | §3.6 |
| D23-3 | 구현은 M19까지 멈추지 않는다. 관문은 기능 활성화 단계로 지킨다: G1 기록 뒤 A2(2단계 켜기), G2 기록 뒤 A3(3단계 켜기). 2단계·3단계 코드는 기본 꺼짐으로 운영 데몬에 들어갈 수 있다 | §3.5 |
| D23-4 | G0(15 E0)는 탐구 엔진의 순수 부분과 평가 하네스(M9a) 뒤에 둔다. 코드 연결을 미루는 대신 MVP 실사용 시작(M15-08)을 G0 기록 뒤로 둔다 | §3.5.2 |
| D23-5 | G1 창(MVP 실사용 14일) 동안 운영 데몬 갱신은 MVP 결함 수정과 기본 꺼짐 코드만 허용하고, 갱신마다 릴리스 ID를 관문 기록 Concern에 남긴다 | §3.5.3 |
| D23-6 | 위험이 큰 작업은 해당 마일스톤 첫 작업 전에 스파이크로 확인한다. 실패하면 정해 둔 대체 경로로 가고 ADR을 남긴다 | §3.7 |
| D23-7 | `just verify`는 서버에서만 돈다. GitHub Actions는 Windows 데스크톱 빌드(수동 실행·태그)에만 쓴다. 기존 `ci.yml`·`publish.yml`은 M0에서 지운다(06 §2.5가 23에 맡김, 06 O-11) | §3.4.1 |
| D23-8 | 통합 브랜치 `impl/helm-v1` 하나, 갈래 브랜치, 실작업자 worktree를 둔다. 갈래 브랜치에서는 자유롭게 커밋하고, 통합 브랜치로의 병합은 마일스톤 끝과 중간 병합 지점(§3.6.3)에서 1단계가 사용자 확인을 받아 묶어서 한다 | §3.1.1, §3.6.3 |
| D23-13 | 구현 에이전트는 3단계다[결정 51]. 작업마다 난이도 등급 A~D를 매기고 등급에서 담당 단계와 모델을 정한다. 실작업자 한 명이 맡기 큰 행은 하위 조정자가 나눈다 | §3.1.1, §3.1.2 |
| D23-9 | 테스트 제목 앞에 22의 추적 ID(`<문서 번호>/<ID>`, 예: `12/T-RT-01`, `10/PT-07`, `19/CT-12`)를 쓴다(22 D22-2). 추적 색인은 M0에서 전부 옮기고, 끝난 WBS 행 집합으로 판정한다. 마일스톤을 마칠 때 `just test-all`(22 §3.15.3)을 돌린다 | §3.1.3 |
| D23-10 | 이벤트·명령·메서드·오류 코드 카탈로그는 코드 등록 표와 설계 표가 어긋나지 않게 검사 스크립트(`scripts/docs/check-catalog.ts`)를 `just verify`에 넣는다 | §3.9.4 |
| D23-11 | MCP, 외부 런타임 어댑터, 이미지 생성 자극, 자동 업데이트, `send` 확장(메일·메시지)은 이번 일괄 구현 범위 밖이다. 인터페이스와 적합성 틀(M7-14)만 MVP에 둔다 | §3.4.21 |
| D23-12 | 설계 시제품(`.helm-design-work/P4/fork-proto`, `P7/exp-bwrap*.sh`)은 Git 밖에 있으므로 M0에서 `experiments/design-prototypes/`로 옮겨 추적한다 | §3.4.1 |

### 2.3 원천의 순서 제안과 이 계획의 대응

| 출처 | 제안 | 이 계획 |
|---|---|---|
| 대화 X3-8-28, 01 §3.8.1 | 레코드·로그·권한 → C/A → O → I → 거시 스케줄러 → 돌아보기. 원함 탐구는 MVP 안에서 마지막 | M1~M4(레코드·로그·권한) → M3 안 C/A 먼저 → M8 안 C/A → O → I.fact → 거시 스케줄러 → A.reflect, M9b에서 I.want 연결 |
| 10 §5.2 "22·23", 11 §5.2 "23" | 커널과 C/A 명령, 질문 핵심(권리 게이트, 결과 확인, 가정·만료)을 첫 마일스톤에 | M3-05·M3-06을 커널의 첫 명령 작업으로 둔다 |
| 07 §5.2 "23" | V1~V5는 1차 런타임보다 먼저 | M5·M6이 M7보다 앞선다 |
| 15 §5.2 "23" | E0 관문을 탐구의 E/N 정식 연결 전에. REPL은 뒤 단계 | D23-4, REPL은 M16-11 |
| 16 §5.2 "23" | 어댑터·정규화·마스킹 → 지표 사실·스냅샷 → 탐지기 → 모델 판정·제출 → 효과 측정 | M14(앞의 셋), M16-09(뒤의 둘) |
| 17 §5.2 "23" | 잠금·시작·종료 순서 → 백업·복원(첫 실제 사용 전 필수) → 업그레이드 → 훈련·유지 타이머 | M11-02 → M11-09 → M11-11, 첫 실사용(M15-08) 전에 백업·복원 확인 |
| 19 §5.2 "23" | 프로토콜 등록 표 + 가짜 데몬 + 적합성 스위트를 먼저, 그 위에 데몬과 앱 | M10-01~04가 M11-05·M13b보다 앞선다 |
| 20 §5.2 "22·23·24" | 코어·가짜 서버 → `@helm/client-react` → 앱 골격·Rust WSS → 동기화·캐시 → SSH → OS 통합 → 빌드·배포 | M10 → M13b-01~08 → M13d |
| 21 §6.2 | U1 토큰 → U2 L0 → U3 L1 → U4 C/A → U5 복귀·셸 → U6 근거 → U7 원함 → U8 나머지 → U9 대화 | M13a-01~09 |
| 14 §3.15 | 기능 플래그로 어느 순서로 만들든 켜고 끌 수 있게 한다. MVP 루프 묶음 | §3.5.4 |
| 06 §5.3 "23" | 첫 마일스톤에 S0~S5. 구현 시작 전 제품 폴더 뼈대를 사람이 만든다 | S0~S2는 M0, S3·S5는 데몬(M11)에 둔다. S3·S5를 M0에 넣으면 데몬 패키지 전체를 미리 만들어야 해서 의존 순서와 어긋난다. 대신 S4(엔진)는 M4, S5의 리스너 동등성은 M11-05에서 확인한다 |
| 원전 canon-2 §1.24(`experimental.v0` 이행 단계 Phase 0~5) | 0 동결과 결함 fixture 보존 → 1 계약과 결정적 커널 → 2 자체 에이전트 세로 조각 → 3 상호작용 시뮬레이션·측정 → 4 이식 어댑터 → 5 GUI | Phase 0은 M0-01(이전 구현을 `legacy/`로, 승격하지 않음)과 22 §3.7.7 대응표, Phase 1은 M1~M4, Phase 2는 M5~M9(CLI 대신 데몬 + 데스크톱이 세로 조각), Phase 3은 G0·G1, Phase 4는 외부 어댑터(범위 밖, 이 문서 §3.4.21), Phase 5(GUI)는 [결정 19]에 따라 M13으로 앞당겼다 |
| 원전 canon-2 §9.15(실행 후보 재사용 범위) | `helm-kernel-v02`의 계약·테스트 성질 재사용 | 코드는 가져오지 않는다. 테스트 성질만 22 §3.7.7 대응표로 옮기고 M3-10에서 쓴다 |
| 원전 canon §16.13(v0.2 수락 기준)·§16.14(다음 작업) | 수락 기준 9개, 다음 작업 7개 | 유효한 수락 기준의 확인 위치: #3(강도와 불변조건) → M8-04(14 C-10)·M3-10, #6(형식 통과 쓰레기 입력) → M15-01(02 UC-06 수용 기준), #8(제출·확인·반영 생략 손실) → G1-2, #9(원본 재열람과 방향 수정 비용) → G1-1. #1·#2는 결정 23으로 정리되었고 #7(두 런타임 재현)은 외부 어댑터 단계다. 다음 작업 중 6(실험 코어를 승격하지 않고 새 경계로 구현)은 M0-01·M1~M4가 맡고, 7(다른 런타임 비교)은 외부 어댑터 단계다. 1~5는 문서 정리라 설계 단계에서 끝났다 |
| 원전 canon §17.7(crosswalk 도입 순서)·§13.9(변경 원칙) | 원전 이름과 Product Domain 이름의 도입 순서, 사용자 소유 문서 자동 덮어쓰기 금지 | 도입 순서는 08 A08-5(코드는 브리프 이름, 화면은 03 이름)로 대신했다. 변경 원칙 5(사용자 소유 문서 자동 덮어쓰기 금지)는 Docs-Agent OS 범위라 넣지 않는다(06 §2.5) |
| 원전 canon-3 §6.13(검증 순서와 Slice A~D) | Resumption → Concern Room → Bounded execution → Acceptance and Integration | 14 §3.15의 L1~L4 대응을 따른다. 이 계획에서는 M8(O·C/A) → M9b(I) 순서와 G1 항목(G1-1 복귀, G1-2 C/A, G1-3 원함 탐구)이 같은 순서를 확인한다 |

### 2.4 시작 시점의 저장소와 서버 상태

2026-10-12 서버에서 확인했다 [실험].

| 항목 | 상태 | 처리 |
|---|---|---|
| 저장소 | `design/helm-v1` 브랜치. 루트에 이전 구현(`packages/helm-*`, `packages/agent-docs-init`, `apps/helm-web`), npm workspaces `package.json`, `.github/workflows/{ci,publish}.yml`, `experiments/*`. justfile 없음 | M0-01(06 §2.5) |
| 제품 폴더 | `~/projects/helm/`에 `code/`만 있다. `PRODUCT.md`, `secrets/` 없음 | HT-02, HT-03 |
| 도구 | Node 24.19.0, pnpm 11.21.0, just 1.58.0, gitleaks 8.30.1, lefthook 2.1.16, gh 2.102.0, `secrets` CLI 있음 | `.mise.toml`로 고정(M0-03) |
| 없는 도구 | bubblewrap, cargo·rustup, sqlite3 CLI | HT-05, HT-06. sqlite3 CLI는 필요 없다(검사는 better-sqlite3로 한다) |
| 설계 시제품 | `.helm-design-work/P4/fork-proto`(vendor 패치 적용본, 업스트림 테스트 173건 통과, 계약 시험), `.helm-design-work/P7/exp-bwrap*.sh`(bwrap 9개·8개 확인, 압축을 푼 0.9.0 패키지로 실행). `.helm-design-work/`는 `.git/info/exclude`에 있어 Git 밖이다 | M0-02로 옮긴다(D23-12) |

## 3. 명세 본문

### 3.1 구현 에이전트 구조와 작업 규칙

#### 3.1.1 에이전트 3단계 [결정 51]

| 단계 | 모델·추론 | 맡는 일 | 하지 않는 일 |
|---|---|---|---|
| 1단계 메인 오케스트레이터 | Opus 5.5, high | 마일스톤 진행과 갈래·하위 조정자 배정, 중간 병합 지점과 마일스톤 끝의 통합 판단(병합 요청을 묶어 사용자 확인을 받음), 설계 변경 판정(§3.9), 스파이크 대체 경로 선택, 판정 기준을 넘은 행의 판정(§3.1.3-14), 사람 작업과 종료 코드 2 보고 | 행을 직접 구현하지 않는다 |
| 2단계 하위 조정자 | 맡은 마일스톤·갈래에 등급 C·D 행이 있으면 Opus 5.5 medium, A·B만 있으면 Sonnet 5.5 medium | 마일스톤이나 갈래 하나. WBS 행을 실작업자 작업으로 나누고(§3.1.2 분할 기준) 배정, 결과를 근거 절과 테스트 ID로 검토, 갈래 브랜치에 합침, `just verify`와 행 완료 조건 확인, 진행 기록과 `done.ts`, 등급 D 행은 직접 수행, 설계 불일치를 정리해 1단계에 올림 | 설계 문서·24를 고치는 결정, 통합 브랜치 병합, push |
| 3단계 실작업자 | 등급 A: Haiku 5.5 max, 등급 B·C: Sonnet 5.5 medium | 파일·모듈 단위 구현, 테스트 작성, 기계적 변환. 자기 worktree에서 `just verify`(필요하면 `just check <파일>`)를 통과시킨 뒤 넘긴다 | 근거 절에 없는 결정, 맡지 않은 행의 파일 수정, 설계 문서 수정 |

- **브랜치와 worktree.** 설계 마감 뒤 사용자가 정한 기준 커밋(HT-01)에서 통합 브랜치 `impl/helm-v1`을 만든다. 하위 조정자는 갈래 브랜치 `impl/<갈래>/<마일스톤>`(예: `impl/core/m3`)을 `.worktrees/<갈래>`에 연다. 실작업자는 작업마다 갈래 브랜치에서 딴 `impl/<갈래>/<WBS ID>`를 `.worktrees/<갈래>-<WBS ID>`에 열고, 끝나면 하위 조정자가 갈래 브랜치에 합친다. 갈래 안의 이 병합은 사용자 확인 대상으로 보지 않는다(HD-6). 통합 브랜치 병합·push·PR은 사용자 확인 뒤 1단계가 한다.
- **보고 흐름.** 실작업자 → 하위 조정자 → 1단계. 사람에게 묻는 일(사람 작업, 병합 확인, 사용자 결정이 걸린 설계 변경)은 1단계만 한다.
- **동시 실행 예산.** 동시에 도는 에이전트 수는 1 + 하위 조정자 수 + 실작업자 수이며 실행 환경 상한(설계 단계 기준 20 [가정])을 넘지 않는다. 기본 배치는 하위 조정자 4명 이하(동시에 여는 갈래 수, §3.6.1), 조정자당 실작업자 3명 이하다(최대 1 + 4 + 12 = 17). Mac 레시피(`run-on mac`)와 운영 데몬을 건드리는 레시피는 한 번에 하나만 돈다.

#### 3.1.2 난이도 등급과 배정 [제안]

WBS 표의 마지막 세 열이 등급, 담당 단계, 모델이다. 등급은 아래 기준 중 가장 높은 쪽으로 매긴다.

| 등급 | 기준 | 예 |
|---|---|---|
| A 기계적 | 설계 표를 코드·설정으로 옮기거나 파일을 복사·이동한다. 판단할 것이 거의 없다. 산출 파일이 적고 근거 절이 이미 값을 정했다 | 템플릿 복사, 레시피 추가, 안내 파일, 정해진 데이터 표 |
| B 표준 | 명세가 정한 모듈 하나를 타입·함수·테스트로 만든다. 한 패키지 안이고 외부 연동이 적다 | 스키마, 투영기, 뷰 하나, 화면 하나, CLI 명령 |
| C 어려움 | 상태 기계·트랜잭션·동시성·복구·보안 경계·결정성·속성 테스트·성능 목표 중 하나 이상이 걸리거나, 여러 문서를 대조해야 명세가 완성된다 | 커널 판정, 저장소 커밋, 런타임 훅, 격리, 리스너 인증, 하네스 |
| D 판단 | 스파이크, 대체 경로 선택, 실제 기기·서버 환경(Mac, Windows, systemd, Tailscale) 확인, 사람 작업과 얽힘, 결과에 따라 설계 변경이 생기기 쉽다 | SP-xx를 포함한 행, 설치·실사용, 실기기 확인 |

| 등급 | 담당 | 실작업자 | 하위 조정자 | 모델 열 표기 |
|---|---|---|---|---|
| A | 3단계 | Haiku 5.5 max | Sonnet 5.5 medium | `H → S` |
| B | 3단계 | Sonnet 5.5 medium | Sonnet 5.5 medium | `S → S` |
| C | 3단계 | Sonnet 5.5 medium | Opus 5.5 medium | `S → O` |
| D | 2단계 | (보조로 Sonnet 5.5 medium) | Opus 5.5 medium이 직접 | `O 직접` |

- 표기: `H` = Haiku 5.5 max, `S` = Sonnet 5.5 medium, `O` = Opus 5.5 medium. 화살표 왼쪽이 실작업자, 오른쪽이 검토하는 하위 조정자다.
- 한 마일스톤을 맡는 하위 조정자의 모델은 그 마일스톤에서 가장 높은 등급을 따른다(C·D가 하나라도 있으면 Opus 5.5 medium).
- **분할 기준.** 다음 중 하나라도 맞으면 하위 조정자가 행을 하위 작업(`<WBS ID>.a`, `.b` …)으로 나눈 뒤 배정한다: 산출 파일·폴더 6개 초과, 근거 절 합계 약 600줄 초과, 패키지 둘 이상, 완료 조건의 테스트 ID 10개 초과. 하위 작업도 같은 기준으로 등급을 매긴다(원 행보다 낮을 수 있다). 지금 크기가 큰 행은 표의 "분할:"에 나눌 단위를 미리 적었다.

#### 3.1.3 작업 규칙

구현 에이전트가 WBS 행 하나를 맡을 때 지킬 규칙이다. 저장소 `AGENTS.md`(M0-09)에 요약을 옮긴다.

1. **작업 단위.** WBS 행 하나가 작업 하나다. 시작 전에 "근거" 열의 절을 끝까지 읽고, 그 절이 가리키는 타입·이벤트·명령 이름은 정본 문서(판정 §1: 이벤트 09, 명령 10, 레코드·질문 종류·ID 접두사 08, 메서드·오류 코드 19, 화면 ID 03, 유즈케이스 ID 02, 패키지 경계 06)의 것을 쓴다.
2. **선행.** "선행" 열의 작업이 같은 갈래 브랜치에 있거나, 다른 갈래 것이면 중간 병합 지점(§3.6.3)을 거쳐 통합 브랜치에 들어와 있어야 시작한다.
3. **브랜치.** 브랜치와 worktree 배치는 §3.1.1을 따른다. 커밋은 확인 없이 해도 된다. 통합 브랜치로의 병합, push, PR은 1단계가 사용자 확인을 받아 한다. 확인 요청은 마일스톤 끝과 중간 병합 지점에서 묶어서 낸다(D23-8).
4. **커밋 메시지.** `<type>(<패키지>): <WBS ID> <요약>`. 예: `feat(kernel): M3-05 C/A 명령 가족`. 설계 문서를 고친 커밋은 `docs(design): <문서 번호> <요약>`으로 따로 만든다.
5. **완료.** 공통 완료 조건은 `just verify` 종료 코드 0이다. 실작업자가 자기 worktree에서 먼저 통과시키고, 하위 조정자가 갈래 브랜치에 합친 뒤 다시 돌린다. 행의 완료 조건에 다른 레시피(`just daemon-systest`, `just app-e2e`, `just shot`, `just perf` 등)가 있으면 그것도 통과해야 한다. 화면을 바꾼 작업은 `just shot`으로 기준과 비교한다. 레시피가 종료 코드 2로 끝나면 코드를 고치지 않고 환경 문제로 보고한다(Mac 잠자기, 도구 없음 등). `_verify-steps`의 단계는 그 단계를 만드는 WBS 행이 끝날 때 더하고, 그 단계가 쓰는 도구의 사람 작업(`ui-test`의 Playwright 브라우저는 HT-24, `app-check`의 cargo는 HT-06)은 그 행보다 앞에 둔다(22 §3.15.1). 단계가 들어간 뒤 도구가 없으면 종료 코드 2를 그대로 낸다. 모든 갈래의 `just verify`가 멈추므로 1단계가 사람 작업을 먼저 요청한다.
6. **테스트 ID.** 설계 문서가 준 테스트 ID는 22 §3.4.3의 추적 ID 형식(`<문서 번호>/<ID>`)으로 테스트 제목 맨 앞에 쓴다. 추적 색인은 M0-12에서 전부 옮겨 두므로 제목의 ID가 색인에 없어 실패하는 일은 오타뿐이다. 색인 항목의 테스트가 아직 없으면 그 WBS 행이 `tests/trace/done.ts`에 들어가기 전까지는 경고다. 행을 끝낼 때 하위 조정자가 그 WBS ID를 `done.ts`에 넣는다(예: `it("12/T-RT-02 의도 커밋 실패 시 실행 0회", …)`). 문서 번호가 붙으므로 문서끼리 겹치는 ID(`12/T-SC-01`과 `13/T-SC-01`, `07/C1`과 `14/C-1`)도 구분된다. 이 문서의 WBS 표는 읽기 쉽게 문서 번호를 앞에 따로 적거나 근거 열로 대신한다. ID가 없는 단위는 22 §3.19가 붙인 `UT-nn`을 쓴다.
7. **설계와 다를 때.** 명세대로 구현할 수 없거나 명세가 서로 어긋나면 실작업자는 그 부분을 멈추고 하위 조정자에게 올린다. 하위 조정자가 정리해 1단계에 올리고 1단계가 판정한다(§3.9). 정본 문서의 이름을 임의로 바꾸지 않는다.
8. **비밀.** 테스트는 `@helm/testkit`의 가짜 키만 쓴다. 실제 키가 필요한 레시피(`ai-smoke`, `eval-inquiry`, `daemon-dev`)는 `_with-secrets`로 자식 프로세스에만 넣는다. 비밀 값은 출력·커밋·로그에 옮기지 않는다(사용자 규칙).
9. **레시피.** 새 레시피는 그 레시피가 처음 필요한 WBS 행에서 만든다(§3.10). 미리 빈 레시피를 두지 않는다. 모든 공개 레시피는 그룹과 한 줄 설명을 가진다(템플릿 `core.just` 규칙).
10. **진행 기록.** 행을 끝내면 하위 조정자가 `docs/specs/implementation-status.md`(M0-09에서 만듦)의 해당 행에 상태와 커밋을 적는다. 이 문서(23)에는 진행 상태를 적지 않는다.
11. **Mac 작업.** macOS 빌드·설치·스모크는 `run-on mac`을 쓰는 레시피(`app-build-mac`, `app-install-mac`, `app-verify-mac`, `shot-mac`)로만 한다. 직접 ssh 문자열을 만들지 않는다.
12. **반복 실수.** 같은 실수가 두 번 나오면 `AGENTS.md` 또는 `.claude/rules/`에 한 줄을 더하자고 보고에 적는다(사용자 규칙).
13. **마일스톤 관문.** 마일스톤의 마지막 행을 끝내면 1단계가 `just test-all`(22 §3.15.3: verify와 느린 시험·장애·적합성·E2E·시각·시스템·성능을 모아 돌림)을 돌리고, 결과 파일(`/srv/volumes/helm/test-reports/<날짜>.json`)을 병합 확인 요청에 붙인다. 아직 없는 레시피나 종료 코드 2인 부분은 그대로 적는다.
14. **판정 기준을 넘을 때.** 성능 목표, 스파이크 성공 기준, 관문 수치를 넘으면 그 행을 끝내지 않는다. 하위 조정자가 측정값과 원인을 적어 올리고 1단계가 판정한다(목표 조정은 §3.9의 계약 변경, 사용자 결정이 걸리면 사용자에게 묻는다).

### 3.2 구현 전 사람 작업과 확인 순서

#### 3.2.1 사람 작업 목록

`HT-`는 사람이 하는 작업(human task)이다. 홈랩 변경 H-1~H-5는 판정 §5와 17 §3.7.4의 번호를 그대로 쓴다.

| ID | 작업 | 막는 작업(늦어도 이 전에) | 확인 방법 | 근거 |
|---|---|---|---|---|
| HT-01 | 설계 마감 확인과 구현 기준 커밋 결정. 설계 브랜치 `design/helm-v1`을 `main`에 병합할지, 설계 브랜치에서 바로 `impl/helm-v1`을 만들지 정한다 | M0-01 | `git log --oneline -1 <기준>` | 결정 40, 사용자 규칙(병합은 확인 뒤) |
| HT-02 | `~/projects/helm/PRODUCT.md` 작성: 제품 한 줄, 레이아웃 A, 저장소 표(`code/helm`, GitHub `Rengod95/Helm-Agent_Docs_OS`) | M0-09 | 파일이 있고 템플릿 자리 표시가 남지 않음 | 판정 §5, 06 §3.17-6, `projects` 스킬 |
| HT-03 | 제품 폴더에서 `secrets init`(`.sops.yaml`과 `secrets/`) | M0-10(`_secrets-check`) | `secrets files`에 product 층이 보이고 `secrets check` 0 | 판정 §5, 06 §3.17 |
| HT-04 | `secrets edit dev`: 개발용 모델 키(`ANTHROPIC_API_KEY`, 쓸 경우 `OPENAI_API_KEY`), 개발용 `HELM_LEDGER_HMAC_KEY`(사람이 32바이트 난수로 만든다) | M6-13(`ai-smoke`), M9a-08(`eval-inquiry`), M11(`daemon-dev`) | `secrets env dev`에서 키가 "있음"으로 보임(값은 가림) | 06 §3.17, 09 U-03, 17 §5.2 "23" |
| HT-05 | `sudo apt install bubblewrap`(Ubuntu 24.04 후보 0.9.0). 판정 J-73에 따라 구현 시작 전에 요청한다 | 착수 전(늦어도 M6-10) | `bwrap --version` 0.9 이상, `bwrap --unshare-user --ro-bind / / true` 0 | 13 §3.6.1, 18 Q18-03, 판정 §5 |
| HT-06 | 서버 Rust 도구(rustup 또는 mise `rust`)와 `sudo apt install nsis lld llvm` | M13b-02, M13d-03 | `just app-setup` 종료 코드 0 | 20 §3.12.1~2 |
| HT-07 | Mac 준비: Xcode 명령줄 도구, mise(Node·pnpm·Rust), Mac에서 `just setup`, 자체 서명 인증서 "Helm Local Code Signing" 생성, macOS·Safari 판 알림 | M13b-02(Mac 셸 확인), M13d-02 | `run-on mac 'cargo --version && node --version'`, 판 번호 보고 | 20 §3.12.1·§3.12.3, 21 U-14 |
| HT-08 | Windows 준비: `server` 별칭 SSH 키(Windows OpenSSH 클라이언트), `ops/windows/check-helm-host.ps1` 실행(읽기 전용, 관리자 권한 불필요) | M13b-09, M15-03 | 스크립트 결과에 FAIL 없음, `ssh server true` 0 | 17 §3.7.3, 20 §3.8.3 |
| HT-09 | 홈랩 H-1(`serve.table`에 `8448 http://127.0.0.1:7840 helm`, `just serve-apply`)과 H-4(`ctx-lint`가 docker 없는 줄 허용) | M11-12의 SP-10, M15-03 | 이 저장소의 `just daemon-probe` 통과 | 17 §3.7.1·§3.7.4 |
| HT-10 | 홈랩 H-2(restic이 `/srv/volumes/helm`의 포함 경로를 넣음)와 H-3(제외 목록) | M15-08(첫 실사용) | `helm status`의 `backup_offsite`가 `ok` | 17 §3.7.4, §3.9 |
| HT-11 | 홈랩 H-5(Caddy 관리 API `127.0.0.1:2019` 정리) | M15-08 | Windows `curl.exe http://127.0.0.1:2019/config/`가 200이 아님 | 17 §3.7.4, 18 T-M5 |
| HT-12 | `secrets edit prod`: 운영 모델 키, 운영 `HELM_LEDGER_HMAC_KEY` | M11-12(`daemon-install`) | `just daemon-doctor`의 비밀 항목 PASS | 판정 §5, 09 U-03(키 없으면 시작 거부) |
| HT-13 | 월 모델 비용 상한 답. 답이 없으면 USD 50 | M11-12(설치 때 관리 CLI가 묻는다) | `helm config print`의 `budget.monthlyCapUsd` | 판정 J-22, 01 OQ-06 |
| HT-14 | dotfiles `.stignore-dev`에 Cargo `target`과 갈래 worktree 폴더 `.worktrees` 제외를 더할지 결정. 정하지 않으면 `CARGO_TARGET_DIR` 우회로 진행하고 `.worktrees`는 동기화된다 | M0-01(`.worktrees`), M13b-02(Cargo) | 결정 기록(이 문서 §7 T-1 갱신 요청) | 판정 §5, 20 Q-22, 이 문서 T-1 |
| HT-15 | Caustic 저장소에 LICENSE를 더할지 판단(판정 J-88: Helm은 NOTICE에 출처를 기록하고, Caustic 쪽 LICENSE는 사용자 판단). 답을 기다리지 않고 M13a-01은 NOTICE 기록으로 진행 | M13a-01(막지 않음) | `packages/ui-tokens/NOTICE.md`의 출처 기록 | 21 U-07, 결정 43, 판정 J-88 |
| HT-16 | G0: 최근 실제 흐린 작업 다섯 개(취향형 둘 이상)를 과제 파일로 쓰고, `just eval-inquiry`로 돌려 보기 전·본 뒤를 기록. 일주일 뒤 기록 | M15-08 | `/srv/volumes/helm/eval/<날짜>/*.result.yaml` 다섯 개와 판정 | 15 §3.15.2, 01 §3.8.4 |
| HT-17 | 기기 페어링(Mac, Windows), 개발 데몬용 기기 토큰을 `secrets edit dev`의 `HELM_DEV_DEVICE_TOKEN`에 넣기 | M13b-04(`app-dev`), M15-03 | `helm devices` 목록, `secrets env dev` | 20 §3.12.1, 18 §3.7 |
| HT-18 | MVP 실사용 기록: 실제 모델로 UC-01·UC-02·UC-07 끝까지, 두 기기에서 두 경로로 질문 답하기(UC-04) | M15 완료 | 이벤트 로그에 해당 Concern의 결과 확인이 있음 | 01 §3.8.3 2·3 |
| HT-19 | G1: MVP 14일 실사용, 복귀 점검 답, 2주 평가 판단을 "Helm 사용 평가" Concern의 결과 확인으로 기록 | A2 | 관문 기록 Concern의 결과 확인 | 01 §3.8.4, 16 §3.27.6 |
| HT-20 | G2: 2단계 14일 실사용 뒤 같은 방식 | A3 | 같음 | 01 §3.8.4, 16 §3.27.6 |
| HT-21 | iPhone 준비: iOS 26 이상으로 올림[결정 49], Tailscale 설치·VPN On Demand. 방식(PWA·Web Push)과 알림 범위는 결정 47·48로 정해져 묻지 않는다. Apple 개발자 프로그램은 경로 B를 검토할 때만 묻는다(26 §3.1.5) | M17-04 | 설정 앱의 iOS 판, Tailscale 연결 | 결정 42·47~49, 26 §3.6.3 |
| HT-22 | 마일스톤 끝의 병합·push 확인, Windows CI 빌드 실행 확인 | 각 마일스톤 끝, M13d-03 | 사용자 답 | 사용자 규칙 |
| HT-23 | 시험용 SSH 키: WSL sshd(127.0.0.1:22)에 시험 전용 키를 등록(`authorized_keys`)해 `test-conformance-ssh`와 `app-test-ssh`가 쓰게 한다 | M11-06, M13b-05 | `just test-conformance-ssh`가 종료 코드 2가 아님 | 22 §5.2 "23"(5), 20 §3.12.2 |
| HT-24 | Playwright 브라우저의 시스템 의존 설치(필요하면 `sudo`). 브라우저 내려받기는 `just setup`이 한다 | M13a-02 | `just ui-test`가 종료 코드 2가 아님 | 22 §5.2 "06"(4), "23"(5) |
| HT-25 | VAPID 키: `just mobile-vapid-keygen` 출력을 `secrets edit prod`의 `HELM_VAPID_PRIVATE_KEY`에 넣는다 | M17-02 | `helm doctor`에 `push_no_vapid_key`가 없음 | 26 §3.4.7, §3.6.3 |

#### 3.2.2 확인할 결정

구현 중에 기본값으로 진행할 수 있으나 사람이 한 번 확인하면 좋은 것이다. 답이 없으면 기본값으로 간다.

| 번호 | 질문 | 기본값 | 확인 시점 | 근거 |
|---|---|---|---|---|
| HD-1 | `just verify`를 서버에서만 돌리고 GitHub Actions는 Windows 데스크톱 빌드에만 쓰는가 | 예(D23-7) | M0-01 | 06 O-11 |
| (해결) HD-2 | 관리 CLI의 사람 결정 명령을 어떤 경우에 받는가 | 판정 J-135: TUI 또는 TTY CLI에서 확인 문자열을 넣은 경우만. 비대화 localAdmin은 읽기와 관리만 | M11-10 | 18 Q18-07, 판정 J-135 |
| HD-3 | MVP에 웹 페이지 읽기(`web_fetch`, 읽기 전용)를 넣는가. 01은 MVP ◐(읽기만), 13 O-13-05는 1차 제외 | 넣는다. 원함 탐구의 웹 레퍼런스(01 OQ-13, 15 O-9)에 필요하다. `web_search`는 넣지 않는다 | M6-14 전 | 01 §3.8.2, 13 O-13-05, 18 T18-27 |
| HD-4 | 관찰 에이전트가 외부 세션 발췌(사용자·어시스턴트 문장 400자까지)를 모델 API로 보내는가 | 2단계 기능이므로 A2 때 묻는다. 그 전에는 보내지 않는다 | A2 | 16 OQ-16-03 |
| HD-5 | 자기보고 척도 문항(NASA-TLX 차원 이름만 쓰는 자체 문항) | 자체 문항 | M14-07 | 16 OQ-16-10 |
| HD-6 | 갈래 안의 병합(실작업자 브랜치 → 갈래 브랜치)을 사용자 확인 없이 하위 조정자가 하는가. 통합 브랜치 병합은 중간 병합 지점(§3.6.3)과 마일스톤 끝에 묶어서 확인받는다 | 예 | M0-01 | [결정 51], 사용자 규칙(병합은 확인 뒤), §3.1.1 |

#### 3.2.3 확인 순서

사람 작업은 아래 순서로 묶어서 하면 구현이 기다리지 않는다.

| 시점 | 사람 작업 | 이 시점에 가능해지는 것 |
|---|---|---|
| 착수 전 | HT-01, HT-02, HT-03, HT-05(J-73), HT-14, HD-1, HD-6 | M0 전체. 격리 시험 환경. 갈래 worktree |
| M5·M6 시작 무렵 | HT-04, HD-3 | 샌드박스(M6-10), 실제 모델 스모크(M6-13), G0 준비 |
| M9a 끝 | HT-16(G0) | MVP 실사용 시작 조건 하나 |
| M11 후반 | HT-08, HT-09, HT-12, HT-13, HT-23 | 운영 데몬 설치(M11-12), serve 경로 확인(SP-10), SSH 경로 적합성(M11-06) |
| M13 시작 전 | HT-06, HT-07, HT-15, HT-17, HT-24 | 데스크톱 앱 골격, Mac 빌드, 토큰 복사, `app-dev`, 부품 시험 |
| M14 무렵 | HD-5 | 자기보고 문항(M14-07) |
| M15 전 | HT-10, HT-11 | E2E 두 경로, 첫 실사용 |
| MVP 완료 뒤 | HT-18, HT-19 → A2 → HT-20 → A3, HD-4 | 2단계·3단계 활성화 |
| M17 전 | HT-21, HT-25 | 모바일(실기기 확인은 A2 때) |

### 3.3 의존 그래프와 마일스톤 개요

#### 3.3.1 패키지 의존에서 나온 순서

06 §3.4.1의 의존 허용 표를 위상 정렬하면 다음 층이 나온다. 같은 층은 서로 의존하지 않으므로 병렬로 만들 수 있다.

```text
층 0  저장소 골격(M0)  ─ testkit, 검사 스크립트, 레시피
층 1  domain(M1)                                   vendor-pi-*(M5, domain 불필요)
층 2  store(M2) ∥ kernel(M3) ∥ protocol·client·ui-language(M10) ∥ ai·agent·tools(M6, M5 뒤)
층 3  engine(M4, store·kernel 뒤)                   UI 시스템(M13a, ui-language 뒤)
층 4  runtime 코어(M7, engine·ai·agent·tools 뒤)    탐구 순수부(M9a, `@helm/kernel/orchestration`)·평가 하네스(M6 뒤) → G0
층 5  오케스트레이션·묻기 실행(M8) → 탐구 런타임 연결(M9b)
층 6  데몬·보안·운영·CLI(M11, M10·M8 뒤)  ∥  화면 투영(M12. M12-07만 M11-09 뒤, M12-09는 M11-05 뒤)  ∥  관찰 에이전트 결정적 부분(M14, store 뒤 시작)
층 7  데스크톱 앱(M13b~d, M10·M12 뒤. M13c-08은 M14-08 뒤, M13b-09는 M11-10 뒤)
층 8  MVP 통합·출시(M15) → G1 창
층 9  2단계(M16) → 모바일(M17) → 3단계(M18) → TUI(M19)   (기본 꺼짐, 구현은 G1 창과 겹쳐 진행)
```

임계 경로: M0 → M1 → M3 → M4 → M7 → M8 → M9b → M12 → M13c → M15. 커널(M3)과 런타임(M7)이 가장 크다. 갈래를 넘는 선행은 중간 병합 지점(§3.6.3)을 거쳐야 하므로 병합 확인이 늦으면 임계 경로가 늘어난다. M2·M5·M6·M10·M13a·M14는 임계 경로 밖에서 병렬로 진행한다(§3.6).

#### 3.3.2 마일스톤 표

규모는 테스트를 뺀 소스 줄 수 범위와 상대 크기다(S < 2천 줄, M 2천~5천, L 5천~1만, XL 1만 이상) [가정: 1단계 문서의 파일 목록과 비슷한 기능의 줄 수로 어림했다. vendor로 가져온 pi 코드 약 6천 줄은 따로 적는다]. 테스트 코드는 대체로 소스와 비슷하거나 더 많다.

| ID | 이름 | 목표 | 선행 | 갈래 | 규모 | WBS 행 수 |
|---|---|---|---|---|---|---|
| M0 | 저장소 골격과 검증 체계 | 빈 패키지에서 `just setup && just verify` 통과, 의존 규칙 검사·테스트 기반·추적 검사 동작 | HT-01~03 | 공통 | S | 12 |
| M1 | 도메인 모델 | `@helm/domain`의 레코드·이벤트·상태 기계·규칙 데이터·`RuntimeStorePort` 타입 | M0 | core | L | 11 |
| M2 | 이벤트 저장소 | `@helm/store`의 DDL, 커밋, 해시 체인, 투영기, 백업·복원 | M1 | store | L | 11 |
| M3 | 커널 | `@helm/kernel`의 판정, 명령 카탈로그, 묻기 판정, 속성 테스트 | M1 | core | XL | 11 |
| M4 | 엔진 | 단일 변경 경로(접수, 멱등, 판정, 커밋, 지시), 시작 적재, `RuntimeStorePort` 구현 | M2, M3 | core | M | 7 |
| M5 | pi vendor | vendor 패키지 세 개와 동기화·경계·고지 | M0 | pi | M(+가져온 코드 6천 줄) | 5 |
| M6 | 모델·루프·도구 | `@helm/ai`, `@helm/agent`, `@helm/tools`(격리·네트워크 프록시 포함) | M1, M5, HT-05 | pi | L | 16 |
| M7 | 런타임 코어 | run·훅·투영·복구·스케줄러·예산·하위 실행·제안 도구·수명주기, 하네스 `kernel` 모드 | M4, M6 | core | XL | 17 |
| M8 | 오케스트레이션과 묻기 실행 | 루프 계약·계획·전환·진입·거시 스케줄러, 질문 전달, 복귀 요약 생성, 시나리오 하네스 | M3(순수부), M7(효과부) | core | XL | 12 |
| M9 | 탐구 엔진 | M9a 순수부(`@helm/kernel/orchestration`)·평가 하네스(→G0), M9b 런타임 연결 | M9a: M1·M3-01·M6, M9b: M7·M8 | inquiry | XL | 8 + 3 |
| M10 | 프로토콜·클라이언트·문구 | `@helm/protocol`, 가짜 데몬과 적합성 스위트, `@helm/client`, `@helm/ui-language` | M1 | proto | L | 6 |
| M11 | 데몬·보안·운영·CLI | `helmd`, 리스너·인증, 프로토콜 계층, 운영 레시피, 관리 CLI, 서버 설치 | M4, M7, M8, M10, HT-12 | daemon | XL | 13 |
| M12 | 화면 투영 | 04 화면별 뷰 생성, 무효화 태그, 의미 미리보기, 앱 뷰 표본, 대본 `view` 단계 | M7, M8, M9b, M10, M11(M12-07·M12-09) | daemon | L | 10 |
| M13 | 데스크톱 앱 | M13a UI 시스템, M13b 앱 기반·전송·동기화, M13c 화면, M13d OS 통합·빌드 | M13a: M0·M10-06, M13b: M10(M13b-09는 M11-10), M13c: M12·M13a·M13b, M14(M13c-08) | ui·app | XL | 9 + 9 + 8 + 4 |
| M14 | 관찰 에이전트 결정적 부분과 지표 | 외부 세션 수집, 마스킹, 지표, 탐지기, 2주 평가 보고 | M2, M11-08 | observer | L | 8 |
| M15 | MVP 통합·출시 | 유즈케이스 대본, 장애 주입, E2E, 성능, 운영 리허설, 실사용 시작 | M0~M14, G0 | 공통 | L(테스트) | 9 |
| M16 | 2단계 기능(기본 꺼짐) | 가능성·결과 탐구, 발산 전체, 탐침·지속 관찰, 검증·중재, 기대 레코드, 관찰 제안, REPL | M15 | 여럿 | XL | 13 |
| M17 | 모바일 클라이언트(기본 꺼짐) | 데몬이 서빙하는 PWA와 Web Push로 휴대폰에서 질문 답하기(26) | M15, HT-21, HT-25 | mobile | L | 4 |
| M18 | 3단계 기능(기본 꺼짐) | S 루프, 비상 합의, 혼돈·혼란 조합 | M16 | core | L | 4 |
| M19 | TUI | pi-tui 기반 Helm TUI | M15, M10 | tui | M | 4 |
| A2 | 2단계 활성화 | G1 기록 뒤 2단계 플래그를 켬 | G1, M16 | 운영 | - | - |
| A3 | 3단계 활성화 | G2 기록 뒤 3단계 플래그를 켬 | G2, M18 | 운영 | - | - |

### 3.4 마일스톤 상세와 작업 분해

표의 열: **작업 ID**, **내용**, **산출 파일**(저장소 루트 기준), **근거**(문서 번호와 절), **선행**, **완료 조건**, **등급**(A~D, §3.1.2), **담당**(2단계 하위 조정자 직접 / 3단계 실작업자), **모델**(실작업자 → 하위 조정자, 표기는 §3.1.2). 모든 행의 공통 완료 조건(`just verify` 0, §3.1.3-5)은 다시 적지 않는다. 완료 조건에 적은 테스트 ID는 근거 문서 §6의 것이다. "수동"은 사람이 확인하고 결과를 기록하는 항목이다.

#### 3.4.1 M0 저장소 골격과 검증 체계

- 목표: 빈 패키지에서 `just setup && just verify`가 통과하고, 의존 규칙 위반이 `just verify`에서 실패한다. 이후 모든 작업이 같은 검증 체계 위에서 돈다.
- 선행: HT-01, HT-02, HT-03, HD-1.
- 완료 기준: 06 §6 S0·S1·S2의 완료 기준, 22 U22-1·U22-3·U22-7·U22-15, 아래 표의 조건 전부.
- 규모: S(설정·스크립트 약 2천 줄).

| 작업 ID | 내용 | 산출 파일 | 근거 | 선행 | 완료 조건 | 등급 | 담당 | 모델 |
|---|---|---|---|---|---|---|---|---|
| M0-01 | 통합 브랜치 `impl/helm-v1` 생성. 이전 구현을 `git mv`로 옮기고 워크스페이스에서 뺀다. npm workspaces `package.json`을 pnpm 설정으로 바꾼다. `.github/workflows/ci.yml`·`publish.yml`을 지운다. `README.ko.md`·`README.zh.md`를 지우고 `README.md`를 새로 쓴다 | `legacy/experimental-v0/{packages/helm-core,helm-cli,helm-sdk,helm-server,apps/helm-web}`, `legacy/agent-docs-init/`, `README.md` | 06 §2.5, ADR-06-14, D23-7 | HT-01 | `git log --follow`로 옮긴 파일의 이력이 보인다. 루트 워크스페이스에 `@helmdocs/*`가 없다(06 S0) | A | 3단계 | `H → S` |
| M0-02 | 설계 시제품 보존: P4 `fork-proto`(`node_modules` 제외), `apply-*-patches*.py`, P7 `exp-bwrap*.sh`를 옮기고 출처·날짜·용도를 README에 적는다. `secretdir`, `ws*`, 압축 푼 deb는 옮기지 않는다 | `experiments/design-prototypes/{pi-fork-proto,bwrap}/`, `experiments/design-prototypes/README.md` | D23-12, 07 §3.5·§3.18.2, 13 U-TL-4 | M0-01 | gitleaks 통과. 워크스페이스 밖이다(`pnpm-workspace.yaml`에 없음) | A | 3단계 | `H → S` |
| M0-03 | 루트 도구 설정: `package.json`(private, `type: module`, `packageManager: pnpm@11.21.0`, 스크립트 `lint`·`test`·`build`·`typecheck`), `pnpm-workspace.yaml`(`packages/*`, `apps/*`, `vendor/*`, pi `overrides`, better-sqlite3 빌드 허용), `.npmrc`, `.mise.toml`(node 24, pnpm 11, just, `ripgrep = "15.2.0"`, `fd = "10.5.0"`), `tsconfig.base.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `vitest.config.ts`, `.gitignore`, `lefthook.yml` | 같은 이름 | 06 §3.12, §3.15, 07 §3.3.2(overrides), 17 §3.14(rg·fd) | M0-01 | `just setup`이 깨끗한 클론에서 0. pnpm 11이 허용 목록 밖 빌드 스크립트(`@google/genai`·`protobufjs`)에서 설치를 실패로 하는지 확인하고, 실패로 하면 이름으로 무시 목록에 둔다(07 §3.3.2, 18 T18-25). `pnpm install --frozen-lockfile`이 두 번째 실행에서 변경 없음 | B | 3단계 | `S → S` |
| M0-04 | just 골격: `~/.dotfiles/templates/just/{core,node}.just`를 `.just/`로 그대로 복사, `.just/helm.just` 생성(빈 파일), 루트 `justfile`(`set allow-duplicate-recipes`, `typecheck` = `pnpm exec tsc -b`, `_verify-steps` = lint·typecheck·test·secrets·gitleaks. `check-arch`는 M0-07에서 더한다) | `justfile`, `.just/core.just`, `.just/node.just`, `.just/helm.just` | 06 §3.16 | M0-03 | `just`가 core·node·helm 그룹을 보인다. 템플릿 두 파일이 원본과 바이트 단위로 같다 | A | 3단계 | `H → S` |
| M0-05 | 빈 패키지: `packages/{domain,protocol,kernel,store,engine,ai,agent,tools,runtime,observer,daemon,client,ui-language,testkit,client-react,ui-tokens,ui}`, `apps/cli`. 각 `package.json`(이름, `exports`의 `source`·`default`·`types` 조건, 하위 경로 자리), `tsconfig.json`(references), `README.md`(06 §3.4 해당 행), `src/index.ts`. `apps/desktop`·`apps/tui`·`apps/mobile`은 해당 마일스톤에서 만든다 | `packages/*/`, `apps/cli/` | 06 §3.3.1, §3.15, 20 §3.14(`client-react`), 21 §6.1(`ui-tokens`, `ui`) | M0-04 | 06 S0: 모든 `exports` 진입점이 Node 해석으로 불러와진다(`scripts/test/exports.test.ts`) | A | 3단계 | `H → S` |
| M0-06 | SP-01 실행 형태 확인: `node --conditions=source`로 워크스페이스 패키지의 `.ts` 진입점 실행, `tsc -b`, Vitest `resolve.conditions: ["source"]` | `packages/daemon/src/bin/helmd.ts`(`--version`만), `scripts/test/run-form.test.ts` | 06 §3.12.4, S1, O-05 | M0-05 | 06 S1. 실패하면 `tsc -b --watch` + 수동 재시작으로 바꾸고 ADR-06-15 갱신 요청(§3.9) | D | 2단계 | `O 직접` |
| M0-07 | 의존 규칙 검사와 SP-02: `scripts/architecture-rules.ts`(06 §3.4.1 표의 코드판, `client-react`·`ui-tokens`·`ui`·`@helm/tests` 행 포함), `scripts/check-architecture.ts`, 위반·정상 fixture, ESLint 패키지별 규칙(`kernel`의 `Date.now`·`Math.random`·`node:` 금지 등 R4·R5), typescript-eslint 타입 정보 린트가 TS 6.0에서 도는지 확인 | `scripts/architecture-rules.ts`, `scripts/check-architecture.ts`, `scripts/test/fixtures/**`, `eslint.config.js` | 06 §3.5, S2, §3.12.2 | M0-05 | 06 S2의 모든 조건(R1~R14 위반 fixture 실패. R14(앱 안 층 규칙)도 fixture로 확인. `desktop`→`kernel` 실패, `observer`→`ai` 실패). `check-arch`를 `_verify-steps`에 더한다 | C | 3단계 | `S → O` |
| M0-08 | `@helm/testkit`: 고정 시계, 결정적 ID·난수, 격리 환경(임시 `HOME`·`XDG_*`·`TMPDIR`), 운영 경로 방지(운영 데이터·소켓을 열면 예외), 정규화·골든 도우미 | `packages/testkit/src/*` | 06 §3.4.14, 22 §3.5.2, U22-1, D22-16 | M0-05 | 22/KIT-01~08. 같은 씨앗에서 같은 ID 열. `domain` 밖을 import하지 않는다 | B | 3단계 | `S → S` |
| M0-09 | 저장소 안내: `AGENTS.md`(목적, 스택, 구조, 명령, 완료 기준, 의존 규칙 요약, 설계 문서 위치와 읽는 순서, §3.1 요약), `CLAUDE.md`(`@AGENTS.md`), `.claude/settings.json`(`Bash(just:*)`), `.claude/rules/{kernel,vendor,ui,ops}.md`, `docs/adr/README.md`(원본은 24), `docs/product/README.md`(01·02 가리킴), `docs/specs/README.md`(마일스톤 → 설계 절 대응), `docs/specs/implementation-status.md`(WBS ID 목록과 상태 칸) | 같은 이름 | 06 §3.15, 사용자 템플릿 `generic/AGENTS.md`, §3.1 | M0-04, HT-02 | 링크가 모두 있는 파일을 가리킨다(검사 스크립트 또는 수동). gitleaks 통과 | A | 3단계 | `H → S` |
| M0-10 | `.env.example` 첫 판(06 §3.17 목록 + `HELM_LEDGER_HMAC_KEY=`) | `.env.example` | 06 §3.17, 09 §3.8.2, 17 §3.3.2 | HT-03 | `_secrets-check`가 0. `secrets env dev`가 키 목록을 보인다 | A | 3단계 | `H → S` |
| M0-11 | SP-03 SQLite 드라이버 확인: better-sqlite3 13을 pnpm 11 빌드 허용 목록으로 설치하고 Node 24에서 불러와 `/srv/volumes/helm/dev` 아래 임시 파일에서 WAL·`synchronous=FULL` 커밋 1만 번의 지연을 잰다 | `packages/store/bench/spike-driver.ts`(M2-10에서 정식 벤치로 바뀜) | 06 §3.12.3, 09 U-02·§3.15.2 | M0-03 | 설치·불러오기 성공. p99를 `docs/specs/spikes/SP-03.md`에 남긴다(§3.7.3). 실패하면 SP-03 대체 경로(§3.7) | D | 2단계 | `O 직접` |
| M0-12 | 테스트 기반: 작업 공간 패키지 `@helm/tests`(`tests/`) 골격, 테스트 공통 준비, 추적 검사(`scripts/test-trace.ts`, `tests/trace/{index.ts,done.ts,manual.json,quarantine.json}`), 테스트 위생 정적 검사, 레시피 `test-trace`(`_verify-steps`에 더함), `test-all`(그때 있는 하위 레시피 모음), `test-flaky`. 추적 색인(22 §3.19)은 이 행에서 전부 옮기고 항목마다 이 문서 §6.1의 WBS ID를 붙인다. `done.ts`는 끝난 WBS ID 집합이다. 끝나지 않은 WBS 행의 색인 항목에 테스트가 없으면 경고, 끝난 행이면 실패, 테스트 제목의 ID가 색인에 없으면 실패다(§3.1.3-6) | `tests/{package.json,setup/*,trace/*}`, `scripts/test-trace.ts`, `scripts/test/static/*`, `vitest.config.ts`, `.just/helm.just` | 22 §3.4, §3.17.1, §3.18.1, U22-3, U22-7, U22-15 | M0-07, M0-08 | 22/ST-01~07. U22-7 (1)~(4)를 가짜 테스트 보고로 확인. 색인 전체가 있고 `done.ts`가 빈 상태에서 `just test-trace` 0(경고만) | B | 3단계 | `S → S` |

#### 3.4.2 M1 도메인 모델(`@helm/domain`)

- 목표: 모든 패키지가 쓰는 타입·스키마·상태 기계·규칙 데이터와 이벤트 카탈로그를 만든다. I/O 없음.
- 선행: M0.
- 완료 기준: 08 §6의 파일별 완료 기준과 공통 기준 1~4, 09 §6.1의 파일별 완료 기준, 13 U-TL-9.
- 규모: L(스키마가 많다. 레코드 목록은 08 §3.5~§3.19, 이벤트 카탈로그는 09 §3.4 전부).

| 작업 ID | 내용 | 산출 파일 | 근거 | 선행 | 완료 조건 | 등급 | 담당 | 모델 |
|---|---|---|---|---|---|---|---|---|
| M1-01 | ID(08 §3.2의 접두사 목록 전부, `IdFactory`), 시간(`Ms`), 행위자(`ActorRef`, `Via`), 원시 행동·기록 능력, 능력표 A | `packages/domain/src/{ids,time,actor,capability,capability-table}.ts` | 08 §3.2, §3.3, §6 | M0 | 08 §6 `ids.ts`·`actor.ts`·`capability-table.ts` 행 | B | 3단계 | `S → S` |
| M1-02 | 공통 타입: 스키마 도우미, 품질, 혼자 정한 결정(`Autonomy`, `WhyNotAsked`), 트리거, 근거 재료, 링크, 거부 갈래(`content`/`authority`/`path`) | `src/{schema,quality,autonomy,triggers,material,link,rejection}.ts` | 08 §3.4, §3.23, §6, 판정 §1 | M1-01 | 08 §6 해당 행. 거부 갈래 이름이 판정 §1과 같다 | B | 3단계 | `S → S` |
| M1-03 | 레코드 스키마(08 §3.5~§3.19 전부). 분할: 아래 묶음 (a)~(g)를 하위 작업 하나씩으로. 묶음 순서: (a) Project·Goal·Concern·WorkUnit, (b) E 레코드(관찰·해석·가능성·판단·주장·확인), (c) Choice·Grant·Agreement·결과 제출·결과 확인·반영 항목, (d) Question·Assumption·Objection·RollbackPoint·승인, (e) Run·ToolCall·Thread, (f) Inquiry·Stimulus·PreferenceModel·Lens·Prediction·Expectation·Probe·Watch, (g) PolicyProposal·Procedure·Device·PairingCode | `src/records/*.ts` | 08 §3.5~§3.19, 판정 J-26·J-35·J-38·J-43·J-47~J-55 | M1-02 | 08 §6 `records/*.ts` 행(모든 스키마 `Compile()`, 유효 1개·무효 3개 fixture, Question 교차 조합 거부) | B | 3단계 | `S → S` |
| M1-04 | 루프·상황·모드·다이얼 식별자(`LOOP_IDS` 18개, `MODE_IDS`, `DIAL_KEYS`), 기능 플래그 표(`FeatureKey`, `FEATURE_TABLE`: 키·단계·기본값, §3.5.4 초안) | `src/loop.ts`, `src/modes.ts`, `src/dials.ts`, `src/features.ts` | 08 §3.15(루프·모드), 14 §3.11(다이얼)·§3.15, 06 §3.10.3 | M1-01 | `loop.ts` 18개(08 §6). `FEATURE_TABLE`의 2단계·3단계 키는 모두 기본 `false` | A | 3단계 | `H → S` |
| M1-05 | 상태 기계 데이터 | `src/machines/*.ts` | 08 §3.22, 판정 J-38·J-39 | M1-03 | 08 §6 `machines/*.ts`의 네 조건 | B | 3단계 | `S → S` |
| M1-06 | 규칙 데이터: `promotionMissing()`(J-18), `canDependOn`, R-01~R-55 데이터 | `src/rules/{promotion,dependency-order,constraints}.ts` | 08 §3.9.5(`promotionMissing`), §3.20(R-01~R-55), §6, 10 §3.9 | M1-03 | 08 §6 해당 행(helm-toy fixture의 거부 3·7·10). 단 "모든 `guard` id가 10 구현에 있음"은 커널 구현이 필요하므로 M3-08에서 확인한다 | C | 3단계 | `S → O` |
| M1-07 | 이벤트 envelope와 카탈로그(09 §3.4 전부), 메타(`semanticFields` 포함, 22 §3.5.3), 정규 JSON(RFC 8785), 업캐스터, 휘발 이벤트 | `src/events/{envelope,payloads,meta,canonical-json,upcast,volatile}.ts` | 09 §3.2~§3.5, §6.1 | M1-03 | 09 §6.1 모든 행. 08 상태 기계의 `on`·`effects`와 R-xx의 `event`가 모두 카탈로그에 있다 | B | 3단계 | `S → S` |
| M1-08 | 모델 데이터 타입(메시지, 콘텐츠 블록, 사용량 등. 이름은 08) | `src/model.ts` | 07 §3.9.2, D07-8, 08 §5.2 "07" 요구 | M1-02 | 타입 컴파일. pi-ai와의 모양 일치 검사는 M6-01 | A | 3단계 | `H → S` |
| M1-09 | 인자 지문(`fingerprintArgs`, JCS 정규화), 자원 URI·패턴 타입, 마스킹 규칙 표(18 §3.10.4와 16 §3.8 공유본) | `src/fingerprint.ts`, `src/resource.ts`, `src/redaction/{rules,index}.ts` | 13 U-TL-9, §3.4.1, 10 §5.2 "13"(3), 18 §5.2 "16" | M1-02 | T-FP-01. 마스킹 규칙의 예시 문자열이 모두 가려진다(16 OB-T10의 규칙 부분) | B | 3단계 | `S → S` |
| M1-10 | 교차 검사와 카탈로그 동기화 검사: `@helm/domain`이 `node:`를 import하지 않음, 관찰 1만 개 검증 200 ms 이하, 설계 표(09 §3.4, 10 §3.11)의 이름 목록과 코드 등록 표 비교 스크립트 | `packages/domain/test/cross/*.test.ts`, `scripts/docs/check-catalog.ts`, `.just/helm.just`의 `docs-check` | 08 §6 공통 기준, D23-10 | M1-07 | `just docs-check`가 지금 설계 표와 일치에서 0, 이름 하나를 바꾸면 1. `_verify-steps`에 `docs-check` 추가 | B | 3단계 | `S → S` |
| M1-11 | `RuntimeStorePort` 타입(런타임이 정본을 읽고 trace·blob·커서·운영 테이블에 쓰는 포트)과 그 입출력 타입 | `packages/domain/src/ports/runtime-store.ts` | 판정 J-127, 06 §3.4 | M1-07 | 타입 컴파일. 엔진(M4-07)과 런타임(M7)이 이 타입만 쓴다 | B | 3단계 | `S → S` |

#### 3.4.3 M2 이벤트 저장소(`@helm/store`)

- 목표: 정본 SQLite 파일 하나에 이벤트·명령 결과·투영·실행 기록을 한 트랜잭션으로 쓰고, 해시 체인·백업·복원·내보내기를 제공한다.
- 선행: M1. M3과 병렬.
- 완료 기준: 09 §6.2의 파일별 완료 기준과 공통 기준. 테스트는 임시 디렉터리의 실제 SQLite 파일로 한다(메모리 DB 금지, 09 §6.2 공통).
- 규모: L.

| 작업 ID | 내용 | 산출 파일 | 근거 | 선행 | 완료 조건 | 등급 | 담당 | 모델 |
|---|---|---|---|---|---|---|---|---|
| M2-01 | 데이터 디렉터리 배치·위치 검사(`~/projects`·`/mnt/` 거부, 0700/0600), 단일 writer 잠금(`helmd.lock`의 `BEGIN EXCLUSIVE`), PRAGMA·`application_id`, 드라이버 접점 한 파일 | `packages/store/src/{paths,lock,open,driver}.ts` | 09 §3.6, §6.2, 판정 §2, 06 §3.12.3 | M1, M0-11 | 09 §6.2 `paths.ts`·`lock.ts`·`open.ts` 행. 잠금 구현은 `@helm/store/admin`으로 내보내고 데몬(M11-02)이 쓴다(판정 J-101) | C | 3단계 | `S → O` |
| M2-02 | DDL 0001과 마이그레이션 실행기(체크섬, 다운그레이드 거부, 마이그레이션 전 백업, `events` UPDATE·DELETE 금지 트리거) | `src/migrations/{0001_init,index}.ts` | 09 §3.7, §3.13 | M2-01 | 09 §6.2 `migrations` 행 | B | 3단계 | `S → S` |
| M2-03 | 부팅 epoch와 펜싱 | `src/boot.ts` | 09 §3.8 | M2-02 | 09 §6.2 `boot.ts` 행(이전 인스턴스 `commit`이 `Fenced`) | C | 3단계 | `S → O` |
| M2-04 | 쓰기 트랜잭션과 커밋: 동기 대화형 쓰기 트랜잭션 `store.transaction(fn)`(better-sqlite3 transaction 위, 판정 J-148), 그 위의 편의 함수 `commit`·`commitBatch`, `decide` 주입, 명령 결과(거부·충돌 포함) 저장과 재생, 256 KiB 상한, `onCommitted`, trace 행, 무효화 태그 저장 자리(`event_invalidations`, 09 §3.7), 고장 주입 지점과 SQLite 오류 주입(`SQLITE_FULL`·`SQLITE_IOERR`·`SQLITE_CORRUPT`, 다음 n번 쓰기), `openStore` 테스트 옵션(`idFactory`, `bootEpoch`, `storeId` 고정, `allowTmpfs`) | `src/{transaction,commit}.ts`, `src/testing/{faults,options}.ts` | 09 §3.8.4, §3.9, 판정 J-25·J-42·J-148, 22 §5.2 "09"(1)(2) | M2-03 | 09 §6.2 `commit.ts` 행 (1)~(9). 한 `store.transaction` 안의 두 번째 명령이 첫 명령의 결과를 본다. 예외 시 전부 롤백 | C | 3단계 | `S → O` |
| M2-05 | 해시 체인, HMAC 체크포인트(여러 키, `keyId`), 무결성 검사 | `src/{hash,integrity}.ts` | 09 §3.10, 18 §5.2 "09"(0) | M2-04 | 09 §6.2 `hash.ts`·`integrity.ts` 행 (1)~(5) | C | 3단계 | `S → O` |
| M2-06 | 핵심 투영기(모든 `EventType` 처리 함수)와 재구성 | `src/projectors/core/*.ts`, `src/rebuild.ts` | 09 §3.11, 08 §3.20.3, 판정 J-129 | M2-04 | 09 §6.2 `projectors`(망라성, 모르는 타입 거부, 상태 기계 밖 전이 예외)와 `rebuild.ts` 행. "증분 = 재구성" 조건은 이 단계에서는 08 상태 기계 fixture로 확인하고, 유즈케이스 이벤트 열로는 M8-12에서 다시 돈다. 투영 갱신이 실패하면 트랜잭션 전체가 롤백된다(판정 J-129) | B | 3단계 | `S → S` |
| M2-07 | 조회 API(`readEvents` 페이지, `readRange`, `recordRevision`, `eventsSince`, `headSeq`·`nextAfterSeq`)와 읽기 전용 리더(`query_only`) | `src/query.ts`, `src/read.ts` | 09 §3.11.5·§3.16, 19 §5.2 "09"(3), 16 §5.2 "09"(4) | M2-06 | 09 §6.2 `query.ts` 행. 읽기 전용 연결로 쓰기 시도가 실패한다(16 OB-T03의 저장소 쪽) | B | 3단계 | `S → S` |
| M2-08 | blob 저장(256 KiB 경계, gzip, 해시, 고아 GC, 가지치기, 가림 이벤트)과 보존 정책 | `src/{blobs,retention}.ts` | 09 §3.12, §3.15.3 | M2-04 | 09 §6.2 `blobs.ts`·`retention.ts` 행 | B | 3단계 | `S → S` |
| M2-09 | 백업·복원·내보내기(`storeId` 교체, `store.restored`, JSONL만으로 체인 검사) | `src/{backup,restore,export}.ts` | 09 §3.14, 17 §3.9 | M2-05, M2-08 | 09 §6.2 해당 행 (1)~(4) | C | 3단계 | `S → O` |
| M2-10 | 성능 측정과 레시피 `bench`(패키지 단위 함수 측정) 도입. 이후 패키지가 항목을 더한다 | `packages/store/bench/*.ts`, `.just/helm.just` | 09 §3.15.2, 22 §3.13 | M2-04 | 22/PF-01(명령 하나 커밋 p50 ≤ 3 ms, p99 ≤ 25 ms), 22/PF-09(처리량·재전송·검사·재구성). 결과를 파일로 남긴다. 넘으면 행을 끝내지 않고 하위 조정자가 1단계에 보고한다(§3.1.4) | B | 3단계 | `S → S` |
| M2-11 | 하위 경로 진입점 `read`·`write`·`admin`(인스턴스 잠금 `acquireInstanceLock` 포함, J-101)·`testing`(오류 주입)·`aux`(관찰 캐시 열기)와 공개 API 정리 | `src/{read,write,admin,testing,aux}.ts`, `package.json` `exports` | 09 §3.16, 06 §3.4.5, 판정 J-101, 22 §5.2 "09"(1)(2) | M2-07, M2-09 | `check-arch`가 `observer`의 `write` import를 막는다. `engine`은 `read`·`write`만 쓴다 | A | 3단계 | `H → S` |

#### 3.4.4 M3 커널(`@helm/kernel`)

- 목표: 순수 판정 함수 `decide`/`apply`/`react`와 명령 카탈로그(약 100개), 08 제약 R-01~R-55, 의존 규칙 1~5, 묻기 판정(11)을 만든다. 오케스트레이션 순수 코어(`@helm/kernel/orchestration`)는 M8에서 같은 패키지에 더한다.
- 선행: M1. M2와 병렬. 커널 테스트는 메모리 `KernelState`(`KernelView` 구현)로 돈다.
- 완료 기준: 10 §6.2 표 전부, 11 §6.2 표 전부.
- 순서: C/A 명령과 질문 핵심을 먼저(M3-05·M3-06) 만든다(10·11 §5.2 "23").
- 규모: XL.

| 작업 ID | 내용 | 산출 파일 | 근거 | 선행 | 완료 조건 | 등급 | 담당 | 모델 |
|---|---|---|---|---|---|---|---|---|
| M3-01 | 골격: `KernelContext`·`RuleBundle`·`loadRuleBundle`(V-POL-01), `decide`(상자 1~9), `apply` 기본, 메모리 `KernelState`, `Decision`·`Directive`·`Rejection`·`needs_gate` 타입 | `packages/kernel/src/{index,context,decide}.ts`, `src/apply/index.ts`, `src/state.ts` | 10 §3.1~§3.3, 09 §5.2 "10"(1) | M1 | 10 §6.2 "순수성"(1,000회 같은 해시, 입력 동결) | C | 3단계 | `S → O` |
| M3-02 | 경로·채널·형식·자격 검사, 명령 등록 표, 거부 코드 분류 | `src/{path,form,capability}.ts`, `src/commands/registry.ts` | 10 §3.4, §3.7, 판정 J-27 | M3-01 | 10 §6.2 "경로·채널·형식·자격", "거부 분류"(PT-18·19) | B | 3단계 | `S → S` |
| M3-03 | 정책 평가: 범위(`covers`, 패턴 포함), Grant 포함 검사, 권리 게이트·승인 대조, 독립성, `PolicyRule` | `src/policy/{scope,grant,rights,independence,policies}.ts` | 10 §3.6, 11 §3.14 | M3-02 | 10 §6.2 "권한"(authority fixture 5개) | C | 3단계 | `S → O` |
| M3-04 | 규칙: 의존 규칙 1~5, 승격(V-PRO), 혼자 정한 결정(V-AUT), 상태 기계 해석(V-STA), 가드 G-K1~G-K6, 불변조건 V-INV-01~12 | `src/rules/{dependency,promotion,autonomy,machines,guards}.ts`, `src/invariants.ts` | 10 §3.7~§3.9, §3.12, §3.16 | M3-02 | 10 §6.2 "상태 기계", "의존 규칙", "승격", "사후 검사" | C | 3단계 | `S → O` |
| M3-05 | C/A 명령 가족(합의·Grant, 결과 제출·확인·반영 항목, run·도구 호출) | `src/commands/{grant-agreement,result-obligation,run-toolcall}.ts` | 10 §3.11, 판정 J-40·J-43·J-44 | M3-03, M3-04 | 10 §6.2 "C/A 흐름" 대본 `c-a-flow.json`(사람 조작 2회, Grant 판본 2회) | C | 3단계 | `S → O` |
| M3-06 | 질문 핵심: 레지스트리, 게이트 판정, 전달 계획(D-1~D-11), 강도, 만료, 가정 비교, 승인, 사람 조작 셈. 질문 명령. 분할: (a) 레지스트리·게이트 판정, (b) 전달 계획·강도, (c) 만료·가정 비교, (d) 승인·사람 조작 셈·질문 명령 | `src/asking/{registry,gate,delivery,expiry,assumption,approval,humanOps}.ts`, `src/commands/question.ts` | 11 §3, §6, 판정 J-47~J-52 | M3-05 | 11 §6.2 "게이트 판정", "권리 게이트", "질문 형식", "전달", "강도", "만료", "가정 비교", "가정 아래 행동", "승인", "사람 조작". 대본 `absent-user.json`, `late-answer.json` | C | 3단계 | `S → O` |
| M3-07 | 나머지 명령 가족(프로젝트·Goal, Concern·구조, 루프, WorkUnit, E 레코드, 확인·판단, 선택·이의, 시간·다이얼·정책, 관찰 에이전트)과 중재·자율·재작업 판정. 분할: 명령 가족 파일 하나씩, 그리고 중재·자율·재작업 판정 하나 | `src/commands/{project-goal,concern-structure,loop,workunit,epistemic,check-finding,choice-objection,time-dial-policy,observer}.ts`, `src/asking/{mediator,autonomy,rework}.ts` | 10 §3.11, 11 §3.7~§3.12, 판정 J-53·J-54·J-55 | M3-06 | 10 §6.2 "명령 카탈로그". 11 §6.2 "중재자", "혼자 정한 결정", "이의·재작업", "범위 줄이기", "승인 극장 방지". 대본 `contest-rework.json` | C | 3단계 | `S → O` |
| M3-08 | 08 제약 R-01~R-55(파일 하나에 R 하나, 08 가드 id와 같은 이름) | `src/rules/constraints/*.ts` | 08 §3.20, 10 §3.10 | M3-04 | 10 §6.2 "08 제약". M1-06의 "모든 `guard` id가 10 구현에 있음" 교차 테스트 통과 | B | 3단계 | `S → S` |
| M3-09 | 파생 R-1~R-12, 지시, 조회 함수(`pendingTimers`, `checkSettle`, `allowedCommands`, `mustIncludeRefs`, `impactOf`, `autonomousDecisions`, `humanOps`, `viewAt`, `explain`) | `src/react/*.ts`, `src/directives.ts`, `src/queries/*.ts` | 10 §3.1(지시·조회 함수), §3.13(파생) | M3-07 | 10 §6.2 "파생". 조회 함수마다 단위 테스트 | C | 3단계 | `S → O` |
| M3-10 | 커널 단독 대본·골든·속성: 커널 대본(helm-toy 21단계, guided-001, c-a-flow, absent-user, late-answer, contest-rework)과 골든 이벤트 열, PT-01~19. 메모리 `KernelState`만 쓴다. 유즈케이스 하네스의 `kernel` 모드는 엔진·저장소·투영 함수·도구→명령 대응이 필요하므로 M7-17에서 만든다 | `packages/kernel/test/{scripts,golden,property,regressions}/*` | 10 §3.17, §6.1, 22 §3.7 | M3-09, M0-12 | 10 §6.2 "재생", "속성"(verify는 고정 시드 20, `just test-deep`은 새 시드 100, 22 D22-7). 커널 분기 커버리지 90% 이상(22 §3.17.2: `just test`의 커널 프로젝트에서 검사, `just coverage`는 보고만) | C | 3단계 | `S → O` |
| M3-11 | 성능 측정(`just bench`에 커널 항목. 레시피가 아직 없으면 이 행에서 만든다) | `packages/kernel/bench/decide.ts`, `.just/helm.just` | 10 §6.2 "성능", 22 §3.13 | M3-10 | 22/PF-07: 이벤트 10만 건 상태에서 `decide` p95 < 5 ms, `impactOf` p95 < 50 ms. 기록을 남긴다. 넘으면 1단계 판정(§3.1.3-14) | B | 3단계 | `S → S` |

#### 3.4.5 M4 엔진(`@helm/engine`)

- 목표: 상태를 바꾸는 다섯 입력(사람 명령, 모델 제안, 도구 관찰, 타이머, 관찰 IPC)이 모두 "멱등 확인 → 커널 판정 → 이벤트 append → 투영 갱신 → 지시"를 한 트랜잭션으로 지난다.
- 선행: M2, M3.
- 완료 기준: 06 §6 S4, 09 §6.2 `commit.ts`의 엔진 경유 판본, 10 §5.2 "09"(3)~(6).
- 규모: M.

| 작업 ID | 내용 | 산출 파일 | 근거 | 선행 | 완료 조건 | 등급 | 담당 | 모델 |
|---|---|---|---|---|---|---|---|---|
| M4-01 | 입력 접수: 행위자·via 부착, 멱등 조회 범위 `channel·actor·viaKey·key`, `ctx.now` 확정, 파생 `newId`, 부팅 epoch, `rulesVersion`을 provenance에 | `packages/engine/src/{create-engine,intake,context}.ts` | 06 §3.4.6, 10 §3.1.3·§3.3.5, 09 §3.9.1 | M2-04, M3-01 | 같은 멱등 키 재시도가 `replayed`를 돌려준다(06 S4) | C | 3단계 | `S → O` |
| M4-02 | `submit`·`transact`(동기, 트랜잭션 안 I/O 금지)·`appendTrace`(형식·펜싱 검사만), `SubmitResult`(`needs_gate` 포함), 거부·충돌·게이트를 `command.rejected`로 저장 | `src/{submit,transact,trace}.ts` | 06 §3.4.6, 12 §3.1, 판정 J-25·J-148 | M4-01 | 같은 트랜잭션 안에서 `KernelState`를 명령마다 덧씌운 사본으로 갱신하고 롤백하면 버린다(판정 J-148). 06 S4: `basisSeq`보다 뒤에 바뀐 대상은 `conflict`, 거부도 seq를 가진 이벤트, 예외 시 이벤트·투영·실행 기록 모두 롤백 | C | 3단계 | `S → O` |
| M4-03 | 커밋 뒤 처리: `onCommitted`(seq 순, 같은 턴), `onDirective` 배포, 무효화 태그: 커밋 트랜잭션 안에서 12의 순수 함수(`aggregateTags`, M12-01)가 계산하고 09 `event_invalidations`에 저장 | `src/{after-commit,directives}.ts` | 09 §5.1 "20", 19 §5.2 "09"(4), 10 §3.1(지시) | M4-02 | `onCommitted`가 커밋한 턴 안에서 seq 순서로 불린다. 태그 함수가 등록되지 않은 시험 구성에서는 빈 태그로 커밋된다 | C | 3단계 | `S → O` |
| M4-04 | 트랜잭션 시간 측정과 경고 로그(100 ms) | `src/metrics.ts` | 06 §4 F13 | M4-02 | 일부러 늦춘 판정에서 `warn` 1건 | B | 3단계 | `S → S` |
| M4-05 | 통합 시험: 실제 커널 + 임시 SQLite로 C/A 대본(`c-a-flow`)을 엔진 경유로 재생 | `packages/engine/test/integration/*.test.ts`, `packages/engine/src/testing.ts` | 10 §6.2 "C/A 흐름", 06 S4 | M4-03 | 이벤트 열이 M3-10 골든과 같다. `engine` 밖에서 이벤트를 append하는 경로가 없다(`check-arch`). 시험 도우미 `@helm/engine/testing`(임시 저장소 + 실제 커널 조립, 가짜 시계·ID)을 내보낸다(22 §5.2 "23") | B | 3단계 | `S → S` |
| M4-06 | 엔진 시작 적재와 크래시 뒤 재개: 커널 스냅숏(`kernel_snapshots`) + 뒤 이벤트 접기로 `KernelState` 복원, `state_hash` 검사, 스냅숏 저장 주기, 지시 재계산 커서(`consumer_cursors.directives`)를 올리는 시점과 중복 제거(`directivesFor`), 상주 메모리 상한(06 §3.6, 22/PF-11) | `packages/engine/src/{boot,snapshot,directive-cursor}.ts` | 10 §3.1.4, 09 §3.16, 06 §3.4.6 (알고리즘은 09·10에 요구, §5.2) | M4-03, M2-06 | 스냅숏 없이 접은 상태와 스냅숏 + 뒤 이벤트로 접은 상태의 `state_hash`가 같다. 지시 처리 도중 kill → 재시작 뒤 같은 지시가 두 번 실행되지 않는다. 이벤트 10만 건 적재 시간 기록 | C | 3단계 | `S → O` |
| M4-07 | `RuntimeStorePort` 구현: 조회, 커널 스냅숏, trace, blob, 커서, 운영 테이블 upsert. 타입은 `@helm/domain`(M1-11), 구현은 엔진이 맡아 런타임에 주입한다. `runtime`은 `store`를 import하지 않는다 | `packages/engine/src/runtime-store-port.ts` | 판정 J-127, 06 §3.4 | M4-03, M1-11 | 포트 메서드마다 단위 시험. `check-arch`가 `runtime` → `store` import를 막는다 | C | 3단계 | `S → O` |

#### 3.4.6 M5 pi vendor

- 목표: pi `v1.1.0`(커밋 `abe508e1`)에서 가져온 코드를 작업 공간 비공개 패키지 세 개로 두고, 패치·동기화·경계·고지를 검사로 지킨다.
- 선행: M0. `domain`이 필요 없으므로 M1과 병렬로 시작한다.
- 입력: `experiments/design-prototypes/pi-fork-proto/`(M0-02). 시제품에서 업스트림 테스트 173건 통과, 계약 시험 C1~C7·C9·C14·C20·C21 통과가 확인돼 있다 [실험, 07 §3.19.3].
- 완료 기준: 07 §6 V1·V2·V3·V7·V8.
- 규모: M(새 코드 약 1천 줄, 가져온 코드 약 6천 줄).

| 작업 ID | 내용 | 산출 파일 | 근거 | 선행 | 완료 조건 | 등급 | 담당 | 모델 |
|---|---|---|---|---|---|---|---|---|
| M5-01 | vendor 기반: 안내, 라이선스, 업그레이드 보고 자리, `UPSTREAM.json` 스키마, 동기화·CHANGELOG 스크립트, 레시피 `vendor-status`·`vendor-verify`·`vendor-outdated`·`vendor-upgrade` | `vendor/README.md`, `vendor/LICENSES/pi-mono-MIT.txt`, `vendor/UPGRADES/2026-10-11_v1.1.0-baseline.md`, `scripts/vendor/{sync.mjs,changelog-breaking.mjs}` | 07 §3.3, §3.17, §3.18 | M0 | 07 V1 | B | 3단계 | `S → S` |
| M5-02 | `@helm/vendor-pi-agent-core`: `agent-loop.ts`·`types.ts`에 패치 A1~A7, 업스트림 테스트(A6 describe 삭제, A5 기대값 1건 수정), 계약 시험 | `vendor/pi-agent-core/**` | 07 §3.4, §3.5, §3.10, §3.19.2 | M5-01 | 07 V2 (1)~(4) | B | 3단계 | `S → S` |
| M5-03 | `@helm/vendor-pi-tools`(도구 7개와 의존 18개 파일, 패치 T1~T14)와 `@helm/vendor-pi-image`(이미지 유틸 8개) | `vendor/pi-tools/**`, `vendor/pi-image/**` | 07 §3.6, §3.7 | M5-01 | 07 V3 (1)~(5). 네트워크를 막은 상태의 grep·find 테스트 포함 | B | 3단계 | `S → S` |
| M5-04 | pi import 경계 검사(lockfile 포함)를 `check-arch`에 연결 | `scripts/vendor/check-pi-boundary.mjs` | 07 §3.19.1 I4 | M5-02, M5-03 | 07 V7 | A | 3단계 | `H → S` |
| M5-05 | 서드파티 고지 생성과 `just licenses`. `_verify-steps`에 `vendor-verify`와 고지 일치 검사를 더한다 | `THIRD_PARTY_NOTICES.md`, `.just/helm.just` | 07 §3.17, 06 §3.16 | M5-04 | 07 V8. `just verify`가 vendor 파일 한 줄 수정(패치 ID 없음)에서 실패한다 | A | 3단계 | `H → S` |

#### 3.4.7 M6 모델·루프·도구(`@helm/ai`, `@helm/agent`, `@helm/tools`)

- 목표: pi 코드를 감싸는 세 패키지. 모델 게이트웨이, 루프 재export, 기본 도구 7개, 경로 정책, 격리, 권한 레이어.
- 선행: M1, M5. 격리(M6-10)는 HT-05와 SP-04.
- 완료 기준: 07 V4·V5·V6, 12 U-AI-1~3, 13 U-TL-1~7·U-TL-13·U-TL-14, 18 T18-26.
- 규모: L.

| 작업 ID | 내용 | 산출 파일 | 근거 | 선행 | 완료 조건 | 등급 | 담당 | 모델 |
|---|---|---|---|---|---|---|---|---|
| M6-01 | `@helm/ai`의 pi 연결부: `@helm/ai/pi` 기계 타입 재export, pi-ai 고정 의존 연결, `@helm/domain/model`과의 모양 일치 컴파일 시험, `stopReason` 변환 | `packages/ai/src/pi.ts`, `packages/ai/src/pi/*` | 07 §3.8, §3.9.2~§3.9.3 | M1-08, M5-03 | 07 V4 (1)~(4): I1, I5, C15~C17, C19, C23, C24 | B | 3단계 | `S → S` |
| M6-02 | 모델 게이트웨이: 역할 해석, 재시도(`@helm/ai` 한 곳), 대체 후보, 설정 스키마 | `packages/ai/src/{gateway,config,roles}.ts` | 12 §3.3, U-AI-1, D07-10 | M6-01 | T-AI-01~05 | C | 3단계 | `S → O` |
| M6-03 | 자격 증명: 데몬 `SecretStore`(판정 45)를 읽는 구현. 개발 데몬은 `HELM_SECRETS_FROM_ENV=1`일 때만 환경에서 읽고 지운다 | `packages/ai/src/credentials.ts` | 12 U-AI-2, 17 §3.8, 07 §5.2 "12"(8), 18 §5.2 "12"(1) | M6-02 | T-AI-06~08(`SecretStore`에서 읽고 `process.env`에 없음, 키 교체 뒤 새 키, 판정 J-57). 키 값이 오류 문자열에 없다 | B | 3단계 | `S → S` |
| M6-04 | 사용량 계산(`calculateCost`, `costKnown`)과 이미지 입력 정규화(`processImage`) | `packages/ai/src/{usage,images}.ts` | 12 U-AI-3, 07 §3.6.4 | M6-02 | T-AI-09, T-AI-10. 1×1 PNG 정규화 | B | 3단계 | `S → S` |
| M6-05 | `@helm/agent`: 저수준 루프 재export와 `assertToolDeclarations` | `packages/agent/src/index.ts` | 07 §3.9.4, 12 RT-1 | M5-02, M6-01 | 07 V6 (1)~(3): I3, C8, C20. `Agent`·`agentLoop`를 내보내지 않는다 | A | 3단계 | `H → S` |
| M6-06 | 모델 테이프 재생기(`helm.model-tape.v1`): pi-ai의 가짜 제공자(`fauxProvider`), `api` = `"faux:helm"`, 대기열이 비면 실패, `context-hash` 대조, 녹화 게이트웨이(`recordingGateway`)와 재생(`tapeGateway`). 레시피 `tape-promote` | `packages/ai/src/testing/*`, `.just/helm.just` | 22 §3.5.4, D22-4, U22-2, 07 C17 | M6-02 | U22-2 (1)~(6). 07에 요구된 `FauxResponseFactory` 확인(22 §5.2 07) 결과를 SP-06 기록에 적는다 | B | 3단계 | `S → S` |
| M6-07 | 도구 모델: `HelmToolSpec`(`primitive`, `replay`, `executionMode`, `cancellation`, `prepare`, `postprocess`, `replayGuard`, `safeForRecoveryTurn`), `toAgentTool` | `packages/tools/src/{spec,wrap}.ts`, `packages/tools/src/testing/fake-executor.ts`(`FakeToolExecutor`: 샌드박스 없는 환경과 하네스 `kernel` 모드용) | 13 §3.1~§3.2, U-TL-1, 08 §5.2 "13" | M6-05 | T-TL-01, T-TL-02. `FakeToolExecutor`가 실제 도구와 같은 `HelmToolSpec` 결과 모양을 낸다 | B | 3단계 | `S → S` |
| M6-08 | 경로 정책과 셸 환경: `canonicalize`(realpath, 링크, 가림 목록), vendor 도구의 `pathPolicy.check`(T7+) 연결, `buildShellEnv`(18 R-2 허용 목록, `HELM_RUN_ID`·`HELM_TOOL_CALL_ID`·`NO_COLOR`·`CI`만) | `packages/tools/src/path/{canonicalize,policy}.ts`, `src/pi/{path-policy,shell-env}.ts` | 13 §3.4, U-TL-2, 07 V5, 판정 J-17·J-45 | M6-07 | T-PA-01~05, C21, C22, 07 V5 (2)(3). 가림 목록에 `/srv/volumes/helm/data`(J-45), `~/.config/helm/**`, `~/.config/systemd/user/**`, `/mnt/**`, `/run/WSL`(18 §5.2 "13"(3)) | C | 3단계 | `S → O` |
| M6-09 | 기본 도구 7개(read, write, edit, bash, grep, find, ls)를 13 명세로 감싼다. 도구별 기본값 표 | `packages/tools/src/basic/{read,write,edit,bash,grep,find,ls}.ts` | 13 §3.3, U-TL-3, 07 §3.9.5 | M6-08 | T-BT-01~04, 07 V5 (4) | B | 3단계 | `S → S` |
| M6-10 | 격리: S1 bwrap → S1b `systemd-run --user` → `execute` 끔(fail closed). 자원 상한 슬라이스, 타임아웃 시 자식 0개 | `packages/tools/src/sandbox/{bwrap,systemd-run,env,level}.ts` | 13 §3.6, U-TL-4, 18 §3.11, 판정 J-45 | M6-08, HT-05, SP-04 | T-SB-01~04. 18 T18-08~11·T18-29의 단위·통합 판본(시스템 판본은 M11-11의 `daemon-systest`). S1b로 낮출 때의 읽기 범위는 13·18이 허용 목록 방식으로 고친 명세를 따른다(§5.2). 명세가 오기 전에는 S1b를 MVP 운영에 쓰지 않는다(§3.7.1 SP-04) | D | 2단계 | `O 직접` |
| M6-11 | 범위 계산, 변경 감지(git 방식, scan 방식, 스냅숏 blob), 비밀 마스킹(M1-09 규칙 사용) | `packages/tools/src/{scope/effective,changes/detector,secrets/redact}.ts` | 13 U-TL-5~7 | M6-09 | 13의 T-SC-01~03(범위), T-CD-01~03, T-RD-01 | C | 3단계 | `S → O` |
| M6-12 | 권한 레이어: `PermissionVerdict`(rightsCategories, reversibility), 18 고정 기준선 | `packages/tools/src/permission.ts` | 13 §3.10, U-TL-13, 18 §3.11.6 | M6-11 | T-PL-01, T-PL-02, T18-26 | B | 3단계 | `S → S` |
| M6-13 | 실제 제공자 스모크 레시피 `ai-smoke`(비용 발생, `verify` 밖) | `.just/helm.just`, `packages/ai/scripts/smoke.ts` | 07 §3.18, §5.1 | M6-03, HT-04 | 수동: Anthropic(쓸 경우 OpenAI) 스트림 1회, 사용량·캐시 필드 기록. 결과를 SP-06 기록에 남긴다 | D | 2단계 | `O 직접` |
| M6-14 | 웹 페이지 읽기 도구 `web_fetch`(읽기 전용, 사설 주소·리디렉션 차단, 해석 뒤 IP 고정, 내용 해시). HD-3이 "넣지 않음"이면 이 행을 M16으로 옮긴다 | `packages/tools/src/web/fetch.ts` | 01 §3.8.2(◐ 읽기만), 15 §5.2 "13", 18 T18-27, HD-3 | M6-12 | T18-27. 13이 `web_fetch` 명세를 더하면 그 §6 조건(§5.2 13 요구) | C | 3단계 | `S → O` |
| M6-15 | 격리 운영: 자체 시험(시작 때 S1·S1b 여섯 시험), 이전 epoch 도구 단위 정리(`reapOrphans`), run 사이 외부 변경 감지(`workspace.unlinked_change_observed`) | `packages/tools/src/sandbox/{selftest,reap}.ts`, `src/changes/unlinked.ts` | 13 U-TL-14, 16 §5.2 "13"(1), 판정 J-45 | M6-10, M6-11 | T-IS-01~02, T-OR-01, T-UC-01 | C | 3단계 | `S → O` |
| M6-16 | 네트워크 허용 실행과 SP-16: 실행마다 네트워크 네임스페이스를 분리하고 데몬 쪽 CONNECT 프록시로만 밖에 나간다. 루프백·사설·CGNAT(100.64/10)·tailnet 주소를 막는다. 프록시는 이 모듈을 데몬이 띄운다(M11-07에서 연결) | `packages/tools/src/sandbox/{netns,connect-proxy}.ts` | 판정 J-134, 13 §3.6.3, 18 T18-09·T18-27 | M6-10, HT-05 | 샌드박스 안에서 `127.0.0.1:7840`·`127.0.0.1:2019`·`100.64.0.0/10`·사설 주소 접속 실패, 허용 호스트 HTTPS 성공. 실패하면 SP-16 대체 경로(§3.7.1) | D | 2단계 | `O 직접` |

#### 3.4.8 M7 런타임 코어(`@helm/runtime`)

- 목표: 에이전트 run을 커널 검사와 함께 돌리고, 실행 의도 → 실행 → 결과를 기록하며, 재시작 뒤 복구하고, 타이머·예산·하위 실행을 다룬다.
- 선행: M4, M6.
- 완료 기준: 12 §6 U-RT-1~13, 13 U-TL-8·U-TL-10·U-AD-1, 06 S9, 12 §6 통합 시나리오. U-RT-14는 M8-10·M12-08, U-RT-15는 M9b-01.
- 배치: 12 §3.1을 따르되 루프 포크 코드는 07 §3.3의 배치(`vendor/pi-agent-core`)를 쓴다(07 §5.2 "12"(1)).
- 규모: XL.

| 작업 ID | 내용 | 산출 파일 | 근거 | 선행 | 완료 조건 | 등급 | 담당 | 모델 |
|---|---|---|---|---|---|---|---|---|
| M7-01 | 훅과 실행 기록: 이벤트 싱크, `beforeToolCall`(커널 `toolcall.intend`, A4 인자 교체), `afterToolCall`(`toolcall.complete`, 관찰), `prepareRequest`(`assertToolDeclarations`), `finishTurn`(`checkSettle`, 최대 2회 계속), 펜싱 | `packages/runtime/src/run/{hooks,journal}.ts` | 12 §3.4, §3.8, 판정 J-40·J-41·J-43 | M4, M6-05, M6-07 | T-RT-01~07 | C | 3단계 | `S → O` |
| M7-02 | run 상태 기계: 시작·재개(`ended(handed_off)` + 같은 thread 새 run, J-38)·중지, run 수준 재시도 | `src/run/{engine,control}.ts` | 12 §3.2, 판정 J-38·J-39 | M7-01 | T-RT-08~13 | C | 3단계 | `S → O` |
| M7-03 | 모델 컨텍스트 투영: 섹션 렌더러, 필수 범주 포함 검사(A9·A11), `run.context_projected`(`cp_`), 결정적 바이트 해시 | `src/projection/model.ts`, `src/projection/sections/*` | 12 §3.5, 판정 J-16 | M7-01 | T-PJ-01~09 | C | 3단계 | `S → O` |
| M7-04 | 컴팩션 | `src/projection/compaction.ts` | 12 §3.6 | M7-03 | T-CP-01~04 | C | 3단계 | `S → O` |
| M7-05 | 부팅 복구와 재개 정책: 11단계 조회(09 §3.8.2), 재실행 판정("의도 시점 safe AND 현재 safe"), 결과 불명 처리(J-44), 크래시 루프 → 안전 모드. 장애 주입용 종료 지점(`run.*`, `tool.*`, `model.*`, `boot.during_recovery`, `scheduler.after_fire`)을 `HELM_TEST_HOOKS=1`이고 운영 경로가 아닐 때만 켠다 | `src/recovery/{boot,policy}.ts`, `src/testing/killpoints.ts` | 12 §3.7, 09 §3.8.2, 22 §3.9.2, 판정 J-39·J-41·J-44 | M7-02 | T-CR-01~08. 훅이 꺼진 상태에서 종료 지점이 동작하지 않는다(U22-6 일부). T-CR-09(무작위 kill 100회)는 M15-02 | C | 3단계 | `S → O` |
| M7-06 | 소유권(epoch·attempt)과 동시성(작업 공간 배타, 전역·제공자 상한, 대기열) | `src/run/journal.ts`, `src/run/engine.ts` | 12 §3.8~§3.9 | M7-02 | T-OW-01~03, T-CC-01~03 | C | 3단계 | `S → O` |
| M7-07 | 스케줄러: 단일 타이머, 60초 단위 재확인, 부팅 catch-up 상한, 시계 점프, cron(사용자 시간대) | `src/scheduler/*` | 12 §3.10, 판정 J-13 | M7-02 | 12의 T-SC-01~06 | C | 3단계 | `S → O` |
| M7-08 | 예산: 원장, 소프트·하드 문턱, lease 예약·정산, 일일 한도 | `src/budget/*` | 12 §3.11, 01 NFR-C | M7-02 | T-BG-01~04 | B | 3단계 | `S → S` |
| M7-09 | 사용자 입력 inbox: steering, follow-up, interrupt, 같은 `inputId` 한 번 | `src/run/inputs.ts` | 12 §3.12 | M7-02 | T-IN-01~04 | B | 3단계 | `S → S` |
| M7-10 | 하위 실행과 포트: 검증·중재·가지·하위 실행, 메모 키, 승인 계획 1회 실행 | `src/run/subagents.ts`, `src/ports/*` | 12 §3.14~§3.15 | M7-02 | T-SA-01~05 | C | 3단계 | `S → O` |
| M7-11 | 화면 투영 공통 규약: 뷰 envelope, `asOfSeq`, 표시 번호(인스턴스 전체 종류별), `degraded` | `src/projection/views.ts` | 12 §3.5.8, 03 §5.2 "12" | M7-03 | T-VW-01~03. 화면별 뷰는 M12 | B | 3단계 | `S → S` |
| M7-12 | Helm 제안 도구: 10 명령 스펙에서 도구 스키마 생성, 제출과 결과를 한 트랜잭션(J-43). 같은 트랜잭션 안의 뒤 제출은 앞 제출의 결과를 본다(판정 J-148), `helm_query` 범위 | `packages/tools/src/helm/{generate,execute,query}.ts` | 13 §3.7, U-TL-8, 판정 J-148 | M7-01, M3-09 | T-HT-01~05 | C | 3단계 | `S → O` |
| M7-13 | 되돌릴 지점: git 스냅숏, tar 스냅숏, 복원, `rollback_point.*` 등록 | `packages/tools/src/rollback/*` | 13 §3.7.8, U-TL-10, 11 §3.12 | M7-12 | T-RB-01~03 | B | 3단계 | `S → S` |
| M7-14 | 런타임 어댑터 계약과 적합성 틀: 계약 타입, `deriveLevel`, 1차 어댑터, 가짜 어댑터 | `packages/runtime/src/adapter/{contract,helm-adapter,fake-adapter,conformance}.ts` | 13 §3.11, U-AD-1, 06 §3.13, S9 | M7-02 | T-AD-01~03(Level D: 13 AC-01~14), 13 §3.11.7의 적합성 대본 전부(`runAdapterConformance`), 22/CF-04(거짓 광고 가짜 어댑터), 06 S9 | B | 3단계 | `S → S` |
| M7-15 | 통합 시나리오: X3-4-11의 한 turn 흐름(읽기 → 해석 제안 → 합의 없이 쓰기 차단 → 합의 → 확인 → 쓰기 → 결과 제출 → 확인)을 가짜 모델 대본으로 | `packages/runtime/test/integration/one-turn.test.ts` | 12 §6 통합 시나리오, 10 §6.2 "C/A 흐름" | M7-01~M7-13 | 모든 기록과 거부가 12 §3.4.3 순서. durable-spike 스파이크 1의 c1~c7과 같은 결과 | C | 3단계 | `S → O` |
| M7-16 | 런타임 수명주기: `drain(timeoutMs)`, `abortAll(reason)`, `pause`·`resume`(17의 종료 순서·업그레이드가 쓴다) | `packages/runtime/src/lifecycle.ts` | 12 U-RT-13, 17 §5.2 "12"(3) | M7-05 | T-LC-01~03 | B | 3단계 | `S → S` |
| M7-17 | 유즈케이스 하네스 `kernel` 모드: 엔진·임시 저장소(`@helm/engine/testing`), 투영 함수, 도구 → 명령 대응(`FakeToolExecutor`)으로 대본을 돌리는 실행기 골격과 `UC-07/basic`·`UC-02/helm-toy`의 `kernel` 모드 대본. 런타임 시험 도우미 `@helm/runtime/testing`의 `whenIdle()` | `tests/harness/{runner,expect,steps,trace}.ts`, `tests/scenarios/{uc-07-agreement-acceptance,uc-02-cause-investigation}.scenario.ts`(`kernel` 모드), `packages/runtime/src/testing/when-idle.ts` | 22 §3.8.1~§3.8.3, 22 §5.2 "12"(2) | M4-05, M7-03, M7-12, M6-07 | 두 대본이 `kernel` 모드로 통과. 같은 대본 두 번 → strict 동일 | C | 3단계 | `S → O` |

#### 3.4.9 M8 오케스트레이션과 묻기 실행

- 목표: 루프 계약·상황 판정·계획·전환·진입 판정·거시 스케줄러(14)를 순수 코어와 효과 부분으로 나눠 만들고, 질문 전달·재개(11·12)와 복귀 요약 생성(O)을 붙인다. 유즈케이스 시나리오 하네스를 만든다.
- 선행: 순수 코어(M8-01~M8-08)는 M3 뒤에 시작할 수 있다. 효과 부분(M8-09~M8-12)은 M7 뒤.
- 순서: C.commit·A.confirm → O(복귀 요약) → I.fact 계획 → 거시 스케줄러 → A.reflect. I.want 실행 연결은 M9b(01 OQ-01).
- 완료 기준: 14 §6.2 C-1~C-24의 MVP 판본, 01 §6 "진입 판정"·"승격 신호", 11 §5.2 "12" (1)~(5). C-22의 MVP 계획이 실제로 도는지는 M9b-02에서, C-4·C-10·C-22의 2단계·3단계 판본은 M16·M18에서 확인한다.
- 재생 테스트의 SQLite: 14 §6.2는 "메모리 SQLite"라고 적었으나 09 §6.2는 메모리 DB를 쓰지 않는다. 임시 디렉터리의 실제 파일로 한다(§5.2 14·22 요구).
- 규모: XL.

| 작업 ID | 내용 | 산출 파일 | 근거 | 선행 | 완료 조건 | 등급 | 담당 | 모델 |
|---|---|---|---|---|---|---|---|---|
| M8-01 | 루프 계약 18개, 조건 레지스트리, 지시문 템플릿. 분할: (a) 타입·레지스트리·조건, (b) O·I 계열 계약, (c) C·A 계열 계약, (d) S 계열 계약(3단계용, 기본 꺼짐) | `packages/kernel/src/orchestration/contracts/{types,registry,guards}.ts`, `catalog/*.ts`, `instructions/*.md` | 14 §3.5~§3.6 | M3-04 | 14 C-1, C-2 | B | 3단계 | `S → S` |
| M8-02 | 상황 판정과 루프 계획(`buildPlan`, `planPosition`) | `src/orchestration/{situation,plan}/*` | 14 §3.7~§3.8 | M8-01 | 14 C-3, C-4, C-5 | C | 3단계 | `S → O` |
| M8-03 | 전환 규칙 T01~T32, 가드 G1~G9, 의존 규칙 사전 맞춤 | `src/orchestration/transitions/*` | 14 §3.9 | M8-02 | 14 C-6, C-7, C-8 | C | 3단계 | `S → O` |
| M8-04 | 모드와 다이얼(`DIAL_DEFS`, 층 해석, 자동 상향) | `src/orchestration/{modes,dials}/*` | 14 §3.10~§3.11, 판정 J-12 | M8-01 | 14 C-9, C-10 | B | 3단계 | `S → S` |
| M8-05 | 진입 판정(EC-3 예외, 고정 문턱 2), 승격 신호 집계, 강등. 런타임의 승격 신호 감지(PS-1 같은 확인 3회 실패, PS-3 범위 밖 호출) | `src/orchestration/entry/*`, `packages/runtime/src/signals/*` | 14 §3.14, 01 §3.6, §6, 판정 J-01 | M8-02 | 14 C-11. 01 §6 "진입 판정" (1)~(6), "승격 신호" | B | 3단계 | `S → S` |
| M8-06 | 거시 스케줄러: 우선순위, 허가, 주의 예산, 작업 경계, C/A 상한과 묶기 | `src/orchestration/macro/*` | 14 §3.13, 판정 J-13 | M8-02 | 14 C-12~C-15 | C | 3단계 | `S → O` |
| M8-07 | ConcernView 리듀서, `decide`, 이의 처리 | `src/orchestration/concern/*` | 14 §3.12, §3.16 | M8-03, M8-06 | 14 C-19, C-24. C-16~C-18은 M8-12에서 | C | 3단계 | `S → O` |
| M8-08 | 루프 기능 플래그(`features.enabledLoops`·`enabledModes`)와 꺼진 루프 대체 동작 | `src/orchestration/features.ts` | 14 §3.15, 06 §3.10.3 | M8-02, M1-04 | 14 C-22. A.confirm을 끄면 설정 오류 | B | 3단계 | `S → S` |
| M8-09 | 효과 부분: 설정 읽기 모델, 행동 실행(`engine.submit`, `startRun`, 질문 제출), WorkRequest → RunSpec 변환, 오케스트레이터 루프와 체크포인트 | `packages/runtime/src/orchestration/{settings,executor,to-run-spec,loop,scheduler,index}.ts` | 14 §3.16, §3.20 | M7, M8-07 | 14 C-20, C-21, C-23 | C | 3단계 | `S → O` |
| M8-10 | 묻기 실행: `notify` 지시 → 전달기 → `question.mark_delivered`(연결 클라이언트가 없으면 channel `brief`), `needs_gate` 정지와 답 뒤 재개(같은 `toolCallId`), `boundary.reached` 제출, presence 집계(J-46) 입력, 중재자 실행 자리(2단계 플래그) | `packages/runtime/src/deliver/notify.ts`, `src/asking/{resume,boundaries,presence}.ts` | 11 §3.5~§3.7, §5.2 "12", 12 §3.13, 판정 J-46·J-51·J-52 | M8-09 | 12 T-DL-01·02. 11 §6.2 "사람 부재" 대본을 런타임까지 포함해 재현 | C | 3단계 | `S → O` |
| M8-11 | 복귀 요약 생성(O): 9절 구성, 의미 묶음 최대 5, 결정적 부분 먼저(1초), summarizer 역할 실패 시 목록만 | `packages/runtime/src/projection/brief.ts` | 12 §3.5.8, 04 §3.2, 01 NFR-P-5, 12 O-12-09 | M8-09 | T-VW-03. 결정적 부분 생성 1초 이하(벤치 기록) | B | 3단계 | `S → S` |
| M8-12 | 유즈케이스 하네스의 `runtime` 모드(데몬 인스턴스 조립, 단계 실행, 기대 검사, 명령으로 만든 상태 픽스처, 합성 작업 공간, 장애 뒤 공통 검사, 비밀 카나리아)와 C/A·O·가벼운 작업 대본: UC-03, UC-05, UC-06, UC-07, UC-12, UC-13, UC-15. `view` 단계가 있는 대본은 `requires: ['views']`를 선언하고, M12 행이 `done.ts`에 들어가기 전까지 하네스가 "선행 미도달"로 건너뛴다(22 §3.8.2). M12-10에서 다시 돈다. "증분 투영 = 재구성" 시험을 대본 골든(`tests/scenarios/golden/*.golden.jsonl`)으로 다시 돈다 | `tests/harness/*`, `tests/scenarios/uc-{03,05,06,07,12,13,15}-*.scenario.ts`, `tests/scenarios/scenarios.test.ts` | 02 §3.24·§6, 14 C-16~C-18, 09 §6.2 `projectors` (2), 22 §3.8, U22-4·U22-5·U22-11 | M8-10, M8-11, M7-17 | 14 C-16, C-17, C-18. U22-4 (1)(`runtime`·`kernel` 두 모드), (3)~(5), U22-5, U22-11. U22-4 (2)의 `protocol` 모드는 M11-05. 대본마다 `onNormalPath` 조작 수가 01 R-OP-1을 지킨다. 레시피 `test-scenarios`, `test-golden-update` | C | 3단계 | `S → O` |

#### 3.4.10 M9 탐구 엔진

탐구 엔진은 `KernelPort`만 보므로 평가용 메모리 커널로도 돈다(15 D15-9). 이 성질을 써서 순수 부분과 평가 하네스(M9a)를 런타임보다 먼저 만들고 G0를 일찍 돌린다. 런타임 연결(M9b)은 M8 뒤에 한다. 순수부(`planRound`, `roundClosable`, 탐구 투영과 그것이 부르는 순수 함수)는 `@helm/kernel/orchestration/inquiry`에, 프롬프트·평가 하네스·`runStage`는 `@helm/runtime`에 둔다(판정 J-128).

- 선행: M9a는 M1·M6. M9b는 M7·M8.
- 완료 기준: 15 §6.2의 MVP 해당 항목(T-01~T-15, T-21~T-24, T-26~T-29). 가능성·결과 탐구, 렌즈, REPL(T-16~T-20, T-25)은 M16.
- MVP 범위: 사실 탐구, 원함 탐구(텍스트·이미지 자극, 요소 단위 반응, 기준 후보, 선호 모델, 정지 규칙), 발산은 앵커링·대비 압축 순서·정지 규칙(01 §3.8.2).
- 규모: XL(M9a L, M9b M).

| 작업 ID | 내용 | 산출 파일 | 근거 | 선행 | 완료 조건 | 등급 | 담당 | 모델 |
|---|---|---|---|---|---|---|---|---|
| M9a-01 | 엔진 골격. 순수부(`planRound`, `decideStage`, 출력 → 명령 변환, 결정적 난수, 타입)는 `@helm/kernel/orchestration`에, 효과부(`runStage`, 포트)는 런타임에 둔다(판정 J-128) | `packages/kernel/src/orchestration/inquiry/{plan-round,types,translate,rng}.ts`, `packages/runtime/src/inquiry/{run-stage,ports}.ts` | 15 §3.1~§3.2, 판정 J-128 | M1, M3-01, M6-02 | T-01, T-23, T-29(명령·이벤트 이름 대조). 순수부가 `node:`·`ai`를 import하지 않는다(`check-arch`) | C | 3단계 | `S → O` |
| M9a-02 | 발산(MVP: 신호, 앵커링, 행, 표, 모델 배정, 중복 제거). 다섯 방향·가지별 다른 모델·적대적 검토는 2단계 플래그 뒤에 둔다 | `packages/kernel/src/orchestration/inquiry/divergence/*` | 15 §3.4.1~§3.4.8 | M9a-01 | T-02, T-03, T-04 | C | 3단계 | `S → O` |
| M9a-03 | 대비 압축과 근거: 결과 선언, 대비 순서, 질문 하나 고르기, 사전 검사, 지지 등급(J-19, 숫자 없음) | `packages/kernel/src/orchestration/inquiry/{contrast,evidence}/*` | 15 §3.3, §3.4.9~§3.4.10 | M9a-01 | T-05, T-06, T-07, T-08 | C | 3단계 | `S → O` |
| M9a-04 | 사실 탐구: 확인 순서, 적용, 반대 근거 탐색, 승격 사전 검사, 정지 | `packages/kernel/src/orchestration/inquiry/fact/*`, `packages/kernel/src/orchestration/inquiry/plan/fact.ts` | 15 §3.5, 10 §3.9 | M9a-03 | T-09, T-10, T-11 | C | 3단계 | `S → O` |
| M9a-05 | 원함 탐구: 자극 생성, 요소, 반응, 기준 후보, 다음 자극 선택, 정지. 선호 모델 수명주기(Goal 층. 사용자 층은 15 O-2대로 꺼 둔다) | `packages/kernel/src/orchestration/inquiry/{want,preference}/*`(`want/present.ts` 포함), `packages/kernel/src/orchestration/inquiry/plan/want.ts`, 탐구 투영 | 15 §3.6~§3.7, 판정 J-06(첫 라운드 8, 최소 4), J-34 | M9a-03 | T-12, T-13, T-14, T-15, T-27(`presentStimuli`), T-28(반응 대응). `roundClosable`은 10 `inquiry.round.close` 검사가 쓴다(M3-07의 그 명령은 이 행 뒤에 마무리) | C | 3단계 | `S → O` |
| M9a-06 | 정지 지문, 예산, 결정 18 집행 | `packages/kernel/src/orchestration/inquiry/stop/fingerprint.ts` | 15 §3.4.14~§3.4.15, §3.13.3, 브리프 결정 18 | M9a-04, M9a-05 | T-22, T-24 | B | 3단계 | `S → S` |
| M9a-07 | 역할별 프롬프트와 출력 스키마, 역할별 가짜 모델 대본 | `packages/runtime/src/inquiry/{prompts,schemas}/<role>.ts`, `packages/testkit/fixtures/inquiry/*` | 15 §3.13.5~§3.13.6 | M9a-01, M6-06 | 출력 스키마에 숫자 신뢰도 필드가 없다(T-06의 스키마 검사) | B | 3단계 | `S → S` |
| M9a-08 | 평가 하네스와 `just eval-inquiry`(실제 모델, `verify` 밖), 결과 YAML 형식, 평가 데이터 디렉터리 | `packages/runtime/src/inquiry/eval/{harness,memory-kernel,report}.ts`, `.just/helm.just` | 15 §3.15.2, 17 §5.1 "15"(`eval/`) | M9a-06, M9a-07 | T-26(가짜 모델로 과제 하나를 끝까지). 실제 실행은 HT-16(G0) | B | 3단계 | `S → S` |
| M9b-01 | 런타임 연결: `RunKind "inquiry"`, 포트 구현(모델, 하위 실행), 메모 키 재사용, 단계 예산 예약, 자식 run의 `forkCursor`·`excludeThreads`, 도구 호출 `purpose` | `packages/runtime/src/run/inquiry.ts`, `src/ports/*`, `src/inquiry/runtime/*` | 15 §5.2 "12", 12 §3.14~§3.15, 12 U-RT-15, 판정 J-97 | M9a-06, M7-10 | 15 T-21(끊긴 단계 재요청, 메모 키, dispatch 멱등), 12 T-IQ-01~03 | C | 3단계 | `S → O` |
| M9b-02 | 루프 연결: I.fact·I.want 계약과 `planRound`·`runStage`, 라운드 끝 `runtime.boundary(round_end)`, 자극 blob(이미지·긴 초안), 웹 레퍼런스(M6-14) | `src/inquiry/runtime/loop-binding.ts` | 14 §3.6.2~§3.6.5, 15 §3.1.1, 09 §3.12 | M9b-01, M8-09 | 14 C-22의 MVP 계획(`O → I.want → C.commit → A.confirm`)이 실제로 돈다 | C | 3단계 | `S → O` |
| M9b-03 | 탐구 유즈케이스 대본(`view` 단계는 M12-10에서 켠다): UC-01(원함 탐구, `UC-01/pick-only` 포함), UC-02(원인 조사, `UC-02/helm-toy`·`strict-proof` 포함), UC-09(Goal 정제) | `tests/scenarios/uc-{01,02,09}-*.scenario.ts` | 02 §3.4·§3.5·§3.12, 15 §5.2 "02", 22 §3.8.4 | M9b-02, M8-12 | `runtime` 모드로 통과하고 AC가 추적 색인에 연결된다(`just test-trace`) | B | 3단계 | `S → S` |

#### 3.4.11 M10 프로토콜·클라이언트 코어·문구

- 목표: 와이어 형식과 등록 표, 가짜 데몬과 적합성 스위트, 모든 클라이언트가 함께 쓰는 연결·재접속·재전송 코어, 공유 문구 목록을 데몬보다 먼저 만든다(19 §5.2 "23").
- 선행: M1. 임계 경로 밖 갈래(proto).
- 완료 기준: 19 §6.1 전부, 19 §6.2의 `packages/client` 행 전부, §6.3 CT-01~35(가짜 데몬 대상), 05 §6 `ui-language` 행.
- 규모: L.

| 작업 ID | 내용 | 산출 파일 | 근거 | 선행 | 완료 조건 | 등급 | 담당 | 모델 |
|---|---|---|---|---|---|---|---|---|
| M10-01 | JSON-RPC envelope, 코덱, 오류 표(거부 세 갈래 대응) | `packages/protocol/src/{jsonrpc,codec,errors}.ts` | 19 §3.1, §3.3 | M1 | 19 §6.1 "envelope·codec", "오류 표" | B | 3단계 | `S → S` |
| M10-02 | 메서드 등록 표(10 명령 대응 열 포함), 핸드셰이크 스키마와 정책, 이벤트·뷰·스트림 스키마 | `src/{registry,handshake,events,views,stream}.ts` | 19 §3.4, §3.6~§3.8, §3.13, 04 각 절의 뷰 `data` 타입(19 §3.7.4가 04 소유로 둠), 판정 J-30·J-36 | M10-01 | 19 §6.1 "등록 표", "핸드셰이크 스키마", "이벤트·뷰·스트림 스키마" | B | 3단계 | `S → S` |
| M10-03 | 생성 스크립트(JSON Schema, 참조 문서), 등록 표 검사, 브라우저 안전 검사(esbuild `platform: "browser"`) | `packages/protocol/scripts/{gen-*,check-registry}.ts` | 19 §3.13 | M10-02 | 19 §6.1 "생성 스크립트", "브라우저 안전" | A | 3단계 | `H → S` |
| M10-04 | `@helm/protocol/testing`: `FakeDaemon`, 시나리오 DSL, 적합성 스위트 CT-01~35 | `packages/protocol/src/testing/*` | 19 §6.3 | M10-02 | `FakeDaemon`이 CT-01~35을 통과(19 §6.1 "테스트 도구"). 같은 스위트를 M11-05가 실제 데몬에 돌린다 | C | 3단계 | `S → O` |
| M10-05 | `@helm/client`: 연결 상태 기계, 백오프, 구독 복원·gap, 진행 중 명령함, 뷰 무효화, 휘발 스트림, 하위 경로 `node`(WS·Unix 전송)·`browser`(브라우저 WebSocket, 모바일 PWA용)·`testing`(가짜 전송·가짜 시계). 20의 요구(`blocked` 실패 종류, `retryNow()`, `lastMessageAt`, `pendingResolved`, `savePosition` 전 `invalidate`, presence `depth`) | `packages/client/src/{connection,backoff,subscriptions,outbox,views,stream}.ts`, `src/node/*` | 19 §3.10, §3.14, 20 §5.2 "19" | M10-04 | 19 §6.2 `packages/client` 행 전부(가짜 전송·가짜 시계) | C | 3단계 | `S → O` |
| M10-06 | `@helm/ui-language`: 문구 키 타입, 한국어 문구, 상태 라벨(03 §3.3), 조사 처리, 금지 표현 검사, 오류 코드 → 문구 키 대응 | `packages/ui-language/src/{ko,keys,labels,josa}.ts`, `test/forbidden.test.ts` | 05 §3.10~§3.11, §6, 03 §3.3, 판정 J-31 | M10-01 | 05 §6 "공유 문구 목록", "금지 표현 검사", "조사 처리", "오류 문구". 03 §6 "상태 라벨 목록" | B | 3단계 | `S → S` |

#### 3.4.12 M11 데몬·보안·운영·CLI

- 목표: 상주 데몬 `helmd`(설정, 수명주기, 비밀, 리스너 셋, 인증, 프로토콜 계층, 관찰 감독기, 운영 기능)와 관리 CLI `helm`, systemd 단위와 운영 스크립트를 만들고 이 서버에 설치한다.
- 선행: M4, M7, M8(시작 순서의 복구·오케스트레이터 단계), M10. 화면 뷰(M12)는 인터페이스(`ProjectionsForProtocol`)만 먼저 쓰고 구현은 병렬.
- 순서: 잠금·시작·종료 → 리스너·인증·프로토콜 → 백업·복원 → 업그레이드 → 훈련·유지 타이머(17 §5.2 "23").
- 완료 기준: 17 §6.2(수동 제외)가 `just verify`와 `just daemon-systest`에서 통과, `just daemon-install` → `just daemon-status` ok, T17-30·T17-31 1회 수행. 18 §6 완료 기준(T18-08~11 실패 시 `execute` 켜지 않음). 06 S3·S5·S6·S7·S8. 19 §6.2 데몬 행. 19 §6.4.
- 규모: XL(TS 9천~1만1천 줄 + bash 스크립트).

| 작업 ID | 내용 | 산출 파일 | 근거 | 선행 | 완료 조건 | 등급 | 담당 | 모델 |
|---|---|---|---|---|---|---|---|---|
| M11-01 | 설정과 운영 로그: `helmd.toml`·`helmd.local.toml`(TOML, 판정 §2), 우선순위 5단계, 출처 표시, 리로드 분류, `features` 절, `budget`, `user.timeZone`, `maintenance`, 비밀처럼 보이는 키 거부. pino 로거와 redact | `packages/daemon/src/config/{schema,load}.ts`, `src/log/*` | 06 §3.10~§3.11, S3, 17 §3.3, 판정 §2 | M4, M1-04 | 06 S3. T17-01, T17-02 | B | 3단계 | `S → S` |
| M11-02 | 수명주기: 진입점, 시작 순서(저장소 → 무결성·마이그레이션·재구성 → 12 복구 → 오케스트레이터 → 스케줄러 → 리스너), 종료 순서·유예, 신호, 모드(`ready`·`read_only`·`safe_mode` 등), 크래시 루프, 감시 워커, owner 파일. 단일 writer 잠금은 `@helm/store/admin`(M2-01, 판정 J-101)을 쓴다 | `packages/daemon/src/{main,bin/helmd}.ts`, `src/lifecycle/{instance-lock,boot,shutdown,signals,modes,crash-loop,watchdog,owner-file}.ts` | 17 §3.1·§3.4, 12 §3.7.3·§3.7.7, 14 §5.2 "17" | M11-01, M7-05, M8-09 | T17-03~09, T17-11~15, T17-18, T17-19. 17의 종료 지점 훅(`HELM_TEST_KILLPOINT`)이 운영 데이터 경로에서 켜지지 않는다(22 §5.2 17 (2)) | C | 3단계 | `S → O` |
| M11-03 | 비밀 로더(판정 45): `secrets run`을 자식 로더로 써서 `SecretStore`(메모리)에 넣는 `helm-secret-export`. OAuth 토큰 거부 | `packages/daemon/src/secrets/{loader,export-main}.ts`, `src/security/secret-store.ts` | 17 §3.8, 18 §3.10, 07 E24 | M11-02 | T17-10, T18-14, T18-30 | C | 3단계 | `S → O` |
| M11-04 | 리스너 셋(`tailnet` 127.0.0.1:7840, `loopback` 127.0.0.1:7841, `local` `rpc.sock`, 개발 7851)과 `/healthz`(17 형식), 인증: 주체, 사전 검사, Tailscale 신원 헤더·whois, 기기 토큰(해시 저장), 페어링(`POST /pair`, 12자 코드), 속도·크기 한도. 분할: (a) 리스너 셋·`/healthz`, (b) 주체·사전 검사·Tailscale 신원, (c) 기기 토큰·페어링, (d) 속도·크기 한도 | `packages/daemon/src/listeners/{index,tailnet,ssh,local,healthz}.ts`, `src/auth/{principal,preflight,tailscale-ingress,whois,device-auth,pairing,tokens,rate-limit}.ts` | 17 §3.5, §3.11.3, 18 §3.4~§3.8, §3.14, 19 §3.2, 판정 §2, 판정 46 | M11-02 | T18-01~04, T18-06, T18-07, T18-15~17, T18-20, T18-21 | C | 3단계 | `S → O` |
| M11-05 | 프로토콜 계층: 업그레이드, 연결·핸드셰이크, 디스패처, 명령(멱등, `basisSeq` → `3004`, 커밋 알림이 응답보다 먼저), 이벤트 구독, 뷰(`minSeq`), 파일 HTTP, 백프레셔. 세 리스너 동등성. CF-01은 19 적합성 스위트(CT-01~35)로 먼저 돌고, 하네스 `protocol` 모드와 그 대본(`UC-04/basic`, `UC-04/B`, `UC-10/A`, `UC-17/basic`)을 이 행 안에서 만든 뒤 CF-01의 대본 부분을 더한다(22 §3.8.2). 분할: (a) 업그레이드·연결·핸드셰이크·디스패처, (b) 명령·이벤트 구독·뷰, (c) 파일 HTTP·백프레셔, (d) `protocol` 모드 하네스·대본·적합성 | `packages/daemon/src/protocol/{listeners,upgrade,connection,handshake,dispatcher,commands,views,files}.ts`, `src/protocol/subscriptions/events.ts`, `tests/conformance/{listeners,fake-daemon}.test.ts`, `tests/harness/steps/client.ts`(`protocol` 모드), `tests/scenarios/{uc-04-answer-remote,uc-10-restart,uc-17-continue-elsewhere}.scenario.ts`(`protocol` 모드 대본) | 19 §3.4~§3.11, §6.2 데몬 행, 06 S5 | M11-04, M10-04, M8-12 | 19 §6.2 데몬 행 전부(속성 테스트 포함). U22-4 (2)(빈 대본이 세 모드에서 통과). 22/CF-01(세 리스너 동등성, `protocol` 모드 대본 포함), 22/CF-03(`FakeDaemon` 대 실제 데몬), 22/CF-05(클라이언트 코어 대 리스너). 정규화한 메시지 열이 같다(06 S5) | C | 3단계 | `S → O` |
| M11-06 | SSH 경로 확인: `ssh -W 127.0.0.1:7841`(WSL sshd 자신)로 같은 적합성 스위트. 레시피 `test-conformance-ssh` | `tests/conformance/ssh.slow.test.ts`, `.just/helm.just` | 06 S6, 19 §6.3 (4), 22/CF-02, 결정 38 | M11-05, HT-23 | 06 S6. 22/CF-02. sshd나 시험 키가 없으면 종료 코드 2 | D | 2단계 | `O 직접` |
| M11-07 | 보안 모듈: 공통 redactor(M1-09 규칙. 사람 명령 payload도 입력 단계에서 가린다, 판정 J-147), 보호 경로, 권한 기준선 연결, 감사 묶음, 체인 기준점, 네트워크 허용 실행의 CONNECT 프록시 기동(M6-16) | `packages/daemon/src/security/{redactor,protected-paths,permission-baseline,audit-batcher,anchors}.ts` | 18 §3.10~§3.13 | M11-03 | T18-13, T18-18, T18-19, T18-22, T18-23, T18-24, T18-27, T18-28 | C | 3단계 | `S → O` |
| M11-08 | 관찰 감독기 경계: fork·대기열·시간 초과·IPC(`kernel.submit`, `llm.complete` 대행)·2차 마스킹·예산, 행위자 고정 `agent:observer`, 비밀 없는 환경. 관찰 프로세스 본체는 M14 | `packages/daemon/src/observer-supervisor.ts` | 16 §3.2.3, 06 S7, 17 §5.2 "16" | M11-02 | 06 S7. 16 OB-T02, OB-T04, OB-T11(가짜 관찰 프로세스) | C | 3단계 | `S → O` |
| M11-09 | 운영 기능: 상태(`OpsStatus`), 상태 점검, 백업·매니페스트, 복원(quarantine, 새 `storeId`), 검증, 훈련, 진단 묶음, 리로드. 고아 프로세스 정리 | `packages/daemon/src/ops/{status,health-checks,backup,backup-manifest,restore,verify,drill,diag,reload}.ts`, `src/process/{systemd-run,orphans}.ts` | 17 §3.9~§3.11, §3.13, 09 §3.14 | M11-02, M2-09 | T17-16, T17-17, T17-20, T17-21, T17-29, T17-32, T17-33 | C | 3단계 | `S → O` |
| M11-10 | 관리 CLI `helm`: `status`, `doctor`, `daemon`, `pair`, `device issue`, `devices`, `audit`, `ops *`, `diag`, `attach`, `observer`, `events tail`, `export`, `config check/print/schema`. 사람 결정 명령은 TTY에서 확인 문자열을 넣은 경우만 받고, 비대화 localAdmin은 읽기와 관리만 한다(판정 J-135) | `apps/cli/src/commands/*` | 17 §3.15, 18 §6, 06 S8, 판정 §2·J-135 | M11-05, M11-09, M10-05 | 06 S8. 18 T18-16. J-135 규칙의 단위 테스트(TTY 없음·확인 문자열 없음 → 거부). 종료 코드는 17의 CLI 종료 코드 표(§5.2 17 요구)를 따른다 | B | 3단계 | `S → S` |
| M11-11 | systemd 단위, 운영 스크립트, Windows 확인 스크립트, 홈랩 요청 목록, `daemon-*` 레시피, 시스템 테스트. H-2 전까지 일일 스냅숏을 `/mnt/d/backup/helm/`에 복사하는 레시피와 doctor 경고(판정 J-146) | `ops/systemd/*.in`, `ops/bin/*`, `ops/windows/check-helm-host.ps1`, `ops/homelab-requests.md`, `ops/test/run-systest`, `.just/helm.just` | 17 §3.6, §3.7, §3.10, §3.14, 판정 J-146 | M11-09, M11-10 | T17-22~28, T17-24, T17-25. 18 T18-08~11·T18-29·T18-33의 시스템 판본(`just daemon-systest`) | B | 3단계 | `S → S` |
| M11-12 | 이 서버에 운영 데몬 설치와 확인: `just daemon-install`, `just daemon-status`, SP-10(serve 경로), SP-14(WSL 재기동). 월 비용 상한 입력(HT-13) | 설치 결과(저장소 산출물 없음), `docs/specs/spikes/SP-10.md`, `SP-14.md` | 17 §6.2 완료 기준, §3.7.1 | M11-11, HT-05, HT-09, HT-12, HT-13 | `daemon-status` ok. 수동 T17-30, T17-31, T18-05, T18-12 결과 기록 | D | 2단계 | `O 직접` |
| M11-13 | 종단 측정 레시피 `just perf` 도입: 22/PF-02(질문 답 p95 ≤ 300 ms), PF-03(커밋 → 알림 p95 ≤ 500 ms), PF-04(1,000개 재생 + 뷰 3개 3초 이하), PF-06(엔진 트랜잭션), PF-08(재시작부터 복구 30초), PF-11(대기 CPU·메모리) | `packages/daemon/bench/*`, `tests/perf/*` | 19 §6.4, 01 §6 "비기능 요구 측정", 22 §3.13 | M11-05, M2-10 | 서버 측정 결과를 파일로 남기고 목표 안. 넘으면 행을 끝내지 않고 1단계가 판정한다(§3.1.3-14) | B | 3단계 | `S → S` |

#### 3.4.13 M12 화면 투영(뷰)

- 목표: 03 화면 ID별로 04가 정한 "표시 데이터"를 19 `view.get` 카탈로그의 뷰로 만든다. 앱은 계산하지 않고 받은 값을 그린다(03 §6 "배지 수는 투영 값과 같다").
- 선행: M7-11(공통 규약), M8(ConcernView, 복귀 요약), M9b(탐구 투영), M10-02(뷰 스키마). M11-05의 `views.ts`가 이것을 부른다.
- 완료 기준: 뷰 이름마다 19 스키마를 통과하는 예시, VIEW-01 속성 테스트, T-VW-01·02, 03 §6 "표시 번호".
- 규모: L.

| 작업 ID | 내용 | 산출 파일 | 근거 | 선행 | 완료 조건 | 등급 | 담당 | 모델 |
|---|---|---|---|---|---|---|---|---|
| M12-01 | 뷰 공통: `ViewResult`(`asOfSeq`, `generatedAt`, 신선도, 누락 범주), 무효화 태그(12의 순수 함수 `aggregateTags`가 커밋 트랜잭션 안에서 계산하고 09 `event_invalidations`에 저장, 프로토콜은 저장된 태그를 보낸다)와 뷰별 `dependsOn`, 집계 태그 표(12 한 곳), 표시 번호 | `packages/runtime/src/projection/views/{common,tags,display-numbers}.ts` | 19 §3.6.3, 12 §3.5.8, 09 §3.7, 03 §3.2.6·§5.2 "12" | M7-11, M10-02, M4-03 | 19 VIEW-01, 12 T-VW-04(무효화 태그 속성). T-VW-01. 같은 로그 두 번 → 같은 표시 번호. 재전송한 옛 이벤트와 실시간 이벤트의 태그가 같다 | C | 3단계 | `S → O` |
| M12-02 | 홈·트레이·질문함·질문 뷰: 주의 카드(정보 질문 3, 권리 게이트는 전부), `priorityReason`, `impact`, 응답 선택지, 깊이 | `src/projection/views/{home,tray,inbox,question}.ts` | 04 §3.1·§3.3·§3.4·§3.24, 11 §3.5.4, 19 §3.7.4 | M12-01, M8-10 | 뷰 예시가 스키마 통과. 권리 게이트 질문에 "가정대로 진행" 선택지가 없다 | B | 3단계 | `S → S` |
| M12-03 | 복귀 요약 뷰: 9절(미룬 반영 항목이 있으면 0절), 열린 동안 고정(`untilSeq`), `briefRecommended` | `src/projection/views/brief.ts` | 04 §3.2, 12 §3.5.8, 19 §5.1 | M8-11 | 결정적 절 1초 이하. 요약을 연 뒤 새 이벤트가 와도 본문이 같다 | B | 3단계 | `S → S` |
| M12-04 | Concern·작업·합의·결과 확인·루프·대화 뷰 | `src/projection/views/{concern-tree,concern,work,agreement,review,loop-timeline,thread}.ts`(19 뷰 이름 `concernTree`, `concern`, `work`, `agreement`, `review`, `loopTimeline`, `thread`) | 04 §3.6~§3.14 | M12-01, M8-07 | 결과 확인 뷰: 반영 항목이 남으면 상태가 `integrated`가 아니다. 근거가 모델 문장뿐인 기준이 "확인 못함" | B | 3단계 | `S → S` |
| M12-05 | 근거·Goal·에이전트가 정한 것·기록 뷰 | `src/projection/views/{evidence-chain,goals,goal,autonomous,records}.ts`(19 뷰 이름 `evidenceChain`, `goals`, `goal`, `autonomous`, `records`) | 04 §3.5, §3.15~§3.16, §3.23 | M12-01 | 근거 뷰: 반대 근거 "찾아보지 않음"과 "찾아봄: 없음"이 다른 값. "묻지 않은 이유"가 비지 않는다 | B | 3단계 | `S → S` |
| M12-06 | 탐구·자극 뷰(사실·원함): 라운드, 섞은 라벨, 요소 범위, 라운드 마친 뒤에만 공개하는 기준, 대비 정렬, 지지 등급 단어 | `src/projection/views/{inquiry,stimulus-round}.ts` | 04 §3.8~§3.9, 15 §5.2 "19", 판정 J-19 | M9b-02 | 라운드를 마치기 전 뷰에 "확인하려는 기준"이 없다 | B | 3단계 | `S → S` |
| M12-07 | 다이얼·설정·기기(연결 화면의 기기 목록)·복구 뷰 | `src/projection/views/{dials,settings,devices,recovery}.ts`(19 뷰 이름 `dials`, `settings`, `devices`, `recovery`. 데몬 상태는 `DaemonStatus` 메서드) | 04 §3.17, §3.19~§3.21, 14 §3.11.2, 17 §3.11.1, 18 §3.7~§3.8(기기) | M12-01, M11-09 | 다이얼 뷰가 `DIAL_DEFS`에서 만들어진다(MVP 노출 다섯 개). 복구 뷰: 재실행 `unsafe` 항목에 재실행 행동이 없다 | B | 3단계 | `S → S` |
| M12-08 | 의미 미리보기(`composer.preview`)와 진행 중 메시지의 현재 텍스트(`stream.subscribe`의 `active`) | `packages/runtime/src/projection/preview.ts`, `src/stream/*` | 19 §5.2 "12"(3)(5), 05 §3.4 | M7-09 | "적용됨"과 "확인 필요" 종류가 구분된 결과. 12 T-ST-01(휘발 조각 50 ms 묶음, 16 KiB 이하, `end`는 종결 커밋 뒤) | B | 3단계 | `S → S` |
| M12-09 | 앱 뷰 표본: `protocol` 모드 대본으로 뷰 26개의 고정 표본을 만든다(`just test-fixtures-views`). M13b·M13c 시험과 `shot`이 쓴다 | `apps/desktop/test/fixtures/views/*.json`, `.just/helm.just` | 22 §3.15.3, 20 §3.13.3 | M12-01~M12-08, M11-05 | 뷰마다 표본 하나 이상, 19 스키마 통과. 다시 만들어도 같은 내용 | A | 3단계 | `H → S` |
| M12-10 | `requires: ['views']` 대본 확인: M8-12·M9b-03에서 "선행 미도달"로 건너뛰던 대본(예: UC-03 `brief`, UC-01 `agreement`)을 실제 뷰로 돌린다 | `tests/scenarios/*.scenario.ts` | 22 §3.8.1~§3.8.2 | M12-01~M12-08, M8-12, M9b-03 | `requires: ['views']` 때문에 건너뛴 MVP 대본 0 | B | 3단계 | `S → S` |

#### 3.4.14 M13 데스크톱 앱

데스크톱 앱은 네 부분으로 나눈다. UI 시스템(M13a)은 고정 데이터와 VM 타입만 쓰므로 일찍 시작한다. 앱 기반(M13b)은 M10 위에, 화면(M13c)은 M12와 M13a·M13b 위에 만든다. OS 통합과 빌드(M13d)는 마지막이다.

- 공통 완료 조건: `just verify`(`app-check`, `ui-check`, `ui-test` 포함), 앱 화면을 바꾼 작업은 `just app-e2e`와 `just shot` 비교(20 §6 머리말, 사용자 규칙).
- 규모: XL(TS 1만5천~2만 줄, Rust 2천~3천 줄).

##### M13a UI 시스템(`@helm/ui-tokens`, `@helm/ui`, `apps/desktop/src/ui`)

- 선행: M0, M10-06(문구 키). VM 타입은 M10-02의 뷰 스키마를 다시 내보낸다. HT-15(Caustic 복사 확인), HT-07의 macOS 판(최소 판 결정).
- 완료 기준: 21 §6.6의 U1~U9와 "전체".

| 작업 ID | 내용 | 산출 파일 | 근거 | 선행 | 완료 조건 | 등급 | 담당 | 모델 |
|---|---|---|---|---|---|---|---|---|
| M13a-01 | U1 토큰: Caustic 값 복사·Helm 원본, neutral 11단계, 생성 스크립트(CSS 변수, Tailwind `@theme`, DTCG JSON, 대비 보고), 대비 관문, NOTICE. Storybook 설정, 글꼴, 정적 검사(`ui-check`) | `packages/ui-tokens/**`, `packages/ui/.storybook/*`, `packages/ui/src/{assets,styles}/*`, `.just/helm.just`(`ui-tokens`, `ui-check`, `ui-storybook`) | 21 §3.2, §6.4, U1, 결정 43 | M0, HT-15 | 21 §6.6 U1. 생성물이 원본에서 다시 만든 것과 같다 | C | 3단계 | `S → O` |
| M13a-02 | U2 L0 부품(`Surface` 유리 재질 포함), `ActionButton` 상태 기계, 키·IME 도우미. SP-09(유리 성능) 측정 시작. 루트 `justfile`에서 `setup`을 덮어써 Playwright 브라우저(Chromium, WebKit)도 설치한다(22 §5.2 06 (4)) | `packages/ui/src/{primitives,lib}/*`, `justfile` | 21 §3.7.1, §3.6.4, §3.12 | M13a-01, HT-24 | 21 §6.6 U2. `ui-test`를 `_verify-steps`에 더한다. 브라우저가 없으면 종료 코드 2 | B | 3단계 | `S → S` |
| M13a-03 | U3 L1 Helm 의미 부품과 `model` 공통 타입(뷰 `data` 타입은 04가 정하고 `@helm/protocol`이 내보낸 것을 다시 내보낸다. UI 전용 타입만 여기서 정한다) | `packages/ui/src/{helm,model}/*` | 21 §3.7.2 | M13a-02 | 21 §6.6 U3. 알 수 없는 값에서 멈추지 않는다 | B | 3단계 | `S → S` |
| M13a-04 | U4 C/A 부품: `QuestionCard`, `QuestionInbox`, `WorkAgreementDraft/Echo`, `ResultReviewPanel`, `AutonomousChoiceList`, `ContestButton`, `ChoiceImpactEcho`, `SemanticPreview` | `packages/ui/src/composites/{question,agreement,review,autonomous,input}/*` | 21 §3.7.3, §3.9 | M13a-03 | 21 §6.6 U4. 금지 패턴 테스트(21 §6.3) | B | 3단계 | `S → S` |
| M13a-05 | U5 복귀·셸: `SinceLastVisit`, `ActiveWorkCard`, `ConcernTree`, 셸 부품(유리 크롬), 창 효과 연결, 신선도·연결·대기 질문 표시, `GoalSummary`, `DegradedBanner`, `AgentActivityIndicator`, `ToolActivityLine`, `MaterialChangeGroups` | `packages/ui/src/composites/{brief,concern,work,status}/*`, `packages/ui/src/helm/AgentActivityIndicator/*`, `apps/desktop/src/ui/shell/*` | 21 §3.3, §3.7.3, U5 | M13a-04 | 21 §6.6 U5. SP-09 서버 측정으로 잠정 기본 투명도를 두고, 실제 웹뷰 측정(M13b-02 뒤) 결과로 확정한다 | D | 2단계 | `O 직접` |
| M13a-06 | U6 근거: `EvidenceChainTree`(`buildTree`), `EvidenceInspector`, `CertaintyDescriptor`, `SourceTrace` | `packages/ui/src/viz/EvidenceChainTree/*`, `src/composites/evidence/*` | 21 §3.8, U6 | M13a-03 | 21 §6.6 U6(2,000노드 성능 포함) | B | 3단계 | `S → S` |
| M13a-07 | U7 원함 탐구: `StimulusBoard`, `PreferenceModelPanel`, `ContrastCard`, `GoalHistory` | `packages/ui/src/viz/{StimulusBoard,PreferenceModelPanel,GoalHistory}/*`, `src/viz/inquiry/ContrastCard/*` | 21 §3.8, U7, 판정 J-34 | M13a-03 | 21 §6.6 U7 | B | 3단계 | `S → S` |
| M13a-08 | U8 나머지: 탐구 보드, `LoopTimeline`, `LoopPlanStrip`, `LoopPathMini`, `DialPanel`, `RecoveryList`, `ObserverProposalCard`, `MetricTile`, `AttentionBudgetMeter`. 2단계 화면 요소(`DivergenceTable` 전체, `PredictionList` 등)도 부품은 만들고 화면에서 플래그로 숨긴다 | `packages/ui/src/{viz,composites/rules,composites/work}/*` | 21 §3.8, U8 | M13a-03 | 21 §6.6 U8 | B | 3단계 | `S → S` |
| M13a-09 | U9 대화: `ConversationThread`(assistant-ui 어댑터). 시각 기준 이미지 관리(Git 밖 `~/projects/helm/design/visual-baselines/` + Git 안 sha256 잠금 파일) | `packages/ui/src/conversation/*`, `scripts/visual-baselines.ts` | 21 §3.10, U9, 22 §3.12.2, D22-11, U22-12 | M13a-03 | 21 §6.6 U9. U22-12. 기준 이미지 첫 생성(`ui-visual-update`, 사람 검토) | B | 3단계 | `S → S` |

##### M13b 앱 기반·전송·동기화

- 선행: M10(클라이언트 코어, 가짜 데몬). Rust 작업은 HT-06·HT-07. SP-07(SSH 전송)과 SP-08(Windows 교차 빌드)은 M13b-02와 함께 한다.
- 완료 기준: 20 §6.1의 해당 행, IT-01~16 중 해당 시나리오(20 §3.13.3).

| 작업 ID | 내용 | 산출 파일 | 근거 | 선행 | 완료 조건 | 등급 | 담당 | 모델 |
|---|---|---|---|---|---|---|---|---|
| M13b-01 | `@helm/client-react`: `useView`, `useCommand`, TanStack Query 연결, IndexedDB 상태 저장(뷰 캐시, 위치, 진행 중 명령함, 초안), 사용자용 연결 상태와 `decisionsAllowed`, 딥 링크 해석, 알림 규칙 순수 함수, presence 판정, `PlatformAdapter` 인터페이스 | `packages/client-react/src/*` | 20 §3.8.9, §3.9.5~§3.9.7, §3.10.1, §3.14 | M10-05 | 20 §6.1 `@helm/client-react`, "알림 규칙" 행(jsdom, 가짜 시계) | B | 3단계 | `S → S` |
| M13b-02 | Tauri 앱 골격과 SP-08: `apps/desktop`(React 19, Vite, Tauri v2), `src-tauri`(capability, CSP), Tauri 비의존 크레이트 `helm-desktop-core`, `rust-toolchain.toml`, `CARGO_TARGET_DIR`. 빈 창을 Mac(`app-dev-mac`)과 Windows 교차 빌드(`app-build-win`)로 띄워 본다. 레시피 `app-setup`, `app-check`, `app-dev`, `app-dev-mac`, `app-build-win` | `apps/desktop/{package.json,vite.config.ts,index.html,src/main.tsx}`, `apps/desktop/src-tauri/**`, `apps/desktop/src-tauri/core/**`, `.just/helm.just` | 20 §3.2~§3.3, §3.12.1~§3.12.4, 결정 41 | M13b-01, HT-06, HT-07, HT-14 | 20 §6.1 "capability·CSP". 빈 앱이 Mac에서 뜨고 Windows NSIS 설치 파일이 만들어진다(SP-08 기록) | D | 2단계 | `O 직접` |
| M13b-03 | Rust 전송(WSS), 키체인, 프로필 저장·검증, 페어링(코드와 SSH 발급) | `src-tauri/src/{transport/*,secrets.rs,profiles.rs,pairing.rs}`, `core/src/{ws,profile}.rs` | 20 §3.4~§3.8, 18 §5.2 "20", APP-D02 | M13b-02 | 20 §6.1 "프로필 저장·검증", "키체인", "WebSocket-over-stream", "전송 관리자", "페어링" | C | 3단계 | `S → O` |
| M13b-04 | 동기화·캐시·명령·초안: 세션, 뷰 읽기(오프라인 캐시), 명령 의도(`basisSeq`, 멱등 키), 초안(자동 전송 없음, J-02). 가짜 데몬(`FakeDaemon`)과 뷰 표본으로 시험한다 | `apps/desktop/src/{sync,db,intents}/*` | 20 §3.9, 04 §6 "명령 의도 공통", 판정 J-02 | M13b-01, M13b-03 | 20 §6.1 "코어 연결", "뷰 읽기", "명령", "초안". IT-01~07 | C | 3단계 | `S → O` |
| M13b-05 | SSH 경로와 SP-07: `ssh -W 127.0.0.1:7841` 자식 프로세스, 인자·실패 분류, 호스트 키 정책, `MultiRouteTransport`. `app-test-ssh` | `core/src/ssh.rs`, `src-tauri/src/transport/ssh.rs`, `src/connection/multi-route.ts` | 20 §3.8.3, §3.8.8, 19 Q-01, 결정 38 | M13b-03 | 20 §6.1 "SSH 인자·실패 분류", "SSH 경로 통합". WSL sshd와 가짜 데몬으로 확인. 실제 `server` 연결은 M13b-09 | D | 2단계 | `O 직접` |
| M13b-06 | 연결 계층과 깨어남·포커스 확인, `ConnectionUiState`(안전 모드 포함) | `apps/desktop/src/connection/*` | 20 §3.8.8~§3.8.9 | M13b-05 | 20 §6.1 "연결 계층", "깨어남·포커스 확인" | B | 3단계 | `S → S` |
| M13b-07 | 큰 파일: `helm-blob` 스킴, blob 캐시 검증, 청크 업로드 | `src-tauri/src/blob.rs`, `core/src/blob_cache.rs` | 20 §3.8.6, 19 §3.11 | M13b-03 | 20 §6.1 "blob" | B | 3단계 | `S → S` |
| M13b-08 | 라우터(03 경로 표), 딥 링크, 오류 경계, 시작 시간 | `apps/desktop/src/{navigation,errors,app}/*` | 03 §3.5, §6, 20 §3.9.2, §3.10.6 | M13b-04 | 03 §6 "화면 ID·경로 표", "딥 링크 처리". 20 §6.1 "라우터", "딥 링크", "오류 경계", "시작 시간"(2초 이하, Mac·Windows 측정) | B | 3단계 | `S → S` |
| M13b-09 | 실제 데몬 연결: 개발 데몬의 `loopback` 리스너에 페어링한 기기로 붙는 `app-dev` 경로, 실제 데몬 페어링(코드와 SSH 발급), Windows에서 실제 `server`로 SSH 경로 | `apps/desktop/vite.config.ts`(개발 프록시), `.just/helm.just` | 20 §3.12.2, 18 §3.7 | M13b-04, M13b-05, M11-04, M11-10, HT-08, HT-17 | `app-dev`로 홈이 개발 데몬 값을 그린다. Mac·Windows에서 SSH 경로로 한 번씩 연결(SP-07 기록) | D | 2단계 | `O 직접` |

##### M13c 화면

- 선행: M12(뷰), M13a(부품), M13b(앱 기반). 화면마다 `app-e2e` 흐름과 `shot` 기준을 둔다.
- 완료 기준: 04 §6의 화면별 행, 03 §6의 셸 행, 05 §6의 화면 관련 행.
- 순서: C/A 화면 → 복귀·홈 → 근거·Goal → 탐구 → 연결·복구·설정 → 대화 → 평가.

| 작업 ID | 내용 | 산출 파일 | 근거 | 선행 | 완료 조건 | 등급 | 담당 | 모델 |
|---|---|---|---|---|---|---|---|---|
| M13c-01 | 셸과 최상위 내비게이션(일곱 항목, 복구 항목은 0이면 숨김), 영역 배치(1280·1100·900px), 공통 상태 표시(로딩·캐시·빈·오류·연결 9종) | `apps/desktop/src/shell/*`, `src/screens/common/*` | 03 §3.4·§3.5, 04 §3.0 | M13a-05, M13b-08 | 03 §6 "최상위 내비게이션", "셸 영역". 04 §6 "공통 상태 표시" | B | 3단계 | `S → S` |
| M13c-02 | C/A 화면: `SCR-QUESTION`, `SCR-INBOX`, `SCR-AGREE`, `SCR-REVIEW`, `SCR-AUTO`, `OVL-CONTEST`. 분할: 화면 하나씩 | `src/screens/{question,inbox,agreement,review,autonomous}/*`, `src/overlays/contest/*` | 04 §3.3~§3.5, §3.11~§3.12, §3.26, 05 §3.1~§3.3 | M13c-01, M12-02, M12-04, M12-05 | 04 §6 해당 행. 05 §6 "질문 응답", "이의 걸기" | B | 3단계 | `S → S` |
| M13c-03 | 복귀·홈·Concern: `SCR-HOME`, `SCR-BRIEF`, `SCR-CONCERNS`, `SCR-CONCERN-OVERVIEW`, `SCR-WORK`(MVP), `SCR-LOOPS` | `src/screens/{home,brief,concerns,concern-overview,work,loops}/*` | 04 §3.1~§3.2, §3.6~§3.7, §3.10, §3.13 | M13c-01, M12-03, M12-04 | 04 §6 `SCR-HOME`, `SCR-BRIEF` 행 | B | 3단계 | `S → S` |
| M13c-04 | 근거·Goal·기록: `SCR-EVIDENCE`, `SCR-GOALS`, `SCR-GOAL`, `SCR-RECORD` | `src/screens/{evidence,goals,goal,record}/*` | 04 §3.15~§3.16, §3.23 | M13c-01, M12-05 | 04 §6 `SCR-EVIDENCE` 행 | B | 3단계 | `S → S` |
| M13c-05 | 탐구: `SCR-INQUIRY`(사실·원함), `SCR-STIM` | `src/screens/{inquiry,stimuli}/*` | 04 §3.8~§3.9, 05 §3.2 | M13c-01, M12-06 | 04 §6 `SCR-STIM` 행. 05 §6 "자극 반응" | B | 3단계 | `S → S` |
| M13c-06 | 연결·복구·설정·온보딩·다이얼·팔레트·단축키: `SCR-CONNECT`, `SCR-RECOVERY`, `SCR-SETTINGS`, `SCR-ONBOARD`, `SCR-DIALS`, `OVL-PALETTE`, `OVL-SHORTCUTS` | `src/screens/{connect,recovery,settings,onboard,dials}/*`, `src/overlays/{palette,shortcuts}/*` | 04 §3.17, §3.19~§3.22, §3.25, 05 §3.8 | M13c-01, M12-07 | 04 §6 `SCR-DIALS`, `SCR-CONNECT`, `SCR-RECOVERY` 행 | B | 3단계 | `S → S` |
| M13c-07 | 대화와 입력: `SCR-THREAD`, 범위 입력창, 의미 미리보기 | `src/screens/thread/*`, `src/composer/*` | 04 §3.14, 05 §3.4 | M13a-04(`SemanticPreview`), M13a-09, M12-08 | 05 §6 "의미 미리보기" | B | 3단계 | `S → S` |
| M13c-08 | 평가: `SCR-METRICS`(결정적 지표, 2주 평가 카드, 복귀 점검 진입) | `src/screens/metrics/*` | 04 §3.27, 16 §3.24.2 | M14-08 | 21 `MetricTile` 계약대로 값·표본·창·정의 버전·추세. 앱이 지표를 계산하지 않는다 | B | 3단계 | `S → S` |

##### M13d OS 통합·빌드·배포

| 작업 ID | 내용 | 산출 파일 | 근거 | 선행 | 완료 조건 | 등급 | 담당 | 모델 |
|---|---|---|---|---|---|---|---|---|
| M13d-01 | OS 알림(기본 내용 숨김, J-03), 트레이·배지, 전역 단축키, 로그인 시 시작, 설정 키 | `apps/desktop/src/platform/tauri/*`, `src-tauri/src/os/*` | 20 §3.10, 05 §3.7·§3.8, 판정 J-03 | M13c-02, M13c-03 | 20 §6.1 "알림", "트레이·배지", "설정". IT-12. 05 §6 "알림", "단축키" | C | 3단계 | `S → O` |
| M13d-02 | macOS 빌드·설치·스모크와 SP-11: `app-build-mac`, `app-build-local`, `app-install-mac`, `app-verify-mac`, `shot-mac`. 자체 서명 | `.just/helm.just`, `apps/desktop/INSTALL.md` | 20 §3.12.2~§3.12.3, §3.12.5, 21 §6.4 | M13d-01, HT-07 | 20 §6.1 "빌드"(Mac). 20 §6.2 수동 체크리스트 1~10을 Mac에서 수행하고 결과 기록(Q-08 키체인 확인 창 포함) | D | 2단계 | `O 직접` |
| M13d-03 | Windows 빌드: `app-build-win`(교차), `.github/workflows/desktop-windows.yml`과 `app-build-win-ci`(사람 확인 뒤 실행) | `.github/workflows/desktop-windows.yml`, `.just/helm.just` | 20 §3.12.4, ADR-20-06, D23-7 | M13d-01, HT-06, HT-22 | 20 §6.1 "빌드"(Windows: 관리자 권한 없이 설치·실행, 수동). 20 §6.2 체크리스트를 Windows에서 | D | 2단계 | `O 직접` |
| M13d-04 | 셸 스모크(WebdriverIO `@wdio/tauri-service`), 서드파티 고지(Rust 크레이트 포함), "정보" 절 | `apps/desktop/e2e/shell/*`, Rust 고지 생성 | 20 §3.12.8, §3.13.4, 07 §5.2 "20" | M13d-02 | 20 §6.1 "셸 스모크", "서드파티 고지" | B | 3단계 | `S → S` |

#### 3.4.15 M14 관찰 에이전트 결정적 부분과 지표

- 목표: 관찰 에이전트의 결정적 부분(외부 세션 로그 수집, 정규화, 마스킹, 지표, 반복 패턴 탐지, 2주 평가 보고)을 MVP에서 켠다. G1 판단의 기준선(채팅 기준선, CA-1의 외부 원천)이 여기서 나온다(판정 J-07, 16 §5.2 "01").
- 선행: M2(읽기 전용 리더), M11-08(감독기). 어댑터·정규화·마스킹·지표의 순수 부분(M14-02~M14-04)은 M2 뒤에 바로 시작할 수 있다.
- 완료 기준: 16 §6.2의 OB-T01~T04, OB-T06~T15, OB-T20~T31. 모델 판정·제안·효과(OB-T05, OB-T16~T19)는 M16-09.
- 규모: L.

| 작업 ID | 내용 | 산출 파일 | 근거 | 선행 | 완료 조건 | 등급 | 담당 | 모델 |
|---|---|---|---|---|---|---|---|---|
| M14-01 | 관찰 프로세스 골격: 진입점(`job.start` → 실행 → `job.finished`), 설정, IPC 클라이언트, 작업 파이프라인, 관찰 캐시 DB | `packages/observer/src/{main,config}.ts`, `src/ipc/{types,client,transport}.ts`, `src/run/job.ts`, `src/cache/*`(`@helm/store/aux`로 연다) | 16 §3.2, §3.20 | M2-11 | OB-T01, OB-T03, OB-T28(두 전송) | B | 3단계 | `S → S` |
| M14-02 | 외부 세션 어댑터: 공통 증분 읽기, Helm·pi·Claude Code 어댑터, Codex는 인터페이스와 이름표만(16 OQ-16-09), 허용 폴더 = 프로젝트 `rootPaths`(J-08) | `src/sources/{types,registry,incremental,helm,pi,claude-code,codex}.ts`, `test/fixtures/**`(합성 문장만) | 16 §3.5~§3.6, 판정 J-08 | M14-01 | OB-T06~T09, OB-T27 | B | 3단계 | `S → S` |
| M14-03 | 정규화(도구·명령·경로·트리)와 마스킹(M1-09 규칙 + 엔트로피), 주입 표시 | `src/normalize/*`, `src/mask/*` | 16 §3.7~§3.9 | M14-02 | OB-T10, OB-T12 | C | 3단계 | `S → O` |
| M14-04 | 지표(순수 하위 경로 `@helm/observer/metrics`): 사실 추출, `MetricDef` 등록, 집계, 스냅숏, 복귀 에피소드. CA-1~7, CT-1~3, `q.*`, `ad.*`, `opdc.*`, `a12.*` | `src/metrics/*` | 16 §3.23, 01 §3.5.3, §3.6.7 | M1 | OB-T21~T23. 01 §6 "C/A·범주 지표 리포트"(고정 fixture에서 기대값) | B | 3단계 | `S → S` |
| M14-05 | 투영기 연결: 커밋 뒤 `extractFacts`, `metric_fact`·`metric_snapshot` 투영(09 요구), 작업 에이전트 투영에서 지표 제외 | `packages/daemon/src/consumers/metrics.ts`(커밋 뒤 소비자, `consumer_cursors.metrics`) | 16 §5.2 "12"(1)(6), "09"(1) | M14-04, M7-03 | OB-T25, OB-T26, OB-T31 | B | 3단계 | `S → S` |
| M14-06 | 탐지기 D1~D13(결정적), 서명·패밀리·문턱, 자기 재귀 제외 | `src/detect/*`, `src/cluster/*` | 16 §3.10~§3.11 | M14-03 | OB-T14, OB-T15, OB-T20, OB-T30(서명) | B | 3단계 | `S → S` |
| M14-07 | 디지스트와 2주 평가 보고(결정적 부분), 복귀 점검 저장소(`private/resumption-checks/`, 관찰 자식에게 숨김. 빈도는 복귀당 1회, 주 2회까지), 자기보고 문항(HD-5) | `src/digest/build.ts`, `src/evaluate/{report,hypotheses,incidents}.ts` | 16 §3.18, §3.25~§3.27 | M14-04 | OB-T24. 가짜 시계로 T6(14일, 09:00) 실행 시 보고가 만들어진다 | B | 3단계 | `S → S` |
| M14-08 | `metrics`·`evaluation` 뷰와 측정 명령(`surprise.report`, `resumptionCheck.answer`, `resumptionCheck.score`(판정 J-78), `selfReport.submit`), 데몬 감독기에 실제 관찰 프로세스 연결 | `packages/runtime/src/projection/metrics.ts`, `src/projection/views/evaluation.ts`, 19 등록 표 항목 | 16 §5.2 "19", 19 §3.7.1 | M14-05, M14-07, M11-08 | OB-T29(`presence.report`에서 `view.opened`). 뷰 예시 스키마 통과. 감독기 통합 시험(OB-T02·T04를 실제 관찰 프로세스로 다시) | B | 3단계 | `S → S` |

#### 3.4.16 M15 MVP 통합·출시

- 목표: 01 §3.8.3의 MVP 완료 기준 다섯 개를 채우고 G1 창을 연다.
- 선행: M0~M14, G0 기록(HT-16).
- 완료 기준: 01 §3.8.3 1~5. 확인 방법은 22 §3.17.3(`just test-all`, 끝난 WBS 행 집합 기준 MVP 항목 누락 0과 격리 목록 0, 22/RE-01, 22/FI-01·FI-03·FI-22(a), 17 T17-30, `daemon-systest`의 S1 묶음, 22/FI-21 복원 훈련 1회). 스파이크가 대체 경로로 간 경우의 판정은 §3.7.1의 "MVP 판정 영향" 열을 따른다. 이 마일스톤 끝이 "MVP 완료"다.
- 규모: L(대부분 테스트와 운영 작업).

| 작업 ID | 내용 | 산출 파일 | 근거 | 선행 | 완료 조건 | 등급 | 담당 | 모델 |
|---|---|---|---|---|---|---|---|---|
| M15-01 | MVP 유즈케이스 대본 전체(22 §3.8.4 표: UC-01~07, 09~13, 15, 17 기기 전환)의 기본·대안·예외 흐름. `protocol` 모드 대본은 M11-05에서 만든 것에 UC-11과 대안·예외 흐름을 더한다. 2단계·3단계 흐름은 `stage`를 붙여 플래그가 켜질 때만 돈다 | `tests/scenarios/*.scenario.ts` | 02 §6, 22 §3.8.4~§3.8.5, U22-8 | M8-12, M9b-03, M11-05, M12-10 | U22-8. `just test-trace --report`에서 끝난 WBS 행(`done.ts`)의 MVP 항목 누락 0, 격리 목록 0 | B | 3단계 | `S → S` |
| M15-02 | 장애 주입: 같은 프로세스 장애(verify), 자식 프로세스 데몬을 종료 지점에서 SIGKILL(`just test-faults`), 무작위 kill 100회(T-CR-09), 연결 끊기, 느린 소비자, 앱 강제 종료 뒤 초안. 17의 종료 지점(`HELM_TEST_KILLPOINT`) 포함 | `tests/faults/*.{fault,kill}.test.ts` | 22 §3.9, U22-6·U22-10, 12 T-CR-09, 01 §6 "데이터 손실" | M15-01 | 22/FI-01~20, FI-22(a)~24(레시피별). CR-1~CR-4 위반 0. NFR-D-1, NFR-D-4 | C | 3단계 | `S → O` |
| M15-03 | E2E: 웹 E2E(가짜 데몬, 22/E2E-*)와 실제 데몬 E2E(`just e2e-real`, 22/RE-01): UC-04(Tailscale·SSH 두 경로), UC-10 변형 A, UC-11(설치·페어링). macOS와 Windows 각 1회 이상 | `apps/desktop/e2e/*`, `tests/e2e-real/*`, `tests/trace/manual.json` | 02 §6 "E2E", 01 §3.8.3 3, 22 §3.12.6 | M13d-03, HT-08, HT-09, HT-17 | 두 경로의 메시지 열이 같다(19 §6.3, 결정 38). 22/RE-01 수동 기록 | D | 2단계 | `O 직접` |
| M15-04 | 성능 확인: `just perf`(22/PF-01~15, NFR-P-1·2·4), 복귀 요약 결정적 부분 1초(NFR-P-5), 앱 시작 2초(NFR-P-3) | `tests/perf/*`, 측정 결과 JSON | 01 §3.11.1, 19 §6.4, 22 §3.13, U22-13 | M11-13, M13b-08 | 모두 목표 안. 넘으면 행을 끝내지 않고 1단계가 판정한다(§3.1.3-14) | B | 3단계 | `S → S` |
| M15-05 | 운영 리허설: 운영 데몬 `daemon-upgrade`·`daemon-rollback`, `daemon-backup`·`daemon-restore`·`daemon-drill`, `wsl --shutdown` 뒤 재기동(T17-30) | 수동 기록 | 17 §3.9~§3.10, 17 §5.2 "23"(백업·복원은 첫 실제 사용 전 필수) | M11-12 | 확인된 이벤트가 사라지지 않는다(01 §3.8.3 4). 복원 뒤 클라이언트가 스냅숏 경로로 붙는다(T17-21) | D | 2단계 | `O 직접` |
| M15-06 | 홈랩 연동 확인: H-1 serve 경로, H-2·H-3 restic 포함·제외. H-2 전에는 `/mnt/d/backup/helm/` 복사 레시피로 대신하고 같은 NVMe라는 한계를 기록한다(판정 J-146) | 수동 기록 | 17 §3.7.4 | HT-09, HT-10 | `daemon-probe` 통과, `backup_offsite` ok(또는 J-146 대체 복사와 doctor 경고) | D | 2단계 | `O 직접` |
| M15-07 | G0 반영 확인: G0 판정이 "3개 이상"이면 그대로, "2개"면 과제 세 개 추가, "1개 이하"면 발산 프롬프트·방향·대비 압축을 고친 뒤 G0을 다시 한다(M9a 재작업) | `/srv/volumes/helm/eval/**`, 필요하면 `src/inquiry/prompts/*` | 15 §3.15.2, D23-4 | HT-16 | G0 판정 기록이 있고 판정에 맞는 처리를 했다 | D | 2단계 | `O 직접` |
| M15-08 | 실사용 시작 준비: "Helm 사용 평가" Concern 생성(관문 기록 자리, §3.5.3), 복귀 점검 켜기(02 UQ-05), 관찰 결정적 부분 켜기, 비용 상한 확인, 기기 두 대 페어링, 기능 플래그가 MVP 묶음인지 `helm status`로 확인. H-5 처리 확인 | 운영 설정(dotfiles의 `helmd.toml`), 관문 기록 Concern | 01 §3.8.4, 16 §3.27.3·§3.27.6, 02 UQ-05 | M15-05, M15-06, M15-07, HT-11 | `helm status`에 2단계 키가 하나도 켜져 있지 않다. 평가 Concern이 있다 | D | 2단계 | `O 직접` |
| M15-09 | MVP 실사용 기록(HT-18): 실제 모델로 UC-01·UC-02·UC-07을 끝까지, 두 기기·두 경로 질문 답, 강제 종료 뒤 재개 | 이벤트 로그 | 01 §3.8.3 2~4 | M15-08 | 01 §3.8.3 1~5 모두 충족 → MVP 완료. G1 창 0일째 | D | 2단계 | `O 직접` |

#### 3.4.17 M16 2단계 기능(기본 꺼짐)

- 목표: 01 §3.8.2의 2단계 기능을 구현하고 기본 꺼짐으로 운영 데몬에 넣는다. 켜는 일은 A2(G1 기록 뒤)다.
- 선행: M15. 코드 의존은 대부분 M8·M9·M14다. G1 창과 겹쳐 진행하되 MVP 결함 수정이 이 마일스톤보다 먼저다(§3.5.3).
- 공통 완료 조건: 기능을 끈 상태에서 MVP 유즈케이스 대본(M15-01)이 그대로 통과한다. 기능을 켠 상태의 테스트가 통과한다. 꺼진 기능은 계획·도구 목록·화면에 나타나지 않는다(06 §3.10.3 규칙 (3), 03 §3.6).
- 규모: XL.

| 작업 ID | 내용 | 산출 파일 | 근거 | 선행 | 완료 조건 | 등급 | 담당 | 모델 |
|---|---|---|---|---|---|---|---|---|
| M16-01 | 가능성 탐구와 Method Transfer 렌즈: 렌즈 라이브러리·선택·전이·통계, 렌즈 seed와 `just lens-seed`, `scripts/build-lens-seed.ts`. 루프 `I.possibility`, 모드 `deliberate`(14) | `packages/runtime/src/inquiry/{plan/possibility,lens}/*`, `lens/seed/*`, `scripts/build-lens-seed.ts` | 15 §3.8~§3.9, 14 §3.15, 02 UC-14 | M15 | T-16, T-17, T-18, T-25. `SCR-INQUIRY` 가능성 종류, `DivergenceTable` | C | 3단계 | `S → O` |
| M16-02 | 결과 탐구: 사전 부검, 예측, 결합 후보, 정지, 예측 확인 타이머. 루프 `I.outcome` | `src/inquiry/{plan/outcome,outcome}/*`, `packages/runtime/src/scheduler/prediction.ts` | 15 §3.10, 12 §3.10 | M16-01 | T-19. 결과 예측 화면 | C | 3단계 | `S → O` |
| M16-03 | 발산 전체: 다섯 방향, 가지별 다른 모델, 적대적 검토, 개인 이력. 플래그 `inquiry.divergenceFull` | `src/inquiry/divergence/*` | 15 §3.4, 01 §3.8.2 | M16-01 | T-02~T-04의 2단계 행. 같은 모델 계열 표시 | C | 3단계 | `S → O` |
| M16-04 | 탐침형 C와 지속 관찰형 A: 계약, Watch 레코드, 연장 2회, 판정 대응. 루프 `C.probe`, `A.watch` | `packages/kernel/src/orchestration/contracts/catalog/{c-probe,a-watch}.ts`, `packages/runtime/src/orchestration/watch.ts` | 14 §3.6, §3.15, 08 §3.16.2 | M15 | 14 C-4·C-22의 2단계 묶음 계획. `SCR-WORK` 탐침 카드 | C | 3단계 | `S → O` |
| M16-05 | 독립 검증 에이전트: 새 컨텍스트 검증 run, 모드 `verify`, 결과 확인 화면 표시. 플래그 `verify.independentAgent` | `packages/runtime/src/run/verifier.ts` | 12 §3.14, 14 §3.10, 04 SC-Q5 | M15 | T-SA-02(검증 run이 작업 thread를 보지 않음). 결과 확인을 기다리지 않고 할 수 있다 | B | 3단계 | `S → S` |
| M16-06 | 중재 전달: 중재자 run, `delivery.plan`, `mediator_timeout`. 플래그 `asking.mediator` | `packages/runtime/src/asking/mediator.ts` | 11 §3.7, 12 §3.14.3 | M15 | 11 §6.2 "중재자"를 런타임까지 포함해 재현 | C | 3단계 | `S → O` |
| M16-07 | 기대 레코드와 "응답 없음" 관찰, 기대 카드. 플래그 `expectation.records`. UC-16 | `packages/runtime/src/scheduler/expectation.ts`, 화면 `SCR-WORK` 기대 카드 | 08 §3.14, 11 U-08(72시간), 02 UC-16 | M15 | UC-16 대본 통과 | B | 3단계 | `S → S` |
| M16-08 | 다이얼 전체 노출(14개). 플래그 `dials.fullExposure` | `packages/kernel/src/orchestration/dials/*`, `SCR-DIALS` | 14 §3.11.1 | M15 | 14 C-10. 뷰에 다이얼이 더해지면 앱 수정 없이 보인다(04 §6 `SCR-DIALS`) | A | 3단계 | `H → S` |
| M16-09 | 관찰 에이전트 모델 판정·제안·효과 측정: 분류 프롬프트·입출력, 제안 조립·린트·추정·중복 제거·제출, 효과 측정, `observerProposals` 뷰, `SCR-OBSERVER`, UC-08. 이의 패턴으로 묻기 정책 조정 제안(11 §3.9.4)도 이 경로로. 플래그 `observer.modelJudgement` | `packages/observer/src/{classify,propose,effect}/*`, `apps/desktop/src/screens/observer/*` | 16 §3.12~§3.17, 판정 J-07, 02 UC-08 | M15 | OB-T05, OB-T13, OB-T16~T19. UC-08 대본. 외부 발췌 전송은 HD-4가 "보냄"일 때만 | C | 3단계 | `S → O` |
| M16-10 | 범위를 줄여 진행·되돌릴 지점 전체(01 ◐ → ●). 플래그 `asking.rollbackPoints` | `packages/kernel/src/asking/*`, `packages/tools/src/rollback/*` | 11 §3.11~§3.12, 01 §3.8.2 | M15 | 11 §6.2 "범위 줄이기", "가정 아래 행동"의 전체 판본 | B | 3단계 | `S → S` |
| M16-11 | REPL 방식 탐구(◐)와 SP-12: pi-codemode 샌드박스, `runNestedToolCall` 브리지, 작업 공간, 하위 호출. 플래그 `inquiry.repl` | `packages/tools/src/repl/sandbox.ts`, `packages/runtime/src/ports/repl.ts`, `src/inquiry/repl/*` | 07 V9, 13 U-TL-11, 15 §3.12, T-20 | M15 | 07 V9. T-RP-01~04. 15 T-20 | D | 2단계 | `O 직접` |
| M16-12 | 하위 호출 일반화(01 ◐ → ●): 개수·비용 상한 다이얼, 서로 결과를 보지 않는 병렬 호출. 플래그 `runtime.subcallGeneral` | `packages/runtime/src/run/subagents.ts` | 01 §3.8.2, 12 §3.14 | M15 | T-SA-01~05의 일반 호출 판본 | B | 3단계 | `S → S` |
| M16-13 | 2단계 화면 요소: `SCR-INQUIRY` 가능성·결과 종류, `SCR-WORK` 기대 카드, 중재 전달 표시, 검증 에이전트 표시, `SCR-METRICS` 관찰 에이전트 절. 플래그에 따라 그리지 않음 | `apps/desktop/src/screens/*` | 03 §3.6(2단계), 04 | M16-01~M16-09 | 플래그를 끈 `shot`이 M15 기준과 같다. 켠 `shot` 기준을 새로 만든다 | B | 3단계 | `S → S` |

#### 3.4.18 M17 모바일 클라이언트(기본 꺼짐)

- 목표: 휴대폰에서 질문에 답하기[결정 42]. 방식은 데몬이 `tailnet` 리스너의 `/m/` 경로로 서빙하는 홈 화면 웹 앱(PWA)이고 알림은 Web Push(VAPID)다[결정 47]. 휴대폰 알림은 강도 `interrupt`와 `notice` 질문까지 보낸다[결정 48]. 최소 판은 iOS 26이고 Android는 지원·시험 대상이 아니다[결정 49]. 기기 토큰은 `__Host-helm_dt` HttpOnly 쿠키다(26 MOB-D03, 판정 J-118). 빌드는 서버에서 하고 PWA 묶음은 데몬 릴리스에 함께 들어간다(26 MOB-D10). Mac이 필요 없다.
- 선행: M15. 코드 의존: M11-04(인증), M8-10(전달기), M13b-01(`@helm/client-react`), M13a(`@helm/ui`, `@helm/ui-tokens`), M10-06(`@helm/ui-language`). 사람 작업: HT-21(iPhone 준비), HT-25(VAPID 키).
- 플래그: `clients.mobile`이 상위 스위치다. 꺼져 있으면 모바일 기기 페어링, `/m/` 서빙, 푸시 송신을 하지 않는다. 26의 `push.enabled`는 `clients.mobile`이 켜졌을 때만 뜻이 있다(§5.2 26 요구).
- 실기기 확인(M17-04)은 운영 데몬에서 한다(26 MQ-12: 개발 데몬용 serve 포트를 두지 않음). 운영 데몬에서 모바일을 켜는 것은 2단계 활성화이므로 M17-04는 A2 때 한다. 그 전에는 Playwright WebKit 시험(`mobile-e2e`)까지만 한다.
- 완료 기준: 26 §6.1 T26-01~T26-27, 26 §6.2 M-01~M-12, 18 T18-31, 22 §3.12.7.
- 규모: L.

| 작업 ID | 내용 | 산출 파일 | 근거 | 선행 | 완료 조건 | 등급 | 담당 | 모델 |
|---|---|---|---|---|---|---|---|---|
| M17-01 | 데몬 쪽 정적 서빙(`/m/`은 `tailnet`에서만, 보안 헤더, 캐시 정책)과 쿠키 인증(`/m/pair`, `/m/whoami`, `/m/logout`, Origin 검사, `credentialCarrier`), 릴리스에 `web/mobile/` 포함 | `packages/daemon/src/http/{mobile-static,mobile-auth}.ts`, `ops/bin/build-release` | 26 §3.3, §3.6.1, 18 §3.18.2, 17 §3.10 | M15 | T26-01~T26-10 | C | 3단계 | `S → O` |
| M17-02 | 푸시: 등록 저장(09 운영 테이블 `push_tokens`, 원문은 이벤트 밖, 판정 J-71), 이벤트 `device.push_registered`·`device.push_unregistered`·`push.sent`, 타이머 목적 `push_followup`·`push_dnd_digest`, 통치 명령 `device.register_push`·`device.unregister_push`·`device.test_push`, 메서드 `device.registerPush`(params `contentLevel`·`minUrgency`·`vapidKeyId`)·`device.pushConfig`·`device.testPush`, payload(`@helm/protocol/src/push.ts`), 보낼 대상 계산(`planPush`, 기본 `minUrgency = notice`[결정 48]), Web Push 송신(VAPID, 재시도, 410 처리), 11의 `urgencyOf`·전달기 수정. 레시피 `mobile-vapid-keygen`, `mobile-push-test` | `packages/daemon/src/push/{store,planner,webpush}.ts`, `packages/protocol/src/push.ts`, `packages/kernel/src/commands/*`, `packages/runtime/src/deliver/notify.ts` | 26 §3.4, 11 §3.5, 08 Device `push`, 09(이벤트·운영 테이블·타이머), 10(통치 명령), 19(메서드), 판정 J-71·J-118 | M17-01, HT-25 | T26-11~T26-18, 18 T18-31. 가짜 푸시 서비스(22)로 RFC 8291 복호화 | C | 3단계 | `S → O` |
| M17-03 | `apps/mobile`(`@helm/mobile`): 서비스 워커(문구 생성, 알림 클릭, 중복 제거), 수명주기(숨김 → 닫기, 보임 → `retryNow`), 결정 가능 판정, `SCR-M-*` 화면, 갱신. 레시피 `mobile-dev`, `mobile-build`, `mobile-check`, `mobile-e2e`, `mobile-shot`(`shot`이 부름). 분할: (a) 서비스 워커, (b) 수명주기·결정 가능 판정, (c) `SCR-M-*` 화면 하나씩, (d) 갱신 | `apps/mobile/**` | 26 §3.2, §3.3.5~§3.3.8, §3.5, §3.6, 03 §3.12, 20 §3.14 | M17-01, M17-02 | T26-19~T26-27. `just mobile-e2e`, `just mobile-shot` | B | 3단계 | `S → S` |
| M17-04 | 실기기 확인(iPhone, iOS 26[결정 49]): 설치, 쿠키 연결, 푸시, 잠금 화면, 재연결, 8일 뒤 재연결 등. A2 때 운영 데몬에서 | `tests/trace/manual.json`의 기록 | 26 §6.2 | M17-03, A2 | M-01~M-12 수행 기록 | D | 2단계 | `O 직접` |

#### 3.4.19 M18 3단계 기능(기본 꺼짐)

- 목표: 01 §3.8.2의 3단계 기능 중 TUI를 뺀 것. 켜는 일은 A3(G2 기록 뒤)다.
- 선행: M16.
- 규모: L.

| 작업 ID | 내용 | 산출 파일 | 근거 | 선행 | 완료 조건 | 등급 | 담당 | 모델 |
|---|---|---|---|---|---|---|---|---|
| M18-01 | 구조 루프 S의 일곱 동작, 하위 Concern 나누기·합치기·재조합, 의존 규칙 4 집행 경로. 루프 `S.*`, 모드 `restructure` | `packages/kernel/src/orchestration/contracts/catalog/s-*.ts`, `packages/kernel/src/commands/concern-structure.ts`(구조 명령) | 14 §3.6, 10 §3.8, 08 StructureChange, 02 UC-19 | M16 | 14 C-4(S.split 뒤 S.recombine·A.confirm), UC-19 대본 | C | 3단계 | `S → O` |
| M18-02 | 비상 합의(C.emergency), 미리 맺는 비상 합의 설정. 모드 `emergency`. UC-18 | `contracts/catalog/c-emergency.ts`, 설정 화면 | 14 §3.6, U-20, 11(`emergency_authorization`), 02 UC-18 | M16 | UC-18 대본 | C | 3단계 | `S → O` |
| M18-03 | 혼돈·혼란 상황의 기본 조합(14 §3.7.4)과 꺼진 루프 대체 동작 해제 | `src/orchestration/plan/*` | 14 §3.7.4, §3.15 | M18-01, M18-02 | 14 C-4의 3단계 묶음 계획 | B | 3단계 | `S → S` |
| M18-04 | 화면: 하위 Concern 나누기·합치기 조작, 비상 합의 표시 | `apps/desktop/src/screens/*` | 03 §3.6(3단계), 04 | M18-01~M18-03 | 플래그를 끈 `shot`이 이전 기준과 같다 | B | 3단계 | `S → S` |

#### 3.4.20 M19 TUI

- 목표: SSH로 WSL에 들어가 쓰는 pi-tui 기반 Helm TUI(결정 33·39). 인증은 `localAdmin`(19 Q-11).
- 선행: M15, M10. 첫 작업은 SP-13(실제 TTY에서 pi-tui 확인, 07 M5).
- 활성화: TUI는 데몬 동작을 바꾸지 않는 클라이언트이므로 기능 플래그를 두지 않는다. 설치(`~/.local/bin` 링크)는 `just tui` 레시피로 사람이 한다 [제안].
- 규모: M.

| 작업 ID | 내용 | 산출 파일 | 근거 | 선행 | 완료 조건 | 등급 | 담당 | 모델 |
|---|---|---|---|---|---|---|---|---|
| M19-01 | SP-13: Kitty 키보드 협상, IME, 한국어 줄바꿈을 실제 터미널(Mac 터미널 → SSH → WSL)에서 확인 | `docs/specs/spikes/SP-13.md` | 07 §3.14, M5 | M15 | 기록. 줄바꿈이 나쁘면 `wrapTextWithAnsi`를 Helm 쪽에서 감싼다 | D | 2단계 | `O 직접` |
| M19-02 | `apps/tui` 골격: `@helm/client/node`로 `rpc.sock`에 붙기, 문구는 `@helm/ui-language`, 명령 대응 표(데이터) | `apps/tui/**` | 03 §3.11, §6 "TUI parity 표", 07 §3.9.6 | M19-01 | 03 §6 "TUI parity 표"(데스크톱의 모든 명령 의도가 TUI 명령 하나 이상에 대응) | B | 3단계 | `S → S` |
| M19-03 | 화면: 질문 답하기, 복귀 요약, 합의 확인, 결과 확인, 이미지·요소 반응은 링크와 요소 키 명령(15 O-18) | `apps/tui/src/views/*` | 03 §3.11, 21 §6.3 선형 텍스트 골든 | M19-02 | 화면별 선형 텍스트가 21의 골든과 같은 내용 | B | 3단계 | `S → S` |
| M19-04 | `just tui` 레시피와 설치 안내 | `.just/helm.just` | 06 §3.16 | M19-03 | `just tui`가 데몬에 붙어 질문 하나를 답한다(수동) | A | 3단계 | `H → S` |

#### 3.4.21 일괄 구현 범위 밖(이후 단계)

다음은 이번 구현에 넣지 않는다(D23-11). 계기가 생기면 해당 문서와 이 문서를 고쳐 마일스톤을 더한다.

| 항목 | 이유 | 계기 | 근거 |
|---|---|---|---|
| 외부 런타임 어댑터(pi CLI RPC → Claude Code → Codex → ACP 순) | 01 §3.8.2 "이후". MVP에는 계약과 적합성 틀(M7-14)만 둔다. 순서는 얻을 수 있는 보장 Level이 가장 높고 사용자가 이미 쓰는 pi RPC를 먼저 둔다(13 O-13-12가 23에 맡김) [제안] | 다른 런타임에서 같은 Concern을 이어 쓸 필요가 생길 때 | 07 V11, 13 U-AD-1, O-13-12 |
| MCP 도구 | 01 단계표에 없고, 07은 "MCP 서버를 쓰기로 할 때 도입"으로 둔다 | 쓸 MCP 서버가 정해질 때 | 07 V10, 13 U-TL-12 |
| 이미지 생성 자극 | 01 OQ-13·15 O-9: 이미지 모델 설정 뒤 | 원함 탐구에서 웹 레퍼런스 이미지가 부족하다는 기록이 쌓일 때 | 01 OQ-13, 15 O-9 |
| `send` 확장(메일·메시지) | 01 §3.8.2는 2단계 ●이지만 13·18에 도구 명세가 없다 | 13·18이 도구와 권리 범주를 정한 뒤 M16에 행을 더한다 | 01 OQ-07, 18 Q18-06 |
| 자동 업데이트 | 20 Q-09: 1차 없음 | Windows 갱신이 한 달에 두 번을 넘을 때 | 20 §3.12.6 |
| Tailscale을 설치할 수 없는 기기용 접속 | 01 "이후" | 그런 기기가 생길 때 | 01 §3.8.1 |

### 3.5 증거 관문과 기능 플래그

#### 3.5.1 관문을 두는 자리 [제안, 판정 J-11]

구현은 한 번에 하고, 관문은 "기능을 켜는 순서"로 지킨다(01 §3.8.4, ADR 후보 P1-5). 그래서 관문은 MVP 완료와 활성화 단계 사이에 둔다. 구현 마일스톤 사이에는 두지 않는다. G0만 MVP 안에 있다.

```text
구현:  M0 … M9a ─(G0 실행: HT-16)─ … M14 → M15 ─────────────── M16 → M17 → M18 → M19 (기본 꺼짐으로 계속)
                                              │
운영:                                   MVP 완료 ─ G1 창(실사용 14일) ─ G1 기록 ─ A2(2단계 켜기)
                                                                              └─ 2단계 실사용 14일 ─ G2 기록 ─ A3(3단계 켜기)
조건:  M15-08(실사용 시작)은 G0 기록 뒤에만 한다
```

| 관문 | 위치 | 기록하는 것 | 통과 판정 | 통과하면 | 근거 |
|---|---|---|---|---|---|
| G0 | M9a 뒤, M15-08 전 | 흐린 작업 다섯 개의 보기 전·본 뒤 목표·기준, 변화 정도, 피로, 비용, 일주일 뒤 평가 | "의미 있음" 3개 이상 | MVP 실사용 시작 | 15 §3.15.2, 01 §3.8.4 |
| G1 | MVP 완료 + 14일 | G1-1~G1-5(복귀 3회, CA-1~CA-7, 원함 탐구 1건, 초안 수정 기록, 계속 쓰기) | 01 §3.8.4 표 | A2 | 01 §3.8.4, 16 §3.27.6 |
| G2 | A2 + 14일 | G2-1~G2-5(렌즈, 관찰 제안, 질문, 피로, 계속 쓰기) | 16 §3.27.6 표 | A3 | 01 §3.8.4, 16 §3.27.6 |

#### 3.5.2 G0의 처리 [제안, D23-4]

15 §3.15.2는 G0을 "커널의 E/N 정식 연결 전"에 둔다. 한 번에 구현하면 연결 코드는 함께 만들어지므로, 같은 목적을 "실사용 시작 전"으로 지킨다.

1. M9a-08이 끝나면 사람이 과제 다섯 개를 준비하고 `just eval-inquiry task=<경로>`로 돌린다(HT-16). 평가는 메모리 커널로 돌므로 M9b·M11을 기다리지 않는다.
2. 구현은 G0 결과를 기다리지 않고 M9b 이후로 진행한다.
3. 판정이 "1개 이하"면 M15-07에서 발산 설계(프롬프트, 방향, 대비 압축)를 고치고 G0을 다시 한다. 다시 한 결과가 나오기 전에는 M15-08(실사용 시작)을 하지 않는다. "2개"면 과제 셋을 더 해서 판정한다.
4. "의미 있음"은 15 §3.15.2의 사용자 판정이다. 이 계획은 그 판정을 기계로 대신하지 않고, 결과 YAML의 `changed`가 하나 이상이고 사용자가 `change: meaningful`로 적은 과제만 센다 [제안]. `auto` 지표의 계산식은 15가 정한다(§5.2). 15 §3.15.2의 기준 표로도 판정이 경계(2개)이거나 보류이면 G0은 미완료로 두고, 1단계 메인 오케스트레이터[결정 51]가 사용자 판정을 받는다. 그동안 M15-08(실사용 시작)은 하지 않는다.
5. G0 기록은 아직 정본 DB가 없을 수 있으므로 평가 디렉터리(`/srv/volumes/helm/eval/`)에 둔다. M15-08에서 "Helm 사용 평가" Concern을 만들 때 G0 결과 파일을 관찰로 기록한다.

#### 3.5.3 G1 창과 관문 기록 [제안, D23-5]

- **관문 기록 자리.** M15-08에서 "Helm 사용 평가" Concern을 만든다. 16 T6(14일마다 09:00)의 평가 보고가 이 Concern에 관찰로 붙고, 사람이 고른 판단(진행 / 상호작용 수정 / 다시 정의 또는 중단)과 G1 항목별 결과를 결과 확인으로 남긴다. 이 결과 확인이 "G1 기록"이다(01 §3.8.4).
- **데몬이 관문 기록을 찾는 방법.** 06 §3.10.3 규칙 (2)는 "G1 기록 Concern이 정본에 없으면 경고"를 요구한다. 데몬이 그 Concern을 찾을 표식이 필요하다. 이 문서는 Concern에 관문 표식(예: `evaluationGate: "G1" | "G2"`)을 두고 그 Concern의 `result.accepted`가 있으면 기록이 있다고 보기를 제안한다. 필드 이름과 위치는 08·16이 정한다(§5.2).
- **G1 창의 운영 데몬 갱신 규칙.** G1 창 동안 측정 조건이 바뀌면 G1 판단을 읽기 어렵다.
  1. 허용: MVP 결함 수정, 기본 꺼짐인 2단계·3단계 코드.
  2. 갱신 전: 기능을 끈 상태에서 MVP 유즈케이스 대본(M15-01)과 `just verify`가 통과해야 한다.
  3. 갱신마다 릴리스 ID와 바뀐 점을 관문 기록 Concern에 관찰로 남긴다(`just daemon-upgrade`가 끝날 때 안내). 결함 수정이 아닌 갱신은 한 주에 한 번으로 묶는다.
  4. 금지: 다이얼 기본값, 질문 문턱(11 A-2), CA 지표 판정 숫자(01 OQ-03) 변경. 이것들은 G1 판단 뒤에 바꾼다.
- **G1 창에서 켜는 것.** 복귀 점검(02 UQ-05: 기본 꺼짐, G1 기간에만 켬), 관찰 에이전트 결정적 부분, 2주 평가 보고(T6). 이 셋은 측정 장치이며 2단계 기능 플래그에 속하지 않는다.

#### 3.5.4 기능 플래그 기본값 [제안]

플래그 구조는 06 §3.10.3(`features.enabledLoops`, `features.enabledModes`, `features.flags`)이고 루프 단위 대체 동작은 14 §3.15다. 이 문서는 단계별 기본값과 `flags`의 첫 목록을 정한다. 목록의 정본은 `@helm/domain`의 `FEATURE_TABLE`(M1-04)이며, 06·08이 이 목록을 받아 확정한다(§5.2).

**루프와 모드**

| 설정 | MVP(기본값) | A2에서 더함 | A3에서 더함 |
|---|---|---|---|
| `enabledLoops` | O, I.fact, I.want, C.commit, A.confirm, A.reflect | I.possibility, I.outcome, C.probe, A.watch | S의 일곱 동작, C.emergency |
| `enabledModes` | orient, investigate, taste, execute | verify, deliberate | restructure, emergency |

- `deliberate`: 14 §3.15의 표는 2단계 모드로 `verify`만 적었으나, 같은 절의 꺼진 루프 대체 표는 I.possibility가 꺼지면 `deliberate`를 쓰지 않는다고 적는다. 그래서 `deliberate`를 I.possibility와 함께 A2에서 켠다. 14가 확인한다(§5.2).
- `A.confirm`은 끌 수 없다(의존 규칙 2, 14 F28).

**`flags`(루프·모드로 나눌 수 없는 기능)**

| 키 | 단계 | 기본 | 끄면 | 켜는 곳 | 근거 | 01 §3.8.2의 행 |
|---|---|---|---|---|---|---|
| `observer.modelJudgement` | 2 | false | 관찰 에이전트는 결정적 단계만 돌고 제안을 내지 않는다. `SCR-OBSERVER`를 그리지 않는다 | A2 | 판정 J-07, 16 OQ-16-02 | 관찰: 모델 판정과 제안 제출. 자율: 이의 패턴으로 묻기 정책 조정 제안 |
| `observer.externalExcerpts` | 2 | false | 외부 세션 발췌를 모델 API로 보내지 않는다(특징만) | A2(HD-4 답이 "보냄"일 때만) | 16 OQ-16-03 | 관찰: 모델 판정(외부 발췌 전송은 16 OQ-16-03) |
| `asking.mediator` | 2 | false | 중재 전달 방식을 고르지 않는다(협상·즉시·예약만) | A2 | 01 §3.8.2, 11 §3.7 | 묻기: 중재 전달 |
| `verify.independentAgent` | 2 | false | 독립 검증 run을 만들지 않는다 | A2 | 01 §3.8.2, 12 §3.14 | 검증: 독립 검증 에이전트 |
| `expectation.records` | 2 | false | 기대 레코드와 "응답 없음" 관찰을 만들지 않는다 | A2 | 01 §3.8.2 | 외부: 기대 레코드와 "응답 없음" 관찰 |
| `dials.fullExposure` | 2 | false | 노출 다이얼은 다섯 개(기본 전달 방식, 질문 빈도, 예산, 자극 수, 탐구 깊이). 나머지는 시스템 기본값 | A2 | 01 §3.8.2, 14 §3.15 | 다이얼: 노출 다이얼 |
| `inquiry.divergenceFull` | 2 | false | 발산은 앵커링·대비 압축 순서·정지 규칙만 | A2 | 01 §3.8.2, 15 §3.4 | 루프: 발산 서브시스템(2단계 ●) |
| `inquiry.repl` | 2 | false | REPL 방식 탐구 도구를 노출하지 않는다 | A2 | 01 §3.8.2(◐), 07 §3.2 | 런타임: REPL 방식 탐구(2단계 ◐. 3단계 ●도 같은 키) |
| `runtime.subcallGeneral` | 2 | false | 하위 호출은 자극 생성·가설 확인용만 | A2 | 01 §3.8.2(◐) | 런타임: 하위 호출 |
| `asking.rollbackPoints` | 2 | false | 범위를 줄인 합의 초안까지만 | A2 | 01 §3.8.2(◐) | 묻기: 범위를 줄여 진행, 되돌릴 지점 |
| `clients.mobile` | 2 | false | 모바일 기기 페어링, `/m/` 서빙, 푸시 송신을 하지 않는다. 26 `push.enabled`의 상위 스위치 | A2(M17이 끝났을 때) | [결정 42], [결정 47] | 클라이언트: 모바일 클라이언트 |

- 01 §3.8.2 2단계 행 중 루프·모드로 켜는 것(가능성·결과 탐구, 탐침형 C, 지속 관찰형 A)은 `enabledLoops`·`enabledModes`가, 위 표에 없는 것(`send` 확장, 이미지 생성)은 이번 범위 밖(이 문서 §3.4.21)이 맡는다. 이 표가 01·06과 함께 쓰는 `FeatureKey` 목록의 원안이다(§5.2 01·06·08).
- 3단계에는 `flags` 항목이 없다. S 루프와 C.emergency, 그 모드로 충분하다. 의존 규칙 4는 S 루프가 꺼져 있으면 하위 Concern이 생기지 않아 발동하지 않는다.
- 개발과 테스트: 테스트는 플래그를 켠 판본과 끈 판본을 모두 돈다(§3.4.17 공통 완료 조건). 개발 데몬(`daemon-dev`)은 `helmd.local.toml`로 무엇이든 켤 수 있다. 06 규칙 (2)대로 데몬은 G1 기록 없이 켜진 2단계 키를 경고만 하고 막지 않는다.

#### 3.5.5 활성화 단계 A2·A3의 절차 [제안]

1. 관문 기록이 있는지 확인한다(`helm status`가 관문 표식 Concern의 결과 확인을 보인다).
2. 관문 판단에 따라 켤 묶음을 고른다(§3.5.6).
3. dotfiles의 `helmd.toml`에서 `features`를 고친다(운영 설정은 dotfiles 소유, 06 ADR-06-11). `helm config check`로 검증한다.
4. `just daemon-restart`(또는 리로드. `features`는 "다음 계획·실행부터" 반영, 06 §3.10.5).
5. `helm status`와 운영 로그에 켜진 키가 보이는지, 앱이 `hello`의 능력 목록으로 새 화면 요소를 그리는지 확인한다. `clients.mobile`을 켤 때는 SP-15와 M17-04(실기기 확인)를 이 단계에서 한다.
6. 활성화 사실(켠 키 목록, 날짜, 릴리스 ID)을 관문 기록 Concern에 관찰로 남긴다. G2 창은 이 시각부터 센다.

#### 3.5.6 관문 결과에 따른 처리

| 결과 | G1 | G2 |
|---|---|---|
| 모두 통과 | A2에서 2단계 묶음 전부를 켠다 | A3에서 3단계 묶음 전부를 켠다 |
| 일부 미통과 | 01 §3.8.4: 2단계 범위를 조정하고 미통과 항목의 원인을 MVP에서 먼저 고친다. 미통과 항목과 관계없는 키만 켠다(예: G1-3 원함 탐구가 미통과면 `inquiry.divergenceFull`·`inquiry.repl`은 켜지 않는다). MVP 수정 작업은 M16 이후 작업보다 먼저 한다 | 같은 방식 |
| 원함 탐구나 C/A가 쓰이지 않음 | 제품 정의를 다시 검토한다(01 §3.10.4). M16~M19의 남은 구현을 멈추고 결과를 사람이 정한다 | 16 §3.27.6의 "다시 정의 또는 중단" |

### 3.6 병렬 갈래와 임계 경로

#### 3.6.1 갈래

갈래는 같은 브랜치에서 순서대로 진행하는 작업 묶음이다. 갈래끼리는 되도록 패키지가 겹치지 않게 나눴다. ops 갈래는 M11-11 안의 bash·systemd 부분을 먼저 떼어 낸 것이다. 유즈케이스 하네스와 대본(M0-12, M3-10, M8-12, M15-01)은 따로 갈래를 두지 않고 그 마일스톤의 갈래에서 만든다.

| 갈래 | 마일스톤·작업 | 시작 조건 | 다른 갈래와 만나는 곳 |
|---|---|---|---|
| core | M1 → M3 → M4 → M7 → M8 → M9b → M15 | M0 | M4(store와), M7(pi와), M11(daemon과) |
| store | M2 | M1 | M4 |
| pi | M5 → M6 | M0(M6은 M1-08 뒤) | M7, M9a |
| inquiry | M9a → (G0) | M1, M6-02 | M9b(core) |
| proto | M10 | M1 | M11-05, M13b |
| daemon | M11 → M12 | M4, M7, M8, M10 | M13c |
| ui | M13a | M0, M10-06 | M13c |
| app | M13b → M13c → M13d | M10(M13c는 M12·M13a 뒤) | M15 |
| observer | M14-01~M14-04, M14-06·07 → M14-05·08 | M2(M14-08은 M11-08 뒤) | M11-08, M12 |
| ops | M11-11의 bash·systemd 부분 | M0 | M11-12 |
| mobile | M17-01 → M17-03 | M15 | A2(M17-04) |

- 동시에 여는 갈래는 3~4개를 권한다 [가정: 에이전트 동시 실행 상한과 사람의 병합 확인 부담]. 첫 구간은 core·pi·proto, 둘째 구간은 core·store·inquiry·ui, 셋째 구간은 daemon·app·observer다.
- 갈래가 만나는 작업(위 표의 오른쪽 열)은 앞 갈래가 통합 브랜치에 병합된 뒤 시작한다(§3.1.3-2).

#### 3.6.2 임계 경로와 줄이는 방법

임계 경로는 M0 → M1 → M3 → M4 → M7 → M8 → M9b → M12 → M13c → M15다. 줄이는 방법:

1. M3을 C/A·질문 핵심(M3-01~M3-06)과 나머지(M3-07~M3-11)로 나눠, M4는 M3-06 뒤에 시작하고 나머지 명령은 M4·M7과 겹쳐 진행한다. M4-05의 통합 시험은 C/A 명령만 쓴다.
2. M8의 순수 코어(M8-01~M8-08)는 M3 뒤에 바로 시작해 M7과 겹친다.
3. M12는 화면 단위로 나눠 M13c의 같은 화면 작업과 짝으로 진행한다(M12-02 ↔ M13c-02 등).
4. M13a(UI 시스템)는 고정 데이터로 미리 끝내 둔다.

#### 3.6.3 중간 병합 지점 [제안]

갈래를 넘는 선행이 마일스톤 중간에 있으므로 마일스톤 끝만 병합하면 다음 갈래가 기다린다. 아래 행이 끝나면 1단계가 그 갈래 브랜치를 통합 브랜치에 병합한다. 병합은 사용자 확인 뒤에 하며(HD-6), 1단계는 같은 날 생긴 병합 지점을 한 번의 확인 요청으로 묶는다.

| 병합 지점(이 행까지 끝나면) | 이 병합을 기다리는 다른 갈래의 행 |
|---|---|
| M1-08 | M6-01 |
| M1-11 | M4-07 |
| M3-01, M3-04 | M8-01, M9a-01 |
| M6-02 | M9a-01 |
| M6-07, M7-03, M7-12 | M7-17(같은 갈래면 병합 없이) |
| M7-03 | M14-05 |
| M10-02, M10-06 | M13a-01, M13a-03 |
| M10-05 | M13b-01 |
| M11-05 | M12-09 |
| M11-08 | M14-08 |
| M11-09 | M12-07 |
| M11-10 | M13b-09 |
| M14-08 | M13c-08 |

- 병합 전 확인: 그 갈래 브랜치에서 `just verify`, 병합 지점 행들의 완료 조건 레시피. 마일스톤 끝 병합에서만 `just test-all`을 돌린다(§3.1.3-13).
- 사용자가 확인을 늦게 주면 기다리는 행만 멈추고 나머지 행은 계속한다.

### 3.7 위험과 스파이크

#### 3.7.1 스파이크 목록

스파이크는 위험이 큰 가정을 작은 코드로 먼저 확인하는 작업이다. 결과는 `docs/specs/spikes/SP-xx.md`에 남긴다(§3.7.3). 이미 설계 단계에서 확인한 것은 "확인 상태"에 적었다.

| ID | 위험 | 확인 시점(이 작업 전) | 성공 기준 | 확인 상태 | 대체 경로 | 대체 결정 기준 | MVP 판정 영향 |
|---|---|---|---|---|---|---|---|
| SP-01 | 워크스페이스 전체에서 Node 24 타입 제거 + `source` 조건 실행이 안 될 수 있다 | M0-06 | `node --conditions=source packages/daemon/src/bin/helmd.ts --version` 동작 | vendor 진입점 두 개 로드는 확인 [실험, 07 §3.6.3] | `tsc -b --watch` + 수동 재시작(06 O-05) | 한 번이라도 실패하면 대체 | 없음 |
| SP-02 | typescript-eslint가 TS 6.0에서 타입 정보 린트를 못 돌릴 수 있다 | M0-07 | 타입 정보 규칙이 한 패키지에서 돈다 | peer 범위 `<6.1.0` 확인 [실험, 06 §3.12.2] | 타입 정보 규칙을 끄고 의존 규칙은 `check-arch`로만 | 같은 판의 플러그인이 없으면 대체 | 없음 |
| SP-03 | better-sqlite3 설치(pnpm 11 빌드 허용)와 `synchronous=FULL` 커밋 지연 | M0-11 | 설치·불러오기 성공, 22/PF-01(커밋 p99 ≤ 25 ms) | 미확인 | `node:sqlite`(`store/src/driver.ts`만 고침, 06 §3.12.3) | 설치가 안 되거나 PF-01을 넘을 때. 넘으면 하위 조정자가 원인을 적어 1단계가 판정한다 | 대체 드라이버로 같은 PF-01·PF-09를 통과하면 영향 없음 |
| SP-04 | bwrap 격리가 설치판과 WSL 커널에서 기대대로 동작하지 않을 수 있다(사용자 네임스페이스, `systemd-run --scope` 감싸기, 타임아웃 시 자식 정리, `/run/WSL` 가림) | M6-10 | T-SB-01~04, T18-08~11 | 압축 푼 0.9.0으로 9개·8개 확인 [실험, P7], `systemd-run --user` S1b 확인 [실험, 18 §3.11.2] | S1b(`systemd-run --user`). 단 13·18이 S1b를 허용 목록 방식(홈은 tmpfs, 작업 공간·도구 체인만 읽기 바인드)으로 고치고 user unit 동작을 [실험]으로 확인한 경우만 쓴다. 아니면 `execute` 끔(fail closed, 18 D18-05) | T-SB 중 하나라도 실패 | S1(bwrap)이 MVP 기준이다(22 §3.17.3 "S1 묶음"). bwrap이 실패하면 `execute`를 끈 채로는 UC-02·UC-07을 끝낼 수 없으므로 MVP 미완료로 두고 1단계가 사용자에게 보고한다. S1b는 13·18의 허용 목록 명세와 [실험]이 있을 때만 MVP 대체로 인정한다 |
| SP-05 | pi 포크 패치 A1~A7과 도구 패치 T1~T14의 유지 부담 | M5-02 | 07 V2·V3, `sync.mjs verify` 0 | 시제품 업스트림 테스트 173건 통과, 계약 시험 [실험, 07 §3.19] | 업스트림 Breaking이 루프 계약을 바꾸면 3-way 병합 대신 `@helm/agent`에 Helm 소유 루프를 다시 쓴다(07 §3.2 재검토 조건). 계약 시험 C1~C24는 그대로 둔다 | 07 §3.2의 재검토 조건 | 없음(재설계해도 계약 시험 C1~C24는 같다) |
| SP-06 | pi-ai 실제 제공자 스트림·사용량·캐시 필드가 가짜 제공자와 다를 수 있다 | M6-13 | `ai-smoke`로 스트림 1회, 사용량·캐시 필드 기록 | faux 동작은 확인 [실험, pi-lab] | `pnpm patch`(3개·200줄까지) → 넘으면 pi-ai vendor(07 M2) | 07 §3.2 재검토 조건 | 없음 |
| SP-07 | Tauri 앱의 SSH 전송(Rust가 `ssh -W 127.0.0.1:7841` 자식을 띄우고 그 위에 WebSocket)이 Mac·Windows OpenSSH에서 기대대로 동작하지 않을 수 있다 | M13b-05(크레이트 시험은 M13b-02와 함께 WSL에서 먼저) | 20 §6.1 "SSH 인자·실패 분류", "SSH 경로 통합"과 실제 `server` 연결 | `ssh -W` 사례(paseo) 확인 [원문, P13 메모], sshd 포워딩 기본 허용 [실험, 17] | 19 Q-01의 B2(`ssh -L` 로컬 포트) 또는 B4(`helm bridge` stdio). 메시지와 재전송 의미는 같게 유지(결정 38) | 두 플랫폼 중 하나라도 해결되지 않는 실패 | 대체 경로(B2·B4)로 두 경로 메시지 동등성(19 §6.3)을 통과하면 01 §3.8.3 3을 충족한 것으로 본다 |
| SP-08 | WSL에서 Windows 교차 빌드(cargo-xwin, NSIS)가 막힐 수 있다(공식 문서는 "마지막 수단") | M13b-02 | 빈 앱의 NSIS 설치 파일이 Windows 11에서 관리자 권한 없이 설치·실행 | 미확인 | GitHub Actions `desktop-windows.yml`(push는 사람 확인) | 교차 빌드가 세 번 넘게 막히면(20 Q-11) | CI 산출물로 Windows 설치·실행 기록이 있으면 충족 |
| SP-09 | 글래스모피즘(`backdrop-filter`)이 WKWebView·WebView2에서 스크롤·크기 조절을 느리게 만들 수 있다 | M13a-02(서버 측정), M13b-02 뒤(실제 웹뷰 측정과 결정) | 21 §6.3 성능 행(22/PF-14)의 기준(유리 크롬 아래 긴 목록 스크롤 프레임 시간 중앙값 ≤ 16.7 ms)을 서버 Playwright(Chromium·WebKit)에서 통과하고, 같은 장면을 Mac WKWebView(Safari 웹 검사기 타임라인)와 Windows WebView2(DevTools 성능 기록)에서 재어 중앙값 ≤ 16.7 ms, 95백분위 ≤ 33 ms [제안] | 21이 유리를 셸·오버레이에만 두고 불투명 대체를 정함 [원문, 21 §3.2.5] | 해당 플랫폼의 기본 투명도를 `reduced`(불투명)로, 또는 유리를 오버레이에만 | 측정 기준을 넘으면 | 없음(불투명 대체로 같은 화면 기준) |
| SP-10 | `tailscale serve` 경유 WSS와 신원 헤더가 기대대로 오지 않을 수 있다(A17-2, A18-1) | M11-12(HT-09 뒤) | `just daemon-probe` 통과, T18-05 | 미확인 | SSH 경로만 쓴다(결정 38의 경로 ②). `tailnet` 리스너는 `token-only` 설정(T18-03)을 사람이 고를 때만 | 신원 헤더가 오지 않거나 위조를 덮어쓰지 않으면 | serve 경로가 끝내 안 되면 01 §3.8.3 3(두 경로)을 채울 수 없다. MVP 미완료로 두고 1단계가 사용자에게 경로 기준을 묻는다 |
| SP-11 | macOS 자체 서명 앱의 키체인 확인 창, 알림 클릭, 딥 링크 | M13d-02 | 20 §6.2 체크리스트 1·6·7 | 미확인 | ad-hoc 서명(20 Q-08), 알림 클릭 대체 배너 | 재빌드마다 키체인 확인 창이 뜨면 | 없음 |
| SP-12 | pi-codemode 워커가 데몬 안에서(`node --watch` 없이) 기대대로 동작하지 않을 수 있다 | M16-11 | 07 V9, 15 T-20 | `node --watch` 문제는 알려짐 [원문, 07 E14] | REPL 끔(2단계 ◐이므로 MVP 영향 없음) | V9 실패 | 없음(2단계) |
| SP-13 | pi-tui가 실제 TTY(SSH, Kitty 협상, IME, 한국어 줄바꿈)에서 쓸 수 없는 수준일 수 있다 | M19-01 | 07 M5 확인 항목 | 미확인 | 줄바꿈 함수를 Helm 쪽에서 감싼다(07 §3.2) | 감싸도 안 되면 TUI 범위를 질문 답하기로 줄인다 | 없음(3단계) |
| SP-14 | WSL 재기동·로그온 전 시작·keepalive | M11-12 | T17-30, A17-1 | linger·keepalive 작업 확인 [실험, P11 메모] | 17 Q17-01 (a) 그대로(로그온 뒤 시작) | - | 없음 |
| SP-15 | `tailscale serve`가 모바일 쿠키·Origin·하위 프로토콜 헤더를 넘기지 않거나(26 AS-M2·M3) iPhone 홈 화면 웹 앱의 Web Push가 동작하지 않을 수 있다 | A2 시작(M17-04 첫 항목) | 26 M-03, M-04, M-05 | 미확인 | 쿠키 대신 `helm-bearer.` 하위 프로토콜 + 서명 증명(26 MQ-04·MQ-05). 푸시가 안 되면 앱 안 알림만 쓰고 경로 B(Tauri iOS + APNs)를 26 §3.1.5 조건으로 검토 | M-03 또는 M-04 실패 | 없음(2단계) |
| SP-16 | 네트워크를 허용한 도구 실행이 루프백·사설·tailnet 서비스(데몬 리스너, Caddy 관리 API 2019 등)로 가는 연결을 막지 못할 수 있다 | M6-16 | 네트워크 네임스페이스 분리 + 데몬 CONNECT 프록시로 루프백·사설·CGNAT·tailnet 차단, 허용 호스트만 통과(판정 J-134) | 미확인 | 네트워크 허용 실행을 실행마다 사람 승인(권리 게이트)으로 하고 홈랩 H-5를 먼저 처리한다(판정 J-134) | 프록시를 거치지 않는 연결이 하나라도 성공하면 | 네트워크 허용 실행은 MVP 필수 경로가 아니다. 대체 경로로 가면 UC-02의 웹 확인 단계마다 승인 질문이 하나 늘어난다 |

#### 3.7.2 그 밖의 위험

| 위험 | 영향 | 대응 |
|---|---|---|
| 커널(M3)과 런타임(M7)의 크기 | 임계 경로가 길다 | §3.6.2의 나누기. C/A부터 통합해 일찍 끝에서 끝까지 돈다(M4-05, M7-15) |
| 설계 문서끼리 남은 불일치 | 구현자가 추측한다 | §3.9 절차. 이 문서 §5.2에 지금 아는 불일치를 적었다. 3단계 검증에서 더 나올 수 있다 |
| 카탈로그 표류(설계 표와 코드 등록 표가 어긋남) | 문서를 믿을 수 없게 된다 | `just docs-check`(M1-10, D23-10) |
| `just verify` 시간 증가 | 작업마다 기다림이 길어진다 | 속성 테스트 시드 수 줄임(10: `verify`는 시드 20), 느린 묶음(장애 주입 100회, 시각 테스트, 실제 모델)은 별도 레시피. 경계는 22가 정한다 |
| Mac이 잠들거나 꺼져 있음 | Mac 레시피가 종료 코드 2 | 코드를 고치지 않고 보고(사용자 규칙). Mac 작업은 묶어서 한다 |
| 실제 모델 비용 | 평가·실사용 비용 | 월 상한(HT-13), `ai-smoke`·`eval-inquiry`는 `verify` 밖 |
| 사람의 병합 확인 부담 | 갈래 작업이 병합 확인 전까지 멈춘다 | 마일스톤 끝에 묶어서 한 번 확인(D23-8) |
| 2단계 구현이 G1 측정을 흐림 | G1 판단을 읽기 어렵다 | §3.5.3의 갱신 규칙 |
| 모바일 실기기 확인이 늦음 | 쿠키·푸시 문제를 A2 때 처음 안다 | 공유 경계(`@helm/client-react`, `@helm/ui`)를 MVP부터 플랫폼 중립으로 둔다(20 §3.14, 21 UI-D19). `mobile-e2e`(WebKit)로 미리 확인하고, 실기기 문제는 SP-15의 대체 경로로 간다 |

#### 3.7.3 스파이크 기록 형식

`docs/specs/spikes/SP-xx.md`(개발 문서, md):

```markdown
# SP-xx 제목
- 날짜, 실행한 사람(에이전트), 커밋
- 확인한 가정: (이 문서 §3.7.1의 "위험" 열)
- 방법: 명령, 환경(OS, 판 번호)
- 결과: 성공 기준별 통과/실패, 측정값
- 결론: 그대로 진행 / 대체 경로(어떤 것) / 보류
- 바뀐 설계: ADR 번호, 고친 문서 절(§3.9)
```

### 3.8 미결 사항의 처리 시점

각 문서 §7의 미결 사항을 세 묶음으로 나눈다. 여기 없는 항목은 그 문서의 추천 기본값으로 진행한다. 기본값을 쓰는 WBS 행은 커밋 메시지나 진행 기록에 미결 ID를 적는다.

#### 3.8.1 구현 전 또는 해당 작업 전에 사람이 정할 것

| 출처 | 질문 | 기본값(답이 없을 때) | 정할 때 | 사람 작업 |
|---|---|---|---|---|
| 판정 J-22, 01 OQ-06 | 월 모델 비용 상한 | USD 50 [가정] | M11-12 | HT-13 |
| 06 O-11 | CI 범위 | `verify`는 서버만, Actions는 Windows 빌드만 | M0-01 | HD-1 |
| 18 Q18-07 | CLI 사람 결정 명령의 TTY 요구 | 요구 | M11-10 | HD-2 |
| 01 §3.8.2 대 13 O-13-05 | MVP 웹 페이지 읽기 | `web_fetch`(읽기 전용) 포함 | M6-14 | HD-3 |
| 16 OQ-16-03 | 외부 세션 발췌 모델 전송 | 보내지 않음(A2 때 다시 묻는다) | A2 | HD-4 |
| 16 OQ-16-10 | 자기보고 척도 | 자체 문항 | M14-07 | HD-5 |
| 21 U-07, 판정 J-88 | Caustic 저장소 LICENSE 추가 | NOTICE에 출처 기록만 | M13a-01(막지 않음) | HT-15 |
| 21 U-14 | macOS 최소 판(웹뷰 기준) | 21의 기준(Safari 18 이상) | M13a 시작 | HT-07 |
| 판정 §5, 20 Q-22 | `.stignore-dev`의 Cargo `target` | `CARGO_TARGET_DIR` 우회 | M13b-02 | HT-14 |
| 26 §7.1 U-1 | Apple 개발자 프로그램(경로 B 검토 때만) | 없음으로 보고 PWA로 진행[결정 47] | 26 §3.1.5 조건이 생길 때 | HT-21 |
| (해결) 18 Q18-09·Q18-10, 19 Q-16·Q-18 대 26 | 모바일 푸시 경로, PWA 토큰 보관, 브라우저 전송 토큰 | 판정 J-118: 18·19가 26을 따른다(쿠키 토큰, Web Push) | - | - |
| 17 Q17-11 | sshd 포워딩 좁히기 | 그대로(기본 허용) | 필요할 때만 | - |

#### 3.8.2 구현 중 스파이크·측정으로 정할 것

| 출처 | 질문 | 기본값 | 정하는 작업 |
|---|---|---|---|
| 06 O-05 | 개발 실행 형태 | 소스 직접 실행 | M0-06(SP-01) |
| 06 O-04, 09 U-02, 17 Q17-04 | SQLite 드라이버, `synchronous` | better-sqlite3, FULL | M0-11(SP-03), M2-10 |
| 13 O-13-01, 18 Q18-03, 17 Q17-03 | 도구 격리 수단 | S1 bwrap → S1b → 끔 | M6-10(SP-04) |
| 07 M10 | vendor 빌드 형태 | `dist` 빌드 | M5-02 |
| 19 Q-01, 20 Q-02 | SSH 경로 방식, 전송 소유 | B3 `ssh -W`, Rust | M13b-05(SP-07) |
| 20 Q-11, Q-12 | Windows 빌드 경로, macOS 대상 | 교차 빌드, universal | M13b-02(SP-08), M13d-02 |
| 20 Q-08 | macOS 서명 | 자체 서명 인증서 | M13d-02(SP-11) |
| 20 Q-06 | 숨긴 창의 알림 지연 | 웹뷰 JS | M13d-01(20 §6.2-10) |
| 21 §3.2.5(투명도 설정) | 플랫폼별 기본 투명도 | `system` | M13a-05(SP-09) |
| 19 Q-05, Q-03 | `maxReplayEvents`, 뷰 동기화 | 50,000, 무효화 + 다시 받기 | M11-13, M15-04 |
| 17 Q17-07 | 이벤트 루프 치명 임계값 | 120초 | 첫 달 실측(M15 뒤) |
| 15 O-14, O-5 | G0 판정 숫자, 칸 상한 | 15 표의 값 | G0(HT-16) |
| 07 M5 | pi-tui 실제 TTY | - | M19-01(SP-13) |
| 12 O-12-04 | 크래시 루프 기준 | 10분 3회 | M7-05 |

#### 3.8.3 기본값으로 진행하고 실사용 뒤 조정할 것

아래 ID는 모두 문서의 추천 기본값으로 구현한다. G1 창의 2주 평가(16 §3.27.6) 또는 각 항목이 적은 조건이 생기면 다시 본다. G1 창 동안에는 바꾸지 않는다(§3.5.3-4).

| 문서 | 기본값으로 진행하는 미결 ID |
|---|---|
| 01 | OQ-01(원함 탐구 MVP), OQ-02, OQ-03(CA 판정 숫자: 14일 뒤 조정), OQ-04, OQ-07(send는 git push만), OQ-09, OQ-11, OQ-12, OQ-13, OQ-15(가벼운 작업의 결과 확인은 한 화면 확인만, 판정 J-89) |
| 02 | UQ-01, UQ-03, UQ-04(마무리 직전 검사 2회), UQ-05(복귀 점검: G1 기간에만 켬), UQ-06, UQ-07, UQ-08, UQ-10, UQ-11 |
| 03 | IA-Q1(영어 이름, 2주 뒤 재검토, 판정 J-21), IA-Q2, IA-Q3, IA-Q4, IA-Q6 |
| 04 | SC-Q1~SC-Q7 |
| 05 | IX-Q1~IX-Q8 |
| 06 | O-03(TS 7은 typescript-eslint 지원 뒤), O-06, O-07, O-08(API 키만), O-12, O-13, O-14, O-15(G1 기록 없이 켠 2단계 키는 경고만, §3.5.4), O-16 |
| 07 | M2, M3, M4, M6, M7, M8, M9(업스트림 제안은 push라 사람 확인), M11 |
| 08 | U-01~U-21 |
| 09 | U-01, U-03~U-17 |
| 10 | K-1~K-13 |
| 11 | A-1(AND만), A-2(문턱 수치), A-3~A-14 |
| 12 | O-12-01~03, O-12-05~10, O-12-12~16 |
| 13 | O-13-02~11, O-13-13. O-13-12(외부 어댑터 순서)는 §3.4.21에서 정함 |
| 14 | U-01, U-05(주의 예산 수치), U-07(동시 실행 수), U-08~U-23(해결 항목 제외) |
| 15 | O-1~O-4, O-6~O-13, O-15~O-21(O-19는 판정 J-97, O-20은 J-98, O-21은 J-99로 정해짐) |
| 16 | OQ-16-01, -02, -04~-09, -11~-17(-15 반증 조건 숫자는 첫 14일 기준선 뒤 확정) |
| 17 | Q17-01, -02, -05, -06, -08~-10 |
| 18 | Q18-01, -02, -04~-06, -08, -11. Q18-09·Q18-10(모바일 푸시·토큰)은 §3.8.1 |
| 19 | Q-02, Q-04, Q-06~Q-15, Q-17. Q-16·Q-18(브라우저 토큰·외부 푸시)은 §3.8.1 |
| 20 | Q-04, Q-05, Q-07, Q-09, Q-10, Q-13~Q-21 |
| 21 | U-04, U-05, U-10, U-15, U-17~U-25(U-21 shadcn 복사는 판정 J-86, U-22는 26 MQ-09) |

### 3.9 구현 중 설계 변경 절차 [제안]

#### 3.9.1 변경의 종류

| 종류 | 예 | 처리 |
|---|---|---|
| 표기 | 오탈자, 절 번호, 깨진 참조 | 하위 조정자가 해당 문서를 제자리에서 고치고 1단계에 알린다. 커밋 `docs(design): <문서> 표기` |
| 보완 | 명세에 빠진 세부를 정함, 미결 사항을 추천 기본값으로 확정, 스파이크 결과 기록 | 하위 조정자가 고칠 내용을 올리고 1단계가 판정한다. 승인되면 소유 문서의 해당 절을 고치고 미결 표의 행에 "해결(<WBS ID>, <커밋>)"을 적는다. 다른 문서의 계약은 바뀌지 않아야 한다 |
| 계약 변경 | 이름·타입·이벤트·명령·메서드·오류 코드·화면 ID·상태 기계·패키지 경계·의존 규칙이 바뀜, 대체 경로 채택 | §3.9.2 절차. 1단계가 판정하고 ADR을 남긴다 |
| [결정] 변경 | 브리프 §2의 사용자 결정(결정 1~51 중 [결정] 항목)과 어긋남 | 1단계가 구현을 멈추고 사용자에게 묻는다. 답을 받은 뒤 계약 변경 절차 |

#### 3.9.2 계약 변경 절차(결정 51의 역할 배분)

1. **발견(3단계).** 실작업자는 그 부분의 구현을 멈추고, 어긋나는 문서 절 두 곳 이상(또는 명세와 실제 동작)과 재현 방법을 하위 조정자에게 올린다. 맡은 행의 나머지 부분은 계속한다.
2. **정리(2단계).** 하위 조정자는 근거 절을 다시 대조해 어긋남이 맞는지 확인하고, 이름의 정본(판정 §1의 소유 표: 이벤트 09, 명령 10, 레코드·질문 종류·ID 접두사 08, 메서드·오류 코드 19, 화면 ID 03, 유즈케이스 ID 02, 패키지 경계 06)과 영향 받는 WBS 행·문서를 적어 변경안을 1단계에 올린다. 그 WBS 행은 진행 기록에 "설계 변경 대기"로 표시한다.
3. **판정(1단계).** 메인 오케스트레이터가 변경안을 판정한다: 채택, 다른 안 채택, 기각(명세대로 구현). 사용자 결정이 걸리면 사용자에게 묻는다. 채택하면 1단계가 ADR을 24 §2 형식으로 쓴다. 번호는 결정이 나온 문서 번호(`ADR-SS-NN`)이고, 옛 결정을 바꾸면 옛 ADR을 "대체됨 → ADR-x"로 고친다(24 §2.4).
4. **반영(2단계).** 하위 조정자가 1단계의 판정대로 소유 문서의 정의를 고치고, 그 이름을 쓰는 다른 문서를 저장소 전체 검색(`rg '<이름>' docs/design`)으로 찾아 함께 고친다. 이 문서(23)의 WBS 행과 테스트(테스트 ID가 바뀌면 22의 색인과 `tests/trace/index.ts`)를 고친다.
5. **커밋.** 설계 문서 수정(`docs(design): …`)과 코드 수정은 커밋을 나누되 같은 갈래 브랜치에서 연달아 한다. 통합 브랜치에는 다음 병합 지점에서 함께 들어간다.
6. **확인.** `just verify`(특히 `docs-check`, `test-trace`)가 통과해야 한다. 1단계는 다음 병합 요청에 변경 목록(ADR 번호, 고친 문서 절)을 붙인다.

#### 3.9.3 하지 않는 것

- 코드만 고치고 문서를 그대로 두지 않는다. 다음 작업자가 문서를 믿을 수 없게 된다.
- 문서에 "구현 참고" 같은 별도 메모 파일을 만들지 않는다. 바뀐 내용은 소유 문서와 ADR에만 둔다.
- 설계 과정 기록(`docs/design/process/`)은 구현 중에 고치지 않는다. 구현 중 변경 이력은 ADR과 Git 기록이 맡는다.

#### 3.9.4 카탈로그 동기화 검사(D23-10)

설계 표와 코드 등록 표가 둘 다 있는 카탈로그는 이름 목록이 같아야 한다.

| 카탈로그 | 설계 표 | 코드 등록 표 | 검사 도입 |
|---|---|---|---|
| 이벤트 | 09 §3.4 | `@helm/domain` `EVENT_TYPES` | M1-10 |
| 레코드 종류·ID 접두사 | 08 §3.2, §3.20.1 | `@helm/domain` 접두사 목록 | M1-10 |
| 명령 | 10 §3.11 | `@helm/kernel` 명령 등록 표 | M3-07 |
| 메서드·오류 코드 | 19 §3.3.4, §3.7.1 | `@helm/protocol` 등록 표 | M10-03(19의 `check-registry`와 함께) |
| 화면 ID | 03 §3.6 | `apps/desktop/src/navigation/screens.ts` | M13b-08 |

`scripts/docs/check-catalog.ts`가 설계 문서 표에서 백틱 안의 이름을 뽑아 코드 목록과 비교한다. 문서 표의 형식이 바뀌면 이 스크립트를 함께 고친다.

### 3.10 레시피 도입 시점과 `just verify` 구성

새 레시피는 처음 필요한 WBS 행에서 만든다(§3.1.3-9). 레시피 내용의 소유는 "소유" 열의 문서다.

| 레시피 | 소유 | 도입 작업 | `verify`에 포함 |
|---|---|---|---|
| `help`, `info`, `dotenv`, `verify`, `setup`, `check`, `lint`, `test`, `build`, `clean` | 사용자 템플릿 | M0-04 | `lint`, `test` |
| `typecheck`, `_verify-steps` | 06 §3.16 | M0-04 | 예 |
| `check-arch` | 06 §3.5 | M0-07(이때 `_verify-steps`에 더한다) | 예 |
| `test-trace`, `test-flaky` | 22 §3.4.3, §3.18.1 | M0-12 | `test-trace`만 |
| `test-all` | 22 §3.15.3 | M0-12(그때 있는 하위 레시피만 모아 돌리고, 하위 레시피가 생길 때마다 더한다) | 아니오. 마일스톤 관문(§3.1.3-13) |
| `docs-check` | 이 문서 D23-10 | M1-10 | 예 |
| `test-slow`, `test-clean` | 22 §3.15.3 | M2-04(첫 `*.slow.test.ts`가 생길 때) | 아니오 |
| `test-deep`, `test-golden-update`, `coverage` | 22 §3.15.3 | M3-10 | 아니오 |
| `tape-promote` | 22 §3.5.4 | M6-06 | 아니오 |
| `vendor-status`, `vendor-verify`, `vendor-outdated`, `vendor-upgrade` | 07 §3.18 | M5-01 | `vendor-verify` |
| `licenses` | 07 §3.17 | M5-05 | 고지 일치 검사 |
| `ai-smoke` | 07 §5.1 | M6-13 | 아니오(비용) |
| `eval-inquiry` | 15 §3.15.2 | M9a-08 | 아니오(실제 모델) |
| `test-scenarios` | 22 §3.15.3 | M8-12 | 아니오(MVP 대본의 `runtime` 모드는 `test`에 들어간다) |
| `eval-prompts` | 22 §3.14(15/E2·E4) | M9a-08 | 아니오 |
| `eval-summary` | 22 §3.14(22/EV-01) | M8-11 | 아니오 |
| `eval-flows` | 22 §3.14(22/EV-03) | M15-09(실사용 기록 전 사전 점검) | 아니오 |
| `eval-repl` | 22 §3.14(15/E3) | M16-11 | 아니오 |
| `eval-observer` | 22 §3.14(22/EV-02) | M16-09 | 아니오 |
| `daemon-dev` | 17 §3.14 | M11-02 | 아니오 |
| `daemon-doctor`, `daemon-install`, `daemon-upgrade`, `daemon-rollback`, `daemon-start`·`stop`·`restart`·`status`·`logs`, `daemon-backup`, `daemon-restore`, `daemon-verify`, `daemon-drill`, `daemon-diag`, `daemon-probe`, `daemon-serve-line`, `daemon-uninstall`, `daemon-export`, `daemon-systest` | 17 §3.14 | M11-11 | 아니오(`daemon-systest`는 서버 전용 시스템 시험) |
| `test-conformance-ssh` | 22 §3.15.3 | M11-06 | 아니오 |
| `bench` | 22 §3.13 | M2-10 또는 M3-11 중 먼저 끝나는 행(갈래가 병렬이다). 그 뒤 M2-10·M3-11·M4·M8-11·M13a가 항목을 더한다 | 아니오 |
| `perf`, `perf-seed` | 19 §6.4, 22 §3.13 | M11-13(종단 측정) | 아니오 |
| `test-faults`, `e2e-real` | 22 §3.15.3 | M15-02, M15-03 | 아니오 |
| `ui-tokens`, `ui-check`, `ui-storybook` | 21 §6.4 | M13a-01 | `ui-check` |
| `setup`(루트 `justfile`에서 덮어써 Playwright 브라우저 내려받기를 더함) | 22 §5.2 "06"(4) | M13a-02 | 아니오 |
| `ui-test` | 21 §6.4 | M13a-02 | 예 |
| `ui-visual`, `ui-visual-update` | 21 §6.4 | M13a-09 | 아니오. UI를 바꾼 행의 완료 조건에 넣는다 |
| `app-setup`, `app-check`, `app-dev`, `app-dev-mac`, `app-build-win` | 20 §3.12.2 | M13b-02 | `app-check`(HT-06 뒤) |
| `app-test-ssh` | 20 §3.12.2 | M13b-05 | 아니오 |
| `app-e2e`, `shot` | 20 §3.12.2, 21 §6.4 | M13c-01 | 아니오. 앱·화면 행의 완료 조건 |
| `test-fixtures-views` | 22 §3.15.3 | M15-01 | 아니오 |
| `app-build-mac`, `app-build-local`, `app-install-mac`, `app-verify-mac`, `shot-mac` | 20 §3.12.2, 21 §6.4 | M13d-02 | 아니오(Mac) |
| `app-build-win-ci` | 20 §3.12.2 | M13d-03 | 아니오(push 필요, 사람 확인) |
| `lens-seed` | 15 §5.2 "06" | M16-01 | 아니오 |
| `mobile-vapid-keygen`, `mobile-push-test` | 26 §3.6.2 | M17-02 | 아니오 |
| `mobile-dev`, `mobile-build`, `mobile-check`, `mobile-e2e`, `mobile-shot`, `mobile-sim`(선택) | 26 §3.6.2 | M17-03 | `mobile-check`(워크스페이스 `test`에 포함) |
| `tui` | 06 §3.16 | M19-04 | 아니오 |

`_verify-steps`의 변화: M0-04(lint, typecheck, test, secrets, gitleaks) → M0-07(+ check-arch) → M0-12(+ test-trace) → M1-10(+ docs-check) → M5-05(+ vendor-verify, 고지 일치) → M13a-01(+ ui-check) → M13a-02(+ ui-test. HT-24가 먼저) → M13b-02(+ app-check. HT-06이 먼저). 단계가 들어간 뒤 도구가 없으면 종료 코드 2다(§3.1.3-5). Mac이 필요한 레시피, Windows 교차 빌드, `app-e2e`, `shot`, 실제 모델 레시피는 넣지 않는다(06 §3.16 원칙, 22 §3.15.2). `just verify` 시간 목표는 22 §3.15.1(목표 5분, 상한 10분)을 따른다.

야간 `test-deep` 타이머(22 §3.16, Q22-04) [제안]: M11-12(운영 데몬과 `helm-alert@` 단위 설치) 뒤에 켠다. 그 전에는 경보 경로가 없고 커널·저장소 코드가 자주 바뀐다. 타이머는 통합 브랜치 `impl/helm-v1`의 별도 worktree에서 돈다.

## 4. 실패·예외·경계 사례

| ID | 상황 | 처리 |
|---|---|---|
| F23-1 | 스파이크가 성공 기준을 채우지 못함 | §3.7.1의 대체 경로로 간다. 스파이크 기록(§3.7.3)과 ADR(§3.9.2)을 남기고 영향 받는 WBS 행을 고친다 |
| F23-2 | 레시피가 종료 코드 2로 끝남(도구 없음, Mac 잠자기, sshd 없음, 브라우저 없음) | 코드를 고치지 않고 보고한다. `_verify-steps`에 들어간 단계의 도구가 없으면 모든 갈래가 멈추므로 1단계가 해당 사람 작업을 먼저 요청한다(§3.1.3-5). §3.2의 사람 작업 중 무엇이 빠졌는지 함께 적는다. 다른 행으로 넘어간다 |
| F23-3 | 설계 문서끼리 모순 발견 | §3.9 절차. 소유 문서가 분명하지 않으면 사용자에게 묻는다 |
| F23-4 | G0 판정이 "1개 이하" | M15-07: 발산 설계를 고치고 G0 재실시. MVP 실사용 시작을 미룬다. 다른 마일스톤은 계속 |
| F23-5 | G1 일부 미통과 또는 실패 | §3.5.6 |
| F23-6 | G1 창 중 MVP 치명 결함(데이터 손실, 권리 게이트 우회 등) | 즉시 수정·배포한다. 결함 때문에 측정값이 크게 달라졌으면 사람이 G1 창을 다시 시작할지 정하고 관문 기록 Concern에 남긴다 |
| F23-7 | 26이 늦음 | M17을 건너뛰고 M18·M19를 먼저 한다. 공유 패키지는 플랫폼 중립으로 유지한다 |
| F23-8 | 갈래 병합 충돌(공유 파일: `pnpm-lock.yaml`, `.just/helm.just`, 등록 표, `architecture-rules.ts`) | 공유 파일은 작은 커밋으로 고친다. 잠금 파일은 병합 뒤 `just setup`으로 다시 만든다. 등록 표 충돌은 소유 문서 순서를 따른다 |
| F23-9 | 테스트 ID가 문서끼리 겹침(07 V1~V11과 01 가설 V1~V9, 07 C1~C24와 14 C-1~C-24, 12 T-SC와 13 T-SC) | 22의 추적 ID(`<문서 번호>/<ID>`)로 구분한다(§3.1.3-6, 22 §3.4.3). 문서의 ID를 바꾸지 않는다 |
| F23-10 | 사람 작업이 늦음(예: HT-05 bubblewrap) | 그 작업을 막는 행만 기다린다. M6-10은 S1b 경로 시험을 먼저 끝내고 S1 시험은 종료 코드 2로 보고한다 |
| F23-11 | 실제 모델 비용이 월 상한에 가까움 | 12 예산 집행(80% 알림, 100% 새 실행 중단)을 따른다. `eval-inquiry`·`ai-smoke`는 사람이 다시 돌릴지 정한다 |
| F23-12 | 구현 중 pi 새 판이 나옴 | `v1.1.0` 고정을 유지한다. 업그레이드는 MVP 완료 뒤 07 §3.18.4 절차로 한다 |
| F23-13 | 작업 공간 파일이 Syncthing으로 바뀜(Mac에서 동시에 편집) | 구현은 서버에서만 한다. Mac 레시피는 빌드만 한다. worktree는 저장소 안 `.worktrees/`에 두고 Git·동기화 제외를 요청한다(§7 T-1) |
| F23-14 | 운영 데몬과 개발 데몬 혼동 | 17 대로 데이터·소켓·포트가 다르다(개발 7851, `/srv/volumes/helm/dev`). 운영 데몬 갱신은 `daemon-upgrade`로만 |
| F23-15 | 이 문서의 규모 추정이 크게 틀림 | M3 끝에서 실제 줄 수로 남은 마일스톤 규모를 다시 어림하고 §3.3.2를 고친다(보완 변경) |
| F23-16 | 실작업자 두 명이 같은 파일을 고쳐 갈래 브랜치 병합이 충돌함 | 하위 조정자가 분할을 다시 하고(§3.1.2) 한쪽을 다시 배정한다. 공유 파일(등록 표, `.just/helm.just`, `architecture-rules.ts`)은 한 작업에만 맡긴다 |
| F23-17 | 등급이 실제 난이도와 다름(Haiku 작업이 반복 실패, Opus가 필요한 판단이 나옴) | 하위 조정자가 그 행의 등급을 올리고 다시 배정한다. 같은 일이 두 번 나오면 §3.1.2 기준표 수정을 1단계에 올린다 |

## 5. 다른 문서와의 인터페이스

### 5.1 이 문서가 제공하는 것

| 받는 문서 | 제공 |
|---|---|
| 22 | 마일스톤별 완료 조건이 인용하는 테스트 ID(§3.4), 하네스·대본을 만드는 시점(M0-12 골격·색인, M7-17 `kernel` 모드, M8-12 `runtime` 모드, M11-05 `protocol` 모드, M12-09 뷰 표본, M12-10 `view` 단계, M15-01 전체), 하네스 전제 API의 WBS(M2-04 `openStore` 시험 옵션·오류 주입, M1-07 `semanticFields`, M4-05 `@helm/engine/testing`, M6-07 `FakeToolExecutor`, M7-17 `whenIdle`, M7-05·M11-02 종료 지점), 장애 주입·E2E·성능의 위치(M15-02~04), 레시피 도입 시점(§3.10), 마일스톤 관문(§3.1.3-13), 추적 판정 방식(ADR-23-09), 야간 `test-deep` 시점(§3.10) |
| 06 | 저장소 골격 작업(M0), CI 범위(D23-7), `FeatureKey` 첫 목록과 단계별 기본값(§3.5.4), 레시피 도입 시점(§3.10), 공유 패키지 추가 목록(M0-05) |
| 01, 16 | 관문 일정과 활성화 단계(§3.5), G1 창 갱신 규칙(§3.5.3), 관문 기록 Concern(§3.5.3) |
| 15 | G0 위치와 처리(§3.5.2) |
| 19 | 19 §5.2 "23"의 "M1에서 등록 표·가짜 데몬·적합성 스위트 먼저"는 이 계획의 M10(도메인 M1 바로 뒤에 시작하는 proto 갈래)이다. 데몬 프로토콜 계층(M11-05)과 앱(M13b)은 그 위에 붙는다 |
| 13 | 외부 런타임 어댑터 순서(§3.4.21, 13 O-13-12의 답) |
| 07 | 도입 단계 확정: 1차 = M5·M6, REPL = M16-11, MCP·어댑터 = 이후(§3.4.21) |
| 24 | ADR 후보 ADR-23-01~09(이 문서 끝. 07은 폐기) |
| 25 | 용어: 증거 관문(G0·G1·G2), 활성화 단계(A2·A3), 관문 기록 Concern, G1 창, 갈래, 스파이크, 임계 경로, 작업 분해(WBS) |
| 26 | M17 표(이 문서 §3.4.18, 26 §6.1·§6.2를 WBS로 옮김), 결정 47~49 반영, 실기기 확인 시점(A2), 상위 스위치 `clients.mobile`, 사람 작업 HT-21·HT-25 |
| 모든 문서 | WBS ID. 각 문서 §6의 단위가 어느 WBS 행에 있는지(§6.1) |

### 5.2 다른 문서에 요구하는 것

| 문서 | 요구 |
|---|---|
| 01 | (1) §3.8.4 G0의 "원함 탐구를 커널에 정식 연결하기 전"을 한 번에 구현하는 경우 "MVP 실사용 시작 전"으로 읽는다는 문장을 더한다(D23-4, 15와 함께). (2) §3.8.2 "웹 페이지 읽기 ◐"와 13 O-13-05(1차 웹 도구 제외)를 HD-3 답으로 맞춘다. (3) §3.8.2 `send` 2단계 ●(메일 등)은 13·18에 도구 명세가 없으므로 "이후"로 옮기거나 13·18에 명세를 요구한다(§3.4.21). (4) 2단계 기능의 `FeatureKey` 목록과 단계를 이 문서 §3.5.4 표(01 §3.8.2 행 대응 열 포함)와 하나로 맞춘다 |
| 04 | (1) `data` 타입이 없는 뷰 6개(`concernTree`, `thread`, `goals`, `devices`, `records`, `settings`)의 View 타입을 둔다(M12-04·05·07). (2) 복귀 점검을 "MVP, G1 기간에만 켬(02 UQ-05)", 빈도 "복귀당 1회, 주 2회까지"로(M14-07) |
| 03·05·20 | §6 표에 ID 열을 둔다(22가 인용한 `UT-*`). 20은 22가 행 순서로 매긴 번호를 받을지 정한다 |
| 06 | (1) §3.16 레시피 색인에 `docs-check`, `daemon-export`, `eval-inquiry`, `lens-seed`, `ui-tokens`, `ui-storybook`, `ui-check`, `ui-test`, `ui-visual`, `ui-visual-update`, `shot-mac`, 22의 `test-*` 묶음, 26의 `mobile-*` 묶음을 더하고 `_verify-steps` 구성을 §3.10과 맞춘다(22 §5.2 "06"(2), 26 §5.2 "06"(4)와 같은 요구). (2) §3.10.3 `FeatureKey` 첫 목록을 §3.5.4로 하고, 관문 기록 확인 방법(§3.5.3)을 규칙 (2)에 적는다(O-15의 답: 경고만 유지). (3) §2.5의 "새 CI 여부는 23에서 정한다"를 D23-7로 갱신. (4) §3.15 트리에 `tests/`(`@helm/tests`, 22), `experiments/design-prototypes/`, `docs/specs/spikes/`, `docs/specs/implementation-status.md`, `.worktrees/`(Git 제외). (5) `@helm/store` 하위 경로 표(§3.3.1 행)에 `aux`를 더한다(§3.4.5에는 있음). (6) 의존 허용 표에 `daemon` → `web-push`(정확한 판 고정, `daemon/push`만)와 `@helm/tests`(시험 전용 층)를 넣는다(22). (7) `RuntimeStorePort`(판정 J-127)의 위치와 `@helm/kernel/orchestration`에 "I/O 없는 함수만"(판정 J-128)을 적는다. (8) 관찰 `llm.complete` 처리 경로와 지표 소비자 위치를 12와 하나로 |
| 07 | (1) §3.2 "도입 단계는 23이 확정한다"에 이 문서의 결정(1차 = M5·M6, REPL = M16-11 2단계 플래그, MCP·pi RPC 어댑터 = 이후)을 반영. |
| 08 | (1) `FeatureKey`·`FEATURE_TABLE` 타입을 08의 타입 목록에 넣는다(06 §3.10.3이 `@helm/domain` 데이터 표로 둠). (2) 관문 기록 Concern의 표식(예: Concern의 `evaluationGate: "G1" \| "G2"`)을 정한다(§3.5.3) |
| 09 | (1) `daemon.booted` payload에 릴리스 ID가 있는지 확인(G1 창 갱신 기록, §3.5.3). (2) 엔진 시작 적재 알고리즘: `KernelState` 스냅숏 직렬화 형식, `state_hash` 대상, 저장 주기, 지시 재계산 커서 `consumer_cursors.directives`를 올리는 시점과 중복 제거를 의사코드로(10과 함께, M4-06). (3) `openStore` 시험 옵션·SQLite 오류 주입·`EVENT_META.semanticFields`를 §3에 적는다(M2-04·M1-07). (4) 무효화 태그는 09 `event_invalidations` 저장 + 12 `aggregateTags`로 정한 이 계획의 처리(M12-01)와 맞춘다. (5) 푸시 운영 테이블 하나, 이벤트 셋, 타이머 목적 둘을 26 §3.4.6 기준으로(M17-02, J-71) |
| 10 | 엔진 시작 적재와 지시 재계산 커서(09와 함께, M4-06) |
| 12 | (1) §3.1 배치도의 `packages/agent/src/loop.ts`를 07 §3.3 배치로(07 §5.2와 같음). (2) 무효화 태그 순수 함수 `aggregateTags`와 집계 태그 표를 12 한 곳에 두고 커밋 트랜잭션 안에서 계산해 09에 저장한다(M12-01). (3) `@helm/runtime/testing`의 `whenIdle()`를 §3에 적는다(M7-17). (4) 지표 소비자 위치: 이 계획은 16 §6.1대로 `daemon/src/consumers/metrics.ts`로 둔다(M14-05). 12 §3.5.11의 runtime 배치와 관찰 `llm.complete` 처리 경로를 06과 함께 하나로. (5) 런타임은 `RuntimeStorePort`로만 정본을 읽는다(판정 J-127, M4-07). (6) 월 비용 상한 키를 06의 `budget.monthlyCapUsd`로(§5.2의 `budget.monthlyUsd`) |
| 13 | (1) HD-3 답에 따라 `web_fetch`(읽기 전용)를 1차 도구 표와 §6에 넣는다(18 T18-27의 규칙과 같이). (2) O-13-12의 답(외부 어댑터 순서: pi RPC → Claude Code → Codex → ACP)을 반영. (3) `FakeToolExecutor`를 §3에 적는다(M6-07). (4) S1b를 허용 목록 방식으로 바꾸고 user unit 동작을 [실험]으로 확인한다. 안 되면 S1b를 별도 보장 수준으로 낮춘다(18과 함께, SP-04). (5) 네트워크 허용 실행의 네트워크 네임스페이스와 CONNECT 프록시 명세(판정 J-134, M6-16, SP-16) |
| 14 | (1) §6.2 머리말의 재생 테스트 "메모리 SQLite"를 임시 디렉터리의 실제 파일로(09 §6.2 공통 기준). 22 §5.2 "14"와 같다. (2) §3.15 단계 표에 `deliberate` 모드가 어느 단계인지 적는다(이 계획은 I.possibility와 함께 2단계, §3.5.4). (3) `features` 단계별 기본값을 §3.5.4와 맞춘다 |
| 15 | (1) §3.15.2 판정 표의 "커널의 E/N 정식 연결을 미루고"를 한 번에 구현하는 경우 "MVP 실사용 시작을 미루고"로 읽는다는 문장을 더한다(D23-4). (2) E0의 `auto` 지표 계산식과 "의미 있음" 판정 예시. (3) 순수부 파일 위치를 `@helm/kernel/orchestration/inquiry`로(판정 J-128, M9a) |
| 16 | (1) 관문 기록 Concern("Helm 사용 평가")을 누가 만드는지 정한다: 이 계획은 M15-08에서 사람이 관리 CLI로 만들고 T6 보고가 거기 붙는 것으로 둔다. (2) T6의 기준일("첫 사용일부터 14일마다")을 MVP 완료일(M15-09)로 정한다. (3) §3.27.6 `biasNotes`에 G1 창 갱신 기록(§3.5.3-3)을 넣는다. (4) 지표 소비자 위치(`daemon/src/consumers/metrics.ts`)를 12·06과 하나로. (5) 복귀 점검 빈도 "복귀당 1회, 주 2회까지"를 04와 하나로 |
| 17 | (1) `daemon-upgrade`가 끝날 때 릴리스 ID를 관문 기록 Concern에 관찰로 남기는 안내 또는 자동 기록(§3.5.3). (2) `.worktrees/`의 Syncthing 제외는 사람에게 요청(§7 T-1). (3) CLI 종료 코드 표(데몬 연결 실패가 1인지 2인지 포함, M11-10). (4) 설정 스키마에 `budget` 절과 키 이름 하나(06의 `budget.monthlyCapUsd`), `daemon-install`의 상한 질문 단계(HT-13). (5) H-2 전 `/mnt/d/backup/helm/` 복사 레시피(판정 J-146, M11-11) |
| 18 | (1) S1b 허용 목록 방식과 보호 경로 표에 자격 파일(`~/.config/gh`, `~/.git-credentials`, `~/.npmrc`, `~/.docker`, `~/.netrc`, `~/.aws`, `~/.kube`)과 `~/data`·`~/vault` 추가, T18-10 확장(13과 함께). (2) J-135의 localAdmin 규칙을 §3.5에 반영(M11-10이 따름). (3) J-118대로 Q18-09·Q18-10을 26에 맞춘다 |
| 19 | (1) Q-16(브라우저 전송 토큰)·Q-18(외부 푸시 제공자)을 26의 결정에 맞춘다(J-118). (2) §3.6.3의 "보낼 때 계산하고 저장하지 않는다"를 09 저장 태그를 보내는 방식으로(M12-01). (3) 푸시 메서드 `device.registerPush`(params `contentLevel`·`minUrgency`·`vapidKeyId`)·`device.pushConfig`·`device.testPush`(M17-02) |
| 20 | 20 §5.2 "22·23·24"의 앱 구현 순서는 M13b~M13d에 그대로 받았다. 남은 요구 없음(브라우저 설치는 22 §5.2 "06"(4)대로 `just setup`) |
| 21 | (1) §6.3 성능 행(유리 크롬 아래 프레임 시간)은 서버 Playwright 기준이다. 실제 WKWebView·WebView2에서 같은 장면을 재는 항목(Safari 웹 검사기, WebView2 DevTools)을 둔다(SP-09). (2) `ui-visual`을 `just verify`에 넣지 않고 UI를 바꾼 작업의 완료 조건에 넣는 것(§3.10, 22 D22-11)을 §6.4에 반영. (3) §6.2 U4·U5·U8에 단위가 없던 부품 9개(`ChoiceImpactEcho`, `SemanticPreview` → U4, `GoalSummary`, `DegradedBanner`, `AgentActivityIndicator`, `ToolActivityLine`, `MaterialChangeGroups` → U5, `LoopPlanStrip`, `LoopPathMini` → U8)를 넣는다(이 계획 M13a-04·05·08과 같게). (4) §6 표에 ID 열(22가 인용한 `21/TK-*`·`21/U*`)을 둔다 |
| 22 | (1) 하네스 도입 순서(M7-17 `kernel` 모드, M11-05 `protocol` 모드, M12-09·M12-10)와 `done.ts` 판정(ADR-23-09)은 22 §3.8.2·§3.17.1과 맞췄다. 22 색인의 마일스톤 칸에는 이 문서 §6.1의 WBS ID를 쓴다. (2) §3.15.3에 `test-all`이 M0-12부터 있는 하위 레시피만 모아 돈다는 점, `bench`가 M2-10에서, `perf`가 M11-13에서 시작한다는 점을 적는다. (3) 야간 `test-deep` 타이머는 M11-12 뒤에 켠다(Q22-04의 답). (4) 20·21·03·04·05의 UT·TK ID를 원 문서가 두지 않으면 22가 `UT-nn` 규칙으로 정한다 |
| 24 | (1) ADR 후보 ADR-23-01~09를 §8로 옮긴다(07은 폐기 상태로). (2) 결정 51의 ADR(ADR-00-51)을 둔다. 구현 중 설계 변경은 1단계 메인 오케스트레이터가 판정하고 ADR을 쓴다는 이 계획 §3.9.2를 결과에 적는다. 4단계 전 판의 "구현 에이전트가 24를 직접 고친다" 요구는 철회한다 |
| 25 | 용어 등록: 증거 관문 G0·G1·G2, 활성화 단계 A2·A3, G1 창, 관문 기록 Concern, 갈래, 스파이크, 임계 경로, WBS, 난이도 등급, 메인 오케스트레이터·하위 조정자·실작업자(결정 51), 중간 병합 지점. 테스트 ID 체계의 표기(22와 함께). 모델 API를 내는 쪽은 본문 "제공자"(판정 J-150, 이 문서는 따름) |
| 26 | (1) M17 표(이 문서 §3.4.18)가 26 §6을 빠짐없이 옮겼는지 확인. (2) 실기기 확인(§6.2 M-01~M-12)은 운영 데몬에서 2단계 활성화(A2) 때 한다는 이 계획의 처리를 §3.6.3에 반영. (3) `clients.mobile`을 상위 스위치로 두고 `push.enabled`는 그 아래로, `fail_count` 문턱·429 처리·재시도 영속 여부를 정한다. (4) 결정 47~49 반영(최소 iOS 26, 알림 `interrupt`·`notice`, Android 문장 삭제, U-2~U-5 해소) |
| 홈랩 | 판정 §5와 17 §3.7.4의 H-1~H-5. 이 문서는 시점만 정한다(HT-09~HT-11) |

## 6. 구현 단위와 완료 기준

이 문서는 계획 문서라 직접 구현하는 모듈이 없다. 대신 각 문서 §6의 구현 단위가 빠짐없이 WBS에 들어갔는지를 추적표로 확인하고, 이 문서 자체의 완료 기준을 둔다.

### 6.1 문서 §6 단위 → WBS 추적표

| 문서 | §6의 단위 | WBS |
|---|---|---|
| 01 | 진입 판정 규칙, 승격 신호 감지 | M8-05 |
| 01 | 사람 조작 기록 | M3-06(`humanOps`), M1-03(명령 이벤트 필드) |
| 01 | C/A·범주 지표 리포트 | M14-04 |
| 01 | 비기능 요구 측정 | M11-13, M15-04 |
| 01 | 데이터 손실 | M15-02 |
| 01 | MVP 완료 | M15 |
| 02 | 유즈케이스 대본, 수용 기준 추적표 | M8-12, M9b-03, M15-01 |
| 02 | 장애 주입, E2E, 실사용 기록, 사람 조작 검사 | M15-02, M15-03, M15-09, M15-01 |
| 03 | 화면 ID·경로 표, 딥 링크 | M13b-08 |
| 03 | 최상위 내비게이션, 셸 영역 | M13c-01 |
| 03 | 상태 라벨 목록 | M10-06 |
| 03 | 표시 번호 | M12-01 |
| 03 | TUI parity 표 | M19-02 |
| 03 | 세 깊이 | M13a-03 |
| 04 | 공통 상태 표시, 명령 의도 공통 | M13c-01, M13b-04 |
| 04·19 | 뷰 26개(`observerProposals`는 M16-09) | M12-02~M12-07, M14-08, M16-09 |
| 04 | `SCR-HOME`, `SCR-BRIEF` | M13c-03 |
| 04 | `SCR-QUESTION`, `SCR-AUTO`, `SCR-AGREE`, `SCR-REVIEW` | M13c-02 |
| 04 | `SCR-STIM` | M13c-05 |
| 04 | `SCR-EVIDENCE` | M13c-04 |
| 04 | `SCR-DIALS`, `SCR-CONNECT`, `SCR-RECOVERY` | M13c-06 |
| 04 | 화면별 선형 텍스트 | M13a-03(21 UI-D08), M19-03 |
| 05 | 공유 문구 목록, 금지 표현 검사, 조사 처리, 오류 문구 | M10-06 |
| 05 | 질문 응답, 자극 반응, 이의 걸기, 의미 미리보기 | M13c-02, M13c-05, M13c-07 |
| 05 | 알림, 단축키 | M13b-01, M13d-01 |
| 05 | 접근성 | M13a(21 §6.3 접근성 시험) |
| 06 | S0, S1, S2 | M0-01~M0-05·M0-09·M0-10, M0-06, M0-07 |
| 06 | S3 | M11-01 |
| 06 | S4 | M4-01~M4-05 |
| 06·12 | `RuntimeStorePort`(판정 J-127) | M1-11, M4-07 |
| 09·10 | 엔진 시작 적재·지시 재계산 커서 | M4-06 |
| 13·18 | 네트워크 허용 실행(판정 J-134) | M6-16, M11-07 |
| 06 | S5, S6 | M11-04·M11-05, M11-06 |
| 06 | S7 | M11-08 |
| 06 | S8 | M11-10 |
| 06 | S9 | M7-14 |
| 07 | V1, V2, V3, V7, V8 | M5-01, M5-02, M5-03, M5-04, M5-05 |
| 07 | V4, V5, V6 | M6-01, M6-08·M6-09, M6-05 |
| 07 | V9 | M16-11 |
| 07 | V10, V11 | 범위 밖(§3.4.21) |
| 08 | `ids`·`time`·`actor`·`capability`·`capability-table` | M1-01 |
| 08 | `schema`·`quality`·`autonomy`·`triggers`·`material`·`link`·`rejection` | M1-02 |
| 08 | `records/*` | M1-03 |
| 08 | `loop` | M1-04 |
| 08 | `machines/*` | M1-05 |
| 08 | `rules/*` | M1-06 |
| 08 | `index`, 공통 기준 | M1-10 |
| 09 | §6.1 `events/*` | M1-07 |
| 09 | §6.2 `paths`·`lock`·`open` / `migrations` / `boot` / `commit` / `hash`·`integrity` / `projectors`·`rebuild` / `query` / `blobs`·`retention` / `backup`·`restore`·`export` / `bench` | M2-01 / M2-02 / M2-03 / M2-04 / M2-05 / M2-06 / M2-07 / M2-08 / M2-09 / M2-10 |
| 10 | §6.1 파일 구성, §6.2 표 전부 | M3-01~M3-11 |
| 11 | §6.1 `asking/*`, `commands/question.ts`, 대본 | M3-06, M3-07(런타임 쪽은 M8-10) |
| 12 | U-AI-1, U-AI-2, U-AI-3 | M6-02, M6-03, M6-04 |
| 12 | U-AG-1 | M5-02(vendor 계약), M6-05 |
| 12 | U-RT-1 ~ U-RT-12 | M7-01, M7-02, M7-03, M7-04, M7-05, M7-06(U-RT-6·7), M7-07, M7-08, M7-09, M7-10, M7-11 |
| 12 | U-RT-13 수명주기, U-RT-14 전달기·스트림, U-RT-15 탐구 run | M7-16, M8-10·M12-08, M9b-01 |
| 12 | 통합 시나리오 | M7-15 |
| 13 | U-TL-1, U-TL-2, U-TL-3, U-TL-4, U-TL-5~7 | M6-07, M6-08, M6-09, M6-10, M6-11 |
| 13 | U-TL-8, U-TL-10, U-AD-1 | M7-12, M7-13, M7-14 |
| 13 | U-TL-9 | M1-09 |
| 13 | U-TL-11 | M16-11 |
| 13 | U-TL-12 | 범위 밖(§3.4.21) |
| 13 | U-TL-13 | M6-12 |
| 13 | U-TL-14 격리 운영 | M6-15 |
| 14 | C-1~C-15, C-19, C-22, C-24 | M8-01~M8-08 |
| 14 | C-16~C-18 | M8-12 |
| 14 | C-20, C-21, C-23 | M8-09 |
| 15 | T-01~T-15, T-21~T-24, T-26~T-29 | M9a-01~M9a-08, M9b-01 |
| 15 | T-16~T-20, T-25 | M16-01, M16-02, M16-11 |
| 16 | OB-T01~T04, T06~T15, T20~T31 | M14-01~M14-08, M11-08 |
| 16 | OB-T05, OB-T16~T19 | M16-09 |
| 16 | 데몬 쪽 감독기, 지표 소비자(`daemon/src/consumers/metrics.ts`) | M11-08, M14-05 |
| 17 | §6.1 모듈, §6.2 T17-01~33 | M11-01~M11-12 |
| 18 | §6 위치, §3.17 T18-01~33 | M11-03·M11-04·M11-07·M11-10, M6-10·M6-12·M6-14, M11-11(시스템), M17-02(T18-31), M13c(T18-32) |
| 19 | §6.1 `@helm/protocol` | M10-01~M10-04 |
| 19 | §6.2 `@helm/client` | M10-05 |
| 19 | §6.2 데몬 프로토콜 계층 | M11-05 |
| 19 | §6.3 적합성 시나리오(CT-01~35) | M10-04(가짜 데몬), M11-05·M11-06(실제 데몬) |
| 19 | §6.4 성능 | M11-13, M15-04 |
| 20 | §6.1 표 | M13b-01~M13b-09, M13d-01~M13d-04 |
| 20 | §6.2 수동 체크리스트 | M13d-02, M13d-03 |
| 21 | U1~U9(단위가 없던 부품 9개는 M13a-04·05·08) | M13a-01~M13a-09 |
| 22 | U22-1 testkit, U22-3 공통 준비, U22-7 추적 검사, U22-15 정적 검사 | M0-08, M0-12 |
| 22 | U22-2 모델 테이프 | M6-06 |
| 22 | U22-4 하네스, U22-5 장애 공통 검사, U22-11 비밀 카나리아 | M7-17(`kernel` 모드), M8-12(`runtime` 모드), M11-05(`protocol` 모드), M12-10(`view` 단계) |
| 22 | U22-6 종료 지점 | M7-05, M11-02, M15-02 |
| 22 | U22-8 대본 | M7-17, M8-12, M9b-03, M11-05, M15-01 |
| 22 | 하네스 전제 API(`openStore` 시험 옵션, 오류 주입, `semanticFields`, `@helm/engine/testing`, `FakeToolExecutor`, `whenIdle`), 앱 뷰 표본 | M2-04, M1-07, M4-05, M6-07, M7-17, M12-09 |
| 22 | U22-9 적합성 | M7-14(CF-04), M10-04·M11-05(CF-01·03·05), M11-06(CF-02) |
| 22 | U22-10 장애 시나리오 | M15-02 |
| 22 | U22-12 시각 기준 관리 | M13a-09 |
| 22 | U22-13 성능 | M11-13, M15-04 |
| 22 | U22-14 레시피 | §3.10의 도입 행 |
| 26 | §6.1 정적 서빙·쿠키 인증(T26-01~10) | M17-01 |
| 26 | §6.1 푸시 등록·payload·대상 계산·송신·11 수정(T26-11~18) | M17-02 |
| 26 | §6.1 서비스 워커·수명주기·결정 가능 판정·화면·갱신(T26-19~27) | M17-03 |
| 26 | §6.2 실기기 체크리스트(M-01~M-12) | M17-04 |

### 6.2 이 문서의 완료 기준

1. 위 추적표에서 각 문서 §6의 모든 단위가 WBS 행 하나 이상 또는 "범위 밖" 표시를 가진다.
2. 모든 WBS 행에 근거 절과 완료 조건이 있다. 완료 조건은 테스트 ID, 레시피, 수동 확인 중 하나 이상이다.
3. 모든 사람 작업(HT)에 확인 방법이 있다.
4. 22(T1) 초안의 레시피·추적 ID·하네스 위치는 반영했다(§3.1.3-6, §3.1.3-13, §3.10). 2b단계 뒤 교차 확인에서 남은 차이(§5.2 22 요구)를 정리한다.
5. 26 1판의 §6을 M17에 옮겼다. 26이 바뀌면 M17을 다시 맞춘다.
6. 3단계 검증에서 나온 지적을 반영한다.

## 7. 미결 사항

| ID | 질문 | 선택지 | 추천 기본값 |
|---|---|---|---|
| T-1 | 갈래 worktree의 위치와 동기화 | (a) 저장소 안 `.worktrees/`(Git 제외, Syncthing 제외 요청) (b) `/tmp` 아래 (c) 별도 클론 | (a). `.gitignore`에 더하고, dotfiles `.stignore-dev`에 `.worktrees`를 더할지 사람에게 묻는다(HT-14와 함께) |
| T-2 | G1 창 동안 2단계·3단계 코드(기본 꺼짐)를 운영 데몬에 넣을지 | (a) §3.5.3 규칙으로 허용 (b) G1 창 동안 결함 수정만 | (a). 꺼진 코드도 측정 조건을 바꿀 위험이 있으므로 주 1회로 묶고 기록한다. G1 판단이 흐려졌다고 사람이 보면 (b)로 바꾼다 |
| T-3 | 관문 기록을 데몬이 알아보는 표식 | (a) Concern의 관문 표식 필드 (b) 별도 레코드 (c) 설정 파일의 날짜 | (a). 08·16이 정한다(§5.2) |
| T-4 | TUI에 기능 플래그를 둘지 | (a) 두지 않음, 설치는 `just tui` (b) `clients.tui` 플래그 | (a). TUI는 데몬 동작을 바꾸지 않는다 |
| T-5 | `ui-visual`을 `just verify`에 넣을지 | (a) 넣지 않고 UI 작업의 완료 조건에 넣음 (b) 넣음 | (a). 시간이 오래 걸리고 기준 이미지 갱신에 사람 검토가 필요하다 |
| T-6 | 동시에 여는 갈래 수와 작업자 수 | 갈래 2 / 3~4 / 5 이상, 조정자당 작업자 2~4 | 갈래 3~4(하위 조정자 4명 이하), 조정자당 작업자 3명 이하(§3.1.1 동시 실행 예산). 병합 확인 부담을 보고 조정한다 |
| T-11 | 등급 기준(§3.1.2)의 보정 | 지금 기준 유지 / M1 끝에서 재보정 | M1·M3 끝에서 실제 재배정 횟수(F23-17)를 보고 기준표를 고친다 |
| T-7 | 진행 기록 위치 | (a) `docs/specs/implementation-status.md` (b) GitHub Issues (c) 별도 트래커 | (a). 저장소 안 개발 문서(사용자 규칙: 개발 문서는 md, 저장소 `docs/`) |
| T-8 | M17(모바일)을 M16보다 먼저 할지 | (a) M16 뒤 (b) 26이 나오는 대로 M16과 병렬 | (b)를 허용한다. M17은 별도 갈래이고 서버 쪽 변경이 작다 |
| T-9 | `send` 확장을 이번 범위에 넣을지 | (a) 이후 (b) 13·18 명세를 받아 M16에 | (a). 명세가 생기면 (b) |
| T-10 | 규모 추정 | 지금 값 / M3 뒤 재어림 | M3 끝에서 다시 어림한다(F23-15) |

## 8. 출처

- 설계 문서: `docs/design/01`~`21`, `24`(2026-10-12 2a 진행 중 판). 특히 01 §3.8, 각 문서 §5·§6·§7.
- `docs/design/process/00-design-brief.md`(전체), `docs/design/process/rulings-stage2a.md`(J-01~J-55, §5 사람 작업), `docs/design/process/design-log.md`.
- 조정자 작업 자료: `.helm-design-work/coordinator/{pending-launch.md, 2a-common.txt, stage2-and-3-templates.md}`.
- 설계 시제품과 메모: `.helm-design-work/P4/{README.md, fork-proto/}`(vendor 시제품 [실험]), `.helm-design-work/P7/exp-bwrap*.{sh,out.txt}`([실험]), `.helm-design-work/P11/notes.md`(서버 사실 [실험]), `.helm-design-work/P13/notes.md`(앱 의존 판 [실험]).
- 사용자 관례: `~/.claude/CLAUDE.md`, `~/.claude/skills/projects/SKILL.md`, `~/.dotfiles/templates/{just/core.just, just/node.just, project/node-24/, project/generic/AGENTS.md, product/PRODUCT.md}` [원문].
- 서버 확인(2026-10-12) [실험]: `which`로 본 도구 판(Node 24.19.0, pnpm 11.21.0, just 1.58.0, gitleaks 8.30.1, lefthook 2.1.16, gh 2.102.0), bwrap·cargo 없음, `~/projects/helm`에 `code/`만 있음, `secrets --help`.
- 대화 발췌: X3-8-28(구현 순서 제안, 14 §3.15 인용), X3-4-11(한 turn 흐름, 12 §6 인용).

## ADR 후보

### ADR-23-01 증거 관문을 활성화 단계로 지키고 G1 창의 갱신 규칙을 둔다
- 상태: 제안 · 날짜: 2026-10-12 · 결정자: T2 · 출처: 판정 J-11, 01 ADR 후보 P1-5
- 맥락: 한 번에 구현하면서도 단계 사이의 사람 증거(G1·G2)를 지켜야 한다.
- 결정: 구현은 M19까지 계속하고, 2단계·3단계 기능은 기본 꺼짐으로 둔다. G1·G2 기록 뒤 활성화 단계 A2·A3에서 켠다. G1 창 동안 운영 데몬 갱신은 MVP 결함 수정과 꺼진 코드만 허용하고 갱신마다 릴리스 ID를 관문 기록 Concern에 남긴다.
- 근거: 기능을 켜는 순서를 나눠야 MVP 기능의 효과를 따로 볼 수 있다. 꺼진 코드라도 갱신 기록이 있으면 측정 해석이 가능하다.
- 기각한 대안: (a) G1까지 구현을 멈춤: 브리프 §1과 어긋난다. (b) 갱신 제한 없음: G1 측정 조건이 바뀌어도 알 수 없다.
- 결과: 06의 `features`와 `FEATURE_TABLE`, 16의 2주 평가 보고, 17의 갱신 안내가 이 규칙을 받는다.
- 평가: ① A12(자동화가 이해를 낮추면 실패. 관문은 그 측정을 기능 활성화 앞에 둔다) ② N(관문 판단) ③ 정본(관문 기록 Concern) ④ 관문 기록 Concern의 결과 확인 ⑤ 높인다(무엇이 효과를 냈는지 구분) ⑥ 2단계 기능을 MVP 검증 뒤에 쓰게 한다 ⑦ 해당 없음 ⑧ 유지된다
- 관련 문서: 01 §3.8.4, 06 §3.10.3, 14 §3.15, 16 §3.27.6, 이 문서 §3.5

### ADR-23-02 G0를 MVP 실사용 시작 조건으로 둔다
- 상태: 제안 · 날짜: 2026-10-12 · 결정자: T2 · 출처: 15 §3.15.2, 01 §3.8.4
- 맥락: G0은 원래 "탐구를 커널에 정식 연결하기 전"이다. 한 번에 구현하면 연결 코드는 미리 생긴다.
- 결정: 탐구 엔진 순수 부분과 평가 하네스(M9a)를 런타임보다 먼저 만들어 G0을 일찍 돌리고, MVP 실사용 시작(M15-08)을 G0 기록 뒤로 둔다.
- 근거: 엔진이 `KernelPort`만 보므로 메모리 커널로 평가할 수 있다(15 D15-9). 실사용 전에 발산 설계를 고칠 기회가 생긴다.
- 기각한 대안: (a) 연결 코드를 G0 뒤로 미룸: 한 번에 구현과 어긋나고 M9b가 늦어진다. (b) G0 생략: v0.2의 증거 없는 구현 반복(EV-8).
- 결과: M9a가 M9b보다 앞서고, 15·01의 G0 문장이 바뀐다.
- 평가: ① A3(문제 정의는 작업 결과의 일부. G0은 목표·기준이 바뀌는지 본다) ② E·N ③ 평가 기록(정본 밖, 뒤에 관찰로 기록) ④ 해당 없음 ⑤ 높인다 ⑥ 사람의 평가 시간을 실사용 전에 쓴다 ⑦ 해당 없음 ⑧ 실제 모델 결과에 기대므로 모델이 바뀌면 다시 한다
- 관련 문서: 15 §3.15.2, 01 §3.8.4, 이 문서 §3.5.2

### ADR-23-03 `just verify`는 서버에서만, GitHub Actions는 Windows 데스크톱 빌드에만
- 상태: 제안 · 날짜: 2026-10-12 · 결정자: T2 · 출처: 06 §2.5, O-11
- 맥락: 기존 `ci.yml`은 범위 밖 패키지를 시험한다. 비밀과 SOPS 키는 서버에 있다.
- 결정: 기존 워크플로를 지우고, `desktop-windows.yml`(수동 실행·태그)만 둔다. 실행은 사람 확인 뒤.
- 근거: 사용자 규칙상 완료 = 서버의 `just verify`. push는 사람 확인이 필요하다.
- 기각한 대안: 모든 push에 CI: 비밀 없이 돌릴 수 있는 범위가 좁고 확인 부담이 늘어난다.
- 결과: 20 SP-08의 대체 경로가 이 워크플로다.
- 평가: ① 해당 없음 ② 해당 없음 ③ 해당 없음 ④ 해당 없음 ⑤ 해당 없음 ⑥ 사람 확인을 Windows 빌드에만 쓴다 ⑦ 해당 없음 ⑧ 해당 없음
- 관련 문서: 06 §2.5, 20 §3.12.4, 이 문서 D23-7

### ADR-23-04 통합 브랜치·갈래 브랜치·작업자 worktree, 중간 병합 지점 묶음 확인
- 상태: 제안 · 날짜: 2026-10-12 · 결정자: T2 · 출처: 사용자 규칙(병합은 확인 뒤), [결정 51]
- 맥락: 여러 갈래와 실작업자가 병렬로 구현하면서 통합 브랜치 병합마다 사용자 확인을 받아야 한다. 갈래를 넘는 선행이 마일스톤 중간에 있다.
- 결정: `impl/helm-v1` 통합 브랜치, 갈래 브랜치 `impl/<갈래>/<마일스톤>`, 실작업자 작업 브랜치 `impl/<갈래>/<WBS ID>`(각자 worktree)를 둔다. 작업 브랜치 → 갈래 브랜치 병합은 하위 조정자가 하고(HD-6), 통합 브랜치 병합은 중간 병합 지점(§3.6.3)과 마일스톤 끝에 1단계가 사용자 확인을 묶어 받는다.
- 근거: 확인 횟수를 줄이면서 갈래를 넘는 선행을 마일스톤 끝까지 기다리지 않게 한다.
- 기각한 대안: (a) 한 브랜치에서 순서대로: 병렬이 안 된다. (b) 마일스톤 끝에만 병합: 갈래를 넘는 선행이 멈춘다. (c) 행마다 병합 확인: 확인 부담이 크다.
- 결과: 갈래가 만나는 작업은 앞 갈래 병합 뒤에 시작한다(§3.1.3-2).
- 평가: ①~④ 해당 없음 ⑤ 해당 없음 ⑥ 사람 확인을 병합 지점에 모은다 ⑦ 브랜치가 남으므로 되돌리기 쉽다 ⑧ 해당 없음
- 관련 문서: 이 문서 §3.1.1, §3.6.3

### ADR-23-05 일괄 구현 범위 밖 항목
- 상태: 제안 · 날짜: 2026-10-12 · 결정자: T2 · 출처: 01 §3.8.1 "이후", 07 §3.2, 13 O-13-12
- 맥락: 브리프 §1의 "한 번에"에 이후 단계까지 넣으면 범위가 정해지지 않는다.
- 결정: 외부 런타임 어댑터, MCP, 이미지 생성 자극, `send` 확장, 자동 업데이트는 이번 구현 밖이다. 어댑터 계약과 적합성 틀은 MVP에 둔다. 어댑터 순서는 pi RPC → Claude Code → Codex → ACP.
- 근거: 01 단계표의 "이후"이거나 명세가 없다. 계약을 먼저 두면 나중에 붙일 수 있다(결정 34).
- 기각한 대안: 모두 포함: 명세 없는 항목을 추측해서 만들게 된다.
- 결과: §3.4.21의 계기가 생기면 마일스톤을 더한다.
- 평가: ① 해당 없음 ② 해당 없음 ③ 어댑터 ④ 해당 없음 ⑤ 해당 없음 ⑥ 해당 없음 ⑦ 해당 없음 ⑧ 어댑터 계약이 벤더 중립을 지킨다
- 관련 문서: 01 §3.8, 07 §3.2, 13 §3.11, 이 문서 §3.4.21

### ADR-23-06 설계 표와 코드 등록 표의 동기화 검사
- 상태: 제안 · 날짜: 2026-10-12 · 결정자: T2 · 출처: 판정 §1(이름 정본)
- 맥락: 이벤트 카탈로그(09 §3.4), 명령 약 100개, 메서드·오류 코드가 설계 표와 코드 양쪽에 있다.
- 결정: `scripts/docs/check-catalog.ts`가 두 목록을 비교하고 `just verify`에 들어간다.
- 근거: 구현 중 이름이 한쪽만 바뀌면 문서를 믿을 수 없게 된다.
- 기각한 대안: (a) 코드를 정본으로 하고 문서 표를 지움: 설계 문서가 구현 전 명세 역할을 잃는다. (b) 검사 없음: 표류를 늦게 안다.
- 결과: 문서 표 형식을 바꾸면 스크립트도 바꾼다.
- 평가: ① 해당 없음(구현 일관성) ② 해당 없음 ③ 정본 이름(09·10·19)과 코드의 일치 ④ 이벤트·명령 이름의 일관성 ⑤ 해당 없음 ⑥ 해당 없음 ⑦ 해당 없음 ⑧ 해당 없음
- 관련 문서: 09 §3.4, 10 §3.11, 19 §3.7.1, 이 문서 §3.9.4

### ADR-23-07 관리 CLI의 사람 결정 명령 제한
- 상태: 폐기 · 날짜: 2026-10-12 · 사유: [판정 J-135]가 정했다(TUI 또는 TTY CLI에서 확인 문자열을 넣은 경우만 사람 결정으로 받고, 비대화 localAdmin은 읽기와 관리만). 18이 반영하고 23은 M11-10에서 따른다.

### ADR-23-08 WBS 난이도 등급과 3단계 배정
- 상태: 제안 · 날짜: 2026-10-12 · 결정자: T2 · 출처: [결정 51]
- 맥락: 결정 51은 구현 에이전트를 3단계로 두고 23이 작업마다 난이도 등급과 담당 단계·모델을 적게 했다.
- 결정: 등급 A(기계적)·B(표준)·C(어려움)·D(판단) 네 단계를 두고, A는 Haiku 5.5 max 실작업자와 Sonnet 5.5 medium 조정자, B는 Sonnet·Sonnet, C는 Sonnet 실작업자와 Opus 5.5 medium 조정자, D는 Opus 5.5 medium 조정자가 직접 한다. 큰 행은 분할 기준(산출 파일 6개, 근거 약 600줄, 패키지 둘, 테스트 ID 10개)으로 나눈다. 설계 변경은 실작업자 → 하위 조정자 → 1단계 순으로 올리고 1단계가 판정한다.
- 근거: 기준표가 있어야 하위 조정자가 같은 방식으로 배정하고, 등급이 틀렸을 때 고칠 기준이 있다.
- 기각한 대안: (a) 행마다 모델을 손으로만 적음: 근거가 없어 다시 배정할 때 기준이 없다. (b) 두 단계(Opus·Sonnet)만: 결정 51과 다르다.
- 결과: 모든 WBS 표에 등급·담당·모델 열이 있다. 재배정이 잦으면 기준표를 고친다(T-11).
- 평가: ①~④ 해당 없음 ⑤ 해당 없음 ⑥ 사람 확인은 1단계로 모은다 ⑦ 해당 없음 ⑧ 특정 모델 이름에 기대므로 모델이 바뀌면 표를 다시 맞춘다
- 관련 문서: 이 문서 §3.1.1, §3.1.2, §3.9.2, 브리프 결정 51

### ADR-23-09 추적 검사를 끝난 WBS 행 집합으로 판정한다
- 상태: 제안 · 날짜: 2026-10-12 · 결정자: T2 · 출처: 22 D22-2
- 맥락: 22 `test-trace`는 색인에 없는 ID를 실패로 본다. 갈래가 병렬이라 "현재 마일스톤 이하" 같은 선형 판정이 맞지 않는다.
- 결정: M0-12에서 추적 색인 전체를 WBS ID와 함께 옮긴다. `tests/trace/done.ts`(끝난 WBS ID 집합)에 든 행의 색인 항목은 테스트가 없으면 실패, 나머지는 경고다. MVP 판정은 끝난 행 집합 기준 MVP 항목 누락 0과 격리 목록 0이다.
- 근거: 마일스톤 중간의 `just verify`가 미래 항목 때문에 실패하지 않고, 끝난 행은 빠짐없이 검사된다.
- 기각한 대안: (a) 마일스톤 끝에 색인을 채움: 중간 테스트 제목의 ID가 색인에 없어 실패한다. (b) 선형 마일스톤 순서: 병렬 갈래와 맞지 않는다.
- 결과: 22 §3.17.1이 `done.ts` 방식을 받아야 한다(§5.2).
- 평가: ①~④ 해당 없음 ⑤ 해당 없음 ⑥ 해당 없음 ⑦ 해당 없음 ⑧ 해당 없음
- 관련 문서: 22 §3.4.3, §3.17, 이 문서 M0-12, §3.1.3-6
