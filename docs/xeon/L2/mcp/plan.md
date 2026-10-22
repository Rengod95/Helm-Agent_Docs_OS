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
                        #   provides: [{ id: "mcp.client", version: "1.0.0" }], points: ["mcp_servers_change", "project_trust"], usesDrive: false })
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
| MC3 | 서버 정의 로더와 설정 키: `settings.ts`(14개 키), `servers/loader.ts`(설정 병합, `.mcp.json` 가져오기, 이름 변환, 평문 비밀 거부, 진단), `servers/policy.ts`(허용·차단·managedOnly, 도구 allow/deny), `project_trust` 연동 | MC1. 설정 유효 값 조회는 L1.persistence·wire-settings 구현 | M |
| MC4 | 동적 도구 광고와 순서 키: `client/dynamic-tools.ts`(`McpDynamicTool`, `mcpToolName`, 이름·스키마 검사, 충돌 시 미노출), 단계 경계 반영(`diffToolsets`), `mcp_servers_change` 발화, `client/content.ts`(결과 변환, blob, untrusted 감싸기, 크기 한도), `client/service.ts`의 `listTools`·`callTool`·프롬프트·리소스 메서드와 정적 도구 3개 | MC2, MC3, X.primitives.plan(리소스 등록 API), L1.context.plan(`toolsAdded`/`toolsRemoved` 기록), L0.store.plan(blob API) | L |
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
| | `untrusted project skips mcp json` | `project_trust` 거부 → 읽지 않음, `blocked(untrusted_project)` |
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
