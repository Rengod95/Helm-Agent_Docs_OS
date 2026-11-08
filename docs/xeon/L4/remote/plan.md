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

- 순수 함수와 파일 저장: 페어링 코드 발급·검사(10자 base32, 5분, 일회용, 실패 잠금), 기기 토큰 발급과 해시 저장(`devices.json`), 세션 쿠키 발급·검증·만료, Origin·Host 검사, 자체 서명 인증서 생성과 지문 계산(`node:crypto`만, 새 의존 없음).
- 끝난 상태: `AuthPort`(코드 만들기, 코드 사용, 토큰 검증, 기기 목록, 폐기)가 시험과 함께 있다. 폐기·만료·잠금·Origin 불일치의 값 비교 시험. 토큰 원문이 파일·로그에 없음을 시험.

### 2.2 W2 게이트웨이 서버와 웹 셸

- `Bun.serve`로 루프백 HTTP와 외부 HTTPS 리스너, `/login`, `/pair`, `/wire`, `/shell`, 정적 UI 서빙. 세션마다 셸 레지스트리와 릴레이를 만든다. `socketLauncher`(서비스 Unix 소켓에 직접 연결, 자식 프로세스 없음)를 `Launcher` 인터페이스 구현으로 더한다. shim은 시제품의 `window.fresnelShell` 흉내를 WebSocket 통로로 옮기고 §6.1의 명령을 가로챈다.
- 끝난 상태: 루프백에서 인증을 거쳐 같은 UI 번들로 대화 만들기·승인이 된다(서비스 하나와 브라우저 탭 둘 E2E는 W8). 시험: 인증 없이 업그레이드 거절, 탭 간 레지스트리 분리, 명령 허용 목록.
- 시제품 `~/fresnel-tracks/_notes/tools/webshell/server.ts`는 참고용이고 코드는 가져오지 않는다(개발 도구 가정이 많다).

### 2.3 W3 서비스 쪽 연동

- 서비스가 `l4.remote.web.enabled`일 때 게이트웨이를 자식으로 띄우고 감독한다. `fresnel service pair`(코드 출력, `--json`), `service status`에 게이트웨이 상태와 지문을 더한다.
- 끝난 상태: `fresnel service start`만으로(데스크톱 없이) 게이트웨이가 뜨고 `service pair`의 코드로 브라우저가 붙는다. `service status --json`에 `remote` 필드. 종료코드 규칙(1 오류, 2 환경, 3 사람 확인)을 따른다.

### 2.4 W4 데스크톱 UI와 셸 명령

- 연결 화면(P-08)에 "서버 모드"(끔/서비스/서비스 + 외부 접근) 스위치와 확인 대화 상자, 페어링 코드 표시, 기기 목록·폐기, 지문 표시. `server-mode.ts`가 서비스 켜기·끄기, 사이드카에서 서비스로의 전환(§4.1) 명령을 등록한다. 기능 감지(`shell_capabilities`)와 "서버 폴더 고르기" 대화 상자도 여기서 UI를 만든다.
- 끝난 상태: 데스크톱만으로 서비스 켬 → 외부 접근 켬 → 코드 발급 → 브라우저 접속 → 기기 폐기가 된다(CLI 안 씀). 화면 상태(빈, 읽는 중, 오류)와 문장(한국어·영어 카탈로그, `just terms check`).

### 2.5 W5 데스크톱의 TLS 클라이언트

- 주소 종류 `wss`, WebSocket 클라이언트 전송, 지문 고정(TOFU)과 토큰 보관(`platform-secrets`), 연결 화면의 새 대상 입력.
- 끝난 상태: 다른 컴퓨터의 데스크톱이 `wss://host:port`로 붙어 SC-08의 단계와 실패 문장(지문 변경, 인증 실패)을 보인다.

### 2.6 W6 로그인 자동 시작

- macOS launchd 사용자 에이전트와 Linux systemd 사용자 유닛 등록·해제(`fresnel service install|uninstall`, 명시 동의), 데스크톱 스위치. 등록 파일은 사용자 영역에만 쓴다.
- 끝난 상태: 재로그인 뒤 서비스가 자동으로 떠 있다(맥 수동 확인은 Mac 큐). 해제하면 흔적이 없다.

### 2.7 W7 플러그인 프레임

- §6.3의 `/view/...` 경로, 능력 토큰, sandbox iframe, CSP 치환. 브라우저에서 Helm 탐구 화면이 데스크톱과 같다.
- 끝난 상태: 프레임이 쿠키 없이 하위 자원을 받고, 앱 문서 쿠키·storage에 닿지 못함(시험), 경로 규칙은 `fresnel-view://`의 시험 벡터를 재사용한다.

### 2.8 W8 브라우저 E2E와 속도

- 헤드리스 브라우저 E2E(탭 둘 동기화, 재연결, 폐기). 번들 시작 시간과 wire 지연 측정을 속도 기준선(`just benchmark`)에 더한다.
- 끝난 상태: 스펙 §12의 수용 기준 1~6이 시험 이름과 연결된다.

### 2.9 W9 옛 옵션 제거

- `--allow-non-loopback`, `allowNonLoopback`, 평문 비루프백 TCP 경로를 제거한다. 코드 삭제이므로 사용자가 승인한 뒤에만 한다.
- 끝난 상태: 옵션이 사라지고 사용 문자열과 시험이 `wss`·`ssh` 경로를 가리킨다.

## 3. 위험과 확인할 것

- 승인 해결 알림이 여러 연결에 가는지(W2 첫 일): 없으면 서비스(`apps/host`)에 알림을 더해야 하고, 그 경우 W3 범위에 들어간다.
- 같은 UI 번들이 `electron` 전제를 숨기고 있는지(`window.fresnelShell` 외의 전역, `fresnel-view:` 하드코딩): W2 시작 때 번들을 훑어 목록을 만든다.
- Bun의 TLS 서버(`Bun.serve` `tls`)와 WebSocket의 컴파일 바이너리 동작은 실측하지 않았다 [가정]. W1 시작 때 spike로 확인한다.
- Mac이 켜진 시간이 짧다. launchd와 데스크톱 E2E는 Mac 큐에 넣는다.
