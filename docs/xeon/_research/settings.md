# 에이전트 런타임 설정 노출 조사 (r2)

- 작성일: 2026-10-21
- 목적: 추론 예산, 용도별 모델 라우팅, 레이트 리밋, 계정 회전 같은 값을 L4(CLI와 데스크톱 앱)에서 등록하고 조작하는 화면을 설계하기 위한 근거 수집이다. 구현은 하지 않는다.
- 대상: Claude Code, Codex, opencode, pi, oh-my-pi(omp), Gemini CLI, Goose, Cursor, Zed, Roo Code, Cline.
- 방법: Claude Code는 로컬 문서 사본과 공식 웹 페이지를 확인하였다. pi와 omp는 로컬 소스와 문서를 읽었다. 나머지는 WebFetch와 WebSearch로 공식 문서를 확인하였다. 내려받은 코드는 읽기만 하였고 실행하지 않았다. 비밀 파일은 읽지 않았다.

## 0. 표기와 판정 기준

- [원문]: 로컬 사본, 소스, 또는 공식 페이지에서 확인한 내용이다. 웹 페이지는 WebFetch의 요약 모델을 거쳤으므로 키 이름과 기본값은 원문 재확인이 필요하다.
- [추측]: 조사자의 판단이다. 문서에서 찾지 못한 기능은 "문서 기준 미발견"으로 적고 [추측]으로 표기한다.
- "우리 권장" 열은 전부 [추측]이다. 판정 기준은 다음과 같다.
  - UI 필요: 선택지가 많거나, 목록을 관리하거나, 비용과 위험 영향을 사용자가 봐야 한다.
  - 명령만: 값이 하나이고 세션 중 자주 바꾸며 명령으로 충분하다.
  - 파일만: 중첩 구조, 팀 공유, 관리 정책, 스크립트 연동이 필요하다.
- 층 코드는 요청서 정의를 따른다. F5는 설정 계층, L0는 샌드박스와 비밀 등 실행 환경, L1-a부터 L1-g는 런타임 내부, L2는 도구와 확장, X는 플러그인과 신뢰, L3는 그룹이다.
- 출처 번호 [S01]부터 [S38]은 7장에 전체 경로와 URL을 적는다.

## 1. 런타임별 설정 노출 형태

| 런타임 | 설정 파일 | 명령 | 세션 중 UI | 범위와 우선순위 | 출처 |
|---|---|---|---|---|---|
| Claude Code | `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`, 관리 설정. MCP는 `~/.claude.json`과 `.mcp.json` | `/config key=value`, `/model`, `/effort`, `/permissions`, `/mcp`, `/plugin`, `/hooks`(보기만), `/memory`, `/statusline`, `/output-style`, `/sandbox`, `/autocompact`. 플래그 `--settings`, `--model`, `--effort`, `--permission-mode` | `/config` 메뉴. 터미널 전용이며 VS Code 채팅 패널과 데스크톱 앱에서는 열리지 않는다 [S02] | 관리 > `--settings` > local > project > user [S02] | S01–S14 |
| Codex | `~/.codex/config.toml`, `.codex/config.toml`(신뢰된 프로젝트만), `$CODEX_HOME/<이름>.config.toml` 프로파일, `requirements.toml`(관리) | `--profile`, `/review`, `/vim`, `/raw`, `/recap`, `/feedback` [S15] | 데스크톱 앱 설정 화면 [S17]. IDE 확장은 확인 못 함 | 관리 requirements와 프로파일, CLI, 프로젝트, 사용자 순. 세부 순서는 [추측] | S15–S17 |
| opencode | `~/.config/opencode/opencode.json`, 프로젝트 `opencode.json`, `tui.json` | `/connect`, `/models`, `/themes`, `/sessions`, `/undo`, `/redo`, `/export`, `/init`, `opencode auth list` [S19 S21] | TUI 명령과 `ctrl+p` 팔레트 | 원격 < 전역 < `OPENCODE_CONFIG` < 프로젝트 < `.opencode` < 인라인 env < 관리 파일 < MDM [S18] | S18–S21 |
| pi | `<agent-dir>/settings.json`(기본 `~/.pi/agent`), `.pi/settings.json`, `models.json`, `mcp.json`, `keybindings.json`, `auth.json` | `/settings`, `/model`, `/thinking`, `/scoped-models`, `/trust`, `/reload`, `/tree`, `/compact`, `/export`, `/share` [S35] | `/settings` 패널. UI 항목 39개 [S34] | 프로젝트가 사용자 설정을 덮는다. `defaultProjectTrust`와 `httpProxy`는 agent-dir 전용 [S33] | S33–S35 |
| oh-my-pi (omp) | `~/.omp/agent/config.yml`, `<cwd>/.omp/config.yml`, `--config` 오버레이, `--profile`별 디렉터리 | `omp config list/get/set/reset/path`, `/settings`, `/model`(역할 보기), `/modelpreset`, `/advisor`, `/usage`, `/forget-approvals`, `omp usage reset` [S36 S37 S38] | `/settings` 패널. `auth.broker.*`처럼 UI에서 숨긴 키도 있다 [S38] | 기본값 < 전역 < 프로젝트 < CLI 오버레이 < 런타임 플래그 < 환경변수 [S36] | S36–S38 |
| Gemini CLI | `~/.gemini/settings.json`, `.gemini/settings.json`, 시스템 파일, `.geminiignore` | 명령 목록은 일부만 확인. `/memory inbox`, `/voice`, `/editor`, `--yolo` [S22] | 터미널 UI | 기본값 < 시스템 기본 < 사용자 < 프로젝트 < 시스템 < env < 플래그 [S22] | S22 |
| Goose | `~/.config/goose/config.yaml`, `permission.yaml`, `secrets.yaml`(평문), `permissions/tool_permissions.json` | `goose configure`, `goose info -v` [S23]. `/mode`는 비공식 요약에만 나옴 [S24] | 데스크톱 Settings와 하단 모드 버튼 | 환경변수 > config.yaml > 기본값 [S23] | S23–S24 |
| Cursor | `~/.cursor/permissions.json`, `<워크스페이스>/.cursor/permissions.json`, 팀 대시보드, `sandbox.json`, `.cursor/rules/*.mdc`, User Rules | 문서 기준 확인 못 함 | Settings > Agents > Approvals & Execution, Customize > Rules [S25 S27] | 팀 대시보드 > permissions.json(사용자와 저장소 배열 연결) > IDE 설정 [S26] | S25–S27 |
| Zed | `settings.json`의 `agent.*`. 프로파일도 같은 파일 [S29] | `agent: manage profiles` [S29] | Agent 패널의 프로파일 선택기와 Configure 모달 | 도구 권한은 built-in 규칙 > always_deny > always_confirm > always_allow > 도구 기본값 > 전역 기본값 [S30] | S28–S30 |
| Roo Code | VS Code 저장소. 프로필 내보내기 지원 [S31] | 확인 못 함 | Settings > Providers 드롭다운, 모드별 프로필 연결 [S31] | 작업은 시작할 때의 프로필을 유지 [S31] | S31 |
| Cline | VS Code 설정. 세부 키 미문서화 [S32] | 확인 못 함 | Auto Approve 패널, YOLO 체크박스 [S32] | 확인 못 함 | S32 |

## 1.5 요구 항목의 층 분포

| 요구 항목 | 층 분포 | 근거 | 결론 |
|---|---|---|---|
| 추론 예산 | L1-c가 기본. omp와 pi는 토큰 수 예산을, CC와 Codex는 레벨만 노출한다 | [S36 S33 S05 S15] | 레벨과 토큰 수를 같은 화면에 둔다 [추측] |
| 용도별 모델 라우팅 | L1-c(역할), L1-g(서브에이전트 모델), L2(웹 검색 제공자) | [S36 S28 S22 S15] | 한 화면의 역할 표로 묶는다 [추측] |
| 레이트 리밋 | L1-c와 L0(재시도 수치). CC는 레이트 리밋 설정 키가 없다 | [S12 S13 S36 S31] | 제공자 한도 상태와 대기 정책을 함께 둔다 [추측] |
| 계정 회전 | L1-c가 기본. omp만 계정 풀을 지원하고 관리 층이 잠글 수 있다 | [S36 S38 S01] | omp형 계정 풀을 L1-c에 둔다 [추측] |
| 모델 폴백 | L1-c. CC는 레이트 리밋 오류에 폴백하지 않는다고 명시 | [S12] | 레이트 리밋 처리와 폴백을 별도 정책으로 분리한다 [추측] |
| 단계와 비용 예산 | L1-b. Codex는 토큰 예산 기능이 있으나 기본은 꺼짐 | [S04 S15 S22 S23] | L1-b 화면으로 분리한다 [추측] |
| 권한 모드 | L1-d와 L0(샌드박스). omp는 기본이 yolo이다 | [S06 S15 S37 S22 S23 S25] | 기본값 설계는 보수적으로 잡는다 [추측] |

## 2. 층별 매핑

### 2.1 F5 설정 계층

| 항목 | 층 | 런타임별 제공 형태 | 범위 | 런타임 중 변경 | 우리 권장 |
|---|---|---|---|---|---|
| 계층 순서 | F5 | [원문] CC는 관리 > `--settings` > local > project > user 순이며 `/status`의 Setting sources로 출처를 본다 [S02]. omp는 기본값, 전역, 프로젝트, CLI 오버레이, 런타임, 환경변수 순이다 [S36]. Gemini와 opencode도 다단계 병합을 쓴다 [S18 S22] | 관리, 사용자, 프로젝트, 세션 | [원문] 파일 변경은 대부분 즉시 반영된다 [S02 S36] | UI 필요 (유효 값과 출처를 함께 표시) |
| 저장 위치 분산 | F5 | [원문] CC `/config`의 저장 파일은 항목마다 다르다. settings.json, settings.local.json, ~/.claude.json으로 나뉜다 [S02]. Codex 앱 설정은 config.toml 키와 매핑되지 않는다고 명시한다 [S17] | 해당 없음 | 해당 없음 | UI 필요 (각 값의 저장 파일 경로를 표시) |
| 세션 한정 덮어쓰기 | F5 | [원문] CC는 `--settings` JSON과 키별 플래그, 환경변수 쌍을 쓴다 [S02]. omp `--config`는 저장되지 않는다 [S36]. Goose 환경변수는 config.yaml보다 우선한다 [S23] | 세션 | 기동 시 적용 | 명령만 (CLI 플래그와 "이번만 적용" 옵션) |
| 관리 잠금 | F5 | [원문] CC 관리 전용 키가 색인에 44개 있다 [S01]. Gemini는 `admin.*`과 `security.auth.enforcedType`을 쓴다 [S22]. Codex는 `requirements.toml`을 쓴다 [S16] | 관리 | 사용자 변경 불가 | UI 필요 (잠긴 값에 자물쇠와 사유 표시) |
| 파일이 소유한 항목의 UI 잠금 | F5 | [원문] Cursor는 permissions.json에 정의된 allowlist에서 IDE 편집기를 읽기 전용으로 바꾼다 [S26] | 프로젝트, 사용자 | 파일 수정 시 즉시 | UI 필요 (파일 소유 항목은 읽기 전용) |
| 범위 제한 키 | F5 | [원문] pi `defaultProjectTrust`와 `httpProxy`는 agent-dir 설정에서만 설정할 수 있다 [S33] | 사용자 | 해당 없음 | 파일만 (프로젝트 파일에서는 입력을 막는다) |

### 2.2 L0 샌드박스, 네트워크, 비밀, 알림, 실행 환경

| 항목 | 층 | 런타임별 제공 형태 | 범위 | 런타임 중 변경 | 우리 권장 |
|---|---|---|---|---|---|
| 샌드박스 켜기와 실패 시 동작 | L0 | [원문] CC `sandbox.enabled`, `sandbox.failIfUnavailable`, `/sandbox` [S01 S03]. Codex `sandbox_mode`는 read-only, workspace-write, danger-full-access다 [S15]. Gemini `tools.sandbox`는 docker, podman, lxc, windows-native를 고른다 [S22]. Cursor Auto-review는 셸 명령에 샌드박스를 항상 쓴다 [S25] | 사용자, 프로젝트, 관리 | [원문] CC는 `/sandbox`로 즉시 바꾼다. 나머지는 [추측] 재시작 필요 | UI 필요 (끌 때 위험 고지) |
| 읽기와 쓰기 경로 | L0 | [원문] CC `sandbox.filesystem.allowWrite`, `denyWrite`, `denyRead`, `allowRead` [S01]. Codex `permissions.<이름>.filesystem`의 경로와 글롭 규칙 [S15]. Cursor `sandbox.json` [S25] | 프로젝트, 사용자 | [추측] 세션 중 반영 여부는 미확인 | UI 필요 (경로 목록 편집, 차단 규칙 우선 표시) |
| 네트워크 허용과 차단 도메인 | L0 | [원문] CC `sandbox.network.allowedDomains`, `deniedDomains`, `httpProxyPort` [S01]. Codex `features.network_proxy.domains`와 `permissions.<이름>.network.domains`, deny가 우선 [S15]. Cursor는 sandbox.json만, 기본 포함, 전체 허용 세 모드 [S25]. pi `httpProxy`는 agent-dir 전용 [S33] | 사용자, 프로젝트 | 미확인 | UI 필요 (도메인 목록과 거부 우선 규칙) |
| 비밀 값의 등록과 주입 | L0 | [원문] CC `env`, `apiKeyHelper`(외부 명령이 키를 만든다), `sandbox.credentials.*`로 파일과 env를 마스킹한다 [S01]. Codex `model_providers.<id>.env_key`와 `auth.command` [S15]. opencode는 `{env:…}`와 `{file:…}`을 치환하고 키를 `~/.local/share/opencode/auth.json`에 둔다 [S21]. omp `config list`는 자격 값을 `********`로 마스킹한다 [S36]. Goose `secrets.yaml`은 평문이다 [S23] | 사용자, 관리 | [추측] 계정 변경의 즉시 반영 여부는 미확인 | UI 필요 (등록 전용 화면. 값은 다시 보여주지 않고 키 이름과 상태만 표시) |
| 알림 | L0 | [원문] CC `preferredNotifChannel`, `inputNeededNotifEnabled`, `agentPushNotifEnabled` [S01]. Codex `tui.notifications`, `tui.notification_condition`(unfocused 또는 always), `notify` 명령 [S15]. Gemini `general.enableNotifications`, `notificationMethod` [S22]. opencode `tui.attention.*`(사운드 포함) [S19] | 사용자 | [추측] 즉시 반영 | UI 필요 (토글과 조건을 한 화면에) |
| 셸과 실행 환경 | L0 | [원문] CC `defaultShell`, `env`, `processWrapper`(macOS와 Linux 기업 런처) [S01]. Codex `shell_environment_policy.inherit`, `filters`, `set` [S15]. opencode `shell` [S18]. Gemini `tools.shell.*`(pager, inactivityTimeout 300초) [S22]. pi `shellPath`, `shellCommandPrefix`, `npmCommand` [S33] | 사용자, 프로젝트 | [추측] 재시작 필요 | 파일만 (화면에는 현재 값을 읽기 전용으로 표시) |
| 텔레메트리와 업데이트 | L0 | [원문] CC `autoUpdatesChannel`, 관리 `minimumVersion`과 `requiredMinimumVersion` [S01]. Codex `analytics.enabled`, `otel.*` [S15]. Gemini `privacy.usageStatisticsEnabled`, `telemetry.*` [S22]. pi `enableInstallTelemetry`(기본 켜짐), `enableAnalytics`(기본 꺼짐) [S33] | 사용자, 관리 | [추측] 즉시 반영 | UI 필요 (동의 토글과 전송 대상 표시) |

### 2.3 L1-a 동시 상한과 큐 모드

| 항목 | 층 | 런타임별 제공 형태 | 범위 | 런타임 중 변경 | 우리 권장 |
|---|---|---|---|---|---|
| 동시 실행 상한 | L1-a | [원문] Codex `agents.max_concurrent_threads_per_session` [S15]. omp `async.maxJobs`(기본 100)와 제공자별 동시성 제한 [S36]. CC는 `/background`와 `claude agents`로 백그라운드 세션을 다룬다 [S03 S04]. CC의 동시 상한 키는 문서 기준 미발견 [추측] | 사용자, 프로젝트 | [추측] 세션 중 변경 가능 여부 미확인 | UI 필요 (실행 중 작업 목록과 함께) |
| 입력 대기열(큐 모드) | L1-a | [원문] pi `steeringMode`와 `followUpMode`는 all 또는 one-at-a-time이다 [S33]. CC는 응답 중 입력한 명령을 큐에 쌓아 턴이 끝나면 실행한다 [S03]. Codex 데스크톱은 후속 입력을 현재 실행에 반영할지 다음 차례로 미룰지 고른다 [S17] | 사용자 | [원문] pi는 설정 파일로 바꾼다 [S33]. 명령으로도 가능 | 명령만 (입력창 토글과 함께) |
| 백그라운드 작업 가시성 | L1-a | [원문] CC `/tasks`, `/background` [S03]. omp `async.enabled`, `async.widgets` [S36]. Codex `background_terminal_max_timeout` 300000ms [S15] | 세션 | 세션 중 | UI 필요 (작업 목록 패널) |

### 2.4 L1-b 단계와 비용 예산, 종료 조건

| 항목 | 층 | 런타임별 제공 형태 | 범위 | 런타임 중 변경 | 우리 권장 |
|---|---|---|---|---|---|
| 단계(턴) 상한 | L1-b | [원문] CC `--max-turns`는 print 모드에서만 쓴다 [S04]. Gemini `model.maxSessionTurns`(-1은 무제한) [S22]. Goose `GOOSE_MAX_TURNS`(기본 1000) [S23]. omp `tools.maxTimeout`(도구 시간 상한, 0은 무제한) [S36] | 사용자, 세션 | 플래그는 기동 시. 설정 변경 반영은 [추측] | UI 필요 (숫자와 도달 시 동작 설명) |
| 비용 예산 | L1-b | [원문] CC `--max-budget-usd`는 print 모드 전용이고 클라이언트 추정치 기준이다 [S04]. Codex `features.rollout_budget.enabled`, `limit_tokens`, `reminder_interval_tokens`(토큰 기준, 기본 꺼짐) [S15]. Gemini `billing.overageStrategy`(ask, always, never) [S22]. Goose `GOOSE_CLI_SHOW_COST`(표시만) [S23]. CC `/usage`와 statusline `cost` [S03 S13] | 사용자, 세션 | [추측] 세션 중 가능 | UI 필요 (한도 입력, 소진 시 동작 선택, 사용량 게이지) |
| 목표 달성까지 계속 실행 | L1-b | [원문] CC `/goal <조건>`은 조건이 충족되거나 해제될 때까지 턴을 이어간다 [S03]. Codex `features.goals`(지속 목표와 자동 계속) [S15]. CC `/loop`는 세션이 열린 동안 반복한다 [S03] | 세션 | 세션 명령 | 명령만 (상태 줄에 목표 표시) |

### 2.5 L1-c 모델, 제공자, 계정, 추론 예산, 라우팅, 폴백, 레이트 리밋, 캐시

| 항목 | 층 | 런타임별 제공 형태 | 범위 | 런타임 중 변경 | 우리 권장 |
|---|---|---|---|---|---|
| 기본 모델 선택 | L1-c | [원문] CC `/model`은 저장하고, 피커에서 `s`를 누르면 세션만 바뀐다. `model`, `--model`, `ANTHROPIC_MODEL`이 있다 [S12]. Codex `model`, `--profile` [S15]. opencode `model`, `small_model`, `/models` [S18 S21]. pi `defaultProvider`와 `defaultModel`, Ctrl+S 저장, `enabledModels`, `/scoped-models` [S33 S35]. omp `modelRoles.default`, `/model` 역할 보기 [S36]. Gemini `model.name`, `GEMINI_MODEL` [S22]. Goose `active_provider`, `providers.<이름>.model` [S23] | 사용자, 프로젝트, 세션 | [원문] `/model`로 세션 중 가능 [S12] | UI 필요 (목록, 가용성, 가격 라벨) |
| 용도별 모델 라우팅 | L1-c | [원문] omp `modelRoles`는 default, smol, slow, vision, plan, commit, tiny, memory, task, advisor, widget과 image, web, speech, dictation, judge 같은 모델 종류 역할을 가진다. `cycleOrder`, `modelProviderOrder`, `modelPresets`도 있다 [S36]. Zed는 inline_assistant, commit_message, thread_summary, subagent, compaction 모델을 따로 지정한다 [S28 요약]. CC `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_AUTO_MODE_MODEL`, `advisorModel` [S05 S12]. Codex `review_model`, `plan_mode_reasoning_effort`, `agents.default_subagent_model` [S15]. Gemini `modelConfigs.aliases`, `overrides`, `modelChains`, `general.plan.modelRouting`(계획은 Pro, 구현은 Flash) [S22] | 프로젝트, 사용자 | [원문] omp는 라우팅 변경이 다음 서브에이전트 호출부터 적용된다 [S36] | UI 필요 (역할 표 편집기. L1-c의 핵심) |
| 추론 노력(레벨) | L1-c | [원문] CC `effortLevel`, 모델별 `modelSettings`, `/effort`, `--effort`, `CLAUDE_CODE_EFFORT_LEVEL`, 관리 `maxEffortLevel` [S12 S05 S01]. Codex `model_reasoning_effort`, `plan_mode_reasoning_effort`, `model_reasoning_summary`, `model_verbosity` [S15]. omp `defaultThinkingLevel`(auto 포함), `/thinking`, `--thinking` [S36]. pi `defaultThinkingLevel`, `modelThinkingLevels`, `/thinking` [S33 S35] | 사용자, 프로젝트, 세션 | [원문] `/effort`, `/thinking`으로 세션 중 가능 | 명령만 (숫자 예산은 다음 행) |
| 추론 예산(토큰 수) | L1-c | [원문] omp `thinkingBudgets.minimal`~`max`(기본 1024, 2048, 8192, 16384, 32768, 32768) [S36]. pi `thinkingBudgets`(minimal~high) [S33]. CC `MAX_THINKING_TOKENS`(고정 예산, env)와 `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` [S05 S12]. Codex, Gemini, Zed는 레벨만 노출한다 [추측: 문서 기준] | 사용자, 프로젝트 | [추측] 세션 중 반영 | UI 필요 (레벨과 토큰 수를 함께 보여주고 추정 비용 표시) |
| 샘플링 파라미터 | L1-c | [원문] omp `temperature`, `topP`, `topK`, `minP`, `presencePenalty`, `repetitionPenalty`(-1은 제공자 기본) [S36]. Zed `agent.model_parameters`(제공자와 모델별 temperature) [S28]. Goose `GOOSE_TEMPERATURE`, `GOOSE_MAX_TOKENS` [S23]. opencode는 에이전트별 temperature를 문서에 적지 않는다 [S18] | 사용자, 프로젝트 | 미확인 | 파일만 (고급 탭) |
| 폴백 체인 | L1-c | [원문] CC `fallbackModel`(배열, 최대 3개), `--fallback-model`. 과부하나 사용 불가일 때만 동작하고 레이트 리밋 오류에서는 동작하지 않는다 [S12]. omp `retry.fallbackChains`(역할별, 모델별, `provider/*` 와일드카드), `retry.fallbackOn`(any 또는 usage-limit), `fallbackRevertPolicy` [S36]. Gemini `modelConfigs.modelChains` [S22]. Codex, pi, opencode, Goose, Zed에서는 모델 폴백 키를 찾지 못했다 [추측] | 사용자, 프로젝트 | [원문] 다음 턴부터. CC는 다음 메시지에서 주 모델을 먼저 쓴다 [S12] | UI 필요 (체인 편집기와 발동 조건 설명) |
| 레이트 리밋과 사용량 한도 대응 | L1-c | [원문] CC는 레이트 리밋 값을 정하는 키가 없다 [S12]. `autoContinueAtUsageLimit`(리셋까지 대기 후 자동 계속), `/rate-limit-options`, statusline `rate_limits.five_hour`와 `seven_day`(읽기 전용) [S01 S03 S13]. omp `retry.waitForUsageReset`, `retry.usageAwareFallback`(쿼터 보고로 같은 제공자의 건강한 계정을 먼저 씀), `retry.usageReservePct`(기본 10), `retry.usageReservePolicy`(confirm, auto, fail-closed) [S36]. Roo Code는 프로필마다 최소 요청 간격을 초 단위로 둔다(기본 0) [S31]. Codex는 레이트 리밋 전용 키가 없고 `request_max_retries` 4, `stream_max_retries` 5이다 [S15]. pi는 `retry.maxRetries` 3, `baseDelayMs` 2000 [S33] | 사용자, 프로젝트, 관리 | [추측] 세션 중 반영 | UI 필요 (사용량 게이지, 대기와 폴백과 예약 정책을 한 화면에. Roo식 요청 간격 설정은 참고할 만하다 [추측]) |
| 재시도와 백오프 수치 | L1-c | [원문] CC `CLAUDE_CODE_MAX_RETRIES`, `CLAUDE_CODE_RETRY_WATCHDOG`(429와 529를 무기한 재시도) [S05]. omp `retry.maxRetries`(10), `baseDelayMs`(500), `maxDelayMs`(300000) [S36]. Gemini `general.maxAttempts`(10) [S22] | 사용자 | [추측] 기동 시 적용 | 파일만 (고급 탭에 읽기 전용 표시) |
| 계정 등록, 회전, 우선순위 | L1-c | [원문] omp `auth.accountPolicies`(제공자, 계정 식별자 email, accountId, projectId, orgId, priority, reservePct 0–100), `task.agentAccountPools`, `auth.broker.url`과 `token`(설정 UI에서는 숨김), `omp usage`, `/usage reset` [S36 S38]. CC에는 계정 회전 키가 없다. `/login`, `/logout`, `apiKeyHelper`, `awsAuthRefresh`, `gcpAuthRefresh`가 있다 [S01]. Codex `model_providers.<id>.auth.command`(토큰 명령, `refresh_interval_ms` 300000) [S15]. opencode `/connect`, `opencode auth list` [S21]. Roo Code는 프로필에 제공자와 키를 고정한다 [S31] | 사용자, 관리 | [원문] omp는 정책 변경을 장기 세션이 즉시 따른다 [S36] | UI 필요 (계정 목록, 우선순위, 예약 %, 키 값은 표시하지 않음. 구독 계정 회전은 제공자 약관 검토가 필요하다 [추측]) |
| 제공자 엔드포인트, 헤더, 타임아웃 | L1-c | [원문] Codex `model_providers.<id>`의 base_url, env_key, http_headers, query_params, stream_idle_timeout_ms [S15]. opencode `provider.<id>.options`의 baseURL, apiKey, timeout(300000), chunkTimeout(900000), headers [S18]. CC `ANTHROPIC_BASE_URL`, `modelOverrides`(모델 ID를 게이트웨이 ID로 매핑) [S01 S05]. pi `models.json` [S35]. Goose `providers.<이름>` [S23] | 사용자, 프로젝트 | [추측] 재시작 필요 | 파일만 (화면에는 "연결 테스트" 버튼만) |
| 모델 허용과 차단 목록 | L1-c | [원문] CC `availableModels`, `deniedModels`, `enforceAvailableModels`, `availableModelsMatch`(관리), `modelPicker`(표시 순서와 라벨) [S12 S01]. omp `enabledModels`, `enabledProviders`, `disabledProviders` [S36]. opencode `enabled_providers`, `disabled_providers` [S18] | 관리, 사용자 | [추측] 세션 중 반영 | UI 필요 (관리 정책으로 잠긴 항목 표시) |
| 프롬프트 캐시 TTL과 워밍 | L1-c | [원문] CC `promptCacheTtl`(5m 또는 1h), `subagentPromptCacheTtl`, `ENABLE_PROMPT_CACHING_1H`, `FORCE_PROMPT_CACHING_5M` [S01 S05]. omp `providers.cacheWarming`(off, streaming, idle, 기본 idle) [S36]. pi `cacheWarming`(전역 전용)과 `showCacheMissNotices` [S33]. Goose `GOOSE_CACHE_TTL` [S23]. opencode `provider.<id>.options.setCacheKey` [S18] | 사용자 | [추측] 세션 중 반영 | UI 필요 (비용 영향을 설명하는 토글) |
| 플래그 발생 시 모델 전환 | L1-c | [원문] CC `switchModelsOnFlag`(자동 전환 또는 매번 묻기), `CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK` [S12 S05] | 사용자 | 세션 중 `/config` [S12] | 명령만 |

### 2.6 L1-d 권한 모드, 규칙, 승인 캐시

| 항목 | 층 | 런타임별 제공 형태 | 범위 | 런타임 중 변경 | 우리 권장 |
|---|---|---|---|---|---|
| 권한 모드 | L1-d | [원문] CC `permissions.defaultMode`(default, acceptEdits, plan, auto, dontAsk, bypassPermissions), `--permission-mode`, Shift+Tab 순환, 관리 `disableBypassPermissionsMode`와 `disableAutoMode` [S01 S04 S06]. Codex `approval_policy`(on-request, never, granular 객체), `approvals_reviewer`(user 또는 auto_review) [S15]. omp `tools.approvalMode`(always-ask, always-ask-cached, write, yolo, 기본 yolo), `--approval-mode`, `--yolo` [S37]. Gemini `general.defaultApprovalMode`(default, auto_edit, plan), `--yolo`, `security.disableYoloMode` [S22]. Goose `GOOSE_MODE`(기본 auto, approve, chat, smart_approve) [S23]. Cursor는 Auto-review(권장), Allowlist, Run Everything [S25] | 사용자, 프로젝트, 관리, 세션 | [원문] CC는 Shift+Tab으로 세션 중 바꾼다 [S06]. 나머지 방식은 [추측] | UI 필요 (각 모드가 자동 승인하는 범위를 설명. 기본값은 보수적으로. omp의 기본 yolo는 반면교사다 [추측]) |
| allow, ask, deny 규칙 | L1-d | [원문] CC `permissions.allow`, `ask`, `deny`(도구 패턴)와 `/permissions` 대화상자(범위별 보기, 추가, 삭제) [S01 S03 S11]. opencode `permission.<도구>`(allow, ask, deny), `permission.shell`(명령 패턴), 마지막 일치 우선 [S20]. omp `tools.approval.<도구>`(allow, deny, prompt) [S37]. Gemini `tools.allowed`, `tools.confirmationRequired`, `tools.exclude`, `mcpServers.<이름>.trust` [S22]. Zed `agent.tool_permissions`(default confirm, allow, deny, 도구별 정규식 목록) [S30]. Cursor `terminalAllowlist`, `mcpAllowlist`(사용자와 저장소 파일 병합) [S26] | 사용자, 프로젝트, 관리 | [원문] 파일 변경은 즉시 반영된다 [S02] | UI 필요 (규칙 편집기, 우선순위 표시, 각 규칙이 나온 파일 표시) |
| 승인 캐시(영구 승인) | L1-d | [원문] CC "Yes, and don't ask again"은 `.claude/settings.local.json`에 규칙을 쓴다 [S11]. omp `always-ask-cached`는 승인 DB에 기록하며 세션 간 기억을 끌 수 있고, `/forget-approvals`로 지운다 [S37]. opencode "always"는 현재 세션에만 적용된다 [S20]. Gemini `security.enablePermanentToolApproval`, `disableAlwaysAllow` [S22]. Zed "Always for <도구>"는 도구 기본값을 바꾼다 [S30]. Cursor "Always Run"은 저장이 불안정하다는 포럼 보고가 있다 [추측: 비공식] | 프로젝트, 사용자 | 즉시 | UI 필요 (승인 목록 조회와 철회, 감사 기록) |
| 자동 모드 분류기 지침 | L1-d | [원문] CC `autoMode`(allow와 deny 규칙 추가), `autoMode.environment`, `claude auto-mode defaults`, `config`, `reset`, `/auto-mode-setup` [S01 S03 S04]. Cursor `permissions.json`의 `autoRun.allow_instructions`와 `block_instructions` [S26]. Codex `auto_review.policy`, `auto_review.extra_policy`(Markdown) [S15] | 사용자, 관리 | [추측] 세션 중 반영 | 파일만 (기본값 보기 명령 병행) |

### 2.7 L1-e 컴팩션

| 항목 | 층 | 런타임별 제공 형태 | 범위 | 런타임 중 변경 | 우리 권장 |
|---|---|---|---|---|---|
| 자동 컴팩션 켜기와 끄기 | L1-e | [원문] CC `autoCompactEnabled`, `DISABLE_AUTO_COMPACT`, `idleCompaction`(유휴 시 압축) [S01 S05]. omp `compaction.enabled` [S36]. pi `compaction.enabled`(기본 켜짐) [S33]. opencode `compaction.auto` [S18]. Zed `agent.auto_compact.enabled` [S28]. Goose는 `GOOSE_AUTO_COMPACT_THRESHOLD`를 0으로 두면 끈다 [S23] | 사용자, 프로젝트 | [원문] CC는 `/autocompact`로 세션 중 바꾼다 [S03] | 명령만 |
| 컴팩션 임계 | L1-e | [원문] CC `autoCompactWindow`(토큰), `/autocompact <크기 또는 auto>`, `CLAUDE_CODE_AUTO_COMPACT_WINDOW`(100k에서 1M), `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` [S12 S05]. Codex `model_auto_compact_token_limit`과 scope(total 또는 body_after_prefix) [S15]. Gemini `model.compressionThreshold`(0.5) [S22]. Goose `GOOSE_AUTO_COMPACT_THRESHOLD`(0.8) [S23]. Zed `agent.auto_compact.threshold`(90%) [S28]. omp `compaction.reserveTokens`, `keepRecentTokens`(20000) [S36] | 사용자, 프로젝트, 세션 | [원문] 세션 중 가능 [S03] | 명령만 (고급 값은 파일) |
| 컴팩션 프롬프트와 보존 | L1-e | [원문] Codex `compact_prompt`, `experimental_compact_prompt_file` [S15]. CC `/compact [지침]` [S03]. opencode `compaction.prune`(오래된 도구 출력 제거), `compaction.reserved` [S18] | 사용자, 프로젝트 | 세션 | 파일만 |

### 2.8 L1-f 세션 보관과 내보내기

| 항목 | 층 | 런타임별 제공 형태 | 범위 | 런타임 중 변경 | 우리 권장 |
|---|---|---|---|---|---|
| 보관 기간과 개수 | L1-f | [원문] CC `cleanupPeriodDays`, `desktopSessionCleanupPeriodDays` [S01]. Gemini `general.sessionRetention.enabled`, `maxAge`(30d), `maxCount`, `minRetention`(1d) [S22]. Codex `history.persistence`(save-all 또는 none), `history.max_bytes` [S15]. pi `sessionDir`과 `PI_CODING_AGENT_SESSION_DIR` [S33] | 사용자 | [추측] 기동 시 적용 | UI 필요 (삭제 대상 수 미리보기, 복구 불가 경고) |
| 내보내기와 공유 | L1-f | [원문] CC `/export [파일명]`(텍스트) [S03]. pi `/export`(HTML 또는 JSONL), `/share`(뷰어 링크), `/import`(JSONL 재개) [S35]. opencode `/export`(Markdown 파일) [S19]. pi 문서는 공유 전에 민감 정보를 검토하라고 권고한다 [S35] | 세션 | 세션 명령 | 명령만 (공유 전 경고 확인 단계) |
| 재개와 분기 | L1-f | [원문] CC `/resume`, `/branch`, `/fork`, `/rewind`, `/clear [이름]` [S03]. pi `/tree`, `/fork`, `/clone`, `doubleEscapeAction`(tree, fork, none) [S33]. opencode `/sessions`, `/undo`, `/redo` [S19] | 세션 | 세션 명령 | 명령만 |

### 2.9 L1-g 서브에이전트 정의, 모델, 깊이

| 항목 | 층 | 런타임별 제공 형태 | 범위 | 런타임 중 변경 | 우리 권장 |
|---|---|---|---|---|---|
| 서브에이전트 정의 | L1-g | [원문] CC `.claude/agents/` 파일, `/agents`(생성 안내), `--agents` JSON, `agent` 키(세션을 이름 있는 서브에이전트로 시작) [S01 S03 S04]. opencode `agent.<이름>.{description, model, prompt, tools, permission}`과 마크다운 에이전트 파일 [S18 S20]. Codex `agents.<이름>.description`, `config_file` [S15]. Gemini `agents.overrides` [S22]. omp `task.agentAdvisor`, `task.agentModelOverrides`, `task.agentServiceTierOverrides`, `task.agentAccountPools`(에이전트 이름별) [S36] | 프로젝트, 사용자 | [추측] 다음 호출부터 | 파일만 (정의). 이름별 모델 매핑은 UI 필요 |
| 깊이와 활성화 | L1-g | [원문] opencode `subagent_depth`(기본 1, 0이면 서브에이전트 금지) [S18]. Codex `agents.enabled`, `features.multi_agent` [S15]. Gemini `experimental.enableAgents` [S22]. CC `disableAgentView`(백그라운드 에이전트와 에이전트 뷰 끔) [S01] | 사용자, 관리 | [추측] 기동 시 적용 | 파일만 (관리 정책 잠금 표시) |
| 서브에이전트 기본 모델과 추론 | L1-g | [원문] CC `CLAUDE_CODE_SUBAGENT_MODEL`, `subagentStatusLine`, `subagentPromptCacheTtl` [S05 S01]. Codex `agents.default_subagent_model`, `agents.default_subagent_reasoning_effort`(명시 지정이 우선) [S15]. Zed `agent.subagent_model` [S28]. omp `tier.subagent`(서비스 티어) [S36] | 사용자, 프로젝트 | [추측] 다음 호출부터 | UI 필요 (L1-c 라우팅 표와 한 화면) |

### 2.10 L2 MCP, 스킬, 메모리, 웹 제공자, 브라우저, 도구 노출

| 항목 | 층 | 런타임별 제공 형태 | 범위 | 런타임 중 변경 | 우리 권장 |
|---|---|---|---|---|---|
| MCP 서버 정의 | L2 | [원문] CC `claude mcp add --scope local/project/user`. local과 user는 `~/.claude.json`, project는 `.mcp.json`에 쓴다 [S08]. `/mcp`로 목록, 재연결, 켜기와 끄기 [S03]. Codex `mcp_servers.<id>.*`(command, args, url, env, enabled, required, 시간 제한, 도구 허용과 차단) [S15]. Gemini `mcpServers.<이름>.*` [S22]. pi `mcp.json`(agent-dir과 `.pi`) [S35]. opencode `mcp.<이름>`(type, url, enabled) [S18]. Goose `extensions:`와 데스크톱 Extensions [S23] | 사용자, 프로젝트 | [원문] `/mcp`는 세션 중 가능 [S03] | UI 필요 (서버 목록, 켜기 토글, 연결 상태). 정의 자체는 파일 |
| MCP 허용과 차단(관리) | L2 | [원문] CC `allowedMcpServers`, `deniedMcpServers`(URL, 명령, 이름), `enabledMcpjsonServers`, `disabledMcpjsonServers`, `managedMcpServers`, `allowManagedMcpServersOnly` [S01]. Gemini `mcp.allowed`, `mcp.excluded`, `admin.mcp.config`, `requiredConfig` [S22]. Codex `mcp_servers.<id>.enabled_tools`, `disabled_tools` [S15] | 관리, 사용자 | 관리 정책은 기동 시 | UI 필요 (관리 잠금 표시) |
| 도구별 승인과 노출 | L2 | [원문] Codex `mcp_servers.<id>.tools.<도구>.approval_mode`(auto, prompt, writes, approve) [S15]. Cursor `mcpAllowlist`(server:tool 형식) [S26]. omp `tools.approval`에 `mcp__<이름>` 키 [S37]. Gemini `includeTools`, `excludeTools`, `trust` [S22] | 사용자, 프로젝트 | 세션 중 [추측] | UI 필요 (도구 체크 트리) |
| 스킬 | L2 | [원문] CC `/skills`(가시성 순환), `skillOverrides`, `disableBundledSkills`, `skillListingBudgetFraction` [S01 S03]. Codex `skills.config[].path`, `enabled`, `skills.max_context_tokens` [S15]. Gemini `skills.enabled`, `skills.disabled` [S22]. pi `skills` 경로와 `enableSkillCommands` [S33] | 사용자, 프로젝트 | 세션 중 `/skills` [원문 S03] | UI 필요 (켜기와 끄기 목록, 컨텍스트 토큰 비용 표시) |
| 메모리와 지침 파일 | L2 | [원문] CC `autoMemoryEnabled`(`/memory` 토글이 사용자 설정에 저장), `autoMemoryDirectory`, `claudeMdExcludes` [S09 S01]. Codex `memories.*`(사용 여부, 생성 여부, 모델, 롤아웃 기간 30일, 최소 한도 여유 25%) [S15]. Gemini `experimental.autoMemory`, `/memory inbox`(검토 후 적용), `context.fileName`, `memoryBoundaryMarkers` [S22]. pi `AGENTS.md`와 `CLAUDE.md`, `AGENTS.override.md` [S35]. opencode `instructions`, `/init`이 AGENTS.md를 만든다 [S18 S19] | 사용자, 프로젝트 | 세션 중 [추측] | UI 필요 (메모리 열람, 편집, 삭제, 자동 기록 토글) |
| 웹 검색과 가져오기 제공자 | L2 | [원문] Codex `web_search`(disabled, cached, indexed, live), `tools.web_search` [S15]. CC `skipWebFetchPreflight`, `CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS` [S01 S05]. omp `modelRoles.web`과 `retry.fallbackChains.web`(duckduckgo, parallel, perplexity, exa, firecrawl) [S36]. Gemini `experimental.directWebFetch` [S22] | 사용자, 프로젝트 | 세션 중 [추측] | UI 필요 (제공자 선택과 폴백 순서, 키 상태) |
| 브라우저와 컴퓨터 사용 정책 | L2 | [원문] Codex `browser_use.default_origin_policy`와 `origins.<출처>`(access, uploads, downloads, full_cdp_access), `computer_use.*` [S15]. Codex 데스크톱은 Browse, Download, Upload를 승인 필요, 항상 허용, 차단으로 고른다 [S17]. CC `/chrome`, `claudeInChromeDefaultEnabled`, 관리 `disableBrowserExternalNavigation`, 데스크톱 `.claude/launch.json` [S01 S14]. Gemini `agents.browser.*`(sessionMode, headless, allowedDomains, confirmSensitiveActions, blockFileUploads) [S22]. omp 컴퓨터 사용 안전 등급 [S37] | 사용자, 프로젝트, 관리 | 세션 중 [추측] | UI 필요 (도메인, 업로드, 다운로드 정책 표) |
| 도구 전체 켜기와 끄기 프로파일 | L2 | [원문] Zed 프로파일은 도구 체크, MCP 도구, 기본 모델을 묶는다 [S29]. pi `defaultTools`(+이름과 -이름 조합) [S33]. CC `--tools`, `--disallowedTools` [S04]. opencode `tools`(켜기와 끄기) [S18]. Gemini `tools.core`, `tools.allowed`, `tools.exclude` [S22] | 사용자, 프로젝트 | 세션 중 [추측] | UI 필요 (프로파일 단위 저장과 전환) |

### 2.11 X 플러그인, 신뢰, 안전 모드, 훅

| 항목 | 층 | 런타임별 제공 형태 | 범위 | 런타임 중 변경 | 우리 권장 |
|---|---|---|---|---|---|
| 플러그인 켜기와 끄기 | X | [원문] CC `enabledPlugins`(6개 출처에 우선순위), `/plugin` Installed 탭(사용자 수준에 저장), `claude plugin enable` 또는 `disable`, `pluginConfigs`(설정 응답 저장) [S10 S01]. Codex `plugins.<id>.enabled`, `plugins.<id>.mcp_servers.<이름>.enabled` [S15]. pi `packages`, `extensions`, `-builtin:mcp` 같은 끄기 표기, `/reload` [S33]. opencode `plugin` 배열(npm 패키지) [S18]. Gemini `experimental.extensionManagement`, 관리 `admin.extensions.enabled` [S22] | 사용자, 프로젝트, 관리 | [원문] `/reload`로 반영한다 (pi) [S35] | UI 필요 (설치, 켜기, 범위 토글과 출처 표시) |
| 마켓플레이스 허용 목록 | X | [원문] CC `extraKnownMarketplaces`, 관리 `strictKnownMarketplaces`, `blockedMarketplaces`, `strictPluginOnlyCustomization`(관리) [S01]. Codex `marketplaces.<이름>.source`와 `ref`(신뢰된 프로젝트에서만) [S15] | 관리, 프로젝트 | 기동 시 | 파일만 (화면은 읽기 전용 표시) |
| 프로젝트 신뢰 | X | [원문] pi `/trust`로 신뢰를 저장하고 `defaultProjectTrust`(ask, always, never)는 agent-dir 전용 [S33 S35]. Codex `projects.<경로>.trust_level`(trusted 또는 untrusted, 미신뢰 프로젝트는 `.codex` 계층을 무시) [S15]. Gemini `security.folderTrust.enabled`, `GEMINI_CLI_TRUST_WORKSPACE` [S22] | 사용자 | 세션 중 명령 | UI 필요 (프로젝트별 신뢰 상태와 재확인) |
| 안전 모드와 기능 잠금 | X | [원문] CC `--safe-mode`(CLAUDE.md, skills, plugins, hooks, MCP를 모두 끔), `--restricted`, `--bare` [S04]. CC `disableAllHooks` [S01]. Gemini `security.disableYoloMode`, `disableAlwaysAllow`, 관리 `admin.secureModeEnabled` [S22] | 사용자, 관리 | 플래그는 기동 시 | 명령만 (`--safe-mode`와 복구 안내) |
| 훅 | X | [원문] CC `hooks` 객체, `/hooks`(보기만), `allowManagedHooksOnly`, `allowedHttpHookUrls` [S01 S03]. Codex `hooks.<이벤트>`(PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, SessionStart, SessionEnd, SubagentStart, SubagentStop, UserPromptSubmit, Stop, Interrupt), 요구 사항 파일의 `allow_managed_hooks_only` [S15 S16]. Gemini `hooksConfig.enabled`, `hooks.BeforeTool` 등 [S22] | 사용자, 프로젝트, 관리 | [추측] 기동 시 적용 | 파일만 (화면에는 켜기와 끄기와 목록만) |

### 2.12 L3 그룹 토글과 그룹 설정

| 항목 | 층 | 런타임별 제공 형태 | 범위 | 런타임 중 변경 | 우리 권장 |
|---|---|---|---|---|---|
| 기능 플래그 그룹 | L3 | [원문] Codex `features.*`에 앱, code_mode, goals, hooks, memories, multi_agent, shell_tool, unified_exec, web_search 등 on/off 항목이 많다 [S15]. Gemini `experimental.*`(음성, 서브에이전트, 워크트리, 확장) [S22]. CC `enableWorkflows`, `disableWorkflows`, `ultracode` [S01]. pi 내장 확장 그룹의 켜기와 끄기 [S33] | 사용자, 프로젝트 | 기능마다 다름 [추측] | UI 필요 (그룹 토글 목록과 실험 표시) |
| 그룹 단위 잠금 | L3 | [원문] CC `strictPluginOnlyCustomization.skills`, `.hooks`, `.mcp`, `.agents`(관리) [S01]. Gemini `admin.skills.enabled`, `admin.mcp.enabled`, `admin.extensions.enabled` [S22] | 관리 | 기동 시 | UI 필요 (그룹 잠금 배지) |
| 그룹 프리셋 | L3 | [원문] omp `modelPresets`(역할 묶음과 추론 수준), `/modelpreset save` [S36]. Zed 프로파일(도구, MCP, 모델 묶음) [S29]. Codex `permissions.<이름>` 프로파일 [S15] | 사용자, 프로젝트 | 세션 전환 | UI 필요 (프리셋 저장과 전환. L3 그룹 설정의 핵심 후보) |

### 2.13 층 밖 항목(표시와 입력)

| 항목 | 층 | 런타임별 제공 형태 | 범위 | 런타임 중 변경 | 우리 권장 |
|---|---|---|---|---|---|
| 테마와 외관 | 층 밖 | [원문] CC `theme`, `/theme` [S01 S03]. pi `theme`(system 기본) [S33]. Codex `tui.theme`, 데스크톱 Appearance(테마, 강조색, 글꼴, 글자 크기) [S15 S17]. Gemini `ui.theme`, `ui.autoThemeSwitching` [S22] | 사용자 | 즉시 | UI 필요 (미리보기) |
| 상태 줄 | 층 밖 | [원문] CC `statusLine`(command, padding, refreshInterval 최소 1초), `/statusline` [S13]. Codex `tui.status_line`(항목 배열) [S15]. Gemini `ui.footer.items` [S22]. omp `statusLine` 세그먼트(비용 포함) [S36] | 사용자 | 즉시 | 파일만 (세그먼트 선택은 UI 필요) |
| 키 바인딩 | 층 밖 | [원문] CC `/keybindings`로 파일 열기 [S03]. Codex `tui.keymap.<맥락>.<동작>` [S15]. opencode `tui.json`의 `keybinds` [S19]. pi `keybindings.json` [S35]. omp `keybindings.md` [S36] | 사용자 | 재로드 필요 [추측] | 파일만 (화면은 충돌 검사 표시) |
| 응답 표시 | 층 밖 | [원문] CC `outputStyle`(Default, Proactive, Concise, Explanatory, Learning). `/output-style`는 `.claude/settings.local.json`에 저장 [S07 S01]. CC `showThinkingSummaries`, pi `hideThinkingBlock` [S01 S33]. omp `hideThinkingBlock` [S36] | 사용자, 프로젝트 | 세션 명령 | UI 필요 (미리보기 가능한 목록) |

## 3. 공통 원칙 "설정은 한 스키마에서 UI, 파일, 명령을 모두 만든다"의 사례 검증

| 사례 | 근거 | 판정 |
|---|---|---|
| omp: 설정 정의(`register`)가 키, 타입, 기본값, 열거값을 만든다. 같은 정의가 `/settings` 패널, `omp config list/get/set/reset`, `config.yml` 쓰기에 쓰인다. `config set`의 값 파싱도 스키마 타입(boolean, number, enum, array, record, string)으로 한다 [원문 S36] | 문서가 "키, 타입, 기본값, 열거값은 모두 설정 정의에서 온다"고 명시한다 | 가장 가까운 사례다. 한 정의에서 세 입구를 만든다 |
| pi: `settings-schema.ts`와 `settings-defaults.ts`에 스키마와 기본값, `settings-selector.ts`에 UI 항목 39개, `docs/settings.md`에 표가 있다 [원문 S33 S34] | 세 파일의 키가 같다는 점은 확인했다. 하나에서 생성되는지는 확인하지 못했다 [추측] | 부분 사례다. 일치하는 수작업 이중화일 수도 있다 |
| Claude Code: `/config key=value`로 키를 명령으로 바꾸고, `--settings` JSON으로 같은 키를 세션 한정으로 주입한다. 많은 키가 전용 플래그와 env 쌍을 가진다 [원문 S02] | 한 키가 파일, 명령, 플래그, env의 네 입구를 가진다. 생성 방식은 공개되지 않았다 [추측] | 입구가 여러 개라는 점은 확인된다. 생성 방식은 미확인이다 |
| Cursor: UI가 파일 계층을 보여 주고, 파일이 정의한 항목은 UI에서 잠근다 [원문 S26] | UI가 뷰와 편집 게이트 역할을 한다 | 설계 참고로 쓸 만하다 |
| Zed: 프로파일은 settings.json의 `agent.profiles`에 있고, "manage profiles" 화면이 같은 데이터를 편집한다 [원문 S29] | 파일과 UI가 같은 저장소를 본다 | 파일과 UI 동기화 사례다 |
| 반례 1: Codex 공식 문서는 config.toml 키만 다루며, 데스크톱 앱 설정은 어떤 config 키와도 매핑하지 않는다고 명시한다 [원문 S17] | 앱 설정은 별도 저장소다 | 스키마 하나로 묶이지 않는다 |
| 반례 2: CC `/config`의 저장 파일이 항목마다 다르다 [원문 S02] | 사용자가 값이 어디에 저장되는지 알기 어렵다 | 설계에서 저장 위치 표시가 필요하다 [추측] |

결론: 공통 원칙은 성립 가능하다. 다만 현재 확인한 런타임 중에서 완전히 이 원칙을 따르는 것은 omp뿐이다 [추측]. 나머지는 파일이 원천이고 UI는 그 위에 얹힌 구조다.

## 4. L4 설정 화면 정보 구조 초안

| 탭 | 포함 항목(층) | 편집 방식 | 비고 |
|---|---|---|---|
| 0. 개요 | 유효 설정과 출처, 잠긴 항목, 사용량 요약(F5, L1-c) | 읽기 전용과 바로가기 | "원본 파일 열기" 버튼 |
| 1. 모델 | 기본 모델, 역할 라우팅, 폴백 체인, 추론 레벨, 추론 예산, 허용 목록(L1-c, L1-g) | 역할 표 편집기 | 세션 중 변경과 저장을 구분 표시 |
| 2. 예산과 한도 | 단계 상한, 비용 예산, 종료 조건, 레이트 리밋 정책, 요청 간격, 재시도(L1-b, L1-c) | 폼과 게이지 | 소진 시 동작을 명시 |
| 3. 계정과 제공자 | 제공자 연결, 계정 풀, 우선순위, 예약 %, 엔드포인트(L1-c, L0 비밀) | 목록 UI. 키는 등록 전용 | 키 값은 표시하지 않음 |
| 4. 권한 | 권한 모드, 규칙, 승인 캐시, 자동 모드 지침(L1-d) | 규칙 편집기 | 모드마다 설명을 붙임 |
| 5. 샌드박스와 네트워크 | 샌드박스, 경로, 도메인, 프록시(L0) | 목록 편집 | 차단 규칙이 우선 |
| 6. 세션과 컨텍스트 | 자동 컴팩션, 임계, 보관 기간, 내보내기, 메모리(L1-e, L1-f, L2) | 토글과 명령 | 삭제는 확인 단계를 거침 |
| 7. 도구와 확장 | MCP 서버, 도구 노출, 스킬, 웹 제공자, 브라우저 정책(L2) | 목록 토글과 파일 | 관리 잠금 표시 |
| 8. 플러그인과 신뢰 | 플러그인 켜기와 끄기, 마켓플레이스, 프로젝트 신뢰, 안전 모드, 훅(X) | 목록과 읽기 전용 | 관리 정책 표시 |
| 9. 에이전트 | 서브에이전트 목록, 깊이, 기본 모델(L1-g) | 목록과 파일 | 이름별 모델 매핑 |
| 10. 실행과 알림 | 셸, 큐 모드, 동시 상한, 알림(L0, L1-a) | 토글 | 실행 중 작업 목록과 연결 |
| 11. 그룹 | 기능 플래그 그룹, 프리셋(L3) | 토글과 프리셋 저장 | 프리셋 전환 시 변경 목록 표시 |
| 12. 고급 | 캐시 TTL, 재시도 수치, 샘플링, 텔레메트리, 파일 편집(파일만 항목) | 스키마 기반 파일 편집기 | 입력 검증은 스키마 타입으로 |

화면 공통 규칙은 다음과 같다 [추측].

- 모든 항목에 범위 배지(관리, 사용자, 프로젝트, 세션), 세션 중 변경 가능 여부, 관리 잠금 배지를 붙인다.
- 모든 항목에 저장 파일 경로를 표시한다. 이 점은 2.1절 반례 2를 따른 것이다.
- 비밀 값은 다시 보여주지 않는다. 키 이름과 상태만 보여준다. omp의 마스킹 방식을 따른다 [원문 S36].
- 예산, 한도, 계정 탭은 현재 상태 게이지를 함께 둔다.
- 설정 항목은 한 스키마(키, 타입, 기본값, 범위, 세션 중 변경 가능 여부, 층, UI 힌트, 비밀 여부, 재시작 필요 여부)에서 UI, 파일, 명령을 함께 만드는 것을 권장한다. 이 스키마 방식은 omp 사례와 같은 방향이다.

## 5. 요약

- 요구한 항목 중 추론 예산, 용도별 라우팅, 레이트 리밋, 계정 회전은 L1-c에 모인다. 권한과 샌드박스는 L1-d와 L0에 걸친다.
- 다른 층에도 같은 종류의 항목이 있다. 단계와 비용 예산은 L1-b, 서브에이전트 모델은 L1-g, 웹 검색 제공자와 MCP 허용 목록은 L2, 관리 잠금은 F5에 있다.
- UI가 꼭 필요한 항목은 모델 역할 표, 추론 예산(토큰 수), 폴백 체인, 레이트 리밋과 사용량 화면, 계정 풀, 권한 규칙 편집기, 샌드박스 경로와 도메인, 예산 한도이다 [추측].
- 명령만으로 충분한 항목은 추론 레벨, 컴팩션 on/off와 임계, 큐 모드, 목표(`/goal`), 내보내기다 [추측].
- 파일만 두어도 되는 항목은 샘플링, 재시도 수치, 엔드포인트, 훅 정의, 셸 설정, 서브에이전트 정의다 [추측].

## 6. 미확인 항목과 한계

- 웹 출처는 WebFetch 요약을 거쳤다. 특히 Claude Code 모델 설정 페이지(120,928자 중 100,000자까지), 데스크톱 페이지(163,564자 중 100,000자까지), Codex 설정 참조(156,747자 중 100,000자까지)는 뒤쪽을 읽지 않았다.
- Codex: 설정 참조의 `profiles` 키 자체는 문서에 항목이 없고 프로파일은 별도 파일로 설명된다 [원문 S15]. 우선순위 전체는 확인하지 못했다.
- Gemini CLI: 명령행 인자 섹션과 슬래시 명령 목록이 잘렸다. `/settings`, `/model`, `/tools`, `/mcp`의 저장 여부는 확인하지 못했다. 페이지 배너에는 2026년 6월 18일부터 무료 등급과 Google One 사용자에게 Gemini CLI가 Antigravity CLI로 대체된다는 공지가 있다 [원문 S22]. 조사 대상으로서의 유지 상태에 영향을 줄 수 있다 [추측].
- Goose: 데스크톱 설정 페이지를 확인하지 못했다. `/mode` 명령은 비공식 요약에만 나온다 [S24]. 모드 이름도 API 참조와 문서가 어긋난다는 보고가 있다 [추측].
- Cursor: 공식 모델 선택과 Max Mode 문서를 확인하지 못했다. 모델 항목의 Cursor 칸은 비어 있다. 실행 모드와 permissions.json은 공식 문서로 확인했다 [S25 S26].
- Zed: "All Settings" 전체 페이지를 확인하지 못했다. `agent.default_model`은 미리보기와 미러 문서에서만 보이므로 불확실하다 [S28]. 도구 권한 키는 공식 페이지로 확인했다 [S30].
- Cline과 Roo Code: 문서가 제한적이다. Roo의 요청 간격 설정만 확인했다 [S31]. Cline은 레이트 리밋과 세부 설정 키 문서가 없다 [S32].
- Claude Code: 로컬 문서 사본 기준이다. 설정 색인에 245개 항목이 있고 관리 전용 키가 44개다 [S01]. 버전에 따라 다를 수 있다.
- omp: 문서는 "설정 카탈로그는 주요 항목만 강조하며 전체 스키마가 아니다"라고 명시한다. 권위 있는 전체 목록은 `omp config list`다 [원문 S36]. 본 조사는 로컬 문서만 읽었고 소스 코드 스키마는 읽지 않았다.
- pi: pi-src에는 `settings-schema.ts`가 있으나 키 전체를 대조하지는 않았다. UI 항목은 `settings-selector.ts`의 id 39개를 셌다 [S34]. `retry.*`, `thinkingBudgets`, `compaction.reserveTokens` 같은 세부 키는 UI에 없다.
- 전 항목의 "런타임 중 변경 가능 여부"는 문서에 명시된 것만 [원문]으로 표기했다. 나머지는 [추측]이다.
- 실행 검증: 작업 디렉터리 `/home/user/projects/helm`에 justfile이 없다. `just --list`는 "no justfile found"를 냈다. 따라서 `just verify`는 실행하지 못했다. 산출물은 scratchpad 문서뿐이며 코드는 변경하지 않았다.
- 같은 디렉터리 `research/r2`에 있는 다른 파일(ext-points.md, process.md, secrets.md)은 읽거나 수정하지 않았다.

## 7. 출처

| 번호 | 출처 | 종류 |
|---|---|---|
| S01 | `/tmp/claude-1000/-home-user-projects-helm/18be0c42-9f6e-4c80-8aa6-91ac9c0b15e2/scratchpad/ext/claude-code/docs/settings-reference.md` | 로컬 사본, 설정 색인 |
| S02 | 위 docs 경로의 `settings.md` | 로컬 사본, 파일과 우선순위 |
| S03 | 위 docs 경로의 `commands.md` | 로컬 사본, 명령 |
| S04 | 위 docs 경로의 `cli-reference.md` | 로컬 사본, 플래그 |
| S05 | 위 docs 경로의 `env-vars.md` | 로컬 사본, 환경변수 |
| S06 | 위 docs 경로의 `permission-modes.md` | 로컬 사본 |
| S07 | 위 docs 경로의 `output-styles.md` | 로컬 사본 |
| S08 | 위 docs 경로의 `mcp.md` | 로컬 사본 |
| S09 | 위 docs 경로의 `memory.md` | 로컬 사본 |
| S10 | 위 docs 경로의 `plugins/loading.md` | 로컬 사본 |
| S11 | 위 docs 경로의 `permissions.md` | 로컬 사본 |
| S12 | https://code.claude.com/docs/en/model-config | 웹, WebFetch 요약 |
| S13 | https://code.claude.com/docs/en/statusline | 웹, WebFetch 요약과 본문 검색 |
| S14 | https://code.claude.com/docs/en/desktop | 웹, WebFetch 요약 |
| S15 | https://learn.chatgpt.com/docs/config-file/config-reference (developers.openai.com/codex/config-reference에서 리다이렉트) | 웹, WebFetch 요약 |
| S16 | https://github.com/openai/codex/blob/main/docs/config.md | 웹, WebFetch 요약 |
| S17 | https://learn.chatgpt.com/docs/reference/settings (developers.openai.com/codex/app/settings에서 리다이렉트) | 웹, WebFetch 요약 |
| S18 | https://opencode.ai/docs/config/ | 웹, WebFetch 요약 |
| S19 | https://opencode.ai/docs/tui/ | 웹, WebFetch 요약 |
| S20 | https://opencode.ai/docs/permissions/ | 웹, WebFetch 요약 |
| S21 | https://opencode.ai/docs/providers/ | 웹, WebFetch 요약 |
| S22 | https://geminicli.com/docs/reference/configuration (get-started/configuration에서 리다이렉트) | 웹, WebFetch 요약. 명령행 인자 섹션은 잘림 |
| S23 | https://goose-docs.ai/docs/guides/config-files | 웹, WebFetch 요약 |
| S24 | https://goose-docs.ai/docs/guides/goose-permissions | WebSearch 결과 목록만 확인. 본문은 가져오지 못함 |
| S25 | https://cursor.com/docs/agent/run-modes | 웹, WebFetch 요약 |
| S26 | https://cursor.com/docs/reference/permissions | 웹, WebFetch 요약 |
| S27 | https://cursor.com/docs/context/rules | 웹, WebFetch 요약 |
| S28 | https://zed.dev/docs/ai/agent-settings.html | 웹, WebFetch 요약 |
| S29 | https://zed.dev/docs/ai/agent-profiles.html | 웹, WebFetch 요약 |
| S30 | https://zed.dev/docs/ai/tool-permissions.html | 웹, WebFetch 요약 |
| S31 | https://roocodeinc.github.io/Roo-Code/features/api-configuration-profiles (docs.roocode.com에서 리다이렉트) | 웹, WebFetch 요약 |
| S32 | https://docs.cline.bot/features/auto-approve | 웹, WebFetch 요약 |
| S33 | `/home/user/projects/_ref/pi-src/packages/coding-agent/docs/settings.md` | 로컬 문서, 읽기 전용 |
| S34 | `/home/user/projects/_ref/pi-src/packages/coding-agent/src/core/settings-schema.ts`, `src/modes/interactive/components/settings-selector.ts` | 로컬 소스, 읽기 전용 |
| S35 | `/home/user/projects/_ref/pi-src/packages/coding-agent/docs/slash-commands.md`, `docs/configuration.md`, `docs/models.md` | 로컬 문서, 읽기 전용 |
| S36 | `/tmp/claude-1000/-home-user-projects-helm/18be0c42-9f6e-4c80-8aa6-91ac9c0b15e2/scratchpad/ext/omp/repo/docs/settings.md` | 로컬 문서, 읽기 전용 |
| S37 | 위 omp 저장소의 `docs/approval-mode.md` | 로컬 문서, 읽기 전용 |
| S38 | 위 omp 저장소의 `docs/auth-broker-gateway.md` | 로컬 문서, 읽기 전용 |
