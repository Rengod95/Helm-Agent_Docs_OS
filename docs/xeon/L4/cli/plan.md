---
id: L4.cli.plan
layer: L4
domain: cli
kind: plan
status: draft
depends_on: [L4.cli.spec, L4.host-service.plan, F.wire-settings.plan, eng.testing.guide, eng.toolchain.guide]
binds: [xeon/apps/cli/**]
---

# L4 CLI 구현 계획

`L4.cli.spec`을 구현하는 순서, 파일 배치, 테스트, 완료 기준을 정한다. 이름과 동작은 spec을 따르고, 이 문서는 다시 정하지 않는다.

## 1. 목표와 마일스톤 배치

| 마일스톤 | 목표 | 포함 |
|---|---|---|
| M0 | 없음. 현재 스캐폴드(`xeon/apps/cli`)를 유지한다 | M0 범위는 `contracts`, `ext-host`, `platform-store`, `platform-exec`다(`_research/foundation-plan.md` §5 P4). CLI 작업은 M1에 시작한다 |
| M1 | 걸어 다니는 골격의 입구. 모델 테이프로 `xeon chat` 한 턴, 강제 종료 뒤 재개 | `main.ts` 명령 분기, `chat -p`(in-process), `--json`, `--continue`/`--resume`, 최소 대화형, `config get`, `config schema`(로컬 명령), `version`, 저장소 유일의 scenario 테스트, 바이너리 빌드와 측정 |
| M2 | 세션·설정·비밀 관리와 승인 | `sessions`, `config set/reset/list`, `secret` 명령, `--set`, 슬래시 명령, 승인 프롬프트, `thread.locked` 프롬프트, `turn.interrupt` 연결, `host --stdio`(컴파일 바이너리 서브커맨드), `doctor`, TUI 채택 스파이크와 pi-tui 화면 |
| M3 | 서비스 | `service start/status/stop/ensure/launch-mode/run`, (선택) TUI 설정 목록 |

- [제안] M1 host 처리기는 다섯(`host.hello`, `thread.create`, `turn.start`, `events.subscribe`, `settings.get`)이다(`F.wire-settings.spec` §3.3.1의 [제안]. M1 범위는 `_research/foundation-plan.md` §5 P4). 그래서 M1 CLI는 이 다섯 메서드와 wire 없는 로컬 명령 `config schema`만 쓴다.
- M1의 stdio 진입은 개발 진입 `bun xeon/apps/host/src/main.ts host --stdio`(`L4.host-service.plan` H5)이고, 컴파일 바이너리의 `xeon host --stdio` 서브커맨드는 M2다.
- [제안] M1은 print 모드를 먼저 끝내고 대화형은 최소 renderer로 제한한다. 대화형 범위가 커져 M1이 밀리는 것을 막기 위해서다(§7).

## 2. 패키지와 파일 배치

### 2.1 목표 배치

```
xeon/apps/cli/
  package.json            # @xeon/cli, xeon.layer L4, xeon.domain cli
  tsconfig.json           # references: ../../packages/contracts, ../host (허용 목록 DR-10/cli-host)
  bunfig.toml             # [test] coverageThreshold = { lines = 0.5, functions = 0.5 }, coverageSkipTestFiles
  src/
    main.ts               # runCli, 최상위 진입(process.argv → runCli → process.exit)
    engine.ts             # connectEngine, EngineHandle, EngineStartError (spec §3.3)
    cli/command.ts        # CliCommand, UsageError, parseArgv
    commands/
      chat.ts             # chat: 대상 결정, 구독, turn.start, print/대화형 분기
      sessions.ts         # M2
      config.ts           # get·schema(M1), set/reset/list(M2)
      secret.ts           # M2
      service.ts          # start/status/stop/ensure/launch-mode/run (M3)
      host.ts             # host --stdio (M2, 컴파일 바이너리)
      doctor.ts           # M2
      version.ts          # M1
    render/
      model.ts            # TranscriptState, RenderOp, applyBatch, applyChunk
      transcript.ts       # 내구 이벤트 → RenderOp
      stream.ts           # 휘발 조각 → 진행 줄
      approval.ts         # ApprovalView, 승인 응답 (M2)
      tools.ts            # ToolResultRenderer, BUILTIN_TOOL_RENDERERS (read, ls, bash)
      text-sink.ts        # 제어 문자 없는 출력
      json-tap.ts         # observe 탭 → JSON Lines
    tui/
      minimal.ts          # 최소 renderer (node:readline + 진행 줄 한 줄)
      pi-tui.ts           # pi-tui 화면 (C8 통과 뒤)
      keybindings.ts      # l4.cli.keybindingsFile 읽기와 충돌 검사
    signals.ts            # Ctrl+C 계수, SIGTERM/SIGHUP, 종료 요청
    state.ts              # CliState 스키마, 읽기·원자 쓰기
    slash.ts              # 슬래시 명령 생성과 별칭 표 (M2)
    exit-codes.ts         # ExitCode, EXIT
    settings.ts           # defineSettings("l4.cli", …)
  test/
    *.test.ts             # unit
    *.int.test.ts         # int
    chat.scenario.test.ts # scenario (저장소 1개)
    fixtures/scenario-main.ts   # 테이프 모델을 넣은 조립으로 runCli를 부르는 자식 프로세스 진입
    tapes/*.tape.jsonl
```

### 2.2 현재 스캐폴드와의 차이

현재 상태(읽기만 했다):

| 항목 | 현재 | 목표 | 작업 |
|---|---|---|---|
| `package.json` `exports` | `".": "./src/index.ts"` | [제안] `".": "./src/main.ts"`. 다른 앱이 import하지 않으므로(DR-10) 테스트와 knip용이다 | C0 |
| `package.json` 의존 | `devDependencies: { "@types/bun": "catalog:" }`만 | `dependencies`: `@xeon/contracts`(`workspace:*`), `typebox`(`catalog:`), `@xeon/host`(`workspace:*`, 허용 목록 `DR-10/cli-host`, review.decisions-2 U-15). pi-tui는 C8 뒤 | C0, C8 |
| `src/index.ts` | `export {};` | 지우고 `src/main.ts`로 바꾼다 | C0 |
| `test/smoke.test.ts` | 진입 모듈 로드 확인 | `parse-chat-flags` 등 단위 테스트로 바꾼다 | C1 |
| `tsconfig.json` `references` | `[]` | `../../packages/contracts`, `../host` | C0 |
| `bunfig.toml` | 없음 | L4 임계 0.5/0.5(`eng.testing.guide` TS-10) | C0 |
| `dist/` | `tsc -b` 선언 출력(`dist/src/index.d.ts`, `dist/test/smoke.test.d.ts`) | 같은 디렉터리에 바이너리 `dist/<target>/xeon`도 둔다. 둘 다 커밋하지 않는다(`eng.toolchain.guide` TC-05) | C14 |
| `xeon.domain` | `cli` | 같음 | — |

- 이 문서 작성 중 코드는 고치지 않았다. 위 작업은 각 작업 id의 구현 단계에서 한다.

## 3. 작업 분해

규모: S(반나절 이하), M(1~2일), L(3일 이상).

| id | 내용 | 선행 | 규모 | 마일스톤 |
|---|---|---|---|---|
| C0 | 스캐폴드 정리: §2.2 표의 `package.json`, `tsconfig.json` references, `bunfig.toml`, `src/main.ts` 골격, `exit-codes.ts`, `settings.ts`(`l4.cli.*` 4키) | `F.wire-settings.plan` W12(전송 타입), settings `defineSettings` | S | M1 |
| C1 | 인자 파서와 명령 분기: `parseArgv`(spec §3.2) 전체 문법, 모드 결정(spec §4.2), 설정 키 형식 검사(`SETTING_KEY_PATTERN`, F wire §4.11), 비밀 값 argv 거부. M1 밖 명령은 "M2에서 제공" 한 줄과 1 | C0 | M | M1 |
| C2 | `chat -p`(in-process): `connectEngine`(spec §3.3, `startInProcessHost` + `createHostConnection` 조합, `AssembleError` → `EngineStartError` 변환), `thread.create`, `events.subscribe`, `turn.start`, 종료 판정(spec §3.6), `devWireRoundTrip` → `devChecks` 전달, `--json` 탭 연결 | C1, C3, `L4.host-service.plan` H2(`assemble`)·H3(`createHostConnection`)·H4(처리기) | M | M1 |
| C3 | renderer: `applyBatch`·`applyChunk`(내구·휘발 분리, 구간 검사, seq 중복 제거, `afterSeq` 지연), 도구 결과 3채널 규칙, `text-sink`, `json-tap` | C0 | M | M1 |
| C4 | 재개: `--continue`/`--resume`, CLI 상태 파일(spec §3.7) 원자 쓰기, `replay.outOfRange` 처리, 대화형의 접힌 이전 기록 | C2, C3 | M | M1 |
| C5 | `config get`: 텍스트·JSON 출력, `source`·`shadowed`·`locked`·`pendingUntil` 표시. `config schema`: `--scope <managed\|user\|project\|local>`, `--out`, `--core-only` 파싱과 `runHostCommand({ kind: "config-schema" })` 호출 | C2, `L4.host-service.plan` H8 | S | M1 |
| C6 | 최소 대화형: `node:readline` 입력, 진행 줄 한 줄 덮어쓰기, Ctrl+C 계수(`signals.ts`), SIGTERM·SIGHUP 종료 요청 | C3, C2 | M | M1 |
| C7 | scenario 테스트와 테이프: `chat.scenario.test.ts`, `fixtures/scenario-main.ts`, 테이프 2개(§5.2) | C2, C4, `@xeon/core-models/testing` 테이프, 조립 진입점의 테스트용 모델 주입 | M | M1 |
| C8 | TUI 채택 스파이크: `_research/notes/L4-1.md` §7의 1·6번, 한글 IME·CJK 폭 확인(macOS Terminal·iTerm2, Linux, WSL). 통과하면 `tui/pi-tui.ts` 화면과 키 바인딩 파일. 실패하면 결과를 spec §10 6번에 적고 최소 renderer 유지 | C6, 스택 추가 승인(TC-04) | M(스파이크) + M(화면) | M2(스파이크는 M1 말에 시작 가능, M1 완료 조건 아님) |
| C9 | `secret` 명령: 프롬프트(에코 없음, 2회 비교), stdin 읽기, 바이트 배열 0 덮기, `secret test` 출력, `secret reveal`(TTY 전용, review.decisions-2 U-20), JSON 탭 해제. wire는 값 없는 `secret.*`만 쓴다(spec §4.7) | C1, F `secret.*`(M2), `secret.beginReveal` F 추가(spec §10 3번), in-process 값 전달 API(spec §10 3번), `L0.secrets.plan` | M | M2 |
| C10 | `sessions ls/show/fork/rm` | C1, C3, host M2 처리기(`thread.list`, `thread.fork`, `thread.delete`, `events.unsubscribe`) | M | M2 |
| C11 | 승인 프롬프트와 `thread.locked` 프롬프트, Ctrl+C 1회 `turn.interrupt` | C6(또는 C8), host M2 처리기(`approval.respond`, `thread.open`, `turn.interrupt`), F 승인 kind | M | M2 |
| C12 | `service start/status/stop/ensure/launch-mode/run`(`runHostCommand` 호출, 종료 코드 그대로), `chat`의 서비스 접속(`resolveLaunchMode` → `ensureService` + `connectServiceTransport`) | C1, C2, `L4.host-service.plan` H10(`ensureService`, `startService`, `connectServiceTransport`)·H11(`service stop`)·H20(`resolveLaunchMode`, `service ensure --json`, `service launch-mode --json`) | S | M3 |
| C13 | `config set/reset/list`, `--set`, 슬래시 명령(`/set`, `/model`, `/resume`), `settings.list` 기반 미리 검사 | C5, C6, `L4.host-service.plan` H17(`settings.set/reset/list`) | M | M2 |
| C14 | 바이너리 빌드와 측정: 타깃 4개 빌드 레시피, 크기·기동 시간·시작 메모리 측정(§4.3) | C2 | S | M1 |
| C15 | `doctor`. 검색 provider 상태 묶음(spec §4.7.1) 포함 | C1, 진단 경로 결정(spec §10 5번), `L2.web.spec` provider 상태 조회 | S | M2 |
| C16 | 컴파일 바이너리의 `host --stdio` 진입: `runHostCommand({ kind: "host-stdio" })` 또는 `l4.cli.*` 그룹을 넘기는 `startStdioHost` 호출 | C1, `L4.host-service.plan` H5(stdio 진입, M1 개발 진입은 이미 있음) | S | M2 |

순서(M1): C0 → C1 → C3 → C2 → C5 → C4 → C6 → C7 → C14.

## 4. 채택 코드

### 4.1 그대로 쓰는 패키지

| 패키지 | 버전 | 고정 위치 | 쓰는 곳 | 비고 |
|---|---|---|---|---|
| `@xeon/contracts` | `workspace:*` | `apps/cli/package.json` | wire·settings·conversation 타입, `SETTING_KEY_PATTERN` | F |
| `typebox` | 1.4.2 | 루트 catalog | `CliStateSchema`, 미리 검사(`typebox/schema` `Check`) | [미결] pi-ai 1.3.0이 고정한 1.3.27과의 중복(`eng.toolchain.guide` 1.1절) |
| `@earendil-works/pi-tui` | 1.3.0 정확 고정 | 루트 catalog(C8 통과와 승인 뒤 추가) | 대화형 화면 | pi-ai·agent-core 1.3.0과 같은 릴리즈 묶음(`_research/notes/L4-1.md` §2). 배포물에 MIT 고지를 함께 싣는다 |
| `get-east-asian-width` | 1.6.0 | pi-tui 전이 의존. 최소 renderer가 직접 쓰면 catalog에 같은 값 | CJK 폭 | pi-tui 1.3.0 의존과 같은 값 |
| `marked` | 18.0.11 | pi-tui 전이 의존 | Markdown 렌더 | 직접 import하지 않는다 |
| `@xeon/host` | `workspace:*` | `apps/cli/package.json`(허용 목록 `DR-10/cli-host`) | `resolveLaunchMode`, `startInProcessHost`, `startStdioHost`, `ensureService`, `runHostCommand`(`.`), `createHostConnection`, `connectServiceTransport`(`./client`) | `L4.host-service.spec` §3.3, §3.3.5. 선행 작업은 `L4.host-service.plan` H2~H5, H8, H10, H20 |

- 버전 고정 방식: 모든 외부 패키지는 루트 catalog에 정확 버전으로 둔다(`eng.toolchain.guide` TC-01, TC-02). pi-tui는 pi-ai·agent-core를 올릴 때 같은 묶음 버전으로 함께 올린다 [제안].
- 인자 파서, 프롬프트, 진행 줄은 외부 패키지 없이 쓴다 [제안](spec §3.2).

### 4.2 구조만 참고하는 원본

| 원본 | 경로 | 가져오는 것 | 바꿀 점 |
|---|---|---|---|
| omp `config` 명령 | omp `docs/config-usage.md`(`_research/refs/oh-my-pi.md` 43행), `_research/settings.md` §1, §3 [S36] | `list/get/set/reset` 네 동작, 정의에서 값 파싱 | 값 검사는 F `checkSettingWrite`(host), 출처는 `EffectiveSetting.source`. omp의 `path` 대신 `source.path` 출력 |
| pi print 모드 | `~/projects/_ref/pi-src/packages/coding-agent/src/modes/print-mode.ts` | 단발 실행 구조, SIGTERM 143·SIGHUP 129(60행) | 세션 객체 대신 `HostConnection` |
| pi JSON 모드 | `~/projects/_ref/pi-src/packages/coding-agent/src/modes/json-event.ts` | stdout JSON 한 줄 한 이벤트 | 자체 이벤트 모양 대신 JSON-RPC 메시지 그대로(spec §4.4의 탭) |
| pi 대화형 모드 | `~/projects/_ref/pi-src/packages/coding-agent/src/modes/interactive/` | 화면 구성, 입력 처리 순서 | 확장 UI 컴포넌트 계약(`ctx.ui.custom`)은 두지 않는다 |
| pi-tui 컴포넌트 | `~/projects/_ref/pi-src/packages/tui/src/components/{editor,markdown,select-list,settings-list,loader}.ts`, `src/keybindings.ts` | 패키지로 쓰므로 포크하지 않는다. 키 바인딩 파일 형식 확인 | — |
| pi-tui 애드온 로더 | `~/projects/_ref/pi-src/packages/tui/src/native-module-path.ts` | 사이드카 `native/` 후보 경로(`process.execPath` 기준) | 1차 배포는 애드온 없음(spec §4.9.2) |
| pi 바이너리 빌드 | `~/projects/_ref/pi-src/scripts/build-binaries.sh` | 타깃 목록, 플랫폼별 아카이브 | Bun 1.4.3, `-baseline` 접미사 없이 타깃 이름만(`_research/notes/L4-1.md` §4) |

### 4.3 빌드

[결정] 바이너리는 `bun build --compile`로 만든다(`eng.toolchain.guide` TC-10).

| 타깃 | 산출 위치 | 단계 |
|---|---|---|
| `bun-darwin-arm64` | `apps/cli/dist/darwin-arm64/xeon` | M1 |
| `bun-darwin-x64` | `apps/cli/dist/darwin-x64/xeon` | M1 |
| `bun-linux-x64` | `apps/cli/dist/linux-x64/xeon` | M1 |
| `bun-linux-arm64` | `apps/cli/dist/linux-arm64/xeon` | M1 |
| `bun-windows-x64` | `apps/cli/dist/windows-x64/xeon.exe` | 나중(Windows 네이티브는 나중, `_research/decisions-log.md` 2026-10-19) |

- 명령 [제안]: `bun build --compile --target=<타깃> --minify apps/cli/src/main.ts --outfile apps/cli/dist/<타깃 접미사>/xeon`. 레시피 이름은 `just build-cli [타깃]`으로 제안하고, justfile 변경은 툴체인 담당에 요청한다(TC-09).
- `--bytecode`: 시작 속도 개선 사례가 있다(`_research/stack-status.md` §7-C). C14에서 켠 것과 끈 것을 함께 측정하고, 오류 스택·소스맵과의 호환을 확인한 뒤 정한다 [미결].
- 산출물은 커밋하지 않는다(`eng.toolchain.guide` TC-05). `apps/*/dist/`를 `.gitignore`가 덮는지 C14에서 확인한다.
- 엔진 바이너리 이름과 진입(`apps/cli/src/main.ts`)은 [제안]이다. `L4.host-service.spec`이 다른 진입을 정하면 이 표를 고친다.
- 측정(C14): 공식 크기 수치가 없다(`_research/stack-status.md` §7-C "still way too big"). 타깃별 바이너리 크기, `xeon version` 기동 시간(20회 중앙값), `xeon config get` 기동 시간과 시작 RSS를 잰다. 측정 스크립트는 `xeon/scripts/`에 두고 새 도구를 들이지 않는다(TC-04). 결과는 이 문서 §4.3에 표로 더한다.

## 5. 단위 테스트 목록

### 5.1 unit·int

태그는 파일 이름 접미사로 정한다(`eng.testing.guide` TS-01).

| 테스트 이름 | 파일 | 태그 | 확인할 동작 | 마일스톤 |
|---|---|---|---|---|
| parse-chat-flags | `test/parse-chat-flags.test.ts` | unit | `chat`, `-p <입력>`, `-p -`, `--json`, `--continue`, `--resume <id>`가 `ChatCommand`로 바뀐다. `--json` + 대화형은 `jsonRequiresPrint`, `--continue` + `--resume`는 `conflictingFlags` | M1 |
| parse-set-override-session-scope | `test/parse-set-override.test.ts` | unit | `--set a.b.c=1`이 `SessionOverride`가 되고, 키 형식이 틀리면 `invalidSettingKey`, `=`가 없으면 `invalidOverride`. 값 해석(JSON 우선, 실패하면 문자열)이 F wire §4.11과 같다 | M1(파서), M2(실행) |
| config-get-prints-source | `test/config-get.test.ts` | unit | 가짜 `HostConnection`의 `settings.get` 결과로 텍스트 출력에 `source.scope`·`source.path`·`locked`·`shadowed`·`pending`이 나오고, `--json` 출력이 결과 배열과 같다 | M1 |
| config-set-uses-checkSettingWrite | `test/config-set.test.ts` | unit | 같은 `SettingDef`와 값에 대해 CLI 미리 검사(`SettingDefWire` + range 병합 + `Check`)의 통과 여부가 `checkSettingWrite`의 `settings.invalidValue` 판정과 같다(고정 시드 속성 테스트, TS-09). `kind`별 오류 문구와 종료 코드가 spec §4.10 표와 같다 | M2 |
| secret-add-rejects-argv-value | `test/secret-argv.test.ts` | unit | `secret add n v`, `secret set n --value v`, `secret add n=v`가 `secretValueInArgv`(2)이고, 오류 출력에 `v`가 없다 | M1(파서), M2(명령) |
| json-mode-equals-host-messages | `test/json-mode.int.test.ts` | int | 테이프 모델 조립으로 `chat -p --json`을 in-process로 돌리면 stdout 줄 열이 `observe` 탭이 받은 메시지 열과 같다(spec AC4) | M1 |
| non-tty-disables-tui | `test/non-tty.test.ts` | unit | stdin 비TTY면 print 모드, stdout 비TTY면 출력에 0x1B가 없다. `NO_COLOR`, `TERM=dumb`이면 대화형에서도 색 없음 | M1 |
| exit-code-for-lock-denied | `test/exit-codes.test.ts` | unit | `turn.start`가 `thread.locked`를 돌려주면 M1은 4. 그 밖의 kind와 `EngineStartError`가 spec §3.6·§4.10 표의 코드로 바뀐다(`catalogConflict`·`missingService`는 1, 나머지는 3). `runHostCommand`의 0·1·2는 그대로다 | M1 |
| dev-wire-round-trip-passed | `test/engine-options.test.ts` | unit | 개발 빌드 조건(`XEON_DEV=1` 또는 소스 실행)에서 `connectEngine`이 `startInProcessHost`에 `devChecks: true`를 넘기고, 컴파일 바이너리 조건에서 `false`를 넘긴다. 가짜 `@xeon/host` 함수로 인자를 기록한다(spec AC11) | M1 |
| usage-error-two-lines | `test/usage-error.test.ts` | unit | 사용법 오류 코드 각각에서 stderr 출력이 `xeon: …`와 `  해결: …` 두 줄이고 종료 코드가 2다(spec AC12, §4.10) | M1 |
| sigint-once-interrupts-turn | `test/signals.test.ts` | unit | 주입한 시계로 Ctrl+C 1회(turn 진행 중)는 M2에서 `turn.interrupt`를 한 번 보내고, 2초 안 2회는 종료 요청과 130, 3회는 강제 종료다. M1 설정에서는 1회가 종료 요청이다 | M1, M2 |
| transcript-replay-from-cursor | `test/transcript.test.ts` | unit | 위치 k에서 시작한 `applyBatch`가 seq ≤ k 이벤트를 무시하고, `from` 불일치에 `gap`을 돌려주고, 같은 item의 `item.recorded`가 오면 진행 줄을 지운다. `afterSeq` 지연 조각이 위치 도달 뒤 적용된다 | M1 |
| no-secret-in-output | `test/no-secret.int.test.ts` | int | 비밀 참조 1종을 쓰는 테이프 한 턴과(M1) `secret add/test/ls`(M2)에서 값과 base64·hex 형태가 stdout·stderr·임시 DB 파일·상태 파일에 없다(spec AC5) | M1, M2 |

추가 unit [제안]: `tool-renderers`(read·ls·bash의 `details` 표시, 렌더러가 없을 때 `content` 20줄), `state-file`(깨진 파일 버림, 원자 쓰기), `keybindings-conflict`(충돌 목록 출력). 이 셋은 위 목록의 이름 규칙을 따른다.

### 5.2 scenario

- 파일: `apps/cli/test/chat.scenario.test.ts` 하나. 저장소 전체의 유일한 scenario다(`eng.testing.guide` TS-01).
- 실행: 자식 프로세스로 `bun test/fixtures/scenario-main.ts`를 띄운다. 이 진입은 테스트 파일이므로(DR-08) `startInProcessHost`의 `extraPlugins`에 테이프 모델을 넣은 `connectEngine`으로 `runCli`를 부른다. 테스트용 조립의 이름과 위치는 `L4.host-service.plan`이 정한다 [미결].
- 자식 프로세스 spawn과 DR-07: DR-07은 `Bun.spawn`을 L0 패키지에만 허용한다. 이 테스트의 spawn은 `L4.desktop.plan` R10과 같은 하나의 결정(허용 목록 항목 또는 `platform-process`의 `testing` 도우미)을 따른다. 결정 전까지 이 항목은 M1 완료를 막는 사람 확인 항목이다.
- 테이프:
  - `tapes/chat-first.tape.jsonl`: turn 1은 `read` 도구 호출, turn 2는 `stall`(`eng.testing.guide` TS-04).
  - `tapes/chat-continue.tape.jsonl`: 텍스트 응답 하나.
- 절차:
  1. 임시 데이터 디렉터리로 `chat -p "<입력>" --json`을 띄우고, stdout에서 `read`의 `effect.result`가 담긴 `events.batch`가 나올 때까지 조건 대기한다(폴링 + 상한, TS-03).
  2. 자식을 SIGKILL한다. 받은 마지막 seq를 기억한다.
  3. 같은 디렉터리로 `chat --continue -p "<입력>" --json`을 띄워 끝까지 받는다.
  4. 확인: 종료 코드 0, 같은 `threadId`, 새로 받은 seq가 모두 기억한 seq보다 크고 중복 없음, 새 turn `completed`(spec AC1·AC2). 이전 turn의 종결 상태는 엔진 복구 규칙에 따른다 [가정].
- 결정성은 D1이다. 특정 이벤트열을 바이트로 비교하지 않는다(TS-08 3번).

## 6. 완료 기준

- M1
  - `cd xeon && just verify`가 종료코드 0이다.
  - `chat.scenario.test.ts`가 통과한다(테이프 한 턴, 강제 종료 뒤 재개).
  - §5.1의 M1 테스트가 모두 통과하고, `apps/cli/bunfig.toml`의 커버리지 임계 lines 0.5, functions 0.5를 넘는다(`eng.testing.guide` TS-10).
  - 4개 타깃 바이너리가 만들어지고 §4.3의 측정 표가 채워져 있다. 바이너리는 커밋되어 있지 않다.
  - spec AC1~AC4, AC7, AC10~AC12가 테스트로 확인된다.
- M2
  - §5.1의 M2 테스트와 spec AC5·AC6·AC8·AC9가 통과한다.
  - C8 결과가 spec §10 6번에 반영되어 있다(채택 또는 [미결] 유지).
  - 같은 테이프와 입력으로 CLI(in-process)와 `host --stdio`의 메시지 열이 같다(`product.scope.spec` M2 행). 이 비교 테스트의 소유는 `L4.host-service.plan`이다.
- M3
  - `service start/status/stop`이 `L4.host-service.plan`의 서비스 체크리스트 테스트와 함께 통과한다.

## 7. 위험과 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| pi-tui 네이티브 애드온이 compile 바이너리에서 로드되지 않는다 | Shift+Enter(Apple Terminal), 네이티브 클립보드가 빠진다 | 애드온은 선택 기능이고 폴백이 있다(`_research/notes/L4-1.md` §3). 1차 배포는 애드온 없이 낸다. 필요해지면 사이드카 `native/` 디렉터리(pi 방식)를 쓴다. 단일 파일이 필수면 로더 후보 경로 한 곳만 바꾸는 얇은 포크(같은 문서 §5.3 B1) |
| pi-tui 자체가 Bun 1.4.3 `--compile`에서 동작하지 않는다 | 대화형 TUI 지연 | M1은 pi-tui 없이 통과한다(최소 renderer). C8 실패 시 최소 renderer를 유지하고 라이브러리 선택을 [미결]로 둔다 |
| pi-tui 버전 어긋남 | 참조 트리 1.1.0과 npm 1.3.0의 차이, CHANGELOG 없음 | 1.3.0을 정확 고정하고 pi-ai·agent-core와 같은 묶음으로만 올린다. 소스 확인은 1.3.0 tarball 기준 |
| CJK 폭 계산과 IME 후보 창 위치 | 한글 줄바꿈 깨짐, 입력 위치 어긋남 | C8에서 macOS·Linux·WSL 터미널로 확인. `Focusable`과 `showHardwareCursor` 설정. 최소 renderer는 터미널 줄 편집을 그대로 쓴다 |
| `--bytecode`와의 호환 | 기동 실패나 스택 정보 손실 | C14에서 켠 것과 끈 것을 비교하고, 문제가 있으면 끈다 |
| M1 대화형 범위가 커진다 | M1 지연 | print 모드를 먼저 끝내고(C2·C3·C4), 대화형은 C6 범위(한 줄 입력, 진행 줄)로 제한한다. 화면 기능은 M2 C8로 넘긴다 |
| 승인 wire가 사용자 확인에서 바뀐다(A안은 review.decisions-2 U-02로 잠정 결정) | C11 재작업 | C11을 M2에 둔다. `ApprovalView` 변환 함수 하나에 payload 의존을 모아 바뀌는 범위를 줄인다 |
| 허용 목록 `DR-10/cli-host`(review.decisions-2 U-15)가 사용자 확인에서 바뀐다 | C2·C7 재작업 | spec §3.3의 `ConnectEngine` 가짜를 먼저 두고 C1·C3·C5의 단위 테스트를 진행한다. 실제 `@xeon/host` 연결은 그 뒤 붙인다 |
| M1 wire에 `turn.interrupt`·`thread.open`이 없다 | M1 Ctrl+C와 재개 동작 제한 | spec §4.6, §4.4의 M1 동작(종료 요청, `turn.start`의 암묵 획득 `L4.host-service.spec` HS-28)으로 통과하고, 필요하면 F 변경 요청(spec §10 2번) |
| macOS FTS5 | M1 시작 실패(종료 코드 3) | `@xeon/host`가 `AssembleError { code: "store" }`를 던지고 `connectEngine`이 `fts5Missing`으로 바꿔 해결 한 줄을 보인다(TC-11). 해결책은 `L0.store.spec`이 정한다 |
