# Claude Agent SDK 도입 검토

조사일 2026-10-19. 대상: Claude Agent SDK(옛 이름 Claude Code SDK). TypeScript `@anthropic-ai/claude-agent-sdk`, Python `claude-agent-sdk`.
확인 수준 표시: [원문] 공식 문서·소스·이슈를 직접 열어 확인, [실험] 이번에 명령을 실행해 확인, [수집] Haiku 수집 메모에서 가져왔고 원문을 다시 대조하지 않음, [추측] 이 문서의 해석.
수집 메모: `.helm-design-work/research/claude-agent-sdk/01~08-*.md`(공식 개요, 권한·훅·샌드박스, 세션·도구·하위 에이전트, 버전, 라이선스·인증, 내부 구조, 커뮤니티 이슈, 대안).
설계 문서는 고치지 않았다. 바꿀 곳은 §6에 적는다.

## 1. 요약

**권고: 런타임 대체와 런타임 내부 병행은 채택하지 않는다. 이후 단계의 외부 런타임 어댑터(13 §3.11, `adapter-claude-code`) 구현 수단으로만 부분 활용하고, 지금 정한 순서(pi RPC → Claude Code → Codex → ACP)를 유지한다.** SDK는 Claude Code CLI 바이너리를 세션마다 자식 프로세스로 띄우고, 대화 기록(JSONL)·컨텍스트·컴팩션·도구 실행을 그 프로세스가 소유한다. Helm의 전제(이벤트 로그가 정본, 커널 단일 변경 경로, 요청마다 컨텍스트 투영, 공급자 중립, 포크 가능한 MIT 부품)와 구조가 맞지 않는다. 어댑터로 쓸 때는 다음 조건을 붙인다. (1) 내장 쓰기·실행 도구를 끄고 Helm 도구를 인프로세스 MCP로 노출하거나, CLI 프로세스 전체를 `helm_bwrap` 안에서 띄운다(`spawnClaudeCodeProcess`). (2) `CLAUDE_CONFIG_DIR`을 Helm 전용 디렉터리로 분리한다. (3) API 키는 CLI 환경에 넣지 않고 데몬 루프백 프록시(`ANTHROPIC_BASE_URL`)에서 붙인다. (4) SDK 버전을 고정하고 적합성 시험(13 §3.11.7)을 올릴 때마다 돌린다. 구독 한도로 Claude를 쓰고 싶다는 요구가 생기면 이 어댑터가 유일하게 공식으로 허용되는 경로이므로, 그때 우선순위를 다시 본다.

## 2. SDK의 현재 상태

### 2.1 버전과 패키지

| 항목 | 값 | 확인 |
|---|---|---|
| TS 최신 | 0.3.303 (2026-10-18). 첫 공개 0.0.4 (2025-09-27). 전체 326개 버전, 2026-03~09 월 23~30개 | [실험] `npm view ... time` |
| Python 최신 | 0.2.168 (2026-10-15), 번들 CLI 2.1.301, classifier "3 - Alpha" | [수집 04] |
| 버전 연동 | TS 0.3.N은 CLI 2.1.N과 같은 번호다. 이 서버의 CLI는 2.1.303 | [실험] `claude --version`, [수집 04] |
| 바이너리 | TS는 플랫폼별 optionalDependencies 8개로 네이티브 CLI를 동봉(linux-x64 약 286 MB). 메인 패키지 4.7 MB | [실험] `npm view`, [수집 06] |
| engines | node >= 18 | [실험] |
| 라이선스 | TS: `SEE LICENSE IN README.md`, LICENSE.md는 "© Anthropic PBC. All rights reserved"와 Commercial Terms 적용. Python 래퍼는 MIT이지만 동봉 CLI는 독점 라이선스 | [원문] overview "License and terms", [수집 05] |
| 안정성 | 문서: "The SDK follows semver: take patch releases continuously and review the ... changelog before taking a minor." 0.x이고 마이너에서 breaking이 났다(0.1.0 기본 프롬프트·설정, 0.2.113 `options.env`, 0.3.142 V2 세션 API 제거). `permissionMode` 생략 시 동작이 0.3.286에서 `default`에서 `auto` 가능으로 바뀌었다 | [원문] hosting, permissions, [수집 04] |

### 2.2 기능 목록

[원문] overview, typescript, hooks, permissions, session-storage, hosting.

- 진입점: `query({ prompt, options })`(TS), `query`·`ClaudeSDKClient`(Python). 스트리밍 입력 모드가 권장이며 중단·큐잉·실행 중 권한·모델 변경은 이 모드에서만 된다. TS V2 세션 API(`unstable_v2_*`)는 0.3.142에서 제거됐다.
- 내장 도구: Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch, Agent(하위 에이전트), Skill, Task 계열 등. `tools` 옵션으로 목록을 정하고, `disallowedTools`에 이름만 쓰면 도구 정의 자체가 빠진다.
- 커스텀 도구: `tool()` + `createSdkMcpServer()`(인프로세스 MCP, 핸들러는 호스트 프로세스에서 실행), 외부 MCP(stdio, http, sse). 이름은 `mcp__<server>__<tool>`.
- 권한: 평가 순서는 hooks → deny 규칙 → ask 규칙 → permission mode → allow 규칙 → `canUseTool`. 모드는 `default`, `dontAsk`, `acceptEdits`, `bypassPermissions`, `plan`, `auto`(분류 모델 판정).
- 훅: TS 33종(Python 10종). `PreToolUse`는 `allow`·`deny`·`ask`·`defer`와 `updatedInput`을 돌려준다. `defer`는 턴을 `stop_reason: "tool_deferred"`로 끝내고 나중에 그 호출을 이어 받는다. 기본 타임아웃 600초이고, `PreToolUse`가 시간을 넘기면 호출을 막는다(2.1.210 이후).
- 세션: `resume`, `continue`, `forkSession`, `persistSession: false`. 기록은 `$CLAUDE_CONFIG_DIR/projects/<cwd 치환>/<id>.jsonl`. `sessionStore` 어댑터(`append`, `load` 필수)로 외부 저장소에 미러링한다.
- 기타: 하위 에이전트(`agents`), 파일 체크포인트·되감기(Write/Edit/NotebookEdit만, Bash 변경은 추적 안 함), 자동 컴팩션, 구조화 출력, 플러그인·스킬, `sandbox` 옵션, `maxBudgetUsd`, `fallbackModel`, OpenTelemetry 내보내기, `spawnClaudeCodeProcess`(VM·컨테이너에서 CLI를 띄우는 사용자 함수).

### 2.3 실행 구조

[원문] hosting: "When your code calls `query()`, the SDK spawns a separate `claude` CLI process and talks to it over stdio. That subprocess owns the shell, the working directory, and the JSONL session transcripts on local disk." "One agent session maps to one subprocess."

- 전송: CLI를 `--output-format stream-json --input-format stream-json`으로 띄우고 NDJSON으로 주고받는다. CLI가 `can_use_tool`, `hook_callback`, `mcp_message` 제어 요청을 SDK로 보내고, SDK는 `interrupt`, `set_permission_mode` 등을 보낸다. 제어 프로토콜의 공개 명세는 없다 [수집 06, sdk.mjs 줄 번호 확인].
- 실행 위치: 내장 도구(Read, Edit, Bash)는 CLI 프로세스 안에서 돈다. `canUseTool`·훅 콜백·인프로세스 MCP 핸들러는 호스트(helmd) 프로세스에서 돈다.
- 자원: 공식 시작 권장 "1 GiB RAM, 5 GiB disk, and 1 CPU per agent". 알려진 한계로 세션 시간 제한 없음, 긴 세션의 메모리 증가를 든다 [원문 hosting]. 단발 `query()`마다 CLI 기동 비용이 있다(2025-10 보고 약 12초, TS #32·#34, 메인테이너는 스트리밍 입력 권장. 2026-07 TS #391은 Linux에서 `query()`당 0.5~5초 이벤트 루프 차단) [원문 gh].

### 2.4 인증과 요금

- 문서 기본은 `ANTHROPIC_API_KEY`. Bedrock·Vertex·Foundry 공식 지원. Claude 이외 모델은 공식 미지원(Python #410 기여자 답: "does not support non-Anthropic models") [원문].
- overview 문서: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." [원문]
- 도움말 문서(2026-10-07 갱신): "You can still use the Claude Agent SDK, `claude -p`, and third-party apps with your subscription limits." 2026-06-15에 예고했던 SDK 사용 분리 과금은 보류됐다 [원문 support 15036540].
- Max·Team 플랜의 월 API 크레딧(Max 5x $100, Max 20x $200, 이월 없음)은 "Claude API, Claude Managed Agents, the Claude Agent SDK, and playground"에 쓰인다. Claude Code는 대상이 아니다. API 키로 쓰는 모든 Claude API 호출이 대상이므로 Helm 자체 런타임(pi-ai Anthropic 제공자)도 같은 크레딧을 쓴다 [원문 platform api-credits-for-subscribers].
- `total_cost_usd`는 "client-side estimates"이고, 0.3.277부터 재개 시 세션 누적값이 되어 턴 단위 사용량이 남지 않는다(TS #469, 열림) [원문 gh, 수집 07].

## 3. Helm 설계와의 대조

Helm 쪽 근거: 24 ADR-00-23(자체 런타임, pi 재활용·포크), ADR-00-34(어댑터 인터페이스는 지금, 외부 어댑터는 이후), 12 §3.3(ModelGateway, 키는 SecretStore, OAuth 제외 O-12-08), 13 §3.6(S1 bwrap), §3.11(어댑터 계약·능력 목록·G1~G8), 06 §3.13(벤더 중립), 23 D23-11(외부 어댑터는 이번 구현 밖).

`local_cli`는 Helm 설계에서 관리 CLI(`@helm/cli`)의 출처 표시(08 §3.3.2 `Via`)다. 외부 CLI 에이전트를 run으로 쓰는 경로는 13 §3.11의 `RuntimeAdapter`(`id: 'claude-code'`, `transport: 'sdk'`)이고, `local_cli`와 관계가 없다. 13 §3.11.6은 어댑터 없는 런타임용 CLI 제출 경로를 따로 두지 않는다고 정했다. 아래 선택지 C는 이 어댑터 경로를 말한다.

### 3.1 선택지

| 기호 | 내용 |
|---|---|
| A. 대체 | `@helm/agent`(pi-agent-core 포크)와 `@helm/ai`(pi-ai)를 SDK로 바꾼다. 모든 run이 Claude Code 프로세스에서 돈다 |
| B. 병행 | 자체 런타임은 두고, 일부 역할(예: 코딩 작업 run)만 런타임 내부에서 SDK로 돌린다. 커널 연결점(12 §3.4.4~3.4.9)을 SDK 훅에 직접 붙인다 |
| C. 어댑터 | 13 §3.11 계약에 맞춘 `adapter-claude-code` 패키지로만 쓴다. 능력 목록이 보장 수준을 낮춰 표시한다 |
| D. 불채택 | SDK를 쓰지 않는다. Claude Code는 계속 Helm 밖에서 쓰고 관찰 입력(결정 35)으로만 읽는다 |

### 3.2 항목별 대조

| 항목 | Helm 설계 | SDK 사실 | 결과 |
|---|---|---|---|
| 이벤트 로그 정본성 | 모든 상태는 SQLite 이벤트 로그에서 나온다. 기준 원본을 둘로 나누는 안은 ADR-00-23에서 기각했다(pi JSONL 사례) | CLI가 먼저 로컬 JSONL에 쓰고, `sessionStore`는 그 사본이다. 문서: "the store is a mirror of the local transcript rather than a replacement for it." 미러 실패는 "best-effort"로 배치를 버리고 `mirror_error`만 낸다. 항목 `data`는 "opaque SDK-owned state" [원문 session-storage] | 이중 기록이 구조상 생긴다. A·B는 ADR-00-23의 기각 사유와 같은 문제를 다시 만든다. C는 Helm 로그를 정본으로 두고 SDK 기록을 "런타임 세션 파일"(G6 `session_file`)로만 다루면 된다 |
| 커널 승인·권한 | 도구 호출마다 커널이 의도를 먼저 커밋하고 `beforeToolCall`에서 차단·인자 교체한다(12 §3.4.5, G3) | `PreToolUse` 훅은 모든 단계보다 먼저 돌고 `deny`·`updatedInput`·`defer`를 준다. `canUseTool`은 자동 승인된 호출에 오지 않는다("Auto-approved tools never reach `canUseTool`") [원문 permissions]. 열린 이슈: TS #401(내장 Read에 `PreToolUse` 미발화), #361(백그라운드 하위 에이전트가 `canUseTool`·훅 채널을 잃음), #493(cwd 안 Write가 모든 장치를 우회한다는 보고. 재현 코드가 옵션을 `options` 밖에 두어 사용자 오류일 수 있다) [원문 gh] | 게이트는 `PreToolUse` 하나에 걸어야 하고, 내장 도구에 대해서는 실험으로 확인하기 전까지 `enforced`로 광고할 수 없다. 내장 쓰기·실행 도구를 끄고 Helm 도구를 인프로세스 MCP로 주면 실행 자체가 Helm 코드라 게이트가 구조적으로 성립한다 |
| 사람 승인 대기 | 질문·승인은 내구 상태이고 사람 응답까지 오래 걸릴 수 있다(11, 14) | 훅 기본 600초, 넘으면 차단. 길게 기다리려면 `defer`로 턴을 끝내고 나중에 이어 간다 [원문 hooks] | C에서 `defer` → Helm 질문 → 응답 뒤 재개로 매핑할 수 있다(G7 규칙과 맞음). 동작 조건은 문서끼리 완전히 맞지 않아 실험 필요 [수집 02] |
| 도구 실행·샌드박스 | bash는 S1 bwrap, 데몬 CONNECT 프록시, 비밀은 프로세스 환경에 없음(12 §2.1, 13 §3.6) | 내장 도구는 CLI 프로세스 안에서 실행. `sandbox` 옵션은 "Bash, PowerShell, and Monitor commands"만 감싸고 파일 도구는 권한 규칙으로만 막는다. `allowUnsandboxedCommands` 기본 true [수집 02]. CLI는 `ANTHROPIC_API_KEY`를 자기 환경에서 읽는다 [원문 hosting] | 내장 Bash를 쓰면 키가 CLI 환경에 있고 그 자식 셸도 물려받는다 [추측, 실험 필요]. 대책: 키는 데몬 루프백 프록시가 붙이고(`ANTHROPIC_BASE_URL`, hosting 문서가 권하는 방식), CLI 전체를 `spawnClaudeCodeProcess`로 bwrap 안에서 띄운다 |
| 컨텍스트 투영(A11, G5) | 요청마다 컨텍스트를 새로 만든다(12 §3.5, `per_request`) | 대화 기록·컴팩션을 CLI가 소유한다. 시스템 프롬프트 추가와 사용자 메시지 덧붙이기만 된다 | A는 A11을 잃는다. C는 지금 13 표대로 `append`(G5 `detected`) |
| 모델 공급자 | Anthropic, OpenAI, Gemini, OpenRouter 네 제공자(12 §3.3.4) | Claude 전용. 게이트웨이로 다른 모델을 쓰는 것은 공식 미지원 | A는 결정 27의 공급자 중립을 버린다. 관찰·중재·독립 검증 역할(다른 모델)도 SDK 밖에 둬야 하므로 런타임이 둘이 된다 |
| 재개·크래시 복구 | 결정 30: 결과 없는 도구 호출을 다시 실행하지 않고, 기록 순서 불변식으로 복구(12 §3.7) | 같은 머신에서 JSONL이 남아 있으면 `resume` 가능. JSONL 손상 시 재개 실패(TS #244·#287), 재개 시 스킬·시스템 프롬프트 누락(TS #354·#395) [수집 07] | C의 `resume.mode = session_file`(G6 `detected`)이 맞다. 크래시 뒤 결과 불명 도구는 Helm이 정리하고, 재개가 실패하면 13 §3.11.6대로 `interrupted` + 요약 주입 새 run |
| 비용 기록 | 요청마다 `usage`와 비용을 08 `Usage`로 남긴다(12 §3.3.7) | 비용은 클라이언트 추정치. 재개 시 누적값(TS #469). 모델별 값은 `modelUsage`, 하위 에이전트는 `usage`에 빠짐 [수집 03, 07] | 루프백 프록시에서 응답 `usage`를 직접 읽어 기록하면 정확도가 오른다 [추측] |
| 인증 | API 키만, SOPS SecretStore(판정 45, O-12-08) | API 키, 또는 CLI 로그인(구독 한도). 구독 로그인 자격은 `CLAUDE_CONFIG_DIR`의 파일에 저장된다 | 구독 로그인을 쓰면 SOPS 밖의 자격 파일이 생긴다. 개인 본인 사용은 도움말 문구상 허용이나 overview 문구와 긴장이 있다 |
| 관찰 입력(결정 35) | 사용자가 Helm 밖에서 쓴 Claude Code 세션 로그를 읽는다(16, 23 M14-02) | SDK run도 `~/.claude/projects`에 같은 형식으로 남는다 | `CLAUDE_CONFIG_DIR`을 분리하지 않으면 Helm이 띄운 run이 "합의 없이 처리된 동등 작업"(CA-1)으로 잡힌다 |
| 보호 경로 | 도구는 `~/.claude/**` 읽기·쓰기 거부(13 §3.6 표) | CLI는 설정·기록을 그 아래에 쓴다 | 분리한 설정 디렉터리를 보호 경로 표에 함께 넣는다 |
| 포크·vendor | pi 부품을 가져오거나 고쳐 쓴다(ADR-00-23) | 독점 라이선스 바이너리. 고쳐 쓸 수 없고 동작은 버전마다 바뀐다 | A·B는 ADR-00-23의 "작고 안정적인 부품을 소유" 근거와 맞지 않는다 |

## 4. 선택지별 장단점·비용·위험

| | 장점 | 단점·위험 | 1인 운영 부담 |
|---|---|---|---|
| A. 대체 | Claude Code 수준의 도구·프롬프트·컴팩션·하위 에이전트를 바로 얻는다. 구독 한도 사용 가능 | 정본 이중화, A11·결정 27·결정 30 포기, Claude 전용, 세션당 약 1 GiB 프로세스, 독점 바이너리. 12·13·07·24의 상당 부분을 다시 써야 한다 | 큼. 월 25~30회 릴리스를 따라가며 동작 변화(권한 기본값, 비용 의미, 효과 기본값 등)를 직접 추적해야 한다 |
| B. 병행 | 코딩 작업만 Claude Code 품질로 돌릴 수 있다 | 런타임이 둘이 되고 커널 연결점이 두 벌이 된다. 같은 run 모델 안에서 보장 수준이 섞인다. A의 위험을 대부분 그대로 진다 | 큼. 두 런타임의 회귀 시험을 모두 유지 |
| C. 어댑터 | 계약(13 §3.11)이 이미 이 경우를 전제한다. 보장 수준을 화면에 낮춰 보인다. 사용자가 원하면 구독 한도로 코딩 run을 돌릴 수 있다. 커널·로그·도구 경계는 그대로 | 이벤트 이름·동작 변화를 어댑터가 흡수해야 한다. Paseo의 Claude 공급자 구현은 6,653줄이다(`~/projects/_ref/paseo/.../providers/claude/agent.ts`, SDK 0.3.246) [실험 wc]. 하위 에이전트·백그라운드 작업이 게이트를 우회하는 이슈가 열려 있다 | 중간. 버전 고정, 적합성 시험 자동화, 업데이트는 수동 |
| D. 불채택 | 부담 없음. 지금 설계 그대로 | 이후 Claude Code를 Helm 안에서 쓰고 싶을 때 수단이 없다(Codex SDK도 같은 구조라 대안이 아님) | 없음 |

비용 메모. 토큰 비용이 컨테이너 비용보다 한 자릿수 이상 크다는 것이 공식 설명이다 [원문 hosting]. `claude_code` 프리셋 시스템 프롬프트와 내장 도구 정의는 첫 턴 오버헤드를 만든다(사용자 측정 도구 정의 약 11k~20k 토큰, TS #124, 통제된 벤치마크 없음) [수집 07]. Max 플랜 API 크레딧은 SDK와 자체 런타임 모두에 쓰이므로 요금 면에서 SDK만의 이점은 구독 한도 사용 하나다.

## 5. 권고

1. MVP(23 일괄 구현)에서는 SDK를 쓰지 않는다. 런타임은 pi 기반 자체 런타임으로 간다. 이유: 정본 이중화(§3.2 첫 행), 공급자 중립, 포크 가능성. 모두 이미 결정된 ADR(00-23, 00-27, 00-30)과 직접 부딪친다.
2. 이후 단계 `adapter-claude-code`는 이 SDK(TS)로 만든다. CLI를 `claude -p`로 직접 다루는 것보다 제어 요청(`can_use_tool`, `hook_callback`, `mcp_message`)과 `sessionStore`를 공식 API로 받는 편이 유지 부담이 적다. 순서는 지금처럼 pi RPC 다음에 둔다.
3. 어댑터 구성 기본값:
   - `tools`에서 Write·Edit·NotebookEdit·Bash를 빼고(`disallowedTools` 이름만 쓰는 형태), Helm `write`·`edit`·`bash`·`web_fetch` 등을 인프로세스 MCP 도구로 준다. 실행은 Helm 도구 실행기(13)가 하므로 G1·G2·G3를 `enforced`로 둘 수 있다. Read·Grep·Glob도 같은 방식이면 보호 경로 검사가 한 곳에 모인다.
   - 남는 내장 도구에는 `PreToolUse` 훅(매처 없음)을 걸어 Helm `KernelGate.beforeTool`로 보낸다. 사람 승인은 `defer`로 매핑한다. `permissionMode: "dontAsk"`를 명시해 `canUseTool` 의존을 없앤다.
   - CLI 프로세스는 `spawnClaudeCodeProcess`로 `helm_bwrap` 안에서 띄운다. 네트워크는 J-134 프록시, 모델 호출은 데몬 루프백 프록시(`ANTHROPIC_BASE_URL`)가 키를 붙인다.
   - `CLAUDE_CONFIG_DIR`은 run마다 `/srv/volumes/helm/runtime/claude/<runId>` 같은 Helm 전용 경로, `settingSources: []`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, 텔레메트리 끔(`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`).
   - `sessionStore`는 Helm 저장소에 쓰는 어댑터로 두되, 이벤트 로그와 다른 "런타임 세션 사본" 테이블에 둔다. 도메인 이벤트는 SDK 메시지에서 중립 어휘로 바꾼 것만 커널에 제출한다(06 P1).
   - SDK 버전을 정확히 고정하고(semver 범위 금지), 올릴 때 13 §3.11.7 적합성 시험과 §5 스파이크 시험을 다시 돌린다.
4. 구독 로그인은 기본값으로 두지 않는다. 사용자가 원하면 어댑터 설정으로 켜고, 화면에 "구독 한도 사용, 약관 해석 회색" 표시를 둔다. 2026년에 정책 문구가 여러 번 바뀌었으므로 켤 때 그 시점의 도움말 문서를 다시 확인한다.

### 5.1 바꿔야 할 설계 문서·절 (권고를 받아들일 때)

| 문서·절 | 바꿀 내용 |
|---|---|
| 13 §3.11.4 표 "Claude Code (Agent SDK)" 열 | 가로채기를 `PreToolUse` 우선으로(`canUseTool`은 자동 승인 시 오지 않음), 파일 쓰기 매개 "없음" → "Helm 도구(인프로세스 MCP)로 교체 가능", bash 범위 → "CLI 전체를 helm_bwrap 안에서 실행(`spawnClaudeCodeProcess`)", 재개 `session_file`(+`sessionStore`), 한계에 "세션당 자식 프로세스, 독점 바이너리, Claude 전용" 추가. 도달 Level 재계산(G1·G2·G3 `enforced` 가능, G5는 `append`) |
| 13 §3.11.6 | `defer`를 사람 결정 경로(G7)에 쓰는 규칙 추가 |
| 13 §3.6 보호 경로 표, 18 R-2 | 어댑터 설정 디렉터리 거부 행, 모델 키를 CLI 환경에 넣지 않는다는 문장(루프백 프록시) |
| 12 §3.3.4, O-12-08 | 어댑터 경로의 키 주입(루프백 프록시)과 구독 로그인 처리(어댑터 한정 선택) 명시 |
| 16 / 23 M14-02 | 관찰 입력에서 Helm이 띄운 Claude Code run의 설정 디렉터리를 제외 |
| 06 §3.13, §5.4 `adapter-claude-code` | 의존 패키지 `@anthropic-ai/claude-agent-sdk` 고정 버전, 프로세스 수명·메모리 상한(1 GiB/세션) |
| 24 ADR-00-34 | "Claude Code 어댑터는 Agent SDK(TS)로 구현, 런타임 대체는 기각(이유: 정본 이중화·공급자 중립·라이선스)" 결과 줄 추가 |
| 17 운영 | 어댑터 run의 자식 프로세스 원장·고아 정리(13 §3.6.7)에 CLI 프로세스 트리 포함 |

### 5.2 확인 실험(스파이크)

어댑터 착수 전에 이 서버(WSL2, Node 24)에서 SDK 버전을 고정해 돌린다. 각 실험은 녹화 대본과 결과 파일을 남긴다.

| 번호 | 실험 | 통과 기준 |
|---|---|---|
| SP-1 | 기동·메모리: 스트리밍 입력 세션 1개·3개를 열고 첫 응답까지 시간, 유휴·30턴 뒤 RSS | 첫 응답 3초 안, 세션당 RSS 1 GiB 안 |
| SP-2 | 게이트 적합성: 내장 Read·Write·Edit·Bash에 `PreToolUse` 매처 없음 훅, `dontAsk`. 거부·인자 교체가 실제 파일에 반영되는지(TS #401·#493 재현 여부 포함) | AC-02·AC-03 통과. 실패하면 내장 도구는 모두 끈다 |
| SP-3 | Helm 도구 MCP 전용: `tools`에서 내장 쓰기·실행 제외, 인프로세스 MCP로 `write`·`bash` 제공 | 모델이 MCP 도구만 써서 작업을 끝내고, 결과 ID가 안정적(AC-05) |
| SP-4 | 격리: `spawnClaudeCodeProcess`로 CLI 전체를 helm_bwrap + 프록시 네임스페이스에서 실행. 쓰기 가능 루트 밖 쓰기, 데몬 소켓 접근, 환경 변수에 키가 보이는지 | 루트 밖 쓰기 차단(AC-06), 소켓 불가, 키 없음 |
| SP-5 | 하위 에이전트·백그라운드: Agent 도구로 띄운 하위 에이전트의 도구 호출이 같은 훅을 지나는지, 부모 턴 종료 뒤(TS #361) | 모든 실행 호출이 게이트를 지난다. 아니면 Agent 도구를 끈다 |
| SP-6 | 장기 승인: `defer` 후 30분 뒤 재개 | 같은 도구 호출 ID로 이어지고 중복 실행 없음 |
| SP-7 | 크래시: 도구 실행 중 helmd와 CLI를 죽이고 `sessionStore`로 재개 | 결과 없는 호출을 다시 실행하지 않음(결정 30), 재개 실패 시 새 run 경로 동작 |
| SP-8 | 비용 대조: 같은 과제를 자체 런타임과 어댑터로 돌려 루프백 프록시의 `usage`, SDK `modelUsage`, 첫 턴 입력 토큰(`claude_code` 프리셋 유무) 비교 | 프록시 기록과 SDK 추정의 차이를 수치로 남김 |

## 6. 대안 비교 메모

| 대상 | 실행 위치 | 상태 소유 | 공급자 | 승인 지점 | 라이선스 |
|---|---|---|---|---|---|
| pi(`@earendil-works/*` 1.3.0, 2026-10-15. 옛 `@mariozechner/*`는 deprecated) | 인프로세스 | 호출자 | 다중 | 확장·`beforeToolCall` | MIT |
| Claude Agent SDK | CLI 자식 프로세스 | CLI(JSONL) + 선택 미러 | Claude 전용 | 훅·`canUseTool` | 독점 |
| Codex SDK / app-server | CLI 자식 프로세스 | `~/.codex/sessions` | OpenAI | 서버→클라이언트 승인 요청 | Apache-2.0 |
| OpenAI Agents SDK | 인프로세스 | 호출자(RunState 직렬화) | OpenAI 중심, LiteLLM 베타 | `needsApproval`·interruptions | MIT |
| Anthropic tool runner(beta) | 인프로세스 | 없음 | Claude | 수동 루프 | MIT(클라이언트 SDK) |
| Claude Managed Agents(beta) | Anthropic 서버(자체 호스트 샌드박스 선택) | Anthropic | Claude | `always_ask` → 확인 이벤트 | 서비스 약관 |

[수집 08]. Helm은 pi 1.1.0을 기준으로 설계했고, pi가 Earendil Works로 옮겨 1.3.0이 나왔다. 이 변화는 SDK 결정과 별개로 07 문서에서 확인할 일이다.

## 7. 확인하지 못한 것

- 이 서버에서 SDK를 직접 돌린 실험은 하지 않았다(키·자격 사용을 피함). 기동 시간·메모리는 공식 권장치와 사용자 보고뿐이다.
- `defer`가 SDK 스트리밍 세션에서 동작하는 정확한 조건, `sandbox` 사용 시 `autoAllowBashIfSandboxed`(기본 true)가 `PreToolUse`를 건너뛰는지.
- TS #493은 재현 코드의 옵션 위치가 의심스럽다. 메인테이너 답이 없다.
- 2026-01의 제3자 구독 OAuth 차단(OpenCode 등)은 2차 출처만 있다. pi-ai의 Anthropic OAuth 경로는 O-12-08로 이미 제외했으므로 이 문서 결론에는 영향이 없다.

## 8. 출처

모두 2026-10-19 확인.

공식 문서
- https://code.claude.com/docs/en/agent-sdk/overview (기능, 구독 로그인 문구, 라이선스·약관)
- https://code.claude.com/docs/en/agent-sdk/typescript (Options: `spawnClaudeCodeProcess`, `sessionStore`, `persistSession`, `env`, `permissionMode`)
- https://code.claude.com/docs/en/agent-sdk/permissions (평가 순서, 모드, 하위 에이전트 상속)
- https://code.claude.com/docs/en/agent-sdk/hooks (훅 목록, `defer`, 타임아웃)
- https://code.claude.com/docs/en/agent-sdk/session-storage (이중 기록, best-effort 미러)
- https://code.claude.com/docs/en/agent-sdk/hosting (자식 프로세스 모델, 자원, semver, 키 프록시)
- https://code.claude.com/docs/en/sandboxing, https://code.claude.com/docs/en/agent-sdk/python (샌드박스 범위, 기본값) [수집 02]
- https://code.claude.com/docs/en/agent-sdk/sessions, /custom-tools, /mcp, /subagents, /file-checkpointing, /cost-tracking [수집 03]
- https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan (2026-06-15·10-07 갱신)
- https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers
- https://www.anthropic.com/legal/commercial-terms

패키지·저장소
- npm `@anthropic-ai/claude-agent-sdk` 0.3.303 메타데이터(`npm view`)
- https://pypi.org/project/claude-agent-sdk/ (0.2.168)
- https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md, https://github.com/anthropics/claude-agent-sdk-python/blob/main/CHANGELOG.md
- 이슈: anthropics/claude-agent-sdk-typescript #32, #34, #124, #244, #287, #354, #361, #391, #395, #401, #469, #493. anthropics/claude-agent-sdk-python #410
- 로컬 참고: `~/projects/_ref/paseo/packages/server/src/server/agent/providers/claude/agent.ts`(SDK 0.3.246, `buildOptions` 3379행, `persistSession` 우회 2810행)

대안
- https://pi.dev, https://github.com/earendil-works/pi
- https://github.com/openai/openai-agents-js, https://www.npmjs.com/package/@openai/codex-sdk
- https://platform.claude.com/docs/en/managed-agents/overview
- https://github.com/agentclientprotocol/claude-agent-acp
