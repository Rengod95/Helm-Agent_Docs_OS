---
id: review.m5-migration
layer: meta
domain: review
kind: spec
status: draft
depends_on: [adr.0023, review.m5-plan, review.m5-profile-project-loader, review.m5-hooks-core-boundary, review.m5-drive-isolation, review.m5-turn-record-metrics, review.m6-craft-flows, L2.mcp.spec, L0.secrets.spec, X.loading-trust.spec, L1.agents.spec, L1.tools.spec, L1.context.spec]
binds: []
---


# 다른 하네스 형식의 제거와 마이그레이션 기능 (M5g)

> **마일스톤 설계 스펙(상태 draft).** 로드맵 M5g의 설계 단계다. 엔진이 읽는 다른 하네스 형식을 없애고, 그 대신 다른 하네스의 설정을 Fresnel 플러그인 초안으로 옮기는 별도 기능을 정한다. 층 스펙(`docs/xeon/<층>/<도메인>/spec.md`)은 이 문서를 구현하는 트랙이 코드와 같은 커밋에서 바꾼다. 이 문서는 층 스펙을 대신하지 않는다.
>
> **이 문서가 바꿀 층 스펙:** `docs/xeon/L2/mcp/spec.md`(§4.2, `.mcp.json` 읽기 제거), `docs/xeon/X/loading-trust/spec.md`(§4.7.2, 폴더 신뢰 자원 표), `docs/xeon/F/wire-settings/spec.md`(`migration.*` 메서드), `docs/xeon/L3/authoring/spec.md`(플러그인 빌더의 맥락 읽기), `docs/xeon/L1/context/spec.md`(지침 파일 이름, M5c가 이미 바꿈). 새 층 스펙은 만들지 않는다.
>
> **원천:** 사용자 결정 2026-11-17(`docs/xeon/decisions/ADR-0023-plugin-profile-core.md` §3.11, `docs/xeon/review/m5-plan.md` M5g 행, R4). 코드 사실은 `cyP 워크트리`(`/Users/user/fresnel-tracks/cyP`)를 읽기 전용으로 확인한 `path:line`이다. 번호는 읽은 시점 값이다. 다른 하네스의 형식은 2026-11-17에 공식 문서에서 읽은 내용이고, 확인하지 못한 곳은 [미확인]으로 적었다. 문서 이름 대응: M5c = `docs/xeon/review/m5/profile-project-loader.md`, M5e = `hooks-core-boundary.md`, 엔진 설계 = `drive-isolation.md`, M5d = `turn-record-metrics.md`, 화면 스펙 = `docs/xeon/review/m6/craft-flows.md`.

초안 1, 2026-11-17. 표지: [결정: 날짜 사용자] 사용자가 정한 것, [제안] 작성자의 설계 선택(사용자가 다르게 정하면 고친다), [미확인] 읽거나 실행해 보지 못한 것, [검증] 공식 문서에서 읽은 것. 이 문서는 사용자 결정을 새로 만들지 않는다. 결정이 없는 곳은 [제안]과 기본값을 적었고 §11에 모았다.

`terms.json`의 금지 표현을 피해 이 문서는 "대화", "Hook"(자리를 가리키는 말은 "위치"), "기능", "시크릿"을 쓴다. 다른 하네스 문서가 부르는 이름(예: `SessionStart`)은 코드 식별자로만 인용한다.

## 1. 목적과 범위

### 1.1 정하는 것

| 묶음 | 내용 |
|---|---|
| 원본 목록 | 처음 지원할 하네스(Claude Code, Codex CLI, Cursor, Gemini CLI, opencode, pi, Cline/Roo)와 공통 관례(AGENTS.md, Agent Skills)의 파일 위치, 형식, 의미 (§3) |
| 매핑표 | 원본의 구성요소마다 Fresnel의 어떤 구성요소가 되는지, 얼마나 같은지, 만들어야 할 것 (§4) |
| 완전한 이식의 정의 | 사용자가 약속받는 것: 항목마다 보고, 조용한 누락 없음, 동작 동등성 검사 (§5) |
| 흐름 | 감지 → 훑기 → 제안 → 초안 → 검토함 → 프로필 배치, 프로젝트 지침 파일의 취급, 다시 돌리기 (§6) |
| 구조 | 패키지, 인터페이스, 데이터로 둔 매핑 규칙, 초안 내보내기, wire, 테스트 대화 사용, 훑기의 샌드박스 (§7) |
| 제거 계획 | 지금 엔진이 읽는 다른 하네스 형식의 `path:line`, 동작 변화, 순서, 옮길 데이터 (§8) |
| 단계와 크기, 수용 기준, 미결 | §9, §10, §11 |

### 1.2 다루지 않는 것

- 다른 하네스 형식을 실행 중에 읽는 호환. 하지 않는다 [결정: 2026-11-16, 2026-11-17 사용자]. 이식은 변환으로 한 번 하고 결과가 검토함을 지난다.
- 원본 파일의 수정이나 삭제. 하지 않는다. 마이그레이션은 원본을 읽기만 한다.
- 다른 하네스에서 Fresnel로 대화 기록을 옮기는 일(과거 대화의 가져오기). 이 문서는 설정과 맞춤 재료(지침, 스킬, 명령, 서브에이전트 정의, Hook, MCP 서버, 권한, 출력 스타일)만 다룬다 [제안].
- 마켓에서 플러그인을 내려받는 일. 훑기는 이미 디스크에 있는 것만 읽는다(네트워크 없음) [제안].
- 플러그인 내보내기와 공유(Later).

### 1.3 결정과 가정

- 엔진은 다른 하네스 형식을 인식하지 않고 플러그인 폴더는 Fresnel 자체 배치만 쓴다 [결정: 2026-11-16, 2026-11-17 사용자]. 지금 엔진이 읽는 루트 `.mcp.json`과 `.agents/skills`는 제거한다 [결정: 2026-11-17 사용자].
- 변환은 "읽기 호환보다 이식을 완전하게 지원하는 방향"이고, Fresnel의 자체 구조를 자유롭게 구성하게 두는 것이 목적이다 [결정: 2026-11-17 사용자]. 사용자는 이것을 "마이그레이션 용 별도 패키지"라고 불렀다.
- 변환의 산출은 모두 플러그인 초안이고 검토함을 지난다. 손으로 고치지 않고, 승인된 검토본이 실행된다 [결정: 2026-11-16, 2026-11-17 사용자](ADR-0023 §3.7).
- 프로젝트 지침 파일은 `AGENTS.md`만 읽는다 [결정: 2026-11-18 사용자]. 마이그레이션에서 프로젝트 범위의 항목은 사용자 플러그인 폴더(`<config>/plugins`)에 넣고 프로젝트 이름의 새 프로필을 제안한다 [결정: 2026-11-18 사용자].
- 패키지 이름, 층 배치, 데이터 모양, 첫 조각은 사용자가 정하지 않았다. 이 문서의 [제안]이다.

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 원본 하네스 | 설정을 옮겨 올 다른 코딩 에이전트(Claude Code 등). 이 문서에서 "원본"은 그 하네스의 파일을 가리킨다 |
| 훑기(scan) | 원본 파일을 읽기만 해서 항목 목록(`SourceItem`)을 만드는 일. 실행하지 않는다 |
| 항목(`SourceItem`) | 훑기가 찾은 구성요소 하나(스킬 하나, Hook 항목 하나, MCP 서버 하나, 설정 키 하나 등) |
| 중간 표현(IR) | 하네스마다 다른 형식을 같은 모양으로 바꾼 것. 매핑 규칙은 IR에서 Fresnel 구성요소로 간다 |
| 제안(`MigrationProposal`) | 항목을 어떤 플러그인 초안들로 묶을지, 어느 프로필에 둘지, 사용자가 정해야 할 것이 무엇인지 |
| 보고서(`MigrationReport`) | 항목마다 한 줄. 정확히 이식, 차이를 두고 이식, 이식하지 못함, 이식 불필요 |
| 감지 | 프로젝트를 열 때 다른 하네스의 표지 파일이 있는지 존재만 확인하는 일. 내용을 읽지 않는다 |
| 이식 불필요 | Fresnel이 직접 읽거나(예: 프로젝트의 `AGENTS.md`) 이미 같은 것이라 옮길 것이 없는 항목 |

Fresnel 쪽 용어는 ADR-0023과 M5c를 따른다: 플러그인, 프로필, Inject / Hook / Drive, 검토함, 검토본, 초안, 테스트 대화, 테스트 실행.

## 3. 원본 목록

각 표는 공식 문서에서 2026-11-17에 읽은 내용이다. URL은 [검증]에 적었다. 읽지 못했거나 문서에 없던 것은 [미확인]이다. 하네스의 형식은 계속 바뀐다(예: opencode는 설정을 V1에서 V2로 옮기는 중이라고 문서가 적는다). 그래서 매핑 규칙은 원본 형식의 버전을 `rulesVersion`으로 보고서에 남긴다(§7.3).

### 3.1 공통 관례: AGENTS.md와 Agent Skills

**AGENTS.md.** 일반 마크다운이고 필수 필드가 없다. 하위 폴더에 두면 가장 가까운 파일이 우선한다. Codex, opencode, Cursor, Gemini CLI, Roo, Cline 등 여럿이 지원한다고 사이트가 적는다. 파일 이름은 정확히 `AGENTS.md`이고 저장소 루트에 둔다. 기존 파일을 옮길 때는 이름을 바꾸고 옛 이름에서 링크를 거는 것을 권한다. [검증] https://agents.md/

**Agent Skills.** 폴더 하나가 스킬이고 `SKILL.md`(YAML 머리말 + 본문)가 필수다. 머리말: `name`(필수, 64자 이하, 소문자·숫자·하이픈, 앞뒤와 연속 하이픈 불가, 폴더 이름과 같아야 함), `description`(필수, 1024자 이하), `license`, `compatibility`(500자 이하), `metadata`(문자열 맵), `allowed-tools`(실험). 선택 폴더 `scripts/`, `references/`, `assets/`. 이름과 설명만 시작할 때 싣고 본문은 쓸 때 싣는다(단계적 공개). 파일 참조는 스킬 루트 기준 상대 경로. [검증] https://agentskills.io/specification

### 3.2 Claude Code

모두 [검증] 공식 문서 https://code.claude.com/docs/en/ 아래 `hooks`, `skills`, `sub-agents`, `mcp`, `memory`, `plugins-reference`, `plugin-marketplaces`, `output-styles`, `permissions`.

| 구성요소 | 위치(사용자 / 프로젝트) | 형식과 의미 |
|---|---|---|
| 지침 | `~/.claude/CLAUDE.md` / `./CLAUDE.md` 또는 `./.claude/CLAUDE.md`, `./CLAUDE.local.md`(개인, git 제외) | 마크다운. 작업 폴더와 그 위 폴더의 파일을 시작 때 싣고(위가 먼저), 하위 폴더의 것은 그 폴더의 파일을 읽을 때 싣는다. `@경로` 가져오기(상대는 그 파일 기준, 재귀 4단계, 코드 구간은 건너뜀). 프로젝트 밖을 가리키는 가져오기와 심볼릭 링크는 승인 대화상자가 뜬다. 조직 관리 `CLAUDE.md`는 제외 불가. 지침이지 강제가 아니다. 저장소의 `AGENTS.md`를 대신 읽을 수 있다(문서가 말한다) |
| 규칙 | `~/.claude/rules/*.md` / `.claude/rules/**/*.md` | 마크다운. 머리말 `paths:`(glob 목록)가 없으면 시작 때 싣고, 있으면 일치하는 파일을 다룰 때 싣는다. 심볼릭 링크를 지원한다 |
| 스킬 | `~/.claude/skills/<이름>/SKILL.md` / `.claude/skills/<이름>/SKILL.md`, 하위 폴더의 `.claude/skills`, 플러그인의 `skills/` | Agent Skills 기본 위에 머리말 확장: `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`(그 턴에 미리 승인), `disallowed-tools`, `model`, `effort`, `context: fork`와 `agent`, `background`, `hooks`(호출되면 등록), `paths`, `shell`. 본문 치환: `$ARGUMENTS`, `$N`, `$이름`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_PROJECT_DIR}`. `` !`cmd` ``는 본문을 보내기 전에 셸로 실행해 출력으로 바꾼다. 설명은 `when_to_use`와 합쳐 1,536자에서 잘린다 |
| 슬래시 명령 | `~/.claude/commands/*.md` / `.claude/commands/*.md` | 스킬과 합쳐졌다(옛 형식이 그대로 동작). 하위 폴더는 이름 공간(`/frontend:component`). 같은 이름이면 스킬이 이긴다 |
| 서브에이전트 | `~/.claude/agents/*.md` / `.claude/agents/**/*.md`, 플러그인의 `agents/` | 머리말 `name`, `description`(필수), `tools`, `disallowedTools`, `model`(별칭 또는 전체 이름 또는 `inherit`), `permissionMode`, `maxTurns`, `skills`(시작 때 본문을 미리 싣는다), `mcpServers`, `hooks`, `memory`(`user`/`project`/`local`), `background`, `isolation: worktree`, `color`. 본문이 시스템 프롬프트. 플러그인 서브에이전트는 `hooks`, `mcpServers`, `permissionMode`를 무시한다 |
| Hook | `~/.claude/settings.json` / `.claude/settings.json`, `.claude/settings.local.json`, 관리 정책, 플러그인의 `hooks/hooks.json`, 스킬·서브에이전트 머리말 | 아래 3.2.1 |
| MCP 서버 | 프로젝트 `.mcp.json`(공유), `~/.claude.json`(사용자 범위와 `projects[<경로>]` 아래 로컬 범위), 플러그인의 `.mcp.json` 또는 `plugin.json` 안, 관리 `managed-mcp.json` | 아래 3.2.2 |
| 플러그인 | 설치본 캐시(`~/.claude/plugins/…` [미확인: 정확한 하위 경로]), `.claude-plugin/plugin.json`(선택), 설정의 `enabledPlugins`, `extraKnownMarketplaces` | 폴더 하나에 `skills/`, `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `output-styles/`, `monitors/`, `bin/`, `workflows/`, `themes/`. `plugin.json`: `name`, `version`, `userConfig`(`sensitive`이면 보안 저장소), `dependencies`, 구성요소 경로 등. 구성요소 이름은 `<플러그인>:<이름>`으로 이름 공간이 붙는다. 플러그인 루트의 `CLAUDE.md`는 읽지 않는다 |
| 마켓 | `.claude-plugin/marketplace.json`(`name`, `owner`, `plugins[]`와 `source`) | 목록일 뿐이다. 훑기는 마켓을 읽지 않고 설치된 플러그인만 읽는다(§1.2) |
| 출력 스타일 | `~/.claude/output-styles/*.md` / `.claude/output-styles/*.md`, 플러그인의 `output-styles/` | 머리말 `name`, `description`, `keep-coding-instructions`, `force-for-plugin`. 본문은 시스템 프롬프트 지침이고 `keep-coding-instructions`가 거짓이면 Claude Code의 코딩 지침 일부를 뺀다. 설정 `outputStyle`로 고른다. 지침이지 강제가 아니다 |
| 권한 | 설정의 `permissions`: `allow`, `ask`, `deny`, `defaultMode`, `additionalDirectories` | 규칙 `Tool` 또는 `Tool(지정자)`. 평가 순서는 deny → ask → allow이고 첫 일치가 결정한다. `Bash(cmd *)` 와일드카드, `Read`·`Edit`는 gitignore식 경로, `WebFetch(domain:x)`, `mcp__서버`. 맨 도구 이름 deny는 도구를 모델에서 아예 뺀다. `defaultMode`: `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions` |

#### 3.2.1 Claude Code Hook

- 구조는 이벤트 → 매처 묶음 → 핸들러다. 이벤트(문서 표기): `SessionStart`, `Setup`, `UserPromptSubmit`, `UserPromptExpansion`, `PreToolUse`, `PermissionRequest`, `PermissionDenied`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `Notification`, `MessageDisplay`, `SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `Stop`, `StopFailure`, `TeammateIdle`, `InstructionsLoaded`, `ConfigChange`, `CwdChanged`, `DirectoryAdded`, `FileChanged`, `WorktreeCreate`, `WorktreeRemove`, `PreCompact`, `PostCompact`, `PreModelSwitch`, `PostModelSwitch`, `Elicitation`, `ElicitationResult`, `SessionEnd`.
- **매처 문법.** `"*"`, 빈 문자열, 생략은 전부 일치. 글자·숫자·`_`·`-`·공백·`,`·`|`만 있으면 정확 일치(목록은 `|` 또는 `,`로 구분). 그 밖의 글자가 있으면 JavaScript 정규식(앵커 없음, 전체 일치는 `^…$`). 무엇에 맞추는가는 이벤트마다 다르다: 도구 이벤트는 도구 이름, `SessionStart`는 `startup`·`resume`·`clear`·`compact`·`fork`, `PreCompact`는 `manual`·`auto`, `SubagentStart`·`SubagentStop`은 에이전트 종류. `UserPromptSubmit`, `Stop` 등은 매처를 받지 않는다. MCP 도구 이름은 `mcp__<서버>__<도구>`이고 `mcp__<서버>`만 쓰면 아무것도 일치하지 않는다. 플러그인에 든 MCP 서버의 도구는 `mcp__plugin_<플러그인>_<서버>__<도구>`다.
- **`if` 필드.** 도구 이벤트에서만, 권한 규칙 문법의 규칙 하나(`Bash(git *)`, `Edit(*.ts)`). Bash는 `$()`와 백틱 안의 하위 명령까지 각각 검사한다.
- **핸들러 종류.** `command`(셸 문자열 또는 `args`가 있는 직접 실행형, `async`), `http`(JSON을 POST, `allowedEnvVars`), `mcp_tool`, `prompt`(모델 한 번 평가), `agent`(도구를 쓰는 서브에이전트, 실험). 기본 시간 제한은 `command`·`http`·`mcp_tool` 600초, `prompt` 30초, `agent` 60초이고 이벤트에 따라 더 짧다.
- **표준 입력 JSON.** `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, 도구 이벤트는 `tool_name`, `tool_input`, `tool_use_id`(PostToolUse는 `tool_response`), 서브에이전트 안에서는 `agent_id`, `agent_type`.
- **종료 코드.** 0은 성공(표준 출력이 JSON 객체 하나면 해석), 2는 막을 수 있는 이벤트에서 막기(표준 오류가 사유), 그 밖은 막지 않는 오류(진행). 1은 막기가 아니다. 이벤트마다 2의 효과가 다르다: `PreToolUse` 막기, `PermissionRequest` 무시, `PostToolUse` 사유만 모델에 전달(도구는 이미 실행됨), `Stop`·`SubagentStop` 멈춤 방지(계속).
- **JSON 출력.** 공통 `continue`, `stopReason`, `systemMessage`, `suppressOutput`. `PreToolUse`: `hookSpecificOutput.permissionDecision`(`allow` / `deny` / `ask` / `defer`), `permissionDecisionReason`, `updatedInput`(도구 입력 전체 교체), `additionalContext`. 여럿이 다르게 내면 `deny` > `defer` > `ask` > `allow`. `allow`는 승인 대화상자를 건너뛰게 하지만 deny·ask 규칙은 그래도 평가된다. 최상위 `decision: "block"`과 `reason`은 `UserPromptSubmit`, `PostToolUse`, `Stop` 등의 패턴이고 `PreToolUse`에서는 옛 값이다. `PermissionRequest`는 `hookSpecificOutput.decision.behavior`.
- 환경 변수: `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_PLUGIN_OPTION_<키>`.
- 설정 파일은 범위끼리 이어 붙는다(덮어쓰지 않는다). 알려진 함정: 매처 오타·배열·소문자는 조용히 아무것도 일치하지 않는다(조사 노트 `research-1-claude-code.md` T4, 이 문서는 공식 문서의 매처 표만 근거로 썼다).
- [미확인] `prompt`·`agent` 핸들러가 돌려주는 값의 정확한 모양, `Notification`·`PermissionRequest`의 입력 필드 전부, 플러그인 설치 캐시의 하위 경로.

#### 3.2.2 Claude Code MCP 설정

- `.mcp.json`은 최상위 `mcpServers`이고 항목마다 `type`(`stdio`, `http`, `sse`, `ws`, 별칭 `streamable-http`)이 필요하다. `url`만 있고 `type`이 없으면 stdio로 보고 건너뛴다. 필드: `command`, `args`, `env`, `url`, `headers`, `headersHelper`(헤더 JSON을 출력하는 명령, 10초), `timeout`, `oauth`(`clientId`, `callbackPort`, `scopes`, `authServerMetadataUrl`).
- 변수 확장 `${VAR}`, `${VAR:-기본값}`이 `command`, `args`, `env`, `url`, `headers`에서 풀린다. 정의되지 않은 변수는 글자 그대로 남고 경고한다. `${CLAUDE_PROJECT_DIR:-.}` 형태를 권한다.
- 범위: 로컬(기본, `~/.claude.json`의 `projects[<경로>]`), 프로젝트(`.mcp.json`), 사용자(`~/.claude.json`). 같은 이름이면 로컬 > 프로젝트 > 사용자 > 플러그인 > claude.ai 연결 순이고 항목 전체가 이긴다(필드를 합치지 않는다).
- 프로젝트 범위 서버는 대화형에서 하나씩 승인을 받는다. 설정의 `enabledMcpjsonServers`, `disabledMcpjsonServers`, `enableAllProjectMcpServers`가 승인 선택을 담는다.

### 3.3 Codex CLI

[검증] https://learn.chatgpt.com/docs/agent-configuration/agents-md, `…/extend/mcp?surface=cli`, `…/hooks`, `…/config-file/config-reference.md`. 원래 주소 `developers.openai.com/codex/…`가 308으로 `learn.chatgpt.com`으로 옮겨 가서 리다이렉트를 따라 읽었다(리다이렉트 출처는 서버 응답이고 따로 검증하지 않았다).

| 구성요소 | 위치 | 형식과 의미 |
|---|---|---|
| 지침 | 전역 `~/.codex/AGENTS.override.md` 우선, 없으면 `~/.codex/AGENTS.md`(비어 있지 않은 첫 파일 하나). 프로젝트는 루트(보통 git 루트)에서 현재 폴더까지 폴더마다 `AGENTS.override.md`, `AGENTS.md`, `project_doc_fallback_filenames` 순으로 하나 | 루트부터 이어 붙인다(가까운 것이 뒤). 합계 `project_doc_max_bytes`(기본 32 KiB)에서 멈춘다. 매 실행 시작에 다시 만든다 |
| MCP | `~/.codex/config.toml`, 신뢰한 프로젝트의 `.codex/config.toml`의 `[mcp_servers.<이름>]` | stdio: `command`, `args`, `env`, `env_vars`(전달할 변수), `cwd`. HTTP: `url`, `bearer_token_env_var`, `http_headers`, `env_http_headers`. 공통: `enabled`, `startup_timeout_sec`(10), `tool_timeout_sec`(60), `enabled_tools`, `disabled_tools` |
| Hook | `~/.codex/hooks.json`, `config.toml`의 `[hooks]`, `<repo>/.codex/hooks.json` 또는 `config.toml`(프로젝트 계층을 신뢰할 때만), 플러그인의 `hooks/hooks.json`, 관리 `requirements.toml` | 이벤트 `SessionStart`, `SessionEnd`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, `Stop`, `Interrupt`, `PreModelRequest`, `PostModelRequest`. 매처는 정규식(`*`·빈 값·생략은 전부). 입력 JSON과 종료 코드 2 막기, `PreToolUse`의 `permissionDecision`은 `deny`·`allow`(+`updatedInput`)이고 `ask`는 아직 지원하지 않는다. 명령과 MCP 도구 핸들러만 실행하고 `prompt`·`agent`는 읽고 건너뛴다. `features.hooks`로 켠다 |
| 알림 | `config.toml`의 `notify`(문자열 배열, 사용자 설정에서만) | 알림 때 실행할 명령이고 JSON 내용을 받는다 [미확인: 인자 전달 방식과 이벤트 종류] |
| 스킬 | `.agents/skills`(저장소), `~/.agents/skills` 등, `[[skills.config]]`로 켜기·끄기 | Agent Skills 형식 [미확인: 문서 페이지를 읽지 못했다. 위치는 pi와 Cline 문서가 `.agents/skills`를 공통 위치로 적은 것과 검색 결과에 근거한 추정] |
| 맞춤 프롬프트 | `~/.codex/prompts/*.md`(최상위 파일만) | **폐기됨.** 문서가 스킬을 쓰라고 한다. 시작 때 폐기 경고가 뜬다 [검증] https://developers.openai.com/codex/custom-prompts |
| 권한·샌드박스 | `approval_policy`, `sandbox_mode`(`read-only`, `workspace-write`, `danger-full-access`), `sandbox_workspace_write.writable_roots`, 프로필 `<이름>.config.toml` | 프로젝트 `.codex/config.toml`은 `profile`, `profiles`, 알림 키를 무시한다 |

### 3.4 Cursor

[검증] https://cursor.com/docs/context/rules, `…/context/mcp`, `…/hooks`, `…/agent/modes`.

| 구성요소 | 위치 | 형식과 의미 |
|---|---|---|
| 규칙 | `.cursor/rules/`(하위 폴더 가능), 사용자 규칙(앱 설정 안), 팀 규칙(대시보드), 중첩 `AGENTS.md` | 프로젝트 규칙은 `.mdc`여야 하고 머리말이 없는 `.md`는 무시된다. `description`, `globs`, `alwaysApply`. `alwaysApply: true`면 항상(다른 두 필드는 무시), `globs`가 맞으면 자동 첨부, `description`만 있으면 에이전트가 판단해 첨부, 둘 다 없으면 @-멘션으로만(수동). 우선순위는 팀 > 프로젝트 > 사용자 |
| MCP | `.cursor/mcp.json`, `~/.cursor/mcp.json` | `mcpServers`. stdio는 `type: "stdio"`, `command`, `args`, `env`, `envFile`. 원격은 `url`, `headers`, `auth`(`CLIENT_ID`, `CLIENT_SECRET`, `scopes`). 변수 `${env:NAME}`, `${userHome}`, `${workspaceFolder}`, `${workspaceFolderBasename}` |
| Hook | `.cursor/hooks.json`, `~/.cursor/hooks.json`, 기업 MDM, 팀 | 이벤트 `sessionStart`, `sessionEnd`, `preToolUse`, `postToolUse`, `postToolUseFailure`, `subagentStart`, `subagentStop`, `beforeShellExecution`, `afterShellExecution`, `beforeMCPExecution`, `afterMCPExecution`, `beforeReadFile`, `afterFileEdit`, `beforeSubmitPrompt`, `preCompact`, `stop`, `afterAgentResponse`, `afterAgentThought` 등. 매처는 정규식(`Shell`, `Read`, `Write`, `MCP:<도구>` 등에 맞추거나 셸 이벤트는 명령 전체). 출력 `permission`(`allow`/`deny`/`ask`), `user_message`, `agent_message`, `updated_input`, `additional_context`. 종료 코드 2는 막기, 그 밖의 실패는 진행(`failClosed: true`면 막기). `ask`는 `preToolUse`에서는 강제되지 않는다. Claude Code의 Hook을 읽어 들이는 호환이 있다고 문서가 적는다 |
| 맞춤 모드 | [미확인] | 모드 문서에는 Agent와 Plan만 있고 맞춤 모드의 저장 위치는 읽지 못했다. 맞춤 명령(`.cursor/commands`)도 그 페이지에 없었다. 둘 다 첫 조각에서 뺀다 |
| 옛 `.cursorrules` | [미확인] | 규칙 문서가 다루지 않는다 |

### 3.5 Gemini CLI

[검증] https://geminicli.com/docs/extensions/reference/, `…/cli/gemini-md/`, `…/cli/custom-commands/`, `…/hooks/`. 모든 페이지가 2026-06-18부터 무료와 Google One 이용자의 Gemini CLI가 Antigravity CLI로 대체되었다고 적는다. 이 형식이 앞으로도 유효한지 [미확인]이다. 그래서 Gemini는 첫 조각에 넣지 않는다(§9).

| 구성요소 | 위치 | 형식과 의미 |
|---|---|---|
| 지침 | `~/.gemini/GEMINI.md`, 작업 폴더와 부모 폴더, 도구가 파일에 닿을 때 그 위치부터 신뢰 루트까지 | 모두 이어 붙여 매 프롬프트에 싣는다. `@file.md` 가져오기. 설정 `context.fileName`(문자열 배열)으로 `AGENTS.md` 같은 다른 이름을 읽게 할 수 있다 |
| 명령 | `~/.gemini/commands/**/*.toml`, `.gemini/commands/**/*.toml` | `prompt`(필수), `description`. 하위 폴더는 `/git:commit`. `{{args}}`, `!{셸}`(실행 전 확인), `@{파일}` |
| 확장 | `~/.gemini/extensions/<이름>/gemini-extension.json` | `name`, `version`, `mcpServers`(`trust` 제외), `contextFileName`, `excludeTools`, `settings`(`envVar`, `sensitive`는 키체인), `plugins`는 문서에 없음. 폴더 `commands/`, `skills/`, `agents/`(미리보기), `hooks/hooks.json`, `policies/`(extension의 `allow`는 무시). 변수 `${extensionPath}`, `${workspacePath}`. 확장 명령이 충돌하면 `/확장.명령`이 된다 |
| Hook | 설정 `hooks`(`.gemini/settings.json` > `~/.gemini/settings.json` > `/etc/gemini-cli/settings.json` > 확장) | 이벤트 `SessionStart`, `SessionEnd`, `BeforeAgent`, `AfterAgent`, `BeforeModel`, `AfterModel`, `BeforeToolSelection`, `BeforeTool`, `AfterTool`, `PreCompress`, `Notification`. 핸들러는 `command`만(기본 60초). 도구 이벤트 매처는 정규식, 수명 주기 이벤트는 정확 일치. 표준 출력은 JSON 하나여야 하고 아니면 허용으로 본다. 종료 코드 2 막기. `{"decision":"deny"}` [미확인: 다른 값]. `CLAUDE_PROJECT_DIR`을 별칭으로 준다 |

### 3.6 opencode

[검증] https://opencode.ai/docs/agents/, `…/commands/`, `…/mcp-servers/`, `…/rules/`, `…/plugins/`.

| 구성요소 | 위치 | 형식과 의미 |
|---|---|---|
| 지침 | `AGENTS.md`(현재 폴더에서 위로), `~/.config/opencode/AGENTS.md`, 설정 `instructions`(경로, glob, URL) | **opencode는 Claude Code 형식을 읽는 호환을 둔다**: `AGENTS.md`가 없으면 `CLAUDE.md`, 전역은 `~/.claude/CLAUDE.md`, `.claude/skills`. 환경 변수로 끈다. 각 범주에서 처음 일치하는 파일 하나가 이긴다. 우리는 이 길을 가지 않는다(§1.3). 호환의 비용을 보여 주는 사례다 |
| 서브에이전트 | `~/.config/opencode/agents/*.md`, `.opencode/agents/**/*.md`, 설정 `agents` | `description`, `mode`(`primary`/`subagent`/`all`), `model`(`공급자/모델#변형`), `system`(마크다운은 본문), `permissions`(순서 있는 `action`/`resource`/`effect` 목록, 마지막 일치가 이김), `steps`, `hidden`, `color`, `disabled`. 옛 필드 `tools`, `permission`, `prompt`, `temperature`는 V2에서 쓰지 말라고 한다 |
| 명령 | `~/.config/opencode/commands/*.md`, `.opencode/commands/*.md`, 설정 `commands`(`template`) | `description`, `agent`, `model`, `subagent`. `$ARGUMENTS`, `$1…`, `` !`셸` ``(도구 권한 흐름 밖에서 실행), 템플릿 안의 `@경로`는 펼쳐지지 않는다 |
| MCP | 설정(`opencode.jsonc`)의 `mcp.servers.<이름>` | `type`: `local`(`command` 배열, `environment`, `cwd`) 또는 `remote`(`url`, `headers`, `oauth`). `disabled`, `timeout`(`startup`, `catalog`, `execution`). 치환 `{env:NAME}`. 같은 이름이면 서버 객체 전체를 대체 |
| 플러그인 | `.opencode/plugins/*.ts·js`, `~/.config/opencode/plugins/`, 설정 `plugins`(npm, 경로) | 코드다. 진입 모양은 `Plugin.define({ id, setup(ctx) })`이고 Hook 이름과 도구 막기 방법은 `/build/plugins/server`에 있다 [미확인: 그 페이지를 읽지 않았다] |

### 3.7 pi

[검증] https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md, `…/prompt-templates.md`, `raw.githubusercontent.com/earendil-works/pi/refs/heads/main/packages/coding-agent/docs/extensions.md`. Fresnel 엔진의 일부가 pi에서 갈라져 나왔다(`trust/resources.ts` 머리 주석, 46개 Hook 가운데 42개가 pi 이벤트).

| 구성요소 | 위치 | 형식과 의미 |
|---|---|---|
| 확장 | `~/.pi/agent/extensions/`(`*.ts`·`*.js`, `*/index.ts`), `.pi/extensions/`(프로젝트 신뢰 뒤), 설정의 `extensions`·`packages` | TypeScript. `export default function (pi: ExtensionAPI)`. `pi.on(이벤트)`: `tool_call`(`{block: true, reason}`로 막기), `tool_result`(패치), `input`(`continue`·`transform`·`handled`), `session_*`, `before_agent_start`, `context`, `before_provider_request` 등. `pi.registerTool`, `pi.registerCommand`, `ctx.ui.confirm` |
| 스킬 | 사용자·프로젝트 스킬 폴더(문서가 경로를 적지 않았다), `~/.agents/skills/`, `.agents/skills/`(작업 폴더에서 저장소 루트까지) | Agent Skills 형식. 지원 필드 `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`, `disable-model-invocation`. 이름이 겹치면 먼저 찾은 것만 쓴다. 설명이 없거나 잘못된 파일은 싣지 않는다 |
| 프롬프트 템플릿 | `~/.pi/agent/prompts/`, 프로젝트(신뢰 뒤) | 마크다운, 머리말 `description`, `argument-hint`. `$1`, `$@`, `$ARGUMENTS`, `${1:-기본값}`, `${@:N}` |

### 3.8 Cline과 Roo Code

[검증] https://docs.cline.bot/customization/cline-rules, https://roocodeinc.github.io/Roo-Code/features/custom-modes (공식 주소 `docs.roocode.com`이 301로 옮겨 가서 따라 읽었다).

| 구성요소 | 위치 | 형식과 의미 |
|---|---|---|
| Cline 규칙 | `.clinerules/` 또는 `.cline/rules/`, 전역 `~/Documents/Cline/Rules`(`~/.cline/rules`, `~/Cline/Rules`도 찾는다) | 마크다운. 머리말 `paths`(glob 배열)가 있으면 맞을 때만 켜지고 없으면 항상, `paths: []`이면 켜지지 않는다. `.cursorrules`, `.windsurfrules`, 루트 `AGENTS.md`, 전역 `~/.agents/AGENTS.md`를 자동으로 알아본다. 작업 폴더 규칙이 전역보다 우선 |
| Cline 워크플로·Hook | [미확인] | 규칙 페이지에 없었고 읽지 않았다. 첫 조각에서 뺀다 |
| Roo 맞춤 모드 | 프로젝트 `.roomodes`(YAML 또는 JSON), 전역 `settings/custom_modes.yaml` | `slug`, `name`, `description`, `roleDefinition`(시스템 프롬프트 맨 앞), `whenToUse`, `customInstructions`(끝 쪽), `groups`(`read`, `edit`, `command`, `mcp`. `edit`은 `fileRegex`로 제한 가능). 같은 slug면 프로젝트가 전역을 통째로 대체 |
| Roo 모드별 규칙 | `.roo/rules-<slug>/`(재귀, 알파벳 순), `~/.roo/rules-<slug>/`, `.roorules-<slug>`, 모든 모드 공통 `.roo/rules/` | 마크다운 |
| Roo MCP | `.roo/mcp.json` | [미확인: 해당 페이지에 없었다] |

### 3.9 훑을 위치의 요약

훑기가 읽는 위치는 `rules/<하네스>.json`의 `sources` 목록에 데이터로 둔다(§7.3). 사용자 수준의 위치는 사용자가 훑을 폴더를 고를 때만 읽고(홈 전체를 몰래 훑지 않는다), 프로젝트 수준은 프로젝트 루트에서 대화 폴더까지와 루트 아래를 읽는다.

## 4. 중간 표현과 매핑표

### 4.1 중간 표현(IR)

하네스 열 곳을 Fresnel 구성요소와 직접 짝짓지 않고 IR 열두 가지를 거친다. 새 하네스는 읽기 어댑터(원본 → IR)와 규칙표만 더하면 된다(N + M).

| IR 종류 | 담는 것 |
|---|---|
| `instruction` | 본문, 범위(사용자/프로젝트/로컬/관리), 활성 방식(`always` / `globs` / `description` / `manual`), glob 목록, 가져오기 |
| `skill` | 이름, 설명, 본문, 딸린 파일, 호출 제한(모델만/사용자만), 부가 필드(`allowed-tools`, `context: fork`, `hooks`, `model` 등) |
| `command` | 이름, 템플릿, 인자 문법, 셸·파일 주입 구간, 모델·에이전트 지정 |
| `agent` | 이름, 설명, 프롬프트, 도구 허용·금지, 모델, 권한 모드, 부가(`skills`, `mcpServers`, `hooks`, `memory`, `maxTurns`, `isolation`) |
| `hook` | 이벤트, 매처(종류: 정확 목록/정규식), `if` 규칙, 핸들러(`command`/`http`/`prompt`/`agent`/`mcp_tool`/`js`), 시간 제한, 범위 |
| `mcp` | 이름, 전송(`stdio`/`http`/`sse`/`ws`), 명령·인자·cwd, 환경과 헤더(값 참조 또는 리터럴), 도구 허용·금지, 시간 제한, OAuth |
| `permission` | allow·ask·deny 규칙, 기본 모드, 추가 폴더, 샌드박스 값 |
| `setting` | 모델, 출력 스타일 이름, 환경 변수, 그 밖의 알려진 키 하나씩 |
| `style` | 출력 스타일(본문, `keep-coding-instructions`) |
| `mode` | 맞춤 모드(역할, 도구 그룹, 파일 정규식) |
| `extension_code` | 코드로 된 확장(언어, 경로, 이벤트 사용 목록) |
| `bundle` | 플러그인·확장 하나(매니페스트와 안의 항목 참조, `userConfig`) |

### 4.2 Fresnel 쪽 도착점 (코드 사실)

| 도착점 | 근거 |
|---|---|
| 항상 싣는 지침 | 플러그인 폴더의 `instructions.md` 또는 `instructions/*.md`(M5c §4.5.3). 모델 문맥에는 `sections["plugin:<이름>:<경로>"]`로 파일 내용 그대로 간다(M5c §4.5.10) |
| 필요할 때 읽는 스킬 | `skills/<이름>/SKILL.md`. 지금 코드는 `description`이 없으면 색인에 싣지 않고(`cap-knowledge/src/skills/document.ts:23-37`), `disable-model-invocation: true`를 읽는다(`:37`, `upstream/skills.ts:417`) |
| 명령 | `commands/*.md`(M5c §4.5.3). 인자 치환 문법은 M5c-1이 정한다 [미확인: 아직 정해지지 않았다] |
| 서브에이전트 정의 | `agents/*.md`. 머리말 `name`(48자 이하), `description`(1~1000자), `tools`(도구 이름 glob 허용 목록), `model`(역할 이름 또는 참조), `permissions`(`mode`: `default`/`acceptEdits`/`bypass`, `rules`, `sandbox: "read-only"`), 본문이 `prompt`(`contracts/src/services/agents.ts:28-88`). 그 밖의 필드는 스키마가 거부한다(`additionalProperties: false`) |
| MCP 서버 | `McpServerDef`: `transport`(`stdio`: `command`, `args`, `cwd`, `env` / `http`: `url`, `headers`, `oauth`(불리언) / `sse`), `enabled`, `tools.allow`·`deny`·`approval`, `timeouts.connectMs`·`callMs`, `sandbox`(`contracts/src/capabilities/defs/mcp.ts:51-110`). 서버 id는 `^[a-z][a-z0-9-]{0,31}$`(`:27`). `env`·`headers` 값은 `secret://<이름>`(`^secret:\/\/[a-z][a-z0-9-]{1,63}$`, `cap-mcp/src/servers/values.ts:7`) 참조이거나 평문이고, 시크릿처럼 보이는 평문은 거부된다(`:3-4`). **변수 확장(`${VAR}`)은 없다** |
| Hook | 매니페스트 `hooks[]`와 코드(`g.on`), 위치는 M5e §3.1·§4.3의 50개 이름, 결정은 `tool.call.before`·`agent.spawn.before`의 `block` > `replace` > `ask`(M5e §4.2). **허용은 값이 아니다**(M5e H-1). 매니페스트에 `decides`를 선언한다(M5e §4.1.1) |
| 프로필 내용 | `Profile.settings`의 코어 키(`l1.tools.permissionMode`, `l1.models.default`)와 `ext.<이름>.<키>`(M5c §3.3) |
| 프로젝트 지침 파일 | 프로젝트 내용이고 플러그인이 아니다. 루트에서 대화 폴더까지 폴더마다 `AGENTS.md`(M5c §4.4.7, §6.2에서 읽는 정확한 규칙) |
| 사용자 입력이 필요한 자리 | 플러그인 매니페스트의 `userConfig`(`sensitive`이면 `secret://`만, M5c §4.5.6) |

### 4.3 매핑표

충실도 열: **정확**(문서에 적힌 의미가 같다), **근사**(어떤 의미가 달라지는지 적는다), **코드 생성**(결정적인 템플릿으로 코드를 만든다), **불가**(이유). 마지막 열은 마이그레이션이 만들 것이다. "강제력" 변화는 따로 적는다: 원본이 강제(Hook, 권한 deny)였는데 도착점이 권고(지침)가 되면 보고서에 "강제력이 약해진다"를 반드시 적는다.

#### 4.3.1 지침

| 원본 구성요소 | 도착점 | 충실도 | 잃는 것과 만들 것 |
|---|---|---|---|
| 사용자 지침(`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`, `~/.config/opencode/AGENTS.md`, Cline 전역 규칙) | 항상 싣는 지침 플러그인 하나(`instructions/`) | 정확(내용). 범위는 프로필 단위로 바뀐다 | 파일 내용 그대로. 머리글이나 설명 문장을 더하지 않는다(최소 하네스 규칙, ADR §3.13.3). 프로필 배치는 사용자가 고른다(공통 묶음 후보로 제안) |
| 같은 파일의 `@경로` 가져오기(Claude, Gemini) | 가져온 파일을 가져온 자리에서 쪼갠 `instructions/NN-*.md` 여러 개(순서 보존) | 근사: 섹션 사이 구분자가 엔진의 `sections` 이음 규칙을 따른다 [미확인] | 스캔 루트 밖을 가리키는 가져오기는 읽지 않고 "이식하지 못함: 범위 밖"으로 보고. 깊이 4 초과는 원본과 같이 멈춤 |
| 프로젝트 `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `GEMINI.md` | **이식 불필요가 아니다.** 프로젝트 내용이라 플러그인으로 옮기지 않는다 | 이식하지 못함(Fresnel이 읽지 않는다) | 대안을 보고서에 적는다: ① `AGENTS.md`로 복사(권장. 대화에 "CLAUDE.md 내용을 AGENTS.md로 복사해 줘"를 입력창 초안으로 넣어 주고 쓰기는 일반 도구 승인 카드를 지난다. 마이그레이션이 직접 쓰지 않는다 [제안]), ② 사용자 지침 플러그인으로 가져오기(프로젝트 한정이 프로필 단위로 넓어진다고 경고) |
| 프로젝트 `CLAUDE.md`가 `@AGENTS.md` 한 줄뿐(이 저장소의 `xeon/CLAUDE.md:1`이 그렇다) | 이식 불필요 | 정확 | `AGENTS.md`가 정본이고 Fresnel이 읽는다 |
| 프로젝트 `AGENTS.md`, 하위 폴더 `AGENTS.md` | 이식 불필요(Fresnel이 직접 읽는다, §6.2) | 정확. 단 Claude는 하위 폴더 파일을 그 폴더의 파일을 읽을 때 싣지만 Fresnel은 대화를 시작한 폴더까지의 경로만 읽는다 | 경로 밖 하위 폴더의 `AGENTS.md` 개수를 보고서에 한 줄로 적는다 |
| `AGENTS.override.md`(Codex), `project_doc_fallback_filenames`의 다른 이름 | 이식하지 못함 | 불가: Fresnel은 `AGENTS.md`만 읽는다 [제안] | 대안: 내용을 `AGENTS.md`로 옮김 |
| 관리 정책 `CLAUDE.md`(조직 배포) | 이식하지 못함 | 불가: 조직이 정한 것을 사용자 도구가 대신 옮기지 않는다 | 대안: 관리자가 `<managedDir>/plugins`(`discover.ts:80-81`)에 지침 플러그인을 배포 |

#### 4.3.2 규칙과 맞춤 모드 (지침의 조건부 형태)

| 원본 | 도착점 | 충실도 | 잃는 것과 만들 것 |
|---|---|---|---|
| 조건 없는 규칙(Claude `.claude/rules` 가운데 `paths` 없음, Cursor `alwaysApply: true`, Cline 머리말 없음, Roo `.roo/rules/`) | 항상 싣는 지침 | 정확 | 규칙 파일마다 `instructions/<이름>.md` |
| 경로 조건 규칙(Claude `paths:`, Cursor `globs`, Cline `paths`) | **기본(A)**: 필요할 때 읽는 스킬. `description`에 "다음 파일을 다룰 때 쓴다: <glob들>"을 적는다. **선택(B)**: 파일 도구 결과에 규칙을 붙이는 `tool.result` Hook(코드 생성) | A는 근사: 파일에 닿을 때 자동으로 붙지 않고 모델이 설명을 보고 읽을지 고른다. B는 근사: 읽기·쓰기 도구의 결과 뒤에 붙고(표시값 `modified`) 강제 플러그인이 된다 | A는 코드가 없고 검토가 쉽다. B는 "코드가 직접 실행됨" 카드와 호출마다 비용이 든다. 기본은 A [제안]. 보고서가 "자동 첨부 → 모델 판단"이라는 차이를 적는다 |
| Cursor 설명만 있는 규칙(에이전트가 판단) | 필요할 때 읽는 스킬(`description` = 원본 설명) | 정확(같은 방식이다) | |
| Cursor 수동 규칙(@-멘션만) | 스킬(`disable-model-invocation: true`) + 일회 사용 `/`로 부른다 | 근사: 부르는 입구가 @ 대신 `/`(ADR §3.8) | |
| Roo 모드별 규칙 `.roo/rules-<slug>/` | 해당 모드의 서브에이전트 정의 본문에 합친다(아래 모드 행). 모드 정의가 없으면 이식하지 못함 | 근사 | |
| Roo 맞춤 모드 | 서브에이전트 정의 하나: `prompt` = `roleDefinition` + `customInstructions`(원문 그대로 이어 붙임), `description` = `description`, `tools` = `groups`에서 계산한 도구 이름 glob. `edit`의 `fileRegex`는 옮기지 못함 | 근사. 모드는 대화 전체의 성격을 바꾸지만 서브에이전트는 맡겨 돌린다. `fileRegex` 제한은 불가(대안: 쓰기 경로를 막는 `tool.call.before` Hook을 코드 생성으로, 첫 조각에서는 보고서만) | 정의 파일 하나. 보고서에 "모드 → 서브에이전트: 사용자가 모드로 전환하던 방식이 맡기기로 바뀐다" |
| Claude 출력 스타일, `outputStyle` 설정 | 항상 싣는 지침 플러그인(본문 그대로) | 근사: Fresnel 코어의 프롬프트에서 코딩 지침 일부를 빼는 일(`keep-coding-instructions: false`)은 못 한다(코어는 고정이고 최소 하네스 원칙이다). `force-for-plugin`도 대응이 없다 | 본문. 보고서가 "코딩 지침을 빼는 부분은 옮겨지지 않는다"를 적는다 |

#### 4.3.3 스킬과 명령

| 원본 | 도착점 | 충실도 | 잃는 것과 만들 것 |
|---|---|---|---|
| Agent Skills 형식 스킬(`.claude/skills`, `~/.claude/skills`, `.agents/skills`, `~/.agents/skills`, 플러그인 `skills/`) | 스킬 플러그인(스킬 하나당 플러그인 하나) | 정확 | 폴더 전체(`scripts/`, `references/`, `assets/`)를 그대로 복사. 목적 문장은 `description` |
| 머리말 `name`이 폴더 이름과 다르거나 규칙에 어긋남, `description` 1024자 초과 | 변환 결정이 필요하다 | 사용자 선택: 슬러그로 바꾸기(근사) / 설명 문장 경계에서 자르기(근사) / 빌더에게 맡기기. 조용히 자르지 않는다 | 선택 전에는 초안을 만들지 않고 보고서에 "보류"로 남긴다 |
| Claude 머리말 `disable-model-invocation`, 스킬 `user-invocable: false` | 앞은 같은 키를 그대로 둔다(정확). 뒤(`user-invocable: false`)는 대응이 없다 | 뒤는 근사: 사용자도 `/`로 부를 수 있다 | |
| Claude 머리말 `allowed-tools`, `disallowed-tools` | 옮기지 않는다 | 불가: 스킬별 미리 승인이나 도구 제거가 없다. 결과: 승인 카드가 더 뜰 수 있다 | 보고서에 "차이: 이 스킬을 쓸 때 승인이 더 필요하다" |
| `model`, `effort`, `when_to_use`, `argument-hint`, `arguments`, `shell` | `when_to_use`는 `description`에 합친다(근사, 1024자 제한 확인). 나머지는 옮기지 않는다 | 불가(모델·노력 지정은 스킬이 하지 못한다) | |
| `context: fork` + `agent` | 서브에이전트 정의 하나와, 본문 첫머리에 "이 작업은 `<에이전트>`에 맡긴다"를 쓴 스킬 | 근사: 본문이 늘고 모델이 맡기기를 자율로 판단한다 | 첫머리 문장 추가는 사용자의 지침이 아니라 변환이 더하는 문장이라 보고서에 원문과 함께 보인다 [제안: 기본은 보고서만 쓰고 만들지 않는다] |
| 스킬 머리말 `hooks`(호출되면 등록) | 옮기지 않는다. 선택: 항상 도는 Hook으로(§4.3.5) | 불가(스킬이 활성인 동안만 도는 범위가 없다) | 대안 문장 |
| 본문 `${CLAUDE_SKILL_DIR}/scripts/x` | 스킬 폴더 기준 상대 경로(`scripts/x`)로 바꾼다 | 근사(Agent Skills 사양이 스킬 루트 기준 상대 경로를 쓴다) | 바꾼 위치를 보고서가 적는다 |
| 본문 `` !`cmd` `` (Claude, opencode, Gemini `!{}`) | 본문에서 그 자리를 "다음 명령을 실행해 그 출력을 쓴다: `cmd`"로 바꾼다 | 근사: 본문을 보내기 전에 실행되던 것이 모델의 `bash` 도구 호출로 바뀐다(승인 규칙을 따르고 한 턴이 늘어난다). Claude와 Gemini는 실행 전 확인, opencode는 도구 권한 흐름 밖이라 오히려 Fresnel이 더 엄격하다 | 바꾼 자리마다 보고서 줄. 자동 치환이 어색하면 빌더에게 |
| 본문 `$ARGUMENTS`, `$N`, `$이름` | 명령/스킬의 인자 문법(M5c-1이 정한다)으로 옮긴다 | 정확 또는 근사(문법이 정해진 뒤) [미확인] | M5c-1이 인자 문법을 정하기 전에는 명령 변환을 켜지 않는다(§9 의존) |
| Claude `.claude/commands/*.md` | 명령(`commands/*.md`) 플러그인(범위별 하나) | 근사: 이름 공간 `a/b.md`(`/a:b`)는 `a-b`로 평탄화하고 보고서에 적는다. 머리말의 `model`, `allowed-tools` 등은 스킬과 같이 처리 | |
| Gemini 명령 TOML | 명령 마크다운: `prompt` = 본문, `{{args}}` → 인자 문법. `!{}`는 위 `` !`cmd` ``와 같음, `@{파일}`은 "이 파일을 읽는다: 경로"로 바꾼다 | 근사 | |
| opencode 명령, pi 프롬프트 템플릿, Codex 맞춤 프롬프트(폐기) | 명령 | 근사. opencode `agent`·`subagent`·`model` 필드는 옮기지 않는다(불가) | Codex 프롬프트는 폐기 예정이라 보고서가 그것을 알린다 |

#### 4.3.4 서브에이전트

| 원본 필드 | 도착점 | 충실도 | 잃는 것 |
|---|---|---|---|
| 파일 이름·`name`, `description`, 본문 | `name`(48자 이하로 슬러그), `description`(1000자 이하), `prompt` | 정확(길이 제한을 넘으면 사용자 선택) | |
| `tools`(Claude `Read, Grep, Bash`) | `tools` glob(도구 이름은 §4.4의 표로 번역) | 근사: 번역할 수 없는 도구 이름은 목록에서 빠지고 보고서에 적는다 | 생략하면 부모 전체(둘 다 같다) |
| `disallowedTools` | `tools` 허용 목록으로 계산: 변환 시점의 광고 도구 전체에서 뺀 목록 | 근사: 나중에 생긴 도구는 포함되지 않는다 | |
| `model`(`sonnet`, `opus`, `haiku`, `inherit`, 전체 이름) | `model`: 역할 이름 또는 참조 | **사용자 선택이 필요하다.** 별칭이 가리키는 모델이 Fresnel의 어느 공급자에 있는지는 알 수 없다. 기본은 생략(= `subagent` 역할). 조용히 추측하지 않는다 | |
| `permissionMode` | `permissions.mode`: `default` ↔ `default`, `acceptEdits` ↔ `acceptEdits`, `bypassPermissions` ↔ `bypass` | 정확(셋). `plan`, `auto`, `dontAsk`는 불가(옮기지 않는다). 자식 모드가 부모보다 느슨할 수 없으므로 `bypass`는 부모가 `bypass`일 때만 효력이 있다(`agents.ts:29`) | |
| `maxTurns`, `background`, `isolation: worktree`, `memory` | 옮기지 않는다 | 불가: 정의에 한도 필드가 없고(한도는 맡길 때 정한다), worktree는 플러그인 M5h가 Later이고, 서브에이전트 기억 범위가 없다 | 대안 문장 |
| `skills`(시작 때 미리 싣기), `mcpServers`, `hooks` | `skills`: 본문 끝에 "다음 스킬을 먼저 읽는다: <이름들>"을 더하는 것은 사용자 말이 아니므로 하지 않는다. 보고서만. `mcpServers`: 플러그인 MCP 서버로 올리되 서브에이전트 한정이던 범위가 넓어진다(경고). `hooks`: 불가 | 불가 / 근사 / 불가 | |
| `color` | 옮기지 않는다 | 불가이지만 효과 없음 | |

#### 4.3.5 Hook (코드 생성)

**원칙.** 셸 명령 Hook을 엔진에서 읽는 호환으로 풀지 않는다. 마이그레이션이 **Hook 플러그인 하나**(범위별, 지금은 설정 파일 하나당 하나)를 만들고, 그 안에서 (1) 원본 매처를 그대로 평가하고 (2) Fresnel의 이벤트를 원본이 기대하던 입력으로 바꿔 (3) 원본 스크립트를 플러그인 프로세스에서 실행하고 (4) 스크립트의 종료 코드와 출력을 Fresnel의 결정값으로 바꾼다. 호환은 **생성된 플러그인 코드 안에** 있고 엔진에는 없다. 코드는 결정적인 템플릿(`adapter-hooks@<버전>`)에서 나오고 검토함에서 코드를 볼 수 있다.

생성물:

```
<이름>/
  .fresnel-plugin/plugin.json      # 매니페스트: purpose, hooks[](위치 이름, decides), 필요한 userConfig
  .fresnel-plugin/migration.json   # 출처 경로(홈은 ~), 원본 해시, rulesVersion, 이 플러그인의 보고서 줄
  plugin.js                        # 템플릿에서 생성한 어댑터(매처 평가, 입력 변환, 결정 변환)
  hooks.data.json                  # 정규화한 Hook 항목(이벤트, 매처, if, 핸들러, 시간 제한, 원본 위치)
  scripts/…                        # 원본 폴더 안에서 가리키던 스크립트의 복사본(검토 대상)
```

이벤트 대응:

| 원본 이벤트 | Fresnel 위치(M5e §3.1·§4.3) | 충실도 | 다른 점 |
|---|---|---|---|
| Claude `PreToolUse`, Cursor `preToolUse`·`beforeShellExecution`·`beforeMCPExecution`·`beforeReadFile`, Gemini `BeforeTool`, Codex `PreToolUse`, pi `tool_call` | `tool.call.before`(`block`/`ask`/`replace`) | 막기·묻기는 정확. 아래 결정 변환의 표 참조 | 허용·입력 변경·보류는 불가 |
| Claude `PostToolUse`·`PostToolUseFailure`, Cursor `postToolUse`·`afterFileEdit`·`afterShellExecution`, Gemini `AfterTool`, Codex `PostToolUse`, pi `tool_result` | `tool.result`(chain, `content`·`isError` 패치) | 근사: 표준 오류·`additionalContext`·`reason`을 결과 본문 뒤에 붙인다(표시값 `modified`). 원본은 별도 시스템 알림으로 전한다 | `tool_response` 모양이 근사(§4.3.5의 입력 표) |
| Claude `UserPromptSubmit`, Cursor `beforeSubmitPrompt`, Codex `UserPromptSubmit`, pi `input` | `input.user.before`(chain: `handled`, 고치기)와 `input.agent.before`(collect: 보태기) | 근사: 막기는 `handled`(입력을 삼킨다), 문맥 보태기는 `input.agent.before` | 원본의 "프롬프트를 지우고 사유만 보임"은 표시가 다를 수 있다 |
| Claude `SessionStart`, Cursor `sessionStart`, Gemini `SessionStart`, Codex `SessionStart`, pi `session_start` | `thread.start`(tap, `post`와 상태 복원) 또는 `thread.resources` | 근사: `startup`/`resume`/`clear`/`compact`/`fork`를 가르는 매처는 Fresnel의 대화 시작이 구별하지 않는다. 문맥 주입은 `post` 메시지로 | 매처가 `startup`만 걸어 둔 항목은 "대화를 열 때마다 돈다"로 달라진다고 보고 |
| Claude `SessionEnd`, `thread.shutdown` | `thread.shutdown`(tap, 2초 예산) | 정확(예산 차이는 보고) | Claude도 1.5초 예산이 있다 |
| Claude `Stop`, Cursor `stop`, Codex `Stop`, Gemini `AfterAgent`, pi `agent_before_settle` | `boundary.settle.before`(chain finalize, `continue`) | 근사: 종료 코드 2·`decision: "block"`(멈추지 말고 계속)을 `continue`로. `stop_hook_active` 입력은 어댑터가 흉내 낸다(무한 반복 방지) | 계속 횟수 상한은 Fresnel의 주도 한도가 적용된다(엔진 설계 §2.3) |
| Claude·Codex `SubagentStart`/`SubagentStop`, Cursor `subagentStart`/`subagentStop` | `agent.spawn.before`(block/ask/replace)와 `agent.spawn.after`(보고 본문 패치) | 근사: 원본의 "멈추지 말고 계속"은 불가 | |
| Claude·Codex `PreCompact`/`PostCompact`, Cursor `preCompact`, Gemini `PreCompress` | `thread.compact.before`(막기, 요약 대신 주기)와 `thread.compact.after` | 정확(막기) | |
| Claude `PermissionRequest`, Notification, Cursor 승인 | `ask.human.before`(tool 종류는 `cancel`만) | **막기 쪽만 가능, 자동 허용은 불가**(M5e H-1) | 알림 이벤트는 `thread.prompt.before` 구독으로 근사 |
| Claude `PreModelSwitch`, Codex `PreModelRequest`, Gemini `BeforeModel` | 모델 호출 앞 위치(`request.provider.before` 등) | 근사 [미확인: 각 이벤트의 입력·결정 의미를 확인하지 않았다] | 첫 조각에서 뺀다 |
| Claude `ConfigChange`, `CwdChanged`, `FileChanged`, `InstructionsLoaded`, `DirectoryAdded`, `TaskCreated`·`TaskCompleted`, `TeammateIdle`, `WorktreeCreate`·`WorktreeRemove`, `MessageDisplay`, `Setup`, `StopFailure`, `PostToolBatch`, `Elicitation*` | 대응하는 Hook 위치가 없다 | **불가** | 보고서에 이유와 대안. `WorktreeCreate`는 "대화 시작이 폴더 경로를 돌려주는 길"(M5e H-7)이 비슷하지만 의미가 달라 worktree 플러그인(M5h)을 대안으로 적는다 |
| 핸들러 `http` | 어댑터가 `fetch`로 같은 본문을 보낸다. `allowedEnvVars`는 시크릿 참조로 | 근사 | 시크릿 값은 복사하지 않는다(§6.6) |
| 핸들러 `prompt`·`agent`(모델이 판정) | 공개 기능 `models.complete`·`agents.judge`(엔진 설계 §3.2)를 부르는 템플릿 | 근사. 모델 비용이 들고 주도 한도에서 차감된다. 판정 결과 모양을 [미확인] | 첫 조각에서 뺀다 |
| 핸들러 `mcp_tool` | 불가(첫 조각). 나중에 통합 호출 경로로 | 불가 | |
| opencode 플러그인, pi 확장, Gemini 확장의 코드 Hook | 코드를 템플릿으로 바꿀 수 없다 | **코드 생성이 아니라 빌더 작업**(§7.6) | |

결정 변환(`tool.call.before`):

| 원본 출력 | 어댑터가 낼 값 | 비고 |
|---|---|---|
| 종료 코드 2 + 표준 오류 | `{ block: true, reason: <표준 오류 앞 500자> }` | Claude·Cursor·Codex·Gemini가 같다. Fresnel 외부 셸 훅 규칙(`ext-host/src/operations/hooks/protocol.ts:12-14`)이 이미 같은 규약이다 |
| 종료 코드 0 + `permissionDecision: "deny"`, `decision: "deny"`·`"block"`, Cursor `permission: "deny"` | `{ block: true, reason }` | |
| `permissionDecision: "ask"`, Cursor `permission: "ask"` | `{ ask: true, reason }` | Codex는 `ask`를 지원하지 않는다고 적는다 |
| `permissionDecision: "allow"` | 값 없음(통과) | **차이: 원본에서는 승인 대화상자를 건너뛰게 하지만 Fresnel은 허용을 값으로 받지 않는다**(M5e H-1). 보고서에 "자동 승인이 사라진다: 권한 모드가 묻는 모드면 카드가 뜬다". 이 항목이 많으면 권한 모드를 `acceptEdits`로 올리는 선택지를 제안 |
| `updatedInput`, Cursor `updated_input` | 기본 `{ ask: true, reason: "입력을 바꾸려 했으나 지원하지 않는다" }`, 설정 `onUnsupported`로 `block`·`ignore` 선택 | **불가**(도구 인자를 바꾸는 Hook은 M5e O-6에서 뒤로 미뤘다). 입력을 무해하게 고치는 스크립트를 조용히 무시하면 원래 명령이 실행되므로 기본은 사람에게 묻는다 [제안] |
| `permissionDecision: "defer"` | 값 없음 | 불가(비대화형에서만 쓰는 값) |
| 종료 코드 1, 3 이상, 시간 초과, 실행 실패 | 값 없음(통과) + 어댑터 기록 | 원본은 "막지 않는 오류"다. 엔진의 `tool.call.before`는 실패 시 막는(closed) 정책이라(M5e §3.1 13번) 어댑터가 스크립트 실패를 잡아 통과로 바꾼다. 어댑터 자체의 예외(코드 오류)는 엔진 정책대로 막는다 |
| 표준 출력이 JSON이 아님 | 통과 | |
| 표준 입력이 256 KiB를 넘어 엔진이 `g.runScript`를 `invalid_params`로 거절(던짐) | `{ ask: true, reason: "입력이 너무 커서 훅 스크립트를 돌리지 못했다. 사람이 확인한다" }` [제안] | 던진 거절은 닫힌 실패라 그대로 두면 막기가 된다(`FIRST_DENY`, 사유 "extension handler failed"). 스크립트를 돌리지 못한 것이라 묻기로 바꾼다. 이 행은 `tool.call.before`에만 적용한다. 다른 지점은 통과다 |

여러 Hook의 합치기는 원본(`deny` > `defer` > `ask` > `allow`)과 Fresnel(`block` > `replace` > `ask`)이 막기와 묻기에서 같다. 시간 제한은 다르다: 원본 기본 600초, Fresnel 막는 Hook 30초·고치는 Hook 10초·지켜보는 Hook 5초(엔진 설계 §3.3). 어댑터는 원본의 제한과 `min(원본, 엔진 예산 − 1초)` 가운데 작은 값으로 스스로 끊어 "막지 않는 오류"로 처리하고, 보고서에 "시간 제한이 달라진다: 원본 N초, 여기서는 최대 M초"를 항목마다 적는다. 긴 스크립트(예: `Stop`에서 테스트 실행)는 이 한도에 걸리므로 "차이를 두고 이식(시간 제한)" 또는 "이식하지 못함"으로 분류한다. 예산 설정(`x.operations.budget.*`)을 프로필이 바꿀 수 있는지 [미확인]이다.

입력 변환(Fresnel → 원본 하네스가 기대하는 표준 입력 JSON):

| 원본 필드 | 어댑터가 채우는 값 | 충실도 |
|---|---|---|
| `session_id`, `hook_event_name`, `cwd` | 대화 id, 원본 이벤트 이름, 대화 폴더 | 정확 |
| `tool_name` | Fresnel 도구 이름을 원본 이름으로 되돌린 값(§4.4). 대응이 없으면 Fresnel 이름 그대로 | 근사 |
| `tool_input` | 도구별 되돌림: `read{path→file_path, offset, limit}`, `write{path→file_path, content}`, `edit{path, edits→old_string/new_string}`(편집이 하나일 때. 여럿이면 `edits` 배열 그대로), `bash{command, timeout(초)→timeout(ms)}` | 근사 |
| `tool_response`(PostToolUse) | 결과 본문과 `isError`에서 만든 것. 원본 도구가 주던 구조화 필드(예: 편집의 패치 목록)는 없다 | 근사. 이 필드를 `jq`로 읽는 스크립트는 달라질 수 있다 |
| `permission_mode` | `default`/`acceptEdits`/`bypass`를 원본 값으로 | 근사 |
| `transcript_path`, `prompt_id`, `scratchpad_dir`, `effort` | 없다. 비워 둔다 | **불가**: Fresnel은 대화 기록 파일 경로를 플러그인에 주지 않는다. 스크립트가 읽으면 달라진다 |
| `agent_id`, `agent_type` | 서브에이전트 안이면 호출자 정보에서 | 근사 |
| 환경 변수 `CLAUDE_PROJECT_DIR`(`GEMINI_PROJECT_DIR`, `FRESNEL_PROJECT_DIR`도) | 프로젝트 루트 | 정확 |
| `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_PLUGIN_OPTION_<키>` | 앞은 검토본 `tree/` 경로. `CLAUDE_PLUGIN_DATA`(지속 쓰기 폴더)는 플러그인에 쓰기 권한이 없어 불가. `OPTION_*`은 `userConfig`에서 | 근사 / 불가 / 근사 |

정적 분석: 스크립트 본문에서 `.transcript_path`, `.tool_response.`, `CLAUDE_PLUGIN_DATA`, `$CLAUDE_ENV_FILE` 같은 입력 필드 참조를 문자열로 찾아 보고서에 "이 스크립트가 쓰는 입력 중 Fresnel이 채우지 못하는 것"으로 적는다. 정적 분석이 놓쳐도 어댑터 입력 표가 근거다. 스크립트가 어떤 결정을 낼 수 있는지는 정적으로 알 수 없으므로 `decides`는 위치가 허용하는 값의 상한(`["block","ask"]`)으로 선언한다(M5e §4.1.1, "낼 수 있다"는 뜻).

**지원 범위(조각 2 라이브러리 [제안]).** 구현한 것은 이벤트 다섯과 핸들러 하나다. `PreToolUse`(지점 `tool.call.before`, 막기와 묻기), `PostToolUse`(`tool.result`, 결과 본문 뒤에 훅 출력을 덧붙인다), `UserPromptSubmit`(`input.user.before`, 막으면 입력을 삼킨다), `Stop`(`boundary.settle.before`, 멈추지 말고 계속하게만 한다), `SessionStart`(`thread.start`, 지켜보기만 한다). 핸들러는 `type:"command"`의 `command`와 `timeout`(초)이다. 스크립트는 원본 폴더 안의 파일 하나다. 사용자 범위의 원본 폴더는 `~/.claude`이고 프로젝트 범위는 프로젝트 루트다. 명령 문자열에서 원본 폴더 안을 가리키는 첫 토큰을 스크립트로 정한다(`$CLAUDE_PROJECT_DIR`, `${CLAUDE_PROJECT_DIR}`, `$HOME`, `~/`, `./`, 폴더 기준 상대 경로, 절대 경로). 실행기는 확장자로 정한다(`.sh`→sh, `.py`→python3, `.js`·`.mjs`→node, `.ts`→bun). 실행기 단어(`sh`, `bash`, `python3`, `node`, `bun`)를 앞에 쓰면 그 단어가 실행기이고 확장자와 맞아야 한다. 스크립트 뒤 토큰은 인자(16개, 각 512자 이하)다. 시간 제한은 원본 초와 `지점 예산 − 1초` 가운데 작은 값이다(예산은 엔진 등급: 막는 지점 30초, 고치는 지점 10초, 지켜보는 지점 5초 [제안]). 그 밖은 `not_ported`로 보고한다: 옮기지 않는 이벤트(`hook_event_unsupported`), 핸들러 `http`·`prompt`·`agent`·`mcp_tool`과 알 수 없는 종류, `if`(`hook_if_unsupported`)와 그 밖의 핸들러 키(`hook_key_unsupported`), 시간 제한이 양의 수가 아님, 셸 연산자가 든 명령(`inline_command`), 원본 폴더 밖이나 심볼릭 링크로 밖을 가리키는 스크립트(`script_outside_root`), 알 수 없는 확장자(`unknown_runner`), 없는 스크립트(`script_missing`), 읽지 못하는 스크립트(`script_unreadable`), 시크릿 값이 든 명령(`literal_secret_in_source`)과 스크립트(`secret_in_script`), 정규식이 아닌 매처(`matcher_invalid`). 명령 문자열은 항목에도 보고서에도 싣지 않는다. 스크립트 본문은 바이트 그대로 `scripts/` 복사본이 되고, 시크릿 값 모양이 있으면 복사하지 않는다.

옮기지 않은 것은 차이로 적는다. 허용 결정과 입력 변경(`updatedInput`)은 옮기지 않는다. 입력을 바꾸려는 훅은 묻기가 된다. `additionalContext`(문맥 추가)는 이 조각에서 옮기지 않는다. `SessionStart`는 대화 시작 종류를 구별하지 않고 항상 `startup`으로 본다. `Stop`의 계속 이유 문장은 모델에 전하지 않는다. `PostToolUse`의 구조화된 `tool_response`는 없고 본문과 오류 여부만 있다. 입력에는 `cwd`와 `permission_mode`를 채우지 않는다. 스크립트에 환경 변수를 주지 않는다. 스크립트 본문이 `transcript_path`, `tool_response`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_ENV_FILE`, `CLAUDE_PROJECT_DIR`를 읽으면 그 차이를 항목마다 적는다(문자열 검색이다). 표준 입력이 256 KiB를 넘으면 엔진이 `g.runScript`를 `invalid_params`로 거절하고 스크립트는 돌지 않는다(`SCRIPT_LIMITS.stdinBytes`, 결정 변환 표의 행). `tool.call.before`에서는 묻기가 되므로 큰 `write` 내용을 검사하는 훅은 사람이 확인하게 된다. 그 밖의 지점은 통과다 [제안].

**스크립트를 어디서 실행하는가(의존, 현재 사실).** 플러그인 코드는 `g.runScript(이름, {stdin})`으로 자기 매니페스트 `scripts`에 선언된 스크립트만 부른다. 선언은 매니페스트 `scripts`다(커밋 535eca04e). 엔진 쪽 실행기는 격리 자식의 `g.runScript`이고(커밋 fef400f0d), 검사 순서는 선언, 위치, 일반 파일, 승인, 돌려 보기, 띄우기다. 띄우는 것은 기존 `IsolationProcessPort.spawn`이고 샌드박스 프로필은 넓히지 않는다. 공개 타입 `GroupApi.runScript`는 커밋 074139252다. 이 조각의 Hook 플러그인은 이 길만 쓴다. **`HookRun` 기록은 아직 없다.** 스크립트 실행은 도구 호출 기록에도 검토함의 실행 기록에도 남지 않는다. 샌드박스 프로필을 넓혀야 하는 것(runner 밖의 도구, 쓰기, `CLAUDE_PLUGIN_DATA`, 폴더 밖 읽기)은 구현하지 않고 위 차이로 적는다. 옛 외부 셸 훅(`x.operations.hookDefs`, 프로토콜 `fresnel.hook.v1`)은 이 기능이 하는 일을 설정 파일로 이미 하고 있다. 그 운명(플러그인으로 합칠지)은 `m5-plan.md`가 "M5g의 설계 범위 안에서 결정"이라고 적은 것이다. 결정은 §11 Q5.

#### 4.3.6 MCP 서버

| 원본 | 도착점 | 충실도 | 잃는 것과 만들 것 |
|---|---|---|---|
| Claude `.mcp.json`, `~/.claude.json`의 서버, Cursor `.cursor/mcp.json`, Roo `.roo/mcp.json` [미확인], Cline | 서버 하나당 플러그인 하나(`mcp.json`, `McpServerDef`) | 정확(`stdio`, `http`, `sse` 필드) | 이름은 `normalizeServerName`(`cap-mcp/src/servers/loader.ts:17-22`)과 같은 규칙(소문자, `[a-z0-9-]` 밖은 `-`, 32자)으로 바꾼다. 바뀌면 보고서에 적는다. 충돌하면 접미사 |
| `type: "ws"`, `headersHelper`, Cursor `envFile`, Cursor `auth.CLIENT_ID/SECRET`, Claude `oauth` 세부 | 옮기지 못한다. `oauth`가 있으면 `oauth: true`만 | 불가 / 근사: `McpServerDef`는 `oauth`가 불리언이고 `ws`가 없다 | 보고서에 이유. `headersHelper`는 실행해야 하는 명령이라 훑기가 실행하지 않는다 |
| `${VAR}`, `${VAR:-기본}`, `${env:NAME}`, `{env:NAME}`, Codex `env_vars`·`bearer_token_env_var`·`env_http_headers` | 시크릿 참조 `secret://<서버>-<변수>`(이름 패턴에 맞게 줄임). 기본값이 시크릿으로 안 보이면 그 기본값을 평문으로 | 근사: Fresnel은 변수를 확장하지 않는다(`values.ts`). 값을 환경에서 읽어 복사하지 않는다(§6.6) | 매니페스트 `userConfig`에 `sensitive` 키를 선언하고 프로필 검증(`secret_missing`, `required_unset`)이 값을 넣게 안내한다 |
| `${CLAUDE_PROJECT_DIR}`, `${workspaceFolder}`, 상대 경로 | 프로젝트 범위 항목이면 `cwd`와 경로를 프로젝트 루트의 절대 경로로 | 근사: 플러그인이 그 폴더에 묶인다. 보고서가 경고 | |
| Claude `timeout`, Codex `startup_timeout_sec`·`tool_timeout_sec`, opencode `timeout` | `timeouts.connectMs`·`callMs` | 정확 | 단위 변환 |
| Codex `enabled_tools`·`disabled_tools`, Gemini `excludeTools`(서버 도구에 한한 것) | `tools.allow`·`tools.deny` | 정확. Gemini의 `run_shell_command(rm -rf)` 같은 명령 수준 제한은 불가 | |
| Codex `enabled = false`, opencode `disabled: true` | `enabled: false` | 정확 | |
| 환경에 리터럴로 적힌 시크릿(`Authorization: Bearer sk-…`) | 시크릿 참조로 바꾸고 값은 버린다 | 근사 | 보고서 `literal_secret_in_source`(값 없이). 사용자에게 원본의 키를 교체하라고 권한다 |
| Claude 프로젝트 범위 서버의 승인 상태(`enabledMcpjsonServers` 등) | 옮기지 않는다 | 불가이지만 의도적이다: Fresnel은 검토함 승인과 기동 승인(시작 게이트)이 있다 | |
| 플러그인에 든 서버의 `mcp__plugin_<플러그인>_<서버>__<도구>` 이름 | 매처 번역에만 영향(§4.4) | | |

#### 4.3.7 권한과 설정

| 원본 | 도착점 | 충실도 | 잃는 것과 만들 것 |
|---|---|---|---|
| Claude `permissions.defaultMode`, Codex `approval_policy`·`sandbox_mode` | 프로필 설정 `l1.tools.permissionMode`(`default`/`acceptEdits`/`bypass`) | `bypassPermissions`·`acceptEdits`·`default`는 정확. `plan`, `auto`, `dontAsk`, Codex `on-request`·`never` 조합은 불가 | 프로필 설정은 제안만 하고 사용자가 확인해 적용한다(권한이 넓어지면 표시한다. ADR §3.6.2) |
| `permissions.deny`, `permissions.ask` 규칙 | `tool.call.before` Hook(코드 생성: 규칙 목록 → 막기·묻기)을 가진 플러그인 | 근사: 규칙 문법(Bash 와일드카드, gitignore식 경로)을 어댑터가 다시 구현해야 하고 규칙 평가는 원본의 정책 단계가 아니라 Hook 단계에서 일어난다. **강제력은 유지된다**(둘 다 강제). 맨 도구 이름 deny(도구를 모델에서 빼기)는 불가: 대안은 프로필에서 도구를 뺀 플러그인 | 셋째 조각(§9) |
| `permissions.allow` 규칙 | 옮기지 않는다 | 불가: Hook은 허용을 낼 수 없다. 대안: 카드의 "이 대화에서 계속 허용", 권한 모드 | 보고서가 규칙마다 한 줄 |
| `additionalDirectories` | 옮기지 않는다 | 불가: 쓰기 범위는 프로젝트 루트다(M5c §4.4.4). 대안: 프로젝트 루트를 넓게 잡는다 | |
| 설정 `model` | 프로필 `l1.models.default` | 사용자 선택(모델 별칭을 추측하지 않는다) | |
| 설정 `env`(환경 변수 주입), `apiKeyHelper`, `statusLine`, `awsAuthRefresh` 등 | 옮기지 않는다 | 불가: 환경 주입과 자격 명령은 시크릿 취급이 달라 자동으로 옮기지 않는다(`env`에 시크릿이 있을 수 있다). `statusLine`은 화면 플러그인(코드)이라 빌더 작업 | 키마다 보고서 줄 |
| `enabledPlugins`, `extraKnownMarketplaces` | 켜짐 상태는 옮기지 않는다. 플러그인은 설치된 것을 구성요소로 풀어 옮기고 켜짐은 프로필이 정한다 | 불가(개념이 다르다) | |

#### 4.3.8 플러그인과 확장(묶음)

| 원본 | 도착점 | 충실도 | 잃는 것과 만들 것 |
|---|---|---|---|
| Claude 플러그인(설치본 폴더) | Fresnel 플러그인 하나(구성요소를 위 표대로 풀어 한 폴더에) | 구성요소별 충실도. 이름 공간 `<플러그인>:<이름>`은 Fresnel에서는 플러그인 이름이 이름 공간이다 | `plugin.json`의 `userConfig` → 매니페스트 `userConfig`(`sensitive`는 `secret://`). `dependencies`는 옮기지 못한다(불가, 보고서). `.lsp.json`, `monitors`, `bin/`, `workflows`, `themes`, `channels`는 대응이 없다(불가) |
| Gemini 확장 | 같은 방식 | 같다. `settings`의 `envVar`·`sensitive` → `userConfig` | 확장의 `policies/`는 불가 |
| opencode `plugins`, pi 확장 | §7.6(빌더 작업) | 코드 생성이 필요하고 결정적 변환이 아니다 | |

### 4.4 도구 이름 번역표와 매처 번역

매처와 `tools` 목록의 도구 이름은 원본 하네스의 이름이다. Fresnel의 도구 이름(`read`, `write`, `edit`, `grep`, `bash`, `web_search`, `web_fetch`, `agent`, MCP 도구, `contracts/src/capabilities/defs/workspace.ts:487-524, 656`, `web.ts:453, 681`)과 다르다.

| 원본 이름(Claude) | Fresnel 도구 | 비고 |
|---|---|---|
| `Bash` | `bash` | 인자 `command`, 시간 제한 단위가 ms ↔ 초 |
| `Read` | `read` | `file_path` ↔ `path` |
| `Write` | `write` | |
| `Edit`, `MultiEdit` | `edit` | 한 도구가 `edits` 배열을 받는다 |
| `Grep` | `grep` | |
| `Glob`, `LS`, `NotebookEdit`, `TodoWrite`, `Task` 등 | [미확인] | 대응하는 Fresnel 도구가 있는지 도구 목록에서 확인해야 한다. 없으면 "일치할 도구가 없는 매처"로 보고 |
| `WebSearch`, `WebFetch` | `web_search`, `web_fetch` | |
| `Agent`/`Task`(서브에이전트) | `agent` | |
| `mcp__<서버>__<도구>` | MCP 도구 | 마이그레이션이 옮긴 서버의 도구 이름은 변환 뒤 엔진 이름으로 확정 [미확인: 도구 기계 이름 규칙] |

이 표는 코드에 굳히지 않고 규칙 데이터(`rules/claude-code.json`의 `toolNames`)로 둔다. 실제 도구 목록은 변환 시점의 엔진 광고 도구(`tool_search` 가능한 목록)로 검증해 표의 항목이 없으면 보고서에 "도구 없음"으로 올린다.

**매처 번역은 문자열을 바꾸지 않는다.** 정확 일치 목록 `Edit|Write`는 번역할 수 있지만 정규식 `^(Edit|Write)$`나 `mcp__memory__.*`는 문자열로 안전하게 번역할 수 없다. 그래서 어댑터가 Fresnel의 도구 이름을 원본 이름으로 되돌린 값(§4.3.5의 입력 변환)에 **원본 매처를 그대로 적용**한다(정확 일치 목록이면 목록 비교, 아니면 JavaScript 정규식, 앵커 없음). 이 방식은 원본의 "글자·숫자·`_`·`-`·공백·`,`·`|`만 있으면 정확 일치" 판정 규칙까지 그대로 옮긴다. 원본에서 아무것도 일치하지 않던 매처(오타, 소문자)는 여기서도 일치하지 않는다 [검증: `research-1` T4]. 이것을 "동작 보존"으로 보되 보고서에 "이 매처는 원본에서도 일치하는 도구가 없다"를 경고로 적는다(원본의 조용한 실패를 그대로 가져오지 않고 알린다). `if` 필드(`Bash(git *)`)의 하위 명령 분해와 gitignore식 경로 일치는 어댑터가 부분 구현하고 구현하지 못한 문법은 "근사"로 보고한다.

## 5. "완전한 이식"의 정의

### 5.1 사용자가 약속받는 것

1. **항목마다 한 줄.** 훑기가 찾은 항목은 모두 보고서에 정확히 한 줄로 들어간다. 결과는 넷 중 하나다.
   - **정확히 이식**: 원본 문서가 적은 의미가 같다. 동등성 검사(§5.3)를 통과했다.
   - **차이를 두고 이식**: 무엇이 달라지는지 차이 항목으로 적는다. 차이 종류: `의미 손실`, `범위 변화`(프로젝트 → 프로필), `시간 제한`, `비용`, `강제력 변화`(강제 → 권고, 권고 → 강제), `승인 흐름 변화`, `이름 바뀜`, `사용자 선택으로 정함`.
   - **이식하지 못함**: 이유 코드와 이유 문장, 제안하는 대안(예: 빌더에게 맡기기, 직접 하는 방법, 나중 조각).
   - **이식 불필요**: Fresnel이 직접 읽는 것(프로젝트 `AGENTS.md`)이나 이미 같은 것.
2. **조용한 누락 없음.** 항목 수와 보고서 줄 수가 같다(수용 기준 1). 알려진 컨테이너(`settings.json`, 스킬 머리말, 서브에이전트 머리말, `config.toml`, `plugin.json`) 안의 키는 키마다 항목이다. 아는 키만 처리하고 모르는 키는 "이식하지 못함: 알 수 없는 키"로 한 줄 남긴다. 알려진 위치의 알 수 없는 파일도 한 줄이다. 훑지 않은 위치는 보고서 머리에 "훑은 위치" 목록으로 밝힌다. 그 밖의 위치는 약속하지 않는다.
3. **보류가 없는 최종 보고서.** 사용자가 정해야 하는 것(모델 별칭, 이름 충돌, 설명 길이 초과, 시크릿 값, 프로필 배치)은 제안 단계의 질문이고 초안을 만들기 전에 닫는다. 건너뛰기는 "이식하지 못함: 사용자가 건너뜀"이다.
4. **원본을 건드리지 않는다.** 훑기는 읽기 전용이고 초안은 Fresnel의 폴더에만 쓴다(수용 기준 5).
5. **시크릿은 평문으로 복사되지 않는다**(§6.6, 수용 기준 7).
6. **모든 산출은 검토함을 지난다.** 승인 전에는 아무것도 실행되지 않고 어느 프로필에도 들어가지 않는다(ADR §3.7).
7. **다시 돌려도 안전하다.** 원본이 바뀌면 새 버전 초안이 올라온다(§6.5).

이 약속은 "원본과 완전히 같은 동작"을 약속하지 않는다. 같지 않은 곳은 차이로 숨기지 않고 말한다. 이것이 "완전한 이식"의 뜻이다.

### 5.2 보고서 모양

```ts
// 라이브러리 패키지가 정의하고 wire가 그대로 옮긴다 [제안]
type ReportStatus = "exact" | "differs" | "not_ported" | "not_needed";
type DifferenceKind =
  | "semantic_loss" | "scope_change" | "time_limit" | "cost" | "enforcement_change"
  | "approval_flow" | "renamed" | "user_choice";

interface ReportLine {
  readonly itemId: string;                    // SourceItem.itemId
  readonly harness: HarnessId;                // "claude-code" | "codex" | "cursor" | "gemini" | "opencode" | "pi" | "cline" | "roo" | "agents-md" | "agent-skills"
  readonly kind: IrKind;
  readonly label: string;                     // 사람이 읽는 이름: "스킬 deploy", "Hook PreToolUse:Bash"
  readonly source: { readonly scope: "user" | "project" | "local" | "managed" | "plugin"; readonly path: string; readonly key?: string }; // 홈은 ~로
  readonly status: ReportStatus;
  readonly differences: readonly { kind: DifferenceKind; text: string }[];   // differs일 때
  readonly reason?: { code: string; text: string };                           // not_ported일 때
  readonly alternative?: string;                                             // not_ported·differs일 때 제안
  readonly output?: { plugin: string; path: string };                         // 어느 플러그인 초안의 어느 파일로 갔나
  readonly checks: readonly CheckResult[];                                    // §5.3의 동등성 검사 결과
}
```

### 5.3 동등성 검사

가능한 것은 모두 기계가 확인하고 결과를 `checks`에 남긴다. 확인할 수 없는 것은 확인할 수 없다고 적는다.

| 검사 | 대상 | 방법 | 한계 |
|---|---|---|---|
| 수 보존 | 전체 | `SourceItem` 집합 = `ReportLine` 집합 | |
| 지침 내용 해시 | 지침 | 가져오기를 푼 원문의 해시 = 초안 `instructions/*.md` 이어 붙인 해시 | 섹션 이음은 엔진 몫 |
| 지침 싣기 | 지침 | 테스트 실행에서 턴 기록의 `material` 증거(키 `plugin:<이름>:<경로>`)로 "실렸다" 확인(M5d의 `EvidenceRef`) | "따랐나"는 기록만으로 판정할 수 없다(M5d §5.2) |
| 스킬 목록 일치 | 스킬 | 원본 스킬 `(이름, 설명)` 집합 = 변환 뒤 `cap-knowledge` 색인 항목 집합(설명 글자 수 포함). 색인에 못 오른 것(설명 없음, 이름 규칙 위반)은 이유와 함께 나열 | 검토본이 프로필에 들어간 뒤에만 색인이 생긴다. 테스트 실행에서 확인 |
| 서버 정의 검증 | MCP | 초안의 `McpServerDef`가 `McpServerDefSchema`와 `checkDefinitionValues`를 통과 | 실행하지 않는다. 기동 확인은 승인 뒤 테스트 실행의 시작 게이트가 한다 |
| 서브에이전트 정의 검증 | 서브에이전트 | `parseDefinitionFile`(`core-agents/src/definitions/loader.ts:55`)로 읽혀야 한다. 도구 이름이 변환 시점의 광고 도구 목록에 있는지 확인 | |
| 매처 동등성 | Hook | 원본 문서의 매처 표(§3.2.1)에서 만든 정답 사례집(정확 목록, 쉼표, 정규식, `*`, `mcp__` 접두, 오타)에 어댑터의 매처 평가를 돌려 일치를 확인한다 | 사례집은 공식 문서의 서술이 근거이고 실제 원본 엔진과의 비교가 아니다 |
| 걸렸을 것 | Hook | 기록된 도구 호출(턴 기록)에 매처와 `if`를 적용해 "지난 N개 호출 중 M개에서 이 Hook이 돌았을 것"을 보인다(M5d-2의 `backtest.*`의 "걸렸을 것" 부분) | 돌려 보기는 `replay` 모드이고 스크립트 실행(기능 호출)이 거부된다(엔진 설계 §3.2 `replay_mode_denied`). **스크립트가 막았을지는 알 수 없다** |
| 입력 표본 | Hook | 기록된 도구 호출 하나를 어댑터가 원본 형식 입력으로 바꾼 JSON을 검토 카드에 보인다 | 스크립트 결과는 테스트 실행에서 사람이 확인 |
| 스크립트 실행 시험 | Hook | 테스트 실행(P1 뒤)에서 실제 도구 호출을 만들어 막기·묻기·통과가 일어나는지 본다 | 사람이 판단 |
| 인자 치환 | 명령 | 인자 문법 정답 사례(`$ARGUMENTS`, `$1`, 따옴표) | M5c-1이 문법을 정한 뒤 |

## 6. 흐름

### 6.1 시작하는 곳

| 입구 | 하는 일 | 화면 |
|---|---|---|
| 프로젝트를 열 때(감지) | 다른 하네스의 표지가 있는지 **존재만** 확인한다(`exists`, 내용을 읽지 않는다). 있으면 한 줄 알림만 올린다. 훑기도 변환도 시작하지 않는다 | 프로젝트 패널의 알림(M6 T7과 같은 자리), Craft 개요의 배너 |
| 앱 업데이트 뒤 첫 실행 | 알려진 프로젝트 루트들(`projects.json`)을 감지로 한 번 훑어 제거된 형식(`.mcp.json`, `.agents/skills`)이 있으면 한 번만 알린다(§8.4) | 한 번의 알림 카드 |
| Craft 플러그인 목록(C12)의 "다른 하네스에서 가져오기" | 사용자가 하네스와 폴더를 고르면 훑기를 시작한다 | 목적 화면 "가져오기" |
| 프로젝트 패널(C10)의 같은 단추 | 그 프로젝트 루트를 기본 범위로 | 같음 |
| 앱의 명령 모음 "플러그인 가져오기" [제안] | 같은 화면을 연다 | 같음 |

감지는 어느 것도 자동으로 훑지 않는다. Craft 내비 여섯 항목(개요, 프로필, 검토함, 테스트, 지표, 플러그인)은 바꾸지 않는다 [결정: 2026-11-17 사용자]. "가져오기"는 새 내비 항목이 아니라 플러그인 목록과 개요에서 이르는 목적 화면이다 [제안].

감지 표지(존재만 보는 목록, 데이터로 둔다): `.mcp.json`, `.agents/skills`, `.claude/`, `CLAUDE.md`, `CLAUDE.local.md`, `.cursor/`, `.cursorrules`, `.codex/`, `.gemini/`, `GEMINI.md`, `.opencode/`, `.pi/`, `.clinerules`, `.cline/`, `.roo/`, `.roomodes`, `.windsurfrules`.

### 6.2 프로젝트 지침 파일: Fresnel이 직접 읽는 것

제거 뒤 Fresnel이 프로젝트에서 다른 하네스 쪽 파일 이름으로 읽는 것은 **`AGENTS.md` 하나뿐**이다. 정확한 규칙은 M5c §4.4.7이 정한다: 대화를 시작한 폴더 F와 프로젝트 루트 R에 대해 R에서 F까지 각 폴더의 `AGENTS.md`를 R이 먼저, F가 마지막인 순서로 모으고, 모델 문맥에는 `sections["project:<R 기준 상대 경로>"]`로 파일 내용 그대로 넣으며(머리말이나 설명을 더하지 않는다), 파일 하나가 `l1.context.instructionFiles.maxBytes`(기본 65536)를 넘으면 싣지 않고 진단만 남기고, R 밖으로 나가는 심볼릭 링크는 읽지 않는다. 이 구현(2026-11-18)으로 `AGENTS.md`를 턴 시작에 읽는다(`L1.context.spec` §4.2a). 신뢰 목록 주석(`trust/resources.ts:17`)은 그대로 맞다.

이 문서의 선택 [결정: 2026-11-18 사용자]:

| 파일 이름 | 읽는가 | 근거 |
|---|---|---|
| `AGENTS.md`(폴더마다, R에서 F까지) | 읽는다 | 사용자 결정(ADR §3.9.1)이고 여러 하네스가 지원하는 공통 관례다(§3.1). 다른 하네스의 형식이라기보다 하네스 사이의 공통 형식이다 |
| `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md`, `GEMINI.md`, `.cursor/rules`, `.cursorrules`, `.clinerules`, `.roo/rules`, `AGENTS.override.md` | 읽지 않는다 | 읽으면 이름 하나마다 읽기 호환이 늘고(opencode가 그렇다. §3.6), 의미(가져오기, 경로 조건, 이어 붙임 순서)도 따라가야 한다. 사용자의 방향(읽기 호환 대신 이식)과 반대다 |
| 사용자 수준 `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.config/opencode/AGENTS.md` 등 | 읽지 않는다. 지침 플러그인으로 가져온다 | 사용자 지침은 프로필 단위의 플러그인이다(ADR §3.1, R33의 "전역 지침은 지침만 든 플러그인") |

프로젝트의 비-`AGENTS.md` 지침 파일은 프로젝트 내용이라 플러그인으로 옮기지 않는다(플러그인은 프로젝트가 아니라 대화 단위로 적용되므로 옮기면 의미가 바뀐다). 마이그레이션은 이 파일들을 항목으로 훑어 보고서에 "이식하지 못함(Fresnel이 읽지 않는다)"과 대안을 적는다(§4.3.1). `CLAUDE.md`가 `@AGENTS.md` 한 줄뿐이면 "이식 불필요"다. 마이그레이션은 사용자의 프로젝트에 `AGENTS.md`를 쓰지 않는다. 대안 ①은 입력창 초안을 넣어 줄 뿐이고 쓰기는 일반 대화의 승인 카드가 한다.

### 6.3 단계

```
감지(존재만) ──┐
               ├─▶ 1 범위 고르기 ─▶ 2 훑기 ─▶ 3 제안 ─▶ 4 초안 ─▶ 5 검토함 ─▶ 6 프로필 배치
사용자의 시작 ─┘     (하네스, 폴더)   (읽기 전용)  (묶음·질문)   (폴더 쓰기+초안)  (승인)      (profileIds)
```

1. **범위 고르기.** 하네스(감지된 것을 미리 체크)와 폴더(프로젝트 루트들, 사용자 수준 위치)를 고른다. 사용자 수준 위치는 사용자가 체크한 것만 훑는다.
2. **훑기.** 호스트가 읽기 전용 훑기를 돌려 `MigrationScan`을 만든다(§7.4). 결과는 항목 표(종류, 범위, 경로, 크기)이고 아직 아무것도 쓰지 않는다. 시크릿이 보이면 값 없이 "원본에 리터럴 시크릿이 있다"만 표시한다.
3. **제안.** 규칙을 적용해 `MigrationProposal`을 만든다: (가) 플러그인 묶음(규칙표 §6.4), (나) 항목별 예상 결과(정확/차이/불가)와 차이 목록, (다) 사용자가 정해야 하는 질문(모델 별칭, 이름 충돌, 설명 길이, 시크릿 입력, 프로필 배치, 프로젝트 범위 항목의 위치), (라) 새 프로필 제안(프로젝트 범위 항목은 프로젝트 이름의 프로필 하나로 묶자는 제안, U5로 그 폴더의 선택기 기본값이 그 프로필이 된다. 프로필 레코드는 사용자가 확인하기 전에는 만들지 않는다). 이 화면이 보고서를 미리 보여 준다. 질문이 모두 닫혀야 다음 단계가 열린다.
4. **초안.** 규칙이 결정적으로 만든 폴더 트리를 `<OsDirs.config>/plugins/<이름>`에 쓰고(앱이 쓰는 것이다. M5c §4.10의 "지침 추가"와 같은 방식이라 손으로 고친 것이 아니다) `plugin.draft.create`로 초안을 만든 뒤 검토 항목을 만든다(`provenance: "migration"` [제안], §7.5). 코드 생성이 결정적이지 않은 항목(§7.6)은 빌더로 넘긴다.
5. **검토함.** 항목마다 일반 카드가 보이고 "가져온 항목" 구역이 추가된다: 원본 경로, 이 플러그인의 보고서 줄, 차이 목록. 사용자가 승인, 돌려보내기, 버리기를 한다. 손 수정이 아니라서(`provenance: "migration"`) 승인할 수 있다. 같은 일괄 승인은 항목별 결정을 한 번에 묶는 화면 기능이다(결정은 항목별로 기록된다).
6. **프로필 배치.** 승인하면서 `profileIds`를 고른다. 기본은 제안한 프로필이고 "보관만"도 고를 수 있다. 사용자 수준 지침은 "모든 프로필 공통" 후보로 제안한다(권한이 넓어지거나 비용이 늘면 표시, ADR §3.6.2). 프로필 검증(`validateProfile`)이 비용, 충돌(같은 도구 대체, 시작 Drive), 필요한 시크릿 값을 미리 보인다(M5c §4.2.7).

### 6.4 묶는 규칙 [제안]

| 항목 | 플러그인 묶음 | 이름 |
|---|---|---|
| MCP 서버 | 서버 하나 = 플러그인 하나(도구 묶음 하나, M5c §4.5.3) | `mcp-<서버 id>` |
| 스킬 | 스킬 폴더 하나 = 플러그인 하나(ADR §3.1: 스킬 하나도 플러그인) | 스킬 이름 |
| 명령 | 범위(사용자/프로젝트)별 하나(작은 프롬프트들이라) | `<하네스>-<범위>-commands` |
| 서브에이전트 | 범위별 하나 | `<하네스>-<범위>-agents` |
| 지침 | 범위별 하나 | `<하네스>-<범위>-instructions` |
| Hook | 설정 파일 하나(범위) = 플러그인 하나 | `<하네스>-<범위>-hooks` |
| 플러그인(Claude) · 확장(Gemini) | 원본 하나 = 플러그인 하나(원작자의 단위를 보존) | 원본 이름 |

이름은 `ExtensionNameSchema`를 따르고 하네스 접두를 붙여 출처가 드러나게 한다. 같은 이름이 이미 있으면 `plugin.exists`와 같은 방식으로 접미사를 붙이거나 사용자가 고른다. 묶음 규칙은 제안 화면에서 항목별로 사용자가 바꿀 수 있다(예: 명령을 개별 플러그인으로).

### 6.5 원본이 바뀐 뒤 다시 돌리기

- 항목 식별자 `itemId`는 `(하네스, 종류, 범위, 정규화한 키 경로)`의 해시로 고정한다. 파일 내용이 바뀌어도 같은 항목이다. `migration-state.json`(호스트 상태 폴더)이 `itemId → { sourceSha256, plugin, 마지막으로 만든 트리 해시, 마지막 검토 항목 }`를 들고 있다.
- 다시 훑으면: (가) 모든 항목의 `sourceSha256`이 같고 규칙 버전도 같으면 아무 일도 하지 않는다(초안·검토 항목 0개). (나) 바뀐 항목은 그 플러그인의 트리를 결정적으로 다시 만든다. 결과 트리 해시가 현재 검토본과 같으면 아무 일도 하지 않고, 다르면 새 초안(`DraftInfo.parent` = 앞 초안)과 `update` 검토 항목(`baseHash` = 현재 검토본)을 만든다. 카드가 "하는 일의 차이"를 보인다.
- **가져온 뒤 고친 경우.** 사용자가 담당 AI로 그 플러그인을 고쳐 검토본이 마이그레이션이 마지막으로 만든 트리와 다르면 3자 비교를 한다(기준 = 마지막으로 만든 트리, 하나는 현재 검토본, 하나는 새로 만든 트리). 현재 검토본이 기준과 같으면 앞으로 감는다(갱신 초안). 다르면 자동으로 덮지 않고 "이 플러그인은 가져온 뒤 수정되었고 원본도 바뀌었다"를 항목으로 올려 두고 테스트 대화로 병합을 맡기는 단추를 준다(`ContextRef`에 세 버전의 참조).
- 원본에서 사라진 항목: 자동으로 지우지 않는다. 보고서에 "원본에서 사라짐" 줄과 "검토함에 삭제 요청" 단추(`plugin.requestRemove`)만 둔다.
- 새로 생긴 원본 항목은 새 플러그인으로 제안한다(사용자가 정한 묶음 규칙과 이름 규칙을 따른다).
- 모든 생성물은 결정적이다: 같은 입력과 같은 규칙 버전이면 같은 바이트(파일 안에 시각이 없다. 시각은 `migration-state.json`에만 있다).

### 6.6 시크릿

1. 훑기는 환경 변수를 읽지 않는다. `${VAR}` 형태의 참조는 이름만 항목에 남는다.
2. 참조는 `secret://<서버>-<변수>` 시크릿 참조로 바꾸고 이름 패턴(`^[a-z][a-z0-9-]{1,63}$`)에 맞춘다. 매니페스트 `userConfig`에 `sensitive` 키로 선언하고 값은 사용자가 시크릿 저장소에 직접 넣는다. 프로필 검증이 값이 없으면 `secret_missing`/`required_unset`으로 막는다(M5c §3.1). 값의 입력 경로(앱 화면 또는 `fresnel` CLI)는 `L0.secrets.spec`이 정한다 [미확인: 이름을 읽지 않았다].
3. 원본에 시크릿처럼 보이는 리터럴(이름이 `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `CREDENTIAL`, `AUTH`를 포함하는 키의 값, `sk-`·`ghp_`·`Bearer ` 접두 등 알려진 형태)이 있으면 **초안에도 로그에도 보고서에도 값을 싣지 않는다.** 보고서에는 "리터럴 시크릿이 원본에 있다(값은 표시하지 않는다)"와 원본의 키를 교체하라는 권고만 적는다. 이 판정은 `cap-mcp`가 평문 시크릿을 거부하는 규칙(`values.ts:3-4`)과 `ext-host`의 외부 훅 환경 규칙(`env.ts`의 `SECRET_ENV_PATTERN`)과 같은 이름 패턴을 쓴다.
4. 훑기 결과를 담는 메모리는 판정 직후 값을 지운다(`SourceItem.parsed`는 가린 뒤의 값). `~/.claude.json`처럼 시크릿이 섞이기 쉬운 파일은 필요한 키(`mcpServers`, `projects[*].mcpServers`)만 꺼내고 나머지는 보관하지 않는다.
5. "현재 환경 변수에서 시크릿 저장소로 가져오기"는 만들지 않는다(§11 Q8, 기본은 없음).
6. 프로젝트 안의 원본(저장소가 공급한 설정)에서 온 코드(Hook, MCP 명령)는 검토함 카드에 "프로젝트에서 온 코드"를 띄운다(M6 C5의 경고). 훑기만으로는 아무것도 실행되지 않으므로 Claude Code가 겪는 "신뢰 전에 저장소 설정이 돈다"(조사 노트 T12)는 구조적으로 없다.

## 7. 구조

### 7.1 패키지와 층 배치 [제안]

세 부분으로 나눈다.

| 부분 | 이름·위치 | 하는 일 | 의존 |
|---|---|---|---|
| 라이브러리 | `xeon/packages/plugin-migration`(`@fresnel/plugin-migration`) | 원본 어댑터, 중간 표현, 규칙 엔진, 보고서, 폴더 트리 만들기. **순수**: 파일 읽기는 주입받은 `ScanFs` 포트(읽기 전용)로만 하고 네트워크·프로세스·쓰기를 모른다 | `@fresnel/contracts`만(매니페스트 타입과 검증, `McpServerDef`, 에이전트 정의 스키마). `core-*`, `cap-*`, `ext-host`를 import하지 않는다 |
| 호스트 서비스 | `xeon/apps/host/src/assembly/m5/migration.ts`(이름은 M5c의 `m4/` 배치를 따라 조정) | 감지, 훑기 실행(읽기 전용 파일 포트와 샌드박스 자식 프로세스), 상태 파일, 초안 쓰기와 제출, wire 처리 | 라이브러리, `PluginDraftIntake`(§7.5), 프로필 저장소 |
| 화면 | Craft의 목적 화면 "가져오기"(M6 소유) | 단계 1~6의 UI | wire |

**라이브러리이고 번들 플러그인이 아닌 이유.**
(가) 번들 플러그인은 프로필에 들고 대화에서 부르는 단위인데 마이그레이션은 일회성 작업이고 프로필이 없어도(첫 실행, 막힌 프로필) 돌아야 한다. (나) 훑기는 사용자가 고른 홈 폴더와 프로젝트 폴더를 읽어야 하지만 플러그인 프로세스는 자기 검토본 `tree/` 밖을 읽지 못한다(엔진 설계 §3.4). (다) 플러그인이면 Drive나 명령으로 모델이 조작하게 되는데 훑기는 모델의 판단이 필요 없다. (라) 규칙이 결정적이어야 같은 입력이 같은 초안을 낸다(재실행, 검토 동등성).
**플러그인 빌더에 붙이지 않는 이유.** 빌더의 쓰기 root는 그 플러그인의 원본 폴더 하나이고 읽기 root는 원본 폴더와 출력 사본 폴더다(M5c §4.8.7). 원본 하네스 폴더를 읽을 수 없다. 대신 결정적으로 되지 않는 항목만 빌더에게 넘기고 그때는 원본 발췌를 `ContextRef`로 전달한다(§7.6).
**ADR §3.12와의 관계.** 코어(블록)와 플러그인 두 층 가운데 이 패키지는 코어가 아니고 기본 설치 플러그인도 아닌 **플러그인 계층 위의 도구 라이브러리**다(`plugin-builder`와 같은 층의 이웃). 사용자에게 보이는 이름은 플러그인이 아니라 "가져오기"다.

### 7.2 인터페이스

```ts
// @fresnel/plugin-migration
export interface ScanFs {                                   // 읽기 전용. 쓰기·삭제·이름 바꾸기 메서드가 없다
  lstat(path: string): Promise<{ kind: "file" | "dir" | "symlink" | "other"; size: number } | null>;
  listDir(path: string): Promise<readonly string[]>;
  readBounded(path: string, maxBytes: number): Promise<{ kind: "text"; text: string } | { kind: "binary"; bytes: Uint8Array } | { kind: "too_large" } | { kind: "unreadable" }>;
  realpath(path: string): Promise<string>;
}

export interface ScanRoot { readonly path: string; readonly scope: "user" | "project"; readonly label: string }

export interface SourceAdapter {                            // 하네스 하나 = 어댑터 하나(코드) + 규칙 데이터
  readonly harness: HarnessId;
  readonly rulesVersion: string;                            // 이 규칙이 읽은 원본 문서의 날짜·버전
  detect(root: ScanRoot, fs: ScanFs): Promise<readonly DetectedMarker[]>;      // 존재 확인만
  scan(root: ScanRoot, fs: ScanFs, limits: ScanLimits, ctx: ScanContext): Promise<readonly SourceItem[]>;
}

export interface SourceItem {
  readonly itemId: string;                                  // hash(harness, kind, scope, keyPath)
  readonly harness: HarnessId;
  readonly kind: IrKind;                                    // §4.1
  readonly scope: "user" | "project" | "local" | "managed" | "plugin";
  readonly path: string;                                    // 홈은 ~로
  readonly keyPath?: string;                                // JSON/TOML/YAML 안의 위치
  readonly sha256: string;
  readonly bytes: number;
  readonly ir: IrNode;                                      // 가린 뒤의 중간 표현(시크릿 값 없음)
  readonly secrets: readonly { keyPath: string; kind: "env_ref" | "literal"; name?: string }[]; // 값 없음
  readonly warnings: readonly string[];
}

export interface MigrationScan { scanId: string; roots: ScanRoot[]; items: SourceItem[]; unrecognized: SourceItem[]; diagnostics: ScanDiagnostic[]; limits: ScanLimits }

export interface Ruleset { harness: HarnessId; rulesVersion: string; rules: readonly Rule[] }   // 데이터(JSON). §7.3
export interface MigrationProposal { proposalId: string; scanId: string; plugins: PlannedPlugin[]; projectActions: ProjectAction[]; profileProposals: ProfileProposal[]; questions: Question[]; report: ReportLine[] /* 질문이 닫히기 전에는 "예상" */ }
export interface PlannedPlugin { name: string; purpose: string; derivedFrom: string[]; tree: ReadonlyMap<string, Uint8Array>; pendingBuilder: string[] /* 결정적으로 못 만든 itemId */ }

export function propose(scan: MigrationScan, rules: readonly Ruleset[], choices: Choices): MigrationProposal;   // 순수·결정적
export function emit(plan: PlannedPlugin): ReadonlyMap<string, Uint8Array>;                                   // 순수·결정적
```

규칙: `propose`와 `emit`은 시각, 난수, 환경을 쓰지 않는다(재실행 동일성). 시험은 같은 입력으로 두 번 돌려 바이트가 같은지 본다.

### 7.3 매핑 규칙을 데이터로 [제안]

새 하네스의 구성요소를 더하는 일이 코드 변경이 아니라 데이터 변경이 되게 한다. 규칙은 JSON 파일이고 패키지 안 `rules/<하네스>.json`이다.

```jsonc
{
  "harness": "claude-code",
  "rulesVersion": "2026-11-17",
  "docs": ["https://code.claude.com/docs/en/hooks", "https://code.claude.com/docs/en/skills"],
  "sources": [
    { "id": "skills-user",   "scope": "user",    "glob": "~/.claude/skills/*/SKILL.md", "parser": "agent-skill" },
    { "id": "skills-proj",   "scope": "project", "glob": ".claude/skills/*/SKILL.md",   "parser": "agent-skill" },
    { "id": "mcp-proj",      "scope": "project", "glob": ".mcp.json",                    "parser": "mcp-json" }
  ],
  "toolNames": { "Bash": "bash", "Read": "read", "Write": "write", "Edit": "edit", "MultiEdit": "edit", "Grep": "grep", "WebSearch": "web_search", "WebFetch": "web_fetch" },
  "rules": [
    {
      "match": { "kind": "skill", "field": "allowed-tools" },
      "target": "drop",
      "status": "not_ported",
      "reason": { "code": "skill_preapproval_unsupported", "text": "스킬별 도구 미리 승인이 없다" },
      "difference": { "kind": "approval_flow", "text": "이 스킬을 쓸 때 승인 카드가 더 뜰 수 있다" }
    },
    {
      "match": { "kind": "hook", "event": "PreToolUse" },
      "target": { "position": "tool.call.before", "transform": "hook-adapter" },
      "status": "exact_or_differs"
    }
  ]
}
```

- `parser`와 `transform`은 코드에 등록한 이름이다(작은 순수 함수들). 규칙표는 어떤 항목이 어디로 가고 어떤 충실도와 이유 문장을 가지는지를 데이터로 갖는다.
- 규칙표에 없는 항목은 자동으로 "이식하지 못함: 규칙 없음(알 수 없음)"이 된다. 이것이 "조용한 누락 없음"의 기계적 근거다.
- 규칙표의 `docs`와 `rulesVersion`이 보고서 머리에 실려 사용자가 어느 시점의 원본 형식 기준인지 안다.
- 규칙표와 어댑터가 읽는 위치는 같은 소스 데이터에서 파생한다(감지 표지 목록도 `sources`에서 계산).
- 기존 코드 재사용: `cap-mcp/src/servers/loader.ts`의 `convertEntry`·`normalizeServerName`·`parseMcpJson`과 `checkDefinitionValues`는 `mcp-json` 어댑터의 파서가 된다(엔진에서 읽기를 없애면서 이 코드를 라이브러리로 옮기고 `cap-mcp/test/loader.test.ts`의 사례를 어댑터의 정답 시험으로 옮긴다).

### 7.4 훑기의 샌드박스

- **읽기 전용 포트.** 라이브러리는 `ScanFs`만 받는다(쓰기 메서드가 없다). 호스트는 이를 자식 프로세스 안에서 `node:fs`의 읽기 호출로만 구현하고, 훑는 루트 밖으로 나가는 심볼릭 링크와 `..`를 따라가지 않으며, 파일 크기 상한(파일당 1 MiB, 스킬 폴더 합계는 M5c §4.6.1의 상한 2000개·32 MiB를 따른다), 깊이 16, 한 번 훑기의 파일 수 상한을 둔다. `~/.claude.json`은 16 MiB까지 읽고 필요한 키만 꺼낸다.
- **프로세스.** 훑기는 엔진 밖의 자식 프로세스 `migration-scan --stdio`에서 돈다(호스트 진입 `main.ts`의 가벼운 분기, 본체는 `apps/host/src/migration-scan/`). 띄우기는 기존 `IsolationProcessPort.spawn`(`fresnel.process`)이고 새 격리 방식은 없다. 샌드박스는 쓰기 없음 프로필(쓰기 루트 없음)이고 읽기는 허용 목록이다: 첫 정규 루트(자식의 작업 폴더), 나머지 정규 루트, 실행 파일, 소스 실행이면 소스 작업 공간. 네트워크 정책은 샌드박스의 전역 정책을 따른다(엔진 설계 §3.4). 자식은 표준 입력의 요청 줄 하나 `{roots, homeDir}`를 읽고, 루트마다 진행 줄 `{kind:"progress", done, total}`을 쓰고, 끝에 `{kind:"ok", limitReached, scan}` 또는 `{kind:"error", code}` 줄 하나를 쓰고 끝난다. 엔진은 자식의 줄을 TypeBox 스키마(`parseScanChildLine`)로만 받고, 원본 파일 내용을 읽거나 파싱하지 않는다. 바이트는 base64로 옮긴다. 다음은 [제안]이다. 기한은 120초이고 넘으면 자식 트리를 죽이고 `timeout`이다. 응답 전체 상한은 64 MiB이고 넘으면 죽이고 `bad_reply`다. 응답 없이 종료 코드 0으로 끝나면 `bad_reply`, 그 밖의 비정상 종료나 `error` 줄이면 `crashed`다. 격리를 쓸 수 없으면 띄우지 않고 `unavailable`이다. 격리 불가는 샌드박스 상태가 쓸 수 없거나(`status().available`이 거짓), 샌드박스 서비스나 띄우기 포트가 없거나, 띄우기가 `sandbox_unavailable`로 거절된 경우다. Windows는 샌드박스가 없으므로 이 경우에 든다(이전 문장의 "프로세스 분리와 읽기 전용 포트만 적용"을 바꾼다). 이 실패들은 wire에서 `store.io`로 나가고 `details.code`가 `scan_<이유>`다(§9.4).
- **실행하지 않는다.** `` !`cmd` ``, `headersHelper`, `apiKeyHelper`, 훅 명령, 설정의 어떤 명령도 실행하지 않는다. 문서를 열어도 파서가 아니라 텍스트로만 다룬다.
- **원본 불변.** 시험에서 쓰기·삭제 호출이 `ScanFs`에 없음을 구조로 보이고, 호스트 통합 시험이 원본 폴더 트리 해시(파일 목록, 수정 시각 포함)가 훑기·제안·초안 전후에 같음을 확인한다(수용 기준 5).
- **신뢰하지 않은 폴더.** 훑기는 읽기이고 폴더 신뢰 판정(`trust.get/decide`)과 무관하다. 그 폴더에서 온 코드는 검토함을 지나야 실행된다.
- **결과를 로그에 남기지 않는다.** 원문 본문, 가린 전 값은 로그에 쓰지 않는다. 항목 경로와 종류와 상태만 남긴다.

### 7.5 초안 내보내기와 검토 항목

- 기존 길: `plugin.draft.create { dir, originThreadId }`와 `pluginReview.submitDraft`, 빌더의 `PluginSubmitPort.submit`은 "담당 AI만 부른다"(M5c §3.5)이고 `provenance: "assistant"`를 쓴다. 마이그레이션은 AI가 아니다. M5c §4.10의 지침 추가(`plugin.draft.fromInstruction`, `provenance: "user_instruction"`)와 같은 모양으로 **앱이 폴더를 만들고 초안과 검토 항목을 만든다.**
- [제안] 호스트 안에 공유 입구 `PluginDraftIntake.submit({ dir, provenance, originThreadId?, evidence, purpose })`를 두고(`plugin.draft.create`와 `pluginReview.submitDraft`를 한 번에 한다), `PluginSubmitPort`(빌더용, `assistant` 고정), `fromInstruction`(`user_instruction` 고정), 마이그레이션 서비스(`migration` 고정)가 각자 좁은 얼굴로 그것을 부른다. wire 메서드가 아니다.
- [제안] `Provenance`에 `"migration"`을 더한다. 손으로 고친 것으로 보이는 변경(`unknown`)과 달리 승인할 수 있다(`pluginReview.handEditNotAllowed`에 걸리지 않는다). 카드는 "가져온 항목" 구역(원본 경로, 이 플러그인의 보고서 줄, 차이 목록)을 보인다.
- 증거 참조: M5d의 `EvidenceRef`에 `{ kind: "migration", scanId, itemIds }`를 더해 달라고 요청한다(§12). 대안은 카드가 `.fresnel-plugin/migration.json`을 직접 읽는 것이다. 이 파일은 시각이 없고 출처 경로(홈은 `~`), 원본 해시, `rulesVersion`, 이 플러그인의 보고서 줄을 담아 해시에 들어가므로 원본이 바뀌면 새 버전이 되고, 플러그인이 나중에 공유되어도 출처가 따라간다. 시크릿 값과 절대 경로의 사용자 이름은 싣지 않는다.
- 원본 폴더에 쓴 직후 원본 감시(`sourceWatch`)가 "원본 해시가 검토본과 다름"으로 `provenance: "unknown"` 항목을 따로 만들면 안 된다. 같은 해시의 대기 항목이 이미 있으면 새 항목을 만들지 않는다는 규칙이 M5c-1에 필요하다(수용 기준 12, §12 요청).
- 목적 한 문장은 변환이 결정적으로 만든다(스킬은 `description`, MCP는 "`<서버>` MCP 서버(<하네스>에서 가져옴)" 형태). 없으면 승인할 수 없다(M5c §4.7.6).

> **구현 상태(M5c 공유 입구 단계, 2026-11-18).** 공유 입구는 `apps/host/src/assembly/plugins/intake.ts`의 `createPluginDraftIntake(admission)`이다. 입구의 본체(`admitCore`, 준비 → 초안 → 항목)와 직렬 큐는 검토 서비스 `review.ts`가 쥔다. 얼굴은 셋이다. 담당 AI(`submitPort`, `assistant`, 증거 한 개 이상), 한 줄 지침(`fromInstruction`, `user_instruction`), 마이그레이션(`apps/host/src/assembly/plugins/migration-submit.ts`의 `createMigrationSubmitter`, `migration`). 입구의 `submit`은 `{ dir, provenance, originThreadId, originProfileId?, evidence, purpose?, prepare? }`를 받는다. `assistant`만 증거를 요구하고 타입과 실행 때 둘 다 본다. `migration`은 `originThreadId: null`에 증거 없이 제출한다. [제안] 입구는 검토 서비스 전체가 아니라 `admit` 한 면을 받는다. 초안과 항목을 한 직렬 구간에서 만들어야 해서다. `prepare`는 초안보다 먼저, 같은 구간 안에서 돈다.
>
> 마이그레이션 제출(`createMigrationSubmitter`의 `submitPlanned`)은 다음을 한다. (1) 계획마다 `emit()`의 트리를 임시 폴더에 쓰고 `readPluginFolder`로 검사한다. 이름이 규칙에 어긋나면 `draft_invalid`(`name_invalid`), 절대 경로와 `..`와 빈 조각은 `path_invalid`, 폴더 검사 실패는 `draft_invalid`다. 하나라도 거절되면 아무것도 쓰지 않는다. (2) 통과한 트리를 `<userDir>/<이름>/`에 쓴다. 파일은 `0644`이고 `emit`은 실행 비트를 내지 않는다. (3) 최근 승인본과 내용 해시가 같은 계획은 건너뛰어 결과에 들지 않는다(수용 14). (4) 같은 이름의 폴더가 있으면 새 버전은 최근 승인본이 `migration`이고 폴더 내용 해시가 그 승인본과 같을 때만이다. 손으로 고친 폴더는 아니다. 이 규칙은 §4.10.4의 지침 규칙과 같은 방식이다 [제안]. 새 버전을 쓸 때는 옛 파일 가운데 새 트리에 없는 것을 지운다. 그 밖의 충돌은 `{ kind: "exists" }`(`plugin.exists`)다.
>
> 원본 감시와의 중복(수용 12): 쓰기, 초안, 항목이 한 직렬 구간이라 훑기가 그 사이에 끼지 못한다. 쓴 뒤의 훑기는 같은 후보 해시의 대기 항목이나 승인본을 보고 `unknown` 항목을 만들지 않는다. 이 규칙은 `review.ts`의 `scanEntry`가 이미 가지고 있었다. 확인은 `test/assembly/plugins/migration-submit.test.ts`가 한다. 승인 규칙(`migration`은 `handEditNotAllowed` 없이 승인, 목적이 비면 `purpose_required`, 승인 전에는 대기 이름이고 재료가 읽지 않는다)은 `test/assembly/plugins/intake.test.ts`가 본다.
>
> 증거: `EvidenceRef.kind: "migration"`은 추가하지 않았다. 마이그레이션 항목은 증거 없이 제출한다. 증거 자리는 M5g가 정한다(Q9).
>
> M5g에 남는 것: wire `migration.*`(`apply`가 `engine.ports.pluginMigration.submitPlanned`를 부른다. 포트는 `types.ts`의 `EnginePorts`에 있고 wire로 열지 않는다), 상태 파일과 훑기 샌드박스, 카드의 "가져온 항목" 구역, 원본 폴더를 손으로 고친 뒤 다시 가져오는 정책. 저장소 실패로 쓴 뒤 초안이 실패하면 폴더가 남고, 그 폴더는 다음 훑기가 `unknown` 항목으로 올릴 수 있다. 쓰기를 되돌리는 방법은 M5g가 정한다 [미결] [근거: 이 절의 M5g 범위].

### 7.6 테스트 대화(빌더)를 쓰는 곳

결정적으로 만들 수 없거나 만들어도 의미가 어긋나기 쉬운 항목은 모델이 판단해야 한다. 빌더에게 맡긴다.

| 항목 | 이유 |
|---|---|
| opencode 플러그인, pi 확장, Gemini 확장의 코드 | 코드의 의미를 템플릿으로 바꿀 수 없다. 대상 API가 다르다(`pi.on("tool_call")` → `g.on("tool.call.before")` 정도는 비슷하지만 입력·결정 모양이 다르다) |
| `` !`cmd` `` 치환이 어색한 스킬 본문, `context: fork` 스킬 | 본문 재작성이 필요하다 |
| 설명이 1024자를 넘는 스킬, 이름 규칙 위반 | 사용자가 "빌더에게" 를 고른 경우 |
| 규칙의 `fileRegex`나 맞춤 모드의 도구 제한을 막는 Hook | 코드 생성이 필요하다 |
| 가져온 뒤 고친 플러그인의 3자 병합 | 병합 판단이 필요하다 |

방식: 호스트가 해당 플러그인의 골격 폴더(`migration.json`에 `pendingBuilder` 항목 목록)를 `<config>/plugins/<이름>`에 만들고 `craftChat.open { plugin, reuse: "new", context: ContextRef { kind: "migration", scanId, itemIds }, intent }`로 테스트 대화를 연다(M5c §4.8). 원본 발췌는 모델 문맥에 넣지 않고 지연 도구 `authoring_context`가 `CraftContextPort`로 필요한 만큼 읽는다(M5c §4.8.8). 읽는 내용은 가린 뒤의 중간 표현과 해당 원본 파일 발췌(상한 16 KiB)이고 시크릿 값은 없다. 빌더는 그 폴더에 쓰고 검증 후 `authoring_submit`으로 보낸다(M5c §4.9). 이 항목들의 보고서 줄은 초안이 제출될 때 `differs`(빌더가 만든 차이를 적음)로 닫히고, 사용자가 그만두면 "이식하지 못함: 사용자가 건너뜀"이다. `ContextRef`의 종류에 `migration`을 더하는 것은 M5c §4.8.8과 M6 §4.4에 대한 요청이다(§12).

### 7.7 wire 메서드 [제안]

이름은 `METHOD_NAME_PATTERN`을 따르고 오류 코드는 3670~3679(예약 구간 일부) 또는 통합 담당이 정한다. 계약은 C0 동결 때 확정한다.

| 메서드 | params | result | 비고 |
|---|---|---|---|
| `migration.detect` | `{ projectId? }` | `{ found: { root, marker, harness }[] }` | 존재만. 내용을 읽지 않는다 |
| `migration.scan` | `{ roots: ScanRoot[]; harnesses?: HarnessId[] }` | `{ scanId; summary }` | 비동기, 진행은 `migration.progress` 알림 |
| `migration.proposal` | `{ scanId; choices? }` | `{ proposal }` | 질문이 열려 있으면 `questions`가 채워진다 |
| `migration.apply` | `{ proposalId; choices }` | `{ drafts: { name; draftId; itemId }[]; reportId }` | 질문이 모두 닫혔을 때만. 초안과 검토 항목을 만든다 |
| `migration.report.get` | `{ reportId }` | `{ report }` | |
| `migration.dismiss` | `{ root; marker }` | `{}` | 같은 표지의 알림을 다시 띄우지 않는다 |

알림: `migration.progress`, `migration.changed`. 오류: `migration.scanLimit`, `migration.rootInvalid`, `migration.questionsOpen`, `migration.nameConflict`, `migration.unsupportedHarness`.

## 8. 제거 계획

### 8.1 지금 코드에서 다른 하네스 형식을 읽는 곳

`/Users/user/fresnel-tracks/cyP/xeon` 읽기 결과다(`path:line`은 이 시점 값).

| # | 위치 | 하는 일 | 제거할 것 |
|---|---|---|---|
| 1 | `packages/cap-mcp/src/servers/definitions.ts:30-33` | `MCP_JSON_FILES`에 `{ relative: ".fresnel/mcp.json", origin: "fresnel" }`와 **`{ relative: ".mcp.json", origin: "root" }`(:31)**. `:47`의 `wantsFiles = settings.importMcpJson && root !== undefined`, `:55-75`가 신뢰 뒤 읽고 `parseMcpJson`을 부른다. `:56`이 출처 표기 `mcpjson:project`/`mcpjson:fresnel`을 정한다 | `.mcp.json` 항목(:31), `origin === "root"` 분기(`:56`), `McpJsonOrigin`의 `"root"`. `.fresnel/mcp.json`(Fresnel 자체 배치)은 M5c-1이 프로젝트 동반 플러그인으로 대신 읽을 때 같이 처리한다(M5c §4.4.10) |
| 2 | `packages/cap-mcp/src/servers/loader.ts:12-22, 96-` | **`:12`는 머리 주석이다**(M5c §4.4.10, §7.9와 `m5-plan.md`가 "읽는 곳"으로 가리킨 줄). 실제 변환은 `convertEntry`(`:42-`), `normalizeServerName`(`:17-22`), `parseMcpJson`(`:96-`, `:106`의 출처 표기)이다 | `parseMcpJson`의 `"root"` 분기와 `mcpjson:project`. 변환 코드는 `@fresnel/plugin-migration`의 `mcp-json` 어댑터로 옮긴다(§7.3) |
| 3 | `packages/cap-mcp/src/settings.ts:38-45, 180, 200, 271` | 설정 `l2.mcp.importMcpJson`(기본 `true`, 범위 managed·user·project) 정의, 타입, 기본값, 읽기 | 키 전체. 설정 카탈로그에서 키가 사라지므로 파일에 남은 키는 "알 수 없는 키" 경고만 낸다(M5c §7.1과 같은 처리) |
| 4 | `packages/cap-mcp/src/types.ts:5, 18`, `ports/files.ts:4`, `ports/trust.ts:3`, `transport/factory.ts:72`, `client/service.ts:104, 151`, `packages/platform-secrets/src/mcp-start.ts:14` | `.mcp.json`·`mcpjson:project`를 말하는 주석과 `requiresTrust` 설명 | 주석과 문구 정리. `requiresTrust`는 project 범위 설정에는 남는다 |
| 5 | `packages/contracts/src/wire-settings/wire/ext-read.ts:1184-1185, 1278` | `MCP_SERVER_ORIGINS = ["mcpjson", "settings", "extension"]`와 설명 | `.mcp.json` 출처가 사라지면 `mcpjson`은 `.fresnel/mcp.json`용으로 남거나 M5c-1이 바꾼다. wire 모양이 바뀌면 `WIRE_PROTOCOL_VERSION`은 통합 담당이 한 번에 올린다 |
| 6 | `packages/ext-host/src/loading-trust/trust/resources.ts:13, 20` | `PROJECT_MCP_JSON = ".mcp.json"`이 `TRUST_REQUIRING_PROJECT_RESOURCES`의 첫 항목. 폴더 신뢰 판정을 요구하는 자원 | 항목 제거 |
| 7 | `packages/ext-host/src/loading-trust/trust/resources.ts:35, 53-66` | `SHARED_SKILLS = ".agents/skills"`, 프로젝트 루트와 상위 폴더들의 `.agents/skills`(`../.agents/skills` 형태)를 자원으로 판정, 홈의 것은 제외(`userSkills`, `:53`) | 상수와 상위 폴더 순회 코드 전체 |
| 8 | `packages/ext-host/src/loading-trust/trust/resolve.ts:94` | `findTrustRequiringResources`를 불러 `required`와 `resources`를 정한다(`:95-98`) | 변경 없음(위 1~2번의 결과가 줄어든다) |
| 9 | `apps/host/src/assembly/trust-preview.ts:60-61` | `PROJECT_MCP_JSON`과 `MCP_FILES`(신뢰 카드의 MCP 서버 이름·명령 미리 보기) | `.mcp.json` 제거. `.fresnel/mcp.json`은 M5c-1과 함께 정리 |
| 10 | `apps/desktop/src/views/pages/settings/settings-sections.ts:213`, `settings-mcp-policy.tsx:16` | 설정 화면의 `l2.mcp.importMcpJson` 토글 | 두 곳에서 키 제거 |
| 11 | `packages/group-guide/skills/fresnel-agent-assets/SKILL.md:16`, `references/mcp-schedule-agents.md:5, 10, 11, 32` | **모델이 읽는 안내 문서**가 `.mcp.json`이 읽힌다고 가르친다 | 같은 커밋에서 고친다. 안 고치면 모델이 존재하지 않는 기능을 사용자에게 안내한다 |
| 12 | 시험 | `cap-mcp/test/{loader,reload,trust,start-gate,project-command-approval,settings}.test.ts`, `ext-host`의 신뢰 시험, `contracts/test/wire-settings/methods.test.ts:659`, `contracts/test/capabilities/mcp-defs.test.ts:371` | 기대값 수정. `loader.test.ts`의 변환 사례는 어댑터 시험으로 이동 |
| 13 | 문서 | `docs/xeon/L2/mcp/spec.md` §4.2, `docs/xeon/X/loading-trust/spec.md` §4.7.2, `docs/xeon/L2/*`의 `.agents/skills` 언급 | 층 스펙을 코드와 같은 커밋에서 고친다 |

**확인한 사실 둘.** (가) `.agents/skills`는 **폴더 신뢰 판정에서만** 읽힌다. 스킬을 싣는 코드(`cap-knowledge/src/skills/roots.ts:33-42`의 `resolveSkillRoots`)는 `<데이터>/skills`, 신뢰한 프로젝트의 `.fresnel/skills`, 설정 `skills.paths`만 읽고 `.agents/skills`를 읽지 않는다. 그래서 제거로 사라지는 스킬 로딩은 없다. 바뀌는 것은 신뢰 카드가 뜨는 조건뿐이다. 사용자가 `skills.paths`에 `.agents/skills`를 직접 적었다면 그것은 Fresnel 설정이므로 M5c §7.5의 느슨한 스킬 루트 정리가 다룬다. (나) 루트 `.mcp.json`은 실제로 연결되던 서버를 만든다(기본 켬, 신뢰 뒤). 이쪽이 사용자에게 보이는 회귀다.

### 8.2 사용자에게 보이는 동작 변화

| 변화 | 영향 |
|---|---|
| 루트 `.mcp.json`의 서버가 더는 연결되지 않는다 | 도구가 조용히 사라진다. 이것이 "조용한 누락"이라서 알림이 필수다(§8.3) |
| `.mcp.json`이나 상위 폴더의 `.agents/skills`만 있던 폴더가 신뢰 카드를 더 띄우지 않는다(`required: false` → `notRequired` 허용) | 줄어드는 질문이고 위험이 줄지는 않는다. 그 파일 안의 코드는 이제 실행되지 않기 때문이다 |
| 설정 `l2.mcp.importMcpJson`과 그 토글이 사라진다 | 설정 화면에서 항목 하나가 빠진다. 파일에 남은 키는 경고만 낸다 |
| 신뢰 카드의 MCP 서버 미리 보기에서 `.mcp.json`이 빠진다 | |
| 모델용 안내(`fresnel-agent-assets`)가 `.mcp.json`을 말하지 않는다 | |

### 8.3 순서와 전환

확인: 제거는 사용자에게 보이는 동작 변화이므로 변환 경로가 생기기 전에 나가면 안 된다(`m5-plan.md` M5g, R4, 위험 표). 전환은 세 단계다 [제안].

1. **M5g-0 (감지와 알림, 동작 변화 없음).** 감지를 넣고 `migration.log`에 "읽지 않게 될 형식 발견"(`foreign_format_found`: 프로젝트, 표지 이름, 개수)을 남긴다. 릴리스 노트에 "다음 릴리스부터 `.mcp.json`과 `.agents/skills`를 읽지 않는다"를 먼저 쓴다. 이 단계는 M5c-1과 무관하게 나갈 수 있다. 읽기 호환은 아직 동작한다.
2. **M5g-1 (변환 경로).** 라이브러리, 호스트 서비스, 첫 조각(§9)이 나간다. M5c-1의 초안·검토함 경로가 있어야 한다. 이 단계 뒤에는 "다른 하네스에서 가져오기"로 `.mcp.json`과 `.agents/skills`의 내용을 플러그인 초안으로 만들 수 있다.
3. **M5g-2 (제거).** §8.1의 1~13을 제거한다. 나가는 조건: M5g-1의 수용 기준 1~12와 25~27이 통과하고, M5c-1의 로더가 대신 읽기 시작한다(`m5-plan.md` §의존: "M5c-1 → M5g의 제거"). 이 단계의 첫 실행에서 **한 번의 알림 카드**를 띄운다: "이 폴더의 `.mcp.json`은 더 이상 읽지 않아요. [가져오기] [나중에] [다시 보지 않기]". [가져오기]는 목적 화면 "가져오기"를 그 프로젝트 범위로 연다. 읽지 않는 파일은 지우지 않는다. 알림은 프로젝트를 열 때마다(해제하지 않았다면) 다시 보인다.

M5g-0과 M5g-1을 한 릴리스에 같이 내도 된다. M5g-2는 M5g-1보다 앞서지 않는다. 설계 단계에서 하나의 릴리스로 묶는 것(변환 기능과 같이 나감)과 릴리스 노트만 먼저 내는 것 가운데 앞의 것이 더 안전하다 [제안].

### 8.4 이미 쓰고 있는 사용자의 데이터

| 데이터 | 처리 |
|---|---|
| 사용자·프로젝트 설정의 `l2.mcp.importMcpJson` | 키를 지운다(백업 `settings.json.pre-migration`). 프로젝트·local 설정 파일은 저장소 파일이라 지우지 않고 무시하며 `legacy_key_ignored` 진단 한 번 |
| 알려진 프로젝트의 `.mcp.json` | 지우지 않는다. 감지 알림과 가져오기로 안내 |
| `.mcp.json` 서버의 기동 승인 기록(`McpStartEvidence`, 정의 해시와 서버 id로 묶임) | 새 플러그인의 서버는 출처가 달라 해시가 다르므로 처음 기동할 때 다시 묻는다. 의도한 동작이고 알림에 적는다 |
| 폴더 신뢰 기록(`trust.get/decide`) | 그대로. 판정 조건만 줄었다 |
| 원래 `.mcp.json`이 이미 `secret://` 참조를 쓰던 경우 | 어댑터가 Fresnel식 참조를 그대로 통과시킨다(`values.ts:52-60`이 이미 그 형식을 받는다). 평문 시크릿처럼 보이는 값은 이미 거부되던 항목이라 변환 때 보고서에 "원본에서도 읽히지 않던 항목"으로 적는다 |
| 지금 `${VAR}`를 쓰던 `.mcp.json` | 지금도 Fresnel은 `${VAR}`를 확장하지 않는다(리터럴로 연결된다). 그래서 이 항목은 이미 의도대로 돌지 않았다. 가져오기가 시크릿 참조로 바로잡는다 |

## 9. 단계와 크기

크기: S 하루 안쪽, M 며칠, L 한 주 이상(리드 병렬 기준 어림이고 측정값이 아니다. `m5-plan.md`의 M5g 어림 "구현 1~2주"는 조각 1과 제거를 합한 값으로 본다).

### 9.1 권하는 첫 조각 [제안]

**조각 1: 지금 제거되는 형식과 Claude Code의 정적 구성요소.** 이유: 제거되는 두 형식(루트 `.mcp.json`, `.agents/skills`)이 정확히 여기에 있고, 결정적으로 변환되며 코드 생성과 격리(P1)가 필요 없고, 변환이 닿는 곳은 M5c-1의 폴더·검토함 경로뿐이다. 그래서 제거(M5g-2)의 선행 조건을 가장 싸게 채운다.

| 구성요소(조각 1) | 하네스 |
|---|---|
| MCP 서버(`.mcp.json`, `~/.claude.json`의 서버, `.cursor/mcp.json` 같은 같은 형식) | `mcp-json` 어댑터 |
| 스킬(`.agents/skills`, `.claude/skills`, `~/.claude/skills`, `~/.agents/skills`) | `agent-skills` 어댑터 |
| Claude 슬래시 명령, 서브에이전트, 사용자 `CLAUDE.md`와 조건 없는 규칙 | `claude-code` 어댑터 |
| 프로젝트 지침 파일 취급(`AGENTS.md`는 이식 불필요, `CLAUDE.md`는 대안 안내) | |
| **나머지는 전부 보고서로**: Hook, 권한, 출력 스타일, 설정 키, 플러그인 묶음, 다른 하네스 파일이 항목으로 잡혀 "아직 이식하지 못함(조각 N에서 지원 예정)"이 된다 | 조용한 누락 없음 |

명령 변환은 인자 문법(M5c-1)이 정해진 뒤 켠다. 그 전에는 명령 항목이 "보류(문법 미정)"가 아니라 "이식하지 못함: 인자 문법 미정"으로 보고된다.

### 9.2 조각과 작업

| 조각 | 내용 | 크기 | 의존 |
|---|---|---|---|
| 0 | 이 설계의 확정, 원본 문서 재확인(§12의 [미확인] 닫기), 감지와 `migration.log`(M5g-0) | S | 없음 |
| 1 | 라이브러리 핵심(IR, `ScanFs`, 규칙 엔진, 보고서, 결정적 `emit`, 시험) | M | `contracts` |
| 1 | 어댑터와 규칙: `mcp-json`, `agent-skills`, `claude-code`(명령, 서브에이전트, 지침, 규칙) | M | 도구 이름과 에이전트 정의 스키마(읽음) |
| 1 | 호스트 서비스, `PluginDraftIntake`, wire `migration.*`, `migration-state.json`, 훑기 샌드박스 자식 프로세스 | M | M5c-1(로더, 검토함, 초안 경로) |
| 1 | 목적 화면 "가져오기"와 알림(M6 소유) | M | wire |
| 1 | 제거(M5g-2): §8.1의 코드·문구·시험·문서, 알림 카드 | S~M | 위의 항목들 + M5c-1 |
| 2 | Hook: `adapter-hooks` 템플릿, 매처·`if` 평가기, 입력·결정 변환, 정답 사례집, 걸렸을 것 검사(Claude Code Hook, 같은 계열 Cursor·Codex Hook) | L | M5e-1(위치와 결정 어휘), **번들 스크립트 실행 기능(E2/P1 설계)**, P1(초안 격리), M5f(테스트 실행) |
| 2 | 권한 deny·ask 규칙 → `tool.call.before` Hook 플러그인 | M | 조각 2의 어댑터 |
| 3 | Cursor(규칙, MCP, Hook), Codex(`config.toml` MCP, `AGENTS.md`, 스킬), opencode(서브에이전트, 명령, MCP), Cline·Roo(규칙, 모드), pi(스킬, 프롬프트 템플릿) 어댑터와 규칙표 | 하네스마다 S~M | 조각 1의 규칙 엔진 |
| 3 | Gemini(확장, 명령, `GEMINI.md`, Hook) | M | Antigravity 대체 상황 확인 후 [미확인] |
| 4 | 코드로 된 확장(pi 확장, opencode 플러그인, Gemini 확장 코드): 빌더에게 맡기는 흐름(`ContextRef kind: "migration"`, 보고서 줄 닫기) | M | M5f(`authoring_context`, 테스트 대화) |
| 4 | Claude 플러그인·Gemini 확장 묶음(구성요소 풀기, `userConfig` → 매니페스트) | M | 조각 1~2 |
| 4 | 다시 돌리기의 3자 비교와 빌더 병합 | M | 조각 1, M5f |

조각 1을 앞의 둘로 나누면 "라이브러리 + 어댑터"(M+M) 뒤에 "호스트 + 화면"(M+M)이 이어지고, 제거는 마지막이다. 라이브러리와 어댑터는 M5c-1 없이 먼저 만들고 시험할 수 있다(순수이기 때문이다).

### 9.3 의존 요약

| 의존 | 어디서 필요한가 |
|---|---|
| M5c-1(로더, 검토본, 검토함, `plugin.draft.create`, 원본 감시, 프로젝트 동반 플러그인) | 조각 1의 호스트 서비스와 제거 |
| M5c-1의 명령 인자 문법 | 명령 변환 |
| M5e-1(위치 데이터, 결정 어휘 `ask`·`replace`, `decides`) | 조각 2 |
| M5f(테스트 대화, `authoring_context`, `testRun.start`, 초안 제출 경로) | 조각 2의 시험, 조각 4 |
| P1(격리 1단계: 초안이 격리 프로세스에서 돈다) | 조각 2: 초안 Hook을 테스트 실행에서 돌릴 때 |
| 번들 스크립트 실행 기능(E2/P1 설계에 새로 요청) | 조각 2의 시작 조건. 구현됨 [제안]: 커밋 535eca04e(매니페스트 `scripts`와 계약), fef400f0d(격리 자식의 `g.runScript`와 실행기), 074139252(공개 타입 `GroupApi.runScript`). 실행 기록 `HookRun`은 아직 없다 |

### 9.4 구현 상태 (M5g-0, M5g-1 라이브러리, 2026-11-18)

`xeon/packages/plugin-migration`(`@fresnel/plugin-migration`, L3 domain `migration`, 의존은 `@fresnel/contracts`뿐)이 라이브러리를 구현한다. 호스트 서비스, `PluginDraftIntake`, wire, 화면은 아직 만들지 않았다 [근거: 이 트랙의 범위, 계약은 enC1 소유].

| 구현한 것 | 위치 | 수용 기준 |
|---|---|---|
| 읽기 전용 `ScanFs`(쓰기 메서드 없음), 공용 타입, 시크릿 판정(이름 낱말 + `sk-`·`ghp_`·`Bearer` 등 값 형태) | `src/types.ts`, `src/secrets.ts` | 4 |
| 어댑터: 루트 `.mcp.json`과 `~/.claude.json`의 최상위 `mcpServers`, `.agents/skills`·`~/.agents/skills`, Claude Code(사용자 `CLAUDE.md`와 조건 없는 규칙, 스킬, 명령, 서브에이전트, 프로젝트 지침 파일 취급) | `src/adapters/*` | 1, 3, 6, 8, 9, 10, 11, 20 |
| 규칙 데이터(`rules/<하네스>.json`)와 `propose`·`emit`(결정적, 시각·난수·환경 없음) | `src/rules.ts`, `src/propose.ts`, `src/emit.ts` | 1, 2, 3, 7, 8, 9, 10, 11 |
| 감지(M5g-0): 존재만 보는 표지 목록과 "곧 읽지 않게 된다" 값(`ForeignFormatNotice`) | `src/detect.ts` | 18(라이브러리 부분) |

이 조각이 항목으로 잡되 옮기지 않는 것(보고서 줄로만 나간다): Hook, 권한, 출력 스타일, 설정 키, 플러그인 묶음, 경로 조건 규칙, 본문 치환(`` !`cmd` ``, `${CLAUDE_SKILL_DIR}`, 인자 치환), 인자 치환이 든 명령(문법 미정), `.claude.json`의 `projects[*].mcpServers`(local 범위, 훑지 않는다), Claude `timeout`(연결·호출 어느 쪽인지 §3.2.2가 적지 않았다 [미확인]). 다른 하네스(Cursor, Codex, Gemini, opencode, pi, Cline·Roo)는 조각 3이다.

감지 값의 자리: 신뢰 상태 읽기(`trust.get`의 `TrustStatus`)가 이미 `resources`에 `.mcp.json`과 `.agents/skills`(상위 폴더는 `../.agents/skills`)를 싣는다. 감지 값은 이 읽기에 선택 필드로 실을 수 있게 만들었고(`detectForeignFormats`, `foreignFormatNotice`) 호스트 연결은 wire 계약을 소유한 트랙이 한다. 지금의 읽기 동작은 바꾸지 않는다(제거는 M5g-2).

> **구현 상태(M5g 층 B, 호스트 서비스, 2026-11-18).** 호스트 서비스와 wire 처리기를 구현했다. 상세는 `docs/xeon/L4/host-service/spec.md` §4.25다. 구현한 것: 감지(`migration.detect`, `trust.get`의 `foreignFormats`, 숨긴 표지 빼기), 읽기 전용 훑기(루트 검사, 정규 경로 기준 루트 밖 링크와 `..` 거절, 항목 상한, 루트마다 `migration.progress`), 제안(`propose`, 프로젝트 묶음과 사용자 공통 후보), 적용(질문 닫힘 확인, 프로필 이름 확인, 제출 포트 호출, 빈 프로필 생성), 보고서(메모리), 숨김(`migration-state.json`), 알림 `migration.changed`와 `migration.progress`. 시험은 `apps/host/test/assembly/plugins/migration*.test.ts`와 `test/handlers/migration.test.ts`다. 수용 기준 4(읽기 포트에 쓰기 호출 없음, 금지 모듈 검사), 5(원본 트리의 바이트와 mtime 불변), 6(`!`cmd`와 headersHelper가 돌지 않음), 7(값 검색 시험, `secret://` 참조), 12·13·14(승인 전 재료 불포함, 같은 원본 재적용 0개), 19(루트 밖 읽기 거절)를 호스트 층에서 확인했다. 수용 기준 15~17(원본 변경과 삭제 흐름)과 18(화면 알림), 20~33(라이브러리와 엔진, 조각 2·3·4)은 이 층 밖이다.
>
> **[제안]로 정한 기본값.** (가) 훑기는 샌드박스 자식 프로세스 `migration-scan --stdio`에서 돈다(§7.4). 띄우기는 기존 `IsolationProcessPort`이고 새 격리 방식은 없다. 자식은 파일을 읽고 응답 줄을 쓸 뿐이고 `` !`cmd` ``와 headersHelper를 실행하지 않는다. 시험 `migration.test.ts`가 마커 파일로 확인한다(자식 본체를 같은 프로세스에서 돌린다), `migration-scan-isolated.int.test.ts`가 실제 샌드박스 아래의 읽기 경계를 확인한다. 기한 120초, 응답 상한 64 MiB, 격리 불가 처리(띄우지 않고 `unavailable`, Windows 포함)는 [제안]이다. 구현 상태의 한계는 아래 단락에 적는다. (나) 프로필에는 승인된 플러그인만 담는다. 제출 시점에는 빈 프로필을 만들고, 승인할 때 고른 프로필에 넣는다(`validateProfile`이 대기 이름을 `plugin_not_reviewed`로 막기 때문이다). 승인 경로 자체는 이 층 밖이다. (다) 사용자 수준 지침의 공통 후보 이름은 `user-common`이다. (라) 항목 상한 20,000개, 제안 기억 32개, 보고서는 메모리에만 둔다(재시작하면 `migration.notFound`). (마) `migration.changed`는 상태가 바뀐 네 호출(`scan`, `proposal`, `apply`, `dismiss`)에만 보낸다. (바) 식별자는 시작 시각과 순번이다(난수를 쓰지 않는다). (사) 감지는 상위 폴더의 `.agents/skills`를 존재만 확인한다(라이브러리 표지 규칙).
>
> **샌드박스 자식 훑기 구현 상태(M5g 층 B, 2026-11-18).** `migration-scan --stdio`(`apps/host/src/migration-scan/`)와 엔진 쪽 띄우기(`assembly/plugins/migration-scan-child.ts`)를 구현했다. 바뀐 wire 모양은 없다. 훑기 실패는 `scan_failed`(이유 넷: `unavailable`, `timeout`, `crashed`, `bad_reply`)이고 wire에서 `store.io`의 `details.code`가 `scan_<이유>`다. `store.io`의 세부 값에는 `reason` 필드가 없어서(additionalProperties 거부) `code`에 붙였다. 새 번호는 만들지 않았다. 아직 없는 것: 배포 CLI(`fresnel`)에는 `migration-scan --stdio` 진입이 없다. 배포 바이너리에서 자식은 사용 오류로 끝나 `crashed`가 될 것으로 본다(확인하지 않았다) [미결: `apps/cli`의 `plugin-host` 진입과 같은 모양이 필요하다]. 시험은 `test/assembly/plugins/migration-scan.test.ts`(단위: 띄우기, 기한, 크래시, 잘못된 응답, 응답 상한, 격리 불가, 바이트 값 비교), `packages/plugin-migration/test/scan-wire.test.ts`(응답 줄의 왕복과 경계 검사), `test/int/migration-scan-isolated.int.test.ts`(실제 샌드박스)다.
>
> **라이브러리에서 바꾼 것.** `propose`의 반환 타입이 플러그인마다 이식 기록(`migration`)을 싣는다고 드러냈다(`PlannedPluginWithMigration`). 값은 같고 타입만 맞춘다. 제출 포트가 `migration.json`을 쓰는 데 필요하다.
>
> **아직 하지 않은 것.** Hook 스크립트 변환(조각 2)은 이 층 뒤의 조각 2 라이브러리 단락에서 구현했다([제안], 아래). 다음 문장은 그 이전 상태다. 번들 스크립트 실행 기능(E2/P1)과 M5e-1의 위치 데이터, P1 격리, M5f 테스트 실행이 먼저 있어야 하고(§9.3), 이 층에는 그 입력이 아직 들어오지 않았다 [근거: §9.3 의존 요약]. 원본 폴더를 손으로 고친 뒤 다시 가져오는 정책(§6.5), 재시작 뒤의 보고서 보관, 화면과 승인 경로의 프로필 배치, `unsupportedHarness` 오류(지금 wire에는 하네스를 고르는 필드가 없어 이 층에서 낼 자리가 없다 [근거: `packages/contracts/src/wire-settings/wire/migration.ts`의 `migration.scan` 매개변수])는 남는다.
>
> **조각 2 라이브러리 구현 상태(Hook 변환, 2026-11-18) [제안].** `xeon/packages/plugin-migration`에 Claude Code 설정의 `hooks`를 플러그인 드래프트로 바꾸는 라이브러리를 구현했다. 구현한 것: 어댑터(`src/adapters/claude-code.ts`의 `hookItems`, 핸들러마다 항목 하나, 스크립트 읽기는 `ScanFs` 읽기 호출뿐이다), 명령 풀이(`src/adapters/hook-command.ts`, 순수 함수), 규칙 데이터(`src/rules/claude-code.json`의 `hook` 규칙, 지점과 결정 상한과 예산과 이유 문장, 규칙 버전 2026-11-18), 생성 코드(`src/adapters/hook-plugin.ts`, 템플릿 `adapter-hooks@2`: 원본 매처 판정, 입력 모양 변환, 종료 코드와 출력의 결정 변환, `g.on`과 `g.runScript` 호출), 제안과 내보내기(`propose.ts`의 `planHook`과 `hookBuildOf`, `emit.ts`의 `runtime`이 매니페스트 `entry`, `scripts`, `plugins[0]`(`hooks`, `hookDecides`)을 옮긴다). 설정 파일 하나가 Hook 플러그인 하나다. 생성물은 `.fresnel-plugin/plugin.json`, `.fresnel-plugin/migration.json`, `plugin.js`, `hooks.data.json`, `scripts/<이름><확장자>`(원본 바이트 그대로)다. 스크립트 선언 이름은 원본 파일 이름 바탕이고, 시간 제한은 `min(원본 초, 지점 예산 − 1초)`다 [제안].

시험(`xeon/packages/plugin-migration/test`, 246개 중 Hook 관련): 경로 형태별 39개(`hook-command.test.ts`), 어댑터 사례집(이벤트, 핸들러 종류, 스크립트, 시크릿, 모양이 틀린 설정, 수 보존) 29개(`hooks.test.ts`), 생성된 `plugin.js`를 임시 폴더에서 실제로 불러 가짜 `g`로 부르는 값 시험 38개(`hook-plugin.test.ts`): 수용 기준 28(매처 사례집 6행과 입력 모양), 29(결정 변환 표의 모든 행과 여러 훅의 합치기, 어댑터 예외는 던진다), 30(시간 제한과 입력 필드 차이를 항목마다), 2(같은 입력의 두 번째 내보내기는 바이트가 같다), 7(명령과 스크립트의 시크릿 값이 어디에도 없다), 매니페스트 검사(`validateManifest` 통과). 수용 기준 31("걸렸을 것")은 이 조각에서 구현하지 않았다. 턴 기록과 호스트 쪽 시험이 필요하다.

> **2026-11-19 보강 [제안].** (가) 표준 입력 상한(256 KiB)의 실패 정책을 닫았다. 엔진의 거절(던짐, `invalid_params`)은 `tool.call.before`에서 묻기(`ask`)로 바뀌고, 나머지 지점은 통과다. 템플릿은 `adapter-hooks@2`다. 이전 판 §4.3.5는 이 경우를 "통과"로 적었지만 코드는 `tool.call.before`에서 막기(닫힌 실패, `FIRST_DENY`)였다. 막기에서 묻기로 바꾼 것은 사용자가 정한 방향이다. 시험은 `hook-plugin.test.ts`의 "큰 입력" 묶음 다섯 개다(가짜 `g`가 `invalid_params`로 던진다).

호스트와 계약: wire `MIGRATION_IR_KINDS`에 `hook`을 더했다(계약 F 층, `wire-settings/wire/migration.ts`, F 명세 §3.3.4b). 호스트 쪽 카드, 검토 화면, 제출 경로는 바꾸지 않았다. 훑기 결과 항목의 `kind`가 `hook`이 되므로 목록 표시가 이 값을 알아야 한다.

아직 하지 않은 것: `HookRun` 기록과 실행 기록 표시, `if` 조건과 `additionalContext`와 `Stop`의 계속 이유 문장(위 §4.3.5 차이), 문맥 추가를 `g.post`로 주는 길(`SessionStart`, `UserPromptSubmit`), 입력의 `cwd`와 `permission_mode`(대화 폴더와 권한 모드를 Hook 문맥에 주는 길이 없다 [미결] [근거: `xeon/packages/contracts/src/extensions/ops.ts`의 `HandlerContext`에 대화 폴더와 권한 모드가 없다]), 스크립트에 프로젝트 디렉터리 환경 변수를 주는 길(`envNames`는 플랫폼 허용 목록만 받는다), 테스트 실행에서 실제 도구 호출로 막기와 묻기를 확인하는 시험(§7.5의 "스크립트 실행 시험"), 수용 기준 31.

> **CLI 통로.** `docs/xeon`에서 가져오기의 CLI 명령을 찾지 못했다 [근거: `grep -n "가져오기\|migrat" docs/xeon/L4/cli/spec.md`의 결과에 명령이 없다]. CLI는 만들지 않았다.

> **M5g-2 제거 구현 상태(2026-11-18).** §8.1의 1~13번을 옮겼다.
> - 지운 것: 루트 `.mcp.json` 읽기와 출처 `mcpjson:project`(1·2번), 설정 키 `l2.mcp.importMcpJson`과 그 토글(3·10번), 신뢰 자원의 `.mcp.json`과 `.agents/skills`, `.agents/skills`의 상위 폴더 순회(6·7번), 신뢰 카드 미리 보기의 `.mcp.json`(9번), 모델 안내와 명세의 `.mcp.json` 읽기 문장(11·13번). 주석과 문구는 현재 사실로 고쳤다(4·5번).
> - 남긴 것: `.fresnel/mcp.json`(Fresnel 자체 배치, 신뢰 뒤에 읽는다). 설정 키가 든 사용자·프로젝트 설정 파일은 지우거나 바꾸지 않는다. 그 키는 카탈로그에 없어 `settings.readFile`의 `unknownKeys`가 경고만 낸다(§8.4의 "키 삭제"를 이 경고로 대신했다, 백업 파일도 만들지 않았다). 읽지 않는 `.mcp.json`과 `.agents/skills`는 그대로 둔다.
> - 감지: 두 표지의 `engineReads`는 거짓이고 `stoppedReading`이 참이다. 알림의 `willStopReading`은 "이제 읽지 않는 자리"를 뜻하며 필드 이름은 wire 호환으로 그대로다([미결] [근거: `packages/contracts/src/wire-settings/wire/migration.ts`의 `ForeignFormatNoticeSchema`]: 이름 변경 여부). 신호는 `trust.get`의 `foreignFormats`로 계속 나간다.
> - 기동 승인: 루트 `.mcp.json`의 서버는 출처가 `mcpjson:project`에서 가져온 플러그인 출처로 바뀌고 id도 `<플러그인>-<서버 이름>`이 되어 정의 해시가 다르다. 그래서 처음 기동할 때 다시 승인을 묻는다. 의도한 동작이다(§8.4 기동 승인 행).
> - 아직 없음: §8.3의 한 번짜리 알림 카드와 [가져오기] 단추는 목적 화면(M6) 소유라 이 층에서 만들지 않았다.
> - `ResolveProjectTrustInput.homeDir`는 `findTrustRequiringResources`가 쓰지 않게 되어 쓰는 곳이 없다. 지우면 조립과 시험 여러 곳이 바뀌므로 남겼다([미결] [근거: `packages/ext-host/src/loading-trust/trust/resolve.ts`의 `ResolveProjectTrustInput`]).

## 10. 수용 기준

번호는 시험 가능한 문장이다. 괄호는 시험 종류다.

1. (라이브러리) 모든 어댑터 시험에서 `SourceItem` 집합과 `ReportLine` 집합이 같다. 규칙이 없는 항목은 `not_ported`(`no_rule`)이다.
2. (라이브러리) 같은 훑기 입력과 같은 규칙 버전으로 `propose`와 `emit`을 두 번 돌리면 모든 파일의 바이트가 같다(시각·난수·환경 없음).
3. (라이브러리) 알려진 컨테이너(`settings.json`, 스킬 머리말, 서브에이전트 머리말, `config.toml` MCP 항목)에 모르는 키를 넣으면 그 키마다 보고서 줄이 하나 생긴다.
4. (라이브러리) `ScanFs`는 읽기 메서드만 가진다. 쓰기 메서드를 부르는 코드는 타입 오류다. 패키지는 `node:net`, `node:http(s)`, `node:child_process`를 import하지 않는다(검사).
5. (호스트 통합) 훑기·제안·초안 전후에 원본 폴더 트리(파일 목록, 내용 해시, 수정 시각)가 같다. 읽기만 한 파일의 접근 시각은 비교에서 뺀다.
6. (호스트 통합) 훑기는 어떤 명령도 실행하지 않는다: `!`cmd``가 든 스킬, `headersHelper`가 든 MCP, 명령 Hook이 든 설정을 훑어도 프로세스 생성 호출이 0이다.
7. (라이브러리·호스트) 시크릿 값은 초안 파일, 보고서, 로그, wire 응답 어디에도 없다. 환경 변수 참조는 `secret://` 참조와 `userConfig`(`sensitive`)로, 리터럴 시크릿은 참조로 바뀐다. 시험 사례: `${API_KEY}`, `Bearer sk-…`, `env`의 `*_TOKEN`, Codex `bearer_token_env_var`.
8. (라이브러리) `.mcp.json`의 서버는 `McpServerDefSchema`와 `checkDefinitionValues`를 통과하는 `McpServerDef`로 바뀐다. `ws` 형식, `headersHelper`, Cursor `envFile`은 `not_ported`와 이유가 붙는다. 이름 정규화(`[a-z][a-z0-9-]{0,31}`)로 이름이 바뀌면 `renamed` 차이가 붙는다.
9. (라이브러리) 정답 사례집의 스킬 사례: 이름·설명이 규칙을 지키면 폴더가 그대로 복사되고 보고서가 `exact`다. 설명이 1024자를 넘으면 초안을 만들지 않고 질문이 열린다.
10. (라이브러리) 서브에이전트: 모든 `AgentDefinition` 필드 사례가 맞게 번역된다. `model` 별칭은 질문으로 열리고 기본 생략이다. `maxTurns`, `isolation`, `memory`, `hooks`는 `not_ported`다. 도착 정의가 `parseDefinitionFile`을 통과한다.
11. (라이브러리) 지침: Claude `@경로` 가져오기가 깊이 4까지 가져온 자리에서 쪼개져 파일 순서가 보존되고 내용 해시가 원문 해시와 같다. 스캔 루트 밖 가져오기는 `not_ported`다. 지침 본문에 머리글이나 설명 문장이 더해지지 않는다(원문 바이트 보존 시험).
12. (호스트 통합) 앱이 쓴 원본 폴더 때문에 `provenance: "unknown"` 검토 항목이 따로 생기지 않는다. 같은 후보 해시의 대기 항목이 이미 있으면 새 항목이 없다. [구현 2026-11-18: `migration-submit.test.ts`가 쓴 직후의 훑기와 동시 실행을 확인한다]
13. (호스트 통합) 모든 초안은 검토함을 지난다. [구현 2026-11-18: 승인 규칙과 대기 이름은 `intake.test.ts`가 확인한다. 훑기 전체의 재료 차단은 M5g 전체 시험이 맡는다] 승인 전에는 `E(T)`에 들지 않고(`plugin_not_reviewed`) 어떤 코드도 돌지 않는다. `provenance: "migration"` 항목은 승인할 수 있고(`pluginReview.handEditNotAllowed` 없음) 목적 문장이 비어 있으면 승인할 수 없다.
14. (호스트 통합) 같은 원본을 다시 훑어 아무것도 바뀌지 않았으면 새 초안과 검토 항목이 0개다.
15. (호스트 통합) 원본 항목 하나가 바뀌면 그 플러그인의 새 초안(`parent` = 앞 초안)과 `update` 검토 항목(`baseHash` = 현재 검토본)이 하나 생기고 카드가 차이를 보인다.
16. (호스트 통합) 가져온 뒤 검토본이 수정된 플러그인의 원본이 바뀌면 자동으로 초안을 만들지 않고 "수정됨 + 원본 변경" 항목을 올린다.
17. (호스트 통합) 원본에서 항목이 사라지면 어떤 플러그인도 지워지지 않고 보고서 줄과 "삭제 요청" 단추만 생긴다.
18. (화면) 프로젝트를 열 때 감지 알림이 존재만 읽는다(파일 내용 읽기 호출 0). 알림만으로 훑기·초안이 시작되지 않는다.
19. (호스트) 감지·훑기는 사용자가 고르지 않은 폴더(홈 전체 등)를 읽지 않는다. 읽은 경로가 모두 선택한 루트의 하위다.
20. (라이브러리) 프로젝트의 `CLAUDE.md`는 `AGENTS.md`가 없으면 `not_ported`(`not_read_by_fresnel`)와 대안 문장이 붙고, `@AGENTS.md` 한 줄뿐이면 `not_needed`다. 마이그레이션은 프로젝트에 `AGENTS.md`를 쓰지 않는다(쓰기 호출 0).
21. (엔진, M5c-1과 공동) 루트에서 대화 폴더까지의 `AGENTS.md`만 문맥에 실린다. `CLAUDE.md`, `GEMINI.md`, `.cursor/rules`, `.clinerules`, `AGENTS.override.md`는 실리지 않는다.
22. (엔진) 제거 뒤 `.mcp.json`이 있는 폴더에서 `cap-mcp`가 서버를 만들지 않는다(`loadDefinitions`의 서버 목록에 `mcpjson:project` 출처가 없다). 그 폴더가 신뢰 카드를 요구하지 않는다(`required: false`). `.agents/skills`도 같다.
23. (엔진) 설정 카탈로그에 `l2.mcp.importMcpJson`이 없다. 파일에 남은 키는 경고만 낸다. 설정 화면에 토글이 없다.
24. (문서) `fresnel-agent-assets`의 안내와 `L2/mcp/spec.md`, `X/loading-trust/spec.md`에 `.mcp.json`과 `.agents/skills`를 읽는다는 문장이 남지 않는다(검색 시험).
25. (순서) M5g-2(제거)의 병합은 M5g-1의 수용 기준 1~17이 통과하기 전에는 거부된다(릴리스 체크리스트).
26. (화면) 제거 뒤 첫 실행에서, 알려진 프로젝트에 `.mcp.json` 또는 `.agents/skills`가 있으면 알림 카드가 한 번 뜬다. [가져오기]가 그 프로젝트 범위의 목적 화면을 연다. [다시 보지 않기]는 그 프로젝트·표지에 대해서만 저장된다.
27. (통합) 변환→승인→프로필 배치 시험: `.mcp.json` 서버 하나와 `.agents/skills`의 스킬 하나를 가져와 승인해 프로필에 넣으면 새 대화의 도구 목록과 스킬 색인에 나타난다. 스킬 색인의 `(이름, 설명)` 집합이 원본과 같다.
28. (조각 2, 라이브러리) 매처 사례집: `Edit|Write`, `Edit, Write`, `Bash`, `*`, 빈 값, `^Notebook`, `mcp__memory__.*`, 대소문자 오타가 원본 문서의 판정 규칙대로 일치·불일치한다. 어댑터의 입력 변환이 `bash{command, timeout 초}` → `Bash{command, timeout ms}`, `read{path}` → `Read{file_path}`를 만든다.
29. (조각 2, 라이브러리) 결정 변환 표의 모든 행이 시험된다: 종료 코드 2, `deny`, `ask`, `allow`(통과 + 차이), `updatedInput`(기본 `ask`), 종료 코드 1, 시간 초과, 잘못된 출력.
30. (조각 2, 통합) Hook 보고서가 시간 제한 차이(원본 N초, 여기서는 M초)와 입력에 없는 필드 참조(`transcript_path` 등)를 항목마다 적는다.
31. (조각 2, 통합) "걸렸을 것"이 기록된 도구 호출에서 계산되고 스크립트 판정은 "알 수 없음"으로 표시된다.
32. (조각 4) 빌더로 넘긴 항목의 보고서 줄이 초안 제출 때 닫힌다. 사용자가 그만두면 `not_ported`(`user_skipped`)다.
33. (라이브러리) 규칙표에 새 하네스를 더하는 시험: 가짜 하네스의 어댑터 하나와 규칙표 하나를 더해도 엔진 코드는 바뀌지 않는다.

## 11. 미결과 기본값

사용자 결정이 없는 것이다. 작업 기본값을 두고 사용자가 다르게 정하면 고친다.

| # | 질문 | 기본값 [제안] | 근거 |
|---|---|---|---|
| Q1 | 첫 조각은 무엇인가 | §9.1: `mcp-json`, `agent-skills`, Claude Code 정적 구성요소. Hook은 둘째 | 제거되는 형식을 먼저 덮는다. 코드 생성과 격리가 필요 없다 |
| Q2 | 프로젝트 지침 파일로 읽는 이름 | `AGENTS.md`만 [결정: 2026-11-18 사용자] | 읽기 호환을 늘리지 않는다 |
| Q3 | 프로젝트 `CLAUDE.md`를 어떻게 다루나 | 이식하지 못함 + 대안(AGENTS.md 복사 입력 초안, 지침 플러그인으로 가져오기는 범위가 넓어진다는 경고) | 프로젝트 내용을 플러그인으로 바꾸면 의미가 바뀐다 |
| Q4 | 프로젝트 범위 항목을 어디에 두나 | 사용자 플러그인 폴더(`<config>/plugins`) + 프로젝트 이름의 새 프로필 제안 [결정: 2026-11-18 사용자]. 프로젝트의 `.fresnel/plugins`로 쓰기는 사용자가 고르는 선택으로 남긴다 [제안] | 사용자의 저장소를 마음대로 쓰지 않는다 |
| Q5 | 설정 기반 외부 셸 훅(`x.operations.hookDefs`, `fresnel.hook.v1`)의 운명 | 이 항목은 다른 하네스 형식이 아니므로 M5g가 제거하지 않는다. 변환된 Hook은 플러그인으로 간다. 두 길의 합치기는 번들 스크립트 실행 기능이 정해진 뒤 따로 결정한다 | `m5-plan.md`가 이 결정을 M5g 설계 범위로 넘겼다. 이번 조각에서는 건드리지 않는다 |
| Q6 | 조건부 규칙(경로 glob)의 기본 변환 | 필요할 때 읽는 스킬(A). 파일 도구 결과에 붙이는 Hook(B)은 선택 | 코드 없는 쪽이 검토가 가볍다. 대신 자동 첨부가 모델 판단이 된다 |
| Q7 | `PreToolUse`의 `updatedInput`을 낼 수 있는 Hook | 기본 `ask`(`onUnsupported`로 `block`·`ignore`) | 조용히 무시하면 원래 입력이 실행된다. 인자 변경 Hook은 M5e O-6으로 미뤄졌다 |
| Q8 | 현재 환경 변수에서 시크릿 저장소로 값을 옮기는 단추 | 만들지 않는다 | 값을 읽는 길 자체를 두지 않는다 |
| Q9 | 새 `Provenance` 값과 `EvidenceRef` 종류 | `provenance: "migration"`, `EvidenceRef.kind: "migration"`, `ContextRef.kind: "migration"` | 세 곳 모두 다른 스펙의 합집합이라 C0 동결 때 확정. 구현 상태(2026-11-18): `provenance: "migration"`만 추가했다([제안], `docs/xeon/F/wire-settings/spec.md`에 반영). `EvidenceRef.kind`와 `ContextRef.kind`는 보류다(증거 없이 제출, M5g) |
| Q10 | 패키지 이름과 위치 | `xeon/packages/plugin-migration`(`@fresnel/plugin-migration`) | `plugin-builder` 옆 이름 |
| Q11 | 일괄 승인 | 항목별 결정을 한 번에 묶는 화면 기능. 결정 기록은 항목별 | 검토 절차가 하나로 모이는 원칙을 지킨다 |
| Q12 | 사용자 수준 지침의 프로필 배치 | "모든 프로필 공통" 후보로 제안하고 사용자가 고른다 | ADR §3.6.2의 공통 묶음 |
| Q13 | Gemini CLI를 지원할지 | 조각 3 맨 뒤. Antigravity 대체 상황이 확인되면 | 원본 형식이 유효한지 불확실 |
| Q14 | 스킬 하나당 플러그인 하나가 검토 피로를 만드는가 | 묶음 규칙(§6.4)을 제안 화면에서 바꿀 수 있게 한다. 기본은 하나당 하나 | ADR §3.1 |
| Q15 | Hook 시간 제한이 짧아지는 문제 | 어댑터가 자체 시간 제한 + 보고서에 차이. 예산을 프로필로 올릴 수 있는지는 확인 후 | `x.operations.budget.*`의 범위를 읽지 않았다 |

## 12. 다른 스펙에 하는 요청과 확인하지 못한 것

### 12.1 요청

| 대상 | 요청 |
|---|---|
| M5c-1 | (1) 같은 후보 해시의 대기 항목이 있으면 원본 감시가 새 항목을 만들지 않는다. (2) 명령(`commands/*.md`) 인자 문법. (3) `Provenance`에 `migration`. (4) 지침 파일 이름을 `AGENTS.md`로 확정(미결 5). (5) §4.4.10, §7.9, `m5-plan.md` M5g가 가리킨 `loader.ts:12`는 주석이고 실제 읽기는 `definitions.ts:31`과 `:47`이다. 문서의 인용을 고친다 |
| M5d | `EvidenceRef`에 `kind: "migration"` |
| M5e / 엔진 설계(E2, P1) | 번들 스크립트 실행 기능(§4.3.5): 플러그인 검토본 `tree/` 안의 스크립트를 종료 코드와 표준 출력·오류를 분리해 실행, `HookRun`에 기록, 샌드박스 |
| M5f / M6 | `ContextRef.kind: "migration"`, 빌더의 `authoring_context`가 원본 발췌를 읽는 길(가린 뒤의 값, 16 KiB) |
| M6 | 목적 화면 "가져오기", 플러그인 목록(C12)과 프로젝트 패널(C10)의 진입 단추, 검토함 카드(C5)의 "가져온 항목" 구역, 제거 뒤 알림 카드, 용어 등록 요청(가져오기, 가져온 항목, 이식 보고서) |
| `terms.json` | 새 용어 "가져오기"(마이그레이션의 화면 이름) [제안]. 사용자가 이름을 확인한 뒤 용어 트랙이 등록한다 |

### 12.2 확인하지 못한 것

- Claude Code: 플러그인 설치 캐시의 정확한 하위 경로, `prompt`·`agent` 핸들러의 반환 값 모양, `PermissionRequest`·`Notification`의 입력 필드 전부.
- Codex: `notify`의 인자 전달 방식과 이벤트 종류, 스킬 문서(404였다)의 정확한 위치 목록, 훅 문서의 `PreModelRequest`·`PostModelRequest` 의미.
- Cursor: 맞춤 모드의 저장 위치, 맞춤 명령, 옛 `.cursorrules`의 현재 지위.
- Gemini CLI: 문서가 가리키는 Antigravity CLI로의 대체가 이 형식에 어떤 영향을 주는지, Hook 결정값 전체.
- opencode: 플러그인의 Hook 이름과 도구 막기 방법(`/build/plugins/server`를 읽지 않았다).
- Cline: 워크플로와 Hook. Roo: `.roo/mcp.json`과 AGENTS.md 지원.
- Fresnel: 도구 기계 이름 규칙(MCP 도구 이름), `Glob`·`LS` 등에 대응하는 도구의 존재, 명령 인자 문법(M5c-1), `x.operations.budget.*`를 프로필이 바꿀 수 있는지, `sections` 이음 규칙, 시크릿 입력 경로의 이름, 스킬 머리말의 `allowed-tools` 같은 필드를 Fresnel 스킬 로더가 무시하는지 거부하는지(`upstream/skills.ts`는 경고 정책을 따른다고 pi 문서가 적었으나 이 저장소의 사본은 읽지 않았다).
- 이 문서의 모든 충실도 판정은 문서를 읽고 정한 것이다. 원본 하네스 프로그램을 실행해 본 것이 아니다.
- 조사 노트(`research-1`, `research-2`, `research-3`, `research-6`)는 단서로만 썼고 이 문서의 사실은 공식 문서에서 다시 읽은 것만 근거로 했다. 노트의 "함정" 가운데 매처 오타, 플러그인 MCP 이름 접두, 저장소 설정이 신뢰 전에 도는 문제만 이 문서의 설계에 반영했다.

### 12.3 참고 URL

- Claude Code: https://code.claude.com/docs/en/hooks, `/skills`, `/sub-agents`, `/mcp`, `/memory`, `/plugins-reference`, `/plugin-marketplaces`, `/output-styles`, `/permissions`
- Agent Skills: https://agentskills.io/specification, AGENTS.md: https://agents.md/
- Codex: https://learn.chatgpt.com/docs/agent-configuration/agents-md, https://learn.chatgpt.com/docs/extend/mcp?surface=cli, https://learn.chatgpt.com/docs/hooks, https://learn.chatgpt.com/docs/config-file/config-reference.md, https://developers.openai.com/codex/custom-prompts
- Cursor: https://cursor.com/docs/context/rules, https://cursor.com/docs/context/mcp, https://cursor.com/docs/hooks, https://cursor.com/docs/agent/modes
- Gemini CLI: https://geminicli.com/docs/extensions/reference/, `/cli/gemini-md/`, `/cli/custom-commands/`, `/hooks/`
- opencode: https://opencode.ai/docs/agents/, `/commands/`, `/mcp-servers/`, `/rules/`, `/plugins/`
- pi: https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs
- Cline: https://docs.cline.bot/customization/cline-rules, Roo: https://roocodeinc.github.io/Roo-Code/features/custom-modes
