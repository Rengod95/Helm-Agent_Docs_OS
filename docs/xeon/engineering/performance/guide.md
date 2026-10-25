---
id: eng.performance.guide
layer: eng
domain: performance
kind: guide
status: draft
depends_on: [adr.0012, eng.toolchain.guide]
binds: []
---

# 성능 예산과 측정

## 1. 적용 범위

- 사용자가 체감하는 속도(시작, 첫 응답, 종료)의 예산과 측정 방법을 정합니다. 근거 결정은 ADR-0012(속도를 앱 크기보다 우선)입니다.
- 마일스톤 재점검 G2-04의 산출물입니다. M2는 기준선을 재고 예산표의 틀을 둡니다. M3에서 예산을 넘으면 실패하는 게이트로 바꿉니다(`review.m3-plan`).
- 측정 레시피는 `just bench`(`xeon/scripts/bench.ts`)입니다. `just verify`에는 들어가지 않습니다.

## 2. 예산표

| 지표 | 뜻 | 측정 | 기준선(2026-10-25) | 예산 | 비고 |
|---|---|---|---|---|---|
| `cold_start_cli` | `bun apps/cli/src/main.ts version --json` 시작부터 종료까지 | `just bench` | WSL2 중앙값 143.6 ms(3회) | [미결] | 번들 전 소스 진입. 모듈 적재 비용을 봅니다 |
| `cold_start_sidecar` | 컴파일한 사이드카 `xeon-<triple> version --json` 시작부터 종료까지 | `just desktop-sidecar host` 뒤 `just bench` | WSL2 약 131 ms(`--bytecode`, `L4.desktop.plan` §3 spike S2) | [미결] | macOS 값은 `review.macos-checklist` M-07 |
| `first_token` | `xeon chat -p` 시작부터 첫 `stream.chunk` 알림까지 | `just bench --first-token --yes` | 미측정 | [미결] | 실제 모델 호출. 사용자 확인 뒤 1회(결정 D-e) |
| 사이드카 크기 | triple별 바이너리 크기 | `just desktop-sidecar <triple>` | 약 90 MiB | 500 MiB(회귀 상한) | ADR-0012 §3 2번. 줄이는 목표가 아닙니다 |

- 예산 열의 숫자는 기준선을 본 뒤 사용자가 정합니다. 정하면 `xeon/scripts/bench.ts`의 `BUDGET_MS`를 같은 커밋에서 고칩니다.
- `just bench`는 지표마다 최소, 중앙값, p90, 최대와 예산 판정(`no budget`, `within`, `over`)을 출력합니다.

## 3. 규칙

### PF-01 측정은 레시피로 한다

- 이유: 측정 조건(진입 파일, 인자, 반복 수)이 같아야 값을 비교할 수 있습니다.
- 좋은 예: `just bench --runs 5`.
- 나쁜 예: 터미널에서 `time bun …`을 한 번 재서 plan에 적습니다(검사 없음, 리뷰에서 거부).

### PF-02 실제 모델 호출은 사람 확인 뒤에만 잰다

- 이유: 비용과 키가 들어갑니다(사용자 전역 규칙의 종료코드 3).
- 좋은 예: `just bench --first-token`이 종료코드 3으로 계획을 보이고, 사람이 확인한 뒤 `--yes`로 다시 부릅니다.
- 나쁜 예: CI나 `just verify`에서 실제 provider를 부릅니다(`bench.ts`가 `--yes` 없이는 실행하지 않음).

### PF-03 기기와 날짜를 함께 적는다

- 이유: WSL2와 macOS의 값이 다르고, 같은 기기도 부하에 따라 다릅니다.
- 좋은 예: "WSL2 중앙값 143.6 ms(3회), 2026-10-25".
- 나쁜 예: 기기 없이 "143 ms".

## 4. 강제 수단

- `xeon/scripts/bench.test.ts`: 통계, 예산 판정, `--first-token`의 확인 요구를 값으로 비교합니다.
- 리뷰: 예산표 값이 바뀌면 `BUDGET_MS`도 같은 커밋에서 바뀌어야 합니다.

## 5. 예외와 미결 사항

- [미결] 지표별 예산 수치(§2). 기준선을 macOS에서 잰 뒤 정합니다.
- [미결] 응답 경로 지표(`thread.read` 지연, 컴팩션 시간)를 더할지. 측정 진입이 생기면 이 표에 행을 더합니다.
