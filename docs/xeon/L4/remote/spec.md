---
id: L4.remote.spec
layer: L4
domain: remote
kind: spec
status: draft
depends_on: [L4.host-service.spec, L4.desktop.spec, L4.desktop-ux.spec, L4.cli.spec, L0.process.spec, F.wire-settings.spec, architecture.security.spec, adr.0006, adr.0008, adr.0021]
binds: [xeon/apps/desktop-shell/src/web/**]
---

# L4 원격 origin과 웹 접근 (remote)

서버 컴퓨터의 Fresnel(데스크톱 앱 또는 CLI 서비스)이 엔진·저장소·예약의 유일한 원천(origin)이고, 다른 기기는 그 origin의 모든 대화에 붙어 똑같이 쓴다. 이 문서는 그 접속 구조, 웹 브라우저 접근, 인증과 TLS, 보안 경계를 정한다. 선택지 비교와 근거는 `~/fresnel-tracks/_notes/design/remote-origin.md`(작업 노트, 정본 아님)에 있고, 구현 트랙 분할은 `L4.remote.plan`이 정한다.

## 1. 목적과 범위

### 1.1 정하는 것

- origin의 정의와 붙는 쪽 세 가지(같은 컴퓨터 데스크톱, 다른 컴퓨터 데스크톱, 웹 브라우저)(§3).
- 데스크톱 앱이 서비스 모드와 외부 접근을 켜고 끄는 방식, 앱을 닫아도 origin이 도는 방식(§4).
- 외부 리스너인 웹 게이트웨이의 주소 체계, 한 연결 안의 두 통로(wire, shell)(§5).
- 같은 UI 번들을 브라우저에 올릴 때 셸 명령이 바뀌는 방식(§6)과 여러 기기 동시 접속의 상태 동기화(§7).
- TLS, 기기 페어링과 토큰, 로그인 유지 기간, Origin 검사, CSP, 권한 범위(§8).
- 비루프백 리스너에 관한 기존 스펙 충돌의 정리(§9).

### 1.2 다루지 않는 것

- 네이티브 모바일 앱 [결정: 2026-11-08 사용자 "나중"].
- 클라우드 호스팅, 중계 서버(NAT 통과). origin에 닿는 네트워크(사설망, 포트 포워딩, Tailscale)는 사용자가 마련한다 [제안].
- 웹 푸시(탭이 닫힌 뒤의 알림)는 이번 범위에 넣는다(§6.2) [결정: 2026-11-08 사용자 "Web Push를 이번 범위에 넣는다"].

### 1.3 근거

- [결정: 2026-11-08 원격 방향] `_notes/m4-decisions.md`. origin은 모든 작업의 원천이고 별도의 "원격 감사" 개념이 없다. 웹 UI는 데스크톱과 완전히 같은 UI/UX와 기능이다. SSH 경로도 같은 수준으로 지원한다. 외부 접근에는 TLS를 쓴다. 데스크톱 앱은 서비스 모드와 외부 접근을 직접 켜고 끈다.
- 기존 코드: `apps/host/src/service/*`(서비스 수명, 등록 파일, ensure), `packages/platform-process/src/transport/socket.ts`(unix·tcp 전송과 토큰), `packages/client/src/endpoint.ts`(주소 문법), `apps/desktop-shell/src/main/*`(셸 모듈, 모두 `ShellContext`만 받는다), `apps/desktop-shell/src/preload.ts`(`window.fresnelShell`).
- 같은 UI 번들을 브라우저에 올리는 방식은 `_notes/tools/webshell/server.ts`가 2026-11-08에 실제로 동작함을 보였다. 그 시제품은 셸 모듈을 Bun 서버에 등록하고 `window.fresnelShell`을 HTTP와 SSE로 흉내 냈다.

## 2. 용어

| 용어 | 뜻 |
|---|---|
| origin | 엔진과 저장소를 가진 서비스 프로세스와 그 컴퓨터. `fresnel service run`으로 뜬 호스트(`L4.host-service.spec` §4.9)다 |
| 게이트웨이 | origin 컴퓨터에서 도는 외부 리스너. HTTPS로 UI 번들과 두 통로를 내놓는다. origin의 서비스 소켓에는 평범한 클라이언트로 붙는다 |
| 통로 | 게이트웨이 연결 하나 안의 두 WebSocket. `/wire`(엔진 JSON Lines)와 `/shell`(셸 명령·채널·이벤트) |
| 기기 | 페어링을 마친 클라이언트 하나(브라우저 프로필, 다른 컴퓨터의 데스크톱 앱). 기기마다 토큰이 있다 |
| 페어링 코드 | origin이 보이는 일회용 코드. 기기를 처음 붙일 때만 쓴다 |
| 로컬 클라이언트 | origin과 같은 컴퓨터의 데스크톱 앱이나 CLI. 서비스의 Unix 소켓으로 붙는다 |

## 3. 구조

```
                    origin 컴퓨터 (한 사용자 계정)
  ┌──────────────────────────────────────────────────────────────┐
  │  fresnel service (호스트 바이너리, `service run`)            │
  │    엔진 · 저장소(SQLite) · 예약 · 시크릿 · 대화 잠금         │
  │    리스너: Unix 소켓 0600 (+ 선택: 루프백 TCP, 토큰)         │
  │             ▲ 평범한 wire 클라이언트로 붙는다                │
  │  ┌──────────┴───────────┐        ┌─────────────────────────┐ │
  │  │ 로컬 데스크톱 앱     │        │ fresnel-web 게이트웨이  │ │
  │  │ (Electron 셸, 소켓)  │        │ (apps/desktop-shell     │ │
  │  └──────────────────────┘        │  src/web, Bun 바이너리) │ │
  │  fresnel CLI ── 소켓             │  :8443 HTTPS+TLS · 인증 │ │
  │                                  │  127.0.0.1:8480 HTTP    │ │
  │                                  └───────────▲─────────────┘ │
  └──────────────────────────────────────────────┼───────────────┘
        ssh -L (터널)  ─────────────────────────▶ │ (루프백 HTTP 또는 소켓)
  다른 컴퓨터 데스크톱 ── wss://host:8443/wire ───▶│ (TLS + 기기 토큰)
  웹 브라우저(태블릿 포함) ── https://host:8443 ──▶│ (UI 번들 + /wire + /shell)
```

- origin은 서비스 프로세스 하나다. 같은 데이터 폴더에서 엔진이 둘 뜨지 않는다. 데스크톱 앱이 서비스 모드를 켜면 앱이 띄운 사이드카 엔진(stdio)은 서비스에 붙는 클라이언트로 바뀐다(§4).
- 서비스 호스트는 비루프백 리스너를 열지 않는다. 외부 리스너는 게이트웨이 하나이고, 항상 TLS와 기기 인증을 거친다(§9).
- 게이트웨이는 서비스를 신뢰 경계 밖의 클라이언트처럼 다룬다. 서비스 쪽 인가는 Unix 소켓 권한(같은 사용자)이고, 게이트웨이가 외부 인증을 맡는다.

### 3.1 붙는 쪽

| 붙는 쪽 | 경로 | 인증 | 상태 |
|---|---|---|---|
| 같은 컴퓨터 데스크톱 | 서비스 Unix 소켓(`bridgeStdioToService`) | 소켓 권한(SV-05) | 있음 |
| 다른 컴퓨터 데스크톱(SSH) | `ssh://user@host/abs/socket` 터널 | SSH 키 + 소켓 권한 | 있음 |
| 다른 컴퓨터 데스크톱(TLS) | `wss://host:port` 게이트웨이 `/wire` | 기기 토큰 + TLS 지문 고정 | 새로 만든다 |
| 웹 브라우저 | `https://host:port` 게이트웨이 | 기기 토큰 쿠키 + TLS | 새로 만든다 |
| 웹 브라우저(SSH) | `ssh -L 8480:127.0.0.1:8480` 후 `http://localhost:8480` | SSH 키 + 루프백(쿠키 인증은 그대로) | 새로 만든다 |

- 주소 문법에 `wss://host:port[/pin/<sha256>]` 종류(`kind: "wss"`)를 더한다 [제안]. 기존 `tcp://` 종류는 §9에서 정리한다. 데스크톱 클라이언트의 동작은 §3.2가 정한다.
- 다른 컴퓨터 데스크톱이 SSH와 TLS 둘 다 되는 것은 사용자의 환경 차이 때문이다. 둘의 UX는 같다(연결 화면 P-08의 대상 하나).

### 3.2 데스크톱의 TLS 클라이언트 (`wss`)

다른 컴퓨터의 데스크톱이 `wss://host:port[/pin/<sha256>]` 대상에 붙는 방식이다. 연결 화면(P-08)의 대상 입력과 목록은 `ssh://` 대상과 같다. 코드는 `packages/client`의 주소·대상 문법, `packages/platform-process`의 `connectWebSocket`, `packages/platform-secrets`의 `TokenVault`가 나눠 가진다 [제안].

- **주소**: `/pin/<sha256>`은 서버 인증서 DER의 SHA-256(64자리 16진수, 대소문자와 `:` 구분자는 받고 저장은 소문자)이다. 지문 없는 `wss` 대상은 첫 접속 때 지문을 확인받아 고정한다. 평문 비루프백 `tcp://`는 대상 목록이 계속 거절한다(§9). 대상 목록은 LAN과 외부 `wss` 주소를 받는다.
- **전송**: 게이트웨이 `/wire`에 WebSocket을 열고, 받은 메시지를 바이트 흐름으로 이어 붙여 stdio와 같은 JSON Lines 프레이밍을 쓴다(메시지 경계에 기대지 않는다). 업그레이드 요청에 `Authorization: Bearer <기기 토큰>`과 게이트웨이 자신의 출처와 같은 `Origin`을 싣는다(§8.5가 `Origin` 없는 업그레이드를 거절하기 때문이다). 토큰은 URL, 인자, 로그, 오류 값에 넣지 않는다.
- **지문 고정(TOFU)**: 고정된 대상은 접속 전에 서버 인증서의 지문을 재어 같을 때만 그 인증서 하나를 유일한 신뢰 앵커로 삼아 연결한다. 재는 때와 여는 때 사이에 인증서가 바뀌면 검증이 막는다. 다르면 연결하지 않고 `fingerprint_changed`(기대 값과 실제 값)를 돌려준다. 고정이 없으면 시스템 신뢰 저장소로 검증하고(사용자 인증서·Tailscale 등), 믿을 수 없으면 `tls_untrusted`와 서버 지문을 돌려주어 화면이 "이 지문이 맞아요?"를 묻고, 사용자가 확인하면 주소에 `/pin/<sha256>`을 붙여 저장한다. 지문이 바뀐 서버는 사용자가 새 지문을 다시 확인하기 전까지 접속하지 않는다.
- **토큰 보관**: 기기 토큰은 OS 보안 저장소(macOS Keychain, Linux Secret Service)의 항목 `fresnel.remote-device`/`host:port`에 둔다(`TokenVault`). 지문을 새로 고정해도 같은 항목이다. 보안 저장소가 없는 플랫폼은 환경 변수 `FRESNEL_REMOTE_TOKEN`으로 받는다. 설정 파일과 대상 주소에는 두지 않는다. 데스크톱 셸이 토큰을 읽어 사이드카 엔진의 환경 변수로만 넘긴다.
- **실패 문장**: 엔진이 멈춘 원인(stderr 첫 줄)으로 연결 화면이 고른다. 지문 변경은 "TLS fingerprint changed", 믿을 수 없는 인증서는 "certificate is not trusted yet", 게이트웨이 거절(토큰 없음·불일치·폐기, `Origin`, `Host`)은 "token does not match" 문구를 쓴다. 클라이언트는 업그레이드가 101이 아닐 때 거절 이유를 가르지 못하므로(WebSocket 구현의 한계) 모두 인증 실패 한 종류로 보이고, 해결은 "새 코드로 다시 페어링"이다.

## 4. 서비스 모드와 외부 접근의 켜고 끔

[제안] 데스크톱 앱이 아래를 직접 한다. CLI 전용 동작을 두지 않는다(`fresnel service start|stop|status`, `--listen-tcp`에 대응하는 데스크톱 경로가 모두 있어야 한다).

### 4.1 상태 모델

서버 상태는 세 가지로 보인다. 설정 키는 L0 `l0.process.service.enabled`(있음)에 `l4.remote.*`를 더한다(§10).

| 상태 | 뜻 | 앱 동작 |
|---|---|---|
| 끔 | 사이드카 엔진(stdio)만. 외부 접근 없음 | 지금의 기본 |
| 서비스 | 서비스가 origin이고 로컬 클라이언트만 붙는다 | 앱이 서비스를 `ensure`로 띄우고(detached) 붙는다 |
| 서비스 + 외부 접근 | 서비스에 게이트웨이가 켜져 있다 | 게이트웨이를 띄운다. 페어링과 기기 목록 화면이 열린다 |

- 끔 → 서비스: 사이드카를 정상 종료 순서(`host.shutdown`)로 끝내고 서비스를 띄운 뒤 서비스에 붙는다. 진행 단계(멈춤, 서비스 시작, 동기화)를 연결 화면이 보인다(SC-08의 단계 표시와 같다).
- 서비스 + 외부 접근을 켤 때 앱은 켜는 사람의 확인을 받는다(대화 상자: 열리는 주소, TLS 지문, "이 컴퓨터의 모든 대화와 도구 실행 권한이 연결된 기기에 열린다"는 문장). OS 재인증(`os_reauth`)은 거치지 않는다. 확인 대화 상자가 확인 수단이다 [결정: 2026-11-09 W4, 근거: 브리프 "확인 대화 상자 뒤 `host.remote.setEnabled`"]. 화면은 `서버 모드` 구역(연결 화면, `connection-server.tsx`)이고 단계는 서비스 켜기 → 확인 → 외부 접근 켜기이며 취소하면 아무것도 바꾸지 않는다.
- 끄기는 반대 방향이고, 외부 접근만 끄는 것(게이트웨이 종료, 열린 연결 즉시 끊음)을 서비스를 끄는 것과 따로 둔다.

### 4.2 앱을 닫아도 origin이 도는 방식 비교

| 방식 | 앱 닫음 | 로그아웃 | 재부팅 | GUI 없는 서버 | 비용 |
|---|---|---|---|---|---|
| A. 앱 소유 자식 프로세스 | 같이 끝남 | 끝남 | 끝남 | 불가 | 가장 단순. 외부 접근에는 부적합 |
| B. 앱이 띄운 detached 서비스 | 계속 | 계속(맥) | 끝남 | 불가 | 있는 코드(`ensure`, SV-06) |
| C. 앱 로그인 항목(숨김 + 트레이) | 트레이로 계속 | 끝남 | 로그인 때 다시 | 불가 | Electron `setLoginItemSettings`. 앱 전체가 상주 |
| D. launchd 사용자 에이전트·systemd 사용자 유닛 | 계속 | 계속 | 로그인 때 자동 | 가능(linger) | `fresnel service install`(ADR-0006 2차). 새로 만든다 |

[결정: 2026-11-08 사용자 "앱을 닫아도 서비스는 계속 돈다. 로그인 자동 시작은 사용자가 켜는 스위치"] 기본은 B이고, "로그인할 때 자동으로 켜기" 스위치가 D를 등록한다. C는 쓰지 않는다. 이유: C는 상주하는 대상이 서비스가 아니라 UI를 가진 앱이라 메모리와 갱신(앱 업데이트 중 origin이 내려감)이 묶이고, D가 같은 목적을 더 작은 프로세스로 이룬다. D 등록은 명시 동의 뒤에만 한다(ADR-0006 §3.4의 `fresnel service install`을 데스크톱 스위치가 같은 코드로 부른다).

- B에서 앱이 끝나도 서비스는 남는다. 앱 종료 때 "서비스는 계속 실행돼요. 끄려면 설정 > 연결에서 끄세요" 한 줄을 한 번 보인다 [제안]. 서비스를 끄지 않고 앱만 닫는 것이 서버 모드의 정상 사용이기 때문이다.
- 서비스 업데이트: 앱이 새 버전으로 바뀌면 `host.status`의 버전 불일치를 감지해 재시작을 묻는다(실행 중인 대화가 있으면 연결 화면의 안전한 종료 흐름 O-06을 쓴다).

## 5. 게이트웨이

### 5.1 프로세스와 위치

- 코드는 `xeon/apps/desktop-shell/src/web/`에 둔다. 같은 패키지에 있으므로 DR-10(앱끼리 import 금지)에 걸리지 않고, `src/main/*`의 셸 모듈(electron을 import하지 않는다)을 그대로 쓴다 [제안, 근거: `apps/desktop-shell/src/main/context.ts`의 계약]. 별도 패키지로 옮기려면 DR-10 예외를 더해야 한다.
- 빌드 산출물은 Bun 컴파일 바이너리 `fresnel-web`이다. 서비스가 `l4.remote.web.enabled`가 참일 때 자식으로 띄우고 감독한다(죽으면 재시작 상한 안에서 되살린다). 서비스가 내려가면 게이트웨이도 끝난다 [결정: 2026-11-09 W3 구현].
- [확인: 2026-11-09 W3] 감독자는 `apps/host/src/service/gateway.ts`(호스트는 게이트웨이 코드를 import하지 않고 L0 `spawnPiped`로 프로세스만 띄운다)다. 서비스는 시작할 때 `l4.remote.web.enabled`가 참이면 기다리지 않고 게이트웨이를 띄운다(실패해도 서비스는 정상 기동하고 `host.remote.status`가 `failed`와 원인을 보인다). 서비스가 끝나는 세 길(유휴, 신호, `host.shutdown`)은 모두 등록 파일과 소켓을 내리기 전에 게이트웨이를 정리한다: 표준 입력 `stop` → 3초 → SIGTERM → 3초 → SIGKILL.
- 재시작 정책: 준비된 뒤 자식이 죽으면 60초 안에 3번까지 0.5초, 2초, 5초 뒤 다시 띄운다(그동안 상태 `starting`). 상한을 넘으면 `failed`, 원인 `gateway-down`이다. 준비 전에 종료코드 2로 끝나거나 실행 파일이 없으면 환경 문제이므로 재시작하지 않고 `failed`, 원인 `gateway-environment` 또는 `gateway-binary-missing`이다(`service pair`는 이 원인에서 종료코드 2). 제어 요청(`pair`, `devices`, `revoke`)은 응답에 요청 번호가 없으므로 하나씩 보내고, 5초 안에 답이 없으면 자식을 SIGKILL하고 재시작 정책을 따른다(늦은 답이 다음 요청의 답으로 읽히지 않게).
- 실행 파일 찾기(순서): 환경 변수 `FRESNEL_WEB_BIN`(절대 경로) → 서비스 바이너리와 같은 폴더의 `fresnel-web` → 개발 트리의 `apps/desktop-shell/src/web/main.ts`(서비스가 `bun`으로 돌 때, `bun run`). `--ui`는 환경 변수 `FRESNEL_WEB_UI`가 있을 때만 넘긴다(없으면 게이트웨이 기본 `apps/desktop/dist/ui`). 자식 환경 변수는 허용 목록(PATH, HOME, LANG, TMPDIR 등)과 `FRESNEL_*`(이름에 TOKEN, SECRET, PASS, KEY, CREDENTIAL이 든 것 제외)뿐이다.
- [미결: 릴리즈 묶음] 릴리즈 묶음(Electron 앱의 사이드카 폴더와 `fresnel` 바이너리 배포)에는 아직 `fresnel-web`이 없다. `scripts/build-sidecar.ts`에 같은 `bun build --compile --minify --bytecode`로 `apps/desktop-shell/src/web/main.ts`를 `fresnel-web`으로 빌드하는 대상을 더하고, UI 번들(`apps/desktop/dist/ui`)을 같은 폴더의 `ui/`로 넣어 `--ui`를 서비스가 그 옆 경로로 넘기게 해야 한다(W8 또는 별도 트랙). 그때까지 릴리즈 묶음에서는 `FRESNEL_WEB_BIN`으로 지정한 경우에만 게이트웨이가 뜬다.
- 게이트웨이는 서비스 Unix 소켓에 탭마다 연결을 하나씩 연다(§7). 서비스 쪽에는 새 전송이 필요 없다.

### 5.2 주소 체계

| 경로 | 뜻 | 인증 |
|---|---|---|
| `GET /` , `/assets/*` | 데스크톱과 같은 UI 번들(`apps/desktop/dist/ui`)과 웹 셸 shim | 인증 쿠키가 없으면 `/login`으로 보낸다. shim과 정적 자원은 시크릿이 없어 인증 없이도 내줄 수 있다 |
| `GET /login` | 페어링 코드 입력 화면(UI 번들과 별개의 작은 정적 페이지) | 없음 |
| `POST /pair` | 코드 → 기기 토큰 발급(§8.3) | 코드 |
| `GET /wire` (WebSocket) | 엔진 wire JSON Lines. 프레임·한도는 stdio 전송과 같다(`maxFrameBytes`) | 기기 토큰(쿠키 또는 `Authorization`) |
| `GET /shell` (WebSocket) | 셸 명령 요청·응답, 채널 메시지, 이벤트 | 위와 같다 |
| `GET /view/<권한토큰>/<확장>/<버전>/<경로>` | 플러그인 프레임 파일(§6.3) | 탭 연결에 묶인 권한 토큰 |
| `GET /shell/shim.js`, `GET /sw.js`, `GET /login.js`, `/login.css` | shim, 서비스 워커(`Service-Worker-Allowed: /`), 로그인 페이지 자원. 소스는 TS이고 시작 때 `Bun.build`로 묶어 메모리에서 내준다(`.js` 파일을 저장소에 두지 않는다) | 없음 |
| `GET /api/session`, `POST /logout` | 로그인 상태 확인(`{device}` 또는 401), 쿠키 지우기(폐기 아님) | 쿠키 |
| `GET /push/vapid-key`, `POST /push/subscribe` | VAPID 공개 키 `{publicKey}`, 구독 등록(§6.2) | 쿠키, 구독은 Origin 검사 |

- [확인: 2026-11-09 W2] 브라우저의 엔진 접속은 `/shell`의 `engine_attach/write/ack/detach/restart` 명령이고, 게이트웨이가 탭마다 `Supervisor`와 `Relay`를 만들어 서비스 소켓에 직접 붙는다(`src/web/session/socket-launcher.ts`, 자식 프로세스 없음). 한 소켓에 합치는 방식(§5.2 아래 [제안])을 택한 셈이다. `/wire`는 데스크톱 `wss` 클라이언트(W5)용 바이트 릴레이다: 메시지(텍스트·바이너리)를 서비스 소켓의 JSON Lines 바이트로 그대로 잇고, 메시지 하나는 프레임 하나이며 `maxFrameBytes`를 넘으면 1009로 닫는다. 서비스 Unix 소켓은 평범한 JSON Lines이고 접두나 토큰이 없다(서버는 `host.hello`를 기다린다).
- [확인: 2026-11-09 W2] 외부 리스너는 `secureOptions`로 TLS 1.0~1.2를 끈다(Bun 1.4.3은 `minVersion: "TLSv1.3"`을 거절한다). 1.2 전용 클라이언트는 `protocol_version` 경고로 거절된다.

- 한 연결에 통로가 둘인 이유: wire는 엔진 프로토콜을 그대로 중계하고(바이트 스트림), shell은 `invoke`와 채널을 나른다. 시제품은 HTTP POST와 SSE로 같은 일을 했지만, 승인 같은 즉시 응답과 흐름 제어를 위해 WebSocket 하나로 합친다. 합치는 방식(한 소켓에 프레임 종류 태그)이 더 단순하면 구현이 그쪽으로 바꿀 수 있다 [제안].
- UI 번들의 엔진 접속은 지금 `window.fresnelShell`의 `engine_attach`/`engine_write` 채널이다. 웹 셸은 이 명령을 `/wire`에 연결하는 어댑터이므로 UI 코드는 바뀌지 않는다(§6).

### 5.3 리스너

| 이름 | 주소 | 프로토콜 | 기본 |
|---|---|---|---|
| 루프백 | `127.0.0.1:<port>` | HTTP(TLS 없음) | 외부 접근이 켜지면 같이 연다. SSH 터널 끝과 같은 컴퓨터의 브라우저용. 인증은 똑같이 요구한다 |
| 외부 | `<host>:<port>` | HTTPS | 사용자가 `listen` 주소를 정했을 때만. 기본 주소는 없다 |

- 외부 주소를 정하지 않으면 외부 리스너는 열리지 않는다(루프백만). `0.0.0.0`은 허용하되 켤 때 확인 문장을 보인다.
- 루프백 HTTP에서도 쿠키와 Origin 검사는 같다. 브라우저는 `http://localhost`를 보안 컨텍스트로 취급한다 [가정: 실측 필요, 사용 브라우저 목록은 계획 W1이 정한다].

## 6. 셸 기능의 웹 대응

웹 셸은 `window.fresnelShell`(`invoke`, `openChannel`, `closeChannel`, `listen`)을 브라우저에서 구현하는 JavaScript(shim)이고, UI 번들은 그대로다. 명령 처리는 게이트웨이의 셸 레지스트리가 맡고, 브라우저에서 의미가 바뀌는 명령만 shim이 가로챈다. 명령이 어느 쪽 컴퓨터에서 일하는지를 아래 표가 정한다.

### 6.1 명령별 대응

| 셸 명령 | 데스크톱 동작 | 웹 대응 | 실행 위치 |
|---|---|---|---|
| `engine_attach/write/ack/detach/restart` | 사이드카 stdio 중계 | `/wire`로 서비스 소켓 중계. 탭마다 하나(§7). `engine_restart`는 그 탭의 연결을 다시 연다 | origin |
| `engine_retarget` | 엔진 대상을 바꿈 | 웹에서는 거절한다(대상은 origin 하나). 연결 화면의 "원격 대상 추가"를 숨긴다 | - |
| `pick_file_read` | OS 파일 선택 후 읽기 | `<input type="file">` 선택 후 바이트를 올린다 | 브라우저 |
| `save_file` | 저장 위치 대화 상자 | Blob 다운로드(`<a download>`) | 브라우저 |
| `pick_folder` | OS 폴더 선택 | 웹은 이 명령을 두지 않는다(`unknown-command`). UI가 `shell_capabilities`의 `folderPicker: "origin"`을 보고 "서버 폴더 고르기" 대화 상자를 연다. 대화 상자는 `origin_folder_list`로 origin의 폴더만 한 단계씩 보인다. 작업 폴더가 origin에 있기 때문이다 [결정: 2026-11-09 W4] | origin |
| `origin_folder_list` | (데스크톱에 없음) | 인자 `{ path? }`(절대 경로, 없으면 origin 사용자의 홈), 답 `{ path, parent, home, entries: [{ name, path }], truncated }`. 폴더만 이름순(점 폴더는 뒤), 2000개 상한. 상대 경로·NUL은 `bad-request`, 없거나 폴더가 아니거나 못 읽으면 `read_failed` | origin |
| `pick_folder_open` | 플러그인 화면의 폴더 고르기 | 웹에서는 아직 두지 않는다(경로로 핸들을 만드는 명령이 필요하다). W4 범위 밖이다 [미결: 후속] [근거: apps/desktop-shell/src/web/session/commands-table.ts FOLDER_PICKER_GAP] | - |
| `folder_list`, `folder_read` | 선택한 폴더 안 읽기 | 그대로. 핸들은 (탭 연결, 화면 scope)별이다 | origin |
| `open_external` | OS 기본 앱으로 열기 | `window.open(url, "_blank", "noopener,noreferrer")`. 허용 스킴(http, https, mailto)은 그대로 shim도 검사한다 | 브라우저 |
| `open_data_dir`, `open_log_dir` | 파인더로 열기 | 숨긴다. 대신 경로 문자열과 복사 버튼을 보인다 | - |
| `notify_permission`, `notify_request_permission`, `notify_os` | OS 알림 | 브라우저 Notification API. 권한 요청은 사용자 제스처 안에서만. 알림 클릭은 탭을 앞으로 가져와 `openThread` 의도를 낸다 | 브라우저 |
| `shell_take_intents`, `notify_take_target` | 트레이·알림 의도 | 탭 안 의도 큐(셸 의도 큐와 같은 동작, 탭별) | 게이트웨이 |
| `tray_update` | 트레이 메뉴 | 무동작(`ok`). 열린 탭의 제목 접두("(2) Fresnel")로 진행 중 개수를 보인다 [제안] | 브라우저 |
| `update_status/check/download/install_restart` | 앱 자동 업데이트 | 숨긴다. origin 앱·서비스의 업데이트는 origin 컴퓨터의 데스크톱에서만 한다 | - |
| `os_reauth` | Touch ID, Mac 암호 | 웹은 쓸 수 없다. 재인증을 거치던 동작(시크릿 값 열람, 서비스 끄기)은 웹 기기에서도 허용하고 기기 인증이 대신한다(§8.6) | - |
| `secret_register` | 사이드카를 한 번 띄워 stdin으로 값 전달 | 허용. 값은 TLS 위의 `/shell` 본문으로만 가고 게이트웨이가 사이드카 stdin으로 넘긴다. 게이트웨이 로그에 값을 쓰지 않는다 | origin |
| `desktop_settings_read/write` | 이 앱의 `desktop-settings.json` | 기기별 설정을 origin의 `<상태 폴더>/remote/device-settings/<기기 id>.json`(0600, 폴더 0700)에 둔다. 닫기 동작·종료 대기·재시작 상한은 origin 데스크톱 전용이라 쓰면 `bad-request`, 읽으면 빠진다 [결정: 2026-11-09 W4] | origin |
| `db_export`, `db_usage`, `db_previous_remove`, `db_restore` | 백업·복원 | 백업 내려받기는 Blob 다운로드. 복원과 삭제도 데스크톱과 똑같이 허용한다(§8.6, [결정: 2026-11-08]). 파괴적이라 앱의 확인 대화 상자는 그대로 거친다 | origin |
| `app_roots_set` | 프레임 root 등록 | 탭별로 등록한다 | 게이트웨이 |
| 창·트레이·단일 인스턴스·창 위치 | Electron 전용 | 해당 없음 | - |

- 숨기는 명령은 "기능이 없는 것"이 아니라 웹에서 UI가 다른 방식으로 같은 목적을 이루는 곳이다. UI는 `window.fresnelShell.invoke`의 성공 응답 대신 기능 감지(`shell_capabilities` 명령, 웹과 데스크톱이 다른 값을 돌려준다 [제안])로 버튼을 숨긴다.
- 데스크톱 셸이 다른 컴퓨터의 origin에 붙을 때도 `pick_folder`의 경로는 그 컴퓨터에 없다. 이 간극(SC-08의 한계)은 같은 "서버 폴더 고르기"로 메운다(계획 W4).

### 6.2 알림

- 탭이 열려 있는 동안은 Notification API를 쓴다.
- 탭이 닫힌 뒤의 푸시(Web Push)를 이번 범위에 넣는다 [결정: 2026-11-08 사용자]. 서비스 워커와 외부 푸시 서비스(FCM, Mozilla autopush, Apple)를 거치므로 브라우저가 신뢰하는 HTTPS 출처가 필요하다. 신뢰되지 않는 자체 서명 인증서에서는 브라우저가 서비스 워커 등록을 거절하므로 푸시는 사용자 인증서 경로(§8.2)를 쓰는 출처나 `localhost`에서만 켜진다 [가정: 실측 필요, 브라우저별 차이는 W2가 확인]. 푸시가 안 되는 출처에서는 탭이 열려 있는 동안의 Notification API와 탭 제목 접두만 쓴다(§11). [확인: 2026-11-10 rmWi] wire `host.remote.status`의 `pushAvailable`은 서비스 쪽 발송 준비(게이트웨이가 실행 중)일 뿐 브라우저 신뢰를 말하지 않는다. 연결 화면은 `certSource`가 `self-signed`이면 `pushAvailable`이 참이어도 "이 주소에서는 꺼져 있어요"로 보인다(`pushShownAvailable`).
- VAPID 키(RFC 8292): origin이 ECDSA P-256 키 한 쌍을 처음 필요할 때 만들어 `<origin 상태 폴더>/remote/vapid.json`(0600)에 둔다. 형식은 `{"version": 1, "publicKey": <비압축 점 65바이트의 base64url>, "privateKey": <스칼라 base64url>, "createdAt": <ms>}`이다. 공개 키는 브라우저 `applicationServerKey`이고 개인 키는 JWT(ES256, `aud`는 푸시 서비스 주소의 출처, 만료는 24시간 이하)를 서명하는 데만 쓴다. 파일이 손상이거나 키 쌍이 어긋나면 새로 만들지 않고 오류로 알린다(새 키는 기존 구독을 모두 무효로 만든다). 키 교체 기능은 두지 않는다.
- 구독 저장: 브라우저가 `PushSubscription.toJSON()`을 보내면 검증해 기기에 묶어 `<origin 상태 폴더>/remote/push-subscriptions.json`(0600)에 둔다. 형식은 `{"version": 1, "subscriptions": [{endpoint, p256dh, auth, deviceId, createdAt}]}`이다. 검증: endpoint는 2048자 이하의 `https` 주소이고 계정 정보가 없어야 하며 IP 주소, `localhost`, `.local`, `.internal`, 점 없는 이름은 받지 않는다(게이트웨이가 나중에 부르는 주소라 내부 망으로 가는 요청을 막는다). `p256dh`는 비압축 점 65바이트, `auth`는 16바이트의 base64url이다. 같은 endpoint는 하나만 두고 마지막에 구독한 기기의 것이 된다. 기기마다 10개까지이고 넘으면 오래된 것부터 지운다. 기기를 폐기하면 그 기기의 구독도 지운다(§8.3 5). 푸시 서비스가 410을 돌려준 구독은 게이트웨이가 endpoint로 지운다.
- 발송(페이로드 암호화 `aes128gcm`, HTTP 호출, 재시도)과 서비스 워커는 W2·W3이다. 푸시 페이로드는 제목과 대화 식별자 정도로 줄이고 본문 전체와 시크릿 값을 싣지 않는다 [제안].

### 6.3 플러그인 프레임(`fresnel-view://`)

브라우저에는 사용자 정의 스킴이 없다. 같은 프레임 파일 규칙(확장 이름과 버전 마디 검사, `app root` 밖 차단, GET·HEAD만, 프레임 CSP)을 HTTPS 경로로 옮긴다 [제안].

- 주소: `https://<origin>/view/<권한토큰>/<확장>/<버전>/<경로>`. 권한 토큰은 탭 연결에 묶인 짧은 수명(1시간, 갱신)의 무작위 값이고, 쿠키 없이 경로로만 인증한다. 프레임의 하위 자원 요청이 쿠키 없이도 되게 하기 위해서다.
- 프레임은 `sandbox`(allow-same-origin 없음)로 연다. 불투명한 출처라 앱 문서의 쿠키·storage에 닿지 못한다.
- 프레임 CSP는 `fresnel-view://<확장>/<버전>/`을 `'self'` 경로 접두(`/view/<토큰>/<확장>/<버전>/`)로 바꾼 같은 글자다. `view-scheme.ts`의 `frameCsp`와 TS `appFrameCsp`가 같은 표에서 나오므로 `{base}` 치환 한 곳만 바뀐다. 시험은 두 글자열이 base 외에는 같음을 비교한다.
- 앱 본 화면의 `postMessage` 다리는 그대로다. `main.ts`의 발신 검사(최상위 프레임, 우리 출처)는 웹에서 게이트웨이의 Origin 검사(§8.5)와 `/shell`의 쿠키 인증이 대신한다. 프레임에는 `/shell` 통로가 없다.

## 7. 여러 기기 동시 접속

- 서비스는 이미 여러 연결을 받는다(`host.clients`, 연결 허브). 대화 잠금은 쓰기 소유자 하나이고 다른 연결은 관찰이다(`thread.open` `mode`, `L4.host-service.spec` §4.7). 게이트웨이는 이 규칙을 바꾸지 않고, 탭마다 서비스 연결을 하나씩 연다.
- 탭 연결 = (기기, 브라우저 탭). 시제품은 모든 탭이 한 엔진 연결과 SSE 스트림을 공유했는데, 이는 탭별 구독과 `thread.open` 기록을 섞는다. 게이트웨이는 탭마다 별도의 셸 레지스트리, 릴레이(`createRelay`), 채널 표를 만든다.
- 상태 동기화는 서비스의 이벤트 구독과 재전송(`HS-17`, 휘발 스트림 포함)이 이미 하는 일이다. 대화 목록, 새 메시지, 승인 요청, 입력 대기열은 `thread.*` 알림으로 모든 연결에 간다. 승인 응답은 `fresnel.approvals`로 첫 응답이 이기고, 나머지 기기는 승인 해결 알림으로 대기 표시가 사라진다 [확인: 2026-11-09 W2, `apps/host/src/handlers/events.ts`의 `startEventFanout`이 커밋마다 `hub.connections()` 전체의 구독(`conn.subs`)에 `approval.resolved`를 나른다. 관찰 연결은 폴링이 같은 경로로 전한다(HS-16). 그 대화를 구독하지 않은 연결에는 가지 않으므로 UI는 열린 대화마다 구독하고, 목록의 대기 표시는 `ThreadSummary.pendingApprovals`를 다시 읽어 갱신한다. 서비스는 바뀌지 않는다].
- 입력 대기열(실행 중 대화에 보내는 입력): 쓰기 소유자가 아닌 기기는 `delegate`(위임) 모드로 같은 대화에 입력을 보낸다(`HS-21` 흐름). 기기 둘이 동시에 보낸 입력의 순서는 서비스가 정한 도착 순서다.
- 연결이 끊기면 `$/connectionReset` 규칙으로 재연결한다. 브라우저는 지수 백오프로 `/wire`를 다시 열고 마지막으로 본 시퀀스부터 재구독한다(`resume`).
- 한 기기가 쓰기 소유자일 때 다른 기기에서 "이어서 쓰기"를 하면 기존 잠금 충돌 흐름(3002와 `options`)이 그대로 난다.

## 8. 보안

### 8.1 위협 모델

[제안] 외부 접근을 켠 origin은 "인증된 기기에게는 이 사용자 계정으로 도구를 실행할 권한이 있다"는 점이 핵심이다. `host.*`/`thread.*` 등 모든 wire 메서드가 열려 있고(per-method 인가가 없다), 승인에 응답하면 셸·파일 도구가 origin에서 돈다(`architecture.security.spec` T-10, B-08). 그러므로 방어 대상은 (1) 인증 없는 접속, (2) 가로채기(TLS 없는 구간), (3) 이미 인증된 브라우저를 다른 사이트가 부리는 것(CSRF, DNS rebinding, XSS), (4) 분실한 기기의 토큰이다.

### 8.2 TLS

- 외부 리스너는 항상 TLS 1.3(1.2 허용 안 함) [제안]. 루프백 리스너만 평문이다.
- 기본 [결정: 2026-11-08 사용자 "자체 서명 + 지문 고정이 기본, 사용자 인증서 경로는 옵션"]: **자체 서명 인증서 + 지문 고정**. 외부 접근을 처음 켤 때 ECDSA P-256 키로 인증서를 만들고(SAN: 설정한 호스트 이름과 주소에 `localhost`, `127.0.0.1`, `::1`을 더한 것, 유효 기간 2년, 시작 시각은 시계 어긋남을 견디도록 5분 앞) origin 상태 폴더 `<상태 폴더>/remote/tls/`의 `key.pem`, `cert.pem`에 0600(폴더 0700)으로 둔다. 지문(SHA-256)은 켜는 화면과 페어링 화면에 보인다. 다른 컴퓨터 데스크톱은 처음 접속 때 지문을 보이고 사용자가 확인하면 대상 항목에 고정한다(TOFU, SSH 호스트 키와 같은 UX). 지문이 바뀌면 경고하고 연결하지 않는다.
- 갱신: 켤 때마다 인증서가 없거나, 설정한 호스트가 SAN에 없거나, 만료까지 30일 미만이면 같은 키로 새 인증서를 만든다. 키는 그대로이고 인증서가 바뀌므로 **지문은 바뀐다**(고정한 데스크톱은 §11의 "지문 변경" 흐름을 탄다). 키 파일이 읽히지 않거나 손상이면 조용히 새로 만들지 않고 오류로 알린다(지문이 말없이 바뀌는 것을 막는다).
- 지문 표현: 내부는 소문자 16진 64자, 화면은 콜론으로 나눈 대문자(`AB:CD:…`, 브라우저 인증서 화면과 같다), 주소의 `/pin/<sha256>`은 소문자 16진이다. 클라이언트는 신뢰 저장소(`ca`)에 인증서를 넣는 방식이 아니라 연결한 서버 인증서의 지문을 직접 비교해 고정한다 [근거: 2026-11-08 실측, Bun의 `fetch`는 `ca`에 넣은 자체 서명 단말 인증서를 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`로 거절하고 Node는 받는다].
- 사용자 인증서: `l4.remote.web.tlsCert`, `tlsKey` 경로를 주면 그것을 쓴다(Tailscale `tailscale cert`, Let's Encrypt, 사내 CA). 이 경우 브라우저 경고가 없다. 지문 고정은 데스크톱 쪽에서 선택 사항이다. 파일은 제자리에서 읽기만 하고 복사하지 않으며, 키가 인증서와 짝이 아니거나 만료했거나 파일이 없으면 오류로 알리고 자체 서명으로 물러서지 않는다. 설정한 호스트를 덮지 못하면 그 목록을 알린다(브라우저 경고의 원인). 갱신은 사용자 몫이고 만료 30일 전부터 경고한다.
- 로컬 CA(mkcert 방식)는 만들지 않는다 [제안]. 기기마다 루트 인증서를 설치해야 해서 태블릿 UX가 나쁘고, 잘못 관리한 루트가 위험하다. 필요하면 사용자 인증서 경로로 같은 결과를 얻는다.
- 자체 서명 인증서의 브라우저 경고는 사용자가 한 번 넘기면 된다. 이 경고를 "태블릿 웹 접근"의 기본 UX로 받아들이는 것은 사용자 결정으로 확정했다(위 [결정: 2026-11-08]). 경고 없이 쓰려면 사용자 인증서 경로를 쓴다.
- 구현: `apps/desktop-shell/src/web/tls/`(`self-signed.ts`, `fingerprint.ts`, `store.ts`). Node 내장 crypto는 인증서를 만들어 주지 않으므로 DER을 직접 쓴다(`der.ts`). 새 의존을 더하지 않는다.

### 8.3 기기 페어링과 토큰

1. origin 사용자가 데스크톱(설정 > 연결 > 이 컴퓨터에 접속 허용)이나 `fresnel service pair`로 페어링 코드를 만든다. 코드는 10자(Crockford base32, 약 50비트), 5분 유효, 한 번 쓰면 폐기, 동시에 하나만 유효하다. 새 코드를 만들면 쓰지 않은 이전 코드는 그 순간 폐기된다. 입력은 대소문자와 공백·하이픈을 가리지 않고 헷갈리는 글자(I, L → 1, O → 0)를 Crockford 규칙으로 바꿔 받는다. [확인: 2026-11-10 rmWi] wire `host.remote.pair`의 `code`는 하이픈 없는 10자다(계약 `minLength` = `maxLength` = 10). 연결 화면은 읽기 쉽게 다섯 글자씩 하이픈으로 나눠 보이고, 복사는 하이픈 없는 값이다.
2. 새 기기가 `/login`에서 코드와 기기 이름을 `POST /pair`로 보낸다. 기기 종류(`web` 또는 `desktop`)도 함께 보낸다. 실패 5번이면 코드를 폐기하고 15분 잠근다. 세는 방식은 위 문장을 글자대로 옮긴 것이다 [결정: 구현 W1].
   - 주소별 5번이면 그 주소를 15분 잠그고, 전체(모든 주소 합) 5번이면 모두를 15분 잠근다. 어느 쪽이든 그 순간 유효한 코드를 폐기한다. 잠금 중에는 맞는 코드도 `locked`로 거절한다.
   - 센 값은 잠금 시간(15분)이 지나면 잊고, 성공하면 지운다. 상태는 메모리에만 있다(게이트웨이를 다시 띄우면 코드도 잠금도 사라진다).
   - 틀림, 만료, 이미 씀, 발급된 코드 없음은 한 가지 오류(`invalid_code`)로 합쳐 코드의 존재 여부를 흘리지 않는다. 기기 이름이 틀린 요청(공백뿐, 64글자 초과, 제어 문자)은 코드를 쓰지도 실패로 세지도 않는다.
3. 성공하면 256비트 무작위 기기 토큰(32바이트의 base64url, 43자)을 만든다. origin에는 SHA-256 해시, 기기 이름, 종류, 만든 시각, 마지막 접속 시각과 주소만 저장한다(원문은 저장하지 않는다). 저장 위치는 게이트웨이가 가진 파일 `<origin 상태 폴더>/remote/devices.json`(0600, 폴더 0700, 임시 파일에 쓰고 rename)이다 [제안]. 서비스 저장소 스키마를 바꾸지 않고 기기 목록·폐기가 서비스 재시작과 무관하게 남는다. 형식은 `{"version": 1, "devices": [{id, name, kind, tokenHash, createdAt, lastSeenAt, lastAddress}]}`이고 `id`는 `dev_` 뒤 16자리 16진이다. 마지막 접속 시각은 1분에 한 번만 파일에 쓴다(주소가 바뀌면 바로 쓴다). 파일이 손상이면 열지 않고 오류로 알린다(조용히 비우면 모든 기기가 풀려 버리므로 사용자가 보게 한다).
4. 브라우저에는 쿠키 `__Host-fresnel-device`(HttpOnly, Secure, SameSite=Strict, Path=/)로 준다. 루프백 HTTP는 Secure를 못 쓰므로 `fresnel-device`(HttpOnly, SameSite=Strict)로 낮춘다. HTTPS 리스너는 `__Host-` 이름의 쿠키만 받는다(쿠키는 포트와 스킴을 가리지 않아 다른 HTTP 출처가 같은 이름을 심을 수 있다). 같은 이름의 쿠키가 둘이면 거절한다. 데스크톱 클라이언트는 쿠키 대신 `Authorization: Bearer <토큰>`을 쓰고, `Bearer`가 있으면 쿠키는 보지 않는다. 데스크톱 클라이언트는 토큰을 OS 보안 저장소(`platform-secrets`)에 둔다. 토큰은 설정 파일과 인자에 두지 않는다.
5. 폐기: 데스크톱의 기기 목록(이름, 마지막 접속, 주소)에서 항목별로 폐기하고 "모두 폐기"가 있다. 폐기하면 열려 있는 그 기기의 모든 연결을 즉시 닫는다(WebSocket 닫기 코드 4401, 이유 `auth`. 1004는 RFC 6455가 예약한 코드라 브라우저와 런타임이 거절할 수 있어 쓰지 않는다) [확인: 2026-11-09 W2, Bun 실측]. 인증 부품(`AuthPort`)은 폐기가 끝난 뒤 구독자에게 알리고, 게이트웨이가 연결을 닫고 그 기기의 푸시 구독을 지운다(§6.2).
6. 로그인 만료: 웹 기기의 로그인은 슬라이딩 12시간, 절대 30일이다 [제안]. 슬라이딩은 마지막 접속으로부터 12시간이고, 절대 30일은 페어링 시각부터다. 둘 중 이른 쪽에 끝난다. 만료하면 재페어링 없이 토큰으로 갱신하지 않고 `/login` 화면으로 돌아간다. 만료한 웹 기기는 기기 목록에 "만료"로 남다가 다음 페어링 때 지워진다. 데스크톱 클라이언트의 토큰은 절대 만료 없이 폐기 전까지 유효하다 [제안, 근거: SSH 키와 같은 수준].
7. 구현: `apps/desktop-shell/src/web/auth/`(`pairing.ts`, `devices.ts`, `cookies.ts`, `origin.ts`, `headers.ts`, `auth-port.ts`). 인증 실패, 잠금, 페어링, 폐기는 주입된 로거로 남기고 토큰과 코드 값은 싣지 않는다(§8.4).

### 8.4 인증 경계

- `/wire`와 `/shell`은 업그레이드 요청에서 인증을 끝낸다. 실패하면 `host.hello` 전에 연결을 닫는다(`product.scope.spec` §4.4 M3 조건).
- 서비스 쪽은 변하지 않는다. 게이트웨이가 서비스 소켓에 붙을 때 `client.name`에 기기 이름을 싣고, `host.clients`가 그 이름을 보인다. 인증은 게이트웨이가 끝낸다.
- 인증 실패와 폐기는 로그에 기록한다(토큰 값은 쓰지 않는다). 감사 기록이 아니라 운영 진단이다.

### 8.5 Origin·CSRF·DNS rebinding

- 모든 상태 변경 요청(`POST /pair`, 업그레이드)에서 `Origin` 헤더가 게이트웨이 자신의 출처와 같지 않으면 거절한다. `Origin`이 없는 요청은 업그레이드와 POST에서 거절한다(주소창 직접 요청의 GET만 허용). 자신의 출처는 `Host` 검사를 통과한 요청 `Host`와 리스너의 스킴으로 정하고, 스킴·호스트 이름·포트(기본 포트는 생략과 같다)를 비교한다. 데스크톱 클라이언트의 WebSocket도 같은 규칙을 받으므로 게이트웨이의 출처와 같은 `Origin` 헤더를 보낸다(W5).
- `Host` 헤더를 설정한 호스트 이름 목록(`l4.remote.web.hosts`)과 비교한다. 목록 밖이면 421이다. DNS rebinding 방어다. 루프백 리스너는 `localhost`, `127.0.0.1`, `[::1]`만 허용한다.
- CORS 헤더를 내지 않는다. 쿠키는 SameSite=Strict다. WebSocket은 쿠키로 인증하므로 Origin 검사가 CSRF 방어의 유일한 통로다(WS는 SameSite 우회가 가능하다는 점을 시험으로 고정한다).
- 응답 헤더: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, HTTPS에서 `Strict-Transport-Security: max-age=31536000`(자체 서명 인증서에서도 같다) [제안].

### 8.6 권한 범위

- 인증된 기기는 모든 wire 메서드와 셸 명령을 쓴다. 웹 기기에 데스크톱과 다른 권한 제한을 두지 않는다. 시크릿 값 열람, 백업 복원·삭제, 서비스 종료, 외부 접근 끄기, 페어링 코드 만들기 모두 웹 기기에서 데스크톱과 똑같이 허용한다 [결정: 2026-11-08 사용자 "웹 기기 권한: 전부 데스크톱과 똑같이 허용". 위험한 것은 origin에서만 허용하자는 rmW 제안은 채택하지 않았다].
- 이 결정의 결과는 위협 모델(§8.1)이 그대로 받는다: 기기 토큰을 가진 쪽은 이 계정으로 도구를 실행할 수 있으므로 방어는 인증(§8.3), TLS(§8.2), 폐기(§8.3 5)에 있다. 기기를 잃어버리면 곧바로 폐기한다. 폐기 화면과 연결 화면이 이 사실을 문장으로 알린다.
- 웹에서는 OS 재인증(`os_reauth`)을 쓸 수 없으므로 데스크톱이 재인증을 거치는 동작(시크릿 값 열람, 서비스 끄기)도 웹 기기에서는 재인증 단계 없이 기기 인증이 대신한다 [결정: 2026-11-09 W4: 웹 기기에서는 재인증 단계 없이 기기 인증이 대신한다. 연결 화면의 경고 문장은 "연결을 인증받은 기기는 이 컴퓨터의 계정으로 도구를 실행할 수 있어요."와 "기기를 잃어버렸다면 바로 폐기하세요" 계열이고 항상 보인다].
- 읽기 전용 기기 역할(관찰만)은 서비스에 메서드별 인가가 생긴 뒤의 일이다. 이번 범위에 넣지 않는다 [결정: 2026-11-08 "웹 기기는 전부 똑같이"가 이 역할을 두지 않는다].
- 승인 UI는 연결된 모든 기기에서 같다. 승인하면 origin에서 도구가 실행되므로 연결 화면과 페어링 화면이 이 사실을 문장으로 알린다.

### 8.7 앱 CSP

- 데스크톱(Electron) 문서의 CSP는 지금 그대로다: `default-src 'self'; connect-src 'self'; frame-src fresnel-view:`(`main.ts`).
- 웹 문서의 CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss://<호스트>; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'` [제안]. 인라인 스크립트는 없다(shim은 `/shell/shim.js` 파일이다). `style-src 'unsafe-inline'`은 UI 번들의 `style` 속성 때문에 필요하다 [확인: 2026-11-09 W2, §13].
- 프레임 문서 CSP는 §6.3이 정한다.
- 게이트웨이는 UI 번들 HTML을 고쳐서 shim 스크립트 태그를 넣을 때 `nonce` 없이 `script-src 'self'`로 충족되게 파일 참조로만 넣는다.

## 9. 비루프백 리스너 정책과 기존 스펙 충돌의 정리

충돌: 아래가 서로 맞지 않았다.

| 위치 | 내용 |
|---|---|
| `L2.schedule.spec` §원격(`loopback`이 아닌 리스너는 1차에 열지 않는다, U-11), `L4.host-service.spec` §4.11·HS-87, `L0.process.spec` §4.4 루프백 원칙, `architecture.security.spec` T-10, `product.scope.spec` X5 | 서비스는 비루프백 리스너를 만들지 않는다. TLS+토큰 WebSocket은 2차 |
| `L4.host-service.spec` SV-05, `L0.process.spec` §4.4.5, `L4.cli.spec`, 코드 `--allow-non-loopback`(`socket.ts` `allowNonLoopback`, `tcp_not_loopback`) | 토큰이 있으면 `--allow-non-loopback`으로 비루프백 TCP를 연다. TLS 없음 |

정리 [결정: 2026-11-08 사용자가 TLS 외부 접근을 요구해 U-11의 "2차"를 앞당긴다. 방식은 제안]:

1. **서비스 호스트는 비루프백 리스너를 열지 않는다.** U-11, X5, T-10의 이 문장은 그대로 유효하다. 서비스의 TCP 리스너는 루프백 전용이다(`tcp_not_loopback`은 남는다. SSH 터널의 끝과 시험용).
2. 외부 접근은 **게이트웨이만** 연다. TLS와 기기 인증이 없으면 열리지 않는다(무인증·평문 비루프백 리스너 금지는 그대로).
3. `--allow-non-loopback`과 `allowNonLoopback` 옵션, 평문 `tcp://` 비루프백 원격은 쓰지 않는다(비권장). 같은 일을 TLS 통로가 한다. 대상 목록은 평문 비루프백 `tcp://`를 이미 거절한다(W5). 옵션 제거는 코드 삭제이므로 사용자 승인 뒤 구현 트랙 W9가 한다 [결정: 오케스트레이터 기본값, 사용자 승인 전까지 "비권장"으로 남긴다]. 그때까지 옵션은 남고 이 문서가 대체 경로를 가리킨다.
4. `tcp://` 주소 종류는 루프백 전용으로 줄이고, 다른 컴퓨터 접속은 `wss://`(게이트웨이)나 `ssh://`로 한다. `L0.process.spec` P-13은 이 결정으로 해소된다.
5. 기존 문서의 델타는 각 문서의 해당 문장에 이 문서(`L4.remote.spec` §9)를 가리키는 `[결정: 2026-11-08 …]` 표지를 단 것이다. 문서별 델타는 `L4.remote.plan` 트랙 W0이 적용한 범위와 같다.

## 10. 설정

[제안] 새 이름은 F 설정 정본이 확정하기 전까지 제안이다. 시크릿 값은 설정 파일에 두지 않는다.

| 키 | 기본 | 뜻 |
|---|---|---|
| `l0.process.service.enabled` | 거짓 | 있음. 서비스 모드 |
| `l4.remote.web.enabled` | 거짓 | 게이트웨이를 띄운다 |
| `l4.remote.web.listen` | `127.0.0.1:8480` | 루프백 리스너 |
| `l4.remote.web.listenTls` | `0.0.0.0:8443` | 외부 TLS 리스너 `host:port`. 비어 있는 값(빈 문자열)으로 바꾸면 외부 리스너를 열지 않는다. 포트는 이 키로 바꾼다 |
| `l4.remote.web.hosts` | `[]` | 허용 `Host` 이름. `listenTls`의 호스트가 자동으로 들어간다 |
| `l4.remote.web.tlsCert`, `tlsKey` | 없음 | 사용자 인증서와 키 파일 경로. 없으면 자체 서명 |
| `l4.remote.web.sessionHours` | 12 | 슬라이딩 로그인 유지 기간(시간) |
| `l4.remote.launchAtLogin` | 거짓 | D 방식 등록(§4.2) |

[확인: 2026-11-09 W3] 구현한 키는 `l4.remote.web.enabled`, `listen`, `listenTls`, `hosts`, `tlsCert`, `tlsKey`(모두 managed·user 범위만, 값을 바꾸면 서비스를 다시 띄워야 한다)다. 빈 문자열은 "없음"(`listenTls`, `tlsCert`, `tlsKey`)이다. `sessionHours`와 `launchAtLogin`은 W6 이후다. `listen`의 기본은 이 표의 `127.0.0.1:8480`이고 오케스트레이터 브리프의 `0.0.0.0:7443`은 따르지 않았다(스펙을 따른다: 외부 주소는 `listenTls`가 맡고 루프백 `listen`은 비루프백을 받지 않는다).

[확인: 2026-11-10 rmWi] 데스크톱 "서비스 + 외부 접근"은 `host.remote.setEnabled(true)`만 보낸다. `listenTls`가 비어 있으면 TLS 리스너는 열리지 않고(`tlsPort`와 `fingerprint`가 `null`) 연결 화면에는 루프백 주소만 보인다. 실제 흐름(임시 홈, `listenTls=127.0.0.1:18443`, `listen=127.0.0.1:18480`을 CLI `config set`으로 먼저 설정하고 서비스를 다시 띄움)에서 켜기, 지문, 코드 발급, 코드 로그인, 기기 목록, 폐기, 탭 끊김이 모두 됐다. [확인: 2026-11-10 rmX1] 위 [미결]은 닫혔다: `listenTls`의 설정 기본값을 `0.0.0.0:8443`으로 두어, 설정이 없어도 "서비스 + 외부 접근"(`host.remote.setEnabled(true)`)이 TLS 리스너를 연다(사용자 승인, 오케스트레이터 권고 "기본 포트로 채운다"). 포트는 설정 `l4.remote.web.listenTls`(예: `0.0.0.0:9443`)로 바꾸고 서비스를 다시 띄운다. 빈 문자열로 두면 루프백만 연다. 포트가 이미 쓰이면 게이트웨이가 종료코드 2로 끝나고 상태의 `error.message`에 "the tls port is already in use by another program (EADDRINUSE); change l4.remote.web.listenTls to a free port"가 나온다. [근거: `apps/host/src/settings.ts`, `apps/desktop-shell/src/web/main/errors.ts`]

## 11. 실패와 경계 사례

| 상황 | 동작 |
|---|---|
| 서비스가 내려가 있다 | 게이트웨이가 시작을 거절한다. 켜는 UI가 "서비스를 먼저 켜요"를 보인다 |
| 게이트웨이가 죽는다 | 서비스가 재시작 상한 안에서 되살린다. 상한을 넘으면 `remote.gatewayDown` 상태가 연결 화면에 보인다(wire `host.remote.status`의 `state: "failed"`, `error.kind: "gateway-down"`) |
| 코드 입력 5번 실패 | 코드 폐기, 15분 잠금 |
| 기기 폐기 | 열린 연결 즉시 닫힘, 쿠키로 재접속하면 `/login` |
| 인증서 만료 임박(30일) | 연결 화면과 데스크톱 알림에 경고. 자체 서명은 다음 켤 때 갱신 |
| 지문 변경(데스크톱 클라이언트) | 연결 거부, "서버 지문이 바뀌었어요" 문장과 새 지문 확인 흐름 |
| origin이 잠자기·꺼짐 | 연결이 끊김, 클라이언트가 백오프로 재시도하고 "서버에 닿지 않아요"를 보인다 |
| 같은 대화를 두 기기가 동시에 입력 | 서비스가 정한 순서. 쓰기 소유자가 아니면 위임 입력 |
| 브라우저가 Notification 미지원·거부, 또는 서비스 워커를 쓸 수 없는 출처(신뢰되지 않는 자체 서명) | 푸시 없이 탭이 열려 있는 동안의 알림과 탭 제목 접두만 |

## 12. 수용 기준

1. 서비스 호스트는 어떤 설정에서도 비루프백 주소를 열지 않는다(시험: 비루프백 `host`로 서비스를 시작하면 `tcp_not_loopback`).
2. 게이트웨이의 외부 리스너는 TLS가 없으면 열리지 않고, 인증 쿠키·Origin·Host 중 하나라도 틀리면 `/wire`·`/shell` 업그레이드가 거절된다(각각 시험).
3. 같은 UI 번들(`apps/desktop/dist/ui`, 바이트 동일)이 데스크톱과 브라우저 양쪽에서 대화 만들기, 입력, 승인, 예약, 설정 화면을 같은 동작으로 한다(브라우저 E2E).
4. 브라우저 탭 둘이 같은 대화에서 한쪽의 입력과 승인이 다른 쪽에 반영된다.
5. 기기 폐기가 열린 연결을 닫는다. 페어링 코드는 한 번만 쓸 수 있고, 5분이 지나거나 실패 5번이면 쓸 수 없다(시험: `pairing.test.ts`, `auth-port.test.ts`).
6. 데스크톱 앱에서 서비스 모드와 외부 접근을 켜고 끌 수 있고, CLI `service start|stop|status`와 같은 결과가 같은 상태 표시로 보인다.
7. 웹 기기와 데스크톱 기기의 권한이 같다: 어느 wire 메서드나 셸 명령도 기기 종류로 거절하지 않는다(§8.6).

## 13. 미결 사항

- [결정: 2026-11-08 사용자] 자체 서명 인증서 + 지문 고정이 기본이고 사용자 인증서 경로는 옵션이다(§8.2).
- [결정: 2026-11-08 사용자] 앱을 닫아도 서비스는 계속 돈다(B). 로그인 자동 시작(D)은 사용자가 켜는 스위치다(§4.2).
- [결정: 2026-11-08 사용자] 웹 기기 권한은 데스크톱과 똑같이 전부 허용한다. 읽기 전용 기기 역할은 두지 않는다(§8.6).
- [결정: 2026-11-08 사용자] 탭이 닫힌 뒤의 푸시 알림(Web Push)을 이번 범위에 넣는다(§6.2).
- [미결: 사용자 결정] `--allow-non-loopback` 제거(삭제 승인). [근거: 질문 5]
- [확인: 2026-11-09 W2] 승인 해결 알림은 서비스의 이벤트 구독 경로로 그 대화를 구독한 모든 연결에 간다(§7). 웹 CSP의 `style-src 'unsafe-inline'`은 뺄 수 없다: UI 번들이 `style={{…}}` 속성을 80곳, `.style.` 대입을 10곳 쓴다(`apps/desktop/src`). `eval`, `new Function`, 워커는 없어 `script-src 'self'`는 그대로 충족된다(§8.7).
- [가정] 루프백 HTTP의 쿠키·보안 컨텍스트 동작과 브라우저별 서비스 워커 등록은 브라우저 E2E(W8)가 실측한다.
- [제안] 새 이름(`devices.json`, `l4.remote.*`, `shell_capabilities`, `wss` 종류, `fresnel.remote-device` 항목)은 해당 정본 문서가 확정할 때까지 제안이다.
