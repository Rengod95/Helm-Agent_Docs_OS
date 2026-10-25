---
id: L0.os.spec
layer: L0
domain: os
kind: spec
status: draft
depends_on: [eng.typescript.guide, eng.best-practices.guide, eng.testing.guide, F.wire-settings.spec, F.readme]
binds: [xeon/packages/platform-os/**]
---

# L0 OS 연동 (platform-os)

## 1. 목적과 범위

### 1.1 정하는 것

서비스 `xeon.os`(F 인터페이스 `OsService`)를 정한다. 패키지는 `@xeon/platform-os`다(`eng.context-map.design` §5.3). 내용은 두 묶음이다.

| 묶음 | 구성요소 | 범위 | 근거 |
|---|---|---|---|
| 기반 | 플랫폼 정보 `OsInfo`, 디렉터리 `OsDirs`, 파일 시스템 종류 `fsKind`, 시각·타이머·난수(`Clock`, `Scheduler`, `RandomSource`의 운영 구현), 로거(`Logger`의 운영 구현) | M0 | `eng.typescript.guide` §1.2·TY-21, `eng.best-practices.guide` BP-05·BP-12, `eng.testing.guide` TS-03 |
| 연동 | 외부 바이너리 해석 `resolveBinary` | 1차(M1) | `_research/layer-plan-v2.json` L0-f "외부 바이너리", `_research/packages.md` §4.2 L0-f |
| 연동 | 사용자 알림 전달 수단 `Notifier` | 1차(M3) [결정: review.decisions-2 S-04, 결정 2] | `_research/layer-plan-v2.json` L0-f, `L2.dialog.spec` §4.7 |
| 연동 | 앱 파일 감시 `FileWatcher`, 텔레메트리 스팬 | 2차(M2 이후) | `_research/layer-plan-v2.json` L0-f |

- 이 패키지는 다른 L0 패키지와 L1 이상이 묻는 경로·시각·바이너리 위치 질의에 값을 돌려주는 서비스다. 다른 L0 패키지는 `platform-os`를 import하지 않고 F 인터페이스 `OsService`를 Cordis로 주입받는다(`eng.dependency-rules.guide` DR-02, DR-14).
- OS 분기 표현(`process.platform`, `os.platform()`, `os.release()`, `WSL_DISTRO_NAME`, `/proc/version`)은 이 패키지 안에서도 `src/select.ts`에만 둔다(DR-13, `L0.readme` §3.1).
- 전역 시각·난수 API(`Date.now`, `new Date()` 인자 없음, `Math.random`, `performance.now`, `crypto.getRandomValues`)를 직접 호출해도 되는 유일한 패키지다(`eng.typescript.guide` TY-21, §4.3 경로 단위 예외).

### 1.2 다루지 않는 것

| 대상 | 정하는 곳 |
|---|---|
| 작업 공간 파일 감시 | `L0.exec.spec`(`ExecutionEnv.watch`) |
| 설정 파일 위치 결정과 읽기 | L4. 이 패키지는 `OsDirs.config` 경로만 준다 |
| 비밀 마스킹 규칙 | `L0.secrets.spec`. 이 패키지의 로거는 마스킹 함수를 주입받는다 |
| 로그 출력 위치 선택(stderr, 파일, 데스크톱 UI) | L4 진입점(`eng.best-practices.guide` BP-12) |
| sops·age 실행, srt 실행 | `L0.secrets.spec`, `L0.sandbox.spec`. 이 패키지는 바이너리 경로만 해석한다 |
| 서비스 소켓·등록 파일 형식 | `L0.process.spec`. 이 패키지는 `OsDirs.runtime` 디렉터리만 준다 |
| 알림을 보낼 시점, 알림 종류, 켜기·끄기 설정과 그 기본값·탭 | `L2.dialog.spec` §4.7(`dialog.notify`, `l2.dialog.notify.*`). 이 패키지는 받은 알림을 OS 수단으로 내보내는 전달 수단만 소유한다 [결정: review.decisions-2 S-04] |

## 2. 용어

| 용어 | 뜻 |
|---|---|
| provider | OS·환경마다 바뀌는 내부 구현 단위. `src/providers/` 또는 기능 디렉터리 아래 `darwin.ts`, `linux.ts`, `win32.ts`로 둔다(`L0.readme` §3.1) |
| 환경 provider | OS 대신 배포 환경 기준으로 고르는 provider. 예: `desktop-tauri` 알림 provider. L4가 플러그인 설정으로 넘긴다 |
| 번들 바이너리 | 앱과 함께 배포되는 실행 파일(예: `@vscode/ripgrep` 플랫폼 패키지의 `rg`) |
| 시스템 바이너리 | 사용자가 OS에 설치한 실행 파일(`PATH`에서 찾는다) |
| drvfs | WSL에서 Windows 드라이브를 마운트한 파일 시스템(`/mnt/c` 등). WSL2에서는 9p 프로토콜이다 |
| 앱 파일 | Xeon이 `OsDirs` 아래에 두는 설정·스킬·플러그인 파일. 작업 공간 파일과 구분한다 |

## 3. 인터페이스

### 3.0 위치

- `OsService`와 그 값 타입, 서비스 이름 상수는 F `@xeon/contracts/services` 서브패스(`src/services/os.ts`)에 둔다 [결정: review.decisions-2 D-04].
- `Clock`, `Scheduler`, `TimerHandle`, `RandomSource`, `Logger`, `LogLevel`, `LogValue`, `LogFields`는 인터페이스만 F 루트 base(`@xeon/contracts`)에 두고 구현은 이 패키지에 둔다 [결정: review.decisions-2 U-03, `F.readme` §3·§8 10번]. `IdFactory`·`LocalIdFactory` 인터페이스는 `@xeon/contracts/conversation`이고 구현(`createIdFactory`, `createLocalIdFactory`)은 이 패키지가 둔다(3.4절).
- 아래 코드는 F에 들어갈 정의 초안과 `platform-os` 내부 정의를 함께 적는다. 각 블록 첫 줄 주석이 위치다.

### 3.1 플랫폼 정보

```ts
// F: @xeon/contracts/services  src/services/os.ts
import { Type, type TUnsafe } from "typebox";

export type OsPlatform = "darwin" | "linux" | "win32";
export type OsArch = "x64" | "arm64";

export interface OsInfo {
  readonly platform: OsPlatform;
  readonly arch: OsArch;
  /** linux이고 WSL 커널일 때 true. 다른 플랫폼은 항상 false */
  readonly isWsl: boolean;
  /** os.release() 값. 표시와 진단용이며 분기에 쓰지 않는다 */
  readonly release: string;
}
export const OsInfoSchema: TUnsafe<OsInfo> = Type.Unsafe<OsInfo>(Type.Object({
  platform: Type.Union([Type.Literal("darwin"), Type.Literal("linux"), Type.Literal("win32")]),
  arch: Type.Union([Type.Literal("x64"), Type.Literal("arm64")]),
  isWsl: Type.Boolean(),
  release: Type.String({ maxLength: 256 }),
}, { additionalProperties: false }));

export type PlatformError =
  | { readonly kind: "unsupported_platform"; readonly platform: string }
  | { readonly kind: "unsupported_arch"; readonly arch: string };
```

```ts
// platform-os 내부: src/select.ts  (OS 분기 표현이 허용되는 유일한 파일)
import type { Result } from "@xeon/contracts";
import type { OsInfo, PlatformError } from "@xeon/contracts/services";

export interface PlatformProbe {
  readonly platform: string;          // process.platform
  readonly arch: string;              // process.arch
  readonly release: string;           // os.release()
  readonly wslDistro: string | undefined;     // env WSL_DISTRO_NAME
  readonly procVersion: string | undefined;   // /proc/version 내용(linux만 읽는다)
}

/** 운영에서 PlatformProbe를 채운다. 테스트는 이 함수를 쓰지 않고 probe를 직접 만든다 */
export function readPlatformProbe(): PlatformProbe;

/** 순수 함수. probe → OsInfo */
export function detectPlatform(probe: PlatformProbe): Result<OsInfo, PlatformError>;

/** OsInfo로 provider 묶음을 고른다. provider 선택은 이 함수 한 곳에서 한다 */
export function selectProviders(info: OsInfo, env: EnvOverrides): OsProviders;
```

- WSL 판정 [제안]: `platform === "linux"`이고 `wslDistro`가 비어 있지 않거나 `procVersion`에 `microsoft` 또는 `WSL`(대소문자 무시)이 있으면 `isWsl = true`다. WSL1과 WSL2는 구분하지 않는다. WSL1 지원 여부는 sandbox 등 도메인 spec이 정한다.
- `process.platform`이 `darwin`·`linux`·`win32` 밖이면 `unsupported_platform`, `process.arch`가 `x64`·`arm64` 밖이면 `unsupported_arch`다. 이 값은 지원 OS보다 넓은 외부 값이라 `Result`로 돌려준다(TY-11, TY-14 열린 외부 값 예외).

### 3.2 디렉터리

```ts
// F: @xeon/contracts/services  src/services/os.ts
export interface OsDirs {
  /** 사용자 홈(os.homedir()). 보호 경로 계산(L0.sandbox.spec §3.3)과 서비스 cwd에 쓴다. ensureDirs가 만들거나 검사하지 않는다 */
  readonly home: string;
  /** 세션 DB, 블롭, 지식 저장소 */
  readonly data: string;
  /** 사용자 설정 파일, 스킬·플러그인 설치 디렉터리 */
  readonly config: string;
  /** 지우고 다시 만들 수 있는 캐시(번들 바이너리 추출 위치 포함) */
  readonly cache: string;
  /** 로그, 복구 표식처럼 기기에 남는 상태 */
  readonly state: string;
  /** 서비스 소켓과 등록 파일. 짧은 경로여야 한다 */
  readonly runtime: string;
  /** 앱과 함께 배포된 읽기 전용 자원(번들 바이너리 원본 등) */
  readonly resource: string;
  /** 프로세스 단위 임시 파일 */
  readonly tmp: string;
}

export type DirsError =
  | PlatformError
  | { readonly kind: "env_missing"; readonly name: string }                  // HOME, APPDATA 등
  | { readonly kind: "not_absolute"; readonly dir: keyof OsDirs; readonly path: string }
  | { readonly kind: "data_dir_on_drvfs"; readonly dir: keyof OsDirs; readonly path: string }
  | { readonly kind: "runtime_path_too_long"; readonly path: string; readonly bytes: number; readonly limit: number }
  | { readonly kind: "not_owned"; readonly path: string }                    // 남이 만든 디렉터리
  | { readonly kind: "permission_too_open"; readonly path: string; readonly mode: number }
  | { readonly kind: "io"; readonly path: string; readonly code: string }
  | { readonly kind: "cancelled" };                                          // ensureDirs의 signal이 중단됐다. 이미 만든 디렉터리는 그대로 둔다
```

```ts
// platform-os 내부: src/dirs.ts
export interface EnvReader {
  get(name: string): string | undefined;
}
export interface DirsInput {
  readonly info: OsInfo;
  readonly env: EnvReader;
  readonly home: string;            // os.homedir()
  readonly systemTmp: string;       // os.tmpdir()
  readonly uid: number | undefined; // process.getuid?.(). Windows는 undefined
  readonly resourceDir: string;     // L4가 플러그인 설정으로 넘긴다
}

/** 순수 함수. 파일 시스템을 건드리지 않는다 */
export function resolveDirs(input: DirsInput): Result<OsDirs, DirsError>;

/**
 * 위치만 정한다: 플랫폼 판별과 resolveDirs를 이어 부르고 파일 시스템도 서비스도 건드리지 않는다. createOsService가 쓰는 규칙과 같다.
 * 서비스를 띄우지 않는 쪽이 같은 경로를 얻는다(L4 host의 resolveHostStatePaths, L4.host-service.spec §3.3.6) [결정: review.decisions-2 B-07]
 */
export function resolveOsDirs(config: { resourceDir: string; dirsOverride?: string }, runtime?: OsRuntime): Result<OsDirs, DirsError>;

/** 디렉터리를 만들고 권한·소유자를 확인한다. resource는 만들지 않는다 */
export function ensureDirs(dirs: OsDirs, fs: DirFs, signal: AbortSignal): Promise<Result<void, DirsError>>;
```

[제안] 플랫폼별 값. `~`는 `home`, `<uid>`는 사용자 번호다.

| 디렉터리 | macOS | Linux(WSL2 포함) | Windows |
|---|---|---|---|
| data | `~/Library/Application Support/xeon` | `${XDG_DATA_HOME:-~/.local/share}/xeon` | `%LOCALAPPDATA%\xeon\data` |
| config | `~/Library/Application Support/xeon/config` | `${XDG_CONFIG_HOME:-~/.config}/xeon` | `%APPDATA%\xeon` |
| cache | `~/Library/Caches/xeon` | `${XDG_CACHE_HOME:-~/.cache}/xeon` | `%LOCALAPPDATA%\xeon\cache` |
| state | `~/Library/Application Support/xeon/state` | `${XDG_STATE_HOME:-~/.local/state}/xeon` | `%LOCALAPPDATA%\xeon\state` |
| runtime | `$TMPDIR/xeon`. 아래 길이 규칙을 넘으면 `/tmp/xeon-<uid>` | `$XDG_RUNTIME_DIR/xeon`. 변수가 없으면 `/tmp/xeon-<uid>` | `%LOCALAPPDATA%\xeon\run`(등록 파일만. 소켓 대안은 `L0.process.spec`) |
| home | `home` | `home` | `home`(`%USERPROFILE%`) |
| resource | `resourceDir` | `resourceDir` | `resourceDir` |
| tmp | `<systemTmp>/xeon-<uid>` | `<systemTmp>/xeon-<uid>` | `%TEMP%\xeon` |

- `XEON_HOME` 재정의 [제안]: 환경 변수 `XEON_HOME`이 있으면 data=`$XEON_HOME/data`, config=`$XEON_HOME/config`, cache=`$XEON_HOME/cache`, state=`$XEON_HOME/state`, runtime=`$XEON_HOME/run`이다. runtime이 길이 규칙을 넘으면 그 OS의 기본 runtime을 쓴다. resource와 tmp는 바꾸지 않는다. `XEON_HOME`은 절대 경로여야 한다(`not_absolute`). 설정 키 `l0.os.dirs.override`는 같은 값을 관리 범위에서 주는 수단이다(6절). 둘 다 있으면 `XEON_HOME`이 이긴다.
- macOS config [제안]: Apple 관례의 `~/Library/Preferences`는 plist용이라 쓰지 않는다. CLI 사용자가 `~/.config/xeon`을 기대할 수 있다는 점은 미결 5다.
- XDG 변수가 상대 경로이면 XDG 규격대로 무시하고 기본값을 쓴다.
- 권한 [제안]: `ensureDirs`는 data, config, cache, state, runtime, tmp를 `0o700`으로 만든다. 이미 있으면 소유자가 현재 uid인지(`not_owned`), 그룹·기타 권한 비트가 없는지(`permission_too_open`) 확인한다. `/tmp/xeon-<uid>`처럼 공유 위치 아래 디렉터리는 두 검사를 반드시 한다. Windows는 권한 비트를 검사하지 않는다(5절).
- runtime 길이 규칙: process 문서의 요구를 받는다. Unix 소켓 경로 `sun_path` 한계는 macOS 104바이트, Linux 108바이트다 [가정: 플랫폼 헤더 값]. [제안] `runtime` 경로의 UTF-8 바이트 수에 소켓 파일 이름 여유 24바이트를 더한 값이 macOS 100, Linux 104를 넘으면 다음 후보로 내려가고, 마지막 후보도 넘으면 `runtime_path_too_long`이다. 소켓 상대 경로 상한 24바이트는 `L0.process.spec` §4.4.1의 `SOCKET_RELATIVE_PATH_MAX_BYTES`다.
- runtime 경로와 폴백(`/tmp/xeon-<uid>`)은 이 절에서만 정한다. `L0.process.spec`은 `OsDirs.runtime`을 그대로 쓰고 경로를 다시 계산하지 않는다.
- WSL [제안]: WSL은 Linux로 다룬다. 해석한 data, state, cache, runtime이 `/mnt/` 아래이면 `data_dir_on_drvfs`로 거부한다. SQLite WAL과 `flock` 동작을 drvfs에서 확인하지 못했기 때문이다(`_research/notes/L0-2.md`). config는 `/mnt/` 아래여도 허용하되 경고 로그를 남긴다.

### 3.3 파일 시스템 종류

```ts
// F: @xeon/contracts/services  src/services/os.ts
export type FsKind = "local" | "network" | "drvfs" | "unknown";
export type FsKindError =
  | { readonly kind: "not_found"; readonly path: string }
  | { readonly kind: "io"; readonly path: string; readonly code: string }
  | { readonly kind: "cancelled" };
```

```ts
// platform-os 내부: src/fs-kind.ts
export interface FsKindProvider {
  /** 경로가 속한 파일 시스템의 원시 정보. 운영은 statfs, 테스트는 표를 주입한다 */
  probe(path: string, signal: AbortSignal): Promise<Result<FsProbe, FsKindError>>;
}
export interface FsProbe {
  readonly typeMagic: number | undefined;  // Linux statfs f_type
  readonly typeName: string | undefined;   // macOS f_fstypename (예: "apfs", "smbfs", "nfs")
}
/** 순수 함수. 분류 표는 아래 */
export function classifyFs(info: OsInfo, probe: FsProbe): FsKind;
```

| 플랫폼 | 입력 | local | network | drvfs | unknown |
|---|---|---|---|---|---|
| Linux | `f_type` | ext4·btrfs·xfs·tmpfs·overlayfs 등 | NFS `0x6969`, SMB `0x517B`, CIFS `0xFF534D42`, SMB2 `0xFE534D42` | WSL이고 9p `0x01021997` 또는 경로가 `/mnt/<문자>/` | FUSE `0x65735546` 등 표에 없는 값 |
| macOS | `f_fstypename` | `apfs`, `hfs` | `nfs`, `smbfs`, `afpfs`, `webdav` | 해당 없음 | 그 밖 |
| Windows | 드라이브 종류 | 고정 디스크 | 네트워크 드라이브, UNC 경로 | 해당 없음 | 그 밖 |

- 쓰임: `L0.store.spec`이 DB 파일 위치의 WAL 가능 여부를 판단할 때 묻는다. `network`, `drvfs`, `unknown`의 처리(거부, 경고, 저널 모드 변경)는 store가 정한다.
- `FsKind` 값 집합(`local`, `network`, `drvfs`, `unknown`)은 F 정본이고 `L0.store.spec`도 같은 타입을 쓴다. store는 동기 열기 경로에서 쓰므로 조립 루트가 DB 디렉터리에 대해 이 메서드를 미리 불러 결과 값을 `StoreEnvironment.dbDirFsKind`로 넘긴다(`L0.store.spec` §3.2). 오류(`FsKindError`)이면 조립 루트가 `unknown`으로 넘긴다 [제안].
- [가정] Bun의 `node:fs` `statfs`가 Linux에서 `type`(f_type)을 돌려준다. macOS의 `f_fstypename`은 `statfs` 결과에 없으므로 `mount` 명령 출력에서 마운트 지점 표를 읽어 가장 긴 접두사로 고른다 [제안]. 이 표는 서비스 수명 동안 한 번 읽고 캐시한다. Windows 수단은 2차에 정한다.
- 경로가 아직 없으면 가장 가까운 상위 디렉터리로 판정한다. 루트까지 없으면 `not_found`다.

### 3.4 시계, 타이머, 난수

```ts
// F 루트 base (eng.typescript.guide §1.2 그대로)
export interface Clock { now(): number }
export type TimerHandle = number;
export interface Scheduler {
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}
export type RandomSource = () => number;
```

```ts
// platform-os 내부: src/time/clock.ts, scheduler.ts, random.ts
export function systemClock(): Clock;               // now() = Date.now()
export function systemScheduler(): Scheduler;       // 전역 setTimeout을 감싼다
export function systemRandom(): RandomSource;       // crypto.getRandomValues 기반 [0, 1)
```

- `systemClock().now()`는 epoch ms 정수다. 단조성은 보장하지 않는다. ULID 단조성은 `IdFactory` 쪽 문제다(F.readme §8 미결 8).
- `systemScheduler`: Bun의 `setTimeout`은 숫자가 아닌 타이머 객체를 돌려준다 [가정]. 그래서 내부에서 1부터 증가하는 정수 핸들을 발급하고 `Map<TimerHandle, Timer>`로 대응한다. `clearTimeout`에 모르는 핸들이 오면 아무것도 하지 않는다. 만기 콜백이 던진 예외는 잡지 않는다(`Bug` 전파).
- `ms`가 음수이거나 `NaN`이면 0으로 다룬다. 테스트 대역 `manualClock`도 같은 규칙이어야 한다(계약 테스트, 9절).
- `systemRandom`: `crypto.getRandomValues(new Uint32Array(2))`의 53비트로 `[0, 1)` 값을 만든다 [제안]. `Math.random`보다 예측이 어렵고 `createIdFactory`·`createLocalIdFactory`가 ULID 난수 부분에 쓴다.
- [제안] 경과 시간은 `Clock.now()` 두 값의 차이로 잰다. 단조 시계(`performance.now`)를 F 계약에 더할지는 미결 6이다.
- ID 발급기 구현은 이 패키지에 둔다 [결정: review.decisions-2 U-03]. F에는 인터페이스 `IdFactory`·`LocalIdFactory`(`F.conversation.spec` §3.2, §3.2.1)만 있다.

```ts
// platform-os 공개: src/ids.ts
import type { IdFactory, LocalIdFactory } from "@xeon/contracts/conversation";
/** 브랜드 ID 8종(thr, trn, stp, itm, prt, evt, efx, ckp) 발급. ULID 시각 부분은 clock, 난수 부분은 random */
export function createIdFactory(clock: Clock, random: RandomSource): IdFactory;
/** 도메인 지역 ID(LocalIdPrefix 표의 sls, bgp 등) 발급. 같은 ULID 규칙 */
export function createLocalIdFactory(clock: Clock, random: RandomSource): LocalIdFactory;
```

- 조립 루트가 두 발급기를 만들어 `deps`로 다른 패키지에 넘긴다(BP-05). 다른 L0 패키지와 L1 이상은 `platform-os`를 import하지 않고 주입받은 발급기만 쓴다.
- 같은 ms 안의 단조성은 `IdFactory` 구현이 지킨다(`F.readme` §8 미결 8).

### 3.5 로거

`Logger` 인터페이스 위치는 (a)안으로 정해졌다 [결정: review.decisions-2 U-03, `F.readme` §8 10번]. 검토한 선택지:

| 안 | 내용 | 장점 | 단점 |
|---|---|---|---|
| (a) | F 루트 base에 `Logger`, `LogLevel`, `LogFields` 인터페이스를 두고 운영 구현은 `platform-os` | F·X를 포함한 모든 층이 같은 이름으로 주입받는다. X(`ext-host`)는 순위상 L0를 import할 수 없으므로 인터페이스가 F에 있어야 쓸 수 있다. `Clock`·`RandomSource`와 같은 곳에 있어 BP-05의 주입 목록이 한 위치에서 나온다 | F 루트에 이름이 셋 늘어난다 |
| (b) | `platform-os`가 인터페이스를 정의하고 export | os 한 곳에서 끝난다 | L1 이상이 `platform-os`를 import해야 하는데 DR-14가 금지한다. X는 순위상 쓸 수 없다. 결국 F로 옮겨야 한다 |

(a)안의 근거는 위 표의 X 제약과 DR-14다. 정의:

```ts
// F: @xeon/contracts 루트 base  src/base/log.ts
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogValue = string | number | boolean | null | readonly LogValue[] | { readonly [k: string]: LogValue };
export type LogFields = { readonly [k: string]: LogValue };

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** 고정 필드를 더한 자식 로거 */
  child(fields: LogFields): Logger;
}
```

```ts
// platform-os 내부: src/logger.ts
/** 마스킹 함수. 조립 루트가 platform-secrets의 마스킹 기능을 이 자리에 연결한다 */
export type LogRedact = (line: string) => string;
/** 한 줄을 받아 내보낸다. 운영 기본은 L4가 넘기는 stderr 쓰기 함수 */
export type LogSink = (line: string) => void;

export interface JsonLinesLoggerOptions {
  readonly clock: Clock;
  readonly sink: LogSink;
  readonly level: LogLevel;
  readonly redact: LogRedact;      // 없으면 조립 실패. 무동작이 필요하면 명시적으로 identity를 넘긴다
  readonly baseFields?: LogFields;
}
export function createJsonLinesLogger(opts: JsonLinesLoggerOptions): Logger & { setLevel(level: LogLevel): void };
```

- 형식: 한 줄에 JSON 객체 하나(JSON Lines). 필드는 `ts`(`clock.now()`), `level`, `event`, 그 뒤 `baseFields`, `child` 필드, 호출 필드 순서로 합친다. 같은 키는 뒤가 이긴다.
- `event`는 고정 이름(`turn.finished` 꼴)이다. 문자열 보간 메시지를 받지 않는다(BP-12).
- 마스킹: 직렬화한 한 줄 전체를 `redact`에 넘긴 뒤 `sink`로 보낸다. `platform-os`는 `platform-secrets`를 import하지 않는다. 조립 루트(`apps/host`)가 `xeon.secrets`의 마스킹 함수를 `redact`에 연결한다. `redact`가 던지면 그 줄을 버리고 `{"event":"log.redact_failed"}` 한 줄만 쓴다(원문이 새지 않게).
- 출력 위치: `sink`는 L4가 고른다(BP-12). stdio JSON-RPC 사이드카에서는 stdout을 쓰면 안 되므로 기본값은 stderr이고, 데스크톱 사이드카는 L4가 파일 sink를 줄 수 있다 [제안].
- 레벨 미만 호출은 직렬화하지 않는다. 설정 `l0.os.log.level`(`runtimeChange: "live"`) 변경은 두 방법으로 반영한다. `PlatformOsConfig.logLevel`에 함수 `() => LogLevel`을 주면 로그를 낼 때마다 그 값을 읽어 구독 없이 다음 호출부터 반영된다(조립 루트가 설정 조회 함수를 넘긴다) [결정: m2 마감 G1-12]. `setLevel`(`OsServiceHandle.setLogLevel`)을 부르면 그 값으로 고정하고 함수 읽기를 멈춘다.

테스트 대역 구분:

| 대역 | 위치 | 용도 |
|---|---|---|
| `manualClock`, `seededRandom`, `fixedIdFactory` | 쓰는 패키지의 `test/` 안 | 시각·타이머·난수·ID. F에는 `./testing` 서브패스를 두지 않는다 [결정: review.decisions-2 U-03] |
| `memoryLogger` [제안] | 쓰는 패키지의 `test/` 안 | 기록된 로그 줄 배열을 돌려주는 `Logger`. BP-05 좋은 예가 쓰는 이름 |
| `tempDir`, `withIsolatedEnv` | `@xeon/platform-os/testing` | 임시 디렉터리, 격리된 환경 변수. 파일 시스템을 쓰므로 L0에 둔다 |

```ts
// platform-os: src/testing/index.ts  (exports "./testing")
export interface TempDir {
  readonly path: string;
  /** 지우기. afterEach에서 부른다. 두 번 불러도 된다 */
  remove(): Promise<void>;
}
export function tempDir(prefix?: string): Promise<TempDir>;

/** HOME, XDG_*, TMPDIR, XEON_HOME을 임시 디렉터리로 바꾸고
 *  *_API_KEY, ANTHROPIC_*, OPENAI_*, SOPS_AGE_KEY*, SSH_AUTH_SOCK을 지운 채 fn을 실행한 뒤 되돌린다 */
export function withIsolatedEnv<T>(fn: (env: IsolatedEnv) => Promise<T>): Promise<T>;
export interface IsolatedEnv {
  readonly home: string;
  readonly vars: Readonly<Record<string, string>>;
}
```

- `withIsolatedEnv`가 지우는 변수 목록은 `eng.testing.guide` TS-03 표가 정본이다. `XEON_HOME`을 더한 것은 이 문서의 추가다 [제안].
- `withIsolatedEnv`는 프로세스 전역 `process.env`를 바꾸므로 같은 파일 안에서 병렬로 돌리지 않는다. `bun test`의 파일 단위 실행을 전제로 한다 [가정].

### 3.6 외부 바이너리 (1차)

```ts
// F: @xeon/contracts/services  src/services/os.ts
export type BinaryName = "rg" | "sops" | "age" | "git" | "bwrap" | "socat" | "security" | "secret-tool";
export type BinarySource = "bundled" | "system";

export interface ResolveBinaryOptions {
  /** 최소 버전(semver). 시스템 바이너리에만 적용한다 */
  readonly minVersion?: string;
  /** 기본 true. false면 번들만 본다 */
  readonly allowSystem?: boolean;
}
export interface ResolvedBinary {
  readonly name: BinaryName;
  readonly path: string;          // 실행 가능한 절대 경로
  readonly version: string;
  readonly source: BinarySource;
}
export type BinaryError =
  | PlatformError
  | { readonly kind: "not_found"; readonly name: BinaryName; readonly searched: readonly string[]; readonly hint: string }
  | { readonly kind: "version_too_old"; readonly name: BinaryName; readonly found: string; readonly required: string }
  | { readonly kind: "version_unreadable"; readonly name: BinaryName; readonly path: string }
  | { readonly kind: "integrity_mismatch"; readonly name: BinaryName; readonly expected: string; readonly actual: string }
  | { readonly kind: "extract_failed"; readonly name: BinaryName; readonly code: string }
  | { readonly kind: "cancelled" };
```

이름 목록과 소유 도메인 [제안]:

| 이름 | 쓰는 도메인 | 번들 | 부재 시 |
|---|---|---|---|
| `rg` | sandbox(srt가 macOS·Linux에서 요구), L2 workspace(검색 도구) | 예. `@vscode/ripgrep` 1.18.0 플랫폼 패키지 | 번들이 깨졌으면 `integrity_mismatch` |
| `sops`, `age` | secrets | 미정(미결 3) | `not_found` + 설치 안내 |
| `git` | exec(작업 트리 격리, 2차), L2 workspace | 아니오 | `not_found` + 설치 안내 |
| `bwrap`, `socat` | sandbox(Linux) | 미정(미결 3) | `not_found` + 패키지 관리자 안내 |
| `security` | secrets(macOS Keychain 키 명령, `L0.secrets.spec` §3.7) | 아니오(OS 내장 `/usr/bin/security`) | `not_found`. macOS에서는 생기지 않는다고 본다 [가정] |
| `secret-tool` | secrets(Linux Secret Service 키 명령) | 아니오 | `not_found` + 패키지 관리자 안내(libsecret-tools). secrets는 파일 폴백으로 간다 |

해석 순서:

1. 번들 후보: `resource` 디렉터리의 바이너리 목록 파일(`binaries.lock.json`, 빌드 때 생성. 이름, 플랫폼, 상대 경로, SHA-256, 버전)에 이름이 있으면 그 파일을 쓴다. 목록은 `generateBinariesLock(resourceDir, inputs, fs)`가 만든다. 항목은 이름·플랫폼·아키텍처 순으로 정렬해 같은 입력이 같은 본문을 내고, resource 디렉터리 밖을 가리키는 경로와 중복 항목은 오류 값이다.
   - 소스 실행(`bun run`): `@vscode/ripgrep`이 제공하는 경로를 그대로 쓴다. 서비스 설정에 `bundledSource`가 없으면 이 연결(`createRipgrepSource`)이 기본이다. 플랫폼 패키지가 없어 모듈이 던지면 번들 없음으로 보고 시스템 후보로 간다. 버전은 `rg --version`에서 읽고, 읽지 못하면 `version_unreadable`이다. 설치 때 npm 락파일의 무결성 해시로 검증되므로 실행 시 해시 검사는 생략한다. postinstall 다운로드는 하지 않는다. pi tools-manager의 해시 없는 다운로드는 쓰지 않는다(`_research/packages.md` §4.2 L0-f).
   - 컴파일 바이너리(`bun build --compile`)와 Tauri 사이드카 [가정]: 번들 파일은 실행 파일 안에 내장되어 바로 실행할 수 없다. 그래서 `cache/bin/<sha256 앞 16자>/<이름>`으로 꺼낸 뒤 SHA-256을 다시 계산해 목록 값과 비교하고, 같을 때만 실행 권한을 주고 경로를 돌려준다. 이미 꺼낸 파일이 있으면 해시만 다시 확인한다. 불일치하면 `integrity_mismatch`이고 그 파일을 실행하지 않는다. 내장과 추출 방식은 `L0.os.plan`의 실측 작업이 확정한다.
2. 시스템 후보: `allowSystem`이 true이면 `PATH`를 앞에서부터 찾는다(Windows는 `PATHEXT` 확장자 포함). 찾으면 `<이름> --version`(age는 `--version`, bwrap은 `--version`)을 실행해 첫 줄에서 버전을 읽는다. 읽지 못하면 `version_unreadable`이다. `security`와 `secret-tool`은 버전 옵션이 없으므로 버전 확인을 건너뛰고 `version`을 빈 문자열로 둔다. 이 둘에는 `minVersion`을 줄 수 없다 [제안].
3. 둘 다 없으면 `not_found`. `hint`는 OS별 설치 안내 문구다(예: Linux bwrap: "bubblewrap 패키지를 설치한다"). 이 실패는 사용자 환경 문제이고 호출자는 코드를 고칠 대상으로 다루지 않는다. CLI는 환경 문제 종료코드(2 계열)로 끝낸다 [제안: 종료코드 체계는 `L4.cli.spec`].

- 결과는 서비스 수명 동안 이름별로 캐시한다. 바이너리 경로가 바뀌어도 재시작 전까지 반영하지 않는다.
- 시스템 바이너리 버전 확인은 자식 프로세스 실행이 필요하다. DR-07 표의 `Bun.spawn` 소유 패키지에 `platform-os`가 있다 [결정: review.decisions-2 U-17].
- 번들 정책: `rg`만 번들로 확정했다. `sops`, `age`, `bwrap`, `socat`의 번들 여부는 미결 3이다. 정해지기 전에는 시스템 바이너리를 요구하고 없으면 안내한다.

#### 3.6.1 필수/선택 표와 점검

외부 바이너리를 OS별로 어디에 쓰고 없으면 무엇이 안 되는지를 한 표로 둔다 [결정: m2 마감 G2-07]. 번들과 서명은 M3이고(미결 3), M2는 시스템 바이너리를 요구하고 없으면 안내한다.

| 이름 | macOS | Linux·WSL | Windows | 쓰는 곳 | 없을 때 |
|---|---|---|---|---|---|
| `rg` | 필수(번들 우선) | 필수(번들 우선) | 필수 | sandbox(srt), 작업 공간 파일 검색 | 파일 검색과 샌드박스 시작이 동작하지 않는다 |
| `sops` | 필수 | 필수 | 필수 | secrets 기본 provider (3.10.0 이상) | 비밀을 읽고 쓸 수 없다 |
| `age` | 필수 | 필수 | 필수 | secrets 키 생성 | 새 비밀 키를 만들 수 없다 |
| `git` | 선택 | 선택 | 선택 | 작업 공간 git 기능 | git 상태 표시와 작업 트리 기능만 빠진다 |
| `bwrap` | 쓰지 않음(Seatbelt) | 필수(0.4.0 이상) | 쓰지 않음 | sandbox | 샌드박스를 쓸 수 없다. 설정 `onUnavailable`에 따라 bash가 거부되거나 격리 없이 돈다 |
| `socat` | 쓰지 않음 | 필수 | 쓰지 않음 | sandbox 네트워크 중계 | 위와 같다 |
| `security` | 필수(OS 내장) | 쓰지 않음 | 쓰지 않음 | secrets 키 보관(Keychain) | Keychain에 키를 둘 수 없다 |
| `secret-tool` | 쓰지 않음 | 선택 | 쓰지 않음 | secrets 키 보관(Secret Service) | 키를 파일(0600)에 둔다 |

- 표의 정본은 `src/binaries/requirements.ts`의 `binaryRequirements(platform)`다. 최소 버전은 소비 패키지의 상수(`platform-secrets`의 `SOPS_MIN_VERSION`, `platform-sandbox`의 bwrap 최소 버전)와 같아야 한다. L0끼리 import하지 않아 값을 복사해 두고 `requirements.test.ts`가 값을 비교한다.
- 점검: `checkExternalBinaries({ platform, resolveBinary }, signal)`가 쓰지 않는 행을 빼고 나머지를 병렬로 `resolveBinary`에 묻는다. 서비스는 `OsServiceHandle.checkBinaries(signal)`로 같은 점검을 낸다. 결과는 `BinaryCheckReport`다: `items`(이름, 필수/선택, 쓰는 곳, 영향, 상태 `ok`·`missing`(안내 문구)·`too_old`·`unusable`), `ready`(쓸 수 없는 필수 바이너리가 없음), `blocking`(쓸 수 없는 필수 이름), `degraded`(쓸 수 없는 선택 이름). 중단되면 `cancelled`다.
- 점검 실패는 코드를 고칠 대상이 아니라 사용자 환경 문제다. 호출자는 `ready: false`이면 환경 문제로 보고한다(CLI doctor는 종료코드 2 계열, 데스크톱 첫 실행 화면은 `hint`를 보여 준다). 두 곳을 잇는 일은 L4 작업이다.
- 설치 안내 문구(`hint`)는 `BinaryError.not_found.hint`를 그대로 쓴다(3.6절 3번).

### 3.7 사용자 알림 (1차, M3)

```ts
// F: @xeon/contracts/services  src/services/os.ts
import type { ThreadId } from "@xeon/contracts/conversation";

export type NotifyKind = "done" | "approval" | "question" | "error";
export interface OsNotification {
  readonly kind: NotifyKind;
  readonly title: string;     // 1~80자
  readonly body: string;      // 0~400자. 마스킹을 거친 문자열만
  readonly threadId?: ThreadId;
}
export type NotifyError =
  | { readonly kind: "disabled" }                       // M3 이전 빌드이거나 조립 루트가 provider none을 고름
  | { readonly kind: "unavailable"; readonly provider: string; readonly reason: string }
  | { readonly kind: "failed"; readonly provider: string; readonly code: string }
  | { readonly kind: "cancelled" };
```

```ts
// platform-os 내부: src/notify/provider.ts
export interface NotifierProvider {
  /** provider id. 예: "os.os.notify/darwin", "os.os.notify/desktop-tauri" */
  readonly id: string;
  available(signal: AbortSignal): Promise<boolean>;
  send(n: OsNotification, signal: AbortSignal): Promise<Result<void, NotifyError>>;
}
/** 순수 함수. 실행할 argv를 만든다. 테스트는 이 결과만 검사한다 */
export function buildNotifyCommand(info: OsInfo, n: OsNotification): readonly string[] | undefined;
```

| provider | 수단 [가정, 구현 수단은 `L0.os.plan`에서 확정] | 없을 때 |
|---|---|---|
| `darwin` | `osascript -e 'display notification … with title …'`. 문자열은 AppleScript 이스케이프 후 인자로 넘기고 셸을 거치지 않는다 | 해당 없음(OS 내장) |
| `linux` | `notify-send --app-name=Xeon <title> <body>` | 무음. 첫 실패 때 진단 로그 한 번(`notify.unavailable`) |
| `win32` | PowerShell 토스트(`-NoProfile`, 인자는 `-EncodedCommand`로 전달) | 무음 + 진단 한 번 |
| `none` | 무동작 | — |
| `desktop-tauri` | 데스크톱 앱에서는 엔진이 사이드카라 Tauri API를 직접 부를 수 없다. L4 host가 wire 알림으로 UI에 넘기고 UI가 Tauri 알림을 띄운다. 이 provider는 L4가 구현해 플러그인 설정으로 주입한다 | — |

- 선택: L4가 환경 provider를 넘기면 그것을 쓴다. 넘기지 않으면 `select.ts`가 OS provider를 고른다. 선택 기준은 배포 환경이 먼저이고 OS가 다음이다.
- 켜기·끄기: 이 패키지는 알림 켜기·종류 설정을 두지 않는다. 알림을 보낼지는 호출자(`cap-dialog`)가 `l2.dialog.notify.os`와 종류별 키(`l2.dialog.notify.<kind>`)로 정하고, 이 패키지는 받은 알림을 그대로 내보낸다 [결정: review.decisions-2 S-04]. `notify`가 `disabled`를 돌려주는 경우는 M3 이전 빌드와 조립 루트가 provider `none`을 고른 경우뿐이다.
- 비밀: 알림 본문과 제목은 OS 알림 센터에 남는다. 호출자는 마스킹한 문자열만 넘기고, `platform-os`도 보내기 전에 로거와 같은 `redact`를 한 번 더 적용한다 [제안]. 도구 인자, 프롬프트 본문 원문은 넣지 않는다.
- WSL: linux provider가 쓰이며 `notify-send`가 보통 없다. Windows 토스트 상호운용(`powershell.exe` 호출)을 쓸지는 미결 4다.
- 같은 `threadId`·`kind` 알림이 1초 안에 반복되면 하나만 보낸다(`Scheduler` 기반 디바운스) [제안].

### 3.8 파일 감시 (2차)

책임 경계 [미결 2, `L0.exec.spec`과 같은 문장으로 맞춘다]: 작업 공간 파일 감시는 `xeon.exec`의 `ExecutionEnv.watch`가 맡고, 앱 설정·스킬·플러그인 디렉터리 감시는 `xeon.os`의 `FileWatcher`가 맡는다. 판정은 경로 기준이다. `OsDirs`(config, data, state) 아래 경로는 os, 작업 공간 루트 아래 경로(프로젝트 안 `.xeon/` 포함)는 exec다.

계획 v2는 "ExecutionEnv.watch를 쓰고, 없으면 @parcel/watcher를 쓴다"고 적었다(`_research/layer-plan-v2.json` L0-f 파일 감시). L0 패키지끼리 import할 수 없으므로(DR-02) os가 exec의 감시를 대신 부르거나 exec가 os의 감시로 넘기는 구조는 두지 않는다. 위 경계로 두 감시가 겹치지 않게 한다.

```ts
// F: @xeon/contracts/services  src/services/os.ts
export type FileChangeType = "create" | "update" | "delete";
export interface FileChange {
  readonly type: FileChangeType;
  readonly path: string;
}
export interface WatchOptions {
  /** glob. 기본 [] */
  readonly ignore?: readonly string[];
  /** 기본 100. 0~5000 */
  readonly debounceMs?: number;
}
export interface WatchHandle {
  close(): Promise<void>;
}
export type WatchError =
  | { readonly kind: "outside_app_dirs"; readonly path: string }
  | { readonly kind: "not_found"; readonly path: string }
  | { readonly kind: "limit_reached"; readonly backend: "native"; readonly detail: string }
  | { readonly kind: "backend_unavailable"; readonly reason: string };
```

```ts
// platform-os 내부: src/watch/watcher.ts
export interface WatchBackend {
  readonly id: "native" | "poll";
  subscribe(root: string, ignore: readonly string[], onRaw: (changes: readonly FileChange[]) => void): Promise<Result<WatchHandle, WatchError>>;
}
/** OsService.watch의 구현. 백엔드 선택, 디바운스, 경로 검사를 맡는다 */
export interface FileWatcher {
  watch(root: string, opts: WatchOptions, onBatch: (changes: readonly FileChange[]) => void): Promise<Result<WatchHandle, WatchError>>;
}
export function createFileWatcher(deps: {
  readonly dirs: OsDirs;
  readonly scheduler: Scheduler;
  readonly logger: Logger;
  readonly backends: readonly WatchBackend[];   // 앞에서부터 시도. 기본 [parcel, poll]
}): FileWatcher;
```

- `FileWatcher.watch(root, opts, onBatch)`(서비스에서는 `OsService.watch`)는 `root`가 `OsDirs.config`, `data`, `state` 중 하나의 하위가 아니면 `outside_app_dirs`다.
- 백엔드: `@parcel/watcher`(N-API 프리빌드, FSEvents·inotify·ReadDirectoryChangesW)가 기본이다. 로드 실패나 `limit_reached`이면 폴링 백엔드로 바꾸고 경고 로그를 남긴다. 폴링 간격은 2초다 [제안].
- 디바운스: 백엔드 원시 변경을 `debounceMs` 동안 모아 경로별 마지막 상태로 합친 배열 하나를 `onBatch`에 넘긴다. 타이머는 주입된 `Scheduler`로 건다(테스트는 `manualClock`).
- [가정] `bun build --compile` 바이너리에서 `@parcel/watcher`의 네이티브 모듈을 로드할 수 있다. 실측은 `L0.os.plan`이 한다. 안 되면 폴링이 기본이 된다.
- 서비스가 `dispose`될 때 열린 감시를 모두 닫는다.

### 3.9 텔레메트리 (2차)

```ts
// F: @xeon/contracts/services  src/services/os.ts
import type { Tracer } from "@opentelemetry/api";   // F는 import type만(F.readme §1)

export interface OsTelemetry {
  readonly enabled: boolean;
  /** 꺼져 있으면 무동작 Tracer를 돌려준다 */
  tracer(scope: string): Tracer;
}
```

- 기본 꺼짐(`l0.os.telemetry.enabled = false`). 켜면 `@opentelemetry/sdk-trace-node` 2.12.0의 트레이서 provider를 만들고 `pi-telemetry` 1.3.0 어댑터로 pi-ai의 `pi.ai.request` 스팬을 함께 받는다(`_research/packages.md` §4.2 L0-f).
- 내보내기 대상(`l0.os.telemetry.exporter`): `file`은 `state/telemetry/spans-<날짜>.jsonl`에 OTLP JSON 한 줄씩, `otlp-http`는 `l0.os.telemetry.endpoint`로 보낸다.
- 스팬 이름 규칙 [제안]: `xeon.<층 소문자>.<도메인>.<동작>`. 예: `xeon.l1.loop.step`, `xeon.l1.tools.call`, `xeon.l0.store.commit`. pi-ai 스팬은 원래 이름을 유지한다.
- 속성 규칙 [제안]: 속성에는 id(`threadId`, `turnId`, `stepId`), 도구 이름, 모델 id, 토큰 수, 지연 시간만 싣는다. 비밀 값, 비밀 참조 해석 결과, 프롬프트·응답 본문, 도구 인자·출력 원문은 싣지 않는다. 내보내기 직전에 문자열 속성 값에 `redact`를 적용한다.
- SDK는 켜질 때만 동적 import로 지연 로드한다. 꺼져 있을 때 SDK 모듈을 로드하지 않는다.
- [가정] `@opentelemetry/sdk-trace-node`가 Bun에서 동작한다. `AsyncLocalStorage` 기반 컨텍스트 전파가 Bun에서 Node와 같게 동작하는지는 실측이 필요하다.
- wire `_meta.traceparent` 전파(`F.wire-settings.spec` §3.6)는 L4 host가 이 `Tracer`로 한다.

### 3.10 OsService

```ts
// F: @xeon/contracts/services  src/services/os.ts
import type { Clock, Logger, RandomSource, Result, Scheduler } from "@xeon/contracts";

export const OsServiceName = "xeon.os" as const;

export interface OsTime {
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly random: RandomSource;
}

/** 프로세스 시작 시각 지문. pid 재사용을 구분한다(L0.store.spec LeaseHolder.startedAt, L0.process.spec ServiceRegistration.startedAt) */
export type FingerprintError =
  | { readonly kind: "unsupported"; readonly platform: OsPlatform }
  | { readonly kind: "io"; readonly code: string };

export interface OsService {
  readonly info: OsInfo;
  readonly dirs: OsDirs;
  readonly time: OsTime;
  /** 기계 식별자. 같은 기계 판정용(LeaseHolder.host). 서비스 수명 동안 바뀌지 않는다 */
  readonly machineId: string;
  /** POSIX uid. Windows는 null. /tmp/xeon-<uid>, 소켓 디렉터리 소유자 검사에 쓴다 */
  readonly userId: number | null;
  /** pid 프로세스의 시작 시각(epoch ms). 그 pid의 프로세스가 없으면 ok(null). 동기다(store 임대 판정이 동기 경로다) */
  processStartFingerprint(pid: number): Result<number | null, FingerprintError>;
  /** 구성요소 이름을 필드로 단 자식 로거 */
  logger(component: string): Logger;
  fsKind(path: string, signal: AbortSignal): Promise<Result<FsKind, FsKindError>>;
  resolveBinary(name: BinaryName, opts: ResolveBinaryOptions, signal: AbortSignal): Promise<Result<ResolvedBinary, BinaryError>>;
  /** 1차(M3). M3 이전 빌드에서는 항상 err({kind:"disabled"}) */
  notify(n: OsNotification, signal: AbortSignal): Promise<Result<void, NotifyError>>;
  /** 2차 */
  watch(root: string, opts: WatchOptions, onBatch: (changes: readonly FileChange[]) => void): Promise<Result<WatchHandle, WatchError>>;
  /** 2차 */
  readonly telemetry: OsTelemetry;
}
```

```ts
// platform-os 공개: src/index.ts
export interface PlatformOsConfig {
  readonly resourceDir: string;
  readonly logSink: LogSink;
  readonly logRedact: LogRedact;
  /** 배포 환경 provider. 예: desktop-tauri 알림 */
  readonly notifier?: NotifierProvider;
}
/** L0 등록 단위. 조립 루트가 ExtHost.registerPlatform으로 등록한다. PlatformModule은 X.primitives.spec §3.2의 정의다 */
export function platformOsPlugin(config: PlatformOsConfig): PlatformModule;   // name: "platform-os"
```

- 서비스 등록 시 `detectPlatform` → `resolveDirs` → `ensureDirs` 순서로 실행한다. `detectPlatform`이 실패하면 서비스를 등록하지 않고 오류를 등록 실패로 알린다(X의 플러그인 로딩 실패 경로). 플랫폼이 없으면 나머지 L0도 동작할 수 없기 때문이다 [제안].
- 다른 L0 문서가 요구한 이름과 이 인터페이스의 대응: `resourceDir()`(`L0.store.spec` FR-S8) = `dirs.resource`, `runtimeDir()`(`L0.process.spec` FR-P4) = `dirs.runtime`, `userId()` = `userId`, `machineId()` = `machineId`, `processStartFingerprint(pid)` = 같은 이름의 메서드, 홈 디렉터리 = `dirs.home`.
- `machineId` [제안]: Linux는 `/etc/machine-id`, macOS는 `ioreg -rd1 -c IOPlatformExpertDevice`의 `IOPlatformUUID` [가정], Windows는 레지스트리 `MachineGuid` [가정]. 읽지 못하면 `os.hostname()`의 SHA-256 hex 앞 32자를 쓰고 경고 로그를 남긴다. 서비스 등록 때 한 번 읽는다.
- `processStartFingerprint` [제안]: Linux는 `/proc/<pid>/stat` 22번째 필드(부팅 뒤 클록 틱)를 `/proc/stat`의 `btime`과 `CLK_TCK`로 epoch ms로 바꾼다. macOS는 `Bun.spawnSync(["ps", "-o", "lstart=", "-p", <pid>])` 출력 파싱이다 [가정: 초 단위 해상도]. Windows는 `unsupported`(2차). 같은 pid에 대해 같은 값을 돌려주는 것만 보장하고, 다른 측정 수단의 값과 비교하지 않는다.
- `time`은 서비스 등록 뒤 바뀌지 않는다. 조립 루트는 이 값을 꺼내 `deps`로 다른 패키지에 넘긴다(BP-05). 시계를 별도 서비스 이름(`xeon.clock` 등)으로 나눌지는 미결 7이다.
- `PlatformOsConfig.notifier`의 타입 `NotifierProvider`를 L4가 구현하려면 공개 진입점에서 이 타입을 export해야 한다. L4 조립 루트만 쓴다.

### 3.11 파일 잠금

프로세스 둘 이상이 읽고 고쳐 쓰는 사용자 파일(M2는 `trust.json`)의 덮어쓰기를 막는다 [결정: m2 마감 G1-10]. `OsService`(F)에는 아직 없고, `platformOsPlugin`이 만든 `OsServiceHandle.fileLock`으로 낸다. F에 `OsService.fileLock`을 더하는 일은 F 요청이다 [미결 12].

```ts
// platform-os 공개: src/file-lock/index.ts
export type FileLockScope = "cross_process" | "process";
export interface FileLockOptions { readonly timeoutMs?: number; readonly signal?: AbortSignal }
export type FileLockError =
  | { readonly kind: "timeout"; readonly path: string; readonly waitedMs: number }
  | { readonly kind: "cancelled" }
  | { readonly kind: "io"; readonly path: string; readonly code: string };

export interface FileLock {
  readonly scope: FileLockScope;
  withLock<T>(path: string, fn: () => Promise<T>, options?: FileLockOptions): Promise<Result<T, FileLockError>>;
  updateText(path: string, fn: (current: string | null) => string, options?: FileLockOptions): Promise<Result<void, FileLockError>>;
}
```

- 잠금 파일은 `<path>.lock`이다. 대상 파일을 직접 잠그지 않으므로 `updateText`가 이름을 바꿔 교체해도 잠금이 유지된다. 잠금 파일은 지우지 않는다(지우면 옛 inode 보유자와 새 inode 생성자가 한 경로를 둘로 나눠 쥘 수 있다). 잠금 파일이 들어갈 디렉터리는 있어야 한다. `updateText`는 없으면 0700으로 만든다.
- 구현은 libc `flock(2)`(`LOCK_EX | LOCK_NB`)를 bun:ffi로 부른다. FFI 호출은 `src/file-lock/flock.ts` 한 파일에 있고, 라이브러리와 errno 이름은 `select.ts`가 OS별로 고른다(macOS `libSystem.B.dylib`/`__error`/35, Linux `libc.so.6`/`__errno_location`/11). 프로세스가 죽으면 OS가 잠금을 푼다.
- 기다림은 25ms 간격 폴링이다. 같은 프로세스 안에서는 보유 표를 먼저 보고, 표에 있으면 OS 잠금을 시도하지 않는다. `timeoutMs`(기본 5000)가 지나면 `timeout`, `signal`이 중단되면 `cancelled`, 잠금 파일을 열지 못하거나 flock이 EWOULDBLOCK 아닌 errno로 실패하면 `io`다.
- `scope`는 `cross_process`(flock 사용)이거나 `process`다. `process`는 Windows(M2 범위 밖)와 FFI를 읽지 못한 환경이고, 같은 프로세스 안에서만 배타다. 이때 서비스 시작 로그에 `os.file_lock.process_only`를 남긴다.
- `withLock`은 `fn`이 던지면 잠금을 놓고 그 오류를 그대로 거부로 전한다. `updateText`의 `fn`이 던지면 파일은 바뀌지 않는다(신뢰 저장소가 손상 파일을 `corrupt`로 알리는 경로).
- `updateText`는 같은 디렉터리의 임시 파일(`<path>.<pid>.<번호>.tmp`, 0600)에 쓰고 `rename`한다. 읽기 실패 가운데 `ENOENT`는 `fn(null)`이고 나머지는 `io`다. fsync는 하지 않는다(신뢰·설정 파일은 마지막 값이 사라져도 이전 값으로 돌아갈 뿐이다) [제안].
- `TrustStoreBackend.update`(F)가 이 메서드와 같은 모양이다: 호스트 조립 루트가 `updateText`를 `update`에, 잠금 없는 읽기를 `read`에 연결한다.

## 4. 동작 규칙

1. 시작 순서: 플랫폼 판별 → 디렉터리 해석 → 디렉터리 생성·검사 → 로거 생성 → 서비스 등록. 바이너리 해석, 알림 provider 확인, 감시, 텔레메트리 SDK 로드는 처음 쓸 때 한다(지연).
2. `dirs`는 서비스 수명 동안 바뀌지 않는다. `XEON_HOME`과 `l0.os.dirs.override`의 변경은 재시작 뒤 반영한다.
3. 모든 비동기 메서드는 마지막 인자 `signal`을 받고 자식 프로세스와 파일 I/O에 넘긴다. 중단되면 `{ kind: "cancelled" }`를 돌려준다(TY-22).
4. `resolveBinary`는 같은 이름에 대한 동시 호출을 하나로 합친다(진행 중 Promise 공유). 번들 추출은 임시 파일에 쓴 뒤 같은 디렉터리 안에서 이름을 바꿔 원자적으로 둔다.
5. 알림 provider가 `none`이거나 감시·텔레메트리가 꺼져 있을 때는 OS 자원(자식 프로세스, 감시 핸들, SDK 모듈)을 만들지 않는다. 알림 자식 프로세스는 `notify`가 불릴 때만 만든다.
6. `dispose` 순서: 감시 닫기 → 대기 중 알림 디바운스 타이머 취소 → 텔레메트리 내보내기 flush(최대 2초) → 로거 마지막 줄. 이 패키지가 만든 `Scheduler` 타이머 가운데 남은 것은 모두 취소한다.
7. 이 패키지는 내구 이벤트를 쓰지 않는다(`L0.readme` §6). 진단은 로그로만 남긴다.

## 5. 실패와 경계 사례

| 상황 | 결과 |
|---|---|
| `process.platform`이 `freebsd` 등 | `unsupported_platform`. 서비스 등록 실패 |
| `HOME`(Windows는 `LOCALAPPDATA`·`APPDATA`)이 비어 있음 | `env_missing`. 서비스 등록 실패 |
| `XEON_HOME`이 상대 경로 | `not_absolute`. 서비스 등록 실패. 조용히 기본값으로 바꾸지 않는다 |
| WSL에서 data가 `/mnt/c/...`로 해석됨 | `data_dir_on_drvfs`. 서비스 등록 실패. 안내 문구에 `XEON_HOME`을 Linux 경로로 두라고 적는다 |
| `/tmp/xeon-<uid>`가 다른 사용자 소유 | `not_owned`. 서비스 등록 실패(소켓 가로채기 방지) |
| 기존 디렉터리가 0755 | `permission_too_open`. [제안] 자동으로 고치지 않고 실패한다. 수정 명령은 L4 `doctor`가 안내한다 |
| runtime 경로가 길이 규칙을 넘고 대체 후보도 넘음 | `runtime_path_too_long` |
| statfs가 지원되지 않는 파일 시스템 | `fsKind`가 `unknown` |
| 번들 rg 해시 불일치 | `integrity_mismatch`. 실행하지 않는다. 시스템 rg로 자동 대체하지 않는다 [제안: 변조 신호를 숨기지 않기 위해] |
| 추출 위치 쓰기 불가(읽기 전용 cache, 백신 차단) | `extract_failed`(`code`에 OS 오류 코드) |
| `notify-send` 없음 | `unavailable`. 첫 번째만 진단 로그. 호출자는 알림 실패로 작업을 멈추지 않는다 |
| inotify 감시 한도 초과 | `limit_reached` 뒤 폴링 백엔드로 전환하고 경고 로그 |
| `@parcel/watcher` 로드 실패 | 폴링 백엔드. 경고 로그 한 번 |
| OTel SDK 로드 실패 | `telemetry.enabled`를 false로 다루고 경고 로그. 다른 기능은 영향 없음 |
| `redact`가 예외를 던짐 | 그 로그 줄을 버리고 `log.redact_failed` 한 줄만 쓴다 |

플랫폼별 제약:

| 항목 | macOS | Linux / WSL2 | Windows |
|---|---|---|---|
| 디렉터리 규칙 | `~/Library/Application Support`, `~/Library/Caches` | XDG Base Directory | `%APPDATA%`(roaming, 설정), `%LOCALAPPDATA%`(기기, 데이터·캐시) |
| runtime 디렉터리 | `$TMPDIR`가 사용자별 디렉터리라 쓸 수 있다. 소켓 경로 한계 104바이트 | `$XDG_RUNTIME_DIR`. WSL에서 systemd가 꺼져 있으면 없을 수 있어 `/tmp/xeon-<uid>`로 대체 [가정] | Unix 소켓 대신 named pipe 등 대안. 디렉터리는 등록 파일만 둔다 |
| 알림 수단 | `osascript` display notification. 알림 권한은 터미널 앱 단위로 OS가 관리한다 [가정] | `notify-send`(libnotify). 헤드리스·WSL에는 대개 없다 | PowerShell 토스트 [가정]. Windows 네이티브 보강 때 확인 |
| 감시 백엔드 | FSEvents | inotify. 사용자당 감시 수 한도 `fs.inotify.max_user_watches`(배포판·커널마다 다름) [가정] | ReadDirectoryChangesW |
| 바이너리 확장자·경로 | 확장자 없음, `/` 구분, `PATH` `:` 구분 | macOS와 같음 | `.exe`, `\` 구분, `PATH` `;` 구분, `PATHEXT` |
| 임시 디렉터리 | `$TMPDIR`(사용자별) | `/tmp`(공유)라 사용자별 하위 디렉터리와 소유 검사가 필요 | `%TEMP%`(사용자별) |
| 권한 비트 | 0700 적용·검사 | 0700 적용·검사. drvfs에서는 메타데이터 마운트 옵션에 따라 무시됨 | 권한 비트가 의미 없다. ACL 검사는 하지 않는다 [제안] |
| 시간 해상도 | `Date.now` ms | ms | ms. 타이머 최소 간격이 약 15.6 ms일 수 있다 [가정] |
| 파일 시스템 판정 | `mount` 출력의 `f_fstypename` | statfs `f_type` | 2차 |
| 컴파일 바이너리 | 번들 rg 추출 후 실행 권한 부여. 서명·공증과의 관계는 [가정] | 추출 후 `chmod 0755` | 추출 파일이 백신 검사로 잠길 수 있다 [가정] |

## 6. 설정 노출

`F.wire-settings.spec` §3.8.2 `SettingDef` 열을 따른다. 층 `L0`, 접두 `l0.os.`.

| 키 | 타입 | 기본값 | range | runtimeChange | allowedScopes | ui.tab / widget | secret | L4 노출 |
|---|---|---|---|---|---|---|---|---|
| `l0.os.telemetry.enabled` | boolean | `false` | — | restart | managed, user | advanced / toggle | 아니오 | 화면, 파일, 명령 |
| `l0.os.telemetry.exporter` | string | `"file"` | enum `file`, `otlp-http` | restart | managed, user | advanced / select | 아니오 | 화면, 파일 |
| `l0.os.telemetry.endpoint` | string | `"http://localhost:4318/v1/traces"` | — | restart | managed, user | advanced / text | 아니오 | 화면, 파일 |
| `l0.os.dirs.override` | string | 없음 | 절대 경로 | restart | managed | 화면에 두지 않음 | 아니오 | 파일(관리 설정)만. 환경 변수 `XEON_HOME`이 같은 역할을 한다 |
| `l0.os.log.level` | string | `"info"` | enum `debug`, `info`, `warn`, `error` | live | managed, user, local, session | advanced / select | 아니오 | 화면, 파일, 명령 |

- 알림 켜기·종류 키는 이 표에 두지 않는다. 정본은 `L2.dialog.spec` §6의 `l2.dialog.notify.*`이고 기본값과 탭도 그 표를 따른다 [결정: review.decisions-2 S-04].
- `dirs.override`: 사용자 설정 파일은 `config` 디렉터리 안에 있으므로 사용자 범위에서 이 값을 읽을 수 없다(순환). 그래서 관리 범위만 허용한다 [제안]. 관리 설정 파일 위치는 L4가 정한다.
- 이 표의 키 이름은 F 키 문법(`^l0\.os(\.[a-z][A-Za-z0-9]*)+$`)을 지킨다.

## 7. 확장 지점

- 이 패키지는 on 지점을 구독하지 않고, post·drive·scope를 쓰지 않는다(`L0.readme` §1).
- X에서 쓰는 것은 `PlatformModule`(`setup`), `PlatformContext.providePort`, `onDispose`(4절 6번)다. 등록은 조립 루트가 `ExtHost.registerPlatform`으로 한다(`X.primitives.spec` §3.2). `@xeon/ext-host` import는 이 등록 API에 한정한 DR-14 예외다 [결정: review.decisions-2 U-17].
- 확장(플러그인)이 알림을 보내려면 `dialog.notify`의 `emit`을 쓴다(`L2.dialog.spec` §3.6). `xeon.os`의 `notify`는 `cap-dialog`가 부르는 전달 수단이다. 확장이 OS 명령을 직접 실행하는 경로는 없다.

## 8. 다른 문서와의 인터페이스

제공:

| 대상 | 제공하는 것 |
|---|---|
| `L0.store.spec` | `dirs.data`(DB, 블롭 위치), `dirs.state`, `dirs.resource`(macOS 동봉 SQLite), `fsKind`(WAL 가능 여부 판단. 조립 루트가 미리 풀어 넘긴다), `processStartFingerprint`, `machineId`(임대 `LeaseHolder.startedAt`·`host`, 후퇴안 생존 판정), `info`, `time`(FR-S8) |
| `L0.process.spec` | `dirs.runtime`(소켓·등록 파일. 경로 폴백 포함), `dirs.home`(서비스 cwd), `processStartFingerprint`(`ServiceRegistration.startedAt`), `userId`, `time`(FR-P4) |
| `L0.sandbox.spec` | `resolveBinary("rg" \| "bwrap" \| "socat")`, `dirs.home`·`dirs.config`·`dirs.data`(보호 경로), `dirs.tmp` |
| `L0.secrets.spec` | `resolveBinary("sops" \| "age" \| "security" \| "secret-tool")`, `dirs.config`(`<config>/secrets/` 아래 메타·감사·폴백 키 파일), `time`, `logger` |
| `L0.exec.spec` | `info`, `resolveBinary("git")`, `time` |
| L1 전체 | `time`(조립 루트가 `deps`로 전달), `logger` |
| L2 workspace, dialog, schedule | `info`, `dirs`. `notify`는 `cap-dialog`(`dialog.notify`)만 부른다. schedule 완료 같은 알림 원인은 dialog가 분류한다(`L2.dialog.spec` §4.7) |
| L4 host, cli, desktop | `dirs`, `notify`, `telemetry`, 로그 sink 연결 |

요구:

| 대상 | 요구하는 것 |
|---|---|
| `L0.exec.spec` | 파일 감시 경계 문장(3.8절)을 같은 문장으로 둔다(반영됨: `L0.exec.spec` 1절 다루지 않는 것 표) |
| `L0.process.spec` | 소켓 파일 이름 상한(3.2절 runtime 길이 규칙의 여유 24바이트)을 확정한다(반영됨: `L0.process.spec` §4.4.1 `SOCKET_RELATIVE_PATH_MAX_BYTES`) |
| `L0.secrets.spec` | 로그·알림·텔레메트리용 마스킹 함수 `(text: string) => string`을 서비스로 제공한다. 조립 루트가 `logRedact`에 연결한다 |
| `X.primitives.spec` | `PlatformModule`, `PlatformContext`, `ExtHost.registerPlatform`(§3.2)과 등록 실패 경로(`setup`이 던지면 `registerPlatform`이 던진다) |
| `L4.host-service.spec`, `L4.desktop.spec` | `resourceDir`, `logSink`, `desktop-tauri` 알림 provider를 플러그인 설정으로 넘긴다 |

F에 요청:

1. `@xeon/contracts` 루트 base: `Clock`, `TimerHandle`, `Scheduler`, `RandomSource`(이미 `eng.typescript.guide` §1.2 이름)와 `Logger`, `LogLevel`, `LogValue`, `LogFields`(3.5절)를 둔다. `F.readme` §3에 반영되었다(U-03).
2. (철회) `@xeon/contracts/testing` 서브패스는 두지 않는다 [결정: review.decisions-2 U-03]. `manualClock`, `seededRandom`, `fixedIdFactory`, `memoryLogger`는 쓰는 패키지의 `test/` 안에 둔다.
3. `@xeon/contracts/services` [결정: review.decisions-2 D-04]: `OsService`, `OsServiceName`, `OsTime`, `FingerprintError`, `OsInfo`, `OsInfoSchema`, `OsPlatform`, `OsArch`, `PlatformError`, `OsDirs`, `DirsError`, `FsKind`, `FsKindError`, `BinaryName`, `BinarySource`, `ResolveBinaryOptions`, `ResolvedBinary`, `BinaryError`, `NotifyKind`, `OsNotification`, `NotifyError`, `FileChangeType`, `FileChange`, `WatchOptions`, `WatchHandle`, `WatchError`, `OsTelemetry`.
4. (반영됨) `eng.dependency-rules.guide` DR-07 표: `@vscode/ripgrep`, `@parcel/watcher`, `pi-telemetry`, `@opentelemetry/sdk-trace-node`, `@opentelemetry/api`(값 import)의 소유 패키지와 `Bun.spawn` 소유 패키지에 `platform-os`가 있다 [결정: review.decisions-2 U-17].

## 9. 수용 기준

1. `resolveDirs` 단위 테스트가 macOS·Linux·Windows 세 플랫폼과 환경 변수 조합(XDG 변수 있음·없음·상대 경로, `XEON_HOME` 있음, `XDG_RUNTIME_DIR` 없음)에서 3.2절 표와 같은 경로를 돌려준다. 환경 값은 `EnvReader`로 주입하고 실제 OS를 바꾸지 않는다.
2. `XEON_HOME`이 있으면 data·config·cache·state·runtime이 그 아래로 바뀌고 resource·tmp는 그대로다.
3. WSL probe(`isWsl: true`)에서 data가 `/mnt/c/...`로 해석되면 `data_dir_on_drvfs`를 돌려준다.
4. `ensureDirs`가 새로 만든 디렉터리의 권한이 macOS·Linux에서 `0o700`이고, 0755인 기존 디렉터리에는 `permission_too_open`을 돌려준다.
5. 같은 Clock·Scheduler 계약 테스트 묶음이 `systemClock`·`systemScheduler`와 `manualClock`에서 모두 통과한다(취소, 만기 순서, 음수·NaN 지연, 모르는 핸들 취소).
6. `Date.now`, `Math.random`, `performance.now`, 인자 없는 `new Date()` 직접 호출이 `packages/platform-os` 밖에서 0건이다(oxlint `no-restricted-properties`와 스캔 `xeon/no-ambient-time`).
7. `process.platform`, `os.platform()`, `WSL_DISTRO_NAME`, `/proc/version` 참조가 `packages/platform-os/src/select.ts` 밖에서 0건이다.
8. 번들 rg의 해시를 바꾼 픽스처에서 `resolveBinary("rg")`가 `integrity_mismatch`를 돌려주고 실행 함수가 한 번도 불리지 않는다.
9. 설정 기본값으로 시작한 서비스에서 `telemetry.enabled`가 false이고 OTel SDK 모듈이 로드되지 않는다. 설정 키 `l0.os.notify.*`는 선언되어 있지 않다. M3 빌드에서 provider가 `none`이 아니면 `notify`는 `disabled`를 돌려주지 않는다.
10. 로거가 레벨 미만 호출을 출력하지 않고, 모든 출력 줄이 `redact`를 거친다.

근거 위치: `_research/packages.md` §4.2 L0-f, `_research/layer-plan-v2.json` L0-f, `eng.typescript.guide` §1.2·TY-21·TY-22, `eng.best-practices.guide` BP-05·BP-12, `eng.testing.guide` §1.2·TS-03.

## 10. 미결 사항

1. [결정: review.decisions-2 U-03] `Logger`·`Clock` 인터페이스 위치는 F 루트 base((a)안)이고 구현과 ID 발급기 구현은 이 패키지, 테스트 대역은 쓰는 패키지의 `test/`다(3.4절, 3.5절).
2. [미결] 파일 감시 책임 경계. 작업 공간 = exec(`ExecutionEnv.watch`), 앱 설정·스킬·플러그인 디렉터리 = os(`FileWatcher`). 계획 v2의 "ExecutionEnv.watch를 쓰고 없으면 @parcel/watcher" 문장과 다르므로 사용자 확인이 필요하다. `L0.exec.spec`과 같은 문장으로 맞춘다.
3. [미결] `sops`, `age`, `bwrap`, `socat`의 번들 정책. 번들하면 설치가 쉬워지고 배포 크기와 라이선스 고지, 보안 갱신 책임이 늘어난다. 정해지기 전에는 시스템 바이너리를 요구한다.
4. [미결] WSL 알림에서 Windows 토스트 상호운용(`powershell.exe`)을 쓸지.
5. [미결] 디렉터리 규칙과 사용자의 기존 설정 위치 충돌. macOS config를 `~/Library/Application Support/xeon/config`로 둘지 `~/.config/xeon`으로 둘지, 위치를 바꿀 때 마이그레이션을 둘지.
6. [미결] 단조 시계를 F 계약에 더할지(`performance.now` 대응). 현재는 `Clock.now()` 차이로 경과 시간을 잰다.
7. [미결] `time`(시계·타이머·난수)을 `OsService` 필드로 둘지 별도 서비스 이름으로 나눌지. 나누면 `eng.context-map.design` §5.3에 행이 늘어난다.
8. [미결] provider id 규칙(`L0.readme` §9 미결 1). 이 문서는 권고안 `os.os.<슬롯>/<구현 id>`를 쓴다.
9. [미결] `l0.os.dirs.override`의 관리 설정 파일 위치. 사용자 설정 파일이 config 디렉터리 안에 있어 순환이 생기므로 관리 범위만 허용했다.
10. [미결] 2차 의존의 정확한 버전과 이름. `@parcel/watcher`는 조사 시점 2.6.0이고 catalog 확정 전이다. `pi-telemetry` 1.3.0의 npm 범위 이름(`@earendil-works/` 여부)과 라이선스(MIT 여부)는 확인하지 않았다. 둘 다 OS-14·OS-15 착수 전에 npm 레지스트리에서 확인해 catalog와 `L0.os.plan` §4 표에 정확히 적는다.
11. [미결] `processStartFingerprint`의 macOS 수단(`ps -o lstart=`는 초 단위)과 Windows 수단(`GetProcessTimes`). macOS 해상도로 pid 재사용을 충분히 구분하는지 실측한다.
12. [미결] F 요청, `OsService.fileLock`. 지금은 `OsServiceHandle.fileLock`으로만 낸다. F가 `OsService`에 같은 모양을 더하면 조립 루트가 핸들 대신 서비스에서 받는다. `settings.json` 쓰기에 같은 잠금을 쓰는 일은 M3다.
13. [가정] macOS의 `libSystem.B.dylib` `flock`, `__error`, EWOULDBLOCK(35)은 이 저장소에서 실측하지 않았다(`L0.store`의 같은 FFI 값과 같다). Linux는 `file-lock.int.test.ts`가 자식 프로세스 넷의 읽기-수정-쓰기 100회가 한 줄도 잃지 않음을 확인한다.
