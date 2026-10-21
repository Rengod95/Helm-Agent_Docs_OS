# Hermes Agent 설계 조사 (F~L2 층, 자기 개선 루프 중심)

작성일 2026-10-21. 조사 틀은 `research/refs/_template.md`를 따른다.
표기: [원문] 소스 또는 공식 문서에서 직접 확인. [추측] 조사자의 추론. 근거 경로는 저장소 루트 기준 상대 경로이며, 루트는 `/tmp/claude-1000/-home-user-projects-helm/18be0c42-9f6e-4c80-8aa6-91ac9c0b15e2/scratchpad/ext/hermes/repo`이다.

## 0. 대상 정보

- 저장소: https://github.com/NousResearch/hermes-agent (`git clone --depth 50`, 새 빈 디렉터리에 받음).
- 커밋: `0319e113c9602b86ffda350e931cb4b035e1d5d8` (committer 시각 2026-10-20, 제목 `fix(mcp): rekeyed launch-profile connections keep their owner and tools`) [원문: git log].
- 버전: `pyproject.toml:7`의 `version = "0.0.0"`. 릴리스 정책상 커밋된 버전은 항상 0.0.0이며 릴리스 잡이 스탬프한다 [원문: website/docs/developer-guide/stable-releases.md:6-9]. `package.json`의 1.0.0은 npm 워크스페이스 루트용이다 [원문].
- 라이선스: MIT, Copyright (c) 2025 Nous Research (`LICENSE`).
- 언어: Python 3.11~3.14 (`pyproject.toml:15`). 그 밖에 TypeScript(`ui-tui/` Ink TUI, `apps/desktop/` Electron, `web/` 대시보드 SPA, `website/` Docusaurus).
- 규모: 테스트를 뺀 Python 소스는 약 90만 줄이다. 디렉터리별 `*.py` 줄 수 합산 기준 `hermes_cli/` 약 29만, `agent/` 약 14만, `tools/` 약 13만, `gateway/` 약 12만, `plugins/` 약 9만, `tui_gateway/` 약 5만, `cron/` 약 2만 [조사자 측정: `analysis/size_facts.py`, 저장소 밖에 둠].
- 패키지 구성: 최상위 평면 모듈 81개(`*.py`)와 패키지 디렉터리(`agent/ tools/ gateway/ hermes_cli/ cron/ plugins/ tui_gateway/ acp_adapter/ hermes_platform/ pm/`). 번들 스킬 `skills/` SKILL.md 58개, 선택 스킬 `optional-skills/` 153개, 선택 MCP 카탈로그 `optional-mcps/` 65개, 플러그인 카탈로그 `plugin-catalog/*.yaml` 705개, 모델 제공자 플러그인 `plugins/model-providers/` 41개, 플랫폼 플러그인 `plugins/platforms/` 27개 [조사자 측정].
- 테스트: `tests/`의 `test_*.py` 6,739개 [조사자 측정]. 문서 `architecture.md:137`은 "약 25,000 tests across 약 1,250 files"로 적는다. 두 수치가 어긋난다.
- 진입점: `hermes`(hermes_cli.main:main), `hermes-agent`(agent.legacy_cli:main), `hermes-acp`(acp_adapter.entry:main) [원문: `pyproject.toml:559-562`].
- 조사 범위: 개발자 문서 13종(아키텍처, 에이전트 루프, 도구 런타임, 세션 저장, 프롬프트 조립, 컴팩션·캐싱, 미들웨어, 관찰 훅, 게이트웨이 내부, 크론 내부, 서브에이전트 수명 API, 터미널 환경 플러그인, 모델 제공자 플러그인)과 사용자 문서 일부(memory, skills, curator), 그리고 소스 대조. 자기 개선 루프는 소스 기준으로 깊게 봤다.
- 못 본 것: 설치·빌드·테스트는 하지 않았다. 스트리밍 세부, 개별 provider 어댑터 내부, 브라우저·웹 검색 백엔드 세부, TUI·Desktop 내부, ACP·batch_runner·trajectory 세부, skills_hub 설치 경로와 `skills_guard.py` 내부, 플러그인 호스트 프로세스(`plugin_host.py`) 내부, `SECURITY.md`, 의존성 라이선스 전수 확인, 이슈·기여자 이력(얕은 clone이라 불가). 원격 백엔드(Modal·Daytona·Singularity·Vercel)의 실사용 성숙도는 확인하지 않았다.
- 실행 여부: 저장소 코드는 실행하지 않았다. 조사자가 쓴 Python 스크립트 2개(`/tmp/claude-1000/-home-user-projects-helm/18be0c42-9f6e-4c80-8aa6-91ac9c0b15e2/scratchpad/ext/hermes/analysis/`, 저장소 밖)는 `python3 -I`로 `ast.parse`와 줄 수 세기만 했다.
- 프로젝트 영향: `~/projects/helm`에는 justfile이 없고 프로젝트 코드도 바꾸지 않았다. 따라서 `just verify`는 해당 없다. 금지 경로(`_ref`, `homelab`, `.dotfiles`, `.helm/private`)는 읽지도 쓰지도 않았다.

## 1. 한눈 요약

1. Hermes는 하나의 Python 에이전트 코어(`AIAgent`)를 CLI, 메신저 게이트웨이, TUI, 데스크톱, ACP가 공유하는 구조다 [원문: architecture.md 시스템 개요]. 설계 원칙은 "좁은 허리(narrow waist)"다. 모든 도구 스키마가 매 호출에 실리므로 코어 도구 추가 기준을 높게 둔다 [원문: AGENTS.md "What Hermes Is"].
2. 자기 개선 루프는 별도 학습 모델이 아니다. 턴이 끝나면 카운터를 보고, 조건이 맞으면 대화 스냅샷을 가진 백그라운드 포크 에이전트가 같은 세션 ID와 프롬프트 캐시 접두부로 "스킬이나 메모리에 남길 것이 있는가"를 묻는다. 포크는 `skill_manage`와 `memory` 도구를 직접 호출한다 (`agent/turn_finalizer.py:782-791`, `agent/background_review.py:965-975, 1147-1209`).
3. 트리거는 카운터다. 메모리 검토는 사용자 턴 10회마다, 스킬 검토는 `skill_manage` 호출 없이 도구 반복이 10회 쌓이면 발동한다 (`agent/agent_init.py:1304, 1388-1390`, `agent/turn_finalizer.py:763-771`).
4. 저장소는 셋이다. 상시 메모리(MEMORY.md 2,200자, USER.md 1,375자, 세션 시작 시 고정 스냅샷), 절차 스킬(`~/.hermes/skills/`, 인덱스만 시스템 프롬프트에 들어가고 본문은 `skill_view`로 온디맨드 로드), 과거 대화 DB(SQLite FTS5, LLM 요약 없이 원문 반환).
5. 큐레이터는 유휴 시점에 도는 유지보수 패스다. 기본은 결정적 전이(14일 후 stale, 30일 후 아카이브)뿐이고 LLM 통합 패스는 기본 OFF다 (`agent/curator.py:35`, `hermes_cli/config_defaults.py:1521`). 백그라운드 경로의 삭제는 아카이브(복구 가능)이며, 큐레이터 대상은 `created_by: agent` 표시가 붙은 스킬로 한정된다.
6. 가장 큰 설계 쟁점은 안전장치의 기본값이다. 스킬·메모리 쓰기 승인 게이트(`write_approval`)와 에이전트 작성 스킬의 보안 스캔(`skills.guard_agent_created`)이 모두 기본 OFF다 (`hermes_cli/config_defaults.py:1333, 1488, 1497`). 기본 설정에서 학습은 사람 승인 없이 디스크에 쓰인다. 메모리 쓰기만 위협 패턴 검사가 항상 켜져 있다.
7. 확장은 `plugin.yaml` + `register(ctx)` 플러그인, 훅 46종, 미들웨어 4종, 그리고 ABC와 플러그인 디렉터리 조합(메모리, 컨텍스트 엔진, 모델 제공자, 터미널 백엔드 등)으로 이뤄진다. 플러그인 코드의 프로세스 격리(`plugins.isolation: host`)는 있으나 기본값은 `in_process`다.
8. 터미널 실행 백엔드는 로컬, Docker, SSH, Modal, Daytona, Singularity, Vercel Sandbox 7종이다. 제3자 백엔드는 `TerminalEnvironmentProvider` 플러그인으로 추가한다.
9. 상주 구조는 메시징 게이트웨이 프로세스 하나다. 채널 어댑터, 크론 틱, 큐레이터 폴링을 호스트하며, 한 프로세스가 여러 프로필을 서빙하는 멀티플렉싱을 지원한다 (`gateway/run.py:4371-4373, 4576`).
10. 문서와 소스가 어긋나는 곳이 여럿 있다. 에이전트 루프 문서의 "기본 500 반복"은 코드상 무제한이고, API 모드는 문서 3종과 달리 코드상 5종이며, 툴셋은 문서 "28개"와 달리 `TOOLSETS` 키가 59개다. 문서 수치를 그대로 인용하지 말고 소스 기준으로 읽어야 한다.

## 2. 층별 표

성숙도 기준 [추측]: 기본 활성이고 전용 테스트 파일이 있으면 "안정". 기본 OFF(옵트인)이거나 문서가 옵트인·실험으로 표기하면 "실험". 확인하지 못한 항목은 "미확인"으로 적는다.

| 층·항목 | 구현 방식 | 근거 | 성숙도 |
|---|---|---|---|
| F-1 내부 메시지 | OpenAI 호환 role/content/tool_calls 딕셔너리로 통일, 모델별 변환은 어댑터가 담당 | website/docs/developer-guide/agent-loop.md ("Message Format") | 안정 |
| F-2 도구 스키마 | ToolEntry(name, toolset, schema, handler, check_fn, requires_env, is_async, description, emoji, max_result_size_chars, dynamic_schema_overrides, execution_timeout) | tools/registry.py:216-233 | 안정 |
| F-3 세션 DB 스키마 | SQLite, SCHEMA_VERSION=32, 큰 백필은 2,000 id 청크로 쪼갬 | hermes_state_common.py:289; website/docs/developer-guide/session-storage.md:311-343 | 안정 |
| F-4 와이어(TUI·데스크톱) 계약 | Pydantic 모델을 원천으로 TS 타입과 OpenRPC JSON을 생성하고, 테스트가 재생성 결과를 커밋본과 diff | tui_gateway/contracts/base.py:1-11; scripts/gen_gateway_contracts.py | 안정 |
| F-5 플러그인 매니페스트 | plugin.yaml v1(무버전) + v2(manifest_version과 api_version 분리), 미지 필드는 무시하고 경고 | website/docs/developer-guide/plugins/index.md:191-200, 561-584 | 안정 |
| F-6 훅 페이로드 | 모든 훅 kwargs, `telemetry_schema_version="hermes.observer.v1"` | website/docs/developer-guide/observer-hooks.md (Contract) | 안정 |
| F-7 설정 | config.yaml은 행동, .env는 비밀 전용. 비밀이 아닌 설정용 HERMES_* 환경변수 신설은 기여 기준에서 거절 | AGENTS.md (Contribution rubric, Rejected) | 안정 |
| F-8 버전·의존성 정책 | 커밋 버전 0.0.0, 코어 의존성 정확 고정(==), 추가 기능은 extras로 분리, 공급망 사고 이력을 주석으로 기록 | pyproject.toml:19-34, 221 부근 extras | 안정 |
| L0-1 셸·샌드박스 추상 | BaseEnvironment ABC, 호출마다 spawn하고 세션 스냅샷을 유지. 백엔드 7종 | tools/environments/base.py:256; tools/environments/local.py:1 | 안정(로컬·Docker·SSH). 나머지 미확인 |
| L0-2 백엔드 플러그인 | TerminalEnvironmentProvider ABC(is_available, create_environment 필수) + 선언 플래그(skip_container_guards, strip_env_keys 등) | agent/terminal_env_provider.py:20-99; website/docs/developer-guide/terminal-environment-plugin.md:10-31 | 안정 |
| L0-3 비밀 | 프로필 범위 contextvar 비밀 스코프(os.environ에 합치지 않음), 로컬 Fernet 볼트(모델은 핸들만 봄), 외부 비밀 소스 플러그인(bitwarden, 1password, command) | agent/secret_scope.py:1-8; agent/vault_store.py:1-6; agent/secret_sources/ | 안정(존재 확인), 세부 미확인 |
| L0-4 호스트 사실 | hermes_platform.host 단일 조회 지점, 환경변수 입력 없음 | hermes_platform/AGENTS.md | 안정 |
| L0-5 백그라운드 프로세스 | 프로세스 레지스트리, 200KB 롤링 버퍼, JSON 체크포인트로 크래시 복구 | tools/process_registry.py:1-5 | 안정 |
| L0-6 데몬 스레드 풀 | 종료를 막지 않는 데몬 워커 풀(stdlib 워커 대신) | tools/daemon_pool.py:1-8 | 안정 |
| L0-7 프로세스 모델 | 게이트웨이 장기 프로세스 하나가 어댑터·크론·하우스키핑을 호스트. TUI는 Node와 Python이 stdio JSON-RPC로 통신. 서브에이전트는 같은 프로세스 스레드 | gateway/run.py:4361-4576; tui_gateway/AGENTS.md; tools/delegate_tool_child_run.py:845-848 | 안정 |
| L0-8 다중 프로필 | 한 프로세스가 여러 프로필을 서빙. 백그라운드 작업마다 프로필 바인딩을 명시해야 함 | AGENTS.md (Rules that apply everywhere); architecture.md:267 | 실험(멀티플렉싱 세부 미확인) |
| L1a-1 동시성 | 동기 루프 + 스레드. API 호출은 백그라운드 스레드에서 돌고 인터럽트 이벤트로 대기. 도구는 최대 8 워커로 병렬 | website/docs/developer-guide/agent-loop.md ("Interruptible API Calls"); agent/tool_executor.py:133 | 안정 |
| L1a-2 취소 전파 | 인터럽트 시 API 스레드를 버리고 부분 응답은 넣지 않음. 포크는 실행 핸드셰이크 객체로 취소 | agent/interrupt_control.py:1-5; agent/background_review.py:28-60 | 안정 |
| L1a-3 단계 사이 큐 | /steer는 도구 경계에서 주입하고, 최종 응답 뒤에 남으면 다음 사용자 턴으로 넘김. 실행 중 입력은 게이트웨이 2단계 가드가 분류 | agent/turn_finalizer.py:748-752; website/docs/developer-guide/gateway-internals.md:495-503 | 안정 |
| L1a-4 세션 입력 FIFO | 세션별 durable 입력 큐(queued, started, terminal). 소유자가 죽으면 started는 unknown이 되고 재실행하지 않음 | website/docs/developer-guide/session-storage.md:138-148 | 안정(문서 기술) |
| L1a-5 반복 예산 | IterationBudget(스레드 안전). 실행 생성자 기본은 sys.maxsize, 설정 agent.max_turns 기본은 null(무제한) | agent/iteration_budget.py:25-40; run_agent.py:241; hermes_cli/config_defaults.py:78-80 | 안정 |
| L1b-1 루프 본체 | run_conversation이 agent/conversation_loop.py(1,867줄)에 있고, 턴 단계는 agent/turn_*.py로 분리 | agent/conversation_loop.py; agent/turn_iteration_prep.py(566줄); agent/turn_api_call.py | 안정 |
| L1b-2 종료·검증 게이트 | 최종 응답 후 pre_verify 훅이 "계속" 메시지를 돌려줄 수 있음(상한 agent.max_verify_nudges). 턴 정지 게이트 모듈 | hermes_cli/plugins.py:107-160(주석); agent/turn_stop_gates.py | 안정 |
| L1b-3 예산 소진 안내 | 반복 예산이 차면 정리 안내 메시지를 대화에 주입 | agent/conversation_loop.py:124 (_maybe_inject_run_budget_wrapup) | 안정 |
| L1b-4 재개 정리 | 중단된 assistant(tool_calls)와 dangling 꼬리를 재개 전에 정리 | agent/replay_cleanup.py:1-6, 23 | 안정 |
| L1b-5 도구 가드레일 | 턴 내 도구 호출을 관찰하고 반복을 차단하는 컨트롤러(자체는 부작용 없음) | agent/tool_guardrails.py:1-3 | 안정 |
| L1c-1 API 모드 | 코드상 5종: chat_completions, codex_responses, anthropic_messages, bedrock_converse, codex_app_server. 플러그인 등록 모드도 허용 | hermes_cli/runtime_provider.py:135; agent/agent_init.py:382-385; agent/transports/__init__.py:44-50 | 안정(4종), 실험(codex_app_server 옵트인) |
| L1c-2 전송 계층 | agent/transports/에 chat_completions, anthropic, bedrock, codex, codex_app_server 각각 어댑터 | agent/transports/ | 안정 |
| L1c-3 제공자 선언 | ProviderProfile은 인증·엔드포인트·quirks를 선언. 클라이언트 생성, 자격 회전, 스트리밍은 소유하지 않음 | providers/base.py:1-8 | 안정 |
| L1c-4 제공자 플러그인 | plugins/model-providers/ 41개, 첫 조회 때 지연 탐색, 사용자 디렉터리로 번들을 대체 가능 | plugins/AGENTS.md:70-80; website/docs/developer-guide/model-provider-plugin.md | 안정 |
| L1c-5 폴백 | fallback_providers를 순서대로 시도. 401/403은 자격 갱신 후 실패 처리. 보조 작업(비전, 압축, 웹 추출)은 별도 체인 | website/docs/developer-guide/agent-loop.md ("Fallback Model"); agent/fallback_cooldown.py | 안정 |
| L1c-6 캐시 마커 | Anthropic cache_control 브레이크포인트 4개(정적 접두부 등), TTL 5분 또는 1시간 | agent/prompt_caching.py:3-5 | 안정 |
| L1d-1 도구 자동 발견 | tools/*.py의 최상위 registry.register() 호출을 AST로 찾아 import. 순환 import 없음 | tools/registry.py:84-177 | 안정 |
| L1d-2 가용성 게이트 | check_fn(도달성·옵트인 판정)을 세션 스코프로 캐시 | tools/registry.py:31-44, 276-440 | 안정 |
| L1d-3 툴셋 | TOOLSETS 키 59개(조사자 측정). 코어 목록은 _HERMES_CORE_TOOLS | toolsets.py:11-40, 74 | 안정 |
| L1d-4 에이전트 레벨 인터셉트 | todo_list, memory, session_search, delegate_task 등 14개 이상이 레지스트리를 거치지 않고 에이전트 상태를 직접 건드림 | agent/inline_tool_executors.py:253-311; agent/tool_executor.py:1673-1686 | 안정 |
| L1d-5 도구 지연 노출 | MCP·플러그인 도구는 tool_search, tool_describe, tool_call 브리지 뒤로 숨김. 3단계 티어 | tools/tool_search.py:1-8; hermes_cli/config_defaults.py:2006-2016 | 안정(기본 auto) |
| L1d-6 승인·권한 | 정규식 탐지와 하드라인, 기본 모드 smart(보조 LLM 판정, 주입 방어 포함), cron은 deny, 타임아웃 300초 | tools/approval.py:1-12; tools/approval_smart.py:1-8; hermes_cli/config_defaults.py:1694-1696 | 안정 |
| L1d-7 병렬 제외 | clarify, manage_connections, manage_catalog, setup_beat, set_theme는 항상 순차 실행 | agent/tool_dispatch_helpers.py:30 | 안정 |
| L1e-1 프롬프트 계층 | stable, context, volatile 3계층. 세션당 한 번 빌드하고 컴팩션 때만 재빌드 | agent/system_prompt.py:1-9 | 안정 |
| L1e-2 압축 임계 | 에이전트 압축 0.50, 게이트웨이 위생 0.85. protect_last_n 20, protect_first_n 3 | agent/agent_init.py:1471; gateway/run_turn_hygiene.py:97-102; hermes_cli/config_defaults.py:604, 618, 674 | 안정 |
| L1e-3 압축 알고리즘 | 1단계는 200자 넘는 오래된 도구 결과를 LLM 없이 제거. 2단계 경계 결정. 3단계 구조화 요약 | website/docs/developer-guide/context-compression-and-caching.md:548-613 | 안정 |
| L1e-4 컨텍스트 엔진 | ContextEngine ABC(should_compress, compress, on_session_* 등). 플러그인으로 교체 가능, 한 번에 하나 선택 | agent/context_engine.py:48-240; architecture.md:236 | 안정 |
| L1f-1 세션 저장소 | SQLite WAL + FTS5, 소스 태그(cli, telegram 등). 압축은 parent_session_id 체인으로 세션을 쪼갬 | hermes_state.py:1-6 | 안정 |
| L1f-2 쓰기 경합 | BEGIN IMMEDIATE, 지터 재시도(20~150ms), 이후 느린 대기 구간 | hermes_state.py:499, 799-800, 834-857 | 안정 |
| L1f-3 부작용 분류 | 읽기 전용 허용목록(NO_EFFECT_TOOL_NAMES)에 없는 도구는 부작용이 있다고 간주 | agent/tool_result_classification.py:14-20 | 안정 |
| L1f-4 재개 정책 | 재개 시 메시지를 재생하지 않고 정리 후 이어감. unknown 입력은 재실행하지 않음 | agent/replay_cleanup.py; session-storage.md:146-148 | 안정 |
| L1f-5 분기·되감기 | hermes_state_mutation_branch.py, hermes_state_rewind.py 모듈 존재 | 파일 목록 | 미확인(동작 세부 미검토) |
| L1f-6 궤적 | ShareGPT 형식 궤적 생성(학습 데이터 용도) | website/docs/developer-guide/architecture.md:252-256 | 실험 [추측] |
| L1g-1 실행 위치 | 같은 프로세스의 데몬 스레드에서 자식 AIAgent 실행. 부모는 자식의 요약만 받음 | tools/delegate_tool.py:1-12; tools/delegate_tool_child_run.py:845-848 | 안정 |
| L1g-2 차단 도구 | delegate_task, clarify, memory, send_message, cronjob_manage는 자식에 주지 않음 | tools/delegate_tool_toolsets.py:14-22 | 안정 |
| L1g-3 상한 | 자식 반복 250, 동시 자식 10, 깊이 1(플랫), 요약 24,000자 | hermes_cli/config_defaults.py:1376-1396 | 안정 |
| L1g-4 비동기 위임 | delegate_task(background=true)는 데몬 실행기에 넣고 핸들을 즉시 반환. 완료는 공유 completion_queue로 | tools/async_delegation.py:1-6 | 안정 |
| L1g-5 워크트리 격리 | 자식마다 git worktree. 옵트인, 로컬 백엔드에서만 | tools/subagent_worktree.py:1-8 | 실험(옵트인) |
| L1g-6 플러그인용 수명 API | 플러그인이 자식 세션을 띄우고 감독. 부모는 활성 턴에서 해석 | website/docs/developer-guide/subagent-lifecycle-api.md:1-12 | 미확인 |
| L2-1 내장 도구 | 파일(read/write/patch/search), 터미널, 웹 검색·추출, 비전, 이미지 생성, 브라우저, execute_code(PTC), 크론, 칸반 등 | toolsets.py:11-40; tools/code_execution_tool.py:1-8 | 안정 |
| L2-2 MCP 브리지 | stdio·HTTP·SSE 서버를 데몬 스레드의 이벤트 루프에서 상시 구동하고 도구를 레지스트리에 등록. 선택 카탈로그 65개 | tools/mcp_tool.py:1-7; optional-mcps/ | 안정 |
| L2-3 내장 메모리 | MEMORY.md, USER.md. § 구분자, 파일 락, 한도 초과 시 오류 반환(자동 압축 없음) | tools/memory_tool_store.py:25, 186-192, 257-300 | 안정 |
| L2-4 외부 메모리 제공자 | MemoryProvider ABC, 한 번에 하나 선택. initialize → prefetch/sync_turn → shutdown | agent/memory_provider.py:1-12, 111-222 | 안정 |
| L2-5 스킬 | SKILL.md + references/ templates/ scripts/ assets/. 인덱스 설명 60자, 본문은 skill_view로 온디맨드 | tools/skill_manager_tool.py:1-9, 108-113; agent/skill_utils.py:839; tools/skills_tool.py:713-725 | 안정 |
| L2-6 세션 검색 | FTS5 기반 발견·스크롤·읽기 3형태. LLM 호출 없음. 크론·서브에이전트 세션은 숨김 또는 강등 | tools/session_search_tool.py:1-10, 20-30 | 안정 |
| L2-7 크론 | ~/.hermes/cron/jobs.json, 60초 틱, 잡마다 새 AIAgent, 유휴 600초 워치독 | cron/jobs.py:2, 90; website/docs/developer-guide/cron-internals.md:125-146; cron/AGENTS.md | 안정 |
| L2-8 칸반 | 워커와 오케스트레이터용 도구 표면과 디스패처 | tools/kanban_tools.py:1-6 | 실험 [추측] |
| L2-9 자기 개선 루프 | 백그라운드 포크 검토, 카운터 트리거, 메모리·스킬 쓰기, 큐레이터 정리 | 3.10.1절 참조 | 안정(기본 활성, 테스트 다수). 안전장치는 기본 OFF |
| EXT-1 훅 | VALID_HOOKS 46종. 관찰, 차단, 형성, 주입이 한 체계에 섞여 있음 | hermes_cli/plugins.py:107-160 | 안정 |
| EXT-2 미들웨어 | llm_request, tool_request는 인자 치환. llm_execution, tool_execution은 next_call로 감쌈 | website/docs/developer-guide/middleware.md:50-55 | 실험(활성화된 플러그인에서만 동작) |
| EXT-3 ABC와 디렉터리 플러그인 | 메모리, 컨텍스트 엔진(단일 선택), 모델 제공자, 터미널, 브라우저, 이미지·영상·TTS·STT, 웹 검색 | plugins/AGENTS.md:70-80 | 안정 |
| EXT-4 실행 격리 | plugins.isolation: in_process(기본) 또는 host(플러그인 호스트 프로세스) | hermes_cli/plugin_isolation.py:1-10, 28-29 | 실험(옵트인) |

## 3. 층별 상세

### 3.1 F 계약

- 내부 메시지 형식은 OpenAI 호환으로 통일되어 있다. Anthropic과 Responses API 형식은 어댑터에서만 변환한다 [원문: agent-loop.md "Message Format"]. 내부 표현을 하나로 두고 가장자리에서 변환하는 방식이다.
- 도구 계약은 `ToolEntry`(tools/registry.py:216-233)다. 스키마는 JSON Schema 딕셔너리이고, `dynamic_schema_overrides`로 런타임 설정(예: delegate_task 설명의 한도)을 스키마에 반영한다. 도구 가시성은 스키마 자체가 아니라 디스패치 쪽 화이트리스트로 조절한다 (`background_review.py:1088-1131`에서 "광고되는 tools[]는 부모와 바이트 동일, 허용은 디스패치에서만"이라고 명시).
- 세션 계약은 SQLite 스키마 버전 32다. 마이그레이션은 한 번에 큰 쓰기를 하지 않고 청크로 백필한다 [원문: session-storage.md:337].
- 와이어 계약은 Pydantic 모델이 원천이다. `scripts/gen_gateway_contracts.py`가 TS 타입(`apps/shared/src/gateway-contract.generated.ts`)과 OpenRPC JSON을 만들고, 테스트가 메모리에서 재생성한 결과와 커밋본을 비교한다 [원문: tui_gateway/contracts/base.py:1-11]. 모델을 고치고 재생성하지 않으면 Python CI가 깨진다. 이것은 F 계약의 드리프트를 막는 가장 직접적인 장치다.
- 플러그인 호환은 "동작 기반"이다. 전역 PLUGIN_API_VERSION 번호가 없고, 문서화된 동작을 쓰는 플러그인은 정상 업그레이드 후에도 동작해야 한다는 규칙이다 [원문: plugins/index.md:191-200]. 매니페스트 v2는 파일 형식 버전(manifest_version)과 ctx 표면 버전(api_version)을 분리하며, 미지 필드는 무시하고 경고만 낸다 [원문: plugins/index.md:561-584].
- 훅 계약은 kwargs 기반이다. 플러그인은 `**kwargs`를 받아야 하고, 페이로드에 `telemetry_schema_version="hermes.observer.v1"`이 붙는다 [원문: observer-hooks.md Contract]. 행동을 바꾸는 반환값(`pre_tool_call`의 block과 modify, `transform_tool_result`, `transform_llm_output`, `pre_llm_call`의 컨텍스트 주입)은 관찰 훅과 다른 취급을 받는다.
- 설정 계약은 파일로 나뉜다. config.yaml은 행동을, .env는 비밀만 담는다 [원문: AGENTS.md Contribution rubric]. "비밀이 아닌 설정을 HERMES_* 환경변수로 만드는 것"은 거절 대상이다.
- 버전 계약은 커밋 버전을 0.0.0으로 두고, 릴리스 잡이 페이로드 버전을 스탬프한다 [원문: stable-releases.md:6-9]. 코어 의존성은 `==` 정확 고정이며, 이유를 주석으로 적는다. 주석에는 2026-05 mistralai 감염 사고 대응이 적혀 있다 [원문: pyproject.toml:19-34].

### 3.2 L0 플랫폼

- 셸 실행은 `BaseEnvironment`(tools/environments/base.py:256)가 맡는다. 로컬 백엔드는 호출마다 프로세스를 띄우고 세션 스냅샷으로 상태를 잇는다 [원문: tools/environments/local.py:1]. 명령 감싸기와 종료 처리는 base.py:454-600에 있다.
- 백엔드는 `tools/environments/`에 로컬, Docker, SSH, Modal, Managed Modal, Daytona, Singularity, Vercel Sandbox가 있다. 제3자 백엔드는 `TerminalEnvironmentProvider` 플러그인으로 등록한다 (agent/terminal_env_provider.py:20). 문서는 선언 플래그(`skip_container_guards`, `strip_env_keys`, `session_isolated_when_nonpersistent`)를 두면 "백엔드를 분류 지점 하나 빠뜨리는" 버그 부류가 사라진다고 설명한다 [원문: terminal-environment-plugin.md:10-31].
- 경로는 `get_hermes_home()` 한 함수로 얻는다. 프로필마다 HERMES_HOME이 다르고, 하드코딩된 `~/.hermes`는 금지된 규칙이다 [원문: AGENTS.md Rules, HX001].
- 호스트 사실(OS 계열, 아키텍처, WSL과 컨테이너 여부)은 `hermes_platform.host` 한 곳에서만 답한다. 이 값은 환경변수로 바꿀 수 없다 [원문: hermes_platform/AGENTS.md].
- 비밀은 세 층이다. 첫째, 프로필 범위 contextvar 스코프다. `.env` 키를 `os.environ`에 합치면 프로필 A의 키가 프로필 B의 턴과 자식 프로세스로 샌다는 이유다 [원문: agent/secret_scope.py:1-8]. 둘째, passthrough 허용목록이다. 샌드박스 자식에게 넘길 변수를 세션 단위로 명시한다 [원문: tools/env_passthrough.py:1-6]. 셋째, 로컬 Fernet 볼트다. 모델은 불투명 핸들과 메타데이터만 보고 값은 서버 쪽에서 풀어 쓴다 [원문: agent/vault_store.py:1-6].
- 위험 명령 승인은 세 단계다. 정규식 탐지와 하드라인, 보조 LLM 판정(smart, 기본), 사람 응답이다 [원문: tools/approval.py:1-12, config_defaults.py:1694-1696]. smart 판정기는 명령 텍스트를 신뢰하지 않는 입력으로 다룬다. 셸 주석을 지우고 `<command>` 구분자로 감싼다 [원문: tools/approval_smart.py:1-8]. 그러나 판정을 LLM에 맡기므로 지연과 비용, 그리고 판정 모델 자체의 오판 위험이 기본 경로에 들어온다 [추측].
- 백그라운드 프로세스는 프로세스 레지스트리가 관리한다. 출력 버퍼는 200KB 롤링이고 JSON 체크포인트로 크래시 뒤 복구한다 [원문: tools/process_registry.py:1-5].
- 파일 감시, 알림, 클립보드 같은 OS 기능을 맡는 명시적 추상 모듈은 찾지 못했다 [미확인].
- 프로세스 모델은 다음과 같다. CLI는 단일 프로세스다. 게이트웨이는 장기 프로세스 하나로, 어댑터, 인바운드 디스패치, 크론 틱(`InProcessCronScheduler`, gateway/run.py:4576), 하우스키핑(gateway/run.py:4361-4373, 큐레이터 폴링 포함)을 호스트한다. TUI는 Node(Ink)와 Python(`tui_gateway`)이 stdio JSON-RPC로 통신한다 [원문: tui_gateway/AGENTS.md 프로세스 모델]. 데스크톱과 대시보드 채팅은 같은 `tui_gateway` 백엔드를 쓴다 [원문: AGENTS.md 라우팅 표].
- 워커 프로세스 전용 저장 facade(`agent/runtime_session_store.py`)가 있다. 이 facade는 정식 SQLite 저장소를 직접 열지 않으며, "아직 기존 소비자를 전환하지 않았다"고 적혀 있다 [원문: runtime_session_store.py:1-6]. 프로세스 분리가 진행 중이라는 뜻이다 [추측].
- 한 프로세스의 다중 프로필은 가장 무거운 불변식이다. `os.environ`, 모듈 전역, import 시점 값은 실행 프로필의 것을 담고 있으므로, 턴 밖에서 도는 작업(부팅 프로브, 캐시 퇴출, 타이머, 콜백, RPC, 스레드 전환, 자식 생성)은 프로필을 명시적으로 바인딩해야 한다 [원문: AGENTS.md Rules]. 바인딩 누락은 "조용한 기본 프로필 누출"이 된다. 이 규율이 코드 리뷰 ID(HX002 등)로 관리된다.

### 3.3 L1(a) 태스크 엔진

- 엔진은 동기 루프다. 메인 스레드가 API 스레드를 기다리면서 응답 준비, 인터럽트, 타임아웃 세 가지를 본다 [원문: agent-loop.md "Interruptible API Calls"]. 인터럽트가 오면 API 스레드를 버리고, 부분 응답은 대화 기록에 넣지 않는다.
- 도구 병렬 실행은 `ThreadPoolExecutor` 형태이며 최대 8 워커다 (agent/tool_executor.py:133). 결과는 호출 순서대로 다시 넣는다. clarify 같은 대화형 도구와 `_NEVER_PARALLEL_TOOLS`는 순차로 돈다 (agent/tool_dispatch_helpers.py:30).
- 단계 사이 입력은 세 경로다. 첫째, `/steer`는 도구 경계에서 주입된다. 둘째, 최종 응답 뒤에 남은 steer는 다음 사용자 턴이 된다 (agent/turn_finalizer.py:748-752). 셋째, 실행 중 들어온 메시지는 게이트웨이의 2단계 가드가 분류한다. 1단계는 어댑터가 활성 세션을 보고 큐에 넣고 인터럽트를 걸며, 2단계는 러너가 `/stop`, `/new`, `/queue`, `/status`, `/approve`, `/deny`를 가로챈다 [원문: gateway-internals.md:495-503]. 인터럽트 제어 표면은 `agent/interrupt_control.py`에 모여 있다 [원문: 모듈 독스트링].
- 세션 입력은 durable FIFO에 들어간다. 상태는 queued, started, terminal이다. 소유 프로세스가 죽은 started 입력은 unknown으로 바뀌고, 재실행하지 않으며, 같은 세션의 뒤 입력은 해결될 때까지 기다린다 [원문: session-storage.md:138-148]. 부작용이 있는 입력을 두 번 실행하지 않는 장치다.
- 반복 예산은 `IterationBudget`(스레드 안전 카운터)이다. `execute_code`의 내부 반복은 환불한다 (agent/iteration_budget.py:25-40). 기본값은 무제한이다. 실행 생성자 기본은 `sys.maxsize`(run_agent.py:241)이고, 설정 `agent.max_turns`의 기본은 `null`이다(config_defaults.py:78-80). 문서 agent-loop.md의 "기본 500"은 현재 코드와 다르다.
- 포크 취소는 핸드셰이크 객체로 한다. 시작 전 취소하면 provider를 호출하지 않고 끝내며, 실행 중이면 포크 에이전트에 인터럽트를 건다 (agent/background_review.py:28-60, 102-171).

### 3.4 L1(b) 에이전트 루프

- 루프 본체는 `agent/conversation_loop.py`(1,867줄)의 `run_conversation`이다. 턴 단계는 `turn_iteration_prep`(요청 준비, 566줄), `turn_api_call`(288줄), `turn_tool_round`(도구 라운드), `turn_finalizer`(마감, 저장, 검토 스폰), `turn_recovery`와 `turn_overflow`(실패 처리)로 나뉜다. 루트 `run_agent.py`는 공개 파사드다 [원문: agent-loop.md "Key Source Files"].
- 턴 순서는 다음과 같다 [원문: agent-loop.md "Turn Lifecycle"을 파일과 대조]. 세션 ID 생성, 사용자 메시지 추가, 시스템 프롬프트 재사용 또는 빌드, 사전 압축 검사(50%), 메시지 조립과 캐시 마커, 모델 호출, 응답 파싱. 도구 호출이 있으면 실행 후 다시 조립으로 돌아가고, 텍스트만 있으면 저장하고 종료한다.
- 종료 조건은 최종 텍스트, 인터럽트, 예산 소진, 검증 게이트 네 가지다. 예산이 차기 전에 정리 안내가 대화에 주입된다 (conversation_loop.py:124).
- 루프는 플러그인이 구동하지 않는다. 플러그인은 훅과 미들웨어로 가장자리에서 개입한다. 이 설계 선택이 3.12절의 5단계 중 "구동" 단계를 비워 둔 이유다 [추측].
- 메시지 역할 교대 규칙(사용자, 어시스턴트 교대, 도구 결과만 연속 허용)을 루프가 강제한다 [원문: agent-loop.md "Message Alternation Rules"].

### 3.5 L1(c) 모델 게이트웨이

- 인증된 엔드포인트 기준 API 모드는 `runtime_provider.py`가 정한다. `_VALID_API_MODES`는 5종이다 (hermes_cli/runtime_provider.py:135). 특정 호스트는 모드를 고정한다. 예를 들어 api.anthropic.com은 anthropic_messages다 (runtime_provider.py:128-131). 플러그인이 등록한 전송 계층도 허용된다 (agent/transports/__init__.py:44-50 `registered_api_modes`).
- 전송 계층은 `agent/transports/`에 있다. chat_completions, anthropic, bedrock, codex, codex_app_server가 각각 어댑터다. 응답은 `types.py`의 공통 타입으로 정규화하고, 프로토콜 고유 상태는 `provider_data`에 둔다 [원문: agent/transports/types.py 독스트링].
- 제공자 선언은 `ProviderProfile`(providers/base.py)이 한다. 인증, 엔드포인트, 클라이언트 quirks, 요청 시점 quirks를 선언하고, 클라이언트 생성, 자격 회전, 스트리밍은 소유하지 않는다 [원문: providers/base.py:1-8]. 선언과 실행 분리가 명확하다.
- 제공자 추가는 `plugins/model-providers/<name>/`이다. 41개가 있고, 첫 조회 때 지연 탐색하며, 사용자 디렉터리(`$HERMES_HOME/plugins/model-providers/`)의 같은 이름이 번들을 대체한다 [원문: plugins/AGENTS.md:70-80].
- 폴백은 설정 `fallback_providers` 순서로 시도한다. 429, 5xx, 401/403에서 전환하며, 401/403은 자격 갱신을 먼저 시도한다. 보조 작업(비전, 압축, 웹 추출)은 `auxiliary.*` 설정으로 별도 체인을 가진다 [원문: agent-loop.md "Fallback Model"]. `auxiliary.background_review`도 같은 체계를 쓴다 (config_defaults.py:826).
- 프롬프트 캐시는 Anthropic 마커로 한다. 기본 레이아웃은 정적 시스템 접두부 등 브레이크포인트 4개이고, TTL은 5분 또는 1시간이다 [원문: agent/prompt_caching.py:3-5].

### 3.6 L1(d) 도구 디스패치와 권한

- 등록은 import 시점 부작용이다. 각 `tools/*.py`가 최상위에서 `registry.register()`를 호출하면 발견된다. 발견기는 실제 import 전에 AST로 "최상위 register 호출이 있는 모듈"만 고른다 (tools/registry.py:84-177). `model_tools.py`는 레지스트리를 조회하고 디스패치(`handle_function_call`, model_tools.py:873)를 맡는다.
- 가용성은 `check_fn`이 정한다. 예를 들어 옵트인 여부와 도달성이다. 결과는 세션 스코프로 캐시한다 (tools/registry.py:276-440). 문서는 check_fn을 "세션별 표면"이 아니라 "도달성 판정"에만 쓰라고 권고한다 [원문: AGENTS.md 발자국 사다리].
- 툴셋은 `toolsets.py`가 정한다. `_HERMES_CORE_TOOLS`는 코어 목록이고, `TOOLSETS`는 59개 키를 가진다 (조사자 측정). 플랫폼별 프리셋과 코딩 자세(coding posture) 같은 파생 목록이 있다.
- 에이전트 레벨 인터셉트가 중요하다. 여러 도구는 레지스트리를 거치지 않고 `inline_tool_executors`가 에이전트 상태를 직접 쓴다. 목록은 `todo_list`, `message_agent`, `session_search`, `memory`, `clarify`, `read_terminal`, `desktop_preview`, `drive_preview`, `annotate_preview`, `read_window_below`, `gui_tour`, `set_theme`, `setup_beat`, `manage_connections`, `manage_catalog`, `setup_mcp`, `delegate_task`이다 (inline_tool_executors.py:253-311). 문서가 든 목록(todo, memory, session_search, delegate_task)보다 많다.
- 도구 지연 노출은 MCP와 플러그인 도구에 적용한다. 모델에는 브리지 세 개(tool_search, tool_describe, tool_call)만 보이고, 티어는 0(전부 즉시), 1(이름과 설명 목록), 2(서버 요약만)로 예산에 따라 나뉜다 (tools/tool_search.py:1-8; config_defaults.py:2006-2016). 기본값 `auto`는 지연 가능한 도구가 하나라도 있으면 켠다.
- 승인과 권한은 3.2절에서 설명했다. 권한 면에서 한 가지 더 있다. 백그라운드 검토 포크의 도구 허용은 디스패치 쪽에서 화이트리스트로 정한다 (3.10.1절).
- 병렬에서 빠지는 도구는 clarify, manage_connections, manage_catalog, setup_beat, set_theme 다섯 개다 (agent/tool_dispatch_helpers.py:30).

### 3.7 L1(e) 컨텍스트 조립과 컴팩션

- 시스템 프롬프트는 세 계층을 `\n\n`으로 잇는다. stable(정체성, 지침, 환경 힌트, 플랫폼 힌트), context(작업 공간 스냅샷, 호출자 system_message, 컨텍스트 파일), volatile(스킬 인덱스, 메모리, USER.md, 외부 메모리 제공자, 시각 줄) [원문: agent/system_prompt.py:1-9]. 세션당 한 번 빌드하고, 컴팩션 때만 다시 빌드한다. 이는 프롬프트 캐시를 지키기 위한 불변식이다 [원문: AGENTS.md "Per-conversation prompt caching is sacred"].
- 컴팩션 임계는 에이전트 0.50이다(agent/agent_init.py:1471, 설정 기본 config_defaults.py:604). 게이트웨이 위생 검사는 0.85로 더 높게 둔다. 안전망 역할이다 (gateway/run_turn_hygiene.py:97-102). 보호 구간은 앞 3개와 뒤 20개 메시지다 (config_defaults.py:618, 674).
- 알고리즘은 세 단계다 [원문: context-compression-and-caching.md:548-613]. 1단계는 보호 구간 밖의 200자 넘는 도구 결과를 "[Old tool output cleared to save context space]"로 바꾼다(LLM 호출 없음). 2단계는 경계를 정한다. 3단계는 구조화 요약을 만든다. 요약은 목표, 제약, 진행 상황 같은 고정 섹션을 가진다. 메모리는 컴팩션 전에 먼저 디스크에 쓴다 [원문: agent-loop.md "Compression and Persistence"].
- 컨텍스트 엔진은 ABC다(agent/context_engine.py:48-240). `should_compress`, `compress`, `on_session_start/end/reset`, `update_from_response` 등이 추상 또는 기본 구현으로 있다. 플러그인으로 교체하면 압축 정책 전체를 바꿀 수 있지만, 한 번에 하나만 활성이다 [원문: architecture.md:236].
- 압축은 세션을 쪼갠다. 압축된 세션은 `parent_session_id`로 이어지는 자식 세션이 된다 [원문: hermes_state.py:1-6]. 세션 검색은 이 체인을 따라 같은 계보를 묶는다.

### 3.8 L1(f) 세션 영속성

- 저장소는 SQLite이고 WAL 모드다. 소스 태그는 `cli`, `telegram` 등이다 [원문: hermes_state.py:1-6]. 세션 메타, 메시지, 모델 설정, FTS5 인덱스가 한 파일(`~/.hermes/state.db`)에 있다 [원문: memory.md 사용자 문서].
- 쓰기 경합은 `BEGIN IMMEDIATE`와 지터 재시도로 처리한다. 처음 20~150ms 사이 지터로 재시도하고, 오래 막히면 느린 대기 구간으로 넘어간다 (hermes_state.py:499, 799-800, 834-857). SQLite 기본 busy 핸들러에 기대지 않는다고 주석에 적혀 있다.
- 부작용 도구 분류는 허용목록이다. `read_file`, `search_files`, `session_search`, `skill_view`, `skills_list`, `web_extract`, `web_search`, `vision_analyze`, `browser_snapshot` 등 읽기 전용 도구만 "버려도 안전"으로 본다. 목록에 없는 도구(플러그인, MCP 포함)는 부작용이 있다고 간주한다 (agent/tool_result_classification.py:14-20). 기본값이 안전 쪽이다.
- 재개는 메시지를 재생하지 않는다. 중단된 assistant(tool_calls)와 dangling 꼬리를 정리한 뒤 이어간다. 정리 시 부작용 도구는 "결과 불명" 안내를, 읽기 전용 도구는 재시도 안내를 붙인다 (agent/replay_cleanup.py:1-6, 23, 75).
- 대화 기록 정합성은 `transcript_repair.py`가 맡는다. 배치 append의 메모리 행과 커밋된 행을 맞춘다 (agent/transcript_repair.py:1-5).
- 분기와 되감기 모듈(`hermes_state_mutation_branch.py`, `hermes_state_rewind.py`)이 있으나 동작은 확인하지 못했다 [미확인].
- 궤적(trajectory)은 ShareGPT 형식으로 저장할 수 있다. 학습 데이터 목적이며 기본 경로가 아니다 [원문: architecture.md:252-256].

### 3.9 L1(g) 서브에이전트

- 자식은 같은 프로세스의 `DaemonThreadPoolExecutor`에서 돈다 (tools/delegate_tool_child_run.py:845-848). 자식은 새 대화를 시작하고 자기 task_id(터미널 세션, 파일 캐시)를 가진다. 부모는 자식의 중간 도구 호출과 추론을 보지 못하고 요약만 받는다 [원문: tools/delegate_tool.py:1-12].
- 기본 툴셋은 terminal, file, web이다 (tools/delegate_tool_toolsets.py:23). 자식에게 주지 않는 도구는 delegate_task(재귀 금지), clarify(사용자 상호작용 금지), memory(공유 MEMORY.md 쓰기 금지), send_message(플랫폼 부작용 금지), cronjob_manage(부모 이름으로 스케줄 금지)다 (tools/delegate_tool_toolsets.py:14-22). 이 다섯 제한은 설계 의도가 명확하다.
- 상한은 설정으로 둔다. 자식 반복 250, 배치 동시 자식 10, 깊이 1(플랫), 요약 24,000자, 자식 무진행 타임아웃 기본 0(무제한)이다 (config_defaults.py:1376-1396). 깊이 2 이상은 오케스트레이터 역할을 허용해야 가능하다.
- 비동기 위임(`background=true`)은 모듈 수준 데몬 실행기로 보낸다. 완료 이벤트는 공유 `completion_queue`에 들어가고, CLI와 게이트웨이가 비운다 (tools/async_delegation.py:1-6).
- 워크트리 격리는 옵트인이다. 자식마다 `.worktrees/subagent-<id>`를 만들고, 작업이 남으면 참조로 보관한 뒤 제거한다. 로컬 백엔드에서만 동작한다 (tools/subagent_worktree.py:1-8).
- 검토 포크는 서브에이전트가 아니다. 자식(`_delegate_depth > 0`)에서는 검토를 스폰하지 않는다 (run_agent.py:764-765). 포크는 자기 검토도 하지 않도록 넛지 카운터를 0으로 둔다 (agent/background_review.py:995).

### 3.10 L2 능력

#### 3.10.1 자기 개선 루프 (상세)

이 절이 조사의 핵심이다. 세션이 쌓이면서 스킬과 메모리가 늘어나는 과정을 턴 단위로 따라간다.

**(가) 턴마다 일어나는 일**

1. 턴 시작 시 메모리 넛지 카운터를 1 올린다. 10에 이르면 이번 턴 검토 플래그를 세우고 카운터를 0으로 되돌린다. 조건은 `memory` 도구가 활성이고 메모리 스토어가 있을 때다 (agent/turn_context.py:758-767, 1132).
2. 도구 반복이 한 번 돌 때마다 스킬 넛지 카운터를 1 올린다. `skill_manage` 도구가 활성일 때만 센다 (agent/turn_iteration_prep.py:166-167).
3. 에이전트가 `skill_manage`를 호출하면 스킬 카운터를 0으로 되돌린다 (agent/tool_executor.py:744-747). 방금 스킬을 손댔다면 검토가 필요 없다는 뜻이다.
4. 턴 마감 때 스킬 카운터가 10 이상이면 스킬 검토 플래그를 세우고 카운터를 0으로 되돌린다 (agent/turn_finalizer.py:763-771).
5. 최종 응답이 있고, 중단되지 않았고, `skip_background_review`가 아니며(크론 등), 두 플래그 중 하나 이상 참이면 검토를 스폰한다 (agent/turn_finalizer.py:782-791). 크론에서는 끈다. 주석은 포크 한 번에 약 3만 토큰이 드는데 사람이 볼 이득이 없다고 적는다 (turn_finalizer.py:780).
6. 스폰 진입점(`run_agent.py:757-766`)은 설정 `auxiliary.background_review.enabled`를 읽는다. 기본은 켜짐이며 읽기 실패 시에도 켜짐이다(fail-open) (config_defaults.py:826, background_review.py:228-251). 메시지 스냅샷은 구조적으로 복제한다. 포크가 원본 기록을 건드리지 못하게 하기 위해서다 (turn_finalizer.py:96). 관리형 로컬 llama 서버를 쓰면 검토를 유휴 시점까지 큐에 넣는다 (agent/review_idle_queue.py:1-12).

**(나) 포크 실행**

7. 데몬 스레드에서 `_run_review_in_thread`가 `_run_review_fork`를 호출한다 (background_review.py:1147, 1219).
8. 포크는 `build_cache_parity_fork`로 만든다. 부모와 같은 런타임과 자격증명을 쓴다. 같은 모델이면 시스템 프롬프트, tools[], 추론 설정이 바이트 단위로 같고 session_id도 공유하므로 접두부 캐시가 따뜻하다. 영속성은 분리한다. state.db에 쓰지 않고, 외부 메모리 제공자도 붙이지 않는다 (background_review.py:965-975). 다른 모델로 라우팅되면 캐시가 식으므로 최근 24개 메시지 다이제스트만 재생한다 (background_review.py:332, 1147-1160).
9. 도구 화이트리스트는 디스패치 쪽에서만 건다. 광고 스키마는 부모와 같게 둬서 캐시를 지킨다 (background_review.py:1088-1131). 허용은 스킬 툴셋이고, 메모리 툴셋은 메모리 활성이면서 메모리 넛지가 발동한 경우에만 더한다 (`background_review.py:1098`). 읽기 도구 `read_file`과 `search_files`는 허용한다. 쓰기 도구(`write_file`, `patch`, 터미널)는 거부하고, 거부 메시지가 `skill_manage`로 돌아가라고 안내한다. 거부가 반복되면 루프가 굶는다는 사고 기록이 주석에 있다.
10. 포크는 최대 16회 반복한다 (background_review.py:173). 입력 토큰 합계에 예산을 두는데, 기본은 컨텍스트 창의 75%이고 상한은 600k, 창 크기를 모르면 120k다 (background_review.py:180-182).
11. 결과 요약 한 줄을 CLI 또는 콜백에 보여준다 (background_review.py:1211-1217). 포크의 토큰 사용량은 부모 세션에 귀속한다. 포크가 자기 검토를 스폰하지 않도록 넛지는 0이다.

**(다) 리뷰 프롬프트가 요구하는 것**

- 메모리 검토 프롬프트는 저장소 두 개 중 하나만 고르라고 한다. USER.md는 사람에 관한 것(페르소나, 선호, 작업 방식), MEMORY.md는 환경 사실(도구 특이점, 프로젝트 규약, 경로)이다. 한 사실을 두 곳에 쓰면 둘 다 한도에 빨리 찬다는 이유다 (background_review.py:370-391).
- 스킬 검토 프롬프트는 "Be ACTIVE — most sessions produce at least one skill update"라고 시작한다. 대부분의 세션이 한 번은 갱신해야 한다는 편향을 명시한다. 그러나 "Nothing to save"가 기본값이 되지 않도록 하는 문구도 함께 있다 (background_review.py:448-520).
- 신호는 네 가지다. 사용자의 스타일과 형식 교정, 워크플로 교정, 재사용 가능한 기법이나 디버깅 경로의 등장, 이번 세션에 로드했던 스킬이 틀렸거나 빠졌을 때다. 사용자의 좌절 표현을 "1급 신호"로 취급하는 점이 특징이다.
- 선호 순서는 (1) 이번 세션에 로드된 스킬을 패치, (2) 기존 우산 스킬을 패치, (3) 지원 파일(references, templates, scripts) 추가, (4) 클래스 수준 새 우산 스킬 생성이다 (background_review.py:448 이후 본문). 세션 한정 이름(PR 번호, 에러 문자열, 오늘 작업 이름)은 금지다.
- 저작 규칙(`_LESSON_LAYER_BLOCK`, background_review.py:393-421)은 절차가 먼저, 함정은 "일반화된 규칙 + 이유 한 절", PR 번호와 날짜와 인용 금지, 같은 교훈은 한 번만, AGENTS.md와 도구 스키마와 중복 금지, 상시 규칙은 SKILL.md 본문에, references는 주제별 파일로다.
- 저장 금지(`_DO_NOT_CAPTURE_BLOCK`, background_review.py:423-446)는 다섯 가지다. 환경 의존 실패(설치 안 됨, 경로 불일치, 자격증명 미설정), 도구나 기능에 대한 부정 주장("X는 동작 안 함"), 세션 중 해결된 일시 오류, 일회성 작업 서술, 실패로 끝난 시도를 "권장 절차"로 굳히는 것이다.
- 읽기 선행은 프롬프트 지시와 가드 둘 다로 강제한다. 기존 스킬을 패치하기 전에 `skill_view`로 같은 검토 안에서 다시 읽어야 한다. 그렇지 않으면 `skill_manage`가 거부한다 (tools/skill_manager_guards.py:211-221).
- 검토는 삭제를 하지 않는다. 중복이 보이면 응답에 적고 큐레이터에 넘긴다 (background_review.py:448-520 본문).

**(라) 저장 위치와 다시 불러오기**

| 대상 | 저장 트리거 | 저장 위치와 형식 | 쓰는 경로 | 다시 불러오기 | 반영 시점 |
|---|---|---|---|---|---|
| 사용자 프로필 (USER.md) | 메모리 넛지(10 사용자 턴) 또는 전경 memory 호출 | ~/.hermes/memories/USER.md, 1,375자 한도, § 구분 | memory 도구. 포크는 add만 자동 적용 | 세션 시작 때 고정 스냅샷을 시스템 프롬프트 volatile 계층에 주입 (memory_tool_store.py:177, 221-253, 619-621) | 다음 세션 |
| 환경 사실 (MEMORY.md) | 같음 | ~/.hermes/memories/MEMORY.md, 2,200자 한도 | 같음 | 같음 | 다음 세션 |
| 절차·교정·함정 (스킬) | 스킬 넛지(도구 반복 10회, skill_manage 미사용) 또는 메모리 넛지와 동시 | ~/.hermes/skills/<카테고리>/<이름>/SKILL.md와 references, templates, scripts, assets | skill_manage(create, edit, patch, write_file, remove_file). 포크는 읽기 선행 강제 | 인덱스(이름과 60자 설명)는 volatile 계층, 본문은 skill_view 온디맨드 (prompt_builder.py:1245-1260, tools/skills_tool.py:713-725) | 인덱스 변경은 다음 턴 시작 때 델타 노트로 알림 (agent/skills_index_delta.py:1-14) |
| 사용자가 명시한 학습 (/learn) | 사용자 명령 | 같은 스킬 트리 | 전경 에이전트가 learn 프롬프트 지시 아래 skill_manage 사용 (agent/learn_prompt.py:136-197) | 같음 | 즉시 |
| 과거 대화 사실 | 저장 행위 없음. 모든 세션이 state.db에 자동 기록 | ~/.hermes/state.db, FTS5 | session_search(읽기 전용, 발견·스크롤·읽기) | 질의 때 DB 메시지 원문 반환, LLM 요약 없음 (tools/session_search_tool.py:1-10) | 즉시 |
| 큐레이션 상태 | 주기 7일과 유휴 2시간 조건 | skills/.usage.json, .curator_state, .archive/, .curator_backups/ | 큐레이터(결정적 전이, 선택적 LLM 통합) | 아카이브된 스킬은 curator restore로 복구 | 주기 실행 |

- 메모리는 "스냅샷"이다. 세션 중 쓴 메모리는 현재 세션 프롬프트에 나타나지 않는다. 캐시 보존을 위해서다. 사용자 문서도 같은 점을 적는다 [원문: memory.md "How It Works"].
- 메모리 파일 형식은 § 구분자(`\n§\n`)로 항목을 나눈다 (memory_tool_store.py:25). 한도 초과 쓰기는 거절하고 현재 항목을 보여준다. 에이전트가 한 배치 호출로 제거와 추가를 같이 하도록 스키마가 강제한다 (memory_tool.py:373-400). 자동 압축이나 조용한 삭제는 없다.
- 메모리 쓰기는 파일 락(fcntl 또는 msvcrt)으로 직렬화한다 (memory_tool_store.py:257-300). 사람이 파일을 외부에서 고쳐 § 구조가 깨졌으면(드리프트) 스냅샷을 `.bak.<시각>`으로 남기고 쓰기를 거절한다 (memory_tool_store.py:49-57, 695).
- 메모리 쓰기는 위협 패턴 검사를 항상 한다. 주입과 유출 패턴을 "strict" 범위로 막는다. 메모리는 시스템 프롬프트에 들어가 세션을 넘어 지속되므로 오염된 항목이 계속 남기 때문이다 (memory_tool_store.py:28-31, 374, 402).
- 스킬 쓰기 검증은 구조 중심이다. 이름 64자, 설명 1,024자, 본문 100,000자, 지원 파일 1 MiB, 하위 디렉터리 허용목록(`references`, `templates`, `scripts`, `assets`)을 본다 (tools/skill_manager_tool.py:108-113). 스킬별 락을 쓴다 (84-106). 쓰기 뒤에는 원장 기록, 프롬프트 캐시 무효화, 사용 텔레메트리를 한다 (731-767).
- 스킬 보안 스캔은 옵트인이다. `skills.guard_agent_created`가 기본 false라서 `_security_scan_skill`은 바로 통과한다 (tools/skill_manager_tool.py:41-66, config_defaults.py:1488). 쓰기 뒤 스캔도 `skills_guard`를 거친다. 기본 경로에서 에이전트 작성 스킬은 위협 패턴 검사를 받지 않는다.
- 쓰기 승인 게이트는 기본 OFF다 (config_defaults.py:1333 메모리, 1497 스킬). 켜면 전경 메모리는 인라인 확인을, 스킬과 백그라운드 쓰기는 스테이징을 한다 (tools/write_approval.py:201-213).
- 백그라운드 포크의 메모리 파괴적 연산(patch, remove, 배치 안의 같은 연산)은 설정과 무관하게 승인 큐로 보낸다 (tools/memory_tool.py:179-206, 호출 263, 285). 포크가 확인받지 않고 기존 항목을 지우지 못하게 하는 장치다. 추가(add)는 그대로 허용된다.
- 원장은 `~/.hermes/skills/.curator_ledger.jsonl`이다. 모든 스킬 변경을 행위자와 무관하게 JSONL로 남기고, 전후 파일 목록은 내용 주소(sha256) blob에 둔다. 롤백은 안전 캡처가 실패하면 닫힌 상태로 실패한다 (tools/skill_ledger.py:1-10).

**(마) 정리와 통제**

- 큐레이터는 유휴 기반이다. 간격 7일(`interval_hours`)과 유휴 2시간(`min_idle_hours`)이 모두 충족돼야 돈다 (agent/curator.py:160-182, config_defaults.py:1513-1518). 처음 관측하면 `last_run_at`만 기록하고 한 간격 뒤에 첫 실행하므로, 새 설치가 첫 틱에 라이브러리를 바꾸지 않는다 (curator.py:160-182 독스트링). 호출 지점은 게이트웨이 하우스키핑(gateway/run.py:4371-4373), CLI 시작(cli_tui_runtime_mixin.py:416), 웹 서버 유지보수(web_server_sessions.py:510-515)다. 클레임 파일로 동시 실행을 막는다 (curator.py:1162-1211).
- 결정적 단계는 항상 돈다. 14일 미사용이면 stale, 30일 미사용이면 `.archive/`로 옮긴다. 고정된 스킬, 크론 잡이 참조하는 스킬은 제외한다. 사용 0회인 스킬은 최소 14일 유예를 둔다 (curator.py:209-263; user doc curator.md).
- LLM 단계는 옵트인이다 (curator.py:35, config_defaults.py:1521 `consolidate: False`). 켜면 `CURATOR_REVIEW_PROMPT`(curator.py:290)로 "우산 스킬 구축" 포크를 돌린다 (curator.py:1085-1160). 포크는 넛지 0으로 재귀를 막는다 (curator.py:1122-1123). 이 단계는 스킬 본문을 바꾸므로 실행 전에 tar.gz 스냅샷을 남긴다 (agent/curator_backup.py:1-6, config_defaults.py:1530-1536).
- 대상 제한이 핵심이다. 큐레이터는 `created_by: agent` 표시가 붙은 스킬만 건드린다. 이 표시는 백그라운드 검토가 만든 스킬에만 붙는다 (tools/skill_manager_tool.py:731-767). 표시는 출처 증명이 아니라 관리 옵트인 플래그이며, `curator adopt`로 뒤집을 수 있다 (tools/skill_usage.py:291-297). 사용자가 전경에서 만든 스킬은 큐레이터 대상이 아니다. 번들과 허브 설치 스킬도 대상이 아니며, `prune_builtins`를 켜면 번들 스킬도 대상이 된다 (옵트인, config_defaults.py:1526).
- 삭제 정책은 경로마다 다르다. 백그라운드 검토와 큐레이터는 아카이브만 한다 (tools/skill_manager_tool.py:585-593). 그러나 전경 `skill_manage(action="delete")`는 `shutil.rmtree`로 영구 삭제한다 (tools/skill_manager_tool.py:594). 큐레이터 문서의 "never delete"는 자율 경로에만 해당한다 [원문: skills/AGENTS.md 큐레이터 절].
- 사용자 통제 수단은 다음과 같다. `hermes curator status|run|pause|resume|pin|unpin|archive|restore|prune|backup|rollback` (skills/AGENTS.md). `hermes journey`와 `/journey`는 학습 항목을 시간순 그래프로 보여준다. 항목을 편집하거나 지울 수 있다. 스킬 삭제는 아카이브, 메모리 삭제는 파일 재작성이다 (agent/learning_mutations.py:1-12; hermes_cli/journey.py).
- `/review`는 자율 넛지와 별도다. 독립적인 전권 백그라운드 서브에이전트를 띄워 최근 대화를 검토하고, 결과를 비동기 위임 완료로 세션에 되돌린다 (agent/review_engine.py:1-12).

**(바) 위험과 공백**

- 기본 설정에서 승인 없이 디스크를 바꾼다. 스킬 쓰기 승인과 에이전트 스킬 스캔이 기본 OFF다 (3.10.1 (라) 참조). 큐레이터 아카이브는 되돌릴 수 있지만, 전경 삭제와 스킬 본문의 내용 오염은 되돌리기 전에 실행된다.
- 대화 내용이 영속 지침이 된다. 도구 결과나 웹 페이지에 든 지시문이 교훈이라는 이름으로 스킬 본문에 들어갈 수 있다. 메모리는 위협 패턴 검사를 받지만 스킬은 기본적으로 받지 않는다. 스킬 본문은 나중에 `skill_view`로 컨텍스트에 들어온다. 소스 독스트링은 "source text is DATA"라는 방어를 `/learn`에만 적어 두었다 (agent/learn_prompt.py:123-133). 검토 포크에는 같은 방어가 보이지 않는다 [미확인: 검토 프롬프트 전체를 확인하지는 않았다].
- 학습 품질을 재는 장치는 보이지 않는다. 테스트는 메커니즘을 확인한다(`tests/agent/test_background_review_*.py`, `test_curator_*.py`, `tests/tools/test_skill_manager_tool.py`). 스킬이 실제로 나아졌는지 재는 평가는 `evals/` 항목 목록에 없었다 [목록 기준 관찰].
- 누적 비용에 대한 측정 근거가 없다. 검토 한 번에 약 3만 토큰이고(turn_finalizer.py:780), 큐레이터 LLM 통합은 기본 꺼져 있다. 그래서 스킬 수가 통합 없이 늘 수 있다 [추측].
- 다만 "스킬 인덱스 60자"와 "우산 스킬 우선" 규칙은 인덱스 비대화를 막는 장치다. 큐레이터 프롬프트는 설명을 57자로 잘린다고 적지만(curator.py 프롬프트 본문), 코드 상수는 60이다(agent/skill_utils.py:839). 말줄임 3자를 뺀 것으로 보인다 [추측].

#### 3.10.2 세션 검색

- 발견(query), 스크롤(session_id와 around_message_id), 읽기(session_id), 목록(인수 없음) 네 형태다. 모두 DB 메시지를 그대로 돌려주며 LLM을 부르지 않는다 (tools/session_search_tool.py:1-10).
- 크론, 서브에이전트, 칸반, 도구 세션은 기본 검색에서 숨기고, 크론 어휘는 BM25 점수에서 강등한다. 크론 잡의 반복 단어가 사용자 대화를 밀어내는 "회상 맹점"을 막기 위해서다 (session_search_tool.py:20-30).

#### 3.10.3 MCP와 도구 지연 노출

- MCP 클라이언트는 stdio, Streamable HTTP, SSE를 지원한다. 설정 `mcp_servers`를 읽고, 데몬 스레드의 이벤트 루프 하나에서 서버를 상시 구동하며, 도구를 레지스트리에 등록한다. `mcp` 패키지는 선택 의존성이며, 없으면 아무 일도 하지 않는다 (tools/mcp_tool.py:1-7).
- 선택 MCP 카탈로그 `optional-mcps/`는 서버마다 `manifest.yaml`을 둔다. 65개가 있다 [조사자 측정].
- 지연 노출은 3.6절에서 설명했다.

#### 3.10.4 크론과 칸반

- 크론 잡은 `~/.hermes/cron/jobs.json`에 저장하고, 원자적 쓰기와 프로세스 간 잠금을 쓴다 (cron/jobs.py:2, 19-20, 90). 틱은 60초 간격으로 돌고, 잡마다 새 AIAgent를 만든다 (cron-internals.md:125-146). 잡은 스킬을 붙일 수 있고 스크립트 출력을 프롬프트에 넣을 수 있다.
- 크론 세션은 유휴 600초 워치독으로 감시한다. 진행 중인 세션은 자르지 않고, 멈춘 세션만 강제 중단한다 [원문: cron/AGENTS.md "Inactivity watchdog"].
- 외부 크론 제공자(예: 관리형 Chronos)를 끼울 수 있다. `cron/scheduler_provider.py`가 기회 놓친 잡을 되살린다 (gateway/run.py:4361-4368).
- 칸반은 워커와 오케스트레이터용 도구 표면이다. 도구는 `HERMES_KANBAN_TASK`가 있거나 `kanban` 툴셋이 켜졌을 때만 등록된다 (tools/kanban_tools.py:1-6).

### 3.11 게이트웨이와 상주 구조

- 게이트웨이는 `gateway/run.py`(파사드) 아래 `run_*.py` 단계 모듈과 `session*.py`로 나뉜다. 어댑터는 `gateway/platforms/base.py`의 `BasePlatformAdapter`를 상속한다 (gateway/platforms/base.py:1856).
- 메신저 플랫폼 어댑터 대부분은 `plugins/platforms/`(27개)에 플러그인으로 들어 있다. 코어 수신 어댑터는 `api_server`, `webhook`, `msgraph_webhook` 셋이다 [원문: architecture.md 디렉터리 구조].
- 인가는 다섯 단계다. 플랫폼 전체 허용 플래그, 플랫폼 허용목록, DM 페어링 코드, 전역 허용 플래그, 기본 거절 순이다 [원문: gateway-internals.md "Authorization"]. 페어링 상태는 `gateway/pairing.py`에 저장한다.
- 세션 키는 `agent:{namespace}:{platform}:{chat_type}:{chat_id}`다. 네임스페이스는 기본 프로필이면 `main`, 멀티플렉싱이면 프로필 이름이다. 세션 키는 `build_session_key()`로만 만든다 [원문: gateway-internals.md "Session Key Format"].
- 훅 이벤트는 `pre_gateway_dispatch`(skip 또는 rewrite 반환), `post_gateway_admission`, `agent_loop_stopped`가 있다 (hermes_cli/plugins.py:107-160).

### 3.12 확장 지점 (5단계 분류)

| 강제 수준 | Hermes 대응 | 근거 | 격리와 실패 처리 |
|---|---|---|---|
| 1 관찰 | on_session_start와 end, pre_api_request와 post_api_request, post_tool_call, on_stream_*, subagent_start와 stop, pre_approval_request 등 | observer-hooks.md (Event Families); hermes_cli/plugins.py:107-160 | 콜백 예외는 경고 로그만 남기고 루프는 계속 (fail-open) [원문: observer-hooks.md Contract] |
| 2 차단 | pre_tool_call이 {"action":"block"} 반환, pre_gateway_dispatch가 {"action":"skip"} 반환. 승인 veto는 pre_tool_call로 함 | observer-hooks.md (behavior table); hermes_cli/plugins.py:107-160 | 핫패스 훅과 pre_tool_call은 기본 30초 타임아웃으로 묶는다. 시간 초과된 pre_tool_call은 차단, 나머지는 건너뛰기(fail-open) (plugins.py:1875-1880) |
| 3 형성 | pre_llm_call이 컨텍스트 주입, pre_tool_call이 args 교체, transform_tool_result, transform_llm_output. 미들웨어 llm_request와 tool_request가 인자 치환 | observer-hooks.md; middleware.md:50-55 | 여러 플러그인이 같은 transform을 하면 "첫 번째 non-None"이 이긴다 (hermes_cli/plugins.py 주석) |
| 4 주입 | pre_verify가 "계속" 메시지를 반환해 루프를 다시 돌림(상한 max_verify_nudges). 사용자 측 /steer와 /queue는 플러그인이 아니라 게이트웨이 경로 | hermes_cli/plugins.py:107-160; agent/interrupt_control.py | 상한으로 무한 루프를 막음 |
| 5 구동 | 루프 전체를 플러그인이 함수처럼 호출하는 경로는 확인하지 못했다. 미들웨어 execution 종류는 next_call로 한 호출만 감쌈. 서브에이전트 수명 API는 플러그인이 자식 세션을 띄움 | middleware.md:54-55; subagent-lifecycle-api.md | 미확인 |

추가 확인 사항은 다음과 같다. 플러그인 켜기와 끄기는 CLI(`hermes plugins enable|disable`)로 하고, 런타임 실시간 활성화 모듈(`plugins_activation_live.py`)이 있다. 적용 시점 규칙의 세부는 확인하지 않았다. 충돌은 레지스트리 순서로 해결한다. 일반 플러그인은 나중 등록이 이긴다(plugins/AGENTS.md:70-74). 메모리 제공자와 컨텍스트 엔진은 한 개만 고른다. 훅 실패는 fail-open이 기본이며, 격리는 `plugins.isolation: host`로 플러그인을 별도 프로세스에 넣는 옵트인 경로다 (hermes_cli/plugin_isolation.py:1-10). 번들 플러그인은 기본적으로 in_process다.

## 4. 채택 판단

### 4.1 그대로 가져다 쓸 수 있는 것 (조건부)

- 라이선스: MIT이므로 코드와 설계를 차용하는 데 법적 장벽이 낮다. 저작권 고지는 유지해야 한다 [원문: LICENSE].
- 의존성 정책: 코어 정확 고정, extras 분리, 잠금 파일 커밋, 공급망 사고를 주석에 남기는 운영 방식은 코드가 아니라 정책이라 그대로 옮길 수 있다 [원문: pyproject.toml:19-34].
- F 계약 패턴: Pydantic 원천에서 TS 타입과 OpenRPC를 만들고 CI가 생성 결과를 diff하는 장치(`tui_gateway/contracts/`, `scripts/gen_gateway_contracts.py`). Python 원천을 쓰는 스택이라면 가장 직접 옮길 만하다.
- 스킬 변경 원장(`tools/skill_ledger.py`): JSONL과 내용 주소 blob과 닫힌 롤백은 독립성이 높다. 의존성(hermes_constants 등)을 떼는 작업이 필요하다 [추측].
- 메모리 파일 스토어(`tools/memory_tool_store.py`): § 구분 항목, 파일 락, 드리프트 감지와 .bak 스냅샷, 한도 기반 거절은 독립성이 비교적 높다. Windows msvcrt 분기가 있다는 점만 감안한다.
- 레지스트리(`tools/registry.py`): AST로 자동 발견하고 check_fn을 세션 스코프로 캐시하는 방식은 패턴으로 옮길 만하다. 의존은 `hermes_constants` 정도다.
- 세션 저장소의 경합 처리(`hermes_state.py`의 BEGIN IMMEDIATE와 지터 재시도)는 설계 참고 가치가 높다. 다만 `hermes_state_*.py` 파일이 수십 개로 흩어져 있어 통째로 떼기 어렵다.

### 4.2 설계만 참고할 것 (이유 포함)

- 자기 개선 루프 전체(카운터 트리거, 캐시 패리티 포크, 디스패치 화이트리스트, 읽기 선행 가드, 델타 노트, 아카이브 전용 큐레이터). 이유: 구현이 `AIAgent` 내부 필드, `skill_usage`, `write_approval`, 프롬프트 계층 등 Hermes 내부 API에 깊게 결합되어 있다. 개념을 우리 런타임 위에 다시 구현해야 한다.
- 프롬프트 계층과 "세션 중 프롬프트 불변" 불변식, 그리고 스킬 변경을 델타 노트로 전달하는 방식. 이유: 캐시 비용을 지키는 가장 실용적인 해법이다.
- 훅의 구분(관찰, 차단, 형성, 주입)과 fail-open 기본값, 관찰 페이로드의 스키마 버전 필드. 이유: 확장 지점을 강제 수준별로 나누는 사고방식이 명확하다.
- 세션 입력 큐의 unknown 상태와 부작용 도구 허용목록(NO_EFFECT). 이유: 부작용 재실행 사고를 막는 구체적 규칙이다.
- 모델에게 보이지 않는 볼트(핸들만 노출)와 프로필 범위 비밀 스코프(contextvar). 이유: 비밀 누출 경로를 구조로 막는다.
- 도구 지연 노출(tool_search 브리지와 티어). 이유: 도구가 많을 때 프롬프트 비용을 줄이는 방법으로 독립적으로 쓸 수 있다.
- 학습 항목 그래프와 편집(journey, learning_mutations). 이유: 사용자가 "에이전트가 무엇을 배웠는지" 보고 고칠 수 있게 하는 UI 패턴이다.

### 4.3 피할 것 (이유 포함)

- 기본 무승인 자기 수정. 스킬·메모리 쓰기 승인과 에이전트 스킬 스캔이 기본 OFF이고, 전경 `skill_manage(delete)`는 영구 삭제다. 우리는 이것을 반대로 해야 한다. 승인과 스캔과 아카이브를 기본 ON으로 둔다.
- 프롬프트만으로 품질을 정하는 방식. "Be ACTIVE" 같은 편향 지시와 "Nothing to save" 허용 사이의 균형을 평가로 검증하는 장치가 없다. 우리가 도입하면 평가 루프를 먼저 설계해야 한다.
- 모놀리스 규모. Python 약 90만 줄, `hermes_cli/`만 약 29만 줄이다. 저장소는 "파사드 + 형제 모듈" 규율을 AGENTS.md에 적고 함수 복잡도와 파일 크기 상한을 ratchet으로 강제하지만(scripts/code_health/config.py), 이 규율을 지키는 유지비가 크다.
- 한 프로세스 다중 프로필 불변식. 바인딩 누락 한 곳이 프로필 누출이 된다. 우리가 단일 사용자 앱이라면 복잡도만 늘리는 설계다.
- 동기 루프와 스레드 기반 취소. API 스레드를 버리는 방식은 자원 정리가 불완전할 수 있다 [추측]. 우리 L1(a)의 구조적 취소 설계와 비교해 평가해야 한다.
- 문서 수치 그대로 믿기. 3.10 참조. 문서와 소스가 어긋난다.
- 채널과 기능 범위 과다. 메신저 플랫폼 플러그인 27개, 음성, 칸반, 데스크톱, 브라우저 백엔드, 이미지와 영상 생성이 한 저장소에 있다. 코어 범위를 좁히는 설계와 반대 방향이다.
- 승인 기본값이 LLM 판정이다(smart). 판정 모델의 지연, 비용, 오판이 기본 경로에 든다 [추측].

## 5. 다른 대상과 비교할 때 볼 특징

1. 백그라운드 검토 포크가 메인 세션과 같은 session_id와 같은 프롬프트 캐시를 공유한다. 학습 비용을 캐시 히트로 상쇄하려는 설계다 (background_review.py:965-975). 다른 에이전트는 학습을 별도 세션이나 별도 모델로 돌리는 경우가 많다.
2. 기억을 세 계층으로 나눈다. 상시 메모리(작고 세션 시작 때 고정), 절차 스킬(인덱스만 상시, 본문 온디맨드), 원문 세션 검색(LLM 없음). 세 계층의 역할을 프롬프트와 도구 스키마 설명이 직접 가른다 (memory_tool.py:373-400의 WHEN과 SKIP 문구).
3. 사용자 선호를 "스킬이 우선"으로 다룬다. 작업 방식에 관한 교정은 해당 작업의 스킬에 넣고, 메모리에는 교차 작업 선호만 둔다 (background_review.py의 _COMBINED_REVIEW_PROMPT에 있는 "exactly ONE place" 규칙).
4. 프롬프트 캐시 보존이 최상위 불변식으로 명문화되어 있다 (AGENTS.md). 예외는 컴팩션뿐이다. 그래서 스킬 변경도 시스템 프롬프트를 고치지 않고 델타 노트로 알린다 (skills_index_delta.py).
5. 상주 게이트웨이가 크론, 큐레이터, 채널 어댑터, 하우스키핑을 한 프로세스에서 호스트한다. 다중 프로필 멀티플렉싱이 이 프로세스 모델 위에 있다 (gateway/run.py:4576).
6. 세션 입력 큐와 부작용 분류로 "재개 시 재실행 금지"를 구조적으로 다룬다 (session-storage.md:146-148, tool_result_classification.py:14-20).
7. 저장소가 AI 코딩 에이전트가 개발하는 것을 전제로 한다. 루트 AGENTS.md는 라우팅 표이고, 영역별 AGENTS.md가 자동으로 로드된다. `scripts/check`가 글자 수 상한을 강제하고, 코드 건강 ratchet이 함수와 파일 크기를 막는다 (AGENTS.md, scripts/code_health/). 프로젝트 운영 방식으로는 독특하다.
8. 문서와 소스 사이의 드리프트가 측정 가능할 만큼 있다. 아래 목록은 조사자가 확인한 것이다.
   - agent-loop.md "기본 500 반복(agent.max_turns)": 코드상 `max_turns` 기본은 null(무제한)이고 실행 생성자 기본은 `sys.maxsize`다 (config_defaults.py:78-80, run_agent.py:241).
   - architecture.md "3 API Modes": 코드상 5종이다 (runtime_provider.py:135).
   - architecture.md "28 toolsets": `TOOLSETS` 키 59개다 (toolsets.py:74, 조사자 측정).
   - architecture.md "~25,000 tests across ~1,250 files": `test_*.py` 6,739개다 (조사자 측정).
   - agent-loop.md의 "agent-level tools" 목록은 `todo`로 적었으나 실제 키는 `todo_list`이고, 목록도 더 길다 (inline_tool_executors.py:253-311).
   - curator 프롬프트의 "57자 절단"과 코드 상수 60은 어긋난다 (agent/skill_utils.py:839).
   - 확인하고 맞은 것: 게이트웨이 위생 0.85(gateway/run_turn_hygiene.py:97-102), 압축 0.50(agent_init.py:1471), protect_last_n 20.

부록 표기: 조사자 측정 스크립트는 `/tmp/claude-1000/-home-user-projects-helm/18be0c42-9f6e-4c80-8aa6-91ac9c0b15e2/scratchpad/ext/hermes/analysis/count_facts.py`와 `/tmp/claude-1000/-home-user-projects-helm/18be0c42-9f6e-4c80-8aa6-91ac9c0b15e2/scratchpad/ext/hermes/analysis/size_facts.py`이며, 둘 다 저장소 밖에 있고 `python3 -I`로 실행했다. 두 스크립트는 저장소 코드를 import하지 않고 AST와 파일 목록만 읽는다.
