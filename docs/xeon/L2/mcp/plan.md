---
id: L2.mcp.plan
layer: L2
domain: mcp
kind: plan
status: draft
depends_on: [L2.mcp.spec, F.capabilities.plan, L0.process.plan, L1.tools.plan]
binds: [xeon/packages/cap-mcp/**]
---

# L2 MCP 통합 구현 계획

대상 스펙: `L2.mcp.spec`. 패키지: `@xeon/cap-mcp`(`xeon/packages/cap-mcp`). 정의 파일: `@xeon/contracts`의 `src/capabilities/defs/mcp.ts`.

## 1. 목표와 마일스톤 배치

| 마일스톤 | 범위 | 근거 |
|---|---|---|
| M0 | 없음 | — |
| M1 | 없음. 이번 실행(foundation-plan P4)에서는 패키지 스캐폴드(`package.json`, 빈 `src/index.ts`, `xeon` 필드)까지만 만든다 | `_research/foundation-plan.md` §5 P4 "L2 웹·MCP는 스캐폴드까지만", `product.scope.spec` §4.3 |
| M2 | MCP 브리지(연결, 도구·프롬프트·리소스 노출, 재연결), 서버 정의(설정 키, `.mcp.json` 가져오기, 허용·차단·도구별 승인), 서버 주도 요청(MRTR → 승인 프로토콜 → 재시도), annotations 매핑, 서버 상태 저장 | `product.scope.spec` §4.3 M2 "`cap-mcp` 1차 구성요소", `_research/layer-plan-v2.json` L2-b 1차 |
| M3 | 1차 추가 없음. M2 결과를 학습 그룹·서비스 모드와 함께 안정화한다(서비스 모드에서 stdio 서버 수명) | `product.scope.spec` §4.3 M3 |

M2 완료 기준에 `product.scope.spec` §4.4 M2 종료 조건 "테스트 MCP 서버의 도구가 도구 목록에 노출된다"를 그대로 옮긴다(§6).

2차(M3 이후) 표:

| 항목 | 단계 | 내용 | 선행 확인 |
|---|---|---|---|
| MCP Tasks | 2차(`_research/layer-plan-v2.json` L2-b) | 자체 Tasks 어댑터(명시 스키마 요청 `tasks/get`, `tasks/update`, `tasks/cancel`), 백그라운드 완료 신호 연결 | Tasks 명세 본문 필드, `notifications/tasks` 존재 여부(`L2.mcp.spec` §10 미결 7), `tasks/update`가 명시 스키마 경로로 나가는지([가정], `L2.mcp.spec` §1.3) |
| 변경 구독 | 2차 | `Client.listen`, 2025 `listChanged`, 재연결 뒤 재-listen, 단계 경계 반영 | 없음(SDK API 확인됨) |
| MCP OAuth | 2차 | `XeonOAuthProvider`, 토큰 `xeon.secrets` 저장, `iss` 검증, 콜백 수신 | L4 콜백 방식, CIMD 세부 |
| sampling 응답 | 2차 이후 | `l2.mcp.sampling = "ask"`의 실제 응답 | `L2.mcp.spec` §10 미결 6 |

## 2. 패키지와 파일 배치

```
xeon/packages/cap-mcp/
  package.json          # "name": "@xeon/cap-mcp", "xeon": { "layer": "L2", "domain": "mcp" }
  src/
    index.ts            # manifest, apply(ctx): 서비스 xeon.mcp 등록, 세션 시작·종료 연결
    manifest.ts         # defineManifest({ name: "cap-mcp", layer: "L2", kind: "plugin",
                        #   provides: [{ id: "mcp.client", version: "1.0.0" }], points: ["session.mcp.after", "session.trust.before"], usesDrive: false })
    settings.ts         # defineSettings("l2.mcp", …)  (spec §6)
    adapter.ts          # SDK 경계 어댑터. SDK 타입과 zod는 이 파일(+ transport/, oauth/, tasks/schemas.ts) 밖으로 나가지 않는다
    client/
      registry.ts       # 서버별 연결 상태 기계(disabled → connecting → connected ↔ reconnecting → failed)
      service.ts        # mcp.client 메서드 구현(listServers, status, connect, reconnect, disable, listTools, callTool, …)과 xeon.mcp McpService(registerServer) 등록
      dynamic-tools.ts  # McpDynamicTool 생성, mcpToolName, 노출 필터, 단계 경계 반영, diffToolsets
      content.ts        # SDK 결과 → McpContent(이미지 blob 등록, untrusted 감싸기, 크기 한도)
      annotations.ts    # annotations → ToolHints(spec §3.4)
      backoff.ts        # 재연결 백오프(시계 주입)
      state-store.ts    # cap_mcp_servers 읽기·쓰기(xeon.store.scoped)
    servers/
      loader.ts         # l2.mcp.servers + .mcp.json 병합, 이름 변환, 진단
      policy.ts         # 허용·차단·managedOnly, 도구 allow/deny, 승인 모드 → L1.tools 규칙(mcp__<서버>)
    transport/
      process-stdio.ts  # ProcessStdioTransport: xeon.process 자식 프로세스 ↔ SDK Transport
      http.ts           # StreamableHTTPClientTransport·SSEClientTransport 생성, 헤더 secret:// 해석 fetch 감싸기
    elicitation/
      questions.ts      # inputRequests → McpQuestion
      responses.ts      # 승인 응답 → inputResponses(폼 검증, 비밀 필드 경고)
      rounds.ts         # McpContinuation, 라운드 상한, requestId "#r<n>" 규칙
    tasks/              # 2차
      adapter.ts  schemas.ts
    subscriptions/      # 2차
      listen.ts
    oauth/              # 2차
      provider.ts       # XeonOAuthProvider(OAuthClientProvider 구현)
    testing/
      memory-transport.ts   # 인메모리 Transport 쌍(테스트와 다른 패키지 테스트용)
      stub-server.ts        # 테스트 MCP 서버 스텁
      index.ts
  test/
    *.test.ts
```

- `adapter.ts`라는 이름은 `eng.context-map.design` CM-03의 좋은 예(`xeon/packages/cap-mcp/src/adapter.ts`)와 같다. SDK의 `Client`, `Tool`, `CallToolResult`, `InputRequiredResult` 타입과 zod 스키마는 `adapter.ts`, `transport/`, `oauth/`, `tasks/schemas.ts` 안에서만 쓴다. 그 밖의 파일은 F 타입(`McpToolInfo`, `McpContent` 등)과 패키지 내부 타입만 본다.
- 이 경계는 `no-restricted-imports` 규칙(경로 패턴 예외)으로 강제한다. 규칙 추가는 `eng.dependency-rules.guide` 4절 절차를 따른다.
- `package.json`의 `exports`에 `"./testing": "./src/testing/index.ts"`를 둔다(`eng.testing.guide` TS-06). `L2.dialog`나 L3 그룹 테스트가 스텁 서버를 쓸 수 있다.

## 3. 작업 분해

브리프의 작업 번호 M1~M10을 마일스톤 표기와 구분하려고 `MC` 접두를 쓴다. 대응은 MC1 = M1 … MC10 = M10이다.

| id | 내용 | 선행 | 규모 |
|---|---|---|---|
| MC1 | F `src/capabilities/defs/mcp.ts`: spec §3.1~§3.2의 스키마, `McpClient`, `McpClientKey`, `McpContinuation`, `McpQuestion`. 명시 타입 주석. `validateCapability` 테스트. `McpService`, `McpServiceName`은 F `src/services/mcp.ts`에 있고 F.capabilities.plan P9가 만든다 | F.capabilities.plan M0(P1~P7), P9 | M |
| MC2 | SDK 경계 어댑터와 전송: `adapter.ts`(연결 옵션 `versionNegotiation`, `inputRequired.autoFulfill = false`, 능력 선언 elicitation form·url), `transport/process-stdio.ts`(SDK `Transport` 인터페이스를 선언 파일로 확인한 뒤 구현), `transport/http.ts`, `client/registry.ts` 상태 기계, `client/backoff.ts`, 인메모리 전송과 스텁 서버(`src/testing/`) | MC1, L0.process.plan(자식 프로세스·stdio 핸들), L0.secrets.plan(실행 직전 주입, 마스킹) | L |
| MC3 | 서버 정의 로더와 설정 키: `settings.ts`(14개 키), `servers/loader.ts`(설정 병합, `.mcp.json` 가져오기, 이름 변환, 평문 비밀 거부, 진단), `servers/policy.ts`(허용·차단·managedOnly, 도구 allow/deny), `session.trust.before` 연동 | MC1. 설정 유효 값 조회는 L1.persistence·wire-settings 구현 | M |
| MC4 | 동적 도구 광고와 순서 키: `client/dynamic-tools.ts`(`McpDynamicTool`, `mcpToolName`, 이름·스키마 검사, 충돌 시 미노출), 단계 경계 반영(`diffToolsets`), `session.mcp.after` 발화, `client/content.ts`(결과 변환, blob, untrusted 감싸기, 크기 한도), `client/service.ts`의 `listTools`·`callTool`·프롬프트·리소스 메서드와 정적 도구 3개 | MC2, MC3, X.primitives.plan(리소스 등록 API), L1.context.plan(`toolsAdded`/`toolsRemoved` 기록), L0.store.plan(blob API) | L |
| MC5 | input_required → 승인 프로토콜과 재시도: `elicitation/questions.ts`, `responses.ts`, `rounds.ts`. 동적 도구 `execute`의 `continuation` 처리, 라운드 상한, requestId `#r<n>` 규칙, 재시작 뒤 재개 테스트 | MC4, L1.tools.plan(승인 요청 올리기와 `continuation` 재호출, 승인 대기 체크포인트) | L |
| MC6 | 도구 annotations 매핑: `client/annotations.ts`(spec §3.4 표, MCP 기본값, `trustAnnotations`), 승인 모드 → L1.tools 권한 규칙(`mcp__<서버 id>`, `mcp__<서버 id>__<도구>`) 공급 | MC4, L1.tools.plan(규칙 공급 API) | S |
| MC7 | `cap_mcp_` 상태 저장: `client/state-store.ts`, `cap_mcp_servers` DDL을 `xeon.store.scoped`에 등록, 상태 변경 때 갱신, 마스킹된 `lastError` | MC2, L0.store.plan(`xeon.store.scoped`, 접두사 소유 검사) | S |
| MC8 | (2차) Tasks 어댑터: `tasks/schemas.ts`(명시 스키마), `tasks/adapter.ts`(`CreateTaskResult` 판별, 폴링, `tasks/update`, `tasks/cancel`), 백그라운드 완료 신호 연결 | MC5, Tasks 명세 본문 확인, `tasks/get`·`tasks/update`·`tasks/cancel`의 명시 스키마 전송을 스텁 서버로 확인(`tasks/update`는 [가정], spec §1.3·§4.10), L1.agents.plan(백그라운드 완료 신호) | M |
| MC9 | (2차) 변경 구독: `subscriptions/listen.ts`(2026 `listen`, 2025 `listChanged`), 재연결 뒤 재-listen, 단계 경계 반영 | MC4 | M |
| MC10 | (2차) OAuth: `oauth/provider.ts`(`XeonOAuthProvider`), 토큰·클라이언트 정보 `xeon.secrets` 저장, `finishAuth(code, iss)`, `iss` 검증, 콜백 수신 연결 | MC2, L0.secrets.plan, L4.desktop.plan·L4.cli.plan(브라우저 열기, 콜백) | L |

- M2 범위는 MC1~MC7이다. 순서는 MC1 → (MC2 ∥ MC3) → MC4 → (MC5 ∥ MC6 ∥ MC7)이다. MC7은 MC2 뒤 언제든 할 수 있다.
- MC5는 L1.tools.plan의 승인 프로토콜 작업(M2 "승인 프로토콜 통합", `product.scope.spec` §4.1 I9)과 같은 시기에 맞춘다. `L2.mcp.spec` §10 미결 2(책임 나눔)를 MC5 시작 전에 정한다.

## 4. 채택 코드

| 대상 | 버전 | 라이선스 | 쓰는 방식 |
|---|---|---|---|
| `@modelcontextprotocol/client` | 2.3.1 정확 고정 | Apache-2.0 | 그대로. 6.9MB, 의존 7(`@modelcontextprotocol/core` 2.3.1, `cross-spawn`, `eventsource`, `eventsource-parser`, `jose`, `pkce-challenge`, `zod ^4.2.0`), engines Node >=20(`_research/packages.md` §4.4 L2-b, §5, `_research/notes/L2-1.md` §2). 레지스트리 integrity는 `_research/notes/L2-1.md` 머리말의 값으로 lockfile에서 확인한다 |
| `zod` | SDK가 해석한 4.x를 lockfile로 고정 | MIT | 직접 import는 `adapter.ts`, `tasks/schemas.ts`만. 직접 import하면 `package.json`에 SDK와 같은 범위로 선언한다(`eng.dependency-rules.guide` DR-07) |
| `typebox` | 1.3.27(catalog) | MIT | F 정의(MC1) |
| `@modelcontextprotocol/server` | 2.3.1(devDependency) [가정: 패키지 이름과 존재] | Apache-2.0 [가정] | 스텁 서버 작성에 쓸 수 있으면 쓴다. 없으면 `src/testing/stub-server.ts`를 core 타입과 인메모리 전송으로 직접 쓴다 |
| pi `pi-mcp` 1.3.0 | — | MIT | 참고만. OAuth 약 1.8k줄(RFC 9207 `iss` 검사), stdio 종료 정책(SIGTERM 뒤 2초 SIGKILL, `mcp/src/transports/stdio.ts:9-49`), 요청 타임아웃·progress 재설정(`mcp/src/client.ts:531-575`)을 설계 근거로 인용한다. 코드는 가져오지 않는다 |

- 포크 없음.
- SDK의 stdio 전송(`./stdio` 서브패스, `cross-spawn`)은 쓰지 않는다(`L2.mcp.spec` §4.3). 의존 목록에서 빠지지는 않는다.
- Bun 호환: SDK engines는 Node >=20이다. Bun 1.4에서 `eventsource`, `jose`, `cross-spawn`이 로드되는지는 [가정]이고 MC2 첫 테스트(인메모리 연결)에서 확인한다.

zod4와 TypeBox 공존: 경계 변환 지점 [제안]:

| 지점 | 들어오는 것(SDK, zod 추론 타입) | 나가는 것(F, TypeBox) | 파일 |
|---|---|---|---|
| 도구 목록 | `Tool`(`name`, `title`, `inputSchema`, `annotations`) | `McpToolInfo`. `inputSchema`는 JSON 데이터로 복사(zod 객체 아님) | `adapter.ts` |
| 도구 결과 | `CallToolResult` 또는 `InputRequiredResult` | `CallToolOutput` 두 변형 | `adapter.ts` → `client/content.ts` |
| 프롬프트·리소스 | `Prompt`, `GetPromptResult`, `Resource`, `ReadResourceResult` | `PromptInfo`, `GetPromptOutput`, `ResourceInfo`, `ReadResourceOutput` | `adapter.ts` |
| 입력 요청 | `inputRequests`의 elicitation `requestedSchema`(JSON) | `McpQuestion.requestedSchema`(JSON 데이터 그대로) | `adapter.ts` → `elicitation/questions.ts` |
| 명시 스키마 요청(2차) | Tasks 응답 | 내부 `McpTaskState` | `tasks/schemas.ts`(zod) → `tasks/adapter.ts` |

- 경계 밖에서는 zod 스키마 객체를 값으로 넘기지 않는다. TypeBox 쪽 검증은 F 스키마(`Value.Check`)로 한다.
- 두 스키마 라이브러리가 같은 JSON Schema를 다르게 해석할 수 있는 곳은 MCP 도구 `inputSchema` 하나다. 이 값은 검증 없이 `parameters`로 넘기고 인자 검증은 L1.tools와 서버가 한다.

## 5. 단위 테스트 목록

네트워크와 실제 프로세스 없이 인메모리 전송(`src/testing/memory-transport.ts`), 스텁 서버, 가짜 `xeon.process`·`xeon.secrets`·`xeon.store`, 주입 시계를 쓴다(`eng.testing.guide` TS-03, TS-05). 승인 흐름은 `@xeon/ext-host/testing`과 L1.tools 테스트 도우미가 주는 가짜 승인 서비스로 확인한다.

| 파일 | 테스트 | 확인할 동작 |
|---|---|---|
| `test/defs.test.ts` | `mcp.client def has no issues` | `validateCapability(McpClient)` 이슈 0건 |
| `test/read-only.conformance.test.ts` | `the declared readOnly methods are exactly the reads`, `calling every read leaves the stored server rows and the server side untouched` | 능력 적합성(ADR-0015 §3.6, M3-REQ-88·89). readOnly 일곱 메서드의 집합과 선언 없음 네 메서드(`replay` unsafe)가 spec §3.6과 같다. 읽기 일곱을 부른 뒤 `cap_mcp_servers` 행이 같고 스텁 서버가 `tools/call`이나 알림을 받지 않는다. `mcp.client`에는 멱등 쓰기가 없다 |
| | `static tools are read only` | 정적 도구 3개가 `replay: "safe"`, `hints.readOnly: true` |
| `test/connect.test.ts` | `connects and lists tools` | 스텁 서버 연결 → `listTools`가 스텁 도구 2개 |
| | `exposes tools at next step boundary` | 연결 뒤 첫 단계 경계에서 도구 집합에 2개가 `added`로 들어간다(spec §9-1) |
| | `deny filter hides tool` | `tools.deny`의 도구는 `exposed: false`, 도구 집합에 없음 |
| | `negotiates 2026 with auto` | `versionNegotiation: "auto"`에서 2026 스텁은 `protocolVersion: "2026-07-28"` [가정: 스텁이 2026 협상을 지원] |
| | `calls tool and converts content` | 텍스트·이미지·리소스 링크 결과 변환, 이미지가 blob 자리표시 |
| | `wraps text as untrusted` | 텍스트가 `<untrusted_mcp_content server="stub">`로 감싸짐 |
| | `server isError maps to tool error` | 스텁 `isError: true` → 도구 결과 `isError: true` |
| | `result size limit` | `result.maxBytes` 초과 → `truncated` |
| `test/mrtr.test.ts` | `input_required becomes approval request` | 스텁이 elicitation form을 요구 → 도구 결과 `status: "input_required"`, 가짜 승인 서비스에 kind `question` 요청 1건(spec §9-2) |
| | `retry carries responses and state` | 응답 뒤 라운드 2 요청의 `inputResponses`가 응답 변환 결과이고 `requestState`가 바이트 그대로 |
| | `completes after retry` | 라운드 2에서 스텁이 완료 → 결과 `complete` |
| | `rounds exceeded` | 스텁이 계속 `input_required` → `maxRounds` 초과 시 `input_rounds_exceeded` |
| | `request id per round` | 라운드 r의 키가 `<기본>#r<r>`, 64자 초과 시 해시로 줄어든다 |
| | `restart while waiting retries once` | 대기 상태를 직렬화해 새 `cap-mcp` 인스턴스로 재개 → 라운드 2 요청이 정확히 1번(spec §9-6) |
| | `undeclared input kind rejected` | 스텁이 sampling 요청 → `input_unsupported` |
| | `secret-like form field warns` | `password` 필드가 있는 폼 → 질문에 경고 표지 |
| | `decline response` | 거절 응답이 `{ action: "decline" }`로 전달 |
| `test/approval-integration.test.ts` | `a server request is recorded as one kind question approval and the answer drives round 2` | core-tools 실제 `ApprovalService`(`fakeApprovals`, `l2ApprovalsPort`)에 `approval.requested` 1건(kind `question`, 기억 범위 `once`)이 기록되고, `QuestionAnswer`로 응답하면 `options.continuation`으로 나간 라운드 2 요청에 `inputResponses`와 원래 `requestState`가 실린다(spec §9-2) |
| | `the same request id after the answer reads the stored resolution and opens no second approval` | 같은 라운드 키로 다시 물으면 저장된 해결을 읽고 `approval.requested`는 1건 그대로다(재시작 뒤 재개, spec §9-6) |
| | `deny becomes a decline response and the server still completes` | 거부(`{ feedback }`)가 `{ action: "decline" }`로 가고 서버가 완료한다 |
| | `aborting the wait ends the ask without a response` | 대기 중 signal이 끊기면 `wait_cancelled` |
| | `a wrong answer shape is refused by the service and the request stays pending` | question 요청에 `allow`는 `applied: false`이고 요청은 대기 그대로다 |
| | `an MCP question, the question tool and a plan approval share one approval.requested record shape` | 세 요청의 이벤트 봉투, payload 키, 출처 키, 기억 범위, 기록 대화가 같고 MCP 질문 항목은 필수 키만 가진다(E5) |
| `test/reload.test.ts` | `a changed servers setting connects the new server once…`, `a trust decision made later is picked up…`, `concurrent reloads are serialized` | `reload`의 지문 비교, 신뢰 변화 반영, 직렬화 |
| | `a reload for a thread reads the .mcp.json of that thread's workspace, not the engine cwd`, `a thread without a workspace gets no project servers…`, `trust is asked for the workspace of the thread`, `settings are read with the layers of the thread…` | G2-02: 대화의 작업 폴더가 프로젝트 루트이고 엔진 cwd로 내려가지 않는다. 신뢰도 그 폴더로 묻는다. 프로젝트 층 서버 정의는 그 대화에서만 보인다 |
| `test/stdio-serve.test.ts` | `a request line on stdin is answered on stdout…` | 스텁 서버를 줄바꿈 JSON-RPC로 서빙한다(host의 실제 자식 프로세스 시험이 쓰는 함수) |
| `test/tool-service.test.ts` | `exposes tools at next step boundary` | core-tools 내장 확장의 실제 `ToolService`에 `createToolServiceRegistrar`로 등록한다. 연결만으로는 `advertise` 결과가 그대로이고 `applyBoundary` 뒤 `add`, `echo`가 광고된다. 메타는 순서 키 `mcp.stub`, `mcpServer: "stub"`, 위험 등급 `read`(E6, spec §9-1) |
| | `a denied tool never reaches the advertised set, and a dropped server leaves it at the next boundary` | `tools.deny` 도구는 광고되지 않고, 서버가 내려가면 다음 경계에서 광고 목록에서 빠진다 |
| | `a direct call reads the settings of the thread it runs in` | 동적 도구 호출이 `executeWithContinuation`의 `threadId`로 그 대화의 세션 층 설정(`l2.mcp.result.maxBytes`)을 읽는다 |
| | `a call goes through prepare and execute and the text is wrapped as untrusted` | 실제 `prepare`와 `execute`를 지난 결과 텍스트가 `<untrusted_mcp_content>`로 감싸진다 |
| | (할 일) `an input_required result of a dynamic tool raises a kind question approval …` | `test.todo`. F의 `AgentToolResult.status`와 core-tools 어댑터 연결이 들어온 뒤 켠다 |
| `test/reconnect.test.ts` | `crash removes tools then restores` | 스텁 연결 끊기 → 다음 경계 `diffToolsets.removed`에 서버 도구 전부, 재연결 → `added`(spec §9-3) |
| | `backoff schedule` | 주입 시계로 1, 2, 4초 … `maxDelayMs` 상한 |
| | `gives up after max attempts` | `maxAttempts` 연속 실패 → `failed`, 자동 시도 중단 |
| | `call during reconnect fails fast` | `reconnecting` 중 호출 → 즉시 `server_disconnected` |
| | `in-flight call finishes on removal` | 서버 정의 삭제 중 진행 호출이 끝까지 간다 |
| `test/names.test.ts` | `name conflict hides later tool` | 두 서버가 같은 이름 → 서버 id 바이트 순 뒤쪽이 `name_conflict` |
| | `invalid name hidden` | `TOOL_NAME_WIRE_PATTERN` 밖 이름 → `name_invalid`, 문자 치환 없음 |
| | `schema over limit hidden` | 깊이 13 스키마 → `schema_invalid` |
| | `order key is mcp server` | `toolOrderKey`의 capability 자리가 `mcp.<서버 id>` |
| `test/annotations.test.ts` | `maps hints when trusted` | spec §3.4 표의 각 행(`trustAnnotations: true`) |
| | `defaults applied when absent` | annotations 없음 → MCP 기본값 |
| | `untrusted annotations not used for policy` | `trustAnnotations` 거짓 → `hints` 비고 원본은 `details.mcpAnnotations` |
| | `approval rules keys` | 승인 모드 → `mcp__<서버 id>`, `mcp__<서버 id>__<도구>` 규칙 |
| `test/loader.test.ts` | `merges settings and mcp json` | 설정 우선, `.mcp.json` 항목 출처 `mcpjson:project` |
| | `normalizes mcp json names` | `My_Server` → `my-server`, 형식 위반은 진단 |
| | `rejects plaintext env` | 평문 env → 그 서버만 건너뜀 |
| | `untrusted project skips mcp json` | `session.trust.before` 거부 → 읽지 않음, `blocked(untrusted_project)` |
| | `deny wins over allow` | 같은 서버가 두 목록에 있으면 `blocked(denied_by_policy)` |
| | `managed only` | `managedOnly` → 사용자 범위 서버 `blocked(managed_only)` |
| `test/secrets.test.ts` | `secret values never persisted` | `secret://` env·headers 서버로 호출 → 가짜 이벤트 저장소, `cap_mcp_servers`, 테이프 요청 본문에서 비밀 문자열 0건(spec §9-4) |
| | `stderr masked in lastError` | stderr에 비밀 값 → `lastError.message`에 마스킹 표지 |
| `test/state.test.ts` | `persists server status` | 상태 변경이 `cap_mcp_servers`에 반영, 재시작 뒤 `lastError` 조회 |
| `test/boundary.test.ts` | `sdk types stay inside adapter` | `src/` 파일 중 허용 목록 밖에서 `@modelcontextprotocol/*`·`zod` import 0건(spec §9-10, 소스 텍스트 검사) |

## 6. 완료 기준

M2 완료:

1. 테스트 MCP 서버의 도구가 도구 목록에 노출된다(`product.scope.spec` §4.4 M2 종료 조건 그대로). 확인은 `test/connect.test.ts`의 `exposes tools at next step boundary`와, 모델 테이프 스모크에서 스텁 서버 도구가 모델 요청의 도구 목록에 들어가는지로 한다.
2. `L2.mcp.spec` §9 수용 기준 1~10이 §5 테스트로 확인된다.
3. `cd xeon && just verify`가 종료코드 0이다.
4. M2 종료 조건 "질문 도구와 계획 승인이 같은 승인 요청 레코드로 기록된다"(`product.scope.spec` §4.4)와 같은 레코드 형식으로 MCP 서버 주도 요청이 기록된다(kind `question`).

2차 완료(항목별): Tasks는 스텁의 `CreateTaskResult` → 폴링 → 완료가 백그라운드 완료 신호로 이어진다. 구독은 스텁의 `tools/list_changed` 알림이 다음 단계 경계에 `added`/`removed`로 반영되고 재연결 뒤에도 유지된다. OAuth는 가짜 인가 서버로 `REDIRECT` → `finishAuth` → 토큰이 `xeon.secrets`에만 저장된다.

## 7. 위험과 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| SDK 2.x API가 바뀌거나 rc 성격의 동작 변화 | 어댑터가 깨진다 | 2.3.1 정확 고정, lockfile integrity 확인. SDK 사용을 `adapter.ts`·`transport/`·`oauth/`·`tasks/schemas.ts`에만 두어 바꿀 곳을 좁힌다. 업그레이드는 `_research/notes/L2-1.md` 방식(선언 파일·소스맵 대조)으로 차이를 본 뒤 한다 |
| zod4와 TypeBox 이중 스키마 | 같은 데이터에 두 검증이 다르게 동작하거나 번들이 커진다 | 경계 변환 지점(§4 표) 밖에서 zod를 쓰지 않는다. `inputSchema`는 JSON 데이터로만 다룬다. `sdk types stay inside adapter` 테스트로 고정 |
| SDK가 Node 전제(engines Node >=20)라 Bun에서 일부 동작이 다름 | 연결·전송 실패 | MC2 첫 작업으로 인메모리 연결과 HTTP 전송을 Bun에서 확인한다. 문제가 stdio에만 있으면 자체 `ProcessStdioTransport`라 영향이 없다 |
| SDK `Transport` 인터페이스 모양을 잘못 가정 | `ProcessStdioTransport` 재작성 | MC2 시작 때 `dist/index.d.mts` 선언으로 확인하고 문서(spec §4.3 [가정])를 고친다 |
| stdio 서버의 샌드박스 적용 범위 미결 | 사용자가 등록한 명령이 사용자 권한으로 돈다 | 기본은 사용자 권한 실행이고 서버 정의 추가는 사용자의 명시 행위다. `.mcp.json`은 프로젝트 신뢰 뒤에만 읽는다. 샌드박스 적용은 `L2.mcp.spec` §10 미결 5로 결정한다 |
| 2025 서버의 서버 → 클라이언트 요청이 수동 모드에서 처리되지 않음 | 2025 서버의 elicitation이 실패 | `auto` 협상으로 2026 우선. 2025 경로는 MC5에서 스텁으로 확인하고, 처리기가 필요하면 그 요청만 승인 프로토콜로 옮기는 처리기를 둔다 |
| OAuth 콜백 포트 처리(2차) | 포트 충돌, 다른 프로세스가 콜백을 가로챔 | 루프백 주소에 임시 포트를 열고 `state` 값을 검증한다. 데스크톱은 커스텀 스킴 대안을 L4와 비교한다. MC10 착수 전에 L4.desktop.plan과 정한다 |
| Tasks 명세 미확인(2차) | 잘못된 필드로 구현 | 명세 본문 확인 전에는 MC8을 시작하지 않는다 |
| 서버 도구 이름 규칙 미결 | 이름 변경이 생기면 도구 fingerprint와 권한 규칙이 바뀐다 | `mcpToolName` 한 곳에 모으고 권한 규칙 키는 기계 이름과 따로 둔다(`mcp__<서버 id>__<원래 도구 이름>`) |

## 8. M2 구현 기록 (m2-plan MCP.1~MCP.5)

구현은 브랜치 `m2/mcp`에서 했다. 시험은 모두 주입한 가짜(시계, 수동 스케줄러, 인메모리 스텁 서버, 가짜 프로세스 포트, 가짜 승인 포트, 가짜 비밀 판정)로 돌고 외부 네트워크를 쓰지 않는다. HTTP 시험은 가짜 `fetch`와 `127.0.0.1`의 `Bun.serve` 루프백만 쓴다. 시험 환경은 WSL2이고 bwrap이 없다.

### 8.1 작업별 상태

| m2-plan ID | plan ID | 상태 | 내용과 시험 |
|---|---|---|---|
| (F.2) | MC1 | F 레인이 완료 | `defs/mcp.ts`, `services/mcp.ts`. 이 트랙은 `defs.test.ts`로 `validateCapability` 이슈 0건과 정적 도구 3개의 읽기 전용만 확인했다 |
| MCP.1 | MC2 | 구현 | `adapter.ts`(SDK 경계, 수동 MRTR, 오류 변환), `transport/process-stdio.ts`(`ProcessStdioTransport`), `transport/http.ts`(헤더 `secret://` 해석 fetch 감싸기), `transport/factory.ts`, `client/registry.ts`(상태 기계, 정의 동기화, 진행 중 호출 보호), `client/backoff.ts`, `testing/stub-server.ts`(2025·2026 와이어 스텁), `testing/stub-process.ts`. `sdk-bun.test.ts`, `transport-stdio.test.ts`, `transport-http.test.ts`, `reconnect.test.ts`, `cancel.test.ts` |
| MCP.2 | MC3 | 구현 | `settings.ts`(`l2.mcp.*` 14개 키와 범위별 서버 정의 읽기), `servers/loader.ts`(`.mcp.json` 변환), `servers/definitions.ts`(설정, `.xeon/mcp.json`, `.mcp.json` 합치기와 신뢰 연동), `servers/policy.ts`(허용·차단·managedOnly, 도구 거르기, 승인 규칙), `ports/trust.ts`(X `resolveProjectTrust` 연결). `settings.test.ts`, `loader.test.ts`, `trust.test.ts` |
| MCP.3 | MC4 | 구현 | `client/dynamic-tools.ts`(노출 판정, 동적 도구, 결과 변환), `client/schema-check.ts`, `client/content.ts`(내용 변환, blob, 크기 한도), `client/service.ts`(`mcp.client` 구현, `xeon.mcp`의 `registerServer`, 단계 경계 반영, `session.mcp.after` 페이로드), `client/register.ts`(`ToolService`·`ToolsPort` 등록 어댑터), `errors.ts`. `connect.test.ts`, `names.test.ts`, `boundary.test.ts`, `secrets.test.ts`, `register.test.ts` |
| MCP.4 | MC5 | 완료 | 구현: `elicitation/questions.ts`(입력 요청 → 질문), `responses.ts`(폼 검증, `inputResponses`), `rounds.ts`(`<requestId>#r<n>`, 상한), `approval-adapter.ts`(`McpQuestion` ↔ `QuestionBody`/`QuestionAnswer`, `L2ApprovalsPort`로 묻는 `askWithApprovals`), `callTool`·`getPrompt`·`readResource`의 `continuation` 처리와 라운드 상한. `mrtr.test.ts`(가짜 `L2ApprovalsPort`). F 요청 12(L1.tools.spec §8.3)의 F 쪽은 닫혔다(m2 F.8): `CallOptions.continuation`, 질문 옮기기 규칙은 F `defs/mcp-questions.ts`로 옮겼고 `responses.ts`·`approval-adapter.ts`는 그것을 다시 내보낸다. `callTool`·`getPrompt`·`readResource`는 `options.continuation`을 먼저 읽는다(`mrtr.test.ts`). 실제 core-tools `ApprovalService`로 한 통합 시험을 더했다(`approval-integration.test.ts`, 기록 모양 E5). 테스트 전용 의존 `@xeon/core-tools`를 `devDependencies`와 `tsconfig` 참조에 더했다(cap-web과 같다). 병합 때 동적 도구 경로를 닫았다(결정 D5 (a)): F `DirectToolRegistration.executeWithContinuation`이 연속 정보를 인자로 받고, `createToolServiceRegistrar`가 이를 채우며, core-tools `settleDirectInput`이 `status: "input_required"` 결과를 질문 승인으로 올려 같은 `toolCallId`로 다시 부른다. 실제 `ToolService`로 확인한 시험은 `tool-service.test.ts`의 `an input_required result of a dynamic tool ...`와 호스트의 `approval-shapes.int.test.ts`(질문 도구, 계획 승인, MCP 질문의 기록 모양 비교 포함)다. `ToolResourceDef` 경로(X `ToolsPort`)는 연속 정보 자리가 없어 서버 주도 요청에는 직접 등록 경로를 쓴다 |
| MCP.5 | MC6, MC7 | 구현 | `client/annotations.ts`(spec §3.4 표, 신뢰 여부), `servers/policy.ts`의 `buildApprovalRules`(규칙 id, 키 `mcp__<서버>__<도구>`), `client/state-store.ts`(`cap_mcp_servers`, 소유자 `cap.mcp`). `annotations.test.ts`, `state.test.ts` |
| (2차) | MC8~MC10 | 하지 않음 | Tasks, 변경 구독, OAuth. m2-plan §2.2가 2차로 둔다 |

### 8.2 SDK 2.3.1의 Bun 동작 확인 (m2-plan §7 위험 행)

`@modelcontextprotocol/client` 2.3.1을 Bun 1.4.3에서 `bun install`로 설치해 실행했다. 의존 7개(`@modelcontextprotocol/core`, `cross-spawn`, `eventsource`, `eventsource-parser`, `jose`, `pkce-challenge`, `zod`)와 이 패키지가 쓰는 SDK 진입점이 모두 로드된다. `jose`와 `pkce-challenge`는 OAuth(2차) 경로에서만 쓰이므로 이번 시험은 로드까지만 확인했다.

| 확인 항목 | 결과 | 시험 |
|---|---|---|
| 인메모리 연결, 2025 `initialize` 협상 | 성공. `protocolVersion` `2025-11-25` | `sdk-bun.test.ts` |
| `versionNegotiation: auto`, 2026 스텁 | `server/discover`로 2026 협상. `protocolVersion` `2026-07-28` | `sdk-bun.test.ts`, `connect.test.ts` |
| `auto`, 2025만 아는 스텁 | `server/discover`에 -32601을 받고 2025 `initialize`로 폴백 | `connect.test.ts` |
| 수동 MRTR(`inputRequired.autoFulfill = false`, 호출 `allowInputRequired`) | `input_required` 결과가 호출 반환값으로 온다. 재시도는 호출 params 최상위의 `inputResponses`와 `requestState`로 보내면 와이어에 실리고 `requestState`는 바이트 그대로 간다 | `mrtr.test.ts` |
| Streamable HTTP | 가짜 `fetch`와 루프백 `Bun.serve` 모두 2026·2025 연결과 목록이 된다 | `transport-http.test.ts` |
| 전송 옵션의 `fetch` | `StreamableHTTPClientTransportOptions.fetch`, `SSEClientTransportOptions.fetch`가 있다. 요청마다 헤더를 풀어 붙이는 감싸기가 동작한다 | `transport-http.test.ts`, `secrets.test.ts` |
| `Transport` 인터페이스 | `start`, `send`, `close`, `onclose`, `onerror`, `onmessage` 그리고 선택 필드 `sessionId`, `setProtocolVersion`, `hasPerRequestStream`. `ReadBuffer`·`serializeMessage`로 줄바꿈 JSON을 읽고 쓰는 자체 전송이 동작한다 | `transport-stdio.test.ts` |
| 호출 취소 | `signal` abort 때 SDK가 `notifications/cancelled`를 보낸다. SDK는 이 실패를 `RequestTimeout` 코드(메시지 `AbortError`)로 보고하므로 어댑터가 신호 상태를 보고 `aborted`로 바꾼다 | `cancel.test.ts` |
| 호출 제한 시간 | `timeout` 오류로 끝나고 취소 알림을 보낸다 | `cancel.test.ts` |
| 연결 제한 시간 | 협상에 응답하지 않는 서버는 `connectMs` 뒤 `timeout`으로 실패한다 | `reconnect.test.ts` |
| 2025 서버가 보낸 `elicitation/create` | 처리기를 두지 않은 수동 모드에서 오류 응답으로 거절된다(spec §5 13번) | `mrtr.test.ts` |
| `tools/list`의 도구 하나가 `inputSchema.type`이 `object`가 아님 | SDK가 목록 전체를 거부해 서버 연결이 실패한다(`protocol_error`). 어댑터가 숨기는 `schema_invalid`는 외부 `$ref`, 깊이, 크기 초과만 다룬다 | `names.test.ts` |

### 8.3 확인하지 못한 항목과 [미결]

| 항목 | 이유 | 확인 방법 |
|---|---|---|
| 실제 stdio 서버 프로세스 | 포트 구현은 닫음(m2c T3, `createMcpProcessPort`, `L0.process.spec` §4.9). 이 패키지는 가짜 `McpProcessPort`와 `serveStubOverStdio`(스텁을 실제 표준 입출력으로 서빙, `src/testing/stdio-serve.ts`)로 시험한다. 실제 자식 프로세스로 연결·도구 호출·엔진 종료 뒤 프로세스 부재를 보는 시험은 `apps/host` int 시험(m2c T2)이 한다. 공식 서버(filesystem 등)는 시험하지 않았다 | host int 시험, 그리고 사람이 공식 서버로 확인한다 |
| 비밀 env가 있는 stdio 서버 | 서버 시작에는 env 모드가 요구하는 승인 증거가 없어 `secret_denied`로 끝난다(spec §10 미결 14, `L0.process.spec` P-12, ADR-0011). 구현은 M3다 | 서버 정의 승인 흐름을 정한 뒤(`review.m3-plan`) |
| SSE 서버 연결 | SSE 이벤트 스트림을 내는 스텁이 없다. 전송 생성만 시험했다 | 2025 이전 SSE 서버로 사람이 확인한다 |
| 실제 `SecretService`와 헤더·env 주입 | 부분 가짜 `lease`로만 시험했다. `env`는 참조 그대로 프로세스 포트에 넘기는 것까지 확인했다 | SEC 레인 병합 뒤 통합 시험 |
| 도구 호출 경로의 `input_required` 흐름 | 닫음. 실제 `ToolService`(`tool-service.test.ts`)와 호스트 엔진(`apps/host/test/int/approval-shapes.int.test.ts`)에서 서버 질문이 kind `question` 승인으로 올라가고 답이 `continuation`으로 서버에 돌아간다 | 해당 없음 |
| `bwrap` 샌드박스 안의 stdio 서버 | 결정 D6으로 M2는 사용자 권한 실행이다. 이 환경에는 bwrap이 없다 | bwrap 환경에서 spec §10 미결 5를 정한다 |
| `l2.mcp.versionNegotiation = pin` | 설정 값 매핑만 있고 2026 서버가 `2026-07-28`을 내놓는 경우만 시험하지 않았다 | 핀 시험 추가 |

### 8.4 문서와 다르게 정한 점

- 파일 배치(§2)에 더한 것: `src/ports/`(`process.ts`, `secrets.ts`, `secret-service.ts`, `trust.ts`, `files.ts`, `store.ts`, `tools.ts`, `rules.ts`), `client/register.ts`, `client/schema-check.ts`, `servers/definitions.ts`, `elicitation/approval-adapter.ts`, `errors.ts`, `json.ts`, `order.ts`, `hash.ts`, `types.ts`. `manifest.ts`와 `apply(ctx)`는 만들지 않았다. 조립은 HOST.6이 `createMcp(deps)`를 불러 한다(m2-plan HOST.6).
- SDK 경계: `testing/`도 SDK를 import한다(스텁 서버가 SDK의 인메모리 전송을 쓴다). 수용 기준 10번의 허용 목록에 `testing/`를 더했고 `boundary.test.ts`가 이 목록으로 검사한다. `oauth/`, `tasks/`는 2차라 아직 없다.
- `.xeon/mcp.json`도 읽는다(결정 D6). 우선순위는 설정 > `.xeon/mcp.json` > `.mcp.json`이고 출처 표기는 각각 `settings:<범위>`, `mcpjson:xeon`, `mcpjson:project`다.
- 신뢰하지 않은 프로젝트의 `.mcp.json`은 읽지 않으므로 서버 이름을 알 수 없다. 그래서 `blocked(untrusted_project)` 서버로 나열하지 못하고 `LoaderDiagnostic`(`untrusted_project`)으로 알린다. project 범위 설정 정의는 목록에 `blocked(untrusted_project)`로 보인다.
- 승인 규칙은 `McpRulesSink` 포트로 공급한다. `ToolService.registerRules`가 `core:` 출처만 받기 때문이다. 기계 이름을 모르는 도구(숨김, 아직 목록에 없음)의 도구별 규칙은 만들지 않는다. `resource.tool` 없이 만들면 서버 전체에 걸리기 때문이다.
- 도구 기계 이름은 결정 전까지 서버가 광고한 이름 그대로다(`mcpToolName`). 두 서버가 같은 이름을 내면 서버 id 바이트 순으로 뒤쪽을 `name_conflict`로 숨기고, `reservedToolNames`에 든 내장 이름과 겹쳐도 같다.
- `McpQuestion`에 경고 필드가 없어 비밀처럼 보이는 폼 필드의 경고는 질문 `message` 앞의 문장으로 붙인다.
- `QuestionBody`는 질문을 최대 4개 받는다. 폼 필드가 4개 이하면 필드마다 질문 하나로, 넘으면 폼마다 JSON 한 칸으로 옮긴다. 입력 요청이 네 개를 넘으면 `too_many_questions`다.
- `sampling = "ask"`로 질문을 보여도 응답은 보내지 않는다(spec §10 미결 6). 키를 빼 두어 서버가 같은 요청을 다시 낼 수 있다.
- 서버가 라운드 `maxRounds`의 응답에서 또 입력을 요구하면 사람에게 묻지 않고 바로 `input_rounds_exceeded`다.
- 재연결 간격은 첫 실패 뒤 1초, 이어서 2초, 4초이다(`attempt`가 실패 횟수). 연결 실패로 재시도를 기다리는 동안의 상태도 `reconnecting`이다.
- `listServers`의 `toolCount`는 모델에게 노출되는 도구 수다.
- `SSEClientTransport`는 SDK가 deprecated로 표시해 `typescript/no-deprecated` 예외 주석 한 줄이 있다. 서버 정의의 `type: "sse"`(2025 이전 서버 호환, spec §3.1)가 유일한 사용처다.
- 설정에 있는 id와 확장이 등록한 id가 겹치면 `registerServer`는 거부한다. 등록 뒤에 설정이 같은 id를 더하면 설정이 이기고 확장 정의는 가려진다.

### 8.5 다른 레인에 요청할 항목

| 대상 | 요청 | 근거 |
|---|---|---|
| F 레인, L1A | 닫음. `CallOptions.continuation`과 질문 옮기기 규칙은 F.8에서, 동적 도구 경로(`DirectToolRegistration.executeWithContinuation`)와 core-tools 어댑터는 병합 때 들어왔다. `McpQuestion` → `QuestionBody` 규칙은 F `defs/mcp-questions.ts`가 기준이다 | L1.tools.spec §4.3, §8.3 F 요청 12, D5 |
| F 레인 | `McpQuestion`에 선택 필드 `warnings`(비밀 필드 경고를 문장 붙이기 대신 구조로) | spec §4.6 10번 |
| L0 PLT | 닫음(m2c T3, `L0.process.spec` §4.9). `McpProcessPort`의 구현: stdin·stdout·stderr 스트림을 주고, `secret://` env를 실행 직전에 주입하고, `BackgroundRegistry`에 owner kind `mcp`, ref 서버 id로 등록하고, 종료는 stdin 닫기 → SIGTERM → SIGKILL이다. F `ProcessPort.spawn`은 격리 확장용 진입점이고 `ExecService.startBackground`는 스트림을 주지 않는다 | spec §4.3, `src/ports/process.ts` |
| L1A | L2가 확장 티어 권한 규칙을 공급하는 API(지금 `registerRules`는 `core:<도메인>` 출처만 받는다). `PolicyRule`은 `resource.mcpServer`와 `resource.tool`을 쓰는 모양으로 이미 맞춰 두었다 | spec §4.4, `src/ports/rules.ts` |
| HOST.6 | `createMcp(deps)` 연결: `createToolServiceRegistrar(toolService)`, `createSecretServiceHeaders(secretService)`, `createProjectTrust`(X `resolveProjectTrust` 입력), `McpStorePort`(`xeon.store`), 설정 층, `reservedToolNames`(내장 도구 이름), `onServersChange`(`session.mcp.after` 지점). 세션 시작에 `load`, 단계를 여는 `boundary.step.before`마다 `reload(signal, { threadId })`(지문이 바뀌었을 때만 서버를 맞춤)와 `applyBoundary`, 종료에 `shutdown`. 프로젝트 루트는 `McpDeps.workspaceOf`(대화의 작업 폴더, `L2.readme` §5.10)로 넘기고 stdio 포트는 조립 루트가 `process`로 넘긴다. 능력 바인딩 `cap:mcp.client`와 `xeon.mcp`는 `runtime.service`로 등록한다. 매니페스트·`apply`는 이 단계에서 만든다 | m2-plan HOST.6, spec §3.2 |
| 통합 단계 | `xeon/bun.lock`에 `@modelcontextprotocol/client` 2.3.1과 그 의존까지 패키지 12개 항목이 더해졌다(다른 트랙의 lock 변경과 병합할 때 `bun install`로 다시 만든다) | m2-plan §3 규칙 2 |
