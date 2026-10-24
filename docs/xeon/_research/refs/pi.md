# pi (earendil-works/pi) F~L2 층 설계 조사

조사 틀: `scratchpad/research/refs/_template.md`. 근거 표기는 다음과 같다. `[원문]`은 이번 조사에서 해당 줄을 직접 읽었거나 grep으로 확인한 것이다. `[기존]`은 기존 노트(`scratchpad/ext/pi-report.md`)에서 가져온 인용이며 일부만 재확인했다. `[추측]`은 코드에서 추론했으나 실행하지 않은 것이다. 실행, 설치, 테스트 실행은 하지 않았다.

경로 약칭 (모두 `~/projects/_ref/pi-src/packages/` 아래): `ai:` = `ai/src/`, `agent:` = `agent/src/`, `CA:` = `coding-agent/src/`, `CA/core:` = `coding-agent/src/core/`, `mcp:` = `mcp/src/`, `proto:` = `protocol/src/`, `srv:` = `server/src/`, `cli:` = `client/src/`, `env:` = `env/`.

---

## 0. 대상 정보

| 항목 | 내용 | 근거 |
|---|---|---|
| 저장소 | https://github.com/earendil-works/pi (모노레포) | `CA/docs/session-format.md` Source 절 `[원문]`. 루트 package.json에 repository 필드 없음 |
| 커밋 | `cdaf6c2` (2026-10-11 08:16 UTC) | `git log -1` `[원문]` |
| clone 상태 | 얕은 clone 50커밋. 과거 이력은 재검증 못 함 | `git rev-parse --is-shallow-repository` `[원문]` |
| 버전 | 전 패키지 1.1.0 (lockstep). 루트 0.0.3 | `packages/*/package.json` `[원문]` |
| 라이선스 | MIT. "Copyright (c) 2025 Mario Zechner" | `LICENSE` `[원문]` |
| 언어 | TypeScript (ESM). Rust 1개(`env/daemon`). Node `>=22.19.0` | 루트 `package.json` `[원문]` |
| 빌드 순서 | chord → tui → telemetry → codemode → mcp → ai → durable → env → agent → protocol → client → server → coding-agent | 루트 `package.json:15` `[원문]` |

대상 8개 패키지 (src 줄 수, 생성 파일과 테스트 제외):

| 패키지 | 줄 수 | 워크스페이스 의존 | 자기 표기 |
|---|---|---|---|
| ai (`pi-ai`) | 26,933 | 없음. 외부 SDK 다수 | 표기 없음 (1.x) |
| agent (`pi-agent-core`) | 2,519 | ai | 표기 없음 |
| coding-agent (`pi-coding-agent`) | 86,152 | agent, ai, tui, mcp, codemode, chord | "minimal, extensible agent harness" |
| mcp (`pi-mcp`) | 3,244 | cross-spawn만 | "does not depend on the official MCP SDK" |
| server (`pi-server`) | 1,958 | chord, protocol | "Experimental" `[원문]` |
| protocol (`pi-protocol`) | 869 | chord, typebox | "experimental ... no compatibility guarantees" `[원문]` proto README:41 |
| client (`pi-client`) | 1,135 | chord, protocol | "experimental" `[원문]` cli README:3 |
| env (`pi-env`) | 2,073 | chord, durable | 표기 없음. durable(실험)에 종속 |

### 0.1 안정과 실험의 경계 (지정 범위와 실제가 다르다)

사용자가 지정한 "안정 경로" 8개 중 server, protocol, client는 자기 문서가 실험이라고 적는다. env는 표기가 없지만 `env/src/remote-env.ts:28`이 실험 durable의 `ExecutionEnv`를 구현하고, durable은 "Experimental. The API changes without notice"라고 적는다 `[원문]`. 워크스페이스에서 `pi-env`를 import하는 곳은 `env/package.json` 하나뿐이다 `[원문 grep]`. 따라서 이 보고서는 server, protocol, client, env를 "실험 취급"으로 분류한다. 안정 경로의 실질은 ai, agent, coding-agent(실험 하위 디렉터리 제외), mcp다.

coding-agent 안의 실험 경계는 다음과 같다 `[원문 grep]`.
- 실험 디렉터리는 `CA/experimental/`과 `CA/cli/experimental/`이다. `CA/client/index.ts`는 `pi-client`를 재수출하는 한 줄이다.
- chord, durable, server, client, protocol을 import하는 파일은 이 셋 밖에 없다.
- 실험 명령은 `PI_EXPERIMENTAL=1`로만 열린다 (`CA/core/experimental.ts:1-3`, `CA/experimental/commands.ts:86`).
- 그러나 코드는 CLI 번들에 함께 들어간다. 번들 스크립트의 external 허용 목록은 chord와 photon뿐이고, 그 밖의 import가 남으면 빌드가 실패한다 (`scripts/build-coding-agent-bundle.mjs:18-24, 89, 116-124`). `pi` 바이너리 안에 실험 코드가 있다는 뜻이다.
- `CA/package.json`은 pi-client, pi-protocol, pi-server를 devDependencies로만 선언한다. pi-durable은 선언이 없는데 실험 코드가 import한다 `[원문]`. 기존 노트의 "coding-agent가 client/server/protocol에 의존"이라는 표기는 부정확하다.

### 0.2 durable과 chord (이름과 관계만)

durable(`pi-durable`)은 커밋 기반 대화 런타임이며 실험이다. ai와 chord에 의존하고 agent-core를 쓰지 않는 자체 루프를 가진다. chord(`@earendil-works/chord`)는 facet, service, replicated state를 가진 플러그인 합성 런타임이며, 자기 README에 "it is not a Pi package"라고 적는다 `[원문]`. 안정 coding-agent는 이 둘을 실험 경로 밖에서 쓰지 않는다. 세부는 다른 조사자 몫이다.

### 0.3 기존 노트(`ext/pi-report.md`)와 다른 점

- §0, §1.1의 "coding-agent가 client/server/protocol에 의존"은 devDependencies이고 pi-durable은 미선언 import다 `[원문]`.
- 확장 이벤트 41종은 `ExtensionAPI.on` 오버로드의 고유 이름 41개로 재확인했다 (`CA/core/extensions/types.ts:1569-1636`) `[원문]`.
- breaking 절은 `^### Breaking` 기준으로 coding-agent 50, ai 27, agent 13이다. 기존 노트의 49는 측정 차이로 보인다 `[원문 grep]`.
- oh-my-pi 수치는 재확인하지 않았다 `[기존]`.

### 0.4 조사 범위와 못 본 것

범위는 위 8개 패키지의 src(테스트와 생성 파일 제외), README, docs, CHANGELOG, 루트와 coding-agent의 빌드 스크립트 일부다. 못 본 것은 다음과 같다. `packages/tui`, `codemode`, `telemetry` 내부. ai의 provider 어댑터 대부분(Anthropic과 OpenAI completions 일부만 읽음). OAuth 흐름 세부. `env/daemon`(Rust)과 `env/src/ssh.ts` 세부. server와 client의 연결 상태 기계. 테스트 스위트. 웹 클라이언트는 모노레포에 없다.

---

## 1. 한눈 요약

1. 안정 경로의 중심은 coding-agent 하나다. 모델 게이트웨이(ai), 루프와 큐(agent-core), 세션과 확장과 도구와 모드(coding-agent)가 세 층으로 쌓인다. MCP는 독립 패키지(mcp)이고 coding-agent의 내장 확장이 쓴다.
2. 루프는 agent-core가 소유한다. 재시도, 자동 컴팩션, 턴 경계 확장 훅은 루프 밖 `AgentSession._runAgentPrompt`(`CA/core/agent-session.ts:1822-1851`)가 맡는다. 확장은 루프를 바꾸지 못하고 훅 지점만 쓴다.
3. 메시지 계약은 ai의 `Message`와 `AssistantMessageEvent`다. 시스템 메시지가 프롬프트와 도구 선언의 변경 이력을 담으므로 transcript를 리플레이하면 현재 상태가 나온다.
4. 세션은 JSONL v3 트리(`id`, `parentId`)다. 분기는 leaf 포인터를 옮기는 것이고, 컴팩션은 원본을 지우지 않고 요약 엔트리를 추가한다.
5. 세션 쓰기는 엔트리마다 `appendFileSync`다. fsync와 파일 잠금이 없다. 짝 없는 도구 호출은 재생 때 "No result provided" 오류로 메운다. 부작용 도구의 결과 불명 상태를 구분하는 장치는 없다.
6. 도구 병렬 실행이 기본이고, 같은 파일을 바꾸는 호출은 realpath 키 큐로 직렬화된다. steering 메시지는 도구 배치가 끝난 뒤 들어간다.
7. 코어에 권한 시스템과 샌드박스가 없다. 승인은 `tool_call` 훅으로 확장이 구현하며, 확장은 같은 프로세스와 같은 OS 권한으로 돈다.
8. OS 추상(ExecutionEnv)은 안정 경로에 없다. 도구는 Node fs와 child_process를 직접 쓴다. 추상은 실험 durable에 있고 env가 원격 구현이다.
9. 프로세스 분리(server, client, protocol, 세션별 worker)는 전부 실험이며 인증이 없다. 안정 경로의 원격화는 RPC(stdin/stdout JSONL) 자식 프로세스 하나뿐이다.
10. 채택 1순위는 mcp 패키지, agent-core 루프 골격, ai의 Provider 계약이다. 세션 형식과 컴팩션은 설계만 참고한다. 확장 시스템 전체와 하위 호환 없는 버전 정책은 피한다.

구조 (실선은 안정, 점선은 실험):

```
coding-agent  (AgentSession · 확장 러너 · 도구 · 모드 · 세션 JSONL · 컴팩션 · 재시도)
 ├── agent-core  (Agent · agentLoop · steering/follow-up 큐 · 도구 파이프라인 · 세션 없음)
 │      └── ai  (Models · Provider · 스트림 이벤트 · 캐시 · 메시지 변환)
 ├── mcp  (독립 MCP 클라이언트: stdio, Streamable HTTP, OAuth)  ← CA/extensions/mcp 가 사용
 ├── tui  (화면, interactive 모드에서만)
 └── ┄ 실험: chord · durable · server · client · protocol · env ┄
```

---

## 2. 층별 표

성숙도 표기: `안정` = 표기와 코드 모두 안정 경로. `실험` = 자기 문서가 실험이라 적음. `예제` = examples 아래. `없음` = 기능 부재.

### 2.1 F 계약

| 층·항목 | 구현 방식 | 근거 | 성숙도 |
|---|---|---|---|
| 메시지 역할 | system, user, assistant, toolResult 4종. system은 `sections`, `toolsAdded`, `toolsRemoved` 보유 | `ai/src/types.ts:541-639` | 안정 |
| 어시스턴트 메시지 | content(text, thinking, toolCall), stopReason 7종, usage, `deferred` 핸들 | `ai/src/types.ts:565-597`, `:469` | 안정 |
| 스트림 이벤트 | `AssistantMessageEvent` 12종. `start` 필수, `done` 또는 `error`로 종결 | `ai/src/types.ts:801-818` | 안정 |
| 에이전트 이벤트 | `AgentEvent` 10종 | `agent/src/types.ts:516-539` | 안정 |
| 확장 메시지 | `CustomAgentMessages` 선언 병합. coding-agent가 bashExecution, custom, branchSummary, compactionSummary 추가 | `agent/src/types.ts:365-374`, `CA/core/messages.ts:29-70` | 안정 |
| 세션 이벤트 | `AgentSessionEvent`: auto_retry_*, compaction_*, queue_update, entry_appended 등 | `CA/core/agent-session.ts:196-240` | 안정 |
| 도구 스키마 | TypeBox 파라미터. 검증 `validateToolArguments` | `ai/src/types.ts:749-754`, `ai/src/utils/validation.ts:317`, `agent/src/types.ts:466-500` | 안정 |
| 세션 파일 | JSONL v3. 헤더 1줄 + id/parentId 엔트리. v1에서 v3로 자동 마이그레이션 | `docs/session-format.md`, `CA/core/session-manager.ts:41, 333-345` | 안정 |
| 확장 이벤트 | 41종 | `CA/core/extensions/types.ts:1569-1636` | 안정 |
| 확장 매니페스트 | `package.json#pi`의 리소스 경로(extensions, skills, prompts, themes). 권한 선언 없음 | `docs/packages.md:48-68` `[기존]` | 안정 |
| RPC 프로토콜 | stdin/stdout JSONL. 명령, 응답, 이벤트 type 리터럴 36종 | `CA/modes/rpc/rpc-types.ts`, `rpc-mode.ts:1-15` | 안정 |
| MCP | JSON-RPC 2.0. 최신 `2025-11-25`, 수용 버전 4개 | `mcp/src/protocol/types.ts:4-9` | 안정(외부 표준) |
| 설정 | TypeBox 스키마와 기본값 객체 | `CA/core/settings-schema.ts`, `CA/core/settings-defaults.ts:1-60` | 안정 |
| 실험 와이어(CBOR) | 프로토콜 버전 8. u32 big-endian 길이 + CBOR, 최대 16MiB | `proto/src/protocol.ts:5`, `proto/src/framing.ts:6-7` | 실험 |
| env 와이어 | 버전 1. 프레임 type 1~6 | `env/docs/protocol.md:3-45` | 실험 |
| 버전 정책 | 1.x lockstep. 하위 호환 약속 없음 | `package.json`, `AGENTS.md:26` | 안정 |

### 2.2 L0 플랫폼

| 층·항목 | 구현 방식 | 근거 | 성숙도 |
|---|---|---|---|
| 셸 선택 | `getShellConfig`가 설정 경로 또는 탐지된 셸을 고름. Windows는 별도 `powershell` 도구 | `CA/utils/shell.ts:67-125` | 안정 |
| 프로세스 종료 | 자식은 detached로 띄움. Unix는 `kill(-pid, SIGKILL)`, Windows는 `taskkill /T /F` | `CA/core/tools/bash.ts:114`, `CA/utils/shell.ts:187-210` | 안정 |
| OS 추상(ExecutionEnv) | 안정 경로에 없음. 도구가 `node:fs`, `child_process`를 직접 씀 | `CA/core/tools/*.ts`, grep `[원문]` | 없음(안정). 추상은 실험 durable |
| 원격 실행 환경 | `RemoteExecutionEnv`가 ExecutionEnv를 SSH 너머 데몬으로 구현 | `env/src/remote-env.ts:351`, `env/src/index.ts` | 실험 |
| 샌드박스 | 코어 없음. 예제가 `@anthropic-ai/sandbox-runtime` 0.0.26으로 bash를 감쌈 | `examples/extensions/sandbox/package.json:17`, `docs/security.md:3-17` | 예제 |
| 비밀 저장 | `auth.json`, 평문 JSON, 모드 0600, 쓰기는 proper-lockfile. 키체인 없음 | `CA/core/auth-storage.ts:25, 52, 128` | 안정 |
| 설정값 해석 | 리터럴, 환경변수 치환, 셸 명령 결과 중 하나. 명령 결과는 프로세스 수명 동안 캐시 | `CA/core/resolve-config-value.ts:1-20` | 안정 |
| 알림, 키체인 | 없음 (grep 0건) | `[원문 grep]` | 없음 |
| 파일 감시 | 안정 경로는 git 브랜치 표시용 감시 정도. 범용 감시는 env(`RemoteWatcher`), durable(`NodeFileWatcher`) | `CA/core/footer-data-provider.ts:183-226`, `durable/src/env/node-watch.ts:139` | 부분 |
| 바이너리 자동 설치 | rg와 fd가 없으면 GitHub 최신 릴리스에서 내려받음. 해시와 서명 검증 없음 | `CA/utils/tools-manager.ts:104-141, 265-267, 349` | 안정(공급망 위험) |
| 프로세스 모델 | 단일 프로세스(TUI, print, json, SDK). RPC는 자식 1개. 실험은 coordinator, server, session-worker | `CA/modes/rpc/rpc-mode.ts:1-15`, `CA/experimental/process.ts:8`, `session-worker-manager.ts:465` | 안정(단일), 실험(다중) |
| 확장 로딩 | jiti로 TS를 직접 import, 모듈 캐시 끔 | `CA/core/extensions/loader.ts:576-581` | 안정 |
| Bun 바이너리 우회 | 샌드박스에서 `process.env`가 비는 문제를 `/proc/self/environ`으로 복구 | `CA/bun/restore-sandbox-env.ts:1-25` | 안정 |

### 2.3 L1 코어

| 층·항목 | 구현 방식 | 근거 | 성숙도 |
|---|---|---|---|
| (a) 동시성 | JS 단일 스레드 + async/await. 도구 병렬은 Promise 배열. 같은 파일 쓰기는 mutation 큐 | `agent/src/agent-loop.ts:586-689`, `CA/core/tools/file-mutation-queue.ts:1-30` | 안정 |
| (a) 큐 | steering, follow-up 두 큐. 모드 `all` 또는 `one-at-a-time`(기본) | `agent/src/agent.ts:143-172, 247-248` | 안정 |
| (a) 취소 | 실행 1회당 AbortController 1개. 도구가 signal을 존중해야 함 | `agent/src/agent.ts:341-343, 507-523` | 안정 |
| (a) 병렬 도구 | 기본 parallel. 도구 하나라도 sequential이면 배치 전체 직렬 | `agent/src/agent-loop.ts:508-529`, `agent/src/agent.ts:253` | 안정 |
| (a) 종료 전파 | 배치 전체가 `terminate:true`면 다음 LLM 호출 없이 종료 | `agent/src/agent-loop.ts:690-692` | 안정 |
| (b) 턴 사이클 | 대기 주입, prepareRequest, 스트림, 도구, finishTurn, turn_end, steering 폴링, follow-up 확인 | `agent/src/agent-loop.ts:163-332` | 안정 |
| (b) 종료 조건 | 도구 없음과 대기 없음 / error·aborted 즉시 / finishTurn이 end / terminate 배치 | `agent/src/agent-loop.ts:245-251, 286-291, 302-313` | 안정 |
| (c) 게이트웨이 | `Models`(인스턴스) → `Provider`(auth, 모델, api 맵) → API 구현 | `ai/src/models.ts:150-250, 992, 1041` | 안정 |
| (c) wire API | 10종. openai-completions, openai-responses, openai-codex-responses, azure-openai-responses, anthropic-messages, bedrock-converse-stream, google-generative-ai, google-vertex, mistral-conversations, pi-messages | `ai/src/types.ts:61-72` | 안정 |
| (c) provider | 42종 | `ai/src/types.ts:87-128` | 안정 |
| (c) 재시도 | HTTP 요청, 어시스턴트 호출(컴팩션 전용), 세션 자동 재시도의 3계층 | `ai/src/utils/provider-retry.ts:107`, `ai/src/utils/retry.ts:191`, `CA/core/agent-session.ts:3709-3807` | 안정 |
| (c) 캐시 | Anthropic은 cache_control을 시스템, 마지막 도구, 마지막 user/system에 붙임. OpenAI는 prompt_cache_key = 세션 ID | `ai/src/api/anthropic-messages.ts:81-93, 1173-1189, 1483-1504, 1608`, `ai/src/api/openai-responses.ts:334` | 안정 |
| (c) 캐시 워밍 | TTL의 90%에서 실제 재요청. 기대 절감 $0.05 미만이면 생략. 최대 60분 | `CA/core/cache-warmer.ts:13-32`, `CA/core/settings-defaults.ts:60` | 안정(비용 발생) |
| (c) 캐시 안전 변경 | 도구와 프롬프트 변경을 시스템 메시지 델타로 기록 | `ai/src/types.ts:527-557`, `agent/src/agent-loop.ts:333-380` | 안정 |
| (c) 지연 응답 | `fetchDeferred`, `cancelDeferred`는 인터페이스만 있고 실제 구현 0건 | `ai/src/types.ts:311-330`, grep `[원문]` | 없음 |
| (c) 모델 간 재생 | `transformMessages`가 서명 정리, 짝 없는 도구 호출 합성, 오류와 중단 턴 제거 | `ai/src/api/transform-messages.ts:64-235` | 안정 |
| (c) 서버 경유 스트림 | `streamProxy`가 서버에서 인증을 쥐고 LLM 호출, 이벤트에서 partial 제거 | `agent/src/proxy.ts:1-30, 107` | 안정 |
| (d) 등록 | ToolDefinition: 스키마, execute, executionMode, prepareArguments, annotations, 노출 설정 | `CA/core/extensions/types.ts:574-651` | 안정 |
| (d) 노출 | direct, model-only, codemode, deferred, hidden 5종. 선언과 호출 가능성을 분리 | `CA/core/extensions/types.ts:505-516` | 안정 |
| (d) 파이프라인 | 찾기, prepareArguments, 검증, beforeToolCall, execute, afterToolCall, 결과 메시지. 예외는 전부 오류 결과 | `agent/src/agent-loop.ts:708-778, 821-911` | 안정 |
| (d) 권한 | 코어에 없음. `tool_call` 훅과 annotations 힌트뿐 | `docs/security.md:3`, `CA/core/extensions/types.ts:522-531` | 없음(코어) |
| (e) 조립 | AgentMessage → 확장 context 훅, transformContext → convertToLlm → normalizeContext | `agent/src/agent-loop.ts:381-395`, `CA/core/sdk.ts:436-440` | 안정 |
| (e) 시스템 프롬프트 | 기본 프롬프트 + 컨텍스트 파일(AGENTS.md, CLAUDE.md 등) + SYSTEM.md + 스킬 목록 | `CA/core/resource-loader.ts:185, 1214-1228`, `CA/core/skills.ts:358-385` | 안정 |
| (e) 컴팩션 | 임계 contextTokens > window − reserve(16,384). 보존 keepRecentTokens(20,000). 요약은 구조화 템플릿, 이전 요약 증분 갱신 | `CA/core/compaction/compaction.ts:126-130, 267-270, 446-500, 507-580` | 안정 |
| (f) 세션 형식 | JSONL v3. 엔트리 11종 이상, id/parentId 트리 | `docs/session-format.md`, `CA/core/session-manager.ts:57-190` | 안정 |
| (f) 기록 시점 | message_end에서만 기록. 스트리밍 중간 상태는 기록하지 않음 | `CA/core/agent-session.ts:1144-1169` | 안정 |
| (f) 내구성 | 엔트리마다 appendFileSync. fsync와 세션 파일 잠금 없음 | `CA/core/session-manager.ts:1173-1189` | 안정(약함) |
| (f) 읽기 | 잘못된 줄은 조용히 버림. 잘린 끝 줄은 개행으로 보정 | `CA/core/session-manager.ts:616-669` | 안정 |
| (f) 분기 | 같은 파일 안 leaf 이동, 요약 엔트리 추가, 새 파일로 복사 | `CA/core/session-manager.ts:1579-1630, 1632, 1815` | 안정 |
| (f) 결과 불명 | 구분 장치 없음. 재생 때 "No result provided" 합성 결과 | `ai/src/api/transform-messages.ts:166-186` | 없음(부작용 도구) |
| (g) 서브에이전트 | 코어에 없음. 예제가 자식 pi 프로세스를 띄움 | `examples/extensions/subagent/index.ts:346` | 예제 |

### 2.4 L2 능력

| 층·항목 | 구현 방식 | 근거 | 성숙도 |
|---|---|---|---|
| 내장 도구 8종 | read, bash, powershell(Windows), edit, write, grep, find, ls | `CA/core/tools/index.ts:96-106` | 안정 |
| 출력 잘림 | 2,000줄 또는 50KB 중 먼저 닿는 쪽 | `CA/core/tools/truncate.ts:11-12` | 안정 |
| edit | 정확 일치 후 퍼지 일치(후행 공백, NFKC, 따옴표와 대시 정규화) | `CA/core/tools/edit-diff.ts:34-40, 207-220` | 안정 |
| bash | 초 단위 시간 제한(상한 있음), 프로세스 트리 종료 | `CA/core/tools/bash.ts:27-37` | 안정 |
| grep, find | ripgrep, fd 호출. 없으면 자동 설치 | `CA/core/tools/grep.ts:119` | 안정 |
| 웹 fetch·검색 | 없음 (grep 0건) | `[원문 grep]` | 없음 |
| 장기 메모리 | 없음 (grep 0건) | `[원문 grep]` | 없음 |
| MCP 브리지 | 내장 확장이 mcp 패키지 사용. 이름 `mcp__<server>__<tool>`. 기본 노출 codemode | `CA/extensions/mcp/`, `docs/mcp.md:189-200` | 안정 |
| 코드모드 | 모델이 JS를 쓰고 주입된 도구만 호출. 패키지는 범위 밖 | `CA/extensions/codemode/` | 안정 |
| tool search | deferred 도구 검색. 기본 비활성 | `CA/extensions/tool-search/index.ts` | 안정 |
| 스킬 | SKILL.md. 목록(이름, 설명)만 프롬프트에, 본문은 read로 로드. `disable-model-invocation` | `CA/core/skills.ts:70, 341, 358-385` | 안정 |
| 템플릿, 패키지 | `prompts/*.md` → `/name`. `pi install`로 npm, git, 경로 설치, 버전 핀 | `docs/prompt-templates.md`, `docs/packages.md` `[기존]` | 안정 |

### 2.5 확장 지점 (강제 수준 5단계)

| 수준 | 가능한 개입 | 이벤트·API 예 | 근거 |
|---|---|---|---|
| 1 관찰 | 수신만 | message_*, turn_*, agent_start/end, tool_execution_*, provider_stream_event | `CA/core/extensions/types.ts:1377-1409` |
| 2 차단 | 거부, 종료 차단, 대체 | tool_call(block), user_bash(대체, fail-closed), session_before_*(cancel), project_trust | `CA/core/extensions/runner.ts:1089-1119, 1242-1296` |
| 3 형성 | 컨텍스트, 도구 노출, 모델 | before_agent_start(systemPrompt), context, before_provider_request, tool_result, registerTool, setActiveTools, registerProvider | `types.ts:1415-1500, 1643, 1750, 1830`, `runner.ts:1183-1240, 1298-1330, 1361, 1420-1472` |
| 4 주입 | 안전 지점에 메시지나 엔트리 삽입 | sendMessage(deliverAs: steer, followUp, nextTurn), sendUserMessage, appendEntry, agent_before_settle의 continue | `types.ts:1703-1719`, `runner.ts:1029-1087`, `agent-session.ts:1196-1199` |
| 5 구동 | 확장이 루프를 함수로 호출해 흐름 진행 | 안정 API에 없음. 명령 컨텍스트의 newSession, fork, navigateTree가 가장 가까움 | `types.ts:401-440` |

---

## 3. 층별 상세

### 3.1 F 계약

**메시지 모델.** ai의 `Context`는 `systemPrompt`, `messages`, `tools`를 받는 입력 형식이다. `normalizeContext`가 이를 `TranscriptContext`로 바꾸고, provider 코드는 이것만 받는다 (`ai/src/types.ts:766-799`). 시스템 메시지는 `content`(기본 프롬프트), `sections`(이름 붙은 조각, `null`로 제거), `toolsAdded`, `toolsRemoved`를 가진다 (`ai/src/types.ts:541-557`). 주석은 "모든 system 메시지를 순서대로 리플레이하면 현재 프롬프트와 도구가 나온다"고 적는다 (`:527-540`). transcript 자체가 프롬프트와 도구 선언의 버전 이력이다.

**스트림 이벤트.** `AssistantMessageEvent` 12종은 start, text, thinking, toolcall의 start, delta, end, 그리고 done과 error다 (`ai/src/types.ts:801-818`). 델타마다 `partial`을 싣는데 이것은 공유 참조이며 이벤트 시점의 스냅샷이 아니라고 주석이 밝힌다 (`:785-799`). 오류는 예외가 아니라 `stopReason: "error"` 메시지로 흐른다. 단 `streamSimple`은 인증 정보가 없으면 동기로 throw한다 (`:785-799`).

**에이전트 계층.** `AgentMessage`는 `Message`에 `CustomAgentMessages`를 선언 병합한 것이다 (`agent/src/types.ts:365-374`). `AgentTool`은 ai의 `Tool`을 확장하며 `execute(id, params, signal, onUpdate)`와 `executionMode`를 가진다 (`agent/src/types.ts:466-500`).

**세션 파일.** 첫 줄은 헤더(`type:"session"`, `version:3`, `id`, `timestamp`, `cwd`, 선택 `parentSession`)다. 나머지 엔트리는 `id`, `parentId`, `timestamp`를 가진다 (`docs/session-format.md:49-76`). 경로는 `~/.pi/agent/sessions/--<cwd>--/<timestamp>_<id>.jsonl`이다 (`docs/session-format.md:8-14`).

**버전 정책.** 전 패키지가 1.1.0으로 묶인다. `AGENTS.md:26`은 하위 호환을 유지하지 말라고 명시한다. CHANGELOG의 Breaking 절은 coding-agent 50, ai 27, agent 13이다 `[원문 grep]`.

### 3.2 L0 플랫폼

**셸과 프로세스.** `getShellConfig`(`CA/utils/shell.ts:67`)가 셸 경로를 고른다. Windows는 `getPowerShellConfig`(`:125`)로 별도 `powershell` 도구를 쓴다. bash 도구는 자식을 detached로 띄운다(`CA/core/tools/bash.ts:114`). 종료는 `killProcessTree`가 맡는다. Unix는 `process.kill(-pid, "SIGKILL")`로 그룹 전체를 즉시 죽이고, Windows는 System32의 `taskkill /F /T`를 쓴다 (`CA/utils/shell.ts:187-210`). graceful 단계가 없다. 같은 저장소의 mcp stdio는 SIGTERM 후 2초 뒤 SIGKILL을 쓴다 (`mcp/src/transports/stdio.ts:9-49`). 두 패키지의 종료 정책이 다르다.

**OS 추상.** 안정 경로에는 추상 계층이 없다. 읽기, 쓰기, 편집, 검색, bash 도구가 `node:fs`와 `child_process`를 직접 import한다 `[원문 grep]`. `process.platform` 분기는 13곳쯤 흩어져 있다. 추상은 실험 durable의 `ExecutionEnv` 인터페이스(`durable/src/env/index.ts:33-141`)와 `NodeExecutionEnv`(`durable/src/env/node.ts:603`)다. env의 `RemoteExecutionEnv`(`env/src/remote-env.ts:351`)는 같은 인터페이스를 SSH 너머 데몬으로 구현한다. `env/docs/semantics.md:6-20`은 원격 결과가 로컬 `NodeExecutionEnv`와 같아야 한다고 정하고, 경로 해석, 오류 코드 매핑, 쓰기 분할, 줄 읽기의 책임을 클라이언트와 데몬에 나눈다.

**샌드박스.** 코어에 없다. `docs/security.md:7-17`은 격리를 사용자의 컨테이너나 VM에 맡긴다고 쓴다. 예제 확장은 `@anthropic-ai/sandbox-runtime` 0.0.26으로 bash를 감싼다(`examples/extensions/sandbox/package.json:17`).

**비밀.** `auth.json`은 평문 JSON이다. 파일은 0600, 디렉터리는 0700으로 만든다 (`CA/core/auth-storage.ts:25, 52-59`). 쓰기는 proper-lockfile로 잠그고 stale 기준은 30초다 (`:120-130`). 키체인 연동은 없다 `[원문 grep]`. 설정값에는 `!명령` 형식으로 셸 명령을 넣을 수 있다 (`CA/core/resolve-config-value.ts:1-20`).

**자동 설치되는 바이너리.** `ensureTool`(`CA/utils/tools-manager.ts:349`)은 rg와 fd가 PATH에 없으면 GitHub 릴리스를 내려받는다. 최신 버전은 릴리스 페이지 리다이렉트로 알아낸다 (`:104-141`). fd의 darwin/x64만 10.3.0으로 고정된다 (`:265-267`). 해시나 서명 검사는 없다 `[원문 grep]`.

**프로세스 경계.** 기본은 단일 프로세스다. RPC는 stdin/stdout JSONL로 한 클라이언트를 받는 자식 프로세스다 (`CA/modes/rpc/rpc-mode.ts:1-15`). 실험 모드는 coordinator, server, session-worker 세 역할을 자식 프로세스로 띄운다 (`CA/experimental/process.ts:8`). 세션마다 worker가 생긴다 (`session-worker-manager.ts:465`).

**확장 로딩.** jiti로 TS를 직접 import하고 모듈 캐시를 끈다 (`CA/core/extensions/loader.ts:576-581`). 확장 팩토리 함수는 캐시되지만 세션마다 다시 실행된다 `[기존]`.

**Bun 바이너리.** `CA/bun/restore-sandbox-env.ts:1-25`는 Bun 컴파일 바이너리가 샌드박스에서 `process.env`를 비우는 문제를 `/proc/self/environ`으로 복구한다. 바이너리 배포에서 생기는 런타임 종속 이슈다.

### 3.3 L1-a 태스크 엔진과 동시성

**모델.** 단일 스레드 이벤트 루프 위의 async/await다. 워커 스레드와 백그라운드 잡 큐는 없다. 도구 병렬 실행은 `Promise.all`이다 (`agent/src/agent-loop.ts:586-689`). 순서는 다음과 같다. 호출을 순서대로 preflight(인자 준비, 검증, beforeToolCall)하고, 통과한 호출을 지연 실행 함수로 만들어 동시에 돌린다. `tool_execution_end`는 끝나는 순서로 나가고, 도구 결과 메시지는 어시스턴트 메시지의 원래 순서로 나간다 (`agent/src/types.ts:317` 주석). preflight를 순차로 두는 이유는 확장 훅이 형제 호출을 가정하지 않게 하기 위해서다 `[기존]`.

**파일 쓰기 직렬화.** `file-mutation-queue.ts`는 realpath를 키로 삼는 Promise 큐다. 같은 파일을 바꾸는 호출은 줄을 서고 다른 파일은 병렬로 돈다 (`CA/core/tools/file-mutation-queue.ts:1-30`). 심볼릭 링크도 같은 키가 된다.

**큐 두 개.** `PendingMessageQueue`(`agent/src/agent.ts:143-172`)가 steering과 follow-up에 하나씩 있다. 기본 모드는 둘 다 `one-at-a-time`이다 (`agent.ts:247-248`).
- steering은 현재 어시스턴트 메시지의 도구 호출이 모두 끝난 뒤, 다음 LLM 호출 직전에 들어간다. 실행 중인 도구를 끊지 않는다 (`agent/src/types.ts:283-292`).
- follow-up은 에이전트가 멈추려 할 때 들어가서 새 턴을 연다 (`agent/src/types.ts:296-306`).
- 세션은 UI 표시용 문자열 배열을 Agent 큐와 따로 둔다 (`CA/core/agent-session.ts:2238-2266`). 사용자 메시지 시작 이벤트에서 텍스트 일치로 지운다 (`:1120-1137`). 같은 텍스트가 둘 있으면 불일치가 생길 수 있다 `[추측]`.

**취소.** 실행마다 AbortController 하나가 생기고 `abort()`가 그것을 끊는다 (`agent.ts:341-343, 507-523`). 도구는 signal을 존중해야 한다. 루프 쪽 처리는 다음과 같다. 직렬 모드는 현재 도구가 끝나면 `break`하고 남은 호출에는 결과 메시지가 없다 (`agent-loop.ts:575-577`). 병렬 모드는 시작 전 호출을 "Operation aborted" 오류 결과로 바꾸고 (`:613-626`), preflight 중 중단되면 이후 호출을 실행 목록에 넣지 않는다 (`:641`). 결과가 없는 호출은 재생 때 합성 결과로 메워진다(3.8).

**종료 전파.** 배치의 모든 결과에 `terminate:true`가 붙으면 다음 LLM 호출 없이 턴을 끝낸다 (`agent-loop.ts:690-692`). 도구가 "더 할 일 없음"을 직접 선언하는 장치다.

**백그라운드 작업.** 없다. bash는 자식 PID를 추적해 종료 때 정리할 뿐이다 (`CA/utils/shell.ts:169-186`).

### 3.4 L1-b 에이전트 루프

**두 겹.** 저수준 `runAgentLoop`(`agent/src/agent-loop.ts:102`)은 스냅샷 컨텍스트를 받는 루프다. 상태, 큐, 구독은 `Agent` 클래스가 맡는다. `Agent`는 실행마다 메시지 배열을 복사해 넘기고 (`agent.ts:460-465`), 루프가 복사본을 바꾸는 동안 Agent 상태는 `message_end`를 처리할 때만 바뀐다 (`agent.ts:565-580`).

**runLoop의 한 턴 (`agent-loop.ts:163-332`).**
1. `prepareNextTurn` 훅이 컨텍스트, 모델, 사고 수준을 바꿀 수 있다. 그동안 쌓인 steering을 다시 확인한다 (`:186-210`).
2. 대기 메시지를 컨텍스트에 넣는다. 도구 목록이 바뀌었으면 시스템 메시지 델타를 만든다 (`:213-218`, `:333-380`).
3. `prepareRequest` 훅이 LLM 호출 직전에 설정을 바꿀 수 있다 (`:219-233`).
4. 스트림을 소비한다 (`:381-477`). error나 aborted면 `finishTurn`을 부르고 `agent_end`로 끝낸다 (`:245-251`).
5. 도구 호출이 있으면 `length` 정지는 모든 호출을 오류 처리하고, 그 밖에는 실행한다 (`:478-529`). 배치가 terminate면 `hasMoreToolCalls`를 끈다 (`:272`).
6. `finishTurn`이 end나 continue를 돌려줄 수 있다 (`:286-291`). `turn_end`를 내보내고 steering을 다시 폴링한다 (`:295-299`).
7. 안쪽 루프가 끝나면 follow-up을 확인한다 (`:302-313`).

continue를 돌려주면 다음 요청이 최소 한 번 보장된다 (`agent/src/types.ts:257-262`).

**스트림 처리.** `start`에서 부분 메시지를 컨텍스트 끝에 넣고, 델타마다 그 자리를 새 partial로 바꾼다. `message_update`에는 얕은 복사본을 싣는다. `done`이나 `error`에서 최종 메시지로 확정한다 (`agent-loop.ts:381-477`).

**리스너 실행.** `Agent.processEvents`는 구독 리스너를 `await`로 하나씩 기다린다 (`agent.ts:565-611`). 느린 리스너가 루프 전체를 멈춘다. 배압으로 쓸 수 있지만 UI 갱신이 무거우면 병목이 된다 `[추측]`.

**실패 변환.** 루프 바깥에서 던진 예외는 `stopReason: error|aborted` 어시스턴트 메시지로 바꿔 이벤트로 흘린다 (`agent.ts:532-548`).

**세션의 바깥 루프.** 제품 경로는 `AgentSession._runAgentPrompt`(`CA/core/agent-session.ts:1822-1851`)가 `agent.prompt()` 뒤에 다음을 반복한다. `_handlePostAgentRun`(`:1853-1891`)이 재시도 준비, 컴팩션, 큐 확인을 하고, `_runBeforeSettleBoundary`(`:1893-1916`)가 `agent_before_settle` 확장 훅을 돌리며, `agent.continue()`로 다시 들어간다. 재시도, 자동 컴팩션, 확장의 턴 경계 주입이 루프 밖에서 일어난다.

### 3.5 L1-c 모델 게이트웨이

**계층.** `Models`는 인스턴스다. 전역 레지스트리는 `compat` 하위 경로로 밀려났다고 ai의 `index.ts` 주석에 적혀 있다 (`ai/src/index.ts:4-8`). `Models`가 카탈로그, 인증 해석, 요청 변환을 맡고 (`ai/src/models.ts:250-360, 880-916`), `Provider`는 id, auth, 모델 목록, `api` 맵 또는 단일 `ProviderStreams`를 가진다 (`ai/src/models.ts:150-250`). `createProvider`가 조립한다 (`:1041-1100`). API 구현은 `lazyApi`로 감싸 첫 사용 때 불러오고, 스트림은 설정 단계를 기다리는 동안에도 즉시 돌려준다 (`ai/src/api/lazy.ts:46-75`).

**wire API와 provider.** wire API 10종과 provider 42종이 있다 (`ai/src/types.ts:61-72, 87-128`). 같은 wire API를 여러 provider가 쓴다. `pi-messages`는 pi의 스트림 프로토콜이다. 단일 POST로 `{model, context, options}`를 보내고 SSE로 직렬화된 이벤트를 받는다 (`ai/src/api/pi-messages.ts:1-12`). Radius 게이트웨이가 이 프로토콜을 쓴다.

**스트림 객체.** `EventStream`은 FIFO 큐와 최종 결과 Promise를 가진 비동기 이터레이터다 (`ai/src/utils/event-stream.ts:26-96`). `AssistantMessageEventStream`은 `result()`로 최종 메시지를 기다린다 (`:97-132`).

**재시도 3계층.**
1. HTTP 요청: `retryProviderRequest`(`ai/src/utils/provider-retry.ts:107-125`)가 지수 백오프로 다시 요청하고 `retry-after-ms`와 `retry-after`를 존중한다 (`:53-60`). Anthropic 어댑터는 SDK의 재시도를 끄고 이것을 쓴다 (`ai/src/api/anthropic-messages.ts:649-655`).
2. 어시스턴트 호출: `retryAssistantCall`(`ai/src/utils/retry.ts:191-250`)은 현재 컴팩션 요약 호출에만 쓰인다 (`CA/core/compaction/compaction.ts:614-638`).
3. 세션 자동 재시도: `_isRetryableError`(`CA/core/agent-session.ts:3709`), `_prepareRetry`(`:3762`), `abortRetry`(`:3807`). 기본값은 `maxRetries` 3, `baseDelayMs` 2000, `maxRetryDelayMs` 60000이다 (`CA/core/settings-defaults.ts:18-23`). 이벤트는 `auto_retry_start`, `auto_retry_end`다.

재시도 가능 판정은 정규식 두 개다. 쿼터, 청구, 구독 한도 패턴이 먼저 거부하고, 과부하, 429, 5xx, 네트워크 패턴이 허용한다 (`ai/src/utils/retry.ts:1-60, 252-257`). 공급자 문구가 바뀌면 판정이 틀어진다 `[추측]`. 구조화된 오류 코드를 우선하는 편이 낫다.

컨텍스트 초과는 `isContextOverflow`가 provider별 패턴과 사용량으로 판정한다 (`ai/src/utils/overflow.ts:137-188`). 초과가 나면 컴팩션 후 같은 턴을 이어 간다 (`CA/core/agent-session.ts:3003-3009`).

**프롬프트 캐시.** Anthropic은 `cacheControl` 하나를 시스템 블록, 마지막 도구, 마지막 user 또는 system 메시지에 붙인다. TTL 1시간은 retention이 `long`이고 모델이 지원할 때만 쓴다 (`ai/src/api/anthropic-messages.ts:81-93, 1173-1189, 1483-1504, 1608`). OpenAI 계열은 `prompt_cache_key`에 세션 ID를 넣는다 (`openai-responses.ts:334`, `openai-completions.ts:826-831`). retention은 `none`, `short`(기본), `long`이고 환경변수 `PI_CACHE_RETENTION`으로도 정한다 (`anthropic-messages.ts:69-78`). 캐시 읽기와 쓰기 토큰은 usage와 비용에 따로 적힌다 (`ai/src/api/openai-completions.ts:1531-1556`).

**캐시 워밍.** `CA/core/cache-warmer.ts`는 TTL의 90%(최소 10초 여유)에서 같은 요청을 실제로 다시 보낸다 (`:28-32`). 기대 절감이 $0.05 미만이거나 마지막 요청 뒤 60분을 넘으면 멈춘다 (`:13-25`). 유휴 상태에서는 다음 요청이 올 확률을 상수 0.15로 잡는다 (`:20-25`). 기본 모드는 `streaming`이다 (`CA/core/settings-defaults.ts:60`). 돈이 드는 장치다.

**캐시 안전한 변경.** 도구 목록이 바뀌어도 앞부분을 다시 쓰지 않도록 변경을 시스템 메시지 델타로 transcript 끝에 쓴다 (`ai/src/types.ts:541-557`, `agent/src/agent-loop.ts:333-380`). Anthropic은 지원 모델에서 `inline-tools-2026-09-15` 베타의 블록으로 보낸다(`ai/README.md`의 mid-conversation 절).

**모델 간 재생.** `transformMessages`(`ai/src/api/transform-messages.ts:64-235`)는 다른 provider의 thinking 서명을 정리하고, 오류와 중단 턴을 건너뛰며, 짝 없는 도구 호출에 합성 결과를 넣는다 (`:166-186`, `:201-205`).

**Anthropic OAuth 토큰 처리 (채택 금지).** `sk-ant-oat` 접두의 OAuth 토큰이면 도구 이름을 Claude Code 표기(Read, Write, Edit, Bash, TodoWrite 등 17개)로 바꿔 보내고 응답에서 되돌린다 (`ai/src/api/anthropic-messages.ts:95-125, 978-979, 1014-1033, 727`). 벤더가 공개하지 않은 동작을 흉내 내는 코드다. 4.3에서 다룬다.

**미구현과 비용.** `fetchDeferred`와 `cancelDeferred`는 인터페이스만 있고, 실제 provider 어댑터는 구현하지 않는다 (`ai/src/types.ts:311-330`, grep `[원문]`). `assistant-message-frame.ts`는 스트림 인코더인데 모노레포 안에서 호출하는 곳이 없다 `[원문 grep]`. Anthropic 어댑터는 tool 인자 델타가 올 때마다 누적 JSON 전체를 다시 파싱한다 (`anthropic-messages.ts:764-770`, `ai/src/utils/json-parse.ts:104`). 인자가 길면 비용이 제곱으로 늘어난다 `[추측]`.

### 3.6 L1-d 도구 디스패치와 권한

**등록.** `ToolDefinition`은 name, label, description, TypeBox parameters, execute(id, params, signal, onUpdate, ctx), renderCall과 renderResult, promptSnippet, executionMode, prepareArguments, annotations, namespace, defaultActive, prepareLoadout을 가진다 (`CA/core/extensions/types.ts:574-651`). 같은 이름이면 나중 등록이 이긴다 (`CA/core/agent-session.ts:3558-3564`).

**노출 5종.** `direct`는 활성이면 선언되고 호출된다. `model-only`는 선언만 되고 직접 호출은 안 된다. `codemode`는 코드모드 스크립트에서만 호출되고 모델에는 선언되지 않는다. `deferred`는 코드모드와 같되 tool search로만 찾는다. `hidden`은 등록만 된다 (`CA/core/extensions/types.ts:505-516`). 선언과 호출 가능성을 나눈 것이 핵심이다. `prepareLoadout`은 도구가 다른 도구의 설명을 조정하게 한다 (`:547-570`).

**파이프라인 (`agent-loop.ts:708-911`).** 이름으로 찾는다. 없으면 "Tool X not found" 오류다. `prepareArguments`와 TypeBox 검증을 한다. `beforeToolCall`이 `block: true`면 오류 결과로 끝난다. 중단 신호를 확인한 뒤 `execute`를 부른다. `afterToolCall`은 content, details, isError, usage, terminate 중 준 것만 교체하고 깊은 병합은 하지 않는다. 예외는 모두 오류 결과가 되어 루프는 죽지 않는다.

**세션 쪽 훅.** `AgentSession`은 `beforeToolCall`과 `afterToolCall`을 확장의 `tool_call`과 `tool_result`에 연결한다 (`CA/core/agent-session.ts:652-728`). 이미지 정규화는 확장 훅 뒤에 한다 (`:684-728` 주석).

**권한.** 코어에 없다. `docs/security.md:3`은 "does not ask for approval before every tool call"라고 적는다 `[원문]`. 승인은 확장 몫이다. 예제 `permission-gate.ts`는 `tool_call`에서 `ctx.ui.confirm`을 부르고 block을 돌려준다 `[기존]`. annotations(readOnlyHint, destructiveHint, idempotentHint, openWorldHint)는 힌트일 뿐 강제력이 없다 (`CA/core/extensions/types.ts:522-531`).

**훅 실패 정책.** 두 가지가 공존한다.
- 일반 이벤트는 핸들러 예외를 잡아 기록하고 다음 핸들러로 간다. fail-open이다 (`CA/core/extensions/runner.ts:1089-1119`).
- `tool_call`은 `emitToolCall`에 try-catch가 없어 예외가 올라가고 도구가 실행되지 않는다. fail-closed다 (`runner.ts:1242-1260`, `agent-session.ts:658-682`). `user_bash`도 fail-closed다 (`runner.ts:1262-1296`).

**중첩 호출.** `ctx.executeTool`은 같은 파이프라인을 다시 타고 호출자의 ID를 `parentToolCallId`로 남긴다 (`CA/core/nested-tool-calls.ts:1-12`, `CA/core/agent-session.ts:730-766`). 코드모드가 이 경로를 쓴다.

**실행 모드.** 기본은 병렬이다. 도구 하나가 `executionMode: "sequential"`이면 배치 전체가 직렬이 된다 (`agent-loop.ts:508-521`).

### 3.7 L1-e 컨텍스트 조립과 컴팩션

**조립.** `AgentMessage[]`는 확장 `context` 체인과 `transformContext`를 거치고, `convertToLlm`으로 Message가 된 뒤 `normalizeContext`에서 `systemPrompt`와 `tools`가 leading system 메시지로 접힌다 (`agent/src/agent-loop.ts:381-395`, `CA/core/sdk.ts:436-440`, `ai/src/types.ts:766-778`). `convertToLlm`은 던지면 안 된다고 명시되어 있다 (`agent/src/types.ts:213-222`).

**시스템 프롬프트.** 기본 프롬프트에 컨텍스트 파일(`AGENTS.override.md`, `AGENTS.md`, `CLAUDE.md` 등, `CA/core/resource-loader.ts:185`), 프로젝트와 전역의 `SYSTEM.md`와 `APPEND_SYSTEM.md`(`:1214-1228`), 스킬 목록(`CA/core/skills.ts:358-385`)을 더한다. 확장의 `before_agent_start`는 `systemPrompt`로 전체를 바꿀 수 있다 (`CA/core/extensions/types.ts:1466-1472`).

**임계와 보존.** `shouldCompact`는 `contextTokens > contextWindow - reserveTokens`일 때 참이다 (`CA/core/compaction/compaction.ts:267-270`). 기본값은 reserveTokens 16,384, keepRecentTokens 20,000이다 (`compaction.ts:126-130`, `CA/core/settings-defaults.ts:9-11`).

**토큰 추정.** 마지막 유효 어시스턴트 usage에 뒤쪽 메시지의 추정치를 더한다 (`compaction.ts:196-226`). 추정은 문자 수를 4로 나누는 방식이다 (`:298-312`). aborted, error, 전부 0인 usage는 제외한다 (`:144-163`).

**컷 지점과 분할 턴.** 최신 메시지에서 거꾸로 keepRecentTokens를 채운다. 유효한 컷은 턴 경계다 (`compaction.ts:446-500`). 턴 중간이면 `isSplitTurn`이 되고, 턴 앞부분과 나머지를 따로 요약한 뒤 합친다 (`compact()`, `:965` 이후) `[원문 읽기]`.

**요약 형식.** 시스템 프롬프트는 "another LLM will use to continue the work"라는 목적을 적고 Goal, Constraints & Preferences, Progress(Done, In Progress, Blocked), Key Decisions, Next Steps, Critical Context를 요구한다 (`compaction.ts:507-575`). 이전 요약이 있으면 `UPDATE_SUMMARIZATION_PROMPT`(`:577`)로 새 메시지만 통합한다. 읽은 파일과 수정한 파일 목록은 `details`에 남는다 (`docs/session-format.md`의 CompactionEntry 절).

**자동 실행.** `_checkCompaction`(`CA/core/agent-session.ts:2947-3096`)이 턴 끝마다 임계를 보고 `_runAutoCompaction`(`:3097`)이 실행한다.

**저장과 편집.** 컴팩션은 `compaction` 엔트리를 추가한다. 요약, 필수 `firstKeptEntryId`, `tokensBefore`, 선택적 `systemMessage`(프롬프트와 도구 체크포인트)를 가지며 원본 엔트리는 남는다 (`docs/session-format.md:123-137, 224-249`). `context_edit` 엔트리는 과거 엔트리를 컨텍스트에서 빼거나 바꾸지만 원본은 그대로다. 분기를 되돌아가면 원래 내용이 다시 보인다 (`docs/session-format.md:139-147`).

### 3.8 L1-f 세션 영속

**형식과 기록 시점.** 헤더 한 줄 뒤에 엔트리가 온다. 엔트리는 `id`(기본 8자 16진수), `parentId`, ISO `timestamp`를 가진다 (`docs/session-format.md:49-60`). 기록은 `message_end` 이벤트에서만 일어난다 (`CA/core/agent-session.ts:1144-1169`). 스트리밍 중간 상태와 도구 진행 상태는 쓰지 않는다. 확장의 `appendEntry`는 즉시 기록되고 `entry_appended`를 낸다 (`CA/core/session-manager.ts:1290`).

**파일 생성 시점.** 사용자나 어시스턴트 메시지가 생길 때까지 파일을 만들지 않는다 (`CA/core/session-manager.ts:1160-1171`). 첫 기록은 `wx`로 파일을 만들고 메모리의 엔트리를 모두 쓴다 (`:1173-1189`).

**내구성.** 이후 엔트리는 `appendFileSync`로 한 줄씩 붙는다 (`:1187`). 세션 쓰기 경로에 fsync가 없다. 파일 잠금도 없다. proper-lockfile은 auth.json, settings, 실험 세션 쪽에서만 쓴다 `[원문 grep]`. 두 프로세스가 같은 세션 파일을 쓰는 것을 막는 장치를 찾지 못했다 `[추측: 부재 확인]`. 전원이 나가면 마지막 쓰기는 보장되지 않는다.

**읽기와 손상.** 1MiB 블록으로 읽어 줄을 나누고 (`CA/core/session-manager.ts:604`) 파싱이 안 되는 줄은 조용히 버린다 (`CA/core/session-manager.ts:616-624`). 끝의 잘린 줄은 개행을 덧붙여 보정한다 (`:668`). 첫 엔트리가 헤더가 아니면 빈 세션으로 취급한다 (`:661-666`). 중간 줄이 망가지면 그 엔트리는 경고 없이 사라진다 `[원문 읽기]`.

**트리와 분기.** `branch(id)`는 leaf 포인터만 옮긴다 (`CA/core/session-manager.ts:1579-1584`). `branchWithSummary`는 떠나는 경로의 요약을 같은 파일에 추가한다 (`:1604-1630`). `createBranchedSession`(`:1632`)과 `forkFrom`(`:1815`)은 경로를 새 파일로 복사하고 `parentSession`을 기록한다. 컨텍스트는 현재 leaf에서 루트까지의 경로로 만든다 (`docs/session-format.md:224-249`).

**재개.** `SessionManager.open`(`CA/core/session-manager.ts:1766`)이 파일 전체를 읽는다. 도구 실행 중 크래시를 감지하거나 미완료 목록을 만드는 로직은 없다 `[원문 grep: interrupted, dangling 0건]`.

**짝 없는 도구 호출과 결과 불명.** 재생 때 `transformMessages`가 짝 없는 도구 호출마다 `{role:"toolResult", isError:true, "No result provided"}`를 합성한다 (`ai/src/api/transform-messages.ts:166-186`). 합성 결과는 파일에 쓰지 않는다. 오류나 중단으로 끝난 어시스턴트 턴은 재생에서 통째로 건너뛴다 (`:201-205`). 부작용 도구(쓰기, 셸 명령, 외부 호출)가 실행됐는지 구분하지 않는다. 실행 전 의도 기록이나 재실행 정책도 없다. 모델은 "결과 없음"이라는 오류만 본다 `[원문 읽기]`. Helm 커널 요구와 가장 큰 차이다.

**확장 상태.** `appendEntry(customType, data)`는 LLM 컨텍스트에 들어가지 않는 `custom` 엔트리다. `sendMessage`는 `custom_message`로 컨텍스트에 들어간다 (`CA/core/extensions/types.ts:1703-1719`). 확장은 세션 시작과 트리 이동 때 `getBranch()`를 스캔해 상태를 되살린다 `[기존]`.

**마이그레이션.** 로드 때 v1이나 v2 파일을 v3으로 다시 쓴다 (`CA/core/session-manager.ts:333-345`). 읽기 시점에 파일이 바뀐다.

### 3.9 L1-g 서브에이전트

코어에는 서브에이전트가 없다 `[원문 grep]`. 예제 `examples/extensions/subagent/index.ts:346`은 `spawn`으로 자식 `pi` 프로세스를 띄운다. 격리된 컨텍스트에서 돌고, 에이전트 정의는 마크다운이며, 병렬과 스트리밍을 지원한다 `[기존]`. 인프로세스 중첩은 `ctx.executeTool`과 코드모드뿐이다. 권한 상속, 결과 반환 규약, 실행 위치는 코어가 정하지 않는다. 실험 durable에는 child conversation과 task graph가 있다 `[기존, 이름만]`.

### 3.10 L2 능력

**내장 도구.** `allToolNames`는 read, bash, powershell, edit, write, grep, find, ls다 (`CA/core/tools/index.ts:96-106`). read는 `offset`과 `limit`으로 텍스트를 읽고 이미지 확장자는 첨부로 보낸다 (`read.ts:16-17, 96`). edit은 `edits[]` 배열로 여러 교체를 한 번에 받고, 각 교체는 원본 기준으로 맞춘다 (`CA/core/tools/edit.ts:21-37`). 줄 끝 형식은 보존한다 (`edit-diff.ts:11-25`). bash는 시간 제한과 상한을 가진다 (`bash.ts:27-37`). 웹 fetch와 검색 도구는 없다 `[원문 grep]`.

**MCP 브리지.** 내장 확장 `CA/extensions/mcp`가 mcp 패키지의 `McpClient`를 쓴다. 서버 도구는 `mcp__<server>__<tool>`로 등록되고 노출은 codemode(기본), deferred, direct, hidden 중 하나다 (`docs/mcp.md:189-200`). 권한은 확장 파이프라인을 그대로 지난다 (`docs/mcp.md:250-255`).

**mcp 패키지.** 클라이언트 코어는 transport와 무관하다 (`mcp/src/client.ts:153-170`). 요청은 `pending` Map에 등록되고 타임아웃이 걸린다 (`:162`, `:548-553`). `progress` 알림이 오면 타임아웃을 다시 건다 (`:531-539`). 타임아웃이나 취소 때는 `notifications/cancelled`를 보낸다 (`:556-575`). stdio는 자식 그룹을 관리한다 (`transports/stdio.ts:9-49`). Streamable HTTP는 `Mcp-Session-Id`를 저장하고 404를 세션 만료로 본다 (`transports/streamable-http.ts:312-327`). 종료 때 DELETE를 보낸다 (`:262-270`). SSE가 끊기면 `Last-Event-ID`로 재개하고 (`:362-390`), GET 스트림은 백오프로 재연결한다 (`:412-436`). OAuth 디스커버리와 흐름은 `mcp/src/oauth/`에 있다.

**스킬.** SKILL.md의 name과 description만 시스템 프롬프트 목록에 들어가고, 본문은 모델이 `read`로 로드한다 (`CA/core/skills.ts:358-385`). `disable-model-invocation: true`이면 목록에서 빠진다 (`:70, 341`).

**템플릿과 패키지.** `prompts/*.md`는 `/name`으로 호출되고 `$1` 치환을 쓴다. 패키지는 `pi install npm:|git:|경로`로 설치하며 `package.json#pi` 매니페스트, 리소스별 필터, 버전 핀을 지원한다 `[기존]`.

### 3.11 확장 지점 (강제 수준별 상세)

- **수준 1 관찰.** 이벤트는 `ExtensionEvent` 유니온이다 (`CA/core/extensions/types.ts:1377-1409`). 관찰 전용 이벤트는 결과를 돌려주지 못한다.
- **수준 2 차단.** `tool_call`은 block을 돌려주면 즉시 멈춘다 (`runner.ts:1242-1260`). `session_before_*`는 cancel로 전환, fork, 컴팩션, 트리 이동을 막는다 (`runner.ts:1089-1119`). `user_bash`는 `!명령`을 대체한다 (`runner.ts:1262-1296`).
- **수준 3 형성.** 체인으로 합성된다. `before_agent_start`는 systemPrompt를 바꾸고 (`runner.ts:1420-1472`), `context`는 메시지를 변환하며 (`runner.ts:1298-1330`), `before_provider_request`는 payload를 바꾸고 (`runner.ts:1361`), `tool_result`는 결과를 바꾼다 (`runner.ts:1183-1240`). `registerTool`, `setActiveTools`, `registerProvider`는 등록과 노출을 바꾼다 (`types.ts:1643, 1750, 1830`).
- **수준 4 주입.** `sendMessage(msg, {triggerTurn, deliverAs})`는 `steer`면 steering 큐에, `followUp`이면 follow-up 큐에, `nextTurn`이면 다음 턴 앞에 넣는다 (`types.ts:1703-1708`). `turn_end`는 플러시 지점이다. 컨텍스트 전용 메시지는 도구 결과 뒤, 다음 요청 전에만 들어간다 (`agent-session.ts:1196-1199`). `agent_before_settle`과 `turn_end`는 엔트리를 제안하고 continue할 수 있다 (`runner.ts:1029-1087`).
- **수준 5 구동.** 안정 API에는 없다. 명령 컨텍스트의 `newSession`, `fork`, `navigateTree`, `switchSession`, `reload`가 가장 가깝지만 (`types.ts:401-440`), 루프를 한 턴씩 구동하지는 않는다. 구동은 호스트의 몫이다.
- **켜기와 끄기.** 시작 전에는 설정에서 끈다 (`docs/settings.md:160`, `docs/packages.md:84-98`) `[기존]`. 실행 중 개별 토글은 불가하고 전체 `reload()`만 있다 (`CA/core/agent-session.ts:3660-3697`) `[기존]`. 도구 활성화만 `setActiveTools`로 바꾼다.
- **충돌과 순서.** 도구 이름은 나중 등록이 이긴다 (`agent-session.ts:3558-3564`). 훅 순서는 로드 순서다 (`runner.ts:269-271`). 의존 선언은 없다 `[기존]`.
- **실패 격리.** 팩토리가 던지면 그 확장의 등록을 `discard()`로 버린다 (`CA/core/extensions/loader.ts:542, 627`) `[원문 일부]`. 이벤트 예외는 fail-open이고 `tool_call`과 `user_bash` 예외는 차단이 된다. runner에 시간 제한은 없다 `[기존]`.
- **dispose.** 확장별 해제 훅이 없다. `session_shutdown`으로 사용자가 직접 정리한다 `[기존]`.
- **권한 수준.** 같은 프로세스, 같은 OS 권한이다 (`docs/extensions.md:5` `[원문]`).

---

## 4. 채택 판단

### 4.1 그대로 가져다 쓸 수 있는 것

1. **mcp 패키지** (MIT, 3,244줄, 의존 cross-spawn 하나). 클라이언트 코어, stdio와 Streamable HTTP transport, OAuth를 가진다. transport와 무관한 코어와 transport 어댑터가 나뉘어 있다. 채택 1순위다. 프로토콜 적합성은 원저 테스트를 직접 돌려 확인해야 한다. 이번 조사는 실행하지 않았다.
2. **agent-core 루프 골격** (MIT, 2,519줄, 의존 ai와 typebox). 턴 사이클, steering과 follow-up 큐, 도구 preflight와 병렬 실행, abort 전파가 있다. 세션이 없으므로 Helm 커널 로그와 재개는 따로 붙여야 한다. 리스너를 `await`하는 구조는 비동기 큐로 바꾸는 것이 낫다(3.4).
3. **ai의 계약 타입과 Provider 추상.** `Message`, `AssistantMessageEvent`, `Tool`, `Provider`, `ProviderStreams`는 설계 가치가 높다. provider 어댑터 전체는 무겁다. 의존 SDK가 anthropic, openai, google-genai, bedrock, mistral 등 여럿이다(`ai/package.json`). 패키지 export가 `./providers/*`, `./api/*`, `./utils/*`로 나뉘어 있어 필요한 어댑터만 떼어 쓸 수 있다 `[원문]`. 계약 타입과 한두 어댑터만 가져가는 것이 현실적이다 `[추측]`.
4. **env의 와이어 문서**(실험, `env/docs/protocol.md`, `semantics.md`). 설계 참고 가치가 높다. 5초 ping과 30초 무응답 종료, 취소 등록의 순서 보장, 결과와 이벤트의 큐 우선순위가 명시되어 있다. 코드는 Rust 데몬과 durable 종속이라 가져오지 않는다.

### 4.2 설계만 참고할 것

- **세션 트리와 컴팩션 엔트리.** 원본을 지우지 않고 요약과 `firstKeptEntryId`를 추가하며, 편집도 엔트리로 남긴다 (`docs/session-format.md:123-147`). 커널 로그의 "원본 보존 + 파생 뷰" 설계에 참고할 만하다. 형식 자체는 내구성 때문에 쓰지 않는다(4.3-3).
- **steering과 follow-up 주입 시점.** steering은 도구 배치 뒤에만, follow-up은 멈추려 할 때만 들어간다 (`agent/src/types.ts:283-306`).
- **transcript 안의 도구 델타.** 도구 목록 변경을 시스템 메시지 델타로 기록하면 캐시 접두부가 깨지지 않고 재생 결과도 같다 (`ai/src/types.ts:527-557`).
- **파일 뮤테이션 큐.** realpath를 키로 삼아 같은 파일 쓰기만 직렬화한다 (`file-mutation-queue.ts`).
- **재시도 3계층.** HTTP, 어시스턴트 호출, 세션 자동 재시도를 나눈 구조다. 판정은 정규식 대신 구조화된 오류 코드를 쓰는 편이 낫다 `[추측]`.
- **바깥 드라이버 루프.** 재시도, 컴팩션, 턴 경계 확장을 루프 밖에서 `continue()`로 되돌린다 (`agent-session.ts:1822-1851`).
- **도구 노출 5종.** 선언과 호출 가능성을 나눈 모델 (`types.ts:505-516`). Helm의 도구 가시성 정책에 옮길 만하다.
- **캐시 워머의 비용 계산.** 기대 절감과 최대 수명을 명시한다 (`cache-warmer.ts`). 돈이 드는 장치이므로 기본값을 끄는 것도 검토한다.
- **예외의 흐름 변환.** 루프 안팎의 예외를 `stopReason:error` 메시지로 바꿔 스트림을 끊지 않는다 (`agent.ts:532-548`).

### 4.3 피할 것

1. **확장 시스템 전체 복제.** 이벤트 41종마다 합성 규칙과 실패 정책이 다르다. 체인, 단락, 최초 차단, cancel, fail-open, fail-closed가 섞여 있다 (`runner.ts:1089-1260`). 읽고 검증하는 비용이 크고 타입이 매주 바뀐다(breaking 50건). Helm은 훅을 관찰, 차단, 형성, 주입 네 범주로 줄이고 범주마다 계약을 고정하는 편이 낫다 `[추측]`.
2. **같은 프로세스, 같은 권한의 확장.** 격리도 권한 선언도 없다 (`docs/extensions.md:5`). 탐구나 자가 학습 확장을 신뢰 수준별로 다르게 받으려면 프로세스 경계와 능력 선언이 필요하다.
3. **무 fsync, 무락 세션 쓰기.** 엔트리마다 `appendFileSync`, fsync 없음, 잠금 없음(`session-manager.ts:1173-1189`). 손상된 줄을 경고 없이 버린다(`:616-624`). 커널 로그로는 부족하다.
4. **결과 불명 도구의 합성 복구.** "No result provided" 합성(`transform-messages.ts:166-186`)은 모델에 잘못된 신호를 준다. 셸 명령이나 쓰기가 실제로 실행됐는지 알 수 없다. 부작용 도구에는 재실행이나 확인 정책이 따로 필요하다.
5. **도구 바이너리를 무검증으로 내려받기.** 최신 릴리스 리다이렉트로 버전을 정하고 해시나 서명을 보지 않는다(`CA/utils/tools-manager.ts:104-141`). 고정 버전과 해시 검사를 쓴다.
6. **Anthropic OAuth 토큰에 따른 도구명 위장.** 벤더가 공개하지 않은 식별자를 흉내 내는 코드다 (`anthropic-messages.ts:95-125`). 채택하지 않는다. 벤더 정책 문제가 될 수 있어 검토가 필요하다 `[추측]`.
7. **TUI 컴포넌트 계약.** `ctx.ui.custom`과 렌더러는 TUI 컴포넌트를 돌려준다. 원격과 웹 클라이언트로 옮길 수 없다. RPC에서는 이 호출이 no-op이나 undefined가 된다 `[기존, rpc-mode.ts:174-300]`.
8. **실험 프로세스 계층의 직접 채택.** server, client, protocol은 인증이 없고 (`srv` README, `proto` README:39) 세션 라우팅과 chord 서비스 계약에 묶여 있다. 설계 참고만 한다.
9. **하위 호환 없는 버전 정책.** `AGENTS.md:26`의 방침은 빠른 실험에는 맞지만 외부 플러그인 생태계를 세우는 Helm에는 맞지 않는다.

### 4.4 라이선스와 의존성

- 모든 패키지가 MIT다. Copyright 행을 유지해야 한다.
- ai의 직접 의존 SDK는 `@anthropic-ai/sdk`, `openai`, `@google/genai`, `@aws-sdk/client-bedrock-runtime`, `partial-json`, `typebox`와 프록시 에이전트 2개다 (`ai/package.json`).
- coding-agent에는 네이티브와 WASM 요소가 있다. `@silvia-odwyer/photon-node`(이미지), `quickjs-wasi`(코드모드 샌드박스). 그 밖에 `grok-mermaid`, `highlight.js`, `undici`, `jiti`, `proper-lockfile`이 있다 (`CA/package.json`).
- 공급망 장치로 루트 `check`에 `check:pinned-deps`, `check:runtime-deps`, `check:install-lock:coding-agent`가 있다 (`package.json:20-25`). 이 정책은 Helm 빌드 게이트에 참고할 만하다 `[원문]`.

---

## 5. 이 대상만의 고유 설계

1. **transcript가 상태다.** 프롬프트와 도구 목록의 변경을 시스템 메시지 델타로 쓴다 (`ai/src/types.ts:527-557`). 리플레이 한 번으로 현재 상태가 나오고, 캐시 접두부 보존과 세션 재생 일치를 같은 장치로 얻는다.
2. **노출과 호출 가능성의 분리.** 모델에 보이게 할지, 호출 가능하게 할지, 코드모드로만 쓸지를 따로 정한다 (`types.ts:505-516`).
3. **바깥 드라이버 루프.** 루프는 한 번의 실행만 맡고, 재시도, 컴팩션, 턴 경계 확장은 바깥 루프가 `continue()`로 되돌린다 (`agent-session.ts:1822-1851`).
4. **실패 정책의 이원화.** 일반 확장 훅은 fail-open, 도구 차단과 사용자 bash 대체는 fail-closed다 (`runner.ts:1089-1119`, `1242-1296`).
5. **원본 보존형 컴팩션과 편집.** 컴팩션과 편집을 엔트리 추가로 남기고, 분기마다 다른 뷰가 나온다 (`docs/session-format.md:123-147`).
6. **모델 간 재생 정리.** 같은 transcript를 다른 provider에 넘길 때 서명, 도구 짝, 오류 턴을 정리한다 (`transform-messages.ts`).
7. **돈이 드는 캐시 워머.** 캐시 만료 직전에 실제 요청을 다시 보내 비용을 계산하며 유지한다 (`cache-warmer.ts`).
8. **같은 AgentSession을 네 모드가 쓴다.** TUI, print, RPC, SDK가 하나의 코어를 공유한다. 차이는 확장 UI 계약뿐이다. 그 계약은 직렬화 가능한 요청과 TUI 컴포넌트 factory로 갈린다 `[기존]`.
9. **훅으로만 구현한 권한.** 코어에 권한 모델이 없고 annotations 힌트만 있다. 승인 정책 전부가 확장 코드에 있다.
10. **실험 코드가 안정 바이너리에 들어 있다.** 환경변수로만 열린다(0.1). 채택 시 안정 경계를 빌드 단계에서 나눠야 한다.

---

## 6. 확인 못 한 것과 주의

- 테스트 코드와 테스트 실행은 보지 않았다. "테스트 225개 파일" 같은 수치는 기존 노트 인용이다 `[기존]`.
- provider 어댑터 대부분을 읽지 않았다. Anthropic과 OpenAI completions 일부만 확인했다. 나머지가 같은 계약을 따른다는 것은 가정이다 `[추측]`.
- `packages/tui`, `codemode`, `telemetry` 내부는 보지 않았다.
- OAuth 흐름의 보안 세부, `env/daemon`(Rust), `env/src/ssh.ts`의 호스트 키 처리는 확인하지 않았다.
- server와 client의 연결 상태 기계와 재연결 세부는 확인하지 않았다(`cli/src/client.ts:134`의 `reconnect()`만 봤다).
- 크래시 시나리오를 재현하지 않았다. 3.8과 4.3-3의 내구성 판단은 코드 읽기에 근거한다.
- 이벤트 41종과 breaking 절 수는 이번 측정 기준이다.
- 실행 검증은 하지 않았다. 모든 설계 판단은 읽기 결과다.
- 이 조사는 `helm` 저장소를 바꾸지 않았다. 산출물은 scratchpad의 이 파일 하나다.
