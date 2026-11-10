---
id: L4.remote.plan
layer: L4
domain: remote
kind: plan
status: draft
depends_on: [L4.remote.spec, L4.host-service.spec, L4.desktop.spec, L4.cli.spec]
binds: [xeon/apps/desktop-shell/src/web/**]
---

# L4 원격 origin과 웹 접근 구현 계획

`L4.remote.spec`의 구현을 트랙으로 나눈다. 트랙마다 파일 범위가 겹치지 않고, 끝난 상태에서 `just check <패키지>`와 정적 검사가 통과한다. 큰 구현은 이 계획 이후의 트랙이 한다.

## 1. 트랙 한눈에

| 트랙 | 이름 | 파일 범위(배타) | 선행 | 끝난 상태 |
|---|---|---|---|---|
| W0 | 스펙 델타 적용 | `docs/xeon/**` | 없음 | 이 트랙에서 끝남(미결 5건은 사용자 답 뒤 확정) |
| W1 | 인증·TLS 부품 | `apps/desktop-shell/src/web/auth/**`, `src/web/tls/**` | W0 | 아래 §2.1 |
| W2 | 게이트웨이 서버와 웹 셸 | `apps/desktop-shell/src/web/{server,session,shim,static}/**`, `src/web/main.ts` | W1의 인터페이스(`AuthPort`) | §2.2 |
| W3 | 서비스 쪽 연동 | `apps/host/src/service/gateway.ts`(새 파일), `apps/host/src/argv.ts`·`config` 키, `apps/cli/src/**`의 `service pair` | W2의 바이너리 이름과 실행 인자 | §2.3 |
| W4 | 데스크톱 UI와 셸 명령 | `apps/desktop/src/views/pages/connection/**`, `apps/desktop/src/app/connection.ts`, `apps/desktop-shell/src/main/server-mode.ts`(새 파일), `packages/client/src/settings/**` | W3 | §2.4 |
| W5 | 데스크톱의 TLS 클라이언트 | `packages/client/src/endpoint.ts`, `packages/client/src/connection-targets/**`, `packages/platform-process/src/transport/ws.ts`(새 파일), `apps/desktop-shell/src/main/engine/launcher.ts` | W2 | §2.5 |
| W6 | 로그인 자동 시작 | `apps/host/src/service/install.ts`(새 파일, launchd·systemd), `apps/cli/src/service-install.ts` | W3 | §2.6 |
| W7 | 플러그인 프레임(HTTPS) | `apps/desktop-shell/src/web/view/**`, `packages/client/src/views/app/scheme.ts`의 `{base}` 치환 | W2 | §2.7 |
| W8 | 브라우저 E2E와 속도 | `apps/desktop/test/web-e2e/**`, `scripts/` 새 스크립트 | W2, W7 | §2.8 |
| W9 | 옛 옵션 제거 | `packages/platform-process/src/transport/socket.ts`, `apps/host/src/argv.ts`, `apps/host/src/service/commands.ts`, `apps/cli` 사용법 문자열 | 사용자 삭제 승인, W5 | §2.9 |

- 병렬 가능: W1과 W2(둘은 `AuthPort` 인터페이스를 W0이 확정한 뒤), W5와 W3, W6과 W4·W7. 같은 파일을 둘이 고치는 일이 없도록 `argv.ts`는 W3, W9만 만진다(W3이 끝난 뒤 W9).
- 같은 층 import 금지(DR-02·DR-10): 게이트웨이는 `apps/desktop-shell` 안에 두어 `src/main/*` 모듈을 상대 경로가 아니라 같은 패키지 내부 import로 쓴다. 호스트(`apps/host`)는 게이트웨이를 import하지 않고 바이너리를 띄운다(W3).

## 2. 트랙별 상세

### 2.1 W1 인증·TLS 부품

- 순수 함수와 파일 저장: 페어링 코드 발급·검사(10자 base32, 5분, 일회용, 실패 잠금), 기기 토큰 발급과 해시 저장(`devices.json`), 로그인 쿠키 발급·검증·만료, Origin·Host 검사, 자체 서명 인증서 생성과 지문 계산(`node:crypto`만, 새 의존 없음).
- 끝난 상태: `AuthPort`(코드 만들기, 코드 사용, 토큰 검증, 기기 목록, 폐기)가 시험과 함께 있다. 폐기·만료·잠금·Origin 불일치의 값 비교 시험. 토큰 원문이 파일·로그에 없음을 시험.
- `AuthPort`(`src/web/auth/auth-port.ts`, 모두 동기, 실패는 `kind`가 있는 `Result`): `createPairingCode()`, `pairingStatus()`, `redeemPairingCode({code, deviceName, kind, address})`, `verifyToken(token, address)`, `listDevices()`, `revokeDevice(id)`, `revokeAllDevices()`, `onRevoked(listener)`. 만드는 함수는 `createAuthPort({dir, clock, logger})`다. 쿠키·`Authorization`에서 토큰 꺼내기(`cookies.ts` `deviceTokenOf`), Host·Origin 검사(`origin.ts` `checkHost`, `checkOrigin`), 보안 헤더(`headers.ts`)는 순수 함수이고 W2가 업그레이드와 `POST /pair`에서 이 순서(Host → Origin → 토큰)로 부른다.
- 웹 기기 권한 제한은 두지 않는다(`L4.remote.spec` §8.6). 기기 종류(`web`/`desktop`)는 만료 규칙만 가른다.
- Web Push 부품도 이 트랙이다(`L4.remote.spec` §6.2): VAPID 키 생성·보관과 JWT 서명(`src/web/auth/vapid.ts`), 구독 형식 검증·저장(`src/web/auth/push.ts`). 발송(페이로드 암호화와 HTTP 호출)은 W2·W3이고 서비스 워커는 W2다.

### 2.2 W2 게이트웨이 서버와 웹 셸

- `Bun.serve`로 루프백 HTTP와 외부 HTTPS 리스너, `/login`, `/pair`, `/wire`, `/shell`, 정적 UI 서빙. 탭마다 셸 레지스트리와 릴레이를 만든다. `socketLauncher`(서비스 Unix 소켓에 직접 연결, 자식 프로세스 없음)를 `Launcher` 인터페이스 구현으로 더한다. shim은 시제품의 `window.fresnelShell` 흉내를 WebSocket 통로로 옮기고 §6.1의 명령을 가로챈다.
- 끝난 상태: 루프백에서 인증을 거쳐 같은 UI 번들로 대화 만들기·승인이 된다(서비스 하나와 브라우저 탭 둘 E2E는 W8). 시험: 인증 없이 업그레이드 거절, 탭 간 레지스트리 분리, 명령 허용 목록.
- 시제품 `~/fresnel-tracks/_notes/tools/webshell/server.ts`는 참고용이고 코드는 가져오지 않는다(개발 도구 가정이 많다).

### 2.3 W3 서비스 쪽 연동

- 서비스가 `l4.remote.web.enabled`일 때 게이트웨이를 자식으로 띄우고 감독한다. `fresnel service pair`(코드 출력, `--json`), `service status`에 게이트웨이 상태와 지문을 더한다.
- [확인: 2026-11-09 W3] 구현됨: 감독자 `apps/host/src/service/gateway.ts`, wire `host.remote.*` 5개, `service pair`, `service status --json`의 `remote`. 임시 홈에서 실제 서비스 시작 → `service pair` → `POST /pair` → `/shell` 업그레이드 → `service stop` 뒤 게이트웨이 프로세스 없음을 확인했다. 릴리즈 묶음의 `fresnel-web`은 아직 없다 [근거: scripts/build-sidecar.ts, `L4.remote.spec` §5.1].
- 끝난 상태: `fresnel service start`만으로(데스크톱 없이) 게이트웨이가 뜨고 `service pair`의 코드로 브라우저가 붙는다. `service status --json`에 `remote` 필드. 종료코드 규칙(1 오류, 2 환경, 3 사람 확인)을 따른다.

### 2.4 W4 데스크톱 UI와 셸 명령

- 연결 화면(P-08)에 "서버 모드"(끔/서비스/서비스 + 외부 접근) 스위치와 확인 대화 상자, 페어링 코드 표시, 기기 목록·폐기, 지문 표시. `server-mode.ts`가 서비스 켜기·끄기, 사이드카에서 서비스로의 전환(§4.1) 명령을 등록한다. 기능 감지(`shell_capabilities`)와 "서버 폴더 고르기" 대화 상자도 여기서 UI를 만든다.
- 끝난 상태: 데스크톱만으로 서비스 켬 → 외부 접근 켬 → 코드 발급 → 브라우저 접속 → 기기 폐기가 된다(CLI 안 씀).
- [확인: 2026-11-10 rmWi] 연결 화면의 어댑터는 실제 `HostConnection` 요청에 이어졌다(`app/remote/remote-wiring.ts`). wire `remote.off`(5008)는 `errorOf`가 `rejected.issue: "remote-off"`로 싣고 어댑터가 `remote-off`로 읽는다. -32601은 `RemoteError`의 `unsupported`로 따로 알린다(엔진 오프라인·시간 초과는 `failed`). 임시 홈에서 웹 미리보기(`_notes/tools/webshell`에 서비스 모듈을 더한 것)와 headless Chrome으로 서비스 켜기, 외부 접근 켜기(확인 대화 상자), 코드 발급, 게이트웨이 루프백 주소의 코드 로그인, 기기 목록, 폐기, 그 탭의 `/login` 복귀를 확인했다(사진 `_notes/design/rmWi-shots/`). 단 `listenTls`는 CLI로 미리 정했다(spec §10). 화면 상태(빈, 읽는 중, 오류)와 문장(한국어·영어 카탈로그, `just terms check`).

### 2.5 W5 데스크톱의 TLS 클라이언트

- 주소 종류 `wss`, WebSocket 클라이언트 전송, 지문 고정(TOFU)과 토큰 보관(`platform-secrets`), 연결 화면의 새 대상 입력.
- 끝난 상태: 다른 컴퓨터의 데스크톱이 `wss://host:port`로 붙어 SC-08의 단계와 실패 문장(지문 변경, 인증 실패)을 보인다.

### 2.6 W6 로그인 자동 시작

- macOS launchd 사용자 에이전트와 Linux systemd 사용자 유닛 등록·해제(`fresnel service install|uninstall`, 명시 동의), 데스크톱 스위치. 등록 파일은 사용자 영역에만 쓴다.
- 끝난 상태: 재로그인 뒤 서비스가 자동으로 떠 있다(맥 수동 확인은 Mac 큐). 해제하면 흔적이 없다.

### 2.7 W7 플러그인 프레임

- §6.3의 `/view/...` 경로, 권한 토큰, sandbox iframe, CSP 치환. 브라우저에서 Helm 탐구 화면이 데스크톱과 같다.
- 끝난 상태: 프레임이 쿠키 없이 하위 자원을 받고, 앱 문서 쿠키·storage에 닿지 못함(시험), 경로 규칙은 `fresnel-view://`의 시험 벡터를 재사용한다.
- [확인: 2026-11-10 rmW7] 구현됨: 게이트웨이 `src/web/view/{tokens,route}.ts`와 `view_root` 명령(탭 연결마다 등록), `view-scheme.ts`의 `respondWithBase`·`registerAppRootsCommand`, 클라이언트 `scheme.ts`의 뿌리 인자와 `apps/desktop/src/plugin-ui/frame-root.ts`. 결정은 `L4.remote.spec` §6.3. 임시 홈(`/private/tmp/rmW7-home`)에서 사이드카 서비스와 게이트웨이(`src/web/main.ts`, 루프백)를 띄우고 headless Chrome으로 `/pair` 로그인 뒤 `examples/viewdemo`의 "Frame demo"(app 화면)를 열었다. 프레임이 `/view/<토큰>/viewdemo/1.0.0/index.html`·`app.js`를 200으로 받고 다리의 ping이 오가며, 프레임 안에서 `document.cookie`·`localStorage`는 `SecurityError`, `self.origin`은 `null`이다(사진 `_notes/design/rmW7-shots/`). Helm 탐구 화면은 이 작업 트리 밖 사본에만 있어 쓰지 않았고, Electron 화면과 나란히 비교하지는 못했다(맥 GUI 없는 실행).

### 2.8 W8 브라우저 E2E와 속도

- 헤드리스 브라우저 E2E(탭 둘 동기화, 재연결, 폐기). 번들 시작 시간과 wire 지연 측정을 속도 기준선(`just benchmark`)에 더한다.
- 끝난 상태: 스펙 §12의 수용 기준 1~6이 시험 이름과 연결된다.
- [확인: 2026-11-10 W8 구현] `just web-e2e`(시험 8개, `apps/desktop/test/web-e2e/`)와 `just web-e2e --bench`, `just benchmark --web`. 기준과 시험 이름의 연결은 스펙 §12 표, 측정값은 `eng.performance.guide` §2.2. 브라우저 도구는 저장소에 이미 있는 `Bun.WebView`(Chrome 백엔드)라 새 의존이 없다.

### 2.9 W9 옛 옵션 제거

- `--allow-non-loopback`, `allowNonLoopback`, 평문 비루프백 TCP 경로를 제거한다. 코드 삭제이므로 사용자가 승인한 뒤에만 한다.
- 끝난 상태: 옵션이 사라지고 사용 문자열과 시험이 `wss`·`ssh` 경로를 가리킨다.
- [확인: 2026-11-10 W9 구현] 옵션과 `allowNonLoopback`을 코드에서 지웠다. 비루프백 TCP는 `tcp_not_loopback`으로 거절한다. 시험: `service-socket.int.test.ts`, `service-control.test.ts`, `main.test.ts`, `usage-locale.test.ts`.

## 3. 위험과 확인할 것

- [확인: 2026-11-09 W2] 승인 해결 알림은 이미 그 대화를 구독한 모든 연결에 간다(`apps/host/src/handlers/events.ts` `startEventFanout`, 관찰 연결은 폴링). 서비스를 바꿀 일이 없어 W3 범위는 그대로다. 단 W8이 "탭 둘 승인 동기화"를 시험으로 고정한다.
- [확인: 2026-11-09 W2] UI 번들의 Electron 전제 목록: (1) `window.fresnelShell`이 없으면 `selectShellBridge`가 `none` 다리를 골라 모든 명령이 거절되므로 shim이 UI 모듈보다 먼저 같은 이름을 심는다(해결: W2). (2) `fresnel-view:` 하드코딩: `packages/client/src/views/app/scheme.ts`의 `APP_SCHEME`, `buildAppUrl`, 프레임 CSP(`connect-src ipc: http://ipc.localhost; frame-src fresnel-view:`)와 `frame-host.ts`의 프레임 주소(W7이 `{base}` 치환으로 푼다). (3) UI 자체 CSP: `style` 속성 80곳과 `.style.` 대입 10곳이 있어 웹 CSP에 `style-src 'unsafe-inline'`이 필요하다(`eval`·워커·서비스 워커 등록은 UI에 없다). (4) `navigator.clipboard`는 보안 컨텍스트(HTTPS, localhost)에서만 된다. 그 밖의 전역 의존은 찾지 못했다.
- Bun의 TLS 서버(`Bun.serve` `tls`)와 WebSocket의 컴파일 바이너리 동작은 실측하지 않았다 [가정]. W1 시작 때 spike로 확인한다.
- Mac이 켜진 시간이 짧다. launchd와 데스크톱 E2E는 Mac 큐에 넣는다.
