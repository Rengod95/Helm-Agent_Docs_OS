# 19. 클라이언트 프로토콜

- 작성: 2026-10-11, P12(프로토콜)
- 상태: 2a단계 통합판(2026-10-12). 1단계 문서 01~21·24와 조정자 판정(`docs/design/process/rulings-stage2a.md`), 브리프 결정 41~46을 읽고 맞췄다. 이벤트 이름은 09 §3.4, 명령 이름은 10 §3.11, 레코드·ID 접두사는 08을 정본으로 따른다. 모바일 문서 26(P15)은 이 판을 쓰는 동안 아직 없어서 모바일 쪽은 프로토콜 요구로만 적었다(§3.17).
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
| 모바일 클라이언트의 구현 방식, 푸시 알림 경로·제공자, 모바일 기기 인증의 세부 | 26(P15), 18 |

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
| 기준 seq(`basisSeq`) | 사람이 결정을 내릴 때 본 화면이 몇 번 seq 기준이었는지. 커널은 대상 레코드의 `revisionSeq`가 이 값보다 뒤면 낡은 화면에서 내린 결정으로 보고 거부한다(§3.9.3) |
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
| 19, 32, 41 | 데스크톱 앱(Tauri v2 + React 19, 결정 41이 결정 32의 React 18을 대체)이 첫 클라이언트다. 앱에는 Helm 로직이 없다. 그래서 화면 투영은 데몬이 만들어 보내고, 어느 이벤트가 어느 화면을 낡게 하는지도 데몬이 태그로 계산해 보낸다(§3.6.3). 클라이언트는 태그 교집합만 본다 |
| 21, 26 | 외부 접속은 Windows 호스트의 `tailscale serve`(HTTPS/WSS)로 한다. 데몬은 WSL 안 127.0.0.1에만 바인딩한다. Funnel은 쓰지 않는다 |
| 22 | 클라이언트가 없어도 작업이 계속된다. 그래서 끊긴 동안의 이벤트를 다시 받는 재전송이 필요하다 |
| 29 | 기준 원본은 SQLite 이벤트 로그다. 재전송 위치는 이 로그의 seq를 그대로 쓴다 |
| 31 | JSON-RPC 2.0 over WebSocket, 단조 seq, `lastSeq`부터 재전송, 큰 데이터는 HTTP |
| 33, 39 | TUI는 SSH로 WSL에 들어가 pi-tui 기반 Helm TUI를 실행한다. TUI는 WSL 안에서 로컬 리스너에 붙는다. 데스크톱 앱과 같은 클라이언트 코어를 쓴다 |
| 36, 44 | TypeScript 6.0 strict, ESM, Node 24 LTS(결정 44가 결정 36의 Node 22·TS 5.x를 대체), Vitest, 스키마는 TypeBox(`typebox` 1.x, 07) |
| 42 | 휴대폰에서도 질문에 답할 수 있어야 한다. 모바일 클라이언트도 같은 프로토콜과 같은 클라이언트 코어(`@helm/client`)를 쓴다. 앱이 꺼져 있을 때의 알림 경로는 26이 정하고, 이 문서는 프로토콜 쪽 요구만 둔다(§3.17) |
| 46 | 루프백 바인딩은 격리 경계가 아니다. 모든 리스너가 자격 증명을 요구하고(§3.2.1), 모델이 실행하는 도구는 데몬 소켓을 볼 수 없게 격리한다(13 §3.6, 18 D18-04) |
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
| P-03 | 기기 인증은 모든 경로에서 같다. 기기 토큰은 WebSocket 업그레이드 요청의 `Authorization: Bearer` 헤더로 보내고(데스크톱은 Rust가 붙인다, 20 APP-D02), 헤더를 붙일 수 없는 클라이언트(브라우저 WebSocket을 쓰는 모바일·시험 전송)는 두 번째 하위 프로토콜 값 `helm-bearer.<토큰>`으로 보낸다. 데몬은 `hello`를 받을 때 판정해 결과를 `hello` 응답으로 돌려준다. SSH 키와 Tailscale 신원은 전송 계층의 추가 조건이다. `localAdmin`은 `local` 리스너에서만 받는다 | [제안], 최종은 18. "hello 안에서 인증, 실패하면 거절 응답"은 Paseo 방식(pi-cases-notes §12.1-7). ADR 후보 19-A2 |
| P-04 | envelope는 JSON-RPC 2.0이다. 요청 `id`는 문자열, `params`·`result`는 항상 객체, 배치(배열)는 쓰지 않는다. 서버가 클라이언트에 요청을 보내는 일은 없다(서버 → 클라이언트는 알림만) | [결정 31] + 세부 [제안] |
| P-05 | 재전송 위치는 09의 전역 이벤트 로그 seq를 그대로 쓴다. 저장소 정체 `storeId`를 함께 둔다. 사례 8곳 중 데몬 재시작을 넘는 네트워크 재전송 구현은 없으므로 재전송 규칙은 이 문서가 직접 정한다 | [결정 29·31] + `storeId` [제안](Paseo `{epoch, seq}` 커서, pi-cases-notes §1-1·§11.2) |
| P-06 | 이벤트 구독은 `{from, to}` 구간 계약을 쓴다. 알림 하나가 `(from, to]` 구간의 필터에 맞는 이벤트를 빠짐없이 담는다. 클라이언트는 `from`이 자기 위치와 같은지로 gap을 찾는다 | [제안]. Chord `ReplicatedStateSource`의 커서 계약(pi-api-facts-2 §6.2)을 필터 구독에 맞게 고침 |
| P-07 | 화면 투영은 `view.get`으로 받는다. 응답에 `asOfSeq`와 무효화 태그 `dependsOn`을 싣고, 영속 이벤트마다 데몬이 계산한 `invalidates` 태그를 싣는다. 클라이언트는 열린 뷰의 `dependsOn`과 겹치면 `minSeq`를 붙여 다시 받는다. 뷰는 재접속 때 다시 받고 `from` 재전송은 이벤트에만 적용한다 | [제안]. 결정 32(앱에 로직 없음)와 20 APP-D01·AS-1에 맞춤. 스냅샷 + 패치 방식은 기각(ADR 후보 19-A4) |
| P-08 | 휘발 스트림은 별도 알림(`stream.chunk`)으로 보내고 seq를 붙이지 않는다. 실행(run)마다 조각 번호 `n`과 텍스트 `offset`을 붙여 유실과 중복을 알 수 있게 하고, 유실되면 `run.partial`로 현재 조각 상태를 다시 받는다 | [제안]. pi-cases-notes §12.1-6. happy-agent가 델타를 커서 공간에 섞어 재접속 범위를 줄인 문제를 피한다 |
| P-09 | 명령은 domain action마다 메서드 하나를 둔다(generic `execute` 없음). 모든 명령은 `idempotencyKey`(`ik_<ULID>`)가 필수다. 모든 명령은 `basisSeq`(화면 기준 seq)도 필수이고, 커널이 대상 레코드의 `revisionSeq`와 비교한다(09 §3.9.4) | [제안]. canon-3 §6.10.1, canon-2 L14, 10 §3.3.4, 20 APP-D09, 21 UI-D02 |
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
클라이언트(데스크톱 앱 / 모바일 / TUI / 관리 CLI)
  └ @helm/client 클라이언트 코어(TS, 스키마는 @helm/protocol): 연결 상태 기계, hello, 재접속, 구독 복원, 뷰 무효화, 진행 중 명령 재전송
      └ Transport 인터페이스
          ├ 데스크톱: Tauri IPC 채널 ↔ Rust(WSS 또는 ssh -W 위의 WebSocket, 20 APP-D02)
          ├ 모바일(26): 네이티브 전송 또는 브라우저 WebSocket(helm-bearer. 하위 프로토콜)
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
  - `Authorization: Bearer <기기 토큰>` (P-03. 판정은 `hello`에서 한다). 헤더를 붙일 수 없는 전송은 대신 `Sec-WebSocket-Protocol: helm-jsonrpc, helm-bearer.<토큰>`을 보낸다. 서버는 응답에서 `helm-jsonrpc`만 고르고 토큰 값은 되돌려 보내지 않는다(Paseo의 `paseo.bearer.<token>` 하위 프로토콜과 같은 방법, S4 paseo §4). 두 곳에 모두 있으면 헤더를 쓴다
  - 토큰 형식(`helm_dt_` + base64url 43자, 18 §3.8.1)이 틀리면 업그레이드 단계에서 401로 끝낸다. 해시 조회·폐기·만료 판정은 `hello`에서 한다(18 §3.4.3)
- 업그레이드 전 검사(18 §3.4.3): `Host`가 허용 목록(`tailnet`은 설정의 공개 호스트 `server.<tailnet>.ts.net:8448`, `loopback`은 `127.0.0.1:7841`·`localhost:7841`)에 없으면 421, `Origin`이 있는데 허용 목록(기본 빈 목록. 데스크톱 Rust 전송은 `Origin`을 보내지 않는다)에 없으면 403, Tailscale 신원 확인이 실패하면 401, 토큰이 없거나 형식이 틀리면 401, 인증 전 연결 수 초과면 429.
- 업그레이드 전 HTTP 단계에서 전송 조건이 실패하면 HTTP 401(신원 없음, 토큰 없음) 또는 403(허용되지 않는 Origin·신원)으로 끝낸다. 클라이언트는 이 둘을 인증 계열 실패로 보고 자동 재접속을 멈춘다(§3.10.3, 20의 `http_unauthorized`).

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

1. `ssh -T -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -W 127.0.0.1:<HELM_LOOPBACK_PORT> <별칭 또는 user@host>`를 띄운다(`-W`는 `-N -T ExitOnForwardFailure`를 포함한다 [원문: `man ssh`]). 호스트 키 정책은 20·18.
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
| `POST /pair` | 페어링 코드로 기기 토큰 발급. `tailnet` 리스너에서만 받는다(18 §3.4.1) | 페어링 코드(본문) + Tailscale 신원 | §3.7.7 |
| `POST /devices/self/rotate` | 현재 기기 토큰 교체(2차 기능, 18 §3.8.3). `tailnet`·`loopback` | 현재 기기 토큰(헤더) | §3.7.7 |
| `POST /files/u`, `HEAD /files/u/<uploadId>`, `PATCH /files/u/<uploadId>` | 업로드(한 번에, 또는 청크 이어 올리기) | `Authorization: Bearer <기기 토큰>` | §3.11.3 |
| `GET /files/b/<blobId>` | 다운로드(Range 지원). `?variant=thumb\|display`로 이미지 판 | `Authorization: Bearer <기기 토큰>` | §3.11.2 |
| `GET /files/t/<ticket>` | 티켓 다운로드(Range 지원). 헤더를 붙일 수 없는 곳용 | 티켓(경로) | §3.11.2 |

- 모든 HTTP 응답에 `Cache-Control: no-store`(파일 내용 응답은 불변이므로 `private, max-age=31536000, immutable`과 `ETag`, §3.11.2), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`를 붙인다(experimental.v0 서버의 기본값, canon-2 §8.4·§8.7).
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
| 1003 | `protocol.unsupported` | false | 공통 프로토콜 버전이 없다. 앱 또는 데몬 업데이트가 필요하다 | `serverMin`, `serverMax`, `serverVersion`(데몬 semver, 04·05 요구) |
| 1004 | `auth.failed` | false | 토큰 또는 증명이 맞지 않는다 | - |
| 1005 | `auth.revoked` | false | 폐기됐거나 토큰이 만료된 기기다(18 §3.8.2: 절대 365일, 유휴 90일) | `reason`: `revoked` \| `expired_absolute` \| `expired_idle`(18 §3.4.4), `revokedAt?`, `expiredAt?` |
| 1006 | `auth.unknownDevice` | false | 페어링되지 않은 기기 ID다 | - |
| 1007 | `auth.challengeStale` | true | 챌린지 nonce 불일치, 서명 시각 허용 범위 밖. 다시 연결하면 새 챌린지를 받는다 | `serverTime` |
| 1008 | `auth.methodNotAllowed` | false | 이 리스너에서 받지 않는 인증 방식이다(예: TCP 리스너의 `localAdmin`), 또는 토큰의 기기와 `hello`의 기기 ID가 다르거나 전송 조건과 맞지 않는다(18 §3.6.1) | `listener`, `reason`: `method_not_allowed` \| `device_mismatch` \| `node_mismatch` |
| 1009 | `pairing.invalidCode` | false | 페어링 코드가 틀렸거나 만료·사용·소진됨(`POST /pair` 응답 본문에 쓴다). 사유를 구분하지 않는다(코드 존재 여부를 알리지 않기 위해, 18 §3.7.4). 감사 기록에만 사유가 남는다 | - |
| 1010 | `scope.forbidden` | false | 연결에 그 메서드의 범위(scope)가 없다 | `required` |
| 1011 | `rateLimited` | true | 요청이 너무 잦다: 인증 실패(출처별 1분 5회 → 60초, 10분 20회 → 10분, 18 §3.14), 페어링 시도, 명령 속도(연결당 초당 20, 순간 100) | `retryAfterMs` 필수 |
| 2001 | `replay.outOfRange` | false | `from` 위치에서 재전송할 수 없다. 스냅샷 경로로 간다(§3.5.5) | `reason`: `storeMismatch` \| `beforeOldest` \| `tooFar` \| `aheadOfHead`, `storeId`, `headSeq`, `oldestReplayableSeq` |
| 2002 | `subscription.notFound` | false | 없는(이미 해제된) 구독 ID | `sub` |
| 2003 | `subscription.limit` | false | 연결당 구독 수 한도 초과 | `max` |
| 2004 | `view.unknown` | false | 모르는 뷰 이름 | `view` |
| 2005 | `view.targetNotFound` | false | 뷰 params가 가리키는 레코드가 없다 | `id` |
| 2006 | `view.notReady` | true | 투영이 요청한 `minSeq`에 아직 이르지 않았다 | `asOfSeq`, `minSeq` |
| 2007 | `filter.invalid` | false | 이벤트 필터가 잘못되었다 | `issue` |
| 2008 | `run.notFound` | false | 실행 ID가 없거나 이미 끝났다 | `runId` |
| 3001 | `command.rejected.content` | false | 커널이 내용 때문에 거부했다(10 §3.4.4의 `invalid.*`·`not_found.*`·`policy.*`·`conflict.invalid_transition` 등) | `reason`(10 코드), `ruleId`, `missing`, `nextActions`, `kernelMessage`, `rejectionEventSeq?` |
| 3002 | `command.rejected.authority` | false | 커널이 자격 때문에 거부했다(10의 `denied.*`·`gate.*`, `basis` A 또는 P) | `reason`, `basis`, `missing`, `nextActions` |
| 3003 | `command.rejected.path` | false | 커널이 경로 때문에 거부했다(10의 `path.*`). 프로토콜 계층이 채널을 고정하므로 정상 클라이언트에서는 나오지 않는다. 버그 보고 대상 | `reason` |
| 3004 | `command.revisionConflict` | false | 대상 레코드의 `revisionSeq`가 `basisSeq`(또는 `expect`)보다 뒤다(10 `conflict.version_mismatch`). 화면을 새로 받아 다시 판단해야 한다 | `subject`, `basisSeq`, `currentRevisionSeq`, `rebase`(10의 대상 현재 요약) |
| 3005 | `command.targetNotFound` | false | 명령 대상 레코드가 없다 | `targetId` |
| 3006 | `idempotency.keyReused` | false | 같은 멱등 키로 다른 내용을 보냈다(10·09 `conflict.idempotency_key_reuse`. 저장하지 않는다) | `originalCommandId` |
| 3007 | `command.inProgress` | true | 같은 멱등 키의 첫 요청이 아직 처리 중이고 응답 대기 시간을 넘었다 | `retryAfterMs` |
| 3008 | `command.alreadyResolved` | false | 대상이 이미 끝난 상태다(10 `conflict.already_resolved`: 질문이 이미 답해짐·가정 확정·철회, 결과가 이미 확인됨). 다른 기기나 자동 처리가 먼저 했다 | `target`(`RecordRef`), `resolvedAtSeq`, `resolvedAt`(ISO), `resolvedBy`(행위자 문자열), `resolvedVia`(`deviceId`가 있으면 그 기기), `outcome`(예: `answered`, `assumed`, `withdrawn`) |
| 3009 | `command.superseded` | false | 대상이 새 판으로 대체됐다(10 `conflict.superseded`: 합의 개정, 질문 다시 쓰기, 결과 재제출). 새 대상을 보고 다시 판단해야 한다 | `target`(`RecordRef`), `supersededBy`(`RecordRef`: id, 종류, 표시 번호, 제목), `supersededAtSeq` |
| 4001 | `blob.tooLarge` | false | 파일 크기가 한도를 넘는다 | `maxBytes` |
| 4002 | `blob.notFound` | false | 없는 파일 ID | `blobId` |
| 4003 | `upload.notFound` | false | 없거나 만료된 업로드 | `uploadId` |
| 4004 | `upload.incomplete` | true | 요청 본문이 선언한 길이보다 짧게 끝났다(연결 끊김). `HEAD`로 위치를 받아 이어 올린다 | `receivedBytes`, `size` |
| 4005 | `upload.hashMismatch` | false | 받은 내용의 SHA-256이 선언과 다르다 | `expected`, `actual` |
| 4006 | `ticket.limit` | true | 연결당 티켓 수 한도 초과 | `max`, `retryAfterMs` |
| 4007 | `blob.gone` | false | 보존 정책 가지치기나 비밀 가림으로 내용이 지워졌다(HTTP 410 본문) | `reason`: `pruned` \| `redacted` |
| 5001 | `daemon.draining` | true | 데몬이 종료 중이다 | `retryAfterMs` |
| 5002 | `daemon.busy` | true | 연결당 동시 요청 한도 초과, 또는 일시 과부하 | `retryAfterMs` |
| 5003 | `daemon.readOnly` | false | 데몬이 읽기 전용(복구) 모드다. 조회만 된다(17) | `mode`, `since` |
| 5004 | `request.cancelled` | false | `$/cancelRequest`로 취소했다(명령이면 적용되지 않았다) | - |
| 5005 | `request.timeout` | true | 서버 쪽 처리 시한을 넘었다(조회에만 쓴다. 명령은 §3.9.2) | - |
| 5006 | `runtime.unavailable` | true | 실행 제어 대상 런타임이 응답하지 않는다 | `retryAfterMs` |
| 5007 | `feature.disabled` | false | 메서드는 알지만 이 데몬 설정에서 꺼져 있다 | `feature` |

거부 세 갈래(브리프 §3.5, 10 §3.4.1, 판정 §1)와의 대응: 10의 코드 접두사로 갈래가 정해진다(10 §3.4.4). `invalid.*`·`not_found.*`·`policy.*`·`conflict.invalid_transition`·`conflict.duplicate_id`·`conflict.agreement_revision_stale` → 내용(`content`) 3001, `denied.*`·`gate.*` → 자격(`authority`) 3002, `path.*` → 경로(`path`) 3003. 그 밖의 `conflict.*`는 따로 낸다: `conflict.version_mismatch` → 3004, `conflict.already_resolved` → 3008, `conflict.superseded` → 3009, `conflict.idempotency_key_reuse` → 3006. 대상이 없을 때의 `not_found.record`는 명령 대상이면 3005, 근거 참조면 3001이다.

- 10 §3.4.5에 따라 거부는 `command.rejected` 이벤트로 남으므로 `details.rejectionEventSeq`에 그 seq를 넣는다. 10의 `Rejection.next`(`{command, hint}`)는 `details.nextActions`의 `{action: command, label: hint}`로 옮긴다. 10의 `Rejection.message`(한국어, 모델용 문장)는 `details.kernelMessage`에 넣고 JSON-RPC `message`에는 넣지 않는다.
- 10의 결과 상태와의 대응: `accepted` → 성공 응답 `status: "applied"`, `needs_gate` → 성공 응답 `status: "gated"`(질문이 생겼다. `questionId`를 싣는다, §3.7.2), `rejected` → 3001~3003, `conflict` → 3004·3006·3008·3009, `error`(`kernel.*`, 커널 버그) → -32603.
- 저장소·접수 단계의 코드(09 §3.9.2): `path.fenced`(쓰기 소유권을 잃음, 17·09) → 5001(`retryable`, 데몬이 곧 재시작), `path.store_read_only` → 5003, `invalid.event_too_large` → -32603(커널 버그로 보고), SQLite 바쁨 시간 초과·디스크 가득 참 같은 일시 실패 → 5002(`retryable`).
- v0.2 실행 후보 결과 코드와의 대응(canon-2 §9.3): `invalid.protocol_request` → -32600, `invalid.protocol_method` → -32601, `invalid.command_schema` → -32602, `conflict.idempotency_key_reuse` → 3006, `conflict.expected_cursor_mismatch` → 3004(전역 커서 대신 레코드 `revisionSeq`, 09 §3.9.4), `denied.*` → 3002 또는 3003, `gate.human_*` → 3002, `policy.*`·`invalid.*`·`not_found.*` → 3001, `runtime.not_running` → 5006. `runtime.*`의 나머지와 `provider.*`는 런타임 내부 결과라 이 프로토콜의 오류로 오지 않고 이벤트 payload(09·12)로 온다.

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
  kind: "desktop" | "mobile" | "tui" | "cli" | "test";
  version: string;           // 앱 semver
  build?: string;            // 커밋 해시 등
  platform: "macos" | "windows" | "linux" | "ios" | "android";
  instanceId: string;        // 앱 프로세스 실행마다 새로 만드는 무작위 ID. 로그·presence 구분용
}

export type HelloAuth =
  | {
      method: "deviceToken";
      deviceId: string;      // `dv_<ULID>`(08 §3.2). 토큰 값은 업그레이드 요청(Authorization 헤더 또는 helm-bearer 하위 프로토콜)으로만 보낸다
      proof?: DeviceProof;   // proofRequired이면 필수
    }
  | { method: "localAdmin" }; // local 리스너에서만

/** 기기 키 서명(18이 키 형식을 확정). 서명 대상은 UTF-8 문자열
 *  "helm-hello/1\n" + serverId + "\n" + nonce + "\n" + deviceId + "\n" + signedAt
 *  OpenClaw의 nonce 서명 방식을 줄인 것(S4 openclaw-gateway §2.2) */
export interface DeviceProof {
  alg: "ed25519" | "es256";  // es256: 모바일 하드웨어 보호 키(Secure Enclave는 P-256만, 18 §3.18.2 7번)
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
   - `deviceToken`: 18 §3.6.1의 `helloDeviceAuth`를 부른다. 업그레이드 때 받아 둔 토큰(헤더 또는 `helm-bearer.` 하위 프로토콜)이 없거나 형식이 틀리면 `1004 auth.failed`. 기기가 없으면 `1006 auth.unknownDevice`, 폐기·만료면 `1005 auth.revoked`(`reason`: `revoked`·`expired_absolute`·`expired_idle`), 토큰이 틀리면 `1004`, 토큰의 기기와 `auth.deviceId`가 다르면 `1008`(`device_mismatch`), `tailnet`에서 묶인 tailnet 노드와 다르면 `1008`(`node_mismatch`). `proofRequired`인데 증명이 없거나 틀리면 `1004`, nonce·시각이 맞지 않으면 `1007 auth.challengeStale`.
   - `localAdmin`: `local` 리스너이면 통과한다(18 §3.6.3: 소켓 파일 권한이 근거).
   - 출처별 인증 실패가 1분에 5회를 넘으면 60초, 10분에 20회를 넘으면 10분 동안 `1011 rateLimited`로 답한다(18 §3.14). 출처는 `tailnet`이면 whois로 확인된 `X-Forwarded-For`의 tailnet 주소, `loopback`이면 리스너 전체다.
   - 기기당 동시 연결이 8개를 넘으면 가장 오래된 연결을 `connection.closing{kind:"replaced"}` 후 4009로 닫는다. 전체 연결이 64개면 새 업그레이드를 503으로 거절한다(18 §3.14).
6. scope 부여(§3.4.6). 연결 상태를 `ready`로 바꾸고 응답을 보낸다.
7. 기기의 `lastSeenAt` 갱신(1분에 한 번으로 묶음, 18 §3.6.1)과 `device.connected`·`device.disconnected`(09 §3.4.13) 기록. 인증 거부는 `auth.denied`로 묶어 남긴다(18 §3.13.2).

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
export type Scope = "read" | "decide" | "devices" | "devicesLimited" | "admin";
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
  commandRate: { perSecond: number; burst: number }; // 연결당 명령 속도. 기본 20/초, 순간 100(18 §3.14)
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
| 출처별 인증 실패 | 1분에 5회(60초), 10분에 20회(10분) | `1011` + `retryAfterMs` |
| 서버가 보내는 것 | `hello.challenge`, `hello` 응답, 오류 응답만 | - |

#### 3.4.6 scope

| scope | 허용 메서드 | `deviceToken` | `localAdmin` |
|---|---|---|---|
| `read` | `ping`, `events.*`, `view.get`, `record.locate`, `stream.*`, `run.partial`, `search.query`, `presence.report`, `blob.downloadTicket`, `daemon.status`, `protocol.describe`, HTTP 다운로드 | 예 | 예 |
| `decide` | §3.7.5의 모든 명령 메서드, HTTP 업로드 | 예 | 예 |
| `devices` | `device.*`, `connection.*` | 예(모바일 제외) | 예 |
| `devicesLimited` | `device.list`, `device.revoke`(자기 자신·다른 기기), `connection.list` | 모바일 기기(18 §3.18.2 5번: 휴대폰으로 새 기기를 들여오지 못하게 `device.createPairingCode`·`device.registerPush` 외 관리 명령 거부) | - |
| `admin` | `admin.*`, `device.rebind` | 아니요 | 예 |

- 1인 앱이므로 페어링된 데스크톱·TUI 기기는 `read`, `decide`, `devices`를 받는다. 모바일 기기(`clientKind: "mobile"`)는 `read`, `decide`, `devicesLimited`를 받고, 자기 푸시 등록(`device.registerPush`·`unregisterPush`)은 `devicesLimited`로 허용한다. 기기별로 줄이는 정책(예: 읽기 전용 기기)은 18이 정하면 `scopes`로 내려 준다. 클라이언트는 `scopes`에 없는 동작을 화면에서 끈다.
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
- seq 성질(09 D09-2): 정수, 1부터 시작, 커밋 순서대로 빈칸 없이 증가, 한 번 부여된 seq의 이벤트는 바뀌지 않는다, 데몬 재시작 뒤에도 이어진다. 프로토콜은 빈칸 없음에 기대지 않는다(필터 구독과 `(from, to]` 계약이 빈칸을 견딘다).
- `storeId`: 이벤트 저장소의 정체(ULID, 09 D09-12, `meta.store_id`). 저장소를 만들 때 정하고, 백업에서 복원하면 새 값으로 바꾼 뒤 `store.restored { previousStoreId, storeId, backupId, upToSeq }`를 남긴다(09 §3.14.2, 17 §3.9.4). 클라이언트는 위치를 항상 `{storeId, seq}` 쌍으로 저장한다.
- `bootEpoch`: 데몬 프로세스가 시작할 때마다 바뀐다(17 §1.4). 재전송 판정에는 쓰지 않는다. 화면에 "데몬이 재시작됨"을 보이고(20), 진단 로그를 맞춰 보는 데만 쓴다.
- 보존: 정본 로그는 지우지 않으므로 `oldestReplayableSeq`는 보통 1이다. 09·17이 오래된 이벤트를 다른 저장소로 옮기는 정책을 두면 그 경계 값을 이 필드로 알린다.

#### 3.5.2 영속 이벤트와 휘발 스트림

| 구분 | 영속 이벤트 | 휘발 스트림 |
|---|---|---|
| 예 | `concern.opened`, `question.recorded`, `choice.committed`, `toolcall.completed`, `run.message_recorded`(메시지 완성) 등 09 §3.4의 모든 이벤트 | 토큰 단위 텍스트, 생각 텍스트, 도구 출력 조각, 진행 단계 표시 |
| 출처 | 커밋된 정본 | 런타임(12)의 실행 중 메모리 |
| seq | 있음 | 없음. 실행마다 조각 번호 `n` |
| 재전송 | `from` 위치부터 | 없음. 놓치면 `run.partial`로 현재 상태를 받는다 |
| 버려도 되는가 | 안 된다 | 된다. 완성된 내용은 영속 이벤트로 다시 온다 |
| 알림 | `events` | `stream.chunk` |

- 휘발 스트림을 정본 로그에 넣지 않는 이유: 토큰마다 영속 트랜잭션을 돌리면 단일 JS 스레드가 묶이고(happy-agent `events/LEARNINGS.md:11-19`, happy-agent 조사 §4), 재전송 범위가 델타로 채워진다.
- 런타임(12)은 실행 하나가 만드는 휘발 조각의 최종 결과를 반드시 영속 이벤트로 남긴다(예: 메시지 완성 이벤트에 전체 텍스트, 도구 결과 이벤트에 출력 요약과 blob 참조). 클라이언트는 영속 이벤트를 받으면 해당 휘발 조각을 버린다.

```ts
/** 영속 이벤트의 프로토콜 표현. 09 §3.2 EventEnvelope의 공개용 사본(redact: true, 09 §3.11.5)에서 만든다.
 *  바꾸는 것은 셋뿐이다: ms 시각 → ISO 문자열(브리프 §3.3), 해시 필드(prevHash, hash) 제외, invalidates 추가 */
export interface EventWire {
  v: 1;                          // 09 EVENT_ENVELOPE_VERSION
  seq: number;                   // 09 전역 seq(무간격)
  id: string;                    // `ev_<ULID>`
  type: string;                  // 09 §3.4 카탈로그 이름
  typeVersion: number;           // payload 스키마 버전(09 §3.13.3 업캐스터)
  category: "domain" | "governance" | "runtime" | "kernel" | "system" | "measurement";
  plane: "N" | "E" | "M" | "A" | "P" | null;
  occurredAt: string;            // ISO 8601 UTC
  recordedAt: string;            // ISO 8601 UTC
  actor: ActorRef;               // 08 §3.3.2 (객체. 표시용 문자열은 화면이 만든다)
  via: Via;                      // 08 §3.3.2
  authority: string[];           // 09 AUTHORITY_PATTERN 문자열
  subject: string | null;        // 주 대상 레코드 ID
  refs: string[];                // 영향받은 다른 레코드
  scope: { projectId: string | null; goalId: string | null; concernId: string | null; workUnitId: string | null; runId: string | null };
  commandId: string | null;      // `cm_<ULID>`(10)
  causationId: string | null;
  correlationId: string | null;
  bootEpoch: string;
  provenance: { rulesVersion: string | null; contextRef: string | null; adapterId: string | null } | null;
  redactions: string[];          // 공개 사본에서 지운 민감 필드 이름(09 §3.2 규칙 10, 18)
  payload?: Record<string, unknown>;   // filter.payload = "none"이면 없음. 시각 필드는 ISO로 바꾼다
  payloadOmitted?: "tooLarge" | "filtered";
  invalidates: string[];         // 무효화 태그(§3.6.3). 프로토콜 계층이 보낼 때 계산한다. 빈 배열 가능
}
```

- 이벤트는 저장본이 아니라 09의 공개용 사본(`readEvents({ redact: true })`)에서 만든다. 민감 필드는 지운 이름이 `redactions`에 남는다(09 §3.2 규칙 10). 이벤트 payload에 비밀을 넣지 않는 규칙(09·18, canon-2 L9)이 1차 방어이고 이 사본이 2차 방어다.
- 이벤트 하나의 정규화 JSON은 256 KiB를 넘지 않는다(09 §3.2 규칙 6, 넘으면 저장소가 `invalid.event_too_large`로 거부). 큰 도구 출력은 blob으로 저장하고 payload에는 `BlobRef`만 넣는다.

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

- 태그는 레코드 ID(`cn_…`, `qs_…`, `wu_…` 등) 또는 집계 이름(`@` 접두)이다. 집계 이름: `@home`, `@brief`, `@inbox`, `@autonomous`, `@concernTree`, `@goals`, `@observer`, `@recovery`, `@devices`, `@dials`, `@settings`, `@search`, `@metrics`, `@tray`.
- `invalidates`는 프로토콜 계층이 이벤트를 보낼 때 계산한다(저장하지 않는다. 09는 바뀌지 않는다): `invalidates(e) = {e.subject} ∪ e.refs ∪ {e.scope.goalId, e.scope.concernId, e.scope.workUnitId} − {null} ∪ aggregateTags(e)`. `aggregateTags`는 12가 `@helm/runtime`의 화면 투영 모듈에 두는 순수 함수다(이벤트 종류·범주·payload 일부 → 집계 이름. 예: `question.*` → `@inbox`, `@home`, `@tray`). 입력이 이벤트 하나뿐이므로 재전송한 옛 이벤트에도 같은 값이 나온다. 뷰 처리기는 뷰를 만들 때 읽은 레코드 ID와 집계 이름을 `dependsOn`에 넣는다. 둘 다 데몬이 계산하므로 앱에 "이벤트 종류 → 화면" 대응표가 필요 없다(20 AS-1의 요구를 태그로 일반화했다. 결정 32).
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
  afterSeq: number;                    // 이 조각을 내보낼 때의 마지막 영속 seq(09 §3.5 공통 필드)
  part: StreamPart;
}

export type StreamPart =
  | { kind: "text"; messageId: string; offset: number; text: string }      // offset: 이 조각 앞까지의 길이(UTF-16 단위)
  | { kind: "thinking"; messageId: string; offset: number; text: string }
  | { kind: "toolArgs"; toolCallId: string; offset: number; text: string }  // 도구 인자 스트리밍
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
  runStatus: "queued" | "running" | "stopping" | "awaiting_human" | "awaiting_recovery" | "interrupted" | "ended";   // 12 §3.2 RunStatus
  threadId: string;                    // `th_<ULID>`(12): 같은 대화를 이어 쓰는 run들의 계보
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
- `afterSeq`가 클라이언트 위치보다 크면 클라이언트는 그 영속 이벤트를 받을 때까지 조각 적용을 미룰 수 있다(재접속 직후 휘발 조각이 재전송보다 먼저 오는 경우).
- 제어 문자: 데몬은 휘발 조각과 이벤트 payload의 사람이 읽는 텍스트에서 C0(탭·줄바꿈·복귀 제외)·C1 제어 문자와 SGR(`ESC [ … m`)이 아닌 ESC 시퀀스를 지운다(12 §5.2 요구, canon-2 §11/12 "출력 정화"). SGR은 TUI가 쓰도록 남기고, 데스크톱은 렌더할 때 지운다. 터미널 제어 시퀀스가 TUI 화면을 조작하는 것을 막는다.

09 §3.5의 휘발 종류와의 대응:

| 09 종류 | `StreamPart.kind` | 12의 원천 |
|---|---|---|
| `run.text_delta` | `text` | pi `message_update`(assistant) |
| `run.thinking_delta` | `thinking` | 같은 메시지의 생각 조각(보일 때만) |
| `run.toolcall_args_delta` | `toolArgs` | 도구 인자 스트리밍 |
| `toolcall.output_delta` | `toolOutput` | 도구 출력 진행 |
| `run.step_progress` | `status` | 단계·경과 시간 |
| (12 `tool.progress`, F-4) | `toolPhase` | `tool_execution_start` phase requested / executing |
| `store.head` | (조각 없음) 빈 `events` 알림과 `tick.headSeq`로 대신한다 | - |
| `device.heartbeat` | (조각 없음) 클라이언트 → 서버 `presence.report`로 대신한다 | - |

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

메서드 이름은 04 §5.2의 10 행(명령 의도 후보 목록)과 화면별 "명령 의도"를 그대로 받았고, 10의 사람 채널 명령 중 04에 의도가 없는 것도 메서드로 둔다(사람만 낼 수 있는 명령을 프로토콜이 빠뜨리면 그 명령을 낼 길이 없다). 커널 명령 이름은 10 §3.11이 정본이다(판정 §1). 이 표는 메서드 → 커널 명령 대응을 두고, 10의 이름이 바뀌면 "커널 명령" 열만 고친다. 10에 아직 없는 명령은 "10에 요구"로 적었다(§5.2). 종류: `ctl` 연결 제어, `read` 조회·구독, `cmd` 명령(멱등 키·`basisSeq` 필수), `adm` 관리.

연결·조회·구독:

| 메서드 | 종류 | scope | 결과 | 절 |
|---|---|---|---|---|
| `hello` | ctl | (인증 전) | `HelloResult` | §3.4 |
| `ping` | ctl | read | `{ serverTime, headSeq }` | §3.7.2 |
| `events.subscribe` / `events.unsubscribe` | read | read | §3.5.3 | §3.5 |
| `events.read` | read | read | `EventsReadResult` | §3.7.3 |
| `view.get` | read | read | `ViewResult` | §3.6.3 |
| `record.locate` | read | read | `RecordLocation` | §3.7.3 |
| `search.query` | read | read | `SearchResult` | §3.7.3 |
| `stream.subscribe` / `stream.unsubscribe` | read | read | §3.6.4 | §3.6.4 |
| `run.partial` | read | read | `RunPartial` | §3.6.4 |
| `composer.preview` | read | decide | `SemanticPreviewResult` | §3.7.5 |
| `presence.report` (알림) | read | read | 응답 없음 | §3.7.8 |
| `blob.downloadTicket` | read | read | `{ path, expiresAt }` | §3.11 |
| `daemon.status` | read | read | `DaemonStatus` | §3.7.8 |
| `protocol.describe` | read | read | `ProtocolDescription` | §3.13 |

사람 명령(모두 `decide` scope, 결과 `CommandResult`, 절 §3.7.5). 04 이름 → 10 명령:

| 메서드 | 커널 명령(10 §3.11, 11 §3.18) | 비고 |
|---|---|---|
| `question.answer` | `question.answer` | `optionId`·`answer` |
| `question.proceedWithAssumption` | `question.answer`(답 `accept_assumption`) | 11 §3.18 대응. 권리 게이트면 `policy.answer_option_not_allowed`(3001) |
| `question.requestReframe` | `question.answer`(답 `reframe_question`) | 같음 |
| `question.requestInquiry` | `question.answer`(답 `experiment_first`) | 같음 |
| `question.delegate` | `question.answer`(답 `delegate`) | 같음 |
| `question.defer` | `question.defer` | `until` 형식은 11 §3.18 |
| `question.escalate` | `question.escalate` | 사람이 "지금 보기"(10 요구 반영) |
| `contest.file` | `decision.contest` | 대상은 08 `ObjectionTarget`(판정 J-36). 결과 이벤트 09 `objection.filed`(판정 J-30) |
| `decision.confirm` | `decision.confirm` | 혼자 정한 결정 일괄 확인 |
| `autonomous.markSeen` | (10에 요구: `autonomous.mark_seen`, 이벤트 09 `autonomous.seen`) | "봤음"은 확인·승인이 아니다(21 §3.7.3) |
| `objection.withdraw` / `objection.dismiss` | `objection.withdraw` / `objection.dismiss` | |
| `choice.commit` / `choice.revoke` | `choice.commit` / `choice.revoke` | 선택 요청 질문 밖에서 사람이 직접 정할 때 |
| `finding.confirm` / `finding.withdraw` | `finding.confirm` / `finding.withdraw` | |
| `criterion.confirm` / `criterion.reject` | `preference.criterion.confirm` / `preference.criterion.reject` | |
| `reaction.record` | `observation.record`(사람 반응, 08 `ReactionPayload`) | `kind`에 `comparison`, 대상에 가능성 ID(15 §5.2) |
| `reaction.amend` / `reaction.withdraw` | `observation.annotate` / (10에 요구: 반응 철회, 이벤트 09 `observation.retracted`) | |
| `stimulusRound.close` | (15·10에 요구: `inquiry.round_end`, 이벤트 09 `inquiry.round_ended`) | 마감 조건은 15 §3.6.4 |
| `possibility.pin` / `possibility.dismiss` | 15 정의(이벤트 09 `possibility.pinned`·`possibility.dismissed`) | 15 §5.2 요구 |
| `inquiry.requestFrame` / `proposeCandidate` / `markAssumption` / `pinCheck` / `requestDecision` / `stop` / `fillCell` / `pinLens` | 15 정의(`inquiry.*`) | `inquiry.stop`은 rulings §1이 10에 추가를 요구 |
| `agreement.confirm` | `agreement.confirm` | `edits`(사람 고침) 포함 |
| `agreement.revise` | `agreement.confirm`(`edits`) | 사람의 고침은 확정과 함께 낸다(10 §3.11.6). 고친 뒤 확정하지 않으려면 `agreement.correctUnderstanding` |
| `agreement.narrow` | 상태 `proposed`면 `agreement.confirm`(좁힌 범위 `edits`), `active`면 `agreement.renegotiate` | |
| `agreement.decline` | `agreement.decline` | |
| `agreement.release` | `agreement.release` | 활성 합의 취소(03 "취소") |
| `agreement.correctUnderstanding` | (10에 요구: 에이전트에게 check-back 재작성 요청) | |
| `grant.issue` / `grant.revoke` | `grant.issue` / `grant.revoke` | 맡긴 범위(비상 합의 포함) |
| `result.accept` | `result.accept`(decision `accepted`) | |
| `result.acceptWithConditions` | `result.accept`(decision `conditional`) | |
| `result.requestRevision` | `result.accept`(decision `revision_requested`) | |
| `result.reopen` | `result.accept`(decision `criteria_wrong` 또는 `rejected`, `reopenTo`) | 기본 `reopenTo`는 직전 I(14 U-26, 판정 J-04) |
| `obligation.confirmDone` / `defer` / `transfer` / `waive` / `reopen` | `obligation.resolve` / `obligation.defer` / `obligation.transfer` / `obligation.waive` / `obligation.reopen` | |
| `goal.propose` | `goal.propose`(`activateNow`) | 사람이 Goal을 직접 만들 때 |
| `goal.revise` | `goal.revise` | |
| `goal.confirmRevision` / `goal.rejectRevision` | `goal.revision.confirm` / `goal.revision.reject` | |
| `goal.confirmAchieved` / `goal.rejectAchieved` | `goal.achievement.confirm` / `goal.achievement.reject` | |
| `goal.pause` / `goal.resume` / `goal.retire` | `goal.pause` / `goal.resume` / `goal.retire` | |
| `concern.propose` | `concern.open`(사람, `origin`·`entrySignals`) | 04 이름 유지 |
| `concern.revise` | `concern.reframe` | |
| `concern.hold` / `concern.resume` | `structure.hold` / (10에 요구: 보류 해제) | |
| `concern.close` / `concern.reopen` | `concern.close` / `concern.reopen` | |
| `loop.requestTransition` | `loop.transition`(사람) | 14 "루프 직접 지정" |
| `loopPlan.revise` | `loop_plan.record`(사람) | 14 §5.2 "계획 수정" |
| `structure.request` | (14·10에 요구: 사람이 나누기·합치기를 요청하는 명령. 사람이 구조 전체를 직접 지정하면 `structure.<op>`) | |
| `mode.set` | `mode.route`(사람) | |
| `dial.set` / `dial.unset` | `dial.set` / `dial.unset` | 키·값은 14 |
| `settings.update` | (10에 요구, 이벤트 09 `setting.changed`) | 방해 금지, 주의 예산(14 `OrchestrationSettings`), 알림 |
| `expectation.revise` | (rulings §1이 10에 추가를 요구) | |
| `observerProposal.adopt` / `decline` / `snooze` | `policy.change.accept` / `policy.change.reject` / `policy.change.defer` | |
| `work.steer` | (12 RunInput `steer`. 사람 발화 관찰 `observation.record`(utterance)를 함께 남긴다) | |
| `work.pause` / `work.resume` | `workunit.pause` / `workunit.resume` | |
| `work.stop` / `work.abort` | `workunit.cancel` + 12 실행 신호(`stop`: 안전한 경계에서, `abort`: 즉시) | 12의 `run.cancel` 요구와 같음 |
| `work.requestBrief` | (12 런타임 요청. 커널 명령 없음) | |
| `thread.compact` | (12 컴팩션 요청 §3.6.2. 커널 명령 없음) | 12 §5.2 요구 |
| `composer.submit` | `observation.record`(utterance, 08 §5.2 (4)) + 12 RunInput | |
| `brief.acknowledge` | `brief.acknowledge` | `note`(check-back 한 줄, 04 요구)를 11 payload에 더하도록 요구 |
| `brief.correct` | (10에 요구) | |
| `recovery.resolve` | `toolcall.resolve_unknown`(결과 불명 도구 호출) / 12 `run.resume` 요청(중단된 run을 마지막 확인 지점부터) | 03 §3.2.3 세 동작 |
| `daemon.exitSafeMode` | `runtime.exit_safe_mode`(12) | |
| `surprise.report` | 16 측정 흐름(이벤트 09 `surprise.reported`) | |
| `resumptionCheck.answer` / `resumptionCheck.score` | 16 측정 흐름(`resumption_check.answered`·`scored`) | 판정 J-10 "복귀 점검" |
| `selfReport.submit` | 16 측정 흐름(`self_report.recorded`) | |

기기·관리:

| 메서드 | 종류 | scope | 커널 명령 | 절 |
|---|---|---|---|---|
| `device.list` | read | devices | - | §3.7.7 |
| `device.rename` / `device.revoke` / `device.expireTokens` | cmd | devices(`revoke`는 `devicesLimited`도) | 18 기기 명령(이벤트 09 `device.*`) | §3.7.7 |
| `device.rebind` | cmd | admin | 18(`device.bound_to_node` 다시 묶기, S-03) | §3.7.7 |
| `device.createPairingCode` | cmd | devices | 18(`pairing.code_created`) | §3.7.7 |
| `device.registerPush` / `device.unregisterPush` | cmd | devices, devicesLimited(자기 기기만) | 26·18이 정한다 | §3.17 |
| `connection.list` / `connection.close` | read / cmd | devices | - | §3.7.7 |
| `admin.issueDevice` / `admin.drain` / `admin.setMode` / `admin.safeMode` / `admin.backupNow` / `admin.verify` / `admin.maintain` / `admin.reloadConfig` / `admin.reloadSecrets` | adm | admin | 17·18 | §3.7.8 |

- 04가 쓴 `device.pair`는 메서드가 아니라 HTTP `POST /pair`다(토큰을 웹뷰에 보이지 않기 위해, 20 §3.8.7). `connection.test`는 앱 내부 동작이고 `GET /healthz`와 `ping`을 쓴다.
- 1판의 `device.rotateToken`(JSON-RPC 결과로 토큰을 돌려줌)은 뺐다. 토큰 교체는 HTTP `POST /devices/self/rotate`(2차 기능, 18 §3.8.3)로만 한다.
- 16이 요구한 `observer` 뷰는 04의 이름 `observerProposals`로, `view.record`는 `presence.report`로 받았다. 12가 쓴 `conversation.send`는 `composer.submit`으로, `run.stop`·`run.cancel`은 `work.stop`·`work.abort`로 받았다.
- 관찰 에이전트의 모델 호출과 제안 제출은 이 프로토콜이 아니라 16 §3.2.3 IPC로 한다(판정 §2). 12 §5.2가 요구한 "관찰 프로세스용 모델 호출 메서드"는 두지 않는다.

#### 3.7.2 공통 타입과 연결 메서드

```ts
export type IsoTime = string;
export type Seq = number;

/** 모든 cmd 메서드의 params에 들어가는 공통 필드 */
export interface CommandParamsBase {
  idempotencyKey: string;   // `ik_<ULID>`(20 APP-D09). 사용자 의도 하나에 하나. 재시도·재접속에도 같은 값
  basisSeq: Seq;            // 이 결정을 내린 화면이 본 뷰의 asOfSeq. 화면 밖 동작(단축키 등)은 그 시점의 클라이언트 위치
  expect?: Array<{ id: string; revisionSeq: Seq }>; // 08 RevisionRef. 특정 레코드의 판을 직접 지정할 때만(§3.9.3)
  clientTime?: IsoTime;     // 기록용(10 CommandEnvelope.issuedAt)
}

export interface CommandResult {
  status: "applied" | "accepted" | "gated";
  // applied : 커널이 받아들였고 결과 이벤트가 커밋됐다
  // accepted: 오래 걸리는 일을 접수했다. 결과는 이벤트로 온다(jobId·runId로 연결)
  // gated   : 커널이 자격 부족을 질문으로 바꿨다(10 needs_gate). 명령 자체는 적용되지 않았다
  commandId: string;        // 10의 `cm_<ULID>`(08 §3.2). 같은 멱등 키의 재시도는 처음 값
  duplicate: boolean;       // 이미 처리한 멱등 키라 저장된 결과를 돌려준다(09 CommitResult.replayed)
  headSeq: Seq;             // 응답 시점의 headSeq(09 §3.9.4)
  firstSeq: Seq | null;     // 이 명령이 커밋한 이벤트 seq 범위. 없으면 null
  lastSeq: Seq | null;
  events: Array<{ seq: Seq; id: string; type: string }>;
  created?: Record<string, string>;     // 새로 생긴 레코드. 예: { concernId: "cn_…" }
  notices?: Array<{ code: string; subject: string; message: string }>;  // 10 Notice
  jobId?: string;           // accepted일 때
  runId?: string;           // 실행을 시작·재개한 경우
  questionId?: string;      // gated일 때 생긴 질문
  impact?: CommandImpact;   // 선택·이의·결과 확인처럼 다른 레코드에 영향을 주는 명령(21 ChoiceImpactEcho)
}

/** 10 §3.13.3 impactOf와 파생 규칙(R-1·R-4·R-8 등)의 결과를 화면용으로 줄인 것. 데몬이 계산한다 */
export interface CommandImpact {
  changed: Array<{ text: string; records: RecordRef[] }>;   // 바뀐 합의·Concern 등. text는 05 문구 키로 만든 한국어 한 줄
  invalidated: RecordRef[];                                  // 다시 확인 대상(낡음 표시)이 된 레코드
  reviewTrigger: string | null;                              // 이 결정을 다시 볼 조건(사람이 읽는 문장)
  obligationsAdded: number;                                  // 생긴 반영 항목 수
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

- `after`와 `before`는 함께 쓰지 않는다(`-32602`). 둘 다 없으면 `before: headSeq + 1`과 같다. 데몬은 09 `readEvents({ afterSeq | beforeSeq, typePrefixes, goalId, concernId, ref, redact: true })`로 읽고 09의 `nextAfterSeq`를 `next.after`로 옮긴다.

```ts
// record.locate: 딥 링크·알림이 가리킨 레코드의 화면 경로 인자를 얻는다(20 §5.2 (8))
export interface RecordLocateParams { id: string }
export interface RecordLocation {
  ref: RecordRef;                 // 종류, 표시 번호, 제목
  goalId: string | null;
  concernId: string | null;
  workUnitId: string | null;
  questionId?: string;            // 그 레코드를 다루는 열린 질문이 있으면
  screen: string;                 // 03 화면 ID. 예: agreement → "SCR-AGREE"
  view: { view: ViewName; params: Record<string, unknown> };   // 그 화면을 그릴 view.get 인자
  status: "open" | "resolved" | "superseded";   // 04 §3.0.5 "이미 처리됨" 표시용
}
```

- 없는 ID는 `2005`. 대체된 레코드도 찾는다(`status: "superseded"`).

#### 3.7.4 뷰 카탈로그 (투영 조회) [제안]

뷰 이름과 파라미터는 04가 화면별 "표시 데이터"에 적은 후보를 받았다. 뷰 모델(`data`)의 타입은 04 해당 절이 소유하고, 정본에서 만드는 규칙은 12가 소유한다. 이 문서는 이름, 파라미터, 키, 기본 태그만 정한다.

| 뷰 | 화면(03 §3.6) | params | 키 | `dependsOn`에 늘 들어가는 집계 태그 | `data` 타입 |
|---|---|---|---|---|---|
| `home` | `SCR-HOME` | `{ goalId?: string }` | `home[:goalId]` | `@home` | 04 §3.1 |
| `brief` | `SCR-BRIEF` | `{ goalId?: string; sinceSeq?: Seq; untilSeq?: Seq }` (`sinceSeq` 기본: `brief.acknowledge`의 마지막 값. `untilSeq`를 주면 그 seq까지로 고정한 요약이다) | `brief[:goalId][@since..until]` | `@brief` (`untilSeq`가 있으면 집계 태그를 넣지 않는다) | 04 §3.2 |
| `inbox` | `SCR-INBOX` | `{ kinds?: QuestionScreenKind[]; concernId?: string; gate?: Gate }` | `inbox[?…]` | `@inbox` | 04 §3.3 |
| `question` | `SCR-QUESTION` | `{ questionId: string }` | `question:<id>` | - | 04 §3.4 |
| `autonomous` | `SCR-AUTO` | `{ since?: "ack" \| "all"; concernId?: string; contestedOnly?: boolean }` | `autonomous[?…]` | `@autonomous` | 04 §3.5 |
| `concernTree` | `SCR-CONCERNS` | `{ goalId?: string; status?: string[] }` | `concernTree[?…]` | `@concernTree` | 04 §3.6 |
| `concern` | `SCR-CONCERN-OVERVIEW` | `{ concernId: string }` | `concern:<id>` | - | 04 §3.7 |
| `inquiry` | `SCR-INQUIRY` | `{ concernId: string; kind: "fact" \| "want" \| "possibility" \| "outcome" }` | `inquiry:<id>:<kind>` | - | 04 §3.8. 15 §5.2의 요구 항목(앵커링 결과, 대비 정렬의 얻음·잃음 문장과 접힌 묶음, 질적 지지 등급, 렌즈 행, 같은 모델 계열 표시)을 담는다 |
| `stimulusRound` | `SCR-STIM` | `{ concernId: string; roundNo: number }` | `stimulusRound:<id>:<n>` | - | 04 §3.9. 이미지·긴 문서는 `BlobRef`만 싣는다(§3.11) |
| `work` | `SCR-WORK` | `{ concernId: string }` | `work:<id>` | - | 04 §3.10 |
| `agreement` | `SCR-AGREE` | `{ agreementId: string }` | `agreement:<id>` | - | 04 §3.11 |
| `review` | `SCR-REVIEW` | `{ resultId: string } \| { workUnitId: string }` (04의 `submissionId`는 결과 제출 레코드 `rs_`, 이름을 `resultId`로 맞춘다) | `review:<id>` | - | 04 §3.12 |
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
| `tray` | `SCR-TRAY` | `{}` | `tray` | `@tray` | `TrayView`(아래). 04 §3.24, 20 §5.2 (7) |
| `settings` | `SCR-SETTINGS` | `{ section?: "notifications" \| "attention" \| "display" \| "delivery" }` | `settings[:section]` | `@settings` | 04 §3.21. 데몬 쪽 설정(방해 금지, 주의 예산, 전달 기본값)만. 앱 지역 설정(테마, 글자 크기)은 20이 앱에 둔다 |
| `metrics` | `SCR-METRICS`(03) | `{ metricIds?: string[]; window?: "7d" \| "14d" \| "28d" }`(16, 판정 J-78) | `metrics[?…]` | `@metrics` | 16 §3.24(지표 값·스냅샷·근거 seq). 16은 5분 캐시를 둔다. `asOfSeq`는 캐시를 만든 시점 |
| `evaluation` | 2주 평가 보고 | `{ reportId?: string }` | `evaluation[:id]` | `@metrics` | 16(평가 보고) |

```ts
/** tray 뷰 데이터. 트레이는 질문 내용을 보이지 않는다(04 §3.24) */
export interface TrayView {
  rightsPending: number;          // "선택 필요": 전달된 권리 게이트 질문 수(배지)
  infoPending: number;            // "확인하면 좋은 것"
  running: Array<{ concern: RecordRef; workUnit: RecordRef; nowDoing: string }>;   // 최대 5. 이동할 Concern ID 포함
  dnd: { on: boolean; until: IsoTime | null };   // 방해 금지와 끝 시각
}
```

- 뷰 키는 `view.get` 응답의 `key`가 정본이다. 클라이언트가 직접 만들지 않는다(파라미터 정규화 규칙을 서버 한 곳에 둔다).
- 모든 뷰의 `data` 안 레코드 참조(`RecordRef`)에는 `revisionSeq`(08 `RecordMeta.revisionSeq`)를 넣는다(04·12에 대한 요구).
- 레코드 필드의 타입은 `@helm/domain`(08)에서 가져다 쓴다. 프로토콜이 레코드 스키마를 다시 정의하지 않는다(08 §5.2). 뷰 모델은 레코드를 화면용으로 줄인 것이므로 04가 정의하되, 레코드 필드를 그대로 싣는 곳은 08 타입을 쓴다. 시각은 ISO로 바꾼다.
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
  // 11 §3.18 QuestionDeferPayload.until로 바꾼다: nextWorkBoundary → next_work_boundary, nextBrief → user_return
  until: { boundary: "nextWorkBoundary" | "nextBrief" } | { at: IsoTime } | { condition: string };
}
export type QuestionEscalateParams = QuestionIdParams;   // "지금 보기"

// ── 이의 (05 §3.3, 04 §3.26) ──────────────────────────────────
export interface ContestFileParams extends CommandParamsBase {
  target: ContestTarget;
  reason?: string;          // 선택 입력(판정 J-20)
  noReason?: boolean;       // "이유는 말로 못 하겠음"(결정 18의 이유 없는 반응과 같은 취지)
  desiredEffect: "reopen" | "ask_next_time" | "note_only";
}
// 08 ObjectionTarget 형식을 그대로 쓴다(판정 J-36). 10 DecisionContestPayload와 08 ObjectionCore로 그대로 옮긴다
export type ContestTarget =
  | { kind: "record"; id: string; itemKey: string | null }   // 08 ContestableId. itemKey: "criterion:<cr>"(결과 제출의 기준별 판정), "evidence:<ob>" 등
  | { kind: "link"; from: string; to: string; rel: string };  // 근거 관계 하나(08 LinkRel)

export interface DecisionConfirmParams extends CommandParamsBase { targets: string[] }     // 혼자 정한 결정 확인
export interface ObjectionDecideParams extends CommandParamsBase { objectionId: string; note?: string }   // withdraw / dismiss
export interface ChoiceCommitParams extends CommandParamsBase { choiceId?: string; core: Record<string, unknown>; viaQuestion?: string } // core는 10 ChoiceCommitPayload(08 Core). choiceId가 없으면 서버가 만든다
export interface ChoiceRevokeParams extends CommandParamsBase { choiceId: string; reason: string }
export interface FindingDecideParams extends CommandParamsBase { findingId: string; reason?: string }          // confirm / withdraw
export interface CriterionDecideParams extends CommandParamsBase { preferenceModelId: string; possibilityId: string; criterionKey: string; weight?: "low" | "medium" | "high"; reason?: string }

export interface AutonomousMarkSeenParams extends CommandParamsBase {
  upToSeq: Seq;             // 이 seq까지의 에이전트가 정한 것을 봤음
  concernId?: string;       // 거른 화면에서 누른 경우
}

// ── 원함 탐구 반응 (15, 04 §3.9) ───────────────────────────────
export interface ReactionRecordParams extends CommandParamsBase {
  stimulusId: string;
  roundNo: number;
  kind: "strength" | "no_reason" | "rewrite" | "near" | "triad_odd" | "comparison" | "comment";
  subjectId?: string;               // 반응 대상이 자극이 아니라 가능성(`ps_`)일 때(15 §3.4.11). 있으면 stimulusId 대신 쓴다
  comparison?: { otherStimulusId: string; preferred: "this" | "other" | "neither"; reason?: string };   // 두 자극의 비교(15 §3.6.4)
  strength?: -2 | -1 | 0 | 1 | 2;   // 아주 싫음 ~ 아주 좋음(1~5 키를 -2~2로)
  rewrite?: string;                  // "이것과 비슷한데 더 ~하게"
  triad?: { stimulusIds: [string, string, string]; oddId: string; reason?: string; cannotSay?: boolean };
  target?: { element?: string } | { region?: { x: number; y: number; w: number; h: number } };  // 이미지 영역은 0~1 비율
  reason?: string;
}
export interface ReactionAmendParams extends CommandParamsBase { reactionId: string; reason: string }
export interface ReactionWithdrawParams extends CommandParamsBase { reactionId: string; note?: string }
export interface StimulusRoundCloseParams extends CommandParamsBase { concernId: string; roundNo: number }
export interface PossibilityPinParams extends CommandParamsBase { possibilityId: string; pinned: boolean }          // 15
export interface PossibilityDismissParams extends CommandParamsBase { possibilityId: string; reason?: string }       // 15

// ── 작업 합의 C (11·04 §3.11) ──────────────────────────────────
export interface AgreementConfirmParams extends CommandParamsBase { agreementId: string; exclude?: string[] }
export interface AgreementReviseParams extends CommandParamsBase { agreementId: string; edits: string | Array<{ item: string; text: string }> }
export interface AgreementNarrowParams extends CommandParamsBase { agreementId: string; note: string }
export interface AgreementDeclineParams extends CommandParamsBase { agreementId: string; note?: string }
export interface AgreementCorrectUnderstandingParams extends CommandParamsBase { agreementId: string; part: string; note: string }
export interface AgreementReleaseParams extends CommandParamsBase { agreementId: string; reason: string }
export interface GrantIssueParams extends CommandParamsBase { grantId?: string; core: Record<string, unknown> }      // 08 GrantCore
export interface GrantRevokeParams extends CommandParamsBase { grantId: string; reason: string }

// ── 결과 확인 A (04 §3.12) ─────────────────────────────────────
export interface ResultAcceptParams extends CommandParamsBase { resultId: string; note?: string }
export interface ResultAcceptWithConditionsParams extends CommandParamsBase { resultId: string; conditions: string[] }
export interface ResultRequestRevisionParams extends CommandParamsBase { resultId: string; criteria: string[]; note: string }
export interface ResultReopenParams extends CommandParamsBase { resultId: string; to: "inquiry" | "commit"; reason: "criteria_wrong" | "rejected"; note: string }
// resultId는 결과 제출 레코드 ID(08 `rs_`)다. 10 ResultAcceptPayload의 core로 옮긴다
export interface ObligationConfirmDoneParams extends CommandParamsBase { obligationId: string; note?: string }
export interface ObligationDeferParams extends CommandParamsBase { obligationId: string; until: IsoTime | { condition: string }; reason: string }
export interface ObligationTransferParams extends CommandParamsBase { obligationId: string; toConcernId: string }
export interface ObligationWaiveParams extends CommandParamsBase { obligationId: string; reason: string }
export interface ObligationReopenParams extends CommandParamsBase { obligationId: string; reason?: string }

// ── Goal (04 §3.16) ────────────────────────────────────────────
export interface GoalReviseParams extends CommandParamsBase { goalId: string; field: "statement" | "successCriteria" | "constraints"; value: string }
export interface GoalConfirmRevisionParams extends CommandParamsBase { goalId: string; revisionQuestionId?: string; edits?: string }
export interface GoalRejectRevisionParams extends CommandParamsBase { goalId: string; revisionQuestionId?: string; note?: string }
export interface GoalConfirmAchievedParams extends CommandParamsBase { goalId: string }
export interface GoalRejectAchievedParams extends CommandParamsBase { goalId: string; note?: string }
export interface GoalProposeParams extends CommandParamsBase { goalId?: string; core: Record<string, unknown>; activateNow?: boolean }   // 08 GoalCore
export interface GoalStateParams extends CommandParamsBase { goalId: string; reason: string }                           // pause / resume / retire

// ── Concern·루프·구조 (04 §3.6·§3.7) ────────────────────────────
export interface ConcernProposeParams extends CommandParamsBase { utterance: string; goalId?: string; parentId?: string }
export interface ConcernReviseParams extends CommandParamsBase { concernId: string; field: "title" | "description"; value: string }
export interface ConcernHoldParams extends CommandParamsBase { concernId: string; until?: IsoTime }
export interface ConcernResumeParams extends CommandParamsBase { concernId: string }
export interface ConcernCloseParams extends CommandParamsBase { concernId: string; result: "completed" | "not_completed"; reason: string; force?: boolean }
export interface ConcernReopenParams extends CommandParamsBase { concernId: string; toLoop?: LoopId; reason: string }
export interface LoopPlanReviseParams extends CommandParamsBase { concernId: string; plan: Record<string, unknown> }   // 08 LoopPlanCore
export interface LoopRequestTransitionParams extends CommandParamsBase { concernId: string; to: LoopId; reason?: string }  // LoopId는 14 §3
export interface StructureRequestParams extends CommandParamsBase { concernId: string; op: "split" | "merge"; note: string; withConcernId?: string }

// ── 탐구 (15, 04 §3.8) ─────────────────────────────────────────
export interface InquiryRequestFrameParams extends CommandParamsBase { concernId: string; op: "add" | "merge"; note: string }
export interface InquiryProposeCandidateParams extends CommandParamsBase { concernId: string; text: string }
export interface InquiryMarkAssumptionParams extends CommandParamsBase { concernId: string; refOrText: string }
export interface InquiryPinCheckParams extends CommandParamsBase { concernId: string; checkId: string }
export interface InquiryRequestDecisionParams extends CommandParamsBase { concernId: string }
export interface InquiryStopParams extends CommandParamsBase { concernId: string; handOff: boolean }
export interface InquiryFillCellParams extends CommandParamsBase { concernId: string; cellId: string; note?: string }      // 15 발산 표 빈 칸 채우기 요청
export interface InquiryPinLensParams extends CommandParamsBase { concernId: string; lensId: string; pinned: boolean }    // 15
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
export interface ThreadCompactParams extends CommandParamsBase { threadId: string }   // 12 §3.6.2 "사람이 요청"

// ── 대화 입력 (04 §3.14) ────────────────────────────────────────
export interface ComposerSubmitParams extends CommandParamsBase {
  scope: { concernId: string } | { global: true };    // global: 홈의 입력창(새 Goal·Concern 초안 요청 등)
  text: string;                                       // 최대 32 KiB
  attachments?: BlobRef[];                            // 먼저 업로드한 파일(§3.11)
  whenBusy?: "followUp" | "steer";                    // 실행 중일 때. 기본 followUp
  utteranceDraftId?: string;                          // composer.preview를 거쳤으면 그 ID
  choice?: { interpretationId: string } | { asChat: true };   // 미리보기에서 고른 해석(21 SemanticPreviewChoice)
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

// ── 실험 측정 (16) ──────────────────────────────────────────────
// payload 정본은 16(§3.27 측정 흐름). 이름은 판정 J-10("복귀 점검")을 따른다
export interface SurpriseReportParams extends CommandParamsBase { subjectId: string; subjectKind: string; note?: string }
export interface ResumptionCheckAnswerParams extends CommandParamsBase { checkId: string; answer: string | Record<string, unknown> }
export interface ResumptionCheckScoreParams extends CommandParamsBase { checkId: string; score: number; note?: string }
export interface SelfReportSubmitParams extends CommandParamsBase { instrument: string; item: string; score: number | string }

// ── 안전 모드 해제 (12 §3.7.6, 17 §3.4.6) ───────────────────────
export interface DaemonExitSafeModeParams extends CommandParamsBase { reason?: string }

// ── 복귀 요약·복구 ──────────────────────────────────────────────
export interface BriefAcknowledgeParams extends CommandParamsBase {
  upToSeq: Seq;              // 사람 단위 마지막 확인 위치
  projectId?: string;        // 11 BriefAcknowledgePayload.projectId
  note?: string;             // check-back 한 줄(04 요구 (3)). 11 payload에 더하도록 요구
}
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
  platform: "macos" | "windows" | "linux" | "ios" | "android";
  clientKind: "desktop" | "mobile" | "tui" | "cli";
  pairedAt: IsoTime;
  pairedVia: "code" | "ssh";
  lastSeenAt: IsoTime | null;
  lastListener: ListenerKind | null;
  tokenId: string;                  // sha256(토큰) 앞 12자(18 §3.8.1). 토큰 원문은 어디에도 없다
  tokenExpiresAt: IsoTime;          // 절대 365일(18 §3.8.2)
  idleExpiresAt: IsoTime;           // 마지막 인증 + 90일
  expiringSoon: boolean;            // 만료 30일 전부터 true
  revokedAt: IsoTime | null;
  push: { channel: string; registeredAt: IsoTime } | null;   // §3.17
  scopes: Scope[];
  current: boolean;                 // 이 요청을 보낸 기기
}

// device.list (scope devices)
export interface DeviceListResult { devices: DeviceInfo[] }

// device.rename / device.revoke / device.expireTokens (cmd)
export interface DeviceRenameParams extends CommandParamsBase { deviceId: string; name: string }
export interface DeviceRevokeParams extends CommandParamsBase { deviceId: string; reason?: string }   // 자기 자신도 된다(응답 뒤 4009)
export interface DeviceExpireTokensParams extends CommandParamsBase { deviceId: string }              // 다음 접속부터 다시 페어링(18 §3.8.3)
export interface DeviceRebindParams extends CommandParamsBase { deviceId: string }                    // tailnet 노드 묶기를 풀어 다음 WSS 접속 때 다시 묶음(18 S-03, 로컬 관리자만)

// device.createPairingCode: 이미 페어링된 기기(또는 관리 CLI `helm pair`)가 새 기기용 코드를 만든다(18 §3.7 흐름 A)
export interface DeviceCreatePairingCodeParams extends CommandParamsBase { name?: string; ttlSec?: number }  // 기본 600, 최대 3,600
export interface DeviceCreatePairingCodeResult extends CommandResult {
  code: string;                     // Crockford base32 12자(60비트), 표시 "XXXX-XXXX-XXXX"(18 §3.7.2)
  expiresAt: IsoTime;
  link: string;                     // helm://pair?v=1&url=<baseUrl>&code=<코드>&sid=<serverId> (20 §3.8.7)
}

// connection.list / connection.close
export interface ConnectionInfo {
  connectionId: string; deviceId: string | null; listener: ListenerKind; client: ClientInfo;
  openedAt: IsoTime; protocol: number; subscriptions: number; presence?: PresenceState;
}
export interface ConnectionListResult { connections: ConnectionInfo[] }
export interface ConnectionCloseParams extends CommandParamsBase { connectionId: string }
```

페어링 HTTP(흐름 A, `tailnet` 리스너만, 18 §3.7):

```http
POST /pair HTTP/1.1
Content-Type: application/json

{"code":"K7Q4-XM92-PH3D","device":{"name":"MacBook Air","platform":"macos","clientKind":"desktop","publicKey":"<선택, 18 §3.8.5>"}}
```

- 성공: `200 {"serverId":"…","deviceId":"dv_…","deviceToken":"helm_dt_…","tokenExpiresAt":"…"}`(20 §5.2 (6)의 이름). 토큰은 이 응답에만 한 번 실린다. `Cache-Control: no-store`. 데스크톱은 Rust가 받아 키체인에 바로 넣는다.
- 실패: `400` + 본문 `{"error": JsonRpcError}`(`1009 pairing.invalidCode`, 사유 구분 없음), `429` + `1011`. 본문은 4 KiB 이하(18 §3.14). 코드 정규화(대문자, `-`·공백 제거, `O→0`, `I/L→1`)는 서버가 한다.
- 흐름 B(SSH 발급): `ssh <서버> helm device issue --json --name … --platform … --client …`. 관리 CLI가 `local` 리스너에 `localAdmin`으로 붙어 `admin.issueDevice`를 부르고 표준 출력에 `HELM-DEVICE/1 {"serverId":…,"deviceId":…,"deviceToken":…}` 한 줄을 쓴다(18 §3.7.3, 20 §3.8.7).

토큰 교체(2차 기능, 18 §3.8.3):

```http
POST /devices/self/rotate HTTP/1.1
Authorization: Bearer <현재 토큰>
```

- `tailnet`·`loopback` 리스너. 성공: `200 {"deviceToken":"helm_dt_…","tokenId":"…","tokenExpiresAt":"…"}`, `no-store`. 이전 토큰은 5분 또는 새 토큰의 첫 사용 중 먼저 오는 때까지 함께 받는다. 데스크톱은 Rust 명령 `credential_rotate`가 부른다. 1차에서는 쓰지 않고 만료가 가까우면 다시 페어링한다.

#### 3.7.8 상태·진단·관리·presence

```ts
// daemon.status: 17 OpsStatus(17 §3.11.1)를 줄여 만든다. 원격 기기에 내보내지 않는 것(PID, 경로, 모델 키 상태 세부)은 뺀다
export interface DaemonStatus {
  server: HelloResult["server"];   // version(semver), bootEpoch, startedAt, mode, safeModeReason
  release: { releaseId: string; protocol: number };
  uptimeSec: number;
  health: "ok" | "degraded" | "critical";
  readOnlyReasons: Array<"disk_critical" | "integrity_suspect" | "operator">;
  safeMode: { since: IsoTime; reason: "crash_loop" | "operator"; uncleanBoots: number } | null;
  log: { storeId: string; headSeq: Seq; sizeBytes: number; lastBackupAt: IsoTime | null; lastBackupVerified: boolean };
  disk: { freeBytes: number; warnBytes: number; criticalBytes: number };   // 04 요구 (7). 17 resources.diskFreeBytes, diskWarnBytes(5 GiB), diskCriticalBytes(1 GiB)
  runtime: { activeRuns: number; waitingHuman: number; nextScheduledAt: IsoTime | null };
  tools: { sandboxLevel: "S1" | "S1b" | "S0" | "none" };                    // 13 §3.6.1. none이면 실행 도구가 꺼져 있다
  observer: { lastRunAt: IsoTime | null; lastResult: "ok" | "failed" | null };
  connections: number;
  recoveryItems: number;          // 복구 판단이 필요한 항목 수(SCR-RECOVERY 배지)
  warnings: Array<{ key: string; args?: Record<string, string> }>;   // key는 17 점검 ID(§3.11.2). 문구는 05
}

// presence.report: 클라이언트 → 서버 알림(응답 없음). 활동 상태와 보고 있는 화면. 휘발 정보로 받는다
export type PresenceState = "active" | "idle" | "hidden" | "locked";
export interface PresenceReportParams {
  state: PresenceState;
  screen?: string;                // 03 화면 ID. 예: "SCR-INBOX"
  objectId?: string;              // 보고 있는 레코드
  depth?: "glance" | "review" | "audit";   // 03 §3.10 세 깊이. 감사 깊이 열람 기록용(20 §5.2 (6)). 16 §3.23.1의 `screen` "#audit" 접미 대신 이 필드를 쓴다(§5.2 16 행)
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
export interface AdminMaintainParams extends CommandParamsBase { ifRunning?: boolean }   // 정기 유지 작업(17 §3.9.7). accepted + jobId
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

- 프로토콜에는 OS 알림용 별도 알림 메시지가 없다. 앱의 OS 알림은 11의 전달 결정이 기록된 영속 이벤트 `question.delivered`(09 §3.4.9, 행위자 runtime)를 받았을 때만 띄운다(20 APP-D11, canon-3 §10/19 "알림 이벤트는 질문 전달 방식의 결과로만"). 그 밖의 이벤트로 알림을 띄우지 않는다.
- `question.delivered` payload(09 §3.4.15, 11 §3.5.6): 대상 질문은 envelope `subject`, `deliveryId`(앱 중복 알림 방지), `channel`(`app` \| `push` \| `tui` \| `brief`), `batchKey`, `urgency`, `surface`(`os` \| `badge` \| `banner`), `category`, `copy`(05 문구 키와 인자. 질문 본문은 넣지 않는다), `target`(딥 링크 `helm://question/<qs_id>`), `expiresAt`, `targetDevices`(`all` 또는 기기 목록). 앱은 자기 `deviceId`가 대상일 때만 OS 알림을 띄운다. 값의 뜻(판정 J-52): `urgency`는 11의 `interrupt`·`notice`·`digest`, `channel`은 전달 경로(어디로 보냈나), `surface`는 표시 방식 배열(OS 알림·배지·배너), 문구는 키만 싣는다(J-31).
- 재전송으로 받은 전달 이벤트(`caughtUp` 전 알림에 들어 있던 것)는 하나씩 OS 알림으로 띄우지 않고 "접속하지 않은 동안 전달된 질문 n개"로 한 번 묶어 보인다(20).
- 알림 철회 계약(04 요구 (8)): 앱은 띄운 OS 알림을 `questionId`로 기억하고, 그 질문의 `question.answered`·`question.assumed`·`question.withdrawn`·`question.expired` 이벤트를 받으면(다른 기기에서 답한 경우 포함) 그 알림을 OS 알림 센터에서 지운다. 재전송 중에 받은 경우도 지운다. 모바일 푸시의 철회는 §3.17.
- 알림 내용 노출(판정 J-03): 기본은 내용을 숨긴다. `copy`는 종류와 개수만 담은 문구 키(예: "선택 필요 1")를 쓰고, 질문 제목을 보이려면 사람이 설정(`settings.update`, 섹션 `notifications`)으로 켠다. 켜면 데몬이 `copy.args`에 질문 제목을 넣는다. 비밀 규칙(18 §3.10.3)은 그대로 적용된다.

### 3.9 멱등성

#### 3.9.1 멱등 키 [제안]

- 형식: `ik_<ULID>`(20 APP-D09). 사용자 의도 하나(버튼 한 번, 보내기 한 번)에 하나를 만든다. 같은 의도를 다시 보낼 때(응답 유실, 재접속, 시간 초과)는 같은 키와 같은 params를 보낸다. 다른 의도에 키를 다시 쓰지 않는다.
- 클라이언트는 명령을 보내기 전에 진행 중 명령함(20: IndexedDB, TUI: 파일)에 `{key, method, params, createdAt}`를 먼저 저장한다. 응답(성공이든 커널 거부든)을 받으면 지운다. 연결 오류·시간 초과면 남겨 두고 재접속 뒤 같은 키로 다시 보낸다.
- 진행 중 명령함의 항목이 `pendingCommandMaxAgeMs`(기본 24시간)보다 오래되면 자동으로 다시 보내지 않고 사용자에게 보인다(OpenClaw iOS 송신함의 만료 규칙, S4 openclaw-gateway §3.3). 이 값은 서버 보관 기간(`idempotencyWindowMs`, 7일)보다 짧으므로 자동 재전송이 보관 기간을 넘는 일은 없다.

#### 3.9.2 서버 처리

```text
on 명령 메서드 요청(params):
  1. params 스키마 검사(-32602), scope 검사(1010), 명령 속도(1011), 데몬 모드 검사(readOnly → 5003, draining → 5001)
  2. 메서드 → 10 CommandEnvelope 만들기(§3.7.1 대응표):
       type, payload(메서드 params에서 idempotencyKey·basisSeq·expect·clientTime을 뺀 것을 10 payload로 바꿈),
       channel "human_client", actor { kind: "human", deviceId }, via(08: device | local_cli, listener, connectionId),
       idempotencyKey, basisSeq, expect, issuedAt = clientTime, provenance.adapterId = "client:<client.kind>"
  3. result ← engine.submit(envelope)            // 06 engine → 09 HelmStore.commit(CommitInput) 안에서 커널 decide
       09가 범위 키 channel|actor|via|key와 지문 sha256(type, actor, via, payload)으로 멱등을 처리한다(09 §3.9.1)
       - 같은 키·같은 지문: 저장된 결과(replayed) → duplicate: true
       - 같은 키·다른 지문: conflict.idempotency_key_reuse → 3006(저장하지 않음)
  4. result → CommandResult 또는 오류(§3.3.4 대응)
  5. 커밋이 있었으면 §3.5.9 순서대로 이벤트 알림을 큐에 넣은 뒤 응답을 큐에 넣는다
```

- 멱등 범위와 지문은 09가 계산한다(09 §3.9.1). 프로토콜은 따로 계산하지 않는다. 지문에 `commandId`·`expect`·`basisSeq`가 들어가지 않으므로, 재접속 뒤 화면이 새로 그려져 `basisSeq`가 달라져도 같은 키·같은 내용이면 같은 명령으로 본다.
- 같은 키가 지금 처리 중이면(재접속 직후 이전 연결의 요청이 아직 커밋 전): 데몬의 커밋은 이벤트 루프 한 턴 안에서 동기로 끝나므로(09 §3.8.4) 두 요청이 겹치는 일은 처리기 대기열 앞단에서만 생긴다. 뒤의 요청은 앞의 결과를 기다려 `duplicate: true`로 받는다. 10초를 넘으면 `3007 command.inProgress`(`retryAfterMs` 1000).
- 저장되는 결과(09 §3.9.2): `accepted`, `needs_gate`, 커널 거부(내용·자격·경로), `conflict`(버전 불일치, 이미 해결됨, 대체됨). 같은 키로 다시 보내면 같은 거부가 다시 온다. 상황이 바뀐 뒤 다시 시도하려면 새 키가 필요하다(사람이 "다시 시도"를 누르면 앱이 새 키를 만든다, 20 §3.9.7).
- 저장되지 않는 결과: 1단계에서 끝난 오류, `3006`, `5002`, `5004`(커밋 전 취소), 커널 내부 오류(`error`), 일시 실패(쓰기 소유권 상실, SQLite 바쁨, 디스크 가득 참, 종료 중). 같은 키로 다시 보내도 된다(`retryable`을 보고 판단).
- 보관 기간은 최소 `idempotencyWindowMs`(7일)이다. 09의 `commands` 테이블에 있으므로 데몬 재시작 뒤에도 유지된다(09는 지우지 않는다).
- JSON-RPC 요청 `id`는 연결 안의 응답 짝짓기용일 뿐이다. 멱등 키로 쓰지 않는다(happy-agent의 `mutationId`처럼 반향용 값과 멱등 키를 섞은 혼동을 피한다, happy-agent 조사 §9 피할 것 5).

#### 3.9.3 `basisSeq`와 낡음 검사

- 클라이언트는 모든 명령에 `basisSeq`(그 결정을 내린 화면 뷰의 `asOfSeq`)를 싣는다. 프로토콜 계층은 이 값을 명령 envelope에 그대로 넣는다.
- 비교는 커널이 decide 안에서 한다(10 V-VER-01, 09 §3.9.4): 10 명령 스펙의 `subjects()`가 돌려준 각 대상 레코드의 `revisionSeq`(08 `RecordMeta.revisionSeq`, 사람 판단에 영향을 주는 변경에서만 오른다)가 `basisSeq`보다 크면 충돌이다. 커널이 대상 상태를 보고 `conflict.version_mismatch`(3004), `conflict.already_resolved`(3008), `conflict.superseded`(3009)를 나누고 `rebase`에 현재 요약을 넣는다.
- `expect`(`{id, revisionSeq}[]`)는 화면이 특정 레코드의 판을 직접 아는 경우에만 싣는다. 있으면 커널은 그 레코드에 대해 `expect`를 쓰고, 나머지 대상은 `basisSeq`로 본다.
- 10 §3.3.4는 "19가 `basisSeq`로 `expect`를 만든다"고 적었으나, 09 §3.9.4와 이 문서는 비교를 커널 안에서 하는 쪽을 택한다. 프로토콜 계층이 따로 계산하면 같은 판정이 두 곳에 생기고, 세 갈래 충돌 코드를 프로토콜이 구분할 수 없다. 10에 `CommandEnvelope.basisSeq`를 더해 달라고 요구한다(§5.2, §7 Q-14).
- `revisionSeq`는 전달 기록·표시 번호·근거 링크 추가 같은 운영성 변경에서 오르지 않는다(08 D08-12, 09 `bumpsRevision`). 그래서 사람이 질문에 답하는 사이 에이전트가 근거를 붙여도 답이 충돌로 막히지 않는다.

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
| `connecting` | 전송 실패 `blocked`(SSH 호스트 키 불일치·SSH 인증 실패·키체인 거부 등) | - | `needsUser` | 판정 J-62. 자동 재시도 중단 |
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
| `backoff` | 대기 끝, 또는 `retryNow()`(네트워크 복구·OS 깨어남·창 포커스, 20) | `retryAfterMs` 하한 지남 | `connecting` | |
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

- 자동 재접속을 멈추는 경우: 전송 실패 `blocked`, HTTP 401·403, `protocol.unsupported`, `auth.failed`, `auth.revoked`, `auth.unknownDevice`, `auth.methodNotAllowed`, `pairing.invalidCode`, `serverId` 불일치. 사람이 고쳐야 풀리는 실패다(OpenClaw `reconnect-policy.ts`의 인증 오류 목록과 같은 생각, S4 openclaw-gateway §1.5).
- 그 밖의 실패는 포기하지 않는다. 30초 간격으로 계속 시도하고, 화면은 "연결 안 됨"을 보인다(04 §3.0.4).
- 경로 바꾸기(WSS ↔ SSH)는 네트워크 계열 실패에서만 하고, 연결된 동안에는 바꾸지 않는다(20 APP-D05). 경로를 바꿔도 위치·진행 중 명령함은 같은 `serverId` 아래에서 그대로 쓴다. 두 경로의 의미가 같기 때문이다(결정 38).

### 3.11 파일과 큰 데이터 [결정 31, 세부 제안]

#### 3.11.1 원칙과 한도

- WebSocket 메시지에 파일 바이트(base64 포함)를 싣지 않는다. 이벤트와 뷰에는 `BlobRef`만 싣는다(pi-web의 media id 참조, OpenClaw가 base64 첨부로 프레임 한도를 넘긴 문제, pi-cases-notes §12.1-8).
- 파일은 내용 주소(SHA-256)로 저장한다. 저장 방식·업로드 대기·보존은 09 §3.12, 데이터 디렉터리는 17.
- 불변 보장(20 §5.2 (4)): `blobId`가 한 번 정해지면 그 내용은 바뀌지 않는다. 같은 내용은 같은 `blobId`다(09 §3.12 "같은 내용이면 같은 id"). 그래서 클라이언트는 `blobId`를 키로 영구 캐시해도 된다. 내용이 지워진 경우(보존 정책 가지치기, 비밀 가림)에도 다른 내용으로 바뀌지 않고 `410 Gone`이 된다.

```ts
/** 08 §3.4.7 BlobRef와 같은 필드 이름이다(프로토콜 쪽 변환 없음). 프로토콜은 표시용 필드를 더한다 */
export interface BlobRef {
  blobId: string;            // `bl_<ULID>`(08 §3.2). 패턴 ^bl_[0-9A-HJKMNP-TV-Z]{26}$
  hash: string;              // "sha256:<소문자 hex 64자>"(09 §3.12 주소)
  bytes: number;
  mediaType: string;         // 서버가 업로드 때 확인한 값
  preview?: string;          // 앞부분 미리보기(500자 이하, 08)
  // 아래는 프로토콜이 더하는 표시용 필드(뷰 데이터에서만, 이벤트 payload에는 없다)
  name?: string;             // 원래 파일 이름
  image?: { width: number; height: number };
  variants?: {              // 이미지의 표시용 판(21 E11 요구). 원본과 별도 blob
    thumb?: BlobVariant;     // 긴 변 512px
    display?: BlobVariant;   // 긴 변 1,600px
  };
}
export interface BlobVariant { blobId: string; bytes: number; width: number; height: number; mediaType: string }
```

| 한도 | 기본값 | 근거 |
|---|---|---|
| 파일 하나 | 64 MiB(`policy.files.maxBlobBytes`) | 이미지 자극, 문서 초안, 첨부. 18 상한 256 MiB 안 |
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
- 응답: `200` 또는 `206`, `Accept-Ranges: bytes`, `Content-Range`, `Content-Length`, `ETag: "sha256:<hex>"`(원래 바이트의 해시. 클라이언트는 받은 바이트로 다시 계산해 맞을 때만 캐시에 쓴다, 20 §3.8.6), `Repr-Digest: sha-256=:<base64>:`(RFC 9530 [지식]), `Content-Type: <저장된 mediaType>`, `Cache-Control: private, max-age=31536000, immutable`(불변 보장). `If-None-Match`·`If-Range`를 지원한다. 활성 콘텐츠(`text/html`, `image/svg+xml` 등)는 `Content-Disposition: attachment`와 `Content-Security-Policy: sandbox`를 붙인다. 범위가 틀리면 `416`, 없으면 `404`, 가지치기·가림으로 내용이 없으면 `410`(본문 `{"error": {..., "data": {"kind": "blob.gone", "details": {"reason": "pruned" | "redacted"}}}}`), 토큰·티켓이 틀리거나 만료면 `401`.
- 이미지 판은 `BlobRef.variants`의 `blobId`로 받거나, 원본 `blobId`에 `?variant=thumb|display`를 붙여 받는다(21 E11 요구 (3)). 판이 아직 없으면 원본을 돌려주고 `X-Helm-Variant: original`을 붙인다.
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

→ `201 {"blob": BlobRef, "stagedUntil": "…"}`. 해시가 다르면 `422` + 오류 `4005`, 크기 초과면 `413` + `4001`. 데몬은 09 `stageUpload(uploadId, mediaType)`로 `blobs/staged/<uploadId>`에 쓴다(09 §3.12).

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
- 클라이언트 코어는 별도 패키지 `@helm/client`다(판정 §2). `@helm/client` → `@helm/protocol` 방향으로만 의존하고 데스크톱·모바일·TUI가 함께 쓴다. 진입점(06 §5.2 요구 (1)):
  - `@helm/protocol`: `"."`(스키마·타입·오류·등록 표, 브라우저 안전), `"./testing"`(가짜 데몬·가짜 클라이언트·적합성 스위트, 브라우저 안전. Node 서버 띄우기는 `@helm/protocol/testing/node`).
  - `@helm/client`: `"."`(`HelmClient`, 브라우저 안전, 전송 구현 없음), `"./node"`(`NodeWsTransport`: TCP와 `ws+unix`. 런타임 의존 `ws`는 이 진입점만 쓴다, 06 R6), `"./browser"`(브라우저 `WebSocket` 전송. 모바일·시험용, `helm-bearer.` 하위 프로토콜로 토큰을 보낸다).
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
export type ReadMethodName = Extract<Specs, { kind: "read" | "ctl" }>["name"];
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

데스크톱 앱(웹뷰 TS), 모바일 클라이언트(26), TUI(Node)가 같은 코어 `@helm/client`의 `HelmClient`를 쓴다(판정 §2, 20 §3.9.4). 코어는 화면 프레임워크를 모른다. 코어가 맡는 것은 연결 상태 기계(§3.10.2)와 백오프(§3.10.3), `hello`, 구독 복원, 뷰 무효화 판정, 휘발 스트림, 진행 중 명령 재전송이다. 경로 선택(WSS·SSH 순서)은 `transportFactory`가 만드는 전송이 하고(20 `MultiRouteTransport`), React 연결(TanStack Query)은 20이, pi-tui 연결은 TUI 설계가 한다.

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
  | { kind: "network" }                                   // DNS·TCP 실패, 연결 시간 초과
  | { kind: "httpStatus"; status: number }                // 401·403은 인증 계열(needsUser), 421·429·5xx는 백오프
  | { kind: "daemonUnreachable" }                         // serve 502·503·504, SSH 포워딩 대상 거부
  | { kind: "blocked"; reason: string }                   // 사람이 고쳐야 풀린다: SSH 호스트 키 불일치·SSH 인증 실패·키체인 거부 등(판정 J-62, 20 §3.8.8). 자동 재시도 중단
  | { kind: "other"; detail?: string };

export interface ClientStateStorage {           // 데스크톱: IndexedDB(20 §3.9.5), TUI: 파일, 모바일: 26
  loadPosition(serverId: string, subKey: string): Promise<StreamPosition | null>;
  savePosition(serverId: string, subKey: string, pos: StreamPosition): Promise<void>;
  /** 자동 재전송 대상만 돌려준다. 앱이 표시한 행(기한 지남, 저장소 교체 뒤 등)은 돌려주지 않아도 된다(20 §5.2 (5)) */
  listPending(serverId: string): Promise<PendingCommand[]>;
  putPending(serverId: string, cmd: PendingCommand): Promise<void>;
  removePending(serverId: string, idempotencyKey: string): Promise<void>;
  /** "positions": 위치 삭제(뷰 낡음 표시는 앱), "all": 위치·뷰 삭제. pending은 지우지 않는다(사람이 확인) */
  clearServer(serverId: string, what: "positions" | "all"): Promise<void>;
}
export interface PendingCommand { idempotencyKey: string; method: CommandMethodName; params: unknown; createdAt: number }

export interface HelmClientOptions {
  transportFactory: () => Transport;          // 경로 선택은 이 전송 안에서 한다(20 MultiRouteTransport)
  client: ClientInfo;
  auth: { method: "deviceToken"; deviceId: string; sign?: (payload: string) => Promise<string> } | { method: "localAdmin" };
  /** 선택 인자(판정 §2). 업그레이드 헤더를 붙일 수 없는 전송(@helm/client/browser)만 쓴다.
   *  코어는 이 값을 전송의 helm-bearer. 하위 프로토콜에만 넘기고 저장하지 않는다. 데스크톱(Rust 전송)·TUI(localAdmin)는 넘기지 않는다 */
  credentials?: { deviceToken: string };
  expectedServerId?: string;
  storage: ClientStateStorage;
  clock?: () => number;                       // 시험용
  random?: () => number;
}

export declare class HelmClient {
  constructor(opts: HelmClientOptions);
  readonly state: "idle" | "connecting" | "handshaking" | "syncing" | "ready" | "backoff" | "needsUser" | "closed";
  readonly hello: HelloResult | undefined;
  readonly lastMessageAt: number | undefined;   // 마지막 수신 시각(tick 포함). 앱의 "느림" 판정(20 §3.8.9)
  on(ev: "state", cb: (s: HelmClient["state"], detail?: { kind?: string; retryInMs?: number; failure?: TransportFailure }) => void): () => void;
  on(ev: "invalidate", cb: (viewKeys: string[], seq: Seq, meta: { replaying: boolean }) => void): () => void;
  on(ev: "pendingResolved", cb: (idempotencyKey: string, outcome: { result: CommandResult } | { error: JsonRpcError }) => void): () => void;   // 재접속 뒤 다시 보낸 명령의 결과(20 §5.2 (3))
  on(ev: "outOfRange", cb: (reason: "storeMismatch" | "aheadOfHead" | "beforeOldest" | "tooFar", head: Seq) => void): () => void;
  on(ev: "serverRestarted", cb: (bootEpoch: string) => void): () => void;
  on(ev: "modeChanged", cb: (m: { mode: DaemonMode; since: IsoTime; reason?: string }) => void): () => void;
  on(ev: "shutdown", cb: (n: { reason: string; restartExpectedMs?: number }) => void): () => void;
  start(): void;
  stop(): void;
  retryNow(): void;                             // backoff 대기를 끝내고 바로 시도(네트워크 복구·깨어남, 20 §3.8.8). retryAfterMs 하한은 지킨다. needsUser면 아무것도 하지 않는다
  request<M extends ReadMethodName>(method: M, params: MethodMap[M]["params"], opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<MethodMap[M]["result"]>;
  command<M extends CommandMethodName>(method: M, params: Omit<MethodMap[M]["params"], "idempotencyKey"> & { idempotencyKey?: string }): Promise<CommandResult>;
  subscribeEvents(subKey: string, filter: EventFilter, handler: (events: EventWire[], meta: { caughtUp: boolean; replaying: boolean }) => void): () => void;
  subscribeStream(scope: StreamSubscribeParams["scope"], handler: (c: StreamChunkParams | { reset: RunPartial }) => void): () => void;
  getView<D>(view: ViewName, params: Record<string, unknown>, opts?: { minSeq?: Seq }): Promise<ViewResult<D>>;
  trackView(key: string, dependsOn: string[], asOfSeq: Seq): void;   // 무효화 감시 대상 등록
  untrackView(key: string): void;
  reportPresence(p: PresenceReportParams): void;   // 상태가 바뀔 때만 보낸다(최소 2초)
}
```

코어의 규칙:

- `command()`는 키가 없으면 `ik_<ULID>`를 만들고, 보내기 전에 `putPending`을 끝낸다. 응답(성공·커널 거부·3004·3006)을 받으면 `removePending`. 연결이 끊기거나 시간 초과면 남겨 두고 `syncing` 진입 때 `listPending`의 각 행을 같은 키·같은 params로 다시 보낸다. 다시 보낸 명령의 결과는 원래 `command()` 호출자가 이미 사라졌을 수 있으므로 `pendingResolved`로 알린다. `pendingCommandMaxAgeMs`를 넘은 행은 다시 보내지 않는다(앱이 표시를 붙이고 `listPending`에서 뺀다).
- 순서 보장(20 §5.2 (4)): 이벤트 묶음 `(from, to]`를 받으면 코어는 (1) 그 묶음으로 낡은 뷰의 `invalidate` 알림을 먼저 내보내고(앱이 낡음 표시를 저장), (2) 그 뒤에 `savePosition(… to)`을 부른다. 그래서 위치만 앞서 저장되고 낡음 표시가 빠지는 일이 없다. 위치 저장은 1초 디바운스, `caughtUp`·전송 닫힘 때 즉시 한다.
- `outOfRange`(§3.5.5): `storeMismatch`·`aheadOfHead`면 `clearServer(serverId, "all")`, `beforeOldest`·`tooFar`면 `clearServer(serverId, "positions")`를 부른 뒤 `head`로 다시 구독하고, 추적 중인 모든 뷰에 `invalidate`를 낸다.
- 요청 시간 제한 기본값: 조회 30초, 명령 60초. 명령이 시간 초과되면 진행 중 명령함에 남기고 연결을 다시 맺는다(응답 유실로 본다).
- 상태 기계는 §3.10.2, 백오프는 §3.10.3이다. `TransportFailure.blocked`와 인증 계열 실패는 `needsUser`로 가고 자동 재시도하지 않는다.
- 코어는 자격 증명 없이 동작한다(20 §5.2 (2)). `credentials`는 브라우저 전송을 쓰는 플랫폼(모바일 PWA 등, 26)만 넘긴다(판정 J-61).
- TUI 재사용: `@helm/tui`는 `HelmClient` + `NodeWsTransport({ socketPath })`(`@helm/client/node`) + `auth: { method: "localAdmin" }` + 파일 저장소를 쓰고, 뷰 캐시는 메모리 맵 하나로 둔다. 같은 `view.get` 결과를 pi-tui 컴포넌트로 그리므로 데스크톱과 TUI가 같은 투영을 본다(03 §3.11 parity, 07 §3.9.6). 휘발 스트림은 pi-tui `Markdown` 컴포넌트에 텍스트를 덧붙이는 데 쓴다.
- 코어 사본을 앱에서 고치지 않는다. 필요한 기능은 코어에 더한다(20 §3.9.4).

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
  commands.ts         메서드 → 10 CommandEnvelope(basisSeq 포함, §3.9.3), engine.submit, 결과 대응(§3.3.4)
  files.ts            HTTP 업로드·다운로드, 티켓 표(연결별), 대기 파일 표시
  presence.ts         연결별 presence → 11·14·16에 넘기는 휘발 상태
  redact.ts           18의 공개 정책 훅(EventWire.redacted)
  errors.ts           오류 정제(-32603, traceId)
```

다른 모듈에서 쓰는 인터페이스(이름은 각 문서의 것이다. 없는 것은 §5.2에 요구로 적었다):

```ts
// 09 (@helm/store, 09 §3.16) — 프로토콜 계층이 쓰는 부분
//   store.storeId, store.headSeq
//   store.readEvents({ afterSeq | beforeSeq, limit ≤ 5000, typePrefixes, goalId, concernId, ref, redact: true }) → { events, headSeq, nextAfterSeq }
//   store.onCommitted(listener)          // 커밋한 그 턴 안에서 동기로 호출(09 §3.8.4 8단계). 재생 중 보류·실시간 전송의 입력
//   store.getRecord(id)                  // record.locate, revisionSeq
//   store.stageUpload(uploadId, mediaType), store.getBlob(hash)
//   store.search(text, …)                // search.query
// 명령 제출은 06 engine을 거친다(engine.submit → store.commit, 09 §3.9). 프로토콜은 store.commit을 직접 부르지 않는다

// 12 (@helm/runtime)
interface ProjectionsForProtocol {
  get(view: ViewName, params: unknown, page?: ViewGetParams["page"]): {
    asOfSeq: Seq; data: unknown; dependsOn: string[];
    freshness: ViewResult["freshness"]; staleReason?: ViewResult["staleReason"]; omitted?: ViewResult["omitted"];
  };                                                        // 12 §3.5.8 ViewEnvelope에서 만든다(sourceSeq → asOfSeq, degraded → stale + staleReason)
  aggregateTags(e: EventWire): string[];                    // §3.6.3. 순수 함수
  waitFor(seq: Seq, timeoutMs: number): Promise<boolean>;  // 투영이 seq까지 따라왔는가(09 A09-4로 보통 즉시 true)
  locate(id: string): RecordLocation | undefined;          // record.locate
  impactOf(commandId: string): CommandImpact | undefined;  // 10 §3.13.3 결과의 화면용 요약
}
interface RunStreamForProtocol {
  subscribe(scope: StreamSubscribeParams["scope"], cb: (c: Omit<StreamChunkParams, "sub">) => void): () => void;
  partial(runId: string): RunPartial | undefined;
  active(scope: StreamSubscribeParams["scope"]): RunPartial[];
  request(kind: "steer" | "followUp" | "requestBrief" | "compact" | "stop" | "abort" | "resume", target: { runId?: string; workUnitId?: string; threadId?: string }, input?: unknown): void;
}

// 18 (packages/daemon/src/auth, 18 §3.4.4가 구현)
interface SecurityForProtocol {
  checkTransport(req: IncomingRequestInfo, listener: ListenerKind):
    | { ok: true; ingress?: { login: string; tailnetNodeId: string; nodeName: string; ip: string } }   // tailnetNodeId: 노드 묶기(18 D18-02)
    | { ok: false; httpStatus: 401 | 403 | 421 | 429 };      // 18 §3.4.3 preflight + §3.6.1 tailscaleIngress
  verifyDevice(conn: { bearer: string | null; listener: ListenerKind; ingress?: { tailnetNodeId: string }; nonce: string; serverId: string },
               auth: { deviceId: string; proof?: DeviceProof }):
    | { ok: true; principal: Principal; scopes: Scope[] }
    | { ok: false; code: 1004 | 1005 | 1006 | 1007 | 1008; reason?: string };   // 18 §3.6.1 helloDeviceAuth, reason 값은 18 §3.4.4
  redactEvent(e: EventWire, conn: ConnectionIdentity): EventWire;              // 09 sensitiveFields(공개 사본과 같은 규칙)
  proofRequired(listener: ListenerKind, deviceId: string | null): boolean;    // 1차 false, 기기별로 켬(모바일 권장)
  rateLimit(source: string, kind: "auth" | "pair" | "command"): { ok: true } | { ok: false; retryAfterMs: number };   // 18 §3.14
}
// 공개용 사본(redactions)은 09 readEvents({ redact: true })가 만든다. 프로토콜은 따로 가리지 않는다
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
   (진행 중 명령함에 먼저 저장)    ───────▶ engine.submit(커널이 basisSeq로 낡음 검사) → 커밋 1343~1345
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
 4 events {…run.message_recorded…} → 휘발 텍스트를 영속 메시지로 바꿈
```

### 3.17 모바일 클라이언트와 푸시 [결정 42, 방식은 26]

결정 42로 휴대폰에서 질문에 답하는 경로가 범위에 들어왔다. 구현 방식과 알림 경로는 26(P15)이 정한다. 26이 이 판을 쓰는 동안 없었으므로, 이 절은 어떤 방식을 고르든 프로토콜이 지킬 규칙과 26에 대한 요구만 적는다 [제안].

연결:

- 모바일 클라이언트는 데스크톱과 같은 프로토콜(같은 메서드·이벤트·재전송 의미)과 같은 코어 `@helm/client`를 쓴다. 경로는 휴대폰의 Tailscale 앱을 거친 WSS(`tailnet` 리스너)만 쓴다. SSH 경로는 두지 않는다 [가정: 26이 확인].
- `ClientInfo.kind = "mobile"`, `platform = "ios" | "android"`. 기기 페어링은 흐름 A(`POST /pair`, 18 §3.7)를 쓴다. 모바일 기기의 scope는 `read`, `decide`, `devicesLimited`다(새 기기 페어링 코드를 만들 수 없다, 18 §3.18.2 5번). 서명 증명은 `es256`(하드웨어 보호 키)을 권한다.
- 토큰 전달: 네이티브 전송(Tauri v2 모바일 등)이면 데스크톱처럼 `Authorization` 헤더, 브라우저 `WebSocket`을 쓰는 방식(PWA 등)이면 `helm-bearer.<토큰>` 하위 프로토콜(§3.2.2, `@helm/client/browser`, `credentials` 선택 인자). 토큰 보관 위치와 서명 증명(18 §3.8.5 Q18-02 "모바일이 생기면 켠다")은 18·26이 정한다(판정 J-61).
- 이동 환경 규칙: 앱이 백그라운드로 가면 연결을 닫고(1000) 위치만 저장한다. 다시 앞으로 오면 `retryNow()`로 바로 붙어 위치부터 재전송받는다. 모바일 데이터를 아끼려고 기본 이벤트 구독은 `filter.payload: "none"`(머리 정보와 무효화 태그만)으로 하고, 필요한 뷰만 `view.get`으로 받는다 [제안].
- 화면 범위: 질문함, 질문, 복귀 요약, 홈 요약 뷰(`inbox`, `question`, `brief`, `tray`)를 쓴다. 그 밖의 뷰도 같은 프로토콜로 받을 수 있다(03·26이 범위를 정한다).

푸시 알림(앱이 꺼져 있을 때):

- 프로토콜 쪽 원칙: 푸시는 "무엇인가 왔다"는 신호만 전한다. 질문 본문·제목·비밀은 푸시 payload에 넣지 않는다(판정 J-03의 기본 내용 숨김, 18 §3.10.3). 앱은 푸시를 받으면 연결해 `view.get`으로 내용을 받는다.
- 전달기(11 §3.5.3)는 `question.delivered`의 `channel = "push"`로 기록하고, 등록된 푸시 주소로 `{ v: 1, serverId, deliveryId, category, count, target }`만 보낸다(`target`은 딥 링크 `helm://question/<qs_id>`. 질문 ID는 비밀이 아니다).
- 등록 메서드(scope `devices`):

```ts
// device.registerPush / device.unregisterPush. 주소 형식과 제공자는 26이 정한다
export interface DeviceRegisterPushParams extends CommandParamsBase {
  channel: string;                 // 예: "webpush" | "apns" | "fcm" | "ntfy" — 26이 값 목록을 확정
  address: string;                 // 엔드포인트 URL 또는 기기 토큰. 비밀로 다룬다(18): 이벤트 payload에는 해시만
  keys?: Record<string, string>;   // Web Push의 p256dh·auth 등
}
export interface DeviceUnregisterPushParams extends CommandParamsBase { channel: string }
```

- 철회: 다른 기기에서 답하면(§3.8.3의 철회 계약) 전달기가 같은 `deliveryId`로 "철회" 푸시를 보낼 수 있는 제공자면 보내고, 아니면 앱이 다음 실행 때 지운다.
- 푸시 제공자가 외부 서비스(APNs, FCM, 공개 Web Push 중계 등)면 질문 존재 시각이 외부에 남는다. 이것은 18의 위협 모델 항목이고, 사람이 켤 때만 쓰는 설정(기본 꺼짐)으로 두기를 요구한다 [제안].

26에 대한 요구는 §5.2에 모았다.

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
| F-41 | SSH 호스트 키가 바뀜, SSH 키 거부, 키체인 접근 거부 | 전송이 `blocked`로 실패한다. 코어는 `needsUser`로 가고 자동 재시도하지 않는다(판정 J-62). 앱은 이유와 할 일을 보인다(20) | CT-31 |
| F-42 | 저장소가 복원된 뒤(`storeMismatch`) 진행 중 명령함에 결과를 모르는 명령이 있음 | 복원된 DB에는 그 멱등 키가 없을 수 있어 다시 보내면 두 번 적용될 수 있다. 코어는 `clearServer(serverId, "all")`을 부르고, 앱은 그 행을 자동 재전송에서 뺀다(20 F-17). 사람이 "보내지 못한 조작"에서 보고 새 키로 다시 보낸다 | CT-08 |
| F-43 | 페어링 코드가 만료·소진됨 | `1009`(사유 구분 없음, 18 §3.7.4). 화면 문구는 "코드가 틀렸거나 만료됐습니다. 새 코드를 만드세요"(05). 04·05의 "만료 구분" 요구는 보안상 받지 않았다(§7 Q-15) | CT-32 |
| F-44 | 푸시 제공자 실패·푸시 주소 만료(모바일) | 전달기는 `question.delivered`를 남기고(전달 시도 기록), 실패는 운영 로그에 둔다. 앱을 열면 위치부터 재전송받으므로 질문을 놓치지 않는다. 주소 만료가 반복되면 기기 목록에 "푸시 꺼짐"을 보인다(26) | 26 |
| F-45 | 토큰 만료(절대 365일·유휴 90일) | `1005`(`reason: expired`). 만료 30일 전부터 `DeviceInfo.expiringSoon`과 `daemon.status.warnings`로 알린다(18 §3.8.2) | CT-16 |

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
| 멱등 처리와 `basisSeq` 전달(§3.9) | 09, 10, 20 |
| 생존 확인·재접속 상태 기계(§3.10) | 20, 04 §3.0.4 |
| 파일 HTTP 규약(§3.11) | 12, 15, 17, 20 |
| `@helm/protocol` 구조, 등록 표, 생성 스크립트(§3.13), `@helm/client` 코어 API(§3.14) | 06, 20, 22, 23, TUI |
| 적합성 테스트 시나리오(§6.3) | 22 |

### 5.2 다른 문서에 요구하는 것

2a단계에서 받은 요구는 반영했고(아래 "반영" 줄), 남은 것만 "요구"로 적는다.

| 문서 | 반영한 것 / 남은 요구 |
|---|---|
| 01 | 반영: NFR-P-1·P-2·P-4 측정 지점(§6.4), NFR-D-4(§3.9), FX-16(F-05). 요구: FX-16의 "읽기 전용으로 붙는다"를 "캐시한 투영을 읽기 전용으로 보인다"로 고쳐 적기(버전이 맞지 않으면 연결을 맺지 않는다) |
| 02 | 반영: AC-04-04(세 리스너 동등성, §6.3), 재전송·멱등 입력·버전 확인. 요구: UC-04 모바일 경로 시나리오에 §3.17의 "백그라운드면 연결을 닫고 앞으로 오면 위치부터"를 넣기 |
| 03 | 반영: 화면별 뷰 카탈로그(§3.7.4), 명령 의도 → 메서드(§3.7.1), 딥 링크 대상의 경로 인자(`record.locate`). 남은 요구 없음 |
| 04 | 반영: `tray`·`settings` 뷰, 복귀 요약 고정(`brief.untilSeq`), `brief.acknowledge.note`, 3008·3009 세부(`resolvedAt`, 대체 레코드의 `RecordRef`), 버전 실패의 `serverVersion`, `DaemonStatus.disk`, 다른 기기에서 답한 질문의 알림 철회 계약(§3.8.3), §1.5 옛 이름. 요구: (1) `ViewMeta.sourceSeq`가 `asOfSeq`와 같은 값임을 적기. (2) `RecordRef`에 `revisionSeq`. (3) 페어링 코드 만료 구분은 보안상 받지 않았다(18 §3.7.4, F-43). 문구를 "틀렸거나 만료됨" 하나로. (4) 결과 제출 ID 이름 `submissionId`를 `resultId`(08 `rs_`)로 |
| 05 | 반영: §3.11 대응표의 오류 kind(§3.3.4), 3008·3009 세부, `serverVersion`, `comparison` 반응. 요구: 새 kind의 문구 키 — `blob.gone`, `auth.revoked`의 `reason: expired`, `auth.methodNotAllowed`의 `node_mismatch`, `rateLimited`(10분 차단), 알림 철회, 푸시 "무엇인가 왔다" 문구 |
| 06 | 반영: 진입점(`@helm/protocol` `.`·`./testing`, `@helm/client` `.`·`./node`·`./browser`, `ws`는 `./node`만), 세 리스너 동등성 시험(§6.3), `@helm/client` 별도 패키지(판정 §2). 요구: (1) 06 §3.3.1의 `@helm/protocol/client` 표기를 `@helm/client`로. (2) 06·13의 7801을 7840·7841로(판정 §2). (3) engine의 `SubmitResult`가 `needs_gate`를 구분해 돌려줄 것(10 §3.3.5와 같다) |
| 07 | 반영: pi-protocol·pi-server·pi-client·pi-env를 코드로 쓰지 않음, TUI가 같은 코어를 씀. 남은 요구 없음 |
| 08 | 반영: 레코드 스키마를 `@helm/domain`에서 가져다 씀(§3.7.4), 거부 갈래 `authority`, `BlobRef` 필드 이름(§3.11.1), `ObjectionTarget`(판정 J-36), `RevisionRef`(`expect`). 남은 요구 없음 |
| 09 | 반영: seq 성질, `storeId`, `readEvents` 페이지(`headSeq`·`nextAfterSeq`), 휘발 공통 필드(`afterSeq`)와 종류 대응(§3.6.4), 공개용 사본(`redact: true`, `redactions`), blob 해시·id, staged 업로드, 멱등 범위·지문·결과 저장 규칙(§3.9.2), `question.delivered` payload. 요구: (1) 1판 요구였던 이벤트 행의 `invalidates` 열은 필요 없다(프로토콜이 보낼 때 계산한다, §3.6.3). (2) presence 영속(`presence.changed`)을 두는 09와 두지 않는 11 §3.8.1이 다르다. 프로토콜은 휘발 입력만 받으므로 어느 쪽이든 맞는다. 09·11이 하나로 정하기 |
| 10 | 반영: 명령 이름(§3.7.1 대응표), 거부 코드·갈래(§3.3.4), `needs_gate` → `gated`, `question.answer` 답 종류 대응, `question.escalate`, `decision.contest`, `next`. 요구: (1) `CommandEnvelope.basisSeq`를 더하고 V-VER-01이 `revisionSeq > basisSeq`를 보게 하기(10 §3.3.4의 "19가 `expect`를 만든다"를 09 §3.9.4의 커널 안 비교로 바꾸기, §3.9.3). (2) 대응표에서 "10에 요구"인 명령: `autonomous.mark_seen`, 반응 철회, `agreement.correct_understanding`, 보류 해제(`concern.resume`), 사람의 구조 요청(`structure.request`), `setting.change`, `brief.correct`, `expectation.revise`(rulings §1) |
| 11 | 반영: 질문 메서드 대응(11 §3.18), `defer.until` 변환, 권리 게이트의 `proceedWithAssumption` 거부(3001), 전달 payload(§3.8.3), presence 사용. 요구: `BriefAcknowledgePayload`에 `note` 더하기(04 요구) |
| 12 | 반영: 휘발 스트림 종류(`toolPhase` = `tool.progress`, `toolArgs`), `run.partial`(`runStatus`, `threadId`), 제어 문자 제거(§3.6.4), 컴팩션 요청(`thread.compact`), 안전 모드 표시와 해제(`daemon.exitSafeMode`), 화면 투영 envelope(`sourceSeq` → `asOfSeq`, `degraded` → `stale`). 받지 않은 것: 관찰 프로세스용 모델 호출 메서드(판정 §2: 16 IPC). 요구: `ProjectionsForProtocol`(`aggregateTags`, `locate`, `impactOf`)과 `RunStreamForProtocol`(§3.15) 구현, 휘발 조각 50 ms 묶음·16 KiB 이하·`end`는 영속 커밋 뒤 |
| 13 | 반영: 데몬 소켓 경로 고정(`/run/user/<uid>/helm/rpc.sock`), 클라이언트 자격 파일은 서버 디스크에 없음(데스크톱은 키체인, TUI는 `localAdmin`). 요구: 도구 격리의 가림 목록에 `%t/helm`(소켓 디렉터리) 포함(17 §3.6과 같다) |
| 14 | 반영: 사람 명령(루프 지정 `loop.requestTransition`, 계획 수정 `loopPlan.revise`, 모드 `mode.set`, 다이얼, Concern 열기·닫기, 이의)과 접속 상태 입력(`presence.report`). 요구: 다이얼 키·값 스키마와 `OrchestrationSettings` 스키마를 `@helm/domain`에 두어 `dial.set`·`settings.update`가 가져다 쓰게 하기 |
| 15 | 반영: `reaction.record`의 `comparison`·`comment`, 가능성 대상(`subjectId`), `possibility.pin`·`dismiss`, `inquiry.fillCell`·`pinLens`, `inquiry` 뷰 내용. 요구: `stimulusRound.close`의 커널 명령 이름(이벤트 `inquiry.round_ended`) |
| 16 | 반영: `metrics`(창 `7d`·`14d`·`28d`, 화면 `SCR-METRICS`)·`evaluation` 뷰, 측정 명령(`surprise.report`, `resumptionCheck.answer`·`score`(판정 J-78), `selfReport.submit`, payload는 16 §3.24.3), 열람 기록은 `presence.report`에서, 관찰 IPC는 클라이언트 프로토콜이 아님. 요구: 감사 깊이 표시를 16 §3.23.1의 `screen` "#audit" 접미 대신 `presence.report.depth = "audit"`로 읽기(20 §5.2 (6)과 같은 필드 하나로) |
| 17 | 반영: 리스너 값, `safeMode`, 종료 사유, `DaemonStatus` ← `OpsStatus`, `admin.*`(`admin.maintain`·`admin.verify` 포함), `device.expireTokens`·`device.rebind`, `DaemonMode` 대응(§3.4.4), `serverId`, `/healthz`(판정 §2. 1판의 `{"ok":true,"protocols":[1]}`는 없앴다). 요구: 복원 때 `storeId` 교체와 `store.restored`(09 §3.14.2와 같은 절차)를 17 복원 절차에 적기 |
| 18 | 반영: `SecurityForProtocol` 이름(`checkTransport`가 `tailnetNodeId`를 돌려줌), `DeviceProof.alg`에 `es256`, 모바일 scope(`devicesLimited`), 1004~1008 `details.reason` 값, `device.expireTokens`·`device.rebind`, 페어링 코드 12자, `device.rotateToken`을 HTTP `POST /devices/self/rotate`로, `hello` 오류 사유(`expired`, `node_mismatch`), 10분 20회 차단, 기기당 연결 8·전체 64, `loopback` Host 목록, 형식이 틀린 토큰은 업그레이드 401. 요구: (1) `helm-bearer.<토큰>` 하위 프로토콜(브라우저 전송용, §3.2.2)을 받아들일지 확인(프록시 로그에 하위 프로토콜 값이 남을 수 있다). (2) 모바일 기기 인증과 푸시 주소를 비밀로 다루는 규칙(판정 J-61, §3.17). (3) 외부 푸시 제공자의 위협 항목 |
| 20 | 반영: `HelmClient`·`ClientStateStorage` API(§3.14), `TransportFailure.blocked`, `retryNow()`, `lastMessageAt`, `pendingResolved`, invalidate → 위치 저장 순서 보장, `listPending` 계약, `presence.report.depth`, 코어가 자격 증명 없이 동작, blob 불변·`ETag`·`blobId` 패턴, `POST /pair` 응답 `{serverId, deviceId, deviceToken}`, `tray` 뷰, `record.locate`, 가짜 데몬 조작(§6.3), 백오프 값(§3.10.3). 남은 요구 없음 |
| 21 | 반영: `CommandResult.impact`, 오류 kind 유지(낡은 기준은 `3004 command.revisionConflict`), 이미지 판 경로(`variants`, `?variant=`), 서버 시각(`hello.challenge.serverTime`, `tick.serverTime`). 남은 요구 없음 |
| 22 | §6.3 적합성 시나리오를 세 리스너 각각에 돌리는 동등성 시험, 장애 주입(연결 끊기 지점, 데몬 강제 종료, 느린 소비자), 성능 시험(§6.4) |
| 23 | M1에서 `@helm/protocol` 등록 표 + 가짜 데몬 + 적합성 스위트를 먼저 만들고, 데몬 프로토콜 계층과 `@helm/client`, 앱을 그 위에 붙인다 |
| 26 | (1) 모바일 구현 방식(네이티브 전송 또는 브라우저 전송)과 그에 따른 토큰 전달(헤더 또는 `helm-bearer.` 하위 프로토콜). (2) 푸시 제공자와 `device.registerPush`의 `channel`·`address` 형식. (3) 푸시 payload가 §3.17의 최소 필드만 싣는다는 것. (4) 백그라운드 전환 때의 연결 처리. (5) 모바일 화면 범위(어느 뷰를 쓰는가) |

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
| 클라이언트 상태 기계 | `packages/client/src/connection.ts` | §3.10.2 표의 모든 행을 가짜 전송·가짜 시계로 재현하는 표 기반 테스트가 통과한다. 인증 계열 실패와 `blocked`에서 재접속하지 않는다. `retryNow()`가 백오프를 끝내되 `retryAfterMs` 하한을 지킨다 |
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
| CT-31 | 전송 실패 `blocked`(가짜 전송) | 코어가 `needsUser`, 재시도 없음. `retryNow()`도 아무것도 하지 않음 |
| CT-32 | `POST /pair` 틀린 코드·만료 코드·소진 코드·`loopback`에서 요청 | 앞의 셋은 같은 `1009` 응답, 마지막은 404 |
| CT-33 | `helm-bearer.<토큰>` 하위 프로토콜로 업그레이드, 헤더와 둘 다 있을 때 | 하위 프로토콜만으로 인증 성공, 응답 하위 프로토콜은 `helm-jsonrpc`만. 둘 다 있으면 헤더를 씀 |
| CT-34 | 재접속 뒤 다시 보낸 명령 | `pendingResolved` 알림 한 번, 원래 호출자가 없어도 결과가 전달됨 |
| CT-35 | 이벤트 묶음 처리 순서 | `invalidate` 알림이 같은 구간의 `savePosition`보다 먼저 일어남(가짜 저장소로 호출 순서 기록) |

가짜 데몬(`@helm/protocol/testing`)의 조작 목록(20 §3.13.3의 요구): 이벤트 주입, 위치 건너뛰기(구간 계약 위반 주입), `storeId`·`bootEpoch` 바꾸기, `view.get` 지연과 `2006`, 연결 끊기(지정한 메시지 직후), tick 멈추기, HTTP 401·403·421·429 응답, `hello` 오류(`1003`·`1004`·`1005`·`1008`), `5001`·`5003` 응답, 명령에 `3004`·`3008`·`3009` 거부, 같은 멱등 키에 처음 결과 돌려주기, close `1001`·`4008`·`4009` 보내기, `server.modeChanged` 보내기, 휘발 조각 버리기(`n` 건너뛰기), 시험용 토큰(`helm-bearer.` 하위 프로토콜). 실제 데몬은 이 조작을 갖지 않는다(시험 빌드 전용).

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
| Q-07 | 토큰 교체 | JSON-RPC 메서드 / HTTP `POST /devices/self/rotate` | 해결: HTTP(18 §3.8.3). 1차에서는 쓰지 않고 만료가 가까우면 다시 페어링 |
| Q-08 | 하위 Concern 필터 판정 시점 | 현재 트리 / 이벤트 당시 트리 | 현재 트리(F-28). 이벤트 당시 판정이 필요하면 09가 이벤트에 조상 경로를 저장해야 한다 |
| Q-09 | 이미지 판 생성 | 데몬이 업로드·생성 때 / 요청 때 | 업로드·생성 때 한 번. 라이브러리는 17·12 |
| Q-10 | 데스크톱 기본 이벤트 구독의 payload | `full` / `none` | `full`(타임라인 캐시에 쓴다). 데이터 양이 문제가 되면 `none` + `events.read` |
| Q-11 | TUI의 인증 | `localAdmin` / 기기 토큰 | `localAdmin`(토큰을 WSL 디스크에 두지 않는다). 13·18의 격리가 전제 |
| Q-12 | 직전 버전 지원 기간 | 한 버전 / 기간 | 한 버전(N-1). 1인 사용이라 앱과 데몬을 같은 날 갱신하는 일이 많다 |
| Q-13 | `composer.preview`를 동기 조회로 둘지 | 동기(최대 30초) / `accepted` + 뷰 | 동기. 모델 호출이 길어지면 `accepted` + `semanticPreview` 뷰로 바꾼다 |
| Q-14 | 낡음 검사를 어디서 하나 | 커널 decide 안(`basisSeq`를 envelope에) / 프로토콜이 `expect`를 계산(10 §3.3.4) | 커널 안(09 §3.9.4와 같다). 세 갈래 충돌 코드를 커널만 구분할 수 있다. 10에 `basisSeq` 필드를 요구한다 |
| Q-15 | 페어링 코드 실패 사유를 사람에게 구분해 보일지(04·05 요구) | 구분 / 구분 안 함(18) | 구분 안 함. 코드 존재 여부를 알리지 않는 쪽이 낫고, 만들 때 만료 시각을 보이므로 사람이 짐작할 수 있다 |
| Q-16 | 브라우저 전송의 토큰 전달 | `helm-bearer.` 하위 프로토콜 / `hello` 인자 / 쿼리 문자열 | 하위 프로토콜. 토큰이 JSON 메시지와 URL에 실리지 않는다. 18이 프록시 로그 노출을 확인한다 |
| Q-17 | 모바일 기본 이벤트 구독 | 전체 payload / 머리 정보만(`payload: "none"`) | 머리 정보만. 26이 데이터 사용량을 보고 정한다 |
| Q-18 | 외부 푸시 제공자 사용 | 쓰지 않음(앱을 열 때만) / 켤 수 있음(기본 꺼짐) | 켤 수 있음, 기본 꺼짐. payload는 §3.17의 최소 필드 |

## 8. 출처

- 브리프: `docs/design/process/00-design-brief.md` 결정 10, 12, 14, 18, 19, 21, 22, 24, 26, 29, 31~33, 36~39, 41~46, §2.5, §3.1~§3.5, §5.
- 조정자 판정: `docs/design/process/rulings-stage2a.md` §1(이름 정본, 거부 갈래), §2(`@helm/client`, 리스너 포트, `/healthz`), J-03, J-04, J-10, J-20, J-30, J-36, J-52, J-61, J-62.
- 2a단계에서 맞춘 문서: 08 §3.2·§3.4.2·§3.4.7·§3.13·§3.15(ObjectionTarget); 09 §3.2, §3.4.9·§3.4.13·§3.4.15, §3.5, §3.9, §3.11.5, §3.12, §3.14.2, §3.16, §5; 10 §3.3, §3.4, §3.11, §3.13.3; 11 §3.5.3·§3.5.6, §3.8.1, §3.18; 12 §3.2, §3.5.8, §3.6.2, §5.2; 15 §3.6.4, §5.2; 16 §5.2; 17 §3.4.1, §3.11.1, §3.15, §5.2; 18 §3.4~§3.8, §3.14, §5.2; 20 §3.8.5~§3.8.8, §3.9.4~§3.9.7, §3.13.3, §5.2; 21 §3.7.3, §5.2; 04 §3.24, §5.2; 05 §5.2.
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
- 결정: `Authorization: Bearer <토큰>`(헤더를 붙일 수 없는 브라우저 전송은 `helm-bearer.<토큰>` 하위 프로토콜)을 업그레이드 요청에 싣고, 데몬은 챌린지 뒤 `hello`를 받을 때 토큰·기기 ID·(선택) 서명 증명을 함께 판정해 결과를 `hello` 응답이나 오류로 돌려준다. SSH 키와 Tailscale 신원은 전송 계층 조건이다. `localAdmin`은 Unix 소켓에서만 받는다.
- 근거: 토큰이 JSON 메시지에 실리지 않으므로 웹뷰 메모리를 거치지 않는다. 판정이 한 곳(`hello`)에 모여 오류 형식이 하나다. 서명 증명을 나중에 켜도 메시지 형식이 바뀌지 않는다.
- 기각한 대안: 업그레이드 단계에서 401로만 판정(오류 kind를 줄 수 없음, 챌린지 서명과 맞지 않음), `hello` params에 토큰(웹뷰 메모리에 토큰), SSH 키만으로 인증(기기별 폐기·감사 불가, `loopback`은 다른 프로세스도 열 수 있음).
- 결과: Rust 전송이 헤더를 붙인다. 브라우저 전송(모바일 PWA, 20 APP-D15 시험)은 하위 프로토콜을 쓴다. 18이 하위 프로토콜 값의 로그 노출을 확인해야 한다.

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
- 결정: 뷰 응답에 `asOfSeq`·`dependsOn`, 영속 이벤트에 `invalidates`(프로토콜이 보낼 때 envelope의 subject·refs·scope와 12의 `aggregateTags`로 계산)를 싣는다. 클라이언트는 교집합으로 낡음을 판단하고 `minSeq`를 붙여 다시 받는다.
- 근거: 앱에 이벤트 → 화면 대응표가 필요 없다. 무효화가 이벤트 스트림 안에 있어 재전송으로 함께 복원된다. 서버가 연결별 뷰 상태와 차이를 들고 있지 않아도 된다.
- 기각한 대안: 스냅샷 + JSON Patch(서버의 연결별 상태, 패치 순서 오류 시 재동기화 경로가 하나 더 필요), Chord delta(안정 계약이 아님), 클라이언트 쪽 리듀서(도메인 로직이 앱에 들어감), 무효화만 보내는 SSE(재전송 없음).
- 결과: 12가 `aggregateTags`와 뷰의 `dependsOn`을 정확히 계산해야 한다(속성 테스트 VIEW-01). 09는 바뀌지 않는다. 갱신이 잦은 화면(대화)은 휘발 스트림으로 보완한다.

### 19-A5. 휘발 스트림은 seq 없는 별도 알림으로 보낸다

- 상태: 제안
- 결정: `stream.chunk`에 실행별 `n`과 텍스트 `offset`을 붙이고, 유실 시 `run.partial`로 맞춘다. 최종 내용은 영속 이벤트로 온다.
- 근거: 토큰 단위 영속 쓰기의 비용(happy-agent `LEARNINGS.md`), 재전송 범위 낭비를 피한다. offset은 중복·겹침에 안전하다.
- 기각한 대안: 델타를 영속 이벤트로 기록, 델타를 seq 공간에 섞기(happy-agent API 저널).
- 결과: 느린 소비자에서 먼저 버릴 수 있는 메시지가 생긴다.

### 19-A6. 명령은 domain action별 메서드, 멱등 키와 `basisSeq` 필수

- 상태: 제안
- 결정: 04의 명령 의도 이름을 메서드로 쓰고, 모든 명령에 `idempotencyKey`(`ik_<ULID>`)와 `basisSeq`를 요구한다. 커널이 `basisSeq`와 대상 레코드의 `revisionSeq`를 비교한다(09 §3.9.4).
- 근거: canon-3 §6.10.1(generic `execute` 금지), canon-2 L14(cursor에 묶인 Gate), 09 §3.9.4, NFR-D-4.
- 기각한 대안: generic `command.submit`, 클라이언트가 revision을 직접 보내는 방식만(모든 뷰가 revision을 정확히 실어야 함), 전역 expectedCursor(무관한 이벤트로 충돌).
- 결과: 08이 `revisionSeq`, 10이 `subjects()`와 `CommandEnvelope.basisSeq`를 제공해야 한다.

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
