---
id: L4.desktop.plan
layer: L4
domain: desktop
kind: plan
status: draft
depends_on: [L4.desktop.spec, L4.host-service.plan, adr.0008, eng.toolchain.guide, eng.testing.guide]
binds: [xeon/apps/desktop/**]
---

# L4 데스크톱 구현 계획 (desktop)

`L4.desktop.spec`을 구현하는 순서와 범위를 정한다. 사이드카 단일 바이너리 크기와 Windows 서명은 `_research/foundation-plan.md §7`이 이 문서에 위임했다(adr.0008 §1).

## 1. 목표와 마일스톤 배치

### 1.1 M0

- 데스크톱 쪽 작업은 없다. `xeon/apps/desktop/package.json`(`"xeon": {"layer": "L4", "domain": "desktop"}`)과 README가 이미 있다.

### 1.2 M1 (이번 실행, 스캐폴드까지)

[결정] 이번 실행은 데스크톱 스캐폴드까지다(`_research/foundation-plan.md §5` P4). Rust 툴체인이 없으므로(`xeon/apps/desktop/README.md`) TS 쪽만 만든다.

- D1: WebView에서 쓸 `StdioTransportFactory` 구현과 `HostConnection`이 엔진 프로세스에 대해 `WIRE_CONFORMANCE_CASES`를 통과한다. 엔진은 `bun xeon/apps/host/src/main.ts host --stdio`로 띄운 실제 프로세스이고, 그 stdin/stdout을 `StdioTransportOptions`에 넘긴다. M1의 stdio 진입은 개발 진입 `bun xeon/apps/host/src/main.ts host --stdio`(`L4.host-service.plan` H5)이고, 컴파일 바이너리의 `xeon host --stdio` 서브커맨드는 M2다.
- 디렉터리·패키지 골격: `src/transport/`, `src/views/`(빈 진입점), `src/settings-store/`(키 정의만), `test/`, `sidecar.json`.
- `src-tauri/`는 만들지 않는다.

### 1.3 M2 (데스크톱 본체)

- Tauri 프로젝트 생성, Rust 릴레이와 엔진 수명 관리(`engine.rs`, `relay.rs`), UI 셸(스레드 목록, 트랜스크립트, 입력창, 상태 표시줄), 승인 대기열.
- 사이드카 빌드 파이프라인(triple 5종), CI(Linux `desktop-build`, 요청 시 실행하는 `desktop-macos`), ad hoc 서명(Windows 서명 준비). Developer ID 서명과 공증은 M3 릴리즈 후보로 옮겼다 [결정: review.m2-plan §8 D3].
- 종료 조건은 `product.scope.spec` M2의 데스크톱 항목(정상 종료 시 사이드카 없음, CLI와 메시지 열 동일)이다.

### 1.4 M3 이후

- 서비스 모드 연동(셸이 서비스 소켓을 릴레이, `L4.desktop.spec` §4.8), 알림(Tauri 알림 플러그인), 자동 업데이트 검토([미결]).
- Windows 네이티브 정식 지원(배포 채널, SmartScreen 평판이 쌓이는 기간 포함).

## 2. 패키지와 파일 배치

```
xeon/apps/desktop/
  package.json                    # @xeon/desktop. 의존: @xeon/contracts(workspace:*), typebox, react·react-dom·zustand(adr.0010)
  tsconfig.json                   # src: DOM lib, types []. test: bun 타입(별도 tsconfig.test.json) [제안]
  bunfig.toml                     # [test] coverageThreshold lines 0.5, functions 0.5 (eng.testing.guide TS-10 L4 행)
  sidecar.json                    # 사이드카 이름·인자·triple 표의 단일 원천 [제안]
  index.html                      # bun build HTML 진입점 (M2)
  src/
    main.ts                       # WebView 진입점 (M2)
    index.ts                      # 패키지 공개 진입점 (M1: transport 재노출)
    transport/
      ipc.ts                      # DesktopIpc, EngineState 스키마, createTauriIpc (@tauri-apps/* 허용 파일, W2)
      tauri-stdio.ts              # attachRelay, openEngineConnection, CursorStore, resubscribe
      json-lines.ts               # StdioTransportFactory 구현 (F 이관 전까지, spec §10 미결 3)
      connection.ts               # createHostConnection (F 이관 전까지)
      index.ts
    shell/                        # 창, 트레이, 알림 (M2, M3). @tauri-apps/* 허용 (W2)
    views/                        # threads/, transcript/, composer/, approvals/, status-bar/ (M2)
    settings-store/
      defs.ts                     # defineSettings("l4.desktop", ...) (spec §6)
      index.ts                    # DesktopSettingsStore
    settings/                     # L4.settings-ui 소유. 이 계획의 범위 밖
  scripts/
    cargo.sh                      # cargo test|check|run|build 진입 (just desktop-test|desktop-run|desktop-build). verify 밖
  src-tauri/                      # M2. 층 규칙 밖 (eng.dependency-rules.guide DR-13)
    Cargo.toml                    # rust-version 1.99. rust-toolchain.toml은 없다(§3.2.1)
    Cargo.lock
    build.rs                      # 앱 명령 권한(allow-engine-*) 생성
    .cargo/config.toml            # jobs = 2로 묶는다. target-dir은 두지 않는다: scripts/cargo.sh가 CARGO_TARGET_DIR을 ${XDG_CACHE_HOME:-$HOME/.cache}/xeon/cargo-target(Syncthing 밖, 기기별, spike/shell과 공용)으로 정한다
    tauri.conf.json
    capabilities/default.json
    ui/index.html                 # DESK.4 전까지의 자리 표시 화면(frontendDist)
    binaries/                     # xeon-<triple>[.exe]. 빌드 산출물, 커밋하지 않는다 (TC-05)
    src/
      main.rs                     # 앱 조립, RunEvent 처리, 신호 처리기
      engine.rs                   # Supervisor: spawn·종료·재기동 (spec §4.1 E1~E11, §4.4), Launcher 추상화
      relay.rs                    # 줄 버퍼, 신용, stdin 쓰기 스레드, 셸 명령 engine_* (spec §3.3)
      applog.rs                   # 앱 로그 파일(바이트 수만 기록, E11)
      time.rs                     # RFC 3339 UTC 문자열
  test/
    transport-conformance-stdio.int.test.ts
    shutdown-message-then-exit.int.test.ts
    stdin-eof-checkpoint.int.test.ts
    no-grandchild-left.int.test.ts
    reconnect-resubscribe-from-cursor.test.ts
    relay-line-framing.test.ts
    sidecar-config.test.ts
    memory/                       # S5 측정 스크립트와 MemorySample 형식 (verify 밖)
    e2e/                          # *.e2e.test.ts (verify 밖, M2)
xeon/scripts/
  build-sidecar.ts                # sidecar.json을 읽어 bun build --compile 실행 (층 밖 저장소 도구) [제안]
  build-sidecar.test.ts           # sidecar-triple-mapping
```

- `xeon/scripts/build-sidecar.ts`는 패키지를 import하지 않는다(`eng.dependency-rules.guide` 1절 제외 항목). 그래서 공유 값은 코드 상수 대신 데이터 파일 `sidecar.json`에 둔다. 이 계획의 `binds`는 `xeon/apps/desktop/**`이므로 스크립트 파일 위치는 `eng.toolchain.guide`와 함께 확인한다 [미결: 스크립트 위치].
- `xeon/justfile`에 레시피 `desktop-sidecar <triple>`, `desktop-run`, `desktop-build`, `desktop-measure`를 더한다(TC-09). M1에는 `desktop-sidecar`만 둔다 [제안].

### 2.1 `sidecar.json`

[제안] 사이드카 이름은 adr.0008 §3.2의 [제안]과 `L4.host-service.spec` §3.2의 단일 바이너리 [제안]을 따른다. `L4.host-service.spec`이 바꾸면 이 파일만 고친다.

```json
{
  "name": "xeon",
  "args": ["host", "--stdio"],
  "entry": "../cli/src/main.ts",
  "maxSizeMiB": 500,
  "targets": {
    "aarch64-apple-darwin": "bun-darwin-arm64",
    "x86_64-apple-darwin": "bun-darwin-x64",
    "x86_64-unknown-linux-gnu": "bun-linux-x64",
    "aarch64-unknown-linux-gnu": "bun-linux-arm64",
    "x86_64-pc-windows-msvc": "bun-windows-x64"
  }
}
```

- `maxSizeMiB`는 triple별 사이드카 크기 상한이다(§3.1.1 S2의 사용자 결정, 500). 빌드 스크립트가 읽는다.
- 산출 파일명은 `src-tauri/binaries/<name>-<triple>`, Windows는 끝에 `.exe`를 붙인다(adr.0008 §3.2 파일 위치 행).
- `entry`는 엔진 바이너리의 컴파일 진입점이다. 단일 바이너리안(`L4.host-service.spec` §3.2, `L4.cli.plan` §4.3)에 따라 `apps/cli/src/main.ts`를 쓴다. `apps/host/src/main.ts`는 개발·테스트 진입이고 배포 진입점이 아니다(D1에서만 쓴다). `L4.readme` §8 미결 2가 단독 사이드카안으로 정해지면 `name`, `args`, `entry`를 함께 바꾼다.
- `apps/desktop`은 이 파일을 import하지 않고 빌드 스크립트가 경로로만 쓴다(DR-10).
- triple 대응은 [가정] 일반 지식이다. 실제 triple은 각 러너에서 `rustc --print host-tuple`로 확인한다(`_research/notes/arch-2.md §4.2` 타깃 항목).
- Windows arm64(`bun-windows-arm64`)와 musl Linux는 목록에 없다. 필요해지면 행을 더한다.

### 2.2 `tauri.conf.json` 발췌 (M2)

adr.0008 §3.2 형식을 따른다.

```jsonc
// src-tauri/tauri.conf.json (발췌)
{
  "bundle": {
    "externalBin": ["binaries/xeon"],
    "macOS": {
      "frameworks": ["../vendor-libs/macos/libsqlite3.dylib"],   // FTS5 SQLite (D8). resources에 두지 않는다
      "hardenedRuntime": true
    },
    "windows": {
      "webviewInstallMode": { "type": "downloadBootstrapper" }    // spec §4.11 기본값 제안
    }
  }
}
```

- `frameworks`의 경로와 `vendor-libs` 디렉터리 이름은 [제안]이다. dylib 출처(직접 빌드 또는 배포판)는 D8에서 정한다.
- 키 이름(`macOS.frameworks`, `windows.webviewInstallMode`)은 Tauri 2.12 설정 스키마와 D2에서 대조한다 [가정].

### 2.3 capabilities 발췌 (M2)

adr.0008 §3.2의 발췌를 옮긴다. spec §3.5의 제안대로 (a)안에서는 WebView가 spawn하지 않으므로 아래 `shell:allow-spawn` 항목은 기본 파일에 넣지 않고, (b)안으로 되돌릴 때의 형식으로만 둔다.

```jsonc
// src-tauri/capabilities/default.json (발췌, (b)안으로 되돌릴 때)
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    {
      "identifier": "shell:allow-spawn",
      "allow": [{ "name": "binaries/xeon", "sidecar": true, "args": ["host", "--stdio"] }]
    }
  ]
}
```

```jsonc
// src-tauri/capabilities/default.json (발췌, (a)안 기본) [제안]
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": ["core:default", "allow-engine-attach", "allow-engine-write", "allow-engine-restart", "allow-engine-detach",
                  "allow-desktop-settings-read", "allow-desktop-settings-write"]
}
```

- 앱 명령 권한 이름(`allow-engine-attach` 등)은 Tauri의 앱 명령 권한 생성 규칙에 맞춰 D2에서 확정한다 [가정].

## 3. 작업 분해

### 3.1 선행 spike

[제안] spike 코드는 `xeon/` 밖 샘플 디렉터리(예: 저장소 밖 임시 작업 디렉터리)에서 한다(`_research/notes/arch-2.md §8`). 결과는 `_research/notes/`에 조사 노트로 남기고, 이 문서와 spec의 [가정]·[미결]을 고친다. 내려받은 Tauri·Bun 코드는 spike 담당자가 별도 승인 아래 실행한다. 이 문서 작성 과정에서는 실행하지 않았다.

| id | 내용 | 선행 | 규모 | 완료 판정 |
|---|---|---|---|---|
| S1 | 종료 원인 4종(창 닫기, 앱 SIGKILL, 앱 SIGTERM, Windows 크래시)에서 셸 → 엔진 → 손자의 프로세스 트리를 확인한다. Rust API spawn + 프로세스 그룹 켬 + stdin EOF 감시 조합이다. SIGTERM에서 `RunEvent::Exit` 발생 여부, Rust API 사이드카의 capabilities 비적용도 본다 | - | M | macOS·Linux에서 4종(Windows는 크래시만) 각각 종료 10초 뒤 남은 프로세스 목록이 표로 남는다. 남는 경우마다 원인과 대응이 spec E 규칙에 반영된다 |
| S2 | hello-world와 실제 엔진 번들(`sidecar.json`의 `entry`, 곧 `apps/cli/src/main.ts`)의 `bun build --compile` 바이너리 크기를 플래그 조합(`--minify`, `--bytecode`, `--sourcemap` 유무)별로 잰다 | - | S | 5 triple 중 러너가 있는 것의 크기 표와 상한 제안이 이 문서 §7에 기록된다. 상한값이 사용자 확인을 받는다 |
| S3 | 장수명 엔진의 stdio 동작: 1 MiB 프레임, 초당 수천 개의 작은 프레임, Tauri `Channel` 원시 바이트 전달, 셸 송신 버퍼가 찰 때의 역압, 세대 교체 때 줄 경계 버림 | - | M | 위 다섯 경우에서 프레임 손실·중복 0, 처리량과 지연 수치가 기록된다. stdio 유지 또는 소켓 전환 판정(spec §10 미결 13)이 나온다 |
| S4 | stdin EOF 감시를 Linux와 WSL에서 확인한다. 부모가 SIGKILL될 때 Bun 컴파일 바이너리가 EOF를 읽고 끝나는지, 손자 프로세스가 어떻게 되는지 | - | S | 두 환경에서 EOF 뒤 종료까지 걸린 시간과 손자 잔존 여부가 기록된다. spec D-02의 시한(`l0.process.shutdown.timeoutMs` 기본 3000ms)이 충분한지 판정이 나온다 |
| S5 | 메모리 측정 스크립트: spec §3.7 `MemorySample`을 남기는 측정기. 플랫폼별 프로세스 찾기(셸, WebView 보조 프로세스, 사이드카, 손자) | S1 | M | 3 플랫폼 중 가능한 것에서 B1~B4 시나리오 측정값이 JSON Lines로 남는다. 예산(spec §10 미결 8) 확정 제안이 나온다 |

### 3.1.1 spike S1~S4 결과 (2026-10-24, Linux/WSL2)

M2 DESK.1(`m2/desk` 브랜치)이 S1~S4를 실행한 결과다. 위 3.1의 "spike는 `xeon/` 밖에서 한다"는 제안과 달리 코드를 `xeon/apps/desktop/spike/`에 두었다. 워크트리 안에서 재실행할 수 있게 하려는 것이고, `spike/`는 lint 대상에서 빼고(typecheck, fmt-check, `check-ts-rules`, knip, check-layers는 적용) 제품 코드가 아니다. 프로세스를 띄우는 TS 하네스는 DR-07의 test 범위 허용(`DR-07/desktop-test-spawn`)이 `tests/` 경로 파일에만 적용되므로 `spike/tests/`에 둔다. Rust 셸은 `spike/shell/`(Cargo 프로젝트, `Cargo.lock` 포함, 빌드 산출물은 `.cargo/config.toml`이 저장소 밖(워크트리의 형제 디렉터리 `target-m2-desk-spike`)에 둔다)이다.

**환경**

| 항목 | 값 |
|---|---|
| OS | WSL2 Ubuntu, 커널 6.18.33.2-microsoft-standard-WSL2, 12 코어, 메모리 8 GB |
| 창 | WSLg(`DISPLAY=:0`, XWayland) 위에서 실제 창이 열렸다. GL은 llvmpipe(소프트웨어) |
| WebView | WebKitGTK 2.52.6(`webkit2gtk-4.1`) |
| 도구 | Bun 1.4.3, Rust 1.99.1, `tauri` =2.12.3(CLI 고정 2.12.3과 같은 부 버전. 이 문서 끝의 [가정] =2.12.4와 다르다), `tauri-build` =2.7.4, `tauri-plugin-shell` =2.5.0 |
| 빌드 | S1은 debug, S3 수치는 release(`cargo build --release`) |
| 하지 않은 것 | macOS, Windows, 네이티브 Linux는 러너가 없어 실행하지 못했다. S1의 Windows 크래시 행도 그렇다. 창 닫기는 창 관리자의 X 단추 대신 같은 `CloseRequested` 경로를 타는 `Window::close()`를 Rust에서 불러 재현했다(`xdotool` 등이 없다) |

실행 방법은 `apps/desktop/package.json`의 `spike:*` 스크립트와 `spike/s1-matrix.sh`, `spike/s2-size.sh`, `spike/tests/s4.ts`다. 엔진은 `spike/tests/engine.ts`를 `bun build --compile`한 가짜 엔진이고(손자 `sleep 600`을 같은 그룹 또는 새 세션으로 띄우고, EOF 정책을 `exit-clean`·`exit-noclean`·`ignore`로 고른다), 실제 호스트(`apps/host/src/main.ts host --stdio`를 컴파일한 것)는 S2와 S4에서만 썼다.

#### S1 종료 원인별 잔존 프로세스 (종료 10초 뒤)

가짜 엔진 4종(손자 위치 x EOF 처리)에 대해 셸 → 엔진 → 손자 트리를 남은 프로세스로 확인했다. 표는 "남은 것"이다. 엔진은 Rust API(`app.shell().command(..).set_process_group(true).spawn()`)로 띄웠고, 셸 capabilities에는 `core:default`만 있다.

| 종료 원인 | 셸의 `Exit` 때 하는 일 | 손자 같은 그룹, EOF 종료 | 손자 같은 그룹, EOF 무시 | 손자 새 세션, EOF 종료 | 손자 새 세션, EOF 무시 |
|---|---|---|---|---|---|
| 창 닫기(`CloseRequested`, `ExitRequested`, `Exit` 발생) | 없음 | 없음 | 엔진, 손자 | 없음 | 엔진, 손자 |
| 창 닫기 | 그룹 SIGKILL | 없음 | 없음 | 손자 | 손자 |
| 앱 SIGKILL | 해당 없음 | 없음 | 엔진, 손자 | 없음 | 엔진, 손자 |
| 앱 SIGTERM, 처리기 없음(`RunEvent`가 하나도 오지 않고 프로세스가 사라진다) | 실행되지 않음 | 없음 | 엔진, 손자 | 없음 | 엔진, 손자 |
| 앱 SIGTERM, 처리기 있음(`signal-hook` → `app.exit(0)`, `ExitRequested code=Some(0)`, `Exit` 발생) | 없음 | 없음 | 엔진, 손자 | 없음 | 엔진, 손자 |
| 앱 SIGTERM, 처리기 있음 | 그룹 SIGKILL | 없음 | 없음 | 손자 | 손자 |
| Windows 앱 크래시 | - | 미실행 | 미실행 | 미실행 | 미실행 |

- 프로세스 그룹을 끈 경우(`set_process_group(false)`)에 `Exit`에서 `CommandChild::kill`을 하면 엔진만 죽고 같은 그룹이던 손자가 남는다(창 닫기와 SIGTERM 처리기 모두, EOF 종료·무시 엔진 모두에서 확인).
- 셸이 사라진 뒤 EOF를 읽은 엔진이 끝나기까지는 약 62 ms 안이었다(폴링 간격 포함, 정밀 수치는 S4). `Exit`에서 그룹 SIGKILL을 하면 엔진과 같은 그룹 손자는 9 ms 안에 사라졌다.
- Rust API로 띄운 사이드카는 플러그인이 추적하지 않는다. 정책을 "아무것도 안 함"으로 둔 창 닫기에서 EOF를 무시하는 엔진이 그대로 남은 것이 이를 보인다.
- capabilities 비적용: 셸 플러그인 권한이 하나도 없는 capabilities에서도 Rust API spawn은 동작했다. 같은 창에서 JS의 `plugin:shell|execute` 호출은 `Command plugin:shell|execute not allowed by ACL`(debug 빌드는 `shell.execute not allowed. Permissions associated with this command: shell:allow-execute`)로 거부됐다.

S1에서 spec에 반영할 내용:

1. SIGTERM에서 `RunEvent::Exit`는 처리기를 두지 않으면 오지 않는다(spec §4.3 [미확인] 해소). 처리기를 두면 `ExitRequested`(code `Some(0)`)와 `Exit`가 온다.
2. 앱 SIGKILL과 처리기 없는 SIGTERM은 셸 코드가 돌지 않으므로 E5(stdin EOF 임대)만이 방어다. EOF를 무시하는 엔진은 어떤 종료 원인에서도 그대로 남는다.
3. `Exit`에서 곧바로 그룹 SIGKILL을 하면 EOF 처리 기회를 빼앗아, 엔진이 새 세션으로 띄운 손자(E9가 금지하는 구성)를 정리하지 못한 채 남긴다. spec §4.3의 순서(EOF와 `host.shutdown` 먼저, 시한 뒤 그룹 SIGKILL)가 맞다.
4. E3(프로세스 그룹)은 필수다. 끄면 그룹 SIGKILL이 손자에 미치지 않는다.

#### S2 `bun build --compile` 크기

호스트 실행 파일(Linux x64), 단위 MiB. 진입은 hello world, `apps/host/src/main.ts`(host), `apps/cli/src/main.ts`(cli, `sidecar.json`의 `entry`)다.

| 진입 | 기본 | `--minify` | `--minify --sourcemap` | `--minify --bytecode` | `--minify --bytecode --sourcemap` |
|---|---|---|---|---|---|
| hello | 86.6 | 86.6 | 86.6 | 86.6 | 86.6 |
| host | 93.3 | 90.3 | 95.1 | 102.2 (*) | 107.0 (*) |
| cli | 93.6 | 90.4 | 95.4 | 102.6 (*) | 107.7 (*) |

(*) `apps/host/src/main.ts` 끝의 최상위 `await`(`process.exit(await runFromProcess(..))`) 때문에 원래 코드로는 `--bytecode`가 `"await" can only be used inside an "async" function`으로 실패한다. cli도 host를 가져오므로 같다(`L4.cli.plan` §4.3은 최상위 await를 쓰지 말라고 적었다). 위 수치는 그 한 줄을 `.then()`으로 바꾼 임시 작업 사본에서 쟀고 저장소 코드는 바꾸지 않았다. host 담당 레인에 알려야 한다.

다른 triple(교차 컴파일, `--minify`, 실행하지 않음):

| triple | hello | host |
|---|---|---|
| aarch64-apple-darwin | 67.6 | 71.3 |
| x86_64-apple-darwin | 75.1 | 78.7 |
| x86_64-unknown-linux-gnu | 86.6 | 90.3 |
| aarch64-unknown-linux-gnu | 86.2 | 89.8 |
| x86_64-pc-windows-msvc | 91.9 | 95.6 |

- 크기의 약 96%는 Bun 런타임이다(hello 86.6 MiB에 호스트 앱 코드가 `--minify`로 3.7 MiB 더해진다). 플래그로 줄일 수 있는 것은 `--minify`의 3 MiB 안팎이고, `--bytecode`는 12 MiB를 늘리는 대신 콜드 스타트를 반으로 줄인다(아래 S4).
- 교차 컴파일은 5 triple 모두 성공했다. 크기 표 외 실제 동작은 러너가 있는 Linux x64에서만 확인했다.
- [결정: 사용자 2026-10-24] 실행 체감 속도(빠른 시작과 종료, 끊김 없는 응답)를 앱 크기보다 우선한다. 사이드카는 `--minify --bytecode`로 빌드한다(콜드 스타트 약 285 ms → 131 ms, 크기 약 +12 MiB). 크기 상한은 triple별 500 MiB로 넉넉히 둔다. 상한 검사는 회귀를 잡는 장치이고 크기를 줄이는 목표가 아니다. `--bytecode` 전에 `apps/host/src/main.ts`와 `apps/cli/src/main.ts`의 최상위 `await`를 없앤다(HOST.5, L4.cli.plan §4.3).

#### S3 장수명 stdio 처리량과 역압

경로: 엔진 stdout → 플러그인 읽기 스레드(청크 약 8 KiB, 용량 1인 채널) → `relay`(Tokio 작업) → Tauri `Channel`(원시 바이트, 앞에 종류 1바이트와 세대 8바이트) → WebView. 프레임은 줄 단위 JSON이고 번호(`seq`)로 손실·중복을 센다. release 빌드, 신용(credit) 4 MiB 사용:

| 경우 | 결과 |
|---|---|
| A. 1 MiB 프레임 x 64 (원시 Channel) | 손실 0, 중복 0. 29.3 MiB/s, 프레임 지연 p50 160 ms, p99 233 ms |
| A0. 같은 부하를 줄 해석 없이 바이트만 셈 | 30.9 MiB/s (신용 없음 39.8). 메시지 8255개, 평균 약 8 KiB. 전송 경로 자체의 상한 |
| A1. 1 MiB 프레임 x 256 | 손실 0, 중복 0. 28.6 MiB/s, p50 168 ms, p99 261 ms |
| B. 64 B 프레임 x 50,000 한꺼번에 | 손실 0, 중복 0. 115,000 프레임/s (13.6 MiB/s), 지연 p50 225 ms(대기열), p99 314 ms |
| B2. 64 B 프레임 초당 약 5,000개를 5초 | 손실 0, 중복 0. 4,787 프레임/s 달성, 지연 p50 1 ms, p99 4 ms, 최대 10 ms |
| C. 원시 대신 JSON 숫자 배열로 전송(비교군) | 1 MiB x 16은 17.0 MiB/s(원시 29.3), 64 B x 50,000은 102,000 프레임/s. 손실 0. 원시가 큰 프레임에서 1.7배 |
| D. 셸 송신 버퍼가 참: 엔진이 stdin을 3초 읽지 않을 때 WebView가 1 MiB x 32를 씀(`spawn_blocking` 비동기 명령) | 쓰기는 엔진이 다시 읽기 시작한 3,009 ms에 풀리기 시작해 3,117 ms에 전부 끝났다. 엔진 수신 32줄, 누락 0, 중복 0. 그동안 메인 스레드 IPC 왕복 p50 1 ms, 최대 8 ms |
| D2. 같은 부하를 동기 명령(Tauri 2에서는 메인 스레드 실행)으로 씀 | 데이터는 D와 같이 전부 도착했지만 메인 스레드 IPC 왕복이 p50 1,583 ms, 최대 3,019 ms로 멈췄다. WebView 안의 JS 타이머 간격(최대 170 ms 이내)은 영향이 없었다(WebKitGTK는 웹 프로세스가 따로다) |
| E. 세대 교체: 엔진이 프레임 절반(줄바꿈 없음)을 쓰고 죽은 뒤 새 엔진이 100프레임 | 세대별 줄 버퍼 + 종료 때 꼬리 버림: 이전 세대 꼬리 49 B 1개를 버리고 새 세대 100/100 프레임 정상, 깨진 줄 0. 세대를 구분하지 않는 단일 버퍼는 새 세대 첫 프레임이 꼬리와 붙어 깨진 줄 1개가 생겨 그 프레임을 잃었다 |

**정지 발견**: 신용 없이(Rust가 Channel로 즉시 흘림) 256 MiB를 한꺼번에 보내면 release 빌드에서 WebView가 약 36 MiB 시점에서 메시지를 더 받지 못하고 멈추는 일이 반복됐다(16회 중 8회). Rust는 그때 이미 29,000개 넘는 메시지를 보냈고 엔진은 쓰기를 끝내고 idle이었으며 JS 타이머는 계속 돌았다. 전송은 손실 쪽이 아니라 중간 어딘가에서 멈춘 것이다(debug 빌드 2회는 통과). JS가 처리한 양을 알리고(`engine_ack`, 256 KiB마다) Rust가 보낸 양과 처리한 양의 차가 4 MiB를 넘으면 보내지 않는 신용 기반 역압을 두자 48회 중 1회만 정지했다(원인 미분류. 하네스 25초 제한에 걸린 느린 실행일 수 있다). 신용이 차면 플러그인의 용량 1 채널이 차서 읽기 스레드가 멈추고 엔진의 stdout 쓰기가 막힌다. 즉 역압이 엔진까지 전달된다.

판정 (spec §10 미결 13): [제안] stdio를 유지한다. 근거는 일반 부하 여유다(B2: 초당 5,000개 프레임에서 지연 p99 4 ms, 큰 프레임 1 MiB도 약 29 MiB/s, 모든 경우에서 손실·중복 0). 조건 세 가지:

1. 릴레이는 신용 기반 역압을 둔다(위 정지 발견). `Channel`을 무제어로 쓰지 않는다. 정지의 상류 원인(Tauri `Channel`의 대용량 지속 송신)은 확인하지 못했다. 소켓 전환은 이 조건으로도 정지가 남을 때의 대안이다. macOS(WKWebView)와 Windows(WebView2)에서는 재측정이 필요하다.
2. 엔진 stdin 쓰기는 비동기 명령이고, 막힌 쓰기가 앱 상태의 `CommandChild` 락을 쥐지 않는다. 이번 spike의 `engine_write`는 `Mutex<Option<CommandChild>>`를 쥔 채 블로킹 쓰기를 해서 같은 락이 필요한 `engine_kill`이 쓰기 뒤에 줄을 선다. 제품에서는 쓰기 전용 작업과 쓰기 대기열(한도 있음)로 나눈다. D2가 보였듯 동기 명령으로 쓰면 UI 프로세스 메인 스레드가 엔진이 읽을 때까지 멈춘다.
3. 줄 버퍼는 세대별로 두고 종료 때 꼬리를 버린다(E). 줄 경계는 새로 온 조각에서만 찾는다(조각마다 누적 문자열을 다시 훑으면 1 MiB 프레임에서 처리량이 절반 이하로 떨어졌다. 이번 측정 중 실제로 겪었다).

#### S4 stdin EOF 감시 (Linux/WSL2)

부모(`parent-stub.ts`)를 SIGKILL하고, OS가 엔진의 stdin 파이프 쓰기 끝을 닫는 순간부터 엔진 프로세스가 사라질 때까지를 2 ms 간격으로 쟀다(변형마다 20회, 단위 ms). Linux와 WSL을 따로 쟀어야 하지만 이 기기는 WSL2뿐이라 한 열이다. 네이티브 Linux는 미측정이다.

| 엔진(모두 `bun build --compile`) | EOF → 종료 중앙값 | 최대 | 종료 못함 | 종료 후 손자 잔존 |
|---|---|---|---|---|
| 가짜, 손자 없음, EOF 종료 | 4.2 | 40.1 | 0/20 | - |
| 가짜, 손자 같은 그룹, EOF 때 손자 정리 | 4.1 | 4.5 | 0/20 | 0/20 |
| 가짜, 손자 새 세션, EOF 때 손자 정리 | 4.2 | 4.7 | 0/20 | 0/20 |
| 가짜, 손자 같은 그룹, EOF 종료만 하고 손자 정리 안 함 | 4.0 | 5.3 | 0/20 | 20/20 |
| 가짜, 손자 새 세션, EOF 종료만 하고 손자 정리 안 함 | 4.5 | 19.0 | 0/20 | 20/20 |
| 가짜, EOF 무시 | - | - | 20/20 | 20/20 |
| 실제 호스트 `host --stdio`, 기본 | 28.8 | 61.2 | 0/20 | 손자 없음 |
| 실제 호스트, `--minify` | 27.9 | 34.7 | 0/20 | 손자 없음 |
| 실제 호스트, `--minify --bytecode`(임시 사본) | 21.9 | 32.4 | 0/20 | 손자 없음 |

- 엔진이 EOF를 읽고 끝나는 것은 확인됐다. 손자는 엔진이 EOF 처리 때 직접 정리하지 않으면 남는다(같은 그룹이어도 부모가 없을 뿐 그룹이 알아서 죽지 않는다). 이것이 spec E9의 근거다.
- 기동 시간(spawn → 빈 stdin으로 즉시 종료까지, 20회 중앙값): 호스트 기본 328 ms, `--minify` 285 ms, `--minify --bytecode` 131 ms. 가짜 엔진은 spawn에서 준비까지 14 ms.
- 판정 (spec D-02): 기본 시한 `l0.process.shutdown.timeoutMs` 3000 ms는 EOF를 읽은 뒤의 종료 경로 자체에는 충분하다(최대 61 ms, 약 50배 여유). 다만 이 측정은 진행 중인 turn이 없는 호스트이고 체크포인트 커밋 시간은 포함하지 않는다. 부하가 있는 호스트의 체크포인트 시간은 [미확인]이고 DESK.5 e2e에서 잰다.

### 3.2 구현 작업

| id | 내용 | 선행 | 규모 | 단계 |
|---|---|---|---|---|
| D1 | TS `StdioTransportFactory` 구현(`json-lines.ts`)과 `createHostConnection`(`connection.ts`), 적합성 테스트. 엔진을 `bun xeon/apps/host/src/main.ts host --stdio`(개발 진입)로 띄워 `WIRE_CONFORMANCE_CASES`를 돌린다. 디렉터리·패키지 골격, `sidecar.json`, `settings-store/defs.ts` | F W12·W14(`F.wire-settings.plan`), `L4.host-service.plan` H5(stdio 전송과 `main.ts` 개발 진입) | M | M1 |
| D2 | Tauri 프로젝트 생성(`src-tauri/`), `tauri.conf.json`, capabilities, `rust-toolchain.toml`, 버전 고정 | S1 | S | M2 |
| D3 | 사이드카 빌드 스크립트 `xeon/scripts/build-sidecar.ts`와 just 레시피. `sidecar.json`의 `entry`(`apps/cli/src/main.ts`, S2와 같은 진입 파일)를 triple 5종 → bun target 대응으로 컴파일해 `binaries/xeon-<triple>`을 만든다. 크기 상한 검사(S2 결과) | S2, D1(`sidecar.json`) | S | M2 (스크립트 골격과 대응 단위 테스트는 M1에 둘 수 있다) |
| D4 | `engine.rs`: spawn(E1, E3, E6, E7), 앱 상태 보관(E2), 정상 종료 순서(spec §4.3), 재기동 정책(spec §4.4), Unix 신호 처리기, stderr 로그(E10, E11) | D2, S1, S4 | L | M2 |
| D5 | `relay.rs`: `EnginePipe`, 셸 명령 `engine_*`, 세대 관리와 줄 경계 버림, 송신 버퍼 한도 | D4, S3 | M | M2 |
| D6 | UI 셸: `transport/ipc.ts`·`tauri-stdio.ts`, 스레드 목록, 트랜스크립트(가상 스크롤, 조각 합치기), 입력창, 상태 표시줄, 설정 진입점 | D5, 상태 관리 결정(spec §10 미결 11). 프레임워크는 React 19 [결정: review.m2-plan §8 D2] | L | M2 |
| D7 | 승인 대기열 화면. A안 [가정] 기준 | D6, F 승인 방향 결정(`F.wire-settings.spec` §10 미결 1) | M | M2 |
| D8 | macOS 커스텀 SQLite(FTS5) dylib을 `bundle.macOS.frameworks`로 번들하고 서명 대상에 넣는다(`eng.toolchain.guide` TC-11). 엔진이 `setCustomSQLite`에 넘길 절대 경로를 사이드카 실행 파일 기준으로 계산하는 규칙을 `L0.store.spec`과 맞춘다 | D2, D3 | M | M2 |
| D9 | CI(§3.3): Linux `desktop-build` job(review.m2-plan Z.1), macOS `desktop-macos` job은 `workflow_dispatch`나 PR 라벨 `ci:macos`로만 실행 [결정: review.m2-plan §8 D1]. 러너별 호스트 아키텍처 제약 반영 | D3, D2 | M | M2 |
| D10 | 서명·배포(§3.4): macOS ad hoc 서명, Windows 서명 준비, Linux 패키지(AppImage, deb)와 WebKitGTK 의존 선언 | D9, D8 | L | M2 (Developer ID 서명·공증은 M3 릴리즈 후보 [결정: review.m2-plan §8 D3], Windows 정식 배포는 M3 이후) |
| D11 | e2e: 앱 실행 → 한 턴 → 종료 → 프로세스 잔존 확인, CLI와 메시지 열 비교. `*.e2e.test.ts` | D6, D10 | M | M2 |
| D12 | 서비스 모드 연동: `SocketPipe`, `ensure` 호출, 서비스 소실 처리 | D5, `L4.host-service.plan` 서비스 모드 | M | M3 |
| D13 | 알림: `tauri-plugin-notification` 연결. 켜기·종류는 `l2.dialog.notify.*`를 따른다(review.decisions-2 S-04) | D12, 내구 이벤트 kind 기반 대상 선택(spec §4.8), 알림 전용 wire는 M2 계획에서 정한다(spec §10 미결 5) | S | M3 |
| D14 | 자동 업데이트 검토 | D10 | S | M3 [미결] |

- 규모: S는 하루 안, M은 2~4일, L은 1주 이상 [가정].
- D1의 `Bun.spawn` [결정: review.decisions-2 B-06]: `eng.dependency-rules.guide` DR-07의 테스트 한정 행으로 푼다. 허용 목록 `DR-07/desktop-test-spawn`(from `apps/desktop`, to `Bun.spawn`, `scope: "test"`)을 쓰고, 운영 소스에서는 여전히 금지다. `L4.host-service.plan`과 `L4.cli.plan`의 자식 프로세스 테스트도 같은 방식이다(`DR-07/cli-test-spawn`).
- D1의 실행 명령: M1의 stdio 진입은 개발 진입 `bun xeon/apps/host/src/main.ts host --stdio`(`L4.host-service.plan` H5)이고, 컴파일 바이너리의 `xeon host --stdio` 서브커맨드는 M2다. 그래서 D1은 `bun xeon/apps/host/src/main.ts host --stdio`를 실행한다(`L4.host-service.spec` §3.2 개발 실행 항목). M2부터는 같은 테스트를 컴파일 바이너리 `xeon host --stdio`로도 돈다. 둘 다 import가 아닌 실행이므로 DR-10에 맞는다.

### 3.2.1 M2 DESK.2·DESK.3 구현 기록 (2026-10-24, `m2/desk`)

D2(Tauri 프로젝트), D3(빌드 스크립트), D4(`engine.rs`), D5(`relay.rs`)의 구현 결과다. UI 셸(D6, DESK.4)은 상태 관리 결정을 기다리므로 포함하지 않았다.

| 항목 | 상태 | 내용 |
|---|---|---|
| D2 | 완료 | `src-tauri/` 생성. `tauri =2.12.3`, `tauri-plugin-shell =2.5.0`. WebView 권한은 `core:default`와 `allow-engine-*` 다섯 개이고 `shell:*`는 없다. `build.rs`의 앱 매니페스트가 명령 목록을 고정한다 |
| D3 | 완료(빌드 자체는 host 쪽 수정 대기) | `xeon/scripts/build-sidecar.ts`. `bun build --compile --minify --bytecode --target=<bun target> <entry> --outfile src-tauri/binaries/<name>-<triple>[.exe]`, 크기 상한 검사(500 MiB), `--no-bytecode`(진단용), `--list`. 단위 시험은 triple 대응, 파일명, 크기 경계, 오류 분류, 최상위 `await` 안내를 빌드 없이 검사한다. `host` 별칭은 실행 중인 기기의 triple을 쓴다. 최상위 `await` 때문에 `--bytecode` 빌드는 HOST.5가 합쳐진 뒤 성공한다. `--no-bytecode`로는 Linux x64에서 90.4 MiB로 성공했다 |
| D4 | 완료 | `Supervisor`가 실행 루프(spawn, 재기동 정책, 수동 재기동)와 정상 종료 순서(`host.shutdown` 한 줄 쓰기, stdin 닫기, `shutdownGraceMs`까지 대기, 그다음 그룹 SIGKILL)를 가진다. 시한 안에 끝나도 남은 손자를 위해 그룹 SIGKILL을 한 번 보낸다. SIGTERM·SIGINT 처리기(`signal-hook`)가 `app.exit(0)`을 불러 같은 순서를 탄다. 종료 중 두 번째 신호는 그룹을 바로 죽이고 끝낸다. 엔진은 `Launcher` 추상화 뒤에 있어 가짜 엔진으로 시험한다 |
| D5 | 완료 | S3의 세 조건. (1) 신용 창 4 MiB와 256 KiB 확인 단위, (2) 쓰기 전용 스레드와 16개 대기열(종료 경로는 pid 기반이라 락과 무관), (3) 엔진 세대마다 새 줄 버퍼, 종료 때 꼬리 버림, 줄 경계는 새 조각에서만 탐색(꼬리가 비고 조각이 `\n`으로 끝나면 복사 없음). 페이지가 바뀌면 줄 중간이던 프레임을 다음 `\n`까지 버린다 |

실행과 검사:

- `just desktop-test`: `cargo test`(54개). 사이드카 바이너리 없이 `TAURI_CONFIG`로 `externalBin`을 비워 컴파일한다. cargo는 `mise exec -- cargo`(`xeon/mise.toml`의 Rust 1.99.1)로 부르고 실패하면 종료코드 2다. `just verify`에는 들어 있지 않다.
- `just desktop-sidecar <triple|host> [--no-bytecode]`로 사이드카를 만든 뒤 `just desktop-run`(cargo run)과 `just desktop-build`(cargo build --release)를 쓴다. 설치 파일 번들(`cargo tauri build`)은 `@tauri-apps/cli` 의존 추가(잠금 파일 변경, 종료코드 3 절차)가 필요해서 D10으로 미뤘다.
- 디버그 빌드에서만 `XEON_DESKTOP_ENGINE_BIN`, `XEON_DESKTOP_ENGINE_ARGS`로 사이드카 대신 다른 실행 파일을 엔진으로 띄운다(가짜 엔진 시험용). 릴리스 빌드에는 이 경로가 없다.
- 실제 앱 확인(WSLg, 디버그, S1 가짜 엔진): 페이지에서 `engine_attach`, 오래된 세대의 `engine_write` 거부(`epoch-stale`), 8 KB 프레임 4,000개(32.25 MB)를 손실·순서 어긋남 0으로 수신, SIGTERM 뒤 약 0.5초에 앱·엔진·손자가 모두 종료. EOF를 무시하는 엔진은 SIGTERM 뒤 7.04초(`shutdownGraceMs`)에 그룹 SIGKILL로 정리됐다. macOS와 Windows는 확인하지 못했다.

구현하면서 spec과 달라진 점(spec에 반영함):

- `engine_ack` 명령이 더해져 명령이 다섯 개다. `engine_detach`는 `epoch` 인자를 받는다(§3.3).
- 종료는 `CommandChild::kill`을 쓰지 않고 pid 기반 그룹 종료다. `CommandChild`는 쓰기 스레드가 쥐기 때문이다(E2). Windows는 `taskkill /T`로 대신하며, job object 방식은 spec §10 미결 7에 남는다. Windows 경로는 컴파일하지 못했다.
- 줄 끝 없이 2 MiB를 넘는 줄은 셸이 버린다(메모리 상한). spec §5가 적은 "셸은 크기를 검사하지 않는다"는 1 MiB 한도의 판정에 대한 것이고, 판정은 여전히 WebView가 한다.
- `rust-toolchain.toml`은 만들지 않았다. Rust 버전은 `xeon/mise.toml`이 고정하고 `scripts/cargo.sh`가 `mise exec -- cargo`로 부른다(§4 표).

### 3.2.2 M2 DESK.4 구현 기록 (2026-10-24, `m2/desk-ui`)

D6(UI 셸)과 D7(승인 대기열)의 구현 결과다. 상태 설계는 `L4.desktop.design`, 규칙은 `eng.frontend-state.guide`를 따른다.

| 부분 | 파일 | 내용 |
|---|---|---|
| ipc | `src/transport/ipc.ts` | `DesktopIpc`(attach, write, ack, restart, detach), `EngineState` 스키마(`parseEngineState`), `createTauriIpc`. `@tauri-apps/api`를 import하는 유일한 파일(W2). 실패는 `Result<_, IpcError>` |
| 전송 | `src/transport/tauri-stdio.ts`, `json-lines.ts`, `connection.ts` | `attachRelay`(Channel 바이트 → `ReadableStream`, 256 KiB마다 `engine_ack`, 프레임 하나가 `engine_write` 한 번), `openEngineConnection`(`host.hello`, `client.kind "desktop"`). `json-lines.ts`와 `connection.ts`는 F가 구현을 가져갈 때까지 둔 복사본이다(`apps/host/src/client.ts`, `platform-process`의 stdio 전송. DR-10과 W7 때문에 import할 수 없다) |
| 상태 | `src/state/{shared,engine,ui}/` | design 12절 골격을 옮기고 구현 중 바뀐 점을 design 12.9에 적었다 |
| 연결 수명 | `src/app/session.ts` | 셸 상태가 `running`이면 attach → hello → `startLink`, 내려가면 닫고 올라오면 새 attach로 다시 연다. 연결 시도 실패는 UI 스토어 `connectError`에 고정 코드로 남기고 사용자가 "다시 연결"을 고를 때까지 쉰다 |
| 명령 | `src/app/commands.ts`, `src/views/commands.ts` | `selectThread`, `createThread`, `sendTurn`(입력마다 `requestId`, 실패하면 같은 값으로 재시도), `interrupt`, `respondApproval`, 목록·대화 다시 읽기, 엔진 다시 시작, 진단 복사. 거울을 바꾸지 않는다(FS-02) |
| 화면 | `src/views/` | 스레드 목록, 트랜스크립트(`virtual-list.tsx` 가상 스크롤: 마운트된 행만 `ResizeObserver`로 재고, 바닥에 붙어 있을 때만 따라 내려감), 입력창(한글 조합 중 Enter는 보내지 않음), 승인 대기열, 상태 표시줄 |
| 번들 | `index.html`, `src/main.tsx`, `src/styles.css`, `just desktop-ui` | `bun build index.html --outdir src-tauri/ui`. 릴리스 0.74 MB(minify), 개발 1.75 MB. `__XEON_CHECKS__`를 `--define`으로 넣어 개발 빌드에서만 불변식 단계를 켠다(design 14절 6번). `src-tauri/ui/`는 산출물이라 추적하지 않는다(자리 표시 파일 삭제, `cargo.sh`가 test·check 때 빈 자리 표시를 둔다) |

시험(`just test apps/desktop`, 103개, DOM 없음): reducer·단계·스토어·링크·선택자(design 13절 표), 전송(`ipc`, `json-lines`, `tauri-stdio`: 가짜 `DesktopIpc`), `thread.read` 스냅샷 포트, 그리고 `test/app/app.test.ts`가 가짜 셸과 가짜 엔진으로 attach → hello → 구독 → 목록 → 스냅샷 → `turn.start` → 엔진 재기동 → 재연결을 끝까지 돌린다.

실제 창 확인(WSLg, 디버그, 가짜 엔진 `XEON_DESKTOP_ENGINE_BIN`): WebKitGTK 창에서 연결됨, 목록 읽기, 승인 복원(`approval.list`), 대화 열기(`thread.read`), 입력 → 토큰 스트리밍 → 확정, 승인 응답 → 대기열에서 사라짐, 새 대화 만들기가 끝까지 동작했다. CSP 위반은 없었다. 마우스·키보드 입력은 DOM 이벤트로 흉내 냈고 한글 IME 조합은 확인하지 못했다. macOS와 Windows는 확인하지 못했다.

M2 마감 반영(T7 DESK, TS만): 도구 승인 카드가 명령, 인자, 비밀 핸들을 보이고(`src/views/approval-form.ts`), 질문 카드가 선택지와 `allowFreeText`를 따르며 `QuestionAnswer`를 만든다. 실패 표시는 `approval.respond`의 `reason`·`detail`로 `failed`, `invalid`, `closed`, `unapplied`로 나뉜다(`src/app/approval-outcome.ts`). 프로젝트 신뢰 카드(`src/views/trust.tsx`, `trust-model.ts`)는 `trust.get`·`trust.decide`를 부른다. `thread.locked`는 `src/app/command-error.ts`가 대안을 읽고 `src/views/locked-dialog.tsx`가 묻는다(G2-09). 시험은 `test/views/*`(서버 렌더와 순수 로직)와 `test/app/locked-trust.test.ts`(가짜 셸과 가짜 엔진)다. `trust.get`·`trust.decide`·`thread.open observe`의 실제 host 처리기와 맞춘 종단 시험은 wave 2 host가 병합된 뒤에 다시 돌려야 한다.

M2 마감 반영(T7 DESK, 최소 설정 화면 G2-08): 구조와 규칙은 spec §4.14다. 파일은 `src/settings/{model,diagnostics}.ts`(순수 로직), `src/app/setup.ts`(wire), `src/views/settings.tsx`, `setup-banner.tsx`다. 시험은 `test/settings/*`(검사, 첫 실행 단계, 보고서 변환), `test/views/settings.test.tsx`(서버 렌더: 값 입력란이 없음, 안내 문구), `test/app/locked-trust.test.ts`의 "settings screen wire"(`settings.get`·`settings.set`·`secret.*` 요청 모양, `settings.invalidated` 필터)다. 사이드카가 키 값을 받을 수 없고 점검 결과를 전하는 wire가 없다는 두 한계가 남아 있다(spec §10 15, 16번). `secret.*`·`settings.set`의 실제 host 처리기와 맞춘 종단 시험은 wave 2 host가 병합된 뒤에 다시 돌려야 한다.

M2 마감 반영(T7 DESK, 시험): 실제 `createTauriIpc`(invoke, Channel)를 `@tauri-apps/api/mocks`의 `mockIPC` 위에서 돌린다(`test/transport/tauri-mock.ts`, `tauri-mock.test.ts`, bun test). 셸 역할은 `fake-ipc.ts`가 맡고 `mockIPC`가 `engine_*` 명령을 그쪽으로 옮긴다. 시험하는 것은 명령 이름과 인자 모양, 바이트·상태 Channel 메시지의 해석(모르는 상태는 버림), 문자열 오류의 코드 변환, 결과 스키마 검사, 그리고 앱 전체가 이 경로로 `live` 연결에 이르는 흐름이다. `mockIPC`는 `invoke`의 세 번째 인자(헤더 `x-xeon-epoch`)를 넘기지 않아 세대 검사는 Rust 시험(`relay.rs`)이 맡는다. vitest는 쓰지 않는다.

M2 마감 반영(T7 DESK, Rust 셸과 사이드카 e2e, G2-09·G4-03·원격 점검 Phase 1):

| 부분 | 파일 | 내용 |
|---|---|---|
| 단일 실행 | `src-tauri/src/main.rs`, `window.rs` | `tauri-plugin-single-instance`를 첫 플러그인으로 등록하고 콜백이 `focus_main`(show, unminimize, set_focus)을 부른다. 시험은 `tauri::test` mock 앱으로 창 조회와 레이블 일치를 본다. 실제로 프로세스 둘을 띄운 확인은 하지 않았다 |
| 로그 파일 | `main.rs` `debug_log_plugin` | 디버그 빌드만. `LogDir` 파일과 표준 출력, 2 MB `KeepOne` |
| 상태 덤프, 스냅샷 | `src-tauri/src/inspect/` | spec §4.15. JSON-RPC 처리(`mod.rs`), 소켓 서버(`server.rs`: 소켓 0600/폴더 0700, 접속 4개, 줄 16 KiB, 낡은 소켓 교체와 일반 파일 보존), 실제 앱 정보(`probe.rs`), macOS 스냅샷(`snapshot_macos.rs`). Rust 시험 65개가 `just desktop-test`로 통과했다 |
| 릴리스 점검 | `test/inspect-guard.test.ts` | 소스 수준 cfg 보장. 산출물 확인 목록은 spec §4.15. `cargo check --release`는 경고 없이 통과했다 |
| e2e 틀 | `test/e2e/harness.ts`, `scenario.ts`, `sidecar.e2e.test.ts` | stdio JSON-RPC로 엔진 프로세스를 모는 도구. 소스 진입(`bun apps/cli/src/main.ts host --stdio`)과 컴파일 사이드카(`xeon-<triple> host --stdio`)에 같은 요청열(hello, 구독, thread.create/list/read, settings.get, approval.list, secret.list, trust.get, command.list, host.status)을 보내 정규화한 응답과 이벤트열이 같은지, `host.shutdown` 또는 stdin EOF만으로 종료코드 0과 홈을 쥔 프로세스 0개인지 본다 |

순서 경합(G4-03): thread를 연 직후 기본 켜짐 scope의 `scope.changed` 묶음이 다음 유휴 경계의 한 커밋으로 남고, 뒤따르는 입력과의 앞뒤는 시간에 달려 있다. 이전 도구는 60 ms를 기다려 이 경합을 가렸다. `untilScopesCommitted`가 시간 대신 조건을 기다린다: 구독으로 첫 `scope.changed`가 도착할 때까지 기다리고(커밋은 원자적이라 첫 이벤트가 오면 묶음 전체가 와 있다) seq가 이어지는지 확인한다. 시간 대기는 없고, 상한(20초)은 실패 메시지에 stderr를 싣는 용도다. 이 방식으로 소스 진입 두 번 실행의 응답·이벤트열이 같음을 시험한다.

시험 결과(`just test apps/desktop`): 사이드카를 빌드하지 않았을 때 171 통과, 건너뜀 3(바이너리 시험). `just desktop-sidecar host`를 한 번 돌려 `xeon-x86_64-unknown-linux-gnu`(109.8 MiB)를 만든 뒤 174 통과, 건너뜀 0이다. 즉 Linux 컴파일 바이너리가 소스 진입과 같은 응답·이벤트열을 내고 EOF와 `host.shutdown`으로 종료코드 0, 잔존 프로세스 0이다. `trust.get`, `command.list`는 아직 host 처리기가 없는 foundation에서 두 쪽이 같은 `jsonrpc.methodNotFound`(-32601)를 내는 것을 견준 것이다. wave 2 host가 병합된 뒤 같은 요청열이 실제 값(신뢰 상태, 명령 목록)으로 같은지 다시 돌려야 한다. turn은 모델 테이프를 컴파일 바이너리에 넣을 길이 없어 e2e에 없다(메시지 열 동등은 `apps/host`의 transport-parity 시험이 맡는다). macOS와 Windows 바이너리는 확인하지 못했다.

구현하면서 spec과 달라진 점:

- 새 페이지의 `$/connectionReset`은 F에 아직 없어 보내지 않는다. 새로고침 뒤 `host.hello`가 중복(1002)이면 상태 표시줄에 `연결 실패: hello:1002`가 보이고 "다시 연결"만 가능하다. M1 정책(새로고침 = 엔진 재기동)에 맞춰 셸이 처리해야 한다 [미결].
- `CursorStore`와 `resubscribe`(spec 3.4)는 만들지 않았다. design 13절이 새 페이지를 head + 스냅샷으로 정했기 때문이다.
- `thread.open`은 부르지 않는다. 읽기는 `thread.read`가, 쓰기 소유는 `turn.start`의 암묵 획득이 맡는다.
- `.oxlintrc.json`에 FS-06 import 제한과 `react/rules-of-hooks`를 더했다(guide 3.1). W8·W9(앱 내부 경계)는 `check-layers.ts`에 아직 없다.
- 트랜스크립트는 최신 1,000개까지만 읽는다(`MAX_SNAPSHOT_ITEMS`). 더 오래된 item을 위로 스크롤하며 읽는 일은 하지 않았다.
- 마크다운과 코드 하이라이트는 넣지 않았다(FS-21 [제안]). 확정 item도 평문이다.
- 설정 진입점(spec 4.13)은 settings-ui 소관이라 만들지 않았다.

### 3.3 CI 매트릭스 (D9)

[결정: review.m2-plan §8 D1] `.github/workflows/xeon-ci.yml`에 Linux `desktop-build` job(Z.1)과 macOS `desktop-macos` job을 더한다. `desktop-macos`는 `workflow_dispatch`나 PR 라벨 `ci:macos`가 있을 때만 돈다. 개발 반복은 WSL에 설치한 Rust 툴체인(rustc·cargo 1.99.1)과 WebKitGTK 4.1로 로컬에서 한다. 공식 사이드카 스크립트는 호스트 아키텍처에서만 동작한다고 경고하므로(`_research/stack-status.md §7-F` 3개 플랫폼 빌드 행) triple마다 같은 아키텍처의 러너를 쓴다.

| triple | 러너 [가정] | 비고 |
|---|---|---|
| `aarch64-apple-darwin` | `macos-14` 또는 이후 arm64 러너 | `desktop-macos` job. M3 서명·공증 job도 여기서 돈다 |
| `x86_64-apple-darwin` | Intel macOS 러너 | Intel 러너 제공이 줄면 arm64 러너에서 교차 빌드로 바꾼다. 그때는 Rust triple을 명시하고 `bun-darwin-x64` 타깃으로 만든다 [미결] |
| `x86_64-unknown-linux-gnu` | `ubuntu-24.04` | WebKitGTK 개발 패키지 설치 |
| `aarch64-unknown-linux-gnu` | arm64 Linux 러너 | 러너 제공 여부 [미확인] |
| `x86_64-pc-windows-msvc` | `windows-latest` | Windows 서명 기본 구현이 동작한다(§3.4) |

- `desktop-build`는 PR에서 수동 실행, `main`에서 야간 실행으로 둔다 [제안]. `desktop-macos`는 위 두 조건에서만 돈다. `just verify` 시간 목표(`eng.toolchain.guide` 3.1)에 넣지 않는다.
- 산출물 검사: 각 산출물이 자기 triple의 `xeon-<triple>`만 포함하는지(spec D-06), macOS `.app`의 `Contents/Resources` 아래 Mach-O가 없는지(`_research/notes/L4-2.md §11` 1번).
- Windows 메타데이터 플래그(`--windows-icon`, `hideConsole` 등)는 교차 컴파일에서 쓸 수 없다는 기록이 있다(`_research/stack-status.md §7-C` 제한 행. arch-2 §4.2는 원문 문장을 찾지 못해 [미확인]). Windows 사이드카는 Windows 러너에서만 만든다.

### 3.4 서명·배포 (D10)

#### macOS

- 서명 대상: 앱 본체, `externalBin` 사이드카, `bundle.macOS.frameworks`의 FTS5 dylib, `.app`. Tauri 번들러가 이 순서(안쪽 → 바깥쪽)로 서명하고 hardened runtime을 켠다(`_research/notes/L4-2.md §6`).
- entitlements(`_research/notes/L4-2.md §5`): [제안] 출발점은 `com.apple.security.cs.allow-jit` 하나다. `allow-unsigned-executable-memory`는 부족할 때만 더한다. `disable-library-validation`은 넣지 않는다. `get-task-allow`는 금지다. 최소 집합은 macOS 실측으로 확정한다.
- 한계: Tauri는 entitlements 한 벌을 모든 서명 대상에 붙이고(`sign.rs:53-68`), 호출하는 `codesign` 인자에 `--timestamp`가 없다(`keychain.rs:221-239`, L4-2 §7). 공증 요건(보안 타임스탬프)과 맞는지 [미확인]이다.
- [미결] 서명 방식: (a) Tauri 자동 서명을 쓰고 entitlements 공유와 타임스탬프 부재를 감수, (b) 자동 서명을 끄고 수동 파이프라인(사이드카 전용 entitlements, `--timestamp`, `notarytool`, `stapler`). L4-2 §11 3번.
- 검증 단계 [제안]: `codesign -dvv`의 Timestamp 행, `codesign --verify --deep --strict`, `xcrun notarytool log` 보관, `xcrun stapler validate`.
- 필요 자격: Developer ID Application 인증서와 공증 계정(무료 계정은 공증 불가, L4-2 §7). 보유 여부는 [미결].

#### Windows

- code signing 인증서가 필요하다. SSL 인증서는 쓸 수 없다(`_research/stack-status.md §7-G`).
- 인증서 종류 [미결]: OV(PFX 변환 또는 Azure Key Vault `relic`), Azure Artifact Signing. Tauri 가이드는 2023-06-01 이전 발급 OV 기준으로 적혀 있다.
- SmartScreen: 서명하지 않으면 경고가 뜬다. 2024년 이후 EV 인증서도 즉시 평판을 주지 않는다. 평판은 배포량이 쌓여야 생기므로 공개 배포 전 기간을 일정에 넣는다.
- Linux·macOS 러너에서 Windows 설치 파일을 만들면 기본 서명 구현이 동작하지 않아 커스텀 sign command(`bundle.windows.signCommand`)가 필요하다. [제안] Windows 설치 파일은 Windows 러너에서 만든다. 교차 빌드가 필요해지면 sign command를 그때 정한다.
- WebView2 설치 모드: spec §4.11의 `downloadBootstrapper` 기본값 제안. 오프라인 설치 요구가 생기면 `offlineInstaller` 산출물을 따로 만든다.
- 비용: 인증서 연 비용과 Azure Artifact Signing 요금은 조사하지 않았다 [미확인].

#### Linux

- 패키지: AppImage, deb [제안]. rpm은 요청이 있을 때 더한다.
- 의존: WebKitGTK. [가정] Tauri 2는 `libwebkit2gtk-4.1`을 쓴다. deb에는 런타임 의존으로 선언하고, AppImage는 시스템 WebKitGTK를 쓴다(번들하지 않는다) [가정]. 최소 배포판은 spec §10 미결 10.

#### 비밀 주입

- 서명·공증 자격(인증서, 암호, API 키)은 SOPS로 암호화한 참조로 저장하고 CI에서 복호화해 환경 변수로 주입한다. 값은 저장소, 로그, 문서에 쓰지 않는다. 새 키는 `just secret-add <키> [env]`로 더한다.

#### 자동 업데이트

- [미결] M3 이후 검토한다(D14). Tauri updater를 쓰면 업데이트 서명 키와 배포 서버가 필요하다.

## 4. 채택 코드

| 항목 | 버전 | 쓰는 곳 | 비고 |
|---|---|---|---|
| Bun | 1.4.3 | 사이드카 컴파일, 테스트 | `eng.toolchain.guide` 1.1 |
| `tauri`(crate) | `=2.12.3` | `src-tauri/Cargo.toml` | DESK.1 spike가 쓴 판. `tauri-build =2.7.4`와 함께 `Cargo.lock`에 고정했다. CLI(`@tauri-apps/cli` 2.12.3)와 같은 수 버전이다 |
| `@tauri-apps/cli` | 2.12.3 | `package.json` devDependencies(catalog) | `_research/stack-status.md §7-F`. crate와 같은 2.12 계열 |
| `@tauri-apps/api` | 2.12.x 정확 버전 [미확인] | `src/transport/ipc.ts`, `src/shell/**` | D2에서 crate와 맞는 값을 확인해 catalog에 고정한다 |
| `tauri-plugin-shell`(crate) | `=2.5.0` | `engine.rs` | 조사 기준은 `plugins-workspace` `v2` 브랜치 커밋 `11211c30e71796cd737280303244552bb7f70797`(Cargo.toml 2.5.0, arch-2 §3.2). 정식 태그 미확인이라 D2에서 crates.io 버전과 대조한다. 대조 전까지 위 커밋 기준으로 둔다 |
| `@tauri-apps/plugin-shell` | 넣지 않는다 | - | (a)안에서 WebView는 spawn하지 않는다 |
| `tauri-plugin-single-instance`(crate) | `=2.5.4` | `main.rs`, `window.rs` | spec §5 동시 실행 [결정: M2 마감 G2-09]. 다른 플러그인보다 먼저 등록 |
| `tauri-plugin-log`(crate) | `=2.10.1` | `main.rs`(디버그 빌드만 등록) | spec §4.15 원격 점검 로그 파일 |
| `objc2`, `objc2-app-kit`, `objc2-foundation`, `objc2-web-kit`, `block2`(crate, macOS 한정) | `0.6`, `0.3`, `0.3`, `0.3`, `0.6` | `src/inspect/snapshot_macos.rs` | spec §4.15 뷰포트 스냅샷. 디버그 빌드에서만 쓴다. WSL에서는 컴파일되지 않아 Mac 확인이 필요하다 |
| `tauri-plugin-notification` | 2.x [미확인] | `src/shell/**`, M3 | spec §4.8 |
| Rust 툴체인 | `1.99.1` 고정(2026-10-25 결정). `Cargo.toml`의 `rust-version = "1.99"` | `xeon/mise.toml`의 `rust = { version = "1.99.1", profile = "default" }`. `rust-toolchain.toml`은 만들지 않았다 | mise가 rustup으로 설치하고 `RUSTUP_TOOLCHAIN`을 정하므로 `rust-toolchain.toml`이 필요 없다. `profile = "default"`가 rustfmt·clippy를 포함한다. 1.99.0에는 회귀 3건(x86_64 FFI `bool` 반환 코드 생성 등)이 있어 1.99.1부터 쓴다. 다음 minor는 자동으로 채택하지 않는다. `rustc --print host-tuple`에 1.84+ 필요(adr.0008 §3.2). CI 러너의 설치 방법은 D9에서 정한다 |
| `typebox` | 1.3.27 | IPC 스키마 | catalog. pi-ai와 같은 판(review.decisions-2 U-24) |
| `react`, `react-dom` | 19.3.1(조사 시점) | `src/views/**`, `src/state/*/hooks.ts` | [결정] adr.0010. D6 착수 때 최신 19.x를 확인해 catalog에 정확히 고정한다. 타입은 `@types/react`, `@types/react-dom` |
| `zustand` | 5.0.16(조사 시점) | `src/state/*/store.ts`, `src/state/*/hooks.ts`(`eng.frontend-state.guide` FS-06) | [결정] adr.0010. 같은 방식으로 고정한다 |

- 포크 원본: 없다.
- 구조 참고(코드 복사 없음):
  - Tauri 사이드카 공식 문서 https://v2.tauri.app/develop/sidecar/ (externalBin, triple 규칙, capabilities).
  - opencode `standalone.ts`의 stdin EOF 임대(`_research/process.md §6.4`, adr.0006 §3.7 6번 근거 `standalone.ts:23-27`). 엔진 쪽 구현은 `L4.host-service.plan` 몫이고, 데스크톱은 그 동작을 전제로 테스트한다.
- D2 착수 때 확정할 버전 목록(확정 전까지 [미확인]): `@tauri-apps/api`, `tauri-plugin-shell`, `tauri-plugin-notification`, Rust 툴체인(`rust-toolchain.toml`). `react`, `react-dom`, `zustand`는 D6 착수 때 같은 방식으로 기록한다. D2 완료 조건에 이 목록의 정확 버전 기록을 넣는다.
- 모든 TS 의존은 `xeon/package.json` catalog에 정확 버전으로 둔다(TC-01, TC-02). Rust crate는 `Cargo.toml`에 `=` 버전으로 두고 `Cargo.lock`을 커밋한다 [제안].

## 5. 단위 테스트 목록

| 테스트 | 파일 | 태그 | 확인할 동작 | spec | 단계 |
|---|---|---|---|---|---|
| transport-conformance-stdio | `test/transport-conformance-stdio.int.test.ts` | int | 엔진 바이너리를 띄워 그 stdin/stdout으로 만든 `StdioTransportFactory` 전송과 `HostConnection`이 `WIRE_CONFORMANCE_CASES` 전부를 통과한다. 테스트 실행기는 `F.wire-settings.plan`의 `conformance-runner.ts` 틀을 쓴다 | D-07 | M1 |
| relay-line-framing | `test/relay-line-framing.test.ts` | unit | 1 MiB 경계 프레임(한도 정확히, 한도 + 1), 한 프레임이 여러 바이트 조각으로 나뉘어 오는 경우, 조각 하나에 여러 프레임이 들어 있는 경우, UTF-8 다중 바이트 문자가 조각 경계에서 잘리는 경우, 한도 초과 줄을 버린 뒤 다음 줄을 정상 처리하는 경우 | §3.4, §5 | M1 |
| reconnect-resubscribe-from-cursor | `test/reconnect-resubscribe-from-cursor.test.ts` | unit | `CursorStore`에 저장한 위치로 `events.subscribe`를 보낸다. `replay.outOfRange`면 `onReset`을 한 번 부르고 `from: "head"`로 다시 보낸다. 위치가 없으면 `"head"`다. 가짜 `HostConnection`을 쓴다 | D-04, §4.6 | M1 |
| sidecar-config | `test/sidecar-config.test.ts` | unit | `sidecar.json`의 name·args가 `tauri.conf.json` `externalBin`, capabilities, Rust 상수와 같다. M1에서는 `sidecar.json` 스키마 검사만 하고 나머지는 M2에서 켠다 | §3.5 | M1(일부) |
| sidecar-triple-mapping | `xeon/scripts/build-sidecar.test.ts` | unit | triple 5종이 정해진 bun target으로 대응하고, 산출 파일명이 `binaries/xeon-<triple>`(Windows `.exe`)이며, 모르는 triple은 종료코드 1로 거부한다 | §3.5(D-06의 이름 규칙) | M1(스크립트 골격) 또는 M2 |
| sidecar-bundle-contents | CI `desktop-build` job의 산출물 검사 단계(§3.3) | CI 검사(테스트 태그 아님) | 각 플랫폼 산출물이 자기 triple의 `xeon-<triple>`만 포함하고 다른 triple의 사이드카를 포함하지 않는다. 단위 테스트가 아닌 산출물 검사다 | D-06 | M2 |
| shutdown-message-then-exit | `test/shutdown-message-then-exit.int.test.ts` | int | 엔진 stdin에 `host.shutdown` 요청을 쓰고 stdin을 닫으면 엔진이 `shutdownGraceMs` 안에 종료코드 0으로 끝난다. `host.shutdown`이 F에 없을 때는 `-32601` 응답 뒤 EOF로 같은 결과가 나온다 | E4, §4.3 | M2(F 변경 요청 처리 뒤) |
| stdin-eof-checkpoint | `test/stdin-eof-checkpoint.int.test.ts` | int | 테이프로 turn을 진행하는 중에 stdin을 닫으면 엔진이 `l0.process.shutdown.timeoutMs`(테스트에서는 1초로 줄임) 안에 끝나고, DB에 비정상 종료 표식 또는 체크포인트가 남는다 | E5, D-02 | M2 |
| no-grandchild-left | `test/no-grandchild-left.int.test.ts` | int | 엔진이 손자 프로세스(긴 `sleep` 명령 도구 호출)를 띄운 상태에서 정상 종료 순서를 돌리면 그룹 안 프로세스가 0개가 된다. Linux·macOS 한정 | E3, E9, D-01 | M2 |
| engine-state-schema | `src/transport/ipc.test.ts` | unit | `EngineStateSchema`가 여섯 상태를 받아들이고 모르는 `kind`와 여분 필드를 거부한다 | §3.3 | M1 |
| desktop-settings-defs | `src/settings-store/defs.test.ts` | unit | `l4.desktop.*` 정의가 F `checkSettingDef` 규칙 1~8을 통과하고, 키 접두가 `l4.desktop.`, `layer`가 `"L4"`다 | §6 | M1 |
| epoch-guard | `test/epoch-guard.test.ts` | unit | 가짜 `DesktopIpc`에서 이전 세대의 `write`가 거부되고, 새 세대 첫 메시지가 `$/connectionReset`(F 수용 뒤) 또는 엔진 재기동 요청(수용 전)이다 | D-09, §4.5 | M2 |
| restart-policy | `src-tauri/src/engine.rs` 안 Rust 테스트 | unit(cargo) | 백오프 단계, 10분 창 상한, `restartLimit` 0이면 재기동 없음, 10분 안정 뒤 횟수 초기화 | §4.4, D-05 | M2 |
| relay-no-payload-log | `src-tauri/src/relay.rs` 안 Rust 테스트 | unit(cargo) | 릴레이 로그 기록기가 바이트 수·프레임 수·세대만 남기고 프레임 내용을 남기지 않는다 | E11, D-08 | M2 |
| desktop-cli-message-parity | `test/e2e/parity.e2e.test.ts` | e2e | 같은 테이프로 CLI와 데스크톱의 호스트 메시지 열이 정규화 뒤 같다 | D-03 | M2 |
| app-exit-no-sidecar | `test/e2e/exit.e2e.test.ts` | e2e | 앱 창 닫기 뒤 사이드카와 손자가 없다 | D-01 | M2 |
| tray-close-no-webview | `test/e2e/tray-close.e2e.test.ts` | e2e | `closeBehavior: "tray"`에서 창을 닫으면 WebView 엔진 프로세스가 0개이고 진행 중 turn이 계속되며, 창을 다시 열면 저장 위치부터 이어 받는다 | D-10 | M2 |
| engine-env-sanitized | `src-tauri/src/engine.rs` 안 Rust 테스트 | unit(cargo) | spawn 명령 구성 함수가 만든 환경에 `BUN_OPTIONS`가 없고, cwd와 넘기는 모든 경로가 절대 경로다 | D-11, E6, E7 | M2 |
| check-layers-app-rules | `xeon/scripts/check-layers.test.ts`(툴체인 담당에 요청, 위치는 §2 스크립트 위치 미결과 같음) | unit | W1·W2·W6 위반 샘플 import(전송 → 화면, `@tauri-apps/*`를 허용 파일 밖에서 import, `@xeon/host` import)를 앱 내부 규칙이 거부한다 | D-12 | M2 |

- `e2e` 태그는 `just verify`에서 제외한다(`eng.testing.guide` TS-01 표). CI에서 수동 실행과 야간 실행으로 둔다.
- `int` 테스트는 파일당 10초 이하, 실제 시간 대기는 조건 대기(폴링 + 상한)로만 한다(`eng.testing.guide` TS-01, 4절).
- `ui` 부품 테스트는 계속 보류한다(`eng.testing.guide` TS-01 버린 계층 표). M2 D6에서 화면 로직은 상태 reducer·선택자로 떼어 `unit`으로 시험한다(`eng.frontend-state.guide` FS-23, `L4.desktop.design` §13 시험 목록).
- Rust 테스트(`cargo test`)는 `just verify`에 넣지 않는다. Rust 툴체인이 없는 환경에서 verify가 종료코드 2로 끝나지 않게 하기 위해서다. `just desktop-test`로 돌리고(사이드카 바이너리 없이 돈다), `desktop-build` CI job에서도 돈다 [제안].
- 테스트 경로는 `import.meta.dir` 기준으로 만든다(`eng.testing.guide` TS-06).

## 6. 완료 기준

### M1

- `xeon/apps/desktop`에서 `bun test`가 단독으로 통과한다. transport-conformance-stdio, relay-line-framing, reconnect-resubscribe-from-cursor, engine-state-schema, desktop-settings-defs, sidecar-config(M1 부분)가 포함된다.
- 골격 디렉터리와 `sidecar.json`이 §2 배치와 같다. `src-tauri/`는 없다.
- `cd xeon && just verify`가 종료코드 0이다(check-layers, depcruise, knip 포함).
- DR-07 예외(D1의 `Bun.spawn`)가 허용 목록 `DR-07/desktop-test-spawn`(`scope: "test"`)으로 등록되어 있다(review.decisions-2 B-06).

### M2

- `product.scope.spec` M2 종료 조건 중 데스크톱 항목을 만족한다: 앱 정상 종료 시 사이드카와 손자가 남지 않고(D-01), 같은 테이프에서 CLI와 데스크톱의 호스트 메시지 열이 같다(D-03).
- spec 수용 기준 D-02, D-04~D-06, D-08~D-12를 통과한다.
- `desktop-build` CI가 triple 5종 중 러너가 있는 것 전부에서 산출물을 만들고, 각 산출물이 자기 triple의 사이드카를 포함한다.
- macOS 산출물이 ad hoc 서명으로 실행된다. 공증과 `stapler validate`는 M3 릴리즈 후보 기준이다 [결정: review.m2-plan §8 D3].
- 사이드카 크기가 S2에서 정한 상한 이하다.
- S1~S5 결과가 spec의 [가정]·[미결]에 반영되어 있다.

### M3

- 서비스 사용 설정이 켜지면 셸이 서비스 소켓을 릴레이하고, 앱을 닫아도 서비스의 turn이 계속된다.
- 알림 wire가 정해졌으면 알림이 OS 알림으로 보인다.

## 7. 위험과 대응

| # | 위험 | 영향 | 대응 |
|---|---|---|---|
| R1 | 사이드카 종료 정리의 공식 문서가 없다. 플러그인은 정상 종료 때 JS API 사이드카만 SIGKILL로 정리하고, Rust API 사이드카·크래시·신호 종료·그룹 끈 손자·Windows job은 정리하지 않는다(`_research/notes/arch-2.md §5` 1~9행) | 고아 엔진과 손자 프로세스 | spec E1~E9, S1·S4로 실측. stdin EOF 임대를 1차 방어로 둔다 |
| R2 | Bun 엔진을 사이드카로 묶는 방식이 Tauri·Bun 어디에도 공식 사례로 없다(adr.0008 §4.2, arch-2 §4.1) | 업그레이드 때 예고 없는 동작 변화 | Bun과 Tauri 버전을 정확히 고정하고, 올릴 때 S1·S3 시나리오를 다시 돈다 |
| R3 | Bun 단일 바이너리가 크다. 공식 문서가 "still way too big"이라고 적고 수치는 없다(`_research/stack-status.md §7-C`) | 설치 크기, 내려받기 시간 | S2로 재고 상한을 정한다. `--minify`, 소스맵 외부화, 배포판 제외 플러그인(`provider-anthropic-oauth`)을 진입점 그래프에서 빼는지 검사한다(DR-09). CI에서 상한 초과를 실패로 둔다 |
| R4 | Windows 서명 비용과 SmartScreen 평판. EV도 즉시 평판을 주지 않는다(`§7-G`) | 첫 사용자 경고, 비용 | Windows는 나중 지원이므로 M2는 빌드와 서명 준비까지만 한다. 인증서 종류와 비용은 사용자 확인 [미결] |
| R5 | WebKitGTK와 WKWebView, WebView2 사이의 렌더링·웹 API 차이(adr.0008 §4.2) | 플랫폼별 화면 버그 | spec V1~V8 확인 목록을 M2 첫 주에 돌린다. 웹 API 대신 셸 명령을 쓰는 기능을 늘린다 |
| R6 | 교차 컴파일 제약. 공식 사이드카 스크립트는 호스트 아키텍처 전제이고, Windows 메타데이터 플래그는 교차 컴파일에서 쓸 수 없다는 기록이 있다(`§7-C`, `§7-F`) | 러너 비용, 일부 triple 빌드 불가 | triple별 같은 아키텍처 러너(§3.3). Intel macOS와 arm64 Linux 러너 확보 여부를 D9에서 확인한다 |
| R7 | 메모리 수치 근거 부족. 공개 수치는 벤더 주장이거나 3차이고 tauri#5889 측정 논쟁이 있다(`§7-H`) | 예산을 잘못 잡음 | S5로 직접 잰다. 예산은 측정 전까지 [가정]으로 둔다 |
| R8 | 장수명 프로세스의 stdio. Tauri Node 가이드는 장수명이면 다른 IPC를 고려하라고 적는다(arch-2 §3.5) | 버퍼링·역압 문제 | S3. 문제가 확인되면 로컬 소켓으로 바꾼다. `EnginePipe` 추상화가 있어 WebView 쪽은 바뀌지 않는다 |
| R9 | F 변경 요청(`host.shutdown`, `$/connectionReset`, 공용 `createHostConnection`)이 늦어진다 | 새로고침이 엔진 재기동이 된다. 연결 코드가 CLI와 중복된다 | 대체 동작(EOF 종료, 재기동, 앱 안 구현 + 같은 적합성 테스트)을 spec에 정해 두었다 |
| R10 | 테스트의 `Bun.spawn`이 DR-07과 충돌한다 | M1 적합성 테스트가 check-layers에서 막힘 | 해소: DR-07 테스트 한정 행과 허용 목록 `scope: "test"` 항목으로 정했다(review.decisions-2 B-06). 같은 결정을 `L4.host-service.plan`(§2, §7)과 `L4.cli.plan`(§5.2)의 자식 프로세스 테스트에도 적용한다 |
| R11 | macOS 서명에서 Tauri의 entitlements 공유와 `--timestamp` 부재(`_research/notes/L4-2.md §7`, §9) | 공증 실패 | 공증 실측 뒤 자동 서명 유지 또는 수동 파이프라인 선택 [미결] |
| R12 | 엔진 바이너리 이름이 `L4.host-service.spec`에서 바뀐다 | 빌드·권한·Rust 상수 불일치 | `sidecar.json` 한 곳과 sidecar-config 테스트로 모은다 |

## 미결 사항

- [미결] `apps/host/src/main.ts`의 최상위 `await`가 `--bytecode` 빌드를 막는다(§3.1.1 S2, HOST.5). `apps/cli/src/main.ts`는 `runFromProcess().catch()` 형태로 이미 고쳐져 있다. `entry`가 cli여도 cli가 host를 가져오므로 host 쪽 수정 전에는 `just desktop-sidecar <triple>`이 실패한다.
- [미결] macOS 서명 방식(Tauri 자동 서명과 수동 파이프라인 중 선택), Developer ID 인증서와 공증 계정 보유 여부. M3 릴리즈 후보에서 정한다(review.m2-plan D3).
- [미결] Windows code signing 인증서 종류(OV, Azure Artifact Signing)와 비용.
- [결정: review.decisions-2 B-06] D1의 `Bun.spawn`은 DR-07 테스트 한정 행과 허용 목록 `DR-07/desktop-test-spawn`으로 푼다.
- [결정] `xeon/scripts/build-sidecar.ts`는 `scripts/`에 둔다(`m2-plan` DESK 소유 목록). 이 문서 `binds` 밖이라 `eng.toolchain.guide`와 함께 확인할 항목으로 남는다.
- [미결] Intel macOS, arm64 Linux CI 러너 확보.
- [미결] 자동 업데이트 채택(M3 이후).
- [미결] 상태 관리 라이브러리(`L4.desktop.spec` §10 미결 11). 프레임워크는 React 19 [결정: review.m2-plan §8 D2].
- [가정] `tauri` crate `=2.12.4`, `tauri-plugin-shell` 2.5.0 기준, triple 대응표, CI 러너 이름, Linux WebKitGTK 4.1 의존은 실행으로 확인하지 않았다.
