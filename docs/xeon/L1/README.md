---
id: L1.readme
layer: L1
domain: readme
kind: readme
status: draft
depends_on: [L1.tasks.spec, L1.loop.spec, L1.models.spec, L1.tools.spec, L1.context.spec, L1.persistence.spec, L1.agents.spec, architecture.layers.spec, eng.context-map.design]
binds: [xeon/packages/core-*/**, xeon/plugins/provider-anthropic-oauth/**]
---

# L1 코어 층

## 1. 목적

L1은 거의 바뀌지 않는 코어 플러그인 7개다. 대화형 에이전트 런타임의 실행(태스크, 루프), 모델 호출, 도구 실행과 권한, 컨텍스트와 컴팩션, 영속성과 복구, 서브에이전트를 맡는다. Helm과 학습 그룹 같은 의도 그룹(L3)과 능력(L2)은 이 층이 연 서비스와 확장 지점 위에 얹힌다(`_research/decisions-log.md` 2026-10-21 구상 변경).

- 각 도메인은 Cordis 서비스 하나 이상을 제공하는 패키지 하나다. 같은 층끼리는 import하지 않고 서비스로 협력한다(§4).
- 바퀴를 다시 만들지 않는다. pi-ai는 npm 정확 고정 버전으로 쓰고 부족분만 포크한다(`_research/layer-plan-v2.json` L1 intro, `_research/layer-plan-v2-notes.md` 층 사이 규칙 7). 루프는 pi-agent-core 1.3.0 루프를 core-loop로 포크해 다시 설계한 자체 루프이고 pi-agent-core에는 의존하지 않는다(adr.0009).
- 이 문서는 층 차원의 표와 경계만 둔다. 도메인 규칙은 각 spec에 있고 여기서 복제하지 않는다.

## 2. 도메인

계획 v2 하위 층 7개(L1-a~g)가 layout 도메인 7개에 1:1로 대응한다(`eng.context-map.design` §4.5).

| 도메인 | 하위 층 | 한 줄 요약 | 패키지 | 컨텍스트 | Cordis 서비스 | 문서 |
|---|---|---|---|---|---|---|
| tasks | L1-a 태스크 엔진 | 범위 트리, 취소 전파, 동시 상한, 키 큐, 내구 입력 큐 | `xeon/packages/core-tasks` | `run-engine` | `xeon.tasks` | `L1.tasks.spec`, `L1.tasks.plan` |
| loop | L1-b 에이전트 루프 | agent-core 루프 래핑, 단계 커밋과 체크포인트, 예산(pi 방식), 완료 게이트 | `xeon/packages/core-loop` | `run-engine` | `xeon.loop` | `L1.loop.spec`, `L1.loop.plan` |
| models | L1-c 모델 게이트웨이 | pi-ai provider, 역할 라우팅, 추론 예산, 캐시 정책, 사용량, 위장 provider 분리 | `xeon/packages/core-models` (+ `xeon/plugins/provider-anthropic-oauth`, 배포 제외) | `model-gateway` | `xeon.models` | `L1.models.spec`, `L1.models.plan` |
| tools | L1-d 도구 실행과 권한 | 노출, 실행 파이프라인, 정책 엔진, 권한 모드, 승인 프로토콜, 결과 경계화 | `xeon/packages/core-tools` | `tool-runtime` | `xeon.tools`, `xeon.approvals` | `L1.tools.spec`, `L1.tools.plan` |
| context | L1-e 컨텍스트와 컴팩션 | 접두 고정 조립, 도구 변경 메시지, 캐시 표식, 롤링 요약 컴팩션, 오버플로우 복구 | `xeon/packages/core-context` | `run-engine` | `xeon.context` | `L1.context.spec`, `L1.context.plan` |
| persistence | L1-f 영속성과 복구 | 이벤트 저장과 투영, 원자 커밋, 결과 불명 처리, 재개, 분기 | `xeon/packages/core-persistence` | `session-core` | `xeon.session` | `L1.persistence.spec`, `L1.persistence.plan` |
| agents | L1-g 서브에이전트 | 인프로세스 자식 대화, 권한 상한, 결과 반환, 백그라운드 위임, 목표 판정 호출 | `xeon/packages/core-agents` | `run-engine` | `xeon.agents` | `L1.agents.spec`, `L1.agents.plan` |

- 서비스 이름은 `eng.context-map.design` §5.3 표와 같다. 인터페이스(`TaskService`, `LoopService`, `ModelService`, `ToolService`, `ContextService`)와 서비스 이름 상수는 F `@xeon/contracts/services` 서브패스에 둔다 [결정: review.decisions-2 D-04]. `SessionService`는 `F.records.spec` §3.9에 있다. `ApprovalService`, `AgentService`도 같은 서브패스(`services/approvals.ts`, `services/agents.ts`)에 있다(`F.capabilities.spec` §3.12 규칙 7). X 포트가 같은 서비스 이름을 쓰면 서비스가 포트를 확장한다: `LoopService extends LoopPort`, `TaskService extends InputQueuePort`, `ToolService extends ToolsPort`, `ModelService extends ModelsPort`(같은 문서 규칙 2).
- `run-engine` 컨텍스트 하나가 패키지 넷(tasks, loop, context, agents)에 걸친다. 컨텍스트 안에서도 import하지 않고 서비스로 협력한다(`eng.context-map.design` §4.4 1행).

## 3. 경계

### 3.1 안

- 패키지 7개: `core-tasks`, `core-loop`, `core-models`, `core-tools`, `core-context`, `core-persistence`, `core-agents`.
- 플러그인 1개: `plugins/provider-anthropic-oauth`. `check-layers.ts`의 층 판정은 L1이다. 플러그인은 F, X, L0, 외부 패키지(pi-ai)만 import하고 `core-*`는 import하지 않는다 [결정: review.decisions-2 U-16]. 배포판에 넣지 않고 기본 꺼짐이다(`L1.models.spec` §4.11, `eng.dependency-rules.guide` DR-09).
- 각 패키지의 `package.json`은 `"xeon": { "layer": "L1", "domain": "<도메인>" }`을 둔다(`_research/foundation-plan.md` §3).

### 3.2 밖

| 대상 | 층 | L1과의 연결 |
|---|---|---|
| 이름·타입·스키마·지점 선언 | F `contracts` | L1은 F에서 이름을 가져온다(§11 규칙 1). 지점 선언 표는 F4에 두고 X와 공유한다(DR-12) |
| 지점 디스패치(fold, 핸들러 스냅샷, 실패 규칙), scope·drive·post 연산 | X `ext-host` | L1은 `xeon.ext`로 디스패치를 요청한다. Cordis는 ext-host 뒤에 있고 L1은 Cordis를 import하지 않는다(DR-11, ADR-0002) |
| 저장 기반(테이블 DDL, seq, PRAGMA, 임대, blob) | L0 `platform-store`(`xeon.store`) | persistence만 전체 핸들을 받는다. models·tools는 `xeon.store.scoped`로 자기 접두 테이블만 쓴다 |
| 실행 환경, 샌드박스 | L0 `platform-exec`, `platform-sandbox`(`xeon.exec`, `xeon.sandbox`) | 명령 실행과 샌드박스 래핑은 L2 도구(`cap-workspace`의 `bash` 등)가 쓴다. tools는 잠금 키 산출(`xeon.exec.canonicalPath`)과 출력 절단(`L1.tools.spec` §3.7)에만 `xeon.exec`를 쓴다(`L1.tools.spec` §4.12) |
| 비밀 해석과 마스킹 | L0 `platform-secrets`(`xeon.secrets`) | models는 요청 직전에 참조를 해석한다. tools는 값을 해석하지 않고 도구 결과를 2계층 마스킹한다. 실행 env 주입은 `xeon.exec`가 한다(`L1.tools.spec` §4.12) |
| 능력(웹, MCP, 지식, 작업, 대화, 산출물, 예약, 작업 도구) | L2 `cap-*` | L2가 L1 서비스(`xeon.tools`, `xeon.approvals`, `xeon.models`, `xeon.session`, `xeon.agents`)를 쓴다. L1은 L2를 부르지 않는다 |
| 의도 그룹(Helm, 학습 그룹) | L3 | 지점과 X 연산으로만 L1에 영향을 준다 |
| 전송, 설정 화면, 조립 루트 | L4 | `apps/host`가 L1 패키지를 등록한다(DR-14 예외 2) |

## 4. 협력

### 4.1 서비스 호출 표

[결정] L1 패키지끼리 import하지 않는다. 협력은 F 정의와 Cordis 서비스로만 한다(`eng.dependency-rules.guide` DR-02, `_research/foundation-plan.md` §3). 근거 열은 `eng.context-map.design` §4.1 (d)열과 각 spec의 "요구" 표다.

| 호출하는 도메인 | 호출받는 서비스 | 용도 | 근거 |
|---|---|---|---|
| loop | `xeon.models` | 단계 바인딩 해석, `streamFn`, 사용량 | `L1.loop.spec` §3.2, `L1.models.spec` §3.3 |
| loop | `xeon.tools` | 광고 목록, agent-core 도구 어댑터, 실행 관찰. 재개 때 대기 호출은 core-loop가 agent-core `runToolCall`에 이 도구·훅을 넣어 실행 | `L1.tools.spec` §3.3, §8.1 |
| loop | `xeon.context` | 조립(`assemble`), `convertToLlm`, 임계 검사, 오버플로우 복구 | `L1.context.spec` §3.1 |
| loop | `xeon.session` | T1~T6 커밋, 가지 읽기, 재개 | `L1.loop.spec` §3.5 |
| loop | `xeon.tasks` | turn·step 노드, `modelCalls` 슬롯, 입력 큐 배치 | `L1.tasks.spec` §8 |
| loop | `xeon.ext` | 지점 12개 디스패치 | `L1.loop.spec` §7 |
| tasks | `xeon.session` | `input.*`, 취소 의도 커밋 | `L1.tasks.spec` §8 요구 |
| models | `xeon.secrets` | 자격 증명 참조 해석, 마스킹 | `L1.models.spec` §3.9 |
| models | `xeon.ext` [제안] | 지점 6개 디스패치 | `L1.models.spec` §8.3 4 |
| models | `xeon.store` (M3) | `core_models_*` | `L1.models.spec` §4.8 |
| tools | `xeon.session` | 효과 3단, 승인 이벤트 커밋 | `L1.tools.spec` §8.2 |
| tools | `xeon.exec` | 잠금 키 산출(`canonicalPath`), 출력 절단(review.decisions-2 D-08). 명령 실행은 하지 않는다 | `L1.tools.spec` §3.7, §4.2 7b, §4.12 |
| tools | `xeon.secrets` | 도구 결과 2계층 마스킹(`Redactor.maskDeep`), `check`의 승인 연결. 값 주입은 하지 않는다 | `L1.tools.spec` §4.12 |
| tools | `xeon.tasks` | tool 범위 노드, 키 큐(M1), `tools` 풀(M2) | `L1.tools.spec` §4.2 7a~7c, `L1.tasks.spec` §8 제공 |
| tools | `xeon.store` | blob, `core_tools_*` | `L1.tools.spec` §8.4 |
| tools | `xeon.ext` | 지점 7개 디스패치 | `L1.tools.spec` §7 |
| context | `xeon.models` | `summary` 역할 호출, 토큰 추정, 오류 분류, 캐시 정책 | `L1.context.spec` §8.2 |
| context | `xeon.session` | 가지 읽기, `thread.compacted` 커밋 | 같음 |
| context | `xeon.ext` | 지점 6개 디스패치 | `L1.context.spec` §7 |
| persistence | `xeon.store` | 세션 테이블, 투영, 체크포인트 | `eng.context-map.design` §4.1 `session-core` 행 |
| agents | `xeon.loop` | 자식 thread turn 실행(`runChildTurn`) | `L1.agents.spec` §8.2, `L1.loop.spec` §3.1·§4.13 |
| agents | `xeon.tasks` | 소유 트리, `subagents` 풀, 완료 보고 post | 같음 |
| agents | `xeon.tools` | `evaluatePolicy`, 자식 광고, 차단 규칙 등록(`registerRules`) | 같음, `L1.tools.spec` §3.3 |
| agents | `xeon.models` | `judge`, `subagent` 역할 | 같음, `L1.models.spec` §3.4 |
| agents | `xeon.session` | `agent.*` 커밋, 멱등 조회 `TxView.agentByRequestId` | `L1.agents.spec` §3.5, `L1.persistence.spec` §3.2 |

층 밖에서 L1을 부르는 쪽(참고): X는 `xeon.session`, `xeon.tasks`, `xeon.loop`, `xeon.agents`를 쓴다(drive의 `loop.turn`·`loop.spawn`·post). L2는 `xeon.tools`(도구 등록), `xeon.approvals`, `xeon.models`(내장 검색 래퍼), `xeon.session`, `xeon.agents`를 쓴다.

### 4.2 협력 규칙

1. 주고받을 타입과 서비스 이름은 F에 둔다. 제공 패키지가 Cordis에 등록하고, 쓰는 패키지는 F 타입으로 주입받는다(DR-02 협력 방법 1~3).
2. 외부 라이브러리는 소유 패키지만 import한다. pi-ai는 `core-models`다. pi-agent-core는 어느 패키지도 import하지 않는다(DR-07, adr.0009). 다른 L1 패키지가 pi-ai 기능(토큰 추정, 오버플로우 감지)을 쓰려면 `xeon.models`를 거친다(`L1.models.spec` §3.3 `tokens`, `classify`). 에이전트 타입(`AgentTool`, `AgentEvent`, `AgentMessage` 등)은 F conversation이 정의한 것을 쓴다(`F.conversation.spec` §3.1.1). 도구 한 호출의 준비·실행은 core-tools 단계 계약이고 배치 스케줄은 core-loop다(adr.0009 §3.4). DR-07 소유 표에서 바꾸는 것은 pi-ai 소유에 위장 플러그인 `plugins/provider-anthropic-oauth`를 더하는 일 하나다(review.decisions-2 U-16).
3. 세션 테이블 쓰기는 `xeon.session`의 커밋 하나로만 한다(`eng.transactions.design` §6, CM-02).
4. 다른 컨텍스트의 테이블을 직접 쿼리하지 않는다(CM-02).

### 4.3 문서 의존 방향

[제안] spec·plan의 `depends_on`은 서비스를 쓰는 쪽이 제공하는 쪽을 적는 한 방향으로 둔다. 제공 쪽이 소비 쪽의 책임을 가리키는 역방향 참조(예: tasks가 잠금 키 산출을 tools에 맡김, persistence가 재개 실행을 loop에 맡김)는 본문 §8 요구 표에만 두고 `depends_on`에는 적지 않는다. 그래서 L1 문서 사이에 순환이 없다.

| 순서(제공 → 소비) | 문서 |
|---|---|
| 1 | `L1.persistence`, `L1.models`(L1 문서 의존 없음) |
| 2 | `L1.tasks`(→ persistence) |
| 3 | `L1.tools`(→ tasks, persistence) |
| 4 | `L1.context`(→ models, persistence) |
| 5 | `L1.loop`(→ tasks, tools, context, models, persistence) |
| 6 | `L1.agents`(→ tasks, tools, loop, models, persistence) |

- 빠진 역방향 쌍과 그 이유: loop → agents(loop는 판정 API만 쓰고 agents가 loop의 `runChildTurn`을 쓴다), tools → loop(loop가 `ToolRunContext`를 만들어 tools 훅을 쓴다), tools → agents(agents가 정책 어휘와 `registerRules`를 쓴다), tasks → tools(tasks는 불투명 키만 받는다), persistence → tasks·tools·agents·loop(persistence는 `xeon.store`만 부르는 가장 아래 컨텍스트다, `eng.context-map.design` §4.1 (d)열).
- 라우팅은 `depends_on`을 한 단계 펼친다(`_research/foundation-plan.md` §4). 역방향 문서가 필요한 작업은 그 문서의 `binds`나 이 README의 `depends_on`으로 고른다.

## 5. 한 턴 흐름 요약

전체 순서는 `architecture.runtime-flow.design` §4.1의 시퀀스 그림이다. L1 안의 순서는 `L1.loop.spec` §4.2다. 아래는 L1 안에서 내구 커밋이 일어나는 지점 세 곳이다. 모든 커밋은 `xeon.session` 커밋 하나를 거친다. 지점 이름은 `L1.persistence.spec` §4.2 대응표를 따른다. loop의 T1~T6과 persistence의 C·S·E·A·X는 그 표에서 서로 대응한다(T1 = C2, T2 = S1, T3 = C3, T4 = C5, T6 = C6).

| 커밋 지점 | 맡는 도메인 | 커밋 내용 | 내구성 | 근거 |
|---|---|---|---|---|
| 입력 admit | loop(`LoopService.admit`이 `input` 지점을 발화한 뒤) → tasks | `input.queued`(같은 `requestId`는 한 번만). 유휴 thread면 이어서 T1 `item.recorded` → `input.placed` → `turn.started` | FULL(모든 세션 커밋이 FULL, `L1.persistence.spec` §4.2) | `L1.loop.spec` §4.1·§3.5, `L1.tasks.spec` §4.7, `L1.persistence.spec` §4.2 C1·C2 |
| 도구 효과 | tools | 실행 전 `effect.intent`(+`effect.exec`), 실행 뒤 `effect.result`와 toolResult `item.recorded` 한 커밋 | FULL | `L1.tools.spec` §4.4, `F.records.spec` §3.5·§4.2 2, `L1.persistence.spec` §4.2 E1~E3 |
| 단계 경계 | loop(T4) | `step.completed`, `checkpoint.step`, boundary 엔트리, 다음 입력 배치, 확장 접두 테이블, context의 새 system item | FULL | `L1.loop.spec` §3.5, `L1.persistence.spec` §4.2 C5, `F.records.spec` §4.2 1, ADR-0004 |

- 이 밖의 커밋: 단계 시작(T2 = S1, `step.started`), 시작 전 추가(C2b `turn:<turnId>:prestart`), 응답 확정(T3 = C3, assistant `item.recorded`와 `part.recorded`), turn 끝(T6 = C6 `turn.completed`), 취소 의도(X1 `turn.abort_requested`), 승인 요청(A1), 컴팩션(별도 커밋 C7 `thread.compacted` + 새 접두 system item, 키 `compact:<threadId>:<stepId>:<reason>`, `L1.persistence.spec` §4.2)이 있다. 각 spec이 정한다. 한 단계의 커밋 수는 `3 + 3 × 도구 수`다(`L1.persistence.spec` §4.2).
- 모델 요청은 의도 커밋이 없다. 직전 단계 체크포인트가 그 역할을 하고 재개하면 요청을 다시 보낸다(`architecture.runtime-flow.design` §4.1 둘째 항목).
- 내구 이벤트는 커밋이 끝난 뒤에만 구독자에게 내보낸다(같은 절 넷째 항목).

## 6. 확장 지점 소유표

발화 소유 41개의 정본이다. 지점 이름, kind, fold는 `F.extensions.spec` §3.4 표와 같고 페이로드는 그 문서 §3.5를 따른다. "F §7"은 그 문서 §7 표의 kind별 발화 문서 배정이다.

| # | 지점 | kind | fold | 소유 | F §7 배정과의 차이 |
|---|---|---|---|---|---|
| 1 | `input` | input | chain | loop | 같음. runtime-flow §4.1 그림은 tasks로 그렸다(§13 (d)) |
| 2 | `user_bash` | input | first | loop | 같음 |
| 3 | `before_agent_start` | input | chain | loop | 같음 |
| 4 | `context` | request | chain | context | 같음(F는 request를 context·models 공동으로 적었다) |
| 5 | `context_with_system` | request | chain | context | 같음 |
| 6 | `cache_warming_decision` | request | chain | context | 같음 |
| 7 | `before_provider_request` | request | chain | models | 같음 |
| 8 | `before_provider_headers` | request | chain | models | 같음 |
| 9 | `after_provider_response` | request | tap | models | 같음 |
| 10 | `provider_stream_event` | request | tap | models | 같음 |
| 11 | `model_select` | request | tap | models | 같음 |
| 12 | `thinking_level_select` | request | tap(detached) | models | 같음 |
| 13 | `tool_call` | tool | first | tools | 같음 |
| 14 | `tool_result` | tool | chain | tools | 같음 |
| 15 | `tool_execution_start` | tool | tap | tools | 같음 |
| 16 | `tool_execution_update` | tool | tap | tools | 같음 |
| 17 | `tool_execution_end` | tool | tap | tools | 같음 |
| 18 | `agent_start` | boundary | tap | loop | 같음 |
| 19 | `turn_start` | boundary | tap | loop | 같음 |
| 20 | `message_start` | boundary | tap | loop | 같음 |
| 21 | `message_update` | boundary | tap | loop | 같음 |
| 22 | `message_end` | boundary | chain | loop | 같음 |
| 23 | `turn_end` | boundary | chain | loop | 같음 |
| 24 | `agent_before_settle` | boundary | chain | loop | 같음 |
| 25 | `agent_end` | boundary | tap | loop | 같음 |
| 26 | `agent_settled` | boundary | tap | loop | 같음 |
| 27 | `project_trust` | session | first | X(`X.loading-trust.spec`) | 같음. L1 밖 |
| 28 | `resources_discover` | session | chain | X(`X.loading-trust.spec`) | 같음. L1 밖 |
| 29 | `mcp_servers_change` | session | tap(detached) | L2.mcp(`L2.mcp.spec`) | 같음. L1 밖 |
| 30 | `session_start` | session | tap | persistence | 같음 |
| 31 | `session_info_changed` | session | tap(detached) | persistence | 같음 |
| 32 | `session_before_switch` | session | first | persistence | 같음 |
| 33 | `session_before_fork` | session | first | persistence | 같음 |
| 34 | `session_before_compact` | session | first | context | 같음(§13 (c)에서 F §7을 고쳤다) |
| 35 | `session_compact` | session | tap | context | 같음 |
| 36 | `session_compact_failed` | session | tap | context | 같음 |
| 37 | `session_before_tree` | session | first | persistence | 같음 |
| 38 | `session_tree` | session | tap | persistence | 같음 |
| 39 | `session_shutdown` | session | tap | persistence | 같음 |
| 40 | `ui_prompt_start` | session | tap(detached) | tools | 같음. 승인 프로토콜이 발화한다(`L1.tools.spec` §7) |
| 41 | `ui_prompt_end` | session | tap(detached) | tools | 같음 |

도메인별 집계:

| 도메인 | 개수 | 지점(위 표 #) | 근거 |
|---|---|---|---|
| tasks | 0 | 없음. post 대상 큐만 제공 | `L1.tasks.spec` §7 |
| loop | 12 | 1, 2, 3, 18~26 | `L1.loop.spec` §7 |
| models | 6 | 7~12 | `L1.models.spec` §7 |
| tools | 7 | 13~17, 40, 41 | `L1.tools.spec` §7 |
| context | 6 | 4, 5, 6, 34, 35, 36 | `L1.context.spec` §7 |
| persistence | 7 | 30~33, 37~39 | `L1.persistence.spec` §7 |
| agents | 0 | 없음. 자식 대화 안의 지점은 loop·tools가 발화 | `L1.agents.spec` §7 |
| L1 밖 | 3 | 27, 28(X), 29(L2.mcp) | `F.extensions.spec` §7 |

합계 41이고 각 지점의 소유자는 하나다.

## 7. 이벤트 kind와 테이블 접두 소유표

이름은 F 기준이다(`F.records.spec` §3.2·§3.3, §3.1.2 정본 표). 아래 kind는 모두 F 코어 카탈로그에 있다.

### 7.1 이벤트 kind

| 영역·kind | 내용 | 소유 도메인 | 생산자 id | F 상태 |
|---|---|---|---|---|
| `turn.started`, `turn.updated`(휘발), `turn.completed` | turn 수명 | loop | `core.loop` | 있음 |
| `turn.abort_requested` | 취소 의도 | loop(커밋 호출은 tasks의 `abortIntent`) | `core.loop` | 있음(`L1.tasks.spec` FR-T2 반영) |
| `step.started`, `step.updated`(휘발), `step.completed` | 단계 수명 | loop | `core.loop` | 있음 |
| `item.started`·`item.updated`(휘발), `item.recorded`(user, custom, system, assistant) | 입출력 단위 | loop | `core.loop` | 있음 |
| `item.recorded`(toolResult) | 도구 결과 item | tools(`effect.result`와 같은 커밋) | `core.tools` | 있음 |
| `part.recorded` | 어시스턴트 파트 | loop | `core.loop` | 있음 |
| `effect.intent`, `effect.exec`, `effect.result` | 도구 효과 3단 | tools | `core.tools` | 있음 |
| `approval.requested`, `approval.resolved` | 승인·질문·계획 승인 | tools | `core.tools` | 있음(`L1.tools.spec` §8.3 3 반영, 승인 요청 A안: review.decisions-2 U-02) |
| `thread.started`, `thread.updated`, `thread.closed`, `thread.leaf_moved` | thread 수명, 분기 | persistence | `core.persistence` | 있음 |
| `checkpoint.step` | 단계 체크포인트 | 이 층은 persistence로 배정한다. `L1.loop.spec` §3.7은 `core.loop`를 제안(§13 (j)) | `core.persistence` | 있음 |
| `thread.compacted`, `thread.branch_summarized` | 컴팩션, 떠난 가지 요약 | context | `core.context` | 있음(생산자 지정은 `L1.context.spec` §8.3 4 요청) |
| `input.queued`, `input.placed`, `input.withdrawn` | 내구 입력 큐 | tasks | `core.tasks` | 있음(`L1.tasks.spec` FR-T1 반영) |
| `agent.spawned`, `agent.settled`, `agent.judged` | 자식 대화 연결, 목표 판정 | agents | `core.agents` | 있음(`L1.agents.spec` §8.3 3 반영) |
| `model.*`(휘발) | 예약만 | models | `core.models` | 예약(`L1.models.spec` §7.3) |
| `scope.changed`, `lease.acquired`, `lease.released` | X 연산 결과 | L1 밖(X). 확장 post는 core-tasks가 `input.queued`(`source.type: "extension"`)로 쓴다 | `xh` | 있음. `post.accepted`는 retire했다 [결정: review.decisions-2 U-05](`L1.tasks.spec` FR-T3) |
| `settings.changed` | 세션 범위 설정 변경 | 여러 도메인이 쓴다(tools 권한 모드, models·loop 세션 모델) | [미결] | 있음 |

### 7.2 테이블 접두

| 테이블·접두 | 소유 도메인 | 쓰는 경로 | 근거 |
|---|---|---|---|
| `events`, `requests`, `step_checkpoints`, `consumer_cursors`, `projector_state`, `p_*` | persistence | `xeon.session` 커밋, 투영 재생성 | `eng.context-map.design` §5.2 |
| `core_models_*` | models | `xeon.store.scoped("core_models_")`. M3(계정, 사용량 창, 대기) | `L1.models.spec` §4.8 |
| `core_tools_*` | tools | `xeon.store.scoped("core_tools_")`. 항상 허용 캐시(2차) | `eng.context-map.design` §5.2 |
| 없음 | tasks, loop, context, agents | 상태는 이벤트와 `p_*` 투영(예: `p_inputs`) | `eng.context-map.design` §4.1 `run-engine` 행 |

## 8. 설정 네임스페이스와 L4 탭

키 문법 `l1.<도메인>.<이름>`, `SettingDef` 규칙 D1~D9, 탭 12종은 `F.wire-settings.spec` §3.8이다. 탭 배치는 `L4.settings-ui.spec` §4.1.1을 따른다.

| 네임스페이스 | 주 탭 | 그 밖 탭 | 대표 키 | 문서 |
|---|---|---|---|---|
| `l1.tasks` | execution | — | `limits.tools`, `limits.subagents`, `limits.modelCalls`, `queue.steeringMode` | `L1.tasks.spec` §6 |
| `l1.loop` | budgets | — | `maxSteps`(기본 0, 상한 없음), `gate.maxContinues` | `L1.loop.spec` §6 |
| `l1.models` | models | providers(연결·계정), budgets(레이트 리밋, M3), advanced(캐시 보존, 재시도 수치) | `default`, `routing.<role>`, `thinkingBudgets`, `providers` | `L1.models.spec` §6 |
| `l1.tools` | permissions | tools(출력 한도, 지연 노출) | `permissionMode`, `rules`, `output.maxBytes` | `L1.tools.spec` §6 |
| `l1.context` | sessions | — | `autoCompact`, `reserveTokens`, `keepRecentTokens` | `L1.context.spec` §6 |
| `l1.persistence` | sessions | — | 보관 기간, 내보내기, `autoResume`, `maxResumeAttempts` | `L1.persistence.spec` §6 |
| `l1.agents` | models | — | `maxDepth`, `maxConcurrent`, `judge.maxRuns` | `L1.agents.spec` §6 |

- `l1.agents`: F 12탭은 에이전트를 models 탭에 합쳤다. `l1.agents.*`의 `ui.tab`은 `models`다 [결정: review.decisions-2 S-14]. 판정 상한 키는 `l1.agents.judge.maxRuns` 하나이고 L2.work는 이 키를 참조한다 [결정: review.decisions-2 S-06].
- 자동 재개 키는 `l1.persistence.autoResume`, `l1.persistence.maxResumeAttempts` 둘만 둔다. L0·L4는 이 키를 참조한다 [결정: review.decisions-2 S-03].
- 위장 플러그인 키는 확장 키 `ext.provider-anthropic-oauth.*`이고 plugins 탭이다(`L1.models.spec` §6).
- 비밀은 `secret://<name>` 참조만 저장한다(`F.wire-settings.spec` §3.8.1).

## 9. 마일스톤

계획 v2의 단계 표시(`_research/layer-plan-v2.json` L1, 구성요소 51개)를 집계했다. 1차 39, 2차 10, 보류 1, 배포 제외 1이다. 마일스톤 정의는 `product.scope.spec` §4.3을 따른다: M1 걸어 다니는 골격(`_research/foundation-plan.md` §5 P4), M2 L2 능력과 Helm(승인 프로토콜 통합 포함), M3 첫 공개 릴리즈 후보(학습 그룹, 공유 서비스 모드, 목표 판정 등). 그 문서의 M2·M3 정의는 [제안]이고 확정은 [미결]이다. 계획 JSON의 "2차"는 M3 이후에 둔다 [제안]. 아래 배치의 정본은 각 도메인 plan이다.

| 도메인 | M1 | M2 | M3 | M3 이후(2차) | 보류 | 배포 제외 | 1차/전체 |
|---|---|---|---|---|---|---|---|
| tasks | 범위 트리, 취소 전파, 병렬 도구 실행, 내구 입력 큐 | 동시 실행 상한 | — | 수락과 완료 분리 | — | — | 5/6 |
| loop | 턴 사이클, 예산(pi 방식), 단계 전 준비 훅 | (완료 게이트의 횟수 상한, 각주 1) | — | 완료 게이트(상한 밖 나머지), 반복 감지 | 입출력 가드레일 | — | 3/6 |
| models | provider와 와이어 형식(모델 1개), 모델 카탈로그, 재시도와 백오프, 비용·토큰 계측 | 용도별 라우팅, 추론 예산, 캐시 정책 | (구조화 출력 최소형, 목표 판정용), (레이트 리밋과 계정 회전, 각주 3) | 폴백 체인, 구조화 출력 | — | Anthropic OAuth 위장 provider(M2 별도 작업 줄기) | 7/11 |
| tools | 도구 노출 분리, 실행 파이프라인, 검증 오류 반환, 결과 경계화, 선언형 정책 엔진·권한 모드(최소형) | 승인과 질문 프로토콜(통합) | — | 항상 허용 캐시와 셸 규칙 | — | — | 7/8 |
| context | 컨텍스트 조립(최소형) | 롤링 요약 컴팩션, 임계와 예약 여유, 비파괴 컴팩션 엔트리, 오버플로우 복구 | — | 도구 결과 선제 제거·재주입 | — | — | 5/6 |
| persistence | 이벤트 저장과 투영, 원자 커밋, 커밋 단위와 내구성, 결과 불명 처리, 재개 절차와 승인 대기 복구(승인 대기 부분은 M2 승인 프로토콜과 함께 완성), 멱등 제출 ID | 분기와 수명주기 API | (리플레이 커서, 각주 2) | 되감기·JSONL 내보내기(리플레이 커서는 M3로 당김) | — | — | 7/8 |
| agents | — | 인프로세스 자식 세션, 권한 상한, 깊이와 동시 상한, 결과 반환 | 백그라운드 위임 | 서브에이전트 정의 파일 | — | — | 5/6 |
| 합계 | 24 | 15(1차 14 + 배포 제외 1)(+ 당겨 온 완료 게이트 상한) | 1(+ 당겨 온 구조화 출력 최소형, 리플레이 커서, 레이트 리밋과 계정 회전) | 10 | 1 | 1 | 39/51 |

- 집계 방식: 숫자는 구성요소 단위다. 구성요소 일부를 앞 마일스톤으로 당긴 경우는 괄호로 적고 숫자에 넣지 않는다. 그래서 합계 열의 숫자는 당기기 전과 같다(M1 24, M2 14 + 배포 제외 1, M3 1, 2차 10, 보류 1, 배포 제외 1, 합 51). "1차/전체" 열은 계획 JSON 표기라 당기기와 무관하다.
- 각주 1: 완료 게이트는 계획 JSON에서 2차다. drive 계속 지시(M2 Helm)와 목표 판정(M3)이 `agent_before_settle`의 계속을 쓰므로 횟수 상한(`l1.loop.gate.maxContinues`)만 M2로 당긴다(`L1.loop.plan` §1).
- 각주 2: 리플레이 커서는 계획 JSON의 2차 구성요소 "되감기, 리플레이 커서, JSONL 내보내기"의 일부다. M3 공유 서비스 모드의 원격 클라이언트 재접속에 필요해 이 부분만 M3로 당긴다(`L1.persistence.plan` §1).
- M1 스모크: 모델 테이프로 `xeon chat` 한 턴, 강제 종료 뒤 재개, drive 그룹 토글이 단계 경계에서 적용(`_research/foundation-plan.md` §6). L1의 몫은 models·loop·tools·persistence·tasks의 M1 열과 context의 최소 조립이다.
- 각주 3: 레이트 리밋과 계정 회전은 계획 JSON에서 2차다. 설정을 M3 설정 화면에서 조작할 수 있어야 하므로 M3로 당긴다 [결정: review.decisions-2 U-21]. 합계의 2차 칸 10에는 그대로 센다(당기기 집계 방식). 구독 계정 회전의 약관 검토는 M3 착수 전에 한다(`L1.models.spec` §4.8).
- 목표 판정(`judge` 호출)은 `L1.agents.spec`의 구성요소 표에 따로 없고 제품 범위 I11(M3)이다. 판정 출력에 구조화 출력이 필요해 models의 구조화 출력 최소형을 M3에 당긴다(`L1.models.spec` §3.10).

## 10. 외부 채택 요약

| 대상 | 버전·원본 | 소유 패키지 | 쓰는 방식 | 근거 |
|---|---|---|---|---|
| `@earendil-works/pi-ai` | 1.3.0 정확 고정 | core-models, `plugins/provider-anthropic-oauth`(review.decisions-2 U-16) | 그대로 + 훅 래핑. provider, 카탈로그, 재시도, usage, 캐시, 추론, 추정 | ADR-0001 §3, `L1.models.spec` §3.1 |
| `@earendil-works/pi-agent-core` | 1.3.0(1.1.0 소스와 바이트 동일). 의존하지 않음 | core-loop | 루프 포크 후 자체 재설계(adr.0009). 원본 `agent-loop.ts` 일부를 옮기고 `UPSTREAM.json`·`LICENSE.pi`로 출처 기록 | `_research/notes/L1-1.md` §0, `L1.loop.spec` §3.2, `L1.loop.plan` §4 |
| TypeBox | `typebox` 1.3.27(catalog, review.decisions-2 U-24). pi-ai와 같은 판 | 전 층 | 스키마 단일 원천 | `_research/foundation-plan.md` §2, `F.readme` §8 7번 |
| bun:sqlite | Bun 1.4 내장 | L0 platform-store(L1 밖) | persistence가 `xeon.store`로 쓴다 | DR-07 |
| Cordis | 4.0.0-rc.x vendored | X ext-host(L1 밖) | L1은 서비스 등록·주입만 X로 | ADR-0002 |

포크 목록:

| 포크 대상 | 원본 | 받는 도메인 | 판정 |
|---|---|---|---|
| 롤링 요약 컴팩션 | pi `coding-agent/src/core/compaction/compaction.ts`(커밋 `cdaf6c2`, 1119줄)와 `utils.ts`, `branch-summarization.ts` | context | 포크. 원본 1119줄 중 그대로 174, 치환 318, 재작성 427(상한 919, `_research/notes/L1-3.md` §11, `L1.context.plan` 위험 1과 같은 3분류). 같은 notes §1의 "F 치환 478"은 묶음 기준(session-manager 결합 336 + 메시지 역할 결합 142)의 셈이다 |
| 결과 경계화(truncate) | pi durable `truncate.ts`(205줄, 커밋 `cdaf6c2`) | L0 `platform-exec`(L1 밖). tools는 F 서비스로 부른다 | 포크. 위치는 `platform-exec`다(review.decisions-2 D-08, §13 (f)) |
| 서브에이전트 정의 파일(frontmatter) | pi coding-agent `utils/frontmatter.ts` + yaml 2.9 | agents | 포크, 2차 |
| 같은 파일 직렬화 큐(file-mutation-queue) | pi durable `tools/file-mutation-queue.ts`(55줄) | tasks | 포크 |
| 위장 provider 8곳 | pi-ai `api/anthropic-messages.ts`(1639줄) | models 플러그인 | 방안 A(래퍼, 포크 없음) 우선, 조건이 맞지 않으면 그 파일만 포크(방안 B) |
| 사용량 합산 | pi coding-agent `usage-totals.ts` `combineUsage` | models | 소형 복사 |

## 11. 공통 규칙

1. 이름의 정본은 F다. envelope 필드는 `kind`, `version`, `threadId`, `durable`이고 코어 kind는 `F.records.spec` §3.3 표, ID 접두는 `thr`·`trn`·`stp`·`itm`·`prt`·`evt`·`efx`·`ckp`, `requestId`는 브랜드 없는 문자열(1~64자)이다. engineering 문서의 `type`, `sessionId`, `tool.intended` 같은 표기는 F 이름으로 바꿔 읽는다(`F.records.spec` §3.1.2).
2. 재생 계약: on 핸들러는 다시 실행해도 되는 질의다. 효과는 `post`(멱등 키 필수), `commit`, `record`로만 낸다(`F.extensions.spec` §4.3). pi-ai `onPayload`처럼 재시도 때 다시 불리는 훅에 연결한 지점도 같은 조건이다(`L1.models.spec` §4.3).
3. 도구 지점 재실행 금지: 재생과 재개에서 이미 결정된 도구 호출에 대해 `tool_call` 지점을 다시 발화하지 않는다. 저장된 `effect.intent.args`가 재실행 입력이다(`architecture.runtime-flow.design` §4.2, `F.records.spec` §3.5).
4. 커밋 뒤 방출: tap 지점과 구독자 전달은 커밋 뒤, chain·first 결과는 커밋 전에 받아 커밋에 넣는다(`L1.loop.spec` §7).
5. 단계 경계: 확장 켜기·끄기, drive 임대 교대, 도구 목록 변경은 단계 경계(step 종료 직후, 도구 결과 커밋 뒤)에서 적용한다 [결정: review.decisions-2 U-01](`F.extensions.spec` §4.5).
6. 예산: 단계 수와 비용에 기본 상한을 두지 않는다. 사용자 중단, 컨텍스트 한도, 추론 레벨별 토큰 예산만 둔다. 상한은 그룹의 drive 임대에만 걸린다(`_research/layer-plan-v2-notes.md` 가드레일 절). 이 예외는 [결정: review.decisions-2 U-12]이다. 목표 판정 횟수 상한(`l1.agents.judge.maxRuns`)은 결정 4의 별도 상한이다.
7. 비밀: 값은 요청·실행 직전에만 해석하고 이벤트, 로그, 지점 페이로드에 싣지 않는다(`_research/secrets.md` §6.2).
8. 시계·ID·난수는 주입받는다. 모델은 테이프 가짜로 시험한다(`eng.testing.guide` TS-04, 테이프 모듈은 `@xeon/core-models/testing`).

## 12. 결정 근거

| 결정 | 근거 |
|---|---|
| [결정] pi-ai·agent-core는 npm 1.3.0 정확 고정 + 훅 래핑. 소스 포크는 훅이 부족할 때만 | `_research/foundation-plan.md` §2 모델·루프 행, `_research/layer-plan-v2.json` L1 intro |
| [결정] pi-ai provider는 그대로 쓰고 부족분만 포크 커스텀(새로 만들지 않음) | `_research/decisions-log.md` 2026-10-21 결정 2차 |
| [결정] 예산은 pi 방식(기본 상한 없음). 가드레일은 보류 | `_research/decisions-log.md` 2026-10-21 계획 v2 |
| [결정] 위장 provider는 `plugins/provider-anthropic-oauth`로 분리, 배포 제외, 기본 꺼짐 | `_research/decisions-log.md` 2026-10-21 결정 2차, `product.scope.spec` N6 |
| [결정] 승인·질문·계획 승인은 L1-d 승인 프로토콜 하나 | `_research/foundation-plan.md` §1 결정 5 |
| [결정] 목표 판정은 별도 판정 모델 + 실행 횟수 상한 | `_research/foundation-plan.md` §1 결정 4 |
| [결정] Helm과 학습 그룹은 L3 기본 그룹. 학습 그룹은 drive를 쓰지 않는다. 검토 포크를 백그라운드 위임으로 돌리고, L1이 제공하는 쪽은 `xeon.agents`의 백그라운드 위임과 `post` 경로다 | `_research/decisions-log.md` 2026-10-21 계획 v2(학습 그룹 drive 미사용, Helm과 공존), `_research/layer-plan-v2-notes.md` "Hermes 학습 루프를 별도 그룹으로", `L1.agents.spec` §4.7 |
| [결정] 세션 저장은 SQLite 이벤트 소싱 + 투영, 단일 DB, 확장 접두사 테이블 | `_research/decisions-log.md` 2026-10-21 결정 2차, ADR-0004 |
| [결정] 확장 지점은 on(fold tap/first/chain), post, drive(배타 임대), scope | `_research/decisions-log.md` 2026-10-21 계획 v2, ADR-0007 |

## 13. 층 차원 불일치 보고

각 도메인 spec에서 나온, 층을 넘는 이름·배정 불일치다. 고칠 문서와 제안을 함께 적는다.

| # | 불일치 | 관련 문서 | 제안 |
|---|---|---|---|
| (a) | engineering 문서의 `type`, `sessionId`, `tool.intended`·`tool.settled`, `compaction.recorded`, `message.`·`session.` 접두와 F의 `kind`, `threadId`, `effect.intent`·`effect.result`, `thread.compacted`, `item.`·`thread.` 이름 | `eng.events.design` §4.1, `eng.transactions.design` §4.1·§4.8, `eng.context-map.design` §5.1 | F 이름으로 고친다(`F.records.spec` §3.1.2). 요청은 `L1.loop.spec` FR-L6, `L1.tools.spec` §8.4, `L1.context.spec` §8.3 4 |
| (b) | `eng.transactions.design`의 `SessionWriter.commit`(동기, `Result`)과 `F.records.spec` §3.8 `SessionStore.appendBatch`(2차, 비동기 `Promise`) | `L1.persistence.spec` §3.1, L1.loop·L1.tools·L1.tasks의 커밋 요구 | `L1.persistence.spec` §3.1이 정리했다: 공개 포트는 `SessionService.commit`(동기), 내부 구현 클래스가 `SessionWriter`, F `SessionStore.appendBatch`는 2차 저장소 교체용 어댑터다. F §3.8과 `eng.transactions.design`에 이 관계를 적도록 요청한다 |
| (c) | `F.extensions.spec` §7은 `session_*compact*` 지점 셋을 persistence에 배정, 컴팩션 수행 주체는 context | `L1.context.spec` §7.1 | 고쳤다: `F.extensions.spec` §7이 셋을 context, `ui_prompt_*`를 tools로 배정한다 |
| (d) | `input` 지점 발화 위치: `F.extensions.spec` §7은 loop, `architecture.runtime-flow.design` §4.1 그림은 tasks | `L1.tasks.spec` §7, `L1.loop.spec` FR-L7 | loop(`LoopService.admit`)가 발화하고 그림을 고친다 |
| (e) | `SettingsTab`에 agents 탭 없음 | `L1.agents.spec` §6, `L4.settings-ui.spec` §4.1.1 | 고쳤다: 탭을 더하지 않고 models 탭에 둔다 [결정: review.decisions-2 S-14] |
| (f) | ADR-0003은 truncate를 cap-workspace에 두었으나 L1-d 결과 경계화가 쓴다 | `L1.tools.spec` §4.8, adr.0003 §3 | 고쳤다: 출력 절단 함수는 `platform-exec`에 두고(adr.0003 §3 표 개정 필요), core-tools와 L2는 F 서비스로 부른다 [결정: review.decisions-2 D-08] |
| (g) | `plugins/*`는 `check-layers.ts`에서 L1이라 `core-models`를 import할 수 없음(`architecture.layers.spec` §10). DR-09는 `core-models` 공개 계약 import를 허용 목록으로 풀고 pi-ai 직접 import를 금지 | `L1.models.spec` §3.11 | 고쳤다: `plugins/*`는 L1 순위다. 플러그인은 F, X, L0, pi-ai만 import하고 `core-*`는 import하지 않는다. 위장 provider는 F의 provider 인터페이스로 `xeon.models`(core-models 서비스)에 등록한다. 같은 층 예외는 두지 않는다 [결정: review.decisions-2 U-16]. DR-07 소유 표와 DR-09는 eng 쪽이 고친다 |
| (h) | `eng.context-map.design` §4.1 `model-gateway` (d)열은 `xeon.secrets`만 적었으나 지점 6개 디스패치에 `xeon.ext`가 필요 | `L1.models.spec` §8.3 4 | (d)열에 `xeon.ext` 추가 |
| (i) | `X.primitives.spec` §3.9 `ProviderResourceDef = JsonValue`로는 코드 provider(함수 포함)를 등록할 수 없음 | `L1.models.spec` §3.7 | `ProviderDef`(config·runtime 유니온)로 바꾼다 |
| (j) | `checkpoint.step` 생산자: 이 층 배정과 `L1.persistence.spec` §3.8(envelope는 저장소가, 내용은 루프가 만든다)은 `core.persistence`, `L1.loop.spec` §3.7은 `core.loop` | `L1.loop.spec`, `L1.persistence.spec` | `core.persistence`로 맞추고 `L1.loop.spec` §3.7 표를 고친다 [제안]. 체크포인트 허용 지점도 다르다: loop는 T3(`next: "tools"`)를, persistence는 승인 대기 A1을 예외로 요청한다(FR-L3, FR-P4). [미결] 둘을 함께 F에 올린다 |
| (k) | `F.conversation.spec` §3.1은 pi-ai `Context`·`TranscriptContext`를 "L1-c 몫"으로 재노출하지 않으나, `ModelService`가 F에 있으면 그 타입이 F에 필요 | `L1.models.spec` §8.3 1 | 타입 전용 재노출을 F `services/models.ts`에 둔다(`F.capabilities.spec` §3.12 규칙 3) |
| (l) | `eng.context-map.design` §5.3은 `ContextService`를 F conversation에 두었으나 인터페이스가 capabilities 이름(`CachePolicy`, `OrderedTool`)을 쓴다. F 내부 순서상 conversation은 capabilities를 import할 수 없음 | `L1.context.spec` §3.1 | capabilities `context.ts`로 옮긴다 |
| (m) | `_research/packages.md` §4.3은 context가 pi-ai `isContextOverflow`, `utils/estimate.ts`를 "그대로" 쓴다고 적었으나 DR-07은 pi-ai import를 core-models에 한정 | `L1.models.spec` §3.3, `L1.context.spec` §4.7 | `xeon.models.tokens`·`classify`로 위임한다 |
| (n) | 계획 v2는 구조화 출력을 2차로 두었으나 목표 판정(M3)이 구조화 판정 출력을 쓴다 | `L1.agents.spec` §4.8, `L1.models.spec` §3.10 | 최소형을 M3로 당긴다 |
| (o) | F `ThinkingBudgets`(pi-ai)는 `minimal`~`high` 4키, 레벨은 6종(`xhigh`, `max` 포함), 설정 조사는 omp 6키 | `L1.models.spec` §3.1 | 설정은 6키를 저장하고 pi-ai에는 4키만 넘긴다. 포크하지 않는다 |
| (p) | L1 서비스가 유효 설정을 읽는 경로와 서비스 이름이 어느 문서에도 없음(`L4.host-service.spec`의 `SettingsStorePort.layers`는 L1.persistence 소유로 적힘) | 모든 L1 spec의 "설정 노출" | [미결] X 또는 persistence가 읽기 서비스를 정한다 |
| (q) | `eng.testing.guide` TS-04 테이프 `role`은 "L1.models.spec이 정한다 [가정]" | `L1.models.spec` §3.4 | `ModelRole` 6종으로 확정. 가이드의 [가정]을 지운다 |
| (r) | `eng.context-map.design` §4.1의 `approval.`·`input.`·`agent.` 접두는 F `CoreArea`에 없음 | `L1.tools.spec`, `L1.tasks.spec`, `L1.agents.spec` F 요청 | F `CoreArea`에 `approval`, `input`, `agent`를 더한다 |
| (s) | `L1.persistence.spec` §4.2 C5는 `thread.compacted`를 단계 끝 커밋에 넣었으나 `L1.context.spec` §4.6은 컴팩션을 단계 사이의 별도 커밋(`thread.compacted` + 새 접두 item)으로 둔다. 오버플로우 복구 컴팩션은 단계 중간(재요청 전)에 일어난다 | `L1.context.spec` §4.6 5·6번, `L1.persistence.spec` §4.2·§4.14 | 고쳤다 [제안]: 모든 컴팩션을 별도 커밋 지점 C7(키 `compact:<threadId>:<stepId>:<reason>`, 체크포인트 없음)로 두고 C5에서 뺐다. `eng.transactions.design` §4.1 C5·§4.8·TX-08 수정은 `L1.persistence.spec` §8.4 요청에 있다 |
| (t) | DR-07은 pi-agent-core를 core-loop만 import하게 하는데 `L1.tools.spec` §3이 F capabilities `tools.ts`와 core-tools에서 agent-core 타입을 직접 import했고, `resumePending`이 agent-core `runToolCall`을 core-tools에서 불렀다 | `L1.tools.spec` §3·§4.7, `L1.tools.plan` §2·§4, `eng.dependency-rules.guide` DR-07 | 고쳤다: agent-core 타입은 F conversation 재노출(`AgentLoopConfig`, `AgentToolCall` 추가 요청, `L1.tools.spec` §8.3 F 요청 7)만 쓰고, `resumePending`을 지워 재실행을 core-loop로 옮겼다. DR-07 소유 표는 그대로다 |
| (u) | `L1.agents.spec`이 요청한 `LoopService.runChildTurn`이 `L1.loop.spec`과 plan에 없었다 | `L1.agents.spec` §4.1 5번·§8.4, `L1.loop.spec` §3.1 | 고쳤다: `L1.loop.spec` §3.1 `ChildTurnRequest`·`runChildTurn`, §4.13, `L1.loop.plan` LP15 |
| (v) | 커밋 지점 이름과 목록이 문서마다 달랐다: loop는 T1~T6(T5 없음)에 T2 `step.started`·prestart 커밋을 두었고, persistence는 C1~C6(C4 없음)에 이 둘이 없어 fsync 식이 맞지 않았다 | `L1.loop.spec` §3.5, `L1.persistence.spec` §4.2, `L1.persistence.plan` §6 | 고쳤다: persistence §4.2에 S1·C2b 행과 대응표를 두고 fsync 식을 `3 + 3 × 도구 수`로 바꿨다. `eng.transactions.design` §4.1 C1~C6 표 수정은 `L1.persistence.spec` §8.4 요청에 포함된다 |
| (w) | 같은 서비스 `xeon.loop`에 `X.primitives.spec` §3.6 `LoopPort`(`runTurn`, `status`: 문자열, `whenIdle`, `spawn`)와 `L1.loop.spec` `LoopService`(`runDriveTurn`, `status`: 객체)가 따로 있었다. 입력 큐도 X `InputQueuePort.enqueue`와 L1 `inputs.enqueue`가 달랐다 | `L1.loop.spec` §3·§3.1·§4.8, `L1.tasks.spec` §3.1·§7, `X.primitives.spec` §3.6 | 고쳤다 [제안]: `LoopService extends LoopPort`, L1 상세 상태는 `threadStatus`, drive turn은 `runTurn`(펜싱 `leaseEpoch`, T1 build 안 `turnByRequestId`). `TaskService extends InputQueuePort`. 포트 타입은 F.extensions `ports.ts`로 옮기도록 요청(`L1.loop.spec` FR-L1). 하위 객체는 최상위 이름이 겹칠 때만 쓴다(`SessionService.ext`) |
| (x) | `L1.tasks.spec` FR-T3이 `post.accepted` retire를 제안해 F.records·X와 반대였다 | `L1.tasks.spec` §7·FR-T3, `F.records.spec` §3.3, `X.primitives.spec` §3.6 | 고쳤다: retire안. 확장 post는 `input.queued` 하나를 쓰고 멱등은 커밋 키가 맡는다 [결정: review.decisions-2 U-05, 2026-10-22 사용자 확인에서 유지안을 바꿈] |
| (y) | 쓰기 소유 확인이 인자 없는 `OwnershipGuard.holds()`(메모리 잠금 확인)였고 ADR-0006의 별도 소유 테이블이 L0.store `sys_leases`와 겹쳤다 | `L1.persistence.spec` §3.6·§3.10·§4.1·§4.9, `L0.store.spec` §3.1·§3.3, `eng.transactions.design` TX-10 | 고쳤다: OS 잠금(생존 판정) + `sys_leases.epoch` 펜싱. `LeaseToken` + `leases.holds(tx, token)`, 별도 소유 테이블 없음(`sys_leases` 행이 표시를 겸한다). adr.0004 §3.4·adr.0006 개정 [결정: review.decisions-2 U-09] |
| (z) | 백그라운드 위임 완료 보고가 `agent.settled`와 다른 커밋이었고, 자식 thread 쓰기 소유 획득 절차와 세션 생성 멱등(`creationKey`)이 없었다 | `L1.agents.spec` §4.1·§4.5·§4.7, `L1.persistence.spec` §3.8·§4.10.1 | 고쳤다 [제안]: 보고 `input.queued`를 `agent.settled`와 한 커밋에, 자식 임대는 `inheritOwnerFrom`으로 부모 holder가 얻는다. `threads.create`에 `creationKey`와 `thread_creation_keys` 표 |

## 14. 미결 사항

하위 spec의 미결 가운데 층 전체에 걸리는 것만 모은다. 세부와 선택지는 각 spec의 미결 사항 절에 있다.

1. [결정: review.decisions-2 U-16] `plugins/*`는 L1 순위다. 플러그인은 F, X, L0, pi-ai만 import하고 `core-*`는 import하지 않는다. 위장 provider는 F provider 인터페이스로 `xeon.models`에 등록한다(§13 (g)).
2. [미결] 기본 `anthropic-messages` 경로의 위장 분기 차단을 코어 가드로 할지 pi-ai 포크로 할지(`L1.models.spec` 미결 1). 위장 플러그인의 별도 배포 여부(`product.scope.spec` N6).
3. [미결] 컴팩션 별도 커밋 C7(§13 (s))을 `eng.transactions.design`에 반영하는 일. F `SessionStore.appendBatch`(2차)와 `SessionService.commit`(M1 정본)의 관계는 `F.records.spec` §3.8에 반영됐다(§13 (b)).
4. [미결] `checkpoint.step` 생산자(§13 (j))와 T3 체크포인트 허용(`L1.loop.spec` FR-L3).
5. (닫음) 컴팩션 지점 셋과 `ui_prompt_*` 두 지점의 발화 배정은 `F.extensions.spec` §7에 반영됐다(§6 표).
6. [미결] 떠난 가지 요약의 생성 주체(`L1.context.spec` §4.9). `session-core`가 `xeon.store`만 쓰는 규칙과 맞추는 A안이 제안이다.
7. [미결] `settings.changed`의 생산자 규칙(§7.1 마지막 행).
8. [결정: review.decisions-2 S-14] agents 설정 탭은 더하지 않는다. `l1.agents.*`는 models 탭이다(§13 (e)).
9. [미결] L1 서비스의 유효 설정 읽기 경로(§13 (p)).
10. [미결] `post.when = next`의 시작 여부와 `aside` 위치(`L1.tasks.spec`, `L1.loop.spec` 미결).
11. [미결] 재생 정책 이름(`safe|unsafe`와 agent-core `never|safe`, `F.readme` §8 미결 6). tools와 models가 함께 걸린다. TypeBox 버전은 1.3.27로 정했다(review.decisions-2 U-24).
12. [미결] 구조화 출력 최소형의 M3 배치(§13 (n)). 레이트 리밋·계정 회전은 M3로 정했다 [결정: review.decisions-2 U-21](§9 각주 3).
13. [미결] 도구가 다른 도구를 부르는 중첩 호출의 진입점. agent-core `runToolCall`은 core-loop만 부를 수 있다(`L1.tools.spec` §4.2, §10).
14. [미결] 비밀 lease를 부르는 쪽(L0.exec 대 L1.tools)과 `secretEnv` 전달 경로(`L1.tools.spec` §4.12). M1 비밀 검증 모드는 `env` 주입(bash 도구, 실행마다 승인)이다 [결정: review.decisions-2 U-19].
15. [결정: review.decisions-2 U-05] `post.accepted`는 retire한다(§13 (x)). 카탈로그 항목은 `retired: true`로 남는다(F.records.spec §3.3). 확장 post의 기록은 `input.queued`이고 멱등은 커밋 키 `in:<sourceKey>:<requestId>`가 맡는다. F.conversation.spec §3.5.3 `TurnStartedPayload.scopeId`는 그대로다(L1.tasks FR-T3, L1.loop FR-L8, L1.persistence FR-P10 닫음). core-tasks의 `post.accepted` 동봉 코드는 구현 후속에서 지운다.
16. [결정: review.decisions-2 U-09] 쓰기 소유 판정은 OS 잠금(생존 판정) + `sys_leases.epoch` 펜싱이다. adr.0004 §3.4·adr.0006을 이에 맞게 개정한다(§13 (y), `eng.transactions.design` T-4).
