---
id: L4.release.spec
layer: L4
domain: release
kind: spec
status: draft
depends_on: [L0.os.spec, L4.cli.spec, L4.desktop.spec, L4.host-service.spec, X.loading-trust.spec, eng.toolchain.guide, review.m3-design-inputs]
binds: [xeon/scripts/release*, xeon/scripts/release-bundle.json, .github/workflows/xeon-release.yml]
---

# L4 릴리즈 (release)

## 1. 목적과 범위

### 1.1 정하는 것

- 릴리즈 아카이브의 구성과 배치(§3.1). 실행 파일, 그룹 템플릿, 기본 플러그인, 번들 바이너리, 고지, 체크섬이 어디에 놓이는지 정합니다.
- 자원 디렉터리 탐색과 소비처(§3.2). 실행 파일이 든 폴더를 자원 디렉터리로 보고, 세 소비처가 그 안에서 어떻게 찾는지 정합니다.
- 번들 바이너리의 버전, 라이선스, 출처와 Linux의 시스템 요구(§3.3). 대상 플랫폼은 §3.4입니다.
- 서명과 공증 단계, 비밀이 없을 때의 건너뛰기(§4).
- M3b의 업데이트 방식과 사용자 절차(§5).
- 공급망과 고지 파일(§6).
- 릴리즈 스모크 X11과 단위 시험, 그 실행 위치(§7).

### 1.2 다루지 않는 것

- Tauri 데스크톱 앱 번들의 자원 매핑, 곧 사이드카 옆에 템플릿과 기본 플러그인을 두는 설정. M4 패키징이 맡습니다([미결] §8).
- 앱 안의 자동 업데이트. M4입니다.
- 번들 바이너리를 찾고 실행하는 규칙. `L0.os.spec` §3.6이 정합니다.
- Windows 서명, Intel macOS 빌드, npm 공개. 범위 밖입니다(D-M3-25 행 2, 행 6).

## 2. 요구 연결

| 요구 | 내용 | 구현 | 시험 |
|---|---|---|---|
| M3-REQ-53 (L0.os) | 번들 바이너리를 자원 디렉터리에서 찾고, Linux의 bwrap·socat은 시스템 요구로 두어 doctor가 안내합니다 | `xeon/scripts/release.ts`(`binaries.lock.json` 작성, `lockBody`), `xeon/packages/platform-os/src/binaries/resolve.ts`(번들 후보, `installHint`) | `xeon/scripts/release.test.ts`(lockBody, requiredPaths), `xeon/packages/platform-os/test/binaries.test.ts`(Linux apt 안내), X11의 `lock.match`와 `run.doctor.bundled` |
| M3-REQ-54 (L0.os, F.wire-settings) | 제품 이름에 묶인 값을 소비처에서 확인합니다 | 릴리즈 스크립트는 workspace 패키지를 import하지 않으므로 이름 `xeon`을 스크립트에 적습니다(`release.ts`, `release-smoke.ts`, `release-smoke.sh`). 소비처 목록은 §8 미결 9 | X11의 `run.version`과 환경 변수 없는 `xeon group new` |
| M3-26 | macOS의 sops·age·rg 번들과 서명, Linux의 bwrap·socat 시스템 요구와 doctor 안내 | `xeon/scripts/release-bundle.json`, `xeon/scripts/release.ts`(버전 확인과 복사), `xeon/scripts/release-sign.sh` | `xeon/scripts/release.test.ts`(설정 값, 버전 고정 일치, 고지), X11 |
| M3-27 | 단일 아카이브 릴리즈, 서명과 공증, 업데이트 절차, 공급망과 고지 | §3, §4, §5, §6의 산출물. `release.ts`가 `SHA256SUMS`와 `.sha256`을 씁니다 | `xeon/scripts/release.test.ts`(sumsBody, noticesBody, archiveName), X11의 `archive.sha256`과 `sums.match` |
| M3-new-22 | 기본 플러그인 번들을 `default-plugins/<이름>/`에 싣습니다 | `xeon/scripts/release.ts`(`packages/group-helm`, `packages/group-account-rotation`의 build-plugin 실행), `xeon/apps/host/src/state-paths.ts`(`defaultPluginsDir`) | `xeon/scripts/release.test.ts`(빌드 스크립트 경로 존재), X11의 `layout`(`.xeon-plugin/plugin.json`) |
| M3-30 | `.github/workflows/xeon-*.yml`의 액션을 40자리 SHA로 고정하고 `# v<버전>` 주석을 붙입니다 | `.github/workflows/xeon-ci.yml`, `xeon-macos.yml`, `xeon-release.yml` | `xeon/scripts/workflow-pins.test.ts`(실제 파일과 판정 함수) |
| DR-07 `@swc/core` | 릴리즈 바이너리에 `@swc/core`가 들어가지 않습니다 | `xeon/scripts/release-smoke.ts`의 `swc.absent` 검사 | X11. 바이너리 안의 문자열을 확인합니다 |
| 템플릿 패키징(`L4.cli.spec` §10 29번) | 컴파일 바이너리가 `xeon group new`의 템플릿을 찾습니다 | `xeon/apps/cli/src/group/fs-port.ts`(`locateGroupTemplates`의 `resourceDir`), `xeon/apps/cli/src/runtime.ts` | `xeon/apps/cli/test/group-templates-locate.test.ts`, X11의 `run.group-new` |
| rg 확인(M3b) | 번들 rg 15.0.0이 `--no-require-git`을 지원하고, 작업 공간 검색(`cap-workspace`)이 쓰는 값과 맞습니다 | `xeon/scripts/release-bundle.json`의 rg 15.0.0 | `xeon/packages/cap-workspace/test/rg.int.test.ts`(작성 시점 실측 12/12) |

## 3. 릴리즈 구성

### 3.1 아카이브 배치

```
xeon-<버전>-<triple>/
├── xeon                          컴파일된 엔진 (Windows는 xeon.exe)
├── group-kit/templates/          `xeon group new`의 템플릿과 index.json
├── default-plugins/
│   ├── helm/                     .xeon-plugin/plugin.json과 엔트리 번들
│   └── account-rotation/         같은 구조
├── binaries/                     macOS만: sops, age, rg
├── binaries.lock.json            macOS만: 번들 바이너리 목록
├── THIRD-PARTY-NOTICES.txt       번들 바이너리 고지와 시스템 요구
└── SHA256SUMS                    위 모든 파일의 SHA-256, 경로순
```

아카이브는 `xeon-<버전>-<triple>.tar.gz`이고, 옆에 `xeon-<버전>-<triple>.tar.gz.sha256`이 놓입니다. 아카이브를 풀면 최상위 폴더 이름이 `xeon-<버전>-<triple>`입니다.

`release.ts`는 스테이징 폴더에서 서명을 마친 뒤에 해시를 계산합니다(§4). 그래서 `binaries.lock.json`과 `SHA256SUMS`의 해시는 배포되는 파일과 같습니다.

### 3.2 자원 디렉터리 탐색과 소비처

자원 디렉터리는 실행 파일이 든 폴더입니다(`dirname(process.execPath)`). `xeon/apps/host/src/state-paths.ts`의 `hostResourceDir()`와 `xeon/apps/cli/src/runtime.ts`가 같은 값을 씁니다. 자원 디렉터리는 읽기 전용입니다. 설정과 상태는 `OsDirs`가 정한 다른 폴더에 두므로(`L0.os.spec` §3.2), 자원 디렉터리를 새 것으로 바꿔도 설정과 세션은 남습니다.

| 소비처 | 자원 디렉터리 안의 위치 | 찾지 못할 때 | 코드 |
|---|---|---|---|
| 번들 바이너리 목록 | `binaries.lock.json` | 번들 후보가 없으므로 시스템 후보를 찾습니다 | `xeon/packages/platform-os/src/binaries/resolve.ts` |
| 기본 플러그인 | `default-plugins/<이름>/` | 설치하지 않고 `no_bundle`로 알립니다. 오류가 아닙니다 | `xeon/apps/host/src/assembly/default-plugins.ts`, `xeon/apps/host/src/assemble.ts`(`defaultPluginsDir`) |
| 그룹 템플릿 | `group-kit/templates/index.json` | 환경 문제(종료 코드 3)로 끝납니다 | `xeon/apps/cli/src/group/fs-port.ts` |

그룹 템플릿의 탐색 순서는 `locateGroupTemplates`가 정합니다.

1. 환경 변수 `XEON_GROUP_TEMPLATES_DIR`. 빈 값은 없는 것으로 다룹니다.
2. `<자원 디렉터리>/group-kit/templates/index.json`이 있는 폴더. 컴파일 바이너리는 이 자리로 찾습니다.
3. 시작 폴더 `from`에서 위로 올라가며 찾는 `packages/group-kit/templates/index.json`. 소스 실행(`bun run`)은 이 자리로 찾습니다.

Tauri 앱에서는 사이드카가 앱 번들의 `Contents/MacOS`에 놓이므로 그 폴더가 자원 디렉터리가 됩니다. 템플릿과 기본 플러그인을 같은 폴더에 두는 매핑은 M4 패키징이 맡습니다([미결] §8).

### 3.3 번들 바이너리와 시스템 요구

| 이름 | 버전 | 라이선스 | 출처 | 대상 |
|---|---|---|---|---|
| sops | 3.13.3 | MPL-2.0 | https://github.com/getsops/sops | macOS arm64 번들 |
| age | 1.3.2 | BSD-3-Clause | https://github.com/FiloSottile/age | macOS arm64 번들 |
| rg | 15.0.0 | Unlicense OR MIT | https://github.com/BurntSushi/ripgrep | macOS arm64 번들 |

- 버전의 원천은 `xeon/scripts/release-bundle.json`입니다. `.github/workflows/xeon-macos.yml`과 `xeon-release.yml`의 `mise use --global sops@… age@… ripgrep@…` 줄이 같은 값을 씁니다. `xeon/scripts/release.test.ts`가 세 곳의 값이 같은지 확인합니다.
- `release.ts`는 파일을 복사하기 전에 `<이름> --version`의 출력에 고정 버전이 있는지 확인합니다. 없으면 `binary.version` 오류로 끝납니다.
- `binaries.lock.json`은 이름순으로 정렬한 항목을 씁니다. 항목은 `name`, `platform`, `arch`, `path`(자원 디렉터리 기준 상대 경로), `sha256`, `version`입니다. 실행할 때 해석기가 이 목록을 읽고 해시를 맞춥니다(`L0.os.spec` §3.6).
- Linux에서 `rg`, `bwrap`, `socat`은 시스템 패키지로 요구합니다. 아카이브는 세 바이너리를 싣지 않습니다. 목록은 `release-bundle.json`의 `systemRequired.linux`에 있고, 세 바이너리는 점검 표(`requirements.ts`)에서 모두 필수입니다. `xeon doctor`가 설치 명령을 안내합니다(`installHint`, 예: `apt install bubblewrap`).
- `THIRD-PARTY-NOTICES.txt`는 번들 바이너리마다 이름, 버전, 라이선스, 출처를 적고, Linux 아카이브에는 시스템 요구 목록을 적습니다.

### 3.4 대상

| triple | 상태 | 번들과 시스템 요구 | 스모크 |
|---|---|---|---|
| aarch64-apple-darwin | 빌드. macOS 14 이상 arm64 | sops, age, rg를 번들하고 서명합니다 | X11. macOS job과 `xeon-release.yml` |
| x86_64-unknown-linux-gnu | 빌드. Linux x86_64 | 시스템의 rg, bwrap, socat | X11. Linux CI |
| aarch64-unknown-linux-gnu | 빌드 대상(`apps/desktop/sidecar.json`). Linux arm64 | 시스템의 rg, bwrap, socat | 없음([미결] §8) |
| x86_64-apple-darwin | 빌드하지 않습니다(D-M3-25 행 2) | 해당 없음 | `release.ts`가 막지 않습니다([미결] §8) |
| x86_64-pc-windows-msvc | 범위 밖 | 해당 없음 | 없음 |

## 4. 서명과 공증

- 서명은 macOS 아카이브에만 합니다(triple에 `-apple-`이 든 경우). `release.ts`는 스테이징 폴더를 `xeon/scripts/release-sign.sh`에 넘긴 뒤에 해시를 계산합니다. 서명이 파일을 바꾸므로 해시는 서명 뒤에 계산합니다.
- `release-sign.sh`는 여섯 비밀을 확인합니다. `APPLE_CERTIFICATE_P12_BASE64`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD`입니다. 하나라도 비어 있으면 `release-sign: skipped, secrets not set: <빠진 이름>`을 출력하고 0으로 끝납니다. 값은 출력하지 않습니다. 포크와 pull request에는 비밀이 없으므로 이 경로를 탑니다.
- 비밀이 모두 있으면 임시 키체인에 인증서를 가져오고, 번들 바이너리와 `xeon`을 `codesign --force --options runtime --timestamp`로 서명한 뒤 `codesign --verify --strict`로 확인합니다. 공증은 아카이브 폴더를 zip으로 묶어 `xcrun notarytool submit --wait`로 보냅니다. 바이너리에는 스테이플할 수 없으므로 Gatekeeper가 온라인으로 공증 기록을 확인합니다. 임시 키체인은 끝날 때 지웁니다.
- 실패는 종료 코드 1이고, 도구가 없는 환경은 2입니다.
- 비밀의 등록은 사용자가 합니다. 저장소는 비밀을 등록하지 않고, `xeon-release.yml`이 비밀을 환경 변수로 넘길 뿐입니다.
- 서명과 공증의 실제 실행은 Mac 실기와 비밀 등록 뒤의 일입니다([미결] §8). 이 저장소의 시험은 비밀이 없는 건너뛰기 경로만 확인합니다(§7).

## 5. 업데이트

- [결정: 오케스트레이터 기본값] M3b에는 자동 업데이트가 없습니다. 사용자는 새 아카이브를 받고, `.sha256`과 `SHA256SUMS`로 내용을 확인한 뒤 설치 폴더를 새 것으로 바꿉니다.
- 설정과 상태는 설치 폴더 밖의 `OsDirs`에 있으므로 폴더를 바꿔도 잃지 않습니다(§3.2).
- 기본 플러그인은 처음 실행할 때 사용자 확장 폴더에 복사본을 둡니다. 새 아카이브의 번들 버전이 복사본과 다르면 복사본을 바꿉니다. 사용자가 지운 복사본은 다시 설치하지 않습니다([결정: A5 T-H], `X.loading-trust.spec`).
- 앱 안의 업데이트 확인과 내려받기는 M4입니다([미결] §8).
- 의존 버전은 현재 버전에 고정하고 점진적으로 올립니다([결정: review.m3-design-inputs D-M3-29 행 1]). 빌드는 `bun install --frozen-lockfile`로 잠금 파일을 따릅니다(`xeon/justfile`의 `setup`).

## 6. 공급망과 고지

- 산출물의 무결성은 `SHA256SUMS`(아카이브 안의 모든 파일)와 `binaries.lock.json`(번들 바이너리)이 맡습니다. 아카이브 옆의 `.sha256`은 내려받는 중의 깨짐을 잡습니다.
- 이 해시들은 서명이 아닙니다. `.sha256`과 아카이브를 같은 곳에서 받으므로, 그 자체로는 변조를 막지 못합니다([미결] §8).
- `THIRD-PARTY-NOTICES.txt`는 번들 바이너리 세 개의 이름, 버전, 라이선스, 출처를 적습니다. 라이선스 전문은 싣지 않고 출처 주소만 적습니다. 이 방식이 배포 조건을 충족하는지는 사용자 확인이 필요합니다([미결] §8).
- 워크플로의 액션은 커밋 SHA로 고정하고, 버전 주석을 붙입니다(M3-30). 주석의 버전이 SHA와 맞는지는 저장소 안에서 확인하지 않습니다([미결] §8).
- 비밀 검사(gitleaks) 단계는 xeon 워크플로에 아직 없습니다([미결] §8).
- npm 공개는 없습니다(D-M3-25 행 6).

## 7. 시험

| 시험 | 종류 | 무엇을 확인하나 | 실행 위치 |
|---|---|---|---|
| `xeon/scripts/release.test.ts` | 단위 | 설정 파싱과 잘못된 설정, 잠금 파일, SHA256SUMS, 고지, 아카이브 이름, 버전 검사, 종료 코드, 스모크의 배치와 sums 파싱, 번들 버전과 mise 고정 값의 일치 | xeon-ci `root` 층(Linux x86_64, `bun test scripts`) |
| `xeon/scripts/workflow-pins.test.ts` | 단위 | 워크플로 `uses:`의 SHA 고정과 버전 주석(M3-30), 비밀이 없을 때와 APPLE_ID만 있을 때의 서명 건너뛰기, 값 미출력 | 같음 |
| `xeon/apps/cli/test/group-templates-locate.test.ts` | 단위 | 템플릿 탐색 순서와 찾지 못했을 때 null | xeon-ci `L4` 층 |
| `xeon/packages/platform-os/test/binaries.test.ts` | 단위 | Linux에서 bwrap과 socat이 없을 때의 설치 안내 문구 | xeon-ci `L0` 층, `xeon-macos.yml`(`just test packages/platform-os`) |
| `xeon/scripts/release-smoke.test.ts`(X11) | 종단 | `release-smoke.sh`가 이 기기의 아카이브를 만들고, §3.1 배치, 해시, 잠금, 실행, 템플릿, doctor 줄, `@swc/core` 부재를 확인합니다 | xeon-ci `exit-tests`(Linux x86_64), `xeon-macos.yml`의 `exit-tests`와 `release smoke`(macOS arm64), `xeon-release.yml`(두 OS) |

- X11 스모크는 `xeon/scripts/release-smoke.sh` 한 개를 두 OS가 같은 입력으로 돌립니다. macOS는 mise에서 찾은 고정 버전의 sops, age, rg를 `--binaries-dir`로 넘깁니다. Linux는 시스템의 도구를 씁니다.
- 스모크의 검사는 다음과 같습니다. (1) 아카이브와 `.sha256`, (2) 배치와 `binaries.lock.json`의 유무(macOS에만), (3) `SHA256SUMS`와 잠금 항목의 해시, (4) `xeon version`, 환경 변수 없는 `xeon group new`, `xeon doctor`의 외부 바이너리 줄, (5) 바이너리 안의 `@swc/core` 문자열 부재.
- 서명 경로의 실행은 시험하지 않습니다. 비밀이 있는 공증은 실기 확인 항목입니다([미결] §8).

## 8. 결정과 미결

### 8.1 결정

- [결정: review.m3-design-inputs D-M3-25 행 1~6] Tauri 내장 서명과 Developer ID 공증, macOS 14 이상 arm64만 지원, macOS는 sops·age·rg를 번들하고 Linux는 시스템 요구, 단일 아카이브, npm 공개 없음.
- [결정: 오케스트레이터 기본값] 자원 디렉터리는 실행 파일이 든 폴더입니다. 그룹 템플릿의 탐색 순서는 §3.2의 세 단계입니다.
- [결정: 오케스트레이터 기본값] 릴리즈 스크립트는 workspace 패키지를 import하지 않습니다(`eng.dependency-rules.guide` §1). 스크립트가 함께 쓰는 값은 `xeon/scripts/release-bundle.json`에 둡니다.
- [결정: 오케스트레이터 기본값] M3b에는 자동 업데이트가 없습니다(§5).
- [결정: 오케스트레이터 기본값] 버전 주입(M3b B5-FIX2). `release.ts`가 `--version`을 `build-sidecar.ts`에 넘기고, 빌드가 `bun build --define XEON_BUILD_VERSION="<버전>"`으로 문자열 상수를 넣습니다. `CLI_VERSION`(`xeon/apps/cli/src/commands/version.ts`)과 `ENGINE_VERSION`(`xeon/apps/host/src/assemble.ts`)은 `typeof XEON_BUILD_VERSION`이 문자열이면 그 값을, 아니면(소스 실행, 개발 빌드) `"0.0.0"`을 씁니다. 버전은 `x.y.z` 또는 `x.y.z-<꼬리>` 모양만 받습니다. `xeon-release.yml`은 `v<x.y.z>` 태그에서 태그의 버전을 `XEON_RELEASE_VERSION`으로 넘기고, 그 밖에는 스모크 기본값 `0.0.0-smoke`입니다. 스모크는 `xeon version` 출력에 아카이브 버전이 있는지 확인합니다(`run.version-injected`). 앱 번들(Tauri) 버전과의 정합은 M4 패키징 몫입니다.

### 8.2 미결

1. [해소] 버전 값은 §8.1의 버전 주입으로 정했습니다.
2. [미결] Tauri 자원 매핑. `xeon/apps/desktop/src-tauri/tauri.conf.json`에는 `externalBin`만 있습니다. 템플릿과 기본 플러그인을 `Contents/MacOS`에 두는 설정(`resources`와 macOS 파일 매핑)은 M4입니다.
3. [미결] 고지 파일의 라이선스 전문. BSD-3-Clause(age)는 배포물과 함께 저작권 고지와 조건을 두라고 합니다. 현재 고지는 출처 주소만 적습니다. 전문을 넣을지 사용자가 정합니다.
4. [미결] 체크섬의 출처. `.sha256`과 아카이브는 같은 곳에서 받습니다. 서명된 체크섬이나 별도 공개 키는 없습니다.
5. [미결] CI의 gitleaks 단계. xeon 워크플로에 없습니다(M3-30의 일부).
6. [미결] 액션 주석 검증. 주석의 `v<버전>`과 SHA가 맞는지는 저장소 안에서 검사하지 않습니다. 사용자나 리뷰가 한 번 확인합니다.
7. [미결] Linux arm64 스모크. X11은 x86_64에서만 돕니다. aarch64 Linux 아카이브는 빌드 대상이지만 검증하지 않습니다.
8. [미결] Intel macOS. `release.ts`는 `bundledBinaries`에 없는 triple도 번들 없이 아카이브로 만듭니다. 지원하지 않는 triple을 막는 검사는 없습니다.
9. [미결] 이름 `xeon`의 소비처. 릴리즈 스크립트(`release.ts`, `release-smoke.ts`, `release-smoke.sh`), `xeon/apps/desktop/sidecar.json`의 `name`, `tauri.conf.json`의 `productName`과 `externalBin`이 이름을 적습니다. M4 개명 때 함께 바꿉니다(M3-REQ-54).
10. [미결] Windows 서명. 범위 밖입니다. Windows 아카이브는 실행 파일 이름(`xeon.exe`)만 정했고, 번들과 스모크가 없습니다.
11. [미결] Linux rg. 번들하지 않고 시스템 요구로 둡니다(§3.3). 스모크는 Linux에서 `rg` 줄을 확인하지 않습니다.
12. [미결] `L0.os.spec` §10 3번(번들 정책)과 §3.6의 "미정" 표기가 이 결정과 어긋납니다. `L0.os` 문서는 B0-OS 트랙이 맡으므로 이 문서에서 고치지 않습니다.
13. [미결] X11의 실행 시간. X11은 `bun test scripts`에도 들어 있어 root 층 시험에서 아카이브를 한 번 더 만듭니다. 빌드가 시험 상한(300초) 안에 끝나는지는 기기 성능에 달려 있습니다.
