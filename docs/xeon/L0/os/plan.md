---
id: L0.os.plan
layer: L0
domain: os
kind: plan
status: draft
depends_on: [L0.os.spec, eng.testing.guide, eng.toolchain.guide]
binds: [xeon/packages/platform-os/**]
---

# L0 OS 연동 구현 계획 (platform-os)

## 1. 목표와 마일스톤 배치

목표: `L0.os.spec`의 `xeon.os` 서비스를 `xeon/packages/platform-os`에 구현한다. M0에서는 다른 L0·L1 패키지의 테스트와 구현이 쓰는 기반(경로, 시계, 로거, 테스트 도우미)을 먼저 낸다.

| 마일스톤 | 범위 | 작업 |
|---|---|---|
| M0 | `OsInfo`, `OsDirs`(3플랫폼 표, `home` 포함), `fsKind`, `Clock`·`Scheduler`·`RandomSource` 운영 구현, `Logger` 기본 구현과 마스킹 훅, ID 발급기 구현 `createIdFactory`·`createLocalIdFactory`, `testing` 서브패스(`tempDir`, `withIsolatedEnv`), 프로세스 지문·기계 식별자·uid(store 세션 잠금이 M0) | OS-01~OS-09, OS-18, OS-19 |
| M1 | 바이너리 해석(`rg`, secrets 키 명령용 `security`·`secret-tool` 포함), 서비스 등록(`xeon.os`) | OS-10~OS-11 |
| M3(1차) | 알림 전달 수단 `Notifier`(macOS·Linux 먼저) [결정: review.decisions-2 S-04] | OS-13 |
| M2 | 프로세스 사이 파일 잠금 `fileLock`(`trust.json` 쓰기), 외부 바이너리 필수/선택 표와 점검 | OS-20, OS-21 |
| M2 이후(2차) | `FileWatcher`, 텔레메트리, Windows 보강, 번들 바이너리 추출 실측 | OS-12, OS-14~OS-17 |

- [결정] M0 범위는 `contracts`, `ext-host`, `platform-store`, `platform-exec`다(`_research/foundation-plan.md` §5 P4). platform-os의 M0 작업은 store·exec 테스트가 `tempDir`과 시계 구현을 쓰기 때문에 넣는다 [제안].
- M0 작업은 `@xeon/contracts` 루트의 `Clock`, `Scheduler`, `RandomSource`, `Logger`(`L0.os.spec` §8 F에 요청 1)와 `@xeon/contracts/conversation`의 `IdFactory`·`LocalIdFactory`를 전제로 한다. F에 아직 없으면 OS-05·OS-06·OS-07·OS-19는 F 작업을 기다린다. `manualClock` 같은 테스트 대역은 F에 두지 않고 이 패키지의 `test/` 안에 둔다 [결정: review.decisions-2 U-03].
- 서비스 등록(OS-10)은 ext-host 등록 API(`ExtHost.registerPlatform`, `PlatformModule`, `X.primitives.spec` §3.2)가 필요하므로 M1에 둔다. M0에서는 다른 패키지가 함수(`systemClock` 등)를 쓰지 않고 테스트 도우미만 쓴다.

## 2. 패키지와 파일 배치

```
xeon/packages/platform-os/
  package.json              # exports ".", "./testing". xeon.layer "L0", domain "os"
  tsconfig.json
  binaries.lock.json        # 빌드 때 생성(OS-12). 소스 실행에서는 없다
  src/
    index.ts                # platformOsPlugin(PlatformModule), PlatformOsConfig, NotifierProvider 타입, createIdFactory·createLocalIdFactory export
    select.ts               # readPlatformProbe, detectPlatform, selectProviders. OS 분기는 이 파일만
    info.ts                 # OsInfo 조립 보조(순수)
    dirs.ts                 # resolveDirs(순수), ensureDirs
    fs-kind.ts              # FsKindProvider, classifyFs
    time/
      clock.ts              # systemClock
      scheduler.ts          # systemScheduler
      random.ts             # systemRandom
    file-lock/
      flock.ts              # libc flock(2) bun:ffi 호출. FFI는 이 파일에만 둔다 (OS-20)
      index.ts              # createFileLock: withLock, updateText, 프로세스 안 보유 표, 폴링 대기 (OS-20)
    logger.ts               # createJsonLinesLogger, LogRedact, LogSink
    identity.ts             # machineId, userId, processStartFingerprint (OS-18)
    ids.ts                  # createIdFactory, createLocalIdFactory (OS-19)
    binaries/
      resolve.ts            # resolveBinary, PATH 탐색, 버전 읽기
      rg.ts                 # createRipgrepSource: @vscode/ripgrep 경로 연결(소스 실행의 번들 rg). 서비스의 기본 bundledSource
      requirements.ts       # binaryRequirements(OS별 필수/선택 표), checkExternalBinaries (OS-21)
      lock.ts               # generateBinariesLock: binaries.lock.json 생성(빌드 스크립트가 부른다), resolveInsideResource
      extract.ts            # 컴파일 바이너리에서 cache/bin으로 추출, SHA-256 검사
    notify/
      provider.ts           # NotifierProvider, buildNotifyCommand, 디바운스
      darwin.ts
      linux.ts
      win32.ts
      none.ts
    watch/
      watcher.ts            # createFileWatcher, 디바운스, 경로 검사
      parcel.ts             # @parcel/watcher 백엔드
      poll.ts               # 폴링 백엔드
    telemetry/
      otel.ts               # SDK 지연 로드, exporter 구성
      spans.ts              # 스팬 이름·속성 규칙, 속성 마스킹
    service.ts              # OsService 조립, dispose 순서
    testing/
      index.ts
      temp-dir.ts
      isolated-env.ts
  test/
    *.test.ts, *.contract.test.ts, *.int.test.ts
```

- 전역 시각·난수 직접 호출은 `src/time/`에만 둔다. `ids.ts`는 주입받은 `Clock`·`RandomSource`만 쓴다. `.oxlintrc.json`의 경로 단위 예외는 `packages/platform-os/**`의 `no-restricted-properties`다(`eng.typescript.guide` §4.3 표, TY-21). [제안] 이 예외를 `packages/platform-os/src/time/**`로 좁히고, 같은 변경에서 `eng.typescript.guide` §4.3 표를 고친다.
- OS 분기 표현은 `src/select.ts`에만 둔다(`L0.os.spec` §1.1). `notify/darwin.ts` 같은 provider 파일은 OS를 판정하지 않고 `select.ts`가 고른 결과로만 쓰인다.
- `package.json` 목표 모양:

  ```json
  {
    "name": "@xeon/platform-os",
    "exports": { ".": "./src/index.ts", "./testing": "./src/testing/index.ts" },
    "dependencies": { "@xeon/contracts": "workspace:*", "@xeon/ext-host": "workspace:*", "@vscode/ripgrep": "catalog:" },
    "optionalDependencies": { "@parcel/watcher": "catalog:" },
    "xeon": { "layer": "L0", "domain": "os" }
  }
  ```

  OTel 패키지(`@opentelemetry/api`, `@opentelemetry/sdk-trace-node`, `pi-telemetry`)는 OS-15에서 더한다. 모든 버전은 워크스페이스 catalog에 정확 고정한다(`eng.toolchain.guide`).

## 3. 작업 분해

| id | 내용 | 선행 | 규모 | 마일스톤 |
|---|---|---|---|---|
| OS-01 | `select.ts`: `PlatformProbe`, `readPlatformProbe`, `detectPlatform`(WSL 판정 포함), `selectProviders` 골격. `OsInfo` | F `OsInfo`·`PlatformError` | S | M0 |
| OS-02 | `dirs.ts`: `resolveDirs`(3플랫폼 표, XDG 규칙, runtime 길이 규칙, WSL `/mnt/*` 거부), `ensureDirs`(0700 생성, 소유자·권한 검사) | OS-01 | M | M0 |
| OS-03 | `XEON_HOME` 재정의와 `l0.os.dirs.override` 반영(우선순위 `XEON_HOME` > 관리 설정 > OS 기본) | OS-02 | S | M0 |
| OS-04 | `fs-kind.ts`: `classifyFs`(순수, 분류 표), Linux statfs provider, macOS `mount` 출력 파서 | OS-01 | M | M0 |
| OS-05 | `time/`: `systemClock`, `systemScheduler`(정수 핸들 표), `systemRandom`(`crypto.getRandomValues` 53비트) | F `Clock`·`Scheduler`·`RandomSource` | S | M0 |
| OS-06 | 계약 테스트: 같은 Clock·Scheduler 계약 묶음을 운영 구현과 `manualClock`에 돌린다 | OS-05, 이 패키지 `test/`의 `manualClock` | S | M0 |
| OS-07 | `logger.ts`: `createJsonLinesLogger`(레벨, 필드 합치기, `child`, `setLevel`). 레벨은 값 또는 읽기 함수(`LogLevelSource`)로 받아 `l0.os.log.level` live 변경을 반영한다 | OS-05, F `Logger` | M | M0 |
| OS-08 | 로그 마스킹 훅 인터페이스: `LogRedact` 필수 인자, 예외 시 `log.redact_failed` 처리, 조립 루트 연결 예시 | OS-07 | S | M0 |
| OS-09 | `testing/`: `tempDir`, `withIsolatedEnv`(TS-03 변수 목록 + `XEON_HOME`), `exports "./testing"` | OS-02 | S | M0 |
| OS-10 | `service.ts`, `index.ts`: `OsService` 조립, `platformOsPlugin` 등록, 시작 순서와 `dispose` 순서(`L0.os.spec` §4) | OS-01~OS-09, ext-host `registerPlatform` | M | M1 |
| OS-11 | `binaries/resolve.ts`, `rg.ts`: `resolveBinary` 우선순위(번들 > 시스템), PATH 탐색, `--version` 파싱(`security`·`secret-tool`은 버전 확인 생략), 동시 호출 합치기, `@vscode/ripgrep` 연동 | OS-02, OS-10 | M | M1 |
| OS-12 | 번들 추출 실측과 `extract.ts`: `bun build --compile` 단일 바이너리에서 rg를 내장·추출·해시 검사·실행. `binaries.lock.json` 생성: 생성 함수 `generateBinariesLock`(`lock.ts`)는 M2 PLT.4에서 구현했고, 사이드카 빌드 스크립트(DESK.3)가 부른다. 추출·실측은 M2 이후 | OS-11 | M | M2 이후 |
| OS-13 | `notify/`: `NotifierProvider`, `buildNotifyCommand`, darwin·linux provider, `none`, 디바운스, 본문 `redact`. 켜기·종류 설정은 두지 않는다(`L2.dialog` 소유). win32는 OS-17. 완료(B0-OS): `notify-send` 가짜 바이너리 int 시험이 인자 값을 비교한다 | OS-10 | M | M3 |
| OS-14 | `watch/`: `createFileWatcher`, `WatchBackend` 포트와 `fs.watch` 백엔드(완료, B0-OS), parcel 백엔드(의존 승인 뒤 1커밋), poll 백엔드, 앱 디렉터리 밖 거부와 추가 root, 백엔드 전환 | OS-10 | M | M3b(포트·fs.watch), 이후(parcel) |
| OS-15 | `telemetry/`: SDK 지연 로드, exporter(file, otlp-http), 스팬 이름·속성 규칙, 속성 마스킹, pi-telemetry 어댑터 | OS-08, OS-10 | M | M2 이후 |
| OS-16 | 검사: `process.platform` 등 OS 분기 표현이 `select.ts` 밖에 없음을 확인하는 패키지 테스트. `check-layers.ts`의 DR-13 검사(다른 작업자 소유)에 패키지 안 규칙을 더하자는 요청 | OS-01 | S | M0 |
| OS-17 | Windows 보강: `%APPDATA%`·`%LOCALAPPDATA%` 실측, win32 알림 provider, 드라이브 종류 판정, `PATHEXT` 탐색 | OS-02, OS-11, OS-13 | L | M2 이후 |
| OS-22 | M3b B0-OS 묶음(완료): `worktree.ts`(워크트리 연산), `log-file.ts`(회전 sink, 10 MiB × 5), `bounded.ts`(진단 배열 상한 256), `product.ts`(제품 이름 상수 한 곳). 두 프로세스 `fileLock` 경합 시험은 OS-20에서 이미 있다 | OS-10 | M | M3b |
| OS-20 | `file-lock/`: `createFileLock`(`withLock`, `updateText`), `select.ts`의 `fileLock` 선택, bun:ffi `flock`. 같은 프로세스 직렬화, 자식 프로세스 SIGKILL 뒤 해제, 읽기-수정-쓰기 손실 없음을 실제 프로세스로 확인. `spec` §3.11 | OS-01, OS-10 | M | M2 |
| OS-21 | `binaries/requirements.ts`: OS별 필수/선택 표, `checkExternalBinaries`(보고서 `ready`·`blocking`·`degraded`), `OsServiceHandle.checkBinaries`. `spec` §3.6.1 | OS-11 | S | M2 |
| OS-19 | `ids.ts`: `createIdFactory`(브랜드 ID 8종), `createLocalIdFactory`(`LocalIdPrefix` 표), 같은 ms 안 단조 증가, 주입한 `Clock`·`RandomSource`만 사용. `L0.os.spec` §3.4 | OS-05 | S | M0 |
| OS-18 | `identity.ts`: `machineId`(Linux `/etc/machine-id`, macOS `IOPlatformUUID`, 실패 시 hostname 해시), `userId`, `processStartFingerprint`(Linux `/proc` 지문의 epoch ms 변환, macOS `ps -o lstart=`). spec §3.10 | OS-01 | S | M0 |

## 4. 채택 코드

| 패키지 | 버전 | 라이선스 | 쓰는 곳 | 외부 모듈 소유 패키지 | 근거 |
|---|---|---|---|---|---|
| `@vscode/ripgrep` | 1.18.0 정확 고정 | MIT | OS-11, OS-12 | `platform-os`(DR-07 표) | `_research/packages.md` §4.2 L0-f "외부 바이너리 설치". 플랫폼 패키지, postinstall 다운로드 없음, npm 락파일 무결성 해시로 검증 |
| `@parcel/watcher` | [미결: `L0.os.spec` §10 10번] 조사 시점 2.6.0(`_research/packages.md` 지원 패키지 표). OS-14 착수 전에 레지스트리에서 확인해 catalog에 정확 고정하고 이 칸을 고친다 | MIT | OS-14 | `platform-os`(DR-07 표) | N-API 프리빌드, optional 12개 플랫폼 패키지 |
| `pi-telemetry` | 1.3.0 정확 고정. npm 범위 이름(`@earendil-works/` 여부)은 [미결: `L0.os.spec` §10 10번], OS-15 착수 전 확인 | MIT [미결: 같은 항목] | OS-15 | `platform-os`(DR-07 표) | `_research/packages.md` §4.2 L0-f. 의존 0, 120KB. pi-ai가 이미 `pi.ai.request` 스팬을 낸다 |
| `@opentelemetry/sdk-trace-node` | 2.12.0 정확 고정 | Apache-2.0 | OS-15 | `platform-os`(DR-07 표) | 같은 절 |
| `@opentelemetry/api` | 1.10.0 정확 고정 | Apache-2.0 | OS-15. F는 `import type`만 | 값 import는 `platform-os`(DR-07 표) | F.readme §1, `F.wire-settings.spec` §3.6 |

채택하지 않는 것:

| 후보 | 이유 |
|---|---|
| `node-notifier` 11.0.0 | 5.7MB이고 유지 상태를 확인하지 못했다. OS 명령 호출은 40줄 안팎의 자체 구현으로 충분하다 [`_research/packages.md` §4.2 L0-f] |
| pi tools-manager 바이너리 다운로드 | 해시 검증이 없다 [`_research/packages.md` §4.2 L0-f] |
| `chokidar` 6.0.0 | 앱 파일 감시는 `@parcel/watcher` + 폴링으로 충분하다. 작업 공간 감시는 exec의 durable env `watch`가 맡는다 |
| pi durable env `watch`(node-watch.ts) | 포크는 `platform-exec` 소유다(adr.0003). os가 같은 코드를 다시 포크하지 않는다 |

- 포크 코드는 없다. `src/upstream/` 디렉터리를 두지 않는다.
- 자체 구현: 디렉터리 규칙, `fsKind`, 시계 3종, 로거, 바이너리 해석, 알림 provider, 디바운스, 텔레메트리 어댑터.
- `Bun.spawn` 사용(시스템 바이너리 `--version`, `osascript`, `notify-send`, `mount`)은 DR-07 표의 `Bun.spawn` 소유 패키지 `platform-os` 행을 따른다 [결정: review.decisions-2 U-17].

## 5. 단위 테스트 목록

| 테스트 파일 | 테스트 이름 | 확인할 동작 |
|---|---|---|
| `select.test.ts` | `detectPlatform: darwin·linux·win32 probe` | 세 probe가 각 `OsInfo`로 바뀐다 |
| `select.test.ts` | `detectPlatform: WSL 판정` | `WSL_DISTRO_NAME` 있음, `/proc/version`에 `microsoft` 있음이 각각 `isWsl: true`. 일반 Linux는 false |
| `select.test.ts` | `detectPlatform: 지원 밖 값` | `freebsd`는 `unsupported_platform`, `ia32`는 `unsupported_arch` |
| `dirs.test.ts` | `resolveDirs: 3플랫폼 × 환경 변수 조합` | XDG 변수 있음·없음·상대 경로, `XDG_RUNTIME_DIR` 없음, Windows 변수 있음·없음에서 `L0.os.spec` §3.2 표 값 |
| `dirs.test.ts` | `resolveDirs: XEON_HOME 우선` | `XEON_HOME`이 관리 설정 값과 OS 기본보다 우선하고 resource·tmp는 그대로 |
| `dirs.test.ts` | `resolveDirs: XEON_HOME 상대 경로 거부` | `not_absolute` |
| `dirs.test.ts` | `resolveDirs: WSL에서 /mnt/* 거부` | `XDG_DATA_HOME=/mnt/c/x`인 WSL probe에서 `data_dir_on_drvfs` |
| `dirs.test.ts` | `resolveDirs: runtime 길이 규칙` | 긴 `$TMPDIR`에서 `/tmp/xeon-<uid>`로 내려가고, 둘 다 길면 `runtime_path_too_long` |
| `dirs.int.test.ts` | `ensureDirs: 0700 생성` | `tempDir` 아래에 만든 디렉터리 모드가 `0o700`(macOS·Linux) |
| `dirs.int.test.ts` | `ensureDirs: 권한·소유 검사` | 0755 기존 디렉터리는 `permission_too_open`. 소유 uid 불일치는 주입된 stat으로 `not_owned` |
| `fs-kind.test.ts` | `classifyFs: Linux f_type 표` | ext4·tmpfs → local, NFS·CIFS·SMB2 → network, WSL 9p·`/mnt/c` → drvfs, FUSE → unknown(주입된 statfs 결과) |
| `fs-kind.test.ts` | `classifyFs: macOS fstypename 표` | apfs → local, smbfs·nfs → network, 그 밖 → unknown |
| `fs-kind.test.ts` | `fsKind: 없는 경로` | 가장 가까운 상위 디렉터리로 판정, 루트까지 없으면 `not_found` |
| `time.contract.test.ts` | `Clock·Scheduler 계약: 운영 구현과 manualClock` | 같은 묶음이 두 구현에서 통과: `now()` 정수, 만기 순서, `clearTimeout` 뒤 미실행, 모르는 핸들 무시, 음수·NaN 지연 = 0 |
| `scheduler.test.ts` | `systemScheduler: 취소와 만료 순서` | 10 ms·0 ms 타이머가 지연 순서로 실행되고 취소한 것은 실행되지 않는다(실제 타이머, 파일당 1초 이하) |
| `random.test.ts` | `systemRandom: 범위` | 1만 회 값이 모두 `[0, 1)` |
| `logger.test.ts` | `logger: 레벨 필터` | `info` 레벨에서 `debug`가 sink에 가지 않고 직렬화도 하지 않는다 |
| `logger.test.ts` | `logger: 필드 순서와 child` | `ts`, `level`, `event`, base, child, 호출 필드 순서로 합치고 같은 키는 뒤가 이긴다. `ts`는 주입한 `manualClock` 값 |
| `logger.test.ts` | `logger: 마스킹 훅 호출` | 모든 줄이 `redact`를 거친다. `redact`가 던지면 원문 줄이 sink에 가지 않고 `log.redact_failed` 한 줄만 간다 |
| `logger.test.ts` | `logger: setLevel` | 실행 중 레벨 변경이 다음 호출부터 반영된다 |
| `binaries.test.ts` | `resolveBinary: 번들 > 시스템` | 번들과 시스템이 모두 있으면 `source: "bundled"` |
| `binaries.test.ts` | `resolveBinary: 해시 불일치 거부` | 목록 해시와 다른 파일에서 `integrity_mismatch`, 주입한 실행 함수 호출 0회, 시스템 rg로 대체하지 않음 |
| `binaries.test.ts` | `resolveBinary: 시스템 버전 파싱과 최소 버전` | `ripgrep 14.1.0` 첫 줄에서 버전을 읽고 `minVersion` 미달이면 `version_too_old` |
| `binaries.test.ts` | `resolveBinary: 없음` | `not_found`, `searched`에 PATH 항목, `hint`가 비어 있지 않음 |
| `binaries.test.ts` | `resolveBinary: 동시 호출 합치기` | 같은 이름 동시 호출 3회에 탐색 1회 |
| `notify.test.ts` | `buildNotifyCommand: darwin·linux·win32` | 실제 알림을 띄우지 않고 argv만 검사. 따옴표·줄바꿈이 든 제목이 인자 하나로 남고 셸을 거치지 않는다 |
| `notify.test.ts` | `notify: provider none과 설정 키 없음` | provider `none`이면 `disabled`이고 실행 함수 호출 0회. 패키지 설정 선언에 `l0.os.notify.*` 키가 없다 |
| `ids.test.ts` | `createIdFactory: 접두와 단조 증가` | 같은 `manualClock` 시각에서 연속 발급한 ID가 사전순으로 증가하고 `idPattern` 검사를 통과한다. `createLocalIdFactory`의 `sls`·`bgp` ID가 `localIdPattern`을 통과한다 |
| `notify.test.ts` | `notify: notify-send 없음` | `unavailable`, 진단 로그는 첫 번째만 |
| `notify.test.ts` | `notify: 반복 디바운스` | 같은 `threadId`·`kind`가 1초 안에 두 번이면 한 번만 보낸다(`manualClock`) |
| `watch.test.ts` | `watch: 디바운스` | 가짜 백엔드 원시 변경 5건이 `debounceMs` 뒤 경로별로 합친 한 배치가 된다(`manualClock`) |
| `watch.test.ts` | `watch: 앱 디렉터리 밖 거부` | 작업 공간 경로는 `outside_app_dirs` |
| `watch.test.ts` | `watch: 한도 초과 시 폴링 전환` | native 백엔드가 `limit_reached`를 내면 poll 백엔드로 구독하고 경고 로그 1건 |
| `telemetry.test.ts` | `telemetry: 기본 꺼짐` | 기본 설정에서 `enabled: false`, 무동작 Tracer, SDK 동적 import 호출 0회 |
| `telemetry.test.ts` | `telemetry: 속성 규칙` | 허용 목록 밖 속성(본문, 인자)은 버리고 문자열 속성에 `redact` 적용 |
| `select-scan.test.ts` | `OS 분기 표현은 select.ts에만` | `src/**`에서 `process.platform`, `os.platform(`, `WSL_DISTRO_NAME`, `/proc/version` 문자열이 `select.ts` 밖에 0건 |
| `testing.test.ts` | `withIsolatedEnv: 변수 격리와 복원` | 실행 중 `HOME`·`XDG_*`·`TMPDIR`·`XEON_HOME`이 임시 경로, 지정 변수는 없음. 끝난 뒤(예외 포함) 원래 값 |
| `testing.test.ts` | `tempDir: 두 번 지우기` | `remove()`를 두 번 불러도 오류가 없다 |
| `identity.test.ts` | `processStartFingerprint: 같은 pid는 같은 값, 없는 pid는 null` | 자기 pid 두 번 호출 값이 같고, 끝난 자식 pid는 `ok(null)`. Linux `/proc` 지문 변환은 주입한 파일 내용으로 확인 |

- 파일 이름 접미사와 태그는 `eng.testing.guide` TS-01을 따른다. 실제 파일 시스템을 쓰는 것은 `.int.test.ts`이고 `tempDir` 아래에서만 쓴다.
- 실제 시간을 기다리는 테스트는 `scheduler.test.ts` 하나다. 나머지는 `manualClock`을 쓴다(TS-03).

## 6. 완료 기준

1. `just verify`가 종료코드 0이다.
2. M0: `platform-store`, `platform-exec`와 L1 패키지 테스트가 `@xeon/platform-os/testing`의 `tempDir`로 임시 디렉터리를 만들고, 자기 패키지에 임시 디렉터리 코드를 따로 두지 않는다.
3. M0: `Date.now`, `Math.random`, `performance.now` 직접 호출 금지 lint(oxlint `no-restricted-properties`, 스캔 `xeon/no-ambient-time`)가 `packages/platform-os` 밖에서 0건이다.
4. M0: `time.contract.test.ts`가 운영 구현과 `manualClock`에서 모두 통과한다.
5. M1: 조립 루트가 `platformOsPlugin`을 등록하고, `xeon chat` 스모크에서 sandbox가 `resolveBinary("rg")`로 받은 경로를 쓴다.
6. `L0.os.spec` §9 수용 기준 1~10에 대응하는 테스트가 있고 통과한다(2차 항목은 해당 마일스톤에서).
7. `just check-layers`가 platform-os에서 위반 0건이다.

## 7. 위험과 대응

| 위험 | 대응 | 확인 방법 |
|---|---|---|
| `@parcel/watcher` 네이티브 모듈이 Bun 또는 `bun build --compile` 바이너리에서 로드되지 않음 | 폴링 백엔드를 기본으로 바꾼다 | OS-14에서 컴파일 바이너리로 `watch` 스모크를 돌려 백엔드 id가 `native`인지 로그로 확인 |
| OTel SDK가 Bun에서 컨텍스트 전파를 못 함 | 텔레메트리 어댑터를 지연 로드하고, 실패하면 꺼진 상태로 다룬다 | OS-15에서 중첩 스팬 2개를 만들어 부모 id가 이어지는지 file exporter 출력으로 확인 |
| 번들 바이너리 추출 위치에 쓰기 권한이 없음, Windows 백신이 추출 파일을 잠그거나 오탐 | `extract_failed`로 보고하고 시스템 바이너리 안내. 추출 위치를 `cache`로 고정하고 해시 이름 디렉터리를 쓴다 | OS-12에서 읽기 전용 cache 픽스처로 오류 값 확인, OS-17에서 Windows 러너 실측 |
| `bun build --compile`의 파일 내장이 실행 파일 추출을 지원하지 않음 | 사이드카 옆에 rg를 별도 파일로 배포(Tauri `externalBin`)하고 `resource`에서 찾는다 | OS-12 실측 결과를 이 표에 기록 |
| Linux 알림 데몬 부재(WSL, 헤드리스) | 무음 + 진단 한 번. 작업 흐름은 알림 실패로 멈추지 않는다 | `notify.test.ts` `notify-send 없음` 테스트 |
| 디렉터리 규칙이 사용자의 기존 설정 위치와 충돌(마이그레이션 필요 여부 [미결]) | 첫 실행에서 다른 후보 위치(`~/.config/xeon` 등)에 파일이 있으면 경고 로그로 알리고 옮기지 않는다 [제안] | OS-02에서 후보 위치 표를 테스트로 고정, 사용자 결정 뒤 마이그레이션 작업 추가 |
| 시계 대역(`manualClock`)과 운영 구현의 계약 불일치(음수 지연, 같은 시각 만기 순서) | 계약 테스트 묶음 하나를 두 구현에 돌린다 | OS-06 `time.contract.test.ts` |
| macOS `mount` 출력 형식이 버전마다 다름 | 파서가 모르는 줄은 건너뛰고 `unknown`으로 판정 | OS-04에서 macOS 14·15 출력 픽스처 [가정: 실제 출력 수집 필요] |
