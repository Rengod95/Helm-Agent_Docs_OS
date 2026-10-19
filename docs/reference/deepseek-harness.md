# DeepSeek 하네스 조사: Helm에 도입하거나 활용할 만한가

조사일 2026-10-19. 이 문서는 설계 문서를 고치지 않는 조사 보고서다. 결정은 사용자가 한다.

확인 수준 표시: [원문] 소스·문서를 직접 열어 확인, [실험] 이번에 실행해 확인, [수집] 실작업자 메모에서 가져왔고 원문을 다시 열지 않음, [추정] 조사자의 판단.
원문 위치: `deepseek-ai/deepseek-harness` depth 1 clone, 커밋 `687f282e`(2026-10-17 15:22 +0800), 경로 `/tmp/claude-1000/-home-user-projects-helm/18be0c42-9f6e-4c80-8aa6-91ac9c0b15e2/scratchpad/dsh-src/repo`. 받은 코드는 실행하지 않았다. 아래 저장소 경로는 이 clone 기준이다.
수집 메모: `.helm-design-work/research/deepseek/{official,repos,architecture,policy,performance,community,pi-and-alternatives}.md`.

## 1. 요약

**권고: 하네스(DeepSeek Harness, dsh)는 Helm 런타임으로 채택하지 않고 코드도 가져오지 않는다. 설계 참고 자료로만 쓴다. DeepSeek 모델은 pi-ai에 이미 들어 있는 `deepseek` 제공자로 "선택 제공자, 기본 꺼짐"까지 부분 활용할 수 있다.** 하네스를 들이지 않는 이유는 세 가지다. dsh는 0.x 사전 릴리스이고 호환성 파괴를 예고한다. Cordis 플러그인 트리(packages 아래 package.json 351개)에 묶여 있어 Helm의 커널 단일 변경 경로·SQLite 정본과 겹친다. 기본 구성은 세션 기록을 DeepSeek 서버로 보낸다. DeepSeek 모델을 쓰는 조건도 셋이다. (1) 비밀·개인정보·업무 기밀이 없는 프로젝트에만 켠다(직접 API는 중국 서버에 저장되고 준거법이 중국법이다). (2) 스파이크 S-1로 thinking + 도구 호출 다회 턴에서 `reasoning_content` 재전송이 Helm 투영과 마스킹 규칙과 함께 깨지지 않는지 확인한다. (3) 같은 역할의 Claude Haiku 5.5보다 품질이나 비용에서 나은지 S-2로 확인한다. 가격표만 보면 저가 구간에서 DeepSeek이 싸지 않다. 외부 런타임 어댑터(ADR-00-34의 이후 단계)로 dsh를 붙이는 일은 dsh가 1.0 안정판을 내고 데이터 전송 기본값이 꺼진 상태로 바뀐 뒤 다시 검토한다.

## 2. 대상 정의와 현재 상태

### 2.1 "DeepSeek 하네스"가 가리키는 것

| 후보 | 정체 | 이 문서의 처리 |
|---|---|---|
| (A) DeepSeek Harness(`dsh`) | DeepSeek가 직접 공개한 오픈소스 에이전트 하네스. 저장소 `deepseek-ai/deepseek-harness`, npm `@deepseek-ai/dsh`, 소개 페이지 deepseek.com/harness | 주 대상(§3~§5). 가장 유력하다. 2026-08 이후 보도와 커뮤니티에서 "DeepSeek Harness"는 거의 이것을 가리킨다 [원문 README, 수집 official·community] |
| (B) 외부 하네스에 DeepSeek 모델 연결 | Claude Code·Codex·OpenCode 등을 DeepSeek API(OpenAI 형식 `api.deepseek.com`, Anthropic 형식 `api.deepseek.com/anthropic`)에 붙이는 연동. DeepSeek 문서 "Agent Integrations"에 목록이 있다 | §4.3(모델 공급자로서 DeepSeek)에서 다룬다 [원문 가격표 페이지 사이드바] |
| (C) DeepSeek 모델용 제3자 하네스 | Codewhale(구 DeepSeek-TUI, Rust, 약 4.1만 별, "not affiliated with DeepSeek" 명시), Reasonix(Go, 약 3.6만 별, 개인 계정) 등 | 공식이 아니고 Helm(Node·TS)과 런타임이 달라 짧게만 적는다 [수집 repos] |
| (D) 평가용 하네스 | DeepSeek 모델 카드가 벤치 실행에 쓴 scaffold(dsh Minimal, mini-SWE 등) | §3.6 성능 근거에서 다룬다 |

사용자가 (A) 이외의 것을 뜻했다면 §4.3과 §5의 선택지 E가 그 답에 해당한다.

### 2.2 DeepSeek Harness 현재 상태

| 항목 | 값 | 확인 |
|---|---|---|
| 저장소 | github.com/deepseek-ai/deepseek-harness, 설명 "DeepSeek Harness: Everything is a Plugin." | [원문 gh api, 2026-10-19] |
| 라이선스 | MIT. 제3자 의존물은 `THIRD_PARTY_NOTICES.md` | [원문 `LICENSE`, gh api] |
| 생성·활동 | 생성 2026-08-13, 마지막 push 2026-10-17. 별 253,702, 포크 30,622(조회 시점 값. 증가 속도가 이례적이라 인기 지표로만 본다) | [원문 gh api] |
| 판 | 릴리스 31건이 전부 prerelease. 최신 `dsh-v0.2.1-rc.2`(2026-10-17). 루트 `package.json` 버전 `0.2.1-rc.2` | [원문 gh api releases, `package.json`] |
| 상태 문구 | "DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**" | [원문 `README.md`] |
| 보안 문구 | "It has not undergone a security audit and must not be treated as secure or production-ready." | [원문 `SAFETY.md`] |
| 런타임 | Node `^22.19.0 \|\| >=24.0.0`, pnpm 모노레포, TypeScript. 네이티브 애드온(`native/system`), Python SDK 별도 | [원문 `package.json`] |
| 규모 | `packages` 아래 `package.json` 351개. `packages/*/src`의 `.ts`(테스트 파일명 제외) 약 37.9만 줄 | [실험 find·wc, 2026-10-19] |
| 기반 | Cordis 메타 프레임워크(cordiverse/cordis를 `vendor/cordis`로 포함). 모델 어댑터·도구 레지스트리·세션 로그·에이전트 루프까지 전부 플러그인 | [원문 `docs/architecture.md`] |
| 실행 형태 | `npx @deepseek-ai/dsh web`(127.0.0.1:3080 웹 UI), Electron 데스크톱, `headless`, `sdk`(JSON-RPC 2.0, 줄 단위 스트림), `acp` 프로필 | [원문 README, `docs/architecture.md`] |
| 피드백 창구 | GitHub 이슈 꺼짐(`has_issues: false`), Discussions와 Discord만 | [원문 gh api] |

### 2.3 DeepSeek 모델·API 현재 상태 (2026-10-19)

| 항목 | 값 | 확인 |
|---|---|---|
| API 모델 | `deepseek-flash`(DeepSeek-V4.1-Flash-1017, 2026-09-10 출시·10-17 갱신, 이미지 입력 지원), `deepseek-v4-pro`(V4-Pro-0813, 2026-08-13 GA). 둘 다 컨텍스트 1M | [수집 performance·official, 공식 변경로그] |
| 가격(USD/1M, 비혼잡/혼잡) | flash 입력 $0.15/$0.30, 캐시 적중 $0.003/$0.006, 출력 $0.60/$1.20. v4-pro 입력 $0.66/$1.32, 캐시 적중 $0.022/$0.044, 출력 $1.98/$3.96. 혼잡 시간은 UTC 평일 01–04시, 06–10시(KST 10–13시, 15–19시) | [수집 performance, curl 원문 대조] |
| 검색·페치 API | 1,000건당 $0.75. dsh·Claude Code·Codex 경유 서버 측 호출은 "per-request billing starts at 00:00 Beijing time on November 1, 2026" | [원문 가격표 페이지] |
| 가중치 | V4-Pro, V4.1-Flash 모두 MIT(HF 카드 `license: mit`) | [원문 HF V4.1-Flash README] |
| 도구 호출 | OpenAI 호환 `tools`. strict 모드는 베타(`/beta`). thinking 모드에서 `tool_choice`를 required나 특정 함수로 주면 400 | [수집 architecture] |
| thinking + 도구 | 도구가 있는 요청이면 이후 모든 요청에 이전 assistant의 `reasoning_content`를 되돌려 보내야 한다. 빠지면 400 | [수집 architecture·official, 공식 문서] |
| Anthropic 형식 | 부분 호환. `cache_control`, `tool_result.is_error` 등은 무시, `redacted_thinking`, `document` 등은 미지원 | [수집 architecture] |

## 3. DeepSeek Harness의 구조와 Helm 요구의 대조

### 3.1 dsh 구조 요점

- **모든 것이 플러그인이다.** "Every part of the product is a plugin, including the model adapter, the tool registry, the session log, and the agent loop itself" [원문 `docs/architecture.md`]. 프로필 = 번들 묶음 + 사용자 `cordis.patch.yml`. 설정 행을 id로 바꿔 끼운다.
- **세션 로그가 모델 문맥의 원천이다.** "The session log is the source of the context the model sees." "**Model-visible means logged.** Every model request must be reconstructable from the log." [원문 `docs/architecture.md`]. 저장은 세션별 JSONL(`session.vN.jsonl[.zstd]`), 형식 세대를 이름으로 나누고 이전 세대 파일을 지우지 않는다. 검색용 SQLite 색인(`dsh-session-query-sqlite`)은 따로 있다 [원문 같은 문서, `packages/bundle/base/cordis.patch.yml`].
- **도구 실행 경로**: `tool/call`을 실행 전에 기록 → `tools/pre-execute`(훅·권한·샌드박스) → 단조 guard(거부 또는 기권) → 필요하면 `ctx.approval` 한 번 묻기("absent or unanswerable: deny") → `tools/execute` → `tools/post-execute` → `tool/result` 기록 [원문 `docs/tool-execution-pipeline.md`].
- **샌드박스**: Linux는 bwrap 다음 Landlock, macOS는 Seatbelt, Windows는 ACL 제한 토큰. 쓸 수 있는 실행기가 없으면 `SANDBOX_UNAVAILABLE`로 실패하고 격리 없이 실행하지 않는다. 실행마다 `full`/`partial` 집행 수준을 돌려준다 [원문 `packages/sandbox/sandbox-local/README.md`]. 정책 어휘는 파일 효과뿐이다: "the seam expresses no network, process, syscall, device, or credential restrictions." [원문 `packages/sandbox/sandbox/README.md`]. 기본 모드는 `workspace-write` + `ask` [원문 base 번들].
- **도구 목록**: bash/pwsh(지속 셸 포함), read/write/edit/str_replace_editor, glob/grep, lsp, terminal, web search/fetch, MCP 리소스, subagent, goal, schedule, skill, plan mode, `run_code`(PTC: 도구 묶음 호출), 실험 패키지로 Stagehand 브라우저와 CUA 컴퓨터 사용 [원문 `docs/tool-catalog.md`, `packages/experimental`]. 해시라인 편집은 없다 [원문 grep 결과 없음].
- **모델 어댑터**: `dsh-llm-deepseek`(기본 baseURL `https://api.deepseek.com/anthropic`, Anthropic Messages 형식)와 `dsh-llm-pi-ai`. 후자는 `@earendil-works/pi-ai ^1.1.0`에 의존한다. Helm이 쓰는 pi-ai와 같은 판이다 [원문 `packages/llm/llm-deepseek/README.md`, `packages/llm/llm-pi-ai/package.json`].

### 3.2 런타임(pi)과 겹치는 부분

| 영역 | Helm 설계 | dsh | 겹침 |
|---|---|---|---|
| 모델 계층 | pi-ai를 `ModelGateway` 뒤에 둔다(ADR-00-27, 12 §3.3) | `llm-pi-ai` 어댑터가 같은 pi-ai 1.1.0을 쓴다. 자체 DeepSeek 어댑터는 별도 | 거의 같다. dsh를 들여도 모델 계층에서 얻는 것이 없다 |
| 에이전트 루프 | pi-agent-core 포크(2,519줄), 커널 검사는 루프 훅(ADR-00-28) | Cordis 이벤트 waterfall(`agent/pre-step`, `agent/request`, `tools/*`) 위의 자체 루프 | 같은 일을 하는 두 구현. 크기 차이가 크다 |
| 도구 | pi coding-agent 도구 vendor + Helm 도구(13) | 자체 도구 플러그인 수십 개 | 겹친다 |
| 세션 저장 | Helm 이벤트 로그(SQLite WAL)가 정본, pi 세션 저장은 끈다(ADR-00-23 결과) | 세션별 JSONL이 정본 | 정본이 둘이 된다. Helm 원칙과 충돌 |
| 클라이언트 | Tauri 데스크톱 + JSON-RPC over WebSocket(19), SSH TUI | 웹 UI·Electron·SDK JSON-RPC·ACP | 겹친다 |

### 3.3 Helm 요구와의 적합성

| Helm 요구 | 근거 | dsh 상태 | 판정 |
|---|---|---|---|
| 커널 단일 변경 경로, 이벤트·실행 기록 append는 `@helm/engine` 한 곳 | ADR-06(엔진), 10 | 임의 플러그인이 `SessionEventMap`을 확장하고 이벤트를 쓴다("Add durable session state: extend `SessionEventMap`"). 커널 개념이 없다 | 맞지 않음. 들이면 쓰기 경로가 둘이 된다 |
| SQLite 이벤트 로그가 정본, 도메인 어휘는 중립(06 P1, AP-1) | 결정 29, 06 §3.13 | JSONL 세션 형식이 정본이고 이벤트 이름이 dsh 어휘(`turn/start`, `tool/call` …) | 어댑터로 바꿔 넣을 수는 있다. 런타임으로는 맞지 않음 |
| 크래시 복구: 의도 → 실행 → 결과, 재시작 뒤 safe만 재실행(ADR-12-02) | 12 §3.7 | `tool/call`을 실행 전에 기록하는 점은 같다. 재시작 때 진행 중 도구를 어떻게 정리하는지는 확인하지 못했다. "a hard process loss before settlement leaves no durable attempt stream" | 부분 일치, 미확인 |
| 사람 결정 대기 동안 루프를 끝내고 승인된 행동은 저장된 계획으로 실행(ADR-12-03) | 11, 12 §3.13 | `ctx.approval`은 그 자리에서 한 번 묻는 방식. 답이 없으면 거부 | 맞지 않음. Helm의 비동기 승인(휴대폰 알림 포함)은 dsh 모델에 없다 |
| 샌드박스 S1: bubblewrap 마운트 격리 + 네트워크 차단(`--unshare-net`) | 13 §3.6, TL-2 | bwrap/Landlock 파일 효과만. 네트워크 정책 없음 | 파일 쪽은 같은 계열. 네트워크 쪽 부족 |
| 결정 55: 외부 인터넷은 허용, 내부망(루프백·사설·CGNAT·tailnet)만 차단 | 결정 55 | 샌드박스 어휘에 네트워크가 없어 구현 수단이 없다 | 맞지 않음 |
| 결정 55: `web_fetch`·`web_search` | 결정 55 | 기본 검색 공급자가 `deepseek-official`(DeepSeek Search API, 11-01부터 과금). Discussions #10252는 web_search가 전역 설정을 무시하고 공식 API로 고정된다고 보고(2026-10-19, 제목 확인) | Helm이 쓰기 어려움. 검색 질의가 중국 서버로 간다 |
| 결정 55: 해시라인 편집, 고급 grep, 브라우저(Stagehand 계열), 컴퓨터 사용 | 결정 55, 13 | 해시라인 없음. grep/glob 있음. Stagehand·CUA는 `experimental` | 일부만. 참고 가치는 있다 |
| 결정 61: 브라우저 스크린샷 원본을 보관하지 않음 | 결정 61 | 확인하지 않음 | 미확인 |
| 비밀은 SecretStore로만, 기록에 남기지 않음(18) | 18, 12 §3.3 `SecretStoreCredentialStore` | `apiKeyEnv` 참조를 요청마다 해석, 설정 파일에 비밀을 쓰지 않음 | 방식은 비슷하다 |

### 3.4 데이터가 기기 밖으로 나가는 경로 (dsh 기본 구성)

이 항목이 dsh를 "그대로 실행"하는 선택지를 막는 가장 구체적인 이유다.

1. **`dsh_session_log`(기본 켜짐)**: `deepseek-official` 경로의 모델 요청 본문에 세션 로그 일부를 덧붙여 보낸다. 문서 원문: "Unless a composition disables it, `dsh_session_log` may expose the Session working directory, system-prompt snapshots, user and Assistant content, embedded Assistant streams, failed-attempt output, tool arguments and results, compaction summaries, feedback, and plugin-owned events." [원문 `docs/deepseek-llm-api-wire-extensions.md` 160행]. 모델 입력에 이미 들어가는 내용과 겹치지만, 실패한 시도 출력·피드백·플러그인 이벤트처럼 모델이 보지 않는 것도 포함된다. 지정한 게이트웨이(`baseURL`)에도 같은 값이 간다.
2. **요청 헤더**: `x-deepseek-harness-user-id`(Harness 홈의 고정 익명 UUID), `x-deepseek-harness-session-id`, `dsh_plugin_packages`(활성 플러그인 패키지 이름·판, 기본 켜짐) [원문 같은 문서].
3. **세션 원격 측정 `FEEDBACK_ONLY`(기본)**: 사용자가 피드백을 남기면 그 시점까지의 세션 앞부분(문맥 포함)을 `https://dsh-otel-collector.deepseeksvc.com/v1/logs`로 보낸다. "for all users and providers, including `deepseek-official`" [원문 `packages/session/session-telemetry-otel/README.md`, base 번들 `session-telemetry-otel` 행]. `DISABLED`로 끌 수 있다.
4. **제품 분석**: 데스크톱 프로필에서만 켜진다. 일반 웹 프로필에서는 꺼져 있다 [원문 `packages/bundle/web-app/cordis.patch.yml` 46–62행].

모두 설정 패치로 끌 수 있다. 다만 사전 릴리스 동안 플러그인과 기본값이 자주 바뀌므로, 판을 올릴 때마다 다시 확인해야 한다 [추정].

### 3.5 dsh에서 설계로 참고할 점

코드는 가져오지 않더라도 다음은 Helm 설계를 점검하는 데 쓸 만하다.

- "Model-visible means logged" 원칙과 `request/header`·`request/context` 기록. Helm ADR-12-01(로그에서 매 요청 재구성)과 같은 방향이다. dsh는 시스템 프롬프트 변경을 캐시된 기록 뒤에 덧붙이는 모드(`systemPromptUpdate: in-history`)를 둔다. Helm 컴팩션·캐시 적중 설계(12 §3.5–3.6)에서 비교해 볼 만하다 [원문 `docs/architecture.md`, `llm-deepseek/README.md`].
- 샌드박스 실행마다 `full`/`partial` 집행 수준과 실행기 실패 서명을 돌려주는 방식. Helm 13 §3.6의 S0/S1b/S1 표시와 능력 목록(ADR-13-04)에 그대로 대응한다 [원문 `sandbox-local/README.md`].
- 도구 경로의 단조 guard(거부 또는 기권만 가능, 순서 변경 불가)와 waterfall 훅의 구분 [원문 `docs/tool-execution-pipeline.md`].
- thinking 모드에서 `reasoning_content` 재전송 문제를 dsh 자신도 겪고 있다(Discussions #7050, #9435, #10077). 같은 함정이 Helm에도 생긴다(§4.3) [원문 gh graphql 제목 확인].

### 3.6 성능 근거: 하네스 차이

DeepSeek V4.1-Flash 모델 카드는 같은 모델을 여러 scaffold로 돌린 표를 싣는다. N=8(DeepSWE), N=3(TB2.1), max_steps 500, 컨텍스트 1M [원문 HF `deepseek-ai/DeepSeek-V4.1-Flash` README 145–154행].

| 벤치 | Claude Code | Codex | OpenCode | Pi | mini-SWE | DSH Minimal | DSH Standard | DSH PTC |
|---|---|---|---|---|---|---|---|---|
| DeepSWE v1.1 | 69.8 | 65.6 | 65.5 | 66.2 | 74.2 | 72.6 | 70.5 | 67.6 |
| Terminal-Bench 2.1 | 88.0 | 84.1 | 85.0 | 86.1 | 90.3 | 90.6 | 85.8 | 85.8 |

- DeepSeek 자체 실행 수치이고 독립 재현은 없다. 도구가 적은 Minimal(셸 + 편집)이 Standard보다 높다. DeepSeek 모델에서는 도구를 많이 주는 것이 점수를 올리지 않았다는 뜻이다.
- Pi와 DSH Minimal의 차이(6.4점, 4.5점)는 dsh 전체를 들일 근거가 되지 못한다. 차이를 만든 요인이 도구 수와 프롬프트라면 Helm이 모델별 도구 묶음으로 따라 할 수 있다 [추정]. 이 점은 S-2에서 확인할 수 있다.
- 독립 지수(Artificial Analysis Intelligence Index v4.3.2)는 V4.1-Flash 39, V4-Pro-0813 36, Claude Opus 5.5 58이다 [수집 performance, WebFetch 추출]. 카드의 자체 비교표(TB2.1에서 V4.1-Flash 90.6 대 Opus-5.0 89.1)와 차이가 크다. 자체 보고 수치는 할인해서 본다.

## 4. 모델 공급자로서 DeepSeek과 하네스 자체 사용의 구분

### 4.1 두 가지는 따로 판단한다

| 구분 | 무엇을 들이는가 | Helm 설계와의 접점 |
|---|---|---|
| 하네스 사용 | dsh 런타임·플러그인·저장 형식 | 런타임(07, 12), 도구(13), 저장(09), 커널(10) 전부 |
| 모델 사용 | DeepSeek API 또는 제3자 호스팅의 DeepSeek 모델 | `@helm/ai` 제공자 설정 한 줄과 데이터 정책(18) |

DeepSeek 모델을 쓰는 데 dsh는 필요 없다. pi-ai 1.1.0에 `deepseek` 제공자가 이미 있다.

### 4.2 pi-ai의 DeepSeek 지원

- 제공자 정의: `id: "deepseek"`, `baseUrl: "https://api.deepseek.com"`, 키 `DEEPSEEK_API_KEY`, API `openai-completions` [원문 `.helm-design-work/P4/fork-proto/node_modules/@earendil-works/pi-ai/dist/providers/deepseek.js` 소스맵의 `deepseek.ts`].
- 내장 모델은 `deepseek-flash`, `deepseek-v4-pro` 두 개 [수집 pi-and-alternatives, `data/deepseek.json`].
- DeepSeek 전용 처리: `thinkingFormat: "deepseek"`(`thinking: { type }` + `reasoning_effort`), `requiresReasoningContentOnAssistantMessages`(재전송 때 빈 `reasoning_content`를 채움) [원문 pi-ai README 1413–1414행].
- 수준을 지정하지 않으면 pi는 thinking을 끈다. DeepSeek API 기본값(켜짐, high)과 다르다 [수집 pi-and-alternatives, `openai-completions.js` 668–679행].
- 관련 pi 이슈: #7702(게이트웨이 경유 시 DeepSeek 인식 실패, 닫힘), #8779(도구 전용 턴 replay 400, 닫힘), #10262(수동 선언 모델의 reasoning 필드 누락, 닫힘), #11106(Linux에서 약 10.5초 고정 타임아웃, undici connect timeout, 2026-10-18 닫힘, 보고 판 1.3.0) [원문 gh api #11106, 나머지 수집 community].
- Helm 12 §3.3.3은 1차 제공자를 Anthropic, OpenAI, Google, OpenRouter 넷으로 두고 "나머지 pi-ai 제공자는 설정에 켜면 같은 방식으로 붙는다"고 적었다(12 611행). DeepSeek은 이 경로로 붙는다.

### 4.3 Helm 설계와 부딪히는 지점

1. **thinking 블록 마스킹.** 12 §3.3(662행)은 thinking 안에서 마스킹이 일어나면 블록을 `[thinking redacted]`로 바꾸고 "서명이 깨진 thinking은 다음 요청에 보내지 않는다"고 정한다. DeepSeek은 도구가 있는 대화에서 이전 `reasoning_content`가 빠지면 400을 낸다. 따라서 마스킹이 한 번 일어나면 그 run은 DeepSeek으로 이어갈 수 없게 될 수 있다. pi-ai가 빈 `reasoning_content`를 채우는 처리가 이 경우를 덮는지 확인해야 한다(S-1).
2. **제공자 전환.** 12 §3.3(635행)의 대체 모델 전환 때 pi-ai `transformMessages`가 thinking을 바꾼다. 다른 제공자에서 DeepSeek으로 넘어갈 때 도구 호출 기록에 thinking이 없어 400이 나는 문제를 dsh도 겪고 있다(Discussions #10077, 2026-10-18). DeepSeek을 대체 모델 사슬에 넣으려면 같은 시험이 필요하다.
3. **원장 보존.** 12 799행은 thinking 블록을 본문 blob에 그대로 저장한다. 이 규칙은 DeepSeek에도 맞다. 투영(A11)에서 thinking을 빼지 않도록 DeepSeek 모델에 한해 확인 항목을 둔다.
4. **도구 선택 강제.** thinking 모드에서 `tool_choice`를 required나 특정 함수로 주면 400이다. Helm이 계획 표시(PlanFlags)나 구조화 출력 단계에서 도구 선택을 강제한다면 DeepSeek은 thinking을 꺼야 한다 [수집 architecture].
5. **연결 타임아웃.** pi #11106이 WSL2(Linux)에서도 재현되는지 확인해야 한다(S-3).

### 4.4 데이터 정책

- DeepSeek 직접 API: 개인정보처리방침(한국어판, 최종 업데이트 2026-05-06) "저희 서버는 중화인민공화국에 위치해 있습니다." [원문 curl `cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html`]. 개방 플랫폼 약관은 "governed by the laws of the People's Republic of China in the mainland" [수집 policy]. 입력·출력의 서비스 개선 사용은 약관상 허용되고, API 데이터에 옵트아웃이 적용되는지는 확인하지 못했다 [수집 policy].
- 한국: 개인정보위가 2025-02-15 앱 신규 다운로드를 잠정 중단했고 2025-04 시정 권고(국외 이전 근거 마련, 이전된 프롬프트 파기) 뒤 재개됐다 [수집 policy, 2차 보도 포함].
- 안전성 평가: NIST CAISI(2025-09-30)는 R1-0528이 악성 요청에 94% 응했다고 보고했다. CrowdStrike(2025-11)는 특정 정치 민감 키워드가 있으면 생성 코드의 보안이 떨어진다고 보고했다 [수집 policy]. 최신 V4 계열에 같은 결과가 이어지는지는 확인하지 못했다.
- 대안 호스팅: AWS Bedrock·Azure는 입력·출력을 모델 제공자와 공유하지 않는다고 명시하고, Fireworks·Together는 옵트인 없이 학습하지 않는다고 명시한다 [수집 policy]. 다만 최신 `deepseek-flash`(V4.1-Flash-1017)가 이들에 같은 시기에 올라오는지, 같은 thinking·도구 기능을 주는지는 경로마다 다르다 [수집 pi-and-alternatives].
- Helm 사용 유즈케이스로 옮기면: 사용자 개인 프로젝트 코드·노트·이메일 같은 개인 자료를 다루는 run에 DeepSeek 직접 API를 쓰면 그 내용이 중국 서버에 저장된다. 공개 저장소 작업이나 공개 웹 자료 요약에는 문제가 작다 [추정].

### 4.5 비용 비교

Anthropic 가격(USD/1M, 2026-10-19) [원문 platform.claude.com pricing]: Haiku 5.5(10만 토큰 이하) 입력 $0.10, 캐시 적중 $0.01, 출력 $0.50. Sonnet 5.5 $2 / $0.10 / $10. Opus 5.5 $4 / $0.20 / $20.

| 비교 | DeepSeek flash (비혼잡/혼잡) | Claude Haiku 5.5 | 비고 |
|---|---|---|---|
| 입력 | $0.15 / $0.30 | $0.10 | Haiku가 싸다 |
| 캐시 적중 | $0.003 / $0.006 | $0.01 | DeepSeek이 싸다 |
| 출력 | $0.60 / $1.20 | $0.50 | Haiku가 싸다 |

- 저가 구간에서 DeepSeek의 가격 이점은 캐시 적중 단가뿐이다. 캐시 적중 비율이 매우 높은 긴 에이전트 작업이 아니면 차이가 작다 [추정].
- Opus 5.5·Sonnet 5.5 대비로는 크게 싸다(작업당 비용 V4.1-Flash $0.49 대 Opus 5.5 $5.98, AA 기준) [수집 performance]. 품질 지수 차이(39 대 58)를 감안해야 한다.
- 혼잡 시간이 KST 오전 10–13시, 오후 3–7시로 사용자의 주간 작업 시간과 겹친다. 이 시간에는 가격이 두 배다.

## 5. 활용 선택지

| 선택지 | 내용 | 장점 | 단점·위험 | 판정 |
|---|---|---|---|---|
| A. 런타임 교체 | dsh를 Helm 런타임으로 쓰고 Helm은 그 위에 커널·UI만 | 도구·샌드박스·UI가 이미 있다 | 커널 단일 경로, SQLite 정본, 비동기 승인, 결정 55 네트워크 규칙과 맞지 않음. 0.x 사전 릴리스, 호환성 파괴 예고, 보안 감사 없음. 기본값이 세션 기록을 외부로 보냄. 1인 운영자가 37.9만 줄·351 패키지 판 올림을 따라가야 함 | 불채택 |
| B. 일부 패키지 가져오기(vendor·의존) | 샌드박스·도구 패키지만 | 플랫폼별 샌드박스 실행기, 도구 구현 | 패키지가 Cordis `ctx`·이벤트 waterfall·`fs`/`subprocess` seam에 묶여 있다. 떼어 내면 사실상 다시 쓰는 일이 된다. Helm은 이미 bwrap 실험을 마쳤다(13 §2, 약 16ms) | 불채택 |
| C. 외부 런타임 어댑터 | ADR-00-34의 이후 단계 어댑터 목록에 dsh(SDK JSON-RPC 또는 ACP 프로필)를 더함 | Helm 본체를 바꾸지 않음. 사용자가 dsh를 쓰고 싶을 때 같은 승인·기록 화면에서 관찰 | 어댑터 적합성 보장 수준이 낮다(승인·샌드박스가 dsh 안쪽). 사전 릴리스 동안 프로토콜이 바뀐다. 데이터 전송 기본값을 꺼야 함 | 보류. dsh 1.0 이후 재검토 |
| D. 설계 참고 | §3.5 항목을 13·12 검토 때 비교 자료로 씀 | 비용 없음 | 없음 | 채택 |
| E. DeepSeek 모델을 선택 제공자로 | pi-ai `deepseek` 제공자를 설정으로 켬. 기본 꺼짐. 프로젝트별 허용 | 코드 변경 거의 없음. Opus·Sonnet 대비 저렴. 1M 컨텍스트 | 데이터 정책(§4.4). reasoning 재전송 함정(§4.3). Haiku 5.5 대비 가격 이점 작음. API 혼잡 시간 가격 두 배. 자체 보고 벤치와 독립 지수 차이 | 조건부 부분 활용 |
| F. DeepSeek Search/Fetch API를 `web_search` 백엔드로 | 결정 55의 웹 도구 공급자 후보 | 값이 낮음($0.75/1,000건) | 검색 질의와 페치 URL이 중국 서버로 감. 사용자 탐색 기록이 쌓임 | 불채택 |
| G. 제3자 DeepSeek 하네스(Codewhale, Reasonix) | 참고 또는 외부 런타임 | 단일 바이너리 | Rust·Go, Helm 런타임과 다름, 비공식 | 불채택 |

### 5.1 1인 운영 부담

- dsh는 하루에 rc를 두세 번 낼 때가 있다(2026-10-17 rc.1·rc.2). 따라가려면 판마다 기본값과 데이터 전송 항목을 다시 봐야 한다 [원문 gh api releases].
- 이슈 창구가 없고 Discussions만 있다. 문제를 추적하기 어렵다 [원문 gh api].
- 모델만 쓰는 선택지 E는 운영 부담이 키 하나(`just secret-add DEEPSEEK_API_KEY`)와 제공자 상태 확인뿐이다.

## 6. 권고와 바꿔야 할 설계 문서

### 6.1 권고

1. dsh는 불채택(A, B, F, G). 설계 참고(D)만 한다.
2. 외부 런타임 어댑터(C)는 보류한다. 재검토 조건: dsh 1.0 안정판, `dsh_session_log`·원격 측정 기본값이 꺼짐으로 바뀜, SDK 프로토콜 안정 선언.
3. DeepSeek 모델(E)은 스파이크 S-1~S-3을 통과하면 "선택 제공자, 기본 꺼짐, 프로젝트 허용 목록"으로 넣는다. 우선 후보 역할은 공개 자료 요약·하위 호출처럼 비밀이 없는 저가 역할이다. 그 역할에서 Haiku 5.5보다 낫지 않으면 넣지 않는다.

### 6.2 선택지 E를 택할 때 바꿀 문서·절

| 문서·절 | 바꿀 내용 |
|---|---|
| 12 §3.3.3 (611행 제공자 목록) | DeepSeek을 선택 제공자로 적고 기본 꺼짐, 역할 제한(예: mediator·subcall·summarizer)을 둔다 |
| 12 §3.3 (662행 마스킹, 799행 thinking 보존) | DeepSeek처럼 reasoning 재전송이 필수인 제공자에서 thinking 마스킹이 일어났을 때의 처리(같은 제공자 이어가기 중단 또는 빈 reasoning 대체)를 정한다 |
| 12 §3.3 (635행 대체 모델) | 다른 제공자 → DeepSeek 전환 시 thinking 없는 도구 기록 문제와 대처를 적는다 |
| 12 §3.5 투영(A11) | DeepSeek 모델에서 assistant `reasoning_content`를 투영에서 빼지 않는다는 확인 항목 |
| 18 보안 | 제공자별 데이터 보관 위치·학습 사용 여부를 표로 두고, 프로젝트별 제공자 허용 목록(예: `providers.allowedForProject`)을 둔다 |
| 17 운영 | `DEEPSEEK_API_KEY` 등록 레시피, 연결 타임아웃 설정 |
| 24 ADR | 새 ADR "제공자 데이터 정책과 프로젝트별 허용"(ADR-00-27의 후속) |
| 13 §3.6 | 바꾸지 않는다. dsh의 `full`/`partial` 집행 보고를 비교 참고로만 적을 수 있다 |
| 06 §3.13, ADR-00-34 | 선택지 C를 택할 때만 이후 단계 어댑터 목록에 dsh SDK/ACP를 더한다 |

### 6.3 확인 실험(스파이크) 제안

| ID | 목적 | 방법 | 통과 기준 |
|---|---|---|---|
| S-1 | thinking + 도구 다회 턴이 Helm 방식으로 깨지지 않는가 | fork-proto에서 pi-ai `deepseek` 제공자로 도구 3개, 10턴 대화. 매 요청을 로그에서 재구성(ADR-12-01 방식). 중간에 thinking 마스킹 1회, 제공자 전환 1회(Anthropic → DeepSeek)를 넣는다. 공개 저장소 자료만 쓴다 | 400이 0건. 마스킹·전환 뒤의 동작이 문서화 가능한 규칙으로 정리됨 |
| S-2 | 저가 역할에서 Haiku 5.5보다 나은가 | Helm 하위 호출·요약 표본 10개를 `deepseek-flash`(thinking high)와 Haiku 5.5로 각각 실행. 같은 도구 묶음. 토큰·비용·지연·결과 품질(사람 판정) 기록. 비혼잡·혼잡 시간 각각 | 품질 동등 이상이고 비용 또는 지연에서 이점. 아니면 E를 접는다 |
| S-3 | WSL2 연결 타임아웃 | pi-ai 1.1.0과 최신판으로 긴 thinking 요청(첫 토큰까지 10초 이상) 20회 | 고정 10.5초 실패가 0건 또는 설정으로 해결 |
| S-4 (선택지 C 때만) | dsh 외부 어댑터 가능성 | 일회용 VM에서 `dsh --profile sdk`, 데이터 전송 항목 끈 패치로 실행. 외부로 나가는 요청을 프록시로 기록. SDK 이벤트를 Helm 중립 신호로 대응표 작성 | DeepSeek 도메인으로 가는 요청이 모델 호출 외에 없음. 대응표에 빠진 신호 목록 확정 |

## 7. 미확인 사항

- dsh의 재시작 시 진행 중 도구 처리(재실행 여부).
- dsh가 브라우저 스크린샷을 어디에 얼마나 보관하는가(결정 61 대비).
- DeepSeek API 데이터에 학습 옵트아웃이 적용되는지.
- `deepseek-v4-pro` 라우팅: 2차 보도는 9-14부터 Flash로 보낸다고 했고 공식 변경로그는 계속 제공한다고 했다. 실제 호출로 확인해야 한다 [수집 architecture·performance].
- 제3자 호스팅에서 최신 `deepseek-flash` 제공 시기와 기능.
- 별 수(25만)의 진위.

## 8. 출처 (확인 2026-10-19)

원문을 직접 확인한 것:

- https://github.com/deepseek-ai/deepseek-harness — README.md, SAFETY.md, LICENSE, package.json, docs/architecture.md, docs/tool-execution-pipeline.md, docs/agent-lifecycle.md, docs/tool-catalog.md, docs/deepseek-llm-api-wire-extensions.md, packages/bundle/base/cordis.patch.yml, packages/bundle/web-app/cordis.patch.yml, packages/llm/llm-deepseek/README.md, packages/llm/llm-pi-ai/{README.md,package.json}, packages/sandbox/{sandbox,sandbox-local,sandbox-policy}/README.md, packages/session/session-telemetry-otel/README.md, packages/host/product-telemetry-otel/README.md (커밋 687f282e, 2026-10-17)
- GitHub API: repos/deepseek-ai/deepseek-harness, /releases, /tags, /contributors
- https://github.com/deepseek-ai/deepseek-harness/discussions/7050 (2026-09-18), /10077 (2026-10-18), /10252 (2026-10-19) — 제목·날짜
- https://github.com/earendil-works/pi/issues/11106 (2026-10-18)
- https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash (raw README, scaffold 비교표, `license: mit`)
- https://api-docs.deepseek.com/quick_start/pricing (Agent Integrations 목록, Search/Fetch 과금 문구)
- https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html (한국어판, 최종 업데이트 2026-05-06)
- https://platform.claude.com/docs/en/about-claude/pricing (Claude 5.5 가격)
- https://www.infoq.com/news/2026/08/deep-seek-harness/ (2026-08-20, 2차 보도. 모드 Standard·Code·Minimal·Creator 설명)
- 로컬: `.helm-design-work/P4/fork-proto/node_modules/@earendil-works/pi-ai/` (README 69, 467, 1395, 1413–1414행, dist/providers/deepseek.js)

수집 메모를 거친 것(원문 URL은 각 메모의 출처 목록):

- `.helm-design-work/research/deepseek/official.md` — 공식 소개 페이지, 변경로그(news260813, news261017), 출시 이력
- `.helm-design-work/research/deepseek/architecture.md` — 도구 호출, thinking 재전송, Anthropic 호환 표, 기술 보고서(arXiv 2606.19348 등)
- `.helm-design-work/research/deepseek/policy.md` — 약관, 개인정보위 조치, Wiz·NIST CAISI·CrowdStrike, Bedrock·Azure·Fireworks·Together 정책
- `.helm-design-work/research/deepseek/performance.md` — 가격표, 모델 카드 수치, Artificial Analysis 지수
- `.helm-design-work/research/deepseek/community.md` — pi·Cline·Roo·OpenCode 이슈, 후기
- `.helm-design-work/research/deepseek/repos.md` — 제3자 하네스 목록
- `.helm-design-work/research/deepseek/pi-and-alternatives.md` — pi-ai DeepSeek 처리 행 번호, 대안 경로 비교
