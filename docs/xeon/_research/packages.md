# 층 구성요소별 패키지 경계와 채택 판정 (R2)

기준: pi-src `cdaf6c2`(2026-10-11, 패키지 1.1.0), omp `d1bffdf`(18.12.3), opencode `a62028d`(2.1.1), cordis `df4431e`(4.0.0-rc.11), srt 0.0.81. npm 최신은 2026-10-21에 레지스트리로 확인했다. 표기: [원문] 소스·레지스트리에서 직접 확인, [추측] 추론, [미확인] 확인 못함. 코드는 실행·설치·빌드하지 않았다(pi-ai 1.3.0 tarball만 `r2/tgz-ai/x`에 풀어 읽었다). 줄 번호는 pi-src 1.1.0 소스 기준이고, 1.3.0 dist에서 위장 코드가 그대로 있음은 확인했다(`dist/api/anthropic-messages.js:43,784,813`).

약어: `ai`=packages/ai, `agent`=packages/agent, `dur`=packages/durable, `S`=dur/docs/spec.md, `mcp`=packages/mcp, `ca`=packages/coding-agent/src, `oc`=opencode packages/core/src, `omp`=oh-my-pi, `srt`=sandbox-runtime. 판정: 그대로(npm 의존) / 포크(소스를 가져와 고침) / 설계(읽고 우리가 새로 씀) / 자체(참고할 구현이 없음). 계획 열의 "설계"는 계획 페이지의 설계 채택, "코드"는 코드 채택이다.

## 0. 요약

1. pi-ai는 단독 의존이 된다. 다른 pi 패키지를 import하지 않고(telemetry 제외) 코어는 부수효과가 없다. 대신 Anthropic·Bedrock·Google·OpenAI SDK가 전부 hard dependency라 설치가 무겁고(4.2MB, 837파일), minor마다 breaking이 있다.
2. Anthropic OAuth 위장은 `ai/src/api/anthropic-messages.ts` 안 8곳에 흩어져 있고 provider가 아니라 토큰 문자열(`sk-ant-oat`)로 켜진다. 로그인 흐름(`auth/oauth/anthropic.ts`)은 이미 별도 lazy 모듈이다. 포크 없이 `options.client`·`onPayload`·`ProviderStreams` 래퍼로 떼어낼 수 있을 가능성이 높다 [추측].
3. 계획에서 "설계"로 표시된 124개(1차 74, 2차 45, 보류 5) 중 38개는 이미 패키지·코드로 존재하고 9개는 소형 포크로 가져올 수 있다(6절). 대표적으로 메시지·이벤트 타입(ai), 도구 결과 3채널·실행 파이프라인·완료 게이트(agent), 이벤트 모드(cordis), 샌드박스 설정(srt), 키체인(@napi-rs/keyring), ripgrep(@vscode/ripgrep)이다.
4. 가장 큰 발견은 `pi-durable`이다. 계획이 자체로 두는 L1-a·b·f·g와 X-b 5단계, L0-a(ExecutionEnv), L2-a(도구)를 한 패키지가 이미 구현했다. 그러나 Chord 전면 의존, 실험 API, 이벤트 저널 없음, `synchronous=NORMAL`, 단일 프로세스 소유 때문에 "그대로"는 불가하고 계획의 Cordis·이벤트 소싱 결정과 충돌한다. 3절에서 선택지를 정리했고 사용자 결정이 필요하다.
5. opencode의 이벤트 소싱·투영은 Effect와 drizzle에 묶여 import할 수 없다. 이벤트 표 모양과 리듀서 논리만 읽기 자료다. omp는 Bun 전용이고 핵심(편집·잠금·격리)이 Rust N-API라 npm으로 가져올 수 있는 독립 모듈이 없다.
6. MCP는 공식 SDK v2(`@modelcontextprotocol/client` 2.3.1)가 필요하다. v1.32.1은 2026-07-28 사양(무상태, MRTR, tasks 확장)을 지원하지 않고, pi-mcp는 2025-11-25까지다. 계획의 "SDK 버전 고정"은 v2 고정이어야 한다.
7. "자체" 23+7개 중 가져올 수 있는 것: 확장 지점 모드(cordis 4모드), 범위 트리(cordis Fiber 일부), 프로세스 격리 전송(vscode-jsonrpc), 원자 커밋 패턴(dur 저장소). 나머지 L3 17개와 능력 정의·웹 공통 계약은 선례가 없어 자체가 맞다.

## 1. 패키지 경계

### 1.1 pi 패키지 (npm 1.3.0 기준 크기, 소스는 1.1.0)

| 패키지 | 라이선스·크기 | 직접 의존 | 단독 import | 내부 결합·메모 |
|---|---|---|---|---|
| pi-ai | MIT, 4.2MB·837파일 | @anthropic-ai/sdk 0.129.0, openai 7.19.0, @google/genai 2.21.0, @aws-sdk/client-bedrock-runtime 3.1127.0, smithy, proxy-agent 2종, partial-json, typebox 1.3.27, pi-telemetry | 가능. `index.ts:4-7` "Core only, side-effect free", provider는 `/providers/*`, API는 `/api/*` 서브경로 | 다른 pi 패키지 import 없음(telemetry만). Node≥22.19. CHANGELOG에 1.1.0·1.3.0·Unreleased 모두 Breaking 절이 있다 |
| pi-agent-core | MIT, 269KB, 2.5k줄 | pi-ai, typebox | 가능 | 영속·체크포인트 없음. 훅: prepareRequest·prepareNextTurn·finishTurn·before/afterToolCall(types.ts:173-341) |
| pi-mcp | MIT, 394KB, 3.2k줄 | cross-spawn | 가능(공식 SDK·pi 의존 없음) | 사양 2025-11-25(protocol/types.ts:4). elicitation은 capability 타입 한 줄뿐이고 sampling·tasks·list_changed 핸들러가 없다 [grep 한정] |
| pi-durable | MIT, 3.2MB, 22.8k줄, "Experimental... changes without notice" | chord, pi-ai, photon(wasm), diff, typebox, pi-codemode | `/env`는 깨끗(chord Context만). `/tools`는 `harness/types.ts`의 ToolRegistration에 결합. `/storage/*`는 Session 계약. 루트는 Harness 일체 | types.ts·entries.ts가 harness를 import하므로 Session 단독 추출도 타입 결합이 있다 |
| pi-env | MIT, 18MB(Rust 데몬 포함) | chord, pi-durable | 가능 | dur `ExecutionEnv`의 SSH 구현. Linux·macOS·Windows·Android |
| chord | MIT, 1.9MB, 8.8k줄 | typebox | 가능 | 플러그인·서비스·복제 상태·Context. Cordis와 같은 계층이라 겹친다 |
| pi-telemetry | MIT, 120KB | 없음 | 가능 | 계약+인메모리. 익스포터 없음 |
| pi-codemode | MIT | quickjs-wasi | 가능 | 계획에 없는 후보: QuickJS WASM에서 모델이 쓴 JS가 도구만 호출 |
| pi-protocol / server / client | MIT, server 236KB(npm 1.1.0) | chord, typebox | 가능하나 Chord 서비스 라우팅 전제 | CBOR 프레임 + Unix 소켓. HTTP·SSE 없음, "Peer authentication ... not implemented" |
| pi-coding-agent | MIT, 86k줄 | 23개(tui, chord, durable 포함) | 불가. exports가 `.`·rpc-entry·client·experimental/plugin뿐 | 도구는 내부 경로 `core/tools/*`. pi-tui·extensions/types 결합 |

### 1.2 그 밖의 소스

| 대상 | 라이선스·버전 | 가져오기 | 판단 |
|---|---|---|---|
| omp | MIT(Can Bölük, Stencil Labs), 18.12.x | 패키지가 npm에 있으나 engines가 Bun≥1.3.14. pi-natives(Rust N-API, 1.3MB)에 의존. pi-catalog는 16.9MB | 독립 모듈 없음. 읽기 자료 |
| opencode | MIT, 2.1.1 | `@opencode/core` 의존 40개, `schema`·`protocol`은 Effect 필수 | import 불가. 읽기 자료 |
| cordis | MIT, `cordis` 4.0.0-rc.11 | 코어 1.9k줄, 의존 2(cosmokit, standard-schema), 71KB | 그대로. README "API not yet stable" |
| srt | Apache-2.0, 0.0.81 | 의존 4(zod 3, commander, node-forge, socks5), 11MB | 그대로. "Beta Research Preview" |
| hermes | MIT, Python | 가져올 수 없음 | 설계만 |

## 2. 요청 확인 사항

### 2.1 pi-ai 단독 사용과 OAuth 위장 코드

위장 코드 위치([원문], `packages/ai/src/api/anthropic-messages.ts`):

| 줄 | 내용 |
|---|---|
| 95-132 | 위장 모드 선언. `claudeCodeVersion="2.1.280"`, CC 도구명 17개, `toClaudeCodeName`/`fromClaudeCodeName` |
| 603-607, 636-639 | `isOAuth` 변수. `created.isOAuthToken`에서 받는다 |
| 727-729 | 응답 스트림의 도구명을 원래 이름으로 역치환 |
| 978-980 | 판별: `apiKey.includes("sk-ant-oat")`. provider가 아니라 토큰 문자열로 분기한다 |
| 1013-1033 | OAuth 클라이언트: Bearer 인증, `user-agent: claude-cli/<ver>`, `x-app: cli` |
| 1106 | 베타 헤더 `claude-code-20250219`, `oauth-2025-04-20` |
| 1167-1186 | 시스템 프롬프트 맨 앞에 "You are Claude Code, Anthropic's official CLI for Claude." 삽입 |
| 1347, 1443, 1603 | tool_reference·tool_use·도구 정의의 이름을 CC 표기로 치환 |
| 별도 모듈 | `auth/oauth/anthropic.ts`(307줄, 로그인 흐름·client id·scope)는 `providers/anthropic.ts:81-84`의 `oauth: lazyOAuth(...)` 슬롯에 lazy로 꽂힌다. 이미 분리돼 있다 |

분리 방안:

| 방안 | 내용 | 위험 |
|---|---|---|
| A. 래퍼(포크 없음) [추측] | 별도 Api id(`Api = KnownApi \| (string & {})`, types.ts:73)로 `ProviderStreams`(types.ts:311) 래퍼를 만든다. `options.client`(anthropic-messages.ts:290, 604)로 위장 헤더를 가진 클라이언트를 주입하면 원본이 isOAuth=false로 처리한다. `onPayload`(types.ts:178, 호출 :640)에서 system 블록·betas·도구명을 치환하고, 응답 쪽 역치환은 래퍼 스트림에서 한다 | 사후 payload 수정이라 ai 내부 구조(1.1.0의 `tool_removal` 블록 등)가 바뀌면 깨진다 |
| B. 파일 포크 | 원본에서 위장 8곳을 지우고 위장본을 `anthropic-messages-cc.ts`로 둔다 | 1639줄 파일을 주 1회 breaking 업스트림과 병합해야 한다 |

권고: A로 시작하고 `ai/test/anthropic-oauth.test.ts`·`anthropic-tool-name-normalization.test.ts`를 회귀 테스트로 복사한다. 판정 "포크"는 두 방안을 포함한다.

### 2.2 그 밖의 pi 패키지

| 대상 | 단독 사용 | 근거 |
|---|---|---|
| agent-core | 가능 | pi-ai·typebox만 의존. `runAgentLoop`/`Agent` 제공. 파이프라인이 계획과 같다(agent-loop.ts:684-949) |
| mcp | 가능, 단 사양 한계 | 2025-11-25, 서버 주도 요청·tasks·목록 변경 없음. OAuth 부분집합은 있다 |
| env(ExecutionEnv) | 가능. 위치는 `pi-durable/env` | `ExecutionEnv extends FileSystem, Shell`(env/index.ts:324). 인자는 모두 chord `Context`. 프로세스 그룹 kill(node.ts:278-295), 출력 spill, watch 포함. Docker 없음 |
| 도구 구현 | coding-agent 쪽은 불가, dur 쪽은 부분 | ca 도구(3.6k줄)는 fs 직접 호출에 extensions/types·tools-manager 결합. dur/tools는 ExecutionEnv 기반이나 read·write·edit·bash·image뿐(grep·find·ls 없음)이고 Harness 확장 객체로만 노출 |
| protocol/server/client | 기술적으로 가능, 실용적으로 불가 | Chord 서비스 호출 문법을 전제하고 Unix 소켓·CBOR뿐이다. 계획의 HTTP+SSE+seq 커서와 다르다 |

### 2.3 omp에서 가져올 만한 모듈

| 모듈 | 위치 | 판단 |
|---|---|---|
| 줄 해시 편집 | `crates/pi-edit/src/modes/hashline/*`(약 7.6k줄 Rust), 프롬프트 `packages/coding-agent/src/edit/hashline-compact.md`, 복구 `auto-repair.ts` | Rust N-API(Bun 전용)라 설계만. 알고리즘을 TS로 재작성한다 [추측: 규모 수백 줄] |
| 블롭 저장 | `coding-agent/src/session/blob-store.ts`(437줄) | `Bun.SHA256`·pi-tui·pi-utils 결합. 재사용 시 mtime 갱신(60초)·임시 파일 이름 규칙·GC 유예만 차용하고 새로 쓴다 |
| 카탈로그 | `packages/catalog`(models.json + KDL 호환 규칙) | Bun·16.9MB·pi-utils 결합. pi-ai 카탈로그가 같은 역할을 한다. 설계만 |
| 임대/잠금, 프로세스 레지스트리, 격리 | `utils/file-lock.ts`, `procmgr.ts`, `crates/pi-iso`(4.8k줄) | 전부 pi-natives(Rust) 또는 bun:ffi. 설계만 |
| 비밀 마스킹 | `coding-agent/src/secrets/`(4.4k줄) | pi-utils·pi-ai 내부 경로 결합. 설계만 |

### 2.4 opencode 이벤트 소싱과 Effect 결합

[원문] `oc/session/projector.ts`(843줄)는 `Effect`·`Layer`·`Stream`·drizzle을 쓰고 `Effect.` 호출이 77회다. `message-updater.ts`(485줄)는 immer로 초안을 고치지만 데이터 접근을 `Adapter`(전부 `Effect.Effect<...>` 반환)로 받는다. `bus.ts`(914줄, Effect 105회), `session/inbox.ts`(550줄, 56회)도 같다. `@opencode/schema`가 `effect`에 의존한다. 결론: 가져오기 어렵다. 재사용 가치는 `event/sql.ts`의 표 모양(`event_sequence(aggregate_id, seq, owner_id)`, `event(id, aggregate_id, seq, created, type, data)`, `unique(aggregate_id, seq)`)과 `message-updater.update`의 이벤트별 리듀서 논리다. 계획이 Cordis와 Effect의 이중 DI를 피하라고 한 결정과도 맞는다.

### 2.5 "자체" 중 가져올 수 있는 것

| 계획의 자체 항목 | 가져올 것 | 수준 |
|---|---|---|
| 확장 지점 계약(F4) | cordis `emit`/`parallel`/`serial`/`bail`/`waterfall`(events.ts:14) | 5모드 중 3모드 그대로. queue·exclusive만 자체 |
| 범위 트리(L1-a) | cordis `Fiber`(부모·자식·effect 해제), Node `AbortSignal.any` | 해제 트리는 그대로, AbortSignal 연결만 자체 |
| 프로세스 격리(X-a) | vscode-jsonrpc 9.0.3(MIT, 의존 0) | 전송 라이브러리만 그대로 |
| 원자 커밋·커밋 단위(L1-f) | dur `storage/sqlite/*`(934줄) + 적합성 스위트 1663줄 | 포크 가능하나 Session 결합(3절) |
| 5 구동(X-b) | dur `defineTask`·scheduler | 읽기 자료 또는 3절 B안 |
| 단일 소유와 잠금(L0-e) | proper-lockfile 4.1.2 | 파일 잠금뿐이라 DB 임대 행이 낫다 [추측] |
| 능력 정의, 그룹 간 스키마, 웹 공통 계약, 확장 전용 저장 영역, 버전 정책, L3 전체 | 없음 | 자체가 맞다 |

## 3. L1 커널 선택지: pi-durable을 어떻게 다룰 것인가

dur가 이미 구현한 계획 항목([원문] README, scheduler.ts, tool.ts): 소유 트리와 bottom-up abort(L1-a), phase 체크포인트 루프(L1-b), 도구 파이프라인과 의도→실행→결과(L1-d), 컴팩션 task(L1-e), 원자 커밋·requestId 멱등·결과 불명 합성·fork(L1-f), 자식 task 대화(L1-g), tasks 구동(X-b 5), ExecutionEnv(L0-a), 도구 본문(L2-a).

| 안 | 내용 | 얻는 것 | 잃는 것 |
|---|---|---|---|
| A. 계획 그대로 | agent-core(훅 래핑) + 자체 이벤트 소싱·task 트리 + Cordis | F2 이벤트 저널·seq 커서, 확장 표 동일 트랜잭션, FULL 내구성을 설계대로 | L1 자체 구현량 전부 |
| B. dur 전체 포크 | Harness·Session·Storage·scheduler를 포크해 L1 커널로 | L1 대부분이 구현·36k줄 테스트 상태로 시작 | Chord 전면 채택(Cordis와 이중 DI), 이벤트 저널 비목표("no public semantic event channel", S:2657), `synchronous=NORMAL`(sqlite/node.ts:191), 단일 프로세스 소유, 23k+8.8k줄 유지 부담 |
| C. 혼합 | A 기반 + dur에서 `/env`(그대로), tools·images·truncate(포크), 소유 트리·requestId·결과 불명 규격(설계) | 구현량 중 환경·도구 부분을 절약, 커널 결정은 유지 | chord Context를 env 경계 타입으로 수용 |

잠정 판정 [추측]: C. 이유: L0-a·L2-a는 dur가 계획보다 낫고 경계가 깨끗하지만(`/env`), L1-a·f는 계획의 F2(이벤트 저널, 리플레이 커서)와 모양이 달라 포크해도 구조를 뜯어고쳐야 한다. 결정 필요: B안 스파이크(1~2일)로 "dur Session을 이벤트 저널 위에 얹을 수 있는가"를 확인할지.

## 4. 구성요소별 판정

판정 굵게 표시는 계획의 출처 표시와 다른 항목이다. 후보 경로 접두: `ai/` = packages/ai/src, `agent/` = packages/agent/src.

### 4.1 F

| 구분 | 구성요소 | 계획 | 판정 | 후보·경로 | 이유 |
|---|---|---|---|---|---|
| F1 | 메시지 스키마 | 설계/1 | **그대로** | ai types.ts:639 `Message` | pi-ai 타입을 F의 기준 타입으로 삼는다. minor마다 breaking이 있어 정확 버전 고정 + 별칭 re-export |
| F1 | 파트와 발급 ID | 설계/1 | **자체** | (없음) | ai 콘텐츠 블록에는 id가 없고 toolCall.id만 있다(이벤트는 contentIndex 기준, types.ts:801). Helm 래퍼 레코드로 부여 |
| F1 | 스트림·이벤트 유니온 | 설계/1 | **그대로** | ai `AssistantMessageEvent` types.ts:801-817, agent `AgentEvent` types.ts:516 | 종결 이벤트(done/error)가 이미 있다 |
| F1 | thread / turn / item 3계층 | 설계/1 | 설계 | Codex app-server, dur conversation/entry/task | 가져올 패키지가 없다. agent 이벤트는 agent/turn/message 3단까지만 |
| F1 | 도구 결과 3채널 | 설계/2 | **그대로** | agent `AgentToolResult{content,details,structuredContent}` types.ts:424-445 | 모델용·UI용·구조화 채널이 이미 분리돼 있다 |
| F1 | 결과 상태 태그 | 설계/2 | 설계 | MCP 2026-07-28 `resultType:"input_required"` | 유니온은 우리 정의, 값은 MCP SDK v2가 제공 |
| F2 | 이벤트 스키마 | 설계/1 | 설계 | oc `core/src/event/sql.ts`(event·event_sequence 표), `schema/src/event.ts` | Effect·drizzle 결합이라 import 불가. 표 모양만 차용 |
| F2 | 효과 이벤트와 재생 정책 | 설계/1 | 설계 | agent `AgentTool.replay?:"never"\|"safe"` types.ts:490, dur tool.ts:163-186 | 필드는 agent에 이미 있다. 의도→실행→결과 기록은 우리가 쓴다 |
| F2 | 단계 체크포인트 레코드 | 설계/1 | 설계 | dur generation.ts:53-90 (phase별 고정값) | dur는 task 레코드 교체 방식이라 이벤트 소싱과 모양이 다르다 |
| F2 | 스키마 버전과 마이그레이션 | 설계/1 | 설계 | dur sqlite/migrations.ts, oc 이벤트 version | 패키지 없음 |
| F2 | 세션 저장소 인터페이스 | 설계/2 | 설계 | dur `Storage`(types.ts) + testing/storage-conformance.ts(1663줄) | 인터페이스는 자체. 어댑터 적합성 스위트 방식만 차용 |
| F3 | 도구 스키마 | 설계/1 | **그대로** | typebox 1.3.27 (ai가 `Type` 재수출 index.ts:2) | TypeBox 스키마가 곧 JSON Schema라 단일 원천이 성립한다. pi-ai와 같은 버전 고정 |
| F3 | 능력 정의 | 자체/1 | 자체 | cordis 서비스 + typebox | 서비스 API와 모델 도구를 한 쌍으로 정의하는 선례가 없다. dur `ToolRegistration`은 참고만 |
| F3 | 기계 이름과 표시 제목 | 설계/2 | **그대로** | agent `AgentTool.label` types.ts:468 | name/label이 이미 분리돼 있다 |
| F3 | 도구 목록 결정적 순서 | 설계/1 | 설계 | ai 시스템 메시지 `toolsAdded/toolsRemoved` anthropic-messages.ts:1325-1352 | 정렬은 한 줄이다. 중간 추가·제거를 캐시 보존 방식으로 보내는 부분은 ai가 처리 |
| F4 | 확장 매니페스트 | 설계/1 | 설계 | Claude Code plugin.json, ca `core/pi-manifest.ts` | 스키마는 typebox로 우리가 정의 |
| F4 | 확장 지점 계약 | 자체/1 | 자체 | cordis `events.ts:14` emit/parallel/serial/bail/waterfall | 병렬·waterfall·any-deny(bail)는 cordis가 제공. queue·exclusive·강제 수준·예산은 우리 것 |
| F4 | 그룹 간 이벤트·레코드 스키마 | 자체/1 | 자체 | (없음) | Helm 고유 |
| F4 | 열거형 확장 예약 | 설계/2 | 설계 | agent `CustomAgentMessages` 선언 병합 types.ts:365 | 타입 확장은 선언 병합, 이름 접두사는 규칙 |
| F5 | 클라이언트 와이어 | 설계/1 | 설계 | oc `packages/protocol`(Effect), `@agentclientprotocol/sdk` 2.0.0(선택 façade), pi-protocol | pi-protocol/server/client는 CBOR+Unix 소켓+Chord 라우팅에 묶이고 인증이 없다. HTTP+SSE는 직접 구현 |
| F5 | 설정 계층 | 설계/1 | 설계 | ca `core/settings-manager.ts`, Claude Code 설정 | typebox 검증 + 깊은 병합 100줄 안팎 |
| F5 | 버전 정책과 기능 수명주기 | 자체/1 | 자체 | (없음) | 정책 문서. 도구 후보는 changesets [추측] |
| F5 | 오류 코드 구간 | 설계/2 | 설계 | mcp `JSON_RPC_ERROR_CODES` protocol/jsonrpc.ts | 범위표만 정하면 된다 |
| F5 | _meta 키와 추적 컨텍스트 | 설계/2 | **그대로** | pi-telemetry 1.3.0 `TelemetrySpan`(ai 옵션 `telemetry`), @opentelemetry/api 1.10.0 | 계약은 ai가 이미 쓴다. traceparent 직렬화만 자체 |

### 4.2 L0

| 구분 | 구성요소 | 계획 | 판정 | 후보·경로 | 이유 |
|---|---|---|---|---|---|
| L0-a | ExecutionEnv | 설계/1 | **그대로** | `@earendil-works/pi-durable/env` NodeExecutionEnv(로컬), `@earendil-works/pi-env` 1.3.0(SSH, Rust 데몬) | 로컬·SSH 완비. Docker 백엔드만 자체 어댑터. 모든 호출이 Chord `Context`를 받는다 |
| L0-a | 작업 트리 격리 | 설계/2 | 설계 | git worktree CLI, omp `crates/pi-iso`(Rust 4.8k줄) | worktree 래퍼는 100줄 안팎. pi-iso는 Bun·N-API라 읽기 자료로만 |
| L0-a | 원격 워크스페이스 | 설계/보 | **그대로** | pi-env 1.3.0 | 보류 유지. 필요해지면 이미 있다 |
| L0-b | OS 샌드박스 | 코드/1 | 그대로 | `@anthropic-ai/sandbox-runtime` 0.0.81 (Apache-2.0) | `wrapWithSandbox(cmd)`로 Shell.exec 데코레이터를 만든다. Windows는 alpha |
| L0-b | 보호 경로 | 설계/1 | **그대로** | srt `filesystem.denyRead/denyWrite` | 설정으로 해결. .git·비밀 파일 목록은 우리 정책 |
| L0-b | 네트워크 정책 | 설계/2 | **그대로** | srt `network.allowedDomains/deniedDomains`, `filterRequest` | 정책 언어와의 접착만 자체 |
| L0-b | 권한 프로필과 오프라인 검증 | 설계/2 | 설계 | Gemini CLI `core/src/policy/*`(Apache-2.0), srt 설정 zod 스키마 | Gemini policy는 core 69 deps 안이라 import 불가 |
| L0-c | 비밀 저장 | 설계/1 | **그대로** | @napi-rs/keyring 2.1.2(MIT) + ai `CredentialStore` auth/types.ts | keytar는 2022년부터 방치. Linux는 Secret Service가 필요해 WSL·헤드리스는 파일 폴백(age-encryption 0.3.1) |
| L0-c | 비밀 마스킹 | 설계/1 | 설계 | omp `coding-agent/src/secrets/`(4.4k줄, pi-utils·Bun 결합), hermes redact | 알려진 값 치환이 핵심이라 자체 구현이 작다 |
| L0-d | 프로세스 모델과 전송 | 설계/1 | 설계 | oc 서버 모드 | 패키지 없음 |
| L0-d | 백그라운드 프로세스 레지스트리 | 설계/1 | 설계 | omp `utils/procmgr.ts`·`ptree.ts`(Bun+natives), dur/env `Shell.cleanup` + 프로세스 그룹 kill node.ts:278-295 | 종료 정리는 env가 한다. id·상태 레지스트리만 자체 |
| L0-d | 상주 서비스 감독 | 설계/보 | 설계 | oc 서버 모드 | 보류 유지 |
| L0-e | 단일 SQLite DB | 설계/1 | **그대로** | node:sqlite(Node≥22.19) 또는 better-sqlite3 13.0.3(MIT, 27MB) | dur는 node:sqlite를 쓴다(sqlite/node.ts:4). FTS5 유무가 Node 빌드마다 달라 better-sqlite3가 안전 [추측] |
| L0-e | 단일 소유와 잠금 | 자체/1 | 자체 | proper-lockfile 4.1.2(2021 이후 갱신 없음), omp FileLock(Rust) | DB 안 임대 행 + 하트비트면 충분 [추측]. 파일 잠금 패키지는 DB 소유 문제를 풀지 않는다 |
| L0-e | 블롭 저장소 | 설계/1 | 설계 | omp `coding-agent/src/session/blob-store.ts`(437줄; Bun.SHA256, pi-tui·pi-utils 결합) | 포크 비용이 새로 쓰기보다 크다. GC 쓰기 유예·임시 파일 규칙만 차용 |
| L0-f | 외부 바이너리 설치 | 설계/1 | **그대로** | @vscode/ripgrep 1.18.0(MIT, 플랫폼 패키지) | npm 락파일 무결성 해시로 검증된다. pi tools-manager(해시 검증 없음)는 쓰지 않는다. fd는 JS glob로 대체 |
| L0-f | 파일 감시 | 설계/2 | **그대로** | dur/env `watch`(node-watch.ts 522줄) 또는 chokidar 6.0.0 | ExecutionEnv를 채택하면 추가 의존이 없다 |
| L0-f | 사용자 알림 | 설계/2 | **자체** | node-notifier 11.0.0(5.7MB, 유지 상태 [미확인]) | OS 명령 호출 40줄 안팎이라 의존이 과하다 [추측] |
| L0-f | 텔레메트리 스팬 | 설계/2 | **그대로** | pi-telemetry 1.3.0(의존 0, 120KB) + @opentelemetry/sdk-trace-node 2.12.0 | ai가 이미 `pi.ai.request` 스팬을 낸다(Unreleased). OTel 어댑터만 자체 |

### 4.3 L1

| 구분 | 구성요소 | 계획 | 판정 | 후보·경로 | 이유 |
|---|---|---|---|---|---|
| L1-a | 범위 트리 | 자체/1 | 자체 | cordis `Fiber` fiber.ts:103(부모·자식·effect 해제, AbortSignal 없음) + AbortController | dur task 소유 트리(scheduler.ts 1897줄)는 Harness 결합. Effect fiber는 이중 DI라 제외 |
| L1-a | 취소 전파 | 설계/1 | 설계 | dur S:2226 bottom-up abort, Node `AbortSignal.any` | 패키지 없음 |
| L1-a | 병렬 도구 실행 | 설계/1 | **그대로** | agent `toolExecution`/`executionMode` agent-loop.ts:517, dur/tools `file-mutation-queue.ts`(55줄) | 병렬은 구현돼 있다. 같은 파일 직렬화 큐는 55줄 포크 |
| L1-a | 동시 실행 상한 | 설계/1 | **자체** | (없음) | dur·agent 어디에도 상한 코드가 없다 [grep 한정] |
| L1-a | 내구 입력 큐 | 설계/1 | 설계 | oc `session/inbox.ts`(550줄, Effect), dur `harness/inbox.ts`(132줄), agent `getSteeringMessages` types.ts:293 | 메모리 큐는 agent가 제공. DB 내구화와 4모드는 우리 구현 |
| L1-a | 수락과 완료 분리 | 설계/2 | 설계 | dur `Submission.wait()` | 패키지 없음 |
| L1-a | 병렬 interrupt 재개 | 설계/2 | 설계 | dur `waiting` + failFast/allSettled | 패키지 없음 |
| L1-b | 턴 사이클 골격 | 코드/1 | 그대로 | `@earendil-works/pi-agent-core` 1.3.0(MIT, 의존 pi-ai·typebox, 269KB) | 훅(prepareRequest·prepareNextTurn·finishTurn·before/afterToolCall)으로 단계 경계를 감싼다 [추측]. 훅이 모자랄 때만 포크 |
| L1-b | 종료 조건과 예산 | 설계/1 | **자체** | agent `finishTurn` 훅에 끼움 | 예산 로직은 선례가 없다(dur에도 없음). Usage는 ai |
| L1-b | 단계 전 준비 훅 | 설계/1 | **그대로** | agent `prepareRequest`·`transformContext` types.ts:173-188,244 | X의 형성 체인은 그 위에 얹는다 |
| L1-b | 완료 게이트 | 설계/2 | **그대로** | agent `finishTurn → {action:"continue"\|"end"}` types.ts:147-157 | 횟수 상한만 자체 |
| L1-b | 반복 감지 | 설계/2 | 설계 | omp `session/tool-call-loop-redirect.ts` | AgentSession 결합이라 읽기 자료 |
| L1-b | 입력·출력 가드레일 | 설계/2 | 설계 | OpenAI Agents SDK guardrails, agent `beforeToolCall` | 패키지 없음 |
| L1-c | provider와 와이어 형식 분리 | 코드/1 | 그대로 | ai `createProvider` models.ts:1041, `ProviderStreams` types.ts:311, `Api = KnownApi \| string` types.ts:73 | api 구현이 provider와 이미 분리돼 있다 |
| L1-c | 모델 카탈로그 | 설계/1 | **그대로** | ai `models.generated.ts` + `Model.contextWindow/maxTokens/cost/reasoning` types.ts:849-879 | 생성 스크립트가 models.dev·OpenRouter에서 빌드 때 수집. 갱신은 pi-ai 릴리즈에 종속. omp pi-catalog(16.9MB, Bun)는 읽기 자료 |
| L1-c | 재시도와 백오프 | 코드/1 | 그대로 | ai `utils/retry.ts`(257줄), `provider-retry.ts`(128줄) | 계획과 같다 |
| L1-c | 비용·토큰 계측 | 설계/1 | **그대로** | ai `Usage` types.ts:442-466. 중단된 응답도 error 이벤트의 AssistantMessage에 usage가 실린다 | 합산은 ca `usage-totals.ts` 소 포크 |
| L1-c | 캐시 정책 | 설계/1 | **그대로** | ai `cacheRetention`·`sessionId`·`ModelPromptCache` types.ts:243,249,848 | 브레이크포인트 위치 등을 묶는 정책 객체만 자체 |
| L1-c | Anthropic OAuth 위장 provider | 코드/1 | 포크 | ai anthropic-messages.ts (줄 목록은 2.1절) | 래퍼 방식을 먼저, 불가하면 파일 포크 |
| L1-c | 레이트 리밋과 계정 회전 | 설계/2 | 설계 | omp `usage-limit.ts`·`credential-pin.ts`, ai `CredentialStore`는 provider당 1건 | AgentSession 결합이라 읽기 자료 |
| L1-c | 폴백 체인 | 설계/2 | 설계 | omp `session/retry-fallback-chains.ts` | 패키지 없음 |
| L1-c | 추론 예산 | 설계/2 | **그대로** | ai `reasoning?: ThinkingLevel` types.ts:372 | 체크포인트 고정은 dur `GenerationCheckpoint`를 참고해 자체 |
| L1-c | 구조화 출력 | 설계/2 | **자체** | ai `validateToolArguments` utils/validation.ts:317 | 검증 + 재시도 루프는 20줄. 제공자 네이티브 출력 형식은 ai 미지원 [grep 한정] |
| L1-c | 용도별 라우팅 | 설계/2 | **자체** | ai `Models.getModel` | 서브에이전트 정의의 model 필드로 고르는 얇은 코드 |
| L1-d | 도구 노출 분리 | 설계/1 | **그대로** | ai 시스템 메시지 `toolsAdded/Removed` + Anthropic inline tool changes anthropic-messages.ts:1141-1149,1205, `defer_loading` :208 | 노출 정책(deny 제거, tool search)만 자체 |
| L1-d | 실행 파이프라인 | 설계/1 | **그대로** | agent agent-loop.ts:684-949(prepareArguments→validate→before→execute→after) | "결과 커밋"은 래퍼에서 한다 |
| L1-d | 검증 오류 반환 | 설계/1 | **그대로** | agent agent-loop.ts:724-775 | 오류를 예외 대신 도구 결과로 돌려준다 |
| L1-d | 선언형 정책 엔진 | 설계/1 | 설계 | Gemini CLI `policy-engine.ts`, oc `permission.ts`(Effect) | 둘 다 import 불가. 규칙 평가기는 자체 |
| L1-d | 권한 모드 | 설계/1 | 설계 | Claude Code 문서 | 패키지 없음 |
| L1-d | 승인 프로토콜 | 설계/1 | 설계 | ACP `session/request_permission`, MCP `input_required` | 타입은 ACP SDK 것을 참고 |
| L1-d | 훅 실패 정책 | 설계/1 | 설계 | omp 핸들러 정책, Claude Code `onFailure` | 패키지 없음 |
| L1-d | 결과 경계화 | 설계/1 | **포크** | dur `truncate.ts`(205줄) / ca `tools/truncate.ts`(314줄) | 자르기는 포크, 원문을 블롭으로 빼는 부분만 자체 |
| L1-d | 인자 재작성 | 설계/2 | 설계 | agent `BeforeToolCallResult`(types.ts:66-73)에 args 필드가 없다 | 포크하면 필드 하나 추가 |
| L1-d | 항상 허용 캐시 | 설계/2 | 설계 | ca `trust-manager.ts` 저장 패턴 | 패키지 없음 |
| L1-d | 셸 명령 규칙 | 설계/2 | 설계 | oc 의존 web-tree-sitter·tree-sitter-bash, omp brush-parser(Rust) | 명령 파싱은 tree-sitter-bash 라이브러리를 쓸 수 있다 [npm 미검증] |
| L1-e | 컨텍스트 조립 | 설계/1 | 설계 | dur `harness/context.ts`(293줄)·`prompt.ts`(158줄), ca `core/system-prompt.ts` | 우리 캐시 정책에 맞춰 자체 |
| L1-e | 롤링 요약 컴팩션 | 설계/1 | **포크** | ca `core/compaction/compaction.ts`(1119줄; agent·ai/compat·session-manager 타입 결합) | 컷 포인트·요약 프롬프트 알고리즘을 가져온다. dur compaction.ts(453줄)는 task 결합 |
| L1-e | 임계와 예약 여유 | 설계/1 | **포크** | ca compaction.ts:120-140,267 `shouldCompact`, ai `utils/estimate.ts` | 카탈로그 창 크기에 연결 |
| L1-e | 비파괴 컴팩션 엔트리 | 설계/1 | 설계 | pi `CompactionEntry`, dur head/edits | 저장 모양이 다르다 |
| L1-e | 오버플로우 복구 | 설계/1 | **그대로** | ai `isContextOverflow` utils/overflow.ts:137 | 감지는 ai. 단계당 1회 루프만 자체 |
| L1-e | 도구 결과 선제 제거 | 설계/2 | 설계 | oc prune, omp snapcompact(Bun) | 패키지 없음 |
| L1-e | 컴팩션 후 재주입 | 설계/2 | 설계 | Claude Code | 패키지 없음 |
| L1-e | 추가 워크스페이스 루트 | 설계/2 | 설계 | oc workspace, Claude Code add-dir | 패키지 없음 |
| L1-f | 이벤트 저장과 투영 | 설계/1 | 설계 | oc `session/projector.ts`(843줄, Effect 77회+drizzle), `message-updater.ts`(485줄, immer+Effect) | 자체 구현. emmett-sqlite 0.42.4는 pre-1.0, 확장 표 동일 트랜잭션 요구에 맞는지 불명 [추측] |
| L1-f | 원자 커밋 | 자체/1 | 자체 | dur `storage/sqlite/storage.ts:179-189`(한 SQL 트랜잭션 = 한 커밋) | 패턴이 같다. 코드는 Session 결합이라 재사용이 어렵다 |
| L1-f | 커밋 단위와 내구성 | 자체/1 | 자체 | dur `sqlite/node.ts:191` `synchronous = NORMAL` | 우리는 FULL이다. dur를 포크한다면 한 줄 수정 |
| L1-f | 결과 불명 처리 | 설계/1 | 설계 | dur tool.ts:163-186, S:280 규칙 8 (읽는 쪽이 오류 합성) | 동작 규격만 차용 |
| L1-f | 재개 절차 | 설계/1 | 설계 | dur generation phase 재진입 | 패키지 없음 |
| L1-f | 승인 대기 내구화 | 설계/1 | 설계 | dur task `waiting` | 패키지 없음 |
| L1-f | 멱등 제출 ID | 설계/1 | 설계 | dur `harness/submissions.ts:155` requestId | 패키지 없음 |
| L1-f | 분기 | 설계/1 | 설계 | pi `session-manager.ts`(2013줄, JSONL 결합), dur `session/forks.ts`(97줄) | 패키지 없음 |
| L1-f | 세션 수명주기 API | 설계/1 | 설계 | oc `session.ts`, dur Harness | 패키지 없음 |
| L1-f | 되감기 | 설계/2 | 설계 | oc `snapshot.ts`·`session/revert.ts` | 패키지 없음 |
| L1-f | 리플레이 커서 | 설계/2 | 설계 | oc 이벤트 seq, dur `Cursor`/`Seq` | 패키지 없음 |
| L1-f | JSONL 내보내기 | 자체/2 | 자체 | pi 세션 JSONL 형식(호환 목표) | 20줄 안팎 |
| L1-g | 인프로세스 자식 세션 | 설계/1 | **그대로** | agent `Agent` 클래스 agent.ts:188를 자식마다 생성 | 부모 연결은 자체 |
| L1-g | 권한 상한 | 설계/1 | 설계 | Claude Code, omp task 도구 | 패키지 없음 |
| L1-g | 깊이와 동시 상한 | 설계/1 | 설계 | Claude Code, omp | 패키지 없음 |
| L1-g | 결과 반환 | 설계/1 | 설계 | Claude Code Task | 지시문 모방 검사는 자체 |
| L1-g | 백그라운드 위임 | 설계/1 | 설계 | oc `session/subagent-job.ts`·`subagent-completion.ts` | 패키지 없음 |
| L1-g | 서브에이전트 정의 파일 | 설계/2 | **포크** | ca `utils/frontmatter.ts` + yaml 2.9 | 소형 |
| L1-g | 새 스레드 handoff | 설계/2 | 설계 | omp `session/session-handoff.ts`, dur reset/handoff | 패키지 없음 |

### 4.4 L2

| 구분 | 구성요소 | 계획 | 판정 | 후보·경로 | 이유 |
|---|---|---|---|---|---|
| L2-a | 파일·셸 도구셋 | 코드/1 | 포크 | dur/tools read 312·edit 144+edit-diff 500·write 39·bash 184줄(ExecutionEnv 기반). grep·find·ls는 ca `core/tools` 323·318·175줄 | `createCodingTools()`는 Harness 확장 객체라 단독 사용 불가. 도구 본문을 AgentTool로 옮겨 포크. grep은 ripgrep 연결 |
| L2-a | 편집 방식 | 설계/2 | **포크** | 정확·퍼지는 dur `tools/edit-diff.ts`. 줄 해시는 omp `crates/pi-edit` hashline(Rust, 약 7.3k줄) | 줄 해시는 N-API·Bun 전용이라 알고리즘만 TS로 재작성 |
| L2-a | 이미지와 첨부 | 설계/2 | **포크** | dur `images/`(photon wasm, 워커 스레드) | 블롭 연결은 자체 |
| L2-a | AST·코드 인덱스, LSP | 설계/보 | 설계 | omp `crates/pi-ast`, vscode-jsonrpc 9.0.3 | 보류 유지 |
| L2-b | MCP 브리지 | 코드/1 | 그대로 | `@modelcontextprotocol/client` 2.3.1(Apache-2.0, 6.9MB, 의존 7) | 대안 pi-mcp 1.3.0(MIT, 의존 1, 3.2k줄)은 2025-11-25 사양까지 |
| L2-b | 서버 주도 요청 | 설계/1 | **그대로** | 공식 v2 MRTR (`input_required` 재시도) | SDK API 모양은 미확인 |
| L2-b | 무상태 프로토콜 대응 | 코드/1 | 그대로 | 공식 v2만. v1.32.1은 2026-07-28 지원 계획이 없다 | pi-mcp는 `LATEST_PROTOCOL_VERSION="2025-11-25"` protocol/types.ts:4 |
| L2-b | MCP Tasks | 설계/2 | **그대로** | 공식 v2 `io.modelcontextprotocol/tasks` 확장 | SDK API 미확인 |
| L2-b | 변경 구독 | 설계/2 | **그대로** | 공식 v2 `subscriptions/listen` | SDK API 미확인 |
| L2-b | MCP OAuth | 코드/2 | 그대로 | 공식 v2 OAuth helpers | 대안 pi-mcp/oauth(약 1.8k줄, RFC 9207 검사) |
| L2-c | web.search | 설계/1 | 설계 | provider REST 어댑터(omp `web/search`, `web/parallel.ts`) | exa-js 2.26.0은 zod3·openai5 의존이라 직접 fetch가 가볍다 |
| L2-c | web.fetch | 설계/1 | **그대로** | guarded-fetch 0.1.6 + @mozilla/readability 0.6.0 + linkedom 0.18.13(또는 defuddle 0.19.5) + turndown 7.2.4 | 전부 라이브러리 조합이고 접착 코드만 자체. guarded-fetch는 신생이라 대안 request-filtering-agent |
| L2-c | 공통 웹 계약 | 자체/1 | 자체 | (없음) | 네 서비스 공통 형식이라 선례가 없다 |
| L2-c | web.browse | 설계/2 | **그대로** | playwright-core 1.64.1(Apache-2.0) | 브라우저는 별도 다운로드. agent-browser 0.39.1은 Rust CLI(119MB)라 선택 provider |
| L2-c | web.research | 설계/2 | 설계 | Exa Agent·Parallel Task 등 외부 API | 우리 루프로 구성 |
| L2-d | 스킬 | 설계/1 | **포크** | ca `core/skills.ts`(514줄; config·frontmatter·paths·ignore 결합) | Agent Skills 탐색·파싱 소형. 결합 3곳만 풀면 된다 |
| L2-d | 메모리 파일 | 설계/1 | 설계 | hermes memory, omp mnemopi(Bun) | 패키지 없음 |
| L2-d | 세션 검색 | 설계/1 | 설계 | hermes `hermes_state_fts.py` | node:sqlite는 빌드에 따라 FTS5가 없다는 보고가 있어 시작 시 프로브 필수 |
| L2-d | 스킬 자기 작성과 변경 원장 | 설계/2 | 설계 | hermes, omp manage_skill | 패키지 없음 |
| L2-d | 백그라운드 학습 에이전트 | 설계/2 | 설계 | hermes, omp autolearn | 패키지 없음 |
| L2-d | 공유 메모리 저장소 | 설계/보 | 설계 | 없음 | 보류 유지 |
| L2-e | 작업 목록과 계획 객체 | 설계/1 | 설계 | Claude Code TodoWrite, omp `session/todo-tracker.ts` | typebox 스키마로 자체 |
| L2-e | 슬래시 명령과 프롬프트 템플릿 | 설계/1 | **포크** | ca `core/prompt-templates.ts`(320줄), `slash-commands.ts`(44줄) | 결합은 config·frontmatter·paths 정도 |
| L2-e | 세션 제목과 메타 | 설계/2 | 설계 | oc `session/title.ts` | 이벤트 한 건이라 자체 |
| L2-e | 크론과 스케줄 | 설계/보 | 설계 | hermes `cron/` | 보류 유지 |

### 4.5 X

| 구분 | 구성요소 | 계획 | 판정 | 후보·경로 | 이유 |
|---|---|---|---|---|---|
| X-a | 확장 로딩 | 설계/1 | **그대로** | cordis 4.0.0-rc.11(MIT, 71KB, 의존 2) + @cordisjs/plugin-loader rc.8 | README가 "API 불안정"이라 명시. 고정 버전 필수 |
| X-a | 능력 선언 정적 검증 | 설계/1 | 설계 | Claude Code `validate`, cordis `inject` 선언 | 매니페스트 검사는 typebox로 자체 |
| X-a | 프로젝트 신뢰 | 설계/1 | **포크** | ca `core/trust-manager.ts`(246줄) + `project-trust.ts`(97줄) | config.ts·proper-lockfile 결합을 풀면 된다 |
| X-a | 프로세스 격리 | 자체/1 | 자체 | vscode-jsonrpc 9.0.3(MIT, 의존 0)를 stdio 전송으로 | 프로토콜·outbox는 자체. pi-protocol은 Chord 결합이라 제외 |
| X-b | 1 관찰 | 설계/1 | **그대로** | cordis `emit`/`parallel` events.ts:95-110 | 핸들러 실패 기록은 자체 |
| X-b | 2 차단 | 설계/1 | **그대로** | cordis `bail` + agent `beforeToolCall` | 보안 지점 fail-closed는 자체 |
| X-b | 3 형성 | 설계/1 | **그대로** | cordis `waterfall` + agent `transformContext`/`prepareRequest` | 체인 순서·tier는 자체 |
| X-b | 4 주입 | 설계/1 | **그대로** | agent `getSteeringMessages`/`getFollowUpMessages`, `QueueMode` types.ts:55 | 4모드 확장은 자체 |
| X-b | 5 구동 | 자체/1 | 자체 | (dur tasks는 Harness 결합) | 구동 규격은 dur tasks를 읽기 자료로 |
| X-c | 런타임 토글 | 설계/1 | **그대로** | cordis `Fiber` dispose/restart fiber.ts:481-489, effect 자동 해제 | 턴 경계 적용만 자체 |
| X-c | 실행 순서와 tier | 설계/1 | 설계 | Claude Code mods tier(문서 기반) | 코드 비공개 |
| X-c | 실패 격리와 핸들러 예산 | 설계/1 | 설계 | omp 핸들러 30초 타임아웃 | 패키지 없음 |
| X-c | 확장 전용 저장 영역 | 자체/1 | 자체 | (없음) | 표 접두사 + 같은 트랜잭션. 선례는 설계 수준 |
| X-c | 이름 충돌 규칙 | 설계/2 | 설계 | Claude Code `플러그인:이름` | 패키지 없음 |
| X-c | 안전 모드 | 설계/2 | 설계 | Claude Code 안전 모드 | 패키지 없음 |
| X-c | 외부 훅 프로토콜 | 설계/2 | 설계 | Claude Code hooks JSON stdin/stdout | 패키지 없음 |
### 4.6 L3 의도 그룹 (17개 모두 자체, 판정 변경 없음)

| 구분 | 구성요소 | 판정 | 후보·경로와 이유 |
|---|---|---|---|
| L3-a | 그룹 정의 API, 구동 슬롯 중재, 그룹 상태 레코드, 그룹 간 통신, 그룹 전환 명령, 구동 프로그램 결정성 검사, 그룹 전용 도구와 승격, 그룹 계측 | 자체 | cordis 서비스·Fiber 위에 얹는다. `@cordisjs/plugin-group`은 3줄짜리 설정 그룹 재수출(`group/src/index.ts`)이라 의미가 다르다(이름 충돌 주의). 결정성 규칙(Date.now·Math.random 금지)은 Claude Code 워크플로 문서와 dur tasks를 읽기 자료로, 검사는 lint 규칙으로 자체 |
| L3-b | 탐구 신호 감지, 관점·방법 주입, 탐구 구동 프로그램, 지식 소비, 발견 기록, 작업 관리 연결 | 자체 | Helm 고유 내용이라 선례가 없다. 의존은 L2 능력 정의와 X 5단계뿐 |
| L3-c | 제2의 의도 그룹, 정책 플러그인, 그룹 템플릿 | 자체 | 템플릿은 `create-cordis` 0.3.1(MIT)의 스캐폴딩 방식을 참고할 수 있다 [추측] |

## 5. npm 생태계 후보 (2026-10-21 레지스트리 확인)

| 용도 | 패키지 | 라이선스 | 크기·의존 | 메모 |
|---|---|---|---|---|
| 스키마 | typebox 1.4.2 | MIT | 1.6MB, 의존 0 | 1.0 문서가 Draft 3~2020-12 준수를 주장. pi는 1.3.27 고정 |
| 스키마(대안) | zod 4.6.7 / arktype 2.2.9 | MIT | 6.1MB / 0.35MB | ai `Tool` 타입이 TypeBox라 불채택 |
| MCP | @modelcontextprotocol/client 2.3.1 | Apache-2.0 | 6.9MB, 의존 7(zod4, jose, eventsource 등) | 2026-07-28 사양. 구버전 `sdk` 1.32.1(MIT, 4.5MB, 의존 17)은 2025-11-25까지 |
| ACP | @agentclientprotocol/sdk 2.0.0 | Apache-2.0 | 7.9MB, peer zod | 선택적 에디터 연동 façade |
| SQLite | better-sqlite3 13.0.3 / node:sqlite | MIT / 내장 | 27MB, Node≥22 / 의존 0 | node:sqlite는 v22 Stability 1.1, 24+에서 1.2(RC). FTS5 유무가 빌드마다 다르다는 이슈 보고 다수 |
| 이벤트 소싱 | @event-driven-io/emmett-sqlite 0.42.4 | [미확인] | — | pre-1.0, SQLite는 "development & testing" 용도로 표기. 불채택 [추측] |
| 키체인 | @napi-rs/keyring 2.1.2 | MIT | 49KB, optional 12 | keytar 7.9.0은 2022년 이후 방치. Linux는 Secret Service 필요 |
| 암호화 폴백 | age-encryption 0.3.1 | BSD-3 | 93KB, 의존 5(@noble 등) | 키체인이 없는 환경의 파일 폴백 [추측] |
| 바이너리 | @vscode/ripgrep 1.18.0 | MIT | 4KB + 플랫폼 패키지 | postinstall 다운로드 없음 |
| 파일 감시 | chokidar 6.0.0 / @parcel/watcher 2.6.0 | MIT | 0.2MB, Node≥22.22 / 0.13MB, optional 12 | ExecutionEnv.watch가 있으면 불필요 |
| 텔레메트리 | @opentelemetry/api 1.10.0, sdk-trace-node 2.12.0 | Apache-2.0 | 0.6MB / 32KB | pi-telemetry 어댑터용 |
| 잠금·RPC | proper-lockfile 4.1.2 / vscode-jsonrpc 9.0.3 | MIT | 30KB(2021 이후 갱신 없음) / 225KB, 의존 0 | |
| SSRF | guarded-fetch 0.1.6 | Apache-2.0 | 194KB, undici 7.30·ipaddr.js | 연결 시점 재검증. 신생 0.1.x라 request-filtering-agent가 대안. 검증과 연결을 분리한 라이브러리는 우회 CVE가 있었다 |
| 본문 추출 | @mozilla/readability 0.6.0, linkedom 0.18.13, defuddle 0.19.5, turndown 7.2.4 | Apache-2.0, ISC, MIT, MIT | 155KB(DOM 필요) / 0.9MB / 2.8MB / 192KB | defuddle은 DOM 파서 번들. 둘 중 하나 선택 |
| 브라우저 | playwright-core 1.64.1 / agent-browser 0.39.1 | Apache-2.0 | 13.7MB / 119MB(Rust CLI) | agent-browser는 선택 provider |
| 알림 | node-notifier 11.0.0 | MIT | 5.7MB | 불채택 [추측] |
| 검색 SDK | exa-js 2.26.0 | MIT | 1.7MB, zod3·openai5 의존 | 직접 fetch 권장 |
| 제외 | effect 4.0.5 / @google/gemini-cli-core 0.65.0 | MIT / Apache-2.0 | 49MB / 43.5MB·의존 69 | 이중 DI / 정책 엔진 단독 사용 불가 |

## 6. 판정이 바뀌는 항목 (계획의 출처 표시와 다른 것)

범주별 개수와 목록이다. 4절 표에서 굵게 표시된 행과 같다.

| 변경 | 개수 | 항목(구분) |
|---|---|---|
| 설계 → 그대로 | 38 | 메시지 스키마(F1), 스트림·이벤트 유니온(F1), 도구 결과 3채널(F1), 도구 스키마(F3), 기계 이름과 표시 제목(F3), _meta 키와 추적 컨텍스트(F5), ExecutionEnv(L0-a), 원격 워크스페이스(L0-a), 보호 경로(L0-b), 네트워크 정책(L0-b), 비밀 저장(L0-c), 단일 SQLite DB(L0-e), 외부 바이너리 설치(L0-f), 파일 감시(L0-f), 텔레메트리 스팬(L0-f), 병렬 도구 실행(L1-a), 단계 전 준비 훅(L1-b), 완료 게이트(L1-b), 모델 카탈로그(L1-c), 비용·토큰 계측(L1-c), 캐시 정책(L1-c), 추론 예산(L1-c), 도구 노출 분리(L1-d), 실행 파이프라인(L1-d), 검증 오류 반환(L1-d), 오버플로우 복구(L1-e), 인프로세스 자식 세션(L1-g), 서버 주도 요청(L2-b), MCP Tasks(L2-b), 변경 구독(L2-b), web.fetch(L2-c), web.browse(L2-c), 확장 로딩(X-a), 1 관찰(X-b), 2 차단(X-b), 3 형성(X-b), 4 주입(X-b), 런타임 토글(X-c) |
| 설계 → 포크 | 9 | 결과 경계화(L1-d), 롤링 요약 컴팩션(L1-e), 임계와 예약 여유(L1-e), 서브에이전트 정의 파일(L1-g), 편집 방식(L2-a), 이미지와 첨부(L2-a), 스킬(L2-d), 슬래시 명령과 프롬프트 템플릿(L2-e), 프로젝트 신뢰(X-a) |
| 설계 → 자체 | 6 | 파트와 발급 ID(F1), 사용자 알림(L0-f), 동시 실행 상한(L1-a), 종료 조건과 예산(L1-b), 구조화 출력(L1-c), 용도별 라우팅(L1-c) |
계획 문구 자체를 고쳐야 하는 항목:

| 항목 | 현재 문구 | 고칠 내용 |
|---|---|---|
| L2-b 무상태 프로토콜 대응 | "SDK 버전 고정" | v1.32.1은 불가. v2 패키지(@modelcontextprotocol/client) 고정. pi-mcp로는 불가 |
| L0-b OS 샌드박스 | "Seatbelt·bubblewrap" | srt는 Windows(alpha)도 지원한다. Linux는 bubblewrap·socat·ripgrep이 별도 설치 필요 |
| L1-b 턴 사이클 골격 | "pi agent-core 고정 커밋, 자체 유지" | 소스 포크 전에 npm 고정 버전 + 훅 래핑을 먼저 시도한다 [추측]. 포크는 훅 부족이 확인될 때 |
| L1-c Anthropic OAuth 위장 | "별도 provider로 분리" | 분리 단위는 provider가 아니라 `anthropic-messages.ts` 8곳이다. 래퍼 방식 우선(2.1절) |
| L0-e 단일 SQLite DB | "node:sqlite / better-sqlite3 / Bun SQLite" | FTS5 때문에 node:sqlite 단독은 위험. 시작 시 프로브 또는 better-sqlite3 |
| L0-a ExecutionEnv | "백엔드는 로컬, Docker, SSH" | 로컬·SSH는 dur/env·pi-env로 있다. Docker만 자체 어댑터 |
| F1 파트와 발급 ID | "메시지를 파트로 나누고 id" | ai 콘텐츠 블록에 id가 없다. 래퍼 레코드가 필요하고 이는 자체 |
| F3 도구 스키마 | "JSON Schema 2020-12 ... drift 검사" | TypeBox가 스키마와 TS 타입의 단일 원천이라 생성·drift 검사 단계가 필요 없다 |

## 7. 한계와 미확인

- pi 소스는 1.1.0, npm은 1.3.0이다. 위장 코드는 1.3.0 dist에서 확인했지만 다른 줄 번호는 1.1.0 기준이다. pi-ai CHANGELOG는 1.3.0에서 durable용 `AssistantMessageFrame`을 "removed experimental agent harness"라 하며 제거했다. dur 1.3.0이 같은 구조인지 [미확인].
- MCP 공식 v2 SDK의 API 모양(MRTR, tasks, subscriptions/listen)은 사양 글과 README 요약으로만 확인했다. 코드는 보지 않았다.
- dur scheduler.ts·session/·compaction 본문은 이번에도 대부분 읽지 않았다(기존 보고서 pi-durable.md 의존). 동시 실행 상한 부재는 grep 결과다.
- Gemini CLI policy 엔진은 디렉터리 목록만 봤고 결합도는 추정이다. omp·opencode 줄 수와 import는 직접 셌지만, 내부 로직은 읽지 않았다.
- 라이선스는 package.json·레지스트리 값이다. omp는 일부 의존이 LGPL·MPL이라는 기존 조사가 있다. 공개 릴리즈 전 의존 라이선스 전수 점검이 필요하다.
- 위장 provider의 약관·계정 제재 위험은 기존 결정(유지, 기본 꺼짐)을 따랐고 이번 조사 범위가 아니다.
