---
id: L0.exec.plan
layer: L0
domain: exec
kind: plan
status: draft
depends_on: [L0.exec.spec, adr.0003, eng.testing.guide, eng.toolchain.guide]
binds: [xeon/packages/platform-exec/**]
---

# L0 exec 구현 계획

## 1. 목표와 마일스톤 배치

목표: pi durable env를 포크해 `xeon.exec`(`ExecService`)를 세우고, 그 위에 env 허용 목록, 데코레이션 가능한 `Shell`, 백그라운드 실행을 얹는다. 비밀 주입 지점은 M1이다(`L0.exec.spec` §3.6, review.decisions-2 U-19).

| 마일스톤 | 범위 | 근거 |
|---|---|---|
| M0 | 포크 5파일과 적합성 자산 복사, 포크 기록 3종, CancelScope 치환(P1), Result 정리(P2), 오류 클래스 F 이동(P6), 테스트 포팅(P4, P5), 플랫폼 provider 추출(P3, darwin·linux), 적합성 스위트 Linux 통과, Bun 동작 스파이크 | [결정: `_research/foundation-plan.md` §5 P4 M0 "`platform-exec`(durable env 포크)"] |
| M1 | env 허용 목록 빌더, sandbox 데코레이터 접점(조립 시험), `secretEnv` 비밀 주입 지점(EX-13), `xeon.exec` 서비스 등록, 설정 정의, `fakeExec`·`memoryFs`, 적합성 macOS 통과 | [결정: foundation-plan §5 M1 "도구 read, ls, bash(sandbox)"]. M1의 "SOPS 비밀 참조 1종"은 bash 도구의 env 주입(실행마다 승인)으로 검증한다 [결정: review.decisions-2 U-19] |
| M2 이후 | 백그라운드 실행 `startBackground`(EX-20), Windows provider 보강과 Windows CI, Docker 어댑터, git worktree 격리(2차), SSH(보류) | [제안: `L0.exec.spec` §1 범위 표] |

- M0 끝에서 `xeon.exec`는 서비스 등록 없이 패키지 export(`createExecService`)로만 쓸 수 있다. 서비스 등록은 ext-host 등록 API(`X.primitives.spec`)가 M0에 준비된 뒤 M1에 한다 [제안].

## 2. 패키지와 파일 배치

```
xeon/packages/platform-exec/
  package.json                 # name @xeon/platform-exec, "xeon": {"layer": "L0", "domain": "exec"}
                               # exports: "." → src/index.ts, "./testing" → src/testing/index.ts
  tsconfig.json                # references: ../contracts, ../ext-host
  UPSTREAM.json                # 포크 원본·커밋·복사 경로·패치 id (adr.0003 §3.4)
  PATCHES.md                   # 패치 표 (L0.exec.spec §3.3.3)
  LICENSE.pi                   # pi MIT LICENSE 원문
  src/
    index.ts                   # 공개 export: createExecService, ExecPlatformProvider 타입, LineScanner 등 재export
    upstream/                  # 포크 코드만. 고친 줄에 // XEON-PATCH: <id>
      env/index.ts
      env/node.ts
      env/node-watch.ts
      env/decode.ts
      env/line-scan.ts
      testing/env-conformance.ts
      testing/types.ts         # env 관련 타입만
      testing/runner.ts        # registerEnvConformance만
      testing/assertions.ts
    provider.ts                # ExecPlatformProvider, ShellConfig, ExecPlatform
    providers/darwin.ts
    providers/linux.ts         # wsl 변종 플래그
    providers/win32.ts
    select.ts                  # process.platform을 읽는 유일한 곳
    env-builder.ts             # BASE_ENV_POLICY, buildChildEnv (순수 함수)
    secret-env.ts              # secretEnv lease 획득·폐기 (M1)
    background.ts              # (M2 이후) startBackground, BackgroundExecHandle
    service.ts                 # createExecService, withCwd, ext-host 등록 함수
    settings.ts                # defineSettings("l0.exec", …)
    testing/
      index.ts                 # @xeon/platform-exec/testing 진입점
      fake-exec.ts             # fakeExec: 명령별 응답 표 (eng.testing.guide TS-05)
      memory-fs.ts             # memoryFs: 메모리 FileSystem
      conformance.ts           # registerExecConformance: bun:test 등록기 + upstream 사례
  test/
    upstream/env-node.int.test.ts
    upstream/env-node-conformance.int.test.ts
    upstream/env-node-spill.int.test.ts       # bun test --isolate
    upstream/env-line-scan.test.ts
    env-builder.test.ts
    secret-env.test.ts         # (M1)
    background.int.test.ts     # (M2 이후)
    select.test.ts
    providers.test.ts
    service.int.test.ts
    fake-exec.test.ts
    exec-contract.contract.test.ts
    process-group.int.test.ts                  # M0 Bun 스파이크 겸 회귀 시험
    no-platform-branch.test.ts                 # process.platform 위치 검사
    fork-records.test.ts                       # PATCHES·UPSTREAM·표지 일치 검사
```

- F 쪽 변경(`@xeon/contracts/services`의 `services/exec.ts`, review.decisions-2 D-04)은 `F.capabilities.plan`의 작업이다. 이 계획은 EX-02가 그 작업을 선행으로 둔다.
- `fakeExec` 시그니처 [제안]:

```ts
export type FakeExecReply = { readonly exitCode: number; readonly stdout?: string; readonly stderr?: string }
  | { readonly error: ExecutionErrorCode };
/** 키: 문자열 명령은 그대로, argv는 공백으로 이은 문자열. 함수 키는 지원하지 않는다 */
export type FakeExecTable = Readonly<Record<string, FakeExecReply>>;
export interface FakeExecCall {
  readonly command: string | readonly string[];
  readonly options: Omit<ShellExecOptions, "onOutput"> | undefined;
}
export interface FakeExec extends ExecService { readonly calls: readonly FakeExecCall[] }
export function fakeExec(
  table: FakeExecTable,
  options?: { readonly fs?: FileSystem; readonly unknown?: "spawn_error" | "exit127" },
): FakeExec;
```

  - 표에 없는 명령은 기본 `spawn_error`다. `fs`가 없으면 파일 메서드는 `not_supported`를 돌려준다. `stdout`·`stderr`는 `onOutput`으로 한 조각씩 보낸다.
  - `secretEnv`는 해석하지 않고 `calls`에 참조 이름만 남긴다.

## 3. 작업 분해

| id | 내용 | 선행 | 규모 |
|---|---|---|---|
| EX-01 | 포크 복사와 기록 파일: `L0.exec.spec` §3.3.1 표의 파일을 원본 그대로 `src/upstream/`·`test/upstream/`에 복사. `UPSTREAM.json`(원본 URL, 커밋 `cdaf6c227d4718a72b59ccd02152c9614df44cfc`, 버전 1.1.0, `copiedPaths`, `notCopied`), `PATCHES.md` 골격, `LICENSE.pi`. 첫 커밋은 복사만 담아 이후 diff를 패치 단위로 본다 | — | S |
| EX-02 | F 계약 반영 확인: `F.capabilities.plan` P9가 `services/exec.ts`(spec §3.1)를 추가한 뒤 import 경로 확정. F 작업이 늦으면 `L0.readme` §3의 임시 타입 규칙에 따라 `src/contract-shim.ts`(패키지 밖에 export하지 않음)에 같은 선언을 두고 EX-03~06을 진행, F 반영 PR에서 지운다 | F.capabilities.plan의 exec 계약 작업 | S |
| EX-03 | P1 CancelScope 치환: `index.ts:1`, `node.ts:23`, `node-watch.ts:5`를 별칭 import로. chord 미설치 `tsc -b` 확인 | EX-01, EX-02 | S |
| EX-04 | P2 Result 정리: `index.ts:3-17`을 F 재export로. `getOrThrow`·`getOrUndefined`·`toError` 유지와 TS 예외 주석 | EX-03 | S |
| EX-05 | P6 오류 클래스 F 이동: `index.ts:34-74`를 F 재export로. `instanceof` 경로 확인 | EX-04 | S |
| EX-06 | P3 플랫폼 provider 추출: `provider.ts`, `providers/darwin.ts`, `providers/linux.ts`, `select.ts`. `node.ts` 6곳·`node-watch.ts` 4곳을 provider 질의로, 생성 옵션에 `platform` 추가. win32는 EX-17까지 원본 동작을 그대로 옮긴 파일만 둔다 | EX-03 | M |
| EX-07 | P4 vitest → bun:test 포팅: `describe/it/expect/afterEach` import 교체, `vi.spyOn`→`spyOn`, `vi.restoreAllMocks`→`mock.restore`, spill 시험의 `vi.hoisted`+`vi.mock("node:fs")`→모듈 상단 상태 + `mock.module`. 허용 목록 `TS-05/platform-exec-spill` 등록과 그 파일만 `--isolate` 실행 | EX-01 | M |
| EX-08 | P5 Chord 값 import 치환: 테스트 3파일과 `env-conformance.ts`의 `BACKGROUND_CONTEXT`·`withAbortSignal`을 직접 객체로 | EX-03, EX-07 | S |
| EX-09 | 적합성 스위트 이식: `src/testing/conformance.ts`의 `registerExecConformance(name, withEnv, options)`가 `bun:test`의 `describe/it/expect`로 원본 `registerEnvConformance`를 부른다. Linux CI 통과 | EX-06, EX-08 | M |
| EX-10 | Bun 동작 스파이크(시험 1개): `process-group.int.test.ts`가 Bun 1.4.3에서 `spawn(detached: true)` + `process.kill(-pid, "SIGKILL")`로 손자 프로세스까지 끝나는지 확인. 실패하면 위험 표 R-1 대응으로 전환 | EX-06 | S |
| EX-11 | 포크 기록 검사: `fork-records.test.ts`가 `PATCHES.md` 표의 id, `UPSTREAM.json` `modifications`, 소스의 `XEON-PATCH:` 표지 id 집합이 같은지 확인 | EX-03~EX-08 | S |
| EX-12 | env 빌더: `env-builder.ts`(`BASE_ENV_POLICY`, `buildChildEnv`), provider의 `envAllowlistExtra` 연결, 연결 코드가 포크 `exec`에 항상 `inheritEnv: false`를 넘기도록 | EX-06 | M |
| EX-13 | secrets 주입 지점: `secret-env.ts`. `xeon.secrets` 주입(없으면 `secret_unavailable`), `withEnv`로 lease 획득·`finally` 폐기, `SecretEnvRequest.ctx`에 `mode`·`target` 채우기, 오류 메시지에 참조 이름만 | EX-12, `L0.secrets.plan` SC-22(`withEnv`) | M |
| EX-14 | 서비스 조립: `service.ts`(`createExecService`, `withCwd`, 기본 timeout·spill 적용, dispose 시 `cleanup`). ext-host API로 `ExecServiceName` 등록. `settings.ts`의 `defineSettings("l0.exec", …)` 4키 | EX-12, `X.primitives.plan` 등록 API | M |
| EX-15 | sandbox 데코레이터 접점 시험: 가짜 데코레이터가 문자열 명령을 argv로 바꾸고 `env`를 더해 감싼 `Shell`로 `exec`해도 `secretEnv`·`window`·`spill`·`onOutput`이 전달되고 `ShellExecResult.sandbox`가 보존되는지(`service.int.test.ts`). 실제 `platform-sandbox`는 import하지 않는다 | EX-14 | S |
| EX-16 | `fakeExec`·`memoryFs`와 `testing` 서브패스: `src/testing/index.ts`, `package.json` exports `"./testing"`. `fakeExec`를 같은 적합성 스위트의 exec 무관 사례로 시험하지 않고 자체 단위 시험만 둔다 | EX-14 | M |
| EX-17 | (M2+) Windows provider 보강: `providers/win32.ts` 단위 시험, Windows CI job, 적합성 기대 표(spec §5.2) 확인과 표 갱신 | EX-06, EX-09 | M |
| EX-18 | (M2+) Docker 어댑터: `ExecutionEnv`의 컨테이너 구현(`docker exec`를 argv 실행으로, 파일 연산은 바인드 경로 또는 `docker cp`). 적합성 스위트로 시험. 위치(같은 패키지 하위 경로 또는 별도 플러그인)는 그때 정한다 [제안] | EX-09, EX-14 | L |
| EX-19 | (2차) git worktree 격리 래퍼: `git worktree add/remove`를 argv로 실행하는 100줄 안팎 함수와 `withCwd` 조합. 소비자는 `L1.agents.spec` | EX-14 | S |
| EX-21 | 출력 절단 포크와 서비스 메서드: `D/src/truncate.ts`를 `src/upstream/truncate.ts`로, `test/env-truncate.test.ts`를 `test/upstream/truncate.test.ts`로 복사하고 `UPSTREAM.json` `copiedPaths`에 더한다. `ExecService.truncateHead`·`formatSize`를 서비스와 파생 env에 연결한다. 소비자 사본(`cap-workspace/src/truncate`, `apps/host/src/assembly/truncator.ts`)과 core-tools `truncator` 옵션을 지운다(review.decisions-2 D-08, spec §3.1 끝) | EX-01, EX-14 | S |
| EX-20 | (M2 이후) 백그라운드 실행: `background.ts`의 `startBackground`(spec §3.9). 자식 env 빌더 재사용, 새 프로세스 그룹 spawn, `stop(graceful)` SIGTERM·`stop(force)` `killProcessTree`, `exited`, 서비스·파생 env `cleanup` 연동. `BackgroundExecHandle`이 F `BackgroundStopper`에 대입 가능한지 타입 수준으로 확인(`exec-contract.contract.test.ts`, L0 패키지끼리 import하지 않는다) | EX-12, EX-14 | M |

순서: EX-01 → (EX-02) → EX-03 → EX-04 → EX-05, EX-06 ∥ EX-07 → EX-08 → EX-09 ∥ EX-10 → EX-11(M0 끝) → EX-12 → EX-14 → EX-13 ∥ EX-15 ∥ EX-16 ∥ EX-21(M1 끝) → EX-20(M2 이후).

## 4. 채택 코드

### 4.1 포크

| 항목 | 값 |
|---|---|
| 원본 저장소 | `https://github.com/earendil-works/pi` (로컬 사본 `~/projects/_ref/pi-src`의 `origin`으로 확인) |
| 커밋 | `cdaf6c227d4718a72b59ccd02152c9614df44cfc` (2026-10-11, 패키지 `@earendil-works/pi-durable` 1.1.0) |
| 경로 | `packages/durable/src/env/{index,node,node-watch,decode,line-scan}.ts`, `packages/durable/src/testing/{env-conformance,types,runner,assertions}.ts`(env 부분), `packages/durable/test/env-{node,node-conformance,node-spill,line-scan}.test.ts` |
| 라이선스 | MIT. `LICENSE.pi`로 복사하고 배포물 서드파티 고지에 넣는다(위치는 `eng.toolchain.guide`) |
| 바꿀 점 | P1~P6(`L0.exec.spec` §3.3.3) |

- [가정] 원본 줄 번호는 로컬 사본 기준이고 GitHub의 같은 커밋과 같다. adr.0003 §6 [미결]의 "원문 URL과 커밋 확인"은 로컬 사본의 `origin`(`https://github.com/earendil-works/pi.git`)과 `HEAD` 해시로 1차 확인했다. GitHub 원격의 해시 존재는 EX-01에서 `git ls-remote`로 확인한다.

### 4.2 외부 의존

| 의존 | 버전 | 쓰는 곳 | 비고 |
|---|---|---|---|
| Node 내장(`node:child_process`, `node:crypto`, `node:fs`, `node:fs/promises`, `node:os`, `node:path`, `node:url`) | Bun 1.4.3 내장 | 포크 env | 포크 env 폐포의 유일한 외부 import |
| `@xeon/contracts` | 워크스페이스 | 전체 | `Result`, `ok`, `err`, `services` 서브패스(`services/exec.ts`, `services/sandbox-report.ts`, `services/secrets.ts`), `capabilities` 서브패스(`SecretRef`) |
| `@xeon/ext-host` | 워크스페이스 | `service.ts` | 서비스 등록 API |
| `typebox` | 1.3.27(catalog) | `settings.ts` | 설정 스키마 |
| `@types/bun` | 1.4.3(catalog) | dev | |

- 제외: `diff`(`tools/edit-diff.ts:5`), `@silvia-odwyer/photon`(images), `typebox`의 도구 스키마 쓰임, pi-ai 타입(`harness/define.ts:2`)은 tools·images 쪽 의존이라 이 패키지에 들어오지 않는다(`_research/durable-and-search-facts.md` §A-3).
- 정확한 버전은 워크스페이스 catalog(`xeon/package.json` `catalog`) 기준이다. 현재 catalog에는 `typebox` 1.3.27, `@types/bun` 1.4.3이 있다. 새 외부 의존은 없다.
- chord 계열 패키지(`@earendil-works/chord`)는 `dependencies`·`devDependencies` 어디에도 두지 않는다(adr.0003 §4.2 검증 2).

### 4.3 업스트림 갱신 절차 [제안]

1. `UPSTREAM.json`의 `commit`과 새 커밋 사이 `git diff <old> <new> -- packages/durable/src/env packages/durable/src/testing packages/durable/test/env-*`를 본다.
2. 변경이 있는 파일마다 원본 새 판을 `src/upstream/`에 덮어쓴다.
3. `PATCHES.md` 순서대로 P1~P6을 다시 적용하고 `// XEON-PATCH:` 표지를 다시 단다. 새 `process.platform` 분기가 생겼으면 P3에 줄을 더한다.
4. `UPSTREAM.json`의 `commit`, `version`, `modifications`를 갱신한다.
5. `just verify`와 적합성 스위트를 돌린다. `fork-records.test.ts`와 `no-platform-branch.test.ts`가 통과해야 한다.
6. 갱신 주기는 `L0.exec.spec` §10 [미결] 3을 따른다.

## 5. 단위 테스트 목록

| 테스트 이름 | 파일 | 확인할 동작 |
|---|---|---|
| abort kills the whole process group | `process-group.int.test.ts` | `sh -c 'sleep 30 & sleep 30 & wait'` 실행 중 abort하면 `aborted`이고 1초 안에 그룹 프로세스가 0개 |
| timeout kills the process group and reports timeout | `process-group.int.test.ts` | `timeout: 0.2`에서 `timeout` 코드, 그룹 프로세스 0개, abort와 코드가 다름 |
| invalid timeout is rejected before spawn | `upstream/env-node.int.test.ts`(원본) | 0, 음수, 무한, 최대 초과가 `timeout` 오류이고 자식이 없음 |
| spill file is created past either threshold | `upstream/env-node.int.test.ts`(원본) | `afterBytes` 또는 `afterLines`를 넘으면 `spillPath`가 있고 파일에 전체 원출력 |
| spill under backpressure keeps complete output | `upstream/env-node-spill.int.test.ts`(원본) | 느린 쓰기 스트림에서도 spill 파일이 완전하고 시간 초과 때 `ExecutionError.spillPath`가 채워짐 |
| window skips only what cannot be in the tail | conformance "windowed exec keeps the exact tail and counts what it skips" | `skipped` 바이트·개행 수가 정확하고 남긴 꼬리가 창 크기 이상 |
| default spill applies when caller gives none | `service.int.test.ts` | `spill` 없는 호출에 `l0.exec.outputSpillBytes`가 적용됨, 0이면 적용 안 됨 |
| line scan counts LF only and keeps CR | `upstream/env-line-scan.test.ts` + 추가 사례 | CRLF 파일에서 줄 수와 `\r` 보존 |
| line scan ignores a leading BOM | `upstream/env-line-scan.test.ts`(원본) | 시작 BOM이 `selectedBytes`에 들어가지 않음 |
| noFollow refuses a final symlink | conformance "binary reader follows symlinks unless noFollow refuses the final one" | 마지막 성분 링크는 `invalid`, 중간 성분 링크는 해석 |
| win32 noFollow uses lstat precheck | `providers.test.ts` | win32 provider `noFollow === "lstat_precheck"` |
| win32 provider kills the tree with taskkill and spawns attached | `providers.test.ts` | win32 provider의 `killProcessTree(1234)`가 실행하는 argv가 `["taskkill.exe", "/F", "/T", "/PID", "1234"]`(실행 함수 주입), `detachedSpawn === false` |
| watch debounces and reports paths | conformance watch 8종 | 생성·변경·교체·삭제가 보고되고 닫은 뒤 호출 없음 |
| darwin provider enables FSEvents settle rescan | `providers.test.ts` | darwin만 `fsEventsSettleRescan === true`. 감시 설치 직후 쓴 파일 변경이 보고됨(macOS CI에서 conformance) |
| linux provider checks statfs and watches per directory | `providers.test.ts` | linux만 `statfsUnreliableCheck`, `perDirectoryWatchers` 참 |
| env allowlist passes only listed names | `env-builder.test.ts` | 부모의 `GITHUB_TOKEN`, `SOPS_AGE_KEY`, `OP_SESSION_x`, `FOO`가 결과에 없음. `extraPass: ["FOO"]`이면 `FOO`만 있음 |
| env allowlist applies fixed values | `env-builder.test.ts` | `TERM=dumb`, `NO_COLOR=1`, `CI=1`, 부모에 `LANG`이 없으면 `C.UTF-8` |
| env request with a denied name fails before spawn | `env-builder.test.ts`, `service.int.test.ts` | `AWS_SECRET_ACCESS_KEY` 요청이 `env_denied`, 자식 없음 |
| inheritEnv false never copies parent | `env-builder.test.ts` | `inherit: false`이면 `pass` 이름도 없음 |
| child env never equals parent env | `service.int.test.ts` | 실제 `env` 출력 이름 집합 ⊆ 허용 목록 ∪ 요청 ∪ 셸 자체 변수(`PWD`, `SHLVL`, `_`) |
| child env drops secret provider variables | `service.int.test.ts` | 부모 env의 `L0.secrets.spec` §9 1번 이름(`SOPS_AGE_KEY_CMD`, `SOPS_AGE_KEY_FILE`, `SOPS_AGE_KEY`, `AGE_X`, `OP_SERVICE_ACCOUNT_TOKEN`, `BWS_ACCESS_TOKEN`, `BW_SESSION`, `XEON_SECRET_X`)이 실제 자식 `env` 출력에 없다(`L0.secrets.plan` SC-15) |
| secretEnv lease is disposed after use | `secret-env.test.ts` | 성공, 실패, 취소, 시간 초과 4경우 모두 폐기 횟수 = 획득 횟수 |
| secretEnv failure disposes acquired leases | `secret-env.test.ts` | 두 번째 lease 실패 시 첫 lease 폐기, `secret_unavailable`, 자식 없음 |
| secret value never appears in results or logs | `secret-env.test.ts` | 값을 출력하지 않는 명령에서 `ShellExecResult`, 오류 메시지, 기록된 로그 줄에 값 문자열 0회 |
| missing secrets service rejects secretEnv | `secret-env.test.ts` | `secrets: undefined`이면 `secret_unavailable` |
| decorated shell forwards options | `service.int.test.ts` | 가짜 데코레이터 경유 시 `secretEnv`·`window`·`spill`·`onOutput` 전달, `sandbox` 필드 보존 |
| withCwd cleanup kills only its own commands | `service.int.test.ts` | 파생 env `cleanup` 뒤 서비스 env의 명령은 계속 실행 |
| select returns an error value for unsupported OS | `select.test.ts` | `freebsd`, `android`, `aix`가 `unsupported_platform`. `linux` + `WSL_DISTRO_NAME`이면 `wsl: true`, `linux` + `/proc/version`에 `microsoft`이면 `wsl: true`(`L0.os.spec` §3.1 기준) |
| process.platform appears only in select | `no-platform-branch.test.ts` | `src/**`(`src/providers/*`, `src/upstream/**` 포함)를 훑어 `process.platform` 참조가 `src/select.ts` 밖에 0건 |
| (M2 이후) background handle stops the process group | `background.int.test.ts` | spec §9 12번. `pid` 양수, graceful 무시 프로세스가 force 뒤 1초 안에 그룹째 0개, `exited` 이행 |
| fork records agree | `fork-records.test.ts` | PATCHES·UPSTREAM·표지 id 집합 일치. 표지가 있는 파일은 모두 `UPSTREAM.json` `copiedPaths`에 있음 |
| fork and F declarations are mutually assignable | `exec-contract.contract.test.ts` | 포크 `ExecutionEnv`와 F `ExecutionEnv`의 양방향 대입이 타입체크 통과 |
| no chord import remains | `fork-records.test.ts` | `src`·`test`에 chord import 0건 |
| fakeExec replies from the table and records calls | `fake-exec.test.ts` | 표의 명령은 응답, 없는 명령은 `spawn_error`, `calls`에 참조 이름만 |
| conformance suite passes on NodeExecutionEnv | `upstream/env-node-conformance.int.test.ts` | 원본 24개 사례 |

## 6. 완료 기준

- M0:
  - `cd xeon && just verify`가 종료코드 0이다.
  - `just check-layers`가 `platform-exec`를 `L0`로 인식하고 위반 0건이다(`package.json` `"xeon": {"layer": "L0", "domain": "exec"}`).
  - 포크 5파일과 테스트의 변경점이 `PATCHES.md`, `UPSTREAM.json` `modifications`, `// XEON-PATCH:` 표지 셋에서 일치한다(`fork-records.test.ts`).
  - 적합성 스위트 24개 사례가 Linux CI에서 통과한다.
  - EX-10 스파이크 결과(통과 또는 대응 전환)를 `PATCHES.md` 끝 "확인 기록"에 남긴다.
- M1:
  - 위 조건에 더해 macOS CI에서 적합성 스위트가 통과한다.
  - `xeon.exec`가 ext-host로 등록되고 `L2.workspace`의 `read`·`ls`·`bash`가 이 서비스로 돈다(M1 스모크, `product.scope.spec` §4.4).
  - `L0.exec.spec` §9 수용 기준 1~11이 아래 대응 표의 시험으로 확인된다. 10번은 M1에서 Windows provider 단위 시험까지만 확인한다. 5번은 EX-13(M1), 12번은 M2 이후(EX-20)다.
- M2 이후: §9 10번의 Windows 네이티브 적합성 기대 표가 Windows CI 결과로 갱신된다. §9 12번이 `background.int.test.ts`로 확인된다.

수용 기준과 시험 대응:

| spec §9 | 시험 |
|---|---|
| 1 | conformance suite passes on NodeExecutionEnv(Linux·macOS CI) |
| 2 | abort kills the whole process group, timeout kills the process group and reports timeout |
| 3 | env allowlist passes only listed names, child env never equals parent env, child env drops secret provider variables |
| 4 | env request with a denied name fails before spawn |
| 5 | secretEnv lease is disposed after use, secret value never appears in results or logs, secretEnv failure disposes acquired leases |
| 6 | select returns an error value for unsupported OS |
| 7 | process.platform appears only in select |
| 8 | fork records agree |
| 9 | no chord import remains |
| 10 | win32 noFollow uses lstat precheck, win32 provider kills the tree with taskkill and spawns attached |
| 11 | fork and F declarations are mutually assignable |
| 12 | (M2 이후) background handle stops the process group |

## 7. 위험과 대응

| 위험 | 영향 | 대응 | 확인 방법 |
|---|---|---|---|
| R-1 Bun 1.4의 `node:child_process` `detached`와 `process.kill(-pid)` 동작이 Node와 다름 [가정] | abort·timeout 뒤 손자 프로세스가 남음 | M0 스파이크 시험 1개(EX-10). 실패하면 provider의 `killProcessTree`를 `Bun.spawn`의 프로세스 그룹 옵션 또는 `pkill -KILL -g <pgid>` argv 실행으로 바꾼다(포크 본문 변경 없이 provider 안에서) | `process-group.int.test.ts`가 Linux·macOS CI에서 통과 |
| R-2 업스트림이 실험 API("changes without notice")라 무고지 변경 | 갱신 때 패치 재적용 비용 | 커밋 고정 포크. 자동 추적하지 않고 4.3절 절차로만 갱신 | `UPSTREAM.json` `commit`이 고정 해시이고 `fork-records.test.ts` 통과 |
| R-3 vitest 전용 헬퍼 이식 비용(`vi.hoisted`, `vi.mock` 부분 모듈, `mockImplementationOnce`) | P4 규모 증가, `mock.module` 누수 | spill 시험만 `mock.module` + `--isolate`(TS-05 예외 기록). 나머지는 `spyOn`·`mock.restore`로 1:1 대응 | 포팅 4파일이 패키지 `bun test`와 `--isolate` 실행 둘 다에서 통과 |
| R-4 Bun `mock.module`이 Node 내장 `node:fs`를 바꾸는지 [가정] | spill 역압 시험이 무력화 | 바꾸지 못하면 `NodeExecutionEnv` 생성 옵션에 쓰기 스트림 팩토리를 넣는 패치(P7 후보)로 전환 | EX-07에서 시험이 실제로 느린 스트림을 쓰는지 단언(쓰기 지연 측정) |
| R-5 watch 사례 시간(사례당 최대 30초)과 `int` 10초 상한 충돌 | `just verify` 시간 초과 또는 TS-01 위반 | 적합성 등록을 watch 사례와 나머지 두 파일로 나눈다. watch 파일의 태그·상한은 `L0.exec.spec` §10 [미결] 5의 결정을 따른다 | 파일별 실행 시간 기록(`bun test --reporter` 출력) |
| R-6 Windows 경로·셸 변수(드라이브 문자, `\`, `%ProgramFiles(x86)%`, Git Bash 탐색, CRLF) | Windows provider 오동작 | M1은 win32 provider를 원본 동작 그대로 옮기고 단위 시험만 둔다. 실제 확인은 M2 Windows CI | `providers.test.ts`의 win32 사례(후보 경로 문자열, taskkill argv)와 M2 Windows CI 적합성 결과 |
| R-7 원본 줄 번호가 GitHub 같은 커밋과 다름 [가정: adr.0003 §3.2] | 패치 표 위치 오기 | EX-01에서 `git ls-remote`와 파일 해시 대조 | `UPSTREAM.json`에 파일별 sha256 기록 후 원격 파일과 비교 |
| R-8 env 허용 목록이 좁아 도구 체인이 깨짐(예: `NVM_DIR`, `JAVA_HOME`, 프록시 변수) | 사용자 명령 실패 | `l0.exec.envAllowlist.extra`로 더하기 허용, `env_denied` 메시지에 이름과 설정 키 안내 | `service.int.test.ts`의 `extra` 사례, M1 스모크에서 `node`·`git`·`rg` 실행 |
| R-9 spill 파일에 env 모드 비밀이 원문으로 남음 | 디스크 노출 | env 모드가 M1이므로 EX-13 착수 전에 `L0.exec.spec` §10 [미결] 4를 정한다. 정하기 전에는 `secretEnv`가 있는 호출의 spill을 끈다 [제안] | EX-13 시험에서 임시 디렉터리에 `pi-output-*` 파일의 값 문자열 검색 0건 |
