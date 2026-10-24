---
id: adr.0008
layer: adr
domain: desktop
kind: adr
status: accepted
depends_on: [adr.0001, adr.0006]
binds: [xeon/apps/desktop/**, xeon/apps/host/**]
---

# ADR-0008 데스크톱: Tauri 2와 엔진 사이드카

## 1. 상태와 날짜

- 상태: accepted
- 날짜: 2026-10-21
- [결정] 데스크톱은 Tauri 2(시스템 WebView, 3플랫폼)를 쓴다. 엔진은 `bun build --compile` 사이드카로 넣고 엔진과 UI는 stdio JSON-RPC로 연결한다(`_research/foundation-plan.md §1` 결정표 3번, `§2` 데스크톱 행 "Tauri 2.12 + 엔진 사이드카").
- [결정] 데스크톱은 메모리 우선 3플랫폼(Tauri 2)이다(`_research/decisions-log.md` 2026-10-21 결정(3차)).
- [결정] 사이드카 단일 바이너리 크기와 Windows 서명은 `L4.desktop.plan`에서 다룬다(`_research/foundation-plan.md §7`).

## 2. 맥락

- 데스크톱 셸 기술은 계획 v2의 남은 결정이었다(`_research/layer-plan-v2-notes.md` "남은 결정" 셋째 항목). 엔진을 자식 프로세스로 띄우는 구조는 어느 셸이든 같다(같은 항목, `_research/process.md §6.5` 3번).
- 사용자 우선순위는 메모리다(`_research/decisions-log.md` 3차).
- 3플랫폼은 macOS, Linux, Windows다. 첫 지원 OS는 macOS와 Linux(WSL 포함)이고 Windows 네이티브는 나중이다(`_research/decisions-log.md` 2026-10-19 답). [가정] Windows는 나중에 지원하더라도 빌드 대상에서 빼지 않는다.
- 프로세스 구조는 ADR-0006(`./ADR-0006-process-service-mode.md`)을 따른다. 데스크톱은 P1(앱이 엔진을 자식으로 띄우고 stdio JSON-RPC) 전송을 쓰고, 서비스 모드가 켜져 있으면 service 전송으로 접속한다.
- 스택은 ADR-0001(`./ADR-0001-stack.md`)의 Bun 1.4와 `bun build --compile`이다.

## 3. 결정

### 3.1 셸과 버전

[결정] Tauri 2를 쓴다. CLI는 `@tauri-apps/cli` 2.12.x다(`_research/stack-status.md §7-F`, 조사 시점 최신 2.12.3). 렌더링은 시스템 WebView다(Windows WebView2, macOS WKWebView, Linux WebKitGTK, `§7-F` 웹뷰 엔진 행).

### 3.2 엔진 사이드카

[결정] 엔진은 `bun build --compile` 단일 바이너리이고 Tauri 사이드카로 넣는다. 설정 키는 Tauri 공식 사이드카 문서를 따른다(`_research/stack-status.md §7-F`, https://v2.tauri.app/develop/sidecar/).

| 항목 | 값 | 출처 |
|---|---|---|
| 등록 | `tauri.conf.json`의 `bundle.externalBin`에 `binaries/<name>`을 적는다 | `§7-F` 사이드카 등록 행 |
| 파일 위치 | `src-tauri/binaries/<name>-<target-triple>`(Windows는 `.exe`). triple은 `rustc --print host-tuple`(Rust 1.84+)로 얻는다 | `§7-F` 사이드카 등록 행 |
| 권한 | `capabilities`에 `shell:allow-spawn`과 `"sidecar": true`를 둔다. args는 검증 패턴으로 제한할 수 있다 | `§7-F` 권한 행 |
| 호출 | Rust `app.shell().sidecar("<name>")`(파일명만), JS `Command.sidecar("binaries/<name>")`(externalBin 문자열 전체) | `§7-F` 호출 행 |
| 빌드 타깃 | `bun build --compile --target=bun-<os>-<arch>`. 공식 타깃 8개 | `§7-C` 타깃 행 |

[제안] 사이드카 이름은 `xeon`이고, CLI와 같은 바이너리를 `host --stdio` 인자로 실행한다. 같은 엔진 바이너리를 CLI도 쓰므로(`_research/process.md §6.1`) 데스크톱 전용 엔진 빌드를 따로 두지 않는다. 최종 이름과 인자는 `L4.desktop.spec`과 `L4.host-service.spec`이 정한다.

```jsonc
// src-tauri/tauri.conf.json (발췌)
{ "bundle": { "externalBin": ["binaries/xeon"] } }
```

```jsonc
// src-tauri/capabilities/default.json (발췌)
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

### 3.3 연결과 수명

- [결정] UI와 엔진은 stdio JSON-RPC로 연결한다. 메시지는 ADR-0006의 호스트 계약이다. CLI도 같은 엔진 바이너리와 같은 계약을 쓴다(`_research/foundation-plan.md §1` 3번, `_research/process.md §6.1`).
- [결정] 엔진을 UI 프로세스 안에 넣지 않는다. 확장이 블로킹이나 크래시를 일으켜도 UI는 살아 있어야 한다(`_research/process.md §6.1` 셋째 항목). 확장은 같은 프로세스에서 돌고 격리가 기본값이 아니므로(ADR-0007 `./ADR-0007-ext-points.md`) 프로세스 경계가 UI를 보호하는 유일한 장치다.
- [결정] 엔진 수명은 stdin EOF 임대로 정리한다(opencode standalone 방식, `_research/process.md §2.2` opencode 2번, `§6.2` 단계 1). 앱이 어떻게 끝나든 OS가 stdin 파이프의 쓰기 끝을 닫으므로 엔진은 EOF를 읽으면 체크포인트하고 종료한다.

[제안] Tauri 셸 플러그인 소스를 확인한 결과(`_research/notes/arch-2.md §3.2`, `§5`) 다음 규칙을 둔다. 세부 구현은 `L4.desktop.plan`이 정한다.

1. 엔진 spawn은 Rust 쪽 한 곳에서 한다. `CommandChild`를 앱 상태에 보관하고 `RunEvent::Exit`에서 명시적으로 종료한다. Rust API로 띄운 사이드카는 플러그인이 추적하지 않기 때문이다(`arch-2.md §3.2` 맵 등록 경로 행).
2. 프로세스 그룹을 켠다. 그룹을 끄면 엔진이 띄운 손자 프로세스(셸 명령, MCP 서버)가 남는다(`arch-2.md §3.2` 그룹 범위 행).
3. 종료 요청은 신호 전에 stdin의 JSON-RPC `shutdown` 메시지로 보낸다. `ExitRequested`에서 종료를 미루고 응답을 받은 뒤 종료한다. 플러그인은 SIGKILL만 보내므로 SIGTERM 체크포인트 절차가 성립하지 않는다(`arch-2.md §5` 1행).
4. 엔진의 cwd와 모든 경로를 절대 경로로 고정하고, 엔진 환경에서 `BUN_OPTIONS`를 지운다. 컴파일 바이너리는 상대 경로를 cwd 기준으로 읽고 `BUN_OPTIONS`를 읽는다(`arch-2.md §4.2`).
5. 세션 DB는 바이너리에 임베드하지 않는다. 임베드한 SQLite는 종료 시 변경이 사라진다(`_research/stack-status.md §7-C` 임베디드 SQLite 행).

## 4. 결과

수치의 출처 등급은 다음과 같이 적는다. [원문]은 공식 문서·소스, 3차는 독립 비교 기사, 벤더는 프로젝트 자체 주장이다.

### 4.1 좋은 점

- 메모리와 번들이 작다.
  - [가정] idle 메모리 Tauri 약 42MB, Electron 약 168MB(Electron 34.x). 3차 수치이고 버전 기준이 다르다(`_research/stack-status.md §7-H` 메모리(3차) 행).
  - [가정] 벤더 주장은 Tauri 30–50MB, Electron 100–200MB, Electrobun 15–30MB다(`§7-H` 메모리(자체 주장) 행).
  - [가정] Hello World 번들 Tauri 3.2MB, Electron 85MB, 기동 Tauri 380ms, Electron 1,420ms. 3차 수치다(`§7-H` 번들·기동 행).
  - 공개 측정에는 논쟁이 있다. Tauri 공식 v1 벤치가 Chromium 공유 메모리를 빼지 않았다는 지적이 있고(tauri#5889), 독립 측정 결론은 확정되지 않았다(`§7-H` 공개 측정 신뢰도 행). 그래서 위 수치를 모두 [가정]으로 둔다.
- 사이드카를 공식 지원한다. `externalBin`, triple 규칙, capabilities 권한이 공식 문서에 있다 [원문](`§7-F`).
- 엔진 크래시가 UI를 끌어내리지 않는다. 같은 엔진 바이너리를 CLI와 공유한다.

### 4.2 감수할 점

- 플랫폼마다 WebView 엔진이 다르다(WKWebView, WebView2, WebKitGTK). 렌더링과 웹 API 차이를 플랫폼별로 시험해야 한다(`§7-F` 웹뷰 엔진 행).
- triple마다 엔진 바이너리가 필요하다. 공식 스크립트는 호스트 아키텍처에서만 동작한다고 경고하므로 플랫폼별 CI 러너가 필요하다 [원문](`§7-F` 3개 플랫폼 빌드 행).
- Bun 엔진 묶기는 공식 문서에 없다. Tauri 공식 Node 가이드는 `@yao-pkg/pkg`를 안내하고, Bun 방식은 커뮤니티 문서다(`§7-F` Node·Bun 엔진 묶기 행, `_research/notes/arch-2.md §4.1`).
- 사이드카 종료 시 자식 정리는 공식 문서에 없다(`§7-F`). 플러그인 소스 기준으로는 JS API로 띄우고 앱이 정상 종료할 때만 SIGKILL로 정리된다. 크래시, 신호 종료, Rust API 사이드카, 그룹을 끈 손자 프로세스, Windows job 핸들은 정리되지 않는다(`arch-2.md §2`, `§3.4`). stdin EOF 임대가 1차 방어다.
- Bun 단일 바이너리가 크다. 공식 문서가 "still way too big"이라고 적고 수치는 없다 [원문](`§7-C` 크기 행).
- Windows 배포 부담이 있다 [원문](`_research/stack-status.md §7-G`).
  - WebView2 설치 방식 4종: `downloadBootstrapper`(기본, +0MB, 설치 시 인터넷 필요), `embedBootstrapper`(+약 1.8MB), `offlineInstaller`(+약 127MB), `fixedRuntime`(+약 180MB, 웹뷰 보안 패치 직접 관리).
  - code signing 인증서가 필요하다. 서명하지 않으면 SmartScreen 경고가 뜨고, 2024년 이후 EV 인증서도 즉시 평판을 주지 않는다. Linux·macOS에서 Windows 설치 파일을 만들면 커스텀 sign command가 필요하다.
  - Windows 서명과 사이드카 크기는 `L4.desktop.plan`에 위임한다(§1).
- Tauri 공식 Node 가이드는 예제 사이드카를 짧게 사는 프로세스로 보고, 오래 사는 앱이면 다른 IPC를 고려하라고 적는다(`arch-2.md §3.5`). 장수명 엔진에서 stdio 파이프의 버퍼링 동작을 확인해야 한다([미결] §6).

## 5. 대안

### 5.1 비교

| 대안 | 내용 | 판정 | 이유 |
|---|---|---|---|
| Electron 45 | Chromium 번들 | 탈락 | 렌더링이 플랫폼 사이에서 일관되지만 메모리와 번들이 크다. 메모리 우선이라는 사용자 우선순위와 맞지 않는다(`§7-H`) |
| Electrobun 2.0.4 | Bun 기반 셸, 기본 시스템 WebView, `bundleCEF`로 Chromium 번들 선택 | 탈락 | 작고 빠르다는 수치가 자체 주장이다(벤더). 코드 서명·노타리제이션 공식 문서가 없고 생태계가 성숙하지 않았다. Windows 11 ARM64는 beta, Ubuntu 24.04 외 Linux는 커뮤니티 지원이다(`§7-H`) |
| Node 사이드카(`@yao-pkg/pkg`) | Tauri 공식 Node 가이드 방식 | 탈락 | 공식 가이드가 있으나 Bun 스택(ADR-0001)과 맞지 않는다. `bun:sqlite` 같은 Bun API를 쓰는 엔진을 Node로 묶을 수 없다(`§7-F` Node 엔진 묶기 행) |
| 엔진을 UI 프로세스 안에 내장 | 별도 프로세스 없이 셸 안에서 엔진 실행 | 탈락 | 확장의 블로킹·크래시가 UI를 멈춘다(`_research/process.md §6.1`). CLI와 같은 바이너리를 쓸 수 없다 |
| 웹 UI만 + 서비스 모드 접속 | 브라우저에서 `xeon service`에 접속 | 보조 | 셸 설치가 없지만 서비스 모드가 항상 필요하고, 비루프백 접속이면 인증·TLS 설계가 선행되어야 한다(ADR-0006 체크리스트 5번). 원격 전송을 만들 때 다시 검토한다 |

### 5.2 셸 비교 요약

`_research/stack-status.md §7-H` 표를 줄여 옮긴다.

| 항목 | Tauri 2 | Electron | Electrobun |
|---|---|---|---|
| 최신 | `@tauri-apps/cli` 2.12.3 | `electron` 45.0.0 | v2.0.4(2026-10-18, stable) |
| 메모리 | 자체 30–50MB(벤더), idle 42MB(3차) | 자체 100–200MB(벤더), idle 168MB(3차, 34.x) | 15–30MB(벤더), 3차 [미확인] |
| 번들 | Hello World 3.2MB(3차) | Hello World 85MB(3차) | 스크린 레코더 418MB(Chromium 번들, 3차) |
| 기동 | 380ms(3차) | 1,420ms(3차) | [미확인] |
| 렌더링 | 시스템 WebView | Chromium 번들 | 시스템 WebView 기본, `bundleCEF` 선택 |
| 서명·노타리제이션 문서 | 있음 | 있음 | 공식 페이지에 없음 [미확인] |
| 플랫폼 | Windows, macOS, Linux | 3개 OS | macOS 14+, Windows 11 x64, Ubuntu 24.04+ 공식 |

## 6. 미결 사항

- [미결] 사이드카 종료 정리(`_research/stack-status.md §7-F` [미확인]). 플러그인 소스로 정상 종료 경로는 확인했으나(`_research/notes/arch-2.md §3.2`) 실행 재현은 하지 않았다. 앱이 SIGTERM이나 SIGINT를 받을 때 `RunEvent::Exit`가 발생하는지도 [미확인]이다(`arch-2.md §3.3`).
- [미결] Bun 엔진 묶기의 공식 지원(`§7-F` [미확인]). Tauri와 Bun 공식 문서 어디에도 없음을 확인했다(`arch-2.md §4.1`). 컴파일 바이너리의 자식 프로세스·신호·부모 종료 처리는 문서에 없다(`arch-2.md §4.2`).
- [미결] Electrobun 코드 서명·노타리제이션 문서(`§7-H` [미확인]). 대안 재검토 때만 필요하다.
- [미결] Windows 크래시 때 job 핸들을 닫아도 엔진이 남는 문제. 플러그인 상류에 kill-on-close를 요청할지, 자체 wrapper를 둘지(`arch-2.md §5` 4행).
- [미결] 장수명 엔진에서 stdio 유지와 로컬 소켓 전환 중 선택. 버퍼링과 재연결 동작을 spike로 확인한다(`arch-2.md §5` 6행).
- [미결] 사이드카 허용 크기 상한. Hello World와 실제 엔진 번들을 측정한 뒤 `L4.desktop.plan`에서 정한다(`arch-2.md §5` 7행).
- [가정] Windows 네이티브는 나중에 지원하지만 빌드 대상에서 빼지 않는다.
- [가정] §4.1의 메모리·번들·기동 수치는 3차 또는 벤더 수치이고 측정 논쟁(tauri#5889)이 있다.
