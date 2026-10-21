# Claude Code (Anthropic) F~L2 층 설계 조사

조사일 2026-10-21. 조사 틀: `refs/_template.md`. 표기: [원문] 문서·소스에서 직접 확인, [추측] 추론, [못 확인] 확인 불가.

근거 표기 규칙:
- `D:<페이지>:<줄>` = `scratchpad/ext/claude-code/docs/<페이지>.md` 의 줄 번호. 원문 URL은 `https://code.claude.com/docs/en/<페이지>` (llms.txt 색인에서 `.md` 로 받음).
- `R:` = `scratchpad/ext/claude-code/repo-claude-code/` (github.com/anthropics/claude-code 얕은 복제).
- `PY:` = `scratchpad/ext/claude-code/sdk-py/src/claude_agent_sdk/`, `TS:` = `scratchpad/ext/claude-code/sdk-ts/`, `SRT:` = `scratchpad/ext/claude-code/srt/`.
- `LOG:` = 이 기기의 `~/.claude/projects/*/*.jsonl` 의 키·열거형 값만 본 것. 대화 본문은 읽지 않았다.

## 0. 대상 정보

| 항목 | 내용 |
|---|---|
| 대상 | Claude Code (Anthropic 상용 코딩 에이전트 CLI/데스크톱/VS Code/웹), 그리고 그 위의 Claude Agent SDK |
| 저장소 | https://github.com/anthropics/claude-code (HEAD `a6e289a2`, 2026-10-19, "chore: Update mods/"), https://github.com/anthropics/claude-agent-sdk-typescript (HEAD `b8060fa5`, 0.3.304), https://github.com/anthropics/claude-agent-sdk-python (HEAD `c01a9941`, 0.2.168, 번들 CLI 2.1.304) |
| 버전 | Claude Code 2.1.304 (`R:CHANGELOG.md:3`). SDK TS 0.3.304 는 "Claude Code v2.1.304 와 동등" (`TS:CHANGELOG.md:7`) |
| 라이선스 | claude-code 저장소: "© Anthropic PBC. All rights reserved. Commercial Terms of Service 적용" (`R:LICENSE.md:1`) [원문]. SDK-TS 도 같음 (`TS:LICENSE.md`). SDK-Python 은 `LICENSE` 파일은 MIT 이나 README 는 "Commercial Terms of Service 가 지배한다"고 적고 (`PY:../../README.md:375`) 번들 CLI 는 상용 [원문 — 두 문구가 충돌, 법무 확인 필요]. `@anthropic-ai/sandbox-runtime` 0.0.81 은 Apache-2.0 (`SRT:LICENSE`, `SRT:package.json`) |
| 언어 | CLI 본체는 비공개(TypeScript/Node 계열로 보이나 번들 바이너리, [추측]). 공개 저장소의 mods·plugins 는 TypeScript/Python/Bash. SDK-Python 은 Python 3.10+ (anyio, mcp, jsonschema) |
| 패키지 구성 | (1) `claude` 네이티브 바이너리, (2) Agent SDK = 바이너리를 자식 프로세스로 띄우는 얇은 클라이언트 (TS·Python 모두 네이티브 바이너리 번들, `D:agent-sdk/agent-loop:11`), (3) 공개 저장소: `plugins/`(공식 예제 13종), `mods/`(내장 mod 4종 소스 + 타입 선언 13,440줄), `examples/`(hooks, settings, mdm, gateway) |
| 조사 범위 | 공식 문서 약 70쪽 원문 내려받아 읽음 (hooks, plugins, mods, sub-agents, skills, permissions, permission-modes, sandboxing, memory, checkpointing, sessions, headless, prompt-caching, context-window, agent-view, workflows, agent-teams, mcp, SDK 20쪽, llm-gateway-protocol 등). 공개 저장소 3개 얕은 복제 후 구조·CHANGELOG·mods 타입·ralph-wiggum 훅·SDK-Python 전송/세션 코드 열람 |
| 못 본 것 | (a) CLI 본체 소스: 비공개, minified 번들 역분석은 금지라 안 했다. 내부 구조는 [추측]으로만 표시. (b) SDK-TS 소스: 저장소엔 CHANGELOG·예제뿐(`TS:` 목록). 프로토콜은 SDK-Python 코드로 대신 확인. (c) `claude-code-playground` 의 샘플 mod, marketplace-reference 상세, managed-settings 상세, Desktop/VS Code/웹 전용 동작, 모델 라우팅(자동 폴백) 상세는 훑거나 안 봄. (d) 세션 JSONL 쓰기의 원자성·fsync 여부: 문서에 없음 |
| 안정도 주의 | 문서가 빠르게 변한다. mods 는 v2.1.287 에서 기본 활성화된 신규 기능이고 레퍼런스가 "v2.1.290 기준"이라고 적는다 (`D:plugins/mods/overview:85`, `D:plugins/mods/reference:8`). 훅 `onFailure` 는 v2.1.295 이상 요구. 기능마다 "Requires Claude Code v2.1.x" 주석이 붙는 버전 게이트 방식 |

## 1. 한눈 요약

1. Claude Code 는 오픈소스가 아니다. 소스 라이선스가 "All rights reserved" 라 코드를 가져다 쓸 수 없다. 채택 가능한 것은 문서화된 형식·프로토콜(훅 JSON, SKILL.md, MCP, plugin.json, SessionStore 인터페이스)과 별도 Apache-2.0 패키지(sandbox-runtime)뿐이다.
2. 확장 계층이 두 겹이다. (a) 설정 훅: 33개 이벤트, 5종 핸들러(command/http/mcp_tool/prompt/agent), 프로세스 밖. (b) mods: 같은 프로세스 안의 JS/TS 미들웨어 체인(`on(event, matcher, ($, e, next))`), 이벤트 47종 + 설정 훅 33종을 `classic.*` 로 포함. 강제 수준 1~4를 모두 갖고, 5(구동)는 부분적이다.
3. Agent SDK 는 루프를 "라이브러리 함수"로 노출하지 않는다. `query()` 는 번들 CLI 를 자식 프로세스로 띄워 stdio NDJSON(stream-json)과 제어 프로토콜(control_request)로 구동하는 비동기 제너레이터다. 구동 확장은 `streamInput`·`canUseTool`·훅 콜백·SDK 인프로세스 MCP 서버·`spawnClaudeCodeProcess` 로 한다.
4. 권한은 deny > ask > allow 규칙 + 6개 모드(default/acceptEdits/plan/auto/dontAsk/bypassPermissions) + 훅 + (auto 모드는) 별도 모델 분류기의 다층 구조다. 관리 설정이 최상위이고 어떤 하위 계층도 관리 deny 를 뒤집지 못한다.
5. 세션은 `~/.claude/projects/<cwd 인코딩>/<sessionId>.jsonl` 단일 추가 기록이며, 형식은 "내부용이고 버전마다 바뀐다"고 공식 문서가 못 박는다. 외부 저장은 `SessionStore{append, load}` 어댑터로 미러링한다.
6. 프롬프트 캐시를 일급 설계 제약으로 문서화했다: 접두 일치, 도구 정의 변경·모델 전환·플러그인 MCP 변경은 캐시 무효화, 스킬·플러그인·권한 모드·출력 스타일은 대화 끝에 덧붙여 캐시 유지, 지연 로딩(tool search)으로 도구 목록 고정. 훅(PreModelSwitch, SessionStart 의 `prompt_cache_likely_expired`)까지 이 제약에 맞춰져 있다.
7. 서브에이전트는 별도 컨텍스트·별도 JSONL 트랜스크립트, 결과는 최종 보고 문자열 하나로 반환, 반환 전에 지시문 모방 패턴을 스캔한다. 깊이 3, 동시 20. 포크는 부모의 접두를 그대로 물려받아 캐시를 공유한다.
8. 백그라운드 세션은 감독자(supervisor) 데몬 아래 세션당 프로세스로 돈다. 워크플로(JS 스크립트가 에이전트 수백 개를 조율)는 `Date.now()`·`Math.random()` 을 금지해 결정적 재생으로 재개한다.
9. 고유 약점: 훅은 기본이 fail-open(exit 1·타임아웃은 비차단), 모델은 Claude 계열 전용(API 형식 4종), mods 는 샌드박스 밖, 트랜스크립트는 평문(비밀 포함 가능).
10. 이 대상만의 핵심은 "확장 순서 규칙 + 안전 계층"이다: mod 체인의 tier(prepend/user/append/builtin/core), 내장 `sec-default` 가 조직 정책을 가장 바깥에서 지키는 구조.

## 2. 층별 표

| 층·항목 | 구현 방식 | 근거 | 성숙도 |
|---|---|---|---|
| F 메시지/이벤트 스키마 | SDKMessage 유니온(system init·assistant·user·result·stream_event·compact_boundary 등), stream-json NDJSON | D:agent-sdk/agent-loop:35-45, D:agent-sdk/typescript:1393 | 안정 |
| F 제어 프로토콜 | stdio 위 control_request/response: initialize, interrupt, set_model, set_permission_mode, rewind_files, mcp_*, stop_task, get_context_usage; CLI→SDK 방향 can_use_tool, hook_callback, mcp_message | PY:_internal/query.py:586,640,656,683-865 | 안정(비공식 문서화는 TS 레퍼런스의 Query 메서드) |
| F 도구 스키마 | 내장 도구별 입출력 스키마 문서화, 사용자 도구는 MCP(JSON Schema/zod) | D:agent-sdk/typescript:2992,3733 | 안정 |
| F 세션 로그 | JSONL, 항목 `type` 20여 종, `uuid/parentUuid` 연결, "내부 형식, 버전마다 변경" | D:sessions:247, LOG | 불안정(공식 명시) |
| F 플러그인 매니페스트 | `.claude-plugin/plugin.json`(name만 필수), 표준 디렉터리 레이아웃, `userConfig`, `dependencies` | D:plugins/manifest-reference:120 | 안정 |
| F 설정 | `settings.json` 5단계 병합, 파일 감시로 핫 리로드, 관리 설정 최상위 | D:settings:49 | 안정 |
| F 버전 정책 | 플러그인 version 문자열(semver 검사 없음)·미지정 시 커밋 SHA; 기능별 "Requires v2.1.x"; SDK 는 CLI 버전과 동등 번호 | D:plugins/manifest-reference:188, D:plugins/loading:284 | 안정 |
| L0 샌드박스 | Seatbelt(macOS)/bubblewrap+socat(Linux·WSL2), 네트워크는 로컬 프록시 도메인 허용목록; Bash 류만 대상, 파일 도구·MCP·훅은 밖 | D:sandboxing:36 | 안정(기본 꺼짐) |
| L0 프로세스 모델 | 세션=CLI 프로세스(TUI+엔진). SDK=부모 앱이 자식 CLI를 stdio 로 구동. 백그라운드=감독자 데몬+세션별 프로세스 | D:agent-view:817, PY:_internal/transport/subprocess_cli.py:574 | 안정 |
| L1a 동시성 | 읽기전용 도구 병렬, 변경 도구 직렬; 서브에이전트 동시 20, 깊이 3; 워크플로 에이전트 16(1~256) | D:agent-sdk/agent-loop:186, D:sub-agents:1051, D:workflows:352 | 안정 |
| L1a 취소 | Esc 로 실행 중 도구 취소, SDK interrupt/stopTask, 훅·mod 에 AbortSignal | D:how-claude-code-works:215, D:plugins/mods/reference:353 | 안정 |
| L1a 단계 사이 큐 | 사용자가 도구 실행 중 입력한 메시지는 큐에 쌓이고 해당 도구 호출이 끝나면 같은 턴에서 읽힘; 세션 간 메시지도 도구 호출 사이에 읽힘 | D:how-claude-code-works:215, D:cross-session-messaging:59, LOG(queue-operation enqueue/dequeue/remove) | 안정 |
| L1b 루프 | 프롬프트→응답→도구 실행→반복, 도구 호출 없는 응답에서 종료; max_turns(도구 턴만 셈)·max_budget_usd | D:agent-sdk/agent-loop:14-22,77 | 안정 |
| L1c 모델 게이트웨이 | Claude 전용. 형식: Anthropic Messages / Bedrock InvokeModel / Vertex rawPredict / Foundry. 폴백 모델, 노력(effort) 단계, 캐시 TTL 버킷 | D:llm-gateway-protocol:35-45, D:prompt-caching:263 | 안정 |
| L1d 도구·권한 | 규칙(deny>ask>allow)·모드 6종·PreToolUse/PermissionRequest 훅·canUseTool·auto 분류기·관리 정책 | D:permissions:62, D:agent-sdk/permissions | 안정(auto 는 진화 중) |
| L1e 컨텍스트 조립 | 접두 3층(시스템 프롬프트·프로젝트 컨텍스트·대화), CLAUDE.md+rules+auto memory, system-reminder 덧붙임 | D:prompt-caching:13-30 | 안정 |
| L1e 컴팩션 | 요약 요청(접두 공유), 생존 목록 표, PreCompact 차단, SessionStart(compact) 재주입, 유휴 컴팩션 | D:context-window:1591, D:hooks:3267 | 안정 |
| L1f 영속성 | 로컬 JSONL 추가 기록, resume/continue/fork/branch, 체크포인트(파일 스냅샷), SessionStore 미러 | D:sessions:13-60, D:checkpointing:10-20 | 안정(SessionStore 일부 Alpha) |
| L1f 결과 불명 처리 | 재개 시 "중단된 도구 호출"은 재실행하지 않고 "효과 있었는지 확인하라"고 모델에 알림 | D:sessions:51 | 안정 |
| L1g 서브에이전트 | 마크다운+프론트매터 정의, 독립 컨텍스트, 최종 보고만 반환+스캔, 포크, SendMessage 재개 | D:sub-agents:246-360,985 | 안정 |
| L1g 멀티에이전트 | 에이전트 팀(실험): 리드+팀원, 파일 우편함, 파일 락 태스크 목록; 워크플로(스크립트 조율); 세션 간 메시지 | D:agent-teams:200,243, D:workflows | 실험(팀) / 신규(워크플로) |
| L2 내장 도구 | Read/Edit/Write/NotebookEdit/Glob/Grep/Bash/PowerShell/Monitor/WebFetch/WebSearch/LSP/Task*/Cron*/Skill/Agent/Workflow/AskUserQuestion 등 약 45종 | D:tools-reference:1-60 | 안정 |
| L2 MCP | stdio·HTTP·SSE·WebSocket, 범위 3종(local/project/user), tool search 지연 로딩, elicitation, channels 푸시, 2분 초과 호출 자동 백그라운드 | D:mcp:63-160,441 | 안정 |
| L2 지식·메모리 | CLAUDE.md(+@import, 경로 규칙, 중첩 지연 로드), auto memory(MEMORY.md 200줄/25KB), 서브에이전트별 memory | D:memory:140-166,510-560 | 안정 |
| L2 스킬 | SKILL.md+프론트매터 18필드, 설명만 상시 로드(1,536자 제한)·본문 지연 로드, Agent Skills 공개 규격 | D:skills:378, D:skills:19 | 안정 |
| 확장 점 | 설정 훅·mods·스킬·서브에이전트·MCP·출력 스타일·워크플로·SDK 콜백 | 3절 | 혼합 |

## 3. 층별 상세

### 3.1 F 계약

**메시지/이벤트 스키마** [원문]
- SDK 가 내놓는 스트림은 5개 핵심 타입이다: `SystemMessage`(init, compact_boundary, informational, worker_shutting_down), `AssistantMessage`(콘텐츠 블록 하나당 한 메시지, 같은 응답이면 같은 message ID), `UserMessage`(도구 결과 포함), `StreamEvent`(부분 메시지 켠 경우 원시 API 스트리밍 이벤트), `ResultMessage`(종료, 비용·사용량·session ID) (`D:agent-sdk/agent-loop:35-45`). 그 밖에 훅 수명주기, 작업 알림, 권한 거부 등 관측용 이벤트가 있다.
- CLI 쪽 와이어는 `--output-format stream-json --verbose`, `--input-format stream-json` (`PY:_internal/transport/subprocess_cli.py:574,793`). 같은 stdio 에 일반 메시지와 제어 프레임이 섞여 흐른다. 제어 요청(SDK→CLI): initialize, interrupt, set_model, set_permission_mode, rewind_files, mcp_status, mcp_reconnect, mcp_toggle, stop_task, get_context_usage (`PY:_internal/query.py:683-865`). CLI→SDK 요청: can_use_tool, hook_callback, mcp_message (`:586,640,656`). 훅 콜백은 initialize 때 콜백 ID 로 등록하고 CLI 가 ID 로 호출한다 (`:307-330`) [원문].
- `transcript_mirror` 프레임(`{filePath, entries}`)이 stdout 에 끼어 흐르고 SDK 가 떼어내 SessionStore 에 배치 전달한다 (`PY:_internal/transcript_mirror_batcher.py:1-30`).

**도구 스키마** [원문]
- 내장 도구의 입력·출력 타입이 TS 레퍼런스에 도구별로 정리돼 있다 (`D:agent-sdk/typescript:2992-4200`). 사용자 정의 도구는 MCP 형식이고 SDK 는 인프로세스 MCP 서버(`createSdkMcpServer`, `tool()`)를 제공한다 (`D:agent-sdk/typescript:171-248`). 호출 이름은 `mcp__<서버>__<도구>`. 읽기전용 힌트(`readOnlyHint`)가 병렬 실행 여부를 정한다 (`D:agent-sdk/agent-loop:186`).
- `toolAliases` 옵션으로 내장 도구 이름을 MCP 도구로 바꿔치기할 수 있다(예 `{Bash: 'mcp__workspace__bash'}`) (`D:agent-sdk/typescript` Options 표) [원문].

**세션 로그 형식** [원문+LOG]
- 위치 `~/.claude/projects/<cwd 의 비영숫자를 -로 치환(200자 초과 시 해시)>/<sessionId>.jsonl`, 서브에이전트는 `<sessionId>/subagents/agent-<id>.jsonl` (`D:sessions:243-247`, `D:sub-agents:1163`).
- 공식 문서의 경고: "항목 형식은 Claude Code 내부용이며 버전 간에 바뀐다. 직접 파싱하는 스크립트는 어느 릴리스에서든 깨질 수 있다" (`D:sessions:247`). SDK 도 항목을 "불투명 JSON, 통과시키기만 하라"고 취급한다: 필수 키는 `type`, 선택 `uuid`, `timestamp` 뿐 (`PY:types.py:1892-1905`).
- 이 기기 로그에서 확인한 키 구조(본문 제외): 최상위 `type` 이 `user, assistant, attachment, queue-operation, last-prompt, custom-title, agent-name, mode, system, api-request, api-request-blob, api-request-shape, file-history-snapshot, file-history-delta, cost-state, bridge-session, frame-link` 등으로 섞여 한 파일에 들어간다 (LOG).
  - 메시지 항목 공통 키: `uuid, parentUuid, sessionId, timestamp, cwd, gitBranch, isSidechain, version, entrypoint, slug, userType`. `parentUuid` 로 트리를 이룬다 → 분기(fork)·되감기가 같은 파일 안 포인터 조작으로 가능한 구조 [추측].
  - assistant 항목: `message, requestId, requestedModel, effort, perTurnEffort, apiBlockIndex, wireToolInputs`; `message.content[].type` 은 `text, thinking, tool_use`.
  - user 항목: `toolUseResult, sourceToolAssistantUUID, permissionDecision, promptId, permissionMode, origin, turnOrigin, isMeta`.
  - `system` 항목의 `subtype`: `stop_hook_summary, turn_duration, compact_boundary, local_command, informational, bridge_status`. `attachment.type` 은 `hook_success, total_tokens_reminder, queued_command, environment, deferred_tools_delta, skill_listing, invoked_skills, compact_file_reference` 등 30여 종 → 시스템 리마인더·훅 결과가 모두 대화 로그의 "첨부" 항목으로 남는다.
  - `queue-operation.operation` 은 `enqueue, dequeue, remove` → 단계 사이 큐가 로그에 직접 기록된다.
  - `api-request` 항목은 `base, tail, cacheControl, shapeHash, requestDigest, querySource` 를 가진다 → 요청 접두 해시와 캐시 마커를 로그로 남겨 캐시 디버깅에 쓰는 구조 [추측: 키 이름만 확인].
  - `file-history-snapshot/delta` 가 체크포인트 데이터.
- 보존: 기본 30일 후 청소(`cleanupPeriodDays`), 평문 저장(비밀이 도구 출력으로 섞이면 그대로 기록), `CLAUDE_CODE_SKIP_PROMPT_HISTORY`·`persistSession:false` 로 끌 수 있다 (`D:claude-directory` "Plaintext storage").

**확장(플러그인) 매니페스트** [원문]
- `.claude-plugin/plugin.json`. 필수는 `name` 하나. 매니페스트 자체가 선택이고 없으면 표준 레이아웃을 자동 탐색한다 (`D:plugins/manifest-reference:120`, 4행 요약).
- 필드: 메타(`displayName, version, description, author, homepage, repository, license, keywords, metadata`), 활성화(`defaultEnabled, dependencies`), 구성요소 경로(`skills, commands, agents, hooks, mcpServers, lspServers, outputStyles, workflows, experimental.{themes,monitors,evals}`), `settings`(실효 키는 `agent`, `subagentStatusLine` 둘뿐), `userConfig`, `channels`, `types`(mod 용 .d.ts).
- 경로 규칙: 모두 `./` 시작·플러그인 루트 안·존재해야 함(`..` 탈출 거부). 구성요소별로 기본 위치를 "대체"(commands, agents, outputStyles, workflows)하거나 "추가"(skills)하거나 "병합"(hooks, mcpServers, lspServers)한다 (`D:plugins/manifest-reference` "How each key combines").
- 알 수 없는 최상위 키는 제거+경고, `userConfig`·`channels`·`lspServers`·`monitors` 항목 안의 알 수 없는 키는 오류로 로드 실패(strict). `claude plugin validate` 가 권위 있는 검사기.
- 표준 레이아웃: `skills/<이름>/SKILL.md`, `commands/*.md`, `agents/*.md`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `output-styles/`, `workflows/*.js`, `monitors/monitors.json`, `bin/`(Bash 도구 PATH 에 추가), `settings.json`.
- 이름 규칙: 모든 구성요소는 `플러그인:이름` 으로 네임스페이스. 예약어(`claude-`, `anthropic-` 접두 등) 검사.
- 변수: `${CLAUDE_PLUGIN_ROOT}`(버전마다 바뀜, 상태 쓰기 금지), `${CLAUDE_PLUGIN_DATA}`(업데이트 후에도 유지), `${CLAUDE_PROJECT_DIR}`, `${user_config.KEY}`. `sensitive:true` 옵션은 "플랫폼 보안 자격 저장소"에 저장, 그 외는 settings.json 의 `pluginConfigs` (`D:plugins/manifest-reference` User configuration).
- 의존성: `dependencies: ["name" | "name@marketplace" | {name, marketplace, version}]` (`D:plugins/dependencies`).

**설정 형식** [원문]
- 우선순위(높은 쪽 먼저): 관리 설정 > CLI `--settings` > `.claude/settings.local.json` > `.claude/settings.json` > `~/.claude/settings.json`. 환경 변수는 단계가 아니며 키별로 따로 규칙이 있다 (`D:settings:630-638`). 예외로 일부 보안 키는 관리값보다 엄격한 하위값을 따른다.
- 파일 변경은 감시되어 `permissions`, `hooks` 등 대부분 즉시 반영되고(`ConfigChange` 훅 발생), `model` 등 일부 키는 시작 때 한 번만 읽는다 (`D:settings` "When edits take effect").
- 관리 설정 전달: 파일, MDM, 서버 관리(claude.ai 콘솔), SDK `managedSettings` 옵션(제한만 가능한 필터 통과) (`D:agent-sdk/typescript` Options).

### 3.2 L0 플랫폼

**셸 실행·샌드박스** [원문]
- 샌드박스는 Bash·PowerShell·Monitor 명령과 그 자식만 감싼다. 파일 도구(Read/Edit/Write), WebFetch/WebSearch, 로컬 MCP 서버, 훅, LSP, 상태줄 명령은 샌드박스 밖이다 (`D:sandboxing:23-50`). 네이티브 Windows 는 미지원, WSL2 사용.
- 쓰기는 작업 디렉터리·임시 디렉터리 허용, 읽기는 기본 거의 전체(`~/.ssh` 포함)이며 `denyRead`/`credentials` 로 줄인다. 네트워크는 직접 경로 없음 → 로컬 프록시가 도메인 허용목록 검사 (`D:sandboxing:23-36`).
- 구현은 `@anthropic-ai/sandbox-runtime`(Apache-2.0) (`D:sandboxing:36`, `SRT:package.json`). 샌드박스 실패 시 "샌드박스 밖 재시도" 탈출구(`allowUnsandboxedCommands`)가 있고 권한 프롬프트와 연동.
- 권한 모드와 독립이지만 결합된다: 자동 허용 모드에서는 샌드박스 안 명령은 묻지 않고 실행 (`D:sandboxing` Sandbox modes).

**경로·비밀·알림·파일 감시** [원문]
- 설정 루트 `~/.claude`(`CLAUDE_CONFIG_DIR` 로 변경), 프로젝트 디렉터리 이름은 `CLAUDE_CODE_PROJECT_DIR_NAME` 으로 고정 가능 (`D:sessions` "Name the project directory yourself").
- 비밀: 로그인 자격은 `~/.claude/.credentials.json`, 플러그인 `sensitive` 옵션은 OS 저장소, 훅은 `allowedEnvVars` 에 적힌 환경 변수만 헤더에 보간 (`D:hooks:517`), 하위 프로세스 환경 정리 `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`. 트랜스크립트는 평문.
- 알림: `Notification` 훅(타입별 matcher: permission_prompt, idle_prompt 등)과 `terminalSequence`(OSC 0/1/2/9/99/777·BEL 허용목록만 방출; `/dev/tty` 불가) (`D:hooks:1042-1090`).
- 파일 감시: `FileChanged` 훅(matcher 가 파일명 목록, `watchPaths` 를 SessionStart 가 추가 지정), `CwdChanged`(direnv 용), 설정 파일 감시, `CLAUDE_CODE_PLUGIN_DIR_WATCH` 로 mod 핫 리로드 (`D:hooks:3004-3127`).
- 훅 프로세스는 컨트롤 터미널 없이 새 세션으로 실행 (`D:hooks:722`).

**프로세스 모델** [원문]
- 대화형 `claude` 는 터미널에 묶인 단일 프로세스. 백그라운드 세션(`--bg`, `/background`, 에이전트 뷰)은 "감독자" 백그라운드 서비스가 호스트하고 세션마다 별도 Claude Code 프로세스를 둔다. 상태는 `~/.claude/daemon/roster.json`, `jobs/<id>/state.json`, 로그 `daemon.log`. 비정상 종료 시 감독자가 재시작, 유휴 약 1시간이면 프로세스를 내리고 트랜스크립트로 복원, 감독자 소실 시 세션이 1분 대기 후 종료 (`D:agent-view:815-850`).
- 자동 업데이트 시 감독자가 새 버전으로 재시작하고 `state.json` 은 모르는 필드를 보존해 구버전과 공존 (`D:agent-view:841`). 세션 상태 파일에 "미지 필드 보존" 규칙을 둔 점이 눈에 띈다.
- SDK: 부모 앱 → `claude` 바이너리를 자식으로 spawn(`pathToClaudeCodeExecutable`), 사용자 정의 spawn 함수(`spawnClaudeCodeProcess`)로 VM·컨테이너·원격에서 실행 가능, `startup()`/`prewarm()` 으로 선기동 (예비 프로세스는 대기 중 약 230~260MB) (`D:agent-sdk/typescript:86-170`). 부모 종료 시 자식 정리를 atexit 로 처리 (`PY:_internal/transport/subprocess_cli.py:50-62`).
- 서버-클라이언트 분리: Remote Control(휴대폰·브라우저가 로컬 세션에 연결), 클라우드 세션, `claude mcp serve`(Claude Code 자체를 MCP 서버로) (`D:mcp:1226`). 이 클라이언트 프로토콜 자체는 공개 규격이 아니다 [못 확인].
- 격리: 워크트리(`isolation:"worktree"`, 백그라운드 세션은 편집 전 자동 워크트리 이동), `WorktreeCreate` 훅으로 비 git VCS 대체 (`D:agent-view:549`, `D:hooks:3127`).

### 3.3 L1 코어

#### (a) 태스크 엔진

**동시성** [원문]
- 한 턴에 여러 도구 호출이 나오면 읽기전용 도구(Read, Glob, Grep, 읽기전용 표시 MCP)는 동시에, 상태 변경 도구(Edit, Write, Bash)는 순차 실행한다. 사용자 정의 도구는 기본 순차이며 `readOnlyHint` 로 병렬 허용 (`D:agent-sdk/agent-loop:186`).
- `PostToolBatch` 훅은 병렬 배치 전체가 끝난 뒤 다음 모델 호출 전에 한 번 발생하고, 여기서 루프를 중단하거나 컨텍스트를 주입할 수 있다 (`D:hooks:2336`).
- 서브에이전트 동시 20(`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`), 중첩 깊이 3(`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`) (`D:sub-agents:1051-1081`). 워크플로: 에이전트 동시 16(1~256), 한 호출 4,096개 항목, 실행당 총 1,000 에이전트 (`D:workflows:352`).
- MCP 호출이 2분을 넘으면 자동 백그라운드 작업이 되어 작업 ID 와 완료 알림으로 바뀐다. 서브에이전트·비대화 모드 제외 (`D:mcp:443-460`).

**취소 전파** [원문]
- Esc: 실행 중 도구 호출을 취소하고 큐의 메시지를 이어서 보낸다 (`D:how-claude-code-works:215`). SDK: `interrupt()`(스트리밍 입력 모드만), `stopTask()`, `close()`. 훅 콜백에는 `{signal: AbortSignal}`, mod 에는 `next.signal` 이 전달된다 (`D:agent-sdk/typescript:2297`, `D:plugins/mods/reference` hook function).
- MCP 도구 취소는 서버가 멈춘다는 보장이 없다고 명시: "이미 일부 작업을 했거나 끝낼 수도 있다" (`D:mcp:455`).
- 헤드리스: SIGTERM 으로 실행 중단 가능 (`D:headless:92`).

**스케줄링** [원문]
- 세션 범위 크론(`CronCreate`, `ScheduleWakeup`, `/loop`)은 세션이 열려 있어야 하고 `--resume` 시 복원되며 7일 만료 (`D:scheduled-tasks`). 세션 독립 스케줄은 클라우드 루틴/데스크톱 예약 작업.
- `Stop` 훅 입력에 `background_tasks`, `session_crons` 배열이 들어와 "끝났다"와 "깨어날 작업 대기 중"을 구분한다 (`D:hooks:2740-2760`).

**단계 사이 큐(steering)** [원문]
- 사용자가 응답 중에 친 메시지는 큐에 표시되고, 도구 호출들이 끝나는 즉시 같은 턴 안에서 읽혀 다음 단계 전에 방향이 바뀐다 (`D:how-claude-code-works:215`). 체크포인트는 "턴을 시작하는 프롬프트"에만 생기므로 턴 중간에 보낸 메시지는 자체 체크포인트가 없다 (`D:checkpointing:93`).
- SDK 스트리밍 입력은 같은 큐를 쓴다: 한도(max turns)에 걸린 턴 뒤에 큐에 남은 메시지는 새 턴으로 시작하고 턴 카운트는 리셋, 예산은 누적 (`D:agent-sdk/agent-loop:80`).
- 세션 간 메시지(`SendMessage`): 수신 세션이 활성 턴 중이면 도구 호출 사이에 읽고 유휴면 새 턴을 시작 (`D:cross-session-messaging:59`).

#### (b) 에이전트 루프 [원문]
- 사이클: 프롬프트+시스템 프롬프트+도구 정의+이력 → 응답 → 도구 실행 → 결과를 모델에 → 반복. 한 "턴"은 도구 호출이 있는 왕복 한 번 (`D:agent-sdk/agent-loop:14-30`).
- 종료 조건: ① 도구 호출 없는 응답, ② `max_turns`(도구 사용 턴만 계수), ③ `max_budget_usd`(응답 도착 후 비교, 마지막 응답만큼 초과 가능), ④ 인터럽트, ⑤ 훅의 `continue:false`, ⑥ `PostToolBatch` 차단, ⑦ 사용자 대화 종료 도구 `EndConversation`(훅·deny 규칙 면제).
- `Stop` 훅이 종료를 막고(`decision:"block"` 또는 exit 2) 같은 턴을 이어가게 할 수 있다. 연속 8회 상한(`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`), 도구 호출이 있으면 카운트 리셋. 입력의 `stop_hook_active` 로 재진입 감지 (`D:hooks:2732`). 공식 예제 `ralph-wiggum` 이 이 메커니즘으로 "같은 프롬프트로 끝없이 반복"을 구현한다 (`R:plugins/ralph-wiggum/hooks/hooks.json`, `stop-hook.sh`). `/goal` 은 세션 범위 prompt-훅 Stop 의 내장 단축 (`D:hooks:2722`).
- 스트림 처리: `includePartialMessages` 로 원시 API 이벤트 전달. mod 의 `turn.step` 은 비동기 제너레이터로 스트림을 통과시키며 모델·effort 를 바꾸거나 모델 호출 없이 직접 응답 가능 (`D:plugins/mods/events:214-240`).
- 결정 가능한 실행 보조: `Setup` 이벤트, `--bare`, `initialUserMessage`(SessionStart 훅이 `-p` 첫 입력 공급) (`D:hooks:1388`).

#### (c) 모델 게이트웨이 [원문]
- provider 추상은 없다. 지원은 Claude 계열을 네 가지 와이어 형식으로 접근하는 것뿐: Anthropic Messages(`ANTHROPIC_BASE_URL`), Bedrock InvokeModel, Vertex rawPredict, Foundry/Claude Platform on AWS (`D:llm-gateway-protocol:35-47`). LLM 게이트웨이 호환 가이드가 forward/consume 헤더를 규정(`anthropic-beta`, `cache_control` 마커 등).
- 캐시 마커: 시스템 컨텍스트 중간 삽입 블록에 `cache_control` 을 붙이고, 게이트웨이가 400으로 거부하면 마커를 마지막 대화 메시지로 옮겨 재전송, 마커를 조용히 지우는 게이트웨이는 전량 비캐시 과금 (`D:prompt-caching:36-48`).
- 캐시 TTL 버킷 2종: 주 대화(5분/구독 시 1시간)와 그 외(서브에이전트·워크플로·컴팩션·포크, 5분 기본). `promptCacheTtl`, `subagentPromptCacheTtl`, 서브에이전트 프론트매터 `experimental.cacheTtl` (`D:prompt-caching:263-300`).
- 모델 전환은 캐시를 버리므로 `/model` 은 캐시가 따뜻할 때만 확인을 묻고, `PreModelSwitch`·`PostModelSwitch` 훅이 있다. effort 변경도 일부 모델에서 캐시 보존 (`D:prompt-caching:65-100`).
- 자동 모델 폴백(안전 분류기 걸림 시), `fallbackModel` 옵션, `CLAUDE_CODE_SUBAGENT_MODEL`, 서브에이전트 모델 해석 순서(호출 인자 > 프론트매터 > 환경변수 > 메인) (`D:sub-agents:355-420`).
- 모델 호출 자체를 mod 가 가로챈다: `turn.step`(요청 직전), `model.complete`/`fork`/`classify` API 이벤트.

#### (d) 도구 디스패치·권한 [원문]
- 규칙 평가 순서는 deny → ask → allow, 첫 일치가 결정, 구체성은 무관. 어느 범위(관리/사용자/프로젝트)의 deny 도 다른 범위의 allow 가 못 뒤집는다 (`D:permissions:62`, `D:permissions:727`). 맨 도구 이름 deny(`Bash`)는 도구 정의 자체를 컨텍스트에서 제거.
- 규칙 문법: `Tool`, `Tool(specifier)`, 와일드카드, 입력 파라미터 매칭, `Bash(npm run *)`, `Read(~/secrets/**)`, `WebFetch(domain:…)`, `Agent(Explore)`, `Skill(deploy *)`, `mcp__서버__도구` (`D:permissions:95-215`).
- 모드 6종: `default`(=Manual), `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`. 어떤 모드도 자동 승인하지 않는 항목(명시적 ask 규칙, 사용자 상호작용 필요 도구, 치명 경로 `rm`, 교차 세션 메시징 안전장치 등) 존재 (`D:permission-modes:13-45`).
- auto 모드: 규칙에 안 걸린 행동은 별도 분류기 모델(기본 Sonnet 5)이 사용자 요청과 정합한지 검토. 서버 측 검토(세션 요청에 끼워 처리)가 우선이고 불가하면 자체 요청으로 폴백, 서버가 판정 못 하면 거부 (`D:permission-modes:380-452`). 진입 시 `Bash(*)` 같은 광범위 허용 규칙은 폐기.
- 평가 단계(SDK 문서): ① 훅 → ② deny → ③ ask(→ canUseTool) → ④ 모드 → ⑤ allow → ⑥ canUseTool (`D:agent-sdk/permissions` "How permissions are evaluated"). 훅의 allow 는 deny·ask 규칙을 못 건너뛴다. 훅의 exit 2 는 규칙 평가 이전에 차단 (`D:permissions:602-626`).
- 지연 로딩: MCP 도구 스키마를 기본 지연(tool search)시켜 접두를 고정하고 필요할 때 로드 (`D:mcp:1456`).
- 도구 결과 한도: MCP 출력 25k 토큰 초과 시 파일로 저장 후 경로 참조, 훅 문자열 10,000자 초과도 파일화+미리보기 2,000자 (`D:mcp:1288`, `D:hooks:1042`).
- `PermissionRequest` 훅은 프롬프트 직전 allow/deny 결정, `PermissionDenied`(auto 모드 거부 후 `retry:true`) 가능.

#### (e) 컨텍스트 조립·컴팩션 [원문]
- 접두 3층 순서: 시스템 프롬프트+도구 정의 → 프로젝트 컨텍스트(CLAUDE.md, auto memory, 무범위 rules) → 대화. 앞 층이 바뀌면 뒤 전체가 재계산 (`D:prompt-caching:13-30`).
- 변하는 정보는 모두 대화 끝에 `<system-reminder>` 로 덧붙인다: 파일 변경 알림, 스킬·커맨드 본문, 플랜 모드 지침, 출력 스타일 전환, 훅 `additionalContext` (`D:prompt-caching:202-246`, `D:hooks:1100-1130`). CLAUDE.md 중간 편집은 세션 중 적용되지 않는다(`/clear`·`/compact`·재시작 후).
- CLAUDE.md: 계층(관리/사용자/프로젝트), `@경로` 임포트, `.claude/rules/*.md`(`paths:` 프론트매터로 지연 로드), 중첩 디렉터리 CLAUDE.md 지연 로드, AGENTS.md 지원, 4MiB 한도 (`D:memory:140-166`).
- 컴팩션: 대화 요약 요청을 같은 접두로 보내 캐시를 재사용(따뜻할 때만 저렴), 이후 접두는 새로 만들어진다. 생존 표: 시스템 프롬프트·CLAUDE.md·auto memory 재주입, 최근 읽은 파일 최대 5개 재읽기(5,000토큰 초과는 경로만), 호출된 스킬 본문 재주입(스킬당 5,000·총 25,000토큰 상한), 훅이 넣은 컨텍스트는 요약에 포함, `SessionStart(compact)` 훅 재실행 (`D:context-window:1591-1610`).
- 사용자 개입점: `PreCompact` 훅(차단 가능; 자동 컴팩션이 컨텍스트 한계 오류 복구용이면 차단 시 요청 실패), CLAUDE.md 에 "요약 시 보존할 것" 섹션, 수동 `/compact [지침]`, "여기서부터 요약/여기까지 요약"(rewind 메뉴), 유휴 컴팩션(`idleCompaction`), 서브에이전트별 `autoCompactWindow` (`D:hooks:3267`, `D:checkpointing:25-40`). 요약 내용 자체를 훅이 대체하는 경로는 문서에 없다 [못 확인].
- 이미지·PDF 누적 시 오래된 것부터 배치 제거(그 시점부터 접두 재계산) (`D:prompt-caching:190`).

#### (f) 세션 영속성 [원문]
- 쓰기: 대화형·헤드리스 모두 로컬 JSONL 에 연속 저장. 원자성·fsync·락은 문서에 없다. 같은 세션을 두 터미널에서 재개하면 메시지가 한 트랜스크립트에 뒤섞인다고 명시 → 단일 기록자 가정이 없다 (`D:sessions:212`). 대용량 `-p`/SDK 트랜스크립트는 `CLAUDE_CODE_TRANSCRIPT_LOCAL_GC` 로 잘라낼 수 있고, 디스크 가득 시 메시지가 사라지던 버그가 2.1.304 에서 수정됨 (`R:CHANGELOG.md` 2.1.304) → 쓰기 경로 견고성은 진화 중 [원문 근거로 해석].
- 재개 종류: `--continue`(최근), `--resume [id|이름|경로]`, `/resume`(세션 전환), SDK `continue`/`resume`/`resumeSessionAt`(특정 메시지 UUID까지)/`resumeDropsTurn`/`sessionId` 지정 (`D:sessions:13-30`, `PY:_internal/transport/subprocess_cli.py:649-721`).
- 재개 시 복원: 이력(컴팩션 요약 이후만), 모델, `--agent`, 권한 모드(경로별 규칙표; bypass 는 복원 안 함, plan 은 조건부), 활성 `/goal`, 세션 범위 예약 작업. 복원 안 되는 것: `--mcp-config`, `--settings`, `--plugin-dir`, `--add-dir` 로 준 설정(재지정 필요), 백그라운드 Bash·모니터 (`D:sessions:46-70`).
- 훅 컨텍스트는 재개 시 저장된 텍스트를 재생(재실행 안 함)하므로 시각·SHA 가 낡을 수 있고, `SessionStart` 만 `source=resume|fork` 로 다시 돈다 (`D:hooks:1135`).
- 분기(fork): `/branch [이름]`(같은 프로세스가 새 파일로 전환, "이 세션 동안 허용" 권한 승계), `--continue/--resume --fork-session`(새 프로세스, 권한 재승인), `/fork`(백그라운드 복사), 서브에이전트 포크. 원본 파일은 불변 (`D:sessions:183-212`).
- 체크포인트/되감기: 턴을 시작하는 프롬프트마다 파일 스냅샷, 최근 100개 유지, 약 30일 후 스냅샷 청소. Write/Edit/NotebookEdit 만 추적하고 Bash 로 바꾼 파일·서브에이전트 편집·외부 변경·심볼릭/하드링크는 복구 불가 (`D:checkpointing:10-70`). 되감기 옵션 3종(코드+대화/대화만/코드만)과 요약. 되감기는 이미 캐시된 접두로 돌아가므로 캐시 적중 (`D:prompt-caching:238`). SDK `enableFileCheckpointing` + `rewindFiles(userMessageId, {dryRun})`; 대화는 되감지 않는다 (`D:agent-sdk/file-checkpointing`).
- 부작용 도구 결과 불명 처리: 프로세스가 죽어 결과가 기록되지 않은 도구 호출은 재개 시 재실행하지 않고 "잘렸음"으로 표시해 모델이 효과 여부를 확인하게 한다. `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` 으로 변경 (`D:sessions:51`). 훅의 `defer`(`-p` 모드, 단일 도구 호출 턴만): 도구를 실행하지 않고 `stop_reason:"tool_deferred"` 로 종료, 호출 정보를 `deferred_tool_use` 로 내보내고 나중에 재개 시 훅이 다시 결정 (`D:hooks:2029-2064`). 이것이 사람 승인 대기의 영속 모델이다.
- 외부 저장: `SessionStore{append, load, [listSessions, listSessionSummaries, delete, listSubkeys]}`. 키 `{projectKey, sessionId, subpath?}`. 로컬 파일을 먼저 쓰고 배치로 미러링(`eager`/`batched` 플러시, 500항목·1MiB 임계, 재시도 3회, 실패 시 `mirror_error` 시스템 메시지). 재개 시 `load` 결과를 임시로 구체화해 CLI 에 넘긴다 (`D:agent-sdk/session-storage:19-50`, `PY:_internal/transcript_mirror_batcher.py:24-37`). 항목은 불투명 통과 블롭이라 형식 불안정성을 어댑터가 격리한다. 참조 구현: `InMemorySessionStore`, 예제 s3/redis/postgres (`TS:examples/session-stores`).
- 기타: 세션 이름 붙이기·`tagSession`·`forkSession()`·`listSessions()` SDK 헬퍼 (`D:agent-sdk/typescript:248-430`).

#### (g) 서브에이전트·멀티에이전트 [원문 위주]
- 정의: 마크다운+YAML 프론트매터(`name`, `description` 필수; `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `autoCompactWindow`, `skills`, `mcpServers`, `hooks`, `memory`, `background`, `omitClaudeMd`, `effort`, `isolation`, `color`, `initialPrompt`, `experimental`) (`D:sub-agents:246-300`). 위치 우선순위: 관리 > `--agents` JSON > 프로젝트 > 사용자 > 플러그인. 플러그인 서브에이전트는 보안상 `hooks`, `mcpServers`, `permissionMode` 무시 (`D:sub-agents:239`).
- 실행 모델: 한 세션 안에서 동작하며 자체 시스템 프롬프트(Claude Code 프롬프트 아님)와 자체 컨텍스트를 갖는다. 시작 컨텍스트는 시스템 프롬프트+환경, 위임 메시지, CLAUDE.md(Explore/Plan 제외), git 상태, 프리로드 스킬, 형제 명단. 부모의 이력·출력 스타일·auto memory 는 안 넘어간다 (`D:sub-agents` "Context isolation"). 별도 OS 프로세스인지는 문서에 없다 [추측: 같은 프로세스. 근거 — 문서가 "프로세스"를 말하지 않고 에이전트 팀 표시 모드 기본값이 "in-process"(모든 팀원이 메인 터미널 안에서 실행, `D:agent-teams:100,107`)이고 tmux/iTerm2 분할 창 모드에서는 팀원이 별도 프로세스일 가능성이 있다].
- 도구 제한: 항상 제거되는 도구(AskUserQuestion, Plan 모드 진입/종료 등), 백그라운드는 축소 집합+전체 MCP. 같은 정의가 전·후경에서 다른 도구로 해석될 수 있다 (`D:sub-agents:427-446`).
- 권한 상속: 메인이 bypass/acceptEdits/auto 이면 서브에이전트도 그 모드이며 자체 `permissionMode` 무시. default/dontAsk/plan 이면 자체 값 사용 (`D:sub-agents:593`). 백그라운드의 권한 프롬프트는 메인 세션에 표면화.
- 결과 반환: 최종 보고 문자열 하나가 도구 결과로 돌아가며(중간 도구 호출은 부모 컨텍스트에 안 들어감), 반환 전에 스캔한다: `<system-reminder>`·`Human:` 같은 모방 텍스트에 백슬래시를 끼우고 권한 우회 언급이 있으면 `[harness: subagent output matched instruction-shaped pattern(s)…` 마커 줄을 앞에 붙인다. 내용은 제거하지 않는다 (`D:sub-agents:985-990`). 이 보고는 "사용자의 권한이 없는 서브에이전트 출력"으로 라벨링.
- 재개: `SendMessage` 의 `to` 로 에이전트 ID/이름 지정, 전체 이력 유지. Explore·Plan 은 일회성. `maxTurns` 도달 시 부분 출력+재개 가능 (`D:sub-agents` "Resuming subagents").
- 트랜스크립트: `…/<sessionId>/subagents/agent-<id>.jsonl`, 메인 컴팩션 후에도 유지.
- 포크: 부모의 시스템 프롬프트·도구·모델·이력을 그대로 상속하는 서브에이전트. 첫 요청이 부모 캐시를 읽는다. `/subtask`, Claude 가 자체 시작 가능(기본). 일반 서브에이전트는 접두가 달라 캐시 공유 불가 (`D:prompt-caching:326-340`).
- 예산 연동: SDK `maxBudgetUsd` 는 서브에이전트 지출을 합산하고 한도 도달 시 새 서브에이전트 생성 실패+백그라운드 중단 (`D:agent-sdk/agent-loop:77`).
- 에이전트 팀(실험): 리드 + 팀원(각자 독립 세션), 팀원 간 직접 메시지. 우편함은 `~/.claude/teams/<팀>/inboxes/<이름>.json`, 팀 설정 `~/.claude/teams/<팀>/config.json`, 태스크 목록 `~/.claude/tasks/<팀>/`, 태스크 클레임은 파일 락 (`D:agent-teams:200,243-252`). 우편함 항목은 읽을 때 검증해 형식 위반은 제거.
- 워크플로: Claude 가 쓴 JS 스크립트(`agent()`, `pipeline()`, `parallel()`, `phase()`, `log()`, `args`)를 격리 런타임이 백그라운드로 실행, 중간 결과는 스크립트 변수에 두고 컨텍스트엔 최종 답만 (`D:workflows:288-340`). 재개성: `Date.now()`·`Math.random()`·인자 없는 `new Date()` 를 던지게 해 재실행 시 같은 `agent()` 호출 반복을 보장하고 에이전트 결과를 추적해 일시정지 후 재개 (`D:workflows:330`). 스키마 지정 시 최대 5회 구조화 출력 재시도. 동일 접두 에이전트 팬아웃은 첫 에이전트 응답 시작까지 최대 5초 지연시켜 캐시 공유.
- 세션 간 멀티에이전트: `SendMessage`/`ListAgents`, 수신 허용·승인 설정(`D:cross-session-messaging`).

### 3.4 L2 능력

**내장 도구** [원문, `D:tools-reference:1-60`]
- 파일: Read, Edit, Write, NotebookEdit, Glob, Grep, LSP. 셸: Bash(상태 있는 셸 여부는 확인 안 함), PowerShell, Monitor(백그라운드 감시). 웹: WebFetch(도메인 규칙, 사전 승인 문서 도메인), WebSearch(대화형 200회 상한). 오케스트레이션: Agent, Skill, Workflow, SendMessage, ListAgents, TaskCreate/Update/Get/List/Output/Stop, TodoWrite, CronCreate/Delete/List, ScheduleWakeup, EnterPlanMode/ExitPlanMode, EnterWorktree/ExitWorktree, AskUserQuestion, ToolSearch, WaitForMcpServers, 알림·피드백 계열. `EndConversation` 은 deny 규칙·훅으로 못 막는 특수 도구.
- 편집 안전장치: 보호 경로(`.git`, `.claude` 등)와 치명 경로 `rm` 은 bypass 모드 외엔 자동 승인 안 함 (`D:permission-modes:725-900`).

**MCP 브리지** [원문]
- 전송: HTTP, SSE, stdio, WebSocket. 범위: local(`~/.claude.json`), project(`.mcp.json`, 버전 관리 공유), user. 환경 변수 확장, 관리 MCP 구성, 플러그인 제공 MCP 서버(`plugin:<플러그인>:<서버>`), SDK 인프로세스 서버 (`D:mcp:63-160,461,536`).
- 클라이언트 런타임 v1/v2(MCP TS SDK 1.x/2.0) 선택 `MCP_SDK_GENERATION`. OAuth, 동적 헤더(`headersHelper`), 도구 목록 변경 알림, 자동 재연결, elicitation(훅으로 가로채기 가능), 리소스 `@`참조, 프롬프트→커맨드, `anthropic/maxResultSizeChars`, `requiresUserInteraction` 메타 (`D:mcp`).
- channels: MCP 서버가 세션에 메시지를 푸시(훅·mod 의 주입 수준 4에 해당) (`D:channels-reference`).
- 도구 검색(tool search): 지연 로딩 도구는 이름만 노출, 모델이 검색하면 설명을 받음. 접두 고정이 목적 (`D:prompt-caching:113`).

**지식·메모리** [원문]
- CLAUDE.md = 사람이 쓰는 지시. auto memory = 모델이 쓰는 노트: `~/.claude/projects/<프로젝트>/memory/MEMORY.md`(색인, 앞 200줄 또는 25KB만 시작 시 로드)와 주제 파일(온디맨드 읽기). 네 유형 `user/feedback/project/reference`, 프론트매터에 `modified` 타임스탬프 자동 기록, 트랜스크립트 청소에서 제외, 머신 로컬, 워크트리 공유 (`D:memory:474-560`). (이 사용자의 `MEMORY.md` 구조가 이 설계와 동일하다.)
- 서브에이전트 `memory: user|project|local` 로 `agent-memory/<이름>/` 별도 디렉터리, `MEMORY.md` 앞 200줄/25KB 시스템 프롬프트 주입 (`D:sub-agents` "Memory").
- 메모리 쓰기는 일반 파일 도구로 한다 → 별도 메모리 API 없음. 메모리 색인 한도 초과 시 오류로 재작성 유도.

**스킬** [원문]
- `SKILL.md` + 프론트매터: `name, description, when_to_use, argument-hint, arguments, disable-model-invocation, user-invocable, allowed-tools, disallowed-tools, model, effort, context(fork), agent, background, hooks, paths, shell, metadata, license, compatibility`. 알 수 없는 필드는 무시 (`D:skills:378`).
- 상시 로드는 이름·설명(합쳐 1,536자 제한)뿐이고 본문은 호출 시 사용자 메시지로 주입(캐시 보존). `` !`명령` `` 동적 컨텍스트 주입, `$인자` 치환, 지원 파일 폴더, `context: fork` 로 서브에이전트 실행 (`D:skills:699-850`).
- 범위: 관리/개인/프로젝트/플러그인. 호출자 제어: 모델만/사용자만. `paths` 글롭으로 조건부 활성.
- 개방 규격: Agent Skills(agentskills.io) 필드 6개(name, description, license, compatibility, metadata, allowed-tools)만 쓰면 claude.ai 업로드·Skills API 와 호환 (`D:skills:19`, `D:skills` "Using skill frontmatter outside Claude Code"). 규격 자체의 라이선스는 [못 확인].

### 3.5 확장 지점

강제 수준: 1 관찰, 2 차단, 3 형성, 4 주입, 5 구동. ○ 불가, ● 가능, ◐ 부분.

| 메커니즘 | 1 | 2 | 3 | 4 | 5 | 비고 |
|---|---|---|---|---|---|---|
| 설정 훅 (command/http/mcp_tool) | ● 33 이벤트 | ● 아래 표 | ● `updatedInput`(PreToolUse), `updatedToolOutput`(PostToolUse), SessionStart `CLAUDE_ENV_FILE`·`sessionTitle`·`watchPaths`·`reloadSkills`, WorktreeCreate 경로 | ● `additionalContext`(system-reminder), `initialUserMessage`, Stop 계속, `asyncRewake` | ○ | 프로세스 밖, 병렬 실행 |
| prompt/agent 훅 | ● | ● | ◐ | ◐ | ○ | LLM 이 판정; agent 훅은 실험 |
| mods (`on` 체인) | ● | ● | ● 프롬프트 섹션·도구 설명·모델·effort·세션 행 재작성 | ● `prompt.submit` 컨텍스트, `$.prompt.submit`(턴 시작), `$.session.send` | ◐ | 같은 프로세스, 샌드박스 밖 |
| 스킬/커맨드 | ○ | ○ | ● allowed-tools·model·effort | ● 본문 주입 | ○ | `context:fork` 로 하위 실행 |
| 서브에이전트 정의 | ○ | ○ | ● 도구·모델·권한·훅 | ○ | ○ | |
| MCP 서버 | ○ | ◐ elicitation 응답 | ● 도구 제공 | ● channels 푸시 | ○ | |
| 출력 스타일 | ○ | ○ | ● 시스템 프롬프트 변경 | ○ | ○ | 전환 시 메시지로 전달(캐시 유지) |
| SDK 제어 프로토콜 | ● 메시지 스트림 | ● `canUseTool`, 훅 콜백, interrupt | ● setModel/setPermissionMode/applyFlagSettings/setMcpServers | ● `streamInput` | ● 부모 앱이 `query()` 를 호출·재개·분기 | 루프는 자식 프로세스 안 |
| 워크플로 스크립트 | ○ | ○ | ○ | ○ | ● 스크립트가 `agent()` 를 호출해 흐름 전체 진행 | 서브에이전트 단위만 |

**설정 훅 이벤트 33종과 강제 수준** [원문, `D:hooks:17-60`, 977-1020, 1140-1170]

| 이벤트 | 시점 | 차단(exit 2/결정) | 형성·주입 |
|---|---|---|---|
| SessionStart | 시작·재개·clear·compact·fork | 불가 | additionalContext, initialUserMessage, sessionTitle, watchPaths, reloadSkills |
| Setup | `--init-only` 등 | 불가 | 없음 |
| UserPromptSubmit | 프롬프트 제출 | 가능(프롬프트 폐기) | additionalContext (프롬프트 재작성 불가) |
| UserPromptExpansion | 커맨드 확장 | 가능 | additionalContext |
| PreToolUse | 도구 실행 전 | 가능 (allow/deny/ask/defer) | updatedInput, additionalContext |
| PermissionRequest | 권한 프롬프트 직전 | exit 2 무시, decision 객체로 allow/deny | updatedInput |
| PermissionDenied | auto 모드 거부 | 불가 | retry:true |
| PostToolUse | 도구 성공 후 | 불가(stderr 를 모델에 전달), decision:block 은 사유 추가 | updatedToolOutput, additionalContext |
| PostToolUseFailure | 도구 실패 후 | 불가 | additionalContext |
| PostToolBatch | 병렬 배치 종료 후 | 가능(루프 중단) | additionalContext |
| Notification | 알림 | 불가 | terminalSequence 만 |
| MessageDisplay | 응답 표시 | 불가 | displayContent(화면만 교체) |
| SubagentStart / SubagentStop | 서브에이전트 시작/종료 | Stop 만 가능 | additionalContext |
| TaskCreated / TaskCompleted | 태스크 | 가능(롤백/완료 거부) | |
| Stop / StopFailure | 응답 종료 / API 오류 종료 | Stop 가능 / 불가 | Stop: additionalContext |
| TeammateIdle | 팀원 유휴 | 가능 | |
| InstructionsLoaded | CLAUDE.md·rules 로드 | 불가 | |
| ConfigChange | 설정 변경 | 가능(관리 설정 제외) | |
| CwdChanged / DirectoryAdded / FileChanged | 환경 변화 | 불가 | |
| WorktreeCreate / WorktreeRemove | 워크트리 | 비정상 종료 시 실패 | WorktreeCreate: 경로 반환 |
| PreCompact / PostCompact | 컴팩션 | PreCompact 가능 | |
| PreModelSwitch / PostModelSwitch | 모델 전환 | Pre 가능 | Post: additionalContext |
| Elicitation / ElicitationResult | MCP 입력 요청 | 가능(거절) | action/content |
| SessionEnd | 종료 | 불가 | 예산 1.5초 |

- 핸들러 5종과 기본 타임아웃: command/http/mcp_tool 600초(UserPromptSubmit 등 30초, MessageDisplay 10초), prompt 30초, agent 60초. 같은 이벤트의 훅은 병렬 실행(prompt/agent 는 12개 동시)이므로 설정 훅 사이에 순서 규칙은 없고 결정 충돌 규칙만 있다: PreToolUse `deny > defer > ask > allow`, PreModelSwitch `deny > ask > allow`, Elicitation 은 decline 우선 (`D:hooks:412,1963,3474,3678`).
- 훅 입력 공통 필드: `session_id, prompt_id, transcript_path, cwd, scratchpad_dir, permission_mode, effort, hook_event_name`, 서브에이전트 안이면 `agent_id, agent_type` (`D:hooks:730-760`).
- 매처: 문자·숫자·`_`·`-`·공백·`,`·`|` 만이면 정확 일치 목록, 그 외는 JS 정규식(비앵커). `if` 는 권한 규칙 문법 한 개, 도구 이벤트에서만 평가, "best-effort 필터이므로 강한 차단은 권한 시스템으로 하라"고 문서가 경고 (`D:hooks:287,436-452`).
- 실행 형태: 셸 형태(`sh -c`)와 exec 형태(`args` 지정 시 셸 없이 spawn). 플러그인 `${user_config.*}` 는 exec 형태에서만 치환 (셸 재해석 방지).
- 종료 코드 규약: 0 성공(JSON 적용), 2 차단, 그 외 비차단 오류. exit 2 는 JSON 으로 못 뒤집는다. "exit 1 은 정책 훅에 쓰지 말라 — 비차단" 경고가 문서에 있다 (`D:hooks:880`). 타임아웃된 PreToolUse 도 기본은 비차단이고 `onFailure:"block"`(v2.1.295+)으로 fail-closed 가능 (`D:hooks:883,906`).
- 훅 출력 크기: `additionalContext`·`systemMessage`·stdout 은 각 10,000자 상한, 초과분은 파일 저장+경로·미리보기 2,000자 (`D:hooks:1042`).
- 비동기: `async:true`(백그라운드, 타임아웃 미적용), `asyncRewake`(exit 2 로 모델을 깨움).
- 스킬·서브에이전트 프론트매터에도 훅을 둘 수 있다(서브에이전트는 실행 중에만, `Stop`→`SubagentStop` 변환; 스킬은 호출 후 세션 끝까지, `once:true` 지원).
- Python SDK 는 33개 중 10개(PreToolUse, PostToolUse, PostToolUseFailure, UserPromptSubmit, Stop, SubagentStop, PreCompact, Notification, SubagentStart, PermissionRequest)만 노출, TS SDK 는 33개 전부 (`PY:types.py:284-295` vs `D:agent-sdk/typescript:2256-2295`).

**mods (인프로세스 미들웨어)** [원문]
- 구조: 플러그인 안에 `hooks/hooks.json`(`{"modules":["./register.js"]}`) + 훅 모듈이 `export function register(on, options)` 로 핸들러 등록. 핸들러는 `($, e, next)`: `$`=mods API, `e`=깊게 동결된 이벤트, `next`=다음 핸들러(최종적으로 Claude Code 본연 동작). `next(e)` 로 통과, 변경 사본을 넘겨 재작성, `next` 없이 객체를 반환하면 응답(단락) (`D:plugins/mods/events:15-60`).
- 이벤트 47종(계수): 도구 3(`tool.call`, `tool.check`, `tool.describe`), 프롬프트 12(`prompt.submit/fill/suggest/edit/autocomplete/compose/section/context/attachment/mention`, `skill.prompt`, `attribution.text`), 커맨드·설정 4, 턴 3(`turn.start/step/complete`), 세션 9(`session.start/end/compact/receive/send/append/attach/detach/measure`), 서브에이전트 2(`agent.offer/spawn`), UI 10, 다른 mod 2(`plugin.register`, `engine.create`), 텔레메트리 2. 추가로 `classic.<설정 훅 이벤트>` 33종과 mods API 메서드 호출 자체가 이벤트다 (`D:plugins/mods/reference:60-190`, `R:mods/types/claude-code.d.ts`).
- 반환으로 가능한 것: `tool.call` → `next(e)`/`{deny}`/`{result}`(도구 대신 답, 사용자 승인 프롬프트 없음), `tool.check` → `{decision: allow|ask|deny}`(권한 규칙·모드·PreToolUse 이후 단계), `prompt.submit` → 재작성·컨텍스트 추가·`{drop}`, `prompt.compose/section` → 시스템 프롬프트 섹션 목록·텍스트 교체·삭제, `turn.step` → 모델·effort 교체·모델 호출 없이 응답, `session.compact` → `{skip}`, `session.append` → 저장될 행 재작성, `agent.offer` → 서브에이전트 유형 숨김, `agent.spawn` → 모델 선택·`{deny}`.
- mods API(`$`): `ui`, `command`, `tool`(도구 등록 `mcp__<플러그인>__<이름>`), `agent`, `model`(`complete`/`fork`/`classify`, 세션 자격으로 과금, `fork` 는 접두를 재사용해 캐시 적중), `prompt.submit`(유휴 대기 후 새 턴 시작, `asUser` 로 사용자 발화처럼), `turn.abort`, `session`(`messages`, `compact`, `send`, `append`, `usage` 등), `config`, `settings`, `env`, `fs`, `store`(머신 공유 KV 4MiB), `state`, `clock`, `http`, `process`, `mcp`, `audio`, `telemetry` (`D:plugins/mods/reference:190-215`).
- 순서: 이벤트별 하나의 체인, 바깥(먼저 실행) → 안쪽. tier 순서: ① 내장 가드 `sec-default@builtin` + 조직 `prependPlugins` + 조직 소유 mod, ② 사용자 설치, ③ 조직 `appendPlugins`, ④ 기타 내장, 마지막 core. 같은 tier 에서는 매니페스트 `dependencies` 에 적힌 mod 보다 먼저, 한 모듈 안에서는 `on` 호출 순서 (`D:plugins/mods/events:299`). 설정 훅의 PreToolUse 는 관리 설정분이 첫 mod 앞, 그 외는 마지막 mod 의 `next` 이후에 돌고 `tool.check` 는 그 뒤. `next.to(e, tier)` 로 tier 건너뛰기는 prepend/append mod 만 가능.
- 같은 이벤트·같은 matcher 를 두 번 등록하면 로드 실패 (`on("session.start") is registered twice without a matcher`).
- 실패 격리: 던지거나 시간 초과하거나 잘못된 형태를 반환한 핸들러는 건너뛰어지고(fail-open) 다음이 실행됨. `next` 호출 후 실패했으면 그 결과가 유지. fail-closed 를 원하면 `.catch` 핸들러(`next.called`, `next.error.kind`)를 붙인다 (`D:plugins/mods/events:323-335`). 한도: 핸들러 자체 10초(`prompt.edit` 은 50ms), `.catch` 1초, `$.process.run` 30초(최대 10분), `$.model.complete` 기본 1,024 토큰 등 (`D:plugins/mods/reference:353-380`). 사용자 질문 대기(`$.ui.ask`) 시간은 핸들러 시간에 안 셈.
- 재진입 방지: 자기 API 호출로 발생한 이벤트는 같은 핸들러가 `re-entry` 로 건너뜀(`next.error.kind`).
- 켜고 끄기: 플러그인 단위 enable/disable(`/plugin`), `/reload-plugins`(mod 는 즉시 재로드; 로드 실패해도 이전 버전 유지, 2.1.304 수정), `--safe-mode`, `disableAllHooks`(모든 mod·훅), 관리 설정 `allowManagedModsOnly`/`allowManagedHooksOnly`/`disableSideloadFlags` (`D:plugins/mods/overview:75-110`, `D:plugins/mods/reference:353-380`). `--plugin-dir` 는 저장 시 훅 모듈 핫 리로드.
- 신뢰: "mod 는 사용자 권한으로 실행되는 코드이며 샌드박스되지 않는다. 파일·프로세스·네트워크·비밀 환경 변수 접근과 도구 호출 자동 승인이 가능" (`D:plugins/mods/overview:79`). 설치 전 `claude plugin validate` 가 `hooks:`(처리 이벤트)와 `calls:`(사용하는 API) 목록을 정적으로 출력해 능력 선언을 검토하게 한다.
- 권한과의 관계: mod 의 `tool.check` allow 는 관리 설정/조직 로그인 환경에서 기본적으로 deny 규칙·ask 규칙·PreToolUse 차단을 못 뒤집고, 그런 환경이 아니면 뒤집을 수 있다. plan 모드에서는 쓰기 호출을 승인 못 함 (`D:permissions:602-626`). 내장 `sec-default` mod 가 조직 정책 관련 호출(deny 유지, 사용자 tier 의 `tool.register` 거부, 환경 변수 쓰기 거부 등)을 가장 바깥에서 보장한다 (`R:mods/sec-default/hooks/hooks.json`).
- 공개 소스: `R:mods/` 에 `agents-md`(AGENTS.md 로드), `diff`(/diff 창), `sec-default`, `telemetry` 가 실제 내장 기능으로 제공되는 mod 소스(타입 선언 13,440줄 `R:mods/types/claude-code.d.ts`). 즉 Anthropic 자신이 기능 일부를 mod 로 구현한다 (`D:plugins/mods/overview` "Mods built into Claude Code"). 단 소스 사용 권한은 All rights reserved.

**플러그인 설치·갱신·충돌** [원문]
- 마켓플레이스 기반 설치(`name@marketplace`), 캐시된 복사본 로드, 로컬 경로 마켓은 in-place 로드. 자동 업데이트는 첫 메시지 후 최대 10분 지연 랜덤 시점에 디스크만 갱신, 실행 중 세션은 구버전 유지 후 `/reload-plugins` (`D:plugins/loading:272-348`).
- 버전은 매니페스트 > 마켓 항목 > 출처(커밋 SHA 12자 / 아카이브 SHA-256 / `unknown`) 순. `version` 을 고정하면 커밋이 바뀌어도 갱신 안 됨.
- 런타임 토글 비용: 스킬·커맨드·에이전트·훅·모니터·테마는 대화 끝에 덧붙여 캐시 유지, MCP 서버 포함 플러그인은 도구 정의 변화로 접두 무효화(지연 로딩이면 무영향). 전체 재읽기를 유발할 리로드는 경고 후 `--force` 요구 (`D:prompt-caching:145-185`).
- 이름 충돌: 구성요소를 `플러그인:이름` 으로 네임스페이스. 서브에이전트 이름 우선순위(관리 > CLI > 프로젝트 > 사용자 > 플러그인). MCP 서버 이름은 뒤에 선언한 것이 앞을 대체.
- 보안: 프로젝트 폴더의 프론트매터 훅은 워크스페이스 신뢰 대화 승인 후에만 실행. 조직은 허용 마켓·훅·mod 를 제한 (`D:plugins/security`, `D:managed-settings`).

**SDK 가 루프를 노출하는 방식(구동 수준 확장 가능성)** [원문]
- `query({prompt: string | AsyncIterable<SDKUserMessage>, options})` → `Query`(AsyncGenerator + 제어 메서드). 문자열 입력은 단발 모드, AsyncIterable 입력은 스트리밍 입력 모드로 큐·인터럽트·모델/권한 변경을 지원 (`D:agent-sdk/streaming-vs-single-mode:27`).
- 제어 가능한 것: `interrupt`, `setPermissionMode`, `setModel`, `applyFlagSettings`(다음 턴부터 적용되는 키: effortLevel, permissions, hooks, agent 등; 시스템 프롬프트는 불가), `reloadPlugins/Skills/OutputStyles`, `setMcpServers`, `rewindFiles`, `getContextUsage`, `stopTask`, `streamInput`, `close` (`D:agent-sdk/typescript:594-737`).
- 루프 안 개입: 훅 콜백(`HookCallback(input, toolUseID, {signal})`), `canUseTool`, `onElicitation`, `permissionPrompts:'none'`, SDK 인프로세스 MCP 서버(도구가 호스트 프로세스에서 실행), `toolAliases`, `systemPrompt`(커스텀/프리셋+append, 정적/동적 경계 상수로 캐시 분리), `planModeInstructions`, `verbatimPrompts`, `taskBudget`(API 측 토큰 예산 힌트).
- 한계: 루프 본체(모델 호출·도구 디스패치·컴팩션 결정)는 자식 프로세스에 있고 호스트가 단계별로 호출하는 함수가 아니다. 호스트는 비동기 이벤트 스트림을 소비하고 콜백으로 끼어든다. 즉 "루프를 함수로 호출해 흐름 진행"은 `query()` 전체 단위에서만 성립(수준 5는 턴/세션 granularity). 더 낮은 단위(한 스텝만 실행)는 `turn.step` mod 로 모델 호출을 대체하는 방식으로만 가능하다 [추측: 문서에 단계별 실행 API 는 없음].
- 멀티호스트: `SessionStore`, `spawnClaudeCodeProcess`, `resume` 으로 호스트 간 이동. 헤드리스(`-p`): `--output-format json|stream-json`, `--json-schema`, `--max-turns`, `--max-budget-usd`, `--permission-prompt-tool`, `--bare`, `--no-session-persistence` (`D:headless`, `D:cli-reference`).

## 4. 채택 판단

### 4.1 그대로 가져다 쓸 수 있는 것

| 대상 | 경계·라이선스·의존성 | 이유·주의 |
|---|---|---|
| `@anthropic-ai/sandbox-runtime` 0.0.81 | Apache-2.0, npm 패키지, Linux bubblewrap+socat / macOS Seatbelt 필요 (`SRT:package.json`, `D:sandboxing:36`) | L0 샌드박스를 직접 만들지 않아도 된다. 파일·네트워크 정책을 프록시 허용목록으로 구현한 검증된 구현. 버전이 0.0.x 라 API 변동 가능, 호스트 언어가 Node 가 아니면 CLI 래핑 필요 [추측] |
| MCP 프로토콜 자체 | 공개 규격(Claude Code 는 MCP TS SDK 1.x/2.0 사용) | L2 도구 브리지는 MCP 로 통일하면 기존 서버 전부 재사용. 단 Claude Code 의 MCP 확장 메타(`anthropic/maxResultSizeChars`, `requiresUserInteraction`)는 표준 아님 |
| Agent Skills 규격(SKILL.md 6필드) | 규격은 agentskills.io 공개(라이선스는 [못 확인]) | 스킬 자산을 다른 도구와 공유 가능. Claude Code 확장 필드(`context`, `hooks`, `paths` 등)는 비표준이라 코어 호환 모드와 분리 필요 |
| Claude Code 코드·SDK·Agent 번들 바이너리 | 상용 약관 | 채택 대상 아님. "Helm 이 Claude Code 위의 호스트 앱"이 되는 선택지라면 별개 판단 (SDK 약관 충돌은 법무 확인) |

### 4.2 설계만 참고할 것

1. 훅 프로토콜: stdin JSON + exit code(0/2/기타) + stdout JSON(`hookSpecificOutput`, `decision`, `continue`) 규약. 같은 스키마를 지원하면 기존 훅 스크립트와 호환된다. 이벤트 33종 중 코어 후보는 SessionStart/End, UserPromptSubmit, PreToolUse/PostToolUse(+Failure), PostToolBatch, Stop, PreCompact, SubagentStart/Stop, PermissionRequest. 이유: 수준 1~4를 한 스키마로 표현하고, 결정 충돌 규칙(`deny > defer > ask > allow`)과 exit 2 불변 규칙이 명확하다.
2. 미들웨어 체인형 인프로세스 확장(`on(event, matcher, ($, e, next))`): 관찰·재작성·응답(단락)을 `next` 사용 방식 하나로 통일. 이벤트 동결, 타임 버짓, `.catch` fail-closed 모드, tier 순서, 재진입 방지, 능력 선언 정적 검증(`validate` 의 hooks:/calls:) 모두 가져올 가치. 이유: 수준 1~4(+부분 5)를 한 모델로 제공하면서 확장 간 순서 규칙을 명시할 수 있다. 샌드박스되지 않는 점은 Helm 에서 보완 필요.
3. 접두 보존 설계 원칙(프롬프트 캐시): 변동 정보는 대화 끝에 시스템 리마인더로 덧붙이고, 도구 목록은 첫 요청에서 고정해 지연 로딩 도구는 이름만 노출, 스킬·플러그인·모드·출력 스타일 변경은 접두를 건드리지 않음, 모델·effort 전환을 훅 대상으로, 요약 요청은 같은 접두 재사용, 캐시 TTL 을 주 대화/그 외 두 버킷으로 분리, 포크는 접두 상속. 이 목록을 L1c·L1e 요구사항으로 그대로 채택할 만하다.
4. `SessionStore{append, load, …}` 인터페이스: 추가 전용 항목을 불투명 블롭으로 취급해 형식 변경이 어댑터를 안 깨는 계약. 서브에이전트 트랜스크립트는 `subpath` 키. 요약 사이드카를 `append` 안에서 증분 갱신. 이유: F 계약 형식 변화 위험을 격리하는 좋은 경계.
5. 재개 시 비용 인식: SessionStart 입력의 `seconds_since_last_response`, `context_tokens`, `prompt_cache_likely_expired`, `estimated_cache_write_usd` 로 재개 비용을 훅에서 보고. 중단된 도구 호출을 재실행하지 않고 "확인하라"고 모델에 알리는 규약, `defer` 로 사람 입력을 영속 대기.
6. 워크플로 재개성: 비결정 API 금지로 재생 보장, 스키마 지정 출력 재시도, 팬아웃 시 캐시 접두 대기. 서브에이전트 오케스트레이션을 스크립트(수준 5)로 올리는 설계.
7. 권한 계층: 규칙(deny 우선)·모드·훅·관리 정책의 고정 평가 순서와 "어떤 모드도 자동 승인 못 하는 목록". 보호/치명 경로 분리. 관리자 정책 불변 원칙.
8. 서브에이전트 출력 스캔(지시문 모방 패턴에 백슬래시+마커 줄, 내용은 삭제하지 않음)과 "서브에이전트 출력은 사용자 권한이 없다"는 라벨링.
9. 플러그인 레이아웃·`userConfig`(민감값은 OS 보안 저장소)·네임스페이스(`플러그인:이름`)·`${PLUGIN_ROOT}`(버전마다 변함) vs `${PLUGIN_DATA}`(유지) 구분, 의존성 선언, 컴포넌트별 대체/추가/병합 규칙.
10. 감독자+세션당 프로세스 모델과 상태 파일의 미지 필드 보존 규칙(버전 혼재 대비).

### 4.3 피할 것

1. 세션 JSONL 형식 모방·의존: 공식이 불안정하다고 명시, 한 파일에 메시지·첨부·큐 조작·API 요청 블롭·UI 메타(custom-title, mode, bridge-session 등)가 뒤섞여 있음 (LOG). 이유: 로그 자체의 복잡도와 크기. Helm 은 이벤트 로그와 UI 메타를 분리하는 편이 낫다 [의견].
2. 평문 트랜스크립트에 도구 출력 그대로 기록: 비밀 유출 위험이 문서에도 경고돼 있다. 마스킹 계층 필요.
3. 훅의 기본 fail-open(exit 1·타임아웃·시작 실패 시 계속 진행)과 혼동하기 쉬운 종료 코드. 문서가 "정책 훅은 exit 2 를 써라"고 경고할 정도. 기본을 fail-closed 로 하거나 최소한 정책 훅 유형을 구분해야 한다.
4. 훅 병렬 실행 + 순서 없음: 설정 훅 간 순서 보장이 없어 상호 변형(`updatedInput`)을 가진 훅이 충돌하면 결과가 비결정적일 수 있다 [추측: 문서는 병렬 사실과 결정 충돌 규칙만 설명]. 변형 훅은 체인 방식(mod)이 낫다.
5. `if` 필터를 보안 경계로 쓰는 것 (best-effort).
6. mod 같은 비샌드박스 인프로세스 확장을 신뢰 경계 없이 허용하는 것. Claude Code 는 서명·마켓 신뢰·`validate`·조직 정책으로 보완한다. Helm 은 능력 선언을 강제(선언하지 않은 API 호출 거부)하는 쪽이 안전 [의견].
7. 단일 벤더 모델 전제(Claude 전용 와이어 형식 4종): provider 추상이 필요한 Helm 에는 부적합.
8. 같은 세션을 여러 프로세스가 재개할 때 로그가 섞이는 모델(락 없음): 단일 기록자 또는 분기 강제가 낫다.
9. 체크포인트가 Bash·서브에이전트 편집을 추적하지 못하는 한계: 되감기 보장 범위가 좁다. 필요하면 git 스냅샷 같은 파일시스템 수준 기법이 더 견고.
10. 에이전트 팀의 JSON 우편함+파일 락 방식: 실험 단계이며 세션 재개·종료에 알려진 한계가 있다고 문서가 인정.

## 5. 다른 대상과 비교할 때 볼 특징

1. 확장이 "프로세스 밖 설정 훅"과 "인프로세스 mod 체인" 이원 구조이고, mod 가 설정 훅 전체를 `classic.*` 로 포함한다. 두 계층의 실행 순서가 문서로 고정돼 있다(관리 훅 → 첫 mod → … → 마지막 mod → 일반 설정 훅 → `tool.check`).
2. tier 개념(prepend/user/append/builtin/core)과 조직 정책 가드가 내장 mod 로 구현된 점. 확장 간 충돌·순서 규칙이 공개 사양이다.
3. 루프가 라이브러리가 아니라 "자식 프로세스 + 제어 프로토콜"로 노출된다. 호스트 앱은 스트림을 소비하고 콜백으로 개입할 뿐, 단계 단위 구동 API 는 없다. 수준 5는 query 단위(SDK)와 서브에이전트 오케스트레이션 단위(워크플로)로 쪼개져 제공된다.
4. 프롬프트 캐시가 훅·설정·UX(모델 전환 확인, 재개 비용 경고, 유휴 컴팩션)까지 관통하는 일급 설계 제약이다. 캐시 TTL 정책과 접두 공유(포크, 팬아웃 지연)가 문서화된 동작이다.
5. 권한이 규칙+모드+훅+분류기 모델+관리 정책으로 이뤄진 다층 구조이며, auto 모드는 별도 LLM 분류기가 행동을 검토한다(서버 측 검토 우선).
6. 서브에이전트 출력을 신뢰 경계 밖으로 취급하는 스캔, 결과를 최종 보고 문자열 하나로 제한, 포크/비포크 구분이 캐시와 컨텍스트 격리 트레이드오프와 연결돼 있다.
7. 세션 영속성이 파일 JSONL 기반이며 형식은 불안정을 공개적으로 선언, 호스트용 안정 경계는 `SessionStore` 인터페이스와 SDK 헬퍼 함수가 대신 제공한다.
8. 감독자 데몬 + 세션별 프로세스 + 워크트리 격리로 장기 백그라운드 실행을 지원하고, 세션 간 메시징(`SendMessage`)과 에이전트 팀이 같은 기반 위에 있다.
9. 기능 배포가 문서 단위 "Requires v2.1.x" 버전 게이트 + 원격 기능 플래그 + 실험 환경변수(`CLAUDE_CODE_EXPERIMENTAL_*`)의 혼합이다. 계약 안정성 보장 수준이 기능마다 다르다.
10. 도구 호출 결과 불명(프로세스 중단) 처리가 "재실행 금지 + 모델에게 확인 지시"라는 단순 규약이다. 멱등성 키나 2단계 커밋 같은 구조적 해법은 문서에 없다 [못 확인].

## 부록: 내려받은 자료 (모두 새 디렉터리, 코드 실행 안 함)

- `scratchpad/ext/claude-code/docs/` 공식 문서 원문(.md) 약 75쪽 + `llms.txt` 색인
- `scratchpad/ext/claude-code/repo-claude-code/` claude-code 저장소 얕은 복제
- `scratchpad/ext/claude-code/sdk-ts/`, `sdk-py/` SDK 저장소 얕은 복제
- `scratchpad/ext/claude-code/srt/` sandbox-runtime 의 LICENSE, package.json
- 세션 로그는 `jq` 로 키·열거형 값(`type`, `operation`, `subtype`, `attachment.type`, `message.content[].type`, `querySource`)만 집계했고 본문은 읽지 않았다.
