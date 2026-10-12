# 20. 데스크톱 앱 아키텍처

- 작성: P13(데스크톱 앱), 2026-10-11. 1단계 초안
- 상태: 1단계 초안. 03·04(P2), 06(P3), 17(P11), 19(P12), 21(P14)의 1단계 초안(2026-10-11 시점)을 읽고 맞췄다. 05(P2), 18(P11), 09·11(P5·P6), 12(P7)는 이 문서를 쓰는 동안 아직 없어서 브리프 §3 공통 계약을 따랐다. 그 문서들에 기대하는 것은 §5.2에 모았고 2단계에서 이름을 맞춘다.
- 소유: Tauri 구조(Rust 쪽과 웹뷰 쪽 책임, IPC, 권한), 연결 관리(프로필, SSH, 상태 기계), React 앱 구조(폴더, 라우팅, 상태 관리), 클라이언트 저장소와 동기화, 오프라인 표시, OS 통합(알림, 메뉴 막대·트레이, 배지, 단축키, 로그인 시 시작, 딥 링크, 키체인), UI 번들 방식, 빌드·배포, 앱 테스트.
- 소유하지 않음: 화면 ID·경로 후보·딥 링크 형식(03), 화면 상세·문구(04·05), 컴포넌트·토큰·시각화(21), 프로토콜 메서드·이벤트·오류 코드(19), 위협 모델·토큰 발급·페어링 규칙(18), 데몬 수명주기·tailscale serve 설정(17), 투영 생성(12), 이벤트 카탈로그(09).

## 1. 목적과 범위

### 1.1 목적

구현자가 이 문서만 보고 `apps/desktop`(패키지 `@helm/desktop`)을 만들 수 있게 한다. 앱은 WSL2 서버에 상주하는 Helm 데몬에 붙는 얇은 클라이언트다(결정 22·32). 앱이 하는 일은 네 가지다.

1. 데몬에 연결한다. 경로는 Tailscale serve를 거친 WSS와 SSH 두 가지다(결정 26·38).
2. 데몬이 만든 투영을 받아 화면에 그리고, 연결이 끊겨도 마지막으로 받은 투영을 읽기 전용으로 보인다.
3. 사람의 조작을 명령으로 바꿔 데몬에 보낸다. 상태는 데몬의 커널이 바꾸고, 앱은 결과를 스트림으로 받는다(결정 14).
4. OS와 붙는 일을 한다: 알림, 메뉴 막대·트레이, Dock 배지, 전역 단축키, 로그인 시 시작, 딥 링크, 기기 토큰 키체인 보관.

### 1.2 다루는 것

| 주제 | 절 |
|---|---|
| 프로세스 구조, Rust 쪽 책임과 웹뷰 쪽 책임 | §3.1~§3.3 |
| IPC 명령·이벤트, 권한(capabilities), CSP, 플러그인과 버전 | §3.4~§3.7 |
| 연결 프로필, SSH 구현 방식, 키·known_hosts, 전송 계약, 대용량 파일, 페어링, 연결 상태 기계, 경로 선택 | §3.8 |
| React 앱 폴더 구조, 라우팅, 상태 관리, 프로토콜 클라이언트 연결, 클라이언트 저장소, 동기화 알고리즘, 명령 전송, 오프라인·신선도, 오류 경계, presence | §3.9 |
| OS 통합 | §3.10 |
| UI 번들 결정 | §3.11 |
| 빌드·배포·업데이트·버전 | §3.12 |
| 테스트 | §3.13 |

### 1.3 다루지 않는 것

- 웹 클라이언트, 모바일 앱. 결정 19는 웹 클라이언트를 두지 않는다. 휴대폰은 03 IA-Q5에 따라 범위 밖이다. 데몬이 같은 SPA를 브라우저에 서빙하는 방식도 두지 않는다(§3.11).
- TUI. 결정 33·39에 따라 `@helm/tui`가 따로 만든다. 다만 이 문서의 동기화 알고리즘(§3.9.6)은 전송과 화면에서 떨어진 순수 모듈로 두어 TUI가 재사용할 수 있게 한다.
- 로컬 데몬. 앱은 데몬을 띄우거나 소유하지 않는다. Paseo(데스크톱이 데몬을 하위 프로세스로 띄움, S4 paseo.md §1)나 OpenClaw의 Local 모드(launchd로 Gateway 상주, S4 openclaw-gateway.md §3.2)와 다르다. 데몬은 WSL에만 있다(결정 20).
- Helm 도메인 로직. 투영 계산, 상태 전이, 질문 전달 시점 판단, 알림 여부 판단은 앱에 두지 않는다(결정 32).
- Apple 공증·코드 서명 인증서, Microsoft 코드 서명. 결정 24로 범위 밖이다. 서명 없는 개인 배포 절차만 다룬다(§3.12.5).

### 1.4 용어

| 용어 | 뜻 |
|---|---|
| 서버 | 앱이 붙는 Helm 데몬 하나. 데몬이 hello 응답으로 알려 주는 `serverId`로 구별한다 |
| 경로(route) | 한 서버로 연결하는 방법 하나. `wss` 또는 `ssh` |
| 연결 프로필 | 서버 하나와 그 서버의 경로 목록, 기기 ID. 앱 설정에 저장한다(토큰은 키체인) |
| 전송(transport) | 경로 하나로 연 바이트 연결 위의 WebSocket 하나. Rust가 소유한다 |
| 세션 | 전송 위에서 hello가 끝난 프로토콜 대화. 19의 클라이언트 코어(TS)가 소유한다. 전송이 끊기면 세션도 끝난다 |
| 뷰 | 데몬이 정본을 읽어 만든 화면 투영(19 §1.4). `view.get`으로 받는다 |
| 뷰 키 | 뷰 응답의 `key`(예: `inbox`, `concern:cn_…`). 데몬이 정규화한 값이고 무효화 판정에 쓴다 |
| 위치(position) | 이벤트 구독이 빠짐없이 받았다고 보장하는 `{storeId, seq}`(19 §1.4). 브리프 결정 31의 `lastSeq`가 이것이다 |
| `storeId` | 데몬 이벤트 저장소의 정체. 저장소를 복원하거나 새로 만들면 바뀐다. 클라이언트는 이 값으로 seq가 되돌아갔을 수 있는 경우를 알아챈다 |
| `asOfSeq` | 뷰 응답이 어느 seq까지 반영한 것인지 |
| `basisSeq` | 사람이 결정할 때 화면이 보고 있던 뷰의 `asOfSeq`(21 UI-D02, 19 §3.7.2와 같은 이름) |
| 멱등 키 | 명령 하나를 가리키는 클라이언트 생성 ID. 재전송해도 데몬이 한 번만 처리한다 |
| 진행 중 명령함(in-flight outbox) | 보냈지만 응답을 받지 못한 명령의 목록. IndexedDB에 둔다 |

표시 규칙은 브리프 §5.2를 따른다. `[결정 n]`은 브리프 §2의 결정 번호를 근거로 한 것, `[제안]`은 이 문서가 정한 것, `[가정]`은 확인되지 않은 전제다. 외부 사실에는 `[원문]`, `[실험]`, `[검색]`, `[지식]`을 붙인다. 원천 인용은 03·21과 같은 약칭을 쓴다: "canon §12.10"(`docs/design/process/sources/helm-canon.md`), "canon-2 §3.16", "canon-3 §6.10", "발췌4 20-11"(`conversation-extracts-4.md`), "facts-2 §6.1"(`pi-api-facts-2.md`), "S4 paseo §3"(`.helm-design-work/S4/paseo.md`).

## 2. 전제와 결정

### 2.1 브리프 결정에서 오는 전제

| 브리프 결정 | 이 문서에서의 뜻 |
|---|---|
| 10 | 앱의 첫 화면은 상태다. 대화는 객체에 딸린 보조 수단이다(03 §3.1, 21 UP-1). 앱 구조도 투영(뷰) 여러 개를 캐시하고 갱신하는 형태로 짠다(§3.9). 대화 하나를 스트리밍하는 앱의 구조와 다르다 |
| 12 | 질문을 언제 사람에게 알릴지는 데몬이 전달 방식(즉시·협상·중재·예약)으로 정한다. 앱은 데몬이 "전달한다"고 보낸 것만 OS 알림으로 띄운다(§3.10.1) |
| 14 | 모델은 제안하고 커널이 상태를 바꾼다. 사람의 결정도 커널 명령으로 간다. 앱은 낙관적 도메인 갱신을 하지 않는다(§3.9.7, 21 UI-D03) |
| 19 | 클라이언트는 데스크톱 앱이 먼저다. 웹 클라이언트는 만들지 않는다 |
| 20, 22 | 데몬은 제품 소유자의 WSL2 서버에 상주하고 앱이 없어도 작업이 계속된다. 앱은 데몬을 띄우지 않는다 |
| 21, 26 | 외부에서 접속한다. 기본 경로는 Windows 호스트의 `tailscale serve`가 노출한 HTTPS/WSS다. 데몬은 WSL 안 `127.0.0.1`에만 바인딩한다. 인증은 Tailscale 신원 헤더와 기기별 bearer 토큰이다 |
| 24 | macOS와 Windows를 지원한다. Apple 공증·서명 배포는 범위 밖이다 |
| 31 | JSON-RPC 2.0 over WebSocket. 이벤트에는 단조 증가 seq가 붙고 재접속 때 `lastSeq`부터 다시 받는다. 큰 데이터는 HTTP로 받는다 |
| 32 | Tauri v2 + React 18 + TypeScript + Vite. 앱에는 Helm 로직이 없다. React 18 CSR 기준으로 설계하고 React 19 전용 API를 쓰지 않는다 |
| 36 | TypeScript strict, ESM, pnpm workspace, Vitest, TypeBox. Node는 06이 24 LTS로 바꿨다(06 §3.12, ADR-06-07). 앱의 개발 도구(Vitest 5, jsdom 30, MSW 3)도 Node 24에서 돈다 |
| 37 | UI 문구는 한국어다. 앱이 직접 만드는 문구(연결 오류, OS 알림 제목, 트레이 메뉴)도 한국어로 쓰고 05의 지침을 따른다 |
| 38 | 데스크톱 앱도 SSH로 데몬에 붙을 수 있어야 한다. 두 경로에서 프로토콜 메시지와 재전송 의미가 같아야 한다. 구체 방식과 인증은 P11·P12·P13이 정하고 ADR로 남긴다 → 이 문서의 선택은 §3.8.2, ADR 후보 ADR-20-02·03 |

### 2.2 운영 환경 사실 (브리프 §2.5, 홈랩 문서)

| 사실 | 앱 설계에 주는 영향 |
|---|---|
| 서버는 Windows 11 호스트(`server`) 안의 WSL2 Ubuntu 24.04다. `networkingMode=mirrored`라 WSL과 호스트가 주소와 localhost를 함께 쓴다 [원문: `~/projects/homelab/context/machines.md` 7·8·32행] | 데몬의 `127.0.0.1` 포트는 Windows 호스트의 `tailscale serve`와 WSL `sshd` 양쪽에서 열 수 있다. 앱의 두 경로가 같은 데몬 소켓으로 들어간다 |
| Tailscale은 Windows 호스트에만 있다. tailnet 이름은 `tail7ad0b4.ts.net`, `tailscale serve`가 쓰는 포트는 8443~8447이다 [원문: `network.md` 7·21~25·39~46행] | WSS 경로의 URL은 `https://server.tail7ad0b4.ts.net:<Helm 포트>`이다. Helm 포트 번호와 `serve.table` 줄은 17이 정한다 |
| WSL OpenSSH는 22번 포트, tailnet에서만, 키 인증만 받는다. Mac의 `~/.ssh/config`에는 이 서버의 별칭 `server`가 dotfiles로 이미 있다 [원문: `machines.md` 13·17행] | SSH 경로는 사용자의 OpenSSH 설정(별칭, 키, 에이전트, known_hosts)을 그대로 쓰는 쪽이 가장 단순하다(§3.8.2). 대상은 별칭 `server` 한 단어로 적을 수 있다 |
| `server`는 "WSL을 띄우는 호스트 + 직접 쓰는 PC"다 [원문: `machines.md` 7행] | Windows 앱은 서버 PC 자신에서 돌 수 있다. 이때도 같은 WSS 경로(자기 tailnet 이름)를 쓴다(§3.8.10) |
| Windows 호스트의 PATH에는 Node 등 개발 도구가 없고, 호스트 변경은 사람이 `.ps1`로 한다 [브리프 §2.5] | Windows 설치 파일은 Windows 호스트에서 빌드하지 않는다(§3.12.4). 앱 설치는 사람이 설치 파일을 실행한다 |
| macOS 빌드는 Mac에서만 된다. 서버는 `run-on mac <cmd>`로 지시한다. `run-on`은 `bash -lc`와 mise shim을 PATH에 넣고, 대상 기기에 연결하지 못하면 종료 코드 2를 낸다 [원문: `~/.local/bin/run-on`] | macOS 빌드 레시피는 서버의 `just app-build-mac`이 `run-on mac`으로 Mac의 `app-build-local`을 부른다(§3.12.2) |
| `~/projects`는 Syncthing으로 Mac과 양방향 동기화된다. `.stignore-dev`는 `node_modules`, `dist`, `build`, `.git` 등을 빼지만 Cargo의 `target`은 빼지 않는다 [원문: `~/projects/.stignore-dev`] | Rust 빌드 산출물을 저장소 안 `src-tauri/target`에 두면 수 GB가 동기화된다. 레시피에서 `CARGO_TARGET_DIR`를 동기화 폴더 밖으로 돌린다(§3.12.1) |
| 빌드·검증은 `justfile` 레시피로만 한다. `just verify` 통과가 완료다 | 앱 레시피 목록을 §3.12.2에 둔다. 06·23이 저장소 전체 레시피를 합친다 |

### 2.3 이 문서의 주요 선택

각 항목의 근거는 "절"에 있다. ADR 후보는 문서 끝 "ADR 후보"에 형식대로 적었다.

| ID | 선택 | 표시 | 절 |
|---|---|---|---|
| APP-D01 | 앱은 투영을 계산하지 않는다. 화면 데이터는 데몬의 뷰(`view.get`)를 받아 캐시하고, 이벤트는 무효화 태그(19 P-07)로 "어느 뷰가 낡았는가"를 알리는 데만 쓴다 | [제안], 결정 32에서 도출 | §3.9.6 |
| APP-D02 | 전송은 Rust가 소유한다. WSS와 SSH 모두 Rust가 바이트 연결과 WebSocket 프레임을 맡고, 웹뷰에는 텍스트 프레임만 IPC 채널로 넘긴다. JSON-RPC 처리, hello, 재개(19의 클라이언트 코어)와 경로·재시도 판단은 TS가 한다. 기기 토큰은 Rust 밖으로 나가지 않는다 | [제안], 19 P-03과 맞춤 | §3.2, §3.8.5 |
| APP-D03 | SSH 경로는 시스템 OpenSSH 클라이언트를 `ssh -W 127.0.0.1:<데몬 포트>`로 실행하고, 그 표준 입출력 위에서 WebSocket 핸드셰이크를 한다. Rust SSH 라이브러리를 쓰지 않는다 | [제안], 결정 38. 19 P-02와 같은 선택 | §3.8.2 |
| APP-D04 | SSH 경로에서도 기기 토큰을 보낸다. SSH 키는 전송 인증이고 Helm 기기 인증을 대신하지 않는다 | [제안], 18과 맞출 것 | §3.8.7 |
| APP-D05 | 연결 프로필은 서버 하나에 경로 여러 개를 둔다. 경로는 순서대로 시도하고 네트워크 계열 실패에만 다음 경로로 넘어간다. 연결된 동안에는 경로를 바꾸지 않는다 | [제안] | §3.8.10 |
| APP-D06 | UI는 앱에 묶어 배포한다. 데몬이 UI를 서빙하지 않는다 | [제안] | §3.11 |
| APP-D07 | 서버 상태는 TanStack Query, UI 상태는 Zustand, 연결 상태 기계는 순수 리듀서로 둔다 | [제안] | §3.9.3 |
| APP-D08 | 재접속은 저장한 위치(`{storeId, seq}`)부터 재개하고, 데몬이 범위 밖이라고 하면(`2001 replay.outOfRange`: 저장소가 바뀜, 보존 범위 밖, 밀린 이벤트가 너무 많음) 뷰를 낡음으로 표시하거나 버리고 `head`부터 구독한 뒤 다시 받는다. 위치와 낡음 표시는 한 IndexedDB 트랜잭션에 기록한다 | [제안], 결정 31, 19 §3.5.5 | §3.9.6 |
| APP-D09 | 명령마다 멱등 키(`ik_<ULID>`)와 `basisSeq`를 붙인다. 응답 전에 연결이 끊긴 명령은 IndexedDB의 진행 중 명령함에 두었다가 같은 멱등 키로 다시 보낸다. 연결이 없을 때 새 사람 결정은 받지 않는다 | [제안], 03 §4·21 UI-D02와 맞춤 | §3.9.7 |
| APP-D10 | 뷰 캐시와 위치는 IndexedDB에 서버별로 영속한다. 앱을 오프라인으로 시작해도 마지막 뷰를 읽기 전용으로 보인다 | [제안] | §3.9.5 |
| APP-D11 | OS 알림은 데몬의 전달 결정이 기록된 영속 이벤트를 실시간으로 받았을 때만 띄운다(재전송 중에 받은 것은 띄우지 않는다). 앱은 다른 이벤트를 보고 알림 여부를 판단하지 않는다 | [제안], 결정 12, 19 §3.8.3 | §3.10.1 |
| APP-D12 | 대용량 파일은 Rust의 사용자 정의 URI 스킴(`helm-blob`)으로 받는다. Rust가 현재 경로로 HTTP 요청(`/files/b/<blobId>`, 기기 토큰 헤더)을 하고 디스크에 캐시한다 | [제안], 결정 31, 19 P-13 | §3.8.6 |
| APP-D13 | macOS 빌드는 Mac에서 `run-on mac`으로, Windows 설치 파일은 WSL에서 교차 빌드(NSIS)하는 것을 기본으로 하고 GitHub Actions Windows 러너를 대체 경로로 둔다 | [제안] | §3.12.4 |
| APP-D14 | 1차에는 자동 업데이트를 넣지 않는다. 앱은 hello에서 호환 범위를 확인하고 맞지 않으면 갱신 방법을 안내한다 | [제안] | §3.12.6 |
| APP-D15 | E2E의 주 경로는 같은 SPA를 브라우저(Playwright)에서 가짜 데몬에 붙여 돌리는 것이다. Tauri 셸 자체의 E2E는 WebdriverIO `@wdio/tauri-service`로 macOS·Windows 스모크만 한다 | [제안] | §3.13.4 |

### 2.4 가정

| ID | 가정 | 틀리면 |
|---|---|---|
| AS-1 | 데몬이 이벤트의 `invalidates`와 뷰의 `dependsOn`을 정확성 규칙(19 §3.6.3: 뷰 데이터가 바뀌면 둘이 겹친다)대로 계산한다. 19 P-07이 이 방식을 택했다 | 앱 화면이 낡은 데이터를 현재처럼 보인다. 19의 속성 테스트(VIEW-01)가 막아야 한다. 앱은 대응표를 갖지 않는다 |
| AS-2 | `view.get`의 `minSeq`를 데몬이 지킨다. 못 지키면 `2006 view.notReady`(재시도 가능)를 돌려준다(19 §3.5.6) | 앱은 응답의 `asOfSeq`가 `minSeq`보다 작으면 낡음 표시를 유지하고 다시 받는다(§3.9.6). 정확성은 유지된다 |
| AS-3 | 데몬의 WebSocket 업그레이드는 `Authorization: Bearer` 헤더로 기기 토큰을 받는다(19 P-03이 택함. 최종은 18) | 토큰을 hello 인자로 보내야 하면 §3.8.5-7의 "인증 프레임 주입" 대안을 쓴다 |
| AS-4 | WSL `sshd`가 `127.0.0.1:<HELM_LOOPBACK_PORT>`로의 포워딩(`-W`)을 허용한다(OpenSSH 기본값 `AllowTcpForwarding yes`) | 17·18이 막았다면 `PermitOpen 127.0.0.1:<HELM_LOOPBACK_PORT>`로 이 포트만 열어 달라고 요구한다(§5.2). 그것도 안 되면 19 §3.2.3의 예비 경로(`helm bridge`)를 쓴다 |
| AS-5 | 서버 PC 자신에서 자기 tailnet 이름(`server.tail7ad0b4.ts.net`)의 serve 포트로 접속할 수 있다 | 서버 PC의 Windows 앱에 `ws://127.0.0.1:<포트>` 경로를 따로 허용해야 한다(§7 Q-05) |
| AS-6 | Tauri 웹뷰를 숨긴 상태(창 닫기 = 숨기기)에서도 IPC 채널 메시지와 JS 타이머가 알림을 띄울 만큼 동작한다 | 알림 표시를 Rust로 옮긴다(§7 Q-06) |

## 3. 명세 본문

### 3.1 전체 구조 [제안]

```text
┌──────────────────────── Helm 데스크톱 앱 (macOS / Windows) ────────────────────────┐
│ 웹뷰: React 18 SPA (앱에 묶어 배포, §3.11)                                          │
│   화면(screens/) ── 컴포넌트(ui/, 21) ── 뷰 모델                                     │
│   뷰 캐시: TanStack Query  ⇄  IndexedDB(뷰, 위치, 진행 중 명령함, 초안)              │
│   세션: 19 클라이언트 코어(JSON-RPC·hello·구독·재전송)        연결 상태 기계(경로)  │
│          ▲ Channel<TransportEvent>                 │ invoke('transport_send')        │
├──────────┼─────────────────────────────────────────┼─────────────────────────────────┤
│ Rust (Tauri 코어)                                                                    │
│   transport: WSS(rustls) │ SSH(ssh -W 자식 프로세스) ─▶ WebSocket 클라이언트          │
│   blob: helm-blob 스킴 → HTTP(현재 경로) → 디스크 캐시                                │
│   profiles(설정 파일) · secrets(OS 키체인의 기기 토큰) · pairing                       │
│   tray · badge · window(닫기=숨기기) · 플러그인(알림, 딥 링크, 단일 인스턴스, …)       │
└──────────┼─────────────────────────────────────────┼─────────────────────────────────┘
           │ WSS (tailnet, :8448)                      │ SSH (tailnet, :22)
   Windows 호스트 `tailscale serve`                 WSL `sshd` ── direct-tcpip(-W)
           ▼                                           ▼
   127.0.0.1:7840 `tailnet` 리스너          127.0.0.1:7841 `loopback` 리스너
           └──────────────▶  Helm 데몬 (17 D17-09, 19 §3.2.1)  ◀──────┘
```

- 프로세스는 Tauri 앱 하나다. 웹뷰 창은 `main` 하나이고, 닫기 단추는 창을 숨긴다(§3.10.5). 사이드카 프로세스는 없다. SSH 경로를 쓸 때만 OpenSSH 클라이언트 자식 프로세스가 전송마다 하나씩 생긴다.
- 데몬과 주고받는 바이트는 모두 Rust를 거친다. 웹뷰의 CSP에는 데몬 주소가 없다(§3.6.2). 웹뷰가 외부와 통신하는 길은 IPC와 `helm-blob` 스킴 둘뿐이다.
- 원전의 프로세스 경계(canon-3 §6.10.1: 샌드박스 렌더러, 좁은 typed IPC, 메인 프로세스의 창·딥 링크·알림·자격 중개)를 Tauri로 옮긴 것이다. 원전의 "local core"(이벤트 원장, 어댑터, 백그라운드 WorkUnit)는 데몬이다(canon-3 §7.1 C7).

### 3.2 Rust 쪽 책임 [제안]

원칙: Rust에는 웹뷰가 할 수 없는 일과 웹뷰에 두면 안 되는 비밀만 둔다. Rust 코드는 Helm 도메인 타입과 JSON-RPC 메서드를 모른다. 전송 프레임은 해석하지 않고 문자열로 넘긴다. 예외는 없다(페어링 응답은 JSON-RPC가 아니라 HTTP·SSH 출력이다, §3.8.7).

| 모듈 (`src-tauri/src/`) | 책임 | 웹뷰에 두지 않는 이유 |
|---|---|---|
| `lib.rs` | `tauri::Builder` 구성: 플러그인 등록, 명령 등록, 상태(`AppState`), 트레이, `helm-blob` 스킴, 창 이벤트 | 앱 수명주기 |
| `profiles.rs` | 연결 프로필 파일(`<app_config_dir>/profiles.json`) 읽기·쓰기·검증, 스키마 버전 이행 | 경로 검증 결과가 SSH 인자로 들어가므로 Rust에서 한 번 더 검증한다 |
| `secrets.rs` | OS 키체인에 기기 토큰 저장·조회·삭제(`keyring-core`와 플랫폼별 저장소 크레이트, §3.10.7) | 토큰을 웹뷰 메모리에 두지 않는다(APP-D02) |
| `transport/mod.rs` | `TransportManager`: 전송 열기·보내기·닫기, 전송 ID 발급, 이벤트 채널 연결, 앱 종료 때 모두 닫기 | 아래 셋을 묶는다 |
| `transport/wss.rs` | TCP + TLS(rustls, OS 신뢰 저장소) + WebSocket 업그레이드, `Authorization` 헤더 | 브라우저 WebSocket은 헤더를 붙일 수 없다 |
| `transport/ssh.rs` | `ssh` 실행 파일 찾기, 인자 만들기, 자식 프로세스 실행, stderr 수집, 실패 분류 | 웹뷰는 프로세스를 띄울 수 없다 |
| `transport/ws.rs` | 임의의 바이트 스트림 위의 WebSocket 핸드셰이크, 프레임 중계, 서버 ping에 pong | 두 경로가 같은 코드를 쓴다 |
| `pairing.rs` | 페어링 코드 교환(HTTPS POST)과 SSH 발급(`ssh … helm device issue`), 결과 토큰을 바로 키체인에 저장 | 토큰이 웹뷰를 거치지 않게 한다 |
| `blob.rs`, `http_stream.rs` | `helm-blob` 스킴 처리, 경로별 HTTP/1.1 요청(SSH 경로는 `ssh -W` 스트림 위), 디스크 캐시, 업로드 | 인증 헤더와 SSH 스트림이 Rust에 있다 |
| `os/tray.rs`, `os/badge.rs`, `os/window.rs` | 트레이 메뉴 그리기와 클릭 처리, Dock 배지, 창 닫기=숨기기, 포커스 | 네이티브 API |
| `diag.rs` | 앱 정보(`app_info`), 로그 파일 위치(`tauri-plugin-log`), 진단 묶음 | 파일 접근 |
| `error.rs` | `AppError`(직렬화 가능한 오류 코드) | IPC 오류 계약 |

Rust가 하지 않는 일: 재접속 시점 판단(TS 연결 상태 기계가 한다), JSON-RPC 요청 ID 관리, 이벤트 해석, 알림을 띄울지 판단, 트레이에 보일 숫자 계산(TS가 투영에서 읽어 `tray_update`로 넘긴다).

### 3.3 웹뷰 쪽 책임 [제안]

| 영역 | 책임 |
|---|---|
| 세션 | 19 코어(`@helm/client`)가 JSON-RPC, hello, 구독·재개, 순서 검사, 진행 중 명령 재전송을 한다. 앱은 전송과 IndexedDB 저장소를 넘긴다(§3.9.4) |
| 연결 상태 기계 | 경로 순서, 재시도 간격, 차단 상태(페어링 필요, 호스트 키, 버전 불일치) 판단과 표시 |
| 뷰 캐시 | 뷰 조회, 무효화 결과 반영, IndexedDB 영속, 신선도 계산 |
| 화면 | 라우팅, 셸 영역(03 §3.4), 화면 조립, 의도(`UiIntent`, 21 UI-D01) → 명령 변환 |
| OS 기능 호출 | 알림 표시, 전역 단축키 등록, 로그인 시 시작 켜고 끄기, 딥 링크 수신을 플러그인 JS API로 한다. 트레이 내용과 배지 숫자는 Rust 명령으로 넘긴다 |
| 설정 | 화면 설정(테마, 밀도, 알림 종류, 단축키)을 `tauri-plugin-store`의 `settings.json`에 둔다. 연결 프로필은 Rust 명령으로만 바꾼다 |

웹뷰가 하지 않는 일: 데몬에 직접 연결, 토큰 읽기, 파일 시스템 접근(파일 업로드는 대화 상자 플러그인이 고른 파일을 Rust 명령이 읽는다), 셸 실행.

### 3.4 IPC 명령 목록 [제안]

모든 명령은 `apps/desktop/src/platform/ipc.ts`의 타입 있는 함수로만 부른다. 화면 코드는 `@tauri-apps/api`의 `invoke`를 직접 부르지 않는다(브라우저 실행용 대체 구현으로 바꿔 끼우기 위해서다, §3.13.3). JS 인자 이름은 camelCase이고 Tauri가 Rust 쪽 snake_case 인자로 맞춘다 [지식: Tauri v2 명령 인자 기본 규칙].

#### 3.4.1 공통 타입

```ts
// apps/desktop/src/platform/types.ts
export type AppErrorCode =
  | 'invalid_input'        // 프로필·인자 검증 실패
  | 'not_found'            // 프로필·전송 ID 없음
  | 'credential_missing'   // 키체인에 기기 토큰 없음
  | 'keychain_unavailable' // 키체인 접근 실패(잠김, 서비스 없음)
  | 'keychain_denied'      // 사용자가 키체인 접근을 거부
  | 'pairing_rejected'     // 코드 틀림·폐기
  | 'pairing_expired'
  | 'ssh_missing'          // ssh 실행 파일 없음
  | 'ssh_failed'           // ssh 실행 실패(세부는 detail)
  | 'network'
  | 'io'
  | 'internal';

export interface AppError { code: AppErrorCode; message: string; detail?: string }

export type RouteKind = 'wss' | 'ssh';

export interface WssRoute {
  routeId: string;            // 'rt_<ULID>'
  kind: 'wss';
  baseUrl: string;            // 'https://server.tail7ad0b4.ts.net:8448' (https만. 개발 빌드만 http://127.0.0.1 허용)
  enabled: boolean;
}

export interface SshRoute {
  routeId: string;
  kind: 'ssh';
  target: string;             // ssh 별칭 또는 user@host. 공백·'-' 시작 금지
  port?: number;              // 없으면 ssh 설정을 따른다
  identityFile?: string;      // 없으면 ssh 설정·에이전트를 따른다
  daemonPort: number;         // 서버 쪽 `loopback` 리스너 포트(17 D17-09 기본 7841, 19 HELM_LOOPBACK_PORT)
  hostKeyPolicy: 'strict' | 'openssh'; // §3.8.3
  sshPath?: string;           // 없으면 자동 탐색
  helmCliPath?: string;       // SSH 페어링 때 실행할 helm CLI 경로. 기본 'helm'
  enabled: boolean;
}

export type Route = WssRoute | SshRoute;

export interface ServerProfile {
  profileId: string;          // 'pf_<ULID>' (앱 안에서만 쓰는 ID)
  displayName: string;
  serverId: string | null;    // 첫 페어링·hello에서 고정. 이후 다른 serverId면 연결을 거부한다
  deviceId: string | null;    // 'dv_<ULID>' (브리프 §3.2)
  routes: Route[];            // 순서 = 시도 순서. 1개 이상
  routePolicy: 'ordered' | 'pinned'; // pinned = 첫 번째 활성 경로만
  createdAt: string;          // ISO 8601 UTC
  updatedAt: string;
}

export type ServerProfileInput =
  Omit<ServerProfile, 'profileId' | 'serverId' | 'deviceId' | 'createdAt' | 'updatedAt'> & { profileId?: string };

export interface PairingResult { serverId: string; deviceId: string }

export interface CredentialStatus { present: boolean; deviceId: string | null; storedAt: string | null }

export type TransportCloseReason =
  | 'local_close'          // transport_close 호출
  | 'network_unreachable'  // DNS·TCP 실패, 연결 시간 초과, SSH 22번 연결 실패
  | 'daemon_unreachable'   // serve가 502/503/504, SSH 포워딩 대상 연결 거부
  | 'tls_error'
  | 'http_unauthorized'    // 업그레이드가 401/403 (토큰 없음·폐기)
  | 'http_status'          // 그 밖의 업그레이드 실패 (httpStatus 참고)
  | 'ssh_missing'
  | 'ssh_auth_failed'      // Permission denied (publickey…)
  | 'ssh_host_key_unknown'
  | 'ssh_host_key_changed'
  | 'ssh_failed'           // 분류하지 못한 ssh 종료
  | 'credential_missing'
  | 'keychain_denied'
  | 'ping_timeout'         // 소켓 쓰기·읽기 시간 초과(앱 수준 생존 확인은 TS의 tick 감시, §3.8.5)
  | 'remote_close'         // 데몬이 닫음 (wsCode 참고)
  | 'protocol_violation'   // 바이너리 프레임, 크기 초과
  | 'internal';

export type TransportEvent =
  | { type: 'progress'; step: 'spawn' | 'tcp' | 'tls' | 'upgrade' }
  | { type: 'open'; routeId: string; routeKind: RouteKind }
  | { type: 'text'; data: string }                       // JSON-RPC 메시지 하나
  | { type: 'closed'; reason: TransportCloseReason; detail?: string; httpStatus?: number; wsCode?: number };

export interface BlobRef { blobId: string; sha256?: string; size: number; mime: string; url: string } // url = helm-blob URL. 필드는 19 §3.11 BlobRef에 맞춘다

export interface TraySummary {
  connection: 'live' | 'connecting' | 'offline' | 'blocked';
  asOfSeq: number | null;     // 오프라인 기준 표시용
  choiceNeeded: number;       // 선택 필요(권리 게이트) 수. 배지 값. 19 `tray` 뷰 그대로
  goodToCheck: number;        // 확인하면 좋은 것 수
  dndUntil?: string;          // 방해 금지 끝 시각
  running: Array<{ label: string; route: string }>;  // 최대 5. label 예: "Concern 12 · 본문 1절 초안 쓰는 중"(04 §3.24). 19 `tray` 뷰 값 그대로
  runningMore: number;        // "외 n개"
}

export interface AppInfo {
  appVersion: string; buildId: string; platform: 'macos' | 'windows'; arch: string;
  protocolRange: { min: number; max: number };
  sshPath: string | null;     // 탐색된 ssh
  sshVersion: string | null;  // `ssh -V` 결과
}
```

#### 3.4.2 명령 표

| 명령 | TypeScript | Rust 시그니처 | 비고 |
|---|---|---|---|
| `profiles_list` | `profilesList(): Promise<ServerProfile[]>` | `async fn profiles_list(state: State<'_, AppState>) -> Result<Vec<ServerProfile>, AppError>` | |
| `profile_upsert` | `profileUpsert(input: ServerProfileInput): Promise<ServerProfile>` | `async fn profile_upsert(state: State<'_, AppState>, input: ServerProfileInput) -> Result<ServerProfile, AppError>` | §3.8.1 검증. 경로를 지우면 그 경로의 열린 전송을 닫는다 |
| `profile_delete` | `profileDelete(profileId: string): Promise<void>` | `async fn profile_delete(state, profile_id: String) -> Result<(), AppError>` | 키체인 토큰과 blob 캐시도 지운다. IndexedDB 정리는 TS가 한다 |
| `credential_status` | `credentialStatus(profileId: string): Promise<CredentialStatus>` | `async fn credential_status(state, profile_id: String) -> Result<CredentialStatus, AppError>` | 토큰 값은 돌려주지 않는다 |
| `credential_forget` | `credentialForget(profileId: string): Promise<void>` | `async fn credential_forget(state, profile_id: String) -> Result<(), AppError>` | 이 기기에서만 지운다. 데몬 쪽 폐기는 19 메서드 |
| `pairing_with_code` | `pairingWithCode(a: { profileId: string; routeId: string; code: string; deviceName: string }): Promise<PairingResult>` | `async fn pairing_with_code(state, profile_id: String, route_id: String, code: String, device_name: String) -> Result<PairingResult, AppError>` | WSS 경로 전용. §3.8.7 |
| `pairing_via_ssh` | `pairingViaSsh(a: { profileId: string; routeId: string; deviceName: string }): Promise<PairingResult>` | `async fn pairing_via_ssh(state, profile_id: String, route_id: String, device_name: String) -> Result<PairingResult, AppError>` | SSH 경로 전용. §3.8.7 |
| `route_check` | `routeCheck(a: { profileId: string; route: Route }): Promise<RouteCheckResult>` | `async fn route_check(state, profile_id: String, route: Route) -> Result<RouteCheckResult, AppError>` | `SCR-CONNECT` 연결 점검 1~3단계(04 §3.19): ① 이름 찾기(WSS: DNS, SSH: `ssh -G <target>`로 실제 호스트·포트·사용자), ② 서버 경로(WSS: TCP+TLS, SSH: `-W` 연결), ③ `GET /healthz`(19 §3.2.5, 응답의 `protocols`). 4단계(인증)와 5단계(버전)는 TS가 임시 세션으로 `hello`까지 해 본다. 저장하지 않은 경로도 점검할 수 있다. `RouteCheckResult = { steps: Array<{ step: 'resolve' \| 'path' \| 'health'; ok: boolean; reason?: TransportCloseReason; detail?: string; ms: number }>; resolved?: { hostname: string; port: number; user?: string }; protocols?: number[]; sshVersion?: string }` |
| `transport_open` | `transportOpen(a: { profileId: string; routeId: string; routeOverride?: Route; onEvent: Channel<TransportEvent> }): Promise<{ transportId: string }>` | `async fn transport_open(app: AppHandle, state, profile_id: String, route_id: String, route_override: Option<Route>, on_event: Channel<TransportEvent>) -> Result<TransportOpened, AppError>` | 바로 돌아오고 결과는 채널로 온다. 한 프로필에 열린 연결용 전송은 하나만 둔다(새로 열면 이전 것을 `local_close`로 닫는다). 연결 점검용으로 `routeOverride?: Route`를 넘기면 저장하지 않은 경로로 별도 전송을 연다(점검이 끝나면 닫는다) |
| `transport_send` | `transportSend(a: { transportId: string; text: string }): Promise<void>` | `async fn transport_send(state, transport_id: String, text: String) -> Result<(), AppError>` | 열려 있지 않으면 `not_found`. 송신 대기가 4 MiB를 넘으면 전송을 닫는다(`protocol_violation`) |
| `transport_close` | `transportClose(a: { transportId: string; code?: 1000 \| 4000 }): Promise<void>` | `async fn transport_close(state, transport_id: String, code: Option<u16>) -> Result<(), AppError>` | 기본 1000. tick 감시 시간 초과는 4000(19 §3.2.6). 이미 닫혔으면 아무것도 하지 않는다 |
| `blob_upload` | `blobUpload(a: { profileId: string; mime: string; fileName?: string; limits: UploadLimits }, body: ArrayBuffer): Promise<BlobRef>` | `async fn blob_upload(state, request: tauri::ipc::Request<'_>) -> Result<BlobRef, AppError>` | 본문은 원시 바이트로 넘긴다. 머리 정보는 요청 헤더 `x-helm-profile`, `x-helm-mime`, `x-helm-filename`, `x-helm-limits`(JSON). `UploadLimits = { singleUploadMaxBytes; uploadChunkBytes; maxBlobBytes }`(hello 응답의 `policy.files`, 19 §3.4.4) |
| `blob_upload_path` | `blobUploadPath(a: { profileId: string; path: string; limits: UploadLimits }): Promise<BlobRef>` | `async fn blob_upload_path(state, profile_id: String, path: String, limits: UploadLimits) -> Result<BlobRef, AppError>` | 대화 상자 플러그인이 돌려준 경로만 받는다(§3.6.3) |
| `blob_cache_clear` | `blobCacheClear(profileId?: string): Promise<void>` | `async fn blob_cache_clear(state, profile_id: Option<String>) -> Result<(), AppError>` | |
| `tray_update` | `trayUpdate(s: TraySummary): Promise<void>` | `async fn tray_update(app: AppHandle, summary: TraySummary) -> Result<(), AppError>` | 메뉴와 아이콘 상태만 바꾼다 |
| `badge_set` | `badgeSet(count: number \| null): Promise<void>` | `async fn badge_set(app: AppHandle, count: Option<u32>) -> Result<(), AppError>` | §3.10.3 |
| `window_reveal` | `windowReveal(a?: { route?: string }): Promise<void>` | `async fn window_reveal(app: AppHandle, route: Option<String>) -> Result<(), AppError>` | 창을 보이고 앞으로 가져오고, `route`가 있으면 `app://navigate` 이벤트를 보낸다 |
| `app_info` | `appInfo(): Promise<AppInfo>` | `async fn app_info(state) -> Result<AppInfo, AppError>` | |
| `diag_bundle` | `diagBundle(): Promise<{ path: string }>` | `async fn diag_bundle(app: AppHandle) -> Result<DiagBundle, AppError>` | 로그와 앱 정보를 zip으로 묶어 다운로드 폴더에 둔다. 토큰과 IndexedDB 내용은 넣지 않는다 |
| `credential_rotate` (조건부) | `credentialRotate(profileId: string): Promise<void>` | `async fn credential_rotate(state, profile_id: String) -> Result<(), AppError>` | 18·19가 HTTP 교체 경로를 두면 넣는다(§3.8.7). 1차에는 등록하지 않는다 |
| `device_sign_challenge` (조건부) | `deviceSignChallenge(a: { profileId: string; serverId: string; nonce: string; signedAt: string }): Promise<{ signature: string }>` | `async fn device_sign_challenge(state, profile_id: String, server_id: String, nonce: String, signed_at: String) -> Result<DeviceSignature, AppError>` | 19 `hello.challenge.proofRequired`를 18이 켜면 넣는다. 서명 대상 문자열은 19 §3.4.3 |

Rust 쪽 공통 규칙:

- 모든 명령은 `async`이고 `Result<T, AppError>`를 돌려준다. `AppError`는 `#[derive(Serialize)] #[serde(rename_all = "camelCase")] struct AppError { code: AppErrorCode, message: String, detail: Option<String> }`이다. `message`는 한국어 문구가 아니라 개발자용 영어 한 줄이고, 화면 문구는 TS가 `code`로 고른다(결정 37, 05).
- 인자 구조체는 `#[serde(rename_all = "camelCase", deny_unknown_fields)]`로 받는다.
- `detail`에는 ssh stderr 마지막 4 KiB까지 넣을 수 있다. 토큰, 페어링 코드는 넣지 않는다.

### 3.5 Rust → 웹뷰 이벤트 [제안]

명령 응답과 전송 채널 밖에서 Rust가 웹뷰로 보내는 것은 아래 셋이다. 이름은 `app://` 접두어를 쓴다.

| 이벤트 | 페이로드 | 보내는 때 |
|---|---|---|
| `app://navigate` | `{ route: string; source: 'tray' \| 'notification' \| 'shortcut' \| 'reveal' }` | 트레이 메뉴 항목, `window_reveal(route)` |
| `app://tray-action` | `{ action: 'quick-capture' \| 'reconnect' \| 'open-connect' \| 'dnd-toggle' }` | 트레이 메뉴의 동작 항목. `dnd-toggle`은 웹뷰가 데몬 설정 명령으로 보낸다(§3.10.2) |
| `app://window` | `{ state: 'shown' \| 'hidden' \| 'focused' \| 'blurred' }` | 창 상태가 바뀔 때. 연결 점검(§3.8.8의 `PROBE`)과 배지 처리에 쓴다 |

딥 링크와 두 번째 실행의 인자는 딥 링크 플러그인의 `onOpenUrl`로 받는다(§3.10.6). 전송 이벤트는 `transport_open`이 받은 채널로만 보낸다. Tauri의 채널은 순서를 지켜 보내는 용도로 만든 것이라 전역 이벤트보다 낫다 [지식: Tauri v2 "Calling the frontend from Rust" 문서의 Channels 설명].

### 3.6 권한(capabilities)과 보안 설정 [제안]

원전의 Electron 보안 지침(canon-3 §6.10.1: 렌더러 권한 최소화, restrictive CSP, IPC 범위 제한, 원격 콘텐츠 분리, OS 키체인)을 Tauri 대응으로 옮긴 것이다(canon-3 §8 문서 20 체크리스트 1번).

#### 3.6.1 capabilities

- 파일: `src-tauri/capabilities/main.json` 하나. `tauri.conf.json`의 `app.security.capabilities`에 `["main"]`을 명시해 이 파일만 쓰게 한다. 명시하지 않으면 디렉터리 안의 모든 capability가 켜진다 [검색: v2.tauri.app/security/capabilities].
- 앱 명령은 `build.rs`의 `AppManifest::commands`로 등록한다. 이렇게 하면 앱 매니페스트가 생기고, capability에 적지 않은 앱 명령은 웹뷰에서 부를 수 없다. 매니페스트가 없으면 로컬 origin에서 모든 앱 명령이 열린다 [원문: tauri `crates/tauri/src/webview/mod.rs`의 판정 `plugin_command.is_some() || has_app_acl_manifest || !is_local`, 보조 에이전트가 2.12.3 소스로 확인].
- 원격 URL capability(`remote.urls`)는 두지 않는다. 웹뷰는 원격 페이지를 열지 않는다.

```rust
// src-tauri/build.rs
fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "profiles_list", "profile_upsert", "profile_delete",
            "credential_status", "credential_forget",
            "pairing_with_code", "pairing_via_ssh", "route_check",
            "transport_open", "transport_send", "transport_close",
            "blob_upload", "blob_upload_path", "blob_cache_clear",
            "tray_update", "badge_set", "window_reveal", "app_info", "diag_bundle",
        ])),
    )
    .expect("tauri build");
}
```

```json
// src-tauri/capabilities/main.json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main",
  "description": "Helm main window",
  "windows": ["main"],
  "platforms": ["macOS", "windows"],
  "permissions": [
    "core:app:default", "core:event:default", "core:path:default",
    "core:window:allow-show", "core:window:allow-hide", "core:window:allow-set-focus",
    "core:window:allow-unminimize", "core:window:allow-set-title", "core:window:allow-set-theme",
    "core:window:allow-set-badge-count", "core:window:allow-set-overlay-icon",
    "allow-profiles-list", "allow-profile-upsert", "allow-profile-delete",
    "allow-credential-status", "allow-credential-forget",
    "allow-pairing-with-code", "allow-pairing-via-ssh", "allow-route-check",
    "allow-transport-open", "allow-transport-send", "allow-transport-close",
    "allow-blob-upload", "allow-blob-upload-path", "allow-blob-cache-clear",
    "allow-tray-update", "allow-badge-set", "allow-window-reveal", "allow-app-info", "allow-diag-bundle",
    "notification:default",
    "global-shortcut:allow-register", "global-shortcut:allow-unregister", "global-shortcut:allow-is-registered",
    "autostart:allow-enable", "autostart:allow-disable", "autostart:allow-is-enabled",
    "deep-link:allow-get-current",
    "store:default",
    "window-state:allow-save-window-state", "window-state:allow-restore-state",
    "dialog:allow-open",
    "clipboard-manager:allow-write-text",
    { "identifier": "opener:allow-open-url", "allow": [{ "url": "https://*" }] },
    "log:default"
  ]
}
```

- 넣지 않는 권한: `shell`(프로세스 실행은 Rust 내부만), `fs`(파일 읽기는 `blob_upload_path`가 대화 상자 결과만 받는다), `http`(데몬 통신은 Rust 전송), `websocket` 플러그인, `process`, `updater`(APP-D14).
- `core:window:allow-set-badge-count`, `allow-set-overlay-icon`은 `core:window:default`에 없어 따로 적는다 [원문: tauri 2.12.3 `packages/api/src/window.ts`와 권한 목록, 보조 에이전트 확인].
- 권한 이름은 `pnpm tauri build`가 만드는 `gen/schemas/desktop-schema.json`으로 검사한다. 목록에 없는 이름이 있으면 빌드가 실패한다 [지식].

#### 3.6.2 CSP와 보안 설정

```jsonc
// src-tauri/tauri.conf.json 중 app.security
{
  "csp": {
    "default-src": "'self'",
    "script-src": "'self'",
    "style-src": "'self'",
    "img-src": "'self' data: blob: helm-blob: http://helm-blob.localhost",
    "media-src": "'self' blob: helm-blob: http://helm-blob.localhost",
    "font-src": "'self'",
    "connect-src": "ipc: http://ipc.localhost",
    "object-src": "'none'",
    "frame-src": "'none'",
    "base-uri": "'none'",
    "form-action": "'none'"
  },
  "devCsp": { /* 위와 같고 connect-src에 ws://localhost:1420 http://localhost:1420 추가(Vite HMR) */ },
  "freezePrototype": true,
  "capabilities": ["main"]
}
```

- `connect-src`에 데몬 주소가 없다. 웹뷰가 데몬이나 다른 원격 주소로 직접 요청하면 CSP가 막는다. IPC가 동작하려면 `ipc: http://ipc.localhost`가 있어야 한다 [검색: v2.tauri.app/security/csp].
- 사용자 정의 스킴은 macOS에서 `helm-blob://localhost/…`, Windows에서 `http://helm-blob.localhost/…` 모양이라 둘 다 적는다 [지식: Tauri의 사용자 정의 프로토콜 URL 규칙. `convertFileSrc`와 같은 규칙].
- 스타일은 Tauri가 빌드 때 nonce를 붙인다. React가 DOM의 `style` 속성을 JS로 바꾸는 것은 CSP `style-src`의 대상이 아니다 [지식].
- 글꼴은 앱에 넣는다(21 UI-D12). 원격 글꼴·스크립트·이미지는 없다.
- `withGlobalTauri: false`. `@tauri-apps/api`는 ES 모듈로 가져온다.
- Vite `envPrefix`는 `['VITE_', 'TAURI_ENV_']`만 쓴다. `TAURI_`를 통째로 넣으면 서명 키 같은 빌드 환경 변수가 번들에 들어갈 수 있다 [검색: CVE-2023-46115 설명].
- Tauri 버전 하한은 2.11.6이다. 2.11.1(원격 페이지의 로컬 IPC 호출, CVE-2026-42184)과 2.11.6(fetch 명령 접근 제어)의 보안 수정이 들어간 판이다 [검색: github.com/tauri-apps/tauri/security/advisories].
- isolation 패턴은 1차에 쓰지 않는다. 원격 콘텐츠와 서드파티 스크립트가 없고 IPC 명령이 19개로 작아서, 모든 IPC를 iframe에서 다시 검사하는 비용(Windows에서 ES 모듈 제약)에 비해 얻는 것이 적다 [검색: v2.tauri.app/concept/inter-process-communication/isolation]. 데몬이 보낸 텍스트(모델 출력, 도구 출력)는 신뢰하지 않는 입력이므로 21에 "마크다운 렌더러는 원시 HTML을 끄고 링크 스킴을 `https`, `helm`으로 제한한다"를 요구한다(§5.2).

#### 3.6.3 그 밖의 보안 규칙

| 규칙 | 이유 |
|---|---|
| 기기 토큰은 Rust의 `secrets.rs`만 읽는다. IPC 응답, 로그, `detail`, 진단 묶음에 넣지 않는다 | 웹뷰 XSS가 있어도 토큰을 빼낼 수 없게 한다 |
| `blob_upload_path`는 직전 `dialog.open` 결과로 받은 경로만 받는다. Rust가 최근 대화 상자 결과 경로를 1분 동안 기억하고 대조한다 | 웹뷰가 임의 파일을 읽어 올리는 길을 막는다 |
| SSH 인자에 들어가는 값(`target`, `identityFile`, `sshPath`, `helmCliPath`)은 Rust가 검증한다: 공백·제어 문자 금지, `-`로 시작 금지, `identityFile`·`sshPath`는 절대 경로 | 인자 주입(`-oProxyCommand=…`)을 막는다(S4 paseo: `packages/protocol/src/ssh-transport.ts:17-24`와 같은 검사) |
| 외부 링크는 `opener`로 `https`만 연다. 열기 전에 주소를 보이고 확인을 받는다(05) | 데몬 텍스트에 섞인 링크 |
| 딥 링크 인자는 §3.10.6의 형식 검사를 통과한 것만 라우팅한다 | 다른 앱이 임의 URL로 앱을 열 수 있다 [검색: v2.tauri.app/plugin/deep-linking "보안"] |

### 3.7 쓰는 플러그인과 크레이트, 버전

버전은 2026-10-11 기준 최신 안정판이다. 정확한 버전으로 고정하고(npm은 `^` 없이, Cargo는 `=x.y.z`), 올릴 때는 ADR 없이 `just verify`와 `just app-e2e` 통과로 충분하다. 확인 수준은 보조 에이전트의 crates.io·npm 레지스트리 조회와 소스 확인이다 [검색].

#### 3.7.1 Tauri와 공식 플러그인

| 이름 (crate / npm) | 버전 | 용도 | 비고 |
|---|---|---|---|
| `tauri` / `@tauri-apps/api` | 2.12.3 / 2.12.3 | 셸 | feature `tray-icon`, `image-png`. MSRV 1.90. 2.11.6 미만 금지(§3.6.2). Tauri 3.0 알파가 나와 있으나 쓰지 않는다 |
| `tauri-build` | 2.7.2 | `build.rs` | |
| `@tauri-apps/cli` | 2.12.2 | 빌드 도구 | `pnpm tauri …` |
| `tauri-plugin-single-instance` | 2.5.3 | 두 번째 실행을 기존 창으로 넘김 | feature `deep-link`. 반드시 첫 번째로 등록한다 |
| `tauri-plugin-deep-link` | 2.6.1 | `helm://` 스킴 | macOS는 설정 파일 등록만 되고 실행 중 등록이 안 된다. 설치한 앱(`/Applications`)에서만 시험할 수 있다 |
| `tauri-plugin-notification` | 2.6.0 | OS 알림 | 2.6.0부터 데스크톱에서 알림 클릭과 액션이 `onAction`으로 온다. 2.6.0은 `onAction` 인자 타입을 바꾼 판이다. Windows는 설치한 앱에서만 정상 표시되고, 개발 실행에서는 macOS는 Terminal, Windows는 PowerShell 이름으로 나온다 |
| `tauri-plugin-global-shortcut` | 2.4.1 | 전역 단축키 | |
| `tauri-plugin-autostart` | 2.7.0 | 로그인 시 시작 | macOS `MacosLauncher::LaunchAgent` |
| `tauri-plugin-window-state` | 2.5.0 | 창 위치·크기 기억 | |
| `tauri-plugin-store` | 2.5.0 | 화면 설정 `settings.json` | 비밀을 넣지 않는다 |
| `tauri-plugin-dialog` | 2.8.2 | 파일 고르기(업로드), 확인 대화 상자 | |
| `tauri-plugin-opener` | 2.7.1 | 외부 링크를 기본 브라우저로 | `https`만 |
| `tauri-plugin-clipboard-manager` | 2.4.2 | ID·진단 정보 복사 | 쓰기만 |
| `tauri-plugin-log` | 2.10.1 | Rust·JS 로그 파일 | 토큰·코드 마스킹 |
| `tauri-plugin-os` | 2.4.0 | 플랫폼 정보 | `app_info`로 대신할 수 있으면 빼도 된다 |
| 쓰지 않음 | | `stronghold`(2026-07 중단 공지, v3에서 빠짐), `shell`, `fs`, `http`, `websocket`, `updater`(APP-D14), `process` | |

#### 3.7.2 Rust 크레이트

| 크레이트 | 버전 | 용도 |
|---|---|---|
| `tokio` | 1.x 최신 | 비동기, 자식 프로세스 |
| `tokio-tungstenite` | 0.30 계열(`tauri-plugin-websocket` 2.5.0이 쓰는 판 [검색]) | WebSocket 클라이언트(`client_async_with_config`로 임의 스트림 위 업그레이드) |
| `rustls` + `tokio-rustls` | 0.23 계열 | TLS. 암호 백엔드는 `ring`(교차 빌드 부담이 작다. `aws-lc-rs`는 Windows MSVC에서 NASM 등이 필요하다 [검색: aws.github.io/aws-lc-rs/requirements/windows.html]) |
| `rustls-platform-verifier` | 최신 | OS 신뢰 저장소로 인증서 검사. `tailscale serve` 인증서는 공개 CA(Let's Encrypt)라 OS 저장소로 충분하다 [지식] |
| `hyper` 1.x + `hyper-util` + `http-body-util` | 최신 | blob HTTP/1.1(`client::conn::http1::handshake`를 임의 스트림 위에서) |
| `keyring-core` 1.0.0 + `apple-native-keyring-store` 1.0.2(feature `keychain`) + `windows-native-keyring-store` 1.1.0 | | 키체인. `keyring` 4.x는 "저장소를 직접 고르는 앱은 keyring-core와 저장소 크레이트를 쓰라"고 안내한다 [검색: docs.rs/keyring/4.2.0] |
| `serde`, `serde_json`, `thiserror`, `ulid`, `tracing` | 최신 | |
| `sha2` | 최신 | blob 캐시 검증 |

#### 3.7.3 웹뷰 쪽 npm 패키지

| 패키지 | 버전 | 용도 | 비고 |
|---|---|---|---|
| `react`, `react-dom` | 18.3.x | | 결정 32 |
| `react-router` | 7.18.4 | 라우팅 | 8.x는 React 19.2.7 이상을 요구한다. 7을 고정한다(7은 계속 패치 중) [검색: npm `version-7` 태그] |
| `@tanstack/react-query` | 5.104.1 | 서버 상태 캐시 | 피어 `react ^18 \|\| ^19` |
| `zustand` | 5.0.15 | UI 상태, 연결 상태 | 피어 `react >=18` |
| `idb` | 8.0.4 | IndexedDB | |
| `ulid` | 3.0.2 | 멱등 키·요청 ID | `monotonicFactory` |
| `react-error-boundary` | 최신 4.x 또는 5.x 중 React 18 피어를 허용하는 판 | 오류 경계 | 설치 때 피어 범위를 확인한다 [가정] |
| `@tauri-apps/plugin-*` | 위 표와 같은 번호 | | |
| `@helm/protocol`, `@helm/client` | 저장소 workspace | 메서드·이벤트·뷰 타입과 TypeBox 스키마, 클라이언트 코어(브라우저 진입점) | 19·06 |
| `@assistant-ui/react` | 0.15.27 | 대화 스레드(21 UI-D11) | 21이 범위 결정. 피어 `react ^18 \|\| ^19` 확인 |
| 개발: `vite` 8.3.4, `vitest` 5.0.3, `@testing-library/react` 16.3.3, `jsdom` 30.1.2, `msw` 3.0.3, `@playwright/test` 1.64.0, `@wdio/tauri-service` 1.5.0 | | 테스트 | Vitest 5는 Node `^22.12 \|\| ^24`, jsdom 30은 Node 22.22.2 이상 또는 24.15 이상을 요구한다 [검색]. 06의 Node 24(`>=24.11.0`)에서는 jsdom 30 때문에 24.15 이상이 필요하다(06에 요구, §5.2) |

### 3.8 연결 관리

#### 3.8.1 연결 프로필 [제안]

- 타입은 §3.4.1의 `ServerProfile`, `Route`다. 파일은 `<app_config_dir>/profiles.json`이고 `{ "schemaVersion": 1, "activeProfileId": string | null, "profiles": ServerProfile[] }` 모양이다. 쓸 때는 임시 파일에 쓰고 이름을 바꾼다.
- 토큰은 이 파일에 없다(§3.10.7).
- 프로필 하나 = 서버(데몬) 하나다. 경로는 1개 이상이고 배열 순서가 시도 순서다. 기본 템플릿 두 개를 `SCR-CONNECT`(03 §3.6)에서 고를 수 있게 한다.

| 템플릿 | 경로 | 기본값 |
|---|---|---|
| "Tailscale (권장)" | `wss` 하나, 그 뒤 `ssh` 하나(선택) | `baseUrl = https://server.tail7ad0b4.ts.net:8448`, SSH `target = server`, `daemonPort = 7841`(17 D17-09: serve 8448 → `tailnet` 127.0.0.1:7840, SSH용 `loopback` 127.0.0.1:7841) |
| "SSH만" | `ssh` 하나 | `target = server`, `daemonPort = 7841`, `hostKeyPolicy = strict` |

- 검증 규칙(Rust `profiles.rs`와 TS 양쪽, 같은 표로 테스트):
  - `displayName` 1~40자.
  - `baseUrl`은 `https:` 스킴, 경로·쿼리·조각 없음, 사용자 정보 없음. 개발 빌드(`cfg(debug_assertions)`)에서만 `http://127.0.0.1:<포트>`를 허용한다.
  - `target`은 1~255자, 공백·제어 문자 없음, `-`로 시작하지 않음, `user:pass@` 형식 금지(S4 paseo `ssh-transport.ts:17-35`의 규칙과 같다).
  - `port`, `daemonPort`는 1~65535 정수.
  - `identityFile`, `sshPath`는 절대 경로이고 파일이 있어야 한다.
  - `helmCliPath`는 공백이 없는 절대 경로 또는 `helm`.
  - 경로 ID는 프로필 안에서 유일하고, 활성 경로가 하나 이상 있어야 한다.

#### 3.8.2 SSH 구현 방식 비교와 선택 [제안, ADR 후보 ADR-20-02]

| 기준 | A. 시스템 ssh `-W 127.0.0.1:<포트>` (채택) | B. 시스템 ssh `-N -L <로컬>:127.0.0.1:<포트>` | C. 시스템 ssh exec + 서버 쪽 stdio 브리지 | D. Rust `russh` 0.64 (direct-tcpip) | E. Rust `ssh2`(libssh2) |
|---|---|---|---|---|---|
| 사용자 SSH 설정(별칭 `server`, 키, 에이전트, known_hosts, ProxyJump) | 그대로 씀 | 그대로 씀 | 그대로 씀 | 직접 구현. `russh`에 ssh_config 파서가 없다 [검색] | 직접 구현 |
| macOS Keychain 에이전트·1Password 에이전트 | 그대로 | 그대로 | 그대로 | `SSH_AUTH_SOCK` 지원 [검색] | 일부 |
| Windows | `ssh.exe`가 `-W` 지원. Paseo가 Windows에서 이 방식을 쓴다 [검색] | 지원 | 지원 | 명명된 파이프 에이전트 지원 [검색] | ed25519 문제 보고, OpenSSL 빌드 부담 [검색] |
| 로컬에 열리는 포트 | 없음 | 있음(같은 기기의 다른 프로세스가 붙을 수 있음, 포트 경합) | 없음 | 없음 | 없음 |
| 서버 쪽 추가 구성 | 없음(sshd 기본 포워딩) | 없음 | `helm bridge --stdio` 명령, PATH, 셸 시작 잡음 처리(pi-env의 동기화 줄 기법, facts-2 §8) | 없음 | 없음 |
| 데몬이 받는 바이트 | WSS 경로와 같은 WebSocket | 같음 | 브리지가 다시 WebSocket으로 바꿈(번역 계층 하나 더) | 같음 | 같음 |
| Rust 코드 양 | 작음(자식 프로세스 + 스트림) | 작음 + 포트 감시 | 작음 + 서버 쪽 브리지 | 큼(호스트 키, 에이전트, 설정, 키 형식) | 큼 |
| 실패 진단 | stderr 분류(§3.8.3) | stderr + 포트 대기 | stderr + 브리지 오류 | 타입 있는 오류 | 타입 있는 오류 |
| 연결당 비용 | 전송마다 SSH 핸드셰이크 1회 | 터널 1개에 여러 연결 | 전송마다 1회 | 세션 하나에 채널 여러 개 | 같음 |
| 선례 | Paseo 데스크톱(`packages/protocol/src/ssh-transport.ts:63-82`) | OpenClaw macOS(`RemotePortTunnel.swift:298-312`) | Zed 원격 개발(`proxy` 모드), pi-env | — | — |

선택 A의 근거:

1. 제품 소유자의 Mac에는 dotfiles가 관리하는 별칭 `server`(WSL OpenSSH, 키 인증)가 이미 있다(§2.2). 시스템 ssh를 쓰면 앱이 SSH 설정을 따로 갖지 않는다.
2. 데몬은 두 경로에서 같은 WebSocket 업그레이드를 받는다. 결정 38의 "두 방식에서 프로토콜 메시지와 재전송 의미가 같아야 한다"를 서버 쪽 번역 없이 지킨다.
3. 로컬 포트를 열지 않는다. B는 터널 포트에 같은 기기의 아무 프로세스나 붙을 수 있고, 데몬이 보기에는 그 연결도 `127.0.0.1`에서 온다.
4. Windows의 `ssh.exe`는 ControlMaster와 `-f`를 지원하지 않는다 [검색: Win32-OpenSSH Project Scope]. 전송마다 프로세스 하나를 쓰는 A는 이 제약에 걸리지 않는다.
5. Rust 쪽 코드가 작다. 사용자는 React 시니어이고(결정 32), Rust 코드는 적을수록 유지가 쉽다.

A의 비용과 대응: 전송마다 SSH 핸드셰이크를 한다(tailnet 안에서 수백 ms [가정]). 재접속 때만 생기므로 감수한다. blob 요청은 전송과 별도의 `ssh -W` 연결을 최대 2개까지 유지해 재사용한다(§3.8.6).

#### 3.8.3 SSH 실행 세부 [제안]

실행 파일 찾기(`transport/ssh.rs::resolve_ssh`):

| 플랫폼 | 순서 |
|---|---|
| macOS | `route.sshPath` → `/usr/bin/ssh`. GUI 앱은 셸의 PATH를 물려받지 않으므로 PATH 탐색을 하지 않는다 [검색: tauri-apps/fix-path-env-rs README]. OpenClaw도 `/usr/bin/ssh`를 고정으로 쓴다(`RemotePortTunnel.swift:168`) |
| Windows | `route.sshPath` → `%SystemRoot%\System32\OpenSSH\ssh.exe` → PATH의 `ssh.exe`. 없으면 `ssh_missing`. OpenSSH 클라이언트는 Windows 10 1809+의 선택적 기능이고 대부분 설치돼 있으나 공식 문서로 기본 설치를 확인하지 못했다 [검색, 미확인] → 없을 때 설치 안내 문구(설정 > 시스템 > 선택적 기능 > OpenSSH 클라이언트)를 보인다 |

인자(`transport/ssh.rs::build_args`). 순서는 고정이고, 값은 §3.8.1 검증을 통과한 것만 들어간다.

```text
-T
-o BatchMode=yes                 # 비밀번호·호스트 키 질문을 하지 않는다(창이 없는 앱)
-o ConnectTimeout=10
-o ServerAliveInterval=15
-o ServerAliveCountMax=3          # 17 §3.10의 요구와 같은 값
-o ClearAllForwardings=yes       # 사용자 설정의 LocalForward 등을 끈다
-o ExitOnForwardFailure=yes
-o ControlMaster=no -o ControlPath=none -o ControlPersist=no   # 사용자 별칭의 다중화를 끈다(OpenClaw CommandResolver.swift:347-354와 같은 이유: 이 프로세스를 직접 감시)
-o ForwardAgent=no -o ForwardX11=no
-o PermitLocalCommand=no
-o RequestTTY=no
-o RemoteCommand=none
[hostKeyPolicy=strict] -o StrictHostKeyChecking=yes
[port]                 -p <port>
[identityFile]         -o IdentitiesOnly=yes -i <identityFile>
-W 127.0.0.1:<daemonPort>
-- <target>
```

- `hostKeyPolicy = 'openssh'`이면 `StrictHostKeyChecking` 줄을 빼고 사용자 설정을 따른다(OpenClaw `SSHHostKeyPolicy.openssh`와 같다). 기본은 `strict`다. 기기 토큰이 이 연결로 지나가기 때문이다.
- known_hosts는 사용자의 OpenSSH 기본 파일(`~/.ssh/known_hosts`, Windows는 `%USERPROFILE%\.ssh\known_hosts`)을 쓴다. 앱 전용 known_hosts를 두지 않는다. 앱은 known_hosts 파일에 쓰지 않는다. 호스트 키를 모르면(`ssh_host_key_unknown`) 터미널에서 `ssh <target>`으로 한 번 접속해 지문을 확인하라고 안내하고, 지문 확인용으로 `ssh-keyscan` 결과가 아니라 서버의 `helm doctor` 출력과 대조하게 한다(17에 요구).
- 비밀번호가 걸린 키는 에이전트에 올려 둔 것만 쓸 수 있다(BatchMode). macOS는 `ssh-add --apple-use-keychain`, Windows는 `ssh-agent` 서비스(기본 꺼짐, 관리자 권한으로 켬 [검색: VS Code 원격 문제 해결 문서])를 안내한다.
- 환경 변수: 앱 프로세스의 환경을 그대로 넘긴다(`SSH_AUTH_SOCK` 포함). macOS의 launchd는 GUI 앱에도 `SSH_AUTH_SOCK`를 준다 [지식].
- Windows에서는 `CREATE_NO_WINDOW`(0x08000000) 플래그로 콘솔 창을 띄우지 않는다 [검색: 셸 플러그인이 같은 플래그를 쓴다는 소스 확인].
- 자식 프로세스의 stdin/stdout은 Rust가 바이트 스트림으로 쓰고, stderr는 마지막 8 KiB만 링 버퍼에 남긴다. 전송을 닫으면 stdin을 닫고 2초 기다린 뒤 종료시킨다. 앱이 끝날 때 모든 ssh 자식을 종료시킨다(`RunEvent::Exit`).
- macOS 26.3 이후의 OpenSSH는 양자 내성 KEX가 아니면 stderr에 경고를 낸다 [검색: eclecticlight.co 2026-02-11]. 분류기는 경고 줄을 실패로 보지 않는다(종료 코드를 먼저 본다).

실패 분류(`transport/ssh.rs::classify`). ssh가 0이 아닌 코드(대개 255)로 끝나거나, 업그레이드 응답 전에 스트림이 닫히면 stderr를 아래 순서로 본다.

| stderr에 있는 문자열(대소문자 무시) | 분류 |
|---|---|
| `REMOTE HOST IDENTIFICATION HAS CHANGED`, `Host key for … has changed` | `ssh_host_key_changed` |
| `Host key verification failed`, `No … host key is known` | `ssh_host_key_unknown` |
| `Permission denied (publickey`, `Too many authentication failures` | `ssh_auth_failed` |
| `open failed: connect failed`, `channel 0: open failed` | `daemon_unreachable` (sshd는 됐지만 데몬 포트가 닫힘) |
| `administratively prohibited` | `ssh_failed` + detail "서버가 포워딩을 막음"(AS-4) |
| `Could not resolve hostname`, `Connection timed out`, `No route to host`, `Network is unreachable`, `Connection refused`(22번), `Operation timed out` | `network_unreachable` |
| 실행 파일 실행 실패(OS 오류) | `ssh_missing` |
| 그 밖 | `ssh_failed` |

이 문자열은 OpenSSH 업스트림 메시지이고 Windows 판도 같은 코드에서 나온다 [가정]. 분류 표는 단위 테스트의 표본 stderr(macOS, Windows, Ubuntu에서 실제로 모은 것)로 고정한다(§6).

#### 3.8.4 WSS 실행 세부 [제안, 경로·헤더는 19 §3.2.2]

- URL: `wss://<baseUrl의 host:port>/rpc`. `/rpc`와 파일 경로(§3.8.6), `/pair`는 19 §3.2.5가 정한다. Rust는 경로 문자열을 `@helm/protocol`의 `paths.json`에서 빌드 때 생성한 상수로 받는다(TS와 값이 둘로 나뉘지 않게 한 원본에서 읽는다).
- TLS: rustls + `rustls-platform-verifier`. 인증서 고정은 하지 않는다(`tailscale serve` 인증서는 갱신된다).
- 업그레이드 요청 헤더: `Sec-WebSocket-Protocol: helm-jsonrpc`, `Authorization: Bearer <기기 토큰>`(19 P-03), `User-Agent: helm-desktop/<appVersion> (<platform>)`. `Origin` 헤더는 보내지 않는다(네이티브 클라이언트). 클라이언트 종류·버전은 `hello.client`로 보내므로(19 §3.4.3) `x-helm-client` 헤더는 두지 않는다. `permessage-deflate`를 협상하지 않는다(19 §3.2.3).
- Tailscale 신원 헤더는 `tailscale serve`가 붙인다. 앱은 관여하지 않는다(결정 26).
- 업그레이드 응답 분류: 101 → 열림. 401·403 → `http_unauthorized`(19: 인증 계열, 자동 재접속 중지). 429 → `http_status` + `Retry-After`를 재시도 하한으로. 502·503·504 → `daemon_unreachable`(serve는 떠 있으나 데몬이 꺼짐). 그 밖 → `http_status`. TCP·DNS 실패와 시간 초과(10초) → `network_unreachable`, TLS 실패 → `tls_error`.

SSH 경로에서도 같은 HTTP 업그레이드를 `ssh -W 127.0.0.1:<HELM_LOOPBACK_PORT>`의 표준 입출력 위에서 보낸다. 이때 `Host` 헤더는 `127.0.0.1:<HELM_LOOPBACK_PORT>`다(19 §3.2.3). `SshRoute.daemonPort`가 이 `HELM_LOOPBACK_PORT`이고, WSS의 serve 대상 포트(`HELM_SERVE_PORT`)와 다른 포트다(19 P-01, 값은 17).

#### 3.8.5 전송 계약 (Rust ↔ TS) [제안]

1. 프레임: 텍스트 메시지 하나 = JSON-RPC 메시지 하나(결정 31, 19 §3.3.1). 조각난(fragmented) 메시지는 Rust가 합쳐서 넘긴다. 바이너리 메시지를 받으면 close 1003으로 닫고 `protocol_violation`을 보낸다. 클라이언트 프레임 마스킹은 tungstenite가 한다(SSH 위에서도 생략하지 않는다, 19 §3.2.3).
2. 크기: 받는 메시지 상한은 16 MiB로 둔다. 데몬의 `policy.maxOutboundMessageBytes`(기본 4 MiB)보다 넉넉하다. 보내는 쪽 상한(`policy.maxInboundMessageBytes`, 기본 1 MiB)은 TS가 검사한다.
3. 순서: Rust는 받은 순서대로 채널에 넣고, TS가 보낸 순서대로 소켓에 쓴다.
4. 생존 확인: 데몬이 WebSocket ping을 보내면 tungstenite가 자동으로 pong을 보낸다. 앱 수준 생존 확인은 TS가 19의 `tick` 알림으로 한다(감시 타이머 = hello 응답의 `policy.clientTimeoutMs`, 기본 35초. 넘으면 TS가 `transport_close(code 4000)`). Rust는 따로 ping을 보내지 않는다. 웹뷰는 WebSocket ping을 볼 수 없으므로 `tick`을 쓰는 19 P-12와 같은 이유다.
5. 닫기: TS가 `transport_close({ transportId, code })`로 닫으면(코드 1000 또는 4000) Rust가 close 프레임을 보내고 2초 뒤 소켓을 끊는다. 데몬이 닫으면 `remote_close`와 close 코드(`wsCode`)를 보낸다. 어떤 경우든 `closed` 이벤트는 정확히 한 번 간다. 그 뒤 같은 `transportId`로 온 `transport_send`는 `not_found`다.
6. 송신 대기: Rust 쪽 송신 대기가 4 MiB를 넘으면 전송을 닫는다(`protocol_violation`, detail "send backlog"). facts-2 §6.1의 `maxPendingBytes`와 같은 생각이다.
7. 인증 프레임 주입(AS-3이 틀릴 때만 쓰는 대안): 19가 토큰을 `hello` 인자로 받기로 바꾸면, TS는 `hello`의 토큰 자리에 문자열 `"$DEVICE_TOKEN"`을 넣어 보내고, Rust는 그 전송의 **첫 클라이언트 메시지**에서만 이 자리 표시를 토큰으로 바꾼다. 19 P-03이 헤더 방식을 택했으므로 지금은 쓰지 않는다.

#### 3.8.6 대용량 파일(blob) [제안, HTTP 규약은 19 §3.11]

결정 31의 "큰 데이터는 HTTP"를 앱 쪽에서 구현한다. 웹뷰는 HTTP를 직접 하지 않는다. 데몬의 다운로드 티켓(`/files/t/<ticket>`)은 "헤더를 붙일 수 없는 곳"용이라(19 P-13) 데스크톱은 쓰지 않는다. Rust가 기기 토큰 헤더를 붙인다.

- 읽기 URL: `helm-blob://localhost/<profileId>/<blobId>`(macOS), `http://helm-blob.localhost/<profileId>/<blobId>`(Windows). TS는 `blobUrl(profileId, blobId)` 함수 하나로 만든다. 뷰 데이터에는 `BlobRef`만 들어 있다(19 §3.7.4 `stimulusRound`).
- Rust 처리(`register_asynchronous_uri_scheme_protocol("helm-blob", …)`):
  1. 경로 검증(프로필 존재, `blobId` 형식은 19의 패턴).
  2. 디스크 캐시(`<app_cache_dir>/blobs/<profileId>/<blobId 앞 2자>/<blobId>`)에 있으면 바로 돌려준다. blob은 한 번 정해지면 내용이 바뀌지 않는다고 본다(19에 요구, §5.2).
  3. 없으면 현재 활성 경로로 `GET /files/b/<blobId>`를 보낸다. WSS 경로는 같은 호스트·포트의 HTTPS, SSH 경로는 `ssh -W 127.0.0.1:<HELM_LOOPBACK_PORT>` 스트림 위의 HTTP/1.1(`hyper::client::conn::http1`). SSH 쪽 keep-alive 연결은 최대 2개, 60초 동안 재사용한다. 19 §3.2.3의 "요청마다 `ssh -W` 하나"보다 연결을 아낀다.
  4. 응답에 내용 해시(19가 정하는 `ETag` 또는 digest)가 있으면 받은 바이트와 맞을 때만 캐시에 쓴다.
  5. 연결이 없으면 503을 돌려주고, 화면(21의 이미지 컴포넌트)은 "연결되면 보입니다" 자리 표시를 그린다.
- 캐시 상한 1 GiB, 넘으면 마지막 접근이 오래된 것부터 지운다. 한 blob은 데몬 정책 `policy.files.maxBlobBytes`(기본 64 MiB)를 넘지 않는다. 화면에 필요한 경우가 생길 때까지 `Range` 요청은 쓰지 않는다.
- 업로드: `blob_upload`(바이트)와 `blob_upload_path`(대화 상자 경로). 크기가 `policy.files.singleUploadMaxBytes`(기본 8 MiB) 이하면 `POST /files/u` 한 번, 넘으면 19 §3.11.3의 청크 이어 올리기(`POST`로 시작 → `PATCH` 반복, 끊기면 `HEAD`로 받은 바이트 수를 보고 이어 감). 정책 값은 TS가 hello 응답에서 읽어 명령 인자(`limits`)로 넘긴다. 응답의 `blobId`를 담은 `BlobRef`를 돌려주고 같은 내용을 캐시에도 넣는다.
- 웹뷰 JSON-RPC로 base64를 보내지 않는다(openclaw의 25 MiB 프레임 문제, pi-cases-notes §11.1).

#### 3.8.7 인증과 페어링 [제안, 18과 맞출 것]

| 항목 | 설계 |
|---|---|
| 기기 토큰 | 페어링 때 데몬이 발급한 bearer 토큰 하나. Rust가 OS 키체인에 저장하고 업그레이드 헤더·HTTP 요청에만 쓴다. 웹뷰는 값을 모른다. 웹뷰는 `deviceId`만 안다(`hello.auth.deviceId`에 넣는다, 19 §3.4.3) |
| 두 경로의 인증 | 둘 다 기기 토큰을 보낸다(APP-D04, 19 P-03). WSS 경로는 여기에 Tailscale 신원 조건이 더해진다(`tailnet` 리스너). SSH 경로는 SSH 키가 전송을 인증하고, 데몬의 `loopback` 리스너는 토큰으로 기기를 안다. "loopback에서 왔다"는 사실을 신뢰 근거로 쓰지 않는다(pi-cases-notes §12.2-8, 19 §3.2.1) |
| 페어링 1: 코드 | 이미 연결된 기기의 `SCR-CONNECT`가 `device.createPairingCode`(19 §3.7.7)로, 또는 서버에서 관리 CLI가 1회용 코드와 링크 `helm://pair?v=1&url=<baseUrl>&code=<코드>&sid=<serverId>`를 만든다. 사용자가 링크를 열거나 코드를 붙여 넣으면 Rust가 `POST <baseUrl>/pair`에 코드와 기기 정보를 보내고 `{ serverId, deviceId, deviceToken }`을 받아 바로 키체인에 넣는다(본문 형식은 19 §3.7.7·18). 웹뷰에는 `PairingResult{serverId, deviceId}`만 돌려준다 |
| 페어링 2: SSH 발급 | SSH 경로가 있는 프로필에서 쓴다. Rust가 `ssh <§3.8.3 공통 옵션, -W 없이> -- <target> <helmCliPath> device issue --json --name <deviceName> --platform <platform> --client desktop`을 실행한다(명령은 17 §3.15). CLI는 WSL 안에서 `local` 리스너에 `localAdmin`으로 붙어 `admin.issueDevice`(19 §3.7.8)를 부르고, 셸 시작 잡음과 섞이지 않게 `HELM-DEVICE/1 ` 접두어가 붙은 한 줄 JSON `{serverId, deviceId, deviceToken}`을 stdout에 쓴다. Rust는 그 줄만 읽는다(pi-env의 `PI-ENV <token>` 동기화 줄 기법, facts-2 §8, 19 §3.2.3 예비 경로의 `HELM-BRIDGE/1`과 같은 꼴). SSH 키로 서버 계정에 들어올 수 있으면 기기 발급 권한이 있다고 본다(18이 확정) |
| `serverId` 고정 | 첫 페어링에서 받은 `serverId`를 프로필에 고정한다. 연결할 때마다 `hello.challenge.serverId`를 비교하고 다르면 `hello`를 보내지 않고 `blocked(wrong_server)`로 멈춘다(19 §3.4.2). 개발용 데몬과 실제 데몬을 헷갈려 캐시가 섞이는 것을 막는다 |
| 토큰 폐기 | 폐기는 `device.revoke`(19)로 하고, 이 기기의 토큰은 `credential_forget`으로 지운다. 업그레이드 401·403 또는 `hello` 오류 1004·1005·1006이면 `blocked(needs_pairing)`이 되고 다시 페어링한다 |
| 토큰 교체 | 19의 `device.rotateToken`이 새 토큰을 JSON-RPC 결과로 돌려주면 토큰이 웹뷰를 지난다. 데스크톱은 이 메서드를 TS에서 부르지 않는다. 교체가 필요하면 18·19가 HTTP 경로(예: `POST /devices/self/rotate`, 현재 토큰으로 인증)를 두고 Rust 명령 `credential_rotate`가 부른다(§5.2 요구). 1차는 교체하지 않는다(happy-agent도 토큰을 회전하지 않는다, pi-cases-notes §12.1-7) |
| 기기 키 서명 | 19 `hello.challenge.proofRequired`가 참이면 `hello.auth.proof`가 필요하다(19 §3.4.3, 1차 기본 false). 18이 채택하면 Rust가 Ed25519 개인 키를 키체인에 두고 명령 `device_sign_challenge({ profileId, nonce, serverId, signedAt }) → { signature }`가 서명만 돌려준다. 개인 키는 웹뷰로 나가지 않는다(§7 Q-04) |

#### 3.8.8 연결 상태 기계 [제안]

canon-2 §3.16의 네 상태 기계(에이전트 루프, WorkUnit, 연결, 투영 신선도) 중 연결 상태다. 투영 신선도는 §3.9.8에서 따로 둔다. 하나의 status로 합치지 않는다(canon-2 체크리스트 20).

19의 클라이언트 코어(19 §1.1-1·3: 전송 독립 연결 관리, hello, 구독 복원, 뷰 무효화, 진행 중 명령 재전송)는 전송 **하나** 위의 세션을 다룬다. 이 절의 상태 기계는 그 바깥에서 경로 선택, 재시도 간격, 차단 사유, OS 네트워크·잠자기 신호를 다룬다. 세션 안쪽의 단계(챌린지 대기, hello, 재전송)는 코어가 알려 주는 사건(`SESSION_*`)으로만 받는다. 19 코어의 API가 확정되면 사건 이름을 맞춘다(§5.2).

```ts
// apps/desktop/src/connection/machine.ts
export type BlockedReason =
  | 'needs_pairing'          // 토큰 없음, HTTP 401/403, hello 오류 1004·1005·1006, close 4009(폐기)
  | 'auth_rejected'          // hello 오류 1008(리스너·Tailscale 신원 조건 불일치)
  | 'ssh_auth_failed' | 'ssh_host_key_unknown' | 'ssh_host_key_changed' | 'ssh_missing'
  | 'incompatible_version'   // hello 오류 1003
  | 'wrong_server'           // hello.challenge.serverId ≠ 프로필 serverId
  | 'protocol_error'         // close 1002·1003, 오류 3003·3006(버그 신호)
  | 'keychain_denied'
  | 'no_routes';

export type ConnState =
  | { kind: 'idle' }
  | { kind: 'connecting'; routeIndex: number; attempt: number; transportId?: string }
  | { kind: 'handshaking'; routeIndex: number; transportId: string }   // 챌린지 대기 + hello
  | { kind: 'syncing'; routeIndex: number; transportId: string }       // 구독 복원·재전송 중(caughtUp 전)
  | { kind: 'live'; routeIndex: number; transportId: string; since: number; degraded: boolean }
  | { kind: 'backoff'; attempt: number; nextAt: number; lastFailure: RoundFailure }
  | { kind: 'offline'; since: number }
  | { kind: 'blocked'; reason: BlockedReason; detail?: string; routeId?: string };

export interface RoundFailure { perRoute: Array<{ routeId: string; reason: TransportCloseReason | SessionFailure; detail?: string }> }

export type SessionFailure =
  | { code: number; kind: string; retryAfterMs?: number }   // 19 §3.3.4의 오류(hello 단계)
  | { wsCode: number };                                     // 19 §3.2.6의 닫는 코드

export type ConnEvent =
  | { type: 'START' } | { type: 'STOP' } | { type: 'USER_RETRY' } | { type: 'PROFILE_CHANGED' }
  | { type: 'TRANSPORT_OPENED'; transportId: string }
  | { type: 'TRANSPORT_CLOSED'; transportId: string; reason: TransportCloseReason; wsCode?: number; detail?: string }
  | { type: 'SESSION_READY' }                                   // hello 성공(코어)
  | { type: 'SESSION_REJECTED'; failure: SessionFailure }      // hello 오류 또는 serverId 불일치(코어)
  | { type: 'SESSION_CAUGHT_UP' }                              // 이벤트 구독 caughtUp(19 §3.5.3)
  | { type: 'SESSION_SHUTDOWN_NOTICE'; restartExpectedMs: number }  // server.shutdown 알림
  | { type: 'TICK_LATE' } | { type: 'TICK_OK' } | { type: 'TICK_TIMEOUT' }
  | { type: 'PROBE'; cause: 'focus' | 'wake' | 'manual' } | { type: 'PROBE_FAILED' }
  | { type: 'RETRY_TIMER' }
  | { type: 'NET_OFFLINE' } | { type: 'NET_ONLINE' };

export function reduce(s: ConnState, e: ConnEvent, ctx: ConnContext): { state: ConnState; effects: ConnEffect[] };
```

`reduce`는 순수 함수다. 부수 효과는 `ConnEffect`(`openTransport(routeIndex)`, `closeTransport(id, code)`, `startSession(transportId)`, `scheduleRetry(ms)`, `notifyBlocked`)로 돌려주고 `connection/runner.ts`가 실행한다. 상태 기계를 시간·IPC 없이 표 형식으로 시험한다.

분류:

- 네트워크 계열(다음 경로·재시도 대상): `network_unreachable`, `daemon_unreachable`, `tls_error`, `http_status`, `remote_close`(아래 닫는 코드 표의 "재시도"), `ssh_failed`, `ping_timeout`.
- 차단 계열(사람이 할 일이 있음): `http_unauthorized`, `credential_missing`, `keychain_denied`, `ssh_auth_failed`, `ssh_host_key_unknown`, `ssh_host_key_changed`, `ssh_missing`, 그리고 hello 오류 1003·1004·1005·1006·1008.
- hello 단계의 재시도 오류: 1007(`auth.challengeStale`) → 즉시 한 번 다시 연결. 1011(`rateLimited`)·5001(`daemon.draining`)·5002 → `retryAfterMs`를 하한으로 재시도.

데몬이 닫을 때의 코드(19 §3.2.6) 처리:

| `wsCode` | 처리 |
|---|---|
| 1000, 1009, 1011, 4001 | 재시도(네트워크 계열) |
| 1001 | 재시도. 첫 대기 = 직전 `server.shutdown`의 `restartExpectedMs`(최대 30초) |
| 1002, 1003 | `blocked(protocol_error)`. 진단 묶음을 권한다 |
| 1008 | 직전 오류 응답의 `kind`로 판단. 없으면 `blocked(protocol_error)` |
| 4008(느린 소비자) | 첫 대기 0으로 바로 재접속, 위치부터 재전송 |
| 4009 | 직전 `connection.closing.kind`가 `auth.revoked`면 `blocked(needs_pairing)`, 아니면 재시도 |

전이 표:

| 상태 | 사건 | 가드 | 다음 상태 | 부수 효과 |
|---|---|---|---|---|
| `idle` | `START` | 활성 경로 있음 | `connecting(0, 0)` | `openTransport(0)` |
| `idle` | `START` | 활성 경로 없음 | `blocked(no_routes)` | |
| `connecting` | `TRANSPORT_OPENED` | | `handshaking` | `startSession`(코어가 `hello.challenge`를 5초 기다리고 `hello`를 보낸다, 19 §3.4.1) |
| `connecting`·`handshaking` | `TRANSPORT_CLOSED` | 네트워크 계열, 또는 SSH 경로의 SSH 차단 계열이고 다음 활성 경로 있음 | `connecting(i+1, attempt)` | 실패를 라운드 기록에 더함, `openTransport(i+1)` |
| `connecting`·`handshaking` | `TRANSPORT_CLOSED` | `http_unauthorized`, `credential_missing`, `keychain_denied` | `blocked(needs_pairing \| keychain_denied)` | 다른 경로를 시도하지 않는다(토큰은 서버당 하나) |
| `connecting`·`handshaking` | `TRANSPORT_CLOSED` | 마지막 경로, 라운드에 차단 계열 실패가 있음 | `blocked(첫 경로부터 본 첫 차단 사유)` | `notifyBlocked` |
| `connecting`·`handshaking` | `TRANSPORT_CLOSED` | 마지막 경로, 모두 네트워크 계열 | `backoff(attempt+1)` | `scheduleRetry(max(delay(attempt), retryAfterMs))` |
| `handshaking` | `SESSION_READY` | | `syncing` | 코어가 구독을 복원한다(§3.9.6) |
| `handshaking` | `SESSION_REJECTED` | 차단 계열(1003, 1004~1006, 1008, `wrong_server`) | `blocked(…)` | `closeTransport(1000)`. 캐시는 읽기 전용으로 계속 보인다 |
| `handshaking` | `SESSION_REJECTED` | 재시도 오류(1007, 1011, 5001, 5002) | `backoff(attempt)` | `closeTransport(1000)`, `scheduleRetry(max(retryAfterMs, 0))` |
| `syncing` | `SESSION_CAUGHT_UP` | | `live(degraded=false)` | attempt를 0으로 |
| `syncing`·`live` | `TRANSPORT_CLOSED` | 재시도 대상 | `connecting(0, 0)` | 처음 경로부터. 첫 대기 0.5초(4008이면 0, 1001이면 `restartExpectedMs`) |
| `syncing`·`live` | `TRANSPORT_CLOSED` | 차단 계열 | `blocked(…)` | |
| `live` | `TICK_LATE` | 마지막 수신이 `tickIntervalMs × 1.5`를 넘음 | `live(degraded=true)` | 상단 막대에 "연결 느림"(05 `err.connection.slow`) |
| `live` | `TICK_OK` | | `live(degraded=false)` | |
| `syncing`·`live` | `TICK_TIMEOUT` | 마지막 수신이 `clientTimeoutMs`를 넘음 | `connecting(0, 0)` | `closeTransport(4000)` 뒤 바로 다시 연결 |
| `live` | `PROBE` | 마지막 수신이 10초 넘음 | `live` | 19 `ping`을 보내고 3초 기다림(Paseo의 포그라운드 3초 프로브, S4 paseo §7) |
| `live` | `PROBE_FAILED` | | `connecting(0, 0)` | `closeTransport(4000)` 뒤 바로 다시 연결 |
| 어느 상태든 | `SESSION_SHUTDOWN_NOTICE` | | 같은 상태 | 다음 재시도의 첫 대기를 `restartExpectedMs`(최대 30초)로 기억 |
| `backoff` | `RETRY_TIMER`·`USER_RETRY`·`NET_ONLINE` | | `connecting(0, attempt)` | `openTransport(0)` |
| 어느 상태든(`blocked` 제외) | `NET_OFFLINE` | | `offline` | 열린 전송을 닫는다 |
| `offline` | `NET_ONLINE`·`USER_RETRY`, 또는 30초 경과 | | `connecting(0, 0)` | `navigator.onLine`이 틀린 경우를 대비해 30초마다 한 번 시도 |
| `blocked` | `PROFILE_CHANGED`(재페어링, 호스트 키 신뢰, 경로 수정)·`USER_RETRY` | | `connecting(0, 0)` | |
| 어느 상태든 | `STOP` | | `idle` | 전송 닫기, 재시도 취소 |

재시도 간격 `delay(attempt) = min(30s, 0.5s × 2^attempt) × U(0.8, 1.2)` → 0.5, 1, 2, 4, 8, 16, 30, 30… 초. OpenClaw(초기 1초, 최대 30초, S4 openclaw-gateway §1.5)와 pi-web(500ms × 1.6, 최대 5초, S4 pi-web §3)의 중간이다. 인증 오류에서 자동 재시도를 멈추는 규칙은 OpenClaw `reconnect-policy.ts:7-56`과 같다. 19가 백오프 값을 정하면(19 §1.2 "재접속 백오프") 그 값을 쓴다.

`PROBE`를 보내는 때: 창이 포커스를 얻을 때(`app://window` `focused`), 시스템이 잠자기에서 깨어났다고 볼 때(5초 간격 타이머가 벽시계 기준 20초 넘게 밀리면 `wake`로 본다. Tauri에는 데스크톱 전원 이벤트가 없어 타이머 간격으로 판단한다 [가정]), 사용자가 연결 표시를 눌렀을 때. 주기적으로는 보내지 않는다(19 §3.7.2).

#### 3.8.9 연결 상태의 표시 [제안, 사용자용 상태와 문구는 04 §3.0.4]

04 §3.0.4가 정한 사용자용 상태 열 가지를 이 문서의 연결 상태와 신선도(§3.9.8)로 판정한다(04 §5.2의 20 요구).

| 04 사용자용 상태 | 판정(이 문서) | 결정 동작 |
|---|---|---|
| 연결됨 | `live(degraded=false)`, 데몬 모드 `normal` | 가능 |
| 느림 | `live(degraded=true)`(tick이 `tickIntervalMs × 1.5`를 넘게 늦음) | 가능 |
| 다시 연결하는 중 | `connecting`·`handshaking`·`backoff`이고 마지막 `live`에서 끊긴 지 2분 이내, 또는 재시도 6회 이내 | 막음, 초안 보존 |
| 연결 안 됨 | `backoff`가 위 조건을 넘음, 또는 `offline` | 막음 |
| 데몬 응답 없음 | 마지막 라운드의 모든 경로 실패가 `daemon_unreachable`(serve 502~504, SSH `open failed`). 단 `server.shutdown`을 받은 뒤 `restartExpectedMs` 안이면 "데몬 재시작 중"으로 보이고 오류로 보이지 않는다(17 §5.2의 20 요구) | 막음 |
| 인증 실패 | `blocked(needs_pairing \| auth_rejected \| keychain_denied)` | 막음 |
| 버전 불일치 | `blocked(incompatible_version)` | 막음. 캐시 읽기는 된다 |
| 복구 모드 | `live`이고 데몬 모드가 `readOnly` 또는 `safeMode`. 모드는 hello `server.mode`로 받고 `server.modeChanged`·`tick.mode`로 갱신한다(19 §3.8.1, 17 §3.4.1) | 막음(읽기만) |
| 다시 맞추는 중 | `syncing`, 또는 열린 뷰의 서버 신선도가 `rebuilding` | 막음(짧음) |
| 뷰 낡음 | 열린 뷰의 신선도가 `stale`(§3.9.8) | 그 화면만 막음 |

- SSH 관련 차단(`ssh_auth_failed`, `ssh_host_key_unknown`, `ssh_host_key_changed`, `ssh_missing`)과 `wrong_server`, `protocol_error`는 04 표에 없는 앱 쪽 사유다. 사용자용 상태는 "연결 안 됨"으로 보이고, 배너와 `SCR-CONNECT`의 점검 단계 2(서버 경로)에서 사유별 할 일을 보인다: `ssh_host_key_unknown` → 터미널에서 `ssh <target>`으로 한 번 접속해 지문 확인, `ssh_host_key_changed` → 경고(자동 해결 없음), `ssh_auth_failed` → 에이전트·키 안내, `ssh_missing` → OpenSSH 설치 안내, `wrong_server` → 프로필 확인, `protocol_error` → 진단 묶음.
- 데몬이 다시 시작된 것(`bootId` 변화)은 상태가 아니라 한 번 보이는 알림 띠다(§3.9.6-2).
- 문구는 05 §3.11, 04 §3.0.4가 정본이다.

#### 3.8.10 여러 경로의 선택 [제안, ADR 후보 ADR-20-03]

- 순서대로 시도한다(`routePolicy = 'ordered'`). 동시에 여러 경로를 시도하지 않는다. 두 경로 모두 tailnet을 지나므로 동시 시도로 얻는 시간보다 SSH 인증 로그와 서버 부하가 늘어난다.
- 다음 경로로 넘어가는 실패: 네트워크 계열과 SSH 경로의 차단 계열(그 SSH 경로만의 문제다). 넘어가지 않는 실패: 토큰 계열(`needs_pairing`), 버전 불일치, `wrong_server`. 이것들은 경로를 바꿔도 같다.
- 연결된 뒤에는 경로를 바꾸지 않는다. 다음에 끊기면 첫 경로부터 다시 시도한다. 첫 경로가 계속 실패하는 환경(예: `tailscale serve` 설정 오류)에서는 매 재접속마다 첫 경로 시간 초과(10초)를 기다리게 되므로, 같은 경로가 연속 3라운드 네트워크 계열로 실패하면 30분 동안 그 경로를 뒤로 미룬다. 미룬 사실은 `SCR-CONNECT`에 보인다.
- `pinned`이면 첫 활성 경로만 쓴다.
- 서버 PC 자신에서 도는 Windows 앱도 WSS 경로(자기 tailnet 이름)를 쓴다(AS-5). `ws://127.0.0.1` 직접 경로는 1차에 두지 않는다(§7 Q-05).
- 캐시는 `serverId` 단위라 경로가 바뀌어도 그대로 쓴다.

### 3.9 React 앱 구조

#### 3.9.1 폴더 구조 [제안]

```text
apps/desktop/
  package.json                 # @helm/desktop
  index.html  vite.config.ts  tsconfig.json  vitest.config.ts  playwright.config.ts  wdio.conf.ts
  src/
    main.tsx                   # createRoot(…).render(<StrictMode><App/></StrictMode>)
    app/                       # App.tsx, providers.tsx, boot.ts(초기화 순서, §3.9.6-0)
    navigation/                # screens.ts(화면 ID ↔ 경로, 03 §3.5.5), router.tsx, deeplink.ts, lastRoute.ts
    shell/                     # 03 §3.4 영역의 배치와 데이터 연결(Rail, Topbar, Banner, Inspector, Composer, RunsDrawer)
    screens/<screen>/          # 화면 하나에 폴더 하나: Screen.tsx, useScreenModel.ts(투영 → 뷰 모델), intents.ts(UiIntent → 명령)
    screens/common/            # 04 §3.0의 공통 상태(불러오는 중, 캐시 표시, 빈 상태, 오류, 연결 상태 열 가지) 배치(04 §6)
    intents/                   # CommandIntentBase(멱등 키·basisSeq), UiIntent → useCommand 연결(04 §6 "명령 의도 공통")
    ui/                        # 21 소유: 컴포넌트, 토큰, 스타일. 이 문서는 내용을 정하지 않는다
    connection/                # machine.ts(순수 리듀서), runner.ts(효과 실행), transport.ts(인터페이스), backoff.ts, probe.ts
    sync/                      # session.ts(19 코어 연결, §3.9.6), stores.ts(코어에 넘길 IndexedDB 저장소), views.ts(useView),
                               # liveText.ts(휘발 스트림 반영), commands.ts(useCommand)
    db/                        # idb.ts(스키마·이행), quota.ts
    platform/                  # ipc.ts, types.ts, index.ts(구현 고르기)
      tauri/                   # transport.ts, notifications.ts, tray.ts, badge.ts, shortcuts.ts, autostart.ts, deeplink.ts, settings.ts
      browser/                 # 개발·테스트용 대체 구현(§3.13.3). 배포 빌드에서는 빠진다
    state/                     # zustand: connStore.ts, uiStore.ts, liveTextStore.ts
    copy/                      # 앱이 직접 만드는 문구(연결·OS 알림·트레이). 05와 공유 문구 패키지(03 ADR A9)를 따른다
    errors/                    # 오류 경계, 오류 → 문구 대응
    test/                      # renderWithProviders, 고정 투영 표본, 가짜 데몬 연결 도우미
  src-tauri/
    Cargo.toml  build.rs  tauri.conf.json  capabilities/main.json  icons/
    src/ main.rs  lib.rs  error.rs  profiles.rs  secrets.rs  pairing.rs  blob.rs  http_stream.rs  diag.rs
         transport/{mod,wss,ssh,ws}.rs  os/{tray,badge,window}.rs
    tests/ ssh_classify.rs  profiles_validate.rs  ws_over_stream.rs
  e2e/
    web/                       # Playwright: 브라우저에서 SPA + 가짜 데몬
    shell/                     # WebdriverIO + @wdio/tauri-service: 실제 Tauri 셸 스모크
```

- 의존 방향: `screens → ui, sync, navigation` / `sync → @helm/client(코어), @helm/protocol(타입), db, connection(상태 읽기)` / `connection → platform` / `platform/tauri → @tauri-apps/*`. `ui/`는 `sync`, `platform`, `@helm/client`를 가져오지 않는다(21 UI-D01: 컴포넌트는 표현 전용). ESLint `import/no-restricted-paths`로 검사한다.
- 세션·구독·재전송·뷰 무효화 판정은 코어(`@helm/client`, §3.9.4)가 하고 TUI도 같은 코어를 쓴다(§3.9.4). 앱의 `connection/machine.ts`(경로 선택·차단 사유)와 `sync/stores.ts`(IndexedDB)는 React와 Tauri를 모르는 순수 TS로 쓴다. TUI가 경로 선택을 필요로 하지 않으므로 이 둘은 앱에 둔다.
- `@helm/protocol`(19)에서 메서드 이름, 파라미터·결과 타입, 뷰 이름·데이터 타입, TypeBox 스키마를 가져온다. 앱은 프로토콜 타입을 다시 정의하지 않는다.

#### 3.9.2 라우팅 [제안]

- 라이브러리: `react-router` 7.18.4, `createBrowserRouter`. Tauri의 자산 해석은 없는 경로를 `index.html`로 돌려주므로 브라우저 라우터로 새로 고쳐도 깨지지 않는다 [검색: tauri 2.12.3 `crates/tauri/src/manager/mod.rs` 자산 해석 순서]. 브라우저 대체 실행(§3.13.3)과 같은 코드를 쓴다. 8.x는 React 19 전용이라 쓰지 않는다.
- 데이터 로더·액션(`loader`, `action`)은 쓰지 않는다. 데이터는 화면 안에서 `useView`로 읽는다. 로더는 "이동할 때 읽는다"는 모델이고, Helm 화면은 "이벤트가 오면 다시 읽는다"는 모델이라 맞지 않는다.
- 경로 표는 03 §3.5.5를 그대로 쓴다. `navigation/screens.ts`가 화면 ID(03 §3.6)와 경로를 한곳에 둔다.

```ts
// apps/desktop/src/navigation/screens.ts
export const SCREENS = {
  'SCR-HOME':             { path: '/home' },
  'SCR-BRIEF':            { path: '/brief' },
  'SCR-INBOX':            { path: '/inbox' },
  'SCR-QUESTION':         { path: '/inbox/:qsId' },
  'SCR-AUTO':             { path: '/auto' },
  'SCR-CONCERNS':         { path: '/concerns' },
  'SCR-CONCERN-OVERVIEW': { path: '/concerns/:cnId/overview' },
  'SCR-INQUIRY':          { path: '/concerns/:cnId/inquiry/:kind?' },
  'SCR-STIM':             { path: '/concerns/:cnId/inquiry/want/rounds/:roundNo' },
  'SCR-WORK':             { path: '/concerns/:cnId/work' },
  'SCR-AGREE':            { path: '/concerns/:cnId/work/:wuId/agreement' },
  'SCR-REVIEW':           { path: '/concerns/:cnId/work/:wuId/review' },
  'SCR-LOOPS':            { path: '/concerns/:cnId/history' },
  'SCR-THREAD':           { path: '/concerns/:cnId/thread' },
  'SCR-EVIDENCE':         { path: '/evidence/:recordId' },
  'SCR-GOALS':            { path: '/goals' },
  'SCR-GOAL':             { path: '/goals/:glId' },
  'SCR-DIALS':            { path: '/dials' },             // ?scope=global|goal:<id>|concern:<id>
  'SCR-OBSERVER':         { path: '/observer/:proposalId?' },
  'SCR-CONNECT':          { path: '/connect' },           // ?pair=<인코딩된 페어링 링크>
  'SCR-RECOVERY':         { path: '/recovery' },
  'SCR-SETTINGS':         { path: '/settings/:section?' },
  'SCR-ONBOARD':          { path: '/onboard' },
  'SCR-RECORD':           { path: '/records' },           // ?subject=<id>
} as const satisfies Record<ScreenId, { path: string }>;
export type ScreenId = keyof typeof SCREENS;            // 03의 화면 ID가 바뀌면 여기서 타입 오류가 난다
export function pathFor<S extends ScreenId>(id: S, params: PathParams<S>): string;
```

- `SCR-TRAY`는 웹뷰 화면이 아니다(§3.10.2). `OVL-*`는 경로가 아니라 `uiStore`의 오버레이 상태다.
- 경로 인자는 ID 형식(`^cn_[0-9A-HJKMNP-TV-Z]{26}$` 등, 브리프 §3.2)으로 검사하고, 틀리면 "찾을 수 없음" 상태(04 §3.0.5)를 보인다.
- 모든 화면은 루트 레이아웃(셸) 아래 `lazy` 경로로 둔다. 화면 코드는 처음 열 때 읽는다.
- 시작 경로: (1) 처리할 딥 링크가 있으면 그 경로, (2) 프로필이 없으면 `/onboard`, (3) 마지막 경로(설정의 `lastRoute`), (4) `/home`.
- 최소 창 크기는 760×560(03 §3.4.2)이고 `tauri.conf.json`의 `minWidth`, `minHeight`로 둔다. 기본 크기는 1280×800이다.

#### 3.9.3 상태 관리 [제안, ADR 후보 ADR-20-05]

| 상태 | 둘 곳 | 이유 |
|---|---|---|
| 데몬 뷰(화면 데이터) | TanStack Query 5 캐시 + IndexedDB 영속(§3.9.5) | 요청 중복 제거, 마운트될 때 다시 읽기, 무효화 API, 가비지 수집을 직접 만들지 않는다 |
| 연결 상태 | `connection/machine.ts` 리듀서의 결과를 zustand `connStore`에 | 상태 기계는 순수 함수로 시험하고, 화면은 스토어를 구독한다 |
| 세션 메타(`serverId`, 위치, 정책, 기능 목록) | 19 코어의 세션 객체 + `connStore` 요약 | |
| 휘발 스트림(에이전트 출력 글자) | zustand `liveTextStore` | 정본 로그에 없는 값(pi-cases-notes §12.1-6, 19 §3.5.2). 재접속 때 비우고 `active`로 다시 채운다 |
| 진행 중 명령함 | IndexedDB `outbox` + `useCommand` 훅의 지역 상태 | 재시작해도 남아야 한다 |
| 화면 지역 상태(펼침, 선택, 탭, 입력 초안) | 컴포넌트 상태, 오래 남길 것은 `uiStore`(초안은 IndexedDB `drafts`) | |
| 앱 설정 | `tauri-plugin-store` `settings.json` → 시작 때 `uiStore`로 읽음 | |

TanStack Query 설정:

```ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,          // 신선도는 시간 아니라 이벤트로 판단한다(APP-D01)
      gcTime: 30 * 60_000,
      networkMode: 'always',        // queryFn이 직접 연결 상태를 보고 IndexedDB로 대체한다
      retry: (n, err) => isRetryable(err) && n < 3,            // 19 오류 data.retryable(예: 2006 view.notReady)
      refetchOnWindowFocus: false,  // 포커스 때는 PROBE만 한다(§3.8.8)
      refetchOnReconnect: false,    // 재접속 처리는 §3.9.6이 한다
    },
    mutations: { networkMode: 'always', retry: false }, // 명령은 §3.9.7의 명령함이 맡는다
  },
});
```

기각한 대안: (1) Redux Toolkit + RTK Query — 같은 일을 할 수 있으나 코드가 더 많다. 사용자의 기존 선호는 확인하지 못했다(§7 Q-10). (2) 상태 전부를 zustand 하나에 담기(v0.3 12 §11.1의 안) — 재조회·중복 제거·가비지 수집을 직접 만들어야 한다. (3) 이벤트를 앱에서 접어 상태를 만들기(Chord 식 상태 복제, facts-2 §6.2) — 접는 규칙이 도메인 지식이라 결정 32와 맞지 않는다.

#### 3.9.4 프로토콜 클라이언트: 19의 코어 위에 얹는다 [제안]

19는 전송 독립 클라이언트 코어(연결 하나의 세션: 챌린지·hello, 이벤트 구독과 gap 처리, 뷰 무효화 판정, 진행 중 명령 재전송)를 정한다(19 §1.1-1·3, §3.1). 19는 이 코어를 `@helm/protocol` 안에, 06 §3.4.13은 별도 패키지 `@helm/client`(브라우저 진입점과 `/node` 진입점)에 둔다. 이 문서는 06의 패키지 배치를 따르고 이하 "코어"라고 부른다(두 문서가 2단계에서 한쪽으로 맞춘다, §5.2). 데스크톱 앱은 JSON-RPC를 따로 구현하지 않고 이 코어를 쓴다. TUI도 같은 코어를 쓴다(19 §2.1 결정 33·39 행). 이 문서가 맡는 것은 코어 바깥이다.

| 코어(19)가 하는 일 | 앱(20)이 하는 일 |
|---|---|
| JSON-RPC 요청 ID, 시간 제한, 취소(`$/cancelRequest`), 응답 짝 맞추기, envelope 검사 | `Transport` 구현: `platform/tauri/transport.ts`가 IPC 채널(§3.4)을 코어의 전송 인터페이스로 감싼다. 시험용 `platform/browser/transport.ts`는 브라우저 WebSocket |
| `hello.challenge` 대기, `serverId` 비교, `hello`, 정책·기능 목록 보관 | 기대 `serverId`, `deviceId`, `ClientInfo` 제공. 결과를 연결 상태 기계 사건(`SESSION_*`)으로 바꾸기 |
| `events.subscribe`, `(from, to]` 계약 검사, gap 처리, `2001` 처리 | 위치(`{storeId, seq}`)와 낡음 표시를 IndexedDB에 함께 기록(§3.9.6-4) |
| 뷰 무효화 판정(`dependsOn ∩ invalidates`) | 판정 결과를 TanStack Query 무효화와 IndexedDB 낡음 표시로 연결 |
| `stream.subscribe`, `stream.chunk`의 `n`·`offset` 처리, `run.partial` | 휘발 상태를 `liveTextStore`에 반영, 화면 연결 |
| 진행 중 명령 재전송(같은 `idempotencyKey`) | 진행 중 명령함 저장소(IndexedDB) 구현, 화면 상태(`useCommand`) |
| `tick` 감시 | 감시 결과를 연결 상태 기계에(`TICK_LATE`, `TICK_TIMEOUT`) |
| 오류 객체 해석(`code`, `kind`, `retryable`, `retryAfterMs`) | 오류 → 화면 문구(§3.9.9, 05) |

코어에 기대하는 모양(19 §3.10·§3.14가 확정하면 이름을 맞춘다, §5.2):

```ts
// @helm/client (06 §3.4.13 배치, 의미는 19 소유). 20이 기대하는 최소 표면
export interface Transport {
  send(text: string): Promise<void>;
  onMessage(cb: (text: string) => void): () => void;
  onClose(cb: (info: { wsCode?: number; reason: string }) => void): () => void;
  close(code: 1000 | 4000): Promise<void>;
}
export interface ClientStores {                       // 앱이 구현해 넘긴다
  position: { load(serverId: string): Promise<StreamPosition | null>; save(serverId: string, p: StreamPosition, staleMarks: StaleMark[]): Promise<void> };
  pending: PendingCommandStore;                       // §3.9.7
  views: { list(serverId: string): Promise<CachedViewHead[]>; markStale(serverId: string, marks: StaleMark[]): Promise<void> };
}
export interface StaleMark { viewKey: string; staleSince: number }
export interface CachedViewHead { viewKey: string; asOfSeq: number; dependsOn: string[] }

export interface SessionCore {
  start(t: Transport, o: { expectedServerId: string | null; deviceId: string; client: ClientInfo; stores: ClientStores }): void;
  on(e: 'ready', cb: (r: HelloResult) => void): () => void;
  on(e: 'rejected', cb: (f: SessionFailure) => void): () => void;
  on(e: 'caughtUp', cb: () => void): () => void;
  on(e: 'events', cb: (batch: EventWire[], meta: { replaying: boolean }) => void): () => void;
  on(e: 'viewsStale', cb: (marks: StaleMark[], meta: { replaying: boolean }) => void): () => void;
  on(e: 'outOfRange', cb: (reason: 'storeMismatch' | 'aheadOfHead' | 'beforeOldest' | 'tooFar', head: number) => void): () => void;
  on(e: 'shutdown', cb: (n: { restartExpectedMs: number }) => void): () => void;
  on(e: 'tick', cb: (lateness: 'ok' | 'late' | 'timeout') => void): () => void;
  request<M extends MethodName>(method: M, params: ParamsOf<M>, o?: { timeoutMs?: number; signal?: AbortSignal }): Promise<ResultOf<M>>;
  command<M extends CommandMethod>(method: M, params: Omit<ParamsOf<M>, 'idempotencyKey'>, o: { idempotencyKey: string }): Promise<CommandResult>;
  position(): StreamPosition | null;
  policy(): ConnectionPolicy | null;
  dispose(): void;
}
```

- 코어 사본을 앱에서 고치지 않는다. 필요한 기능이 없으면 19에 요구하고 코어에 더한다.
- 수신 메시지 검사(TypeBox)는 코어가 한다. 실패를 앱은 `ProtocolDataError`로 받는다.

#### 3.9.5 클라이언트 저장소 [제안]

IndexedDB 데이터베이스 `helm-desktop`, 버전 1. `idb` 8로 연다. 모든 키에 `serverId`가 있어 서버별로 나뉜다.

```ts
// apps/desktop/src/db/idb.ts
interface ServerMetaRow {          // store 'meta', key: serverId
  serverId: string;
  position: { storeId: string; seq: number } | null;   // 이벤트 구독 위치(19 StreamPosition)
  lastBootId: string | null;       // 바뀌면 "데몬이 재시작됨"을 한 번 보인다(19 §3.5.1)
  lastHelloAt: string;
  protocol: number;
  serverVersion: string;
  recentDeliveryIds: string[];     // 띄운 OS 알림 ID, 최근 500개(§3.10.1)
}
interface ViewRow {                // store 'views', key: [serverId, view, paramsKey], index: [serverId, viewKey], lastAccessAt
  serverId: string;
  view: string;                    // 19 §3.7.4 뷰 이름
  paramsKey: string;               // params를 키 정렬한 JSON. 연결 없이 캐시를 찾을 때 쓴다
  viewKey: string;                 // 응답의 key(정본, 19). 무효화 판정에 쓴다
  asOfSeq: number;
  dependsOn: string[];
  staleSince: number | null;       // 이 뷰를 낡게 만든 가장 큰 이벤트 seq. null이면 낡지 않음
  freshness: 'current' | 'stale' | 'rebuilding' | 'failed';   // 응답의 freshness(데몬 판정)
  generatedAt: string;
  data: unknown;                   // 뷰 데이터(구조화 복제)
  fetchedAt: number;
  lastAccessAt: number;
  approxBytes: number;
  schemaHash: string;              // hello features.schemaHash. 다르면 버린다
}
interface PendingCommandRow {      // store 'pending', key: idempotencyKey, index: serverId, state
  idempotencyKey: string;          // 'ik_<ULID>'
  serverId: string;
  method: string;
  params: unknown;                 // CommandParamsBase 포함. 토큰·비밀 없음
  createdAt: number;
  state: 'sending' | 'unknown' | 'done' | 'rejected' | 'expired';
  attempts: number;
  result?: CommandResult;
  error?: { code: number; kind: string; message: string; details?: unknown };
}
interface DraftRow {               // store 'drafts', key: [serverId, scopeKey]
  serverId: string; scopeKey: string; text: string; updatedAt: number;
}
```

- 상한: 서버당 뷰 64 MiB. 넘으면 `lastAccessAt`이 오래된 것부터 지운다. 고정 뷰(`home`, `brief`, `inbox`, `autonomous`, `concernTree`, `goals`, `recovery`, `tray`)는 지우지 않는다. 오프라인으로 시작했을 때 이것들은 보여야 한다.
- 저장 위치는 웹뷰가 정한다. Windows는 `%LOCALAPPDATA%\<identifier>\EBWebView` 아래, macOS는 `~/Library/WebKit/<bundle id>/WebsiteData` 아래다 [검색: Windows는 tauri `manager/webview.rs`, macOS는 지식]. origin이 바뀌면(예: Windows `useHttpsScheme` 변경) 다른 데이터베이스가 된다 [검색: tauri `config.rs` 주석]. 그래서 `useHttpsScheme`은 처음 값(`false`)에서 바꾸지 않는다.
- WebKit은 브라우저가 아닌 앱에도 origin별 용량 한도와 자동 삭제 정책을 둔다 [검색: webkit.org/blog/14403]. 자동으로 지워지면 위치가 없으므로 `from: "head"`로 구독하고 열린 뷰를 다시 받는다(§3.9.6-5와 같은 경로). IndexedDB는 캐시이고 정본은 데몬이다.
- 뷰 데이터는 암호화하지 않는다. 기기 디스크 암호화(FileVault, BitLocker)에 맡긴다. 설정 `offlineCopy`를 끄면 `views`에 쓰지 않는다(18이 요구하면 기본값을 바꾼다, §5.2).
- `profile_delete`나 `storeMismatch`이면 그 `serverId`의 `views`·`meta.position`을 지운다. `pending`은 사람이 확인하기 전까지 남긴다.
- IndexedDB 버전을 올릴 때 `views`는 버리고 다시 만든다(캐시이므로 옮기지 않는다). `pending`과 `drafts`만 옮긴다.

#### 3.9.6 동기화 알고리즘 [제안, 프로토콜 규칙은 19 §3.5·§3.6]

사례 8곳 중 데몬 재시작을 넘어 같은 커서로 이벤트를 다시 받는 클라이언트 프로토콜은 없다. happy-agent·paseo·pi-web·openclaw는 클라이언트용 seq를 메모리에 두고, 끊기면 스냅샷으로 다시 맞춘다(pi-cases-notes §1-1, §11.2, §12.2-1). Helm은 SQLite 이벤트 로그의 seq를 그대로 클라이언트 위치로 쓰므로(결정 29·31, 19 P-05) 재시작 뒤에도 위치 재개가 기본 경로이고, 스냅샷 맞추기는 범위를 벗어났을 때만 쓰는 대체 경로다. 사례에서 가져온 것은 순서와 경계다: 구독 먼저·스냅샷 나중(happy-agent `ApiModule.ts:4456-4530`, 19 §3.5.6), 스냅샷의 seq 경계(pi-web `transcript-snapshot`, happy-agent bootstrap), 세대 감지(`storeId`, 19 §3.5.1), "늦은 캐시 읽기가 진전된 상태를 덮지 않음"(paseo `docs/architecture.md:126-140`).

앱 쪽 절차(`sync/session.ts`). 프로토콜 판정은 19 코어가 하고, 앱은 저장과 화면 연결을 한다.

```text
0. 앱 시작(boot):
   a. settings, profiles 읽기 → 활성 프로필
   b. 프로필에 serverId가 있으면 IndexedDB의 고정 뷰를 TanStack 캐시에 넣는다
      (setQueryData, updatedAt = fetchedAt, 신선도는 연결 전이라 'stale')
      → 연결 전에 화면이 마지막 뷰를 읽기 전용으로 그린다
   c. pending의 'sending' 행(보내는 중 앱이 죽음)은 'unknown'으로. policy.pendingCommandMaxAgeMs(마지막으로 받은 값, 없으면 24시간)를 넘은 'unknown'은 'expired'로
   d. 연결 상태 기계 START

1. TRANSPORT_OPENED → core.start(transport, { expectedServerId, deviceId, client, stores })
   코어: hello.challenge 대기(5초) → serverId 비교 → hello{ auth: { method: 'deviceToken', deviceId }, resume: 저장 위치 }

2. ready(HelloResult):
   - bootId가 meta.lastBootId와 다르면 배너 한 번 "데몬이 다시 시작됨"(19 §3.5.1). meta 갱신
   - features.schemaHash가 캐시 행과 다르면 그 행들을 버린다
   - 코어가 events.subscribe({ from: 저장 위치 ?? 'head', filter: {} })를 보낸다(전체 스트림 하나, 19 §3.6.1)
   - 열린 화면의 휘발 스트림 구독(stream.subscribe)을 다시 연다. 응답의 active로 liveTextStore를 채운다
   - 연결 상태 → syncing

3. events(batch, { replaying }):        // 코어가 (from, to] 계약과 gap을 이미 검사했다
   - viewsStale(marks)로 받은 낡음 표시:
       메모리: 캐시된 쿼리의 staleSince 갱신
       replaying이 아니고 그 뷰가 화면에 열려 있으면 → 다시 받기 예약(키마다 150ms 디바운스, minSeq = staleSince)
       replaying이면 → 다시 받기를 caughtUp까지 미룬다(19 §3.6.3)
   - 알림 전달 이벤트(§3.10.1)는 replaying이 아닐 때만 OS 알림으로 띄운다
   - 활동 고리(메모리 500개)에 넣는다. SCR-RECORD는 events.read로 데몬에서 다시 읽는다

4. 위치 기록: 코어가 stores.position.save(serverId, {storeId, seq: to}, staleMarks)를 부른다(1초 디바운스, caughtUp, 전송 닫힘, 창 숨김 때도)
   앱 구현: 한 IndexedDB 트랜잭션(stores: meta, views)에서
     meta.position = {storeId, seq: to}
     staleMarks의 각 뷰 행 staleSince = max(staleSince, mark.staleSince)
   → 위치만 앞서 기록되고 낡음 표시가 빠지는 일이 없다. 앱이 죽어도 다음 시작 때 낡은 캐시를 안다
   (19 §3.5.7은 위치 저장만 말한다. 낡음 표시를 같은 트랜잭션에 넣는 것은 앱 쪽 규칙이다)

5. outOfRange(reason, head):            // 19 §3.5.5
   storeMismatch | aheadOfHead → 이 serverId의 views·position을 모두 지운다(다른 저장소다)
   beforeOldest | tooFar       → views는 남기고 전부 staleSince = asOfSeq + 1, position만 지운다
   코어가 events.subscribe({from: 'head'}) → start = H0
   열린 뷰를 모두 view.get({ minSeq: H0 })로 다시 받는다
   이력형 화면(SCR-RECORD, SCR-LOOPS)은 events.read({ before: H0 + 1 })로 거꾸로 채우고
   그 앞에 "접속하지 않은 동안의 이전 기록은 생략됨"을 보인다

6. caughtUp:
   연결 상태 → live
   staleSince > asOfSeq 인 열린 뷰를 한 번에 다시 받는다(동시에 최대 4개. happy-agent는 3, pi-cases-notes §3.7)
   진행 중 명령 재전송은 코어가 한다(§3.9.7)
```

뷰 읽기(`sync/views.ts`):

```ts
export function useView<V extends ViewName>(view: V, params: ViewParams<V>, opts?: { enabled?: boolean }): ViewState<ViewData<V>>;

export interface ViewState<T> {
  data: T | undefined;
  asOfSeq: number | null;
  generatedAt: string | null;
  freshness: 'current' | 'refreshing' | 'stale' | 'missing' | 'failed';   // §3.9.8
  serverFreshness?: 'current' | 'stale' | 'rebuilding' | 'failed';      // 응답의 freshness 그대로(04 §3.0.2)
  staleReason?: { key: string; args?: Record<string, string> };         // 05 문구 키
  error?: AppFacingError;
}

// TanStack queryKey: ['view', serverId, view, paramsKey]
async function fetchView(view, params): Promise<ViewRow> {
  const row = await db.views.get([serverId, view, paramsKey(params)]);
  if (!session.isLiveOrSyncing()) {
    if (row) return row;                                    // 화면은 'stale'로 그린다
    throw new OfflineNoDataError(view);
  }
  const minSeq = row?.staleSince ?? undefined;
  const r = await limiter.run(() => core.request('view.get', { view, params, minSeq }));   // 2006 view.notReady는 retryable → TanStack retry
  if (row && r.asOfSeq < row.asOfSeq) return row;           // 늦게 끝난 요청이 더 새 값을 덮지 않는다(paseo 규칙)
  const next = toRow(r, { staleSince: (minSeq !== undefined && r.asOfSeq >= minSeq) ? null : row?.staleSince ?? null });
  if (settings.offlineCopy) await db.views.put(next);
  return next;
}
```

- `view.get`의 `minSeq`는 데몬이 지킨다(19 §3.5.6. 못 지키면 `2006`을 돌려주고 앱은 재시도한다). 그래서 앱이 `asOfSeq`를 비교해 반복 요청할 일은 정상적으로는 없다.
- 쪽 나뉨 뷰(`thread`, `records`)는 `useInfiniteQuery`로 읽고, 낡으면 첫 쪽만 다시 받는다. 첫 쪽의 `asOfSeq`가 기준이다.
- 휘발 스트림: 코어가 `n`·`offset`을 검사해 넘긴 조각을 `liveTextStore[messageId]`에 반영한다(19 §3.6.4의 처리 규칙. happy-agent `applyMessageDelta.ts:4-40`과 같은 offset 방식). 영속 이벤트(메시지 완성, 도구 결과, run 종료)가 오면 해당 휘발 상태를 지운다. `end` 조각의 `finalSeq`를 위치가 넘을 때까지는 지우지 않는다(화면이 잠깐 비는 것을 막는다, 19 §3.6.4). 재접속하면 비우고 `stream.subscribe` 응답의 `active`로 다시 채운다.

#### 3.9.7 명령 전송: 멱등 키, `basisSeq`, 진행 중 명령함 [제안, 필드는 19 §3.7.2]

- 낙관적 도메인 갱신을 하지 않는다(21 UI-D03, 결정 14, 19 §3.5.9). 화면은 "보내는 중"만 보이고, 결과는 응답과 그 뒤의 뷰 무효화로 받는다. 사람이 보지 않은 상태 변경을 확정된 것처럼 보이지 않는다(canon §12.12 #4).
- 예외(앱 지역 상태만): 펼침·선택·탭, 입력 초안, 화면 설정.

```ts
// apps/desktop/src/sync/commands.ts
export function useCommand<M extends CommandMethod>(method: M): {
  send(params: Omit<ParamsOf<M>, 'idempotencyKey' | 'basisSeq'>, o: { basisSeq: number }): Promise<CommandOutcome>;
  status: 'idle' | 'sending' | 'waiting_reconnect' | 'done' | 'rejected' | 'failed';
  lastOutcome?: CommandOutcome;
};
export type CommandOutcome =
  | { kind: 'applied' | 'accepted'; result: CommandResult }       // 19 CommandResult.status
  | { kind: 'gated'; result: CommandResult }                      // 질문이 생겼다 → questionId로 이동 제안
  | { kind: 'conflict'; details: { subject: string; expected: number; current: number; rebase?: unknown } }   // 3004
  | { kind: 'rejected'; code: 3001 | 3002 | 3005; reason: string; nextActions?: NextAction[] }               // 커널 거부(10)
  | { kind: 'expired' };                                          // 정책 나이를 넘어 보내지 못함

export interface PendingCommandStore {   // 19 코어가 부르고 앱이 IndexedDB로 구현
  put(row: PendingCommandRow): Promise<void>;
  update(ik: string, patch: Partial<PendingCommandRow>): Promise<void>;
  listResendable(serverId: string, maxAgeMs: number): Promise<PendingCommandRow[]>;   // createdAt 순
}
```

보내기 절차:

```text
send(params, { basisSeq }):
  require 연결 상태 == live                     // 아니면 버튼이 막혀 있다(§3.8.9). 막히지 않았다면 프로그래밍 오류
  ik = 'ik_' + monotonicUlid()                   // ulid 3 monotonicFactory
  pending.put({ ik, serverId, method, params: { ...params, idempotencyKey: ik, basisSeq, clientTime: now }, state: 'sending' })
  r = core.command(method, params, { idempotencyKey: ik })
    성공            → pending.update(ik, { state: 'done', result: r }) → applied | accepted | gated
    3004            → 'rejected' 행, conflict      → 화면: "바뀐 내용 보기"(21 UI-D02)
    3001·3002·3005  → 'rejected' 행, rejected      → 화면: 거부 사유와 nextActions(05)
    3006(keyReused) → 'rejected' 행, 진단 로그      → 버그 신호. 화면은 일반 오류
    3007(inProgress)→ 코어가 retryAfterMs 뒤 같은 ik로 다시
    끊김·시간 초과   → 'unknown'으로 두고 status 'waiting_reconnect'

caughtUp 뒤 코어의 재전송:
  pending.listResendable(serverId, policy.pendingCommandMaxAgeMs) 의 각 행을 같은 ik로 다시 보낸다
  데몬은 같은 ik면 처음 결과를 duplicate: true로 돌려준다(19 §3.9, 보존 policy.idempotencyWindowMs ≥ 7일)
  화면이 아직 기다리면 결과를 넘기고, 아니면 토스트 "연결이 끊긴 동안 보낸 조작이 처리됐습니다"(문구는 05)
  나이 초과 행은 'expired' → SCR-CONNECT "보내지 못한 조작" 목록(내용을 보이고, 다시 보내면 새 ik와 현재 basisSeq)
```

- `basisSeq`는 19에서 필수다. 사람이 결정한 카드가 속한 뷰의 `asOfSeq`를 넣는다(21 UI-D02). 화면 밖 동작(트레이, 단축키, 알림 동작)은 그때의 구독 위치를 넣는다(19 §3.7.2). `expect`(레코드 revision)는 뷰 데이터의 `RecordRef.revision`을 아는 화면만 넣는다(19 §3.7.4).
- 결정 버튼은 연결이 `live`이고 그 카드의 뷰 신선도가 `current`일 때만 누를 수 있다. 연결이 없을 때 새 결정을 받아 쌓아 두는 오프라인 큐는 두지 않는다(03 §4, 05 §3.1.8, 19 §2.4의 "단절은 안전 저하"). 대화 입력은 초안(`drafts`)으로만 남긴다. 이 점에서 OpenClaw iOS의 오프라인 송신 outbox(50개, 48시간, pi-cases-notes §12 그 밖)와 다르다. 질문의 전제가 그 사이 바뀔 수 있어 낡은 화면에서의 결정을 늦게 보내지 않는다.
- 진행 중 명령함은 "보냈는데 결과를 모르는 것"만 다룬다. 재전송은 결과 확인용이다.

#### 3.9.8 오프라인과 낡은 데이터 표시 [제안, 화면 규칙은 04 §3.0.3·§3.0.4]

연결 상태(§3.8.8)와 뷰 신선도는 따로 계산하고 따로 그린다(canon-2 §3.16, 21 §3.5.8 `FreshnessIndicator`). 뷰 신선도는 두 값을 합친다: 데몬이 응답에 넣은 `freshness`(데몬 쪽 판정, 19 §3.6.3)와 앱의 낡음 표시(`staleSince`).

| 앱 신선도(`ViewState.freshness`) | 조건 | 화면(04 §3.0.3) |
|---|---|---|
| `current` | 연결 `live`, `staleSince`가 없음, 서버 신선도 `current` | 표시 없음 |
| `refreshing` | 연결 `live`, 다시 받는 중, 또는 서버 신선도 `rebuilding` | 이전 데이터를 그대로 보이고 1초 넘으면 작은 진행 표시 |
| `stale` | 연결이 `live`가 아님, 또는 `staleSince`가 남아 있음(다시 받기 실패), 또는 서버 신선도 `stale` | "마지막으로 받은 화면입니다 · <상대 시간>"(정확한 시각은 툴팁). 화면의 "지금"류 문구를 기준 시각 문구로 바꾼다(04 §3.0.4 규칙 2). 결정 버튼 막힘 |
| `missing` | 연결이 없고 캐시에도 없음 | "연결되면 볼 수 있습니다" 빈 상태 |
| `failed` | 서버 신선도 `failed`, 스키마 불일치, 데몬 오류 | 04 §3.0.3 오류 상태, `staleReason`으로 문구(05) |

- 오프라인으로 시작해도 고정 뷰로 홈·질문함·복귀 요약을 읽을 수 있다. 원전의 "offline-first read/review"(canon-3 §6.10.2)를 읽기 쪽으로만 구현한다. 오프라인 상태의 결정은 받지 않는다(§3.9.7, 04 ADR A4).
- 재접속 뒤 바뀐 항목 표시(04 §3.0.4 규칙 4): 다시 받은 뷰의 `RecordRef` 중 `revisionSeq`가 끊기기 전 캐시의 `asOfSeq`보다 큰 것에 "다시 연결된 뒤 바뀜" 표시를 1분 붙인다. `revisionSeq`는 19가 모든 `RecordRef`에 넣으므로(19 §3.7.4) 앱은 도메인 지식 없이 비교만 한다. 표시 대상 ID 목록은 `uiStore.changedSinceReconnect`에 두고 21 컴포넌트가 읽는다.
- 초안 보존(04 §3.0.4 규칙 3·5, 04 SC-Q2): 질문 답, 합의 수정, 결과 확인 메모, 자극 반응, 대화 입력의 초안은 입력할 때마다(300ms 디바운스) `drafts`에 쓴다. 키는 `<화면 종류>:<대상 ID>`다(예: `question:qs_…`, `stim:cn_…:3`). 다시 연결되면 초안이 있는 화면에 "보내지 않은 답 1개" 안내를 보이고, 자동으로 보내지 않는다. 보내면 그때의 `basisSeq`를 쓴다. 보내기가 성공하면 초안을 지운다.
- 화면이 시간을 표시할 때 기준은 사용자 로컬 시간대다(브리프 §3.3). 프로토콜의 ISO 문자열을 `Intl.DateTimeFormat('ko-KR', …)`으로 바꾼다(04 §3.0.8).

#### 3.9.9 오류 경계 [제안]

| 층 | 위치 | 잡는 것 | 보이는 것 |
|---|---|---|---|
| L0 앱 | `main.tsx`의 `AppCrashBoundary` | 셸까지 무너진 렌더 오류 | 전체 화면 "앱에 문제가 생겼습니다" + [다시 불러오기] + [진단 묶음 만들기](`diag_bundle`). 연결은 Rust에 있으므로 다시 불러와도 데몬 쪽 작업과 무관하다 |
| L1 화면 | 루트 레이아웃의 `<Outlet>`을 감싼 `ScreenBoundary`(경로가 바뀌면 초기화) | 화면 하나의 렌더 오류 | 셸은 남기고 본문에 오류 카드 + [이 화면 다시 열기] |
| L2 패널 | 검사 패널, 대화 스레드(assistant-ui), 이미지, 시각화 | 부분 오류 | 그 패널만 대체 표시 |

- `react-error-boundary`를 쓴다(React 18의 오류 경계는 클래스 컴포넌트가 필요하다).
- 비동기 오류(투영 읽기 실패, 명령 실패)는 오류 경계로 던지지 않고 화면 상태(§3.9.8, `CommandOutcome`)로 다룬다. 예외: `ProtocolDataError`가 고정 키에서 나면 L1로 던진다.
- 오류 문구는 `errors/messages.ts`가 `AppErrorCode`, `TransportCloseReason`, `RpcError.code`, `KernelRejectReason`을 05의 문구로 바꾼다. 모르는 코드는 "알 수 없는 오류 (코드)"로 보이고 로그에 남긴다.
- React 18 `StrictMode`는 개발에서 effect를 두 번 실행한다. 연결 실행기(`connection/runner.ts`)와 세션은 React 밖 모듈 단일 객체로 만들고, React는 구독만 한다. 두 번 마운트돼도 연결이 둘 생기지 않는다.

#### 3.9.10 assistant-ui 연결 [제안, 범위는 21 UI-D11]

21이 정한 범위(객체별 대화 스레드만)에서 런타임을 다음처럼 잇는다. 발췌4 20-10·20-11, v0.3 14 §5.3의 규칙을 따른다.

```ts
const runtime = useExternalStoreRuntime({
  messages: threadMessages,                 // useView('thread', { concernId: cnId })의 쪽들 + liveTextStore 휘발 텍스트
  convertMessage: toThreadMessageLike,      // 21이 정하는 변환. reasoning 파트는 렌더링하지 않는다(21 §3.10.3)
  isRunning: liveTextStore.isRunning(cnId),  // stream.subscribe의 active·status 조각(19 §3.6.4)
  onNew: (m) => composerSubmit.send({ scope: { concernId: cnId }, text: textOf(m) }, { basisSeq: threadView.asOfSeq! }),   // 19 `composer.submit`
  onCancel: () => workStop.send({ concernId: cnId }, { basisSeq: threadView.asOfSeq! }),                                // 19 `work.stop`
  // onAddToolResult, 도구 승인 콜백은 넘기지 않는다. 사람 결정은 UiIntent → useCommand로만 간다
});
```

- AssistantTransport, Assistant Cloud, Interactables, 생성형 UI는 쓰지 않는다(21 UI-D11, 발췌4 20-11·20-13).
- assistant-ui는 0.x이므로 정확한 버전으로 고정하고 `screens/thread/` 안의 얇은 어댑터 뒤에 둔다. 바꾸게 되면 이 폴더만 고친다.
- Tauri 웹뷰에서 assistant-ui를 쓸 때의 제약(발췌4 d25): 순수 React이고 원격 자원이 없으므로 CSP(§3.6.2) 안에서 동작한다. 원격 글꼴·이미지를 쓰는 예제 컴포넌트는 가져오지 않는다.

#### 3.9.11 설정과 문구 [제안]

`settings.json`(`tauri-plugin-store`) 키:

| 키 | 기본값 | 뜻 |
|---|---|---|
| `theme` | `system` | 21 §3.2.9 |
| `density` | `regular` | 21 §3.2.7 |
| `notifications.enabled` | `true` | OS 알림 전체 |
| `notifications.sound` | `false` | |
| `shortcuts.quickCapture` | 없음(사용자가 정함, 05 §3.8) | §3.10.4 |
| `notifications.showContent` | `false` | OS 알림에 데몬 문구를 그대로 보일지(05 ADR, §3.10.1) |
| `closeBehavior` | `hide` | 창 닫기 = 숨기기. `quit`이면 앱 종료 |
| `macActivation` | `regular` | `accessory`면 Dock 아이콘 없이 메뉴 막대만(배지 없음) |
| `offlineCopy` | `true` | 뷰 오프라인 사본(§3.9.5) |
| `devView` | `false` | 03 §4의 개발자 보기(ID, seq 표시) |
| `lastRoute` | `/home` | |

알림 종류별 켜고 끄기, 조용한 시간, 주의 예산은 데몬 설정이다(11·14). 앱은 같은 값을 다시 두지 않고 `SCR-SETTINGS`에서 데몬 명령으로 바꾼다.

문구: UI 문구는 한국어 하나뿐이라 i18n 라이브러리를 쓰지 않는다. 앱이 직접 만드는 문구는 `src/copy/`의 상수에 두고 05의 지침을 따른다. 데몬 투영에 들어 있는 문구(질문 문장 등)는 그대로 그린다.

#### 3.9.12 presence 보고 [제안, 형식은 19 §3.7.8, 쓰임은 11 §3.8.1]

질문 전달 방식(11)과 거시 스케줄러(14)가 "사람이 지금 보고 있는가"를 알 수 있게 앱이 `presence.report` 알림을 보낸다(11 §5.2의 20 요구).

| 값 | 판정(`platform/presence.ts`) |
|---|---|
| `active` | 창이 보이고 포커스가 있고, 마지막 키보드·마우스 입력이 5분 안 |
| `idle` | 창이 보이지만 입력이 5분 넘게 없음 |
| `hidden` | 창이 숨겨짐 또는 최소화(`app://window`) |
| `locked` | 보내지 않는다. Tauri에 화면 잠금 신호가 없어 판정할 수 없다 [지식]. 잠금 동안은 보통 `idle`이나 `hidden`으로 보인다 |

- `screen`은 현재 경로의 화면 ID(03 §3.6), `objectId`는 경로 인자의 레코드 ID다(예: `SCR-QUESTION`, `qs_…`).
- 바뀔 때만 보내고 최소 간격은 2초, 같은 값은 다시 보내지 않는다(19 §3.7.8). 연결이 `live`일 때만 보내고, 다시 연결되면 현재 값을 한 번 보낸다.
- 입력 내용이나 화면 내용은 보내지 않는다(11 §3.8 "키 입력 내용이나 화면 내용은 받지 않는다").
- 방해 금지는 presence가 아니라 데몬 설정(`settings.update`)이다. 트레이의 "방해 금지"가 이 명령을 보낸다(§3.10.2, 05 §5.2의 20 요구 "방해 금지 상태 동기화").

### 3.10 OS 통합

#### 3.10.1 알림 [제안]

원칙: 질문을 언제 사람에게 알릴지는 데몬이 전달 방식(즉시·협상·중재·예약)으로 정한다(결정 12, 11). 앱은 데몬의 전달 결정이 기록된 영속 이벤트(19 §3.8.3, 이벤트 이름은 09·11)를 실시간으로 받았을 때만 OS 알림을 띄운다(APP-D11). 진행 이벤트마다 알리지 않는다(canon §12.12 #2, 21 UP-13). 원전 체크리스트의 "할 일과 마감 효과가 있는 것만, 낮은 우선순위는 복귀 요약에 묶음"(canon §17.6, §12.10 `batch_low_urgency_until`, `preferred_review_windows`)은 데몬의 전달 정책이 지키고, 앱은 그 결과만 보인다. 별도 푸시 채널은 없다(19 §2.4).

앱이 전달 이벤트 payload에서 읽는 필드(09·11이 이름을 정한다. 앱이 기대하는 최소):

```ts
interface DeliveryPayloadForApp {
  deliveryId: string;
  surface: Array<'os' | 'badge' | 'banner'>;   // 데몬이 정한 표시 방법. 'os'가 없으면 OS 알림을 띄우지 않는다
  targetDevices?: string[];                     // 없으면 모든 기기
  category: 'question' | 'rights_gate' | 'review' | 'goal' | 'recovery' | 'observer' | 'system';
  urgency: 'interrupt' | 'notice' | 'digest';   // 11 §2.2-1의 알림 강도(delivery.urgency)
  title: string;                                // 데몬이 만든 한국어 문구(05 지침). 질문 본문을 넣지 않는다(04 §3.24와 같은 이유)
  body: string;                                 // 한 줄. 비밀·원문 금지(18)
  target: string;                               // 딥 링크(03 §3.5.4). 예: helm://question/qs_…
  expiresAt?: string;
}
```

처리(`platform/tauri/notifications.ts`):

1. 이벤트 구독이 재전송 중(`replaying`)이면 OS 알림을 띄우지 않는다. 끊긴 동안 쌓인 전달은 질문함·배지·복귀 요약으로 보인다. 다시 연결되자마자 지난 알림이 한꺼번에 뜨는 일을 막는다.
2. `surface`에 `os`가 없거나, `targetDevices`에 이 기기가 없거나, `expiresAt`이 지났으면 띄우지 않는다.
3. 같은 `deliveryId`는 한 번만 띄운다(`meta.recentDeliveryIds`, 최근 500개).
4. 창이 포커스를 갖고 있고 `target` 화면이 지금 열려 있으면 OS 알림 대신 앱 안 배너(`RGN-BANNER`)로 보인다. 표시 방법의 선택이고 전달 여부 판단이 아니다.
5. 강도별 표시(11 §5.2의 20 요구): `interrupt` → OS 알림 + 앱 안 배너(창이 열려 있으면), `notice` → OS 알림(창이 앞에 있으면 배너만), `digest` → OS 알림 없음(질문함·배지·복귀 요약으로만).
6. 띄울 때는 `sendNotification({ title, body, extra: { target, deliveryId } })`. 설정 `notifications.showContent`가 꺼져 있으면(기본, 05 ADR) 데몬이 보낸 제목·본문 대신 제목 "Helm", 본문 "확인할 일이 n건 있습니다."(n은 `tray` 뷰의 선택 필요 + 확인하면 좋은 것)로 띄운다. 잠금 화면 노출을 줄이기 위해서다. `notifications.enabled`가 꺼져 있으면 띄우지 않는다.

클릭 처리: `tauri-plugin-notification` 2.6.0부터 데스크톱에서 알림 클릭이 `onAction`으로 온다 [원문: plugins-workspace `plugins/notification/CHANGELOG.md` 2.6.0, 보조 에이전트 확인]. 클릭하면 `extra.target`을 §3.10.6 규칙으로 연다. 2.6.0은 2026-10-10 배포라 쓰인 기록이 적다 [가정: 두 플랫폼에서 동작, §6.2 수동 확인 항목]. 동작하지 않는 환경에서는 대체 규칙을 쓴다: 알림을 띄운 뒤 30초 안에 앱이 활성화되면 가장 최근 알림의 `target`을 배너의 [열기] 단추로 보인다(자동 이동은 하지 않는다). 알림 안의 동작 단추(예: "가정대로 진행")는 두지 않는다. 결정은 질문 내용을 본 화면에서만 한다(04 §3.25의 팔레트 규칙과 같은 이유).

플랫폼별 사실 [원문: 플러그인 소스, 보조 에이전트 확인]:

| 항목 | macOS | Windows |
|---|---|---|
| 개발 실행(`tauri dev`)의 알림 | Terminal 이름·아이콘으로 나온다(`notify_rust::set_application("com.apple.Terminal")`). Terminal 알림이 꺼져 있으면 안 보인다 | PowerShell 이름·아이콘. 설치한 앱에서만 정상 동작한다 |
| 권한 | 플러그인의 `requestPermission`은 데스크톱에서 항상 허용을 돌려준다. 실제 허용은 시스템 설정 > 알림에서 사용자가 정한다 | 설정 > 시스템 > 알림 |
| 띄운 알림 지우기 | `removeActive`가 동작하지 않는다. 다른 기기에서 답한 질문의 알림도 남는다. 클릭하면 04 §3.0.5 "이미 답했습니다" 화면이 열린다 | 같음 |

#### 3.10.2 메뉴 막대·트레이 (`SCR-TRAY`) [제안, 내용은 04 §3.24]

- Rust `TrayIconBuilder`(feature `tray-icon`)로 만든다 [검색: v2.tauri.app/learn/system-tray]. 아이콘은 macOS 템플릿 이미지(단색), Windows 16/32px ICO. 상태별 아이콘: 기본, 선택 필요 있음(점), 연결 없음(빗금).
- 왼쪽 클릭: macOS는 메뉴를 연다(기본 동작). Windows는 `show_menu_on_left_click(false)`로 두고 왼쪽 클릭 = 창 보이기, 오른쪽 클릭 = 메뉴(Windows 관례).
- 내용은 19의 `tray` 뷰(19 §3.7.4)를 TS가 받아 `tray_update(TraySummary)`로 넘긴다. 숫자와 문장은 앱이 세거나 만들지 않고 뷰 값을 그대로 쓴다(03 §6 "배지 수는 투영 값과 같다"). 원전 체크리스트의 active-run 요약(다음 예정, 마지막 의미 있는 변화, 다음 checkpoint, 예외)과 선택 필요 개수(canon-3 §8 문서 20)는 `tray` 뷰가 담는다(12·04에 요구).
- 메뉴 모양은 04 §3.24를 따른다: "Helm · <연결 상태>", 선택 필요 n(→ `/inbox`), 확인하면 좋은 것 n, 진행 중 n과 항목(Concern 표시 번호 · 지금 하는 일, 최대 5개, → 그 Concern의 작업 화면), 방해 금지(데몬 설정 명령, 04 §3.24), Helm 열기, 빠른 입력…(§3.10.4), 종료. 질문 내용은 보이지 않는다.
- 연결이 없으면 첫 줄이 "Helm · 연결 안 됨"이고 [연결 화면 열기]가 생긴다. 숫자는 마지막으로 받은 값에 "(오프라인 기준)"을 붙인다.
- 메뉴 클릭은 Rust가 `app://navigate` 또는 `app://tray-action`으로 웹뷰에 넘긴다. "방해 금지"처럼 명령이 필요한 항목은 웹뷰가 `useCommand`로 보낸다(창을 열지 않고 보낸다. `basisSeq`는 `tray` 뷰의 `asOfSeq`).

#### 3.10.3 Dock 배지와 작업 표시줄 [제안]

| 플랫폼 | API | 값 |
|---|---|---|
| macOS | `Window::set_badge_count(Some(n))`, 0이면 `None` | `tray` 뷰의 "선택 필요" 수(권리 게이트 질문). 정보 질문은 배지를 바꾸지 않는다(04 §3.24, 주의 예산) |
| Windows | `set_badge_count`는 지원하지 않는다. `Window::set_overlay_icon(Some(img))`로 작업 표시줄 아이콘에 덧그림을 올린다 | 같은 수. 1~9, "9+" 미리 그린 PNG 10개(앱 자원). 0이면 `None` |

[원문: tauri 2.12.3 `crates/tauri/src/window/mod.rs`, 보조 에이전트 확인]. `settings.macActivation = 'accessory'`(Dock 아이콘 없음)이면 배지를 쓰지 않는다. 진행 보고 수는 배지에 넣지 않는다(03 §3.4.1 `RGN-RAIL` 규칙과 같다).

#### 3.10.4 전역 단축키와 빠른 입력 [제안]

- `tauri-plugin-global-shortcut`으로 하나만 등록한다: 빠른 입력. 기본 조합은 두지 않고 사용자가 `SCR-SETTINGS`에서 정한다(05 §3.8: `Cmd+Shift+H`는 macOS Finder의 "홈 폴더 열기"와 겹친다). 누르면 창을 보이고 앞으로 가져와 전역 범위의 입력창(`RGN-COMPOSER`, 03 §3.4)에 포커스를 준다. 원전의 "global quick capture / command palette"(canon-3 §6.10.2)에 해당한다. 입력 내용은 의미 미리보기(05 §3.5)를 거친다.
- 등록 실패(다른 앱이 이미 씀)는 플러그인이 오류로 알려 준다. `isRegistered`로는 다른 앱의 등록을 알 수 없다 [원문: 플러그인 JS 문서 주석]. 실패하면 `SCR-SETTINGS`에 "단축키를 등록하지 못했습니다"를 보이고 바꾸게 한다.
- 앱 안 단축키(명령 팔레트 `Mod+K` 등)는 05 §3.8이 정하고 웹뷰 안에서 처리한다.

#### 3.10.5 창, 로그인 시 시작, 단일 인스턴스 [제안]

- 창 닫기: 기본은 숨기기(`closeBehavior = 'hide'`). Rust가 `WindowEvent::CloseRequested`에서 `api.prevent_close()`하고 숨긴다. 연결과 알림은 계속된다. Windows에서 처음 숨길 때 한 번만 "Helm은 트레이에서 계속 실행됩니다" 알림을 띄운다. macOS에서 Dock 아이콘을 누르면(`RunEvent::Reopen`) 창을 보인다. 종료는 트레이 "종료", macOS `Cmd+Q`.
- 종료 순서: 진행 중 명령함 기록 flush(§3.9.6-4) → 전송 닫기 → ssh 자식 종료 → 창 상태 저장 → 끝.
- 로그인 시 시작: `tauri-plugin-autostart`, macOS는 `MacosLauncher::LaunchAgent`(`~/Library/LaunchAgents`에 plist), Windows는 `Run` 레지스트리 [원문: 플러그인 소스]. 인자 `--background`로 시작하면 창을 띄우지 않고 트레이만 둔다. 기본은 꺼짐이고 `SCR-ONBOARD` 끝에서 켤지 묻는다. macOS 13 이후에는 등록 때 "백그라운드 항목 추가됨" 알림이 OS에서 뜬다 [지식].
- 단일 인스턴스: `tauri-plugin-single-instance`(feature `deep-link`)를 첫 번째 플러그인으로 등록한다. 두 번째 실행은 기존 창을 보이고 인자(딥 링크)를 넘기고 끝난다. macOS는 LaunchServices가 이미 하나만 띄우지만, 실행 파일을 직접 실행하는 경우를 막는다 [지식].
- 창 상태: `tauri-plugin-window-state`로 크기·위치·최대화를 기억한다. 보임 여부는 기억하지 않는다(`--background` 규칙과 충돌하지 않게).
- 창 테마: 설정 `theme`가 바뀌면 `setTheme`로 제목 표시줄을 맞춘다(21 §3.2.9).

#### 3.10.6 딥 링크 [제안, 형식은 03 §3.5.4]

- 스킴 `helm`을 `tauri.conf.json`의 `plugins.deep-link.desktop.schemes: ["helm"]`로 등록한다. macOS는 번들의 `Info.plist`에 들어가고 실행 중 등록은 안 되며, `/Applications`에 설치한 앱에서만 시험할 수 있다. Windows는 설치 때 등록되고, 개발 빌드에서는 `register_all()`을 부른다 [검색: v2.tauri.app/plugin/deep-linking].
- 받기: 시작할 때 `getCurrent()`, 실행 중에는 `onOpenUrl(urls)`. Windows의 두 번째 실행 인자는 단일 인스턴스 플러그인이 넘긴다.
- 해석(`navigation/deeplink.ts`). 인자 형식 검사를 통과하지 못하면 무시하고 로그만 남긴다. 다른 앱이 임의 URL로 앱을 열 수 있기 때문이다.

| 링크 | 처리 |
|---|---|
| `helm://question/<qsId>` | `/inbox/<qsId>` |
| `helm://concern/<cnId>[/<tab>]` | `tab ∈ {overview, inquiry, work, history, thread}`, 없으면 `overview` |
| `helm://agreement/<agId>`, `helm://review/<rsId>` | 경로에 `cnId`, `wuId`가 필요하다. 데몬의 참조 해석 메서드(19, 03 §5.2 "딥 링크 대상 ID를 그대로 쓸 수 있는 조회")로 경로 인자를 받은 뒤 이동한다 |
| `helm://evidence/<recordId>` | `/evidence/<recordId>` |
| `helm://goal/<glId>` | `/goals/<glId>` |
| `helm://stimuli/<cnId>/<roundNo>` | `/concerns/<cnId>/inquiry/want/rounds/<roundNo>` |
| `helm://brief`, `helm://recovery`, `helm://observer/<proposalId>` | 해당 경로 |
| `helm://pair?v=1&url=…&code=…&sid=…` | `/connect?pair=…`. 페어링을 자동으로 실행하지 않는다. 서버 주소와 `serverId`를 보이고 사용자가 [연결]을 눌러야 `pairing_with_code`를 부른다(링크는 연결 의도만 담는다. OpenClaw `openclaw://gateway/add`와 같은 원칙, `docs/platforms/mac/remote.md:107-111`). 코드는 로그에서 가린다 |

- 링크에 `sid=<serverId>`가 있고 활성 프로필과 다르면 프로필을 바꿀지 묻는다. 없으면 활성 프로필에 적용한다.
- 연결이 없을 때 데몬 조회가 필요한 링크는 "연결되면 엽니다"를 보이고 대기 링크 하나를 기억했다가 `live`가 되면 연다.
- 대상이 이미 처리됐거나 없으면 그 화면이 상태를 보인다(03 §3.5.4, 04 §3.0.5).

#### 3.10.7 기기 토큰 키체인 [제안]

| 항목 | 값 |
|---|---|
| 크레이트 | `keyring-core` 1.0.0 + macOS `apple-native-keyring-store` 1.0.2(feature `keychain`, 기존 로그인 키체인) + Windows `windows-native-keyring-store` 1.1.0 [검색] |
| 항목 이름 | service = 번들 식별자 `dev.helm.desktop`, account = `device-token/<serverId>/<deviceId>`. 다른 데몬의 토큰과 섞이지 않게 `serverId`를 넣는다(18 §5.2의 20 요구). 페어링 응답에서 두 값을 받은 직후 쓴다. 프로필 → 항목 대응은 프로필의 `serverId`·`deviceId`로 찾는다 |
| 값 | 토큰 문자열 그대로. Windows 자격 증명 크기 한도 2,560바이트 [검색: Microsoft `CREDENTIALW` 문서] 안에 든다 |
| Windows 보존 범위 | 로밍(Enterprise)이 기본값이라고 한다 [검색: windows-native-keyring-store 문서]. 이 기기 전용(Local Machine)으로 바꾼다. 이 API가 크레이트에 없으면 기본값을 쓰고 §7 Q-07에 남긴다 |
| macOS 키체인 확인 창 | 레거시 키체인의 항목 접근 권한은 앱의 코드 서명 정체에 묶인다. ad-hoc 서명 앱은 빌드할 때마다 정체가 바뀌어 다시 빌드한 뒤 처음 읽을 때 "키체인 접근 허용" 창이 뜬다 [검색: keyring-rs 이슈 #272 유지 관리자 답변] |
| 대응 | Mac에서 한 번 만든 자체 서명 코드 서명 인증서(키체인 접근 > 인증서 지원 > 인증서 생성, 종류 "코드 서명")로 매번 서명한다(`bundle.macOS.signingIdentity = "Helm Local Code Signing"`). 같은 인증서로 서명하면 지정 요구 사항(designated requirement)이 같아 다시 묻지 않을 것으로 본다 [가정, 시험 항목 §6]. 이것은 개인 Mac에서의 로컬 서명이라 Apple 공증·서명 배포(결정 24)와 다르다. 인증서를 만들지 않으면 `"-"`(ad-hoc)로 빌드하고 갱신마다 한 번 "항상 허용"을 누른다 |
| Data Protection 키체인 | 쓰지 않는다. 팀 ID와 프로비저닝이 필요해 서명 없는 앱에서 쓰기 어렵다 [검색: apple-native-keyring-store 문서] |
| Stronghold | 쓰지 않는다. 2026-07 중단 공지, Tauri v3에서 빠진다 [검색: plugins-workspace 이슈 #3494] |
| 실패 | 잠김·서비스 없음 → `keychain_unavailable`, 사용자 거부 → `keychain_denied`. 연결 상태는 `blocked(keychain_denied)`이고 [다시 시도]로 다시 묻는다. 키체인 대신 파일에 토큰을 두는 대체 경로는 만들지 않는다 |

### 3.11 UI를 앱에 묶을지, 데몬이 서빙할지 [제안, ADR 후보 ADR-20-04]

| 기준 | A. 앱에 묶음 (채택) | B. 데몬이 서빙(앱은 원격 URL을 여는 껍데기) |
|---|---|---|
| 오프라인 시작 | 된다. 캐시된 투영을 읽기 전용으로 보인다 | 안 된다. 데몬에 연결되지 않으면 빈 창 |
| 앱–데몬 버전 일치 | hello의 프로토콜 범위로 확인해야 한다. 어긋나면 갱신 안내 | 항상 맞다 |
| 보안 | 웹뷰에 원격 콘텐츠가 없다. IPC 권한을 로컬 origin에만 준다 | 원격 origin에 IPC 권한(`remote.urls`)을 줘야 한다. 원격 페이지의 로컬 IPC 호출 취약점(CVE-2026-42184) 같은 종류의 위험을 직접 진다 |
| SSH 경로 | 그대로 | 웹뷰가 원격 URL을 열려면 로컬 포트 터널이 필요하다(§3.8.2 B의 문제) |
| 결정 19 | 맞다 | 사실상 웹 클라이언트를 셸로 감싼 것이 된다 |
| 배포 | 앱을 갱신해야 UI가 바뀐다 | 데몬 갱신만으로 UI가 바뀐다 |

A를 고른다. 버전 문제는 §3.12.7의 호환 범위와 갱신 안내로 다룬다. 원전의 "Web GUI로 검증한 뒤 셸을 붙인다"(canon-3 §6.10.2)와 백엔드 조사의 "데몬이 같은 SPA를 웹으로도 서빙"(backend-oss-research §4)은 결정 19에 따라 따르지 않는다(canon-3 §7.1 C6). 다만 같은 SPA를 브라우저에서 띄우는 대체 실행은 테스트에만 쓴다(§3.13.3).

### 3.12 빌드·배포

#### 3.12.1 도구와 빌드 위치 [제안]

| 항목 | 값 |
|---|---|
| Node | 06의 Node 24 LTS(`.mise.toml`), 앱 개발 도구 때문에 24.15 이상. Mac은 `run-on`이 mise shim을 PATH에 넣는다 |
| pnpm | workspace(결정 36) |
| Rust | `rust-toolchain.toml`로 1.90 이상의 안정판 하나에 고정. 타깃: `aarch64-apple-darwin`, `x86_64-apple-darwin`(Mac), `x86_64-pc-windows-msvc`(WSL 교차 빌드) |
| Cargo 산출물 | `CARGO_TARGET_DIR=$HOME/.cache/helm/cargo-target`(Mac·WSL 각자). 저장소 안 `src-tauri/target`을 만들지 않는다(Syncthing, §2.2) |
| 번들 산출물 | `$HOME/.cache/helm/desktop-artifacts/<version>/`. Windows 설치 파일은 Windows 탐색기에서 `\\wsl.localhost\Ubuntu-24.04\home\user\.cache\helm\desktop-artifacts\…`로 연다. Windows 디스크(`/mnt/c`)에 쓰지 않는다 |
| 순수 Rust 모듈 | SSH 인자·실패 분류, 프로필 검증, WebSocket-over-stream, blob 캐시 검증은 Tauri에 의존하지 않는 크레이트 `apps/desktop/src-tauri/core`(`helm-desktop-core`)로 둔다. WSL에서 Tauri의 Linux 시스템 의존(webkit2gtk) 없이 `cargo test`를 돌릴 수 있다 |
| 번들 식별자 | `dev.helm.desktop`, 제품 이름 `Helm` |
| `.env.example`에 더할 키 | `HELM_DEV_DEVICE_ID=`(비밀 아님, 값 없음), `HELM_DEV_DEVICE_TOKEN=`(비밀, `app-dev`용 dev 데몬 기기 토큰), `HELM_APP_SIGNING_IDENTITY=Helm Local Code Signing`(비밀 아님, Mac 서명 인증서 이름). 값은 사람이 `secrets edit dev`로 넣는다 |

#### 3.12.2 just 레시피 [제안, 이름은 06 §3.16 표에 맞춤]

06 §3.16이 `app-dev`, `app-build-mac`, `app-build-win`, `shot`을 이름만 두고 내용을 20에 맡겼다. 아래는 그 내용과 앱에 필요한 나머지 레시피다. 모두 `.just/helm.just`에 둔다.

| 레시피 | 실행 위치 | 하는 일 | 종료 코드 2(환경 문제) |
|---|---|---|---|
| `app-setup` | 서버 | `rustup target add x86_64-pc-windows-msvc`, `cargo install --locked cargo-xwin`, 필요한 apt 패키지(`nsis lld llvm`)가 없으면 설치 명령을 출력(설치는 사람이 sudo로) | apt 패키지·rustup 없음 |
| `app-check` | 서버 | `cargo fmt --check`, `cargo clippy -p helm-desktop-core`, `cargo test -p helm-desktop-core`, capability·CSP 정적 검사(§6). TS 검사·Vitest는 저장소 `lint`·`test`가 한다 | cargo 없음 |
| `app-test-ssh` | 서버 | WSL 자신의 sshd(127.0.0.1:22)로 SSH 경로 통합 시험(가짜 데몬 포트로 `-W`) | sshd 없음, 시험 키 없음 |
| `app-e2e` | 서버 | 가짜 데몬 + Vite 미리보기 + Playwright(Chromium, WebKit), IT-01~16 | 브라우저 미설치 |
| `app-dev` | 서버 | Vite 개발 서버 + 브라우저 대체 실행으로 dev 데몬에 붙음(06 정의, 개발 전용). 브라우저는 헤더를 붙일 수 없으므로 Vite 개발 서버의 WebSocket 프록시(`/rpc` → `ws://127.0.0.1:7841/rpc`)가 `.env`의 `HELM_DEV_DEVICE_TOKEN`으로 `Authorization` 헤더를 붙인다. 토큰은 Node 프로세스에만 있고 브라우저 번들에 들어가지 않는다(`envPrefix` 규칙, §3.6.2) | `.env` 없음(`just dotenv`) |
| `app-dev-mac` | 서버 → Mac | `run-on mac 'cd ~/projects/helm/code/helm && just app-dev-local'` → Mac에서 `pnpm tauri dev` | Mac에 연결 못 함 |
| `app-build-mac` | 서버 → Mac | `run-on mac`으로 `app-build-local` 실행(06 정의) | Mac에 연결 못 함 |
| `app-build-local` | Mac | `pnpm tauri build --target universal-apple-darwin --bundles app` | Xcode 명령줄 도구 없음 |
| `app-install-mac` | 서버 → Mac | 빌드 결과를 `/Applications/Helm.app`에 바꿔 넣고, 실행 중이면 끝낸 뒤 다시 띄움 | 같음 |
| `app-verify-mac` | 서버 → Mac | `cargo clippy`(Tauri 크레이트 포함), WebdriverIO 셸 스모크(§3.13.4) | 같음 |
| `app-build-win` | 서버 | `pnpm tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis`, 산출물을 아티팩트 폴더로(§3.12.4) | NSIS·lld·llvm·cargo-xwin 없음 |
| `app-build-win-ci` | 서버 | `gh workflow run desktop-windows.yml` 후 `gh run download`. 브랜치 push가 필요하므로 사람 확인 뒤에만 | `gh` 인증 없음 |
| `shot` | 서버 | 가짜 데몬 고정 데이터로 화면별 스크린샷과 기준 비교(§3.13.5, 06 정의) | 브라우저 미설치 |

- `just verify`에는 `app-check`만 넣는다. Mac이 필요한 레시피와 Windows 교차 빌드는 넣지 않는다(06 §3.16의 원칙). 앱을 바꾼 작업의 완료 기준에는 `app-e2e`와 화면이면 `shot`을 더한다(사용자 규칙).

#### 3.12.3 macOS 빌드 [제안]

- Mac에서만 빌드한다(브리프 §2.5). 서버는 `run-on mac`으로 지시한다. 저장소는 Syncthing으로 Mac에 같은 경로로 있다. `node_modules`는 Syncthing이 동기화하지 않으므로 Mac에서 `just setup`(06 `node.just`)을 따로 한다. `app-build-local`은 `node_modules`가 없으면 종료 코드 2로 알린다.
- universal 바이너리(`--target universal-apple-darwin`)로 만든다 [검색: Tauri 배포 문서 예시]. Mac이 한 대라 아키텍처 하나로 충분하지만, 같은 산출물을 다른 Mac에 옮길 때를 위해 universal을 기본으로 둔다(빌드 시간이 문제면 `aarch64`만).
- 서명: Tauri는 `signingIdentity`가 없으면 번들 서명을 아예 건너뛴다. 그러면 다른 경로로 받은 앱은 "손상됨" 오류가 난다 [원문: `tauri-bundler/src/bundle/macos/app.rs`, 보조 에이전트 확인]. 그래서 항상 서명한다: 자체 서명 인증서(§3.10.7) 또는 ad-hoc(`"-"`).
- 같은 Mac에서 빌드해 `/Applications`에 복사한 앱에는 격리 속성(quarantine)이 붙지 않아 Gatekeeper 확인 없이 열린다 [지식].
- 딥 링크·알림은 `/Applications`에 설치한 앱으로 시험한다(§3.10.1, §3.10.6).

#### 3.12.4 Windows 빌드 경로 비교와 선택 [제안, ADR 후보 ADR-20-06]

| 기준 | A. WSL에서 교차 빌드(cargo-xwin, NSIS) — 기본 | B. GitHub Actions `windows-latest` + `tauri-apps/tauri-action@v1` — 대체 | C. Windows 호스트에서 수동 빌드 | D. Windows VM·Sandbox |
|---|---|---|---|---|
| 브리프 §2.5 | 맞다(서버 WSL 도구만) | 맞다(외부 러너) | 어긋난다(호스트에 Node 등 없음, 도구 설치 금지 방향) | 호스트 변경 필요 |
| 공식 지원 | "주의를 붙여 가능, 덜 시험됨, 마지막 수단" [검색: v2.tauri.app/distribute/windows-installer] | 공식 예시 경로 [검색] | 공식 | |
| 설치 파일 | NSIS만(MSI 불가) | NSIS, MSI | 둘 다 | 둘 다 |
| 필요한 것 | NSIS, lld, llvm(`llvm-rc`), Rust 타깃, cargo-xwin | GitHub 저장소, push, Actions 사용량 | | 큰 VM |
| 반복 속도 | 빠름, 로컬 | push → 대기 → 다운로드 | | |
| 사람 확인 | 없음 | push마다 사용자 확인(CLAUDE.md 규칙) | | |

A를 기본으로 한다. 개인 앱이라 MSI가 필요 없고, NSIS 사용자 단위 설치(`bundle.windows.nsis.installMode = "currentUser"`, 관리자 권한 없음)로 충분하다. 공식 문서가 "마지막 수단"이라고 한 위험은 두 가지로 줄인다: (1) Rust 의존을 교차 빌드에 쉬운 쪽으로 고른다(TLS 백엔드 `ring`, OpenSSL·libssh2 없음, §3.7.2). (2) 태그(`desktop-v*`)를 push할 때 B의 워크플로 `.github/workflows/desktop-windows.yml`이 같은 커밋을 Windows 러너에서 빌드·스모크해 A의 산출물과 함께 확인한다. A가 깨지면 B의 산출물을 쓴다.

- WebView2: 기본 `downloadBootstrapper`를 쓴다. Windows 10 1803 이후와 Windows 11에는 OS에 들어 있다 [검색: Tauri Windows 설치 파일 문서]. Tauri 2.12부터 Windows 7 지원이 빠져 최소는 Windows 10이다 [원문: tauri CHANGELOG 2.12.0, 보조 에이전트 확인].

#### 3.12.5 서명 없는 개인 배포 [제안]

| 상황 | 일어나는 일 | 안내 |
|---|---|---|
| macOS, 같은 Mac에서 빌드·설치 | 격리 속성이 없어 그대로 열린다 | 없음 |
| macOS, 브라우저·AirDrop으로 받은 앱 | macOS 15부터 Control-클릭 우회가 없어졌다. 시스템 설정 > 개인정보 보호 및 보안 > "그래도 열기"(시도 뒤 약 1시간 동안 보임) [검색: Apple 개발자 뉴스 2024-08-06, Apple 지원 mh40616]. 또는 `xattr -dr com.apple.quarantine /Applications/Helm.app` [지식] | `SCR-ONBOARD`가 아니라 설치 안내 문서(`apps/desktop/INSTALL.md`)에 적는다 |
| Windows, `\\wsl.localhost` 경로에서 실행 | 브라우저로 받은 파일이 아니라 Mark-of-the-Web이 붙지 않을 것으로 본다 [가정] → SmartScreen 경고가 없거나 한 번 | |
| Windows, CI 아티팩트를 브라우저로 받음 | SmartScreen "Windows의 PC 보호" → [추가 정보] → [실행] [지식]. 2024년부터는 EV 인증서도 평판을 바로 주지 않는다 [검색: Tauri Windows 서명 문서] | INSTALL.md |

#### 3.12.6 업데이트 방식 [제안, ADR 후보 ADR-20-07]

- 1차: 자동 업데이트 없음(APP-D14). macOS는 `just app-install-mac`(다시 빌드해 바꿔 넣기), Windows는 새 NSIS 설치 파일을 실행한다(같은 앱을 제자리에서 갱신).
- 앱은 hello에서 프로토콜 호환을 확인하고(§3.12.7), 맞지 않으면 `blocked(incompatible_version)`과 갱신 방법을 보인다. 캐시된 화면은 계속 읽을 수 있다.
- 2차 후보: `tauri-plugin-updater` 2.13.3 + 데몬이 tailnet으로 서빙하는 정적 매니페스트(`latest.json`). 업데이트 서명 키(Tauri 자체 서명, OS 코드 서명과 별개, 끌 수 없음)가 필요하다 [검색: v2.tauri.app/plugin/updater]. 키는 SOPS 제품 비밀(`~/projects/helm/secrets/`)에 둔다. 업데이터가 받은 파일에는 격리 속성·MOTW를 붙이는 코드가 없다 [원문: updater 소스, 보조 에이전트 확인]. 단 SSH 경로만 쓰는 상황에서는 매니페스트에 접근할 수 없다. 사용 빈도가 늘면 다시 본다(§7 Q-09).

#### 3.12.7 버전 표기와 호환 [제안]

- 앱 버전: `apps/desktop/package.json`의 semver(`0.y.z`). `tauri.conf.json`의 `version`은 `"../package.json"`을 가리켜 한곳에서 관리한다 [지식: Tauri 설정은 package.json 경로를 받는다]. 빌드 ID는 `<git 짧은 해시>-<UTC 날짜>`를 빌드 환경 변수로 넣는다. `SCR-SETTINGS`의 정보와 진단 묶음에 보인다.
- 프로토콜: `@helm/protocol`이 `PROTOCOL_VERSION`(정수)을 내보낸다. 앱은 `{min: PROTOCOL_VERSION - 1, max: PROTOCOL_VERSION}`을 hello에 보낸다(`PROTOCOL_VERSION`이 1이면 `min`도 1). 데몬은 겹치는 가장 큰 값을 고르거나 `1003 protocol.unsupported`(`serverMin`, `serverMax`)로 거부한다(19 §3.4.3, P-14). 앱은 `serverMax < 앱 min`이면 "데몬이 오래됨", `serverMin > 앱 max`이면 "앱이 오래됨"으로 판정한다. 추가 변경은 버전을 올리지 않고 `features`로 알리므로(19 P-14), 앱은 화면 동작을 켜기 전에 `features.methods`·`views`에 있는지 확인하고 없으면 그 동작을 숨긴다. 앱과 데몬을 같은 커밋에서 만들면 항상 맞는다. 한쪽만 갱신한 경우를 위해 한 판 차이까지 허용한다.
- 스키마: hello의 `features.schemaHash`(19 §3.4.4)가 캐시 행의 값과 다르면 그 행을 버리고 다시 받는다(§3.9.5).
- 불일치 문구: 앱이 오래됨 → "앱을 갱신해야 합니다(앱 n, 데몬 m)", 데몬이 오래됨 → "데몬을 갱신해야 합니다". 갱신 명령 안내는 17의 레시피 이름을 쓴다.

### 3.13 테스트

#### 3.13.1 단위 [제안]

| 대상 | 도구 | 검사 |
|---|---|---|
| 연결 리듀서 `connection/machine.ts` | Vitest(node) | §3.8.8 전이 표의 모든 행이 표 형식 테스트 한 줄씩. 표에 없는 (상태, 이벤트) 쌍은 상태를 바꾸지 않고 효과가 없다 |
| 재시도 간격 | Vitest + 가짜 타이머 | 0.5→30초 상한, 흔들림 ±20% 범위, 인증 오류에서 재시도 없음 |
| 저장소·동기화 연결 `sync/stores.ts`, `sync/session.ts` | Vitest + `fake-indexeddb` + 19 코어의 시험용 가짜 | 위치 저장과 낡음 표시가 한 트랜잭션(중간에 트랜잭션을 중단시키면 둘 다 그대로), `outOfRange` 네 사유별 처리(§3.9.6-5), 재전송 중 낡음은 다시 받기를 미루고 `caughtUp` 뒤 한 번에, 늦은 응답이 새 값을 덮지 않음, `schemaHash`가 다르면 캐시 행을 버림, 재전송 중 전달 이벤트로 OS 알림을 띄우지 않음 |
| 휘발 스트림 반영 `sync/liveText.ts` | Vitest | 영속 이벤트가 오면 지움, `finalSeq` 전에는 지우지 않음, 재접속 때 비우고 `active`로 채움(`n`·`offset` 검사는 19 코어의 시험) |
| 진행 중 명령함 `sync/commands.ts`, `PendingCommandStore` | Vitest + `fake-indexeddb` | 끊김 뒤 같은 멱등 키로 재전송, 정책 나이를 넘으면 `expired`, 3004·3001·3002는 재전송하지 않음, `live`가 아니면 `send`가 막힘 |
| 딥 링크 `navigation/deeplink.ts` | Vitest | §3.10.6 표의 모든 형식, 잘못된 ID·알 수 없는 호스트 무시, `pair` 링크는 자동 실행하지 않음 |
| 프로필 검증 | Vitest + Rust | TS와 Rust가 같은 표본 파일(`fixtures/profile-validation.json`)로 같은 결과 |
| SSH 인자·실패 분류 | `cargo test`(core) | 인자 순서 고정(스냅샷), 주입 시도(`-oProxyCommand=…`, 공백) 거부, 실제 stderr 표본(macOS·Windows·Ubuntu)의 분류 |
| WebSocket-over-stream | `cargo test`(core) | `tokio::io::duplex` 위 tungstenite 서버와 업그레이드(`Sec-WebSocket-Protocol: helm-jsonrpc`, `Authorization`, SSH 경로의 `Host`), 서버 ping에 pong, 바이너리 메시지 → 1003, 4 MiB 송신 대기 초과 |
| blob 캐시 | `cargo test`(core) | 해시가 맞지 않으면 캐시에 쓰지 않음, 상한 넘으면 오래된 것부터 지움 |

#### 3.13.2 컴포넌트 [제안]

- `@testing-library/react` 16 + jsdom 30으로 훅(`useView`, `useCommand`)과 화면 조립(`screens/*/useScreenModel.ts`)을 시험한다. 데이터는 `test/fixtures/views/*.json`(19·12의 뷰 표본)이다.
- Tauri API는 `@tauri-apps/api/mocks`의 `mockIPC`, `mockWindows`, `clearMocks`로 대신한다 [검색: v2.tauri.app/develop/tests/mocking].
- 컴포넌트 자체의 시각 시험(Storybook, 스크린샷)은 21 UI-D14가 정한다.

#### 3.13.3 가짜 데몬과 통합 시험 [제안]

- 19의 가짜 서버(같은 프로토콜을 말하는 시험용 데몬, 19 §6.3의 적합성 도구)를 쓴다. 필요한 조작(19에 요구, §5.2): 이벤트 주입, 위치 건너뛰기, `storeId`·`bootId` 바꾸기, `view.get` 지연과 `2006`, 연결 끊기, tick 멈추기, 401·1003·1005·5001 응답, 명령에 3004 거부, 같은 멱등 키에 처음 결과 돌려주기, close 1001·4008·4009 보내기, `server.mode` 바꾸기.
- 브라우저 대체 실행: `platform/browser/transport.ts`는 브라우저 `WebSocket`으로 가짜 데몬에 바로 붙는다. 토큰은 시험용 쿼리 매개변수로 넘긴다(가짜 데몬 전용. 실제 데몬은 받지 않는다). 이 구현은 `import.meta.env.MODE !== 'production'`일 때만 묶인다.
- 시나리오(각각 Playwright 시험 하나):

| ID | 시나리오 | 확인 |
|---|---|---|
| IT-01 | 처음 연결(위치 없음) | `from: "head"` 구독, 고정 뷰 받기, 홈 표시 |
| IT-02 | 연결 중 끊고 이벤트 5개 뒤 재연결 | 위치부터 재전송, 무효화된 열린 뷰만 `caughtUp` 뒤 다시 받음 |
| IT-03 | 데몬 재시작(같은 `storeId`, `bootId`만 바뀜) | 위치 재개로 빠짐없이 받음(사례 8곳에 없던 경로), "데몬이 다시 시작됨" 띠 한 번 |
| IT-04 | 데몬 저장소 교체(`storeId` 바뀜) | `2001 storeMismatch` → 캐시 버림, `head` 구독, 열린 뷰 다시 받음 |
| IT-05 | 보존 범위 밖(`beforeOldest`) | 캐시는 낡음으로 남고 다시 받음, 이력 화면에 "생략됨" 표시 |
| IT-06 | 결정 응답 전에 끊김 | 재연결 뒤 같은 멱등 키 재전송, 데몬 처리 1회, `duplicate: true` 결과가 화면에 전달 |
| IT-07 | 낡은 카드에서 결정 | `3004` → "바뀐 내용 보기", 쓰던 답 유지 |
| IT-08 | 오프라인 시작 | IndexedDB 고정 뷰로 홈·질문함 읽기, 결정 버튼 막힘, 신선도 `stale`, 초안 저장 |
| IT-09 | 업그레이드 401, `hello` 1005 | `blocked(needs_pairing)`, 자동 재시도 없음 |
| IT-10 | 프로토콜 불일치(`hello` 1003) | `blocked(incompatible_version)`, 캐시 읽기 가능 |
| IT-11 | 휘발 스트림 중 끊김 | 휘발 텍스트 비움, 재연결 뒤 `active`의 부분 텍스트 표시 |
| IT-12 | 전달 이벤트(실시간) | OS 알림 호출(모의), 같은 `deliveryId` 두 번이면 한 번, 재전송 중 전달은 알림 없음 |
| IT-13 | tick 끊김(가짜 데몬이 tick을 멈춤) | `clientTimeoutMs` 뒤 close 4000, 바로 재연결 |
| IT-14 | 느린 소비자(close 4008) | 첫 대기 0으로 재접속, 위치부터 재전송 |
| IT-15 | 재접속 뒤 바뀐 항목 | `revisionSeq` 기준으로 "다시 연결된 뒤 바뀜" 표시가 1분 붙음 |
| IT-16 | 복구 모드(`server.mode: readOnly`) | 상단 "복구 모드 · 읽기 전용", 결정 버튼 막힘 |

- SSH 경로 통합(`app-test-ssh`): WSL 자신의 sshd와 가짜 데몬으로 Rust 전송을 실제로 연다. 확인: 열림, `daemon_unreachable`(가짜 데몬 포트 닫힘), `ssh_auth_failed`(없는 키), `ssh_host_key_unknown`(빈 known_hosts를 `-o UserKnownHostsFile`로 지정한 시험 모드).

#### 3.13.4 E2E 범위 [제안]

| 층 | 도구 | 플랫폼 | 범위 |
|---|---|---|---|
| 웹 E2E (주 경로) | Playwright 1.64, Chromium + WebKit | 서버(Linux) | IT-01~16, 화면 흐름(유즈케이스 UC-01~09의 화면 경로, 03 §3.7). WebKit은 macOS WKWebView와 같은 엔진 계열로 렌더 차이를 미리 잡는다 [가정: 같은 판이 아니므로 완전히 같지는 않다] |
| 셸 E2E (스모크) | WebdriverIO + `@wdio/tauri-service` 1.5.0, 앱에 `tauri-plugin-wdio-webdriver`(시험 빌드의 cargo feature `e2e`에서만) | macOS(Mac), Windows(CI) | 앱 실행, 가짜 데몬에 WSS(개발 빌드 http 허용)로 연결, 홈 표시, 창 닫기 = 숨기기, `window_reveal`. `tauri-driver`는 Windows·Linux만 지원하고 macOS에는 WKWebView 드라이버가 없다. `@wdio/tauri-service`는 앱 안에 WebDriver 서버를 넣는 방식으로 macOS를 지원한다 [검색: v2.tauri.app/develop/tests/webdriver] |
| 수동 확인 | 체크리스트(§6.2) | 둘 다 | 알림 클릭, 트레이 메뉴, Dock 배지·작업 표시줄 덧그림, 로그인 시 시작, 딥 링크(설치한 앱), 키체인 확인 창, SSH 경로 실제 서버 |

OS 알림 표시, 트레이 메뉴 클릭, 딥 링크 등록은 자동화 도구가 OS UI를 다루지 못해 수동 확인으로 둔다.

#### 3.13.5 화면 캡처 비교 [제안]

- `just shot`(06 §3.16): 가짜 데몬 고정 데이터 + 브라우저 대체 실행 + Playwright `toHaveScreenshot`으로 화면 ID별 캡처를 만든다. 기준 이미지와 허용 차이는 21(UI-D14)이 정한다. 창 너비 1280, 1100, 900px(03 §6).
- 실제 셸 캡처가 필요하면 `run-on mac`으로 앱을 띄우고 `screencapture -l <창 ID>`로 찍는다. 기준 비교는 하지 않고 사람이 본다.

## 4. 실패·예외·경계 사례

| # | 상황 | 감지 | 처리 [제안] |
|---|---|---|---|
| F-01 | 데몬이 꺼짐(WSL은 살아 있음) | WSS: serve가 502~504 → `daemon_unreachable`. SSH: `open failed: connect failed` → `daemon_unreachable` | 재시도(§3.8.8). 사용자용 상태 "데몬 응답 없음"(04 §3.0.4). 캐시를 읽기 전용으로 보인다 |
| F-02 | 서버 PC가 잠들었거나 꺼짐, WSL이 멈춤 | TCP 시간 초과, SSH 22번 연결 실패 → `network_unreachable` | 재시도, 2분 넘으면 "연결 안 됨". 원격 깨우기는 범위 밖(홈랩) |
| F-03 | 클라이언트 Mac이 잠자기에서 깨어남 | 5초 타이머가 20초 넘게 밀림(`wake`) | `PROBE`(3초). 실패하면 바로 다시 연결. 잠자는 동안 ssh 자식은 대개 죽어 있어 `TRANSPORT_CLOSED`가 먼저 올 수도 있다 |
| F-04 | 이 기기의 Tailscale이 꺼짐 | MagicDNS 이름을 못 찾음(두 경로 모두. SSH 별칭 `server`도 tailnet 이름) | "연결 안 됨" + 점검 1단계 문구 "이 기기에서 Tailscale이 켜져 있는지 확인하세요"(04 §3.19) |
| F-05 | `tailscale serve`에 Helm 줄이 빠짐 | 8448 연결 거부 → `network_unreachable`(WSS만) | 경로 순서대로 SSH로 넘어간다. 같은 실패가 3라운드 이어지면 WSS 경로를 30분 뒤로 미룬다(§3.8.10). `SCR-CONNECT`에 표시 |
| F-06 | 다른 기기에서 이 기기를 폐기 | close 4009(`auth.revoked`) 또는 다음 업그레이드 401 | `blocked(needs_pairing)`. 초안과 캐시는 남긴다. 다시 페어링하면 이어 간다 |
| F-07 | 키체인이 잠겨 있거나 사용자가 접근을 거부 | `keychain_unavailable`·`keychain_denied` | `blocked(keychain_denied)`, [다시 시도]. 토큰을 파일로 옮기지 않는다 |
| F-08 | macOS에서 앱을 다시 빌드한 뒤 키체인 확인 창 | OS 대화 상자 | 자체 서명 인증서로 서명하면 생기지 않을 것으로 본다(§3.10.7, 시험 항목). ad-hoc이면 "항상 허용"을 한 번 누른다 |
| F-09 | SSH 호스트 키가 바뀜(WSL 재설치 등) | `ssh_host_key_changed` | 자동 해결 없음. 경고와 함께 서버의 지문 출력(17 `helm doctor`)과 대조한 뒤 사용자가 `ssh-keygen -R`으로 지우라고 안내한다. 앱은 known_hosts를 고치지 않는다 |
| F-10 | 호스트 키를 처음 봄 | `ssh_host_key_unknown` | 터미널에서 `ssh server`로 한 번 접속하고 지문을 `helm doctor` 출력과 대조하라고 안내 |
| F-11 | 비밀번호가 걸린 키, 에이전트 없음 | `ssh_auth_failed`(BatchMode) | macOS `ssh-add --apple-use-keychain`, Windows `ssh-agent` 서비스 켜기 안내. WSS 경로가 있으면 그쪽으로 넘어간다 |
| F-12 | Windows에 OpenSSH 클라이언트가 없음 | `ssh_missing` | SSH 경로만 막힘. 선택적 기능 설치 안내. WSS 경로는 동작 |
| F-13 | sshd가 포워딩을 막음 | stderr `administratively prohibited` | `ssh_failed` + "서버가 포워딩을 막음". 17이 설정 확인(AS-4) |
| F-14 | macOS 26의 OpenSSH가 stderr에 PQ KEX 경고를 냄 | 종료 코드 0, 경고 줄 | 실패로 보지 않는다(§3.8.3) |
| F-15 | 프로토콜 버전이 맞지 않음 | `hello` 1003 | `blocked(incompatible_version)`, 오래된 쪽 갱신 안내(§3.12.7). 캐시 읽기는 된다 |
| F-16 | 스키마 해시가 바뀜(같은 프로토콜 버전의 additive 변경) | hello `features.schemaHash` | 해당 캐시 행을 버리고 다시 받는다 |
| F-17 | 데몬 저장소를 백업에서 복원(`storeId` 바뀜) | `2001 storeMismatch` | 이 서버의 뷰·위치를 지운다. 진행 중 명령함의 `unknown` 행은 자동으로 다시 보내지 않고 `expired`로 바꿔 사람에게 보인다(복원된 DB에는 그 멱등 키가 없어 다시 적용될 수 있다) |
| F-18 | 오래 접속하지 않아 밀린 이벤트가 정책 상한을 넘음 | `2001 tooFar` | 뷰를 낡음으로 두고 `head`부터 구독, 열린 뷰 다시 받기, 이력 화면에 "생략됨" |
| F-19 | 데몬 재시작 예고 | `server.shutdown`, 뒤이어 close 1001 | `restartExpectedMs` 동안 "데몬 재시작 중"으로 보이고 오류로 보이지 않는다(17 요구). 그 뒤 재시도 |
| F-20 | 같은 질문에 두 기기에서 답함 | 늦은 쪽이 3004 또는 이미 처리됨 | "이미 답했습니다(다른 기기)"(04 §3.0.5). 쓰던 답은 초안으로 남긴다 |
| F-21 | 결정을 보내는 중 앱이 죽음 | 다음 시작 때 `pending`의 `sending` 행 | `unknown`으로 바꾸고 `caughtUp` 뒤 같은 멱등 키로 다시 보내 결과를 받는다 |
| F-22 | IndexedDB가 자동으로 지워지거나 손상 | 열기 실패, 행 없음 | 데이터베이스를 지우고 다시 만든다. 위치가 없으니 `head`부터. 오프라인이면 `missing` 화면 |
| F-23 | IndexedDB 용량 초과 | `QuotaExceededError` | 오래된 비고정 뷰부터 지우고 다시 시도. 그래도 실패하면 이번 실행 동안 뷰 사본 저장을 멈추고 로그를 남긴다 |
| F-24 | tick이 오지 않음(반쯤 끊긴 연결) | `clientTimeoutMs`(35초) 초과 | close 4000, 바로 다시 연결(19 §3.2.6) |
| F-25 | 창을 숨긴 동안 웹뷰 타이머가 느려짐 | tick 감시가 늦게 돎 | 다음 메시지를 받을 때 벽시계로 다시 계산한다(타이머 횟수로 세지 않는다). 숨김 동안 알림이 늦으면 Q-06 |
| F-26 | 휘발 스트림 조각 유실 | 19 코어의 `n` 건너뜀 | 코어가 `run.partial`로 맞춘다. 앱은 결과만 그린다 |
| F-27 | 느린 연결에서 대량 재전송 | 데몬 송신 큐 | 데몬이 재생 속도를 맞춘다(19 §3.5.8). 그래도 4008이면 바로 다시 연결해 위치부터 |
| F-28 | 업로드 중 끊김 | `blob_upload` 실패 | 청크 업로드면 다시 연결 뒤 `HEAD`로 받은 바이트 수를 보고 이어 감. 한 번 업로드면 처음부터. 화면은 "올리는 중 끊김, 다시 시도" |
| F-29 | blob을 찾을 수 없음 | `GET /files/b` 404(`4002`) | 이미지 자리에 "파일을 찾을 수 없습니다" |
| F-30 | 앱이 비정상 종료해 ssh 자식이 남음 | - | `-W` 자식은 표준 입력이 닫히면 끝나므로 부모가 죽으면 같이 끝날 것으로 본다 [가정, §6 시험]. OpenClaw처럼 로컬 포트 터널을 쓰지 않아 고아 정리 장부가 필요 없다 |
| F-31 | 다른 데몬(개발용)에 붙음 | `hello.challenge.serverId` ≠ 프로필 | `blocked(wrong_server)`. 개발용 데몬은 별도 프로필로 만든다 |
| F-32 | 딥 링크 형식이 틀림, 다른 서버의 링크 | 형식 검사, `sid` 비교 | 무시하고 로그. `sid`가 다르면 프로필 전환을 묻는다 |
| F-33 | 앱이 꺼진 상태에서 딥 링크 실행 | macOS: 실행 인자, Windows: 실행 인자 | 시작할 때 `getCurrent()`로 받아 첫 경로로 쓴다(§3.9.2) |
| F-34 | 두 번째 실행(Windows) | 단일 인스턴스 플러그인 | 기존 창을 보이고 인자를 넘긴다 |
| F-35 | OS 알림이 꺼져 있음 | 데스크톱 플러그인은 권한을 늘 허용으로 돌려준다(§3.10.1) | 알 수 없다. `SCR-SETTINGS`에 "시스템 설정에서 Helm 알림이 켜져 있는지 확인하세요"를 늘 보인다. 질문함·배지는 그대로 동작 |
| F-36 | 전역 단축키를 다른 앱이 씀 | 등록 오류 | `SCR-SETTINGS`에서 다른 조합을 고르게 한다 |
| F-37 | 시스템 시계가 틀림 | `hello.challenge.serverTime`과 2분 넘게 차이 | `SCR-CONNECT`에 경고. 기기 서명을 켜면 1007이 날 수 있다 |
| F-38 | 앱을 갱신하는 동안 진행 중 명령이 있음 | `pending` 행 | IndexedDB에 남아 새 판이 이어서 다시 보낸다. 프로토콜이 맞지 않으면 `expired`로 보인다 |
| F-39 | WebView2가 없는 Windows(제거된 경우) | 설치 파일이 부트스트래퍼로 내려받음 | 오프라인이면 설치 실패. INSTALL.md에 안내 |
| F-40 | 프로필이 없고 네트워크도 없음(첫 실행) | - | `SCR-ONBOARD`에서 연결 방식만 저장하고 "연결되면 페어링" 안내 |
| F-41 | 서버 PC의 Windows 앱이 자기 tailnet 이름으로 접속하지 못함 | AS-5 실패 | Q-05의 직접 경로를 켠다 |

## 5. 다른 문서와의 인터페이스

### 5.1 이 문서가 제공하는 것

| 제공 | 받는 문서 |
|---|---|
| 앱 프로세스 경계(Rust 전송·키체인, 웹뷰 화면), IPC 명령·이벤트 목록(§3.4·§3.5) | 06, 18, 22 |
| SSH 경로의 클라이언트 구현(인자, 실패 분류, 호스트 키 정책, §3.8.3) | 18, 19, 17 |
| 연결 상태 기계와 04 사용자용 상태의 판정(§3.8.8·§3.8.9) | 04, 05, 21 |
| 뷰 캐시·위치·진행 중 명령함·초안의 저장 구조와 동기화 절차(§3.9.5~§3.9.7) | 19, 21, 22 |
| 앱 신선도 값(`current`·`refreshing`·`stale`·`missing`·`failed`)과 "다시 연결된 뒤 바뀜" 표시 규칙(§3.9.8) | 21(`FreshnessIndicator`), 04 |
| 라우터 구현(03 경로 표 그대로), 딥 링크 처리, 최소 창 크기(§3.9.2, §3.10.6) | 03 |
| OS 알림·트레이·배지·단축키·로그인 시 시작의 동작(§3.10), 알림 강도별 표시(§3.10.1) | 04 §3.24, 05, 11 |
| presence 보고 규칙(§3.9.12) | 11, 14, 16 |
| 빌드·배포 레시피 내용(`app-*`, `shot`, §3.12.2)과 Windows 빌드 경로 | 06, 23 |
| 앱 테스트 층과 시나리오 IT-01~16(§3.13) | 22, 19(적합성 도구의 가짜 서버 조작 목록) |

### 5.2 다른 문서에 요구하는 것

| 문서 | 요구 |
|---|---|
| 19 | (1) 클라이언트 코어의 표면을 §3.9.4의 `SessionCore`·`ClientStores` 수준으로 확정한다. 특히 이벤트 묶음에 "재전송 중" 여부, 낡은 뷰 표시(`viewsStale`), 위치 저장 때 낡음 표시를 같이 넘기는 저장소 인터페이스. (2) 코어가 자격 증명을 받지 않아도 동작하게 한다(데스크톱은 Rust 전송이 업그레이드 헤더를 붙인다). (3) `GET /healthz` 응답을 17과 맞춘다(19 `{"ok":true,"protocols":[1]}`, 17 `{"status":"ok"}`). (4) blob은 한 번 정해지면 내용이 바뀌지 않음, 다운로드 응답에 내용 해시(`ETag` 등), `blobId` 패턴. (5) `device.rotateToken`이 토큰을 JSON-RPC 결과로 돌려주면 데스크톱은 쓰지 않는다. 교체가 필요하면 HTTP 경로를 둔다(18과 함께). (6) `POST /pair` 응답 본문 `{serverId, deviceId, deviceToken}`. (7) `tray` 뷰에 04 §3.24의 항목(선택 필요 수, 확인하면 좋은 것 수, 진행 중 항목과 이동할 Concern ID, 방해 금지 끝 시각). (8) `agreement`·`review` 딥 링크 대상 ID에서 화면 경로 인자(`cnId`, `wuId`)를 얻는 방법(조회 메서드 또는 해당 뷰 데이터). (9) §3.13.3의 가짜 서버 조작 목록을 적합성 도구에 넣는다. (10) 재접속 백오프 값을 정하면 알려 준다(지금은 §3.8.8 값) |
| 06 | (1) 클라이언트 코어를 `@helm/client`에 둘지 `@helm/protocol`에 둘지 19와 맞춘다. 20은 06 배치(`@helm/client`)를 따랐다. (2) `createHelmClient`의 `credentials`를 선택 인자로(데스크톱은 넘기지 않는다). (3) Node 24는 24.15 이상(jsdom 30 요구). (4) `tailnet` 리스너 포트가 06 §3.6(`7801`)과 17 D17-09(`7840`)에서 다르다. 20은 17 값을 썼다. (5) §3.12.2 레시피를 `.just/helm.just`에, `app-check`를 `verify`에. (6) Rust 도구(`rust-toolchain.toml`, cargo-xwin)를 저장소 도구 목록에 넣는다. (7) 의존 규칙 표에 `apps/desktop/src/ui` → `sync`·`platform`·`@helm/client` 금지를 더한다 |
| 17 | (1) `helm device issue`가 `--json`을 받고 stdout에 `HELM-DEVICE/1 <json>` 한 줄을 쓴다. 비대화 SSH 셸에서 실행되도록 절대 경로나 `/usr/local/bin/helm` 링크를 둔다. (2) `helm pair` 출력에 `helm://pair?v=1&url=…&code=…&sid=…` 링크를 넣는다. (3) sshd 포워딩 허용을 유지한다(바꾸면 `PermitOpen 127.0.0.1:7841`). (4) `helm doctor`가 호스트 키 지문을 출력한다(17 §3.14에 있음, 유지). (5) `server.mode`의 값(`readOnly`, `safeMode`) 목록 |
| 18 | (1) 두 리스너 모두 업그레이드 헤더의 기기 토큰으로 인증한다(19 P-03, 20 APP-D04). (2) SSH로 서버 계정에 들어올 수 있으면 기기를 발급할 수 있다는 규칙(`helm device issue`). (3) Origin이 없는 네이티브 요청은 토큰으로 판정하고, 브라우저 Origin은 거부한다. (4) 기기 키 서명을 켤지(1차 기본 끔). (5) 클라이언트 기기의 오프라인 뷰 사본을 암호화하지 않아도 되는지(기본: 디스크 암호화에 맡김, 설정으로 끔). (6) 페어링 코드의 길이·수명·시도 횟수. (7) 데몬 텍스트를 렌더링할 때의 규칙(원시 HTML 금지, 링크 스킴 제한)을 21과 함께 |
| 09·11 | (1) 전달 결정 이벤트의 payload에 §3.10.1 `DeliveryPayloadForApp`의 필드(`deliveryId`, `surface`, `targetDevices`, `category`, `urgency`, `title`, `body`, `target`, `expiresAt`). 제목·본문에 질문 본문과 비밀을 넣지 않는다. (2) presence 값 네 가지 중 `locked`는 데스크톱이 보내지 못한다(§3.9.12) |
| 12 | (1) `tray` 뷰 생성(위 19-(7)). (2) 모든 `RecordRef`의 `revisionSeq`(재접속 뒤 바뀐 항목 표시). (3) 진행 중 메시지의 현재까지 텍스트를 `stream.subscribe`의 `active`나 `thread` 뷰로 준다 |
| 03 | (1) 딥 링크 표에 `helm://pair?…`를 더한다(처리는 `SCR-CONNECT`). (2) 빠른 입력(전역 단축키)이 여는 것: 전역 범위 `RGN-COMPOSER` 포커스로 충분한지 |
| 04·05 | (1) 앱 쪽 차단 사유의 문구: `ssh_auth_failed`, `ssh_host_key_unknown`, `ssh_host_key_changed`, `ssh_missing`, `wrong_server`, `protocol_error`, `keychain_denied`, "데몬 재시작 중". (2) 알림 클릭이 동작하지 않을 때의 배너 문구. (3) `SCR-CONNECT`의 "보내지 못한 조작" 목록과 다시 보내기. (4) Windows에서 처음 창을 숨길 때의 안내. (5) `SCR-ONBOARD` 끝의 "로그인할 때 Helm 시작" 질문. (6) `SCR-CONNECT`의 "자동 전환" 기본값을 켬으로(APP-D05). (7) `SCR-SETTINGS`의 OS 알림 확인 안내(F-35) |
| 21 | (1) `FreshnessIndicator`가 §3.9.8의 다섯 값을 받는다. (2) "다시 연결된 뒤 바뀜" 표시는 `uiStore.changedSinceReconnect`를 읽는다. (3) `helm-blob` 이미지가 503이면 "연결되면 보입니다" 자리 표시. (4) 마크다운 렌더링에서 원시 HTML을 끄고 링크 스킴을 `https`, `helm`으로 제한한다. (5) 컴포넌트는 `@helm/client`·`platform`을 가져오지 않는다 |
| 22 | §3.13의 층(웹 E2E 주 경로, 셸 스모크, 수동 체크리스트 §6.2)을 전체 테스트 전략에 넣는다 |
| 23 | 앱 구현 순서: 19 코어와 가짜 서버 → 앱 골격(라우터·셸·Rust 전송 WSS) → 동기화·캐시 → SSH 경로 → OS 통합 → 빌드·배포. 각 단계 완료 기준은 §6 |
| 24 | 문서 끝 ADR 후보 ADR-20-01~09를 옮긴다(P3) |

## 6. 구현 단위와 완료 기준

공통 완료 조건: `just verify` 통과(`app-check` 포함), 앱 화면을 바꿨으면 `just app-e2e`와 `just shot` 비교.

### 6.1 모듈별 완료 기준

| 단위 | 위치 | 완료 기준(테스트로 확인할 조건) |
|---|---|---|
| 프로필 저장·검증 | `src-tauri/src/profiles.rs`, `src-tauri/core/src/profile.rs`, `src/platform/types.ts` | TS와 Rust가 같은 표본(`fixtures/profile-validation.json`, 정상 20개·비정상 30개)에서 같은 판정을 한다. `-oProxyCommand=…`, 공백, 상대 경로 키 파일이 거부된다. 저장 중 앱을 죽여도 파일이 깨지지 않는다(임시 파일 + 이름 바꾸기) |
| 키체인 | `src-tauri/src/secrets.rs` | Mac·Windows 수동 확인: 저장·조회·삭제. 토큰 값이 IPC 응답·로그·진단 묶음에 없다(로그 grep 시험, 진단 묶음 내용 시험) |
| SSH 인자·실패 분류 | `src-tauri/core/src/ssh.rs` | 인자 목록이 §3.8.3과 같다(스냅샷). 실제로 모은 stderr 표본(macOS 15·26, Windows 11, Ubuntu 24.04)이 표대로 분류된다. PQ KEX 경고만 있는 경우 실패가 아니다 |
| WebSocket-over-stream | `src-tauri/core/src/ws.rs` | `tokio::io::duplex` 시험: 업그레이드 헤더 세 가지, 서버 ping에 pong, 바이너리 → 1003, 16 MiB 초과 → 닫힘, 송신 대기 4 MiB 초과 → 닫힘, `closed`가 정확히 한 번 |
| 전송 관리자 | `src-tauri/src/transport/` | 프로필당 연결용 전송 하나(두 번째 `transport_open`이 첫 번째를 닫음). 앱 종료 때 ssh 자식이 남지 않는다(Mac·Windows에서 프로세스 목록 확인, F-30) |
| SSH 경로 통합 | `just app-test-ssh` | WSL sshd + 가짜 데몬: 열림, `daemon_unreachable`, `ssh_auth_failed`, `ssh_host_key_unknown`이 각각 나온다 |
| blob | `src-tauri/src/blob.rs`, `core/src/blob_cache.rs` | 캐시 적중 시 네트워크 요청이 없다. 해시가 맞지 않으면 캐시에 쓰지 않는다. 연결이 없으면 503. 8 MiB 넘는 파일은 청크로 올라간다(가짜 서버) |
| 페어링 | `src-tauri/src/pairing.rs` | 코드 페어링과 SSH 발급 모두 결과 토큰이 키체인에만 있고 웹뷰 응답에는 `serverId`, `deviceId`만 있다. `HELM-DEVICE/1` 줄 앞의 셸 잡음 10줄을 무시한다 |
| capability·CSP | `src-tauri/capabilities/main.json`, `tauri.conf.json` | `app-check`의 정적 검사: 앱 명령 목록(`build.rs`)과 capability의 `allow-*`가 일대일, `shell`·`fs`·`http` 권한 없음, CSP `connect-src`가 `ipc: http://ipc.localhost`뿐, `remote.urls` 없음 |
| 연결 상태 기계 | `src/connection/machine.ts` | §3.8.8 전이 표의 각 행이 시험 한 줄. 표에 없는 쌍은 상태·효과 없음. 인증 계열에서 재시도 타이머가 없다 |
| 재시도 간격 | `src/connection/backoff.ts` | 0.5→30초, ±20%, `retryAfterMs`가 하한, 4008은 0 |
| 코어 연결 | `src/sync/session.ts`, `src/sync/stores.ts` | §3.13.1 행. IT-01~05 |
| 뷰 읽기 | `src/sync/views.ts` | 오프라인에서 캐시 행 반환, 늦은 응답이 새 값을 덮지 않음, `schemaHash` 불일치 행 폐기, 고정 뷰는 용량 정리에서 빠짐 |
| 명령 | `src/sync/commands.ts`, `src/intents/` | `live`가 아니면 보낼 수 없다. 끊김 뒤 같은 멱등 키 재전송(IT-06), 3004 → conflict(IT-07), `storeMismatch` 뒤 `unknown` 행은 자동 재전송하지 않음(F-17) |
| 초안 | `src/db/idb.ts` `drafts` | 입력 300ms 뒤 저장, 앱 재시작 뒤 복원, 보내기 성공 뒤 삭제, 자동 전송 없음 |
| 라우터 | `src/navigation/screens.ts`, `router.tsx` | 03 §3.5.5의 모든 화면 ID에 경로가 있다(타입 검사). 잘못된 ID 인자는 "찾을 수 없음". 시작 경로 우선순위(딥 링크 > 온보딩 > 마지막 경로 > 홈) |
| 딥 링크 | `src/navigation/deeplink.ts`, 플러그인 설정 | §3.10.6 표의 모든 형식(단위). 설치한 앱에서 수동 확인(§6.2) |
| 알림 | `src/platform/tauri/notifications.ts` | 재전송 중 전달은 띄우지 않음, `deliveryId` 중복 없음, `surface`·`targetDevices`·`expiresAt` 규칙(IT-12) |
| 트레이·배지 | `src-tauri/src/os/tray.rs`, `badge.rs`, `src/platform/tauri/tray.ts` | `tray` 뷰 값을 그대로 쓴다(앱이 세지 않음, 단위 시험: 뷰 표본 → `TraySummary`). 배지는 선택 필요 수만 |
| 오류 경계 | `src/errors/` | 화면 하나의 렌더 오류가 셸을 무너뜨리지 않는다(컴포넌트 시험). 모르는 오류 코드도 문구가 있다 |
| 빌드 | `app-build-local`, `app-build-win` | Mac: universal `.app`이 서명(자체 서명 또는 ad-hoc)되어 `/Applications`에서 열린다. Windows: NSIS 설치 파일이 Windows 11에서 관리자 권한 없이 설치·실행된다(수동). 태그 때 CI 빌드도 통과 |
| 셸 스모크 | `e2e/shell/` | `@wdio/tauri-service`로 Mac·Windows에서: 앱이 뜨고, 가짜 데몬에 연결해 홈이 보이고, 창 닫기 뒤 프로세스가 살아 있다 |

### 6.2 수동 확인 체크리스트 (출시 전, 플랫폼마다)

1. 알림: 실시간 전달에 OS 알림이 뜨고, 클릭하면 대상 화면이 열린다(2.6.0 `onAction`). 안 되면 대체 배너가 나온다.
2. 트레이: 메뉴 항목과 숫자가 `tray` 뷰와 같다. Windows 왼쪽 클릭 = 창 보이기.
3. 배지: macOS Dock 숫자, Windows 작업 표시줄 덧그림이 선택 필요 수와 같다.
4. 단축키: 사용자가 정한 조합으로, 다른 앱이 앞에 있을 때 빠른 입력이 열린다. 한글 입력 상태에서도 동작한다.
5. 로그인 시 시작: 켜고 재로그인하면 트레이만 뜬다(`--background`).
6. 딥 링크: 설치한 앱에서 `helm://question/<id>`, `helm://pair?…`가 동작한다. 앱이 꺼져 있을 때도.
7. 키체인: macOS에서 다시 빌드·설치한 뒤 확인 창이 다시 뜨는지(자체 서명 인증서와 ad-hoc 각각). 결과를 §7 Q-08에 기록.
8. SSH 경로: 실제 서버 별칭 `server`로 연결, WSS를 끈 상태에서 자동 전환.
9. 잠자기: Mac을 5분 재우고 깨우면 10초 안에 `live`로 돌아온다.
10. 숨긴 창: 창을 숨기고 30분 뒤 실시간 전달 알림이 제때 뜬다(AS-6, Q-06).

## 7. 미결 사항

| 번호 | 질문 | 선택지 | 추천 기본값 |
|---|---|---|---|
| Q-01 | 클라이언트 코어의 위치 | `@helm/protocol` 안(19) / `@helm/client` 별도(06) | `@helm/client`(06). 프로토콜 타입 패키지를 가볍게 두고 런타임 코드를 나눈다. 19·06이 맞추면 따른다 |
| Q-02 | 전송을 Rust가 가질지 웹뷰 WebSocket이 가질지 | Rust(APP-D02) / 웹뷰 WebSocket + Rust는 SSH 로컬 포트만 | Rust. 토큰이 웹뷰에 없고, 로컬 포트를 열지 않고, CSP에 원격 주소가 없다. IPC 처리량이 문제가 되면(측정 기준: 초당 1,000 메시지에서 화면이 밀림) 다시 본다 |
| Q-03 | 연결이 없을 때 결정 대기열 | 두지 않음 / 두고 다시 연결 뒤 자동 전송 | 두지 않음(04 ADR A4). 초안만 남긴다 |
| Q-04 | 기기 키 서명(챌린지 nonce) | 토큰만 / 토큰 + Ed25519 서명 | 토큰만. 18이 켜면 `device_sign_challenge`를 넣는다 |
| Q-05 | 서버 PC의 Windows 앱을 위한 직접 경로(`ws://127.0.0.1:7840`) | 두지 않음 / 둠 | 두지 않음(06 §3.6과 같음). AS-5가 틀리면 `tailnet` 리스너 직접 연결 대신 `loopback`(7841) 직접 연결을 프로필 종류 `local`로 더한다(Tailscale 헤더 없이 토큰만 받는 리스너라 맞다) |
| Q-06 | 창을 숨긴 동안 알림 지연 | 웹뷰 JS가 처리 / Rust가 전달 이벤트를 직접 보고 알림 | 웹뷰 JS. §6.2-10에서 지연이 보이면 Rust가 들어오는 프레임에서 전달 이벤트만 골라 알림을 띄운다(그때는 Rust가 이벤트 형식 하나를 알게 된다) |
| Q-07 | Windows 자격 증명 보존 범위 | 로컬 / 로밍(크레이트 기본) | 로컬. 크레이트가 지원하지 않으면 로밍(1인, 도메인 계정 아님이라 영향 작음) |
| Q-08 | macOS 서명 | 자체 서명 인증서 / ad-hoc | 자체 서명 인증서. §6.2-7로 키체인 확인 창이 없는지 확인한 뒤 확정 |
| Q-09 | 자동 업데이트 | 없음 / updater 플러그인 + 데몬이 서빙하는 매니페스트 | 1차 없음. Windows 갱신이 한 달에 두 번 넘게 필요해지면 2차 후보를 넣는다 |
| Q-10 | 서버 상태 라이브러리 | TanStack Query / RTK Query / 직접 | TanStack Query. 사용자가 다른 것을 선호하면 `sync/views.ts` 안에서만 바꾸면 된다 |
| Q-11 | Windows 빌드 기본 경로 | WSL 교차 빌드 / GitHub Actions | 교차 빌드. 첫 구현에서 교차 빌드가 세 번 넘게 막히면 CI를 기본으로 바꾼다 |
| Q-12 | macOS 빌드 대상 | universal / arm64만 | universal. 빌드가 5분을 넘게 걸리면 arm64만 |
| Q-13 | 오프라인 뷰 사본 | 평문 IndexedDB / 끔 / 암호화 | 평문 + 끌 수 있음(18이 정하면 따름) |
| Q-14 | 알림의 동작 단추 | 없음 / "가정대로 진행" 등 | 없음. 결정은 질문을 본 화면에서만 |
| Q-15 | SSH known_hosts | 사용자 파일 / 앱 전용 파일 | 사용자 파일. 별칭 `server`를 이미 쓰고 있다 |
| Q-16 | 경로 자동 전환 기본값 | 켬(`ordered`) / 끔(`pinned`) | 켬. 04 `SCR-CONNECT`의 확인란을 기본으로 켜 달라고 요구했다 |
| Q-17 | assistant-ui 사용 여부 | 21 결정 | 21 UI-D11을 따른다. 쓰지 않게 되면 §3.9.10만 빠진다 |

## 8. 출처

- 브리프: `docs/design/process/00-design-brief.md` 결정 10, 12, 14, 19~26, 29, 31~33, 36~38, §2.5, §3.1~§3.4.
- 다른 설계 문서(1단계 초안, 2026-10-11 읽음): `03-ux-information-architecture.md` §3.4~§3.6, §4~§6; `04-ux-screens.md` §3.0, §3.19, §3.24, §3.25, §5, §6, ADR A4; `06-system-architecture.md` §2, §3.4.13~§3.4.15, §3.6, §3.12, §3.16; `17-daemon-and-operations.md` §2.3 D17-09, §3.5, §3.10, §3.14, §3.15, §5.2; `19-client-protocol.md` §1~§3.7; `21-desktop-ui-system.md` §2.2, §2.3, §3.1, §3.2.
- 원천 정리: `helm-canon.md` §12.10, §12.12, §16.8, §17.6, 체크리스트 20; `helm-canon-2.md` §3.15, §3.16, §8.6, §8.7, L14, 체크리스트 20; `helm-canon-3.md` §6.4, §6.5.1, §6.7, §6.10, §6.11, §6.13, §6.18, §7.1 C6·C7, §7.2 G11·G12, §8 문서 20; `conversation-extracts-4.md` §13.4, §15, §20(20-9~20-11, 20-20), §21(d25); `pi-api-facts-2.md` §0, §5, §6, §8, §13, §14; `pi-cases-notes.md` §1, §3.3, §3.7, §11.1, §11.2, §11.3, §12, §14.
- 사례 메모와 코드: `.helm-design-work/S4/paseo.md`(§3, §4, §7), `openclaw-gateway.md`(§1.5, §2, §3), `openclaw-runtime.md`(§3.4), `pi-web.md`(§3, §7). 직접 확인한 코드 [원문]: `~/projects/_ref/paseo/packages/protocol/src/ssh-transport.ts:17-82`, `packages/desktop/src/daemon/local-transport.ts:83,196-264`, `.github/workflows/desktop-release.yml:320`(Windows 러너); `~/projects/_ref/openclaw/apps/macos/Sources/OpenClaw/RemotePortTunnel.swift:116-312`, `CommandResolver.swift:322-354,502-523`, `docs/platforms/mac/remote.md:101-130`, `docs/platforms/mac/menu-bar.md:15-80`; `~/projects/_ref/pi-src/packages/env/src/ssh.ts:77-117`, `docs/protocol.md:9,35,55,62`.
- 홈랩(읽기만): `~/projects/homelab/context/machines.md`, `network.md`; `~/projects/.stignore-dev`; `~/.local/bin/run-on`.
- v0.3: `09-client-opdc.md`, `12-implementation-architecture.md` §9~§11, `13-stack-feasibility.md` §2.4, `14-alternative-structure.md` §5; `audit/backend-oss-research.md` §3~§6.
- 외부 사실 [검색](2026-10-11, 보조 에이전트가 공식 문서·레지스트리·소스로 확인): Tauri v2(v2.tauri.app의 capabilities, CSP, isolation, system-tray, deep-linking, notification, updater, windows-installer, sign/macos, sign/windows, tests/webdriver, tests/mocking), tauri 2.12.3 소스(`crates/tauri/src/manager/mod.rs`, `webview/mod.rs`, `window/mod.rs`, `tauri-bundler/src/bundle/macos/app.rs`), plugins-workspace v2(notification 2.6.0 CHANGELOG·desktop.rs, 이슈 #3494), tauri 보안 권고(GHSA-7gmj-67g7-phm9, GHSA-w28w-mhc8-qvjv), crates.io·npm 버전, keyring-rs 이슈 #272, Microsoft `CREDENTIALW` 문서, Win32-OpenSSH Project Scope, VS Code 원격 문제 해결 문서, Apple 개발자 뉴스(2024-08-06)와 지원 문서 mh40616, WebKit 저장소 정책(webkit.org/blog/14403), aws-lc-rs Windows 요구, eclecticlight.co(macOS 26.3 OpenSSH), React Router·TanStack·Vitest·jsdom·MSW·Playwright·Storybook 레지스트리.

### 8.1 원천 체크리스트 반영표 (문서 20 해당 항목)

| 출처 | 항목 | 처리 | 위치 |
|---|---|---|---|
| canon-3 §8 문서 20-1 | Electron 보안 지침을 Tauri로: 렌더러 권한 최소화, restrictive CSP, IPC 범위 제한, 원격 콘텐츠 분리, OS 키체인 | 반영. 앱 매니페스트로 명령을 막고, CSP `connect-src`에 원격 주소가 없고, 원격 URL capability가 없고, 토큰은 Rust와 키체인에만 | §3.6, §3.10.7 |
| canon-3 §8 문서 20-2 | deep link 복귀, 전달 정책을 따르는 native 알림, 전역 quick capture·command palette, offline 읽기·검토와 재접속 동기화 | 반영 | §3.10.6, §3.10.1, §3.10.4, §3.9.6·§3.9.8 |
| canon-3 §8 문서 20-3 | 앱에 Helm 로직 없음. 원전 flow의 UI = 앱, G = 데몬 커널 | 반영(APP-D01, 뷰 무효화도 데몬이 계산) | §3.1, §3.9.6 |
| canon-3 §8 문서 20-4 | 메뉴바·트레이에 active-run 요약과 선택 필요 개수 | 반영. 값은 `tray` 뷰(12·19에 요구) | §3.10.2 |
| canon-3 §6.10.2 | 데스크톱 가치 8개 | background run과 crash recovery는 데몬(17·12), update 보호는 진행 중 명령함이 갱신을 넘어 남는 것(F-38)과 17 업그레이드 절차, credential mediation은 기기 토큰만(§3.8.7), project identity는 데몬 | §3.8.7, §4 F-38 |
| canon-3 §7.1 C6·C7 | Web GUI 선검증 대신 데스크톱 먼저, local core = 데몬 | 반영. ADR-20-04 | §3.11 |
| canon-3 §7.2 G11·G12 | Recovery 화면, Trust(권한·연결) 화면 | 화면은 03·04(`SCR-RECOVERY`, `SCR-CONNECT`)가 정했다. 앱은 연결 점검(`route_check`), 기기 목록(`devices` 뷰), 보내지 못한 조작 목록을 준다 | §3.4.2, §3.9.7 |
| canon §문서 20 체크리스트 | Client 소유 범위(surface, 상호작용 표현, 접근성, progressive disclosure, 알림 채널) | 알림 채널은 반영(§3.10.1). 접근성·점진 공개는 21 | §3.10.1 |
| canon §문서 20 체크리스트 | 알림 기준: 할 일과 마감 효과만, 단순 진행 금지, 낮은 우선순위는 복귀 요약에(§17.6, `preferred_review_windows`, `batch_low_urgency_until` §12.10) | 반영. 기준은 데몬 전달 정책(11·14)이 지키고 앱은 전달된 것만 띄운다 | §3.10.1 |
| canon §문서 20 체크리스트 | 금지 상호작용 2(모든 진행 Event를 실시간 알림으로) | 반영 | §3.10.1 |
| canon-2 문서 20-1 | 앱은 얇은 client, UI에만 있는 business action 금지(headless parity) | 반영. 모든 결정은 19 명령 메서드로 가고, 같은 메서드를 TUI·CLI가 쓴다. 앱 전용 동작은 연결·OS 기능뿐 | §3.3, §3.9.7 |
| canon-2 문서 20-2 | 상태 기계 4개를 클라이언트 저장소에서 분리 | 반영. 연결(§3.8.8)과 뷰 신선도(§3.9.8)는 앱이 따로 두고, 에이전트 루프·WorkUnit 상태는 뷰 데이터 그대로 그린다(앱이 합치지 않는다) | §3.8.8, §3.9.8 |
| canon-2 문서 20-3 | Gate의 cursor binding(stale Gate 표시) | 반영. `basisSeq` 필수, 3004 → "바뀐 내용 보기", 낡은 뷰에서 결정 버튼 막힘 | §3.9.7 |
| canon-2 문서 20-4 | experimental 웹 GUI 정보 구조는 참고만, Capture 폼은 diagnostic | 반영하지 않음(가져올 구조 없음). 03·04가 화면을 새로 정했다. 보안 헤더 등 서버 쪽 재사용은 19 §3.2.5 | - |
| 발췌4 20-9·20-10 | 사람 결정은 서버 결정 명령으로, 모델의 앱 상태 수정은 제안으로만 | 반영. 앱은 낙관적 갱신을 하지 않고, assistant-ui 도구 결과 경로를 쓰지 않는다 | §3.9.7, §3.9.10 |
| 발췌4 20-11 | ExternalStoreRuntime + 자체 스트림, AssistantTransport 미사용, React 18 | 반영 | §3.9.10 |
| 발췌4 20-20 | 클라이언트 기기가 잠자기·오프라인이면 쓰기 실패 → 데몬 상주 배경 | 반영. 앱은 상태를 갖지 않고 잠자기 뒤 `PROBE`로 이어 간다 | §3.8.8, F-03 |
| 발췌4 d25 | assistant-ui를 Tauri에서 쓸 때의 제약 | 답함. CSP 안에서 동작, 원격 자원 없는 부품만, 범위는 21 | §3.9.10 |
| facts-2 §0-2·§6 | pi-client는 재접속·재전송을 하지 않는다. 투영은 스냅샷+delta와 함께 쓸 수 있다 | 반영. 재개는 19 코어가 하고, 뷰는 delta 대신 무효화 + 다시 받기(19 P-07) | §3.9.6 |
| facts-2 §0-5·§8·§13 | pi-env SSH 부트스트랩(호스트 키 고정, BatchMode, 포워딩 금지, 동기화 줄) | 반영. BatchMode·엄격한 호스트 키·다중화 끄기, 동기화 줄은 SSH 페어링에만. 앱 전용 known_hosts와 HostKeyAlias는 쓰지 않음(사용자 별칭을 쓰기 위해, Q-15) | §3.8.3, §3.8.7 |
| facts-2 §14 | pi-client를 Tauri 웹뷰에서 WebSocket으로 연결해 본 적 없음 | 해당 없음. pi-client를 쓰지 않고, 웹뷰는 WebSocket을 열지 않는다 | §3.2 |
| pi-cases-notes §1-1, §11.2, §12.2-1 | 8곳 모두 클라이언트 seq를 메모리에 둔다. 재시작을 넘는 재전송 사례 없음 | 반영. Helm은 SQLite seq를 위치로 쓰고(19), 앱은 위치와 낡음 표시를 함께 영속한다. 사례에서 가져온 것은 순서·경계·세대 감지 | §3.9.6 |
| pi-cases-notes §12 (P13) | 리소스 version 체인과 If-Match 409에 현재값 | 19의 `expect`(revision)와 3004 `rebase`로 반영 | §3.9.7 |
| pi-cases-notes §12 (P13) | 캐시 우선 표시와 늦은 캐시 읽기가 진전된 상태를 덮지 않음 | 반영 | §3.9.6 `fetchView` |
| pi-cases-notes §12 (P13) | 오프라인 송신 outbox(멱등 키, 상한, 만료) | 일부만. 결과를 모르는 명령의 재전송은 반영, 연결 없을 때 새 결정 대기열은 두지 않음(04 ADR A4) | §3.9.7 |
| pi-cases-notes §14 P13 지도 | happy-agent `HappyReducer`(외부 스토어, 스트림 먼저 스냅샷 나중, dirty 재동기화 동시 3개), paseo `session-stream-reducers`(판정표), pi-web `sessionController`(버퍼 → 스냅샷 → `seq >` 적용), openclaw `ios.md`(outbox) | 반영: 동시 다시 받기 4개, 구독 먼저, 위치 판정은 19 코어. outbox는 위 행 | §3.9.6 |
| pi-cases-notes §12.1-8 | 큰 파일: 업로드 원시 바이트 → ID, 다운로드 짧은 티켓, WS에는 ID만 | 반영. 데스크톱은 티켓 대신 Rust가 헤더를 붙인다 | §3.8.6 |
| pi-cases-notes §12.2-8 | loopback 자동 승인 금지 | 반영(두 경로 모두 토큰) | §3.8.7 |
| 발췌1·2·3 끝 목록 | 문서 20에 배정된 항목 없음 | 해당 없음 | - |

## ADR 후보

조정자가 2단계에서 `24-adr.md`로 옮긴다.

### ADR-20-01. 데몬과의 전송은 Rust가 소유하고 웹뷰는 텍스트 프레임만 받는다

- 상태: 제안
- 맥락: 결정 32는 앱을 얇은 클라이언트로 둔다. 결정 26은 기기 bearer 토큰을, 결정 38은 SSH 경로를 요구한다. 브라우저 WebSocket은 업그레이드 헤더를 붙일 수 없고 프로세스를 띄울 수 없다.
- 결정: WSS와 SSH 모두 Rust가 바이트 연결, TLS, WebSocket 업그레이드(`Authorization` 헤더 포함)를 하고, 웹뷰에는 Tauri 채널로 텍스트 프레임만 넘긴다. 프로토콜 처리(19 코어)는 웹뷰 TS가 한다. 토큰은 키체인과 Rust에만 있다.
- 근거: 웹뷰 XSS가 있어도 토큰을 읽을 수 없다. CSP `connect-src`에 원격 주소가 없다. 두 경로가 같은 코드로 같은 바이트를 보낸다(결정 38). 로컬 포트를 열지 않는다.
- 기각한 대안: (1) 웹뷰 WebSocket + 토큰을 hello 인자로 — 토큰이 JS 메모리에 있다. (2) 웹뷰 WebSocket + SSH만 Rust의 로컬 포트 터널 — 같은 기기 다른 프로세스가 포트를 쓸 수 있고 mixed content·Origin 처리가 두 갈래가 된다. (3) `tauri-plugin-websocket` — 같은 Rust 클라이언트이지만 JS에서 헤더를 넘겨야 하므로 토큰이 JS를 지난다.
- 결과: Rust에 WebSocket-over-stream 코드(약 수백 줄)가 생긴다. 메시지마다 IPC를 한 번 지난다. 19 P-03(헤더 인증)과 맞물린다.

### ADR-20-02. SSH 경로는 시스템 OpenSSH의 `ssh -W 127.0.0.1:<loopback 포트>`로 연다

- 상태: 제안(19 ADR 후보 19-A1과 같은 선택)
- 맥락: 결정 38은 SSH 경로의 구체 방식을 P11·P12·P13이 정하라고 했다. 사용자의 Mac에는 dotfiles가 관리하는 별칭 `server`가 있다. Windows `ssh.exe`는 ControlMaster와 `-f`를 지원하지 않는다.
- 결정: Rust가 `/usr/bin/ssh`(macOS), `System32\OpenSSH\ssh.exe`(Windows)를 `-T -o BatchMode=yes … -W 127.0.0.1:7841 -- <target>`으로 띄우고 그 표준 입출력 위에서 WSS 경로와 같은 HTTP 업그레이드를 한다. 호스트 키는 기본 엄격, known_hosts는 사용자 파일.
- 근거: 사용자 SSH 설정·에이전트·known_hosts를 그대로 쓴다. 서버 쪽 브리지가 필요 없고 셸 시작 잡음이 섞이지 않는다. 로컬 포트를 열지 않는다. Paseo 데스크톱이 같은 방식을 macOS·Windows에서 쓴다.
- 기각한 대안: `ssh -N -L`(로컬 포트 노출, 포트 경합, OpenClaw의 고아 터널 정리 필요), exec + `helm bridge`(서버 부품, 동기화 줄 필요, 예비로만), Rust `russh`(ssh_config·에이전트·known_hosts를 직접 구현), `ssh2`(Windows ed25519·OpenSSL 빌드 문제).
- 결과: 전송마다 SSH 핸드셰이크. stderr 문자열로 실패를 분류하므로 표본 시험이 필요하다. sshd 포워딩 허용이 전제다(17).

### ADR-20-03. 서버 하나에 경로 여러 개, 순서대로 시도하고 연결 중에는 바꾸지 않는다

- 상태: 제안
- 맥락: WSS와 SSH 경로가 같은 데몬으로 간다. 한쪽 경로만 고장 나는 경우(serve 설정 누락, sshd 정지)가 있다.
- 결정: 프로필은 `serverId` 하나와 경로 배열을 갖는다. 네트워크 계열 실패와 SSH 경로의 SSH 차단 실패에만 다음 경로로 넘어간다. 토큰·버전·`serverId` 문제는 넘어가지 않는다. 연결된 뒤에는 경로를 바꾸지 않고, 계속 실패하는 경로는 30분 뒤로 미룬다.
- 근거: 경로를 바꿔도 같은 결과인 실패에서 시간을 쓰지 않는다. 동시 시도는 SSH 인증 로그와 서버 부하만 늘린다. 캐시는 `serverId` 단위라 경로가 바뀌어도 그대로다.
- 기각한 대안: 동시 시도(happy eyeballs), 연결 중 더 나은 경로로 옮기기(재전송 의미는 같지만 이유 없는 재접속이 생긴다), 경로마다 프로필 따로(캐시가 갈라진다).
- 결과: 04 `SCR-CONNECT`의 "자동 전환" 확인란 기본값을 켬으로 둔다.

### ADR-20-04. UI는 앱에 묶어 배포한다

- 상태: 제안
- 맥락: 데몬이 SPA를 서빙하면 버전이 늘 맞지만, 원격 origin에 IPC 권한을 줘야 하고 오프라인 시작이 안 된다. 백엔드 조사는 "데몬이 같은 SPA를 웹으로도 서빙"을 제안했다.
- 결정: SPA를 앱 번들에 넣고 데몬은 정적 파일을 서빙하지 않는다(19 §3.2.5와 맞음).
- 근거: 오프라인으로 시작해 캐시를 읽을 수 있다. 원격 콘텐츠와 로컬 권한을 섞지 않는다(canon-3 §6.10.1). 결정 19(웹 아님).
- 기각한 대안: 데몬 서빙(위 이유), 둘 다(웹 클라이언트를 만드는 셈).
- 결과: 앱·데몬 버전 불일치를 hello의 프로토콜 범위와 기능 목록으로 다룬다(§3.12.7).

### ADR-20-05. 서버 상태는 뷰 단위 TanStack Query 캐시 + IndexedDB, 앱은 이벤트를 접지 않는다

- 상태: 제안
- 맥락: 결정 32(앱에 Helm 로직 없음). 19는 뷰 + 무효화 태그 방식을 택했다(19 P-07).
- 결정: 화면 데이터는 `view.get` 결과를 TanStack Query 5에 두고 IndexedDB에 사본을 둔다. 이벤트는 무효화 신호로만 쓴다. 위치와 낡음 표시는 한 IndexedDB 트랜잭션에 기록한다. UI 상태는 zustand.
- 근거: 접기 규칙(도메인 지식)이 앱에 없다. 오프라인 읽기가 된다. 크래시 뒤에도 낡은 캐시를 안다.
- 기각한 대안: 앱에서 이벤트를 접어 상태 만들기, Chord식 상태 복제, 전부 zustand에 직접.
- 결과: 화면을 열 때와 무효화 때 `view.get` 왕복이 생긴다. 1인 사용 규모에서 감수한다.

### ADR-20-06. Windows 설치 파일은 WSL에서 교차 빌드하고 CI를 대체 경로로 둔다

- 상태: 제안
- 맥락: 브리프 §2.5는 Windows 호스트의 도구를 쓰지 않는 방향이다. Tauri 공식 문서는 Linux에서의 교차 빌드를 "마지막 수단"이라고 한다.
- 결정: `cargo-xwin`으로 NSIS 설치 파일을 WSL에서 만든다. 태그 때 GitHub Actions Windows 러너가 같은 커밋을 빌드해 확인하고, 교차 빌드가 깨지면 그 산출물을 쓴다.
- 근거: 로컬에서 바로 만들 수 있고 push(사용자 확인)가 필요 없다. 개인 앱이라 MSI가 필요 없다. Rust 의존을 교차 빌드에 쉬운 쪽(rustls+ring)으로 골랐다.
- 기각한 대안: Windows 호스트 수동 빌드(브리프 방향과 어긋남), CI만(push마다 확인 필요), Windows VM.
- 결과: `app-setup`에 nsis·lld·llvm 설치(sudo, 사람)가 필요하다. 교차 빌드가 세 번 넘게 막히면 CI를 기본으로 바꾼다(Q-11).

### ADR-20-07. 1차에는 자동 업데이트를 넣지 않는다

- 상태: 제안
- 맥락: Tauri 업데이터는 별도 서명 키가 필수이고 매니페스트를 호스팅해야 한다. 사용자는 한 명이고 Mac 빌드는 그 Mac에서 한다.
- 결정: Mac은 `app-install-mac`으로 다시 빌드해 바꿔 넣고, Windows는 새 설치 파일을 실행한다. 앱은 hello에서 호환을 확인하고 안내한다.
- 근거: 키·매니페스트·호스팅 없이 시작할 수 있다. SSH만 쓰는 상황에서는 매니페스트에 접근할 수도 없다.
- 기각한 대안: 업데이터 + 데몬이 서빙하는 매니페스트(2차 후보), GitHub Releases(공개 저장소 필요).
- 결과: Windows 갱신은 사람이 한다.

### ADR-20-08. macOS 앱은 Mac에서 만든 자체 서명 코드 서명 인증서로 서명한다

- 상태: 제안(시험 뒤 확정, §6.2-7)
- 맥락: 결정 24로 Apple 공증·서명 배포는 범위 밖이다. Tauri는 서명 정체가 없으면 번들 서명을 건너뛴다. 키체인 항목 접근은 코드 서명 정체에 묶여 ad-hoc 빌드는 다시 빌드할 때마다 확인 창이 뜬다.
- 결정: 그 Mac의 로그인 키체인에 자체 서명 "코드 서명" 인증서를 한 번 만들고 `bundle.macOS.signingIdentity`로 쓴다. 없으면 ad-hoc(`"-"`).
- 근거: 같은 인증서로 서명하면 지정 요구 사항이 같아 확인 창이 다시 뜨지 않을 것으로 본다. 배포 서명이 아니므로 결정 24 범위 안이다.
- 기각한 대안: 서명 없음("손상됨" 오류), ad-hoc만(갱신마다 확인 창), 키체인 대신 파일 저장(토큰 보호 약화).
- 결과: Mac 설정에 인증서 만들기 한 단계가 생긴다(INSTALL.md).

### ADR-20-09. E2E는 브라우저에서 같은 SPA를 가짜 데몬에 붙여 하고, 셸은 스모크만 한다

- 상태: 제안
- 맥락: `tauri-driver`는 macOS를 지원하지 않는다. `@wdio/tauri-service`가 앱 안 WebDriver로 macOS를 지원하지만 OS UI(알림, 트레이, 딥 링크 등록)는 자동화할 수 없다.
- 결정: 시나리오 E2E(IT-01~16, 유즈케이스 화면 경로)는 Playwright(Chromium, WebKit)로 서버에서 돈다. 실제 셸은 `@wdio/tauri-service` 스모크(Mac, Windows)와 수동 체크리스트로 확인한다.
- 근거: 서버에서 매번 돌릴 수 있고 Mac이 잠들어도 막히지 않는다. 앱의 로직은 웹뷰 쪽에 있어 브라우저 대체 실행으로 대부분을 덮는다.
- 기각한 대안: 모든 E2E를 셸에서(느리고 Mac 의존), E2E 없음.
- 결과: `platform/browser/` 대체 구현을 유지해야 한다(배포 빌드에서는 빠진다).

