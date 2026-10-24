# oh-my-pi (omp) 조사 보고서 — F~L2 층 설계

표기: [원문] 소스·문서에서 직접 확인, [추측] 추론. 약어: `CA` = `packages/coding-agent/src`, `AG` = `packages/agent/src`, `EXT` = `CA/extensibility/extensions`, `docs/` = 저장소 루트 `docs/`. pi 쪽 근거는 `~/projects/_ref/pi-src`(cdaf6c2)와 기존 `pi-report.md`. 줄 번호는 아래 커밋 기준이며 한 번 더 확인한 값만 적었다.

---
## 0. 대상 정보

| 항목 | 내용 |
|---|---|
| 저장소 | https://github.com/can1357/oh-my-pi [원문: clone 성공, README에 "Built by Stencil Labs · Fork of Pi by @mariozechner"] |
| 커밋 | `d1bffdf` (2026-10-20, PR #16361 병합). 패키지 버전 18.12.3 (CHANGELOG 상 최신 릴리스 2026-10-19), `[Unreleased]` 구간 존재 |
| 라이선스 | MIT. 루트와 패키지별 `LICENSE`에 저작권자 3명: Mario Zechner(2025), Can Bölük(2025-2026), Stencil Labs, Inc.(2026). 대부분 `package.json`에 `"license": "MIT"`. Rust 크레이트는 `license.workspace = true`(루트 `Cargo.toml:30` MIT) |
| 언어 | TypeScript(Bun 전용, `engines.bun >=1.3.14`) + Rust(N-API 애드온, 내장 셸). 앞서 센 라인 수: coding-agent TS 약 51만, ai 약 13.5만, tui 약 19만, catalog 약 4만, agent 약 2.1만, utils 약 3.8만, Rust(vendor 제외) 약 35만 [원문, `wc -l`] |
| 패키지 | `agent`(pi-agent-core), `ai`, `catalog`(모델 카탈로그), `coding-agent`(CLI·세션·확장), `tui`, `natives`(+ `crates/*`), `utils`, `wire`(collab 와이어 타입), `snapcompact`, `omptype`(ArkType 호환 스키마), `mnemopi`(메모리), `stats`, `metaharness`, `browser-relay`, `collab-web`, `typescript-edit-benchmark`. 별도 `sdk/{go,python,rust}/omp-rpc` RPC 클라이언트 |
| 규모 비교 | pi: agent-core src 2,519줄·coding-agent src 86,152줄(pi-report.md). omp: `agent-loop.ts` 단독 4,092줄, `agent-session.ts` 14,251줄(pi는 4,398줄) |
| 조사 범위 | 문서(`docs/` 중 extensions, extension-loading, session, compaction, approval-mode, task-agent-discovery, agent-hub, rpc, sdk, hooks, memory, native-crates, porting-from-pi-mono), `EXT/{types,runner,loader}.ts`, `extensibility/shared-events.ts`, `AG/{types,agent,agent-loop(구조·초반 본문),append-only-context}.ts`, `CA/session/*`(문서 위주), `CA/task/*`(spawn-policy·executor 일부), `CA/tools/index.ts`, `CA/sdk.ts`(확장 reconcile 부분), `crates/pi-iso`, `deny.toml`, `THIRD-PARTY-NOTICES.txt` |
| 못 본 것 | `agent-loop.ts`·`agent-session.ts` 전체 정독(합계 1.8만 줄, 구조·주석·grep만), TUI, 각 provider 구현의 내부, MCP 구현 내부, 메모리 백엔드(mnemopi·hindsight·sharpshooter) 내부, collab/ACP, Rust 크레이트 내부 코드, `packages/metaharness`, 테스트. **코드 실행·설치·빌드 없음.** 얕은 clone이라 이력은 2026-08-23 이전이 없다(fork 시점 이력 확인 불가) |
| 기존 메모와의 차이 | `omp-ev.txt`는 49줄, 이번 확인에서는 `ExtensionAPI.on` 오버로드가 고유 이름 50개(`EXT/types.ts:1648-1760` 부근). 차이는 `session.compacting` 등 표기 하나 정도 [원문] |

---
## 1. 한눈 요약

1. omp는 pi의 **큰 폭 확장 포크**다. 이름·구조(Agent/AgentSession/SessionManager/JSONL 트리)는 pi를 따르되, 루프·세션·도구·provider·확장 모두 크게 늘었다. 자체 문서가 "pi-mono 동기화 마지막 지점은 2026-03-22"라고 적는다(`docs/porting-from-pi-mono.md:6-8`). 그 뒤 pi가 만든 Chord/durable/`agent_before_settle` 등은 따라가지 않았다 [원문].
2. 에이전트 루프는 pi의 단순 2중 루프에서 출발해 **큐 종류(steer·followUp·aside·yield-queue·IRC·백그라운드 완료)**, 도구 **추측 실행(speculative)**, 소프트 tool-choice 강제, 마감 시각(deadline), 일시정지 게이트까지 갖춘 4천 줄 루프가 됐다.
3. 확장 API는 pi와 같은 `pi.on / registerTool / registerCommand` 모양이지만 **핸들러에 30초 타임아웃**(pi는 없음), `tool_call` **실패·타임아웃 시 차단(fail-closed)**, 확장별 **런타임 중단·재개(suspend/resume)**가 추가됐다. 다만 모두 **같은 프로세스·같은 권한**이라 격리는 아니다.
4. 강제 수준은 1~4단계가 넓고 두텁다. 5단계(구동)는 `ctx.runEphemeralTurn`, 명령 컨텍스트의 `newSession/branch/navigateTree/switchSession/reload`, `session_stop`의 "계속 진행"(상한 8회)까지다. 확장이 루프 함수를 직접 호출하는 형태는 없다.
5. 서브에이전트는 **같은 프로세스·같은 메인 스레드**에서 자식 `AgentSession`을 만들어 돌린다(`task/executor.ts:1-5`). 결과는 `yield` 도구로 돌려받고, 격리는 `pi-iso`(overlayfs/APFS clone/git worktree)로 작업 트리를 복제한다. 승인 모드는 자식에서 `yolo` 고정(부모의 task 승인이 경계), 사용자 `tools.approval` 규칙은 계속 적용.
6. 세션 형식은 pi와 같은 JSONL v3 트리지만 엔트리 종류가 16종으로 늘고, **파일 앞 256바이트 고정 제목 슬롯**, 블롭 외부화, 프로세스 간 소유권 임대(lease), 원자적 전체 재작성이 있다. fsync는 여전히 없다.
7. provider는 "60+"를 표방하고 코드에 구독 OAuth·Claude Code 위장 헤더·codex attestation 같은 **정책 위험이 큰 어댑터**가 포함된다. 카탈로그는 KDL 규칙 239개 파일로 선언된다.
8. 변화 속도가 매우 빠르다: 18.10.2(10-12) → 18.12.3(10-19), 약 1주에 마이너 2개. 메이저 버전 18인 시점에도 매주 변경. 채택은 "패키지 의존"이 아니라 "설계 참고" 중심이 맞다.
9. 패키지 경계는 깨끗하지 않다: `pi-agent-core`가 `pi-natives`(Rust)·`pi-catalog`·`pi-wire`·`snapcompact`에 의존하고, 소스(`.ts`)를 그대로 배포하며 Bun 전용이다.
10. 라이선스 면에서는 MIT라 가져다 쓰기 쉽다. 단 THIRD-PARTY-NOTICES에 LGPL-3.0(sharp-libvips), MPL-2.0, CDDL, WTFPL 의존이 보인다.

---
## 2. 층별 표

| 층·항목 | 구현 방식 | 근거 | 성숙도 |
|---|---|---|---|
| F 메시지/이벤트 스키마 | pi-ai 메시지 + `AgentMessage` 확장(custom/aside/synthetic 도구 결과). 이벤트는 `AgentEvent` 유니온 + 세션 이벤트 | `AG/types.ts`, `AG/agent-loop.ts:3921-4013`(synthetic 도구 결과) | 안정 추정(매주 변경 있음) |
| F 도구 스키마 | 내부는 `omptype`(ArkType 호환, JIT). 확장에는 TypeBox 호환 shim·arktype·zod 호환 빌더를 주입 | `docs/porting-from-pi-mono.md` §15, `EXT/types.ts` `typebox/arktype/zod` 필드 | 실험~안정 |
| F 세션 로그 | JSONL v3, id/parentId 트리, 엔트리 16종, 256B 제목 슬롯, 블롭 참조 | `docs/session.md:54-130` | 안정(버전 3 유지) |
| F 확장 매니페스트 | 모듈 기본 export 팩토리, 패키지는 `package.json#omp.extensions`(`pi.extensions` 폴백) | `docs/extension-loading.md`, `docs/porting-from-pi-mono.md` §15 | 안정 |
| F 설정 | `config.yml`(+`settings.json` 레거시), 사용자·프로젝트·`--config` 오버레이, 프로필 | `docs/extension-loading.md`, `docs/config-usage.md` | 안정 |
| F 버전 정책 | semver 표기이나 매주 마이너 증가, CHANGELOG에 변경 기록 | `packages/coding-agent/CHANGELOG.md` | — |
| L0 OS 추상 | Rust 내장 셸(brush 포크)+30여 유틸 내장, PTY, 파일 워커, VCS(gitoxide·jj-lib), 크로스플랫폼 격리 PAL | `docs/native-crates.md`, `crates/pi-iso/src/lib.rs:1-20` | 안정 추정 |
| L0 샌드박스 | **프로세스·커널 샌드박스 없음.** 승인 계층 + 작업 트리 격리만 | `docs/approval-mode.md`, grep 결과 | — |
| L0 프로세스 모델 | 기본 단일 프로세스(+워커 스레드), RPC(JSONL stdio), ACP, collab(원격 세션), 인증 브로커 | `docs/rpc.md`, `CA/modes/{rpc,acp}`, `CA/collab` | 안정/실험 혼재 |
| L1a 태스크 엔진 | 한 메시지의 도구는 shared/exclusive 동시성, 추측 실행, 작업 풀(`workpool`), `AsyncJobManager`, 취소는 AbortSignal + 도구 범위 abort 이유 | `AG/types.ts:1162-1166`, `AG/speculative-execution.ts`, `CA/task/workpool.ts`, `AG/agent-loop.ts:167-209` | 안정(추측 실행은 실험 추정) |
| L1a 단계 간 큐 | steer / followUp / aside / yieldQueue / IRC / 백그라운드 완료 | `AG/agent.ts:1386-1410`, `AG/types.ts` `getAsideMessages`, `CA/session/yield-queue.ts` | 안정 |
| L1b 루프 | `runLoopBody` 2중 루프 + deadline·pause·soft tool requirement·Harmony 누출 재시도 | `AG/agent-loop.ts:1200-1330` | 안정(복잡) |
| L1c 게이트웨이 | pi-ai 계열 + 카탈로그 KDL 규칙, 키 회전·브로커, retry fallback 체인, 캐시 예열 | `packages/ai/src/providers/*`, `packages/catalog/src/compat/`, `AG/append-only-context.ts` | 혼재 |
| L1d 도구 디스패치·권한 | 도구별 `approval` 등급(read/write/exec) + 모드 4종 + 사용자 규칙, 확장 래퍼에서 게이트 | `docs/approval-mode.md:1-30`, `EXT/wrapper.ts` | 안정, **기본 yolo** |
| L1e 컨텍스트·컴팩션 | 컴팩션 방식 여러 개(요약·snapcompact 비트맵·shake·provider 네이티브), 가지 요약, 가지치기 | `docs/compaction.md:1-40` | 혼재 |
| L1f 세션 영속 | 동기 append + 원자적 재작성 + 프로세스 간 임대 + 종료 진단 | `docs/session.md:516-553` | 안정 |
| L1g 서브에이전트 | 같은 프로세스 자식 세션, `yield`, 격리 worktree, 깊이·동시성 제한, Agent Hub | `CA/task/executor.ts`, `docs/agent-hub.md` | 안정 |
| L2 내장 도구 | `BUILTIN_TOOLS` 30개 + 숨김 3개(think, yield, goal) | `CA/tools/index.ts:558-595` | 안정 |
| L2 MCP | stdio/HTTP/SSE 전송, OAuth, 진행률, 도구 캐시, 서버 도구는 `write` 등급 | `CA/mcp/`, `docs/approval-mode.md:9` | 안정 |
| L2 메모리·스킬 | 메모리 백엔드 5종(off/local/hindsight/mnemopi/sharpshooter), 스킬·규칙·TTSR | `docs/memory.md:1-10`, `docs/ttsr-injection-lifecycle.md` | 혼재(기본 꺼짐) |
| 확장 지점 | 이벤트 50종, 도구·명령·단축키·플래그·렌더러·provider·파일 폴백 등록 | `EXT/types.ts:1640-1800` | 안정 |

---
## 3. 층별 상세

### 3.1 F 계약

**메시지·이벤트**
- 메시지 역할은 camelCase로 영속(`user`, `assistant`, `toolResult`, `bashExecution`, `custom` 등), `toolCall`은 assistant `content` 블록 [원문, `docs/session.md:171-199`].
- 루프가 만드는 **synthetic 도구 결과**(중단·건너뜀·위조 방지)가 1급 타입이다: `createSyntheticToolResultMessage`, `isSyntheticToolResultMessage` (`AG/agent-loop.ts:3921-4013`) [원문].
- 도구 정의에 `intent`(도구 호출마다 의도 문자열을 스키마에 주입해 요구/선택/생략), `concurrency: shared|exclusive|함수`, `approval` 등급이 붙는다 (`AG/agent-loop.ts:952-1070`, `AG/types.ts:1162`) [원문].

**스키마 라이브러리**
- pi는 TypeBox, omp는 자체 `omptype`(ArkType 호환 + JIT, `docs/omptype-guide.md`). 확장에는 `pi.typebox`(레거시 shim), `pi.arktype`, `pi.zod`(Zod 호환)를 주입한다 [원문, `EXT/types.ts` `ExtensionAPI` 필드]. pi용으로 쓴 확장을 살리려고 `legacy-pi-*-shim.ts` 4개와 `plugins/legacy-pi-compat.ts`가 있다 [원문].

**세션 로그 형식 (pi v3와 같은 틀, 크게 확장)**
- 파일: `~/.omp/agent/sessions/<인코딩된 cwd>/<timestamp>_<sessionId>.jsonl`. 첫 256바이트는 고정 폭 `type:"title"` 슬롯이라 제목만 바꿀 땐 전체 재작성이 필요 없다 (`docs/session.md:54-68`).
- 헤더: `version: 3`, UUIDv7 id, `cwd`, `additionalDirectories`, `previousSessionFiles`, `providerPromptCacheKey`, `parentSession`(자유 문자열: id 또는 경로) (`docs/session.md:76-100`).
- 엔트리: `message, model_usage, thinking_level_change, model_change, service_tier_change, compaction, branch_summary, reset_boundary, custom, custom_message, label, title_change, ttsr_injection, credential_pin, session_init, mode_change` (16종) (`docs/session.md:116-135`). pi는 11종(`pi-report.md` §5). 문서가 별도로 다루는 확장용 `custom` 계열: `user_todo_edit`, `vibe-session-lifecycle`, `system-prompt-digest`, `session_exit` 등 (`docs/session.md:328-333`).
- id는 8자 hex(충돌 시 Snowflake), 리프 포인터는 **파일에 저장하지 않고** 로드 시 마지막 물리 엔트리로 재구성한다 (`docs/session.md:112, 486`). 포인터만 옮기는 `branch()`는 이후 append가 있어야 재로드에서 살아남는다. pi는 같은 파일 내 분기라는 점이 같다.
- `system-prompt-digest`: 모델 호출 직전 시스템 프롬프트 해시를 기록해, 재개 시 프롬프트가 달라지면 도구 목록 재구성을 **동결**한다(캐시 보존) (`docs/session.md:331`) [원문]. 프롬프트 캐시를 세션 포맷의 1급 관심사로 다룬 점이 특이하다.

**확장 매니페스트**
- 모듈 기본 export 팩토리(pi와 동일). 패키지는 `package.json#omp.extensions`, 폴백 `pi.extensions`. 기능 단위 enable 가능("enabled feature entries") (`docs/extension-loading.md` 입력 3절) [원문].
- 플러그인 설정 중 `secret` 표시 항목은 `omp-plugins.lock.json`에 쓰며 0600 (`CHANGELOG [Unreleased]`) [원문].

**설정**
- 사용자 `~/.omp/agent/config.yml`, 프로젝트 `<cwd>/.omp/config.yml`, `--config` 오버레이, 프로필(`~/.omp/profiles/<name>/agent`). 설정 항목은 `register({id,type,default,ui})`로 선언하고 `.listen(session, cb)`로 **런타임 구독**한다 (`CA/sdk.ts:4918-4921, 5116`; `CA/extensibility/settings.ts:151`) [원문].

**버전 정책** [원문+추측]: 모든 패키지가 같은 버전(18.12.3)으로 묶여 움직이는 모노레포 버전 관리. 18.10.2 → 18.12.3이 7일(`CHANGELOG.md:43, 497`). 호환 보장 문서는 찾지 못했다.

### 3.2 L0 플랫폼

**셸·OS**
- 셸은 호스트 bash가 아니라 **Rust에 내장된 brush 포크**(`crates/vendor/brush-core`)이고, `cat, grep/rg, sed, ls, find, jq, fd, diff, ps, top, kill` 등 유틸을 같은 프로세스에서 구현한다 (`docs/native-crates.md` pi-builtins 항). 따라서 Windows까지 같은 동작을 노린다 [원문].
- 이를 JS가 쓰는 통로가 `@oh-my-pi/pi-natives`(N-API cdylib). 로더·바인딩 계약 문서가 4개(`docs/natives-*.md`) 있다.
- 파일 걷기(`pi-walker`), VCS(`pi-vcs`: gitoxide + jj-lib), AST 도구(`pi-ast`: tree-sitter + 필요 시 WASM 문법 다운로드), 음성(`pi-voice`) 등도 같은 애드온 안에 있다 [원문].
- AGENTS.md가 **git/jj는 `@oh-my-pi/pi-natives/vcs`로만 실행**하도록 규칙화했다. 개발 규칙(내장 헬퍼 우선, Bun API 우선, `#private` 필드 등)이 자세하다.

**샌드박스**
- 프로세스 샌드박스(seccomp/landlock/bwrap/sandbox-exec) 구현은 찾지 못했다 [원문: 관련 grep에서 `sandbox` 일치는 `internal-urls`·`browser-session`·`edit/path_policy` 등 용어 사용뿐 — 파일별 내용은 일부만 확인].
- 대신 ① 승인 계층(§3.5), ② `bash-interceptor`·`conflict-detect`·`auto-generated-guard`·`path_policy` 같은 도구 수준 방어, ③ **작업 트리 격리**(`pi-iso`)가 있다.
- `pi-iso`: macOS는 `clonefile`, Linux는 커널 overlayfs → 막히면 `fuse-overlayfs`, Windows는 ProjFS, 폴백은 `git worktree`(git 저장소) 또는 재귀 복사. btrfs/zfs/reflink 백엔드도 있다. 변경은 `git diff`로 추출해 `git apply`로 돌려받는 구조 [원문, `crates/pi-iso/src/lib.rs:1-20`, `CA/task/worktree.ts`].

**경로·비밀·알림·파일 감시**
- 비밀: `CA/secrets/`, 세션 로그의 비밀 난독화(`session-anonymizer.ts`, ephemeral turn 문서의 "secret-obfuscated provider context") 존재 [원문 파일명/주석만 확인, 내부 미조사].
- 인증 저장은 pi의 `auth.json`+`proper-lockfile` 대신 로컬 `agent.db`(bun:sqlite) 또는 원격 브로커 `RemoteAuthCredentialStore` (`docs/porting-from-pi-mono.md` §15 Auth) [원문].
- 설정 변경 감시: RPC 상주 프로세스는 디스크 설정 변경을 감시 (`docs/rpc.md` 시작 절) [원문].
- 알림·전원: `power-assertion-backend.ts` 등. 세부 미조사.

**프로세스 모델**
- 기본은 **단일 프로세스**(Bun). 워커는 "CLI 진입점을 다시 실행하는 선택자(`__omp_worker_*`)"로만 만든다(AGENTS.md "Worker scripts"). 서브에이전트도 워커가 아니라 같은 스레드의 `AgentSession`이다.
- 원격/연동: RPC(JSONL stdio, 프로토콜 v1·v2, 프레임 1 MiB 상한), ACP(`CA/modes/acp`), collab(`CA/collab`, `packages/wire`), 인증 브로커·게이트웨이(`docs/auth-broker-gateway.md`). 서버-클라이언트 분리는 이들 모드로 한다 [원문 문서 제목/RPC 문서].
- 부모 감시: `subprocess/parent-watchdog*.ts`.

### 3.3 L1a 태스크 엔진

**동시성**
- 한 assistant 메시지의 도구 호출은 도구별 `concurrency`로 나뉜다: `shared`(기본, 서로 병렬), `exclusive`(혼자 실행). 인자 의존 함수도 허용 (`AG/types.ts:1162-1166`) [원문]. pi는 `toolExecution` 모드 하나(`pi-report.md` 4.3).
- `interruptMode: "immediate"|"wait"`: steering이 들어오면 도구를 바로 자를지 끝나길 기다릴지 (`AG/types.ts:172-181`) [원문].
- **추측 실행**: 모델이 도구 호출을 스트리밍하는 도중, 정책이 허용하는 도구를 미리 시작하고 최종 호출과 맞으면 채택, 아니면 폐기한다. 후보 상태 `queued/running/completed/failed/discarded`, 자원 접근 충돌 검사 포함 (`AG/speculative-execution.ts` 961줄, `AG/agent-loop.ts:3201` `speculativeFinalCalls`) [원문]. pi에 없음.
- 작업 풀: `task`의 배치 실행, `provider-concurrency.ts`는 "부모가 자식을 기다리는 깊은 트리가 `maxConcurrency` 때문에 자기 자신을 막는 교착"을 피하도록 설계했다고 주석에 있다 [원문, `provider-concurrency.ts:9, 75`]. 실행 한도 `task.maxConcurrency`(0=무제한), `task.maxRecursionDepth`.
- 비동기 잡: `CA/async/job-manager.ts`(백그라운드 bash·eval·task), 완료는 yield-queue로 전달.

**취소 전파**
- 모든 길은 `AbortSignal`. 도구 범위 abort 이유 `ToolScopedAbortReason`로 "이 도구만 취소"와 "전체 취소"를 구분 (`AG/agent-loop.ts:167-205`). 터미널 도구 결과(`yield`)가 루프를 끝내는 `TERMINAL_TOOL_RESULT_ABORT_REASON`도 있다 (`AG/agent-loop.ts:~1325`) [원문].
- 확장 핸들러는 `handlerSignal`(타임아웃·외부 abort 합성)을 받고, UI 대화가 열려 있는 동안은 타임아웃 예산이 일시 정지된다(`createHandlerUIContext(..., timeoutBudget)`, `EXT/runner.ts:170-300`) [원문].
- 병렬 작업 중 한 자식이 오류나면 형제를 즉시 취소하고 드레인 후 첫 오류로 reject (`task/parallel.ts` 주석) [원문].

**단계 사이 큐** (pi: steer / followUp 둘)
| 큐 | 의미 | 근거 |
|---|---|---|
| steering | 실행 중 끼어들기. 모드 `all`/`one-at-a-time`. 도구 배치를 중단시키고 건너뜀 결과를 만든다 | `AG/agent.ts:1262-1286, 1386`, `AG/types.ts` `hasSteeringMessages/waitForSteeringMessages` |
| live steering | 스트리밍 중 provider가 지원하면 요청 도중에 넣는다(`liveAccepted/liveDeferred`) | `AG/live-steering.ts`, `AG/agent-loop.ts:1235-1240` |
| followUp | 루프가 멈추려 할 때 이어붙임 | `AG/agent.ts:1410` |
| aside | **끼어들지 않고** 다음 단계 경계에 삽입. 확장 `deliverAs:"aside"` | `AG/types.ts:51-64, 362`, `EXT/types.ts:1857` |
| yield-queue | 백그라운드 결과·LSP 늦은 진단·MCP 알림 등을 종류별로 묶어 한 메시지로 배달, `isStale`로 이미 전달된 것은 제외 | `CA/session/yield-queue.ts:1-40`, `CA/sdk.ts:5133-5139` |
| IRC·백그라운드 완료 | 에이전트 간 메시지, 비동기 잡 완료 신호가 루프 조건에 들어감 | `AG/types.ts` `hasIrcInterrupts/hasBackgroundCompletions` |

pi의 `finishTurn/prepareRequest/prepareNextTurn`(pi `types.ts` AgentLoopConfig) 대응물은 omp에 없고, 대신 `beforeModelCall`, `onBeforeYield`, `getAsideMessages`, `transformProviderContext`가 있다 [원문 비교].

### 3.4 L1b 에이전트 루프 / L1c 모델 게이트웨이

**루프 (`AG/agent-loop.ts`)**
- 기본 골격은 pi와 같다: 바깥 루프(followUp 도착 시 계속) + 안쪽 루프(도구 호출·steering 처리) (`:1297-1330`).
- 추가된 것 [원문, `:1200-1330`과 `AgentLoopConfig` 필드]:
  - **deadline**: 절대 시각 도달 시 abort. 매 반복 `isDeadlineExceeded` 확인.
  - **pause 게이트**: 프로세스 전역 `/pause`. 턴 경계에서 멈춰 대기.
  - **resumeTail**: 끝이 짝 없는 tool_call인 대화로 재개하면 모델 호출 전에 그 도구들을 먼저 실행(`unpairedToolCallTail`, `:667`).
  - **soft tool requirement**: "이 도구를 먼저 부르라"를 강제 `tool_choice`(캐시 무효화) 대신 알림 한 번 → 어기면 한 턴 강제로 단계적 상승(`AG/agent-loop` 주석, `AG/types.ts` SoftToolRequirement).
  - 모델 출력 이상 대응: Harmony 누출 재시도, DSML 누출 알림, paused turn 이어하기, 위조된 도구 결과 시 중단(`abortOnFabricatedToolResult`), 중복 도구 호출 id 복구(`ensureUniqueToolCallIds`), 알 수 없는 도구 이름에 유사 이름 제안(`suggestToolNames`).
  - 도구 인자 검사 후 `transformToolCallArguments`, `resolveFallbackTool`.
  - OpenTelemetry 스팬(`AG/telemetry.ts` 2,257줄).
- 종료 조건: 도구 호출 없음 + steering/followUp 없음, 또는 deadline·abort·터미널 도구 결과.
- 한 가지 주의: 이 파일은 4천 줄이며 부수 정책(모델별 방언·복구)이 많이 섞여 있다. 얇은 코어로 보기는 어렵다 [원문 크기, 판단은 추측].

**세션 쪽 마감 (`session_stop`)**
- 메인 에이전트가 멈추려 할 때 `session_stop`을 내보내 확장이 한 번 더 이어가게 할 수 있다. 결과 `{continue, additionalContext, decision:"block", reason}`, Claude/Codex 훅 호환 표기. 연속 상한 `SESSION_STOP_CONTINUATION_CAP = 8` (`CA/session/agent-session.ts:474, 5351-5440`; `shared-events.ts:488-500`) [원문]. pi의 `agent_before_settle`/`agent_settled`에 해당하는 위치지만 모양이 다르다.

**모델 게이트웨이**
- API 추상은 `Api`/`KnownApi` 유니온 + `ApiOptionsMap`의 컴파일 타임 완전성 검사 (`packages/ai/src/types.ts:93-100`) [원문].
- provider 구현 파일: Anthropic, Bedrock(+Mantle), Azure, OpenAI(completions/responses/codex), Google(+Vertex, Gemini CLI), Ollama, Kimi, Cursor, Devin, Factory Droid, GitLab Duo, Apple Foundation Models 등 (`packages/ai/src/providers/`). README는 "60+ providers". 정확한 수는 카탈로그 KDL(239파일)에서 세지 않았다 [추측: 대부분 OpenAI 호환 선언].
- 모델 사양은 코드가 아니라 **KDL 규칙**(`packages/catalog/src/compat/rules/**/*.kdl`)이 선언하고 `bun run gen:models`로 `models.json`을 만든다 (`docs/porting-from-pi-mono.md` §15) [원문].
- 인증: 다중 계정 + 사용량 인식 선택, 세션 친화(affinity), 차단·리셋 시각, 브로커/게이트웨이 (`docs/porting-from-pi-mono.md` §15).
- 재시도: `retry.fallbackChains`, `retry_fallback_applied/succeeded` 이벤트, 자동 재시도 이벤트. `docs/non-compaction-retry-policy.md` 존재.
- **프롬프트 캐시**: 이 부분이 가장 공들인 곳이다.
  - `AppendOnlyContextManager`: 시스템 프롬프트+도구 스펙을 **한 번 계산해 동결(StablePrefix)**, 메시지는 추가 전용 로그(AppendOnlyLog)로 이전 턴을 재직렬화하지 않음 (`AG/append-only-context.ts:1-40`) [원문].
  - `cache_warming_decision` 이벤트(확장이 예열 여부 결정), `cache-warmer.ts`, `providerPromptCacheKey` 상속, `system-prompt-digest`.
  - 효과 검증은 하지 않았다.
- 주의: provider 어댑터 중 `claude-code-fingerprint.ts`는 "Claude Code CLI 버전을 고정·추종(`DEFAULT_CLAUDE_CODE_VERSION`)"하고 `check-spoofed-versions` 스크립트가 있다고 주석에 적혀 있다. `openai-codex-attestation.ts`, `cowork-fetch.ts`도 있다 [원문 주석 일부]. 구독 제공자의 클라이언트로 위장하는 성격이면 약관 위험이 있다 [추측].

### 3.5 L1d 도구 디스패치·권한

- 도구가 `approval` 등급(`read`/`write`/`exec`)을 선언하고, 객체 형식은 `policy: allow|deny|prompt`, `override`, `policyKey`를 가진다. 선언 없으면 `exec`(안전 기본값). MCP 서버 도구는 서버 어노테이션과 무관하게 `write` (`docs/approval-mode.md:1-9`) [원문].
- 모드: `always-ask`, `always-ask-cached`(폴더·파일 단위 기억, `approval-cache.db`), `write`, **`yolo`(기본)**. `--yolo`/`--auto-approve`는 명시한 `--approval-mode`도 덮지만 도구·사용자 deny와 명시 prompt 규칙은 남는다 (`:11-20`). 사용자 규칙 `tools.approval.<tool>`이 모드와 무관하게 적용.
- 게이트 위치: **확장 래퍼** `ExtensionToolWrapper`가 유일한 승인 게이트(`CA/sdk.ts:3452` 주석) [원문]. 호출 시 `tool_call` 이벤트 → 승인 → 실행 → `tool_result`.
- `tool_call` 이벤트는 루프의 인자 준비 시점(동시성 스케줄링·`tool_execution_start`·승인 게이트 **앞**)에 발사되고, 수정된 입력은 스키마를 다시 검증해 "사용자가 승인하는 것이 실제 실행되는 것"이 되게 한다 (`shared-events.ts:339-353` 주석) [원문].
- 내장 방어: `bash-interceptor`(위험 명령), `conflict-detect`, `auto-generated-guard`, 읽기 전용 에이전트 판별 `isReadOnlyAgent`(알 수 없는 도구가 하나라도 있으면 읽기 전용 아님) (`task/read-only-policy.ts`).
- 승인 관련 이벤트 `tool_approval_requested/resolved`, `plan_review_requested/resolved`를 확장이 관찰.
- **기본이 yolo**라는 점은 pi와 같은 방향이지만, 문서에 "확장 실행 맥락에서 설정이 없으면 always-ask로 닫힘(fail-closed)"이 명시돼 있다 (`:7`) [원문].

### 3.6 L1e 컨텍스트 조립·컴팩션

- 컨텍스트 파일: AGENTS.md·CLAUDE.md·`.cursor`·Gemini·Codex·Windsurf·Cline·VSCode 등 **외부 도구 설정을 읽는 provider 20여 개**(`CA/discovery/*.ts`)가 `capability` 시스템으로 통합된다. 개별 항목은 `disabledExtensions: ["context-file:user:CLAUDE.md"]` 식으로 끈다 (`docs/extension-loading.md` 중반) [원문].
- 시스템 프롬프트: 정적 `.md` + Handlebars (AGENTS.md "Prompts" 규칙), 확장은 `before_agent_start`에서 `systemPrompt: string[]`(블록 배열)로 교체. pi는 문자열 하나 또는 구조화 옵션.
- 컴팩션 (`docs/compaction.md`): 요약 컴팩션, **snapcompact**(이력을 조밀한 비트맵 이미지로 보관), `shake`(기계적 내용 생략), 가지치기(`pruning.ts`), provider 네이티브 스트리밍 컴팩션(`compaction-v2-streaming.ts`, `openai.ts`), 핸드오프 생성. 엔트리 `compaction`에 `firstKeptEntryId, tokensBefore, details, preserveData, method, tokensAfter, providerReplayThroughEntryId` 등.
- 확장 개입: `session_before_compact`(결과 직접 제공/취소), `session.compacting`(`context: string[]`, `prompt`, `preserveData` 추가), `session_compact`, `auto_compaction_start/end`. 컴팩션 코드는 `packages/agent/src/compaction/`에 있어 agent 패키지 소속이다(pi는 coding-agent 소속).
- TTSR(Time Traveling Stream Rules): 스트리밍 중 규칙 패턴이 감지되면 스트림을 끊고 규칙을 주입한 뒤 재시도한다 (`docs/ttsr-injection-lifecycle.md`), `ttsr_injection` 엔트리와 `ttsr_triggered` 이벤트 [원문]. 컨텍스트 조립을 "생성 중 되감기"까지 확장한 설계다.
- 컨텍스트 도구: `checkpoint`/`rewind`, `context_notes`, `new_context` 가 내장 도구로 존재 (`CA/tools/index.ts:575-577`) [원문].

### 3.7 L1f 세션 영속성

| 항목 | omp | pi |
|---|---|---|
| 쓰기 | 동기 로컬 append, 첫 쓰기 전 지연 생성. 전체 재작성은 임시파일→rename + 크기 사전조건 | 동기 `appendFileSync` |
| fsync | **없음** ("software crash는 보호, 전원 손실은 아님", `docs/session.md:525`) | 없음 |
| 락 | ① 쓰기용 **세션 id 기반 OS 임대**(Linux는 abstract socket, Windows는 named mutex, macOS는 flock 사이드카), ② 게시용 교차 프로세스 publish lock | 세션 파일 락 없음 |
| 충돌 | 임대를 다른 프로세스가 쥐고 있으면 **새 형제 파일로 옮겨 쓰기**(`parentSession` 연결), 알림 이벤트 `SessionPersistenceNotice` (`:541`) | 대응 없음 |
| 실패 | append 실패는 래치해 한 번 로그, 턴에는 던지지 않음. 불확실하면 `SessionPersistenceIndeterminateError`로 fail-closed (`:550-552`) | 미확인 |
| 대용량 | 문자열 50만 자 초과 절단(서명·암호화 블록 제외), 이미지 base64는 `blob:sha256:` 외부화 | 인라인 |
| 외부 저장소 | `SessionStorage` 인터페이스 + 파일/메모리/SQL/Redis 구현(`sql-session-storage.ts`, `redis-session-storage.ts`, `indexed-session-storage.ts`) | 저장소 인터페이스 없음(private 생성자) |
| 분기 | 같은 파일 안 `branch`/`branchWithSummary`, 새 파일 `fork`, `reset_boundary`(/clear), `discardEntryDurably` | 같은 파일 분기 + 새 파일 분기 |
| 크래시 후 | 종료 시 `session_exit`(대기 중 도구 목록·비정상 종료 종류)를 남기고, 재개 때 **합성 aborted assistant 메시지**를 붙여 중단된 턴을 확정 (`:333`) | 마지막 줄 복구 정도 |
| 부작용 도구 결과 불명 | 위 합성 메시지 + `unpairedToolCallTail`로 **재실행 선택**(AgentSession.retry의 도구 재생). 도구별 멱등/재생 정책 표식은 발견 못함 | 동일 문제 있음 |
| 인덱스 | `history.db`(SQLite)에 제목·요약, 세션 목록·검색 | 없음 |
| 보관 | 아카이브, 압축(APFS/NTFS 투명 압축) GC | 없음 |
| 외래 세션 | Claude/Codex 세션 가져오기 (`foreign-session-*.ts`) | 없음 |

관찰: 쓰기 안전성은 pi보다 훨씬 두껍지만 **내구성(fsync)은 같은 수준**이다. 크래시 후 도구 결과 불명은 "중단으로 확정 + 재실행 선택지"로 처리하며 의도 선기록(pi-durable식 intent commit)은 없다 [원문+추측].

### 3.8 L1g 서브에이전트·멀티에이전트

**실행 위치**: 같은 프로세스·같은 메인 스레드. `task/executor.ts` 머리 주석 "In-process execution for subagents. Runs each subagent on the main thread and forwards AgentEvents" [원문]. 자식은 `initializeExtensions`·`ModelRegistry`·격리 `Settings` 오버레이를 받아 새 `AgentSession`이 된다. "자식 세션은 임포트된 확장 팩토리를 재사용하되 새 API와 등록을 바인딩하며, 모듈 레벨 변수는 공유된다" (`docs/extensions.md` 런타임 모델 절) [원문].

**정의**: 마크다운 프런트매터 에이전트(`~/.omp/agent/agents/*.md`, `.omp/agents/*.md`, 번들, 확장 루트). 필드: `name, description, systemPrompt, tools, spawns, model(우선순위 목록·@role 별칭), thinking-level, output(스키마), blocking, structured, autoloadSkills, prewalk, advisor` (`docs/task-agent-discovery.md:21-44`). `main`·`sub`는 예약어.

**권한·정책**
- `spawns`: `*`/목록/없음으로 이 에이전트가 소환 가능한 에이전트 제한 (`task/spawn-policy.ts`). 깊이 한도 `task.maxRecursionDepth`(`structured-subagent.ts:289`).
- 승인: 자식은 `tools.approvalMode: "yolo"` 고정. 근거 주석: "부모의 task 승인이 권한 경계이며 무인 실행을 보존하기 위함. 사용자 `tools.approval` 정책은 계속 적용" (`executor.ts:1180-1182`) [원문]. 즉 **권한 상속이 아니라 부모 `task` 도구의 `exec` 등급 승인으로 일괄 위임**한다.
- 도구: `tools` 생략 시 기본 세트, `tools: []`는 내장 없음. 구조화 자식은 `yield` 필수. MCP·확장·사용자 정의 도구는 추가로 얹힌다.
- 확장 개입: `before_subagent_spawn`이 `{model, block, reason, note}`를 반환해 모델을 바꾸거나 소환을 거부 (`EXT/types.ts:1568-1576`) [원문].

**결과 반환**: 자식이 `yield` 도구를 부르면 결과가 부모에 돌아온다(스키마 재시도 예산, 증분 yield, 워크풀 배치). 부모가 `blocking`이면 기다리고 아니면 비동기 잡. 출력 아티팩트·패치 경로는 에이전트 허브에서 확인.

**멀티에이전트 부가 기능**: 에이전트 레지스트리(`registry/agent-registry`), `AgentLifecycleManager`, IRC 에이전트 간 메시지(`irc/bus.ts`), 자식 영속·부활(`persisted-revive.ts`, `restore.ts`, `seance.ts`), 어드바이저 쌍(`advisor`), `prewalk`(첫 edit/write에서 다른 모델로 인계), Agent Hub TUI(`Alt+A`, 조종·재개·종료), `vibe` 모드(자식 세션 수명주기 영속·재생).

**격리**: `task.isolation`이 켜지면 작업 트리를 `pi-iso`로 복제해 자식이 거기서 작업하고, diff를 부모가 `git apply`로 병합하거나 거부한다 (`task/worktree.ts`, `isolation-runner.ts`) [원문: 구조 확인, 병합 규칙 세부 미조사].

### 3.9 L2 능력

**내장 도구** (`CA/tools/index.ts:558-595`)
- `BUILTIN_TOOLS` 30개: `read, security_scan, bash, edit, ast_grep, ast_edit, ask, debug, ida, eval, github, glob, grep, find, lsp, checkpoint, rewind, context_notes, new_context, task, wait, todo, web_search, write, memory_edit, retain, recall, reflect, learn, manage_skill`. 숨김 3개 `think, yield, goal`. README의 "31"과 1 차이(숨김 일부 포함 여부) [원문+추측].
- pi 대비 큰 차이: 편집 도구 **4변형**(`replace/patch/hashline/apply_patch`, 기본 hashline: 줄에 해시 태그를 붙여 편집) (`CA/edit/settings.ts:17-50`) + 모델별 변형 매핑 `edit.modelVariants`; AST 검색·편집, LSP(14 연산)·DAP(28 연산), `eval`(JS·Python 커널), `browser`/`puppeteer`, `computer`(데스크톱 제어), `github`/`glab`, 이미지 생성, `read`가 아카이브·PDF·SQLite·바이너리·`ssh://`·URL을 읽음, 내부 URL 프로토콜(`local://`, `agent://`, `artifact://`, `xd://`), 읽기 요약(read-summarize).
- 웹: `web_search`(Exa 등), `fetch`. pi는 fetch/검색을 확장이 맡는다.
- 파일 쓰기 폴백 `registerFileWriteFallback`(SSH 등 원격 FS 지원 훅) 같은 확장 지점이 도구 계층에 있다 (`EXT/types.ts` ExtensionAPI).

**MCP 브리지** (`CA/mcp/`)
- 전송 stdio/HTTP/SSE, OAuth 디스커버리·플로우, Smithery 레지스트리, 도구 캐시, 진행률 알림, 취소 알림(`notifications/cancelled`), 연결 끊김 중 중복 호출 방지(CHANGELOG [Unreleased]). 서버 도구는 승인 `write`. 확장은 `registerMcpServer`와 `mcp_notification` 이벤트를 쓴다. 문서 `docs/mcp-*.md` 4개 [원문].
- pi는 MCP를 내장 확장 `extensions/mcp`로 구현(`pi-report.md` 2.1). omp는 코어 안에 있다.

**지식·메모리**: `memory.backend`는 기본 `off`. `local`(세션에서 요약·교훈 생성해 시스템 프롬프트에 "Memory Guidance"로 주입), `hindsight`(원격), `mnemopi`(로컬 SQLite), `sharpshooter`(마찰 기반 결정 파일). 도구 `retain/recall/reflect/memory_edit/learn` (`docs/memory.md:1-30`). 로컬 소형 모델 기준 문서(`docs/local-models.md`)가 있다.

**스킬**: `SKILL.md` 계열 + skillshare(`packages/wire/src/skillshare.ts`), 슬래시 명령, 규칙(rulebook)·TTSR, `manage_skill` 도구로 에이전트가 스킬을 관리 [원문 파일 존재; 형식 세부 미조사].

### 3.10 확장 지점

**3.10.1 등록 단위** (pi와 거의 같음 + 확장)
- `ExtensionAPI` 메서드: `on`, `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`, `registerMessageRenderer`, `registerAssistantThinkingRenderer`, `registerComposerShape`, `registerFileWriteFallback`, `registerFileDeleteFallback`, `registerProvider/unregisterProvider`, `setLabel`, `sendMessage`, `sendUserMessage`, `appendEntry`, `exec`, `getActiveTools/getAllTools/setActiveTools`, `setModel`, `setThinkingLevel`, `setServiceTier`, `setSessionName`, `events`(EventBus) 등 (`EXT/types.ts:1700-1960`) [원문].
- 주입 모듈: `logger`, `typebox`, `arktype`, `zod`, `pi`(= coding-agent 전체 export).
- 확장 컨텍스트 `ExtensionContext`: `ui, mode, cwd, sessionManager(읽기 전용), modelRegistry, model, isIdle, abort, hasPendingMessages, shutdown, getContextUsage, getAsyncJobSnapshot, compact, getSystemPrompt, runEphemeralTurn?, memory?, annotations, setInterval/setTimeout(관리형 타이머), addAdditionalContext?, invokeTool?, agent(신원), isProjectTrusted` 등 (`EXT/types.ts:700-870`). 명령 컨텍스트는 추가로 `waitForIdle, newSession, branch, navigateTree, switchSession, reload` (`:~900`).

**3.10.2 이벤트 50종**
| 분류 | 이벤트 |
|---|---|
| 자원·세션(13) | `resources_discover`, `session_start`, `session_before_switch`, `session_switch`, `session_before_branch`, `session_branch`, `session_before_compact`, `session.compacting`, `session_compact`, `session_before_tree`, `session_tree`, `session_shutdown`, `session_stop` |
| 에이전트·턴·메시지(9) | `before_agent_start`, `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `assistant_message`(완성 메시지 텍스트 재작성) |
| 요청·provider(4) | `context`, `before_provider_request`, `after_provider_response`, `cache_warming_decision` |
| 도구(6) | `tool_call`, `tool_result`, `tool_execution_start/update/end`, `tool_approval_requested/resolved` |
| 사용자 입력(3) | `input`, `user_bash`, `user_python` |
| 복원력·상태(10) | `auto_compaction_start/end`, `auto_retry_start/end`, `retry_fallback_applied/succeeded`, `ttsr_triggered`, `todo_reminder`, `goal_updated`, `credential_disabled` |
| 계획·MCP·서브에이전트(4) | `plan_review_requested/resolved`, `mcp_notification`, `before_subagent_spawn` |
(합계가 50에 근접하는 분류. 개별 줄 확인: `EXT/types.ts:1648-1760`.)

pi에는 있으나 omp에는 없는 것: `project_trust`, `mcp_servers_change`, `session_info_changed`, `session_compact_failed`, `context_with_system`, `before_provider_headers`, `provider_stream_event`, `agent_before_settle`, `agent_settled`, `ui_prompt_start/end`, `model_select`, `thinking_level_select` (pi-ev.txt vs omp 이벤트 목록 대조). omp에만 있는 것: `assistant_message`, `before_subagent_spawn`, `session_stop`, `session.compacting`, `user_python`, 승인·계획 검토·재시도·TTSR·todo·goal·credential 이벤트 [원문 대조].

**3.10.3 강제 수준 5단계 분류**

| 단계 | omp에서 가능한 것 | 합성 규칙 | 근거 |
|---|---|---|---|
| 1 관찰 | 위 대부분 이벤트 | 순차 호출, 오류는 `emitError`로 보고하고 다음 핸들러 계속(fail-open), 30초 타임아웃 | `EXT/runner.ts:1552-1640, 1640-1700` |
| 2 차단 | `tool_call {block, reason}`; `session_before_switch/branch/compact/tree {cancel}`; `before_subagent_spawn {block}`; `session_stop` (정지를 막고 계속 — "차단"이 아니라 반대 방향); `input {handled}` | `tool_call`은 첫 `block`에서 즉시 반환. **핸들러 예외·타임아웃도 `block:true`로 환산(fail-closed)**, 외부 abort 시에도 차단 (`runner.ts:1869-1925`) | 같음 |
| 3 형성 | `context {messages}`, `before_agent_start {systemPrompt[], message}`, `before_provider_request`(payload 교체), `tool_call.input` 재작성(마지막 핸들러 승리, 핸들러들은 원본 입력을 봄), `tool_result {content,details,isError}` 체인, `assistant_message {content}`(텍스트만, 서명 무효화), `setActiveTools/setModel/setThinkingLevel/setServiceTier`, `before_subagent_spawn.model`, `session.compacting {context,prompt}`, `cache_warming_decision` | `additionalContext`는 모든 핸들러 것을 등록 순서로 누적(중복 제거), block이면 폐기 | `shared-events.ts:331-421` |
| 4 주입 | `sendMessage {deliverAs: steer\|followUp\|nextTurn\|aside, triggerTurn}`, `sendUserMessage`, `appendEntry`(LLM 컨텍스트 밖), `tool_call/tool_result.additionalContext`(개발자 우선 신뢰 지시, 다음 요청에 도구 결과 뒤에 배치), `session_stop.additionalContext` | aside는 진행 중 도구를 끊지 않고 다음 단계 경계에 삽입 | `EXT/types.ts:1848-1870` |
| 5 구동 | `ctx.runEphemeralTurn({promptText, history, tools:false, maxTokens, minimizeEffort, ...})`(세션 기록에 안 남는 곁 턴), 명령 컨텍스트 `newSession/branch/navigateTree/switchSession/reload/compact`, `session_stop continue`(상한 8), `ctx.compact`, `pi.exec` | 루프 함수 직접 호출은 아님. 곁 턴은 선택적(`runEphemeralTurn?`) | `agent-session-types.ts:595-621` |

관찰: pi 대비 **2단계(차단) 강제력이 올라갔다** — 타임아웃 포함 fail-closed가 코드와 주석에 명문화되고(이슈 #3948 언급) 사용자 설정 `extensionHandlers.toolCallTimeoutMs`(기본 30초, UI 대화 대기 시간은 미산입)로 조정된다 [원문].

**3.10.4 켜고 끄기(런타임 토글)**
| 동작 | omp | pi |
|---|---|---|
| 시작 전 끄기 | `--no-extensions`, `disabledExtensions: ["extension-module:<이름>"]`, `--trusted-extension <절대경로>`(허용 목록, 실패 시 시작 중단) | `pi config`, `-path`/`!glob` |
| 실행 중 개별 중단·재개 | **가능.** `extensions`/`disabledExtensions` 설정이 바뀌면 `reconcileExtensionSources`가 해당 확장의 핸들러·명령·도구·렌더러·단축키·플래그·파일 폴백을 `setSuspendedExtensions`로 일시 정지/재개. 내장 도구를 덮어쓴 확장이 정지되면 **원래 내장 도구를 복원** (`docs/extension-loading.md` "Live source changes", `CA/sdk.ts:5040-5120`) | 불가(전체 `reload()`만) |
| 한계 | 모듈을 언로드·재평가하지 않음. 시작 때 임포트하지 않은 모듈은 새로 켜도 **재시작 필요**(경고 알림). 인라인·SDK 선로드 확장은 대상 아님 | 해당 없음 |
| 전체 리로드 | `ctx.reload()` 있음 | 있음 |
| 설정 연동 도구 | 설정 게이트 내장 도구는 `reconcileBuiltinTools`/`cfgSessionToolGates.listen`으로 실시간 반영 (`CA/sdk.ts:4911-4921`) | 확장 `setActiveTools` |
| 플러그인 | `omp plugin` 설치·제거·활성/비활성(`plugins/toggle.ts`), 마켓플레이스 관리자, 닥터 | `pi install` |

**3.10.5 충돌·순서**
- 순서: 모듈은 병렬 임포트, **팩토리는 경로 순서대로 순차 실행**(`docs/extensions.md` 런타임 모델 1-2). 핸들러 호출 순서가 곧 확장 순서.
- 도구 우선순위: "RPC 호스트 도구, SDK 커스텀 도구, MCP 매니저 도구가 확장 도구보다 우선" (`CA/sdk.ts` reconcile 주석) [원문]. 같은 이름 확장끼리는 pi와 같이 나중 등록 승리로 보이나 확인하지 않았다 [추측].
- 의존 선언·서비스 레지스트리 없음. 확장끼리 협력은 `pi.events` EventBus와 세션 엔트리 공유 (pi와 같은 한계) [원문+추측].
- 레거시: `hooks` 서브시스템은 확장 러너로 합쳐졌고 `--hook`은 `--extension`의 별칭 (`docs/hooks.md:1-15`).

**3.10.6 실패 격리**
- 로드: 경로별 임포트·팩토리 오류를 모아 보고, 나머지 계속 (`docs/extension-loading.md` 머리).
- 실행: 핸들러별 try/catch → `emitError`; 타임아웃은 `handlerSignal` abort + 경고 로그 + `extension_error`. `session_shutdown`은 병렬 실행 + 2초 상한(Ctrl+C 인질화 방지, 이슈 #2600). 타이머는 `ctx.setTimeout/setInterval`로만 만들게 해 정리·격리.
- 등록 범위: 핸들러가 도중에 `registerTool` 해도 `ToolRegistrationScope`로 핸들러 종료 시 정리·플러시.
- **프로세스·권한 격리는 없다**: 확장은 호스트 프로세스에서 임의 코드를 실행하고 `pi` 객체로 전체 coding-agent export에 접근한다. 신뢰 경계는 "프로젝트 신뢰 확인"(`ctx.isProjectTrusted`)과 `--trusted-extension`뿐이다 [원문+추측].

**3.10.7 그 밖의 확장 표면**
- 도구 정의 `ToolDefinition`의 내부 `invokeTool`: 같은 이름 내장 도구에 위임(승인 상승 불가, 재귀 깊이 보호) (`EXT/types.ts:783-791`).
- 외부 도구 호스팅: RPC 모드에서 호스트 쪽이 도구를 등록(`hosttools`, `hosturis` in sdk/go) [원문 파일명].
- 슬래시 명령, 커스텀 TS 명령(`custom-commands`), `custom-tools`(구형 도구 정의 경로), 마켓플레이스, Claude 플러그인(`claude-plugins.ts`) 호환 로드.

---
## 4. 채택 판단

### 4.1 그대로 가져다 쓸 수 있는 것
| 대상 | 판단 | 이유·조건 |
|---|---|---|
| `@oh-my-pi/pi-wire` | 조건부 가능 | 의존 없는 JSON 타입 모음(2천 줄), MIT. 단 collab 프로토콜 한정이라 Helm 계약으로는 좁다. 계약을 따로 정의하는 편이 낫다 |
| `@oh-my-pi/snapcompact`, `@oh-my-pi/omptype` | 개별 평가 | 작고 MIT. 필요성은 Helm 요구 확정 후. `omptype`은 TypeBox 대체 후보이나 생태계 작음 |
| `crates/pi-iso`(격리 PAL) | **설계·코드 모두 유력** | 의존이 적은 Rust 크레이트, MIT, 플랫폼별 백엔드가 이미 있음. 단 N-API 래퍼(`pi-natives`) 없이 단독 쓰기 위해 크레이트 의존 확인 필요(미확인) |
| `crates/pi-diff`, `pi-edit`, `pi-walker`, `pi-vfs`, `pi-vcs` | 개별 평가 | 문서상 N-API 프리라고 한 것은 `pi-diff`, `pi-predict`. 나머지는 의존 그래프 미확인 |
| 이 저장소 전체(포크 기반 채택) | **비권장** | 51만 줄 TS + 35만 줄 Rust, 매주 변경, Bun 전용 |

- 라이선스: MIT이므로 복사·수정 가능, 저작권 고지 유지 필요. `THIRD-PARTY-NOTICES.txt`에 LGPL-3.0(sharp-libvips 플랫폼 바이너리), `deny.toml` 예외로 MPL-2.0(`uluru`), CDDL-1.0(`inferno`), WTFPL(`terminfo`)이 보인다 [원문]. 크레이트 단위로 쓰면 영향 범위를 개별 확인해야 한다.
- 패키지 경계 문제: `pi-agent-core`(`packages/agent/package.json`)는 `pi-ai, pi-catalog, pi-natives, pi-utils, pi-wire, snapcompact, @opentelemetry/api`에 의존, `main`이 `./src/index.ts`로 **TS 소스 배포**, `engines.bun`. Node 환경 단독 사용 불가 [원문]. pi의 agent-core(pi-ai만 의존)보다 훨씬 무겁다.

### 4.2 설계만 참고할 것
1. **프롬프트 캐시를 포맷·루프의 1급으로 다루기**: StablePrefix + 추가 전용 로그 + 시스템 프롬프트 digest 엔트리 + 캐시 키 상속. Helm이 caching을 설계 제약으로 삼는다면 가장 참고 가치가 크다.
2. **확장 핸들러 안전장치 묶음**: 타임아웃(+UI 대기 시간 제외 예산), `tool_call` fail-closed, 종료 핸들러 별도 짧은 상한, 관리형 타이머, 등록 범위 정리, 단일 승인 게이트를 확장 래퍼에 두기.
3. **런타임 개별 확장 정지·재개 모델**: 모듈은 유지하고 "참여 여부"만 토글, 내장 도구 복원 규칙, 새로 켜는 모듈은 재시작 요구. 단순하고 안전한 절충이다.
4. **단계 경계 주입의 `aside`** 개념과 `yield-queue`(종류별 묶음 + `isStale`).
5. **세션 쓰기 충돌 처리**: id 기반 임대 + 충돌 시 형제 파일로 이동 + 알림. 다중 프로세스 시나리오가 있으면 참고.
6. **합성 도구 결과/종료 진단**: 중단된 턴을 합성 aborted 메시지로 확정하는 재개 전략.
7. **승인 등급 선언(read/write/exec) + 안전 기본값(미선언=exec) + 모드 4종**. 서브에이전트에 부모 task 승인을 경계로 위임하는 단순화.
8. **세션 제목 고정 슬롯**처럼 "자주 바뀌는 메타를 전체 재작성 없이 갱신"하는 트릭.
9. **KDL로 모델·provider 호환 규칙을 데이터화**한 카탈로그 접근.
10. 작업 트리 격리를 PAL(백엔드 교체 가능)로 만든 구조.

### 4.3 피할 것
1. **거대 단일 클래스**: `agent-session.ts` 14,251줄, `agent-loop.ts` 4,092줄. 정책이 코어에 섞여 있어 확장 지점의 경계가 불분명하다 [원문 크기].
2. **기본 yolo + 같은 프로세스 확장**: 승인 기본값이 전부 허용이고 확장은 격리되지 않는다. Helm이 안전 기본값을 원하면 반대로 설계해야 한다.
3. **구독 OAuth/클라이언트 위장 어댑터**(Claude Code fingerprint, codex attestation 등): 약관·계정 위험, 외부 변경에 취약. 가져오지 말 것.
4. **다단계 호환 shim(레거시 pi, hooks, `.pi`/`.omp`, TypeBox/ArkType/Zod 동시 주입)**: 호환 부담이 API 표면을 키웠다. 새 설계는 한 가지 스키마만.
5. **변동 속도**: 매주 마이너 증가, CHANGELOG에 동작 변경이 많아 의존하면 추종 비용이 크다.
6. **fsync 없는 JSONL**: 쓰기 안전성에 투자했지만 내구성은 pi와 같다. 크래시 복구가 요구라면 의도 선기록 방식(pi-durable류)을 따로 설계.
7. 도구 수와 모드가 많은 UI 결합(상태줄, Agent Hub, TUI 오버레이)이 코어 패키지에 섞여 있는 점.

---
## 5. 다른 대상과 비교할 때 볼 특징

1. **"포크의 성장 경로" 표본**: pi와 같은 뼈대에서 출발해 정책을 코어에 흡수하는 방향으로 성장했다. pi가 같은 시기에 확장(Chord facet, durable)으로 분리하는 방향과 정반대다. 두 설계를 비교하면 "코어가 두꺼운 쪽 vs 합성 가능한 쪽"의 대비가 선명하다.
2. **확장 안전장치가 코어에 있음**: 타임아웃·fail-closed·개별 정지가 기본 기능. 반면 격리는 없다.
3. **프롬프트 캐시 보존이 세션 형식·루프·확장 API(`cache_warming_decision`)에 일관되게 스며 있음**.
4. **TTSR(스트림 중 되감기 규칙)**, **추측 실행**, **soft tool requirement**, **snapcompact**: 이 대상만의 고유한 루프·컨텍스트 아이디어.
5. **서브에이전트를 프로세스가 아니라 세션 객체로**: 같은 스레드, 정의는 프런트매터, 결과는 `yield`, 격리는 파일시스템 계층(`pi-iso`). 프로세스 분리형 대상과 대비된다.
6. **Rust 네이티브 코어(내장 셸·유틸·VCS·AST)**: OS 추상(L0)을 "호스트 도구에 의존하지 않는 내장 구현"으로 푼 점. 이식성이 높지만 유지 비용이 크다.
7. **외부 도구 설정 흡수(capability 시스템)**: Claude/Codex/Cursor/Gemini 등 20여 형식의 컨텍스트·스킬·MCP 설정을 읽는다. 상호운용 전략 비교 지점.
8. **한 줄 평가 [추측]**: 기능 폭과 방어 코드는 최상급이지만, 계약(F)이 문서가 아니라 코드에 흩어져 있고 변동이 심해 "참조 구현·아이디어 창고"로는 매우 가치 있으나 "의존 대상"으로는 부적합하다.
