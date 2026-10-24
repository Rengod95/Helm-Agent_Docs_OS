# opencode 조사 보고서 (F~L2 층)

표기: [원문] 소스·문서에서 직접 확인, [추측] 추론. 경로는 별도 표기가 없으면 저장소 루트 기준이다.
저장소 루트: /tmp/claude-1000/-home-user-projects-helm/18be0c42-9f6e-4c80-8aa6-91ac9c0b15e2/scratchpad/ext/opencode/repo

## 0. 대상 정보

- 저장소 URL: 요청한 github.com/sst/opencode 는 이전되었다. `curl -I` 가 301 로 https://github.com/anomalyco/opencode 를 가리킨다. [원문] 각 패키지 package.json 의 repository 필드도 `git+https://github.com/anomalyco/opencode.git` 이다. 로컬 clone 의 origin 은 sst/opencode 로 남아 있고 리다이렉트로 받아졌다. opencode.ai/docs 는 HTTP 200.
- 커밋: a62028dd2aa6c6fc1788dddb57bf6745fc2eb905 (2026-10-20, `feat(console): add hCaptcha to enterprise form (#57439)`). 얕은 clone(depth 50)이라 이력은 50커밋뿐이다.
- 버전: 루트와 모든 `@opencode/*` 패키지 2.1.1. CHANGELOG.md 첫 항목은 v2.1.0 (2026-10-20). 문서는 이 저장소를 "OpenCode V2"로 부른다. [원문]
- 라이선스: 루트 LICENSE 는 MIT (Copyright 2025 opencode). 라이선스 필드가 있는 모든 패키지가 MIT 이다. [원문] 라이선스 필드가 없는 패키지는 private 인 httpapi-codegen, latex, merman, posts, storybook 뿐이다.
- 언어/런타임: TypeScript, Bun 1.4.2 워크스페이스(turbo). 핵심은 Effect(`effect` catalog 버전) 기반이며 Schema·Layer·Fiber·Scope 를 전면 사용한다. DB 는 SQLite + drizzle-orm. [원문] AGENTS.md 는 "Bun API 우선"을 명시하고, 번들은 Bun/Node/workerd 3종 바인딩을 갖는다(`packages/core/package.json` imports 의 bun 조건, `database/sqlite.{bun,node,workerd}.ts`).
- 패키지 구성(packages/): schema(공개 도메인 형태·내구 이벤트), protocol(HttpApi 엔드포인트 정의), core(런타임·영속화), server(HttpApi 조립·SSE), client(생성 클라이언트), sdk(client+core+server 조합), cli, tui, ai(자체 provider 계층), plugin(플러그인 API), codemode(제한된 코드 실행), plugin-browser, util, http-recorder, simulation, app/desktop/web/ui/session-ui 등 UI. 의존 방향은 AGENTS.md 에 "Schema → Core·Protocol → Server, Client 는 Core/Server 에 의존 금지, sdk 가 조합"으로 명시되어 있다. [원문]
- 가장 중요한 선행 사실: 이 저장소는 우리가 흔히 아는 "packages/opencode" 단일 패키지 구조(v1)가 아니다. v1 은 이 트리에 없고(`packages/opencode` 부재), `packages/core/src/v1`에는 설정 호환 코드만 있다. v1 플러그인은 v2 에서 실행되지 않는다(services/www/src/docs/content/build/plugins/migrate-v1.mdx). 따라서 학습 데이터 속 opencode 지식(AI SDK, Hono 서버, 플러그인 훅 객체 반환)은 대부분 낡았다.
- 조사 범위: specs/v2/*.md 전부, packages/core 의 session·permission·plugin·tool·mcp·bus·agent 핵심 파일, packages/schema 의 event·session-event·session-message·permission, packages/plugin 의 effect API 와 README, packages/protocol/server 의 엔드포인트와 이벤트 피드, packages/ai 의 구조, services/www/src/docs/content(v2 문서). 
- 못 본 것: 코드 실행·빌드·테스트(금지), TUI/desktop/app 내부, console(services/console), 각 provider 프로토콜 구현의 세부, codemode 인터프리터 내부, workspace/worktree 드라이버, pty·persistent-pty, ACP, 이력(depth 50이라 설계 변천 확인 불가), packages/web 의 구문서(v1 기반이라 일부 낡음), 테스트 268개 파일의 내용.

## 1. 한눈 요약

1. v2 는 "이벤트 소싱 세션 로그 + SQLite 투영 + 단일 로컬 서비스 프로세스 + 얇은 클라이언트" 구조다. 내구 이벤트가 `event` 테이블에 쌓이고 같은 트랜잭션에서 `session_message` 등 투영 테이블이 갱신된다. [원문]
2. 서버-클라이언트 분리가 일급이다. 백그라운드 `opencode serve --service` 하나가 등록 파일(XDG state)로 발견되고, TUI/desktop/web/SDK 가 HttpApi(Effect) 로 붙는다. 이벤트는 SSE 단일 피드(`/api/event`, 연결별 4,096 큐)와 세션별 내구 로그(`/api/experimental/session/:id/log`, seq 커서 재생)로 나뉜다. [원문]
3. 루프는 "턴 사이클 = Step 단위로 이력을 DB 에서 다시 읽고 요청을 조립한다"는 원칙이다. 인메모리 도구 루프가 없고, 도구 호출은 부작용 전에 내구 기록되며, 재시작 시 write-ahead claim 으로 복구한다. [원문]
4. 입력 큐가 설계의 핵심이다. `prompt` 는 먼저 inbox 행(내구)으로 들어가고, `steer`(다음 안전 경계에 삽입)·`queue`(유휴 때 한 건) 두 전달 모드와 컴팩션·이동 제어 항목이 같은 큐를 쓴다. 우리 틀의 "steering/follow-up 마이크로태스크"에 가장 가까운 기성 구현이다. [원문]
5. provider 계층은 Vercel AI SDK 가 아니라 자체 `@opencode/ai`(Protocol + Endpoint + Auth + Framing 로 구성하는 Route)이다. AI SDK(LanguageModelV3)는 `core/src/aisdk.ts` 어댑터와 플러그인 훅(`aisdk.sdk`/`language`)으로 호환 경로만 남아 있다. [원문]
6. 권한은 `{action, resource, effect}` 규칙의 "마지막 일치 우선" 평가 + 저장된 승인 + 플러그인 `permission.evaluate` 훅 + 정책 문(statement)이다. 도구가 스스로 `permission.assert` 를 호출하는 구조라 레지스트리가 강제하지 않는다. [원문]
7. 플러그인은 인프로세스 `Plugin.define({id, setup(ctx)})`. 훅은 "하나의 가변 이벤트를 등록 순서로 순차 변형"하는 방식(강제 수준 1~4, 일부 5)이며, 변형(transform)·재로드(reload) 도메인이 따로 있다. 훅 격리는 약하다: `execute.before` 만 실패 채널이 있다. [원문]
8. LSP 는 v2 코어에 런타임이 없다. 설정 스키마와 이벤트 정의만 있고 편집 도구에 "TODO: LSP runtime exists 이후" 주석이 있다. v2 권한 문서도 `lsp` 는 현재 코어 권한 액션이 아니라고 적는다. MCP 는 공식 SDK(`@modelcontextprotocol/client` 2.0.0) 기반으로 완전 통합되어 있다. [원문]
9. 채택 관점에서 재사용 후보는 `@opencode/ai`(의존성이 effect·aws 뿐), `@opencode/schema`, `@opencode/codemode`이고 전부 MIT 다. 다만 Effect 전제와 동시 개편 중(2.1 에서 공개 계약 파괴적 변경)이라 통째 채택은 위험하다. 설계 참고 가치는 매우 높다.

## 2. 층별 표

성숙도: 안정 / 실험. "실험"은 소스·문서가 experimental 로 표시한 것 또는 경로가 `/api/experimental/`·`experimental.*` 인 경우다.

| 층·항목 | 구현 방식 | 근거 | 성숙도 |
|---|---|---|---|
| F 이벤트 스키마 | `Event.durable`/`Event.ephemeral` 정의. 내구 이벤트는 `{aggregate, version}` 보유, 봉투 `{aggregateID, seq, version}` | packages/schema/src/event.ts | 안정(2.1 에서 필드명 파괴적 변경 있음) |
| F 세션 로그 형식 | SQLite `event`(id, aggregate_id, seq, created, type, data JSON) + `event_sequence` | packages/core/src/event/sql.ts | 안정 |
| F 메시지 모델 | Message 유니온: user/synthetic/system/skill/shell/assistant/compaction/agent-switched/model-switched/location-switched/idle. assistant.content = text/reasoning/tool | packages/schema/src/session-message.ts | 안정 |
| F 도구 스키마 | `Tool.make({input, output, execute})`; 응답 3값(output·content·metadata); Effect Schema 또는 Standard Schema + JSON Schema | specs/v2/tools.md, packages/schema/src/tool.ts | 안정 |
| F 설정 형식 | opencode.jsonc (`$schema` opencode.ai/config.json), v1 설정 정규화 | services/www/src/docs/content/config.mdx, core/src/config/normalize.ts | 안정 |
| F 확장 매니페스트 | 별도 매니페스트 없음. package.json exports 의 default export `Plugin.define({id, setup})` | build/plugins/index.mdx | 안정 |
| F 버전 정책 | 이벤트 타입별 `durable.version`, 로드 시 구버전 업그레이드 디코더, semver(2.1 minor 에 파괴적 변경) | bus.ts:74 부근, CHANGELOG.md | 안정/불안정 혼재 |
| L0 프로세스 모델 | 단일 백그라운드 서비스 + 다수 클라이언트, 등록 파일로 발견·버전 불일치 시 재기동 | packages/client/src/service.ts, AGENTS.md | 안정 |
| L0 OS 추상 | `Environment`(files + spawner) 드라이버, 로컬/워크스페이스 원격 바인딩 | core/src/environment/*.ts | 안정 |
| L0 샌드박스 | OS 수준 샌드박스 없음(권한 규칙 + 셸 명령 파서로 대체) | core/src/shell/scan.ts, 샌드박스 검색 결과 없음 | 해당 없음 |
| L0 파일 감시 | location-watcher, 정책 분리 | core/src/filesystem/watcher.ts | 안정 |
| L0 인증 | 서버 비밀번호(basic) + HMAC 서명 세션 토큰(30일) + pairing | server/src/auth.ts | 안정 |
| L1a 동시성/취소 | Effect Fiber. Session 단위 직렬, Session 간 병렬. `interrupt` = 파이버 인터럽트 | session/run-coordinator.ts, execution.ts | 안정 |
| L1a 큐 | inbox(`session_inbox`/`session_pending`) steer/queue 전달 | specs/v2/session.md, session/sql.ts | 안정 |
| L1a 병렬 도구 | 도구 호출 이벤트마다 즉시 fork, 종료 이벤트 발행만 직렬 | session/runner/step.ts:123 | 안정 |
| L1b 루프 | `drain` → `advanceToStep` → `runStep`(재시도/컴팩션 루프) → `steps.attempt` | session/runner/llm.ts:73,203, step.ts | 안정 |
| L1b 종료 조건 | 도구 결과 후 `needsContinuation`, 에이전트 `steps` 한도(도구 비활성 + 마지막 안내), finish=length 연속 한도 | runner/llm.ts, runner/max-steps.ts | 안정 |
| L1c provider | 자체 `@opencode/ai`: Protocol/Route/Endpoint/Auth/Framing, LLMEvent 스트림 | packages/ai/src/route/protocol.ts | 안정(2.x) |
| L1c 캐시 | `cache: "auto"` 기본, 최대 4 브레이크포인트(마지막 도구·첫/끝 system·대화 꼬리) | packages/ai/src/cache-policy.ts | 안정 |
| L1c AI SDK | 호환 어댑터(LanguageModelV3), 플러그인이 sdk/language 훅으로 주입 | core/src/aisdk.ts, plugin/src/effect/aisdk.ts | 호환 경로 |
| L1d 도구 디스패치 | 요청 단위 스냅샷(광고된 정의 + 포획된 도구), 입력 디코드 → 실행 → 출력 인코드 → 경계화 → after 훅 | core/src/tool.ts, specs/v2/tools.md | 안정 |
| L1d 권한 | 규칙 last-match + 저장 규칙 + 훅 + Deferred 로 사용자 응답 대기 | core/src/permission.ts:87,173,235 | 안정 |
| L1d 정책 | provider.use/tool.use/integration.use, 콘솔 관리 정책이 최종 권위 | specs/v2/provider-policy.md | `experimental.policies` |
| L1e 컨텍스트 | Step 마다 이력 재적재, 지시문은 내용 해시 델타(`session.instructions.updated`), 에포크 | specs/v2/session.md, session/instruction-*.ts | 안정 |
| L1e 컴팩션 | 구조화 롤링 요약 + 최근 ~15k 토큰 원문 유지, 오버플로우 시 1회 재시도, 네이티브 컴팩션 윈도 | session/compaction.ts, compaction.mdx | 안정 |
| L1f 영속성 | 이벤트 + 투영 단일 트랜잭션, seq 단조, 중복 ID 거부, replay 불일치 검출 | core/src/bus.ts:296~ | 안정 |
| L1f 복구 | write-ahead 실행 claim(`time_suspended`), 시작 시 최상위 세션 재개, 고아 도구 호출 실패 처리 | session/execution.ts:78, store.ts:201, runner/llm.ts:356 | 안정 |
| L1f 분기/되돌리기 | `session.forked`(경계 + 지시문 값), revert stage/clear/commit, 스냅샷(콘텐츠 주소 트리) | schema/session-event.ts:202,651, core/src/snapshot.ts | 안정 |
| L1g 서브에이전트 | `subagent` 도구 → 자식 세션(parentID) 생성, 같은 프로세스·같은 서비스, Job 으로 포그라운드/백그라운드 | core/src/tool/plugin/subagent.ts | 안정 |
| L2 내장 도구 | read/write/edit/patch/glob/grep/shell/webfetch/websearch/question/todo/skill/subagent/mcp-resource/opencode/file-diff | core/src/tool/plugin/*.ts (16개 파일) | 안정(todo 는 실험 플래그) |
| L2 MCP | 공식 MCP SDK, stdio·streamable HTTP, OAuth, 도구·프롬프트·리소스·지침 | core/src/mcp/*.ts | 안정 |
| L2 LSP | 코어 런타임 없음(설정 스키마·이벤트뿐) | core/src/tool/plugin/edit.ts:205 | 미구현 |
| L2 스킬 | SKILL.md 디스커버리, 에이전트별 노출 | core/src/skill/discovery.ts | 안정 |
| L2 코드모드 | `execute` 도구로 제한된 코드 실행, 하위 도구에 각자 권한 적용 | packages/codemode, permissions.mdx | 실험적 성격 [추측] |
| 확장 지점 | transform 도메인 11개 + 런타임 훅(aisdk, session, permission, shell, tool) + 이벤트 구독 + RPC | plugin/src/README.md, effect/*.ts | 일부 experimental(WebSocket 훅) |

## 3. 층별 상세

### 3.1 F 계약

이벤트
- 모든 이벤트는 `Event.durable`(내구, 집합체 ID 필드 지정, 버전) 또는 `Event.ephemeral`(휘발)로 정의한다. [원문] packages/schema/src/event.ts. 내구 봉투는 `aggregateID`, `seq`(집합체 내 단조 증가), `version`.
- 세션 이벤트 약 60종이 packages/schema/src/session-event.ts 에 있다. 라이프사이클: `session.created/forked/deleted/moved/renamed/archived`, 입력: `session.inbox.enqueued/delivered/cancelled/delivery.changed`, 실행: `session.execution.started/succeeded/failed/interrupted`, 스텝: `session.step.started/streamed/ended/failed`, 콘텐츠: `session.text.*`, `session.reasoning.*`, `session.tool.input.*`, `session.tool.called/progress/success/failed`, 기타: `session.retry.scheduled`, `session.compaction.started/delta/ended/failed`, `session.revert.staged/cleared/committed`, `session.instructions.updated`, `session.synthetic`, `session.shell.started/ended`, `session.skill.activated`, `session.usage.*`.
- 내구/휘발 구분: text·reasoning·tool-input·compaction 델타는 휘발이라 재생 로그에 없다(specs/v2/session.md "Durable Events Are Session-Scoped"). 도구 호출은 `tool.called` 로 부작용 전에 내구화된다. 도구 입력 델타는 `session.tool.input.*`로 휘발 스트림에 있다.
- 도구 호출 ID 는 한 Step 안에서만 유일하므로 도구 이벤트는 `assistantMessageID` 도 갖는다. [원문]
- 버전 정책: 이벤트별 `durable.version`, 저장 타입 키는 `type.version`(`versionedType`). 오래된 행은 읽을 때 한곳에서 업그레이드 디코드한다(bus.ts:74 주석). 알 수 없는 타입은 읽기에서 건너뛰되 raw 꼬리 seq 로 커서를 전진시킨다(bus.ts:793 주석). 그러나 2.1.0 은 minor 에서 공개 SDK/HTTP/플러그인 계약을 의도적으로 깼다(`state`→`native`, `providerState`→`native`, `resultState`→`native`). 저장 데이터는 호환 디코더로 읽는다(CHANGELOG.md). [원문]

메시지/파트
- `Session.Message.Info` 유니온. assistant 내용은 text/reasoning/tool 세 종류의 파트, tool 상태는 streaming/running/completed/error 4종 태그 유니온이다(session-message.ts). `native` 는 "provider 소유 재생 데이터를 그대로 되돌려주는 불투명 레코드"다.
- 메시지 ID 는 `msg_` 접두 ascending ID, 이벤트 ID 는 `evt_`; `SessionMessage.ID.fromEvent` 로 이벤트 ID 에서 메시지 ID 를 만든다.

도구 스키마
- `Tool.make({description, input, output?, execute})`. 한 응답이 세 값을 가진다: `output`(스키마 검증된 임시 기계값, Code Mode 용), `content`(모델에 보이는 값, 내구 저장), `metadata`(UI 용 JSON). `output` 이 없으면 content 만. [원문] specs/v2/tools.md.
- 동적 MCP/매니페스트 도구는 런타임 JSON Schema 로 같은 모양이 된다. 입력 스키마가 서비스를 요구할 수 없다(자기완결).
- 등록 이름 정규화: 지원하지 않는 문자는 `_`, `execute` 는 Code Mode 예약.

설정
- `opencode.jsonc` 계열. 키는 `agents`, `permissions`, `plugins`, `compaction`, `default_agent`, `mcp`(servers), `lsp`, `experimental.*` 등. v1 키(`permission`, `plugin`, `bash`, `task`)는 이름이 바뀌었고 자동 정규화가 있다(normalize.ts). 에이전트는 Markdown + frontmatter(`.opencode/agents/*.md`)로도 정의한다(agents.mdx).

### 3.2 L0 플랫폼

프로세스 모델
- 서버-클라이언트 분리: `packages/server` 가 `HttpApi` 를 조립하고 `packages/protocol` 이 엔드포인트 계약(그룹 30여 개: session, message, permission, event, mcp, plugin, pty, shell, fs, worktree, voice 등)을 소유한다. `packages/client` 는 계약에서 코드 생성(AGENTS.md: protocol/server 변경 후 `bun run generate`, 생성 파일 직접 수정 금지)한 Promise/Effect/Solid 클라이언트다. [원문]
- 서비스 발견: client `service.ts` 가 XDG state 의 등록 파일(`{id, version, url, pid, password}`)을 읽고, 없거나 버전이 다르면 `opencode serve --service` 를 띄운다(`EnsureReason: "missing" | "version-mismatch"`). 개발 편의로 `opencode service status/get password` 도 있다(루트 package.json dev:live). [원문]
- 세션 실행은 프로세스 로컬이다. "Local execution remains process-owned until clustering introduces an explicit placement and fencing protocol"(specs/v2/session.md). 즉 다중 노드 소유권/펜싱은 없다. [원문]
- 세션이 위치(Location: 디렉터리/워크스페이스)에 묶이며 `LocationServiceMap` 이 위치별 서비스 그래프(Layer)를 만든다. 세션은 `session.moved` 로 위치를 옮길 수 있고, 실행은 드레인 시작과 이동 후에 배치를 다시 해석한다. [원문]

이벤트 버스와 SSE
- 코어 `Bus`: `subscribe()` 는 휘발 라이브 채널(재연결 시 유실), `log({after, follow})` 는 집합체 내구 로그(구독 후 재생, 동기화 마커 `log.synced`). Bus 주석: "Consumers that need reliability combine it with `log`." [원문] bus.ts:126~160.
- 서버 피드(specs/v2/event-stream-architecture.md): 코어 리스너 1개 → 공개 이벤트 필터 → 스키마·JSON·SSE 한 번만 인코딩 → 연결별 dropping 큐(용량 4,096)에 같은 문자열 참조 offer. 큐가 넘치면 그 연결만 `SubscriberOverflowError` 로 끊고 나머지는 계속한다. 하트비트 15초, 첫 프레임 `server.connected`. 구독자가 없으면 인코딩을 생략한다. 벤치마크: 50 클라이언트에서 인코딩 비용 553 ms → 12 ms. [원문]
- 이 피드는 위치 필터가 없는 전역 스트림이다(TUI 가 여러 위치 상태를 갱신). [원문]

OS 추상
- `Environment` 서비스 = `files` + `spawner`(Effect ChildProcessSpawner). 위치에 workspaceID 가 있으면 `workspace.connect` 로 원격 드라이버를 쓰고, 아니면 `makeLocalDriver`(core/src/environment/environment.ts). MCP stdio 서버도 이 환경으로 spawn 한다(mcp/client.ts:141 주석). [원문]
- 셸: `Shell` 서비스가 명령 ID 로 실행·타임아웃 교체·kill 을 관리하고 종료마다 정확히 한 번 `Exited` 를 발행한다(core/src/shell.ts). 셸 명령은 wasm 파서(`shell/parse.ts`, `scan.ts`)로 분석하여 권한 리소스 문자열을 만든다. 파싱 불가한 구조는 `OpaqueReason`(command-substitution, heredoc, dynamic-execution 등)으로 표시한다. [원문]
- 샌드박스: seatbelt/bwrap/landlock 류 OS 샌드박스는 코드에서 찾지 못했다(검색 결과는 무관한 파일뿐). 격리는 권한 규칙과 `external_directory` 경계, 원격 workspace 드라이버에 의존한다. [원문+추측]
- 비밀/자격: `credential` 모듈, 서버 비밀번호는 `Redacted`로 취급하고 세션 토큰은 비밀번호에서 파생한 키로 HMAC 서명하므로 비밀번호 교체 시 전 세션이 폐기된다(server/src/auth.ts). [원문]
- 파일 감시: `location-watcher`와 정책 분리(`location-watcher-policy.ts`). 설정/플러그인 디렉터리 변경 감지에도 쓴다(plugin/module.ts 의 Watcher 의존). [원문]
- 알림: 코어에는 OS 알림 추상이 없다. 문서의 예시는 플러그인에서 처리한다. [추측: 알림 전용 코드를 못 찾음]

### 3.3 L1a 태스크 엔진

- 동시성 단위는 Session ID 이다. `SessionRunCoordinator`(session/run-coordinator.ts)는 "key 당 하나의 실행 파이버(busy period), 서로 다른 key 는 병렬". `wake` 는 초인종(doorbell) 모델이다: 유휴면 실행 시작, 실행 중이면 `pendingWake` 를 기록해 드레인 후 한 번 더 돌고 끝낸다. 드레인의 마지막 적격 검사와 유휴 전환이 원자적일 수 없다는 점을 이 초인종이 메운다(주석). `run` 은 실행에 합류하고 종료 exit 를 돌려받는다. [원문]
- 취소: `interrupt(key, reason)` 는 소유 파이버를 `Fiber.interrupt` 하되 확인만 즉시 반환하고 정리는 비동기다("fire and forget": 종료기가 느려도 인터럽트 엔드포인트가 즉시 응답). 중단 사유는 `user`/`shutdown`. 사용자 중단은 claim 해제와 하위 Job 취소를 하고, shutdown 중단은 claim 을 보존해 재시작 복구 대상으로 둔다(execution.ts:78~). 공개 API `POST /api/session/:id/interrupt` 는 `resume=true` 일 때 steer 입력과 제어 항목만 재개하고 queue 프롬프트는 보류한다. [원문]
- 취소 전파: Effect 인터럽트가 곧 취소 메커니즘이다. 도구는 인터럽트·결함을 모델 가시 실패로 변환하면 안 된다(specs/v2/tools.md "Failures Preserve Interruptions"). 서브에이전트 도구는 인터럽트 시 자식 세션 interrupt 와 job cancel 을 함께 수행한다(subagent.ts `Effect.onInterrupt`). 사용자의 권한 거부는 결함 터널(`Effect.die(DeclinedError)`)을 통해 스텝 종료로 전파된다(permission.ts:253 주석). [원문]
- 단계 사이 큐: inbox. 항목은 `user/synthetic/compaction/move` 형이고 전달은 `steer`(기본, 다음 안전 스텝 경계에서 도착 순으로 전달, 압축/이동 제어 항목 앞에서 멈춤)와 `queue`(안전 경계에서 steer 우선, 유휴 경계에서 한 건씩). 새 사용자 입력 승격은 에이전트 스텝 허용량을 리셋하고 steer 묶음은 한 번만 리셋한다. [원문] specs/v2/session.md.
- 멱등성: 세션 ID 재사용은 기존 세션 채택, user/synthetic inbox ID 재사용은 세션·타입이 같으면 먼저 온 것이 이긴다(재시도의 payload 무시). [원문]
- 병렬 도구: 스트림에서 `tool-call` 이벤트가 오면 그 자리에서 즉시 forkScoped 로 실행을 시작한다. 별도 동시성 한도(세마포어)는 찾지 못했다. 종료 이벤트 발행만 직렬화한다("Local calls start eagerly and may run concurrently, but terminal outcome publication remains serialized"). [원문] step.ts:123, session.md. 동시 호출 제한이 없다는 점은 [추측].
- 스케줄링: 별도 크론/스케줄러는 코어에서 보지 못했다. 재시도 대기만 `Effect.sleep`. 백그라운드 작업은 `Job` 서비스(core/src/job.ts, 491줄; 서브에이전트가 사용). 상세 미조사.

### 3.4 L1b 에이전트 루프

구조(세 겹)
1. `SessionRunner.drain`(runner/llm.ts:73 부근) — 세션 단위 드레인. 시작 시 `plugins.awaitActivation`, 낡은 컴팩션/도구 호출 정리, 이후 `advanceToStep`↔`runStep` 반복.
2. `advanceToStep` — inbox 에서 다음 항목을 직렬 잠금 안에서 확인하고 컴팩션/이동 제어를 처리한 뒤, 입력을 승격(`SessionInbox.promote`)하고 컨텍스트를 로드한다. 위치가 닫히면 `Reloaded` 를 반환해 상위가 새 위치로 이어간다.
3. `runStep`(runner/llm.ts:203) — 논리적 Step 한 개. 내부 while 루프가 "물리적 시도(attempt)"를 반복한다: 컨텍스트 재적재 → 자동 컴팩션 판단 → 요청 조립 → `steps.attempt` → 결과(Outcome) 분기.
- 시도 결과: `Completed{needsContinuation}`, `Retry`, `Continue`(불완전 스트림 이어쓰기), `RecoverFull`(연속 상태 거부 시 전체 컨텍스트 재구성, 1회), `Compacted`(오버플로우 컴팩션 후 재시도), `OutputLimit`(finish=length). 한 Step 이 여러 물리적 시도를 가질 수 있다. [원문]
- 종료 조건: (a) 도구 호출 없이 finish → `needsContinuation=false`, (b) 에이전트 `steps` 한도 도달 시 도구 정의는 유지하되 `toolChoice: "none"` 과 MAX_STEPS_PROMPT 어시스턴트 메시지를 붙여 캐시 접두를 보존하며 텍스트만 응답 유도, (c) finish=length 가 연속 3번이면 `output-limit` 실패, (d) 사용자 거부면 `Effect.interrupt`, (e) 컨텍스트 오버플로우 두 번째는 종료. [원문]
- 스트림 처리(`step.ts attempt`): 공급자 스트림은 finish 이벤트만이 아니라 끝까지 읽어 다음 요청이 응답을 재사용할 수 있게 한다. 이벤트는 `createLLMEventPublisher` 가 내구/휘발 이벤트로 변환·게시한다(runner/publish-llm-event.ts, 679줄). 시작 스냅샷은 요청 비행 중에 병렬 캡처한다. 마지막 도구·스텝 이벤트는 uninterruptible 로 보호한다. [원문]
- 재시도: 첫 요청 + 최대 4회, 지터가 있는 지수 백오프, 공급자 지연 힌트가 더 크면 그것을 사용. 대상은 rate-limit/공급자 내부 오류, 미전송·미확인 전송 오류, 불완전 스트림. 내구 출력 이전 재시도는 논리 스텝 번호와 어시스턴트 메시지 ID 를 유지하고 스텝 허용량을 소모하지 않는다. 내구 출력 이후 불완전 스트림은 실패한 부분 어시스턴트를 보존하고 합성 "이어서 계속" 메시지를 추가한 뒤 새 메시지 ID 로 계속한다. `session.retry.scheduled` 로 관측 가능하고 `retry` 훅으로 결정을 바꿀 수 있다. content-filter 종료는 Step 실패(부분 콘텐츠는 유지). [원문] specs/v2/session.md, runner/retry.ts.
- 취소 지점: 스트림 취소 시 시작 스냅샷이 없으면 아무것도 기록하지 않고, 있으면 미결 도구를 `aborted: Tool execution interrupted` 로 실패시키고 어시스턴트를 `Step interrupted` 로 닫는다. [원문] step.ts:141~.

### 3.5 L1c 모델 게이트웨이

- `@opencode/ai`(packages/ai, 218개 소스 파일)가 provider 추상이다. 핵심 개념: `Protocol`(API 의미 계약: 요청 본문 스키마·`LLMRequest`→본문 변환·스트림 상태 기계), `Route`(Protocol + `Endpoint` + `Auth` + `Framing` 조합 = 배포), `LLMClient`(공통 `LLMRequest` → `Stream<LLMEvent>`). Protocol 은 "DeepSeek, TogetherAI, Cerebras 가 모두 `OpenAIChat.protocol` 을 재사용"하게 하려는 분리다(route/protocol.ts 주석). [원문]
- 프로토콜 파일: openai-chat/responses, anthropic-messages, gemini, bedrock-converse(+ 이진 이벤트 스트림), mistral, cohere, xai, zai, alibaba, meta 등과 이미지/음성/전사/영상 프로토콜까지 포함. 전송은 route/transport. [원문] 목록만 확인했고 개별 동작은 못 봤다.
- 의존성: ai 패키지 dependencies 는 `@aws-sdk/credential-providers`, `@smithy/eventstream-codec`, `aws4fetch`, `google-auth-library`, `effect`, `@opencode/schema` 뿐이다. Vercel `ai` 패키지에 의존하지 않는다. [원문] packages/ai/package.json.
- AI SDK 는 호환 층이다: core 가 `@ai-sdk/provider`·`@ai-sdk/openai-compatible`·cohere·perplexity·vercel 을 의존하고 `core/src/aisdk.ts` 가 `LanguageModelV3` 를 `LanguageModel` 로 감싼다. 플러그인은 `ctx.aisdk.hook("sdk"|"language", …)` 로 임의 AI SDK 패키지를 주입한다. [원문] 네이티브 대체 목록(Bedrock 등)은 `aisdk-native.ts` 주석에 흔적이 있다.
- 프롬프트 캐시: `cache-policy.ts` — 기본 `"auto"`: 마지막 도구 정의, 첫·끝 고유 system 파트, 대화 꼬리에 브레이크포인트(총 4개 상한), 수동 `CacheHint` 보존. 인라인 힌트를 무시하는 프로토콜(OpenAI 암묵 캐시, Gemini)은 정책 패스를 건너뛴다. 최종 Step 에서도 도구 정의를 유지해 캐시 접두를 살리는 것이 러너와 일치한다. [원문]
- 모델 카탈로그: models.dev 스냅샷(`core/src/models-dev*`, `update-models-snapshot` 스크립트) + 설정 + 플러그인 transform 이 재생 가능한 위치 범위 카탈로그를 만든다(specs/v2/catalog-config-plugin-lifecycle.md "Option B 선택·구현"). 크레덴셜 변화·정책 변경이 카탈로그를 재계산한다. [원문]
- 요청 훅: `model.request`(baseURL·헤더), `http.request/response`(네이티브 Request/Response 가로채기), `experimental.ws.handshake/send/receive`(WebSocket 세션 전송). [원문]

### 3.6 L1d 도구 디스패치와 권한

디스패치(core/src/tool.ts, specs/v2/tools.md)
- 각 모델 요청이 "광고된 LLM 정의와 포획된 도구 값"의 스냅샷을 만든다. 실행은 그 포획된 도구로 한다(요청 이후의 등록 변경은 다음 요청부터). 알 수 없는/훅이 제거한/최종 스텝의 호출은 개별 실패한다(다른 호출을 실패시키지 않는다).
- 파이프라인: 이름 해석 → 입력 디코드(무효면 실행 안 함) → `execute.before` 훅 → 실행 → 출력 인코드 → 정규화 → 모델 콘텐츠 경계화(머리+꼬리 절단, 초과분은 관리 저장소에 보관하고 미리보기로 치환, 보관 실패 시 손실 성공 대신 운영 실패) → `execute.after` 훅(변경 시 재경계화) → `ToolOutcome` → 러너가 내구 게시. 메타데이터는 검증하고 무효/과대면 경고 후 버린다. [원문]
- 등록은 Scope 소유이며 "같은 이름은 최근 활성 등록이 이긴다, 닫으면 이전 것이 다시 보인다" 오버레이 규칙이다. 내장 도구도 같은 `Tool.make` 계약이고 신뢰 서비스를 포획한다(같은 타입이라고 권한이 같지 않다). [원문]
- 도구 실행 맥락 `Tool.Context`: sessionID, agent, messageID(어시스턴트 메시지), callID, progress.

권한(core/src/permission.ts, schema/src/permission.ts)
- 규칙: `{action, resource, effect: allow|deny|ask}`. 평가는 `findLast`(마지막 일치 우선; permission.ts:91), 일치 없으면 `ask`. 한 작업이 여러 resource 를 가질 때 하나라도 deny 면 deny, 아니면 하나라도 ask 면 ask. 와일드카드는 `*`(`/` 포함), `?`. 셸 패턴 끝 ` *` 는 인수 없는 명령도 포함. [원문] permissions.mdx.
- 합성: 에이전트 규칙 + 세션 규칙(`merge(agent.permissions, session.permissions)`), 저장된 승인(`permission/saved.ts`), 그리고 `permission.evaluate` 훅이 effect/message 를 바꿀 수 있다. deny 는 훅 이전에 확정되어 훅이 deny 를 뒤집을 수 없다(permission.ts:173~). [원문]
- 사용자 승인: `ask` 면 `Permission.Event.Asked`(휘발)를 발행하고 Deferred 로 대기한다. 응답은 `once|always|reject`(+피드백 메시지). reject 는 같은 세션의 대기 중 요청 전체에 퍼진다. 피드백이 있으면 `CorrectedError`(타입 실패, 도구가 ToolFailure 로 변환해 모델이 계속)이고 피드백이 없으면 `DeclinedError`(결함 터널로 스텝 종료). [원문] permission.ts:235~.
- 도구가 스스로 `permission.assert` 를 호출한다. 레지스트리가 주입하지 않는다("Trusted tools formulate and sequence permission requests"). 따라서 새 도구가 호출을 빠뜨리면 권한이 없다. [원문+추측]
- 도구 노출 단계 필터: `registry.snapshot(permissions)`가 deny 된 도구를 광고에서 제거하고, 스킬·MCP 지침 로드에도 같은 권한이 적용된다(session/context.ts:129~138). [원문]
- 정책(`experimental.policies`): `provider.use`, `tool.use`, `integration.use` 문, 마지막 일치 우선, 사용자 > 저장소 정책, 콘솔 관리 정책이 최종 권위. `tool.use` 는 절대 허가를 주지 않고 `ask`/`allow` 는 여전히 권한이 결정한다. [원문] specs/v2/provider-policy.md.
- 경계: `external_directory` 액션이 위치/프로젝트 밖 경로를 먼저 검사한다(기본 allow). 기본 에이전트 규칙은 `* * allow` + `.env` read ask(Agent.Info.default, schema/src/agent.ts).

### 3.7 L1e 컨텍스트 조립과 컴팩션

컨텍스트 조립
- 매 Step 전 러너는 이력을 투영에서 다시 읽고, 에이전트·모델을 해석하고, 지침을 준비하고, 도구를 구체화한다(session.md). 지침은 "값 델타"다: 소스 키 → SHA-256 해시, 본문은 머신 로컬 `instruction_blob` 에 한 번 저장, 현재/에포크 초기 값은 `instruction_state` 투영. 변경은 승인 시 한 번 렌더되어 `text` 가 내구 이벤트에 동결되고 시계열 System 메시지로 투영된다. 에포크는 컴팩션 사이를 넘으며 `compaction.ended` 가 에포크 시작을 옮긴다. 이동은 상태를 유지해 목적지 변화가 시계열 갱신이 된다. 분기는 부모의 최신 지침 값을 기준선으로 채택한다. 지침 소스: 내장, 주변 탐색(AGENTS.md 류), 선택 에이전트 스킬 안내, 참조, MCP 지침, API 관리 항목 — "지침 레지스트리는 없다". [원문]
- 요청 훅 `context`(시스템·메시지·도구·옵션 가변), `compaction`, `generate`, `title`: 모델 요청 종류(`primary|compaction|title|generate`)별로 따로 등록해야 한다(migrate-v1.mdx). [원문]

컴팩션(core/src/session/compaction.ts, 930줄)
- 트리거: 자동(`reason: auto`, 요청 전 추정 vs 컨텍스트 창 − 여유 `max(15%, 16k)`), 수동(`/compact` inbox 제어 항목), 오버플로우(공급자가 컨텍스트 초과 거부; 내구 출력 이전에만, Step 당 1회). [원문] 상수: `RESERVE_SHARE=0.15`, `RESERVE_MIN=16_000`, `SHRINK_STEPS=[0.7,0.5,0.35]`.
- 방식: 전체 대화를 모델에 보내 구조화 템플릿(`SUMMARY_TEMPLATE`)의 롤링 요약을 만든다. 정상 요청과 접두를 같게 해 프롬프트 캐시를 재사용한다. 최근 `keep.tokens`(기본 15,000) 분량은 원문으로 요약 옆에 유지(`metadata.keepID`로 참조). 체크포인트는 `<conversation-checkpoint><summary/><recent-context/>` 하나의 사용자 메시지로 이후 요청 앞에 붙는다. 후속 컴팩션은 이전 요약을 갱신한다. 템플릿을 어기면 한 번 되묻는다(NUDGE). 요약 요청이 너무 크면 평문으로 평탄화하고 오래된 교환부터 버린다. 요청 훅이 `result` 를 채우면 모델 호출을 생략한다. 네이티브(암호화) 컴팩션 항목은 만든 모델에서만 재생된다. [원문]
- 전체 전사본은 내구 보존하고 "활성 모델 이력"만 경계 이후로 바뀐다. 공급자 네이티브 연속 상태는 경계를 넘지 않는다. 청구는 실패/중단된 컴팩션 호출도 포함. 한 세션에서 컴팩션 동시 실행 없음. [원문]
- 스텝 한도 도달 시 별도 기능인 "doom loop" 감지는 v2 권한 액션이 아니다(permissions.mdx "doom_loop and lsp are not current V2 Core permission actions"). [원문]

### 3.8 L1f 세션 영속성

저장
- `session_v2`(세션 행: 부모·분기·위치·비용·토큰·에이전트·모델·권한·revert·실행 claim 필드 `time_suspended`/`resume_attempts`), `session_message`(`type`, `seq`, JSON `data`; `(session_id, seq)` 유니크), `session_inbox`, `session_pending`, `instruction_entry/blob/state`, `event`, `event_sequence`(aggregate 별 현재 seq + owner_id). [원문] session/sql.ts, event/sql.ts. 기본 저장소는 SQLite(bun/node/workerd 3 바인딩). 평문 JSONL 로그는 아니다.
- 원자성: `Bus.publish` 의 내구 경로는 `Effect.uninterruptible` 안에서 DB 트랜잭션 하나로 (1) 현재 seq 조회 (2) 이벤트 데이터 인코딩 (3) 중복 ID/순서/소유자/재생 불일치 검증 (4) 등록된 투영기 실행 (5) `commit` 콜백(예: 실행 claim) (6) `event_sequence` 갱신(+`event` 삽입은 persist 옵션)을 수행한다. 투영 실패는 결함으로 트랜잭션을 중단한다. [원문] bus.ts:296~420. `publishAll` 로 여러 이벤트를 묶을 수 있다.
- 재생 검증: 같은 seq 가 이미 있으면 ID·타입·created·데이터가 완전히 같을 때만 무시하고 다르면 "Replay diverged" 결함. owner_id 로 재생 소유자를 구분한다. 일부 이벤트 payload 의 이름 변경은 비교 시 업그레이드 형태로 비교한다. [원문]
- 영속 옵션: 내구 이벤트 페이로드를 로그 재생용으로 보존할지 설정 가능(bus.ts:183 `Options`). 기본값은 확인하지 못했다.

resume/replay/fork
- resume: 실행 시작 이벤트와 같은 트랜잭션에서 claim(`time_suspended = now`)을 쓴다. 성공·실패·사용자 중단은 claim 해제, shutdown 중단과 비정상 종료는 claim 을 남긴다. 서버 시작 시 최상위(`parent_id IS NULL`) claim 세션을 재개하고, 지속 지침 메시지를 추가하며 재시도 횟수를 센다(`resume_attempts`). "Recovery is bounded per claimed execution but does not guarantee exactly-once provider requests or tool effects." [원문] execution.ts:78~, store.ts:201.
- 결과 불명 도구 처리: 드레인 시작마다 `settleStaleToolCalls`가 이전 프로세스의 `streaming/running` 도구를 `aborted: Tool execution interrupted: <name>`(서브에이전트면 자식 sessionID 포함)로 실패 처리한다. 부작용이 이미 실행됐는지는 판단하지 않고, 자동 재실행도 하지 않는다("never directly replays ambiguous side effects"). 낡은 컴팩션도 `compaction.interrupted` 로 정리. [원문] runner/llm.ts:356.
- replay: `/api/experimental/session/:id/log?after=seq&follow=true` — 내구 이벤트만 재생하고 휘발 델타는 없다. 별도 유한 이력 엔드포인트는 없고 요청/응답 소비자는 메시지·대기 입력·컨텍스트 투영을 쓴다. 로그 읽기는 모르는 이벤트 타입을 건너뛴다. [원문]
- fork: `POST /api/session/:id/fork`, `session.forked` 이벤트가 `parentID`, `boundary`, 지침 값을 담고 분기는 경계까지만 메시지를 복사하되 부모의 최신 지침을 기준선으로 채택한다. 포크된 집합체는 첫 자식 이벤트 전에 상속된 접두 seq 를 예약할 수 있다(bus.ts:154 주석). [원문]
- revert: `revert/stage|clear|commit`. 스텝 전후 스냅샷(`Snapshot.capture`: 콘텐츠 주소 트리, git 기반, 최선 노력)으로 변경 경로를 기록하고 stage 시 파일을 복원하며 다음 프롬프트 제출 시 commit. [원문] snapshots.mdx, session-event.ts:651. 범위: 세션 활성 디렉터리 안의 추적 파일 + 2MiB 이하 비무시 미추적 파일.
- 이식(transfer): `session-transfer.ts`, import/export 엔드포인트(experimental).

### 3.9 L1g 서브에이전트·멀티에이전트

- 정의: `Agent.Info`{id, name, model?, request, system?, description?, mode: primary|subagent|all, hidden, color?, steps?, permissions}. 출처: Markdown(frontmatter + 본문=system) 또는 설정 `agents`, 플러그인 `ctx.agent.transform`. 기본 `build`. [원문] schema/src/agent.ts, agents.mdx.
- 실행 위치: 같은 서비스 프로세스 안의 자식 세션이다. `subagent` 도구가 `sessions.create({parentID, agent, model})` 로 자식을 만들고 일반 프롬프트 승인 경로(`sessions.prompt`)로 입력을 넣고, `Job`(SubagentJob)으로 완료를 추적한다. 별도 OS 프로세스 아님. [원문] tool/plugin/subagent.ts.
- 호출 모드: 포그라운드(기본: `jobs.block`으로 대기, 결과 `<subagent sessionID=… state="completed">`), 백그라운드(`background:true`, 즉시 반환 후 완료 시 부모에게 합성 입력으로 통지 — SubagentCompletion.deliver), 포그라운드 도중 백그라운드 전환(`POST /api/session/:id/background`, `result.type === "backgrounded"`). 기존 `sessionID` 로 이전 자식 대화를 이어갈 수 있다(부모의 자식인지 검증). 중첩 깊이 한도 `experimental.subagent_depth` 기본 1. [원문]
- 권한 상속: 부모는 `subagent` 액션(리소스=대상 에이전트 ID)으로 어떤 에이전트를 부를지만 통제한다. "the child uses its own configured permissions" — 부모 규칙이 자식에게 상속되는 코드는 찾지 못했다. 자식 세션 권한 = 자식 에이전트 규칙 + 자식 세션 규칙. [원문] agents.mdx, context.ts:130. 부모가 거부했던 권한이 자식 에이전트 설정에서 열려 있으면 자식은 가능하다는 함의는 [추측].
- 도구 설명에 사용 가능한 서브에이전트 목록을 `session.context/compaction/generate` 훅으로 동적 주입한다(subagent.ts 하단). 부모 권한이 `subagent` 를 deny 한 에이전트는 목록에서 빠진다.
- 결과 반환: 완료된 어시스턴트 메시지의 텍스트(`SubagentCompletion.text`), 없으면 `NO_TEXT`. 오류/취소는 sessionID 를 포함한 `ToolFailure`. 부모 재시작 시 자식 도구 호출 고아 정리가 sessionID 를 메시지에 남긴다.
- 다중 에이전트 조정은 이 부모-자식 위임 외에는 보지 못했다(피어 메시징, 팀 구조 없음). [추측: 전수 검색은 아님]

### 3.10 L2 능력

내장 도구(core/src/tool/plugin/): read, write, edit, patch, glob, grep, shell, webfetch, websearch, question, todo, skill, subagent, mcp-resource, opencode(자체 도움), file-diff. 모두 `ctx.tool.transform` 으로 내장 플러그인(`opencode.tool.*`)으로 등록되므로 사용자 플러그인과 같은 경로다(subagent.ts `Plugin = {id: "opencode.tool.subagent"}`). `todo` 는 `experimental.todo` 플래그. [원문]
- 파일 검색: ripgrep 래퍼와 fff 바인딩(`filesystem/fff.*.ts`). 읽기 한도: 텍스트 2,000줄·50KiB, 줄 2,000자, 이미지·PDF 20MiB. 변경은 `file-mutation.ts` 가 모은다. [원문] tools.mdx.
- 웹: webfetch(HTML→Markdown), websearch(제공자 플러그인 `ctx.websearch.transform`). 이미지 처리(`image.ts`, photon wasm).
- Code Mode: `@opencode/codemode`("Effect-native confined code execution over schema-described tools"). `execute` 도구 하나로 노출하고, deny 시 코드모드와 그 경로로만 닿는 도구가 제거되며 중첩 도구는 각자 규칙을 적용받는다. 도구는 `options.codemode` 로 포함 여부를 정한다. [원문] 구현 내부는 못 봄.
- MCP(core/src/mcp/): 공식 `@modelcontextprotocol/client`·`server`·`core` 2.0.0. 로컬(stdio, 위치 Environment 로 spawn)과 원격(streamable HTTP, `Mcp-Session-Id` 만료 처리), OAuth(`oauth.ts` 532줄), 시작 타임아웃 30초, 카탈로그 30초, 호출 기본 12시간. 도구·프롬프트·리소스·서버 지침을 가져와 도구는 `<server>_<tool>` 이름과 같은 이름의 권한 액션으로 노출한다. 서버 상태·연결/해제/추가/삭제 API와 `mcp.prompts.changed` 이벤트. 일시 장애 시 250 ms, 1 s 후 두 번 재시도. [원문] mcp/client.ts, mcp/index.ts, permissions.mdx.
- LSP: 위 2·3.2 절 참고. 설정 키(`lsp` boolean 또는 서버 맵 `{command, extensions, disabled, env, initialization}`)는 정규화·검증되지만 편집/쓰기 도구에서 진단 수집은 TODO 이다(edit.ts:205, file-mutation.ts:131). packages/web 의 옛 문서(lsp.mdx)는 내장 LSP 서버 표를 싣지만 v2 문서 트리(services/www)에는 LSP 문서가 없다. 즉 v1 의 LSP 통합은 v2 로 이식되지 않은 상태로 보인다. [원문+추측]
- 지식/메모리: 장기 메모리 전용 기능은 보지 못했다. 대신 지침(AGENTS.md 계열 탐색, `instruction-discovery.ts`), `references`(참조 저장소 캐시: `reference.ts`, `repository-cache.ts`), 플러그인 `storage`(플러그인 ID 범위 KV), 스킬(SKILL.md 디렉터리 탐색, 에이전트·권한별 필터). [원문]
- 기타: 다중 서식기(formatter), 영속 PTY(`persistent-pty`), 폼/질문(`form.ts`), 음성(`voice.ts`), 이미지/미디어 생성 API(`@opencode/ai`), ACP(`cli/src/acp`).

### 3.11 확장 지점

로딩·토글
- 플러그인 = `export default Plugin.define({id, setup(ctx)})`(Promise 판) 또는 `Plugin.define({id, effect(ctx)})`(Effect 판, `@opencode/plugin/effect`). 설정 `plugins: ["pkg", {package, options}]`. 소스: 설정의 npm/로컬, `.opencode/plugins/`(및 `.opencode/plugin/`), 내장(`opencode.*` ID, `PluginInternal.guarded` 는 비활성화 불가). 로컬 변경은 파일 감시로 핫 리로드된다(PluginModule 의 Watcher). [원문]
- 런타임 토글: `PluginSupervisor.resolve` 가 설정 연산(추가·삭제·`*`/`prefix.*` 선택자)을 해석해 "세대(generation)"를 만들고 Registry 가 접두 비교(diff)로 바뀐 플러그인만 올리고 내린다. 패키지 플러그인 설치·갱신은 위치 준비를 막지 않고 백그라운드에서 한다. 비활성화하면 그 플러그인이 등록한 훅·transform·도구가 Scope 종료로 사라진다. [원문] plugin/supervisor.ts, plugin.ts.
- 충돌·순서: 같은 훅은 "플러그인 순서(등록 순서)대로 순차 실행, 뒤 훅은 앞 훅의 변경을 본다." 로드 순서는 전역 설정 → 프로젝트 설정 → 전역 플러그인 디렉터리 → 프로젝트 디렉터리, 내장(pre/post)은 앞뒤에 배치한다(supervisor.ts `ordered`). 중복 플러그인 ID 는 부팅 순서의 첫 번째만 살리고 나머지를 실패 처리한다. 도구 이름 충돌은 최근 등록 우선 오버레이. [원문]
- 실패 격리: (1) `setup` 실패 또는 `transform` 실패 → 해당 플러그인만 비활성화("Plugin disabled after … transform failed"), 오류 참조 ID 를 UI/로그에 남기고 이전 세대가 있으면 유지, 리비전이 바뀌기 전에는 재시도 안 함(plugin.ts:23, supervisor.ts). (2) 런타임 훅은 격리가 약하다: `PluginHooks.trigger` 는 콜백을 직접 순차 `yield*` 하고, Promise 어댑터에서 `execute.before` 만 거부를 `Tool.Error` 로 변환해 그 호출만 실패시키며 나머지 훅은 `Effect.promise`(예외 → 결함)이다(plugin/src/promise/adapter.ts:638~). 결함이 해당 작업(요청, 권한 평가 등)으로 전파되는지 상세는 확인하지 못했다. 훅 타임아웃은 코드에서 못 찾음. [원문+추측]
- 보안: 플러그인은 인프로세스 신뢰 코드다. 격리·권한 경계 없음. 정책 `integration.use` 로 `plugin:<package>` 허용/거부는 가능(provider-policy.md). [원문]

훅/변형 목록 (강제 수준: 1 관찰, 2 차단, 3 형성, 4 주입, 5 구동)
- 이벤트 구독 `ctx.event.subscribe()` — 수준 1 (휘발 라이브 스트림 + `log`).
- 도구 `tool.hook("execute.before")` — 수준 2·3: 입력 변형, `Tool.Error` throw 로 호출 거부(이 훅만 실패 채널 보유). `execute.after` — 수준 3: 결과/에러 변형(변형 후 정규화·재경계화), 실패 채널 없음.
- 권한 `permission.hook("evaluate")` — 수준 2·3: effect(allow/deny/ask)·message 변경(코어 deny 는 훅 앞에서 확정; ask→allow 승격 가능).
- 셸 `shell.hook("create.before")` — 수준 3: command/cwd/timeout/shell/env 변경.
- 세션 `prompt`(승인 전 프롬프트·메타·delivery 변형; 재시도 안전해야 함, 정확히 한 번 보장 없음), `context`(system/messages/tools/options 변형 — 도구 삭제·설명 변경으로 도구 노출 형성), `compaction`/`generate`/`title`(+`result` 로 모델 호출 대체), `model.request`/`http.request`/`http.response`/`experimental.ws.*`, `retry`(재시도 여부·지연 결정) — 수준 3 중심, `retry`·`result` 는 수준 2·3.
- AI SDK `aisdk.hook("sdk"|"language")` — 수준 3(모델 구현 주입).
- Transform 도메인(상태형, 재생 가능, `reload`로 재실행): agent, command, integration, mcp, model, provider, reference, skill, tool, vcs, websearch — 수준 3. 도구 추가는 `ctx.tool.transform((editor)=>editor.add(...))`.
- 주입: `ctx.session.prompt/synthetic/command/compact/interrupt/move` 를 플러그인이 직접 호출할 수 있다(SessionDomain). 즉 안전 경계(steer/queue)에 메시지·단계를 삽입 가능(수준 4). `ctx.permission.assert` 로 플러그인 도구가 권한 요청도 낸다.
- 구동(수준 5): 루프를 함수로 호출해 흐름 전체를 진행하는 훅은 없다. 다만 `ctx.session.prompt` + `wait` + `generate`(`session.generate`) 조합으로 외부 코드가 여러 세션을 오케스트레이션할 수 있다. 서브에이전트 도구가 이 방식(프롬프트 승인 + 잡 대기)의 내장 사례다. 러너 `drain` 자체를 교체하는 지점은 없다. [원문+추측]
- RPC: 플러그인 간·클라이언트 간 타입 공유 RPC(`ctx.rpc`, `./rpc` export).
- TUI 플러그인은 별도 엔트리(`@opencode/plugin/tui`, Solid/opentui 피어 의존).
- 호환: v1 플러그인(훅 객체 반환, `tool.execute.before` 문자열 키)은 v2 에서 동작하지 않는다. 마이그레이션 표가 v1→v2 훅 대응을 제공하고 일부(`experimental.compaction.autocontinue`, `provider.small_model`, `text.complete`)는 대응이 없다. [원문]

## 4. 채택 판단

### 4.1 그대로 가져다 쓸 수 있는 것

- `@opencode/ai`(MIT, 의존성 effect·aws 계열만): provider 추상으로서 가장 완결도가 높다. 프로토콜·엔드포인트·인증·프레이밍 분리, 캐시 정책, 공통 `LLMEvent`. 근거는 위 3.5. 위험: (1) Effect 런타임 전제, (2) 이 패키지의 안정성 보장 선언을 못 찾았고(2.x 이나 2.1 에서 계약 변경 사례), (3) 218개 파일 규모에서 우리가 쓰는 부분만 분리하기 어려울 수 있다. 채택 전 우리 런타임 언어/Effect 사용 여부가 선결 조건이다. [원문+추측]
- `@opencode/schema`(MIT, 의존성 effect·standard-schema): 이벤트·메시지·권한·도구 스키마의 계약 기준점. 이벤트 정의 방식(내구/휘발, 버전, 집합체)은 그대로 쓸 만하나 세션/Provider 등 도메인 타입이 opencode 모델에 묶여 있다.
- `@opencode/codemode`(MIT): 스키마 서술 도구 위의 제한된 코드 실행. 우리가 코드모드를 원한다면 후보. 내부 미조사이므로 별도 검토 필요.
- MCP: opencode 가 쓰는 공식 `@modelcontextprotocol/*` 2.0.0 을 우리가 직접 쓰는 편이 낫다. `core/src/mcp/client.ts` 의 재시도·세션 만료·타임아웃 처리는 참고용으로 읽을 가치가 있다.
- MIT 라이선스이므로 코드 복사·수정이 가능하다(저작권 고지 유지). 모든 패키지가 MIT 이고 CLA/듀얼 라이선스는 못 봤다. 라이선스 필드 없는 패키지는 private 뿐이다.

### 4.2 설계만 참고할 것

- 입력 inbox(steer/queue/제어 항목, 멱등 ID, 안전 경계 전달): 우리 "단계 사이 큐"에 직접 대응. 내구 행으로 먼저 받고 실행은 `wake` 초인종으로 분리한 점이 핵심. 이유: 구현이 Effect+SQLite+이벤트 투영과 얽혀 있어 이식보다 모델 차용이 낫다.
- 실행 조정기(`SessionRunCoordinator`): 키별 직렬, 초인종 합류, 정지 중 합류 거부, 느린 정리를 기다리지 않는 interrupt. 150줄 정도라 개념 이식이 쉽다.
- 이벤트 소싱 + 같은 트랜잭션 투영 + seq 재생 검증 + write-ahead claim 복구. 복구의 한계(정확히 한 번 보장 없음, 모호한 부작용은 재실행하지 않고 실패 표시)를 명시한 점이 좋다.
- Step 단위 이력 재적재 원칙("인메모리 도구 루프 없음")과 "한 Step = 여러 물리적 시도" 구분, 오버플로우·불완전 스트림·출력 한도별 복구 규칙.
- 지침 델타(내용 해시, 에포크, 컴팩션과 연동)와 요청 캐시 접두 보존 규칙(최종 스텝에도 도구 유지 + toolChoice none).
- 컴팩션: 롤링 요약 + 최근 원문 보존 + 캐시 재사용을 위한 접두 동일 요청 + 단계적 축소(0.7/0.5/0.35) + 네이티브 컴팩션 윈도. 실제 세션 통계에 근거한 여유 계산이 주석에 있다.
- 서버 이벤트 피드(1회 인코딩 + 연결별 독립 큐 + 초과 시 해당 연결만 종료)와 "휘발 라이브 + 내구 로그 조합" 계약.
- 도구 응답의 3값(output/content/metadata)과 정규 표현 1개 원칙, 결과 경계화(머리+꼬리 + 관리 저장소 보관), 호출 ID 의 범위(Step 내 유일 + 메시지 ID 동반).
- 권한 모델 일부: 마지막 일치 규칙, 다중 리소스 합성(deny > ask > allow), 거부(결함 터널)와 피드백 거부(타입 실패)의 구분, 도구 광고 단계 필터링. 단 "도구가 스스로 assert"하는 방식은 누락 위험이 있어 우리는 디스패처가 강제하는 쪽을 택할 이유가 있다.
- 서브에이전트: 자식 세션 + Job + 백그라운드 통지 + 포그라운드→백그라운드 전환 + 깊이 한도.
- 플러그인 훅: "가변 이벤트 하나를 순차 변형", 상태형 transform 과 reload, 모델별 훅 범위 제한(`providerID`), 요청 종류 구분.

### 4.3 피할 것

- 통째 런타임 채택: Effect 서비스 그래프(`makeLocationNode` 등 앱 노드 컴포지션)에 깊이 결합되어 있다. 부분 이식이 어렵다. 또한 2.1 이 공개 계약을 minor 에서 깼고 `/api/experimental/*` 가 많다. 빠르게 변하는 대상이다.
- 런타임 훅의 약한 격리: 훅 예외·무한 대기에 대한 타임아웃·격리가 보이지 않는다. 플러그인은 동일 프로세스 신뢰 코드다. 우리 확장 모델이 더 강한 격리를 요구하면 이 부분은 따르지 않는다.
- 도구가 `permission.assert` 를 직접 호출하는 구조: 도구 작성자 누락 시 무방비. 디스패처 단계의 선언적 권한 강제가 안전하다. [추측: 설계 선호]
- 동시 도구 실행 한도 부재(코드에서 발견되지 않음): 모델이 많은 호출을 내면 제한 없이 병렬로 시작될 수 있다.
- 서브에이전트 권한 비상속: 자식이 자기 에이전트 권한만 쓰므로 우리가 부모 상한 상속을 원하면 별도 설계해야 한다.
- LSP: v2 에는 구현이 없다. 참고할 코드도 없다(구 v1 트리는 이 저장소에 없음).
- 클러스터/다중 프로세스 소유권: 미구현("explicit placement and fencing protocol" 이전). 우리가 홈서버 데몬 + 여러 기기를 전제하면 소유권 모델을 직접 설계해야 한다.
- 문서 혼재: packages/web 의 docs 는 v1 기준(`plugin` 훅 객체, bash/task 권한 이름)이라 낡았다. 반드시 services/www/src/docs/content 와 specs/v2 를 1차로 삼는다.

## 5. 다른 대상과 비교할 때 볼 특징

- 이벤트 소싱 코어: 세션이 "로그 + 투영"이고 메시지 테이블은 파생물이다. 같은 트랜잭션 투영, 집합체별 seq, 재생 발산 검출, 이벤트 타입 버전. 다른 대상이 JSONL 이력이나 메시지 배열을 직접 저장하는지와 대조할 것.
- 입력의 내구 선기록: 프롬프트가 실행 전에 inbox 로 내구 기록되고 실행은 별개 초인종. steer/queue 의미가 계약(문서)화되어 있다.
- write-ahead 실행 claim 기반 크래시 복구와 "모호한 부작용 도구는 실패 처리, 재실행 없음" 정책.
- 서버 상주 단일 서비스 + 등록 파일 발견 + 버전 불일치 시 재기동, 프로토콜 계약(HttpApi)에서 클라이언트 코드 생성. 클라이언트가 모두 같은 API 를 쓰고 플러그인 컨텍스트도 "서버 클라이언트와 본질적으로 같다".
- 자체 provider 계층(Protocol/Route/Endpoint/Auth/Framing)이 AI SDK 를 대체하고 AI SDK 는 호환 어댑터로 격하. 프롬프트 캐시 정책이 1급 개념.
- Step 단위 재적재와 지침 델타 해시(캐시 친화 컨텍스트). 컴팩션이 캐시 접두 재사용을 설계 목표로 한다.
- 도구 응답 3값과 결과 경계화(관리 저장소), 호출 단위 개별 거부, 요청 시점 도구 스냅샷 포획.
- 훅 모델: 단일 가변 이벤트 순차 변형 + 상태형 transform/reload 이원화. v1 의 "훅 객체 반환" 모델은 폐기. 플러그인 활성/비활성은 세대 diff 와 Scope 정리로 처리.
- 권한: 규칙(allow/deny/ask 마지막 일치) + 저장 승인 + 훅 + 정책(콘솔 관리 권위) 4층. 도구 광고 단계에서도 같은 규칙으로 필터.
- 공백으로 남은 영역(비교 시 주의): OS 샌드박스 없음, LSP 런타임 없음, 장기 메모리 없음, 다중 노드 소유권 없음, 플러그인 훅 격리·타임아웃 약함.
