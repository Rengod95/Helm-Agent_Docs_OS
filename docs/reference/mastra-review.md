# Mastra 검토

- 검토일: 2026-10-11
- 대상: `@mastra/core` 1.75.0 (2026-10-07), 문서 https://mastra.ai/docs/guides/overview 와 관련 문서
- 방법: 문서를 읽었다. 패키지(core, libsql, memory, server, hono, mcp, client-js)를 설치해 타입 정의와 소스를 확인했다. 워크플로 크래시·재기동 실험을 LibSQL 파일 DB로 실행했다(LLM 호출은 하지 않았고, 텔레메트리는 끈 상태).
- 확인 수준
  - [원문]: 문서, 타입, 소스를 직접 확인함
  - [실험]: 코드를 돌려 동작까지 확인함
  - [검색]: 검색 결과나 README만 확인함
  - [지식]: 기존 지식
  - [판단]: 위 사실에 기반한 분석
- 질문: Helm 데몬(개인 WSL 서버, 클라이언트 없이 작업 지속, 데스크톱 앱 우선)의 기반으로 쓸 수 있는가.

## 0. 결론

**판정: Mastra 전체를 데몬 프레임워크로 채택하지 않는다. 일부 패키지를 골라 쓰고 설계 몇 가지를 가져온다.** [판단]

이유는 네 가지다.
1. **pi 세션을 스텝으로 넣으면 크래시 때 그 스텝이 처음부터 다시 실행된다.** [실험]
   - Mastra 워크플로의 내구성 단위는 스텝이다. 이미 끝난 스텝은 다시 실행되지 않는다.
   - 실행 중이던 스텝은 `restart: true` 플래그만 받고 처음부터 다시 돈다.
   - pi 세션을 이어서 실행하는 로직은 결국 pi와 Helm 쪽에 있어야 한다.
2. **상태 저장소가 둘이 된다.**
   - Mastra는 run마다 스냅샷 한 행을 덮어쓰는 방식이다 [실험].
   - Helm의 기준 원본은 append-only 커널 이벤트 로그다. 두 저장소가 어긋날 때의 규칙을 따로 만들어야 한다.
3. **Helm에 필요한 대기 기능 일부가 없다.**
   - 대기 시한이 없다. 답이 대기보다 먼저 오면 오류가 난다. 크래시 후 `sleep`은 시간을 처음부터 다시 잰다 [원문, 실험].
   - 재접속 재생은 Mastra 자체 Agent의 durable 모드에만 있다. 그것도 기본 캐시가 메모리라서 재시작 후에도 재생하려면 Redis가 필요하다 [원문].
   - 결국 이 부분은 Helm 코드로 만들어야 한다.
4. **유지 부담이 크다.**
   - 7개 패키지를 설치하면 npm 패키지 204개, 248MB다 [실험].
   - 1.0(2026-01) 이후 9개월 만에 1.75가 됐고, minor 버전이 거의 매주 올라간다 [원문].
   - durable agent 같은 핵심 기능이 Beta다. 텔레메트리(PostHog)가 기본으로 켜져 있다 [원문].

pi를 버리고 Mastra Agent를 런타임으로 삼는다면 평가가 달라진다(§3).

## 1. Mastra 구성

Kepler Software가 만드는 TypeScript 에이전트·애플리케이션 프레임워크다. 독립 Node 서버로 빌드하거나 기존 서버(Express, Hono 등)에 붙여 쓴다. [원문]

| 영역 | 내용 |
|---|---|
| Agent | 모델 라우터(`provider/model`), 도구, 메모리, 구조화 출력, processor, 도구 훅, 도구 승인, supervisor 방식 하위 에이전트 |
| Workflow | `createStep` / `createWorkflow`. then, parallel, branch, dountil, foreach. 중첩, suspend/resume, sleep/sleepUntil, cron 스케줄, restart |
| Harness | durable agent(Beta), background task, goal, schedule, signal, AgentController, `createCodingAgent()` |
| Memory | 스레드, 메시지 이력, observational memory, working memory, semantic recall |
| Storage | libsql(SQLite), Postgres 등 20여 종. 도메인별 테이블 |
| Server | Hono 기반. `mastra dev/build/start`, 서버 어댑터 8종, 인증, 커스텀 라우트, client-js |
| 연결 | MCP 클라이언트·서버, A2A, ACP(`@mastra/acp`로 Claude Code·Codex·OpenCode 등 실행), SDK 래퍼(`@mastra/claude` 등) |
| Workspace | 파일 시스템, shell, LSP, skills, code mode |
| 관측·평가 | span 트레이스, 로그, 메트릭. scorer, 데이터셋, experiment |
| Studio | 로컬 웹 UI (`localhost:4111`) |
| Mastra platform | 호스팅 서비스(이전 Mastra Cloud). 셀프 호스팅에는 필요 없음 |

에이전트 네트워크용 `.network()`는 deprecated이고, supervisor 방식으로 옮기라고 안내한다. [원문]

### Guides 섹션 (7편)

| 가이드 | 내용 |
|---|---|
| Multi-agent systems | handoff, workflow, supervisor, council 패턴 비교. 패턴마다 제어를 누가 갖는지와 Mastra 구현 수단 |
| Context engineering | 모델 컨텍스트에 넣는 방법 비교: instructions, 도구, RAG, 파일 시스템, memory, signal, skill, processor, 하위 에이전트 경계. compaction 기능은 기본 제공하지 않음 |
| Agent lifecycle | run을 준비 → 루프 → 마무리로 나눔. 모델 step마다 processor가 호출되는 순서, 정지 조건, 재시도, 일반 run과 durable run의 차이 |
| Authentication and identity | `server.auth`로 신원 확인, `RequestContext`로 전파, 소유 범위 지정, RBAC·FGA |
| MCP authentication | Mastra가 MCP 클라이언트일 때와 서버일 때의 자격 증명 경계, OAuth, 토큰 전달 금지 |
| Streaming | `Agent.stream()`·`Run.stream()` 이벤트, AI SDK 변환, 도구와 스텝의 `writer` |
| Build an eval loop | 데이터셋, LLM judge, experiment 비교, 운영 trace를 데이터셋으로, CI 회귀 검사 |

Context engineering과 Agent lifecycle은 Helm의 투영(모델에게 주는 컨텍스트)과 processor 위치 설계에 참고할 만하다. [판단]

## 2. pi를 유지하고 Mastra를 데몬으로 쓰는 경우

### 2.1 가능한 것 [원문]

- 스텝의 `execute`는 임의의 async 함수다. 그 안에서 pi SDK `createAgentSession`을 부르거나 `pi --mode rpc`를 띄울 수 있다.
- 스텝 인자: `abortSignal`, `writer`(스트림 출력), `suspend`, `bail`, `retryCount`, `restart`, `runId`.
- pi 이벤트를 `writer`로 run 스트림에 흘려보낼 수 있다.
- 서버, 인증, 저장소, 스케줄, Studio를 한 번에 얻는다.

### 2.2 크래시 실험 [실험]

| 시험 | 결과 |
|---|---|
| 스텝 s1(즉시 완료) → s2(8초, pi 세션 역할) → s3(suspend). s2 실행 중 `kill -9` | DB에는 run `running`, s1 `success`, s2 `running` |
| 새 프로세스에서 `restartAllActiveWorkflowRuns()` | s1은 다시 실행하지 않음. s2는 처음부터 다시 실행(`restart=true`). 이후 s3에서 suspend |
| `.sleep(10000)` 3초 뒤 kill, 재기동 | 재기동 시점부터 10초를 다시 잠 |
| `.sleepUntil(절대 시각)` 도중 kill, 재기동 | 원래 시각에 정확히 깨어남 |
| 재기동 경로 | `mastra dev/build` 서버는 부팅 때 자동 재시작. 직접 임베드하면 직접 호출해야 함 [원문] |
| 문서상 한계 | 기본 in-process worker는 크래시를 견디지 못한다고 명시. 자동 재구동은 durable agent에만 있음 [원문] |

### 2.3 Helm에 주는 의미 [판단]

- **pi 세션 하나를 스텝 하나로 넣으면 단위가 너무 크다.** 크래시 때 세션 전체가 다시 시작된다. 피하려면 `restart=true`를 받은 스텝이 pi 세션 파일이나 pi-durable 기록을 읽어 이어 가야 한다. 이 로직은 Mastra 밖에 있다.
- **스텝을 잘게 나누면 Helm 커널과 역할이 겹친다.** pi 턴이나 커널 action 하나를 스텝 하나로 만들면 Mastra 스냅샷이 두 번째 상태 저장소가 된다.
- **pi 자식 프로세스는 데몬과 함께 종료된다.** 살아 있는 외부 프로세스에 다시 붙는 기능은 없다.
- `mastra build`는 Rollup으로 번들링한다. pi SDK처럼 동적 import가 있는 패키지는 external 설정이 필요할 수 있다. [지식]

## 3. Mastra Agent로 pi를 대체하는 경우

| 항목 | 얻는 것 | 잃는 것 |
|---|---|---|
| 내구성 | durable agent(Beta): 크래시 복구, observe 재접속, 소유권 lease(10초 갱신, 30초 만료)와 fencing | pi-durable에 들인 작업 |
| 사람 개입 | 도구 승인, 거절 사유 전달, 재시작 후 `listSuspendedRuns()`로 다시 찾기, `askUserTool` | - |
| 코딩 도구 | `createCodingAgent()`: 파일 읽기·쓰기, grep, 명령 실행 | pi의 코딩 도구와 사용 경험 |
| 확장 | processor 파이프라인, 도구 훅, signal, skill | pi 확장 API와 이미 만든 확장 |
| 세션 구조 | memory 스레드, 스레드 복제 | pi 세션 트리(분기 이동) |
| 터미널 사용 | - | pi TUI, SSH + pi 경로 |
| 벤더 중립 | ACP·SDK 래퍼로 Claude Code, Codex 등 실행 | 래퍼된 런타임은 자체 루프와 도구를 유지하므로, Mastra 도구 훅이 그 내부 도구 호출에는 적용되지 않음. ACP 권한 요청 기본값은 "첫 번째 옵션 선택"이라 반드시 바꿔야 함 |

출처: [원문]

데몬, 승인, 재접속이 한 체계로 정리되는 것은 장점이다. 대신 Helm이 pi를 고른 이유(확장 모델, 세션 트리, 터미널 중심 사용)를 다시 만들어야 한다. 외부 런타임에 커널 규칙을 강제할 수 있는 범위는 pi 기반 설계와 같다. 해당 런타임의 권한 콜백과 MCP 도구 수준까지다. [판단]

## 4. Helm 커널 규칙을 Mastra에서 강제하는 방법

| Helm 요구 | Mastra 수단 | 한계 |
|---|---|---|
| 실행 전 도구 호출 차단 (pi `tool_call` 차단에 해당) | `hooks.beforeToolCall`이 `{ proceed: false, output }`을 반환하면 실행을 건너뛰고 output을 결과로 돌려줌. MCP, workspace, 하위 에이전트 도구 모두에 적용 [원문] | 인자를 고쳐서 실행시키는 반환 형태는 없음 |
| 타입이 정해진 action 도구 | `createTool({ inputSchema, outputSchema })` (zod 등) [원문] | 검증 실패 시 오류 객체를 모델에 돌려줌 |
| 근거는 실제 도구 결과 id를 참조 | 도구 `execute` 안에서 Helm 로그를 조회해 검증. `processToolResult`로 결과에 id를 붙일 수 있음 [원문] | 전용 기능은 없음. Helm 코드로 구현 |
| 쓰기는 합의 범위 안에서만 | `beforeToolCall`에서 범위 검사, 또는 호출별 `requireToolApproval` 함수 [원문] | 함수형 승인은 durable agent에서 직렬화되지 않아 "모든 호출 승인"으로 바뀜 |
| 결과 확인은 사람만 | 모델 도구로 노출하지 않고, 인증된 커스텀 API 라우트로만 노출 [원문] | RBAC·FGA는 EE 라이선스. 1인용에는 SimpleAuth/JWT로 충분 |
| 승인과 실제 실행 인자 묶기 | 승인 때 도구 이름과 인자의 지문을 저장하고 `beforeToolCall`에서 대조, 한 번 쓰면 소진 (문서 예시) [원문] | - |
| 입력·출력 검사 | processor 9개 위치(입력, step 입력, LLM 요청, 출력 스트림, LLM 응답, 도구 실행 전 출력, 도구 결과, 최종 출력, API 오류). `abort(reason)` [원문] | durable run 재개 시 초기 `processInput`은 다시 실행되지 않음 |

## 5. 며칠 걸리는 사람 응답 대기

| 요구 | Mastra 동작 |
|---|---|
| 대기 상태 영속 | `suspend(payload)` 상태가 저장되고, 다른 프로세스에서 `resume`으로 이어짐 [실험] |
| 재시작 후 대기 목록 | 워크플로는 run 조회 API, Agent는 `listSuspendedRuns()` [원문] |
| 질문과 답의 형식 | `suspendSchema` / `resumeSchema`, 재개 시 원래 질문 `suspendData` [원문] |
| 대기 시한 (가정 만료, 기한까지 무응답) | **없음.** `waitForEvent(timeout)`은 제거됨. 문서 예시는 `setTimeout`이라 프로세스 메모리에만 있음 [원문] |
| 우회 | 별도 워크플로가 `sleepUntil(기한)` 후 원래 run을 `resume({timedOut:true})`. 이미 재개된 run이면 오류가 나므로 멱등 처리 필요 [실험] |
| 답이 대기보다 먼저 도착 | `This workflow run was not suspended` 오류 [실험]. 답을 Helm 질문 레코드에 먼저 저장하고 스텝이 suspend 전에 확인하는 구조가 필요 |
| 스케줄 | cron 스케줄은 영속됨. 데몬이 꺼진 동안 지나간 실행은 재생하지 않음. 일회성 시각 스케줄은 찾지 못함 [원문] |

## 6. 클라이언트 쪽

- **스트리밍과 재접속**
  - durable agent는 `observe(runId)`로 여러 클라이언트가 같은 run을 구독하고 캐시된 이벤트부터 받는다. [원문]
  - 기본 캐시는 메모리다. 재시작 후에도 재생하려면 Redis나 Valkey가 필요하다. SQLite 캐시 구현은 없다. 워크플로 watch 이벤트는 캐시하지 않는다. [원문]
  - Helm에서는 커널 이벤트 로그를 시퀀스 번호로 재생하는 편이 단순하다. [판단]
- **인증**
  - 인증을 설정하지 않으면 모든 라우트와 Studio가 열려 있다.
  - SimpleAuth(토큰)와 JWT가 core에 있다. Studio SSO, RBAC, FGA는 EE다. [원문]
- **assistant-ui**
  - 공식 경로는 `@mastra/ai-sdk`의 `chatRoute`와 assistant-ui `useChatRuntime`이다. [원문]
  - 이 경로는 Mastra Agent 스트림을 전제로 한다. pi를 런타임으로 쓰면 pi 이벤트를 변환하는 라우트를 직접 만들거나 assistant-ui의 외부 상태 runtime을 써야 한다. [지식]
- **Tauri**: `@mastra/client-js`는 fetch 기반이라 웹뷰에서 쓸 수 있다. `server.cors`로 Tauri origin을 허용한다. [원문, 지식]

## 7. 단일 사용자 WSL 환경 부담

| 항목 | 내용 |
|---|---|
| 프로세스 | Node 1개. API, worker, scheduler가 모두 in-process. 기본 포트 4111 [원문] |
| 요구 사항 | Node ≥ 22.13.0 [원문] |
| DB | LibSQL 파일. 워크플로만 써도 첫 사용 시 `mastra_*` 테이블 44개 생성 [실험] |
| Redis | 필수는 아님. 재시작 후 스트림 재생, 다중 프로세스 lease가 필요할 때만 [원문] |
| 설치 크기 | 패키지 204개, 248MB (core 80MB, server 39MB) [실험] |
| 텔레메트리 | 기본 켜짐(PostHog). OS, 버전, 해시된 hostname, 구성 개수, 메트릭을 켜면 모델별 토큰 합계. `MASTRA_TELEMETRY_DISABLED=1`로 끔 [원문] |

## 8. 성숙도와 라이선스

- **버전 이력**: 0.1.0(2024-10) → 1.0.0(2026-01-20) → 1.75.0(2026-10-07). 게시 버전은 989개다. [원문]
- **1.75.0 수정 목록**: 재시작 후 대기 중 도구 호출이 사라지는 문제, 기본 엔진 run이 취소로 기록되는 문제 등 재시작 관련 수정이 많다. [원문]
- **기능 단계**
  - Beta: durable agent, workers, dynamic workflows
  - Experimental: `@mastra/temporal`
  - Deprecated: `.network()`, `waitForEvent`
  - [원문]
- **라이선스**
  - 기본은 Apache-2.0이다.
  - `ee/` 디렉터리(인증 EE, agent-builder EE 등)는 Mastra Enterprise Edition License v2.0이다. source-available이며, 운영 사용에는 계약과 라이선스 키가 필요하다. 개인 용도가 "운영 사용"에 해당하는지는 문구상 분명하지 않다. [원문]
  - Helm에서는 EE 기능을 쓰지 않는 편이 깔끔하다. [판단]

## 9. 가져다 쓸 것

**패키지**
- `@mastra/mcp`: Helm 커널 도구를 외부 런타임에 MCP로 노출할 때 쓴다.
- `@mastra/acp`, `@mastra/claude`: 나중에 Claude Code, Codex를 붙일 때 직접 쓰거나 참고한다. 권한 콜백 기본값은 바꿔야 한다.
- `@mastra/evals`: 관찰 에이전트의 분석 품질 평가에 쓸 수 있다.

**설계** [판단]
- 실행 소유권 lease와 fencing (10초 갱신, 30초 만료, 쓰기 시 소유권 확인)
- `suspendSchema` / `resumeSchema` / `suspendData` 쌍. Helm 질문 레코드의 질문·답 스키마에 대응한다.
- 저장소에서 대기 중인 실행을 다시 찾는 API (`listSuspendedRuns`)
- 승인을 도구 인자 지문에 묶고 한 번 쓰면 소진하는 방식. 합의 범위 확인에 쓸 수 있다.
- 재실행 표시 플래그(`restart`)
- 크래시에도 지켜지는 절대 시각 기반 `sleepUntil`. 가정 만료점과 기대 레코드 기한은 절대 시각으로 저장한다.
- signal 네 가지(`sendMessage` 즉시, `queueMessage` 다음 턴, `sendSignal` 알림, `sendStateSignal` 상태). 06의 전달 방식(즉시, 협상, 예약)과 비교할 거리다.
- processor 위치 체계(입력, 요청, 스트림, 도구 실행 전, 도구 결과, 마무리). 08 단일 변경 경로의 검사 위치를 정할 때 참고한다.

## 10. 다른 안과 비교

| 기준 | Mastra (pi 유지) | pi-durable + Helm 자체 SQLite 커널 로그 | OpenWorkflow (SQLite) |
|---|---|---|---|
| 상태 모델 | run 스냅샷 덮어쓰기, 스텝 단위 | append-only 로그가 기준 원본 | step 결과 기록과 재생 |
| 크래시 후 | 중단된 스텝을 처음부터 | pi-durable 범위 안에서 턴을 이어 감 | 마지막 완료 step 다음부터 |
| 장기 대기·타이머 | suspend 영속, sleepUntil 정확. 시한 없음, 선도착 답은 오류 | 직접 구현 | sleep, signal 있음. 대기자 없으면 신호 유실 |
| 서버·인증·스트림 | 기본 제공(재생은 제한적) | 직접 구현 | 없음 |
| 의존성 | 큼 | 작음 | 작음 |
| Helm 적합도 | 중간 이하 | 높음 (구현량이 많음) | 중간 (데몬 안의 대기·타이머 엔진으로) |

권장 순서 [판단]
1. pi-durable과 Helm 자체 SQLite 커널 로그를 기본으로 한다.
2. 타이머와 장기 대기가 커지면 OpenWorkflow 같은 경량 엔진을 데몬 안에 두는 안을 검토한다.
3. Mastra는 MCP·ACP 패키지와 위 설계를 참고하는 용도로 쓴다.
4. pi를 버리고 Mastra Agent를 런타임으로 삼기로 하면 그때 durable agent와 AgentController를 중심으로 다시 평가한다.

## 11. 출처

- Guides: https://mastra.ai/docs/guides/overview , multi-agent-systems, context-engineering, agent-lifecycle, authentication-identity, mcp-authentication-authorization, streaming, build-an-eval-loop (각 `https://mastra.ai/docs/guides/<이름>.md`)
- Harness: https://mastra.ai/docs/harness/overview.md , https://mastra.ai/docs/harness/durable-agents.md , https://mastra.ai/docs/harness/schedules.md , https://mastra.ai/docs/harness/agent-controller.md
- Workflows: https://mastra.ai/docs/workflows/suspend-and-resume.md , https://mastra.ai/docs/workflows/snapshots.md , https://mastra.ai/docs/workflows/human-in-the-loop.md , https://mastra.ai/docs/workflows/scheduled-workflows.md
- Agents: https://mastra.ai/docs/agents/human-in-the-loop.md , https://mastra.ai/docs/agents/tools.md , https://mastra.ai/docs/agents/processors.md
- Server·인증·배포: https://mastra.ai/docs/server/overview.md , https://mastra.ai/docs/server/pubsub.md , https://mastra.ai/docs/deployment/mastra-server.md , https://mastra.ai/docs/deployment/workers.md , https://mastra.ai/docs/auth/simple-auth.md
- 연결: https://mastra.ai/docs/connections/acp.md , https://mastra.ai/docs/connections/sdk-agents.md
- 통합: https://mastra.ai/integrations/agentic-ui/assistant-ui.md
- 레퍼런스: https://mastra.ai/reference/cli/mastra.md (텔레메트리), https://mastra.ai/reference/coding-agent/create-coding-agent.md , https://mastra.ai/reference/migrations/network-to-supervisor.md
- 라이선스·변경 이력: https://raw.githubusercontent.com/mastra-ai/mastra/main/ee/LICENSE , https://raw.githubusercontent.com/mastra-ai/mastra/main/packages/core/CHANGELOG.md
- npm: https://registry.npmjs.org/@mastra/core
- 실험 스크립트: 작업 공간 `mastra-lab/exp/` (크래시·재기동, sleep, sleepUntil, 선도착 resume, restart 플래그)
