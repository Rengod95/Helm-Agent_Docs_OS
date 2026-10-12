# 19. 클라이언트 프로토콜

- 작성: 2026-10-11, P12(프로토콜)
- 상태: 1단계 초안. 01·03·04(P1·P2), 06(P3), 08·10(P5·P6), 12(P7), 14·16(P8·P10), 17(P11), 20·21(P13·P14)의 1단계 초안을 읽고 이름을 맞췄다. 09(P5), 11(P6), 18(P11)은 이 문서를 쓰는 동안 아직 없었다. 그 문서들이 소유하는 이름(이벤트 이름, 질문 전달 payload, 인증 세부)은 브리프 §3 공통 계약과 `<대상>.<과거형 동사>` 점 표기로 임시로 쓰고 §5.2에 요구로 적었다.
- 소유: 프로토콜 메서드 이름, 메시지 형식(envelope), 알림 이름, 오류 코드, 핸드셰이크, 구독·재전송 의미, 파일 전송 HTTP 규약, `@helm/protocol` 패키지 구조.
- 소유하지 않음: 이벤트 이름과 payload(09), 명령의 의미와 거부 규칙(10·11), 화면과 화면별 표시 데이터의 정의(03·04), 인증 자료의 암호 방식·페어링 정책·토큰 보관(18), 리스너 주소·소켓 경로·데몬 수명주기(17), 앱의 상태 저장소·라우팅·SSH 프로세스 관리(20), 런타임 어댑터 프로토콜(13).
- 출처 표기: "pi-api-facts-2 §3.2"는 `docs/design/process/sources/pi-api-facts-2.md` 3.2절, "S4 openclaw-gateway §1.5"는 `.helm-design-work/S4/openclaw-gateway.md` 1.5절, "발췌4 20-9"는 `docs/design/process/sources/conversation-extracts-4.md`의 항목 번호, "canon-2 §9.8"은 `sources/helm-canon-2.md` 9.8절, "v0.3 12 §9"는 `docs/v0.3/12-implementation-architecture.md` 9절이다.

## 1. 목적과 범위

### 1.1 목적

Helm 데몬(WSL2 서버에 상주, 결정 20·22)과 클라이언트(데스크톱 앱, 이후 TUI, 관리 CLI) 사이의 통신 규약을 정한다. 구현자가 이 문서만 보고 다음 세 가지를 만들 수 있어야 한다.

1. `@helm/protocol` 패키지: 메시지 스키마(TypeBox), 타입, 오류 표, 메서드·알림 등록 표, 적합성 테스트 도구(가짜 데몬·가짜 클라이언트).
2. 서버 쪽 프로토콜 계층(`@helm/daemon` 안): 리스너, 핸드셰이크, 연결 상태, 구독·재전송, 백프레셔, 멱등 처리 연결, HTTP 파일 전송.
3. 클라이언트 SDK(`@helm/client`, 06 §3.3.1): 데스크톱 앱(20)과 TUI가 같이 쓰는 연결 관리, 재접속, 구독 복원, 뷰 무효화 처리, 진행 중 명령 재전송.

### 1.2 다루는 것

- 전송: Tailscale serve를 거친 WSS, SSH 경로, 로컬 관리 경로. 어느 경로든 같은 메시지와 같은 재전송 의미.
- envelope: JSON-RPC 2.0 요청·응답·알림, 서버 → 클라이언트 알림 형식, 오류 객체와 오류 코드 전체 표.
- 핸드셰이크: 서버 챌린지, 클라이언트 `hello`, 서버 응답(선택된 버전, 정책, 기능 목록, 로그 위치, 재개 여부), 인증 전 제한.
- 이벤트 순서와 재전송: 전역 이벤트 로그 seq, 영속 이벤트와 휘발 스트림, `from` 위치부터 재전송, 범위를 벗어났을 때 스냅샷 경로, 구독과 스냅샷의 순서, gap 감지, 느린 소비자.
- 구독 모델: 이벤트 구독, 뷰(화면 투영) 구독, 휘발 스트림 구독, 필터, 해제, 연결당 상태.
- 메서드 전체 목록과 TypeScript 타입, 알림 전체 목록과 payload 타입.
- 멱등성, 요청 하나에 응답 하나 규칙, 생존 확인, 재접속 백오프, 파일 전송, 버전 관리, 스키마에서 타입·문서 생성, TUI 재사용, 적합성 테스트.

### 1.3 다루지 않는 것

| 주제 | 소유 문서 |
|---|---|
| 이벤트 envelope 정본, 이벤트 이름과 payload, seq 부여, 투영 테이블 | 09 |
| 명령의 의미, 검증 규칙, 거부 분류(내용·자격·경로)의 세부 코드 | 10, 11 |
| 레코드·엔티티 타입과 ID 접두사 확정 | 08 |
| 화면 목록·화면 ID(03), 화면별 표시 데이터의 필드(04) | 03, 04 |
| 화면 투영(뷰 모델)을 정본에서 만드는 규칙 | 12 |
| Tailscale 신원 확인 방식, 기기 토큰 형식·해시 저장, 페어링 정책, 서명 키, 위협 모델 | 18 |
| 리스너 포트·소켓 경로, `serve.table` 항목, systemd 단위, 데몬 모드(정상·읽기 전용·종료 중) 전이 | 17 |
| 앱 쪽 상태 저장소, SSH 프로세스·키 관리, 키체인, 딥 링크, OS 알림 표시 | 20 |
| 런타임 어댑터(pi RPC, ACP 등)와 데몬 사이 프로토콜 | 13 (canon C8: 클라이언트 계약과 어댑터 프로토콜은 분리하고 적합성 테스트도 따로 둔다) |
| 관찰 에이전트와 데몬 사이 IPC | 16 §3.2.3 |

### 1.4 이 문서에서 쓰는 말

| 말 | 뜻 |
|---|---|
| 연결 | WebSocket 연결 하나. 핸드셰이크를 마친 연결은 기기 하나(또는 로컬 관리자)로 인증된 상태를 가진다 |
| 리스너 | 데몬이 연결을 받는 곳. `tailnet`(TCP, Tailscale serve 전용), `loopback`(TCP, SSH 경로용), `local`(Unix 소켓, WSL 안의 TUI·CLI용) 세 종류다 |
| 영속 이벤트 | 정본 이벤트 로그(09)에 seq와 함께 기록된 이벤트. 재전송 대상이다 |
| 휘발 스트림 | 로그에 남지 않는 실시간 조각(토큰 단위 텍스트, 도구 출력 조각, 진행 표시). seq가 없고 버려도 정본이 손상되지 않는다 |
| 위치(position) | 이벤트 구독이 "여기까지는 빠짐없이 보냈다"고 보장하는 전역 seq 값 |
| 저장소 ID(`storeId`) | 이벤트 저장소의 정체. 저장소를 새로 만들거나 백업에서 복원해 seq 연속성이 끊기면 바뀐다(20 §1.4와 같은 이름) |
| 뷰 | 데몬이 정본을 읽어 만든 화면 투영(결정 13의 "투영"). 클라이언트는 `view.get`으로 받아 캐시하고, 이벤트에 실린 무효화 태그로 낡은 것을 다시 받는다 |
| 무효화 태그 | 뷰가 기대는 대상(레코드 ID 또는 `@inbox` 같은 집계 이름). 뷰 응답의 `dependsOn`과 이벤트의 `invalidates`에 실린다. 둘이 겹치면 그 뷰는 낡은 것이다 |
| 기준 seq(`basisSeq`) | 사람이 결정을 내릴 때 본 화면이 몇 번 seq 기준이었는지. 프로토콜 계층이 이것으로 대상 레코드의 revision 기대값(10의 `expect`)을 만들어, 낡은 화면에서 내린 결정을 커널이 거부할 수 있게 한다(§3.9.3) |
| 멱등 키(`idempotencyKey`) | 클라이언트가 사용자 의도 하나에 붙이는 키. 재시도·재접속 뒤 다시 보내도 한 번만 적용된다 |
| 티켓 | HTTP 다운로드 URL에 넣는 짧은 수명의 무작위 값. 헤더를 붙일 수 없는 곳에서만 쓴다. 기기 토큰과 별개다 |

### 1.5 관련 유즈케이스

| 유즈케이스 | 이 문서에서 쓰는 곳 |
|---|---|
| UC-03 여러 날 걸리는 작업 | 클라이언트 없이 쌓인 이벤트를 재접속 때 `from` 위치부터 받는다(§3.5). 범위를 넘으면 스냅샷 경로(§3.5.5) |
| UC-04 외부에서 접속해 질문에 답하기 | 전송 두 경로(§3.2), 핸드셰이크(§3.4), `inbox` 뷰 구독, `question.answer`(§3.7.5). 시퀀스는 §3.16.1 |
| UC-05 혼자 정한 결정 확인과 이의 | `autonomous` 뷰, `autonomous.markSeen`, `contest.file` |
| UC-06 복귀 요약 | `brief` 뷰, `brief.acknowledge`(사용자별 마지막 확인 위치) |
| UC-01 취향형 작업의 원함 탐구 | `stimulusRound` 뷰, 이미지 자극의 HTTP 다운로드(§3.11), `reaction.record`, `stimulusRound.close` |
| UC-07 되돌리기 비싼 선택(C와 A) | `agreement.*`, `result.*` 명령과 `basisSeq` |
| UC-08 반복 마찰 제안 | `observerProposals` 뷰, `observerProposal.*` 명령 |
| UC-09 Goal 정제 | `goal.revise`, `goal.confirmRevision`·`goal.rejectRevision`, `goal` 뷰 |
| UC-02 원인 조사 | `inquiry`·`evidenceChain` 뷰, `inquiry.*` 명령 |

## 2. 전제와 결정

### 2.1 브리프 결정에서 오는 전제

브리프 결정 26~37은 조정자가 정한 기본값이다(브리프 §2.3). 아래에서 [결정]으로 적은 것은 브리프 §2의 번호를 근거로 적을 수 있는 것이고, 26~37에서 벗어나려면 ADR이 필요하다.

| 결정 | 이 문서에 미치는 것 |
|---|---|
| 14 커널 원칙 | 사람의 결정은 모델 도구 경로를 거치지 않고 이 프로토콜의 명령 메서드로만 들어온다(발췌4 20-9). 모델이 고친 내용은 커널에 제안으로 가고, 받아들여진 것만 스트림으로 화면에 돌아온다(발췌4 20-10). 프로토콜에는 "도구 결과를 클라이언트가 채우는" 메서드가 없다 |
| 19, 32 | 데스크톱 앱이 첫 클라이언트다. 앱에는 Helm 로직이 없다. 그래서 화면 투영은 데몬이 만들어 보내고, 어느 이벤트가 어느 화면을 낡게 하는지도 데몬이 태그로 계산해 보낸다(§3.6.3). 클라이언트는 태그 교집합만 본다 |
| 21, 26 | 외부 접속은 Windows 호스트의 `tailscale serve`(HTTPS/WSS)로 한다. 데몬은 WSL 안 127.0.0.1에만 바인딩한다. Funnel은 쓰지 않는다 |
| 22 | 클라이언트가 없어도 작업이 계속된다. 그래서 끊긴 동안의 이벤트를 다시 받는 재전송이 필요하다 |
| 29 | 기준 원본은 SQLite 이벤트 로그다. 재전송 위치는 이 로그의 seq를 그대로 쓴다 |
| 31 | JSON-RPC 2.0 over WebSocket, 단조 seq, `lastSeq`부터 재전송, 큰 데이터는 HTTP |
| 33, 39 | TUI는 SSH로 WSL에 들어가 pi-tui 기반 Helm TUI를 실행한다. TUI는 WSL 안에서 로컬 리스너에 붙는다. 데스크톱 앱과 같은 클라이언트 코어를 쓴다 |
| 36 | TypeScript 5.x strict, ESM, Node 22(pi 패키지 기준 22.19 이상, pi-api-facts-2 §0-6), Vitest, 스키마는 TypeBox |
| 38 | 데스크톱 앱은 WSS와 SSH 두 경로로 접속한다. 두 경로에서 메시지와 재전송 의미가 같아야 한다. SSH 경로의 구체 방식과 인증은 P11·P12·P13이 정하고 ADR로 남긴다(이 문서의 몫은 §3.2.3과 ADR 후보 19-A1·19-A2) |
| 37 | 프로토콜의 사람이 읽는 오류 `message`는 개발자용 영어로 두고, 화면 문구는 오류 `kind`에서 05·21이 한국어로 만든다(§3.3.3) |

### 2.2 운영 환경 사실 (브리프 §2.5)

- Tailscale은 Windows 호스트에만 있다. `tailscale serve`는 서비스별 포트(8443~8447 사용 중)를 127.0.0.1의 서비스로 넘긴다. 새 서비스는 `serve.table`에 한 줄을 더한다(17이 항목을 정한다).
- WSL은 `networkingMode=mirrored`다. 그래서 WSL 안의 127.0.0.1 TCP 포트는 Windows 호스트의 다른 프로세스에서도 열 수 있다 [원문: 06 §3.6이 인용한 homelab `context/network.md`, 17 §2.2]. Unix 소켓은 WSL 안의 같은 사용자 프로세스만 열 수 있다. 그래서 TCP 리스너는 기기 토큰 없이는 아무것도 허용하지 않고, `localAdmin`은 Unix 소켓에서만 받는다(§3.2.1).
- WSL OpenSSH는 22번, tailnet에서만, 키 인증만 받는다. Tailscale SSH는 쓰지 않는다.
- 런타임 데이터는 `/srv/volumes/helm/`(동기화 밖)에 둔다. 소켓 경로도 동기화 폴더 밖이다(17).

### 2.3 이 문서의 주요 설계 결정

| 번호 | 내용 | 표시·근거 |
|---|---|---|
| P-01 | 데몬 리스너는 셋이다. `tailnet`(127.0.0.1 TCP, Tailscale serve만 이 포트로 넘긴다), `loopback`(127.0.0.1의 다른 TCP 포트, SSH 경로용), `local`(Unix 소켓 0600, WSL 안의 TUI·CLI용). 세 리스너는 같은 HTTP + WebSocket 스택을 쓰고 전송 조건과 받는 인증 방식만 다르다 | [제안]. serve 전용 리스너 분리는 OpenClaw와 같은 이유다(S4 openclaw-gateway §2.5, pi-cases-notes §12.1-7) |
| P-02 | SSH 경로는 시스템 OpenSSH의 `ssh -W 127.0.0.1:<loopback 포트>`로 표준 입출력을 데몬 `loopback` 리스너에 잇고, 그 바이트 스트림 위에서 WSS 경로와 같은 HTTP + WebSocket을 그대로 쓴다. 별도 프레임 형식을 정의하지 않는다 | [제안], 결정 38. 20 APP-D03과 같은 선택. 비교는 §3.2.3, ADR 후보 19-A1 |
| P-03 | 기기 인증은 모든 경로에서 같다. 기기 토큰은 WebSocket 업그레이드 요청의 `Authorization: Bearer` 헤더로 보내고(데스크톱은 Rust가 붙인다, 20 APP-D02), 데몬은 `hello`를 받을 때 판정해 결과를 `hello` 응답으로 돌려준다. SSH 키와 Tailscale 신원은 전송 계층의 추가 조건이다. `localAdmin`은 `local` 리스너에서만 받는다 | [제안], 최종은 18. "hello 안에서 인증, 실패하면 거절 응답"은 Paseo 방식(pi-cases-notes §12.1-7). ADR 후보 19-A2 |
| P-04 | envelope는 JSON-RPC 2.0이다. 요청 `id`는 문자열, `params`·`result`는 항상 객체, 배치(배열)는 쓰지 않는다. 서버가 클라이언트에 요청을 보내는 일은 없다(서버 → 클라이언트는 알림만) | [결정 31] + 세부 [제안] |
| P-05 | 재전송 위치는 09의 전역 이벤트 로그 seq를 그대로 쓴다. 저장소 정체 `storeId`를 함께 둔다. 사례 8곳 중 데몬 재시작을 넘는 네트워크 재전송 구현은 없으므로 재전송 규칙은 이 문서가 직접 정한다 | [결정 29·31] + `storeId` [제안](Paseo `{epoch, seq}` 커서, pi-cases-notes §1-1·§11.2) |
| P-06 | 이벤트 구독은 `{from, to}` 구간 계약을 쓴다. 알림 하나가 `(from, to]` 구간의 필터에 맞는 이벤트를 빠짐없이 담는다. 클라이언트는 `from`이 자기 위치와 같은지로 gap을 찾는다 | [제안]. Chord `ReplicatedStateSource`의 커서 계약(pi-api-facts-2 §6.2)을 필터 구독에 맞게 고침 |
| P-07 | 화면 투영은 `view.get`으로 받는다. 응답에 `asOfSeq`와 무효화 태그 `dependsOn`을 싣고, 영속 이벤트마다 데몬이 계산한 `invalidates` 태그를 싣는다. 클라이언트는 열린 뷰의 `dependsOn`과 겹치면 `minSeq`를 붙여 다시 받는다. 뷰는 재접속 때 다시 받고 `from` 재전송은 이벤트에만 적용한다 | [제안]. 결정 32(앱에 로직 없음)와 20 APP-D01·AS-1에 맞춤. 스냅샷 + 패치 방식은 기각(ADR 후보 19-A4) |
| P-08 | 휘발 스트림은 별도 알림(`stream.chunk`)으로 보내고 seq를 붙이지 않는다. 실행(run)마다 조각 번호 `n`과 텍스트 `offset`을 붙여 유실과 중복을 알 수 있게 하고, 유실되면 `run.partial`로 현재 조각 상태를 다시 받는다 | [제안]. pi-cases-notes §12.1-6. happy-agent가 델타를 커서 공간에 섞어 재접속 범위를 줄인 문제를 피한다 |
| P-09 | 명령은 domain action마다 메서드 하나를 둔다(generic `execute` 없음). 모든 명령은 `idempotencyKey`(`ik_<ULID>`)가 필수다. 모든 명령은 `basisSeq`(화면 기준 seq)도 필수이고, 프로토콜 계층이 이것으로 10의 `expect`(대상 레코드 revision, 10 §3.3.4)를 만든다 | [제안]. canon-3 §6.10.1, canon-2 L14, 10 §3.3.4, 20 APP-D09, 21 UI-D02 |
| P-10 | 요청 하나에 응답 하나. 오래 걸리는 일은 `accepted`로 바로 답하고 진행은 이벤트로 알린다 | [제안] |
| P-11 | 느린 소비자는 휘발 스트림부터 버리고, 그래도 넘치면 연결을 닫는다. 영속 이벤트는 몰래 버리지 않는다. 클라이언트는 재접속해 자기 위치부터 다시 받는다 | [제안]. S4 openclaw-gateway §1.5, paseo §3, happy-agent 조사 §7 |
| P-12 | 생존 확인은 WebSocket ping(서버가 보냄)과 앱 수준 `tick` 알림을 함께 쓴다. 클라이언트는 `tick`을 기준으로 감시 타이머를 둔다 | [제안]. happy-agent에는 클라이언트 쪽 무응답 감지가 없다(happy-agent 조사 §6). 웹뷰 JavaScript는 WebSocket ping을 볼 수 없다 [지식] |
| P-13 | 큰 데이터는 같은 리스너의 HTTP로 주고받는다. 업로드는 원시 바이트(청크 이어 올리기 가능) → 1회용 `blobId`, 다운로드는 기기 토큰 헤더 또는 WebSocket 연결에 묶인 5분 티켓 + Range. WebSocket 메시지에 base64 파일을 싣지 않는다 | [결정 31] + 세부 [제안](pi-cases-notes §12.1-8: happy-agent 업로드, openclaw 티켓, pi-web id 참조) |
| P-14 | 프로토콜 버전은 정수 하나(`1`부터). 추가 변경은 버전을 올리지 않고 기능 목록으로 알린다. 서버는 현재 버전과 직전 버전을 받는다 | [제안]. S4 openclaw-gateway §1.2, paseo §3, happy-agent §8 |
| P-15 | 스키마 원본은 `@helm/protocol`의 TypeBox 정의와 메서드 등록 표 하나다. TS 타입, JSON Schema, 참조 문서, 서버 디스패처 표, 적합성 테스트가 모두 이 표에서 나온다 | [제안]. OpenClaw `CORE_GATEWAY_METHOD_SPECS`(S4 openclaw-gateway §1.4). 문서와 코드가 어긋난 사례(happy-agent `EVENTS.md`, pi-cases-notes §12.2-11)를 피한다 |

### 2.4 원천 체크리스트 반영표

0단계 원천 정리의 체크리스트·끝 목록에서 19에 배정된 항목과 그 처리다.

| 원천 항목 | 처리 | 위치 |
|---|---|---|
| canon-2 §11/19: 실행 후보 protocol 5 method와 handshake 필드(protocolVersion, schemas, methods, invariants 4개) → JSON-RPC 메서드로 대응 | 반영. `helm.handshake` → `hello`, `helm.command.submit` → domain 명령 메서드들, `helm.observation.submit` → 클라이언트 프로토콜에 두지 않음(관찰은 런타임·어댑터 경로, 13), `helm.query.brief`·`helm.query.workspace` → `view.get`의 `brief`·`home` 뷰. `schemas`·`methods`는 `hello` 결과의 `features`로, `invariants`는 적합성 테스트 항목으로 옮겼다 | §3.4.4, §3.7, §6.3 |
| canon-2 §11/19: write result 형태와 결과 코드 카탈로그를 오류 코드 체계로 | 반영. 결과 코드 계층(`invalid.*`, `policy.*`, `gate.*`, `conflict.*`, `denied.*`, `not_found.*`)을 오류 코드와 `data.details.reason`으로 대응 | §3.3.4 |
| canon-2 §11/19: delivery semantics(at-least-once + idempotent inbox, control ack/timeout, 단절은 안전 저하) | 반영. 클라이언트 → 서버 명령은 at-least-once 재시도 + 서버 멱등 처리, 요청마다 응답과 시간 제한, 연결이 끊기면 권한이 넓어지지 않고 결정 동작이 막힌다 | §3.9, §3.10, §4 |
| canon-2 §11/19: outbox sequence 재개 → lastSeq 재전송 | 반영. 실행 후보의 `readOutbox({afterSequence})`를 이벤트 구독의 `from`으로 바꿨다. 클라이언트마다 outbox 행을 두지 않고 정본 로그를 seq 범위로 읽는다 | §3.5.4 |
| canon-2 §11/19: SSE 무효화(experimental.v0) 대신 seq 이벤트 스트림 | 반영. 이벤트 본문을 seq와 함께 보내고 재전송한다. 화면 투영의 낡음 표시는 이벤트에 실린 무효화 태그로 하되, 태그가 붙은 이벤트 자체가 seq 스트림 안에 있으므로 끊긴 동안의 무효화도 재전송으로 복원된다(experimental.v0의 SSE 무효화는 재전송이 없었다) | §3.5, §3.6 |
| canon-2 §11/19: provenance(adapterId, externalRunId, sourceRefs, sourceHash)와 client 이름(`x-helm-client`) | 반영. 사람 명령의 provenance는 서버가 연결 정보(기기 ID, 클라이언트 종류·버전, 연결 ID)로 채운다. 클라이언트가 provenance를 자기 신고하지 않는다. `x-helm-client` 헤더 대신 `hello.client` | §3.4.3, §3.7.5 |
| canon-3 §10/19: 메서드는 generic `execute` 대신 domain action별로 | 반영(P-09) | §3.7.5 |
| canon-3 §10/19: 투영 응답에 source cursor(lastSeq)와 freshness | 반영. 모든 뷰 응답에 `asOfSeq`, `generatedAt`, `freshness` | §3.6.3 |
| canon-3 §10/19: 알림 이벤트는 질문 전달 방식의 결과로만 보낸다(기록과 전달 분리) | 반영. 별도 푸시 채널을 두지 않는다. 앱의 OS 알림은 전달 결정이 기록된 영속 이벤트(11·09가 이름을 정한다)를 받았을 때만 띄운다 | §3.8.3 |
| canon §19: C8 client contract와 adapter protocol 분리, 독립 acceptance test | 반영. 이 문서는 클라이언트 계약만 다루고 적합성 테스트를 따로 둔다 | §1.3, §6.3 |
| canon §19: Return Brief는 마지막 확인 cursor 이후, projection은 Event cursor를 가진다. 사용자별 마지막 확인 cursor를 프로토콜에 둔다 | 반영. `brief.acknowledge { upToSeq }`. 기기별이 아니라 사람(소유자) 단위 | §3.7.5 |
| canon §19: Client는 domain validation이나 정본 state를 별도로 소유하지 않는다 | 반영. 서버가 params를 엄격히 검증하고, 클라이언트는 형식 검사만 한다. 클라이언트 저장소는 사본이다 | §3.12, §3.14 |
| canon §19: public API 이름은 Product Domain 이름 우선 | 반영. 메서드 이름은 08의 레코드 이름(Goal, Concern, question, agreement, result, choice)을 쓴다 | §3.7 |
| canon §19: 예외·막힘 상태 문구에 필요한 데이터(권한 부족 사유, 가능한 다음 행동) | 반영. 오류 `data.details`에 `reason`, `nextActions` | §3.3.3 |
| 발췌4 20-9: 사람의 결정은 모델 도구 경로를 거치지 않고 서버의 결정 명령으로 | 반영. assistant-ui 도구 카드 버튼도 명령 메서드를 부른다 | §3.7.5, §5.2(20·21) |
| 발췌4 20-10: 모델의 앱 상태 수정은 커널 제안으로, 받아들여진 것만 스트림으로 | 반영. 클라이언트에는 커밋된 이벤트와 그 투영만 간다. 클라이언트는 낙관적 도메인 갱신을 하지 않는다(21 UI-D03과 같다) | §3.5.9, §3.6 |
| 발췌4 20-11: ExternalStoreRuntime + 자체 WebSocket 스트림, AssistantTransport 미사용 | 반영. 대화는 `thread` 뷰 + 휘발 스트림으로 주고, `composer.submit`·`work.stop`이 `onNew`·`onCancel`에 대응한다 | §3.7.4, §3.7.5 |
| 발췌4 d24: SSH 경로가 pi CLI인지 Helm TUI인지 | 결정 33·39로 정해졌다(pi-tui 기반 Helm TUI). 이 문서는 TUI가 쓰는 연결(로컬 리스너)만 정한다 | §3.2.4, §3.14 |
| pi-api-facts-2 §6.1 대응표 전체 | 각 행을 반영했다. 전송 추상(리스너와 프로토콜 처리기 분리), strict JSON 검사와 한도, 첫 메시지 강제, 오류 정제, 취소, 스냅샷 전 갱신 버퍼, 연결 세대 ID, 연결별 송신 한도, 정수 버전 | §3.2, §3.3, §3.4, §3.5, §3.15 |
| pi-api-facts-2 §6.2: Chord delta를 투영 동기화에 쓸지 P12·P13 판단 | 쓰지 않는다. 투영은 다시 받기(무효화 태그)로 맞춘다. chord는 CHANGELOG가 없고 "not a stable public API contract yet"이다(pi-api-facts-2 §7.1). 패치 방식 일반을 기각한 이유는 ADR 후보 19-A4 | §3.6.3 |
| pi-api-facts-2 §8, §13: pi-env의 SSH stdio 프레임 프로토콜(동기화 줄, ping 5초, 무수신 30초 종료, 응답 우선 전송) | 비교에 썼다. 별도 프레임 형식은 채택하지 않았다(P-02: `ssh -W` stdio 위에 HTTP + WebSocket을 그대로 싣는다). 동기화 줄은 예비 경로(`helm bridge`)에만 쓴다. 생존 확인 간격과 "응답·ping을 대량 출력보다 먼저 보낸다"는 송신 우선순위는 §3.5.8·§3.10에 가져왔다 | §3.2.3 |
| pi-cases-notes §12.1-5: 재접속 순서(구독 → hello(seq, gap, 데몬 세대) → 재생 → 재생 중 쌓인 것 중 재생 끝보다 큰 것만), 스냅샷은 읽기 전에 seq를 잡음, epoch 변경·보존 범위 초과 시 reset + 스냅샷, 종료 프레임 우선 전달 예외 | 반영. 연결 `hello`가 세대(`bootEpoch`, `storeId`)와 head를 알리고, `events.subscribe`가 등록 → 재생 → 보류분 필터 순서를 지킨다. 범위 밖이면 `replay.outOfRange` + 스냅샷 경로. 종료 프레임 예외는 필요 없다(영속 이벤트를 버리지 않으므로 gap이 정상 경로에서 생기지 않는다) | §3.4.4, §3.5.4~§3.5.6 |
| pi-cases-notes §12.1-6: 스트리밍 델타는 정본 로그에 넣지 않고 offset으로 중복·구멍에 안전하게 | 반영(P-08) | §3.6.4 |
| pi-cases-notes §12.1-7: hello 안에서 인증, 실패 시 거절. Tailscale 헤더는 serve 전용 리스너에서만, whois 대조, 기기 토큰을 대신하지 않음. nonce 서명 선택지. 서버는 토큰 해시만 | 반영(P-01, P-03). 서명과 해시 저장은 18에 요구로 넘김 | §3.4, §5.2 |
| pi-cases-notes §12.1-8: 업로드는 HTTP 원시 바이트 → 1회용 ID, 다운로드는 연결에 묶인 단기 티켓, WebSocket에는 ID만 | 반영(P-13) | §3.11 |
| pi-cases-notes §12 그 밖: 정수 버전 + 기능 광고 + `COMPAT` 태그, 메서드 표 한 곳, 소켓별 송신 상한 8 MiB, 버린 것은 gap으로 보이게 | 반영. 휘발 스트림을 버리면 `n`이 건너뛰어 클라이언트가 알 수 있다 | §3.12, §3.13, §3.5.8 |
| pi-cases-notes §12.2-1: 클라이언트용 seq를 메모리에만 두지 않는다 | 반영. seq는 정본 로그의 seq다. 데몬 재시작 뒤에도 같은 위치에서 이어 받는다 | §3.5.1 |
| pi-cases-notes §13.4-31: "lastSeq 재전송은 사례 없음" | 받아들였다. 브리프 입력 자료가 가정한 "Happy Agent 커서 방식 참고"(backend-oss-research §1.2)는 틀렸다(happy-agent 클라이언트 저널은 메모리 10,000개, 재시작마다 gap). 재전송은 이 문서가 직접 설계했고 적합성 테스트(§6.3 CT-06·CT-27)로 고정한다 | §3.5, §6.3 |
| pi-api-facts-2 §5.3: pi-client는 자동 재접속·재전송을 하지 않는다 | 클라이언트 코어가 재접속, 위치 보관, 구독 복원, 멱등 재전송을 직접 한다 | §3.10, §3.14 |

## 3. 명세 본문

### 3.1 계층 구조 [제안]

```text
클라이언트(데스크톱 앱 / TUI / 관리 CLI)
  └ @helm/client 클라이언트 코어(TS, 스키마는 @helm/protocol): 연결 상태 기계, hello, 재접속, 구독 복원, 뷰 무효화, 진행 중 명령 재전송
      └ Transport 인터페이스
          ├ 데스크톱: Tauri IPC 채널 ↔ Rust(WSS 또는 ssh -W 위의 WebSocket, 20 APP-D02)
          └ TUI·CLI·테스트: Node ws (TCP 또는 ws+unix)
              │  WebSocket 텍스트 메시지 1개 = JSON-RPC 메시지 1개, 파일은 HTTP
  ┌───────────┴─────────── 경로 ─────────────────────────────────────────────────────┐
  │ (a) WSS : 클라이언트 → tailnet → Windows `tailscale serve`(TLS) → 127.0.0.1:P_serve │
  │ (b) SSH : 클라이언트 `ssh -W 127.0.0.1:P_lo` → WSL sshd(direct-tcpip) → 127.0.0.1:P_lo│
  │ (c) 로컬: WSL 안의 TUI·CLI → Unix 소켓                                             │
  └───────────┬─────────────────────────────────────────────────────────────────────┘
데몬 (@helm/daemon)
  ├ 리스너: tailnet(TCP) / loopback(TCP) / local(Unix 소켓) ── 전송 조건 검사(18) 뒤 연결을 넘김
  ├ 연결 처리기: 챌린지, hello, 인증 판정(18의 검증 함수), 연결 상태, 송신 큐·백프레셔, tick
  ├ 디스패처: 메서드 등록 표로 params 검증 → scope 검사 → 처리기 → 응답
  ├ 구독 관리자: 이벤트 구독(로그 읽기·재전송·실시간), 휘발 스트림 구독
  ├ 뷰 처리기: view.get → 투영(12) 읽기, asOfSeq·dependsOn 붙이기
  ├ 명령 어댑터: 메서드 → 제출 envelope(10 §3.3) → 09 접수(멱등) → 커널 → 응답
  └ HTTP 파일 처리기: 업로드, Range 다운로드, 티켓
```

- 리스너는 바이트 스트림과 HTTP 요청을 받아 "전송 조건을 통과한 연결"만 연결 처리기에 넘긴다. 전송 조건(Tailscale 신원 헤더 확인, Host·Origin 검사, 소켓 권한)은 18이 정한다. 이 경계는 pi-server의 `ServerListener`와 같은 구조다(pi-api-facts-2 §4.2, `server/src/listener.ts:3-8`).
- 연결 처리기 위의 모든 것은 리스너 종류를 모른다. 리스너 종류는 연결 정보(`listener`)로만 전달되고, 인증 방식 허용 여부(§3.4.3)와 감사 기록에만 쓰인다. 그래서 세 경로의 메시지와 재전송 의미가 같다(결정 38).

### 3.2 전송

#### 3.2.1 리스너 [제안]

| 리스너 | 주소(번호와 경로는 17) | 받는 경로 | 전송 조건(18이 확정) | 받는 인증 방식(§3.4.3) |
|---|---|---|---|---|
| `tailnet` | `127.0.0.1:7840` TCP(17 D17-09). `tailscale serve`(Windows 쪽 8448, 17)의 대상으로만 쓴다(`serve.table` 한 줄) | (a) WSS | Tailscale 신원 헤더 확인(`tailscale whois` 대조 권장, S4 openclaw-gateway §2.5), Host·Origin 허용 목록 | `deviceToken` |
| `loopback` | `127.0.0.1:7841` TCP(17 D17-09, 이하 `<HELM_LOOPBACK_PORT>`). serve 대상이 아니다 | (b) SSH | Host·Origin 허용 목록. Tailscale 헤더를 요구하지 않는다(있으면 무시한다) | `deviceToken` |
| `local` | Unix 소켓 `/run/user/<uid>/helm/rpc.sock`(17 §3.5, 이하 `<HELM_SOCKET>`. 파일 0600, 디렉터리 0700) | (c) 로컬 | 소켓 파일 권한 | `deviceToken`, `localAdmin` |

- 세 리스너는 같은 HTTP 서버 코드를 쓴다(Node `http.Server` 인스턴스 셋, 같은 요청 처리기). 경로(§3.2.5)도 같다.
- `tailnet`과 `loopback`을 나누는 이유: serve를 거친 연결만 신원 헤더를 믿는 리스너로 들어오게 하기 위해서다. SSH로 온 연결이 serve 포트로 들어오면 헤더 없는 연결을 받아 주는 예외가 생긴다.
- mirrored 네트워킹에서 두 TCP 포트는 Windows 호스트 프로세스와 WSL의 모든 프로세스(에이전트 도구 프로세스 포함)가 열 수 있다. 그래서 TCP 리스너는 `hello`가 기기 토큰으로 성공하기 전에는 `hello` 외에 아무것도 처리하지 않는다(§3.4.5). 기기 토큰은 서버 디스크에 두지 않는다(18에 대한 요구).

#### 3.2.2 경로 (a): Tailscale serve를 거친 WSS [결정 21·26]

- 주소: `wss://<서버 MagicDNS 이름>:<serve 포트>/rpc`(예: `wss://server.<tailnet>.ts.net:<포트>/rpc`, 20 §2.2). TLS는 `tailscale serve`가 끝내고 데몬은 평문 HTTP/WebSocket을 받는다.
- 업그레이드 요청 헤더:
  - `Sec-WebSocket-Protocol: helm-jsonrpc` (없으면 HTTP 400으로 거절. 프로토콜 버전은 이 이름이 아니라 `hello`에서 정한다)
  - `Authorization: Bearer <기기 토큰>` (P-03. 판정은 `hello`에서 한다)
- 업그레이드 전 HTTP 단계에서 전송 조건이 실패하면 HTTP 401(신원 없음, `Authorization` 헤더 없음) 또는 403(허용되지 않는 Host·Origin·신원)으로 끝낸다. 클라이언트는 이 둘을 인증 계열 실패로 보고 자동 재접속을 멈춘다(§3.10.3, 20의 `http_unauthorized`).

#### 3.2.3 경로 (b): SSH [결정 38, 방식은 제안]

비교한 방식:

| 기준 | B1. `ssh -L` 로컬 포워딩 → 데몬 TCP | B2. `ssh -L` → 데몬 Unix 소켓 | **B3. `ssh -W` stdio → 데몬 loopback TCP** | B4. `ssh <서버> helm bridge` exec stdio → Unix 소켓 | B5. exec stdio + 별도 프레임(pi-env식) |
|---|---|---|---|---|---|
| 그 위의 바이트 | HTTP + WebSocket | HTTP + WebSocket | HTTP + WebSocket | HTTP + WebSocket | 길이 접두 프레임 + JSON-RPC |
| 파일 전송(HTTP) | 같은 포트 | 같은 소켓 | 요청마다 `ssh -W` 하나(ControlMaster로 재사용 가능) | 요청마다 브리지 프로세스 하나 | 불가. 두 번째 방식 필요 |
| 클라이언트 쪽 열린 포트 | 있음(루프백) | 있음(루프백) | 없음 | 없음 | 없음 |
| 서버 쪽 부품 | 없음 | 없음 | `loopback` 리스너 하나 | `helm bridge` 명령, 동기화 줄 | 브리지 + 코덱 + 파일 전송 대체 경로 |
| 셸 시작 파일 잡음(사용자 셸 zsh의 `~/.zshenv` 등) | 영향 없음 | 영향 없음 | 영향 없음(원격 명령을 실행하지 않는다) | 동기화 줄로 걸러야 함(pi-env `docs/protocol.md` "Sync") | 같음 |
| sshd 설정 의존 | `AllowTcpForwarding` | `AllowStreamLocalForwarding` | `AllowTcpForwarding`(기본 yes [지식]) | 없음 | 없음 |
| 데몬이 받는 연결 | TCP. serve 포트와 같으면 리스너 분리가 깨진다 | Unix 소켓 | TCP(`loopback` 리스너) | Unix 소켓 | Unix 소켓 |
| 선례 | Paseo `--host ssh://`(S4 paseo §4), OpenClaw macOS Remote | OpenSSH `-L port:/path`(`man ssh`, OpenSSH 9.6 [원문]) | 20 APP-D03 | pi-env 부트스트랩 | pi-env, pi-acp |

- `ssh -W`는 `host:port`만 받는다. Unix 소켓을 직접 가리킬 수 없다 [원문: `man ssh`, OpenSSH 9.6p1의 `-W host:port` 설명]. 그래서 B3은 TCP 리스너가 하나 더 필요하다.

결정 [제안]: **B3**. 20 APP-D03(Rust가 시스템 OpenSSH를 `ssh -W`로 띄우고 그 표준 입출력 위에서 WebSocket을 연다)과 같다. 근거:

1. WSS 경로와 HTTP 서버 코드, 프레이밍, 파일 전송이 모두 같다. 적합성 테스트(§6.3)를 리스너만 바꿔 그대로 돌리면 결정 38의 동등성을 확인할 수 있다.
2. 원격 명령을 실행하지 않으므로 셸 시작 파일의 출력이 바이트 스트림에 섞이지 않는다. B4·B5는 이 문제를 동기화 줄로 따로 풀어야 한다.
3. 클라이언트 쪽에 열린 포트가 없다(B1·B2와 다름). 연결 하나가 ssh 프로세스 하나라 수명 관리가 단순하다.
4. 데몬 쪽 추가 부품은 TCP 리스너 하나다. `loopback` 리스너는 기기 토큰만 받으므로 같은 호스트의 다른 프로세스가 열어도 토큰 없이는 아무것도 할 수 없다.

프레이밍(B3, 그리고 모든 경로 공통):

- `ssh -W`의 표준 입출력은 TCP 연결과 같은 바이트 스트림이다. 그 위의 형식은 HTTP/1.1(RFC 9112)과 WebSocket(RFC 6455)이다. 별도 길이 접두 프레임을 두지 않는다.
- WebSocket 텍스트 메시지 하나에 JSON-RPC 메시지 하나를 싣는다(UTF-8, BOM 없음). 바이너리 메시지는 쓰지 않는다. 받으면 닫는 코드 1003으로 닫는다.
- 조각난(fragmented) WebSocket 메시지는 허용하되 합친 크기가 정책 한도(§3.4.4 `policy.maxInboundMessageBytes`)를 넘으면 1009로 닫는다.
- 클라이언트 → 서버 WebSocket 프레임은 RFC 6455대로 마스킹한다. SSH 위라도 생략하지 않는다(서버는 마스킹되지 않은 클라이언트 프레임을 1002로 닫는다).
- `permessage-deflate`는 협상하지 않는다. OpenClaw가 같은 선택을 했다(브라우저 쪽 압축 해제가 메시지를 직렬로 늦춘다, S4 openclaw-gateway §1.1). 큰 데이터는 HTTP로 보내므로 압축 이득이 작다.
- HTTP 업그레이드 요청의 `Host` 헤더는 `127.0.0.1:<HELM_LOOPBACK_PORT>`로 보낸다. `loopback` 리스너의 Host 허용 목록은 `127.0.0.1:<포트>`와 `localhost:<포트>`다.

SSH 경로의 클라이언트 절차(구현은 20 §3.8):

1. `ssh -T -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -W 127.0.0.1:<HELM_LOOPBACK_PORT> <별칭 또는 user@host>`를 띄운다(`-W`는 `-N -T ExitOnForwardFailure`를 함축한다 [원문: `man ssh`]). 호스트 키 정책은 20·18.
2. 표준 입출력 위에서 HTTP 업그레이드(`GET /rpc`, `Sec-WebSocket-Protocol`, `Authorization`)를 보낸다. 이후는 경로 (a)와 같다.
3. 파일 요청은 요청마다 `ssh -W`를 하나 더 띄워 HTTP/1.1 요청 하나를 보낸다(20 APP-D12). ssh 연결 비용은 사용자의 `ControlMaster` 설정이 있으면 줄어든다.
4. ssh 프로세스가 끝나면 WebSocket도 끝난 것으로 본다. 재접속은 1단계부터 다시 한다.

예비 경로 B4 [제안, 선택 구현]: 17·18이 sshd의 TCP 포워딩을 막기로 하면 `ssh <서버> <helm 경로> bridge`를 쓴다. 브리지는 stdout에 동기화 줄 `HELM-BRIDGE/1 <nonce>\n`을 먼저 쓰고(클라이언트는 이 줄 앞의 바이트를 버린다), 그 뒤로는 stdin·stdout과 `<HELM_SOCKET>` 사이에서 바이트를 그대로 옮긴다. 바이트 내용은 B3과 같은 HTTP + WebSocket이다. 이 경우 연결은 `local` 리스너로 들어가므로 `local` 리스너도 `deviceToken`을 받는다(§3.2.1 표와 같다).

#### 3.2.4 경로 (c): 로컬 관리 경로 [제안]

- WSL 안에서 실행하는 TUI(결정 33·39)와 관리 CLI(`@helm/cli`, 브리프 §3.1)는 `local` 리스너에 직접 붙는다. Node `ws`의 `ws+unix:` 주소를 쓴다(`ws+unix://<HELM_SOCKET>:/rpc`) [지식].
- 인증은 `localAdmin` 또는 `deviceToken`이다(§3.4.3). `localAdmin`은 "이 소켓을 열 수 있는 WSL 사용자"라는 사실만으로 인정한다. TUI를 기기로 따로 페어링하면 `deviceToken`도 쓸 수 있으나, 토큰을 WSL 디스크에 두게 되므로 기본은 `localAdmin`이다.
- 보안 전제(13·18에 대한 요구, §5.2): 에이전트가 실행하는 도구 프로세스(bash 등)는 `<HELM_SOCKET>`을 열 수 없어야 한다. 그렇지 않으면 모델이 도구로 소켓에 붙어 사람 명령(결과 확인 등)을 보낼 수 있어 결정 14와 불변조건이 깨진다. 소켓 파일 권한만으로는 같은 사용자 프로세스를 막지 못한다(Paseo도 같은 한계를 문서에 적었다, S4 paseo §4 `SECURITY.md:53`). 도구 프로세스를 다른 uid로 돌리거나 소켓 디렉터리가 보이지 않는 격리 안에서 돌려야 한다.

#### 3.2.5 HTTP 경로 목록 [제안]

세 리스너가 같은 경로를 쓴다.

| 메서드·경로 | 용도 | 인증 | 절 |
|---|---|---|---|
| `GET /rpc` (Upgrade: websocket) | JSON-RPC 연결 | 전송 조건 + `hello` | §3.4 |
| `GET /healthz` | 연결 진단. 본문과 HTTP 코드는 17 §3.11.3(`{"status": …}` 하나, 버전·기기 정보 없음) | 전송 조건만 | §3.10 |
| `POST /pair` | 페어링 코드로 기기 토큰 발급(WSS 경로, 20 `pairing_with_code`) | 페어링 코드(본문) | §3.7.7 |
| `POST /files/u`, `HEAD /files/u/<uploadId>`, `PATCH /files/u/<uploadId>` | 업로드(한 번에, 또는 청크 이어 올리기) | `Authorization: Bearer <기기 토큰>` | §3.11.3 |
| `GET /files/b/<blobId>` | 다운로드(Range 지원) | `Authorization: Bearer <기기 토큰>` | §3.11.2 |
| `GET /files/t/<ticket>` | 티켓 다운로드(Range 지원). 헤더를 붙일 수 없는 곳용 | 티켓(경로) | §3.11.2 |

- 모든 HTTP 응답에 `Cache-Control: no-store`(파일 응답은 `private, max-age=0`과 `ETag`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`를 붙인다(experimental.v0 서버의 기본값, canon-2 §8.4·§8.7).
- 위 표에 없는 경로는 404다. 정적 파일은 서빙하지 않는다(데스크톱 앱은 자기 번들을 쓴다, 20 APP-D06).
- 데스크톱 앱은 데몬과 같은 출처가 아니다. Rust가 요청을 보내므로 CORS 응답 헤더는 두지 않는다(20 §3.1: 웹뷰는 데몬에 직접 연결하지 않는다).

#### 3.2.6 WebSocket 닫는 코드

| 코드 | 보내는 쪽 | 뜻 | 클라이언트 동작 |
|---|---|---|---|
| 1000 | 양쪽 | 정상 종료(클라이언트 `dispose`, 서버의 정상 연결 정리) | 사용자가 닫은 경우만 재접속하지 않는다 |
| 1001 | 서버 | 데몬 종료·재시작(`server.shutdown` 알림 뒤) | 백오프 재접속. `restartExpectedMs`를 하한으로 쓴다 |
| 1002 | 서버 | JSON-RPC 이전 단계의 프로토콜 위반(마스킹 없는 프레임 등) | `needsUser`(버그 보고 대상) |
| 1003 | 서버 | 바이너리 메시지 수신 | `needsUser` |
| 1008 | 서버 | 정책 위반: 인증 실패, 폐기된 기기, 인증 전 제한 위반 | 닫기 직전에 받은 오류의 `kind`로 판단. 없으면 `needsUser` |
| 1009 | 양쪽 | 메시지가 크기 한도를 넘음 | 백오프 재접속(같은 요청을 다시 보내지 않는다) |
| 1011 | 서버 | 내부 오류 | 백오프 재접속 |
| 4000 | 클라이언트 | `tick` 감시 시간 초과 | 백오프 재접속 |
| 4001 | 서버 | 핸드셰이크 시간 초과 | 백오프 재접속 |
| 4008 | 서버 | 느린 소비자(§3.5.8) | 바로 재접속(첫 대기 0), 위치부터 재전송 |
| 4009 | 서버 | 연결 강제 종료(`connection.close`, 기기 폐기 직후) | 폐기면 `needsUser`, 아니면 백오프 |

### 3.3 Envelope

#### 3.3.1 JSON-RPC 2.0 규칙 [결정 31, 세부 제안]

- 모든 메시지에 `"jsonrpc": "2.0"`이 있다.
- 요청: `{ jsonrpc, id, method, params }`. `id`는 문자열이다(1~64자, `[A-Za-z0-9._:-]`). 숫자·`null` id는 `-32600`. 클라이언트 코어는 연결마다 `r1`, `r2`, …를 쓴다. 같은 연결에서 아직 응답하지 않은 `id`를 다시 쓰면 `-32600`(pi-server `server.ts:307-315`와 같은 규칙).
- `params`는 항상 객체다(이름 기반). 배열 `params`는 `-32602`. 파라미터가 없는 메서드도 `{}`를 보낸다.
- 응답: `{ jsonrpc, id, result }` 또는 `{ jsonrpc, id, error }`. `result`는 항상 객체다. 원시값을 결과로 쓰지 않는다(필드 추가로 진화하기 위해).
- 알림: `{ jsonrpc, method, params }` (`id` 없음). 서버 → 클라이언트 메시지 중 응답이 아닌 것은 모두 알림이다. 클라이언트 → 서버 알림은 `$/cancelRequest`와 `presence.report` 둘이다(응답이 필요 없는 것).
- 배치(배열 메시지)는 받지 않는다. 받으면 `-32600` 응답 하나(`id: null`)를 보내고, 인증 전이면 연결을 닫는다. 근거: 배치는 응답 순서와 백프레셔를 복잡하게 하고 얻는 것이 적다.
- 서버는 클라이언트에 요청을 보내지 않는다. 사람에게 묻는 일은 질문 레코드(11)와 그것을 보여 주는 뷰로 한다.
- 메서드 이름 규칙: `<영역>.<동사>` 소문자 낙타 표기(예: `question.answer`, `events.subscribe`). `$/` 접두는 프로토콜 제어용으로 예약한다. 알림 이름도 같은 규칙이다.
- JSON 값 규칙: strict JSON만 쓴다(NaN, Infinity 없음). 정수는 JavaScript 안전 정수 범위 안이다. 시각은 ISO 8601 UTC 문자열(`2026-10-11T13:05:22.123Z`, 브리프 §3.3). seq는 정수다.
- 중첩 깊이 64, 배열 길이 10,000을 넘는 메시지는 `-32600`이다(pi-protocol 한도 1,000,000·64를 줄여 씀, pi-api-facts-2 §3.2).

TypeBox 정의(원본은 `packages/protocol/src/jsonrpc.ts`):

```ts
import { Type, type Static } from "typebox"; // 07이 고정하는 typebox 1.x [가정: import 형태는 07이 확인]

export const RequestId = Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9._:-]+$" });

export const JsonRpcRequest = Type.Object({
  jsonrpc: Type.Literal("2.0"),
  id: RequestId,
  method: Type.String({ minLength: 1, maxLength: 96 }),
  params: Type.Record(Type.String(), Type.Unknown()),
}, { additionalProperties: false });

export const JsonRpcNotification = Type.Object({
  jsonrpc: Type.Literal("2.0"),
  method: Type.String({ minLength: 1, maxLength: 96 }),
  params: Type.Record(Type.String(), Type.Unknown()),
}, { additionalProperties: false });

export const HelmErrorData = Type.Object({
  kind: Type.String(),                                  // 오류 표(§3.3.4)의 kind
  retryable: Type.Boolean(),
  retryAfterMs: Type.Optional(Type.Integer({ minimum: 0 })),
  details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  traceId: Type.Optional(Type.String()),                // 데몬 로그와 맞춰 보기용
});

export const JsonRpcError = Type.Object({
  code: Type.Integer(),
  message: Type.String(),                               // 개발자용 영어 한 줄. 화면에 그대로 쓰지 않는다
  data: HelmErrorData,
});

export const JsonRpcSuccess = Type.Object({
  jsonrpc: Type.Literal("2.0"),
  id: RequestId,
  result: Type.Record(Type.String(), Type.Unknown()),
}, { additionalProperties: false });

export const JsonRpcFailure = Type.Object({
  jsonrpc: Type.Literal("2.0"),
  id: Type.Union([RequestId, Type.Null()]),             // null은 id를 읽을 수 없었을 때만
  error: JsonRpcError,
}, { additionalProperties: false });

export type JsonRpcRequest = Static<typeof JsonRpcRequest>;
export type JsonRpcNotification = Static<typeof JsonRpcNotification>;
export type HelmErrorData = Static<typeof HelmErrorData>;
```

- envelope 검사는 `additionalProperties: false`로 엄격하게 한다(pi-protocol과 같은 방식, pi-api-facts-2 §3.3). `params` 안의 검사는 메서드 등록 표의 스키마가 한다(§3.13).

#### 3.3.2 서버 → 클라이언트 알림 형식

모든 서버 알림은 JSON-RPC 알림이고, `params`에 알림별 객체를 담는다. 알림 목록과 payload는 §3.8에 있다. 공통 규칙:

- 한 연결 안에서 서버가 보낸 메시지(응답과 알림)는 보낸 순서대로 도착한다(WebSocket·TCP 순서 보장). 프로토콜은 이 순서를 계약으로 쓴다(§3.5.9).
- 구독에서 나온 알림은 `params.sub`에 구독 ID를 담는다. 클라이언트는 모르는 구독 ID의 알림을 버린다(해제 직후 경합).
- 클라이언트는 모르는 알림 이름을 무시하고, 아는 알림의 모르는 필드도 무시한다(§3.12).

#### 3.3.3 오류 객체

```ts
interface JsonRpcError {
  code: number;          // §3.3.4 표의 정수
  message: string;       // 개발자용 영어. 내부 정보(경로, 스택, SQL)를 넣지 않는다
  data: {
    kind: string;        // 표의 이름. 클라이언트 분기는 code 또는 kind로 한다
    retryable: boolean;  // 같은 요청을 (같은 멱등 키로) 다시 보내도 되는가
    retryAfterMs?: number; // 다시 보내기 전 최소 대기. 재접속 백오프의 하한으로도 쓴다
    details?: {
      reason?: string;            // 커널 거부 코드 등 하위 이유(10의 카탈로그 이름)
      nextActions?: NextAction[]; // 사용자가 할 수 있는 다음 행동(화면 문구 재료)
      [k: string]: unknown;       // kind별 필드(표의 details 열)
    };
    traceId?: string;
  };
}

interface NextAction {
  action: string;        // 메서드 이름 또는 화면 이동 의도. 예: "view.get", "question.answer", "open:SCR-CONNECT"
  label?: string;        // 서버가 줄 수 있으면 한국어 짧은 문구(결정 37). 없으면 05가 kind로 만든다
  params?: Record<string, unknown>;
}
```

- 알 수 없는 예외는 `-32603 internal`로 바꾸고 `message`를 `"Internal error"`로 둔다. 원인은 데몬 로그에만 남기고 `traceId`로 연결한다(pi-server `server.ts:512-521`의 오류 정제와 같은 원칙).
- 화면 문구는 `kind`와 `details`로 05·21이 만든다. `message`를 화면에 그대로 보이지 않는다.

#### 3.3.4 오류 코드 전체 표 [제안]

JSON-RPC 표준 코드는 표준 뜻 그대로 쓰고, Helm 코드는 1000~5999 양의 정수를 영역별로 나눈다. JSON-RPC 예약 범위(-32768~-32000)에는 표준 다섯 개만 쓴다.

| code | kind | retryable | 뜻 | details |
|---|---|---|---|---|
| -32700 | `jsonrpc.parseError` | false | JSON으로 읽을 수 없다 | - |
| -32600 | `jsonrpc.invalidRequest` | false | envelope 위반, 배치, id 형식 위반, 진행 중 id 재사용, 깊이·길이 한도 초과 | `issue` |
| -32601 | `jsonrpc.methodNotFound` | false | 모르는 메서드 또는 이 연결의 프로토콜 버전에 없는 메서드 | `method` |
| -32602 | `jsonrpc.invalidParams` | false | params 스키마 위반 | `issues: {path, message}[]` |
| -32603 | `internal` | true | 내부 오류(정제됨). 명령이면 같은 멱등 키로 다시 보내 결과를 확인한다 | - |
| 1001 | `handshake.required` | false | `hello` 전에 다른 메서드를 불렀다 | - |
| 1002 | `handshake.duplicate` | false | `hello`를 두 번 보냈다 | - |
| 1003 | `protocol.unsupported` | false | 공통 프로토콜 버전이 없다. 앱 또는 데몬 업데이트가 필요하다 | `serverMin`, `serverMax` |
| 1004 | `auth.failed` | false | 토큰 또는 증명이 맞지 않는다 | - |
| 1005 | `auth.revoked` | false | 폐기된 기기다 | `revokedAt` |
| 1006 | `auth.unknownDevice` | false | 페어링되지 않은 기기 ID다 | - |
| 1007 | `auth.challengeStale` | true | 챌린지 nonce 불일치, 서명 시각 허용 범위 밖. 다시 연결하면 새 챌린지를 받는다 | `serverTime` |
| 1008 | `auth.methodNotAllowed` | false | 이 리스너에서 받지 않는 인증 방식이다(예: TCP 리스너의 `localAdmin`), 또는 토큰의 기기와 `hello`의 기기 ID가 다르거나 전송 조건과 맞지 않는다(Tailscale 신원 불일치 등, 18) | `listener` |
| 1009 | `pairing.invalidCode` | false | 페어링 코드가 틀렸거나 만료·사용됨(`POST /pair` 응답 본문에도 같은 오류 객체를 쓴다) | `attemptsLeft` |
| 1010 | `scope.forbidden` | false | 연결에 그 메서드의 범위(scope)가 없다 | `required` |
| 1011 | `rateLimited` | true | 요청이 너무 잦다(인증 실패·페어링 시도 포함) | `retryAfterMs` 필수 |
| 2001 | `replay.outOfRange` | false | `from` 위치에서 재전송할 수 없다. 스냅샷 경로로 간다(§3.5.5) | `reason`: `storeMismatch` \| `beforeOldest` \| `tooFar` \| `aheadOfHead`, `storeId`, `headSeq`, `oldestReplayableSeq` |
| 2002 | `subscription.notFound` | false | 없는(이미 해제된) 구독 ID | `sub` |
| 2003 | `subscription.limit` | false | 연결당 구독 수 한도 초과 | `max` |
| 2004 | `view.unknown` | false | 모르는 뷰 이름 | `view` |
| 2005 | `view.targetNotFound` | false | 뷰 params가 가리키는 레코드가 없다 | `id` |
| 2006 | `view.notReady` | true | 투영이 요청한 `minSeq`에 아직 이르지 않았다 | `asOfSeq`, `minSeq` |
| 2007 | `filter.invalid` | false | 이벤트 필터가 잘못되었다 | `issue` |
| 2008 | `run.notFound` | false | 실행 ID가 없거나 이미 끝났다 | `runId` |
| 3001 | `command.rejected.content` | false | 커널이 내용 때문에 거부했다(10 §3.4.4의 `content.*`) | `reason`(10 코드), `ruleId`, `missing`, `nextActions`, `rejectionEventSeq?` |
| 3002 | `command.rejected.qualification` | false | 커널이 자격 때문에 거부했다(10의 `qualification.*`, `basis` A 또는 P) | `reason`, `basis`, `missing`, `nextActions` |
| 3003 | `command.rejected.path` | false | 커널이 경로 때문에 거부했다(10의 `path.*`). 프로토콜 계층이 채널을 고정하므로 정상 클라이언트에서는 나오지 않는다. 버그 보고 대상 | `reason` |
| 3004 | `command.revisionConflict` | false | `expect`의 revision이 대상의 현재 revision과 다르다(10 `conflict.subject_revision_mismatch`). 화면을 새로 받아 다시 판단해야 한다 | `subject`, `expected`, `current`, `rebase`(10의 대상 현재 요약), `basisSeq` |
| 3005 | `command.targetNotFound` | false | 명령 대상 레코드가 없다 | `targetId` |
| 3006 | `idempotency.keyReused` | false | 같은 멱등 키로 다른 내용을 보냈다 | `originalSubmissionId` |
| 3007 | `command.inProgress` | true | 같은 멱등 키의 첫 요청이 아직 처리 중이고 응답 대기 시간을 넘었다 | `retryAfterMs` |
| 3008 | `command.alreadyResolved` | false | 대상이 이미 끝난 상태다(질문이 이미 답해짐·가정 확정·철회, 결과가 이미 확인됨). 다른 기기나 자동 처리가 먼저 했다 | `targetId`, `resolvedAtSeq`, `resolvedBy`(행위자), `outcome` |
| 3009 | `command.superseded` | false | 대상이 새 판으로 대체됐다(합의 개정, 질문 다시 쓰기, 결과 재제출). 새 대상을 보고 다시 판단해야 한다 | `targetId`, `supersededBy` |
| 4001 | `blob.tooLarge` | false | 파일 크기가 한도를 넘는다 | `maxBytes` |
| 4002 | `blob.notFound` | false | 없는 파일 ID | `blobId` |
| 4003 | `upload.notFound` | false | 없거나 만료된 업로드 | `uploadId` |
| 4004 | `upload.incomplete` | true | 요청 본문이 선언한 길이보다 짧게 끝났다(연결 끊김). `HEAD`로 위치를 받아 이어 올린다 | `receivedBytes`, `size` |
| 4005 | `upload.hashMismatch` | false | 받은 내용의 SHA-256이 선언과 다르다 | `expected`, `actual` |
| 4006 | `ticket.limit` | true | 연결당 티켓 수 한도 초과 | `max`, `retryAfterMs` |
| 5001 | `daemon.draining` | true | 데몬이 종료 중이다 | `retryAfterMs` |
| 5002 | `daemon.busy` | true | 연결당 동시 요청 한도 초과, 또는 일시 과부하 | `retryAfterMs` |
| 5003 | `daemon.readOnly` | false | 데몬이 읽기 전용(복구) 모드다. 조회만 된다(17) | `mode`, `since` |
| 5004 | `request.cancelled` | false | `$/cancelRequest`로 취소했다(명령이면 적용되지 않았다) | - |
| 5005 | `request.timeout` | true | 서버 쪽 처리 시한을 넘었다(조회에만 쓴다. 명령은 §3.9.2) | - |
| 5006 | `runtime.unavailable` | true | 실행 제어 대상 런타임이 응답하지 않는다 | `retryAfterMs` |
| 5007 | `feature.disabled` | false | 메서드는 알지만 이 데몬 설정에서 꺼져 있다 | `feature` |

거부 세 갈래(브리프 §3.5, 10 §3.4.1)와의 대응: 내용(`content`) → 3001, 자격(`qualification`) → 3002, 경로(`path`) → 3003. 내용 갈래 중 10에 요구한 `content.already_resolved` → 3008, `content.superseded` → 3009로 따로 낸다(§5.2). 10이 두 코드를 두기 전까지는 `content.state_precondition`이고 대상이 끝난 상태(`rebase`의 상태가 답함·확정·철회·대체)이면 프로토콜 계층이 3008·3009로 바꾼다. 10 §3.4.5에 따라 거부는 `submission.rejected` 이벤트로 남으므로 `details.rejectionEventSeq`에 그 seq를 넣는다. 10의 `Rejection.next`(`{command, hint}`)는 `details.nextActions`의 `{action: command, label: hint}`로 옮긴다. 10의 `Rejection.message`(한국어, 모델용 문장)는 `details.kernelMessage`에 넣고 JSON-RPC `message`에는 넣지 않는다.

10의 결과 상태와의 대응: `accepted` → 성공 응답 `status: "applied"`, `needs_gate` → 성공 응답 `status: "gated"`(질문이 생겼다, §3.7.5), `rejected` → 3001~3003, `conflict` → 3004 또는 3006, `error`(`kernel.*`, 커널 버그) → -32603.

v0.2 실행 후보 결과 코드와의 대응(canon-2 §9.3): `invalid.protocol_request` → -32600, `invalid.protocol_method` → -32601, `invalid.command_schema` → -32602, `conflict.idempotency_key_reuse` → 3006, `conflict.expected_cursor_mismatch` → 3004(전역 커서 대신 레코드 revision, 10 §3.3.4), `denied.*` → 3003, `gate.human_*` → 3002, `policy.*`·`invalid.*`·`not_found.*` → 3001(대상 없음은 3005), `runtime.not_running` → 5006. `runtime.*`의 나머지와 `provider.*`는 런타임 내부 결과라 이 프로토콜의 오류로 오지 않고 이벤트 payload(09·12)로 온다.

### 3.4 핸드셰이크

#### 3.4.1 순서

```text
클라이언트                                   데몬
  │ HTTP GET /rpc (Upgrade, Sec-WebSocket-Protocol: helm-jsonrpc,
  │               Authorization: Bearer <기기 토큰>)            ── 리스너 전송 조건(18). 실패 → HTTP 401/403
  │◀──────────── 101 Switching Protocols ─────────────────────
  │◀──────────── 알림 hello.challenge {nonce, serverId, protocols, authMethods, proofRequired}
  │ 요청 hello {protocol:{min,max}, client, auth, resume?} ───▶  버전 고르기 → 인증 판정(18) → scope 부여
  │◀──────────── 응답 hello {protocol, server, connection, policy, features, log, human}
  │                         또는 오류(1003·1004~1008·1011) 후 닫기(1008)
  │ events.subscribe {from} ────────────────────────────────▶  등록 → 응답 → 재생 → 실시간 (§3.5)
  │ view.get … / stream.subscribe … / 명령 …
```

- 데몬은 업그레이드 직후 다른 무엇보다 먼저 `hello.challenge`를 보낸다. 클라이언트는 이것을 받기 전에 `hello`를 보내지 않는다. 업그레이드 뒤 5초 안에 챌린지가 오지 않으면 클라이언트는 연결을 닫고(4001과 같은 처리) 백오프 재접속한다.
- `hello` 전에 온 다른 요청은 `1001 handshake.required` 오류를 받고, 그 연결은 닫힌다(인증 전 제한, §3.4.5). pi-server는 핸드셰이크 중 요청을 보류했다가 처리하지만(pi-api-facts-2 §4.3), Helm은 인증 전 표면을 줄이려고 거부한다.
- `hello`가 실패하면 데몬은 오류 응답을 마지막 메시지로 보내고 1008로 닫는다(pi-server `failProtocol()`과 같은 순서, pi-api-facts-2 §4.3). Paseo의 `hello.rejected{reason}`(pi-cases-notes §12.1-7)과 같은 역할을 JSON-RPC 오류 응답이 한다.

#### 3.4.2 서버 챌린지

```ts
// 알림 "hello.challenge" (서버 → 클라이언트, 연결의 첫 메시지)
export interface HelloChallengeParams {
  nonce: string;                 // 32바이트 무작위 base64url. 이 연결에서만 유효
  serverTime: string;            // ISO 8601 UTC. 클라이언트 시계 차이 진단용
  serverId: string;              // 데몬 설치의 고정 ID(설치 때 한 번 만듦, 17). 클라이언트는 프로필에 저장된 값과 비교한다
  protocols: { min: number; max: number };  // 이 데몬이 받는 프로토콜 버전 범위
  authMethods: Array<"deviceToken" | "localAdmin">; // 이 리스너에서 받는 방식(§3.2.1)
  proofRequired: boolean;        // 기기 서명 증명이 필요한가(18이 정한다. 1차 기본값 false [제안])
}
```

- 클라이언트는 `serverId`가 프로필에 저장된 값과 다르면 `hello`를 보내지 않고 닫는다(다른 데몬에 붙은 것이다. pi-client의 serverId 확인과 같다, pi-api-facts-2 §5.3). 처음 연결이면 저장한다.

#### 3.4.3 클라이언트 hello

```ts
// 요청 "hello" (클라이언트 → 서버, 연결의 첫 요청)
export interface HelloParams {
  protocol: { min: number; max: number };   // 클라이언트가 말할 수 있는 버전 범위
  client: ClientInfo;
  auth: HelloAuth;
  /** 클라이언트가 가진 가장 큰 이벤트 위치. 응답의 log.resume 판정 미리보기에만 쓴다.
   *  실제 재전송은 events.subscribe의 from으로 정한다(§3.5.3) */
  resume?: StreamPosition;
  capabilities?: string[];   // 클라이언트 기능 표시. 예: "stream.text.v1", "views.invalidation.v1"
  locale?: string;           // BCP 47. 기본 "ko-KR"(결정 37)
  timeZone?: string;         // IANA 이름. 서버가 표시용 문자열을 만들 때만 쓴다
}

export interface ClientInfo {
  kind: "desktop" | "tui" | "cli" | "test";
  version: string;           // 앱 semver
  build?: string;            // 커밋 해시 등
  platform: "macos" | "windows" | "linux";
  instanceId: string;        // 앱 프로세스 실행마다 새로 만드는 무작위 ID. 로그·presence 구분용
}

export type HelloAuth =
  | {
      method: "deviceToken";
      deviceId: string;      // `dv_<ULID>`(브리프 §3.2). 토큰 값은 Authorization 헤더로만 보낸다
      proof?: DeviceProof;   // proofRequired이면 필수
    }
  | { method: "localAdmin" }; // local 리스너에서만

/** 기기 키 서명(18이 키 형식을 확정). 서명 대상은 UTF-8 문자열
 *  "helm-hello/1\n" + serverId + "\n" + nonce + "\n" + deviceId + "\n" + signedAt
 *  OpenClaw의 nonce 서명 방식을 줄인 것(S4 openclaw-gateway §2.2) */
export interface DeviceProof {
  alg: "ed25519";
  signedAt: string;          // ISO 8601 UTC. 서버 시각 ±2분(18이 확정)
  signature: string;         // base64url
}

export interface StreamPosition { storeId: string; seq: number }
```

판정 순서(서버):

1. 연결 상태가 `awaitingHello`인지 본다. 아니면 `1002 handshake.duplicate`.
2. `params` 스키마 검사. 실패하면 `-32602`.
3. 버전 고르기: `chosen = min(client.max, server.max)`. `chosen < max(client.min, server.min)`이면 `1003 protocol.unsupported`(details: `serverMin`, `serverMax`).
4. `auth.method`가 이 리스너의 `authMethods`에 있는지 본다. 아니면 `1008 auth.methodNotAllowed`.
5. 방식별 판정(검증 함수는 18이 제공한다. 이 문서는 입력과 결과 코드만 정한다):
   - `deviceToken`: 업그레이드 때 받아 둔 `Authorization: Bearer` 값이 없으면 `1004 auth.failed`. 토큰이 가리키는 기기와 `auth.deviceId`가 다르면 `1008`. 기기가 없으면 `1006 auth.unknownDevice`, 폐기됐으면 `1005 auth.revoked`, 토큰이 틀리면 `1004`. `proofRequired`인데 증명이 없거나 틀리면 `1004`, nonce·시각이 맞지 않으면 `1007 auth.challengeStale`. `tailnet` 리스너면 18이 정한 Tailscale 신원 조건도 여기서 본다(불일치는 `1008`).
   - `localAdmin`: `local` 리스너이면 통과한다.
   - 실패가 같은 출처에서 1분에 5회를 넘으면 그 뒤로는 `1011 rateLimited`(`retryAfterMs` 60,000)로 답한다. 출처는 `tailnet`이면 `X-Forwarded-For`의 tailnet 주소, `loopback`·`local`이면 리스너 단위다.
6. scope 부여(§3.4.6). 연결 상태를 `ready`로 바꾸고 응답을 보낸다.
7. 기기의 `lastSeenAt`, 연결 시작을 18이 정한 감사 기록에 남긴다(이벤트 이름은 09·18. 후보 `device.connected`).

#### 3.4.4 서버 응답

```ts
export interface HelloResult {
  protocol: number;                       // 고른 버전
  server: {
    id: string;                           // = challenge.serverId
    version: string;                      // 데몬 semver
    bootEpoch: string;                    // 데몬 프로세스가 시작할 때마다 새로 만드는 ULID(17 §1.4). 바뀌면 "데몬이 재시작됨"
    startedAt: string;
    mode: DaemonMode;                     // §3.7.8, 17 §3.4.1이 전이를 정한다
    safeModeReason?: { key: string; args?: Record<string, string> };   // mode = safeMode일 때(12 §3.7.6)
  };
  connection: {
    id: string;                           // `cx_<ULID>` [제안: 접두사 08에 요구]
    listener: ListenerKind;
    authMethod: "deviceToken" | "localAdmin";
    deviceId: string | null;              // localAdmin이면 null
    scopes: Scope[];
    tailscaleLogin?: string;              // tailnet 리스너에서 18이 확인한 로그인 이름
  };
  policy: ConnectionPolicy;
  features: {
    methods: string[];                    // 이 연결(버전·scope·데몬 설정)에서 부를 수 있는 메서드
    notifications: string[];              // 서버가 보낼 수 있는 알림
    views: string[];                      // view.get이 받는 뷰 이름(§3.7.4)
    capabilities: string[];               // 기능 표시. 예: "files.chunkedUpload.v1"
    schemaHash: string;                   // @helm/protocol 등록 표의 해시. 같으면 클라이언트와 스키마가 같다
  };
  log: {
    storeId: string;
    headSeq: number;                      // 지금까지 커밋된 가장 큰 seq. 이벤트가 없으면 0
    oldestReplayableSeq: number;          // 재전송할 수 있는 가장 작은 seq. 보존을 줄이지 않으면 1
    resume: ResumeVerdict;                // params.resume에 대한 미리보기
  };
  human: {
    briefAckSeq: number | null;           // brief.acknowledge의 마지막 값(사람 단위, 기기 무관)
  };
  serverTime: string;
}

export type ListenerKind = "tailnet" | "loopback" | "local";
export type Scope = "read" | "decide" | "devices" | "admin";
export type DaemonMode = "normal" | "safeMode" | "readOnly" | "draining";
// 17 내부 모드 대응: ready → normal, safe_mode → safeMode, read_only → readOnly, draining → draining.
// safeMode: 실행 자동 재개·에이전트 타이머·관찰 실행을 멈춘 상태. 사람 명령은 받는다(17 §3.4.1, 12 §3.7.6)

export type ResumeVerdict =
  | { status: "notRequested" }
  | { status: "ok"; behind: number }      // headSeq - resume.seq
  | { status: "snapshotRequired"; reason: "storeMismatch" | "beforeOldest" | "tooFar" | "aheadOfHead" };

export interface ConnectionPolicy {
  maxInboundMessageBytes: number;    // 클라이언트 → 서버 메시지 상한. 기본 1 MiB
  maxOutboundMessageBytes: number;   // 서버 → 클라이언트 메시지 상한. 기본 4 MiB
  tickIntervalMs: number;            // tick 간격. 기본 15,000
  clientTimeoutMs: number;           // 클라이언트 감시 타이머 권장값. 기본 2 × tick + 5,000 = 35,000
  maxInFlightRequests: number;       // 연결당 응답 대기 요청 수. 기본 32
  maxSubscriptions: number;          // 연결당 구독 수(events + stream). 기본 16
  maxReplayEvents: number;           // 한 번의 재전송 상한(headSeq - from). 기본 50,000
  replayBatchMaxEvents: number;      // events 알림 하나의 이벤트 수 상한. 기본 256
  sendQueueHighWaterBytes: number;   // 느린 소비자 판정(§3.5.8). 기본 8 MiB
  idempotencyWindowMs: number;       // 서버가 멱등 결과를 보관하는 최소 기간. 기본 7일(09가 이 이상 보관)
  pendingCommandMaxAgeMs: number;    // 클라이언트가 재전송해도 되는 진행 중 명령의 최대 나이. 기본 24시간
  files: {
    maxBlobBytes: number;            // 기본 64 MiB
    singleUploadMaxBytes: number;    // POST 한 번으로 올릴 수 있는 크기. 기본 8 MiB, 넘으면 청크 업로드
    uploadChunkBytes: number;        // 청크 크기. 기본 4 MiB
    downloadTicketTtlMs: number;     // 기본 300,000
    stagedBlobTtlMs: number;         // 명령에서 참조되지 않은 업로드의 보관 시간. 기본 24시간
  };
}
```

- 정책 값은 클라이언트에 하드코딩하지 않고 재접속할 때마다 응답에서 다시 읽는다(OpenClaw `hello-ok.policy`, S4 openclaw-gateway §4-4).
- `features.methods`에 없는 메서드를 부르면 `-32601`이다. 클라이언트는 화면 동작을 켜기 전에 이 목록을 확인한다.

#### 3.4.5 인증 전 제한 [제안]

`hello`가 성공하기 전 연결(`awaitingHello`)에는 다음 제한을 둔다. 근거는 OpenClaw의 사전 인증 한도(64 KiB, IP당 128연결, 큐 16, 15초, S4 openclaw-gateway §1.3)를 1인 사용에 맞게 줄인 것이다.

| 항목 | 값 | 넘으면 |
|---|---|---|
| 메시지 크기 | 16 KiB | 1009로 닫기 |
| 받는 메시지 | `hello` 요청 하나. 그 밖의 요청·알림 | `1001` 오류 후 1008로 닫기 |
| 응답 대기 요청 | 1 | 1008로 닫기 |
| 핸드셰이크 시한 | 업그레이드 후 10초 안에 `hello` 응답까지 | 4001로 닫기 |
| 출처별 인증 전 연결 수 | 8 | 업그레이드를 HTTP 429로 거절 |
| 출처별 인증 실패 | 1분에 5회 | `1011` + `retryAfterMs` |
| 서버가 보내는 것 | `hello.challenge`, `hello` 응답, 오류 응답만 | - |

#### 3.4.6 scope

| scope | 허용 메서드 | `deviceToken` | `localAdmin` |
|---|---|---|---|
| `read` | `ping`, `events.*`, `view.get`, `stream.*`, `run.partial`, `search.query`, `presence.report`, `blob.downloadTicket`, `daemon.status`, `protocol.describe`, HTTP 다운로드 | 예 | 예 |
| `decide` | §3.7.5의 모든 명령 메서드, HTTP 업로드 | 예 | 예 |
| `devices` | `device.*`, `connection.*` | 예 | 예 |
| `admin` | `admin.*` | 아니요 | 예 |

- 1인 앱이므로 페어링된 기기는 `read`, `decide`, `devices`를 모두 받는다. 기기별로 줄이는 정책(예: 읽기 전용 기기)은 18이 정하면 `scopes`로 내려 준다. 클라이언트는 `scopes`에 없는 동작을 화면에서 끈다.
- scope 위반은 `1010 scope.forbidden`이다.

#### 3.4.7 서버 연결 상태 기계

| 상태 | 사건 | 가드 | 다음 상태 | 부수 효과 |
|---|---|---|---|---|
| (없음) | 업그레이드 성공 | 전송 조건 통과 | `awaitingHello` | `hello.challenge` 전송, 10초 타이머 시작, `Authorization` 값 보관 |
| `awaitingHello` | `hello` 요청 | 판정 성공 | `ready` | 응답 전송, 타이머 해제, tick 시작, 인증 전 버퍼 해제 |
| `awaitingHello` | `hello` 요청 | 판정 실패 | `closing` | 오류 응답 전송 후 1008 |
| `awaitingHello` | 다른 요청·알림 | - | `closing` | `1001` 오류 후 1008 |
| `awaitingHello` | 10초 경과 | - | `closing` | 4001 |
| `awaitingHello` | 16 KiB 초과 메시지 | - | `closing` | 1009 |
| `ready` | 요청 | 등록된 메서드, scope 있음 | `ready` | 디스패치(§3.15) |
| `ready` | `hello` 요청 | - | `ready` | `1002` 오류(연결 유지) |
| `ready` | 송신 큐 > 상한 | §3.5.8 | `closing` | 4008 |
| `ready` | 기기 폐기 사건(`device.revoke` 커밋) | 이 연결의 기기 | `closing` | `connection.closing{kind:"auth.revoked"}` 알림 후 4009 |
| `ready` | 데몬 종료 시작 | - | `draining` | `server.shutdown` 알림. 새 명령은 `5001` |
| `draining` | 진행 중 요청 모두 응답 또는 종료 예산 소진(17) | - | `closing` | 1001 |
| `ready`·`draining` | 무수신 45초(WebSocket pong 포함) | - | `closing` | 소켓 파기(닫는 핸드셰이크 없이) |
| 모든 상태 | 소켓 닫힘 | - | `closed` | 진행 중 요청 중단(AbortSignal), 구독 해제, 티켓 무효화 |

- 연결이 닫히면 그 연결의 구독, 응답 대기 요청, 다운로드 티켓은 모두 사라진다. 연결을 넘어 남는 것은 영속 이벤트, 멱등 결과, 기기 상태뿐이다. 재접속한 클라이언트는 자기가 가진 위치와 진행 중 명령함으로 이어 간다(pi-server도 연결을 넘는 상태를 두지 않는다, pi-api-facts-2 §4.3).
- 진행 중 명령 요청이 연결 종료로 중단되어도 커밋된 결과는 되돌리지 않는다. 클라이언트는 같은 멱등 키로 다시 보내 결과를 받는다(§3.9).

### 3.5 이벤트 순서와 재전송

#### 3.5.1 seq와 저장소 ID [결정 29·31, 세부 제안]

- 프로토콜의 seq는 09가 정본 이벤트 로그에 부여하는 전역 seq 그대로다. 프로토콜 계층은 seq를 새로 매기지 않는다. 연결별 카운터나 메모리 버퍼를 두지 않는다(사례 4곳이 모두 그렇게 해서 재시작마다 전체 재동기화가 필요했다, pi-cases-notes §12.2-1).
- 프로토콜이 기대하는 seq 성질(09에 대한 요구): 정수, 1부터 시작, 커밋 순서대로 단조 증가, 한 번 부여된 seq의 이벤트는 바뀌지 않는다, 데몬 재시작 뒤에도 이어진다. 빈 번호가 없을 것은 요구하지 않는다(필터 구독과 `(from, to]` 계약이 빈 번호를 견딘다).
- `storeId`: 이벤트 저장소의 정체. 09가 저장소를 만들 때 정하고, 17의 복원 절차가 백업에서 저장소를 되살릴 때 새 값으로 바꾼다(seq가 되돌아갈 수 있기 때문이다). 클라이언트는 위치를 항상 `{storeId, seq}` 쌍으로 저장한다.
- `bootEpoch`: 데몬 프로세스가 시작할 때마다 바뀐다(17 §1.4). 재전송 판정에는 쓰지 않는다. 화면에 "데몬이 재시작됨"을 보이고(20), 진단 로그를 맞춰 보는 데만 쓴다.
- 보존: 정본 로그는 지우지 않으므로 `oldestReplayableSeq`는 보통 1이다. 09·17이 오래된 이벤트를 다른 저장소로 옮기는 정책을 두면 그 경계 값을 이 필드로 알린다.

#### 3.5.2 영속 이벤트와 휘발 스트림

| 구분 | 영속 이벤트 | 휘발 스트림 |
|---|---|---|
| 예 | `concern.opened`, `question.raised`, `choice.committed`, `toolcall.completed`, `message.recorded`(어시스턴트 메시지 완성) 등 09의 모든 이벤트 | 토큰 단위 텍스트, 생각 텍스트, 도구 출력 조각, 진행 단계 표시 |
| 출처 | 커밋된 정본 | 런타임(12)의 실행 중 메모리 |
| seq | 있음 | 없음. 실행마다 조각 번호 `n` |
| 재전송 | `from` 위치부터 | 없음. 놓치면 `run.partial`로 현재 상태를 받는다 |
| 버려도 되는가 | 안 된다 | 된다. 완성된 내용은 영속 이벤트로 다시 온다 |
| 알림 | `events` | `stream.chunk` |

- 휘발 스트림을 정본 로그에 넣지 않는 이유: 토큰마다 영속 트랜잭션을 돌리면 단일 JS 스레드가 묶이고(happy-agent `events/LEARNINGS.md:11-19`, happy-agent 조사 §4), 재전송 범위가 델타로 채워진다.
- 런타임(12)은 실행 하나가 만드는 휘발 조각의 최종 결과를 반드시 영속 이벤트로 남긴다(예: 메시지 완성 이벤트에 전체 텍스트, 도구 결과 이벤트에 출력 요약과 blob 참조). 클라이언트는 영속 이벤트를 받으면 해당 휘발 조각을 버린다.

```ts
/** 영속 이벤트의 프로토콜 표현. 09의 envelope에서 만든다(시각은 ISO 문자열, 브리프 §3.3) */
export interface EventWire {
  seq: number;
  id: string;                  // `ev_<ULID>`
  type: string;                // 09 카탈로그의 이름. `<대상>.<과거형 동사>`
  v: number;                   // payload 스키마 버전(09)
  at: string;                  // 기록 시각(ISO 8601 UTC)
  actor: string;               // 'human', 'agent:work', 'runtime', 'kernel', 'scheduler', 'external:<name>'
  subject: EventSubject;
  commandId?: string;          // 이 이벤트를 만든 제출(10의 submissionId)
  causationId?: string;        // 원인 이벤트 ID
  correlationId?: string;
  invalidates: string[];       // 무효화 태그(§3.6.3). 데몬이 계산한다. 빈 배열 가능
  payload?: Record<string, unknown>;   // filter.payload = "none"이면 없음
  redacted?: string[];         // 공개 정책(18)으로 뺀 payload 경로(JSON Pointer)
}

export interface EventSubject {
  goalId?: string;
  concernId?: string;
  workUnitId?: string;
  runId?: string;
  recordIds?: string[];        // 이 이벤트가 만들거나 바꾼 레코드
}
```

- `payload`에는 비밀을 넣지 않는다. 이것은 09·18의 규칙이고(canon-2 L9: 숨길 값은 일반 타임라인으로 새기 쉽다), 프로토콜 계층은 18이 정한 공개 정책으로 한 번 더 걸러 `redacted`에 표시한다(이중 방어).
- 이벤트 하나의 직렬화 크기는 256 KiB를 넘지 않는다(09·12에 대한 요구). 큰 도구 출력은 blob으로 저장하고 payload에는 `BlobRef`와 앞부분 요약만 넣는다.

#### 3.5.3 이벤트 구독 계약

```ts
// 요청 "events.subscribe"
export interface EventsSubscribeParams {
  from: StreamPosition | "head";   // "head": 지금 이후만. 위치: 그 seq 다음부터
  filter?: EventFilter;
}
export interface EventsSubscribeResult {
  sub: string;                     // 연결 안에서 유일한 구독 ID. 예: "e1"
  start: number;                   // 이 구독의 시작 위치(from.seq 또는 응답 시점의 headSeq)
  headSeq: number;                 // 등록 시점의 headSeq
  storeId: string;
  mode: "replaying" | "live";      // start < headSeq이면 replaying
}

// 알림 "events"
export interface EventsNotificationParams {
  sub: string;
  from: number;                    // 직전 알림의 to. 첫 알림이면 start
  to: number;                      // 이 알림이 책임지는 구간의 끝
  events: EventWire[];             // (from, to] 구간에서 필터에 맞는 이벤트 전부. seq 오름차순. 빈 배열 가능
  caughtUp: boolean;               // 이 알림을 보낸 시점에 to == headSeq
}
```

계약(Chord `ReplicatedStateSource`의 "스냅샷 다음 첫 frame은 cursor + 1, 겹침·구멍 없음"을 구간형으로 옮김, pi-api-facts-2 §6.2):

1. 한 구독의 알림은 `from`이 직전 알림의 `to`와 같다. 첫 알림의 `from`은 응답의 `start`다.
2. 알림 하나는 `(from, to]` 구간에서 필터에 맞는 영속 이벤트를 하나도 빼지 않고, 중복 없이, seq 오름차순으로 담는다.
3. 서버는 필터에 맞는 이벤트가 없는 구간도 `events: []`로 위치를 넘길 수 있다. 서버는 tick마다 위치가 headSeq보다 뒤인 실시간 구독에 빈 알림을 하나 보내 클라이언트가 최신 위치를 저장하게 한다.
4. 응답보다 알림이 먼저 오지 않는다.
5. `caughtUp: true`인 알림을 받은 뒤로는 실시간 단계다. 클라이언트는 "따라잡는 중" 표시를 끈다.

#### 3.5.4 서버의 재전송 알고리즘 [제안]

```text
events.subscribe(params) on connection c:
  1. filter 검사. 실패 → 2007
  2. 구독 수 검사. 초과 → 2003
  3. (같은 이벤트 루프 턴 안에서, 커밋 방송과 섞이지 않게)
     head ← 09.headSeq()
     if from == "head": start ← head
     else:
       if from.storeId ≠ storeId        → 2001 {reason: storeMismatch}
       if from.seq > head                → 2001 {reason: aheadOfHead}
       if from.seq < oldestReplayable-1  → 2001 {reason: beforeOldest}
       if head - from.seq > maxReplayEvents → 2001 {reason: tooFar}
       start ← from.seq
     sub ← { id, filter, pos: start, state: start < head ? replaying : live, pending: [] }
     c.subs.add(sub)                     // 이 순간부터 새 커밋은 sub.pending 또는 실시간 경로로 간다
  4. 응답 {sub.id, start, headSeq: head, storeId, mode} 를 c의 송신 큐에 넣는다
  5. if replaying:
       upto ← head
       while sub.pos < upto:
         await c.sendQueueBytes < lowWater(1 MiB)          // 재생은 당겨 쓰는 속도로
         rows ← 09.read(seq > sub.pos AND seq ≤ upto, filter, limit = replayBatchMaxEvents, scanLimit = 10,000)
         to ← (rows가 limit만큼 찼으면 rows의 마지막 seq, 아니면 스캔한 구간의 끝)
         send events{sub, from: sub.pos, to, events: rows, caughtUp: false}
         sub.pos ← to
       // 재생 중 쌓인 실시간 커밋 처리(happy-agent ApiModule.ts:4487-4525와 같은 순서)
       for batch in sub.pending (커밋 순서):
         matching ← batch.events 중 seq > sub.pos 이고 filter에 맞는 것
         send events{sub, from: sub.pos, to: batch.lastSeq, events: matching, caughtUp: (batch가 마지막)}
         sub.pos ← batch.lastSeq
       sub.pending ← []; sub.state ← live
     (재생 마지막 알림 또는 보류분 마지막 알림의 caughtUp을 true로 보낸다)

on commit(batch = 이벤트 e_a..e_b, seq 구간 (a-1, b]) — 09가 커밋한 직후, 같은 턴에서:
  for each connection c, for each events sub s of c:
    if s.state == replaying: s.pending.push(batch); continue
    matching ← filter(batch)
    if matching 비어 있음: s.lagSince ??= now; continue      // tick 때 빈 알림으로 위치를 넘긴다
    send events{s.id, from: s.pos, to: b, events: matching, caughtUp: true}; s.pos ← b
```

- 3단계의 head 읽기와 구독 등록은 같은 이벤트 루프 턴에서 한다. 09가 `better-sqlite3`(동기, 결정 36)로 커밋하고 커밋 방송도 같은 스레드에서 하므로, 이 두 동작 사이에 커밋이 끼어들 수 없다. 09가 커밋을 다른 스레드로 옮기면 방송 큐에 등록을 직렬화하는 잠금이 필요하다(09에 대한 요구).
- 재생 읽기는 09가 제공하는 범위 읽기(`seq > ? AND seq ≤ ?`, 필터 조건 일부는 SQL로)로 한다. 필터가 SQL로 내려가지 않는 조건(하위 Concern 포함 등)은 읽은 뒤 거른다. 한 번에 훑는 행 수 상한(`scanLimit`)을 두어 드문 필터가 오래 막지 않게 한다.
- 재생 중 연결이 닫히면 읽기를 멈춘다. 클라이언트는 마지막으로 받은 `to`부터 다시 구독한다.

#### 3.5.5 범위를 벗어났을 때: 스냅샷 경로

`events.subscribe`가 `2001 replay.outOfRange`를 돌려주면 클라이언트는 다음을 한다(20 APP-D08과 같다).

1. `storeMismatch` 또는 `aheadOfHead`이면 이 서버에 대해 로컬에 저장한 모든 위치, 투영 캐시, 이벤트 캐시를 버린다(다른 저장소다). `beforeOldest`·`tooFar`이면 투영 캐시는 남겨 "낡음"으로 표시하고 위치와 이벤트 캐시만 버린다.
2. `events.subscribe({from: "head", filter})`로 다시 구독한다(구독 먼저). 응답의 `start`를 `H0`라 한다.
3. 열린 뷰를 모두 `view.get({…, minSeq: H0})`로 다시 받는다(스냅샷 나중). 응답의 `asOfSeq ≥ H0`가 보장된다(§3.6.3).
4. 타임라인처럼 이벤트 목록을 보이는 화면은 `events.read({before: H0 + 1, limit, filter})`로 최근 이력을 거꾸로 채우고, 그보다 앞은 "이전 기록은 접속하지 않은 동안 생략됨" 표시를 둔다.
5. 2단계 뒤로 받은 이벤트는 정상 처리한다. 3·4단계 응답과 겹치는 이벤트는 seq로 중복을 없앤다(`seq ≤ asOfSeq`인 무효화는 무시).

#### 3.5.6 구독 먼저, 스냅샷 나중

- 원칙: 클라이언트는 변경을 놓치지 않으려면 변경 통로(이벤트 구독)를 먼저 열고 상태(뷰, 이력)를 나중에 읽는다. 상태 응답은 자기가 반영한 seq(`asOfSeq`)를 함께 준다. 클라이언트는 구독으로 받은 것 중 `seq ≤ asOfSeq`인 것을 그 상태에 이미 반영된 것으로 본다(pi-web `sessionController.ts:1481-1514`의 워터마크 방식, happy-agent의 "스냅샷이 읽기 전에 커서를 잡는다", pi-cases-notes §12.1-5).
- 정상 재접속에서는 이벤트를 `from`부터 재전송받으므로 이 순서가 저절로 지켜진다. 새로 시작하거나 스냅샷 경로(§3.5.5)일 때 명시적으로 지킨다.
- 서버 쪽 보장: `view.get`의 `asOfSeq`는 그 응답이 반영한 정확한 seq다. 투영 갱신이 이벤트 커밋과 같은 트랜잭션이면(20 AS-2, 09·12에 대한 요구) `asOfSeq`는 읽은 시점의 headSeq다. 투영이 늦게 따라오는 구조라면 `minSeq`를 받은 서버가 그 seq까지 투영이 따라올 때까지 최대 `waitMs`(기본 2,000) 기다리고, 넘으면 `2006 view.notReady`(재시도 가능)를 돌려준다.

#### 3.5.7 gap 감지 (클라이언트)

```text
on events{sub, from, to, events}:
  s ← subs[sub]; if 없음: 버린다(해제 직후 경합)
  if from ≠ s.pos:                       // 구멍 또는 중복 구간
     if from < s.pos and to ≤ s.pos: 버린다(이미 받은 구간)
     else: gap 처리
  else:
     for e in events: (seq 오름차순이 아니면 프로토콜 오류로 보고 재접속) 적용
     s.pos ← to; 위치 저장(디바운스 1초, {storeId, seq: to})

gap 처리:
  events.unsubscribe(sub); events.subscribe({from: {storeId, seq: s.pos}, filter})
  1분 안에 gap이 3번 나면: 연결을 닫고(1000) 재접속, 진단 로그를 남긴다(버그 신호)
```

- 서버가 영속 이벤트를 버리지 않으므로 정상 동작에서 gap은 생기지 않는다. gap 검사는 서버 버그와 클라이언트 처리 순서 버그를 잡는 장치다. OpenClaw처럼 "버린 이벤트도 seq를 소비해 gap으로 보이게" 하는 처리는 휘발 스트림의 `n`에만 적용한다(§3.6.4).

#### 3.5.8 느린 소비자와 송신 우선순위 [제안]

- 서버는 연결마다 송신 큐 크기(`ws.bufferedAmount` + 아직 소켓에 쓰지 않은 메시지)를 잰다.
- 우선순위: 응답과 오류 > `tick`·`server.shutdown`·`connection.closing` > `events` > `stream.chunk`. 큐가 차 있을 때 응답과 tick이 대량 이벤트 뒤에 막히지 않게 한다(pi-env "Results, errors, pings … are sent before queued command output", `env/docs/protocol.md` Scheduling).
- 재생은 큐가 1 MiB 아래일 때만 다음 묶음을 읽는다(§3.5.4). 그래서 재생 때문에 느린 소비자로 끊기는 일은 없다.
- 실시간 단계에서 큐가 `sendQueueHighWaterBytes`(8 MiB, Paseo와 같은 값, S4 paseo §3)를 넘으면:
  1. 그 연결의 `stream.chunk`를 보내지 않고 버린다. 실행별 `n`은 계속 증가하므로 클라이언트는 다음 조각에서 유실을 안다.
  2. 큐가 10초 넘게 상한 위에 있거나 16 MiB를 넘으면 `connection.closing{kind:"slowConsumer"}`를 시도하고 4008로 닫는다.
- 영속 이벤트(`events`)와 응답은 버리지 않는다. 닫힌 클라이언트는 바로 재접속해 자기 위치부터 받는다.

#### 3.5.9 명령 응답과 이벤트의 순서

- 같은 연결에서 명령을 보낸 클라이언트가 그 결과 이벤트를 화면에 반영하기 전에 "완료"를 보이는 일이 없게, 서버는 다음 순서를 지킨다: 커밋 → (같은 턴) 모든 연결의 실시간 구독에 결과 이벤트 알림을 큐에 넣음 → 그 뒤 명령 응답을 큐에 넣음.
- 따라서 요청한 연결의 실시간 구독(필터에 맞는 경우)에서는 응답의 `lastSeq`까지의 이벤트가 응답보다 먼저 도착한다. 재생 중인 구독은 이 보장이 없다. 클라이언트는 응답의 `lastSeq`와 자기 구독 위치를 비교해 "반영됨"을 판단한다.
- 클라이언트는 낙관적 도메인 갱신을 하지 않는다(21 UI-D03). 응답을 기다리는 동안 버튼에 "보내는 중"만 표시한다.

### 3.6 구독 모델

#### 3.6.1 무엇을 구독하는가

| 단위 | 방법 | 재접속 | 쓰는 곳 |
|---|---|---|---|
| 전체 이벤트 스트림 | `events.subscribe({from, filter: {}})` | `from` 위치부터 재전송 | 데스크톱 앱 기본 구독 하나(모든 뷰의 무효화, 알림, 타임라인 캐시). TUI도 같다 |
| Concern 단위 | `events.subscribe({from, filter: {concernIds: [..], includeDescendants: true}})` | 같음 | Concern 대화·이력 화면만 따로 붙는 클라이언트, 관리 CLI의 `helm tail` |
| 화면 투영 단위 | `view.get` + 이벤트의 `invalidates` 태그 | 뷰를 다시 받는다 | 모든 화면(§3.6.3) |
| 실행 중 휘발 조각 | `stream.subscribe({scope})` | 다시 구독하고 `active`로 현재 상태를 받는다 | 대화 패널, 진행 작업 카드(§3.6.4) |

- 화면 투영 단위의 변경 알림을 따로 두지 않고 이벤트 스트림의 태그로 대신한다. 그래서 끊긴 동안 생긴 무효화도 이벤트 재전송으로 함께 복원된다(experimental.v0의 SSE 무효화와 다른 점, canon-2 §8.7).
- 무효화만 필요하고 이벤트 본문이 필요 없는 클라이언트는 `filter.payload: "none"`으로 머리 정보만 받는다(대역폭을 줄인다).

#### 3.6.2 필터

```ts
export interface EventFilter {
  goalIds?: string[];
  concernIds?: string[];
  includeDescendants?: boolean;     // concernIds의 하위 Concern 포함. 기본 true
  typePrefixes?: string[];          // 예: ["question.", "choice."]. 비어 있거나 없으면 전부
  excludeTypePrefixes?: string[];   // 예: ["toolcall."] (도구 호출 이벤트 빼기)
  payload?: "full" | "none";        // 기본 "full"
}
```

- 조건 사이는 AND, 배열 안은 OR다. 모든 필드가 없으면 전체 스트림이다.
- 하위 Concern 포함 여부는 서버가 이벤트를 읽는 시점의 Concern 트리로 판정한다. 분해·병합(S 루프)으로 트리가 바뀐 뒤 옛 이벤트를 재생하면 판정이 기록 당시와 다를 수 있다. 정확한 이력이 필요한 화면은 전체 스트림이나 `events.read`를 쓴다.
- 필터 문자열 길이 합 4 KiB, 배열 원소 합 256개를 넘으면 `2007 filter.invalid`.

#### 3.6.3 화면 투영: `view.get`과 무효화 태그 [제안]

```ts
// 요청 "view.get"
export interface ViewGetParams {
  view: ViewName;                   // §3.7.4 카탈로그
  params: Record<string, unknown>;  // 뷰별 파라미터(카탈로그의 스키마로 검사)
  minSeq?: number;                  // 이 seq 이상을 반영한 투영만 받겠다(§3.5.6)
  waitMs?: number;                  // minSeq를 기다릴 최대 시간. 기본 2,000, 최대 10,000
  page?: { before?: number; limit?: number };  // 목록형 뷰의 앞 페이지(thread, records 등)
}

export interface ViewResult<D = unknown> {
  view: ViewName;
  key: string;                      // 정규화한 뷰 키. 예: "inbox", "concern:cn_01J…". 클라이언트 캐시 키로 쓴다
  asOfSeq: number;                  // 이 투영이 반영한 마지막 seq (04 ViewMeta.sourceSeq와 같은 값)
  generatedAt: string;
  freshness: "current" | "stale" | "rebuilding" | "failed";   // 04 §3.0.2와 같은 값
  staleReason?: { key: string; args?: Record<string, string> }; // 05 문구 키
  omitted?: { category: string; count: number }[];             // 누락 범주(canon §13.5, 03 §5.2의 12 요구)
  dependsOn: string[];              // 무효화 태그. 이 중 하나가 이벤트 invalidates에 나오면 이 투영은 낡는다
  page?: { hasOlder: boolean; oldestSeq?: number };
  data: D;                          // 뷰 모델. 타입은 04 해당 절(§3.7.4 표)
}
```

무효화 태그 규칙:

- 태그는 레코드 ID(`cn_…`, `qs_…`, `wu_…` 등) 또는 집계 이름(`@` 접두)이다. 집계 이름: `@home`, `@brief`, `@inbox`, `@autonomous`, `@concernTree`, `@goals`, `@observer`, `@recovery`, `@devices`, `@dials`, `@settings`, `@search`, `@metrics`.
- 데몬(12의 투영기)은 이벤트 하나를 투영에 반영할 때 그 반영으로 바뀔 수 있는 레코드 ID와 집계 이름을 그 이벤트의 `invalidates`에 넣는다. 뷰 처리기는 뷰를 만들 때 읽은 레코드 ID와 집계 이름을 `dependsOn`에 넣는다. 둘 다 데몬이 계산하므로 앱에 "이벤트 종류 → 화면" 대응표가 필요 없다(20 AS-1의 요구를 태그로 일반화했다. 결정 32).
- 정확성 규칙: 이벤트를 반영한 뒤 다시 만든 뷰의 `data`가 달라진다면, 그 이벤트의 `invalidates`와 뷰의 `dependsOn`은 반드시 겹친다. 반대 방향(겹치지만 안 바뀜)은 허용한다. 이 규칙은 속성 테스트로 확인한다(§6.2 VIEW-01).
- 태그 수 상한: 이벤트당 64개, 뷰당 512개. 넘으면 데몬은 집계 이름 하나(예: `@concernTree`)로 대신한다(넓게 무효화하는 쪽으로).

클라이언트 처리(20이 TanStack Query로 구현, 20 APP-D01):

```text
on events 알림 (순서대로):
  for e in events:
    for each cached view v with v.asOfSeq < e.seq and (v.dependsOn ∩ e.invalidates ≠ ∅):
      v.staleSince ← e.seq
      if v가 화면에 열려 있음: scheduleRefetch(v.key, minSeq = e.seq)   // 키마다 150ms 디바운스, 동시에 하나만
refetch(v.key, minSeq):
  r ← view.get({view, params, minSeq})
  if r.asOfSeq ≥ v.staleSince: 캐시 교체, staleSince 해제
  else: 다시 예약(서버가 minSeq를 지키므로 정상적으로는 일어나지 않는다)
```

- 열려 있지 않은 뷰는 "낡음" 표시만 하고 다시 받지 않는다. 화면에 다시 열릴 때 받는다.
- 재접속 뒤 재전송된 이벤트도 같은 규칙으로 처리한다. 재전송 중(`caughtUp` 전)에는 다시 받기를 미루고, `caughtUp: true` 뒤에 낡은 열린 뷰를 한 번에 다시 받는다(재전송 중 같은 뷰를 여러 번 받지 않기 위해).
- 스냅샷 + 패치 방식(뷰마다 서버가 차이를 계산해 JSON Patch로 보냄)은 기각했다. 이유: 서버가 연결·뷰마다 이전 값을 들고 차이를 계산해야 하고, 패치 순서가 어긋나면 뷰 전체를 다시 보내는 처리가 또 필요하다. 1인 사용의 뷰 크기와 갱신 빈도에서는 다시 받기의 비용이 작다. 20의 캐시 구조(투영 키 단위)와도 맞는다. ADR 후보 19-A4.

#### 3.6.4 휘발 스트림 [제안]

```ts
// 요청 "stream.subscribe"
export interface StreamSubscribeParams {
  scope: { concernId: string } | { runId: string } | { workUnitId: string } | { all: true };
  parts?: Array<StreamPart["kind"]>;   // 받을 조각 종류. 기본 전부
}
export interface StreamSubscribeResult {
  sub: string;                         // 예: "s1"
  active: RunPartial[];                // 지금 범위 안에서 실행 중인 run의 현재 조각 상태
}

// 알림 "stream.chunk"
export interface StreamChunkParams {
  sub: string;
  runId: string;                       // `rn_<ULID>`
  concernId: string;
  workUnitId?: string;
  n: number;                           // 이 run의 조각 번호. 1부터, run 안에서 1씩 증가. 버린 조각도 번호를 소비한다
  part: StreamPart;
}

export type StreamPart =
  | { kind: "text"; messageId: string; offset: number; text: string }      // offset: 이 조각 앞까지의 길이(UTF-16 단위)
  | { kind: "thinking"; messageId: string; offset: number; text: string }
  | { kind: "toolOutput"; toolCallId: string; stream: "stdout" | "stderr"; offset: number; text: string }
  | { kind: "toolPhase"; toolCallId: string; tool: string; phase: "requested" | "executing" | "finished" }   // 12 F-4: 검사 중 / 실행 중
  | { kind: "status"; phase: RunPhase; label?: string }                   // label은 사람이 읽는 짧은 한국어(12)
  | { kind: "end"; reason: "completed" | "paused" | "stopped" | "aborted" | "failed"; finalSeq?: number };

export type RunPhase = "preparing" | "waitingModel" | "streaming" | "runningTool" | "compacting" | "waitingHuman" | "idle";

// 요청 "run.partial" → RunPartial
export interface RunPartialParams { runId: string }
export interface RunPartial {
  runId: string;
  concernId: string;
  workUnitId?: string;
  n: number;                           // 이 상태에 반영된 마지막 조각 번호
  startedAt: string;
  phase: RunPhase;
  messages: Array<{ messageId: string; text: string; thinking?: string }>;   // 아직 영속되지 않은 메시지의 현재 텍스트
  tools: Array<{ toolCallId: string; tool: string; phase: "requested" | "executing" | "finished"; outputTail: string; outputLength: number }>; // 꼬리 16 KiB
}
```

클라이언트 처리:

```text
on stream.chunk(c):
  r ← runs[c.runId] (없으면 run.partial 요청 후 그 결과에서 시작)
  if c.n ≤ r.n: 버린다(중복)
  if c.n > r.n + 1: r.gap ← true; run.partial(c.runId)로 다시 맞춘다(그동안 받은 조각은 n 기준으로 버리거나 적용)
  텍스트 조각: offset == 현재 길이 → 덧붙임 / offset + len ≤ 현재 길이 → 버림 / 겹침 → 겹치지 않은 꼬리만 덧붙임 / offset > 현재 길이 → gap
  r.n ← c.n
on 영속 이벤트(메시지 완성, 도구 결과, run 종료):
  해당 messageId·toolCallId의 휘발 상태를 버린다(영속 내용이 정본)
```

- offset 방식은 happy-agent의 `message.delta`(`applyMessageDelta.ts:4-40`)와 같다. 중복·겹침에 안전하다.
- `end` 조각은 run을 끝내는 영속 이벤트가 커밋된 뒤에 보내고 `finalSeq`에 그 seq를 넣는다. 클라이언트는 이벤트 구독이 `finalSeq`를 받기 전까지 휘발 상태를 지우지 않는다(화면이 잠깐 비는 것을 막는다).
- 휘발 조각 하나의 `text`는 16 KiB 이하다. 런타임은 토큰을 50ms 단위로 모아 보낸다(12에 대한 요구, 제안값).

#### 3.6.5 해제와 연결당 상태

- 해제: `events.unsubscribe({sub})`, `stream.unsubscribe({sub})`. 결과는 `{}`. 없는 구독이면 `2002`(클라이언트는 무시해도 된다). 해제 응답 뒤에는 그 구독의 알림이 오지 않는다. 해제 응답 전에 이미 큐에 들어간 알림은 올 수 있으므로 클라이언트는 모르는 구독의 알림을 버린다.
- 구독은 연결에 속한다. 연결이 닫히면 서버는 모두 지운다. 서버에 연결을 넘어 남는 구독은 없다.

| 연결당 상태(서버) | 내용 |
|---|---|
| 식별 | `connection.id`, 리스너, 기기 ID, 인증 방식, scope, 클라이언트 정보, 고른 프로토콜 버전, nonce |
| 요청 | 응답 대기 요청 표(`id` → AbortController, 메서드, 시작 시각). 상한 `maxInFlightRequests` |
| 이벤트 구독 | `sub`, 필터, `pos`, 상태(`replaying`·`live`), 재생 중 보류 묶음, `lagSince` |
| 스트림 구독 | `sub`, 범위, 조각 종류 |
| 다운로드 티켓 | 이 연결이 받은 티켓 목록(연결이 닫히면 무효) |
| 송신 | 송신 큐 바이트, 상한 초과 시작 시각, 마지막 수신 시각, tick 타이머 |
| presence | 마지막 `presence.report` 값(§3.7.8) |

### 3.7 메서드

#### 3.7.1 메서드 등록 표 [제안]

이름은 04 §5.2의 10 행(명령 의도 후보 목록)과 화면별 "명령 의도"를 그대로 메서드 이름으로 받았다. 커널 명령 이름은 10이 정한다. 이 문서는 메서드 → 커널 명령의 대응을 표에 두고, 10의 이름이 바뀌면 이 열만 고친다. 종류: `ctl` 연결 제어, `read` 조회·구독, `cmd` 명령(멱등 키 필수), `adm` 관리.

| 메서드 | 종류 | scope | 결과 | 커널 명령(10이 확정) | 절 |
|---|---|---|---|---|---|
| `hello` | ctl | (인증 전) | `HelloResult` | - | §3.4 |
| `ping` | ctl | read | `{ serverTime }` | - | §3.7.2 |
| `events.subscribe` / `events.unsubscribe` | read | read | §3.5.3 | - | §3.5 |
| `events.read` | read | read | `EventsReadResult` | - | §3.7.3 |
| `view.get` | read | read | `ViewResult` | - | §3.6.3 |
| `stream.subscribe` / `stream.unsubscribe` | read | read | §3.6.4 | - | §3.6.4 |
| `run.partial` | read | read | `RunPartial` | - | §3.6.4 |
| `search.query` | read | read | `SearchResult` | - | §3.7.3 |
| `presence.report` (알림) | read | read | 응답 없음 | - (휘발, §3.7.8) | §3.7.8 |
| `question.answer` | cmd | decide | `CommandResult` | `question.answer` | §3.7.5 |
| `question.proceedWithAssumption` | cmd | decide | 〃 | `question.assume` | 〃 |
| `question.requestReframe` | cmd | decide | 〃 | `question.requestReframe` | 〃 |
| `question.requestInquiry` | cmd | decide | 〃 | `question.requestInquiry` | 〃 |
| `question.delegate` | cmd | decide | 〃 | `question.delegate` | 〃 |
| `question.defer` | cmd | decide | 〃 | `question.defer` | 〃 |
| `contest.file` | cmd | decide | 〃 | `decision.contest`(10 §3.3.4의 이름) | 〃 |
| `autonomous.markSeen` | cmd | decide | 〃 | `autonomous.markSeen` | 〃 |
| `reaction.record` / `reaction.amend` / `reaction.withdraw` | cmd | decide | 〃 | `observation.record`(사람 반응, 15) / `reaction.amend` / `reaction.withdraw` | 〃 |
| `stimulusRound.close` | cmd | decide | 〃 | `stimulusRound.close` | 〃 |
| `agreement.confirm` / `revise` / `narrow` / `decline` / `correctUnderstanding` | cmd | decide | 〃 | `agreement.accept` / `agreement.revise` / `agreement.narrow` / `agreement.decline` / `agreement.correctUnderstanding` | 〃 |
| `result.accept` / `acceptWithConditions` / `requestRevision` / `reopen` | cmd | decide | 〃 | `result.accept` / `result.acceptConditional` / `result.requestRevision` / `result.reopen` | 〃 |
| `obligation.confirmDone` / `defer` / `transfer` | cmd | decide | 〃 | `obligation.resolve` / `obligation.defer` / `obligation.transfer` | 〃 |
| `goal.revise` / `confirmRevision` / `rejectRevision` / `confirmAchieved` | cmd | decide | 〃 | `goal.revise` / `goal.confirmRevision` / `goal.rejectRevision` / `goal.confirmAchieved` | 〃 |
| `concern.propose` / `revise` / `hold` / `resume` / `close` | cmd | decide | 〃 | `concern.propose` / `concern.revise` / `concern.hold` / `concern.resume` / `concern.close` | 〃 |
| `loop.requestTransition` | cmd | decide | 〃 | `loop.transition`(사람 요청) | 〃 |
| `structure.request` | cmd | decide | 〃 | `structure.request` | 〃 |
| `inquiry.requestFrame` / `proposeCandidate` / `markAssumption` / `pinCheck` / `requestDecision` / `stop` | cmd | decide | 〃 | 같은 이름(15·10) | 〃 |
| `expectation.revise` | cmd | decide | 〃 | `expectation.revise` | 〃 |
| `dial.set` / `dial.unset` / `mode.set` | cmd | decide | 〃 | `dial.set` / `dial.unset` / `mode.set` | 〃 |
| `settings.update` | cmd | decide | 〃 | `settings.update`(14 `OrchestrationSettings`, 11 전달 설정) | 〃 |
| `observerProposal.adopt` / `decline` / `snooze` | cmd | decide | 〃 | `proposal.adopt` / `proposal.decline` / `proposal.snooze`(16) | 〃 |
| `work.steer` / `pause` / `resume` / `stop` / `abort` / `requestBrief` | cmd | decide | 〃 | `work.steer` / `work.pause` / `work.resume` / `work.stop` / `work.abort` / `work.requestBrief`(12가 실행 제어로 받는다) | 〃 |
| `composer.submit` | cmd | decide | 〃 | `conversation.input` | 〃 |
| `brief.acknowledge` / `brief.correct` | cmd | decide | 〃 | `brief.acknowledge` / `brief.correct` | 〃 |
| `recovery.resolve` | cmd | decide | 〃 | `recovery.resolve`(12·17) | 〃 |
| `blob.downloadTicket` | read | read | `{ path, expiresAt }` | - | §3.11 |
| `device.list` / `device.rename` / `device.revoke` / `device.createPairingCode` / `device.rotateToken` | cmd·read | devices | §3.7.7 | `device.*`(18) | §3.7.7 |
| `connection.list` / `connection.close` | read·cmd | devices | §3.7.7 | - | §3.7.7 |
| `daemon.status` | read | read | `DaemonStatus` | - | §3.7.8 |
| `protocol.describe` | read | read | `ProtocolDescription` | - | §3.13 |
| `daemon.exitSafeMode` | cmd | decide | `CommandResult` | `runtime.exit_safe_mode`(12 §3.15) | §3.7.8 |
| `composer.preview` | read | decide | `SemanticPreviewResult` | - (12가 해석 초안을 만든다) | §3.7.5 |
| `surprise.report` / `probe.answer` / `probe.score` / `selfReport.submit` | cmd | decide | `CommandResult` | 16 실험 측정 흐름(`surprise.reported`, `probe.answered`, `probe.scored`, `self_report.recorded`) | §3.7.5 |
| `device.expireTokens` | cmd | devices | `CommandResult` | `device.expire_tokens`(18) | §3.7.7 |
| `admin.issueDevice` / `admin.drain` / `admin.setMode` / `admin.safeMode` / `admin.backupNow` / `admin.verify` / `admin.reloadConfig` / `admin.reloadSecrets` | adm | admin | §3.7.8 | 17·18 | §3.7.8 |

- 04가 쓴 `device.pair`는 메서드가 아니라 HTTP `POST /pair`다(토큰을 웹뷰에 보이지 않기 위해, 20 §3.2 `pairing.rs`). `connection.test`는 앱 내부 동작이고 `GET /healthz`와 `ping`을 쓴다.
- 04가 쓴 `goal.revise.proposed`, `brief.acknowledged`, `autonomous.seen`은 이벤트 이름 후보다(09가 확정).
- 16이 요구한 `observer` 뷰는 04의 이름 `observerProposals`로 받았다. 12가 쓴 `conversation.send`는 04의 이름 `composer.submit`으로, 12의 `run.stop`·`run.cancel`은 `work.stop`·`work.abort`로 받았다. 12의 사람 명령 `toolcall.resolve_unknown`은 `recovery.resolve`가 낸다.

#### 3.7.2 공통 타입과 연결 메서드

```ts
export type IsoTime = string;
export type Seq = number;

/** 모든 cmd 메서드의 params에 들어가는 공통 필드 */
export interface CommandParamsBase {
  idempotencyKey: string;   // `ik_<ULID>`(20 APP-D09). 사용자 의도 하나에 하나. 재시도·재접속에도 같은 값
  basisSeq: Seq;            // 이 결정을 내린 화면이 본 뷰의 asOfSeq. 화면 밖 동작(단축키 등)은 그 시점의 클라이언트 위치
  expect?: Array<{ subject: string; revision: number }>; // 레코드 revision을 직접 아는 경우만. 없으면 서버가 basisSeq로 계산(§3.9.3)
  clientTime?: IsoTime;     // 기록용(10 Submission.issuedAt)
}

export interface CommandResult {
  status: "applied" | "accepted" | "gated";
  // applied : 커널이 받아들였고 결과 이벤트가 커밋됐다
  // accepted: 오래 걸리는 일을 접수했다. 결과는 이벤트로 온다(jobId·runId로 연결)
  // gated   : 커널이 자격 부족을 질문으로 바꿨다(10 needs_gate). 명령 자체는 적용되지 않았다
  submissionId: string;     // 10의 `sb_<ULID>`. 같은 멱등 키의 재시도는 같은 값
  duplicate: boolean;       // 이미 처리한 멱등 키라 저장된 결과를 돌려준다
  firstSeq: Seq | null;     // 이 명령이 커밋한 이벤트 seq 범위. 없으면 null
  lastSeq: Seq | null;
  events: Array<{ seq: Seq; id: string; type: string }>;
  created?: Record<string, string>;     // 새로 생긴 레코드. 예: { concernId: "cn_…" }
  notices?: Array<{ code: string; subject: string; message: string }>;  // 10 Notice
  jobId?: string;           // accepted일 때
  runId?: string;           // 실행을 시작·재개한 경우
  questionId?: string;      // gated일 때 생긴 질문
}

// ping
export interface PingParams {}
export interface PingResult { serverTime: IsoTime; headSeq: Seq }
```

- 다른 문서에서 가져오는 타입: `RecordRef`·`RecordKind`·`QuestionScreenKind`·`Gate`(04 §3.0.2, 정본은 08로 옮겨질 수 있다), `LoopId`(14 §3, 정본 08), `Submission`·`Rejection`(10 §3.3·§3.4), `StoredEvent`·`StoreFilter`·`IntakeOutcome`(09), `IncomingRequestInfo`·`ConnectionIdentity`(18). `@helm/protocol`은 이 타입들을 `@helm/domain`에서 타입으로만 가져오고, 데몬 쪽 인터페이스(§3.15)의 09·18 타입은 `@helm/daemon` 안에서만 쓴다.
- `ping`은 진단용 왕복 시간 측정이다. 생존 확인은 `tick`이 한다(§3.10). 클라이언트는 `ping`을 주기적으로 보내지 않는다.

#### 3.7.3 조회 메서드

```ts
// events.read: 이벤트 이력 페이지. 구독과 달리 위치를 남기지 않는다
export interface EventsReadParams {
  after?: Seq;              // 이 seq 다음부터 오름차순
  before?: Seq;             // 이 seq 앞에서 내림차순(최근 이력 거꾸로 채우기)
  limit?: number;           // 기본 100, 최대 1,000
  filter?: EventFilter;
  subjectId?: string;       // SCR-RECORD: 레코드 하나와 관련된 이벤트만(subject.recordIds 포함)
}
export interface EventsReadResult {
  events: EventWire[];      // after면 오름차순, before면 내림차순
  headSeq: Seq;
  storeId: string;
  next?: { after?: Seq; before?: Seq };  // 더 있으면 다음 페이지 위치
}

// search.query: 명령 팔레트(04 §3.25)의 레코드 찾기
export interface SearchParams {
  text: string;             // 1~200자. 표시 번호("질문 14", "q14")도 받는다
  kinds?: RecordKind[];     // 04 §3.0.2 RecordKind
  limit?: number;           // 기본 20, 최대 50
}
export interface SearchResult {
  asOfSeq: Seq;
  hits: Array<{ ref: RecordRef; snippet?: string; concern?: RecordRef }>;  // RecordRef는 04 §3.0.2
}
```

- `after`와 `before`는 함께 쓰지 않는다(`-32602`). 둘 다 없으면 `before: headSeq + 1`과 같다.

#### 3.7.4 뷰 카탈로그 (투영 조회) [제안]

뷰 이름과 파라미터는 04가 화면별 "표시 데이터"에 적은 후보를 받았다. 뷰 모델(`data`)의 타입은 04 해당 절이 소유하고, 정본에서 만드는 규칙은 12가 소유한다. 이 문서는 이름, 파라미터, 키, 기본 태그만 정한다.

| 뷰 | 화면(03 §3.6) | params | 키 | `dependsOn`에 늘 들어가는 집계 태그 | `data` 타입 |
|---|---|---|---|---|---|
| `home` | `SCR-HOME` | `{ goalId?: string }` | `home[:goalId]` | `@home` | 04 §3.1 |
| `brief` | `SCR-BRIEF` | `{ goalId?: string; sinceSeq?: Seq }` (기본: `brief.acknowledge`의 마지막 값) | `brief[:goalId][@since]` | `@brief` | 04 §3.2 |
| `inbox` | `SCR-INBOX` | `{ kinds?: QuestionScreenKind[]; concernId?: string; gate?: Gate }` | `inbox[?…]` | `@inbox` | 04 §3.3 |
| `question` | `SCR-QUESTION` | `{ questionId: string }` | `question:<id>` | - | 04 §3.4 |
| `autonomous` | `SCR-AUTO` | `{ since?: "ack" \| "all"; concernId?: string; contestedOnly?: boolean }` | `autonomous[?…]` | `@autonomous` | 04 §3.5 |
| `concernTree` | `SCR-CONCERNS` | `{ goalId?: string; status?: string[] }` | `concernTree[?…]` | `@concernTree` | 04 §3.6 |
| `concern` | `SCR-CONCERN-OVERVIEW` | `{ concernId: string }` | `concern:<id>` | - | 04 §3.7 |
| `inquiry` | `SCR-INQUIRY` | `{ concernId: string; kind: "fact" \| "want" \| "possibility" \| "outcome" }` | `inquiry:<id>:<kind>` | - | 04 §3.8 |
| `stimulusRound` | `SCR-STIM` | `{ concernId: string; roundNo: number }` | `stimulusRound:<id>:<n>` | - | 04 §3.9. 이미지·긴 문서는 `BlobRef`만 싣는다(§3.11) |
| `work` | `SCR-WORK` | `{ concernId: string }` | `work:<id>` | - | 04 §3.10 |
| `agreement` | `SCR-AGREE` | `{ agreementId: string }` | `agreement:<id>` | - | 04 §3.11 |
| `review` | `SCR-REVIEW` | `{ submissionId: string } \| { workUnitId: string }` | `review:<id>` | - | 04 §3.12 |
| `loopTimeline` | `SCR-LOOPS` | `{ concernId: string; detail: "meaningful" \| "all" }` | `loopTimeline:<id>:<detail>` | - | 04 §3.13 |
| `thread` | `SCR-THREAD` | `{ concernId: string }` + `page` | `thread:<id>` | - | 04 §3.14. assistant-ui `ExternalStoreRuntime`의 `messages` 원천(발췌4 20-11) |
| `evidenceChain` | `SCR-EVIDENCE` | `{ recordId: string; depth?: number }` (기본 3, 최대 8) | `evidenceChain:<id>:<d>` | - | 04 §3.15 |
| `goals` | `SCR-GOALS` | `{}` | `goals` | `@goals` | 04 §3.16 |
| `goal` | `SCR-GOAL` | `{ goalId: string }` | `goal:<id>` | - | 04 §3.16 |
| `dials` | `SCR-DIALS` | `{ scope: "global" \| { goalId: string } \| { concernId: string } }` | `dials:<scope>` | `@dials` | 04 §3.17 |
| `observerProposals` | `SCR-OBSERVER` | `{ status?: string[] }` | `observerProposals` | `@observer` | 04 §3.18 |
| `devices` | `SCR-CONNECT` | `{}` | `devices` | `@devices` | 04 §3.19 |
| `recovery` | `SCR-RECOVERY` | `{}` | `recovery` | `@recovery` | 04 §3.20 |
| `records` | `SCR-RECORD` | `{ subjectId: string }` + `page` | `records:<id>` | - | 04 §3.23. 비밀은 데몬이 숨긴다(18) |
| `tray` | `SCR-TRAY` | `{}` | `tray` | `@home`, `@inbox` | 04 §3.24(트레이 요약: 선택 필요 수, 진행 중 요약) |
| `metrics` | `SCR-OBSERVER`·설정의 지표 보기 | `{ metricIds?: string[]; window?: "7d" \| "14d" \| "30d" }` | `metrics[?…]` | `@metrics` | 16 §3.24(지표 값·스냅샷·근거 seq). 16은 5분 캐시를 둔다. `asOfSeq`는 캐시를 만든 시점 |
| `evaluation` | 2주 평가 보고 | `{ reportId?: string }` | `evaluation[:id]` | `@metrics` | 16(평가 보고) |

- 뷰 키는 `view.get` 응답의 `key`가 정본이다. 클라이언트가 직접 만들지 않는다(파라미터 정규화 규칙을 서버 한 곳에 둔다).
- 모든 뷰의 `data` 안 레코드 참조(`RecordRef`)에는 `revision`과 `revisionSeq`(그 revision이 생긴 seq)를 넣는다(04·12에 대한 요구). 클라이언트가 `expect`를 직접 만들 때와 화면의 "바뀜" 표시에 쓴다.
- `freshness: "failed"`는 오류가 아니라 정상 응답이다. 데몬이 그 뷰를 만들지 못한 이유를 `staleReason`에 넣는다(04 §3.0.3의 오류 상태). 뷰 이름이 틀리면 `2004`, 대상이 없으면 `2005`다.

#### 3.7.5 명령 메서드 [제안]

공통 규칙:

- 모든 명령 메서드의 params는 `CommandParamsBase & <메서드별 필드>`다. 결과는 `CommandResult`다. 실패는 §3.3.4의 3000번대·5000번대 오류다.
- 데몬은 명령을 10의 제출 envelope(10 §3.3.1)로 바꾼다. `channel: "human_client"`, `actor: { kind: "human", deviceId }`(localAdmin이면 `deviceId` 없음), `provenance.adapterId: "client:<client.kind>"`, `provenance.externalRunId: <connection.id>`로 서버가 채운다. 클라이언트가 보낸 행위자·채널·provenance 값은 받지 않는다(스키마에 필드가 없다). 실행 후보의 `x-helm-client` 헤더 대신 `hello.client`가 이 역할을 한다(canon-2 §8.5).
- 사람의 결정은 이 메서드로만 들어온다. assistant-ui 도구 카드의 버튼도 도구 결과(`addToolResult`)를 쓰지 않고 이 메서드를 부른다(발췌4 20-9, v0.3 12 §11.2).
- 명령은 화면 상태를 바꾸지 않는다. 화면은 결과 이벤트의 무효화로 바뀐다(§3.5.9, §3.6.3).

```ts
// ── 질문 (11·04 §3.4) ─────────────────────────────────────────
export interface QuestionAnswerParams extends CommandParamsBase {
  questionId: string;
  optionId?: string;        // 데몬이 준 선택지 ID. "narrowed"는 범위 줄여 허락
  answer?: string;          // 자유 답(정보 질문). optionId와 answer 중 하나 이상
  edits?: string;           // 고쳐서 정하기(자연어)
  narrowing?: string;       // optionId = "narrowed"일 때 필수
}
export interface QuestionIdParams extends CommandParamsBase { questionId: string }
export type QuestionProceedWithAssumptionParams = QuestionIdParams;
export interface QuestionRequestReframeParams extends QuestionIdParams { note: string }
export interface QuestionRequestInquiryParams extends QuestionIdParams { note?: string }
export interface QuestionDelegateParams extends QuestionIdParams { note?: string }
export interface QuestionDeferParams extends QuestionIdParams {
  until: { boundary: "nextWorkBoundary" | "nextBrief" } | { at: IsoTime } | { condition: string };
}

// ── 이의 (05 §3.3, 04 §3.26) ──────────────────────────────────
export interface ContestFileParams extends CommandParamsBase {
  target: ContestTarget;
  reason?: string;
  noReason?: boolean;       // "이유는 말로 못 하겠음"(결정 18의 이유 없는 반응과 같은 취지)
  desiredEffect: "reopen" | "ask_next_time" | "note_only";
}
export type ContestTarget =
  | { kind: "record"; id: string }                 // 선택, 판단, 상황 판정, 루프 계획·전환, 기준 후보, 모드 라우팅 등
  | { kind: "evidenceLink"; fromId: string; toId: string }
  | { kind: "criterionVerdict"; submissionId: string; criterionId: string };

export interface AutonomousMarkSeenParams extends CommandParamsBase {
  upToSeq: Seq;             // 이 seq까지의 에이전트가 정한 것을 봤음
  concernId?: string;       // 거른 화면에서 누른 경우
}

// ── 원함 탐구 반응 (15, 04 §3.9) ───────────────────────────────
export interface ReactionRecordParams extends CommandParamsBase {
  stimulusId: string;
  roundNo: number;
  kind: "strength" | "no_reason" | "rewrite" | "near" | "triad_odd";
  strength?: -2 | -1 | 0 | 1 | 2;   // 아주 싫음 ~ 아주 좋음(1~5 키를 -2~2로)
  rewrite?: string;                  // "이것과 비슷한데 더 ~하게"
  triad?: { stimulusIds: [string, string, string]; oddId: string; reason?: string; cannotSay?: boolean };
  target?: { element?: string } | { region?: { x: number; y: number; w: number; h: number } };  // 이미지 영역은 0~1 비율
  reason?: string;
}
export interface ReactionAmendParams extends CommandParamsBase { reactionId: string; reason: string }
export interface ReactionWithdrawParams extends CommandParamsBase { reactionId: string; note?: string }
export interface StimulusRoundCloseParams extends CommandParamsBase { concernId: string; roundNo: number }

// ── 작업 합의 C (11·04 §3.11) ──────────────────────────────────
export interface AgreementConfirmParams extends CommandParamsBase { agreementId: string; exclude?: string[] }
export interface AgreementReviseParams extends CommandParamsBase { agreementId: string; edits: string | Array<{ item: string; text: string }> }
export interface AgreementNarrowParams extends CommandParamsBase { agreementId: string; note: string }
export interface AgreementDeclineParams extends CommandParamsBase { agreementId: string; note?: string }
export interface AgreementCorrectUnderstandingParams extends CommandParamsBase { agreementId: string; part: string; note: string }

// ── 결과 확인 A (04 §3.12) ─────────────────────────────────────
export interface ResultAcceptParams extends CommandParamsBase { submissionId: string; note?: string }
export interface ResultAcceptWithConditionsParams extends CommandParamsBase { submissionId: string; conditions: string[] }
export interface ResultRequestRevisionParams extends CommandParamsBase { submissionId: string; criteria: string[]; note: string }
export interface ResultReopenParams extends CommandParamsBase { submissionId: string; to: "inquiry"; note: string }
export interface ObligationConfirmDoneParams extends CommandParamsBase { obligationId: string; note?: string }
export interface ObligationDeferParams extends CommandParamsBase { obligationId: string; until: IsoTime | { condition: string }; reason: string }
export interface ObligationTransferParams extends CommandParamsBase { obligationId: string; toConcernId: string }

// ── Goal (04 §3.16) ────────────────────────────────────────────
export interface GoalReviseParams extends CommandParamsBase { goalId: string; field: "statement" | "successCriteria" | "constraints"; value: string }
export interface GoalConfirmRevisionParams extends CommandParamsBase { goalId: string; revisionQuestionId?: string; edits?: string }
export interface GoalRejectRevisionParams extends CommandParamsBase { goalId: string; revisionQuestionId?: string; note?: string }
export interface GoalConfirmAchievedParams extends CommandParamsBase { goalId: string }

// ── Concern·루프·구조 (04 §3.6·§3.7) ────────────────────────────
export interface ConcernProposeParams extends CommandParamsBase { utterance: string; goalId?: string; parentId?: string }
export interface ConcernReviseParams extends CommandParamsBase { concernId: string; field: "title" | "description"; value: string }
export interface ConcernHoldParams extends CommandParamsBase { concernId: string; until?: IsoTime }
export interface ConcernResumeParams extends CommandParamsBase { concernId: string }
export interface ConcernCloseParams extends CommandParamsBase { concernId: string; reason?: string }
export interface LoopRequestTransitionParams extends CommandParamsBase { concernId: string; to: LoopId; reason?: string }  // LoopId는 14 §3
export interface StructureRequestParams extends CommandParamsBase { concernId: string; op: "split" | "merge"; note: string; withConcernId?: string }

// ── 탐구 (15, 04 §3.8) ─────────────────────────────────────────
export interface InquiryRequestFrameParams extends CommandParamsBase { concernId: string; op: "add" | "merge"; note: string }
export interface InquiryProposeCandidateParams extends CommandParamsBase { concernId: string; text: string }
export interface InquiryMarkAssumptionParams extends CommandParamsBase { concernId: string; refOrText: string }
export interface InquiryPinCheckParams extends CommandParamsBase { concernId: string; checkId: string }
export interface InquiryRequestDecisionParams extends CommandParamsBase { concernId: string }
export interface InquiryStopParams extends CommandParamsBase { concernId: string; handOff: boolean }
export interface ExpectationReviseParams extends CommandParamsBase { expectationId: string; dueAt?: IsoTime; note?: string }

// ── 다이얼·모드·설정 (14) ───────────────────────────────────────
export type DialScope = "global" | { goalId: string } | { concernId: string };
export interface DialSetParams extends CommandParamsBase { scope: DialScope; key: string; value: unknown }   // key·value 스키마는 14의 다이얼 표
export interface DialUnsetParams extends CommandParamsBase { scope: DialScope; key: string }
export interface ModeSetParams extends CommandParamsBase { scope: DialScope; name: string }   // 모드 이름은 14
export interface SettingsUpdateParams extends CommandParamsBase { section: "orchestration" | "delivery" | "display"; patch: Record<string, unknown> } // 스키마는 14·11

// ── 관찰 제안 (16) ──────────────────────────────────────────────
export interface ObserverProposalAdoptParams extends CommandParamsBase { proposalId: string; edits?: string }
export interface ObserverProposalDeclineParams extends CommandParamsBase { proposalId: string; reason?: string }
export interface ObserverProposalSnoozeParams extends CommandParamsBase { proposalId: string; until: IsoTime }

// ── 진행 작업 제어 (12, 04 §3.10) ───────────────────────────────
export interface WorkSteerParams extends CommandParamsBase { workUnitId: string; note: string }
export interface WorkIdParams extends CommandParamsBase { workUnitId: string }
export type WorkPauseParams = WorkIdParams;        // 도구 실행이 끝나는 지점에서 멈춤
export type WorkResumeParams = WorkIdParams;
export type WorkStopParams = WorkIdParams;         // 안전한 경계에서 중단
export type WorkAbortParams = WorkIdParams;        // 즉시 끊기. 복구 필요 상태가 될 수 있다
export type WorkRequestBriefParams = WorkIdParams;

// ── 대화 입력 (04 §3.14) ────────────────────────────────────────
export interface ComposerSubmitParams extends CommandParamsBase {
  scope: { concernId: string } | { global: true };    // global: 홈의 입력창(새 Goal·Concern 초안 요청 등)
  text: string;                                       // 최대 32 KiB
  attachments?: BlobRef[];                            // 먼저 업로드한 파일(§3.11)
  whenBusy?: "followUp" | "steer";                    // 실행 중일 때. 기본 followUp
}

// composer.preview (read 종류, scope decide): 보내기 전에 입력의 뜻을 미리 본다(21 SemanticPreviewVM, 05 자연어 → 상태 규칙)
export interface ComposerPreviewParams {
  scope: ComposerSubmitParams["scope"] | { goalId: string } | { workUnitId: string } | { questionId: string };
  text: string;
}
export interface SemanticPreviewResult {          // 21 §SemanticPreviewVM과 같은 모양
  utteranceDraftId: string;                       // composer.submit에 함께 보내면 같은 해석을 쓴다
  interpretations: Array<{
    id: string;
    as: "question" | "constraint_change" | "choice" | "request" | "criterion_change" | "contest" | "chat";
    summary: string;
    affects: RecordRef[];
    impact: "low" | "high";
  }>;
}
// composer.submit에 선택 필드를 더한다: utteranceDraftId?: string; choice?: { interpretationId: string } | { asChat: true }

// ── 실험 측정 (16) ──────────────────────────────────────────────
export interface SurpriseReportParams extends CommandParamsBase { subjectId: string; subjectKind: string; note?: string }
export interface ProbeAnswerParams extends CommandParamsBase { probeId: string; answer: string | Record<string, unknown> }
export interface ProbeScoreParams extends CommandParamsBase { probeId: string; score: number; note?: string }
export interface SelfReportSubmitParams extends CommandParamsBase { instrument: string; values: Record<string, number | string> }

// ── 안전 모드 해제 (12 §3.7.6, 17 §3.4.6) ───────────────────────
export interface DaemonExitSafeModeParams extends CommandParamsBase { reason?: string }

// ── 복귀 요약·복구 ──────────────────────────────────────────────
export interface BriefAcknowledgeParams extends CommandParamsBase { upToSeq: Seq }   // 사람 단위 마지막 확인 위치
export interface BriefCorrectParams extends CommandParamsBase { line: string; note: string }
export interface RecoveryResolveParams extends CommandParamsBase {
  workUnitId: string;
  action: "rerunFromCheckpoint" | "leaveAsIs" | "createCheckTask";   // 03 §3.2.3 복구 항목의 세 동작
  note?: string;
}
```

메서드별 결과의 특이점:

| 메서드 | `status` | `created`·`runId` |
|---|---|---|
| `composer.submit` | `applied`(입력이 기록됨). 실행은 이어서 런타임이 시작한다 | 실행이 바로 시작되면 `runId` |
| `concern.propose` | `applied` | `{ concernId }`(초안 Concern) |
| `work.pause` / `work.stop` | `accepted`(경계에 이르면 이벤트) | `runId` |
| `work.abort` | `applied`(중단 기록) | - |
| `stimulusRound.close` | `applied` | 다음 라운드 준비는 이벤트로 |
| `recovery.resolve` (`rerunFromCheckpoint`) | `accepted` | `runId` |
| 그 밖 | `applied` 또는 `gated` | - |

`basisSeq`가 쓰이지 않는 명령: `reaction.*`, `composer.submit`, `brief.acknowledge`, `autonomous.markSeen`은 대상의 낡음 검사를 하지 않는다(10의 `subjects`가 빈 목록). 그래도 형식을 하나로 두기 위해 필드는 필수다.

#### 3.7.6 파일 메서드

`blob.downloadTicket`은 §3.11.2에 있다. 업로드는 HTTP만 쓰고 JSON-RPC 메서드가 없다(§3.11.3).

#### 3.7.7 기기·연결 관리

```ts
export interface DeviceInfo {
  deviceId: string;                 // `dv_<ULID>`
  name: string;                     // "MacBook Air", "기기 5 Windows 데스크톱"
  platform: "macos" | "windows" | "linux";
  clientKind: "desktop" | "tui" | "cli";
  pairedAt: IsoTime;
  lastSeenAt: IsoTime | null;
  lastListener: ListenerKind | null;
  revokedAt: IsoTime | null;
  scopes: Scope[];
  current: boolean;                 // 이 요청을 보낸 기기
}

// device.list (read 성격이나 scope는 devices)
export interface DeviceListResult { devices: DeviceInfo[] }

// device.rename (cmd)
export interface DeviceRenameParams extends CommandParamsBase { deviceId: string; name: string }

// device.revoke (cmd). 자기 자신도 폐기할 수 있다(그 연결은 응답 뒤 4009로 닫힌다)
export interface DeviceRevokeParams extends CommandParamsBase { deviceId: string; reason?: string }

// device.createPairingCode: 이미 페어링된 기기에서 새 기기용 코드를 만든다(18이 허용 여부 결정)
export interface DeviceCreatePairingCodeParams extends CommandParamsBase { name?: string; ttlSec?: number }  // 기본 600, 최대 3,600
export interface DeviceCreatePairingCodeResult extends CommandResult { code: string; expiresAt: IsoTime }

// device.expireTokens: 그 기기의 토큰을 만료로 표시해 다음 접속에서 회전을 강제한다(17 `helm devices expire-tokens`, 18)
export interface DeviceExpireTokensParams extends CommandParamsBase { deviceId: string }

// device.rotateToken: 현재 기기의 토큰을 바꾼다. 새 토큰은 이 응답에만 실린다
export interface DeviceRotateTokenParams extends CommandParamsBase {}
export interface DeviceRotateTokenResult extends CommandResult { token: string }

// connection.list / connection.close
export interface ConnectionInfo {
  connectionId: string; deviceId: string | null; listener: ListenerKind; client: ClientInfo;
  openedAt: IsoTime; protocol: number; subscriptions: number; presence?: PresenceState;
}
export interface ConnectionListResult { connections: ConnectionInfo[] }
export interface ConnectionCloseParams extends CommandParamsBase { connectionId: string }
```

- `device.rotateToken`의 응답에는 토큰 값이 실린다. 데스크톱 앱에서 이 메서드는 웹뷰가 아니라 Rust가 불러야 토큰이 웹뷰를 거치지 않는다(20 APP-D02). 그래서 20은 이 메서드를 Rust 쪽 IPC 명령으로 감싸거나, 1차에서는 노출하지 않고 "다시 페어링"으로 대신한다(§7 Q-07).
- 페어링 HTTP(`POST /pair`, WSS 경로):

```http
POST /pair HTTP/1.1
Content-Type: application/json

{"code":"K7Q-4XM-92P","device":{"name":"MacBook Air","platform":"macos","clientKind":"desktop","publicKey":"<선택, 18>"}}
```

  성공: `200 {"deviceId":"dv_…","token":"<한 번만 보임>","serverId":"…"}`. 실패: `400`·`429` + 본문 `{"error": JsonRpcError}`(코드 `1009`·`1011`). 코드는 한 번만 쓰이고, 코드당 시도 5회, 출처별 분당 5회(18이 확정). `tailnet` 리스너에서만 받는다.
- SSH 경로의 페어링은 `ssh <서버> helm device issue --name <이름>`(20 `pairing_via_ssh`)으로 한다. 관리 CLI가 `local` 리스너에 `localAdmin`으로 붙어 `admin.issueDevice`를 부르고 토큰을 표준 출력으로 돌려준다. SSH 키를 가진 사람은 이미 셸 권한이 있으므로 별도 코드가 필요 없다.

#### 3.7.8 상태·진단·관리·presence

```ts
// daemon.status
export interface DaemonStatus {
  server: HelloResult["server"];
  uptimeSec: number;
  log: { storeId: string; headSeq: Seq; sizeBytes: number; lastBackupAt: IsoTime | null };
  runtime: { state: "running" | "paused" | "unavailable"; activeRuns: number; queuedWork: number };
  scheduler: { nextTimerAt: IsoTime | null; overdueTimers: number };
  observer: { lastRunAt: IsoTime | null; lastResult: "ok" | "failed" | null };
  connections: number;
  recoveryItems: number;          // 복구 판단이 필요한 항목 수(SCR-RECOVERY 배지)
  warnings: Array<{ key: string; args?: Record<string, string> }>;   // 05 문구 키
}

// presence.report: 클라이언트 → 서버 알림(응답 없음). 활동 상태와 보고 있는 화면. 휘발 정보로 받는다
export type PresenceState = "active" | "idle" | "hidden" | "locked";
export interface PresenceReportParams {
  state: PresenceState;
  screen?: string;                // 03 화면 ID. 예: "SCR-INBOX"
  objectId?: string;              // 보고 있는 레코드
}

// admin.* (local 리스너 + localAdmin만)
export interface AdminIssueDeviceParams extends CommandParamsBase { name: string; platform: DeviceInfo["platform"]; clientKind: DeviceInfo["clientKind"] }
export interface AdminIssueDeviceResult extends CommandResult { deviceId: string; token: string }
export interface AdminDrainParams extends CommandParamsBase { reason: string; restartExpectedMs?: number }
export interface AdminSetModeParams extends CommandParamsBase { mode: "normal" | "readOnly"; reason: string }
export interface AdminSafeModeParams extends CommandParamsBase { on: boolean; reason?: string }
export interface AdminBackupNowParams extends CommandParamsBase {}     // accepted + jobId, 결과는 이벤트(17)
export interface AdminVerifyParams extends CommandParamsBase { full?: boolean; blobs?: boolean; anchors?: boolean }  // accepted + jobId
export interface AdminReloadParams extends CommandParamsBase {}        // admin.reloadConfig, admin.reloadSecrets
```

- `presence.report`는 알림이라 응답이 없다. 상태나 화면이 바뀔 때만 보낸다(최소 간격 2초, 같은 값은 다시 보내지 않는다). 형식이 틀리면 서버는 조용히 버리고 운영 로그에만 남긴다. 데몬은 연결별 마지막 값을 들고, 연결이 닫히면 지운다. 데몬 안에서 이 값을 쓰는 곳: 질문 전달 방식(11)의 "사람이 지금 보고 있는가" 입력, 거시 스케줄러(14)의 접속 상태 신호, 관찰 지표(16 AS-5)의 활동 시간. 정본 로그에 남길지와 그 간격은 16·09가 정한다. 16이 요구한 열람 기록(`view.record`, 이벤트 `view.opened`)은 별도 메서드를 두지 않고 이 알림의 `screen`·`objectId` 변화로 데몬이 만든다(16 §5.2의 19 요구 (2)). 프로토콜은 휘발 입력으로만 받는다.
- `daemon.status`는 17의 `OpsStatus`(17 §3.11.1)를 줄여 만든다. `warnings`의 키는 17의 점검 ID(17 §3.11.2)다. `read` scope로 누구나 부를 수 있다. 자세한 운영 진단(디스크, 로그 꼬리)은 관리 CLI가 `local`에서 직접 본다(17).
- `admin.*`의 의미(종료 예산, 읽기 전용 전이, 백업 절차)는 17이 소유한다. 이 문서는 메서드 이름과 scope만 정한다.

### 3.8 알림 전체 목록

#### 3.8.1 서버 → 클라이언트

| 알림 | 언제 | params 타입 | 절 |
|---|---|---|---|
| `hello.challenge` | 업그레이드 직후 첫 메시지 | `HelloChallengeParams` | §3.4.2 |
| `events` | 이벤트 구독의 재생·실시간 묶음 | `EventsNotificationParams` | §3.5.3 |
| `stream.chunk` | 휘발 조각 | `StreamChunkParams` | §3.6.4 |
| `tick` | `tickIntervalMs`마다 | `TickParams` | §3.10.1 |
| `server.modeChanged` | 데몬 모드가 바뀜(`normal`·`safeMode`·`readOnly` 사이) | `{ mode: DaemonMode; since: IsoTime; reason?: string }` | §3.7.8 |
| `server.shutdown` | 데몬 종료 시작 | `{ reason: "restart" \| "upgrade" \| "stop"; restartExpectedMs?: number; drainDeadline: IsoTime }`. 업그레이드면 `restartExpectedMs` 30,000(17 §3.4.3) | §3.10.3 |
| `connection.closing` | 서버가 연결을 닫기 직전 | `{ kind: string; message: string }` (`kind`는 §3.3.4의 kind 또는 `slowConsumer`) | §3.4.7 |

```ts
export interface TickParams {
  serverTime: IsoTime;
  headSeq: Seq;
  mode: DaemonMode;
}
```

#### 3.8.2 클라이언트 → 서버

| 알림 | params | 동작 |
|---|---|---|
| `presence.report` | `PresenceReportParams` | 연결별 활동 상태 갱신(§3.7.8) |
| `$/cancelRequest` | `{ id: string }` | 그 요청이 아직 처리 중이면 중단하고 `5004 request.cancelled`로 응답한다. 이미 응답했거나 없는 id면 무시한다. 명령은 커밋 전에만 취소된다. 커밋 뒤면 정상 결과를 보낸다(LSP의 `$/cancelRequest` 관례 [지식], pi-protocol `cancel`과 같은 의미, pi-api-facts-2 §6.1) |

#### 3.8.3 OS 알림과 전달 결정

- 프로토콜에는 별도 푸시 알림 채널이 없다. 앱의 OS 알림은 11의 전달 결정이 기록된 영속 이벤트(이름은 09·11. 후보 `question.delivered`)를 받았을 때만 띄운다(20 APP-D11, canon-3 §10/19 "알림 이벤트는 질문 전달 방식의 결과로만").
- 전달 이벤트 payload에 필요한 것(11·09에 대한 요구): `questionId`, 전달 방식, 긴급도, 알림 제목·본문의 문구 키와 인자(결정 37, 05), 딥 링크 대상(03 §3.5.4), 대상 기기(모든 기기 / 특정 기기 / 활동 중인 기기 우선).
- 재전송으로 받은 전달 이벤트(`caughtUp` 전 알림에 들어 있던 것)는 하나씩 OS 알림으로 띄우지 않는다. 앱은 "접속하지 않은 동안 전달된 질문 n개"로 한 번 묶어 보인다(20).

### 3.9 멱등성

#### 3.9.1 멱등 키 [제안]

- 형식: `ik_<ULID>`(20 APP-D09). 사용자 의도 하나(버튼 한 번, 보내기 한 번)에 하나를 만든다. 같은 의도를 다시 보낼 때(응답 유실, 재접속, 시간 초과)는 같은 키와 같은 params를 보낸다. 다른 의도에 키를 다시 쓰지 않는다.
- 클라이언트는 명령을 보내기 전에 진행 중 명령함(20: IndexedDB, TUI: 파일)에 `{key, method, params, createdAt}`를 먼저 저장한다. 응답(성공이든 커널 거부든)을 받으면 지운다. 연결 오류·시간 초과면 남겨 두고 재접속 뒤 같은 키로 다시 보낸다.
- 진행 중 명령함의 항목이 `pendingCommandMaxAgeMs`(기본 24시간)보다 오래되면 자동으로 다시 보내지 않고 사용자에게 보인다(OpenClaw iOS 송신함의 만료 규칙, S4 openclaw-gateway §3.3). 이 값은 서버 보관 기간(`idempotencyWindowMs`, 7일)보다 짧으므로 자동 재전송이 보관 기간을 넘는 일은 없다.

#### 3.9.2 서버 처리

```text
on 명령 메서드 요청(params):
  1. params 스키마 검사(-32602), scope 검사(1010), 데몬 모드 검사(readOnly → 5003, draining → 5001)
  2. fingerprint ← sha256(정규화 JSON {method, params에서 idempotencyKey와 clientTime을 뺀 것})
  3. scopeKey ← "human_client|" + (deviceId ?? "local") + "|" + idempotencyKey   (10 §3.3.1: actor + channel + key)
  4. 같은 scopeKey가 지금 처리 중이면: 최대 10초 기다려 그 결과를 duplicate: true로 돌려준다. 넘으면 3007(retryAfterMs 1000)
  5. submission ← 제출 envelope 만들기(§3.7.5 공통 규칙), expect 계산(§3.9.3)
  6. outcome ← 09.intake(submission, scopeKey, fingerprint)      // 09가 멱등 저장과 커널 호출을 한 트랜잭션에서 한다
       - 저장된 결과가 있고 fingerprint가 같다 → 저장된 결과(duplicate: true)
       - 저장된 결과가 있고 fingerprint가 다르다 → 3006 idempotency.keyReused
  7. outcome → CommandResult 또는 오류(§3.3.4 대응)
  8. 커밋이 있었으면 §3.5.9 순서대로 이벤트 알림을 큐에 넣은 뒤 응답을 큐에 넣는다
```

- 저장되는 결과: 커널까지 간 모든 결과(`applied`, `gated`, 커널 거부 3001~3003, revision 충돌 3004). 같은 키로 다시 보내면 같은 거부가 다시 온다. 상황이 바뀐 뒤 다시 시도하려면 새 키가 필요하다(v0.2 SQLite 실행 후보의 동작과 같다, canon-2 §9.6 해석).
- 저장되지 않는 결과: 1단계에서 끝난 오류, `5002`, `5004`(커밋 전 취소), 커밋 전에 난 `-32603`. 같은 키로 다시 보내도 된다(`retryable`을 보고 판단).
- 보관 기간은 최소 `idempotencyWindowMs`(7일)이다. 09의 `commands` 테이블에 보관하므로 데몬 재시작 뒤에도 유지된다. 09가 더 오래 보관하면 그대로 따른다.
- JSON-RPC 요청 `id`는 연결 안의 응답 짝짓기용일 뿐이다. 멱등 키로 쓰지 않는다(happy-agent의 `mutationId`처럼 반향용 값과 멱등 키를 섞은 혼동을 피한다, happy-agent 조사 §9 피할 것 5).

#### 3.9.3 `basisSeq`에서 `expect` 만들기 [제안]

10은 사람의 확정 명령에 대상 레코드의 revision(`expect`)을 요구한다(10 §3.3.4). 화면은 seq 하나(`basisSeq`)만 알면 되도록, 프로토콜 계층이 다음과 같이 `expect`를 만든다.

```text
if params.expect 있음: expect ← params.expect                 // 클라이언트가 revision을 직접 안 경우
else:
  expect ← []
  for subject in 10.commandSpec(type).subjects(payload):       // 이 명령의 낡음 검사 대상
    r ← 09.recordRevision(subject)                            // { revision, revisionSeq }
    if r 없음: → 3005 command.targetNotFound
    if r.revisionSeq > params.basisSeq:                       // 화면을 본 뒤 대상이 바뀌었다
      → 3004 command.revisionConflict { subject, expected: "≤ basisSeq", current: r.revision, basisSeq }
    expect.push({ subject, revision: r.revision })
```

- 5~6단계(§3.9.2)는 같은 이벤트 루프 턴에서 동기로 실행하므로, `expect`를 만든 뒤 커밋 전에 대상이 바뀌는 일은 없다(09 single writer).
- 대상과 관계없는 변화(예: 질문의 전달 기록)로 revision이 올라가면 사람이 불필요한 충돌을 겪는다. 그래서 revision은 사람의 판단에 영향을 주는 변경에서만 올라가야 한다(08·10에 대한 요구, §5.2).

### 3.10 생존 확인과 재접속

#### 3.10.1 생존 확인 [제안]

| 쪽 | 장치 | 값 | 넘으면 |
|---|---|---|---|
| 서버 | WebSocket ping | 15초마다 | - |
| 서버 | 무수신 감시(pong 포함 모든 프레임) | 45초 | 소켓 파기 |
| 서버 | `tick` 알림 | `tickIntervalMs`(15초)마다. 송신 큐가 차 있어도 우선 보낸다(§3.5.8) | - |
| 클라이언트 | 감시 타이머(어떤 메시지든 받으면 다시 시작) | `clientTimeoutMs`(35초) | 4000으로 닫고 재접속 |
| 클라이언트(SSH 경로) | ssh `ServerAliveInterval=15`, `ServerAliveCountMax=3` | 45초 | ssh 종료 → 전송 종료 |

- 클라이언트는 앱 수준 ping을 보내지 않는다. WebSocket pong은 전송 구현(Rust tungstenite, Node `ws`)이 자동으로 답한다 [지식]. 웹뷰 JavaScript에서는 WebSocket ping이 보이지 않으므로 클라이언트 쪽 감시는 `tick`으로 한다(P-12).
- happy-agent는 서버 하트비트만 있고 클라이언트 쪽 무응답 감지가 없어 반쯤 열린 연결이 오래 남을 수 있다(happy-agent 조사 §6). Helm은 양쪽에 감시를 둔다.

#### 3.10.2 클라이언트 연결 상태 기계 [제안]

20의 사용자용 연결 상태(04 §3.0.4)는 이 상태 기계의 상태와 오류 kind로 계산한다. 이 표는 `@helm/client`의 `HelmClient`가 구현한다.

| 상태 | 사건 | 가드 | 다음 상태 | 부수 효과 |
|---|---|---|---|---|
| `idle` | `start()` | - | `connecting` | 전송 열기 |
| `connecting` | 전송 열림 | - | `handshaking` | 챌린지 타이머 5초 |
| `connecting` | 전송 실패(네트워크, ssh, HTTP 5xx) | - | `backoff` | 시도 횟수 +1 |
| `connecting` | HTTP 401·403 | - | `needsUser` | kind `auth.failed`(또는 20 분류) |
| `handshaking` | `hello.challenge` | `serverId` 일치(또는 첫 연결) | `handshaking` | `hello` 전송(서명이 필요하면 `sign` 콜백) |
| `handshaking` | `hello.challenge` | `serverId` 불일치 | `needsUser` | kind `server.mismatch`(클라이언트 내부) |
| `handshaking` | `hello` 성공 | - | `syncing` | 정책 저장, 진행 중 명령 재전송 시작, 저장된 위치로 이벤트 구독 복원, 스트림 구독 복원 |
| `handshaking` | `hello` 오류 | kind ∈ {`protocol.unsupported`, `auth.failed`, `auth.revoked`, `auth.unknownDevice`, `auth.methodNotAllowed`} | `needsUser` | 사용자에게 할 일 표시 |
| `handshaking` | `hello` 오류 | kind ∈ {`auth.challengeStale`, `rateLimited`, `daemon.draining`} | `backoff` | `retryAfterMs` 하한 |
| `handshaking` | 챌린지 5초 초과, 4001 | - | `backoff` | |
| `syncing` | 모든 이벤트 구독이 `caughtUp` | - | `ready` | 낡은 열린 뷰 다시 받기 |
| `syncing` | 구독이 `2001` | - | `syncing` | 스냅샷 경로(§3.5.5) |
| `ready` | gap 3회/분 | - | `backoff` | 1000으로 닫기, 진단 기록 |
| `syncing`·`ready` | 감시 시간 초과 | - | `backoff` | 4000으로 닫기 |
| `syncing`·`ready` | 닫힘 1001·1011·4008·4009(폐기 아님) | - | `backoff` | 4008이면 첫 대기 0 |
| `syncing`·`ready` | 닫힘 1008·4009(폐기) | - | `needsUser` | 직전 `connection.closing`의 kind |
| `backoff` | 대기 끝, 네트워크 복구·OS 깨어남·창 포커스(20) | `retryAfterMs` 하한 지남 | `connecting` | |
| `needsUser` | 사용자 "다시 시도"·재페어링 완료 | - | `connecting` | 시도 횟수 0 |
| 모든 상태 | `stop()` | - | `closed` | 1000으로 닫기 |

- `syncing` 동안 사람의 결정 명령은 보내지 않는다(04 §3.0.4 "다시 맞추는 중"은 결정 동작을 막는다). 진행 중 명령함의 재전송은 `syncing`에 들어가자마자 한다(이미 사람이 내린 결정이다).

#### 3.10.3 재접속 백오프 [제안]

```text
attempt: 연속 실패 횟수(ready 상태가 30초 이상 유지되면 0으로)
d ← min(30,000, 500 × 2^attempt)                 // 0.5s, 1s, 2s, 4s, … 최대 30s
delay ← d/2 + random() × d/2                      // 반 지터(equal jitter)
delay ← max(delay, retryAfterMs ?? 0, restartExpectedMs ?? 0)
if 직전 닫힘이 4008(느린 소비자): delay ← max(0, retryAfterMs ?? 0)   // 바로 다시
```

- 자동 재접속을 멈추는 경우: HTTP 401·403, `protocol.unsupported`, `auth.failed`, `auth.revoked`, `auth.unknownDevice`, `auth.methodNotAllowed`, `pairing.invalidCode`, `serverId` 불일치. 사람이 고쳐야 풀리는 실패다(OpenClaw `reconnect-policy.ts`의 인증 오류 목록과 같은 생각, S4 openclaw-gateway §1.5).
- 그 밖의 실패는 포기하지 않는다. 30초 간격으로 계속 시도하고, 화면은 "연결 안 됨"을 보인다(04 §3.0.4).
- 경로 바꾸기(WSS ↔ SSH)는 네트워크 계열 실패에서만 하고, 연결된 동안에는 바꾸지 않는다(20 APP-D05). 경로를 바꿔도 위치·진행 중 명령함은 같은 `serverId` 아래에서 그대로 쓴다. 두 경로의 의미가 같기 때문이다(결정 38).

### 3.11 파일과 큰 데이터 [결정 31, 세부 제안]

#### 3.11.1 원칙과 한도

- WebSocket 메시지에 파일 바이트(base64 포함)를 싣지 않는다. 이벤트와 뷰에는 `BlobRef`만 싣는다(pi-web의 media id 참조, OpenClaw가 base64 첨부로 프레임 한도를 넘긴 문제, pi-cases-notes §12.1-8).
- 파일은 내용 주소(SHA-256)로 저장한다. 저장 위치와 정리는 17(예: `/srv/volumes/helm/blobs/<sha256 앞 2자>/<sha256>`).

```ts
export interface BlobRef {
  blobId: string;            // `bl_<ULID>` [제안: 접두사 08에 요구]
  sha256: string;            // 소문자 16진수 64자
  size: number;              // 바이트
  mediaType: string;         // 서버가 업로드 때 확인한 값
  name?: string;             // 원래 파일 이름(표시용)
  image?: { width: number; height: number };
  variants?: {              // 이미지의 표시용 판(21 E11 요구). 원본과 별도 blob
    thumb?: BlobVariant;     // 긴 변 512px
    display?: BlobVariant;   // 긴 변 1,600px
  };
}
export interface BlobVariant { blobId: string; size: number; width: number; height: number; mediaType: string }
```

| 한도 | 기본값 | 근거 |
|---|---|---|
| 파일 하나 | 64 MiB(`policy.files.maxBlobBytes`) | 이미지 자극, 문서 초안, 첨부. happy-agent 256 MiB보다 작게 시작 |
| 한 번에 올리기 | 8 MiB | 넘으면 청크 업로드 |
| 청크 | 4 MiB | |
| 다운로드 티켓 수명 | 5분, 연결당 64개 | OpenClaw 5분·128개(S4 openclaw-gateway §1.6) |
| 업로드 세션 | 마지막 청크 뒤 1시간 | |
| 참조되지 않은 업로드 | 24시간 뒤 정리 | happy-agent 1회용 uploadId 24시간 |
| JSON-RPC 메시지 | 받기 1 MiB, 보내기 4 MiB | §3.4.4 |
| 이벤트 하나 | 256 KiB | §3.5.2 |
| `composer.submit` 본문 | 32 KiB | |

#### 3.11.2 다운로드

- `GET /files/b/<blobId>` + `Authorization: Bearer <기기 토큰>`: 데스크톱(Rust의 `helm-blob` 스킴, 20 APP-D12)과 TUI가 쓴다. `local` 리스너에서는 헤더 없이 받는다(소켓 권한 = `localAdmin`).
- `blob.downloadTicket { blobId }` → `{ path: "/files/t/<ticket>", expiresAt }`: 헤더를 붙일 수 없는 곳(웹뷰가 직접 여는 링크, 외부 프로그램으로 열기)용. 티켓은 32바이트 무작위 base64url, 5분, 그 티켓을 받은 WebSocket 연결이 닫히면 무효다. 수명 안에서는 Range 요청에 여러 번 쓸 수 있다. 기기 토큰을 URL에 넣지 않는다(OpenClaw `artifact-download-grants.ts`와 같은 방식).
- 응답: `200` 또는 `206`, `Accept-Ranges: bytes`, `Content-Range`, `Content-Length`, `ETag: "sha256-<hex>"`, `Content-Type: <저장된 mediaType>`. `If-None-Match`·`If-Range`를 지원한다. 활성 콘텐츠(`text/html`, `image/svg+xml` 등)는 `Content-Disposition: attachment`와 `Content-Security-Policy: sandbox`를 붙인다. 범위가 틀리면 `416`, 없으면 `404`, 토큰·티켓이 틀리거나 만료면 `401`.
- 같은 내용 주소이므로 클라이언트는 `sha256`으로 디스크 캐시를 둔다(20).
- 이미지 판(`variants`)은 데몬이 이미지 업로드를 받거나 런타임이 이미지 자극을 만들 때 한 번 만든다(만드는 위치와 라이브러리는 12·17). 화면은 목록·보드에서 `display`나 `thumb`를 받고 원본은 감사 깊이에서만 받는다(21 E11).

#### 3.11.3 업로드

한 번에 올리기(8 MiB 이하):

```http
POST /files/u HTTP/1.1
Authorization: Bearer <기기 토큰>
Content-Type: image/png
Content-Length: 482113
X-Helm-Sha256: 9f2c…(64자)
X-Helm-Filename: %EC%8B%9C%EC%95%88-1.png

<원시 바이트>
```

→ `201 {"blob": BlobRef, "stagedUntil": "…"}`. 해시가 다르면 `422` + 오류 `4005`, 크기 초과면 `413` + `4001`.

청크 업로드(8 MiB 초과, tus 1.0의 헤더 이름을 빌린 단순형 [지식]):

1. `POST /files/u` + `Upload-Length: <전체 크기>`, `X-Helm-Sha256`(필수), `Content-Type`(파일 형식), 본문 없음 → `201 {"uploadId": "up_…", "chunkBytes": 4194304, "expiresAt": "…"}`.
2. `PATCH /files/u/<uploadId>` + `Upload-Offset: <n>`, `Content-Type: application/offset+octet-stream`, 본문(≤ `chunkBytes`) → `204` + `Upload-Offset: <새 위치>`. 위치가 틀리면 `409` + 현재 `Upload-Offset`. 마지막 청크를 받아 해시가 맞으면 `201 {"blob": BlobRef, "stagedUntil": "…"}`.
3. 끊기면 `HEAD /files/u/<uploadId>` → `204` + `Upload-Offset`, `Upload-Length`로 이어 올린다.

- 업로드한 파일은 "대기"(staged) 상태다. 명령(`composer.submit`의 `attachments` 등)이 `BlobRef`를 참조하면 커널이 그 참조를 기록하고 파일은 보관 상태가 된다. 24시간 안에 참조되지 않으면 17의 정리 작업이 지운다. 한 번 보관된 파일은 여러 명령에서 다시 참조할 수 있다.
- SSH 경로에서는 요청마다 `ssh -W`를 하나 띄워 같은 HTTP 요청을 보낸다(20 APP-D12).

### 3.12 버전 관리 [제안]

- `PROTOCOL_VERSION = 1`, `MIN_PROTOCOL_VERSION = 1`. 버전 2부터 서버는 현재 버전과 직전 버전을 받는다(데스크톱 앱과 데몬을 따로 업데이트하는 1인 환경. OpenClaw의 N-1 허용과 같은 생각, S4 openclaw-gateway §1.2).
- 버전을 올리지 않는 변경(추가): 새 메서드, 새 알림, 새 뷰, 새 선택 params(없으면 이전 동작), 결과·알림의 새 필드, 새 이벤트 종류, 기존 kind 아래의 새 오류 코드, 결과 열거형의 새 값.
- 버전을 올리는 변경: 메서드·필드 삭제나 이름 변경, 기존 필드의 뜻 변경, 선택 params를 필수로 바꾸기, 재전송·순서 계약(§3.5) 변경, 오류 코드의 뜻 변경.
- 서버는 요청 params를 엄격하게 검사한다(모르는 필드는 `-32602`). 새 클라이언트는 `features`를 보고 서버가 아는 것만 보낸다. 클라이언트는 결과·알림을 너그럽게 읽는다(모르는 필드 무시, 모르는 열거형 값은 "알 수 없음"으로 표시, 모르는 알림·이벤트 종류는 무시하거나 일반 행으로 표시, 모르는 오류 코드는 `data.kind`의 앞부분과 `retryable`로 처리). happy-agent·pi-fabric의 "알 수 없는 필드 무시"와 같다(pi-cases-notes §11.1).
- 기능 표시(`capabilities`)는 `<영역>.<기능>.v<n>` 형식이다. 양쪽이 광고하고 교집합만 쓴다.
- 직전 버전 지원 코드는 `src/compat/v<n>.ts`에 모으고 `// COMPAT(<이름>): added in v<n>, remove after <날짜>` 표시를 단다(Paseo `docs/protocol-compatibility.md`, pi-cases-notes §12).
- 이벤트 payload 버전(`EventWire.v`)은 09가 관리하며 프로토콜 버전과 별개다. 화면의 뜻은 뷰(서버가 만든 것)에 기대고 이벤트 payload에는 기대지 않는다(타임라인 표시와 무효화에만 쓴다). 그래서 이벤트 payload가 바뀌어도 프로토콜 버전을 올리지 않는다.
- 데스크톱 앱은 `protocol.unsupported`를 받으면 "앱 업데이트 필요" 또는 "서버 업데이트 필요"를 `serverMin`·`serverMax`와 자기 범위로 판단해 보인다(20 APP-D14).

### 3.13 `@helm/protocol` 패키지와 생성 [제안]

#### 3.13.1 구조

```text
packages/protocol/                         @helm/protocol (브리프 §3.1)
  package.json      exports: "." (스키마·타입·오류·등록 표), "./testing" (가짜 서버·클라이언트, 적합성)
                    sideEffects: false. 런타임 의존: typebox(07이 고정하는 버전), ulid 생성기 하나
  src/
    version.ts          PROTOCOL_VERSION, MIN_PROTOCOL_VERSION, CAPABILITIES
    jsonrpc.ts          envelope 스키마(§3.3.1), 크기·깊이·길이 검사
    errors.ts           ERRORS 표: { code, kind, retryable, httpStatus? }, HelmProtocolError 클래스
    common.ts           IsoTime, Seq, StreamPosition, BlobRef, Scope, ListenerKind, DaemonMode
    handshake.ts        HelloChallengeParams, HelloParams, HelloResult, ConnectionPolicy, DEFAULT_POLICY
    events.ts           EventWire, EventFilter, events.* params·result, EventsNotificationParams
    views.ts            ViewName, VIEW_SPECS(이름, params 스키마, 화면 ID, 집계 태그), ViewResult
    stream.ts           StreamPart, RunPartial, stream.* params·result
    commands.ts         CommandParamsBase, CommandResult, 명령별 params 스키마(§3.7.5)
    devices.ts          DeviceInfo, ConnectionInfo, device.* / connection.* / admin.*
    files.ts            HTTP 경로·헤더 이름 상수, 업로드 응답 스키마
    notifications.ts    NOTIFICATION_SPECS
    registry.ts         METHOD_SPECS(§3.13.2)
    types.ts            MethodMap, NotificationMap(등록 표에서 파생)
    codec.ts            parseIncoming(text, side) → 검증된 메시지 | 오류, serialize
    testing/            FakeDaemon, FakeClient, 시나리오 DSL, 적합성 스위트(§6.3)
  scripts/
    gen-jsonschema.ts   → dist/schema/helm-protocol.schema.json
    gen-reference.ts    → docs/design/generated/19-protocol-reference.md (메서드·알림·오류·뷰 표)
    check-registry.ts   등록 표 ↔ 서버 디스패처 처리기 ↔ 생성 문서 일치 검사(`just check`에 넣는다, 06·23)
```

- 의존 방향: `@helm/protocol` → `@helm/domain`(레코드 타입, `RecordRef`, `LoopId`를 타입으로만 가져온다). `@helm/protocol`은 `@helm/kernel`, `@helm/store`, `@helm/daemon`을 모른다. 데몬과 앱이 `@helm/protocol`에 의존한다(06이 의존 방향을 확정).
- 클라이언트 코어(연결 상태 기계, 재접속, 구독 복원, 진행 중 명령함)는 06이 더한 `@helm/client`(06 §3.3.1, L6)에 둔다. `@helm/client` → `@helm/protocol` 방향으로만 의존한다. Node 전송(`NodeWsTransport`: TCP, `ws+unix`)은 `@helm/client/node` 하위 경로에 둔다.
- 브라우저 안전: `@helm/protocol`의 모든 진입점과 `@helm/client` 루트는 `node:` 모듈을 쓰지 않는다. pi 저장소의 브라우저 번들 스모크 검사(pi-api-facts-2 §1.1 `scripts/check-browser-smoke.mjs`)와 같은 검사를 둔다.
- Rust 쪽 타입은 만들지 않는다. 20의 Rust는 JSON-RPC 메시지를 해석하지 않는다(20 §3.2). 예외는 페어링 응답과 업로드 응답 두 HTTP 본문이고, 20이 Rust 구조체로 직접 적는다.

#### 3.13.2 메서드 등록 표

```ts
import type { TSchema, Static } from "typebox";

export interface MethodSpec<N extends string = string, P extends TSchema = TSchema, R extends TSchema = TSchema> {
  readonly name: N;
  readonly kind: "ctl" | "read" | "cmd" | "adm";
  readonly scope: Scope | null;          // null: 인증 전(hello만)
  readonly since: number;                // 도입 프로토콜 버전
  readonly params: P;
  readonly result: R;
  readonly errors: readonly number[];    // 생성 문서용: 이 메서드가 낼 수 있는 Helm 오류 코드
  readonly kernelCommand?: string;       // cmd: 10의 명령 이름
  readonly basisChecked?: boolean;       // cmd: §3.9.3 낡음 검사 대상이 있는가(문서용. 실제 대상은 10의 subjects)
  readonly compat?: { removeAfter: string; note: string };
  readonly summary: string;              // 생성 문서의 한 줄 설명(한국어)
}

export const METHOD_SPECS = [
  { name: "hello", kind: "ctl", scope: null, since: 1, params: HelloParams, result: HelloResult,
    errors: [1002, 1003, 1004, 1005, 1006, 1007, 1008, 1011], summary: "핸드셰이크" },
  { name: "question.answer", kind: "cmd", scope: "decide", since: 1, params: QuestionAnswerParams,
    result: CommandResult, errors: [3001, 3002, 3004, 3005, 3006, 3007, 5001, 5003],
    kernelCommand: "question.answer", basisChecked: true, summary: "질문에 답한다" },
  // … §3.7.1 표의 모든 행
] as const satisfies readonly MethodSpec[];

type Specs = (typeof METHOD_SPECS)[number];
export type MethodName = Specs["name"];
export type MethodMap = { [S in Specs as S["name"]]: { params: Static<S["params"]>; result: Static<S["result"]> } };
export type CommandMethodName = Extract<Specs, { kind: "cmd" }>["name"];
```

- `protocol.describe`(read)는 등록 표를 런타임에 보여 준다. 진단과 개발 도구용이다.

```ts
export interface ProtocolDescription {
  protocol: number;                    // 이 연결에서 고른 버전
  supported: { min: number; max: number };
  schemaHash: string;
  methods: Array<{ name: string; kind: MethodSpec["kind"]; scope: Scope | null; since: number }>;
  notifications: string[];
  views: string[];
  capabilities: string[];
}
```

- 데몬 디스패처는 `METHOD_SPECS`로 처리기 표를 만든다. 등록 표에 있는데 처리기가 없거나, 처리기가 있는데 등록 표에 없으면 데몬 시작 단위 테스트가 실패한다(OpenClaw `core-descriptors.ts:13-14`의 "every core handler must appear here" 규칙, S4 openclaw-gateway §1.4).
- params·result 검사는 TypeBox 컴파일 검사기(`TypeCompiler` 계열, 07이 고정한 typebox 판의 API)로 한다. 데몬은 params를 받을 때, 테스트 모드에서는 result를 보낼 때도 검사한다(개발 중 계약 위반을 일찍 잡는다).
- 생성 문서(`docs/design/generated/19-protocol-reference.md`)는 이 설계 문서를 대신하지 않는다. 이 문서는 의미와 이유를, 생성 문서는 현재 코드의 정확한 목록을 적는다. 둘이 어긋나면 `check-registry.ts`가 이름 목록 차이를 보고한다.

### 3.14 클라이언트 코어와 TUI 재사용 [제안]

데스크톱 앱(웹뷰 TS)과 TUI(Node)가 같은 코어를 쓴다. 코어는 화면 프레임워크를 모른다. React 연결(TanStack Query 등)은 20이, pi-tui 연결은 TUI 설계가 한다.

```ts
// @helm/client
export interface Transport {
  open(h: {
    onMessage(text: string): void;
    onClose(info: { code: number; reason: string; failure?: TransportFailure }): void;
  }): Promise<void>;                          // 업그레이드 101까지 끝나면 resolve. 실패하면 TransportFailure로 reject
  send(text: string): void;                   // 열려 있지 않으면 throw
  close(code?: number, reason?: string): void;
}
export type TransportFailure =
  | { kind: "network" } | { kind: "httpStatus"; status: number }   // 401·403은 인증 계열
  | { kind: "ssh"; reason: string }                                   // 20의 ssh_* 분류
  | { kind: "daemonUnreachable" } | { kind: "other"; detail?: string };

export interface ClientStateStorage {           // 데스크톱: IndexedDB(20 APP-D10), TUI: 파일
  loadPosition(serverId: string, subKey: string): Promise<StreamPosition | null>;
  savePosition(serverId: string, subKey: string, pos: StreamPosition): Promise<void>;
  listPending(serverId: string): Promise<PendingCommand[]>;
  putPending(serverId: string, cmd: PendingCommand): Promise<void>;
  removePending(serverId: string, idempotencyKey: string): Promise<void>;
  clearServer(serverId: string, what: "positions" | "all"): Promise<void>;
}
export interface PendingCommand { idempotencyKey: string; method: CommandMethodName; params: unknown; createdAt: number }

export interface HelmClientOptions {
  transportFactory: () => Transport;          // 경로 선택은 바깥(20)에서 한다
  client: ClientInfo;
  auth: { method: "deviceToken"; deviceId: string; sign?: (payload: string) => Promise<string> } | { method: "localAdmin" };
  expectedServerId?: string;
  storage: ClientStateStorage;
  clock?: () => number;                       // 테스트용
  random?: () => number;
}

export declare class HelmClient {
  constructor(opts: HelmClientOptions);
  readonly state: "idle" | "connecting" | "handshaking" | "syncing" | "ready" | "backoff" | "needsUser" | "closed";
  readonly hello: HelloResult | undefined;
  on(ev: "state", cb: (s: HelmClient["state"], detail?: { kind?: string; retryInMs?: number }) => void): () => void;
  on(ev: "invalidate", cb: (viewKeys: string[], seq: Seq) => void): () => void;   // 캐시된 뷰 중 낡은 것
  on(ev: "serverRestarted", cb: (bootEpoch: string) => void): () => void;
  start(): void;
  stop(): void;
  request<M extends Exclude<MethodName, CommandMethodName | "hello">>(method: M, params: MethodMap[M]["params"], opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<MethodMap[M]["result"]>;
  command<M extends CommandMethodName>(method: M, params: Omit<MethodMap[M]["params"], "idempotencyKey"> & { idempotencyKey?: string }): Promise<CommandResult>;
  subscribeEvents(subKey: string, filter: EventFilter, handler: (events: EventWire[], meta: { caughtUp: boolean }) => void): () => void;
  subscribeStream(scope: StreamSubscribeParams["scope"], handler: (c: StreamChunkParams | { reset: RunPartial }) => void): () => void;
  getView<D>(view: ViewName, params: Record<string, unknown>, opts?: { minSeq?: Seq }): Promise<ViewResult<D>>;
  trackView(key: string, dependsOn: string[], asOfSeq: Seq): void;   // 무효화 감시 대상 등록
  untrackView(key: string): void;
}
```

- `command()`는 키가 없으면 `ik_<ULID>`를 만들고, 보내기 전에 `putPending`을 끝낸다. 응답이나 커널 거부를 받으면 `removePending`. 연결이 끊기면 남겨 두고 `syncing` 진입 때 다시 보낸다.
- `subscribeEvents`는 `subKey`로 위치를 저장·복원한다. 재접속하면 저장된 위치로 다시 구독하고, `2001`이면 §3.5.5를 한 뒤 `invalidate` 이벤트로 모든 추적 뷰를 알린다.
- 요청 시간 제한 기본값: 조회 30초, 명령 60초. 명령이 시간 초과되면 진행 중 명령함에 남기고 연결을 다시 맺는다(응답 유실로 본다).
- TUI 재사용: `@helm/tui`는 `HelmClient` + `NodeWsTransport({ socketPath })`(`@helm/client/node`) + `auth: { method: "localAdmin" }` + 파일 저장소를 쓰고, 뷰 캐시는 메모리 맵 하나로 둔다. 같은 `view.get` 결과를 pi-tui 컴포넌트로 그리므로 데스크톱과 TUI가 같은 투영을 본다(03 §3.11 parity). 휘발 스트림은 pi-tui `Markdown` 컴포넌트에 텍스트를 덧붙이는 데 쓴다.
- 데스크톱의 전송(`TauriIpcTransport`)은 20이 만든다. Rust가 바이트·WebSocket을 맡고 텍스트 메시지만 IPC 채널로 넘긴다(20 APP-D02). 그래서 `Authorization` 헤더와 서명(`sign` 콜백 → Rust IPC)이 웹뷰 메모리에 토큰을 두지 않고 이루어진다.

### 3.15 서버 프로토콜 계층 [제안]

```text
packages/daemon/src/protocol/
  listeners.ts        세 리스너 만들기(주소는 17 설정), 리스너별 전송 조건 훅(18)
  upgrade.ts          업그레이드 검사: 하위 프로토콜, Host·Origin, Authorization 보관, 인증 전 연결 수
  connection.ts       연결 상태 기계(§3.4.7), 우선순위 송신 큐(§3.5.8), ping·무수신·tick 타이머
  handshake.ts        챌린지, hello 판정 순서(§3.4.3), 18의 verifyDevice 호출, scope 부여
  dispatcher.ts       METHOD_SPECS → 처리기, params 검사, scope, 동시 요청 한도, $/cancelRequest
  subscriptions/
    events.ts         재생·실시간 알고리즘(§3.5.4), 09 onCommit 훅, 빈 위치 알림(tick 때)
    stream.ts         12 런타임의 휘발 조각 구독 → stream.chunk, run.partial
  views.ts            view.get → 12 투영 API, minSeq 대기, ViewResult 조립
  commands.ts         메서드 → 10 Submission, basisSeq → expect(§3.9.3), 09 intake, 결과 대응(§3.3.4)
  files.ts            HTTP 업로드·다운로드, 티켓 표(연결별), 대기 파일 표시
  presence.ts         연결별 presence → 11·14·16에 넘기는 휘발 상태
  redact.ts           18의 공개 정책 훅(EventWire.redacted)
  errors.ts           오류 정제(-32603, traceId)
```

다른 모듈에 요구하는 인터페이스(§5.2에 문서별로 다시 적는다):

```ts
// 09 (@helm/store)
interface EventStoreForProtocol {
  storeId(): string;
  headSeq(): Seq;
  oldestReplayableSeq(): Seq;
  readRange(q: { after: Seq; upto: Seq; filter: StoreFilter; limit: number; scanLimit: number }): { events: StoredEvent[]; scannedTo: Seq };
  readPage(q: { after?: Seq; before?: Seq; limit: number; filter: StoreFilter; subjectId?: string }): StoredEvent[];
  onCommit(cb: (batch: { events: StoredEvent[]; firstSeq: Seq; lastSeq: Seq }) => void): () => void;  // 커밋 직후 같은 턴에서 동기 호출
  recordRevision(id: string): { revision: number; revisionSeq: Seq } | undefined;
  intake(sub: Submission, scopeKey: string, fingerprint: string): IntakeOutcome;   // 멱등 저장 + 커널 + 커밋(10 §3.2)
}
// StoredEvent는 09 envelope + invalidates: string[] (투영기가 커밋 트랜잭션에서 채운다)

// 12 (@helm/runtime)
interface ProjectionsForProtocol {
  get(view: ViewName, params: unknown): { asOfSeq: Seq; data: unknown; dependsOn: string[]; freshness: ViewResult["freshness"]; staleReason?: ViewResult["staleReason"]; omitted?: ViewResult["omitted"] };
  waitFor(seq: Seq, timeoutMs: number): Promise<boolean>;      // 투영이 seq까지 따라왔는가
}
interface RunStreamForProtocol {
  subscribe(scope: StreamSubscribeParams["scope"], cb: (c: Omit<StreamChunkParams, "sub">) => void): () => void;
  partial(runId: string): RunPartial | undefined;
  active(scope: StreamSubscribeParams["scope"]): RunPartial[];
}

// 18 (@helm/daemon security)
interface SecurityForProtocol {
  checkTransport(req: IncomingRequestInfo, listener: ListenerKind): { ok: true; tailscaleLogin?: string } | { ok: false; httpStatus: 401 | 403 | 429 };
  verifyDevice(a: { token: string | null; deviceId: string; proof?: DeviceProof; nonce: string; serverId: string; listener: ListenerKind; tailscaleLogin?: string }):
    { ok: true; scopes: Scope[] } | { ok: false; code: 1004 | 1005 | 1006 | 1007 | 1008 };
  redactEvent(e: EventWire, conn: ConnectionIdentity): EventWire;
  proofRequired(listener: ListenerKind): boolean;
}
```

### 3.16 대표 시퀀스

#### 3.16.1 UC-04: 외부에서 WSS로 접속해 질문에 답하기

```text
앱(Rust+TS)                                  데몬
 1 WSS 업그레이드(Authorization)  ───────▶  tailnet 리스너: Tailscale 신원 확인 → 101
 2                                 ◀─────── hello.challenge {nonce, serverId}
 3 hello {protocol 1..1, deviceToken, resume:{storeId, seq: 1200}} ─▶ 판정 → ready
 4                                 ◀─────── hello 응답 {headSeq: 1342, resume: ok behind 142}
 5 events.subscribe {from:{storeId,1200}} ─▶ 등록, 응답 {start 1200, head 1342, replaying}
 6                                 ◀─────── events {1200→1342, 142개, caughtUp: true}
   (각 이벤트의 invalidates로 inbox·home 캐시가 낡음 → 열린 inbox만 다시 받기)
 7 view.get {inbox, minSeq 1342}   ───────▶ ◀── ViewResult {asOfSeq 1342, dependsOn [@inbox, qs_…]}
 8 사용자: 질문 14 "허락" → command question.answer {ik_…, questionId, optionId, basisSeq 1342}
   (진행 중 명령함에 먼저 저장)    ───────▶ basisSeq → expect, 09 intake → 커밋 1343~1345
 9                                 ◀─────── events {1342→1345: question.answered, …}  (응답보다 먼저, §3.5.9)
10                                 ◀─────── 응답 {status: applied, lastSeq 1345}
   (진행 중 명령함에서 지움, inbox 다시 받기 → 질문 14 사라짐)
```

#### 3.16.2 응답 유실 뒤 같은 키로 다시 보내기

```text
 1 command result.accept {ik_A, …}  ───────▶ 커밋 2001~2003
 2                                 ✕ 연결 끊김(응답이 오기 전)
 3 재접속, hello, events.subscribe {from: 1998} → events {1998→2010}에 결과 이벤트 포함
 4 syncing 진입 → 진행 중 명령함의 ik_A를 같은 params로 다시 보냄
 5                                 ◀─────── 응답 {status: applied, duplicate: true, lastSeq 2003}
   (같은 결과. 결과 이벤트는 3에서 이미 받았다. 두 번 적용되지 않는다)
```

#### 3.16.3 저장소 복원 뒤 재접속

```text
 1 hello 응답 {log: {storeId: S2, …, resume: snapshotRequired(storeMismatch)}}
 2 클라이언트: S1 아래 위치·투영 캐시·이벤트 캐시 버림(§3.5.5 1단계)
 3 events.subscribe {from: "head"} → start H0
 4 열린 뷰 view.get {minSeq: H0}, 타임라인은 events.read {before: H0+1}
 5 화면에 "서버 기록이 복원되어 화면을 새로 받았습니다"(문구는 05)
```

#### 3.16.4 SSH 경로

경로 (a)와 같다. 다른 점은 1단계뿐이다: Rust가 `ssh -W 127.0.0.1:<loopback 포트> server`를 띄우고 그 표준 입출력 위에서 업그레이드를 보낸다. `loopback` 리스너는 Tailscale 신원 확인을 하지 않는다. 2단계 이후의 메시지, 위치, 재전송, 멱등 처리는 바이트 단위로 같다.

#### 3.16.5 첨부와 함께 대화 입력

```text
 1 Rust: POST /files/u (Bearer, 2 MiB 이미지, X-Helm-Sha256) → 201 {blob: {blobId: bl_…}}
 2 TS: command composer.submit {scope:{concernId}, text, attachments:[blob], basisSeq} → applied, runId
 3 stream.subscribe {scope:{concernId}} → stream.chunk(text, n=1…) … end{finalSeq}
 4 events {…message.recorded…} → 휘발 텍스트를 영속 메시지로 바꿈
```

## 4. 실패·예외·경계 사례

| ID | 상황 | 처리 | 확인(§6) |
|---|---|---|---|
| F-01 | 업그레이드에 `Sec-WebSocket-Protocol: helm-jsonrpc`가 없다 | HTTP 400. 연결을 만들지 않는다 | CT-02 |
| F-02 | `tailnet`·`loopback`에서 `Authorization` 헤더 없이 업그레이드 | HTTP 401. 클라이언트는 `needsUser`(재페어링 안내) | CT-03 |
| F-03 | 챌린지 전에 클라이언트가 `hello`를 보냄(경합) | 서버는 연결을 열자마자 챌린지를 보내므로 정상 클라이언트는 이렇게 하지 않는다. 받으면 처리하되 `proofRequired`면 증명 없음으로 `1004` | CT-04 |
| F-04 | `hello`가 10초 안에 오지 않음, 인증 전 16 KiB 초과, `hello` 전 다른 요청 | 4001 / 1009 / `1001` 후 1008로 닫기 | CT-05 |
| F-05 | 공통 프로토콜 버전 없음 | `1003`. 클라이언트는 자동 재접속을 멈추고, 캐시한 투영을 읽기 전용으로 보이며 "앱 업데이트 필요" 또는 "서버 업데이트 필요"를 안내한다(01 FX-16의 "읽기 전용으로 붙고 갱신 안내"는 서버 연결 없이 캐시로 충족한다) | CT-06 |
| F-06 | 연결 중 기기 폐기 | 커밋 직후 그 기기의 모든 연결에 `connection.closing{auth.revoked}` 후 4009. 진행 중 명령함은 남지만 다시 페어링하기 전까지 보내지 않는다 | CT-16 |
| F-07 | 재생 도중 데몬 재시작 | 연결이 1001로 닫힌다. 클라이언트는 마지막으로 받은 `to`부터 다시 구독한다. `bootEpoch`가 바뀐 것을 보이고, seq는 이어진다 | CT-27 |
| F-08 | 백업에서 복원해 seq가 되돌아감 | 17의 복원이 `storeId`를 바꾼다. `hello`의 `log.resume`과 `events.subscribe`가 `storeMismatch` → 스냅샷 경로(§3.5.5 1단계: 캐시 모두 버림) | CT-08 |
| F-09 | 같은 `storeId`인데 클라이언트 위치가 headSeq보다 큼(복원 때 `storeId`를 바꾸지 않은 운영 실수) | `aheadOfHead` → `storeMismatch`와 같이 처리. 데몬은 운영 로그에 경고를 남긴다 | CT-09 |
| F-10 | 몇 달 만에 접속해 밀린 이벤트가 `maxReplayEvents`를 넘음 | `tooFar` → 스냅샷 경로. 타임라인에 "접속하지 않은 동안의 기록 일부 생략" 표시. 복귀 요약(`brief` 뷰)은 정본에서 만들므로 내용 손실이 없다 | CT-07 |
| F-11 | 느린 소비자(Wi-Fi 약함, 앱이 바쁨) | 휘발 조각을 버리고, 계속 넘치면 4008로 닫는다. 재접속해 위치부터 받는다. 영속 이벤트는 잃지 않는다 | CT-13 |
| F-12 | 이벤트 하나가 송신 상한(4 MiB)을 넘음(09의 256 KiB 제한 위반) | 그 이벤트의 `payload`를 빼고 `redacted: [""]`, `payloadOmitted: "tooLarge"`로 보낸다. 클라이언트는 `records` 뷰로 내용을 본다. 데몬은 운영 로그에 오류를 남긴다(09 버그) | CT-28 |
| F-13 | 명령 응답 유실(연결 끊김) | 진행 중 명령함에 남은 명령을 재접속 뒤 같은 키로 다시 보낸다. 같은 결과(`duplicate: true`) | CT-12 |
| F-14 | 같은 키, 다른 params(클라이언트 버그) | `3006`. 클라이언트는 그 항목을 진행 중 명령함에서 지우고 버그 보고 | CT-11 |
| F-15 | 두 기기가 같은 질문에 거의 동시에 답함 | 먼저 커밋된 것이 이긴다. 뒤의 것은 `3008 command.alreadyResolved`(또는 대상 revision이 바뀌었으면 `3004`). 화면은 04 §3.0.5 "이미 답했습니다(다른 기기)" | CT-19 |
| F-16 | 낡은 화면에서 결정 | `3004`. 화면은 바뀐 내용을 보이고 쓰던 답을 유지한다(04 §3.0.5). 새 키로 다시 보낸다 | CT-18 |
| F-17 | 데몬이 읽기 전용(복구) 모드 | 조회는 되고 명령은 `5003`. `server.modeChanged`로 알린다. 진행 중 명령함은 보존하고 모드가 풀리면 보낸다 | CT-17 |
| F-18 | 데몬 종료 중(`draining`) | 새 명령 `5001` + `retryAfterMs`. 클라이언트는 진행 중 명령함에 두고 재시작 뒤 보낸다 | CT-17 |
| F-19 | 반쯤 열린 연결(노트북 잠자기, Wi-Fi 전환) | 클라이언트 감시 35초 → 4000 → 재접속. 서버는 무수신 45초 뒤 소켓을 지운다 | CT-15 |
| F-20 | ssh 실패(키 거부, 호스트 키 바뀜, ssh 없음) | 20의 `ssh_*` 분류. 키·호스트 키 문제는 `needsUser`, 네트워크 문제면 다른 경로로 넘어간다(20 APP-D05) | 20의 테스트 |
| F-21 | Tailscale serve는 응답하는데 데몬이 꺼짐 | serve가 502·503·504를 준다. `daemonUnreachable`로 분류해 백오프. 화면은 "Helm 서버가 응답하지 않음"(04 §3.0.4) | CT-20 |
| F-22 | 클라이언트 시계가 크게 틀림 | 증명을 쓰면 `1007`. 클라이언트는 `serverTime` 차이를 진단으로 보인다. 화면의 상대 시간은 `tick.serverTime` 기준 오프셋으로 계산한다(21 E16) | CT-21 |
| F-23 | 업로드가 끊김 | 청크 업로드면 `HEAD`로 위치를 받아 이어 올린다. 한 번에 올리기면 처음부터 다시 | CT-23 |
| F-24 | 대기 파일이 24시간 지나 지워진 뒤 명령에서 참조 | 커널이 `content.ref_not_found`로 거부(3001). 클라이언트는 다시 올리고 새 키로 보낸다 | CT-24 |
| F-25 | 다운로드 도중 티켓 만료·연결 종료 | `401`. 새 티켓을 받아 `Range`로 이어 받는다 | CT-22 |
| F-26 | 투영이 아직 따라오지 않음(`minSeq` 대기 초과) | `2006` + `retryAfterMs`. 클라이언트는 화면을 "맞추는 중"으로 두고 다시 요청 | CT-29 |
| F-27 | 모르는 이벤트 종류, 모르는 결과 필드·열거형 값 | 무시하거나 일반 행으로 표시한다. 오류로 보지 않는다(§3.12) | CT-25 |
| F-28 | 분해·병합 뒤 하위 Concern 필터 판정이 기록 당시와 다름 | 현재 트리 기준으로 판정한다(§3.6.2). 정확한 이력이 필요하면 전체 스트림을 쓴다 | 문서화만 |
| F-29 | 같은 호스트의 다른 프로세스(Windows 호스트 포함)가 `loopback` 포트에 붙음 | 기기 토큰 없이는 `hello`가 실패하고 그 밖에는 아무것도 처리하지 않는다. 실패 횟수 제한(§3.4.5) | CT-03, CT-05 |
| F-30 | 에이전트 도구 프로세스가 `rpc.sock`을 연다 | 프로토콜 계층은 막을 수 없다(같은 uid). 13·18의 격리가 막아야 한다(§3.2.4). 막지 못하면 결정 14가 깨지므로 22의 보안 테스트에 넣는다 | 13·18·22 |
| F-31 | 같은 멱등 키가 두 연결에서 동시에 처리 중(재접속 직후 이전 연결이 아직 살아 있음) | 뒤의 요청은 앞의 결과를 기다려 `duplicate: true`로 받는다. 10초 넘으면 `3007` | CT-30 |
| F-32 | 커밋된 명령에 `$/cancelRequest` | 취소하지 않고 정상 결과를 보낸다 | CT-20 |
| F-33 | 서버 버그로 이벤트 알림의 `from`이 클라이언트 위치와 다름 | 다시 구독한다. 1분에 3번이면 연결을 다시 맺고 진단 기록 | CT-10 |
| F-34 | 재생 읽기 중 SQLite 오류 | 그 연결을 1011로 닫는다. 클라이언트는 마지막 `to`부터 다시 시작 | CT-27 |
| F-35 | `view.get` 대상 레코드가 대체됨 | 레코드는 지우지 않으므로 뷰는 대체된 상태와 새 레코드 링크를 보인다. 없는 ID만 `2005` | CT-25 |
| F-36 | 깊이 64, 배열 10,000을 넘는 메시지 | `-32600`(인증 전이면 닫기) | CT-26 |
| F-37 | JSON-RPC 배치 | `-32600` 응답 하나 | CT-26 |
| F-38 | 휘발 조각 유실(느린 소비자로 버림) | 클라이언트가 `n` 건너뜀을 보고 `run.partial`로 맞춘다 | CT-14 |
| F-39 | 실행이 끝났는데 영속 이벤트보다 `end` 조각이 먼저 옴 | 서버가 순서를 지킨다(§3.6.4: 영속 커밋 뒤 `end`). 클라이언트는 `finalSeq`를 받을 때까지 휘발 상태를 지우지 않는다 | CT-14 |
| F-40 | 안전 모드 | 연결과 사람 명령은 받는다. `hello`·`tick`·`server.modeChanged`의 `safeMode`로 표시하고 `daemon.exitSafeMode`로 해제한다 | CT-17 |

## 5. 다른 문서와의 인터페이스

### 5.1 이 문서가 제공하는 것

| 제공 | 받는 문서 |
|---|---|
| 리스너 셋의 역할과 받는 인증 방식(§3.2.1), SSH 경로 결정과 프레이밍(§3.2.3) | 06, 17, 18, 20 |
| envelope, 오류 코드 표(§3.3), 거부 세 갈래 대응 | 05(문구 키), 10, 20, 21 |
| 핸드셰이크 메시지와 정책 값(§3.4) | 17, 18, 20 |
| 재전송 계약(`storeId`, `(from, to]`, 스냅샷 경로)(§3.5) | 09, 17, 20, TUI |
| 화면 투영 조회와 무효화 태그 규칙(§3.6.3) | 04, 12, 20, 21 |
| 휘발 스트림 형식(§3.6.4) | 12, 20, 21 |
| 메서드 이름과 커널 명령 대응(§3.7.1), 메서드별 params 타입(§3.7.5) | 04, 05, 10, 11, 14, 15, 16, 20, 21 |
| 뷰 이름·params·키(§3.7.4) | 04, 12, 16, 20 |
| 멱등 처리와 `basisSeq` → `expect` 변환(§3.9) | 09, 10, 20 |
| 생존 확인·재접속 상태 기계(§3.10) | 20, 04 §3.0.4 |
| 파일 HTTP 규약(§3.11) | 12, 15, 17, 20 |
| `@helm/protocol` 구조, 등록 표, 생성 스크립트(§3.13), `@helm/client` 코어 API(§3.14) | 06, 20, 22, 23, TUI |
| 적합성 테스트 시나리오(§6.3) | 22 |

### 5.2 다른 문서에 요구하는 것

| 문서 | 요구 |
|---|---|
| 01 | FX-16의 "읽기 전용으로 붙고 갱신 안내"를 "캐시한 투영을 읽기 전용으로 보이고 갱신 안내"로 고쳐 적어 달라(버전이 맞지 않으면 서버 연결은 맺지 않는다, F-05). NFR-P-1·P-2·P-4의 측정 지점은 §6.4 |
| 04 | (1) `ViewMeta.sourceSeq`를 `asOfSeq`로 부르거나 둘이 같은 값임을 적기. (2) 모든 `RecordRef`에 `revision`, `revisionSeq`를 더하기(§3.7.4). (3) `CommandIntentBase.intentId`는 `idempotencyKey`(`ik_<ULID>`)다. (4) `device.pair`는 HTTP `POST /pair`, `connection.test`는 `/healthz` + `ping`이다. (5) 명령 의도 목록(04 §5.2의 10 행)은 §3.7.1에 그대로 받았다. 새로 더한 것: `obligation.confirmDone`, `concern.resume`, `work.resume`, `settings.update`, `daemon.exitSafeMode`, `composer.preview`, 측정 명령 넷 |
| 05 | §3.3.4의 모든 `kind`에 대한 문구 키. 특히 `command.revisionConflict`(낡은 기준), `command.alreadyResolved`(이미 처리됨), `command.superseded`(대체됨), `protocol.unsupported`(앱·서버 중 어느 쪽 갱신인지), `daemon.readOnly`, `daemon.draining`, `replay.outOfRange`(기록 일부 생략 표시) |
| 06 | (1) `@helm/protocol`에 "SSH stdio 경로용 프레임 인코더·디코더"가 필요 없다(P-02: `ssh -W` 위에 HTTP + WebSocket을 그대로 쓴다). (2) 클라이언트 코어를 `@helm/client`에 둔다는 06 §3.3.1을 받았다. (3) 06 §3.6의 serve 대상 포트 7801을 17 D17-09의 7840(`tailnet`)·7841(`loopback`)과 맞추기. (4) 06 §3.6.3이 관찰 에이전트가 "제안은 프로토콜로 데몬에 보낸다"고 적었는데, 이 클라이언트 프로토콜은 `human_client` 채널만 만든다. 관찰 에이전트는 16 §3.2.3 IPC(`aux_agent` 채널)로 보내야 한다. 06 §3.3.1의 `observer` → `client` 의존도 빼 달라 |
| 08 | (1) ID 접두사 등록: `cx`(연결), `bl`(파일), `up`(업로드 세션), `ik`(클라이언트 멱등 키, 저장되는 값이므로 겹치지 않게). (2) 모든 레코드에 `revision`과 그 revision이 생긴 `revisionSeq`. (3) revision은 사람의 판단에 영향을 주는 변경에서만 올린다(전달 기록, 표시 번호 같은 변경은 올리지 않는다, §3.9.3) |
| 09 | (1) seq 성질(§3.5.1). (2) `storeId`를 저장소 메타에 두고 노출. (3) 커밋 직후 같은 턴에서 부르는 `onCommit` 훅, 범위 읽기 `readRange`·`readPage`, `recordRevision`(§3.15). (4) 이벤트 행에 `invalidates`(투영기가 같은 트랜잭션에서 계산한 무효화 태그)를 저장. (5) 이벤트 하나 256 KiB 이하, 큰 내용은 blob 참조. (6) `commands` 테이블: 멱등 결과(거부 포함)를 지문과 함께 최소 7일 보관. (7) 이벤트 이름 확정: 전달 결정(후보 `question.delivered`, payload는 §3.8.3), `brief.acknowledged`, `autonomous.seen`, `contest.filed`, `device.connected`·`device.revoked`, 16의 측정 이벤트. (8) 투영 갱신을 이벤트 커밋과 같은 트랜잭션에서 하거나, 아니면 `waitFor(seq)`를 제공 |
| 10 | (1) §3.7.1 "커널 명령" 열의 이름 확정(사람 채널 명령 목록). (2) 사람 명령마다 `subjects()`가 낡음 검사 대상을 돌려줄 것. (3) 거부 코드 `content.already_resolved`, `content.superseded`를 더하기(프로토콜 3008·3009로 대응). (4) `decision.contest`가 `evidenceLink`·`criterionVerdict` 대상을 받기. (5) 거부의 `next`를 사람 채널에서도 채우기(화면의 다음 행동 버튼) |
| 11 | (1) 전달 결정 이벤트 payload(§3.8.3: 질문 ID, 전달 방식, 긴급도, 문구 키, 딥 링크, 대상 기기). (2) `question.*` 메서드와 질문 `kind`·상태 전이의 대응(특히 `question.defer`의 `until` 형식, 권리 게이트의 `proceedWithAssumption` 거부). (3) `presence.report`를 전달 방식 판단 입력으로 쓰는 규칙 |
| 12 | (1) `ProjectionsForProtocol`(뷰 생성 + `dependsOn`), `RunStreamForProtocol`(§3.15). (2) 이벤트마다 무효화 태그 계산(정확성 규칙 §3.6.3). (3) 휘발 조각은 50 ms 단위로 모으고 하나 16 KiB 이하, `end`는 영속 커밋 뒤. (4) 실행의 최종 내용(메시지 전체 텍스트, 도구 결과)을 영속 이벤트로 남기기. (5) `composer.preview` 해석 생성. (6) 이미지 판(`variants`) 생성 위치. (7) 12 §3.15 표의 `conversation.send`·`run.stop`을 §3.7.1 이름(`composer.submit`, `work.stop`·`work.abort`)으로 맞추기 |
| 13 | 에이전트 도구 프로세스가 `<HELM_SOCKET>`을 열 수 없고 클라이언트 자격 파일(`~/.config/helm`의 토큰 등)을 읽을 수 없게 격리(F-30). 17 §3.6의 `InaccessiblePaths=%t/helm`과 같은 방식 |
| 14 | `dial.set`의 `key`·`value` 스키마(다이얼 표), 모드 이름, `OrchestrationSettings` 스키마(`settings.update`), `LoopId`. 14 §5.2가 19에 둔 `presence.changed`, `request.submitted`, `directive.received`는 이벤트 이름이므로 09가 확정하고, 프로토콜은 그 입력(`presence.report`, 명령 메서드)을 제공한다 |
| 15 | `reaction.record`의 종류·강도 값과 관찰 레코드 대응, 자극의 `BlobRef`·`variants`, `stimulusRound.close`의 조건 |
| 16 | `metrics`·`evaluation` 뷰 데이터 타입, 측정 명령(`surprise.report`, `probe.answer`, `probe.score`, `selfReport.submit`)의 payload 정본, `presence.report`에서 `view.opened`를 만드는 규칙 |
| 17 | (1) 복원 때 `storeId` 교체(§3.5.1, F-08). (2) `serverId` 생성·보관. (3) 대기 파일 24시간 정리와 blob 저장 위치. (4) `admin.*` 의미. (5) `helm device issue`가 `admin.issueDevice`를 부르는 것. (6) 17 §5.2의 19 요구 (1)~(6)은 모두 반영했다(리스너 값 §3.2.1, `safeMode` §3.4.4, 종료 사유 §3.8.1, `DaemonStatus` §3.7.8, 관리 메서드 §3.7.1, `serverId` §3.4.2) |
| 18 | (1) `SecurityForProtocol`(§3.15): 전송 조건, `verifyDevice`, 공개 정책 `redactEvent`. (2) 기기 토큰을 `Authorization: Bearer`로 받는 것, 서버에는 해시만 저장. (3) `proofRequired` 기본값과 서명 형식. (4) `POST /pair` 정책(코드 길이·수명·시도 제한). (5) 리스너별 Host·Origin 허용 목록. (6) `localAdmin`의 의미와 F-30 격리 요구의 확인. (7) 기기별 scope 정책 |
| 20 | (1) `Transport`(§3.14) 구현: Rust가 `ssh -W 127.0.0.1:7841`과 WSS를 열고 `Authorization` 헤더를 붙이며 텍스트 메시지만 IPC로 넘긴다. (2) `ClientStateStorage` 구현(IndexedDB: 위치, 진행 중 명령함). (3) `sign` 콜백을 Rust IPC로(증명을 쓰게 되면). (4) 20 AS-1은 무효화 태그로 해결했다: 앱에 이벤트 종류 → 투영 키 대응표가 필요 없다. AS-2는 `minSeq`로 보장한다. AS-3은 받아들였다(헤더로 토큰, 판정은 `hello`). (5) `device.rotateToken`은 Rust만 부르거나 1차에서 쓰지 않기(§7 Q-07). (6) 재전송 중 받은 전달 이벤트를 묶어서 한 번만 알리기(§3.8.3) |
| 21 | `UiIntent` → 메서드 대응은 §3.7.1. 낡은 기준 오류는 `stale_basis`가 아니라 `3004 command.revisionConflict`다. `intentId`는 `idempotencyKey`다. `SemanticPreviewVM`은 `composer.preview` 결과다. 그림 표시 판은 `BlobRef.variants` |
| 22 | §6.3 적합성 시나리오를 세 리스너 각각에 돌리는 동등성 테스트, 장애 주입(연결 끊기 지점, 데몬 강제 종료, 느린 소비자) |
| 23 | 구현 순서: M1에서 `@helm/protocol` 등록 표 + 가짜 데몬 + 적합성 스위트를 먼저 만들고, 데몬 프로토콜 계층과 앱을 그 위에 붙인다 |

## 6. 구현 단위와 완료 기준

### 6.1 `@helm/protocol`

| 단위 | 파일 | 완료 기준(테스트로 확인할 조건) |
|---|---|---|
| envelope·codec | `src/jsonrpc.ts`, `src/codec.ts` | 유효한 요청·응답·알림을 왕복한다. `additionalProperties` 위반, 숫자 id, 배열 params, 배치, 깊이 65, 배열 10,001, 1 MiB 초과가 각각 정해진 오류 코드로 거부된다 |
| 오류 표 | `src/errors.ts` | §3.3.4의 모든 행이 있다. code와 kind가 각각 유일하다. 생성 문서의 표와 같다(`check-registry`) |
| 등록 표 | `src/registry.ts` | §3.7.1의 모든 메서드가 있다. `cmd`는 모두 `CommandParamsBase`를 포함한다(타입 테스트). `MethodMap`이 모든 이름에 대해 params·result 타입을 낸다 |
| 핸드셰이크 스키마 | `src/handshake.ts` | `DEFAULT_POLICY` 값이 §3.4.4와 같다. 버전 고르기 함수가 경계값(겹침 없음, 한 점 겹침, 포함)에서 맞다 |
| 이벤트·뷰·스트림 스키마 | `src/events.ts`, `src/views.ts`, `src/stream.ts` | 뷰 카탈로그의 모든 이름에 params 스키마가 있다. `ViewResult` 예시 JSON이 스키마를 통과한다 |
| 생성 스크립트 | `scripts/gen-*.ts`, `check-registry.ts` | JSON Schema와 참조 문서가 만들어지고, 등록 표를 바꾸지 않으면 다시 만들어도 내용이 같다(결정적). 서버 처리기 목록과 등록 표가 다르면 실패한다 |
| 브라우저 안전 | 검사 스크립트 | 루트·`./testing` 진입점을 esbuild `platform: "browser"`로 묶었을 때 `node:` import가 없다 |
| 테스트 도구 | `src/testing/` | `FakeDaemon`이 §3.4·§3.5·§3.9의 규칙을 메모리 저장소로 구현하고 §6.3 스위트를 통과한다. 데몬 실물도 같은 스위트를 통과한다 |

### 6.2 `@helm/client`와 데몬 프로토콜 계층

| 단위 | 파일 | 완료 기준 |
|---|---|---|
| 클라이언트 상태 기계 | `packages/client/src/connection.ts` | §3.10.2 표의 모든 행을 가짜 전송·가짜 시계로 재현하는 표 기반 테스트가 통과한다. 인증 계열 실패에서 재접속하지 않는다 |
| 백오프 | `packages/client/src/backoff.ts` | 고정 난수로 0.5·1·2·4…30초 구간과 지터 범위를 확인. `retryAfterMs`가 하한이 된다. ready 30초 뒤 0으로 돌아간다 |
| 구독 복원·gap | `packages/client/src/subscriptions.ts` | 저장된 위치로 다시 구독한다. `from` 불일치에서 다시 구독, 1분 3회에서 재접속. `2001`에서 §3.5.5 순서를 지킨다 |
| 진행 중 명령함 | `packages/client/src/outbox.ts` | 보내기 전에 저장, 응답 후 삭제, 연결이 끊기면 `syncing`에서 같은 키·같은 params로 재전송, 24시간 넘은 항목은 자동 재전송하지 않는다 |
| 뷰 무효화 | `packages/client/src/views.ts` | 태그 교집합 규칙, 열린 뷰만 다시 받기, 키별 디바운스·동시 1개, `caughtUp` 전 지연 |
| 휘발 스트림 | `packages/client/src/stream.ts` | offset 덧붙이기·중복·겹침·구멍 경우별 테스트, `n` 건너뜀에서 `run.partial`, `finalSeq` 전에는 지우지 않음 |
| 리스너 | `packages/daemon/src/protocol/listeners.ts`, `upgrade.ts` | 세 리스너가 같은 처리기를 쓴다. 리스너별 허용 인증 방식이 §3.2.1과 같다. 하위 프로토콜·Authorization 없을 때 400·401 |
| 연결·핸드셰이크 | `connection.ts`, `handshake.ts` | §3.4.7 상태 표의 모든 행. 인증 전 제한(§3.4.5) 각 행 |
| 디스패처 | `dispatcher.ts` | 등록 표에 없는 메서드 `-32601`, scope 위반 `1010`, 동시 요청 33번째 `5002`, `$/cancelRequest`로 조회가 `5004`로 끝남 |
| 이벤트 구독 | `subscriptions/events.ts` | (속성 테스트) 무작위 커밋 순서·필터·구독 시점·재접속 지점에 대해, 클라이언트가 받은 이벤트 합집합이 정본의 필터 결과와 같고 중복·누락이 없다. 재생 중 커밋이 보류분으로 정확히 이어진다 |
| 뷰 | `views.ts` | `minSeq` 대기와 `2006`. (속성 테스트, VIEW-01) 무작위 이벤트열에서 뷰 `data`가 바뀌면 그 이벤트의 `invalidates`와 뷰의 `dependsOn`이 겹친다 |
| 명령 | `commands.ts` | 같은 키·같은 params는 저장된 결과, 다른 params는 `3006`. `basisSeq`보다 뒤에 바뀐 대상은 `3004`. 10 거부 코드가 §3.3.4대로 대응된다. 커밋 이벤트 알림이 응답보다 먼저 나간다(§3.5.9) |
| 파일 | `files.ts` | 한 번에 올리기, 청크·이어 올리기, 해시 불일치 422, 크기 413, Range 206·416, 티켓 만료·연결 종료 후 401, 활성 콘텐츠의 `attachment` 헤더 |
| 백프레셔 | `connection.ts` | 송신 큐가 8 MiB를 넘으면 `stream.chunk`부터 버리고, 지속되면 4008. 응답·tick은 대량 이벤트 뒤에 막히지 않는다 |

### 6.3 적합성 시나리오 [제안]

`@helm/protocol/testing`의 시나리오 DSL로 쓰고, (1) `FakeDaemon`, (2) 실제 데몬의 `tailnet` 리스너(전송 조건은 테스트 훅으로 통과), (3) `loopback` 리스너, (4) `loopback`에 `ssh -W localhost`로 붙은 경로(CI에서 sshd를 띄울 수 있을 때), (5) `local` 리스너에 대해 같은 스위트를 돌린다. 경로 사이에 주고받은 JSON-RPC 메시지 열(요청 id·시각·nonce·연결 ID를 정규화한 것)이 같아야 한다. 이것이 결정 38의 "두 방식에서 메시지와 재전송 의미가 같다"의 확인이다.

| ID | 시나리오 | 기대 |
|---|---|---|
| CT-01 | 정상 핸드셰이크 | 챌린지가 첫 메시지, `hello` 응답의 정책·기능·로그 위치 |
| CT-02 | 하위 프로토콜 없음 | HTTP 400 |
| CT-03 | Authorization 없음·틀림·다른 기기 ID | 401 / `1004` / `1008` |
| CT-04 | 증명 필요 설정에서 증명 없음·nonce 다름·시각 밖 | `1004` / `1007` / `1007` |
| CT-05 | 인증 전 다른 요청, 16 KiB 초과, 10초 무응답, 실패 6회 | 닫기 코드와 `1011` |
| CT-06 | 버전 겹침 없음 | `1003` + 범위, 클라이언트 재접속 중단 |
| CT-07 | 위치가 `maxReplayEvents`보다 뒤 | `2001 tooFar`, 스냅샷 경로 |
| CT-08 | `storeId` 다름 | `2001 storeMismatch`, 캐시 폐기 |
| CT-09 | 위치가 headSeq보다 큼 | `2001 aheadOfHead` |
| CT-10 | 서버가 일부러 구간을 건너뛴 알림(장애 주입) | 클라이언트가 다시 구독하고, 반복되면 재접속 |
| CT-11 | 같은 키·다른 params | `3006` |
| CT-12 | 커밋 직후 응답 전에 연결 끊기 → 재접속 → 같은 키 | `duplicate: true`, 이벤트 한 번만 |
| CT-13 | 느린 소비자(클라이언트가 읽기를 멈춤) | 4008, 재접속 뒤 누락 없음 |
| CT-14 | 휘발 조각 일부 버림, `end`와 영속 이벤트 순서 | `run.partial`로 복원, 텍스트 일치 |
| CT-15 | tick 끊김(서버가 tick을 멈춤) | 클라이언트 35초 뒤 4000 |
| CT-16 | 연결 중 기기 폐기 | `connection.closing` + 4009, 재접속 안 함 |
| CT-17 | 읽기 전용·종료 중·안전 모드 | `5003` / `5001` + `retryAfterMs` / 명령 수락 |
| CT-18 | `basisSeq` 뒤 대상 변경 | `3004` |
| CT-19 | 두 연결이 같은 질문에 답 | 하나 `applied`, 하나 `3008` |
| CT-20 | 커밋 전·후 `$/cancelRequest`, 데몬 꺼짐(502) | `5004` / 정상 결과 / `daemonUnreachable` |
| CT-21 | 시계 차이 | `serverTime` 진단, 증명 시 `1007` |
| CT-22 | Range 다운로드 중 티켓 만료 | 401 후 새 티켓으로 이어 받기 |
| CT-23 | 청크 업로드 중 끊기 | `HEAD`로 이어 올리기, 해시 일치 |
| CT-24 | 정리된 대기 파일 참조 | `3001`(`content.ref_not_found`) |
| CT-25 | 모르는 이벤트 종류·필드, 대체된 레코드 뷰 | 클라이언트 오류 없음 |
| CT-26 | 배치, 깊이·길이 초과 | `-32600` |
| CT-27 | 재생 중 데몬 재시작 | 마지막 `to`부터 이어서, 누락·중복 없음, `bootEpoch` 바뀜 |
| CT-28 | 4 MiB 넘는 이벤트(장애 주입) | `payloadOmitted` |
| CT-29 | 투영 지연(장애 주입) | `2006` 후 재시도로 `asOfSeq ≥ minSeq` |
| CT-30 | 같은 키가 두 연결에서 동시에 | 하나는 기다려 `duplicate: true` |

v0.2 실행 후보의 핸드셰이크 불변 항목(canon-2 §9.8)도 이 스위트에 넣는다: `adapter-cannot-append-events`(클라이언트 메서드에 이벤트 append가 없다, 등록 표 검사), `projection-is-derived`(명령 이름이 `projection.`으로 시작하지 않는다), `expected-cursor-required`(결정 명령에 `basisSeq` 필수), `guided-human-gates`(사람 확정 명령은 `human_client` 채널로만 간다).

### 6.4 성능 기준 (01 NFR)

`just perf`(06·23이 레시피를 만든다)에서 서버 안 측정으로 확인한다.

| 기준 | 측정 | 목표 |
|---|---|---|
| NFR-P-1 | `question.answer` 요청 전송 → 응답 수신(커널 처리 포함, 모델 호출 없음), `loopback` 리스너 | p95 ≤ 300 ms(데몬 안 처리 p95 ≤ 50 ms) |
| NFR-P-2 | 09 커밋 시각 → `events` 알림 수신 | p95 ≤ 500 ms |
| NFR-P-4 | 밀린 이벤트 1,000개 재생(256개 묶음) + 열린 뷰 3개 다시 받기 | 3초 이하 |
| NFR-D-4 | 진행 중 명령함 → 재접속 뒤 한 번만 적용 | CT-12와 같음 |

## 7. 미결 사항

| ID | 질문 | 선택지 | 추천 기본값 |
|---|---|---|---|
| Q-01 | SSH 경로 방식 | B3 `ssh -W` + `loopback` / B2 `-L` → 소켓 / B4 `helm bridge` | B3(20 APP-D03, 17 D17-09와 같음). sshd 포워딩이 막히면 B4를 예비로 구현 |
| Q-02 | 기기 서명 증명(nonce 서명) 사용 | 1차부터 필수 / 필드만 두고 꺼 둠 | 꺼 둠(`proofRequired: false`). 18이 위협 모델에서 필요하다고 정하면 켠다. 서명 키는 Rust가 키체인에 둔다 |
| Q-03 | 화면 투영 동기화 | 무효화 + 다시 받기 / 스냅샷 + 패치 | 무효화(P-07). 다시 받기가 초당 20번을 넘거나 NFR-P-2를 못 맞추는 화면이 생기면 그 뷰만 패치를 검토한다 |
| Q-04 | 멱등 결과 보관 기간 | 24시간 / 7일 / 영구 | 7일(진행 중 명령함 24시간보다 길게). 09가 영구 보관하면 따른다 |
| Q-05 | `maxReplayEvents` | 10,000 / 50,000 / 제한 없음 | 50,000. NFR-P-4 측정으로 다시 정한다 |
| Q-06 | presence 기록 | 휘발만 / 전이를 정본에 | 프로토콜은 휘발 입력. 기록 여부는 16·09 |
| Q-07 | `device.rotateToken`을 앱에서 쓰는가 | Rust IPC로 감싸 쓴다 / 1차에서 쓰지 않고 재페어링 | 1차에서 쓰지 않는다. 토큰 수명 정책(18)이 회전을 요구하면 Rust 쪽 IPC 명령으로 감싼다 |
| Q-08 | 하위 Concern 필터 판정 시점 | 현재 트리 / 이벤트 당시 트리 | 현재 트리(F-28). 이벤트 당시 판정이 필요하면 09가 이벤트에 조상 경로를 저장해야 한다 |
| Q-09 | 이미지 판 생성 | 데몬이 업로드·생성 때 / 요청 때 | 업로드·생성 때 한 번. 라이브러리는 17·12 |
| Q-10 | 데스크톱 기본 이벤트 구독의 payload | `full` / `none` | `full`(타임라인 캐시에 쓴다). 데이터 양이 문제가 되면 `none` + `events.read` |
| Q-11 | TUI의 인증 | `localAdmin` / 기기 토큰 | `localAdmin`(토큰을 WSL 디스크에 두지 않는다). 13·18의 격리가 전제 |
| Q-12 | 직전 버전 지원 기간 | 한 버전 / 기간 | 한 버전(N-1). 1인 사용이라 앱과 데몬을 같은 날 갱신하는 일이 많다 |
| Q-13 | `composer.preview`를 동기 조회로 둘지 | 동기(최대 30초) / `accepted` + 뷰 | 동기. 모델 호출이 길어지면 `accepted` + `semanticPreview` 뷰로 바꾼다 |

## 8. 출처

- 브리프: `docs/design/process/00-design-brief.md` 결정 10, 12, 14, 18, 19, 21, 22, 24, 26, 29, 31~33, 36~39, §2.5, §3.1~§3.5, §5.
- 원천 정리: `pi-api-facts-2.md` §0, §1.1, §3(pi-protocol), §4(pi-server), §5(pi-client), §6(Helm 비교), §7(chord), §8(pi-env), §13; `conversation-extracts-4.md` §4.8, §13.4, §15, §20(20-9~20-11), §21(c21, d24); `helm-canon.md` §19 체크리스트(C8, cursor, Client 소유 범위, 이름 규칙, 막힘 상태 데이터); `helm-canon-2.md` §1.15, §8.4~§8.7, §9.1, §9.3, §9.6, §9.8, §9.9, §11/19 체크리스트, L9·L14·L19; `helm-canon-3.md` §6.10, §10/19 체크리스트; `pi-cases-notes.md` §1, §3.3, §6.3, §11.1~§11.3, §12, §13.4, §14.
- 사례 메모: `.helm-design-work/S4/openclaw-gateway.md` §1~§4, `paseo.md` §3·§4·§8, `pi-web.md` §3·§9, `openclaw.md`; happy-agent 이벤트 재전송 보조 조사(2026-10-11, `~/projects/_ref/happy-agent` `ApiModule.ts:4438-4530`, `ApiEventJournal.ts`, `updates.ts`, `sseWriter.ts`, `EventsModule.ts`, `API.md`).
- 원문: `~/projects/_ref/pi-src/packages/env/docs/protocol.md`(Sync, Frames, Scheduling, Liveness) [원문]; `man ssh`(OpenSSH 9.6p1)의 `-W host:port`, `-L … remote_socket` [원문].
- v0.3: `docs/v0.3/audit/backend-oss-research.md` §1.2, §3, §4, §5; `docs/v0.3/audit/mastra-review.md` §5, §6; `docs/v0.3/09-client-opdc.md` §4~§6; `docs/v0.3/12-implementation-architecture.md` §9, §11.2, §12.
- 다른 설계 문서(1단계 초안): 01 §NFR·FX-16; 03 §3.2.3~§3.6, §5.2; 04 §3.0.2~§3.0.6, 화면별 "표시 데이터"·"명령 의도", §4, §5.2의 10 행; 06 §3.3.1, §3.6; 10 §3.3, §3.4; 12 §3.4.4, §3.15, F-4; 14 §2.2 D7·D8; 16 §3.2.3, §5.2; 17 §1.4, §3.4.1, §3.5, §3.11, §3.15, §5.2; 20 §2.3, §2.4, §3.2, §3.4; 21 UI-D01~D03, E11, E16, §5.2.
- [지식] 표시 항목: JSON-RPC 2.0 명세의 예약 코드 범위, RFC 6455(마스킹, 닫는 코드 범위), RFC 6902(JSON Patch, 기각한 대안), tus 1.0 헤더 이름, LSP `$/cancelRequest` 관례, Node `ws`의 `ws+unix:` 주소, mirrored 네트워킹의 루프백 공유, OpenSSH `AllowTcpForwarding` 기본값.

## ADR 후보

### 19-A1. SSH 경로는 `ssh -W`로 데몬의 별도 loopback TCP 리스너에 붙고, 그 위에 WSS 경로와 같은 HTTP + WebSocket을 쓴다

- 상태: 제안(20 APP-D03, 17 D17-09와 합의된 상태. 18 ADR 후보 18-A2가 보안 조건을 정리)
- 맥락: 결정 38은 데스크톱 앱의 SSH 접속과 두 경로의 메시지·재전송 의미 동일성을 요구한다. `ssh -W`는 Unix 소켓을 가리킬 수 없다. Tailscale serve 대상 포트는 신원 헤더를 요구한다.
- 결정: `127.0.0.1:7841`(`loopback`, 기기 토큰만 받음)을 따로 두고, 클라이언트는 `ssh -W 127.0.0.1:7841`의 표준 입출력 위에서 HTTP 업그레이드와 WebSocket을 그대로 쓴다. 별도 프레임 형식을 정의하지 않는다.
- 근거: HTTP 서버 코드·프레이밍·파일 전송이 경로와 무관하게 같다. 원격 명령을 실행하지 않아 셸 시작 파일 잡음이 섞이지 않는다. 클라이언트 쪽에 열린 포트가 없다. 데몬 쪽 추가는 리스너 하나다.
- 기각한 대안: (1) serve 포트로 `-W`(헤더 없는 연결을 받는 예외가 생김). (2) `-L`로 클라이언트 루프백 포트를 데몬 Unix 소켓에 포워딩(클라이언트 쪽 열린 포트, 프로세스 수명 관리, Unix 소켓에서 `localAdmin`과 구별 필요). (3) exec 채널 stdio + 길이 접두 프레임(pi-env식. 코덱·브리지·파일 전송 대체 경로가 필요). (4) `helm bridge` exec + 동기화 줄(예비 경로로만 남김).
- 결과: 리스너가 셋이 된다. `loopback`은 같은 호스트의 다른 프로세스도 열 수 있으므로 기기 토큰과 인증 전 제한이 보안 경계가 된다. 동등성은 적합성 스위트를 리스너별로 돌려 확인한다.

### 19-A2. 기기 토큰은 업그레이드 헤더로 보내고 `hello`에서 판정한다

- 상태: 제안(최종은 18)
- 맥락: 20은 토큰을 웹뷰 밖(Rust)에 두려 한다. 사례는 "hello 안에서 인증, 실패하면 거절 응답"(Paseo)과 서명 챌린지(OpenClaw)를 보여 준다.
- 결정: `Authorization: Bearer <토큰>`을 업그레이드 요청에 싣고, 데몬은 챌린지 뒤 `hello`를 받을 때 토큰·기기 ID·(선택) 서명 증명을 함께 판정해 결과를 `hello` 응답이나 오류로 돌려준다. SSH 키와 Tailscale 신원은 전송 계층 조건이다. `localAdmin`은 Unix 소켓에서만 받는다.
- 근거: 토큰이 JSON 메시지에 실리지 않으므로 웹뷰 메모리를 거치지 않는다. 판정이 한 곳(`hello`)에 모여 오류 형식이 하나다. 서명 증명을 나중에 켜도 메시지 형식이 바뀌지 않는다.
- 기각한 대안: 업그레이드 단계에서 401로만 판정(오류 kind를 줄 수 없음, 챌린지 서명과 맞지 않음), `hello` params에 토큰(웹뷰 메모리에 토큰), SSH 키만으로 인증(기기별 폐기·감사 불가, `loopback`은 다른 프로세스도 열 수 있음).
- 결과: Rust 전송이 헤더를 붙여야 한다. 브라우저 단독 테스트(20 APP-D15)는 가짜 데몬에서 헤더 없이 통과시키는 테스트 모드가 필요하다.

### 19-A3. 재전송은 정본 이벤트 로그의 seq와 `storeId`, `(from, to]` 구간 계약으로 한다

- 상태: 제안(결정 31의 세부)
- 맥락: 조사한 사례 8곳 모두 클라이언트용 seq를 메모리에 두어 데몬 재시작마다 전체 재동기화가 필요했다(pi-cases-notes §1-1).
- 결정: 프로토콜 seq = 09 전역 seq. 위치는 `{storeId, seq}`. 구독 알림은 `(from, to]` 구간의 필터에 맞는 이벤트를 빠짐없이 담는다. 범위 밖이면 `2001`과 스냅샷 경로.
- 근거: 재시작을 넘어 같은 위치에서 이어 받는다. 필터 구독에서도 gap을 판정할 수 있다. 연결별 버퍼가 필요 없다.
- 기각한 대안: 연결별 seq + gap이면 스냅샷(OpenClaw), 메모리 링 버퍼(happy-agent), 실행별 `{epoch, seq}` 타임라인(Paseo).
- 결과: 09가 범위 읽기·커밋 훅·`storeId` 교체 규칙을 제공해야 한다.

### 19-A4. 화면 투영은 `view.get` + 데몬이 계산한 무효화 태그로 동기화한다

- 상태: 제안
- 맥락: 결정 32는 앱에 Helm 로직을 두지 않는다. 20은 투영 키 단위 캐시(TanStack Query)를 쓴다.
- 결정: 뷰 응답에 `asOfSeq`·`dependsOn`, 영속 이벤트에 `invalidates`를 싣는다. 클라이언트는 교집합으로 낡음을 판단하고 `minSeq`를 붙여 다시 받는다.
- 근거: 앱에 이벤트 → 화면 대응표가 필요 없다. 무효화가 이벤트 스트림 안에 있어 재전송으로 함께 복원된다. 서버가 연결별 뷰 상태와 차이를 들고 있지 않아도 된다.
- 기각한 대안: 스냅샷 + JSON Patch(서버의 연결별 상태, 패치 순서 오류 시 재동기화 경로가 하나 더 필요), Chord delta(안정 계약이 아님), 클라이언트 쪽 리듀서(도메인 로직이 앱에 들어감), 무효화만 보내는 SSE(재전송 없음).
- 결과: 12가 정확한 태그를 계산해야 한다(속성 테스트 VIEW-01). 갱신이 잦은 화면(대화)은 휘발 스트림으로 보완한다.

### 19-A5. 휘발 스트림은 seq 없는 별도 알림으로 보낸다

- 상태: 제안
- 결정: `stream.chunk`에 실행별 `n`과 텍스트 `offset`을 붙이고, 유실 시 `run.partial`로 맞춘다. 최종 내용은 영속 이벤트로 온다.
- 근거: 토큰 단위 영속 쓰기의 비용(happy-agent `LEARNINGS.md`), 재전송 범위 낭비를 피한다. offset은 중복·겹침에 안전하다.
- 기각한 대안: 델타를 영속 이벤트로 기록, 델타를 seq 공간에 섞기(happy-agent API 저널).
- 결과: 느린 소비자에서 먼저 버릴 수 있는 메시지가 생긴다.

### 19-A6. 명령은 domain action별 메서드, 멱등 키와 `basisSeq` 필수

- 상태: 제안
- 결정: 04의 명령 의도 이름을 메서드로 쓰고, 모든 명령에 `idempotencyKey`(`ik_<ULID>`)와 `basisSeq`를 요구한다. 프로토콜 계층이 `basisSeq`를 10의 레코드 revision 기대값(`expect`)으로 바꾼다.
- 근거: canon-3 §6.10.1(generic `execute` 금지), canon-2 L14(cursor에 묶인 Gate), 10 §3.3.4, NFR-D-4.
- 기각한 대안: generic `command.submit`, 클라이언트가 revision을 직접 보내는 방식만(모든 뷰가 revision을 정확히 실어야 함), 전역 expectedCursor(무관한 이벤트로 충돌).
- 결과: 08·10이 `revisionSeq`와 `subjects()`를 제공해야 한다.

### 19-A7. 파일은 같은 리스너의 HTTP로, 업로드는 원시 바이트, 다운로드는 토큰 헤더 또는 연결에 묶인 티켓

- 상태: 제안(결정 31의 세부)
- 결정: §3.11.
- 근거: base64 첨부로 프레임 한도를 넘긴 OpenClaw의 문제를 피한다. SSH 경로에서도 같은 요청을 `ssh -W`로 보낼 수 있다. 기기 토큰을 URL에 넣지 않는다.
- 기각한 대안: WebSocket 바이너리 청크(Paseo), JSON-RPC 안 base64, 별도 파일 서버.
- 결과: 대기 파일 정리(17)와 이미지 판 생성(12·17)이 필요하다.

### 19-A8. 프로토콜 버전은 정수 하나와 기능 목록, 직전 버전 하나 지원

- 상태: 제안
- 결정: §3.12.
- 근거: OpenClaw·Paseo·happy-agent가 모두 정수 버전 + 기능 광고 + 추가형 변경을 쓴다. 1인 환경에서 앱과 데몬을 따로 갱신하는 동안 직전 버전 하나면 충분하다.
- 기각한 대안: semver 협상, 경로 버전(`/v1`), 버전 없이 기능 감지만.
- 결과: `src/compat/`의 호환 코드와 제거 날짜를 관리해야 한다.
