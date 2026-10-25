---
id: review.macos-checklist
layer: meta
domain: review
kind: review
status: draft
depends_on: [product.scope.spec, review.m2-plan, review.fake-only]
binds: []
---

# macOS 확인 목록

## 1. 목적과 읽는 법

- macOS 우선 지원(`product.scope.spec` §4.7, 결정 D-d)의 M2 증거를 한 문서에 모읍니다. 마일스톤 재점검 G4-02의 산출물입니다.
- 확인 수단은 두 가지입니다.
  - CI: `.github/workflows/xeon-macos.yml`. `workflow_dispatch`나 PR 라벨 `ci:macos`로만 돕니다(결정 D1). 러너는 `macos-15`(Apple Silicon)입니다.
  - 실기: 사용자 Mac. Mac은 하루 몇 시간만 켜져 있으므로 `ws mac up`으로 확인하고, 꺼져 있으면 `ws mac queue add`로 넣습니다. 실행은 `ws on --detach mac -- just <레시피>`입니다(mac 스킬).
- 결과 열에는 날짜, 수단(CI 실행 번호 또는 `ws mac jobs <번호>`), 실측 값을 적습니다. 비어 있으면 아직 확인하지 않은 것입니다.

## 2. Mac 실기 환경 (2026-10-25)

사용자가 Mac 부트스트랩을 끝내고 결과를 전했습니다.

| 항목 | 상태 |
|---|---|
| 툴체인 | Rust 1.99.1(`aarch64-apple-darwin`, `x86_64-apple-darwin` 대상 설치), bun 1.4.3(mise) |
| 부트스트랩 | 완료. doctor의 남은 항목: `claude-code` 미설치, agent-kit 스킬 링크 실패, opencloud 미설치(모두 ENV·INFO) |
| GUI 권한 | 화면 기록, 손쉬운 사용 권한 없음. 자동으로 주지 않습니다. WKWebView 스크린샷과 IME 자동 입력이 필요하면 사람이 시스템 설정에서 고릅니다 |
| Docker | 선택. 설치하지 않았습니다(SearXNG 수동 스모크에만 필요) |

## 3. 확인 목록

| # | 항목 | 이어지는 것 | 수단 | 기대 | 결과 |
|---|---|---|---|---|---|
| M-01 | `bun:sqlite`의 FTS5 trigram 탐침, `Database.setCustomSQLite` 경로, `fullfsync`, 세션 잠금 | R2, TC-11, FK-06 | CI `platform-store` 단계, 실기 `just test packages/platform-store` | 시험 통과, 탐침이 FTS5 있음 | |
| M-02 | 한글 NFD 파일 이름과 경로 정규화 | FK-07 | CI `platform-os` 단계 | 시험 통과 | |
| M-03 | Seatbelt 샌드박스에서 작업 폴더 밖 쓰기 거부, 자가 시험 6항목 | M1, FK-01, FK-02, T-02 | CI `platform-sandbox`와 `exit-tests` 단계 | int 시험 통과, 건너뜀 0 | |
| M-04 | 실제 sops로 비밀 관리 명령(E7) | E7, FK-05 | CI `platform-secrets`와 `exit-tests` 단계 | 시험 통과, 건너뜀 0 | |
| M-05 | 키체인 age 키, `reveal`의 `os-auth`(Touch ID·암호) | E7, FK-04, T-06 | 실기만(CI 러너는 사람 인증 불가) | 재인증 성공 뒤에만 값 표시, 취소하면 값 없음 | |
| M-06 | FTS5 검색(cap-knowledge) | FK-06 | CI `cap-knowledge` 단계 | 시험 통과 | |
| M-07 | 사이드카 `aarch64-apple-darwin` 빌드와 크기, 콜드 스타트 | ADR-0012, FK-14 | CI 사이드카 단계, 실기 `just bench` | 빌드 성공, 500 MiB 이하, 콜드 스타트 기록 | |
| M-08 | Tauri 셸 Rust 시험 | E3, FK-15 | CI `desktop-test` 단계 | 시험 통과 | |
| M-09 | 데스크톱 프리뷰 실행: 한 턴, 정상 종료 뒤 사이드카 프로세스 없음 | E2, E3, FK-15 | 실기 `just desktop-run` 뒤 `pgrep xeon` | 종료 10초 뒤 사이드카 0개 | |
| M-10 | WKWebView 렌더링과 입력 | FK-16, T-11 | 실기(화면 기록 권한 필요) | 트랜스크립트, 승인 카드, 설정 화면이 보임 | |
| M-11 | 한글 IME 조합(입력창, 설정 화면) | G2-13, FK-16 | 실기, 사람 입력 | 조합 중 Enter가 전송되지 않음, 글자 깨짐 없음 | |
| M-12 | 데스크톱 첫 실행: 키 등록, 모델 선택, 첫 실행 안내, 외부 바이너리 점검 결과 | D-b, G2-07, G2-08 | 실기 | 깨끗한 상태 디렉터리에서 첫 대화까지 감 | |

## 4. 미결 사항

- [미결] M-05와 M-11은 사람이 직접 해야 합니다. 마감 절차(`review.m2-plan` §11 3번)에서 사용자에게 시간을 요청합니다.
