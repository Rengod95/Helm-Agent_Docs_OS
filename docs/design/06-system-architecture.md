# 06. 시스템 아키텍처

- 작성: P3 아키텍트, 2026-10-11 (1단계 초안), 2026-10-12 (2a단계 통합, 4단계 보완)
- 상태: 설계 초안 3판. 기준은 브리프 결정 1~57과 `process/rulings-stage2a.md`(이하 "판정") J-01~J-190이다. 모바일 클라이언트는 결정 42·47에 따라 데몬이 서빙하는 PWA이고 세부는 26이 정한다.
- 함께 읽을 문서: `process/00-design-brief.md`(이하 "브리프"), [24 ADR](24-adr.md)
- 표시 규칙: 브리프 §5.2(판정 J-144). `[결정 n]`은 사용자가 정한 브리프 결정이다. 조정자 기본값은 `[제안: 결정 n 기본값]`, 조정자 판정은 `[판정 n]`(판정 44~46) 또는 `[판정 J-nn]`으로 적는다. `[제안]`은 이 문서가 정한 것이고, 바꾸려면 [24](24-adr.md)의 해당 ADR을 고친다. 외부 사실은 `[원문]`(소스·문서 직접 확인), `[실험]`(이번에 명령을 실행해 확인), `[검색]`, `[지식]`(재확인 안 함)으로 표시한다.
- 출처 줄임말: `extracts-N`은 `process/sources/conversation-extracts-N.md`, `canon`·`canon-2`·`canon-3`은 `process/sources/helm-canon*.md`, `pi-facts-1`·`pi-facts-2`는 `process/sources/pi-api-facts-*.md`, `S4/<사례>`는 `.helm-design-work/S4/<사례>.md`, `pi-src/`는 `~/projects/_ref/pi-src`의 태그 `v1.1.0`(커밋 `abe508e1`, 판정 44). 이 문서가 인용한 pi 행 번호(`types.ts:264·271·326·341·490`, `ai/package.json:79`, `package.json:65`, `agent/package.json:43-45`)는 1단계에서 `cdaf6c2`로 적었고 2a단계에 `git show v1.1.0:<경로>`로 다시 보아 같은 행임을 확인했다 [실험], `homelab/`은 `~/projects/homelab`이다. 대화 원문 행은 `대화 L<n>`(`docs/handoff/conversation-transcript-until-158.md`)으로 적는다.

## 1. 목적과 범위

### 1.1 이 문서가 정하는 것

구현자가 이 문서만 보고 저장소 골격, 패키지 경계, 프로세스 배치, 설정·로그 체계를 만들 수 있게 하는 것이 목적이다.

1. 시스템 맥락: Helm 바깥의 사람, 기기, 서비스와 그 사이의 연결 (§3.1)
2. 레이어와 의존 방향, 패키지 경계, 패키지별 책임·공개 API 개요·금지 의존 (§3.2~§3.4)
3. 의존 규칙의 기계적 강제 방법 (§3.5)
4. 프로세스 배치(토폴로지 A/B/C 결정)와 프로세스 사이 통신 (§3.6~§3.7)
5. 접속 경로 두 가지(Tailscale serve WSS, SSH)의 전체 그림 (§3.8)
6. 저장 경계: 무엇이 SQLite 정본이고, 무엇이 설정 파일이고, 무엇이 비밀인가 (§3.9)
7. 설정 파일의 위치, 스키마, 우선순위, 핫 리로드 (§3.10)
8. 로깅과 관측: 구조화 로그, journald, 진단 명령 (§3.11)
9. 기술 스택 확정 (§3.12)
10. 벤더 중립 원칙과 런타임 어댑터의 위치 (§3.13)
11. 기획 선행 작업 7항목 중 구조 쪽 결론 (§3.14)
12. 저장소 디렉터리 구조, justfile 레시피 목록, `.env.example` 키 원칙 (§3.15~§3.17)
13. 외부 탐색 도구의 프로세스 배치와 의존 목록: 웹 변환 작업자, `helm-browserd`, `helm-netshim` (§3.6.7, §3.12.5)

### 1.2 다루지 않는 것

| 주제 | 소유 문서 |
|---|---|
| pi 패키지별 가져오기·포크·고정 의존 방식, `vendor/` 내부 구조, 라이선스 고지 | 07 |
| 레코드·이벤트 타입, ID 접두사, SQLite DDL, 해시 체인, 투영 테이블, 마이그레이션 내용 | 08, 09 |
| 명령·제안 카탈로그, 검증 규칙, 거부 분류, 공리 대응 | 10, 11 |
| 에이전트 루프, 모델 계층, 컨텍스트 투영 생성, 컴팩션, 크래시 복구 알고리즘, 스케줄러 | 12 |
| 도구 목록, 범위 검사, 격리(샌드박스), 런타임 어댑터 인터페이스의 세부 | 13 |
| 웹 읽기·검색 제공자, 브라우저와 컴퓨터 사용 도구의 입력·결과 계약, 외부 효과 판정(권리 게이트 `send`) | 13(계약), 18(규칙) |
| 관찰 에이전트의 마이닝·제안 로직 | 16 |
| systemd 유닛 내용, keepalive, 업그레이드 절차, 백업 일정 | 17 |
| 위협 모델, 기기 토큰·페어링, Tailscale 신원 확인, 비밀 저장의 세부 | 18 |
| JSON-RPC 메서드·이벤트·오류 코드 목록, 재전송 규칙, 파일 전송, SSH 경로의 프레임 형식 | 19 |
| Tauri 앱 구조, 클라이언트 저장소, 키체인, macOS·Windows 빌드 경로 | 20 |
| 테스트 계층 세부, 구현 순서와 마일스톤 | 22, 23 |

이 문서는 위 문서들이 지켜야 할 구조 제약(경계, 의존 방향, 프로세스, 저장 위치)을 정하고, 세부는 파일 이름과 절 번호로 참조한다.

## 2. 전제와 결정

### 2.1 이 문서가 기대는 결정

결정 1~25, 38~43, 47~57은 사용자 결정이다. 26~37은 조정자 기본값(35는 2026-10-11 사용자 확인, 33은 결정 39로 사용자 확인)이고, 44~46은 조정자 판정이다(판정 J-144). 아래 표의 번호 열은 브리프 번호다.

| 결정 | 내용 | 이 문서에서 쓰는 곳 |
|---|---|---|
| 14 | 모델은 제안하고, 커널이 상태를 바꾼다 | §3.2 레이어, §3.4 `kernel`·`engine` 경계 |
| 17 | 불변조건 1~7은 어떤 모드·다이얼에서도 바뀌지 않는다 | §3.2 (투영은 정본을 쓰지 않는다 → 패키지 의존으로 강제) |
| 19, 33, 39 | 데스크톱 앱 먼저, 이후 SSH로 쓰는 pi-tui 기반 Helm TUI | §3.6, §3.8, §3.14 |
| 20, 21, 22 | 개인 WSL2 서버에서 실행, 외부 접속, 클라이언트 없이 작업 계속(데몬 상주) | §3.6 |
| 23, 27, 28 | 자체 런타임. pi-ai는 얇은 인터페이스 뒤에, pi-agent-core는 포크해 루프로 | §3.4 `ai`·`agent`·`tools` |
| 24 | 혼자 쓰는 앱. 데스크톱 앱은 macOS·Windows | §3.1, §3.6 |
| 26 | Windows 호스트의 `tailscale serve`, 데몬은 WSL 안 127.0.0.1에만 바인딩, Tailscale 신원 헤더 + 기기별 bearer 토큰, Funnel 미사용 | §3.7, §3.8 |
| 29, 30 | 기준 원본은 Helm 이벤트 로그(SQLite, WAL, WSL ext4). 실행 의도 → 실행 → 결과 기록과 재시작 시 "중단됨" 정리 | §3.9 |
| 31 | JSON-RPC 2.0 over WebSocket, 단조 증가 시퀀스, `lastSeq` 재전송, 큰 데이터는 HTTP | §3.7 |
| 32 | Tauri v2 + TypeScript + Vite. 앱은 얇은 클라이언트. React 판은 결정 41이 대체 | §3.4 `desktop`의 금지 의존 |
| 34 | 런타임 어댑터 인터페이스를 지금 정의. 1차 구현은 자체 런타임 하나 | §3.13 |
| 35 | 관찰 입력 1단계 = Helm 기록 전체 + 허용한 프로젝트 폴더의 외부 에이전트 세션 로그 | §3.6, §3.9 |
| 36 | TypeScript strict, ESM, Node 22 LTS, pnpm workspace, Vitest, TypeBox, better-sqlite3. 아키텍트가 바꿀 수 있으나 ADR로 남긴다 | §3.12 (Node·TS 판은 판정 44가 대체) |
| 38 | 데스크톱 앱은 Tailscale serve WSS와 SSH 두 방식으로 접속. 두 방식의 메시지와 재전송 의미는 같다 | §3.7, §3.8 |
| 40 | 설계 문서는 `docs/design/` | §3.15 |
| 41 | 데스크톱 앱은 React 19. UI 부품은 직접 만든다. 글래스모피즘 시각 언어 | §3.4.15 `desktop`, §3.12.1 |
| 42 | 휴대폰에서도 질문에 답한다. 데스크톱 MVP 다음 단계. 방식과 알림 경로는 26 | §3.1, §3.4.15, §3.6.3, §3.15 (자리만 둔다) |
| 43 | Caustic 토큰은 복사한다(의존 없음) | §3.12.1 (UI 의존 목록에 Caustic 없음) |
| 44 | Node 24 LTS, TypeScript 6.0. pi 기준은 태그 `v1.1.0`(`abe508e1`) | §3.12 (ADR-06-07·08) |
| 45 | 데몬은 시작 때 `secrets run` 자식 로더로 비밀을 받아 메모리에만 둔다 | §3.9.3 |
| 46 | 루프백 바인딩은 격리 경계가 아니다. 모든 리스너가 자격 증명을 요구하고 도구는 격리한다 | §3.7.4, §3.8 |
| 47 | 모바일 클라이언트는 데몬이 서빙하는 홈 화면 웹 앱(PWA), 알림은 Web Push(VAPID). 결정 19("웹이 아니다")는 데스크톱에 적용 | §3.1, §3.4.15, §3.6.3, §3.8.1, §3.15 |
| 48 | 휴대폰 알림은 `interrupt`와 `notice` 질문까지 | §3.6.3(26에 맡김) |
| 49 | 모바일 최소 판은 iOS 26, Android는 지원·시험 대상 밖 | §3.4.15 |
| 50 | shadcn/ui 소스 복사 후 Helm 코드로 고쳐 쓰기는 "부품 직접 제작"에 포함 | §3.4.15, §3.4.17 |
| 51 | 구현 에이전트는 3단계(메인 오케스트레이터, 하위 조정자, 실작업자) | §6(23이 WBS에 적는다) |
| 55 | MVP 도구에 외부 웹 탐색(`web_fetch`·`web_search`)과 브라우저·해시라인 도구를 넣는다. 막는 것은 내부망 주소뿐이다 | §3.4.9, §3.6.7, §3.7.4, §3.12.5 |
| 57 | Apple 개발자 프로그램은 지금 없다고 본다. 네이티브 iOS 경로는 이후에 검토한다 | §3.4.15 |
| §2.5 | WSL2 Ubuntu 24.04, Tailscale은 Windows 호스트에만, 서비스 포트는 127.0.0.1, 런타임 데이터는 `~/projects` 밖 `/srv/volumes/<서비스>/`, restic 백업, just + systemd, SOPS 비밀, `just verify` = 완료, Mac 빌드는 `run-on mac` | §3.6~§3.17 전반 |

### 2.2 원전에서 가져오는 구조 원칙

원전은 브리프보다 아래에 있다(브리프 머리말). 아래는 브리프와 충돌하지 않아 그대로 쓰는 것이다.

| 원칙 | 원전 위치 | 이 문서의 적용 |
|---|---|---|
| "계층은 배포 단위가 아니라 의미 경계"이고 초기 구현은 하나의 로컬 프로세스여도 된다 | canon §13.2 (F07 §2) | §3.2의 레이어는 패키지 경계로 강제하고, 배포는 데몬 프로세스 하나로 묶는다 |
| `Helm Product = Kernel + Agent Runtime + Experience`, `Kernel ≠ Agent Runtime`. First-party Agent Runtime도 Kernel의 권한 검사를 우회할 수 없다 | canon §16.3, §16.12 D1 | `runtime`은 `engine`의 공개 API로만 상태를 바꾼다(§3.4, §3.5) |
| 소유 경계 4개(Kernel / Runtime Adapter / Client / Agent Runtime). "Client는 domain validation이나 정본 state를 별도로 소유하지 않는다" | canon §16.8 | §3.3의 패키지 대응표, `desktop`·`tui`의 금지 의존 |
| client contract와 agent adapter protocol을 분리하고 각각 독립 acceptance test를 둔다(C8) | canon §16.2 | 클라이언트 계약 = `protocol`(19), 어댑터 계약 = `runtime/adapter`(13). 적합성 테스트를 따로 둔다(§3.13.6) |
| P1~P7 아키텍처 원칙 | canon-2 §1.3 | §2.3에서 채택 여부를 정한다 |
| Northbound(명령·조회) / Southbound(관찰 후보) / Control(정책 결과·중지 요청) 방향 비대칭 | canon-2 §1.4 | §3.7.3 |
| helmd 운영 책임 7개, single writer, embedded mode의 workspace lock | canon-2 §1.5 | §3.6.2 |
| 관측 흐름 4개(도메인 원장, 운영 로그, 실험 측정, 원시 런타임 trace)를 섞지 않는다 | canon-2 §1.22 | §3.11.1 |
| 하나의 `status`로 합치지 않을 상태 기계 4개(에이전트 루프, WorkUnit, 연결, 투영 신선도) | canon-2 §3.16 | §3.4.13 `@helm/client`(19 §3.10 연결 상태 기계)와 20 |
| 기술 비목표 6개 | canon §13.13 | §2.4 |
| 저장 형식 독립성: 상태 의미는 표현 방식(SQLite, JSONL, 런타임 세션)에 따라 바뀌지 않는다 | canon §11.14 | §3.9.5 (JSONL은 내보내기·가져오기 전용) |
| 최소 법칙 10: 특정 agent/runtime/session 없이도 의미 상태를 읽고 내보낼 수 있어야 한다 | canon §16.7 | `helm export`(§3.11.4), `store` 읽기 API |
| 데스크톱 process boundary: 렌더러는 filesystem·shell·credential을 소유하지 않는다, domain action별 최소 API, remote content와 local privilege 분리 | canon-3 §6.10.1 | local core = WSL 데몬, 앱 = 얇은 Tauri 클라이언트(§3.6.1, 20에 요구) |
| 아키텍처 결정 평가 질문 8개 | canon §13.14 | [24](24-adr.md)의 ADR 양식 |

#### 2.2.1 원전 아키텍처 요구 8개의 처리 [제안]

canon §13.1(F07 §1)이 "동시에 만족해야 할 요구"로 든 여덟 항목을 이 설계에서 어디서 지키는지 적는다.

| 원전 요구 | 처리 | 지키는 곳 |
|---|---|---|
| 로컬 프로젝트에서 단독 사용 | 바꿈: 개인 WSL 서버의 상주 데몬 하나와 그에 붙는 클라이언트(결정 20~22). 클라이언트 없이도 작업이 계속된다 | §3.6 |
| 여러 에이전트와 실행기를 교체 가능하게 연결 | 런타임 어댑터 계약과 능력 목록, 적합성 시험 | §3.13, 13 §3.11 |
| 시간 간격과 세션 경계를 넘어 상태 복원 | 정본 이벤트 로그, 재시작 복구, `{storeId, seq}` 재개 | §3.6.6, §3.9, 12 §3.7 |
| 사람의 결정과 에이전트 주장을 구분 | 채널·행위자 고정(사람 결정은 `human_client`만), 로컬 관리자 조건, 도구 격리 | §3.4.6, §3.7.4, 10 ADR-K5 |
| 원본 Event와 근거까지 추적 | 해시 체인 원장, 근거 ID 검사, 실행 기록은 근거 원천 | §3.9.1, 09, 10 |
| 역할과 Concern별로 다른 ContextProjection 생성 | 런타임의 요청마다 투영 생성(커널 순수 함수로 계산) | §3.4.10, 12 §3.4 |
| 팀·조직 수준의 협업과 감사로 확장 | 넣지 않음: 혼자 쓰는 앱(결정 24, §2.4-7). 감사 기록은 1인용으로 남긴다 | 18 |
| Markdown/YAML 기반 사용자 경험과 점진적 호환 | 넣지 않음: 이전 Docs-Agent OS는 `legacy/`로(§2.5), 사람이 읽는 형식은 JSONL 내보내기만 | §2.5, §3.9.5 |

canon §13.12의 보안 MUST 5개는 다음처럼 나눈다: 최소 권한의 WorkUnit 단위 적용과 Action class 분리는 10·13(합의 범위와 원시 행동), Prompt 내용과 실행 권한 분리는 이 문서 §3.7.4와 13(도구 격리, 사람 결정 채널), 민감 근거의 유출 방지는 18(마스킹, 판정 J-147), 감사 Event의 무결성과 Actor 신원은 09(해시 체인·HMAC)와 18(기기 인증)이 맡는다.

### 2.3 원전 원칙 P1~P7 채택 [제안]

canon-2 §1.3의 v0.2 커널 후보 원칙을 브리프 구조에 맞춰 다음과 같이 채택한다.

| 원칙 | 채택 | 이 설계에서의 형태 |
|---|---|---|
| P1 의미 계약이 전송보다 먼저다 | 채택 | 도메인 어휘는 `domain`(08)이 소유한다. JSON-RPC 메서드 이름, pi 이벤트 이름, Claude Code 훅 이름을 도메인 이벤트 이름으로 쓰지 않는다. 런타임 쪽 이벤트는 중립 어휘(§3.13.3)로 바꾼 뒤에만 들어온다 |
| P2 Kernel은 agent를 실행하지 않지만 Helm 제품은 실행한다 | 채택 | `kernel`은 순수 함수만 가진다. 실행은 `runtime`이 맡고 둘은 같은 데몬 프로세스 안에 있다 |
| P3 Adapter는 정본 Event를 직접 append하지 않는다 | 채택, 범위 확대 | 이벤트 append는 `engine`만 한다. `runtime`(1차 런타임 포함), `daemon`, `observer`도 `engine.submit`(또는 프로토콜)을 거친다(§3.5) |
| P4 Capability는 협상하며 결손을 숨기지 않는다 | 채택 | 능력 목록(capability manifest)에 `enforced` / `advisory` / `unavailable`을 적고 화면에 표시한다(§3.13.4) |
| P5 Projection은 read model이다 | 채택 | 투영 생성 코드는 쓰기 API를 import할 수 없다(§3.5) |
| P6 Local-first는 single-user-only를 뜻하지 않는다(여러 프로세스가 동시에 쓴다) | 수정 채택 | 1인용이지만 클라이언트·관찰 에이전트·외부 어댑터가 동시에 붙는다. 쓰기는 데몬 하나로 직렬화하고, 명령마다 멱등 키를 두고, 낡음 검사는 대상 레코드의 `revisionSeq`와 사람이 본 화면의 `basisSeq`로 하고 전역 cursor는 쓰지 않는다(09 D09-4, 10 V-VER-01) |
| P7 의미 품질을 LLM validator 하나에 맡기지 않는다 | 채택 | 구조 검증은 `kernel`, 의미 평가는 측정(16)으로 나눈다 |

### 2.4 기술 비목표

canon §13.13의 여섯 항목을 이 설계에서도 비목표로 둔다.

1. 분산 이벤트 소싱 플랫폼. 데몬 하나, SQLite 파일 하나로 시작한다.
2. 모든 문서를 지식 그래프로 자동 변환하는 일.
3. 범용 프로젝트 관리 데이터 모델.
4. 특정 모델 제공자나 런타임의 세션 구조(pi 세션 트리, pi-durable 문서, Claude Code transcript)를 도메인 모델로 채택하는 일.
5. 의미 판단을 모두 LLM 분류에 맡기는 일.
6. 모든 상태가 실시간 동기화되어야만 동작하는 설계. 클라이언트가 끊겨도 데몬은 계속하고, 클라이언트는 다시 붙어 `lastSeq`부터 받는다.

이 밖에 이 문서가 더하는 비목표 [제안]:

7. 여러 사용자, 여러 테넌트, 조직 정책(결정 24).
8. 데스크톱용 웹 클라이언트(결정 19). 데몬은 데스크톱 SPA를 서빙하지 않는다. 예외는 모바일 PWA 하나다: 데몬이 `tailnet` 리스너의 `/m/`에서 릴리스에 든 모바일 묶음을 서빙한다(결정 47, 26 §3.3.2). 개발 중 브라우저 미리보기는 개발 도구로만 둔다(§3.16).
9. Helm 상태를 프로젝트 폴더(`~/projects/<제품>/...`) 안에 쓰는 일. 이전 구현의 `.helm/` 폴더 방식은 쓰지 않는다(§3.9.1).
10. oh-my-pi를 의존성으로도 vendor로도 쓰는 일. 해시라인 편집과 grep 확장은 oh-my-pi의 설계만 참고해 Helm 코드로 짠다([판정 J-190] (1), 07 D07-12).
11. Stagehand를 핵심 브라우저 경로로 쓰는 일. Stagehand의 `act`·`extract`는 자체 LLM 호출 층을 가져서 비용, 비밀, 기록 경계가 Helm과 겹친다. Helm 모델 어댑터를 거치게 할 수 있을 때만 선택 확장으로 본다([결정 55], [판정 J-190] (1)).
12. Windows 호스트의 데스크톱 조작. 컴퓨터 사용 도구는 WSL 안에서 실행마다 새로 띄운 Xvfb 화면만 다룬다([결정 55], [판정 J-190] (1)).
13. 런타임 공통 개인 하네스(스킬, AGENTS.md, 훅 정책)의 동기화. 별도 도구(agent-kit)가 맡는다([결정 54]).

### 2.5 이전 구현과 기존 저장소 내용의 처리 [제안]

저장소 루트에는 이전 구현(`@helmdocs/*`, experimental.v0)이 있다 [원문 `package.json`, `packages/`, `apps/helm-web`]. canon-2 §8.7은 재사용 가능한 조각을 정리했다.

| 대상 | 처리 | 이유 |
|---|---|---|
| `packages/helm-core`, `helm-cli`, `helm-sdk`, `helm-server`, `apps/helm-web` | `legacy/experimental-v0/` 아래로 `git mv`하고 워크스페이스에서 뺀다 | 새 패키지 이름(`@helm/*`)과 디렉터리가 겹친다. 이력은 보존한다. Git 어댑터(`git-adapter.mjs`)와 서버 보안 헤더 같은 재사용 후보는 새 코드에서 다시 쓸 때 참조한다(canon-2 §8.7) |
| `packages/agent-docs-init` | `legacy/agent-docs-init/`로 옮긴다 | Docs-Agent OS는 Helm 범위 밖이다(canon §20.3 #28, 01 §2.2) |
| `experiments/*` | 그대로 두되 워크스페이스에서 뺀다 | 스파이크와 pi-lab은 참고 자료다. `experiments/pi-lab`은 자체 `node_modules`를 가진다(pi-facts-2 §11) |
| 루트 `package.json`(npm workspaces) | pnpm 워크스페이스 설정으로 바꾼다(§3.15) | 결정 36 |
| `.github/workflows/ci.yml`(agent-docs-init 테스트) | 지우고 새 CI 여부는 23 D23-7에서 정한다 | 대상 패키지가 범위 밖이다. Mac 작업본은 `.helm-design-work/mac-modified/`에 있다 |
| `README*.md` 3종 | 새 README 하나로 바꾸는 일은 구현 단계에서 한다 | Docs-Agent OS 설명이 주 내용이다 |

### 2.6 원천 체크리스트 반영표

0단계 원천 정리의 체크리스트·끝 목록에서 06·24에 배정되었거나 06과 관련된 항목과 그 처리다.

| 원천 항목 | 처리 | 위치 |
|---|---|---|
| canon §21 06: 아키텍처 요구 8개, 논리 계층 7개 | 논리 계층은 §3.2.2에 대응. 요구 8개 중 "로컬 단독 사용"은 결정 20~22로 WSL 데몬이 됐고, "팀·조직 확장"은 비목표(§2.4-7), "Markdown/YAML 경험과의 호환"은 Docs-Agent OS를 legacy로 두고(§2.5) JSONL 내보내기로만 남긴다(§3.9.5). 나머지(여러 실행기 교체, 세션 경계 넘는 복원, 사람 결정과 에이전트 주장 구분, 원본 이벤트 추적, 역할별 투영)는 §3.13, §3.6.6, 08, 09, 12가 맡는다 | §3.2.2 |
| canon §21 06: `Helm Product = Kernel + Agent Runtime + Experience`, 소유 경계 표 | 반영 | §2.2, §3.2.3 |
| canon §21 06: Client는 정본을 소유하지 않음, First-party Runtime도 커널 우회 불가 | 반영. R12, R13으로 강제 | §3.4.15, §3.5 |
| canon §21 06: C8 client contract와 adapter protocol 분리, 각각 acceptance test | 반영 | §3.13.6 |
| canon §21 06: 평가 질문 8개를 ADR 양식에 | 반영 | 24 §2.3 |
| canon §21 06: 기술 비목표 6, 저장 형식 독립, 최소 법칙 10 | 반영 | §2.4, §3.9.5 |
| canon §21 06: 보안 MUST 5를 18과 나눔 | MUST 1(WorkUnit 단위 최소 권한) → 13·18. MUST 2(외부 부작용은 별도 행동 종류) → 원시 행동 `send`(결정 4), 13. MUST 3(프롬프트 내용과 실행 권한 분리) → 구조로는 §3.7.4(도구가 사람 권한을 얻지 못함), 세부 18. MUST 4(민감 근거가 투영으로 새지 않음) → 12·18. MUST 5(감사 이벤트 무결성, 행위자 신원) → 09 해시 체인, 18 | §3.7.4 |
| canon §21 24: D1~D3, C1~C8을 이전 결정으로 | 반영 | 24 §4 |
| canon §21 24: 원전을 바꾼 브리프 결정(#1~#7, #9, #11) 각각 ADR | 반영. #1 ADR-00-19, #2 ADR-00-20·22, #3 ADR-00-23, #4 ADR-00-29, #5 ADR-00-24, #6 ADR-00-05, #7 ADR-00-03, #9 ADR-00-02, #11 ADR-00-18 | 24 §5 |
| canon §21 24: 원전 내부 불일치 해소(상태 기계 판본, 완료 정의) | 08 소유. 예정 ADR로 둠 | 24 §7 |
| canon-2 §11 06: P1~P7 채택 여부 | 반영 | §2.3 |
| canon-2 §11 06: Northbound/Southbound/Control | 반영 | §3.7.3 |
| canon-2 §11 06: helmd 책임 7개, embedded mode 잠금, single writer | 반영. embedded mode는 CLI 오프라인 명령이 같은 잠금을 잡는 것으로 대응 | §3.6.2, §3.9.2-5 |
| canon-2 §11 06: 논리 모듈 의존 방향과 브리프 패키지 대응(contracts는 I/O 없음, kernel은 시계·랜덤 주입) | 반영. R4, R5와 `KernelContext` | §3.4, §3.5 |
| canon-2 §11 06: observability 흐름 4개 | 반영 | §3.11.1 |
| canon-2 §11 06: 상태 기계 4개를 하나의 status로 합치지 않기 | 원칙만 받고 클라이언트 쪽 구현은 20에 둔다 | §2.2 |
| canon-2 §11 06: provider neutrality | 제공자 메시지 타입을 커널 엔티티로 쓰지 않음(AP-1, §3.4.7), 토큰·추론 필드는 운영 측정(§3.11.1), 제공자 전환 뒤에도 Goal 등 유지(ADR-00-27). 도구 스키마의 제공자별 조정은 07·12 | §3.13.1 |
| canon-2 §11 06: `@helmdocs/*` 실험 코드 처리와 재사용 목록 | 반영 | §2.5, ADR-06-14 |
| canon-2 §11 24: Level 정의 통일, JSONL export/import 전용 | 반영 | ADR-13-04(ADR-06-10을 대체), ADR-06-06 |
| canon-2 §11 24: qualification + accountable acceptance, 비확장 권한 이어 쓰기, provider에 사람 권한 도구 비노출, 거부 결과 inbox 저장, effect class 선언만 | 각 소유 문서의 결정이라 예정 ADR로 둠 | 24 §7 |
| canon-3 §8 06: desktop process boundary를 브리프 구조로 | 반영. local core = WSL 데몬, 앱 = 얇은 Tauri 클라이언트, 렌더러는 filesystem·shell·credential을 소유하지 않음(20 APP-D02로 기기 토큰도 Rust 쪽) | §2.2, §3.4.15 |
| canon-3 §8 06: 분석 단위(사람 + 에이전트 + 도구 + 산출물 + 정책 + 환경)를 맥락도에 | 반영 | §3.1.1 |
| canon-3 §8 06: 두 종합 문서의 후보 이벤트 어휘로 누락 점검 | 도메인 이벤트 카탈로그(09)의 점검 자료로 넘기고, 런타임 신호 어휘와 섞지 않는다 | §3.13.3 |
| canon-3 §8 24: Web GUI 대신 데스크톱, Electron 대신 Tauri, 가역성 밖, confidence, Attention Queue 개수 | 앞의 셋은 ADR-00-19, ADR-00-32, ADR-00-02. 뒤의 둘은 08·15, 05·11 소유로 예정 ADR | 24 §5, §7 |
| extracts-1 E1-008 중립 이벤트 어휘, E1-009 능력 표와 보장 수준 낮추기, E1-013 `AgentDriver`, E1-016 두 번째 런타임, E1-143 하위 실행 계약, Q14(훅이 버전마다 다른 런타임의 보장 수준) | 반영. E1-016은 AP-8과의 긴장을 시험용 가짜 어댑터로 처리. Q14 세부는 13 | §3.13 |
| extracts-1 E1-054 컨텍스트 슬롯 | `RunSpec.instructions`의 슬롯으로 자리만 두고 내용은 12 | §3.13.5 |
| extracts-2 X2-6-10 3계층 엔진 구조 | 저장소 / 결정적 엔진 / 안쪽 루프 구분은 `store`·`kernel`+`engine` / `runtime`+`agent`로 이어진다. 순차 상태 기계와 루프 상태별 모드는 결정 3·5로 바뀌었다 | §3.2, 24 ADR-00-05 |
| extracts-2 d-9 구현 순서 | 23 소유 | - |
| extracts-3 X3-4-03 pi를 import하지 않는 순수 core | `kernel`의 순수성 규칙으로 반영 | §3.4.4, R5 |
| extracts-3 X3-8-21·22 내부 루프 계약 능력 5개와 보장 수준 낮추기 | 반영 | §3.13.4 |
| extracts-3 Q6 bash로 쓰기 범위 검사 우회 | 구조 쪽은 §3.7.4(도구가 사람 권한·소켓에 접근하지 못함), 범위 검사 자체는 13 | §3.7.4 |
| extracts-3 Q21 사람이 없을 때 도는 감시·관찰의 실행 주체 | 데몬 스케줄러와 관찰 감독기 | §3.6.3 |
| extracts-4 17장 배치 A/B/C | 반영 | §3.6.1, ADR-06-01 |
| extracts-4 18-2 선행 작업 7항목 | 구조 쪽 결론 | §3.14 |
| extracts-4 18-3 ADR 형식 | 형식은 대화에 정해지지 않아 브리프 지시(제목·상태·날짜·맥락·결정·근거·기각한 대안·결과·관련 문서) + 원전 평가 질문 8개로 정함 | 24 §2 |
| extracts-4 d22 외부 어댑터의 데몬 불통 시 동작 | 기본값 fail-closed, 확정은 13·17 | §3.13.5 |
| extracts-4 d23 Claude Code·Codex 연결 시기 | 결정 34 기본값(이후 단계) 유지 | ADR-00-34 |
| extracts-4 d24 SSH 경로가 pi CLI인지 Helm TUI인지 | 결정 39로 해소 | ADR-00-33, ADR-00-39 |
| extracts-4 d28 v0.3 12 §15 나머지 셋 | (2) DB 하나: ADR-06-05. (3) 첫 실제 모델 제공자: 07·12. (4) 사람 결정 대기를 이벤트 방식으로: 구조상 `engine.onCommitted`·`onDirective`가 커밋 이벤트로 런타임을 깨운다. 폴링이 필요 없다. 세부는 12 | §3.4.6 |
| pi-facts-1 §0-5 coding-agent 도구는 경로를 제한하지 않음 | 범위 검사는 13. 06은 격리 요구(§3.7.4) | §3.7.4 |
| pi-facts-1 §0-6 도구 파일이 TUI 렌더러를 import | 07 D07-4(vendor-pi-tools)로 처리 | §3.3.1 |
| pi-facts-1 §0-9 pi-durable은 `node:sqlite` | 드라이버 비교에 반영 | §3.12.3 |
| pi-facts-1 §1, §9 패키지·포크 후보 | 07 소유 | - |
| pi-facts-2 §0-1 소스와 npm 1.1.0의 차이 | 07 D07-1(기준 태그 `v1.1.0`) | - |
| pi-facts-2 §0-2 pi 프로토콜은 재전송이 없음 | Helm이 SQLite seq로 새로 만든다 | ADR-00-31 |
| pi-facts-2 §0-3 인증은 리스너 몫 | 반영 | §3.7.2 |
| pi-facts-2 §0-5 pi-env SSH stdio 프레임 | 비교했으나 B3(`ssh -W`)을 따른다. 19는 예비 경로 B4의 동기화 줄에만 쓴다 | §3.8.3 |
| pi-facts-2 §0-6, §13 Node `>=22.19.0`, TS 5.8 이상, 정확한 버전 고정, `overrides` | 반영 | §3.12 |
| pi-facts-2 §14 미확인(실제 TTY의 pi-tui, chord delta 안정성 등) | TUI·프로토콜 소유 문서의 확인 항목 | - |
| pi-cases-notes §1-1 클라이언트 seq를 메모리에만 둔 사례 8곳 | `lastSeq` 재전송은 SQLite seq로 새로 설계(ADR-00-29, 00-31), 재접속 순서·스냅숏 경계는 19 | §3.7.5 (c) |
| pi-cases-notes §1-2 결과 없는 도구 호출 재실행 금지 | ADR-00-30 맥락, 세부 12 | 24 |
| pi-cases-notes §1-3 pi 의존이 줄어든 흐름(paseo는 ACP → SDK 임베드 → RPC) | ADR-00-23 맥락 | 24 |
| pi-cases-notes §1-4 프로세스 수명 동안 유지하는 SQLite 쓰기 트랜잭션 잠금 | 반영 | §3.6.6 |
| pi-cases-notes §1-5 원격 접속 방식 비교 | ADR-00-26 맥락 | 24 |
| pi-cases-notes §1-6, §13 기존 조사 판정(재시작 후 턴 재개 사례에 happy-agent·openclaw 추가 등) | ADR-00-30 맥락에 반영 | 24 |
| pi-cases-notes §12.1-6 델타는 정본 밖 | 반영 | §3.6.5 |
| pi-cases-notes §12.1-7 인증 모양, §12.2-8 loopback 자동 승인 금지, §12.2-9 serve를 데몬이 소유하지 않음 | 반영 | §3.7.4, §3.8.2 |
| pi-cases-notes §12.2-10 거대 모듈 | 구조로는 패키지 경계와 하위 경로로 나눈다. 파일 크기 상한 같은 규칙은 두지 않는다(필요해지면 AGENTS.md에 한 줄) | §3.3 |
| pi-cases-notes §12.2-11 문서와 코드의 표류 | 의존 규칙의 원본을 `architecture-rules.ts` 하나로 두고 06 표와 같은 커밋에서 고친다. 프로토콜은 19 P-15 | §3.5.2 |

## 3. 명세 본문

### 3.1 시스템 맥락

#### 3.1.1 맥락도

분석 단위는 사람 한 명과 에이전트, 도구, 산출물, 정책, 실행 환경의 묶음이다(canon-3 §4.1 Distributed Cognition의 "system-level cognition"). 아래 그림은 Helm 데몬을 가운데 두고 그 바깥의 요소를 적는다.

```text
                         ┌────────────── 인터넷 ──────────────┐
                         │ 모델 제공자 API (HTTPS)             │
                         └─────────────────▲──────────────────┘
                                           │ ⑥ HTTPS (데몬만 호출, pi-ai 경유)
┌─ 사용자 기기 ──────────────────┐          │
│ MacBook                        │          │
│  ├ Helm 데스크톱 앱 (Tauri) ───┼─①WSS─┐   │
│  └ 터미널: ssh server ─────────┼─②SSH─┼─┐ │
│ 외부 노트북 등 (Tailscale 설치)  │      │ │ │
│ 휴대폰 (모바일 클라이언트, 26)   │      │ │ │
└────────────────────────────────┘      │ │ │
              Tailscale tailnet         │ │ │
┌─ server: Windows 11 호스트 ───────────┼─┼─┼─────────────────────────────────────┐
│ Tailscale (호스트에만 설치)            │ │ │                                     │
│ tailscale serve :8448 (HTTPS/WSS) ◄───┘ │ │                                     │
│ Helm 데스크톱 앱 (Windows, 같은 PC) ─ ①WSS(serve 경유) 또는 ②SSH                 │
│ ┌─ WSL2 Ubuntu 24.04 (mirrored: 127.0.0.1을 호스트와 공유) ───────────────────┐ │
│ │ OpenSSH :22 (tailnet만, 키 인증) ◄──────┘ │                                 │ │
│ │ helmd ── tailnet 127.0.0.1:7840 ◄─(serve)  loopback 127.0.0.1:7841 ◄─(ssh -W)│ │
│ │        └ local Unix 소켓 rpc.sock (TUI·CLI)                                   │ │
│ │  ├ ③ 도구 자식 프로세스 (bash, rg, git …) ──► ~/projects/<제품>/code/…       │ │
│ │  ├ ④ @helm/observer (fork 일회성 자식, IPC) ──► 외부 에이전트 세션 로그(읽기)│ │
│ │  └ ⑤ SQLite 정본 /srv/volumes/helm/data/helm.sqlite (WAL, ext4)              │ │
│ │ helm tui / helm (CLI) ── Unix 소켓 ──► helmd                                 │ │
│ │ 외부 에이전트: pi, Claude Code, Codex (사용자가 직접 실행. 세션 로그만 읽음)  │ │
│ │ 비밀 원본: ~/projects/helm/secrets/<env>.sops.yaml → 시작 때 데몬 메모리로    │ │
│ │ restic 백업 (homelab systemd 타이머) · Syncthing(~/projects ↔ Mac)          │ │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────┘
```

#### 3.1.2 외부 요소와 연결

| 번호 | 요소 | 무엇 | Helm과의 연결 | 소유 문서 |
|---|---|---|---|---|
| - | 사용자 | 제품 소유자 1인 [결정 24] | 데스크톱 앱, TUI, CLI로만 Helm을 조작한다. 사람의 결정은 모델 도구 경로를 거치지 않는다(extracts-4 20-9) | 01, 03 |
| ① | 데스크톱 앱 (macOS, Windows) | Tauri v2 + React 19 얇은 클라이언트 [결정 41; 제안: 결정 32 기본값] | `wss://<서버>.ts.net:8448` → Windows `tailscale serve` → WSL `tailnet` 리스너 `127.0.0.1:7840` [제안: 결정 26 기본값. 17 D17-09] | 20 |
| ①' | 모바일 클라이언트 (iPhone) | 질문에 답하는 클라이언트 [결정 42]. 데몬이 서빙하는 홈 화면 웹 앱(PWA), 알림은 Web Push [결정 47]. 최소 판 iOS 26 [결정 49]. 데스크톱 MVP 다음 단계 | 휴대폰의 Tailscale → `https://<서버>.ts.net:8448/m/`(정적 묶음), `wss://…:8448/rpc` → `tailnet` 리스너 7840. 기기 토큰은 HttpOnly `__Host-helm_dt` 쿠키(26 MOB-D03). 데몬이 Apple 푸시 서비스로 Web Push를 직접 보낸다(VAPID) | 26, 18, 19 |
| ② | SSH 경로 | WSL OpenSSH 22번(tailnet에서만, 키 인증) [브리프 §2.5] | 데스크톱 앱의 두 번째 접속 방식[결정 38]. 방식은 `ssh -W 127.0.0.1:7841` → `loopback` 리스너다[제안: 19 P-02, 20 APP-D03, ADR-19-01]. TUI 실행 경로 [결정 39] | 18, 19, 20 |
| ③ | 도구 실행 | bash, rg, git 등 데몬이 띄우는 자식 프로세스 | 데몬의 `tools`가 생성·감시·종료한다. 작업 대상은 `~/projects/<제품>/code/…`(Syncthing 동기화 폴더) | 13 |
| ④ | 관찰 에이전트 | 기록을 읽어 반복 패턴을 찾고 수정안을 제안하는 별도 프로세스(브리프 §6 용어집) | 데몬의 감독기가 `child_process.fork`로 띄우는 일회성 자식 프로세스. DB는 읽기 전용 리더로 읽고, 제안 제출과 모델 호출은 Node IPC로 데몬에 맡긴다(16 §3.2) | 16 |
| ⑤ | 정본 저장소 | SQLite WAL 이벤트 로그 [제안: 결정 29 기본값] | `/srv/volumes/helm/data/helm.sqlite` [브리프 §2.5, 17 §3.2.2. 파일 이름은 09가 바꿀 수 있다] | 09, 17 |
| ⑥ | 모델 제공자 | Anthropic, OpenAI 등 pi-ai가 지원하는 API | 데몬만 호출한다. 클라이언트는 모델을 직접 부르지 않는다 | 07, 12 |
| - | 외부 에이전트 세션 로그 | pi(`~/.pi/agent/sessions/…`), Claude Code, Codex가 WSL에 남기는 기록 | 관찰 에이전트가 사용자가 허용한 프로젝트 폴더 범위에서만 읽는다 [결정 35]. Helm은 쓰지 않는다 | 16 |
| - | Tailscale | Windows 호스트에만 있는 tailnet 노드 [브리프 §2.5] | `tailscale serve`가 HTTPS를 끝내고 127.0.0.1로 넘긴다. Funnel은 쓰지 않는다 [제안: 결정 26 기본값] | 17, 18 |
| - | 비밀 저장 | SOPS `~/projects/helm/secrets/<env>.sops.yaml` [브리프 §2.5] | 데몬이 시작 때 `secrets run`으로 비밀 내보내기 도구를 자식으로 실행해 값을 메모리로만 받는다(§3.9.3, 17 D17-07) | 17, 18 |
| - | 백업 | homelab restic(매일 04:00) [원문 `homelab/context/storage.md` 백업 절] | 데몬이 만든 검증된 SQLite 스냅숏(`/srv/volumes/helm/backups/`)을 restic이 가져간다(§3.9.4, 17 D17-10) | 17 |
| - | Mac 빌드 노드 | macOS 앱 빌드는 Mac에서만 [브리프 §2.5] | `just app-build-mac`이 `run-on mac`으로 지시한다(§3.16) | 20 |

맥락 안에서 지켜야 할 사실:

- WSL은 `networkingMode=mirrored`라서 Windows 호스트의 127.0.0.1과 WSL의 127.0.0.1이 같다. homelab의 다른 서비스도 WSL 안 127.0.0.1에 바인딩하고 Windows `tailscale serve`가 받는다 [원문 `homelab/context/network.md` 기본·포트 표]. Helm 데몬도 같은 방식을 쓴다.
- `tailscale serve`는 8443~8447을 쓰고 있다 [원문 `homelab/context/network.md` serve 표]. Helm은 8448을 쓰고 뒤쪽 포트는 7840이다(17 D17-09). 실제 반영은 homelab `tailscale/serve.table`에 한 줄(`8448  http://127.0.0.1:7840   helm`)을 더하고 `just serve-apply`를 실행하는 일이며, homelab 저장소 변경이므로 사람이 한다(17 §3.7).
- Windows PC는 서버이면서 사용자가 직접 쓰는 PC다 [원문 `homelab/context/machines.md`]. 그래서 Windows 데스크톱 앱은 같은 PC의 WSL 데몬에 붙는다. 이 경우에도 경로 ①(serve 경유) 또는 ②를 쓴다. mirrored 모드에서 Windows 프로세스도 127.0.0.1:7840·7841에 직접 붙을 수 있으므로, 리스너는 출발지 주소를 신뢰 근거로 쓰지 않는다(§3.7.4) [제안, 연결 프로필은 20이 확정].

### 3.2 레이어와 의존 방향

#### 3.2.1 레이어 그림

위 레이어가 아래 레이어에 의존한다. 아래에서 위로의 의존은 없다. 같은 레이어 안의 의존은 §3.4 표에 적힌 것만 허용한다.

```text
 L6 표현층        apps/desktop   apps/mobile(26, 이후 단계)   apps/tui   apps/cli
                       │ client·ui-language·protocol·domain(타입)만        │ cli는 store/admin 추가
 L6c 클라이언트 공용층  packages/client (protocol에만 의존)   packages/client-react (React 연결)
                       packages/ui-language (I/O 없음)    packages/ui-tokens (의존 없음)   packages/ui (표현 부품)
                       ┆ L5~L1을 건너뛰고 L0만 본다
 L5 호스트층      packages/daemon  (조립 루트: 설정, 리스너, 인증, 수명주기, 관찰 감독기)
                       │
 L4 실행층        packages/runtime            packages/observer (fork 일회성 자식 프로세스)
                       │                          │ 읽기는 store/read, 제출·모델 호출은 Node IPC로 데몬에
 L3 변경 경로층   packages/engine   ← 이벤트 append는 여기서만
                       │
 L3' 실행 부품층  packages/ai   packages/agent   packages/tools   (pi 고정 의존·vendor를 감싼 층)
                       │
 L2 기록층        packages/store  (SQLite 드라이버는 여기서만)
 L1 규칙층        packages/kernel (순수, I/O 없음. 하위 경로 orchestration 포함)
 L0 계약층        packages/domain (하위 경로 model 포함)        packages/protocol
                  ─── vendor/ (07: @helm/vendor-pi-agent-core, @helm/vendor-pi-tools, @helm/vendor-pi-image)
                      + 고정 의존 pi 패키지(pi-ai, pi-codemode, pi-mcp, pi-tui) ───
```

- L3(`engine`)과 L3'(`ai`, `agent`, `tools`)은 서로 의존하지 않는다. 둘을 함께 쓰는 곳은 L4 `runtime`뿐이다. 그래서 모델 루프 코드가 기록 계층에 직접 쓸 경로가 없다(결정 14, P3).
- L0의 `protocol`은 `domain`의 타입을 다시 내보낼 수 있다. `domain`은 `protocol`을 모른다.
- `kernel`은 `protocol`을 모른다. 전송 형식이 도메인 규칙에 섞이지 않게 한다(P1).
- L6c는 클라이언트 쪽 코드만 쓰는 층이다. `client-react`는 20 §3.14, `ui-tokens`와 `ui`는 21 UI-D19를 받아 더했다. `client`는 연결·재접속·재전송 로직(클라이언트만 씀)을, `protocol`은 와이어 타입(서버도 씀)을 담는다. 둘을 나누면 데몬이 클라이언트 런타임 코드를 끌어오지 않는다(판정 §2). `ui-language`는 문구 키와 문장 생성 함수만 담고 I/O가 없다(05 A9). 데몬과 `observer`는 L6c를 import하지 않는다.

#### 3.2.2 원전 논리 계층과의 대응

canon §13.2(F07 §2)의 논리 계층 7개를 패키지에 대응시킨다. "계층은 배포 단위가 아니라 의미 경계"라는 원전 문장대로, 배포는 데몬 프로세스 하나다.

| 원전 논리 계층 | 패키지 | 비고 |
|---|---|---|
| Experience Layer (Brief, Inquiry, Decision, Integration) | `apps/desktop`, `apps/mobile`(26), `apps/tui`, `apps/cli`, 문구는 `ui-language` | 화면은 데몬이 만든 투영을 보여 준다. 화면용 투영 계산은 `kernel`의 순수 함수, 읽기는 `engine.store`(`RuntimeStoreReader`) |
| Attention & Governance Engine (Gate, Authority, Escalation, Policy) | `kernel`(질문 게이트·정책 판정 규칙, 10·11), `@helm/kernel/orchestration`(논리 배분: 우선순위·주의 예산·활성 Concern, 14), `runtime`(물리 상한과 타이머, 12. 판정 J-13) | 판정은 순수 함수, 시점 결정은 스케줄러 |
| Normative / Epistemic / Material Domain | `domain`(타입·스키마, 08), `kernel`(전이 규칙, 10) | |
| Event Ledger & Projection Runtime | `store`(로그·투영 테이블, 09), `engine`(트랜잭션·투영 갱신·구독) | |
| Agent / Tool / Storage Adapters | `runtime/adapter`(런타임 어댑터, 13), `tools`, `ai`, `agent`, `store`의 SQLite 드라이버 | |

#### 3.2.3 원전 소유 경계와의 대응

canon §16.8의 소유 경계 4개를 패키지에 대응시킨다.

| 원전 소유자 | 소유하는 것(원전) | 패키지 |
|---|---|---|
| Helm Kernel | 정체성과 버전 있는 스키마, 명령 검증과 전이, append-only 원장, N/E/M 관계 투영, 권한·근거·신선도 정책, 충돌·무효화 신호, 어댑터 능력 계약, 결정적 내보내기·가져오기 | `domain`, `kernel`, `store`, `engine` (+ 능력 계약 타입은 `runtime/adapter`) |
| Runtime Adapter | 작업 합의를 런타임별 지시로 변환, 실행 수명주기 관찰, 도구·산출물 변화 수집, 권한·중지·취소 매핑, 결과를 완료 주장과 근거 후보로 제출, 지원 못 하는 능력 보고 | `runtime/adapter`의 1차 어댑터(자체 런타임), 이후 `packages/adapter-*` |
| Client | CLI, TUI, GUI, 상호작용 표현, 알림 채널. 도메인 검증·정본 상태를 소유하지 않는다 | `apps/*`(모바일 포함), `client`(클라이언트 코어), `ui-language`(문구), `protocol`(와이어 형식) |
| Agent Runtime | 모델 호출과 추론 루프, 도구 선택·실행, 제공자·세션 관리, 컨텍스트 창 전략 | `runtime`, `agent`, `ai`, `tools` |

### 3.3 패키지 경계 확정

#### 3.3.1 최종 목록

브리프 §3.1의 목록을 따르고 패키지를 더한다 [제안, ADR-06-17(ADR-06-03을 대체). 2a 판정 §2]. 더한 것: `engine`, `client`, `client-react`, `ui-language`, `ui-tokens`, `ui`, `testkit`, vendor 패키지 3개. 모바일 앱(`apps/mobile`)은 결정 42로 자리만 둔다.

| 디렉터리 | 이름 | 레이어 | 브리프 §3.1 대비 |
|---|---|---|---|
| `packages/domain` | `@helm/domain` | L0 | 같음. 하위 경로 `model`에 저장·전송되는 모델 데이터 타입(메시지, 콘텐츠 블록, 사용량 등)을 둔다(07 D07-8, §3.9.2. 타입 이름은 08). 하위 경로 `metrics`에 지표 값 타입과 지표 뷰 타입을 둔다(16) |
| `packages/protocol` | `@helm/protocol` | L0 | 같음. 와이어 형식(envelope, 등록 표, 스키마, 오류 코드)만 담는다 |
| `packages/kernel` | `@helm/kernel` | L1 | 같음. 하위 경로 `orchestration`에 I/O 없는 오케스트레이션 코어(14 §3.20.6)와 탐구 엔진의 순수부(15, 판정 J-128) |
| `packages/store` | `@helm/store` | L2 | 같음. 하위 경로 `read`, `write`, `admin`, `aux`, `testing`으로 API를 나눈다(09 §3.16) |
| `packages/engine` | `@helm/engine` | L3 | **추가**. 단일 변경 경로(접수, 멱등, 커널 결정 주입, 커밋, 지시 배포). 하위 경로 `testing`(메모리 엔진, 시험 전용) |
| `packages/ai` | `@helm/ai` | L3' | 같음. 하위 경로 `pi`에 루프 연결용 pi 기계 타입 재export(07 §3.9.2), `testing`에 faux 제공자와 테이프(22) |
| `packages/agent` | `@helm/agent` | L3' | 같음 |
| `packages/tools` | `@helm/tools` | L3' | 같음 |
| `packages/runtime` | `@helm/runtime` | L4 | 같음. 하위 경로 `adapter`(런타임 어댑터 계약), `orchestration`(오케스트레이터의 효과 부분, 14), `testing` |
| `packages/observer` | `@helm/observer` | L4 | 같음. 진입점 `dist/main.js`(데몬이 fork), 하위 경로 `metrics`(순수 지표 함수), `ipc`(IPC 타입, `typebox`·`domain`만 import하는 순수 모듈) (16 §3.2, §3.24) |
| `packages/daemon` | `@helm/daemon` | L5 | 같음. 실행 파일 `helmd`, 비밀 내보내기 도구 `helm-secret-export`(17) 포함 |
| `packages/client` | `@helm/client` | L6c | **추가**. 클라이언트 코어(연결 상태 기계, hello, 재접속, 구독 복원, 뷰 무효화, 진행 중 명령 재전송). `@helm/protocol`에만 의존한다. 하위 경로 `node`(Node 전송), `browser`(브라우저 전송), `testing`(가짜 전송) (판정 §2, 19 §3.14) |
| `packages/ui-language` | `@helm/ui-language` | L6c | **추가**. 문구 키, 한국어 문구, 상태 라벨, 조사 처리, 금지 표현 검사. I/O 없음 (05 A9, 판정 §2) |
| `packages/client-react` | `@helm/client-react` | L6c | **추가**. 클라이언트 코어의 React 연결과 플랫폼 경계(`PlatformAdapter`). 데스크톱이 쓰고 모바일이 React면 함께 쓴다 (20 §3.14) |
| `packages/ui-tokens` | `@helm/ui-tokens` | L6c | **추가**. 디자인 토큰 원본과 생성물(CSS 변수, Tailwind `@theme`, DTCG JSON). Caustic 토큰을 복사해 다시 쓴 것, 의존 없음 (결정 43, 21 §3.2.8, UI-D13) |
| `packages/ui` | `@helm/ui` | L6c | **추가**. 플랫폼 중립 표현 부품(React). 데스크톱과 모바일이 함께 쓴다. 데스크톱 전용(셸, 창 효과, 단축키)은 `apps/desktop` (21 UI-D19, 결정 42) |
| `tests` | `@helm/tests` | 시험 전용 | **추가**. 여러 패키지를 함께 띄우는 시험의 하네스(22 D22-5). 어떤 패키지도 의존하지 않는다 |
| `packages/testkit` | `@helm/testkit` | 개발 전용 | **추가**. 고정 시계, 결정적 ID, 임시 디렉터리 같은 범용 시험 도우미. `devDependencies`로만 쓴다 |
| `apps/desktop` | `@helm/desktop` | L6 | 같음 |
| `apps/mobile` | `@helm/mobile` (이름은 26이 확정) | L6 | **추가 자리**. 결정 42. 데스크톱 MVP 다음 단계. 구현 방식은 26 |
| `apps/cli` | `@helm/cli` | L6 | 같음. 실행 파일 `helm` |
| `apps/tui` | `@helm/tui` | L6 | 같음. 이후 단계 |
| `vendor/pi-agent-core`, `vendor/pi-tools`, `vendor/pi-image` | `@helm/vendor-pi-agent-core`, `@helm/vendor-pi-tools`, `@helm/vendor-pi-image` | L3' 아래 | **추가**. 07 D07-7. pi-ai·pi-codemode·pi-mcp·pi-tui는 vendor가 아니라 정확한 버전 고정 의존(`1.1.0`)이다(07 D07-5) |

#### 3.3.2 더한 패키지의 이유

| 패키지 | 이유 | 넣지 않았을 때의 문제 |
|---|---|---|
| `engine` | 상태를 바꾸는 입력이 다섯 곳에서 온다: 사람 명령(데몬 처리기), 모델 제안(런타임 훅), 도구 관찰(런타임 훅), 타이머(스케줄러), 관찰 에이전트 제안(IPC를 받은 데몬 감독기). 이 입력이 모두 "멱등 확인 → 커널 판정 → 이벤트 append → 투영 갱신 → 알림 대기열"을 한 트랜잭션으로 지나야 한다(v0.3 08 §2, canon-2 §1.18 Transaction boundary). 이 조율 코드를 한 패키지에 두면 "이벤트 append는 `engine`에서만"을 import 규칙 하나로 강제할 수 있다 | `store`에 두면 저장소가 커널을 알게 되고, `runtime`에 두면 데몬 처리기 경로가 런타임 전체에 의존한다. `daemon`에 두면 런타임 훅이 데몬에 의존하는 역방향이 생긴다 |
| `client` | 데스크톱, 모바일, TUI, CLI가 같은 연결·재접속·재전송 로직을 써야 한다. OpenClaw는 클라이언트 네 종류가 각자 복구 로직을 따로 구현했다 [원문 S4/openclaw-gateway §4 "피할 것" 1]. 와이어 타입은 서버도 쓰고 연결 로직은 클라이언트만 쓰므로 `protocol`과 나눈다(판정 §2) | 1단계 초안은 이 코어를 `@helm/protocol/client` 하위 경로로 접었다. 그러면 `protocol` 패키지에 클라이언트 런타임 코드와 그 시험이 섞이고, 데몬이 `protocol`을 의존할 때 쓰지 않는 코드까지 같은 빌드 단위에 들어온다 |
| `ui-language` | 데스크톱·모바일·TUI가 같은 문구 목록을 써야 한다. 데몬은 문구 키와 인자만 보내고 클라이언트가 문장을 만든다(05 A9). 금지 표현·조사 처리 시험을 한 곳에서 한다 | 앱마다 문구 파일을 두면 TUI와 데스크톱의 말이 서로 달라진다. 데몬이 완성 문장을 보내면 문구 수정에 데몬 배포가 필요하다 |
| vendor 3개 | pi 코드 중 수정하는 것(에이전트 루프, coding-agent 도구, 이미지 유틸)을 작업 공간 비공개 패키지로 둔다(07 D07-2·4·7). 이미지 유틸은 `@helm/ai`와 read 도구가 함께 쓰므로 따로 뗀다(07 §3.6.4) | 이미지 유틸을 `vendor-pi-tools` 안에 두면 `@helm/ai`가 도구 vendor 패키지에 의존해 "vendor 하나 = 감싸는 패키지 하나" 규칙(R7)이 깨진다 |
| `client-react` | 데스크톱과 모바일(React일 때)이 같은 뷰 캐시·명령·초안·연결 상태 규칙을 써야 한다(04 SC-03). 플랫폼 API를 주입받게 처음부터 나누면 모바일로 옮기는 비용이 작다(20 §3.14) | 앱 안에 두면 모바일이 생길 때 Tauri 의존이 섞인 코드를 걷어 내야 한다 |
| `ui-tokens`, `ui` | 결정 42로 모바일 클라이언트가 생기므로 토큰과 표현 부품을 데스크톱 앱 밖에 둔다(21 UI-D19). 토큰은 Caustic을 복사해 Helm 원본으로 다시 쓰고 의존하지 않는다(결정 43) | 부품을 `apps/desktop` 안에 두면 모바일이 같은 부품을 쓰려 할 때 앱 사이 import가 생기거나 복제된다 |
| `testkit` | 가짜 시계와 결정적 ID가 `kernel`·`engine`·`runtime`·`daemon` 테스트에 모두 필요하다. 같은 입력에서 같은 이벤트 로그가 나와야 한다(v0.3 08 §6) | 테스트 도우미가 패키지마다 복제되고 결정성 조건이 서로 달라진다 |

검토했으나 만들지 않은 패키지:

- `@helm/config`: 설정 스키마와 로더는 `daemon`이 소유한다(§3.10).
- `@helm/adapter-contract`: 1차 구현에서 어댑터는 자체 런타임 하나이므로 `@helm/runtime/adapter` 하위 경로로 충분하다. 저장소 밖 어댑터가 생기면 그때 분리한다(§7 O-06).
- `@helm/scheduler`: 시간 기반 깨우기는 `runtime`의 모듈로 둔다(브리프 §3.1 "runtime: 스케줄러"). 타이머가 내는 것은 `engine.submit`의 `timer` 입력뿐이다.

### 3.4 패키지별 책임, 공개 API 개요, 금지 의존

공개 API는 각 패키지 `src/index.ts`(또는 `package.json` `exports`에 적은 하위 경로)에서 내보내는 것만이다. 아래 이름은 개요이며, 세부 타입은 소유 문서가 정한다. 소유 문서가 이름을 바꾸면 이 표를 따라 고친다.

#### 3.4.1 의존 허용 표

행 패키지가 열 패키지에 의존할 수 있으면 O, 하위 경로만 허용이면 경로를 적는다. 빈칸은 금지다. 이 표가 §3.5 검사 스크립트의 원본이다.

| 의존하는 쪽 \ 대상 | domain | protocol | kernel | store | engine | ai | agent | tools | runtime | observer | client | client-react | ui-language | ui-tokens | ui | testkit(dev) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| domain | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| protocol | O | - |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| kernel | O |  | - |  |  |  |  |  |  |  |  |  |  |  |  | O |
| store | O |  |  | - |  |  |  |  |  |  |  |  |  |  |  | O |
| engine | O |  | O | `read`, `write` | - |  |  |  |  |  |  |  |  |  |  | O |
| ai | O |  |  |  |  | - |  |  |  |  |  |  |  |  |  | O |
| agent |  |  |  |  |  | O, `pi` | - |  |  |  |  |  |  |  |  | O |
| tools | O |  |  |  |  |  |  | - |  |  |  |  |  |  |  | O |
| runtime | O |  | O |  | O | O, `pi`(R2) | O | O | - | `metrics` |  |  |  |  |  | O |
| observer | O |  |  | `read`, `aux` |  |  |  |  |  | - |  |  |  |  |  | O |
| daemon | O | O |  | `read`, `write`, `admin` | O | O |  |  | O | `ipc`, `metrics` |  |  |  |  |  | O |
| client |  | O |  |  |  |  |  |  |  |  | - |  |  |  |  | O |
| client-react |  | O(타입) |  |  |  |  |  |  |  |  | O(브라우저 루트) | - | O |  |  | O |
| ui-language | O(타입) | O(타입) |  |  |  |  |  |  |  |  |  |  | - |  |  | O |
| ui-tokens |  |  |  |  |  |  |  |  |  |  |  |  |  | - |  |  |
| ui |  | O(타입) |  |  |  |  |  |  |  |  |  |  | O | O | - | O |
| cli | O | O |  | `admin` |  |  |  |  |  |  | O, `node` |  | O |  |  | O |
| tui | O | O |  |  |  |  |  |  |  |  | O, `node` |  | O |  |  | O |
| desktop | O(타입) | O |  |  |  |  |  |  |  |  | O(브라우저 루트) | O | O | O | O | O |
| mobile | O(타입) | O |  |  |  |  |  |  |  |  | O(루트, `browser`) | O | O | O | O | O |
| tests(`@helm/tests`, 시험 전용) | 모든 `@helm/*`와 `testing` 하위 경로를 devDependencies로 | | | | | | | | | | | | | | | O |
| testkit | O |  |  |  |  |  |  |  |  |  |  |  |  |  |  | - |

- `daemon`은 `kernel`을 직접 import하지 않는다. 판정은 항상 `engine`을 거친다.
- `observer`는 `protocol`, `client`, `ai`, `engine`, `runtime`, `kernel`을 import하지 않는다(16 §5.2 06 요구 (1), 판정 §2). 제안 제출(`kernel.submit`)과 모델 호출(`llm.complete`)은 Node IPC로 데몬에 맡긴다(`aux_agent` 채널, 16 §3.2.3). 관찰 프로세스는 비밀을 갖지 않는다(16 OB-3).
- 지표 값의 타입은 `@helm/domain`에 둔다. `@helm/observer/metrics`(계산 함수)와 `@helm/protocol`(지표 뷰 전송 형식)이 모두 그 타입을 import한다. `protocol`이 `observer`의 타입을 다시 내보내는 방향은 쓰지 않는다(16에 요구).
- `@helm/observer/metrics`는 `domain`만 import하는 순수 함수다. `daemon`·`runtime`(투영기)이 import한다(16 §5.2 06 요구 (2)). `@helm/observer/ipc`는 IPC 타입만 담는 순수 모듈이다. `typebox`와 `domain`만 import하고, `daemon`의 감독기가 import한다(16 §5.2 06 요구 (3)).
- `@helm/tests`(저장소 루트 `tests/`, 22 D22-5)는 시험 전용 층이다. 모든 패키지와 `testing` 하위 경로를 devDependencies로 쓸 수 있고, 어떤 패키지도 `@helm/tests`를 의존하지 않는다.
- `client`는 `protocol`에만 의존한다(판정 §2). 레코드 타입은 `protocol`이 다시 내보낸 것을 쓴다. `domain`·`kernel` 이상은 import하지 않는다.
- `daemon`과 `observer`는 L6c 패키지(`client`, `client-react`, `ui-language`, `ui-tokens`, `ui`)를 import하지 않는다. 데몬은 문구 키와 인자만 보낸다(05 A9).
- `client-react`(20 §3.14)는 React 연결(`useView`, `useCommand`, TanStack Query, IndexedDB 저장소, 연결 상태 계산과 `decisionsAllowed`, 알림 규칙의 순수 함수)을 담는다. 플랫폼 기능은 `PlatformAdapter`로 주입받고 `@tauri-apps/*`, Node 모듈, DOM 밖의 플랫폼 API를 import하지 않는다(20 §5.2 06 요구 (2)).
- `ui-tokens`는 외부 의존도 Helm 의존도 없는 데이터 패키지다. `ui`(표현 부품)는 React와 헤드리스 부품 라이브러리(21 §2.5)를 쓰되 `client`, Tauri, 앱의 `sync`·`platform`을 import하지 않는다(21 UI-D01·D19).
- pi 코드: 07 §3.9.1 원칙 1의 대응만 허용한다. pi-ai·`@helm/vendor-pi-image` → `ai`, `@helm/vendor-pi-agent-core` → `agent`, `@helm/vendor-pi-tools`·pi-codemode·pi-mcp → `tools`, pi-tui(고정 의존) → `tui`. vendor 패키지끼리와 vendor → 고정 의존 pi 패키지(07 §3.9.1 원칙 2)는 R7의 예외다. 정확한 파일 단위 표는 07 §3.9.1이고 검사 스크립트는 그 표를 따른다(R7, 07 I4).
- `@helm/ai/pi`(루프 연결용 pi 기계 타입)는 `agent`와 `runtime`의 루프 구동·투영 생성 파일(12 §3.1의 `run/engine.ts`, `run/hooks.ts`, `projection/model.ts`, `ports/*`)만 import한다(07 §3.9.1 원칙 4, R2).
- `@helm/domain/model`은 `domain`의 하위 경로이므로 `domain`을 쓸 수 있는 곳은 모두 쓸 수 있다. 이벤트 로그(09)·실행 기록(12)·프로토콜(19)의 모델 데이터는 이 타입만 쓴다(07 §3.9.1 원칙 3).

#### 3.4.2 `@helm/domain` (L0)

- 책임: 레코드·엔티티·이벤트·명령·제안의 TypeScript 타입과 TypeBox 스키마, ID 형식 검사(`<prefix>_<ULID>`, 접두사 목록의 정본은 08 §3.2, 판정 §1), 행위자 표기(08 §3.3.2), 시간 타입(`Ms`, 08), 상태 기계 표(`src/machines`, 08 §3.22를 데이터로). 실행 로직 없음.
- 공통 순수 함수(여러 프로세스가 같은 규칙을 써야 하는 것): 마스킹 규칙 표와 적용 함수 `src/redaction/`(관찰 프로세스와 데몬이 함께 씀, 16 §3.8.2, 18 §3.10.4), 도구 호출 인자 지문 정규화(10 §5.2 13 요구). I/O가 없으므로 `domain`에 둔다 [제안].
- 공개 API 개요: `schemas`(TypeBox 스키마 묶음), `type IdOf<P extends IdPrefix>`, `isId(prefix, value)`, `type ActorRef`, `type Via`, `type EventEnvelope<T>`, 이벤트 타입(09 §3.4 카탈로그가 이름의 정본, 판정 §1), `type CommandEnvelope`(10), `type Ms`. 이름은 08·09·10이 정한 것을 쓴다.
- 패키지 경계 타입 [제안]. 커널·저장소·엔진·런타임 사이를 오가는 타입은 이 패키지에 한 벌만 둔다. 다른 패키지는 이것을 import하고 다시 정의하지 않는다. 모양의 정본은 괄호 안 문서다.

| 파일 | 타입 | 모양의 정본 |
|---|---|---|
| `src/kernel-contract.ts` | `KernelContext`, `KernelState`(불변 맵), `Decision`, `DecisionStatus`, `EventDraft`, `Rejection`, `Notice`, `Directive`, `RuleBundle`의 데이터 타입 | 10 §3.1 |
| `src/store-contract.ts` | `StoredEvent`, `TraceDraft`, `SubmitResult`(= 저장되는 명령 결과, 09의 `WriteResult`는 이 이름으로 맞춘다) | 09 §3.16, 06 §3.4.6 |
| `src/runtime-store.ts` | `RuntimeStoreReader`, `RuntimeStoreWriter`, `InquirySnapshot`(판정 J-127. 탐구 엔진 `reduceInquiry`의 입력 묶음) | 06(메서드 표면은 12 §3.1.2, 탐구 스냅숏은 15) |
| `src/budget.ts` | 예산 요청·계정 타입(`BudgetRequest`, 계정 이름). `ai`와 `runtime`이 함께 쓴다 | 12 |
| `src/adapter-contract.ts` | 어댑터 계약 타입 전부: `RuntimeAdapter`, `AdapterRunSpec`, `KernelGate`, `NeutralEventSink`, `CapabilityManifest`, `RuntimeSignal`, `ProjectedContext`, `NeutralToolCall`, `NeutralToolResult`와 이들이 쓰는 `ChangeSet`·`EffectiveScope`·`RunBudget`. 구현은 `@helm/runtime/adapter`(§3.4.10)에 있다 | 13 §3.11.2 |
| `src/features.ts` | `FeatureKey`와 단계 표(`FEATURE_TABLE`: 키·단계·기본값) | 23 §3.5.4(판정 J-181), 06(구조) |
| `src/metrics/fact.ts` | 지표 값 타입(`FactKind`, `MetricFact`, `MetricValue`) | 16 |
| `src/metrics/view.ts` | 지표 뷰 데이터 타입(19의 `metrics`·`evaluation` 뷰, 측정 명령) | 16, 19 |

  커널 결정의 입력은 `KernelState`(10)이고 09의 메서드형 `KernelView`는 두지 않는다. 저장소 쪽 읽기는 `RuntimeStoreReader`가 맡는다.
- 하위 경로 `@helm/domain/model`: 저장·전송되는 모델 데이터 타입(메시지, 콘텐츠 블록, 도구 선언, 사용량, thinking 수준, stopReason). pi-ai와 같은 모양의 Helm 소유 타입이고, 같은 모양인지는 `@helm/ai`의 컴파일 시험 I5가 검사한다(07 §3.9.2, D07-8). 이름은 08이 확정한다.
- 외부 의존: `typebox`(고정 의존 pi-ai 1.1.0과 같은 판 `1.3.27`, §3.12)만.
- 금지: `node:*` 모듈, 전역 시계·난수(`Date.now`, `Math.random`, `crypto.randomUUID`), 다른 `@helm/*`.
- 소유 문서: 08(타입·ID·`model`), 09(이벤트 envelope·카탈로그), 10(명령·제안), 07(`model`과 pi 타입의 일치 규칙).

#### 3.4.3 `@helm/protocol` (L0)

- 책임: 클라이언트-데몬 와이어 형식. JSON-RPC 2.0 envelope, 메서드·알림 등록 표(`METHOD_SPECS`), TypeBox 스키마, 오류 코드, 프로토콜 버전, codec(19 §3.13). 연결 로직은 담지 않는다(그것은 `@helm/client`, §3.4.13).
- 진입점(19 §3.13.1이 확정):

| 진입점 | 내용 | 환경 |
|---|---|---|
| `@helm/protocol` | 스키마, 타입, 등록 표, 오류 표, codec | 브라우저 안전 |
| `@helm/protocol/testing` | `FakeDaemon`, `FakeClient`, 시나리오 DSL, 적합성 스위트(19 §6.3) | 개발 전용, 브라우저 안전 |

- SSH 경로는 `ssh -W` 위에 HTTP + WebSocket을 그대로 쓰므로 stdio 프레임 인코더가 필요 없다(19 P-02, 19 §5.2 06 요구 (1)).
- 외부 의존: `typebox`. `domain`은 타입으로만 가져온다.
- 금지: `kernel`, `store`, `engine` 이상 전부, `client`, 모든 `node:*` 모듈.
- 생성물 `src/push-fallback.generated.ts`(푸시 대체 문구 상수, 26 §3.4)는 루트 스크립트 `scripts/gen-push-fallback.ts`가 `@helm/ui-language`의 값으로 만든다. 생성물은 저장소에 커밋하고, `just gen-push-fallback --check`가 현재 값과 같은지 본다(§3.16). `protocol`은 `ui-language`를 import하지 않는다. 생성 스크립트가 패키지 밖(루트 `scripts/`)에 있어서 `ui-language`가 `protocol` 타입을 쓰는 방향과 순환하지 않는다.
- 소유 문서: 19(구조·내용), 20(앱에서의 쓰임).

#### 3.4.4 `@helm/kernel` (L1)

- 책임: 순수 커널. 형식 검사, 자격(A)·정책(P) 판정, 의존 규칙, 상태 전이(`decide`/`apply`/`react`), 질문 게이트·전달 방식 판정, 투영 계산(화면·모델 컨텍스트용 순수 함수), 거부 분류(갈래 이름 `content`/`authority`/`path`, 판정 §1). 브리프 §3.1 "I/O 없음".
- 공개 API 개요(10 §3.1이 정본. 아래는 06이 경계를 정하는 데 쓰는 요약이다):

```ts
// 커널은 시계와 ID 생성기를 직접 읽지 않는다. engine이 넣어 준다 (canon-2 §1.6 `@helm/kernel` 금지 조건).
export interface KernelContext {
  readonly now: Ms;                 // engine이 트랜잭션 시작 때 한 번 읽는다
  readonly cursor: Seq;             // 이 결정 직전의 마지막 seq
  newId<P extends IdPrefix>(prefix: P): IdOf<P>;   // engine의 derivedIdFactory(issuedAt, idempotencyScopeKey)
  readonly rules: RuleBundle;       // 규칙 데이터 묶음과 버전(1단계의 policyVersion)
  readonly attention: { dnd: boolean; budget: "normal" | "over_budget" | "quiet_hours" };  // 데몬 운영 상태 중 커널이 읽는 것(14 §3.13.5)
}
// 사람의 접속 상태(presence)는 ctx가 아니라 영속 이벤트 presence.changed에서 만든 커널 상태로 읽는다(10 §3.1.3, 09 §3.4.13).
export function decide(state: KernelState, cmd: CommandEnvelope, ctx: KernelContext): Decision;
export function apply(state: KernelState, event: CommittedEvent): KernelState;   // 순수 reducer
export function react(before: KernelState, after: KernelState,
                      drafts: readonly EventDraft[], ctx: KernelContext): readonly EventDraft[];
export type DecisionStatus = "accepted" | "rejected" | "needs_gate" | "conflict" | "error";
// Decision = { status, commandId, events: EventDraft[], directives: Directive[], rejection?, notices, createdRefs, gate? }
```

- 조회 함수(순수, 10 §3.1.5): `pendingTimers`, `checkSettle`, `allowedCommands`, `mustIncludeRefs`, `impactOf`, `viewAt`, `explain` 등. 런타임은 `RuntimeStoreReader.kernelSnapshot()`으로 받은 상태에 직접 부른다(순수 함수라 import가 허용된다).
- 하위 경로 `@helm/kernel/orchestration` [판정 J-128]: I/O 없는 함수와 데이터만 둔다. 14의 순수 코어(계약·모드·다이얼 데이터, 라우팅 결정표, 계획기, 전환 규칙, 가드, `reduceView`, `decide`, 진입 판정)와 15의 순수부(`planRound`, `roundClosable`, 탐구 투영 리듀서, 역할 출력 스키마)가 여기 있다. 10의 `inquiry.round.close` 판정이 `roundClosable`을 부르므로 커널 안에 있어야 커널이 runtime 코드를 부르지 않는다. 입출력 타입(이벤트, 명령 초안, 접점 초안)은 `@helm/domain` 타입을 쓴다. 효과가 있는 부분(오케스트레이터 루프, 실행기, 탐구 단계 run)은 `@helm/runtime/orchestration`과 `packages/runtime/src/inquiry/`다.
- 외부 의존: `typebox`(스키마 검사)만. Helm 패키지는 `domain`만.
- 금지: `node:*`, `Date`의 현재 시각 읽기(`Date.now()`, 인자 없는 `new Date()`), `Math.random`, `crypto`, `process`, `setTimeout`/`setInterval`, `console`, `protocol`, 그 위 레이어 전부. 이 금지는 ESLint로 검사한다(§3.5.3).
- 소유 문서: 10(결정·명령·거부·지시), 11(질문 게이트·전달), 14·15(`orchestration`의 내용). 투영 계산의 A11 규칙 집행은 12.

#### 3.4.5 `@helm/store` (L2)

- 책임: SQLite 연결과 PRAGMA, 이벤트 로그 append·조회, 해시 체인, 투영 테이블(`p_*`)을 같은 트랜잭션에서 갱신하는 투영기, 멱등 입력함(`commands` 테이블, 거부·충돌·게이트 결과도 저장), 실행 기록(`trace` 테이블), 내부 소비자 커서(`consumer_cursors`), 블롭, 커널 스냅숏, 마이그레이션, 무결성 검사, 온라인 백업. SQLite 드라이버(`better-sqlite3`)를 import하는 유일한 패키지다(09 §3.16).
- outbox 테이블은 없다. 커밋 뒤 알림(`onCommitted`)은 커밋한 JS 턴 안에서 동기로 부르고, 놓친 구독자는 `readEvents(afterSeq)`로 따라잡으며, 내부 소비자(알림기, 관찰, 스케줄러, 오케스트레이터, 지표)는 `consumer_cursors`에 처리한 seq를 남긴다(09 D09-5, A09-4).
- 커널을 import하지 않는다. 쓰기의 기본 단위는 동기 대화형 쓰기 트랜잭션 `transaction(fn)`이다(better-sqlite3 transaction 위, 판정 J-148). `fn` 안에서 engine이 명령을 하나씩 판정하고 `tx.commitOne(command, decision)`으로 기록한다. 저장소는 seq·해시·투영·`commands` 행을 붙인다. `commit`·`commitBatch`(입력마다 `decide`를 받는 형태, 09 §3.8.4)는 그 위의 편의 함수다. `KernelContext`는 engine이 만든다(저장소는 만들지 않는다).
- 공개 API는 하위 경로로 나눈다(목록의 정본은 09 §3.16 끝).

| 하위 경로 | 내용 | import 허용 |
|---|---|---|
| `@helm/store` | 타입만(`Seq`, `StoredEvent`, `CommitInput`, `CommitResult`, `StoreError`) | 허용 표 범위 안 누구나 |
| `@helm/store/read` | `openReader(dataDir)`: `query_only` 읽기 연결. `readEvents`, `getRecord`, `queryRecords`, `links`, `search`, `attention`, `timersDue`, `getBlob`, `recordRevision` | engine, observer, daemon(워커의 무거운 읽기), testkit |
| `@helm/store/write` | `transaction(fn)`, `commit`, `commitBatch`, `appendTrace`, `onCommitted`, `putBlob`, `stageUpload`, 운영 테이블(`runtime_timers`, `consumer_cursors`, `volatile_scratch`), 커널 스냅숏 | engine, daemon(부트스트랩에서 열어 engine에 넘길 때만) |
| `@helm/store/admin` | `openStore`(데몬 전용, 쓰기 포함), `openOffline(dataDir, { mode: "read" \| "maintain" })`(데몬이 멈춘 상태의 CLI 전용: 잠금을 잡고, `read`는 `query_only`, `maintain`은 마이그레이션·복원·재구성만 하고 `commit`을 노출하지 않는다), `StoreAdmin`(`quickCheck`, `verifyChain`, `projectionDigest`, `backupTo`, `schemaVersion`, `codeSchemaRange`), `migrate`, `rebuildProjections`, `restore`, `exportJsonl`, 인스턴스 잠금 `acquireInstanceLock(dataDir)`(`data/helmd.lock`에 `BEGIN EXCLUSIVE`, 17 §3.1.4, 판정 J-101) | daemon, cli |
| `@helm/store/aux` | `openAuxDb(path, migrations)`: 정본이 아닌 보조 SQLite 파일(관찰 캐시 `observer.db`)을 여는 함수. `better-sqlite3`를 다른 패키지가 import하지 않게 하기 위한 것이다(R6, 16 §5.2 06 요구 (2)) | observer |
| `@helm/store/testing` | 임시 DB, 고장 주입 지점 | 테스트 파일만 |

- 인스턴스 잠금 함수는 SQLite 파일을 여므로 R6에 따라 `store/admin`에 둔다(판정 J-101).
- 오프라인 CLI(`helm events tail`, `helm export`, `helm ops migrate`, 복구 훈련)는 `openOffline`만 쓴다. 해시 체인 검증과 체크포인트 HMAC에 필요한 `HELM_LEDGER_HMAC_KEY`는 CLI가 17 §3.8과 같은 방식(`secrets run … -- helm-secret-export`)으로 받아 메모리에만 둔다. 키가 없으면 체인 해시만 검증하고 HMAC 검증은 건너뛰었다고 출력한다 [제안, 17에 요구].
- 외부 의존: `better-sqlite3`(§3.12.3).
- 금지: `kernel`(결정 함수는 `engine`이 넘긴다), `protocol`, 그 위 레이어 전부. 트랜잭션 콜백 안에서 `await`를 쓰는 API를 만들지 않는다(동기 트랜잭션만).
- 소유 문서: 09(DDL·투영·해시 체인·마이그레이션·API), 17(잠금·백업·복구 절차).

#### 3.4.6 `@helm/engine` (L3) — 추가 패키지

- 책임: 단일 변경 경로의 접수 상자(10 §3.2 상자 0). 제출을 `CommandEnvelope`로 완성하고(채널·행위자·via·`commandId`), 저장소의 동기 대화형 쓰기 트랜잭션(`store.transaction(fn)`) 안에서 커널 `decide`를 부른 뒤 결과를 기록한다 [판정 J-148]. `KernelContext`(`now`, `cursor`, `newId`, `rules`, `attention`)를 만든다. 커밋 뒤 커널이 낸 지시(`Directive`)를 런타임·데몬에 넘긴다. 런타임이 정본을 읽는 `RuntimeStorePort`를 구현해 주입한다 [판정 J-127]. 이벤트 append는 이 패키지를 거쳐서만 일어난다.
- 공개 API 개요 [제안. 명령 envelope·결과·지시의 세부 타입은 10 §3.1·§3.3이 정본이고, 경계 타입은 `@helm/domain` 한 벌을 쓴다(§3.4.2)]:

```ts
export interface Engine {
  /** 모든 상태 변경의 유일한 입구. 동기 함수다: 트랜잭션 안에서 await하지 않는다. transact(tx => tx.submit(input))와 같다 */
  submit(input: EngineInput): SubmitResult;
  /** 여러 제출·실행 기록·운영 테이블 쓰기를 한 트랜잭션으로 묶는다(판정 J-148). fn은 동기 함수다.
      tx.submit은 각각 decide를 거치고, 뒤 제출은 앞 제출이 덧씌운 KernelState 사본을 본다. fn이 던지면 전부 롤백하고 사본을 버린다 */
  transact<T>(fn: (tx: EngineTx) => T): T;
  /** 커밋된 상태 읽기(판정 J-127). 1단계의 query(QueryName…)는 이 포트로 바꿨다 */
  readonly store: RuntimeStoreReader;
  /** seq 다음부터 커밋된 이벤트를 순서대로 읽는다(09 readEvents). 프로토콜 재전송의 원천이다 */
  readAfter(seq: Seq, limit: number): readonly StoredEvent[];
  /** 커밋한 그 JS 턴 안에서 동기로 알린다(09 onCommitted). 데몬은 이것으로 구독자에게 이벤트를 보낸다 */
  onCommitted(listener: (events: readonly StoredEvent[]) => void): Unsubscribe;
  /** 커밋 뒤 실행할 지시(10 Directive). 런타임·데몬이 받는다 */
  onDirective(listener: (d: Directive) => void): Unsubscribe;
}

/** 제출 입력 = 10 CommandEnvelope에서 접수(engine)가 채우는 필드를 뺀 것. 별도 kind 갈래를 두지 않는다.
    채널과 명령 종류의 대응(command·proposal·observation·timer)은 10 §3.3.5 표가 정한다 */
export type EngineInput = Omit<CommandEnvelope, "commandId" | "actor" | "via" | "channel"> & {
  readonly commandId?: CommandIdT;   // 없으면 engine이 발급한다. 있으면 형식과 중복만 검사한다
  readonly channel: CommandChannel;  // 호출자가 정하지 않는다: 데몬 처리기는 연결 종류에서, runtime은 runtime·model_tool, 스케줄러는 scheduler
  readonly actor: ActorRef;          // 데몬 처리기는 인증된 주체로, runtime은 실행 중 역할로, 감독기는 agent:observer로 고정
  readonly via: Via;
};
// 타이머 발화도 같은 모양이다: type "timer.fire", payload = 10 TimerFirePayload { timerId, purpose, subject, dueAt }, channel "scheduler".
// 사람 확정 명령은 basisSeq(사람이 본 화면의 seq)가 필수이고, 레코드를 직접 지정하면 expect(레코드별 revisionSeq)를 단다.
// 전역 expectedSeq는 두지 않는다(10 §3.3.4, 09 D09-4).

/** 저장되는 결과(09 commands 행)와 같은 모양. 10 Decision에서 파생한다 */
export type SubmitResult =
  | { status: "accepted";   seq: Seq; events: readonly EventRef[]; notices: readonly Notice[]; replayed: boolean }
  | { status: "rejected";   seq: Seq; rejection: Rejection; replayed: boolean }        // command.rejected로 남긴다(A14)
  | { status: "needs_gate"; seq: Seq; rejection: Rejection; gate: { questionId: QuestionIdT }; replayed: boolean }
  | { status: "conflict";   seq: Seq; rejection: Rejection; replayed: boolean }        // basisSeq·expect 낡음. command.rejected로 남긴다(판정 J-25)
  | { status: "key_reused"; headSeq: Seq; original: CommandIdT }                       // 같은 멱등 키·다른 지문. 이벤트도 commands 행도 만들지 않는다
  | { status: "error";      error: KernelError };                                       // 저장하지 않는다. 트랜잭션 롤백
// 같은 멱등 키·같은 지문의 재시도는 저장된 결과를 replayed: true로 돌려준다.
// EventRef = { seq, eventId, type }. KernelError = { code: "kernel.reaction_overflow" | "kernel.invariant_violation" | "store.*", detail }.

export interface EngineTx {
  submit(input: EngineInput): SubmitResult;
  /** 실행 기록(모델 메시지 본문, 요청 manifest, 주입 메시지, 컴팩션 요약, 예산 원장 등) append.
      도메인 레코드가 아니므로 커널 판정을 받지 않고 형식·펜싱 검사만 받는다(12 §3.1, 09 trace 테이블) */
  appendTrace(records: readonly TraceDraft[]): void;
  /** 이 트랜잭션 안의 덧씌운 상태 읽기. 판정과 쓰기 사이에 다른 커밋이 끼면 안 되는 읽기(펜싱 등)는 이것으로 한다 */
  readonly read: RuntimeStoreReader;
  /** 운영 테이블 쓰기(runtime_timers, consumer_cursors, volatile_scratch, blob). 커널 판정 없음 */
  readonly ops: RuntimeStoreWriter;
}

export function createEngine(deps: {
  store: StoreWriter;              // @helm/store/write의 HelmStore 쓰기 면(transaction, commitBatch, appendTrace, onCommitted, 운영 테이블)
  clock: () => Ms;                 // 커널에 넣을 시각
  rules: RuleBundle;               // 10 §3.1.3. 계약·모드·라우팅 데이터는 @helm/kernel/orchestration(14)
  attention: () => KernelContext["attention"];   // 데몬이 운영 상태(방해 금지, 주의 예산)에서 계산
}): Engine;
```

- `RuntimeStorePort`(`RuntimeStoreReader` + `RuntimeStoreWriter`)의 타입은 `@helm/domain/src/runtime-store.ts`에 두고(§3.4.2), engine이 `store/write`·`store/read` 위에 구현한다. 메서드 목록은 12 §3.1.2가 필요로 하는 표면(레코드·링크 조회, 커널 상태 스냅숏, 이벤트, 스레드 메시지, trace, blob, 타이머, 예산, 커서, `volatile_scratch`, boots, 표시 번호)을 그대로 쓴다. `runtime`은 `store`를 import하지 않는다 [판정 J-127]. 탐구 엔진의 `reduceInquiry` 입력 `InquirySnapshot`(탐구 레코드, 그 `inquiryId`를 가진 레코드, 단계 trace의 묶음)은 `records(q)`와 `traces(q)`에 `inquiryId` 필터를 더해 만든다(15 요구 (2), 12 §3.1.2에 요구).
- `commandId`는 engine이 접수 때 발급한다(제출자가 넣었으면 그 값을 검사해 쓴다). 커널이 새 레코드에 주는 ID(`newId`)는 같은 제출을 다시 결정해도 같아야 한다. 그래서 파생 ID의 시각 부분은 `ctx.now`가 아니라 envelope의 `issuedAt`을, 나머지 80비트는 멱등 범위 키(`channel|actor|viaKey|key`, 09 §3.9.1)와 순번으로 만든 `sha256`의 앞 10바이트를 쓴다(판정 J-182: 파생 ID의 입력은 멱등 키 범위이고 `commandId`가 아니다. 같은 멱등 키로 다시 결정하면 같은 ID가 나온다).
- 시작과 크래시 복구 [제안, 세부 알고리즘은 09·10이 정한다]: (1) `KernelState`는 `kernel_snapshots`의 마지막 스냅숏 + 그 뒤 이벤트를 `apply`로 접어 만든다(09 §3.16 끝). 스냅숏의 `rules_version`이나 해시가 맞지 않으면 처음부터 접는다. (2) 처리하지 못한 지시는 소비자 커서 `directives` 이후 이벤트에 `directivesFor`를 돌려 다시 만들고, 처리할 때마다 커서를 올린다. 같은 `deliveryId`·멱등 키로 중복을 거른다(10 §3.1.4). (3) 스냅숏은 일정 이벤트 수마다 커밋 뒤에 쓴다. 메모리 목표(NFR-C-4)는 스냅숏 크기와 투영 캐시 상한으로 지킨다.
- `needs_gate`는 거부와 다르게 다룬다. 커널이 질문을 함께 기록했고, 사람이 답하면 제출자가 새 멱등 키로 다시 낸다(10 §3.4.5, 14 `${triggerEventId}:${ruleId}:after:${questionId}`).
- 실행 기록(`appendTrace`)도 `engine`을 거친다. 원시 런타임 trace(§3.11.1)를 정본 DB에 쓰는 경로가 `engine` 밖에 생기지 않게 하기 위해서다. 실행 기록은 판단·결과의 근거로 인용할 수 없다(12 §3.1, 10 근거 검사).
- "지시(Directive)"라는 이름은 v0.3 12 §5.1의 `Effect`를 바꾼 것이다. `Effect`는 범위 밖으로 뺀 effect class(결정 2)와 단어가 겹친다(audit §5.5). 10이 이 이름을 채택했다.
- 외부 의존: 없음(`node:crypto`는 ID 생성의 sha256에만).
- 금지: `protocol`(전송 형식을 모른다), `ai`, `agent`, `tools`, `runtime`, `daemon`, `@helm/store/admin`.
- 소유 문서: 06(경계, `RuntimeStorePort` 타입), 09(트랜잭션 API·커밋 순서·소비자 커서·스냅숏), 10(명령 envelope·결과·거부 분류·지시).

#### 3.4.7 `@helm/ai` (L3')

- 책임: pi-ai를 감싼 얇은 모델 계층 [제안: 결정 27 기본값]. 모델 목록, 역할별 모델 선택(work, verifier, mediator, observer), 스트리밍 호출, 사용량·비용, 자격 증명 주입, 테스트용 faux 제공자.
- 공개 API 개요(12 §3.3이 확정): `createModelGateway(config: AiConfig, credentials: CredentialStore): ModelGateway`, `ModelGateway { resolve, streamFor, complete, usageOf, health }`. 예산 요청 타입은 `@helm/domain/src/budget.ts`를 쓴다(`ai`는 `runtime`을 import할 수 없다). 하위 경로 `@helm/ai/testing`에 faux 제공자와 테이프 재생(22).
- 하위 경로 `@helm/ai/pi`: 루프 연결에만 쓰는 pi 기계 타입(`Model<Api>`, `Api`, `TranscriptContext`, `SimpleStreamOptions`, `AssistantMessageEventStream`, `AssistantMessageEvent`)과 도구 선언 함수 3개의 재export(07 §3.9.2). import는 `agent`와 `runtime`의 루프 구동·투영 생성 파일만(R2).
- 외부 의존: 고정 의존 pi-ai `1.1.0`(07 D07-5), `@helm/vendor-pi-image`(이미지 크기 조정, 07 §3.6.4), `typebox`.
- 금지: `kernel`, `store`, `engine`, `runtime`, `protocol`. 저장·전송되는 모델 데이터는 `@helm/domain/model` 타입으로 내보낸다. pi 타입을 그대로 내보내는 곳은 `@helm/ai/pi`뿐이다(07 D07-8).
- 소유 문서: 07(pi 경계), 12(모델 계층 API).

#### 3.4.8 `@helm/agent` (L3')

- 책임: pi-agent-core 포크 기반 에이전트 루프 [제안: 결정 28 기본값]. 훅(`beforeToolCall`, `afterToolCall`, `prepareRequest`, 이벤트 싱크(`subscribe` 또는 저수준 루프의 `emit`)의 `message_end`, 판정 J-14)을 Helm이 쓰는 계약으로 고정한다(07 §3.5 패치 A1~A7, §3.10 동작 계약). Helm 도메인을 모르는 범용 루프로 둔다.
- 공개 API 개요(07 §3.9.4가 재export 목록을 정한다): `runAgentLoop`, `runAgentLoopContinue`, `runToolCall`, `type AgentLoopConfig`, `type AgentEvent`, `type AgentTool`, `type AgentToolCallOutcome`, `type ToolCallRejection`.
- 외부 의존: `ai`(`@helm/ai/pi` 포함), `@helm/vendor-pi-agent-core`.
- 금지: `domain`을 포함한 Helm 도메인 패키지 전부. Helm 규칙을 루프에 넣는 일은 `runtime`이 훅으로 한다.
- 소유 문서: 07, 12.

#### 3.4.9 `@helm/tools` (L3')

- 책임: 원시 행동(read, write, execute, send, spawn, ask, 결정 4)에 대응하는 도구 구현. coding-agent 도구 포크(렌더러 의존 제거, pi-facts-1 §9.2), 파일·프로세스 접근을 주입받는 `*Operations` 인터페이스, 범위 검사기 주입 지점, 도구 메타데이터(원시 행동 종류, 재실행 안전성 `replay: "safe" | "never"`), Helm 제안 도구(`helm_*`)의 스키마와 설명. 제안 도구는 `ProposalSink` 인터페이스로 제출을 넘기고, `engine`을 직접 부르지 않는다. `ProposalSink`의 타입은 13이 정의하고, 구현(트랜잭션 본문: 의도 → 제안 → 완료를 `engine.transact` 하나로)은 `runtime`의 `run/hooks.ts`가 맡아 주입한다. 도구 결과 타입은 `@helm/vendor-pi-tools`의 재export를 쓰고 `agent`를 import하지 않는다(판정 J-56).
- 공개 API 개요(13이 확정): `createPrimitiveTools({ cwd, ops, scope })`, `createProposalTools(sink: ProposalSink)`, `type ToolMeta`, `type ScopeChecker`.
- 소스 위치([제안: 13 §6의 U-TL 표를 따른다]): `src/basic/`(read·write·edit·ls·find, 해시라인 편집 `edit-hashline.ts`, grep 확장 `grep.ts`), `src/web/`(웹 읽기 `fetch.ts`, 웹 검색 `search.ts`, 변환 작업자 `convert-worker.ts`), `src/browser/`(브라우저 도구 호출기와 `helm-browserd` 진입점 `browserd.ts`), `src/sandbox/`(bwrap 실행기, 프록시 `proxy.ts`), `src/helm/`(제안 도구), `src/repl/`(REPL 샌드박스), `src/pi/`(pi 연결부). 중계기 실행 파일은 `packages/tools/bin/helm-netshim`이다(13 U-TL-16).
- 웹 변환 작업자와 `helm-browserd` 진입점은 `@helm/*` 패키지를 import하지 않는다. 두 진입점은 데몬 프로세스 안에서 돌지 않는다(§3.6.7). 그 입출력 타입은 같은 패키지 안에 둔다.
- 외부 의존: `@helm/vendor-pi-tools`(coding-agent 도구 7개 포크, 07 D07-4), 고정 의존 pi-codemode·pi-mcp `1.1.0`(07 §3.12·§3.13), `typebox`. vendor 도구가 요구하는 모델 정보는 `@helm/domain/model`의 값으로 채운다(07 §3.9.1 끝). 웹·브라우저 도구의 외부 의존은 `linkedom`·`@mozilla/readability`·`turndown`(변환 작업자만 import)과 `playwright-core`(`browserd` 진입점만 import)다. 판과 설치 조건은 §3.12.5, 규칙은 R6·R16이다.
- 금지: `kernel`, `store`, `engine`, `runtime`, `protocol`.
- 소유 문서: 13.

#### 3.4.10 `@helm/runtime` (L4)

- 책임: WorkUnit 실행, 루프 실행(모드·루프 계약 적용), 탐구 엔진(15), 훅에서 커널 검사 연결(제안·관찰을 `engine.submit`으로), 모델 컨텍스트 투영 생성, 컴팩션, 크래시 복구(재시작 시 미완료 도구 호출 정리), 스케줄러(지속 타이머, 물리 동시 실행 상한), 오케스트레이터 루프, 런타임 어댑터 계약과 1차 어댑터.
- 14와 12의 경계(판정 J-13): 논리 배분(우선순위, 주의 예산, 활성 Concern)은 `@helm/kernel/orchestration`의 순수 코어가 계산하고 `@helm/runtime/orchestration`의 오케스트레이터 루프가 실행한다. 물리 상한(동시 실행 수, 비용 상한)과 타이머는 12의 스케줄러가 맡는다. 데몬 안의 오케스트레이터 루프는 하나이며 `consumer_cursors`의 `orchestrator` 행으로 처리 위치를 남긴다(14 §5.2 06 요구 (2), 09 §3.11).
- 공개 API 개요:

| 진입점 | 내용 | 소유 문서 |
|---|---|---|
| `@helm/runtime` | `createRuntime(deps: RuntimeDeps): Runtime`. `RuntimeDeps = { engine, store: RuntimeStoreReader, models: ModelGateway, config(절별), clock, connections, secrets, log }`. 도구 묶음(레지스트리, 샌드박스 실행기, 변경 감지기)은 `createRuntime`이 `config.tools`로 만든다(데몬은 `tools`를 import하지 않는다). `Runtime`은 12 `RuntimeLifecycle`(`recover`, `startScheduler`, `scheduleResumptions`, `drain`, `abortAll`, `pause`, `resume`, `exitSafeMode`, `status`)을 확장한다 | 12 §3.1.3, §3.7.3 |
| `@helm/runtime/orchestration` | 오케스트레이터 루프, 실행기, 작업 요청 큐(효과 부분) | 14 |
| `@helm/runtime/adapter` | 구현만 둔다: 1차 어댑터 `firstPartyAdapter`와 `RuntimeAdapter`의 구현체. 계약 타입(`AdapterRunSpec`, `KernelGate`, `CapabilityManifest`, `RuntimeSignal` 등)은 `@helm/domain/src/adapter-contract.ts`에 둔다(§3.4.2) | 13 (원칙은 §3.13) |
| `@helm/runtime/testing` | 어댑터 적합성 시험 묶음 `runAdapterConformance(adapter, fixtures)` | 13, 22 |

- `@helm/runtime/adapter` 폴더(`src/adapter/`)는 `domain`과 같은 폴더 안 상대 경로만 import한다. 나중에 별도 패키지로 꺼낼 수 있게 하기 위해서다(R8).
- pi 기계 타입(`@helm/ai/pi`)은 루프 구동·투영 생성 파일(`run/engine.ts`, `run/hooks.ts`, `projection/model.ts`, `ports/*`)만 import한다(R2, 07 §3.9.1 원칙 4).
- 정본 읽기는 주입받은 `RuntimeStoreReader`로, 운영 테이블 쓰기는 `EngineTx.ops`로만 한다 [판정 J-127].
- 지표 소비자(커밋 뒤 `consumer_cursors`의 `metrics`, 16 OBS-ADR-3)와 관찰 에이전트의 모델 호출 처리(`llm.complete` → 역할 호출, 예산 계정 `observer`)는 `runtime`이 소유한다. 데몬의 감독기는 IPC를 받아 `runtime`의 역할 호출 포트로 넘기기만 한다 [제안, 12·16·23과 맞춤].
- 외부 의존: `domain`, `kernel`(순수 조회·투영 함수, `orchestration`), `engine`, `ai`, `agent`, `tools`, `@helm/observer/metrics`.
- 금지: `store`(직접, 판정 J-127), `protocol`, `client`, `daemon`, `observer` 루트.
- 소유 문서: 12, 13, 14, 15.

#### 3.4.11 `@helm/observer` (L4, 별도 프로세스)

- 책임: 관찰 에이전트. Helm 기록(읽기 전용)과 허용된 외부 에이전트 세션 로그를 읽고, 결정적 마이닝 후 모델 판단으로 수정안을 만들어 데몬에 제출한다. 쓰기 권한이 없다(브리프 §6 용어집). 비밀도 갖지 않는다(16 OB-3).
- 진입점(16이 확정): `dist/main.js`(데몬이 `child_process.fork`로 띄움), `@helm/observer/ipc`(IPC 타입, 16 §3.2.3), `@helm/observer/metrics`(순수 지표 함수, 16 §3.18).
- 외부 의존: `domain`(마스킹 규칙 `redaction` 포함), `@helm/store/read`(SELECT만, `query_only`), `@helm/store/aux`(관찰 캐시).
- 감독기의 전송은 둘이다: 기본 `child_process.fork`(Node IPC), 격리 실행을 켤 때 `systemd-run --user --pipe --wait` 일회성 단위(표준 입출력 JSON 줄). 격리 실행이 실패하면 fork로 돌아가지 않는다(16 §3.2.1·§3.2.3, 17).
- 금지: `protocol`, `client`, `ai`, `engine`, `runtime`, `kernel`, `@helm/store/write`, `@helm/store/admin`, `daemon`. 모델 호출과 제출은 IPC로 데몬에 맡긴다(`aux_agent` 채널). 클라이언트 프로토콜은 `human_client` 채널만 만들므로 관찰 에이전트가 쓰지 않는다(19 §5.2 06 요구 (4), 판정 §2). `metrics` 하위 경로는 `domain`만 import한다.
- 소유 문서: 16.

#### 3.4.12 `@helm/daemon` (L5)

- 책임: 조립 루트(composition root)와 프로세스 수명주기. 설정 로드·검증(§3.10), 로거(§3.11), 비밀 로드(17 D17-07), 단일 writer 잠금, 마이그레이션 실행, `engine`·`runtime` 생성, 리스너 셋(`tailnet`, `loopback`, `local`, 17 D17-09), 인증(리스너 단계, 18), JSON-RPC 처리기(메서드 → `engine.submit`/`engine.store` 읽기/`runtime` 호출), 구독과 재전송 송출, 큰 데이터 HTTP 경로, 모바일 PWA 정적 서빙(`/m/*`, `tailnet` 리스너만)과 쿠키 페어링(`/m/pair`·`/m/whoami`·`/m/logout`, 결정 47, 26 §3.3.2), Web Push 송신기(`daemon/push`, 26 §3.4), 관찰 실행 감독기(fork, IPC 처리, 16 §3.2), 신호 처리와 종료 drain.
- 공개 API 개요: 실행 파일 `helmd`, 비밀 내보내기 도구 `helm-secret-export`(데몬이 `secrets run`의 자식으로 띄우는 짧은 진입점, 판정 45, 17 §3.8), `startDaemon(config): Promise<DaemonHandle>`, `type DaemonConfig`, `loadConfig(sources)`.
- 외부 의존: `domain`, `protocol`, `@helm/store/write`, `@helm/store/admin`, `engine`, `runtime`, `ai`(`createModelGateway`로 모델 계층을 만들어 `runtime`에 넘긴다. 관찰 에이전트의 `llm.complete` IPC는 `runtime` 역할 호출 포트로 넘긴다), `@helm/observer/ipc`, `@helm/observer/metrics`, `ws`, `pino`, `smol-toml`, `web-push`(정확한 판 고정, `src/push/`만).
- 금지: `kernel`(직접), `agent`, `tools`, `client`, `ui-language`, `@helm/observer` 루트(진입점 파일 경로로만 fork), `better-sqlite3` 직접 import(잠금도 `store/admin`으로).
- 소유 문서: 06(조립 구조), 17(수명주기), 18(인증), 19(처리기), 16(감독기 요구).

#### 3.4.13 `@helm/client` (L6c) — 추가 패키지

- 책임: 전송 독립 클라이언트 코어. 연결 상태 기계(`idle`·`connecting`·`handshaking`·`syncing`·`ready`·`backoff`·`needsUser`·`closed`), hello와 인증 응답, 재접속 백오프, 구독 위치 저장·복원, gap 처리, 뷰 무효화, 진행 중 명령함(보내기 전에 저장, 끊기면 같은 멱등 키로 재전송), 휘발 스트림 이어 붙이기(19 §3.10, §3.14). 데스크톱·모바일·TUI·CLI가 한 벌을 함께 쓴다.
- 진입점:

| 진입점 | 내용 | 환경 |
|---|---|---|
| `@helm/client` | `HelmClient`, `Transport`·`ClientStateStorage` 인터페이스, `PendingCommand` | 브라우저 안전(`node:*` 금지). 데스크톱은 Rust가 바이트 연결을 맡고 웹뷰는 텍스트 프레임만 넘긴다(20 APP-D02) |
| `@helm/client/node` | `NodeWsTransport`(TCP, `ws+unix`) | Node 전용. `cli`, `tui`만 import |
| `@helm/client/browser` | 브라우저 `WebSocket` 전송. 기기 토큰은 브라우저가 `__Host-helm_dt` 쿠키로 싣고 스크립트는 읽지 못한다(18 §3.4.3, 판정 J-118). 준비 실패는 `GET /m/whoami`로 판정하고, 숨김 직전의 명령은 `POST /m/cmd`(keepalive)로 보낸다. 같은 기기의 여러 창은 `leaderLock`(`navigator.locks`)으로 리더 하나만 연결한다(19 §3.9.4, §3.14) | 브라우저 안전. 모바일(PWA)과 시험용 |
| `@helm/client/testing` | 가짜 전송, 가짜 시계 | 개발 전용 |

- 코어는 자격 증명을 다루지 않는다. 데스크톱은 Rust 전송이 헤더를 붙이고(토큰은 Rust 쪽 키체인에 있다), 모바일은 브라우저가 쿠키를 붙이며, TUI·CLI는 `localAdmin`을 쓴다. 1판의 `credentials` 선택 인자는 없앴다(판정 J-118, 19 §3.14).
- 외부 의존: `@helm/protocol`만(판정 §2). `node` 진입점만 `ws`.
- 금지: `domain`(직접. 필요한 타입은 `protocol`이 다시 내보낸다), `kernel` 이상 전부, `ui-language`, React·Tauri 같은 화면·플랫폼 라이브러리.
- 1단계 초안은 이 코어를 `@helm/protocol/client` 하위 경로로 접었다. 2a 판정 §2에 따라 별도 패키지로 되돌렸다(ADR-06-17).
- 소유 문서: 19(의미·API), 20(데스크톱에서의 쓰임), 26(모바일에서의 쓰임).

#### 3.4.14 `@helm/testkit` (개발 전용) — 추가 패키지

- 책임: 여러 패키지 테스트가 함께 쓰는 범용 도우미(22 §3.5.2 API). 손으로 움직이는 시계 `manualClock`(타이머 호스트를 겸하고, `fn`을 `createEngine`과 클라이언트의 시계 인자에 넣는다), 결정적 ID `fixedIdFactory`, 고정 난수 `seededRandom`, 임시 디렉터리 `tempDir`, 격리 환경 `withIsolatedEnv`, 운영 경로 거부 `assertNotProduction`, 이벤트 비교(`normalizeEvents`, `eventDigest`, `diffEvents`). `domain`에만 의존한다.
- 패키지 고유의 시험 도우미는 그 패키지의 `testing` 하위 경로에 둔다: 가짜 모델 대본은 `@helm/ai/testing`, 임시 DB는 `@helm/store/testing`, 메모리 엔진은 `@helm/engine/testing`, 프로토콜 시험 도구는 `@helm/protocol/testing`, 가짜 전송은 `@helm/client/testing`, 어댑터 적합성 시험은 `@helm/runtime/testing`. `testkit`이 위 레이어에 의존하면 `kernel`(devDependency로 `testkit` 사용) → `testkit` → `kernel` 순환이 생겨 TypeScript 프로젝트 참조(`tsc -b`)가 깨지기 때문이다.
- 규칙: 어떤 패키지도 `dependencies`에 넣지 않는다. `devDependencies`로만 쓴다. `domain`과 `protocol`은 `testkit`을 쓰지 않는다(순환 방지). `testing` 하위 경로는 같은 패키지의 테스트와 위 레이어의 테스트만 import한다(§3.5 검사). 임시 SQLite는 testkit이 만들지 않는다. testkit은 `store`에 의존하지 않으므로 `@helm/store/testing`이 준다.
- 소유 문서: 22.

#### 3.4.15 `apps/desktop`, `apps/mobile`, `apps/tui`, `apps/cli`

| 앱 | 책임 | 허용 의존 | 금지 | 소유 문서 |
|---|---|---|---|---|
| `@helm/desktop` | Tauri v2 셸 + React 19 렌더러 [결정 41]. 뷰 표시, 사람 명령 전송, 알림, 키체인의 기기 토큰(Rust 쪽). UI 부품은 직접 만들고(shadcn 소스 복사 포함) [결정 41, 50], Caustic 토큰은 복사한다 [결정 43] | `@helm/client`(브라우저 루트), `@helm/client-react`, `@helm/protocol`, `@helm/ui-language`, `@helm/ui`, `@helm/ui-tokens`, `@helm/domain`(타입만), Tauri·React 생태계(20 §3.7.3, 21) | L1~L5 전부. `kernel`도 금지한다. 순수 함수라도 앱 쪽에 Helm 로직을 두지 않는다 [제안: 결정 32 기본값] | 20, 21 |
| `@helm/mobile` (`apps/mobile`) | 휴대폰에서 질문에 답하기 [결정 42, 47]. React 19 + Vite PWA(`base: /m/`, 서비스 워커). 데스크톱 MVP 다음 단계. 네이티브 iOS 경로(26 경로 B)는 Apple 개발자 프로그램 상태를 본 뒤에 이후 검토한다([결정 57]) | `client`(루트, `browser`), `client-react`, `protocol`, `ui-language`, `ui`, `ui-tokens`, `domain`(타입만) | L1~L5 전부, `@tauri-apps/*` | 26 |
| `@helm/tui` | pi-tui 기반 TUI [결정 39]. SSH로 들어온 WSL 셸에서 `local` 리스너(Unix 소켓)로 데몬에 붙는다 | `client`(+`node`), `protocol`, `ui-language`, `domain`, 고정 의존 pi-tui(07 D07-5) | L1~L5 전부 | 19 §3.14, 이후 단계 문서 |
| `@helm/cli` | 관리 CLI `helm`: 상태, 진단, 페어링·기기, 백업·복구·검증, 마이그레이션, 설정 검사, 로그 보기(명령 목록은 17 §3.15). 예비 SSH 경로의 `helm bridge`(19 B4, 선택 구현) | `client`(+`node`), `protocol`, `ui-language`, `domain`, `@helm/store/admin`(데몬이 멈춘 상태의 오프라인 명령에만) | `engine`, `runtime`, `kernel`, `daemon`, `@helm/store/write` | 17 |

- 데스크톱 앱 안의 층 규칙(20 §3.9.1): `screens → ui, sync, navigation`, `sync → @helm/client, @helm/protocol, db, connection`, `connection → platform`, `platform/tauri → @tauri-apps/*`. `src/ui/`는 `sync`, `platform`, `@helm/client`를 import하지 않는다(21 UI-D01: 컴포넌트는 표현 전용). 앱 안의 ESLint `import/no-restricted-paths`로 검사한다(R14).
- 모바일 앱은 PWA다 [결정 47]. 이름은 `@helm/mobile`(`apps/mobile`)이고 데스크톱과 `client`, `client-react`, `ui-language`, `ui-tokens`, `ui`를 함께 쓴다(26 §3.2.1). 빌드 묶음은 데몬 릴리스의 `web/mobile/`에 들어가고 데몬이 `/m/`로 서빙한다(26 §3.6.1, 17). 화면·알림·기기 인증의 세부는 26·18·19가 정한다. 26의 경로 B(Tauri iOS + APNs)는 열어 둔다 [결정 47].

#### 3.4.16 `@helm/ui-language` (L6c) — 추가 패키지

- 책임: 화면 문구의 단일 목록. 문구 키, 한국어 문구, 상태 라벨(03 §3.3), 조사 처리(`josa.ts`), 오류 코드 → 문구 키 대응(19 오류 표), 금지 표현 검사(05 §3.10.9) (05 A9, §6).
- 데몬은 문구 키와 인자만 보내고 클라이언트가 이 패키지로 문장을 만든다. 21의 문구 키(`ui/copy`)는 이 목록의 키다(21 §5.2 요구 정리, 판정 §2).
- 외부 의존: 없음. `domain`·`protocol`은 타입과 상수(오류 코드)만 가져온다.
- 금지: I/O 전부(`node:*`, DOM, 네트워크), React, `client`, `kernel` 이상.
- 소유 문서: 05(문구·검사), 21(데스크톱에서의 키 사용).

#### 3.4.17 `@helm/client-react`, `@helm/ui-tokens`, `@helm/ui` (L6c) — 추가 패키지

- `@helm/client-react`: `useView`, `useCommand`, TanStack Query 연결, IndexedDB 저장소(`IdbClientStateStorage`)와 뷰 캐시·초안 store, 사용자용 연결 상태와 `decisionsAllowed`, 딥 링크 해석, 알림 규칙과 presence 판정의 순수 함수(20 §3.14). 플랫폼 기능은 `PlatformAdapter`(전송 생성, 자격 증명 상태, 알림, 딥 링크, 설정, blob URL, 화면 가시성)로 주입받는다. 토큰 값을 다루는 코드를 갖지 않는다(20 APP-D02). 공개 API는 26이 정해질 때 다시 본다(20 §7 Q-18).

- `@helm/ui-tokens`: 토큰 원본(`src/tokens.ts`), 대비 규칙, 생성 스크립트, 생성물(`dist/`). React·Tauri를 모른다. Caustic 출처와 바꾼 점은 `NOTICE.md`에 둔다(결정 43, 21 §3.2.8). 생성물은 저장소에 넣고 `just ui-check`가 원본과 맞는지 검사한다.
- `@helm/ui`: 플랫폼 중립 표현 부품(L0 기본 부품, Helm 시각 문법 부품, 의도 타입 `UiIntent`). 부품은 VM을 받아 그리고 의도를 내보낼 뿐, 연결·저장·플랫폼 API를 모른다(21 UI-D01). 문구는 `@helm/ui-language`의 키로 쓴다.
- 금지: 세 패키지 모두 `kernel` 이상 전부, `@tauri-apps/*`, Node 모듈, 앱의 `platform`. `ui-tokens`·`ui`는 `client`·`client-react`도 import하지 않는다(부품은 VM을 받고 의도를 내보낼 뿐이다).
- 시점: 세 패키지 모두 데스크톱 MVP 때부터 만든다(20 §3.14 `client-react`, 21 ADR 후보 21-5, 판정 J-85). 셸만 `apps/desktop`에 둔다.
- 소유 문서: 20(`client-react`), 21(`ui-tokens`·`ui`), 26(모바일에서의 쓰임). 21이 2a단계 개정을 마치면 경계를 다시 확인한다.

#### 3.4.18 vendor 패키지 (`vendor/`)

| 패키지 | 내용 | 감싸는 Helm 패키지 | 소유 문서 |
|---|---|---|---|
| `@helm/vendor-pi-agent-core` | pi-agent-core 루프 포크(패치 A1~A7) | `agent` | 07 §3.4~§3.5 |
| `@helm/vendor-pi-tools` | coding-agent 도구 7개와 의존 파일 포크(패치 T1~) | `tools` | 07 §3.6~§3.7 |
| `@helm/vendor-pi-image` | coding-agent 이미지 유틸 8개 | `ai`(read 도구는 vendor 안 의존으로 씀) | 07 §3.6.4 |

- 비공개 작업 공간 패키지다. 각 패키지에 `UPSTREAM.json`, `PATCHES.md`, `LICENSE`를 두고 파일마다 출처 헤더를 단다(07 D07-7, §3.17). 기준은 pi 태그 `v1.1.0`이다(판정 44, 07 D07-1).
- vendor 패키지끼리의 의존과 vendor → 고정 의존 pi-ai 의존은 R7의 예외다(07 §3.9.1 원칙 2).
- vendor 패키지의 `tsconfig`는 업스트림 소스를 덜 고치기 위해 `allowImportingTsExtensions`, `rewriteRelativeImportExtensions`, `erasableSyntaxOnly`를 켤 수 있다(07 §3.3.3, TS 6.0.3에서 확인됨). Helm 패키지의 공통 설정은 바꾸지 않는다.

### 3.5 의존 규칙의 기계적 강제

§3.4의 경계는 문서로만 두지 않고 `just verify`가 실패하도록 만든다 [제안, ADR-06-04]. 사람이 리뷰로 지키는 규칙은 같은 실수가 반복되기 쉽기 때문이다(AGENTS.md 템플릿 "같은 실수가 두 번 나오면 한 줄 추가").

#### 3.5.1 규칙 목록

| 번호 | 규칙 | 검사 수단 |
|---|---|---|
| R1 | 각 패키지 `package.json`의 워크스페이스 의존(`workspace:*`)은 §3.4.1 허용 표의 부분집합이다 | `scripts/check-architecture.ts` |
| R2 | 하위 경로 제한: `@helm/store/write`는 `engine`·`daemon`, `@helm/store/admin`은 `daemon`·`cli`, `@helm/store/read`는 `engine`·`observer`·`daemon`(워커의 무거운 읽기 작업), `@helm/store/aux`는 `observer`만 import한다. `@helm/ai/pi`는 `agent`와 `runtime`의 루프 구동·투영 생성 파일(`run/engine.ts`, `run/hooks.ts`, `projection/model.ts`, `ports/*`)만 import한다(07 §3.9.1 원칙 4). `@helm/client/node`는 `cli`·`tui`만 import한다 | `check-architecture.ts`(소스 import 목록 검사) + ESLint `no-restricted-imports` |
| R3 | `@helm/testkit`과 모든 `*/testing` 하위 경로는 `devDependencies`로만 선언하고, 테스트 파일(`**/*.test.ts`, `test/**`, `tests/**`)에서만 import한다 | `check-architecture.ts` |
| R4 | 순수·브라우저 안전 패키지(`domain`, `protocol`, `kernel`(`orchestration` 포함), `@helm/observer/metrics`, `@helm/observer/ipc`, `client`의 `node` 진입점을 뺀 전부, `client-react`, `ui-language`, `ui-tokens`의 `src/`(생성 스크립트 제외), `ui`)는 `node:*` 모듈과 Node 전역(`process`, `Buffer`, `__dirname`, `require`)을 쓰지 않는다 | ESLint `no-restricted-imports`, `no-restricted-globals` |
| R5 | `kernel`은 현재 시각(`Date.now()`, 인자 없는 `new Date()`), `Math.random`, `crypto`, 타이머, `console`을 쓰지 않는다 | ESLint `no-restricted-syntax`, `no-restricted-properties` |
| R6 | 외부 모듈 소유: `better-sqlite3`는 `store`, `ws`는 `daemon`·`@helm/client/node`, `pino`는 프로세스 루트(`daemon`, `observer` 진입점, `cli`)만, `web-push`는 `packages/daemon/src/push/`만 import한다. `playwright-core`는 `packages/tools/src/browser/browserd.ts`만, `linkedom`·`@mozilla/readability`·`turndown`은 `packages/tools/src/web/convert-worker.ts`만 import한다(R16). `react`는 `ui`, `client-react`와 앱(`desktop`, `mobile`)만 import한다. `@tauri-apps/*`는 `apps/desktop`의 `platform/tauri`만 import한다. L0~L3 패키지는 로거를 import하지 않고 주입받은 `Logger` 인터페이스만 쓴다 | ESLint `no-restricted-imports` + R1 |
| R7 | pi 코드(고정 의존 pi 패키지와 `@helm/vendor-*`)는 07 §3.9.1 표에 적힌 패키지만 import한다(07 D07-8): pi-ai·`vendor-pi-image` → `ai`, `vendor-pi-agent-core` → `agent`, `vendor-pi-tools`·pi-codemode·pi-mcp → `tools`, pi-tui → `tui`. 예외: vendor 패키지끼리(`vendor-pi-tools` → `vendor-pi-agent-core`(타입)·`vendor-pi-image`)와 vendor → pi-ai(07 §3.9.1 원칙 2) | R1과 같은 스크립트(07 I4), ESLint |
| R8 | `packages/runtime/src/adapter/**`는 `domain`과 같은 폴더 안 상대 경로만 import한다. 어댑터 계약이 쓰는 중립 타입은 `@helm/domain/src/adapter-contract.ts`에 둔다(§3.4.2). `tools`·`runtime` 내부 타입을 쓰지 않는다 | `check-architecture.ts` |
| R9 | 다른 패키지의 내부 경로를 import하지 않는다(`@helm/x/src/...`, 상대 경로로 패키지 밖 파일 참조 금지). 각 패키지 `exports`에 적은 진입점만 쓴다 | `package.json` `exports`(Node 모듈 해석에서 거부됨), ESLint 패턴 금지 |
| R10 | 패키지 사이 순환 의존 금지 | `tsc -b` 프로젝트 참조(순환이면 오류) + `check-architecture.ts` 그래프 검사 |
| R11 | 각 패키지 `tsconfig.json`의 `references`는 그 패키지의 워크스페이스 의존과 같다 | `check-architecture.ts` |
| R12 | 앱(`desktop`, `mobile`, `tui`, `cli`)과 L6c 패키지(`client`, `client-react`, `ui-language`, `ui-tokens`, `ui`)는 `kernel`, `engine`, `runtime`, `daemon`을 import하지 않는다 | R1 |
| R13 | `engine` 밖에서 이벤트를 append하는 코드 경로가 없다. R2가 이 규칙의 구현이다 | R2 |
| R14 | 데스크톱 앱 안의 층: `apps/desktop/src/ui/`는 `sync`, `platform`, `@helm/client`를 import하지 않는다. `sync`만 `@helm/client`를 쓰고, `platform/tauri`만 `@tauri-apps/*`를 쓴다(20 §3.9.1, 21 UI-D01). 모바일 앱도 26이 같은 규칙을 둔다 | 앱의 ESLint `import/no-restricted-paths` |
| R15 | `@helm/observer`는 파일을 열 때 `fs` 감싸개 하나만 거친다(16 §3.2.1). 감싸개가 여는 경로는 관찰 디렉터리와 정본 읽기 연결(`@helm/store/read`, `@helm/store/aux`)뿐이다. 그 밖의 `/srv/volumes/helm` 경로 문자열과 `node:fs`의 직접 호출은 감싸개 밖에 둘 수 없다(18 §3.11.3의 06 요구) | `check-architecture.ts`(import 목록과 문자열 리터럴 검사) |
| R16 | 웹 변환 작업자(`packages/tools/src/web/convert-worker.ts`)는 네트워크 모듈(`node:net`, `node:http`, `node:https`, `node:tls`, `node:dns`, `node:dgram`, `undici`)과 전역 `fetch`를 import하거나 쓰지 않는다. HTML 파서와 변환 라이브러리(`linkedom`, `@mozilla/readability`, `turndown`)는 이 파일만 import한다([판정 J-190] (1), 13 §3.2.4) | ESLint `no-restricted-imports`·`no-restricted-globals`(파일 대상), `check-architecture.ts`(R6 소유 검사) |

#### 3.5.2 검사 스크립트

`scripts/check-architecture.ts`는 의존이 없는 TypeScript 스크립트다(Node 24의 타입 제거 실행, §3.12.2). 규칙 원본은 `scripts/architecture-rules.ts` 한 파일이다(§3.4.1 표를 코드로 옮긴 것). 문서와 코드가 어긋나지 않게, 이 표를 바꿀 때는 06 §3.4.1과 `architecture-rules.ts`를 같은 커밋에서 고친다.

```ts
// scripts/architecture-rules.ts (개요)
export const layers = {
  domain: 0, protocol: 0, kernel: 1, store: 2, engine: 3, ai: 3, agent: 3, tools: 3,
  runtime: 4, observer: 4, daemon: 5,
  client: 6.5, "client-react": 6.5, "ui-language": 6.5, "ui-tokens": 6.5, ui: 6.5,   // L6c
  cli: 6, tui: 6, desktop: 6, mobile: 6, testkit: -1, tests: -1,
} as const;
export type PkgName = keyof typeof layers;
/** 패키지 → 허용 의존. 값이 문자열 배열이면 그 하위 경로만 허용 */
export const allowed: Record<PkgName, Partial<Record<PkgName, true | readonly string[]>>> = {
  domain: {},
  protocol: { domain: true },
  kernel: { domain: true },
  store: { domain: true },
  engine: { domain: true, kernel: true, store: ["read", "write"] },
  // … §3.4.1 표 전체
};
export const externalOwners: Record<string, readonly PkgName[]> = {
  "better-sqlite3": ["store"],
  ws: ["daemon", "client"],          // client는 node 진입점에서만 (R6)
  react: ["ui", "client-react", "desktop", "mobile"],
  "@tauri-apps/*": ["desktop"],     // 앱 안에서는 platform/tauri만 (R14)
  pino: ["daemon", "observer"],
  "web-push": ["daemon"],         // daemon/src/push/만 (R6)
  "playwright-core": ["tools"],         // tools/src/browser/browserd.ts만 (R6)
  linkedom: ["tools"], "@mozilla/readability": ["tools"], turndown: ["tools"],   // tools/src/web/convert-worker.ts만 (R16)
};
```

동작:

1. `pnpm-workspace.yaml`에서 워크스페이스 패키지 목록을 읽는다.
2. 패키지마다 `package.json`의 `dependencies`·`devDependencies`·`peerDependencies`를 읽어 R1, R3, R7을 검사한다.
3. `src/**/*.ts`, `test/**/*.ts`를 읽고 `typescript` 컴파일러 API의 `ts.preProcessFile(text, true, true)`로 import·export·동적 import 지정자를 뽑아 R2, R3, R6, R8, R9를 검사한다(번들러나 별도 의존 없이 TypeScript 하나로 처리한다).
4. 워크스페이스 의존 그래프를 만들고 순환을 찾는다(R10). `tsconfig.json`의 `references`와 비교한다(R11).
5. 위반을 `파일:행 규칙번호 설명` 형식으로 모두 출력하고, 하나라도 있으면 종료 코드 1로 끝난다. 검사할 파일을 읽을 수 없으면 종료 코드 2(환경 문제)다.

이 스크립트도 테스트를 가진다: `scripts/test/check-architecture.test.ts`가 위반 사례를 담은 작은 가짜 워크스페이스(`scripts/test/fixtures/`)로 규칙마다 실패를 확인한다(§6 완료 기준).

#### 3.5.3 ESLint 설정

ESLint flat config(`eslint.config.js`) 하나에서 패키지별로 금지 import와 전역을 건다. 개요:

```js
// eslint.config.js (발췌)
const pure = ["packages/domain/**", "packages/protocol/**", "packages/kernel/**", "packages/observer/src/metrics/**", "packages/observer/src/ipc/**",
              "packages/client/src/!(node)/**", "packages/client-react/**", "packages/ui-language/**", "packages/ui-tokens/src/**", "packages/ui/**"];
export default [
  ...tseslint.configs.strictTypeChecked,
  { files: pure.map((g) => `${g}/*.ts`),
    rules: {
      "no-restricted-imports": ["error", { patterns: [
        { group: ["node:*"], message: "R4: 순수 패키지는 Node 모듈을 쓰지 않는다" },
        { group: ["@helm/*/src/*"], message: "R9: 내부 경로 import 금지" },
      ] }],
      "no-restricted-globals": ["error", "process", "Buffer", "__dirname", "require"],
    } },
  { files: ["packages/kernel/**/*.ts"], ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-properties": ["error",
        { object: "Date", property: "now", message: "R5: 시각은 KernelContext.now로 받는다" },
        { object: "Math", property: "random", message: "R5: ID·난수는 KernelContext로 받는다" }],
      "no-restricted-syntax": ["error",
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: "R5" }],
      "no-restricted-globals": ["error", "crypto", "setTimeout", "setInterval", "console"],
    } },
  { files: ["packages/!(store)/**/*.ts", "apps/**/*.ts", "apps/**/*.tsx"],
    rules: { "no-restricted-imports": ["error", { paths: [{ name: "better-sqlite3", message: "R6: SQLite는 store만" }] }] } },
  { files: ["packages/tools/src/web/convert-worker.ts"],   // R16
    rules: {
      "no-restricted-imports": ["error", { patterns: [
        { group: ["node:net", "node:http", "node:https", "node:tls", "node:dns", "node:dgram", "undici"], message: "R16: 변환 작업자는 네트워크를 쓰지 않는다" },
      ] }],
      "no-restricted-globals": ["error", "fetch"],
    } },
  { files: ["packages/*/test/unit/**/*.ts", "packages/*/test/property/**/*.ts", "tests/scenarios/**/*.ts"],   // 22/ST-02
    rules: {
      "no-restricted-globals": ["error", "setTimeout", "setInterval"],
      "no-restricted-properties": ["error",
        { object: "Date", property: "now", message: "22/ST-02: 결정적 테스트는 manualClock을 쓴다" },
        { object: "Math", property: "random", message: "22/ST-02: 결정적 테스트는 seededRandom을 쓴다" }],
    } },
  { ignores: ["vendor/**", "legacy/**", "experiments/**", "**/dist/**"] },
];
```

- 위 마지막 두 블록은 R16과 22/ST-02(테스트 위생)다. 고정 포트 금지(22/ST-02)는 `listen`에 숫자 리터럴을 넘기는 호출을 `no-restricted-syntax`로 막는다. 셀렉터는 구현 때 시험한다.
- `vendor/`는 ESLint·Prettier 대상에서 뺀다. 업스트림과 diff를 비교하기 쉽게 원래 형식을 유지한다(07이 vendor 수정 규칙을 정한다).
- 타입 정보가 필요한 규칙(`strictTypeChecked`)은 `just lint` 전체 실행에서만 켜고, 파일 하나 검사(`just check <file>`, 템플릿 `node.just`)는 빠른 규칙만 쓴다. 느린 규칙 때문에 편집 훅이 늦어지지 않게 하기 위해서다 [제안].

#### 3.5.4 pnpm과 TypeScript 설정으로 지키는 것

- pnpm은 각 패키지의 `node_modules`에 선언한 의존만 연결한다. 선언하지 않은 패키지는 import가 해석되지 않는다 [지식]. 따라서 R1 검사를 통과한 `package.json`이 곧 import 가능한 범위다. `.npmrc`에서 `shamefully-hoist`를 켜지 않는다.
- 각 패키지의 `exports`는 명시한 진입점만 연다(와일드카드 `"./*"` 금지). Node 해석이 `@helm/x/src/...` 같은 깊은 import를 거부한다(R9).
- 루트 `tsconfig.json`은 모든 패키지를 `references`로 묶는 솔루션 파일이다. `tsc -b`는 참조 순환이 있으면 실패한다(R10) [지식].

### 3.6 프로세스 배치

#### 3.6.1 토폴로지 결정: 배치 C의 구조, 1차 구현은 데몬 내장 런타임 [제안, ADR-06-01]

대화 [156]~[157]에서 세 배치를 비교했다(extracts-4 17-4, 17-5, 대화 L4356–4382).

| 기준 | A. Helm 서버 프로세스 안에서 런타임이 돈다 | B. Helm이 pi 확장으로 pi 프로세스 안에서 돈다 | C. Helm 데몬이 상태를 맡고 런타임은 붙었다 떨어지는 실행기 |
|---|---|---|---|
| 터미널·클라이언트를 닫아도 계속 실행 | 된다 | 안 된다(pi를 닫으면 멈춤) | 된다 |
| 다른 런타임 연결 | 세션 호스트를 새로 만들어야 함 | 어렵다 | 어댑터만 추가 |
| 벤더 중립 목표와의 거리 | 중간 | 멂 | 가장 가까움 |
| 복잡도 | 중간 | 낮음 | 높음(데몬-어댑터 통신, 데몬이 꺼졌을 때의 처리) |
| 브리프 결정과의 관계 | 결정 23(자체 런타임)과 맞음 | 결정 22(데몬 상주)와 충돌 | 결정 22·34와 맞음 |

결정: **C의 구조를 택하고, 1차 구현에서 붙는 런타임은 데몬 프로세스 안의 자체 런타임 하나로 둔다.**

- 구조는 C다. 상태(커널, 저장소, 스케줄러)를 소유하는 것은 데몬이고, 실행기는 런타임 어댑터 계약(§3.13)을 통해서만 데몬과 대화한다.
- 1차 어댑터(자체 런타임)는 데몬과 같은 프로세스에서 돈다. 그래서 1차 구현의 실제 모양은 A와 같다. 같은 프로세스라도 자체 런타임은 어댑터 계약과 `engine` 공개 API만 쓴다(§3.5 R13). "First-party Agent Runtime도 Kernel의 권한 검사를 우회할 수 없다"(canon §16.3)를 import 규칙으로 지키는 것이다.
- B는 쓰지 않는다. 결정 22(클라이언트 없이 계속)를 만족하지 못한다. pi CLI를 쓰고 싶은 경로는 이후 단계의 pi RPC 어댑터(결정 33)로 C 안에 들어온다.
- C의 대가로 대화가 적은 미결("데몬이 꺼졌을 때 외부 어댑터가 변경 도구를 막을지, 기록을 쌓아 둘지", extracts-4 17-7, d22)은 1차 구현에 해당하지 않는다. 외부 어댑터를 만들 때 13·17이 정한다. 이 문서의 기본값은 §3.13.5에 둔다.

#### 3.6.2 helmd의 운영 책임

canon-2 §1.5의 `helmd` 책임 7개를 브리프 구조에 맞춰 적는다. 번호 `DR-n`은 이 절 안에서만 쓰는 라벨이다(가설 ID H·V와 구별한다). `helmd`는 제품 의미(온톨로지)를 소유하지 않는 호스트이며, 의미는 `kernel`과 `engine`이 소유한다.

| 번호 | 책임 | 구현 위치 | 세부 소유 |
|---|---|---|---|
| DR-1 | 실행 환경 확인과 수명주기(시작, drain, 종료, 재시작 복구 호출, 크래시 루프 차단) | `daemon/src/lifecycle/` | 17 §3.4 |
| DR-2 | 행위자·세션 신원 발급(기기 토큰 검증, 연결별 주체) | `daemon/src/auth/` | 18 |
| DR-3 | 요청 인증과 크기·속도 제한(프레임 상한, 송신 대기 상한) | `daemon/src/listeners/`, `daemon/src/rpc/` | 18, 19 |
| DR-4 | 단일 writer 직렬화(잠금 파일 + 동기 `engine.submit`) | `store/admin` 잠금, `engine` | 09, 17 D17-01·02 |
| DR-5 | 어댑터 연결과 능력 목록(capability registry) | `runtime/src/adapter/` | 13 |
| DR-6 | 구독과 변경 스트림(`{storeId, seq}` 재개, `lastSeq` 재전송) | `daemon/src/rpc/` + `engine.readAfter` | 19 |
| DR-7 | 백업·내보내기 조율 | `store/admin` + `daemon/src/ops/` | 17 §3.9 |
| DR-8 | 관찰 실행 감독기(fork, IPC, 시간 제한, 모델 호출 대행) [이 문서가 더함] | `daemon/src/observer-supervisor.ts` | 16 §3.2, 17 D17-15 |

#### 3.6.3 프로세스 목록

| 프로세스 | 실행 파일 | 누가 띄우나 | 수명 | 어디서 | 통신 | 죽었을 때 |
|---|---|---|---|---|---|---|
| Helm 데몬 | `helmd`(릴리스의 실행 래퍼, 17 §3.10) | systemd 사용자 단위 `helmd.service`(17 D17-05. 이 서버는 `Linger=yes`이고 homelab도 사용자 유닛을 쓴다 [실험 `loginctl show-user`, `~/.config/systemd/user/`]) | 상주. 데이터 디렉터리마다 하나(정식, 개발) | WSL | 리스너 셋(§3.8), 자식 프로세스 파이프·IPC | systemd가 다시 띄우고(`Restart=on-failure`, 환경 오류 코드 제외), 데몬은 시작 때 복구를 실행한다(결정 30, §3.6.6) |
| 도구 자식 프로세스 | `bash`, `rg`, `fd`, `git` 등 | `tools`(데몬 안). 격리 실행 방식(`systemd-run --user` 범위 단위, bubblewrap 등)은 13·18이 정한다(17 §3.1.3 표) | 도구 호출 하나 | WSL | stdio 파이프 | 호출은 오류 결과로 끝난다. 데몬이 죽으면 실행 의도 기록의 pid·시작 시각으로 재시작 때 고아를 찾는다(12, 13, 17 §3.4.2) |
| codemode 실행기 | 워커 스레드 + QuickJS | `tools`(pi-codemode, pi-facts-1 §0-11) | 스크립트 한 번 | 데몬 프로세스 안의 스레드 | 메시지 포트 | 스크립트 실패로 끝난다 |
| 무거운 읽기 작업 | 워커 스레드 + 읽기 전용 연결 | 데몬(전체 해시 체인 검증, 백업 검증, 진단 묶음) | 작업 한 번 | 데몬 프로세스 안 | 메시지 포트 | 작업 실패로 기록 (17 D17-01) |
| 관찰 에이전트 | `@helm/observer`의 `dist/main.js` | 데몬 감독기가 `child_process.fork`(16 §3.2.1). 동시에 하나만 | 작업 한 번(시간 제한은 16 §3.19) | WSL | Node IPC(제출·모델 호출 대행), SQLite 읽기 전용 리더 | 그 회차가 실패로 기록된다. 다음 회차가 커서(정본 아님, §3.9.1)부터 다시 읽는다 |
| 웹 본문 변환 작업자 | `@helm/tools`의 `dist/web/convert-worker.js`(`node`) | `tools`(데몬 안, `web_fetch` 호출마다) | 도구 호출 하나 | 샌드박스 S1, `network: 'none'`, 쓰기 루트 없음, 메모리·시간 상한(17 §3.13) | 표준 입출력(받은 바이트와 옵션을 넣고 본문 하나를 받는다) | 시간 초과와 실패는 `web.*` 오류 결과로 끝난다. 데몬이 작업자를 끊는다 |
| 브라우저 실행기 `helm-browserd` | `@helm/tools`의 `dist/browser/browserd.js`(`node`, `playwright-core`) | `tools`(브라우저 세션을 열 때). 시작은 17 §3.1.3의 `systemd-run --user` 단위 방식을 쓴다 | 브라우저 세션 하나(run 종료, 유휴 10분, 데몬 종료에 닫힌다) | 샌드박스 S1, 프록시 네임스페이스(`network: 'proxy'`), 비밀 없음 | 데몬과는 표준 입출력의 JSON 줄, Chrome과는 `--remote-debugging-pipe`(포트를 열지 않는다) | 상호작용 호출은 `outcome: uncertain`, 나머지는 오류 결과. 재시작 뒤 자동으로 다시 실행하지 않는다(13 T-BR-05) |
| 프록시 중계기 `helm-netshim` | `packages/tools/bin/helm-netshim`(정적 실행 파일, 13 U-TL-16) | `tools`(네트워크를 허용한 실행마다 샌드박스 안에서 시작) | 실행 하나 | 샌드박스의 네트워크 네임스페이스 | `127.0.0.1:3128` → 데몬 쪽 실행별 Unix 소켓(§3.7.4 9번) | 연결 실패는 그 요청의 오류다 |
| 비밀 내보내기 | `secrets run <scope> -- helm-secret-export` | 데몬 시작 단계와 `helm ops reload-secrets`(판정 45, 17 §3.8) | 시작 때 한 번 | WSL | 표준 출력 파이프(JSON 한 줄. 데몬이 SecretStore에 넣고 버퍼를 지운다) | 시작 단계 실패(종료 코드 2) |
| 외부 런타임 프로세스 (이후 단계) | `pi --mode rpc`, Claude Code, Codex app-server 등 | 해당 어댑터 | WorkUnit 하나 또는 세션 하나 | WSL | 각 런타임의 RPC·SDK·훅 | 어댑터가 능력 목록에 적은 수준으로 처리한다(§3.13) |
| 모바일 클라이언트 (이후 단계) | iPhone 홈 화면 웹 앱(Safari 엔진) [결정 47, 49] | 사용자 | 보일 때만 연결하고 숨겨지면 닫는다(26 MOB-D04) | iPhone | `tailnet` 리스너의 `/rpc`·`/m/*`·`/files/*`, 데몬 → Apple 푸시 서비스 Web Push | 데몬 쪽 작업은 영향 없다 |
| 데스크톱 앱 | Tauri 앱 | 사용자 | 사용자 마음대로 | Mac, Windows | 경로 ① WSS 또는 경로 ② `ssh -W`(§3.8). Rust가 바이트 연결, 웹뷰가 JSON-RPC(20 APP-D02) | 데몬 쪽 작업은 영향 없다(결정 22) |
| SSH 클라이언트 | 시스템 OpenSSH `ssh -W 127.0.0.1:7841 server` | 데스크톱 앱의 Rust 쪽 | 연결 동안 | Mac, Windows | 표준 입출력 = TCP 바이트 스트림 | 앱이 재연결한다 |
| TUI (이후 단계) | `@helm/tui` | 사용자(SSH 셸) | 세션 동안 | WSL | `local` 리스너(Unix 소켓) | 같음 |
| 관리 CLI | `helm` | 사용자, just 레시피, systemd `ExecStartPost` | 명령 하나 | WSL | `local` 리스너. 오프라인 명령은 데몬이 멈춘 상태에서 잠금을 잡고 DB 직접(17 §3.15) | 같음 |

`helmd`가 모델 API를 직접 부르는 유일한 상주 프로세스다. 관찰 에이전트도 모델 호출을 데몬에 맡긴다(관찰의 모델 판정·제안은 2단계 기능이라 `features.flags`로 기본 꺼짐, 판정 J-07). 클라이언트는 모델을 부르지 않는다.

자원과 가용성 요구 [01 NFR-C-4, NFR-A-5]:

- 데몬의 상시 자원: 대기 중 CPU 2% 이하, 상주 메모리 1 GB 이하(도구 자식 프로세스 제외). WSL 메모리 상한 10 GB를 다른 서비스와 나눠 쓴다. 구조로 지키는 방법은 세 가지다. (1) 대기 중에 도는 것은 스케줄러의 다음 깨어날 시각 타이머 하나와 리스너뿐이다. 주기적 폴링을 두지 않는다(타이머는 `pendingTimers`에서 계산, 10 §3.1.4). (2) 커널 상태(`KernelState`)는 메모리에 두지만 스냅숏과 투영으로 줄이고, 투영 캐시 크기를 설정 `limits`에 둔다. (3) 도구 자식은 별도 슬라이스(`helm-tools.slice`, 17 §3.3.2 `ToolsExecConfig`)에서 돌아 데몬의 메모리 집계에 들어가지 않는다. 측정은 17의 `helm status`(RSS, 이벤트 루프 지연)와 22의 성능 시험(대기 10분 CPU 평균, RSS 상한)이 한다. systemd 단위의 `MemoryHigh`·`MemoryMax` 값은 17 §3.6.4가 정한다.
- 이중화와 다른 서버로 넘기기는 하지 않는다. 서버 한 대가 내려가면 Helm도 멈춘다. 구조는 데몬 하나, DB 하나, 쓰는 프로세스 하나다(ADR-06-01, ADR-06-05).

#### 3.6.4 배치 그림

```text
┌─ WSL2 ──────────────────────────────────────────────────────────────────────────────┐
│ helmd (Node 24, 단일 프로세스, 단일 writer)                                          │
│  ┌ listeners ─────────────────┐  ┌ rpc ────────────┐  ┌ engine ───────────────────┐   │
│  │ tailnet  127.0.0.1:7840    │─►│ 인증된 연결      │─►│ submit / transact (동기)   │   │
│  │ loopback 127.0.0.1:7841    │  │ JSON-RPC 처리기  │  │ query / readAfter / 구독   │   │
│  │ local    rpc.sock          │  └─────────────────┘  └────┬────────────▲─────────┘   │
│  └────────────────────────────┘                            │ directive  │ submit      │
│        인증은 리스너 단계에서 끝낸다                          ▼            │             │
│  ┌ runtime ─────────────────────────────────────────────────────────────────────┐   │
│  │ 오케스트레이터 · WorkUnit 실행기 · 스케줄러 · 복구 · 컨텍스트 투영 · 탐구 엔진  │   │
│  │ adapter 계약 ── firstPartyAdapter ── agent(루프) ── ai(모델) ── tools(도구)    │   │
│  └───────────────────────────────────────────────┬──────────────────────────────┘   │
│  observer-supervisor ─ fork + IPC ─┐               │ 자식 프로세스(격리: 13·18)        │
│        store/write (better-sqlite3) ◄── engine만   ▼                                  │
│                    │                     bash · rg · git …                            │
│                    ▼                                                                  │
│     /srv/volumes/helm/data/helm.sqlite (WAL) ◄─ 읽기 전용 ─ @helm/observer (fork 자식) │
│ helm (CLI) · TUI ── local 리스너(rpc.sock) ──► helmd                                   │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

#### 3.6.5 데몬 안의 실행 모델

- 데몬은 Node 프로세스 하나다. 메인 이벤트 루프에서 JSON-RPC 처리, `engine.submit`(동기), 모델 스트리밍(비동기 I/O), 도구 자식 프로세스 감시가 함께 돈다(17 D17-01).
- `engine.submit`·`engine.transact`는 동기 함수다. 트랜잭션 안에서 `await`하지 않으므로 JavaScript 이벤트 루프 안에서 두 쓰기가 섞이지 않는다. 이것이 단일 writer 직렬화(DR-4)의 구현이다 [제안].
- 트랜잭션 안에서는 I/O(모델 호출, 파일 읽기, 네트워크)를 하지 않는다. 필요한 값은 트랜잭션 전에 모아 입력으로 넣는다. 트랜잭션이 길어지면 모든 클라이언트와 런타임이 멈추기 때문이다. 목표는 명령 하나의 트랜잭션이 p99 10 ms 이하다 [가정, 22가 성능 시험으로 확인]. 이벤트 루프 지연 감시는 17 §3.4.7.
- 큰 읽기(재전송, 내보내기)는 `limit`으로 잘라 여러 번에 나눠 읽고, 사이에 이벤트 루프를 양보한다. 전체 해시 체인 검증, 백업 검증, 진단 묶음은 워커 스레드의 읽기 전용 연결에서 돈다(17 D17-01).
- CPU를 오래 쓰는 일(codemode 스크립트)은 워커 스레드에서 돈다. 다른 CPU 작업(큰 diff, 토큰 계산)이 측정상 문제가 되면 워커로 옮긴다. 처음부터 워커 풀을 두지 않는다 [제안].
- 스트리밍 중인 모델 출력(델타)은 정본 로그에 넣지 않는다. 클라이언트에는 seq가 없는 휘발 알림(`stream.chunk`, 19 P-08)으로 보내고, 정본에는 완성된 메시지만 남긴다. pi-fabric이 델타를 커밋하다가 저널이 급증해 순서 마커만 커밋하도록 바꾼 기록이 근거다 [원문 `pi-cases-notes.md` §12.1-6, §13.2]. 정본 기록 시점은 12가 정한다.

#### 3.6.6 단일 writer 잠금, 시작·종료 순서, 종료 코드

세부와 시간 제한은 17이 소유한다(17 §3.1.4, §3.4). 06은 구조상 지켜야 할 점만 적는다.

- 단일 writer 잠금: 데이터 디렉터리의 `helmd.lock`이라는 별도 SQLite 파일에 배타 쓰기 트랜잭션(`BEGIN EXCLUSIVE`)을 프로세스 수명 동안 잡는다. 함수는 `@helm/store/admin`의 `acquireInstanceLock`이다(§3.4.5). 09 D09-7도 이 잠금으로 바꿨다(판정 §2). 프로세스가 죽으면 운영체제가 잠금을 해제한다. pid 파일과 오래된 잠금 정리가 필요 없다(17 D17-02). happy-agent(`<db>.lock` 형제 파일)와 pi-fabric(`lease.sqlite`에 `BEGIN EXCLUSIVE`)이 같은 방식을 쓴다 [원문 `pi-cases-notes.md` §1-4, §12.1-4]. 정본 DB 자체에 오래 열린 트랜잭션을 두지 않는 이유는 WAL 체크포인트가 끝나지 못하기 때문이다 [지식]. 정본 DB에 `locking_mode=EXCLUSIVE`를 쓰지 않는 이유는 관찰 에이전트와 워커의 읽기 전용 연결이 막히기 때문이다 [지식].
- 시작 순서의 정본은 17 §3.4.2다. 단계 번호는 그 표를 따른다(0은 신호 처리기 설치): 1 설정 → 2 경로 → 3 잠금 → 4 비밀 → 5 DB 열기 → 6 다운그레이드 검사 → 7 무결성 tail → 8 마이그레이션 → 9 투영 따라잡기 → 10 `bootEpoch` 발급과 `daemon.booted` → 11 고아 정리 → 12 런타임 복구(12 `RuntimeLifecycle.recover`) → 13 오케스트레이터 → 14 스케줄러 → 15 리스너 → 16 `ready`와 재개 예약. 06이 요구하는 구조 조건은 두 가지다.
  1. 상태 디렉터리의 파일 시스템이 9p/drvfs(`/mnt/c`)나 네트워크 파일 시스템이면 시작하지 않는다(브리프 §2.5 "WSL ext4 영역", 17 §3.2.3).
  2. 리스너는 복구가 끝난 뒤에만 연다. 클라이언트가 복구 전 상태를 보지 않게 하기 위해서다.
- 종료 순서(17 D17-06): 새 요청 거절 → 스케줄러 정지 → 진행 중 실행 유예 → 도구 프로세스 정리 → 마지막 이벤트·체크포인트 → 잠금 해제. 끝나지 않은 도구 호출은 "중단됨"으로 기록한다.
- 데몬 종료 코드는 17 §3.4.5가 정한다: 0 정상, 1 예상하지 못한 오류(재시작), 2 환경 문제(설정·경로·파일 시스템·비밀·포트, 재시작 안 함), 3 다른 `helmd`가 잠금을 가지고 있음, 4 DB 스키마가 코드보다 새로움, 5 DB를 열 수 없음. 2를 환경 문제로 쓰는 것은 사용자 규칙(just 종료 코드 2)과 같다.

#### 3.6.7 웹·브라우저 도구의 프로세스 층 [결정 55 / 판정 J-190, 배치 세부는 제안]

```text
helmd (데몬 안의 도구 호출기)
  ├ web_fetch  : 데몬이 직접 받는다. 주소 판정, 리디렉션마다 재판정, 해석한 IP에 연결 고정
  │   └ 변환 작업자 (S1, network 'none', 쓰기 루트 없음): 받은 HTML을 본문 마크다운으로 바꾼다
  ├ web_search : 데몬이 제공자 API를 부른다. 키는 데몬의 SecretStore에만 있다
  └ 브라우저 세션 (실행마다 helm-browser-<sessionId>, helm-tools.slice)
      S1 bwrap + --unshare-net
      ├ helm-netshim 127.0.0.1:3128 → 프록시 소켓 → 데몬의 CONNECT 프록시(호스트 판정)
      └ helm-browserd (Node, playwright-core, 비밀 없음)
          └ Chrome --remote-debugging-pipe, --proxy-server=http://127.0.0.1:3128
```

- 파서는 데몬 프로세스에서 돌지 않는다. 데몬이 받은 바이트는 변환 작업자의 표준 입력으로만 넘어간다. HTML을 해석하는 라이브러리는 변환 작업자 한 파일만 import한다(R16).
- 판정은 두 겹이다. 프록시는 CONNECT의 호스트만 보고 차단 대역과 `net:<host>`·`net:public`을 가린다(§3.7.4 9번). browserd는 요청 가로채기로 메서드와 스킴을 본다. 비-GET 요청, 업로드, 합의 밖 호스트로의 이동은 `send`로 올려 권리 게이트에 묻는다(13 §3.10.1, [판정 J-190] (3)).
- 웹 내용을 본 run은 `taint.web` 표식을 받는다. 그 뒤의 `send`는 합의가 미리 허용했어도 사람에게 묻는다([판정 J-190] (3), J-91과 같은 방향).
- 웹과 브라우저의 출력은 신뢰할 수 없는 입력이다. 모델 문맥에는 `<untrusted>` 표식으로 감싸 넣고, 스크린샷은 최근 세 장만 남긴다([판정 J-190] (4), 12 PJ-7).
- 서버 측 `web_search`·`web_fetch`(Anthropic 제공)는 MVP에서 쓰지 않는다. 두 도구는 `encrypted_content` 왕복과 `pause_turn` 처리를 요구해 제공자 중립 계약을 깬다([판정 J-190] (5), [검색]).
- 단계: 웹 읽기는 MVP다. 브라우저 읽기 멤버는 MVP 후반 1단계, 상호작용 멤버와 요청 가로채기는 2단계다(13 §3.2.6). 컴퓨터 사용(`computer_*`, 실행마다 새 Xvfb를 S1 안에 띄운다)은 이후 1차 단계다. 그 단계의 격리 구조는 그때 이 절을 고쳐 붙인다.
- S0에서는 `web_fetch`와 브라우저 도구를 묶음에서 뺀다(13 §3.2.4·§3.2.5). 구현 전 스파이크는 23이 맡는다([판정 J-190] (7)).

### 3.7 프로세스 사이 통신

#### 3.7.1 통신 표

| 보내는 쪽 → 받는 쪽 | 전송 | 형식 | 인증 | 순서·재전송 | 세부 소유 |
|---|---|---|---|---|---|
| 데스크톱 앱 → helmd (경로 ①) | WSS → `tailscale serve` → HTTP/WS `tailnet` 리스너 127.0.0.1:7840 | JSON-RPC 2.0 [제안: 결정 31 기본값] | 기기 토큰(`Authorization: Bearer`, 필수) + Tailscale 신원 헤더와 whois 대조 [제안: 결정 26 기본값. 19 P-03, 17 §3.5] | 서버 이벤트에 단조 seq, 재접속 시 `{storeId, seq}`부터 | 18, 19 |
| 데스크톱 앱 → helmd (경로 ②) | `ssh -W 127.0.0.1:7841 server`의 표준 입출력 = TCP 바이트 스트림 → `loopback` 리스너 | 같은 HTTP + WebSocket, 같은 JSON-RPC [결정 38. 19 P-02] | SSH 키(전송) + 기기 토큰(필수, 20 APP-D04) | 같음 | 18, 19, 20 |
| 모바일 클라이언트 → helmd (이후 단계) | WSS → `tailscale serve` → `tailnet` 리스너(데스크톱 경로 ①과 같은 주소). 정적 묶음 `GET /m/*`, 페어링 `POST /m/pair`, `GET /m/whoami` | 같은 JSON-RPC [결정 42] | 쿠키 `__Host-helm_dt`(`credentialCarrier: cookie` 기기만, Origin 정확 일치, 18 §3.4.3) | 같음 | 26, 18, 19 |
| helmd → Apple 푸시 서비스 | HTTPS POST(Web Push, RFC 8291 암호화, VAPID 서명) | 문구 키만 담은 payload(26 §3.4.4) | VAPID 개인 키(`HELM_VAPID_PRIVATE_KEY`, SecretStore) | 재시도·실패 문턱은 26 §3.4 | 26, 18 |
| `helm`, TUI → helmd | WebSocket over Unix 소켓(`local` 리스너, `rpc.sock`) | 같음 | 소켓 파일 권한 + 로컬 관리자 주체(`local`에서만) 또는 기기 토큰(19 P-03) | 같음 | 18, 19 |
| helmd ↔ 관찰 에이전트 | Node IPC(`process.send`) | 16 §3.2.3 메시지(`kernel.submit`, `llm.complete`, `job.*`) | IPC 채널 자체가 신원이다. 데몬이 행위자를 `agent:observer`, 채널을 `aux_agent`(10 §3.3)로 고정한다. 클라이언트 프로토콜은 쓰지 않는다(판정 §2) | 요청-응답 | 16 |
| 관찰 에이전트 → SQLite | better-sqlite3 읽기 전용 리더(`query_only`) | SQL(`@helm/store/read`) | 파일 권한 | WAL 읽기 일관성 | 09, 16 |
| helmd 안: 처리기·runtime·감독기 → engine | 함수 호출 | `EngineInput` / `SubmitResult`, `transact` | 호출자가 행위자를 넣는다. 처리기는 연결의 주체로, runtime은 실행 중인 에이전트 역할로, 감독기는 `agent:observer`로 | 동기, 직렬 | 10, 12 |
| helmd 안: engine → runtime | 이벤트(`onDirective`) | `Directive` | - | 커밋 뒤, 커밋 순서대로 | 10, 12 |
| helmd 안: runtime ↔ 어댑터 | 함수 호출 + 비동기 신호 | 어댑터 계약(§3.13) | - | 어댑터별 | 13 |
| helmd → 도구 자식 | `child_process` (격리 실행 단위 안) | 인자·stdio | 실행 환경 격리(13·18) | - | 13 |
| helmd → 변환 작업자·helm-browserd | `child_process`(샌드박스 안), 표준 입출력 | 변환: 받은 바이트와 옵션 → 본문 하나. browserd: 명령 하나 → 응답 하나(JSON 줄) | 샌드박스 격리, 비밀 없는 환경(18 R-2, BR-4) | 요청-응답. 상호작용 호출은 크래시 뒤 `uncertain` | 13 §3.2.4·§3.2.5 |
| helm-browserd ↔ Chrome | CDP, `--remote-debugging-pipe`(포트 없음) | DevTools 프로토콜 | 같은 샌드박스 | - | 13 §3.2.5 |
| helmd → 모델 제공자 | HTTPS | 제공자 API(pi-ai) | API 키(데몬 메모리, §3.9.3) | 재시도는 `@helm/ai` 한 곳에서만(12 RT-9) | 07, 12 |
| 클라이언트 ↔ helmd 큰 데이터 | HTTP(같은 리스너). 데스크톱은 Rust가 `GET /files/b/<blobId>`에 기기 토큰 헤더를 붙이고 디스크 캐시를 둔다(경로 ②는 `ssh -W` 위 HTTP/1.1 keep-alive 연결 최대 2개, 20 §3.8.6). 모바일은 같은 출처 쿠키 | 바이트, 업로드 id / 다운로드 ticket(헤더를 붙일 수 없는 곳용, 19 P-13. 데스크톱은 쓰지 않는다) | 연결에 묶인 일회성 ticket [원문 `pi-cases-notes.md` §12.1-8] | - | 19 |

#### 3.7.2 프로토콜 처리기의 층

결정 38은 두 접속 경로에서 프로토콜 메시지와 재전송 의미가 같아야 한다고 정했다. 이를 구조로 보장하기 위해 데몬의 연결 처리를 세 층으로 나눈다 [제안, 19 P-01과 같은 모양].

```text
리스너(전송·사전 검사)                         인증층(hello에서 판정)       프로토콜층(전송을 모른다)
 tailnet  TCP 127.0.0.1:7840 (serve 전용)  ─┐
 loopback TCP 127.0.0.1:7841 (ssh -W 전용) ─┼─► Connection{주체, deviceId,  ─► JSON-RPC 처리기 ─► engine / runtime
 local    Unix rpc.sock (TUI·CLI)          ─┘      리스너 이름}                   구독·재전송
```

- 세 리스너는 같은 HTTP + WebSocket 스택을 쓴다. 다른 것은 연결 수락 직후의 리스너별 사전 검사(Host·Origin, 신원 헤더)와 허용하는 주체 종류뿐이다(17 §3.5, 19 §3.2.1, 18).
- SSH 경로도 바이트는 HTTP/1.1 + WebSocket이므로 별도 프레임 형식이 없다(19 P-02). 이 문서의 1차 초안에 있던 "stdio 프레임 전송"은 두지 않는다.
- 인증은 프로토콜 처리기에 들어가기 전에 끝난다. 처리기는 인증된 `Connection`만 받는다. pi-server가 같은 경계를 쓴다(`server/src/listener.ts:3-8` "Supplies established byte connections after any required transport authentication") [원문 pi-facts-2 §0-3, §4.2]. hello 안에서 자격 증명을 판정하는 방식(paseo `hello.rejected{reason}`, 19 P-03)도 hello 처리는 인증층에 속하고, 실패한 연결은 프로토콜층으로 넘기지 않는다 [원문 `pi-cases-notes.md` §12.1-7].
- 프로토콜층의 처리기는 한 벌이다. 리스너별 분기는 리스너와 인증층에만 있다. 이것을 테스트로 고정한다: 같은 대본을 세 리스너에서 돌려 같은 응답·이벤트 열이 나와야 한다(§6, 19 적합성 시험, 22).

#### 3.7.3 세 방향

canon-2 §1.4의 방향 구분을 따른다.

| 방향 | 무엇이 흐르나 | 경로 |
|---|---|---|
| Northbound | 사람 명령·조회(클라이언트), 관찰 에이전트 제안, 외부 어댑터의 관찰 후보 | 클라이언트 → 프로토콜 → `engine.submit`/`query` |
| Southbound | 런타임 안에서 일어난 일(메시지 완료, 도구 호출 요청·결과, 실행 종료)을 중립 어휘로 정규화한 신호 | 어댑터 → `runtime` → 관찰 후보·제안으로 `engine.submit` |
| Control | 커널 판정 결과(허용·거부·질문 필요), 컨텍스트 무효화, 중지·취소 요청, 클라이언트 알림 | `engine` 지시 → `runtime` → 어댑터 / `engine.onCommitted` → 구독 클라이언트 |

하나의 채널(예: MCP 서버 하나)로 세 방향을 모두 만들지 않는다(canon-2 §1.4).

#### 3.7.4 같은 OS 사용자로 도는 도구가 사람 권한을 얻는 경로 [판정 46]

루프백 바인딩은 격리 경계가 아니다 [판정 46]. 도구 자식 프로세스(bash 등)는 데몬과 같은 OS 사용자로 돈다. `networkingMode=mirrored`에서는 Windows 쪽 프로세스와 WSL의 모든 프로세스가 127.0.0.1 포트에 붙을 수 있다. 아무 장치가 없으면 모델이 실행한 bash가 `rpc.sock`(로컬 관리자 주체를 받는 리스너)이나 127.0.0.1:7840·7841에 접속해 사람 명령(예: 결과 확인)을 보낼 수 있다. 이것은 "결과 확인은 사람만"(결정 15 (2), A6)을 우회하는 경로다. 그래서 다음을 구조 요구로 둔다 [판정 46. 세부는 13 §3.6, 18 D18-04].

1. 모든 리스너가 자격 증명을 요구한다. 출발지 주소(127.0.0.1)를 신뢰 근거로 쓰지 않고, loopback이면 자동 승인하는 방식을 두지 않는다. serve 뒤의 데몬에는 원격 요청도 127.0.0.1에서 오기 때문이다 [원문 `pi-cases-notes.md` §12.2-8, 20 §3.8 두 경로의 인증]. `tailnet`·`loopback` 리스너는 기기 토큰이 필수이고, `local` 리스너는 소켓 파일 권한과 로컬 관리자 주체(아래 2)를 쓴다.
2. 소켓 파일 권한을 근거로 한 로컬 관리자 주체는 `local` 리스너에서만 받는다(19 P-03). 이것이 안전하려면 도구 자식 프로세스가 `rpc.sock`과 그 디렉터리(`$XDG_RUNTIME_DIR/helm/`), 데이터 디렉터리(`/srv/volumes/helm/`), 설정 디렉터리(`~/.config/helm/`)를 볼 수 없어야 한다. 도구 실행 격리(13·18이 정한다. 17 §3.1.3의 `systemd-run --user` 범위 단위 `InaccessiblePaths=`, bubblewrap 마운트 네임스페이스 등)가 이 경로들을 가린다.
3. 사람 권한 자격 증명은 도구가 읽을 수 없는 곳에 둔다. 데스크톱 기기 토큰은 클라이언트 기기의 OS 키체인(Rust 쪽)에 있어 서버의 도구가 읽을 수 없다(20 APP-D02).
4. 격리 수단(bubblewrap, 없으면 `systemd-run --user` 일회성 단위)을 모두 쓸 수 없으면 `execute` 원시 행동을 끈다. 격리 없음(S0)은 운영자 설정 `tools.sandbox="off"`로만 허용하고, 그때마다 감사 기록과 상태 경고를 남긴다(18 R-10, ADR-13-01). 그래서 격리 없이 도구가 `rpc.sock`에 접속할 수 있는 상태는 운영자가 명시적으로 고른 경우뿐이다. 그 상태는 능력 목록에 `advisory`로 적고 화면에 표시한다(§3.13.4, canon-2 §1.20 "Enforcement honesty").
5. 외부 런타임(이후 단계 어댑터)에 Helm 제안 도구를 MCP 등으로 열 때는 기기 토큰을 쓰지 않는다. run 단위 단기 토큰을 쓰는 주체 `runtimeAdapter{runId}`를 두고, scope는 `model_tool` 채널 제출과 그 run의 조회뿐이다. 사람 결정 명령은 채널 검사에서 `denied.channel`로 거부된다(10 ADR-K5). 외부 런타임은 샌드박스 밖에서 돌므로 사람 주체 자격 증명을 그 설정에 넣지 않는다 [제안, 주체·토큰 규칙은 18, scope 표는 19, 어댑터 쪽은 13].
6. 관찰 에이전트는 IPC 채널로만 제출하고 데몬이 행위자를 `agent:observer`로 고정한다(16 §3.2.3 규칙 3). 관찰 프로세스는 소켓이나 토큰을 쓰지 않는다.
7. 도구 자식의 환경에는 비밀이 아닌 허용 목록 변수만 넣는다(`HELM_RUN_ID` 등). 허용 목록은 18이 정한다(판정 J-17). 데몬 자신의 `process.env`에도 비밀이 없다(판정 45, 17 §3.8).
8. `local` 리스너의 로컬 관리자 주체가 사람 결정을 보내려면 TUI 또는 TTY가 붙은 CLI에서 확인 문자열을 입력해야 한다. 비대화 localAdmin은 읽기와 관리만 한다 [판정 J-135]. 같은 OS 사용자의 의도적 공격까지 막지는 못한다는 한계는 18이 적는다.
9. 네트워크를 허용한 도구 실행도 네트워크 네임스페이스를 분리하고, 바깥 연결은 데몬 쪽 CONNECT 프록시만 통과시킨다. 프록시는 루프백·사설 대역·CGNAT·tailnet 주소를 막는다. 그래서 `--share-net` 같은 공유 네트워크로 데몬 리스너나 Caddy 관리 API에 접속하는 경로가 없다 [판정 J-134]. 데몬이 직접 여는 연결(`web_fetch`)과 브라우저 요청도 같은 차단 목록을 쓴다([판정 J-190] (2)). 스파이크가 실패하면 네트워크 허용 실행을 실행마다 사람 승인으로 하고 홈랩 H-5(Caddy 관리 API 정리)를 먼저 한다(13·18·23).

#### 3.7.5 대표 흐름

(a) 사람이 데스크톱 앱에서 결과를 확인한다.

```text
앱: client.command("result.accept", {…, basisSeq})            # @helm/client가 멱등 키를 만들고 진행 중 명령함에 먼저 저장
 → serve → helmd tailnet 리스너: 신원 헤더 확인 → hello에서 기기 토큰 검증 → 주체 = human, deviceId = dv_…
 → JSON-RPC 처리기 → engine.submit({kind:"command", channel:"human_client", actor: human, …})
     트랜잭션(store.commit에 decide 주입): 멱등 확인 → basisSeq 낡음 검사·kernel.decide → 이벤트 append(seq=N) → 투영 갱신 → commands 행에 결과 저장
 → engine.onCommitted(커밋한 턴 안에서 동기) → 구독 중인 모든 연결에 이벤트 seq=N 전송(앱, TUI)
 → 응답 {status:"accepted", seq:N}                              # 이벤트 알림이 응답보다 먼저 나간다(19 §3.5.9)
 → engine.onDirective → runtime (예: 통합 항목 생성 작업 시작)
```

(b) 모델이 쓰기 도구를 부른다(1차 런타임).

```text
agent 루프: 이벤트 싱크(subscribe 또는 저수준 루프의 emit)의 message_end → runtime → engine.transact(모델 메시지 실행 기록)
                                                                       # 커밋 뒤 도구 실행 시작(결정 28, 판정 J-14)
agent: beforeToolCall(write) → runtime → engine.submit({kind:"proposal", command: toolcall.intend})
     kernel: 활성 작업 합의·범위 확인 → accepted면 toolcall.requested·실행 의도 이벤트,
             rejected·needs_gate면 toolcall.blocked 또는 approval_requested + 사유(10 §3.1.4)
 → 허용: tools.write 실행 → afterToolCall → engine.submit({kind:"observation", command: toolcall.complete})
 → 거부: 도구 결과를 오류로 모델에 돌려준다(pi-facts-1 §3.5, 실험 exp1, 07 패치 A2의 rejection)
```

(c) 앱이 다시 연결된다.

```text
앱: 연결 → hello{…, resume: {storeId, seq: 1200}}        # 필드 이름은 19가 정한다(P-05)
helmd: storeId가 같고 1201부터 남아 있으면 → 1201..현재를 (from, to] 구간 알림으로 보내고 실시간으로 이어 감(19 P-06)
       storeId가 다르거나(복원된 DB) 보존 범위 밖이면 → `replay.outOfRange` → 앱은 뷰를 낡음으로 표시하고 head부터 다시 받음(20 APP-D08)
```

(d) 관찰 에이전트 한 회차.

```text
runtime 스케줄러: 관찰 트리거 → daemon 감독기가 @helm/observer를 fork(허용 환경 변수만, 비밀 없음)
관찰 프로세스: job.start 수신 → store/read로 Helm 기록 읽기 + 허용 폴더의 외부 세션 로그 증분 읽기
            → 결정적 마이닝 → IPC llm.complete(데몬이 모델 호출, 예산 적용) → IPC kernel.submit × n → job.finished → 종료
helmd: 감독기가 kernel.submit을 engine.submit(actor = agent:observer)으로 넘긴다. 시간 제한 초과면 SIGTERM, 10초 뒤 SIGKILL(16 §3.2.1)
```

### 3.8 접속 경로 두 가지 [결정 38]

#### 3.8.1 전체 그림

```text
              ┌─ 경로 ① Tailscale serve WSS ─────────────────────────────────────────────┐
 Mac/Windows  │ 앱(Rust) ──WSS──► tailnet ──► Windows 호스트 tailscale serve :8448 (TLS 종료)│
  데스크톱 앱  │                       └─HTTP/WS──► 127.0.0.1:7840 (mirrored) → tailnet 리스너 │
              └───────────────────────────────────────────────────────────────────────────┘
              ┌─ 경로 ② SSH ──────────────────────────────────────────────────────────────┐
              │ 앱(Rust) ── 시스템 OpenSSH `ssh -W 127.0.0.1:7841 server` ──► tailnet ──►   │
              │   WSL OpenSSH :22 (키 인증, direct-tcpip) ──► 127.0.0.1:7841 loopback 리스너 │
              │   표준 입출력 위에서 같은 HTTP + WebSocket (19 P-02, 20 APP-D03)            │
              └───────────────────────────────────────────────────────────────────────────┘
 WSL 셸(SSH) ─ TUI / helm ── local 리스너 rpc.sock ──► helmd   (TUI 경로, 결정 33·39)
```

모바일 클라이언트(결정 42)의 접속 경로와 앱이 꺼져 있을 때의 알림 경로는 26이 정한다. 어떤 경로를 고르든 메시지 형식, seq와 재전송 규칙, 오류 코드, 멱등 키 처리, 기기 인증은 두 경로와 같아야 한다(결정 38의 조건을 모바일에도 적용) [제안].

두 경로 모두 tailnet을 지난다. WSL OpenSSH 22번은 tailnet에서만 열려 있다 [원문 `homelab/context/machines.md` SSH 별칭 표]. 따라서 Tailscale이 끊기면 두 경로가 함께 끊긴다. 경로 ②는 `tailscale serve` 설정이 틀렸거나 serve가 멈췄을 때, 그리고 serve를 거치지 않는 전송 인증(SSH 키)으로 붙고 싶을 때의 대안이다.

#### 3.8.2 경로 ①: Tailscale serve WSS

| 항목 | 내용 | 확정 |
|---|---|---|
| URL | `wss://server.tail7ad0b4.ts.net:8448`(경로는 19) | 17 D17-09, 19 |
| serve 설정 | homelab `tailscale/serve.table` 한 줄 `8448  http://127.0.0.1:7840   helm` + `just serve-apply`. 데몬이 serve를 직접 실행·수정하지 않는다 [원문 `pi-cases-notes.md` §12.2-9] | 17 §3.7 |
| TLS | Windows 호스트의 `tailscale serve`가 ts.net 인증서로 끝낸다. 데몬은 평문 HTTP만 받는다 | 결정 26 |
| 인증 | 기기 토큰 필수. Tailscale 신원 헤더는 whois 대조와 함께 쓰는 추가 조건이다. 헤더는 같은 호스트의 아무 프로세스나 위조할 수 있으므로 단독으로 믿지 않는다 [원문 `pi-cases-notes.md` §12.1-7] | 18 |
| Origin | Tauri 웹뷰 origin만 허용 [지식, backend-oss §4]. 20 APP-D02에 따르면 WebSocket은 Rust가 열므로 origin 검사 대상은 Rust 쪽 요청이다 | 18, 20 |
| 이름 대안 | homelab은 `<이름>.stackmellow.com`을 Caddy(443 TCP 패스스루) 뒤에 두는 방식도 쓴다 [원문 `homelab/context/network.md` 서비스별 이름]. 기본값은 serve 포트(8448)다 | 17 |

#### 3.8.3 경로 ②: SSH

결정 38은 SSH 경로의 구체 방식과 인증을 P11·P12·P13이 정하라고 했다. 세 문서가 같은 방식을 골랐다: **B3, 시스템 OpenSSH의 `ssh -W 127.0.0.1:7841 server` 표준 입출력 위에서 경로 ①과 같은 HTTP + WebSocket을 쓴다**(19 P-02, 20 APP-D03, 17 D17-09). 06은 이 선택을 받아들이고 구조 조건만 적는다.

- `ssh -W`는 `host:port`만 받고 Unix 소켓을 가리킬 수 없다 [원문 19 §3.2.3, `man ssh`]. 그래서 SSH 전용 TCP 리스너 `loopback`(7841)을 따로 둔다.
- `loopback`을 `tailnet`과 나누는 이유: `tailnet`은 신원 헤더를 요구하는데 SSH로 들어온 연결에는 헤더가 없다. 한 포트에서 "헤더가 없으면 다른 규칙"을 허용하면 헤더 검사를 건너뛰는 길이 생긴다(17 §3.5, 18).
- 인증: SSH 키가 전송을 인증하고, 기기 토큰이 Helm 기기를 정한다(20 APP-D04). 기기 목록·폐기·기기별 재개 위치가 경로 ①과 같아진다.
- 06의 1차 초안은 exec 채널 + `helm bridge --stdio`를 추천했다. 19는 이것을 sshd의 TCP 포워딩을 막을 때의 예비 경로 B4로 두었다(바이트는 B3과 같은 HTTP + WebSocket, 들어오는 리스너는 `local`). 06은 이 구성을 따른다.

두 경로가 같아야 하는 것(결정 38): JSON-RPC 메시지 형식, 메서드 집합, 서버 이벤트 seq와 재전송 규칙, 오류 코드, 멱등 키 처리, 기기 인증. 달라도 되는 것: 리스너, 리스너별 사전 검사, 큰 데이터 요청의 연결 방식(경로 ②는 요청마다 `ssh -W` 하나, 20 APP-D12).

#### 3.8.4 TUI 경로

사용자는 `ssh server`로 WSL에 들어가 TUI를 실행한다 [결정 39]. TUI는 `local` 리스너(`rpc.sock`)로 데몬에 붙는다. pi-tui의 ESC 판정 대기는 `SSH_CONNECTION`/`SSH_TTY`가 있으면 100 ms로 늘어난다(`tui/src/terminal.ts:128-144`) [원문 pi-facts-2 §2.4]. pi CLI 자체를 쓰는 경로는 이후 단계의 pi RPC 런타임 어댑터로 연다(결정 33).

### 3.9 저장 경계

#### 3.9.1 데이터 종류별 위치

디렉터리 배치의 세부는 17 §3.2.2가 소유한다. 아래는 06이 정하는 "무엇이 정본이고 무엇이 아닌가"와 그 위치다.

| 데이터 | 위치 | 정본 여부 | 형식 | 세부 소유 | 백업 |
|---|---|---|---|---|---|
| 도메인 이벤트 로그(모든 레코드의 상태 변화, 거부 기록 포함) | `/srv/volumes/helm/data/helm.sqlite` | **정본** [제안: 결정 29 기본값] | SQLite WAL | 09 | 검증된 스냅샷 → restic(§3.9.4) |
| 투영 테이블(현재 상태, 화면용 읽기 모델) | 같은 DB | 정본 아님. 로그에서 다시 만들 수 있어야 한다 | SQLite | 09 | 같은 스냅샷 |
| 멱등 입력함(`commands`, 거부·충돌·게이트 결과 포함)·내부 소비자 커서(`consumer_cursors`) | 같은 DB | 운영 상태(재시도 결과 보존, 소비자 처리 위치). outbox는 없다(09 D09-5) | SQLite | 09, 10 | 같음 |
| 실행 기록(모델 메시지, 요청 manifest, 도구 입출력, 실행 의도·결과) | 같은 DB | 근거 원천(source evidence). pi 세션 파일을 쓰지 않는다 [제안: 결정 29 기본값]. 판단의 근거로 인용하는 것은 관찰 레코드뿐이다(12 §3.1) | SQLite | 09, 12 | 같음 |
| 실험 측정(지표 사실·스냅숏) | 같은 DB의 별도 범주 | 정본(측정 흐름). 도메인 원장과 섞지 않는다(§3.11.1) | SQLite | 16, 09 | 같음 |
| 기기 등록·토큰 해시 | 같은 DB의 별도 테이블 | 보안 상태 [제안, 18이 확정] | SQLite. 토큰은 해시만 | 18 | 같음(백업·덤프 제외 대상 목록은 18) |
| 큰 데이터(자극 이미지, 잘린 도구 출력 전문, 산출물 스냅숏) | `/srv/volumes/helm/data/blobs/sha256/…` | 정본 레코드가 해시로 참조하는 불변 파일 | 내용 주소 파일 | 09, 19 | restic(파일 그대로) |
| 데몬 설정 | `~/.config/helm/helmd.toml`(dotfiles에서 관리) + `helmd.local.toml`(미추적) | 정본 아님. 운영 설정 | TOML | 06 §3.10 | dotfiles 저장소 |
| 비밀(모델 API 키 등) | `~/projects/helm/secrets/<env>.sops.yaml` → 데몬 메모리 | 비밀 원본 | SOPS | 17 D17-07, 18 | homelab restic(`~/projects`) |
| 런타임에 바뀌는 도구 로그인(OAuth 갱신 토큰 등, 쓰기로 정하면) | `/srv/volumes/helm/` 아래 `secrets` 디렉터리(0700, 파일 0600) | 기기 계층 비밀(dotfiles `docs/SECRETS.md`의 "도구 로그인") | 파일 | 12, 18 (§7 O-08) | 제외(homelab 제외 패턴 `/srv/volumes/*/secrets`) |
| 관찰 에이전트 수집 커서·캐시 | `/srv/volumes/helm/observer/` | 정본 아님. 지워지면 다시 읽고 내용 해시로 중복을 거른다 | 16이 정함 | 16 | 제외 |
| 푸시 구독 원문(엔드포인트·키) | 같은 DB의 운영 테이블 `device_push` | 정본 아님(운영 상태). 이벤트와 Device에는 해시·끝자리만(판정 J-71) | SQLite | 26, 08, 09 | 같은 스냅샷 |
| 릴리스(빌드된 데몬·CLI·모바일 묶음 `web/mobile/`) | `/srv/volumes/helm/app/releases/<ID>/`, `current` 링크 | 정본 아님 | 디렉터리 | 17 §3.10, 26 §3.6.1 | 제외 |
| 운영 로그 | journald | 정본 아님 | JSON 줄 | §3.11, 17 | 제외 |
| 클라이언트 캐시(뷰 사본, 재개 위치, 진행 중 명령함) | 각 기기의 앱 저장소(IndexedDB) | 정본 아님 | 20이 정함 | 20 | 해당 없음 |
| 기기 토큰(클라이언트 쪽) | macOS Keychain, Windows Credential Manager | 클라이언트 비밀 | OS 키체인 | 18, 20 | 해당 없음 |
| 작업 대상 파일(코드, 글) | `~/projects/<제품>/…` | Helm 상태가 아니다. M 평면 산출물이며 레코드는 경로·해시·커밋으로 참조만 한다(extracts-3 X3-8-11) | 원래 형식 | 08 | homelab restic + Syncthing |
| 외부 에이전트 세션 로그 | `~/.pi/agent/sessions/…` 등 | Helm 입력(읽기 전용) | 각 런타임 형식 | 16 | 해당 없음 |
| 내보내기 | 사용자가 정한 경로 | 파생물 | JSONL(§3.9.5) | 09 | - |
| 백업 스냅샷 | `/srv/volumes/helm/backups/` | 파생물(검증됨) | SQLite 파일 + 매니페스트 | 17 D17-10 | restic |

환경별 분리(17 §3.14): 정식 데몬은 `/srv/volumes/helm/data`, 개발 데몬(`just daemon-dev`)은 `/srv/volumes/helm/dev` 아래 같은 하위 구조를 쓰고 잠금·소켓 디렉터리(`$XDG_RUNTIME_DIR/helm-dev`)와 `loopback` 포트(7851)가 다르다. 그래서 두 데몬이 같은 서버에서 함께 돌 수 있다.

#### 3.9.2 규칙

1. Helm 상태를 `~/projects` 아래에 두지 않는다. Syncthing이 SQLite 파일을 동기화하면 깨질 수 있다 [브리프 §2.5]. 이전 구현의 프로젝트 안 `.helm/` 폴더도 만들지 않는다.
2. 정본 DB는 WSL ext4에 둔다. `/mnt/c`(drvfs·9p)와 네트워크 파일 시스템을 시작 때 거부한다(§3.6.6 2단계).
3. DB 파일 0600, 상태 디렉터리 0700. Unix 소켓 디렉터리 0700, 소켓 0600.
4. 모든 프로젝트가 DB 하나를 쓴다 [제안, ADR-06-05]. v0.3 12 §15-2("워크스페이스당 SQLite 파일 하나 vs 전체 하나")에 대한 답이다. 17은 이것을 전제로 운영 절차를 쓰고 최종을 09에 맡겼다(17 §7 Q17-08). 이유:
   - 여러 프로젝트를 한 화면에서 보는 홈이 요구된다(audit §2 "A 작업에 몰입한 동안 B, C 프로젝트 상태를 한 곳에서", 대화 L298).
   - 클라이언트 재전송 seq가 하나면 `lastSeq` 하나로 모든 구독을 이어 받을 수 있다. 파일이 여럿이면 seq가 여럿이 된다.
   - 단일 writer, 백업, 무결성 검사, 마이그레이션이 한 번으로 끝난다.
   - 대가: 파일이 커진다. 1인 사용 규모에서 문제가 되는지는 22의 부하 시험과 17의 운영 지표로 본다. 커지면 오래된 원시 기록을 별도 보관 파일로 옮기는 방안을 17·09가 정한다.
5. 정본 DB에 쓰는 프로세스는 `helmd` 하나다. CLI의 오프라인 명령(마이그레이션 적용, 복구)은 데몬이 멈춰 있을 때만 같은 잠금을 잡고 실행한다(§3.6.6, 17 §3.15).
6. 투영은 정본을 쓰지 않는다(불변조건 3). 구조로는 투영 계산 함수가 `kernel`(순수)에 있고 쓰기 API를 import할 수 없는 것으로 지킨다(§3.5 R2).

#### 3.9.3 비밀의 흐름

판정 45(17 D17-07, ADR-17-3)를 따른다. 브리프 §2.5의 "just 레시피가 `secrets run`으로 자식 프로세스에만 주입"은 일회성 레시피에 적용되고, 상주 데몬은 아래 방식을 쓴다.

```text
~/projects/helm/secrets/prod.sops.yaml          (원본. 키 이름은 평문, 값은 암호화)
        │  helmd 시작 단계: `secrets run product:helm/prod -- helm-secret-export <키…>`를 자식으로 실행
        ▼
표준 출력 파이프 → helmd 메모리의 비밀 저장소(18 §3.10)   ← process.env·/proc/<pid>/environ에 남지 않는다
        │
        ▼
@helm/ai 모델 호출 (pi-ai CredentialStore 구현이 SecretStore를 읽는다, 판정 J-57. Authorization 헤더로만)
```

- `ExecStart`를 `secrets run`으로 감싸지 않는 이유: `sops exec-env` 아래로 데몬을 띄우면 주 PID가 sops가 되어 신호 전달이 꼬이고, 데몬 환경 변수에 비밀이 남는다(17 D17-07, 실험 19).
- 개발 데몬(`just daemon-dev`)은 저장소 관례인 `_with-secrets dev`로 환경 변수에 주입하고, 데몬이 읽은 직후 `process.env`에서 지운다(17 §3.8 6번).

구조 규칙 [제안, 18이 세부를 정한다]:

1. 데몬 비밀은 SOPS 원본 → `secrets run` → 데몬 메모리의 한 경로로만 들어온다. 서버에 별도 비밀 저장소를 만들지 않는다 [브리프 §2.5]. 데몬이 읽는 키 이름은 설정 `secrets.keys`와 `.env.example`의 `KEY=` 항목이 같아야 한다(17 §3.3.2, §3.17).
2. 도구 자식 프로세스와 관찰 프로세스에는 허용 목록의 환경 변수만 넘긴다(13, 16 OB-3). 모델이 실행한 bash가 `env`로 API 키를 읽는 경로를 막기 위해서다.
3. 비밀은 DB, 이벤트, 투영, 로그, 설정 파일, 오류 메시지에 들어가지 않는다. 로거는 비밀 필드를 가린다(§3.11.3). 설정 검증기는 키 이름에 `token`, `secret`, `password`, `apiKey`가 있으면 거부한다(17 §3.3.1).
4. 모델 키가 없어도 데몬은 시작하고 해당 제공자를 "사용 불가"로 표시한다(17 §3.3.2 `secrets.required`의 기본은 원장 HMAC 키 `HELM_LEDGER_HMAC_KEY` 하나이고 모델 키는 넣지 않는다, 09 §3.8.2). 클라이언트 접속, 기록 조회, 사람 명령은 모델 없이도 동작해야 하기 때문이다. 제공자가 필요한 실행은 명확한 오류로 멈춘다(12).
5. 기기 토큰은 클라이언트 OS 키체인에 두고 서버에는 해시(SHA-256)만 둔다 [원문 `pi-cases-notes.md` §12.1-7, §12.2-7].

#### 3.9.4 백업과의 경계

homelab restic은 `/srv/volumes` 중 docker 라벨 `backup=true`인 서비스 볼륨만 포함한다 [원문 `homelab/scripts/backup` 55-70행]. Helm 데몬은 systemd 사용자 서비스이고 docker 라벨이 없으므로 자동으로 포함되지 않는다. 17이 다음과 같이 정했다(17 D17-10, §3.7.4).

- 데몬이 SQLite 온라인 백업(better-sqlite3 `db.backup()`)으로 검증된 스냅샷을 `/srv/volumes/helm/backups/`에 만든다(매일 03:40, 마이그레이션·업그레이드 직전). 살아 있는 DB 파일은 restic에 넣지 않는다. CouchDB를 복사본으로 백업하는 homelab 방식과 같은 모양이다 [원문 `homelab/context/decisions.md` CouchDB 백업 행].
- homelab 백업 대상 목록에 Helm 경로를 넣는 변경(`collect_paths`, 제외 목록)은 homelab 저장소 변경이므로 사람이 한다(17 §3.7.4 H-2, H-3).

#### 3.9.5 JSONL은 내보내기·가져오기 전용 [제안, ADR-06-06]

- 정본 형식은 SQLite 하나다. JSONL은 사람이 읽는 내보내기(`helm export`)와 이전 구현 기록(`.helm/events.jsonl`)의 가져오기에만 쓴다(canon-2 §1.18 JSONL migration).
- 저장 형식 독립성(canon §11.14)과 최소 법칙 10(canon §16.7)은 "데몬 없이도 DB 파일만으로 의미 상태를 읽고 내보낼 수 있다"로 지킨다: `helm export --db <path>`는 데몬 없이 읽기 전용으로 동작한다.

### 3.10 설정

#### 3.10.1 원칙

1. 설정 파일은 **운영 설정**(포트, 경로, 로그, 모델 기본값, 관찰 대상, 한도)만 담는다. 다이얼, 모드, 정책처럼 Helm 의미에 속하는 값은 도메인 이벤트로 바꾸고 정본 DB에 기록한다(P 평면, 08·14). 화면에서 바꾼 값이 설정 파일에 써지는 일은 없다. 데몬은 설정 파일을 읽기만 한다 [제안].
2. 앱 설정은 dotfiles에 둔다는 사용자 규칙에 따라, 데몬 설정 파일은 dotfiles 저장소에서 관리하고 `~/.config/helm/`에 연결한다. 로컬 덮어쓰기 파일은 추적하지 않는다(사용자 CLAUDE.md "앱 설정은 dotfiles에 둔다(OS별 계층, 로컬 오버라이드는 미추적)").
3. 설정 파일에는 비밀을 넣지 않는다. 비밀 키 이름이 설정 스키마에 나타나면 검증에서 거부한다.
4. 설정이 없으면 기본값으로 동작한다. 첫 실행에 설정 파일이 필요하지 않다.

#### 3.10.2 파일 위치, 형식, 우선순위

낮은 것부터 높은 것 순서로 덮어쓴다. 17 §3.3.1과 같은 순서에 로컬 덮어쓰기 파일 하나를 더한다.

| 순위 | 출처 | 위치·형식 |
|---|---|---|
| 1 | 코드 기본값 | `daemon/src/config/defaults.ts`. 정식·개발·테스트는 `HELM_ROOT`(데이터 루트)로 나뉜다 |
| 2 | 설정 파일 | `$HELM_CONFIG` 또는 `~/.config/helm/helmd.toml` |
| 3 | 로컬 덮어쓰기 | 같은 디렉터리의 `helmd.local.toml`(dotfiles에서 추적하지 않음) |
| 4 | 환경 변수 | 17 §3.3.1 끝의 목록만(`HELM_CONFIG`, `HELM_ROOT`, `HELM_LOG_LEVEL`, `HELM_SECRETS_SCOPE`, `HELM_SECRETS_FROM_ENV`, `HELM_LISTEN_TAILNET_PORT`, `HELM_LISTEN_SSH_PORT`, `HELM_ALLOW_TMPFS`). 그 밖의 `HELM_*`는 무시하고 경고한다 |
| 5 | 명령행 인자 | 소수(`--config`, `--log-level` 등, 17) |

형식은 TOML이다 [제안, ADR-06-11]. 사람이 고치는 파일이고 주석을 쓸 수 있어야 하며, 사용자 도구(`.mise.toml`)와 같은 형식이다. 파서는 `smol-toml`(작은 순수 JS 파서)을 쓴다 [지식]. 파싱한 값은 TypeBox 스키마로 검증한다. 키는 TypeBox 스키마와 같은 `camelCase`로 쓴다. 스키마에서 JSON Schema를 만들어 편집기 검증에 쓸 수 있다(`helm config schema`). 17 §3.3.1은 2a단계에서 이 형식(`helmd.toml` + `helmd.local.toml`)으로 맞췄다(판정 §2).

#### 3.10.3 스키마

절마다 소유 문서가 기본값과 세부 필드를 확정한다. 06은 최상위 구조와 절 소유, 공통 검증 규칙을 정한다. 운영 절의 필드는 17 §3.3.2의 `DaemonConfig`를 그대로 쓴다.

```ts
// packages/daemon/src/config/schema.ts (최상위 구조. 각 절 스키마는 소유 문서의 정의를 import한다)
import { Type, type Static } from "typebox";

export const DaemonConfig = Type.Object({
  // ── 운영 (17 §3.3.2) ──
  paths:     PathsConfig,       // root(/srv/volumes/helm), dataDir, backupDir, stateDir, cacheDir, tmpDir, observerDir, runtimeDir
  listeners: ListenersConfig,   // tailnet 127.0.0.1:7840, loopback 127.0.0.1:7841, local rpc.sock. host는 127.0.0.1만. 키 이름은 리스너 이름과 같게(§5.3 17)
  secrets:   SecretsConfig,     // scope, command, keys, required, fromEnv
  shutdown:  ShutdownConfig,
  crashLoop: CrashLoopConfig,
  watchdog:  WatchdogConfig,
  backup:    BackupConfig,
  health:    HealthConfig,
  log:       LogConfig,         // level. 06 §3.11
  tools:     ToolsExecConfig,   // slice, sandbox(17 §3.3.2, 18 §3.11). 도구 설정 webSearch는 아래 절 표
  // ── 인증·한도 (18, 19) ──
  auth:      AuthConfig,        // Tailscale 허용 로그인, whois 대조, allowedOrigins(기본 `[publicOrigin]`, 판정 J-154), 토큰 정책 (18)
  // 모바일 출처는 auth.allowedOrigins 하나다. mobile 절은 없다(판정 J-154)
  push:      PushConfig,        // enabled, webpush.subject, webpush.allowedEndpointSuffixes(26 이름, 판정 J-154), followupDelayMs, hourlyCap (26 §3.4, 17)
  limits:    LimitsConfig,      // 메시지·blob·송신 대기 상한, 속도 한도
  // ── 실행 (12, 13) ──
  projects:  ProjectsConfig,    // roots: Helm이 작업할 수 있는 상위 경로. 기본 ["~/projects"]
  ai:        AiConfig,          // 역할별 제공자·모델, 대체 순서, extraModels (12 §3.3). 1단계 이름 models는 쓰지 않는다
  runtime:   RuntimeConfig,     // 동시 실행 수 등 (12, 13)
  orchestration: OrchestrationLimits, // maxConcurrentWorkUnits, maxConcurrentPerConcern, unattendedSpendCapUsd (14 §3.20.6)
  budget:    BudgetConfig,      // 월 모델 비용 상한 budget.monthlyCapUsd(키 이름은 이것 하나). 설치 때 묻고 답이 없으면 50 [가정, J-22]. 80% 알림, 100% 새 실행 중단 (01 NFR-C-1, 12)
  inquiry:   InquiryConfig,     // 역할별 추론 수준, frontSize, reviewTopK, repl (15 §3.13.2)
  user:      UserConfig,        // timeZone. 12의 cron·일일 예산 기준 (17 §3.3.1 예)
  // ── 기능 플래그 (01 ADR P1-5, 14 §3.15) ──
  features:  FeaturesConfig,    // 아래 설명
  // ── 관찰 (16 §3.5.3) ──
  maintenance: MaintenanceConfig, // 샌드박스 홈·scratch·도구 출력·worktree 정리 주기 (17 §3.3.2, §3.9.7)
  observer:  ObserverConfig,    // 16 ObserverConfig 중 운영 설정 부분(실행 주기, 시간 제한, 격리 실행). 허용 폴더는 설정이 아니라 Project 레코드의 rootPaths에서 온다(16 §3.5.3, 판정 J-08)
}, { additionalProperties: false });   // 모르는 키는 오류 (오타를 잡는다)

// 기능 플래그 [제안]. 2단계 기능은 구현돼 있어도 G1 관문 기록 전까지 기본값이 꺼짐이다(01 ADR P1-5, 판정 J-11).
export const FeaturesConfig = Type.Object({
  enabledLoops: Type.Array(LoopId),   // 기본: 01 §3.8 단계표의 MVP 루프 (14 §3.15)
  enabledModes: Type.Array(ModeId),   // 기본: MVP 모드 (14 §3.15)
  flags: Type.Record(FeatureKey, Type.Boolean()),  // 루프·모드로 나눌 수 없는 2단계 기능. 기본 모두 false
}, { additionalProperties: false });

export type DaemonConfig = Static<typeof DaemonConfig>;
```

절 타입의 위치 [제안]. 06의 `schema.ts`는 아래 위치에서 타입을 import해 묶기만 한다.

| 절 | 타입 | 정의 위치 | 소유 문서 |
|---|---|---|---|
| `paths`, `listeners`, `secrets`, `shutdown`, `crashLoop`, `watchdog`, `backup`, `health`, `log`, `tools`, `maintenance` | `PathsConfig` 등 | `packages/daemon/src/config/ops-schema.ts` | 17 §3.3.2 |
| `auth`, `limits` | `AuthConfig`, `LimitsConfig` | `packages/daemon/src/config/auth-schema.ts` | 18, 19 |
| `push` | `PushConfig` | `packages/daemon/src/push/config.ts` | 26, 17 |
| `projects`, `runtime`, `budget`, `user` | `ProjectsConfig`, `RuntimeConfig`, `BudgetConfig`, `UserConfig` | `packages/runtime/src/config.ts` | 12 |
| `tools`의 `webSearch` 절(`providers`, `monthlyCap`) | 형식은 13 §3.2.4 | `packages/runtime/src/config.ts`가 `@helm/tools`의 설정 형식을 가져와 다시 내보낸다. 데몬은 `tools`를 import하지 않는다 | 13, 17(키 등록, 판정 J-167) |
| `ai` | `AiConfig` | `packages/ai/src/config.ts` | 12 §3.3 |
| `orchestration` | `OrchestrationLimits` | `packages/kernel/src/orchestration/settings.ts` | 14 §3.20.6 |
| `inquiry` | `InquiryConfig` | `packages/kernel/src/orchestration/inquiry/config.ts`(순수부, 판정 J-128) | 15 §3.13.2 |
| `features` | `FeaturesConfig`, `FeatureKey`(키 목록과 단계 표) | `packages/domain/src/features.ts` | 06(구조), 23 §3.5.4(키·단계·기본값, 판정 J-181) |
| `observer` | `ObserverConfig`(운영 부분) | `packages/observer/src/ipc/config.ts`(`@helm/observer/ipc`) | 16 |

공통 검증 규칙 [제안]:

- 세 원천(파일, 로컬 파일, 환경 변수)을 합친 결과를 `Value.Check`로 검증하고, 실패하면 모든 오류를 `경로: 이유` 형식으로 출력하고 종료 코드 2(환경 문제, 17 §3.4.5)로 끝난다. systemd는 2를 재시작하지 않는다.
- 리스너 `host`는 `127.0.0.1`(또는 `::1`)만 허용한다(결정 26, 17 §3.5).
- 경로의 `~`와 `$XDG_*`는 로더가 펼친다. 데이터 경로가 `~/projects` 아래이거나 `/mnt/`로 시작하면 거부한다(§3.9.2).
- 비밀처럼 보이는 키 이름(`token`, `secret`, `password`, `apiKey`, `privateKey`)은 거부한다(17 §3.3.1, 18).
- 공개 주소의 정본 키는 `listeners.tailnet.publicOrigin`(URL) 하나다(17 §3.3.2). 18·26이 쓰는 host:port(`publicHost`)는 이 값에서 계산하고 별도 키로 두지 않는다 [제안, 17·18·26에 요구]. `auth.allowedOrigins`는 받는 Origin 목록이고 기본값은 `[publicOrigin]`이다. 모바일 출처를 따로 적는 키(`mobile.origin`)는 두지 않는다(판정 J-154).
- 의미 설정(다이얼, 모드, 정책, 루프 계약)은 이 스키마에 없다. 이것들은 정본 이벤트다(§3.10.1, 14). 14 §3.13.2의 `OrchestrationSettings`는 이 스키마의 운영 한도와 정본의 의미 설정을 합친 읽기 모델이다.
- 기능 플래그 규칙 [제안, ADR-06-18]: (1) `FeatureKey`의 첫 목록과 각 키의 단계·기본값은 `@helm/domain`의 `FEATURE_TABLE` 하나에 둔다. 목록의 정본은 23 §3.5.4다(판정 J-181. `asking.rollbackPoints`는 목록에 없다). 단계의 원천은 01 §3.8 단계표이고, 관문 일정은 23이 정한다. 관찰 에이전트의 모델 판정·제안(판정 J-07)이 첫 `flags` 항목이다. (2) 2단계 키를 켜는 일은 운영자가 설정 파일을 고치는 일이다. 데몬은 다시 읽을 때 켜진 2단계 키 이름을 운영 로그와 `helm status`에 보이고, G1 기록 Concern이 정본에 없으면 경고를 함께 낸다(막지는 않는다. 사용자는 한 명이고 실험을 위해 먼저 켤 수 있다). 기록이 있는지는 23 §3.5.3의 방법으로 본다. 관문 Concern에 관문 표식(`evaluationGate`)이 있고 그 Concern에 `result.accepted`가 있으면 기록이 있다. 표식의 필드 이름과 위치는 08·16이 정한다. (3) 꺼진 기능은 코드 경로를 지우지 않고 계획·도구 목록·화면에서 빼는 방식으로 끈다(14 §3.8.2 5단계 `skipped: "기능 미활성"`). (4) 클라이언트는 `hello` 결과의 능력 목록으로 켜진 기능을 안다(19 `capabilities`). 클라이언트는 설정 파일을 읽지 않는다.
- `helm config check`는 같은 로더로 검증만 하고, `helm config print`는 합친 결과를 출처(어느 순위에서 왔는지)와 함께 보여 준다. 비밀 값은 처음부터 설정에 없으므로 출력에도 없다.

#### 3.10.4 환경 변수

데몬이 읽는 환경 변수는 §3.10.2 순위 4의 목록과 개발 데몬의 비밀 주입(`HELM_SECRETS_FROM_ENV=1`일 때 `secrets.keys`의 이름)뿐이다. 클라이언트(CLI·TUI)는 `HELM_SOCKET`(`rpc.sock` 경로 덮어쓰기)만 읽는다 [제안, 17·19가 이름을 확정].

#### 3.10.5 핫 리로드

`SIGHUP` 또는 `helm ops reload`로 다시 읽는다(17 §3.3.3). 다시 읽은 설정은 먼저 전체를 검증하고, 실패하면 이전 설정을 유지하고 경고를 로그와 상태에 남긴다. 다시 읽기마다 바뀐 키 이름만 담은 운영 기록을 남긴다(값은 넣지 않는다, 17).

| 절 | 리로드 | 이유 |
|---|---|---|
| `log`, `push` | 즉시 | 진단 중 수준을 바꿀 수 있어야 한다. `push`는 다음 발송부터 적용한다(17 §3.3.3) |
| `health`, `backup.keep`, `limits`의 속도 한도 | 즉시 | 17 §3.3.3 |
| `auth`의 허용 로그인·origin | 새 연결부터 | 기존 연결은 유지(18이 확정) |
| `ai` | 다음 실행부터 | 진행 중 실행의 모델을 바꾸지 않는다(12) |
| `observer` | 다음 회차부터 | 16 |
| `projects.roots` | 다음 실행부터 | 진행 중 실행의 범위를 넓히지 않는다 |
| `orchestration`, `budget`, `inquiry`, `features` | 다음 계획·실행부터(`features`의 `clients.mobile`은 즉시) | 진행 중 WorkUnit의 계약과 도구 목록을 바꾸지 않는다(14 D5). `clients.mobile`은 `/m/*` 응답에만 쓰여서 즉시 반영한다(17 §3.3.3) |
| `user.timeZone` | 다음 타이머 계산부터 | 12 |
| `runtime`, `tools` | 재시작 필요 | 실행기 구성과 격리 방식이 바뀐다 |
| `maintenance` | 다음 정리 회차부터 | 17 §3.9.7 |
| `paths`, `listeners`, `secrets`, `shutdown`, `crashLoop`, `watchdog` | 재시작 필요 | 잠금·소켓·DB 위치·비밀 로드가 바뀐다 |

재시작이 필요한 키가 바뀌면 데몬은 적용하지 않고 "재시작 필요"를 상태(`helm status`)에 표시한다.

#### 3.10.6 클라이언트 쪽 설정

- 데스크톱 앱: 접속 프로필(경로 ① URL, 경로 ② SSH 호스트·사용자), 알림 설정. 위치·형식은 20이 정한다. 기기 토큰은 OS 키체인(18, 20).
- CLI·TUI: 같은 서버에서 돌므로 기본값은 `HELM_SOCKET` → `$XDG_RUNTIME_DIR/helm/rpc.sock`(17 §3.2.2). 소켓 디렉터리는 도구 실행 격리의 가림 대상이다(§3.7.4 2번).

### 3.11 로깅과 관측

#### 3.11.1 네 가지 흐름을 섞지 않는다

canon-2 §1.22를 따른다 [제안].

| 흐름 | 무엇 | 어디에 | 소유 |
|---|---|---|---|
| 도메인 원장 | Goal, Concern, 판단, 선택, 합의, 결과 등의 의미 전이 | SQLite 이벤트 로그 | 08, 09 |
| 운영 로그 | 연결, 지연, 재시도, 예외, 투영 갱신 상태, 스케줄러 동작 | journald (데몬 stdout JSON 줄) | 06, 17 |
| 실험 측정 | 복귀 시간, 정정, 우회율, OPD+C 지표 | 16이 정한다(측정 레코드는 도메인 원장의 별도 종류 또는 투영) | 16 |
| 원시 런타임 trace | 모델 메시지, 도구 입출력 | SQLite(근거 원천, §3.9.1) | 09, 12 |

서버 오류나 토큰 사용량을 자동으로 도메인 이벤트로 만들지 않는다. 반대로 중요한 산출물 변화를 운영 로그에만 남기지 않는다(canon-2 §1.22).

#### 3.11.2 운영 로그 형식

- 라이브러리: `pino` [제안]. JSON 줄을 stdout으로 쓰고 systemd가 journald로 보낸다(`SyslogIdentifier=helmd`, 17). 파일 로그 회전은 두지 않는다(journald가 맡는다).
- 공통 필드:

| 필드 | 뜻 |
|---|---|
| `time` | epoch ms (pino 기본) |
| `level` | `fatal` `error` `warn` `info` `debug` `trace` |
| `msg` | 영어 고정 문구(검색용). UI 문구가 아니다 |
| `component` | `listener`, `auth`, `rpc`, `engine`, `runtime`, `scheduler`, `tools`, `ai`, `observer-launcher`, `store` |
| `epoch` | 데몬 세대 |
| `connId`, `deviceId` | 연결이 있는 로그 |
| `reqId` | JSON-RPC 요청 id |
| `seq` | 관련 이벤트 seq |
| `concernId`, `wuId`, `runId`, `toolCallId` | 브리프 §3.2 ID |
| `durMs` | 걸린 시간 |
| `err` | `{ type, message, stack }` (stack은 `debug` 이상에서만) |

- 수준 기준: `error` = 사람이 봐야 하는 실패(실행 실패, 마이그레이션 실패), `warn` = 스스로 회복했지만 반복되면 문제(재시도, 느린 소비자 끊기), `info` = 수명주기와 요청 요약(시작, 종료, 연결, 실행 시작·끝), `debug` = 판정 세부, `trace` = 프레임 단위.
- L0~L3 패키지는 `pino`를 import하지 않는다. `daemon`이 `Logger` 인터페이스(`debug/info/warn/error`, `child(bindings)`)를 만들어 주입한다(§3.5 R6). `kernel`은 로그를 남기지 않는다. 판정 근거는 반환값(거부 사유)으로 나오고, 그것을 기록하는 것은 `engine`이다.

#### 3.11.3 로그에 넣지 않는 것

- 비밀(키, 토큰, Authorization 헤더, 쿠키): 두 겹으로 가린다. (1) `pino` `redact` 경로(`*.apiKey`, `*.token`, `req.headers.authorization`, `*.password`, `env.*`). (2) 마스킹 훅: 로거의 출력 직전 단계에 18 §3.10.4의 공통 마스킹기를 건다. 데몬이 SecretStore에 넣은 값을 마스킹기에 등록하므로(17 §3.8 3단계) 필드 이름과 무관하게 값이 문자열에 섞여도 가려진다. 마스킹기는 `daemon`이 만들어 `Logger`와 정본 쓰기 전 도구 결과 처리(13)에 함께 넘긴다(17 §5.2 06 요구 (2)).
- 도메인 내용(사용자 글, 모델 출력, 도구 출력 본문, 파일 내용): 기본적으로 넣지 않고 ID와 크기만 남긴다. 내용은 정본 DB에 있다. `trace` 수준에서도 본문 대신 해시를 남긴다 [제안]. 프롬프트·출력에 비밀이 섞일 수 있기 때문이다.

#### 3.11.4 진단 명령

관리 CLI 명령 목록 전체는 17 §3.15가 소유한다. 06은 관측 구조에 필요한 명령과 06이 더하는 명령만 적는다.

| 명령 | 하는 일 | 데몬 필요 | 소유 |
|---|---|---|---|
| `helm status [--json]` | 상태 요약: 버전, `bootEpoch`, 모드, 스키마 버전, 마지막 seq, DB·WAL 크기, 진행 중 실행 수, 대기 질문 수, 다음 타이머, 연결 수, 모델 제공자 사용 가능 여부, 재시작 필요한 설정 변경 여부 | 아니요(꺼짐 화면) | 17 §3.11.4 |
| `helm doctor` | 환경 점검: Node 버전, 파일 시스템·권한, 소켓, systemd 단위, 설정 검증, 비밀 키 존재(값은 출력 안 함), serve 응답 | 아니요 | 17 §3.11.5 |
| `helm daemon logs [-f] [--since …]` | `journalctl --user -u helmd.service -o cat` 래퍼 | 아니요 | 17 |
| `helm ops verify [--full]` | 무결성·해시 체인·투영 재구성 비교 | 아니요(돌고 있으면 워커) | 17, 09 |
| `helm diag bundle` | 비밀을 가린 진단 묶음 | 아니요 | 17 |
| `helm events tail [--from <seq>]` | 이벤트 로그를 읽기 전용 연결로 출력 [06이 더함] | 아니요 | 09 |
| `helm export --out <dir> [--db <path>]` | JSONL 내보내기(§3.9.5). 데몬 없이 DB 파일만으로 [06이 더함] | 아니요 | 09 |
| `helm config check` / `print` / `schema` | §3.10.3 [06이 더함] | 아니요 | 06 |

관리 CLI의 종료 코드는 17 §3.4.5 표를 따른다: 0 성공, 1 결과 실패나 상태 나쁨(검사 실패, 데몬이 명령을 거부함), 2 환경 문제(데몬 연결 실패, 도구 없음, 잘못된 인자), 3 잠금 충돌, 4 버전 불일치, 5 사람 결정 필요(`gated`).

#### 3.11.5 진단 span

pi-ai는 `StreamOptions.telemetryContext`로 pi-telemetry의 `TelemetryContext`를 받는다(`ai/src/types.ts:1, :160`) [원문 pi-facts-2 §10]. 기본은 `NOOP_TELEMETRY_CONTEXT`로 두고, `logging.level=trace`일 때만 span을 운영 로그로 쓰는 어댑터를 붙인다 [제안]. pi-telemetry README의 "A span is diagnostic data, not business state."에 맞춰 span을 도메인 원장에 넣지 않는다.

### 3.12 기술 스택

#### 3.12.1 확정 표

버전 확인은 2026-10-11 서버에서 `npm view`와 설치된 도구로 했다 [실험]. "고정 방식"은 `package.json`에 적는 방식이다.

| 항목 | 선택 | 고정 방식 | 근거 | 브리프 대비 |
|---|---|---|---|---|
| 런타임 | **Node.js 24 LTS** (`>=24.15.0 <25`) | `engines`, `.mise.toml` `node = "24"`, `engine-strict` | §3.12.2. 하한 24.15는 데스크톱 테스트의 jsdom 30 요구(20 §3.7.3) | 판정 44(ADR-06-07 채택) |
| 패키지 관리 | **pnpm 11** 워크스페이스 | 루트 `packageManager: "pnpm@11.x.y"`, `.mise.toml` | 결정 36. 서버에 11.21.0 설치됨 [실험] | 같음 |
| 언어 | **TypeScript 6.0** (`~6.0.3`), `strict`, ESM | 정확한 버전 | §3.12.2 | 판정 44(ADR-06-08 채택) |
| pi 패키지 | 고정 의존 pi-ai·pi-codemode·pi-mcp·pi-tui `1.1.0`, vendor 3개(§3.4.18) | 정확한 버전 + pnpm `overrides`(07 §3.3.2) | 결정 27·28·44, 07 D07-1·5·7 | 같음 |
| 스키마 | **TypeBox** — npm 이름 `typebox`(1.x) | 고정 의존 pi-ai 1.1.0과 같은 정확한 버전(`typebox` `1.3.27`, `pi-src/packages/ai/package.json:79`) | 결정 36 "pi-ai와 맞춤". 두 사본이 설치되면 스키마 객체가 서로 다른 라이브러리 인스턴스가 된다 | 같음. npm 이름은 `typebox`다(`@sinclair/typebox`와 다른 패키지) [원문 pi-facts-2 §1.2] |
| SQLite 드라이버 | **better-sqlite3** 13.0.3, 타입 `@types/better-sqlite3` 9.6.0 | 정확한 버전. 바이너리는 묶음 안에 있어 빌드 허용 목록이 필요 없다(§3.12.3) | §3.12.3 | 같음(ADR-06-09로 재확인) |
| WebSocket 서버 | `ws` 8.x on `node:http` | 정확한 버전 | 웹 프레임워크 없이 경로 몇 개(RPC, 큰 데이터, 상태)만 쓴다. pi-web(Fastify), openclaw(`ws`) 사례 | 이 문서가 정함 |
| 로깅 | `pino` | 정확한 버전 | §3.11.2 | 이 문서가 정함 |
| 설정 파서 | `smol-toml` | 정확한 버전 | §3.10.2 | 이 문서가 정함 |
| 테스트 | **Vitest** (현재 5.x) | 정확한 버전, 루트 `vitest.config.ts`의 `projects` | 결정 36. pi도 Vitest를 쓴다(4.1.11, pi-tui만 `node --test`) [원문 pi-facts-2 §1.1] | 같음 |
| 린트 | ESLint(flat config) + typescript-eslint | 정확한 버전 | 템플릿 `node.just`의 `check`·`lint`가 ESLint를 전제한다. 의존 규칙 일부를 ESLint로 검사한다(§3.5.3) | 이 문서가 정함 |
| 형식 | Prettier | 정확한 버전 | vendor 코드는 제외(§3.5.3) | 이 문서가 정함 |
| 빌드(Node 패키지) | `tsc -b` (번들러 없음) | - | §3.12.4 | 이 문서가 정함 |
| 빌드(데스크톱) | Vite 8 + Tauri v2 CLI | 정확한 버전 | 결정 32 | 같음 |
| UI | **React 19**. UI 부품은 Helm이 직접 만들고(헤드리스 부품 위), 시각 언어는 글래스모피즘. Caustic 토큰은 복사(의존 없음). 판과 라이브러리 목록은 20 §3.7.3, 21 | 정확한 버전 | 결정 41, 43 | 결정 32의 React 18을 결정 41이 대체 |
| Rust(데스크톱 셸) | `rust-toolchain.toml`로 안정판 하나에 고정(1.90 이상), Windows는 WSL에서 cargo-xwin 교차 빌드 | `rust-toolchain.toml`, `just app-setup` | 20 §3.12.1 | 이 문서가 받음 |
| 웹·브라우저 도구 | `playwright-core` 1.64.0, `linkedom` 0.18.13, `@mozilla/readability` 0.6.0, `turndown` 7.2.4 | 정확한 버전. 사용처와 설치 조건은 §3.12.5 | §3.12.5 | 이 문서가 정함(결정 55, 판정 J-190 (1)) |
| 작업 실행 | just(`justfile` + `.just/`) | 사용자 템플릿 모듈 복사 | 브리프 §2.5. 서버에 1.58.0 [실험] | 같음 |
| 도구 버전 관리 | mise(`.mise.toml`) | - | 사용자 템플릿 | 같음 |
| 커밋 훅 | lefthook(gitleaks, secrets check) | - | 사용자 템플릿 | 같음 |

의존 고정 정책 [제안]:

- 외부 의존은 모두 정확한 버전으로 적는다(`^` 없음). pi 패키지는 1.0.x 패치에서도 호환이 깨졌다 [원문 pi-facts-2 §1.3]. pi 저장소도 "외부 의존은 정확한 버전으로 고정"을 규칙으로 둔다 [원문 pi-facts-2 §1.1].
- pi 패키지끼리 `^1.1.0`으로 서로를 요구하므로 고정 의존으로 쓸 때는 pnpm `overrides`로 한 버전에 묶는다 [원문 pi-facts-2 §13 공통]. `overrides` 내용과 vendor 패키지 매니페스트는 07 §3.3.2가 정한다.
- 업그레이드는 Renovate 등 자동 도구 없이 사람이 한다. 1인 프로젝트이고 pi의 변경 빈도(5개월 58개 버전, pi-layer-analysis §8)를 고려하면 자동 PR이 확인 부담만 만든다 [제안]. 07의 업스트림 추적 표와 같이 움직인다.

#### 3.12.2 Node 24와 TypeScript 6.0을 고른 이유

Node:

- 모든 pi 패키지의 `engines.node`는 `>=22.19.0`이다(`pi-src/packages/agent/package.json:43-45` 등) [원문]. Node 22와 24 모두 만족한다.
- 하한을 24.15로 둔다. 데스크톱 앱 테스트가 쓰는 jsdom 30이 Node 24에서는 24.15 이상을 요구한다(20 §3.7.3 [검색]). 서버의 24.19.0은 이 조건을 만족한다 [실험].
- Node 22는 2027-04에 지원이 끝나고, Node 24는 2028-04까지 지원된다 [지식]. 설계가 끝나고 구현을 시작하면 Node 22의 남은 기간이 짧다.
- 서버에 이미 Node v24.19.0이 있고 pi 실험도 그 버전으로 돌았다 [실험, pi-facts-2 §11]. 사용자 템플릿에 `node-24` 스택이 있다 [원문 `~/.dotfiles/templates/project/node-24/`].
- Node 24에서는 타입 제거 실행으로 `.ts` 파일을 바로 실행할 수 있다 [지식]. 개발 실행과 스크립트(`scripts/check-architecture.ts`)에 쓴다(§3.12.4).

TypeScript:

- pi 소스는 `erasableSyntaxOnly`(5.8에서 추가)와 `rewriteRelativeImportExtensions`(5.7에서 추가)를 전제로 한다 [원문 pi-facts-2 §1.1, §13; 버전은 지식]. 그래서 5.8 이상이 필요하다.
- pi 저장소는 TypeScript 7.0.2를 쓴다 [원문 `pi-src/package.json:65`]. npm `latest`도 7.0.2다 [실험]. 그러나 typescript-eslint 8.71.1의 peer 범위가 `typescript >=4.8.4 <6.1.0`이라 7을 받지 않는다 [실험 `npm view typescript-eslint peerDependencies`]. 타입 정보를 쓰는 린트 규칙을 쓰려면 6.0이 상한이다.
- 6.0은 7로 가는 중간 판이라 7에서 없어지는 옵션을 미리 경고한다 [지식]. 5.9에 머무르면 7로 옮길 때 고칠 것이 한 번에 몰린다.
- 결정: `~6.0.3`. typescript-eslint가 7을 지원하면 7로 옮긴다(§7 O-03).

TypeScript 공통 설정(`tsconfig.base.json`) [제안]:

```jsonc
{
  "compilerOptions": {
    "target": "es2024",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,              // pi 소스와 같은 문법 규칙. enum·namespace·parameter property 금지
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true, // 소스의 상대 import는 .ts 확장자를 붙인다 (pi와 같음)
    "composite": true,
    "declaration": true,
    "sourceMap": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "lib": ["es2024"],
    "types": []                              // 패키지마다 필요한 것만 (node 타입은 Node 패키지에만)
  }
}
```

- `apps/desktop`(이후 `apps/mobile`)은 Vite를 쓰므로 `moduleResolution: "bundler"`, `lib: ["es2024", "dom"]`, `jsx: "react-jsx"`로 덮어쓴다.
- vendor 패키지는 같은 기본 설정을 쓰고 업스트림 소스에 맞춰 필요한 옵션만 덮어쓴다(§3.4.18, 07 §3.3.3).
- pi 저장소의 문법 규칙(erasable 문법만, inline `await import()` 금지)을 Helm 코드에도 적용한다. vendor 코드와 같은 규칙이면 고쳐 쓴 코드를 옮기기 쉽다 [원문 pi-facts-2 §1.1 "문법 규칙"].

#### 3.12.3 SQLite 드라이버: better-sqlite3 유지 [제안, ADR-06-09]

| 기준 | better-sqlite3 13.x | `node:sqlite` (Node 24 내장) |
|---|---|---|
| API | 동기. `db.transaction(fn)`(중첩 시 savepoint), `db.backup()`, 사용자 함수, `iterate`, `safeIntegers` [지식] | 동기 `DatabaseSync`. `backup` 함수가 있다 [실험: Node 24.19에서 export 목록 확인]. 트랜잭션 도우미는 없다(`BEGIN`을 직접) |
| 안정성 표시 | 오래 쓰인 외부 패키지 | Node 문서상 안정(Stable) 단계 전 [지식]. Node 24.19에서 불러올 때 실험 경고는 출력되지 않았다 [실험] |
| 설치 | 네이티브 모듈. 13.0.3은 미리 빌드한 바이너리를 묶음에 싣는다(설치 스크립트 없음). Node 주 버전을 올리면 다시 설치 | 설치 없음 |
| 사례 | - | pi-durable(`durable/src/storage/sqlite/node.ts`, pi-facts-1 §0-9), OpenClaw(`node:sqlite` + kysely 컴파일 전용) [원문 S4/openclaw-runtime §1.1] |
| 다른 설계 문서와의 관계 | 브리프 결정 36 기본값. 09(DDL), 17(백업)이 이 전제로 작성 중이다 | 바꾸면 09·17이 함께 바뀐다 |

결정: **better-sqlite3를 유지한다.**

- 정본 저장소는 이 시스템에서 가장 오래 바뀌지 않아야 하는 부분이다. API가 아직 안정 단계가 아닌 내장 모듈보다 오래 쓰인 드라이버를 고른다.
- 데몬은 WSL Linux x64 한 곳에서만 돌므로 네이티브 모듈의 플랫폼 부담이 작다. 데스크톱 앱은 SQLite를 쓰지 않는다.
- 트랜잭션 도우미와 온라인 백업 API가 단일 writer·백업 설계(§3.6.6, §3.9.4)에 바로 맞는다.
- 바꿀 수 있게 남겨 둔다: SQLite 드라이버를 import하는 곳은 `store` 하나다(§3.5 R6). `store/src/driver.ts`에 드라이버 접점을 모아 두면 `node:sqlite`로 옮길 때 고칠 범위가 그 파일과 테스트로 한정된다.
- 재검토 조건: `node:sqlite`가 Node 문서에서 안정 단계가 되거나, better-sqlite3가 쓰는 Node 주 버전에 미리 빌드된 바이너리를 내지 못할 때.

설치 형태: better-sqlite3 13.0.3에는 설치 스크립트가 없고(`scripts`에 install·postinstall 없음, `gypfile: false`) 미리 빌드한 네이티브 바이너리가 패키지 묶음 안에 들어 있다 [실험 `npm view better-sqlite3@13.0.3 scripts gypfile`, V6-100]. 그래서 내려받는 바이너리는 `pnpm-lock.yaml`의 묶음 무결성 해시 안에 있고, pnpm 빌드 허용 목록에 넣을 것이 없다. 빌드 스크립트 허용 여부는 `pnpm-workspace.yaml`의 `allowBuilds` 한 곳에 적는다. pnpm 11.21.0은 허용 여부를 정하지 않은 빌드 스크립트가 있으면 `ERR_PNPM_IGNORED_BUILDS`로 설치를 실패시키고, `onlyBuiltDependencies`·`ignoredBuiltDependencies`로는 막지 못한다 [실험, 07 §3.3.2·§8.3]. 그래서 의존에 설치 스크립트가 있는 패키지는 모두 이름으로 `true`/`false`를 정한다. 지금 대상은 pi 쪽의 `@google/genai`·`protobufjs` 둘이고 둘 다 `false`다(실행하지 않아도 동작, 07). 새 의존이 설치 스크립트를 가지면 설치가 실패하므로 그때 사람이 정한다(18 공급망 규칙). 타입은 `@types/better-sqlite3` 9.6.0을 정확한 판으로 쓴다 [실험 `npm view`]. 릴리스 매니페스트는 Node ABI(`process.versions.modules`)를 적고 데몬 시작 1단계와 `helm doctor`가 대조한다(17 §3.10.1). Node 주 버전을 올린 뒤 모듈을 불러오지 못하면 `just setup`이 다시 설치한다. 이 실패는 환경 문제이므로 종료 코드 2로 보고하고 코드를 고치지 않는다.

#### 3.12.4 빌드와 실행 형태

- Node 패키지는 번들러 없이 `tsc -b`로 `dist/`에 내보낸다. pi 저장소도 패키지마다 `tsc`를 쓰고 번들러를 쓰지 않는다 [원문 pi-facts-2 §1.1].
- 패키지 `exports`는 조건 두 개를 둔다: `"source": "./src/index.ts"`, `"default": "./dist/index.js"`(+`"types"`). vendor 패키지도 같다(07 §3.3.2의 매니페스트에 `source` 조건을 더한다). pi도 같은 `source` 조건을 쓴다 [원문 pi-facts-2 §1.1 테스트 행].
- 운영 데몬은 저장소 작업 트리에서 실행하지 않는다. git 커밋 하나에서 `tsc -b` + `pnpm deploy`로 만든 불변 릴리스 디렉터리(`/srv/volumes/helm/app/releases/<ID>/`)를 `current` 링크로 바꿔 실행한다(17 D17-11, §3.10). 동기화 폴더(`~/projects`)의 편집이 실행 중 코드에 섞이지 않게 하기 위해서다.
- 개발 데몬(`just daemon-dev`)은 `pnpm --filter @helm/daemon dev`로 전경 실행한다(17 §3.14). 이 스크립트는 `node --conditions=source packages/daemon/src/bin/helmd.ts`로 소스를 타입 제거 실행하는 것을 기본으로 한다 [제안]. `node --watch`는 쓰지 않는다. pi-codemode의 worker 채널이 `node --watch`에서 깨지는 문제가 업스트림 Unreleased 변경으로만 고쳐져 있기 때문이다(07 §4 E14). Node의 타입 제거는 `node_modules` 아래 파일을 처리하지 않는다 [지식]. 워크스페이스 패키지는 심볼릭 링크의 실제 경로가 `packages/…`라 해당하지 않는다고 보며, 07은 vendor 진입점을 Node 24 타입 제거 실행으로 불러온 결과를 기록했다(07 §3.6.3 "진입점 두 개 로드에 303 ms(Node 24, 타입 제거 실행)") [가정: 워크스페이스 전체에서의 동작은 S1에서 확인]. 안 되면 `tsc -b --watch` + 수동 재시작으로 바꾼다.
- Vitest는 `resolve.conditions: ["source"]`로 소스를 바로 읽는다(pi와 같음).
- 데스크톱 앱은 Vite가 React 코드를 묶고 Tauri CLI가 앱을 만든다. macOS 빌드는 `run-on mac`(브리프 §2.5), Windows 빌드 경로는 20이 정한다.

#### 3.12.5 웹·브라우저 도구의 의존과 사람 작업 [결정 55 / 판정 J-190 (1)·(6)]

| 패키지 | 판(정확 고정) | 라이선스 | 자기 의존 | 설치 스크립트 | 누가 import하나 |
|---|---|---|---|---|---|
| `playwright-core` | 1.64.0 | Apache-2.0 | 없음 | 없음 | `packages/tools/src/browser/browserd.ts`만 |
| `@mozilla/readability` | 0.6.0 | Apache-2.0 | 없음 | 없음 | `packages/tools/src/web/convert-worker.ts`만 |
| `linkedom` | 0.18.13 | ISC | 5개(`css-select`, `cssom`, `html-escaper`, `htmlparser2`, `uhyphen`) | 없음 | `packages/tools/src/web/convert-worker.ts`만 |
| `turndown` | 7.2.4 | MIT | 1개(`@mixmark-io/domino`) | `prepare`(빌드 스크립트)만 있다 | `packages/tools/src/web/convert-worker.ts`만 |

[실험: `npm view <패키지> version license dependencies scripts`, 2026-10-14. 근거 조사는 `research-browser.md` §5.2]

- 판은 §3.12.1 고정 정책을 따른다. 새 판은 사람이 올린다.
- 설치 스크립트: 네 패키지에는 `preinstall`·`install`·`postinstall`이 없다. `turndown`의 `prepare`는 빌드 스크립트다. 설치 때 실행되는지는 구현 첫 `pnpm install`의 빌드 승인 메시지로 확인한다. 승인을 요구하면 사람이 `pnpm-workspace.yaml`의 `allowBuilds`에 한 줄을 정해 적는다(§3.12.3, 18의 허용 목록과 대조). 그 전에는 `allowBuilds`에 항목을 더하지 않는다.
- 브라우저 바이너리: `playwright-core`는 브라우저를 내려받지 않는다. 시험용 Chromium과 WebKit은 `just setup`이 내려받는다(§3.16, 22). 운영 `helm-browserd`가 쓸 Chrome 실행 파일의 경로는 13·17이 정한다. 이 서버에는 google-chrome 155가 설치돼 있다[실험, 2026-10-14].
- 쓰지 않는 것: `jsdom`(의존이 많고 표면이 크다). 변환 품질을 비교할 `defuddle`(0.19.5, MIT)은 23 스파이크에서 본다(§7 O-18).
- 사람 작업(root 권한, apt): 필수는 `bubblewrap`(S1 샌드박스)이다. 권고는 `fonts-noto-cjk`, `fonts-noto-color-emoji`(한글 렌더링과 변환 품질)다. 컴퓨터 사용 단계(이후)는 `xdotool`, `openbox`(또는 `fluxbox`), `x11-utils`, `scrot`(또는 `imagemagick`)이 필요하다. 설치 항목의 정본은 17 §3.3.6이다.
- 비밀(사람이 `secrets edit`로 넣는다, §3.17): `BRAVE_SEARCH_API_KEY`(`web_search` 기본 제공자, 카드 필요), `TAVILY_API_KEY`(예비 제공자, 선택). 데몬만 읽는다.

### 3.13 벤더 중립 원칙과 런타임 어댑터의 위치

브리프 §3.5가 P3(06)과 P7(13)에 함께 맡긴 항목이다. 06은 원칙, 어휘의 골격, 위치, 보장 수준 규칙을 정하고, 13이 인터페이스 세부와 런타임별 대응을 정한다.

#### 3.13.1 원칙 [제안]

번호 `AP-n`은 이 절 안에서만 쓰는 라벨이다(가설 ID V와 구별한다).

| 번호 | 원칙 | 출처 |
|---|---|---|
| AP-1 | **본체는 중립, 차이는 어댑터 안에만.** 런타임별 이름(pi 이벤트, Claude Code 훅, Codex 메서드)은 어댑터 안에서만 쓰고, 도메인과 커널은 중립 어휘만 안다 | 대화 L6 원칙 문장(extracts-1 E1-002), canon-2 §1.3 P1, canon §16.9 "vendor별 이름을 코어 schema에 넣지 않는다" |
| AP-2 | **능력이 없으면 멈추지 말고 보장 수준을 낮춰 동작하고, 낮아진 사실을 보인다.** "깨지지 않고 약해지기만" | extracts-1 E1-009, extracts-3 X3-8-22, canon-2 §1.3 P4 |
| AP-3 | **런타임 훅 차단은 빠른 피드백이고 유일한 방어선이 아니다.** 사전 차단이 없으면 격리된 작업 공간과 사후 diff 검사로 바꾼다 | extracts-1 E1-004, X3-8-22 |
| AP-4 | **정본은 Helm 로그다.** 런타임의 세션 파일·세션 트리·메모리를 정본으로 쓰지 않는다. 단계 사이 데이터는 Helm 레코드 id로 넘긴다 | 결정 29, extracts-1 E1-013, audit §3.8 |
| AP-5 | **어댑터는 정본 이벤트를 직접 append하지 않는다.** 관찰 후보와 제안을 제출하고 커널이 판정한다 | canon-2 §1.3 P3, canon §13.7 Adapter 비책임 4 |
| AP-6 | **적합성 테스트가 문서 기억보다 우선한다.** 런타임의 능력은 바뀌므로, 같은 대본을 어댑터마다 돌려 광고한 능력과 실제 결과를 비교한다 | canon-2 §1.2, §1.23, extracts-1 E1-016·E1-048 |
| AP-7 | **런타임 고유 강점은 어댑터 안에서 쓰되, 없어도 동작해야 한다.** 최소공통분모로 본체를 줄이지 않는다 | extracts-1 E1-017, canon §16.3 "최소 공통분모가 아니다" |
| AP-8 | **과도한 범용화를 경계한다.** 1차 구현은 어댑터 하나다. 두 번째 런타임은 실제 필요가 생길 때 붙인다 | extracts-1 E1-040(Gas Town 철수), E1-049, 결정 34 |

AP-8과 E1-016("두 번째 런타임을 일찍 붙이라")은 긴장 관계다. 이 설계는 두 번째 런타임 대신 **두 번째 어댑터 구현을 시험용으로 둔다**: `@helm/runtime/testing`에 가짜 런타임 어댑터(낮은 능력 수준을 흉내 내는 것)를 두어, 적합성 시험이 1차 어댑터 하나에만 맞춰지지 않게 한다 [제안]. canon-2 §9.8의 실행 후보도 `DirectAdapter`와 `JsonlRpcAdapter` 두 개로 같은 계약을 시험했다.

#### 3.13.2 위치

| 무엇 | 어디 | 단계 |
|---|---|---|
| 어댑터 계약 타입(`RuntimeAdapter`, `AdapterRunSpec`, `KernelGate`, `NeutralEventSink`, `CapabilityManifest`, `RuntimeSignal`, `ProjectedContext`와 `ChangeSet`·`EffectiveScope`·`RunBudget`) | `@helm/domain/src/adapter-contract.ts`(§3.4.2) | 1차 |
| 어댑터 구현(1차 어댑터와 계약을 구현하는 코드) | `packages/runtime/src/adapter/` → `@helm/runtime/adapter` | 1차 |
| 1차 어댑터(자체 런타임: `agent` + `ai` + `tools`) | `packages/runtime/src/adapter/first-party/` | 1차 |
| 적합성 시험 묶음, 가짜 런타임 어댑터 | `@helm/runtime/testing` | 1차 |
| 외부 어댑터(pi RPC, Claude Code, Codex, ACP) | `packages/adapter-pi-rpc`, `adapter-claude-code`, `adapter-codex`, `adapter-acp` | 이후 단계 [제안: 결정 34 기본값]. 각 패키지는 `@helm/runtime/adapter`와 `domain`만 의존한다 |

1차 어댑터도 같은 계약을 거친다. 다른 런타임이 들어올 때 계약이 1차 런타임 내부 구조에 맞춰져 있으면 안 되기 때문이다.

#### 3.13.3 중립 이벤트 어휘(런타임 신호)

런타임에서 올라오는 신호의 이름을 Helm이 정한다(extracts-1 E1-008 "런타임 이벤트 이름에 맞추지 말고 내 어휘를 각 런타임에 매핑"). 이 신호는 도메인 이벤트(09)가 아니다. `runtime`이 받아 실행 기록·관찰·제안으로 바꾼 뒤 `engine`에 넣는다. 정본 목록, 이름, 런타임별 대응은 13 §3.11.3·§3.11.4가 정하고 06은 이름을 다시 적지 않는다.

06이 정하는 구조 조건:

- 커널 검사 지점은 셋이다: 도구 실행 전(도구 요청 신호 → `KernelGate.beforeTool`, 사전 차단), 턴 경계(턴 끝 신호 → `turnBoundary`, 계속·멈춤), 모델 요청 직전(컨텍스트를 Helm 투영으로 바꾸는 지점, `contextDelivery = per_request`일 때). 나머지는 기록 지점이다.
- 메시지 조각과 도구 진행 출력 신호는 휘발 스트림으로만 보내고 정본에 넣지 않는다(§3.6.5).
- 1차 런타임(pi-agent-core 포크)에서 이 신호의 출처는 훅 `prepareRequest`(`pi-src/packages/agent/src/types.ts:271`), `beforeToolCall`(`:326`), `afterToolCall`(`:341`), `finishTurn`(`:264`), 그리고 이벤트 싱크(`subscribe` 또는 저수준 루프의 `emit`)의 `message_end`다 [원문, 판정 J-14].

두 종합 문서의 후보 어휘(canon-3 §5.1.6, §5.2.6)는 도메인 이벤트 카탈로그(09)의 누락 점검용이다. 런타임 신호 어휘와 섞지 않는다.

#### 3.13.4 능력 목록과 보장 수준

원전에는 능력 목록이 두 판으로 있다: 문서판 키 8개와 실행 후보의 Level 4개 × `enforced | advisory | unavailable`(canon-2 §1.15, §9.1). 그리고 대화에서 정한 내부 루프 계약 능력 5개(extracts-3 X3-8-21)가 있다. 13 §3.11.3이 이 셋을 `CapabilityManifest` 하나로 합쳤다(키 15개, 값은 키마다 열거형). 06은 다음 규칙만 둔다 [제안, ADR-13-04. 1단계의 ADR-06-10을 대체].

1. Level(A~D)과 보장 성질별 수준(`enforced` 실행 전 차단, `detected` 실행 뒤 감지, `advisory` 지시문뿐, `unavailable`)은 저장하지 않고 능력 목록에서 계산한다. 계산 규칙의 정본은 13 §3.11.5(성질 G1~G8)다. run마다 계산한 수준을 `run.start` 페이로드와 이벤트의 `enforcement`에 넣는다(10 §3.18.3).
2. 능력이 없으면 멈추지 않고 보장 수준을 낮춰 동작하며, 낮아진 사실을 화면과 감사 기록에 보인다(AP-2, AP-3). 낮추는 방식(격리된 작업 공간과 사후 diff 검사, 어댑터가 부여한 id, 실행 단위 쪼개기, 시작 지시문에만 투영 넣기 등)은 13 §3.11.6이 정한다.
3. 격리(§3.7.4)를 쓸 수 없는 실행 환경은 G2를 `advisory`로 표시한다. "`authorityEnforcement`가 없는 어댑터에서는 Helm이 실제 sandbox라고 주장하지 않는다"(canon-2 §1.15).

#### 3.13.5 드라이버 계약과 하위 실행 계약

타입의 정본은 13 §3.11.2다(`RuntimeAdapter { probe, startRun, resumeRun? }`, `AdapterRunSpec`, `ContextDelivery`, `AdapterRun`, `KernelGate { beforeTool, afterTool, turnBoundary, usage }`, `NeutralToolCall`, `NeutralToolResult`). 06이 정하는 구조 조건:

- 단계 사이 데이터는 Helm 레코드 id로 넘긴다(AP-4). 어댑터는 정본 이벤트를 직접 append하지 않고, `KernelGate`를 거쳐 `engine.submit`으로만 제출한다(AP-5, R13).
- 1차 어댑터는 `KernelGate`를 같은 프로세스의 함수 호출로 받는다. 외부 어댑터(다른 프로세스에서 도는 Claude Code 훅 스크립트 등)는 같은 계약을 데몬과의 별도 채널(`adapter` 채널, 10 §3.3)로 받는다. 이 채널의 전송은 외부 어댑터를 만들 때 13·19가 정한다.
- 데몬에 연결할 수 없을 때 외부 어댑터의 기본 동작 [제안, 13·17이 확정, extracts-4 d22]: `read`는 허용하고, `write`·`execute`·`send`·`spawn`은 거부한다(fail-closed). 관찰은 어댑터 쪽에 크기 상한이 있는 대기열로 쌓았다가 다시 연결되면 멱등 키와 함께 보낸다. 대기열이 넘치면 그 실행은 "기록 누락"으로 표시된다.
- 하위 실행(E1-143: 컨텍스트 fresh·fork, sync·background, 예산)은 12·14가 정한다. 결과는 레코드 id로 돌아온다.

#### 3.13.6 적합성 시험

canon-2 §1.23의 "모든 어댑터가 같은 fixture"를 따른다. `@helm/runtime/testing`의 `runAdapterConformance(adapter)`가 다음을 시험한다(13·22가 대본을 정한다).

1. 능력 목록 제출(handshake)과 스키마 검증.
2. 같은 faux 모델 대본(helm.mjs 거부 8건 대본 포함, extracts-3 X3-10-03)을 돌려 같은 도메인 이벤트 열이 나오는지. 어댑터마다 다른 것은 provenance뿐이어야 한다(canon-2 §10 L15 "전송 형식은 의미 밖").
3. 광고한 능력의 실제 동작: `preToolInterception = blocking`이면 범위 밖 쓰기가 실행되지 않는다. `advisory`이면 사후 diff 검사 경로로 간다(13 AC-01~AC-14).
4. 무권한 명령 시도(어댑터가 사람 명령을 보내려 하면 거부).
5. 중복 관찰 제출(멱등), 연결 끊김과 재연결, 취소.
6. 광고와 실제가 다르면 실패한다.

클라이언트 계약(프로토콜)의 적합성 시험은 이것과 따로 둔다(C8, canon §16.2): 같은 클라이언트 대본을 전송 세 가지(§3.7.2)에서 돌려 같은 응답·이벤트 열을 확인한다(19, 22).

### 3.14 기획 선행 작업 7항목 중 구조 쪽 결론

대화 [157]의 선행 작업 7항목(extracts-4 18-2, 대화 L4388–4394)을 브리프 §3.5가 P1·P3에 나눠 맡겼다. 기획 쪽 결론은 01 §3.12와 02에 있다. 아래는 구조 쪽 결론이다.

| 항목 | 구조 쪽 결론 | 근거 |
|---|---|---|
| 1. 유즈케이스 | 유즈케이스마다 지나는 프로세스·패키지를 아래 표로 정했다. 유즈케이스 단계 흐름과 수용 기준은 02 | 02, 이 절 |
| 2. 진입점 | 데스크톱 앱(경로 ①·②)이 첫 진입점. 다음 단계에 휴대폰 PWA(결정 47), 그다음 SSH + `helm-tui`. 관리 작업은 `helm` CLI. 외부 런타임(pi CLI, Claude Code)에서 들어오는 경로는 이후 단계 어댑터 | 결정 19, 33, 38, 39, §3.8 |
| 3. 프로세스 배치 | C 구조 + 데몬 내장 1차 런타임(§3.6.1). 관찰 에이전트는 별도 일회성 프로세스 | 결정 22, 23, 34, 35 |
| 4. 저장소 소유와 기록 경계 | 정본은 `helmd`만 쓰는 SQLite 하나(§3.9). 런타임 원시 기록도 같은 DB. pi 세션 파일·외부 런타임 로그는 입력일 뿐 정본이 아니다. 비밀은 SOPS → 시작 때 자식 로더 → 데몬 메모리(판정 45). 설정은 dotfiles의 TOML | 결정 29, 45, §3.9, §3.10 |
| 5. 런타임 어댑터 계약 | `@helm/runtime/adapter`에 계약, 중립 신호 어휘, 능력 목록, 보장 수준 낮추기 규칙, 적합성 시험(§3.13). 세부 13 | 결정 34 |
| 6. MVP | MVP 기능 범위는 01. 구조 쪽: MVP에 필요한 패키지는 `domain`, `protocol`, `kernel`, `store`, `engine`, `ai`, `agent`, `tools`, `runtime`, `observer`(결정적 수집·탐지·지표까지, 판정 J-07), `daemon`, `client`, `ui-language`, `cli`, `desktop`, vendor 3개. 관찰의 모델 판정·제안은 2단계 기능 플래그로 끈다(§3.10.3). `tui`는 골격만 만들고 비워 둔다. 모바일(`apps/mobile`)은 2단계이며 26이 정한 뒤 만든다 | 01 §3.8 단계표, 02 §3.1 |
| 7. 비기능 요구 | 재시작(§3.6.6, 결정 30), 데몬이 꺼졌을 때(클라이언트는 읽기 전용 캐시와 재연결, 외부 어댑터는 fail-closed §3.13.5), 원격 접속 보안(§3.7.4, §3.8), 자원(§3.6.3, 01 NFR-C-4). 목표 수치는 01 §3.11, 측정은 22 | 결정 21, 22, 26 |

유즈케이스별 구조 [제안]. 유즈케이스 ID와 이름의 정본은 02 §3.1(UC-01~19, 판정 §1)이다. 아래는 구조상 특별한 것이 있는 유즈케이스만 적는다.

| 유즈케이스 | 주로 지나는 프로세스 | 주요 패키지 | 구조상 특별히 필요한 것 |
|---|---|---|---|
| UC-01 취향형 작업의 원함 탐구 | 데스크톱 앱 ↔ helmd | `runtime`(탐구 엔진), `ai`, `kernel`(선호 모델 규칙), `protocol`(자극·반응 메서드) | 자극 이미지 같은 큰 데이터를 HTTP로(§3.7.1), blob 저장(§3.9.1) |
| UC-02 원인 조사 | helmd(도구 실행) | `runtime`, `tools`, `kernel`(승격 규칙) | 도구 자식 프로세스 격리(§3.7.4) |
| UC-03 여러 날 걸리는 작업 | helmd 상주, 클라이언트 없음 | `runtime`(스케줄러, 복구), `engine`, `store` | 데몬 상주·재시작 복구(§3.6.6), 지속 타이머 |
| UC-04 외부에서 접속해 질문에 답하기(2단계부터 휴대폰) | 데스크톱 앱(경로 ① 또는 ②), 2단계에 모바일 클라이언트 ↔ helmd | `@helm/client`(재접속·재전송), `ui-language`, `daemon`(인증) | 두 접속 경로가 같은 의미(§3.8), `{storeId, seq}` 재개. 연결이 없을 때 결정 입력은 막고 초안으로 보존하며, 응답 전에 끊긴 명령만 같은 멱등 키로 다시 보낸다(판정 J-02, `@helm/client` 진행 중 명령함). 휴대폰 경로는 26 |
| UC-05 혼자 정한 결정 확인과 이의 | 데스크톱 앱 ↔ helmd | `kernel`(이의 규칙), `engine` | 사람 명령은 모델 경로 밖(§3.7.5 a) |
| UC-06 복귀 요약 | 데스크톱 앱 ↔ helmd | `kernel` 투영 계산, `engine.store` 읽기 | 투영 신선도(seq) 표시 |
| UC-07 되돌리기 비싼 선택(C와 A) | helmd ↔ 데스크톱 앱 | `kernel`(의존 규칙, 결과 확인은 사람만), `runtime` 훅 | 사전 차단 능력(13 `preToolInterception = blocking`)과 도구가 사람 권한을 얻지 못하게 하는 격리(§3.7.4). 가역성 판정은 Helm 밖(결정 2) |
| UC-08 반복 마찰을 관찰 에이전트가 찾아 제안(2단계) | 관찰 프로세스(fork) ↔ helmd(IPC) | `observer`, `store/read`, `daemon` 감독기 | 별도 프로세스, 읽기 전용, 제안만, 비밀 없음(§3.6.3). 모델 판정은 기능 플래그 |
| UC-09 Goal 정제 | 데스크톱 앱 ↔ helmd | `kernel`(Goal 변경 사람 확인), `engine` | - |
| UC-10 데몬 재시작·연결 끊김 중 작업 | helmd(systemd 재시작) | `daemon` 수명주기, `runtime` 복구, `store` | 시작 순서(복구 뒤 리스너, §3.6.6), 소비자 커서로 지시 다시 계산(§3.4.6) |
| UC-11 처음 설치·기기 페어링 | `helm` CLI, 데스크톱 앱 ↔ helmd | `cli`, `daemon`(페어링), `store/admin` | 설치 때 월 비용 상한 질문(`budget.monthlyCapUsd`, J-22), 비밀 키 확인(`helm doctor`) |
| UC-17 다른 기기·클라이언트·런타임에서 이어 하기 | 여러 클라이언트 ↔ helmd | `client`(기기별 재개 위치), `runtime/adapter`(이후 런타임) | 기기마다 재개 위치가 따로이고 정본은 하나(§3.9.2 4) |

### 3.15 저장소 디렉터리 구조

저장소 루트는 `~/projects/helm/code/helm`이다(사용자 규칙의 레이아웃 A: 모노레포 `code/<제품>/`). 아래 트리는 구현 첫 단계에서 만들 골격이다 [제안].

```text
helm/
├─ AGENTS.md                    프로젝트 규칙(목적, 스택, 구조, 명령, 완료 기준, 의존 규칙 요약). 템플릿 generic 기반
├─ CLAUDE.md                    "@AGENTS.md" 한 줄
├─ README.md                    한 문단 소개 + 문서 위치 (기존 README 3종은 대체)
├─ justfile                     §3.16
├─ .just/
│  ├─ core.just                 ~/.dotfiles/templates/just/core.just 복사 (수정하지 않음)
│  ├─ node.just                 ~/.dotfiles/templates/just/node.just 복사 (수정하지 않음)
│  └─ helm.just                 Helm 전용 레시피
├─ .mise.toml                   node = "24", pnpm = "11", just
├─ rust-toolchain.toml          Rust 안정판 하나에 고정(20 §3.12.1). 데스크톱 셸 빌드용
├─ .env.example                 §3.17
├─ .gitignore                   node_modules, dist, .env, .just/.last-verify, *.db, .worktrees/, …
├─ lefthook.yml                 템플릿(gitleaks, secrets check) + 빠른 lint
├─ .npmrc                       engine-strict=true, strict-peer-dependencies=true (shamefully-hoist 없음)
├─ package.json                 private, type: module, packageManager, 스크립트(lint/test/build/typecheck), pnpm 설정(overrides)
├─ pnpm-workspace.yaml          packages/*, apps/*, vendor/*, tests, overrides(pi 패키지 버전 묶기, 07 §3.3), allowBuilds(§3.12.3)
├─ pnpm-lock.yaml
├─ tsconfig.base.json           §3.12.2
├─ tsconfig.json                솔루션 파일(모든 패키지 references)
├─ eslint.config.js             §3.5.3
├─ .prettierrc.json, .prettierignore
├─ vitest.config.ts             projects: packages/*, apps/cli, apps/tui, scripts, tests
├─ scripts/
│  ├─ architecture-rules.ts     §3.4.1 표의 코드판
│  ├─ check-architecture.ts     §3.5.2
│  ├─ vendor/                   sync.mjs, changelog-breaking.mjs, check-pi-boundary.mjs (07 §3.18, §3.19)
│  ├─ build-lens-seed.ts        렌즈 seed 생성(15 §3.9.2). 출력은 packages/runtime/src/inquiry/lens/{seed,vocab}. `just lens-seed`가 부른다
│  ├─ gen-push-fallback.ts      `@helm/ui-language`의 푸시 대체 문구를 `packages/protocol/src/push-fallback.generated.ts`로 만든다(26 §3.4). `just gen-push-fallback`이 부른다
│  └─ test/                     검사 스크립트 테스트와 가짜 워크스페이스 fixture
├─ ops/                        운영 파일 (17 §1 3번)
│  ├─ systemd/*.in              helmd.service, helm-backup.timer, helm-restore-drill.timer 등 단위 원본
│  ├─ bin/*                     설치·업그레이드·되돌리기·복구·진단 스크립트(bash, 종료 코드 0/1/2)
│  ├─ windows/check-helm-host.ps1   Windows 호스트 상태 읽기 전용 확인(관리자 권한 불필요)
│  └─ homelab-requests.md       homelab 저장소에 사람이 반영할 변경(serve.table 줄, 백업 경로) 목록
├─ packages/
│  ├─ domain/  protocol/  kernel/  store/  engine/
│  ├─ ai/  agent/  tools/
│  ├─ runtime/  observer/  daemon/
│  ├─ client/  client-react/  ui-language/  ui-tokens/  ui/      L6c (§3.4.13, §3.4.16, §3.4.17)
│  └─ testkit/
├─ apps/
│  ├─ desktop/                  Tauri v2 (src-tauri/ + src/ React 19). 구조는 20
│  ├─ mobile/                   @helm/mobile, PWA(결정 47). 구조는 26 §3.2.1
│  ├─ cli/
│  └─ tui/
├─ vendor/                      pi-agent-core/, pi-tools/, pi-image/, LICENSES/, UPGRADES/, README.md (07 §3.3.1, D07-7)
├─ THIRD_PARTY_NOTICES.md      `just licenses`가 만든다(07 §3.17)
├─ docs/
│  ├─ design/                   설계 문서 00~26 (결정 40). process/는 설계 과정 자료, generated/는 19의 생성 문서
│  ├─ adr/README.md             "ADR 원본은 docs/design/24-adr.md" 한 줄 (템플릿 docs/adr 자리)
│  ├─ product/                  템플릿 자리. 01·02가 정본이므로 README로 가리킨다
│  ├─ specs/                    구현 단계의 기능 스펙 (feature 스킬이 읽는 자리). `spikes/`(23 스파이크 기록), `implementation-status.md`(구현 상태)
│  └─ (기존) foundations/ architecture/ experience/ research/ prototypes/ v0.3/ handoff/   원전, 수정하지 않음
├─ legacy/                      §2.5. 워크스페이스 밖
│  ├─ experimental-v0/          packages/helm-{core,cli,sdk,server}, apps/helm-web
│  └─ agent-docs-init/
├─ tests/                       @helm/tests(비공개): 유즈케이스 대본·하네스·적합성·장애 시험(22 D22-5)
└─ experiments/                 기존 스파이크·pi-lab, `design-prototypes/`(디자인 시안). 워크스페이스 밖
```

패키지 하나의 구조 [제안]:

```text
packages/<이름>/
├─ package.json        name "@helm/<이름>", type "module", exports(§3.12.4 조건 두 개 + 하위 경로), 의존은 workspace:* / 정확한 버전
├─ tsconfig.json       extends ../../tsconfig.base.json, composite, references = 워크스페이스 의존(R11)
├─ README.md           책임 한 문단, 공개 API 목록, 금지 의존 (이 문서 §3.4의 해당 행을 옮긴다)
├─ src/
│  ├─ index.ts         공개 API만 다시 내보낸다
│  ├─ <하위 경로>.ts    exports에 적은 하위 경로 진입점 (예: store의 read.ts, write.ts, admin.ts)
│  └─ internal/…       내보내지 않는 구현
└─ test/               *.test.ts (패키지 단위), fixtures/
```

### 3.16 justfile 레시피

사용자 규칙: 빌드·검증·배포는 just 레시피로만, `just verify` 통과 = 완료, 종료 코드 2 = 환경 문제(코드를 고치지 않고 보고). 템플릿 `core.just`·`node.just`를 그대로 가져오고 Helm 전용은 `.just/helm.just`에 둔다 [제안]. 모든 공개 레시피는 그룹과 한 줄 설명을 가진다(템플릿 `core.just` 규칙).

```just
# justfile (루트)
set shell := ['bash', '-euo', 'pipefail', '-c']
set allow-duplicate-recipes      # node.just의 _verify-steps를 아래 정의로 덮어쓴다
import '.just/core.just'
import '.just/node.just'
import '.just/helm.just'

# Steps behind `just verify`: lint, typecheck, architecture rules, tests, secrets, gitleaks.
[private]
_verify-steps: lint typecheck check-arch docs-check test
    @"{{ just_executable() }}" --justfile "{{ justfile() }}" _secrets-check
    @"{{ just_executable() }}" --justfile "{{ justfile() }}" _need gitleaks
    @"{{ just_executable() }}" --justfile "{{ justfile() }}" _run gitleaks "gitleaks dir --no-banner --redact ."
```

레시피 이름과 내용은 여러 문서가 나눠 정한다. 아래는 저장소 전체 레시피의 색인이다. 각 묶음의 세부(정확한 명령, 종료 코드 2 조건)는 소유 문서가 정하고, 06은 이름 충돌이 없게 묶음과 접두사를 정한다 [제안].

| 묶음(접두사) | 레시피 | 둘 곳 | 소유 |
|---|---|---|---|
| 핵심(템플릿) | `help`(`just`), `info`, `dotenv [env]`, `verify` | `.just/core.just`(복사, 수정 금지) | 사용자 템플릿 |
| Node(템플릿) | `setup`, `check <file>`, `lint`, `test`, `build`, `clean` | `.just/node.just`(복사, 수정 금지) | 사용자 템플릿 |
| 덮어쓰기 | `typecheck`(`pnpm exec tsc -b`), `setup`(템플릿 `setup`에 Playwright 브라우저 Chromium·WebKit 내려받기를 더한다), `_verify-steps` | 루트 `justfile` | 06 |
| 구조 검사 | `check-arch`, `docs-check` | `.just/helm.just` | 06 §3.5, 23 D23-10 |
| 생성 (`gen-*`) | `gen-push-fallback`(생성물을 다시 만든다. `--check`는 현재 값과 비교만 한다) | `.just/helm.just` | 06 §3.4.3, 26 §3.4 |
| 데몬 (`daemon-*`) | `daemon-doctor`, `daemon-install`, `daemon-upgrade`, `daemon-rollback`, `daemon-start`, `daemon-stop`, `daemon-restart`, `daemon-status`, `daemon-logs`, `daemon-backup`, `daemon-restore`, `daemon-verify`, `daemon-drill`, `daemon-diag`, `daemon-probe`, `daemon-serve-line`, `daemon-uninstall`, `daemon-dev`, `daemon-systest`, `daemon-export`, `daemon-backup-copy` | `.just/helm.just`(로직은 `ops/bin/*`) | 17 §3.14 |
| 앱 (`app-*`) | `app-setup`, `app-check`, `app-test-ssh`, `app-e2e`, `app-dev`, `app-dev-mac`, `app-build-mac`, `app-build-local`(Mac), `app-install-mac`, `app-verify-mac`, `app-build-win`, `app-build-win-ci` | `.just/helm.just` | 20 §3.12.2 |
| pi 추적 (`vendor-*`) | `vendor-status`, `vendor-verify`, `vendor-outdated`, `vendor-upgrade to=<tag>`, `licenses`, `ai-smoke` | `.just/helm.just` | 07 §3.18, §5.1 |
| UI (`ui-*`, 화면) | `ui-tokens`, `ui-storybook`, `ui-test`, `ui-visual`, `ui-visual-update`, `ui-check`, `shot`, `shot-mac` | `.just/helm.just` | 21 §6.4 |
| 탐구 엔진 | `lens-seed`(렌즈 seed 다시 생성, 사람이 실행) | `.just/helm.just` | 15 §3.9.2 |
| 모바일 (`mobile-*`) | `mobile-dev`, `mobile-build`, `mobile-check`, `mobile-e2e`, `mobile-shot`, `mobile-vapid-keygen`, `mobile-push-test`, `mobile-sim`(선택, `run-on mac`) | `.just/helm.just` | 26 §3.6.2 |
| 테스트 (`test-*`) | `test-slow`, `test-deep`, `test-scenarios`, `test-faults`, `test-conformance-ssh`, `test-trace`, `test-golden-update`, `test-fixtures-views`, `test-clean`, `test-all`, `coverage`, `e2e-real`, `tape-promote` | `.just/helm.just` | 22 §3.15.3 |
| 모델 평가 (`eval-*`) | `eval-inquiry`, `eval-prompts`, `eval-repl`, `eval-summary`, `eval-observer`, `eval-flows` | `.just/helm.just` | 22 §3.14, 15 §3.15.1 |
| 성능 | `perf`, `perf-seed`, `bench` | `.just/helm.just` | 19, 22 §3.13 |
| TUI (이후 단계) | `tui` | `.just/helm.just` | 이후 단계 |

마이그레이션·복구·검증은 별도 최상위 레시피를 두지 않고 `daemon-*`과 `helm ops …`(17 §3.15)로 한다. 1차 초안의 `dev`, `migrate`, `backup`, `restore`, `db-check`, `daemon-run`은 17의 이름(`daemon-dev`, `helm ops migrate`, `daemon-backup`, `daemon-restore`, `daemon-verify`)으로 바꾼다. 데몬 실행 진입점은 레시피가 아니라 릴리스의 실행 래퍼(`app/current/bin/helmd`)다(17 §3.10).

`verify`의 단계 [제안]: 위 루트 `justfile`의 `_verify-steps`가 lint, typecheck, check-arch, docs-check, test, secrets 검사, gitleaks를 순서대로 돈다. `gen-push-fallback --check`도 `_verify-steps`에 든다. 07의 `vendor-verify`(import 무결성 I1~I5, `sync.mjs verify`)와 `licenses` 일치 검사, 20의 `app-check`, 21의 `ui-check`·`ui-test`, 22의 `test-trace`, 26의 `mobile-check`(워크스페이스 단계로)도 `_verify-steps`에 더한다(07 §3.17·§3.18·§5.1, 20 §3.12.2, 21 §6.4, 22 D22-2, 26 §3.6.2). Mac이 필요한 레시피, Windows 교차 빌드, `app-e2e`, `shot`·`shot-mac`, `ui-visual`(시간이 걸림, 22·23이 넣을지 정한다), `ai-smoke`·`eval-*`(비용 발생), `lens-seed`(사람이 실행), `test-slow`·`test-deep`·`test-faults`·`mobile-e2e` 등 느린 시험(22 §3.15.2)은 넣지 않는다. 마일스톤 관문은 `test-all`(22)을 쓴다.

- `node.just`도 `_verify-steps`를 정의한다. 템플릿 모듈은 고치지 않고, 루트 `justfile`에 `set allow-duplicate-recipes`를 켜고 같은 이름을 다시 정의한다. just 1.58.0에서 확인한 동작: 이 설정이 없으면 같은 이름 정의는 오류다. 설정을 켜면 루트 `justfile`의 정의가 import한 모듈의 정의보다 우선한다. 반면 import한 두 모듈 사이에서는 먼저 import한 쪽이 남았다 [실험, 임시 디렉터리에서 재현]. 그래서 덮어쓰는 정의는 루트 `justfile`에 둔다.
- 화면 작업의 완료 기준에는 `just shot` 비교(Mac 화면은 `just shot-mac`)를, 앱 작업에는 `just app-e2e`를 따로 둔다(사용자 규칙, 20 §3.12.2, 21 §6.4).
- 개발 실행(`daemon-dev`, `app-dev`)에 `node --watch`를 쓰지 않는다(07 §4 E14, §3.12.4).
- pnpm 설정에는 07 §3.3.2의 `overrides`와 21이 요구한 `peerDependencyRules`(assistant-ui 계열의 peer 경고)를 둔다. 정확한 항목은 21 개정판을 따른다.

### 3.17 `.env.example` 키 원칙

사용자 규칙과 dotfiles `docs/SECRETS.md`를 따른다 [원문 `~/.dotfiles/docs/SECRETS.md`].

1. 이 저장소가 읽는 환경 변수는 모두 `.env.example`에 적는다. `KEY=`는 비밀(값은 `~/projects/helm/secrets/<env>.sops.yaml`), `KEY=값`은 비밀이 아닌 기본값이다.
2. 비밀이 아닌 기본값은 개발 데몬(`just daemon-dev`) 기준으로 적는다. 정식 데몬의 값은 설정 파일 기본값(§3.10.2 순위 1)과 systemd 단위가 정한다.
3. 비밀은 데몬만 읽는다. 정식 데몬은 `.env`를 읽지 않고 시작 단계의 비밀 내보내기로 받는다(§3.9.3). `.env`는 개발 데몬과 테스트용이다. CLI·TUI·데스크톱 앱은 비밀 환경 변수를 읽지 않는다. 예외는 개발 레시피 `app-dev` 하나다: Vite 개발 서버의 WebSocket 프록시가 `.env`의 `HELM_DEV_DEVICE_TOKEN`(개발 데몬용 기기 토큰)을 붙인다(20 §3.12.1). 프록시 대상 포트는 `HELM_LISTEN_SSH_PORT`(개발 데몬 7851)에서 읽고 정식 데몬 포트(7841)를 쓰지 않는다. 프록시는 127.0.0.1에만 바인딩하고, 요청 Origin이 Vite 개발 서버 주소일 때만 토큰을 붙인다 [제안, 20에 요구].
4. 데몬이 읽는 비밀 키 이름(설정 `secrets.keys`)과 `.env.example`의 `KEY=` 항목은 같아야 한다. `helm doctor`가 둘을 비교한다(17 §3.3.2).
5. 새 비밀이 필요하면 키 이름을 `.env.example`에 더하고, 값은 사람에게 `secrets edit <env>`를 부탁한다.
6. 지금 `~/projects/helm`에는 `PRODUCT.md`와 `secrets/`가 없다 [실험 `ls ~/projects/helm`]. 구현 시작 전에 사람이 `projects` 스킬 규칙에 맞게 제품 폴더 뼈대(`secrets init` 포함)를 만든다(23에 요구).

초기 목록 [제안, 모델 제공자 키는 07·12가 확정. 환경 변수 이름은 17 §3.3.2]:

```dotenv
# 비밀 아님 (개발 데몬 기본값)
HELM_ROOT=/srv/volumes/helm/dev
HELM_LOG_LEVEL=debug
HELM_SECRETS_FROM_ENV=1
HELM_LISTEN_SSH_PORT=7851
# HELM_CONFIG=           # 비워 두면 ~/.config/helm/helmd.toml
# HELM_SOCKET=           # CLI·TUI용. 비워 두면 $XDG_RUNTIME_DIR/helm/rpc.sock (개발: helm-dev/rpc.sock)

# 비밀 (값은 ~/projects/helm/secrets/<env>.sops.yaml)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
HELM_LEDGER_HMAC_KEY=   # 원장 HMAC 체크포인트 키(09 §3.8.2). secrets.required 기본
HELM_VAPID_PRIVATE_KEY= # 모바일 Web Push 서명 키(26 §3.6.3). 없으면 푸시만 끈다
BRAVE_SEARCH_API_KEY=   # web_search 기본 제공자 키(사람 작업, 카드 필요). 데몬만 읽는다
TAVILY_API_KEY=         # web_search 예비 제공자 키(선택)
```

## 4. 실패·예외·경계 사례

| 번호 | 상황 | 구조상 처리 | 세부 소유 |
|---|---|---|---|
| F1 | 데몬이 내려가 있다(크래시, WSL 종료, Windows 재부팅) | 클라이언트(`@helm/client`)는 연결 상태를 `backoff`/`needsUser`로 바꾸고 캐시를 읽기 전용으로 보인다. 연결이 없을 때 결정 입력은 막고 초안으로 보존한다. 응답 전에 끊긴 명령만 진행 중 명령함에 남아 같은 멱등 키로 다시 보낸다(판정 J-02). 데몬이 다시 뜨면 복구(§3.6.6)가 끝난 뒤 리스너가 열리고, 클라이언트는 `{storeId, seq}`로 이어 받는다 | 17, 19, 20 |
| F2 | 데몬이 두 개 뜬다(수동 실행 + systemd, dev와 prod 설정 혼동) | 같은 데이터 디렉터리면 단일 writer 잠금에서 두 번째가 종료 코드 3으로 끝난다(17 §3.4.5). 개발과 정식은 데이터 디렉터리·소켓 디렉터리·포트가 다르므로 함께 돌 수 있다(§3.9.1) | 17 |
| F3 | 설정 파일이 잘못됐다 | 시작 시: 모든 오류를 출력하고 종료 코드 2(환경 문제), systemd는 다시 시작하지 않는다. 리로드 시: 이전 설정 유지 + 경고(§3.10.5) | 17 |
| F4 | 상태 디렉터리가 `/mnt/c`나 네트워크 파일 시스템이다 | 시작 거부(종료 코드 2, 17 §3.2.3) | 17 |
| F5 | 디스크가 찼다 | SQLite 쓰기 실패 → `engine.submit`이 저장소 오류를 돌려주고 트랜잭션은 롤백된다. 데몬은 읽기 전용(`read_only`)으로 내려가 상태에 표시하고, 새 실행을 시작하지 않는다. 진행 중 실행은 다음 쓰기에서 같은 오류를 받는다 [제안] | 09, 17 |
| F6 | DB 무결성 검사 실패(해시 체인 불일치, `integrity_check` 오류) | 깨진 꼬리를 자동으로 무시하지 않는다. 읽기 전용(17 `read_only`, 19 `readOnly`, 판정 J-67·J-115)으로 시작하고 진단을 표시한다(canon-2 §1.21) | 09, 17 |
| F7 | 마이그레이션 실패 | 직전 스냅숏을 남긴 상태에서 실패하므로 데몬은 시작하지 않고(종료 코드 1) 사람에게 복구 절차를 안내한다 | 09, 17 |
| F8 | Node 주 버전을 올린 뒤 better-sqlite3를 불러오지 못한다 | `helm doctor`와 데몬 시작이 "네이티브 모듈 불일치"로 보고하고 `just setup`을 안내한다. 이것은 환경 문제다(레시피 종료 코드 2) | 17 |
| F9 | 모델 API 키가 없다 | 데몬은 시작하고 해당 제공자를 "사용 불가"로 표시한다. 모델이 필요한 실행만 명확한 오류로 멈춘다(§3.9.3 4번) | 12 |
| F10 | Tailscale 또는 `tailscale serve`가 멈췄다 | 경로 ①이 끊긴다. 경로 ②도 tailnet을 지나므로 Tailscale 자체가 멈췄다면 함께 끊긴다(§3.8.1). serve만 멈췄다면 경로 ②로 붙는다. 데몬 작업은 영향 없다 | 17 |
| F11 | Unix 소켓 파일이 남아 있다(이전 데몬 크래시) | 잠금을 잡은 뒤 남은 소켓을 지우고 다시 만든다. 잠금을 못 잡으면 지우지 않는다(다른 데몬이 쓰는 중). pi-server Unix 리스너도 죽은 소켓을 지우고 다시 bind한다 [원문 pi-facts-2 §4.3] | 17 |
| F12 | 도구 자식 프로세스가 데몬 크래시 뒤 고아로 남았다 | 실행 의도 기록의 pid와 프로세스 시작 시각으로 재시작 때 찾고, 시작 시각까지 일치할 때만 프로세스 그룹을 종료한다(pid 재사용 대비) [원문 S4/openclaw-runtime §5 가져다 쓸 것 4, S4/paseo §8-9]. 그 호출은 "중단됨"으로 닫는다 | 12, 13 |
| F13 | 트랜잭션이 길어져 이벤트 루프가 멈춘다 | 트랜잭션 안 I/O 금지(§3.6.5). `engine`이 트랜잭션 시간을 재고 100 ms를 넘으면 `warn` 로그를 남긴다 [제안]. 22의 성능 시험에 넣는다 | 22 |
| F14 | 느린 클라이언트(송신 대기 바이트가 상한을 넘음) | 그 연결을 끊는다. 클라이언트는 다시 붙어 저장된 구독 위치로 따라온다(pi-server의 `maxPendingBytes`, pi-facts-2 §4.3, §6.1) | 19 |
| F15 | 복원한 DB로 바꿔 seq가 되돌아갔다 | 저장소 epoch(복원 때 새로 발급)가 hello에서 다르면 클라이언트는 캐시를 버리고 스냅숏을 받는다(§3.7.5 c) | 19 |
| F16 | 시계가 뒤로 가거나 WSL이 일시정지했다 | 커널은 `engine`이 넣은 시각만 쓴다. 타이머는 절대 시각으로 저장하고, 스케줄러의 대기는 최대 60초 단위로 끊어 다시 확인한다 [원문 `pi-cases-notes.md` §12.1-9] | 12 |
| F17 | 관찰 에이전트가 시간 제한을 넘기거나 죽었다 | 데몬이 종료시키고 운영 로그에 남긴다. 제안은 이미 보낸 것까지만 남는다. 다음 회차는 정상 진행 | 16 |
| F18 | 모델이 실행한 bash가 `rpc.sock`이나 127.0.0.1:7840·7841에 접속을 시도한다 | 루프백은 격리 경계가 아니다(판정 46). TCP 리스너는 기기 토큰 없이는 주체가 정해지지 않아 거부된다. `rpc.sock`과 데이터·설정 디렉터리는 도구 실행 격리로 가린다(§3.7.4). 격리 수단이 없으면 `execute`가 꺼져 bash가 돌지 않는다(18 R-10) | 13, 18 |
| F19 | 데스크톱 앱과 TUI가 동시에 같은 질문에 답한다 | `engine.submit`이 직렬화하고, 두 번째는 커널이 `conflict`(대상의 `revisionSeq` > 두 번째 명령의 `basisSeq`, 예: `conflict.already_resolved`)로 돌려준다(10 §3.3.4). 두 클라이언트 모두 이벤트로 결과를 받는다 | 10, 19 |
| F20 | 의존 규칙을 어긴 코드가 들어왔다 | `just verify`의 `check-arch`와 `lint`가 실패한다(§3.5) | - |
| F21 | vendor로 가져온 pi 코드의 업스트림이 바뀌었다 | 고정 버전·기준 태그(`v1.1.0`)에서 바뀌지 않는다. 업그레이드는 07 §3.18.4의 절차와 `just vendor-outdated`·`vendor-upgrade`로 한다 | 07 |
| F22 | `~/projects` 동기화(Syncthing)가 작업 중 파일을 바꿨다 | Helm은 파일을 해시로 참조하므로 해시가 바뀌면 그 파일을 근거로 쓴 기록이 낡음(stale)으로 바뀐다(extracts-3 X3-8-11). 동기화 충돌 자체는 Helm이 해결하지 않는다 | 08, 12 |
| F23 | Mac이 잠들어 macOS 앱을 빌드할 수 없다 | `just app-build-mac`·`shot-mac`이 종료 코드 2로 끝난다. 코드를 고치지 않고 보고한다(사용자 규칙) | 20, 21 |
| F24 | 2단계 기능 플래그가 G1 기록 없이 켜졌다 | 데몬은 막지 않고 운영 로그와 `helm status`에 경고를 보인다(§3.10.3 기능 플래그 규칙 2) | 01, 23 |
| F25 | 판정 `needs_gate`를 받은 제출을 같은 멱등 키로 다시 보냈다 | 저장된 `needs_gate` 결과가 재생된다. 질문에 답한 뒤에는 새 멱등 키로 다시 내야 한다(§3.4.6, 10 §3.4.5) | 10, 12, 14 |
| F26 | 데몬 상주 메모리가 1 GB를 넘는다 | `helm status`와 운영 로그 `warn`(17 `health.memoryWarnFraction`). 원인은 커널 상태·투영 캐시 크기에서 먼저 찾는다(§3.6.3 자원 요구) | 17, 22 |

## 5. 다른 문서와의 인터페이스

2a단계에서 01~21의 1단계 판과 판정(`process/rulings-stage2a.md`)을 읽고 맞춘 상태다. 21은 2a단계에 전면 개정 중이므로 21과 관련된 행은 개정판을 다시 확인해야 한다. 26(모바일)은 아직 없다.

### 5.1 이 문서가 제공하는 것

| 받는 문서 | 제공하는 것 |
|---|---|
| 모든 문서 | 패키지 이름·경계·의존 허용 표(§3.3, §3.4.1), 금지 의존 규칙 R1~R14(§3.5), 저장 경계(§3.9.1), 설정 최상위 구조(§3.10.3), 기술 스택과 버전(§3.12) |
| 01, 23 | 기능 플래그 구조(`features.enabledLoops`·`enabledModes`·`flags`, 2단계 기본 꺼짐, §3.10.3), 자원 요구 NFR-C-4·NFR-A-5의 구조상 처리(§3.6.3) |
| 05, 21 | `@helm/ui-language`의 경계(I/O 없음, 데몬은 키와 인자만, §3.4.16), `@helm/ui-tokens`·`@helm/ui`의 경계(§3.4.17) |
| 07 | vendor 3개와 감싸는 패키지 대응(R7과 예외), `@helm/ai/pi`·`@helm/domain/model` 하위 경로(R2), vendor tsconfig 덮어쓰기 허용(§3.4.18), ESLint·Prettier의 vendor 제외, 정확한 버전 고정 정책, `vendor-*` 레시피 자리(§3.16) |
| 08, 09 | 정본 DB 하나·전역 seq(ADR-06-05), 파일 시스템 제약, 쓰기는 `engine`만, `store` 하위 경로 `read`·`write`·`admin`·`testing`과 인스턴스 잠금 위치(§3.4.5), JSONL은 내보내기 전용 |
| 10, 11 | `engine`의 접수 상자와 `decide` 주입 구조, `SubmitResult`의 다섯 상태(`needs_gate` 포함, §3.4.6), 커널 순수성 규칙(R4, R5), `KernelContext` 요약 |
| 12, 13 | 데몬 내장 1차 런타임 배치, `engine.transact`와 `appendTrace`, 커널 검사 지점 셋(§3.13.3), 보장 수준 계산을 저장하지 않는 규칙(§3.13.4), 어댑터 위치, 적합성 시험 위치, 데몬 안 실행 모델(동기 트랜잭션, 트랜잭션 안 I/O 금지), 스트리밍 델타는 정본 밖 |
| 14, 15 | `@helm/kernel/orchestration`(순수 코어)과 `@helm/runtime/orchestration`(효과)의 배치, 운영 한도 `orchestration` 절, `inquiry` 절, `budget` 절(§3.10.3), 레시피 `lens-seed`·`eval-inquiry`(§3.16), `scripts/build-lens-seed.ts` 위치(§3.15) |
| 16 | 관찰 프로세스의 의존 경계(`client`·`protocol` 금지 포함), 프로세스 배치의 일회성 자식(ADR-06-02), 설정 절 `observer`, 모델 판정은 기능 플래그 |
| 17 | 패키지·레이어 구조, 설정 형식(TOML)·최상위 스키마·핫 리로드 분류, 관측 흐름 4개 분리, 마스킹 훅 구조(§3.11.3), 레시피 색인(§3.16), `ops/` 위치와 `helm-secret-export` 진입점(§3.4.12, §3.15) |
| 18 | 연결 처리 3층과 판정 46의 구조 요구(§3.7.4), 도구 격리가 가려야 할 경로 목록, 비밀 구조 규칙(§3.9.3), 마스킹 규칙 표의 위치(`@helm/domain/src/redaction/`) |
| 19 | 전송·인증·프로토콜 층 분리, `@helm/client` 별도 패키지(`protocol`에만 의존, 진입점 루트·`node`·`testing`), 관찰 에이전트는 클라이언트 프로토콜을 쓰지 않음 |
| 20, 21 | 앱의 허용 의존(`client`, `protocol`, `ui-language`, `ui`, `ui-tokens`, `domain` 타입), 앱 안 층 규칙 R14, 레시피 묶음 `app-*`·`ui-*`, Node 하한 24.15, Rust 도구 고정 위치 |
| 22 | 의존 규칙 검사와 그 테스트, 세 리스너 동등성 시험, 어댑터 적합성 시험 위치, `testkit` 범위, 트랜잭션 시간 목표, 대기 자원 측정(NFR-C-4) |
| 23 | 저장소 골격과 이전 구현 이동(§2.5, §3.15), 구현 단위 S0~S9(§6) |
| 24 | ADR-06-01~ADR-06-21 (대응: 01 토폴로지 §3.6.1, 02 프로세스 구성 §3.6.3, 03 패키지 경계 §3.3(대체됨 → 17), 04 의존 강제 §3.5, 05 DB 하나 §3.9.2, 06 JSONL §3.9.5, 07 Node 24 §3.12.2, 08 TS 6.0 §3.12.2, 09 better-sqlite3 §3.12.3, 10 능력 목록 §3.13.4(대체됨 → ADR-13-04), 11 설정 §3.10, 12 로깅 §3.11, 13 연결 처리와 자격 증명 §3.7.2·§3.7.4, 14 이전 구현 처리 §2.5, 15 빌드 형태 §3.12.4, 16 린트·형식 §3.12.1, 17 패키지 경계 2판 §3.3·§3.4, 18 기능 플래그 §3.10.3, 19 `RuntimeStorePort` §3.4.6, 20 오케스트레이션 순수부 §3.4.4, 21 대화형 쓰기 트랜잭션 §3.4.5·§3.4.6) |
| 26 | 모바일 앱 자리(`apps/mobile`), 의존 규칙(데스크톱과 같음), 접속 경로가 지켜야 할 의미 조건(§3.8.1), 공유 패키지 넷(§3.4.15) |

### 5.2 다른 문서에서 받은 것 (06이 따름)

| 문서 | 받은 결정 | 06에서 반영한 곳 |
|---|---|---|
| 판정 | §2 패키지(`client` 복원, `ui-language`, vendor 3개, `engine`, `testkit`), 포트 7840·7841·`rpc.sock`, TOML 설정, 데이터·잠금 위치, `observer → client` 없음. J-02, J-07, J-11, J-13, J-14, J-17, J-22, J-25, J-56, J-57, J-68, J-69, J-70, J-85 | §3.3, §3.4, §3.6~§3.10, §3.13, §3.14, §4 |
| 판정 J-190·결정 55 | MVP 도구 단계(웹 읽기·검색, 해시라인·grep 확장, 브라우저는 MVP 후반, 컴퓨터 사용은 이후), `helm-browserd`와 변환 작업자의 위치(`packages/tools`, 13의 06 요구 (1)), `net:public`, 외부 효과 가로채기, 웹 출력 표식, 설치 항목과 비밀, 23 스파이크 | §3.4.9, §3.6.3, §3.6.7, §3.7.1, §3.12.5, §3.16, §3.17, §6 S10~S12 |
| 판정 J-155·J-181·J-182 | 지표 소비자는 `runtime`(J-155. 23이 고친다), `FeatureKey` 첫 목록은 23 §3.5.4(J-181), 파생 ID 입력은 멱등 키 범위(J-182, 10 §3.1.3) | §3.4.2, §3.4.4, §3.4.6, §3.10.3 |
| 22 | `@helm/tests`와 시험 전용 층, testkit API(§3.5.2), 테스트 위생 ESLint(22/ST-02), `test-*`·`bench` 레시피, `just setup`의 Playwright 설치 | §3.3.1, §3.4.14, §3.5.1, §3.5.3, §3.15, §3.16 |
| 23 | 레시피 색인(`docs-check`, `daemon-export`, `daemon-backup-copy`, `ui-tokens`, `bench`), `_verify-steps` 구성, `FeatureKey` 첫 목록과 관문 기록 확인, 트리 항목(`design-prototypes/`, `spikes/`, `.worktrees/`) | §3.10.3, §3.15, §3.16 |
| 26 | `push-fallback.generated.ts`의 생성 단계와 생성물 검사(26 §5.2 06 (7)), `allowedEndpointSuffixes`(J-154) | §3.4.3, §3.10.3, §3.15, §3.16 |
| 브리프 41~46 | React 19, 모바일, Caustic 토큰 복사, Node 24·TS 6.0·pi `v1.1.0`, 비밀 자식 로더, 루프백은 격리 경계 아님 | §2.1, §3.4.15, §3.7.4, §3.9.3, §3.12 |
| 01 | 기능 플래그(ADR P1-5), NFR-C-1 월 비용 상한, NFR-C-4 자원, NFR-A-5 이중화 없음, 단계표(§3.8) | §3.6.3, §3.10.3, §3.14 |
| 02 | UC-01~19 목록과 단계(UC-04 휴대폰은 2단계) | §3.14 |
| 05 | A9 `@helm/ui-language` | §3.3, §3.4.16 |
| 07 | vendor 3개, 고정 의존 `1.1.0`, import 허용 표(§3.9.1)와 vendor 예외, `@helm/ai/pi`, `@helm/domain/model`, vendor tsconfig 옵션, `node --watch` 금지(E14), 레시피 `vendor-*`·`licenses`·`ai-smoke` | §3.3.1, §3.4.1, §3.4.7~§3.4.9, §3.4.18, R2, R7, §3.12, §3.15, §3.16 |
| 09 | `commitBatch(inputs, traces)`와 주입된 `decide`, outbox 없음과 `consumer_cursors`, 하위 경로 함수 목록, 잠금은 17 방식(D09-7) | §3.4.5, §3.4.6, §3.6.6, §3.9.1 |
| 10 | `decide`/`apply`/`react`, `KernelContext{now, cursor, newId, rules, attention}`(presence는 커널 상태), `DecisionStatus` 다섯, `Directive` 일곱, `derivedIdFactory`, `basisSeq`·`expect`(전역 `expectedSeq` 없음), 채널 일곱, `EngineInput` 대응(§3.3.5) | §3.4.4, §3.4.6, §3.7, §4 F19·F25 |
| 12 | `engine.transact(fn)`과 `tx.appendTrace`, 모델 재시도는 `@helm/ai` 한 곳 | §3.4.6, §3.7.1 |
| 13 | `CapabilityManifest`(키 15개), Level과 성질 G1~G8 계산, 중립 이벤트 어휘, `RuntimeAdapter`·`KernelGate` | §3.13.3~§3.13.5 |
| 14 | `@helm/kernel/orchestration`·`@helm/runtime/orchestration`, 오케스트레이터 루프 하나, 운영 한도와 `features.*`는 `helmd.toml` | §3.3.1, §3.4.4, §3.4.10, §3.10.3 |
| 15 | `InquiryConfig`, 레시피 `lens-seed`·`eval-inquiry`, `scripts/build-lens-seed.ts` | §3.10.3, §3.15, §3.16 |
| 16 | 관찰 프로세스는 fork + Node IPC(격리 실행 때 `systemd-run`), 비밀 없음, 모델 호출은 데몬 대행, `metrics`·`ipc` 하위 경로, 마스킹 규칙은 `@helm/domain`, 관찰 캐시는 `@helm/store/aux`, `[observer]`는 운영 부분만 | §3.4.1, §3.4.2, §3.4.5, §3.4.11, §3.6.3, §3.7.1, §3.7.5, §3.10.3 |
| 17 | 리스너 셋과 포트(개발 7851), 데이터 디렉터리 배치, 잠금 파일, 시작·종료 순서, 종료 코드 0~5, `helmd.service`, 비밀 로더(§3.8), 운영 설정 절, 백업 위치, 릴리스 배포, `daemon-*` 레시피, CLI 명령 목록, `ops/` | §3.1, §3.4.12, §3.6, §3.9, §3.10, §3.11, §3.12.4, §3.15~§3.17 |
| 18 | R-10(격리 수단이 없으면 `execute`를 끄고 S0은 운영자만), 기기 토큰 해시 저장, 설정 키 거부 목록(`privateKey` 포함) | §3.7.4, §3.10.3, §7 O-10 |
| 19 | SSH 경로 B3(`ssh -W`), `@helm/client`(`HelmClient`, 진입점 `.`·`./node`·`./browser`), `{storeId, seq}` 재개, 휘발 스트림, 관찰 에이전트는 `aux_agent` IPC, `SubmitResult`의 `needs_gate` | §3.3, §3.4.3, §3.4.13, §3.7, §3.8 |
| 20 | 전송은 Rust 소유(APP-D02), `ssh -W`(APP-D03), SSH 경로에서도 기기 토큰(APP-D04), `credentials` 선택 인자 없음(판정 J-118), Node 24.15 이상, 앱 안 층 규칙, Rust 도구, `app-*` 레시피, `@helm/client-react`와 그 금지 의존(§3.14) | §3.4.13, §3.4.15, R14, §3.12, §3.15, §3.16 |
| 21 | `@helm/ui-tokens`·`@helm/ui`(UI-D13, UI-D19), `ui-*`·`shot-mac` 레시피, `peerDependencyRules` | §3.3.1, §3.4.17, §3.16 |

### 5.3 다른 문서에 요구하는 것

| 문서 | 요구 |
|---|---|
| 01, 23 | `FeatureKey` 목록(루프·모드 밖의 2단계 기능)과 각 키의 단계. 23은 G1 기록 뒤 켜는 순서 |
| 08 | `@helm/domain/model`의 타입 이름 확정(07 §3.9.2와 함께) |
| 10 | (1) `SubmitResult`를 이 문서 §3.4.6의 다섯 상태로 받는지 확인(10 §3.3.5 끝의 요구에 대한 답). (2) `CommandDraft`(접수가 채우는 필드를 뺀 envelope) 이름 확인 |
| 12 | (1) 스트리밍 델타의 정본 기록 시점. (2) 모델 제공자 목록과 `.env.example` 키. (3) 갱신형 자격 증명 지원 여부(§7 O-08). (4) `budget.monthlyCapUsd`의 집행(80% 알림, 100% 새 실행 중단, 01 NFR-C-1). (5) `user.timeZone` 사용 |
| 13 | (1) 13 §3.6.2에 남은 데몬 포트 7801을 7840·7841로. (2) 외부 어댑터와 데몬 사이 채널(`adapter` 채널)의 전송(§3.13.5) |
| 15 | `InquiryConfig`를 `packages/runtime`(또는 `domain`)에서 TypeBox 스키마로 내보내기(§3.10.3이 import) |
| 16 | (1) 관찰 설정 절의 운영 부분을 `ObserverConfig`로 내보내기(§3.10.3이 import). (2) 모델 판정·제안 기능의 `FeatureKey` 이름. (3) 마스킹 규칙 표와 적용 함수를 `@helm/domain/src/redaction/`에, 관찰 캐시는 `@helm/store/aux`로 연다(16 요구 (1)(2)를 받음) |
| 17 | (1) 인스턴스 잠금 함수를 `@helm/store/admin`으로(판정 J-101). (2) 리스너 키 `loopback`(판정 J-102). (3) systemd 단위의 `MemoryHigh`·`MemoryMax`를 NFR-C-4(1 GB)와 맞추기. (4) `features`·`orchestration`·`budget`·`inquiry`·`user`·`mobile`·`push` 절의 리로드 분류 확인 |
| 18 | (1) 모바일 기기 인증(`__Host-helm_dt` 쿠키 운반과 Origin 검사, 판정 J-118, 결정 42). (2) 공통 마스킹기를 로거 훅으로 쓸 수 있는 인터페이스(§3.11.3)와 마스킹 규칙 표를 `@helm/domain/src/redaction/`에 두는 것의 확인 |
| 19 | (1) `@helm/client/testing` 진입점을 진입점 목록에 더하기(가짜 전송·가짜 시계). (2) 세 리스너 동등성 적합성 시험 |
| 20 | (1) 앱이 L6c 패키지만 쓰고 `kernel`을 import하지 않음(R12). (2) `src/ui/copy/`를 두지 않고 `@helm/ui-language`를 씀. (3) UI 부품을 처음부터 `packages/ui`에 두기(판정 J-85, 20 §3.14 표의 "UI 부품" 행) |
| 21 | (1) 문구 사전(`apps/desktop/src/ui/copy/ko.ts`, 21 §3.6.7)을 `@helm/ui-language`의 키로 옮기기(05 A9, 판정 §2). (2) `@helm/ui`의 외부 의존 목록과 `peerDependencyRules` 항목. (3) 개정판에서 `ui-tokens`·`ui` 경계가 §3.4.17과 같은지 |
| 22 | 의존 규칙 검사 테스트, 세 리스너 동등성 시험, 어댑터 적합성 시험, 트랜잭션 시간 시험, 대기 CPU·RSS 시험(NFR-C-4)을 테스트 계층에 넣기 |
| 23 | 첫 마일스톤에 §6 S0~S5를 넣기. 구현 시작 전 제품 폴더 뼈대(`PRODUCT.md`, `secrets/`)를 사람이 만들기 |
| 26 | (1) 모바일 앱 디렉터리 이름과 패키지 이름. (2) 공유 패키지 넷 중 무엇을 쓰는지. (3) 접속 경로와 알림 경로가 데몬 리스너·인증에 요구하는 것(새 리스너가 필요하면 06·17·18과 맞춘다) |

### 5.4 4단계 보완에서 다른 문서에 요구하는 것

| 문서 | 요구 |
|---|---|
| 07 | vendor 패키지 매니페스트 `exports`에 `source` 조건(§3.12.4) |
| 09 | (1) 동기 대화형 쓰기 트랜잭션 `transaction(fn)`과 `tx.commitOne`, `commitBatch`는 그 위 편의 함수(판정 J-148). (2) 메서드형 `KernelView`를 두지 않고 결정 입력은 10 `KernelState`, 저장 결과 이름은 `SubmitResult`(§3.4.2 표). (3) 같은 키·다른 지문은 `key_reused` 갈래(이벤트·행 없음). (4) `@helm/store/admin`의 `openOffline(dataDir, { mode })`. (5) 커널 스냅숏 주기·형식과 소비자 커서 `directives` |
| 10 | (1) `commandId`는 engine이 접수 때 발급(제출자 값은 검사 후 사용). (2) 파생 ID의 시각 부분은 `issuedAt`, 나머지는 `sha256(commandId:순번)` 앞 10바이트. (3) 경계 타입을 `@helm/domain/src/kernel-contract.ts` 한 벌로 |
| 12 | (1) 설정 절 이름 `ai`(`AiConfig`)와 `budget.monthlyCapUsd`. (2) 관찰 에이전트 `llm.complete`와 지표 소비자는 `runtime` 소유(§3.4.10). (3) `RuntimeDeps.config`의 절 이름을 06 §3.10.3 표와 같게 |
| 13 | (1) `ProposalSink` 타입 정의, 구현은 12 `run/hooks.ts`. (2) 어댑터 계약 중립 타입을 `@helm/domain/src/adapter-contract.ts`로. (3) 중립 신호 표의 "06 이름" 열 삭제(06은 이름을 적지 않는다) |
| 16 | 지표 값 타입을 `@helm/domain`에 두고 `@helm/protocol`이 `observer` 타입을 재export하지 않게 |
| 17 | (1) 공개 주소 키는 `listeners.tailnet.publicOrigin` 하나. (2) `mobile`·`push`·`budget` 절 스키마와 `daemon-install`의 월 비용 상한 질문. (3) CLI 종료 코드 표(데몬 연결 실패는 2). (4) 오프라인 CLI의 HMAC 키 로딩(§3.4.5). (5) 릴리스의 `web/mobile/`, `helm pair --mobile`, `helm push test` |
| 18 | (1) 외부 런타임 어댑터 주체 `runtimeAdapter{runId}`(run 단위 단기 토큰, `model_tool` 제출과 run 조회만, §3.7.4 5). (2) 판정 J-134 네트워크 격리와 J-135 localAdmin 확인 문자열. (3) 바깥 연결 허용 목록에 Web Push 서비스 |
| 19 | `runtimeAdapter` 주체의 scope 표 행 |
| 20 | `app-dev` 프록시 대상 포트를 `HELM_LISTEN_SSH_PORT`에서, 127.0.0.1 바인딩, Origin 조건(§3.17 3) |
| 22 | testkit 주입 지점 이름을 09·19 API에 맞추고 KIT 항목을 행으로. `@helm/ai/testing` 사용 |
| 23 | (1) M0-07 완료 조건을 R1~R14로. (2) M4에 엔진 시작·크래시 복구(스냅숏 적재, 지시 재계산) 행. (3) 판정 J-128 위치(`@helm/kernel/orchestration`에 15 순수부 포함). (4) 결정 51의 WBS 열(난이도·담당 단계·모델) |
| 26 | `@helm/mobile` 이름 확정과 의존 행 반영을 확인(§3.4.1, §3.4.15) |

## 6. 구현 단위와 완료 기준

순서는 23이 정한다. 아래는 이 문서가 정한 구조를 만드는 단위와, 테스트로 확인할 완료 조건이다. 모든 단위의 공통 완료 조건은 `just verify` 통과다. 데몬 운영 단위(설치, 업그레이드, 백업, 복구 훈련)의 완료 기준은 17 §6에 있다.

| 단위 | 내용 | 완료 기준 |
|---|---|---|
| S0 저장소 골격 | §2.5 이전 구현 이동(`git mv`), §3.15 파일·디렉터리, 빈 패키지(각 `src/index.ts`, `package.json`, `tsconfig.json`, `README.md`. L6c 넷 포함), vendor 패키지 자리 3개(07), `.just/` 템플릿 복사, 루트 justfile, `.mise.toml`, `.env.example`, `AGENTS.md` | `just setup && just verify`가 빈 패키지에서 통과한다. `just`가 §3.16의 06 소유 레시피를 보인다. 각 패키지의 `exports` 진입점이 Node 해석으로 불러와진다(시험 스크립트). 루트에 `@helmdocs/*`가 워크스페이스로 남아 있지 않다 |
| S1 실행 형태 확인 | `source` 조건 + Node 타입 제거 실행이 워크스페이스 패키지에서 되는지(§3.12.4 [가정]), `tsc -b` 빌드, Vitest `source` 조건 | `node --conditions=source packages/daemon/src/bin/helmd.ts --version`이 동작한다. 안 되면 대체 방식으로 바꾸고 이 문서를 고친다 |
| S2 의존 규칙 검사 | `scripts/architecture-rules.ts`, `check-architecture.ts`, ESLint 패키지별 규칙, 테스트 fixture | 규칙 R1~R14마다 위반 fixture가 실패하고(종료 코드 1, 위반 위치 출력), 정상 fixture가 통과한다. 실제 저장소에서 통과한다. `kernel`에 `Date.now()`를 넣으면 `just lint`가 실패한다. `desktop`에 `@helm/kernel` 의존을 더하면 `check-arch`가 실패한다. `observer`가 `@helm/ai`나 `@helm/client`를 import하면 실패한다. `client`가 `@helm/domain`을 직접 import하면 실패한다. `runtime`의 루프 구동 파일 밖에서 `@helm/ai/pi`를 import하면 실패한다. `ai`가 `@helm/vendor-pi-tools`를 import하면 실패한다(R7) |
| S3 설정과 로그 | `daemon/src/config/`(최상위 스키마, TOML 로더, 우선순위, 출처 표시, 리로드 분류, 기능 플래그), `Logger` 인터페이스와 pino 구현, redact와 마스킹 훅 | 우선순위 5단계가 시험으로 확인된다. 모르는 키, `host`가 127.0.0.1이 아닌 값, 데이터 경로가 `~/projects` 아래·`/mnt/` 아래이면 거부하고 종료 코드 2다. 비밀처럼 보이는 키가 설정에 있으면 거부한다. 리로드 시 잘못된 설정이면 이전 설정이 유지된다. redact 경로의 값과 마스킹기에 등록한 값이 로그에 나오지 않는다(필드 이름이 달라도). 설정이 없으면 2단계 `features.flags`가 모두 false다 |
| S4 엔진 골격 | `createEngine`, 동기 `submit`·`transact`(`store.transaction` 위), `appendTrace`, `RuntimeStorePort` 구현, `onCommitted`, `onDirective`, `derivedIdFactory`(10·09의 실제 규칙은 해당 단위에서) | 같은 멱등 키·같은 지문 재시도가 `replayed: true`로 같은 결과를 돌려준다. 같은 키·다른 지문은 `key_reused`이고 이벤트와 `commands` 행이 생기지 않는다. 한 `transact` 안에서 뒤 제출이 앞 제출의 결과를 본다(판정 J-148). `runtime`이 `RuntimeStorePort`만으로 복구·스케줄러에 필요한 값을 읽는다(판정 J-127). `basisSeq`보다 뒤에 바뀐 대상은 `conflict`다. 거부·`needs_gate`·`conflict`도 seq를 가진 `command.rejected` 이벤트로 남는다(판정 J-25). `error`는 저장되지 않는다. 트랜잭션 안에서 예외가 나면 이벤트·투영·`commands` 행·실행 기록이 모두 롤백된다. 같은 제출을 다시 결정하면 같은 ID가 나온다. `engine` 밖에서 이벤트를 append하는 코드 경로가 없다(S2 검사로 확인) |
| S5 리스너와 전송 | 리스너 셋(17), 인증층 인터페이스, 프로토콜 처리기 한 벌, `@helm/client/node` 전송(TCP, Unix) | 같은 대본을 `tailnet`·`loopback`·`local` 세 리스너에서 돌려 응답·이벤트 열이 같다(리스너별 사전 검사 차이 제외). 자격 증명 없는 연결은 프로토콜층으로 넘어가지 않는다. 출발지가 127.0.0.1이어도 TCP 리스너는 기기 토큰 없이 거부한다 |
| S6 SSH 경로 | `ssh -W` 경로 통합 시험(20 `app-test-ssh`와 같은 시험 환경) | S5의 대본을 `ssh -W` 바이트 스트림 위에서 돌려 결과가 같다 |
| S7 관찰 감독기 경계 | 데몬 감독기의 IPC 처리(16 §3.2.3), 행위자 고정 | IPC로 온 제출의 행위자는 관찰 프로세스가 보낸 값과 상관없이 `agent:observer`다. 관찰 프로세스의 DB 연결로 쓰기를 시도하면 실패한다. 관찰 프로세스 환경에 비밀 변수가 없다 |
| S8 진단 명령(06 몫) | `helm events tail`, `helm export`, `helm config check/print/schema` | `helm export`가 데몬 없이 DB 파일만으로 동작한다. 출력에 비밀 값이 없다. `config print`가 값마다 출처를 보인다 |
| S9 어댑터 계약 골격 | 계약 타입(`@helm/domain/src/adapter-contract.ts`, 13 §3.11.2)과 `@helm/runtime/adapter`의 구현, Level·보장 수준 계산(13 §3.11.5), 가짜 런타임 어댑터, 적합성 시험 틀 | 1차 어댑터와 가짜 어댑터가 같은 faux 대본에서 provenance를 뺀 같은 도메인 이벤트 열을 낸다. 광고한 능력과 실제 동작이 다른 가짜 어댑터를 시험이 잡아낸다 |
| S10 웹 읽기 | `packages/tools/src/web/`(`fetch.ts`, `search.ts`, `convert-worker.ts`). 변환 작업자는 네트워크 없이 돈다(R16). 샌드박스 사양은 `network: 'none'`이다 | T-WF-01~04, T-WS-01~02(13 U-TL-18): 주소 차단 표, 리디렉션 재판정, 변환 작업자의 네트워크 없음, `maxBytes`와 `web.too_large`, 기본 제공자 실패 때 예비 한 번, 월 상한과 `web.quota_exceeded`. S0에서는 `web_fetch`가 묶음에 없다 |
| S11 브라우저 도구 | `packages/tools/src/browser/`와 `helm-browserd`(S1, 프록시 네임스페이스, CDP 파이프, 비밀 없음). 1단계는 읽기 멤버, 2단계는 상호작용과 요청 가로채기다 | T-BR-01~07(13 U-TL-19). browserd 환경에 모델 키와 `SecretStore` 값이 없다(T18-45). 샌드박스 밖에서는 기동하지 않는다 |
| S12 해시라인과 grep 확장 | `packages/tools/src/basic/edit-hashline.ts`, `basic/grep.ts`. `RunSpec.editMode`는 run 시작에 고정하고 기본값은 `replace`다 | T-HL-01~05, T-GR-01~04(13 U-TL-20·21). 태그는 모델용 별칭이고 guard는 sha256이다. 모델별 기본값은 23의 A/B 스파이크 뒤에 정한다 |

## 7. 미결 사항

| 번호 | 질문 | 선택지 | 추천 기본값 |
|---|---|---|---|
| O-01 | (해소) SSH 경로 방식 | - | B3 `ssh -W`로 정해졌다(19 P-02, 20 APP-D03, 17 D17-09) |
| O-02 | serve 이름 방식 | 8448(serve 포트) / `helm.stackmellow.com`(Caddy) | 8448. 이름 방식은 17이 검토 |
| O-03 | TypeScript 7로 옮길 시점 | 지금 7 + 타입 정보 없는 린트 / 6.0 유지 후 이동 | 6.0 유지. typescript-eslint가 7을 지원하면 옮긴다 |
| O-04 | `node:sqlite`로 옮길지 | 유지 / 이동 | better-sqlite3 유지. 재검토 조건은 §3.12.3 |
| O-05 | 개발 실행을 소스 직접 실행으로 할 수 있는지 | Node 타입 제거 + `source` 조건 / `tsc -b --watch` + 수동 재시작 | 앞의 것. S1에서 확인 |
| O-06 | 어댑터 계약을 별도 패키지로 꺼낼 시점 | 지금 / 저장소 밖 어댑터가 생길 때 | 생길 때 |
| O-07 | DB가 커질 때 오래된 실행 기록 처리 | 그대로 / 보관 파일로 이동 / 용량 줄이기 | 그대로 시작. 17이 크기 지표를 두고 문턱을 정한다 |
| O-08 | 갱신형 자격 증명(구독 OAuth 등)을 지원할지 | API 키만 / OAuth 포함 | API 키만으로 시작. 필요하면 `/srv/volumes/helm/` 아래 `secrets` 디렉터리(0600, 백업 제외)에 두고 18이 규칙을 정한다 |
| O-09 | (해소) 설정 파일 형식 | - | TOML(판정 §2). 17이 맞췄다 |
| O-10 | (해소) 격리가 없는 실행 환경에서 로컬 관리자 주체 | - | 18 R-10: 격리 수단이 없으면 `execute`를 끄고, S0은 운영자 설정으로만 연다(§3.7.4 4번) |
| O-11 | CI | `just verify`를 GitHub Actions에서도 / 서버에서만 | `just verify`는 서버에서만(비밀·SOPS 키가 서버에 있음). Windows 앱 빌드만 20의 `app-build-win-ci`가 사람 확인 뒤 수동 실행한다 |
| O-12 | Renovate 같은 자동 업그레이드 | 쓴다 / 안 쓴다 | 안 쓴다(§3.12.1). homelab은 Renovate를 쓰지만 Helm은 pi 추적이 사람 판단을 요구한다(07 §3.18) |
| O-13 | 진단 span을 외부로 내보낼지 | 내보내지 않음 / OTLP | 내보내지 않음. `trace` 수준에서 로그로만 |
| O-14 | (해소) 모바일 앱이 `@helm/ui`를 함께 쓸지 | - | 함께 쓴다(결정 47 PWA, 26 §3.2.1) |
| O-15 | 2단계 기능 플래그를 G1 기록 없이 켜는 것을 막을지 | 경고만 / 막음 | 경고만(§3.10.3). 사용자가 한 명이고 실험을 위해 먼저 켤 수 있어야 한다. 23이 관문 운영을 정하면 다시 본다 |
| O-16 | (해소) 모바일 접속에 새 리스너가 필요한지 | - | 필요 없다. 휴대폰은 `tailnet` 리스너만 쓰고 푸시는 데몬이 직접 보낸다(26 §3.3.1, §3.4) |
| O-17 | (해소) `@helm/ui`를 데스크톱 MVP 때부터 만들지 | - | 처음부터 패키지(판정 J-85). 20 §3.14의 "지금은 `apps/desktop/src/ui`"는 20이 고친다 |
| O-18 | 웹 본문 변환기 | readability + turndown(`linkedom` 위) / defuddle(0.19.5, MIT) | readability + turndown. 23 스파이크(한글 페이지 변환 품질, §3.12.5)에서 비교하고, 나쁘면 바꾼다 |

## 8. 출처

브리프와 원천 정리:

- `docs/design/process/00-design-brief.md` 전체(결정 1~57, §2.4b, §2.4c, §2.5, §3, §5, §6)
- `docs/design/process/rulings-stage2a.md`(2a단계 조정자 판정 §1~§9)
- 웹·브라우저·해시라인 도구 조사: `.helm-design-work/coordinator/stage4c/research-browser.md`(§5.2, §6.1, §7, §8), `research-ohmypi.md`(§3, §4, §6). 패키지 판과 설치 스크립트는 `npm view`로 확인했다(2026-10-14) [실험]
- `process/sources/conversation-extracts-4.md` 17장(배치 A/B/C, 대화 L4347–4382), 18장(선행 작업 7항목, ADR 형식, L4386–4406), 19·20·21장(d22, d23, d24, d28)
- `process/sources/conversation-extracts-1.md` 1장(이식성 3계층 E1-002~E1-018), 2장(사례 E1-022~E1-050), 6·7장(관찰 에이전트, pi 매핑 E1-070~E1-102), 15장 목록(Q14)
- `process/sources/conversation-extracts-2.md` 6.4~6.7(3계층 엔진, pi 확장 매핑, 구현 순서), 9장 목록
- `process/sources/conversation-extracts-3.md` 3.8, 4장(pi 안의 Helm X3-4-01~18), 8장(순수 Helm 런타임 X3-8-01~30), 11장 목록(Q6, Q21)
- `process/sources/helm-canon.md` §11.14, §13(F07 아키텍처 불변조건), §16.2~§16.9, §16.12, §20.3, §21(06·24 체크리스트)
- `process/sources/helm-canon-2.md` §1.1~§1.8, §1.15~§1.27(커널 v0.2 후보), §3.15~§3.16, §8(packages/helm-*), §9.6~§9.9, §10, §11(06·24 체크리스트)
- `process/sources/helm-canon-3.md` §4.1, §5.1.6, §5.2.6, §6.10, §7, §8(06·24 체크리스트)
- `process/sources/pi-api-facts-1.md` §0, §1, §9
- `process/sources/pi-api-facts-2.md` 전체
- `process/sources/pi-layer-analysis.md`
- `process/sources/pi-cases-notes.md` §1, §2, §11, §12, §13
- `.helm-design-work/S4/{openclaw, openclaw-gateway, openclaw-runtime, paseo, pi-fabric, pi-web}.md`

원문:

- `docs/v0.3/08-runtime-architecture.md`, `12-implementation-architecture.md`(§15 포함), `13-stack-feasibility.md`, `14-alternative-structure.md`
- `docs/v0.3/audit/audit-report.md`, `backend-oss-research.md`, `mastra-review.md`, `pi-runtime-options.md`
- `docs/design/01-product-brief.md`(P1 1단계 초안), `.helm-design-work/P1/notes.md`(MVP 범위)
- 다른 설계 문서 1단계 초안(작성 중 확인, 맞춘 결정은 §5.2): `07-pi-reuse-and-fork.md`(§2.4 D07-1~11, §3.3, §3.6.3, §3.9, §4 E14, §5.1), `12-runtime-engine.md`(§2.3, §3.1, §5), `16-observer-and-metrics.md`(§3.2, §5.2, ADR 후보), `17-daemon-and-operations.md`(§2.4 D17-01~15, §3.2, §3.3, §3.4.5, §3.5, §3.14, §3.15), `19-client-protocol.md`(§2 P-01~P-15, §3.2), `20-desktop-app-architecture.md`(APP-D01~D09, §3.12.2)
- 2a단계에 다시 읽은 설계 문서(2026-10-12 판): 01(ADR P1-5, NFR-A-5, NFR-C-1, NFR-C-4, §5.2), 02(§3.1 UC 목록), 05(A9, §6), 07(§2.2, §3.3, §3.9, §5.2), 09(D09-5·7, §3.8.4, §3.16, §5.2), 10(§3.1, §3.3, §5.2), 12(§5.2), 13(§3.6.2, §3.11), 14(§3.15, §3.20.6, §5.2), 15(§3.9.2, §3.13.2, §3.15.1, §5.2), 16(§5.2), 17(§3.1.4, §3.3, §3.8, §5.2), 19(§3.13, §3.14, §5.2, §6.2), 20(§3.7.3, §3.9, §3.12, §5.2), 21(개정 중인 판: UI-D13, UI-D19, §3.2.8, §3.6.7, §6.4, §5.2)
- `git -C ~/projects/_ref/pi-src show v1.1.0:<경로>`로 인용 행 재확인(`packages/agent/src/types.ts`, `packages/ai/package.json`, `package.json`, `packages/agent/package.json`) [실험, 2026-10-12]
- `~/projects/homelab/context/{index,machines,network,storage,decisions}.md`, `~/projects/homelab/scripts/backup`, `~/projects/homelab/scripts/backup.exclude` (읽기 전용)
- `~/.claude/skills/projects/SKILL.md`, `~/.dotfiles/templates/{just/core.just, just/node.just, just/examples/*, project/generic/*, project/node-24/justfile}`, `~/.dotfiles/docs/SECRETS.md`
- pi 소스 `~/projects/_ref/pi-src`(태그 `v1.1.0`, 커밋 `abe508e1`. 1단계는 `cdaf6c2`로 보았고 인용 행은 두 판에서 같다): `package.json`, `packages/agent/package.json`, `packages/agent/src/types.ts`(`:264`, `:271`, `:326`, `:341`, `:490`), `packages/ai/package.json:79`, `packages/coding-agent/src/modes/rpc/`

이번에 실행해 확인한 것 [실험] (2026-10-11, 서버 WSL):

- `node --version` = v24.19.0, `pnpm --version` = 11.21.0, `just --version` = 1.58.0, Ubuntu 24.04.5
- `npm view`: typescript dist-tags(latest 7.0.2, 6.0.3 존재), typescript-eslint 8.71.1 peer `typescript >=4.8.4 <6.1.0`, better-sqlite3 13.0.3(engines node>=22), vitest 5.0.3, eslint 10.12.0, prettier 3.9.10, pino 10.4.0, smol-toml 1.9.1, ws 8.22.0, typebox 1.3.36, @tauri-apps/api 2.12.3, vite 8.3.4
- `node:sqlite`: Node 24.19에서 불러올 때 경고 없음, export에 `backup` 포함, SQLite 3.53.3
- `loginctl show-user` Linger=yes, `systemctl --user` 동작, `/srv/volumes` 소유자 확인, `~/projects/helm`에 `PRODUCT.md`·`secrets/` 없음
- just 1.58.0의 같은 이름 레시피 처리(`set allow-duplicate-recipes` 유무, 루트와 import 모듈 사이 우선순위)
