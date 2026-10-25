---
id: L0.sandbox.plan
layer: L0
domain: sandbox
kind: plan
status: draft
depends_on: [L0.sandbox.spec, L0.exec.spec, eng.testing.guide]
binds: [xeon/packages/platform-sandbox/**]
---

# L0 sandbox 구현 계획

## 1. 목표와 마일스톤 배치

목표: srt 0.0.79을 감싼 `xeon.sandbox`(`SandboxService`)를 만들어 M1에서 `xeon chat`의 bash 도구가 샌드박스 안에서 돌게 한다(`L0.sandbox.spec`).

| 마일스톤 | 범위 | 근거 |
|---|---|---|
| M0 | 없음. SB-01 스파이크만 M0 끝에 먼저 돌려 M1 위험을 줄인다 [제안] | `_research/foundation-plan.md` §5 P4 M0 범위에 sandbox 없음 |
| M1 | srt 래핑(`wrapShell`), 상태 탐지, 보호 경로, 자동 허용 판정, 자가 시험, `onUnavailable` 정책, 위반 기록, doctor 출력, 설정, 서비스 등록, `fakeSandbox` | [결정: foundation-plan §5 M1 "도구 read, ls, bash(sandbox)"], `product.scope.spec` §4.4 M1 "샌드박스 `bash`가 작업 폴더 밖 쓰기를 거부한다" |
| M2 | 자가 시험 호출 경로, 실제 srt 통합 시험 | SB-17, SB-18 |
| SB-18 | (M2) 실제 srt 통합 시험 `sandbox.int.test.ts`(spec §9 12~13): 실제 bwrap·Seatbelt로 쓰기 루트 밖 쓰기 거부(감싸지 않은 대조 포함), `.git/hooks`, 보호 canary 읽기, 빈 deny 목록과 `protectedPaths.extra`, 네트워크 거부, 자가 시험 6항목. 필수 바이너리가 없을 때 `XEON_REQUIRE_SANDBOX=1`·CI는 종료 코드 2. 실제 srt로 처음 돌려 `env_allowlist`가 srt 프록시 토큰 env 때문에 실패함을 찾아 자가 시험을 고쳤다 | SB-07, SB-12 | M |
| M2 이후 | 네트워크 허용 도메인 정책(srt 프록시), 이름 붙은 권한 프로필과 오프라인 규칙 검사, Windows 대응(srt-win alpha 재평가), srt 버전 갱신 | [결정: 계획 v2 L0-b 2차 항목], `_research/decisions-log.md` 2026-10-19 Windows 나중 |

## 2. 패키지와 파일 배치

```
xeon/packages/platform-sandbox/
  package.json                 # name @xeon/platform-sandbox, "xeon": {"layer": "L0", "domain": "sandbox"}
                               # dependencies: "@anthropic-ai/sandbox-runtime": "catalog:" (0.0.79)
                               # exports: "." → src/index.ts, "./testing" → src/testing/index.ts
  tsconfig.json                # references: ../contracts, ../ext-host
  src/
    index.ts                   # 공개 export: 플러그인 정의, createSandboxService(조립 루트 전용, L0.readme §3). describeSandboxStatus는 F(services/sandbox.ts, review.decisions-2 D-04)
    provider.ts                # SandboxProvider, RequiredBinary
    providers/darwin.ts        # seatbelt, rg, macOS 보호 경로(LaunchAgents, Library sops 경로)
    providers/linux.ts         # bwrap, socat, rg, WSL2 변종, WSL1·지원 밖 아키텍처 → none
    providers/win32.ts         # none, unsupported_os
    select.ts                  # process.platform·process.arch·/proc/version을 읽는 유일한 곳
    policy.ts                  # toSrtConfig: Xeon 정책 → srt 설정 (순수 함수)
    protected-paths.ts         # 공통 보호 경로 표, OsDirs 입력으로 항목 생성, basename 전개
    auto-allow.ts              # autoAllow 판정 (순수 함수)
    self-test.ts               # 자가 시험 6항목
    wrap-shell.ts              # wrapShell 데코레이터, 위반 수집, cleanupAfterCommand
    status.ts                  # 상태 탐지, installHints 채우기, 시작 로그 한 줄
    srt.ts                     # srt import를 모은 얇은 어댑터 (이 파일만 srt를 import)
    service.ts                 # createSandboxService, ext-host 등록
    settings.ts                # defineSettings("l0.sandbox", …)
    testing/
      index.ts                 # @xeon/platform-sandbox/testing
      fake-sandbox.ts          # fakeSandbox
  test/
    policy.test.ts
    protected-paths.test.ts
    auto-allow.test.ts
    on-unavailable.test.ts
    status.test.ts
    self-test.test.ts
    wrap-shell.test.ts         # 가짜 srt 어댑터로
    select.test.ts
    srt-config.contract.test.ts  # srt 스키마로 변환 결과 검증
    srt-spike.int.test.ts        # SB-01 스파이크 겸 회귀
    sandbox.int.test.ts          # 실제 srt로 보호 경로 거부·작업 공간 쓰기
```

- srt import는 `src/srt.ts` 한 파일로 모은다. 나머지 파일은 `srt.ts`가 내보내는 좁은 인터페이스(`SrtPort`: `initialize`, `isSupportedPlatform`, `checkDependencies`, `wrapWithSandboxArgv`, `getViolationsForCommand`, `cleanupAfterCommand`, `reset`, `validateConfig`)만 쓴다. 단위 시험은 이 포트의 가짜를 주입한다(`eng.testing.guide` TS-05, `mock.module` 없이).
- `fakeSandbox` 시그니처 [제안]:

```ts
export interface FakeSandboxOptions {
  readonly status?: Partial<SandboxStatus>;              // 기본: available true, level "srt"
  readonly autoAllow?: AutoAllowDecision;                // 기본: 실제 auto-allow.ts 판정
  readonly protectedPaths?: readonly ProtectedPathEntry[];
}
export interface FakeSandbox extends SandboxService {
  /** wrapShell로 감싼 exec 호출 기록: 명령, 정책, sandboxed 여부 */
  readonly wrapped: readonly { command: string | readonly string[]; policy: SandboxPolicy }[];
}
export function fakeSandbox(options?: FakeSandboxOptions): FakeSandbox;
```

  - `wrapShell`은 아래 `Shell`을 그대로 부르고 결과에 `sandbox: { sandboxed: status.available, level, violations: [], violationsTruncated: false }`를 붙인다. `onUnavailable` 표(spec §4.5)는 실제 규칙을 쓴다.

## 3. 작업 분해

| id | 내용 | 선행 | 규모 |
|---|---|---|---|
| SB-01 | srt 의존 고정과 Bun 구동 스파이크: catalog에 `"@anthropic-ai/sandbox-runtime": "0.0.79"` 추가, `platform-sandbox` 의존 선언, DR-07 소유표 행 확인. `srt-spike.int.test.ts` 1개로 (a) Bun 1.4.3에서 `initialize` + `wrapWithSandboxArgv` + 실행 한 번, (b) 반환 `env`가 전체인지 추가분인지, (c) `bun build --compile` 산출물에서 헬퍼 경로(apply-seccomp) 탐색 성공 여부를 확인 | L0.exec.plan EX-09(셸 실행 경로) | M |
| SB-02 | 상태 탐지: `provider.ts`, `providers/*`, `select.ts`, `status.ts`. 필요 프로그램 PATH 탐색과 절대 경로 기록, srt `isSupportedPlatform`·`checkDependencies` 결과 대응, `SandboxStatus.installHints`. `describeSandboxStatus` 본문은 F 순수 함수라 `F.capabilities.plan` 작업이고 이 작업은 그 시험 사례를 제공한다 | SB-01 | M |
| SB-03 | 정책 변환기: `policy.ts`의 `toSrtConfig`(경로 절대화·realpath·정렬·중복 제거, 리터럴만, 고정 값, 프로세스 전역/명령별 분리), srt 스키마 검증 | SB-01 | M |
| SB-04 | 보호 경로 목록과 경로 질의 연동: `protected-paths.ts`(spec §3.3 표), `xeon.os` 디렉터리(`OsDirs.home`·`data`·`config`)와 `SecretService.protectedPaths()` 주입, `<xeonConfig>/secrets/` 행, `protectedPaths.extra` 합치기, basename 전개, 보호 경로 안 쓰기 루트 제거 | SB-03, L0.os.plan 디렉터리 질의, L0.secrets.plan SC-21 | M |
| SB-05 | `wrapShell` 데코레이터: `wrap-shell.ts`(spec §4.2 1~10단계), argv → 셸 문자열 인용, `commandId` 생성, srt env 차이 계산, 래핑 실패 처리 | SB-02, SB-03, SB-04 | L |
| SB-06 | `autoAllow` 판정: `auto-allow.ts`, 경로 마디 포함 비교 | SB-03 | S |
| SB-07 | 자가 시험: `self-test.ts` 6항목, canary 준비·정리, status 반영 | SB-05, L0.exec.plan EX-12(`SENSITIVE_ENV_PATTERNS`) | M |
| SB-08 | `onUnavailable` 정책: `wrapShell` 안의 3값 분기, `enabled=false` 처리, `escapeRetry` 검사 | SB-05 | S |
| SB-09 | 위반 기록 수집: `getViolationsForCommand` → `SandboxViolation` 변환(합치기, 200자 자르기, 50개 상한), Linux 모니터 기본 끔 | SB-05 | S |
| SB-10 | doctor 출력: `describeSandboxStatus`의 severity·hints, 시작 로그 한 줄. `L4.cli.plan`에 종료 코드 2 계열 연결 요청 | SB-02 | S |
| SB-11 | 설정 정의: `settings.ts`의 `defineSettings("l0.sandbox", …)` M1 6키(`enabled`, `onUnavailable`, `protectedPaths.extra`, `writeRoots.extra`, `escapeRetry`, `selfTestIntervalMin`. spec §6 표의 `network.allowedDomains`, `network.deniedDomains` 2키는 M2에서 더한다), 범위 제한(넓히는 키는 `project` 제외), `ui.tab` 임시값 `"permissions"` | SB-02 | S |
| SB-12 | 서비스 등록: `service.ts`의 `createSandboxService`, ext-host로 `SandboxServiceName` 등록, dispose 때 srt `reset()`. `fakeSandbox`와 `testing` 서브패스 | SB-05~SB-11, `X.primitives.plan` 등록 API | M |
| SB-13 | (M2) 네트워크 정책: `l0.sandbox.network.*` 키 활성화, `strictAllowlist` 해제 여부, 프록시 env와 exec 허용 목록 연동, `deniedResolvedAddresses` 기본값, `L0.secrets` sentinel 모드(후속)와 프록시 공존 확인 | SB-12 | L |
| SB-14 | (M2) 프로필·오프라인 검증: 이름 붙은 프로필(정책 묶음)과 실행 없는 규칙 검사 명령. Gemini CLI policy 구조는 참고만 | SB-12 | M |
| SB-15 | (M2+) Windows 대응: srt-win alpha 재평가. 채택하면 win32 provider를 `srt`로 올리고 Windows CI | SB-12 | L |
| SB-16 | (후속, sentinel 모드) 프록시 훅: 자식 HTTPS 요청의 헤더에서 sentinel을 값으로 바꾸는 훅을 `SandboxService`에 둘지 정하고 구현한다. srt `mitmProxy`(외부 Unix 소켓) 연결 안과 `parentProxy` 체이닝 안 비교, TLS 종단(`L0.secrets.spec` §10 6번). 선행 조건이 `L0.secrets.plan` SC-20이다 | SB-13 | L |
| SB-17 | (M2) 자가 시험 호출 경로: `startSelfTests(shell)`(시작 직후 한 번, `selfTestIntervalMin`마다 반복, `stop`, dispose 연동). `self-test-schedule.test.ts`가 간격 재읽기, 0 처리, 항목 실패와 시험 자체 오류의 구분, 취소를 확인. 호출은 `L4.host-service`가 건다 | SB-07, SB-12 | S |

순서: SB-01 → SB-02 ∥ SB-03 → SB-04, SB-06 → SB-05 → SB-07 ∥ SB-08 ∥ SB-09 → SB-10, SB-11 → SB-12(M1 끝).

## 4. 채택 코드

| 항목 | 값 |
|---|---|
| 패키지 | `@anthropic-ai/sandbox-runtime` |
| 버전 | `0.0.79` 정확 고정(캐럿·틸드 없음). workspace catalog에 둔다 |
| 라이선스 | Apache-2.0. 배포물 서드파티 고지에 넣는다(위치 `eng.toolchain.guide`) |
| 저장소 | `https://github.com/anthropics/sandbox-runtime`(태그 v0.0.79) |
| 런타임 의존 | `zod ^3.25.0`, `commander ^12.1.0`, `node-forge ^1.4.0`, `@pondwader/socks5-server ^1.0.10`(srt `package.json`). lockfile로 고정된다 |
| 포크 | 없음. 래핑만 한다 |
| 소유 | `platform-sandbox`만 import한다(DR-07). 패키지 안에서도 `src/srt.ts`만 |

- 0.0.x이고 README가 "Beta Research Preview"와 설정 형식 변경 가능성을 적었다. 2026-10-07~10-20에 3회 릴리스가 있었고 0.0.79 이후 deny 콜백 동작이 바뀌었다(`_research/notes/L0-1.md` §0 10번). 상위 버전으로 올릴 때는 변경 기록(`CHANGELOG`·릴리스 노트) 확인이 필수다.

업그레이드 점검 항목 [제안]:

1. `SandboxRuntimeConfigSchema` diff: `filesystem.*`, `network.*`, `seccomp`, `bwrapPath`, `socatPath`, `ripgrep`, `mandatoryDenySearchDepth`의 키 이름·기본값·타입이 바뀌었는지(`src/sandbox/sandbox-config.ts`).
2. `ISandboxManager` 메서드 시그니처 diff: `initialize`, `wrapWithSandboxArgv`, `getSandboxViolationStore`, `cleanupAfterCommand`, `reset`, `checkDependencies`(`dist/sandbox/sandbox-manager.d.ts`).
3. 자동 보호 경로 목록(README "mandatory deny")이 줄었는지. 줄었으면 Xeon 보호 경로 표에 해당 경로가 있는지 확인한다.
4. Linux 경로 문법 규칙(리터럴·글로브 처리) 변경 여부.
5. Bun 분기(`process.versions.bun`) 변경 여부와 Bun 최소 버전.
6. `srt-config.contract.test.ts`, `sandbox.int.test.ts`를 새 버전으로 통과.

## 5. 단위 테스트 목록

| 테스트 이름 | 파일 | 확인할 동작 |
|---|---|---|
| policy normalizes paths to absolute realpaths | `policy.test.ts` | 상대 경로·`~/`·`..`가 절대 경로로, 심볼릭 링크는 realpath로, 없는 경로는 상위 realpath + 나머지 |
| policy removes duplicates and sorts | `policy.test.ts` | 같은 경로 두 번 → 한 번, 결과가 정렬됨 |
| policy emits literal paths only | `policy.test.ts` | 결과에 `*`, `?`, `[`가 없음(Linux·macOS 공통) |
| policy keeps network global and files per command | `policy.test.ts` | 전역 설정에는 `filesystem` 명령 정책이 없고 `customConfig`에는 `network`가 없음 |
| policy pins weakening options off | `policy.test.ts` | `allowNestedUserNamespaces`, `enableWeakerNestedSandbox`, `allowGitConfig` 등이 거짓 |
| srt schema accepts converted config | `srt-config.contract.test.ts` | `toSrtConfig` 결과가 srt `SandboxRuntimeConfigSchema`를 통과 |
| protected paths cannot be reduced by settings | `protected-paths.test.ts` | `protectedPaths.extra`를 비우거나 정책 `readDeny: []`여도 기본 항목이 모두 유효 정책에 있음 |
| protected paths extra adds entries | `protected-paths.test.ts` | 추가 경로가 `read_write`로 들어감 |
| protected paths include secret files | `protected-paths.test.ts` | 가짜 `SecretService.protectedPaths()`의 경로와 `<xeonConfig>/secrets/`가 `read_write` `secret_key` 항목으로 들어감 |
| protected paths use OS dirs | `protected-paths.test.ts` | 가짜 `OsDirs`의 데이터·설정 디렉터리가 표에 반영, darwin만 LaunchAgents·Library sops 경로 |
| basename entries expand with exceptions | `protected-paths.test.ts` | 쓰기 루트 아래 `.env`, `.env.local`은 들어가고 `.env.example`은 빠짐, 깊이 상한 준수 |
| write root inside protected path is removed | `protected-paths.test.ts` | `writeRoots`에 데이터 디렉터리가 있으면 유효 정책에서 빠짐 |
| matchProtectedPath decides by access | `protected-paths.test.ts` | `write` 전용 항목은 읽기에 걸리지 않음, prefix는 경로 마디 비교(`/a/bc`는 `/a/b` 아님) |
| autoAllow decision table | `auto-allow.test.ts` | 조건 5개 참·거짓 32조합의 `allow`와 `blocks` |
| autoAllow never allows escape | `auto-allow.test.ts` | `escapeRetry` 참이어도 `allowEscape: true`는 `escape_requested` |
| onUnavailable disable_execute rejects without spawn | `on-unavailable.test.ts` | 아래 `Shell` 호출 0회, `sandbox_unavailable` |
| onUnavailable ask needs escape | `on-unavailable.test.ts` | `allowEscape: false`는 거부, `true`면 실행하고 `unsandboxedBy: "escape"` |
| onUnavailable run_unsandboxed runs and marks | `on-unavailable.test.ts` | 실행, `unsandboxedBy: "run_unsandboxed"` |
| disabled sandbox runs and marks disabled | `on-unavailable.test.ts` | `enabled=false`이면 `unsandboxedBy: "disabled"`, 상태 reason `disabled` |
| status reports missing binaries | `status.test.ts` | PATH에 `bwrap` 없음 → `missing: ["bwrap"]`, `reason: "missing_dependency"`, hints에 설치 명령 |
| status maps unsupported platforms | `status.test.ts`, `select.test.ts` | win32, WSL1(`/proc/version`에 `Microsoft`만), `freebsd`, linux `ia32` → `none`·`unsupported_os` |
| disabled sandbox warns in start log and doctor | `status.test.ts` | `enabled=false`이면 시작 로그 한 줄에 `reason=disabled`, `describeSandboxStatus` 결과 `severity: "warn"`(spec §9 6번) |
| start log and report carry no secret values | `wrap-shell.test.ts` | 가짜 값 `S`를 `secretEnv` 참조로 넘긴 호출에서 시작 로그 줄, `SandboxRunReport`, 위반 기록에 `S`가 없고 아래 `Shell`이 받은 옵션에 참조 이름이 그대로 있음(spec §9 10번) |
| status after failed self-test | `status.test.ts` | 자가 시험 실패 뒤 `available: false`, `reason: "self_test_failed"`, `lastSelfTest.failed` |
| self-test reports each failing item | `self-test.test.ts` | 가짜 `Shell` 응답으로 6항목 각각 실패시켜 `items[i].passed === false`, 출력 원문 미포함 |
| self-test cleans its files | `self-test.test.ts` | 시험 뒤 canary·임시 디렉터리 없음 |
| wrapShell merges protected paths and forwards options | `wrap-shell.test.ts` | 가짜 srt 포트가 받은 `customConfig`에 보호 경로, 아래 `Shell`이 받은 옵션에 `secretEnv`·`window`·`spill`·`onOutput` 유지 |
| wrapShell quotes argv commands | `wrap-shell.test.ts` | `["printf", "%s", "a'b c"]`가 셸 문자열로 바뀌어 원래 인자를 보존 |
| wrapShell passes only srt env additions | `wrap-shell.test.ts` | 부모 env와 같은 값은 빠지고 추가·변경 키만 `env`로 |
| wrap failure skips cleanupAfterCommand | `wrap-shell.test.ts` | 래핑 throw → `sandbox_failed`, `cleanupAfterCommand` 0회 |
| violations are merged, truncated and value-free | `wrap-shell.test.ts` | 같은 대상 합침, target 200자, 50개 상한과 `violationsTruncated` |
| select is the only platform reader | `select.test.ts` | `src/**`에서 `process.platform`·`process.arch`·`/proc/version` 참조가 `select.ts` 밖에 0건 |

통합 테스트(`int`, 실제 srt):

| 테스트 이름 | 파일 | 확인할 동작 |
|---|---|---|
| protected paths are denied inside the sandbox | `sandbox.int.test.ts` | 임시 홈·데이터 디렉터리를 가짜 `OsDirs`로 주고 canary 읽기·데이터 디렉터리 쓰기·`.git/hooks` 쓰기가 실패 |
| empty caller deny lists keep protection and extra paths deny reads | `sandbox.int.test.ts` | `readDeny: []`, `writeDeny: []` 정책에서도 위 결과가 같고, `protectedPaths.extra`에 넣은 경로의 canary 읽기가 실패(spec §9 4번) |
| workspace write succeeds inside the sandbox | `sandbox.int.test.ts` | 쓰기 루트 안 `touch` 성공 |
| network is denied by default | `sandbox.int.test.ts` | `/dev/tcp` 연결 실패 |
| sandboxed result carries the report | `sandbox.int.test.ts` | `sandbox.sandboxed === true`, `level === "srt"` |
| srt runs under Bun | `srt-spike.int.test.ts` | SB-01 (a)~(c) |

- 실행 조건: Linux(Ubuntu 24.04 포함)와 macOS CI 러너. `sandbox.int.test.ts`는 시작 때 `status()`를 본다. `missing_dependency`나 `unsupported_os`이면 시험을 건너뛰지 않고 환경 문제로 실패시킨다(테스트 실패 메시지에 `missing`과 설치 안내, `just` 레시피 종료코드 2 계열로 보고) [제안]. 건너뛰면 CI가 격리 없이 녹색이 되기 때문이다.
- `int` 파일당 10초 상한(`eng.testing.guide` TS-01)을 지키도록 srt `initialize`는 파일당 한 번만 한다.

## 6. 완료 기준

- `cd xeon && just verify`가 종료코드 0이다. `just check-layers`가 `platform-sandbox`를 `L0`로 인식하고, srt import가 `platform-sandbox/src/srt.ts` 밖에 없다(DR-07).
- `platform-sandbox`가 `@xeon/platform-exec`를 import하지 않는다(DR-02). `package.json` 의존 목록에도 없다.
- M1 스모크(`apps/cli` scenario 1개)에서 bash 도구 호출의 도구 결과 이벤트 details에 `sandbox.sandboxed: true`, `level: "srt"`가 있어 srt 경유 실행임을 확인한다. 같은 스모크에서 작업 폴더 밖 쓰기가 실패한다(`product.scope.spec` §4.4 M1).
- Linux·macOS CI에서 `sandbox.int.test.ts`가 통과한다. 의존이 없는 러너는 환경 문제로 실패해 보고된다.
- Windows provider 시험(`status.test.ts`, `on-unavailable.test.ts`의 win32 사례)에서 `status=none`, `reason=unsupported_os`, 기본 정책 `disable_execute`가 자식 프로세스 없이 거부함을 확인한다.
- `L0.sandbox.spec` §9 수용 기준 1~11이 아래 대응 표의 시험으로 확인된다.

| spec §9 | 시험 |
|---|---|
| 1 | protected paths are denied inside the sandbox |
| 2 | protected paths are denied inside the sandbox(데이터·`.git/hooks`·`.git/config` 쓰기) |
| 3 | workspace write succeeds inside the sandbox |
| 4 | empty caller deny lists keep protection and extra paths deny reads, protected paths cannot be reduced by settings |
| 5 | status reports missing binaries |
| 6 | disabled sandbox runs and marks disabled, disabled sandbox warns in start log and doctor |
| 7 | status maps unsupported platforms, onUnavailable disable_execute rejects without spawn, onUnavailable run_unsandboxed runs and marks |
| 8 | autoAllow decision table |
| 9 | sandboxed result carries the report, M1 스모크 |
| 10 | wrapShell merges protected paths and forwards options, start log and report carry no secret values |
| 11 | wrap failure skips cleanupAfterCommand |

## 7. 위험과 대응

| 위험 | 영향 | 대응 | 확인 방법 |
|---|---|---|---|
| srt의 Bun 호환(Node 전제, `engines` Node ≥22.12) [가정: `_research/notes/L0-1.md` §7은 코드 분기 확인만] | 초기화·래핑 실패 | SB-01 스파이크. 실패하면 `srt` CLI를 argv로 실행하는 후퇴안(래핑 결과만 받는 형태)을 검토 | `srt-spike.int.test.ts` (a) |
| `bun build --compile` 사이드카에서 srt 보조 바이너리(apply-seccomp) 접근 실패 [가정] | 사이드카에서 Linux 샌드박스 시작 실패 | 상태 탐지에서 헬퍼 절대 경로를 `seccomp.applyPath`로 넘기고, 사이드카 배포물에 헬퍼를 함께 둔다. 또는 `seccomp.argv0` multicall | `srt-spike.int.test.ts` (c), L4 desktop 빌드 스모크 |
| Linux 비특권 사용자 네임스페이스 제한 배포판(Ubuntu 24.04 `apparmor_restrict_unprivileged_userns`) [가정] | bwrap 실패 → 자가 시험 실패 → `bash` 꺼짐 | doctor hints에 sysctl·AppArmor 프로필 안내. 자가 시험이 실패를 정직하게 보고 | CI 매트릭스에 Ubuntu 24.04 러너를 넣고 `sandbox.int.test.ts` 결과 확인 |
| srt 프록시와 secrets sentinel 모드(후속) 접점 충돌 | 후속에 프록시 두 개(srt 프록시, sentinel 프록시)가 겹침 | M1은 네트워크 전부 차단이라 충돌 없음. SB-13·SB-16에서 srt `mitmProxy`(외부 Unix 소켓)로 sentinel 프록시를 연결하는 안과 `parentProxy` 체이닝 안을 비교 | SB-13·SB-16 설계 검토, `L0.secrets.plan` SC-20과 함께 |
| 보호 경로 과다로 정상 작업이 막힘(자격 파일 읽기 거부로 `gh`, 사설 레지스트리 `npm` 인증 실패, 네트워크 전부 차단으로 패키지 설치 실패) | 사용성 저하, 사용자가 샌드박스를 끔 | 거부 사유를 위반 기록과 stderr 주석으로 보이고, 비밀 env 주입(`secretEnv`)과 2차 네트워크 정책으로 대체 경로를 둔다. 기본값 조정은 spec §10 [미결] 1·7 | M1 스모크와 사용 기록에서 `credentials`·`network` 위반 빈도 확인 |
| srt 0.0.x 무고지 설정 변경 | 업그레이드 때 정책이 조용히 약해짐 | 정확 고정, 4절 점검 항목, `srt-config.contract.test.ts` | 업그레이드 PR마다 계약 시험과 int 시험 통과 |
| srt 싱글턴(프로세스당 네트워크 정책 하나) | 공유 서비스 모드에서 세션별 네트워크 정책 불가 | 1차는 네트워크 전부 차단이라 영향 없음. 2차에 세션별 정책이 필요하면 엔진 프로세스를 나눈다(`_research/notes/L0-1.md` §8) | SB-13 설계 검토 |
| 병렬 명령에서 `cleanupAfterCommand`가 다른 명령의 마운트 지점에 영향 [가정] | 실행 중 명령의 격리가 깨짐 | 래핑 실패 때는 부르지 않는다. 정상 종료 뒤 호출이 안전한지 SB-01에서 병렬 2개로 확인 | `srt-spike.int.test.ts`에 병렬 사례 추가 |
