# 07. pi 활용과 포크 계획

- 작성: P4 pi 전문, 2026-10-11 (1단계 초안)
- 상태: 설계 초안. 2단계 통합에서 06·08·09·12·13·15·16·17·18·19·22·23과 맞춘다.
- 함께 읽을 문서: `process/00-design-brief.md`(이하 "브리프"), [06 시스템 아키텍처](06-system-architecture.md), [12 런타임 엔진](12-runtime-engine.md), [13 도구와 실행](13-tools-and-execution.md)
- 표시 규칙: 브리프 §5.2. `[결정 n]`은 브리프 §2의 결정 번호를 근거로 한 것, `[제안]`은 이 문서가 정한 것, `[가정]`은 확인되지 않은 전제다. 외부 사실은 `[원문]`(소스·문서 직접 확인), `[실험]`(이번에 코드를 실행해 확인), `[검색]`, `[지식]`(재확인 안 함)으로 표시한다.
- 출처 줄임말
  - `pi@v1.1.0:<경로>:<행>`: pi 저장소 태그 `v1.1.0`(커밋 `abe508e1b89912adde45528136c3221eb69acdd7`)의 파일. 로컬 클론은 `~/projects/_ref/pi-src`이고, 태그 트리는 `git -C ~/projects/_ref/pi-src show v1.1.0:<경로>`로 본다. 이 문서의 작업 사본은 `.helm-design-work/P4/pi-v1.1.0/`(같은 태그를 `git archive`로 푼 것).
  - `pi@cdaf6c2:<경로>`: 같은 저장소의 `main` 커밋 `cdaf6c2`(브리프 §4의 기준 클론 위치).
  - `pi-facts-1`, `pi-facts-2`: `process/sources/pi-api-facts-1.md`, `-2.md`. 이 두 자료의 행 번호는 `cdaf6c2` 기준이다. §3.1.4에 `v1.1.0`과 행 번호가 다른 파일을 적었다.
  - `cases`: `process/sources/pi-cases-notes.md`. `S4/<사례>`: `.helm-design-work/S4/<사례>.md`.
  - `extracts-N`: `process/sources/conversation-extracts-N.md`. `canon-2`: `process/sources/helm-canon-2.md`. `대화 L<n>`: `docs/handoff/conversation-transcript-until-158.md`의 행.
  - `P4 실험`: `.helm-design-work/P4/`의 실험 코드와 출력(§8.3 목록).

## 1. 목적과 범위

### 1.1 이 문서가 정하는 것

구현자가 이 문서만 보고 pi 코드를 가져와 정리하고, Helm 패키지 경계 뒤에 둘 수 있게 하는 것이 목적이다.

1. 포크 기준과 고정 의존 기준을 하나로 정한다(§3.1).
2. pi 패키지 14개 각각의 활용 방식(가져와 고쳐 쓰기 / 정확한 버전 고정 의존 / 참고만 / 쓰지 않음), 이유, 위험, 재검토 조건, 도입 단계(§3.2).
3. 저장소 안 배치: `vendor/` 디렉터리 구조, 작업 공간 패키지 이름, 컴파일·린트 설정, 의존 고정 방식(§3.3).
4. 파일 단위 계획: 가져올 파일(원본 경로 → Helm 경로), 파일별 수정 사항, 끊을 내부 의존, 새로 쓸 어댑터 코드(§3.4~§3.8).
5. Helm 패키지와의 관계: `@helm/ai`, `@helm/agent`, `@helm/tools`, `@helm/tui`의 pi 쪽 공개 인터페이스(TypeScript)와 pi 타입이 바깥으로 새지 않게 하는 경계(§3.9).
6. Helm이 기대는 pi 동작 계약과 그 테스트(§3.10, §3.19).
7. pi-ai, pi-codemode, pi-mcp, pi-tui의 사용 규칙(§3.11~§3.14).
8. pi 세션·패키지 특성(세션 트리, `context_edit`, 프롬프트 캐시, 버전 고정, MCP `outputSchema`)을 Helm이 어떻게 다루는가(§3.15, 브리프 §3.5).
9. 이후 pi CLI를 런타임 어댑터(RPC)로 붙일 때 pi 쪽 사실(§3.16).
10. 라이선스 고지와 출처 헤더(§3.17), 업스트림 추적과 업그레이드 절차(§3.18).

### 1.2 다루지 않는 것

| 주제 | 소유 문서 |
|---|---|
| 저장소 전체 디렉터리, 패키지 의존 방향, 기술 스택 버전(Node·TypeScript·pnpm), justfile 전체 목록 | 06 |
| 이벤트 이름 카탈로그, envelope, SQLite DDL | 09(P5) |
| 커널 검사 규칙(무엇을 막는가), 거부 분류 | 10(P6) |
| 에이전트 루프 운영(언제 무엇을 시작·중단하는가), 컨텍스트 투영의 내용, 컴팩션, 크래시 복구 알고리즘, 재시도 정책, 스케줄러 | 12(P7) |
| 도구 목록과 이름, 범위 검사 규칙(bash 포함), 격리(샌드박스), 하위 실행, 런타임 어댑터 인터페이스 | 13(P7) |
| REPL 방식 탐구의 운영 규칙(작업 공간, globals 의미) | 15(P9) |
| 외부 에이전트 세션 로그(pi JSONL) 입력 어댑터 | 16(P10) §3.6.3 |
| 비밀 주입, 환경 변수 정리 규칙의 보안 판단, 위협 모델 | 18(P11) |
| 클라이언트 프로토콜(스트리밍 델타 전달 형식 포함) | 19(P12) |

이 문서는 위 문서가 쓰는 pi 코드의 출처, 수정, 경계, 계약을 정하고, 세부 동작은 파일 이름과 절 번호로 참조한다.

### 1.3 용어

| 용어 | 뜻 |
|---|---|
| vendor 포크 | pi 소스 파일을 Helm 저장소 `vendor/` 아래로 복사해 Helm 코드로 소유하고 고쳐 쓰는 방식 |
| 고정 의존 | npm 패키지를 정확한 버전(`1.1.0`, `^` 없이)으로 의존하고 잠금 파일·`overrides`로 한 버전에 묶는 방식. 수정이 필요하면 `pnpm patch`만 쓴다 |
| 참고 | 설계·알고리즘·문구만 읽고 코드는 가져오지 않는 방식 |
| 기준 태그 | 포크와 고정 의존이 함께 따르는 업스트림 버전. 이 문서에서는 `v1.1.0` |
| 패치 ID | 포크 수정 한 묶음의 식별자. `A1`~`A7`(pi-agent-core), `T1`~`T14`(coding-agent 도구·이미지 유틸) |
| `HELM-PATCH` 표지 | 포크 파일 안에서 수정한 자리에 다는 주석 `// HELM-PATCH <ID>: <이유>` |
| 감싸는 패키지 | pi 패키지·vendor 패키지 하나를 import할 수 있는 단 하나의 Helm 패키지(06 §3.4.1, §3.9.1). 그 밖의 Helm 코드는 pi 코드를 import하지 않는다 |

## 2. 전제와 결정

### 2.1 이 문서가 기대는 결정

| 결정 | 내용 | 이 문서에서 쓰는 곳 |
|---|---|---|
| 23 | 자체 런타임을 만든다. 재활용할 수 있는 pi 패키지는 적극 가져오고, 필요하면 소스를 가져와 고쳐 쓴다 | 전체. 제품 소유자 원문: "pi ai 및 pi의 각 구성요소 패키지들 재활용가능한것들 가져와서 커스텀하던 뭐하던 적극활용하는 방향으로 가. 포크해서 새로만든다는느낌으로. 일단 혼자쓰는앱으로."(`docs/handoff/HANDOFF.md:52`) |
| 24 | 혼자 쓰는 앱 | §3.17 고지 수준, §3.18 업그레이드 주기 |
| 27 | pi-ai를 가져와(포크 또는 고정 의존) Helm 안의 얇은 인터페이스 뒤에 둔다 | §3.2 pi-ai 행(고정 의존), §3.9.2. 인터페이스(`ModelGateway`)는 12 §3.3.2 |
| 28 | pi-agent-core를 포크해 Helm 런타임 루프로 쓴다. 커널 검사는 `beforeToolCall`, `afterToolCall`, `prepareRequest`, `subscribe`의 `message_end`에 연결한다 | §3.4~§3.5, §3.9.4, §3.10. `Agent` 클래스의 `subscribe` 대신 저수준 루프의 싱크(`emit`)가 같은 역할을 한다(12 RT-1) |
| 29 | 기준 원본은 Helm 이벤트 로그. pi 세션 파일이나 pi-durable 저장소를 기준 원본으로 쓰지 않는다. pi-durable은 설계·코드 참고용 | §3.2 coding-agent·pi-durable 행, §3.15 |
| 30 | 실행 의도 → 실행 → 결과 순 기록, 재시작 시 "중단됨" 정리, 다시 실행해도 안전한 도구만 재실행 | §3.5 A2·A3, §3.9.5 `replay` 기본값 |
| 33, 39 | SSH TUI는 pi-tui로 만든 Helm TUI. pi CLI 경로는 나중에 런타임 어댑터(pi RPC)로 연다 | §3.2 pi-tui 행, §3.14, §3.16 |
| 34 | 런타임 어댑터 인터페이스를 지금 정의, 1차 구현은 자체 런타임 하나 | §3.16(pi 쪽 사실만. 인터페이스는 13) |
| 36 | TypeScript strict, ESM, pnpm workspace, Vitest, TypeBox(pi-ai와 맞춤). 06이 Node 24 LTS·TypeScript 6.0.x로 바꿈(P3 메모, 06 §3.12 예정) | §3.3.3 컴파일 설정. 포크 코드가 TS 5.9.3과 6.0.3 모두에서 오류 없이 컴파일됨 [실험] |
| 브리프 §2.5 | 비밀은 SOPS → `secrets run`으로 자식 프로세스 환경에만 주입, 빌드·검증은 justfile 레시피 | §3.11.2 자격 증명, §3.7 T4 셸 환경, §3.18 레시피 |

### 2.2 이 문서의 결정 요약 [제안]

| ID | 결정 | 근거 절 |
|---|---|---|
| D07-1 | 포크 기준과 고정 의존 기준은 모두 태그 `v1.1.0`(커밋 `abe508e1`) = npm `@earendil-works/*` 1.1.0이다. `cdaf6c2`의 `[Unreleased]` 변경은 가져오지 않는다 | §3.1 |
| D07-2 | pi-agent-core는 `agent-loop.ts`, `types.ts`를 vendor 포크한다. `Agent` 클래스(`agent.ts`), `proxy.ts`, `stream-fn.ts`는 가져오지 않는다(12 RT-1). Helm은 싱크를 await하는 저수준 `runAgentLoop`·`runAgentLoopContinue`·`runToolCall`만 쓴다 | §3.4 |
| D07-3 | 12 §3.4.1의 요구 F-1~F-7을 패치 A1~A7로 받는다: 받은 컨텍스트 배열 복사(A1), 도구 호출 결과에 `executed`·`rejection`·실행 인자(A2), 중단 시 남은 호출도 결과로 닫기(A3), `beforeToolCall`의 `args` 명시 교체와 재검증(A4), 실행 직전 이벤트 `tool_execution_executing`(A5, F-4를 별도 이벤트로 바꿈), 전역 streamFn 제거(A6), 주석(A7) | §3.5 |
| D07-4 | coding-agent에서는 도구 7개(read, write, edit, bash, grep, find, ls)와 그 의존 파일 26개만 vendor 포크한다. 이미지 유틸 8개는 `@helm/ai`도 쓰므로 별도 패키지(`@helm/vendor-pi-image`)로 뗀다. 렌더러·확장 타입·`config.ts`·rg/fd 내려받기 의존을 끊고, 경로 정책 훅과 셸 환경 주입을 더한다 | §3.6~§3.7 |
| D07-5 | pi-ai, pi-codemode, pi-mcp, pi-tui는 정확한 버전 고정 의존이다. 수정은 `pnpm patch`로만 하고, 패치가 커지면 vendor로 바꾼다 | §3.2 |
| D07-6 | pi-durable, pi-protocol, pi-server, pi-client, chord, pi-env, pi-evals는 코드를 쓰지 않고 참고만 한다. pi-telemetry는 pi-ai의 전이 의존으로만 설치한다 | §3.2 |
| D07-7 | `vendor/<이름>/`은 pnpm 작업 공간의 비공개 패키지(`@helm/vendor-pi-agent-core`, `@helm/vendor-pi-tools`, `@helm/vendor-pi-image`)다. 각 패키지에 `UPSTREAM.json`, `PATCHES.md`, `LICENSE`를 두고, 파일마다 출처 헤더를 단다 | §3.3, §3.17 |
| D07-8 | pi 코드는 감싸는 패키지 하나씩만 import한다(06 §3.4.1). 저장·전송되는 모델 데이터 타입은 `@helm/domain/model`의 Helm 소유 타입이고 pi-ai와 같은 모양임을 컴파일 시험으로 검사한다. 루프 연결용 pi 기계 타입은 `@helm/ai/pi` 하위 경로로만 재export한다 | §3.9 |
| D07-9 | 업스트림 추적은 파일 단위 3-way 병합(`git merge-file`)이다. 정기 확인은 월 1회, 업그레이드는 필요할 때 체크리스트로 한다 | §3.18 |
| D07-10 | pi 자체의 재시도·세션 저장·컴팩션은 Helm 런타임 경로에서 쓰지 않는다. 재시도는 `@helm/ai`의 `ModelGateway` 한 곳(12 RT-9), 대화 기록은 Helm 이벤트 로그 하나다 | §3.11, §3.15 |
| D07-11 | pi 동작 중 Helm이 기대는 것(훅 순서, 차단 시 `afterToolCall` 미호출, 싱크 await, 컨텍스트 배열 비변경 등)은 계약 테스트 C1~C24로 고정한다 | §3.10, §3.19 |

### 2.3 이 결정이 기대는 pi 사실

| 번호 | 사실 | 확인 |
|---|---|---|
| F1 | npm 1.1.0의 12개 패키지(`pi-ai`, `pi-agent-core`, `pi-coding-agent`, `pi-tui`, `pi-codemode`, `pi-mcp`, `pi-telemetry`, `pi-durable`, `pi-protocol`, `pi-server`, `pi-client`, `chord`)의 소스맵 `sourcesContent`는 태그 `v1.1.0`의 파일과 모두 같다(같음 663, 다름 0, 없음 0). `cdaf6c2`와는 ai 2, coding-agent 10, tui 8, codemode 5, mcp 2, durable 29개 파일이 다르다 | [실험] `.helm-design-work/P4/verify-npm-vs-tag.py`, 출력 `npm-vs-cdaf6c2.txt` |
| F2 | `v1.1.0`과 `cdaf6c2` 사이에서 pi-agent-core 소스(`packages/agent/src/*`)와 coding-agent 도구·유틸 파일(`src/core/tools/*`, `src/utils/*` 중 이 문서가 가져오는 26개)은 바뀌지 않았다 | [원문] `git diff --stat v1.1.0 cdaf6c2 -- packages/agent packages/coding-agent/src/core/tools packages/coding-agent/src/utils` |
| F3 | 루프는 `prepareRequest`·`prepareNextTurn`가 돌려준 `context.messages` 배열에 이후 메시지를 직접 `push`한다 | [원문] `pi@v1.1.0:packages/agent/src/agent-loop.ts:188,214,228,275,418,434,447-449` [실험] pi-facts-1 §0-3(실험 A1 6번) |
| F4 | `tool_execution_start`는 인자 검증과 `beforeToolCall`보다 먼저, 검증 전 인자로 나간다. 도구를 찾지 못했거나 인자 검증이 실패하면 `beforeToolCall`은 불리지 않는다 | [원문] `agent-loop.ts:541-549,596-604,716-727` |
| F5 | `beforeToolCall`의 `args`는 `structuredClone`된 검증 결과이고 그 객체가 `execute()`로 간다. transcript의 `toolCall.arguments`는 원래 값으로 남는다 | [원문] `pi@v1.1.0:packages/ai/src/utils/validation.ts:317-349`, `agent-loop.ts:726-769,832-834` [실험] pi-facts-1 §0-1 |
| F6 | 차단(`block`)이나 훅 예외로 끝난 호출에는 `afterToolCall`이 불리지 않는다. `afterToolCall`이 `content`만 바꾸면 `structuredContent`가 지워진다 | [원문] `agent-loop.ts:745-755,770-776,884-895` [실험] pi-facts-1 실험 A1 3번 |
| F7 | 도구 결과 메시지(`ToolResultMessage`)에는 `structuredContent`가 없다. `tool_execution_end` 이벤트의 `result`와 `runToolCall()` 반환값에는 있다 | [원문] `agent-loop.ts:919-944` |
| F8 | 중단(abort) 시 순차·병렬 실행 모두 `break`로 남은 호출을 건너뛰어, 그 호출들은 이벤트도 결과 메시지도 받지 못한다 | [원문] `agent-loop.ts:575-577,613-615,641-643` |
| F9 | 저수준 루프는 모든 이벤트에서 싱크(`emit`)를 await한다. 싱크가 예외를 던지면 `runAgentLoop`가 reject하고 이후 단계(도구 준비·실행)는 일어나지 않는다. (`Agent` 클래스는 이 예외를 잡아 `stopReason: "error"` 메시지로 바꾸지만 Helm은 `Agent`를 쓰지 않는다) | [원문] `agent-loop.ts:117-124` 등 모든 `await emit`, `agent.ts:507-548` [실험 P4: assistant `message_end` 싱크 예외 → reject, 도구 실행 0회] |
| F10 | 모델에게 선언되는 도구는 transcript의 system 메시지(`toolsAdded`/`toolsRemoved`)를 재생한 결과다. 루프는 `normalizeContext({ messages })`만 넘기므로 `context.tools`는 실행 가능 집합일 뿐이다 | [원문] `agent-loop.ts:333-363,397`, `pi@v1.1.0:packages/ai/src/utils/transcript.ts:30-34,58-66` |
| F11 | pi-ai의 SDK 수준 재시도 기본값은 0이다(`retryProviderRequest`의 `maxRetries ?? 0`, SDK 클라이언트 `maxRetries: 0`) | [원문] `pi@v1.1.0:packages/ai/src/utils/provider-retry.ts:107-128`, `api/anthropic-messages.ts:644-655` |
| F12 | coding-agent 도구 파일은 렌더러(`./renderers/*`, pi-tui·interactive 테마)와 확장 타입을 import하고, grep/find는 `rg`/`fd`가 없으면 GitHub에서 내려받는다 | [원문] `core/tools/*.ts` import 줄, `src/utils/tools-manager.ts:349-400` |
| F13 | coding-agent의 bash는 데몬 프로세스 환경 전체(`process.env`)에 pi bin 디렉터리를 PATH 앞에 붙여 자식 셸에 넘긴다. 모델 API 키가 환경에 있으면 셸에서 읽을 수 있다 | [원문] `src/utils/shell.ts:138-150`, `core/tools/bash.ts:186-212` [실험] §3.10 C21 |
| F14 | pi에는 권한 시스템이 없다. 도구는 경로를 제한하지 않는다 | [원문] pi-src `README.md:88-96`, pi-facts-1 §0-5 |

### 2.4 사례에서 온 근거 (cases §11.5, §12.1-10)

| 사례 | pi 활용 | 이 문서가 가져온 것 | 이 문서가 피한 것 |
|---|---|---|---|
| openclaw | pi SDK 임베드(2026.2~2026.5) → 2026.5.22 런타임 내부화, 지금은 pi-tui 1.0.0만 고정 의존(cases §7.2) | pi-agent-core와 같은 파일 구성의 루프를 직접 소유하는 방향(D07-2), pi-tui 고정 의존(D07-5), "Portions adapted from Pi / pi-mono" 고지(§3.17) | pi 내부 auto-retry와 호스트 retry가 겹친 "nested SDK retry", pi transcript와 호스트 기록의 이중 쓰기(`CHANGELOG/2026.5.22.md:226,255,270`, `2026.5.12.md:799`) → D07-10 |
| pi-web | coding-agent SDK 임베드, peer `^1.0.0`(cases §5.2) | export 표면 무결성 테스트(`src/server/piSdkIntegrity.test.ts:1-75`) → §3.19.1 I1 | peer 범위로 업스트림을 따라가다 0.85.0 패키징 사고로 기동 불가, 거의 minor마다 하한 상향 → 정확한 버전 고정(D07-5) |
| pi-chat | 확장 + coding-agent 도구 팩토리. read/write/edit/bash를 `operations` 주입으로 Gondolin VM에서 실행(`index.ts:483-499`, `src/gondolin.ts:296-336`) | `*Operations`·`spawnHook` 주입으로 실행 환경을 바꾸는 방식을 포크에서 유지(§3.7 T7 이유, 13의 격리) | 비밀 평문 설정 파일 |
| pi-acp, paseo | 사용자 pi CLI를 `pi --mode rpc` 자식 프로세스로(cases §4.2, §9) | `agent_settled`를 턴 종료로 보는 판정, 확장 UI `select`/`confirm`/`input`/`editor`를 질문으로 매핑, 요청 id·타임아웃·늦은 응답 폐기 → §3.16 | `ctx.ui.notify` 문자열 마커로 상태 빼내기(paseo `pi/agent.ts:102-104`) |
| pi-fabric | pi-durable 1.1.0·coding-agent 1.1.0 정확한 버전 고정 + 첫 사용 때 버전 검사(`src/durable.ts:46-60`), `Agent` 상속(cases §6.2) | 정확한 버전 고정과 런타임 버전 검사 → §3.19.1 I1 | `Agent` 비공개 상태를 `Object.defineProperties`로 덮어쓰는 상속(S4/pi-fabric §8 피할 것 1) → 상속 대신 포크 |
| happy-agent | pi 런타임(agent-core, coding-agent)에는 한 번도 의존하지 않았다. pi-ai는 2026-07-04~07-23에만, pi-tui는 2026-10-10 TUI 제거 때까지 썼다(cases §3.2) | 모델 계층을 얇은 인터페이스 뒤에 두어 나중에 바꿀 수 있게 하는 이유(§3.9) | - |
| absurd | 문서 패턴: agent-core + pi-ai, 메시지 단위 체크포인트(cases §8.5) | - | 메시지 단위 체크포인트만으로는 도구 실행 중 크래시를 구분하지 못함 → 의도·결과를 따로 기록하는 A2 |

기존 조사 정정(cases §1-3, §13.2)을 이 문서에 반영했다.
- `pi-runtime-options.md` §0-2·§2와 `pi-layer-analysis.md` §10의 "Happy Agent가 pi 런타임을 걷어냈다", "pi-ai만(2026-07~08)"은 맞지 않는다. Happy Agent는 루프를 처음부터 자체 구현했고 pi-ai 사용 기간은 2026-07-04~07-23, pi-tui 제거는 2026-10-10이다.
- 같은 문서의 "Paseo는 ACP 브리지에서 직접 RPC로 옮김"은 맞지 않는다. 순서는 ACP(`65573499`) → SDK 임베드(`fbc2371b`) → RPC(`4cf985c2`)다. RPC로 옮긴 이유는 사용자 pi 설치본과 확장 로딩 경로·버전 불일치였다.
- 같은 문서의 "pi-chat: pi가 거의 전부, pi 프로세스와 권한을 공유"는 일부만 맞다. 도구 실행은 Gondolin VM으로 보낸다.

### 2.5 원천 항목 반영 표

0단계 원천의 끝 목록·체크리스트에서 07에 배정된 항목이다.

| 원천 항목 | 반영 |
|---|---|
| canon-2 §11 "07": pi-lab exp1~6이 확인한 훅 위치, 직렬화·복원, provider 이어 쓰기, 확장 `tool_call` block·입력 수정, pi-durable 재시작, pi-protocol 프레이밍, pi-tui 원격 렌더링을 파일 단위 계획에 연결 | §3.10 계약 표의 "근거 실험" 열, §3.2 각 행. exp3(확장)·exp4(durable)·exp5(protocol)는 코드를 가져오지 않는 이유로, exp6(tui)은 §3.14로 연결 |
| canon-2 §11 "07": pi-durable은 참고용(의도 → 실행 → 결과, 지속 타이머, 사람 결정 host commit, 훅 읽기 전용 한계) | §3.2 pi-durable 행의 참고 절 목록, §5.2 12에 대한 요구 |
| canon-2 §11 "07" / L22: codemode 샌드박스 안 도구 호출이 훅을 거치지 않는 문제 | §3.12. 브리지가 포크한 `runToolCall()`로 같은 훅을 지나게 한다 [실험 C20] |
| canon-2 §11 "07": OpenAI provider 계약 규칙(mixed 출력 거부, strict schema, 키 비노출, usage는 운영 데이터)을 pi-ai 계층 요구로 | §3.11.7 |
| extracts-1 E1-097 / Q2: 세션 트리, 버린 분기 | §3.15 세션 트리 행. 외부 로그의 버린 분기 처리는 16 §3.6.3 |
| extracts-1 E1-118 / Q1: `context_edit`로 원본과 모델이 본 것이 다를 수 있음 | §3.15 `context_edit` 행 |
| extracts-1 E1-121: 버전 고정, 업데이트 전 Breaking 확인 | §3.18 |
| extracts-1 E1-205·E1-208 / Q12: 노출 등급 구분, 설명 불변으로 캐시 보존 | §3.15 프롬프트 캐시 행, §5.2 13에 대한 요구 |
| extracts-1 Q15: 스킬 description을 가장 엄격한 런타임 제약에 맞출지 | §7 미결 M7. pi 쪽 사실만 적는다 |
| extracts-1 Q18: signal 확장의 `getSessionFile`과 이벤트 타입 | §3.16.6 |
| extracts-1 Q19: Pi Durable 코드 위치(`packages/durable/`와 `coding-agent/src/experimental/durable/`) | §3.2 pi-durable 행 |
| extracts-2 d-1: 투영으로 메시지 배열을 바꿀 때 세션 기록과 프롬프트 캐시 | §3.10 C7·C16, §3.15 |
| extracts-3 §4 "pi 안의 Helm"(X3-4-01~18) | §3.2 coding-agent 행: 확장 방식은 채택하지 않는다(결정 22·23·29). 기능 대응표의 개념(제안 도구, 차단, 종료 조건, 컴팩션 가로채기)은 포크한 루프 훅으로 옮긴다(§3.2 끝 문단) |
| extracts-4 §13 pi-durable 스파이크, §14 정정, d26(pi SDK 스파이크 세 항목이 pi-lab으로 확인됐는가) | §3.2 pi-durable·coding-agent 행. d26: (1) faux로 SDK 세션 = exp3 확인, (2) inline 확장으로 차단·입력 수정 = exp3 확인(합의·제출 흐름 전체는 아님), (3) 저장소에서 복원한 세션 이어가기 = exp1(`state.messages` 왕복)과 exp3(`SessionManager.open`)로 확인. Helm은 SDK를 쓰지 않으므로 이 세 항목은 참고 근거로만 남는다 |
| extracts-4 §15 assistant-ui | 07 범위 밖(21). pi와 관련된 점은 "OpenCode 런타임 예처럼 pi 세션을 스레드로 대응"뿐이고, Helm은 pi 세션을 쓰지 않으므로 해당 없음 |
| pi-facts-1 §9.3 1~5 | 1: §3.5 A2(모델 인자·실행 인자 둘 다 기록). 2: §3.5 A3. 3: §3.7 T7 + 13(bash). 4: §3.12. 5: §3.2 pi-ai 행(고정 의존) |
| pi-facts-2 §13 공통 후보(정확한 버전, `overrides`, Unreleased 기록, TS 설정, Node 22.19 이상) | §3.1, §3.3 |
| pi-facts-2 §14 미확인 | 실제 TTY 확인은 §7 M5. pi-env Rust 크레이트 라이선스, chord delta 안정성, pi-client의 Tauri WebSocket 연결은 해당 패키지를 쓰지 않으므로(§3.2) 확인하지 않는다. `PI_EXPERIMENTAL=1 ./pi-test.sh` 경로는 참고 대상 밖 |
| cases §12.1-10, §12.2-4·5 | §2.4 표, §3.16, §3.19 |
| 브리프 §3.5 "pi 세션·패키지 특성" | §3.15 |

## 3. 명세 본문

### 3.1 기준 정하기

#### 3.1.1 결정 [제안 D07-1]

| 항목 | 값 |
|---|---|
| 업스트림 저장소 | `https://github.com/earendil-works/pi` |
| 기준 태그 | `v1.1.0` |
| 기준 커밋 | `abe508e1b89912adde45528136c3221eb69acdd7` ("Release v1.1.0", 2026-10-07 23:33 +0200) [원문 `git log -1 v1.1.0`] |
| 고정 의존 버전 | npm `@earendil-works/pi-ai`, `pi-codemode`, `pi-mcp`, `pi-tui`, `pi-telemetry` 모두 `1.1.0` |
| vendor 포크의 원본 | 같은 태그의 파일 |

#### 3.1.2 근거

1. 포크 기준과 고정 의존 기준이 다르면 한 저장소 안에서 두 API를 섞게 된다. 예: `cdaf6c2`를 포크 기준으로 잡으면 vendor 코드는 `cdaf6c2`의 pi-ai 타입 배치를, 고정 의존한 npm pi-ai는 1.1.0 배치를 갖는다. 두 기준이 같으면 vendor 코드가 import하는 `@earendil-works/pi-ai`가 vendor 원본이 컴파일되던 그 버전이다.
2. 태그 `v1.1.0`과 npm 1.1.0은 소스 수준에서 같다(F1). 따라서 "포크 원본"과 "고정 의존 배포물"이 한 버전 문자열로 설명된다.
3. `cdaf6c2`에만 있는 변경은 Helm 1차 범위에 필요하지 않다(§3.1.3 표). 필요해지면 다음 업그레이드(§3.18)로 받는다.
4. pi-agent-core와 가져올 도구 파일은 두 커밋 사이에 바뀌지 않았다(F2). 0단계 자료(pi-facts-1)의 agent·도구 행 번호는 그대로 쓸 수 있다.

#### 3.1.3 `v1.1.0` 이후 `cdaf6c2`까지의 변경과 처리

`git log --oneline v1.1.0..cdaf6c2`는 24개 커밋이다 [원문]. 패키지별 `[Unreleased]` 항목과 처리:

| 패키지 | `[Unreleased]` 내용 [원문 각 `CHANGELOG.md`] | Helm 처리 |
|---|---|---|
| pi-agent-core | 없음(빈 절) | 해당 없음 |
| pi-ai | Mistral 스트림이 요청 타임아웃 뒤 끊기는 문제 수정. `types.ts`의 모델 관련 타입을 `providers/model-schema.ts`, `providers/compat-schema.ts`로 옮김(재export 유지) | 받지 않음. Helm 1차 provider는 Anthropic·OpenAI(§3.11.1). Mistral을 쓰게 되면 업그레이드 |
| pi-coding-agent | 테마 JSON 스키마 경로 이동과 알 수 없는 속성 거부(Breaking), `showHardwareCursor`, Mistral 수정, 중첩 worktree의 심볼릭 링크 `AGENTS.md` | 해당 없음. 가져오는 파일(도구)은 바뀌지 않음 |
| pi-codemode | `RemoteCodemodeSandbox`, `InlineCodemodeSandbox`, `CodemodeSandboxBase`, `./portable` 진입점 추가. `while (true) await null` 중단 개선. `node --watch`(Node 24·26)에서 worker 채널이 깨지는 문제 수정(#10725) | 받지 않음. Helm은 worker 방식 `CodemodeSandbox`만 쓴다. 데몬을 `node --watch`로 띄우지 않는다는 규칙을 둔다(§4 E14) |
| pi-mcp | `authorizeMcp()`의 `iss` 검사 수정(RFC 9207) | 받지 않음. pi-mcp 도입 단계(§3.13)에서 그때의 최신 태그로 함께 올린다 |
| pi-tui | `Editor`/`Input`의 커서를 APC 표지로 감쌈(Breaking), `renderFakeCursor()` 추가, `showHardwareCursor` 의미 변경, 오버레이 커서 표지 손실 수정 | 받지 않음. TUI 단계(§3.14)에서 그때의 최신 태그로 올린다 |
| pi-durable | Breaking 5개 등 29개 파일 | 쓰지 않으므로 해당 없음 |

#### 3.1.4 0단계 자료의 행 번호 주의

pi-facts-1·2는 `cdaf6c2` 기준이다. 아래 파일은 `v1.1.0`에서 행 번호나 이름이 다르다. 이 문서는 `v1.1.0` 행 번호를 쓴다.

| 파일 | `v1.1.0`에서 다른 점 [원문] |
|---|---|
| `packages/ai/src/types.ts` | 모델 관련 타입이 이 파일에 직접 있다. 예: `ThinkingLevel` :89, `StreamOptions` :193(`cacheRetention` :224, `sessionId` :230), `Usage` :433, `StopReason` :456, `SystemMessage` :528, `AssistantMessage` :552, `ToolResultMessage` :607, `Tool` :736, `Context` :753 |
| `packages/codemode/src/types.ts` | `CodemodeSandboxBaseOptions`가 없다. `globals`는 `CodemodeSandboxOptions`(:94)의 :102에 있다. `CodemodeExecuteOptions.store`는 :137 |
| `packages/codemode/src/runtime/*` | `execution.ts`, `inline.ts`, `remote.ts`, `vm.ts`가 없다. `CodemodeSandbox`는 `runtime/host.ts:340`, 기본 기한 `DEFAULT_TIMEOUT_MS = 300_000`은 `host.ts:22` |
| `packages/tui/src/tui.ts`, `index.ts` | `renderFakeCursor()`가 없다 |

15 §2.3이 인용한 `CodemodeSandboxBaseOptions.globals`(`types.ts:102-109`)는 `v1.1.0`에서 `CodemodeSandboxOptions.globals`(`types.ts:102`)다(§5.2 15에 대한 요구).

### 3.2 패키지별 활용 방식 결정 표 [제안]

도입 단계는 23이 확정한다. 여기서는 "1차"(데몬 + 자체 런타임 + 데스크톱 앱 MVP), "REPL"(15의 REPL 방식 탐구를 켤 때), "MCP"(MCP 서버를 쓸 때), "TUI"(결정 33의 SSH TUI), "어댑터"(pi CLI RPC 어댑터, 결정 34의 이후 단계)로 적는다.

| 패키지 | 방식 | 범위 | 이유 | 위험 | 재검토 조건 | 단계 |
|---|---|---|---|---|---|---|
| pi-ai (`@earendil-works/pi-ai`) | 정확한 버전 고정 의존 `1.1.0` | 루트 진입점, `providers/anthropic`, `providers/openai`, 루트의 `fauxProvider` | provider 와이어 코드(13,186줄)와 모델 카탈로그는 provider API 변경을 따라가야 하는 부분이다. vendor하면 그 추적을 Helm이 떠안는다. Helm이 고칠 필요가 있는 곳이 지금은 없다(faux의 `api` 임의값은 옵션으로 고정, `CredentialStore`는 인터페이스 주입) | patch·minor에서도 Breaking이 있었다(pi-facts-2 §1.3: 1.0.1, 1.0.3, 1.1.0). 업그레이드가 쉽지 않을 수 있다 | `pnpm patch`가 3개를 넘거나 합계 200줄을 넘을 때, provider 코드를 구조적으로 바꿔야 할 때 vendor로 바꾼다. 모델 카탈로그 갱신이 필요할 때 버전을 올린다(§3.11.5로 새 모델은 설정에서 먼저 더할 수 있다) | 1차 |
| pi-agent-core (`@earendil-works/pi-agent-core`) | vendor 포크 | `src/agent-loop.ts`, `src/types.ts`(`Agent` 클래스 제외, 12 RT-1) | 결정 28. 가져오는 두 파일이 1,488줄로 작고 Helm 커널 검사를 연결하는 자리다. 행동을 바꿔야 할 곳이 있다(A1~A5) | 업스트림 수정(버그 수정)을 놓칠 수 있다 | 업스트림 Breaking이 루프 계약(§3.10)을 바꿀 때 3-way 병합 대신 재설계 검토 | 1차 |
| pi-coding-agent (`@earendil-works/pi-coding-agent`) | 부분 vendor 포크 + 나머지 참고 | 도구 7개와 의존 26개 파일(§3.6). 참고: `core/session-manager.ts`, `core/compaction/*`, `core/system-prompt.ts`, `core/extensions/types.ts`(`ToolExposure`, `executeTool`), `extensions/codemode/*`, `extensions/mcp/*`, `modes/rpc/*`, `modes/interactive/components/*` | 도구의 잘림·이어 읽기 안내·편집 매칭·프로세스 트리 종료는 재사용 가치가 크다. 패키지 루트 import는 33개 패키지를 끌어온다(pi-facts-1 §4.6) | 도구 동작 수정(예: edit 퍼지 매칭)을 직접 병합해야 한다. 업스트림 테스트를 함께 vendor해 회귀를 잡는다(§3.19.3) | 도구 파일의 업스트림 변경이 렌더러·확장 타입과 얽혀 병합 충돌이 잦아지면 Helm 자체 도구로 분리 | 1차(도구), 어댑터(`modes/rpc/rpc-types.ts`, `jsonl.ts` 타입·프레이밍만 vendor, §3.16.7) |
| pi-tui (`@earendil-works/pi-tui`) | 정확한 버전 고정 의존 | `apps/tui`에서만 | 런타임 의존이 2개(`get-east-asian-width`, `marked`)이고, OpenClaw도 끝까지 이것만 남겼다(cases §7.2). 터미널 세부(IME, Kitty 프로토콜, SSH ESC 대기)를 다시 만들 이유가 적다 | 네이티브 프리빌드 `.node` 바이너리가 함께 온다(pi-facts-2 §1.2). 키 바인딩이 patch에서 바뀐 적이 있다(1.0.3) | 한국어 줄바꿈 품질(pi-facts-2 §2.6)이 쓸 수 없는 수준이면 `utils.ts`의 줄바꿈 함수만 Helm 쪽에서 감싼다 | TUI |
| pi-codemode (`@earendil-works/pi-codemode`) | 정확한 버전 고정 의존 | `CodemodeSandbox`, `renderDeclarations`, `parseCodemodeSource` | pi 의존이 없고 외부 의존은 `quickjs-wasi` 하나다. Helm이 넣을 것은 globals와 도구 브리지뿐이라 수정이 필요 없다 [실험 C20] | `node --watch`에서 worker 채널 오류(#10725, `cdaf6c2`에서 수정) | REPL 방식 탐구를 켤 때 그 시점 최신 태그로 올릴지 판단 | REPL |
| pi-mcp (`@earendil-works/pi-mcp`) | 정확한 버전 고정 의존 | `McpClient`, `StdioTransport`, `StreamableHttpTransport`, `toLlmContent` | pi 의존이 없고 외부 의존은 `cross-spawn` 하나다. tarball에 `LICENSES/`가 들어 있다 | `outputSchema` 검증이 없다(§3.13) | MCP 서버를 쓰기로 할 때 도입 | MCP |
| pi-durable (`@earendil-works/pi-durable`) | 참고만 | `docs/spec.md` 1(불변조건), 2.1(컨텍스트 유도 10단계), 5.1~5.5(task, effect sandwich, 소유 트리), 6(submission `requestId`), 7.3(도구 세 채널, `replay`), 8.3~8.4(generation·tool task 재개), 10~11(저장소 계약, JSONL 공개 순서). 코드 참고: `src/harness/tool.ts:182-195`(interrupted 문구), `src/storage/sqlite/migrations.ts`(레코드 JSON 열 + 조회 열) | 결정 29. experimental("API changes without notice", `durable/README.md:3`), chord 의존 63곳 | - | experimental 표시가 사라지면 12의 크래시 복구와 비교 재검토 | 참고 |
| `coding-agent/src/experimental/durable/` | 참고만 | `subagent.ts`(durable 서브에이전트), `README.md` | extracts-1 Q19의 답: `packages/durable/`은 라이브러리, `coding-agent/src/experimental/durable/`은 그 위에 pi 도구·프롬프트·TUI 부품으로 만든 작은 코딩 에이전트다. npm 배포물에서 빠진다(`coding-agent/package.json` `files`의 `!dist/experimental`) | - | - | 참고 |
| pi-protocol | 참고만 | `framing.ts`(길이 접두 프레임), strict JSON 검사와 한도, `hello`/`hello_error` 규칙 | 19가 JSON-RPC 2.0과 자체 SSH 경로를 정했다(19 P-02). 프레임 분할기만 쓸모가 있으나 19가 채택하지 않았다 | - | 19가 SSH stdio 길이 접두 프레임을 채택하면 `framing.ts`(151줄, 의존 없음)를 vendor | 참고 |
| pi-server | 참고만 | 연결 상태 기계, 핸드셰이크 기한, 중복 요청 id 거부, 요청별 취소, 스냅샷 전 갱신 버퍼, 송신 대기 한도, 연결 세대 ID, 오류 정제(pi-facts-2 §4, §13) | experimental, Chord 서비스 모델에 묶임, 인증 없음 | - | - | 참고(19) |
| pi-client | 쓰지 않음 | - | 재접속·재전송이 없다(pi-facts-2 §5.3). 서버가 pi-server여야 한다 | - | - | - |
| chord | 쓰지 않음 | 참고: `ReplicatedStateSource`의 커서 계약 문구, 구독 대기 100개 초과 시 reset 정책 | CHANGELOG가 없고 "not a stable public API contract yet"(pi-facts-2 §7.1). 19가 JSON Patch를 택했다(19 ADR 후보 19-A4) | - | - | - |
| pi-env | 참고만 | `docs/protocol.md`(동기화 줄 `PI-ENV <token>`, 길이 접두 프레임, ping 5초, 무수신 30초 종료, 응답 우선 전송), `src/ssh.ts:77-117` ssh 인자 | pi-durable `ExecutionEnv` 구현이라 Helm 도구 층에 바로 끼울 수 없다(pi-facts-2 §8). Rust 데몬 바이너리 8.8 MB | - | 원격 도구 실행이 필요해지면 `*Operations` 어댑터로 검토(13) | 참고(19, 13) |
| pi-evals | 참고만 | 쌍 비교, 결측은 0으로 치지 않고 헤드라인 보류, 실행 계획 고정, Docker 격리 | private, npm 미배포, 실제 provider 필요 | - | - | 참고(16, 22) |
| pi-telemetry | pi-ai의 전이 의존(고정 `1.1.0`) | Helm 코드에서 직접 import하지 않는다 | 런타임 의존 없음. pi-ai `StreamOptions.telemetryContext` 타입 때문에 설치된다. Helm 진단은 06 §3.11 로그 체계를 쓴다 | - | span 단위 진단이 필요해지면 `@helm/ai`에서 `telemetryContext`로 연결 검토 | 1차(설치만) |

coding-agent의 "pi 안의 Helm" 방식(확장으로 커널을 넣는 안, extracts-3 §4, `pi-runtime-options.md` 안 1)은 쓰지 않는다. 데몬 상주(결정 22)와 기준 원본(결정 29)을 만족하지 못한다. 그 대응표(X3-4-08)의 기능은 포크한 루프의 훅으로 옮긴다: 관찰 자동 생성 = `afterToolCall`의 결과 기록(12 §3.4.6), 권한 검사 = `beforeToolCall`(12 §3.4.5), 루프 종료 조건("제출 없이 끝나려 하면 한 번 더") = `finishTurn`의 `continue`와 반복 상한(12 §3.4.9), 컴팩션 가로채기 = Helm 투영이 요약을 직접 넣으므로 필요 없음(12 §3.6), 독립 검증자 = 새 run(fork 아님, 12 §3.14).

### 3.3 저장소 배치

#### 3.3.1 디렉터리 [제안 D07-7]

06 §3.15의 저장소 구조 중 `vendor/` 아래와, vendor를 쓰는 Helm 패키지의 pi 관련 파일만 적는다.

```text
helm/
  vendor/
    README.md                      # 이 절의 요약: 기준 태그, 패키지 목록, 수정 규칙, 동기화 명령
    LICENSES/
      pi-mono-MIT.txt              # pi 저장소 루트 LICENSE 원문(Copyright (c) 2025 Mario Zechner)
    UPGRADES/                      # 업그레이드마다 보고서 1개(§3.18.4)
      2026-10-11_v1.1.0-baseline.md
    pi-agent-core/                 # @helm/vendor-pi-agent-core (private)
      package.json
      tsconfig.json
      vitest.config.ts
      LICENSE                      # vendor/LICENSES/pi-mono-MIT.txt 복사본
      UPSTREAM.json                # 기준 커밋, 파일 대응, 패치 ID (§3.18.1)
      PATCHES.md                   # 패치 ID별 설명, 이유, 테스트 (§3.5)
      src/
        agent-loop.ts              # ← packages/agent/src/agent-loop.ts (A1~A7)
        types.ts                   # ← packages/agent/src/types.ts (A2, A4, A5, A7)
        index.ts                   # Helm 신규(Agent·proxy·stream-fn 제외 재export)
      test/
        agent-loop.test.ts         # ← packages/agent/test/agent-loop.test.ts (A6 관련 describe 삭제, A5 관련 기대값 1건)
        utils/                     # ← packages/agent/test/utils/*
        contract.test.ts           # Helm 신규: §3.19.2 표
    pi-tools/                      # @helm/vendor-pi-tools (private)
      package.json  tsconfig.json  vitest.config.ts  LICENSE  UPSTREAM.json  PATCHES.md
      src/
        index.ts                   # Helm 신규
        tool-definition.ts         # Helm 신규(확장 타입 대체)
        tools/                     # ← packages/coding-agent/src/core/tools/* (13개)
        utils/                     # ← packages/coding-agent/src/utils/* (5개) + tool-binaries.ts(Helm 신규)
      test/                        # ← packages/coding-agent/test/* 5개(§3.19.3) + contract.test.ts
    pi-image/                      # @helm/vendor-pi-image (private) — read 도구와 @helm/ai가 함께 씀(§3.6.4)
      package.json  tsconfig.json  vitest.config.ts  LICENSE  UPSTREAM.json  PATCHES.md
      src/                         # ← packages/coding-agent/src/utils/{image-*,photon,exif-orientation,mime}.ts (8개) + index.ts(Helm 신규)
      test/                        # ← packages/coding-agent/test/image-process.test.ts
  packages/
    domain/src/model.ts            # Helm 소유 모델 데이터 타입(08 소유 파일, 07 제안, §3.9.2)
    ai/                            # @helm/ai: pi-ai 고정 의존과 vendor-pi-image를 감쌈
      src/pi.ts                    # @helm/ai/pi: 루프 연결용 pi 기계 타입 재export
      src/pi/                      # pi-ai를 import하는 디렉터리
    agent/                         # @helm/agent: vendor 루프를 재export(§3.9.4)
    tools/                         # @helm/tools: vendor-pi-tools, pi-codemode, pi-mcp를 감쌈(§3.9.5)
      src/pi/
  apps/
    tui/                           # @helm/tui: pi-tui 고정 의존(§3.14)
  scripts/
    vendor/
      sync.mjs                     # status / diff / upgrade / verify (§3.18.2)
      changelog-breaking.mjs       # 두 버전 사이 Breaking·Changed·Removed 추출 (§3.18.3)
      check-pi-boundary.mjs        # import 경계 검사 (§3.19.1 I4)
  THIRD_PARTY_NOTICES.md           # §3.17.2
```

규칙
1. vendor 패키지는 비공개(`"private": true`)이고 npm에 올리지 않는다.
2. vendor 파일의 수정은 이 문서 §3.5·§3.7의 패치 ID로만 한다. 새 수정은 패치 ID를 새로 정하고 `PATCHES.md`, `UPSTREAM.json`, 파일 헤더, `HELM-PATCH` 표지를 함께 고친다. `scripts/vendor/sync.mjs verify`가 이 넷의 일치를 검사한다(§3.18.2).
3. Helm 고유 로직은 vendor에 넣지 않는다. Helm 로직은 `packages/*/src/pi/` 어댑터에 둔다. vendor에 새로 쓴 파일(`index.ts`, `tool-definition.ts`, `tool-binaries.ts`)은 pi 코드를 Helm 저장소에 맞추기 위한 연결 코드뿐이다.

#### 3.3.2 패키지 매니페스트

```jsonc
// vendor/pi-agent-core/package.json
{
  "name": "@helm/vendor-pi-agent-core",
  "version": "1.1.0-helm.1",          // 기준 버전 + helm 패치 순번
  "private": true,
  "type": "module",
  "license": "MIT",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "scripts": { "build": "tsc -p tsconfig.json", "test": "vitest run" },
  "dependencies": { "@earendil-works/pi-ai": "1.1.0", "typebox": "1.3.27" },
  "devDependencies": { "vitest": "<06이 정한 버전>" }
}

// vendor/pi-tools/package.json
{
  "name": "@helm/vendor-pi-tools",
  "version": "1.1.0-helm.1",
  "private": true,
  "type": "module",
  "license": "MIT",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "dependencies": {
    "@helm/vendor-pi-agent-core": "workspace:*",
    "@earendil-works/pi-ai": "1.1.0",
    "typebox": "1.3.27",
    "diff": "8.0.4",                       // edit-diff.ts
    "@helm/vendor-pi-image": "workspace:*",
    "cross-spawn": "7.0.6"                 // utils/child-process.ts
  },
  "devDependencies": { "@types/cross-spawn": "6.0.6" }
}

// vendor/pi-image/package.json
{
  "name": "@helm/vendor-pi-image",
  "version": "1.1.0-helm.1",
  "private": true,
  "type": "module",
  "license": "MIT",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "dependencies": { "@silvia-odwyer/photon-node": "0.3.4" }   // Apache-2.0 (§3.17)
}
```

버전은 coding-agent 1.1.0의 `package.json` `dependencies`와 같게 둔다 [원문 `pi@v1.1.0:packages/coding-agent/package.json`]. pi 쪽 의존(고정 의존 pi-ai·pi-codemode 포함) 중 설치 스크립트가 있는 것은 `@google/genai`(no-op `preinstall`)와 `protobufjs`(`postinstall`)뿐이고, 둘 다 실행하지 않아도 동작한다 [실험: `--ignore-scripts` 설치로 시제품 동작, pi-facts-2 §11]. 18의 빌드 스크립트 허용 목록(`onlyBuiltDependencies`)에 07이 더할 것은 없다. `pnpm-workspace.yaml`에 다음을 둔다(06이 파일을 소유하고 이 항목을 포함한다).

```yaml
packages:
  - packages/*
  - apps/*
  - vendor/pi-agent-core
  - vendor/pi-tools
  - vendor/pi-image
overrides:
  # pi 패키지끼리는 ^1.1.0으로 서로를 요구한다(pi-facts-2 §1.1). 한 버전에 묶는다.
  "@earendil-works/pi-ai": "1.1.0"
  "@earendil-works/pi-telemetry": "1.1.0"
  "@earendil-works/pi-agent-core": "-"     # npm 판은 설치하지 않는다(vendor만 쓴다)
  "@earendil-works/pi-coding-agent": "-"   # 설치하지 않는다
  "typebox": "1.3.27"                      # Helm 스키마와 pi-ai 검증이 같은 TypeBox 인스턴스를 쓰게
patchedDependencies: {}                    # pnpm patch를 쓰면 여기에 기록(§3.18.5)
```

`"-"`(설치 제거) 표기가 pnpm 11에서 지원되지 않으면 [가정], 대신 §3.19.1 I4가 lockfile에 두 패키지가 없음을 검사한다.

#### 3.3.3 컴파일·린트 설정

vendor 코드는 pi 저장소 규칙(`pi@v1.1.0:tsconfig.base.json`, `AGENTS.md` "Code Quality")을 전제로 한다: 상대 import에 `.ts` 확장자, `erasableSyntaxOnly`, `verbatimModuleSyntax`. vendor 패키지의 `tsconfig.json`:

```jsonc
{
  "extends": "../../tsconfig.base.json",   // 06의 공통 설정
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "erasableSyntaxOnly": true,               // TS 5.8+
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,  // TS 5.7+. 출력 .js에서 .ts 확장자를 바꿈
    "declaration": true,
    "sourceMap": true,
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

- 이 설정(출력 없는 형태)으로 vendor 시제품이 TypeScript 5.9.3과 6.0.3 모두에서 오류 0건이었다 [실험 P4 fork-proto `tsc -p`].
- pi 저장소는 TypeScript 7.0.2를 쓴다(pi-facts-2 §1.1). 업그레이드 때 TS 7 전용 문법이 들어왔는지는 §3.18.4 체크리스트 7번의 타입 검사로 확인한다.
- 포맷터·린터(06은 ESLint + Prettier [P3 메모])는 `vendor/*/src/**`와 `vendor/*/test/**`를 제외한다. 포맷을 바꾸면 업스트림과의 3-way 병합이 모든 줄에서 충돌한다. vendor에 새로 쓴 Helm 파일도 같은 스타일(탭, 120자)로 손으로 맞춘다.
- `tsc --noEmit` 타입 검사는 vendor도 포함한다(`just check`).

### 3.4 pi-agent-core 파일 계획 [제안 D07-2]

12 RT-1에 맞춰 `Agent` 클래스는 가져오지 않는다. Helm 런타임은 저수준 함수 `runAgentLoop`·`runAgentLoopContinue`·`runToolCall`만 쓴다. `Agent`는 메시지·큐·상태를 메모리에 두는데, Helm은 그 상태를 SQLite에 두므로 두 벌이 된다(12 §2.3 RT-1, cases §12.2-3).

| 원본(`pi@v1.1.0:packages/agent/`) | 줄 수 | Helm 경로 | 처리 | 패치 |
|---|---|---|---|---|
| `src/agent-loop.ts` | 949 | `vendor/pi-agent-core/src/agent-loop.ts` | 가져와 고침 | A1, A2, A3, A4, A5, A6 |
| `src/types.ts` | 539 | `vendor/pi-agent-core/src/types.ts` | 가져와 고침 | A2, A4, A5, A7 |
| `src/index.ts` | 5 | `vendor/pi-agent-core/src/index.ts` | 새로 씀(아래) | - |
| `src/agent.ts` | 613 | 가져오지 않음 | `Agent` 클래스(메모리 상태·큐). 12 RT-1. 큐 동작(`PendingMessageQueue`, `agent.ts:143-174`)은 12의 입력 inbox 설계 참고로만 쓴다 | - |
| `src/proxy.ts` | 393 | 가져오지 않음 | 서버 경유 스트림. 데몬이 provider를 직접 부른다 | - |
| `src/stream-fn.ts` | 20 | 가져오지 않음 | 전역 기본 streamFn. 테스트·run 사이에 상태를 공유한다 | A6 |
| `test/agent-loop.test.ts` | 2,234 | `vendor/pi-agent-core/test/agent-loop.test.ts` | 가져옴. "default stream function compatibility" describe 1개 삭제(A6), "action:end receives finalized turn context …" 테스트의 이벤트 순서 기대값에 `tool_execution_executing` 1개 추가(A5) | A5, A6 |
| `test/utils/*` | - | `vendor/pi-agent-core/test/utils/` | 그대로 | - |
| `test/agent.test.ts`, `e2e.test.ts`, `proxy.test.ts` | 1,735 | 가져오지 않음 | `Agent`·실제 provider·proxy 대상 | - |
| `examples/mcp-codemode/*` | - | 참고 | `runToolCall()`로 pi-mcp·pi-codemode를 잇는 예. §3.12의 근거 | - |

```ts
// vendor/pi-agent-core/src/index.ts  (Helm 신규)
// @helm-vendor helm-new (not from upstream)
export * from "./agent-loop.ts";
export * from "./types.ts";
```

가져오는 두 파일이 import하는 것은 `@earendil-works/pi-ai`, `typebox`, `./stream-fn.ts`뿐이다(`agent-loop.ts:6-30`, `types.ts:1-17`) [원문]. 끊을 내부 의존은 `./stream-fn.ts`(A6) 하나다.

[실험] 패치 적용본(`.helm-design-work/P4/apply-agent-patches-v2.py`)에서 업스트림 `agent-loop.test.ts`의 남은 37건 중 36건이 통과했다. 실패 1건은 A5로 이벤트가 하나 늘어 정확한 이벤트 목록을 비교하는 테스트이고, 위 표대로 기대값을 고친다(`.helm-design-work/P4/fork-proto/test/upstream-tests.out.txt`). 시제품 계약 테스트는 §3.10.

### 3.5 pi-agent-core 수정 사항

12 §3.4.1이 07에 요구한 변경 F-1~F-7을 모두 받는다. 이름과 모양은 아래로 정한다. 행 번호는 `pi@v1.1.0` 원본 기준이다. 적용 스크립트 시제품: `.helm-design-work/P4/apply-agent-patches-v2.py`, 적용 결과 `fork-proto/vendor/pi-agent-core/src/`.

| 패치 | 12의 요구 | 종류 | 요지 |
|---|---|---|---|
| A1 | F-3 | 행동 변경 | 호출자·`prepareRequest`·`prepareNextTurn`이 준 컨텍스트 배열을 복사해 쓴다 |
| A2 | F-1 | 필드 추가 | 도구 호출 결과·`tool_execution_end`에 `executed`, `rejection`, `args` |
| A3 | (F-1 범위, 12 §3.4.7 마지막 행) | 행동 변경 | 중단 시 남은 호출도 모두 결과를 받는다 |
| A4 | F-2 | 필드 추가 + 계약 | `BeforeToolCallResult.args`로 실행 인자를 명시 교체(재검증), 제자리 변경은 계약으로 적음 |
| A5 | F-4 | 이벤트 추가 | 실행 직전 `tool_execution_executing` |
| A6 | F-5 | 정리 | 전역 기본 streamFn·proxy 제거, `streamFn` 필수 |
| A7 | F-6 | 주석 | `finishTurn` 결정이 error/aborted에서 무시됨, `replay`를 루프가 읽지 않음 |
| (I1~I3) | F-7 | 테스트 | 내보내기 표면 무결성 테스트(§3.19.1) |

#### A1. 받은 컨텍스트를 복사한다 (행동 변경, F-3)

- 위치: `agent-loop.ts:144`(`runAgentLoopContinue`의 `{ ...context }`), `:188`(`prepareNextTurn`의 `nextTurnSnapshot.context`), `:228`(`prepareRequest`의 `requestUpdate.context`).
- 변경: 세 곳 모두 `copyContext()`로 감싼다.

```ts
// HELM-PATCH A1: never mutate a context array supplied by the caller, prepareRequest or prepareNextTurn.
function copyContext(context: AgentContext): AgentContext {
	return { ...context, messages: context.messages.slice(), ...(context.tools ? { tools: context.tools.slice() } : {}) };
}
// :228
currentContext = requestUpdate.context ? copyContext(requestUpdate.context) : currentContext; // HELM-PATCH A1
```

- 이유: 루프는 교체된 배열에 assistant 메시지(스트리밍 중 부분 메시지 포함)와 도구 결과를 `push`한다(F3). 12는 매 요청 새 배열을 넘기기로 했다(F-3, 12 §3.4.8). A1은 그 규약에 더해 루프 쪽에서도 넘긴 배열을 바꾸지 않게 한다. 투영 캐시나 결정성 시험(12 T-PJ-01~03)이 루프의 `push`에 흔들리지 않는다.
- 영향: 루프 내부 동작은 같다(루프는 자기 사본에 계속 쌓는다).
- 테스트: C7 [실험: 넘긴 배열 길이 3, 5가 실행 뒤에도 그대로].

#### A2. 실행 여부와 거부 이유, 실행 인자를 싣는다 (필드 추가, F-1)

- 위치: `types.ts:449-455`(`AgentToolCallOutcome`), `:531-539`(`tool_execution_end`), `agent-loop.ts:669-673`(`ImmediateToolCallOutcome`), `:708-777`(`prepareToolCall`), `:478-503`(길이 초과), `:550-556`, `:605-617`, `:619-628`(즉시 결과·중단), `:811-819`(`runToolCall`), `:904-910`(`finalizeExecutedToolCall` 반환), `:919-928`(`emitToolExecutionEnd`).
- 추가 타입(12 F-1의 모양에 `hook_error`를 더함):

```ts
// vendor/pi-agent-core/src/types.ts
/** HELM-PATCH A2: why a tool call was settled without calling `execute()`. */
export interface ToolCallRejection {
	kind:
		| "unknown_tool"            // context.tools에 그 이름이 없다
		| "invalid_args"            // prepareArguments·스키마 검증 실패, 또는 A4 교체 인자 검증 실패
		| "hook_error"              // beforeToolCall이 예외를 던졌다 (12의 훅은 예외를 차단으로 바꾸므로 정상 경로에서는 나오지 않는다)
		| "blocked"                 // beforeToolCall이 { block: true }
		| "aborted_before_execute"  // 실행 시작 전에 run이 중단됐다 (A3의 남은 호출 포함)
		| "truncated_response";     // assistant 메시지가 "length"로 끝나 그 안의 호출을 하나도 실행하지 않았다
	message: string;              // 모델에게 간 오류 결과 문구와 같다
}

export interface AgentToolCallOutcome {
	toolCall: AgentToolCall;
	result: AgentToolResult<any>;   // structuredContent 포함(F7)
	isError: boolean;
	executed: boolean;              // HELM-PATCH A2: execute()가 불렸다(성공·실패·afterToolCall 예외 포함)
	rejection?: ToolCallRejection;  // HELM-PATCH A2: executed가 false일 때
	args?: unknown;                 // HELM-PATCH A2: execute()에 넘긴 인자(beforeToolCall 뒤). executed일 때만
	durationMs?: number;
}

// AgentEvent 중
| {
		type: "tool_execution_end";
		toolCallId: string;
		toolName: string;
		result: any;
		isError: boolean;
		durationMs?: number;
		executed: boolean;              // HELM-PATCH A2
		rejection?: ToolCallRejection;  // HELM-PATCH A2
		args?: unknown;                 // HELM-PATCH A2
  };
```

- `prepareToolCall`(`:708-777`)을 단계별로 나눈다: 도구 찾기 실패 → `unknown_tool`; `prepareArguments`·`validateToolArguments` 예외 → `invalid_args`; `beforeToolCall` 예외 → `hook_error`; `block` → `blocked`; 중단 → `aborted_before_execute`. 원본은 검증과 훅 예외를 한 `try`(`:725-776`)로 묶어 구분하지 않는다.
- 이유
  1. 12는 실행되지 않은 결과와 실행한 오류 결과를 이벤트로 구분해야 한다(F-1, 12 §3.4.7). 문구를 해석하지 않는다. openclaw는 이 정보를 메모리 Map에만 두어 크래시 뒤 transcript 꼬리를 해석해야 했다(cases §12.2-2).
  2. 없는 도구·인자 오류에는 `beforeToolCall`이 불리지 않는다(F4). `tool_execution_end`는 A3 이후 모든 호출에 정확히 한 번 나가므로 기록 지점으로 쓸 수 있다.
  3. `structuredContent`는 `ToolResultMessage`에 없고 이 이벤트의 `result`에 있다(F7). pi-ai(고정 의존)의 `ToolResultMessage` 타입은 고치지 않는다. 12는 `afterToolCall`에서 구조화 결과를 기록한다(12 §3.4.6).
- 테스트: C3, C4, C5, C10, C13 [실험: `unknown_tool`, `invalid_args`, `hook_error`, `blocked`, `aborted_before_execute` 확인].

#### A3. 중단 시 남은 호출도 모두 결과를 받는다 (행동 변경)

- 위치: `agent-loop.ts:575-577`(순차), `:613-615`, `:641-643`(병렬).
- 변경: `break` 전에 남은 호출마다 `tool_execution_start` → `tool_execution_end`(`executed: false`, `rejection.kind: "aborted_before_execute"`, 내용 `"Operation aborted"`) → `toolResult` 메시지(순차는 즉시, 병렬은 원래 순서로)를 낸다. 도우미 `emitAbortedToolCall()`, `settleAbortedRemainder()`를 더한다.
- 이유: 원본은 남은 호출에 이벤트도 결과도 남기지 않는다(F8). 12 §3.4.7 마지막 행은 이 경우를 "결과 메시지 없음 → Helm이 투영에 같은 문구의 결과를 넣는다"로 처리하려 했다. A3가 있으면 루프가 결과를 만들므로 그 특례가 없어지고, pi-ai `transformMessages`의 `"No result provided"` 합성(`transform-messages.ts:155-180`)에도 기대지 않는다(§5.2 12에 대한 요구).
- 테스트: C9 [실험: 순차 3건 중 첫 건 실행 중 중단 → `s1` executed, `s2`·`s3` `aborted_before_execute`, 결과 메시지 3건].

#### A4. 실행 인자 교체를 명시 계약으로 둔다 (필드 추가, F-2)

- 위치: `types.ts:66-74`(`BeforeToolCallResult`), `:107-116`(`BeforeToolCallContext.args` 주석), `agent-loop.ts:728-769`.
- 변경

```ts
export interface BeforeToolCallResult {
	block?: boolean;
	reason?: string;
	/**
	 * HELM-PATCH A4: replacement arguments. Validated again against the tool schema; a validation failure
	 * becomes an `invalid_args` rejection. Mutating `context.args` in place also reaches `execute()`.
	 */
	args?: unknown;
	terminate?: boolean;
}
```

  루프는 `args`가 있으면 `validateToolArguments(tool, { ...toolCall, arguments: args })`로 다시 검증해 그 결과를 실행 인자로 쓴다. 실패하면 `rejection.kind: "invalid_args"`, 문구 앞에 `beforeToolCall args: `를 붙인다. `BeforeToolCallContext.args` 주석에 "검증된 복사본이고 제자리 변경도 `execute()`에 반영되며 assistant 메시지의 `toolCall.arguments`는 그대로"를 적는다.
- 이유: 12는 정규화한 절대 경로 등 실행 인자를 명시적으로 넘기고 기록한다(F-2, 12 §3.4.5). 제자리 변경은 코드상 동작하지만 agent-core 문서 계약이 아니었다(pi-facts-1 §0-1). coding-agent는 같은 동작을 공식 계약으로 쓴다(`coding-agent/src/core/extensions/types.ts:1426-1428`).
- 테스트: C6 [실험: 제자리 변경과 `{ args }` 교체 모두 실행에 반영, transcript 인자는 `nope.txt` 그대로, 교체 인자 검증 실패는 `invalid_args`].

#### A5. 실행 직전 이벤트 `tool_execution_executing` (이벤트 추가, F-4)

- 위치: `types.ts:529`(이벤트 유니온), `agent-loop.ts:558`(순차 실행 직전), `:629`(병렬 클로저 안 실행 직전).
- 변경: 실행이 허용된 호출마다 `execute()` 직전에 `{ type: "tool_execution_executing", toolCallId, toolName, args }`를 한 번 낸다. `args`는 실행 인자다. `tool_execution_start`는 원래대로 준비 전에 원시 인자로 한 번만 낸다.
- 12 F-4와의 차이: 12는 `tool_execution_start`를 `phase: "requested" | "executing"`으로 두 번 내자고 했다. 07은 별도 이벤트로 바꾼다. 같은 이벤트 종류가 호출당 두 번 나오면 start/end 짝을 세는 소비자(원본 `Agent.pendingToolCalls`, `agent.ts:580-592`)가 틀린다. 정보는 같다(§5.2 12에 대한 요구).
- 영향: 업스트림 테스트 1건의 정확한 이벤트 목록 기대값을 고친다(§3.4).
- 테스트: C2 [실험: 병렬에서 모든 `start`·`beforeToolCall`이 먼저, 그다음 허용된 호출의 `executing`이 이어지고, `end`는 끝난 순서].

#### A6. 전역 기본 streamFn을 없앤다 (정리, F-5)

- 위치: `agent-loop.ts:18`(import), `:124`, `:149`(`streamFn ?? getDefaultStreamFn()`), `stream-fn.ts` 전체, `proxy.ts` 전체.
- 변경: `stream-fn.ts`, `proxy.ts`를 가져오지 않는다. 루프는 받은 `streamFn`을 그대로 쓴다(타입은 원래부터 필수다, `agent-loop.ts:108,133`).
- 이유: 모듈 전역 상태라 테스트와 run 사이에 공유된다. Helm은 항상 `@helm/ai`의 `gateway.streamFor(ctx)`(12 §3.3.2)를 넘긴다.

#### A7. 주석 (F-6 등)

- `types.ts:155-158`(`FinishTurn`): error/aborted 응답에서도 불리지만 결정은 무시된다(`agent-loop.ts:245-256`).
- `types.ts:489-490`(`replay`): 루프는 이 필드를 읽지 않는다(pi-facts-1 §0-13). Helm 복구는 13의 도구 정의에서 읽는다(12 §3.7.2).

#### 바꾸지 않는 것과 이유

| 원본 동작 | 바꾸지 않는 이유 | Helm 쪽 처리 |
|---|---|---|
| `stopReason`이 `toolUse`가 아니어도 `toolCall` 블록을 실행한다(`agent-loop.ts:245-272`) | provider마다 stopReason 표기가 다르다 | C11로 고정. 커널 검사는 `beforeToolCall`에서 한다(12 §3.4.3) |
| `tool_execution_start`의 `args`는 검증 전 원시 인자(`:542-547`) | "호출 요청됨" 표시에는 원시 인자가 맞다 | 실행 인자는 A5·A2 |
| `ToolResultMessage`에 `structuredContent`가 없다(`:930-944`) | 타입이 pi-ai 소유다 | 12가 `afterToolCall`에서 기록, A2 이벤트에도 있음 |
| `afterToolCall`이 `content`만 바꾸면 `structuredContent`를 지운다(`:884-895`) | 맞지 않는 구조화 결과를 막는 의도된 동작 | 12의 `afterToolCall`은 `structuredContent`를 함께 돌려준다(12 §3.4.6 마지막 줄). C12 |
| 이벤트 싱크(`emit`)는 await되고, 싱크가 throw하면 `runAgentLoop`가 reject한다(`agent-loop.ts:117-124` 등 모든 `await emit`) | 12가 이 성질에 기댄다: 기록이 실패하면 도구 실행으로 넘어가지 않는다 | C1, C14 [실험: assistant `message_end` 싱크 예외 → reject, 도구 실행 0회] |
| steering·follow-up은 `getSteeringMessages`·`getFollowUpMessages` 폴링이다(`types.ts:282-306`) | 12가 입력 inbox로 공급한다(12 §3.4.2) | C18 |
| 병렬 모드: 준비(검증·`beforeToolCall`)는 순서대로, 실행만 동시(`:586-660`) | 의도 기록이 실행 전에 모두 끝나는 성질이 Helm에 맞다 | C2 |
| 재시도·컴팩션·세션이 없다(agent CHANGELOG 1.0.0) | Helm이 맡는다(12) | D07-10 |

### 3.6 coding-agent 도구 파일 계획 [제안 D07-4]

#### 3.6.1 가져올 파일

원본은 `pi@v1.1.0:packages/coding-agent/src/`다. 도구와 그 유틸은 `vendor/pi-tools/src/`, 이미지 처리 유틸 8개는 `vendor/pi-image/src/`로 나눈다(§3.6.4). 원본의 `core/tools/`와 `utils/` 두 단계를 `tools/`와 `utils/` 한 단계로 줄인다. 그래서 `"../../utils/` import가 `"../utils/`로 바뀐다(T11).

| 원본 | 줄 | Helm 경로 | 패치 | 역할 |
|---|---|---|---|---|
| `core/tools/read.ts` | 224 | `tools/read.ts` | T1, T2, T7, T12 | 텍스트(2000줄/50KB 잘림, 이어 읽기 안내)·이미지 읽기 |
| `core/tools/write.ts` | 97 | `tools/write.ts` | T1, T2, T7 | 덮어쓰기, 부모 디렉터리 생성, 파일별 직렬화 |
| `core/tools/edit.ts` | 220 | `tools/edit.ts` | T1, T2, T7, T11 | `edits[]` 정확 일치 교체, BOM·줄끝 보존, diff·patch 상세 |
| `core/tools/edit-diff.ts` | 556 | `tools/edit-diff.ts` | T11 | 매칭(유일성, 겹침 금지, 퍼지), diff 생성. 외부 `diff` |
| `core/tools/bash.ts` | 442 | `tools/bash.ts` | T1, T2, T4, T10, T11 | 셸 실행, 출력 누적·잘림·전체 출력 파일, 타임아웃, 프로세스 트리 종료, `structuredContent` |
| `core/tools/grep.ts` | 323 | `tools/grep.ts` | T1, T2, T3, T7 | `rg --json` 검색 |
| `core/tools/find.ts` | 318 | `tools/find.ts` | T1, T2, T3, T7 | `fd --glob` 검색 |
| `core/tools/ls.ts` | 175 | `tools/ls.ts` | T1, T2, T7 | 목록 |
| `core/tools/truncate.ts` | 314 | `tools/truncate.ts` | 없음 | 잘림 규칙 |
| `core/tools/path-utils.ts` | 118 | `tools/path-utils.ts` | T11 | `resolveToCwd`, macOS 스크린숏 이름 변형 |
| `core/tools/file-mutation-queue.ts` | 61 | `tools/file-mutation-queue.ts` | 없음 | 같은 파일 쓰기 직렬화 |
| `core/tools/output-accumulator.ts` | 257 | `tools/output-accumulator.ts` | T11 | bash 출력 누적과 임시 파일 |
| `core/tools/tool-definition-wrapper.ts` | 58 | `tools/tool-definition-wrapper.ts` | T9 | 정의 → `AgentTool` 변환 |
| `utils/shell.ts` | 218 | `utils/shell.ts` | T8 | 셸 찾기, 환경, 프로세스 트리 종료 |
| `utils/child-process.ts` | 137 | `utils/child-process.ts` | 없음 | `waitForChildProcess`(분리된 자손의 stdio 대기). 외부 `cross-spawn` |
| `utils/paths.ts` | 140 | `utils/paths.ts` | 없음 | 경로 정규화(`~`, `@`, `file://`, 유니코드 공백) |
| `utils/mime.ts` | 116 | `vendor/pi-image/src/mime.ts` | 없음 | 이미지 형식 판별 |
| `utils/text.ts` | 9 | `utils/text.ts` | 없음 | BOM 분리 |
| `utils/output-files.ts` | 34 | `utils/output-files.ts` | T5 | 전체 출력 파일 생성(0600, `wx`) |
| `utils/image-process.ts` | 119 | `vendor/pi-image/src/image-process.ts` | 없음 | 이미지 정규화·크기 조정 |
| `utils/image-convert.ts` | 89 | `vendor/pi-image/src/image-convert.ts` | T6 | PNG 변환(photon) |
| `utils/image-resize.ts` | 122 | `vendor/pi-image/src/image-resize.ts` | 없음 | worker 스레드 크기 조정 |
| `utils/image-resize-core.ts` | 174 | `vendor/pi-image/src/image-resize-core.ts` | 없음 | 크기 조정 본체 |
| `utils/image-resize-worker.ts` | 43 | `vendor/pi-image/src/image-resize-worker.ts` | 없음 | worker 진입점 |
| `utils/photon.ts` | 139 | `vendor/pi-image/src/photon.ts` | 없음 | `@silvia-odwyer/photon-node` 지연 로드 |
| `utils/exif-orientation.ts` | 182 | `vendor/pi-image/src/exif-orientation.ts` | 없음 | EXIF 방향 적용 |
| (신규) | 38 | `tool-definition.ts` | - | `ToolDefinition`, `PiToolContext`, `PathPolicy`(확장 타입 대체) |
| (신규) | 30 | `utils/tool-binaries.ts` | - | `rg`/`fd` 경로 해석, 내려받지 않음 |
| (신규) | 17 | `index.ts` | - | 진입점 |
| (신규) | 6 | `vendor/pi-image/src/index.ts` | - | `processImage`, `detectSupportedImageMimeTypeFromFile`, `convertImageBytesToPng` 내보내기 |

합계: 가져오는 원본 26개 4,685줄(`vendor/pi-tools` 18개, `vendor/pi-image` 8개) [원문 `wc -l`], 그중 수정 14개, 원본 그대로 12개, 신규 4개. [실험] 시제품은 두 패키지를 나누기 전 한 패키지(`vendor/pi-tools`)로 만들어 상태 검사(`scripts/vendor-sync.mjs status`)·컴파일·테스트를 했다. 나누는 것은 import 경로만 바꾸는 일이다(T12).

#### 3.6.2 가져오지 않는 파일과 이유

| 원본 | 이유 |
|---|---|
| `core/tools/renderers/*`(8개, 1,053줄), `core/tools/render-utils.ts` | pi-tui·interactive 테마 의존. 화면 표시는 Helm 클라이언트(20·21, TUI)가 결과 JSON으로 그린다 |
| `core/tools/powershell.ts` | Windows 전용. Helm은 WSL에서 실행(결정 20) |
| `core/tools/index.ts` | 렌더러 포함 정의, `createCodingTools` 묶음, 확장 타입. Helm은 `@helm/tools`가 묶음을 만든다 |
| `utils/tools-manager.ts`, `utils/management-http.ts` | 실행 중 GitHub에서 `rg`/`fd`를 내려받는다(F12). 데몬이 몰래 네트워크로 바이너리를 받는 동작은 원치 않는다. 설치는 `just setup`(06·17)에서 한다 |
| `core/extensions/types.ts`(2,273줄) | 확장 API 전체. 도구가 쓰는 멤버는 `cwd`, `model`, `sessionManager`, `thinkingLevel`뿐이다. `tool-definition.ts`로 대체 |
| `config.ts` | pi 설정 경로·`getBinDir`. `shell.ts`가 PATH에 pi bin을 붙이는 데만 쓴다(T8) |

#### 3.6.3 끊을 내부 의존

| 가져온 파일 | 끊는 import(원본 행) | 대체 |
|---|---|---|
| read, write, edit, grep, find, ls, bash | `./renderers/<이름>.ts`(read:10, write:8, edit:18, grep:10, find:9, ls:7, bash:18)와 정의 끝의 `...xxxRenderers` 전개(read:218, write:91, edit:214, grep:317, find:312, ls:169, bash:413) | 삭제(T1). bash의 `BASH_UPDATE_THROTTLE_MS`(renderers/bash.ts:19, 값 100)는 bash.ts 안 상수로(T10) |
| 같은 7개 | `../extensions/types.ts`의 `ExtensionContext`, `ToolDefinition`(read:8, write:5, edit:6, grep:8, find:7, ls:5, bash:16) | `../tool-definition.ts`의 `PiToolContext`, `ToolDefinition`(T2) |
| grep, find | `../../utils/tools-manager.ts`의 `ensureTool`(grep:7·119-123, find:6·172-180) | `../utils/tool-binaries.ts`의 `resolveToolBinary`(T3) |
| bash | `ctx.sessionManager`, `ctx.thinkingLevel`, `PI_*` 환경 변수(186-212) | 호출자가 준 환경 공급자(T4) |
| `utils/shell.ts` | `../config.ts`의 `getBinDir`(4·139-149) | 삭제(T8) |
| `utils/image-convert.ts` | `@earendil-works/pi-tui`의 `getCapabilities`, `setImageTranscoder`(1)와 터미널 함수 3개(36-89) | 삭제(T6) |
| `utils/output-files.ts` | `os.tmpdir()`(19) | 설정 가능한 디렉터리(T5) |
| `tool-definition-wrapper.ts` | `ExtensionToolContext`, `createToolDefinitionFromAgentTool`(2, 40-58) | `PiToolContext`, 함수 삭제(T9) |
| 모든 도구 | `@earendil-works/pi-agent-core` | `@helm/vendor-pi-agent-core`(T2) |

외부 의존은 `vendor/pi-tools`가 `@earendil-works/pi-ai`(타입), `typebox`, `diff`, `cross-spawn`, `vendor/pi-image`가 `@silvia-odwyer/photon-node`만 남는다. [실험] 진입점 두 개 로드에 303 ms(Node 24, 타입 제거 실행). 원본 coding-agent 루트 import는 634 ms, 외부 패키지 33개였다(pi-facts-1 §4.6).

#### 3.6.4 이미지 처리를 별도 vendor 패키지로 두는 이유

12 §3.3.8은 투영의 이미지(자극 blob)를 모델 한도에 맞춰 줄이는 데 coding-agent `utils/image-process.ts`를 쓰려 한다. 이 코드를 `vendor/pi-tools` 안에 두면 `@helm/ai`가 도구 vendor 패키지에 의존하게 되어 06 §3.4.1의 "vendor 패키지 하나 = 감싸는 패키지 하나" 규칙을 어긴다. 그래서 이미지 유틸 8개를 `@helm/vendor-pi-image`로 떼고, `@helm/ai`가 감싼다. read 도구는 vendor 안의 의존(`vendor-pi-tools` → `vendor-pi-image`)으로 같은 코드를 쓴다.

```ts
// vendor/pi-image/src/index.ts  (Helm 신규)
// @helm-vendor helm-new (not from upstream)
export { processImage, type ProcessImageOptions, type ProcessImageResult } from "./image-process.ts";
export { detectSupportedImageMimeTypeFromFile, detectSupportedImageMimeType } from "./mime.ts";
export { convertImageBytesToPng } from "./image-convert.ts";
```

`processImage(bytes, mimeType, { autoResizeImages, resizeOptions })`는 PNG·JPEG·GIF·WebP는 그대로 두고 그 밖은 PNG로 바꾼 뒤, `resizeOptions`(pi-ai 모델의 `inputLimits.images.resize`)에 맞춰 worker 스레드에서 줄인다(`image-process.ts:70-119`, `image-resize.ts:89-100`) [원문]. 실패하면 `{ ok: false, message }`를 돌려주고 throw하지 않는다. 결정적인지(같은 입력 → 같은 바이트)는 photon 구현에 달려 있다 [가정]. 12의 캐시(`sha256` 키)가 결과를 고정하므로 투영 바이트는 같게 유지된다.

### 3.7 도구 수정 사항

적용 스크립트 시제품: `.helm-design-work/P4/apply-tools-patches.py`. 결과: `fork-proto/vendor/pi-tools/src/`.

| ID | 대상 | 변경 | 이유 | 테스트 |
|---|---|---|---|---|
| T1 | 도구 7개 | 렌더러 import와 `...xxxRenderers` 전개 삭제. edit의 `renderShell: "self"`와 `EditRenderState` 타입 인자, bash의 `BashRenderState` 삭제 | pi-tui 의존 제거 | 컴파일 |
| T2 | 도구 7개 + 래퍼 | 확장 타입을 `tool-definition.ts`로 대체. `ctx?: ExtensionContext` → `ctx?: PiToolContext`. `PiToolContext.model`은 `Pick<Model<Api>, "input" \| "inputLimits">`(read가 쓰는 두 필드)이고, 이에 맞춰 read의 `getNonVisionImageNote`(`read.ts:79`) 인자 타입을 `Pick<Model<Api>, "input">`로 바꾼다. pi-agent-core import를 vendor 패키지로 | 확장 API 의존 제거. `@helm/tools`가 pi-ai를 import하지 않고 모델 정보를 넘길 수 있다(§3.9.1) | 컴파일 |
| T3 | grep, find | `ensureTool("rg"\|"fd")`를 `resolveToolBinary()`로 바꾼다. 설정된 경로 → PATH의 `rg` / `fd`·`fdfind` 순으로 찾고, 없으면 `"tool.binary_missing: <tool>"`(13 §3.3.6의 오류 코드) 문구로 던진다. 내려받지 않는다 | 데몬의 숨은 네트워크 동작 제거(F12). 결과를 프로세스 수명 동안 캐시한다 | C21 |
| T4 | bash | `resolveSpawnContext(command, cwd, spawnHook, baseEnv)`로 바꿔 `PI_SESSION_ID` 등 `PI_*` 변수와 `ctx.sessionManager` 사용을 없앤다. 옵션 `exposeSessionEnvironment`를 없애고 `env?: () => NodeJS.ProcessEnv`를 더한다(기본 `getShellEnv`). 호출별 값(13의 `HELM_RUN_ID`, `HELM_TOOL_CALL_ID`)은 `PiToolContext.env`로 넘기면 옵션 환경 위에 덮는다 [제안, 시제품은 옵션 환경만]. 시스템 프롬프트 지침 "You can inspect PI_* environment variables"를 지운다. 임시 파일 접두어 `pi-bash` → `helm-bash` | 셸 환경을 호출자가 정한다. `@helm/tools`는 비밀이 빠진 환경만 넘긴다(F13, 18) | C21 [실험: 데몬 환경의 `ANTHROPIC_API_KEY`가 셸에서 빈 값] |
| T5 | `utils/output-files.ts` | `setOutputDirectory(dir)`를 더하고 `createOutputFilePath`가 그 디렉터리(없으면 `tmpdir()`)를 쓴다 | bash 잘림 때 전체 출력 경로가 관찰 기록에 남는다. `/tmp`는 재부팅에 지워진다. Helm은 런타임 데이터 디렉터리(17, 예: `/srv/volumes/helm/tool-output/`)를 쓴다 | 단위 테스트 |
| T6 | `utils/image-convert.ts` | pi-tui import와 `convertToPng`, `loadPngTranscoder`, `ensurePngTranscoder`(36-89) 삭제 | 터미널 이미지 표시용 함수다 | [실험] 1×1 PNG 읽기 → `["text","image"]` |
| T7 | read, write, edit, grep, find, ls | 옵션에 `pathPolicy?: PathPolicy`를 더하고, 경로를 푼 직후 `await options?.pathPolicy?.check(access, absolutePath)`를 부른다. read: `resolveReadPathAsync` 뒤, write·edit: 파일 직렬화 큐 안에서 쓰기 전, grep·find·ls: 검색 루트를 푼 뒤 | 커널의 범위 검사(`beforeToolCall`, 10·13)와 별개로 도구 층에서 한 번 더 막는다. 도구 안에서 푼 실제 경로(`~`, `@`, `file://`, 상대 경로, macOS 이름 변형)를 검사할 수 있는 곳은 여기뿐이다. 정책이 던지면 그 호출은 `executed: true`인 오류 결과다 | C21 [실험: `/etc/hostname` 읽기가 "path outside workspace (read)"로 실패] |
| T7+ | 같음 | `check()`가 문자열을 돌려주면 도구는 그 경로를 쓴다. 13의 `canonicalize`(13 §3.4.2: `realpath`, 링크 판정, 가림 목록)를 그대로 넣어 "검사한 경로 = 연 경로"를 보장한다. read는 macOS 이름 변형 재시도(`path-utils.ts:86-118`) 뒤의 경로를 넘기므로 변형 재시도도 남는다(13 §3.3.1과 같음) | 13 §3.3.1 "`resolveToCwd`를 `canonicalize`로" 요구를 도구 원본을 덜 고치고 받기 위해 | 단위 테스트 [제안, 시제품은 `void`만] |
| T8 | `utils/shell.ts` | `getBinDir` import 삭제. `getShellEnv()`는 `{ ...process.env }`만 돌려준다 | pi 설정 디렉터리 의존 제거 | 컴파일 |
| T9 | `tool-definition-wrapper.ts` | `ToolContextFactory`가 `PiToolContext`를 돌려준다. `execute`의 다섯째 인자를 받지 않고 팩토리 값만 넘긴다. `createToolDefinitionFromAgentTool` 삭제 | 확장 타입 제거 | 컴파일 |
| T10 | bash | `BASH_UPDATE_THROTTLE_MS = 100` 상수를 파일 안에 둔다 | 렌더러에서 옮김 | 컴파일 |
| T11 | edit, edit-diff, bash, path-utils, output-accumulator | `"../../utils/` → `"../utils/` | 디렉터리를 한 단계 줄임 | 컴파일 |
| T12 | read | `processImage`(`../../utils/image-process.ts`), `detectSupportedImageMimeTypeFromFile`(`../../utils/mime.ts`) import를 `@helm/vendor-pi-image`로 | 이미지 유틸을 별도 패키지로 뗌(§3.6.4) | 컴파일, 이미지 읽기 시험 |
| T13 | bash | 옵션 `defaultTimeoutSeconds?`, `maxTimeoutSeconds?`를 더한다. `resolveTimeoutMs`(`bash.ts:27-38`)가 인자 없음 → 기본값, 상한 초과 → 오류로 쓴다(원본은 기본 없음, 상한 2,147,483초) | 13 §3.3.1의 "bash 기본 300초, 최대 3,600초" | 단위 테스트 [제안] |
| T14 | grep, find | 옵션 `spawn?: (command: string, args: string[], options: { cwd?: string }) => ChildProcess`를 더하고 `rg`(`grep.ts:168`)·`fd`(`find.ts:216`) 실행에 쓴다(기본 `child_process.spawn`) | 원본 `GrepOperations`는 `isDirectory`·`readFile`만 바꿀 수 있고 `rg`는 항상 로컬에서 실행된다(pi-facts-1 §0-7). 13 §3.3.1의 "샌드박스 안에서 `rg`·`fd` 실행"(bwrap 래핑)을 위해 | 단위 테스트 [제안] |

```ts
// vendor/pi-tools/src/tool-definition.ts  (Helm 신규, 시제품 그대로)
// @helm-vendor helm-new (not from upstream)
import type { AgentToolResult, AgentToolUpdateCallback, ToolExecutionMode } from "@helm/vendor-pi-agent-core";
import type { Api, ConstrainedSamplingConfig, Model } from "@earendil-works/pi-ai";
import type { Static, TSchema } from "typebox";

/** Path access the tool is about to perform. Throw to refuse. Called with absolute, lexically resolved paths. */
export interface PathPolicy {
	/** throw로 거부. 문자열을 돌려주면 도구는 그 경로를 연다(T7+, 예: 13의 canonicalize 결과) */
	check(access: "read" | "write" | "search", absolutePath: string): void | string | Promise<void | string>;
}

/** Per-call context supplied by the Helm runtime (replaces pi's ExtensionContext for tools). */
export interface PiToolContext {
	cwd?: string;          // 이 호출의 작업 디렉터리. 팩토리 cwd보다 우선
	model?: Pick<Model<Api>, "input" | "inputLimits">; // read가 이미지 한도와 비시각 모델 안내에 쓴다(T2)
	env?: NodeJS.ProcessEnv;  // bash: 호출별 환경 변수. 옵션 env 위에 덮는다(T4)
}

export interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown> {
	name: string;
	label: string;
	description: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	parameters: TParams;
	outputSchema?: TSchema;
	constrainedSampling?: false | ConstrainedSamplingConfig;
	prepareArguments?: (args: unknown) => Static<TParams>;
	executionMode?: ToolExecutionMode;
	execute(
		toolCallId: string,
		params: Static<TParams>,
		signal: AbortSignal | undefined,
		onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
		ctx?: PiToolContext,
	): Promise<AgentToolResult<TDetails>>;
}
```

```ts
// vendor/pi-tools/src/utils/tool-binaries.ts  (Helm 신규)
// @helm-vendor helm-new (not from upstream)
export function configureToolBinaries(paths: Partial<Record<"rg" | "fd", string>>): void;
/** 설정 → PATH(rg / fd, fdfind) 순. `<bin> --version` 종료 코드 0이면 채택하고 캐시한다. 없으면 throw. */
export function resolveToolBinary(tool: "rg" | "fd"): string;
```

`PathPolicy`는 어휘상 푼 절대 경로를 받는다. 심볼릭 링크 판정(실제 경로가 허용 루트 안인가)은 정책 구현(`@helm/tools`의 `createPathPolicy`, §3.9.4)이 `realpath`로 한다. 아직 없는 파일(write)은 가장 가까운 존재하는 조상의 `realpath`로 판정한다.

도구 층에서 하지 않는 것: bash 명령 문자열의 범위 검사. 명령 문자열로는 쓰기 범위를 지킬 수 없다(pi-facts-1 §9.3-3, extracts-3 X3-4-14). bash의 격리는 13이 `BashOperations` 주입 또는 `spawnHook`(예: bubblewrap 래핑)으로 정한다. 포크는 두 주입 지점을 그대로 둔다(`bash.ts:75-94`, `:178-184`). pi-chat이 같은 주입 지점으로 도구를 VM에서 실행한다(cases §10.2).

### 3.8 새로 쓸 연결 코드 [제안]

pi 코드를 Helm 패키지 경계에 맞추는 코드다. 공개 API의 모양은 소유 문서가 정한다: `@helm/ai`의 `ModelGateway`는 12 §3.3.2, `@helm/agent`의 사용 방식은 12 §3.4, `@helm/tools`의 도구 명세(`HelmToolSpec`)는 13. 07이 쓰는 것은 그 아래의 pi 연결부다.

| 파일 | 하는 일 | 대략 줄 수 [가정] |
|---|---|---|
| `packages/domain/src/model.ts`(08 소유 파일, 07이 내용 제안) | 저장·전송되는 모델 데이터 타입. Helm 소유, pi-ai 1.1.0과 같은 모양(§3.9.2) | 120 |
| `packages/ai/src/pi.ts` (`@helm/ai/pi` 하위 경로) | 루프 연결에만 쓰는 pi-ai 기계 타입의 재export(§3.9.2) | 20 |
| `packages/ai/src/pi/models.ts` | pi `createModels()`, 필요한 provider만 `setProvider()`, 설정의 추가 모델 등록, `EnvCredentialStore` 주입(12 §3.3.4) | 150 |
| `packages/ai/src/pi/faux.ts` | 테스트용 faux provider 생성(`api` 고정, §3.11.1). 12의 가짜 모델 대본 API가 이것을 쓴다 | 60 |
| `packages/ai/test/model-types.test.ts` | I5: `@helm/domain/model` ↔ pi-ai 타입 상호 대입 | 40 |
| `packages/agent/src/index.ts` | vendor 루프 재export + `assertToolDeclarations()`(투영의 선언 도구와 실행 도구 일치 검사, C8) | 60 |
| `packages/tools/src/pi/coding.ts` | vendor 도구 정의 7개를 13의 도구 명세로 감쌈. 경로 해석 함수(`resolveToCwd`, `resolveReadPathAsync`)를 13의 `prepare`가 쓰도록 내보냄 | 150 |
| `packages/tools/src/pi/path-policy.ts` | `createPathPolicy(roots)`: `realpath` 기반 허용 루트 판정(T7의 정책 구현) | 80 |
| `packages/tools/src/pi/shell-env.ts` | `buildShellEnv(allow)`: 허용 목록 방식 셸 환경(T4) | 50 |
| `packages/tools/src/pi/repl.ts` | REPL 단계: pi-codemode 샌드박스 생성과 도구 브리지(§3.12) | 150 |
| `packages/tools/src/pi/mcp.ts` | MCP 단계: pi-mcp 클라이언트, `outputSchema` 검증(§3.13) | 250 |
| `packages/ai/src/images.ts`(12 소유)가 쓰는 것 | `@helm/vendor-pi-image`의 `processImage`(§3.6.4) | - |

### 3.9 pi 타입 경계 [제안 D07-8]

#### 3.9.1 원칙

1. pi 코드(`@earendil-works/*`, `@helm/vendor-*`)를 import하는 Helm 패키지는 06 §3.4.1 끝 목록의 "감싸는 패키지"뿐이다. 07이 확정하는 대응: pi-ai → `@helm/ai`, `@helm/vendor-pi-agent-core` → `@helm/agent`, `@helm/vendor-pi-tools`·pi-codemode·pi-mcp → `@helm/tools`, `@helm/vendor-pi-image` → `@helm/ai`, pi-tui → `@helm/tui`(apps/tui).
2. vendor 패키지끼리, vendor → 고정 의존 pi 패키지 의존은 허용한다(vendor 안의 일이다): `vendor-pi-tools` → `vendor-pi-agent-core`(타입), `vendor-pi-image`, pi-ai(타입). `vendor-pi-agent-core` → pi-ai.
3. **저장·전송되는 모델 데이터**(메시지, 콘텐츠 블록, 도구 선언, 사용량, thinking 수준, stopReason)는 `@helm/domain/model`의 Helm 소유 타입이다. 이벤트 로그(09)·실행 기록(12 §3.4.10)·프로토콜(19)은 이 타입만 쓴다. pi-ai 타입과 같은 모양이므로 변환 없이 넘긴다. 같은 모양인지는 I5가 컴파일 때 검사한다. pi가 모양을 바꾸면 I5가 실패하고 `@helm/ai`에 변환을 쓴다. 저장된 옛 데이터는 Helm 타입이 정하므로 그대로 읽힌다.
4. **루프 연결에만 쓰는 pi 기계 타입**(`Model<Api>`, `Api`, `TranscriptContext`, `SimpleStreamOptions`, `AssistantMessageEventStream`, `AssistantMessageEvent`)과 투영의 도구 선언 함수 3개(`getCurrentTools`, `toToolDeclaration`, `createInitialSystemMessage`)는 `@helm/ai/pi` 하위 경로로만 재export한다. 이것을 import할 수 있는 곳은 `@helm/agent`, `@helm/ai` 자신, `@helm/runtime`의 루프 구동·투영 생성 파일(12 §3.1의 `run/engine.ts`, `run/hooks.ts`, `projection/model.ts`, `ports/*`)이다.
5. 포크한 루프의 타입·함수(`runAgentLoop`, `runAgentLoopContinue`, `runToolCall`, `AgentLoopConfig`, `AgentEvent`, `AgentTool`, `AgentToolCallOutcome`, `ToolCallRejection`)는 Helm 저장소의 코드다. `@helm/agent`가 그대로 재export하고, 12의 루프 구동 파일이 쓴다.
6. 검사는 §3.19.1 I4가 한다. 06 §3.5 R7과 같은 스크립트에 넣는다.

| import 하는 쪽 \ 대상 | pi-ai | pi-codemode | pi-mcp | pi-tui | `@helm/vendor-pi-agent-core` | `@helm/vendor-pi-tools` | `@helm/vendor-pi-image` | `@helm/ai/pi` |
|---|---|---|---|---|---|---|---|---|
| `vendor/pi-agent-core` | O | - | - | - | - | - | - | - |
| `vendor/pi-tools` | O(타입) | - | - | - | O(타입) | - | O | - |
| `vendor/pi-image` | - | - | - | - | - | - | - | - |
| `@helm/ai` | O(`src/pi/`, `src/pi.ts`) | - | - | - | - | - | O(`src/images.ts`) | - |
| `@helm/agent` | - | - | - | - | O | - | - | O |
| `@helm/tools` | - | O(`src/pi/repl.ts`) | O(`src/pi/mcp.ts`) | - | - | O(`src/pi/`) | - | - |
| `@helm/runtime` | - | - | - | - | - | - | - | O(루프 구동·투영 생성 파일만) |
| `@helm/tui`(apps/tui) | - | - | - | O | - | - | - | - |
| 그 밖(`domain`, `protocol`, `kernel`, `store`, `engine`, `observer`, `daemon`, `client`, `desktop`, `cli`, `testkit`) | X | X | X | X | X | X | X | X |

`@helm/tools`는 06 §3.4.1에서 `domain`만 의존한다. 07도 그대로 둔다: vendor 도구의 `PiToolContext.model`은 `Pick<Model<Api>, "input" | "inputLimits">`로 줄였으므로(T2) `@helm/tools`는 `@helm/domain/model`의 모델 정보로 그 모양을 채운다.

#### 3.9.2 `@helm/domain/model`과 `@helm/ai/pi`

```ts
// packages/domain/src/model.ts — Helm 소유. 모양은 pi-ai 1.1.0과 같다
//   (pi@v1.1.0:packages/ai/src/types.ts:401-456, 528-607, 736-741). 최종 이름·위치는 08이 정한다.
import type { TSchema } from "typebox";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
/** Helm에 들어오는 값. pi의 "pending"·"deferred"는 @helm/ai가 "error"로 바꾼다(§3.9.3 규칙 2) */
export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export interface TextContent { type: "text"; text: string; textSignature?: string }
export interface ThinkingContent { type: "thinking"; thinking: string; thinkingSignature?: string; redacted?: boolean }
export interface ImageContent { type: "image"; data: string /* base64 */; mimeType: string }
export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: JsonObject;        // 모델이 낸 그대로(실행 인자와 다를 수 있다, F5)
  thoughtSignature?: string;    // Google
  namespace?: string;           // OpenAI Responses
}
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: TSchema;
  constrainedSampling?: false | { type: "json_schema"; strict: "prefer" | "require" };
}
export interface Usage {
  input: number; output: number; cacheRead: number; cacheWrite: number;
  cacheWrite1h?: number; reasoning?: number; totalTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }; // USD
}
export interface SystemMessage {
  role: "system";
  content: string | TextContent[];
  sections?: Record<string, string | null>;   // 이름 붙은 절. null은 삭제
  toolsAdded?: ToolDeclaration[];
  toolsRemoved?: { name: string }[];
  timestamp: number;
}
export interface UserMessage { role: "user"; content: string | (TextContent | ImageContent)[]; timestamp: number }
export interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: string;
  provider: string;
  model: string;
  responseModel?: string;
  responseId?: string;
  thinkingLevel?: ThinkingLevel;
  usage: Usage;
  stopReason: StopReason;
  errorMessage?: string;
  timestamp: number;
  durationMs?: number;
}
export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  details?: JsonValue;
  usage?: Usage;
  isError: boolean;
  timestamp: number;
  durationMs?: number;
}
export type Message = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;
export interface ModelRef { provider: string; id: string }   // 12 §3.3.2와 같음
```

```ts
// packages/ai/src/pi.ts  (@helm/ai/pi 하위 경로) — 루프 연결 전용 재export
export type {
  Api, Model, TranscriptContext, SimpleStreamOptions,
  AssistantMessageEvent, AssistantMessageEventStream,
} from "@earendil-works/pi-ai";
export type { Message as PiMessage, AssistantMessage as PiAssistantMessage } from "@earendil-works/pi-ai"; // I5·변환용
export { getCurrentTools, toToolDeclaration, createInitialSystemMessage } from "@earendil-works/pi-ai"; // 투영의 도구 선언 생성·검사용(C8, M11)
```

#### 3.9.3 변환 규칙

1. pi `Message`와 `@helm/domain/model`의 `Message`는 지금 구조가 같다. `@helm/ai`는 객체를 복사하지 않고 넘긴다. I5가 두 방향 대입 가능을 검사한다.
2. pi 메시지의 `stopReason`이 `pending`이나 `deferred`면 `@helm/ai`가 `stopReason: "error"`, `errorMessage: "unsupported stop reason <x>"`로 바꾼다. Helm은 deferred 요청을 쓰지 않는다(§4 E6).
3. pi가 더 가진 필드(`providerThinkingLevel`, `diagnostics`, `rawStopReason`, `endTurn`, `deferred`, `nestedCalls`)는 지우지 않고 보존한다. Helm 코드는 읽지 않는다. 저장할 때도 그대로 둔다(제공자 이어가기에 쓰일 수 있다).
4. 스트림 이벤트의 `partial`은 진행 중 갱신되는 공유 객체다(pi-facts-1 §2.5). 저장하거나 다른 비동기 경계로 넘길 때는 필요한 필드만 복사한다(12 §3.4.4와 같음).
5. pi 타입을 `@helm/domain/model` 이름으로 바꿔 부르는 별칭 재export는 하지 않는다. 별칭이면 pi가 모양을 바꿀 때 Helm 전체가 따라 바뀐다.

#### 3.9.4 `@helm/agent`

`@helm/agent`는 Helm 도메인을 모르는 범용 루프다(06 §3.4.8). 공개 API:

```ts
// packages/agent/src/index.ts
export {
  runAgentLoop, runAgentLoopContinue, runToolCall,            // 저수준 루프(A1~A7 적용)
  type AgentLoopConfig, type AgentContext, type AgentEvent, type AgentEventSink,
  type AgentTool, type AgentToolResult, type AgentToolCall, type AgentToolCallOutcome,
  type ToolCallRejection, type BeforeToolCallContext, type BeforeToolCallResult,
  type AfterToolCallContext, type AfterToolCallResult, type PrepareRequest, type FinishTurn,
  type StreamFn, type ToolExecutionMode, type AgentMessage,
} from "@helm/vendor-pi-agent-core";

/** 투영의 선언 도구(system 메시지 재생, getCurrentTools)와 실행 도구의 이름 집합이 같은지. 다르면 throw. */
export function assertToolDeclarations(messages: readonly import("@helm/domain/model").Message[],
  tools: readonly { name: string }[]): void;
```

- `agentLoop`·`agentLoopContinue`(`EventStream`을 돌려주는 판)는 내보내지 않는다. 그 스트림은 소비자를 기다리지 않는다(pi-facts-1 §3.6). Helm은 싱크를 await하는 `run*` 판만 쓴다.
- `assertToolDeclarations`는 12의 `prepareRequest`(12 §3.4.8 "다르면 투영 오류로 run을 실패")가 부른다. 구현: `getCurrentTools`(pi-ai `utils/transcript.ts:58-66`)와 같은 재생 규칙을 Helm 쪽에 두거나 pi-ai 함수를 `@helm/ai/pi`에서 함수로도 재export한다 [제안: 후자].

#### 3.9.5 `@helm/tools`와 vendor 도구

도구 명세의 공개 모양은 13이 정한다(06 §3.4.9의 `createPrimitiveTools`, `ToolMeta`, `ScopeChecker`, 12가 인용한 `HelmToolSpec`). 07이 정하는 것은 vendor 도구를 그 명세로 감쌀 때의 규칙이다.

| 13 명세의 요소(12 §3.4.5·§3.4.6 인용) | vendor에서 쓰는 것 |
|---|---|
| `prepare(args)`: 경로 정규화, 대상, 사전 해시 | 13의 `canonicalize`(13 §3.4.2). 그 앞 단계의 원본 해석(`@`, `~`, `file://`, 유니코드 공백)은 vendor의 `resolveToCwd`·`resolveReadPathAsync`와 같은 규칙이어야 한다(13 §3.4.2가 이미 원본 `utils/paths.ts:76-107` 동작 유지로 적음) |
| 실행 | `create<Name>ToolDefinition(cwd, options).execute(toolCallId, args, signal, onUpdate, { cwd, model })` |
| 경로 정책 | 옵션 `pathPolicy`(T7, T7+). 13의 `canonicalize`를 `check`로 넣으면 `prepare`에서 검사한 경로와 도구가 여는 경로가 같다. 첫 번째 거부 지점은 `prepare`(12 §3.4.5 `pathDenials`) |
| bash 격리 | 옵션 `operations`(`BashOperations.exec`) 또는 `spawnHook`(13·18). grep·find의 `rg`·`fd`는 T14의 `spawn` 옵션 |
| bash 시간 제한 | T13의 `defaultTimeoutSeconds`·`maxTimeoutSeconds` |
| 결과 해시(`sha256`, `beforeSha256`/`afterSha256`) | 포크를 고치지 않는다. 13의 `prepare`(사전 해시)와 `postprocess`(결과 해시)가 붙인다 |
| bash 환경 | 옵션 `env`(T4). `buildShellEnv(allow)`가 만든다 |
| 전체 출력 파일 | `setOutputDirectory(dir)`(T5). 13의 `postprocess`는 이 파일을 blob으로 옮길 수 있다 |
| `rg`/`fd` | `configureToolBinaries({ rg, fd })`(T3) |
| 이미지 | read가 `@helm/vendor-pi-image`로 크기 조정(T12) |
| `primitive`, `replay`, `executionMode` 기본값 [제안, 13 확정] | read·grep·find·ls: `read`, `safe`, parallel. write·edit: `write`, `never`, parallel(같은 파일은 큐로 직렬화). bash: `execute`, `never`, parallel. 근거: openclaw replay-safe 목록(S4/openclaw-runtime §2.3), edit는 두 번 적용하면 실패하거나 두 번 바뀐다, write는 크래시 사이에 사람이 바꾼 파일을 덮을 수 있다(12 RT-4는 쓰기 도구의 해시 조건부 재적용을 13에 둔다) |

`createPathPolicy` 판정: `realpath`(없는 경로는 가장 가까운 존재하는 조상의 `realpath` + 나머지)가 허용 루트 아래인지. `read`는 읽기 루트 ∪ 쓰기 루트, `write`·`search`는 각 루트. 아니면 `Error("path outside allowed roots (<access>): <path>")`.

`buildShellEnv`의 허용 목록은 18 §3.11.2 R-2를 따른다(`PATH`, `HOME`, `USER`, `LANG`, `LC_*`, `TERM=dumb`, `TZ`, `TMPDIR`, 합의가 명시한 변수. `SSH_AUTH_SOCK`, `SOPS_*`, `HELM_*` 등은 넘기지 않음). 13의 호출별 변수는 `PiToolContext.env`로 덮는다(T4). 데몬 환경에 비밀이 없게 하는 조치(12 §3.3.4, 17 D17-07)와 겹쳐도 된다.

#### 3.9.6 `@helm/tui` (pi-tui, 이후 단계)

`apps/tui`는 실행 앱(`helm-tui`)이어서 외부에 내보내는 API가 없다. 정하는 것은 둘이다.
1. pi-tui를 import할 수 있는 패키지는 `apps/tui`뿐이다.
2. TUI의 상태와 연결은 데스크톱 앱과 같은 클라이언트 코어(`@helm/client`, 06 §3.4, 19)를 쓴다. TUI는 그 상태를 pi-tui 컴포넌트로 그리기만 한다(결정 32의 "클라이언트에 Helm 로직 없음"을 TUI에도 적용).

pi 쪽 사실과 부품 선택은 §3.14.

### 3.10 pi 동작 계약 [제안 D07-11]

Helm 설계(10·12·13)가 기대는 pi 동작이다. 각 항목은 테스트로 고정한다(위치는 §3.19.2). "근거 실험"의 exp1~6은 `experiments/pi-lab/`(npm 1.1.0, pi-facts-2 §11에서 재실행), S3a A1·A2는 `.helm-design-work/S3a/`, `P4`는 이 문서의 시제품(`.helm-design-work/P4/fork-proto/test/contract.ts`, 출력 `contract.out.txt`, 패치 A1~A7 적용본, `Agent` 없이 저수준 루프)이다. 12의 시험 번호와 겹치는 것은 함께 적었다.

| ID | 계약 | 원문 근거 | 근거 실험 |
|---|---|---|---|
| C1 | 싱크(`emit`)는 await된다. assistant `message_end` 싱크가 끝나기 전에는 그 메시지의 도구 준비(`tool_execution_start`)가 시작되지 않는다 | `agent-loop.ts:454`(`await emit message_end`) 뒤 `:259-270` | S3a A1 2번(80ms 리스너 뒤 execute), P4 |
| C2 | 호출 하나의 순서: `tool_execution_start` → `beforeToolCall` → `tool_execution_executing`(A5) → `execute` → `afterToolCall` → `tool_execution_end` → `toolResult`의 `message_start`/`message_end`. 병렬 모드에서는 모든 호출의 `start`·`beforeToolCall`이 원래 순서로 먼저 끝나고, 허용된 호출의 `executing`이 이어지며, `tool_execution_end`는 끝난 순서, 결과 메시지는 원래 순서다 | `agent-loop.ts:586-660` + A5 | P4, S3a A1 4번 |
| C3 | `beforeToolCall`이 `block`이면 `execute`·`afterToolCall`이 불리지 않고, 결과는 `isError: true`, 내용은 `reason`(없으면 `"Tool execution was blocked"`), `executed: false`, `rejection.kind: "blocked"` | `agent-loop.ts:745-755` + A2 | S3a A1 3번, exp1, P4 |
| C4 | `beforeToolCall`이 예외를 던지면 그 메시지가 오류 결과가 되고 `rejection.kind: "hook_error"`, `execute`·`afterToolCall` 없음 | A2 | S3a A1 3번, P4 |
| C5 | 없는 도구는 `"Tool <name> not found"`·`unknown_tool`, 인자 검증 실패는 `"Validation failed for tool ..."`·`invalid_args`. 둘 다 `beforeToolCall`이 불리지 않는다 | `agent-loop.ts:716-727`, `validation.ts:317-349` + A2 | P4, 12 T-AG-01~05 |
| C6 | `beforeToolCall`에서 `args`를 제자리에서 바꾸거나 `{ args }`로 돌려주면 `execute`가 그 값을 받는다. 교체 인자는 다시 검증되고 실패하면 `invalid_args`(문구 앞 `beforeToolCall args: `). assistant 메시지의 `toolCall.arguments`는 원래 값이고 `tool_execution_end.args`·`AgentToolCallOutcome.args`는 실행 인자다 | F5 + A2·A4 | S3a A1 1번, exp3(확장 `event.input` 수정), P4(`nope.txt` → `a.txt` 두 방식, 교체 실패 1건), 12 T-AG-06 |
| C7 | 호출자·`prepareRequest`·`prepareNextTurn`이 준 `context.messages` 배열은 실행 뒤에도 길이와 내용이 그대로다 | A1 | P4(넘긴 배열 길이 3, 5 유지), 12 T-AG-07·T-PJ-02. 수정 전 동작은 S3a A1 6번 |
| C8 | 투영의 선언 도구(첫 system 메시지부터 재생한 `toolsAdded`/`toolsRemoved`)와 `tools` 이름 집합이 다르면 `assertToolDeclarations`가 throw한다 | F10 | (Helm 코드 테스트), 12 T-PJ-08 |
| C9 | 중단되면 assistant 메시지 안의 모든 도구 호출이 정확히 한 번 `tool_execution_end`와 `toolResult`를 받는다. 실행 전이던 호출은 `aborted_before_execute`, 내용 `"Operation aborted"` | A3 | P4(`s1` executed, `s2`·`s3` aborted_before_execute) |
| C10 | `stopReason: "length"`인 assistant 메시지의 도구 호출은 하나도 실행하지 않고 `truncated_response` 오류 결과를 낸다 | `agent-loop.ts:264-270,478-503` + A2 | S3a A1 5번, 12 T-AG-09 |
| C11 | `stopReason`이 `"stop"`이어도 `toolCall` 블록이 있으면 실행한다 | `agent-loop.ts:245-272` | S3a A1 1번, 12 T-AG-08 |
| C12 | `afterToolCall`이 `content`만 바꾸면 `structuredContent`가 지워진다. 함께 돌려주면 유지된다 | `agent-loop.ts:884-895` | (Helm 코드 테스트) |
| C13 | `ToolResultMessage`에는 `structuredContent`가 없고, `tool_execution_end.result`와 `afterToolCall`의 `result`에는 있다 | `agent-loop.ts:870-944` | S3a A1 1번 |
| C14 | 싱크가 예외를 던지면 `runAgentLoop`가 같은 예외로 reject하고 이후 도구는 실행되지 않는다 | F9 | P4(`journal commit failed`, 실행 0회) |
| C15 | `@helm/ai`가 `maxRetries`를 주지 않으면 pi-ai는 요청을 다시 보내지 않는다(재시도는 `ModelGateway` 한 곳) | F11 | (Helm 코드 테스트: faux 오류 1회 → provider 호출 1회) |
| C16 | 같은 `sessionId`로 같은 앞부분을 다시 보내면 두 번째 요청의 `usage.cacheRead`가 0보다 크다 | faux 캐시 흉내 `pi@v1.1.0:packages/ai/src/providers/faux.ts:245-286` | (Helm 코드 테스트, 12 T-PJ-03과 함께) |
| C17 | 테스트용 faux provider의 `api`는 실행마다 같다(기본값은 `faux:<시각>:<난수>`) | `faux.ts:455` | (Helm 코드 테스트) |
| C18 | `getSteeringMessages`가 돌려준 메시지는 현재 도구 배치가 끝난 뒤 다음 요청 전에 들어가고, 현재 배치의 호출을 건너뛰지 않는다 | `types.ts:282-293`, `agent-loop.ts:294-298` | S3a A1 8번 |
| C19 | pi-ai `transformMessages`는 `error`/`aborted` assistant 메시지를 provider 요청에서 빼고, 결과 없는 도구 호출에 `"No result provided"`를 채운다. Helm 투영은 A3 덕분에 이 합성에 기대지 않는다 | `transform-messages.ts:155-200` | (Helm 코드 테스트: 투영의 모든 toolCall에 결과가 있음) |
| C20 | REPL 브리지의 중첩 도구 호출은 `runToolCall()`로 같은 훅을 지난다. 차단되면 스크립트 안에서 `Error`가 되고, 스크립트가 성공하면 `storeWrites`가 돌아온다 | `agent-loop.ts:802-819`, pi-codemode `types.ts:77-92` | P4(`before:read` → executed, `before:write` → blocked, `storeWrites {k:1}`) |
| C21 | vendor bash는 주입한 환경만 보고(비밀 없음), 경로 정책이 허용 루트 밖을 도구 층에서 거부하며, `rg`/`fd`가 없으면 내려받지 않고 명확한 오류를 낸다 | T3, T4, T7 | P4(`key=` 빈 값, `/etc/hostname` 거부, 설치된 rg 15.2.0·fd 10.5.0 사용) |
| C22 | write·edit는 쓰기 뒤에 중단이 감지되면 `"Operation aborted"`를 던진다. 파일은 이미 바뀌었을 수 있다 | `write.ts:76-83`, `edit.ts:195-199` | (Helm 코드 테스트). 12·13은 중단된 write/edit를 "결과 불명"으로 다룬다(§5.2) |
| C23 | Anthropic 변환은 `toolResult` 메시지 뒤의 `user` 메시지를 별도 `role: "user"` 항목으로 보낸다(합치지 않는다) | `api/anthropic-messages.ts:1355-1391,1462-1478` | (12 T-PJ-07 변환 스냅숏) |
| C24 | OpenAI Responses 요청은 `store: false`이고 `previous_response_id`를 쓰지 않는다(서버 쪽 대화 상태 없음). 캐시 키는 `prompt_cache_key = sessionId` | `api/openai-responses.ts:330-338` | (12 변환 스냅숏) |

### 3.11 pi-ai 사용 규칙 [제안]

#### 3.11.1 provider 등록

- `@earendil-works/pi-ai/providers/all`(42개 전부와 생성 카탈로그를 import, `providers/all.ts:1-46`)은 쓰지 않는다. `createModels()`(`models.ts:992`)에 필요한 provider만 `setProvider()`로 등록한다.
- 1차 provider: `anthropicProvider()`(`providers/anthropic.ts:74`, API `anthropic-messages`), `openaiProvider()`(`providers/openai.ts:9`, API `openai-responses`). 다른 provider는 12의 `AiConfig.providers`(12 §3.3.3)에 항목을 더할 때 같은 방식으로 등록한다.
- 테스트: `fauxProvider({ api: "helm-faux", provider: "faux" })`(`faux.ts:704`). `api`를 고정한다(C17). 같은 provider·api·model인지로 thinking 보존을 판정하는 handoff 로직(pi-facts-1 §2.11)이 흔들리지 않게 하려는 것이다.

#### 3.11.2 자격 증명

- 12 §3.3.4의 `EnvCredentialStore`(pi-ai `CredentialStore` 구현, 읽기 전용, 시작 때 키를 메모리로 옮기고 `process.env`에서 지움)를 쓴다. pi-ai 쪽 사실: `CredentialStore`는 `read/list/modify/delete` 인터페이스이고 `modify`가 유일한 쓰기 경로다(`auth/types.ts:65-94`). 기본값 `InMemoryCredentialStore`(`models.ts:400`)는 저장된 것이 없으면 `AuthContext.env`로 환경 변수를 읽는다(`auth/context.ts:23-45`) [원문].
- Anthropic 키 해석 순서: 저장된 키 → `ANTHROPIC_AUTH_TOKEN`(Bearer) → `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY` → 워크로드 ID 연동(`providers/anthropic.ts:19-60`) [원문]. 그런데 이 순서는 저장된 키가 없을 때 환경 변수 쪽에서 적용된다. `EnvCredentialStore.read`가 `ANTHROPIC_API_KEY`를 돌려주면 그 키가 쓰인다. `ANTHROPIC_OAUTH_TOKEN`처럼 OAuth 토큰(문자열에 `sk-ant-oat` 포함, `api/anthropic-messages.ts:978-979`)이 키로 쓰이면 요청 system 앞에 "You are Claude Code, Anthropic's official CLI for Claude." 블록이 붙는다(`api/anthropic-messages.ts:1166-1180`) [원문]. Helm은 API 키만 주입한다(§4 E24).
- bash 셸에는 키가 넘어가지 않는다: 17 D17-07은 키를 환경 변수가 아니라 파이프로 받고, 12 §3.3.4는 환경에서 읽은 뒤 지운다(두 문서가 2단계에서 맞춘다). 어느 쪽이든 키는 `CredentialStore.read`로만 pi-ai에 가고, vendor bash는 주입한 환경만 쓴다(T4, C21).

#### 3.11.3 재시도와 시간 제한 (D07-10)

- 재시도는 `@helm/ai`의 `ModelGateway.streamFor` 한 곳에서 한다(12 RT-9, §3.3.5). pi-ai 요청에는 `maxRetries: 0`을 명시한다(기본도 0, F11). openclaw의 "nested SDK retry"(pi 내부 재시도와 호스트 재시도가 겹쳐 실패한 도구 호출을 다시 실행)를 피한다(cases §7.2).
- 12가 쓰는 pi-ai 도우미: `isRetryableAssistantError`, `retryAssistantCall`의 정책 모양(`utils/retry.ts:116-262`), `isContextOverflow`(`utils/overflow.ts:137`), `clampThinkingLevel`(`models.ts:1235`), `calculateCost`(`models.ts:1200`). 모두 `@helm/ai` 안에서만 import한다.
- `timeoutMs`: SDK 기본은 10분이다(`types.ts:174-177` 주석). 12가 정하는 값을 매 요청에 넘긴다.

#### 3.11.4 프롬프트 캐시

- 12의 `StreamCallContext.sessionKey`·`ResolvedModel.cacheRetention`(12 §3.3.2)을 pi `sessionId`·`cacheRetention`으로 넘긴다. Anthropic은 system 프롬프트, 마지막 도구 선언, 마지막 user/system 메시지에 `cache_control`을 단다(`api/anthropic-messages.ts:1166-1189,1483-1510,1608`) [원문]. `cacheRetention` 기본은 `"short"`이고 `PI_CACHE_RETENTION=long`이면 `"long"`(1h)이다(`:66-93`). Helm은 환경 변수에 기대지 않고 항상 명시한다.
- 캐시가 맞으려면 요청 앞부분이 바이트 단위로 같아야 한다. 투영 규칙(12가 소유)에 대한 요구는 §3.15 프롬프트 캐시 행.

#### 3.11.5 모델 카탈로그와 새 모델

- 모델 정보는 provider의 생성 카탈로그(`providers/*.models.ts`)에서 온다. 새 모델은 pi-ai 새 버전에 들어온다.
- 업그레이드 없이 새 모델을 쓰려면 설정에 추가 모델(12 `AiConfig`에 `extraModels` 항목을 더하는 것을 요구, §5.2)을 두고 `createProvider({ id, auth, models, api })`(`models.ts:996-1041`)로 만든 보조 provider에 등록한다. 같은 API 구현(`@earendil-works/pi-ai/api/anthropic-messages` 등)과 같은 auth를 쓴다 [가정: 보조 provider가 원 provider와 같은 `auth`·`api`로 동작하는지는 구현 때 C 테스트로 확인].

#### 3.11.6 12가 확인을 요청한 provider 변환 사실 (12 §5.2 "07")

| 질문 | 사실 | 확인 |
|---|---|---|
| Anthropic 경로에서 `toolResult` 뒤 주입 `user` 텍스트가 같은 user 턴으로 합쳐지는가(12 §3.5.2 [가정], T-PJ-07) | pi-ai는 합치지 않는다. 연속한 `toolResult` 메시지들을 `role: "user"` 항목 하나(내용은 `tool_result` 블록들)로 만들고, 뒤따르는 `user` 메시지는 별도 `role: "user"` 항목으로 보낸다(`api/anthropic-messages.ts:1355-1391,1462-1478`). 같은 역할이 연속한 두 항목을 API가 받아 한 턴으로 합친다는 것은 [지식](재확인 안 함). 12의 T-PJ-07은 변환 스냅숏(pi 수준)과 실제 provider 확인(§3.18.4-9) 둘로 한다 | [원문], C23 |
| OpenAI Responses 경로가 서버 쪽 대화 상태(`store`, `previous_response_id`)를 쓰는가 | 쓰지 않는다. 요청은 `store: false`이고 `previous_response_id`를 넣지 않는다. 매 요청 전체 입력을 보낸다. 캐시 키는 `prompt_cache_key`(= `sessionId`, `cacheRetention: "none"`이면 없음) | [원문] `api/openai-responses.ts:330-338`, C24 |
| 요약 프롬프트·직렬화(coding-agent `compaction/*`)를 포크할지 | 포크하지 않는다. `compaction.ts`가 `session-manager.ts`와 `@earendil-works/pi-ai/compat`에 묶여 있다(pi-facts-1 §4.8). 요약 형식(Goal, Constraints & Preferences, Progress, Key Decisions, Next Steps, Critical Context)과 `serializeConversation`(`compaction/utils.ts:114`)의 규칙은 12가 Helm 코드로 다시 쓰고, 문구를 옮기면 출처 표시(§3.17.3)를 단다 | [원문] |
| 이미지 크기 조정 모듈 | `@helm/vendor-pi-image`(§3.6.4) | - |

#### 3.11.7 OpenAI provider 계약 규칙 (canon-2 §11 "07", §4.8, §9.12)

v0.2 실행 후보의 OpenAI provider 계약에서 넘어온 요구를 `@helm/ai`가 지킨다.

| 규칙 | `@helm/ai` 처리 |
|---|---|
| 텍스트와 도구 호출이 섞인 출력을 거부한다(v0.2) | 거부하지 않는다. pi 루프는 섞인 출력을 정상으로 다룬다(C11). 대신 Helm의 "제안 도구"(13)는 구조화된 값만 상태 변경 근거로 쓰고 텍스트는 관찰하지 않는다(결정 14). 이 차이를 ADR 후보 07-6에 남긴다 |
| strict 스키마 | Helm 도구 선언에 `constrainedSampling: { type: "json_schema", strict: "prefer" }`를 기본으로 둔다(coding-agent 도구와 같음, `read.ts:101` 등). `require`는 13이 도구별로 정한다 |
| 키 비노출 | 12 §3.3.4(키는 메모리에만, 오류 문자열 마스킹) |
| usage는 운영 데이터 | 12 §3.3.7(`UsageRecord`는 실행 기록이고 도메인 이벤트가 아니다). 원 토큰 수를 남겨 비용을 다시 계산할 수 있게 한다 |

### 3.12 pi-codemode 사용: REPL 브리지 [제안]

15(D15-7)는 REPL 방식 탐구에 pi-codemode 샌드박스를 그대로 쓰고 Helm globals를 넣는다고 정했다. 07이 정하는 것은 샌드박스와 Helm 도구 경로를 잇는 방법이다.

- 쓰는 API(`pi@v1.1.0:packages/codemode/src/`): `new CodemodeSandbox({ tools, globals, timeoutMs, memoryLimitBytes })`(`runtime/host.ts:340`, 옵션 `types.ts:94-127`), `sandbox.execute(code, { signal, timeoutMs, store })`(`types.ts:129-138`), 결과 `CodemodeResult`(`ok`, `value`, `output`, `calls`, `storeWrites`), `sandbox.close()`.
- 실행마다 새 worker와 새 QuickJS VM이다. 변수는 한 번의 실행에서만 살고, 상태는 호출자가 `store`로 넘기고 `storeWrites`로 받는다(pi-facts-1 §5.4) [실험 P4 C20].
- 도구 브리지: 샌드박스의 `tools`에 넣는 `CodemodeTool.execute(args, { signal })`는 `@helm/agent`의 `runToolCall(toolCall, { tools, assistantMessage, context, beforeToolCall, afterToolCall, signal })`(`agent-loop.ts:811-819`)을 12의 같은 훅(12 §3.4.5·§3.4.6)으로 부른다. `toolCall.id`는 `<부모 호출 id>/<n>`(coding-agent `executeTool`과 같은 규칙, pi-facts-1 §4.9)이다. `runToolCall`은 이벤트를 내지 않으므로 의도·결과 기록은 훅이 한다(12의 훅은 원래 그렇게 동작한다). 그래서 스크립트 안 호출에도 커널 검사와 관찰 기록이 적용된다. pi-durable 스파이크에서 문제였던 "샌드박스 도구가 훅을 거치지 않음"(canon-2 L22, v0.3 13 §2.3)이 생기지 않는다.
- 브리지 반환값: 성공이면 `outcome.result.structuredContent ?? textOf(outcome.result.content)`, 실패·차단(`isError` 또는 `executed: false`)이면 `throw new Error(text)`(pi coding-agent codemode와 같은 규칙, pi-facts-1 §5.5).
- 기한: 샌드박스 기본 300000 ms(`host.ts:22`). 15가 탐구 예산에 맞춰 정한다. 메모리 상한은 coding-agent 값 256 MiB(`coding-agent/src/extensions/codemode/execute.ts:56`)를 기본으로 둔다 [제안].
- 채팅 모델 하위 호출은 pi-codemode에 없다. 15의 `helm.subcall`을 `globals`로 넣는다(`types.ts:102`). globals 호출은 `result.calls`에 기록되지 않는다(`types.ts:96-101` 주석). 하위 호출 기록은 15·12가 globals 구현 안에서 한다.
- 실패한 스크립트: 출력은 실패 지점까지 남고, 이미 실행된 도구 호출은 되돌려지지 않으며, `store` 쓰기는 버려진다(extracts-1 E1-189). 브리지를 거친 도구 호출은 이미 훅에서 기록됐으므로 Helm 기록은 어긋나지 않는다.
- coding-agent의 `extensions/codemode/*`(설명 생성 `createCodemodeDescription`, 노출 등급, `codemode-store` 세션 엔트리)는 참고만 한다. 세션·확장 타입에 묶여 있다(`tool.ts:24-48`, `execute.ts:6-45` import).
- 데몬을 `node --watch`로 실행하지 않는다. 1.1.0의 `CodemodeSandbox`는 Node 24·26의 `--watch`가 worker 채널에 보내는 메시지로 깨진다(#10725, `cdaf6c2`에서 수정).

### 3.13 pi-mcp 사용 (MCP 단계) [제안]

- 쓰는 API(`pi@v1.1.0:packages/mcp/src/`): `McpClient`(`client.ts`), `StdioTransport`, `StreamableHttpTransport`, `toLlmContent`(`protocol/content.ts`).
- `outputSchema` 검증: pi-mcp는 `structuredContent`가 객체인지만 본다(pi-facts-1 §6.4). `@helm/tools/src/mcp/`가 서버의 `outputSchema`로 `structuredContent`를 검사한다. 검사기는 pi-ai와 같은 TypeBox 컴파일러(`typebox/compile`, pi-ai `validation.ts:1`)를 쓴다. 맞지 않으면 그 결과의 `structured`를 버리고 `details.outputSchemaViolation`에 오류 목록을 남기며 `isError`는 바꾸지 않는다 [제안]. 구조화 결과로 상태를 바꾸는 Helm 제안 도구에는 MCP 결과를 직접 쓰지 않는다(13).
- 이름 규칙: coding-agent MCP 확장의 `mcp__<server>__<tool>`, 허용 문자 밖은 `_`, 길면 해시 접미사(`coding-agent/src/extensions/mcp/tools.ts:79-90`)를 참고해 13이 정한다. 큰 텍스트(20KB 초과) 앞뒤만 남기고 전체는 파일로(`tools.ts:1-10`)도 참고.
- 고지: pi-mcp tarball의 `LICENSES/modelcontextprotocol-typescript-sdk.txt`(MIT, Anthropic)를 THIRD_PARTY_NOTICES에 넣는다(§3.17.2).

### 3.14 pi-tui 사용 (TUI 단계) [제안]

- 고정 의존: `"@earendil-works/pi-tui": "1.1.0"`. `apps/tui`만 쓴다.
- 쓸 부품(pi-facts-2 §2.5): `TuiMainScreen`(scrollback 유지) 또는 `TuiAltScreen`(전체 화면), `ProcessTerminal`, `Container`, `Text`, `Box`, `Markdown`, `Editor`, `Input`, `SelectList`, `SettingsList`, `Loader`, 오버레이(`TUI.showOverlay`), `KeybindingsManager`, `matchesKey`, `visibleWidth`·`truncateToWidth`·`wrapTextWithAnsi`. OpenClaw가 쓰는 부품과 거의 같다(pi-facts-2 §12.1 §10 행).
- coding-agent의 채팅 부품(`AssistantMessageComponent`, `ToolExecutionComponent`, `UserMessageComponent`, `initTheme`)은 참고만 한다. 루트 export라 coding-agent 전체를 끌어오고(pi-facts-2 §2.5), `theme.ts`(1,160줄)가 pi 설정 경로·highlight.js에 묶여 있다. Helm TUI는 `Markdown`과 `Text`로 자기 메시지 부품을 만든다. `assistant-message.ts`(202줄)를 vendor할지는 TUI 단계에서 정한다(§7 M6).
- 터미널 사실(pi-facts-2 §2.4): SSH 환경(`SSH_CONNECTION`/`SSH_TTY`)에서는 ESC 단독 판정 대기가 100 ms다. 키 판정은 하드코딩하지 않고 기본 바인딩 표(`keybindings.ts:71`)에 더한다.
- 1.1.0 기준이므로 `renderFakeCursor()`가 없다(§3.1.4). TUI 단계에서 그 시점 최신 태그로 올릴지 정한다.
- 확인할 것: 실제 TTY(Windows Terminal → SSH → WSL)에서 Kitty 프로토콜 협상, IME 후보창 위치, 한국어 줄바꿈(`wrapTextWithAnsi`가 단어 중간에서 끊음, pi-facts-2 §2.6)(§7 M5).

### 3.15 pi 세션·패키지 특성의 처리 (브리프 §3.5)

| 특성 | pi 사실 | Helm 처리 | 담당 |
|---|---|---|---|
| 세션 트리 | coding-agent 세션은 `id`/`parentId` 트리이고 활성 경로는 현재 잎에서 뿌리까지다. 버린 분기도 파일에 남는다. fork는 새 파일(`parentSession`)(pi-facts-1 §4.7, `session-manager.ts:43-197,1815-1870`) | 쓰지 않는다. Helm 런타임 경로는 pi `SessionManager`를 import하지 않는다(가져오는 파일 목록에 없음, §3.6). Helm의 분기(가능성 탐구 가지, 검증자, 하위 실행)는 도메인 레코드(08)와 새 run(새 컨텍스트, 12 §3.14)으로 표현한다. 검증자는 fork 대신 새 실행으로 만든다(extracts-3 X3-5-03: fork는 부모 기록을 본다) | 08, 14, 15 |
| 외부 pi 세션 로그 | 위와 같은 JSONL, version 3, 엔트리 11종 | 관찰 에이전트 입력으로만 읽는다(결정 35). 트리 처리(활성 경로와 버린 분기)는 16 §3.6.3 | 16 |
| `context_edit` | 이전 엔트리 하나의 "모델 컨텍스트 기여"만 바꾸거나(`replacement`) 빼고(`null`), 원본 엔트리·UI·사용량은 그대로 둔다. 활성 경로의 마지막 edit가 이긴다(`session-format.md` "ContextEditEntry", `session-manager.ts:543`) | 같은 생각을 Helm 투영(12)에 쓴다: 정본 이벤트는 바꾸지 않고, "모델에게 보낸 것"을 투영 규칙과 투영 기록으로 남긴다. 결과적으로 "기록된 것"과 "모델이 본 것"이 다를 수 있으므로, 12는 요청마다 어떤 투영(규칙 버전, 생략·요약 목록, 출처 커서)을 썼는지 기록한다(A11, extracts-2 X2-6-07). 외부 pi 로그 마이닝의 기준(원본 vs 모델이 본 것, extracts-1 Q1)은 16이 정한다 | 12, 16 |
| 프롬프트 캐시 | Anthropic: system·마지막 도구·마지막 user/system 메시지에 `cache_control`(§3.11.4). OpenAI Responses: `prompt_cache_key`(C24). pi-ai는 `sessionId`를 캐시 키로 넘긴다. coding-agent는 codemode 설명이 도구 연결 상태에 따라 바뀌지 않게 해 캐시를 지킨다(extracts-1 E1-205) | `@helm/ai`는 `sessionKey`·`cacheRetention`을 넘기기만 한다. 투영(12 RT-2, §3.5.3이 이미 같은 방향)에 대한 요구: (1) 첫 system 메시지(프롬프트+도구 선언)는 같은 실행 안에서 바이트 단위로 같게 만든다(도구 순서 고정, 시각·난수 없음), (2) 바뀌는 지시는 뒤쪽 system 메시지의 `sections`로 더한다(pi-ai가 지원 모델에는 제자리로 보냄, pi-facts-1 §2.12), (3) 이전 메시지의 직렬화는 이벤트에서 결정적으로 만든다(같은 이벤트 → 같은 바이트), (4) 도구 집합 변경은 실행 단위 경계에서만 한다. 노출 등급(직접/REPL/검색) 구분과 REPL 설명의 불변성은 13 | 12, 13 |
| 버전 고정 | 핵심 패키지는 5개월에 58개 버전, patch에서도 Breaking(pi-facts-2 §1.3). pi 패키지끼리는 `^1.1.0`으로 서로 요구 | 고정 의존은 정확한 버전 + `overrides`(§3.3.2), vendor는 기준 태그 고정(§3.1). 무결성 테스트(§3.19.1 I1)와 업그레이드 체크리스트(§3.18.4) | 07 |
| MCP `outputSchema` | pi-mcp·agent-core·coding-agent 모두 검증하지 않는다(pi-facts-1 §0-12) | `@helm/tools` MCP 래퍼가 검증(§3.13). Helm 도구의 `outputSchema`는 13의 `postprocess`(12 §3.4.6)가 검사한다 [제안]: 실패하면 `structuredContent`를 버리고 `details.outputSchemaViolation`을 남긴다. 제안 도구(13)는 구조화 결과 없이 상태를 바꾸지 않는다 | 13 |
| 세션 저장(fsync 없음, 첫 메시지 전 파일 없음) | `appendFileSync`, fsync·락 없음(`session-manager.ts:1166-1196`) | 해당 없음(쓰지 않음). 대화 기록은 Helm 이벤트 로그(SQLite WAL)에만 쓴다(결정 29). openclaw의 이중 쓰기 문제를 피한다(cases §12.2-3) | 09, 12 |
| 컴팩션 | coding-agent `core/compaction/*`: 자르는 지점 규칙, split turn, 파일 추적, 요약 형식(pi-facts-1 §4.8) | 코드는 쓰지 않고 알고리즘·요약 프롬프트를 참고한다. 컴팩션은 12가 투영 생성의 일부로 설계한다. 요약 프롬프트를 그대로 옮겨 쓰면 출처 표시(§3.17.3)를 단다 | 12 |
| 시스템 프롬프트 절 | `buildSystemPromptSections`: 이름 붙은 절 + diff 패치(`system-prompt.ts:128-229`) | 참고. 투영의 system 메시지를 `sections`로 나누는 방식으로 쓴다 | 12 |

### 3.16 pi CLI를 런타임 어댑터(RPC)로 붙일 때의 접점 (어댑터 단계)

어댑터 인터페이스와 보장 수준 표는 13이 소유한다(결정 34). 여기에는 pi 쪽 사실과 사례에서 온 권고만 적는다. 행 번호는 `pi@v1.1.0:packages/coding-agent/`.

#### 3.16.1 프로세스

- 실행: `pi --mode rpc [--no-session | --session <path> | --session-dir <dir>] [--model <id>] [--thinking <level>] --extension <helm-bridge.mjs>`(`src/cli/args.ts:96,132-140,186`). 사용자가 설치한 pi를 쓴다. 이 경우 pi 코드는 Helm 프로세스에 들어오지 않는다(paseo·pi-acp 방식, cases §4.2, §9).
- 버전: `pi --version` 결과를 검사해 어댑터가 시험한 범위 밖이면 연결을 거부한다(pi-acp는 v0.81.0+ 요구, cases §9.1). paseo는 pi 0.84의 `message_update` 형식 변경으로 데몬 크래시 루프를 겪었다(cases §4.2).

#### 3.16.2 프레이밍

- stdin/stdout JSONL, LF로만 나눈다. Node `readline`은 `U+2028`/`U+2029`에서도 줄을 나누므로 쓰지 않는다(`docs/rpc.md:50-56`, `src/modes/rpc/jsonl.ts:1-30`) [원문]. stdout에서 JSON이 아닌 줄(시작 문구)은 버리거나 따로 모은다(pi-acp `process.ts:117-140`).
- 명령에 `id`를 붙이면 응답이 같은 `id`를 돌려준다. 이벤트에는 `id`가 없다(`docs/rpc.md:34-48`).

#### 3.16.3 명령과 이벤트

- 명령 33종(`src/modes/rpc/rpc-types.ts:22-74`). 어댑터가 쓸 것: `prompt`, `steer`, `follow_up`, `abort`, `get_state`, `get_messages`, `get_entries`(`since` 지원), `set_model`, `set_thinking_level`, `set_auto_retry`, `set_auto_compaction`, `compact`.
- 이벤트: agent 이벤트(`agent_start`, `turn_*`, `message_*`, `tool_execution_*`) + `agent_settled`, `auto_retry_*`, `compaction_*`, `extension_ui_request` 등(`docs/json.md`).
- 턴 종료는 `agent_settled`로 판정하고 `agent_end`로는 판정하지 않는다. `agent_end` 뒤에도 재시도·컴팩션·대기 메시지가 이어질 수 있다(`docs/json.md:45-56`, `docs/rpc.md:69`). pi-acp(`session.ts:954-969`)와 paseo(`c424f829`)가 같은 판정을 쓴다(cases §9.3, §4.2).
- `message_update`는 0.84부터 delta만 싣는다(extracts-1 E1-118). 누적 메시지는 `message_end`에서 받는다.

#### 3.16.4 커널 검사 지점

- RPC에는 도구 실행 전 차단 명령이 없다. 주입 확장(`--extension`)의 `pi.on("tool_call", handler)`가 `{ block: true, reason }`을 돌려주면 막히고, `event.input`을 고치면 실행 인자가 바뀐다(`src/core/extensions/types.ts:1166,1426-1433,1633`) [원문]. 핸들러가 예외를 던져도 막힌다(pi-facts-1 §4.10).
- 주입 확장은 데몬과 별도 로컬 채널(Unix 소켓 등, 13이 정함)로 검사 결과를 받는다. paseo처럼 `ctx.ui.notify` 문자열 마커로 상태를 빼내지 않는다(cases §12.2-5).
- 보장 수준: 확장이 로드되지 않으면 검사가 없다. 어댑터는 시작 직후 확장 응답(예: 준비 신호)을 확인한 뒤에만 `prompt`를 보낸다. 투영(12)은 pi CLI에 적용되지 않는다(pi가 자기 컨텍스트를 소유한다). 13의 능력 목록에 이 두 점을 `advisory`/`unavailable`로 적는다(06 §2.3 P4).

#### 3.16.5 재시도·컴팩션·세션

- pi CLI는 자체 auto-retry와 auto-compaction을 갖는다. 어댑터가 시작하자마자 `set_auto_retry {enabled:false}`를 보내 Helm 재시도와 겹치지 않게 한다(D07-10). 컴팩션은 pi CLI 런타임의 일이므로 켜 두고 `compaction_*` 이벤트를 기록만 한다 [제안].
- pi는 자기 세션 JSONL을 쓴다. Helm 기준 원본은 여전히 Helm 이벤트 로그다(결정 29). 재개용 세션 파일은 Helm 런타임 데이터 디렉터리(17)의 `--session-dir`에 두고, 경로를 Helm 레코드에 남긴다(paseo `nativeHandle` 방식).

#### 3.16.6 확장 UI와 세션 파일 API

- 확장 UI 요청 `extension_ui_request`의 `select`, `confirm`, `input`, `editor`(`rpc-types.ts:253-287`)를 Helm 질문 레코드(11)로 바꾸고, 답은 `extension_ui_response {id, value | confirmed | cancelled}`(`:295-297`)로 보낸다. pi-acp는 `input`/`editor`를 조용히 취소한다(cases §9.4 피할 것). Helm은 질문으로 올린다.
- extracts-1 Q18: 확장 컨텍스트의 `ctx.sessionManager`는 `ReadonlySessionManager`이고 `getSessionId()`, `getSessionFile()`이 있다(`src/core/session-manager.ts:249-250,1152-1156`, `extensions/types.ts:335`) [원문]. `agent_settled` 이벤트 타입은 `AgentSettledEvent`(`extensions/types.ts:1005-1006`)다.

#### 3.16.7 Helm 쪽 코드

- coding-agent 패키지를 의존하지 않는다(루트 import가 앱 전체를 끌어온다). 어댑터 단계에서 `src/modes/rpc/rpc-types.ts`(303줄, 타입만)와 `src/modes/rpc/jsonl.ts`(58줄)를 `vendor/pi-rpc/`로 vendor한다 [제안]. `RpcClient`(`rpc-client.ts`, 617줄)는 참고만 한다.
- 주입 확장 `helm-bridge.mjs`는 Helm 저장소의 코드이고 pi 확장 API 타입만 쓴다. 타입은 vendor한 rpc 타입과 함께 둔다.

### 3.17 라이선스 고지와 출처 헤더 [제안]

#### 3.17.1 사실

| 대상 | 사실 | 확인 |
|---|---|---|
| pi 저장소 | 루트 `LICENSE` 하나. MIT, "Copyright (c) 2025 Mario Zechner". 패키지 디렉터리에는 LICENSE 파일이 없고 `package.json`의 `"license": "MIT"`만 있다. `author`는 패키지마다 "Mario Zechner" 또는 "Earendil Works" | [원문] `pi@v1.1.0:LICENSE`, 각 `package.json` |
| npm tarball | 설치된 `@earendil-works/*` 1.1.0 중 라이선스 파일이 있는 것은 `pi-mcp`(`LICENSES/`)뿐이다 | [실험] pi-facts-2 §1.2 |
| pi-mcp | `LICENSES/modelcontextprotocol-typescript-sdk.txt`: MIT, "Copyright (c) 2024 Anthropic, PBC" | [원문] |
| pi-tui 내부 | `src/stdin-buffer.ts:17` OpenTUI(MIT), `src/oklab.ts:6` Björn Ottosson(MIT), `src/keys.ts:6` OpenTUI 참고 | [원문] pi-facts-2 §1.2 |
| vendor 도구의 외부 의존 | `diff` 8.0.4 BSD-3-Clause, `cross-spawn` 7.0.6 MIT, `@silvia-odwyer/photon-node` 0.3.4 Apache-2.0, `typebox` 1.3.27 MIT | [실험] 설치본 `package.json`, 각 LICENSE 파일 |
| pi-ai 의존 | `@anthropic-ai/sdk` MIT, `openai` Apache-2.0, `@google/genai` Apache-2.0, `@aws-sdk/client-bedrock-runtime` Apache-2.0, `partial-json` MIT | [실험] 같음 |
| pi-codemode 의존 | `quickjs-wasi` 3.6.2 MIT | [실험] |

#### 3.17.2 고지 규칙

1. **MIT 고지(vendor)**: `vendor/LICENSES/pi-mono-MIT.txt`에 pi 루트 `LICENSE` 원문을 그대로 둔다. 각 vendor 패키지 디렉터리에 같은 내용의 `LICENSE`를 둔다. MIT 조건("The above copyright notice and this permission notice shall be included in all copies or substantial portions")을 vendor 사본 단위로 만족한다.
2. **npm tarball에 LICENSE가 없는 문제**: 고정 의존한 pi 패키지(pi-ai, pi-codemode, pi-tui, pi-telemetry)는 설치본에 고지 파일이 없다. 같은 저작권자의 같은 저장소 라이선스이므로 `THIRD_PARTY_NOTICES.md`의 pi 항목 하나(원문 포함)가 vendor와 고정 의존을 함께 덮는다. pi-mcp를 들이면 Anthropic MIT 원문을 더한다.
3. **`THIRD_PARTY_NOTICES.md`(저장소 루트)**: 항목 순서와 형식

   ```markdown
   ## pi (earendil-works/pi)
   - 사용: vendor 포크(vendor/pi-agent-core, vendor/pi-tools, vendor/pi-image), 고정 의존(@earendil-works/pi-ai, pi-codemode, pi-tui, pi-telemetry 1.1.0)
   - 기준: 태그 v1.1.0, 커밋 abe508e1b89912adde45528136c3221eb69acdd7
   - 라이선스: MIT (원문은 vendor/LICENSES/pi-mono-MIT.txt)
   - "Portions of Helm were adapted from pi (https://github.com/earendil-works/pi)."
   ## <패키지 이름> <버전> — <라이선스>
   (pnpm 의존 트리에서 생성. Apache-2.0 패키지에 NOTICE 파일이 있으면 그 내용을 붙인다)
   ```

   두 번째 부분은 `just licenses` 레시피(`pnpm licenses list --json --prod`를 읽어 생성)로 만든다. `just verify`는 생성 결과와 커밋된 파일이 같은지 검사한다(23). 혼자 쓰는 앱이고 배포하지 않으므로(결정 24) 고지는 저장소와 데스크톱 앱 "정보" 화면(20) 두 곳이면 된다 [제안].
4. **pi-tui 내부 차용 고지**는 npm 설치본 소스에 이미 들어 있다(파일 머리 주석). Helm이 pi-tui를 vendor하게 되면 그 주석을 지우지 않는다.

#### 3.17.3 출처 헤더 형식

vendor 파일의 맨 위 두 줄(그 아래는 원본 그대로):

```ts
// @helm-vendor upstream=earendil-works/pi@abe508e1 path=packages/agent/src/agent-loop.ts license=MIT(vendor/LICENSES/pi-mono-MIT.txt)
// @helm-vendor patches=A1,A2,A3,A6 (vendor/pi-agent-core/PATCHES.md)
```

- 수정하지 않은 파일은 `patches=none`.
- vendor에 새로 쓴 파일은 한 줄: `// @helm-vendor helm-new (not from upstream)`.
- 수정한 자리마다 `// HELM-PATCH <ID>: <짧은 이유>`. 지운 블록은 지운 자리에 `// HELM-PATCH <ID>: removed <무엇>`을 남긴다.
- `scripts/vendor/sync.mjs`는 `// @helm-vendor`로 시작하는 줄을 빼고 원본과 비교·병합하고, 끝나면 헤더를 다시 붙인다. 그래서 헤더가 3-way 병합 충돌을 만들지 않는다.
- Helm 패키지(`packages/*`)로 pi 코드 일부를 옮겨 쓰면(예: 컴팩션 요약 프롬프트) 그 블록 위에 `// Adapted from earendil-works/pi@abe508e1 <경로>:<행> (MIT, see vendor/LICENSES/pi-mono-MIT.txt)`를 단다.

### 3.18 업스트림 추적 [제안 D07-9]

#### 3.18.1 `UPSTREAM.json`

```ts
// vendor/<패키지>/UPSTREAM.json 의 스키마 (scripts/vendor/sync.mjs가 TypeBox로 검사)
interface UpstreamManifest {
  package: string;                         // 예: "@earendil-works/pi-agent-core"
  repository: "https://github.com/earendil-works/pi";
  base: { tag: string; commit: string; npm: string }; // { "v1.1.0", "abe508e1...", "1.1.0" }
  localClone: string;                      // 기본 "~/projects/_ref/pi-src" (읽기 전용으로만 씀)
  files: Array<{
    local: string;                         // 예: "src/agent-loop.ts"
    upstream: string | null;               // 예: "packages/agent/src/agent-loop.ts", Helm 신규면 null
    patches: string[];                     // 예: ["A1","A2","A3","A6"]. 수정 없으면 []
  }>;
  watch: string[];                         // 가져오지 않았지만 변경을 지켜볼 업스트림 경로
                                           // 예: "packages/agent/src/agent.ts", "packages/agent/src/proxy.ts", "packages/coding-agent/src/core/tools/renderers",
                                           //     "packages/coding-agent/src/utils/tools-manager.ts", "packages/coding-agent/src/core/extensions/types.ts"
  lastSync: { date: string; to: string; report: string }; // 예: { "2026-10-11", "v1.1.0", "vendor/UPGRADES/2026-10-11_v1.1.0-baseline.md" }
}
```

#### 3.18.2 차이 추적 스크립트 `scripts/vendor/sync.mjs`

시제품: `.helm-design-work/P4/fork-proto/scripts/vendor-sync.mjs`(status, upgrade) [실험].

| 명령 | 동작 | 종료 코드 |
|---|---|---|
| `status <vendorDir>` | 파일마다 기준 커밋의 원본(`git -C <clone> show <commit>:<path>`)과 헤더를 뺀 로컬 파일을 비교해 `unmodified` / `modified (+a -b, 표지 n개, 선언 패치)` / `helm-new` / `MISSING`을 출력 | 수정됐는데 `patches`가 비었거나, `patches`가 있는데 원본과 같거나, 원본이 없으면 1 |
| `diff <vendorDir> [--out <dir>]` | 파일별 unified diff를 출력한다. 리뷰와 `PATCHES.md` 점검용 | 0 |
| `verify <vendorDir>` | `status` 조건 + (1) 파일마다 헤더가 있고 `patches=` 값이 `UPSTREAM.json`과 같다, (2) 파일의 `HELM-PATCH <ID>` 표지 ID 집합이 선언과 같다, (3) `PATCHES.md`에 모든 ID 절이 있다 | 하나라도 어기면 1. `just verify`에 포함 |
| `outdated [--fetch]` | (선택) 클론에서 `git fetch --tags` 후 기준 태그보다 새 태그 목록과, 그 사이 `files[].upstream`·`watch` 경로를 바꾼 커밋 수를 출력 | 0 (정보) |
| `upgrade <vendorDir> --to <tag> [--dry-run]` | 파일마다 `git merge-file -p <ours> <base> <theirs>`로 3-way 병합한다. 결과: `same`(업스트림 변경 없음), `merged`, `CONFLICT(n)`, `REMOVED-UPSTREAM`. `watch` 경로의 변경 목록과 새로 생긴 import 대상(가져온 파일이 새로 import하는 업스트림 파일)도 보고한다. `--dry-run`이 아니면 파일을 쓰고 `UPSTREAM.json`의 `base`는 사람이 체크리스트를 마친 뒤 `--commit-base`로 바꾼다 | 충돌이 있으면 1 |

스크립트는 업스트림 클론을 읽기만 한다. 클론 위치는 `HELM_PI_CLONE`(기본 `~/projects/_ref/pi-src`)이다. `outdated`는 `--fetch`를 줄 때만 그 클론에서 `git fetch --tags`를 실행한다. 클론의 생성·갱신은 사용자가 `projects` 스킬로 한다(사용자 전역 규칙) [가정].

[실험] 시제품 `upgrade --to cdaf6c2 --dry-run` 결과 원본이 있는 vendor 파일 29개 모두 `same`(F2와 일치).

#### 3.18.3 CHANGELOG의 Breaking 항목 확인 `scripts/vendor/changelog-breaking.mjs`

- 입력: `--from 1.1.0 --to <버전>`, 대상 `packages/{ai,agent,coding-agent,codemode,mcp,tui,telemetry}/CHANGELOG.md`.
- 동작: 각 파일에서 `## [<버전>]` 머리줄로 절을 나눠 `from` 초과 `to` 이하 버전의 `### Breaking Changes`, `### Changed`, `### Removed` 절을 모은다. `Changed`·`Removed`를 함께 보는 이유: pi는 patch 릴리스에서도 동작을 바꿨고, 그중 일부는 Breaking 절 밖에 있었다(pi-facts-2 §1.3: 1.0.1 coding-agent shrinkwrap 제거는 Removed, 1.0.3 pi-tui 키 바인딩은 Changed).
- 출력: 업그레이드 보고서(§3.18.4)의 "Breaking·Changed·Removed" 절에 그대로 붙인다. 한 항목도 빠뜨리지 않는다. 항목마다 사람이 "영향 없음 / 영향 있음(대응)"을 적는다.
- chord, pi-evals는 CHANGELOG가 없다(pi-facts-2 §1.3). Helm은 둘을 쓰지 않으므로 대상이 아니다.

#### 3.18.4 업그레이드 절차와 체크리스트

보고서 파일: `vendor/UPGRADES/YYYY-MM-DD_<from>-<to>.md`(파일명 규칙은 사용자 전역 규칙과 같다). 업그레이드는 별도 브랜치에서 한다.

1. `just vendor-outdated`로 새 태그와 영향 경로를 본다.
2. `changelog-breaking.mjs --from <base> --to <target>` 결과를 보고서에 붙이고 항목마다 영향을 적는다.
3. 고정 의존 버전을 올린다: `package.json`의 `@earendil-works/*`와 `pnpm-workspace.yaml` `overrides`를 같은 버전으로. `typebox` 버전이 pi-ai와 같은지 확인한다.
4. `sync.mjs upgrade vendor/pi-agent-core --to <tag>`, `vendor/pi-tools`·`vendor/pi-image`도 같은 방식. 충돌을 손으로 풀고, `HELM-PATCH` 표지를 유지한다.
5. `watch` 경로 변경을 검토한다. 특히 가져온 도구가 새 업스트림 파일을 import하기 시작했는지(새 내부 의존), 렌더러·`tools-manager`·확장 타입의 변경이 도구 동작에 영향을 주는지.
6. 업스트림 테스트를 새 태그에서 다시 가져온다(§3.19.3 파일 목록). 경로 바꿈(T11)과 A6 관련 삭제만 다시 적용한다.
7. `just check`(타입 검사. TS 7 전용 문법이 들어왔는지 여기서 확인한다), `just verify`(I1~I5, 계약 테스트 C1~C22, vendor 업스트림 테스트, `sync.mjs verify`).
8. pi-ai가 바뀌었으면 I5(메시지 타입 일치)를 본다. 실패하면 `@helm/ai/src/pi/convert.ts`에 변환을 쓰고, 로그에 저장된 옛 모양이 그대로 읽히는지 09의 재생 테스트로 확인한다.
9. 실제 provider로 짧은 확인 하나(`just ai-smoke`: Anthropic·OpenAI에 "1+1" 요청, 도구 호출 1회. 비용 수 센트) [제안]. faux만으로는 와이어 변경을 잡지 못한다.
10. `UPSTREAM.json`의 `base`, `lastSync`, vendor 패키지 버전(`<버전>-helm.<n>`), `THIRD_PARTY_NOTICES.md`의 기준 커밋을 고친다. `just licenses`를 다시 돌린다.
11. 보고서에 결과(충돌 수, 바뀐 계약, 삭제한 업스트림 테스트)를 적고 브랜치를 합친다.

#### 3.18.5 주기와 계기

| 종류 | 주기·계기 |
|---|---|
| 정기 확인 | 월 1회 `just vendor-outdated`와 Breaking 목록 보기. 업그레이드는 하지 않아도 된다 |
| 업그레이드 계기 | (1) 쓰는 provider의 와이어 변경이나 보안 수정, (2) 새 모델이 `extraModels`로 해결되지 않을 때, (3) Helm이 필요한 기능(예: codemode 수정), (4) 기준 태그가 6개월 이상 지났을 때 [제안] |
| 고정 의존의 작은 수정 | 업그레이드를 기다릴 수 없으면 `pnpm patch <pkg>@1.1.0`으로 패치를 만들고 `patchedDependencies`에 기록한다. 패치 파일 이름과 이유를 `vendor/README.md` "고정 의존 패치" 표에 적는다. 업그레이드 체크리스트 3번에서 패치가 아직 필요한지 본다 |

### 3.19 테스트

#### 3.19.1 import 무결성 테스트

| ID | 위치 | 검사 | 근거 |
|---|---|---|---|
| I1 | `packages/ai/test/pi-integrity.test.ts`, `packages/tools/test/pi-integrity.test.ts`, `apps/tui/test/pi-integrity.test.ts` | 고정 의존한 pi 패키지마다: (1) 설치본 `package.json`의 `version`이 `vendor/pi-agent-core/UPSTREAM.json`의 `base.npm`과 같다, (2) 진입점을 테스트 안에서 동적 `import()`해 Helm이 쓰는 export가 함수·클래스로 있다. 패키지마다 `it` 하나로 나눠, 깨진 진입점이 다른 테스트 수집을 막지 않게 한다 | pi-web `src/server/piSdkIntegrity.test.ts:1-75`(cases §5.2), pi-fabric 버전 검사(`src/durable.ts:46-60`) |
| I2 | `just verify` → `node scripts/vendor/sync.mjs verify` (vendor 패키지 3개) | §3.18.2 `verify` 조건 | §3.17.3 |
| I3 | `vendor/*/test/surface.test.ts` | vendor 진입점의 export 목록이 고정 목록과 같다(더해지거나 빠지면 실패). `@helm/agent`의 재export 목록(§3.9.4)도 같은 방식 | 재동기화 뒤 export 표면 회귀(cases §5.8, 12 F-7) |
| I4 | `scripts/vendor/check-pi-boundary.mjs` (`just check`) | (1) §3.9.1 표 밖의 import가 없다(소스의 `import`·`export from`·`import()`를 TypeScript 파서로 읽음), (2) `@helm/ai`(단 `pi` 하위 경로 제외)·`@helm/tools` 빌드 결과 `dist/**/*.d.ts`에 `@earendil-works/`·`@helm/vendor-` 문자열이 없다(`@helm/agent`는 포크 루프 타입을 내보내므로 제외), (3) `pnpm-lock.yaml`에 `@earendil-works/pi-agent-core`·`pi-coding-agent`가 없고, 모든 `@earendil-works/*`의 해석 버전이 하나다 | D07-8 |
| I5 | `packages/ai/test/model-types.test.ts`(타입 검사로만 실패하는 테스트) | pi-ai `Message`·`SystemMessage`·`UserMessage`·`AssistantMessage`(stopReason 제외)·`ToolResultMessage`·`Usage`·`ToolCall`·콘텐츠 블록과 `@helm/domain/model`의 같은 이름 타입이 서로 대입 가능하다. vendor `ThinkingLevel`과 Helm `ThinkingLevel`이 같다 | §3.9.3 규칙 1 |

I1이 확인할 export(1차):
- `@earendil-works/pi-ai`: `createModels`, `createProvider`, `fauxProvider`, `fauxAssistantMessage`, `fauxText`, `fauxToolCall`, `validateToolArguments`, `normalizeContext`, `getCurrentTools`, `toToolDeclaration`, `createInitialSystemMessage`, `calculateCost`, `clampThinkingLevel`, `getSupportedThinkingLevels`, `isContextOverflow`, `createAssistantMessageEventStream`.
- `@earendil-works/pi-ai/providers/anthropic`: `anthropicProvider`. `@earendil-works/pi-ai/providers/openai`: `openaiProvider`.
- REPL 단계 `@earendil-works/pi-codemode`: `CodemodeSandbox`, `renderDeclarations`, `parseCodemodeSource`, `MAX_STORE_VALUE_CHARS`, `MAX_STORE_TOTAL_CHARS`.
- MCP 단계 `@earendil-works/pi-mcp`: `McpClient`, `StdioTransport`, `StreamableHttpTransport`, `toLlmContent`.
- TUI 단계 `@earendil-works/pi-tui`: `TuiMainScreen`, `TuiAltScreen`, `ProcessTerminal`, `Container`, `Text`, `Markdown`, `Editor`, `SelectList`, `KeybindingsManager`, `matchesKey`, `visibleWidth`, `truncateToWidth`, `wrapTextWithAnsi`.

#### 3.19.2 계약 테스트 위치

| 위치 | 계약 |
|---|---|
| `vendor/pi-agent-core/test/contract.test.ts`(vendor API를 직접, faux provider) | C1, C2, C3, C4, C5, C6, C7, C9, C10, C11, C12, C13, C14, C18 |
| `packages/agent/test/contract.test.ts` | C8(`assertToolDeclarations`), C20(브리지가 `runToolCall`로 같은 훅을 지남) |
| `packages/ai/test/contract.test.ts` | C15, C16, C17, C19, C23, C24(변환 스냅숏) |
| `packages/tools/test/contract.test.ts` | C21, C22 |

12의 U-AG-1(T-AG-01~09)·U-RT-3(T-PJ-02·07·08)은 이 표의 계약과 겹친다. 같은 시험을 두 번 쓰지 않도록 vendor 수준은 위 표, Helm 훅 수준은 12의 시험으로 나눈다. 시제품 `.helm-design-work/P4/fork-proto/test/contract.ts`가 C1~C7, C9, C14, C20, C21을 한 번에 돌린 출력이 `contract.out.txt`에 있다 [실험]. 구현 때 Vitest 테스트로 옮긴다.

#### 3.19.3 함께 가져오는 업스트림 테스트

| 원본(`pi@v1.1.0:packages/`) | Helm 경로 | 처리 | 결과 [실험] |
|---|---|---|---|
| `agent/test/agent-loop.test.ts`, `utils/*` | `vendor/pi-agent-core/test/` | "default stream function compatibility" describe 삭제(A6), 이벤트 목록 기대값 1건에 `tool_execution_executing` 추가(A5) | 남은 37건 중 36건 통과, 1건이 A5 기대값 수정 대상 |
| `coding-agent/test/file-mutation-queue.test.ts`, `path-utils.test.ts`, `paths.test.ts`, `edit-tool-legacy-input.test.ts` | `vendor/pi-tools/test/` | import 경로 `../src/core/tools/` → `../src/tools/`, `ExtensionToolContext` → `PiToolContext` | 통과(아래 합계) |
| `coding-agent/test/tools.test.ts` | `vendor/pi-tools/test/` | 위 경로 바꿈 + `../src/core/bash-executor.ts`를 쓰는 테스트 2건 삭제, `{ exposeSessionEnvironment: false }` → `{}` | 83건 통과 |
| `coding-agent/test/image-process.test.ts` | `vendor/pi-image/test/` | import 경로를 `../src/` 기준으로 | 통과 |

도구 쪽 합계: 6개 파일 137건 통과, 1건 건너뜀(원본에서도 조건부). 전체 시제품 173건 통과(`.helm-design-work/P4/fork-proto/test/upstream-tests.out.txt`). 업스트림 테스트는 포크한 코드가 원본 의미를 유지하는지 보는 회귀 테스트다. 업그레이드 때 새 태그의 테스트로 다시 바꾼다(§3.18.4-6).

## 4. 실패·예외·경계 사례

| ID | 상황 | 처리 | 근거 |
|---|---|---|---|
| E1 | 투영의 선언 도구와 실행 도구가 다름(모델이 실행할 수 없는 도구를 부르거나, 실행 가능한 도구가 모델에게 선언되지 않음) | `assertToolDeclarations`가 `Error("projection tool mismatch: declared-only=[...], executable-only=[...]")`를 던진다. 12의 `prepareRequest`가 부르므로 요청을 보내기 전에 run이 실패한다 | F10, C8 |
| E2 | 모델이 없는 도구를 부름 | `unknown_tool` 오류 결과. `beforeToolCall`은 불리지 않지만 `tool_execution_end`(A2 필드)는 나간다. 12는 싱크에서 `toolcall.not_executed`로 기록한다(12 §3.4.7) | C5 |
| E3 | 모델이 스키마에 맞지 않는 인자를 냄 | `invalid_args`, 오류 문구에 받은 인자가 들어간다(`validation.ts:345`). 커널 검사 이전이다 | C5 |
| E4 | `beforeToolCall`(Helm 커널 검사 또는 의도 기록)이 예외 | `hook_error`, 실행 안 함. 12의 훅은 저장 실패를 `{ block, terminate }`로 바꾸므로(12 §3.4.5) 정상 경로에서는 `blocked`로 나온다. 어느 쪽이든 실행되지 않았으므로 기록과 실제가 어긋나지 않는다 | C4 |
| E5 | 싱크(로그 커밋)가 예외 | `runAgentLoop`가 reject하고 이후 도구는 실행되지 않는다(C14). 12의 run 구동부가 잡아 run을 실패로 닫는다. 이미 실행된 도구의 결과 기록이 실패한 경우는 12의 크래시 복구 규칙("결과 없는 의도")으로 처리한다 | F9 |
| E6 | pi 메시지의 `stopReason`이 `pending`·`deferred` | `@helm/ai`가 `error`로 바꾸고 `errorMessage`를 단다 | §3.9.3 규칙 2 |
| E7 | provider 요청 실패, 인증 없음 | `ModelStream`은 throw하지 않고 `end` 이벤트의 `stopReason: "error"`로 끝난다(pi 스트림 계약, pi-facts-1 §2.5). 직접 API 모듈의 `streamSimple()`은 인증이 없으면 동기 throw할 수 있으므로, `@helm/ai`는 `Models.stream`만 쓴다(그쪽은 스트림 오류로 바꾼다, `models.ts:877-907`) | F11 |
| E8 | 실행 중 중단(abort) | 실행 중이던 도구는 신호를 받고 대개 `"Operation aborted"`를 던진다(`executed: true`, 오류). 아직 시작하지 않은 호출은 `aborted_before_execute`(A3). write·edit는 쓰기 뒤 중단을 감지하면 이미 바뀐 파일에 대해 오류를 낸다(C22) → 12·13이 "효과 불확실"로 다룬다 | A3, C9, C22 |
| E9 | 루프가 입력 메시지와 도구 선언 system 메시지(`declareToolChanges`)를 `message_end`로 되돌려 보냄 | 12의 싱크는 user 메시지가 이미 기록됐는지만 확인한다(12 §3.4.4). 도구 선언 system 메시지는 투영이 선언을 포함하면(C8) 생기지 않는다. 생겼다면 투영 버그로 기록한다 | `agent-loop.ts:117-122,211-216,333-363` |
| E10 | steering·follow-up 입력 | `Agent`의 메모리 큐를 쓰지 않는다. 12의 입력 inbox가 `getSteeringMessages`·`getFollowUpMessages`로 공급하고, 공급 전에 기록한다(12 §3.4.2, §3.12) | `types.ts:282-306` |
| E11 | `rg`/`fd`가 없음 | 도구가 `"<tool> is not installed..."` 오류. 내려받지 않는다. `just setup`이 설치하고 `helm doctor`(17)가 확인한다 | T3 |
| E12 | 허용 루트 밖 경로, 루트 안에 있으나 밖을 가리키는 심볼릭 링크 | 경로 정책이 `realpath` 기준으로 거부(`executed: true`, 오류). 13의 `prepare`가 `beforeToolCall`에서 먼저 거부하는 것이 정상 경로(12 §3.4.5 `pathDenials`)이고 도구 층 거부는 두 번째 방어선이다 | T7 |
| E13 | 이미지 처리 실패(photon 로드 실패, 변환 불가) | read가 이미지 대신 `"[Image omitted: ...]"` 텍스트를 돌려준다(`image-process.ts:77-82,85-92`) | 원본 동작 유지 |
| E14 | 데몬을 `node --watch`로 실행 | pi-codemode 1.1.0 worker가 깨진다(#10725). 개발 레시피(06 `just dev`)는 `--watch` 대신 프로세스 재시작 방식 감시를 쓴다 | §3.1.3 |
| E15 | 업그레이드에서 3-way 병합 충돌 | `sync.mjs upgrade`가 1로 끝나고 충돌 표지를 남긴다. 손으로 풀고 체크리스트(§3.18.4)를 끝까지 한다 | §3.18 |
| E16 | 업그레이드 뒤 pi 메시지 모양이 바뀜 | I5 실패 → 변환 코드 작성. 옛 로그는 Helm 타입으로 저장돼 있으므로 그대로 읽힌다 | §3.9.3 |
| E17 | vendor 파일을 패치 ID 없이 고침 | `sync.mjs verify` 실패(I2) → `just verify` 실패 | §3.18.2 |
| E18 | 경계 밖 패키지가 pi를 import | I4 실패 | §3.9.1 |
| E19 | `overrides`로도 pi 패키지 버전이 둘로 해석됨 | I4(3) 실패 | §3.3.2 |
| E20 | 모델이 낸 인자와 실행 인자가 다름(13의 정규화) | 둘 다 기록한다: 모델 인자는 assistant 메시지(12 `toolcall.requested.modelArgs`), 실행 인자는 A4의 `{ args }`와 A2의 `args`(12 `toolcall.intend.executedArgs`) | A2, A4, C6 |
| E21 | 투영 배열을 다른 곳에서 재사용 | A1로 루프가 바꾸지 않는다. 그래도 Helm은 투영을 불변 값으로 다룬다(얼리지는 않음, 비용) | C7 |
| E22 | assistant 메시지가 `stopReason: "stop"`인데 도구 호출 블록을 가짐 | 실행한다(C11). 커널 검사는 그대로 적용된다 | C11 |
| E23 | `afterToolCall`이 `content`만 돌려줌 | `structuredContent`가 지워진다. 12의 `afterToolCall`은 `structuredContent`를 함께 돌려준다(12 §3.4.6 반환 줄) | C12 |
| E24 | OAuth 토큰(`sk-ant-oat`)이 키로 쓰임 | Anthropic 요청 system 앞에 Claude Code 신원 문구가 붙는다(`anthropic-messages.ts:978-979,1166-1172`). Helm은 API 키만 주입한다(`.env.example`에 OAuth 변수를 두지 않는다, 18) | §3.11.2 |

## 5. 다른 문서와의 인터페이스

### 5.1 이 문서가 제공하는 것

| 받는 문서 | 제공 |
|---|---|
| 06 | `vendor/` 구조와 작업 공간 패키지 3개, 감싸는 패키지 대응(06 §3.4.1 끝 목록의 확정), `pnpm-workspace.yaml`의 `overrides`, vendor 컴파일 설정, import 허용 표(§3.3, §3.9.1), justfile 레시피 후보: `vendor-status`, `vendor-verify`, `vendor-outdated`, `vendor-upgrade to=<tag>`, `licenses`, `ai-smoke` |
| 08·09 | `@helm/domain/model`에 둘 모델 데이터 타입의 모양(§3.9.2), 도구 호출 결과의 `executed`·`rejection` 6종(A2) |
| 10·11 | 커널 검사 연결 지점의 pi 쪽 의미: `beforeToolCall`의 `{ block, reason, terminate, args }`(A4), 거부 종류의 구분(A2) |
| 12 | 12 §3.4.1 F-1~F-7을 받은 패치 A1~A7(§3.5)과 그 차이(F-4를 별도 이벤트로), `@helm/agent` 재export 목록(§3.9.4), `@helm/ai/pi` 기계 타입(§3.9.2), 12가 물은 provider 변환 사실(§3.11.6), 이미지 모듈 `@helm/vendor-pi-image`(§3.6.4), 계약 C1~C24 |
| 13 | vendor 도구 표면(`create*ToolDefinition`, 옵션 `operations`·`spawnHook`·`env`·`pathPolicy`, `resolveToCwd`·`resolveReadPathAsync`, `setOutputDirectory`, `configureToolBinaries`), 도구 기본값 표(§3.9.5), `createPathPolicy`·`buildShellEnv`(§3.8), REPL 브리지(§3.12), MCP 규칙(§3.13), pi CLI 어댑터의 pi 쪽 사실(§3.16) |
| 15 | pi-codemode 1.1.0 API 이름과 행(§3.1.4, §3.12), 브리지가 훅을 지난다는 보장(C20) |
| 16 | pi 세션 특성 정리(§3.15). 외부 로그 어댑터는 16이 소유 |
| 18 | 셸 환경 기본 허용 목록 후보(§3.9.5), 고정 의존과 vendor의 공급망 표면, OAuth 토큰 주의(E24) |
| 19 | pi-protocol·pi-server·pi-client·pi-env를 코드로 쓰지 않는다는 결정(§3.2), TUI가 같은 클라이언트 코어를 쓴다는 전제(§3.9.6) |
| 20·21 | 데스크톱 앱 "정보" 화면의 서드파티 고지 위치(§3.17.2) |
| 22·23 | 테스트 목록(I1~I5, C1~C24, 업스트림 테스트), 도입 단계(1차/REPL/MCP/TUI/어댑터), 구현 단위(§6) |

### 5.2 다른 문서에 요구하는 것

| 문서 | 요구 |
|---|---|
| 06 | (1) 저장소 구조와 `pnpm-workspace.yaml`에 `vendor/pi-agent-core`, `vendor/pi-tools`, `vendor/pi-image`를 넣고 §3.3.2의 `overrides`를 둔다. (2) §3.4.1 끝 목록을 §3.9.1 원칙 1로 고친다: pi-ai·`vendor-pi-image` → `ai`, `vendor-pi-agent-core` → `agent`, `vendor-pi-tools`·pi-codemode·pi-mcp → `tools`, pi-tui → `tui`(고정 의존으로 확정). vendor끼리의 의존(원칙 2)은 R7 예외로 적는다. (3) `@helm/ai/pi` 하위 경로를 R2 같은 하위 경로 제한에 넣는다(허용: `agent`, `runtime`의 루프 구동 파일). (4) `@helm/domain`에 `model` 하위 경로(§3.9.2)를 둔다(08과 함께). (5) 06 §3.12 표의 "vendor pi-ai"를 "고정 의존 pi-ai 1.1.0"으로 고친다. (6) vendor 패키지 `tsconfig`가 `allowImportingTsExtensions`·`rewriteRelativeImportExtensions`·`erasableSyntaxOnly`를 켤 수 있게 한다(TS 6.0.3에서 확인함). (7) justfile에 §5.1 레시피를 넣고 `just verify`가 I1~I5와 `sync.mjs verify`를 돈다. (8) 개발 실행(`just dev`)에 `node --watch`를 쓰지 않는다(E14) |
| 08 | `@helm/domain/model`(§3.9.2)을 08의 타입 목록에 넣고 최종 이름을 정한다. 08의 다른 "메시지" 개념과 이름이 겹치면 하위 경로로 나눈다 |
| 09 | (1) 모델 메시지 저장 형식은 `@helm/domain/model`이고 형식 버전을 둔다. (2) 도구 호출 기록에 `executed`, `rejection.kind`, `modelArgs`, `executedArgs`, `structuredContent`를 담는다(12 §3.4.10의 `toolcall.not_executed.reason`과 A2의 `rejection.kind` 값 이름을 맞춘다: `unknown_tool`, `invalid_args`, `truncated_response`, `aborted_before_execute`, `blocked`, `hook_error`). 16이 가정한 이름(`tool_call.requested` 등)과의 대응을 정한다. (3) 스트리밍 delta는 정본에 넣지 않는다(cases §12.1-6, 12와 같음) |
| 10 | 커널 도구 검사가 실행 인자를 바꾸는 경우 A4의 `{ args }`를 쓴다(12 §3.4.5와 같음) |
| 12 | (1) 12 §3.4.1 F-4를 A5의 별도 이벤트 `tool_execution_executing`으로 바꾼다(이유 §3.5 A5). (2) F-1의 `rejection.kind`에 `hook_error`를 더한다. (3) 12 §3.4.7 마지막 행(순차 abort 뒤 결과 메시지 없음)은 A3로 루프가 결과를 만들므로 `toolcall.not_executed { reason: 'aborted' }` 기록만 남기고 투영 보충은 지운다. (4) `prepareRequest`에서 `assertToolDeclarations`(§3.9.4)를 부른다. (5) §3.5.2의 [가정](toolResult 뒤 주입 텍스트 합침)은 pi-ai가 합치지 않는다는 사실(§3.11.6, C23)로 고친다. (6) `AiConfig`에 추가 모델 항목(`extraModels`)을 둘지 정한다(§3.11.5). (7) 이미지 크기 조정은 `@helm/vendor-pi-image`의 `processImage`를 쓴다(§3.6.4). (8) 요약 프롬프트를 옮겨 쓰면 출처 표시(§3.17.3)를 단다. (9) run 구동부는 `runAgentLoop` reject(싱크 예외, C14)를 잡아 run을 실패로 닫는다 |
| 13 | (1) 도구별 `primitive`·`replay`·`executionMode` 최종값(§3.9.5 기본값). (2) `canonicalize`(13 §3.4.2)를 vendor 도구의 `pathPolicy.check`(T7+)로도 넣어, `prepare`가 검사한 경로와 도구가 여는 경로를 같게 한다. (3) bash 격리를 `BashOperations` 또는 `spawnHook`으로 정한다. (4) bash 셸 환경은 `buildShellEnv`로 만든다. (5) 노출 등급과 REPL 도구 설명의 불변 규칙(캐시). (6) MCP 결과 이름 규칙과 `outputSchema` 위반 처리(§3.13). (7) pi CLI 어댑터의 능력 목록에 "투영 unavailable", "도구 검사는 주입 확장이 로드됐을 때만"을 적는다(§3.16.4). (8) 도구 명세에서 vendor `ToolDefinition`으로 가는 변환을 §3.9.5 표대로 한다. (9) T13(bash 기본·최대 시간)과 T14(`rg`·`fd` 실행 주입)의 값과 쓰임을 정한다. (10) 13 §3.1이 `TSchema`·`Static`을 `@helm/ai`(pi-ai 재수출)에서, `AgentTool`·`AgentToolResult`를 `@helm/agent`에서 import하는데, 06 §3.4.1은 `tools`의 의존을 `domain`만 허용한다. TypeBox는 `typebox`에서 직접 import하고(§3.9.1 원칙), 결과 타입은 06과 함께 `tools → agent`(타입만) 허용 여부를 정한다 |
| 15 | §2.3·§3.12의 pi-codemode 인용을 `v1.1.0` 이름으로 고친다: `CodemodeSandboxBaseOptions.globals`(`types.ts:102-109`) → `CodemodeSandboxOptions.globals`(`types.ts:102`). `runtime/host.ts:12-18` 인용은 `v1.1.0` `runtime/host.ts`(416줄, `CodemodeSandbox`는 :340)에서 다시 확인. 스크립트 안 도구 호출은 §3.12 브리지를 쓴다 |
| 16 | pi 외부 로그 어댑터가 `context_edit`와 버린 분기를 처리한다(16 §3.6.3, 이미 반영 중). pi 세션 형식 버전 3 밖이면 건너뛴다 |
| 17 | (1) `rg`, `fd` 설치를 `just setup`에 넣고 `helm doctor`가 확인한다(T3). (2) 도구 전체 출력 디렉터리(T5) 위치와 보존 기간. (3) 데몬 실행에 `node --watch`를 쓰지 않는다(E14). (4) 17의 버전 기록 `pi: { vendorCommit, npm }`의 값은 `vendorCommit: "abe508e1b89912adde45528136c3221eb69acdd7"`(태그 `v1.1.0`), `npm`은 고정 의존 4개 모두 `"1.1.0"`이다 |
| 18 | (1) §3.15의 "pi 포크(`vendor/`) 기준 커밋 `cdaf6c2`"를 "태그 `v1.1.0`(커밋 `abe508e1`)"로 고친다(§3.1). (2) R-2 허용 목록과 13의 `HELM_RUN_ID`·`HELM_TOOL_CALL_ID` 주입(`HELM_*` 금지와 충돌)을 13과 맞춘다. (3) 데몬 환경에 Anthropic OAuth 토큰을 두지 않는다(E24). (4) vendor 갱신은 §3.18.4 체크리스트로만 한다 |
| 19 | TUI 클라이언트가 데스크톱과 같은 클라이언트 코어를 쓴다는 전제를 유지한다(§3.9.6) |
| 20 | "정보" 화면에 `THIRD_PARTY_NOTICES.md` 내용을 보여 준다 |
| 22 | 테스트 계층에 I1~I5(무결성), C1~C24(계약), vendor 업스트림 테스트를 넣는다. faux provider는 `api`를 고정한다(C17) |
| 23 | §6 구현 단위를 마일스톤에 배치한다. V1~V5는 1차 런타임보다 먼저 한다 |

## 6. 구현 단위와 완료 기준

| ID | 단위 | 파일 | 완료 기준(테스트로 확인) |
|---|---|---|---|
| V1 | vendor 기반 | `vendor/README.md`, `vendor/LICENSES/pi-mono-MIT.txt`, `scripts/vendor/sync.mjs`, `UPSTREAM.json` 스키마 | `sync.mjs status`가 빈 vendor 패키지에서 0, 헤더 없는 파일·선언 없는 수정에서 1. 헤더 줄을 빼고 비교한다. 시제품 동작(§3.18.2)을 Vitest로 고정 |
| V2 | `@helm/vendor-pi-agent-core` | §3.4 표 | (1) `sync.mjs verify` 0(A1~A7 외 차이 없음). (2) 업스트림 테스트 37건 통과(A5 기대값 1건 수정 후). (3) `contract.test.ts`의 §3.19.2 표 항목 통과. (4) `tsc --noEmit` 오류 0 |
| V3 | `@helm/vendor-pi-tools`, `@helm/vendor-pi-image` | §3.6 표 | (1) `sync.mjs verify` 0. (2) 업스트림 테스트 6개 파일 통과(§3.19.3). (3) 패키지 소스에 `@earendil-works/pi-tui`, `pi-coding-agent`, `config.ts`, `tools-manager` 문자열이 없다. (4) 네트워크를 막은 상태(`unshare -n` 등)에서 grep·find 테스트가 통과한다(내려받기 없음). (5) 1×1 PNG를 read하면 `["text","image"]` |
| V4 | `@helm/ai`의 pi 연결부 | §3.8 `packages/ai/src/pi*`, `packages/domain/src/model.ts` | (1) I1, I5. (2) C15, C16, C17, C19, C23, C24. (3) `stopReason` `pending`·`deferred` 변환(§3.9.3 규칙 2). (4) 공개 d.ts에 pi 타입 없음(I4-2, `pi` 하위 경로 제외) |
| V5 | `@helm/tools`의 pi 연결부 | §3.8 `packages/tools/src/pi/*` | (1) C21, C22. (2) `createPathPolicy`: 루트 안 파일 허용, 밖 거부, 루트 안에 있으나 밖을 가리키는 심볼릭 링크 거부, 없는 파일은 조상 기준. (3) `buildShellEnv` 결과에 허용 목록 밖 변수가 없다. (4) 도구 7개의 기본값이 §3.9.5 표와 같다(13 확정값으로 바꿈) |
| V6 | `@helm/agent` | `packages/agent/src/index.ts` | (1) I3(재export 목록). (2) C8, C20. (3) `agentLoop`·`agentLoopContinue`·`Agent`·`setDefaultStreamFn`을 내보내지 않는다 |
| V7 | 경계 검사 | `scripts/vendor/check-pi-boundary.mjs` | I4: 허용 표 밖 import를 넣은 시험 파일에서 실패, 지우면 통과. lockfile 검사 포함 |
| V8 | 고지 | `THIRD_PARTY_NOTICES.md`, `just licenses` | 생성 결과가 커밋본과 같다. pi 항목에 기준 커밋이 있다 |
| V9 | REPL 브리지(REPL 단계) | `packages/tools/src/pi/repl.ts` | C20 Vitest 판, 스크립트 실패 시 `storeWrites` 없음, 기한 초과 시 `kind: "timeout"`, I1(pi-codemode) |
| V10 | MCP(MCP 단계) | `packages/tools/src/pi/mcp.ts` | `InMemoryTransport`(`@earendil-works/pi-mcp/testing`)로 `outputSchema` 위반 결과 처리, 이름 규칙, I1(pi-mcp), 고지 추가 |
| V11 | pi CLI 어댑터 pi 쪽(어댑터 단계) | `vendor/pi-rpc/`, `helm-bridge.mjs` | LF 전용 JSONL 리더가 `U+2028` 포함 문자열을 한 줄로 읽는다, `agent_settled` 전에는 턴을 끝내지 않는다, `extension_ui_request` 4종이 질문으로 바뀐다(13의 어댑터 적합성 테스트 안에서) |

## 7. 미결 사항

| ID | 질문 | 선택지 | 추천 기본값 |
|---|---|---|---|
| M1 | 12 F-4(같은 `tool_execution_start`를 phase로 두 번)와 A5(별도 `tool_execution_executing`) 중 무엇으로 할까 | (a) A5, (b) F-4 | (a). 이벤트 종류마다 호출당 한 번이라는 성질을 지킨다. 12와 2단계에서 맞춘다 |
| M2 | pi-ai를 언제 vendor로 바꿀까 | (a) 고정 의존 유지, (b) 지금 vendor | (a). §3.2 재검토 조건(패치 3개 또는 200줄 초과, 구조 변경 필요)에 해당하면 바꾼다 |
| M3 | 구독형 OAuth(Claude Pro·ChatGPT 계정) 지원 | (a) API 키만, (b) 영속 `CredentialStore` 구현 | (a). 12 §7 O-12-08과 같다. (b)는 18의 비밀 저장 결정 뒤에 |
| M4 | 모델 데이터 타입을 `@helm/domain`에 둘지 `@helm/ai`에 둘지 | (a) `domain/model`(이 문서), (b) `ai` | (a). 12 §3.4.10의 실행 기록 타입이 `@helm/domain`에 있고 `domain`은 `ai`를 import할 수 없다(06 §3.4.1) |
| M5 | 실제 TTY에서 pi-tui 확인(Kitty 협상, IME, 한국어 줄바꿈) | TUI 단계 시작 때 확인 | TUI 단계 첫 작업으로 둔다. 줄바꿈이 나쁘면 `wrapTextWithAnsi`를 Helm 쪽에서 감싼다 |
| M6 | coding-agent 채팅 부품(`assistant-message.ts`) vendor 여부 | (a) 참고만, Helm이 `Markdown`으로 작성, (b) vendor + 테마 대체 | (a) |
| M7 | 스킬·도구 설명 길이를 가장 엄격한 런타임 제약(예: Codex 1024자)에 맞출지(extracts-1 Q15) | 13이 정함 | pi에는 설명 길이 제한 코드가 없다 [원문: `ToolDefinition.description`은 문자열만]. 13이 어댑터별로 자를지 정한다 |
| M8 | `HELM_PI_CLONE` 클론을 업그레이드용으로 따로 둘지 | (a) `~/projects/_ref/pi-src` 공유, (b) 별도 | (a). 스크립트는 읽기만 한다 |
| M9 | 업스트림에 A2·A3·A4를 제안(PR)할지 | (a) 안 함, (b) 이슈로 제안 | (b)를 권하나 push·PR은 사용자 확인 사항이다. 받아들여지면 포크 패치가 줄어든다 |
| M10 | vendor 패키지를 `src` 그대로 실행(Node 타입 제거)할지 `dist`로 빌드할지 | (a) 빌드, (b) 소스 직접 | (a). 06 ADR-06-15(`tsc -b`, `source` 조건)와 맞춘다. 시제품은 (b)로도 돌았다 [실험] |
| M11 | `assertToolDeclarations`의 재생 규칙을 pi-ai 함수 재export로 할지 Helm 코드로 둘지 | (a) `@helm/ai/pi`에서 `getCurrentTools` 재export, (b) Helm 구현 | (a). 루프가 쓰는 규칙과 같아야 한다 |

## 8. 출처

### 8.1 pi 소스

- 저장소 `~/projects/_ref/pi-src`, 태그 `v1.1.0`(커밋 `abe508e1`), `main` 커밋 `cdaf6c2`. 작업 사본 `.helm-design-work/P4/pi-v1.1.0/`.
- `packages/agent/`: `src/{agent,agent-loop,types,stream-fn,index,proxy}.ts`, `test/*`, `package.json`, `CHANGELOG.md`, `tsconfig.build.json`, `vitest.config.ts`
- `packages/ai/`: `package.json`, `src/index.ts`, `src/types.ts`, `src/models.ts`, `src/utils/{validation,transcript,provider-retry}.ts`, `src/api/{anthropic-messages,transform-messages}.ts`, `src/providers/{anthropic,openai,faux}.ts`, `src/auth/context.ts`, `CHANGELOG.md`
- `packages/coding-agent/`: `package.json`, `src/core/tools/*.ts`, `src/core/tools/renderers/*`, `src/utils/{shell,child-process,paths,mime,text,output-files,image-*,photon,exif-orientation,tools-manager}.ts`, `src/core/extensions/types.ts`, `src/core/session-manager.ts`, `src/modes/rpc/{rpc-types,jsonl}.ts`, `src/modes/interactive/components/*`, `src/modes/interactive/theme/theme.ts`, `src/extensions/{codemode,mcp}/*`, `src/cli/args.ts`, `docs/{rpc,json}.md`, `test/{tools,file-mutation-queue,path-utils,paths,edit-tool-legacy-input,image-process}.test.ts`, `CHANGELOG.md`
- `packages/codemode/`: `package.json`, `src/{index,types}.ts`, `src/runtime/{host,prelude-source}.ts`, `CHANGELOG.md`
- `packages/mcp/`: `package.json`, `LICENSES/*`, `CHANGELOG.md`
- `packages/tui/CHANGELOG.md`, 루트 `LICENSE`, `package.json`, `tsconfig.base.json`, `AGENTS.md`

### 8.2 설계 자료

- 브리프 `docs/design/process/00-design-brief.md`, `docs/handoff/HANDOFF.md` §2
- `process/sources/pi-api-facts-1.md`, `pi-api-facts-2.md`, `pi-layer-analysis.md`, `pi-cases-notes.md`
- `process/sources/conversation-extracts-1.md` §7, §8, §11, §15; `-2.md` d-1; `-3.md` §4, §5, §11; `-4.md` §13, §14, §16, §21; `helm-canon-2.md` §7.2, §7.4, §10, §11 "07"
- `.helm-design-work/S4/{openclaw,openclaw-runtime,pi-web,paseo,pi-fabric}.md`
- `docs/v0.3/audit/pi-runtime-options.md`, `backend-oss-research.md`, `mastra-review.md`; `docs/v0.3/12-implementation-architecture.md` §7, `13-stack-feasibility.md` §2.2·§2.3, `14-alternative-structure.md` §3·§4
- `experiments/pi-lab/exp1~6-*.mjs`, `.helm-design-work/S3a/exp-a1*`, `exp-a2*`, `.helm-design-work/S3b/*`
- 함께 맞춘 설계 문서: 06(초안 §1~§2.5), 15 §2.3, 16 §3.6.3, 19 §2

### 8.3 P4 실험 (`.helm-design-work/P4/`)

| 파일 | 내용 |
|---|---|
| `verify-npm-vs-tag.py`, `npm-vs-cdaf6c2.txt` | npm 1.1.0 소스맵과 태그·커밋 비교(F1) |
| `apply-agent-patches-v2.py` | A1~A7 적용 스크립트(원본 → 출력 디렉터리, 헤더 포함). `apply-agent-patches.py`는 12 정렬 전 판(참고) |
| `apply-tools-patches.py` | T1~T11과 T2 보충 적용 스크립트(T12는 패키지 분리 때 import 경로만 바꿈) |
| `fork-proto/vendor/*` | vendor 시제품(`UPSTREAM.json` 포함) |
| `fork-proto/test/contract.ts`, `contract.out.txt` | 계약 C1~C7, C9, C14, C20, C21(저수준 루프, `Agent` 없이) |
| `fork-proto/test/image.ts` | T6 뒤 이미지 읽기 |
| `fork-proto/test/upstream-tests.out.txt` | 업스트림 테스트 결과(173 통과, 실패 1 = A5 기대값 수정 대상) |
| `fork-proto/scripts/vendor-sync.mjs` | status·upgrade 시제품 |
| 환경 | Node v24.19.0, npm 11, TypeScript 5.9.3·6.0.3, Vitest 4.1.11, rg 15.2.0, fd 10.5.0 |

## ADR 후보

### ADR-07-1 포크·고정 의존 기준을 태그 v1.1.0 하나로 둔다

- 상태: 제안
- 맥락: 0단계 자료는 `main` 커밋 `cdaf6c2`를 기준으로 썼고, npm 배포는 1.1.0이다. 두 기준은 ai·tui·codemode 등에서 다르다(F1).
- 결정: vendor 원본과 고정 의존을 모두 태그 `v1.1.0`(`abe508e1`) = npm 1.1.0으로 한다.
- 근거: npm 1.1.0과 태그의 소스가 같다 [실험]. 한 저장소 안에서 API 기준이 하나가 된다. Helm이 가져오는 agent·도구 파일은 두 커밋 사이에 같다.
- 기각한 대안: (a) `cdaf6c2` 포크 + npm 1.1.0 의존 — vendor와 의존의 타입 배치가 다르다. (b) `cdaf6c2` 포크 + 모든 것을 vendor — pi-ai 와이어 코드까지 떠안는다.
- 결과: `cdaf6c2`의 Unreleased 수정(codemode `--watch`, Mistral, MCP `iss`)은 다음 업그레이드에서 받는다. 0단계 자료의 일부 행 번호를 `v1.1.0`으로 읽어야 한다(§3.1.4).

### ADR-07-2 pi-ai는 포크하지 않고 정확한 버전으로 고정 의존한다

- 상태: 제안
- 맥락: 결정 27은 포크 또는 고정 의존을 허용한다. pi-ai는 27,242줄이고 그중 provider 와이어 코드가 13,186줄이다.
- 결정: `@earendil-works/pi-ai@1.1.0` 고정 의존, `overrides`로 한 버전, 수정은 `pnpm patch`. Helm 코드는 `@helm/ai`의 Helm 소유 타입만 본다.
- 근거: 지금 고칠 곳이 없다(faux `api`·자격 증명은 옵션). provider 변경 추적을 업스트림에 맡긴다. 경계 타입 덕분에 나중에 vendor나 다른 계층으로 바꿔도 Helm 바깥 코드는 바뀌지 않는다(happy-agent는 3주 만에 pi-ai를 걷어냈다, cases §3.2).
- 기각한 대안: vendor 포크(추적 비용), 자체 provider 계층(1차 범위 초과).
- 결과: pi-ai 업그레이드는 버전 올림 + I1·I5·C15~C17 + 실제 provider 확인 하나로 한다.

### ADR-07-3 pi-agent-core의 루프 두 파일을 vendor 포크하고 A1~A7을 넣는다

- 상태: 제안(결정 28의 구체화, 12 §3.4.1 F-1~F-7 수용)
- 맥락: 결정 28은 포크를 정했다. 12는 `Agent` 클래스를 쓰지 않고(RT-1) 루프 변경 F-1~F-7을 요구했다. 원본 루프는 넘긴 컨텍스트 배열을 바꾸고(F3), 실행되지 않은 호출의 이유를 구분하지 않으며(F4), 중단 때 남은 호출을 결과 없이 둔다(F8).
- 결정: `agent-loop.ts`, `types.ts`만 vendor하고 A1(컨텍스트 복사), A2(`executed`·`rejection`·실행 인자), A3(중단 완결), A4(`args` 명시 교체·재검증), A5(`tool_execution_executing`), A6(전역 streamFn·proxy 제거), A7(주석)을 적용한다.
- 근거: 결정 30의 "의도 → 실행 → 결과" 기록이 문구 해석 없이 가능하다. 업스트림 테스트 37건 중 36건이 그대로 통과하고 1건은 A5의 이벤트 하나만큼 기대값을 고친다 [실험].
- 기각한 대안: (a) 수정 없이 사용하고 Helm이 문구를 해석 — openclaw의 transcript 꼬리 해석 문제(cases §12.2-2). (b) `Agent` 상속 — 비공개 상태 덮어쓰기(pi-fabric). (c) `Agent` 클래스까지 vendor — 메모리 상태가 Helm 기록과 두 벌이 된다(12 RT-1). (d) F-4를 같은 이벤트 두 번으로 — start/end 짝이 깨진다.
- 결과: 업그레이드는 3-way 병합. A2~A4를 업스트림에 제안할 수 있다(M9).

### ADR-07-4 coding-agent 도구는 7개만 vendor하고 경로 정책 훅을 넣는다

- 상태: 제안
- 맥락: 패키지 루트 import는 앱 전체(33개 패키지)를 끌어오고, 도구 파일은 렌더러·확장 타입·`rg`/`fd` 내려받기에 묶여 있다(F12). 도구는 경로를 제한하지 않는다(F14). bash는 데몬 환경을 그대로 넘긴다(F13).
- 결정: 도구 7개와 의존 26개 파일을 vendor하고 T1~T14를 적용한다. 렌더러·내려받기 제거, 셸 환경 주입, `PathPolicy` 훅, 출력 디렉터리 설정.
- 근거: 잘림·이어 읽기·편집 매칭·프로세스 트리 종료를 그대로 쓴다. 업스트림 테스트 137건 통과 [실험]. 이미지 유틸은 `@helm/ai`도 쓰므로 `@helm/vendor-pi-image`로 뗀다. 주입 지점(`*Operations`, `spawnHook`)이 남아 격리(13)를 붙일 수 있다(pi-chat 사례).
- 기각한 대안: (a) 패키지 고정 의존 + 루트 import — 무게와 숨은 동작. (b) Helm 도구를 처음부터 작성 — 검증된 세부를 다시 만든다. (c) pi-durable 도구 — grep/find/ls가 없고 `ExecutionEnv` 기반이다.
- 결과: 도구 버그 수정은 업그레이드 때 병합한다. 화면 표시는 클라이언트가 결과 JSON으로 그린다.

### ADR-07-5 vendor는 작업 공간 패키지, 출처 헤더, 파일 단위 3-way 동기화로 관리한다

- 상태: 제안
- 맥락: 포크한 파일이 어디서 왔고 무엇을 바꿨는지 잃지 않아야 업그레이드할 수 있다.
- 결정: `vendor/<이름>/`을 비공개 패키지로 두고 `UPSTREAM.json`·`PATCHES.md`·`LICENSE`·파일 헤더·`HELM-PATCH` 표지를 두며, `scripts/vendor/sync.mjs`(status·diff·verify·outdated·upgrade)로 관리한다. vendor는 포맷터·린터에서 제외한다.
- 근거: 파일 단위로 원본과 비교하고 `git merge-file`로 병합할 수 있다 [실험: 시제품]. git subtree·submodule은 pi 모노레포 전체를 끌어오거나 파일 부분 선택이 어렵다.
- 기각한 대안: git subtree(모노레포 전체), submodule + 패치 파일(빌드 단계에서 패치 적용, 편집이 불편), 원본 사본과 패치 파일 분리 보관(두 벌 관리).
- 결과: `just verify`가 vendor 무결성을 검사한다.

### ADR-07-6 저장되는 모델 데이터는 Helm 소유 타입, pi 기계 타입은 루프 연결부에만

- 상태: 제안
- 맥락: pi는 patch에서도 호환을 깼다. 이벤트 로그와 실행 기록은 모델 메시지를 오래 저장한다. 12는 pi-ai 메시지 타입을 실행 기록(`@helm/domain`)과 게이트웨이 인터페이스에 쓰고, 06은 pi-ai 타입을 공개 API로 그대로 내보내지 않게 했다.
- 결정: 메시지·콘텐츠 블록·사용량 등은 `@helm/domain/model`에 pi-ai와 같은 모양의 Helm 소유 타입으로 둔다(I5로 일치 검사). `Model<Api>`·`TranscriptContext` 같은 루프 연결 타입은 `@helm/ai/pi` 하위 경로로만 재export하고 `@helm/agent`·런타임 루프 구동 파일만 쓴다. pi 패키지마다 감싸는 Helm 패키지는 하나다. v0.2 OpenAI provider 계약의 "섞인 출력 거부" 규칙은 채택하지 않고, 텍스트를 상태 변경 근거로 쓰지 않는 규칙(13)으로 대신한다.
- 근거: 저장 형식이 pi 버전에 묶이지 않는다. 업그레이드로 깨지는 곳이 `@helm/ai` 안에 머문다. 같은 모양이므로 변환 비용이 없다.
- 기각한 대안: pi 타입 별칭 재export(업그레이드가 Helm 전체로 번진다), 완전히 다른 Helm 메시지 형식(변환 코드, 서명 보존 문제), 타입을 `@helm/ai`에 두기(`domain`이 `ai`를 import할 수 없다).
- 결과: `check-pi-boundary.mjs`(I4)와 타입 일치 시험(I5)을 유지해야 한다.

### ADR-07-7 pi-durable·pi-protocol·pi-server·pi-client·chord·pi-env 코드는 쓰지 않는다

- 상태: 제안(결정 29의 확장)
- 맥락: 이 패키지들은 experimental이거나 Chord 서비스 모델·pi-durable `ExecutionEnv`에 묶여 있다(pi-facts-2 §12.3, §13).
- 결정: 설계 참고만 한다(§3.2 표의 참고 절). 프로토콜은 19, 크래시 복구는 12가 자체로 만든다.
- 근거: 결정 29·31, 재접속·재전송 부재(pi-facts-2 §0-2), 인증 없음, CHANGELOG 없음(chord).
- 기각한 대안: pi-server 위 Helm 데몬(안 6), pi-durable 위 Helm(안 4).
- 결과: pi-durable이 experimental을 떼면 12의 복구와 비교 재검토한다.
