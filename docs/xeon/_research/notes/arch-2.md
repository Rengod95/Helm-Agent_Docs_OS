---
id: xeon.research.arch-2
layer: meta
domain: research
kind: guide
status: draft
depends_on: []
binds: []
---

# 조사 2: Tauri 2 사이드카 종료 정리와 bun build --compile 사이드카 묶기

- 조사일: 2026-10-21
- 저장소 기준: `/home/user/projects/helm/code/helm`, 브랜치 `xeon/foundation`
- 정본 아님. ADR-0008 작성의 입력으로 쓴다.

## 1. 질문과 범위

- Q1. Tauri 2 사이드카가 종료될 때 자식 프로세스가 정리되는가.
- Q2. `bun build --compile` 바이너리를 사이드카로 묶는 방식에 공식 지원 또는 알려진 제약이 있는가.
- 목적: ADR-0008(데스크톱 Tauri 2 + 엔진 사이드카)의 감수할 점과 미결을 확인한다.
- 입력 근거:
  - `_research/foundation-plan.md` §1 3번 행: 엔진은 `bun build --compile` 사이드카, 엔진과 UI는 stdio JSON-RPC로 연결.
  - `_research/foundation-plan.md` §7: 사이드카 단일 바이너리 크기와 Windows 서명은 L4 plan에서 다룬다.
  - `_research/process.md` §6.2 단계 1, §6.4, §6.5 3번.
  - `_research/stack-status.md` §7-C, §7-F의 [미확인] 항목.
- [미결] ADR-0008 본문 파일이 저장소에 없다. `docs/xeon/decisions/` 디렉터리가 없고, `_routing/routes.yaml:93`만 `adr.0008`을 가리킨다. 이 문서는 감수할 점과 미결의 출처를 위 입력 근거로 대신 본다.

## 2. 결론 요약

- Q1 (정리 여부): 한 경로에서만 정리된다.
  - JavaScript API(`Command.sidecar`)로 띄운 사이드카는 앱이 정상 종료하면서 `RunEvent::Exit`를 발생시킬 때 플러그인이 SIGKILL로 끝낸다.
  - Rust API(`app.shell().sidecar()`)로 띄운 사이드카는 플러그인이 추적하지 않는다. 호출자가 직접 정리해야 한다.
  - 앱이 크래시하거나 신호로 끝나면 정리 코드가 실행되지 않는다. 플러그인에 부모 사망 연동 장치가 없다.
  - `processGroup`을 켜지 않으면 사이드카가 띄운 손자 프로세스가 남는다.
  - Windows에서는 job 핸들을 닫아도 프로세스가 계속 실행된다.
  - 공식 Tauri 사이드카 문서에는 종료 정리 설명이 없다. 위 결론은 플러그인 소스에서 확인했다.
- Q2 (bun 묶기): 공식 지원 문서가 없다.
  - Tauri 공식 사이드카 문서와 Node 가이드 어디에도 Bun 컴파일 바이너리가 나오지 않는다.
  - 묶기 규칙(externalBin, triple 접미사, capabilities)은 Tauri 공식 문서로 확인된다. 이 규칙을 Bun 바이너리에 적용하는 것은 공식 사례가 아니다.
  - Bun 공식 문서는 단일 바이너리가 "still way too big"이라고 명시하고, 상대 경로와 임베드 SQLite의 cwd 의존과 휘발성을 적는다. 자식 프로세스와 신호 처리는 문서에 없다.
- ADR-0008 영향:
  - foundation-plan과 process.md가 가정한 "종료 시 SIGTERM으로 안전 경계 체크포인트"는 플러그인 경로에서 성립하지 않는다. 플러그인은 SIGKILL만 보낸다.
  - [제안] 고아 방지는 엔진의 stdin EOF 감시와 `processGroup: true`를 기본으로 둔다.
  - [제안] 정리 책임을 Rust 쪽 한 곳(`RunEvent::Exit` 또는 `ExitRequested` 핸들러)에 모은다.

## 3. Q1 근거

### 3.1 공식 문서 (Tauri 사이드카)

- 원문: https://v2.tauri.app/develop/sidecar/ (2026-10-21 원문 HTML 대조). 본문에 종료, 정리, `RunEvent`, `kill` 관련 문장이 없다.
- 확인된 규칙:
  - `externalBin`에 적은 경로에 `-$TARGET_TRIPLE` 접미사를 가진 같은 이름의 바이너리가 있어야 한다.
  - `sidecar()`에는 파일명만 넘긴다. 전체 경로를 넘기지 않는다.
  - capabilities에 `shell:allow-execute`(`spawn`을 쓰면 `shell:allow-spawn`)와 `"sidecar": true`를 둔다.
- 예제 사이드카는 "short lived" 프로세스다(§3.5).

### 3.2 플러그인 소스 (tauri-plugin-shell)

기준 소스: `tauri-apps/plugins-workspace`의 `v2` 브랜치, 커밋 `11211c30e71796cd737280303244552bb7f70797`(조회일 2026-10-21, `plugins/shell/Cargo.toml` version 2.5.0). 아래 경로는 `plugins/shell/src/` 기준이다.

| 항목 | 위치 | 내용 |
|---|---|---|
| 앱 종료 시 정리 | `lib.rs:163-173` | `RunEvent::Exit`에서 `children` 맵을 비우고 각 자식에 `child.kill()`을 호출한다. |
| 맵 등록 경로 | `commands.rs:260` | JS `spawn` 명령에서만 `shell.children`에 넣는다. 이 파일의 유일한 insert다. |
| Rust API 경로 | `process/mod.rs` 전체 | 전역 레지스트리(`static`, `OnceLock`, `LazyLock`)가 없다. `sidecar().spawn()`의 `CommandChild`는 호출자가 보관한다. |
| 기본 kill | `process/mod.rs:99-122` | 그룹 옵션이 꺼져 있으면 `self.inner.kill()`이다. shared_child는 Unix에서 SIGKILL을 보낸다(`shared_child.rs` `src/lib.rs:330`). |
| 그룹 kill | `process/mod.rs:107` | `libc::killpg(pgid, libc::SIGKILL)`이다. |
| 그룹 옵션 | `commands.rs:93-94`, `guest-js/index.ts:93` | Rust 쪽 `process_group: bool`은 `#[serde(default)]`로 기본 false다. JS 옵션 이름은 `processGroup`이다. |
| 그룹 범위 | `process/mod.rs:316-318` | "Without `set_process_group` only the child itself is killed, and any processes it spawned keep running". |
| kill_on_drop | `process/mod.rs:321`, `133-141` | "This has no effect on processes spawned from the JavaScript API; the plugin kills those when the app exits." |
| 부모 사망 연동 | 전체 검색 | `prctl`, `PDEATHSIG` 검색 0건이다. |
| Windows job | `process/job_object.rs:21`, `32` | 주석: "Owned job object handle. Closing it leaves the processes in the job running." job 생성 시 kill-on-close 설정이 없다. |
| 실행 파일 경로 | `process/mod.rs:175-189` | 사이드카는 앱 실행 파일 디렉터리에서 `base_dir.join(command)`로 찾는다. |
| 환경 변수 | `commands.rs:87`, `98`, `157-159` | `env`가 생략되면 기본값 빈 맵이라 부모 환경을 상속한다. `null`이면 `env_clear()`다. [가정] serde 기본값 해석을 소스에서 읽은 결과다. 실행으로 확인하지 않았다. |
| stdin 파이프 | `process/mod.rs:225`, `397`, `461` | 자식의 stdin은 파이프다. 쓰기 끝은 `CommandChild`가 보관한다. |

- 최신 태그 대조: `shell-v3.0.0-alpha.3` 태그의 `lib.rs:103-110`도 같은 `RunEvent::Exit` 정리 코드를 둔다. 확인된 사실이다. v3 정식 버전은 [미확인].

### 3.3 Tauri 코어의 종료 이벤트

- 기준: `tauri-apps/tauri` 태그 `tauri-v2.12.4`(2.12 계열 최신 태그, 조회일 2026-10-21).
- `AppHandle::exit`는 `ExitRequested`와 `Exit`를 발생시킨다(`crates/tauri/src/app.rs:574-581`).
- `ExitRequested`에서 `api.prevent_exit()`로 종료를 막을 수 있다(`app.rs:90`, 문서 예 `app.rs:1378`). 종료 전에 엔진에 shutdown 메시지를 보내고 응답을 기다리는 흐름을 Rust에서 구현할 수 있다. [가정] 구현 가능성은 소스 구조에서 판단했다. 실행으로 확인하지 않았다.
- 신호 처리:
  - tao의 Linux 이벤트 루프(`tauri-apps/tao`, dev 브랜치 `src/platform_impl/linux/event_loop.rs`)에서 SIGTERM이나 SIGINT를 처리하는 코드를 찾지 못했다. 1071행의 "signal"은 GIO activate 시그널이다.
  - GitHub 코드 검색 `SIGTERM repo:tauri-apps/tao`는 0건이었다. 검색 색인의 완전성은 확인하지 못했다.
  - [미확인] SIGTERM이나 SIGINT를 받았을 때 `RunEvent::Exit`가 발생하는지.

### 3.4 종료 원인별 정리 결과

| 종료 원인 | 엔진을 JS로 띄움, 그룹 끔 | 엔진을 JS로 띄움, 그룹 켬 | Rust API로 띄움 |
|---|---|---|---|
| 정상 종료 (`RunEvent::Exit` 발생) | 엔진은 SIGKILL로 정리된다. 엔진의 손자 프로세스는 남는다. | 그룹 전체가 SIGKILL로 정리된다. | 플러그인이 정리하지 않는다. 호출자 코드가 필요하다. |
| 앱 크래시나 SIGKILL (`Exit` 없음) | 엔진이 남는다. [가정] | 그룹이 남는다. [가정] | 남는다. [가정] |
| 앱 SIGTERM | [미확인] `Exit` 발생 여부 미확인 | 같음 [미확인] | 같음 [미확인] |
| Windows에서 앱 크래시 | job 핸들만 닫힌다. 프로세스가 남는다(`job_object.rs:21`). | 같음 | 같음 |

- [가정] "남는다"는 정리 장치가 소스에 없다는 사실에서 도출한 추론이다. 실행으로 재현하지 않았다.
- 비정상 종료 때 엔진이 스스로 멈추는 경로는 §5 3행과 4행에서 다룬다.

### 3.5 Node 가이드의 주의 문장

- 원문: https://v2.tauri.app/learn/sidecar-nodejs/ (2026-10-21 원문 대조).
- 예제 프로세스는 "short lived"이고 "only handle a single command at a time"이라고 적는다. 이어서 "If your application must be long lived, consider using alternative inter-process communication systems"라고 적는다.
- 엔진은 장수명 프로세스다. stdio JSON-RPC 선택을 재검토할 근거다(§5 6행, [미결]).
- 같은 페이지는 "any other tool that can compile JavaScript or Typescript into a binary application will work"라고 적는다. Bun이라는 이름은 패키지 매니저(`bun create tauri-app`, `bun tauri dev`)로만 나온다.

## 4. Q2 근거

### 4.1 Tauri 쪽 공식 지원

- 공식 사이드카 문서와 Node 가이드 모두 `bun build --compile`을 다루지 않는다.
- 가이드의 바이너리 묶기 예는 `@yao-pkg/pkg`다. 런타임을 리소스로 같이 넣는 대안은 "this will ship the JavaScript content as readable-ish files"와 "the runtime is usually larger"라고 적는다.
- 결론: Bun 컴파일 바이너리를 사이드카로 쓰는 것은 Tauri의 일반 규칙(§3.1)을 따르는 선택이다. 공식 사례로 보증되지 않는다.
- [미확인] 공개 이슈와 커뮤니티 사례는 검색하지 않았다. 이번 조사에서 알려진 제약 목록을 완성하지 못했다.

### 4.2 Bun 공식 문서

원문: https://bun.com/docs/bundler/executables (2026-10-21 원문 대조). 문서 버전은 [미확인], Bun 1.4.3 기준과 일치하는지 확인하지 못했다.

- 포함 내용: "Bun bundles all imported files and packages into the executable, along with a copy of the Bun runtime." 런타임 사본이 들어가므로 산출물 크기의 하한은 Bun 런타임 크기다.
- 크기: "Overall though, Bun's binary is still way too big and we need to make it smaller". 수치는 없다. [미확인] 크기 수치.
- 타깃: 표에 8개가 있다. linux x64·arm64(glibc), windows x64·arm64, darwin x64·arm64, linux x64·arm64(musl)다. Tauri triple 대응은 [가정] 일반 지식(`x86_64-unknown-linux-gnu`, `aarch64-apple-darwin` 등)이다. 실제 값은 `rustc --print host-tuple`로 확인해야 한다.
- 플래그: `--minify`, `--sourcemap`(zstd 방식으로 내장), `--bytecode`(시작 시간 단축)를 제공한다.
- 미지원 플래그: "The --compile flag does not support the following flags: --outdir — use outfile instead. --public-path --target=node --target=browser (without HTML entrypoints ...) --no-bundle".
- 상대 경로: "If you use a relative path to a file not included in the standalone executable, Bun loads that path from disk relative to the process's current working directory, and errors if it doesn't exist".
  - 엔진이 플러그인이나 설정 파일을 상대 경로로 읽으면 사이드카 cwd에 의존한다.
  - [제안] 엔진 cwd와 모든 경로를 절대 경로로 고정한다.
- SQLite: "By default, Bun resolves the database relative to the current working directory of the process". `embed: "true"`로 임베드하면 "Because the database is stored in memory, all changes are lost when the executable exits".
  - [제안] 세션 DB는 임베드하지 않고 절대 경로의 디스크 파일로 둔다.
- 워커: "To use workers in a standalone executable, add the worker's entrypoint to the build".
- 런타임 인자: "Standalone executables read the BUN_OPTIONS environment variable". 사이드카는 부모 환경을 상속하므로(`commands.rs:157-159`) 앱의 `BUN_OPTIONS`가 엔진에 전달될 수 있다.
  - [제안] 엔진 env에서 `BUN_OPTIONS`를 제거하거나 env를 명시한다.
- 코드 서명: macOS `codesign` 절차가 있다. 원문은 Bun v1.2.4 이상을 요구한다.
- 자식 프로세스, 시그널, stdin과 stdout, 부모 종료 처리에 관한 문장은 원문에 없다. 원문 검색 0건이다. [미확인] 컴파일 바이너리의 프로세스 수명 동작.
- Windows 메타데이터 플래그(`--windows-icon`, `hideConsole` 등)는 Windows 실행 파일의 메타데이터를 설정한다. WebFetch 요약은 교차 컴파일 시 이 플래그를 쓸 수 없다고 보고했으나, 원문에서 해당 문장을 찾지 못했다. [미확인].

### 4.3 묶기 절차 초안

- [제안] 빌드 흐름:
  1. `bun build --compile --target=bun-<os>-<arch> --outfile src-tauri/binaries/<name>-<triple>`로 플랫폼별 바이너리를 만든다.
  2. `tauri.conf.json`의 `bundle.externalBin`에 `binaries/<name>`을 적는다.
  3. capabilities에 `shell:allow-spawn`과 `"sidecar": true`를 적는다.
- 플랫폼마다 triple별 바이너리가 필요하다. 공식 문서는 "a binary with the same name and a -$TARGET_TRIPLE suffix must exist on the specified path"라고 적는다. 플랫폼별 CI 러너가 필요하다는 점은 stack-status §7-F에서도 기록되어 있다.

## 5. ADR-0008 감수할 점과 미결 대응

| # | 항목 | 현재 가정 (출처) | 조사 결과 | 제안 또는 미결 |
|---|---|---|---|---|
| 1 | 종료 시 체크포인트 | SIGTERM으로 안전 경계에서 체크포인트, 시한 뒤 SIGKILL (`process.md` §6.4) | 플러그인은 SIGKILL만 보낸다 (`process/mod.rs:107`, `shared_child.rs` `src/lib.rs:330`) | [제안] 종료 전에 shutdown 메시지를 stdin으로 보내고, `ExitRequested`에서 응답을 기다린 뒤 종료한다 (`app.rs:90`). |
| 2 | 비정상 종료 시 고아 방지 | 자식 엔진은 stdin EOF 임대 (`process.md` §6.2 단계 1) | 플러그인에 부모 사망 장치가 없다. 쓰기 끝은 앱이 보관한다 (`process/mod.rs:225`, `397`). | [제안] 엔진은 stdin EOF를 읽으면 체크포인트 후 종료한다. 앱이 죽으면 커널이 쓰기 끝을 닫는다는 점은 POSIX 파이프 의미론이다. [가정] 실험 미수행. |
| 3 | 손자 프로세스 | 명시 없음 | 그룹을 끄면 손자가 남는다 (`process/mod.rs:316-318`) | [제안] `processGroup: true`를 기본으로 하고 엔진의 자식을 같은 그룹에 둔다. 정상 종료 경로에서만 그룹 전체가 정리된다는 한계는 §3.4에 적었다. |
| 4 | Windows 크래시 | 명시 없음 | job 핸들을 닫아도 프로세스가 남는다 (`job_object.rs:21`) | [제안] EOF 감시를 1차 방어로 둔다. [미결] 플러그인 상류에 kill-on-close를 요청할지, 자체 wrapper를 둘지. |
| 5 | 정리 코드 위치 | 명시 없음 | Rust API 사이드카는 플러그인이 추적하지 않는다 (`commands.rs:260`) | [제안] 엔진 spawn을 한 곳에서 하고, `CommandChild`를 앱 상태에 보관하며 `RunEvent::Exit`에서 명시적으로 kill한다. |
| 6 | IPC 방식 | stdio JSON-RPC (`foundation-plan.md` §1 3번) | 공식 Node 가이드는 장수명 프로세스에 다른 IPC를 고려하라고 적는다 (§3.5). | [미결] stdio 유지 또는 로컬 소켓. 장수명 엔진에서 stdio 파이프의 버퍼링과 재연결 동작을 spike로 확인한다. |
| 7 | 바이너리 크기 | 사이드카 크기는 L4 plan에서 다룬다 (`foundation-plan.md` §7) | 공식 수치가 없다. "way too big"이라고 적는다. | [미결] 허용 크기 상한. Hello-world와 실제 엔진으로 측정한다. |
| 8 | 환경과 cwd | 명시 없음 | 상대 경로는 cwd 기준이다. env는 기본 상속이다 (`commands.rs:157-159`). | [제안] 엔진의 cwd와 경로를 절대 경로로 고정하고, `BUN_OPTIONS`를 제거한다. |
| 9 | 프로세스 모델 | 데스크톱 셸 기술과 무관하게 자식 방식은 같다 [추측] (`process.md` §6.5 3번) | 자식 방식은 정리 책임을 앱 코드에 넘긴다. 플러그인은 일부만 대신한다. | [제안] ADR-0008에 정리 책임을 명시한다. |

## 6. 미확인 목록

- SIGTERM과 SIGINT를 받았을 때 Tauri가 `RunEvent::Exit`를 발생시키는지. tao 소스 검색과 GitHub 코드 검색 0건만 확인했다.
- Rust API 사이드카의 `CommandChild`를 앱 종료 때 `Drop`으로 정리하는지. `kill_on_drop(true)`와 앱 상태의 drop 순서를 확인하지 않았다.
- Bun 컴파일 바이너리의 자식 프로세스, 시그널, 부모 종료 처리. 문서에 없고 실험도 하지 않았다.
- Bun 바이너리 크기 수치. 측정하지 않았다.
- Windows 메타데이터 플래그의 교차 컴파일 제한. 원문에서 해당 문장을 찾지 못했다.
- Bun 문서 버전과 Bun 1.4.3의 일치 여부.
- `tauri-plugin-shell` 2.x 정식 태그. `v2` 브랜치 커밋 기준으로만 확인했다. v3 정식 버전의 정리 동작도 확인하지 않았다.
- 공개 이슈와 커뮤니티 사례. 검색하지 않았다.
- 종료 시나리오 재현. 실행하지 않았다.

## 7. stack-status [미확인] 항목 처리

| 항목 | 이번 조사 결과 |
|---|---|
| §7-C `bun build --compile` 타깃 8개 | 원문 표로 확인했다 (§4.2). |
| §7-C 크기 수치 없음 | 확인했다. "way too big", 수치 없음 (§4.2). |
| §7-F Bun 엔진 묶기 공식 문서 없음 | 확인했다 (§4.1). |
| §7-F 종료 시 자식 프로세스 정리 설명 없음 | 공식 문서에 없음을 확인했다. 플러그인 소스로 정리 범위를 답했다 (§3.2, §3.4). |

## 8. 제안 실험 (미수행)

- [제안] 종료 원인 4종(창 닫기, SIGKILL, SIGTERM, Windows 크래시)을 재현하는 spike. 프로세스 트리(엔진과 손자)를 확인한다. `xeon/` 밖의 샘플 디렉터리에서 한다.
- [제안] `bun build --compile` 최소 바이너리와 실제 엔진 번들의 크기를 측정한다. Bun 1.4.3 기준으로 한다.
- [제안] stdin EOF 감시 동작을 Linux와 WSL에서 확인한다. macOS와 Windows는 별도 확인이 필요하다.

## 9. 인용 출처

- https://v2.tauri.app/develop/sidecar/ (원문 대조)
- https://v2.tauri.app/learn/sidecar-nodejs/ (원문 대조)
- https://bun.com/docs/bundler/executables (원문 대조)
- `tauri-apps/plugins-workspace` 커밋 `11211c30e71796cd737280303244552bb7f70797`: `plugins/shell/src/lib.rs`, `commands.rs`, `process/mod.rs`, `process/job_object.rs`, `guest-js/index.ts`
- `tauri-apps/plugins-workspace` 태그 `shell-v3.0.0-alpha.3`: `plugins/shell/src/lib.rs:103-110`
- `tauri-apps/tauri` 태그 `tauri-v2.12.4`: `crates/tauri/src/app.rs:90`, `574-581`
- `tauri-apps/tao` dev 브랜치: `src/platform_impl/linux/event_loop.rs`
- `oconnor663/shared_child.rs` master: `src/lib.rs:330`
- 저장소 내부: `_research/foundation-plan.md` §1, §7, `_research/process.md` §6.2, §6.4, §6.5, `_research/stack-status.md` §7-C, §7-F, `_routing/routes.yaml:93`
