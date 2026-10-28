---
id: L0.sandbox.spec
layer: L0
domain: sandbox
kind: spec
status: draft
depends_on: [F.capabilities.spec, L0.exec.spec, L0.os.spec, L0.secrets.spec, adr.0001, eng.dependency-rules.guide]
binds: [xeon/packages/platform-sandbox/**]
---

# L0 sandbox 스펙: OS 샌드박스 `xeon.sandbox`

## 1. 목적과 범위

`platform-sandbox`는 셸 명령과 그 자식 프로세스를 OS 샌드박스(macOS Seatbelt, Linux bubblewrap) 안에서 실행하게 하는 서비스 `xeon.sandbox`(`SandboxService`)를 제공한다. 격리 구현은 `@anthropic-ai/sandbox-runtime`(이하 srt) 0.0.79(Apache-2.0)을 그대로 쓰고, 이 패키지는 Xeon 정책과 srt 설정 사이의 접착 계층이다 [결정: `_research/foundation-plan.md` §2 샌드박스 행, `_research/packages.md` §4.2 L0-b].

- [결정: `eng.dependency-rules.guide` DR-07] srt는 `platform-sandbox`만 import한다.
- [결정: DR-02] `platform-sandbox`는 `platform-exec`를 import하지 않는다. 두 패키지는 F `Shell` 인터페이스로만 만난다(3.4절).

정하는 것:

- F에 둘 샌드박스 계약 초안: `SandboxService`, `SandboxStatus`, `SandboxPolicy`, `AutoAllowDecision`, `SelfTestReport`, `SandboxRunReport`, `describeSandboxStatus`(3.1절)
- Xeon 정책 → srt 설정 매핑(3.2절), 보호 경로 목록(3.3절)
- `wrapShell` 데코레이터의 동작(4.2절), 자동 허용 판정(4.3절), 자가 시험(4.4절), 격리 불가 시 동작(4.5절)
- 플랫폼별 제약(5.2절), 설정 키(6절), 수용 기준(9절)

다루지 않는 것:

| 대상 | 정하는 곳 |
|---|---|
| 셸 실행, 자식 env 허용 목록, 비밀 주입 | `L0.exec.spec` |
| 승인 UI, 권한 모드, 명령 패턴 규칙, 자동 허용 판정의 적용 | `L1.tools.spec` |
| 파일 도구(read, write, edit, ls, grep, find)의 경로 검사 | `L2.workspace.spec` §4.3 (이 문서는 보호 경로 목록과 판정 함수만 준다) |
| 비밀 lease, sentinel 프록시, 마스킹 | `L0.secrets.spec` |
| 사용자·앱 디렉터리 질의 | `L0.os.spec` |
| doctor 명령과 종료 코드 | `L4.cli.spec` |

범위와 단계:

| 구성요소 | 단계 | 표지 |
|---|---|---|
| OS 샌드박스(srt 래핑), 보호 경로, 자가 시험, 격리 불가 정책 | 1차, M1 | [결정: `_research/foundation-plan.md` §5 M1 "도구 read, ls, bash(sandbox)"], `_research/layer-plan-v2.json` L0-b 1차 |
| 네트워크 정책(srt 프록시) | M3b에서 기본 허용 + 차단 도메인 목록(§3.2, §10 1번). 허용 목록 방식은 후속. M1은 전부 차단이었다 | [결정: 계획 v2 L0-b "네트워크 정책 2차"] / 1차 차단 [제안] |
| 이름 붙은 권한 프로필, 실행 없는 오프라인 규칙 검사 | 2차 | [결정: 계획 v2 L0-b]. Gemini CLI `core/src/policy/*`(Apache-2.0)는 구조만 참고하고 import하지 않는다(`_research/packages.md` §4.2 162행) |
| Windows 네이티브 격리 | 1차 범위 밖. status `none`과 격리 불가 정책만 | [결정: `_research/decisions-log.md` 2026-10-19 "Windows 네이티브는 나중"] |

### 1.1 기존 설계와의 대조

`docs/design/13-tools-and-execution.md` §3.6은 격리 수준 S0·S1·S1b와 bwrap 인자를 직접 다루는 설계다. Xeon은 이를 따르지 않는다(`architecture.overview.spec` 174-175행 "13의 S0~S2는 bubblewrap을 직접 다루는 설계이고, Xeon은 `@anthropic-ai/sandbox-runtime`을 그대로 쓴다").

| 항목 | docs/design 13 §3.6, 18 §3.11 | Xeon `platform-sandbox` | 근거 |
|---|---|---|---|
| 격리 수단 | bwrap 인자 직접 조립(S1), `systemd-run --user` 일회성 단위(S1b) | srt `wrapWithSandboxArgv`. macOS Seatbelt, Linux bubblewrap + seccomp | foundation-plan §2 |
| 수준 | S0, S1b, S1, S2 판별 합집합(`SandboxSpec`) | `level: "srt" \| "none"` 두 값 | [제안] srt가 플랫폼 수단을 고른다 |
| 읽기 범위 | 홈을 빈 tmpfs로 덮는 허용 목록(R-4) | srt 기본(읽기 전체 허용) + `denyRead` 목록 | `_research/notes/L0-1.md` §3.2 "읽기는 전체 허용". [제안] 읽기 허용 목록 방식은 2차 프로필에서 다시 본다 |
| 네트워크 | 네트워크 네임스페이스 + 데몬 CONNECT 프록시(R-6) | 1차 전부 차단, 2차 srt 내장 프록시와 도메인 목록 | 계획 v2 L0-b |
| 프로세스 분리 | PID 네임스페이스 권장(R-5) | srt의 플랫폼 동작을 따른다 [가정: srt Linux 구성의 PID 네임스페이스 여부 미확인] | `_research/notes/L0-1.md` §6 |
| 자원 한도 | `MemoryMax`, `TasksMax`(R-7) | 1차 없음. 시간 제한은 `xeon.exec` timeout | [제안] |
| 격리 불가 시 | `execute` 끔(R-10), 운영자 `off`만 S0 | `l0.sandbox.onUnavailable` 3값, 기본 `disable_execute` | 18 R-10 계승 [제안] |
| 자가 시험 | 시작·1시간마다·doctor, 9항목(§3.11.4) | 시작·주기·doctor, 6항목(4.4절) | 18 §3.11.4 이식 |
| 보호 경로 | Helm 경로(`/srv/volumes`, `~/.config/helm`) 포함 | Xeon 경로로 바꾼 표(3.3절) | 18 §3.11.5 |

## 2. 용어

| 용어 | 뜻 |
|---|---|
| srt | `@anthropic-ai/sandbox-runtime`. 프로세스 전역 `SandboxManager` 싱글턴을 둔다(`_research/notes/L0-1.md` §8) |
| 샌드박스 안 명령 | `wrapShell`이 srt로 감싸 실행한 명령과 그 자식 |
| 쓰기 루트 | 샌드박스 안에서 쓰기를 허용하는 디렉터리. 작업 공간 root, 실행용 임시 디렉터리 |
| 보호 경로 | 쓰기 루트 안에 있어도 거부하는 경로. 설정으로 더할 수만 있다 |
| 탈출 실행 | 샌드박스 밖에서 실행하도록 허락된 호출(`SandboxPolicy.allowEscape: true`). 항상 승인 대상이다 |
| 위반 | srt가 막은 시도의 기록(프록시 거부, Seatbelt 로그, Linux seccomp 모니터) |
| 자가 시험 | 샌드박스 안에서 정해진 시도를 실행해 거부·허용이 기대대로인지 확인하는 절차 |

## 3. 인터페이스

### 3.1 F에 둘 샌드박스 계약 초안

아래 타입은 F `@xeon/contracts/services`의 `services/sandbox.ts`와 `services/sandbox-report.ts`에 둔다. L0·L1 서비스 인터페이스는 이 서브패스에 둔다 [결정: review.decisions-2 D-04]. 이름은 `F.capabilities.spec` §3.12 파일별 이름 표의 두 파일 행에 있다. 아래 블록은 F로 옮기기 전의 초안이고, 필드는 이 블록을 F로 옮겨 확정한다(같은 절 규칙 1, `F.capabilities.plan` P9). 8절 'F에 요청'은 그 작업의 목록이다. 표기는 `F.conversation.spec` §3 머리말을 따른다(`interface X` + `XSchema: Schema<X>`는 TypeBox 명시 타입 상수).

```ts
// @xeon/contracts/services — sandbox-report.ts [결정: review.decisions-2 D-04]. 아무것도 import하지 않는다(exec.ts와 sandbox.ts가 함께 쓴다)
export interface SandboxViolation {
  source: "proxy" | "seatbelt" | "seccomp";
  operation: "file_read" | "file_write" | "network" | "other";
  /** 경로나 호스트. 200자에서 자른다. 파일 내용과 env 값은 넣지 않는다 */
  target?: string;
  count: number;
}
/** ShellExecResult.sandbox(L0.exec.spec §3.1)의 값 */
export interface SandboxRunReport {
  sandboxed: boolean;
  level: "srt" | "none";
  /** sandboxed가 거짓인 이유 */
  unsandboxedBy?: "escape" | "run_unsandboxed" | "disabled";
  violations: SandboxViolation[];
  /** 위반 기록이 상한에서 잘렸는가 */
  violationsTruncated: boolean;
}
export const SandboxRunReportSchema: Schema<SandboxRunReport>;
```

```ts
// @xeon/contracts/services — sandbox.ts
import type { CancelScope, Shell } from "./exec.ts";                       // L0.exec.spec §3.1
import type { SandboxRunReport, SandboxViolation } from "./sandbox-report.ts";

export type SandboxPlatform = "darwin" | "linux" | "wsl2" | "wsl1" | "win32" | "other";
export type SandboxUnavailableReason = "missing_dependency" | "unsupported_os" | "self_test_failed" | "disabled";
export type OnUnavailable = "disable_execute" | "ask" | "run_unsandboxed";

export interface SandboxStatus {
  level: "srt" | "none";
  platform: SandboxPlatform;
  available: boolean;
  /** available이 거짓일 때만 */
  reason?: SandboxUnavailableReason;
  /** reason이 missing_dependency일 때 없는 프로그램 이름(예: "bwrap", "socat", "rg") */
  missing?: string[];
  /** missing에 대응하는 설치 안내(provider의 installHint). describeSandboxStatus가 hints로 옮긴다 */
  installHints?: string[];
  /** 적용 중인 격리 불가 정책(l0.sandbox.onUnavailable) */
  onUnavailable: OnUnavailable;
  /** 마지막 자가 시험. 아직 돌지 않았으면 없음 */
  lastSelfTest?: { at: number; passed: boolean; failed: SelfTestItemId[] };
  /** srt 스키마가 받지 않아 차단 목록에서 빠진 도메인. 빠진 것이 없으면 없음(§3.2) */
  rejectedBlockedDomains?: string[];
}
export const SandboxStatusSchema: Schema<SandboxStatus>;

export interface SandboxNetworkPolicy {
  /** 서비스 기본(차단 목록 방식)에서는 항상 빈 목록. 호출에 비어 있지 않은 목록이 오면 wrapShell이 sandbox_failed로 거부한다 */
  allowedDomains: string[];
  /** 허용보다 먼저 검사한다(거부 우선) */
  deniedDomains: string[];
}

export interface SandboxPolicy {
  /** 절대·정규 경로. 쓰기를 허용하는 디렉터리 */
  writeRoots: string[];
  /** 읽기와 쓰기를 모두 거부하는 경로. 보호 경로(읽기)는 이 목록과 상관없이 항상 더해진다 */
  readDeny: string[];
  /** 쓰기를 거부하는 경로. 보호 경로(쓰기)는 항상 더해진다 */
  writeDeny: string[];
  network: SandboxNetworkPolicy;
  /** 참이면 이 호출을 샌드박스 밖에서 실행한다. L1 tools가 사람 승인을 받은 호출에만 참으로 둔다 */
  allowEscape: boolean;
}
export const SandboxPolicySchema: Schema<SandboxPolicy>;

export type ProtectedAccess = "read_write" | "write";
export type ProtectedMatch = "exact" | "prefix" | "basename";
export interface ProtectedPathEntry {
  /** exact·prefix: 절대 정규 경로. basename: 파일 이름 패턴(끝의 *만 와일드카드) */
  path: string;
  match: ProtectedMatch;
  access: ProtectedAccess;
  /** basename 패턴의 예외 이름(예: ".env.example") */
  except?: string[];
  /** 표시용 이유 코드 */
  reason: "xeon_data" | "xeon_config" | "secret_key" | "credentials" | "agent_credentials" | "shell_startup" | "git_exec" | "persistence" | "user_extra";
}

/** 순수 함수. L2 파일 도구가 realpath 결과로 검사한다(R-12) */
export function matchProtectedPath(
  entries: readonly ProtectedPathEntry[],
  canonicalPath: string,
  access: "read" | "write",
): ProtectedPathEntry | undefined;

export type AutoAllowBlock =
  | "sandbox_unavailable" | "escape_requested"
  | "write_root_outside" | "cwd_outside_write_roots" | "network_outside_default";
export type AutoAllowDecision =
  | { readonly allow: true }
  | { readonly allow: false; readonly blocks: readonly AutoAllowBlock[] };

export type SelfTestItemId =
  | "protected_read_denied" | "xeon_data_write_denied" | "network_denied"
  | "workspace_write_allowed" | "env_allowlist" | "git_hooks_write_denied";
export interface SelfTestItem { id: SelfTestItemId; passed: boolean; detail?: string }
export interface SelfTestReport { at: number; durationMs: number; passed: boolean; items: SelfTestItem[] }
export const SelfTestReportSchema: Schema<SelfTestReport>;

/** 순수 함수. doctor·설정 화면·시작 로그가 쓴다(4.6절). L4가 platform-sandbox를 import하지 않도록 F에 둔다 */
export interface SandboxStatusSummary { severity: "ok" | "warn" | "critical"; summary: string; hints: string[] }
export function describeSandboxStatus(status: SandboxStatus): SandboxStatusSummary;

export interface SandboxService {
  status(): SandboxStatus;
  /** 작업 공간 root와 임시 디렉터리로 기본 정책을 만든다. 보호 경로와 설정 추가분이 들어간다 */
  defaultPolicy(input: { workspaceRoots: readonly string[]; tempDir: string }): SandboxPolicy;
  /** 보호 경로 전체(기본 + 설정 추가분). L2 파일 도구용 */
  protectedPaths(): readonly ProtectedPathEntry[];
  /** F Shell을 받아 F Shell을 돌려준다. exec 패키지를 import하지 않는다 */
  wrapShell(shell: Shell, policy: SandboxPolicy): Shell;
  /** 판정만 한다. 승인 UI와 적용은 L1 tools */
  autoAllow(policy: SandboxPolicy, request: { command: string | readonly string[]; cwd: string; workspaceRoots: readonly string[]; tempDir: string }): AutoAllowDecision;
  /** 주어진 Shell을 감싸 자가 시험을 실행하고 status에 반영한다 */
  selfTest(shell: Shell, context: CancelScope): Promise<SelfTestReport>;
}
export const SandboxServiceName = "xeon.sandbox" as const;
```

- [제안] brief 초안의 `selfTest(): SelfTestReport`를 `selfTest(shell, context): Promise<SelfTestReport>`로 바꿨다. 자가 시험은 실제 명령 실행이 필요하고, `platform-sandbox`는 exec를 import하지 않으므로 조립하는 쪽이 `Shell`을 넘겨야 한다(3.4절). 실행이라 비동기다.
- [제안] `defaultPolicy`, `protectedPaths`, `matchProtectedPath`를 더했다. `L2.workspace.spec` §4.3 6번과 역할 표가 "보호 경로 목록 소유: L0.sandbox, 파일 도구에도 적용"을 요구하기 때문이다. `matchProtectedPath`는 순수 함수라 F에 둘 수 있다(`F.readme` §1 예외 1).
- `SandboxRunReport`는 값 없는 실행 정보다. `L2.workspace.spec` §4.2 5번 `detail.sandboxViolations`와 `sandboxed` 출력이 이 값을 옮긴다.
- import 방향 [제안]: `SandboxRunReport`와 `SandboxViolation`은 `sandbox-report.ts`에 둔다. `exec.ts`는 `sandbox-report.ts`만, `sandbox.ts`는 `exec.ts`와 `sandbox-report.ts`를 import한다. `exec.ts`가 `sandbox.ts`를 import하지 않으므로 `import/no-cycle`(타입 import 포함)에 걸리지 않는다(`L0.exec.spec` §3.1).
- [제안] `describeSandboxStatus`는 F 순수 함수다(`F.readme` §1 예외 1). 소비자 `L4.cli`·`L4.settings-ui`는 구현 패키지를 import할 수 없으므로(DR-14) F에서 가져온다. 설치 안내는 `SandboxStatus.installHints`에 실어 함수가 상태 값만으로 결과를 내게 한다 [제안].

### 3.2 Xeon 정책 → srt 설정 매핑

srt 설정 키는 `_research/notes/L0-1.md` §3(0.0.79 소스 `src/sandbox/sandbox-config.ts:957-1266`, `.d.ts` 대조)으로 확인했다. 실제 격리 효과는 실행으로 확인하지 않았다(같은 문서 §0 1번 [미확인]). 동작 열의 [가정]은 실행 확인 전이다.

| Xeon | srt 설정 | 키 확인 | 동작 |
|---|---|---|---|
| `policy.writeRoots` | `filesystem.allowWrite` | 확인 | 기본은 쓰기 전부 거부, 목록만 허용 [가정] |
| `policy.writeDeny` ∪ 보호 경로(`write`, `read_write`) | `filesystem.denyWrite` | 확인 | `allowWrite` 안에서도 거부(`denyWrite`가 이긴다) [가정] |
| `policy.readDeny` ∪ 보호 경로(`read_write`) | `filesystem.denyRead` | 확인 | 읽기 기본 전체 허용, 목록만 거부 [가정] |
| (1차 미사용) | `filesystem.allowRead` | 확인 | `denyRead` 안에서 다시 허용. basename 예외는 목록 전개로 처리하므로 쓰지 않는다 |
| (고정 거짓) | `filesystem.allowGitConfig` | 확인 | `.git/config` 쓰기 계속 거부 |
| `policy.network.allowedDomains` | `network.allowedDomains` | 확인 | 빈 목록이면 허용 목록은 비어 있다. 목록 밖 호스트는 아래 `strictAllowlist` 행이 정한다 |
| `policy.network.deniedDomains` ← 설정 `l0.sandbox.network.blockedDomains` | `network.deniedDomains` | 확인 | 허용 목록보다 먼저 검사. 서비스가 `initialize`에 한 번 넘긴다. srt 스키마가 받지 않는 항목은 빼고 개수만 로그에 남긴다 [결정: M3-REQ-55] |
| (서비스 고정) | `network.strictAllowlist` = 거짓과 `initialize`의 질의 콜백(항상 허용) | 확인 | 거부 목록은 콜백보다 먼저 검사되므로 목록 밖 호스트는 모두 허용이고 거부 목록만 막는다(차단 목록 방식, 기본 허용). 목록 방식 엄격 모드(콜백 없음, `strictAllowlist` 참)는 `SrtPort.initialize`의 `allowUnlistedHosts` 거짓으로 남아 있다 |
| `policy.allowEscape` | 없음 | — | Xeon만 쓴다. 참이면 srt로 감싸지 않는다(4.2절) |
| `l0.sandbox.enabled = false` | srt `initialize` 안 함 | — | status `none`, reason `disabled` |
| 상태 탐지가 찾은 절대 경로 | `bwrapPath`, `socatPath`, `ripgrep.command`, `seccomp.applyPath` | 확인(`bwrapPath`, `socatPath`는 절대 경로만) | 사이드카에서 헬퍼 위치를 명시(5.3절) |
| 설정 `l0.sandbox.nestedNamespaces`(기본 거짓) | `enableWeakerNestedSandbox` | 확인 | 참이면 `/proc`을 새로 마운트하지 않고 호스트 것을 묶어 중첩 사용자 네임스페이스를 허용한다. 브라우저 provider(Stagehand, Playwright)용이고 격리가 약해진다(§4.8) [결정: 오케스트레이터 기본값, M3-REQ-56] |
| (고정 거짓) | `allowNestedUserNamespaces`(0.0.79 스키마에 없음), `enableWeakerNetworkIsolation`, `allowAppleEvents`, `allowPty`, `network.allowAllUnixSockets`, `network.allowLocalBinding` | 확인 | 나머지 완화 옵션은 노출하지 않는다(`_research/notes/L0-1.md` §3.6) |
| (기본값 유지) | `mandatoryDenySearchDepth` | 확인(1~10, 기본 3) | srt 자동 보호 경로 탐색 깊이 |
| (1차 미사용) | `credentials`, `network.tlsTerminate`, `network.mitmProxy`, `ignoreViolations`, `parentProxy` | 확인 | 2차(`L0.secrets.spec` sentinel, 네트워크 정책)에서 다시 본다 |

변환 규칙(순수 함수 `toSrtConfig`, `src/policy.ts`):

1. 모든 경로를 절대 경로로 만들고, 존재하는 경로는 realpath로 바꾼다. 없는 경로는 가장 가까운 존재하는 상위의 realpath에 나머지를 붙인다. 정렬하고 중복을 지운다.
2. Linux에서 `allowWrite`·`denyWrite`는 리터럴 경로만 받는다. 끝의 `/**`는 srt가 버리고 다른 글로브는 건너뛴다("A skipped pattern hides nothing", `_research/notes/L0-1.md` §3.2). 그래서 Xeon은 모든 OS에 리터럴 경로만 넘긴다 [제안].
3. `basename` 보호 항목(`.env`, `.env.*`)은 명령마다 쓰기 루트 아래를 깊이 `mandatoryDenySearchDepth`까지 훑어 찾은 파일의 리터럴 경로로 바꾼다. 실행 중에 새로 생긴 파일은 덮지 못한다(5.1절).
4. 변환 결과를 srt `SandboxRuntimeConfigSchema`로 검증한다. 실패는 버그(`Bug`)다. Linux에서 `getLinuxGlobPatternWarnings()`가 비어 있지 않으면 버그다.
5. 프로세스 전역 설정(`initialize`)에는 네트워크와 고정 값만 넣고, 파일 정책은 명령마다 `customConfig`로 넘긴다. srt의 네트워크 설정은 명령마다 바뀌지 않는다(`_research/notes/L0-1.md` §8).

### 3.3 보호 경로 (1차)

[제안] `docs/design/18-security.md` §3.11.5 표에서 Helm 전용 경로를 지우고 Xeon 경로로 바꿨다. 줄일 수 없고 `l0.sandbox.protectedPaths.extra`로 더할 수만 있다. `<home>`, `<xeonData>`, `<xeonConfig>`는 `xeon.os`의 `OsDirs.home`, `OsDirs.data`, `OsDirs.config`다(`L0.os.spec` §3.2, 8.3절). `<root>`는 정책의 각 쓰기 루트다.

| 경로 | 일치 | 접근 거부 | 이유 코드 | 18 §3.11.5 대응 |
|---|---|---|---|---|
| `<xeonData>/` 전체(단일 DB, WAL, blob) | prefix | 읽기·쓰기 | `xeon_data` | `/srv/volumes/**` 대체. bash로 DB·blob을 직접 고치는 우회 쓰기(13 §3.5.1 W-3)와 다른 세션 내용 읽기를 막는다 |
| `<xeonConfig>/` 전체 | prefix | 쓰기 | `xeon_config` | `~/.config/helm/**` 대체. 다음 시작 때 설정·플러그인으로 코드가 실행된다 |
| `<xeonConfig>/secrets/` 전체(메타 파일, 감사 파일, 파일 폴백 age 키 기본 위치 `<xeonConfig>/secrets/age/keys.txt`) | prefix | 읽기·쓰기 | `secret_key` | 새 행. `<xeonConfig>/` 행은 쓰기만 막으므로 비밀 파일의 읽기를 따로 막는다(`L0.secrets.spec` §3.2·§4.7) |
| `SecretService.protectedPaths()`가 돌려주는 절대 경로(설정한 SOPS 파일, `l0.secrets.ageKey.filePath`로 바꾼 파일 폴백 age 키) | exact | 읽기·쓰기 | `secret_key` | SOPS 원본 행 대체. 등록 API를 두지 않고 sandbox가 상태 탐지 때와 `l0.secrets.*` 변경 뒤에 이 목록을 다시 읽는다 [제안] |
| `<home>/.config/sops/` | prefix | 읽기·쓰기 | `secret_key` | 같음 |
| age 키 파일: `<home>/.config/sops/age/keys.txt`, macOS `<home>/Library/Application Support/sops/age/keys.txt`, 부모 env `SOPS_AGE_KEY_FILE` 값 | exact | 읽기·쓰기 | `secret_key` | `**/keys.txt` 대체. macOS 기본 위치는 [가정: sops 문서 확인 필요] |
| `<home>/.ssh/` | prefix | 읽기·쓰기 | `credentials` | 같음 |
| `.env`, `.env.*`(예외 `.env.example`) | basename | 읽기·쓰기 | `credentials` | 같음 |
| `<home>/.claude/`, `<home>/.codex/`, `<home>/.pi/` | prefix | 읽기·쓰기 | `agent_credentials` | 같음 |
| `<home>/.git-credentials`, `<home>/.aws/`, `<home>/.kube/`, `<home>/.config/gcloud/` | prefix·exact | 읽기·쓰기 | `credentials` | 클라우드·저장소 자격 행. 18은 데몬 파일 도구용이었고 Xeon은 샌드박스에도 쓴다 [제안] |
| `<home>/.config/gh/`, `<home>/.netrc`, `<home>/.docker/config.json`, `<home>/.npmrc`, `<home>/.pypirc` | prefix·exact | 설정 `l0.sandbox.credentialFiles`가 `allow`(기본)이면 쓰기, `deny`이면 읽기·쓰기 | `credentials` | CLI 인증 파일. 기본은 읽기를 허용해 `gh`와 사설 레지스트리 `npm`이 샌드박스 안에서 인증된다 [결정: review.m3-design-inputs D-M3-18 행 2]. 개인 키(`.ssh`)와 클라우드 자격은 항상 읽기도 거부한다 [결정: 오케스트레이터 기본값, D-M3-18은 `~/.npmrc`, `~/.config/gh` 등을 예로만 들었다] |
| `<home>/.bashrc`, `.bash_profile`, `.zshrc`, `.zprofile`, `.zshenv`, `.profile`, `<home>/.gitconfig` | exact | 쓰기 | `shell_startup` | 같음. srt 자동 보호와 겹친다(README:1142-1190) |
| `<root>/.git/config`, `<root>/.git/config.worktree`, `<root>/.git/info/attributes`, `<root>/.git/hooks/`, `<root>/.gitmodules` | exact·prefix | 쓰기 | `git_exec` | 같음. 다음 git 호출에서 명령이 실행된다. srt 자동 보호와 겹친다 |
| `<home>/.local/bin/`, `<home>/.config/systemd/user/`, macOS `<home>/Library/LaunchAgents/` | prefix | 쓰기 | `persistence` | PATH 변조와 지속 실행 등록. `~/.local/share/mise/**`는 사용자 도구 체인이라 [제안] 1차에서 뺀다 |

지운 행: `/srv/volumes/**`(Helm 홈서버), `~/.config/helm/**`, `~/.dotfiles/secrets/**`·`~/projects/*/secrets/**`(사용자별 경로, `protectedPaths.extra`로 더한다), `~/data/**`·`~/vault/**`(사용자 개인 자료), `/mnt/**`(WSL Windows 드라이브. 작업 공간이 `/mnt/c` 아래일 수 있어 기본에서 뺀다 [제안]).

- 보호 경로의 기본 집합은 `SandboxProvider.defaultProtectedPaths(dirs)`(OS별)와 공통 표를 합친 것이다. macOS 전용 행은 darwin provider만 낸다.
- `wrapShell`은 호출자가 넘긴 정책에 보호 경로를 항상 합친다. 호출자가 `readDeny`·`writeDeny`를 비워도 보호 경로는 빠지지 않는다.
- 쓰기 루트가 보호 경로 안에 있으면(예: `writeRoots`에 `<xeonData>`) `defaultPolicy`와 `wrapShell` 모두 그 쓰기 루트를 지우고 위반 사유를 시작 로그에 남긴다 [제안]. `denyWrite`가 이기므로 결과는 같지만 자동 허용 판정을 흐리지 않기 위해서다.

### 3.4 exec와의 접점

exec와 sandbox는 서로 import하지 않고 F의 `Shell` 인터페이스로만 만난다. `xeon.sandbox`의 `wrapShell`은 F `Shell`을 받아 F `Shell`을 돌려주고, 두 서비스의 조립은 L1 tools 또는 apps/host가 한다.

- `wrapShell`이 기대하는 `Shell`의 성질은 `L0.exec.spec` §3.7(옵션 전달, argv 실행, 결과 필드 보존)이다.
- 비밀 값(`secretEnv`)은 `wrapShell`이 해석하지 않는다. 래핑 뒤 아래 `Shell`이 spawn 직전에 넣는다(`L0.exec.spec` §3.6).

### 3.5 OS 분기: `SandboxProvider`

[결정: DR-13] OS 분기는 `src/select.ts`에서만 고르고, 구현은 `src/providers/{darwin,linux,win32}.ts`다.

```ts
// platform-sandbox/src/provider.ts [제안]
export interface RequiredBinary {
  readonly name: "rg" | "bwrap" | "socat";
  readonly srtKey: "ripgrep.command" | "bwrapPath" | "socatPath";
  readonly installHint: string;            // 예: "brew install ripgrep", "sudo apt install bubblewrap socat ripgrep"
}
export interface SandboxProvider {
  readonly kind: "seatbelt" | "bwrap" | "none";
  readonly platform: SandboxPlatform;
  /** none이면 이유 */
  readonly unsupported: "unsupported_os" | undefined;
  requiredBinaries(): readonly RequiredBinary[];
  defaultProtectedPaths(dirs: OsDirs): readonly ProtectedPathEntry[];   // OsDirs.home·data·config를 쓴다(L0.os.spec §3.2)
}

// platform-sandbox/src/select.ts [제안]
export function selectSandboxProvider(input: {
  readonly platform: string;                                    // process.platform
  readonly arch: string;                                        // process.arch
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly procVersion: string | undefined;                     // linux만 /proc/version 내용
}): SandboxProvider;
```

- darwin → `seatbelt`, 필요 프로그램 `rg`.
- linux → `bwrap`, 필요 프로그램 `bwrap`(0.4.0 이상, 0.5.0 이상 권장), `socat`, `rg`. WSL2는 `platform: "wsl2"`로 같은 provider다. WSL1(`procVersion`에 `Microsoft`가 있고 `WSL2`가 없음)은 `none`, `unsupported_os`다 [제안].
- linux에서 `arch`가 `x64`·`arm64` 밖이면 seccomp 필터가 번들되지 않는다. `select.ts`는 이 경우 `none`, `unsupported_os`를 돌려준다. 다만 `xeon.os`가 `x64`·`arm64` 밖 arch를 `unsupported_arch`로 등록 실패시키므로(`L0.os.spec` §3.1, §3.10) 운영에서는 이 분기에 오지 않는다. 분기는 `xeon.os` 규칙이 넓어질 때를 위한 방어이고 단위 시험으로만 확인한다(10절 [미결] 5).
- WSL 판정은 `L0.os.spec` §3.1 기준(`WSL_DISTRO_NAME` 또는 `/proc/version`의 `microsoft`·`WSL`)을 따르고, 그 위에 WSL1과 WSL2를 나누는 것만 이 패키지의 예외다(`L0.readme` §3.1 WSL 판정 행).
- win32 → `none`, `unsupported_os`. srt Windows 지원은 alpha이고 Claude Code도 네이티브 Windows를 샌드박스 대상에서 뺐다(`_research/notes/L0-1.md` §6).
- 그 밖의 OS → `none`, `unsupported_os`. `select.ts`는 throw하지 않는다.

## 4. 동작 규칙

### 4.1 상태 탐지

시작 때 한 번 하고, 설정 변경(`l0.sandbox.enabled`)과 자가 시험 뒤에 다시 한다.

1. `l0.sandbox.enabled`가 거짓이면 `{ level: "none", available: false, reason: "disabled" }`.
2. provider가 `none`이면 `reason: provider.unsupported`.
3. `requiredBinaries()`의 각 프로그램을 PATH에서 절대 경로로 찾는다. 없는 것은 `missing`에 넣고 `reason: "missing_dependency"`. 찾은 경로는 srt 설정(`bwrapPath` 등)에 넣는다.
4. srt `isSupportedPlatform()`과 `checkDependencies()`를 부른다. 거짓이거나 오류가 있으면 `missing_dependency` 또는 `unsupported_os`로 옮긴다(오류 이름 대응은 구현에서 정한다 [가정]).
5. srt `initialize(config, undefined, enableLogMonitor)`를 한 번 부른다. `enableLogMonitor`는 macOS 참, Linux 거짓이 기본이다 [제안]. Linux 모니터 값은 샌드박스 프로세스가 조작할 수 있어 진단용으로만 쓸 수 있기 때문이다(`_research/notes/L0-1.md` §5).
6. 마지막 자가 시험이 실패했으면 `reason: "self_test_failed"`.
7. 상태는 시작 로그 한 줄과 doctor 출력에 남긴다(4.6절).

### 4.2 `wrapShell`

`wrapShell(shell, policy)`가 돌려준 `Shell`의 `exec(command, options, context)`:

1. 유효 정책 = `policy` ∪ 보호 경로 ∪ 설정 추가분(`protectedPaths.extra`, `writeRoots.extra`). 보호 경로 안의 쓰기 루트를 지운다.
2. `policy.allowEscape`가 참이면:
   - `l0.sandbox.escapeRetry`가 참이거나 status가 불가이고 `onUnavailable = "ask"`일 때만 허용한다. 아니면 `err(ExecutionError("sandbox_unavailable"))`.
   - 허용이면 감싸지 않고 `shell.exec`를 부른 뒤 결과에 `sandbox: { sandboxed: false, level: "none", unsandboxedBy: "escape", violations: [], violationsTruncated: false }`를 붙인다.
3. status가 불가이면 4.5절 표를 따른다.
4. 명령이 argv 배열이면 POSIX 작은따옴표 규칙으로 이어 셸 문자열 하나로 만든다(srt 입력이 문자열이다).
5. 호출마다 128비트 무작위 `commandId`를 만든다(`crypto.getRandomValues`). 위반 귀속 키이고 명령 문자열 앞 100자 비교의 교차 귀속을 피한다(`_research/notes/L0-1.md` §5, srt `WrapWithSandboxOptions.commandId` 주석).
6. `wrapWithSandboxArgv(command, "bash", customConfig, context.abortSignal, options.cwd, { commandId })`로 `{ argv, env }`를 얻는다. `customConfig`는 3.2절 변환 결과의 파일 정책이다. `binShell`에 `"bash"`를 넘기는 것은 [가정]이다(셸 경로 해석 방식 미확인).
7. 래핑이 throw하면 `err(ExecutionError("sandbox_failed", <오류 이름과 code만>))`. 이때 `cleanupAfterCommand()`를 부르지 않는다. 실행 중인 다른 샌드박스의 마운트 지점을 지우기 때문이다(`_research/notes/L0-1.md` §8 생명주기).
8. `shell.exec(argv, { ...options, env: { ...options.env, ...srtEnv } }, context)`. `srtEnv`는 srt가 돌려준 `env`에서 부모 `process.env`와 값이 같은 항목을 뺀 차이다 [가정: 반환 `env`가 전체 env인지 추가분인지 미확인. 전체라면 차이 계산이 필요하고, 차이로 하면 exec의 허용 목록 규칙을 지킨다].
9. 결과가 나오면(성공, 실패 모두) `getViolationsForCommand(commandId)`로 위반을 모아 `SandboxViolation[]`로 바꾸고(같은 `operation`·`target`은 합쳐 `count`), 최대 50개만 싣는다. 그 뒤 `cleanupAfterCommand()`를 부른다.
10. 성공 결과에 `sandbox: { sandboxed: true, level: "srt", violations, violationsTruncated }`를 붙인다. 실패(`ExecutionError`)에는 붙이지 않는다.

`cleanup(context)`는 아래 `shell.cleanup`을 부른다. srt `reset()`은 서비스 dispose 때 한 번 부른다.

### 4.3 자동 허용 판정 [제안]

`autoAllow(policy, request)`는 아래를 모두 만족하면 `{ allow: true }`다. 하나라도 어기면 어긴 항목을 모두 `blocks`에 담아 `{ allow: false }`다.

| 조건 | 어기면 |
|---|---|
| `status().available`이 참 | `sandbox_unavailable` |
| `policy.allowEscape`가 거짓 | `escape_requested` |
| 모든 `writeRoots`가 `request.workspaceRoots` 또는 `request.tempDir` 안(경로 마디 비교) | `write_root_outside` |
| `request.cwd`가 쓰기 루트 또는 작업 공간 root 안 | `cwd_outside_write_roots` |
| 네트워크가 기본 정책 이내: `allowedDomains`가 빈 목록(차단 목록 방식, §3.2). 허용 목록 방식을 더하면 설정 `l0.sandbox.network.allowedDomains`의 부분집합 | `network_outside_default` |

- 판정만 한다. 승인 UI, 권한 모드와의 결합, 판정 적용은 `L1.tools.spec`이 한다(`_research/refs/claude-code.md` §3.2 "자동 허용 모드에서는 샌드박스 안 명령은 묻지 않고 실행").
- 샌드박스 밖 재시도(Claude Code `allowUnsandboxedCommands` 대응. srt 라이브러리 기능이 아님, `_research/notes/L0-1.md` §9)는 `l0.sandbox.escapeRetry` 기본 거짓이고, 켜도 `allowEscape: true` 호출은 항상 `escape_requested`라 승인 대상이다.
- `command`는 1차 판정에 쓰지 않는다. 명령 문자열 분석은 우회가 쉬워 보조 신호로도 쓰지 않는다(`docs/design/13-tools-and-execution.md` §3.5.2 (b) 기각).

### 4.4 자가 시험

`docs/design/18-security.md` §3.11.4를 옮긴다. 시작 때, `l0.sandbox.selfTestIntervalMin`마다, doctor 실행 때 돈다. 호출자는 조립 지점(apps/host)이고 `Shell`은 `xeon.exec`의 것이다(8.3절). 시험용 쓰기 루트는 새 임시 디렉터리 하나다.

호출 경로 [결정: m2 마감 G1-12]: 조립 루트가 `SandboxServiceHandle.startSelfTests(shell)`을 한 번 부른다. 이 메서드가 시작 직후 `selfTest`를 한 번 돌리고, 끝날 때마다 `l0.sandbox.selfTestIntervalMin`분 뒤로 다음 실행을 `xeon.os`의 `Scheduler`에 건다(0이면 시작 때 한 번뿐이다). 실행은 겹치지 않고, 간격은 한 실행이 끝날 때마다 설정 함수에서 다시 읽는다. 돌려주는 `SelfTestSchedule`은 `first`(첫 실행의 `Result<SelfTestReport, SelfTestRunError>`)와 `stop()`을 가진다. 항목 실패는 보고서 값(`passed: false`)이고 `status()`의 `lastSelfTest`와 `available`에 반영된다. 시험 자체가 던지면(`crashed`) 로그 `sandbox.self_test_crashed`만 남기고 반복은 계속한다. 서비스 `dispose()`가 모든 반복을 멈춘다. doctor는 `selfTest`를 직접 부른다.

| id | 시도(샌드박스 안) | 기대 |
|---|---|---|
| `protected_read_denied` | 샌드박스 밖에서 `<xeonData>/selftest/canary`에 무작위 문자열을 쓴 뒤 안에서 `cat` | 종료 코드 0 아님, 출력에 무작위 문자열 없음 |
| `xeon_data_write_denied` | `touch <xeonData>/selftest/write-probe` | 실패하고 파일이 생기지 않음 |
| `network_denied` | `bash -c 'exec 3<>/dev/tcp/example.com/80'` | 실패 [가정: bash `/dev/tcp`가 두 OS에서 동작] |
| `workspace_write_allowed` | `touch <tmp>/ok` | 성공하고 파일이 생김 |
| `env_allowlist` | `env` | 출력의 이름 중 `SENSITIVE_ENV_PATTERNS`(`L0.exec.spec` §3.5)에 맞는 것이 0개. 단 srt가 자체 프록시 클라이언트용으로 내보내는 `CLOUDSDK_PROXY_PASSWORD`(프로세스마다 새로 만든 프록시 인증 토큰, srt 0.0.79)는 세지 않는다 [결정: m2 마감 G4-01, 실제 srt로 시험하면 이 이름 때문에 항상 실패했다] |
| `git_hooks_write_denied` | 밖에서 `<tmp>/.git/hooks/`를 만든 뒤 안에서 `touch <tmp>/.git/hooks/pre-commit` | 실패 |

- 하나라도 기대와 다르면 status를 `available: false`, `reason: "self_test_failed"`로 바꾸고 4.5절 정책을 적용한다.
- 자가 시험 명령은 `allowEscape: false` 정책으로 감싼다. 결과 보고에는 항목 id와 통과 여부, 실패 시 종료 코드만 싣는다. 출력 원문은 싣지 않는다.
- 시험 뒤 `<xeonData>/selftest/`와 임시 디렉터리를 지운다.

### 4.5 격리 불가 시 동작

`l0.sandbox.onUnavailable`(기본 `disable_execute` [제안, 18 R-10 계승]):

| 값 | `wrapShell`의 `exec` | L1 tools가 할 일(요구) |
|---|---|---|
| `disable_execute` | `err(ExecutionError("sandbox_unavailable"))` | 셸 실행 도구(`bash`)를 모델에 광고하지 않는다 |
| `ask` | `allowEscape: false`이면 `sandbox_unavailable`. 승인 뒤 `allowEscape: true`로 다시 부르면 실행 | 호출마다 "격리 없이 실행" 승인을 받는다 |
| `run_unsandboxed` | 감싸지 않고 실행, `sandbox.unsandboxedBy: "run_unsandboxed"` | 실행은 허용. 도구 결과와 화면에 격리 없음 표시 |

- `l0.sandbox.enabled = false`(reason `disabled`)는 사용자가 명시적으로 끈 상태다. `run_unsandboxed`와 같이 실행하고 `unsandboxedBy: "disabled"`를 붙인다 [제안]. 시작 로그와 doctor에 경고를 남긴다.
- Windows 네이티브, WSL1, 지원 밖 아키텍처는 `unsupported_os`로 이 표를 따른다. 기본값에서는 셸 실행 도구가 꺼지므로 격리 없이 조용히 실행되는 경로가 없다.
- 격리 없이 실행한 호출의 감사 기록(18의 `tools.sandbox_disabled`에 해당)은 이벤트가 필요하다. `platform-sandbox`는 이벤트 type을 소유하지 않으므로(`eng.context-map.design` §4.1) 소유자는 [미결]이다(10절 2번). 1차는 `ShellExecResult.sandbox.unsandboxedBy`를 L1 tools가 도구 결과 details에 남기는 것으로 대신한다.

### 4.6 doctor와 시작 로그

- F 순수 함수 `describeSandboxStatus(status): SandboxStatusSummary`(3.1절)를 쓴다. `ok`: available. `warn`: `disabled` 또는 `run_unsandboxed`로 실행 중. `critical`: 그 밖의 불가 상태.
- `missing_dependency`의 `hints`는 `status.installHints`(provider의 `installHint`)다. 이 상태는 환경 문제이므로 `xeon doctor`가 종료 코드 2 계열로 보고하는 것을 `L4.cli.spec`에 요구한다 [제안].
- 시작 로그: `sandbox level=<level> platform=<platform> available=<bool> reason=<reason> onUnavailable=<value>` 한 줄.

### 4.7 감싸는 범위

- 감싸는 것: bash 계열 셸 명령과 그 자식 프로세스(`wrapShell`을 거친 `Shell.exec`).
- 감싸지 않는 것: 파일 도구(read, write, edit, ls, grep·find 중 in-process 구현), 웹 도구, 로컬 MCP 서버, 확장 코드 자체(`_research/refs/claude-code.md` §3.2, `_research/notes/L0-1.md` §0 8번). 그래서 파일 도구는 realpath 기준 보호 경로 검사를 L1·L2에서 해야 한다(18 R-12, 8.3절 요구).
- MCP stdio 서버 프로세스는 §4.8의 출처별 판정으로 정한다. 켬이면 서버 프로세스 실행이 `wrapShell`을 거친 `Shell`을 쓴다.

### 4.8 MCP stdio 서버와 중첩 네임스페이스

[결정: review.m3-design-inputs D-M3-19 행 1, M3-REQ-57·56]

- `decideMcpStdioSandbox(source, serverSetting)`(`src/mcp-stdio.ts`)가 서버 정의 출처(`L2.mcp.spec` §3.1 `source`)로 격리 여부를 정한다. `settings:user`는 끔이고 `settings:project`, `mcpjson:project`, `mcpjson:xeon`, `ext:<이름>`, 알 수 없는 출처는 켬이다. 서버별 설정 값(참·거짓)이 있으면 출처 기본값보다 우선한다. 알 수 없는 출처를 켬으로 두는 것은 [결정: 오케스트레이터 기본값]이다.
- `shellForMcpStdio(service, shell, policy, decision)`은 켬이면 `service.wrapShell(shell, policy)`, 끔이면 받은 `shell`을 돌려준다. 격리를 쓸 수 없는 상태의 처리는 §4.5가 그대로 정한다. 서버별 설정 키와 호출은 `L2.mcp.spec`이 가진다(B3-SEC).
- 브라우저 provider는 샌드박스 셸 안에서 자체 샌드박스를 띄우려고 중첩 사용자 네임스페이스가 필요하다. 설정 `l0.sandbox.nestedNamespaces`를 켜면 srt `enableWeakerNestedSandbox`가 참이 된다. 기본은 거짓이고 `restart` 반영이다. 켠 상태는 시작 로그에 경고로 남긴다 [제안]. 중첩 허용 때문에 쓰기 거부가 약해질 수 있어(`_research/notes/L0-1.md` §3.6) 브라우저를 쓰지 않는 사용자는 켜지 않는다.
- `tool.sandbox_bypassed`(샌드박스 밖 실행 감사 이벤트)의 소유자는 L1 tools(`tool.` 접두)이다 [결정: 오케스트레이터 기본값, 10절 2번의 후보 채택]. `platform-sandbox`는 `ShellExecResult.sandbox.unsandboxedBy`만 돌려주고 이벤트를 내지 않는다.

## 5. 실패와 경계 사례

### 5.1 경계 사례

| 사례 | 동작 |
|---|---|
| 래핑 중 srt 오류(`LinuxSandboxProfileError` 등) | `sandbox_failed`. 메시지에는 오류 이름과 `.code`만. `cleanupAfterCommand` 부르지 않음 |
| 실행 중 새로 생긴 `.env` 파일 | 덮지 못한다(basename 전개는 실행 전에만). L2 파일 도구 검사는 실행 뒤에도 적용된다. 위험으로 남긴다 |
| Linux에서 존재하지 않는 거부 경로 | srt가 마운트 지점을 만들고 `cleanupAfterCommand`가 지운다(`_research/notes/L0-1.md` §8) |
| 병렬 명령 | 같은 프로세스의 srt 싱글턴을 공유한다. 파일 정책은 명령마다 다르다. 네트워크 정책은 프로세스에 하나다 |
| 취소 | `context.abortSignal`을 srt 래핑과 아래 `exec` 모두에 넘긴다. 프로세스 정리는 exec(`L0.exec.spec` B-17) |
| 쓰기 루트가 없음(빈 목록) | 샌드박스 안 쓰기 전부 거부. `autoAllow`는 조건을 만족할 수 있다 |
| 위반 기록이 상한(50) 초과 | 앞 50개만, `violationsTruncated: true` |
| srt 버전과 설정 스키마 불일치 | `toSrtConfig` 결과 검증 실패는 버그. 시작 시 1회 검증으로 드러난다 |

### 5.2 플랫폼별 제약

| 항목 | macOS | Linux(WSL2 포함) | Windows 네이티브 |
|---|---|---|---|
| 격리 수단 | Seatbelt(`sandbox-exec`, 동적 프로필). 시스템 기능이라 추가 설치 없음 | bubblewrap + seccomp(apply-seccomp 정적 바이너리 x64·arm64 번들) | srt `srt-win.exe`는 alpha. Xeon 1차는 쓰지 않는다 |
| 필요 프로그램 | `rg`(ripgrep) | `bwrap`(0.4.0 이상, 0.5.0 이상 권장), `socat`, `rg`. 없으면 `missing` 목록과 설치 안내, 환경 문제(종료 코드 2 계열) | 해당 없음 |
| status | `srt` | `srt`. WSL2는 Linux로 다룬다. WSL1은 `none`(`unsupported_os`) | `none`(`unsupported_os`) → `onUnavailable` 적용 |
| 알려진 제약 | Apple Events·pty 기본 거부. macOS `sandbox-exec`의 Apple 측 지원 상태 [미확인] | Ubuntu 24.04 이후 `kernel.apparmor_restrict_unprivileged_userns`가 bwrap 사용자 네임스페이스를 막는다(sysctl 또는 AppArmor 프로필 필요). 루트 실행은 `CAP_SETFCAP` 필요. 중첩 사용자 네임스페이스 거부로 Chromium·rootless podman이 샌드박스 안에서 실패. x64·arm64 밖은 seccomp 미번들 | srt-win 설치는 관리자 승인 1회. SMB·WSL 기동·시스템 리졸버 DNS는 차단 밖(srt README:1000-1011) |
| 경로 문법 | gitignore식 글로브 가능. Xeon은 리터럴만 넘긴다 | `allowWrite`·`denyWrite`는 리터럴만 | 해당 없음 |
| 위반 기록 | 로그 스트림(`enableLogMonitor` 참) | 프록시 거부만 기본. seccomp 모니터는 진단용이라 기본 끔 | 해당 없음 |
| 근거 | `_research/notes/L0-1.md` §6 | 같음, `_research/packages.md` §4.2 159행·§6 338행 | 같음, `_research/refs/claude-code.md` §3.2 "네이티브 Windows는 미지원, WSL2 사용"(원문 확인 필요 [가정]) |

### 5.3 Bun과 사이드카

- srt는 Node 기준 패키지이고 Bun 분기가 있다. 라이브러리를 Bun 1.4 호스트에서 직접 호출할 수 있다 [가정: `_research/notes/L0-1.md`는 Bun 분기 코드를 확인했을 뿐 실행하지 않았다. `L0.sandbox.plan` SB-01 스파이크 결과로 확정한다]. `_research/refs/claude-code.md` 326행의 "호스트 언어가 Node가 아니면 CLI 래핑 필요"는 근거가 없다(`_research/notes/L0-1.md` §9 정정).
- `bun build --compile` 사이드카에서 srt는 헬퍼(apply-seccomp 등)를 `import.meta.url` 기준 상대 경로로 찾는다. 컴파일 산출물에서 이 경로가 맞는지는 확인하지 않았다 [가정: 맞지 않을 가능성이 높음]. 1차 대응은 상태 탐지가 찾은 절대 경로를 `seccomp.applyPath`, `bwrapPath`, `socatPath`, `ripgrep.command`로 넘기는 것이다(`L0.sandbox.plan` SB-01 스파이크).

## 6. 설정 노출

| 키 | 타입 | 기본값 | 범위(`allowedScopes`) | 변경 반영 | 단계 | L4 노출 |
|---|---|---|---|---|---|---|
| `l0.sandbox.enabled` | `boolean` | `true` | `managed`, `user` | `nextTurn` | M1 | 탭 `permissions`(임시. `"sandbox"` 추가 요청, 목표는 '샌드박스와 네트워크' 탭), `toggle`. 끌 때 위험 고지 필요 |
| `l0.sandbox.onUnavailable` | `string`(`range.enum`: `disable_execute`, `ask`, `run_unsandboxed`) | `disable_execute` | `managed`, `user` | `nextTurn` | M1 | `permissions`(임시), `select`. `run_unsandboxed` 선택 시 위험 고지 |
| `l0.sandbox.protectedPaths.extra` | `string[]`(절대 경로 또는 `~/`로 시작) | `[]` | `managed`, `user`, `project` | `nextTurn` | M1 | `permissions`(임시), `list`. 기본 보호 경로는 읽기 전용으로 함께 표시 |
| `l0.sandbox.writeRoots.extra` | `string[]` | `[]` | `managed`, `user` | `nextTurn` | M1 | `permissions`(임시), `list` |
| `l0.sandbox.escapeRetry` | `boolean` | `false` | `managed`, `user` | `nextTurn` | M1 | `permissions`(임시), `toggle`. 켜도 매 호출 승인 |
| `l0.sandbox.network.blockedDomains` | `string[]`(`host`, `*.host`, `host:port`) | `[]` | `managed`, `user`, `project` | `restart` | M3 | `permissions`(임시), `list`. 목록 밖은 모두 허용 |
| `l0.sandbox.credentialFiles` | `string`(`range.enum`: `allow`, `deny`) | `allow` | `managed`, `user` | `nextTurn` | M3 | `permissions`(임시), `select` |
| `l0.sandbox.nestedNamespaces` | `boolean` | `false` | `managed`, `user` | `restart` | M3 | `permissions`(임시), `toggle`. 켤 때 위험 고지 필요 |
| `l0.sandbox.selfTestIntervalMin` | `integer`(`range` 0~1440, 0은 시작 때만) | `60` | `managed`, `user` | `restart` | M1 | 탭 `advanced`(파일만) |
| `l0.sandbox.network.allowedDomains` | `string[]`(`host` 또는 `host:port`) | 정의하지 않음 | | | 후속 | 기본 허용 방식이라 허용 목록 키는 두지 않는다(§10 1번) |

- 키 문법은 `F.wire-settings.spec` §3.8.1을 따른다. 정의는 `src/settings.ts`의 `defineSettings("l0.sandbox", …)`다.
- 넓히는 키(`enabled` 끄기, `onUnavailable`, `writeRoots.extra`, `escapeRetry`, `credentialFiles`, `nestedNamespaces`)는 `project` 범위를 받지 않는다. 좁히는 키(`protectedPaths.extra`, `network.blockedDomains`)만 프로젝트 파일에서 받는다 [제안: 저장소를 여는 것만으로 격리가 풀리지 않게 한다, `_research/notes/L0-1.md` §3.6].
- 네트워크 키는 srt가 프로세스당 정책 하나라 `restart`다(`_research/notes/L0-1.md` §8). 실행 중 변경(`updateConfig`)은 2차에서 다시 본다.
- 탭: `_research/settings.md` §4의 5번 탭 '샌드박스와 네트워크'에 둔다. F `SettingsTab`(`F.wire-settings.spec` §3.8.2)에 해당 값이 없어 `"sandbox"` 추가를 F에 요청한다(8.2절). 추가 전까지는 `"permissions"`에 둔다 [제안].
- 비밀 값 키는 없다.

## 7. 확장 지점

- `xeon.sandbox`는 `on` 지점을 선언하지 않는다. 도구 실행 지점(`tool.call.before` first, `tool.result` chain)은 L1이 선언하고(`F.extensions.spec`), 자동 허용 판정 결과를 쓰는 곳도 L1이다.
- `post`, `drive`와 관계없다.
- 확장(플러그인)이 정책을 완화하는 경로는 없다. 확장은 `scope`로 `SandboxServiceName`을 주입받아 `status()`, `protectedPaths()`, `autoAllow()`를 읽을 수 있다. `wrapShell`을 직접 써서 자기 프로세스를 감쌀 수 있다 [제안].

## 8. 다른 문서와의 인터페이스

### 8.1 제공

| 이름 | 소비 문서 |
|---|---|
| `xeon.sandbox`(`SandboxService`): `status`, `defaultPolicy`, `protectedPaths`, `wrapShell`, `autoAllow`, `selfTest` | `L1.tools.spec`, `L2.workspace.spec`, `L4.host-service.spec`(자가 시험 주기 호출), `L4.cli.spec`(doctor) |
| `describeSandboxStatus`(F `services/sandbox.ts`의 순수 함수, review.decisions-2 D-04) | `L4.cli.spec`, `L4.settings-ui.spec`. 구현 패키지를 import하지 않고 F에서 가져온다(DR-14) |
| `@xeon/platform-sandbox/testing`: `fakeSandbox`(상태와 판정을 표로 고정, `wrapShell`은 기록만 하는 통과 데코레이터) | `L1.tools.plan`, `L2.workspace.plan` |

### 8.2 F에 요청

| 요청 | 대상 | 이유 |
|---|---|---|
| `SandboxPlatform`, `SandboxUnavailableReason`, `OnUnavailable`, `SandboxStatus`(+Schema), `SandboxNetworkPolicy`, `SandboxPolicy`(+Schema), `ProtectedAccess`, `ProtectedMatch`, `ProtectedPathEntry`, `matchProtectedPath`, `AutoAllowBlock`, `AutoAllowDecision`, `SelfTestItemId`, `SelfTestItem`, `SelfTestReport`(+Schema), `SandboxViolation`, `SandboxRunReport`(+Schema), `SandboxService`, `SandboxServiceName`을 `@xeon/contracts/services`(`services/sandbox.ts`)에 둔다 [결정: review.decisions-2 D-04] | `F.capabilities.spec` §3.12(services) | 3.1절. L1 tools, L2 workspace가 같은 타입을 쓴다 |
| `ShellExecResult.sandbox?: SandboxRunReport`. `SandboxRunReport`·`SandboxViolation`은 `services/sandbox-report.ts`에 두고 `exec.ts`·`sandbox.ts`가 그 파일만 import한다 | `F.capabilities.spec` §3.12(services) | `L0.exec.spec` §3.1과 같은 요청. 순환 import 방지 |
| `describeSandboxStatus`, `SandboxStatusSummary`, `SandboxStatus.installHints`를 `services/sandbox.ts`에 둔다 | `F.capabilities.spec` §3.12(services, 규칙 6의 순수 함수) | 4.6절. L4 소비자가 구현 패키지를 import하지 않게 한다 |
| `SettingsTab`에 `"sandbox"` 추가 | `F.wire-settings.spec` §3.8.2 | 6절. `_research/settings.md` §4 5번 탭 |

### 8.3 요구

| 대상 | 요구 |
|---|---|
| `xeon.os`(`OsService`, `L0.os.spec`) | `OsDirs.home`, `OsDirs.config`, `OsDirs.data`(DB·blob 포함), `OsDirs.tmp`의 절대 경로(`L0.os.spec` §3.2). `resolveBinary("rg" \| "bwrap" \| "socat")`(§3.6) |
| `xeon.secrets`(`SecretService`, `L0.secrets.spec`) | `protectedPaths()`: 비밀 파일 절대 경로 목록(값 없음, `L0.secrets.spec` §3.6). 보호 경로 `secret_key` 행. 후속에서 sentinel 모드의 프록시 훅 요구를 받는다(10절 9번) |
| `xeon.exec`(`L0.exec.spec`) | `SENSITIVE_ENV_PATTERNS`를 F에 두는 것(자가 시험 `env_allowlist`), `Shell` 데코레이션 성질(§3.7) |
| `L1.tools.spec` | (1) 셸 도구 실행 경로에서 `wrapShell`로 감싼 `Shell`을 쓰는 조립. (2) `onUnavailable` 표(4.5절)의 도구 광고·승인 처리. (3) `autoAllow` 판정의 적용. (4) 파일 도구가 `protectedPaths()`와 `matchProtectedPath`로 realpath 검사(18 R-12). (5) 격리 없이 실행한 호출의 기록(이벤트 소유 [미결]) |
| `L2.workspace.spec` | §4.3 6번 보호 경로 검사에 `matchProtectedPath` 사용. 쓰기 루트를 `defaultPolicy` 입력과 같은 값으로 쓰기 |
| `L4.host-service.spec`, apps/host | 시작 때와 `l0.sandbox.selfTestIntervalMin`마다 `selfTest(<xeon.exec Shell>, …)` 호출. exec·sandbox 조립 지점 |
| `L4.cli.spec` | doctor 출력에 `describeSandboxStatus`, `missing_dependency`는 종료 코드 2 계열 |
| `L2.mcp.spec` | MCP stdio 서버를 샌드박스에 넣을지 협의(10절 3번) |

## 9. 수용 기준

1. Linux·macOS CI의 실제 srt에서 샌드박스 안 `cat <home>/.ssh/<canary>`와 `cat <xeonData>/selftest/canary`가 실패하고 출력에 canary 값이 없다.
2. 샌드박스 안 `touch <xeonData>/x`, `touch <root>/.git/hooks/pre-commit`, `echo >> <root>/.git/config`가 실패하고 파일이 바뀌지 않는다.
3. 샌드박스 안 `touch <writeRoot>/ok`가 성공한다.
4. 호출자가 `readDeny: []`, `writeDeny: []`인 정책으로 `wrapShell`을 써도 1·2번 결과가 같다(보호 경로는 줄일 수 없다). `l0.sandbox.protectedPaths.extra`에 경로를 더하면 그 경로 읽기도 실패한다.
5. 의존 프로그램이 없는 환경(가짜 provider로 `bwrap` 부재)에서 `status()`가 `{ available: false, reason: "missing_dependency", missing: ["bwrap"] }`이고 `describeSandboxStatus`의 `severity`가 `critical`, `hints`에 설치 안내가 있다.
6. `l0.sandbox.enabled = false`이면 `status().reason`이 `disabled`이고 시작 로그와 doctor 출력에 경고가 있으며, 실행 결과의 `sandbox.unsandboxedBy`가 `"disabled"`다.
7. Windows provider(가짜 `process.platform = "win32"`)에서 `status()`가 `{ level: "none", reason: "unsupported_os" }`이고, 기본 설정에서 `wrapShell(...).exec`는 자식 프로세스를 만들지 않고 `sandbox_unavailable`을 돌려준다. `run_unsandboxed`로 바꾸면 실행되고 `unsandboxedBy: "run_unsandboxed"`가 붙는다.
8. `autoAllow`가 4.3절 조건 조합별 판정표(조건 5개의 참·거짓 32조합)에서 기대 결과와 `blocks` 목록을 낸다.
9. 성공한 샌드박스 실행의 `ShellExecResult.sandbox.sandboxed`가 참이고, M1 스모크의 bash 도구 호출 이벤트 details에서 이 값을 확인할 수 있다.
10. `wrapShell`이 넘긴 `secretEnv` 참조는 아래 `Shell`에 그대로 도착하고, `SandboxRunReport`와 시작 로그에 비밀 값이 없다.
11. srt 래핑이 throw하면 `sandbox_failed`이고 `cleanupAfterCommand` 호출이 0회다.
12. 실제 srt와 OS 격리(Linux bubblewrap, macOS Seatbelt)로 `sandbox.int.test.ts`가 다음을 확인한다. 각 거부 시험은 같은 명령을 감싸지 않은 Shell로 돌려 성공함을 보이는 대조를 함께 둔다. (a) 쓰기 루트 안 쓰기는 성공하고 `sandbox.sandboxed`가 참이다. (b) 쓰기 루트 밖 쓰기가 종료 코드 0이 아니고 파일이 생기지 않는다(M1 종료 조건). (c) 쓰기 루트 안의 `.git/hooks` 쓰기가 거부된다. (d) `<xeonData>/selftest/canary` 읽기가 거부된다. (e) 호출자 `readDeny`·`writeDeny`가 비어도 (c)와 `protectedPaths.extra` 경로 읽기 거부가 그대로다. (f) 로컬 TCP 서버로 가는 `/dev/tcp` 연결이 거부되고 서버가 연결을 받지 못한다. (g) 자가 시험 여섯 항목이 모두 통과한다.
13. 12번 시험의 필수 바이너리(Linux: `bwrap`, `socat`, `rg` / macOS: `rg`)가 없으면, 환경 변수 `XEON_REQUIRE_SANDBOX=1`이거나 `CI=true`일 때 종료 코드 2(환경 문제)로 끝나고 stderr에 `ENV sandbox.int: missing <이름>. <설치 안내>`를 쓴다. 그 밖의 기기에서는 건너뛰고 stderr에 `SKIPPED ENV sandbox.int: …`를 한 줄 남긴다. CI가 이 파일을 건너뛴 채 통과하지 않게 하는 쪽은 Z 트랙(G4-07)이 `test-capped.sh`의 종료 코드 전달과 건너뜀 수 출력으로 잇는다.

근거 위치: `_research/packages.md` §4.2 L0-b, `_research/refs/claude-code.md` §3.2·326행, `_research/notes/L0-1.md`, `_research/settings.md` §2.2·§4, `docs/design/18-security.md` §3.11.1·§3.11.4·§3.11.5, `docs/design/13-tools-and-execution.md` §3.5·§3.6.

## 10. 미결 사항

1. [결정: review.m3-design-inputs D-M3-18 행 1] 샌드박스 안 네트워크는 기본 허용이다. 사용자가 차단 도메인 목록 `l0.sandbox.network.blockedDomains`를 관리한다. 패키지 설치가 샌드박스 안에서 그대로 돈다. 차단은 srt 프록시의 `deniedDomains`와 질의 콜백(항상 허용)으로 한다. 시험은 `sandbox-network.int.test.ts`가 실제 bwrap으로 같은 요청이 목록 밖이면 200, 목록 안이면 403인 것을 값으로 확인한다. 프록시를 거치지 않는 직접 소켓은 네트워크 네임스페이스가 막으므로 그대로 거부된다(§4.4 `network_denied`). 환경 변수 `NO_PROXY`의 루프백·사설 대역은 프록시를 거치지 않으므로 샌드박스 안에서 닿지 못한다.
2. [결정: 오케스트레이터 기본값] 격리 없이 실행한 호출(`tool.sandbox_bypassed`)과 자가 시험 실패의 감사 이벤트 소유자는 L1 tools(`tool.` 접두)다(§4.8). `platform-sandbox`는 이벤트 type을 소유하지 않는다(`eng.context-map.design` §4.1). 이벤트를 만드는 구현은 B3-SEC가 한다.
3. [결정: review.m3-design-inputs D-M3-19 행 1] MCP stdio 서버는 출처별 기본값을 쓴다. 프로젝트 출처 서버는 샌드박스에 넣고, 사용자 출처 서버는 넣지 않는다. 서버별 설정으로 바꿀 수 있다(`L2.mcp.spec`, M3-REQ-57).
4. [결정: review.m3-design-inputs D-M3-18 행 3] 샌드박스 밖 재시도(`l0.sandbox.escapeRetry`)를 둔다. 기본은 끔이고, 켜도 재시도마다 승인을 받는다(`_research/notes/L0-1.md` §9).
5. [미결] x64·arm64 밖 Linux 지원. seccomp 필터가 번들되지 않아 `select.ts`는 `unsupported_os`를 돌려준다. 지금은 `xeon.os`가 해당 arch를 등록 실패로 처리하므로 운영 경로가 없다(3.5절). 지원을 넓히면 두 문서를 함께 고친다.
6. [결정: 오케스트레이터 기본값] 중첩 사용자 네임스페이스. 기본 브라우저 provider는 Stagehand다([결정: review.m3-design-inputs D-M3-23]). srt 0.0.79에는 `allowNestedUserNamespaces`가 없어 `enableWeakerNestedSandbox`로 허용하고 설정 `l0.sandbox.nestedNamespaces`(기본 거짓, `restart`)로 켠다(§4.8). 쓰기 거부가 약해질 수 있다(`_research/notes/L0-1.md` §6). 켠 상태에서 브라우저가 실제로 뜨는지는 실기 확인이 필요하다.
7. [결정: review.m3-design-inputs D-M3-18 행 2] 자격 파일 행(`~/.npmrc`, `~/.config/gh` 등)은 기본으로 읽기를 허용하고, 설정 `l0.sandbox.credentialFiles`(`allow`·`deny`)로 거부할 수 있다(§3.3). 이전 질문: 자격 파일 행의 읽기 거부 기본값. 안전하지만 `gh`, 사설 레지스트리 `npm`이 샌드박스 안에서 인증 없이 돈다. 비밀 env 주입(`L0.exec.spec` §3.6)으로 대신할 수 있는지 `L0.secrets.spec`과 함께 정한다.
8. [미결] `SettingsTab`의 `"sandbox"` 추가(F 변경).
9. [미결] 프록시 훅(후속, sentinel 모드). `L0.secrets.spec` §4.3 M2 sentinel 설계는 자식 HTTPS가 `xeon.sandbox` 프록시를 지나고 허용 호스트로 가는 요청의 헤더에서 sentinel을 값으로 바꾸는 훅을 요구한다. 이 문서는 아직 그 훅을 정하지 않았다. srt `mitmProxy`(외부 Unix 소켓) 연결 안과 `parentProxy` 체이닝 안을 `L0.sandbox.plan` SB-16에서 비교하고 TLS 종단(`L0.secrets.spec` §10 6번)과 함께 정한다.
