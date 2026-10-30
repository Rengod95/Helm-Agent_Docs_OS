---
id: L4.release.plan
layer: L4
domain: release
kind: plan
status: draft
depends_on: [L4.release.spec]
binds: [xeon/scripts/release*, xeon/scripts/release-bundle.json, .github/workflows/xeon-release.yml]
---

# L4 릴리즈 계획 (release)

구조와 규칙은 `L4.release.spec`이 정합니다. 이 문서는 M3b B5-REL 트랙의 작업 항목과 완료 기준을 적습니다.

## 1. 목표와 마일스톤 배치

- 목표: Linux x86_64와 macOS arm64에서 같은 입력으로 릴리즈 아카이브를 만들고, 같은 스모크(X11)를 통과시킵니다(`m3b-plan` B5-REL).
- 배치: M3b, B4 병합 뒤 병렬로 진행합니다. 서명과 공증의 실제 실행, 비밀 등록, Mac 실기 확인은 사용자 묶음이고 이 트랙의 완료 조건이 아닙니다.

## 2. 패키지와 파일 배치

| 파일 | 역할 |
|---|---|
| `xeon/scripts/release.ts` | 아카이브 조립, 번들 바이너리 버전 확인, 잠금 파일, 고지, 체크섬 |
| `xeon/scripts/release-bundle.json` | 번들 버전, 라이선스, 출처, 기본 플러그인, 템플릿 위치, 시스템 요구 |
| `xeon/scripts/release-smoke.ts`, `release-smoke.sh` | 아카이브 검사와 실행 검사(X11). 셸 스크립트는 두 OS에서 같은 입력을 쓴다 |
| `xeon/scripts/release-sign.sh` | macOS 서명과 공증. 비밀이 없으면 건너뛴다 |
| `xeon/scripts/release.test.ts`, `workflow-pins.test.ts`, `release-smoke.test.ts` | 단위 시험과 X11 |
| `.github/workflows/xeon-release.yml` | 릴리즈 스모크 두 OS, 서명 비밀 전달 |
| `.github/workflows/xeon-macos.yml` | macOS job의 릴리즈 스모크 단계 |
| `xeon/justfile`, 루트 `justfile` | `release`, `release-smoke` 레시피 |
| `xeon/apps/cli/src/group/fs-port.ts`, `runtime.ts` | 템플릿 탐색에 자원 디렉터리 단계를 더함 |
| `xeon/apps/cli/test/group-templates-locate.test.ts` | 템플릿 탐색 순서 시험 |
| `xeon/packages/platform-os/test/binaries.test.ts` | Linux의 bwrap·socat 설치 안내 시험 |

## 3. 작업 분해

| 작업 | 내용 | 상태 |
|---|---|---|
| R1 | 설정 파일과 번들 버전 고정, 버전 일치 시험 | 구현됨 |
| R2 | 아카이브 조립, 잠금 파일, SHA256SUMS, 고지, `.sha256` | 구현됨 |
| R3 | 서명과 공증 단계, 비밀이 없을 때 건너뛰기 | 구현됨. 실제 서명은 사용자 묶음 |
| R4 | 스모크 X11과 두 OS의 워크플로 단계 | 구현됨. 두 OS의 실행 결과 확인 대기 |
| R5 | 템플릿 탐색의 자원 디렉터리 단계 | 구현됨 |
| R6 | 액션 SHA 고정 회귀 시험(M3-30) | 구현됨 |
| R7 | 문서: `L4.release.spec`과 이 계획, `L4.cli.spec` §10 29번 해소 | 구현됨 |
| R8 | Tauri 자원 매핑과 앱 안의 업데이트 | M4로 넘김 |

## 4. 채택 도구

- 번들 바이너리: sops 3.13.3, age 1.3.2, ripgrep 15.0.0(macOS arm64만, mise로 설치). 버전의 원천은 `release-bundle.json`입니다.
- macOS 도구: `codesign`, `ditto`, `xcrun notarytool`, `security`(키체인).
- 새 npm 의존은 없습니다. `release.ts`는 이미 있는 `typebox`만 씁니다.

## 5. 단위 테스트 목록

| 시험 | 확인하는 동작 |
|---|---|
| `release.test.ts` | 설정 파싱과 잘못된 설정, 잠금 파일의 정렬과 모양, SHA256SUMS 정렬, 고지 두 형식, 아카이브 이름, 버전 검사, 종료 코드, 스모크의 배치와 sums 파싱, 버전 고정 일치 |
| `workflow-pins.test.ts` | 워크플로 `uses:`의 SHA 고정과 버전 주석, 판정 함수의 거부 사례, 서명 건너뛰기 두 경우 |
| `group-templates-locate.test.ts` | 환경 변수, 자원 디렉터리, walk-up의 순서와 null |
| `binaries.test.ts`(추가 항목) | Linux에서 bwrap과 socat 없음 안내의 apt 명령 |
| `release-smoke.test.ts`(X11) | 아카이브 생성과 X11 검사 전체 |

## 6. 완료 기준

- X11이 `just exit-tests`에서 통과하고 건너뜀이 0입니다(Linux CI의 `exit-tests` job, macOS job).
- `just release-smoke`가 Linux x86_64와 macOS arm64에서 `release-smoke: ok`를 냅니다.
- `just docs-route --check`와 `just req-ledger`가 통과합니다.
- 서명과 공증은 비밀 등록 뒤 사용자가 실기로 확인합니다.

## 7. 위험과 대응

| 위험 | 대응 |
|---|---|
| X11이 아카이브를 만들어 시험 상한(300초)에 걸릴 수 있습니다 | 빌드 시간을 재고, 넘으면 X11을 별도 단계로 옮깁니다([제안]) |
| 공증 실패는 비밀을 등록한 뒤에야 드러납니다 | 사용자 묶음에서 한 번 실행합니다 |
| 고지 전문과 체크섬 출처는 사람이 판단할 항목입니다 | `L4.release.spec` §8 미결 3과 4로 넘깁니다 |
