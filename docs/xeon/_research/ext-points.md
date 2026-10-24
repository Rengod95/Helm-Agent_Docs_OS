# X-b 확장 지점 모델 재설계 근거 조사

- 목적: "강제 수준 5단계 + 지점 계약 5필드" 안을 원시 연산 3~5개로 줄이기 위한 근거 수집과 대안 3안 제안. 설계 조사이며 구현은 없다.
- 표기: [원문] 소스·문서에서 직접 읽음 / [외부] 공식 문서를 이번에 WebFetch로 읽음 / [기억] 읽지 못했고 기존 지식에 의존 / [추측] 위 근거에서 내가 추론함.
- 경로 약어: `PI` = `~/projects/_ref/pi-src/packages`, `CA` = `PI/coding-agent/src/core`, `EXT` = `CA/extensions`, `AG` = `PI/agent/src`, `DU` = `PI/durable`, `OMP` = `scratchpad/ext/omp/repo/packages/coding-agent/src`, `CORDIS` = `scratchpad/ext/cordis/repo/packages/core/src`.
- 코드는 실행하지 않았다. 외부 문서는 읽기만 했고, 일부(OpenAI Agents hooks, Effect)는 페이지 본문을 못 받아 [기억]으로 표시한다.

## 0. 결론 먼저
1. [추측] 현재 안의 5필드 중 4개는 "지점 선언의 타입"에서 유도되는 값이라 확장 작성자가 쓸 필요가 없다. pi, Cordis, Rollup은 모두 합성 방식(병렬·첫 결정·체인)을 확장이 아니라 호스트의 지점 선언이 정한다. 이벤트모드·실패정책·재생규칙은 사라지고 예산만 구동 권한 하나에 남는다.
2. [원문] pi의 겉 복잡도는 이벤트 41개지만(`EXT/types.ts:1377-1409`), 실제 개입 규칙은 결과를 돌려받는 약 19개 지점에 있고 나머지 약 22개는 관찰 전용이다. 합성 규칙은 `runner.ts`의 `emit*` 메서드 14개에 각각 하드코딩되어 있다. 문서가 규칙을 한곳에 선언하지 않는 것이 복잡도의 원천이다.
3. [원문] pi는 "확장이 루프를 구동"하는 1급 연산이 없다. 경로는 (a) `turn_end`/`agent_before_settle`의 `continue:true` 1회 요청, (b) 명령 핸들러 안의 `waitForIdle()` + `sendUserMessage()`, (c) 별 프로세스 spawn 예제뿐이다. 이 빈칸이 Helm의 5단계 "구동"이 pi 위에 새로 얹어야 할 유일한 부분이다.
4. [추측] 원시 연산을 줄이는 길은 둘로 갈린다. (가) 모드를 지점 타입에 넣고 동사를 `on/post/drive/scope`로 줄이기(pi 호환 높음), (나) 모든 것을 `wrap(joint, next)` 하나로 접기(가장 작지만 재생·토글 보장이 약함), (다) 핸들러는 결정만 반환하고 구동을 Command를 내는 순수 reducer로 만들기(보장 최강, pi와 가장 멂).
5. [추측] 추천은 안 1(타입 지점 + 3동사)에 안 3의 "구동은 턴 경계마다 재호출되는 상태 기반 함수, 동작은 데이터로 반환" 규율을 합치는 것이다.

## 1. pi의 확장 API: 철학과 실제 형태
### 1.1 철학 [원문]
- 소개 문장이 "Pi is a minimal, extensible agent harness that you can make your own" (`PI/../README.md:15`, 저장소 루트 README). 코어는 작게, 나머지는 확장·스킬·템플릿·패키지로 둔다.
- 확장은 "default factory가 `ExtensionAPI`를 받아 등록한다"가 전부다 (`docs/extensions.md:15-30`, `EXT/types.ts:2017` `ExtensionFactory = (pi) => void | Promise<void>`). 선언 객체도 매니페스트도 없다.
- 확장은 프로세스 안에서 같은 OS 권한으로 돈다. 샌드박스를 약속하지 않는다 (`docs/extensions.md:5`). 단순함의 대가로 격리를 포기했다.
- 사용할 통합 지점을 한 표로 안내한다: 관찰·수정은 `pi.on`, 모델 호출 도구는 `registerTool`, `/` 명령은 `registerCommand`, 메시지는 `sendMessage/sendUserMessage`, 비컨텍스트 저장은 `appendEntry`, 확장 간 통신은 `pi.events` (`docs/extensions.md:71-88`).
- "각 이벤트가 선언한 결과 타입만 효과가 있다. 모든 반환값이 효과가 있다고 가정하지 말라" (`docs/extensions.md:99`). 즉 합성 규칙은 이벤트별 타입에 묻혀 있다.
- 수명주기 규율: 팩토리에서 프로세스·소켓·타이머를 시작하지 말고 `session_start`에서 시작, `session_shutdown`에서 멱등 정리 (`docs/extensions.md:58-60`). 확장 단위 dispose 훅은 없다.

### 1.2 이벤트와 반환값 [원문]
- 이벤트 41종 (`EXT/types.ts:1377-1409` 합집합; 전체 이름은 `ext/omp/pi-ev.txt`). 분류: 시작·자원 3, 세션 10, 요청·provider 7, 에이전트·턴·메시지 12, 도구 실행 관찰 3, 모델 2, 가로채기 4.
- 결과를 돌려받는 지점(내 집계, 약 19개) [추측: 분류 근거는 `ext/pi-report.md` 4.2절 표]: `tool_call`, `tool_result`, `message_end`, `context`, `context_with_system`, `before_agent_start`, `before_provider_request`, `before_provider_headers`, `turn_end`, `agent_before_settle`, `session_before_switch/fork/compact/tree`, `input`, `user_bash`, `project_trust`, `resources_discover`, `cache_warming_decision`. 나머지 약 22개는 관찰 전용.
- 반환값 형태가 5종뿐이다:
  - 차단: `{block, reason, terminate}` (`EXT/types.ts:1426-1433`). 인자 변경은 반환이 아니라 `event.input` 제자리 수정.
  - 교체(체인): `tool_result`는 `{content, details, structuredContent, isError, usage}` 부분 교체 (`types.ts:1455-1462`), `message_end`는 `{message}` (역할 유지 필수), `context`는 `{messages}`, `before_agent_start`는 `{systemPrompt, message}`.
  - 취소·대행: `session_before_*`의 `{cancel, ...결과}`.
  - 가로채기: `input`의 `transform`/`handled`, `user_bash`의 `{operations}`/`{result}`.
  - 경계 제안: `{entries, continue}` (`BoundaryResult`, `types.ts:994-997`).
- 합성 규칙은 호스트 쪽에 14개 메서드로 흩어져 있다 [원문 grep: `runner.ts`의 `emit*` 14개]:
  - 일반 `emit` (`runner.ts:1089-1119`): 핸들러 순차 await, 예외는 `emitError` 후 계속(fail-open). `session_before_*`만 `cancel`이면 즉시 반환.
  - `emitToolCall` (`runner.ts:1242-1260`): try/catch가 없다. 예외가 전파되어 도구가 실행되지 않는다(fail-closed). 첫 `block`에서 반환하고, 그 전의 마지막 결과가 유지된다.
  - `emitBoundary` (`runner.ts:1029-1087`): 핸들러마다 앞 핸들러가 제안한 entries를 반영해 컨텍스트 미리보기를 재구성하고, 무효 entries는 전체 폐기. `continue`는 마지막으로 정의한 값이 이긴다.
  - 체인류: `emitToolResult`(1183), `emitMessageEnd`(1144), `emitContext`(1298), `emitBeforeProviderRequest`(1361), `emitBeforeAgentStart`(1420).
  - 첫 결정자: `emitUserBash`(1262), `project_trust`(295). 누적: `emitResourcesDiscover`(1474). 마지막 승리: `emitCacheWarmingDecision`(1121).
- 순서: 확장 로드 순서 × 등록 순서, 디스패치 시작 시 스냅샷이라 도중 변경은 영향 없음 (`runner.ts:269-271`, `docs/extensions.md:97`). `pi.on()`이 해제 함수를 돌려준다 (`loader.ts:272-292`).
- 시간 한도는 러너에 없다 (`runner.ts`에 timeout 0건, `ext/pi-report.md` 4.3절).

### 1.3 도구·명령·UI 등록 [원문]
- `registerTool` (`types.ts:1643`): 이름, 설명, TypeBox 스키마, `execute`, `exposure`(direct/model-only/codemode/deferred/hidden), `annotations`, `prepareLoadout` 등 (`docs/extensions.md:129-180`). 도구는 로드 후에도 등록되며 해제는 없다("hidden으로 재등록", `docs/extensions.md:160`).
- 도구 안에서 다른 도구를 부르는 `ctx.executeTool(name,args)`가 같은 검증·`tool_call`·`tool_result` 훅을 지난다 (`docs/extensions.md:148`, `types.ts:368-398`).
- `registerCommand`(1652), `registerShortcut`(1655), `registerFlag`(1664), `registerProvider`(1830), `registerVirtualModel`, `registerMcpServer`, 렌더러 3종. UI는 `ctx.ui`(대화상자·상태·위젯·커스텀 컴포넌트). `ExtensionAPI` 고유 메서드는 내 집계로 약 38개 [원문: `types.ts:1564-1900` 시그니처 추출].

### 1.4 세션 제어와 루프 구동 [원문]
- 메시지 주입: `sendMessage(msg, {triggerTurn, deliverAs: "steer"|"followUp"|"nextTurn"})`, `sendUserMessage(content, {deliverAs: "steer"|"followUp"})`, `appendEntry(customType,data)` (`types.ts:1703-1719`). 스트리밍 중이면 `deliverAs`로 큐 종류를 고른다.
- 상태 변경: `setActiveTools`(1750), `setModel`(1763), `setThinkingLevel`(1772). 컨텍스트: `ctx.isIdle()`, `ctx.signal`, `ctx.abort()`, `ctx.hasPendingMessages()`, `ctx.compact()`, `ctx.shutdown()` (`types.ts:325-367`).
- 명령 전용: `waitForIdle`, `newSession`, `fork`, `navigateTree`, `switchSession`, `reload`. "라이프사이클 핸들러에서 부르면 교착할 수 있어 명령 전용" (`types.ts:401-440`, `docs/extensions.md:215`).
- 하위 루프 `agent`: `Agent`에 `steer()`/`followUp()`/`continue()`/`prompt()` (`AG/agent.ts:299-305, 384, 373`). 큐 모드 `one-at-a-time`/`all` (`AG/types.ts:55`).
- `AgentLoopConfig`의 훅은 10개뿐이다 (`AG/types.ts:193-341`): `convertToLlm`, `transformContext`, `getApiKey`, `finishTurn`, `prepareRequest`, `prepareNextTurn`, `getSteeringMessages`, `getFollowUpMessages`, `beforeToolCall`, `afterToolCall`. 이벤트(`AgentEvent`)는 10종 (`AG/types.ts:516-539`). 확장 41개 이벤트는 이 위에 `AgentSession`이 쌓은 층이다 (`CA/agent-session.ts:652-655`가 `beforeToolCall`/`afterToolCall`을 설치, `:887-898`이 `finishTurn`에 turn_end 경계를 끼움).
- `finishTurn`의 의미: `{action:"end"}`는 큐 폴링 없이 종료, `{action:"continue"}`는 다음 공급자 요청을 정확히 한 번 보장 (`AG/types.ts` `finishTurn` 주석). 호스트가 `canContinue`를 검증하고 불가능하면 오류 보고 후 무시 (`agent-session.ts:874-884`).
- 문서의 경고: "무조건 continuation은 루프할 수 있으니 조건을 지켜라" (`docs/extensions.md:117`). 상한은 호스트가 강제하지 않는다. omp는 같은 훅(`session_stop`)에 상한 8을 호스트가 건다(§2).
- 결론 [추측]: pi에서 확장이 할 수 있는 "구동"은 (1) 경계에서 1회 연장 요청, (2) 명령 핸들러 안의 대기+전송 루프, (3) 도구 안에서 `ctx.executeTool`/`ctx.modelRegistry.streamSimple`로 중첩 호출, (4) 별 프로세스. 확장이 루프의 소유자가 되는 연산(`loop.runTurn`, `agent.spawn`)은 없다. `AgentSession`이 `new Agent`를 직접 만든다 (`CA/sdk.ts:411-446`).
- 서브에이전트는 코어에 없다. 예제 `examples/extensions/subagent/index.ts:346`이 별도 `pi` 프로세스를 `spawn`한다 [원문].

### 1.5 pi가 단순함을 지키는 방식 [추측: 위 사실에서 귀납]
1. 등록은 전부 함수 호출 하나(`pi.on`, `pi.register*`)이고 선언 DSL이 없다.
2. 이벤트 이름이 곧 지점 주소다. 새 개입점이 필요하면 이벤트를 하나 더 만든다(2026-10 기준 breaking 기록 `### Breaking Changes` 절 49개, `ext/pi-report.md` 11.1절). 단순함은 API 모양에서 오고, 안정성은 포기했다.
3. 규칙은 문서가 아니라 반환 타입에 있다. 타입을 읽으면 효과를 안다.
4. 호스트가 부분 고장을 흡수한다: 관찰 지점은 fail-open, 도구 차단은 fail-closed로 이미 구분되어 있다.
5. 부족한 기능은 코어가 아니라 확장으로 푼다(MCP·codemode·tool-search도 내장 확장, `ext/pi-report.md` 2.1절).
- 약점: 지점이 늘수록 `runner.ts` 합성 메서드도 늘고, 확장 개별 on/off와 구동이 없다(실행 중 전체 reload만, `agent-session.ts:3660-3697`).

## 2. oh-my-pi가 pi 위에 더한 확장 기능
- 이벤트: pi 41개 중 12개가 없고 omp에만 있는 것이 약 21개다 [원문: `ext/omp/pi-ev.txt`와 `omp-ev.txt`의 `comm`]. omp에만 있는 이름: `assistant_message`, `auto_compaction_start/end`, `auto_retry_start/end`, `before_subagent_spawn`, `credential_disabled`, `goal_updated`, `mcp_notification`, `plan_review_requested/resolved`, `retry_fallback_applied/succeeded`, `session_before_branch`, `session_branch`, `session_stop`, `session_switch`, `todo_reminder`, `tool_approval_requested/resolved`, `ttsr_triggered`, `user_python`.
- 새 개입 지점(결과 반환형)은 3개뿐이고 나머지는 관찰이다 [원문]:
  - `session_stop` = pi `agent_before_settle`과 같은 계약. `{continue, additionalContext, decision:"block", reason}`로 숨은 연속 턴 1회를 예약한다 (`OMP/extensibility/shared-events.ts:109-120, 491-501`). 호스트가 연속 횟수 상한 `SESSION_STOP_CONTINUATION_CAP = 8`을 강제하되 `decision:"block"`은 제외, 하위 에이전트는 건너뜀 (`OMP/session/agent-session.ts:474, 5407-5445`). 즉 "예산"이 지점 필드가 아니라 호스트 상수다.
  - `assistant_message`: 확정된 어시스턴트 메시지의 텍스트 블록 재작성. 분리 복사본을 받고 `content`를 반환, 체인, 취소 시 중단 (`omp-types.ts:1089-1118, 1495-1506`). pi `message_end`의 "교체 가능" 계약을 omp는 관찰 전용으로 바꾸고 재작성을 별도 지점으로 뺐다(`MessageEndEvent` 주석, `omp-types.ts:1081-1087`) — 같은 지점에 관찰과 변경을 섞는 것을 피한 사례.
  - `before_subagent_spawn`: `{model, block, reason, note}` — 서브에이전트 모델 선택을 바꾸거나 spawn을 거부 (`omp-types.ts:1050-1062, 1543-1552`). 서브에이전트 생성이 코어(task 도구)에 있어 생긴 지점이다.
- 코어로 끌어올린 정책: 도구 선언의 `approval` 티어(read/write/exec)와 모드 4종(always-ask/always-ask-cached/write/yolo) (`docs/approval-mode.md:1-25`). `tool_approval_requested/resolved`는 관찰 이벤트다(`omp-types.ts:1243-1259`). pi가 `tool_call` 훅에 맡긴 승인을 "도구 메타데이터 + 호스트 정책"으로 바꿨다.
- 등록면 확장: `registerComposerShape`(`omp-types.ts:1814`), 파일 쓰기/삭제 fallback, `registerAssistantThinkingRenderer` [원문].
- 확장 체계가 3겹이다: 현행 extension runner, 레거시 hooks(`pi.on` 공유), custom-tools. `docs/hooks.md:7-17`: 기본 런타임은 extension runner 하나만 쓰고 `--hook`은 `--extension` 별칭이며 hook 모듈도 확장 러너에 로드된다. 레거시 pi 확장이 깨지지 않도록 `legacy-pi-*-shim.ts`를 유지 [원문 목록: `OMP/extensibility/`].
- 시사점 [추측]:
  1. 확장 API 모양(`pi.on`/`registerTool`)이 사실상 표준이 되어 포크가 어댑터로 생태계를 이었다. Helm이 pi 호환을 목표로 하면 "이벤트 이름 + 반환 타입" 호환 계층이 현실적인 단위다.
  2. omp가 실제로 필요로 한 것은 구동 연산이 아니라 (a) 종료 직전 연장 + 호스트 상한, (b) 변경 지점의 분리, (c) 정책을 도구 메타데이터로 옮기기였다. 이 셋은 §5의 어느 안에서도 표현 가능하다.
  3. omp도 확장이 루프를 소유하는 1급 연산은 없다. 서브에이전트는 코어 `task` 도구이고 확장은 모델 선택·거부만 한다.

## 3. pi durable의 구동 방식
- 위치: 실험 패키지, "API changes without notice" (`ext/pi-report.md` 0절). coding-agent 확장은 durable 위에서 돌지 않는다.
- 단위 [원문, `DU/README.md:79-100`]: Harness(저장소+실행기), Conversation(트랜스크립트), Entry(불변 레코드), Commit(원자 쓰기), Document(JSON 상태), Task(체크포인트가 있는 상태 기계), Submission(대기 가능한 입력), Extension(이름 붙은 번들), Registry(프로세스가 설치한 확장), Agent(대화별 선택 상태, 이름만 저장).
- 확장은 데이터 객체다: `defineExtension({name, tools, sections, hooks, wraps, tasks})` (`README.md:127-146`). 대화마다 어떤 확장을 쓸지 이름 목록으로 저장하고 기본값은 설치된 전부 (`README.md:146`).
- 훅은 이벤트가 아니라 "내장 Task가 커밋 전에 하는 질문"이다 [원문, `docs/spec.md:2636-2660`]:

| 훅 | 합성 | 일반 throw |
|---|---|---|
| `beforeRequest` | 교체 체인 | 보고 후 계속 |
| `afterResponse` | 전원 관찰 | 보고 후 계속 |
| `onYield` | 첫 연속 요청이 승리 | 보고 후 계속 |
| `beforeTool` | 인자 교체 체인, 첫 block 승리 | 도구 차단(fail-closed) |
| `afterTool` | 결과 교체 체인 | 보고 후 계속 |
| `afterTools` | 전원 관찰 | 보고 후 계속 |
| `beforeCompact` | 첫 결정 승리 | 보고 후 계속 |

- 훅 7개뿐이고 합성·실패 규칙이 표 한 장에 모여 있다. pi의 14개 `emit*`가 하는 일을 durable은 "훅 이름 → 합성 → 실패" 표로 선언한다. 이것이 내가 §5에서 가져오려는 구조다.
- 훅은 커밋 전에 실행되고 "소비 커밋 전에 크래시하면 훅이 다시 실행될 수 있다"(`spec.md:2640-2646`). 결정 고정이 필요하면 `api.memo(name, candidate)`의 first-writer-wins 메모를 쓴다(`spec.md:2663-2680`). 즉 훅은 재실행 가능한 질의라는 계약이다.
- 구동: 확장은 루프 코드를 쓰지 않는다. (1) `onYield`가 `{continue: UserInput}`을 돌려주면 최종 답 뒤에 사용자 메시지가 붙어 런이 이어진다(`README.md:468-472`, `spec.md` 8.3). (2) 사용자 측 `submit({whenBusy: "steer"|"followUp"|"reject"})`와 경계 표 `postTools`/`final`이 큐 배치를 정한다(`README.md:384-402`, `spec.md:2300-2330`). (3) 새 `Task` 정의로 임의 상태 기계를 설치(`tasks`). (4) 서브에이전트는 도구의 `execute` 안에서 자식 대화를 `commit`으로 만들고(`ownership: {kind:"task", taskId}`) `submit(...).wait()` (`README.md:492-537`). 부모 abort가 자식 abort로 전파되고, `background:true` 태스크는 경계가 된다.
- 재생 [원문]: "실행 의도 커밋 → 외부 효과 → 결과 커밋"의 effect sandwich (`spec.md:1917-1935`). 의도 단계에서 재개하면 효과가 이미 일어났을 수 있으므로 단계 핸들러가 안전 재시도 또는 폴링을 한다. 도구는 `replay: "safe"|"unsafe"` 선언. 요청 멱등은 `requestId`.
- 토글·핫스왑 [원문, `README.md:342-352`, `spec.md:3488-3527`]: `registry.install(같은 이름)`이 제자리 교체, 이미 시작한 phase는 옛 코드로 끝나고 다음 phase부터 새 코드. 대화별 선택은 `pi.agent.extensions`에 이름 목록으로 저장. 플랜 모드 예시는 상태를 확장 문서(`defineDoc`)에 두고 `beforeTool`이 문서를 읽어 차단한다 (`spec.md:2743-2760`). 켜고 끄기 = 문서 값 변경(커밋) + 다음 훅 호출에서 반영.
- 제약 [원문]: 비협조적 JS를 프로세스 안에서 강제 종료할 수 없다(`spec.md:5109-5123` 비목표). 격리는 프로세스 경계로 해결해야 한다.
- 시사점 [추측]: durable의 구동은 "코드가 루프를 호출"이 아니라 "상태·큐·훅 반환값으로 루프에 요청"이다. 그래서 재생이 쉽다. 반면 Helm이 원하는 "확장 코드가 `loop.runTurn()`을 호출"은 durable에도 없다. 가장 가까운 것이 사용자 정의 `Task`의 phase 핸들러다.

## 4. 다른 확장 모델: 핵심 원시 연산 수
(수는 "확장 작성자가 알아야 하는 서로 다른 연산 종류"를 내가 센 값이다 [추측]. 모드 같은 변종은 따로 괄호로 둔다.)

### 4.1 Koa / Hono 미들웨어 [기억]
- 원시 1개: `use(async (ctx, next) => ...)`. 같은 함수가 `next()` 전은 요청 단계, 후는 응답 단계다. 차단 = `next()`를 부르지 않음, 변경 = ctx를 고침, 관찰 = 부르고 지나감, 오류 = 위로 throw 전파.
- 얻는 것: 개념 하나로 관찰·차단·변형을 모두 표현. 잃는 것: 병렬 관찰자, 첫 결정 단락 같은 "합성 다양성"이 없고, `next`를 두 번 부르거나 안 부르는 실수가 타입으로 안 막힌다. Cordis는 `next() called multiple times`를 런타임에서 던진다 (`CORDIS/events.ts:131-135`).
- pi와의 차이: pi의 `tool_call`+`tool_result`는 하나의 도구 실행을 감싸는 두 지점이지만 서로 다른 이벤트이고 클로저 상태를 공유하지 못한다. 미들웨어는 한 함수가 전후를 모두 가진다.

### 4.2 Rollup / Vite 플러그인 훅 [외부: rollupjs.org/plugin-development]
- 원시는 "이름 붙은 훅 한 종류"이고, 합성은 훅 이름마다 호스트가 고정한 4종이다: `first`(null 아닌 값이 나올 때까지), `sequential`(체인, 비동기면 대기), `parallel`(비동기를 기다리지 않고 시작), `async/sync` 속성. 예: `resolveId/load` = first, `transform/renderChunk/generateBundle` = sequential, `buildStart/buildEnd/closeBundle` = parallel. 표 24행.
- 확장 쪽 수정자 3개뿐: `order: "pre"|"post"`, `sequential: true`(parallel 훅 중 하나를 단독 실행), `filter`(resolveId/load/transform).
- 핵심: 확장 작성자는 모드를 선언하지 않는다. 훅 이름에 모드가 묶여 있다. `order`가 순서 문제를 확장에게 돌려주는 유일한 구멍이다. pi의 "로드 순서 × 등록 순서"보다 명시적이다.

### 4.3 Cordis [원문, `CORDIS/events.ts`]
- 원시 4종: (1) 리스너 등록 `ctx.on/once(name, fn, {prepend, global})` — 해제 함수를 반환하고 fiber의 effect로 추적되어 플러그인 dispose 시 자동 해제 (`events.ts:142-175`, `fiber.ts:273-342`), (2) 디스패치 5모드, (3) 서비스 `provide`/`inject` (`service.ts:35`, `reflect.ts:202-237`), (4) 플러그인 = fiber 스코프(설정 갱신 `internal/update`로 핫 리로드, `events.ts:62-69`).
- 디스패치 5모드 (`events.ts:14, 95-140`): `emit`(동기 관찰), `parallel`(`Promise.allSettled` 후 AggregateError), `serial`(순차, 첫 truthy 반환), `bail`(동기 첫 결정), `waterfall`(핸들러가 `next`를 받는 Koa형 체인). 이 5개가 현재 안의 이벤트 모드 5종(parallel / any-deny / waterfall / queue / exclusive)과 가장 닮았다. 차이는 모드를 **호출하는 쪽(emit 지점)이 고른다**는 것이다. `on` 호출에는 모드가 없다 (`events.ts:162-175`).
- 서비스는 컨텍스트 경계(isolate)로 가려진다. `ctx.get`은 `inject`를 선언한 플러그인에서만 허용(`reflect.ts:103-112`): 의존 선언이 곧 접근 권한 검사다.
- 시사점 [추측]: 모드 5종은 "그리 많지 않다"는 증거이고, 모드를 확장에게서 호스트로 옮기면 지점 계약의 이벤트모드 필드가 사라진다.

### 4.4 Effect / Layer [기억, 본문 미수신]
- 원시 3개: `Context.Tag`(서비스 인터페이스), `Layer`(스코프 안에서 서비스를 만드는 레시피, `merge`/`provide`로 조합), `Scope`(획득-해제, `acquireRelease`). 훅 개념이 없다. 확장 = 서비스를 다른 Layer로 교체·장식(decorator layer)하는 것.
- 장점: 수명과 의존이 타입에 있어 토글·정리·테스트 교체가 구조적. 단점: 루프 중간 개입("이 도구 호출을 막아라")은 서비스 호출 경로가 전부 Tag를 거쳐야 가능하다. 루프 개입에는 맞지 않고 서비스 층 설계에 맞는다. Helm 확장 지점 모델에서는 `scope`(획득-해제 쌍)만 가져올 가치가 있다 [추측].

### 4.5 OpenAI Agents SDK: hooks와 guardrails [외부+기억]
- guardrail 종류 4: input, output, tool-input, tool-output [외부: 공식 API 색인]. 차단은 `tripwireTriggered`면 전용 예외를 던진다. 입력 guardrail은 `runInParallel`(기본 true)로 "에이전트와 병렬 실행(지연↓, 토큰·도구 실행 선소모 가능)" 또는 "모델 호출 전 차단(비용↓, 지연↑)"을 고른다. 형제 guardrail은 모두 settle된 뒤 throw. 입력은 첫 에이전트만, 출력은 마지막 에이전트만 [외부: guides/guardrails].
- hooks(`RunHooks`/`AgentHooks`): agent_start, agent_end, agent_handoff, agent_tool_start, agent_tool_end 정도의 관찰 이벤트 [기억; 이벤트명 확인 실패]. 변경은 못 한다.
- 구동은 `Runner.run`과 handoff/`asTool` 에이전트 그래프에서 이루어진다 [기억].
- 시사점 [추측]: 관찰(hooks)과 결정(guardrail)을 별개 개념으로 둔다. 또 `runInParallel`은 "결정을 병렬로 둘지 막을지"가 지점 필드로 새어 나온 사례로, 우리가 없애려는 필드와 같은 종류다. 원시 3(관찰, 결정+tripwire, handoff).

### 4.6 Vercel AI SDK middleware, prepareStep, stopWhen [외부]
- 미들웨어 훅 3: `transformParams`(양 경로 공통 파라미터 변경), `wrapGenerate`, `wrapStream` (둘 다 `doGenerate`/`doStream`을 감싸는 onion), 합성 순서는 배열 앞이 바깥 `first(second(model))` [외부: ai-sdk.dev middleware].
- 루프 제어는 선언형 2개: `prepareStep({model, stepNumber, steps, messages...})`가 스텝마다 `{model, messages, activeTools, toolChoice, 샘플링 설정}` 재정의를 반환(messages 재정의는 이후 스텝에 이월), `stopWhen`이 `({steps}) => boolean` 조건(`isStepCount`, `hasToolCall`, `isLoopFinished`, 기본 20스텝)을 받는다 [외부: agents/loop-control].
- 시사점 [추측]: 루프 소유자는 호스트로 두고, 확장은 "스텝 시작 시 설정 변경(체인)"과 "계속/종료 판정(결정)"만 가진다. 이것이 `Command`를 쓰지 않는 선언형 구동이고 안 3의 최소형이다. 원시 3(wrap, prepareStep, stopWhen).

### 4.7 LangGraph interrupt와 Command [외부: docs.langchain.com/oss/javascript/langgraph/interrupts]
- 원시 2: `interrupt(value)`(throw로 일시정지, 체크포인터가 상태 저장, 호출자에게 `__interrupt__`로 노출), `Command({resume, goto, update})`(resume은 `invoke`에 넣고 goto/update는 노드가 반환).
- 재생 규칙이 **문서화된 계약**이다: 재개하면 노드가 처음부터 다시 실행되므로 interrupt 앞의 부작용은 멱등이어야 하고, interrupt를 같은 순서로 호출해야 하며(재개값은 인덱스로 매칭), interrupt를 bare try/catch로 감싸면 안 된다. 즉 재생 규칙이 타입이 아니라 코딩 규율이다.
- 시사점 [추측]: "구동 = 노드가 Command(goto/update)를 반환"이라는 데이터형 구동의 선례. 재생 보장은 "재실행되어도 안전하게 쓰라"는 규율로 환원된다. durable의 "훅은 재실행될 수 있다"와 같은 계약이다.

### 4.8 Temporal interceptors [외부: docs.temporal.io/develop/typescript/interceptors]
- 원시 1: 메서드별 `(input, next) => result`. 종류는 workflow inbound(실행·Signal·Query), workflow outbound(액티비티 스케줄·타이머), activity inbound, client 등 호스트가 정한 지점별 인터셉터이고 모든 메서드는 선택적이다.
- 재생: 워크플로 코드 자체가 결정적이어야 하고 이벤트 히스토리로 재생한다 [기억]. 인터셉터도 그 결정성 안에 있다.
- 시사점 [추측]: onion(Koa형)을 "관찰 가능한 지점 몇 개"에만 쓰고, 비결정 작업(활동)은 별도 층으로 분리하면 재생 보장이 가능하다는 선례. 지점은 inbound/outbound의 방향 구분이 있다.

### 4.9 비교표 (원시 연산 수)
| 모델 | 원시 연산 | 모드/변종 | 모드를 정하는 쪽 | 구동 표현 | 재생 계약 |
|---|---|---|---|---|---|
| pi 안정 | 구독 1 + 등록 약 10 + 제어 약 8 | 암묵 약 6 (runner 메서드별) | 호스트 코드 | 경계 연장 1회, 명령 안 루프 | 없음(JSONL, 확정 메시지만) |
| pi durable | 훅 7 + Task + Doc + Submission | 표 1장 | 호스트 표 | onYield, Task phase | effect sandwich, memo |
| Koa/Hono | 1 | 없음(onion) | 없음 | 없음 | 없음 |
| Rollup/Vite | 훅 1 종류 | 4 | 호스트 훅 표 | 없음 | 없음 |
| Cordis | 4 | 5 | 호출 지점 | 없음 | 없음 |
| Effect | 3 | 없음 | 해당 없음 | 없음 | 해당 없음 |
| OpenAI Agents | 3 | 병렬/블로킹 필드 | 지점 필드 | handoff 그래프 | 없음 |
| AI SDK | 3 | onion | 해당 없음 | prepareStep+stopWhen | 없음 |
| LangGraph | 2 | 없음 | 해당 없음 | Command | 재실행 규율 |
| Temporal | 1 | 없음 | 호스트 | 해당 없음 | 결정성 |

- 공통 관찰 [추측]: (1) 모드를 확장이 아니라 호스트(지점 선언·호출 지점)가 정하는 시스템이 단순하다. (2) 구동을 코드 호출이 아니라 데이터(Command, prepareStep 반환, onYield 반환)로 표현하는 시스템만 재생 계약이 있다. (3) 원시 연산이 2~4개인 시스템은 대개 "관찰·결정·체인" 세 가지 합성 방식으로 수렴한다.

## 5. 줄인 모델 3안
공통 전제 [추측]:
- 루프의 이음매(joint)는 4개로 본다: `input`(입력 admit), `request`(모델 요청 직전·직후), `tool`(도구 호출 전후), `boundary`(턴 끝·정착 직전). pi의 결과 반환형 19개 지점은 거의 모두 이 4개 중 하나다. 세션 연산(`session_before_*`)은 5번째 종류 `session`으로 둔다.
- 도구·명령·UI·provider 등록은 확장 지점이 아니라 "리소스 등록"이며 현행 pi API를 유지한다. 이 조사는 지점(`on` 계열)과 구동에 한정.
- 현재 안의 5단계 = 관찰/차단/형성/주입/구동. 아래 안 모두 이것을 **동사 또는 반환 타입의 구분**으로 바꾼다.
- Helm = L3 의도 그룹. 한 그룹이 여러 지점·큐·구동을 묶어 하나의 단위로 켜고 끈다고 전제한다.

### 안 1. 타입 지점 + 동사 3개 (`on` / `post` / `drive`) + `scope`
원시 연산 4개:
1. `on(point, fn)` — 지점 `point`가 `Fold`를 선언한다: `tap`(전원 관찰, 오류 격리), `first`(첫 결정이 승리, 오류=거부), `chain`(앞 결과를 뒤가 이어받음, Koa형 `next` 허용). 이것은 Cordis의 emit·parallel / serial·bail / waterfall을 3개로 합친 것이다.
2. `post(item, {when, requestId})` — 입력 큐에 주입. `when`은 `steer`(다음 도구 라운드 뒤), `followUp`(정착 뒤), `next`(경계 뒤 정확히 한 요청).
3. `drive(fn)` — 배타 임대. 그룹당 한 슬롯. 호스트가 `fn(loop, state)`를 경계마다 불러 `loop.turn(input)`/`loop.spawn(spec)`을 허용하고 상한(예산)을 건다.
4. `scope(id, {state})` — 위 등록을 한 단위로 묶고 `enable/disable`을 턴 경계에 적용, 상태 문서와 정리 훅을 제공.

5단계의 표현:

| 현재 단계 | 안 1 표현 |
|---|---|
| 1 관찰 | `on(point)` where `point.fold = tap` |
| 2 차단 | `on(point)` where `point.fold = first`, 반환 `{deny: reason}` |
| 3 형성 | `on(point)` where `point.fold = chain`, 반환 교체 값 또는 `next(변경)` |
| 4 주입 | `post(item, {when})` |
| 5 구동 | `drive(fn)` (슬롯 1개) |

사라지는 필드:
- 강제 수준: 동사와 `Fold`로 읽힌다. 별도 필드 불필요.
- 이벤트 모드: 지점 선언의 `fold`가 되었고 확장이 쓰지 않는다. queue는 `post`, exclusive는 `drive`.
- 실패 정책: `tap`=보고 후 계속, `first`=거부로 환산(fail-closed, pi `tool_call`과 동일 `runner.ts:1242-1260`), `chain`=해당 핸들러만 건너뜀(durable `afterTool` 표와 동일). 규칙 3줄로 흡수.
- 재생 규칙: `tap/first/chain`은 "재실행 가능한 질의"라는 타입 계약(durable `spec.md:2640-2646`), `post`는 `requestId`로 멱등, `drive`는 §재생 참조.
- 예산: `post`의 큐 상한(전역 하나)과 `drive`의 `{turns, tokens, spawns}` 임대 상한으로 축소. 지점별 예산은 없다.

Helm 구동 의사코드 [추측]:

```ts
export const Helm = scope("helm", { state: doc<HelmState>({ phase: "idle", turns: 0 }) }, (g) => {
  // 형성: 단계별 프롬프트 (chain)
  g.on("request", (req, st) => ({ ...req, system: req.system + promptFor(st.phase) }));
  // 차단: 검토 단계는 쓰기 금지 (first)
  g.on("tool.before", (call, st) =>
    st.phase === "review" && isWrite(call) ? { deny: "Helm 검토 단계: 읽기 전용" } : undefined);
  // 관찰
  g.on("tool.after", (r, st) => g.log(r));
  // 주입: 외부 신호를 다음 경계에서 한 번 반영
  g.on("input", (inp, st) => inp.fromTimer ? g.post(inp, { when: "followUp", requestId: inp.id }) : undefined);
  // 구동: 경계마다 호출, 상태는 st에만 둔다
  g.drive(async (loop, st) => {
    while (st.phase !== "done" && loop.budget.turns > 0) {
      const r = await loop.turn({ input: stepPrompt(st) });          // = loop.runTurn()
      st = await g.commit(reduce(st, r));                            // 턴 결과를 상태에 커밋
      if (needsSub(st)) await loop.spawn({ agent: "reviewer", task: st.task }); // = agent.spawn()
    }
  });
});
// 토글: 호스트가 경계에서 적용
runtime.scope("helm").disable();   // 다음 경계에서 drive 반납, on 핸들러 제외
```

재생·토글 보장:
- 토글: `enable/disable`은 요청만 기록하고 호스트가 경계(`turn_end`, 정착 직전)에서 적용한다. 디스패치는 시작 시 핸들러 스냅샷이므로(`runner.ts:269-271`) 한 디스패치 도중 집합이 바뀌지 않는다. `drive` 임대는 `loop.turn()` 사이에서만 반납되고 턴 중간에는 끊기지 않는다. 비활성화 시 임대 반납은 기본 소유자(사용자 입력)로 복귀.
- 재생: `drive` 함수는 "마지막 커밋된 `st`로 재호출 가능"해야 한다는 규율을 계약으로 둔다(LangGraph의 노드 재실행과 같다, §4.7). `loop.turn`의 결과는 엔트리로 커밋되고 `requestId=hash(scope,turnIndex)`로 중복 실행을 막는다. 진행 중 턴이 끊겼다면 호스트가 마지막 커밋된 경계로 되돌려 재호출한다. 클로저 지역변수에 의존하는 `drive`는 재개 불가라는 한계가 있고 이는 타입으로 막지 못한다.

장점:
- 가장 pi 같다. 새 개념이 `post/drive/scope` 3개 단어뿐이고 `on`은 그대로다.
- 모드가 지점 선언에 모여 표 한 장이 된다(durable 7.2의 표와 같은 형태). `runner.ts`의 14개 메서드가 `Fold` 3종으로 수렴한다.
- Helm 요구(구동, 온오프)를 `drive`와 `scope`에서 정면으로 만족.

단점:
- `Fold`가 3종이라 `boundary` 지점의 "entries 제안 + continue" 같은 합성(`emitBoundary`)은 `chain`의 변종으로 억지로 넣거나 4번째 fold가 필요할 수 있다.
- `drive`가 async 함수이므로 재생은 규율에 의존한다. 위반을 컴파일 타임에 못 막는다.
- `drive`와 `post(next)`와 `agent_before_settle continue`가 겹친다. 경량 연장은 `post`, 소유는 `drive`로 구분하는 문서화가 필요하다.

pi 호환 [추측]:
- 높음. `pi.on(이벤트명, fn)`을 `on(point)`로 1:1 매핑하고(지점 이름 = pi 이벤트명 유지), `registerTool/Command/Provider` 등 등록 API는 그대로 두면 pi 확장의 대부분(도구, 명령, `tool_call` 차단, `tool_result` 후처리, 관찰, 상태 `appendEntry`)이 어댑터 없이 올라간다.
- `agent_before_settle`/`turn_end`의 `{entries, continue}`는 경계 지점의 `chain`+`post(next)`로 매핑한다. `sendUserMessage/sendMessage`는 `post`의 별칭.
- 호환되지 않는 부분: 합성 규칙을 선언해 pi의 fail-open/closed 세부(예: `user_bash` 재던지기)를 규칙에 맞춰야 하고, `ctx.newSession/fork/reload` 등 명령 전용 세션 제어는 `loop.*`로 새 이름이 필요하다.
- 추정치: pi 예제 80개(`examples/extensions`) 중 대부분 변경 없이 로드 [추측, 미검증].

### 안 2. 이음매 양파: `wrap(joint, (arg, next) => result)` 하나
원시 연산 4개:
1. `wrap(joint, fn)` — 이음매 5개(`input`, `run`, `request`, `tool`, `session`)를 감싸는 `(arg, next) => result`. 바깥쪽 순서는 `order: "pre"|"post"`로 조정(Rollup 방식).
2. `tap(event, fn)` — 순수 관찰. 오류 격리, 결과 무시, 병렬 가능. wrap으로도 되나 격리·병렬을 위해 분리.
3. `post(item, {when})` — 바깥(타이머·UI·다른 확장)에서의 큐 주입. 안 1과 같다.
4. `scope(id)` — 위 등록의 묶음, 토글, 정리.

5단계의 표현:

| 현재 단계 | 안 2 표현 |
|---|---|
| 1 관찰 | `tap`, 또는 `wrap`에서 `next` 호출 뒤 결과 무변경 |
| 2 차단 | `wrap`이 `next`를 부르지 않고 오류 결과를 반환 |
| 3 형성 | `wrap`이 `arg`를 바꿔 `next(arg')` 하거나 결과를 바꿔 반환 |
| 4 주입 | `post` (또는 `wrap("run")` 안에서 `ctx.post`) |
| 5 구동 | `wrap("run", async (input, next) => ...)`에서 `next`를 0~N회 호출 |

사라지는 필드:
- 강제 수준: 이음매(어디를 감싸는가)와 `next` 호출 방식으로 결정. 별도 필드 없음.
- 이벤트 모드: `tap`(병렬) 외에는 전부 체인(양파) 하나라서 모드 자체가 하나로 소멸. any-deny는 순차 양파로 대체(앞 wrap이 거부하면 뒤는 호출되지 않음).
- 실패 정책: 양파의 기본인 "throw는 바깥으로 전파"가 fail-closed, `tap`만 fail-open. 필드 불필요.
- 재생 규칙: 이 안에서 가장 약한 곳. `await next()` 앞뒤가 한 함수라 중간 클로저를 재개할 수 없으므로, "wrap은 상태 없이 `scope.doc`만 쓴다"는 규율로 환원된다.
- 예산: `wrap("run")` 안에서 `next`를 몇 번 부를지 자체가 예산이라 호스트는 `reenter` 한도만 건다.

Helm 구동 의사코드 [추측]:

```ts
export const Helm = scope("helm", { state: doc<HelmState>(init) }, (g) => {
  g.wrap("tool", async (call, next) => {                       // 차단 + 관찰
    const st = g.state();
    if (st.phase === "review" && isWrite(call)) return toolError("Helm 검토 단계: 읽기 전용");
    const r = await next(call);                                 // 관찰/후처리
    return g.state().redact ? redact(r) : r;
  });
  g.wrap("request", (req, next) => next({ ...req, system: req.system + promptFor(g.state().phase) }));
  g.wrap("run", async (input, next, ctx) => {                   // 구동: 가장 바깥 슬롯
    let st = g.state(), out;
    while (st.phase !== "done" && ctx.budget.turns > 0) {
      out = await next(stepPrompt(st), { reenter: true });      // = loop.runTurn()
      st = await g.commit(reduce(st, out));
      if (needsSub(st)) await ctx.spawn({ agent: "reviewer", task: st.task });
    }
    return out;
  }, { order: "pre", exclusive: true });
});
```

재생·토글 보장:
- 토글: 이음매 호출 시점에 활성 wrap 목록을 스냅샷하므로(Koa `compose`가 호출마다 체인을 만든다 [기억]) 이음매 단위로 일관. `run` 이음매는 한 런 전체를 감싸 길기 때문에 턴 경계 토글에는 `run` wrap이 `next` 사이에서 `scope.enabled`를 확인하는 규율이 필요하다.
- 재생: Temporal식 이벤트 히스토리 없이 클로저를 되살릴 수 없으므로 재개 시 `run` wrap을 처음부터 다시 호출하고 `st`에서 이어간다. 안 1의 `drive`와 사실상 같은 규율이 된다.

장점:
- 연산이 가장 적다. 사실상 `wrap`과 `tap` 둘. Koa·Hono·AI SDK(`wrapGenerate`)·Temporal의 멘탈 모델과 같아 외부 사용자에게 설명이 필요 없다.
- 전후가 한 함수라 도구 실행 시간 측정·재시도·캐시처럼 전후를 공유하는 확장이 자연스럽다(pi는 `tool_call`/`tool_result`가 분리되어 `toolCallId`로 클로저 맵을 만들어야 한다).
- 구동이 "가장 바깥 wrap"이라는 한 문장으로 설명된다.

단점:
- `next` 호출 자유도가 크다. 안 부르는 실수, 두 번 부르는 실수, `await` 누락이 확장이 루프를 멈추거나 이중 실행하게 만든다(Cordis가 런타임 검사를 두는 이유, `events.ts:131-135`).
- 병렬 관찰자·첫 결정 단락·누적(`resources_discover`) 같은 pi 합성이 양파에 안 맞아 `tap` 외에 우회가 필요하다.
- 감사성: 어떤 확장이 차단했는지, 몇 번 구동했는지가 코드 흐름 안에 숨는다. "L3 그룹이 코드 수준에서 강제 제어" 요구에서는 이것이 장점(자유)이자 단점(통제 불가).

pi 호환 [추측]:
- 중간. 관찰 이벤트 약 22개는 `tap`으로 그대로. 결과 반환형 19개 중 `tool_call`+`tool_result` 쌍은 `wrap("tool")`로 접는 어댑터가 필요하고(이벤트 2개 → 핸들러 2개 → 하나의 양파), `context`/`before_provider_request`/`before_agent_start`는 `wrap("request")`로, `turn_end`/`agent_before_settle`의 `{entries, continue}` 합성은 `wrap("run")` 후행으로 옮겨야 해서 어댑터가 얇지 않다 [추측: 어댑터 규모는 코드 미작성].
- 기존 pi 확장이 `tool_call`에서 `event.input`을 제자리 수정하는 관례는 양파에서는 `next(call')`로 바뀐다.

### 안 3. 결정은 데이터로 반환, 구동은 Command를 내는 상태 기계
원시 연산 5개:
1. `observe(point, fn)` — 관찰. 결과 무시.
2. `decide(point, fn) → Decision` — 지점별 `Decision` 타입(데이터)을 반환. 호스트가 접는다. `next`가 없다.
3. `Command` 합 타입 — `{post}`, `{turn}`, `{spawn}`, `{stop}`, `{set}`. 이것을 반환·실행하는 것이 주입과 구동이다.
4. `drive(reduce)` — `(state, event) => Command[]` 형태의 배타 슬롯. 호스트가 경계 이벤트(`input`, `turn.end`, `child.done`, `tick`)마다 호출한다. 상태는 `scope.doc`에만 있다.
5. `scope(id)` — 선택 단위. 대화별 이름 목록으로 저장(durable `pi.agent.extensions`와 같다).

5단계의 표현:

| 현재 단계 | 안 3 표현 |
|---|---|
| 1 관찰 | `observe` |
| 2 차단 | `decide` 반환 `{block}` (지점 타입이 `BlockDecision`을 허용할 때만) |
| 3 형성 | `decide` 반환 `{replace}` (지점 타입이 `ReplaceDecision`) |
| 4 주입 | `Command.post` (어느 핸들러·reduce든 반환 가능, 단 지점 타입이 허용하는 경우) |
| 5 구동 | `drive` reduce가 `Command.turn/spawn/stop`을 반환 |

사라지는 필드:
- 강제 수준: **반환 타입이 곧 강제 수준**이다. `observe`는 `void`, `decide`는 `Decision`, `drive`만 `Command.turn/spawn`을 반환할 수 있다. 타입 검사로 "관찰 확장이 구동했다"가 불가능해진다.
- 이벤트 모드: `Decision` 유형마다 접는 규칙이 정해져 있다(`block`=첫 승리, `replace`=체인, `continue`=첫 승리). 지점 정의에 `Decision` 타입만 있으면 된다.
- 실패 정책: 결정이 데이터이므로 "결정 없음 = no-op"이 기본이고, 차단형 `Decision`의 예외만 block으로 환산(durable `beforeTool`과 같음).
- 재생 규칙: `reduce`가 순수 함수이고 `Command`가 `requestId`를 갖는다. 같은 `(state, event)`는 같은 `Command[]`이므로 재생=재호출이다(이벤트 소싱).
- 예산: `Command.turn/spawn`에 `budget` 속성. 호스트가 합산해 거부.

Helm 구동 의사코드 [추측]:

```ts
type HelmEv = { type: "input"; text: string } | { type: "turn.end"; result: TurnResult } | { type: "child.done"; id: string; answer: string };
export const Helm = scope("helm", { state: doc<HelmState>({ phase: "idle", turns: 0 }) }, {
  decide: {
    "tool.before": (call, st) => st.phase === "review" && isWrite(call) ? { block: "Helm 검토 단계: 읽기 전용" } : undefined,
    "request":     (req, st)  => ({ replace: { system: req.system + promptFor(st.phase) } }),
  },
  observe: { "tool.after": (r, st) => log(r) },
  drive(st: HelmState, ev: HelmEv): { state: HelmState; commands: Command[] } {
    switch (ev.type) {
      case "input":    return { state: { ...st, phase: "explore", goal: ev.text }, commands: [{ turn: { input: explorePrompt(ev.text), budget: { turns: 5 } } }] };
      case "turn.end": return st.needsReview
        ? { state: { ...st, phase: "review" }, commands: [{ spawn: { agent: "reviewer", task: st.task, requestId: `rv-${st.turns}` } }] }
        : { state: { ...st, phase: "done" }, commands: [{ release: true }] };                  // 구동 반납
      case "child.done": return { state: apply(st, ev), commands: [{ turn: { input: mergePrompt(ev.answer) } }] };
    }
  },
});
```

재생·토글 보장:
- 토글: `drive`가 경계 이벤트에서만 호출되므로 off는 "다음 경계 이벤트에서 `Command.release`를 호스트가 대신 발행"하는 것으로 정의된다. 턴 중간에 끊기는 경로가 구조적으로 없다. 가장 강한 보장.
- 재생: 재시작 후 마지막으로 커밋된 `(state, 마지막 경계 이벤트)`로 `drive`를 다시 호출하고 결과 `Command`의 `requestId`로 이미 실행된 것을 건너뛴다. durable의 effect sandwich(`spec.md:1917-1935`)와 같은 틀.

장점:
- 구동이 데이터라 감사·로그·테스트·재생이 쉽다. "L3 그룹이 무엇을 시켰는가"가 `Command` 로그에 남는다.
- 강제 수준이 타입으로 검사되어 5필드 중 사실상 전부가 사라진다. 현재 안과 같은 통제력을 더 작은 표면으로 낸다.
- AI SDK `prepareStep/stopWhen`, LangGraph `Command`, durable `onYield`와 같은 계열이라 선례가 많다.

단점:
- pi 같은 느낌에서 가장 멀다. 상태·이벤트 유니온·reducer 모델을 배워야 한다. "진보되지만 심플"에서 심플이 약하다.
- 순수 reducer로는 LLM 호출을 기다리며 병렬 서브에이전트를 조율하는 흐름이 `child.done` 이벤트와 상태 필드로 풀려 길어진다.
- 명령형 pi 확장(`sendUserMessage` + `waitForIdle` 루프, 클로저 상태)은 그대로 못 올린다.

pi 호환 [추측]:
- 낮음~중간. 관찰·`tool_call` 차단·`tool_result` 후처리·도구/명령 등록은 어댑터(`pi.on`→`decide/observe`)로 올릴 수 있다. 제자리 수정(`event.input` mutate)은 `replace` 반환으로 바꿔야 한다.
- 명령형 구동 확장은 불가. 상태가 클로저에 있는 확장은 `scope.doc`으로 옮겨야 한다. 예제 80개 중 UI·도구 중심은 대부분 올라가고 `plan-mode`류는 재작성 [추측, 미검증].

## 6. 안 비교와 추천
| 기준 | 안 1 on/post/drive/scope | 안 2 wrap 하나 | 안 3 decide + Command + reducer |
|---|---|---|---|
| 원시 연산 수 | 4 | 4 (실질 2) | 5 |
| 새로 배울 개념 | post, drive, scope | next 규율 | Command, reducer, 이벤트 유니온 |
| 5필드 소멸 | 4개 소멸, 예산만 drive에 | 4개 소멸, 재생은 규율 | 5개 소멸, 타입 검사 |
| 구동 통제 | 임대 + 상한 | 코드 자유도 큼 | 데이터, 감사 최강 |
| 턴 경계 토글 | 호스트가 경계 적용 | `next` 사이 확인 규율 | 구조적 보장 |
| 재생 | async drive 규율 | wrap 규율(가장 약함) | 순수 reducer + requestId(가장 강함) |
| pi 호환 | 높음(on 1:1) | 중간(tool 쌍 접기) | 낮음~중간 |
| "pi처럼 심플" | 가장 가까움 | 개념은 가장 작음 | 가장 멂 |

판단 근거 [추측]:
- 사용자 요구 둘 중 "심플, pi 같은" 쪽은 안 1이, "L3 그룹이 코드 수준에서 강제 제어·온오프" 쪽은 안 3이 강하다. 안 2는 둘 다 중간이면서 재생이 약하다.
- 결합: 지점은 안 1(`on`+`Fold` 3종)로 가고, `drive`의 계약만 안 3에서 빌려 "`drive(fn)`은 경계 이벤트마다 마지막 커밋된 상태로 재호출 가능한 함수이고 효과는 `loop.turn/spawn`과 `post`로만 낸다(Command와 동치)"로 둔다. 상태 전이가 순수 reducer일 필요는 없고 상태가 `scope.doc`에만 있으면 된다.
- 제품 방향 전환(대화형 런타임 앱, 커널·홈서버 데몬 전제 재검토) 메모 [원문: MEMORY.md] 때문에 크래시 내구성 요구가 약해졌다면, 재생 보장은 "경계에서 커밋된 `st`로 재개" 수준으로 충분해 안 1이 더 알맞다 [추측].

### 6.1 추가로 남는 열린 질문
1. `Fold`를 3종으로 충분히 줄일 수 있는지. pi `emitBoundary`(entries 병합 + continue)와 `resources_discover`(누적)는 `chain`과 `tap`의 변종으로 흡수 가능한지 별도 검토 필요 [미검증].
2. `first`의 오류 환산을 거부로 고정하면 pi의 `user_bash` fail-closed와 일치하지만 `session_before_compact`는 현재 fail-open이다. 지점별 예외 표가 필요한지 [원문: `runner.ts:1089-1119`].
3. 비협조적 확장 코드의 강제 종료는 프로세스 경계 없이 불가(durable 비목표, `spec.md:5109-5123`). `drive` 상한은 협조적 코드에만 유효하다.

## 7. 확인하지 못한 것
- OpenAI Agents SDK의 hooks 이벤트명, Effect/Layer, Koa/Hono의 세부는 본문을 못 받아 [기억]이다. guardrail 실행 모드와 tripwire, AI SDK middleware·`prepareStep`·`stopWhen`, LangGraph interrupt/Command, Rollup 훅 종류, Temporal 인터셉터 종류는 공식 문서를 이번에 읽었다.
- pi 예제 80개의 호환 비율, 어댑터 규모는 추정이며 실제로 올려 보지 않았다.
- `ext/pi-report.md`의 일부 줄 번호와 수치(이벤트 분류, 포크 비교)를 재사용했고, 이번에 직접 확인한 항목은 `types.ts`, `runner.ts`, `agent-session.ts`, `AG/types.ts`, `docs/extensions.md`, `DU/README.md`, `spec.md` 일부, omp `shared-events.ts`/`agent-session.ts`, Cordis `events.ts`다.
