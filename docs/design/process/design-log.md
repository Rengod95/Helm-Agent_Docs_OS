# Helm 설계 작업 이력

이 파일은 설계 작업의 진행, 에이전트 구성, 검증에서 나온 비판과 그에 따른 수정 내용을 순서대로 기록한다.

## 0. 요청 (2026-10-11)

제품 소유자 요청 요지:
- pi-ai와 pi의 각 패키지 중 재활용 가능한 것을 가져와 커스텀하고 적극 활용한다. 포크해서 새로 만드는 방향. 혼자 쓰는 앱.
- 설계 범위: 아키텍처, 런타임, 데몬, 통신, 전체 구조와 레이어, Helm 자체 구조와 런타임, pi 응용 방식, 데스크톱 앱, 런타임 서버-클라이언트 통신, 데스크톱 앱의 기획·시나리오·UX.
- 병렬 가능한 부분은 병렬로. 피처마다 Opus(high) 최소 두 개. 자원을 아끼지 않는다.
- 별도 검증 에이전트 풀이 마지막에 비판적으로 평가·피드백하고 보완한다. 그 이력을 남긴다.
- 이후 한 번에 구현할 예정이므로 빠짐없이 치밀하게 설계한다.

## 1. 준비 단계

| 시각 | 내용 |
|---|---|
| 2026-10-11 | 하위 에이전트 쓰기 시험: 설계 문서 파일 쓰기 가능 확인. 하위 에이전트에는 Agent 도구가 없어서 Opus 에이전트가 Sonnet 하위 에이전트를 직접 띄울 수 없음을 확인. 대신 Sonnet 보조 에이전트를 조정자가 직접 띄워 자료 정리를 맡김 |
| 2026-10-11 | pi 레이어 분석 원본 저장: `process/sources/pi-layer-analysis.md` |
| 2026-10-11 | 설계 브리프 작성: `process/00-design-brief.md` (확정 결정 37개, 공통 계약, 문서 26개 소유 표, 누락 항목 담당, 입력 자료, 작성 규칙) |

## 2. 단계 계획

| 단계 | 내용 | 에이전트 |
|---|---|---|
| 0 | 원천 자료 정리: 이전 Helm 저장소 원전 요약, 대화 설계 발췌 2건 | Sonnet 3 |
| 1 | 설계 초안: 문서 01~21, 24 | Opus(high) 14 (피처별 2개 이상) |
| 2 | 통합: 작성자들이 서로의 문서를 읽고 인터페이스를 맞춤. 테스트 전략(22), 구현 계획(23), 용어집(25) 작성 | 1단계 Opus 14 + 새 Opus |
| 3 | 검증 1차: 작성에 참여하지 않은 별도 검증 풀이 관점별로 비판적 평가 | Opus(high) 별도 풀 |
| 4 | 보완: 검증 결과를 작성자에게 전달해 수정 | 1단계 Opus |
| 5 | 검증 2차: 수정 확인, 남은 문제 정리 | 검증 풀 |
| 6 | 최종 정리: README, 이력 마감, 전달 | 조정자 |

## 3. 중단과 이관 (2026-10-11)

| 시각 | 내용 |
|---|---|
| 2026-10-11 | 0단계 Sonnet 보조 에이전트 3개(원전 정리, 대화 발췌 2건)를 띄우려던 시점에 제품 소유자가 중단함. 0단계 산출물 없음 |
| 2026-10-11 | 제품 소유자가 Claude Code에서 이어서 진행하기로 함. 클라우드 세션의 산출물(v0.3 문서 수정본, 감사·조사 보고, 브리프, 이력, pi 레이어 분석, 실험 스크립트, 대화 추출본)을 저장소로 옮기고 `docs/handoff/HANDOFF.md`를 작성함 |
| 2026-10-11 | 브리프의 경로를 저장소 기준으로 고친 판을 `docs/design/process/00-design-brief.md`에 둠 |

## 4. Claude Code 이관 후 환경 준비 (2026-10-11)

| 시각 | 내용 |
|---|---|
| 22:07 | 서버(WSL)의 `~/projects/helm`이 비어 있음. GitHub 저장소 `Rengod95/Helm-Agent_Docs_OS`(이전 이름 agent-docs-os, `main` = 77cfe3d)를 `projects` 스킬로 `~/projects/helm/code/helm`에 clone |
| 22:08 | 핸드오프 묶음(`helm-handoff-bundle.tgz`)을 저장소에 풂: `docs/design/`, `docs/handoff/`, `docs/v0.3/`, `experiments/helm-toy`, `experiments/pi-lab` |
| 22:09 | GitHub에는 v0.1·v0.2 원전이 없음(이전 세션에서 미추적 상태였음). Mac의 원래 작업 트리 `/Users/user/Documents/projects/06_agent_docs_os`에서 미추적 파일을 가져옴: `docs/foundations/`, `docs/foundations-friendly/`, `docs/architecture/helm-*`, `docs/experience/`, `docs/prototypes/`, `docs/research/`, `experiments/{helm-kernel-v02,helm-sidecar,durable-spike}`, `packages/helm-*`, `apps/helm-web`, 루트 `package.json`. `.helm/`, `.omc/`, `node_modules`, `docs/아카이브.zip`은 가져오지 않음 |
| 22:09 | Mac 작업 트리에서 수정 중이던 README 3종·`ci.yml`·`.gitignore`·`docs/architecture/fundamentals.md`는 저장소 파일을 건드리지 않고 `.helm-design-work/mac-modified/`에 참고용으로 둠. 묶음 파일과 Mac 원본의 md5가 같음을 확인 |
| 22:10 | pi 소스를 `~/projects/_ref/pi-src`에 clone(HEAD = `cdaf6c2`). 사례 저장소 8개를 `~/projects/_ref/`에 clone. 브리프 §4의 경로를 실제 위치로 고침 |
| 22:10 | `.helm-design-work/`를 `.git/info/exclude`에 추가(저장소 `.gitignore`는 건드리지 않음) |

## 5. 0단계: 원천 자료 정리

- 사용자 지시(2026-10-11): 하위 에이전트는 모두 Opus 5.5, 추론 수준 high, 최대한 병렬. HANDOFF의 Sonnet 3개 계획을 Opus 10개로 나눠 바꿈.

| 에이전트 | 모델 | 산출물 | 범위 |
|---|---|---|---|
| S1a 원전-기초 | Opus 5.5 high | `sources/helm-canon.md` | `docs/foundations/`, `docs/foundations-friendly/`, README.ko |
| S1b 원전-구조·실험 | Opus 5.5 high | `sources/helm-canon-2.md` | `docs/architecture/`, `docs/experience/`, `docs/prototypes/`, `experiments/`(helm-kernel-v02, helm-sidecar, durable-spike, helm-toy), `packages/helm-*`, `apps/helm-web` |
| S1c 원전-연구 | Opus 5.5 high | `sources/helm-canon-3.md` | `docs/research/` 전체(Method Transfer 지도, 방법 카드 20개, 번들, 데스크톱 에이전트 UX 조사) |
| S2a~S2d 대화 발췌 | Opus 5.5 high ×4 | `sources/conversation-extracts-1~4.md` | 대화 [1]~[33], [34]~[56], [57]~[105], [106]~[158] |
| S3a pi API 1 | Opus 5.5 high | `sources/pi-api-facts-1.md` | pi ai, agent, coding-agent, codemode, mcp, durable |
| S3b pi API 2 | Opus 5.5 high | `sources/pi-api-facts-2.md` | pi tui, protocol, server, client, chord, env, evals, telemetry, 라이선스, pi-lab 실험 재실행 |
| S4 사례 | Opus 5.5 high | `sources/pi-cases-notes.md` | `~/projects/_ref/` 사례 저장소 8개 |

### 5.1 사용자에게 물은 것과 답 (2026-10-11 22:15)

| 질문 | 답 | 처리 |
|---|---|---|
| SSH 경로 | pi-tui로 만든 Helm TUI. 그리고 "데스크톱 앱도 ssh로 접근 가능하게" | 브리프 결정 33을 [결정]으로, 결정 38(데스크톱 앱의 SSH 접속), 39 추가 |
| 관찰 에이전트 입력 범위 | Helm 기록 + 허용 폴더 세션 로그 | 브리프 결정 35를 [결정]으로 |
| 설계 문서 위치와 커밋 | `docs/design/`, 단계마다 로컬 커밋 | 브리프 결정 40 추가. 설계 브랜치 `design/helm-v1` 생성. push는 확인 후 |

- 조정자 추가: 홈랩 문서(`~/projects/homelab/context/`)에서 데몬 설계의 전제가 되는 운영 사실(Tailscale 위치, WSL SSH, tailscale serve 관례, Syncthing 동기화 폴더와 DB 위치, SOPS 비밀 체계, just 레시피 규칙)을 브리프 §2.5로 정리함.

### 5.2 0단계 결과 (22:11 ~ 22:47)

| 에이전트 | 산출물 | 분량 | 요점 |
|---|---|---|---|
| S1a | `sources/helm-canon.md` | 266KB | 원전 24개 전부. 공리 A1~A15, 가설 H1~H10(브리프의 H1~H8을 H1~H10으로 고침), 불변조건 전부 원문 수록. 원전 내부 불일치 23건, 원전과 브리프 차이 30행 |
| S1b | `sources/helm-canon-2.md` | 289KB | 110개 파일. helm-kernel-v02 테스트 57개 통과, helm-toy 21회 중 8회 거부 재현 [실험]. SQLite판과 in-memory판의 멱등 처리 차이, capability Level 정의 불일치 발견 |
| S1c | `sources/helm-canon-3.md` | 273KB | 연구 자료 26개. Method Transfer 35개, 방법 카드 20개, 상용 데스크톱 UX 조사. 충돌 C1~C13, v0.3에 없는 것 G1~G16 |
| S2a~S2d | `sources/conversation-extracts-1~4.md` | 101~136KB | 항목 225 / 161 / 206 / 396개. 사용자 결정·답 없는 제안·검증된 사실·열린 질문 목록 |
| S3a | `sources/pi-api-facts-1.md` | 124KB | ai·agent·coding-agent·codemode·mcp·durable. 기존 주장 불일치 4건(내장 provider 42개, stopReason 무관 도구 실행 등). beforeToolCall 인자 변경이 transcript에 남지 않는 문제, coding-agent 도구의 경로 무제한 |
| S3b | `sources/pi-api-facts-2.md` | 86KB | tui·protocol·server·client·chord·env 등. pi-lab 6개 모두 1.1.0에서 동작 [실험]. pi server/client는 재접속 재전송 없음, pi-env SSH stdio 프레이밍, cdaf6c2 소스와 npm 1.1.0 API 차이 |
| S4 | `sources/pi-cases-notes.md` | 완료 23:06 | 사례 8개. 보조 에이전트로 OpenClaw 4건(프로토콜, 지속성·복구, 인증·페어링·Tailscale, 스케줄러·알림·클라이언트)과 happy-agent·paseo·pi-web·pi-fabric를 조사. **기존 조사 정정**: 8곳 모두 클라이언트 seq를 메모리에만 두며 재시작을 넘는 lastSeq 재전송 사례가 없음("Happy Agent 커서 방식 참고" 전제 철회, Helm이 SQLite seq로 직접 설계). happy-agent는 pi 런타임에 의존한 적 없음, paseo는 ACP → SDK 임베드 → RPC 순 |

- 확인: 하위 에이전트에도 Agent 도구가 있다(전원 "예"). 1단계 설계 에이전트는 보조 에이전트(Opus)를 직접 띄울 수 있다.
- 부수 사항: S3b가 `experiments/pi-lab`에서 `npm install`을 할 때 루트 `package.json`의 workspaces 때문에 루트에 `node_modules`가 생겨 지우고 `--no-workspaces`로 다시 설치함. 이후 지시문에 이 방법을 적음.

## 6. 1단계: 설계 초안

- 시작: 22:47(P1·P2·P5·P6·P8·P9·P10·P14), 22:52(P3·P4·P7·P11·P12·P13). pi API·사례 자료가 필요 없는 8개를 먼저 띄우고, S3a 완료 직후 나머지 6개를 띄움. S4는 아직 작성 중이라 6개에게는 사례별 노트(`.helm-design-work/S4/`)를 먼저 읽고 `pi-cases-notes.md`가 나오면 반영하라고 지시함.
- 공통 지시문 원문: `.helm-design-work/coordinator/stage1-common.md`를 바탕으로 에이전트별로 필독 원천과 다룰 내용을 채움. 원천 파일이 커서(합계 약 1.8MB) 담당별로 "끝까지 읽을 것"과 "해당 절만 읽을 것"을 나눔. 모든 원천 파일의 체크리스트 절은 전원 필독.
- 23:06 S4 완료 후 P3·P4·P7·P11·P12·P13에 사례 정리 완료와 핵심 정정 사항을 메시지로 알림.
- 공통 규칙 추가: 24-adr.md는 P3만 쓰고 다른 에이전트는 자기 문서 끝 "ADR 후보" 절에 적음. 유즈케이스 초기 ID UC-01~UC-09를 전원에게 줌(P1이 확정). 이벤트·명령·메서드·화면 이름의 소유 문서를 명시.

| 에이전트 | 모델 | 담당 문서 | 추가 입력 |
|---|---|---|---|
| P1 기획 | Opus 5.5 high | 01, 02 | |
| P2 UX | Opus 5.5 high | 03, 04, 05 | |
| P3 아키텍트 | Opus 5.5 high | 06, 24 | 홈랩 문서, `projects` 스킬 템플릿(justfile 관례) |
| P4 pi 전문 | Opus 5.5 high | 07 | pi 소스, S3a·S3b 실험 코드 |
| P5 도메인 | Opus 5.5 high | 08, 09 | helm-kernel-v02 계약·SQLite 커널 |
| P6 커널 | Opus 5.5 high | 10, 11 | helm-toy |
| P7 런타임 | Opus 5.5 high | 12, 13 | pi 소스, OpenClaw 복구·스케줄러 노트 |
| P8 오케스트레이션 | Opus 5.5 high | 14 | |
| P9 탐구 | Opus 5.5 high | 15 | pi codemode 소스 |
| P10 관찰 | Opus 5.5 high | 16 | 외부 세션 로그는 키 구조만 확인(본문 열람 금지) |
| P11 데몬 | Opus 5.5 high | 17, 18 | 홈랩 문서, SECRETS.md, OpenClaw 인증·페어링 노트 |
| P12 프로토콜 | Opus 5.5 high | 19 | OpenClaw 프로토콜 노트 |
| P13 앱 | Opus 5.5 high | 20 | Tauri v2 [검색] |
| P14 UI | Opus 5.5 high | 21 | 사용자 디자인 시스템 `~/projects/axiom/code/axiom-design-system`(읽기 전용) 검토 |

### 6.1 1단계 결과 (22:47 ~ 다음 날 00:20 무렵)

- 14개 에이전트 모두 완료. 문서 22개, 약 40,600행. 커밋 `33d2885`.
- 여러 에이전트가 쓰는 도중 먼저 나온 다른 문서를 읽고 이름을 맞췄다(P6은 10·11을 2판으로 다시 씀, P5는 정렬 보조 에이전트로 10·11·12·13·16·17·18과 대조). 그래도 08·09 이전에 쓴 문서에 1판 이름이 남아 2a에서 일괄 정리하기로 함.
- 각 에이전트의 보고 원문(결정, 다른 문서에 대한 요구, 미결, 브리프 이의)은 조정자 대화에 있고, 요구 사항은 각 문서 §5에도 있다.

### 6.2 사용자에게 물은 것과 답 (2026-10-12 00:10 무렵)

P14(21)의 브리프 이의 3건을 물었다.

| 질문 | 답 | 처리 |
|---|---|---|
| Caustic 부품이 React 19 전용인데 React 버전은? | React 19로 올리고, 부품은 직접 만든다. Codex·Claude Code 등 최근 에이전트 클라이언트의 디자인 시스템을 참고한 글래스모피즘 기반 | 브리프 결정 41. 21 전면 개정, 20 버전 갱신 |
| 밖에서 답할 때 쓰는 기기는? | 휴대폰에서도 답하기 | 브리프 결정 42. 새 문서 26(P15) |
| Caustic 토큰 사용 방식은? | 복사해서 가져온다(의존 없음). neutral 단계가 너무 많으니 Helm에 맞게 줄인다. impeccable 써도 됨 | 브리프 결정 43 |

## 7. 2a단계: 통합

- 시작: 2026-10-12 00:25 무렵.
- 조정자 판정: `docs/design/process/rulings-stage2a.md`(이름 소유 정본, 패키지·포트, 충돌 판정 J-01~J-22, 사용자 결정 반영 담당, 사람 작업 목록). 브리프 §2.4b에 결정 41~46 추가(41~43 사용자, 44 Node 24·TS 6.0·pi 기준 v1.1.0, 45 데몬 비밀 주입, 46 루프백은 격리 경계가 아님). §3.4에 문서 26 추가.
- 1단계 에이전트 14개에 통합 지시(공통 지시문 `.helm-design-work/coordinator/2a-common.txt` + 에이전트별 처리 목록)를 보냄. P14에는 21 전면 개정을 지시.
- 2b단계(22·23·25)와 모바일(26) 에이전트 4개는 동시 실행 상한(20) 때문에 보류. 자리가 나면 띄운다.

### 7.1 2a 결과 (2026-10-12 00:25 ~ 13:50 무렵)

- 1단계 에이전트 14개가 통합을 마침. 각 에이전트가 고친 내용·남은 요구·남은 충돌을 보고했고, 조정자가 충돌을 판정함. 판정은 `rulings-stage2a.md`의 J-01~J-118(이름 소유 정본 §1, 패키지·포트 §2 포함).
- P5의 보조 에이전트가 만든 대조표 두 건(12·13 ↔ 08·09: 08·09 반영 21건과 12·13 이름 수정 43건, 10·11 ↔ 08·09)이 조정자에게 도착해 `.helm-design-work/coordinator/align-*.md`로 남기고 P5·P6·P7에 나눠 전달함.
- 09 이벤트 카탈로그 최종 275개(표와 payload 맵 일치, P5 스크립트 대조).
- 21은 사용자 결정 41·43으로 전면 개정(React 19 + Radix, shadcn 소스 복사, 글래스모피즘 두 재질, Caustic 토큰 복사·neutral 16→11단계).
- 24에 모든 문서의 ADR 후보를 옮김(같은 내용 합침).
- 2a 이후에도 남은 사소한 어긋남은 `.helm-design-work/coordinator/residual-2a.md`에 모아 4단계에 함께 전달한다.
- 동시 실행 상한(20) 때문에 2a 중 보조 에이전트를 대부분 띄우지 못해 작성자가 직접 대조함.

## 8. 2b단계와 모바일

| 에이전트 | 모델 | 산출물 | 요점 |
|---|---|---|---|
| P15 모바일 | Opus 5.5 high | 26 | PWA(데몬이 `/m/` 서빙) + Web Push(VAPID), HttpOnly 쿠키 토큰, 질문 답하기 중심 `SCR-M-*` |
| T1 테스트 전략 | Opus 5.5 high | 22 | 테스트 계층 14개, 추적 ID `<문서>/<ID>`와 `just test-trace`, 모델 테이프 재생기, 대본 하네스(MVP AC 118개 연결), 장애 주입 두 층 |
| T2 구현 계획 | Opus 5.5 high | 23 | 사람 작업 HT-01~25, 마일스톤 M0~M19, WBS 206행, 스파이크 SP-01~15, 관문 G0~G2와 기능 플래그 |
| T3 용어집 | Opus 5.5 high | 25 | 용어 약 480개, 접두사 58개, 불일치 표 55건 |

- 교차 확인: T1·T2는 끝내기 전에 서로의 초안을 읽고 맞춤(22 → 23 반영, 23 → 22 요구). 4단계에서 남은 요구를 처리한다.

### 8.1 사용자에게 물은 것과 답 (2026-10-12 오후)

| 질문 | 답 | 처리 |
|---|---|---|
| 모바일 방식 | 홈 화면 웹 앱(PWA) | 결정 47 |
| 휴대폰 알림 범위 | 알림 강도 질문까지 | 결정 48 |
| iOS 판·Android | iOS 26 이상이면 된다 | 결정 49(Android 제외) |
| shadcn 소스 복사 | 직접 만드는 부품으로 본다 | 결정 50 |
| (사용자 지시) | 구현 작업은 Sonnet 5.5, Haiku 5.5로 | 결정 51 |

- 2026-10-12 오후: T3의 보조 에이전트 3개가 Opus 세션 한도(429, "resets 2pm Asia/Seoul")로 중간에 끝남. T3 본 작업은 그 전에 완료됨.

### 8.2 사용자 지시: 에이전트 3단계 (2026-10-12 19시 무렵)

- "서브에이전트 뎁스를 3단계로 … 메인 opus 5.5 high, 서브 opus medium 또는 sonnet medium, 실작업자 sonnet medium 또는 haiku max". 직전 지시("구현작업은 sonnet, haiku 5.5로")에 이어진 것이므로 구현 단계 구성으로 해석해 브리프 결정 51로 기록함.
- 검증 단계 적용: 검증 리더 V1~V7은 HANDOFF 지시대로 Opus 5.5 high, 리더가 띄우는 보조 검토자는 3단계 구성에 맞춰 Opus 5.5 medium 또는 Sonnet 5.5 medium.

## 9. 3단계: 검증 1차

- 시작: 2026-10-12 19:20. 대상: `docs/design/` 01~26(약 49,000행, 5MB)과 브리프·판정 문서.
- 문서가 커서 한 검증자가 전부 읽을 수 없다. 검증 리더(V1~V7)가 문서 묶음별 보조 검토자를 띄워 나눠 보고, 리더가 판정·심각도를 정해 결과를 쓴다.
- 작성에 참여하지 않은 새 에이전트만 쓴다.

| 검증자 | 모델 | 관점 | 결과 파일 |
|---|---|---|---|
| V1 | Opus 5.5 high (보조: Opus·Sonnet medium) | 추적성: 브리프 결정 1~51, 감사 보고, 원천 체크리스트, 판정 J-01~J-118 반영 | `verification/round-1/V1-traceability.md` |
| V2 | 같음 | 정합성: 이름·타입·이벤트·명령·메서드, UC-01·03·04·05·07·10 끝까지 추적 | `V2-consistency.md` |
| V3 | 같음 | 실패·복구: 크래시, 재접속, 경합, 단일 쓰기, 손상, WSL 종료, 모바일 | `V3-failure-recovery.md` |
| V4 | 같음 | 보안·운영: 인증, 노출, 격리, 비밀, 백업, 업그레이드, 공급망 | `V4-security-ops.md` |
| V5 | 같음 | 기획·UX: Helm 원칙, 인지 부담, 상태, 모바일, 글래스모피즘, 문구 | `V5-product-ux.md` |
| V6 | 같음 | 구현 가능성: 빈 곳, 스키마 컴파일·DDL 적용 실험, pi v1.1.0 대조, 23 순서 | `V6-implementability.md` |
| V7 | 같음 | 문체·용어: 금지 표현, 용어집 일치, [결정] 근거, 참조 | `V7-style-terms.md` |

### 9.1 1차 결과 (2026-10-12)

| 검증자 | 치명 | 높음 | 중간 | 낮음 | 계 |
|---|---|---|---|---|---|
| V1 추적성 | 2 | 15 | 46 | 18 | 81 |
| V2 정합성 | 0 | 29 | 25 | 11 | 65 |
| V2 보조 E(UC-07 추적, `.helm-design-work/V2/E-uc07-trace.md`) | 1 | 10 | 11 | 8 | 30 |
| V3 실패·복구 | 3 | 14 | 29 | 15 | 61 |
| V4 보안·운영 | 1 | 13 | 31 | 24 | 69 |
| V5 기획·UX | 1 | 15 | 40 | 16 | 72 |
| V6 구현 가능성 | 3 | 37 | 57 | 13 | 110 |
| V7 문체·용어 | 0 | 12 | 18 | 21 | 51 |

검증자 여럿이 겹쳐 짚은 문제는 다음과 같다.
- 사용자 결정 47~51이 문서에 들어가지 않았다. 26의 알림 기본값(`interrupt`만)과 최소 iOS 판이 결정 48·49와 다르다. 23 WBS에 결정 51의 난이도·담당 단계·모델 열이 없다. 24에 ADR이 없다(V1-006, V5, V6-003, V7-002·003).
- 휴대폰 경로가 소유 문서대로는 동작하지 않는다. 18 preflight는 Origin 요청을 막고, 19는 토큰을 하위 프로토콜로 보낸다. 11 `urgencyOf`는 부재 시 질문을 digest로 낮춰 푸시가 나가지 않는다(V1-002, V4, V5).
- 2a 판정(J-60 이후)이 고칠 문서에 들어가지 않았다. send 권리 게이트(J-91), presence 값, `approve_edited`, 19 메서드 표의 커널 명령 열이 해당한다(V1-001·008~017, V2, V7-010~018).
- 커널 트랜잭션 API(`transact`와 `commitBatch`)와 런타임의 정본 읽기 경로가 06 의존 규칙과 맞지 않는다(V6-001·002).
- 크래시 복구 쪽 문제가 있다. 멱등 지문에 `via` 전체와 제출자 ULID가 들어간다. 승인 실행 중 크래시 정리, 복원 직후 부팅 구분이 빠졌다(V3, V6-011).
- 데몬이 샌드박스 밖에서 실행하는 git이 저장소 설정 훅·필터로 탈출 경로가 된다(V4).
- [결정] 표시를 조정자 기본값에까지 붙였다(V7-001).

V6이 이 서버에서 실험한 외부 주장(bwrap 인자, systemd 단위 11개, scope PartOf=, Tauri 2.12.3 창 효과, better-sqlite3 13 + Node 24)은 모두 문서와 맞았다. iOS 26 Web Push, cargo-xwin, 키체인은 실기기·도구가 없어 실험하지 못했다.

## 10. 4단계: 보완

- 지적을 문서 소유자별로 묶는다(`.helm-design-work/coordinator/stage4/`). 검증자끼리 방향이 다른 제안과 설계 선택이 필요한 항목은 조정자가 먼저 판정한다(rulings-stage2a.md 다음 번호로 이어 쓴다).
- 묶음, 판정 J-104~J-118, 2a 잔여 어긋남을 원 작성 에이전트에게 보낸다.
- 2026-10-12: 묶음 보조가 입력 677건(검증 7개, 보조 추적 5개, 판정 15, 2a 잔여)을 479줄로 합쳤다(치명 12, 높음 116, 중간 247, 낮음 104). 담당별 묶음은 `.helm-design-work/coordinator/stage4/by-owner/`에 있다.
- 검증자끼리 다른 방향을 제안한 29건(K-01~K-29)과 V6-002 트랜잭션을 판정했다(rulings-stage2a.md §7, J-119~J-148). 대부분 묶음 보조의 추천을 따랐다. K-03은 J-117을 유지하고 결정적 tcId로 V3의 위험을 막았다. K-16은 네트워크 네임스페이스와 프록시를 1차 목표로 하고, 스파이크가 실패하면 실행마다 승인하는 방식으로 물러선다.
- 브리프 §5.2에 조정자 기본값·판정 표기를 더했다(J-144).
- 작성 에이전트 18개(P1~P15, T1~T3)에게 공통 지시(`stage4/instruction.md`)와 각자 묶음을 보냈다. 동시 실행 상한 때문에 보조 에이전트는 쓰지 않게 했다. 23(T2)에는 결정 51 반영(WBS 난이도·담당 단계·모델 열, 3단계 구조)을 먼저 하게 했다.
