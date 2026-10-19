# 19. 클라이언트 프로토콜

- 작성: 2026-10-11, P12(프로토콜)
- 상태: 4단계 보완판(2026-10-12). 기준 결정은 브리프 결정 1~64과 조정자 판정(`docs/design/process/rulings-stage2a.md` J-01~J-276)이다. 이벤트 이름은 09 §3.4, 명령 이름은 10 §3.11, 레코드·ID 접두사는 08을 정본으로 따른다. 모바일은 26(결정 47~49)을 따른다.
- 소유: 프로토콜 메서드 이름(정본), 메서드 params·result 스키마, 메시지 형식(envelope), 알림 이름, 오류 코드(정본)와 10 거부 코드의 대응, 핸드셰이크, 구독·재전송 의미, 파일 전송 HTTP 규약, `@helm/protocol` 패키지 구조.
- 소유하지 않음: 이벤트 이름과 payload(09), 명령의 의미와 거부 규칙(10·11), 화면과 화면별 표시 데이터의 정의(03·04), 인증 자료의 암호 방식·페어링 정책·토큰 보관(18), 리스너 주소·소켓 경로·데몬 수명주기(17), 앱의 상태 저장소·라우팅·SSH 프로세스 관리(20), 런타임 어댑터 프로토콜(13).
- 출처 표기: "pi-api-facts-2 §3.2"는 `docs/design/process/sources/pi-api-facts-2.md` 3.2절, "S4 openclaw-gateway §1.5"는 `.helm-design-work/S4/openclaw-gateway.md` 1.5절, "발췌4 20-9"는 `docs/design/process/sources/conversation-extracts-4.md`의 항목 번호, "canon-2 §9.8"은 `sources/helm-canon-2.md` 9.8절, "v0.3 12 §9"는 `docs/v0.3/12-implementation-architecture.md` 9절이다.

## 1. 목적과 범위

### 1.1 목적

Helm 데몬(WSL2 서버에 상주, 결정 20·22)과 클라이언트(데스크톱 앱, 모바일 PWA, 이후 TUI, 관리 CLI) 사이의 통신 규약을 정한다. 구현자가 이 문서만 보고 다음 세 가지를 만들 수 있어야 한다.

1. `@helm/protocol` 패키지: 메시지 스키마(TypeBox 상수, 타입은 `Static`), 오류 표, 메서드·알림 등록 표, 메서드 params → 10 명령 payload 변환 규칙, 적합성 테스트 도구(가짜 데몬·가짜 클라이언트).
2. 서버 쪽 프로토콜 계층(`@helm/daemon` 안): 리스너, 핸드셰이크, 연결 상태, 구독·재전송, 백프레셔, 멱등 처리 연결, HTTP 파일 전송.
3. 클라이언트 SDK(`@helm/client`, 06 §3.3.1): 데스크톱 앱(20), 모바일 PWA(26), TUI가 같이 쓰는 연결 관리, 재접속, 구독 복원, 뷰 무효화 처리, 진행 중 명령 재전송.

### 1.2 다루는 것

- 전송: Tailscale serve를 거친 WSS(데스크톱은 헤더 토큰, 모바일 PWA는 쿠키 토큰), SSH 경로, 로컬 관리 경로. 어느 경로든 같은 메시지와 같은 재전송 의미. 데몬이 서빙하는 모바일 정적 경로(`/m/*`)와 쿠키 페어링의 HTTP 규약.
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
| 모바일 PWA의 화면·서비스 워커·푸시 계획과 payload 형식, 쿠키·Origin 검사와 모바일 scope의 보안 판정 | 26(P15), 18 |

### 1.4 이 문서에서 쓰는 말

| 말 | 뜻 |
|---|---|
| 연결 | WebSocket 연결 하나. 핸드셰이크를 마친 연결은 기기 하나(또는 로컬 관리자, 외부 런타임 브리지)로 인증된 상태를 가진다 |
| 운반 방식(carrier) | 기기 토큰을 업그레이드 요청에 싣는 방식. `header`(`Authorization: Bearer`, 데스크톱·TUI)와 `cookie`(`__Host-helm_dt` HttpOnly 쿠키, 모바일 PWA, 결정 47). 기기마다 하나로 정해진다(08 Device `credentialCarrier`) |
| 리스너 | 데몬이 연결을 받는 곳. `tailnet`(TCP, Tailscale serve 전용), `loopback`(TCP, SSH 경로용), `local`(Unix 소켓, WSL 안의 TUI·CLI용) 세 종류다 |
| 영속 이벤트 | 정본 이벤트 로그(09)에 seq와 함께 기록된 이벤트. 재전송 대상이다 |
| 휘발 스트림 | 로그에 남지 않는 실시간 조각(토큰 단위 텍스트, 도구 출력 조각, 진행 표시). seq가 없고 버려도 정본이 손상되지 않는다 |
| 위치(position) | 이벤트 구독이 "여기까지는 빠짐없이 보냈다"고 보장하는 전역 seq 값 |
| 저장소 ID(`storeId`) | 이벤트 저장소의 정체. 저장소를 새로 만들거나 백업에서 복원해 seq 연속성이 끊기면 바뀐다(20 §1.4와 같은 이름) |
| 뷰 | 데몬이 정본을 읽어 만든 화면 투영(결정 13의 "투영"). 클라이언트는 `view.get`으로 받아 캐시하고, 이벤트에 실린 무효화 태그로 낡은 것을 다시 받는다 |
| 무효화 태그 | 뷰가 기대는 대상(레코드 ID 또는 `@inbox` 같은 집계 이름). 커밋 때 09가 이벤트마다 저장하고(`event_invalidations`), 뷰 응답의 `dependsOn`과 이벤트의 `invalidates`에 실린다. 둘이 겹치면 그 뷰는 낡은 것이다 |
| 기준 seq(`basisSeq`) | 사람이 결정을 내릴 때 본 화면이 몇 번 seq 기준이었는지. 커널은 대상 레코드의 `revisionSeq`가 이 값보다 뒤면 낡은 화면에서 내린 결정으로 보고 거부한다(§3.9.3, 판정 J-79) |
| 멱등 키(`idempotencyKey`) | 클라이언트가 사용자 의도 하나에 붙이는 키. 재시도·재접속 뒤 다시 보내도 한 번만 적용된다 |
| 티켓 | HTTP 다운로드 URL에 넣는 짧은 수명의 무작위 값. 헤더를 붙일 수 없는 곳에서만 쓴다. 기기 토큰과 별개다 |

### 1.5 관련 유즈케이스

| 유즈케이스 | 이 문서에서 쓰는 곳 |
|---|---|
| UC-03 여러 날 걸리는 작업 | 클라이언트 없이 쌓인 이벤트를 재접속 때 `from` 위치부터 받는다(§3.5). 범위를 넘으면 스냅샷 경로(§3.5.5) |
| UC-04 외부에서 접속해 질문에 답하기 | 전송 두 경로(§3.2), 휴대폰 경로(쿠키, 푸시, §3.17), 핸드셰이크(§3.4), `inbox` 뷰 구독, `question.answer`(§3.7.5). 시퀀스는 §3.16.1 |
| UC-05 혼자 정한 결정 확인과 이의 | `autonomous` 뷰, `autonomous.markSeen`, `decision.confirm`, `objection.file` |
| UC-06 복귀 요약 | `brief` 뷰, `brief.acknowledge`(사용자별 마지막 확인 위치, 휴대폰이면 `compact`) |
| UC-01 취향형 작업의 원함 탐구 | `stimulusRound` 뷰(`inquiryId` + `roundNo`), 이미지 자극의 HTTP 다운로드(§3.11), `reaction.record`, `stimulusRound.close` |
| UC-07 되돌리기 비싼 선택(C와 A) | `agreement.confirm`, `result.accept`(반영 처리 방침, 반영 범위 합의 포함) 명령과 `basisSeq` |
| UC-08 반복 마찰 제안 | `observerProposals` 뷰, `observerProposal.*` 명령 |
| UC-09 Goal 정제 | `goal.revise`, `goal.confirmRevision`·`goal.rejectRevision`, `goal` 뷰 |
| UC-11 처음 연결 | `project.create`, `goal.activate`(에이전트 Goal 초안으로 시작), `POST /pair`·`/m/pair` |
| UC-02 원인 조사 | `inquiry`·`evidenceChain` 뷰, `inquiry.*` 명령 |

## 2. 전제와 결정

### 2.1 브리프 결정에서 오는 전제

표시는 브리프 §5.2(판정 J-144)를 따른다. 아래 표의 번호 중 26~32·34·36·37은 조정자 기본값, 44~46은 조정자 판정이다.

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
| 42 | 휴대폰에서도 질문에 답할 수 있어야 한다. 모바일 클라이언트도 같은 프로토콜과 같은 클라이언트 코어(`@helm/client`)를 쓴다(§3.17) |
| 47 | 모바일 클라이언트는 데몬이 서빙하는 PWA다. 데몬이 `/m/*` 정적 경로와 쿠키 페어링을 서빙하고(§3.2.5), 모바일 기기 토큰은 `__Host-helm_dt` 쿠키로 나른다(§3.2.2, 26 §3.3.3, 판정 J-118). 알림은 Web Push(§3.17). 결정 19의 "웹이 아니다"는 데스크톱에 적용한다 |
| 48 | 휴대폰 푸시는 알림 강도 `interrupt`와 `notice` 질문까지 보낸다. 푸시 등록의 `minUrgency` 기본값은 `notice`다(§3.17) |
| 49 | 모바일 최소 판은 iOS 26이다. `ClientInfo.platform`에 `android`를 두지 않는다 |
| 53 | [결정 53] 루프 계획은 혼합 방식으로 만든다. 다이얼 `planAuthoring`(`computed`·`hybrid`(기본)·`model`, 층 user·concern)을 `dial.set`·`dial.unset`으로 고른다(§3.7.5, 판정 J-188). 계획을 모델이 설계했는지는 `authoredBy`(`code`·`model`·`human`)로 싣고, 화면이 그 사실을 표시한다(§3.7.4 `loopTimeline`). 계획 계산과 검사는 14·10이 소유한다 |
| 56 | [결정 56] 결과 확인 대기의 휴대폰 알림은 설정 `notifications.resultReview`(`none`·`daily_digest`·`immediate`, 기본 `none`)로 고른다. 묶음 시각은 `notifications.resultReviewDigestAt`(기본 `19:00`, 서버 시간대)이다. 설정은 `settings.update`로 바꾸고 기록은 `setting.changed`다(§3.7.5, §3.17, 판정 J-189) |
| 57 | [결정 57] Apple 개발자 프로그램은 지금 없다고 본다. 네이티브 iOS 경로(APNs, 26 경로 B)는 이후에 검토한다. 1차 푸시 채널은 `webpush`만 받는다(§3.7.7, §3.17) |
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
| P-03 | 기기 인증은 모든 경로에서 `hello`에서 판정한다. 기기 토큰은 WebSocket 업그레이드 요청에 싣는다: 데스크톱·TUI는 `Authorization: Bearer` 헤더(데스크톱은 Rust가 붙인다, 20 APP-D02), 모바일 PWA는 페어링 때 데몬이 심은 `__Host-helm_dt` HttpOnly 쿠키(`tailnet` 리스너만, Origin 정확 일치, 26 §3.3.3). 데몬은 `hello`를 받을 때 판정해 결과를 `hello` 응답으로 돌려준다. SSH 키와 Tailscale 신원은 전송 계층의 추가 조건이다. `localAdmin`은 `local` 리스너에서만 받는다 | 쿠키 방식은 [결정 47], [판정 J-118](18·19는 26을 따른다). 헤더 방식과 판정 위치는 [제안], 최종은 18. "hello 안에서 인증, 실패하면 거절 응답"은 Paseo 방식(pi-cases-notes §12.1-7). ADR 후보 19-A2 |
| P-04 | envelope는 JSON-RPC 2.0이다. 요청 `id`는 문자열, `params`·`result`는 항상 객체, 배치(배열)는 쓰지 않는다. 서버가 클라이언트에 요청을 보내는 일은 없다(서버 → 클라이언트는 알림만) | [제안: 결정 31 기본값] + 세부 [제안] |
| P-05 | 재전송 위치는 09의 전역 이벤트 로그 seq를 그대로 쓴다. 저장소 정체 `storeId`를 함께 둔다. 사례 8곳 중 데몬 재시작을 넘는 네트워크 재전송 구현은 없으므로 재전송 규칙은 이 문서가 직접 정한다 | [제안: 결정 29·31 기본값] + `storeId` [제안](Paseo `{epoch, seq}` 커서, pi-cases-notes §1-1·§11.2) |
| P-06 | 이벤트 구독은 `{from, to}` 구간 계약을 쓴다. 알림 하나가 `(from, to]` 구간의 필터에 맞는 이벤트를 빠짐없이 담는다. 클라이언트는 `from`이 자기 위치와 같은지로 gap을 찾는다 | [제안]. Chord `ReplicatedStateSource`의 커서 계약(pi-api-facts-2 §6.2)을 필터 구독에 맞게 고침 |
| P-07 | 화면 투영은 `view.get`으로 받는다. 응답에 `asOfSeq`와 무효화 태그 `dependsOn`을 싣고, 영속 이벤트마다 커밋 때 09가 저장한 `invalidates` 태그(12 `aggregateTags`로 계산)를 싣는다. 클라이언트는 열린 뷰의 `dependsOn`과 겹치면 `minSeq`를 붙여 다시 받는다. 뷰는 재접속 때 다시 받고 `from` 재전송은 이벤트에만 적용한다 | [제안]. 결정 32(앱에 로직 없음)와 20 APP-D01·AS-1에 맞춤. 스냅샷 + 패치 방식은 기각(ADR 후보 19-A4) |
| P-08 | 휘발 스트림은 별도 알림(`stream.chunk`)으로 보내고 seq를 붙이지 않는다. 실행(run)마다 조각 번호 `n`과 텍스트 `offset`을 붙여 유실과 중복을 알 수 있게 하고, 유실되면 `run.partial`로 현재 조각 상태를 다시 받는다 | [제안]. pi-cases-notes §12.1-6. happy-agent가 델타를 커서 공간에 섞어 재접속 범위를 줄인 문제를 피한다 |
| P-09 | 명령은 domain action마다 메서드 하나를 둔다(generic `execute` 없음). 모든 명령은 `idempotencyKey`(`ik_<ULID>`)가 필수다. 모든 명령은 `basisSeq`(화면 기준 seq)도 필수이고, 커널이 대상 레코드의 `revisionSeq`와 비교한다(09 §3.9.4, 판정 J-79). 메서드 params는 TypeBox 상수로 정의하고 10 payload로 바꾸는 규칙을 메서드마다 둔다(§3.7.9) | [제안]. canon-3 §6.10.1, canon-2 L14, 10 §3.3.4, 20 APP-D09, 21 UI-D02 |
| P-10 | 요청 하나에 응답 하나. 오래 걸리는 일은 `accepted`로 바로 답하고 진행은 이벤트로 알린다 | [제안] |
| P-11 | 느린 소비자는 휘발 스트림부터 버리고, 그래도 넘치면 연결을 닫는다. 영속 이벤트는 몰래 버리지 않는다. 클라이언트는 재접속해 자기 위치부터 다시 받는다 | [제안]. S4 openclaw-gateway §1.5, paseo §3, happy-agent 조사 §7 |
| P-12 | 생존 확인은 WebSocket ping(서버가 보냄)과 앱 수준 `tick` 알림을 함께 쓴다. 클라이언트는 `tick`을 기준으로 감시 타이머를 둔다 | [제안]. happy-agent에는 클라이언트 쪽 무응답 감지가 없다(happy-agent 조사 §6). 웹뷰 JavaScript는 WebSocket ping을 볼 수 없다 [지식] |
| P-13 | 큰 데이터는 같은 리스너의 HTTP로 주고받는다. 업로드는 원시 바이트(청크 이어 올리기 가능) → 1회용 `blobId`, 다운로드는 기기 토큰 헤더 또는 WebSocket 연결에 묶인 5분 티켓 + Range. WebSocket 메시지에 base64 파일을 싣지 않는다 | [제안: 결정 31 기본값] + 세부 [제안](pi-cases-notes §12.1-8: happy-agent 업로드, openclaw 티켓, pi-web id 참조) |
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
| canon-3 §10/19: 알림 이벤트는 질문 전달 방식의 결과로만 보낸다(기록과 전달 분리) | 반영. 앱의 OS 알림은 전달 결정이 기록된 영속 이벤트 `question.delivered`를 받았을 때만 띄운다. 휴대폰 Web Push(결정 47·48)도 같은 전달 결정의 결과로만 나간다(26 §3.4.3) | §3.8.3, §3.17 |
| canon §21/19: C8 client contract와 adapter protocol 분리, 독립 acceptance test | 반영. 이 문서는 클라이언트 계약만 다루고 적합성 테스트를 따로 둔다 | §1.3, §6.3 |
| canon §21/19: Return Brief는 마지막 확인 cursor 이후, projection은 Event cursor를 가진다. 사용자별 마지막 확인 cursor를 프로토콜에 둔다 | 반영. `brief.acknowledge { upToSeq }`. 기기별이 아니라 사람(소유자) 단위 | §3.7.5 |
| canon §21/19: Client는 domain validation이나 정본 state를 별도로 소유하지 않는다 | 반영. 서버가 params를 엄격히 검증하고, 클라이언트는 형식 검사만 한다. 클라이언트 저장소는 사본이다 | §3.12, §3.14 |
| canon §21/19: public API 이름은 Product Domain 이름 우선 | 반영(변경 근거 있음). P06 MUST의 Product Domain 이름 대신 브리프 이름을 쓰는 결정과 근거는 08 A08-5다. 메서드 이름은 그 08 이름(Goal, Concern, question, agreement, result, choice, objection)을 따른다 | §3.7 |
| canon §21/19: 예외·막힘 상태 문구에 필요한 데이터(권한 부족 사유, 가능한 다음 행동) | 반영. 오류 `data.details`에 `reason`, `nextActions` | §3.3.3 |
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
          ├ 모바일 PWA(26): 브라우저 WebSocket(`@helm/client/browser`, 쿠키 토큰)
          └ TUI·CLI·테스트: Node ws (TCP 또는 ws+unix)
              │  WebSocket 텍스트 메시지 1개 = JSON-RPC 메시지 1개, 파일은 HTTP
  ┌───────────┴─────────── 경로 ─────────────────────────────────────────────────────┐
  │ (a) WSS : 클라이언트 → tailnet → Windows `tailscale serve`(TLS) → 127.0.0.1:P_serve │
  │ (b) SSH : 클라이언트 `ssh -W 127.0.0.1:P_lo` → WSL sshd(direct-tcpip) → 127.0.0.1:P_lo│
  │ (c) 로컬: WSL 안의 TUI·CLI → Unix 소켓                                             │
  └───────────┬─────────────────────────────────────────────────────────────────────┘
데몬 (@helm/daemon)
  ├ 리스너: tailnet(TCP) / loopback(TCP) / local(Unix 소켓) ── 전송 조건 검사(18) 뒤 연결을 넘김
  ├ 모바일 정적 서빙(/m/*)·쿠키 페어링(tailnet만, 26 §3.3.2), Web Push 송신기(26 §3.4)
  ├ 연결 처리기: 챌린지, hello, 인증 판정(18의 검증 함수), 연결 상태, 송신 큐·백프레셔, tick
  ├ 디스패처: 메서드 등록 표로 params 검증 → scope 검사 → 처리기 → 응답
  ├ 구독 관리자: 이벤트 구독(로그 읽기·재전송·실시간), 휘발 스트림 구독
  ├ 뷰 처리기: view.get → 투영(12) 읽기, asOfSeq·dependsOn 붙이기
  ├ 명령 어댑터: 메서드 params → 10 payload 변환(§3.7.9) → engine.submit(06 EngineInput) → 커널 → 응답
  └ HTTP 파일 처리기: 업로드, Range 다운로드, 티켓
```

- 리스너는 바이트 스트림과 HTTP 요청을 받아 "전송 조건을 통과한 연결"만 연결 처리기에 넘긴다. 전송 조건(Tailscale 신원 헤더 확인, Host·Origin 검사, 소켓 권한)은 18이 정한다. 이 경계는 pi-server의 `ServerListener`와 같은 구조다(pi-api-facts-2 §4.2, `server/src/listener.ts:3-8`).
- 연결 처리기 위의 모든 것은 리스너 종류를 모른다. 리스너 종류는 연결 정보(`listener`)로만 전달되고, 인증 방식 허용 여부(§3.4.3)와 감사 기록에만 쓰인다. 멱등 키와 지문에도 리스너·연결은 들어가지 않는다(§3.9.2). 그래서 세 경로의 메시지와 재전송 의미가 같다(결정 38).

### 3.2 전송

#### 3.2.1 리스너 [제안]

| 리스너 | 주소(번호와 경로는 17) | 받는 경로 | 전송 조건(18이 확정) | 받는 인증 방식(§3.4.3) |
|---|---|---|---|---|
| `tailnet` | `127.0.0.1:7840` TCP(17 D17-09). `tailscale serve`(Windows 쪽 8448, 17)의 대상으로만 쓴다(`serve.table` 한 줄) | (a) WSS, 휴대폰 | Tailscale 신원 헤더 확인(`tailscale whois` 대조, S4 openclaw-gateway §2.5), Host 검사, 갈래별 Origin 검사(18 §3.4.3) | `deviceToken`(헤더 또는 모바일 쿠키) |
| `loopback` | `127.0.0.1:7841` TCP(17 D17-09, 이하 `<HELM_LOOPBACK_PORT>`). serve 대상이 아니다 | (b) SSH | Host·Origin 허용 목록. Tailscale 헤더를 요구하지 않는다(있으면 무시한다) | `deviceToken` |
| `local` | Unix 소켓 `/run/user/<uid>/helm/rpc.sock`(17 §3.5, 이하 `<HELM_SOCKET>`. 파일 0600, 디렉터리 0700) | (c) 로컬 | 소켓 파일 권한 | `deviceToken`, `localAdmin`, `runtimeAdapter` |

- 세 리스너는 같은 HTTP 서버 코드를 쓴다(Node `http.Server` 인스턴스 셋, 같은 요청 처리기). 받는 경로는 리스너마다 다르다(§3.2.5 표의 리스너 열).
- 쿠키(`__Host-helm_dt`)는 `tailnet` 리스너의 `/rpc` 업그레이드, `/files/*`, `/m/whoami`, `/m/cmd`에서만 읽는다. `loopback`·`local`은 쿠키를 보지 않는다(18 §3.4.3 규칙 1).
- `tailnet`과 `loopback`을 나누는 이유: serve를 거친 연결만 신원 헤더를 믿는 리스너로 들어오게 하기 위해서다. SSH로 온 연결이 serve 포트로 들어오면 헤더 없는 연결을 받아 주는 예외가 생긴다.
- mirrored 네트워킹에서 두 TCP 포트는 Windows 호스트 프로세스와 WSL의 모든 프로세스(에이전트 도구 프로세스 포함)가 열 수 있다. 그래서 TCP 리스너는 `hello`가 기기 토큰으로 성공하기 전에는 `hello` 외에 아무것도 처리하지 않는다(§3.4.5). 기기 토큰은 서버 디스크에 두지 않는다(18에 대한 요구).

#### 3.2.2 경로 (a): Tailscale serve를 거친 WSS [결정 21, 47] [제안: 결정 26 기본값]

- 주소: `wss://<서버 MagicDNS 이름>:<serve 포트>/rpc`(예: `wss://server.<tailnet>.ts.net:<포트>/rpc`, 20 §2.2). TLS는 `tailscale serve`가 끝내고 데몬은 평문 HTTP/WebSocket을 받는다.
- 업그레이드 요청 헤더:
  - `Sec-WebSocket-Protocol: helm-jsonrpc` (없으면 HTTP 400으로 거절. 프로토콜 버전은 `hello`에서 정한다)
  - 기기 토큰은 두 운반 방식 중 하나로 싣는다(P-03). 판정은 `hello`에서 한다.

| 운반 방식 | 쓰는 클라이언트 | 업그레이드 요청 | 받는 리스너 | Origin 규칙 |
|---|---|---|---|---|
| `header` | 데스크톱(Rust 전송, 20 APP-D02), TUI·관리 CLI의 기기 토큰 | `Authorization: Bearer <기기 토큰>` | `tailnet`, `loopback`, `local` | `Origin`이 있으면 403(`origin_not_allowed`). 데스크톱 Rust 전송은 `Origin`을 보내지 않는다. 개발 데몬만 예외 목록을 둔다(18 §3.4.3) |
| `cookie` | 모바일 PWA(결정 47, 26 §3.3.3) | 브라우저가 `Cookie: __Host-helm_dt=<기기 토큰>`을 자동으로 싣는다. 스크립트는 토큰을 읽지 못한다(HttpOnly) | `tailnet`만 | `Origin`이 17 `auth.allowedOrigins` 목록(기본값 `[publicOrigin]`, 판정 J-154)의 값과 정확히 같아야 한다. 없거나 다르면 403(`origin_mismatch`). 브라우저 WebSocket 업그레이드는 `Origin`을 항상 싣는다 [지식] |

  - 한 요청에 둘 다 있으면 헤더를 쓰고 쿠키를 무시한다.
  - 쿠키 토큰의 기기는 `/m/pair`로 페어링된 기기(08 Device `credentialCarrier: "cookie"`)여야 하고, 헤더 토큰의 기기는 `credentialCarrier: "header"`여야 한다. 다르면 `hello`에서 `1008`(`carrier_mismatch`)다. 데스크톱 토큰을 브라우저로, 모바일 토큰을 헤더로 쓰는 경로를 막는다(18 §3.4.3 규칙 3).
  - `helm-bearer.<토큰>` 하위 프로토콜은 정식 데몬이 받지 않는다. 와도 무시하고 다른 갈래의 규칙으로 판정한다(헤더·쿠키가 없으면 401). 가짜 데몬(`@helm/protocol/testing`)의 시험 브라우저 전송에만 남긴다(18 §3.4.4, 판정 J-82·J-118). 이유는 토큰이 스크립트 메모리에 있어야 하고 프록시 로그에 하위 프로토콜 값이 남을 수 있기 때문이다.
  - 토큰 형식(`helm_dt_` + base64url 43자, 18 §3.8.1)이 틀리면 업그레이드 단계에서 401로 끝낸다. 해시 조회·폐기·만료 판정은 `hello`에서 한다(18 §3.4.3 규칙 6).
- 업그레이드 전 검사(18 §3.4.3 `preflight`): `Host`가 허용 목록(`tailnet`은 설정의 공개 호스트 `server.<tailnet>.ts.net:8448`, `loopback`은 `127.0.0.1:7841`·`localhost:7841`)에 없으면 403(DNS rebinding 방어, 어느 리스너든 같은 코드 하나), 위 표의 Origin 규칙이 실패하면 403, Tailscale 신원 확인이 실패하면 401, 토큰이 없거나 형식이 틀리면 401, 인증 전 연결 수 초과면 429.
- 클라이언트는 업그레이드 단계의 401·403을 인증 계열 실패로 보고 자동 재접속을 멈춘다(§3.10.3, 20의 `http_unauthorized`). 브라우저 `WebSocket`은 업그레이드 응답의 HTTP 상태를 스크립트에 알려 주지 않고 `open` 전에 닫히면 1006만 보인다 [지식]. 그래서 `@helm/client/browser`는 `open` 전 1006에서 `GET /m/whoami`로 원인을 가린다(§3.14).

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
- `localAdmin`의 사람 결정 권한(판정 J-135, 18 §3.5 규칙 6): TUI는 `interactive: "tui"`로 hello하고 화면의 결정 버튼이 확인 단계다. 관리 CLI는 표준 입력·출력이 모두 터미널일 때만 `interactive: "tty_cli"`로 hello하고, 사람 결정 명령마다 `localConfirm.request`로 받은 4자 확인 문자열을 사람이 쳐서 `localConfirm`에 싣는다. 그 밖(`interactive: null`)은 읽기·관리만 한다. 같은 uid 프로세스가 의사 터미널로 이 확인을 통과하는 한계는 18 §3.5 규칙 7에 있다.
- 보안 전제(13·18에 대한 요구, §5.2): 에이전트가 실행하는 도구 프로세스(bash 등)는 `<HELM_SOCKET>`을 열 수 없어야 한다. 그렇지 않으면 모델이 도구로 소켓에 붙어 사람 명령(결과 확인 등)을 보낼 수 있어 결정 14와 불변조건이 깨진다. 소켓 파일 권한만으로는 같은 사용자 프로세스를 막지 못한다(Paseo도 같은 한계를 문서에 적었다, S4 paseo §4 `SECURITY.md:53`). 도구 프로세스를 다른 uid로 돌리거나 소켓 디렉터리가 보이지 않는 격리 안에서 돌려야 한다.

#### 3.2.5 HTTP 경로 목록 [제안]

리스너마다 받는 경로가 다르다. 정본 검사 순서(Host → Origin → 신원 → 자격)는 18 §3.4.3 `preflight`다. "hello 전" 열이 예인 경로는 WebSocket `hello`와 무관한 HTTP 요청이라 §3.4.5의 인증 전 제한을 받지 않는다(18 §3.4.1 표와 같다).

| 메서드·경로 | 용도 | 리스너 | 인증 | hello 전 | 절 |
|---|---|---|---|---|---|
| `GET /rpc` (Upgrade: websocket) | JSON-RPC 연결 | 셋 다 | 전송 조건 + 토큰(헤더·쿠키) + `hello` | - | §3.4 |
| `GET /healthz` | 연결 진단. 본문과 HTTP 코드는 17 §3.11.3(`{"status": …}` 하나, 버전·기기 정보 없음) | 셋 다 | 전송 조건만 | 예 | §3.10 |
| `GET /m/`, `GET /m/<경로>`, `GET /m/assets/<해시 이름>`, `GET /m/sw.js`, `GET /m/manifest.webmanifest` | 모바일 PWA 정적 묶음(결정 47). 확장자 없는 경로는 `index.html`. 헤더·캐시·쿠키 조건은 18 §3.4.6이 정본이다 | `tailnet` | 전송 조건만. 쿠키를 읽지 않는다 | 예 | 18 §3.4.6 |
| `POST /m/pair` | 모바일 페어링. 기기 속성은 서버가 정한다(`clientKind: "mobile"`, `platform: "ios"`, `credentialCarrier: "cookie"`, 본문의 같은 이름 값은 무시). 성공하면 `Set-Cookie: __Host-helm_dt=…`, 본문 `{serverId, deviceId, tokenExpiresAt}`. 토큰은 본문에 없다 | `tailnet` | 페어링 코드(본문) + 전송 조건 + Origin 정확 일치 | 예 | §3.7.7, 26 §3.3.4 |
| `GET /m/whoami` | `{serverId, deviceId, deviceName, tokenExpiresAt}` 또는 401(`reason`: `unauthenticated` \| `revoked` \| `expired` \| `node_mismatch` \| `carrier_mismatch`, 18 §3.4.3 `cookieAuth`). 브라우저 전송의 실패 원인 판정에도 쓴다(§3.10.2) | `tailnet` | 쿠키 + (Origin 정확 일치, 또는 Origin 없음 + `Sec-Fetch-Site: same-origin`) | 예 | §3.10.2 |
| `POST /m/logout` | 쿠키 지우기(`Max-Age=0`)와 `Clear-Site-Data: "cache", "storage"`. 기기 폐기는 하지 않는다 | `tailnet` | Origin 정확 일치 | 예 | 26 §3.3.5 |
| `POST /pair` | 데스크톱 페어링 코드로 기기 토큰 발급(`credentialCarrier: "header"`, `clientKind: "mobile"`은 받지 않는다) | `tailnet` | 페어링 코드(본문) + Tailscale 신원. `Origin`이 있으면 403 | 예 | §3.7.7 |
| `POST /devices/self/rotate` | 현재 기기 토큰 교체(2차 기능, 18 §3.8.3) | `tailnet`·`loopback` | 현재 기기 토큰(헤더). `Origin`이 있으면 403 | - | §3.7.7 |
| `POST /m/cmd` | 휴대폰의 진행 중 명령 하나를 HTTP로 보낸다. 화면이 꺼지기 직전 `fetch(…, { keepalive: true })`로 보내는 용도(26 §3.3.5) | `tailnet` | 쿠키 + Origin 정확 일치 | - | §3.9.4 |
| `POST /files/u`, `HEAD /files/u/<uploadId>`, `PATCH /files/u/<uploadId>` | 업로드(한 번에, 또는 청크 이어 올리기) | `tailnet`·`loopback`·`local` | 헤더 토큰, 또는 쿠키 + Origin 정확 일치(`tailnet`) | - | §3.11.3 |
| `GET /files/b/<blobId>` | 다운로드(Range 지원). `?variant=thumb\|display`로 이미지 판 | `tailnet`·`loopback`·`local` | 헤더 토큰, 또는 쿠키 + (Origin 정확 일치, 또는 Origin 없음 + `Sec-Fetch-Site: same-origin`) | - | §3.11.2 |
| `GET /files/t/<ticket>` | 티켓 다운로드(Range 지원). 헤더를 붙일 수 없는 곳용 | 셋 다 | 티켓(경로) | - | §3.11.2 |

- Origin 정확 일치는 스킴·호스트·포트까지 같아야 한다. 같은 호스트의 다른 포트(8443~8447)에서 온 요청도 403이다(26 §3.3.3 X-16).
- 기능 플래그 `clients.mobile`(23, 기본 꺼짐)이 꺼져 있으면 `/m/*` 경로는 모두 404이고 휴대폰 페어링도 받지 않는다(26 §3.3.2).
- 위 표에 없는 경로는 404다. 정적 파일은 `/m/*`만 서빙한다(모바일 PWA, 결정 47). 데스크톱 앱은 자기 번들을 쓰고 데몬은 데스크톱 SPA를 서빙하지 않는다(20 APP-D06). `loopback`에서 `/m/*`·`/pair`는 404다.
- 모든 HTTP 응답에 `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`를 붙인다. 파일 내용이 아닌 응답(`/m/*` 정적 응답은 뺀다)은 `Cache-Control: no-store`(experimental.v0 서버의 기본값, canon-2 §8.4·§8.7)다. `/m/*` 정적 응답의 헤더·캐시 값은 18 §3.4.6이 정본이다(위 표 `/m/` 행). 파일 응답 헤더는 §3.11.2.
- `/pair`·`/devices/self/rotate`는 응답 본문에 토큰이 실리므로 `Origin`이 있으면 모바일 출처라도 403이다. 브라우저에서 오는 페어링은 `/m/pair`만 받는다(18 §3.4.3 규칙 4).
- 데스크톱 앱은 데몬과 같은 출처가 아니다. Rust가 요청을 보내므로 CORS 응답 헤더는 두지 않는다(20 §3.1: 웹뷰는 데몬에 직접 연결하지 않는다). 모바일 PWA는 같은 출처라 CORS가 필요 없다.
- 접근 로그에는 `/files/t/<ticket>`의 티켓 값을 `/files/t/***`로 가리고, `Authorization`·`Cookie` 헤더를 남기지 않는다.

#### 3.2.6 WebSocket 닫는 코드

| 코드 | 보내는 쪽 | 뜻 | 클라이언트 동작 |
|---|---|---|---|
| 1000 | 양쪽 | 정상 종료(클라이언트 `stop()`, 서버의 정상 연결 정리) | 사용자가 닫은 경우만 재접속하지 않는다 |
| 1001 | 서버 | 데몬 종료·재시작(`server.shutdown` 알림 뒤) | 백오프 재접속. `restartExpectedMs`를 하한으로 쓴다 |
| 1002 | 서버 | JSON-RPC 이전 단계의 프로토콜 위반(마스킹 없는 프레임 등) | `needsUser`(버그 보고 대상) |
| 1003 | 서버 | 바이너리 메시지 수신 | `needsUser` |
| 1006 | (전송 계층) | 닫는 프레임 없이 끊김 | 백오프 재접속. 브라우저 전송에서 `open` 전이면 §3.14의 `whoami` 판정 |
| 1008 | 서버 | 정책 위반: 인증 실패, 폐기된 기기, 인증 전 제한 위반 | 닫기 직전에 받은 오류의 `kind`로 판단. 없으면 `needsUser` |
| 1009 | 양쪽 | 메시지가 크기 한도를 넘음 | 백오프 재접속(같은 요청을 다시 보내지 않는다) |
| 1011 | 서버 | 내부 오류 | 백오프 재접속 |
| 1012 | 서버 | 서비스 재시작(17 §3.4.3이 1001 대신 쓸 수 있다) | 1001과 같다 |
| 4000 | 클라이언트 | `tick` 감시 시간 초과 | 백오프 재접속 |
| 4001 | 서버 | 핸드셰이크 시간 초과 | 백오프 재접속 |
| 4008 | 서버 | 느린 소비자(§3.5.8) | 바로 재접속(첫 대기 0), 위치부터 재전송 |
| 4009 | 서버 | 연결 강제 종료(`connection.close`, 기기 폐기·만료 직후, 기기당 연결 수 초과) | 직전 `connection.closing.kind`가 `auth.revoked`면 `needsUser`(사유별 처리는 §3.14), `replaced`면 백오프 |
| 그 밖(1013·1014, 모르는 4xxx) | 서버 | 이 표에 없는 코드 | 백오프 재접속. 진단 로그에 코드를 남긴다 |

### 3.3 Envelope

#### 3.3.1 JSON-RPC 2.0 규칙 [제안: 결정 31 기본값, 세부 제안]

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
import { Type, type Static, type TSchema } from "typebox";   // typebox 1.3.27, import 형태는 07 §3.11.8 [실험]

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
- 사람 연결(채널 `human_client`)의 명령이면 접수 단계가 명령 봉투의 `clientKind`(08 `ClientKind`)를 채운다. 값은 인증된 연결의 기기 레코드 `clientKind`와 같다(§3.9.4). 휴대폰 결과 확인 검사([판정 J-203])가 이 값을 쓴다.

#### 3.3.2 서버 → 클라이언트 알림 형식

모든 서버 알림은 JSON-RPC 알림이고, `params`에 알림별 객체를 담는다. 알림 목록과 payload는 §3.8에 있다. 공통 규칙:

- 한 연결 안에서 서버가 보낸 메시지(응답과 알림)는 보낸 순서대로 도착한다(WebSocket·TCP 순서 보장). 프로토콜은 이 순서를 계약으로 쓴다(§3.5.9).
- 구독에서 나온 알림은 `params.sub`에 구독 ID를 담는다. 클라이언트는 모르는 구독 ID의 알림을 버린다(해제 직후 경합).
- 클라이언트는 모르는 알림 이름을 무시하고, 아는 알림의 모르는 필드도 무시한다(§3.12).

#### 3.3.3 오류 객체

`JsonRpcError`·`HelmErrorData`의 스키마는 §3.3.1이다. `details`의 공통 필드:

```ts
export const NextAction = Obj({
  action: Type.String({ minLength: 1, maxLength: 96 }),   // 메서드 이름 또는 화면 이동 의도. 예: "view.get", "objection.file", "open:SCR-CONNECT"
  label: Type.Optional(Type.String({ maxLength: 200 })),  // 서버가 줄 수 있으면 한국어 짧은 문구(결정 37). 없으면 05가 kind로 만든다
  params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export const ErrorDetailsCommon = Obj({
  reason: Type.Optional(Type.String({ maxLength: 96 })),   // 커널 거부 코드 등 하위 이유(10 §3.4.4 이름)
  ruleId: Type.Optional(Type.String({ maxLength: 32 })),   // 10 규칙 ID 또는 08 R-xx. 05 문구의 {rule} 인자
  nextActions: Type.Optional(Type.Array(NextAction, { maxItems: 8 })),   // 05 문구의 {fix} 인자
});
// 실제 details는 ErrorDetailsCommon에 표(§3.3.4)의 details 열 필드를 더한 열린 객체다
```

- 알 수 없는 예외는 `-32603 internal`로 바꾸고 `message`를 `"Internal error"`로 둔다. 원인은 데몬 로그에만 남기고 `traceId`로 연결한다(pi-server `server.ts:512-521`의 오류 정제와 같은 원칙).
- 화면 문구는 `kind`, `details.reason`, `details.ruleId`, `details.nextActions`로 05·21이 만든다. `message`를 화면에 그대로 보이지 않는다. 05 문구 키의 이름 규칙과 키 목록은 05가 정하고, 이 표의 모든 `kind`와 §3.3.5의 모든 `reason`에 키가 있어야 한다(05에 요구).

#### 3.3.4 오류 코드 전체 표 [제안]

JSON-RPC 표준 코드는 표준 뜻 그대로 쓰고, Helm 코드는 1000~5999 양의 정수를 영역별로 나눈다. JSON-RPC 예약 범위(-32768~-32000)에는 표준 다섯 개만 쓴다. 이 표가 프로토콜 오류의 정본이다. 클라이언트가 진행 중 명령함의 항목을 지울지 정하는 "저장" 열은 §3.9.2의 결과 저장 규칙에서 온다(예: 같은 키로 다시 보내면 같은 결과가 온다).

| code | kind | retryable | 저장 | 뜻 | details |
|---|---|---|---|---|---|
| -32700 | `jsonrpc.parseError` | false | - | JSON으로 읽을 수 없다 | - |
| -32600 | `jsonrpc.invalidRequest` | false | - | envelope 위반, 배치, id 형식 위반, 진행 중 id 재사용, 깊이·길이 한도 초과 | `issue` |
| -32601 | `jsonrpc.methodNotFound` | false | - | 모르는 메서드 또는 이 연결의 프로토콜 버전에 없는 메서드 | `method` |
| -32602 | `jsonrpc.invalidParams` | false | - | params 스키마 위반 | `issues: {path, message}[]` |
| -32603 | `internal` | true | - | 내부 오류(정제됨). 명령이면 같은 멱등 키로 다시 보내 결과를 확인한다 | - |
| 1001 | `handshake.required` | false | - | `hello` 전에 다른 메서드를 불렀다 | - |
| 1002 | `handshake.duplicate` | false | - | `hello`를 두 번 보냈다 | - |
| 1003 | `protocol.unsupported` | false | - | 공통 프로토콜 버전이 없다. 앱 또는 데몬 업데이트가 필요하다 | `serverMin`, `serverMax`, `serverVersion`(데몬 semver) |
| 1004 | `auth.failed` | false | - | 토큰 형식·해시 조회·해시 대조·증명 중 하나가 맞지 않는다. 기기가 있는지 알려 주지 않으려고 이 넷을 나누지 않는다(18 §3.4.5) | - |
| 1005 | `auth.revoked` | false | - | 폐기됐거나 토큰이 만료된 기기다(18 §3.8.2: 절대 365일, 유휴 90일) | `reason`: `revoked` \| `expired_absolute` \| `expired_idle`, `revokedAt?`, `expiredAt?` |
| 1006 | `auth.unknownDevice` | false | - | 예약. 토큰 경로에서는 쓰지 않는다(18 §3.4.5. 1004로 낸다) | - |
| 1007 | `auth.challengeStale` | true | - | 챌린지 nonce 불일치, 서명 시각 허용 범위 밖. 다시 연결하면 새 챌린지를 받는다 | `serverTime` |
| 1008 | `auth.methodNotAllowed` | false | - | 이 리스너에서 받지 않는 인증 방식, 토큰의 기기와 `hello`의 기기 ID가 다름, tailnet 노드 불일치, 운반 방식 불일치(18 §3.6.1) | `listener`, `reason`: `method_not_allowed` \| `device_mismatch` \| `node_mismatch` \| `carrier_mismatch` |
| 1009 | `pairing.invalidCode` | false | - | 페어링 코드가 틀렸거나 만료·사용·소진됨(`POST /pair`·`/m/pair` 응답 본문). 사유를 구분하지 않는다(18 §3.7.4, 판정 J-81). 감사 기록에만 사유가 남는다 | - |
| 1010 | `scope.forbidden` | false | - | 연결에 그 메서드(또는 그 값)의 scope가 없다(§3.4.6) | `required`, `field?`, `value?` |
| 1011 | `rateLimited` | true | - | 요청이 너무 잦다: 인증 실패 지연 상한, 페어링 시도, 명령 속도(연결당 초당 20, 순간 100), 대기 업로드 합계·업로드 세션 수 | `retryAfterMs` 필수, `limit?` |
| 1012 | `confirm.required` | false | - | `local` 리스너의 `tty_cli` 연결이 사람 결정 명령에 유효한 `localConfirm`을 싣지 않았다(18 §3.5 규칙 6, 판정 J-135) | `reason`: `missing` \| `mismatch` \| `expired` \| `used` |
| 2001 | `replay.outOfRange` | false | - | `from` 위치에서 재전송할 수 없다. 스냅샷 경로로 간다(§3.5.5) | `reason`: `storeMismatch` \| `beforeOldest` \| `tooFar` \| `aheadOfHead`, `storeId`, `headSeq`, `oldestReplayableSeq` |
| 2002 | `subscription.notFound` | false | - | 없는(이미 해제된) 구독 ID | `sub` |
| 2003 | `subscription.limit` | false | - | 연결당 구독 수 한도 초과 | `max` |
| 2004 | `view.unknown` | false | - | 모르는 뷰 이름 | `view` |
| 2005 | `view.targetNotFound` | false | - | 뷰·`record.locate` params가 가리키는 레코드가 없다 | `id` |
| 2006 | `view.notReady` | true | - | 투영이 요청한 `minSeq`에 아직 이르지 않았다 | `asOfSeq`, `minSeq` |
| 2007 | `filter.invalid` | false | - | 이벤트 필터가 잘못되었다 | `issue` |
| 2008 | `run.notFound` | false | - | 실행 ID가 없거나 이미 끝났다 | `runId` |
| 3001 | `command.rejected.content` | false | 예 | 커널이 내용 때문에 거부했다(§3.3.5) | `reason`(10 코드), `ruleId`, `missing`, `nextActions`, `kernelMessage`, `rejectionEventSeq?` |
| 3002 | `command.rejected.authority` | false | 예 | 커널이 자격 때문에 거부했다(10 `denied.*`, `basis` A 또는 P) | `reason`, `ruleId`, `basis`, `missing`, `nextActions` |
| 3003 | `command.rejected.path` | false | 예 | 커널이 경로 때문에 거부했다(10 `path.*`). 프로토콜 계층이 채널을 고정하므로 정상 클라이언트에서는 나오지 않는다. 버그 보고 대상 | `reason` |
| 3004 | `command.revisionConflict` | false | 예 | 대상 레코드의 `revisionSeq`가 `basisSeq`(또는 `expect`)보다 뒤다(10 `conflict.version_mismatch`). 화면을 새로 받아 다시 판단해야 한다 | `subject`, `basisSeq`, `currentRevisionSeq`, `rebase`(10의 대상 현재 요약) |
| 3005 | `command.targetNotFound` | false | 예 | 명령 대상 레코드가 없다(10 `not_found.record` 중 명령 대상) | `targetId` |
| 3006 | `idempotency.keyReused` | false | 아니요 | 같은 멱등 키로 다른 내용을 보냈다(10·09 `conflict.idempotency_key_reuse`, 06 `key_reused`) | `originalCommandId` |
| 3007 | `command.inProgress` | true | 아니요 | 같은 멱등 키의 첫 요청이 아직 처리 중이고 응답 대기 시간을 넘었다 | `retryAfterMs` |
| 3008 | `command.alreadyResolved` | false | 예 | 대상이 이미 끝난 상태다(10 `conflict.already_resolved`: 질문이 이미 답해짐·가정 확정·철회·만료, 결과가 이미 확인됨). 다른 기기나 자동 처리가 먼저 했다. 같은 질문 경합은 먼저 커밋된 쪽의 효과에 따라 3008 또는 3004가 된다 | `target`(`RecordRef`), `resolvedAtSeq`, `resolvedAt`(ISO), `resolvedBy`(행위자 문자열), `resolvedVia`(`deviceId`가 있으면 그 기기), `outcome`: `answered` \| `assumed` \| `withdrawn` \| `expired` \| `accepted`, `assumedValue?`(가정 확정이면 확정된 답 값), `nextActions`(가정 확정이면 `objection.file`) |
| 3009 | `command.superseded` | false | 예 | 대상이 새 판으로 대체됐다(10 `conflict.superseded`: 합의 개정, 질문 다시 쓰기, 결과 재제출). 새 대상을 보고 다시 판단해야 한다 | `target`(`RecordRef`), `supersededBy`(`RecordRef`), `supersededAtSeq` |
| 4001 | `blob.tooLarge` | false | - | 파일 크기가 한도를 넘는다 | `maxBytes` |
| 4002 | `blob.notFound` | false | - | 없는 파일 ID | `blobId` |
| 4003 | `upload.notFound` | false | - | 없거나 만료된 업로드 | `uploadId` |
| 4004 | `upload.incomplete` | true | - | 요청 본문이 선언한 길이보다 짧게 끝났다(연결 끊김). `HEAD`로 위치를 받아 이어 올린다 | `receivedBytes`, `size` |
| 4005 | `upload.hashMismatch` | false | - | 받은 내용의 SHA-256이 선언과 다르다 | `expected`, `actual` |
| 4006 | `ticket.limit` | true | - | 연결당 티켓 수 한도 초과 | `max`, `retryAfterMs` |
| 4007 | `blob.gone` | false | - | 보존 정책 가지치기나 비밀 가림으로 내용이 지워졌다(HTTP 410 본문) | `reason`: `pruned` \| `redacted` |
| 5001 | `daemon.draining` | true | 아니요 | 데몬이 종료 중이다. 쓰기 소유권을 잃은 경우(`path.fenced`)도 같다 | `retryAfterMs` |
| 5002 | `daemon.busy` | true | 아니요 | 연결당 동시 요청 한도 초과, 또는 일시 과부하(SQLite 바쁨 시간 초과 등) | `retryAfterMs` |
| 5003 | `daemon.readOnly` | false | 아니요(적용 안 됨이 확정) | 데몬이 읽기 전용이다. 조회만 된다(17 §3.4.1) | `mode`, `since`, `reasons`(`ModeReason[]`) |
| 5004 | `request.cancelled` | false | 아니요 | `$/cancelRequest`로 취소했다(명령이면 적용되지 않았다) | - |
| 5005 | `request.timeout` | true | - | 서버 쪽 처리 시한을 넘었다(조회에만 쓴다. 명령은 §3.9.2) | - |
| 5006 | `runtime.unavailable` | true | 아니요 | 실행 제어 대상 런타임이 응답하지 않는다 | `retryAfterMs` |
| 5007 | `feature.disabled` | false | 아니요 | 메서드는 알지만 이 데몬 설정에서 꺼져 있다(예: 푸시 VAPID 키 없음) | `feature` |

#### 3.3.5 10 거부 코드 → 프로토콜 결과 대응 [제안]

10 §3.4.4의 결과 상태와 코드가 프로토콜 결과를 정한다. 06 `SubmitResult`의 상태 이름을 쓴다(06 §3.4.6).

| 06 `SubmitResult.status` / 10 코드 | 프로토콜 결과 |
|---|---|
| `accepted` | 성공 응답 `status: "applied"`(또는 오래 걸리는 접수면 `"accepted"`) |
| `needs_gate`(코드 `gate.*`, `policy.structure_cap_exceeded`) | 성공 응답 `status: "gated"`, `questionId`. 명령은 적용되지 않았고 질문이 생겼다 |
| `rejected`, 갈래 `content`(`invalid.*`, `not_found.*`, `policy.*`, `conflict.invalid_transition`·`duplicate_id`·`id_exists`·`agreement_revision_stale`·`conflict.thread_busy`[판정 J-250]) | 3001. 단 명령 대상의 `not_found.record`는 3005 |
| `rejected`, 갈래 `authority`(`denied.*`) | 3002(`basis` A·P) |
| `rejected`, 갈래 `path`(`path.*`) | 3003. 단 `path.fenced` → 5001, `path.store_read_only` → 5003 |
| `conflict` + `conflict.version_mismatch` | 3004 |
| `conflict` + `conflict.already_resolved` | 3008 |
| `conflict` + `conflict.superseded` | 3009 |
| `conflict` + `conflict.external_observation_changed` | 3001(어댑터 채널에서만 생긴다. 클라이언트 명령에서 오면 버그) |
| `key_reused` | 3006 |
| `error`(`kernel.*`, `store.*`), `invalid.event_too_large` | -32603(커널·저장소 버그로 운영 로그에 남긴다). SQLite 바쁨 시간 초과·디스크 가득 참 같은 일시 실패는 5002 |
| 14 §4.3 사례: 다이얼·설정 값 검증 실패, 없는 루프 식별자, 기능 플래그로 꺼진 루프 지정, 진입 조건이 거짓인 지정(돌릴 곳 없음), 닫힌 Concern에 지시 | 3001. 다이얼·설정 값과 루프 식별자 오류는 `reason`이 `invalid.schema`, 꺼진 루프는 `policy.plan_maturity_gate`(`missing`에 `maturity:<loop>`), 진입 조건 거짓은 `policy.loop_entry_condition`([판정 J-191]), 닫힌 Concern은 `conflict.invalid_transition`이다. 10 코드만 쓰고 임시 대응 이름은 쓰지 않는다(14 §4.3). 구조 상한은 `policy.structure_cap_exceeded`와 같이 `gated`다. 계약 데이터 적재 실패는 데몬 시작 실패라 프로토콜에 오지 않는다. |
| `policy.mobile_review_not_allowed`(10, `content`, 휴대폰에서 결과 확인 불가, [판정 J-203]) | 3001(`reason`에 이 코드). 프로토콜은 같은 사실을 먼저 검사해 F-54·CT-49처럼 1010을 내므로, 이 3001은 커널까지 간 경우에만 나온다 |
| 10 표에 없는 코드(예: 11·12가 쓴 `denied.recovery_turn`) | 접두사 규칙(`denied.*` → 3002 등)으로 대응하고 10에 표 추가를 요구한다 |

- 계획 작성 거부와 알림(10 §3.4.4, §3.8.1): `denied.plan_authoring_mode`는 `basis` P로 3002다. `policy.plan_draft_not_needed`·`policy.plan_dependency_violation`·`policy.plan_maturity_gate`는 3001이고, `reason`에 10 코드를, `missing`에 `dependency_rule:<n>`·`maturity:<loop>`를 싣는다. 알림 `notice.plan_draft_fallback`은 거부가 아니라 오류 번호가 없다. 두 번째 위반의 대체 적용은 `accepted`이므로 응답은 `applied`이고, 이 알림은 10 §3.4.5에 따라 `command.rejected`·`loop_plan.adopted`와 함께 남는다.
- 10 §3.4.5에 따라 거부는 `command.rejected` 이벤트로 남으므로 `details.rejectionEventSeq`에 그 seq를 넣는다. 10의 `Rejection.next`(`{command, hint}`)는 `details.nextActions`의 `{action: command, label: hint}`로, `Rejection.ruleId`는 `details.ruleId`로, `Rejection.missing`은 `details.missing`으로 옮긴다. 10의 `Rejection.message`(한국어, 모델용 문장)는 `details.kernelMessage`에 넣고 JSON-RPC `message`에는 넣지 않는다.
- 가정 확정 뒤 도착한 답(판정 J-120): 커널은 `conflict.already_resolved`로 거부한다. 프로토콜은 3008에 `outcome: "assumed"`, `assumedValue`(확정된 답 값, 11 `AnswerValue`), `nextActions: [{ action: "objection.file", params: { target: { kind: "record", id: <질문 qs>, itemKey: null } } }]`를 싣는다. 화면은 쓰던 답을 이의 초안으로 넘긴다(04·26).
- 합의 확정·결과 확인 질문(`agreement_confirm`, `result_review`)에 `question.answer`가 오면 커널이 `policy.answer_option_not_allowed`(3001)로 거부한다. 이 두 종류는 전용 메서드 `agreement.confirm`, `result.accept`로만 확정한다(판정 J-124).
- v0.2 실행 후보 결과 코드와의 대응(canon-2 §9.3): `invalid.protocol_request` → -32600, `invalid.protocol_method` → -32601, `invalid.command_schema` → -32602, `conflict.idempotency_key_reuse` → 3006, `conflict.expected_cursor_mismatch` → 3004(전역 커서 대신 레코드 `revisionSeq`, 09 §3.9.4), `denied.*` → 3002 또는 3003, `gate.human_*` → `gated`, `policy.*`·`invalid.*`·`not_found.*` → 3001, `runtime.not_running` → 5006. `runtime.*`의 나머지와 `provider.*`는 런타임 내부 결과라 이 프로토콜의 오류로 오지 않고 이벤트 payload(09·12)로 온다.

### 3.4 핸드셰이크

#### 3.4.1 순서

```text
클라이언트                                   데몬
  │ HTTP GET /rpc (Upgrade, Sec-WebSocket-Protocol: helm-jsonrpc,
  │               Authorization: Bearer <토큰> 또는 모바일 쿠키) ── 리스너 전송 조건(18). 실패 → HTTP 401/403
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

스키마는 TypeBox 상수로 쓰고 타입은 `Static`으로 얻는다(§3.13.2). 도우미 `Obj`·`Nullable`·`Enum`·`Id`와 ID 상수는 08 §3.4.1·§3.2의 `@helm/domain/schema`에서 가져오고, 프로토콜 공용 상수(`IsoTime`, `Pos`)는 §3.7.2에 있다.

```ts
// packages/protocol/src/handshake.ts
import { Type, type Static } from "typebox";                       // 07 §3.11.8 (typebox 1.3.27)
import { Obj, Nullable, Enum, DeviceId, RunId, ConnectionId } from "@helm/domain/schema";
import { IsoTime, Pos, ServerId, StoreId, Scope, ListenerKind, DaemonMode, ModeReason } from "./common.js";

/** 알림 "hello.challenge" (서버 → 클라이언트, 연결의 첫 메시지) */
export const HelloChallengeParams = Obj({
  nonce: Type.String({ pattern: "^[A-Za-z0-9_-]{43}$" }),       // 32바이트 무작위 base64url. 이 연결에서만 유효
  serverTime: IsoTime,                                             // 클라이언트 시계 차이 진단용
  serverId: ServerId,                                              // 데몬 설치의 고정 ID(17). 프로필에 저장된 값과 비교한다
  protocols: Obj({ min: Type.Integer({ minimum: 1 }), max: Type.Integer({ minimum: 1 }) }),
  authMethods: Type.Array(Enum(["deviceToken", "localAdmin", "runtimeAdapter"])),   // 이 리스너에서 받는 방식(§3.2.1)
  proofRequired: Type.Boolean(),                                   // 기기 서명 증명이 필요한가(18). 1차 기본값 false
});
export type HelloChallengeParams = Static<typeof HelloChallengeParams>;
```

- 클라이언트는 `serverId`가 프로필에 저장된 값과 다르면 `hello`를 보내지 않고 닫는다(다른 데몬에 붙은 것이다. pi-client의 serverId 확인과 같다, pi-api-facts-2 §5.3). 처음 연결이면 저장한다.

#### 3.4.3 클라이언트 hello

```ts
export const ClientInfo = Obj({
  kind: Enum(["desktop", "mobile", "tui", "cli", "test"]),
  version: Type.String({ minLength: 1, maxLength: 64 }),         // 앱 semver
  build: Type.Optional(Type.String({ maxLength: 64 })),           // 커밋 해시 등
  /** ios: 모바일 PWA(결정 47). 최소 판은 iOS 26이고 Android는 지원·시험 대상이 아니다(결정 49) */
  platform: Enum(["macos", "windows", "linux", "ios"]),
  instanceId: Type.String({ minLength: 8, maxLength: 64 }),      // 앱 프로세스 실행마다 새로 만드는 무작위 ID. 로그·presence 구분용
});

/** 기기 키 서명(18이 키 형식을 확정). 서명 대상은 UTF-8 문자열
 *  "helm-hello/1\n" + serverId + "\n" + nonce + "\n" + deviceId + "\n" + signedAt
 *  OpenClaw의 nonce 서명 방식을 줄인 것(S4 openclaw-gateway §2.2) */
export const DeviceProof = Obj({
  alg: Enum(["ed25519", "es256"]),                               // es256: 하드웨어 보호 키(P-256). 모바일 PWA(쿠키)는 1차에 증명을 쓰지 않는다(26 §3.3.3)
  signedAt: IsoTime,                                               // 서버 시각 ±2분(18)
  signature: Type.String({ pattern: "^[A-Za-z0-9_-]{16,256}$" }), // base64url
});

export const HelloAuth = Type.Union([
  /** 토큰 값은 JSON에 싣지 않는다. 업그레이드 요청의 Authorization 헤더 또는 모바일 쿠키(§3.2.2)로만 온다 */
  Obj({ method: Type.Literal("deviceToken"), deviceId: DeviceId, proof: Type.Optional(DeviceProof) }),
  /** local 리스너에서만. interactive: TUI이면 "tui", 표준 입력·출력이 모두 터미널인 CLI이면 "tty_cli", 그 밖은 null(18 §3.5 규칙 6) */
  Obj({ method: Type.Literal("localAdmin"), interactive: Nullable(Enum(["tui", "tty_cli"])) }),
  /** local 리스너에서만. 외부 런타임 브리지(결정 34, 18 §3.5). run 단위 단기 토큰은 Authorization 헤더로 온다 */
  Obj({ method: Type.Literal("runtimeAdapter"), runId: RunId }),
]);

export const StreamPosition = Obj({ storeId: StoreId, seq: Pos });

/** 요청 "hello" (클라이언트 → 서버, 연결의 첫 요청) */
export const HelloParams = Obj({
  protocol: Obj({ min: Type.Integer({ minimum: 1 }), max: Type.Integer({ minimum: 1 }) }),   // 클라이언트가 말할 수 있는 버전 범위
  client: ClientInfo,
  auth: HelloAuth,
  /** 클라이언트가 가진 가장 큰 이벤트 위치. 응답의 log.resume 판정 미리보기에만 쓴다. 실제 재전송은 events.subscribe의 from(§3.5.3) */
  resume: Type.Optional(StreamPosition),
  capabilities: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 64 })),  // 예: "stream.text.v1"
  locale: Type.Optional(Type.String({ maxLength: 35 })),          // BCP 47. 기본 "ko-KR"(결정 37)
  timeZone: Type.Optional(Type.String({ maxLength: 64 })),        // IANA 이름
});
export type HelloParams = Static<typeof HelloParams>;
```

판정 순서(서버):

1. 연결 상태가 `awaitingHello`인지 본다. 아니면 `1002 handshake.duplicate`.
2. `params` 스키마 검사. 실패하면 `-32602`.
3. 버전 고르기: `chosen = min(client.max, server.max)`. `chosen < max(client.min, server.min)`이면 `1003 protocol.unsupported`(details: `serverMin`, `serverMax`, `serverVersion`).
4. `auth.method`가 이 리스너의 `authMethods`에 있는지 본다. 아니면 `1008 auth.methodNotAllowed`(`reason: "method_not_allowed"`).
5. 방식별 판정(검증 함수는 18 §3.4.5가 제공한다. 이 문서는 입력과 결과 코드만 정한다):
   - `deviceToken`: 18 §3.6.1 `helloDeviceAuth`. 업그레이드 때 받아 둔 토큰(헤더 갈래 또는 쿠키 갈래)의 형식이 틀리거나, 해시 조회가 실패하거나, 해시가 맞지 않으면 언제나 `1004 auth.failed`다(기기가 있는지 알려 주지 않는다. `1006`은 토큰 경로에서 쓰지 않는다). 폐기·만료면 `1005 auth.revoked`(`reason`: `revoked`·`expired_absolute`·`expired_idle`). 토큰의 기기와 `auth.deviceId`가 다르면 `1008`(`device_mismatch`), `tailnet`에서 묶인 tailnet 노드와 다르면 `1008`(`node_mismatch`), 기기의 `credentialCarrier`와 연결의 운반 방식(헤더·쿠키)이 다르면 `1008`(`carrier_mismatch`). `proofRequired`인데 증명이 없거나 틀리면 `1004`, nonce·시각이 맞지 않으면 `1007 auth.challengeStale`.
   - `localAdmin`: `local` 리스너이면 통과한다(18 §3.6.3: 소켓 파일 권한이 근거). `interactive`는 사람 결정 명령을 받을지 정한다(§3.4.6).
   - `runtimeAdapter`: `local` 리스너에서 18이 run 시작 때 발급한 토큰을 확인한다. 실패하면 `1004`.
   - 인증 실패에는 지연을 준다. 실패를 세는 단위는 `tailnet`이면 whois로 확인된 tailnet 노드, 확인 전이면 리스너 전체 묶음이다. `X-Forwarded-For` 값만으로 출처를 막지 않는다. 같은 호스트의 프로세스가 소유자 주소를 적어 실패를 일으키면 소유자가 막히기 때문이다. 토큰이 맞는 연결은 실패 묶음과 무관하게 통과한다. 지연이 상한(1분 5회 → 60초, 10분 20회 → 10분, 18 §3.14)에 이르면 `1011 rateLimited` + `retryAfterMs`로 답한다. whois 호출이 상한을 넘으면 대기열에 두고, 시간 안에 처리하지 못하면 401로 끝낸다(18 §3.4.2·§3.14).
   - 기기당 동시 연결이 8개를 넘으면 가장 오래된 연결을 `connection.closing{kind:"replaced"}` 후 4009로 닫는다. 전체 연결이 64개면 새 업그레이드를 503으로 거절한다(18 §3.14).
6. scope 부여(§3.4.6). 연결 상태를 `ready`로 바꾸고 응답을 보낸다.
7. 기기의 `lastSeenAt` 갱신(1분에 한 번으로 묶음, 18 §3.6.1)과 `device.connected`·`device.disconnected`(09 §3.4.13) 기록. 인증 거부는 `auth.denied`로 묶어 남긴다(18 §3.13.2).

#### 3.4.4 서버 응답

```ts
export const HelloResult = Obj({
  protocol: Type.Integer({ minimum: 1 }),                          // 고른 버전
  server: Obj({
    id: ServerId,                                                  // = challenge.serverId
    version: Type.String({ maxLength: 64 }),                       // 데몬 semver
    /** 데몬 프로세스가 시작할 때마다 새로 만드는 ULID(17 §1.4). 바뀌면 "데몬이 재시작됨". 읽기 전용 시작에서도 메모리에 만든다(17에 요구) */
    bootEpoch: Type.String({ minLength: 26, maxLength: 26 }),
    startedAt: IsoTime,
    mode: DaemonMode,                                              // 17 §3.4.1이 전이를 정한다
    modeReasons: Type.Array(ModeReason),                           // readOnly·safeMode의 사유(§3.7.8). normal이면 빈 배열
  }),
  connection: Obj({
    id: ConnectionId,                                              // `cx_<ULID>`(08 §3.2)
    listener: ListenerKind,
    authMethod: Enum(["deviceToken", "localAdmin", "runtimeAdapter"]),
    carrier: Nullable(Enum(["header", "cookie"])),                // 기기 토큰 운반 방식. localAdmin이면 null
    deviceId: Nullable(DeviceId),                                  // localAdmin·runtimeAdapter이면 null
    interactive: Nullable(Enum(["tui", "tty_cli"])),              // localAdmin일 때만 값이 있다
    scopes: Type.Array(Scope),
    tailscaleLogin: Type.Optional(Type.String({ maxLength: 256 })),   // tailnet 리스너에서 18이 확인한 로그인 이름
  }),
  policy: ConnectionPolicy,
  features: Obj({
    methods: Type.Array(Type.String()),                            // 이 연결(버전·scope·데몬 설정)에서 부를 수 있는 메서드
    notifications: Type.Array(Type.String()),
    views: Type.Array(Type.String()),                              // view.get이 받는 뷰 이름(§3.7.4)
    capabilities: Type.Array(Type.String()),                       // 예: "files.chunkedUpload.v1"
    schemaHash: Type.String({ pattern: "^[0-9a-f]{64}$" }),        // 등록 표 해시. 같으면 클라이언트와 스키마가 같다
  }),
  log: Obj({
    storeId: StoreId,
    headSeq: Pos,                                                  // 지금까지 커밋된 가장 큰 seq. 이벤트가 없으면 0
    oldestReplayableSeq: Type.Integer({ minimum: 1 }),             // 보존을 줄이지 않으면 1
    resume: ResumeVerdict,                                         // params.resume에 대한 미리보기
  }),
  human: Obj({ briefAckSeq: Nullable(Pos) }),                      // brief.acknowledge의 마지막 값(사람 단위, 기기 무관)
  serverTime: IsoTime,
});
export type HelloResult = Static<typeof HelloResult>;

export const ResumeVerdict = Type.Union([
  Obj({ status: Type.Literal("notRequested") }),
  Obj({ status: Type.Literal("ok"), behind: Pos }),               // headSeq - resume.seq
  Obj({ status: Type.Literal("snapshotRequired"), reason: Enum(["storeMismatch", "beforeOldest", "tooFar", "aheadOfHead"]) }),
]);

export const ConnectionPolicy = Obj({
  maxInboundMessageBytes: Type.Integer({ minimum: 16384 }),        // 클라이언트 → 서버 메시지 상한. 기본 1 MiB
  maxOutboundMessageBytes: Type.Integer({ minimum: 65536 }),       // 서버 → 클라이언트 메시지 상한. 기본 4 MiB
  tickIntervalMs: Type.Integer({ minimum: 1000 }),                 // 기본 15,000
  clientTimeoutMs: Type.Integer({ minimum: 2000 }),                // 기본 2 × tick + 5,000 = 35,000
  maxInFlightRequests: Type.Integer({ minimum: 1 }),               // 기본 32
  commandRate: Obj({ perSecond: Type.Integer({ minimum: 1 }), burst: Type.Integer({ minimum: 1 }) }),   // 기본 20/초, 순간 100(18 §3.14)
  maxSubscriptions: Type.Integer({ minimum: 1 }),                  // 연결당 구독 수(events + stream). 기본 16
  maxReplayEvents: Type.Integer({ minimum: 1 }),                   // 한 번의 재전송 상한(headSeq - from). 기본 50,000
  replayBatchMaxEvents: Type.Integer({ minimum: 1 }),              // events 알림 하나의 이벤트 수 상한. 기본 256
  sendQueueHighWaterBytes: Type.Integer({ minimum: 1 }),           // 느린 소비자 판정(§3.5.8). 기본 8 MiB
  /** 같은 멱등 키를 같은 결과로 돌려주는 기간. 기본 365일(09 §3.15.3). 지난 행은 상태만 남는다(§3.9.2) */
  idempotencyWindowMs: Type.Integer({ minimum: 1 }),
  pendingCommandMaxAgeMs: Type.Integer({ minimum: 1 }),            // 클라이언트가 자동 재전송해도 되는 진행 중 명령의 최대 나이. 기본 24시간
  files: Obj({
    maxBlobBytes: Type.Integer({ minimum: 1 }),                    // 기본 64 MiB
    singleUploadMaxBytes: Type.Integer({ minimum: 1 }),            // 기본 8 MiB, 넘으면 청크 업로드
    uploadChunkBytes: Type.Integer({ minimum: 1 }),                // 기본 4 MiB
    downloadTicketTtlMs: Type.Integer({ minimum: 1 }),             // 기본 300,000
    stagedBlobTtlMs: Type.Integer({ minimum: 1 }),                 // 명령에서 참조되지 않은 업로드의 보관 시간. 기본 24시간
    maxStagedBytesPerDevice: Type.Integer({ minimum: 1 }),         // 기기당 대기(staged) 업로드 합계. 기본 512 MiB
    maxUploadSessionsPerDevice: Type.Integer({ minimum: 1 }),      // 기기당 동시 청크 업로드 세션. 기본 4
  }),
});
export type ConnectionPolicy = Static<typeof ConnectionPolicy>;
export declare const DEFAULT_POLICY: ConnectionPolicy;             // 위 기본값
```

- 정책 값은 클라이언트에 하드코딩하지 않고 재접속할 때마다 응답에서 다시 읽는다(OpenClaw `hello-ok.policy`, S4 openclaw-gateway §4-4).
- `features.methods`에 없는 메서드를 부르면 `-32601`이다. 클라이언트는 화면 동작을 켜기 전에 이 목록을 확인한다.
- 대기 업로드 합계나 동시 세션 수를 넘는 업로드는 HTTP 429 + `1011 rateLimited`(`details.limit: "stagedBytes" | "uploadSessions"`)다. 분실 기기나 XSS가 디스크를 채워 읽기 전용까지 끌고 가는 것을 막는다(18 §3.14에 같은 값을 요구).

#### 3.4.5 인증 전 제한 [제안]

`hello`가 성공하기 전 WebSocket 연결(`awaitingHello`)에는 다음 제한을 둔다. 근거는 OpenClaw의 사전 인증 한도(64 KiB, IP당 128연결, 큐 16, 15초, S4 openclaw-gateway §1.3)를 1인 사용에 맞게 줄인 것이다. `hello`와 무관한 HTTP 경로(§3.2.5의 "hello 전" 열)는 이 표의 대상이 아니다.

| 항목 | 값 | 넘으면 |
|---|---|---|
| 메시지 크기 | 16 KiB | 1009로 닫기 |
| 받는 메시지 | `hello` 요청 하나. 그 밖의 요청·알림 | `1001` 오류 후 1008로 닫기 |
| 응답 대기 요청 | 1 | 1008로 닫기 |
| 핸드셰이크 시한 | 업그레이드 후 10초 안에 `hello` 응답까지 | 4001로 닫기 |
| 출처별 인증 전 연결 수 | 8 | 업그레이드를 HTTP 429로 거절 |
| 인증 실패 | 지연. 상한은 1분 5회(60초), 10분 20회(10분) | `1011` + `retryAfterMs` |
| 서버가 보내는 것 | `hello.challenge`, `hello` 응답, 오류 응답만 | - |

#### 3.4.6 scope

주체별 scope는 18 §3.5가 정하고, 이 표는 scope마다 받는 메서드를 정한다. 모바일 허용 목록(18 §3.5 모바일 표, 26 §1.2·§1.3)을 메서드 이름으로 옮긴 것이 `decideMobile`과 `devicesLimited`다.

| scope | 허용 메서드 | 받는 주체(18 §3.5) |
|---|---|---|
| `read` | `ping`, `events.*`, `view.get`, `record.locate`, `search.query`, `stream.*`, `run.partial`, `presence.report`, `blob.downloadTicket`, `daemon.status`, `protocol.describe`, `command.lookup`, `device.pushConfig`, HTTP 다운로드 | 기기 전부, `localAdmin` |
| `decide` | §3.7.1 "사람 명령" 표의 모든 메서드, `composer.preview`, `localConfirm.request`, HTTP 업로드 | 데스크톱·TUI 기기, 대화형 `localAdmin`(`interactive` ≠ null) |
| `decideMobile` | §3.7.1 표의 "모바일" 열이 ✓인 메서드. 같은 메서드라도 값이나 대상 상태로 막는 것이 있다: `question.answer`의 `approve_edited`, `result.accept`의 `accept_with_conditions`·`reject`·`criteria_wrong`, `mobileReviewable`이 거짓인 결과의 `result.accept`(판정 J-139) | 모바일 기기(`clientKind: "mobile"`) |
| `devices` | `device.*`(`device.rebind` 제외), `connection.*`, `daemon.exitSafeMode` | 데스크톱·TUI 기기, `localAdmin` |
| `devicesLimited` | `device.list`, `device.revoke`(자기 기기와 다른 기기), `connection.list`, 자기 기기의 `device.registerPush`·`unregisterPush`·`testPush` | 모바일 기기 |
| `admin` | `admin.*`, `device.rebind` | `localAdmin` |
| `modelTool` | 13이 정하는 어댑터 메서드(Helm 제안 도구 제출)와 그 run 범위의 `run.partial`·`events.read` | `runtimeAdapter`(그 run만) |

- 1인 앱이므로 기기별로 줄이는 정책은 1차에 없다. 클라이언트는 `scopes`에 없는 동작을 화면에서 끈다. 휴대폰은 "데스크톱에서" 표시와 함께 비활성으로 보인다(26 §3.5.4).
- scope 위반은 `1010 scope.forbidden`이다. `details.required`에 필요한 scope, 값 때문에 막혔으면 `details.field`와 `details.value`를 싣는다(예: `{ field: "decision", value: "reject" }`).
- 사람 결정 명령은 기기 연결과 대화형 `localAdmin` 연결에서만 행위자 `human`이 된다. 비대화 `localAdmin`(`interactive: null`)은 `decide` scope를 받지 않는다(판정 J-135). `tty_cli`는 명령마다 `localConfirm`을 실어야 한다(§3.7.5). `runtimeAdapter`에는 사람 결정 명령이 없고, 보내면 커널이 `denied.channel`로 거부하기 전에 프로토콜이 `1010`으로 막는다.
- 외부 런타임 MCP 설정에는 `runtimeAdapter` 토큰만 넣는다. 기기 토큰을 넣지 않는다(18 §3.5 규칙 8, 13에 같은 문장을 요구).

#### 3.4.7 서버 연결 상태 기계

| 상태 | 사건 | 가드 | 다음 상태 | 부수 효과 |
|---|---|---|---|---|
| (없음) | 업그레이드 성공 | 전송 조건 통과 | `awaitingHello` | `hello.challenge` 전송, 10초 타이머 시작, 토큰과 운반 방식(헤더·쿠키) 보관 |
| `awaitingHello` | `hello` 요청 | 판정 성공 | `ready` | 응답 전송, 타이머 해제, tick 시작 |
| `awaitingHello` | `hello` 요청 | 판정 실패 | `closing` | 오류 응답 전송 후 1008 |
| `awaitingHello` | 다른 요청·알림 | - | `closing` | `1001` 오류 후 1008 |
| `awaitingHello` | 10초 경과 | - | `closing` | 4001 |
| `awaitingHello` | 16 KiB 초과 메시지 | - | `closing` | 1009 |
| `ready` | 요청 | 등록된 메서드, scope 있음 | `ready` | 디스패치(§3.15) |
| `ready` | `hello` 요청 | - | `ready` | `1002` 오류(연결 유지) |
| `ready` | 송신 큐 > 상한 | §3.5.8 | `closing` | 4008 |
| `ready` | 기기 폐기·토큰 만료 강제(`device.revoked`·`device.expired` 커밋) | 이 연결의 기기 | `closing` | `connection.closing{kind:"auth.revoked"}` 알림 후 4009 |
| `ready` | 데몬 종료 시작 | - | `draining` | `server.shutdown` 알림. 새 명령은 `5001` |
| `draining` | 진행 중 요청 모두 응답 또는 종료 예산 소진(17) | - | `closing` | 1001(17이 1012를 쓰면 1012) |
| `ready`·`draining` | 무수신 45초(WebSocket pong 포함) | - | `closing` | 소켓 파기(닫는 핸드셰이크 없이) |
| 모든 상태 | 소켓 닫힘 | - | `closed` | 진행 중 요청 중단(AbortSignal), 구독 해제, 티켓 무효화, presence 정리(§3.7.8) |

- 연결이 닫히면 그 연결의 구독, 응답 대기 요청, 다운로드 티켓은 모두 사라진다. 연결을 넘어 남는 것은 영속 이벤트, 멱등 결과, 기기 상태뿐이다. 재접속한 클라이언트는 자기가 가진 위치와 진행 중 명령함으로 이어 간다(pi-server도 연결을 넘는 상태를 두지 않는다, pi-api-facts-2 §4.3).
- 진행 중 명령 요청이 연결 종료로 중단되어도 커밋된 결과는 되돌리지 않는다. 클라이언트는 같은 멱등 키로 다시 보내 결과를 받는다(§3.9).

### 3.5 이벤트 순서와 재전송

#### 3.5.1 seq와 저장소 ID [제안: 결정 29·31 기본값, 세부 제안]

- 프로토콜의 seq는 09가 정본 이벤트 로그에 부여하는 전역 seq 그대로다. 프로토콜 계층은 seq를 새로 매기지 않는다. 연결별 카운터나 메모리 버퍼를 두지 않는다(사례 4곳이 모두 그렇게 해서 재시작마다 전체 재동기화가 필요했다, pi-cases-notes §12.2-1).
- seq 성질(09 D09-2): 정수, 1부터 시작, 커밋 순서대로 빈칸 없이 증가, 한 번 부여된 seq의 이벤트는 바뀌지 않는다, 데몬 재시작 뒤에도 이어진다. 프로토콜은 빈칸 없음에 기대지 않는다. 필터 구독과 `(from, to]` 계약은 빈칸이 있어도 같은 결과를 낸다.
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
// packages/protocol/src/events.ts
/** 영속 이벤트의 프로토콜 표현. 09 §3.2 EventEnvelope의 공개용 사본(redact: true, 09 §3.11.5)에서 만든다.
 *  바꾸는 것은 셋뿐이다: ms 시각 → ISO 문자열(브리프 §3.3), 해시 필드(prevHash, hash) 제외, invalidates 추가 */
export const EventWire = Obj({
  v: Type.Literal(1),                                  // 09 EVENT_ENVELOPE_VERSION
  seq: Seq,                                            // 09 전역 seq(무간격)
  id: EventId,                                         // `ev_<ULID>`
  type: Type.String({ minLength: 1, maxLength: 96 }),  // 09 §3.4 카탈로그 이름
  typeVersion: Type.Integer({ minimum: 1 }),           // payload 스키마 버전(09 §3.13.3 업캐스터)
  category: Enum(["domain", "governance", "runtime", "kernel", "system", "measurement"]),
  plane: Nullable(Plane),
  occurredAt: IsoTime,
  recordedAt: IsoTime,
  actor: ActorRefSchema,                               // 08 §3.3.2 문자열 문법("human", "agent:work", "runtime" …)
  via: Via,                                            // 08 §3.3.2 객체(device·local_cli·run·process·system)
  authority: Type.Array(Type.String({ maxLength: 256 })),   // 09 AUTHORITY_PATTERN 문자열
  subject: Nullable(AnyRecordId),                      // 주 대상 레코드 ID
  refs: Type.Array(AnyRecordId),                       // 영향받은 다른 레코드
  scope: Obj({
    projectId: Nullable(ProjectId), goalId: Nullable(GoalId), concernId: Nullable(ConcernId),
    workUnitId: Nullable(WorkUnitId), runId: Nullable(RunId),
  }),
  commandId: Nullable(CommandId),                      // `cm_<ULID>`(10)
  causationId: Nullable(EventId),
  correlationId: Nullable(Type.String({ maxLength: 64 })),
  bootEpoch: Type.String({ minLength: 26, maxLength: 26 }),
  provenance: Nullable(Obj({
    rulesVersion: Nullable(Type.String({ maxLength: 64 })),
    contextRef: Nullable(Type.String({ maxLength: 128 })),
    adapterId: Nullable(Type.String({ maxLength: 64 })),
  })),
  redactions: Type.Array(Type.String({ maxLength: 128 })),  // 공개 사본에서 지운 민감 필드 이름(09 §3.2 규칙 10, 18)
  /** payload 스키마는 09 EVENT_META가 정본이다. 프로토콜은 객체인지만 본다. filter.payload = "none"이면 없다 */
  payload: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  payloadOmitted: Type.Optional(Enum(["tooLarge", "filtered"])),
  /** 무효화 태그(§3.6.3). 09 event_invalidations에 커밋 때 저장된 값을 그대로 싣는다. 빈 배열 가능 */
  invalidates: Type.Array(InvalidationTag, { maxItems: 64 }),
});
export type EventWire = Static<typeof EventWire>;
```

- 이벤트는 09의 공개용 사본(`readEvents({ redact: true })`)에서 만든다. 민감 필드는 지운 이름이 `redactions`에 남는다(09 §3.2 규칙 10). 이벤트 payload에 비밀을 넣지 않는 규칙(09·18, canon-2 L9)이 1차 방어이고 이 사본이 2차 방어다.
- 이벤트 하나의 정규화 JSON은 256 KiB를 넘지 않는다(09 §3.2 규칙 6, 넘으면 저장소가 `invalid.event_too_large`로 거부). 큰 도구 출력은 blob으로 저장하고 payload에는 `BlobRef`만 넣는다.

#### 3.5.3 이벤트 구독 계약

```ts
// 요청 "events.subscribe"
export const EventsSubscribeParams = Obj({
  from: Type.Union([StreamPosition, Type.Literal("head")]),   // "head": 지금 이후만. 위치: 그 seq 다음부터
  filter: Type.Optional(EventFilter),
});
export const EventsSubscribeResult = Obj({
  sub: Type.String({ maxLength: 16 }),   // 연결 안에서 유일한 구독 ID. 예: "e1"
  start: Pos,                            // 이 구독의 시작 위치(from.seq 또는 응답 시점의 headSeq)
  headSeq: Pos,                          // 등록 시점의 headSeq
  storeId: StoreId,
  mode: Enum(["replaying", "live"]),     // start < headSeq이면 replaying
});
export const EventsUnsubscribeParams = Obj({ sub: Type.String({ maxLength: 16 }) });

// 알림 "events"
export const EventsNotificationParams = Obj({
  sub: Type.String({ maxLength: 16 }),
  from: Pos,                             // 직전 알림의 to. 첫 알림이면 start
  to: Pos,                               // 이 알림이 책임지는 구간의 끝
  events: Type.Array(EventWire),         // (from, to] 구간에서 필터에 맞는 이벤트 전부. seq 오름차순. 빈 배열 가능
  caughtUp: Type.Boolean(),              // 이 알림을 보낸 시점에 to == headSeq
});
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
- 재생 읽기는 09 `readEvents({ afterSeq: pos, untilSeq: upto, limit: replayBatchMaxEvents, scanLimit: 10,000, typePrefixes, excludeTypePrefixes, concernIds, includeDescendants, goalIds, redact: true })`(09 §3.11.5)로 한다. 알림의 `to`는 묶음이 찼으면 담은 마지막 행의 seq, 아니면 09가 돌려준 `scannedUntilSeq`(이번에 훑은 구간의 끝, 최대 `upto`)다. 그래서 드문 필터도 한 번에 `scanLimit`행 이상 막지 않고, 필터에 맞는 행이 없는 구간도 위치가 앞으로 간다.
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
export const EventFilter = Obj({
  goalIds: Type.Optional(Type.Array(GoalId, { maxItems: 64 })),
  concernIds: Type.Optional(Type.Array(ConcernId, { maxItems: 64 })),
  includeDescendants: Type.Optional(Type.Boolean()),            // concernIds의 하위 Concern 포함. 기본 true
  typePrefixes: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 64 })),         // 예: ["question.", "choice."]
  excludeTypePrefixes: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 64 })),  // 예: ["toolcall."]
  payload: Type.Optional(Enum(["full", "none"])),               // 기본 "full"
});
```

- 조건 사이는 AND, 배열 안은 OR다. 모든 필드가 없으면 전체 스트림이다.
- 하위 Concern 포함 여부는 서버가 이벤트를 읽는 시점의 Concern 트리로 판정한다. 분해·병합(S 루프)으로 트리가 바뀐 뒤 옛 이벤트를 재생하면 판정이 기록 당시와 다를 수 있다. 정확한 이력이 필요한 화면은 전체 스트림이나 `events.read`를 쓴다.
- 필터 문자열 길이 합 4 KiB, 배열 원소 합 256개를 넘으면 `2007 filter.invalid`.

#### 3.6.3 화면 투영: `view.get`과 무효화 태그 [제안]

```ts
// 요청 "view.get"
export const ViewGetParams = Obj({
  view: ViewName,                                         // §3.7.4 카탈로그
  params: Type.Record(Type.String(), Type.Unknown()),     // 뷰별 파라미터(VIEW_SPECS[view].params로 다시 검사)
  minSeq: Type.Optional(Pos),                             // 이 seq 이상을 반영한 투영만 받겠다(§3.5.6)
  waitMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })),   // 기본 2,000
  page: Type.Optional(Obj({ before: Type.Optional(Pos), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })) })),
});

export const ViewResult = Obj({
  view: ViewName,
  key: Type.String({ maxLength: 256 }),                   // 정규화한 뷰 키. 예: "inbox", "concern:cn_01J…". 캐시 키
  asOfSeq: Pos,                                           // 이 투영이 반영한 마지막 seq(04 ViewMeta.sourceSeq와 같은 값)
  generatedAt: IsoTime,
  freshness: Enum(["current", "stale", "rebuilding", "failed"]),   // 04 §3.0.2와 같은 값
  staleReason: Type.Optional(Obj({ key: Type.String(), args: Type.Optional(Type.Record(Type.String(), Type.String())) })),   // 05 문구 키
  omitted: Type.Optional(Type.Array(Obj({ category: Type.String(), count: Type.Integer({ minimum: 0 }) }))),   // 누락 범주(canon §13.5)
  dependsOn: Type.Array(InvalidationTag, { maxItems: 512 }),   // 무효화 태그
  page: Type.Optional(Obj({ hasOlder: Type.Boolean(), oldestSeq: Type.Optional(Pos) })),
  data: Type.Unknown(),                                   // 뷰 모델. 스키마는 04 해당 절(§3.7.4 표). 테스트 모드에서는 뷰별 스키마로 검사한다
});
```

무효화 태그 규칙:

- 태그는 레코드 ID(`cn_…`, `qs_…`, `wu_…` 등) 또는 집계 이름(`@` 접두)이다. 집계 이름과 이벤트 종류별 대응의 정본은 12 §3.5.8 규칙 2다. 뷰 카탈로그(§3.7.4)가 쓰는 이름: `@home`, `@brief`, `@inbox`, `@autonomous`, `@concernTree`, `@goals`, `@observer`, `@recovery`, `@devices`, `@dials`, `@settings`, `@metrics`, `@tray`(12 표에 이 이름이 모두 있어야 한다, §5.2).
- `invalidates`는 커밋 트랜잭션 안에서 투영기가 계산해 09 `event_invalidations`에 저장한 값이다(09 §3.11.1 규칙 5, 12 §3.5.8 규칙 2). 계산식: 이벤트의 `subject`·`refs`, 그 이벤트로 투영 행이 바뀐 레코드 ID, envelope의 `scope`(goal·concern·workUnit), 12의 순수 함수 `aggregateTags(e)`가 낸 집계 이름. 프로토콜은 보낼 때 이 저장값을 그대로 싣고 따로 계산하지 않는다. 재전송한 옛 이벤트도 같은 값을 받는다(투영을 다시 만들면 09가 같은 값을 다시 만든다). 뷰 처리기는 뷰를 만들 때 읽은 레코드 ID와 집계 이름을 `dependsOn`에 넣는다. 둘 다 데몬이 계산하므로 앱에 "이벤트 종류 → 화면" 대응표가 필요 없다(20 AS-1의 요구를 태그로 일반화했다. 결정 32).
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
// packages/protocol/src/stream.ts
// 요청 "stream.subscribe"
export const StreamScope = Type.Union([Obj({ concernId: ConcernId }), Obj({ runId: RunId }), Obj({ workUnitId: WorkUnitId }), Obj({ all: Type.Literal(true) })]);
export const StreamPartKind = Enum(["text", "thinking", "toolArgs", "toolOutput", "toolPhase", "status", "end"]);
export const StreamSubscribeParams = Obj({
  scope: StreamScope,
  parts: Type.Optional(Type.Array(StreamPartKind)),   // 받을 조각 종류. 기본은 thinking을 뺀 전부
});
export const StreamSubscribeResult = Obj({
  sub: Type.String({ maxLength: 16 }),               // 예: "s1"
  active: Type.Array(RunPartial),                    // 지금 범위 안에서 실행 중인 run의 현재 조각 상태
});

/** 19 RunPhase 일곱 값. 12 stage 다섯 값(`inference`·`tools`·`compaction`·`settlement`·`idle`)과 RunStatus를 이 일곱 값으로 옮기는 대응은 12 §3.2.2 표가 소유한다 */
export const RunPhase = Enum(["preparing", "waitingModel", "streaming", "runningTool", "compacting", "waitingHuman", "idle"]);
const Chunk = Type.String({ maxLength: 16384 });
export const StreamPart = Type.Union([
  Obj({ kind: Type.Literal("text"), messageId: MessageId, offset: Type.Integer({ minimum: 0 }), text: Chunk }),   // offset: 이 조각 앞까지의 길이(UTF-16 단위)
  Obj({ kind: Type.Literal("thinking"), messageId: MessageId, offset: Type.Integer({ minimum: 0 }), text: Chunk }),   // 기본으로 보내지 않는다(판정 J-107)
  Obj({ kind: Type.Literal("toolArgs"), toolCallId: ToolCallId, offset: Type.Integer({ minimum: 0 }), text: Chunk }),
  Obj({ kind: Type.Literal("toolOutput"), toolCallId: ToolCallId, stream: Enum(["stdout", "stderr"]), offset: Type.Integer({ minimum: 0 }), text: Chunk }),
  Obj({ kind: Type.Literal("toolPhase"), toolCallId: ToolCallId, tool: Type.String({ maxLength: 64 }), phase: Enum(["requested", "executing", "finished"]) }),   // 12 F-4
  Obj({ kind: Type.Literal("status"), phase: RunPhase, label: Type.Optional(Type.String({ maxLength: 200 })) }),   // label은 짧은 한국어(12)
  /** run 종료. reason은 08 Run.end와 같은 값(08 RunEndReason, 12 RunEndPayload) */
  Obj({ kind: Type.Literal("end"), outcome: Enum(["ended", "interrupted"]), reason: Nullable(RunEndReason), finalSeq: Type.Optional(Seq) }),
]);

// 알림 "stream.chunk"
export const StreamChunkParams = Obj({
  sub: Type.String({ maxLength: 16 }),
  runId: RunId,
  concernId: ConcernId,
  workUnitId: Type.Optional(WorkUnitId),
  n: Type.Integer({ minimum: 1 }),        // 이 run의 조각 번호. run 안에서 1씩 증가. 버린 조각도 번호를 소비한다
  afterSeq: Pos,                          // 이 조각을 내보낼 때의 마지막 영속 seq(09 §3.5 공통 필드)
  part: StreamPart,
});

// 요청 "run.partial" → RunPartial
export const RunPartialParams = Obj({ runId: RunId });
export const RunPartial = Obj({
  runId: RunId, concernId: ConcernId, workUnitId: Type.Optional(WorkUnitId),
  n: Pos,                                 // 이 상태에 반영된 마지막 조각 번호
  startedAt: IsoTime,
  phase: RunPhase,
  runStatus: RunStatus,                   // 08 RunStatus(12 §3.2)
  threadId: ThreadId,                     // `th_<ULID>`(12): 같은 대화를 이어 쓰는 run들의 계보
  messages: Type.Array(Obj({ messageId: MessageId, text: Type.String(), thinking: Type.Optional(Type.String()) })),   // 아직 영속되지 않은 메시지의 현재 텍스트. thinking은 설정이 켜졌을 때만
  tools: Type.Array(Obj({ toolCallId: ToolCallId, tool: Type.String(), phase: Enum(["requested", "executing", "finished"]),
                          outputTail: Type.String({ maxLength: 16384 }), outputLength: Type.Integer({ minimum: 0 }) })),
});
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
- 사고(thinking) 조각은 기본으로 보내지 않는다(판정 J-107). 12 설정 `ui.showThinking`(개발 화면 설정, 기본 꺼짐)이 켜졌을 때만 데몬이 `thinking` 조각과 `RunPartial.messages[].thinking`을 싣고, 그때도 구독의 `parts`에 `thinking`이 있어야 보낸다. 화면 투영에는 사고 텍스트가 들어가지 않는다(12 §3.5.8 규칙 8).
- 제어 문자: 데몬은 휘발 조각과 이벤트 payload의 사람이 읽는 텍스트에서 C0(탭·줄바꿈·복귀 제외)·C1 제어 문자와 SGR(`ESC [ … m`)이 아닌 ESC 시퀀스를 지운다(12 §5.2 요구, canon-2 §11/12 "출력 정화"). SGR은 TUI가 쓰도록 남기고, 데스크톱은 렌더할 때 지운다. 터미널 제어 시퀀스가 TUI 화면을 조작하는 것을 막는다.

09 §3.5의 휘발 종류와의 대응:

| 09 종류 | `StreamPart.kind` | 12의 원천 |
|---|---|---|
| `run.text_delta` | `text` | pi `message_update`(assistant) |
| `run.thinking_delta` | `thinking` | 같은 메시지의 생각 조각(`ui.showThinking`이 켜졌을 때만) |
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
| presence | 마지막 `presence.report` 값(§3.7.8). 기기별 값 계산의 입력 |

### 3.7 메서드

#### 3.7.1 메서드 등록 표 [제안]

메서드 이름은 이 문서가 정본이다(판정 §1). 커널 명령 이름은 10 §3.11이 정본이고, 메서드 → 명령 대응은 10 §3.11.11(2)의 정본 대응표를 옮긴 것이다. 판정 J-111(`objection.file`), J-123(`result.reopen`을 쓰지 않는다), J-124(합의 확정·결과 확인은 전용 메서드), J-136(Goal 범위 다이얼 없음)을 반영했다. 10 표와 이 표가 다르면 10 표를 고치게 한다(§5.2). 종류: `ctl` 연결 제어, `read` 조회·구독, `cmd` 명령(멱등 키·`basisSeq` 필수), `adm` 관리. params·result 스키마는 §3.7.2~§3.7.8의 TypeBox 상수이고, params → 10 payload 변환은 §3.7.9다.

연결·조회·구독:

| 메서드 | 종류 | scope | params / result | 절 |
|---|---|---|---|---|
| `hello` | ctl | (인증 전) | `HelloParams` / `HelloResult` | §3.4 |
| `ping` | ctl | read | `PingParams` / `PingResult` | §3.7.2 |
| `events.subscribe` / `events.unsubscribe` | read | read | §3.5.3 | §3.5 |
| `events.read` | read | read | `EventsReadParams` / `EventsReadResult` | §3.7.3 |
| `view.get` | read | read | `ViewGetParams` / `ViewResult` | §3.6.3 |
| `record.locate` | read | read | `RecordLocateParams` / `RecordLocation` | §3.7.3 |
| `search.query` | read | read | `SearchParams` / `SearchResult` | §3.7.3 |
| `command.lookup` | read | read | `CommandLookupParams` / `CommandLookupResult` | §3.7.3 |
| `stream.subscribe` / `stream.unsubscribe` | read | read | §3.6.4 | §3.6.4 |
| `run.partial` | read | read | `RunPartialParams` / `RunPartial` | §3.6.4 |
| `composer.preview` | read | decide | `ComposerPreviewParams` / `SemanticPreviewResult` | §3.7.5 |
| `localConfirm.request` | read | decide(`local` 리스너의 `tty_cli`만) | `LocalConfirmRequestParams` / `LocalConfirmRequestResult` | §3.7.5 |
| `presence.report` (알림) | read | read | `PresenceReportParams`, 응답 없음 | §3.7.8 |
| `blob.downloadTicket` | read | read | `BlobTicketParams` / `BlobTicketResult` | §3.11.2 |
| `daemon.status` | read | read | `{}` / `DaemonStatus` | §3.7.8 |
| `device.pushConfig` | read | read | `{}` / `DevicePushConfigResult` | §3.17 |
| `protocol.describe` | read | read | `{}` / `ProtocolDescription` | §3.13.2 |

사람 명령(종류 `cmd`, result `CommandResult`, 절 §3.7.5). scope 열의 `D`는 `decide`, `M`은 `decideMobile`이다. `M`에 값 제한이 있으면 괄호에 적는다(26 §3.3.3, 18 §3.5 모바일 표).

| 메서드 | 커널 명령(10 §3.11.11(2)) | scope | 비고 |
|---|---|---|---|
| `question.answer` | `question.answer` | D, M(`approve_edited` 제외) | params는 11 `AnswerValue`(§3.7.5). 질문 종류 `agreement_confirm`·`result_review`면 커널이 `policy.answer_option_not_allowed`(3001)로 거부한다(판정 J-124) |
| `question.proceedWithAssumption` | `question.answer`(`{option: "accept_assumption"}`) | D, M | 권리 게이트면 `policy.answer_option_not_allowed` |
| `question.requestReframe` | `question.request_reframe` | D, M | 판정 J-47: 답 값과 별도인 명령 |
| `question.requestInquiry` | `question.answer`(`{option: "experiment_first"}`) | D, M | |
| `question.delegate` | `question.delegate` | D, M | 정보 게이트에서 쓴다. 방향 선택(`direction.after_fact`) 권리 질문은 사람이 맡기기를 명시해 고를 때만 맡긴다([판정 J-131], [판정 J-201]). send·범위 확장·결과 확인 권리 게이트는 맡길 수 없고, 맡기면 `policy.answer_option_not_allowed`(3001)다 |
| `question.defer` | `question.defer` | D, M | `until`은 11 이름(§3.7.5) |
| `question.escalate` | `question.escalate` | D | "지금 보기" |
| `objection.file` | `decision.contest` | D, M | 대상은 08 `ObjectionTarget`(판정 J-36). 결과 이벤트 09 `objection.filed`(판정 J-30). 판정 J-111 |
| `objection.withdraw` / `objection.dismiss` | `objection.withdraw` / `objection.dismiss` | D | |
| `decision.confirm` | `decision.confirm` | D | 혼자 정한 결정을 "이대로 둔다"로 확인(`targets` 지정) |
| `autonomous.markSeen` | `autonomous.mark_seen` | D, M | "봤음"은 확인·승인이 아니다(21 §3.7.3). 항목 단위면 `targets` |
| `choice.commit` / `choice.revoke` | `choice.commit` / `choice.revoke` | D | 선택 요청 질문 밖에서 사람이 직접 정할 때 |
| `finding.confirm` / `finding.withdraw` | `finding.confirm` / `finding.withdraw` | D | |
| `criterion.confirm` / `criterion.reject` | `preference.criterion.confirm` / `preference.criterion.reject` | D | 10 대응표에 행 추가를 요구 |
| `reaction.record` | `observation.record`(사람 반응, 08 `ReactionPayload`) | D | 원함 탐구 반응(휴대폰은 미루기만, 26 §3.5.4) |
| `reaction.amend` / `reaction.withdraw` | `reaction.amend` / `reaction.withdraw` | D | |
| `stimulusRound.close` | `inquiry.round.close` | D | 키는 `inquiryId` + `roundNo` |
| `possibility.pin` / `possibility.dismiss` | `possibility.pin`·`possibility.unpin` / `possibility.dismiss` | D | `pinned: false`면 `possibility.unpin` |
| `inquiry.requestFrame` | `inquiry.perspective.add`(add) / `possibility.merge`(merge) | D | |
| `inquiry.proposeCandidate` | `possibility.propose`(사람 작성) | D | |
| `inquiry.markAssumption` | `assumption.record` | D | |
| `inquiry.pinCheck` | `check.pin` | D | |
| `inquiry.requestDecision` | `inquiry.stop`(`then: "decide_now"`) | D | 이어서 런타임이 `choice` 질문을 낸다 |
| `inquiry.stop` | `inquiry.stop`(`then: "proceed"` 또는 `"hand_off"`) | D | 멈춤 이유는 08 `human_decided` |
| `inquiry.pinLens` | `lens.update`(`pinned`) | D | 명령 이름은 10 §3.11.11(2)를 따른다([판정 J-200]) |
| `inquiry.fillCell` | `observation.record`(`obsKind: "utterance"`, 사람 발화 관찰, 채널 H) | D | 칸 채우기는 명령을 따로 두지 않는다(15 §3.2.6) |
| `expectation.revise` | `expectation.revise` | D | |
| `agreement.confirm` | `agreement.confirm` | D, M(`edits`는 범위에서 빼기만) | `edits`(10 `Partial<AgreementContent>`), `exclude`. 판정 J-124 |
| `agreement.revise` | 상태 `proposed`면 `agreement.correct_understanding`(에이전트가 초안을 다시 쓴다), `active`면 `agreement.renegotiate` | D | 04 뜻: 초안을 다시 만들고 확정은 따로 `agreement.confirm`. 구조로 고쳐서 바로 확정하려면 `agreement.confirm(edits)` |
| `agreement.narrow` | 상태 `proposed`면 `agreement.confirm`(`edits.scope` = 좁힌 범위), `active`면 `agreement.renegotiate`(좁힌 범위의 새 내용) | D | 10의 `agreement.narrow`는 모델·런타임 채널 명령이다. 사람이 좁히는 경로는 이 대응으로 정하고 10 표를 고치게 한다 |
| `agreement.renegotiate` | `agreement.renegotiate` | D | 활성 합의의 내용 바꾸기 |
| `agreement.decline` | `agreement.decline` | D, M | "맡기지 않기" |
| `agreement.release` | `agreement.release` | D | 활성 합의 풀기(03 "합의 풀기") |
| `agreement.correctUnderstanding` | `agreement.correct_understanding` | D | 자연어로 "이해가 다름"을 알리고 에이전트가 다시 쓴다 |
| `grant.issue` / `grant.revoke` | `grant.issue` / `grant.revoke` | D | 맡겨 둔 권한(비상 합의 포함, 판정 J-116) |
| `result.accept` | `result.accept`(`decision` 명령 값 다섯) | D, M(`accept`·`request_changes`만. 산출물을 연 뒤이고 `review` 뷰의 `mobileReviewable`이 참일 때만, 판정 J-139·J-174) | 거절·기준이 틀림도 이 메서드다(판정 J-123). 반영 처리 방침, 반영 범위 합의(판정 J-126), 함께 답한 질문(`bundledAnswers`, 판정 J-124)을 싣는다 |
| `obligation.confirmDone` / `defer` / `transfer` / `waive` / `reopen` | `obligation.resolve` / `obligation.defer` / `obligation.transfer` / `obligation.waive` / `obligation.reopen` | D | |
| `project.create` | `project.create` | D | 처음 연결 단계의 폴더 추가(04·02 UC-11) |
| `goal.propose` | `goal.propose`(`activateNow`) | D | 사람이 Goal을 직접 만들 때 |
| `goal.activate` | `goal.activate` | D | 에이전트 Goal 초안으로 시작("이 Goal로 시작"). 고쳐서 시작이면 `edits`(10에 요구) |
| `goal.revise` | `goal.revise` | D | |
| `goal.confirmRevision` / `goal.rejectRevision` | `goal.revision.confirm` / `goal.revision.reject` | D | |
| `goal.confirmAchieved` / `goal.rejectAchieved` | `goal.achievement.confirm` / `goal.achievement.reject` | D | |
| `goal.pause` / `goal.resume` / `goal.retire` | `goal.pause` / `goal.resume` / `goal.retire` | D | |
| `concern.propose` | `concern.open`(사람, `origin`·`entrySignals`) | D | |
| `concern.revise` | `concern.update` | D | |
| `concern.hold` / `concern.resume` | `structure.hold` / `concern.resume` | D | |
| `concern.close` / `concern.reopen` | `concern.close` / `concern.reopen` | D | |
| `loop.requestTransition` | `loop.transition` | D | 14 "루프 직접 지정" |
| `loopPlan.revise` | `loop_plan.record` | D | 14 "계획 수정". 계획의 `authoredBy`는 데몬이 `human`으로 채운다(판정 J-188) |
| `structure.request` | `structure.request` | D | 사람의 나누기·합치기·보류 요청 |
| `mode.set` | `mode.set` | D | 라우터의 지정은 `mode.route` |
| `dial.set` / `dial.unset` | `dial.set` / `dial.unset` | D | 범위는 08 `DialLayer`(user·concern·instruction), Goal 범위 없음(판정 J-136). `planAuthoring`(판정 J-188, 결정 53)은 user·concern 층만 받는다 |
| `settings.update` | `setting.change` | D, M(`notifications` 섹션과 `attention.quietHours`만) | 이벤트 09 `setting.changed`. 키와 값은 14 `DIAL_DEFS`의 `kind: "setting"` 항목으로 검사한다. `notifications.resultReview`·`notifications.resultReviewDigestAt`([판정 J-189], [결정 56])은 `notifications` 섹션이다. `attention.snoozeUntil`·`attention.interruptsPerHour`·`attention.quietHours`([판정 J-166], [판정 J-171], [판정 J-195])는 `attention` 섹션이다. 휴대폰은 `attention` 섹션에서 `attention.quietHours`만 바꾼다([판정 J-227]). |
| `observerProposal.adopt` / `decline` / `snooze` | `policy.change.accept` / `policy.change.reject` / `policy.change.defer` | D | |
| `work.steer` | `run.steer` | D | |
| `work.pause` / `work.resume` | `workunit.pause` / `workunit.resume` | D | |
| `work.stop` | `run.stop` | D, M | 다음 턴 경계에서 정리하고 멈춘다 |
| `work.abort` | `run.cancel` | D | 즉시 끊는다. 결과 불명 호출이 남을 수 있다 |
| `thread.compact` | (커널 명령 아님. 12 컴팩션 요청 §3.6.2) | D | `status: "accepted"` |
| `composer.submit` | (커널 명령 아님. 12가 받아 런타임 채널로 `run.record_message` + 사람 발화 관찰) | D | |
| `brief.acknowledge` | `brief.acknowledge` | D, M(`compact: true`만) | 판정 J-137 |
| `brief.correct` | `brief.correct` | D | |
| `recovery.resolve` | 대상이 도구 호출이면 `toolcall.recover`, WorkUnit이면 12 실행 수준 동작(12 §3.7.4) | D, M | 선택지 집합은 12 §3.7.4가 정한다. "Concern에서 다시 계획"은 메서드가 아니라 데스크톱 화면 이동이다 |
| `daemon.exitSafeMode` | `runtime.exit_safe_mode` | devices, M | 안전 모드 해제 주체는 데스크톱·TUI 기기, 휴대폰, 대화형 `localAdmin`이다(§3.7.8). 이벤트는 `daemon.safe_mode_exited`(09, 판정 J-165) |
| `surprise.report` | `surprise.report` | D | 측정 범주(16) |
| `resumptionCheck.answer` / `resumptionCheck.score` | `resumption_check.answer` / `resumption_check.score` | D | 판정 J-10·J-78. 10은 `score`를 R 채널로 적었다. 사람이 채점하면 H 채널을 받게 10에 요구 |
| `selfReport.submit` | `self_report.submit` | D | 측정 범주(16) |

기기·관리:

| 메서드 | 종류 | scope | 커널 명령 | 절 |
|---|---|---|---|---|
| `device.list` | read | devices, devicesLimited | - | §3.7.7 |
| `device.rename` | cmd | devices | `device.rename`(통치 명령) | §3.7.7 |
| `device.revoke` | cmd | devices, devicesLimited | `device.revoke` | §3.7.7 |
| `device.expireTokens` | cmd | devices | `device.expire_tokens` | §3.7.7 |
| `device.rebind` | cmd | admin | `device.rebind`(18 S-03, 10 통치 명령 목록에 요구) | §3.7.7 |
| `device.createPairingCode` | cmd | devices | `pairing.create_code` | §3.7.7 |
| `device.registerPush` / `device.unregisterPush` / `device.testPush` | cmd | devices, devicesLimited(자기 기기만) | `device.register_push` / `device.unregister_push` / `device.test_push` | §3.17 |
| `connection.list` | read | devices, devicesLimited | - | §3.7.7 |
| `connection.close` | cmd | devices | (커널 명령 없음. 연결을 닫고 감사 기록만 남긴다) | §3.7.7. 기록 항목은 18 §3.13.1 |
| `admin.status` | adm | admin | - | §3.7.8 |
| `admin.issueDevice` / `admin.drain` / `admin.setMode` / `admin.backupNow` / `admin.verify` / `admin.maintain` / `admin.reloadConfig` / `admin.reloadSecrets` | adm | admin | 통치 명령(17·18, 10 §3.11.11 (1) 끝) | §3.7.8 |

- 04가 쓴 `device.pair`는 HTTP `POST /pair`(데스크톱)·`POST /m/pair`(휴대폰)로 한다. JSON-RPC 메서드는 두지 않는다(토큰을 웹뷰·스크립트에 보이지 않기 위해, 20 §3.8.7, 26 §3.3.4). `connection.test`는 앱 내부 동작이고 `GET /healthz`와 `ping`을 쓴다.
- 1판의 `device.rotateToken`(JSON-RPC 결과로 토큰을 돌려줌)은 뺐다. 토큰 교체는 HTTP `POST /devices/self/rotate`(2차 기능, 18 §3.8.3)로만 한다.
- 1판의 `contest.file`은 `objection.file`로, `result.acceptWithConditions`·`result.requestRevision`·`result.reopen`은 `result.accept`의 `decision`으로 합쳤다(판정 J-111·J-123). 04의 `work.requestBrief` 의도는 `view.get("brief", { workUnitId })`이고, 질문 열람(`question.mark_seen`)은 메서드 없이 `presence.report`에서 데몬이 만든다(§3.7.8).
- 16이 요구한 `observer` 뷰는 04의 이름 `observerProposals`로, `view.record`는 `presence.report`로 받았다. 12가 쓴 `conversation.send`는 `composer.submit`으로, `run.stop`·`run.cancel`은 `work.stop`·`work.abort`로 받았다.
- 관찰 에이전트의 모델 호출과 제안 제출은 16 §3.2.3 IPC로 한다(판정 §2). 이 프로토콜에는 그 메서드가 없다. 12 §5.2가 요구한 "관찰 프로세스용 모델 호출 메서드"는 두지 않는다.

#### 3.7.2 공통 스키마와 연결 메서드

```ts
// packages/protocol/src/common.ts
import { Type, type Static } from "typebox";
import { Obj, Nullable, Enum, AnyRecordId, CommandId, Seq, RevisionRef } from "@helm/domain/schema";

export const IsoTime = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?Z$" });   // 브리프 §3.3
/** 위치. 0은 "이벤트 없음"(headSeq 0). 08 Seq는 1부터라 따로 둔다 */
export const Pos = Type.Integer({ minimum: 0 });
export const ServerId = Type.String({ minLength: 1, maxLength: 64 });
export const StoreId = Type.String({ minLength: 1, maxLength: 64 });
export const IdempotencyKey = Type.String({ pattern: "^ik_[0-7][0-9A-HJKMNP-TV-Z]{25}$" });   // 20 APP-D09
export const ListenerKind = Enum(["tailnet", "loopback", "local"]);
export const Scope = Enum(["read", "decide", "decideMobile", "devices", "devicesLimited", "admin", "modelTool"]);
export const DaemonMode = Enum(["normal", "safeMode", "readOnly", "draining"]);
// 17 내부 모드 대응: ready → normal, safe_mode → safeMode, read_only → readOnly, draining → draining
/** 읽기 전용·안전 모드의 사유(17 §3.4.1, 판정 J-129). recovery_failed는 17 정본 값이다(판정 J-178). restored는 복원 뒤 첫 부팅의 안전 모드 사유다(판정 J-164). 화면은 사유별 배너를 보인다(05) */
export const ModeReason = Enum(["disk_critical", "integrity_suspect", "recovery_failed", "projection_fault", "operator", "crash_loop", "restored"]);
export const InvalidationTag = Type.String({ pattern: "^(@[a-zA-Z]+|[a-z]{2}_[0-7][0-9A-HJKMNP-TV-Z]{25})$" });
/** 화면용 레코드 참조. 정본은 12 §3.5.8 규칙 4이고 @helm/protocol이 이 하나를 export한다. kind는 08 레코드 kind 리터럴 */
export const RecordRef = Obj({
  id: AnyRecordId,
  kind: RecordKind,                      // 08 레코드 kind 리터럴의 유니온(@helm/domain에서 파생)
  displayNo: Nullable(Type.Integer({ minimum: 1 })),
  title: Type.String({ maxLength: 200 }),
  revision: Type.Integer({ minimum: 0 }),
  revisionSeq: Seq,                      // 08 RecordMeta.revisionSeq. basisSeq 계산과 낡음 표시에 쓴다
  quality: Obj({ level: Type.String({ maxLength: 32 }), flags: Type.Array(Type.String()), flagSources: Type.Array(AnyRecordId) }),
});

/** 모든 cmd 메서드의 params에 들어가는 공통 필드 */
export const CommandBase = {
  idempotencyKey: IdempotencyKey,        // 사용자 의도 하나에 하나. 재시도·재접속에도 같은 값
  basisSeq: Pos,                         // 이 결정을 내린 화면이 본 뷰의 asOfSeq. 화면 밖 동작(단축키 등)은 그 시점의 클라이언트 위치
  expect: Type.Optional(Type.Array(RevisionRef, { maxItems: 16 })),   // 08 RevisionRef. 특정 레코드의 판을 직접 지정할 때만(§3.9.3)
  clientTime: Type.Optional(IsoTime),    // 기록용(10 CommandEnvelope.issuedAt)
  /** local 리스너 tty_cli 연결의 사람 결정 명령에만 필수(18 §3.5 규칙 6, 판정 J-135). 그 밖에서는 보내지 않는다 */
  localConfirm: Type.Optional(Obj({ confirmId: Type.String({ maxLength: 64 }), code: Type.String({ pattern: "^[A-Z0-9]{4}$" }) })),
};
/** 명령 params = CommandBase + 메서드별 필드. 닫힌 객체 하나로 만든다 */
export const Cmd = <P extends TProperties>(p: P) => Obj({ ...CommandBase, ...p });

export const CommandImpact = Obj({       // 10 §3.13.3 impactOf와 파생 규칙(R-1·R-4·R-8 등)의 결과를 화면용으로 줄인 것
  changed: Type.Array(Obj({ text: Type.String({ maxLength: 500 }), records: Type.Array(RecordRef) })),   // text는 05 문구 키로 만든 한국어 한 줄
  invalidated: Type.Array(RecordRef),    // 다시 확인 대상(낡음 표시)이 된 레코드
  reviewTrigger: Nullable(Type.String({ maxLength: 500 })),
  obligationsAdded: Type.Integer({ minimum: 0 }),
});

export const CommandResult = Obj({
  /** applied: 받아들였고 결과 이벤트가 커밋됐다. accepted: 오래 걸리는 일을 접수했다(결과는 이벤트, jobId·runId로 연결).
   *  gated: 커널이 자격 부족을 질문으로 바꿨다(10 needs_gate). 명령 자체는 적용되지 않았다 */
  status: Enum(["applied", "accepted", "gated"]),
  commandId: CommandId,                  // 같은 멱등 키의 재시도는 처음 값
  duplicate: Type.Boolean(),             // 이미 처리한 멱등 키라 저장된 결과를 돌려준다(06 SubmitResult.replayed)
  /** 보관 기간(365일)이 지나 결과를 줄인 행이면 true. status와 commandId만 믿을 수 있다(§3.9.2) */
  reduced: Type.Optional(Type.Boolean()),
  headSeq: Pos,
  firstSeq: Nullable(Seq), lastSeq: Nullable(Seq),   // 이 명령이 커밋한 이벤트 seq 범위
  events: Type.Array(Obj({ seq: Seq, id: Type.String(), type: Type.String() })),
  created: Type.Optional(Type.Record(Type.String(), AnyRecordId)),   // 새로 생긴 레코드. 예: { concernId: "cn_…" }
  notices: Type.Optional(Type.Array(Obj({ code: Type.String(), subject: AnyRecordId, message: Type.String() }))),   // 10 Notice
  jobId: Type.Optional(Type.String({ maxLength: 64 })),
  runId: Type.Optional(Type.String({ maxLength: 64 })),
  questionId: Type.Optional(AnyRecordId),   // gated일 때 생긴 질문
  impact: Type.Optional(CommandImpact),     // 21 ChoiceImpactEcho
});
export type CommandResult = Static<typeof CommandResult>;

// ping
export const PingParams = Obj({});
export const PingResult = Obj({ serverTime: IsoTime, headSeq: Pos });
```

- 다른 문서에서 가져오는 스키마: 08 `@helm/domain/schema`의 도우미(`Obj`, `Nullable`, `Enum`, `Merge`, `Id`, `IdAny`)와 ID 상수, `ActorRefSchema`, `Via`, `ObjectionTarget`, `Scope`(이름 충돌을 피해 `AgreementScope`로 가져온다), `AgreementContent`, `Trigger`, `ElementSelector`, `ReactionPayload`, `GoalCore`, `ConcernCore`, `GrantCore`, `LoopPlanCore`, `LoopIdSchema`, `Sha256`. 11의 `AnswerValue`(TypeBox로 `@helm/domain`에 두도록 11에 요구). `@helm/protocol`은 `@helm/domain`을 스키마와 타입으로만 가져오고, 데몬 쪽 인터페이스(§3.15)의 09·18 타입은 `@helm/daemon` 안에서만 쓴다.
- `TProperties`는 typebox 1.x의 속성 묶음 타입이다(08 §3.4.1이 같은 이름을 쓴다).
- `ping`은 진단용 왕복 시간 측정이다. 생존 확인은 `tick`이 한다(§3.10). 클라이언트는 `ping`을 주기적으로 보내지 않는다.

#### 3.7.3 조회 메서드

```ts
// packages/protocol/src/queries.ts
// events.read: 이벤트 이력 페이지. 구독과 달리 위치를 남기지 않는다
export const EventsReadParams = Obj({
  after: Type.Optional(Pos),             // 이 seq 다음부터 오름차순
  before: Type.Optional(Pos),            // 이 seq 앞에서 내림차순(최근 이력 거꾸로 채우기)
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),   // 기본 100
  filter: Type.Optional(EventFilter),
  subjectId: Type.Optional(AnyRecordId), // SCR-RECORD: 레코드 하나와 관련된 이벤트만(09 event_refs)
});
export const EventsReadResult = Obj({
  events: Type.Array(EventWire),         // after면 오름차순, before면 내림차순
  headSeq: Pos, storeId: StoreId,
  next: Type.Optional(Obj({ after: Type.Optional(Pos), before: Type.Optional(Pos) })),
});

// search.query: 명령 팔레트(04 §3.25)의 레코드 찾기
export const SearchParams = Obj({
  text: Type.String({ minLength: 1, maxLength: 200 }),   // 표시 번호("질문 14", "q14")도 받는다
  kinds: Type.Optional(Type.Array(RecordKind, { maxItems: 32 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),     // 기본 20
});
export const SearchResult = Obj({
  asOfSeq: Pos,
  hits: Type.Array(Obj({ ref: RecordRef, snippet: Type.Optional(Type.String({ maxLength: 300 })), concern: Type.Optional(RecordRef) })),
});

// record.locate: 딥 링크·알림이 가리킨 레코드의 화면 경로 인자를 얻는다(20 §5.2 (8))
export const RecordLocateParams = Obj({ id: AnyRecordId });
export const RecordLocation = Obj({
  ref: RecordRef,
  goalId: Nullable(GoalId), concernId: Nullable(ConcernId), workUnitId: Nullable(WorkUnitId),
  questionId: Type.Optional(QuestionId),           // 그 레코드를 다루는 열린 질문이 있으면
  screen: Type.String({ pattern: "^SCR-[A-Z0-9-]+$" }),   // 03 화면 ID. 휴대폰은 26 §3.5.2의 대응을 쓴다
  view: Obj({ view: ViewName, params: Type.Record(Type.String(), Type.Unknown()) }),
  status: Enum(["open", "resolved", "superseded"]),   // 04 §3.0.5 "이미 처리됨" 표시용
});

// command.lookup: 원래 멱등 키로 명령 결과를 찾는다. "보내지 못한 조작" 화면이 다시 보내기 전에 먼저 부른다
export const CommandLookupParams = Obj({ idempotencyKey: IdempotencyKey });
export const CommandLookupResult = Type.Union([
  Obj({ found: Type.Literal(false) }),               // 이 기기·이 키로 커밋된 명령이 없다. 새 키로 보내도 두 번 적용되지 않는다
  Obj({ found: Type.Literal(true), result: CommandResult }),
  Obj({ found: Type.Literal(true), error: JsonRpcError }),   // 저장된 거부(3001~3005, 3008, 3009)
]);
```

- `after`와 `before`는 함께 쓰지 않는다(`-32602`). 둘 다 없으면 `before: headSeq + 1`과 같다. 데몬은 09 `readEvents({ afterSeq | beforeSeq, typePrefixes, goalId, concernId, ref, redact: true })`로 읽고 09의 `nextAfterSeq`를 `next.after`로 옮긴다.
- `record.locate`: 없는 ID는 `2005`. 대체된 레코드도 찾는다(`status: "superseded"`).
- `command.lookup`의 범위는 이 연결의 멱등 범위(채널·행위자·`viaKey`, §3.9.2)다. 다른 기기가 같은 키를 썼어도 보이지 않는다. 보관 기간(365일)이 지난 행은 `result.reduced: true`로 돌려준다.

#### 3.7.4 뷰 카탈로그 (투영 조회) [제안]

뷰 이름과 파라미터는 04가 화면별 "표시 데이터"에 적은 후보를 받았다. 뷰 모델(`data`)의 타입은 04 해당 절이 소유하고(04에 `data` 타입이 없는 뷰는 §5.2의 04 요구), 정본에서 만드는 규칙은 12가 소유한다. 이 문서는 이름, 파라미터 스키마, 키, 기본 집계 태그를 정한다. 집계 태그의 이름과 이벤트 종류별 대응의 정본은 12 §3.5.8 규칙 2다. 이 표의 태그는 12 표에 있어야 한다(§5.2).

| 뷰 | 화면(03 §3.6) | params(TypeBox, `VIEW_SPECS`) | 키 | 기본 집계 태그 | `data` 타입 |
|---|---|---|---|---|---|
| `home` | `SCR-HOME` | `{ goalId?: GoalId }` | `home[:goalId]` | `@home` | 04 §3.1 |
| `brief` | `SCR-BRIEF`, `SCR-M-BRIEF` | `{ goalId?: GoalId; concernId?: ConcernId; workUnitId?: WorkUnitId; sinceSeq?: Pos; untilSeq?: Pos; compact?: boolean }`. `sinceSeq` 기본은 `brief.acknowledge`의 마지막 값. `untilSeq`가 있으면 그 seq까지로 고정한 요약이다. `concernId`는 긴 범위의 Concern 펼침(12 §3.5.9), `workUnitId`는 04의 "작업 요약 요청" | `brief[:scope][@since..until][:compact]` | `@brief`(`untilSeq`가 있으면 넣지 않는다) | 04 §3.2 |
| `inbox` | `SCR-INBOX` | `{ kinds?: QuestionScreenKind[]; concernId?: ConcernId; gate?: "rights" \| "information" }` | `inbox[?…]` | `@inbox` | 04 §3.3 |
| `question` | `SCR-QUESTION` | `{ questionId: QuestionId }` | `question:<id>` | - | 04 §3.4 |
| `autonomous` | `SCR-AUTO` | `{ since?: "ack" \| "all"; concernId?: ConcernId; contestedOnly?: boolean }` | `autonomous[?…]` | `@autonomous` | 04 §3.5 |
| `concernTree` | `SCR-CONCERNS` | `{ goalId?: GoalId; status?: string[] }` | `concernTree[?…]` | `@concernTree` | 04 §3.6 |
| `concern` | `SCR-CONCERN-OVERVIEW` | `{ concernId: ConcernId }` | `concern:<id>` | - | 04 §3.7 |
| `inquiry` | `SCR-INQUIRY` | `{ concernId: ConcernId; kind: "fact" \| "want" \| "possibility" \| "outcome" }` | `inquiry:<id>:<kind>` | - | 04 §3.8. 15 §5.2의 요구 항목을 담는다 |
| `stimulusRound` | `SCR-STIM` | `{ inquiryId: InquiryId; roundNo: integer ≥ 1 }`(08 Stimulus.round와 같이 첫 자극 라운드가 1) | `stimulusRound:<inquiryId>:<n>` | - | 04 §3.9. 이미지·긴 문서는 `BlobRef`만 싣는다 |
| `work` | `SCR-WORK` | `{ concernId: ConcernId }` | `work:<id>` | - | 04 §3.10 |
| `agreement` | `SCR-AGREE` | `{ agreementId: AgreementId }` | `agreement:<id>` | - | 04 §3.11 |
| `review` | `SCR-REVIEW` | `{ resultId: ResultId } \| { workUnitId: WorkUnitId }`(결과 제출 `rs_`) | `review:<id>` | - | 04 §3.12. 반영 범위 합의 초안(08 `integrationAgreementDraft`)을 구조 값으로 싣는다(판정 J-126). 휴대폰에서 확인할 수 있는지는 데몬이 정하는 `mobileReviewable`과 이유 키 `mobileReason`(04 §3.12)으로 보인다. 거짓이면 휴대폰 기기의 `result.accept`는 `1010`(`required: "decide"`, `field: "decision"`)으로 거절한다(판정 J-139·J-174) |
| `loopTimeline` | `SCR-LOOPS` | `{ concernId: ConcernId; detail: "meaningful" \| "all" }` | `loopTimeline:<id>:<detail>` | - | 04 §3.13. 계획 기록은 `authoredBy`(`code`·`model`·`human`)를 싣고, `model`이면 화면이 모델이 설계한 계획임을 표시한다(판정 J-188) |
| `thread` | `SCR-THREAD` | `{ concernId: ConcernId }` + `page` | `thread:<id>` | - | 04 §3.14 |
| `evidenceChain` | `SCR-EVIDENCE` | `{ recordId: AnyRecordId; depth?: 1..8 }`(기본 3) | `evidenceChain:<id>:<d>` | - | 04 §3.15 |
| `goals` | `SCR-GOALS` | `{}` | `goals` | `@goals` | 04 §3.16 |
| `goal` | `SCR-GOAL` | `{ goalId: GoalId }` | `goal:<id>` | - | 04 §3.16. 초안(`proposed`)·자리표시 Goal도 이 뷰로 본다 |
| `dials` | `SCR-DIALS` | `{ scope: DialScope }`(08 `DialLayer`: user · concern · instruction, 판정 J-136) | `dials:<scope>` | `@dials` | 04 §3.17 |
| `observerProposals` | `SCR-OBSERVER` | `{ status?: string[] }` | `observerProposals` | `@observer` | 04 §3.18 |
| `devices` | `SCR-CONNECT` | `{}` | `devices` | `@devices` | 04 §3.19 |
| `recovery` | `SCR-RECOVERY` | `{}` | `recovery` | `@recovery` | 04 §3.20 |
| `records` | `SCR-RECORD` | `{ subjectId: AnyRecordId }` + `page` | `records:<id>` | - | 04 §3.23. 비밀은 데몬이 가린다(18) |
| `tray` | `SCR-TRAY` | `{}` | `tray` | `@tray` | `TrayView`(아래), 04 §3.24 |
| `settings` | `SCR-SETTINGS` | `{ section?: "notifications" \| "attention" \| "display" \| "delivery" }` | `settings[:section]` | `@settings` | 04 §3.21. 데몬 쪽 설정만. 결과 확인 알림 설정(`notifications.resultReview`·`notifications.resultReviewDigestAt`, 판정 J-189)과 방해·알림 상한·조용한 시간(`attention.snoozeUntil`·`attention.interruptsPerHour`·`attention.quietHours`, 판정 J-166·J-171·J-195)을 보인다. 계획 작성 방식(`planAuthoring`, 사용자 층, 바꾸기는 `dial.set`, [판정 J-192])과 검색 제공자 순서·월 상한·키 등록 여부(`webSearch`, 키 값은 싣지 않는다, [판정 J-190])도 보인다 |
| `metrics` | `SCR-METRICS` | `{ metricIds?: string[]; window?: "7d" \| "14d" \| "28d" }`(판정 J-78) | `metrics[?…]` | `@metrics` | 16 §3.24 |
| `evaluation` | 2주 평가 보고 | `{ reportId?: string }` | `evaluation[:id]` | `@metrics` | 16(평가 보고) |

```ts
// packages/protocol/src/views.ts
export const ViewName = Enum(["home", "brief", "inbox", "question", "autonomous", "concernTree", "concern", "inquiry",
  "stimulusRound", "work", "agreement", "review", "loopTimeline", "thread", "evidenceChain", "goals", "goal", "dials",
  "observerProposals", "devices", "recovery", "records", "tray", "settings", "metrics", "evaluation"]);
export const DialScope = Type.Union([                    // 08 DialLayer(저장 층)와 scopeId. Goal 범위 없음(판정 J-136)
  Obj({ layer: Type.Literal("user") }),
  Obj({ layer: Type.Literal("concern"), concernId: ConcernId }),
  Obj({ layer: Type.Literal("instruction"), workUnitId: WorkUnitId }),
]);
/** 뷰마다 params 스키마, 화면 ID, 기본 집계 태그. 위 표를 그대로 옮긴다. 예: */
export const VIEW_SPECS = {
  question: { params: Obj({ questionId: QuestionId }), screen: "SCR-QUESTION", tags: [] },
  stimulusRound: { params: Obj({ inquiryId: InquiryId, roundNo: Type.Integer({ minimum: 1 }) }), screen: "SCR-STIM", tags: [] },
  dials: { params: Obj({ scope: DialScope }), screen: "SCR-DIALS", tags: ["@dials"] },
  // … 표의 모든 행
} as const satisfies Record<Static<typeof ViewName>, { params: TSchema; screen: string; tags: readonly string[] }>;

/** tray 뷰 데이터. 트레이는 질문 내용을 보이지 않는다(04 §3.24) */
export const TrayView = Obj({
  rightsPending: Type.Integer({ minimum: 0 }),      // "선택 필요": 전달된 권리 게이트 질문 수(배지)
  infoPending: Type.Integer({ minimum: 0 }),        // "확인하면 좋은 것"
  running: Type.Array(Obj({ concern: RecordRef, workUnit: RecordRef, nowDoing: Type.String({ maxLength: 200 }) }), { maxItems: 5 }),
  dnd: Obj({ on: Type.Boolean(), until: Nullable(IsoTime) }),
});
```

- 뷰 키는 `view.get` 응답의 `key`가 정본이다. 클라이언트가 직접 만들지 않는다(파라미터 정규화 규칙을 서버 한 곳에 둔다).
- 모든 뷰의 `data` 안 레코드 참조는 §3.7.2의 `RecordRef` 하나를 쓴다. `kind`는 08 레코드 kind 리터럴에서 파생하므로 04·12·21이 다른 이름(예: `boundary`, `outcome_submission`)을 쓰지 않는다. 화면용 묶음이 필요하면 다른 이름의 계산 필드로 둔다(04에 요구).
- 레코드 필드의 타입은 `@helm/domain`(08)에서 가져다 쓴다. 프로토콜이 레코드 스키마를 다시 정의하지 않는다(08 §5.2). 뷰 모델은 레코드를 화면용으로 줄인 것이므로 04가 정의하되, 레코드 필드를 그대로 싣는 곳은 08 값(상태 이름, 결과 확인 기록 값 `accepted`·`conditional`·`revision_requested`·`rejected`·`criteria_wrong` 등)을 쓴다. 시각은 ISO로 바꾼다.
- 홈(`home`)·질문함(`inbox`)·다이얼(`dials`) 뷰의 `data`는 주의 예산 막대 `attentionBudget`을 싣는다(04 §3.1·§3.3·§3.17, 14 §3.13.8). 형식은 04가 정한다.
- `freshness: "failed"`는 정상 응답의 한 값이다. 데몬이 그 뷰를 만들지 못한 이유를 `staleReason`에 넣는다(04 §3.0.3의 오류 상태). 뷰 이름이 틀리면 `2004`, 대상이 없으면 `2005`다.

#### 3.7.5 명령 메서드 [제안]

공통 규칙:

- 모든 명령 메서드의 params는 `Cmd({...})`(§3.7.2의 `CommandBase` + 메서드별 필드, 닫힌 객체)다. 결과는 `CommandResult`다. 실패는 §3.3.4의 3000번대·5000번대 오류다.
- 데몬은 params를 10 payload로 바꿔(§3.7.9) 06 `EngineInput`을 만든다. `channel: "human_client"`, `actor: "human"`(08 §3.3.2 문자열), `via`(§3.9.2), `provenance.adapterId: "client:<client.kind>"`, `provenance.externalRunId: <connection.id>`는 서버가 채운다. 클라이언트가 보낸 행위자·채널·provenance 값은 받지 않는다(스키마에 필드가 없다). 새 레코드 ID(`objectionId`, `acceptanceId` 등)는 데몬이 만든다.
- 사람이 입력한 자유 텍스트(`note`, `reason`, `text`, `edits`의 문자열)는 10 payload로 바꾸기 전에 18의 입력 단계 마스킹을 거친다(판정 J-147). 비밀 형태가 보이면 가린 값으로 바꾸고 원문은 남기지 않는다.
- 사람의 결정은 이 메서드로만 들어온다. assistant-ui 도구 카드의 버튼도 도구 결과(`addToolResult`)를 쓰지 않고 이 메서드를 부른다(발췌4 20-9, v0.3 12 §11.2).
- 명령은 화면 상태를 바꾸지 않는다. 화면은 결과 이벤트의 무효화로 바뀐다(§3.5.9, §3.6.3).

```ts
// packages/protocol/src/commands.ts
import { Type, type Static } from "typebox";
import { Obj, Nullable, Enum, AnyRecordId, QuestionId, ObjectionId, ChoiceId, FindingId, PossibilityId, PreferenceModelId,
  StimulusId, InquiryId, ObservationId, AgreementId, GrantId, ResultId, ObligationId, GoalId, ConcernId, WorkUnitId,
  ToolCallId, ExpectationId, CheckId, LensId, ProjectId, PolicyProposalId, ThreadId, DeviceId, ConnectionId,
  CriterionId, BlobId, Merge, ObjectionTarget, Scope as AgreementScope, AgreementContent, Trigger, ElementSelector,
  GoalCore, ConcernCore, GrantCore, LoopPlanCore, LoopIdSchema, ChoiceHumanCore, DialKey, ModeId, Sha256, ShortText } from "@helm/domain/schema";
// ChoiceHumanCore = 10 ChoiceCommitPayload.core(08 ChoiceCommon + gate). 08·10이 이 이름으로 export하도록 요구
import { AnswerValue } from "@helm/domain/question";        // 11 §3.2.3 (TypeBox로 두도록 11에 요구)
import { Cmd, IsoTime, Pos, RecordRef } from "./common.js";
import { BlobRef } from "./files.js";
import { DialScope } from "./views.js";

const Note = Type.String({ minLength: 1, maxLength: 2000 });  // 사람 메모. 08 ShortText보다 길면 10 payload로 바꿀 때 자르고 원문은 blob(08 §3.4.1)
const Reopen = Enum(["C.commit", "I.fact", "I.want"]);        // 08 AcceptanceCore.reopenTo, Concern.reopen 대상 루프

// ── 질문 (11·04 §3.4) ─────────────────────────────────────────
export const QuestionAnswerParams = Cmd({
  questionId: QuestionId,
  /** 11 AnswerValue 그대로. 범위 줄여 진행은 { option: "narrow_scope", instruction }, 고쳐서 허락은 approve_edited.
   *  기준 확인(criterion_confirm)은 { option: "confirm_items", items: [{ key, decision: "confirm" | "reject" | "keep", edits?, weight? }] }(11 §3.2.3, [판정 J-258]).
   *  무게(weight?)와 edits?는 decision이 confirm인 항목에만 싣는다(10 §3.11.9, [판정 J-262·J-263]).
   *  agreement_confirm·result_review 질문에는 쓰지 않는다(판정 J-124) */
  answer: AnswerValue,
  note: Type.Optional(Note),
});
export const QuestionProceedWithAssumptionParams = Cmd({ questionId: QuestionId });
export const QuestionRequestReframeParams = Cmd({ questionId: QuestionId, note: Note });
export const QuestionRequestInquiryParams = Cmd({ questionId: QuestionId, note: Type.Optional(Note) });   // → experiment_first.experiment
export const QuestionDelegateParams = Cmd({ questionId: QuestionId, note: Type.Optional(Note) });
export const QuestionDeferParams = Cmd({
  questionId: QuestionId,
  /** 11 QuestionDeferPayload.until과 같은 이름과 모양이다(변환 없음) */
  until: Type.Union([
    Obj({ kind: Type.Literal("boundary"), boundary: Enum(["next_work_boundary", "user_return"]) }),
    Obj({ kind: Type.Literal("at"), at: IsoTime }),
    Obj({ kind: Type.Literal("condition"), label: ShortText }),
  ]),
  deadline: Type.Optional(IsoTime),                // 권리 질문에 사람이 마감을 정할 때(판정 J-49)
});
export const QuestionEscalateParams = Cmd({ questionId: QuestionId });   // "지금 보기"

// ── 이의·확인 (05 §3.3, 04 §3.26) ─────────────────────────────
export const ObjectionFileParams = Cmd({
  target: ObjectionTarget,                         // 08 형식(판정 J-36). 기준별 판정은 { kind: "record", id: rs_…, itemKey: "criterion:<cr>" }
  reason: Type.Optional(Note),                     // 선택(판정 J-20). 없으면 "이유 없는 이의"다
  reasonKind: Type.Optional(Enum(["wrong_evidence", "missed_counter", "wrong_value", "wrong_scope", "should_have_asked", "other"])),   // 08 ObjectionCore.reasonKind(선택, 05 칩, 16 집계). 없으면 null
  desiredEffect: Enum(["reopen", "ask_next_time", "note_only"]),   // 08(판정 J-53)
});
export const ObjectionDecideParams = Cmd({ objectionId: ObjectionId, note: Type.Optional(Note) });   // withdraw / dismiss
export const DecisionConfirmParams = Cmd({ targets: Type.Array(AnyRecordId, { minItems: 1, maxItems: 200 }) });
export const AutonomousMarkSeenParams = Cmd({
  upToSeq: Pos,                                    // 이 seq까지 에이전트가 정한 것을 봤음
  concernId: Type.Optional(ConcernId),             // 거른 화면에서 누른 경우
  targets: Type.Optional(Type.Array(AnyRecordId, { maxItems: 200 })),   // 항목 단위 "봤음"(04 §3.5)
});
export const ChoiceCommitParams = Cmd({ choiceId: Type.Optional(ChoiceId), core: ChoiceHumanCore, viaQuestion: Type.Optional(QuestionId) });   // core는 10 ChoiceCommitPayload.core(08)
export const ChoiceRevokeParams = Cmd({ choiceId: ChoiceId, reason: Note });
export const FindingDecideParams = Cmd({ findingId: FindingId, reason: Type.Optional(Note) });          // confirm / withdraw
// 기준 하나의 결정(criterion.confirm·criterion.reject). weight는 confirm에만 싣는다(10 §3.11.9, [판정 J-262]).
export const CriterionDecideParams = Cmd({ preferenceModelId: PreferenceModelId, possibilityId: PossibilityId,
  criterionKey: Type.String({ pattern: "^c[0-9]{1,3}$" }), weight: Type.Optional(Enum(["low", "medium", "high"])) });

// ── 원함 탐구 반응 (15 §3.6.4, 08 §3.17.4) ──────────────────────
export const ReactionRecordParams = Cmd({
  /** 반응 대상. 자극(st_) 또는 가능성(ps_, 15 §3.4.11·대비) */
  subjectRef: AnyRecordId,
  roundNo: Type.Optional(Type.Integer({ minimum: 1 })),   // 자극 반응이면 그 라운드. inquiryId는 데몬이 라운드에서 채운다
  questionId: Type.Optional(QuestionId),           // 반응 요청 질문(stimulus_round·triad)에 대한 답이면 그 질문(08 §3.22.7 파생에 쓴다)
  kind: Enum(["strength", "no_reason", "rewrite", "triad_odd", "near", "comparison", "contrast", "comment"]),
  target: Type.Optional(Type.Union([
    Obj({ element: Type.String({ minLength: 1, maxLength: 64 }) }),
    Obj({ textRange: Obj({ start: Type.Integer({ minimum: 0 }), end: Type.Integer({ minimum: 0 }) }) }),   // 평문 기준
    Obj({ region: Obj({ x: Type.Number({ minimum: 0, maximum: 1 }), y: Type.Number({ minimum: 0, maximum: 1 }),
                         w: Type.Number({ minimum: 0, maximum: 1 }), h: Type.Number({ minimum: 0, maximum: 1 }) }) }),
  ])),                                              // 없으면 전체
  strength: Type.Optional(Enum([-2, -1, 0, 1, 2])), // kind strength. near는 강도 없이 보낸다
  rewrite: Type.Optional(Note),                     // kind rewrite
  triad: Type.Optional(Obj({ similar: Type.Array(StimulusId, { minItems: 2, maxItems: 2 }), different: StimulusId,
                              why: Type.Optional(Note), cannotSay: Type.Boolean() })),   // kind triad_odd. 08 triad와 같은 모양
  comparison: Type.Optional(Type.Union([                                       // kind comparison(2단계). 08 ReactionPayload.comparison과 같은 모양(판정 J-184)
    Obj({ kind: Type.Literal("prefer"), better: StimulusId, worse: StimulusId }),
    Obj({ kind: Type.Literal("neither"), pair: Type.Array(StimulusId, { minItems: 2, maxItems: 2 }) }),   // "둘 다 아님"은 이 값 하나로 보낸다. 두 자극에 strength -1 반응을 나눠 보내지 않는다
  ])),
  contrast: Type.Optional(Obj({ criterionKey: Type.String({ maxLength: 64 }), loss: Enum(["acceptable", "unacceptable", "unknown"]) })),   // kind contrast(15 §3.4.11)
  reason: Type.Optional(Note),
});
export const ReactionAmendParams = Cmd({ observationId: ObservationId, reason: Note });
export const ReactionWithdrawParams = Cmd({ observationId: ObservationId, note: Type.Optional(Note) });
export const StimulusRoundCloseParams = Cmd({ inquiryId: InquiryId, roundNo: Type.Integer({ minimum: 1 }) });
export const PossibilityPinParams = Cmd({ possibilityId: PossibilityId, pinned: Type.Boolean() });
export const PossibilityDismissParams = Cmd({ possibilityId: PossibilityId, reason: Type.Optional(Note) });

// ── 탐구 (15, 04 §3.8) ─────────────────────────────────────────
export const InquiryRequestFrameParams = Cmd({ inquiryId: InquiryId, op: Enum(["add", "merge"]), note: Note,
  possibilityIds: Type.Optional(Type.Array(PossibilityId, { minItems: 2, maxItems: 8 })) });   // merge면 합칠 가능성
export const InquiryProposeCandidateParams = Cmd({ inquiryId: InquiryId, text: Note });
export const InquiryMarkAssumptionParams = Cmd({ inquiryId: InquiryId, text: Note, basis: Type.Optional(Type.Array(AnyRecordId, { maxItems: 16 })) });
export const InquiryPinCheckParams = Cmd({ checkId: CheckId });
export const InquiryRequestDecisionParams = Cmd({ inquiryId: InquiryId });                      // → inquiry.stop(then decide_now)
export const InquiryStopParams = Cmd({ inquiryId: InquiryId, then: Enum(["proceed", "handoff"]), note: Type.Optional(Note) });
export const InquiryFillCellParams = Cmd({ inquiryId: InquiryId, cellId: Type.String({ maxLength: 64 }), note: Type.Optional(Note) });
export const InquiryPinLensParams = Cmd({ lensId: LensId, pinned: Type.Boolean() });
export const ExpectationReviseParams = Cmd({ expectationId: ExpectationId, dueAt: Type.Optional(IsoTime), note: Type.Optional(Note) });

// ── 작업 합의 C (11·04 §3.11) ──────────────────────────────────
/** 10 AgreementDecidePayload.edits = Partial<AgreementContent>. 구조로만 고친다. 자연어 고침은 correctUnderstanding */
export const AgreementEdits = Type.Partial(AgreementContent);
export const AgreementConfirmParams = Cmd({ agreementId: AgreementId, edits: Type.Optional(AgreementEdits),
  exclude: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 32 })) });   // 넓어진 항목 빼고 맡기기
export const AgreementReviseParams = Cmd({ agreementId: AgreementId, note: Note,
  part: Type.Optional(Enum(["understoodPurpose", "expectedEndState", "firstSteps", "willStopWhen", "proceedsAutomatically"])),
  content: Type.Optional(AgreementContent) });   // proposed: 다시 쓰기 요청(note·part). active: 새 내용(content 필수)
export const AgreementNarrowParams = Cmd({ agreementId: AgreementId, scope: AgreementScope, reason: Note });   // 좁힌 범위(08 Scope). 넓히면 커널이 거부
export const AgreementRenegotiateParams = Cmd({ agreementId: AgreementId, content: AgreementContent, reason: Note });
export const AgreementDeclineParams = Cmd({ agreementId: AgreementId, note: Type.Optional(Note) });
export const AgreementReleaseParams = Cmd({ agreementId: AgreementId, reason: Note });
export const AgreementCorrectUnderstandingParams = Cmd({ agreementId: AgreementId,
  part: Enum(["understoodPurpose", "expectedEndState", "firstSteps", "willStopWhen", "proceedsAutomatically"]), note: Note });
export const GrantIssueParams = Cmd({ grantId: Type.Optional(GrantId), core: GrantCore });
export const GrantRevokeParams = Cmd({ grantId: GrantId, reason: Note });

// ── 결과 확인 A (04 §3.12) ─────────────────────────────────────
export const ResultAcceptParams = Cmd({
  resultId: ResultId,                              // 결과 제출(08 rs_)
  /** 10 명령 값. 기록 값(08 accepted·conditional·revision_requested·rejected·criteria_wrong)과의 대응은 판정 J-35 */
  decision: Enum(["accept", "accept_with_conditions", "request_changes", "reject", "criteria_wrong"]),
  conditions: Type.Optional(Type.Array(ShortText, { maxItems: 16 })),   // accept_with_conditions면 1개 이상
  criteriaReview: Type.Optional(Type.Array(Obj({ criterionId: CriterionId, verdict: Enum(["confirmed", "not_confirmed", "waived"]),
                                                  note: Type.Optional(ShortText) }))),
  /** reject·criteria_wrong이면 필수. 직전 I가 있으면 클라이언트가 그 루프를 기본값으로 채워 보내고, 없으면 사람이 같은 행에서 고른다(판정 J-24) */
  reopenTo: Type.Optional(Reopen),
  /** 반영 처리 방침(08 AcceptanceCore.obligationPolicy). accept·accept_with_conditions면 필수 */
  obligationPolicy: Type.Optional(Enum(["proceed_all", "defer_limits"])),
  /** 반영 범위 합의 초안(결과 제출의 integrationAgreementDraft)을 그대로 또는 고쳐(edits) 같은 조작으로 확정한다(판정 J-126). accepted·conditional이면 같은 트랜잭션에서 agreement.confirmed(via 결과 확인). 10 ResultAcceptPayload.integrationAgreement와 같은 모양 */
  integrationAgreement: Type.Optional(Obj({ agreementId: AgreementId, edits: Type.Optional(AgreementEdits) })),
  deferObligations: Type.Optional(Type.Array(Obj({ obligationId: ObligationId, reason: ShortText, revisitTrigger: Trigger }), { maxItems: 32 })),
  /** 결과 확인과 함께 답한 질문(11 §3.15, 판정 J-124) */
  bundledAnswers: Type.Optional(Type.Array(Obj({ questionId: QuestionId, answer: AnswerValue }), { maxItems: 16 })),
  note: Type.Optional(Note),
});
export const ObligationConfirmDoneParams = Cmd({ obligationId: ObligationId, refs: Type.Optional(Type.Array(AnyRecordId, { maxItems: 16 })), note: Type.Optional(Note) });
export const ObligationDeferParams = Cmd({ obligationId: ObligationId, reason: ShortText, revisitTrigger: Trigger });   // 08 Obligation.deferral
export const ObligationTransferParams = Cmd({ obligationId: ObligationId,
  to: Type.Union([Obj({ concernId: ConcernId }), Obj({ workUnitId: WorkUnitId })]), reason: ShortText });
export const ObligationWaiveParams = Cmd({ obligationId: ObligationId, reason: ShortText });
export const ObligationReopenParams = Cmd({ obligationId: ObligationId, reason: Type.Optional(ShortText) });

// ── 프로젝트·Goal (04 §3.16, UC-11) ────────────────────────────
export const ProjectCreateParams = Cmd({ projectId: Type.Optional(ProjectId), name: Type.String({ minLength: 1, maxLength: 200 }),
  rootPath: Type.String({ minLength: 1, maxLength: 4096 }) });   // 허용 폴더 등록은 18·13 규칙으로 검사한다
export const GoalProposeParams = Cmd({ goalId: Type.Optional(GoalId), core: GoalCore, activateNow: Type.Optional(Type.Boolean()) });
export const GoalActivateParams = Cmd({ goalId: GoalId, edits: Type.Optional(Type.Partial(GoalCore)) });   // edits: 고쳐서 시작(10에 요구)
export const GoalReviseParams = Cmd({ goalId: GoalId, changes: Type.Partial(GoalCore), reason: Note });     // 10 GoalRevisePayload
export const GoalRevisionDecideParams = Cmd({ goalId: GoalId, edits: Type.Optional(Type.Partial(GoalCore)), note: Type.Optional(Note) });   // confirmRevision / rejectRevision
export const GoalAchievementDecideParams = Cmd({ goalId: GoalId, note: Type.Optional(Note) });               // confirmAchieved / rejectAchieved
export const GoalStateParams = Cmd({ goalId: GoalId, reason: Note });                                         // pause / resume / retire

// ── Concern·루프·구조 (04 §3.6·§3.7) ────────────────────────────
export const ConcernProposeParams = Cmd({ concernId: Type.Optional(ConcernId), core: ConcernCore });   // origin·entrySignals 포함(08 §3.6.1)
export const ConcernReviseParams = Cmd({ concernId: ConcernId, title: Type.Optional(Type.String({ maxLength: 200 })),
  description: Type.Optional(Note), goalId: Type.Optional(GoalId) });   // 10 concern.update
export const ConcernHoldParams = Cmd({ concernId: ConcernId, revisit: Type.Optional(Trigger), reason: Note });
export const ConcernResumeParams = Cmd({ concernId: ConcernId });
export const ConcernCloseParams = Cmd({ concernId: ConcernId, result: Enum(["completed", "not_completed"]), reason: Note, force: Type.Optional(Type.Boolean()) });
export const ConcernReopenParams = Cmd({ concernId: ConcernId, toLoop: LoopIdSchema, cause: AnyRecordId, reason: Note });
export const LoopPlanReviseParams = Cmd({ concernId: ConcernId, core: LoopPlanCore });
export const LoopRequestTransitionParams = Cmd({ concernId: ConcernId, from: LoopIdSchema, to: LoopIdSchema, reason: Type.Optional(Note) });
export const StructureRequestParams = Cmd({ concernId: ConcernId, op: Enum(["split", "merge", "hold", "detach", "relocate"]),
  note: Note, withConcernId: Type.Optional(ConcernId) });

// ── 다이얼·모드·설정 (14) ───────────────────────────────────────
export const DialSetParams = Cmd({ scope: DialScope, key: DialKey, value: Type.Unknown(), reason: Type.Optional(ShortText) });   // value는 14 DIAL_DEFS[key].valueSchema로 다시 검사. planAuthoring은 computed·hybrid(기본)·model 중 하나이고 층은 user·concern뿐이다(판정 J-188, 결정 53)
export const DialUnsetParams = Cmd({ scope: DialScope, key: DialKey, reason: Type.Optional(ShortText) });
export const ModeSetParams = Cmd({ concernId: ConcernId, mode: ModeId, reason: Type.Optional(Note) });   // 08 MODE_IDS
export const SettingsUpdateParams = Cmd({ section: Enum(["notifications", "attention", "delivery", "display"]),
  patch: Type.Record(Type.String(), Type.Unknown()) });   // 키와 값 스키마는 14 DIAL_DEFS의 kind "setting"(@helm/domain)
// notifications 섹션의 키(판정 J-189, 결정 56): resultReview = "none"(기본) | "daily_digest" | "immediate", resultReviewDigestAt = "HH:MM"(기본 "19:00", 서버 시간대). 변경은 setting.changed(09)로 남는다
// attention 섹션의 키(판정 J-166·J-171·J-195): snoozeUntil(방해 금지), interruptsPerHour(시간당 알림 상한), quietHours(조용한 시간). 값 스키마는 14 DIAL_DEFS다

// ── 관찰 제안 (16) ──────────────────────────────────────────────
export const ObserverProposalAdoptParams = Cmd({ proposalId: PolicyProposalId, edits: Type.Optional(Type.Unknown()) });
export const ObserverProposalDeclineParams = Cmd({ proposalId: PolicyProposalId, reason: Type.Optional(Note), scope: Type.Optional(Enum(["this", "family_forever"])) });   // 판정 J-75
export const ObserverProposalSnoozeParams = Cmd({ proposalId: PolicyProposalId, until: IsoTime });

// ── 진행 작업 제어 (12 §3.12.4, 04 §3.10) ───────────────────────
export const WorkSteerParams = Cmd({ workUnitId: WorkUnitId, note: Note });
export const WorkIdParams = Cmd({ workUnitId: WorkUnitId, reason: Type.Optional(Note) });   // pause / resume / stop / abort
export const ThreadCompactParams = Cmd({ threadId: ThreadId });

// ── 대화 입력 (04 §3.14) ────────────────────────────────────────
export const ComposerSubmitParams = Cmd({
  scope: Type.Union([Obj({ concernId: ConcernId }), Obj({ global: Type.Literal(true) })]),   // global: 홈 입력창
  text: Type.String({ minLength: 1, maxLength: 32768 }),
  attachments: Type.Optional(Type.Array(BlobRef, { maxItems: 16 })),   // 먼저 업로드한 파일(§3.11)
  whenBusy: Type.Optional(Enum(["followUp", "steer"])),               // 실행 중일 때. 기본 followUp
  previewId: Type.Optional(Type.String({ maxLength: 64 })),           // composer.preview의 결과 ID
  choice: Type.Optional(Type.Union([Obj({ interpretationId: Type.String({ maxLength: 64 }) }), Obj({ asChat: Type.Literal(true) })])),
});

// composer.preview (read 종류, scope decide): 보내기 전에 입력의 뜻과 진입 예비 판정을 미리 본다(21 SemanticPreviewVM, 01 R-OP-2(b))
export const ComposerPreviewParams = Obj({
  scope: Type.Union([Obj({ concernId: ConcernId }), Obj({ global: Type.Literal(true) }), Obj({ goalId: GoalId }),
                     Obj({ workUnitId: WorkUnitId }), Obj({ questionId: QuestionId })]),
  text: Type.String({ minLength: 1, maxLength: 32768 }),
});
export const SemanticPreviewResult = Obj({
  previewId: Type.String({ maxLength: 64 }),     // composer.submit에 함께 보내면 같은 해석과 판정을 쓴다
  interpretations: Type.Array(Obj({
    id: Type.String({ maxLength: 64 }),
    as: Enum(["question", "constraint_change", "choice", "request", "criterion_change", "objection", "chat"]),
    summary: Type.String({ maxLength: 500 }),
    affects: Type.Array(RecordRef),
    impact: Enum(["low", "high"]),
  })),
  /** 진입 예비 판정(01 §3.6.3)과 가벼운 작업의 echo(01 R-OP-2(b)). 보내기 버튼 문구에 echo를 담는다(04 §3.6.1) */
  entry: Obj({
    verdict: Enum(["light", "concern", "ask"]),   // 가벼운 작업으로 진행 / Concern으로 열기 / 확정 질문
    signals: Type.Array(Type.String({ maxLength: 64 })),
    echo: Nullable(Type.String({ maxLength: 500 })),   // light일 때 "README 오타 3곳 고치기"처럼 할 일 한 줄
  }),
});

// localConfirm.request (read 종류): local 리스너 tty_cli 연결이 사람 결정 명령을 보내기 전에 확인 요청을 받는다(18 §3.5 규칙 6)
export const LocalConfirmRequestParams = Obj({ method: Type.String({ maxLength: 96 }), params: Type.Record(Type.String(), Type.Unknown()) });
export const LocalConfirmRequestResult = Obj({ confirmId: Type.String({ maxLength: 64 }), summary: Type.String({ maxLength: 500 }),
  code: Type.String({ pattern: "^[A-Z0-9]{4}$" }), expiresAt: IsoTime });   // 2분, 1회. code를 화면에 보이고 사람이 친 값을 localConfirm에 싣는다

// ── 실험 측정 (16) ──────────────────────────────────────────────
// payload 정본은 16(§3.27 측정 흐름). 이름은 판정 J-10·J-78("복귀 점검")
export const SurpriseReportParams = Cmd({ subjectId: AnyRecordId, note: Type.Optional(Note) });
export const ResumptionCheckAnswerParams = Cmd({ checkId: Type.String({ maxLength: 64 }), answer: Type.Union([Note, Type.Record(Type.String(), Type.Unknown())]) });
export const ResumptionCheckScoreParams = Cmd({ checkId: Type.String({ maxLength: 64 }), score: Type.Number(), note: Type.Optional(Note) });
export const SelfReportSubmitParams = Cmd({ instrument: Type.String({ maxLength: 64 }), item: Type.String({ maxLength: 64 }), score: Type.Union([Type.Number(), Type.String({ maxLength: 200 })]) });

// ── 안전 모드 해제 (12 §3.7.6, 17 §3.4.6) ───────────────────────
export const DaemonExitSafeModeParams = Cmd({ reason: Type.Optional(Note) });

// ── 복귀 요약·복구 ──────────────────────────────────────────────
export const BriefAcknowledgeParams = Cmd({
  upToSeq: Pos,                                    // 사람 단위 마지막 확인 위치
  projectId: Nullable(ProjectId),                  // 11 BriefAcknowledgePayload.projectId
  note: Type.Optional(Note),                       // check-back 한 줄(04 요구). 09 brief.acknowledged payload에 더하도록 요구
  /** 휴대폰 요약판으로 확인했다(판정 J-137). 줄여 본 반대 근거·이견 항목은 다음 데스크톱 요약에 "휴대폰에서 줄여 본 항목"으로 남는다 */
  compact: Type.Optional(Type.Boolean()),
});
export const BriefCorrectParams = Cmd({ line: Type.String({ maxLength: 64 }), note: Note });
/** 선택지 집합은 12 §3.7.4가 정한다. 04·02·26 화면은 이 집합을 쓴다 */
export const RecoveryResolveParams = Cmd({
  target: Type.Union([
    Obj({ kind: Type.Literal("toolCall"), toolCallId: ToolCallId, questionId: Type.Optional(QuestionId),
          resolution: Enum(["confirmed_applied", "confirmed_not_applied", "manual_review"]) }),   // → 10 toolcall.recover
    Obj({ kind: Type.Literal("workUnit"), workUnitId: WorkUnitId,
          action: Enum(["rerunFromCheckpoint", "leaveAsIs", "createCheckTask"]) }),             // → 12 실행 수준 동작
  ]),
  note: Type.Optional(Note),
});
```

메서드별 결과의 특이점:

| 메서드 | `status` | `created`·`runId` |
|---|---|---|
| `composer.submit` | `applied`(입력이 기록됨). 실행은 이어서 런타임이 시작한다 | 실행이 바로 시작되면 `runId` |
| `concern.propose` | `applied` | `{ concernId }`(초안 Concern) |
| `project.create`, `goal.propose` | `applied` | `{ projectId }`, `{ goalId }` |
| `objection.file` | `applied` | `{ objectionId }` |
| `result.accept` | `applied` | `{ acceptanceId }`, 반영 범위 합의를 확정했으면 `{ integrationAgreementId }` |
| `work.pause` / `work.stop` | `accepted`(경계에 이르면 이벤트) | `runId` |
| `work.abort` | `applied`(중단 기록) | - |
| `stimulusRound.close` | `applied` | 다음 라운드 준비는 이벤트로 |
| `recovery.resolve`(`rerunFromCheckpoint`, `createCheckTask`) | `accepted` | `runId` 또는 `jobId` |
| `thread.compact` | `accepted` | - |
| 그 밖 | `applied` 또는 `gated` | - |

`basisSeq`가 쓰이지 않는 명령: `reaction.*`, `composer.submit`, `brief.*`, `dial.*`, 측정 명령은 대상의 낡음 검사를 하지 않는다(10 §3.11.12 `subjects()`가 빈 목록). 그래도 형식을 하나로 두기 위해 필드는 필수다.

#### 3.7.6 파일 메서드

```ts
export const BlobTicketParams = Obj({ blobId: BlobId, variant: Type.Optional(Enum(["thumb", "display"])) });
export const BlobTicketResult = Obj({ path: Type.String({ pattern: "^/files/t/[A-Za-z0-9_-]{43}$" }), expiresAt: IsoTime });
```

업로드는 HTTP만 쓰고 JSON-RPC 메서드가 없다(§3.11.3).

#### 3.7.7 기기·연결 관리

```ts
// packages/protocol/src/devices.ts
export const PushInfo = Obj({                        // 26 §3.4.6. 원문(엔드포인트·키)은 실리지 않는다
  channel: Enum(["webpush", "apns"]),               // 1차는 webpush만 받는다. apns는 경로 B 예약(결정 47·57)
  registeredAt: IsoTime,
  fingerprint: Type.String({ pattern: "^[0-9a-f]{8}$" }),   // 08 PushRegistration.tokenHint
  minUrgency: Enum(["interrupt", "notice"]),     // 기본 notice(결정 48)
  state: Enum(["ok", "failing", "needs_refresh"]),
  lastOkAt: Nullable(IsoTime),
});
export const DeviceInfo = Obj({
  deviceId: DeviceId,
  name: Type.String({ minLength: 1, maxLength: 64 }),
  platform: Enum(["macos", "windows", "linux", "ios"]),
  clientKind: Enum(["desktop", "mobile", "tui", "cli"]),
  credentialCarrier: Enum(["header", "cookie"]),
  pairedAt: IsoTime,
  pairedVia: Enum(["code", "mobile_code", "ssh"]),
  lastSeenAt: Nullable(IsoTime),
  lastListener: Nullable(ListenerKind),
  tokenId: Type.String({ pattern: "^[0-9a-f]{12}$" }),   // sha256(토큰) 앞 12자(18 §3.8.1). 토큰 원문은 어디에도 없다
  tokenExpiresAt: IsoTime,                         // 절대 365일(18 §3.8.2)
  idleExpiresAt: IsoTime,                          // 마지막 인증 + 90일
  expiringSoon: Type.Boolean(),                    // 만료 30일 전부터 true
  revokedAt: Nullable(IsoTime),
  push: Nullable(PushInfo),
  scopes: Type.Array(Scope),
  current: Type.Boolean(),                         // 이 요청을 보낸 기기
});
export const DeviceListResult = Obj({ devices: Type.Array(DeviceInfo) });

export const DeviceRenameParams = Cmd({ deviceId: DeviceId, name: Type.String({ minLength: 1, maxLength: 64 }) });
export const DeviceRevokeParams = Cmd({ deviceId: DeviceId, reason: Type.Optional(Enum(["lost", "stolen", "replaced", "unused", "other"])),
  cascade: Type.Optional(Type.Boolean()) });   // 자기 자신도 된다(응답 뒤 4009). cascade: 그 기기가 만든 코드로 페어링된 기기(자식까지)도 폐기(18 §3.6, 대상 목록은 화면이 먼저 보인다)
export const DeviceExpireTokensParams = Cmd({ deviceId: DeviceId });   // 다음 접속부터 다시 페어링(18 §3.8.3)
export const DeviceRebindParams = Cmd({ deviceId: DeviceId });         // tailnet 노드 묶기를 풀어 다음 WSS 접속 때 다시 묶음(18 S-03, 로컬 관리자만)

// device.createPairingCode: 이미 페어링된 데스크톱·TUI 기기(또는 관리 CLI `helm pair`)가 새 기기용 코드를 만든다(18 §3.7 흐름 A)
export const DeviceCreatePairingCodeParams = Cmd({
  name: Type.Optional(Type.String({ maxLength: 64 })),
  target: Type.Optional(Enum(["desktop", "mobile"])),    // mobile이면 결과 link가 설치 주소(<publicOrigin>/m/)다(26 §3.3.4)
  ttlSec: Type.Optional(Type.Integer({ minimum: 60, maximum: 3600 })),   // 기본 600
});
export const DeviceCreatePairingCodeResult = Merge(CommandResult, Obj({
  code: Type.String({ pattern: "^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$" }),   // Crockford base32 12자(18 §3.7.2)
  expiresAt: IsoTime,
  link: Type.String({ maxLength: 512 }),   // desktop: helm://pair?v=1&url=<baseUrl>&code=<코드>&sid=<serverId>(20 §3.8.7), mobile: <publicOrigin>/m/
}));

export const ConnectionInfo = Obj({
  connectionId: ConnectionId, deviceId: Nullable(DeviceId), listener: ListenerKind, client: ClientInfo,
  openedAt: IsoTime, protocol: Type.Integer(), subscriptions: Type.Integer({ minimum: 0 }),
  presence: Type.Optional(PresenceReportState),
});
export const ConnectionListResult = Obj({ connections: Type.Array(ConnectionInfo) });
export const ConnectionCloseParams = Cmd({ connectionId: ConnectionId });
```

`DeviceInfo.push.fingerprint`는 08 `PushRegistration.tokenHint`와 같은 값(`tokenHash` 16진수 앞 8자)이다 [판정 J-260].

페어링 HTTP(흐름 A). 데스크톱은 `POST /pair`(헤더 운반), 휴대폰은 `POST /m/pair`(쿠키 운반, 26 §3.3.4):

```http
POST /pair HTTP/1.1
Content-Type: application/json

{"code":"K7Q4-XM92-PH3D","device":{"name":"MacBook Air","platform":"macos","clientKind":"desktop","publicKey":"<선택, 18 §3.8.5>"}}
```

- 성공: `200 {"serverId":"…","deviceId":"dv_…","deviceToken":"helm_dt_…","tokenExpiresAt":"…"}`(20 §5.2 (6)의 이름). 토큰은 이 응답에만 한 번 실린다. `Cache-Control: no-store`. 데스크톱은 Rust가 받아 키체인에 바로 넣는다. `Origin`이 있으면 403이다.
- `POST /m/pair`: 본문은 `{"code":…,"device":{"name":…}}`이고 기기 속성은 서버가 정한다(§3.2.5). 성공하면 `Set-Cookie: __Host-helm_dt=…; Path=/; Max-Age=<남은 수명>; Secure; HttpOnly; SameSite=Strict`와 본문 `{"serverId":…,"deviceId":…,"tokenExpiresAt":…}`. 토큰은 본문에 없다.
- 실패: `400` + 본문 `{"error": JsonRpcError}`(`1009 pairing.invalidCode`, 사유 구분 없음), `429` + `1011`. 본문은 4 KiB 이하(18 §3.14). 코드 정규화(대문자, `-`·공백 제거, `O→0`, `I/L→1`)는 서버가 한다.
- 흐름 B(SSH 발급): `ssh <서버> helm device issue --json --name … --platform … --client …`. 관리 CLI가 `local` 리스너에 `localAdmin`으로 붙어 `admin.issueDevice`를 부르고 표준 출력에 `HELM-DEVICE/1 {"serverId":…,"deviceId":…,"deviceToken":…}` 한 줄을 쓴다(18 §3.7.3, 20 §3.8.7). 휴대폰은 흐름 B를 쓰지 않는다.

토큰 교체(2차 기능, 18 §3.8.3):

```http
POST /devices/self/rotate HTTP/1.1
Authorization: Bearer <현재 토큰>
```

- `tailnet`·`loopback` 리스너, 헤더 운반 기기만. 성공: `200 {"deviceToken":"helm_dt_…","tokenId":"…","tokenExpiresAt":"…"}`, `no-store`. 이전 토큰은 5분 또는 새 토큰의 첫 사용 중 먼저 오는 때까지 함께 받는다. 데스크톱은 Rust 명령 `credential_rotate`가 부른다. 1차에서는 쓰지 않고 만료가 가까우면 다시 페어링한다.

#### 3.7.8 상태·진단·관리·presence

```ts
// packages/protocol/src/status.ts
// daemon.status: 17 OpsStatus(17 §3.11.1)를 줄여 만든다. 원격 기기에 내보내지 않는 것(PID, 경로, 키 원문 상태 세부)은 뺀다
export const DaemonStatus = Obj({
  server: HelloResult.properties.server,           // version, bootEpoch, startedAt, mode, modeReasons
  release: Obj({ releaseId: Type.String(), protocol: Type.Integer() }),
  uptimeSec: Type.Integer({ minimum: 0 }),
  health: Enum(["ok", "degraded", "critical"]),
  readOnlyReasons: Type.Array(ModeReason),         // 화면은 사유별 배너를 보인다(05 err.daemon.diskFull 등). "읽기 전용"(판정 J-115)
  safeMode: Nullable(Obj({ since: IsoTime, reason: Enum(["crash_loop", "restored"]), recentUncleanBoots: Type.Array(Obj({ epoch: Type.String({ minLength: 26, maxLength: 26 }), startedAt: IsoTime, lastEventAt: Type.Optional(IsoTime) })) })),   // 09 daemon.safe_mode_entered의 reason과 같다(판정 J-164). 수동 진입 사유는 없다(판정 J-165). recentUncleanBoots는 17 OpsStatus.safeMode의 목록을 그대로 싣는다. 개수는 화면이 센다(판정 J-202)
  log: Obj({ storeId: StoreId, headSeq: Pos, sizeBytes: Type.Integer({ minimum: 0 }), lastBackupAt: Nullable(IsoTime), lastBackupVerified: Type.Boolean() }),
  disk: Obj({ freeBytes: Type.Integer({ minimum: 0 }), warnBytes: Type.Integer(), criticalBytes: Type.Integer() }),   // 17 resources.diskFreeBytes, 5 GiB, 1 GiB
  runtime: Obj({ activeRuns: Type.Integer({ minimum: 0 }), waitingHuman: Type.Integer({ minimum: 0 }), nextScheduledAt: Nullable(IsoTime) }),
  /** 모델 제공자 상태(판정 J-150: 본문 "제공자", 화면 "모델 제공자", 코드 provider). 값은 12 게이트웨이 health() 이름. 바뀌면 즉시 갱신(12 onHealthChange) */
  models: Type.Array(Obj({ provider: Type.String({ maxLength: 64 }), status: Enum(["ok", "missing_key", "auth_failed", "unreachable", "rate_limited"]) })),
  tools: Obj({ sandboxLevel: Enum(["S1", "S1b", "S0", "none"]) }),   // 13 §3.6.1. none이면 실행 도구가 꺼져 있다
  observer: Obj({ lastRunAt: Nullable(IsoTime), lastResult: Nullable(Enum(["ok", "failed"])) }),
  connections: Type.Integer({ minimum: 0 }),
  recoveryItems: Type.Integer({ minimum: 0 }),     // 복구 선택이 필요한 항목 수(SCR-RECOVERY 배지)
  warnings: Type.Array(Obj({ key: Type.String({ maxLength: 64 }), args: Type.Optional(Type.Record(Type.String(), Type.String())) })),   // key는 17 점검 ID
});

/** presence.report: 클라이언트 → 서버 알림(응답 없음). 값은 09 PresenceState 중 기기가 보고하는 셋이다(판정 J-119).
 *  offline은 데몬이 연결이 없을 때 정하고, 부재(away)는 14 §3.13.8 파생 함수가 계산한다. locked는 없다(판정 J-118) */
export const PresenceReportState = Enum(["active", "idle", "hidden"]);
export const PresenceReportParams = Obj({
  state: PresenceReportState,
  screen: Type.Optional(Type.String({ pattern: "^SCR-[A-Z0-9-]+$" })),   // 03 화면 ID. 휴대폰은 SCR-M-*
  objectId: Type.Optional(AnyRecordId),            // 보고 있는 레코드
  depth: Type.Optional(Enum(["glance", "review", "audit"])),   // 03 §3.10 세 깊이. 감사 깊이 열람 기록용(판정 J-84)
});

// admin.* (local 리스너 + localAdmin만). 관리 메서드는 사람 결정이 아니므로 basisSeq를 받지 않는다. 멱등 키만 둔다
const Adm = <P extends TProperties>(p: P) => Obj({ idempotencyKey: IdempotencyKey, ...p });
export const AdminStatusResult = OpsStatus;       // 17 §3.11.1 OpsStatus를 그대로 돌려준다(17이 TypeBox로 둔다)
export const AdminIssueDeviceParams = Adm({ name: Type.String({ maxLength: 64 }), platform: Enum(["macos", "windows", "linux"]), clientKind: Enum(["desktop", "tui", "cli"]) });
export const AdminIssueDeviceResult = Obj({ deviceId: DeviceId, token: Type.String({ pattern: "^helm_dt_[A-Za-z0-9_-]{43}$" }) });
export const AdminDrainParams = Adm({ reason: Note, restartExpectedMs: Type.Optional(Type.Integer({ minimum: 0 })) });
export const AdminSetModeParams = Adm({ mode: Enum(["normal", "readOnly"]), reason: Note });
// admin.safeMode는 두지 않는다(판정 J-165). 안전 모드는 09가 정한 사유 crash_loop·restored로만 들어가고, 나오기는 daemon.exitSafeMode다
export const AdminBackupNowParams = Adm({ kind: Enum(["snapshot", "daily", "pre_upgrade"]) });   // 17 백업 종류
export const AdminVerifyParams = Adm({ full: Type.Optional(Type.Boolean()), blobs: Type.Optional(Type.Boolean()), anchors: Type.Optional(Type.Boolean()) });
export const AdminMaintainParams = Adm({ ifRunning: Type.Optional(Type.Boolean()) });   // 정기 유지 작업(17 §3.9.7)
export const AdminReloadParams = Adm({});            // admin.reloadConfig, admin.reloadSecrets
export const AdminJobResult = Obj({ jobId: Type.String({ maxLength: 64 }), status: Enum(["accepted", "done"]) });   // backupNow·verify·maintain은 accepted + jobId, 결과는 이벤트(17)
```

- `presence.report`는 알림이라 응답이 없다. 상태나 화면이 바뀔 때만 보낸다(최소 간격 2초, 같은 값은 다시 보내지 않는다). 형식이 틀리면 서버는 조용히 버리고 운영 로그에만 남긴다.
- 보고 문턱: 클라이언트는 마지막 입력이 문턱 안이면 `active`, 넘으면 `idle`로 보고한다. 문턱은 데스크톱 5분, 휴대폰 2분이고 14 §3.13.8 파생 함수의 입력 값과 같다(판정 J-119). 숨겨지면 `hidden`이다.
- 영속 기록(판정 J-46·J-110·J-119): 데몬의 연결 계층(`presence.ts`)이 기기별로 연결들의 마지막 보고를 모은다. 기기의 값은 연결 중 가장 활동적인 값(`active` > `idle` > `hidden`)이고, 기기의 마지막 연결이 닫히면 `offline`이다. 이 기기 값이 바뀔 때만 10 `presence.update { deviceId, state }`(09 `PresenceState` 값)를 런타임 채널로 제출해 `presence.changed`를 남긴다. 같은 값이면 제출하지 않는다. 12는 이 기록을 읽기만 한다.
- 질문 열람(26 §5.2 19 (10), 11 `question.seen`): 보고의 `objectId`가 질문(`qs_`)이고 그 질문이 `delivered` 상태이며 `state`가 `active`이면 데몬이 그 기기를 `via`로 10 `question.mark_seen`을 제출한다(채널 `human_client`, 행위자 `human`, 멱등 키는 `seen:<qsId>:<deviceId>`). 26의 지연 푸시 취소(§3.17)와 11 전달 판정이 이 기록을 쓴다. 별도 메서드는 두지 않는다.
- 열람 기록(16 `view.opened`)도 이 알림의 `screen`·`objectId` 변화로 데몬이 만든다(10 `view.record`, 16 §5.2의 19 요구 (2)). 보고의 `depth`는 `view.opened.depth`로 옮긴다(16). `SCR-M-*`은 데스크톱 대응 화면과 같은 종류로 센다(16). 결과 확인 화면에서 근거 체인을 열면 `screen`에 `SCR-EVIDENCE`를 보낸다(16 §3.23.1).
- `daemon.status`는 `read` scope로 누구나 부를 수 있다. 자세한 운영 진단은 `admin.status`(`OpsStatus` 전체, `local` 리스너)로 본다. `HelmClient`는 `admin()` 묶음으로 관리 메서드를 부른다(§3.14).
- `admin.*`의 의미(종료 예산, 읽기 전용 전이, 백업 절차)는 17이 소유한다. 이 문서는 메서드 이름, params, scope만 정한다.
- 안전 모드 해제 주체는 하나로 정한다: `daemon.exitSafeMode`(10 `runtime.exit_safe_mode`)를 데스크톱·TUI 기기(`devices`), 휴대폰(`decideMobile`), 대화형 `localAdmin`이 부를 수 있다. 해제하면 09 `daemon.safe_mode_exited`를 남기고, 관리 CLI는 `helm ops safe-mode off`다(17, 판정 J-153). 수동 진입 메서드 `admin.safeMode`는 두지 않는다(판정 J-165).

#### 3.7.9 params → 10 payload 변환 [제안]

데몬 `commands.ts`의 변환 함수 이름은 `toCommand_<메서드 이름의 점을 밑줄로>`(예: `toCommand_question_answer`)이고, 반환은 `{ type, payload }`다. `CommandBase` 필드(`idempotencyKey`, `basisSeq`, `expect`, `clientTime`, `localConfirm`)는 payload에 넣지 않고 envelope로 옮긴다(§3.9.2). 표에 없는 필드 대응은 이름이 같은 필드를 그대로 옮긴다. 시각(ISO)은 ms로 바꾼다.

| 메서드 | 10 `type` | 필드 대응 |
|---|---|---|
| `question.answer` | `question.answer` | `{ questionId, answer, note }` 그대로(11 `QuestionAnswerPayload`) |
| `question.proceedWithAssumption` | `question.answer` | `answer = { option: "accept_assumption" }` |
| `question.requestInquiry` | `question.answer` | `answer = { option: "experiment_first", experiment: note }` |
| `question.requestReframe` / `delegate` / `escalate` | `question.request_reframe` / `question.delegate` / `question.escalate` | 그대로 |
| `question.defer` | `question.defer` | `until` 그대로(`at`은 ms로), `deadline` ms |
| `objection.file` | `decision.contest` | `objectionId` 서버 발급. `concernId`는 커널이 도출한다(record 대상이면 그 레코드의 Concern, link면 `from`의 Concern. 10에 규칙을 요구). `reasonKind`는 그대로 싣고, `reason`이 없으면 `null`로 보낸다(08 `ObjectionCore`) |
| `autonomous.markSeen` | `autonomous.mark_seen` | `{ upToSeq, targets }`. `concernId`가 있으면 그 Concern 아래 대상만 |
| `reaction.record` | `observation.record` | `core = { obsKind: "reaction", source: 사람, reaction: ReactionPayload }`. `subjectRef` 그대로, `inquiryId` 서버가 라운드에서 채움, `target` → 08 `ElementSelector`(없음 → `whole`, `element` → `element`, `textRange` → `text_range`, `region` → `region`), `strength` → `intensity`, `no_reason` → `intensity -1, reason null`, `rewrite` → `rephrase`, `near` → `near: true, intensity: null`, `triad` 그대로(`why`·`cannotSay`), `comparison` 그대로, `contrast` → `subjectRef = ps_`, `target.element = "loss:<criterionKey>"`, 강도는 loss 값의 15 §3.4.11 대응, `comment` → `reason`만. `questionId`는 관찰의 `reactionTo` |
| `reaction.amend` / `withdraw` | `reaction.amend` / `reaction.withdraw` | 그대로 |
| `stimulusRound.close` | `inquiry.round.close` | `{ inquiryId, roundNo, trigger: "human" }`(15 §5.2) |
| `possibility.pin` | `possibility.pin` 또는 `possibility.unpin` | `pinned`로 고른다 |
| `inquiry.requestFrame` | `inquiry.perspective.add`(add) / `possibility.merge`(merge) | merge면 `possibilityIds` |
| `inquiry.proposeCandidate` | `possibility.propose` | `core = { possibilityKind: "candidate", text, origin: "human" }`(08 PossibilityCore) |
| `inquiry.markAssumption` | `assumption.record` | `core = { text, origin: "declared", basis }` |
| `inquiry.requestDecision` | `inquiry.stop` | `{ inquiryId, reason: "human_decided", then: "decide_now" }` |
| `inquiry.stop` | `inquiry.stop` | `{ inquiryId, reason: "human_decided", then }` |
| `inquiry.pinLens` | `lens.update` | `{ lensId, pinned }` |
| `agreement.confirm` | `agreement.confirm` | `{ agreementId, edits }`. `exclude`는 `edits.scope`에서 해당 항목을 뺀 값으로 데몬이 바꾼다 |
| `agreement.revise` | `agreement.correct_understanding` 또는 `agreement.renegotiate` | 상태 `proposed`면 `{ agreementId, part, note }`, `active`면 `{ agreementId, content, reason: note }`(content가 없으면 -32602) |
| `agreement.narrow` | `agreement.confirm` 또는 `agreement.renegotiate` | 합의 상태 `proposed`면 `edits = { scope }`, `active`면 `content = 현재 내용 + scope`, `reason` |
| `result.accept` | `result.accept` | `acceptanceId` 서버 발급, `decision` 그대로, `core = { conditions ?? [], criteriaReview ?? [], note, reopenTo ?? null, obligationPolicy ?? "proceed_all", integrationAgreementId ?? null }`(`integrationAgreementId`는 `integrationAgreement.agreementId`이고, `edits`는 같은 트랜잭션에서 합의에 적용한다), `deferObligations`, `bundledAnswers` |
| `obligation.confirmDone` | `obligation.resolve` | `refs`(사람 확인이면 빈 배열 허용, 08 R-21) |
| `obligation.defer` / `transfer` | `obligation.defer` / `obligation.transfer` | `revisitTrigger` 그대로. `to`의 객체 → id 하나 |
| `goal.activate` | `goal.activate` | `edits`가 있으면 같은 트랜잭션에서 고친 판으로 활성화(10에 요구) |
| `goal.confirmRevision` / `rejectRevision` | `goal.revision.confirm` / `goal.revision.reject` | `{ goalId, edits }` |
| `concern.revise` | `concern.update` | 그대로 |
| `concern.hold` | `structure.hold` | `core = { op: "hold", sourceConcernIds: [concernId], reason }`, `revisit` |
| `loop.requestTransition` | `loop.transition` | `core = { concernId, from, to, reason }`(08 LoopTransitionCore) |
| `loopPlan.revise` | `loop_plan.record` | `core` 그대로, `authoredBy: "human"`을 데몬이 채운다(판정 J-188) |
| `mode.set` | `mode.set` | `core = { concernId, mode, reason }`(08 ModeAssignmentCore) |
| `dial.set` / `unset` | `dial.set` / `dial.unset` | `scope` → `{ layer, scopeId }`(user면 null, concern이면 `concernId`, instruction이면 `workUnitId`), `key`, `value`, `reason`(10 DialSetPayload). `planAuthoring`의 층 제한과 값 검사는 14 `DIAL_DEFS`가 한다(판정 J-188) |
| `settings.update` | `setting.change` | `{ section, patch }` |
| `observerProposal.adopt` / `decline` / `snooze` | `policy.change.accept` / `reject` / `defer` | `proposalId` → `policyProposalId`, `until` → ms |
| `work.steer` | `run.steer` | 데몬이 WorkUnit의 실행 중 run을 찾는다. 없으면 3001(`conflict.invalid_transition`) |
| `work.pause` / `resume` | `workunit.pause` / `workunit.resume` | `{ workUnitId, reason }` |
| `work.stop` / `abort` | `run.stop` / `run.cancel` | 데몬이 WorkUnit의 실행 중 run을 찾는다 |
| `recovery.resolve`(toolCall) | `toolcall.recover` | `{ toolCallId, resolution, evidence: [] }`. 사람 답이면 커널이 같은 트랜잭션에서 사람 발화 관찰을 만들어 `evidence`에 넣는다(10·08에 요구) |
| `recovery.resolve`(workUnit) | 12 실행 수준 동작 | `rerunFromCheckpoint` → 12 새 run 요청, `leaveAsIs` → 복구 항목만 닫는다(`toolcall.recover`를 내지 않는다, 12 §3.7.4), `createCheckTask` → 14 확인 WorkUnit 요청(`workunit.propose`) |
| `brief.acknowledge` | `brief.acknowledge` | `{ upToSeq, projectId, note, compact }`(09에 `note`·`compact` 필드를 요구) |
| `daemon.exitSafeMode` | `runtime.exit_safe_mode` | `{ reason }`. 이벤트 `daemon.safe_mode_exited`(09) |
| `resumptionCheck.answer` / `score` | `resumption_check.answer` / `score` | 16 §3.27 payload |
| `device.registerPush` | `device.register_push` | 26 §3.4.6 검증 뒤 `push_tokens` 행과 `device.push_registered` |

- 이 표가 바뀌면 `check-registry.ts`(§3.13.2)가 등록 표의 `kernelCommand`와 변환 함수 목록을 대조한다.

### 3.8 알림 전체 목록

#### 3.8.1 서버 → 클라이언트

| 알림 | 언제 | params 타입 | 절 |
|---|---|---|---|
| `hello.challenge` | 업그레이드 직후 첫 메시지 | `HelloChallengeParams` | §3.4.2 |
| `events` | 이벤트 구독의 재생·실시간 묶음 | `EventsNotificationParams` | §3.5.3 |
| `stream.chunk` | 휘발 조각 | `StreamChunkParams` | §3.6.4 |
| `tick` | `tickIntervalMs`마다 | `TickParams` | §3.10.1 |
| `server.modeChanged` | 데몬 모드가 바뀜(`normal`·`safeMode`·`readOnly` 사이) | `ServerModeChangedParams` | §3.7.8 |
| `server.shutdown` | 데몬 종료 시작 | `ServerShutdownParams`. 업그레이드면 `restartExpectedMs` 30,000(17 §3.4.3) | §3.10.3 |
| `connection.closing` | 서버가 연결을 닫기 직전 | `ConnectionClosingParams` | §3.4.7 |

```ts
// packages/protocol/src/notifications.ts
export const TickParams = Obj({ serverTime: IsoTime, headSeq: Pos, mode: DaemonMode });
/** reasons는 화면 입력이다: 사유별 배너와 할 일(05 err.daemon.diskFull 등, 판정 J-115 "읽기 전용"). 값은 17 §3.4.1 */
export const ServerModeChangedParams = Obj({ mode: DaemonMode, since: IsoTime, reasons: Type.Array(ModeReason) });
/** reason과 17·09 daemon.stopped.reason의 대응은 17 §3.4.3이 적는다(17에 요구) */
export const ServerShutdownParams = Obj({ reason: Enum(["restart", "upgrade", "stop"]),
  restartExpectedMs: Type.Optional(Type.Integer({ minimum: 0 })), drainDeadline: IsoTime });
export const ConnectionClosingParams = Obj({
  kind: Type.String({ maxLength: 64 }),        // §3.3.4의 kind, 또는 "slowConsumer", "replaced"
  reason: Type.Optional(Type.String({ maxLength: 64 })),   // auth.revoked면 revoked | expired_absolute | expired_idle
  message: Type.String({ maxLength: 200 }),
});
```

#### 3.8.2 클라이언트 → 서버

| 알림 | params | 동작 |
|---|---|---|
| `presence.report` | `PresenceReportParams` | 연결별 활동 상태 갱신(§3.7.8) |
| `$/cancelRequest` | `Obj({ id: RequestId })` | 그 요청이 아직 처리 중이면 중단하고 `5004 request.cancelled`로 응답한다. 이미 응답했거나 없는 id면 무시한다. 명령은 커밋 전에만 취소된다. 커밋 뒤면 정상 결과를 보낸다(LSP의 `$/cancelRequest` 관례 [지식], pi-protocol `cancel`과 같은 의미, pi-api-facts-2 §6.1) |

#### 3.8.3 OS 알림과 전달 결정

- 프로토콜에는 OS 알림용 별도 알림 메시지가 없다. 휴대폰 Web Push도 같은 전달 기록에서만 나간다(§3.17). 앱의 OS 알림은 11의 전달 결정이 기록된 영속 이벤트 `question.delivered`(09 §3.4.9, 행위자 runtime)를 받았을 때만 띄운다(20 APP-D11, canon-3 §10/19 "알림 이벤트는 질문 전달 방식의 결과로만"). 그 밖의 이벤트로 알림을 띄우지 않는다.
- `question.delivered` payload(09 §3.4.15, 11 §3.5.6): 대상 질문은 envelope `subject`, `deliveryId`(앱 중복 알림 방지), `channel`(`app` \| `push` \| `tui` \| `brief`, 정하는 규칙은 11·26 §3.4.3), `batchKey`, `urgency`, `surface`(`os` \| `badge` \| `banner`), `category`, `copy`(05 문구 키와 인자. 질문 본문은 넣지 않는다), `target`(데스크톱 딥 링크 `helm://question/<qs_id>`. 휴대폰 푸시는 26의 `<publicOrigin>/m/q/<qs_id>`), `expiresAt`, `targetDevices`(`all` 또는 기기 목록). 앱은 자기 `deviceId`가 대상일 때만 OS 알림을 띄운다. 값의 뜻(판정 J-52): `urgency`는 11의 `interrupt`·`notice`·`digest`, `channel`은 전달 경로(어디로 보냈나), `surface`는 표시 방식 배열(OS 알림·배지·배너), 문구는 키만 싣는다(J-31).
- 재전송으로 받은 전달 이벤트(`caughtUp` 전 알림에 들어 있던 것)는 하나씩 OS 알림으로 띄우지 않고 "접속하지 않은 동안 전달된 질문 n개"로 한 번 묶어 보인다(20).
- 알림 철회 계약(04 요구 (8)): 앱은 띄운 OS 알림을 `questionId`로 기억하고, 그 질문의 `question.answered`·`question.assumed`·`question.withdrawn`·`question.expired` 이벤트를 받으면(다른 기기에서 답한 경우 포함) 그 알림을 OS 알림 센터에서 지운다. 재전송 중에 받은 경우도 지운다. 모바일 푸시의 철회는 §3.17.
- 알림 내용 노출(판정 J-03): 데몬은 `copy`에 05 §3.7.2의 키와 인자(할 일, 마감 효과, Concern 이름, 질문 번호)를 싣는다. 질문 문장 전체, 근거, 비밀은 싣지 않는다(18 §3.10.3). 내용을 보일지는 기기가 정한다: 기본은 숨김이고 숨김 문구는 05 `notif.hidden.title`·`notif.hidden.body`(개수 있음·없음) 하나다. 데스크톱은 앱 설정(20), 휴대폰은 기기 설정(26 §3.4.5)으로 켠다. 데몬 설정으로 제목을 넣거나 빼지 않는다.

### 3.9 멱등성

#### 3.9.1 멱등 키 [제안]

- 형식: `ik_<ULID>`(20 APP-D09). 사용자 의도 하나(버튼 한 번, 보내기 한 번)에 하나를 만든다. 같은 의도를 다시 보낼 때(응답 유실, 재접속, 시간 초과, 경로 바꿈)는 같은 키와 같은 params를 보낸다. 다른 의도에 키를 다시 쓰지 않는다.
- 클라이언트는 명령을 보내기 전에 진행 중 명령함(20: IndexedDB, 26: IndexedDB, TUI: 파일)에 `PendingCommand`(§3.14: 키, 메서드, params, 만든 시각, 보낼 때의 `storeId`·`deviceId`·프로토콜 버전·`schemaHash`)를 먼저 저장한다. 결과가 확정되는 응답(§3.3.4 "저장" 열이 예인 오류와 성공)을 받으면 지운다. 연결 오류·시간 초과·재시도 가능 오류면 남겨 두고 재접속 뒤 같은 키로 다시 보낸다.
- 자동 재전송에서 빼고 사람에게 "보내지 못한 조작"으로 보이는 경우: (1) 항목이 `pendingCommandMaxAgeMs`(기본 24시간)보다 오래됨(OpenClaw iOS 송신함의 만료 규칙, S4 openclaw-gateway §3.3). (2) `hello.log.storeId`가 항목의 `storeId`와 다름(저장소 복원, F-42). (3) `hello.connection.deviceId`가 항목의 `deviceId`와 다름(다시 페어링해 멱등 범위가 바뀜, F-06). (4) 프로토콜 버전이나 `schemaHash`가 달라졌는데 그 메서드의 params가 새 스키마를 통과하지 못함. (5) 저장되지 않는 영구 오류(`retryable: false`인 -32600·-32601·-32602·5007)를 받음. (6) `5003 daemon.readOnly`를 받음(F-17). 이 항목은 앱이 입력을 초안으로 되살리고 사람이 바뀐 상황을 본 뒤 새 키로 보낸다(J-02, 04 A4).
- 사람이 "보내지 못한 조작"을 다시 보내기 전에 앱은 먼저 `command.lookup { idempotencyKey: 원래 키 }`를 부른다. 이미 커밋된 결과가 있으면 그 결과를 보이고 다시 보내지 않는다. 없을 때만 새 키를 만든다. 그래서 24시간이 지난 명령도 두 번 적용되지 않는다. (2)·(3)의 경우는 원래 범위를 조회할 수 없으므로(다른 저장소, 다른 기기 ID) 화면에 "이미 처리됐을 수 있음"을 함께 보인다.

#### 3.9.2 서버 처리

```text
on 명령 메서드 요청(params) — WebSocket 또는 POST /m/cmd:
  1. params 스키마 검사(-32602), scope·값 검사(1010), tty_cli면 localConfirm 검사(1012), 명령 속도(1011),
     데몬 모드 검사(readOnly → 5003, draining → 5001)
  2. 변환(§3.7.9): { type, payload } ← toCommand_<method>(params, conn)
     입력 단계 마스킹(18, 판정 J-147): payload의 사람 입력 텍스트
  3. EngineInput(06 §3.4.6) 만들기:
       { type, payload, issuedAt: clientTime ?? now, idempotencyKey, basisSeq, expect,
         correlation(params의 대상에서), provenance: { adapterId: "client:<client.kind>", externalRunId: <connection.id> },
         channel: "human_client", actor: "human",
         via: { kind: "device", deviceId, listener, connectionId } | { kind: "local_cli", uid, interactive } }
     commandId는 engine이 발급한다
  4. result ← engine.submit(input)                 // store.transaction 안에서 커널 decide(판정 J-148)
       09가 범위 키 channel|actor|viaKey(via)|key와 지문 sha256({type, actor, viaKey(via), payload − 발급 ID 필드})로 멱등을 처리한다(09 §3.9.1)
       - 같은 키·같은 지문: 저장된 결과(replayed) → duplicate: true
       - 같은 키·다른 지문: key_reused → 3006(저장하지 않음)
  5. result(06 SubmitResult) → CommandResult 또는 오류(§3.3.5)
  6. 커밋이 있었으면 §3.5.9 순서대로 이벤트 알림을 큐에 넣은 뒤 응답을 큐에 넣는다
```

- 멱등 범위와 지문은 09가 계산한다(09 §3.9.1). 프로토콜은 따로 계산하지 않는다. 범위 키와 지문에 들어가는 출처는 `viaKey(via)`(사람 명령이면 `device:<deviceId>` 또는 `local_cli:<uid>`)이고 연결 ID·리스너·실행 시도 번호는 들어가지 않는다. 그래서 다른 연결, 다른 리스너(WSS ↔ SSH), `/m/cmd`와 WebSocket 사이에서 같은 키·같은 params를 다시 보내면 같은 명령이다. 데몬이 발급하는 새 레코드 ID(`objectionId`, `acceptanceId` 등)는 재시도마다 다를 수 있으므로 09가 지문에서 뺀다(09 §3.9.1 `generatedIdFields`). 변환 함수는 그 필드 이름을 10 명령 스펙에 맞게 알린다. 지문에 `commandId`·`expect`·`basisSeq`·`localConfirm`이 들어가지 않으므로 화면이 새로 그려져 `basisSeq`가 달라져도 같은 명령으로 본다.
- `via.listener` 값은 `ListenerKind`(`tailnet`·`loopback`·`local`)다(18 §3.5 규칙 3. 08 `Via.listener`를 이 값으로 바꾸게 한다).
- 같은 키가 지금 처리 중이면(재접속 직후 이전 연결의 요청이 아직 커밋 전): 데몬의 커밋은 이벤트 루프 한 턴 안에서 동기로 끝나므로(09 §3.8.4) 두 요청이 겹치는 일은 처리기 대기열 앞단에서만 생긴다. 뒤의 요청은 앞의 결과를 기다려 `duplicate: true`로 받는다. 10초를 넘으면 `3007 command.inProgress`(`retryAfterMs` 1000).
- 저장되는 결과(09 §3.9.2): `accepted`, `needs_gate`, 커널 거부(내용·자격·경로), `conflict`(버전 불일치, 이미 해결됨, 대체됨). 같은 키로 다시 보내면 같은 거부가 다시 온다. 상황이 바뀐 뒤 다시 하려면 새 키가 필요하다(사람이 "다시 보내기"를 누르면 앱이 새 키를 만든다, 20 §3.9.7).
- 저장되지 않는 결과: 1단계에서 끝난 오류, `3006`, `5001`, `5002`, `5003`, `5004`(커밋 전 취소), 커널 내부 오류(`error`), 일시 실패(쓰기 소유권 상실, SQLite 바쁨, 디스크 가득 참). 같은 키로 다시 보내도 된다. 자동 재전송 여부는 `retryable`과 §3.9.1 목록으로 정한다.
- 보관: 09 `commands` 테이블은 행을 지우지 않는다. 365일이 지나면 `result`를 줄이고 `scope_key`·`fingerprint`·`status`만 남긴다(09 §3.15.3). 줄인 행에 같은 키·같은 지문이 오면 `{ status, commandId, duplicate: true, reduced: true }`만 돌려준다(이벤트 범위와 `created`는 비어 있다). 줄인 행에 다른 지문이 오면 3006이다.
- JSON-RPC 요청 `id`는 연결 안의 응답 짝짓기용일 뿐이다. 멱등 키로 쓰지 않는다(happy-agent의 `mutationId`처럼 반향용 값과 멱등 키를 섞은 혼동을 피한다, happy-agent 조사 §9 피할 것 5).

#### 3.9.3 `basisSeq`와 낡음 검사

- 클라이언트는 모든 명령에 `basisSeq`(그 결정을 내린 화면 뷰의 `asOfSeq`)를 싣는다. 프로토콜 계층은 이 값을 `EngineInput.basisSeq`에 그대로 넣는다.
- 비교는 커널이 decide 안에서 한다(판정 J-79, 10 §3.3.4, 09 §3.9.4): 10 명령 스펙의 `subjects()`(10 §3.11.12)가 돌려준 각 대상 레코드의 `revisionSeq`(08 `RecordMeta.revisionSeq`, 사람 판단에 영향을 주는 변경에서만 오른다)가 `basisSeq`보다 크면 충돌이다. 커널이 대상 상태를 보고 `conflict.version_mismatch`(3004), `conflict.already_resolved`(3008), `conflict.superseded`(3009)를 나누고 `rebase`에 현재 요약을 넣는다. 대상이 여럿일 때의 우선순위와 끝난 대상의 판정 순서는 10이 정한다(10 §3.3.4에 분류 의사코드를 요구).
- `expect`(`{id, revisionSeq}[]`)는 화면이 특정 레코드의 판을 직접 아는 경우에만 싣는다. 있으면 커널은 그 레코드에 대해 `expect`를 쓰고, 나머지 대상은 `basisSeq`로 본다.
- `revisionSeq`는 전달 기록·열람·표시 번호·근거 링크 추가 같은 운영성 변경에서 오르지 않는다(08 D08-12, 09 `bumpsRevision`). 그래서 사람이 질문에 답하는 사이 에이전트가 근거를 붙여도 답이 충돌로 막히지 않는다. `question.assumed`가 `bumpsRevision`을 올리는지는 09 EVENT_META가 명시한다(판정 J-120). 가정 확정 뒤 온 답은 어느 쪽이든 3008로 거부되고 `assumedValue`를 받는다(§3.3.5).

#### 3.9.4 화면을 끄기 직전의 명령: `POST /m/cmd` [제안]

휴대폰 웹 앱은 숨겨지면 곧 멈춘다(26 §3.3.5). 답을 보내고 바로 화면을 끄면 WebSocket 응답을 받기 전에 연결이 닫힐 수 있다. 그래서 진행 중 명령을 HTTP로도 보낼 수 있게 한다.

- 경로: `POST /m/cmd`, `tailnet` 리스너, 쿠키 + Origin 정확 일치(§3.2.5). 본문은 `cmd` 종류 메서드의 JSON-RPC 요청 하나(크기 상한 `maxInboundMessageBytes`), 응답은 같은 `id`의 JSON-RPC 응답 하나(`Content-Type: application/json`, `Cache-Control: no-store`).
- 인증은 쿠키 판정(18 §3.4.3 `cookieAuth`)이고 `hello`가 없다. 연결 정보는 기기 레코드에서 채운다: `client.kind`는 기기의 `clientKind`, `connectionId`는 이 요청마다 새 `cx_`(감사용), scope는 기기의 scope. 그 밖의 처리(스키마, scope, 멱등, 결과 대응)는 §3.9.2와 같다.
- 앱은 `visibilitychange → hidden`에서 진행 중 명령마다 `fetch("/m/cmd", { method: "POST", keepalive: true, … })`를 같은 키로 보낸다(26 §3.3.5). WebSocket 재전송과 겹쳐도 같은 멱등 키라 한 번만 적용된다. `keepalive` 응답을 받지 못해도 진행 중 명령함은 그대로 두고 다시 열 때 재전송한다.
- 데스크톱·TUI는 이 경로를 쓰지 않는다(헤더 토큰은 받지 않는다).

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

20의 사용자용 연결 상태(04 §3.0.4)와 26의 연결 표시는 이 상태 기계의 상태와 오류 kind로 계산한다. 이 표는 `@helm/client`의 `HelmClient`가 구현한다.

| 상태 | 사건 | 가드 | 다음 상태 | 부수 효과 |
|---|---|---|---|---|
| `idle` | `start()` | - | `connecting` | 전송 열기 |
| `closed` | `start()` | - | `connecting` | 같은 인스턴스를 다시 쓴다. 위치·진행 중 명령함·추적 중인 뷰는 그대로다(휴대폰의 숨김 → 보임, 26 §3.3.5) |
| `connecting` | 전송 열림 | - | `handshaking` | 챌린지 타이머 5초 |
| `connecting` | 전송 실패 `network`·`daemonUnreachable`·`other`, HTTP 421·429·5xx | - | `backoff` | 시도 횟수 +1. 429면 `Retry-After`를 하한으로 |
| `connecting` | 전송 실패 `httpStatus` 401·403 | - | `needsUser` | kind `auth.failed`(20 `http_unauthorized`) |
| `connecting` | 전송 실패 `blocked`(SSH 호스트 키 불일치·SSH 인증 실패·키체인 거부 등) | - | `needsUser` | 판정 J-62. 자동 재시도 중단 |
| `handshaking` | `hello.challenge` | `serverId` 일치(또는 첫 연결) | `handshaking` | `hello` 전송(서명이 필요하면 `sign` 콜백) |
| `handshaking` | `hello.challenge` | `serverId` 불일치 | `needsUser` | kind `server.mismatch`(클라이언트 내부) |
| `handshaking` | `hello` 성공 | `log.storeId`·`deviceId`가 진행 중 명령함 항목과 다름 | `syncing` | 해당 항목을 자동 재전송에서 빼고(§3.9.1 (2)·(3)) `storeId`가 다르면 `clearServer(serverId, "all")`을 먼저 부른다. 그 뒤 아래 행과 같다 |
| `handshaking` | `hello` 성공 | - | `syncing` | 정책 저장, 저장된 위치로 이벤트 구독 복원, 스트림 구독 복원. 진행 중 명령 재전송은 이벤트 구독의 첫 응답(또는 `2001` 처리)이 끝난 뒤 시작한다 |
| `handshaking` | `hello` 오류 | kind ∈ {`protocol.unsupported`, `auth.failed`, `auth.revoked`, `auth.methodNotAllowed`} | `needsUser` | 사용자에게 할 일 표시. `auth.revoked`면 사유별 처리(§3.14) |
| `handshaking` | `hello` 오류 | kind ∈ {`auth.challengeStale`, `rateLimited`, `daemon.draining`} | `backoff` | `retryAfterMs` 하한 |
| `handshaking` | 챌린지 5초 초과, 닫힘 4001, 전송 닫힘(코드 무관) | - | `backoff` | |
| `syncing` | 모든 이벤트 구독이 `caughtUp` | - | `ready` | 낡은 열린 뷰 다시 받기 |
| `syncing` | 구독이 `2001` | - | `syncing` | 스냅샷 경로(§3.5.5) |
| `ready` | gap 3회/분 | - | `backoff` | 1000으로 닫기, 진단 기록 |
| `syncing`·`ready` | 감시 시간 초과 | - | `backoff` | 4000으로 닫기 |
| `syncing`·`ready` | 닫힘 1001·1006·1011·1012·4008, 4009(`replaced`), 표에 없는 코드 | - | `backoff` | 4008이면 첫 대기 0 |
| `syncing`·`ready` | 닫힘 1008, 4009(`auth.revoked`) | - | `needsUser` | 직전 `connection.closing`의 kind와 `reason` |
| `backoff` | 대기 끝, 또는 `retryNow()`(네트워크 복구·OS 깨어남·창 포커스·화면 보임) | `retryAfterMs` 하한 지남 | `connecting` | |
| `needsUser` | 사용자 "다시 연결"·재페어링 완료 | - | `connecting` | 시도 횟수 0 |
| `idle`·`connecting`·`handshaking`·`syncing`·`ready`·`backoff`·`needsUser` | `stop()` | - | `closed` | 1000으로 닫기. 위치는 즉시 저장 |

- `syncing` 동안 사람의 결정 명령은 보내지 않는다(04 §3.0.4 "다시 맞추는 중"은 결정 동작을 막는다).
- 진행 중 명령 재전송은 `syncing` 안에서 이벤트 구독을 복원한 뒤에 한다. 복원 결과가 `2001 storeMismatch`·`aheadOfHead`면 재전송하지 않고 §3.9.1 (2)로 넘긴다. 그래서 복원된 저장소에 옛 명령이 다시 적용되는 일이 없다(F-42).
- 브라우저 전송(`@helm/client/browser`)의 업그레이드 실패: `open` 전에 1006으로 닫히면 전송이 `GET /m/whoami`를 부른다. 401이면 `TransportFailure{ kind: "httpStatus", status: 401 }`(본문 `reason`을 `detail`에 싣는다), 403이면 403(`origin_mismatch`), 200이면 `{ kind: "network" }`, 요청 자체가 실패하면 `{ kind: "network" }`다(18 §3.4.3 규칙 5). 그래서 쿠키가 없거나 폐기된 휴대폰이 끝없이 백오프하지 않는다.

#### 3.10.3 재접속 백오프 [제안]

```text
attempt: 연속 실패 횟수(ready 상태가 30초 이상 유지되면 0으로)
d ← min(30,000, 500 × 2^attempt)                 // 0.5s, 1s, 2s, 4s, … 최대 30s
delay ← d/2 + random() × d/2                      // 반 지터(equal jitter)
delay ← max(delay, retryAfterMs ?? 0, restartExpectedMs ?? 0)
if 직전 닫힘이 4008(느린 소비자): delay ← max(0, retryAfterMs ?? 0)   // 바로 다시
```

- 자동 재접속을 멈추는 경우: 전송 실패 `blocked`, HTTP 401·403(브라우저는 `/m/whoami` 판정 결과), `protocol.unsupported`, `auth.failed`, `auth.revoked`, `auth.methodNotAllowed`, `pairing.invalidCode`, `serverId` 불일치. 사람이 고쳐야 풀리는 실패다(OpenClaw `reconnect-policy.ts`의 인증 오류 목록과 같은 생각, S4 openclaw-gateway §1.5).
- 그 밖의 실패는 포기하지 않는다. 30초 간격으로 계속 시도하고, 화면은 "연결 안 됨"을 보인다(04 §3.0.4).
- 경로 바꾸기(WSS ↔ SSH)는 네트워크 계열 실패에서만 하고, 연결된 동안에는 바꾸지 않는다(20 APP-D05). 경로를 바꿔도 위치·진행 중 명령함은 같은 `serverId` 아래에서 그대로 쓴다. 두 경로의 의미가 같기 때문이다(결정 38).

### 3.11 파일과 큰 데이터 [제안: 결정 31 기본값, 세부 제안]

#### 3.11.1 원칙과 한도

- WebSocket 메시지에 파일 바이트(base64 포함)를 싣지 않는다. 이벤트와 뷰에는 `BlobRef`만 싣는다(pi-web의 media id 참조, OpenClaw가 base64 첨부로 프레임 한도를 넘긴 문제, pi-cases-notes §12.1-8).
- 파일은 내용 주소(SHA-256)로 저장한다. 저장 방식·업로드 대기·보존은 09 §3.12, 데이터 디렉터리는 17.
- 불변 보장(20 §5.2 (4)): `blobId`가 한 번 정해지면 그 내용은 바뀌지 않는다. 같은 내용은 같은 `blobId`다(09 §3.12 "같은 내용이면 같은 id"). 그래서 클라이언트는 `blobId`를 키로 영구 캐시해도 된다. 내용이 지워진 경우(보존 정책 가지치기, 비밀 가림)에도 다른 내용으로 바뀌지 않고 `410 Gone`이 된다.
- 가림 전파(판정 J-147): 09 `blob.redacted` 이벤트의 `invalidates`에는 그 `blobId`가 들어간다. 클라이언트는 이 이벤트를 받으면(재전송 포함) 그 `blobId`의 디스크·메모리 캐시를 지운다. 데스크톱 `helm-blob` 캐시(20)와 휴대폰 캐시(26)가 같은 규칙을 쓴다. 가림을 만드는 명령과 스냅샷·백업 쪽 절차는 10·17·18이 정한다.
- 남는 위험: 가린 blob의 `hash`(SHA-256)는 이벤트와 `ETag`에 남는다. 짧은 비밀(4~6자리 코드 등)은 해시를 대입해 맞출 수 있다. 표시 해시를 HMAC으로 바꿀지는 09·18이 정한다(§5.2). 그 전까지 가린 blob의 `ETag`는 보내지 않는다(`410` 응답에는 `ETag`가 없다).

```ts
// packages/protocol/src/files.ts
export const BlobVariant = Obj({ blobId: BlobId, bytes: Type.Integer({ minimum: 0 }), width: Type.Integer({ minimum: 1 }),
  height: Type.Integer({ minimum: 1 }), mediaType: Type.String({ maxLength: 128 }) });
/** 08 §3.4.7 BlobRef와 같은 필드 이름이다(프로토콜 쪽 변환 없음). 프로토콜은 표시용 필드를 더한다.
 *  데스크톱 IPC(20 §3.4.1)도 이 모양을 쓰고 앱 쪽은 url 하나만 더한다 */
export const BlobRef = Obj({
  blobId: BlobId,                                    // `bl_<ULID>`(08 §3.2)
  hash: Sha256,                                      // "sha256:<소문자 hex 64자>"(09 §3.12 주소)
  bytes: Type.Integer({ minimum: 0 }),
  mediaType: Type.String({ maxLength: 128 }),        // 서버가 업로드 때 확인한 값
  preview: Type.Optional(Type.String({ maxLength: 500 })),   // 앞부분 미리보기(08). 비밀 가림·공개 사본 규칙을 따른다
  // 아래는 프로토콜이 더하는 표시용 필드(뷰 데이터에서만, 이벤트 payload에는 없다)
  name: Type.Optional(Type.String({ maxLength: 255 })),
  image: Type.Optional(Obj({ width: Type.Integer({ minimum: 1 }), height: Type.Integer({ minimum: 1 }) })),
  variants: Type.Optional(Obj({ thumb: Type.Optional(BlobVariant), display: Type.Optional(BlobVariant) })),   // 긴 변 512px / 1,600px(21 E11)
});
/** 인라인 표시 허용 형식(§3.11.2). 그 밖은 attachment + application/octet-stream */
export const INLINE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "text/plain; charset=utf-8"] as const;
```

| 한도 | 기본값 | 근거 |
|---|---|---|
| 파일 하나 | 64 MiB(`policy.files.maxBlobBytes`) | 이미지 자극, 문서 초안, 첨부. 18 상한 256 MiB 안 |
| 한 번에 올리기 | 8 MiB | 넘으면 청크 업로드 |
| 청크 | 4 MiB | |
| 다운로드 티켓 수명 | 5분, 연결당 64개 | OpenClaw 5분·128개(S4 openclaw-gateway §1.6) |
| 기기당 대기 업로드 합계·동시 업로드 세션 | 512 MiB, 4 | §3.4.4 `policy.files` |
| 업로드 세션 | 마지막 청크 뒤 1시간 | |
| 참조되지 않은 업로드 | 24시간 뒤 정리 | happy-agent 1회용 uploadId 24시간 |
| JSON-RPC 메시지 | 받기 1 MiB, 보내기 4 MiB | §3.4.4 |
| 이벤트 하나 | 256 KiB | §3.5.2 |
| `composer.submit` 본문 | 32 KiB | |

#### 3.11.2 다운로드

- `GET /files/b/<blobId>` + `Authorization: Bearer <기기 토큰>`: 데스크톱(Rust의 `helm-blob` 스킴, 20 APP-D12)과 TUI가 쓴다. `local` 리스너에서는 헤더 없이 받는다(소켓 권한 = `localAdmin`).
- `blob.downloadTicket { blobId, variant? }` → `{ path: "/files/t/<ticket>", expiresAt }`(§3.7.6): 헤더를 붙일 수 없는 곳(웹뷰가 직접 여는 링크, 외부 프로그램으로 열기)용. 티켓은 32바이트 무작위 base64url이다. 이 문서가 티켓 규칙의 정본이다: 수명 5분, 발급한 WebSocket 연결에 묶여 그 연결이 닫히면 무효, 발급 때 지정한 blob 하나만 받는다, 수명 안에서는 Range 요청에 여러 번 쓸 수 있다(18 §3.8.2의 "1회"를 이 규칙으로 맞추게 한다). 기기 토큰을 URL에 넣지 않는다(OpenClaw `artifact-download-grants.ts`와 같은 방식). 접근 로그에는 티켓 값을 가린다(§3.2.5).
- 휴대폰(쿠키): `GET /files/b/<blobId>`를 쿠키로 받는다(§3.2.5). 이미지 요청은 `Origin`이 없을 수 있어 `Sec-Fetch-Site: same-origin`도 받는다.
- 응답: `200` 또는 `206`, `Accept-Ranges: bytes`, `Content-Range`, `Content-Length`, `ETag: "sha256:<hex>"`(원래 바이트의 해시. 클라이언트는 받은 바이트로 다시 계산해 맞을 때만 캐시에 쓴다, 20 §3.8.6), `Repr-Digest: sha-256=:<base64>:`(RFC 9530 [지식]). `If-None-Match`·`If-Range`를 지원한다. 범위가 틀리면 `416`, 없으면 `404`, 가지치기·가림으로 내용이 없으면 `410`(본문 `{"error": {..., "data": {"kind": "blob.gone", "details": {"reason": "pruned" | "redacted"}}}}`), 토큰·티켓이 틀리거나 만료면 `401`.
- 격리 헤더(모든 `/files/*` 응답, 18 §3.4.6): 휴대폰 PWA와 `/files/*`가 같은 출처이므로 파일 내용이 그 출처에서 실행되지 않게 한다. `Content-Security-Policy: sandbox; default-src 'none'`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin`을 언제나 붙인다. 인라인 표시는 허용 목록(`image/png`, `image/jpeg`, `image/webp`, `image/gif`, `text/plain; charset=utf-8`)만이고, 그 밖의 형식(`text/html`, `image/svg+xml`, `application/xhtml+xml`, XML 등 전부)은 `Content-Type: application/octet-stream`과 `Content-Disposition: attachment`로 보낸다. 원래 형식은 `X-Helm-Media-Type` 헤더와 `BlobRef.mediaType`으로 알린다. 거부 목록 대신 허용 목록을 쓰는 이유는 목록 밖 활성 형식을 빠뜨리지 않기 위해서다. 18 §3.17에 이 헤더의 보안 시험을 요구한다.
- 캐시: 티켓·파일 응답의 `Cache-Control`은 18 §3.4.6이 정본이다 [판정 J-252]. 이 문서는 값을 따로 정하지 않는다. 18 §3.4.6의 `/files/*` 행이 정한 `private, no-store`를 헤더 토큰·티켓·쿠키 인증 응답이 모두 쓴다(폐기 뒤 브라우저 HTTP 캐시에 남지 않게 하려는 값이다). 휴대폰 앱의 이미지 캐시는 앱이 IndexedDB·Cache Storage에 두고 폐기·로그아웃 때 지운다(`/m/logout`의 `Clear-Site-Data`).
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

→ `201 {"blob": BlobRef, "stagedUntil": "…"}`. 해시가 다르면 `422` + 오류 `4005`, 크기 초과면 `413` + `4001`, 기기당 대기 합계·세션 수를 넘으면 `429` + `1011`(§3.4.4). 데몬은 09 `stageUpload(uploadId, mediaType)`로 `blobs/staged/<uploadId>`에 쓴다(09 §3.12).

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
- 휴대폰 PWA는 데몬이 같은 릴리스의 묶음을 서빙하므로(26 §3.6) 앱과 데몬의 버전이 보통 같다. 서비스 워커가 옛 묶음을 들고 있으면 `protocol.unsupported`를 받고 새 묶음을 받아 다시 연다.
- 데스크톱 앱은 `protocol.unsupported`를 받으면 "앱 업데이트 필요" 또는 "서버 업데이트 필요"를 `serverMin`·`serverMax`와 자기 범위로 판단해 보인다(20 APP-D14).

### 3.13 `@helm/protocol` 패키지와 생성 [제안]

#### 3.13.1 구조

```text
packages/protocol/                         @helm/protocol (브리프 §3.1)
  package.json      exports: "." (스키마·타입·오류·등록 표), "./testing" (가짜 서버·클라이언트, 적합성)
                    sideEffects: false. 런타임 의존: typebox 1.3.27(07 §3.11.8), @helm/domain(스키마), ulid 생성기 하나
  src/
    version.ts          PROTOCOL_VERSION, MIN_PROTOCOL_VERSION, CAPABILITIES
    jsonrpc.ts          envelope 스키마(§3.3.1), 크기·깊이·길이 검사
    errors.ts           ERRORS 표: { code, kind, retryable, httpStatus? }, HelmProtocolError 클래스
    common.ts           IsoTime, Pos, StreamPosition, RecordRef, Scope, ListenerKind, DaemonMode, ModeReason, CommandBase, Cmd, CommandResult
    handshake.ts        HelloChallengeParams, HelloParams, HelloResult, ConnectionPolicy, DEFAULT_POLICY
    events.ts           EventWire, EventFilter, events.* params·result, EventsNotificationParams
    views.ts            ViewName, VIEW_SPECS(이름, params 스키마, 화면 ID, 집계 태그), ViewResult
    stream.ts           StreamPart, RunPartial, stream.* params·result
    commands.ts         명령별 params 스키마(§3.7.5)
    queries.ts          events.read, search.query, record.locate, command.lookup(§3.7.3)
    status.ts           DaemonStatus, PresenceReportParams, admin.* params·result(§3.7.8)
    push.ts             HelmPushMessage(26 §3.4.4), push-fallback.generated.ts
    devices.ts          DeviceInfo, ConnectionInfo, device.* / connection.*, 푸시 등록(§3.17)
    files.ts            BlobRef, HTTP 경로·헤더 이름 상수, 업로드·티켓 스키마, 인라인 허용 형식 목록
    notifications.ts    NOTIFICATION_SPECS
    registry.ts         METHOD_SPECS(§3.13.2)
    convert.ts          COMMAND_CONVERSIONS: 메서드 → 10 type 이름과 필드 대응 메타데이터(§3.7.9). 변환 함수 본체는 데몬 commands.ts
    types.ts            MethodMap, NotificationMap(등록 표에서 파생)
    codec.ts            parseIncoming(text, side) → 검증된 메시지 | 오류, serialize
    testing/            FakeDaemon, FakeClient, 시나리오 DSL, 적합성 스위트(§6.3)
  scripts/
    gen-jsonschema.ts   → dist/schema/helm-protocol.schema.json
    gen-reference.ts    → docs/design/generated/19-protocol-reference.md (메서드·알림·오류·뷰 표)
    check-registry.ts   등록 표 ↔ 서버 디스패처 처리기 ↔ 생성 문서 일치 검사(`just check`에 넣는다, 06·23)
```

- 의존 방향: `@helm/protocol` → `@helm/domain`(08 스키마 도우미, ID 상수, 레코드 Core 스키마, 11 `AnswerValue`를 값으로 가져온다. 런타임 의존이 있는 것은 `typebox`뿐인 순수 스키마 패키지다). `@helm/protocol`은 `@helm/kernel`, `@helm/store`, `@helm/daemon`을 모른다. 데몬과 앱이 `@helm/protocol`에 의존한다(06이 의존 방향을 확정).
- 클라이언트 코어는 별도 패키지 `@helm/client`다(판정 §2). `@helm/client` → `@helm/protocol` 방향으로만 의존하고 데스크톱·모바일·TUI가 함께 쓴다. 진입점(06 §5.2 요구 (1)):
  - `@helm/protocol`: `"."`(스키마·타입·오류·등록 표, 브라우저 안전), `"./testing"`(가짜 데몬·가짜 클라이언트·적합성 스위트, 브라우저 안전. Node 서버 띄우기는 `@helm/protocol/testing/node`).
  - `@helm/client`: `"."`(`HelmClient`, 브라우저 안전, 전송 구현 없음), `"./node"`(`NodeWsTransport`: TCP와 `ws+unix`. 런타임 의존 `ws`는 이 진입점만 쓴다, 06 R6), `"./browser"`(브라우저 `WebSocket` 전송. 모바일 PWA용. 토큰은 브라우저가 쿠키로 싣고 전송은 자격을 다루지 않는다. `open` 전 실패는 `/m/whoami`로 판정, `navigator.locks` 리더 잠금, `/m/cmd` keepalive), `"./testing"`(가짜 전송·가짜 시계, 06 §5.4 요구).
- 브라우저 안전: `@helm/protocol`의 모든 진입점과 `@helm/client` 루트는 `node:` 모듈을 쓰지 않는다. pi 저장소의 브라우저 번들 스모크 검사(pi-api-facts-2 §1.1 `scripts/check-browser-smoke.mjs`)와 같은 검사를 둔다.
- Rust 쪽 타입은 만들지 않는다. 20의 Rust는 JSON-RPC 메시지를 해석하지 않는다(20 §3.2). 예외는 페어링 응답과 업로드 응답 두 HTTP 본문이고, 20이 Rust 구조체로 직접 적는다.

#### 3.13.2 메서드 등록 표

```ts
import { type TSchema, type Static } from "typebox";

export interface MethodSpec<N extends string = string, P extends TSchema = TSchema, R extends TSchema = TSchema> {
  readonly name: N;
  readonly kind: "ctl" | "read" | "cmd" | "adm";
  readonly scopes: readonly Static<typeof Scope>[] | null;   // null: 인증 전(hello만). 여러 scope 중 하나면 허용
  readonly since: number;                // 도입 프로토콜 버전
  readonly params: P;                    // TypeBox 상수(§3.7). 인터페이스가 아니다
  readonly result: R;
  readonly errors: readonly number[];    // 생성 문서용: 이 메서드가 낼 수 있는 Helm 오류 코드
  readonly kernelCommand?: string | readonly string[];   // cmd: 10의 명령 이름(§3.7.1, 정본 10 §3.11.11(2))
  readonly mobileLimit?: { field: string; allowed: readonly unknown[] };   // decideMobile 값 제한(§3.4.6)
  readonly basisChecked?: boolean;       // cmd: §3.9.3 낡음 검사 대상이 있는가(문서용. 실제 대상은 10의 subjects)
  readonly compat?: { removeAfter: string; note: string };
  readonly summary: string;              // 생성 문서의 한 줄 설명(한국어)
}

export const METHOD_SPECS = [
  { name: "hello", kind: "ctl", scopes: null, since: 1, params: HelloParams, result: HelloResult,
    errors: [1002, 1003, 1004, 1005, 1007, 1008, 1011], summary: "핸드셰이크" },
  { name: "question.answer", kind: "cmd", scopes: ["decide", "decideMobile"], since: 1, params: QuestionAnswerParams,
    result: CommandResult, errors: [1010, 1012, 3001, 3002, 3004, 3005, 3006, 3007, 3008, 3009, 5001, 5003],
    kernelCommand: "question.answer", mobileLimit: { field: "answer.option", allowed: ["accept_recommendation", "accept_assumption",
      "answer", "confirm", "reject", "approve", "deny", "modify_criteria", "experiment_first", "narrow_scope"] },
    basisChecked: true, summary: "질문에 답한다" },
  { name: "result.accept", kind: "cmd", scopes: ["decide", "decideMobile"], since: 1, params: ResultAcceptParams,
    result: CommandResult, errors: [1010, 3001, 3002, 3004, 3005, 3006, 3008, 3009, 5001, 5003],
    kernelCommand: "result.accept", mobileLimit: { field: "decision", allowed: ["accept", "request_changes"] },
    basisChecked: true, summary: "결과를 확인한다(거절·기준이 틀림 포함)" },
  // … §3.7.1 표의 모든 행
] as const satisfies readonly MethodSpec[];

type Specs = (typeof METHOD_SPECS)[number];
export type MethodName = Specs["name"];
export type MethodMap = { [S in Specs as S["name"]]: { params: Static<S["params"]>; result: Static<S["result"]> } };
export type CommandMethodName = Extract<Specs, { kind: "cmd" }>["name"];
export type ReadMethodName = Extract<Specs, { kind: "read" | "ctl" }>["name"];
export type AdminMethodName = Extract<Specs, { kind: "adm" }>["name"];
```

- `protocol.describe`(read)는 등록 표의 내용을 돌려준다. 진단과 개발 도구용이다.

```ts
export const ProtocolDescription = Obj({
  protocol: Type.Integer(),                         // 이 연결에서 고른 버전
  supported: Obj({ min: Type.Integer(), max: Type.Integer() }),
  schemaHash: Type.String(),
  methods: Type.Array(Obj({ name: Type.String(), kind: Enum(["ctl", "read", "cmd", "adm"]), scopes: Nullable(Type.Array(Scope)), since: Type.Integer() })),
  notifications: Type.Array(Type.String()),
  views: Type.Array(Type.String()),
  capabilities: Type.Array(Type.String()),
  jsonSchema: Type.Optional(Type.Unknown()),       // 요청에 includeSchemas: true를 주면 등록 표의 JSON Schema(진단·개발 도구용)
});
```

- 데몬 디스패처는 `METHOD_SPECS`로 처리기 표를 만든다. 등록 표에 있는데 처리기가 없거나, 처리기가 있는데 등록 표에 없으면 데몬 시작 단위 테스트가 실패한다(OpenClaw `core-descriptors.ts:13-14`의 "every core handler must appear here" 규칙, S4 openclaw-gateway §1.4).
- params·result 검사는 TypeBox 컴파일 검사기(`import { Compile } from "typebox/compile"` → `Compile(schema).Check(v)`, 07 §3.11.8 [실험])로 한다. 시작 때 등록 표의 모든 스키마를 한 번 컴파일해 둔다. 데몬은 params를 받을 때, 테스트 모드에서는 result를 보낼 때도 검사한다(개발 중 계약 위반을 일찍 잡는다).
- 생성 문서(`docs/design/generated/19-protocol-reference.md`)는 이 설계 문서를 대신하지 않는다. 이 문서는 의미와 이유를, 생성 문서는 현재 코드의 정확한 목록을 적는다. 둘이 어긋나면 `check-registry.ts`가 이름 목록 차이를 보고한다.

### 3.14 클라이언트 코어와 TUI 재사용 [제안]

데스크톱 앱(웹뷰 TS), 모바일 PWA(26), TUI(Node)가 같은 코어 `@helm/client`의 `HelmClient`를 쓴다(판정 §2, 20 §3.9.4). 코어는 화면 프레임워크를 모른다. 코어가 맡는 것은 연결 상태 기계(§3.10.2)와 백오프(§3.10.3), `hello`, 구독 복원, 뷰 무효화 판정, 휘발 스트림, 진행 중 명령 재전송이다. 경로 선택(WSS·SSH 순서)은 `transportFactory`가 만드는 전송이 하고(20 `MultiRouteTransport`), React 연결(TanStack Query)은 20의 `@helm/client-react`가, pi-tui 연결은 TUI 설계가 한다.

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
  | { kind: "httpStatus"; status: number; reason?: string }   // 401·403은 인증 계열(needsUser), 421·429·5xx는 백오프. reason은 18 사유(브라우저는 /m/whoami 본문)
  | { kind: "daemonUnreachable" }                         // serve 502·503·504, SSH 포워딩 대상 거부
  | { kind: "blocked"; reason: string }                   // 사람이 고쳐야 풀린다: SSH 호스트 키 불일치·SSH 인증 실패·키체인 거부 등(판정 J-62, 20 §3.8.8)
  | { kind: "other"; detail?: string };

export interface ClientStateStorage {           // 데스크톱: IndexedDB(20 §3.9.5), 모바일: IndexedDB(26), TUI: 파일
  loadPosition(serverId: string, subKey: string): Promise<StreamPosition | null>;
  savePosition(serverId: string, subKey: string, pos: StreamPosition): Promise<void>;
  /** 자동 재전송 대상만 돌려준다. 앱이 "보내지 못한 조작"으로 옮긴 행은 돌려주지 않는다(20 §5.2 (5)) */
  /** current와 storeId·deviceId·protocol·schemaHash가 다른 행은 보류(appState)로 표시하고 돌려주지 않는다(20 §3.9.5) */
  listPending(serverId: string, current: { storeId: string; deviceId: string | null; protocol: number; schemaHash: string }): Promise<PendingCommand[]>;
  putPending(serverId: string, cmd: PendingCommand): Promise<void>;
  removePending(serverId: string, idempotencyKey: string): Promise<void>;
  /** 자동 재전송에서 빼고 사람에게 보일 행으로 옮긴다(§3.9.1). 앱은 입력을 초안으로 되살린다 */
  holdPending(serverId: string, idempotencyKey: string, why: PendingHoldReason): Promise<void>;
  /** "positions": 위치 삭제(뷰 낡음 표시는 앱), "all": 위치·뷰 삭제. pending은 지우지 않는다(사람이 확인) */
  clearServer(serverId: string, what: "positions" | "all"): Promise<void>;
}
export interface PendingCommand {
  idempotencyKey: string;
  method: CommandMethodName;
  params: unknown;
  createdAt: number;
  storeId: string;            // 보낼 때의 hello.log.storeId
  deviceId: string | null;    // 보낼 때의 hello.connection.deviceId
  protocol: number;           // 보낼 때 고른 프로토콜 버전
  schemaHash: string;         // 보낼 때의 hello.features.schemaHash
}
export type PendingHoldReason = "tooOld" | "storeChanged" | "deviceChanged" | "schemaChanged" | "permanentError" | "readOnly";

export interface HelmClientOptions {
  transportFactory: () => Transport;          // 경로 선택은 이 전송 안에서 한다(20 MultiRouteTransport). 모바일은 @helm/client/browser
  client: ClientInfo;
  auth: { method: "deviceToken"; deviceId: string; sign?: (payload: string) => Promise<string> }
      | { method: "localAdmin"; interactive: "tui" | "tty_cli" | null };
  expectedServerId?: string;
  storage: ClientStateStorage;
  /** 같은 기기·같은 서버에 인스턴스가 둘 이상 뜰 수 있는 플랫폼(브라우저 탭·창)에서 리더 하나만 연결·재전송하게 한다 */
  leaderLock?: (serverId: string, onAcquired: () => void) => () => void;   // 브라우저 구현은 navigator.locks.request
  clock?: () => number;                       // 시험용
  random?: () => number;
}

export declare class HelmClient {
  constructor(opts: HelmClientOptions);
  readonly state: "idle" | "connecting" | "handshaking" | "syncing" | "ready" | "backoff" | "needsUser" | "closed";
  readonly hello: HelloResult | undefined;
  readonly lastMessageAt: number | undefined;   // 마지막 수신 시각(tick 포함). 앱의 "느림" 판정(20 §3.8.9)
  on(ev: "state", cb: (s: HelmClient["state"], detail?: { kind?: string; reason?: string; retryInMs?: number; failure?: TransportFailure }) => void): () => void;
  on(ev: "invalidate", cb: (viewKeys: string[], seq: Seq, meta: { replaying: boolean }) => void): () => void;
  /** 재접속 뒤 다시 보낸 명령의 결과(20 §5.2 (3)). params를 함께 돌려주므로 거부·충돌이면 앱이 초안으로 되살린다 */
  on(ev: "pendingResolved", cb: (p: PendingCommand, outcome: { result: CommandResult } | { error: JsonRpcError }) => void): () => void;
  on(ev: "pendingHeld", cb: (p: PendingCommand, why: PendingHoldReason) => void): () => void;
  on(ev: "outOfRange", cb: (reason: "storeMismatch" | "aheadOfHead" | "beforeOldest" | "tooFar", head: Seq) => void): () => void;
  on(ev: "serverRestarted", cb: (bootEpoch: string) => void): () => void;
  on(ev: "modeChanged", cb: (m: { mode: DaemonMode; since: IsoTime; reasons: ModeReason[] }) => void): () => void;
  on(ev: "shutdown", cb: (n: { reason: string; restartExpectedMs?: number }) => void): () => void;
  on(ev: "credentialLost", cb: (r: { reason: "revoked" | "expired_absolute" | "expired_idle" }) => void): () => void;
  start(): void;                                 // idle·closed에서 연결을 시작한다
  stop(): void;
  retryNow(): void;                              // backoff 대기를 끝내고 바로 시도. retryAfterMs 하한은 지킨다. needsUser면 아무것도 하지 않는다
  request<M extends ReadMethodName>(method: M, params: MethodMap[M]["params"], opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<MethodMap[M]["result"]>;
  command<M extends CommandMethodName>(method: M, params: Omit<MethodMap[M]["params"], "idempotencyKey"> & { idempotencyKey?: string }): Promise<CommandResult>;
  /** 관리 메서드(admin.*). local 리스너의 localAdmin 연결에서만 성공한다 */
  admin<M extends AdminMethodName>(method: M, params: Omit<MethodMap[M]["params"], "idempotencyKey">): Promise<MethodMap[M]["result"]>;
  subscribeEvents(subKey: string, filter: EventFilter, handler: (events: EventWire[], meta: { caughtUp: boolean; replaying: boolean }) => void): () => void;
  subscribeStream(scope: StreamScope, handler: (c: StreamChunkParams | { reset: RunPartial }) => void): () => void;
  getView<D>(view: ViewName, params: Record<string, unknown>, opts?: { minSeq?: Seq }): Promise<ViewResult & { data: D }>;
  trackView(key: string, dependsOn: string[], asOfSeq: Seq): void;   // 무효화 감시 대상 등록
  untrackView(key: string): void;
  reportPresence(p: PresenceReportParams): void;      // 상태가 바뀔 때만 보낸다(최소 2초)
  /** 휴대폰 숨김 직전: 진행 중 명령을 POST /m/cmd keepalive로 보낸다(§3.9.4). 브라우저 전송에서만 동작한다 */
  flushPendingKeepalive(): void;
}
```

코어의 규칙:

- `command()`는 키가 없으면 `ik_<ULID>`를 만들고, 보내기 전에 `putPending`을 끝낸다(`storeId`·`deviceId`·`protocol`·`schemaHash`를 함께 적는다). 결과가 확정된 응답(성공, 3001~3005, 3008, 3009)을 받으면 `removePending`. 3006은 `removePending` 후 버그로 보고한다. 연결이 끊기거나 시간 초과, 재시도 가능 오류면 남겨 두고 재접속 뒤 같은 키·같은 params로 다시 보낸다. 다시 보낸 명령의 결과는 원래 `command()` 호출자가 이미 사라졌을 수 있으므로 `pendingResolved`로 알린다. §3.9.1의 자동 재전송 제외 조건에 걸리면 `holdPending` 후 `pendingHeld`로 알린다. 재전송할 행은 `listPending(serverId, 현재 hello 값)`으로 받는다. `hello.log.storeId`가 저장 위치의 `storeId`와 다르면 그 전에 `clearServer(serverId, "all")`을 부른다.
- 재전송 결과 문구는 결과별로 다르다(20·26이 그린다): `applied`·`duplicate`면 "연결이 끊긴 동안 보낸 조작이 처리됐습니다", 3004·3009면 바뀐 내용을 보이고 쓰던 내용을 초안으로 되살린다, 3008이면 "이미 처리됨"(04 §3.0.5)과 `outcome`, 가정 확정이면 이의 초안(§3.3.5).
- 순서 보장(20 §5.2 (4)): 이벤트 묶음 `(from, to]`를 받으면 코어는 (1) 그 묶음으로 낡은 뷰의 `invalidate` 알림을 먼저 내보내고(앱이 낡음 표시를 저장), (2) 그 뒤에 `savePosition(… to)`을 부른다. 위치 저장은 1초 디바운스, `caughtUp`·전송 닫힘·`stop()` 때 즉시 한다.
- `outOfRange`(§3.5.5): `storeMismatch`·`aheadOfHead`면 `clearServer(serverId, "all")`, `beforeOldest`·`tooFar`면 `clearServer(serverId, "positions")`를 부른 뒤 `head`로 다시 구독하고, 추적 중인 모든 뷰에 `invalidate`를 낸다.
- 자격 상실(`1005` 또는 4009 `auth.revoked`): 코어는 `credentialLost{reason}`을 내고 `needsUser`로 간다. 앱은 사유별로 처리한다(18 §3.19, 20 §3.9.5, 26 §3.3.5와 같은 규칙). `revoked`: 이 서버의 뷰 캐시·진행 중 명령함·blob 캐시를 지우고 초안만 남긴다. 휴대폰은 `POST /m/logout`(`Clear-Site-Data`)도 부른다. `expired_absolute`·`expired_idle`: 캐시와 초안을 남기고 재페어링을 안내한다. 진행 중 명령은 남기되 재페어링 뒤 `deviceId`가 바뀌므로 자동 재전송에서 빠진다(§3.9.1 (3)).
- 요청 시간 제한 기본값: 조회 30초, 명령 60초. 명령이 시간 초과되면 진행 중 명령함에 남기고 연결을 다시 맺는다(응답 유실로 본다).
- 상태 기계는 §3.10.2, 백오프는 §3.10.3이다. `TransportFailure.blocked`와 인증 계열 실패는 `needsUser`로 가고 자동 재시도하지 않는다.
- 코어는 자격 증명을 다루지 않는다(20 §5.2 (2)). 데스크톱은 Rust 전송이 헤더를 붙이고, 모바일은 브라우저가 쿠키를 붙이며, TUI는 `localAdmin`이다. 1판의 `credentials` 선택 인자는 없앴다(결정 47, 판정 J-118).
- 기기당 인스턴스 하나 [가정]: 같은 기기·같은 서버에 코어 인스턴스가 둘이면 같은 진행 중 명령을 함께 재전송할 수 있다(멱등이라 두 번 적용되지는 않지만 결과 알림이 둘이 된다). 브라우저(휴대폰 창 둘, 데스크톱 시험)는 `leaderLock`(`navigator.locks`)으로 리더 하나만 연결·재전송하고 나머지는 리더의 저장소 변화를 읽는다. 데스크톱 앱과 TUI는 프로세스 하나라 해당하지 않는다.
- TUI 재사용: `@helm/tui`는 `HelmClient` + `NodeWsTransport({ socketPath })`(`@helm/client/node`) + `auth: { method: "localAdmin", interactive: "tui" }` + 파일 저장소를 쓰고, 뷰 캐시는 메모리 맵 하나로 둔다. 같은 `view.get` 결과를 pi-tui 컴포넌트로 그리므로 데스크톱과 TUI가 같은 투영을 본다(03 §3.11 parity, 07 §3.9.6). 휘발 스트림은 pi-tui `Markdown` 컴포넌트에 텍스트를 덧붙이는 데 쓴다. 관리 CLI는 `tty_cli`(사람 결정마다 `localConfirm.request`) 또는 `null`(읽기·관리만)이다.
- 코어 사본을 앱에서 고치지 않는다. 필요한 기능은 코어에 더한다(20 §3.9.4).

### 3.15 서버 프로토콜 계층 [제안]

```text
packages/daemon/src/protocol/
  listeners.ts        세 리스너 만들기(주소는 17 설정), 리스너별 전송 조건 훅(18)
  upgrade.ts          업그레이드 검사: 하위 프로토콜, Host·Origin, 헤더·쿠키 토큰 보관(운반 방식), 인증 전 연결 수(18 preflight 호출)
  mobile.ts           /m/* 정적 서빙, /m/pair·/m/whoami·/m/logout·/m/cmd(26 §3.3.2, clients.mobile 플래그)
  connection.ts       연결 상태 기계(§3.4.7), 우선순위 송신 큐(§3.5.8), ping·무수신·tick 타이머
  handshake.ts        챌린지, hello 판정 순서(§3.4.3), 18의 verifyDevice 호출, scope 부여
  dispatcher.ts       METHOD_SPECS → 처리기, params 검사, scope, 동시 요청 한도, $/cancelRequest
  subscriptions/
    events.ts         재생·실시간 알고리즘(§3.5.4), 09 onCommit 훅, 빈 위치 알림(tick 때)
    stream.ts         12 런타임의 휘발 조각 구독 → stream.chunk, run.partial
  views.ts            view.get → 12 투영 API, minSeq 대기, ViewResult 조립
  commands.ts         toCommand_* 변환(§3.7.9), 입력 마스킹, EngineInput(06 §3.4.6), engine.submit, 결과 대응(§3.3.5), localConfirm 발급·검사
  files.ts            HTTP 업로드·다운로드, 티켓 표(연결별), 대기 파일 표시
  presence.ts         연결별 보고 → 기기별 값 → 바뀔 때만 presence.update 제출, question.mark_seen·view.record 파생(§3.7.8)
  push/               Web Push 송신기와 planPush(26 §3.4, 데몬 daemon/push)
  errors.ts           오류 정제(-32603, traceId)
```

다른 모듈에서 쓰는 인터페이스(이름은 각 문서의 것이다. 없는 것은 §5.2에 요구로 적었다):

```ts
// 06 engine(@helm/engine, 06 §3.4.6) — 명령 제출과 커밋 알림
//   engine.submit(input: EngineInput): SubmitResult     // 동기. EngineInput = 10 CommandEnvelope에서 commandId(선택)·channel·actor·via를 호출자가 채운 것
//   engine.onCommitted(listener)                        // 커밋한 그 JS 턴 안에서 동기로 호출(09 onCommitted). 재생 중 보류·실시간 전송의 입력
//   engine.store: RuntimeStoreReader                    // 아래 09 읽기
// 09 (@helm/store, 09 §3.16) — 프로토콜 계층이 읽는 부분
//   store.storeId, store.headSeq
//   store.readEvents({ afterSeq | beforeSeq, limit ≤ 5000, typePrefixes, goalId, concernId, ref, redact: true }) → { events, headSeq, nextAfterSeq }
//   store.invalidations(seqs) → Map<seq, string[]>      // event_invalidations(§3.6.3). readEvents가 함께 돌려주어도 된다
//   store.getRecord(id)                  // record.locate, revisionSeq
//   store.commandByKey(scopeKey)         // command.lookup
//   store.stageUpload(uploadId, mediaType), store.getBlob(hash)
//   store.search(text, …)                // search.query
// 프로토콜은 store.commit·store.transaction을 직접 부르지 않는다

// 12 (@helm/runtime)
interface ProjectionsForProtocol {
  get(view: ViewName, params: unknown, page?: ViewGetParams["page"]): {
    asOfSeq: Seq; data: unknown; dependsOn: string[];
    freshness: ViewResult["freshness"]; staleReason?: ViewResult["staleReason"]; omitted?: ViewResult["omitted"];
  };                                                        // 12 §3.5.8 ViewEnvelope에서 만든다(sourceSeq → asOfSeq, degraded → stale + staleReason)
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

// 18 (packages/daemon/src/auth, 18 §3.4.5가 구현)
interface SecurityForProtocol {
  checkTransport(req: IncomingRequestInfo, listener: ListenerKind):
    | { ok: true; carrier: "header" | "cookie" | null; bearer: string | null;
        ingress?: { login: string; tailnetNodeId: string; nodeName: string; ip: string } }   // tailnetNodeId: 노드 묶기(18 D18-02)
    | { ok: false; httpStatus: 401 | 403 | 429; reason?: string };   // 18 §3.4.3 preflight(Host 불일치도 403) + §3.6.1 tailscaleIngress
  verifyDevice(conn: { bearer: string | null; carrier: "header" | "cookie" | null; listener: ListenerKind; ingress?: { tailnetNodeId: string }; nonce: string; serverId: string },
               auth: { deviceId: string; proof?: DeviceProof }):
    | { ok: true; principal: Principal; scopes: Scope[] }
    | { ok: false; code: 1004 | 1005 | 1007 | 1008; reason?: string };   // 18 §3.6.1 helloDeviceAuth
  cookieAuth(req: IncomingRequestInfo): { ok: true; principal: Principal; scopes: Scope[] } | { ok: false; httpStatus: 401 | 403; reason: string };   // /m/whoami, /files/*, /m/cmd
  maskHumanInput(text: string): string;                     // 입력 단계 마스킹(판정 J-147)
  redactEvent(e: EventWire, conn: ConnectionIdentity): EventWire;              // 09 sensitiveFields(공개 사본과 같은 규칙)
  proofRequired(listener: ListenerKind, deviceId: string | null): boolean;    // 1차 false, 기기별로 켬(모바일 권장)
  rateLimit(source: string, kind: "auth" | "pair" | "command"): { ok: true } | { ok: false; retryAfterMs: number };   // 18 §3.14
}
// 공개용 사본(redactions)은 09 readEvents({ redact: true })가 만든다. 프로토콜은 따로 가리지 않는다
// 12: ProjectionsForProtocol.aggregateTags는 두지 않는다. 태그는 커밋 때 09에 저장된다(§3.6.3)
```

### 3.16 대표 시퀀스

#### 3.16.1 UC-04: 외부에서 WSS로 접속해 질문에 답하기

```text
앱(Rust+TS)                                  데몬
 1 WSS 업그레이드(Authorization, 휴대폰은 쿠키) ─▶ tailnet 리스너: Tailscale 신원 확인 → 101
 2                                 ◀─────── hello.challenge {nonce, serverId}
 3 hello {protocol 1..1, deviceToken, resume:{storeId, seq: 1200}} ─▶ 판정 → ready
 4                                 ◀─────── hello 응답 {headSeq: 1342, resume: ok behind 142}
 5 events.subscribe {from:{storeId,1200}} ─▶ 등록, 응답 {start 1200, head 1342, replaying}
 6                                 ◀─────── events {1200→1342, 142개, caughtUp: true}
   (각 이벤트의 invalidates로 inbox·home 캐시가 낡음 → 열린 inbox만 다시 받기)
 7 view.get {inbox, minSeq 1342}   ───────▶ ◀── ViewResult {asOfSeq 1342, dependsOn [@inbox, qs_…]}
 8 사용자: 질문 14 "허락" → command question.answer {ik_…, questionId, answer:{option:"approve"}, basisSeq 1342}
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
 2 클라이언트: S1 아래 위치·투영 캐시·이벤트 캐시 버림(§3.5.5 1단계). 진행 중 명령함의 S1 항목은 재전송하지 않고 "보내지 못한 조작"으로(§3.9.1)
 3 events.subscribe {from: "head"} → start H0
 4 열린 뷰 view.get {minSeq: H0}, 타임라인은 events.read {before: H0+1}
 5 화면에 "서버 기록이 복원되어 화면을 새로 받았습니다"(문구는 05)
```

#### 3.16.4 SSH 경로

경로 (a)와 같다. 다른 점은 1단계뿐이다: Rust가 `ssh -W 127.0.0.1:<loopback 포트> server`를 띄우고 그 표준 입출력 위에서 업그레이드를 보낸다. `loopback` 리스너는 Tailscale 신원 확인을 하지 않는다. 2단계 이후의 메시지, 위치, 재전송, 멱등 처리는 바이트 단위로 같다.

#### 3.16.5 첨부와 함께 대화 입력

```text
 1 Rust: POST /files/u (Bearer, 2 MiB 이미지, X-Helm-Sha256) → 201 {blob: {blobId: bl_…}}
 2 TS: command composer.submit {scope:{concernId}, text, attachments:[blob], basisSeq, previewId?} → applied, runId
 3 stream.subscribe {scope:{concernId}} → stream.chunk(text, n=1…) … end{finalSeq}
 4 events {…run.message_recorded…} → 휘발 텍스트를 영속 메시지로 바꿈
```

### 3.17 모바일 클라이언트와 푸시 [결정 42·47·48·49·56·57]

휴대폰은 데몬이 서빙하는 홈 화면 웹 앱(PWA)이고 알림은 Web Push다(결정 47). 화면, 수명주기, 서비스 워커, 푸시 계획은 26이 정하고(판정 J-118), 이 절은 프로토콜이 맡는 것만 적는다.

연결:

- 휴대폰은 데스크톱과 같은 메서드·이벤트·재전송 의미와 같은 코어 `@helm/client`(`@helm/client/browser` 전송)를 쓴다. 경로는 휴대폰의 Tailscale을 거친 `tailnet` 리스너뿐이다. SSH 경로는 없다.
- `ClientInfo.kind = "mobile"`, `platform = "ios"`(최소 판 iOS 26, 결정 49). 페어링은 `POST /m/pair`(§3.2.5, 26 §3.3.4)이고 서버가 `clientKind: "mobile"`, `credentialCarrier: "cookie"`로 기기를 만든다. 토큰은 `__Host-helm_dt` 쿠키로만 다닌다(§3.2.2). 스크립트는 `deviceId`·`serverId`만 갖고, `deviceId`를 잃으면 `GET /m/whoami`로 다시 얻는다.
- scope는 `read`, `decideMobile`, `devicesLimited`다(§3.4.6, 18 §3.5). 서명 증명은 1차에 쓰지 않는다(`proofRequired: false`, 26 §3.3.3 MQ-05).
- 수명주기(26 §3.3.5): 숨겨지면 `presence.report { state: "hidden" }`, 진행 중 명령을 `POST /m/cmd` keepalive로 보내고(§3.9.4) 최대 2초 뒤 `stop()`(1000). 보이면 같은 인스턴스로 `start()`·`retryNow()`(§3.10.2 `closed → connecting`). 기본 이벤트 구독은 `filter.payload: "none"`이고 필요한 뷰만 `view.get`으로 받는다.
- 화면 범위: `inbox`, `question`, `brief`(`compact`), `autonomous`, `work`, `review`, `devices`, `settings`, `tray` 뷰를 쓴다(26 §3.5). `brief.acknowledge`는 `compact: true`로 보내고, 줄여 본 반대 근거·이견 항목은 다음 데스크톱 요약에 "휴대폰에서 줄여 본 항목"으로 남는다(판정 J-137, 12·04가 그린다).

푸시(앱이 꺼져 있을 때):

- 푸시는 11의 전달 결정이 `question.delivered`로 기록된 질문에만 보낸다(§3.8.3, canon-3 §10/19). 알림 강도 `interrupt`와 `notice` 질문까지 보낸다(결정 48). 보낼 기기 고르기(`planPush`), 지연 푸시, 시간당 상한, 방해 금지 묶음은 26 §3.4.3이고, 사람이 자리에 없을 때의 강도 계산은 11 `urgencyOf`와 14 §3.13.8 부재 파생 함수다(판정 J-119).
- 결과 확인 알림(결정 56, 판정 J-189): 설정 `notifications.resultReview`가 `none`(기본)이면 푸시를 보내지 않는다. 결과는 복귀 요약에서 확인한다. `daily_digest`면 `notifications.resultReviewDigestAt`(기본 `19:00`, 서버 시간대) 시각에 확인 대기 결과가 하나 이상일 때 묶음 푸시 하나를 강도 `notice`로 보낸다. 묶음 시각을 재는 타이머의 목적은 `result_review_digest`(`runtime_timers`, 09)다. `immediate`면 결과 확인 질문이 생길 때마다 강도 `notice`로 보낸다. 두 경우 모두 방해 금지(`attention.snoozeUntil`, 판정 J-166)와 시간당 상한(판정 J-171)을 따르고, 휴대폰에서 확인할 수 있는 범위는 판정 J-139 그대로다. 푸시 본문과 형식은 26이 정한다.
- `question.delivered.channel`: 연결된 기기에 앱 안으로 보냈으면 `app`, 푸시를 보냈으면 `push`, 둘 다 아니면 `brief`(11·26). `targetDevices`에는 실제로 보낸 기기를 넣는다.
- 푸시 송신이 실패해도 정본은 바뀌지 않는다. 같은 질문의 푸시 횟수(전달 1 + 승격 1)는 푸시 서비스가 받아들인(`push.sent.outcome = "accepted"`) 것만 센다. 대상 기기 모두에서 실패하면 그 전달은 `channel: "brief"`로 남겨 다음 접속·요약에서 보이게 한다(26 §3.4.3에 같은 규칙을 요구).
- payload 형식은 26 §3.4.4 `HelmPushMessage`이고 정의 파일은 `@helm/protocol/src/push.ts`다(데몬과 서비스 워커가 함께 쓴다). 질문 문장, Goal 서술, 근거, 비밀은 싣지 않는다. 내용을 알림에 보일지는 기기가 정한다(05 `notif.hidden.*`, J-03 기본 숨김).
- 철회 푸시는 보내지 않는다(iOS는 푸시마다 알림을 하나 띄워야 한다). 앱이 보일 때 처리된 질문의 알림을 지운다(26 §3.4.9).
- 질문 열람: 휴대폰에서 질문을 열면 `presence.report.objectId`로 데몬이 `question.mark_seen`을 남기고(§3.7.8), 지연 푸시(`push_followup`)는 이 기록이 있으면 취소된다.

푸시 등록(26 §3.4.6, 판정 J-71):

```ts
// packages/protocol/src/devices.ts
// device.registerPush (cmd, scope devices·devicesLimited(자기 기기만)) → 10 device.register_push
export const DeviceRegisterPushParams = Cmd({
  channel: Type.Literal("webpush"),                     // 1차. "apns"는 경로 B 예약(결정 47). 경로 B는 Apple 개발자 프로그램 가입 뒤 검토한다(결정 57)
  address: Type.String({ pattern: "^https://", maxLength: 2048 }),   // 엔드포인트 URL. 비밀로 다룬다: 원문은 09 push_tokens에만, 이벤트에는 해시
  keys: Obj({ p256dh: Type.String({ pattern: "^[A-Za-z0-9_-]{87}$" }), auth: Type.String({ pattern: "^[A-Za-z0-9_-]{22}$" }) }),   // 65·16바이트 base64url
  minUrgency: Enum(["interrupt", "notice"]),            // 기본 notice(결정 48). 사람이 interrupt로 좁힐 수 있다
  vapidKeyId: Type.String({ pattern: "^[0-9a-f]{12}$" }),   // 구독에 쓴 키(device.pushConfig 결과)
});
export const DeviceRegisterPushResult = Merge(CommandResult, Obj({ fingerprint: Type.String({ pattern: "^[0-9a-f]{8}$" }) }));   // 08 tokenHint
// device.unregisterPush (cmd) → 10 device.unregister_push
export const DeviceUnregisterPushParams = Cmd({ channel: Type.Literal("webpush"), reason: Type.Optional(Enum(["user", "permission_lost"])) });
// device.testPush (cmd, scope devicesLimited(자기 기기만)·devices) → 10 device.test_push. kind "test" 푸시 하나
export const DeviceTestPushParams = Cmd({ deviceId: Type.Optional(DeviceId) });   // 없으면 자기 기기
// device.pushConfig (read, scope read): 등록 전에 부른다
export const DevicePushConfigResult = Obj({
  enabled: Type.Boolean(),                              // clients.mobile·push.enabled가 켜져 있고 VAPID 비밀이 있을 때 true
  providers: Type.Array(Type.Literal("webpush")),
  vapidPublicKey: Nullable(Type.String({ pattern: "^[A-Za-z0-9_-]{87}$" })),   // applicationServerKey
  vapidKeyId: Nullable(Type.String({ pattern: "^[0-9a-f]{12}$" })),
});
```

- 검증(26 §3.4.6): 엔드포인트는 `https:`, 포트 없음 또는 443, 호스트가 허용 접미사 목록과 점 경계로 일치해야 한다(아니면 3001 `push.endpoint_not_allowed`). 키 길이가 틀리면 -32602, `vapidKeyId`가 현재 키와 다르면 3001 `push.vapid_key_mismatch`. 푸시가 꺼져 있으면(`enabled: false`) 등록·시험은 5007 `feature.disabled`다.
- 기기 표시는 `DeviceInfo.push`(§3.7.7)의 `fingerprint`(토큰 해시 앞 8자) 하나로 한다(18 표시 규칙과 같다).

## 4. 실패·예외·경계 사례

| ID | 상황 | 처리 | 확인(§6) |
|---|---|---|---|
| F-01 | 업그레이드에 `Sec-WebSocket-Protocol: helm-jsonrpc`가 없다 | HTTP 400. 연결을 만들지 않는다 | CT-02 |
| F-02 | `tailnet`·`loopback`에서 토큰(헤더·쿠키) 없이 업그레이드 | HTTP 401. 클라이언트는 `needsUser`(재페어링 안내). 브라우저는 `/m/whoami`로 401을 알아낸다(§3.10.2) | CT-03, CT-37 |
| F-03 | 챌린지 전에 클라이언트가 `hello`를 보냄(경합) | 서버는 연결을 열자마자 챌린지를 보내므로 정상 클라이언트는 이렇게 하지 않는다. 받으면 처리하되 `proofRequired`면 증명 없음으로 `1004` | CT-04 |
| F-04 | `hello`가 10초 안에 오지 않음, 인증 전 16 KiB 초과, `hello` 전 다른 요청 | 4001 / 1009 / `1001` 후 1008로 닫기 | CT-05 |
| F-05 | 공통 프로토콜 버전 없음 | `1003`. 클라이언트는 자동 재접속을 멈추고, 캐시한 투영을 읽기 전용으로 보이며 "앱 업데이트 필요" 또는 "서버 업데이트 필요"를 안내한다(01 FX-16의 "읽기 전용으로 붙고 갱신 안내"는 서버 연결 없이 캐시로 충족한다) | CT-06 |
| F-06 | 연결 중 기기 폐기 | 커밋 직후 그 기기의 모든 연결에 `connection.closing{kind: "auth.revoked", reason: "revoked"}` 후 4009. 클라이언트는 뷰 캐시·진행 중 명령함·blob 캐시를 지우고 초안만 남긴다(§3.14, 18 §3.19). 다시 페어링하면 새 `deviceId`라 멱등 범위가 바뀌므로, 남은 명령이 있었다면 자동으로 보내지 않는다(§3.9.1 (3)) | CT-16 |
| F-07 | 재생 도중 데몬 재시작 | 연결이 1001로 닫힌다. 클라이언트는 마지막으로 받은 `to`부터 다시 구독한다. `bootEpoch`가 바뀐 것을 보이고, seq는 이어진다 | CT-27 |
| F-08 | 백업에서 복원해 seq가 되돌아감 | 17의 복원이 `storeId`를 바꾼다. `hello`의 `log.resume`과 `events.subscribe`가 `storeMismatch` → 스냅샷 경로(§3.5.5 1단계: 캐시 모두 버림) | CT-08 |
| F-09 | 같은 `storeId`인데 클라이언트 위치가 headSeq보다 큼(복원 때 `storeId`를 바꾸지 않은 운영 실수) | `aheadOfHead` → `storeMismatch`와 같이 처리. 데몬은 운영 로그에 경고를 남긴다 | CT-09 |
| F-10 | 몇 달 만에 접속해 밀린 이벤트가 `maxReplayEvents`를 넘음 | `tooFar` → 스냅샷 경로. 타임라인에 "접속하지 않은 동안의 기록 일부 생략" 표시. 복귀 요약(`brief` 뷰)은 정본에서 만들므로 내용 손실이 없다 | CT-07 |
| F-11 | 느린 소비자(Wi-Fi 약함, 앱이 바쁨) | 휘발 조각을 버리고, 계속 넘치면 4008로 닫는다. 재접속해 위치부터 받는다. 영속 이벤트는 잃지 않는다 | CT-13 |
| F-12 | 이벤트 하나가 송신 상한(4 MiB)을 넘음(09의 256 KiB 제한 위반) | 그 이벤트의 `payload`를 빼고 `redacted: [""]`, `payloadOmitted: "tooLarge"`로 보낸다. 클라이언트는 `records` 뷰로 내용을 본다. 데몬은 운영 로그에 오류를 남긴다(09 버그) | CT-28 |
| F-13 | 명령 응답 유실(연결 끊김) | 진행 중 명령함에 남은 명령을 재접속 뒤 같은 키로 다시 보낸다. 같은 결과(`duplicate: true`) | CT-12 |
| F-14 | 같은 키, 다른 params(클라이언트 버그) | `3006`. 클라이언트는 그 항목을 진행 중 명령함에서 지우고 버그 보고 | CT-11 |
| F-15 | 두 기기가 같은 질문에 거의 동시에 답함 | 먼저 커밋된 것만 남기고 뒤의 것은 거부한다: `3008 command.alreadyResolved` 또는 `3004`(먼저 커밋된 쪽이 대상 `revisionSeq`를 올렸으면). 클라이언트는 둘을 같은 "이미 처리됨"으로 그린다(04 §3.0.5 "이미 답했습니다(다른 기기)", 20·26) | CT-19 |
| F-16 | 낡은 화면에서 결정 | `3004`. 화면은 바뀐 내용을 보이고 쓰던 답을 유지한다(04 §3.0.5). 새 키로 다시 보낸다 | CT-18 |
| F-17 | 데몬이 읽기 전용 | 조회는 되고 명령은 `5003`(적용 안 됨이 확정된 응답). `server.modeChanged{reasons}`로 사유를 알리고 화면은 사유별 배너를 보인다. `5003`을 받은 명령은 자동 재전송에서 빼고 입력을 초안으로 되살린다. 모드가 풀리면 "보내지 않은 답이 있습니다"를 보이고 사람이 보낸다(J-02, 04 A4) | CT-17 |
| F-18 | 데몬 종료 중(`draining`) | 새 명령 `5001` + `retryAfterMs`. 클라이언트는 진행 중 명령함에 두고 재시작 뒤 보낸다 | CT-17 |
| F-19 | 반쯤 열린 연결(노트북 잠자기, Wi-Fi 전환) | 클라이언트 감시 35초 → 4000 → 재접속. 서버는 무수신 45초 뒤 소켓을 지운다 | CT-15 |
| F-20 | ssh 실패(키 거부, 호스트 키 바뀜, ssh 없음) | 20의 `ssh_*` 분류. 키·호스트 키 문제는 `needsUser`, 네트워크 문제면 다른 경로로 넘어간다(20 APP-D05) | 20의 테스트 |
| F-21 | Tailscale serve는 응답하는데 데몬이 꺼짐 | serve가 502·503·504를 준다. `daemonUnreachable`로 분류해 백오프. 화면은 "Helm 서버가 응답하지 않음"(04 §3.0.4) | CT-20 |
| F-22 | 클라이언트 시계가 크게 틀림 | 증명을 쓰면 `1007`. 클라이언트는 `serverTime` 차이를 진단으로 보인다. 화면의 상대 시간은 `tick.serverTime` 기준 오프셋으로 계산한다(21 E16) | CT-21 |
| F-23 | 업로드가 끊김 | 청크 업로드면 `HEAD`로 위치를 받아 이어 올린다. 한 번에 올리기면 처음부터 다시 | CT-23 |
| F-24 | 대기 파일이 24시간 지나 지워진 뒤 명령에서 참조 | 커널이 `not_found.record`로 거부(근거 참조라 3001). 클라이언트는 다시 올리고 새 키로 보낸다 | CT-24 |
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
| F-40 | 안전 모드 | 연결과 사람 명령은 받는다. `hello`·`tick`·`server.modeChanged`의 `safeMode`로 표시하고 `daemon.exitSafeMode`(데스크톱·TUI 기기, 휴대폰, 대화형 `localAdmin`)로 해제한다 | CT-17 |
| F-41 | SSH 호스트 키가 바뀜, SSH 키 거부, 키체인 접근 거부 | 전송이 `blocked`로 실패한다. 코어는 `needsUser`로 가고 자동 재시도하지 않는다(판정 J-62). 앱은 이유와 할 일을 보인다(20) | CT-31 |
| F-42 | 저장소가 복원된 뒤(`storeMismatch`) 진행 중 명령함에 결과를 모르는 명령이 있음 | 복원된 DB에는 그 멱등 키가 없을 수 있어 다시 보내면 두 번 적용될 수 있다. 코어는 `hello` 직후 `log.storeId`를 항목의 `storeId`와 비교해 다르면 재전송 전에 `clearServer(serverId, "all")`을 부르고 그 항목을 `holdPending(storeChanged)`한다. 재전송은 이벤트 구독 복원 뒤에만 시작하므로 `2001`보다 먼저 나가지 않는다(§3.10.2). 사람이 "보내지 못한 조작"에서 보고 새 키로 다시 보낸다 | CT-08 |
| F-43 | 페어링 코드가 만료·소진됨 | `1009`(사유 구분 없음, 18 §3.7.4). 화면 문구는 "코드가 틀렸거나 만료됐습니다. 새 코드를 만드세요"(05). 04·05의 "만료 구분" 요구는 보안상 받지 않았다(§7 Q-15) | CT-32 |
| F-44 | 푸시 송신 실패·구독 만료(모바일) | 결과는 `push.sent{outcome}`으로 남는다. 푸시 횟수는 받아들여진(`accepted`) 것만 센다. 대상 기기 모두에서 실패하면 그 전달은 `channel: "brief"`로 남는다(§3.17). `404`·`410`이면 구독이 끝난 것이라 `device.push_unregistered{reason: "gone"}`, 기기 목록 푸시 상태는 `needs_refresh`(26 §3.4.6). 앱을 열면 위치부터 재전송받으므로 질문을 놓치지 않는다 | 26 |
| F-45 | 토큰 만료(절대 365일·유휴 90일) | `1005`(`reason: expired_absolute \| expired_idle`). 캐시와 초안은 남기고 재페어링을 안내한다. 진행 중 명령은 재페어링 뒤 자동 재전송하지 않는다(§3.14). 만료 30일 전부터 `DeviceInfo.expiringSoon`과 `daemon.status.warnings`로 알린다(18 §3.8.2) | CT-16 |
| F-46 | 같은 명령을 다른 연결·다른 리스너(WSS ↔ SSH)·`/m/cmd`로 다시 보냄 | 멱등 범위와 지문이 연결·경로와 무관하므로(§3.9.2) 저장된 결과를 `duplicate: true`로 받는다 | CT-36 |
| F-47 | 휴대폰 쿠키 업그레이드의 `Origin`이 없거나 다름(다른 포트 포함) | 403(`origin_mismatch`). 데스크톱 토큰이 쿠키로 오거나 모바일 토큰이 헤더로 오면 `hello`에서 `1008`(`carrier_mismatch`) | CT-33 |
| F-48 | 가정 확정 뒤 같은 질문에 답이 옴 | `3008`, `outcome: "assumed"`, `assumedValue`, 다음 행동 `objection.file`(판정 J-120). 화면은 쓰던 답을 이의 초안으로 넘긴다 | CT-38 |
| F-49 | 합의 확정·결과 확인 질문에 `question.answer`가 옴 | `3001`(`policy.answer_option_not_allowed`). 전용 메서드를 써야 한다(판정 J-124) | CT-39 |
| F-50 | `local` 리스너의 `tty_cli`가 확인 문자열 없이 사람 결정을 보냄, 비대화 `localAdmin`이 사람 결정을 보냄 | `1012 confirm.required` / `1010 scope.forbidden`(판정 J-135) | CT-40 |
| F-51 | 모델이 만든 blob이 활성 형식(`text/html`, `image/svg+xml`, `application/xhtml+xml` 등) | 허용 목록 밖이라 `attachment` + `application/octet-stream`, `CSP: sandbox`(§3.11.2). 휴대폰 출처에서 실행되지 않는다 | CT-41 |
| F-52 | 휴대폰에서 답을 보낸 직후 화면이 꺼짐 | 숨김 처리에서 `/m/cmd` keepalive로 같은 키를 보낸다(§3.9.4). 그것도 실패하면 다시 열 때 재전송하고, 그 전까지 "보내지 못한 답 1개"를 보인다(26 §3.3.5) | CT-42 |
| F-53 | 같은 기기·같은 서버에 클라이언트 인스턴스가 둘(브라우저 창 둘) | `leaderLock`으로 하나만 연결·재전송한다(§3.14). 잠금이 없는 플랫폼에서 둘이 재전송해도 멱등이라 한 번만 적용된다 | CT-43 |
| F-54 | 휴대폰이 `mobileReviewable`이 거짓인 결과에 `result.accept`를 보냄 | `1010`(`required: "decide"`, `field: "decision"`). 화면은 `mobileReason`의 문구 키(05 `notice.mobile.reviewOnDesktop`)로 데스크톱에서 확인하라고 보인다(판정 J-139) | CT-49 |
| F-55 | 합의가 기대는 Goal이 `active`가 아닌 상태(`retired`·`superseded`·`paused`)에서 쓰기·실행·발송 명령 | `3001 policy.goal_not_active`(판정 J-130). 화면은 접힌 Goal 아래 합의를 주의 항목으로 보인다(04) | CT-50 |

## 5. 다른 문서와의 인터페이스

### 5.1 이 문서가 제공하는 것

| 제공 | 받는 문서 |
|---|---|
| 리스너 셋의 역할과 받는 인증 방식(§3.2.1), 토큰 운반 방식(헤더·쿠키, §3.2.2), SSH 경로 결정과 프레이밍(§3.2.3), HTTP 경로 표(`/m/*`, `/m/cmd`, `/files/*` 격리, §3.2.5) | 06, 17, 18, 20, 26 |
| envelope, 오류 코드 표(§3.3.4, 정본), 10 거부 코드 → 프로토콜 결과 대응(§3.3.5) | 05(문구 키), 10, 20, 21, 22, 26 |
| 핸드셰이크 메시지와 정책 값(§3.4) | 17, 18, 20 |
| 재전송 계약(`storeId`, `(from, to]`, 스냅샷 경로)(§3.5) | 09, 17, 20, TUI |
| 화면 투영 조회와 무효화 태그 규칙(§3.6.3) | 04, 12, 20, 21 |
| 휘발 스트림 형식(§3.6.4) | 12, 20, 21 |
| 메서드 이름(정본)과 커널 명령 대응(§3.7.1), 메서드별 params·result TypeBox 스키마(§3.7.2~§3.7.8), params → 10 payload 변환(§3.7.9), scope와 모바일 허용(§3.4.6) | 04, 05, 10, 11, 14, 15, 16, 18, 20, 21, 26 |
| 뷰 이름·params·키(§3.7.4) | 04, 12, 16, 20 |
| 멱등 처리와 `basisSeq` 전달(§3.9) | 09, 10, 20 |
| 생존 확인·재접속 상태 기계(§3.10) | 20, 26, 04 §3.0.4 |
| 푸시 등록 메서드와 푸시 쪽 프로토콜 규칙(§3.17) | 26, 08, 09, 10, 11 |
| 파일 HTTP 규약(§3.11) | 12, 15, 17, 20 |
| `@helm/protocol` 구조, 등록 표, 생성 스크립트(§3.13), `@helm/client` 코어 API(§3.14) | 06, 20, 22, 23, TUI |
| 적합성 테스트 시나리오(§6.3) | 22 |

### 5.2 다른 문서에 요구하는 것

받은 요구 중 반영한 것은 "반영", 남은 것은 "요구"로 적는다.

| 문서 | 반영한 것 / 남은 요구 |
|---|---|
| 01 | 반영: NFR-P-1·P-2·P-4 측정 지점(§6.4), NFR-D-4(§3.9), FX-16(F-05), R-OP-2(b) echo를 `composer.preview.entry`로. 요구: (1) FX-16의 "읽기 전용으로 붙는다"를 "캐시한 투영을 읽기 전용으로 보인다"로(버전이 맞지 않으면 연결을 맺지 않는다). (2) 미리보기가 없거나 보낸 뒤 진입 판정이 달라지면 확정 질문으로 간다는 규칙을 R-OP-2에 |
| 02 | 반영: AC-04-04(세 리스너 동등성, §6.3), 휴대폰 경로(§3.17). 요구: UC-04 휴대폰 대안에 "숨김 직전 `/m/cmd`", UC-11에 `project.create`·`goal.activate` 단계, UC-07 A5 거절 행의 `reopenTo` 기본값 규칙(판정 J-24) |
| 03 | 반영: 화면별 뷰 카탈로그(§3.7.4), 딥 링크 경로 인자(`record.locate`). 요구: Goal 범위 다이얼 삭제(판정 J-136), 결과 확인 행동 이름을 05 §3.4.1 다섯으로 |
| 04 | 반영: 메서드 이름(§3.7.1)과 `objection.file`·`result.accept{decision}`·`agreement.revise`·`agreement.narrow`·`project.create`·`goal.activate`, `RecordRef` 하나(§3.7.2), `review` 뷰의 반영 범위 합의 초안. 요구: (1) §5.2 명령 의도 대응표를 지우고 19 §3.7.1을 참조. (2) `result.reject`·`acceptWithConditions`·`acceptConditional`·`submissionId`·`verdict` → `result.accept`의 `decision`, `resultId`. (3) 데이터 타입이 없는 뷰 6개(`concernTree`, `thread`, `goals`, `devices`, `records`, `settings`)의 View 타입. (4) 뷰 타입이 08·12·19 값(Goal·Run 상태, RecordKind, 결과 확인 기록 값)을 쓰고 표시용 묶음은 다른 이름의 계산 필드로. (5) 결과 확인 화면에서 반영 범위를 접지 않는다(판정 J-126), 반영 처리 방침 선택(`obligationPolicy`). (6) "이대로 둔다"(`decision.confirm`) 동작. (7) `work.requestBrief`는 `view.get("brief", { workUnitId })`. (8) 금지 버튼어 정리(05 §3.10.5). (9) `loopTimeline` 계획 기록의 `authoredBy` 표시(판정 J-188 (6)), `settings` 뷰의 결과 확인 알림 키 두 개(판정 J-189). (10) `dial` 편집 화면이 `planAuthoring`을 user·concern 층에서만 받게 한다(판정 J-188 (1)) |
| 05 | 반영: 오류 kind 표(§3.3.4)와 10 대응(§3.3.5). 요구: (1) 10 거부 코드 ↔ 19 오류 코드 ↔ 05 문구 키를 05 §3.10 표 하나로(19 §3.3.4의 모든 kind, §3.3.5의 모든 `reason`, `{rule}` = `details.ruleId`, `{fix}` = `details.nextActions`). (2) 새 키: `confirm.required`, `auth.methodNotAllowed`의 `carrier_mismatch`, `origin_mismatch`, `rateLimited`의 `limit`, 읽기 전용 사유별(`disk_critical`, `integrity_suspect`, `projection_fault`, `operator`), `push.endpoint_not_allowed`, 재전송 결과별 문구, "보내지 못한 조작" 보류 사유 여섯. (3) `notif.hidden.title`·`body`(개수 있음·없음) 하나로 숨김 문구 |
| 06 | 반영: `@helm/client/testing` 진입점, `EngineInput`·`SubmitResult`(§3.9.2, §3.3.5), `runtimeAdapter` scope 행(`modelTool`, §3.4.6), 세 리스너 동등성 시험. 요구: 06 §3.3.1 진입점 목록에 `@helm/client/browser`의 쿠키·`/m/cmd`·`leaderLock` 설명 |
| 07 | 반영: TypeBox 1.3.27 import 형태와 `Compile`(§3.3.1, §3.13.2). 남은 요구 없음 |
| 08 | 반영: `ObjectionTarget`, `AcceptanceCore`(`reopenTo` C.commit·I.fact·I.want, `obligationPolicy`, `integrationAgreementId`), `ReactionPayload`, `Trigger`, `credentialCarrier`, `PushRegistration`, `ActorRef` 문자열 문법(§3.5.2). 요구: (1) `Via.listener`를 19 `ListenerKind`(`tailnet`·`loopback`·`local`) 값으로(18 §3.5 규칙 3). (2) `ChoiceHumanCore` 이름으로 사람 선택 core 스키마를 export. (3) `RecordKind`(레코드 kind 리터럴 유니온) export. (4) 사람의 `toolcall.recover` 답에 utterance 관찰을 evidence로 넣는 파생을 §3.22.7에(10과 함께). (5) 다이얼 키 `planAuthoring`을 `DIAL_KEYS`에 더한다(판정 J-188 (1)). (6) `LoopPlanCore`에 `authoredBy: 'code' \| 'model' \| 'human'`을 더한다(판정 J-188 (5)) |
| 09 | 반영: `event_invalidations` 저장값을 그대로 보냄(§3.6.3), 멱등 범위 키와 지문(`viaKey`, 발급 ID 필드 제외), `EventQuery`의 `untilSeq`·`scanLimit`·`excludeTypePrefixes`·`concernIds`·`includeDescendants`·`goalIds`와 `scannedUntilSeq`(§3.5.4), 보관 365일과 줄인 행. 요구: (1) `brief.acknowledged` payload에 `note`, `compact`. (2) `question.assumed`의 `bumpsRevision` 명시(판정 J-120). (3) `PresenceState`에서 `locked` 삭제(판정 J-118·J-119). (4) 줄인 명령 행의 반환 규칙(§3.9.2)을 §3.15.3에. (5) 가린 blob의 표시 해시를 HMAC으로 바꿀지(§3.11.1, 18과 함께). (6) 계획 기록 이벤트(`loop_plan.adopted`)의 payload에 `authoredBy`(판정 J-188 (5)), 타이머 목적 `result_review_digest`(`runtime_timers`, 판정 J-189 (2)). `setting.changed`의 키 `notifications.resultReview`·`notifications.resultReviewDigestAt`은 그대로 쓴다(판정 J-189 (5)) |
| 10 | 반영: 명령 이름과 10 §3.11.11(2) 대응표(`objection.file`, `result.reopen` 없음, `criterion.*`, `agreement.revise`·`narrow`의 상태별 대응), 거부 코드 대응(§3.3.5), `basisSeq` 비교(판정 J-79). 요구: (1) 대응표에 더할 행: `result.accept` 하나로 합친 것(`acceptWithConditions`·`requestRevision` 행 삭제), `inquiry.pinLens` → `lens.update`, `inquiry.fillCell`의 명령, `agreement.renegotiate` 메서드, `project.create`, `goal.activate`(+`edits`), `daemon.exitSafeMode` 주체(데스크톱·TUI 기기, 휴대폰, 대화형 `localAdmin`), `recovery.resolve`의 WorkUnit 대상(12 실행 수준 동작), `inquiry.stop`의 `then`. (2) `question.answer`가 `agreement_confirm`·`result_review` 질문에 오면 `policy.answer_option_not_allowed`(판정 J-124). (3) `objection.file`의 `concernId` 도출 규칙(record면 그 레코드의 Concern, link면 `from`의 Concern). (4) 충돌 분류 의사코드(대상 여럿 우선순위, 끝난 대상의 3008/3001, rebase 키)를 §3.3.4에. (5) `resumption_check.score`의 H 채널. (6) `device.rebind`를 통치 명령 목록에. (7) `denied.recovery_turn`처럼 다른 문서가 쓰는 코드를 §3.4.4에. (8) 사람의 `toolcall.recover`에 utterance 관찰을 evidence로. (9) `decision.contest` payload에 `reasonKind`(08 `ObjectionCore`)를 싣는다. `loop_plan.record`의 `authoredBy`는 사람 수정이면 `human`이다(판정 J-188 (5)) |
| 11 | 반영: `AnswerValue`를 `question.answer` params로 그대로(§3.7.5), `defer.until` 이름(`next_work_boundary`·`user_return`), 3008 `assumedValue`(판정 J-120), presence 값(판정 J-119). 요구: (1) `AnswerValue`를 TypeBox로 `@helm/domain`에. (2) `narrow_scope.instruction`(자연어)을 구조화 범위로 바꾸는 주체(11 또는 런타임)를 정하기. (3) 휴대폰 미루기 기본값("다음 데스크톱 접속까지")을 `user_return` + 기기 조건으로 표현할지, 아니면 03·26 기본값을 `next_work_boundary`로 |
| 12 | 반영: `RunPhase` 대응은 12 §3.2.2 표를 참조, `RunEndReason`(§3.6.4), 집계 태그 정본은 12 §3.5.8, 복구 선택지 집합은 12 §3.7.4, 모델 상태 값(§3.7.8). 요구: (1) 집계 태그 표에 19 뷰 카탈로그가 쓰는 이름(`@autonomous`, `@goals`, `@settings`, `@tray`)을 넣거나 19와 이름을 맞추기. (2) 뷰 원천 표를 26행 전부로. (3) `ProjectionsForProtocol.aggregateTags`는 프로토콜이 부르지 않는다(태그는 09 저장값). (4) `brief` 뷰의 `compact`·`workUnitId` 파라미터와 "휴대폰에서 줄여 본 항목"(판정 J-137) |
| 13 | 요구: (1) 도구 격리의 가림 목록에 `%t/helm`(소켓 디렉터리). (2) 외부 런타임 MCP 설정에는 `runtimeAdapter` 토큰만 넣고 기기 토큰을 넣지 않는다(13 §3.11.6, 18 §3.5 규칙 8) |
| 14 | 반영: 14 §5의 19 요구 (1)~(4)(`dial.set`의 `key` = 08 `DialKey`, 범위 user·concern·instruction, 값은 `DIAL_DEFS[key].valueSchema`, `settings.update`는 `DIAL_DEFS`의 setting, `mode.set`은 08 `MODE_IDS`, `ORCH_*` 대응 §3.3.5). 요구: (1) `ORCH_*`를 10 거부 코드(`policy.*`)로 내기. (2) presence 부재 파생 함수의 입력에 기기 종류별 문턱(데스크톱 5분, 휴대폰 2분, 판정 J-119). (3) 다이얼 `planAuthoring`(층 user·concern, 기본 `hybrid`)과 설정 `notifications.resultReview`·`notifications.resultReviewDigestAt`을 `DIAL_DEFS`에 더한다(판정 J-188 (1), J-189). (4) 다이얼 `assumptionDeferOnDowntime`을 `DIAL_DEFS`에 더한다([판정 J-197], 키 이름은 [판정 J-221]). 19의 `dial.set`·`settings.update`는 그 정의로 값을 검사한다 |
| 15 | 반영: 15 §5의 19 요구 (1)~(6) 전부(§3.7.5: `objection.file`, `InquiryStopParams.then`, `ReactionRecordParams`, `triad.similar`·`questionId`, `inquiryId + roundNo`, `criterion_confirm` 항목 배열). 요구: (1) `inquiry.fillCell`의 처리 명령(10과 함께). (2) "둘 다 아님"은 `comparison`의 `kind: "neither"` 하나로 보낸다(판정 J-184). 두 자극에 strength -1 반응을 나눠 보내지 않는다 |
| 16 | 반영: `metrics`·`evaluation` 뷰, 측정 명령, 열람 기록은 `presence.report`에서(§3.7.8), `depth`(판정 J-84). 남은 요구 없음 |
| 17 | 반영: `admin.status`(`OpsStatus`), `admin.backupNow.kind`, 관리 params에 `basisSeq` 없음, `ModeReason`, 1012 닫는 코드. 요구: (1) `OpsStatus`를 TypeBox로 두고 `models[].status`를 12 값(`ok`·`missing_key`·`auth_failed`·`unreachable`·`rate_limited`)으로, `recovery` 필드(12 RecoveryReport). (2) `server.shutdown.reason`과 09 `daemon.stopped.reason` 대응을 §3.4.3에. (3) 읽기 전용 시작에서도 메모리에 `bootEpoch`를 만든다. (4) 안전 모드 해제 주체를 19 §3.7.8 규칙으로. (5) 복원 때 `storeId` 교체와 `store.restored`(09 §3.14.2) |
| 18 | 반영: 쿠키 운반과 preflight 갈래(§3.2.2·§3.2.5), `helm-bearer.` 미수용(18 §3.4.4), 주체·scope(`decideMobile`, `devicesLimited`, `modelTool`, 대화형 `localAdmin`), 1004 고정·1006 미사용, `carrier_mismatch`·`origin_mismatch`, Host 불일치 403, 인증 실패 지연(XFF로 차단하지 않음), 확인 문자열(`localConfirm`). 요구: (1) 다운로드 티켓 규칙을 19 §3.11.2로(5분, 연결에 묶임, blob 하나, 수명 안 Range 여러 번). (2) `/files/*` 격리 헤더 시험을 §3.17에. (3) 입력 단계 마스킹 함수 `maskHumanInput`(판정 J-147)과 마스킹 지점 표의 "사람 명령 payload" 행. (4) 기기당 대기 업로드 합계·세션 수(§3.4.4)를 §3.14에 |
| 20 | 반영: `HelmClient`·`ClientStateStorage`(§3.14), `PendingCommand`의 `storeId`·`deviceId`·`protocol`·`schemaHash`, `holdPending`·`pendingHeld`, `credentialLost` 사유별 처리, `command.lookup`, `BlobRef`. 요구: (1) PendingRow에 위 네 필드와 보류 사유. (2) CommandOutcome에 3008·3009 갈래와 `removePending` 조건. (3) 재전송 결과별 문구와 초안 되살리기. (4) 5003 항목을 초안으로 되살리기(F-17). (5) IPC `BlobRef`를 19 모양 + `url`로. (6) 첫 실행 안내에 디스크 암호화(18 §3.19) |
| 21 | 반영: `CommandImpact`, 오류 kind, 이미지 판 경로. 요구: `RecordRef`를 19 하나로, 결과 확인 값은 08 기록 값 |
| 22 | 반영: 22 §5.2의 19 요구 (1)~(5)(`just test-conformance-ssh`, 지문 무관 문장과 CT-36, CT-08 확장, CT-24 이름, §6.4 PF 실행). 요구: CT-33·CT-36~CT-50을 적합성 스위트 표에 |
| 23 | 반영: 23 §5.2의 19 요구(Q-16·Q-18 해소, 태그 저장 방식, 푸시 메서드). 요구: M10에 TypeBox 등록 표(약 110개 스키마)와 변환 메타데이터(§3.7.9) 작업을 따로 둔다 |
| 26 | 반영: 26 §5.2 19 행 (1)~(11) 전부(§3.17, 푸시 메서드, `/m/*`·`/m/cmd`, `/files` 격리, `locked` 삭제, `closed → connecting`·`/m/whoami` 판정·`carrier_mismatch`·`origin_mismatch`, `decideMobile`, `AnswerValue`, `brief.acknowledge.compact`, `question.seen` 규칙, `objection.file`). 요구: (1) `decideMobile` 표의 `result.accept(decision accepted)`·`result.requestRevision`을 `result.accept`의 `decision: "accept"`·`"request_changes"`로(명령 값, 판정 J-123으로 메서드 하나). (2) 푸시가 모든 대상 기기에서 실패하면 `channel: "brief"`로 남기는 규칙과 `sentCount`는 `accepted`만 센다는 규칙(§3.17). (3) 결과 확인 묶음·즉시 푸시(판정 J-189 (2)~(3))의 본문과 시각 처리 규칙 |

## 6. 구현 단위와 완료 기준

### 6.1 `@helm/protocol`

| 단위 | 파일 | 완료 기준(테스트로 확인할 조건) |
|---|---|---|
| envelope·codec | `src/jsonrpc.ts`, `src/codec.ts` | 유효한 요청·응답·알림을 왕복한다. `additionalProperties` 위반, 숫자 id, 배열 params, 배치, 깊이 65, 배열 10,001, 1 MiB 초과가 각각 정해진 오류 코드로 거부된다 |
| 오류 표 | `src/errors.ts` | §3.3.4의 모든 행이 있다. code와 kind가 각각 유일하다. 생성 문서의 표와 같다(`check-registry`) |
| 등록 표 | `src/registry.ts` | §3.7.1의 모든 메서드가 있다. 모든 `params`·`result`가 TypeBox 상수이고 `Compile`로 컴파일된다. `cmd`의 params는 모두 `CommandBase` 필드를 가진다(스키마 검사). `MethodMap`이 모든 이름에 대해 params·result 타입을 낸다. `kernelCommand`가 10 대응표(§3.7.1)와 같다 |
| 핸드셰이크 스키마 | `src/handshake.ts` | `DEFAULT_POLICY` 값이 §3.4.4와 같다. 버전 고르기 함수가 경계값(겹침 없음, 한 점 겹침, 포함)에서 맞다 |
| 이벤트·뷰·스트림 스키마 | `src/events.ts`, `src/views.ts`, `src/stream.ts` | 뷰 카탈로그의 모든 이름에 params 스키마가 있다. `ViewResult` 예시 JSON이 스키마를 통과한다 |
| 변환 메타데이터 | `src/convert.ts` | §3.7.9의 모든 행이 있다. 데몬 `toCommand_*` 함수 목록과 같다(`check-registry`). 각 변환 결과가 10 payload 스키마를 통과한다(10의 `CommandSpec.payloadSchema`로 속성 테스트) |
| 생성 스크립트 | `scripts/gen-*.ts`, `check-registry.ts` | JSON Schema와 참조 문서가 만들어지고, 등록 표를 바꾸지 않으면 다시 만들어도 내용이 같다(결정적). 서버 처리기 목록과 등록 표가 다르면 실패한다 |
| 브라우저 안전 | 검사 스크립트 | 루트·`./testing` 진입점을 esbuild `platform: "browser"`로 묶었을 때 `node:` import가 없다. 서비스 워커가 쓰는 `push.ts`도 같다 |
| 테스트 도구 | `src/testing/` | `FakeDaemon`이 §3.4·§3.5·§3.9의 규칙을 메모리 저장소로 구현하고 §6.3 스위트를 통과한다. 데몬 실물도 같은 스위트를 통과한다 |

### 6.2 `@helm/client`와 데몬 프로토콜 계층

| 단위 | 파일 | 완료 기준 |
|---|---|---|
| 클라이언트 상태 기계 | `packages/client/src/connection.ts` | §3.10.2 표의 모든 행을 가짜 전송·가짜 시계로 재현하는 표 기반 테스트가 통과한다. 인증 계열 실패와 `blocked`에서 재접속하지 않는다. `retryNow()`가 백오프를 끝내되 `retryAfterMs` 하한을 지킨다 |
| 백오프 | `packages/client/src/backoff.ts` | 고정 난수로 0.5·1·2·4…30초 구간과 지터 범위를 확인. `retryAfterMs`가 하한이 된다. ready 30초 뒤 0으로 돌아간다 |
| 구독 복원·gap | `packages/client/src/subscriptions.ts` | 저장된 위치로 다시 구독한다. `from` 불일치에서 다시 구독, 1분 3회에서 재접속. `2001`에서 §3.5.5 순서를 지킨다 |
| 진행 중 명령함 | `packages/client/src/outbox.ts` | 보내기 전에 저장(`storeId`·`deviceId`·`protocol`·`schemaHash` 포함), 결과 확정 응답 후 삭제, 연결이 끊기면 이벤트 구독 복원 뒤 같은 키·같은 params로 재전송. §3.9.1의 여섯 제외 조건에서 `holdPending`. `3008`·`3009`에서 삭제 |
| 뷰 무효화 | `packages/client/src/views.ts` | 태그 교집합 규칙, 열린 뷰만 다시 받기, 키별 디바운스·동시 1개, `caughtUp` 전 지연 |
| 휘발 스트림 | `packages/client/src/stream.ts` | offset 덧붙이기·중복·겹침·구멍 경우별 테스트, `n` 건너뜀에서 `run.partial`, `finalSeq` 전에는 지우지 않음 |
| 리스너 | `packages/daemon/src/protocol/listeners.ts`, `upgrade.ts`, `mobile.ts` | 세 리스너가 같은 처리기를 쓴다. 리스너별 허용 인증 방식과 경로가 §3.2.1·§3.2.5와 같다. 하위 프로토콜·토큰 없을 때 400·401. 쿠키는 `tailnet`에서만 읽는다. Origin 정확 일치(포트 포함). `helm-bearer.` 값은 무시한다. `clients.mobile`이 꺼져 있으면 `/m/*` 404 |
| 연결·핸드셰이크 | `connection.ts`, `handshake.ts` | §3.4.7 상태 표의 모든 행. 인증 전 제한(§3.4.5) 각 행 |
| 디스패처 | `dispatcher.ts` | 등록 표에 없는 메서드 `-32601`, scope 위반 `1010`, 동시 요청 33번째 `5002`, `$/cancelRequest`로 조회가 `5004`로 끝남 |
| 이벤트 구독 | `subscriptions/events.ts` | (속성 테스트) 무작위 커밋 순서·필터·구독 시점·재접속 지점에 대해, 클라이언트가 받은 이벤트 합집합이 정본의 필터 결과와 같고 중복·누락이 없다. 재생 중 커밋이 보류분으로 정확히 이어진다 |
| 뷰 | `views.ts` | `minSeq` 대기와 `2006`. (속성 테스트, VIEW-01) 무작위 이벤트열에서 뷰 `data`가 바뀌면 그 이벤트의 `invalidates`와 뷰의 `dependsOn`이 겹친다 |
| 명령 | `commands.ts` | 같은 키·같은 params는 저장된 결과, 다른 params는 `3006`. 다른 연결·리스너·`/m/cmd`로 같은 키를 보내면 `duplicate: true`. `basisSeq`보다 뒤에 바뀐 대상은 `3004`. 10 거부 코드가 §3.3.5대로 대응된다. 커밋 이벤트 알림이 응답보다 먼저 나간다(§3.5.9). `decideMobile` 값 제한과 `localConfirm` 검사 |
| 파일 | `files.ts` | 한 번에 올리기, 청크·이어 올리기, 해시 불일치 422, 크기 413, 기기당 대기 합계 429, Range 206·416, 티켓 만료·연결 종료 후 401, 모든 응답의 격리 헤더, 허용 목록 밖 형식의 `attachment` + `octet-stream`, 쿠키 응답의 `no-store`, 접근 로그의 티켓 가림 |
| presence | `presence.ts` | 기기별 값이 바뀔 때만 `presence.update` 제출, 마지막 연결이 닫히면 `offline`, 질문 열람에서 `question.mark_seen` 한 번 |
| 백프레셔 | `connection.ts` | 송신 큐가 8 MiB를 넘으면 `stream.chunk`부터 버리고, 지속되면 4008. 응답·tick은 대량 이벤트 뒤에 막히지 않는다 |

### 6.3 적합성 시나리오 [제안]

`@helm/protocol/testing`의 시나리오 DSL로 쓰고, (1) `FakeDaemon`, (2) 실제 데몬의 `tailnet` 리스너(전송 조건은 테스트 훅으로 통과), (3) `loopback` 리스너, (4) `loopback`에 `ssh -W localhost`로 붙은 경로(`just test-conformance-ssh`, 22 §3.10.1), (5) `local` 리스너에 대해 같은 스위트를 돌린다. 경로 사이에 주고받은 JSON-RPC 메시지 열(요청 id·시각·nonce·연결 ID를 정규화한 것)이 같아야 한다. 이것이 결정 38의 "두 방식에서 메시지와 재전송 의미가 같다"의 확인이다.

| ID | 시나리오 | 기대 |
|---|---|---|
| CT-01 | 정상 핸드셰이크 | 챌린지가 첫 메시지, `hello` 응답의 정책·기능·로그 위치 |
| CT-02 | 하위 프로토콜 없음 | HTTP 400 |
| CT-03 | 토큰 없음·형식 틀림·해시 없음·다른 기기 ID | 401 / 401 / `1004` / `1008` |
| CT-04 | 증명 필요 설정에서 증명 없음·nonce 다름·시각 밖 | `1004` / `1007` / `1007` |
| CT-05 | 인증 전 다른 요청, 16 KiB 초과, 10초 무응답, 실패 6회 | 닫기 코드와 `1011` |
| CT-06 | 버전 겹침 없음 | `1003` + 범위, 클라이언트 재접속 중단 |
| CT-07 | 위치가 `maxReplayEvents`보다 뒤 | `2001 tooFar`, 스냅샷 경로 |
| CT-08 | `storeId` 다름(진행 중 명령 하나가 있는 상태) | `2001 storeMismatch`, 캐시 폐기. 진행 중 명령의 재전송이 `2001`보다 먼저 나가지 않고, `hello.log.storeId`가 다르면 재전송 전에 캐시를 비우며 그 항목은 `pendingHeld(storeChanged)` |
| CT-09 | 위치가 headSeq보다 큼 | `2001 aheadOfHead` |
| CT-10 | 서버가 일부러 구간을 건너뛴 알림(장애 주입) | 클라이언트가 다시 구독하고, 반복되면 재접속 |
| CT-11 | 같은 키·다른 params | `3006` |
| CT-12 | 커밋 직후 응답 전에 연결 끊기 → 재접속 → 같은 키 | `duplicate: true`, 이벤트 한 번만 |
| CT-13 | 느린 소비자(클라이언트가 읽기를 멈춤) | 4008, 재접속 뒤 누락 없음 |
| CT-14 | 휘발 조각 일부 버림, `end`와 영속 이벤트 순서 | `run.partial`로 복원, 텍스트 일치 |
| CT-15 | tick 끊김(서버가 tick을 멈춤) | 클라이언트 35초 뒤 4000 |
| CT-16 | 연결 중 기기 폐기, 만료 | `connection.closing{reason}` + 4009, 재접속 안 함. `revoked`면 진행 중 명령함·캐시 삭제, 만료면 남김. 재페어링 뒤 `deviceId`가 바뀐 항목은 `pendingHeld(deviceChanged)` |
| CT-17 | 읽기 전용·종료 중·안전 모드 | `5003`(항목은 `pendingHeld(readOnly)`) / `5001` + `retryAfterMs` / 명령 수락 |
| CT-18 | `basisSeq` 뒤 대상 변경 | `3004` |
| CT-19 | 두 연결이 같은 질문에 답 | 하나 `applied`, 하나 `3008` 또는 `3004` |
| CT-20 | 커밋 전·후 `$/cancelRequest`, 데몬 꺼짐(502) | `5004` / 정상 결과 / `daemonUnreachable` |
| CT-21 | 시계 차이 | `serverTime` 진단, 증명 시 `1007` |
| CT-22 | Range 다운로드 중 티켓 만료 | 401 후 새 티켓으로 이어 받기 |
| CT-23 | 청크 업로드 중 끊기 | `HEAD`로 이어 올리기, 해시 일치 |
| CT-24 | 정리된 대기 파일 참조 | `3001`(`reason: "not_found.record"`) |
| CT-25 | 모르는 이벤트 종류·필드, 대체된 레코드 뷰 | 클라이언트 오류 없음 |
| CT-26 | 배치, 깊이·길이 초과 | `-32600` |
| CT-27 | 재생 중 데몬 재시작 | 마지막 `to`부터 이어서, 누락·중복 없음, `bootEpoch` 바뀜 |
| CT-28 | 4 MiB 넘는 이벤트(장애 주입) | `payloadOmitted` |
| CT-29 | 투영 지연(장애 주입) | `2006` 후 재시도로 `asOfSeq ≥ minSeq` |
| CT-30 | 같은 키가 두 연결에서 동시에 | 하나는 기다려 `duplicate: true` |
| CT-31 | 전송 실패 `blocked`(가짜 전송) | 코어가 `needsUser`, 재시도 없음. `retryNow()`도 아무것도 하지 않음 |
| CT-32 | `POST /pair` 틀린 코드·만료 코드·소진 코드·`loopback`에서 요청 | 앞의 셋은 같은 `1009` 응답, 마지막은 404 |
| CT-33 | 쿠키 운반: 쿠키 + 맞는 Origin, Origin 없음, 다른 포트의 Origin, 헤더와 쿠키 둘 다, 데스크톱 토큰을 쿠키로, `helm-bearer.` 하위 프로토콜만 | 성공 / 403 / 403 / 헤더를 씀 / `1008 carrier_mismatch` / 401(정식 데몬은 받지 않는다) |
| CT-34 | 재접속 뒤 다시 보낸 명령 | `pendingResolved` 알림 한 번, 원래 호출자가 없어도 결과가 전달됨 |
| CT-35 | 이벤트 묶음 처리 순서 | `invalidate` 알림이 같은 구간의 `savePosition`보다 먼저 일어남(가짜 저장소로 호출 순서 기록) |
| CT-36 | 커밋 직후 연결을 끊고 다른 리스너(또는 `/m/cmd`)로 같은 키·같은 params 재전송 | `duplicate: true`, 이벤트 한 번만(22 FI-25) |
| CT-37 | 브라우저 전송: 쿠키 없음·폐기된 쿠키로 업그레이드 | `open` 전 1006 → `/m/whoami` 401 → `needsUser`, 백오프 없음 |
| CT-38 | 가정 확정 뒤 답 | `3008`, `assumedValue`, `nextActions`에 `objection.file` |
| CT-39 | `result_review` 질문에 `question.answer` | `3001 policy.answer_option_not_allowed` |
| CT-40 | `tty_cli` 결정 명령: 확인 없음·틀린 확인·만료·재사용, 비대화 `localAdmin`의 결정 명령, `decideMobile`의 `result.accept{reject}` | `1012` 네 가지 / `1010` / `1010`(`field: decision`) |
| CT-41 | `text/html`·`image/svg+xml` blob 다운로드 | `attachment`, `application/octet-stream`, `CSP: sandbox` |
| CT-42 | 명령 직후 `stop()`과 `/m/cmd` keepalive가 겹침 | 한 번만 적용, 다시 열면 `pendingResolved` 한 번 |
| CT-43 | 같은 서버에 인스턴스 둘(가짜 `leaderLock`) | 하나만 연결·재전송 |
| CT-44 | `presence.report` 같은 값 반복, 기기의 두 연결이 다른 값, 마지막 연결 닫힘 | `presence.update` 제출은 값이 바뀔 때만, 기기 값은 가장 활동적인 값, 닫히면 `offline` |
| CT-45 | 데몬이 1012로 닫음, 모르는 닫는 코드 | 백오프 재접속 |
| CT-46 | `reaction.record`의 `comparison`이 `kind: "neither"`(두 자극) | 반응 하나가 `applied`로 기록되고 `comparison`이 `neither`로 남는다. 두 자극에 strength -1 반응을 나눠 보내지 않는다(판정 J-184) |
| CT-47 | `dial.set` `planAuthoring`: 값 `"auto"`, 또는 층 `instruction` | 3001 `invalid.schema`. 층 user·concern의 `computed`·`hybrid`·`model`은 `applied`(판정 J-188) |
| CT-48 | `settings.update` `notifications.resultReview: "weekly"`, `resultReviewDigestAt: "7pm"` | 3001 `invalid.schema`. 유효한 값은 `applied`이고 `setting.changed`가 한 번 남는다(판정 J-189) |
| CT-49 | 휴대폰 `result.accept{accept}`, 결과의 `mobileReviewable: false` | `1010`(`required: "decide"`, `field: "decision"`). 데스크톱은 같은 명령을 받는다(판정 J-139·J-174) |
| CT-50 | 합의가 기대는 Goal이 `retired`인 상태에서 쓰기 명령 | 3001 `policy.goal_not_active`(판정 J-130, 22 AX-01(b)) |

가짜 데몬(`@helm/protocol/testing`)의 조작 목록(20 §3.13.3의 요구): 이벤트 주입, 위치 건너뛰기(구간 계약 위반 주입), `storeId`·`bootEpoch` 바꾸기, `view.get` 지연과 `2006`, 연결 끊기(지정한 메시지 직후), tick 멈추기, HTTP 401·403·429 응답과 `/m/whoami` 응답, `hello` 오류(`1003`·`1004`·`1005`·`1008`), `5001`·`5003` 응답, 명령에 `3004`·`3008`(가정 확정 포함)·`3009` 거부, 같은 멱등 키에 처음 결과 돌려주기, close `1001`·`1012`·`4008`·`4009` 보내기, `server.modeChanged` 보내기, 휘발 조각 버리기(`n` 건너뛰기), 시험용 브라우저 전송의 `helm-bearer.` 하위 프로토콜(가짜 데몬만 받는다). 실제 데몬은 이 조작을 갖지 않는다(시험 빌드 전용).

v0.2 실행 후보의 핸드셰이크 불변 항목(canon-2 §9.8)도 이 스위트에 넣는다: `adapter-cannot-append-events`(클라이언트 메서드에 이벤트 append가 없다, 등록 표 검사), `projection-is-derived`(명령 이름이 `projection.`으로 시작하지 않는다), `expected-cursor-required`(결정 명령에 `basisSeq` 필수), `guided-human-gates`(사람 확정 명령은 `human_client` 채널로만 간다).

### 6.4 성능 기준 (01 NFR)

22 PF-02~04(`just perf`)로 실행하고 서버 안 측정으로 확인한다.

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
| Q-02 | 기기 서명 증명(nonce 서명) 사용 | 1차부터 필수 / 필드만 두고 꺼 둠 | 꺼 둠(`proofRequired: false`). 휴대폰 PWA도 1차에 쓰지 않는다(26 MQ-05). 18이 위협 모델에서 필요하다고 정하면 켠다 |
| Q-03 | 화면 투영 동기화 | 무효화 + 다시 받기 / 스냅샷 + 패치 | 무효화(P-07). 다시 받기가 초당 20번을 넘거나 NFR-P-2를 못 맞추는 화면이 생기면 그 뷰만 패치를 검토한다 |
| Q-04 | 멱등 결과 보관 기간 | 해결: 09가 행을 지우지 않고 365일 뒤 결과를 줄인다(§3.9.2) | - |
| Q-05 | `maxReplayEvents` | 10,000 / 50,000 / 제한 없음 | 50,000. NFR-P-4 측정으로 다시 정한다 |
| Q-06 | presence 기록 | 해결: 판정 J-46·J-119. 기기 보고는 휘발 입력, 기기 값이 바뀔 때만 `presence.changed`(§3.7.8) | - |
| Q-07 | 토큰 교체 | 해결: HTTP `POST /devices/self/rotate`(18 §3.8.3) | - |
| Q-08 | 하위 Concern 필터 판정 시점 | 현재 트리 / 이벤트 당시 트리 | 현재 트리(F-28). 이벤트 당시 판정이 필요하면 09가 이벤트에 조상 경로를 저장해야 한다 |
| Q-09 | 이미지 판 생성 | 데몬이 업로드·생성 때 / 요청 때 | 업로드·생성 때 한 번. 라이브러리는 17·12 |
| Q-10 | 데스크톱 기본 이벤트 구독의 payload | `full` / `none` | `full`(타임라인 캐시에 쓴다). 데이터 양이 문제가 되면 `none` + `events.read` |
| Q-11 | TUI의 인증 | `localAdmin` / 기기 토큰 | `localAdmin`(`interactive: "tui"`, 토큰을 WSL 디스크에 두지 않는다). 13·18의 격리가 전제 |
| Q-12 | 직전 버전 지원 기간 | 한 버전 / 기간 | 한 버전(N-1). 1인 사용이라 앱과 데몬을 같은 날 갱신하는 일이 많다 |
| Q-13 | `composer.preview`를 동기 조회로 둘지 | 동기(최대 30초) / `accepted` + 뷰 | 동기. 모델 호출이 길어지면 `accepted` + `semanticPreview` 뷰로 바꾼다 |
| Q-14 | 낡음 검사를 어디서 하나 | 해결: 커널 decide 안(판정 J-79) | - |
| Q-15 | 페어링 코드 실패 사유를 사람에게 구분해 보일지 | 해결: 구분 안 함(판정 J-81, 18 §3.7.4) | - |
| Q-16 | 브라우저 전송의 토큰 전달 | 해결: 휴대폰은 `__Host-helm_dt` 쿠키(결정 47, 판정 J-118). `helm-bearer.`는 정식 데몬이 받지 않는다(18 §3.4.4) | - |
| Q-17 | 모바일 기본 이벤트 구독 | 해결: 머리 정보만(`payload: "none"`, 26 §3.3.5) | - |
| Q-18 | 외부 푸시 제공자 사용 | 해결: Web Push(결정 47), payload는 종단 암호화되고 형식은 26 §3.4.4. 휴대폰 푸시 범위는 `interrupt`·`notice`(결정 48) | - |
| Q-19 | 기기 로컬 초안을 다른 기기에 알릴지(V5-072) | 알리지 않음 / `presence.report`에 보내지 않은 초안 수를 싣고 다른 기기 질문 카드에 "다른 기기에 쓰던 답이 있음" | 1차는 알리지 않는다. 사용 중 같은 질문을 두 기기에서 쓰다 충돌하는 일이 보이면 두 번째 안을 2단계에 넣는다 |
| Q-20 | 가린 blob의 표시 해시 | SHA-256 유지(남는 위험으로 기록) / HMAC 표시 해시 | 1차는 유지하고 가린 blob에 `ETag`를 보내지 않는다(§3.11.1). 09·18이 정한다 |

## 8. 출처

- 브리프: `docs/design/process/00-design-brief.md` 결정 10, 12, 14, 18, 19, 21, 22, 24, 26, 29, 31~33, 36~39, 41~49, 53, 56, 57, §2.5, §3.1~§3.5, §5(§5.2 표시 규칙).
- 조정자 판정: `docs/design/process/rulings-stage2a.md` §1(이름 정본, 거부 갈래), §2(`@helm/client`, 리스너 포트, `/healthz`), J-02, J-03, J-04, J-10, J-20, J-24, J-30, J-35, J-36, J-46, J-47, J-49, J-52, J-53, J-61, J-62, J-71, J-75, J-78, J-79, J-81, J-82, J-84, J-107, J-110, J-111, J-115, J-116, J-118~J-120, J-123, J-124, J-126, J-129, J-130, J-135~J-137, J-139, J-144, J-147, J-148, J-153, J-154, J-164~J-166, J-171, J-174, J-178, J-184, J-188, J-189, J-150.
- 4단계에서 맞춘 문서: 06 §3.4.6(`EngineInput`, `SubmitResult`), 08 §3.2·§3.3.2·§3.4.1·§3.10.2·§3.11.1·§3.12·§3.17.4·§3.18, 09 §3.7·§3.9.1·§3.11.5·§3.15.3, 10 §3.3·§3.4.4·§3.11, 11 §3.2.3·§3.18, 12 §3.2.2·§3.5.8·§3.12.4, 14 오류 코드 표, 15 §3.6.4·§5, 17 §3.4.1·§3.11.1, 18 §3.4·§3.5·§3.6, 26 §3.3~§3.4·§5.2, 22 §5.2, 23 §5.2, 07 §3.11.8; 검증 1차 결과(`docs/design/process/verification/round-1/`).
- 2a단계에서 맞춘 문서: 08 §3.2·§3.4.2·§3.4.7·§3.13·§3.15(ObjectionTarget); 09 §3.2, §3.4.9·§3.4.13·§3.4.15, §3.5, §3.9, §3.11.5, §3.12, §3.14.2, §3.16, §5; 10 §3.3, §3.4, §3.11, §3.13.3; 11 §3.5.3·§3.5.6, §3.8.1, §3.18; 12 §3.2, §3.5.8, §3.6.2, §5.2; 15 §3.6.4, §5.2; 16 §5.2; 17 §3.4.1, §3.11.1, §3.15, §5.2; 18 §3.4~§3.8, §3.14, §5.2; 20 §3.8.5~§3.8.8, §3.9.4~§3.9.7, §3.13.3, §5.2; 21 §3.7.3, §5.2; 04 §3.24, §5.2; 05 §5.2.
- 원천 정리: `pi-api-facts-2.md` §0, §1.1, §3(pi-protocol), §4(pi-server), §5(pi-client), §6(Helm 비교), §7(chord), §8(pi-env), §13; `conversation-extracts-4.md` §4.8, §13.4, §15, §20(20-9~20-11), §21(c21, d24); `helm-canon.md` §19 체크리스트(C8, cursor, Client 소유 범위, 이름 규칙, 막힘 상태 데이터); `helm-canon-2.md` §1.15, §8.4~§8.7, §9.1, §9.3, §9.6, §9.8, §9.9, §11/19 체크리스트, L9·L14·L19; `helm-canon-3.md` §6.10, §10/19 체크리스트; `pi-cases-notes.md` §1, §3.3, §6.3, §11.1~§11.3, §12, §13.4, §14.
- 사례 메모: `.helm-design-work/S4/openclaw-gateway.md` §1~§4, `paseo.md` §3·§4·§8, `pi-web.md` §3·§9, `openclaw.md`; happy-agent 이벤트 재전송 보조 조사(2026-10-11, `~/projects/_ref/happy-agent` `ApiModule.ts:4438-4530`, `ApiEventJournal.ts`, `updates.ts`, `sseWriter.ts`, `EventsModule.ts`, `API.md`).
- 원문: `~/projects/_ref/pi-src/packages/env/docs/protocol.md`(Sync, Frames, Scheduling, Liveness) [원문]; `man ssh`(OpenSSH 9.6p1)의 `-W host:port`, `-L … remote_socket` [원문].
- v0.3: `docs/v0.3/audit/backend-oss-research.md` §1.2, §3, §4, §5; `docs/v0.3/audit/mastra-review.md` §5, §6; `docs/v0.3/09-client-opdc.md` §4~§6; `docs/v0.3/12-implementation-architecture.md` §9, §11.2, §12.
- 다른 설계 문서(1단계 초안): 01 §NFR·FX-16; 03 §3.2.3~§3.6, §5.2; 04 §3.0.2~§3.0.6, 화면별 "표시 데이터"·"명령 의도", §4, §5.2의 10 행; 06 §3.3.1, §3.6; 10 §3.3, §3.4; 12 §3.4.4, §3.15, F-4; 14 §2.2 D7·D8; 16 §3.2.3, §5.2; 17 §1.4, §3.4.1, §3.5, §3.11, §3.15, §5.2; 20 §2.3, §2.4, §3.2, §3.4; 21 UI-D01~D03, E11, E16, §5.2.
- [지식] 표시 항목: JSON-RPC 2.0 명세의 예약 코드 범위, RFC 6455(마스킹, 닫는 코드 범위), RFC 6902(JSON Patch, 기각한 대안), tus 1.0 헤더 이름, LSP `$/cancelRequest` 관례, Node `ws`의 `ws+unix:` 주소, mirrored 네트워킹의 루프백 공유, OpenSSH `AllowTcpForwarding` 기본값, 브라우저 WebSocket이 업그레이드 HTTP 상태를 알리지 않는 것, `__Host-` 쿠키 접두사, 같은 출처 GET의 `Origin` 생략과 `Sec-Fetch-Site`, `fetch` keepalive, `navigator.locks`.

## ADR 후보

### 19-A1. SSH 경로는 `ssh -W`로 데몬의 별도 loopback TCP 리스너에 붙고, 그 위에 WSS 경로와 같은 HTTP + WebSocket을 쓴다

- 상태: 제안(20 APP-D03, 17 D17-09와 합의된 상태. 18 ADR 후보 18-A2가 보안 조건을 정리)
- 맥락: 결정 38은 데스크톱 앱의 SSH 접속과 두 경로의 메시지·재전송 의미 동일성을 요구한다. `ssh -W`는 Unix 소켓을 가리킬 수 없다. Tailscale serve 대상 포트는 신원 헤더를 요구한다.
- 결정: `127.0.0.1:7841`(`loopback`, 기기 토큰만 받음)을 따로 두고, 클라이언트는 `ssh -W 127.0.0.1:7841`의 표준 입출력 위에서 HTTP 업그레이드와 WebSocket을 그대로 쓴다. 별도 프레임 형식을 정의하지 않는다.
- 근거: HTTP 서버 코드·프레이밍·파일 전송이 경로와 무관하게 같다. 원격 명령을 실행하지 않아 셸 시작 파일 잡음이 섞이지 않는다. 클라이언트 쪽에 열린 포트가 없다. 데몬 쪽 추가는 리스너 하나다.
- 기각한 대안: (1) serve 포트로 `-W`(헤더 없는 연결을 받는 예외가 생김). (2) `-L`로 클라이언트 루프백 포트를 데몬 Unix 소켓에 포워딩(클라이언트 쪽 열린 포트, 프로세스 수명 관리, Unix 소켓에서 `localAdmin`과 구별 필요). (3) exec 채널 stdio + 길이 접두 프레임(pi-env식. 코덱·브리지·파일 전송 대체 경로가 필요). (4) `helm bridge` exec + 동기화 줄(예비 경로로만 남김).
- 결과: 리스너가 셋이 된다. `loopback`은 같은 호스트의 다른 프로세스도 열 수 있으므로 기기 토큰과 인증 전 제한이 보안 경계가 된다. 동등성은 적합성 스위트를 리스너별로 돌려 확인한다.

### 19-A2. 기기 토큰은 업그레이드 요청(헤더 또는 모바일 쿠키)으로 보내고 `hello`에서 판정한다

- 상태: 제안(최종은 18). 모바일 쿠키는 결정 47과 판정 J-118
- 맥락: 20은 토큰을 웹뷰 밖(Rust)에 두려 한다. 휴대폰은 데몬이 서빙하는 PWA다(결정 47). 사례로는 "hello 안에서 인증, 실패하면 거절 응답"(Paseo)과 서명 챌린지(OpenClaw)가 있다.
- 결정: 데스크톱·TUI는 `Authorization: Bearer <토큰>`, 휴대폰 PWA는 `__Host-helm_dt` HttpOnly 쿠키(`tailnet`만, Origin 정확 일치, 기기별 운반 방식 고정)를 업그레이드 요청에 싣고, 데몬은 챌린지 뒤 `hello`를 받을 때 토큰·기기 ID·(선택) 서명 증명을 함께 판정해 결과를 `hello` 응답이나 오류로 돌려준다. SSH 키와 Tailscale 신원은 전송 계층 조건이다. `localAdmin`은 Unix 소켓에서만 받는다.
- 근거: 토큰이 JSON 메시지에 실리지 않으므로 웹뷰 메모리를 거치지 않는다. 판정이 한 곳(`hello`)에 모여 오류 형식이 하나다. 서명 증명을 나중에 켜도 메시지 형식이 바뀌지 않는다.
- 기각한 대안: 업그레이드 단계에서 401로만 판정(오류 kind를 줄 수 없음, 챌린지 서명과 맞지 않음), `hello` params에 토큰(웹뷰 메모리에 토큰), 브라우저의 `helm-bearer.` 하위 프로토콜(토큰이 스크립트 메모리에 있어야 하고 프록시 로그에 남을 수 있음, 18 §3.4.4), SSH 키만으로 인증(기기별 폐기·감사 불가, `loopback`은 다른 프로세스도 열 수 있음).
- 결과: Rust 전송이 헤더를 붙이고, 브라우저 전송은 자격을 다루지 않는다. 쿠키 경로는 CSRF 대책(Origin 정확 일치, `SameSite=Strict`)과 `/files/*` 격리 헤더가 필요하다. 브라우저는 업그레이드 실패 원인을 보지 못하므로 `/m/whoami`로 판정한다.

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
- 결정: 뷰 응답에 `asOfSeq`·`dependsOn`, 영속 이벤트에 `invalidates`(커밋 때 투영기가 subject·refs·바뀐 투영 행·scope와 12의 `aggregateTags`로 계산해 09 `event_invalidations`에 저장한 값)를 싣는다. 클라이언트는 교집합으로 낡음을 판단하고 `minSeq`를 붙여 다시 받는다.
- 근거: 앱에 이벤트 → 화면 대응표가 필요 없다. 무효화가 이벤트 스트림 안에 있어 재전송으로 함께 복원된다. 서버가 연결별 뷰 상태와 차이를 들고 있지 않아도 된다.
- 기각한 대안: 스냅샷 + JSON Patch(서버의 연결별 상태, 패치 순서 오류 시 재동기화 경로가 하나 더 필요), Chord delta(안정 계약이 아님), 클라이언트 쪽 리듀서(도메인 로직이 앱에 들어감), 무효화만 보내는 SSE(재전송 없음).
- 결과: 12가 `aggregateTags`와 뷰의 `dependsOn`을 정확히 계산해야 한다(속성 테스트 VIEW-01). 09가 태그 테이블을 둔다(체인 밖, 재구성 때 다시 만듦). 갱신이 잦은 화면(대화)은 휘발 스트림으로 보완한다.

### 19-A5. 휘발 스트림은 seq 없는 별도 알림으로 보낸다

- 상태: 제안
- 결정: `stream.chunk`에 실행별 `n`과 텍스트 `offset`을 붙이고, 유실 시 `run.partial`로 맞춘다. 최종 내용은 영속 이벤트로 온다.
- 근거: 토큰 단위 영속 쓰기의 비용(happy-agent `LEARNINGS.md`), 재전송 범위 낭비를 피한다. offset은 중복·겹침에 안전하다.
- 기각한 대안: 델타를 영속 이벤트로 기록, 델타를 seq 공간에 섞기(happy-agent API 저널).
- 결과: 느린 소비자에서 먼저 버릴 수 있는 메시지가 생긴다.

### 19-A6. 명령은 domain action별 메서드, 멱등 키와 `basisSeq` 필수

- 상태: 제안
- 결정: 04의 명령 의도 이름을 메서드로 쓰고, 모든 명령에 `idempotencyKey`(`ik_<ULID>`)와 `basisSeq`를 요구한다. 커널이 `basisSeq`와 대상 레코드의 `revisionSeq`를 비교한다(09 §3.9.4, 판정 J-79). params·result는 TypeBox 상수로 정의하고 10 payload로의 변환을 메서드마다 적는다(§3.7.9).
- 근거: canon-3 §6.10.1(generic `execute` 금지), canon-2 L14(cursor에 묶인 Gate), 09 §3.9.4, NFR-D-4.
- 기각한 대안: generic `command.submit`, 클라이언트가 revision을 직접 보내는 방식만(모든 뷰가 revision을 정확히 실어야 함), 전역 expectedCursor(무관한 이벤트로 충돌).
- 결과: 08이 `revisionSeq`, 10이 `subjects()`와 `CommandEnvelope.basisSeq`를 제공해야 한다. 10 대응표가 바뀌면 등록 표의 `kernelCommand`와 변환 표를 함께 고친다(`check-registry`).

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
