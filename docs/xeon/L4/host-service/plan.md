---
id: L4.host-service.plan
layer: L4
domain: host-service
kind: plan
status: draft
depends_on: [L4.host-service.spec, F.wire-settings.plan, eng.testing.guide, eng.toolchain.guide]
binds: [xeon/apps/host/**]
---

# L4 호스트와 서비스 구현 계획 (host-service)

`L4.host-service.spec`을 `xeon/apps/host`(`@xeon/host`) 코드로 옮기는 계획이다. 규칙 번호(HS-NN, SV-NN, AH-NN)는 그 스펙의 것이다.

## 1. 목표와 마일스톤 배치

마일스톤 정의는 `product.scope.spec` §4.3을 따른다. M0·M1은 [결정: `_research/foundation-plan.md` §5 P4], M2·M3 배치는 [제안]이다.

### 1.1 M0

- 이 패키지의 구현 작업은 없다. M0 산출물(`contracts`, `ext-host`, `platform-store`, `platform-exec`)이 M1 작업의 선행 조건이다.
- 선행 조건 목록:
  - `@xeon/contracts/wire`, `@xeon/contracts/settings`의 M0 범위(`F.wire-settings.plan` §1.1).
  - `ext-host`의 루트 컨텍스트 생성과 플러그인 등록 API(`X.loading-trust.plan`).
  - `platform-store`의 `headSeq`, 구간 읽기, 커밋 후 알림, 세션 잠금(`L0.store.plan`).

### 1.2 M1: `xeon chat` 걸어 다니는 골격

- in-process 전송 쌍(`transport/in-process.ts`)과 클라이언트 `createHostConnection`.
- 처리기 5개: `host.hello`, `thread.create`, `turn.start`, `events.subscribe`, `settings.get`. 알림 `events.batch`, `stream.chunk`, `$/cancelRequest`. 나머지 메서드는 `notImplemented`.
- stdio 전송 팩토리(`transport/stdio.ts`)를 `startStdioHost`에 연결하고 `WIRE_CONFORMANCE_CASES`를 in-process와 stdio에서 통과한다(AH-02).
- M1의 stdio 진입은 개발 진입 `bun xeon/apps/host/src/main.ts host --stdio`(`L4.host-service.plan` H5)이고, 컴파일 바이너리의 `xeon host --stdio` 서브커맨드는 M2다. `L4.desktop.plan` D1은 이 개발 진입을 자식 프로세스로 띄워 적합성 테스트를 돈다.
- `assemble` 최소형: M1에 존재하는 패키지만 싣는다. 테스트용 그룹(on/post/drive 사용)과 모델 테이프 provider를 `extraPlugins`로 받는다.
- 카탈로그 조립과 기동 거부(`CatalogIssue`), `xeon config schema`.
- `apps/cli`의 `chat.scenario.test.ts`(저장소 유일한 scenario 테스트, `eng.testing.guide` TS-01)가 이 호스트로 동작한다.

### 1.3 M2: 데스크톱 사이드카와 나머지 처리기

- 나머지 처리기: `thread.open`/`close`/`list`/`fork`/`revert`/`delete`, `turn.interrupt`, `events.unsubscribe`, `approval.respond`, `settings.set`/`reset`/`list`, `host.status`.
- `thread.open` 잠금과 `thread.locked` 대안, 임대 토큰(`LeaseToken`) 전달과 `sys_leases` 소유 표시 읽기.
- stdio 호스트의 종료 절차(HS-31~HS-34)와 컴파일 바이너리 spike(H15). 데스크톱 사이드카(`L4.desktop.plan`)가 이 경로를 쓴다.
- 전송 동등성 테스트(AH-01)를 같은 모델 테이프로 확정한다(`product.scope.spec` §4.4 M2 조건).

### 1.4 M3: 서비스 모드

- socket 전송, 등록 파일, `ensure`, 기동 경합, 버전 불일치, 유휴 종료, 종료 협조, 인증, 부모-자식 수명(SV-01~SV-08).
- 예약 틱 호스팅(HS-39~HS-41)과 알림 라우팅(HS-42).
- `xeon service start|status|stop|ensure|launch-mode|run` 서브커맨드의 호스트 쪽 함수(spec §3.2).

### 1.5 M3 이후

- [결정: review.decisions-2 U-11] 원격 사용(M3)은 로컬 서비스 소켓을 SSH 터널·사설망으로 연결하므로 새 전송 파일이 없다. 내장 TLS + 토큰 WebSocket(`transport/websocket.ts`)은 2차다.
- 2차: `xeon service install`/`uninstall`(launchd, systemd 사용자 단위). 이 패키지가 아닌 `L0.os`·`L4.cli` 작업으로 둔다.

## 2. 패키지와 파일 배치

```
xeon/apps/host/
  package.json             # exports ".", "./client". xeon.layer L4
  tsconfig.json            # references: 의존 패키지 전부(DR-04)
  bunfig.toml              # [test] coverageThreshold = { lines = 0.5, functions = 0.5 }
  schema/
    settings.managed.schema.json  settings.user.schema.json
    settings.project.schema.json  settings.local.schema.json   # renderSettingsSchema --core-only 커밋본
  src/
    index.ts               # "." 공개 진입점
    client.ts              # "./client": createHostConnection, connectServiceTransport
    assemble.ts            # assemble, Engine, EnginePorts와 어댑터, AssembleError
    main.ts                # startInProcessHost, startStdioHost, runHostCommand, import.meta.main 개발 진입
    connection.ts          # createConnectionHub, 연결 상태 기계, 처리 순서(F wire §4.3), 송신 큐
    settings.ts            # hostSettings, renderSettingsSchema, resolveLaunchMode
    transport/
      in-process.ts        # InProcessTransportFactory
      stdio.ts             # StdioTransportFactory (JSON Lines)
      socket.ts            # SocketTransportFactory 구현, listenServiceSocket
    handlers/
      index.ts             # createWireHandlers, notImplemented
      host.ts              # host.hello, host.status
      thread.ts            # thread.*
      turn.ts              # turn.start, turn.interrupt
      events.ts            # events.subscribe/unsubscribe, 재전송(HS-10~HS-16), stream.chunk(HS-17~HS-20)
      approval.ts          # approval.respond
      settings.ts          # settings.get/set/reset/list
    service/
      registration.ts      # ServiceRegistrationSchema, read/write/removeRegistration
      ensure.ts            # ensureService, 자기 실행 명령
      lifetime.ts          # startService, decideIdle, 종료 협조, SERVICE_STARTUP_GRACE_MS
      auth.ts              # 소켓 디렉터리·파일 권한 설정과 검사
      schedule-tick.ts     # L2.schedule 틱 시작·정지, scheduler 실행권
      notify.ts            # 알림 라우팅(HS-42)
  test/
    *.test.ts              # unit
    contract/              # *.contract.test.ts, conformance-runner.ts
    int/                   # *.int.test.ts (자식 프로세스, 실제 SQLite·소켓)
    fault/                 # *.fault.test.ts (강제 종료 뒤 재개)
    fixtures/              # 요청 열, 모델 테이프 경로
```

`package.json` 목표 모양:

```jsonc
{
  "name": "@xeon/host",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts", "./client": "./src/client.ts" },
  "dependencies": {
    "@xeon/contracts": "workspace:*",
    "@xeon/ext-host": "workspace:*",
    "@xeon/platform-store": "workspace:*",
    "@xeon/platform-process": "workspace:*",
    "@xeon/platform-os": "workspace:*",
    "@xeon/core-tasks": "workspace:*",
    "@xeon/core-loop": "workspace:*",
    "@xeon/core-persistence": "workspace:*",
    "typebox": "catalog:"
    // M1: M1에 존재하는 platform-*, core-*, cap-workspace만. M2 이후 group-*, cap-* 추가
  },
  "devDependencies": { "@types/bun": "catalog:" },
  "xeon": { "layer": "L4", "domain": "host" }
}
```

- [제안] `client.ts`는 `@xeon/contracts`만 import한다. 연결 계층 코드에서 엔진 패키지가 끌려오지 않게 하기 위해서다. 검사는 H3의 import 검사 테스트로 한다.
- 테스트의 자식 프로세스 [미결]: `int`·`fault` 테스트는 `service run`, `host --stdio` 자식을 띄운다. DR-07은 `Bun.spawn`을 L0 패키지에만 허용하므로 `L4.desktop.plan` R10과 같은 하나의 결정(허용 목록 항목 또는 `platform-process`의 `testing` 도우미)을 따른다. 테스트 코드는 spawn을 `test/fixtures/spawn-host.ts` 한 곳에 모아 결정이 바뀌어도 고칠 곳을 하나로 둔다 [제안].
- 조립 루트 예외(DR-14 예외 2)로 `assemble.ts`는 모든 패키지를 import한다. 처리기(`handlers/*`)와 `connection.ts`는 `EnginePorts`만 쓰고 아래 층 패키지를 import하지 않는다 [제안]. 어댑터가 `assemble.ts` 한 곳에 모이므로 L1 서비스 이름이 바뀌어도 고칠 곳이 하나다.

현재 스캐폴드와의 차이(코드는 이 문서 작업에서 고치지 않는다):

| 항목 | 현재 스캐폴드 | 이 계획 | 처리 |
|---|---|---|---|
| `src/` | `index.ts` 하나(`export {}`) | 위 파일 배치 | H2~H14 |
| `exports` | `"."`만 | `"."`, `"./client"` | H3 |
| `dependencies` | 없음. `devDependencies`에 `@types/bun`만 | 워크스페이스 의존과 `typebox` | H2 |
| `tsconfig.json` `references` | `[]` | 의존 패키지와 같은 집합(DR-04) | H2 |
| `bunfig.toml` | 없음 | L4 임계 0.5/0.5(`eng.testing.guide` TS-10) | H2 |
| `test/` | `smoke.test.ts`(진입점 로드) | 유지. unit, `contract/`, `int/`, `fault/` 추가 | H4~ |
| `xeon.domain` | `"host"` | `"host"` 유지. routes.yaml 도메인은 `host-service`(spec §10 미결 18) | 없음 |
| `schema/` | 없음 | 설정 스키마 커밋본 네 파일 | H8 |

## 3. 작업 분해

규모: S(하루 이하), M(2~3일), L(4일 이상). 선행 작업에 다른 패키지 plan의 작업을 적을 때는 문서 id를 붙인다.

| id | 내용 | 선행 | 규모 | 마일스톤 |
|---|---|---|---|---|
| H1 | 조립 위치 결정 반영([결정: review.decisions-2 U-15]). 허용 목록 `DR-10/cli-host`, `eng.dependency-rules.guide` DR-10·DR-14 문구, `architecture.layers.spec` §3.2 L4 부분을 같은 커밋에서 고친다. `check-layers.ts`가 허용 목록을 읽도록 고치는 작업은 툴체인 작업자 몫(`eng.dependency-rules.guide` §5 현재 상태와의 차이) | review.decisions-2 U-15 | S | M1 |
| H2 | `assemble` 최소형. 루트 컨텍스트, M1 플러그인 등록, 포트 어댑터, 서비스 확인, `Engine.close` 역순 정리, `AssembleError`. `package.json`·`tsconfig.json`·`bunfig.toml` 정비 | M0 전부, `X.loading-trust.plan`의 루트 생성 API | M | M1 |
| H3 | in-process 전송 쌍과 `createHostConnection`(`./client`). 순서 보장, `devChecks` JSON 왕복, 요청 id `r1`… , 시한, `signal` → `$/cancelRequest` | `F.wire-settings.plan` W12 | S | M1 |
| H4 | 연결 허브와 처리기 M1 5개. 상태 기계(HS-01~HS-05), 처리 순서와 예외 정제(HS-06~HS-09), 취소(HS-21~HS-22), `notImplemented`, `thread.create`의 소유 획득과 `turn.start`의 암묵 획득(HS-28, M1 `--continue` 재개에 필요). 구독은 H7에서 채우고 여기서는 `from: "head"`만 | H2, H3, M0 `platform-store` 세션 잠금 | M | M1 |
| H5 | stdio 전송 연결. JSON Lines 프레이밍, 1 MiB 한도, EOF → `onClose`, `startStdioHost`, `runHostCommand({ kind: "host-stdio" })`, `main.ts` 개발 진입 | H4 | M | M1 |
| H6 | 적합성 러너. `WIRE_CONFORMANCE_CASES`를 in-process와 stdio(같은 프로세스 안 스트림 쌍)에 돌리는 `contract` 테스트. F에 `./testing` 서브패스를 두지 않으므로 `test/contract/conformance-runner.ts`에 둔다(spec §10 16번, review.decisions-2 U-03) | H5, `F.wire-settings.plan` W14 | S | M1 |
| H7 | 구독 재전송. HS-10~HS-16(관찰 폴링 제외), `stream.chunk` HS-17~HS-19, `toEventWire` redact 연결 | H4, `L0.store.plan` 읽기 API | M | M1 |
| H8 | 설정 처리기와 카탈로그 조립. `hostSettings` 선언, `buildCatalog` 결과가 `CatalogIssue`면 기동 거부(AssembleError `catalog`), `settings.get`, `renderSettingsSchema`와 `config-schema` 명령, `schema/` 커밋본 | H2, `F.wire-settings.plan` W8~W11 | M | M1 |
| H9 | `thread.open` 잠금과 `thread.locked` 대안(HS-23~HS-29), `LeaseToken` 전달(`openForWrite`), `keepAlive` 실패 처리, 관찰 폴링(HS-16), 해제 조건 | H7, `L0.process.plan` OS 잠금, `L0.store.plan` `LeaseService`, `L1.persistence.plan` `openForWrite` | M | M2 |
| H16 | 나머지 M2 처리기: `thread.list/fork/revert/delete/close`, `turn.interrupt`, `events.unsubscribe`, `host.status` | H9 | M | M2 |
| H17 | 설정 쓰기 처리기: `settings.set/reset/list`, `checkSettingWrite`, 비밀 값 거부와 details 정제 | H8, `L1.persistence.plan` 설정 쓰기 | S | M2 |
| H18 | `approval.respond`(F wire §4.6 A안, [결정: review.decisions-2 U-02]). bash 도구 env 주입의 실행마다 승인 증거(`ApprovalEvidence`)를 `xeon.secrets` `withEnv`까지 전달하는 경로를 함께 완성한다. M1 코드는 증거를 `null`로 넘긴다(review.decisions-2 U-19) | H16, `L1.tools.plan` 승인 프로토콜 | S | M2 |
| H19 | stdio 종료 절차: HS-31~HS-36, `stopAtSafeBoundary` 연결, 신호 처리 | H5, `L1.loop.plan` 안전 경계 정지 | M | M2 |
| H15 | spike: `bun build --compile` 바이너리에서 (a) `process.execPath`·`Bun.main` 값, (b) `Bun.listen({ unix })` 서버와 `Bun.connect`, (c) stdin EOF 감지, (d) detached self-exec를 macOS arm64와 Linux x64에서 확인한다. 결과를 spec §3.2·§5와 `_research/notes/`에 남긴다 | H5 | S | M2(H19 전) |
| H10 | 서비스 등록과 `ensure`: `registration.ts`(SV-01), `listenServiceSocket`과 활성화 잠금(SV-02), `ensureService`(SV-03), `connectServiceTransport`, `startService` 시작 순서(§4.9.1), detached 자기 실행(SV-06) | H15, H19, `L0.process.plan` detached spawn·활성화 잠금 | L | M3 |
| H11 | 유휴 종료: `decideIdle`, 유휴 타이머, `host.status.idleShutdownAt`, 종료 협조(SV-04, SV-07), `service stop`의 SIGTERM → SIGKILL | H10 | M | M3 |
| H12 | 인증: 소켓 디렉터리 0700·파일 0600 생성과 시작 시 검사(SV-05). 토큰 처리는 F wire §10 미결 4가 정해지면 더한다 | H10 | S | M3 |
| H13 | 예약 틱: 서비스 시작·종료에 틱 연결, `scheduler` 실행권, in-process·stdio에서 `l0.process.service.enabled=false`일 때만 틱(HS-39~HS-41) | H11, `L2.schedule.plan` 틱 API | S | M3 |
| H14 | 알림: 연결 유무에 따른 라우팅(HS-42), `UserNotifyPort` 어댑터 | H13, `L0.os.plan` 알림 | S | M3 |
| H21 | 상태 디렉터리 API `resolveHostStatePaths`(spec §3.3.6): `OsDirs.state` 아래 `cli/state.json`, 0700 디렉터리 생성, 오류 값 `HostStatePathError`, 테스트 덮어쓰기 인자. CLI `connectEngine`이 이 값으로 `paths.cliStateFile`을 채우고 `XEON_CLI_STATE_FILE`은 덮어쓰기로만 쓴다(review.decisions-2 B-07) | H2 | S | M1 |
| H20 | 클라이언트 전송 선택: `resolveLaunchMode`(HS-37), `xeon service ensure --json`(HS-38), `xeon service launch-mode --json`(spec §3.2, 데스크톱 셸의 진입 판정) | H10 | S | M3 |

순서 요약: M1은 H1 → H2 → H3 → H4 → (H5 → H6), (H7), (H8), (H21). M2는 H9 → H16 → H17·H18, H19 → H15. M3는 H10 → H11 → H12·H13 → H14, H20.

## 4. 채택 코드

### 4.1 그대로 쓰는 패키지

| 패키지 | 버전 | 쓰는 것 | 근거 |
|---|---|---|---|
| `typebox` | 1.3.27(catalog 정확 고정, 1.4.x) | `ServiceRegistrationSchema`, `Value.Check`(등록 파일 읽기). 버전 통일은 F wire §10 미결 6 | `xeon/package.json` catalog, `_research/foundation-plan.md` §2 |
| Bun 내장 | Bun 1.4.3(`packageManager: bun@1.4.3`) | `Bun.listen({ unix })`, `Bun.connect({ unix })`(socket 전송), `Bun.stdin.stream()`·`Bun.stdout`(stdio 전송), `Bun.main`, `process.execPath`, `crypto.getRandomValues`(토큰) | ADR-0001. 컴파일 바이너리 동작은 H15에서 확인 |
| `@types/bun` | 1.4.3(catalog) | 타입 | 현재 스캐폴드 |

- 새 npm 의존을 더하지 않는다 [제안]. JSON Lines 프레이밍, 송신 큐, 등록 파일 쓰기는 각각 수십 줄 규모라 의존을 더할 이유가 없다. 프로세스 spawn·신호·잠금은 L0(`platform-process`)를 거친다(DR-13).

### 4.2 구조만 참고하는 원본

코드를 복사하지 않고 구조와 수치만 가져온다. 경로 약칭은 `_research/process.md` 머리말을 따른다(`PX` = pi `coding-agent/src/experimental`, `OC` = opencode 저장소, `CC` = Claude Code 문서).

| 원본 | 가져오는 것 | 바꿀 점 |
|---|---|---|
| pi `PX/server.ts:145-190`(`activateServer`), `:154, 200`(`acquireServerActivation`) | 클라이언트가 서버를 찾고 없으면 기동하는 흐름, 활성화 경합 처리 | coordinator·server·worker 세 겹을 쓰지 않고 서비스 한 겹으로 한다(ADR-0006 §5 단계 1.5 탈락). 세션 attach 라우팅 없음 |
| pi `PX/server.ts:244-245`, `:296-320` | 연결 0 + 작업 0이면 1초 뒤 퇴장, 시작 후 10초 유예 | 대기 예약 0과 승인 대기 조건을 더한다. 퇴장 유예는 설정 키 `l0.process.service.idleGraceMs`(L0.process 소유, 기본 60000ms). 시작 유예 10초는 그대로 |
| pi `PX/process.ts:40-70` | `detached` + `unref` 분리 기동 | spawn은 L0.process 경유. stdio는 로그 파일로 돌린다 |
| pi `PX/session-worker.ts:183-305, 560-594` | 퇴장 조건 "수요 0 + 보류 0 + Harness 비활성 + attach 0", live task가 있으면 유지 | 세션별 워커 대신 서비스 프로세스 하나가 모든 세션의 live 작업을 센다(`ActivityPort`). 열 때 바로 `resume()`하지 않고 `l1.persistence.autoResume` 설정을 따른다 |
| pi `PX/session-worker.ts:517-522` | 세션 잠금 stale·갱신 수치(2초, 1초) | 잠금 구현은 L0.process 소관. 수치를 가져오지 않는다 |
| opencode `OC/packages/cli/src/services/standalone.ts:23-27` | stdin EOF를 소유 임대 종료로 보는 규칙 | EOF에서 바로 끝내지 않고 안전 경계 체크포인트 뒤 종료(HS-31) |
| opencode `OC/packages/desktop/src/main/service/background-service.ts:49-52` | 고정 주소 선점으로 두 번째 contender가 물러나는 규칙. 포트 0 금지 이유 | TCP 포트 대신 고정 Unix 소켓 경로. 낡은 소켓 파일 처리에 활성화 잠금을 더한다(SV-02) |
| opencode `OC/packages/client/src/service.ts:9-57`, `OC/packages/cli/src/services/server-connection.ts:27-47` | 등록 파일을 읽고 없거나 버전이 다르면 spawn하는 `resolve` 흐름 | 버전이 달라도 작업 중이면 재기동하지 않고 경고(SV-03, Claude Code 방식) |
| Claude Code `CC/agent-view.md:848` `roster.json` 규칙 | 0600, 모르는 필드 보존 | 임시 파일 생성 시점 0600 + rename(SV-01) |
| Claude Code `CC/agent-view.md:819` | 권한 프롬프트에서 멈춘 세션을 실행 중으로 보는 규칙 | 승인 대기 세션을 live로 센다([제안], spec §10 미결 6) |
| Codex app-server(`_research/process.md` §2.2) | 연결마다 `initialize` 선행, 비루프백은 토큰 인증 | `host.hello`. 원격은 로컬 소켓 터널(U-11), 내장 토큰 전송은 2차 |
| `docs/design/19-client-protocol.md` §3.5.4 | 재전송 알고리즘(F wire §3.4.3이 이식) | 데몬 대신 호스트가 실행. 저장소 읽기는 `EventFeedPort` |

## 5. 단위 테스트 목록

태그는 `eng.testing.guide` TS-01 표를 따른다. 서비스 프로세스나 자식 호스트를 띄우는 테스트는 `int`이고 파일당 10초 이하다. `int` 테스트의 대기는 조건 대기(폴링 + 상한)로만 한다(TS-03). 유휴·종료 시한은 테스트에서 `l0.process.service.idleGraceMs: 1000`, `l0.process.shutdown.timeoutMs: 1000`, `startupGraceMs: 200`으로 줄인다.

### 5.1 서비스 체크리스트 대응

spec SV-01~SV-08에 대응한다. [제안] 항목마다 테스트를 하나 이상 둔다. SV-01과 SV-04는 둘, 나머지는 하나씩이고 모두 10개다.

| SV | 테스트 이름 | 태그 | 파일 | 확인 동작 |
|---|---|---|---|---|
| SV-01 | `registration-perm-0600` | unit | `test/service/registration.test.ts` | 임시 디렉터리에 `writeRegistration` 뒤 파일 모드가 0600이다. rename 전 임시 파일도 0600이다 |
| SV-01 | `registration-unknown-field-preserved` | unit | 같음 | `{..., futureField: 1}`이 있는 파일에 다시 쓰면 `futureField`가 남고, `readRegistration`이 `ok`를 돌려준다 |
| SV-02 | `bind-race-loser-connects` | int | `test/int/bind-race.int.test.ts` | `service run` 자식 두 개를 동시에 띄우면 하나만 등록 파일을 쓰고 다른 하나는 종료코드 0이다. 이어서 부른 `ensureService`가 `connected`이고 hello가 성공한다. 낡은 소켓 파일을 미리 둔 경우도 같다 |
| SV-03 | `version-mismatch-idle-restart` | int | `test/int/version-mismatch.int.test.ts` | 등록 버전이 다른 한가한 서비스에 `ensureService`를 부르면 `restarted`이고 새 등록 파일의 pid가 다르다. live turn이 있는 서비스면 `versionWarning`이고 pid가 그대로다 |
| SV-04 | `idle-exit-requires-no-conn-no-task-no-schedule` | unit | `test/service/lifetime.test.ts` | `decideIdle`이 연결 1, `liveTasks` 1, `pendingSchedules` 1, 시작 유예 안 각각에서 `idle: false`와 맞는 `reason`을 돌려주고, 모두 0이며 유예가 지나면 `idle: true`다 |
| SV-04 | `approval-waiting-counts-live` | unit | 같음 | `waitingApprovals: 1`, 나머지 0이면 `countApprovalAsLive: true`에서 `{ idle: false, reason: "approvals" }`, `false`에서 `idle: true`다 |
| SV-05 | `socket-perm-owner-only` | int | `test/int/socket-auth.int.test.ts` | 서비스 시작 뒤 소켓 디렉터리 모드 0700, 소켓 파일 0600이다. 디렉터리 권한이 넓으면 시작이 거부된다 |
| SV-06 | `stdio-eof-checkpoint-exit` | int | `test/int/stdio-eof.int.test.ts` | 모델 테이프로 turn을 진행 중인 `host --stdio` 자식의 stdin을 닫으면 체크포인트 이벤트가 커밋되고 종료코드 0으로 끝난다. 다시 열면 복구 표식이 없다 |
| SV-07 | `sigterm-checkpoint-then-kill` | int | `test/int/sigterm.int.test.ts` | SIGTERM을 받은 서비스가 체크포인트 뒤 등록 파일을 지우고 종료코드 0으로 끝난다. 안전 경계에 가지 못하게 막는 테스트용 플러그인을 실으면 `service stop`이 시한 뒤 SIGKILL하고, 다음 `ensure`가 낡은 등록을 처리한다 |
| SV-08 | `service-loss-client-stops` | int | `test/int/service-loss.int.test.ts` | 연결된 클라이언트가 있을 때 서비스를 SIGKILL하면 진행 중 요청이 `CloseInfo` 오류로 끝나고 새 요청을 보내지 않는다. 다음 `ensureService`가 `spawned`이고 표식이 남은 thread가 재개 후보다 |

SV-06의 서비스 쪽(부모가 끝나도 서비스가 남는다)은 `bind-race-loser-connects`가 확인한다. 테스트를 띄운 프로세스가 `ensureService`를 부른 부모이고, 그 테스트 프로세스의 자식 핸들을 닫은 뒤에도 서비스가 응답하는지 본다.

### 5.2 전송, 처리기, 소유

| 테스트 이름 | 태그 | 파일 | 확인 동작 | spec |
|---|---|---|---|---|
| `transport-parity` | contract | `test/contract/transport-parity.contract.test.ts` | 같은 모델 테이프, 고정 ID·시계 대역(`test/` 안, review.decisions-2 U-03), 같은 요청 열을 in-process와 stdio(같은 프로세스 안 스트림 쌍)로 돌려 정규화한 메시지 열이 같다 | AH-01 |
| `conformance-in-process`, `conformance-stdio` | contract | `test/contract/conformance.contract.test.ts` | `WIRE_CONFORMANCE_CASES` 전부 통과 | AH-02 |
| `subscribe-replay-no-dup` | unit | `test/handlers/events.test.ts` | 가짜 `EventFeedPort`로 재전송 중 커밋 3묶음을 넣으면 받은 seq가 빠짐없이 한 번씩이고 오름차순이며 `from`이 직전 `to`다. 마지막 알림만 `caughtUp: true` | AH-05 |
| `replay-out-of-range-reasons` | unit | 같음 | `storeMismatch`, `aheadOfHead`, `beforeOldest`, `tooFar` 각각 2001과 details | HS-13 |
| `subscription-limit` | unit | 같음 | 17번째 구독이 2003 `{ max: 16 }` | §6.1 |
| `stream-chunk-not-replayed` | unit | 같음 | 재구독 뒤 이전 `stream.chunk`가 오지 않는다. `n`이 turn마다 0부터 | AH-06, HS-18 |
| `host-hello-gating` | unit | `test/connection.test.ts` | hello 전 `turn.start` → 1001, 두 번째 hello → 1002, 주 버전 다름 → 1003이고 연결 유지 | AH-03 |
| `handler-throw-internal-error` | unit | 같음 | 처리기가 `Error("secret detail")`을 던지면 `-32603`, `"Internal error"`, 응답 바이트에 원문 없음, 로그에 같은 `traceId` | AH-04 |
| `cancel-request` | unit | 같음 | `$/cancelRequest`로 재전송 중 구독 요청이 5001로 끝나고 구독이 남지 않는다. 응답 뒤 취소는 무시 | AH-07 |
| `not-implemented-hidden` | unit | 같음 | `notImplemented` 메서드는 `-32601`이고 hello `features`에 없다 | §3.3.3 |
| `send-queue-overflow-closes` | unit | 같음 | 느린 가짜 전송에서 큐가 64 MiB를 넘으면 연결이 `sendQueueOverflow`로 닫힌다 | HS-05 |
| `thread-locked-alternatives` | int | `test/int/thread-locked.int.test.ts` | 같은 DB를 연 호스트 자식 두 개에서 같은 thread를 `write`로 열면 하나만 `owner`이고 다른 하나는 3002, `options`는 서비스가 없으면 `["observe", "fork"]`, 있으면 `"delegate"`가 앞에 온다 | AH-08, HS-25 |
| `observe-poll-follows-commits` | int | 같은 파일 | 관찰 쪽 구독이 다른 프로세스의 커밋을 `OBSERVE_POLL_MS` 폴링으로 받는다 | HS-16 |
| `forced-kill-resume` | fault | `test/fault/forced-kill-resume.fault.test.ts` | turn 진행 중 stdio 자식을 SIGKILL한 뒤 같은 DB로 다시 열면 seq가 이어지고, 결과 불명 도구 호출이 "중단됨"으로 합성되며, 표식이 재개 후보로 남는다 | AH-09 |
| `assemble-catalog-refused` | unit | `test/assemble.test.ts` | 코어 키를 중복 선언한 테스트 플러그인으로 `assemble`하면 `AssembleError { code: "catalog" }`이고 열린 핸들이 없다 | AH-13 |
| `settings-get-resolves` | unit | `test/handlers/settings.test.ts` | `settings.get`이 `resolveSetting` 결과를 그대로 돌려주고 모르는 키는 3101 | §3.4 |
| `settings-set-secret-rejected` | unit | 같음 | 비밀 키에 평문 → 3105, details에 값 없음(M2) | §3.4 |
| `settings-schema-deterministic` | unit | `test/settings.test.ts` | `renderSettingsSchema` 두 번 호출 결과 바이트 동일 | AH-12 |
| `settings-schema-committed` | unit | 같음 | `--core-only` 카탈로그 출력과 `schema/` 커밋본 네 파일이 같다 | AH-12 |
| `service-ensure-json` | int | `test/int/service-ensure.int.test.ts` | `runHostCommand({ kind: "service-ensure" })`가 stdout에 JSON 한 줄(`ok`, `socket`, `version`, `action`)만 쓰고 종료코드 0이다. 서비스를 띄울 수 없으면 `ok: false`와 종료코드 1 | HS-38 |
| `turn-start-implicit-acquire` | int | `test/int/thread-locked.int.test.ts` | 다른 프로세스가 만든 기존 thread에 `turn.start`를 보내면 잠금을 얻어 제출한다. 소유자가 살아 있으면 3002와 `options` | HS-28 |
| `client-import-boundary` | unit | `test/client-boundary.test.ts` | `src/client.ts`의 import 그래프에 `@xeon/contracts` 외 워크스페이스 패키지가 없다 | §2 |

## 6. 완료 기준

공통: `cd xeon && just verify`가 종료코드 0이다(`eng.toolchain.guide`). `apps/host/bunfig.toml`의 커버리지 임계 lines 0.5, functions 0.5를 넘는다(`eng.testing.guide` TS-10).

- M1
  1. `just verify` 종료코드 0.
  2. `WIRE_CONFORMANCE_CASES`가 in-process와 stdio에서 통과한다(`conformance-*`). 이로써 `F.wire-settings.plan` §6이 이 plan에 맡긴 A1·A2·A4·A7·A10의 실제 전송 통과를 확인한다.
  3. `apps/cli`의 `chat.scenario.test.ts`가 `startInProcessHost`로 한 턴, 강제 종료 뒤 재개, drive 그룹 토글을 통과한다(`product.scope.spec` §4.4 M1).
  4. `host-hello-gating`, `handler-throw-internal-error`, `cancel-request`, `subscribe-replay-no-dup`, `stream-chunk-not-replayed`, `assemble-catalog-refused`, `settings-*`(M1분)가 통과한다.
  5. H1 허용 목록 항목이 사용자 승인으로 들어갔고, `apps/cli` → `@xeon/host`가 `just check-layers`를 통과한다. 승인 전이면 M1 완료를 막는 항목으로 보고한다.
- M2
  1. `transport-parity`가 같은 모델 테이프로 통과한다.
  2. `thread-locked-alternatives`, `forced-kill-resume`, `stdio-eof-checkpoint-exit`가 통과한다.
  3. H15 spike 결과가 문서에 남았다.
- M3
  1. §5.1 체크리스트 테스트 10개가 모두 통과한다(SV-01~SV-08).
  2. 서비스 모드에서 클라이언트를 모두 종료해도 예약 실행 이벤트가 기록된다(`product.scope.spec` §4.4 M3, `L2.schedule.plan`과 함께).
  3. macOS와 Linux에서 컴파일 바이너리로 `service start` → `status` → `stop`이 동작한다(수동 확인 1회, 결과를 plan에 기록).

## 7. 위험과 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| `bun build --compile` 바이너리에서 Unix 소켓 서버, stdin EOF 감지, `process.execPath` 값이 확인되지 않았다(`_research/notes/L4-1.md` §7) | 사이드카와 서비스가 컴파일 바이너리에서만 실패한다 | H15 spike를 H19·H10 전에 둔다. 실패하면 대체 경로(예: Node `net` 호환 API, 별도 진입 스크립트)를 spec §5 표에 더한다 |
| 단일 바이너리 self-exec 경로 | 개발 실행(`bun main.ts`)과 컴파일 실행의 인자 모양이 달라 `ensure`가 엉뚱한 명령을 실행한다 | 자기 실행 명령을 한 함수에 두고 두 경우를 `int` 테스트로 확인한다. 컴파일 판별 규칙은 H15 결과로 고정한다 |
| 조립 코드 순환 의존 | `assemble.ts`가 모든 패키지를 import하므로, 아래 층이 실수로 `@xeon/host`를 import하면 순환이 생긴다 | DR-01(상향 import 금지)과 depcruise `DR-06-no-circular`가 막는다. 처리기와 `connection.ts`는 포트만 쓰게 해 `assemble.ts` 밖으로 패키지 import가 퍼지지 않게 한다 |
| 세션 잠금 구현은 OS 잠금 + `sys_leases.epoch` 펜싱으로 결정했다(review.decisions-2 U-09, 2026-10-22 확인). flock은 멈춘 소유자를 깨어나거나 죽을 때까지 잠근다(알려진 한계) | 번복되면 `thread.open`과 크래시 직후 동작이 바뀐다 | `SessionLockPort` 뒤로 숨긴다. M2 H9는 L0.process·L0.store가 제공하는 수단으로 구현하고, 결정이 바뀌면 어댑터만 바꾼다. `thread-locked-alternatives`는 수단과 무관하게 같은 결과를 확인한다 |
| M1과 M3 사이 F 계약 변경(`shutdown`, 재개 후보, 인증 토큰, 확장 메서드) | 처리기 표와 적합성 케이스가 바뀐다 | F 생성물(TS 타입, JSON Schema)의 재생성 diff를 CI가 검사한다(ADR-0006 §3.2). F 변경은 부 버전 정책을 따르고, 호스트는 `notImplemented`로 새 메서드를 먼저 받아 둔다 |
| 서비스 단일 장애점 | 서비스가 죽으면 연결된 모든 클라이언트가 멈춘다 | SV-08. 복구 표식과 다음 `ensure`의 재기동으로 피해를 줄인다. 재접속 정책은 CLI·데스크톱 spec |
| 컴파일 바이너리 크기(Bun 런타임 포함, 수치 미확인) | 데스크톱 번들이 커진다 | 단일 바이너리로 런타임 1벌만 둔다. 크기 상한은 `L4.desktop.plan`이 측정 뒤 정한다(ADR-0008 §6) |
| 재전송 구현이 "등록과 head 읽기가 같은 JS 턴" 가정에 기댄다 | L0.store가 커밋을 워커 스레드로 옮기면 중복이나 누락이 생긴다 | `subscribe-replay-no-dup`를 커밋 위치별로 돌린다. L0.store 변경 때 이 가정을 리뷰 항목으로 둔다 |
| 테스트의 `Bun.spawn`이 DR-07과 충돌한다(§5 `int`·`fault`) | `just verify`의 check-layers에서 막힌다 | `L4.desktop.plan` R10과 같은 결정 하나로 푼다(허용 목록 항목 또는 `platform-process/testing` 도우미). 사람 확인이 필요하고, 결정 전까지 M1 완료를 막는 항목으로 보고한다 |
| 테스트용 그룹과 모델 테이프의 위치가 정해지지 않았다 | M1 scenario와 host 테스트가 같은 고정 자료를 공유하지 못한다 | 테스트용 그룹의 위치와 이름은 `L3.group-kit.plan`이 정한다. 그 전까지 host 테스트는 `test/fixtures/`에 자기 것을 둔다 |

## 8. M2 구현 기록 (m2-plan HOST.1·HOST.2·HOST.3·HOST.4·HOST.5·HOST.6·HOST.7)

HOST.1·HOST.3·HOST.5는 브랜치 `m2/host`에서 했다. 다른 트랙(L1A.4 승인 프로토콜, L1B.2 thread 수명 주기, L2·L3 능력)이 병합된 뒤 브랜치 `m2/host2`에서 HOST.2·HOST.4·HOST.6·HOST.7을 했다(§8.4). 시험은 `cd xeon && just test apps/host`와 CLI 테이프 스모크 `just test apps/cli`로 돌렸다.

### 8.1 작업별 상태

| m2-plan ID | plan ID | 상태 | 내용과 시험 |
|---|---|---|---|
| HOST.1 | H9 | 구현 | `thread.open { write \| observe }`, 쓰기 소유 획득의 단일 경로(`claimWrite`: `thread.create`, `turn.start`, `thread.open`이 같이 쓴다), 같은 thread의 동시 획득 합치기, 쓰기·관찰 연결 기록(`writeThreads`, `observedThreads`), 서비스 모드의 잠금 해제 판정(`releaseUnused`, HS-27). 관찰 폴링(HS-16, `handlers/observe.ts`)과 다른 프로세스 커밋 구간 메우기(`fillGap`). `test/handlers/thread-open.test.ts`, `test/assembly/ports.test.ts`(동시 획득), `test/int/thread-locked.int.test.ts`(`thread-locked-alternatives`, `observe-poll-follows-commits`: 같은 저장소를 연 호스트 둘이 실제 OS 잠금과 `sys_leases` 위에서 다툰다) |
| HOST.1 | H9 `LeaseToken` 전달 | 구현(M1 어댑터에 있었음) | `SessionLockPort.tryAcquire`가 임대 토큰으로 `openForWrite`를 열고 `keepAlive` 실패를 `onLeaseLost`로 처리한다. 이번 작업은 토큰 전달 경로의 동시 획득 합치기와 `release(threadId)`를 더했다 |
| HOST.1 | H9 `delegate` 대안 | 보류 | 서비스 모드(M3)가 없어 `options`는 `["observe", "fork"]`다(HS-25) |
| HOST.3 | H22(신규) | 구현 | `secret.list·meta·remove·test·beginEntry·beginReveal`, `EnginePorts.secrets`, `InProcessHost.secretOutOfBand`, 기본 메타, 설정 키 참조 조회(`settingKeysFor`). `test/handlers/secret.test.ts`, `test/assembly/secrets.test.ts`, `test/engine.test.ts`(실제 `platform-secrets` 관리 서비스) |
| HOST.5 | H15 | 구현(Linux x64) | spec §3.2.1에 결과를 적었다. macOS arm64는 미확인이다 |
| HOST.5 | 최상위 await 제거 | 구현 | `main.ts` 끝을 `detach(…then(process.exit))`로 바꿨다. `test/entry-bundle.test.ts`가 `--minify --bytecode`로 진입을 묶는다 |
| HOST.5 | H19 | 구현 | stdio 호스트의 종료를 엔진의 협조 창구(`Engine.shutdown`, 실제 `ProcessShutdown`)로 통일했다. EOF(`stdin_eof`), SIGTERM·SIGINT(`signal`), `host.shutdown`(`shutdown_request`, `version_replace`)이 같은 절차를 밟고 시한을 넘기면 창구가 `exit(1)`한다. 호스트 참여자가 turn을 안전 경계에서 멈춘다. `closeAll`은 송신 큐가 빌 때까지(최대 1초) 기다린 뒤 닫아 마지막 응답이 나가게 한다. `test/handlers/host-shutdown.test.ts`, `test/int/stdio-shutdown.int.test.ts`(`stdio-eof-checkpoint-exit` 포함) |
| HOST.5 | `transport-parity` | 부분 | 같은 모델 테이프와 요청 열로 in-process와 stdio(스트림 쌍)를 돌려 정규화한 응답·이벤트열이 같음을 확인한다(`test/contract/transport-parity.contract.test.ts`). 컴파일 바이너리 stdio는 자식 프로세스가 필요해 시험에 없다(§8.2 첫 행) |

### 8.2 확인하지 못한 항목 (미확인)

| 항목 | 이유 | 확인 방법 |
|---|---|---|
| 자식 프로세스를 띄우는 시험(`forced-kill-resume`, 컴파일 바이너리 `transport-parity`, 실제 SIGKILL 뒤 재개) | `apps/host`는 `Bun.spawn` 테스트 한정 허용 항목(`DR-07/host-test-spawn`)이 없다. 허용 목록은 사용자 승인이 필요한 공유 파일(`scripts/dependency-allowlist.json`)이다. 컴파일 바이너리의 EOF 종료, `host.shutdown`, SIGTERM은 이 작업에서 손으로 확인했다(spec §3.2.1) | 허용 항목을 승인하거나 `platform-process/testing`에 일반 자식 실행 도우미를 두는 결정(§7 마지막 행)을 받은 뒤 `test/fixtures/spawn-host.ts` 한 곳에 모아 더한다 |
| 종료 뒤 복구 표식 조회(`thread.list`의 `resumable`) | `core-persistence`의 `threads.list`가 아직 `not_implemented`다(L1B.2). 지금 시험은 저장소 이벤트(`turn.abort_requested`, `turn.completed`)가 남았는지로 확인한다 | L1B.2 병합 뒤 `stdio-eof-checkpoint-exit`에 `resumable: null` 확인을 더한다 |
| macOS arm64 spike(H15 a~d) | 이 기기에 macOS가 없다 | CI `desktop-macos` job 또는 실기 |
| 서비스 모드에서 live 작업 때문에 쥔 잠금의 해제 시점 | 연결이 떠난 뒤 turn이 끝나는 시점에 다시 판정하지 않는다(spec §10 20번) | M3 H10~H11 |
| `reveal`의 `os-auth`, 서비스 접속에서 비밀 값 입력 | 서비스 접속에는 값 전달 통로가 없고 OS 입력 창은 M3다. in-process 통로는 CLI가 `InProcessHost.secretOutOfBand`로 맡긴다 | CLI.3, M3 |

### 8.3 다른 레인에 요청한 것

- F: `WIRE_ERRORS`에 비밀 관리 전용 kind, `SecretTestResult` 확장, `SecretEntryOffer`의 `add`용 메타, `secret.references` 메서드(spec §10 19번).
- 허용 목록 담당: `DR-07/host-test-spawn` 항목(§8.2 첫 행).
- PLT: `platform-process`의 stdio 전송(`createStdioTransport`, `openProcessStdio`)과 이 패키지의 `transport/stdio.ts`가 같은 일을 한다. 통합 때 호스트가 L0 구현으로 갈아탈지 정한다. 이번 작업에서는 바꾸지 않았다.

### 8.4 HOST.2·HOST.4·HOST.6·HOST.7 (브랜치 m2/host2)

| m2-plan ID | plan ID | 상태 | 내용과 시험 |
|---|---|---|---|
| HOST.2 | H16 | 구현 | `thread.list·read·close·fork·revert·delete`, `turn.interrupt`, `events.unsubscribe`, `host.status`. `thread.delete`는 소유를 쥐지 않았으면 한 번 얻어 본다(spec HS-28). `thread.fork`는 새 thread의 소유를 얻는다. 수명 주기 오류는 `wireErrorOfLifecycle`이 3001~3006으로 옮긴다. `test/handlers/thread-lifecycle.test.ts`(가짜 엔진), `test/int/lifecycle.int.test.ts`(실제 저장소) |
| HOST.2 | H17 | 구현 | `settings.set·reset·list`. user 파일 원자 교체, session 커밋, 신뢰한 작업 폴더의 project·local 파일(spec §4.14). 프로젝트 신뢰 조립(`assembly/trust.ts`). `test/handlers/settings.test.ts`, `test/int/settings-write.int.test.ts` |
| HOST.4 | H18 | 구현 | `approval.respond`(restore → 응답, 소유 검사 3002), `approval.list`(spec §4.13), 쓰기 소유를 얻을 때 `restore`. A1 시험 `test/int/approval-restart.int.test.ts`(실제 자식 호스트 SIGKILL → 새 호스트 목록·열기·재개·응답), `test/int/approval.int.test.ts`, `test/handlers/approval.test.ts`. 허용 목록에 `DR-07/host-test-spawn`을 더했다 |
| HOST.4 | H18 U-19 | 확인만 | env 주입 승인 증거는 F의 `CallContext.approval`(F 요청 13)과 L1.tools `RawCall.secretApproval`, cap-workspace의 `SecretEnvRequest.ctx.approval` 복사로 `withEnv`까지 이어져 있고 호스트가 더한 코드는 없다. 호스트 수준 종단 시험은 없다(§8.5 둘째 행) |
| HOST.6 | (신규) | 구현 | core-agents(`parentToken`, 자식 thread 열고 닫는 감싸개), core-context(`createContextExtension`), cap-web, cap-knowledge(`projectTrust`), cap-mcp, cap-work, cap-dialog, group-kit(`xeon.groups`). 각 등록 뒤 CLI 테이프 스모크를 돌렸다. 능력마다 실제 엔진 시험이 있다(`test/int/agents·cap-web·cap-knowledge·cap-dialog·cap-work·cap-mcp·groups·retention.int.test.ts`) |
| HOST.7 | D-12 | 구현 | spec §3.3.1~§3.3.3을 코드에 맞췄다(`AssembleOptions`, `Engine.shutdown`, `AssembleIssue.plugin`, `EnginePorts`, `ConnectionHub`, `createWireHandlers`). 순서 규칙 정합: HS-18(`n`·`afterSeq`는 발신자 값), HS-21(구독 취소 창) |

HOST.6에서 실제 엔진에 올리자 드러난 오류와 처리:

- cap-work의 투영 표 `cap_work_task_edges`가 실제 투영기 등록부의 이름 규칙(접두 뒤 지역 이름에 밑줄 금지, F.records §3.4)에 걸려 엔진이 서지 못했다. cap-work 시험의 등록부 대역은 이 규칙을 보지 않아 드러나지 않았다. 표 이름을 `cap_work_edges`로 바꿨다.
- core-tools 매니페스트 `optional`에 L2 도구 능력이 없으면 도구 호출이 "공급자 없음"이다(spec HS-60).
- 엔진이 서지 못할 때 실제 엔진 시험이 건너뛰어져 검증이 통과한 것처럼 보였다. 이제 시험 파일이 실패한다(HS-65).

### 8.5 확인하지 못한 항목 (HOST.2·4·6)

| 항목 | 이유 | 확인 방법 |
|---|---|---|
| stdio MCP 서버 | (m2c에서 연결했다. 아래 §9 HOST.15) 크래시 재기동과 공식 서버(예: filesystem)로의 연결은 확인하지 못했다 | 실제 MCP 서버로 연결·종료·크래시 재기동 |
| 비밀을 쓰는 bash 호출의 종단 시험 | sops 제공자와 키 접근을 가짜로 바꿀 주입점이 조립 옵션에 없다 | `AssembleOptions`에 `ProcessRunner` 주입을 더하거나 platform-secrets 시험 제공자를 조립 옵션으로 연다 |
| 컴팩션이 실제로 도는지 | core-loop가 `shouldCompact`·`recoverOverflow`를 부르지 않는다(L1C 요청). 설정 연결만 확인했다 | L1A 구현 뒤 긴 대화 시험 |
| 프로젝트 신뢰 프롬프트 | 대화형 클라이언트(CLI.2, DESK)가 `TrustPrompter`를 아직 내놓지 않는다 | CLI.2·DESK 뒤 |
| `/group` 명령 | 처리기가 출력을 돌려줄 길이 없다(spec §10 26) | F 요청 처리 뒤 |

### 8.6 다른 레인에 요청한 것 (HOST.2·4·6)

- F: (m2c에서 모두 처리됨) 열린 turn 재개 메서드는 `turn.resume`(spec §10 21), `thread.closed` 오류 kind(§10 23), 명령 처리기 출력은 `command.run`의 `done`(§10 26).
- L1B: fork thread의 가지가 원본 history를 잇는지와 `thread.read`용 `before`·`limit` 질의(§10 22): m2c T4가 처리한다. 병합 뒤 `readThread`를 그 질의로 바꾼다.
- PLT: (m2c에서 처리됨) `McpProcessPort` 구현, 파일 잠금 API(§10 24·25).
- WK(cap-work): 표 이름을 바꿨다(위). `submit_plan` 승인 결과 문구는 한국어다.
- DG(cap-dialog): `ask_user` 도구 등록은 조립 루트(`host-dialog-bridge`)가 했다. 플러그인이 등록하도록 옮길지 정한다.
- core-agents: `agentsPlugin`에 `loop` 감싸개 선택 옵션을 더했다(자식 thread 열기). L1B가 같은 일을 플러그인 안에서 하면 옵션을 지운다.
- L1A: core-tools에 정식 `L2ApprovalsPort` 팩토리가 생기면 `assembly/l2-approvals.ts`를 지운다. 동적 도구에 호출 연속 정보를 싣는 경로는 병합 때 닫았다(§8.7).

### 8.7 병합 연결 (xeon/foundation 통합)

m2/l1f, host2, mcp4, webkn, wkdg, cli2를 이 순서로 합친 뒤 남은 연결을 한 커밋씩 닫았다.

| 항목 | 내용과 시험 |
|---|---|
| 설정 쓰기 실패 | L1F가 `SessionSettingsStore.set/reset`에 `key_reused`를 값으로 더했다. `SettingsWriteFailure`에 같은 kind를 더하고 처리기가 `store-error.ts`의 `keyReusedBug`로 `Bug`로 옮긴다(와이어에는 `-32603 internal`). 호스트는 키를 호출마다 새로 만들므로 키 재사용은 호출 결함이다. 수명 주기·생성의 `key_reused`도 같은 도우미를 쓴다 |
| AG-11 시험 | 조립 루트가 core-agents를 싣게 되었으므로 `agent-tools-slot.int.test.ts`가 플러그인을 직접 설치하지 않고 `agentDefinitions` 옵션만 넘긴다. 자식 thread 열기도 조립 루트의 감싸개가 한다 |
| thread.read 시험 | cap-knowledge의 첫 turn 문맥이 사용자 입력 뒤에 custom item 하나를 더한다. `lifecycle.int.test.ts`의 기대 종류가 `user, custom, system, assistant`다 |
| 질문·계획 승인, 사용자 셸 | cap-dialog와 cap-work의 기본 구현(`questionApprovalsOver`, `planApprovalsOver`, `shellPortOver`)이 `xeon.approvals`와 `xeon.loop`를 감싼다. 조립 루트의 같은 일을 하던 `dialogApprovalsFactory`, `planApprovalsFactory`, `userShellPort`와 `createCallL2ApprovalsPort`, `createOriginL2ApprovalsPort`를 지웠다. 기본 구현은 재시작 뒤 `restore`와 `key_reused` 거부를 더 한다. `l2-approvals.ts`에는 cap-web이 쓰는 출처 없는 포트만 남았다 |
| 사용자 셸 종단 | core-loop `runUserBash`가 구현되어 `shell-injection.int.test.ts`가 슬래시 명령의 `!{...}`를 실제 셸로 실행하고 출력을 치환하며 효과 레코드를 확인한다 |
| MCP 서버 주도 요청 종단 (D5 a) | F `DirectToolRegistration.executeWithContinuation`을 더했다. cap-mcp `createToolServiceRegistrar`가 채우고, core-tools `settleDirectInput`이 `input_required`를 질문 승인으로 올려 같은 `toolCallId`로 다시 부른다. `approval-shapes.int.test.ts`가 질문 도구, 계획 승인, MCP 질문의 `approval.requested` 레코드 모양이 같음(E5)과 종단 흐름을 확인한다 |

## 9. M2 마감 구현 기록 (m2c T2 HOST)

`review.m2-plan` §9~§11이 정한 마감 작업 가운데 `xeon/apps/host`와 이 문서가 맡은 부분이다. 항목 ID(G1-01 등)는 `review.milestone-audit`의 통합 항목이다. 후보 브랜치(`m2/fx-host`, `m2/fx-mcp`, `m2/fx-m`)는 옛 SHA 위에 있어서 통째로 가져오지 않고 필요한 hunk를 새 `xeon/foundation` 위에 다시 썼다.

| 작업 | 항목 | 상태 | 내용과 시험 |
|---|---|---|---|
| HOST.8 | G1-12, G2-05, G2-07 | 구현 | `xeon.os`를 `osPlatform`으로 올려 핸들(`fileLock`, `checkBinaries`)을 쥐고, `l0.os.log.level`을 읽기 함수로, exec `tempDir`를 `<state>/spill`로, 샌드박스 `startSelfTests`를 서비스 등록 때 한 번 잇는다. `Engine.diagnose`가 외부 바이너리 점검을 낸다(spec HS-67, HS-69). `test/assembly/platform.test.ts`, `test/assembly/settings-sources.test.ts`, `test/assemble.test.ts`(`diagnose`) |
| HOST.9 | G2-06, G1-07 | 구현 | 저장소 열기 실패에 안내 분류(`failure`)를 싣고 열기 경고를 로그로 남긴다. 실행 중 `row_invalid`는 `store.corrupt`, 종결된 thread는 `thread.closed`로 옮긴다(spec HS-68). `test/assemble.test.ts`(`storeIssueOf` 표), `test/int/store-failure.int.test.ts`(새 버전, 이력 변조, 실패한 마이그레이션 뒤 스냅샷), `test/store-error.test.ts` |
| HOST.10 | G1-03, G1-10 | 구현 | `trust.get`·`trust.decide`(`TrustPort`, `handlers/trust.ts`, `ProjectTrust.inspect`·`decide`). `trust.json`은 `OsServiceHandle.fileLock.updateText` 안에서 읽고-고치고-쓴다. `m2/fx-host`의 신뢰 wire를 새 foundation의 `trustOptions`·`TrustStatus` 위에 다시 썼다. `test/assembly/trust.test.ts`(서비스가 다른 호스트 둘이 동시에 결정해도 항목이 모두 남는 시험 포함), `test/handlers/trust.test.ts`, `test/int/trust.int.test.ts`(결정이 열린 thread의 프로젝트 설정 층에 바로 반영되고 재시작 뒤에도 유지) |
| HOST.11 | G1-08, G5-04 | 구현 | `settings.invalidated`: 설정 엔진이 `SettingsChange`를 내고(설정 저장소의 쓰기, 신뢰 결정) 연결 허브가 hello를 마친 연결 전체에 보낸다. `settings.list`는 `stage: "reserved"` 키를 기본으로 뺀다(`includeReserved`로 연다). `test/handlers/settings.test.ts`(예약 키, 알림 대상), `test/int/settings-invalidated.int.test.ts`(실제 엔진의 user·session·reset·신뢰 결정) |
| HOST.12 | G1-07 | 구현 | `SecretError`를 `secret.*` 전용 kind 3201~3212로 옮기고(입력 오류만 -32602) `secret.references`를 `SecretAdminService.references`에 잇는다. `secret.test`는 이미 확장된 결과를 싣는다. `test/secrets/wire.test.ts`(열두 변형의 kind·code·details와 stderr·경로 비노출), `test/handlers/secret.test.ts` |
| HOST.13 | G1-01, G1-02, G2-12 | 구현 | `command.list`(선택 `threadId`는 서비스 입력이 아니라 호출 문맥으로)·`command.run`(`CommandPort`, `assembly/commands.ts`, 브리지 확장이 `dialog.commands` API를 `CommandRegistryHolder.api`에 채움), `turn.resume`(쓰기 소유 암묵 획득 뒤 `LoopService.resume`), `thread.rename`(`ThreadPort.rename`)과 첫 입력 80자 자동 제목(`title.ts`). 후보 `m2/fx-host`에는 이 처리기들이 없었다(새 foundation의 wire 계약 위에서 새로 썼다). `test/assembly/commands.test.ts`(호출자 `host`, 호출마다 새 요청 키), `test/handlers/command.test.ts`, `test/handlers/turn-resume.test.ts`, `test/handlers/thread-rename.test.ts`, `test/title.test.ts`, `test/int/command.int.test.ts`(실제 cap-work `/plan`·`/tasks`, `command.list`의 `threadId`로 thread 작업 폴더의 프로젝트 명령), `test/int/title.int.test.ts`, `test/int/approval-restart.int.test.ts`(SIGKILL 뒤 `turn.resume`) |
| HOST.14 | G1-12, G4-05 (E4, H1) | 구현 | `hostedSearch`(`xeon.models`)를 cap-web에 넘기고 설정이 바뀌면 탐침 기억을 지우며 `session_shutdown`에서 세션 원문을 정리한다(spec HS-75). `m2/fx-host`의 cap-web 조립에서 `modelTool` 판정(`turn_start`)과 `headerSecrets`는 가져오지 않았다(이유는 HS-75). `test/int/cap-web.int.test.ts`: SearXNG 주소가 없으면 내장 래퍼만 쓰고 떠 있는 SearXNG를 부르지 않는다, 주소를 설정하면 SearXNG를 쓰고 설정을 바꾸면 실패 탐침 기억이 풀린다, 대역 없이도 엔진의 hosted 검색이 체인에 오른다 |
| HOST.15 | G1-04 (E6) | 구현 | `createHostMcpProcessPort`가 L0의 `createMcpProcessPort`를 만들어 cap-mcp에 넘긴다(레지스트리는 `xeon.process`의 것). `m2/fx-mcp`의 `06158d2` 가운데 host 부분을 다시 썼고 cap-mcp의 `reload`·`turn_start` 단계 경계(`21cfa68`)는 T5 몫이라 가져오지 않았다. `test/assembly/mcp-process.test.ts`(포트 없음, `mcp` owner 등록, 비밀 env는 `secret_denied`), `test/int/cap-mcp-stdio.int.test.ts`(자식으로 뜬 stdio 서버의 도구를 모델이 부르고 엔진을 닫으면 프로세스가 남지 않는다), `xeon/scripts/exit-tests.txt`의 E6 줄에 더했다 |
| HOST.16 | G2-02 | 구현 | 작업 폴더 규칙 HS-76: `thread.create`가 `workspace`를 정규 절대 경로(심볼릭 링크를 푼, 있는 폴더)로 저장하고 `thread.list` 필터도 같은 형태로 견준다. 신뢰 저장소의 키와 같은 형태다. 조립 루트가 `threadWorkspaceOf`를 L2에 잇는다: cap-mcp(`McpDeps.workspaceOf`, `turn_start`의 `reload`, 엔진 기본 루트 없음), cap-knowledge(`workspaceOf`), cap-dialog(`workspaceOf`, `projectTrust`로 `.xeon/commands` 신뢰 게이트). `test/assembly/workspace.test.ts`, `test/int/workspace.int.test.ts`, `test/int/cap-mcp-workspace.int.test.ts`(엔진 작업 디렉터리의 `.mcp.json`은 읽지 않고 대화 폴더의 것을 신뢰한 뒤 읽는다), `test/int/cap-knowledge.int.test.ts`(작업 폴더 없는 대화에는 프로젝트 스킬이 없다), `test/int/command.int.test.ts`(프로젝트 명령 파일은 신뢰 뒤에만) |
| HOST.17 | G2-11 (통합 검토 M4) | 구현 | `thread.read`가 L1.persistence의 `branchItemRecords`(`itemPagesOf`)로 쪽에 든 item만 읽고 호스트는 응답 크기 예산만 맞춘다(spec HS-49). fork한 thread는 출처의 item을 이어 읽는다. `m2/fx-host` `3574d76`의 thread-read 쪽 되돌리기는 이 질의로 대신했다. `test/assembly/thread-read.test.ts`(질의에 넘긴 `before`·`limit`, head, 예산 초과, 거절 전달), `test/int/lifecycle.int.test.ts`(fork thread가 출처 item을 쪽 단위로 읽는다) |
| HOST.18 | G1-09, G2-10 (U-19, E5) | 구현 | `AssembleOptions.secretsRuntime`으로 비밀 서비스만 `memorySecrets`로 바꾸고 `test/int/secret-env.int.test.ts`가 모델 테이프 → 승인 요청(제목에 비밀 참조) → `approval.respond` → 실제 셸 실행(env에 값 주입) → `secret.approved` 감사 기록(승인 id 일치)을 한 엔진에서 확인한다. 거부하면 lease와 감사 기록이 없고, 맞지 않는 응답은 `answer_invalid`, 두 번째 응답은 `already_resolved`다. 운영의 `bash` 도구는 모델 파라미터에 `secretEnv`가 없어(L2.workspace.spec §3.3) 이 시험은 같은 셸 서비스 위에 `secretEnv`를 받는 시험 전용 도구 `bash_env`를 더해 쓴다. `test/int/approval-shapes.int.test.ts`(E5)는 질문 도구, 계획 승인, MCP 질문, 도구 승인, 비밀 사용 승인의 `approval.requested` 레코드 모양이 같음과 `origin`의 값(turnId, stepId는 이벤트 봉투와 같은 값, toolCallId, caller `main`)을 맞댄다. 도구 승인의 기억 범위는 `once`·`thread`다(`always`는 제안하지 않는다, G2-10). `m2/fx-m` `32e84b4`를 다시 썼고 이 시험들은 m2c T4(core-tools의 respond 이유, 승인 제목, caller)와 T5(cap-dialog·cap-work의 origin)가 병합된 foundation 위에서 돈다 |
| HOST.19 | G2-07 | 구현 | `host.status`의 `includeBinaries: true`일 때만 `Engine.diagnose`를 부르고 `BinaryCheckReport`에서 `path`를 뺀 `HostBinaryReport`를 `binaries`에 싣는다(`src/binary-report.ts`, spec HS-69). 취소는 `request.cancelled`. 평소 상태 조회는 점검하지 않는다. `test/handlers/host-status.test.ts`(상태 네 변형의 값 비교, 경로 비노출, 점검 횟수 0, 취소), `test/int/lifecycle.int.test.ts`(실제 점검이 wire 스키마를 지킨다) |
| HOST.20 | G2-01 | 구현 | `thread.compact`(spec HS-77): 쓰기 소유 암묵 획득 뒤 `ThreadPort.compact`가 종결·열린 turn을 거절하고 `ModelService.resolve("main")`의 바인딩과 창 크기로 `ContextService.compact`를 이유 `manual`로 부른다. `compacted`는 커밋 뒤 위치를 `position`으로 싣고, 확장 취소는 3006, 요약·커밋 실패는 3008. L1 변경은 없다(컨텍스트 서비스의 `compact`가 이미 공개 API라 core-loop에 수동 진입점을 더하지 않았다). `test/handlers/thread-compact.test.ts`(결과 값, 암묵 획득, 오류 표 전부, 제공자 본문 비노출), `test/assembly/ports.test.ts`(어댑터가 넘기는 요청 값, 거절 순서), `test/int/thread-compact.int.test.ts`(실제 엔진·테이프로 긴 대화 요약, 두 번째 호출은 `last_entry_is_compaction`, 열린 turn은 3003) |
| HOST.21 | M2 마감 재검토 2 | 구현 | 컴팩션 뒤 스킬 색인·메모리 블록의 중복을 실제 엔진에서 값으로 견준다. `test/int/compact-reinject.int.test.ts`: 모델 테이프 `test/fixtures/recording-tape.ts`가 모델이 받은 요청 본문을 모으고, 컨텍스트 창을 12000토큰으로 줄여 요청 전 임계 검사가 자동 컴팩션을 일으킨 뒤 turn이 이어진다(T4 partial). 컴팩션 전후 모든 요청에 `<available_skills>`와 메모리 항목이 한 번씩만 있고 요약이 보인다. 수동 `thread.compact` 뒤 turn도 같다. 이 시험은 `cap-knowledge`가 `session_compact`에서 상태를 비워 전체 블록을 다시 넣던 때(요청에 두 번) 실패한다. 고친 층은 L2(`L2.knowledge.spec` §4.2.8), L1 재주입은 `L1.context.spec` §4.9a |
| HOST.22 | M2 마감 재검토 3 (spec §10 31) | 구현 | 수동 컴팩션이 요약하는 사이 같은 thread의 `turn.start`가 turn을 여는 틈을 막는다. 어댑터(`assembly/ports.ts`)가 thread별 순차 구간(`assembly/thread-gate.ts`) 안에서 `threads.compact` 전체와 `turns.submit`·`turns.resume`을 돌린다. `turn.start`는 `turn.busy`가 아니라 기다린다(`turn.busy`의 `turnId`가 필수라 컴팩션에는 쓸 수 없다, spec §10 31). 시험: `test/assembly/thread-gate.test.ts`(차례, 다른 thread는 안 기다림, 실패가 뒤를 막지 않음), `test/assembly/ports.test.ts`(요약이 끝나기 전에는 `loop.admit`이 불리지 않고 끝난 뒤 접수됨, 재개도 같음, 다른 thread는 그대로), `test/int/thread-compact-turn-start.int.test.ts`(실제 엔진에서 모델 테이프가 요약 호출을 붙잡은 사이 보낸 `turn.start`가 응답하지 않고 `thread.compacted`가 turn 시작보다 먼저 커밋되며 요약에 새 입력이 없다). 수정 전에는 세 시험이 실패한다. `thread.revert`와의 겹침은 spec §10 32로 남긴다 |
| HOST.23 | M2 마감 재검토 10 | 구현 | `thread.rename`·`thread.delete`가 빌린 잠금을 어떻게 놓는지 바로잡는다. 둘 다 `holds`가 거짓일 때 잠금을 한 번 얻어 쓰고 놓는데, 그동안 같은 thread의 다른 연결이 `turn.start` 등으로 소유를 이어받아도 `finally`가 잠금을 놓아 그 연결이 잠금 없이 쓰게 됐다(두 호출이 같은 획득을 기다리면 `holds`가 "내가 얻었다"를 말해 주지 못한다). `handlers/owner.ts`의 `withWriteOwner`가 thread별 빌린 호출 수를 세어 마지막 호출이 끝날 때만 놓고, 쓰기로 연 연결·소유를 얻는 중인 `claimWrite`·진행 중 turn이 있으면 놓지 않는다. 연결 단위 소유자 검사는 spec HS-23(여러 연결이 소유를 함께 씀)에 어긋나 더하지 않았다. 시험: `test/handlers/thread-write-owner.test.ts`(가짜 엔진의 `acquireGate`로 겹침을 만든다: 이어받으면 놓지 않음, 둘이 겹친 rename은 한 번만 놓음, 거절된 delete도 같음, 빌린 뒤에는 잠금이 남지 않음), `test/int/thread-rename-owner.int.test.ts`(실제 잠금에서 rename과 turn.start가 겹친 뒤 다른 호스트의 쓰기 열기는 3002, rename만 했으면 열림). 수정 전에는 앞의 세 시험과 int 첫 시험이 실패한다 |
| HOST.24 | M2 첫 실행 (m2r sec) | 구현 | 깨끗한 기기에서 첫 `secret add`가 설정 없이 된다. `assembly/secrets.ts`의 `effectiveSecretsConfig`가 빈 `l0.secrets.sops.files`에 사용자 기본 파일을 채워 `newMeta`와 platform-secrets가 같은 파일을 보고(HS-45), 조립 루트가 `OsServiceHandle.fileLock`을 platform-secrets에 넘긴다. `test/assembly/secrets.test.ts`, `test/int/secret-first-write-processes.int.test.ts`(프로세스 둘이 동시에 첫 `add`, 실제 flock·sops·age, 임시 홈) |
