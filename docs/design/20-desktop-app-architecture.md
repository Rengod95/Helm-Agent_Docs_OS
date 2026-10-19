# 20. 데스크톱 앱 아키텍처

- 작성: P13(데스크톱 앱), 2026-10-11. 1단계 초안
- 상태: 4c 보완판(2026-10-14). 기준 결정은 브리프 결정 1~64과 판정 `rulings-stage2a.md`(§1~§11, J-01~J-276)다. 03·04·05·06·07·09·11·16·17·18·19·21·26의 같은 시기 판과 맞췄다.
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
| 모바일 클라이언트와 나눠 쓸 코드 경계 | §3.14 |

### 1.3 다루지 않는 것

- 데스크톱용 웹 클라이언트. [결정 19]는 데스크톱에서 웹 클라이언트를 두지 않는다. 데몬은 데스크톱 SPA를 서빙하지 않는다(§3.11). 모바일 PWA(`/m/`)는 예외다([결정 47], 26).
- 모바일 클라이언트 자체. [결정 42]로 범위에 들어왔고, 데몬이 서빙하는 PWA와 Web Push로 정해졌다([결정 47·48·49]). 설계는 26(P15)이 한다. 이 문서는 나눠 쓸 코드 경계만 정한다(§3.14).
- TUI. 결정 33·39에 따라 `@helm/tui`가 따로 만든다. 다만 이 문서의 동기화 알고리즘(§3.9.6)은 전송과 화면에서 떨어진 순수 모듈로 두어 TUI가 재사용할 수 있게 한다.
- 로컬 데몬. 앱은 데몬을 띄우거나 소유하지 않는다. Paseo(데스크톱이 데몬을 하위 프로세스로 띄움, S4 paseo.md §1)나 OpenClaw의 Local 모드(launchd로 Gateway 상주, S4 openclaw-gateway.md §3.2)와 다르다. 데몬은 WSL에만 있다(결정 20).
- Helm 도메인 로직. 투영 계산, 상태 전이, 질문 전달 시점 판단, 알림 여부 판단은 앱에 두지 않는다(결정 32).
- Apple 공증·코드 서명 인증서, Microsoft 코드 서명. 결정 24로 범위 밖이다. [결정 57]에 따라 Apple 개발자 프로그램이 지금 없다고 본다(만료 추정). 그래서 공증 배포는 이후에 검토한다. 서명 없는 개인 배포 절차만 다룬다(§3.12.5).

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
| `storeId` | 데몬 이벤트 저장소의 정체. 저장소를 복원하거나 새로 만들면 바뀐다. 이 값이 바뀌면 seq가 되돌아갔을 수 있다. 클라이언트는 저장한 값과 비교한다 |
| `asOfSeq` | 뷰 응답이 어느 seq까지 반영한 것인지 |
| `basisSeq` | 사람이 결정할 때 화면이 보고 있던 뷰의 `asOfSeq`(21 UI-D02, 19 §3.7.2와 같은 이름) |
| 멱등 키 | 명령 하나를 가리키는 클라이언트 생성 ID. 재전송해도 데몬이 한 번만 처리한다 |
| 진행 중 명령함(in-flight outbox) | 보냈지만 응답을 받지 못한 명령의 목록. IndexedDB에 둔다 |

표시 규칙은 브리프 §5.2와 판정 J-144를 따른다. `[결정 n]`은 사용자가 정한 브리프 결정 번호에만 쓴다. 조정자 기본값은 `[제안: 결정 n 기본값]`, 조정자 판정은 `[판정 n]`(브리프 결정 44~46) 또는 `[판정 J-nn]`으로 적는다. `[제안]`은 이 문서가 정한 것, `[가정]`은 확인되지 않은 전제다. 외부 사실에는 `[원문]`, `[실험]`, `[검색]`, `[지식]`을 붙인다. 원천 인용은 03·21과 같은 약칭을 쓴다: "canon §12.10"(`docs/design/process/sources/helm-canon.md`), "canon-2 §3.16", "canon-3 §6.10", "발췌4 20-11"(`conversation-extracts-4.md`), "facts-2 §6.1"(`pi-api-facts-2.md`), "S4 paseo §3"(`.helm-design-work/S4/paseo.md`).

## 2. 전제와 결정

### 2.1 브리프 결정에서 오는 전제

| 브리프 결정 | 이 문서에서의 뜻 |
|---|---|
| 10 | 앱의 첫 화면은 상태다. 대화는 객체에 딸린 보조 수단이다(03 §3.1, 21 UP-1). 앱 구조도 투영(뷰) 여러 개를 캐시하고 갱신하는 형태로 짠다(§3.9). 대화 하나를 스트리밍하는 앱의 구조와 다르다 |
| 12 | 질문을 언제 사람에게 알릴지는 데몬이 전달 방식(즉시·협상·중재·예약)으로 정한다. 앱은 데몬이 "전달한다"고 보낸 것만 OS 알림으로 띄운다(§3.10.1) |
| 14 | 모델은 제안하고 커널이 상태를 바꾼다. 사람의 결정도 커널 명령으로 간다. 앱은 낙관적 도메인 갱신을 하지 않는다(§3.9.7, 21 UI-D03) |
| 19 | 클라이언트는 데스크톱 앱이 먼저다. 데스크톱용 웹 클라이언트는 만들지 않는다. 휴대폰 PWA는 결정 47의 예외다 |
| 20, 22 | 데몬은 제품 소유자의 WSL2 서버에 상주하고 앱이 없어도 작업이 계속된다. 앱은 데몬을 띄우지 않는다 |
| 21, 26 | 외부에서 접속한다. 기본 경로는 Windows 호스트의 `tailscale serve`가 노출한 HTTPS/WSS다. 데몬은 WSL 안 `127.0.0.1`에만 바인딩한다. 인증은 Tailscale 신원 헤더와 기기별 bearer 토큰이다 |
| 24, 57 | macOS와 Windows를 지원한다. Apple 공증·서명 배포는 범위 밖이다. 57은 Apple 개발자 프로그램이 지금 없다고 본다(만료 추정)는 결정이라 공증 배포는 이후에 검토한다(§1.3) |
| 31 | JSON-RPC 2.0 over WebSocket. 이벤트에는 단조 증가 seq가 붙고 재접속 때 `lastSeq`부터 다시 받는다. 큰 데이터는 HTTP로 받는다 |
| 32, 41 | Tauri v2 + React + TypeScript + Vite. 앱에는 Helm 로직이 없다. React는 결정 41로 19를 쓴다(결정 32의 18을 대체). CSR만 쓴다(서버 컴포넌트·SSR 없음). UI 부품은 Helm이 직접 만든다(21) |
| 42, 47~49 | 휴대폰에서도 질문에 답한다. 모바일은 데몬이 서빙하는 PWA(`/m/`)이고 알림은 Web Push(VAPID), 휴대폰 알림은 `interrupt`·`notice`까지, 최소 판은 iOS 26이다. 설계는 26(P15)이 하고, 이 문서는 데스크톱과 나눠 쓸 코드 경계를 정한다(§3.14) |
| 50 | shadcn/ui 소스를 복사해 고쳐 쓰는 것은 부품 직접 제작에 포함된다. 부품은 21(`@helm/ui`)이 정한다 |
| 56 | 결과 확인 대기의 휴대폰 알림 설정(`notifications.resultReview`)은 데몬 의미 설정이고 휴대폰 푸시를 바꾼다(26). 데스크톱은 배지만, `immediate`일 때만 OS 알림 [결정 60] |
| 59 | 방해 금지 예외(`notifications.dndException`)는 휴대폰 푸시에만 적용한다. 방해 금지 중에는 데스크톱 OS 알림을 띄우지 않는다(§3.9, §3.10.1 규칙 4) |
| 60 | 결과 확인 대기는 데스크톱에서 배지로만 알린다. 데스크톱 OS 알림은 `notifications.resultReview`가 `immediate`일 때만 띄운다(§3.10.1 규칙 2) |
| 판정 44 | Node 24 LTS, TypeScript 6.0(결정 36 대체, 조정자 판정) |
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
| APP-D06 | 데스크톱 UI는 앱에 묶어 배포한다. 데몬은 데스크톱 SPA를 서빙하지 않는다. 모바일 PWA `/m/`은 예외다([결정 47]) | [제안] | §3.11 |
| APP-D07 | 서버 상태는 TanStack Query, UI 상태는 Zustand. 연결 상태 기계와 백오프는 19 코어(`@helm/client`)가 갖고, 앱은 경로 선택기와 사용자용 상태 계산(순수 함수)만 둔다 | [제안], 2a단계 수정 | §3.8.8, §3.9.3 |
| APP-D16 | 플랫폼과 무관한 React 연결 코드(`useView`, `useCommand`, 저장소, 사용자용 상태, 알림 규칙)는 `@helm/client-react`에 두어 모바일 클라이언트와 나눠 쓴다 | [제안], 결정 42 | §3.14 |
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
│ 웹뷰: React 19 SPA (앱에 묶어 배포, §3.11)                                          │
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
  | 'pairing_failed'       // 코드가 틀렸거나 만료·사용·소진됨. 사유를 나누지 않는다(판정 J-81, 19 1009, 18 §3.7.4)
  | 'user_cancelled'       // 네이티브 확인 창에서 사용자가 취소(§3.6.3)
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
  helmCliPath?: string;       // SSH 페어링 때 실행할 helm CLI 경로. 기본 '~/.local/bin/helm'(17 §3.15). ^~?/[A-Za-z0-9/._-]+$ 또는 'helm'
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

// 19 §3.11 BlobRef(@helm/protocol)를 그대로 쓰고 앱은 url만 더한다
export type AppBlobRef = BlobRef & { url: string };   // url = helm-blob URL(§3.8.6)

export interface TraySummary {
  connection: ConnectionUiState;   // 04 §3.0.4 값(판정 J-196). 상단 막대와 같은 label.connection.<상태>
  asOfSeq: number | null;     // 오프라인 기준 표시용
  choiceNeeded: number;       // 선택 필요(권리 게이트) 수. 배지 값. 19 `tray` 뷰 그대로
  goodToCheck: number;        // 확인하면 좋은 것 수
  dnd: { on: boolean; until: string | null };   // 19 TrayView.dnd와 같은 형식([판정 J-199]). until은 끝 시각
  running: Array<{ label: string; route: string }>;  // 최대 5. label 예: "Concern 12 · 본문 1절 초안 쓰는 중"(04 §3.24). 19 `tray` 뷰 값 그대로
  runningMore: number;        // "외 n개"
}

export interface TransportOpened { transportId: string }
export interface DiagBundle { path: string }
export interface DeviceSignature { signature: string }   // base64url

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
| `profile_upsert` | `profileUpsert(input: ServerProfileInput): Promise<ServerProfile>` | `async fn profile_upsert(state: State<'_, AppState>, input: ServerProfileInput) -> Result<ServerProfile, AppError>` | §3.8.1 검증. 경로를 더하거나 주소(`baseUrl`, `target`, `port`, `daemonPort`)를 바꾸면 Rust 네이티브 확인 창을 띄운다(§3.6.3). 취소면 `user_cancelled`. 경로를 지우면 그 경로의 열린 전송을 닫는다 |
| `profile_delete` | `profileDelete(profileId: string): Promise<void>` | `async fn profile_delete(state, profile_id: String) -> Result<(), AppError>` | Rust 네이티브 확인 창. 키체인 토큰과 blob 캐시도 지운다. IndexedDB 정리는 TS가 한다 |
| `credential_status` | `credentialStatus(profileId: string): Promise<CredentialStatus>` | `async fn credential_status(state, profile_id: String) -> Result<CredentialStatus, AppError>` | 토큰 값은 돌려주지 않는다 |
| `credential_forget` | `credentialForget(profileId: string): Promise<void>` | `async fn credential_forget(state, profile_id: String) -> Result<(), AppError>` | Rust 네이티브 확인 창. 이 기기에서만 지운다. 데몬 쪽 폐기는 19 메서드 |
| `pairing_with_code` | `pairingWithCode(a: { profileId: string; routeId: string; code: string; deviceName: string }): Promise<PairingResult>` | `async fn pairing_with_code(state, profile_id: String, route_id: String, code: String, device_name: String) -> Result<PairingResult, AppError>` | WSS 경로 전용. 저장된 경로에만. 보내기 전에 Rust 네이티브 확인 창(§3.6.3). §3.8.7 |
| `pairing_via_ssh` | `pairingViaSsh(a: { profileId: string; routeId: string; deviceName: string }): Promise<PairingResult>` | `async fn pairing_via_ssh(state, profile_id: String, route_id: String, device_name: String) -> Result<PairingResult, AppError>` | SSH 경로 전용. 저장된 경로에만. Rust 네이티브 확인 창. §3.8.7 |
| `route_check` | `routeCheck(a: { profileId: string; route: Route }): Promise<RouteCheckResult>` | `async fn route_check(state, profile_id: String, route: Route) -> Result<RouteCheckResult, AppError>` | `SCR-CONNECT` 연결 점검 1~3단계(04 §3.19): ① 이름 찾기(WSS: DNS, SSH: `ssh -G <target>`로 실제 호스트·포트·사용자), ② 서버 경로(WSS: TCP+TLS, SSH: `-W` 연결), ③ `GET /healthz`(19 §3.2.5, 응답의 `protocols`). 4단계(인증)와 5단계(버전)는 저장된 경로에서만 한다: TS가 그 경로로 연결용 전송을 열어 `hello`까지 해 본다. 저장하지 않은 경로는 ③ `/healthz`까지만 점검하고 기기 토큰을 보내지 않는다. `RouteCheckResult = { steps: Array<{ step: 'resolve' \| 'path' \| 'health'; ok: boolean; reason?: TransportCloseReason; detail?: string; ms: number }>; resolved?: { hostname: string; port: number; user?: string }; protocols?: number[]; sshVersion?: string }` |
| `transport_open` | `transportOpen(a: { profileId: string; routeId: string; onEvent: Channel<TransportEvent> }): Promise<TransportOpened>` | `async fn transport_open(app: AppHandle, state, profile_id: String, route_id: String, on_event: Channel<TransportEvent>) -> Result<TransportOpened, AppError>` | 바로 돌아오고 결과는 채널로 온다. 한 프로필에 열린 연결용 전송은 하나만 둔다(새로 열면 이전 것을 `local_close`로 닫는다). 주소는 Rust가 `profiles.json`에 저장된 경로에서 읽는다. 웹뷰가 주소를 넘기는 인자는 없다(§3.6.3) |
| `transport_send` | `transportSend(a: { transportId: string; text: string }): Promise<void>` | `async fn transport_send(state, transport_id: String, text: String) -> Result<(), AppError>` | 열려 있지 않으면 `not_found`. 송신 대기가 4 MiB를 넘으면 전송을 닫는다(`protocol_violation`) |
| `transport_close` | `transportClose(a: { transportId: string; code?: 1000 \| 4000 }): Promise<void>` | `async fn transport_close(state, transport_id: String, code: Option<u16>) -> Result<(), AppError>` | 기본 1000. tick 감시 시간 초과는 4000(19 §3.2.6). 이미 닫혔으면 아무것도 하지 않는다 |
| `blob_upload` | `blobUpload(a: { profileId: string; mime: string; fileName?: string; limits: UploadLimits }, body: ArrayBuffer): Promise<AppBlobRef>` | `async fn blob_upload(state, request: tauri::ipc::Request<'_>) -> Result<AppBlobRef, AppError>` | 본문은 원시 바이트로 넘긴다. 머리 정보는 요청 헤더 `x-helm-profile`, `x-helm-mime`, `x-helm-filename`, `x-helm-limits`(JSON). `UploadLimits = { singleUploadMaxBytes; uploadChunkBytes; maxBlobBytes }`(hello 응답의 `policy.files`, 19 §3.4.4) |
| `blob_upload_path` | `blobUploadPath(a: { profileId: string; path: string; limits: UploadLimits }): Promise<AppBlobRef>` | `async fn blob_upload_path(state, profile_id: String, path: String, limits: UploadLimits) -> Result<AppBlobRef, AppError>` | 대화 상자 플러그인이 돌려준 경로만 받는다(§3.6.3) |
| `blob_cache_clear` | `blobCacheClear(profileId?: string): Promise<void>` | `async fn blob_cache_clear(state, profile_id: Option<String>) -> Result<(), AppError>` | |
| `tray_update` | `trayUpdate(s: TraySummary): Promise<void>` | `async fn tray_update(app: AppHandle, summary: TraySummary) -> Result<(), AppError>` | 메뉴와 아이콘 상태만 바꾼다 |
| `badge_set` | `badgeSet(count: number \| null): Promise<void>` | `async fn badge_set(app: AppHandle, count: Option<u32>) -> Result<(), AppError>` | §3.10.3 |
| `window_reveal` | `windowReveal(a?: { route?: string }): Promise<void>` | `async fn window_reveal(app: AppHandle, route: Option<String>) -> Result<(), AppError>` | 창을 보이고 앞으로 가져오고, `route`가 있으면 `app://navigate` 이벤트를 보낸다 |
| `appearance_get` | `appearanceGet(): Promise<Appearance>` | `async fn appearance_get(app: AppHandle) -> Result<Appearance, AppError>` | `Appearance = { reduceTransparency: boolean \| null; windowEffect: 'on' \| 'off'; effect: 'sidebar' \| 'liquidGlassRegular' \| 'mica' \| 'none'; osVersion: string }`. `reduceTransparency`는 macOS만 값이 있고 Windows는 `null`(웹뷰 미디어 쿼리를 쓴다, §3.10.8) |
| `window_effect_set` | `windowEffectSet(a: { mode: 'system' \| 'on' \| 'off'; macGlass: 'sidebar' \| 'liquidGlassRegular' }): Promise<Appearance>` | `async fn window_effect_set(app: AppHandle, mode: String, mac_glass: String) -> Result<Appearance, AppError>` | 설정이 바뀌거나 투명도 줄이기가 바뀔 때 창 효과를 다시 적용한다 |
| `app_info` | `appInfo(): Promise<AppInfo>` | `async fn app_info(state) -> Result<AppInfo, AppError>` | |
| `diag_bundle` | `diagBundle(): Promise<DiagBundle>` | `async fn diag_bundle(app: AppHandle) -> Result<DiagBundle, AppError>` | 로그와 앱 정보를 zip으로 묶어 다운로드 폴더에 둔다. 토큰과 IndexedDB 내용은 넣지 않는다 |
| `credential_rotate` (조건부) | `credentialRotate(profileId: string): Promise<void>` | `async fn credential_rotate(state, profile_id: String) -> Result<(), AppError>` | 18·19가 HTTP 교체 경로를 두면 넣는다(§3.8.7). 1차에는 등록하지 않는다 |
| `device_sign_challenge` (조건부) | `deviceSignChallenge(a: { profileId: string; serverId: string; nonce: string; signedAt: string }): Promise<{ signature: string }>` | `async fn device_sign_challenge(state, profile_id: String, server_id: String, nonce: String, signed_at: String) -> Result<DeviceSignature, AppError>` | 19 `hello.challenge.proofRequired`를 18이 켜면 넣는다. 서명 대상 문자열은 19 §3.4.3 |

Rust 쪽 공통 규칙:

- 모든 명령은 `async`이고 `Result<T, AppError>`를 돌려준다. `AppError`는 `#[derive(Serialize)] #[serde(rename_all = "camelCase")] struct AppError { code: AppErrorCode, message: String, detail: Option<String> }`이다. `message`는 한국어 문구가 아니라 개발자용 영어 한 줄이고, 화면 문구는 TS가 `code`로 고른다(결정 37, 05).
- 인자 구조체는 `#[serde(rename_all = "camelCase", deny_unknown_fields)]`로 받는다. 반환 구조체(`TransportOpened`, `DiagBundle`, `DeviceSignature`, `PairingResult`, `CredentialStatus`, `AppBlobRef` 등)는 `#[derive(Serialize)] #[serde(rename_all = "camelCase")]`로 §3.4.1의 TS 타입과 같은 이름을 낸다. `AppBlobRef`는 19 `BlobRef`의 필드(`blobId`, `hash`, `bytes`, `mediaType`, `preview`, `name`, `image`)에 `url`을 더한 것이다.
- `detail`에는 ssh stderr 마지막 4 KiB까지 넣을 수 있다. 토큰, 페어링 코드는 넣지 않는다.

### 3.5 Rust → 웹뷰 이벤트 [제안]

명령 응답과 전송 채널 밖에서 Rust가 웹뷰로 보내는 것은 아래 넷이다. 이름은 `app://` 접두어를 쓴다.

| 이벤트 | 페이로드 | 보내는 때 |
|---|---|---|
| `app://navigate` | `{ route: string; source: 'tray' \| 'notification' \| 'shortcut' \| 'reveal' }` | 트레이 메뉴 항목, `window_reveal(route)` |
| `app://tray-action` | `{ action: 'quick-capture' \| 'reconnect' \| 'open-connect' \| 'dnd-toggle' }` | 트레이 메뉴의 동작 항목. `dnd-toggle`은 웹뷰가 `settings.update`(`attention.snoozeUntil`) 명령으로 보낸다(§3.10.2, [판정 J-166]) |
| `app://appearance` | `Appearance` | macOS의 "투명도 줄이기"가 바뀔 때(§3.10.8) |
| `app://window` | `{ state: 'shown' \| 'hidden' \| 'focused' \| 'blurred' }` | 창 상태가 바뀔 때. 연결 확인(§3.8.8의 포커스 `ping`)과 배지 처리에 쓴다 |

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
            "appearance_get", "window_effect_set",
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
    "allow-appearance-get", "allow-window-effect-set",
    "notification:default",
    "global-shortcut:allow-register", "global-shortcut:allow-unregister", "global-shortcut:allow-is-registered",
    "autostart:allow-enable", "autostart:allow-disable", "autostart:allow-is-enabled",
    "deep-link:allow-get-current",
    "store:allow-get-store", "store:allow-get", "store:allow-set", "store:allow-entries", "store:allow-save",
    "window-state:allow-save-window-state", "window-state:allow-restore-state",
    "core:webview:allow-set-webview-zoom",
    "dialog:allow-open",
    "clipboard-manager:allow-write-text",
    { "identifier": "opener:allow-open-url", "allow": [{ "url": "https://*" }] },
    "log:allow-log"
  ]
}
```

- 저장소 플러그인은 `store:default`(모든 명령)를 주지 않는다. `allow-load`가 있으면 웹뷰가 임의 경로의 저장 파일을 열 수 있다. 플러그인은 경로를 `app.path().resolve(path, BaseDirectory::AppData)`로 풀고, 절대 경로를 막지 않는다 [원문: plugins-workspace v2 `plugins/store/src/store.rs` 40~45행 `resolve_store_path`, `plugins/store/permissions/default.toml`]. 그래서 Rust가 시작할 때 `settings.json` 하나만 열어 두고, 웹뷰는 이미 열린 저장소를 `getStore`로 받아 읽고 쓰기만 한다. 로그 플러그인은 `log:allow-log`만 준다(플러그인의 `default`와 같다 [원문: `plugins/log/permissions/default.toml`]).
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
- 글꼴은 앱에 넣는다(21 UI-D12, `font-src 'self'`). 원격 글꼴·스크립트·이미지는 없다. 21 §4 E21의 "그림은 데몬 HTTP 출처만"은 데스크톱에서 `helm-blob` 스킴(§3.8.6)으로 구현한다. 데몬 주소를 `img-src`에 넣지 않는다(웹뷰가 데몬에 직접 요청하지 않으므로, 21 §5.2의 20 요구 (5)에 대한 답).
- `withGlobalTauri: false`. `@tauri-apps/api`는 ES 모듈로 가져온다.
- Vite `envPrefix`는 `['VITE_', 'TAURI_ENV_']`만 쓴다. `TAURI_`를 통째로 넣으면 서명 키 같은 빌드 환경 변수가 번들에 들어갈 수 있다 [검색: CVE-2023-46115 설명].
- Tauri 버전 하한은 2.11.6이다. 2.11.1(원격 페이지의 로컬 IPC 호출, CVE-2026-42184)과 2.11.6(fetch 명령 접근 제어)의 보안 수정이 들어간 판이다 [검색: github.com/tauri-apps/tauri/security/advisories].
- isolation 패턴은 1차에 쓰지 않는다. 원격 콘텐츠는 없지만, 번들에 들어가는 npm UI 의존(React, Radix, assistant-ui 등)은 서드파티 스크립트이고 앱 IPC 명령은 21개다. isolation은 모든 IPC를 iframe에서 다시 검사하는데, Windows에서 ES 모듈 제약이 있고 검사 규칙을 따로 짜야 한다 [검색: v2.tauri.app/concept/inter-process-communication/isolation]. 그 대신 웹뷰가 오염됐을 때 피해가 큰 명령(경로 추가·주소 변경, `pairing_*`, `credential_forget`, `profile_delete`)은 Rust가 띄우는 네이티브 확인 창을 거치게 한다(§3.6.3). 웹뷰 코드는 이 창을 건너뛸 수 없다. 의존 오염은 §3.12.2의 공급망 규칙으로 줄인다. 데몬이 보낸 텍스트(모델 출력, 도구 출력)는 신뢰하지 않는 입력이다. 마크다운 렌더러는 원시 HTML을 끄고 링크 스킴을 `https`, `helm`으로 제한한다(21 E21).

#### 3.6.3 그 밖의 보안 규칙

| 규칙 | 이유 |
|---|---|
| 기기 토큰은 Rust의 `secrets.rs`만 읽는다. IPC 응답, 로그, `detail`, 진단 묶음에 넣지 않는다 | 웹뷰 XSS가 있어도 토큰 값을 읽을 수 없게 한다 |
| 토큰은 그 프로필의 `profiles.json`에 저장된 경로의 호스트·포트로만 보낸다. Rust가 보낼 주소를 저장된 경로에서 읽고, 웹뷰 인자로 받은 주소에는 토큰을 붙이지 않는다. 저장하지 않은 경로의 점검은 `/healthz`까지다 | 웹뷰가 임의 주소를 주어 토큰을 다른 서버로 보내게 하는 길을 막는다. `serverId` 확인은 토큰을 보낸 뒤라 이 막음을 대신하지 못한다 |
| 경로 추가·주소 변경(`profile_upsert`), `pairing_with_code`, `pairing_via_ssh`, `credential_forget`, `profile_delete`는 Rust가 `tauri-plugin-dialog`의 Rust API로 네이티브 확인 창을 띄운 뒤에만 실행한다. 창에는 실제 주소(호스트·포트, SSH 대상)를 보인다. 주소가 `*.ts.net`, `127.0.0.1`, `localhost`가 아니면 "Tailscale 밖 주소입니다. 이 주소의 서버에 기기 토큰을 보냅니다"를 더한다 | isolation 패턴을 대신하는 사람 확인(§3.6.2). 피싱 딥 링크로 들어온 주소도 이 창을 거친다 |
| `blob_upload_path`는 직전 `dialog.open` 결과로 받은 경로만 받는다. Rust가 최근 대화 상자 결과 경로를 1분 동안 기억하고 대조한다 | 웹뷰가 임의 파일을 읽어 올리는 길을 막는다 |
| SSH 인자에 들어가는 값(`target`, `identityFile`, `sshPath`, `helmCliPath`)은 Rust가 검증한다: 공백·제어 문자 금지, `-`로 시작 금지, `identityFile`·`sshPath`는 절대 경로, `helmCliPath`는 §3.8.1의 정규식. SSH 발급의 원격 명령 인자는 Rust가 하나씩 POSIX 작은따옴표로 감싸고(`'` → `'\''`), 기기 이름·플랫폼은 원격 명령줄에 넣지 않고 표준 입력 JSON으로 보낸다(§3.8.7) | 인자 주입(`-oProxyCommand=…`)을 막는다(S4 paseo: `packages/protocol/src/ssh-transport.ts:17-24`와 같은 검사) |
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
| `tauri-plugin-log` | 2.10.1 | Rust·JS 로그 파일 | 마스킹: 로그 한 줄을 파일에 쓰기 전에 Rust 포매터가 정규식으로 가린다. 기기 토큰 `helm_dt_[A-Za-z0-9_-]{20,}`(18 §3.8.1), 런타임 토큰 `helm_rt_[A-Za-z0-9_-]{20,}`, `Authorization:\s*Bearer\s+\S+`, 쿠키 `__Host-helm_dt=[^;\s]+`, 페어링 코드 `\b[0-9A-HJKMNP-TV-Z]{4}-?[0-9A-HJKMNP-TV-Z]{4}-?[0-9A-HJKMNP-TV-Z]{4}\b`(18 §3.7.2 12자 형식), URL 쿼리의 `code=[^&\s]+`. 단위 시험에 각 정규식의 표본을 둔다 |
| `tauri-plugin-os` | 2.4.0 | 플랫폼 정보 | `app_info`로 대신할 수 있으면 빼도 된다 |
| 쓰지 않음 | | `stronghold`(2026-07 중단 공지, v3에서 빠짐), `shell`, `fs`, `http`, `websocket`, `updater`(APP-D14), `process` | |

#### 3.7.2 Rust 크레이트

| 크레이트 | 버전 | 용도 |
|---|---|---|
| `tokio` | 1.x 최신 | 비동기, 자식 프로세스 |
| `tokio-tungstenite` | 0.30 계열(`tauri-plugin-websocket` 2.5.0이 쓰는 판 [검색: plugins-workspace `plugins/websocket/Cargo.toml`]) | WebSocket 클라이언트(`client_async_with_config`로 임의 스트림 위 업그레이드) |
| `rustls` + `tokio-rustls` | 0.23 계열 | TLS. 암호 백엔드는 `ring`(교차 빌드 부담이 작다. `aws-lc-rs`는 Windows MSVC에서 NASM 등이 필요하다 [검색: aws.github.io/aws-lc-rs/requirements/windows.html]) |
| `rustls-platform-verifier` | 최신 | OS 신뢰 저장소로 인증서 검사. `tailscale serve` 인증서는 공개 CA(Let's Encrypt)라 OS 저장소로 충분하다 [지식] |
| `hyper` 1.x + `hyper-util` + `http-body-util` | 최신 | blob HTTP/1.1(`client::conn::http1::handshake`를 임의 스트림 위에서) |
| `keyring-core` 1.0.0 + `apple-native-keyring-store` 1.0.2(feature `keychain`) + `windows-native-keyring-store` 1.1.0 | | 키체인. `keyring` 4.x는 "저장소를 직접 고르는 앱은 keyring-core와 저장소 크레이트를 쓰라"고 안내한다 [검색: docs.rs/keyring/4.2.0] |
| `serde`, `serde_json`, `thiserror`, `ulid`, `tracing` | 최신 | |
| `sha2` | 최신 | blob 캐시 검증 |

#### 3.7.3 웹뷰 쪽 npm 패키지

| 패키지 | 버전 | 용도 | 비고 |
|---|---|---|---|
| `react`, `react-dom` | 19.3.0(2026-09-09) | | 결정 41 [검색: npm] |
| `react-router` | 8.4.0 | 라우팅 | 피어 `react >=19.2.7`, Node `>=22.22.0`(Node 24에서 맞음). 라이브러리 방식의 `createBrowserRouter`를 그대로 내보낸다 [검색: npm, 8.4.0 tarball의 `dist/production/lib/dom/lib.d.ts`] |
| `@tanstack/react-query` | 5.104.2 | 서버 상태 캐시 | 피어 `react ^18 \|\| ^19` [검색: npm] |
| `zustand` | 5.0.15 | UI 상태, 연결 상태 | 피어 `react >=18`(React 19 포함) [검색: npm] |
| `idb` | 8.0.4 | IndexedDB | |
| `ulid` | 3.0.2 | 멱등 키·요청 ID | `monotonicFactory` |
| `react-error-boundary` | 6.1.6 | 오류 경계 | 피어 `react ^18 \|\| ^19` [검색: npm] |
| `@types/react`, `@types/react-dom` | 19.3.0 | 타입 | |
| `@vitejs/plugin-react` | 6.1.2 | Vite 플러그인 | 피어 `vite ^8`. React Compiler(`babel-plugin-react-compiler` 1.0.0)를 선택 피어로 받는다 [검색: npm]. 1차에는 컴파일러를 켜지 않는다(§3.9.3) |
| `eslint-plugin-react-hooks` | 7.1.1 | 훅 규칙 | |
| `@tauri-apps/plugin-*` | 위 표와 같은 번호 | | |
| `@helm/protocol`, `@helm/client` | 저장소 workspace | 메서드·이벤트·뷰 타입과 TypeBox 스키마, 클라이언트 코어(브라우저 진입점) | 19·06 |
| `@assistant-ui/react` | 0.15.28 | 대화 스레드(21 UI-D11) | 21이 범위 결정. 피어 `react ^18 \|\| ^19` [검색: npm]. 헤드리스 부품 `radix-ui` 1.8.0(피어에 React 19 포함)과 `lucide-react` 1.55.0은 21이 고른다 |
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
  - `helmCliPath`는 정규식 `^~?/[A-Za-z0-9/._-]+$`에 맞는 경로 또는 `helm`. 기본값은 `~/.local/bin/helm`(17 §3.15)이다. 비대화 SSH는 로그인 셸의 `PATH`를 읽지 않을 수 있어 `helm`만으로는 찾지 못한다.
  - 기기 이름(`deviceName`)은 1~40자, 제어 문자 없음. 원격 명령줄에 넣지 않고 표준 입력으로 보낸다(§3.8.7).
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
5. Rust 쪽 코드가 작다. 사용자는 React 시니어이고(결정 32·41), Rust 코드는 적을수록 유지가 쉽다.

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
  2. 디스크 캐시(`<app_cache_dir>/blobs/<profileId>/<blobId 앞 2자>/<blobId>`)에 있으면 바로 돌려준다. blob은 한 번 정해지면 내용이 바뀌지 않는다(19 §3.11, `blobId`·`ETag` 불변).
  3. 없으면 현재 활성 경로로 `GET /files/b/<blobId>`를 보낸다. WSS 경로는 같은 호스트·포트의 HTTPS, SSH 경로는 `ssh -W 127.0.0.1:<HELM_LOOPBACK_PORT>` 스트림 위의 HTTP/1.1(`hyper::client::conn::http1`). SSH 쪽 keep-alive 연결은 최대 2개, 60초 동안 재사용한다. 19 §3.2.3의 "요청마다 `ssh -W` 하나"보다 연결을 아낀다.
  4. 캐시에는 내용 해시를 확인한 것만 쓴다. 기대 해시는 뷰 데이터의 `BlobRef.hash`(`sha256:…`), 없으면 응답의 `ETag`다. 둘 다 없거나 받은 바이트와 맞지 않으면 화면에는 돌려주되 캐시에 쓰지 않는다.
  4-1. 웹뷰로 돌려주는 응답 머리: `Content-Type`은 허용 목록(`image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/avif`, `text/plain`, `application/pdf`, `audio/*`, `video/mp4`, `video/webm`) 안이면 그 값, 밖이면 `application/octet-stream`이다. `image/svg+xml`과 `text/html`은 허용 목록에 넣지 않는다(스크립트가 들 수 있다). 모든 응답에 `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'`, `Cache-Control: no-store`(웹뷰 HTTP 캐시 대신 앱 캐시를 쓴다)를 붙인다.
  5. 연결이 없으면 503을 돌려주고, 화면(21의 이미지 컴포넌트)은 "연결되면 보입니다" 자리 표시를 그린다.
- 캐시 상한 1 GiB, 넘으면 마지막 접근이 오래된 것부터 지운다. 한 blob은 데몬 정책 `policy.files.maxBlobBytes`(기본 64 MiB)를 넘지 않는다. 화면에 필요한 경우가 생길 때까지 `Range` 요청은 쓰지 않는다.
- 업로드: `blob_upload`(바이트)와 `blob_upload_path`(대화 상자 경로). 크기가 `policy.files.singleUploadMaxBytes`(기본 8 MiB) 이하면 `POST /files/u` 한 번, 넘으면 19 §3.11.3의 청크 이어 올리기(`POST`로 시작 → `PATCH` 반복, 끊기면 `HEAD`로 받은 바이트 수를 보고 이어 감). 정책 값은 TS가 hello 응답에서 읽어 명령 인자(`limits`)로 넘긴다. 응답의 `blobId`를 담은 `BlobRef`를 돌려주고 같은 내용을 캐시에도 넣는다.
- 웹뷰 JSON-RPC로 base64를 보내지 않는다(openclaw의 25 MiB 프레임 문제, pi-cases-notes §11.1).
- 폐기(`revoked`) 때는 그 프로필의 blob 캐시를 지운다(§3.9.5).

#### 3.8.7 인증과 페어링 [제안, 18과 맞출 것]

| 항목 | 설계 |
|---|---|
| 기기 토큰 | 페어링 때 데몬이 발급한 bearer 토큰 하나. Rust가 OS 키체인에 저장하고 업그레이드 헤더·HTTP 요청에만 쓴다. 웹뷰는 값을 모른다. 웹뷰는 `deviceId`만 안다(`hello.auth.deviceId`에 넣는다, 19 §3.4.3) |
| 두 경로의 인증 | 둘 다 기기 토큰을 보낸다(APP-D04, 19 P-03). WSS 경로는 여기에 Tailscale 신원 조건이 더해진다(`tailnet` 리스너). SSH 경로는 SSH 키가 전송을 인증하고, 데몬의 `loopback` 리스너는 토큰으로 기기를 안다. "loopback에서 왔다"는 사실을 신뢰 근거로 쓰지 않는다(pi-cases-notes §12.2-8, 19 §3.2.1) |
| 페어링 1: 코드 | 이미 연결된 기기의 `SCR-CONNECT`가 `device.createPairingCode`(19 §3.7.7)로, 또는 서버에서 관리 CLI가 1회용 코드와 링크 `helm://pair?v=1&url=<baseUrl>&code=<코드>&sid=<serverId>`를 만든다. 사용자가 링크를 열거나 코드를 붙여 넣으면 Rust가 `POST <baseUrl>/pair`에 코드와 기기 정보를 보내고 `{ serverId, deviceId, deviceToken }`을 받아 바로 키체인에 넣는다(본문 형식은 19 §3.7.7·18). 웹뷰에는 `PairingResult{serverId, deviceId}`만 돌려준다 |
| 페어링 2: SSH 발급 | SSH 경로가 있는 프로필에서 쓴다. Rust가 `ssh <§3.8.3 공통 옵션, -W 없이> -- <target> '<helmCliPath>' 'device' 'issue' '--json' '--stdin'`을 실행하고, 표준 입력에 한 줄 JSON `{"name": <deviceName>, "platform": "macos"\|"windows", "client": "desktop"}`을 쓴다. 원격 명령줄은 서버의 로그인 셸이 해석하므로 인자마다 POSIX 작은따옴표로 감싸고, 사용자가 정한 값(기기 이름)은 명령줄에 넣지 않는다(17 §3.15에 `--stdin` 요구, §5.2). `helmCliPath`의 `~`는 따옴표 밖에 두어 원격 셸이 펼치게 한다(`~/'.local/bin/helm'` 꼴). CLI는 WSL 안에서 `local` 리스너에 `localAdmin`으로 붙어 `admin.issueDevice`(19 §3.7.8)를 부르고, 셸 시작 잡음과 섞이지 않게 `HELM-DEVICE/1 ` 접두어가 붙은 한 줄 JSON `{serverId, deviceId, deviceToken}`을 stdout에 쓴다. Rust는 그 줄만 읽는다(pi-env의 `PI-ENV <token>` 동기화 줄 기법, facts-2 §8, 19 §3.2.3 예비 경로의 `HELM-BRIDGE/1`과 같은 꼴). SSH 키로 서버 계정에 들어올 수 있으면 기기 발급 권한이 있다고 본다(18 §3.7 흐름 B) |
| 앱 전용 SSH 키 [제안] | 데스크톱 앱이 서버 전체 셸 권한을 가진 일반 키를 쓰면 앱 침해가 곧 서버 셸이 된다. 권장 구성은 키 둘이다. (1) 연결용 앱 전용 키를 서버 `authorized_keys`에 `restrict,port-forwarding,permitopen="127.0.0.1:7841"`로 등록한다. 이 키로는 `-W 127.0.0.1:7841`만 된다. (2) SSH 발급은 한 번만 하므로 일반 키로 하거나, `command="~/.local/bin/helm device issue --json --stdin",restrict`를 붙인 별도 키로 한다. 또는 SSH 발급 대신 페어링 코드(흐름 A)를 쓴다. `SCR-CONNECT`의 SSH 경로 도움말과 INSTALL에 이 구성을 적는다(18·17에 같은 권장을 요구, §5.2) |
| `serverId` 고정 | 첫 페어링에서 받은 `serverId`를 프로필에 고정한다. 연결할 때마다 `hello.challenge.serverId`를 비교하고 다르면 `hello`를 보내지 않고 코어 `needsUser` + 앱 사유 `wrong_server`로 멈춘다(19 §3.4.2). 개발용 데몬과 실제 데몬을 헷갈려 캐시가 섞이는 것을 막는다 |
| 토큰 폐기 | 폐기는 `device.revoke`(19)로 하고, 이 기기의 토큰은 `credential_forget`으로 지운다. 업그레이드 401·403 또는 `hello` 오류 1004·1005·1006이면 코어 `needsUser`가 되고, 앱 사유는 §3.8.8의 `needsUser` 원인 표를 따른다(`needs_pairing`·`auth_rejected`·`revoked`·`expired`). 폐기와 만료의 로컬 데이터 처리는 §3.9.5다 |
| 토큰 교체 | 19는 토큰 교체를 JSON-RPC 메서드로 두지 않는다. 교체는 2차 기능으로 HTTP `POST /devices/self/rotate`(현재 토큰 헤더로 인증, 18 §3.4.3·§3.8.3)만 하고 Rust 명령 `credential_rotate`가 부른다(§5.2 요구). 토큰은 웹뷰를 지나지 않는다. 데스크톱은 교체 호출을 TS에서 하지 않는다. 1차는 교체하지 않는다(happy-agent도 토큰을 회전하지 않는다, pi-cases-notes §12.1-7) |
| 기기 키 서명 | 19 `hello.challenge.proofRequired`가 참이면 `hello.auth.proof`가 필요하다(19 §3.4.3, 1차 기본 false). 18이 채택하면 Rust가 Ed25519 개인 키를 키체인에 두고 명령 `device_sign_challenge({ profileId, nonce, serverId, signedAt }) → { signature }`가 서명만 돌려준다. 개인 키는 웹뷰로 나가지 않는다(§7 Q-04) |

#### 3.8.8 연결 상태: 19 `HelmClient`와 앱의 경로 선택기 [제안, 2a단계에서 19 §3.10·§3.14에 맞춰 다시 씀]

canon-2 §3.16의 네 상태 기계(에이전트 루프, WorkUnit, 연결, 투영 신선도) 중 연결 상태다. 투영 신선도는 §3.9.8에서 따로 둔다. 하나의 status로 합치지 않는다(canon-2 체크리스트 20).

연결 상태 기계, 재접속 백오프, 자동 재접속을 멈추는 규칙은 19의 `HelmClient`(`@helm/client`, 판정 §2)가 소유한다(19 §3.10.2 상태 `idle`·`connecting`·`handshaking`·`syncing`·`ready`·`backoff`·`needsUser`·`closed`, §3.10.3 백오프). 앱은 그 바깥의 세 가지만 만든다.

1. **경로 선택기**(`connection/routes.ts`): 19의 `transportFactory`에 넘기는 `MultiRouteTransport`. 경로 순서와 넘어가기 규칙(§3.8.10)을 한 번의 `open()` 안에서 처리한다.
2. **앱 쪽 실패 분류**: SSH·키체인·`serverId` 같은 앱만 아는 실패를 19의 `TransportFailure`로 바꾼다.
3. **사용자용 상태 계산**(`@helm/client-react`의 `connection/`): 코어 상태 + 앱 정보 → 04 §3.0.4의 사용자용 상태(`UserConnState`)와 21의 `ConnectionUiState`, `decisionsAllowed`(§3.8.9).

`MultiRouteTransport.open()`(19 `Transport`를 구현):

```text
open(handlers):
  routes ← 프로필의 활성 경로를 순서대로. 30분 뒤로 미룬 경로(§3.8.10)는 맨 뒤
  if routePolicy == 'pinned': routes ← [routes[0]]
  failures ← []
  for r in routes:
    t ← new TauriIpcTransport(profileId, r.routeId)          // §3.4 transport_open, 채널로 이벤트를 받는다
    try: await t.open(handlers); current ← t; return          // 업그레이드 101까지
    catch closed(reason):
      failures.push({ route: r, reason })
      if reason ∈ 토큰 계열(http_unauthorized, credential_missing, keychain_denied): break   // 경로를 바꿔도 같다
      if reason ∈ 네트워크 계열 or (r.kind == 'ssh' and reason ∈ SSH 차단 계열): continue
      break
  throw toTransportFailure(failures)                          // 아래 표
```

| 라운드 결과(앞 경로부터 본 첫 사유) | 19 `TransportFailure` | 코어 동작(19 §3.10.2) |
|---|---|---|
| `http_unauthorized` | `{ kind: "httpStatus", status: 401 \| 403 }` | `needsUser`(자동 재접속 멈춤) |
| `credential_missing`, `keychain_denied` | `{ kind: "blocked", reason }` (19 §3.14) | `needsUser` |
| SSH 차단 계열(`ssh_auth_failed`, `ssh_host_key_unknown`, `ssh_host_key_changed`, `ssh_missing`)이 하나라도 있고 나머지는 네트워크 계열 | `{ kind: "blocked", reason }` | `needsUser` |
| `daemon_unreachable`만 | `{ kind: "daemonUnreachable" }` | `backoff` |
| 그 밖 네트워크 계열 | `{ kind: "network" }` 또는 `{ kind: "httpStatus", status: 5xx }` | `backoff` |

- `{ kind: "blocked" }`는 19 §3.14 `TransportFailure`에 있고 코어가 `needsUser`로 간다(판정 J-62, 19 CT-31). 앱은 이 실패에서 따로 `client.stop()`을 부르지 않는다.
- `serverId` 불일치는 코어가 `hello.challenge`에서 판정한다(19 §3.10.2 `server.mismatch`). 앱은 그 결과를 `wrong_server`로 보인다.
- 연결 중에는 경로를 바꾸지 않는다. 다음 `open()`은 다시 첫 경로부터 시작한다(APP-D05).

앱이 코어에 넣는 신호(19 §3.10.2 `backoff` 행의 "네트워크 복구·OS 깨어남·창 포커스(20)"):

| 신호 | 판정 | 코어에 하는 일 |
|---|---|---|
| 네트워크 복구 | 웹뷰 `online` 이벤트 | `backoff`이면 기다림을 끝내고 바로 시도(`client.retryNow()`, 19 §3.14) |
| 네트워크 없음 | `offline` 이벤트 | 화면은 "다시 연결하는 중"을 보인다. 끊긴 지 2분이 지나면 "서버 PC에 연결할 수 없음"(사유: 기기 네트워크 없음, §3.8.9 9행). 코어는 그대로 두고 시도는 실패로 끝난다 |
| 잠자기에서 깨어남 | 5초 타이머가 벽시계 기준 20초 넘게 밀림(Tauri에 데스크톱 전원 이벤트가 없어 타이머 간격으로 판단 [가정]) | `ready`면 `ping`(3초 시간 제한), 실패하면 전송을 4000으로 닫는다. `backoff`면 `retryNow()` |
| 창 포커스 | `app://window` `focused`, 마지막 수신 뒤 10초 넘음 | 위와 같음(Paseo의 포그라운드 3초 프로브, S4 paseo §7). 주기적으로는 보내지 않는다(19 §3.7.2) |
| 사용자 [다시 연결], 재페어링·호스트 키 확인·경로 수정 | `SCR-CONNECT` | `needsUser`면 `client.start()`(시도 횟수 0, 19 §3.10.2) |
| 데몬 종료 예고 | `server.shutdown` | 코어가 `restartExpectedMs`를 백오프 하한으로 쓴다(19 §3.10.3). 앱은 그동안 "서버 종료 중"을 보인다(17 §5.2의 20 요구) |

앱 쪽 연결 모델. 타입과 순수 함수는 `@helm/client-react`의 `connection/` 한 곳에 두고(§3.14), 데스크톱은 `apps/desktop/src/connection/`에서 zustand 스토어로 값을 채우기만 한다. 모바일(26)도 같은 함수를 쓴다.

```ts
// packages/client-react/src/connection/model.ts
export type AppBlockedReason =
  | 'needs_pairing' | 'auth_rejected' | 'revoked' | 'expired' | 'policy_closed' | 'keychain_denied'
  | 'ssh_auth_failed' | 'ssh_host_key_unknown' | 'ssh_host_key_changed' | 'ssh_missing'
  | 'incompatible_version' | 'wrong_server' | 'protocol_error' | 'no_routes';

export type ReadOnlyReason = 'disk_critical' | 'integrity_suspect' | 'recovery_failed' | 'projection_fault' | 'operator';   // 17 §3.4.1, 19 server.modeChanged.reason

export interface AppConnModel {
  core: HelmClient['state'];                 // 19 상태 그대로
  coreDetail?: { kind?: string; retryInMs?: number };
  blocked?: { reason: AppBlockedReason; routeId?: string; detail?: string };
  route?: { routeId: string; kind: RouteKind };   // 지금 연결된 경로
  lastFailure?: { reason: TransportCloseReason; at: number; routeId: string };
  protocolStreak?: { code: 1002 | 1003; count: number };   // 닫힘 1002·1003이 같은 코드로 연속 나온 횟수. ready가 되면 지운다. hello의 1003(protocol.unsupported)은 셈에 넣지 않는다 [판정 J-228]
  healthz?: 'network' | 'http5xx';           // 마지막 GET /healthz 결과(§3.8.9)
  disconnectedAt?: number;                   // 마지막 ready에서 끊긴 시각
  attempts: number;
  deviceOnline: boolean;                     // navigator.onLine
  lastMessageAt?: number;                    // 19 HelmClient.lastMessageAt
  tickIntervalMs: number;                    // hello policy
  daemonMode: 'normal' | 'readOnly' | 'safeMode' | 'draining';   // 19 DaemonMode
  readOnlyReasons: ReadOnlyReason[];         // server.modeChanged.reason, hello의 모드 정보
  bootChangedAt?: number;                    // bootEpoch가 바뀐 것을 본 시각(1분 표시)
}

/** 04 §3.0.4 사용자용 상태 값 열여섯 [판정 J-176·J-196·J-228]. §3.8.9 표의 행과 하나씩 대응한다. viewStale은 화면마다 정한다(표의 마지막 행) */
export type UserConnKind =
  | 'keychainDenied' | 'authFailed' | 'sshFailed' | 'wrongServer' | 'versionMismatch'
  | 'draining' | 'daemonUnreachable' | 'serverPcUnreachable' | 'reconnecting' | 'syncing'
  | 'readOnly' | 'safeMode' | 'restarted' | 'slow' | 'connected' | 'viewStale';

export interface UserConnState {
  kind: UserConnKind;
  ui: ConnectionUiState;                     // 21 §3.5 타입. §3.8.9 표의 21 열
  reasonKey: CopyKey;                        // 배너 문구 키(05 §3.11). 사유별로 다르다
  blockedReason?: AppBlockedReason;
  readOnlyReasons?: ReadOnlyReason[];
}

export function toUserState(m: AppConnModel, now: number): UserConnState;     // §3.8.9 표
export function decisionsAllowed(conn: ConnectionUiState, view: { serverFreshness: ServerFreshness }): boolean;   // §3.8.9
```

- `toUserState`는 순수 함수다. 시간과 IPC 없이 표 형식으로 시험한다(§6.1).
- hello 오류 kind와 닫는 코드의 처리, 백오프 간격(0.5초부터 30초, 반 지터, `ready` 30초 유지 뒤 0으로)은 19 §3.10.3이 정본이다.

코어가 `needsUser`로 간 원인 → `blocked.reason`(19 §3.10.2 표의 `needsUser` 행 전부):

| 19 원인 | `AppBlockedReason` | 사용자용 상태(§3.8.9) |
|---|---|---|
| HTTP 401·403, 키체인에 토큰 없음(`credential_missing`) | `needs_pairing` | 인증 실패 |
| `1004 auth.failed`, `1006 auth.unknownDevice` | `auth_rejected` | 인증 실패 |
| `1005 auth.revoked` `reason: revoked`, 닫힘 4009 | `revoked` | 인증 실패(문구: 이 기기 연결이 해제됨) |
| `1005 auth.revoked` `reason: expired_absolute`·`expired_idle` | `expired` | 인증 실패(문구: 오래 쓰지 않아 다시 연결 필요) |
| `1008 auth.methodNotAllowed`(hello 오류) | `auth_rejected`(`detail`에 19의 `reason`) | 인증 실패 |
| 닫힘 1008, 직전 `connection.closing`의 kind 있음 | 그 kind를 위 행으로 | 위 행 |
| 닫힘 1008, 직전 kind 없음 | `policy_closed` | 인증 실패(문구: 서버가 연결을 거절함, 다시 페어링 안내) |
| `1003 protocol.unsupported` | `incompatible_version` | 버전 불일치 |
| `server.mismatch`(클라이언트 내부) | `wrong_server` | 다른 서버 |
| 닫힘 1002·1003 | `protocol_error` | 연속 3회 전에는 앱이 `client.start()`로 자동 다시 시작하고, 사용자 상태는 '다시 연결하는 중'(§3.8.9 행 6)이다. 같은 코드가 연속 3회면 `incompatible_version`으로 바꾸고 자동 재시작을 멈춘다. '버전 불일치'로 보인다(행 5). [판정 J-228] |
| 전송 `blocked`(`keychain_denied`) | `keychain_denied` | 키체인 거부 |
| 전송 `blocked`(`ssh_*`) | 그 `ssh_*` | SSH 실패 |
| 활성 경로 없음 | `no_routes` | 서버 PC에 연결할 수 없음 |

#### 3.8.9 사용자용 연결 상태와 결정 가능 여부 [제안, 상태와 문구는 04 §3.0.4, 타입은 21]

04 §3.0.4의 사용자용 상태를 `AppConnModel`로 판정한다(04 §5.2·21 §5.2의 20 요구). 위에서부터 처음 맞는 행을 고른다. 문구는 04 §3.0.4와 05 §3.11 키를 쓴다.

| 순서 | 04 사용자용 상태 | `UserConnKind` | 판정 | 21 `ConnectionUiState` | 결정 동작 |
|---|---|---|---|---|---|
| 1 | 키체인 거부 | `keychainDenied` | `blocked.reason == keychain_denied` | `keychainDenied` | 막음 |
| 2 | 인증 실패 | `authFailed` | `blocked.reason ∈ {needs_pairing, auth_rejected, revoked, expired, policy_closed}` | `authFailed` | 막음 |
| 3 | SSH 실패 | `sshFailed` | `blocked.reason ∈ {ssh_*}` | `sshFailed` | 막음 |
| 4 | 다른 서버 | `wrongServer` | `blocked.reason == wrong_server` | `wrongServer` | 막음 |
| 5 | 버전 불일치 | `versionMismatch` | `blocked.reason == incompatible_version`, 또는 `blocked.reason == protocol_error`이고 `protocolStreak.count >= 3` | `versionMismatch` | 막음. 캐시 읽기는 된다 |
| 6 | 다시 연결하는 중(프로토콜 오류) | `reconnecting` | `blocked.reason == protocol_error`이고 `protocolStreak.count < 3` | `reconnecting` | 막음, 초안 보존. 내부 원인 `protocol_error`는 사용자에게 보이지 않는다 [판정 J-228] |
| 7 | 서버 종료 중 | `draining` | `daemonMode == draining`, 또는 `server.shutdown` 뒤 `restartExpectedMs` 안 | `draining` | 막음 |
| 8 | Helm 서버 응답 없음 | `daemonUnreachable` | `core == backoff`이고 (`healthz == http5xx` 또는 `lastFailure.reason == daemon_unreachable`) | `daemonUnreachable` | 막음 |
| 9 | 서버 PC에 연결할 수 없음 | `serverPcUnreachable` | `core == backoff`이고 (끊긴 지 2분 넘음 또는 `attempts > 6`)이고 (`healthz == network` 또는 `deviceOnline == false`), 또는 `blocked.reason == no_routes` | `serverPcUnreachable` | 막음 |
| 10 | 다시 연결하는 중 | `reconnecting` | `core ∈ {connecting, handshaking, backoff}` | `reconnecting` | 막음, 초안 보존 |
| 11 | 다시 맞추는 중 | `syncing` | `core == syncing` | `syncing` | 막음(짧음) |
| 12 | 읽기 전용 | `readOnly` | `core == ready`, `daemonMode == readOnly` | `readOnly` | 막음(읽기만) |
| 13 | 안전 모드 | `safeMode` | `core == ready`, `daemonMode == safeMode` | `safeMode` | **가능**(사람 명령은 받는다, 04 §3.0.4) |
| 14 | 서버 다시 시작됨 | `restarted` | `core == ready`, `now − bootChangedAt < 1분` | `restarted` | 가능. 다시 맞추는 중(행 11)을 거친 뒤에만 이 행에 온다. 1분이 지나면 다음 행으로 내려간다 |
| 15 | 느림 | `slow` | `core == ready`, `now − lastMessageAt > tickIntervalMs × 1.5` | `slow` | 가능 |
| 16 | 연결됨 | `connected` | `core == ready` | `connected` | 가능 |
| - | 뷰 낡음(화면별) | `viewStale` | 보는 화면의 `serverFreshness`가 `stale`·`rebuilding`·`failed`. `toUserState`는 만들지 않는다 | `viewStale` | 그 화면의 결정만 막는다(`decisionsAllowed`의 `view`) |

- `UserConnKind`와 21의 `ConnectionUiState`는 04 §3.0.4의 상태 값 열여섯을 쓰고 [판정 J-176·J-196·J-228], 그 안에 `readOnly`·`safeMode`가 있다(판정 J-60·J-115). 키체인 거부·SSH 실패·다른 서버는 위 표처럼 각자의 상태 값에 묶고, 배너 문구(`reasonKey`)로 사유를 나눈다. `viewStale`은 연결 상태가 아니라 화면의 `serverFreshness`로 정하므로 `toUserState`가 만들지 않는다. `restarted`는 행 14의 1분 상태다.
- 읽기 전용은 사유별로 배너를 나눈다(판정 J-115, 17 §3.4.1). 화면 이름은 "읽기 전용"이고, "복구"는 `SCR-RECOVERY`에만 쓴다. 사유가 여럿이면 아래 표의 위쪽 것을 보인다.
- `healthz`는 `backoff`에 들어간 뒤 처음 실패했을 때와, 끊긴 지 2분이 지나거나 재시도가 6회를 넘었을 때 `GET /healthz`(인증 없음, 17 §3.11.3)를 한 번씩 보내 채운다. 이름 찾기나 연결이 실패하면 `network`, 502·503·504면 `http5xx`다. `serverPcUnreachable`과 `daemonUnreachable`은 이 값으로 나눈다(04 §3.0.4). 배너 문구 키는 `err.connection.serverPcUnreachable`과 `err.connection.daemonUnreachable`이다(05 §3.11). 아직 채우지 못했으면 `reconnecting`에 머문다.

| 읽기 전용 사유(17·19) | 배너 문구 키(05) | 사용자가 할 일 |
|---|---|---|
| `integrity_suspect` | `err.daemon.readOnly.integrity_suspect` | 서버에서 점검·복원(`SCR-RECOVERY`로 이동) |
| `disk_critical` | `err.daemon.readOnly.disk_critical` | 서버 디스크 공간 확보. 풀리면 자동으로 돌아온다 |
| `operator` | `err.daemon.readOnly.operator` | 서버에서 `helm ops read-only off` |
| `recovery_failed` | `err.daemon.readOnly.recovery_failed` | 서버에서 원인을 고친 뒤 다시 시작(17 §3.4.1) |
| `projection_fault` | `err.daemon.readOnly.projection_fault` | 서버에서 `helm ops rebuild-projections`(17 §3.4.1) |
| 사유 없음(옛 데몬) | `label.connection.readOnly`만 보인다 | - |

결정 가능 여부(21 `decisionsAllowed`, 04 §3.0.4 규칙 3). 계산은 `@helm/client-react` 한 곳이고 반환형은 `boolean` 하나다. 막힘 사유 문구는 `UserConnState.reasonKey`에서 따로 얻어 21 `DecisionAvailability { allowed, reasonKey }`로 묶는다:

```ts
// packages/client-react/src/connection/decisions.ts
export function decisionsAllowed(conn: ConnectionUiState, view: { serverFreshness: ServerFreshness }): boolean {
  const connOk = conn === 'connected' || conn === 'slow' || conn === 'restarted' || conn === 'safeMode';
  return connOk && view.serverFreshness === 'current';
}
```

- 앱 신선도의 `refreshing`과 낡음 표시(`staleSince`, 무효화 뒤 다시 받기까지 보통 150ms)로는 막지 않는다(04 §3.0.4 규칙 3). 그 사이의 경합은 데몬이 `3004 command.revisionConflict`로 거부하고, 화면은 04 §3.0.5로 처리한다. 버튼이 깜박이지 않게 하기 위해서다.
- 다시 받기가 세 번 실패해 `staleSince`가 남으면 앱 신선도가 `stale`이 되고 화면 머리에 띠를 보인다. 이때도 결정 막기는 서버 신선도와 연결로만 판정하고, 띠 문구로 사용자가 판단하게 한다.

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
    (UI 부품과 토큰은 앱 안에 두지 않는다. `packages/ui`(`@helm/ui`)와 `packages/ui-tokens`(`@helm/ui-tokens`)를 가져온다. 21 §3.13, 판정 J-85)
    connection/                # routes.ts(MultiRouteTransport), tauri-transport.ts, probe.ts(깨어남·포커스), store.ts(connStore에 AppConnModel 채우기)
    sync/                      # client.ts(HelmClient 생성), session.ts(§3.9.6), stores.ts(ClientStateStorage IndexedDB), views.ts(useView),
                               # liveText.ts(휘발 스트림 반영), commands.ts(useCommand)
    db/                        # idb.ts(스키마·이행), quota.ts
    platform/                  # ipc.ts, types.ts, index.ts(구현 고르기)
      tauri/                   # transport.ts, notifications.ts, tray.ts, badge.ts, shortcuts.ts, autostart.ts, deeplink.ts, settings.ts
      browser/                 # 개발·테스트용 대체 구현(§3.13.3). 배포 빌드에서는 빠진다
    state/                     # zustand: connStore.ts, uiStore.ts, liveTextStore.ts
    (문구는 앱 안에 두지 않는다. 연결·OS 알림·트레이 문구도 `@helm/ui-language`의 05 키로 만든다. 판정 J-103)
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

- 위 트리에서 플랫폼과 무관한 부분(`sync/views.ts`, `sync/commands.ts`, `sync/stores.ts`, 연결 모델·사용자용 상태·`decisionsAllowed`(§3.8.8·§3.8.9), 알림 규칙의 순수 함수, 딥 링크 해석)은 `packages/client-react`(`@helm/client-react`)에 두고 앱은 가져와 쓴다. 모바일 클라이언트와 나눠 쓰기 위해서다(§3.14).
- 의존 방향: `screens → @helm/ui, sync, navigation` / `sync → @helm/client(코어), @helm/protocol(타입), db, connection(상태 읽기)` / `connection → platform` / `platform/tauri → @tauri-apps/*`. `@helm/ui`는 `sync`, `platform`, `@helm/client`를 가져오지 않는다(21 UI-D01: 컴포넌트는 표현 전용). ESLint `import/no-restricted-paths`로 검사한다. 앱과 L6c 패키지는 `kernel`·`engine`·`runtime`·`daemon`을 import하지 않는다(06 R12).
- 세션·구독·재전송·뷰 무효화 판정은 코어(`@helm/client`, §3.9.4)가 하고 TUI도 같은 코어를 쓴다(§3.9.4). `@helm/client-react`의 연결 모델과 IndexedDB 저장소는 Tauri를 모르는 순수 TS다. TUI는 경로 선택과 IndexedDB가 필요 없어 이 패키지를 쓰지 않는다. 경로 선택기(`MultiRouteTransport`)는 Tauri IPC를 쓰므로 앱에 둔다.
- `@helm/protocol`(19)에서 메서드 이름, 파라미터·결과 타입, 뷰 이름·데이터 타입, TypeBox 스키마를 가져온다. 앱은 프로토콜 타입을 다시 정의하지 않는다.

#### 3.9.2 라우팅 [제안]

- 라이브러리: `react-router` 8.4.0의 라이브러리 방식, `createBrowserRouter` + `RouterProvider`. 프레임워크 방식(파일 경로 규칙, 서버 렌더링)은 쓰지 않는다. Tauri의 자산 해석은 없는 경로를 `index.html`로 돌려주므로 브라우저 라우터로 새로 고쳐도 깨지지 않는다 [검색: tauri 2.12.3 `crates/tauri/src/manager/mod.rs` 자산 해석 순서]. 브라우저 대체 실행(§3.13.3)과 같은 코드를 쓴다. 1판의 7.18.4 고정은 React 18 때문이었고 결정 41로 풀렸다.
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
  'SCR-STIM':             { path: '/concerns/:cnId/inquiry/want/:iqId/rounds/:roundNo' },
  'SCR-WORK':             { path: '/concerns/:cnId/work' },
  'SCR-AGREE':            { path: '/concerns/:cnId/work/:wuId/agreement' },
  'SCR-REVIEW':           { path: '/concerns/:cnId/work/:wuId/review' },
  'SCR-LOOPS':            { path: '/concerns/:cnId/history' },
  'SCR-THREAD':           { path: '/concerns/:cnId/thread' },
  'SCR-EVIDENCE':         { path: '/evidence/:recordId' },
  'SCR-GOALS':            { path: '/goals' },
  'SCR-GOAL':             { path: '/goals/:glId' },
  'SCR-DIALS':            { path: '/dials' },             // ?scope=user|concern:<id>. Goal 범위 다이얼은 없다(판정 J-136)
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
- 시작 경로: (1) 처리할 딥 링크가 있으면 그 경로, (2) 프로필이 없으면 `/onboard`, (3) 마지막 경로(설정의 `lastRoute`), (4) `/home`. 첫 동기화가 끝난 뒤 데몬이 준 `sinceLastAck.briefRecommended`가 참이면 `SCR-BRIEF`(`/brief`)를 자동으로 연다. 기준은 데몬이 정하고(04 §3.2, 부재 2시간 뒤 복귀는 14 §3.13.8), 딥 링크가 있으면 딥 링크가 먼저다.
- 최소 창 크기는 760×560(03 §3.4.2)이고 `tauri.conf.json`의 `minWidth`, `minHeight`로 둔다. 기본 크기는 1280×800이다.

#### 3.9.3 상태 관리 [제안, ADR 후보 ADR-20-05]

| 상태 | 둘 곳 | 이유 |
|---|---|---|
| 데몬 뷰(화면 데이터) | TanStack Query 5 캐시 + IndexedDB 영속(§3.9.5) | 요청 중복 제거, 마운트될 때 다시 읽기, 무효화 API, 가비지 수집을 직접 만들지 않는다 |
| 연결 상태 | 코어 상태 + 앱 연결 모델(`@helm/client-react`의 `AppConnModel`)을 zustand `connStore`에 | 상태 기계는 코어(19), 사용자용 상태 계산은 순수 함수(§3.8.8·§3.8.9). 화면은 스토어를 구독한다 |
| 세션 메타(`serverId`, 위치, 정책, 기능 목록) | 19 코어의 세션 객체 + `connStore` 요약 | |
| 휘발 스트림(에이전트 출력 글자) | zustand `liveTextStore` | 정본 로그에 없는 값(pi-cases-notes §12.1-6, 19 §3.5.2). 재접속 때 비우고 `active`로 다시 채운다 |
| 진행 중 명령함 | IndexedDB `pending`(코어의 `ClientStateStorage`) + `useCommand` 훅의 지역 상태 | 재시작해도 남아야 한다 |
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
      refetchOnWindowFocus: false,  // 포커스 때는 ping 확인만 한다(§3.8.8)
      refetchOnReconnect: false,    // 재접속 처리는 §3.9.6이 한다
    },
    mutations: { networkMode: 'always', retry: false }, // 명령은 §3.9.7의 명령함이 맡는다
  },
});
```

React 19 기능의 쓰임 [제안]:

| 기능 | 쓰임 |
|---|---|
| `use()` + Suspense | 1차에는 쓰지 않는다. 화면의 처음 불러오는 중·캐시 표시·빈 상태(04 §3.0.3)를 쿼리 상태로 직접 그리는 편이 상태 표가 분명하다. `useSuspenseQuery`로 바꿀 수 있게 화면 모델(`useScreenModel`)을 한 곳에 둔다 |
| Actions, `useActionState`, `useFormStatus` | 화면 지역의 "보내는 중" 표시에 쓸 수 있다. 명령 전송 자체는 `useCommand`가 맡는다 |
| `useOptimistic` | 도메인 데이터에는 쓰지 않는다(§3.9.7) |
| `ref` prop | 21의 부품 규칙을 따른다(결정 41로 `forwardRef`가 필요 없어짐, 21이 개정) |
| React Compiler 1.0 | 1차에는 켜지 않는다. 화면 성능 문제가 생긴 부분부터 켠다. `@vitejs/plugin-react` 6이 선택 피어로 받는다 [검색: npm] |
| 루트 오류 콜백 | 쓴다(§3.9.9) |

기각한 대안: (1) Redux Toolkit + RTK Query — 같은 일을 할 수 있으나 코드가 더 많다. 사용자의 기존 선호는 확인하지 못했다(§7 Q-10). (2) 상태 전부를 zustand 하나에 담기(v0.3 12 §11.1의 안) — 재조회·중복 제거·가비지 수집을 직접 만들어야 한다. (3) 이벤트를 앱에서 접어 상태를 만들기(Chord 식 상태 복제, facts-2 §6.2) — 접는 규칙이 도메인 지식이라 결정 32와 맞지 않는다.

#### 3.9.4 프로토콜 클라이언트: 19의 `HelmClient`를 쓴다 [제안, 2a단계에서 19 §3.14에 맞춰 다시 씀]

클라이언트 코어는 `@helm/client`(판정 §2: 별도 패키지, `@helm/protocol`에만 의존)의 `HelmClient`다(19 §3.14). 데스크톱 앱은 JSON-RPC를 따로 구현하지 않는다. TUI와 모바일 클라이언트(26)도 같은 코어를 쓴다(§3.14).

| 코어(19)가 하는 일 | 앱(20)이 하는 일 |
|---|---|
| JSON-RPC 요청 ID, 시간 제한(조회 30초, 명령 60초), 취소, envelope 검사(TypeBox) | `Transport` 구현: `MultiRouteTransport`(§3.8.8)와 그 안의 `TauriIpcTransport`(IPC 채널, §3.4). 시험용 `BrowserWsTransport`(§3.13.3) |
| `hello.challenge` 대기, `serverId` 비교, `hello`, 정책·기능 목록 보관, 상태 기계와 백오프 | `expectedServerId`, `auth: { method: "deviceToken", deviceId, sign? }` 제공. `sign`은 증명을 켤 때만 Rust 명령 `device_sign_challenge`를 부른다(토큰·개인 키는 웹뷰에 없음) |
| `subscribeEvents(subKey, …)`의 위치 저장·복원, `(from, to]` 검사, gap, `2001` 스냅샷 경로 | `ClientStateStorage`의 IndexedDB 구현(§3.9.5). 위치 저장과 낡음 표시를 한 트랜잭션에 쓴다(§3.9.6-4) |
| 추적 뷰(`trackView`)의 무효화 판정 → `invalidate(viewKeys, seq)` | 무효화를 TanStack Query와 IndexedDB 낡음 표시로 연결(§3.9.6) |
| `subscribeStream`의 `n`·`offset` 처리, `run.partial`로 맞추기 | 휘발 상태를 `liveTextStore`에 반영 |
| `command()`: 멱등 키 생성, 보내기 전 `putPending`, 응답 뒤 `removePending`, `syncing` 진입 때 같은 키로 재전송 | 화면 상태(`useCommand`), 결과를 모르는 명령과 기한 지난 명령의 표시 |
| `tick` 감시와 4000 닫기 | 마지막 수신 시각으로 "느림" 판정(§3.8.9) |
| 오류 객체 해석(`code`, `kind`, `retryable`, `retryAfterMs`) | 오류 → 화면 문구(05 §3.11 키, §3.9.9) |

```ts
// apps/desktop/src/sync/client.ts
import { HelmClient } from '@helm/client';
export function createDesktopClient(p: ServerProfile, stores: IdbClientStateStorage): HelmClient {
  return new HelmClient({
    transportFactory: () => new MultiRouteTransport(p),          // 경로 선택은 바깥(19 §3.14)
    client: { kind: 'desktop', version: APP_VERSION, build: BUILD_ID, platform: PLATFORM, instanceId: INSTANCE_ID },
    auth: { method: 'deviceToken', deviceId: p.deviceId!, sign: proofEnabled ? signViaRust(p) : undefined },
    expectedServerId: p.serverId ?? undefined,
    storage: stores,
  });
}
```

- 코어 사본을 앱에서 고치지 않는다. 필요한 기능은 19에 요구해 코어에 더한다. 2a단계 요구(`blocked`, `retryNow()`, `lastMessageAt`, `pendingResolved`, 무효화 순서)는 19 §3.14에 반영됐다. 남은 요구는 재전송 전 `storeId` 확인과 `listPending`의 현재 값 인자, `command.lookup`이다(§5.2).
- 앱 쪽 연결 모델(§3.8.8)은 `client.on('state', …)`, `client.hello`, `serverRestarted`, `server.shutdown`을 받아 만든다.

#### 3.9.5 클라이언트 저장소 [제안]

IndexedDB 데이터베이스 `helm-desktop`, 버전 1. `idb` 8로 연다. 모든 키에 `serverId`가 있어 서버별로 나뉜다. `IdbClientStateStorage`는 19의 `ClientStateStorage`를 구현하고, 뷰 캐시와 초안은 앱 전용 store다.

```ts
// apps/desktop/src/db/idb.ts
interface PositionRow {            // store 'positions', key: [serverId, subKey] — 19 loadPosition/savePosition
  serverId: string; subKey: string;               // 데스크톱은 subKey 'main' 하나(전체 스트림, 19 §3.6.1)
  position: { storeId: string; seq: number };
  savedAt: number;
}
interface ServerMetaRow {          // store 'meta', key: serverId
  serverId: string;
  lastBootEpoch: string | null;    // 바뀌면 "서버가 다시 시작되었습니다" 띠(19 §3.5.1, 04 §3.0.4)
  lastHelloAt: string;
  protocol: number;
  serverVersion: string;
  schemaHash: string;              // hello features.schemaHash
  recentDeliveryIds: string[];     // 띄운 OS 알림 ID, 최근 500개(§3.10.1)
  lastPolicy?: { pendingCommandMaxAgeMs: number };
}
interface ViewRow {                // store 'views', key: [serverId, view, paramsKey], index: [serverId, viewKey], lastAccessAt
  serverId: string;
  view: string;                    // 19 §3.7.4 뷰 이름
  paramsKey: string;               // params를 키 정렬한 JSON. 연결 없이 캐시를 찾을 때 쓴다
  viewKey: string;                 // 응답의 key(정본, 19). 무효화 판정에 쓴다
  asOfSeq: number;
  dependsOn: string[];
  staleSince: number | null;       // 이 뷰를 낡게 만든 가장 큰 이벤트 seq. null이면 낡지 않음
  serverFreshness: 'current' | 'stale' | 'rebuilding' | 'failed';
  staleReason?: { key: string; args?: Record<string, string> };
  generatedAt: string;
  data: unknown;                   // 뷰 데이터(구조화 복제)
  fetchedAt: number;
  lastAccessAt: number;
  approxBytes: number;
  schemaHash: string;              // 다르면 버린다
}
interface PendingRow {             // store 'pending', key: [serverId, idempotencyKey] — 19 PendingCommand + 앱 표시용 필드
  serverId: string;
  idempotencyKey: string;          // 'ik_<ULID>'
  method: string;
  params: unknown;                 // CommandParamsBase 포함. 토큰·비밀 없음
  createdAt: number;
  storeId: string;                 // 보낼 때의 hello.log.storeId. 다르면 자동 재전송하지 않는다(복원 감지, F-17)
  deviceId: string;                // 보낼 때의 기기 ID. 재페어링으로 바뀌면 자동 재전송하지 않는다(멱등 범위가 기기별, F-06)
  protocol: number;                // 보낼 때의 프로토콜 판. 다르면 자동 재전송하지 않는다
  schemaHash: string;              // 보낼 때의 hello features.schemaHash. 다르면 자동 재전송하지 않는다(F-38)
  appState?: 'expired' | 'storeReset' | 'deviceChanged' | 'schemaChanged' | 'permanentError';
                                   // 자동 재전송 대상이 아님을 앱이 표시(§3.9.7). 모두 "보내지 못한 조작"으로 보인다
  screen?: string; objectId?: string;    // "보내지 못한 조작" 목록에서 열 화면(04 §3.19)
}
interface DraftRow {               // store 'drafts', key: [serverId, kind, targetId] — 04 §5.2 "초안 저장 확장"
  serverId: string;
  kind: 'answer' | 'reaction' | 'agreementEdit' | 'reviewNote' | 'objection' | 'composer';
  targetId: string;                // 질문·자극 라운드·작업 합의·결과 제출·레코드·Concern ID
  payload: unknown;                // 구조화한 내용(예: 답 종류 + 본문, 반응 목록). 타입은 kind별(04 각 화면 절). `objection`은 `{ reasonKind, reason }`이다. 두 값은 19 `objection.file`의 인자와 같고, `reasonKind`는 08 `ObjectionCore.reasonKind`의 값을 쓴다(`reason`이 없으면 `null`)
  basisSeq: number | null;         // 초안을 쓸 때 본 뷰의 asOfSeq
  storeId: string | null;          // 초안을 쓸 때의 저장소 ID. 다르면 basisSeq를 버리고 대상 존재를 다시 확인한다
  origin?: 'typed' | 'restored';   // restored = 거부·충돌·읽기 전용으로 돌아온 답(§3.9.7)
  updatedAt: number;
}
```

- `ClientStateStorage` 대응: `loadPosition`·`savePosition` → `positions`, `listPending`·`putPending`·`removePending` → `pending`, `clearServer(serverId, "positions")` → `positions` 삭제와 모든 `views` 행 낡음 표시, `clearServer(serverId, "all")` → `positions`·`views` 삭제와 `pending` 행에 `appState: 'storeReset'` 표시(F-17). `listPending`은 `appState`가 있는 행을 빼고 돌려준다(코어가 자동으로 다시 보내지 않게).
- 재전송 전 확인(F-06, F-17, F-38): 코어는 `hello` 직후 진행 중 명령을 다시 보내므로, `events.subscribe`가 `2001`을 받은 뒤에 붙는 `storeReset` 표시로는 늦다. 그래서 (1) 코어가 `hello.log.storeId`를 저장 위치의 `storeId`와 비교해 다르면 재전송 전에 `clearServer(serverId, "all")`을 부르고, (2) `listPending`이 현재 `storeId`·`deviceId`·`protocol`·`schemaHash`를 받아 행의 값과 다르면 그 행에 `appState`(`storeReset`·`deviceChanged`·`schemaChanged`)를 붙이고 돌려주지 않는다. 두 가지 모두 19 §3.14의 코어와 `ClientStateStorage` 계약에 요구한다(§5.2). 받아들여지기 전에는 앱의 `listPending`이 마지막 `hello` 값(`meta`)과 비교한다.
- 초안과 복원: `drafts`의 `storeId`가 현재 저장소와 다르면 `basisSeq`를 `null`로 바꾸고, 대상 ID를 `record.locate`(19 §3.7.6)로 확인한다. 대상이 있으면 "서버 기록이 복원되어 이 초안의 기준을 알 수 없습니다. 내용을 확인하고 보내세요."와 함께 보이고, 없으면 `SCR-CONNECT`의 "보내지 못한 조작" 옆 보관 목록으로 옮긴다(05 문구 키 요구).
- 상한: 서버당 뷰 64 MiB. 넘으면 `lastAccessAt`이 오래된 것부터 지운다. 고정 뷰(`home`, `brief`, `inbox`, `autonomous`, `concernTree`, `goals`, `recovery`, `tray`)는 지우지 않는다. 오프라인으로 시작했을 때 이것들은 보여야 한다.
- 저장 위치는 웹뷰가 정한다. Windows는 `%LOCALAPPDATA%\<identifier>\EBWebView` 아래, macOS는 `~/Library/WebKit/<bundle id>/WebsiteData` 아래다 [검색: Windows는 tauri `manager/webview.rs`, macOS는 지식]. origin이 바뀌면(예: Windows `useHttpsScheme` 변경) 다른 데이터베이스가 된다 [검색: tauri `config.rs` 주석]. 그래서 `useHttpsScheme`은 처음 값(`false`)에서 바꾸지 않는다.
- WebKit은 브라우저가 아닌 앱에도 origin별 용량 한도와 자동 삭제 정책을 둔다 [검색: webkit.org/blog/14403]. 자동으로 지워지면 위치가 없으므로 코어가 `from: "head"`로 구독하고 열린 뷰를 다시 받는다. IndexedDB는 캐시이고 정본은 데몬이다. 초안이 지워질 수 있다는 점은 받아들인다.
- 뷰 데이터, 초안, blob 디스크 캐시(§3.8.6)는 암호화하지 않는다. 기기 디스크 암호화(FileVault, BitLocker)에 맡긴다(18 §3.19의 오프라인 사본 규칙). 첫 실행 안내(`SCR-ONBOARD`)의 끝에서 디스크 암호화가 꺼져 있으면 켜라고 안내한다. macOS는 `fdesetup status`, Windows는 `manage-bde -status`를 Rust가 읽어 판정하고, 판정하지 못하면 안내 문장만 보인다 [제안]. 설정 `offlineCopy`를 끄면 `views`에 쓰지 않는다.
- `profile_delete`이면 그 `serverId`의 모든 store 행을 지운다. `pending`은 사람이 확인하기 전까지 남긴다.
- 폐기와 만료는 나눠 처리한다(19 `1005 auth.revoked`의 `reason`, 닫힘 4009). 폐기(`revoked`)는 기기를 잃었거나 다른 사람이 쓸 수 있다는 뜻이므로 그 `serverId`의 `views`, `pending`, blob 디스크 캐시를 지우고 `drafts`만 남긴다. 키체인 항목도 지운다. 만료(`expired_absolute`·`expired_idle`)는 정상 사용자가 오래 쓰지 않은 경우라 모두 남기고 재페어링을 안내한다. 남은 `pending`은 재페어링 뒤 `deviceId`가 바뀌므로 자동 재전송에서 빠지고 "보내지 못한 조작"으로 보인다(F-06). 18·19·26과 같은 규칙으로 맞춰 달라고 요구한다(§5.2).
- IndexedDB 버전을 올릴 때 `views`는 버리고 다시 만든다(캐시이므로 옮기지 않는다). `positions`, `pending`, `drafts`만 옮긴다.

#### 3.9.6 동기화 알고리즘 [제안, 프로토콜 규칙은 19 §3.5·§3.6·§3.14]

사례 8곳 중 데몬 재시작을 넘어 같은 커서로 이벤트를 다시 받는 클라이언트 프로토콜은 없다. happy-agent·paseo·pi-web·openclaw는 클라이언트용 seq를 메모리에 두고, 끊기면 스냅샷으로 다시 맞춘다(pi-cases-notes §1-1, §11.2, §12.2-1). Helm은 SQLite 이벤트 로그의 seq를 그대로 클라이언트 위치로 쓰므로(결정 29·31, 19 P-05) 재시작 뒤에도 위치 재개가 기본 경로이고, 스냅샷 맞추기는 범위를 벗어났을 때만 쓰는 대체 경로다. 사례에서 가져온 것은 순서와 경계다: 구독 먼저·스냅샷 나중(happy-agent `ApiModule.ts:4456-4530`, 19 §3.5.6), 스냅샷의 seq 경계(pi-web `transcript-snapshot`, happy-agent bootstrap), 세대 감지(`storeId`, `bootEpoch`, 19 §3.5.1), "늦은 캐시 읽기가 진전된 상태를 덮지 않음"(paseo `docs/architecture.md:126-140`).

앱 쪽 절차(`sync/session.ts`). 프로토콜 판정은 코어가 하고, 앱은 저장과 화면 연결을 한다.

```text
0. 앱 시작(boot):
   a. settings, profiles 읽기 → 활성 프로필
   b. 프로필에 serverId가 있으면 IndexedDB의 고정 뷰를 TanStack 캐시에 넣는다
      (setQueryData, updatedAt = fetchedAt, 연결 전이라 앱 신선도 'stale')
      → 연결 전에 화면이 마지막 뷰를 읽기 전용으로 그린다
   c. pending에서 meta.lastPolicy.pendingCommandMaxAgeMs(없으면 24시간)를 넘은 행에 appState 'expired' 표시
      (코어도 이 나이를 넘은 명령은 자동으로 다시 보내지 않는다, 19 §3.9.1)
   d. client = createDesktopClient(profile, storage)            // §3.9.4
      client.subscribeEvents('main', {}, onEvents)               // 전체 스트림 하나(19 §3.6.1)
      client.on('invalidate', onInvalidate); client.on('serverRestarted', onRestart)
      client.start()

1. 코어: 전송 열기(MultiRouteTransport) → hello.challenge → serverId 비교 → hello → syncing
   코어가 hello.log.storeId를 저장 위치의 storeId와 비교하고, 다르면 먼저 clearServer(serverId, 'all')을 부른다(§3.9.5, 19에 요구)
   코어가 syncing에 들어가며 남은 진행 중 명령을 같은 키로 다시 보내고, 'main' 구독을 저장 위치에서 복원한다

2. hello를 받은 뒤(client.hello):
   - features.schemaHash가 meta와 다르면 views의 해당 행을 버리고 meta 갱신
   - server.bootEpoch가 meta.lastBootEpoch와 다르면 "서버가 다시 시작되었습니다" 띠 1분(04 §3.0.4). meta 갱신
   - policy를 meta.lastPolicy에 저장(오프라인 시작 때 나이 판정에 씀)
   - 열린 화면의 휘발 스트림 구독(client.subscribeStream)을 다시 연다. { reset: RunPartial }로 liveTextStore를 채운다

3. onInvalidate(viewKeys, seq):          // 코어가 trackView로 등록한 뷰 중 dependsOn ∩ invalidates ≠ ∅
   - 메모리: 해당 쿼리의 staleSince = max(staleSince, seq)
   - IndexedDB 기록 대기열(staleBuffer)에 (viewKey, seq)를 더한다
   - 연결이 ready이고 그 뷰가 화면에 열려 있으면 다시 받기 예약(키마다 150ms 디바운스, minSeq = staleSince)
   - syncing(재전송 중)이면 다시 받기를 ready까지 미룬다(19 §3.6.3)

4. onEvents(events, { caughtUp }):      // 코어가 (from, to] 계약과 gap을 이미 검사했다
   - 전달 이벤트(09·11 이름, 후보 question.delivered)는 §3.10.1로. caughtUp 전이면 묶음 대상으로만 센다
   - 활동 고리(메모리 500개)에 넣는다. SCR-RECORD는 events.read로 데몬에서 다시 읽는다

5. 위치 기록: 코어가 storage.savePosition(serverId, 'main', pos)를 부른다
   앱 구현: 한 IndexedDB 트랜잭션(stores: positions, views)에서
     positions[serverId, 'main'] = pos
     staleBuffer에서 seq ≤ pos.seq 인 항목을 꺼내 각 뷰 행 staleSince = max(staleSince, seq)
   → 위치만 앞서 기록되고 낡음 표시가 빠지는 일이 없다. 앱이 죽어도 다음 시작 때 낡은 캐시를 안다
   전제: 코어는 위치 pos까지의 이벤트에 대한 invalidate를 savePosition(pos)보다 먼저 내보낸다(19 §3.14)

6. 범위 밖(2001)일 때 코어가 storage.clearServer를 부르고 19 §3.5.5 절차를 한다:
   storeMismatch | aheadOfHead → clearServer(serverId, 'all') → views·positions 삭제, pending에 'storeReset' 표시
   beforeOldest | tooFar       → clearServer(serverId, 'positions') → 모든 뷰 행 staleSince = asOfSeq + 1
   코어가 'head'부터 구독(H0)하고 invalidate로 모든 추적 뷰를 알린다 → 열린 뷰를 view.get({ minSeq: H0 })로 다시 받음
   이력형 화면(SCR-RECORD, SCR-LOOPS)은 events.read({ before: H0 + 1 })로 거꾸로 채우고
   그 앞에 "접속하지 않은 동안의 이전 기록은 생략됨"을 보인다

7. ready(caughtUp):
   staleSince > asOfSeq 인 열린 뷰를 한 번에 다시 받는다(동시에 최대 4개. happy-agent는 3, pi-cases-notes §3.7)
   재전송 중 받은 전달이 있으면 묶음 알림 하나(§3.10.1)
```

뷰 읽기(`sync/views.ts`):

```ts
export function useView<V extends ViewName>(view: V, params: ViewParams<V>, opts?: { enabled?: boolean }): ViewState<ViewData<V>>;

export interface ViewState<T> {
  data: T | undefined;
  asOfSeq: number | null;
  generatedAt: string | null;
  receivedAt: number | null;                                         // "14:02 기준 (12분 전)" 문구(04 §3.0.8)
  freshness: 'current' | 'refreshing' | 'stale' | 'missing' | 'failed';   // 앱 신선도, §3.9.8
  serverFreshness?: 'current' | 'stale' | 'rebuilding' | 'failed';      // 응답의 freshness 그대로(04 §3.0.2)
  staleReason?: { key: string; args?: Record<string, string> };         // 05 문구 키
  error?: AppFacingError;
}

// TanStack queryKey: ['view', serverId, view, paramsKey]
async function fetchView(view, params): Promise<ViewRow> {
  const row = await db.views.get([serverId, view, paramsKey(params)]);
  if (client.state !== 'ready' && client.state !== 'syncing') {
    if (row) return row;                                    // 화면은 'stale'로 그린다
    throw new OfflineNoDataError(view);
  }
  const minSeq = row?.staleSince ?? undefined;
  const r = await limiter.run(() => client.getView(view, params, { minSeq }));   // 2006 view.notReady는 retryable → TanStack retry
  if (row && r.asOfSeq < row.asOfSeq) return row;           // 늦게 끝난 요청이 더 새 값을 덮지 않는다(paseo 규칙)
  client.trackView(r.key, r.dependsOn, r.asOfSeq);          // 무효화 감시 등록(19 §3.14)
  const next = toRow(r, { staleSince: (minSeq !== undefined && r.asOfSeq >= minSeq) ? null : row?.staleSince ?? null });
  if (settings.offlineCopy) await db.views.put(next);
  return next;
}
// 쿼리가 gcTime으로 지워질 때 client.untrackView(viewKey). 고정 뷰는 늘 추적한다
```

- `getView`의 `minSeq`는 데몬이 지킨다(19 §3.5.6. 못 지키면 `2006`을 돌려주고 앱은 재시도한다).
- 쪽 나뉨 뷰(`thread`, `records`)는 `useInfiniteQuery`로 읽고, 낡으면 첫 쪽만 다시 받는다. 첫 쪽의 `asOfSeq`가 기준이다.
- 휘발 스트림: 코어가 `n`·`offset`을 검사해 넘긴 조각을 `liveTextStore[messageId]`에 반영한다(19 §3.6.4. happy-agent `applyMessageDelta.ts:4-40`과 같은 offset 방식). 영속 이벤트(메시지 완성, 도구 결과, run 종료)가 오면 해당 휘발 상태를 지운다. `end` 조각의 `finalSeq`를 위치가 넘을 때까지는 지우지 않는다(19 §3.6.4). 재접속하면 비우고 `{ reset }`으로 다시 채운다.

#### 3.9.7 명령 전송: 멱등 키, `basisSeq`, 진행 중 명령함 [제안, 필드는 19 §3.7.2·§3.9]

- 낙관적 도메인 갱신을 하지 않는다(21 UI-D03, 결정 14, 19 §3.5.9). React 19의 `useOptimistic`과 폼 Actions의 낙관적 상태도 도메인 데이터에는 쓰지 않는다. 화면은 "보내는 중"만 보이고, 결과는 응답과 그 뒤의 뷰 무효화로 받는다(canon §12.12 #4).
- 예외(앱 지역 상태만): 펼침·선택·탭, 입력 초안, 화면 설정.

```ts
// apps/desktop/src/sync/commands.ts
export function useCommand<M extends CommandMethodName>(method: M): {
  send(params: Omit<ParamsOf<M>, 'idempotencyKey' | 'basisSeq'>, o: { basisSeq: number; screen?: string; objectId?: string }): Promise<CommandOutcome>;
  status: 'idle' | 'sending' | 'waiting_reconnect' | 'done' | 'rejected' | 'failed';
  lastOutcome?: CommandOutcome;
};
export type CommandOutcome =
  | { kind: 'applied' | 'accepted'; result: CommandResult }       // 19 CommandResult.status
  | { kind: 'gated'; result: CommandResult }                      // 질문이 생겼다 → questionId로 이동 제안
  | { kind: 'conflict'; details: { subject: string; expected: unknown; current: number; rebase?: unknown } }   // 3004
  | { kind: 'alreadyResolved'; target: RecordRef; resolvedAt: string; resolvedBy: string; resolvedVia?: string;
      outcome: 'answered' | 'assumed' | 'withdrawn' | 'expired' | string; assumedValue?: unknown }          // 3008(판정 J-120)
  | { kind: 'superseded'; target: RecordRef; supersededBy: RecordRef }                                     // 3009
  | { kind: 'rejected'; code: 3001 | 3002 | 3005; reason: string; nextActions?: NextAction[] }               // 커널 거부(10)
  | { kind: 'readOnly'; reasons: ReadOnlyReason[] }                // 5003. 적용되지 않음이 확정이다
  | { kind: 'unknown' }                                           // 끊김·시간 초과. 코어가 재접속 뒤 같은 키로 확인
  | { kind: 'expired' };                                          // 정책 나이를 넘어 자동으로 보내지 않음
```

보내기 절차:

```text
send(params, { basisSeq, screen, objectId }):
  require decisionsAllowed(...)                  // §3.8.9. 막혀 있으면 버튼이 꺼져 있다. 여기 오면 프로그래밍 오류
  r = client.command(method, { ...params, basisSeq, clientTime: now })
       // 코어가 ik_<ULID>를 만들고 putPending을 끝낸 뒤 보낸다(19 §3.14). 앱 저장소는 screen·objectId를 함께 적는다
    성공             → applied | accepted | gated. removePending
    3004             → conflict → "화면을 연 뒤 상황이 바뀌어…"(04 §3.0.5), 쓰던 답 유지. removePending
    3008             → alreadyResolved → 04 §3.0.5 "이미 답했습니다(다른 기기 · 시각)". removePending.
                       outcome이 assumed면 확정된 값(assumedValue)을 보이고 쓰던 답을 이의 초안으로 넘긴다(판정 J-120)
    3009             → superseded → "새 판으로 바뀌었습니다", [새 판 보기]로 supersededBy를 연다. removePending, 쓰던 답 유지
    3001·3002·3005   → rejected → 거부 사유와 nextActions(05 §3.11). removePending
    5003             → readOnly → removePending, 쓰던 입력을 drafts(origin 'restored')로 돌린다.
                       5003은 적용되지 않음이 확정된 응답이다. 모드가 풀려도 자동으로 보내지 않는다(판정 J-02, 04 ADR A4).
                       풀리면 그 화면에 "보내지 않은 답이 있습니다"를 보이고 사람이 보낸다
    3006(keyReused)  → 진단 로그, 일반 오류 문구(버그 신호). removePending
    3007(inProgress) → 코어가 retryAfterMs 뒤 같은 키로 다시
    retryable false인 그 밖의 오류(-32600·-32601·-32602·5007 등)
                     → removePending 대신 appState 'permanentError'로 표시하고 "보내지 못한 조작"에 보인다
    끊김·시간 초과    → unknown. status 'waiting_reconnect'. 행은 pending에 남는다

코어의 재전송(syncing 진입 때):
  재전송 전 확인(§3.9.5): storeId·deviceId·protocol·schemaHash가 다른 행은 보내지 않는다
  나이가 pendingCommandMaxAgeMs 안인 행을 같은 키로 다시 보낸다
  데몬은 같은 키면 처음 결과를 duplicate: true로 돌려준다(보존 idempotencyWindowMs 7일, 19 §3.9.2)
  결과는 코어의 'pendingResolved' 알림(19 §3.14)으로 받는다. 화면이 아직 기다리면 그 화면에 넘기고, 아니면 결과별 토스트(05 키):
    성공             → "연결이 끊긴 동안 보낸 조작이 처리됐습니다"
    3004·3009        → "연결이 끊긴 동안 상황이 바뀌어 조작이 적용되지 않았습니다", 쓰던 내용을 drafts(origin 'restored')로 되살린다
    3008             → "다른 곳에서 먼저 처리했습니다", 위 3008 규칙대로
    3001·3002·3005   → "조작이 거부되었습니다 · 이유", 쓰던 내용을 drafts로 되살린다
    5003             → 위 5003 규칙대로
  나이 초과 행과 appState가 붙은 행은 SCR-CONNECT "보내지 못한 조작"(04 §3.19):
    먼저 command.lookup({ idempotencyKey })(19에 요구, 읽기 메서드)로 원래 키의 결과를 묻는다.
      결과가 있으면 그 결과를 보이고 행을 지운다(두 번 적용되지 않게)
      결과가 없거나 조회할 수 없으면(키 보존 기간 7일 경과, 다른 storeId) 내용과 원래 화면(screen·objectId)을 보이고,
      다시 보내려면 그 화면을 열어 바뀐 상황을 본 뒤 새 키와 현재 basisSeq로 보낸다
    command.lookup은 원래 기기의 deviceId 범위에서만 찾으므로 deviceChanged 행은 조회 없이 "결과를 알 수 없음"으로 보인다

```

- `basisSeq`는 19에서 필수다. 사람이 결정한 카드가 속한 뷰의 `asOfSeq`를 넣는다(21 UI-D02). 화면 밖 동작(트레이의 방해 금지 등)은 그때의 구독 위치를 넣는다(19 §3.7.2). `expect`(레코드 revision)는 뷰 데이터의 `RecordRef.revision`을 아는 화면만 넣는다(19 §3.7.4).
- 연결이 없을 때 새 결정을 받아 쌓아 두는 오프라인 큐는 두지 않는다(판정 J-02, 04 SC-03). 쓰던 내용은 초안(`drafts`)으로 남긴다. OpenClaw iOS의 오프라인 송신 outbox(50개, 48시간, pi-cases-notes §12 그 밖)와 다른 선택이다. 질문의 전제가 그 사이 바뀔 수 있어 낡은 화면에서의 결정을 늦게 보내지 않는다.
- 진행 중 명령함은 "보냈는데 결과를 모르는 것"만 다룬다. 재전송은 결과 확인용이다. 결과가 정해진 응답(성공, 3001~3009, 5003, retryable false 오류)을 받으면 행을 지우거나 "보내지 못한 조작"으로 옮기고, 같은 행을 다시 보내지 않는다.

#### 3.9.8 오프라인과 낡은 데이터 표시 [제안, 화면 규칙은 04 §3.0.3·§3.0.4]

연결 상태(§3.8.8)와 뷰 신선도는 따로 계산하고 따로 그린다(canon-2 §3.16, 21 §3.5.8 `FreshnessIndicator`). 뷰 신선도는 두 값을 합친다: 데몬이 응답에 넣은 `freshness`(데몬 쪽 판정, 19 §3.6.3)와 앱의 낡음 표시(`staleSince`).

| 앱 신선도(`ViewState.freshness`) | 조건 | 화면(04 §3.0.3) |
|---|---|---|
| `current` | 연결 `ready`, `staleSince`가 없음, 서버 신선도 `current` | 표시 없음 |
| `refreshing` | 연결 `ready`, 무효화 뒤 다시 받는 중(`staleSince` 있음) | 이전 데이터를 그대로 보이고 1초 넘으면 작은 진행 표시. 결정은 막지 않는다(§3.8.9) |
| `stale` | 연결이 `ready`가 아님, 또는 다시 받기가 세 번 실패해 `staleSince`가 남음, 또는 서버 신선도가 `stale`·`rebuilding` | "이 화면은 14:02 기준입니다 (12분 전)"(04 §3.0.4·§3.0.8, 05 키). 화면의 "지금"류 문구를 기준 시각 문구로 바꾼다(04 §3.0.4 규칙 2). 결정 막기는 §3.8.9 규칙(서버 신선도와 연결)으로만 |
| `missing` | 연결이 없고 캐시에도 없음 | "연결되면 볼 수 있습니다" 빈 상태 |
| `failed` | 서버 신선도 `failed`, 스키마 불일치, 데몬 오류 | 04 §3.0.3 오류 상태, `staleReason`으로 문구(05) |

- 오프라인으로 시작해도 고정 뷰로 홈·질문함·복귀 요약을 읽을 수 있다. 원전의 "offline-first read/review"(canon-3 §6.10.2)를 읽기 쪽으로만 구현한다. 오프라인 상태의 결정은 받지 않는다(§3.9.7, 04 ADR A4).
- 재접속 뒤 바뀐 항목 표시(04 §3.0.4 규칙 4): 다시 받은 뷰의 `RecordRef` 중 `revisionSeq`가 끊기기 전 캐시의 `asOfSeq`보다 큰 것에 "다시 연결된 뒤 바뀜" 표시를 1분 붙인다. `revisionSeq`는 19가 모든 `RecordRef`에 넣으므로(19 §3.7.4) 앱은 도메인 지식 없이 비교만 한다. 표시 대상 ID 목록은 `uiStore.changedSinceReconnect`에 두고 21 컴포넌트가 읽는다.
- 초안 보존(04 §3.0.4 규칙 5·6, 04 SC-Q2, 04 §5.2 "초안 저장 확장"): 질문 답, 작업 합의 수정, 결과 확인 메모, 이의 사유, 자극 반응, 대화 입력을 입력할 때마다(300ms 디바운스) `drafts`에 `{kind, targetId, payload, basisSeq}`로 쓴다(§3.9.5). 다시 연결되면 초안이 있는 화면에 "보내지 않은 답 1개가 있습니다. 바뀐 상황을 확인하고 보내세요."를 보이고, 자동으로 보내지 않는다. 초안의 `basisSeq`보다 뷰의 `asOfSeq`가 크고 대상의 `revisionSeq`도 커졌으면 "초안을 쓴 뒤 바뀜"을 함께 보인다. 보내면 그때의 `basisSeq`를 쓰고, 성공하면 초안을 지운다.
- 화면이 시간을 표시할 때 기준은 사용자 로컬 시간대다(브리프 §3.3). 프로토콜의 ISO 문자열을 `Intl.DateTimeFormat('ko-KR', …)`으로 바꾼다(04 §3.0.8).

#### 3.9.9 오류 경계 [제안]

| 층 | 위치 | 잡는 것 | 보이는 것 |
|---|---|---|---|
| L0 앱 | `main.tsx`의 `AppCrashBoundary` | 셸까지 무너진 렌더 오류 | 전체 화면 "화면을 그리다 처리하지 못한 오류가 생겼습니다. 다시 불러오세요. (코드 …)"(05 키) + [다시 불러오기] + [진단 묶음 만들기](`diag_bundle`). 연결은 Rust에 있으므로 다시 불러와도 데몬 쪽 작업과 무관하다 |
| L1 화면 | 루트 레이아웃의 `<Outlet>`을 감싼 `ScreenBoundary`(경로가 바뀌면 초기화) | 화면 하나의 렌더 오류 | 셸은 남기고 본문에 오류 카드 + [이 화면 다시 열기] |
| L2 패널 | 검사 패널, 대화 스레드(assistant-ui), 이미지, 시각화 | 부분 오류 | 그 패널만 대체 표시 |

- `react-error-boundary` 6을 쓴다(React 19도 오류 경계는 클래스 컴포넌트로만 만들 수 있다 [지식]).
- `createRoot(el, { onUncaughtError, onCaughtError, onRecoverableError })`(React 19의 루트 오류 콜백 [지식])로 모든 렌더 오류를 `tauri-plugin-log`에 남긴다. 화면 표시는 위 경계가 하고 콜백은 기록만 한다.
- 비동기 오류(투영 읽기 실패, 명령 실패)는 오류 경계로 던지지 않고 화면 상태(§3.9.8, `CommandOutcome`)로 다룬다. 예외: `ProtocolDataError`가 고정 키에서 나면 L1로 던진다.
- 오류 문구는 `errors/messages.ts`가 `AppErrorCode`, `TransportCloseReason`, `RpcError.code`, `KernelRejectReason`을 05의 문구로 바꾼다. 모르는 코드는 "처리하지 못한 오류가 생겼습니다. 다시 불러오세요. (코드 …)"(05 §3.11 규칙: 원인과 할 일 한 문장)로 보이고 로그에 남긴다. 화면 문구에는 내부 용어(데몬, seq, diff, health 등)를 쓰지 않고 05 §3.10.8의 화면 표기(서버, 기록 번호 등)를 쓴다. 버튼 문구는 05 §3.10.5 표를 따른다([다시 불러오기], [다시 연결], [닫기] 등).
- React 19 `StrictMode`도 개발에서 effect를 두 번 실행한다 [지식]. `HelmClient`와 경로 선택기는 React 밖 모듈 단일 객체로 만들고, React는 구독만 한다. 두 번 마운트돼도 연결이 둘 생기지 않는다.

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
| `shortcuts.singleKey` | `true` | 한 글자 단축키 켜기·끄기(04 §5.2, 05 §3.8) |
| `shortcuts.overrides` | `{}` | 앱 안 단축키 바꾸기. 값은 `KeyboardEvent.code` 조합(예: `Mod+KeyK`) |
| `notifications.negotiated` | `false` | 협상 전달(`deliveryMode: negotiated`) 질문도 OS 알림으로 띄울지(05 §3.7.3 "협상 전달" 행·IX-Q2, AC-04-01, §3.10.1 규칙 5) |
| `notifications.observer` | `false` | 관찰 제안 알림(04 §5.2) |
| `notifications.resultReview` | `none` | 결과 확인 대기 알림 방식(`none` / `daily_digest` / `immediate`, 데몬 의미 설정이며 값의 정본은 11 §3.5.7). 데스크톱은 배지로만 알리고, 데스크톱 OS 알림은 `immediate`일 때만 띄운다 [결정 60] [판정 J-272] |
| `notifications.dndException` | `none` | 방해 금지 중 휴대폰 푸시의 예외: `none` / `expiringOnly`(05 §3.7.4). 데스크톱 OS 알림에는 적용하지 않는다 [결정 59]. 방해 금지 자체는 의미 설정 `attention.snoozeUntil`이다([판정 J-166]) |
| `transparency` | `system` | `system \| full \| reduced`(21 §3.2.9). `system`이면 OS의 투명도 줄이기를 따른다 |
| `windowEffect` | `system` | `system \| on \| off`(21 §3.14.3). `system`이면 투명도 줄이기가 켜졌을 때 끈다 |
| `macGlass` | `sidebar` | `sidebar \| liquidGlassRegular`. 뒤의 것은 macOS 26 이상에서만 고를 수 있다 |
| `fontScale` | `1.0` | 글자 크기 `1.0 \| 1.125 \| 1.25`. 웹뷰 확대(§3.10.5)로 적용(21 §3.2) |
| `inspector.pinned`, `inspector.width` | `false`, 360 | 검사 패널 고정과 너비(21 §5.2) |
| `notifications.showContent` | `false` | OS 알림에 전달의 `copy` 문구를 보일지. 끄면 `notif.hidden.*`(05 ADR A8, 판정 J-03, §3.10.1) |
| `closeBehavior` | `hide` | 창 닫기 = 숨기기. `quit`이면 앱 종료 |
| `macActivation` | `regular` | `accessory`면 Dock 아이콘 없이 메뉴 막대만(배지 없음) |
| `offlineCopy` | `true` | 뷰 오프라인 사본(§3.9.5) |
| `devView` | `false` | 03 §4의 개발자 보기(ID, seq 표시) |
| `lastRoute` | `/home` | |
| `home.projectFilter` | 없음(모든 프로젝트) | 홈의 프로젝트 거르기(02 A4, 01 "여러 프로젝트 홈"). 거르기 값은 `home` 뷰 params로 넘긴다(19 §3.7.4. 프로젝트 단위 params가 없으면 19에 요구) |

알림 종류별 켜고 끄기, 조용한 시간(`attention.quietHours`), 주의 예산은 의미 설정이다(11·14, [판정 J-166·J-195]). 앱은 같은 값을 다시 두지 않고 `SCR-SETTINGS`에서 데몬 명령으로 바꾼다.

문구: UI 문구는 한국어 하나뿐이라 i18n 라이브러리를 쓰지 않는다. 앱이 보이는 문구(연결 상태, OS 알림, 트레이, 오류)는 모두 `@helm/ui-language`의 05 키로 만든다(판정 J-103). 앱 안에 문구 상수 폴더를 두지 않는다. 05에 없는 문구가 필요하면 05에 키를 요구한다(§5.2). 데몬 투영에 들어 있는 문구(질문 문장 등)는 그대로 그린다.

#### 3.9.12 presence 보고 [제안, 형식은 19 §3.7.8, 쓰임은 11 §3.8.1]

질문 전달 방식(11)과 거시 스케줄러(14)가 "사람이 지금 보고 있는가"를 알 수 있게 앱이 `presence.report` 알림을 보낸다(11 §5.2의 20 요구).

| 값 | 판정(`platform/presence.ts`) |
|---|---|
| `active` | 창이 보이고 포커스가 있고, 마지막 키보드·마우스 입력이 5분 안 |
| `idle` | 창이 보이지만 입력이 5분 넘게 없음 |
| `hidden` | 창이 숨겨짐 또는 최소화(`app://window`) |

- 값은 09의 저장 값 `active`·`idle`·`hidden`·`offline` 중 앞의 셋이다(판정 J-119). `offline`은 데몬이 연결 끊김으로 정한다. `locked` 값은 없다. 부재(`away`)는 데몬이 14 §3.13.8의 파생 함수로 계산하고, 데스크톱의 문턱은 5분이다(휴대폰 2분). 앱은 `away`를 보내지 않는다.

- `screen`은 현재 경로의 화면 ID(03 §3.6), `objectId`는 경로 인자의 레코드 ID다(예: `SCR-QUESTION`, `qs_…`).
- 바뀔 때만 보내고 최소 간격은 2초, 같은 값은 다시 보내지 않는다(19 §3.7.8). 연결이 `ready`일 때만 보내고, 다시 연결되면 현재 값을 한 번 보낸다.
- 입력 내용이나 화면 내용은 보내지 않는다(11 §3.8 "키 입력 내용이나 화면 내용은 받지 않는다").
- 열람 기록(16 §3.24.2): 데몬은 `presence.report`의 `screen`·`objectId` 변화로 `view.opened`를 만든다(19 §3.7.8). 16이 기록하라는 화면은 복귀 요약(`SCR-BRIEF`), 에이전트가 정한 것(`SCR-AUTO`), 결과 확인(`SCR-REVIEW`), 질문 상세(`SCR-QUESTION`), 결과 확인 화면에서 연 근거 체인(`SCR-EVIDENCE`), 감사 깊이 열람이다. 앞의 다섯은 화면 ID로 충분하다. 감사 깊이 열람은 검사 패널의 원본 탭과 `SCR-RECORD`를 열 때 `presence.report.depth`를 `'audit'`로 보낸다(판정 J-84, 화면 ID에 접미어를 붙이지 않는다). `depth`의 값은 `'glance' | 'review' | 'audit'`이다. 그 밖의 화면 이동도 presence로는 보내되 열람 기록으로 남길지는 데몬(16)이 정한다.
- 방해 금지는 presence가 아니라 의미 설정 `attention.snoozeUntil`이다(`settings.update`로 바꾼다, [판정 J-166]). 트레이의 "방해 금지"가 이 명령을 보낸다(§3.10.2, 05 §5.2의 20 요구 "방해 금지 상태 동기화").

### 3.10 OS 통합

#### 3.10.1 알림 [제안]

원칙: 질문을 언제 사람에게 알릴지는 데몬이 전달 방식(즉시·협상·중재·예약)으로 정한다(결정 12, 11). 앱은 데몬의 전달 결정이 기록된 영속 이벤트(19 §3.8.3, 이벤트 이름은 09·11)를 실시간으로 받았을 때만 OS 알림을 띄운다(APP-D11). 진행 이벤트마다 알리지 않는다(canon §12.12 #2, 21 UP-13). 원전 체크리스트의 "할 일과 마감 효과가 있는 것만, 낮은 우선순위는 복귀 요약에 묶음"(canon §17.6, §12.10 `batch_low_urgency_until`, `preferred_review_windows`)은 데몬의 전달 정책이 지키고, 앱은 그 결과만 보인다. 휴대폰 푸시는 2단계 기준으로 26의 Web Push다. 데몬이 `channel: push` 전달을 만들어 휴대폰에 보내고, 데스크톱 앱은 그 전달을 띄우지 않는다([결정 47·48], 26 §3.4). 데스크톱 앱이 꺼져 있으면 데스크톱 OS 알림은 없다. 그때 휴대폰으로 보낼지는 11의 전달 강도와 26의 `pushReachable`이 정한다. 결과 확인 알림 설정(`notifications.resultReview`, [결정 56])은 휴대폰 푸시를 바꾸고(26), 데스크톱에서는 `immediate`일 때만 OS 알림을 띄운다 [결정 60].

앱이 `question.delivered` payload에서 읽는 필드. 정본은 09 §3.4의 스키마이고 아래는 앱이 쓰는 부분이다(판정 J-31·J-52):

```ts
// 09 question.delivered 그대로. deliveryMode만 09·11에 더해 달라고 요구한다(§5.2)
interface DeliveryPayloadForApp {
  deliveryId: string;
  batchKey: string | null;                      // 같은 값이면 알림 하나로 묶는다
  channel: 'app' | 'push' | 'tui' | 'brief';    // 데스크톱은 'app'만 띄운다
  surface: Array<'os' | 'badge' | 'banner'>;    // 'os'가 없으면 OS 알림을 띄우지 않는다
  category: 'question' | 'rights_gate' | 'review' | 'goal' | 'recovery' | 'observer' | 'system';
  urgency: 'interrupt' | 'notice' | 'digest';   // 11 Urgency(판정 J-52)
  deliveryMode?: 'immediate' | 'negotiated' | 'mediated' | 'scheduled';   // 09·11에 요구. 협상 전달 알림 설정에 쓴다
  copy: { titleKey: string; bodyKey: string; args: Record<string, string> };   // 05 문구 키. 질문 본문·비밀은 인자로도 넣지 않는다
  target: string;                               // 딥 링크(03 §3.5.4). 예: helm://question/qs_…
  expiresAt: number | null;                     // ms
  targetDevices: 'all' | string[];              // DeviceId 목록
}
```

처리(`platform/tauri/notifications.ts`, 05 §3.7):

1. **재전송 중 받은 전달은 하나씩 띄우지 않는다.** 이벤트 구독이 `caughtUp` 전이면 개수만 센다. `ready`가 되면 남아 있는 것(이미 답했거나 만료된 것 제외, `inbox` 뷰로 확인)이 하나 이상일 때 묶음 알림 하나 "접속하지 않은 동안 전달된 질문 n개"(05 키)를 띄운다(19 §3.8.3). 실시간으로 받은 전달도 `batchKey`가 같으면 알림 하나로 묶는다.
2. `channel`이 `app`이 아니거나, `surface`에 `os`가 없거나, `targetDevices`가 `'all'`이 아니면서 이 기기의 `deviceId`를 담지 않았거나, `expiresAt`이 지났으면 띄우지 않는다. `category`가 `observer`면 기본으로 띄우지 않는다(설정으로 켬, 04 §5.2). 연결 차단(§3.8.9의 `blocked`)은 OS 알림이 아니라 앱 안 배너로만 보인다. 결과 확인 대기(`category: 'review'`, 11 §3.5.6)는 배지로만 알리고, `notifications.resultReview`가 `immediate`일 때만 `surface`에 `os`가 오므로 앱은 `surface`를 그대로 따른다 [결정 60].
3. 같은 `deliveryId`는 한 번만 띄운다(`meta.recentDeliveryIds`, 최근 500개). 같은 질문의 알림은 전달 1번과 승격 1번까지다(05 §6 알림 행).
4. 방해 금지나 조용한 시간(`attention.quietHours`, [판정 J-195]) 중이면 띄우지 않는다. 방해 금지는 의미 설정 `attention.snoozeUntil`이고([판정 J-166]) 기기마다 따로 두지 않는다(05 §3.7.4). 앱은 `tray` 뷰의 `dnd`(`on`, `until`)로 상태를 알고, 방해 금지가 끝나면 그동안 쌓인 것이 있을 때 묶음 알림 하나(05 `notif.bundle.afterQuiet`)를 띄운다. 방해 금지 중에는 예외 설정과 관계없이 데스크톱 OS 알림을 띄우지 않는다 [결정 59].
5. 강도별 표시(11 §5.2의 20 요구): `interrupt`(즉시 전달: 권리 게이트, 막힘, 만료 임박 승격) → 전달 이벤트를 받은 뒤 5초 안에 OS 알림(01 NFR-P-6), 창이 열려 있으면 앱 안 배너도. `notice` → OS 알림(창이 앞에 있고 대상 화면이 열려 있으면 배너만). 다만 `deliveryMode`가 `negotiated`이면 설정 `notifications.negotiated`(기본 끔, 05 §3.7.3 "협상 전달" 행, AC-04-01)가 켜졌을 때만 OS 알림을 띄우고, 꺼져 있으면 배지만 바뀐다. `digest` → OS 알림 없음(질문함·배지·복귀 요약으로만).
6. 시간당 상한은 데몬이 센다. 의미 설정 `attention.interruptsPerHour`(14 기본값, 모든 기기 합, 사람 기준 하나, 판정 J-171)가 데스크톱 OS 알림과 휴대폰 푸시를 합쳐 세고, 권리 게이트의 즉시 전달과 만료 임박 승격은 세지 않는다(05 §3.7.3). 앱은 자체 상한을 두지 않는다. 상한을 넘은 즉시 질문은 데몬이 협상으로 낮추고(14 §3.13.5 규칙 3), 넘은 알림은 데몬이 한 개로 묶어 보내고 앱은 받은 묶음을 그대로 보인다([판정 J-198]). 그 밖의 받은 전달은 규칙 5대로 띄운다. 데스크톱 알림을 눌러 질문을 열면 presence의 `screen`·`objectId`로 데몬이 열람을 알고, 26의 60초 지연 푸시가 나가지 않는다(26 §3.4.3).
7. 띄울 때는 `sendNotification({ title, body, extra: { target, deliveryId } })`. 설정 `notifications.showContent`가 꺼져 있으면(기본, 05 ADR A8, 판정 J-03) 전달의 `copy` 대신 05의 숨김 키 `notif.hidden.title`("Helm")·`notif.hidden.body`(개수가 있으면 "확인할 일이 {n}건 있습니다.", 없으면 "확인할 일이 있습니다.")로 띄운다. n은 `tray` 뷰의 선택 필요 + 확인하면 좋은 것이다. 내용을 보일지는 기기가 정한다. 데몬은 05 §3.7.2의 인자만 싣고 숨김 처리를 하지 않는다(26의 `notifications.showContent`와 같은 규칙). 앱은 잠금 상태를 감지하지 않는다(05 §3.7.6). `notifications.enabled`가 꺼져 있으면 띄우지 않는다.
8. 창이 포커스를 갖고 있고 `target` 화면이 지금 열려 있으면 OS 알림 대신 앱 안 배너(`RGN-BANNER`)로 보인다. 표시 방법의 선택이고 전달 여부 판단이 아니다.

클릭 처리: `tauri-plugin-notification` 2.6.0부터 데스크톱에서 알림 클릭이 `onAction`으로 온다 [원문: plugins-workspace `plugins/notification/CHANGELOG.md` 2.6.0, 보조 에이전트 확인]. 클릭하면 `extra.target`을 §3.10.6 규칙으로 연다. 묶음 알림은 `SCR-INBOX`를 연다. 2.6.0은 2026-10-10 배포라 쓰인 기록이 적다 [가정: 두 플랫폼에서 동작, §6.2 수동 확인 항목]. 동작하지 않는 환경에서는 대체 규칙을 쓴다: 알림을 띄운 뒤 30초 안에 앱이 활성화되면 가장 최근 알림의 `target`을 배너의 [질문 열기] 단추로 보인다(자동 이동은 하지 않는다). 알림 안의 동작 단추(예: "가정대로 진행")는 두지 않는다. 결정은 질문 내용을 본 화면에서만 한다(04 §3.25의 팔레트 규칙과 같은 이유).

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
- 메뉴 모양은 04 §3.24를 따른다: "Helm · <연결 상태>", 선택 필요 n(→ `/inbox`), 확인하면 좋은 것 n, 진행 중 n과 항목(Concern 표시 번호 · 지금 하는 일, 최대 5개, → 그 Concern의 작업 화면), 방해 금지(`settings.update` 명령, 04 §3.24), Helm 열기, 빠른 입력…(§3.10.4), 종료. 질문 내용은 보이지 않는다.
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
- 등록 실패(다른 앱이 이미 씀)는 플러그인이 오류로 알려 준다. `isRegistered`로는 다른 앱의 등록을 알 수 없다 [원문: plugins-workspace v2 `plugins/global-shortcut/guest-js/index.ts` 109~124행 `isRegistered` 문서 주석, 2026-10-12 확인]. 실패하면 `SCR-SETTINGS`에 "단축키를 등록하지 못했습니다"를 보이고 바꾸게 한다.
- 앱 안 단축키(명령 팔레트 `Mod+K` 등)는 05 §3.8이 정하고 웹뷰 안에서 처리한다. 판정은 `KeyboardEvent.code`로 한다(한글 입력 상태에서도 같은 키, 05 IX-09). `isComposing`이 참이거나 `keyCode`가 229인 이벤트는 무시하고, 텍스트 입력에 초점이 있으면 한 글자 단축키를 쓰지 않는다(05 §3.8 규칙 3·4). 도움말에 보이는 글자는 `code`를 현재 자판 배열의 글자로 바꿔 보인다. WebView2는 `navigator.keyboard.getLayoutMap()`으로 바꾸고, 이 API가 없는 WKWebView는 US 배열 이름으로 보인다 [지식](05 A7의 20 요구).
- 전역 단축키 문자열도 물리 키 이름(`CommandOrControl+Shift+KeyH` 꼴)으로 저장한다 [지식: global-hotkey의 코드 이름].
- 부품에 넘기는 키 지도: 앱은 05의 기본 단축키에 `shortcuts.overrides`를 덮어 만든 `keymap`(동작 이름 → `code` 조합)을 `@helm/ui`의 키 지도 공급자로 넘긴다(21 §3.12, 21 §5.2의 20 요구 (4)). 부품은 판정만 하고 설정을 읽지 않는다.

#### 3.10.5 창, 로그인 시 시작, 단일 인스턴스 [제안]

- 창 닫기: 기본은 숨기기(`closeBehavior = 'hide'`). Rust가 `WindowEvent::CloseRequested`에서 `api.prevent_close()`하고 숨긴다. 연결과 알림은 계속된다. Windows에서 처음 숨길 때 한 번만 "Helm은 트레이에서 계속 실행됩니다" 알림을 띄운다. macOS에서 Dock 아이콘을 누르면(`RunEvent::Reopen`) 창을 보인다. 종료는 트레이 "종료", macOS `Cmd+Q`.
- 종료 순서: 진행 중 명령함 기록 flush(§3.9.6-4) → 전송 닫기 → ssh 자식 종료 → 창 상태 저장 → 끝.
- 로그인 시 시작: `tauri-plugin-autostart`, macOS는 `MacosLauncher::LaunchAgent`(`~/Library/LaunchAgents`에 plist), Windows는 `Run` 레지스트리 [원문: 플러그인 소스]. 인자 `--background`로 시작하면 창을 띄우지 않고 트레이만 둔다. 기본은 꺼짐이고 `SCR-ONBOARD` 끝에서 켤지 묻는다. macOS 13 이후에는 등록 때 "백그라운드 항목 추가됨" 알림이 OS에서 뜬다 [지식].
- 단일 인스턴스: `tauri-plugin-single-instance`(feature `deep-link`)를 첫 번째 플러그인으로 등록한다. 두 번째 실행은 기존 창을 보이고 인자(딥 링크)를 넘기고 끝난다. macOS는 LaunchServices가 이미 하나만 띄우지만, 실행 파일을 직접 실행하는 경우를 막는다 [지식].
- 창 상태: `tauri-plugin-window-state`로 크기·위치·최대화를 기억한다. 보임 여부는 기억하지 않는다(`--background` 규칙과 충돌하지 않게).
- 창 테마: 설정 `theme`가 바뀌면 `setTheme`로 제목 표시줄을 맞춘다(21 §3.2.9).
- 글자 크기: 설정 `fontScale`을 웹뷰 확대 `getCurrentWebview().setZoom(scale)`로 적용한다(21 §5.2의 20 요구: Caustic 토큰이 px라 rem 배율이 듣지 않는다). 권한 `core:webview:allow-set-webview-zoom`을 capability에 더하고, 사용자가 `Ctrl/Cmd +`로 따로 확대하는 기본 단축키는 `zoomHotkeysEnabled: false`로 끈다(배율은 설정 한 곳에서만) [지식: Tauri v2 웹뷰 확대 API, 구현 때 확인].

#### 3.10.6 딥 링크 [제안, 형식은 03 §3.5.4]

- 스킴 `helm`을 `tauri.conf.json`의 `plugins.deep-link.desktop.schemes: ["helm"]`로 등록한다. macOS는 번들의 `Info.plist`에 들어가고 실행 중 등록은 안 되며, `/Applications`에 설치한 앱에서만 시험할 수 있다. Windows는 설치 때 등록되고, 개발 빌드에서는 `register_all()`을 부른다 [검색: v2.tauri.app/plugin/deep-linking].
- 받기: 시작할 때 `getCurrent()`, 실행 중에는 `onOpenUrl(urls)`. Windows의 두 번째 실행 인자는 단일 인스턴스 플러그인이 넘긴다.
- 해석(`navigation/deeplink.ts`). 인자 형식 검사를 통과하지 못하면 무시하고 로그만 남긴다. 다른 앱이 임의 URL로 앱을 열 수 있기 때문이다.

| 링크 | 처리 |
|---|---|
| `helm://question/<qsId>` | `/inbox/<qsId>`로 열고, `question` 뷰의 질문 종류가 작업 합의·결과 확인·Goal 확인·판단 확인(`finding_confirm`)·복구 선택이면 그 화면(`SCR-AGREE`·`SCR-REVIEW`·`SCR-GOAL`·`SCR-EVIDENCE`·`SCR-RECOVERY`)으로 바꿔 연다(`replace` 이동, 뒤로 가기에 남기지 않음. 03 §3.5.4, 04 §5.2). 경로 인자(`cnId`, `wuId`, `glId`, 판단 확인이면 `recordId`)는 뷰 데이터의 대상 참조에서 읽는다 |
| `helm://concern/<cnId>[/<tab>]` | `tab ∈ {overview, inquiry, work, history, thread}`, 없으면 `overview` |
| `helm://agreement/<agId>`, `helm://review/<rsId>` | 경로에 `cnId`, `wuId`가 필요하다. 데몬의 참조 해석 메서드(19, 03 §5.2 "딥 링크 대상 ID를 그대로 쓸 수 있는 조회")로 경로 인자를 받은 뒤 이동한다 |
| `helm://evidence/<recordId>` | `/evidence/<recordId>` |
| `helm://goal/<glId>` | `/goals/<glId>` |
| `helm://stimuli/<iqId>/<roundNo>` | `iqId`는 데몬의 참조 해석 메서드(19, 03 §5.2)로 `cnId`를 얻은 뒤 `/concerns/<cnId>/inquiry/want/<iqId>/rounds/<roundNo>`(`SCR-STIM`)로 이동한다 |
| `helm://brief`, `helm://recovery`, `helm://observer/<proposalId>` | 해당 경로 |
| `helm://pair?v=1&url=…&code=…&sid=…` | `/connect?pair=…`. 페어링을 자동으로 실행하지 않는다. 서버 주소와 `serverId`를 보이고 사용자가 [이 서버와 페어링]을 눌러야 `pairing_with_code`를 부른다(링크는 연결 의도만 담는다. OpenClaw `openclaw://gateway/add`와 같은 원칙, `docs/platforms/mac/remote.md:107-111`). 코드는 로그에서 가린다 |

- 페어링 링크(`helm://pair`)의 적용 규칙: `sid`가 있고 어떤 프로필의 `serverId`와 같으면 그 프로필에 경로를 더할지 묻는다(기존 경로의 주소는 링크로 바꾸지 않는다). `sid`가 없거나 어느 프로필과도 맞지 않으면 새 프로필로 만든다. 활성 프로필에 링크의 주소를 덮어쓰지 않는다. 어느 경우든 경로 추가는 Rust 네이티브 확인 창을 거친다(§3.6.3).
- 그 밖의 링크에 `sid=<serverId>`가 있고 활성 프로필과 다르면 프로필을 바꿀지 묻는다.
- 연결이 없을 때 데몬 조회가 필요한 링크는 "연결되면 엽니다"를 보이고 대기 링크 하나를 기억했다가 `ready`가 되면 연다.
- 대상이 이미 처리됐거나 없으면 그 화면이 상태를 보인다(03 §3.5.4, 04 §3.0.5).

#### 3.10.7 기기 토큰 키체인 [제안]

| 항목 | 값 |
|---|---|
| 크레이트 | `keyring-core` 1.0.0 + macOS `apple-native-keyring-store` 1.0.2(feature `keychain`, 기존 로그인 키체인) + Windows `windows-native-keyring-store` 1.1.0 [검색] |
| 항목 이름 | service = 번들 식별자 `dev.helm.desktop`, account = `device-token/<serverId>/<deviceId>`. 다른 데몬의 토큰과 섞이지 않게 `serverId`를 넣는다(18 §5.2의 20 요구). 페어링 응답에서 두 값을 받은 직후 쓴다. 프로필 → 항목 대응은 프로필의 `serverId`·`deviceId`로 찾는다 |
| 값 | 토큰 문자열 그대로. Windows 자격 증명 크기 한도 2,560바이트 [검색: Microsoft `CREDENTIALW` 문서] 안에 든다 |
| Windows 보존 범위 | 로밍(Enterprise)이 기본값이라고 한다 [검색: windows-native-keyring-store 문서]. 이 기기 전용(Local Machine)으로 바꾼다. 이 API가 크레이트에 없으면 기본값을 쓰고 §7 Q-07에 남긴다 |
| macOS 키체인 확인 창 | 레거시 키체인의 항목 접근 권한은 앱의 코드 서명 정체에 묶인다. ad-hoc 서명 앱은 빌드할 때마다 정체가 바뀌어 다시 빌드한 뒤 처음 읽을 때 "키체인 접근 허용" 창이 뜬다 [검색: keyring-rs 이슈 #272 유지 관리자 답변] |
| 대응 | Mac에서 한 번 만든 자체 서명 코드 서명 인증서(키체인 접근 > 인증서 지원 > 인증서 생성, 종류 "코드 서명")로 매번 서명한다(`bundle.macOS.signingIdentity = "Helm Local Code Signing"`). 같은 인증서로 서명하면 지정 요구 사항(designated requirement)이 같아 다시 묻지 않을 것으로 본다 [가정, 시험 항목 §6]. 이것은 개인 Mac에서의 로컬 서명이라 Apple 공증·서명 배포(결정 24)와 다르다. 인증서를 만들지 않으면 `"-"`(ad-hoc)로 빌드하고 갱신마다 한 번 "항상 허용"을 누른다. 유효 기간: 인증서 지원의 기본값은 1년이다 [지식]. 만들 때 "기본값 덮어쓰기"를 골라 유효 기간을 3650일로 둔다. 인증서가 바뀌면 지정 요구 사항이 달라져 확인 창이 다시 뜨기 때문이다. `app-build-local`은 `security find-certificate -c "$HELM_APP_SIGNING_IDENTITY" -p | openssl x509 -enddate -noout`으로 만료일을 읽어 90일 안이면 경고를 출력한다. 만료되면 같은 이름으로 새로 만들고 첫 실행에서 한 번 "항상 허용"을 누른다(INSTALL.md) |
| Data Protection 키체인 | 쓰지 않는다. 팀 ID와 프로비저닝이 필요해 서명 없는 앱에서 쓰기 어렵다 [검색: apple-native-keyring-store 문서] |
| Stronghold | 쓰지 않는다. 2026-07 중단 공지, Tauri v3에서 빠진다 [검색: plugins-workspace 이슈 #3494] |
| 실패 | 잠김·서비스 없음 → `keychain_unavailable`, 사용자 거부 → `keychain_denied`. 연결 상태는 코어 `needsUser` + 앱 사유 `keychain_denied`이고 [다시 연결]을 누르면 키체인을 다시 연다. 키체인 대신 파일에 토큰을 두는 대체 경로는 만들지 않는다 |

#### 3.10.8 창 효과와 투명도 [제안, 시각 규칙은 21 §3.2.9·§3.14.3]

21의 유리 재질(결정 41)을 위해 앱이 창 쪽 일을 맡는다(21 §5.2의 20 요구).

- 창 설정: `main` 창은 `transparent: true`다. 창 효과는 정적 설정 대신 Rust가 시작할 때와 설정이 바뀔 때 `Window::set_effects`로 적용한다 [지식: Tauri v2 `EffectsBuilder`, 구현 때 확인]. 이유는 효과가 설정과 OS 상태에 따라 바뀌기 때문이다.

| 플랫폼 | `windowEffect`가 켜짐일 때 | 꺼짐일 때 |
|---|---|---|
| macOS 14~15 | `sidebar`, `state: followsWindowActiveState` | 효과 없음, 웹뷰가 `bg-app`을 칠함 |
| macOS 26 이상 | `macGlass`에 따라 `sidebar` 또는 `liquidGlassRegular` | 같음 |
| Windows 11 | `mica`(테마를 따름). `acrylic`·`blur`는 쓰지 않는다(Tauri 문서의 끌기·크기 조절 성능 문제, 21 §3.14.3) | 같음 |
| Windows 10 | 늘 효과 없음(Mica는 Windows 11 전용) | - |

- 투명도 줄이기: WKWebView는 `prefers-reduced-transparency` 미디어 쿼리를 지원하지 않는다(21 §2.5.7). 그래서 macOS에서는 Rust가 OS 설정(`NSWorkspace`의 `accessibilityDisplayShouldReduceTransparency`)을 읽고, 접근성 표시 설정 변경 알림을 받아 `app://appearance`로 넘긴다 [지식, 구현 때 objc2 바인딩으로 확인]. Windows는 WebView2가 미디어 쿼리를 지원하므로 웹뷰가 직접 판정한다.
- 웹뷰 쪽(`platform/tauri/appearance.ts`): 시작할 때 `appearance_get()`을 부르고 `app://appearance`를 구독해 `<html>`에 두 속성을 둔다.
  - `data-transparency`: 설정 `transparency`가 `full`·`reduced`면 그 값. `system`이면 macOS는 Rust 값, Windows는 미디어 쿼리 결과.
  - `data-window-effect`: 실제로 효과를 적용했으면 `on`, 아니면 `off`. 21의 CSS는 `off`일 때만 `bg-app`을 칠한다.
- `windowEffect = system`이면 투명도 줄이기가 켜졌을 때 효과를 끈다(21 U-23).
- Tauri 2.12.1부터 `macOSPrivateApi` 설정은 아무 일도 하지 않는다(21 §3.14.3의 [검색] 근거). 따로 켜지 않는다.
- 시험: §6.2 수동 확인에 "macOS 투명도 줄이기를 켜고 끄면 앱이 다시 시작하지 않고 바뀐다", "Windows 10에서 효과 없이 불투명"을 더한다.

### 3.11 데스크톱 UI를 앱에 묶을지, 데몬이 서빙할지 [제안, ADR 후보 ADR-20-04]

| 기준 | A. 앱에 묶음 (채택) | B. 데몬이 서빙(앱은 원격 URL을 여는 껍데기) |
|---|---|---|
| 오프라인 시작 | 된다. 캐시된 투영을 읽기 전용으로 보인다 | 안 된다. 데몬에 연결되지 않으면 빈 창 |
| 앱–데몬 버전 일치 | hello의 프로토콜 범위로 확인해야 한다. 어긋나면 갱신 안내 | 항상 맞다 |
| 보안 | 웹뷰에 원격 콘텐츠가 없다. IPC 권한을 로컬 origin에만 준다 | 원격 origin에 IPC 권한(`remote.urls`)을 줘야 한다. 원격 페이지의 로컬 IPC 호출 취약점(CVE-2026-42184) 같은 종류의 위험을 직접 진다 |
| SSH 경로 | 그대로 | 웹뷰가 원격 URL을 열려면 로컬 포트 터널이 필요하다(§3.8.2 B의 문제) |
| 결정 19 | 맞다 | 사실상 웹 클라이언트를 셸로 감싼 것이 된다 |
| 배포 | 앱을 갱신해야 UI가 바뀐다 | 데몬 갱신만으로 UI가 바뀐다 |

A를 고른다. 버전 문제는 §3.12.7의 호환 범위와 갱신 안내로 다룬다. 이 판단은 데스크톱 앱에 대한 것이다. 휴대폰은 [결정 47]로 데몬이 서빙하는 PWA(`/m/`)이고, 그 묶음은 26이 정한다. 원전의 "Web GUI로 검증한 뒤 셸을 붙인다"(canon-3 §6.10.2)와 백엔드 조사의 "데몬이 같은 SPA를 웹으로도 서빙"(backend-oss-research §4)은 결정 19에 따라 따르지 않는다(canon-3 §7.1 C6). 다만 같은 SPA를 브라우저에서 띄우는 대체 실행은 테스트에만 쓴다(§3.13.3).

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
| `app-setup` | 서버 | `rustup target add x86_64-pc-windows-msvc`, `cargo install --locked cargo-xwin --version <고정 판>`(판은 `.mise.toml` 또는 레시피 변수 한 곳), `cargo install --locked cargo-audit cargo-deny`, 필요한 apt 패키지(`nsis lld llvm`)가 없으면 설치 명령을 출력(설치는 사람이 sudo로) | apt 패키지·rustup 없음 |
| `app-check` | 서버 | `cargo fmt --check`, `cargo clippy --locked -p helm-desktop-core`, `cargo test --locked -p helm-desktop-core`, `cargo deny check`(라이선스·출처·중복), `cargo audit`(RustSec 공지), capability·CSP 정적 검사(§6). TS 검사·Vitest는 저장소 `lint`·`test`가 한다 | cargo 없음 |
| `app-test-ssh` | 서버 | WSL 자신의 sshd(127.0.0.1:22)로 SSH 경로 통합 시험(가짜 데몬 포트로 `-W`) | sshd 없음, 시험 키 없음 |
| `app-e2e` | 서버 | 가짜 데몬 + Vite 미리보기 + Playwright(Chromium, WebKit), IT-01~20 | 브라우저 미설치 |
| `app-dev` | 서버 | Vite 개발 서버 + 브라우저 대체 실행으로 개발 데몬에 붙음(06 정의, 개발 전용). 브라우저는 헤더를 붙일 수 없으므로 Vite 개발 서버의 WebSocket 프록시(`/rpc` → `ws://127.0.0.1:<HELM_LISTEN_SSH_PORT>/rpc`)가 `.env`의 `HELM_DEV_DEVICE_TOKEN`으로 `Authorization` 헤더를 붙인다. 대상 포트는 `.env`의 `HELM_LISTEN_SSH_PORT`(개발 데몬 7851, 17 §3.15)에서 읽고, 값이 정식 데몬 포트 7841이면 시작하지 않는다. Vite 서버는 `127.0.0.1`에만 바인딩하고, 업그레이드 요청의 `Origin`이 Vite 개발 서버 주소(`http://127.0.0.1:1420`)와 정확히 같을 때만 토큰을 붙인다. 서버 PC 브라우저의 다른 페이지가 인증된 연결을 열지 못하게 하기 위해서다. 토큰은 Node 프로세스에만 있고 브라우저 번들에 들어가지 않는다(`envPrefix` 규칙, §3.6.2). 앱이 비밀 환경 변수를 읽는 예외는 이 레시피 하나다(06 §3.17) | `.env` 없음(`just dotenv`), 포트가 7841 |
| `app-dev-mac` | 서버 → Mac | `run-on mac 'cd ~/projects/helm/code/helm && just app-dev-local'` → Mac에서 `pnpm tauri dev` | Mac에 연결 못 함 |
| `app-build-mac` | 서버 → Mac | `run-on mac`으로 `app-build-local` 실행(06 정의) | Mac에 연결 못 함 |
| `app-build-local` | Mac | `pnpm tauri build --target universal-apple-darwin --bundles app -- --locked`, 끝나면 산출물 폴더에 `SHA256SUMS`(`shasum -a 256`)를 쓴다 | Xcode 명령줄 도구 없음 |
| `app-install-mac` | 서버 → Mac | 빌드 결과를 `/Applications/Helm.app`에 바꿔 넣고, 실행 중이면 끝낸 뒤 다시 띄움 | 같음 |
| `app-verify-mac` | 서버 → Mac | `cargo clippy`(Tauri 크레이트 포함), WebdriverIO 셸 스모크(§3.13.4) | 같음 |
| `app-build-win` | 서버 | `pnpm tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis -- --locked`, 산출물을 아티팩트 폴더로 옮기고 `SHA256SUMS`(`sha256sum`)를 쓴다(§3.12.4) | NSIS·lld·llvm·cargo-xwin 없음 |
| `app-build-win-ci` | 서버 | `gh workflow run desktop-windows.yml` 후 `gh run download`. 브랜치 push가 필요하므로 사람 확인 뒤에만 | `gh` 인증 없음 |
| `shot` | 서버 | 가짜 데몬 고정 데이터로 화면별 스크린샷과 기준 비교(§3.13.5, 06 정의) | 브라우저 미설치 |

- 공급망 규칙 [제안, 18 §3.15에 같은 행을 요구]: (1) `Cargo.lock`을 저장소에 넣고 모든 cargo 명령에 `--locked`를 붙인다. §3.7.2의 "최신"은 처음 고를 때의 뜻이고, 고른 판은 `Cargo.lock`이 고정한다. (2) `cargo deny`의 `sources`는 crates.io만 허용하고, `cargo audit` 경고는 `app-check`를 실패시킨다. (3) npm 쪽은 06의 `pnpm-lock.yaml`·`--frozen-lockfile` 규칙을 따른다. (4) GitHub Actions의 서드파티 액션(`tauri-apps/tauri-action`, `actions/checkout` 등)은 움직이는 태그(`@v1`) 대신 커밋 SHA로 고정하고, 판 이름은 주석으로 적는다. (5) `cargo-xwin`, NSIS, `llvm` 같은 빌드 도구의 판을 레시피 출력과 `SHA256SUMS` 옆의 `BUILDINFO`에 남긴다.
- 설치 파일 확인: `INSTALL.md`에 받은 파일의 해시를 `SHA256SUMS`와 대조하는 절차를 적는다(macOS `shasum -a 256 -c`, Windows `Get-FileHash`). CI 산출물(B 경로)도 같은 파일을 만든다.
- `just verify`에는 `app-check`만 넣는다. Mac이 필요한 레시피와 Windows 교차 빌드는 넣지 않는다(06 §3.16의 원칙). 앱을 바꾼 작업의 완료 기준에는 `app-e2e`와 화면이면 `shot`을 더한다(사용자 규칙).

#### 3.12.3 macOS 빌드 [제안]

- Mac에서만 빌드한다(브리프 §2.5). 서버는 `run-on mac`으로 지시한다. 저장소는 Syncthing으로 Mac에 같은 경로로 있다. `node_modules`는 Syncthing이 동기화하지 않으므로 Mac에서 `just setup`(06 `node.just`)을 따로 한다. `app-build-local`은 `node_modules`가 없으면 종료 코드 2로 알린다.
- `bundle.macOS.minimumSystemVersion`은 `"14.0"`(Sonoma)이다. 웹뷰 기준은 21 §2.5.7의 Safari 18 이상이다(접두사 없는 `backdrop-filter`). macOS 14는 Safari 18로 갱신할 수 있으나 출고 판은 17이라 [지식] 시작할 때 21의 기능 검사가 띠로 알린다. 실제 Mac 버전 확인은 21 U-14의 사용자 확인 항목이다. Tauri 기본값은 10.13이다 [원문: tauri-utils `config.rs`, 보조 에이전트 확인].
- universal 바이너리(`--target universal-apple-darwin`)로 만든다 [검색: Tauri 배포 문서 예시]. Mac이 한 대라 아키텍처 하나로 충분하지만, 같은 산출물을 다른 Mac에 옮길 때를 위해 universal을 기본으로 둔다(빌드 시간이 문제면 `aarch64`만).
- 서명: Tauri는 `signingIdentity`가 없으면 번들 서명을 아예 건너뛴다. 그러면 다른 경로로 받은 앱은 "손상됨" 오류가 난다 [원문: `tauri-bundler/src/bundle/macos/app.rs`, 보조 에이전트 확인]. 그래서 항상 서명한다: 자체 서명 인증서(§3.10.7) 또는 ad-hoc(`"-"`).
- 같은 Mac에서 빌드해 `/Applications`에 복사한 앱에는 격리 속성(quarantine)이 붙지 않아 Gatekeeper 확인 없이 열린다 [지식].
- 딥 링크·알림은 `/Applications`에 설치한 앱으로 시험한다(§3.10.1, §3.10.6).

#### 3.12.4 Windows 빌드 경로 비교와 선택 [제안, ADR 후보 ADR-20-06]

| 기준 | A. WSL에서 교차 빌드(cargo-xwin, NSIS) — 기본 | B. GitHub Actions `windows-latest` + `tauri-apps/tauri-action`(커밋 SHA 고정) — 대체 | C. Windows 호스트에서 수동 빌드 | D. Windows VM·Sandbox |
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

- 첫 실행 안내(02 §5.2의 20 요구): 위 표의 절차를 `apps/desktop/INSTALL.md`에 두고, `app-build-win`·`app-install-mac`이 끝날 때 해당 플랫폼 절차의 요약을 터미널에 출력한다. 앱 안에서는 안내할 수 없다(앱이 열리기 전의 단계이기 때문이다).

#### 3.12.6 업데이트 방식 [제안, ADR 후보 ADR-20-07]

- 1차: 자동 업데이트 없음(APP-D14). macOS는 `just app-install-mac`(다시 빌드해 바꿔 넣기), Windows는 새 NSIS 설치 파일을 실행한다(같은 앱을 제자리에서 갱신).
- 앱은 hello에서 프로토콜 호환을 확인하고(§3.12.7), 맞지 않으면 코어 `needsUser` + 앱 사유 `incompatible_version`과 갱신 방법을 보인다. 캐시된 화면은 계속 읽을 수 있다.
- 2차 후보: `tauri-plugin-updater` 2.13.3 + 데몬이 tailnet으로 서빙하는 정적 매니페스트(`latest.json`). 업데이트 서명 키(Tauri 자체 서명, OS 코드 서명과 별개, 끌 수 없음)가 필요하다 [검색: v2.tauri.app/plugin/updater]. 키는 SOPS 제품 비밀(`~/projects/helm/secrets/`)에 둔다. 업데이터가 받은 파일에는 격리 속성·MOTW를 붙이는 코드가 없다 [원문: updater 소스, 보조 에이전트 확인]. 단 SSH 경로만 쓰는 상황에서는 매니페스트에 접근할 수 없다. 사용 빈도가 늘면 다시 본다(§7 Q-09).

#### 3.12.7 버전 표기와 호환 [제안]

- 앱 버전: `apps/desktop/package.json`의 semver(`0.y.z`). `tauri.conf.json`의 `version`은 `"../package.json"`을 가리켜 한곳에서 관리한다 [지식: Tauri 설정은 package.json 경로를 받는다]. 빌드 ID는 `<git 짧은 해시>-<UTC 날짜>`를 빌드 환경 변수로 넣는다. `SCR-SETTINGS`의 정보와 진단 묶음에 보인다.
- 프로토콜: `@helm/protocol`이 `PROTOCOL_VERSION`(정수)을 내보낸다. 앱은 `{min: PROTOCOL_VERSION - 1, max: PROTOCOL_VERSION}`을 hello에 보낸다(`PROTOCOL_VERSION`이 1이면 `min`도 1). 데몬은 겹치는 가장 큰 값을 고르거나 `1003 protocol.unsupported`(`serverMin`, `serverMax`)로 거부한다(19 §3.4.3, P-14). 앱은 `serverMax < 앱 min`이면 "데몬이 오래됨", `serverMin > 앱 max`이면 "앱이 오래됨"으로 판정한다. 추가 변경은 버전을 올리지 않고 `features`로 알리므로(19 P-14), 앱은 화면 동작을 켜기 전에 `features.methods`·`views`에 있는지 확인하고 없으면 그 동작을 숨긴다. 앱과 데몬을 같은 커밋에서 만들면 항상 맞는다. 한쪽만 갱신한 경우를 위해 한 판 차이까지 허용한다.
- 스키마: hello의 `features.schemaHash`(19 §3.4.4)가 캐시 행의 값과 다르면 그 행을 버리고 다시 받는다(§3.9.5).
- 불일치 문구: 05 `err.protocol.version`("앱(v{app})과 서버(v{server})의 버전이 맞지 않습니다. {which}을 업데이트하세요.")을 쓴다. `{which}`는 앱이 오래됐으면 "앱", 서버가 오래됐으면 "서버의 Helm"이다. 화면 문구에 "데몬"을 쓰지 않는다. 업데이트 명령 안내는 17의 레시피 이름을 쓴다. 05의 `notice.app.updateRequired`가 "갱신"을 쓰는 것은 05에 "업데이트"로 맞춰 달라고 요구한다(§5.2).

#### 3.12.8 서드파티 고지 [제안, 규칙은 07 §3.17]

- 저장소 루트 `THIRD_PARTY_NOTICES.md`(07 §3.17.2, `just licenses`가 npm 의존과 Rust 크레이트에서 생성)를 앱 빌드 때 Vite의 `?raw` 가져오기로 묶고, `SCR-SETTINGS`의 "정보" 절에서 그대로 보인다(07 §5.2의 20 요구). 문서를 원격에서 읽지 않는다.
- 앱 번들에는 Rust 크레이트도 들어간다. npm 목록만으로는 빠지므로 `just licenses`가 `cargo about generate`(또는 같은 일을 하는 도구) 결과를 루트 `THIRD_PARTY_NOTICES.md`의 Rust 항목으로 함께 넣는다([판정 J-218], 07 §3.17.2). 고지 파일이 하나이므로 "정보" 절은 그 파일만 보인다. 생성 결과가 커밋된 파일과 다르면 `just verify`가 실패한다(07 §3.17.2). 도구 선택과 생성 형식은 07과 맞춘다(§5.2).
- 앱에 넣는 글꼴(21 UI-D12)의 라이선스 원문도 같은 절에 둔다.

### 3.13 테스트

#### 3.13.1 단위 [제안]

| 대상 | 도구 | 검사 |
|---|---|---|
| 사용자용 상태(`@helm/client-react` `connection/`), 경로 선택기 `routes.ts` | Vitest(node) | §3.8.9 표의 모든 행(우선순위 포함)이 시험 한 줄씩. 경로 넘어가기 규칙(§3.8.8 표)과 30분 미루기. 차단 사유가 `blocked`로 바뀜. 상태 기계·백오프 자체는 19 코어의 시험. 표에 없는 경우는 상태를 바꾸지 않고 효과가 없다 |
| 재시도 간격 | Vitest + 가짜 타이머 | 0.5→30초 상한, 흔들림 ±20% 범위, 인증 오류에서 재시도 없음 |
| 저장소·동기화 연결 `sync/stores.ts`, `sync/session.ts` | Vitest + `fake-indexeddb` + 19 코어의 시험용 가짜 | 위치 저장과 낡음 표시가 한 트랜잭션(중간에 트랜잭션을 중단시키면 둘 다 그대로), `outOfRange` 네 사유별 처리(§3.9.6-5), 재전송 중 낡음은 다시 받기를 미루고 `caughtUp` 뒤 한 번에, 늦은 응답이 새 값을 덮지 않음, `schemaHash`가 다르면 캐시 행을 버림, 재전송 중 전달 이벤트로 OS 알림을 띄우지 않음 |
| 휘발 스트림 반영 `sync/liveText.ts` | Vitest | 영속 이벤트가 오면 지움, `finalSeq` 전에는 지우지 않음, 재접속 때 비우고 `active`로 채움(`n`·`offset` 검사는 19 코어의 시험) |
| 진행 중 명령함 `sync/commands.ts`, `IdbClientStateStorage` | Vitest + `fake-indexeddb` + 19 코어 | 끊김 뒤 같은 멱등 키로 재전송, 정책 나이를 넘으면 `expired` 표시, 결과가 정해진 응답(3001~3009, 5003)은 `removePending`, 5003은 초안으로 돌아옴, retryable false 오류는 `permanentError`, `storeId`·`deviceId`·`protocol`·`schemaHash`가 다른 행은 `listPending`에 나오지 않음, `decisionsAllowed`가 거짓이면 `send`가 막힘 |
| 딥 링크 `navigation/deeplink.ts` | Vitest | §3.10.6 표의 모든 형식, 잘못된 ID·알 수 없는 호스트 무시, `pair` 링크는 자동 실행하지 않음 |
| 프로필 검증 | Vitest + Rust | TS와 Rust가 같은 표본 파일(`fixtures/profile-validation.json`)로 같은 결과 |
| SSH 인자·실패 분류 | `cargo test`(core) | 인자 순서 고정(스냅샷), 주입 시도(`-oProxyCommand=…`, 공백) 거부, 실제 stderr 표본(macOS·Windows·Ubuntu)의 분류. SSH 발급의 원격 인자 인용: 셸 메타 문자(`;`, `$(…)`, 역따옴표, `&&`, `|`, `'`, 줄바꿈)를 담은 기기 이름이 명령줄에 나타나지 않고 표준 입력 JSON으로만 간다. `helmCliPath` 정규식이 메타 문자를 거부한다 |
| WebSocket-over-stream | `cargo test`(core) | `tokio::io::duplex` 위 tungstenite 서버와 업그레이드(`Sec-WebSocket-Protocol: helm-jsonrpc`, `Authorization`, SSH 경로의 `Host`), 서버 ping에 pong, 바이너리 메시지 → 1003, 4 MiB 송신 대기 초과 |
| blob 캐시 | `cargo test`(core) | 해시가 맞지 않으면 캐시에 쓰지 않음, 상한 넘으면 오래된 것부터 지움 |

#### 3.13.2 컴포넌트 [제안]

- `@testing-library/react` 16 + jsdom 30으로 훅(`useView`, `useCommand`)과 화면 조립(`screens/*/useScreenModel.ts`)을 시험한다. 데이터는 `test/fixtures/views/*.json`이다. 데몬의 뷰가 생기기 전에는 손으로 만든 고정 데이터이고, 뷰가 생긴 뒤에는 `just test-fixtures-views`(22의 `protocol` 모드 대본)가 만든 표본으로 바꾼다(22 §3.15.3·§5.2).
- Tauri API는 `@tauri-apps/api/mocks`의 `mockIPC`, `mockWindows`, `clearMocks`로 대신한다 [검색: v2.tauri.app/develop/tests/mocking].
- 컴포넌트 자체의 시각 시험(Storybook, 스크린샷)은 21 UI-D14가 정한다.

#### 3.13.3 가짜 데몬과 통합 시험 [제안]

- 19의 가짜 서버(같은 프로토콜을 말하는 시험용 데몬, 19 §6.3의 적합성 도구)를 쓴다. 쓰는 조작은 19 §6.3 목록에 있다: 이벤트 주입, 위치 건너뛰기, `storeId`·`bootEpoch` 바꾸기, `view.get` 지연과 `2006`, 연결 끊기, tick 멈추기, HTTP 401·403, `hello` 오류 1003·1004·1005·1008, `5001`·`5003` 응답, 명령에 `3004`·`3008`·`3009` 거부, 같은 멱등 키에 처음 결과 돌려주기, close 1001·4008·4009 보내기, `server.modeChanged` 보내기.
- 브라우저 대체 실행: `platform/browser/transport.ts`는 브라우저 `WebSocket`으로 가짜 데몬에 바로 붙는다. 토큰은 시험용 `helm-bearer.` 하위 프로토콜로 넘긴다(19 §6.3, 판정 J-82: 시험 전송 전용). 이 구현은 `import.meta.env.MODE !== 'production'`일 때만 묶인다.
- 시나리오(각각 Playwright 시험 하나):

| ID | 시나리오 | 확인 |
|---|---|---|
| IT-01 | 처음 연결(위치 없음) | `from: "head"` 구독, 고정 뷰 받기, 홈 표시 |
| IT-02 | 연결 중 끊고 이벤트 5개 뒤 재연결 | 위치부터 재전송, 무효화된 열린 뷰만 `caughtUp` 뒤 다시 받음 |
| IT-03 | 데몬 재시작(같은 `storeId`, `bootEpoch`만 바뀜) | 위치 재개로 빠짐없이 받음(사례 8곳에 없던 경로), "서버가 다시 시작되었습니다" 띠 한 번 |
| IT-04 | 데몬 저장소 교체(`storeId` 바뀜) | `2001 storeMismatch` → 캐시 버림, `head` 구독, 열린 뷰 다시 받음 |
| IT-05 | 보존 범위 밖(`beforeOldest`) | 캐시는 낡음으로 남고 다시 받음, 이력 화면에 "생략됨" 표시 |
| IT-06 | 결정 응답 전에 끊김 | 재연결 뒤 같은 멱등 키 재전송, 데몬 처리 1회, `duplicate: true` 결과가 화면에 전달 |
| IT-07 | 낡은 카드에서 결정 | `3004` → "바뀐 내용 보기", 쓰던 답 유지 |
| IT-08 | 오프라인 시작 | IndexedDB 고정 뷰로 홈·질문함 읽기, 결정 버튼 막힘, 신선도 `stale`, 초안 저장 |
| IT-09 | 업그레이드 401, `hello` 1005 | 코어 `needsUser` + 앱 사유 `needs_pairing`, 자동 재시도 없음 |
| IT-10 | 프로토콜 불일치(`hello` 1003) | 코어 `needsUser` + 앱 사유 `incompatible_version`, 캐시 읽기 가능 |
| IT-11 | 휘발 스트림 중 끊김 | 휘발 텍스트 비움, 재연결 뒤 `active`의 부분 텍스트 표시 |
| IT-12 | 전달 이벤트(실시간) | OS 알림 호출(모의), 같은 `deliveryId` 두 번이면 한 번, 재전송 중 전달은 알림 없음 |
| IT-13 | tick 끊김(가짜 데몬이 tick을 멈춤) | `clientTimeoutMs` 뒤 close 4000, 바로 재연결 |
| IT-14 | 느린 소비자(close 4008) | 첫 대기 0으로 재접속, 위치부터 재전송 |
| IT-15 | 재접속 뒤 바뀐 항목 | `revisionSeq` 기준으로 "다시 연결된 뒤 바뀜" 표시가 1분 붙음 |
| IT-16 | 읽기 전용(`server.modeChanged { mode: readOnly, reason }`), 사유 `integrity_suspect`·`disk_critical`·`operator`·`recovery_failed`·`projection_fault` 각각 | 상단 "읽기 전용"과 사유별 배너(§3.8.9), 결정 버튼 막힘. 5003 받은 명령은 명령함에서 지워지고 초안으로 돌아온다 |
| IT-17 | 데몬 저장소 복원 뒤 재접속, 진행 중 명령 있음 | `hello.log.storeId`가 달라 재전송 전에 `clearServer`. 진행 중 명령이 한 건도 나가지 않고 "보내지 못한 조작"으로 보임(F-17) |
| IT-18 | 재접속 뒤 다시 보낸 명령이 `3008`·`3009`·`3004`로 거부 | 결과별 토스트, 쓰던 내용이 초안(`origin: restored`)으로 돌아옴. `3008 assumed`면 이의 초안(판정 J-120) |
| IT-19 | 재페어링 뒤 이전 `deviceId`의 진행 중 명령 | 자동 재전송 없음, "보내지 못한 조작"에 보임(F-06) |
| IT-20 | 폐기(`1005 revoked`)와 만료(`1005 expired_idle`) | 폐기: 뷰·진행 중 명령 삭제, 초안만 남음. 만료: 모두 남고 재페어링 안내 |

- SSH 경로 통합(`app-test-ssh`): WSL 자신의 sshd와 가짜 데몬으로 Rust 전송을 실제로 연다. 확인: 열림, `daemon_unreachable`(가짜 데몬 포트 닫힘), `ssh_auth_failed`(없는 키), `ssh_host_key_unknown`(빈 known_hosts를 `-o UserKnownHostsFile`로 지정한 시험 모드).

#### 3.13.4 E2E 범위 [제안]

| 층 | 도구 | 플랫폼 | 범위 |
|---|---|---|---|
| 웹 E2E (주 경로) | Playwright 1.64, Chromium + WebKit | 서버(Linux) | IT-01~20, 화면 흐름(유즈케이스 UC-01~09의 화면 경로, 03 §3.7). WebKit은 macOS WKWebView와 같은 엔진 계열로 렌더 차이를 미리 잡는다 [가정: 같은 판이 아니므로 완전히 같지는 않다] |
| 셸 E2E (스모크) | WebdriverIO + `@wdio/tauri-service` 1.5.0, 앱에 `tauri-plugin-wdio-webdriver`(시험 빌드의 cargo feature `e2e`에서만) | macOS(Mac), Windows(`app-build-win-ci` 수동 워크플로 안, 사람 확인 뒤) | 앱 실행, 가짜 데몬에 WSS(개발 빌드 http 허용)로 연결, 홈 표시, 창 닫기 = 숨기기, `window_reveal`. `tauri-driver`는 Windows·Linux만 지원하고 macOS에는 WKWebView 드라이버가 없다. `@wdio/tauri-service`는 앱 안에 WebDriver 서버를 넣는 방식으로 macOS를 지원한다 [검색: v2.tauri.app/develop/tests/webdriver] |
| 수동 확인 | 체크리스트(§6.2) | 둘 다 | 알림 클릭, 트레이 메뉴, Dock 배지·작업 표시줄 덧그림, 로그인 시 시작, 딥 링크(설치한 앱), 키체인 확인 창, SSH 경로 실제 서버 |

OS 알림 표시, 트레이 메뉴 클릭, 딥 링크 등록은 자동화 도구가 OS UI를 다루지 못해 수동 확인으로 둔다.

#### 3.13.5 화면 캡처 비교 [제안]

- `just shot`(06 §3.16): 가짜 데몬 고정 데이터 + 브라우저 대체 실행 + Playwright `toHaveScreenshot`으로 화면 ID별 캡처를 만든다. 기준 이미지와 허용 차이는 21(UI-D14)이 정한다. 창 너비 1280, 1100, 900px(03 §6).
- 실제 셸 캡처가 필요하면 `run-on mac`으로 앱을 띄우고 `screencapture -l <창 ID>`로 찍는다. 기준 비교는 하지 않고 사람이 본다.

### 3.14 모바일 클라이언트와 나눠 쓸 코드 경계 [제안, 결정 42·47, 26 §3.1과 맞춤]

[결정 42]로 휴대폰에서 질문에 답하는 모바일 클라이언트가 범위에 들어왔다. 모바일은 데몬이 서빙하는 PWA이고 알림은 Web Push다([결정 47·48]). 세부는 26(P15)이 정한다. 이 절은 데스크톱이 지금 만드는 코드 중 무엇을 모바일과 나눠 쓰고 무엇을 데스크톱에만 두는지를 정한다. 26 §5.2의 20 요구(PlatformAdapter 선택 필드, 사용자용 연결 상태, 딥 링크 표, IndexedDB 이름, 폐기·만료 규칙)를 이 판에 반영했다.

| 층 | 패키지 | 내용 | 데스크톱 | 모바일 | TUI |
|---|---|---|---|---|---|
| 프로토콜 타입 | `@helm/protocol` | 메서드·이벤트·뷰 타입, TypeBox 스키마, 등록 표(19) | 씀 | 씀 | 씀 |
| 클라이언트 코어 | `@helm/client` | `HelmClient`, `Transport`·`ClientStateStorage` 인터페이스(19 §3.14, 판정 §2) | 씀 | 씀 | 씀 |
| 문구 | `@helm/ui-language` | 05 문구 키, 상태 라벨, 조사(판정 §2, J-103). 앱이 보이는 모든 문구 | 씀 | 씀 | 씀 |
| React 연결 | `@helm/client-react` (새 패키지, 제안) | `useView`, `useCommand`, TanStack Query 연결, `IdbClientStateStorage`와 뷰 캐시·초안 store(§3.9.5. 데이터베이스 이름은 앱이 넘긴다: 데스크톱 `helm-desktop`, 모바일 `helm-mobile`), 연결 모델·`UserConnState`·`needsUser` 원인 표·`decisionsAllowed`(§3.8.8·§3.8.9), 딥 링크 해석(§3.10.6의 표를 경로 의도로), 알림 규칙(중복 제거, 재전송 묶음, 강도별 표시, §3.10.1)의 순수 함수, presence 판정(§3.9.12) | 씀 | React면 씀 | 쓰지 않음 |
| UI 토큰·부품 | `@helm/ui-tokens`, `@helm/ui`(21 §3.13, 판정 J-85) | 토큰(CSS 변수·Tailwind 테마)과 부품. 처음부터 플랫폼 중립 패키지다: `@tauri-apps/*`, 앱 저장소, 프로토콜 호출을 가져오지 않는다 | 씀 | React면 씀(26이 정함) | 쓰지 않음 |
| 셸과 플랫폼 | `apps/desktop`(`src/shell`, `src/screens`, `src/platform`, `src-tauri`) | 셸 배치, 화면 컨테이너, Rust 전송(WSS·SSH), 키체인, 트레이, 배지, 전역 단축키, 로그인 시 시작, `helm-blob` 스킴, 창 관리·창 효과 | 데스크톱만 | 모바일이 자기 셸·플랫폼 구현을 둔다 | - |

`@helm/client-react`가 플랫폼에서 받는 것(데스크톱은 `platform/tauri`, 모바일은 26의 구현):

```ts
// packages/client-react/src/platform.ts
export interface PlatformAdapter {
  kind: 'desktop' | 'mobile';
  createTransport(profile: ServerProfileLike): Transport;          // 19 Transport. 데스크톱은 MultiRouteTransport(§3.8.8)
  credential: { status(serverId: string): Promise<{ present: boolean; deviceId: string | null }> };
  sign?: (serverId: string, payload: string) => Promise<string>;   // 기기 증명을 쓸 때
  notifications: { show(n: { title: string; body: string; target: string; deliveryId: string }): Promise<void> };
  onDeepLink(cb: (url: string) => void): () => void;
  settings: { get<T>(k: string): Promise<T | undefined>; set<T>(k: string, v: T): Promise<void> };
  blobUrl(serverId: string, blobId: string): string;
  visibility: { onChange(cb: (s: 'active' | 'idle' | 'hidden') => void): () => void };
  storage: { dbName: 'helm-desktop' | 'helm-mobile' };               // §3.9.5
  /** 모바일만(26 §3.4). 데스크톱은 두지 않는다. 휴대폰 알림은 Web Push(VAPID)다 [결정 47·48] */
  push?: {
    permission(): Promise<'granted' | 'denied' | 'default'>;
    subscribe(vapidPublicKey: string): Promise<{ endpoint: string; keys: { p256dh: string; auth: string } }>;
    current(): Promise<{ endpoint: string } | null>;
    unsubscribe(): Promise<void>;
  };
  /** 모바일만(26 §3.5). 백그라운드로 가면 연결을 닫고 위치만 저장, 앞으로 오면 retryNow(19 §3.16) */
  lifecycle?: { onHidden(cb: () => void): () => void; onVisible(cb: () => void): () => void };
}
```

규칙:

- `@helm/client-react`는 `@tauri-apps/*`, Node 모듈, DOM 밖의 플랫폼 API를 가져오지 않는다. 06 의존 규칙 표에 더한다(§5.2).
- **기기 토큰을 JS에 두지 않는다**(APP-D02)는 모바일에서도 지켜진다. 모바일 PWA는 브라우저 WebSocket이 `Authorization` 헤더를 붙일 수 없으므로 `HttpOnly` 쿠키 `__Host-helm_dt`로 토큰을 보낸다(판정 J-118, 18 §3.4.3 쿠키 갈래, 26 §3.3.3). `@helm/client-react`는 토큰 값을 다루는 코드를 갖지 않고 `createTransport`에 맡긴다.
- SSH 경로(결정 38)는 데스크톱 전용이다. 모바일은 `tailnet` 리스너의 `/m/` 경로만 쓴다(26 §3.2).
- 딥 링크 해석 표는 `@helm/client-react`에 하나만 둔다. 같은 의도(`question`, `brief` 등)를 데스크톱은 §3.9.2의 경로로, 모바일은 26 §3.5.2의 경로(`/m/q/:qsId`, `/m/brief` 등)로 바꾼다. 모바일에 없는 화면을 가리키는 링크는 "데스크톱에서 열 수 있습니다"로 처리한다(26 §3.5.2).
- 폐기·만료 처리(§3.9.5)와 진행 중 명령의 재전송 전 확인(§3.9.5)은 이 패키지의 저장소가 하므로 두 앱이 같다(26 §5.2의 20 요구 (6)).
- 모바일은 "질문에 답하기"가 주 용도이므로(결정 42) 화면 범위가 데스크톱보다 좁다. 그래도 같은 뷰(`inbox`, `question`), 같은 명령, 같은 `decisionsAllowed`, 같은 초안 규칙을 쓰므로 두 기기의 동작이 어긋나지 않는다(04 SC-03).
- 시점: `@helm/client-react`도 `@helm/ui`와 같이 데스크톱 MVP 때부터 별도 패키지로 만든다. 처음부터 플랫폼 경계를 두면 나중에 옮기는 비용이 작다. 대신 1차에는 데스크톱만 이 패키지를 쓰고, 공개 API는 26이 정해질 때 다시 본다(§7 Q-18).

## 4. 실패·예외·경계 사례

| # | 상황 | 감지 | 처리 [제안] |
|---|---|---|---|
| F-01 | 데몬이 꺼짐(WSL은 살아 있음) | WSS: serve가 502~504 → `daemon_unreachable`. SSH: `open failed: connect failed` → `daemon_unreachable` | 재시도(§3.8.8). 사용자용 상태 "Helm 서버 응답 없음"(04 §3.0.4). 캐시를 읽기 전용으로 보인다 |
| F-02 | 서버 PC가 잠들었거나 꺼짐, WSL이 멈춤 | TCP 시간 초과, SSH 22번 연결 실패 → `network_unreachable` | 재시도, 2분 넘으면 "서버 PC에 연결할 수 없음". 원격 깨우기는 범위 밖(홈랩) |
| F-03 | 클라이언트 Mac이 잠자기에서 깨어남 | 5초 타이머가 20초 넘게 밀림(`wake`) | `ping`(3초) 확인. 실패하면 바로 다시 연결. 잠자는 동안 ssh 자식은 대개 죽어 있어 `TRANSPORT_CLOSED`가 먼저 올 수도 있다 |
| F-04 | 이 기기의 Tailscale이 꺼짐 | MagicDNS 이름을 못 찾음(두 경로 모두. SSH 별칭 `server`도 tailnet 이름) | "서버 PC에 연결할 수 없음"(2분 뒤, §3.8.9 9행) + 점검 1단계 문구 "이 기기에서 Tailscale이 켜져 있는지 확인하세요"(04 §3.19) |
| F-05 | `tailscale serve`에 Helm 줄이 빠짐 | 8448 연결 거부 → `network_unreachable`(WSS만) | 경로 순서대로 SSH로 넘어간다. 같은 실패가 3라운드 이어지면 WSS 경로를 30분 뒤로 미룬다(§3.8.10). `SCR-CONNECT`에 표시 |
| F-06 | 다른 기기에서 이 기기를 폐기, 또는 토큰 만료 | close 4009, `hello` 1005(`reason`), 다음 업그레이드 401 | 코어 `needsUser`. 폐기(`revoked`)면 그 서버의 뷰 캐시·진행 중 명령·blob 캐시·키체인 항목을 지우고 초안만 남긴다. 만료(`expired_*`)면 모두 남기고 재페어링을 안내한다(§3.9.5). 재페어링하면 `deviceId`가 바뀌어 멱등 범위가 달라지므로 남은 진행 중 명령은 자동으로 다시 보내지 않고 "보내지 못한 조작"으로 보인다(첫 명령이 이미 커밋됐다면 두 번 적용되므로) |
| F-07 | 키체인이 잠겨 있거나 사용자가 접근을 거부 | `keychain_unavailable`·`keychain_denied` | 코어 `needsUser` + 앱 사유 `keychain_denied`, [다시 연결]. 토큰을 파일로 옮기지 않는다 |
| F-08 | macOS에서 앱을 다시 빌드한 뒤 키체인 확인 창 | OS 대화 상자 | 자체 서명 인증서로 서명하면 생기지 않을 것으로 본다(§3.10.7, 시험 항목). ad-hoc이면 "항상 허용"을 한 번 누른다 |
| F-09 | SSH 호스트 키가 바뀜(WSL 재설치 등) | `ssh_host_key_changed` | 자동 해결 없음. 경고와 함께 서버의 지문 출력(17 `helm doctor`)과 대조한 뒤 사용자가 `ssh-keygen -R`으로 지우라고 안내한다. 앱은 known_hosts를 고치지 않는다 |
| F-10 | 호스트 키를 처음 봄 | `ssh_host_key_unknown` | 터미널에서 `ssh server`로 한 번 접속하고 지문을 `helm doctor` 출력과 대조하라고 안내 |
| F-11 | 비밀번호가 걸린 키, 에이전트 없음 | `ssh_auth_failed`(BatchMode) | macOS `ssh-add --apple-use-keychain`, Windows `ssh-agent` 서비스 켜기 안내. WSS 경로가 있으면 그쪽으로 넘어간다 |
| F-12 | Windows에 OpenSSH 클라이언트가 없음 | `ssh_missing` | SSH 경로만 막힘. 선택적 기능 설치 안내. WSS 경로는 동작 |
| F-13 | sshd가 포워딩을 막음 | stderr `administratively prohibited` | `ssh_failed` + "서버가 포워딩을 막음". 17이 설정 확인(AS-4) |
| F-14 | macOS 26의 OpenSSH가 stderr에 PQ KEX 경고를 냄 | 종료 코드 0, 경고 줄 | 실패로 보지 않는다(§3.8.3) |
| F-15 | 프로토콜 버전이 맞지 않음 | `hello` 1003 | 코어 `needsUser` + 앱 사유 `incompatible_version`, 오래된 쪽 갱신 안내(§3.12.7). 캐시 읽기는 된다 |
| F-16 | 스키마 해시가 바뀜(같은 프로토콜 버전의 additive 변경) | hello `features.schemaHash` | 해당 캐시 행을 버리고 다시 받는다 |
| F-17 | 데몬 저장소를 백업에서 복원(`storeId` 바뀜) | `hello.log.storeId` ≠ 저장 위치의 `storeId`(재전송 전), 또는 `2001 storeMismatch` | 재전송 전에 코어가 `clearServer(serverId, "all")`을 부른다(§3.9.5, 19에 요구). `pending` 행의 `storeId`가 다르면 자동 재전송에서 빠진다. 초안은 `storeId`로 복원을 알고 대상을 다시 확인한다. 앱은 뷰·위치를 지우고, `pending` 행은 지우지 않고 `appState: 'storeReset'`을 붙인다. `listPending`은 `appState`가 있는 행을 돌려주지 않으므로 코어가 자동으로 다시 보내지 않는다(복원된 DB에는 그 멱등 키가 없어 다시 적용될 수 있다). `SCR-CONNECT` "보내지 못한 조작"에서 사람이 본다 |
| F-18 | 오래 접속하지 않아 밀린 이벤트가 정책 상한을 넘음 | `2001 tooFar` | 뷰를 낡음으로 두고 `head`부터 구독, 열린 뷰 다시 받기, 이력 화면에 "생략됨" |
| F-19 | 데몬 재시작 예고 | `server.shutdown`, 뒤이어 close 1001 | `restartExpectedMs` 동안 "서버 종료 중"(04 §3.0.4)으로 보이고 오류로 보이지 않는다(17 요구). 그 뒤 재시도 |
| F-20 | 같은 질문에 두 기기에서 답함 | 늦은 쪽이 `3008 command.alreadyResolved` 또는 `3004`(대상 revision이 바뀐 경우, 19 F-15) | "이미 답했습니다(다른 기기 · 시각)"(04 §3.0.5). `resolvedBy`·`resolvedVia`를 보인다. 쓰던 답은 초안으로 남긴다. 가정이 먼저 확정됐으면(`outcome: assumed`) 확정 값을 보이고 쓰던 답을 이의 초안으로 넘긴다(판정 J-120) |
| F-21 | 결정을 보내는 중 앱이 죽음 | 다음 시작 때 `pending`에 행이 남음 | 코어가 `syncing`에 들어가며 같은 멱등 키로 다시 보내 결과를 받는다(19 §3.9.1). 나이가 정책을 넘었으면 `expired`로 보이고, "보내지 못한 조작" 화면이 먼저 `command.lookup`으로 원래 키의 결과를 묻는다(§3.9.7) |
| F-22 | IndexedDB가 자동으로 지워지거나 손상 | 열기 실패, 행 없음 | 데이터베이스를 지우고 다시 만든다. 위치가 없으니 `head`부터. 오프라인이면 `missing` 화면 |
| F-23 | IndexedDB 용량 초과 | `QuotaExceededError` | 오래된 비고정 뷰부터 지우고 다시 시도. 그래도 실패하면 이번 실행 동안 뷰 사본 저장을 멈추고 로그를 남긴다 |
| F-24 | tick이 오지 않음(반쯤 끊긴 연결) | `clientTimeoutMs`(35초) 초과 | 코어가 close 4000으로 닫고 다시 연결(19 §3.10.1) |
| F-25 | 창을 숨긴 동안 웹뷰 타이머가 느려짐 | tick 감시가 늦게 돎 | 다음 메시지를 받을 때 벽시계로 다시 계산한다(타이머 횟수로 세지 않는다). 숨김 동안 알림이 늦으면 Q-06 |
| F-26 | 휘발 스트림 조각 유실 | 19 코어의 `n` 건너뜀 | 코어가 `run.partial`로 맞춘다. 앱은 결과만 그린다 |
| F-27 | 느린 연결에서 대량 재전송 | 데몬 송신 큐 | 데몬이 재생 속도를 맞춘다(19 §3.5.8). 그래도 4008이면 바로 다시 연결해 위치부터 |
| F-28 | 업로드 중 끊김 | `blob_upload` 실패 | 청크 업로드면 다시 연결 뒤 `HEAD`로 받은 바이트 수를 보고 이어 감. 한 번 업로드면 처음부터. 화면은 "올리는 중 연결이 끊겼습니다. 연결되면 이어서 올립니다."(한 번 업로드면 "연결되면 처음부터 다시 올립니다.") |
| F-29 | blob을 찾을 수 없음 | `GET /files/b` 404(`4002`) | 이미지 자리에 "서버에 이 파일이 없습니다. 지워졌거나 백업 복원으로 빠졌을 수 있습니다."(05 키 요구) |
| F-30 | 앱이 비정상 종료해 ssh 자식이 남음 | - | `-W` 자식은 표준 입력이 닫히면 끝나므로 부모가 죽으면 같이 끝날 것으로 본다 [가정, §6 시험]. OpenClaw처럼 로컬 포트 터널을 쓰지 않아 고아 정리 장부가 필요 없다 |
| F-31 | 다른 데몬(개발용)에 붙음 | `hello.challenge.serverId` ≠ 프로필 | 코어 `needsUser` + 앱 사유 `wrong_server`. 개발용 데몬은 별도 프로필로 만든다 |
| F-32 | 딥 링크 형식이 틀림, 다른 서버의 링크, 피싱 페어링 링크 | 형식 검사, `sid` 비교 | 무시하고 로그. `sid`가 다르면 프로필 전환을 묻는다. 페어링 링크는 기존 프로필의 주소를 바꾸지 않는다(§3.10.6) |
| F-33 | 앱이 꺼진 상태에서 딥 링크 실행 | macOS: 실행 인자, Windows: 실행 인자 | 시작할 때 `getCurrent()`로 받아 첫 경로로 쓴다(§3.9.2) |
| F-34 | 두 번째 실행(Windows) | 단일 인스턴스 플러그인 | 기존 창을 보이고 인자를 넘긴다 |
| F-35 | OS 알림이 꺼져 있음 | 데스크톱 플러그인은 권한을 늘 허용으로 돌려준다(§3.10.1) | 알 수 없다. `SCR-SETTINGS`에 "시스템 설정에서 Helm 알림이 켜져 있는지 확인하세요"를 늘 보인다. 질문함·배지는 그대로 동작 |
| F-36 | 전역 단축키를 다른 앱이 씀 | 등록 오류 | `SCR-SETTINGS`에서 다른 조합을 고르게 한다 |
| F-37 | 시스템 시계가 틀림 | `hello.challenge.serverTime`과 2분 넘게 차이 | `SCR-CONNECT`에 경고. 기기 서명을 켜면 1007이 날 수 있다 |
| F-38 | 앱을 갱신하는 동안 진행 중 명령이 있음, 또는 영구 오류 | `pending` 행의 `protocol`·`schemaHash`, 응답 `retryable: false`(-32600·-32601·-32602·5007 등) | 같은 `protocol`·`schemaHash`면 새 판이 이어서 다시 보낸다. 다르면 `schemaChanged`, 영구 오류면 `permanentError`로 표시하고 "보내지 못한 조작"으로 보인다. 재접속마다 같은 params를 다시 보내지 않는다 |
| F-39 | WebView2가 없는 Windows(제거된 경우) | 설치 파일이 부트스트래퍼로 내려받음 | 오프라인이면 설치 실패. INSTALL.md에 안내 |
| F-40 | 프로필이 없고 네트워크도 없음(첫 실행) | - | `SCR-ONBOARD`에서 연결 방식만 저장하고 "연결되면 페어링" 안내 |
| F-41 | 서버 PC의 Windows 앱이 자기 tailnet 이름으로 접속하지 못함 | AS-5 실패 | Q-05의 직접 경로를 켠다 |
| F-42 | 읽기 전용 중 보낸 명령 | `5003 daemon.readOnly` | 적용되지 않음이 확정이다. 진행 중 명령함에서 지우고 입력을 초안(`origin: restored`)으로 돌린다. 모드가 풀리면 그 화면에 "보내지 않은 답이 있습니다"를 보이고 사람이 보낸다. 자동으로 보내지 않는다(판정 J-02, 04 ADR A4) |
| F-43 | 웹뷰가 오염되어 임의 주소로 경로를 바꾸려 함 | `profile_upsert`의 주소 변경 | Rust 네이티브 확인 창에 실제 주소가 보인다. 취소면 `user_cancelled`. 토큰은 저장된 경로로만 간다(§3.6.3) |

## 5. 다른 문서와의 인터페이스

### 5.1 이 문서가 제공하는 것

| 제공 | 받는 문서 |
|---|---|
| 앱 프로세스 경계(Rust 전송·키체인, 웹뷰 화면), IPC 명령·이벤트 목록(§3.4·§3.5) | 06, 18, 22 |
| SSH 경로의 클라이언트 구현(인자, 실패 분류, 호스트 키 정책, §3.8.3) | 18, 19, 17 |
| 경로 선택기(`MultiRouteTransport`), 코어 상태 → 04 사용자용 상태·21 `ConnectionUiState` 판정, `decisionsAllowed`(§3.8.8·§3.8.9) | 04, 05, 19, 21 |
| 뷰 캐시·위치·진행 중 명령함·초안의 저장 구조와 동기화 절차(§3.9.5~§3.9.7) | 19, 21, 22 |
| 앱 신선도 값(`current`·`refreshing`·`stale`·`missing`·`failed`)과 "다시 연결된 뒤 바뀜" 표시 규칙(§3.9.8) | 21(`FreshnessIndicator`), 04 |
| 라우터 구현(03 경로 표 그대로), 딥 링크 처리, 최소 창 크기(§3.9.2, §3.10.6) | 03 |
| OS 알림·트레이·배지·단축키·로그인 시 시작의 동작(§3.10), 알림 강도별 표시(§3.10.1) | 04 §3.24, 05, 11 |
| presence 보고 규칙(§3.9.12) | 11, 14, 16 |
| 빌드·배포 레시피 내용(`app-*`, `shot`, §3.12.2)과 Windows 빌드 경로 | 06, 23 |
| 앱 테스트 층과 시나리오 IT-01~20(§3.13), 모듈 완료 기준 ID `DM-nn`(§6.1), 수동 확인 `MC-nn`(§6.2) | 22, 19(적합성 도구의 가짜 서버 조작 목록) |
| 모바일과 나눠 쓸 코드 경계(`@helm/client-react`, `PlatformAdapter`, §3.14) | 26, 06, 21 |
| 서드파티 고지의 앱 표시(§3.12.8) | 07 |

### 5.2 다른 문서에 요구하는 것 (4단계 갱신)

2a단계 요구 중 반영된 것(19의 `TransportFailure.blocked`·`retryNow()`·`lastMessageAt`·`pendingResolved`·무효화 순서·`listPending` 계약·가짜 서버 조작, 21의 `safe_mode`·`read_only`·`refreshing` 규칙·`decisionsAllowed`, 06의 패키지 의존과 React 19·Node 24.15, 17의 `restartExpectedMs`, 12·19의 `tray` 뷰, 18의 모바일 쿠키 전달(판정 J-118))은 지웠다. 남은 것과 4단계에서 새로 생긴 것만 적는다.

| 문서 | 요구 |
|---|---|
| 19 | (1) 재전송 전에 `hello.log.storeId`를 저장 위치와 비교하고 다르면 `clearServer(serverId, "all")`을 먼저 부른다. `ClientStateStorage.listPending(serverId, current: { storeId, deviceId, protocol, schemaHash })`로 현재 값을 넘기고, `PendingCommand`에 `storeId`·`deviceId`·`protocol`·`schemaHash`를 더한다(§3.9.5, V3-011·V3-012·V3-040). CT-08에 "재전송이 먼저 나가지 않음". (2) `command.lookup({ idempotencyKey })` 읽기 메서드(같은 기기 범위, 보존 7일)(§3.9.7, V3-041). (3) F-17의 "5003이면 보존했다가 모드가 풀리면 보낸다"를 "명령함에서 지우고 초안으로"로(§3.9.7, F-42). (4) F-06을 폐기·만료 구분과 재페어링 뒤 자동 재전송 제외로(§3.9.5). (5) `server.modeChanged.reason`을 17의 사유 값(`disk_critical`·`integrity_suspect`·`recovery_failed`·`projection_fault`·`operator`)의 배열로 정하고 `hello`에도 현재 사유를 싣는다(§3.8.9). (6) 3008 `outcome` 열거에 `expired`, J-120의 `assumedValue`(§3.9.7). (7) §2.4의 "별도 푸시 채널 없음"을 결정 47 기준으로, §3.8.3 숨김 알림 문구를 05 `notif.hidden.*`로 |
| 09·11 | (1) `question.delivered`에 `deliveryMode`(`immediate`·`negotiated`·`mediated`·`scheduled`)를 더하거나, 11이 협상 전달의 `surface`에서 `os`를 뺀다(§3.10.1 규칙 5, Q-25, AC-04-01). (2) 같은 질문의 승격 전달을 구분하는 표시(예: `cause: 'promotion'`). (3) 11·10의 payload 표기(`deviceIds`, 평평한 `titleKey`)를 09 필드(`targetDevices`, `copy{}`, `batchKey`)로. (4) 11 urgencyOf·`pushReachable`·`planPush`(판정 J-119, 26 §3.4.3) |
| 05 | (1) 숨김 알림 키 `notif.hidden.title`·`notif.hidden.body`(개수 있음·없음, 26과 같은 값). (2) 읽기 전용 키 `err.daemon.readOnly`(사유별 문장: 기록 점검, 운영자 전환)로 `err.daemon.recoveryMode`를 바꾼다(판정 J-115). (3) 페어링 실패 키 하나("코드가 틀렸거나 만료됐습니다", 판정 J-81). (4) 새 키: `protocol_error` 사유, `policy_closed`·`revoked`·`expired` 사유 문장(§3.8.8 표), 재전송 결과별 토스트 넷(§3.9.7), "보내지 않은 답이 있습니다", 복원 뒤 초안 경고(§3.9.5), 디스크 암호화 안내, blob 404 문장(F-29), 네이티브 확인 창의 Tailscale 밖 주소 경고, 알림 클릭 대체 배너, 재전송 묶음 알림, Windows 첫 숨김 안내. (5) `notice.app.updateRequired`의 "갱신"을 `err.protocol.version`의 "업데이트"와 맞춘다. (6) §3.7.7의 "별도 푸시 채널 없음"을 결정 47 기준으로 |
| 04 | (1) `SCR-CONNECT`의 "보내지 못한 조작"에 `command.lookup` 결과 표시와 원인별(만료, 복원, 기기 바뀜, 형식 바뀜, 영구 오류) 문장. (2) 읽기 전용 배너를 사유별로(§3.8.9). (3) `SCR-SETTINGS`에 `notifications.negotiated`(협상 전달 알림, 기본 끔)와 §3.9.11의 다른 설정 |
| 17·18 | (1) 17 `helm device issue`에 `--stdin`(이름·플랫폼·종류를 표준 입력 JSON으로)과 기본 경로 `~/.local/bin/helm`(§3.8.7, V4-009). (2) 18·INSTALL에 앱 전용 SSH 키 권장 구성 `restrict,port-forwarding,permitopen="127.0.0.1:7841"`과 발급용 `command=` 키(§3.8.7, V4-023). (3) 18 §3.15에 Cargo 행(`Cargo.lock`, `--locked`, `cargo audit`·`cargo deny`), CI 행(액션 SHA 고정), 빌드 도구 행(§3.12.2, V4-028). (4) 18 §3.19 오프라인 사본 규칙에 blob 디스크 캐시와 초안, 폐기·만료 구분(§3.9.5) |
| 21 | (1) §3.6.7의 문구 사전 위치를 `@helm/ui-language`로(판정 J-103). (2) 21의 `ConnectionUiState`에서 20 `UserConnState`로 가는 대응은 §3.8.9 표가 정본이다 |
| 26 | §3.14의 `PlatformAdapter`(`push?`, `lifecycle?`, `storage.dbName`), 딥 링크 해석 표, 폐기·만료 규칙을 이 판으로 맞췄다. |
| 06 | 없음(`app-dev` 프록시 조건과 앱의 비밀 환경 변수 예외는 06 §3.17과 이 문서 §3.12.2가 같다) |
| 07 | (해결, [판정 J-218]) Rust 크레이트 고지 생성은 `just licenses`에 넣는다. 고지 파일은 루트 `THIRD_PARTY_NOTICES.md` 하나다(§3.12.8) |
| 16 | 열람 기록은 `presence.report`의 `screen`·`objectId`·`depth`(판정 J-84)로 만든다. 앱은 별도 `view.opened`를 보내지 않는다(19 §3.7.8) |
| 22·23·24 | 22: 이 문서의 §6.1 `DM-nn`, §3.13.3 `IT-01~20`, §6.2 `MC-01~14`를 인용한다. 23: 앱 구현 순서(코어·가짜 서버 → `@helm/client-react` → 앱 골격·Rust WSS 전송 → 동기화·캐시 → SSH 경로 → OS 통합 → 빌드·배포). 24: ADR-20-01~09. ADR-20-04의 범위는 "데스크톱 SPA"이고 모바일 PWA는 예외다(결정 47) |

## 6. 구현 단위와 완료 기준

공통 완료 조건: `just verify` 통과(`app-check` 포함), 앱 화면을 바꿨으면 `just app-e2e`와 `just shot` 비교.

작업 단위: §6.1의 `DM-nn` 행 하나가 3단계 실작업자 한 건의 크기를 넘지 않게 나눴다 [결정 51]. 난이도 등급과 담당 단계·모델은 23이 적는다. 이 문서의 제안은 Rust 전송(`DM-03`~`DM-08`), 토큰 보낼 곳(`DM-09`), 연결 계층(`DM-13`)은 난이도가 높아 하위 조정자의 검토를 거치는 것이다 [제안].

### 6.1 모듈별 완료 기준

22가 인용할 수 있게 행마다 ID(`20/DM-nn`)를 둔다. 통합 시나리오는 `20/IT-nn`(§3.13.3), 수동 확인은 `20/MC-nn`(§6.2)이다.

| ID | 단위 | 위치 | 완료 기준(테스트로 확인할 조건) |
|---|---|---|---|
| DM-01 | 프로필 저장·검증 | `src-tauri/src/profiles.rs`, `src-tauri/core/src/profile.rs`, `src/platform/types.ts` | TS와 Rust가 같은 표본(`fixtures/profile-validation.json`, 정상 20개·비정상 30개)에서 같은 판정을 한다. `-oProxyCommand=…`, 공백, 상대 경로 키 파일이 거부된다. 저장 중 앱을 죽여도 파일이 깨지지 않는다(임시 파일 + 이름 바꾸기) |
| DM-02 | 키체인 | `src-tauri/src/secrets.rs` | Mac·Windows 수동 확인: 저장·조회·삭제. 토큰 값이 IPC 응답·로그·진단 묶음에 없다(로그 grep 시험, 진단 묶음 내용 시험) |
| DM-03 | SSH 인자·실패 분류 | `src-tauri/core/src/ssh.rs` | 인자 목록이 §3.8.3과 같다(스냅샷). SSH 발급 원격 인자가 인자마다 작은따옴표로 감싸이고, 셸 메타 문자 표본 20개를 담은 기기 이름·경로가 원격 셸에서 명령으로 실행되지 않는다(WSL sshd 통합 시험에서 표시 파일이 생기지 않음). 실제로 모은 stderr 표본(macOS 15·26, Windows 11, Ubuntu 24.04)이 표대로 분류된다. PQ KEX 경고만 있는 경우 실패가 아니다 |
| DM-04 | WebSocket-over-stream | `src-tauri/core/src/ws.rs` | `tokio::io::duplex` 시험: 업그레이드 헤더 세 가지, 서버 ping에 pong, 바이너리 → 1003, 16 MiB 초과 → 닫힘, 송신 대기 4 MiB 초과 → 닫힘, `closed`가 정확히 한 번 |
| DM-05 | 전송 관리자 | `src-tauri/src/transport/` | 프로필당 연결용 전송 하나(두 번째 `transport_open`이 첫 번째를 닫음). 앱 종료 때 ssh 자식이 남지 않는다(Mac·Windows에서 프로세스 목록 확인, F-30) |
| DM-06 | SSH 경로 통합 | `just app-test-ssh` | WSL sshd + 가짜 데몬: 열림, `daemon_unreachable`, `ssh_auth_failed`, `ssh_host_key_unknown`이 각각 나온다 |
| DM-07 | blob | `src-tauri/src/blob.rs`, `core/src/blob_cache.rs` | 캐시 적중 시 네트워크 요청이 없다. 해시가 맞지 않으면 캐시에 쓰지 않는다. 연결이 없으면 503. 8 MiB 넘는 파일은 청크로 올라간다(가짜 서버) |
| DM-08 | 페어링 | `src-tauri/src/pairing.rs` | 코드 페어링과 SSH 발급 모두 결과 토큰이 키체인에만 있고 웹뷰 응답에는 `serverId`, `deviceId`만 있다. `HELM-DEVICE/1` 줄 앞의 셸 잡음 10줄을 무시한다. 페어링 실패는 사유와 관계없이 `pairing_failed` 하나다 |
| DM-09 | 토큰 보낼 곳 | `src-tauri/src/transport/`, `profiles.rs` | 웹뷰 인자로 주소를 넘기는 명령이 없다(명령 표 정적 검사). `route_check`로 저장하지 않은 주소를 점검할 때 가짜 서버가 받은 요청에 `Authorization` 헤더가 없다. 경로 추가·주소 변경·`pairing_*`·`credential_forget`·`profile_delete`가 네이티브 확인 없이 실행되지 않는다(Rust 시험에서 확인 창 함수를 가짜로 바꿔 취소를 돌려주면 `user_cancelled`) |
| DM-10 | capability·CSP | `src-tauri/capabilities/main.json`, `tauri.conf.json` | `app-check`의 정적 검사: 앱 명령 목록(`build.rs`)과 capability의 `allow-*`가 일대일, `shell`·`fs`·`http` 권한 없음, `store:default`·`store:allow-load`·`log:default` 없음, CSP `connect-src`가 `ipc: http://ipc.localhost`뿐, `remote.urls` 없음 |
| DM-11 | blob 스킴 응답 | `src-tauri/src/blob.rs` | 허용 목록 밖 MIME(`image/svg+xml`, `text/html`)이 `application/octet-stream`으로 나간다. 모든 응답에 `nosniff`. 해시를 확인하지 못한 응답은 캐시에 남지 않는다 |
| DM-12 | 공급망 | `app-check` | `cargo deny check`, `cargo audit` 통과. `--locked` 없는 cargo 호출이 레시피에 없다. 워크플로의 `uses:`가 모두 커밋 SHA다 |
| DM-13 | 연결 계층 | `packages/client-react/src/connection/`, `apps/desktop/src/connection/` | §3.8.9 표의 각 행과 §3.8.8의 `needsUser` 원인 표 각 행이 시험 한 줄. 읽기 전용 사유별 배너 키. `MultiRouteTransport`가 토큰 계열에서 다음 경로로 넘어가지 않고, SSH 차단 계열을 `blocked`로 바꾼다. 인증 계열에서 재시도가 없다 |
| DM-14 | 깨어남·포커스 확인 | `src/connection/probe.ts` | 벽시계 20초 밀림을 깨어남으로 판정, `ready`면 `ping` 3초, 실패하면 4000으로 닫음, `backoff`면 `retryNow()` |
| DM-15 | 코어 연결 | `src/sync/session.ts`, `src/sync/stores.ts` | §3.13.1 행. IT-01~05 |
| DM-16 | 뷰 읽기 | `src/sync/views.ts` | 오프라인에서 캐시 행 반환, 늦은 응답이 새 값을 덮지 않음, `schemaHash` 불일치 행 폐기, 고정 뷰는 용량 정리에서 빠짐 |
| DM-17 | 명령 | `src/sync/commands.ts`, `src/intents/` | `decisionsAllowed`가 거짓이면 보낼 수 없다. 끊김 뒤 같은 멱등 키 재전송(IT-06), 3004 → conflict(IT-07), `storeMismatch` 뒤 `storeReset` 행은 `listPending`에 나오지 않음(F-17) |
| DM-18 | 초안 | `src/db/idb.ts` `drafts` | 입력 300ms 뒤 저장, 앱 재시작 뒤 복원, 보내기 성공 뒤 삭제, 자동 전송 없음 |
| DM-19 | 시작 시간 | `src/app/boot.ts` | 앱 실행부터 IndexedDB 고정 뷰로 홈이 그려지기까지 2초 이하(01 NFR-P-3, Mac·Windows에서 측정). 연결을 기다리지 않는다 |
| DM-20 | 라우터 | `src/navigation/screens.ts`, `router.tsx` | 03 §3.5.5의 모든 화면 ID에 경로가 있다(타입 검사). 잘못된 ID 인자는 "찾을 수 없음". 시작 경로 우선순위(딥 링크 > 온보딩 > 마지막 경로 > 홈) |
| DM-21 | 딥 링크 | `src/navigation/deeplink.ts`, 플러그인 설정 | §3.10.6 표의 모든 형식(단위). 설치한 앱에서 수동 확인(§6.2) |
| DM-22 | 알림 | `src/platform/tauri/notifications.ts` | 재전송 중 전달은 띄우지 않음, `deliveryId` 중복 없음, `channel`이 `app`이 아니면 띄우지 않음, `surface`·`targetDevices`(`'all'`과 목록)·`expiresAt` 규칙, `batchKey` 묶음, 협상 전달은 `notifications.negotiated`가 켜졌을 때만(IT-12) |
| DM-23 | 트레이·배지 | `src-tauri/src/os/tray.rs`, `badge.rs`, `src/platform/tauri/tray.ts` | `tray` 뷰 값을 그대로 쓴다(앱이 세지 않음, 단위 시험: 뷰 표본 → `TraySummary`). 배지는 선택 필요 수만 |
| DM-24 | 오류 경계 | `src/errors/` | 화면 하나의 렌더 오류가 셸을 무너뜨리지 않는다(컴포넌트 시험). 모르는 오류 코드도 문구가 있다 |
| DM-25 | 빌드 | `app-build-local`, `app-build-win` | Mac: universal `.app`이 서명(자체 서명 또는 ad-hoc)되어 `/Applications`에서 열린다. Windows: NSIS 설치 파일이 Windows 11에서 관리자 권한 없이 설치·실행된다(수동). 태그 때 CI 빌드도 통과 |
| DM-26 | `@helm/client-react` | `packages/client-react/` | `@tauri-apps/*`·Node 모듈을 가져오지 않는다(의존 규칙 검사). 가짜 `PlatformAdapter`와 가짜 서버로 `useView`·`useCommand`·초안·알림 규칙 시험이 브라우저 없이(jsdom) 돈다 |
| DM-27 | 설정 | `src/platform/tauri/settings.ts` | §3.9.11의 모든 키에 기본값이 있고, 글자 크기 변경이 웹뷰 확대로 적용된다(Mac·Windows 수동) |
| DM-28 | 알림 규칙 | `packages/client-react/src/notify.ts` | 재전송 묶음 1개, `digest` 전달은 OS 알림 없음, 방해 금지 중 없음과 끝난 뒤 묶음, 같은 질문 2회 상한, `observer` 기본 끔, `showContent` 끔이면 `notif.hidden.*`(개수 있음·없음)(가짜 시계 시험) |
| DM-29 | 서드파티 고지 | `just licenses` | `THIRD_PARTY_NOTICES.md`(npm·Rust 항목)가 `just licenses` 생성 결과와 같다. "정보" 절에 보인다 |
| DM-30 | 셸 스모크 | `e2e/shell/` | `@wdio/tauri-service`로 Mac·Windows에서: 앱이 뜨고, 가짜 데몬에 연결해 홈이 보이고, 창 닫기 뒤 프로세스가 살아 있다 |

### 6.2 수동 확인 체크리스트 (출시 전, 플랫폼마다)

항목 번호는 22의 `20/MC-nn`과 같다.

1. **MC-01** 알림: 실시간 전달에 OS 알림이 뜨고, 클릭하면 대상 화면이 열린다(2.6.0 `onAction`). 안 되면 대체 배너가 나온다.
2. **MC-02** 트레이: 메뉴 항목과 숫자가 `tray` 뷰와 같다. Windows 왼쪽 클릭 = 창 보이기.
3. **MC-03** 배지: macOS Dock 숫자, Windows 작업 표시줄 덧그림이 선택 필요 수와 같다.
4. **MC-04** 단축키: 사용자가 정한 조합으로, 다른 앱이 앞에 있을 때 빠른 입력이 열린다. 한글 입력 상태에서도 동작한다.
5. **MC-05** 로그인 시 시작: 켜고 재로그인하면 트레이만 뜬다(`--background`).
6. **MC-06** 딥 링크: 설치한 앱에서 `helm://question/<id>`, `helm://pair?…`가 동작한다. 앱이 꺼져 있을 때도.
7. **MC-07** 키체인: macOS에서 다시 빌드·설치한 뒤 확인 창이 다시 뜨는지(자체 서명 인증서와 ad-hoc 각각). 결과를 §7 Q-08에 기록.
8. **MC-08** SSH 경로: 실제 서버 별칭 `server`로 연결, WSS를 끈 상태에서 자동 전환.
9. **MC-09** 잠자기: Mac을 5분 재우고 깨우면 10초 안에 `ready`로 돌아온다.
10. **MC-10** 숨긴 창: 창을 숨기고 30분 뒤 실시간 전달 알림이 제때 뜬다(AS-6, Q-06).
11. **MC-11** 창 효과: macOS "투명도 줄이기"를 켜고 끄면 다시 시작하지 않고 바뀐다. Windows 11은 Mica, Windows 10은 불투명이다.
12. **MC-12** 네이티브 확인: 경로 추가·주소 변경·페어링·자격 증명 지우기·프로필 삭제에서 Rust 확인 창이 뜨고 실제 주소가 보인다. `*.ts.net`이 아닌 주소에는 경고 문장이 더해진다.
13. **MC-13** 서명 인증서: 만료 90일 전 경고가 `app-build-local` 출력에 나온다(시험 인증서로 확인).
14. **MC-14** 디스크 암호화 안내: FileVault·BitLocker가 꺼진 기기에서 첫 실행 안내 끝에 켜라는 문장이 나온다.

## 7. 미결 사항

| 번호 | 질문 | 선택지 | 추천 기본값 |
|---|---|---|---|
| Q-01 | 클라이언트 코어의 위치 | (해결) | 판정 §2로 `@helm/client` 확정 |
| Q-02 | 전송을 Rust가 가질지 웹뷰 WebSocket이 가질지 | Rust(APP-D02) / 웹뷰 WebSocket + Rust는 SSH 로컬 포트만 | Rust. 토큰이 웹뷰에 없고, 로컬 포트를 열지 않고, CSP에 원격 주소가 없다. IPC 처리량이 문제가 되면(측정 기준: 초당 1,000 메시지에서 화면이 밀림) 다시 본다 |
| Q-03 | 연결이 없을 때 결정 대기열 | (해결) | 판정 J-02: 막고 초안으로 보존, 결과를 모르는 명령만 같은 키로 다시 보냄 |
| Q-04 | 기기 키 서명(챌린지 nonce) | 토큰만 / 토큰 + Ed25519 서명 | 토큰만. 18이 켜면 `device_sign_challenge`를 넣는다 |
| Q-05 | 서버 PC의 Windows 앱을 위한 직접 경로(`ws://127.0.0.1:7840`) | 두지 않음 / 둠 | 두지 않음(06 §3.6과 같음). AS-5가 틀리면 `tailnet` 리스너 직접 연결 대신 `loopback`(7841) 직접 연결을 프로필 종류 `local`로 더한다(Tailscale 헤더 없이 토큰만 받는 리스너라 맞다) |
| Q-06 | 창을 숨긴 동안 알림 지연 | 웹뷰 JS가 처리 / Rust가 전달 이벤트를 직접 보고 알림 | 웹뷰 JS. §6.2 MC-10에서 지연이 보이면 Rust가 들어오는 프레임에서 전달 이벤트만 골라 알림을 띄운다(그때는 Rust가 이벤트 형식 하나를 알게 된다) |
| Q-07 | Windows 자격 증명 보존 범위 | 로컬 / 로밍(크레이트 기본) | 로컬. 크레이트가 지원하지 않으면 로밍(1인, 도메인 계정 아님이라 영향 작음) |
| Q-08 | macOS 서명 | 자체 서명 인증서 / ad-hoc | 자체 서명 인증서(판정 J-15로 결정 24 범위 안임을 확인). §6.2 MC-07로 키체인 확인 창이 없는지 시험한 뒤 확정 |
| Q-09 | 자동 업데이트 | 없음 / updater 플러그인 + 데몬이 서빙하는 매니페스트 | 1차 없음. Windows 갱신이 한 달에 두 번 넘게 필요해지면 2차 후보를 넣는다 |
| Q-10 | 서버 상태 라이브러리 | TanStack Query / RTK Query / 직접 | TanStack Query. 사용자가 다른 것을 선호하면 `sync/views.ts` 안에서만 바꾸면 된다 |
| Q-11 | Windows 빌드 기본 경로 | WSL 교차 빌드 / GitHub Actions | 교차 빌드. 첫 구현에서 교차 빌드가 세 번 넘게 막히면 CI를 기본으로 바꾼다 |
| Q-12 | macOS 빌드 대상 | universal / arm64만 | universal. 빌드가 5분을 넘게 걸리면 arm64만 |
| Q-13 | 오프라인 뷰 사본 | 평문 IndexedDB / 끔 / 암호화 | 평문 + 끌 수 있음 + 디스크 암호화 안내(§3.9.5, 18 §3.19) |
| Q-14 | 알림의 동작 단추 | 없음 / "가정대로 진행" 등 | 없음. 결정은 질문을 본 화면에서만 |
| Q-15 | SSH known_hosts | 사용자 파일 / 앱 전용 파일 | 사용자 파일. 별칭 `server`를 이미 쓰고 있다 |
| Q-16 | 경로 자동 전환 기본값 | 켬(`ordered`) / 끔(`pinned`) | 켬. 04 `SCR-CONNECT`의 확인란을 기본으로 켜 달라고 요구했다 |
| Q-17 | assistant-ui 사용 여부 | 21 결정 | 21 UI-D11을 따른다. 쓰지 않게 되면 §3.9.10만 빠진다 |
| Q-18 | `@helm/client-react`를 언제 나눌지 | (해결) | MVP부터 별도 패키지(§3.14, 판정 J-85와 같은 원칙). 26이 같은 패키지를 쓴다(26 §3.1) |
| Q-19 | `refreshing` 중 결정 허용 | (해결) | 허용(04 규칙 3, 판정 J-59). 21 §3.5.8이 같게 고쳤다 |
| Q-20 | 안전 모드의 사용자용 상태 | (해결) | `safeMode`(판정 J-60). 21 `ConnectionUiState`에 있다 |
| Q-21 | React Compiler | 1차부터 켬 / 끔 | 끔. 렌더 문제가 보이는 화면부터 켠다 |
| Q-22 | dotfiles `.stignore-dev`에 Cargo `target` 제외를 더할지 | 더함 / `CARGO_TARGET_DIR`만 | 사용자 확인 대기(판정 §5). 그동안 `CARGO_TARGET_DIR`로 우회한다(§3.12.1) |
| Q-23 | 기기 사이 알림 상한 | (해결) | 설정 하나(`attention.interruptsPerHour`, 14), 모든 기기 합. 기기별 상한은 두지 않는다(판정 J-171, §3.10.1 규칙 6) |
| Q-24 | 다른 기기에 남은 초안 알리기 | 알리지 않음 / `presence.report`에 보내지 않은 초안 수를 싣고 다른 기기 질문 카드에 "Mac에 쓰던 답 있음" 표시 | 1차는 알리지 않는다. 초안은 기기 로컬이다(§3.9.5). 다른 기기에서 답하면 이 기기의 초안은 `3008`로 "이미 처리됨"이 되고 쓰던 내용은 남는다(§3.9.7). 사용 중 불편이 보이면 19(`presence.report`에 개수 필드)·04·26과 함께 넣는다. 초안 내용은 보내지 않는다 |
| Q-25 | 협상 전달 구분 방법 | `question.delivered`에 `deliveryMode`를 싣고 앱이 설정으로 거름 / 11이 협상 전달의 `surface`에서 `os`를 뺌 | 앞의 것. 설정이 기기마다 다르기 때문이다(§3.10.1 규칙 5). 09·11이 받아들이기 전에는 `category`·`urgency`만으로는 구분할 수 없어 `notice`를 모두 띄운다 |

## 8. 출처

- 브리프: `docs/design/process/00-design-brief.md` 결정 10, 12, 14, 19~26, 29, 31~33, 36~38, §2.5, §3.1~§3.4.
- 2a단계: `docs/design/process/rulings-stage2a.md`(판정 §2, J-02, J-03, J-15, §5), 브리프 §2.4b 결정 41~46. 2a단계에 다시 읽은 문서: 03, 04 §3.0.4·§5.2, 05 §3.7·§3.8·§5.2·A7·A8, 06 §3.3·§3.4·§3.16, 07 §3.17, 16 §3.24.2·§5.2, 17 §5.2, 18 §3.6.2·§5.2, 19 §3.8.3·§3.9·§3.10·§3.14·§5.2, 21 §2.5.7·§3.5.8·§5.2. React 19 관련 버전은 2026-10-12 npm 레지스트리 조회(`npm view`)와 react-router 8.4.0 tarball로 확인했다 [검색].
- 4단계: 브리프 결정 47~51, 판정 J-104~J-148(특히 J-115, J-118, J-119, J-120, J-136, J-144), 4단계 보완 묶음(`.helm-design-work/coordinator/stage4/by-owner/P13.md`), 4단계 교차 요구(06 §5.4, 22 §5.2, 26 §5.2, 15 §5). 다시 읽은 문서: 09 §3.4 `question.delivered`, 17 §3.4.1·§3.15, 18 §3.7·§3.8, 19 §3.3.4·§3.10.2·§3.11·§3.14·§6.3, 21 §3.5, 26 §3.4·§3.5.2·§5.2. 플러그인 소스 [원문, 2026-10-12]: plugins-workspace v2 `plugins/store/src/store.rs`, `plugins/store/permissions/default.toml`, `plugins/log/permissions/default.toml`, `plugins/global-shortcut/guest-js/index.ts`.
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
| canon-3 §8 문서 20-4 | 메뉴바·트레이에 active-run 요약과 선택 필요 개수 | 반영. 값은 `tray` 뷰(19 §3.7.4 `TrayView`) | §3.10.2 |
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
| 발췌4 20-11 | ExternalStoreRuntime + 자체 스트림, AssistantTransport 미사용, React 18 | 반영. React는 결정 41로 19가 되었고 assistant-ui 0.15.28은 19를 받는다 | §3.9.10 |
| 발췌4 20-20 | 클라이언트 기기가 잠자기·오프라인이면 쓰기 실패 → 데몬 상주 배경 | 반영. 앱은 상태를 갖지 않고 잠자기 뒤 `ping` 확인과 재접속으로 이어 간다 | §3.8.8, F-03 |
| 발췌4 d25 | assistant-ui를 Tauri에서 쓸 때의 제약 | 답함. CSP 안에서 동작, 원격 자원 없는 부품만, 범위는 21 UI-D11 | 이 문서 §3.9.10 |
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
- 근거: 웹뷰 XSS가 있어도 토큰 값을 읽을 수 없고, 토큰은 저장된 경로로만 간다(§3.6.3). CSP `connect-src`에 원격 주소가 없다. 두 경로가 같은 코드로 같은 바이트를 보낸다(결정 38). 로컬 포트를 열지 않는다.
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
- 기각한 대안: 동시 시도(happy eyeballs), 연결 중 더 나은 경로로 옮기기(재전송 의미는 같지만 이유 없는 재접속이 생긴다), 경로마다 프로필 따로(같은 서버의 캐시가 둘로 나뉜다).
- 결과: 04 `SCR-CONNECT`의 "자동 전환" 확인란 기본값을 켬으로 둔다.

### ADR-20-04. 데스크톱 UI는 앱에 묶어 배포한다(모바일 PWA는 예외)

- 상태: 제안
- 맥락: 데몬이 SPA를 서빙하면 버전이 늘 맞지만, 원격 origin에 IPC 권한을 줘야 하고 오프라인 시작이 안 된다. 백엔드 조사는 "데몬이 같은 SPA를 웹으로도 서빙"을 제안했다.
- 결정: 데스크톱 SPA를 앱 번들에 넣고 데몬은 데스크톱 SPA를 서빙하지 않는다. 데몬이 서빙하는 모바일 PWA `/m/`은 이 결정의 예외다([결정 47], 26).
- 근거: 오프라인으로 시작해 캐시를 읽을 수 있다. 원격 콘텐츠와 로컬 권한을 섞지 않는다(canon-3 §6.10.1). 결정 19(웹 아님).
- 기각한 대안: 데몬 서빙(위 이유), 데스크톱도 PWA로(데스크톱 웹 클라이언트를 만드는 셈, [결정 19]).
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

- 상태: 제안. 결정 24 범위 안임은 판정 J-15로 확인됨. 키체인 확인 창은 시험 뒤 확정(§6.2 MC-07)
- 맥락: 결정 24로 Apple 공증·서명 배포는 범위 밖이다. Tauri는 서명 정체가 없으면 번들 서명을 건너뛴다. 키체인 항목 접근은 코드 서명 정체에 묶여 ad-hoc 빌드는 다시 빌드할 때마다 확인 창이 뜬다.
- 결정: 그 Mac의 로그인 키체인에 자체 서명 "코드 서명" 인증서를 한 번 만들고 `bundle.macOS.signingIdentity`로 쓴다. 없으면 ad-hoc(`"-"`).
- 근거: 같은 인증서로 서명하면 지정 요구 사항이 같아 확인 창이 다시 뜨지 않을 것으로 본다. 배포 서명이 아니므로 결정 24 범위 안이다.
- 기각한 대안: 서명 없음("손상됨" 오류), ad-hoc만(갱신마다 확인 창), 키체인 대신 파일 저장(토큰 보호 약화).
- 결과: Mac 설정에 인증서 만들기 한 단계가 생긴다(INSTALL.md).

### ADR-20-09. E2E는 브라우저에서 같은 SPA를 가짜 데몬에 붙여 하고, 셸은 스모크만 한다

- 상태: 제안
- 맥락: `tauri-driver`는 macOS를 지원하지 않는다. `@wdio/tauri-service`가 앱 안 WebDriver로 macOS를 지원하지만 OS UI(알림, 트레이, 딥 링크 등록)는 자동화할 수 없다.
- 결정: 시나리오 E2E(IT-01~20, 유즈케이스 화면 경로)는 Playwright(Chromium, WebKit)로 서버에서 돈다. 실제 셸은 `@wdio/tauri-service` 스모크(Mac, Windows)와 수동 체크리스트로 확인한다.
- 근거: 서버에서 매번 돌릴 수 있고 Mac이 잠들어도 막히지 않는다. 앱의 로직은 웹뷰 쪽에 있어 브라우저 대체 실행으로 대부분을 덮는다.
- 기각한 대안: 모든 E2E를 셸에서(느리고 Mac 의존), E2E 없음.
- 결과: `platform/browser/` 대체 구현을 유지해야 한다(배포 빌드에서는 빠진다).

