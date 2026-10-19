# Helm 설계 작업 핸드오프 (Claude Code로 이어서 진행)

- 작성: 2026-10-11
- 이전 작업 환경: claude.ai 클라우드 세션. 산출물을 이 저장소에 옮겨 두었다.
- 이 문서의 용도: Claude Code 세션이 이전 맥락을 잃지 않고 설계 작업을 이어받게 한다.
  - §1은 Claude Code에 그대로 붙여 넣을 프롬프트다.
  - §2 이하는 그 프롬프트가 읽으라고 지시하는 상세 맥락이다.

---

## 1. 붙여 넣을 프롬프트

저장소 루트에서 Claude Code를 열고 아래 블록 전체를 붙여 넣는다.

```text
너는 Helm 설계 작업의 조정자(coordinator)다. 이 작업은 claude.ai 클라우드 세션에서 시작했고, 이 저장소로 넘어왔다.

## 먼저 읽을 것 (이 순서로, 끝까지)
1. docs/handoff/HANDOFF.md — 이 핸드오프 문서 전체. 특히 §2 맥락, §3 작업 계획, §4 에이전트 구성, §5 프롬프트 원문
2. docs/design/process/00-design-brief.md — 모든 설계·검증 에이전트의 공통 브리프 (확정 결정 37개, 공통 계약, 문서 소유 표, 누락 항목 담당, 입력 자료, 작성 규칙)
3. docs/design/process/design-log.md — 작업 이력
4. docs/v0.3/00-README.md — Helm v0.3 개념 문서 색인과 결정 목록
5. docs/v0.3/audit/pi-runtime-options.md — pi 활용 방향 판단 근거

## 지금 할 일
제품 소유자의 요청(HANDOFF §2.1 원문)에 따라 Helm 전체 설계를 구현 가능한 수준까지 완성한다. HANDOFF §3의 단계 계획을 0단계부터 진행한다. 이전 세션은 0단계를 시작하기 직전에 멈췄고, 0단계 산출물은 아직 없다.

## 반드시 지킬 것
- 피처마다 Opus(가능한 가장 높은 추론 수준) 에이전트를 최소 두 개 붙인다. 독립적인 작업은 한 메시지에서 여러 에이전트를 동시에 띄워 병렬로 돌린다. 자원을 아끼지 않는다.
- 하위 에이전트가 다시 에이전트를 띄울 수 없는 환경이면, Sonnet 보조 에이전트는 네가 직접 띄운다(자료 정리, 사실 확인, 원천 발췌 등).
- 설계 문서는 docs/design/ 아래에 쓴다. 작업 메모는 .helm-design-work/ 에 쓰고 커밋하지 않는다.
- 작성에 참여하지 않은 별도 검증 에이전트 풀이 마지막에 비판적으로 평가하고, 그 피드백으로 보완하고, 다시 검증한다. 이 과정 전체(누가, 무엇을, 어떤 문제를 찾았고, 어떻게 고쳤는지)를 docs/design/process/design-log.md와 docs/design/process/verification/ 에 이력으로 남긴다.
- 문체 규칙(브리프 §5.1)을 모든 문서와 사용자 응답에 적용한다. 한국어, 담백하게. '축', '박다', '가른다', '닿다', 사물을 주어로 한 의인화, "A가 아니라 B다" 구호 반복을 쓰지 않는다. 제품 사용 사례는 "유즈케이스".
- 사용자에게는 합니다체로 답한다. 진행 상황은 단계가 끝날 때마다 짧게 알린다.
- .helm/private/ 는 절대 읽지 않는다.
- 저장소의 기존 변경 사항(README*, .github/workflows/ci.yml, .gitignore, docs/architecture/fundamentals.md 등)은 건드리지 않는다.
- git commit과 push는 사용자가 요청할 때만 한다.
- pi 소스가 필요하면 저장소 밖에 clone한다: git clone https://github.com/earendil-works/pi ../pi-src && git -C ../pi-src checkout cdaf6c2. 설계에 쓰는 pi API는 소스로 확인한다.

## 시작
1. 위 문서를 읽고, 이해한 계획을 사용자에게 5~10줄로 요약해 보고한다.
2. 브리프의 경로가 이 저장소에서 실제로 존재하는지 확인한다(없는 것은 보고).
3. 바로 0단계를 시작한다. 사용자의 추가 확인을 기다리지 않는다. 단, HANDOFF §2.4의 "확인 필요" 항목은 0단계와 병행해 한 번에 물어도 된다.
```

---

## 2. 맥락

### 2.1 이번 요청 원문 (제품 소유자, 2026-10-11)

> pi ai 및 pi의 각 구성요소 패키지들 재활용가능한것들 가져와서 커스텀하던 뭐하던 적극활용하는 방향으로 가. 포크해서 새로만든다는느낌으로. 일단 혼자쓰는앱으로.
>
> 아키텍쳐 ,런타임,데몬 , 통신 설계, 런타임 및 전체 구조및 레이어설게,  HELM 자체 구조와 런타임에 대한 설계, pi를 어떻게 응용할건지에 대한 설계, 데스크톱 앱 설계, 런타임 서버와 클라이언트간 통신설계, 및 데크스탑앱은 헬름 에이전트 에대한 기획과 시나리오 및 실제 사용성에 대한 UX 및 기획까지 함께 진행하고 병렬로 가능한 부분은 병렬로 진행해도되고, 각 피쳐별로 오푸스 하이 최소 두대씩 붙여서 작업하고 필요하다면 각 오푸스들이 서브에이전트로 소넷 쓰도록하고 자원과 리소스를 아끼지말고 전체 맥락에서 빠진 내용이 없도록 완벽하고 철저하게 설계하도록 해. 이후 전체 검증 프로세스랑 에이전트 풀은 따로 두고 마지막에 비판적으로평가하고 피드백하고 보완하도록하고 이건 나한테 이력남겨놔. 이후 한번에 구현 진행할테니 뮤조건 완전무결하고 치밀하게 하나하나 다 설계해

### 2.2 대화 [158] 이후의 흐름

대화 [1]~[158]은 `docs/handoff/conversation-transcript-until-158.md`에 있다. 그 뒤의 내용은 다음과 같다.

1. **클라이언트 방향 결정**
   - 사용자 결정: 클라이언트는 웹이 아니다. 자체 데스크톱 앱 또는 SSH + pi + 커스텀 TUI. 외부에서 연결할 수 있어야 한다.
   - 사용 사례는 "장면"이 아니라 "유즈케이스" 또는 "시나리오"라고 쓴다.
2. **v0.3 문서 00~14 전수조사**
   - 대화 구간 5개와 문서 간 일관성을 6개 에이전트가 병렬로 조사했다.
   - 결과: `docs/v0.3/audit/audit-report.md`
   - 주요 발견
     - 웹 전제와 원격 접속 범위가 최신 결정과 충돌한다.
     - 대화에서 설계했지만 빠진 덩어리가 있다: 발산 서브시스템, 관찰 에이전트, 공리 A1~A15 전체 대응, 벤더 중립 원칙, pi 안의 Helm, 프로세스 배치 A/B/C.
     - 기술 전제 오류: codemode 변수 수명, 하위 LLM 호출 부재, bash로 범위 검사를 우회하는 문제.
     - 표시·숫자·참조·용어가 어긋난다.
3. **사용자 결정 (감사 후속)**
   - 사용자가 "투영"이라 부른 개념의 이름은 Method Transfer로 정했다.
   - 질문 조건: 사용자 답은 "모르겠음"이었다. AND를 기본으로 하고 조건별 문턱 다이얼을 두는 안을 [제안]으로 두고, 실제 사용 후 결정한다.
   - [결정] 표시를 다시 볼 다섯 항목 a~e는 모두 추천대로 처리했다. (a) 08 §1 커널 원칙 결정, (b) 08 §4 원칙 결정·표 제안, (c) 의존 규칙 1~3 결정·4~5 제안, (d) Cynefin 도입 결정, (e) 기대 레코드 제안.
   - 실행 위치: 개인 WSL 서버.
   - 진행 중인 작업은 클라이언트가 없어도 계속한다.
   - 클라이언트는 데스크톱 앱을 먼저 만든다.
   - 관찰 에이전트의 입력 범위: 사용자 답이 비어 있어 1단계(Helm 기록 + 허용한 폴더의 외부 세션 로그)를 [가정]으로 두었다.
4. **v0.3 문서 수정**
   - 감사 결과 중 정리 성격의 수정을 00~14에 반영했다: 결정 반영, 참조·숫자·용어·문체, 루프 식별자 표, 12~14 갱신 표시.
   - 빠진 설계 덩어리를 문서에 다시 넣는 일은 이번 설계 작업으로 넘겼다(브리프 §3.5 담당 표).
5. **"데몬 말고 방법 없나" 질문**
   - 결론: 클라이언트 없이 진행하는 것과 원격 데스크톱 접속을 함께 하려면 서버에 상주 프로세스가 최소 하나 필요하다.
   - 상주 데몬, 또는 필요할 때만 뜨는 얇은 서버를 권했다.
6. **조사 세 건** (결과는 `docs/v0.3/audit/`)
   - `backend-oss-research.md`
     - 데몬형 에이전트 제품: OpenCode v2, Codex app-server, Happy Agent, Paseo 등
     - 지속 실행 엔진: OpenWorkflow, Absurd, Restate 등
     - 프로토콜: ACP, AG-UI, MCP
     - 데스크톱 셸: Tauri v2
     - WSL 원격 접속: Tailscale + `tailscale serve`, WSL keepalive
   - `mastra-review.md`: Mastra를 데몬 프레임워크로 전체 채택하는 것은 비권장. MCP·ACP 패키지와 설계 몇 가지를 차용한다.
   - `pi-runtime-options.md`: pi를 쓰는 여섯 가지 방법과 사례 13건. 부품으로 쓰는 자체 런타임을 추천했다.
     - 사례: OpenClaw와 Happy Agent는 pi 런타임을 걷어냈고, pi-tui만 남긴 사례가 있다.
     - pi는 패치 버전에서도 호환이 깨지는 변경이 잦다.
7. **"아예 자체 런타임 + mac 지원 데스크톱 앱" 제안 검토**
   - 평가는 좋은 방향이었다. 다만 모델 제공자 계층만은 라이브러리를 쓰기를 권했다.
   - Mac 앱은 WSL 데몬에 Tailscale로 붙는 얇은 클라이언트(Tauri)로 둔다.
8. **최종 방향**: §2.1 요청. pi 패키지를 적극 가져와 포크하는 느낌으로, 혼자 쓰는 앱으로 만든다.
9. **조정자 준비 작업**
   - 공통 브리프 작성: `docs/design/process/00-design-brief.md`
   - 작업 이력 시작: `docs/design/process/design-log.md`
   - pi 레이어 분석 원본 보존: `docs/design/process/sources/pi-layer-analysis.md`
   - 0단계 Sonnet 에이전트 3개를 띄우려던 시점에 사용자가 중단하고 Claude Code로 옮기기로 했다.

### 2.3 이전 세션에서 확인한 환경 사실

- 이전 세션의 하위 에이전트는 설계 문서 파일을 직접 쓸 수 있었다. 다만 Agent 도구가 없어서 다른 에이전트를 띄울 수 없었다. Claude Code에서도 같은지 먼저 확인한다.
- pi 저장소 기준 커밋은 `cdaf6c2`(2026-10-11)이고, npm `@earendil-works/*` 1.1.0(2026-10-07)이다.
- `experiments/pi-lab/`의 실험 6개는 faux provider로 API 키 없이 돈다. 실행하려면 `npm install`이 필요하다.
  - exp1: agent-core 훅으로 커널 검사
  - exp2: provider 이어가기
  - exp3: SDK 확장
  - exp4: pi-durable 크래시 복구
  - exp5: pi-protocol 프레임
  - exp6: TUI 컴포넌트 재사용

### 2.4 확인 필요 (사용자에게 물을 것, 답이 없으면 기본값으로 진행)

| 항목 | 기본값 |
|---|---|
| SSH 경로 | pi CLI 대신 pi-tui로 만든 Helm TUI. pi CLI는 나중에 런타임 어댑터(RPC)로 붙임 [가정, 이전 세션에서 알렸으나 답 없음] |
| 관찰 에이전트 입력 범위 | Helm 기록 + 허용한 프로젝트 폴더의 외부 에이전트 세션 로그 [가정] |
| 설계 문서 위치와 브랜치 | `docs/design/`. 커밋은 사용자 요청 시 |

---

## 3. 작업 계획

### 3.1 단계

| 단계 | 내용 | 에이전트 | 산출물 |
|---|---|---|---|
| 0 | 원천 자료 정리 | Sonnet 3 (병렬) | `docs/design/process/sources/helm-canon.md`, `conversation-extracts-1.md`, `conversation-extracts-2.md` |
| 1 | 설계 초안 | Opus 14 (한 번에 병렬) | 문서 01~21, 24 |
| 2a | 통합: 작성자들이 관련 문서를 읽고 인터페이스를 맞춤 | 1단계 Opus 14 (이어서 지시) | 수정된 01~21, 24 + 통합 보고 |
| 2b | 테스트 전략, 구현 계획, 용어집 | Opus 4 (22 둘, 23 둘이 교차 확인. 25는 그중 하나가 맡거나 별도) | 22, 23, 25 |
| 3 | 검증 1차 (작성에 참여하지 않은 별도 풀) | Opus 7 (병렬) | `process/verification/round-1/V*.md` |
| 4 | 보완: 검증 결과를 문서 소유자에게 전달해 수정 | 1·2단계 Opus | 수정 문서 + 수정 보고 |
| 5 | 검증 2차: 같은 검증 풀이 수정 확인, 남은 문제 판정 | 검증 풀 | `process/verification/round-2/V*.md` |
| 6 | 최종 정리: 00-README, 이력 마감, 사용자 보고 | 조정자 | `docs/design/00-README.md`, `design-log.md` |

통과 기준: 검증 2차에서 심각도 "치명"과 "높음"이 0건이어야 한다. 남은 "중간" 이하는 각 문서의 미결 사항에 기본값과 함께 적혀 있어야 한다. 기준을 넘지 못하면 4~5단계를 반복한다.

### 3.2 이력 기록 형식 (`design-log.md`)

단계마다 다음을 남긴다.
- 시작·종료 시각
- 투입 에이전트(역할, 모델, 담당 문서)
- 주요 결정과 그 근거
- 다른 문서에 대한 요구와 조정자의 처리
- 검증에서 나온 지적. 번호, 심각도, 지적, 대상 문서·절, 처리(수정, 기각과 사유, 미결로 이관)를 표로 정리한다.
- 사용자에게 물은 것과 답

---

## 4. 에이전트 구성

### 4.1 1단계 설계 에이전트 (Opus, 피처별 2개 이상)

문서 번호와 내용은 브리프 §3.4, 누락 항목 담당은 브리프 §3.5를 따른다.

| 피처 | 에이전트 | 담당 문서 | 중점 |
|---|---|---|---|
| 기획·UX | P1 기획 | 01, 02 | 제품 정의와 원칙("모델이 초안, 사람은 반응", 2~3개 고르기 거부), 유즈케이스와 단계별 시나리오(취향형 작업, 원인 조사, 여러 날 걸리는 작업, 외부 접속 상태에서 질문 답하기, 혼자 정한 결정 이의, 복귀 요약), C/A 우선과 사람 조작 2회 상한, 범주 한정과 진입 경로, MVP 범위, 비목표, 성공 지표 |
| 기획·UX | P2 UX | 03, 04, 05 | 정보 구조, 화면 목록과 상세(v0.3 09의 홈, Concern 상세, 질문함, 에이전트가 정한 것, 탐구 화면, 자극 보드, 근거 체인, Goal 이력, 다이얼), 상태 중심 UI, 질문 받기·자극 반응·이의 걸기·알림·키보드, 한국어 문구 |
| 아키텍처·pi | P3 아키텍트 | 06, 24 | 시스템 맥락, 레이어와 의존 방향, 프로세스 배치(WSL 데몬, 작업자 프로세스 여부, 클라이언트), 패키지 경계, 설정, 로깅, 기술 스택 확정, 벤더 중립 원칙과 런타임 어댑터 위치, ADR |
| 아키텍처·pi | P4 pi 전문 | 07 | pi 패키지별 활용(포크·고정 의존·참고) 결정, 가져올 파일 목록과 수정 사항, `vendor/` 구조, 라이선스 고지, 업스트림 추적·버전 고정, import 무결성 테스트. pi 소스를 직접 읽어 확인 |
| 도메인·커널 | P5 도메인 | 08, 09 | 모든 레코드 타입(TypeBox), 관계와 쓰기 시점 참조 제약, Claim 스키마, 상태 기계(Concern, Question, Agreement, 품질 상태), ID, 이벤트 envelope, SQLite DDL, 해시 체인, 투영 테이블, 마이그레이션, 백업 |
| 도메인·커널 | P6 커널 | 10, 11 | 단일 변경 경로, 명령·제안 카탈로그, 검증 규칙, A/P, 거부 세 갈래, 공리 A1~A15 전체 대응표, 불변조건 속성 테스트, 질문·게이트·전달·가정 만료·중재자·혼자 정한 결정·이의 흐름, 범위를 줄여 진행, rollback_point |
| 런타임 | P7 런타임 | 12, 13 | pi-agent-core 포크 루프와 커널 연결점, pi-ai 모델 계층, A11 투영(컨텍스트) 생성, 컴팩션, 실행 의도 → 실행 → 결과 크래시 복구, 스케줄러·타이머, 예산, 도구 모음(coding-agent 도구 포크), Helm 제안 도구, bash 범위 우회 방지, 격리, 하위 호출 도구, 런타임 어댑터 인터페이스 |
| 런타임 | P8 오케스트레이션 | 14 | O/I/C/A/S 실행, 루프 계약(데이터), 전환과 재진입 가드, 루프 계획 레코드, 모드·다이얼, 상황 판정, 루프 세 크기, 10단계 계약, 성숙도, 주의 예산, OICA·NEMAP·OPD+C 역할 |
| 런타임 | P9 탐구 | 15 | 탐구 네 종류 실행, 발산 서브시스템 전체, Method Transfer 렌즈, 대비 압축과 질문 하나, 선호 모델, 근거 규칙, 가지별 다른 모델, 적대적 검토, 정지 규칙, REPL 방식 탐구(교정된 전제) |
| 런타임 | P10 관찰 | 16 | 관찰 에이전트 전체 설계(별도 프로세스, 읽기 전용, 파이프라인, 분류, 신뢰할 수 없는 로그, 비밀 마스킹, 기각 기억, 효과 측정), OPD+C 지표, 반증 가설 H1~H8 측정 |
| 데몬·통신 | P11 데몬 | 17, 18 | 데몬 프로세스 모델과 수명주기, WSL 운영(systemd, keepalive, 절전, 업데이트), 저장 위치, 백업·복구, 업그레이드, 상태 확인, 위협 모델, Tailscale, 토큰·페어링, 비밀 저장, 도구 격리 |
| 데몬·통신 | P12 프로토콜 | 19 | JSON-RPC 2.0 over WebSocket, 메서드·이벤트 전체 목록과 TypeScript 타입, 구독, 시퀀스 재전송, 오류 코드, 버전, 파일 전송, TUI 재사용 |
| 데스크톱 앱 | P13 앱 | 20 | Tauri v2 구조, React 18 앱 구조, 클라이언트 저장소와 동기화, 라우팅, 오프라인, macOS 알림·메뉴바·키체인, Windows 빌드, 서명 없는 개인 배포, 테스트 |
| 데스크톱 앱 | P14 UI | 21 | 디자인 시스템, 컴포넌트 목록, 화면 → 컴포넌트 매핑, 시각화(근거 체인, 루프 타임라인, 자극 보드), assistant-ui 활용 범위 |

### 4.2 3단계 검증 풀 (Opus, 작성자와 다른 에이전트)

| 검증자 | 관점 | 주요 확인 |
|---|---|---|
| V1 추적성 | 요구·결정 반영 | 브리프 결정 37개, 감사 보고 §1~§5, 대화 원천 발췌의 결정·사용자 진술이 설계에 빠짐없이 들어갔는가. 항목별 반영 위치 표 |
| V2 정합성 | 문서 간 인터페이스 | 이름, 타입, ID, 이벤트, 메서드가 문서 사이에서 일치하는가. 유즈케이스 시나리오를 UX → 프로토콜 → 데몬 → 런타임 → 커널 → 저장소 순으로 끝까지 따라가며 끊기는 곳 |
| V3 실패·복구 | 장애와 동시성 | 각 단계에서 크래시, 재접속, 타이머 경합, 중복 제출, 단일 쓰기 보장, 데이터 손상, WSL 종료 |
| V4 보안·운영 | 위협과 운영 | 인증, 토큰 수명, 원격 노출, 도구 실행 격리, 비밀 누출, 백업·복구, 업그레이드 |
| V5 기획·UX | 사용성과 Helm 원칙 | 시나리오와 화면이 Helm 원칙(원함 발견, 반응 기록, 2~3개 고르기 금지, 혼자 정한 결정 확인, 주의 예산)에 맞는가. 인지 부담, 빈·오류 상태 |
| V6 구현 가능성 | 바로 구현할 수 있는가 | 모든 모듈에 타입·알고리즘·완료 기준이 있는가. pi API 주장이 소스와 맞는가(`../pi-src`로 확인). 구현 계획의 순서와 의존 |
| V7 문체·용어 | 규칙 준수 | 문체 규칙, 용어집 일치, [결정]/[제안]/[가정] 표시의 정확성(결정 근거가 실제로 있는가) |

- 검증자는 심각도를 치명 / 높음 / 중간 / 낮음으로 붙인다.
- 지적마다 근거(문서·절, 원천 위치)와 수정 제안을 적는다.
- 칭찬이나 요약보다 문제를 찾는 데 집중한다.

---

## 5. 프롬프트 원문

### 5.1 0단계 Sonnet 보조 에이전트 3개 (이전 세션에서 쓰려던 것, 경로를 저장소 기준으로 고침)

**S1 Helm 원전 정리**
```text
You are preparing source material for a design team. Read the user's previous Helm project files in this repository (docs/foundations/, docs/foundations-friendly/, docs/architecture/, docs/experience/, docs/research/, docs/prototypes/, experiments/helm-kernel-v02/, README.ko.md etc.). NEVER read anything under `.helm/private/`. Write ONE file: docs/design/process/sources/helm-canon.md (Korean prose; keep original English terms/identifiers; quote the user's own wording verbatim where it defines something).
Goal: a faithful, detailed reference of Helm's v0.1/v0.2 canon so designers miss nothing. Do NOT over-summarize; preserve definitions, lists, numbers, formulas, tables. Give the source path and heading for every item. Start with a file inventory table. Cover at least: definition and justified progress; axioms A1–A15 full text; the 10-step cycle; operating theory (four loops, v0.1 five state spaces, intervention calculus, OPD+C, maturity levels, 12 laws, falsification); refinement candidate (C1–C8, N/E/M + A/P, Concern/WorkUnit, Quick/Guided/Assured, adapter levels, D1–D3); kernel v0.2 candidate (P1–P7, vocabulary, record types and fields, quality model, review triggers, policy engine (now out of scope), projection invariants, authority envelope, adapter capability manifest, event types); CLI experience v0.2 (surfaces, gate conditions, forbidden experiences, approval theater); inquiry map templates, research methods M1–M8, method cards, method-transfer-map (all 35 methods + 7-step procedure); friendly docs glossary; experiments and dogfood findings. End with "설계에 바로 쓸 체크리스트". Final message: path, number of files read, files not read.
```

**S2 대화 발췌 1** (`docs/handoff/conversation-transcript-until-158.md`의 앞부분, 대략 1~1777행. 이전 세션의 seg1a+seg1b)
```text
Read lines 1–1777 of docs/handoff/conversation-transcript-until-158.md (a long Korean conversation about designing "Helm"). Write ONE file: docs/design/process/sources/conversation-extracts-1.md (Korean). Extract every design-relevant idea, decision, requirement, user statement, critique, correction, verified technical fact and open question, organized by topic. Preserve detail (lists, schemas, sequences, API names, numbers, rules). For each item give `L<line>` and mark [사용자] or [Claude], plus [사용자 동의] if the user explicitly agreed; mark corrections. Topics include: vendor-neutral harness principles; context slots; tool promotion criteria; bash bypassing write hooks; observer agent C (all details); pi 1.x facts; subagent landscape; RLM and codemode facts and corrections; divergence subsystem (diagnosis, idea, critique, "I don't know what I want", goal/solution-space correction, full 5-stage design, test-5-vague-tasks step); old Helm repo analysis (dogfood evidence, "model drafts, human reacts", implementation-first warning); Helm as engine (axiom A1–A15 classification table, 3-layer structure, typed submission rule, pi extension mapping, unverified items, observation must reference tool-call id, metrics, implementation order). End with lists: (a) 사용자 결정·동의, (b) 답 없는 제안, (c) 검증된 기술 사실, (d) 열린 질문. Final message: path and item count.
```

**S3 대화 발췌 2** (같은 파일 1778행~끝. 이전 세션의 seg2~seg4)
```text
Read docs/handoff/conversation-transcript-until-158.md from line 1778 to the end. Write ONE file: docs/design/process/sources/conversation-extracts-2.md (Korean). Same extraction rules as extract 1 (L<line>, [사용자]/[Claude]/[사용자 동의], corrections, preserve detail). Topics include: the user's answer "C와 A" and the C/A design (agreement items, blocking, submit format, settle-before-submit, accept options, integration list, state machine, 2-human-touch cap, 2-week metrics); runtime of world model/units/loops (planes, lifetimes, loop three sizes, 10-step contracts, generation rules, RLM application points); Helm inside pi (one process two codes, ledger, feature mapping, limits); axiom device table; general vs category-scoped Helm (reasons, entry paths, conditions, examples, signals, metrics); modes (OICA=flow, NEMAP=state, OPD+C=evaluation, maturity, core questions, re-entry, linearizations, mode definition, invariants); pure Helm runtime (single change path, relations as write-time constraints, event log canonical, quality states, matrices, hierarchical state machine, contracts as data, macro scheduler/attention budget, decision owners, per-axiom items, tests, implementation order, "don't use documents as state"); tutoring outcomes (promotion rule incl. counterChecked and discriminating check, A loop human-only reasons, A/P test, helm.mjs 8 rejections and 3 rejection kinds, effect class removal and Claude's risk warning); the user's five ideas and responses; critique round (VoI/Horvitz/Parasuraman/McFarlane/LLM research, OICA critique, primitive capabilities, Goal/Concern/Projection redefinitions, OPD+C client); McFarlane delivery methods development; taste-type origin and rejection of "pick 2–3"; Cynefin; expectation record; loop composition and dependency rules; possibility/outcome inquiries; S loop; pi-durable spike findings; pi-durable vs pi coding agent correction; assistant-ui findings; topology A/B/C, 7 pre-work items, ADR format. End with the same four lists. Final message: path and item count.
```

### 5.2 1단계 Opus 공통 프롬프트 틀

각 에이전트에 아래 틀을 쓰고 `{...}`를 §4.1 표로 채운다.

```text
너는 Helm 설계 에이전트 {P번호 역할}다. 가능한 가장 높은 추론 수준으로 일한다.
1) docs/design/process/00-design-brief.md 를 처음부터 끝까지 읽는다. 브리프가 다른 자료보다 우선한다.
2) 브리프 §4 입력 자료 중 담당 주제와 관련된 것을 빠짐없이 읽는다. 특히: {담당별 필수 자료}. 원천 발췌(docs/design/process/sources/)와 대화 원문으로 대화에서 나온 결정·세부를 확인한다.
3) 담당 문서 {파일 목록}을 docs/design/ 에 쓴다. 다룰 내용: {§4.1 중점 + 브리프 §3.4 핵심 내용 + 브리프 §3.5에서 이 에이전트에게 배정된 누락 항목}.
4) 브리프 §5 작성 규칙과 문서 구성(8개 절)을 따른다. 구현자가 이 문서만 보고 구현할 수 있을 만큼 구체적으로 쓴다(타입, 스키마, 상태 기계 표, 알고리즘, 오류, 완료 기준).
5) 다른 에이전트가 동시에 다른 문서를 쓰고 있다. 자기 문서만 쓴다. 이미 있는 다른 문서는 읽고 맞춘다.
6) 최종 메시지는 브리프 §7 형식(작성 파일과 절 목록, 주요 결정, 다른 문서에 대한 요구, 미결 사항, 브리프에 대한 이의)으로 한국어로 쓴다.
```

### 5.3 2a단계 통합 지시 (1단계 에이전트에게 이어서 보내는 메시지)

```text
1단계 문서가 모두 나왔다. 다음을 한다.
1) 네 문서와 인터페이스가 맞닿은 문서 {관련 문서 번호}를 끝까지 읽는다.
2) 이름·타입·ID·이벤트·메서드·상태·책임 경계가 어긋나는 곳을 찾는다. 네 문서 쪽을 고칠 것은 고치고, 상대 문서를 고쳐야 할 것은 목록으로 보고한다.
3) 조정자가 모은 "다른 문서에 대한 요구" 중 네게 온 것: {목록}. 반영하거나, 반영하지 않는 이유를 적는다.
4) 최종 메시지: 고친 내용, 상대 문서에 대한 요구, 남은 충돌.
```

조정자는 이 단계에서 문서 간 충돌을 모아 판정하고, 판정 결과를 해당 소유자에게 다시 보낸다. 판정 기록은 design-log에 남긴다.

### 5.4 3단계 검증 지시 틀

```text
너는 Helm 설계 검증자 {V번호 관점}다. 설계 문서를 작성하지 않았고, 비판적으로 평가하는 것이 임무다. 가능한 가장 높은 추론 수준으로 일한다.
1) docs/design/process/00-design-brief.md 와 docs/design/ 의 모든 설계 문서를 읽는다. 관점에 필요한 원천(브리프 §4, docs/design/process/sources/, 대화 원문, ../pi-src)을 확인한다.
2) {관점별 주요 확인 사항 — HANDOFF §4.2}
3) 결과를 docs/design/process/verification/round-{n}/{V번호}-{관점}.md 에 쓴다. 지적마다 번호, 심각도(치명/높음/중간/낮음), 대상 문서·절, 지적 내용, 근거, 수정 제안을 표로 쓴다. 칭찬과 요약은 쓰지 않는다.
4) 최종 메시지: 심각도별 건수와 가장 중요한 지적 5개.
```

---

## 6. 파일 지도

| 경로 | 내용 |
|---|---|
| `docs/handoff/HANDOFF.md` | 이 문서 |
| `docs/handoff/conversation-transcript-until-158.md` | 대화 [1]~[158] 추출본 (4,408행) |
| `docs/design/process/00-design-brief.md` | 공통 브리프 (저장소 경로판) |
| `docs/design/process/design-log.md` | 작업 이력 |
| `docs/design/process/sources/pi-layer-analysis.md` | pi 모노레포 레이어 분석 원본 |
| `docs/v0.3/00~14-*.md` | Helm v0.3 개념 문서와 이전 구현 초안 (감사 결과 반영본) |
| `docs/v0.3/audit/audit-report.md` | v0.3 전수조사 결과 |
| `docs/v0.3/audit/backend-oss-research.md` | 에이전트 백엔드 오픈소스 조사 |
| `docs/v0.3/audit/mastra-review.md` | Mastra 검토 |
| `docs/v0.3/audit/pi-runtime-options.md` | pi 활용 방식 여섯 가지와 추천 |
| `experiments/durable-spike/` | pi-durable 스파이크 2개 |
| `experiments/helm-toy/helm.mjs` | 장난감 커널 (21번 시도 중 8번 거부) |
| `experiments/pi-lab/` | pi 층별 실험 6개 |
| `docs/foundations/` 등 | Helm v0.1·v0.2 원전 |
