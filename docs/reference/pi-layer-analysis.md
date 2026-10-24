# pi 모노레포 레이어 분석 (조사 원본)

- 조사: 2026-10-11, 조사 에이전트가 pi 저장소 `main` 커밋 `cdaf6c2`와 npm `@earendil-works/*` 1.1.0을 확인함
- 클론: `../pi-src` (클라우드 작업 공간에서 clone한 것. 저장소 밖에 다시 clone 필요), 실험 스크립트: `experiments/pi-lab/exp1~6-*.mjs` (API 키 없이 faux provider)
- 표기: [원문] 소스·문서 직접 확인, [실험] 코드 실행으로 확인, [지식] 재확인 안 함
- 이 파일은 조사 보고를 설계 입력용으로 보존한 것이다. 요약본은 `helm-v0.3-audit/pi-runtime-options.md`.

## 1. 패키지 목록 (모두 lockstep 1.1.0, LOC는 src/**/*.ts)

| 패키지 | LOC | 설명 | 상태 |
|---|---|---|---|
| packages/ai (`@earendil-works/pi-ai`) | 27,242 | 멀티 provider LLM API: Models 컬렉션, 카탈로그, auth, 스트리밍 이벤트, faux provider | 안정 계열 |
| packages/agent (`pi-agent-core`) | 2,519 | `Agent`, `agentLoop`, `agentLoopContinue`, 도구 실행, 훅, steering/follow-up 큐 | 안정 계열. 1.0.0에서 실험 하네스 제거 |
| packages/coding-agent (`pi-coding-agent`) | 86,152 | `pi` CLI: AgentSession, SessionManager, 확장, 내장 도구, interactive/print/json/rpc 모드, SDK | 안정 계열. `src/experimental`, `src/client`는 npm 제외 |
| packages/tui (`pi-tui`) | 19,505 | 차등 렌더링 터미널 UI (main/alt screen, Editor, Markdown 등) | 안정 계열 |
| packages/durable (`pi-durable`) | 22,842 | 내구성 대화·태스크·문서 런타임 (Harness, Storage, Task, Extension) | Experimental |
| packages/chord (`@earendil-works/chord`) | 8,817 | 애플리케이션 조립 런타임: facet, service, replicated state, delta. pi 의존 없음 | 2026-09 신규 |
| packages/protocol (`pi-protocol`) | 869 | 길이 프리픽스 + CBOR 프레임 envelope, protocol v8 | experimental |
| packages/client (`pi-client`) | 1,135 | protocol 클라이언트, Unix 소켓 transport, discovery | experimental |
| packages/server (`pi-server`) | 1,958 | 세션 라우팅 서버 (Unix listener, multi-attachment) | experimental |
| packages/codemode (`pi-codemode`) | 2,597 | QuickJS(WASM) 샌드박스에서 모델이 쓴 JS 실행, 주입된 도구만 호출 | 2026-09 신규 |
| packages/mcp (`pi-mcp`) | 3,244 | 독립형 MCP 클라이언트 (stdio, Streamable HTTP) | 2026-09 신규 |
| packages/env (`pi-env`) | 2,073 | pi-durable용 원격 실행 환경 (SSH로 배포하는 Rust 데몬, `RemoteExecutionEnv`) | 2026-10 신규 |
| packages/telemetry (`pi-telemetry`) | 935 | 벤더 중립 telemetry span 계약, in-memory 어댑터 | |
| packages/evals (`pi-evals`) | 1,446 | coding agent 행동 평가 (vitest-evals, Docker). private | |

- `pi-web-ui`는 0.74.0~0.75.3(2026-05)까지 배포되었고 현재 모노레포에 없다. mom(Slack 봇)과 pods도 현재 저장소에 없고, Slack 자동화는 `earendil-works/pi-chat`으로 안내된다.
- npm 스코프는 0.74.0(2026-05-07)부터 `@mariozechner/*`에서 `@earendil-works/*`로 바뀌었다.

## 2. pi-ai

| 항목 | 내용 |
|---|---|
| Provider 추상화 | `createModels()`로 `Models` 컬렉션, `setProvider(xxxProvider())`로 등록. provider가 카탈로그·auth·stream을 함께 가짐. 와이어 프로토콜은 API 구현(`anthropic-messages`, `openai-responses`, `openai-completions`, `pi-messages` 등)으로 공유. 내장 provider 약 35개. 커스텀은 `createProvider({id, auth, models, api})` [원문 `ai/README.md`] |
| 모델 레지스트리 | `models.getModel(provider, id)`, `getModels()`, `getAvailable()`, 동적 provider `refresh()`, 정적 카탈로그 `getBuiltinModel()`(`providers/all`). 모델은 직렬화 가능한 plain data. `getModel`(구 API)은 `pi-ai/compat`로 이동 [원문] |
| Auth | `CredentialStore`(read/list/modify/delete) 교체 가능, 기본 `InMemoryCredentialStore`. OAuth refresh는 `modify` 안에서 직렬화. `transformHeaders` 옵션 [원문] |
| 스트리밍 이벤트 | `start`, `text_*`, `thinking_*`, `toolcall_start/delta/end`, `done`, `error`. 블록 간 이벤트가 섞일 수 있어 `contentIndex`로 구분. `partial`은 실시간으로 바뀌는 객체라 스냅샷 저장 금지 [원문] |
| Tool-call 형식 | `{type:"toolCall", id, name, arguments: JsonObject, thoughtSignature?, namespace?}`. 결과 `{role:"toolResult", toolCallId, toolName, content:(Text|Image)[], isError, durationMs?}`. `validateToolCall(tools, call)`. 스키마는 TypeBox, `strict: 'prefer'|'require'` [원문 `ai/src/types.ts:436`] |
| 시스템 메시지 | transcript 안의 `role:"system"` 메시지(`sections`, `toolsAdded`, `toolsRemoved`)로 프롬프트·도구 변경 기록. `getCurrentSystemPrompt()`, `getCurrentTools()`. 중간 system 메시지 미지원 모델에는 합쳐서 보냄 [원문] |
| Faux provider | `fauxProvider({provider, api, models, tokensPerSecond})`, `setResponses([...])`, `fauxAssistantMessage`, `fauxText`, `fauxThinking`, `fauxToolCall`. 응답 factory는 `(context, options, state, model)` [원문][실험]. 도구 호출을 실행시키려면 `fauxAssistantMessage(..., { stopReason: "toolUse" })` (이전 스파이크에서 확인) |
| 직렬화·이어가기 | `Context`를 JSON 왕복해 다른 provider로 이어갈 수 있음 [실험 exp2]. 다른 API로 넘어갈 때 thinking 블록을 텍스트로 바꾸는 처리는 `ai/src/api/transform-messages.ts`. 결과 없는 tool call에는 `"No result provided"` 합성 결과 [원문 :158] |
| 부분 응답 영속화 | `AssistantMessageFrameEncoder`, `reduceAssistantMessageFrames()`로 스트림을 compact frame으로 저장·복원 [원문][실험] |
| 비용·사용량 | `Usage{input, output, cacheRead, cacheWrite, cacheWrite1h?, reasoning?, totalTokens, cost{...,total}}`, `AssistantMessage.durationMs`(1.1.0). faux에서는 cost 0 [실험] |
| stopReason | `pending`, `stop`, `length`, `toolUse`, `error`, `aborted`, `deferred` [원문] |

## 3. pi-agent-core

| 항목 | 내용 |
|---|---|
| 크기 | 2,519줄: `agent-loop.ts` 949, `agent.ts` 613, `types.ts` 539, `proxy.ts` 393. 의존성 `pi-ai`, `typebox` [원문] |
| API | `new Agent({initialState, streamFn, convertToLlm, transformContext, beforeToolCall, afterToolCall, prepareRequest, finishTurn, toolExecution, steeringMode, followUpMode, getApiKey, sessionId})`. 메서드 `prompt()`, `continue()`, `steer()`, `followUp()`, `abort()`, `waitForIdle()`, `subscribe()`, `reset()`, `peekQueuedMessages()`. 저수준 `agentLoop()`, `agentLoopContinue()`, `runToolCall()`. `runAgentLoopContinue(context, config, emit, signal, streamFn)` (5개 인자) [원문] |
| 도구 실행 | 기본 parallel: preflight 순차, 실행 동시, 결과는 assistant 원래 순서로 정렬. 도구별 `executionMode:"sequential"`. 순서: `prepareArguments` → 스키마 검증 → `beforeToolCall`(block/reason/terminate) → `execute` → `afterToolCall`(content/details/isError/terminate 덮어쓰기) [원문 `agent-loop.ts:720-860`] |
| 이벤트 | `agent_start/end`, `turn_start/end`, `message_start/update/end`, `tool_execution_start/update/end`. `Agent.subscribe` 리스너는 await 되며, assistant `message_end` 처리가 끝나야 tool preflight 시작. 저수준 `agentLoop` 스트림은 관찰만 [원문 README] |
| 상태 | `agent.state`의 `messages`, `tools`, `model`, `thinkingLevel`을 메모리에 보유. 시스템 프롬프트는 transcript의 system 메시지로 재생 [원문] |
| 제공하지 않는 것 | 영속화, 세션, 브랜치, 컴팩션, 재시도 정책, 도구, 스킬, 프롬프트 템플릿, 원격 프로토콜. 1.0.0 CHANGELOG에서 `AgentHarness`, 세션 스토리지, durable 런타임, 하네스 도구, 컴팩션 제거 [원문]. `AgentTool.replay?: "never"|"safe"`는 타입에만 있고 루프는 사용 안 함 [원문 grep] |
| 커널로 감싸기 | 가능 [실험 exp1]. `beforeToolCall`에서 block하면 `isError:true` + 사유 텍스트 toolResult. block된 호출에는 `afterToolCall` 미호출 [실험]. `state.messages` JSON 왕복 후 새 `Agent`에서 이어서 실행 가능 [실험]. `prepareRequest`로 매 요청 직전 canonical context 재구성 가능 [원문]. `beforeToolCall`의 `args`는 `execute`에 그대로 전달되므로 mutate하면 반영됨 [원문 코드]. 단 agent-core 문서의 명시 계약은 아님 |

## 4. pi-coding-agent

| 항목 | 내용 |
|---|---|
| SDK | `createAgentSession({cwd, agentDir, model, modelRuntime, settingsManager, sessionManager, resourceLoader, tools, customTools})` → `{session}`(AgentSession 4,398줄). `AgentSessionRuntime`(newSession, switchSession, fork, importFromJsonl). `SessionManager.create/open/inMemory`, `SettingsManager.inMemory`, `DefaultResourceLoader`(extensionFactories) [원문 `docs/sdk.md`, `examples/sdk/12-full-control.ts`]. SessionManager 생성자는 private |
| SDK 실험 [exp3] | faux + `ModelRuntime.create({credentials, modelsPath:null, allowModelNetwork:false})` + `registerProvider()`로 동작. 인라인 확장 `tool_call`에서 bash block, read의 `event.input.path` 수정 반영. `agent_settled`에서 `appendEntry` → JSONL `custom:helm-audit`. `SessionManager.open()`으로 재개 |
| 내장 도구 재사용 | `createReadTool(cwd)`, `createBashTool(cwd)`, `createEditTool`, `createWriteTool`, `createGrepTool`, `createFindTool`, `createLsTool`, `createCodingTools`는 순수 `AgentTool` 반환. 세션 없이 agent-core와 조합 가능 [실험 exp1]. `ReadOperations`, `BashOperations.exec` 등 `*Operations` 인터페이스로 파일·프로세스 접근 교체 가능 [원문 `core/tools/*.ts`]. 패키지 루트 import 시 coding-agent 전체(tui, chord, codemode, mcp, photon 등)가 의존성으로 따라옴 [원문 package.json] |
| 확장 API | `pi.on(event)`, `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`, `registerProvider`, `registerMcpServer`, `registerVirtualModel`, `sendMessage`, `sendUserMessage`, `appendEntry`, `setActiveTools`, `events`. 이벤트 40여 개: `before_agent_start`, `context`, `context_with_system`, `before_provider_request`, `provider_stream_event`, `tool_call`(block 또는 `event.input` mutate), `tool_result`, `turn_end`, `agent_before_settle`(entry 추가 후 `continue:true`), `agent_settled`, `session_*`. `ctx.ui`, `ctx.executeTool`, 도구 `exposure`(`direct`/`model-only`/`codemode`/`deferred`/`hidden`) [원문 `docs/extensions.md`, `core/extensions/types.ts` 2,273줄] |
| 모드 | interactive(TUI), print, `--mode json`, `--mode rpc`(stdin/stdout JSONL, 명령 약 33개: prompt, steer, follow_up, abort, get_state, get_messages, set_model, compact, bash, fork, get_tree, switch_session 등), `RpcClient` export. 확장 UI dialog는 RPC로 전달, 커스텀 터미널 컴포넌트는 미전달. RPC는 프로세스 하나에 클라이언트 하나 [원문 `docs/rpc*.md`] |
| codemode / tool_search / MCP | CLI는 내장 확장으로 로드. SDK는 `createCodemodeExtension()`, `createToolSearchExtension()`, `createMcpExtension()`을 `extensionFactories`에 직접 추가 [원문]. codemode 스크립트 안의 도구 호출은 `ctx.executeTool`을 거쳐 훅 적용. 기본 codemode에서는 채팅 모델 하위 호출 불가 (이전 실험). codemode 변수는 스크립트 1회 수명 (이전 실험) |
| 세션 파일 | `~/.pi/agent/sessions/--<path>--/<ts>_<id>.jsonl`, version 3. 엔트리 `id`/`parentId` 트리, fork/clone은 새 파일(`parentSession`). 엔트리 종류: message, model_change, thinking_level_change, usage, compaction, context_edit, branch_summary, custom, custom_message, label, session_info [원문 `docs/session-format.md`]. 쓰기는 엔트리마다 `appendFileSync`, fsync·파일 락 없음 [원문 `session-manager.ts:1170-1187`]. 스트리밍 중간 상태, 실행 중 도구 상태는 미저장 |
| experimental durable | `src/experimental/durable/`: pi-durable Harness + `CodingTools` + pi 시스템 프롬프트 + pi TUI 컴포넌트로 만든 소형 코딩 에이전트. 세션별 sqlite, 락(10초 후 stale), subagent, task graph. 세션 목록·fork·트리 탐색·확장·템플릿·이미지·`/login` 없음. `node --import source-resolver.ts`로만 실행 [원문 README] |
| experimental server/client | `PI_EXPERIMENTAL=1 ./pi-test.sh server|client`. 세션마다 worker 프로세스가 `session.sqlite`에 pi-durable Harness를 엶 (AgentSession 아님). Chord facet 서비스: `SessionDirectory`, `SessionManagement`, `AgentController`, `Transcript`(=`Conversation.viewState()`), `Models`, `SlashCommands`. 연결: coordinator 경유 Unix 소켓, Radius relay(WebSocket subprotocol `pi-session-relay.host.v1`). TODO: 트리 탐색, next-run 큐, subagent 노출, transcript 페이징. npm `files`에서 제외 [원문][실험] |

## 5. pi-tui

| 항목 | 내용 |
|---|---|
| 모델 | `Component.render(width): string[]`, `handleInput`, `invalidate`. `TuiMainScreen`(scrollback 유지), `TuiAltScreen`(`VStack`/`HStack`/`ScrollView`). 차등 렌더링, CSI 2026 동기 출력. 컴포넌트: Text, Editor, Markdown, SelectList, SettingsList, Image, Box, Loader, Overlay. `Terminal` 교체 가능, `VirtualTerminal`(테스트) [원문] |
| 의존성 | `get-east-asian-width`, `marked` 두 개 [원문] |
| pi 화면 재사용 | coding-agent가 `AssistantMessageComponent`, `ToolExecutionComponent`, `UserMessageComponent`, `CustomEditor`, `FooterComponent`, `ModelSelectorComponent`, `initTheme`, `getMarkdownTheme` export. JSON 메시지만으로 `AssistantMessageComponent` 렌더링 [실험 exp6]. interactive 화면 조립 코드(`createInteractiveTui`, `createChatViewport`)는 export 안 됨 [원문]. 예제 `tui/test/chat-simple.ts` |

## 6. pi-durable

| 항목 | 내용 |
|---|---|
| agent-core와의 관계 | 재사용하지 않고 별도 구현. 의존성 `pi-ai`, `chord`. 자체 `generation.ts`(690), `tool.ts`(892), `scheduler.ts`(1,897). 내장 도구는 `ExecutionEnv` 위의 read/write/edit/bash/powershell만, grep/find/ls 없음 [원문] |
| 개념 | `Harness.open(storage, {models, registry, settings, env})`, `root()` → Conversation. 불변 엔트리(`pi.user`, `pi.assistant`, `pi.tool-result`, `pi.system`, `pi.compaction`, 사용자 정의 kind). `defineDoc`(scope, history `latest`/`rewindable`, fork 정책), `defineTask`(phase마다 checkpoint 커밋, child task, `failFast`/`allSettled`). Submission(`requestId` 멱등), inbox(steer/follow-up/write). 모든 변경은 하나의 원자적 커밋 라인 [원문 README·spec] |
| Extension·hook | `defineExtension({name, tools, sections, hooks, wraps, tasks})`, registry로 설치. `defineTool({parameters, execute(args, api, ctx), replay, callers, structuredOutputSchema})`. hook: `ToolTask.beforeTool`(block 또는 인자 재작성)/`afterTool`, `GenerationTask.beforeRequest`/`afterResponse`/`onYield`/`afterTools`, `CompactionTask.beforeCompact` [원문]. wrapTool은 `wraps`에 둠 (이전 스파이크). HookApi는 읽기 전용 (이전 스파이크) |
| 스토리지 | Memory, SQLite(Node, WAL, `synchronous=NORMAL`), JSONL(`fsync` 옵션), Cloudflare DO SQLite. 커스텀 Storage는 `registerStorageConformance`로 검증. 스토리지 하나는 프로세스 하나만 소유, 프로세스 간 락 없음 [원문] |
| 크래시 복구 [실험 exp4] | 도구 실행 중 `process.exit` 후 재오픈 + `resume()`. 같은 `requestId` 제출 시 기존 submission 반환. 중단 호출은 `diagnostics: interrupted "Tool slow was interrupted and may have partially run"`. 이후 generation 진행 후 `done`. 엔트리 순서: `pi.user pi.system pi.assistant pi.tool-result pi.assistant` |
| 원격 관찰 | `conversation.viewState()`/`watch()`가 커밋마다 Chord ops 전달. 미처리 frame 100개 초과 시 전체 view로 교체. 늦게 붙은 클라이언트는 현재 view부터. `watchEvents()`(experimental). 네트워크 transport 없음 [원문] |
| 명세 | `packages/durable/docs/spec.md` (5,123줄, "Pico5"). 5.2절: 실행 의도 → 실행 → 결과 기록("effect sandwich") |
| 성숙도 | 2026-09-19 0.0.1, npm 14개 버전. "Experimental. The API changes without notice". Unreleased Breaking 5개 (ToolTask 입력 union, `content`→`output`, bash 종료코드, storage 오류 시 세션 종료 등), `pi.tool` v2 마이그레이션 |

## 7. pi-server / pi-client / pi-protocol / chord

| 항목 | 내용 |
|---|---|
| 프로토콜 | v8. 4바이트 big-endian 길이 + definite-length CBOR 항목 하나. 기본 한도 16 MiB. payload는 strict JSON, 의미는 Chord 서비스 호출(`{serviceId, member, args}`) [원문][실험] |
| attachment | 프레젠테이션(클라이언트)이 Session에 붙는 라우트 `{serverId, sessionId, attachmentId}`. 세션당 여러 개 [원문] |
| transport | Unix 소켓(`createUnixServer`, `createUnixTransportFactory`, `discoverUnixServers`). Radius relay(WebSocket)는 coding-agent experimental 코드에만 [원문] |
| 인증 | "Peer authentication ... not implemented" [원문] |
| 호스팅 | pi-server는 앱이 공급하는 `ServerHost{resolveSession, openSession}`을 라우팅만 함 [원문] |
| client | `Client.connect({serverId, transportFactory})`, `request()`, `subscribeService()`. 자동 재연결·재전송 없음 [원문] |
| chord | facet, service(singleton/keyed), replicated state, delta codec. pi 의존 없음, esbuild만 사용 [원문] |

## 8. 버전과 안정성

- 모든 패키지 동일 버전. 1.0.0은 2026-10-01. 핵심 4개 패키지는 0.74.0(2026-05-07)~1.1.0(2026-10-07) 사이 npm에 58개 버전 (주당 약 2.7회) [실험].
- CHANGELOG에 `### Breaking Changes` 절을 둠. semver 보장 문구는 없음. patch 릴리스에도 breaking 있었음: pi-ai 1.0.3 Azure provider 이름 변경, 1.1.0 stream 함수 반환 타입 변경, agent-core 0.87.0 `shouldStopAfterTurn` 제거 [원문].
- Breaking 절 수(사례 조사 보고 기준): coding-agent 49, pi-ai 27, pi-agent-core 13.

## 9. 레이어 선택지 비교 (조사 보고 원문 요약)

| | (a) pi 앱 + 확장 | (b) SDK 임베드 | (c) agent-core + pi-ai + 자체 런타임 | (d) pi-ai만 | (e) pi-durable | (f) server/client/protocol |
|---|---|---|---|---|---|---|
| 기본 제공 | TUI, 세션 트리, 컴팩션, 재시도, 스킬, MCP, codemode, 내장 도구, RPC | (a)의 런타임을 in-process 객체로 | 루프, 병렬 도구 실행, 훅, 큐, 이벤트 + coding-agent 도구 라이브러리 | provider, 카탈로그, auth, 스트림, 검증, frame encoder, faux | 커밋 기반 루프, 크래시 복구, inbox, subagent, task graph, 컴팩션, usage, view ops | 라우팅, CBOR framing, multi-attachment |
| 직접 구현 | 데몬, 원격, 커널 로그 | 데몬, 원격 프로토콜, 다중 세션, 인증 | 영속화, 세션·브랜치, 컴팩션, 재시도, 크래시 복구, 원격, 클라이언트 | (c) + 루프 | 원격 transport·인증, 클라이언트, grep/find/ls, 확장 생태계 대체 | 서버 앱, 인증, UI + (e) |
| tool-call 가로채기 | `tool_call` block/mutate | 같음 | `beforeToolCall`/`afterToolCall`/`runToolCall` 완전 제어 | 직접 | `beforeTool`/`afterTool` | (e)와 같음 |
| 크래시 생존 | 확정 메시지까지(fsync 없음) | 같음 | 직접 구현 (frame encoder, `prepareRequest` 활용) | 직접 | 기본 제공 (100ms partial 커밋, 실행 전 intent 커밋, interrupted, `replay:"safe"`) | (e) 기반 |
| 업그레이드 위험 | 중간 | 중간~높음 | 낮음~중간 | 가장 낮음 | 높음 | 매우 높음 |

(c) 커널 구성 예 [실험 exp1 근거]:
1. `subscribe(async e => { if (e.type==="message_end") await log.commit(e.message) })` → preflight 전에 커밋 보장
2. `beforeToolCall`에서 검증 + intent 커밋 + block 여부 결정
3. `afterToolCall`에서 결과 커밋 (block된 호출은 미호출이므로 block 기록은 1이나 toolResult에서 처리)
4. `prepareRequest`에서 로그 기준 context 재구성

## 10. 사례 조사 요약 (별도 조사)

- OpenClaw: 2026.5.31-beta.3부터 pi-ai/agent-core/coding-agent 제거, pi-tui만 유지. `packages/agent-core`(private)가 pi-agent-core와 같은 파일 구성. "Portions adapted from Pi / pi-mono".
- Happy Agent: ohmypi 포크로 출발 → 2026-07-23 pi-ai 제거. 데몬(Unix 소켓 0600 + 토큰), HTTP+SSE+WS, 커밋 후 발행 + UUIDv7 커서 재연결, SQLite, 권한 모드, 샌드박스.
- Paseo: `pi --mode rpc` 자식 프로세스 어댑터. RPC 스트림에 없는 상태는 주입 확장의 `ctx.ui.notify` 마커로 우회. pi 업그레이드마다 수명주기 버그.
- pi-web: coding-agent SDK 임베드, 세션 데몬 분리. 0.85.0 패키징 사고(로드 불가), 0.87 SessionManager 의미 변경. SDK 무결성 테스트 추가.
- Assembly Line: agent-core + pi-ai 0.87.1 exact pin, 자체 `AgentHarness` 계약 뒤에 둠. Helm 계획과 가장 비슷한 형태.
- Absurd 패턴: 메시지 단위 체크포인트. 도구 실행 중 크래시를 구분 못 하는 함정 있음 (마지막 assistant에 미완료 tool call이 있을 때).
- pi-fabric: pi-durable 위 실제 런타임. 스트리밍 델타 저장 시 저널 급증 → 순서 마커만 커밋. 정확히 한 번 실행 미보장. unsafe 도구 중단 시 fail closed.
- Cloudflare Agents Pi 하네스: pi-durable + DO SQLite. 승인 단계 없음.
- pi에는 권한 시스템이 없음. README는 격리(Gondolin VM, Docker, OpenShell) 안내.
