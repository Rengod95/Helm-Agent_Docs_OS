---
id: L0.sandbox.spec
layer: L0
domain: sandbox
kind: spec
status: draft
depends_on: [F.capabilities.spec, L0.exec.spec, L0.os.spec, L0.secrets.spec, adr.0001, eng.dependency-rules.guide]
binds: [xeon/packages/platform-sandbox/**]
---

# L0 sandbox 스펙: OS 샌드박스 `fresnel.sandbox`

## 1. 목적과 범위

`platform-sandbox`는 셸 명령과 그 자식 프로세스를 OS 샌드박스(macOS Seatbelt, Linux bubblewrap) 안에서 실행하게 하는 서비스 `fresnel.sandbox`(`SandboxService`)를 제공한다. 격리 구현은 `@anthropic-ai/sandbox-runtime`(이하 srt) 0.0.79(Apache-2.0)을 그대로 쓰고, 이 패키지는 Fresnel 정책과 srt 설정 사이의 접착 계층이다 [결정: `_research/foundation-plan.md` §2 샌드박스 행, `_research/packages.md` §4.2 L0-b].

- [결정: `eng.dependency-rules.guide` DR-07] srt는 `platform-sandbox`만 import한다.
- [결정: DR-02] `platform-sandbox`는 `platform-exec`를 import하지 않는다. 두 패키지는 F `Shell` 인터페이스로만 만난다(3.4절).

정하는 것:

- F에 둘 샌드박스 계약 초안: `SandboxService`, `SandboxStatus`, `SandboxPolicy`, `AutoAllowDecision`, `SelfTestReport`, `SandboxRunReport`, `describeSandboxStatus`(3.1절)
- Fresnel 정책 → srt 설정 매핑(3.2절), 보호 경로 목록(3.3절)
- `wrapShell` 데코레이터의 동작(4.2절), 자동 허용 판정(4.3절), 자가 시험(4.4절), 격리 불가 시 동작(4.5절)
- 플랫폼별 제약(5.2절), 설정 키(6절), 수용 기준(9절)

다루지 않는 것:

| 대상 | 정하는 곳 |
|---|---|
| 셸 실행, 자식 env 허용 목록, 시크릿 주입 | `L0.exec.spec` |
| 승인 UI, 권한 모드, 명령 패턴 규칙, 자동 허용 판정의 적용 | `L1.tools.spec` |
| 파일 도구(read, write, edit, grep)의 경로 검사 | `L2.workspace.spec` §4.3 (이 문서는 보호 경로 목록과 판정 함수만 준다) |
| 시크릿 lease, sentinel 프록시, 마스킹 | `L0.secrets.spec` |
| 사용자·앱 디렉터리 질의 | `L0.os.spec` |
| doctor 명령과 종료 코드 | `L4.cli.spec` |

범위와 단계:

| 구성요소 | 단계 | 표지 |
|---|---|---|
| OS 샌드박스(srt 래핑), 보호 경로, 자가 시험, 격리 불가 정책 | 1차, M1 | [결정: `_research/foundation-plan.md` §5 M1 "도구 read, ls, bash(sandbox)"; ls는 2026-11-13 폐지 [결정: 2026-11-13 사용자]], `_research/layer-plan-v2.json` L0-b 1차 |
| 네트워크 정책(srt 프록시) | M3b에서 기본 허용 + 차단 도메인 목록(§3.2, §10 1번). 허용 목록 방식은 후속. M1은 전부 차단이었다 | [결정: 계획 v2 L0-b "네트워크 정책 2차"] / 1차 차단 [제안] |
| 이름 붙은 권한 프로필, 실행 없는 오프라인 규칙 검사 | 2차 | [결정: 계획 v2 L0-b]. Gemini CLI `core/src/policy/*`(Apache-2.0)는 구조만 참고하고 import하지 않는다(`_research/packages.md` §4.2 162행) |
| Windows 네이티브 격리 | 1차 범위 밖. status `none`과 격리 불가 정책만 | [결정: `_research/decisions-log.md` 2026-10-19 "Windows 네이티브는 나중"] |

### 1.1 기존 설계와의 대조

`docs/design/13-tools-and-execution.md` §3.6은 격리 수준 S0·S1·S1b와 bwrap 인자를 직접 다루는 설계다. Fresnel은 이를 따르지 않는다(`architecture.overview.spec` 174-175행 "13의 S0~S2는 bubblewrap을 직접 다루는 설계이고, Fresnel은 `@anthropic-ai/sandbox-runtime`을 그대로 쓴다").

| 항목 | docs/design 13 §3.6, 18 §3.11 | Fresnel `platform-sandbox` | 근거 |
|---|---|---|---|
| 격리 수단 | bwrap 인자 직접 조립(S1), `systemd-run --user` 일회성 단위(S1b) | srt `wrapWithSandboxArgv`. macOS Seatbelt, Linux bubblewrap + seccomp | foundation-plan §2 |
| 수준 | S0, S1b, S1, S2 판별 합집합(`SandboxSpec`) | `level: "srt" \| "none"` 두 값 | [제안] srt가 플랫폼 수단을 고른다 |
| 읽기 범위 | 홈을 빈 tmpfs로 덮는 허용 목록(R-4) | srt 기본(읽기 전체 허용) + `denyRead` 목록. 정책에 `readAllow`가 있으면 허용 목록 방식(`denyRead: ["/"]` + `allowRead`, 플러그인 호스트의 "쓰기 없음" 프로필이 쓴다, 4.9절) | `_research/notes/L0-1.md` §3.2 "읽기는 전체 허용". 허용 목록 방식은 [결정: 2026-11-18 메인 제안, 사용자 보고됨] |
| 네트워크 | 네트워크 네임스페이스 + 데몬 CONNECT 프록시(R-6) | 1차 전부 차단, 2차 srt 내장 프록시와 도메인 목록 | 계획 v2 L0-b |
| 프로세스 분리 | PID 네임스페이스 권장(R-5) | srt의 플랫폼 동작을 따른다 [가정: srt Linux 구성의 PID 네임스페이스 여부 미확인] | `_research/notes/L0-1.md` §6 |
| 자원 한도 | `MemoryMax`, `TasksMax`(R-7) | 1차 없음. 시간 제한은 `fresnel.exec` timeout | [제안] |
| 격리 불가 시 | `execute` 끔(R-10), 운영자 `off`만 S0 | `l0.sandbox.onUnavailable` 2값(`disable_execute`, `run_unsandboxed`), 기본 `disable_execute` | 18 R-10 계승 [제안] |
| 자가 시험 | 시작·1시간마다·doctor, 9항목(§3.11.4) | 시작·주기·doctor, 6항목(4.4절) | 18 §3.11.4 이식 |
| 보호 경로 | Helm 경로(`/srv/volumes`, `~/.config/helm`) 포함 | Fresnel 경로로 바꾼 표(3.3절) | 18 §3.11.5 |

## 2. 용어

| 용어 | 뜻 |
|---|---|
| srt | `@anthropic-ai/sandbox-runtime`. 프로세스 전역 `SandboxManager` 싱글턴을 둔다(`_research/notes/L0-1.md` §8) |
| 샌드박스 안 명령 | `wrapShell`이 srt로 감싸 실행한 명령과 그 자식 |
| 쓰기 루트 | 샌드박스 안에서 쓰기를 허용하는 디렉터리. 작업 공간 root, 실행용 임시 디렉터리 |
| 보호 경로 | 쓰기 루트 안에 있어도 읽기나 쓰기를 거부하는 경로. Fresnel 자신의 시크릿·데이터와 설정 `extra`는 읽기와 쓰기를, 자격 폴더는 쓰기만 막는다. 설정으로 더할 수만 있다 [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"] |
| 탈출 실행 | 샌드박스 밖에서 실행하도록 허락된 호출(`SandboxPolicy.allowEscape: true`). 항상 승인 대상이다 |
| 위반 | srt가 막은 시도의 기록(프록시 거부, Seatbelt 로그, Linux seccomp 모니터) |
| 자가 시험 | 샌드박스 안에서 정해진 시도를 실행해 거부·허용이 기대대로인지 확인하는 절차 |

## 3. 인터페이스

### 3.1 F에 둘 샌드박스 계약 초안

아래 타입은 F `@fresnel/contracts/services`의 `services/sandbox.ts`와 `services/sandbox-report.ts`에 둔다. L0·L1 서비스 인터페이스는 이 서브패스에 둔다 [결정: review.decisions-2 D-04]. 이름은 `F.capabilities.spec` §3.12 파일별 이름 표의 두 파일 행에 있다. 아래 블록은 F로 옮기기 전의 초안이고, 필드는 이 블록을 F로 옮겨 확정한다(같은 절 규칙 1, `F.capabilities.plan` P9). 8절 'F에 요청'은 그 작업의 목록이다. 표기는 `F.conversation.spec` §3 머리말을 따른다(`interface X` + `XSchema: Schema<X>`는 TypeBox 명시 타입 상수).

```ts
// @fresnel/contracts/services — sandbox-report.ts [결정: review.decisions-2 D-04]. 아무것도 import하지 않는다(exec.ts와 sandbox.ts가 함께 쓴다)
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
  /** 막은 것의 분류(4.2절 11번). 막은 것이 없을 때는 키를 두지 않는다 */
  blocks?: SandboxBlock[];
}
export const SandboxRunReportSchema: Schema<SandboxRunReport>;

// @fresnel/contracts/capabilities — sandbox-block.ts [제안: 2026-11-08, 4.2절 11번]. services가 다른 F 디렉터리에서 값을 가져오지 못해 타입과 스키마를 여기 둔다
export type SandboxBlock =
  | { code: "sandbox.network_blocked"; domain: string }
  | { code: "sandbox.write_blocked"; path: string }
  | { code: "sandbox.read_blocked"; path: string };
export const SandboxBlockSchema: Schema<SandboxBlock>;
```

```ts
// @fresnel/contracts/services — sandbox.ts
import type { CancelScope, Shell } from "./exec.ts";                       // L0.exec.spec §3.1
import type { SandboxRunReport, SandboxViolation } from "./sandbox-report.ts";

export type SandboxPlatform = "darwin" | "linux" | "wsl2" | "wsl1" | "win32" | "other";
export type SandboxUnavailableReason = "missing_dependency" | "unsupported_os" | "self_test_failed" | "disabled";
export type OnUnavailable = "disable_execute" | "run_unsandboxed"; // 물어보기 없음(4.5절)

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
  /**
   * `"read-only"`면 읽기 전용 프로필이다(4.2절 읽기 전용 프로필, 네트워크 차단). `"no-write"`면 쓰기 없음 프로필이다(4.9절, 네트워크는 정책 그대로).
   * 생략하면 보통 프로필이다 [결정: 2026-11-13 사용자]
   */
  profile?: "read-only" | "no-write";
  /**
   * 읽기 허용 목록. 있으면(빈 목록도) 허용 목록 방식이다: `/` 전체를 읽기 거부하고 이 경로(와 `readDeny`에 겹치지 않는 것)만 다시 연다.
   * 없으면 지금까지와 같은 거부 목록 방식이다. 보호 경로(읽기)나 `readDeny`와 겹치는 항목(같거나 그 안이거나 그것을 품은 것)은 정책 병합에서 빠진다 [결정: 2026-11-18 메인 제안, 사용자 보고됨]
   */
  readAllow?: string[];
  /** `no-write`에서 이름 하나만(하위 경로 없이) 읽게 하는 절대 경로(심볼릭 링크 이름 `/var`, `/etc` 등). Seatbelt만 쓰고 프로필 끝에 `(allow file-read* (literal ...))`로 더한다 [제안, AGE-58] */
  readAllowLiteral?: string[];
  /** 읽기 허용 뒤에 다시 막는 실행 파일(개별 도구). Seatbelt만 쓰고 프로필 끝에 `(deny file-read* ...)`와 `(deny process-exec ...)`로 더해 앞의 허용을 이긴다 [제안, AGE-58] */
  toolDeny?: string[];
  /** 프로필 끝에서 다시 막는 Mach 서비스 이름(`(deny mach-lookup (global-name ...))`). Seatbelt만 쓴다 [제안, AGE-58] */
  machDeny?: string[];
  /** 참이면 프로필 끝에서 시스템 정보 길을 막는다(다른 프로세스 정보, 프로세스 표·인자 sysctl, IOKit 속성과 전원 관리 연결, 배포 알림 보내기). Seatbelt만 쓴다 [제안, AGE-58 후속] */
  systemInfoDeny?: boolean;
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
  reason: "fresnel_data" | "fresnel_config" | "secret_key" | "credentials" | "agent_credentials" | "shell_startup" | "git_exec" | "persistence" | "user_extra";
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
  | "protected_read_denied" | "fresnel_data_write_denied" | "network_denied"
  | "workspace_write_allowed" | "env_allowlist" | "git_hooks_write_denied";
export interface SelfTestItem { id: SelfTestItemId; passed: boolean; detail?: string }
export interface SelfTestReport { at: number; durationMs: number; passed: boolean; items: SelfTestItem[] }
export const SelfTestReportSchema: Schema<SelfTestReport>;

/** 순수 함수. doctor·설정 화면·시작 로그가 쓴다(4.6절). L4가 platform-sandbox를 import하지 않도록 F에 둔다 */
export interface SandboxStatusSummary { severity: "ok" | "warn" | "critical"; summary: string; hints: string[] }
export function describeSandboxStatus(status: SandboxStatus): SandboxStatusSummary;

export interface SandboxArgvRequest { command: string; args: readonly string[]; cwd: string | undefined }
export interface SandboxedArgv {
  argv: readonly string[];
  /** 자식 env에 더할 항목. 부모 env와 다른 항목만이다 */
  env: Readonly<Record<string, string>>;
  sandboxed: boolean;
  /** sandboxed가 거짓일 때만 */
  unsandboxedBy?: "disabled" | "escape" | "run_unsandboxed";
  /** 프로세스가 끝났거나 spawn에 실패하면 부른다. 여러 번 불러도 한 번만 한다 */
  cleanup(): void;
}
export type SandboxWrapError =
  | { kind: "unavailable"; reason: SandboxUnavailableReason | undefined }
  | { kind: "failed"; message: string }
  | { kind: "aborted" };

export interface SandboxService {
  status(): SandboxStatus;
  /** 작업 공간 root와 임시 디렉터리로 기본 정책을 만든다. 보호 경로와 설정 추가분이 들어간다 */
  defaultPolicy(input: { workspaceRoots: readonly string[]; tempDir: string }): SandboxPolicy;
  /**
   * 보호 경로 전체(기본 + 설정 추가분). L2 파일 도구용. `roots`는 호출한 쪽이 지금 허용하는 작업 공간 root(정규 경로)다.
   * root별 git 항목(`.git/hooks`, `.git/config` 등)이 이 호출의 결과에 들어가므로, bash를 한 번도 돌리지 않은 파일 도구도
   * 첫 호출부터 보호된다. 생략하면 샌드박스가 정책으로 이미 본 root만 쓴다.
   */
  protectedPaths(roots?: readonly string[]): readonly ProtectedPathEntry[];
  /** 설정 extra 값 하나를 보호 경로 비교 키(정규 절대 경로)로 바꾼다. `resolveExtraPaths`와 같은 규칙이고, 그 밖의 값은 undefined다 [결정: 2026-11-20, AGE-63] */
  protectedPathKey(value: string): string | undefined;
  /** 이 기기의 제안 경로 줄(`suggestedProtectedPaths(platform)`)을 `~/…` 형식과 비교 키로 돌려준다 [결정: 2026-11-20, AGE-63] */
  suggestedProtectedPaths(): readonly SuggestedProtectedPathView[];
  /** F Shell을 받아 F Shell을 돌려준다. exec 패키지를 import하지 않는다 */
  wrapShell(shell: Shell, policy: SandboxPolicy): Shell;
  /** 오래 사는 프로세스(stdio MCP 서버)를 정책 안에서 돌릴 명령줄을 만든다(4.9절). 호출자가 argv를 스트림 그대로 spawn한다 */
  wrapArgv(policy: SandboxPolicy, request: SandboxArgvRequest, context: CancelScope): Promise<Result<SandboxedArgv, SandboxWrapError>>;
  /** 판정만 한다. 승인 UI와 적용은 L1 tools */
  autoAllow(policy: SandboxPolicy, request: { command: string | readonly string[]; cwd: string; workspaceRoots: readonly string[]; tempDir: string }): AutoAllowDecision;
  /** 주어진 Shell을 감싸 자가 시험을 실행하고 status에 반영한다. 한 번에 하나씩 돈다(4.4절) */
  selfTest(shell: Shell, context: CancelScope): Promise<SelfTestReport>;
  /** 마지막으로 기록된 자가 시험 보고서 전체(항목별 통과와 사유). 기록이 없으면 없음 [결정: 2026-11-11 사용자] */
  lastSelfTestReport(): SelfTestReport | undefined;
}
export const SandboxServiceName = "fresnel.sandbox" as const;
```

- [제안] brief 초안의 `selfTest(): SelfTestReport`를 `selfTest(shell, context): Promise<SelfTestReport>`로 바꿨다. 자가 시험은 실제 명령 실행이 필요하고, `platform-sandbox`는 exec를 import하지 않으므로 조립하는 쪽이 `Shell`을 넘겨야 한다(3.4절). 실행이라 비동기다.
- [제안] `defaultPolicy`, `protectedPaths`, `matchProtectedPath`를 더했다. `L2.workspace.spec` §4.3 6번과 역할 표가 "보호 경로 목록 소유: L0.sandbox, 파일 도구에도 적용"을 요구하기 때문이다. `matchProtectedPath`는 순수 함수라 F에 둘 수 있다(`F.readme` §1 예외 1).
- `SandboxRunReport`는 값 없는 실행 정보다. `L2.workspace.spec` §4.2 5번 `detail.sandboxViolations`와 `sandboxed` 출력이 이 값을 옮긴다.
- import 방향 [제안]: `SandboxRunReport`와 `SandboxViolation`은 `sandbox-report.ts`에 둔다. `exec.ts`는 `sandbox-report.ts`만, `sandbox.ts`는 `exec.ts`와 `sandbox-report.ts`를 import한다. `exec.ts`가 `sandbox.ts`를 import하지 않으므로 `import/no-cycle`(타입 import 포함)에 걸리지 않는다(`L0.exec.spec` §3.1).
- [제안] `describeSandboxStatus`는 F 순수 함수다(`F.readme` §1 예외 1). 소비자 `L4.cli`·`L4.settings-ui`는 구현 패키지를 import할 수 없으므로(DR-14) F에서 가져온다. 설치 안내는 `SandboxStatus.installHints`에 실어 함수가 상태 값만으로 결과를 내게 한다 [제안].

### 3.2 Fresnel 정책 → srt 설정 매핑

srt 설정 키는 `_research/notes/L0-1.md` §3(0.0.79 소스 `src/sandbox/sandbox-config.ts:957-1266`, `.d.ts` 대조)으로 확인했다. 실제 격리 효과는 실행으로 확인하지 않았다(같은 문서 §0 1번 [미확인]). 동작 열의 [가정]은 실행 확인 전이다.

| Fresnel | srt 설정 | 키 확인 | 동작 |
|---|---|---|---|
| `policy.writeRoots` | `filesystem.allowWrite` | 확인 | 기본은 쓰기 전부 거부, 목록만 허용 [가정] |
| `policy.writeDeny` ∪ 보호 경로(`write`, `read_write`) | `filesystem.denyWrite` | 확인 | `allowWrite` 안에서도 거부(`denyWrite`가 이긴다) [가정] |
| `policy.readDeny` ∪ 보호 경로(`read_write`) | `filesystem.denyRead` | 확인 | 읽기 기본 전체 허용, 목록만 거부 [가정] |
| (1차 미사용) | `filesystem.allowRead` | 확인 | `denyRead` 안에서 다시 허용. basename 예외는 목록 전개로 처리하므로 쓰지 않는다 |
| (고정 거짓) | `filesystem.allowGitConfig` | 확인 | `.git/config` 쓰기 계속 거부 |
| `policy.network.allowedDomains` | `network.allowedDomains` | 확인 | 빈 목록이면 허용 목록은 비어 있다. 목록 밖 호스트는 아래 `strictAllowlist` 행이 정한다 |
| `policy.network.deniedDomains` ← 설정 `l0.sandbox.network.blockedDomains` | `network.deniedDomains` | 확인 | 허용 목록보다 먼저 검사. 서비스가 `initialize`에 한 번 넘긴다. srt 스키마가 받지 않는 항목은 빼고 `SandboxStatus.rejectedBlockedDomains`에 목록으로 싣는다(status와 doctor가 보여 준다). 개수는 `sandbox.blocked_domain_rejected` 로그에도 남긴다. 목록은 갱신할 때마다 새로 정하고, 탐지가 끝나지 않은 갱신에서는 빈 목록이다 [결정: M3-REQ-55] |
| (서비스 고정) | `network.strictAllowlist` = 거짓과 `initialize`의 질의 콜백(항상 허용) | 확인 | 거부 목록은 콜백보다 먼저 검사되므로 목록 밖 호스트는 모두 허용이고 거부 목록만 막는다(차단 목록 방식, 기본 허용). 목록 방식 엄격 모드(콜백 없음, `strictAllowlist` 참)는 `SrtPort.initialize`의 `allowUnlistedHosts` 거짓으로 남아 있다 |
| `policy.allowEscape` | 없음 | — | Fresnel만 쓴다. 참이면 srt로 감싸지 않는다(4.2절) |
| `l0.sandbox.enabled = false` | srt `initialize` 안 함 | — | status `none`, reason `disabled` |
| 상태 탐지가 찾은 절대 경로 | `bwrapPath`, `socatPath`, `ripgrep.command`, `seccomp.applyPath` | 확인(`bwrapPath`, `socatPath`는 절대 경로만) | 사이드카에서 헬퍼 위치를 명시(5.3절) |
| 설정 `l0.sandbox.nestedNamespaces`(기본 거짓) | `enableWeakerNestedSandbox` | 확인 | 참이면 `/proc`을 새로 마운트하지 않고 호스트 것을 묶어 중첩 사용자 네임스페이스를 허용한다. 브라우저 provider(Stagehand, Playwright)용이고 격리가 약해진다(§4.8) [결정: 오케스트레이터 기본값, M3-REQ-56] |
| (고정 거짓) | `allowNestedUserNamespaces`(0.0.79 스키마에 없음), `enableWeakerNetworkIsolation`, `allowAppleEvents`, `allowPty`, `network.allowAllUnixSockets`, `network.allowLocalBinding` | 확인 | 나머지 완화 옵션은 노출하지 않는다(`_research/notes/L0-1.md` §3.6) |
| (기본값 유지) | `mandatoryDenySearchDepth` | 확인(1~10, 기본 3) | srt 자동 보호 경로 탐색 깊이 |
| (1차 미사용) | `credentials`, `network.tlsTerminate`, `network.mitmProxy`, `ignoreViolations`, `parentProxy` | 확인 | 2차(`L0.secrets.spec` sentinel, 네트워크 정책)에서 다시 본다 |

변환 규칙(순수 함수 `toSrtConfig`, `src/policy.ts`):

1. 모든 경로를 절대 경로로 만들고, 존재하는 경로는 realpath로 바꾼다. 없는 경로는 가장 가까운 존재하는 상위의 realpath에 나머지를 붙인다. 정렬하고 중복을 지운다.
2. Linux에서 `allowWrite`·`denyWrite`는 리터럴 경로만 받는다. 끝의 `/**`는 srt가 버리고 다른 글로브는 건너뛴다("A skipped pattern hides nothing", `_research/notes/L0-1.md` §3.2). 그래서 Fresnel은 모든 OS에 리터럴 경로만 넘긴다 [제안].
3. `basename` 보호 항목(`.env`, `.env.*`)은 명령마다 쓰기 루트 아래를 깊이 `mandatoryDenySearchDepth`까지 훑어 찾은 파일의 리터럴 경로로 바꾼다. 실행 중에 새로 생긴 파일은 덮지 못한다(5.1절). 기본 `.env`는 쓰기만 막으므로 쓰기 거부 목록에만 들고, 읽기 거부 목록에는 읽기 거부 이름 항목의 파일만 든다 [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"].
4. 변환 결과를 srt `SandboxRuntimeConfigSchema`로 검증한다. 실패는 버그(`Bug`)다. Linux에서 `getLinuxGlobPatternWarnings()`가 비어 있지 않으면 버그다.
5. 프로세스 전역 설정(`initialize`)에는 네트워크와 고정 값만 넣고, 파일 정책은 명령마다 `customConfig`로 넘긴다. srt의 네트워크 설정은 명령마다 바뀌지 않는다(`_research/notes/L0-1.md` §8).

### 3.3 보호 경로 (1차)

[제안] `docs/design/18-security.md` §3.11.5 표에서 Helm 전용 경로를 지우고 Fresnel 경로로 바꿨다. 줄일 수 없고 `l0.sandbox.protectedPaths.extra`로 더할 수만 있다. `<home>`, `<fresnelData>`, `<fresnelConfig>`는 `fresnel.os`의 `OsDirs.home`, `OsDirs.data`, `OsDirs.config`다(`L0.os.spec` §3.2, 8.3절). `<root>`는 정책의 각 쓰기 루트다.

[결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"] 읽기는 기본으로 모두 허용한다. 보호 경로 항목은 두 접근 가운데 하나를 가진다. `read_write`는 읽기와 쓰기를 거부하고, `write`는 쓰기만 거부한다. 기본으로 `read_write`인 것은 Fresnel 자신의 시크릿과 데이터뿐이다. 자격 폴더와 이름 패턴은 `write`다. 사용자가 설정 `l0.sandbox.protectedPaths.extra`에 적은 경로는 `read_write`(`user_extra`)가 된다. 막을 부분은 사용자가 대화로 더하고(3.3.1절), 이 표는 기본 상태를 적는다.

| 경로 | 일치 | 접근 거부 | 이유 코드 | 18 §3.11.5 대응 |
|---|---|---|---|---|
| `<fresnelData>/` 전체(단일 DB, WAL, blob) | prefix | 읽기·쓰기 | `fresnel_data` | `/srv/volumes/**` 대체. bash로 DB·blob을 직접 고치는 우회 쓰기(13 §3.5.1 W-3)와 다른 대화 내용 읽기를 막는다 |
| `<fresnelConfig>/` 전체 | prefix | 쓰기 | `fresnel_config` | `~/.config/helm/**` 대체. 다음 시작 때 설정·플러그인으로 코드가 실행된다 |
| `<fresnelConfig>/secrets/` 전체(메타 파일, 감사 파일, 파일 폴백 age 키 기본 위치 `<fresnelConfig>/secrets/age/keys.txt`) | prefix | 읽기·쓰기 | `secret_key` | 새 행. `<fresnelConfig>/` 행은 쓰기만 막으므로 시크릿 파일의 읽기를 따로 막는다(`L0.secrets.spec` §3.2·§4.7) |
| `SecretService.protectedPaths()`가 돌려주는 절대 경로(설정한 SOPS 파일, `l0.secrets.ageKey.filePath`로 바꾼 파일 폴백 age 키) | exact | 읽기·쓰기 | `secret_key` | SOPS 원본 행 대체. 등록 API를 두지 않고 sandbox가 상태 탐지 때와 `l0.secrets.*` 변경 뒤에 이 목록을 다시 읽는다 [제안] |
| `<home>/.config/sops/` | prefix | 읽기·쓰기 | `secret_key` | 같음 |
| age 키 파일: `<home>/.config/sops/age/keys.txt`, macOS `<home>/Library/Application Support/sops/age/keys.txt`, 부모 env `SOPS_AGE_KEY_FILE` 값 | exact | 읽기·쓰기 | `secret_key` | `**/keys.txt` 대체. macOS 기본 위치는 [가정: sops 문서 확인 필요] |
| 설정 `l0.sandbox.protectedPaths.extra`에 적은 경로(`~/` 또는 절대 경로) | prefix | 읽기·쓰기 | `user_extra` | 사용자가 고른 것이다. 셸 도구와 파일 도구가 모두 읽지도 쓰지도 못한다. 쓰기 루트 안에 있어도 막힌다 [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"] |
| `<home>/.ssh/` | prefix | 쓰기 | `credentials` | 같음 [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"] |
| `.env`, `.env.*`(예외 `.env.example`) | basename | 쓰기 | `credentials` | 같음 [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"] |
| `<home>/.claude/`, `<home>/.codex/`, `<home>/.pi/` | prefix | 쓰기 | `agent_credentials` | 같음 [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"] |
| `<home>/.git-credentials`, `<home>/.aws/`, `<home>/.kube/`, `<home>/.config/gcloud/` | prefix·exact | 쓰기 | `credentials` | 클라우드·저장소 자격 행. 18은 데몬 파일 도구용이었고 Fresnel은 샌드박스에도 쓴다 [제안] [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"] |
| `<home>/.gnupg/`, `<home>/.password-store/`, `<home>/.azure/`, `<home>/.config/op/`, `<home>/.op/`, `<home>/.config/glab-cli/` | prefix | 쓰기 | `credentials` | 개인 키, 비밀번호 저장소, 클라우드·CLI 토큰. 읽어야 일하는 설정이 아니다 [제안: enPp, 2026-11-20] [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"] |
| `<home>/.cargo/credentials.toml`, `<home>/.cargo/credentials`, `<home>/.gem/credentials`, `<home>/.terraform.d/credentials.tfrc.json` | exact | 쓰기 | `credentials` | 게시·원격 실행 토큰 파일. `~/.cargo/config.toml`, `~/.cargo/bin`은 막지 않는다(빌드가 읽는다). 게시할 때만 읽는 파일이다 [제안: enPp] [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"] |
| `<home>/.gemini/`, `<home>/.cursor/`, `<home>/.config/github-copilot/`, `<home>/.config/opencode/`, `<home>/.local/share/opencode/` | prefix | 쓰기 | `agent_credentials` | 다른 AI 하네스의 로그인 토큰과 MCP 설정. `~/.claude`와 같은 기준 [제안: enPp] [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"] |
| 키체인: `/Library/Keychains/`, macOS `<home>/Library/Keychains/` | prefix | 쓰기 | `credentials` | macOS provider 행. 막아도 `security list-keychains`, `security find-identity`, `codesign`, `curl`의 HTTPS 연결은 그대로 돈다(이 맥 실측, 키체인 접근은 시스템 서비스가 대신한다) [제안: enPp] [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"] |
| macOS 쿠키 저장소: `<home>/Library/Cookies/` | prefix | 쓰기 | `credentials` | macOS provider 행. 키체인과 함께 막는다 [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"] |
| macOS 비밀번호 관리자: `<home>/Library/Application Support/` 아래 `1Password`, `Bitwarden`, `KeePassXC`, `<home>/Library/Group Containers/2BUA8C4S2C.com.1password/`, `<home>/Library/Containers/com.1password.1password/` | prefix | 쓰기 | `credentials` | macOS provider 행 [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"] |
| (기본 목록에 없음) 브라우저 프로필과 메신저·메일 데이터: macOS의 Chrome·Chromium·Edge·Brave·Arc·Vivaldi·Opera·Firefox 프로필, `Signal`·`Slack`·`discord`, Linux의 같은 자리(`.config/google-chrome`, `.mozilla`, `.thunderbird` 등) | 해당 없음 | 막지 않음 | 해당 없음 | 기본으로 읽을 수 있다 [결정: 2026-11-20, 사용자, AGE-63 "목록 줄이기"]. 쓰기는 작업 공간 밖이라 계속 거부된다. 막으려면 `l0.sandbox.protectedPaths.extra`에 더한다. macOS의 `Library/Safari`, `Library/Messages`, `Library/Mail`은 OS(TCC)가 스스로 막는다. 브라우저 프로필을 열면 그 안의 쿠키와 저장된 로그인도 읽힌다 |
| Linux·WSL2 비밀번호 관리자·키링: `<home>/.config/` 아래 `1Password`, `Bitwarden`, `KeePassXC`, `keepassxc`, `<home>/.local/share/keyrings/`, `<home>/.local/share/kwalletd/` | prefix | 쓰기 | `credentials` | Linux provider 행. Linux 실측 전 [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"] |
| `<home>/.config/gh/`, `<home>/.netrc`, `<home>/.docker/config.json`, `<home>/.npmrc`, `<home>/.pypirc` | prefix·exact | 쓰기 | `credentials` | CLI 인증 파일. 기본은 읽기를 허용해 `gh`와 사설 레지스트리 `npm`이 샌드박스 안에서 인증된다 [결정: review.m3-design-inputs D-M3-18 행 2]. 쓰기는 항상 거부하고, 읽기를 막으려면 `extra`에 적는다 [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"] |
| `<home>/.bashrc`, `.bash_profile`, `.zshrc`, `.zprofile`, `.zshenv`, `.profile`, `<home>/.gitconfig` | exact | 쓰기 | `shell_startup` | 같음. srt 자동 보호와 겹친다(README:1142-1190) |
| `<root>/.git/config`, `<root>/.git/config.worktree`, `<root>/.git/info/attributes`, `<root>/.git/hooks/`, `<root>/.gitmodules` | exact·prefix | 쓰기 | `git_exec` | 같음. 다음 git 호출에서 명령이 실행된다. srt 자동 보호와 겹친다 |
| `<home>/.local/bin/`, `<home>/.config/systemd/user/`, macOS `<home>/Library/LaunchAgents/` | prefix | 쓰기 | `persistence` | PATH 변조와 지속 실행 등록. `~/.local/share/mise/**`는 사용자 도구 체인이라 [제안] 1차에서 뺀다 |

지운 행: `/srv/volumes/**`(Helm 홈서버), `~/.config/helm/**`, `~/.dotfiles/secrets/**`·`~/projects/*/secrets/**`(사용자별 경로, `protectedPaths.extra`로 더한다), `~/data/**`·`~/vault/**`(사용자 개인 자료), `/mnt/**`(WSL Windows 드라이브. 작업 공간이 `/mnt/c` 아래일 수 있어 기본에서 뺀다 [제안]).

- [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"] 설정 `l0.sandbox.protectedPaths.allowRead`와 `l0.sandbox.credentialFiles`는 두지 않는다(3.3.1절). 기본 쓰기 거부 항목은 줄지 않는다.
- 제안 목록(`SUGGESTED_PROTECTED_PATHS`)의 자격 행을 사용자가 `extra`에 적으면 읽기와 쓰기를 모두 막는다. 예: `~/.npmrc`, `~/.config/gh`, `~/.netrc`, `~/.docker/config.json`, `~/.pypirc`(CLI 인증 파일), `~/.ssh`, `~/.aws`. 이름 패턴 `.env`, `.env.*`는 `extra`로 고르지 못한다.
- 읽어야 일하는 설정일 수 있어 막지 않은 것: `~/.gitconfig`·셸 시작 파일(쓰기만 막는다), `~/.npmrc`·`~/.config/gh`·`~/.docker/config.json`·`~/.netrc`·`~/.pypirc`(위 CLI 인증 파일 행: 읽기 허용, 쓰기 거부), `~/.cargo/config.toml`, `~/.m2/settings.xml`(저장소 주소와 인증이 한 파일), `~/.config/configstore`(npm 계열 CLI의 갱신 상태). 뒤의 둘은 막았을 때 깨지는지 실측하지 않았다.
- 시험: `git status`, `git commit`, `gh --version`, `npm --version`, `bun install --dry-run`, `ssh -V`, `curl` HTTPS는 이 목록 아래에서 그대로 돈다(이 맥, 실제 srt, 실제 홈의 자격 쓰기를 막은 채). 자동 시험은 `test/sandbox.default-reads.int.test.ts`(기본 읽기, 쓰기 경계, Fresnel 자신의 경로, `extra`, 셸과 파일 도구 목록의 일치), `test/sandbox.secret-folders.int.test.ts`(제안 목록 폴더의 기본 읽기와 `extra` 거부)와 `test/protected-paths.test.ts`(표 값)다. 모두 임시 홈에서 돈다.
- 보호 경로의 기본 집합은 `buildProtectedPaths`(공통 줄, 이름 패턴, 시크릿과 Fresnel 자신의 항목, 설정 추가분)와 `SandboxProvider.defaultProtectedPaths(dirs)`(OS별 자격 줄과 지속 실행 등록)를 합친 것이다. OS별 자격 줄은 `SUGGESTED_PROTECTED_PATHS`에서 `osCredentialEntries`로 만든다. macOS 전용 행은 darwin provider만 낸다.
- `wrapShell`은 호출자가 넘긴 정책에 보호 경로를 항상 합친다. 호출자가 `readDeny`·`writeDeny`를 비워도 보호 경로는 빠지지 않는다.
- 쓰기 루트가 보호 경로 안에 있으면(예: `writeRoots`에 `<fresnelData>`) `defaultPolicy`와 `wrapShell` 모두 그 쓰기 루트를 지우고 위반 사유를 시작 로그에 남긴다 [제안]. `denyWrite`가 이기므로 결과는 같지만 자동 허용 판정을 흐리지 않기 위해서다.

#### 3.3.1 읽기는 기본으로 모두 허용, 막을 곳은 extra와 대화로 더한다 [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"]

- 읽기 거부는 두 곳뿐이다. Fresnel 자신의 시크릿과 데이터(`secret_key`, `fresnel_data`)와 설정 `l0.sandbox.protectedPaths.extra`에 적힌 경로다. 자격 폴더, CLI 인증 파일, 키체인, 브라우저 프로필, 메신저 데이터는 기본으로 읽힌다. 쓰기는 3.3절의 쓰기 거부 행이 계속 막는다.
- 설정 `l0.sandbox.protectedPaths.allowRead`는 두지 않는다. 읽기를 풀 대상이 Fresnel 자신의 항목뿐이고 그것은 풀 수 없다. 설정 `l0.sandbox.credentialFiles`도 두지 않는다. CLI 인증 파일의 기본 동작은 읽기 허용과 쓰기 거부이고, 읽기까지 막으려면 `extra`에 적는다. 두 키는 정의, 구현과 시험에서 뺐다.
- 옛 키를 담은 사용자 설정 파일은 설정 엔진의 알 수 없는 키 처리를 따른다. 옛 값을 새 키로 옮기는 코드는 두지 않는다.
- 제안 목록: `protected-paths.ts`의 `SUGGESTED_PROTECTED_PATHS`(줄마다 `path`, `match`, `reason`, `os`, `label`)와 `SUGGESTED_NAME_PATTERNS`(`.env`, `.env.*`, `appliesViaExtra: false`)가 이전에 읽기를 막던 자격 경로를 담는다. `suggestedProtectedPaths(platform)`는 그 OS의 줄을 돌려준다. 설정 `extra`에 적을 수 있는 것은 경로 줄뿐이고, 이름 패턴은 `extra`로 고를 수 없다.
- 막을 부분은 대화로 더한다. 모델 도구 `sandbox_protect`(기능 `workspace.protection`, cap-workspace)가 사용자 범위 `extra`에 경로를 더하고, `sandbox_protected`가 지금 막힌 것과 제안 목록을 보여 준다 [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"]. 이 도구는 더하기만 한다. 막기를 푸는 메서드, 인자, 설정 쓰기는 없다. 제안 목록의 줄은 `protectedPathKey`로 비교 키를 얻어 중복과 `/`·홈 거부를 정한다(`protectedPathKey`, `suggestedProtectedPaths`는 3.1절).
- 적용 시점 [결정: 2026-11-20, AGE-63, 시험으로 확인]: 설정 `extra`는 `runtimeChange: "nextTurn"`으로 선언되어 있지만, 실제로는 다음 셸 호출과 다음 파일 도구 호출부터 적용된다(같은 턴 안에서도). 보호 목록은 호출마다 `settings()`에서 다시 만들고, 셸 정책도 호출마다 풀며, 설정 저장소의 쓰기는 메모리 값을 쓰기 전에 바꾼다. 시험은 `test/sandbox.protect-live.int.test.ts`(실제 srt: 같은 감싼 셸이 설정만 바뀐 뒤 막힌다)와 `test/service.test.ts`(`nextTurn` 설정이 다음 호출부터 반영된다). 이미 시작한 프로세스(stdio MCP 서버 등)는 다시 시작할 때까지 옛 정책을 쓴다. 선언과 실제가 다르므로 설정 화면의 "다음 턴부터" 표시는 [미결: runtimeChange를 `live`로 바꿀지 사용자 결정]이다.
- 영향: `script-env`와 `no-write`(4.9절), 읽기 전용 프로필(4.2절)은 `readDeny`를 `read_write` 항목에서 만든다. 그래서 이제 Fresnel 자신의 시크릿·데이터와 `extra`만 막는다. `no-write`는 읽기 허용 목록이 나머지를 막으므로 실제로 열리는 것은 목록의 경로다.
- 구현: `protected-paths.ts`(`SUGGESTED_*`, `suggestedProtectedPaths`, `osCredentialEntries`)와 `index.ts`의 내보내기. 설정 정의는 `settings.ts`다.
- 시험: `test/sandbox.default-reads.int.test.ts`(실제 srt: 기본 읽기, 쓰기 경계, Fresnel 자신의 경로, `extra`, 셸과 파일 도구 목록의 일치), `test/sandbox.secret-folders.int.test.ts`(제안 목록 폴더를 기본에서 읽고 쓰기는 막는다, `extra`에 넣으면 읽기와 쓰기를 모두 막는다), `test/protected-paths.test.ts`(표와 제안 목록의 값), `test/sandbox.script-env.int.test.ts`(스크립트 환경의 읽기 거부). 파일 도구 쪽은 `packages/cap-workspace/test/read.test.ts`가 쓰기 전용 항목은 읽히고 읽기 거부 항목은 막히는 것을 확인한다.

### 3.4 exec와의 접점

exec와 sandbox는 서로 import하지 않고 F의 `Shell` 인터페이스로만 만난다. `fresnel.sandbox`의 `wrapShell`은 F `Shell`을 받아 F `Shell`을 돌려주고, 두 서비스의 조립은 L1 tools 또는 apps/host가 한다.

- `wrapShell`이 기대하는 `Shell`의 성질은 `L0.exec.spec` §3.7(옵션 전달, argv 실행, 결과 필드 보존)이다.
- 시크릿 값(`secretEnv`)은 `wrapShell`이 해석하지 않는다. 래핑 뒤 아래 `Shell`이 spawn 직전에 넣는다(`L0.exec.spec` §3.6).

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
- linux에서 `arch`가 `x64`·`arm64` 밖이면 seccomp 필터가 번들되지 않는다. `select.ts`는 이 경우 `none`, `unsupported_os`를 돌려준다. 다만 `fresnel.os`가 `x64`·`arm64` 밖 arch를 `unsupported_arch`로 등록 실패시키므로(`L0.os.spec` §3.1, §3.10) 운영에서는 이 분기에 오지 않는다. 분기는 `fresnel.os` 규칙이 넓어질 때를 위한 방어이고 단위 시험으로만 확인한다(10절 [미결] 5).
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
   Linux(bwrap)는 이어서 중첩 사용자 네임스페이스를 시험한다. srt는 모든 명령에서 bwrap 안에 한 번 더 네임스페이스를 만들기 때문이다(apply-seccomp, `enableWeakerNestedSandbox`로도 건너뛰지 않는다. srt 0.0.79 `linux-sandbox-utils.js`). bwrap `--unshare-user --unshare-pid`가 뜨는데 그 안의 `unshare --user --map-root-user --mount`가 거부되면 `reason: "missing_dependency"`, `missing: ["nested user namespaces"]`와 고치는 법(`installHints`)을 싣는다. 조용히 끄지 않는다: `onUnavailable`이 `disable_execute`이면 셸이 꺼지고 그 이유가 보인다. bwrap 자체가 안 뜨면 이 시험은 통과로 보고 자가 시험이 거른다. 원인은 배포판 정책이다: Ubuntu 26.04의 AppArmor 프로필 `bwrap-userns-restrict`가 bwrap 아래 프로세스의 capability를 막고, 24.04에서 통하던 `sysctl kernel.apparmor_restrict_unprivileged_userns=0`은 이 프로필을 풀지 못한다(제3자 보고, 이 저장소는 Docker에서 재현하지 못했다). 우리 설정으로는 고칠 수 없다. CI 러너(`ubuntu-24.04` 고정, 커밋 `d599b1c71`)는 러너 이미지에서 이 프로필을 푸는 단계(`apparmor_parser -R /etc/apparmor.d/bwrap-userns-restrict`)를 넣고 26.04 러너에서 `just exit-tests`가 통과하면 풀 수 있다. 또는 srt가 중첩 네임스페이스 없이 seccomp를 거는 방식으로 바뀌면 풀 수 있다. [결정: 2026-11-17 enU26 오케스트레이터 기본값]
5. srt `initialize(config, undefined, enableLogMonitor)`를 한 번 부른다. `enableLogMonitor`는 macOS 참, Linux 거짓이 기본이다 [제안]. Linux 모니터 값은 샌드박스 프로세스가 조작할 수 있어 진단용으로만 쓸 수 있기 때문이다(`_research/notes/L0-1.md` §5).
   macOS의 위반 감시(`log stream ... _SBX`)는 srt가 `reset()`에서만 끈다. 호스트가 reset 없이 끝나도 자식이 남지 않게, 초기화 직후 부모 없이(ppid 1) 남은 감시를 거두고 프로세스 `exit` 때 이 프로세스의 감시 자식을 끈다(`log-monitor.ts`). SIGKILL처럼 `exit`가 불리지 않는 종료는 다음 초기화가 거두며, 그 사이는 `just orphans`가 목록에 올린다. [결정: 2026-11-12 dzX]
   종료 방식별 실측 [결정: 2026-11-12 사용자]. 2026-11-12 맥에서 `createSrtPort().initialize(…, 감시 켬, 허용 목록 밖 허용)`으로 감시를 띄우고 임시 HOME(`/private/tmp/dzK2-home`)에서 시험했다. 셈은 시험이 띄운 감시 자식의 pid와 명령줄로 했다. 감시 1개로 시작해 끝난 뒤 남은 수는 다음과 같다.
   - 정상 종료(`process.exit(0)`, reset 없음): 1 → 0.
   - 정상 종료(`reset()` 뒤 `process.exit(0)`): 1 → 0.
   - SIGTERM, 호스트식 처리기(`process.once("SIGTERM")`가 `process.exit(0)`): 1 → 0.
   - SIGTERM, 처리기 없음: 1 → 0(10초 뒤에 셈). srt의 SIGTERM 처리기가 `reset()`으로 감시를 껐지만 프로세스는 10초 안에 끝나지 않아 시험기가 SIGKILL했다. 시험기가 stdin을 열어 둔 탓일 수 있어 원인은 확정하지 않았다.
   - SIGKILL(부모 사망): 1 → 1(ppid 1). `just orphans`가 이 감시를 worktree `dzK2`로 읽기 전용 목록에 올렸다(종료 0). 다음 초기화가 부모 없는 감시를 거두자 0이 됐다.
   두 번 되풀이해 같은 결과였다. srt 0.0.79는 `initialize` 안에서 `exit`, SIGINT, SIGTERM에 `reset()`을 걸므로(`sandbox-manager.js`의 `registerCleanup`), 앞의 셋에서 srt 처리기와 이 파일의 `exit` 훅 중 어느 쪽이 껐는지는 나누지 않았다. 시험하지 않은 신호는 SIGINT, 처리되지 않은 예외, 프로세스 그룹 전체 신호다. 실제 감시를 띄우는 시험은 맥 전용이고, 다음 초기화가 부모 없는 감시를 모두 끄므로 공용 `just test`에 넣지 않았다. `log-monitor.test.ts`는 같은 명령줄을 가진 가짜 자식으로 정리 로직만 본다.
6. 마지막 자가 시험이 실패했으면 `reason: "self_test_failed"`.
7. 상태는 시작 로그 한 줄과 doctor 출력에 남긴다(4.6절).

### 4.2 `wrapShell`

`wrapShell(shell, policy)`가 돌려준 `Shell`의 `exec(command, options, context)`:

1. 유효 정책 = `policy` ∪ 보호 경로 ∪ 설정 추가분(`protectedPaths.extra`, `writeRoots.extra`). 보호 경로 안의 쓰기 루트를 지운다. 읽기 거부는 `read_write` 항목만, 쓰기 거부는 모든 항목이 만든다(3.3절). basename 항목은 쓰기 루트 아래 파일로 전개해 읽기 거부 파일과 쓰기 거부 파일을 따로 만든다.
2. `policy.allowEscape`가 참이면:
   - `l0.sandbox.escapeRetry`가 참일 때만 허용한다. 아니면 `err(ExecutionError("sandbox_unavailable"))`. (격리 불가 판정과 무관하다. `onUnavailable`의 물어보기 값은 뺐다, 4.5절.)
   - 허용이면 감싸지 않고 `shell.exec`를 부른 뒤 결과에 `sandbox: { sandboxed: false, level: "none", unsandboxedBy: "escape", violations: [], violationsTruncated: false }`를 붙인다.
3. status가 불가이면 4.5절 표를 따른다.
4. 명령이 argv 배열이면 POSIX 작은따옴표 규칙으로 이어 셸 문자열 하나로 만든다(srt 입력이 문자열이다).
5. 호출마다 128비트 무작위 `commandId`를 만든다(`crypto.getRandomValues`). 위반 귀속 키이고 명령 문자열 앞 100자 비교의 교차 귀속을 피한다(`_research/notes/L0-1.md` §5, srt `WrapWithSandboxOptions.commandId` 주석).
6. `wrapWithSandboxArgv(command, "bash", customConfig, context.abortSignal, options.cwd, { commandId })`로 `{ argv, env }`를 얻는다. `customConfig`는 3.2절 변환 결과의 파일 정책이다. `binShell`에 `"bash"`를 넘기는 것은 [가정]이다(셸 경로 해석 방식 미확인).
7. 래핑이 throw하면 `err(ExecutionError("sandbox_failed", <오류 이름과 code만>))`. 이때 `cleanupAfterCommand()`를 부르지 않는다. 실행 중인 다른 샌드박스의 마운트 경로를 지우기 때문이다(`_research/notes/L0-1.md` §8 생명주기).
8. `shell.exec(argv, { ...options, env: { ...options.env, ...srtEnv } }, context)`. `srtEnv`는 srt가 돌려준 `env`에서 부모 `process.env`와 값이 같은 항목을 뺀 차이다 [가정: 반환 `env`가 전체 env인지 추가분인지 미확인. 전체라면 차이 계산이 필요하고, 차이로 하면 exec의 허용 목록 규칙을 지킨다].
9. 결과가 나오면(성공, 실패 모두) `getViolationsForCommand(commandId)`로 위반을 모아 `SandboxViolation[]`로 바꾸고(같은 `operation`·`target`은 합쳐 `count`), 최대 50개만 싣는다. 그 뒤 `cleanupAfterCommand()`를 부른다.
10. 성공 결과에 `sandbox: { sandboxed: true, level: "srt", violations, violationsTruncated }`를 붙인다. 실패(`ExecutionError`)에는 붙이지 않는다.
11. [제안: 2026-11-08] 같은 위반 기록에서 막은 것의 분류 `blocks`를 정한다. 막은 것이 하나라도 있으면 `sandbox.blocks`에 싣고(없으면 키를 두지 않는다), 같은 분류는 한 번만 싣는다. 상한은 위반과 같은 50개다. 분류는 아래 표를 따른다. 위반 기록 전체에서 만들고, `violations`의 50개 상한과 무관하다.

| 분류 `code` | 위반 기록 조건 | 싣는 것 | 판정 가능 범위 |
|---|---|---|---|
| `sandbox.network_blocked` | 프록시 거부 줄 `deny network-outbound <host>:<port> (host is on the deny list)`. 사유가 차단 목록 거부일 때만 | `domain`: 호스트(포트 뺌, IPv6는 대괄호 뺌) | macOS·Linux 모두. 프록시가 기록하므로 로그 스트림 설정과 무관하다 |
| `sandbox.write_blocked` | Seatbelt `file-write-*` 거부(macOS), seccomp 쓰기 거부 `deny <syscall> <path>`(Linux, 관찰자가 켜졌을 때만) | `path`: 경로 | macOS만 판정한다. 명령이 끝난 뒤 모으므로 늦게 도착한 줄은 빠질 수 있다(아래 요약, 10절 12번). Linux는 seccomp 관찰자를 꺼 두어(아래 표) 쓰기 거부가 기록되지 않는다 |
| `sandbox.read_blocked` | Seatbelt `file-read-data` 거부(macOS). 메타데이터 조회(`file-read-metadata`)는 셸이 흔히 시도하므로 싣지 않는다 | `path`: 경로 | macOS만. Linux 읽기 거부는 기록되지 않는다 |

분류하지 않는 것(위반 `violations`에는 남는다): 해석된 주소가 사설 대역이라 거부한 프록시 줄, 허용 목록 밖 거부, 잘못된 호스트, 직접 소켓의 Seatbelt `network-outbound` 거부(정책이 막은 호스트를 알 수 없다), 이름 없는 줄(`other`). 실패 줄의 `stderr` 글(`Operation not permitted`, `Read-only file system`, `Permission denied`)은 샌드박스 신호가 아니라 보지 않는다. 같은 글이 샌드박스 밖 원인으로도 나온다.

판정 가능 범위 요약: 네트워크 차단 목록 거부는 프록시가 응답 전에 기록하므로 두 OS에서 판정한다. 쓰기와 읽기 거부는 macOS 로그 스트림에서 오므로 macOS에서만 판정하고, 그 줄은 명령이 끝난 뒤에 나타날 수 있다. 2026-11-08 맥의 srt 0.0.79 측정에서 쓰기 거부 줄은 명령 종료 뒤 20~110ms에 보인 경우가 대부분이었고, 3초 안에 보이지 않은 경우도 한 번 있었다. 읽기 거부(보호 파일 `.env` 내용 읽기)는 같은 명령 결과에 판정되었다.

`cleanup(context)`는 아래 `shell.cleanup`을 부른다. srt `reset()`은 서비스 dispose 때 한 번 부른다.

#### 읽기 전용 프로필 [결정: 2026-11-13 사용자]

`policy.profile`이 `"read-only"`면 서브에이전트 `explore`의 bash용이다(`SandboxService.defaultPolicy({ …, profile: "read-only" })`가 이 정책을 만든다). `wrapShell`은 아래와 같이 바꿔 실행한다.

- **쓰기 루트 없음**: 정책의 `writeRoots`와 설정 `writeRoots.extra`를 쓰지 않는다. 쓰기를 허용하는 곳은 호출마다 만드는 빈 임시 폴더 하나(`<os.dirs.tmp>/ro-<commandId>`, 권한 0700)뿐이고 `TMPDIR`를 그 폴더로 돌린다. 근거: macOS의 bash 3.2 here-doc·here-string과 `sort` 같은 명령은 임시 파일을 쓴다. 이 폴더는 호출이 끝나면(성공·실패·중단 모두) 지운다. srt가 정책과 상관없이 허용하는 `/tmp/claude`, `~/.npm/_logs`, `~/.claude/debug`는 쓰기 거부 목록에 더한다. 보호 경로 읽기·쓰기 금지는 그대로다.
- **네트워크 차단**: srt의 네트워크 설정은 프로세스 전역이라 호출별로 끌 수 없다. 대신 명령 앞에서 이름에 `proxy`가 든 환경 변수(srt가 넣은 프록시 주소와 인증 토큰 포함)와 `GIT_SSH_COMMAND`, `GIT_CONFIG_PARAMETERS`, `JAVA_TOOL_OPTIONS`, `SRT_ENCODED_CMD`를 지운다. 샌드박스는 프록시 포트 밖 직접 연결을 막고(Seatbelt, Linux는 네트워크 네임스페이스) 프록시는 인증 토큰이 없는 요청을 거부하므로 이 호출은 어디에도 연결하지 못한다. 한계: 같은 사용자의 다른 프로세스 환경을 읽어 토큰을 얻는 우회는 이 프로필이 막지 못한다.
- **우회 없음**: 샌드박스를 쓸 수 없으면(사용자가 껐거나 플랫폼 미지원, `onUnavailable`이 `run_unsandboxed`여도) 실행하지 않고 `err(ExecutionError("sandbox_unavailable", "read-only sandbox is not available, so the command was not run …"))`로 거부한다. `allowEscape`는 무시한다. 호출자는 쓰기 허용 승인 흐름(L2.workspace.spec §4.3.1)을 타지 않는다.
- 확인: `sandbox.read-only.int.test.ts`(실제 srt). 맥 Seatbelt에서 `ls`, `find`, `rg`, `git log`, `git status`, `cat`은 성공하고 `touch`, `>` 리다이렉트, 공용 임시 폴더 쓰기, `curl`은 실패한다(대조로 보통 프로필의 `curl`은 프록시 응답을 받는다). 상태 폴더 `spill/tmp-*/pi-output-*.log`는 읽힌다.

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
- 샌드박스 밖 재시도(Claude Code `allowUnsandboxedCommands` 대응. srt 라이브러리 기능이 아님, `_research/notes/L0-1.md` §9)는 `l0.sandbox.escapeRetry` 기본 거짓이고, 켜도 `allowEscape: true` 호출은 항상 `escape_requested`라 승인 대상이다. 지금 코드에서 이 분기는 도달하지 않는다. `defaultPolicy`가 `allowEscape: false`를 고정하고(`packages/platform-sandbox/src/service.ts` `defaultPolicy`), 셸·MCP 호출자는 그 정책을 그대로 쓰며, 호출마다 사람 승인을 받아 `allowEscape`를 참으로 두는 흐름이 없다. 설정만 `allowEscape`에 잇으면 켠 설정이 모든 셸 호출을 승인 없이 샌드박스 밖에 두므로 잇지 않는다. 그래서 `escapeRetry`는 지금 아무 동작도 바꾸지 않는다. 샌드박스 밖으로 나가지 않고 막힌 쓰기만 푸는 흐름은 L2.workspace.spec §4.3.1이 소유한다: 샌드박스가 쓰기를 막아 명령이 실패하면(`SandboxBlock` `sandbox.write_blocked`. 위반 줄은 macOS 로그 스트림으로 늦게 오거나 오지 않을 수 있어, 실패한 명령이 거부 문구(`Operation not permitted` 등)를 출력했으면 `wrapShell`이 쓰기 거부 줄을 최대 600ms 기다린다) 호출자가 보호 경로가 아닌 경로를 사람에게 묻고, 허용이면 그 폴더를 `defaultPolicy`의 `workspaceRoots`에 더해 같은 명령을 다시 감싸 실행한다. 보호 경로는 `defaultPolicy`가 허용 루트에서 다시 빼므로 이 흐름이 풀지 못한다. [결정: 2026-11-13 사용자] [근거: `packages/cap-workspace/src/write-access.ts`, `packages/cap-workspace/src/shell/run.ts`, `packages/platform-sandbox/src/service.ts` `defaultPolicy`]
- `command`는 1차 판정에 쓰지 않는다. 명령 문자열 분석은 우회가 쉬워 보조 신호로도 쓰지 않는다(`docs/design/13-tools-and-execution.md` §3.5.2 (b) 기각).

### 4.4 자가 시험

`docs/design/18-security.md` §3.11.4를 옮긴다. 시작 때, `l0.sandbox.selfTestIntervalMin`마다, doctor 실행 때 돈다. 호출자는 조립 위치(apps/host)이고 `Shell`은 `fresnel.exec`의 것이다(8.3절). 시험용 쓰기 루트는 새 임시 디렉터리 하나다.

호출 경로 [결정: m2 마감 G1-12]: 조립 루트가 `SandboxServiceHandle.startSelfTests(shell)`을 한 번 부른다. 이 메서드가 시작 직후 `selfTest`를 한 번 돌리고, 끝날 때마다 `l0.sandbox.selfTestIntervalMin`분 뒤로 다음 실행을 `fresnel.os`의 `Scheduler`에 건다(0이면 시작 때 한 번뿐이다). 실행은 겹치지 않고, 간격은 한 실행이 끝날 때마다 설정 함수에서 다시 읽는다. 돌려주는 `SelfTestSchedule`은 `first`(첫 실행의 `Result<SelfTestReport, SelfTestRunError>`)와 `stop()`을 가진다. 항목 실패는 보고서 값(`passed: false`)이고 `status()`의 `lastSelfTest`와 `available`에 반영된다. 시험 자체가 던지면(`crashed`) 로그 `sandbox.self_test_crashed`만 남기고 반복은 계속한다. 서비스 `dispose()`가 모든 반복을 멈춘다. doctor는 `selfTest`를 직접 부른다.

| id | 시도(샌드박스 안) | 기대 |
|---|---|---|
| `protected_read_denied` | 샌드박스 밖에서 `<fresnelData>/selftest/canary`에 무작위 문자열을 쓴 뒤 안에서 `cat` | 종료 코드 0 아님, 출력에 무작위 문자열 없음 |
| `fresnel_data_write_denied` | `touch <fresnelData>/selftest/write-probe` | 실패하고 파일이 생기지 않음 |
| `network_denied` | `bash -c 'exec 3<>/dev/tcp/example.com/80'` | 실패 [가정: bash `/dev/tcp`가 두 OS에서 동작] |
| `workspace_write_allowed` | `touch <tmp>/ok` | 성공하고 파일이 생김 |
| `env_allowlist` | `env` | 출력의 이름 중 `SENSITIVE_ENV_PATTERNS`(`L0.exec.spec` §3.5)에 맞는 것이 0개. 단 srt가 자체 프록시 클라이언트용으로 내보내는 `CLOUDSDK_PROXY_PASSWORD`(프로세스마다 새로 만든 프록시 인증 토큰, srt 0.0.79)는 세지 않는다 [결정: m2 마감 G4-01, 실제 srt로 시험하면 이 이름 때문에 항상 실패했다] |
| `git_hooks_write_denied` | 밖에서 `<tmp>/.git/hooks/`를 만든 뒤 안에서 `touch <tmp>/.git/hooks/pre-commit` | 실패 |

- 하나라도 기대와 다르면 status를 `available: false`, `reason: "self_test_failed"`로 바꾸고 4.5절 정책을 적용한다.
- 자가 시험 명령은 `allowEscape: false` 정책으로 감싼다. 결과 보고에는 항목 id와 통과 여부, 실패 시 종료 코드만 싣는다. 출력 원문은 싣지 않는다.
- [결정: 2026-11-11 사용자] 마지막 보고서 전체는 `lastSelfTestReport()`로 읽는다(시각, 걸린 시간, 전체 통과, 항목마다 id·통과·사유). 사유는 `exit=<코드>`, `exec_error=<코드>`, `sensitive=<개수>`처럼 짧은 코드이고 경로와 출력 원문은 싣지 않는다. 격리를 쓸 수 없어 시험하지 못한 때는 기록하지 않는다. wire `sandbox.lastSelfTest`가 이 값을 읽고 `sandbox.selfTest`가 지금 한 번 돌린다(F.wire-settings §3.3.1).
- [결정: 2026-11-11 사용자] 예약 시험과 사람이 누른 시험은 같은 `<fresnelData>/selftest/`를 쓰므로 한 번에 하나씩 돈다. 먼저 온 실행이 끝나야 다음 실행이 시작한다. 앞 실행이 실패해도 다음 실행은 돈다.
- 시험 뒤 `<fresnelData>/selftest/`와 임시 디렉터리를 지운다.

### 4.5 격리 불가 시 동작

`l0.sandbox.onUnavailable`(기본 `disable_execute` [제안, 18 R-10 계승]). 값은 두 개다 [결정: 2026-11-11 사용자]:

| 값 | `wrapShell`의 `exec` | L1 tools가 할 일(요구) |
|---|---|---|
| `disable_execute` | `err(ExecutionError("sandbox_unavailable"))` | 셸 실행 도구(`bash`)를 모델에 광고하지 않는다 |
| `run_unsandboxed` | 감싸지 않고 실행, `sandbox.unsandboxedBy: "run_unsandboxed"` | 실행은 허용. 도구 결과와 화면에 격리 없음 표시 |

- `ask`(물어보기)는 뺐다 [결정: 2026-11-11 사용자]. 이전 값은 `allowEscape: true`로 다시 부르는 승인 흐름을 전제했지만 그 흐름이 없어(L1 tools에 호출 단위 승인이 없고, 생산 코드의 `defaultPolicy`는 `allowEscape: false`를 고정한다, 4.3절) 실제로는 `disable_execute`와 같은 거부였다. 승인 흐름(호출 단위 정책 재정의와 승인 포트)을 설계한 뒤 값을 다시 더한다.
- 저장된 `l0.sandbox.onUnavailable = "ask"`는 설정 엔진이 무효 값으로 보고 건너뛰어 기본값 `disable_execute`(막기)로 읽는다. 설정 파일은 고치지 않는다. 같은 규칙으로 관리 범위(managed)의 옛 `ask`도 무효가 되어 사용자 범위의 값이 대신 적용될 수 있다 [미결: 관리 범위의 옛 값을 막기로 읽을지 정한다. 지금은 건너뛴다] [근거: `packages/contracts/src/wire-settings/settings/effective.ts` `resolveSetting`의 무효 값 건너뛰기].

- `l0.sandbox.enabled = false`(reason `disabled`)는 사용자가 명시적으로 끈 상태다. `run_unsandboxed`와 같이 실행하고 `unsandboxedBy: "disabled"`를 붙인다 [제안]. 시작 로그와 doctor에 경고를 남긴다.
- Windows 네이티브, WSL1, 지원 밖 아키텍처는 `unsupported_os`로 이 표를 따른다. 기본값에서는 셸 실행 도구가 꺼지므로 격리 없이 조용히 실행되는 경로가 없다.
- 격리 없이 실행한 호출의 감사 기록(18의 `tools.sandbox_disabled`에 해당)은 이벤트가 필요하다. `platform-sandbox`는 이벤트 type을 소유하지 않으므로(`eng.context-map.design` §4.1) 소유자는 [미결]이다(10절 2번). 1차는 `ShellExecResult.sandbox.unsandboxedBy`를 L1 tools가 도구 결과 details에 남기는 것으로 대신한다.

### 4.6 doctor와 시작 로그

- F 순수 함수 `describeSandboxStatus(status): SandboxStatusSummary`(3.1절)를 쓴다. `ok`: available. `warn`: `disabled` 또는 `run_unsandboxed`로 실행 중. `critical`: 그 밖의 불가 상태.
- `missing_dependency`의 `hints`는 `status.installHints`(provider의 `installHint`)다. 이 상태는 환경 문제이므로 `fresnel doctor`가 종료 코드 2 계열로 보고하는 것을 `L4.cli.spec`에 요구한다 [제안].
- 시작 로그: `sandbox level=<level> platform=<platform> available=<bool> reason=<reason> onUnavailable=<value>` 한 줄.

### 4.7 감싸는 범위

- 감싸는 것: bash 계열 셸 명령과 그 자식 프로세스(`wrapShell`을 거친 `Shell.exec`), 켠 stdio MCP 서버 프로세스(`wrapArgv`, 4.9절).
- 감싸지 않는 것: 파일 도구(read, write, edit, grep 중 in-process 구현), 웹 도구, 출처 판정으로 끈 로컬 MCP 서버(4.8절), 확장 코드 자체(`_research/refs/claude-code.md` §3.2, `_research/notes/L0-1.md` §0 8번). 그래서 파일 도구는 realpath 기준 보호 경로 검사를 L1·L2에서 해야 한다(18 R-12, 8.3절 요구).
- MCP stdio 서버 프로세스는 §4.8의 출처별 판정으로 정한다. 켬이면 서버 프로세스의 명령줄을 `wrapArgv`(4.9절)로 받고, 호출자가 스트림을 연다.

### 4.8 MCP stdio 서버와 중첩 네임스페이스

[결정: review.m3-design-inputs D-M3-19 행 1, M3-REQ-57·56]

- `decideMcpStdioSandbox(source, serverSetting)`(`src/mcp-stdio.ts`)가 서버 정의 출처(`L2.mcp.spec` §3.1 `source`)로 격리 여부를 정한다. `settings:user`는 끔이고 `settings:project`, `mcpjson:fresnel`, `ext:<이름>`, 알 수 없는 출처(M5g-2 뒤 나오지 않는 `mcpjson:project` 포함)는 켬이다. 서버별 설정 값(참·거짓)이 있으면 출처 기본값보다 우선한다. 알 수 없는 출처를 켬으로 두는 것은 [결정: 오케스트레이터 기본값]이다.
- `shellForMcpStdio(service, shell, policy, decision)`은 켬이면 `service.wrapShell(shell, policy)`, 끔이면 받은 `shell`을 돌려준다. 격리를 쓸 수 없는 상태의 처리는 §4.5가 그대로 정한다. 서버별 설정 키와 호출은 `L2.mcp.spec`이 가진다(B3-SEC). `platform-process`의 MCP stdio 띄우기는 이 함수 대신 `wrapArgv`(4.9절)를 쓴다.
- 브라우저 provider는 샌드박스 셸 안에서 자체 샌드박스를 띄우려고 중첩 사용자 네임스페이스가 필요하다. 설정 `l0.sandbox.nestedNamespaces`를 켜면 srt `enableWeakerNestedSandbox`가 참이 된다. 기본은 거짓이고 `restart` 반영이다. 켠 상태는 시작 로그에 경고로 남긴다 [제안]. 중첩 허용 때문에 쓰기 거부가 약해질 수 있어(`_research/notes/L0-1.md` §3.6) 브라우저를 쓰지 않는 사용자는 켜지 않는다.
- `tool.sandbox_bypassed`(샌드박스 밖 실행 감사 이벤트)의 소유자는 L1 tools(`tool.` 접두)이다 [결정: 오케스트레이터 기본값, 10절 2번의 후보 채택]. `platform-sandbox`는 `ShellExecResult.sandbox.unsandboxedBy`만 돌려주고 이벤트를 내지 않는다.

### 4.9 wrapArgv

`wrapArgv(policy, request, context)`는 stdio MCP 서버처럼 오래 사는 프로세스를 위한 메서드입니다. `wrapShell`은 `Shell.exec`가 끝난 뒤에야 결과를 돌려주므로 프로세스의 입출력 스트림을 호출자에게 넘기지 못합니다. `wrapArgv`는 감싼 명령줄(`argv`), env 추가분, `cleanup`을 돌려주고, 호출자가 `argv`를 자기 파이프 스트림으로 직접 spawn합니다. 판정과 변환은 `wrapShell`과 같은 함수를 씁니다.

처리 순서는 다음과 같습니다.

1. `context.abortSignal`이 이미 중단되었으면 `err({ kind: "aborted" })`를 돌려줍니다.
2. 탈출과 격리 불가 판정은 4.2절 2~3단계와 4.5절 표를 그대로 따릅니다. 거부하면 `err({ kind: "unavailable", reason })`를 돌려주고, `reason`은 `status().reason`입니다. 격리가 가능한 상태에서 거부된 탈출 요청은 `reason`이 없습니다. 실행을 허락하는 경우(`disabled`, `run_unsandboxed`, 승인된 `escape`)는 감싸지 않고 `ok({ argv: [command, ...args], env: {}, sandboxed: false, unsandboxedBy, cleanup })`를 돌려줍니다. 이때 `cleanup`은 아무 일도 하지 않습니다.
3. 그 밖의 경우 4.2절 1단계(정책 병합)와 4·6·7단계를 따릅니다. 정책을 srt 파일 설정으로 바꾸고 명령을 래핑하는 일은 `wrapShell`과 같은 함수(`srtWrap`)가 합니다. 명령은 `[command, ...args]`를 POSIX 작은따옴표 규칙으로 이은 셸 문자열 하나이고, `binShell`은 `"bash"`입니다. 상대 경로의 기준은 `cwd`가 절대 경로일 때 그 값이고, 아니면 `/`입니다. 정책의 `network.allowedDomains`가 비어 있지 않으면 `err({ kind: "failed" })`입니다. 네트워크는 `wrapShell`과 같이 서비스의 차단 목록 정책을 따릅니다. 래핑이 throw하면 `message`에는 오류의 이름과 code만 싣고, `cleanupAfterCommand()`는 부르지 않습니다.
4. 성공하면 `ok({ argv, env, sandboxed: true, cleanup })`를 돌려줍니다. `argv`는 srt가 돌려준 값입니다. `env`는 srt가 돌려준 env에서 부모 env와 값이 같은 항목을 뺀 차이입니다(4.2절 8단계). `cleanup()`은 `cleanupAfterCommand()`를 한 번만 부릅니다. 여러 번 불러도 한 번만 실행합니다.
5. 호출자는 `argv`를 spawn하고, 프로세스가 끝났거나 spawn이 실패하면 `cleanup()`을 부릅니다. 여러 장수 프로세스의 정리 시점이 겹치는 문제는 10절 11번의 [미결]입니다.

위반 기록은 모으지 않습니다. 그래서 결과에 `sandbox` 보고가 없고, 수집 방식은 10절 10번의 [미결]입니다.

#### 쓰기 없음 프로필과 읽기 허용 목록 [결정: 2026-11-18 메인 제안, 사용자 보고됨]

`policy.profile`이 `"no-write"`면 플러그인 호스트처럼 오래 사는 프로세스를 "쓰기 없음, 읽기는 허용 목록, 네트워크는 정책 그대로"로 감쌉니다. 읽기 전용 프로필(4.2절)과 다른 점은 네트워크를 막지 않고 읽기가 허용 목록이라는 것입니다. 이전에 플러그인 호스트가 쓰던 쓰기 거부 `/` 우회책은 없앴습니다.

- **쓰기**: 정책의 `writeRoots`와 설정 `writeRoots.extra`를 쓰지 않습니다. srt가 정책과 상관없이 허용하는 `/tmp/claude`, `~/.npm/_logs`, `~/.claude/debug`는 쓰기 거부 목록에 더합니다(읽기 전용 프로필과 같습니다). 쓸 수 있는 곳은 `wrapArgv`가 호출마다 만드는 이 프로세스 전용의 빈 임시 폴더 `<os.dirs.tmp>/nw-<commandId>`(권한 0700) 하나뿐이고 읽기도 됩니다. 다른 프로세스와 나누지 않으며 `cleanup`이 지웁니다. 폴더 경로는 정규 경로(realpath)로 풀어 `TMPDIR`와 쓰기 허용에 씁니다: macOS의 임시 폴더(`/var/folders/...`)는 `/private/var/folders`로 가는 링크 아래라서 풀지 않으면 Seatbelt가 정규 경로로 비교하는 쓰기 허용에 닿지 않아 `EPERM`이 난다(실제 엔진의 플러그인 호스트 시험으로 발견, 2026-11-19, AGE-58 후속). 읽기 전용 프로필의 `ro-` 폴더(`wrapShell`)에도 같은 처리를 한다(임시 폴더 기반이 링크 아래일 때 `TMPDIR` 쓰기가 되는지 실제 샌드박스 시험 `sandbox.read-only.int.test.ts`로 확인, 2026-11-19, AGE-58 후속 enK6). 명령은 `export TMPDIR=<폴더>; exec <명령>`으로 감쌉니다. srt가 env로 정한 `TMPDIR=/tmp/claude`를 덮으려면 셸 안에서 정해야 합니다. 폴더를 만들지 못하면 `err({ kind: "failed" })`입니다.
- **읽기**: `srt`에 `denyRead: ["/", ...보호 경로]`와 `allowRead: readAllow`를 넘깁니다. `readAllow`는 호출자가 준 경로(`defaultPolicy`의 `readRoots`: 플러그인 폴더, 실행 파일)에 아래 시스템 경로를 더한 목록입니다. 심볼릭 링크 이름(`/lib`, `/usr/bin/socat`)은 실제 경로만으로는 열리지 않으므로 이름과 실제 경로를 둘 다 둡니다. 셸은 사용자 `PATH`의 bash가 아니라 `/bin/bash`를 씁니다(허용 목록에 들어가야 하므로).
- **시스템 경로**(실제 샌드박스에서 하나씩 빼 보며 좁힌 목록, `platform-sandbox/src/runtime-read-paths.ts`): macOS는 `/usr/share/icu`(Bun의 ICU 데이터, 없으면 소스 실행의 Bun이 시작 직후 죽는다) 하나입니다. 컴파일된 호스트 바이너리는 실행 파일 하나라 이것도 없이 뜹니다. Linux는 `/bin/bash`(srt가 샌드박스 안에서 돌리는 셸), `/lib`, `/lib64`, `/usr/lib`, `/usr/lib64`(동적 링커와 공유 라이브러리)이고 서비스가 srt 도우미를 더합니다: srt 패키지의 `vendor/seccomp`(seccomp 실행 파일), 프록시 소켓 파일(srt가 최상위 폴더를 빈 tmpfs로 덮으므로 허용 목록에 없으면 프록시 연결이 끊긴다), 탐지한 `socat`의 실제 파일(`socat`이 `socat1` 링크인 배포판이 있다. srt에 넘기는 `socatPath`도 같은 실제 경로로 푼다). 인증서 묶음과 DNS 설정은 넣지 않습니다: https는 샌드박스 프록시를 거치고(TLS 인증서는 Bun에 내장) 이름 풀이는 프록시가 합니다.
- **한계**: 소스 실행(개발)의 호스트는 진입 파일이 가져오는 소스와 `node_modules`를 읽어야 해서 호출자가 `readRoots`에 소스 작업 공간(`bun.lock`이 있는 폴더)을 더합니다. 읽기 허용 목록 항목이 보호 경로와 겹치면 항목이 빠집니다. 예외는 Fresnel 데이터 폴더(`fresnel_data`)뿐입니다: 그 안쪽 항목(검토본 사본 `<data>/plugin-store/reviewed/<이름>/<해시>/tree`)은 남고, 데이터 폴더 전체를 품은 넓은 항목은 빠집니다(`PolicyInput.carvableReadDeny`, 시험 `policy.test.ts`, `helm-isolated.int.test.ts`의 실제 샌드박스 시험 [결정: enC3m, 검토본에서 격리 플러그인이 떠야 해서 [제안]]). 플러그인 폴더가 설정 `extra`에 적힌 경로처럼 읽기를 막는 보호 경로 아래면 호스트가 자기 코드를 읽지 못합니다. 쓰기만 막는 자격 폴더(`~/.claude` 등)는 읽기 허용 목록을 빼지 않는다 [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"]. Linux x64는 실행해 보지 못했고(arm64 Docker에서만 확인) `/lib64`(x64 로더 위치)는 이 목록의 추측이 아닌 일반 규칙이지만 실측은 아닙니다.
- **스크립트 실행기의 시스템 도구 읽기·실행**(AGE-58, [결정: 2026-11-19, 사용자, AGE-58 "다 열어"], 해석은 [제안]): 스크립트 실행기(`IsolationSpawnSpec.systemTools: true`, 다른 프로필·훑기 자식·플러그인 격리 프로세스는 켜지 않는다)에만 `defaultPolicy`의 `systemTools`가 읽기·실행 허용에 아래를 더한다. 쓰기는 하나도 더하지 않는다. `/usr`, `/private/var`, `/etc`, `/Library`, 홈은 통째로 열지 않는다(`/var`를 하위까지 열면 `/private/var`가 통째로 열려서 시험으로 막았다). 구현은 `runtime-read-paths.ts`의 `systemToolReadPaths`, `systemToolLiterals`, `systemToolDeny`, `systemToolMachDeny`와 `wrap-argv.ts`의 프로필 끝 덧붙이기(`withProfileTail`)다.
  - macOS 읽기·실행(`readAllow`): `/bin`, `/usr/bin`(요청), `/private/var/select`(`/usr/bin/git` 같은 개발자 도구 껍데기가 읽는 선택 링크 `developer_dir`와 `sh`, 링크 둘뿐이다), 선택한 개발자 폴더의 `usr`와 `SDKs`(링크가 가리키는 곳을 지금 읽어 정한다: Command Line Tools면 `/Library/Developer/CommandLineTools`, 진짜 `git`과 라이브러리, 껍데기가 SDK를 찾는다), `/private/etc/ssl`(`curl`의 LibreSSL이 시작할 때 읽는 `openssl.cnf`와 CA 묶음, 없으면 `Auto configuration failed`로 끝난다), `/System/Library/CoreServices/SystemVersion.plist`(`xcrun`과 `sw_vers`가 호스트 OS 버전을 읽는다).
  - macOS 이름 하나만(`readAllowLiteral`): `/var`(`/private/var`로 가는 링크 자체), `/etc`(`/private/etc`로 가는 링크 자체), `/private/etc/gitconfig`(`git`이 시스템 설정을 열어 본다. 없는 파일인데 `EPERM`이면 `git`이 죽는다), 선택한 개발자 폴더 자체(껍데기가 `developer directory ... is not accessible`로 확인한다). `/etc/hosts`, `/etc/passwd`, `/private/var/db`, `/var/folders`, `/Library/Preferences`는 여전히 막혀 있다.
  - macOS 다시 막기(`toolDeny`, 프로필 끝의 `deny file-read*`와 `deny process-exec`): `launchctl`, `open`, `osascript`, `osacompile`, `security`, `pbcopy`, `pbpaste`, `screencapture`, `defaults`, `mdfind`, `mdls`, `log`, `lsof`, `ps`, `top`, `sudo`, `su`. 이유는 `runtime-read-paths.ts`의 `DARWIN_TOOL_DENY` 주석이다. 넓히기 전의 시험에서 `launchctl print`(사용자 launchd 도메인 읽기, 제출·삭제 요청이 launchd까지 닿는다), `security`(로그인 키체인 질의가 SecurityServer까지 닿아 "없음"이 아니라 검색이 일어났다), `mdfind`, `lsof -p 다른 프로세스`는 절대 경로로 이미 돌았다(넓히기와 무관한 기존 구멍이다). 이제 모두 실행 자체가 막힌다(종료 코드 126).
  - macOS Mach 서비스 막기(`machDeny`): `com.apple.SecurityServer`, `com.apple.securityd.xpc`(키체인 데몬), `com.apple.coreservices.launchservicesd`(LaunchServices)와, 우회 시험(아래)에서 열려 있음이 확인되어 더한 `com.apple.lsd.mapdb`(LaunchServices 데이터베이스 읽기: 설치된 앱 조회), `com.apple.PowerManagement.control`(잠자기 요청과 방지), `com.apple.distributed_notifications@Uv3`(다른 앱이 듣는 배포 알림), `com.apple.audio.systemsoundserver`(시스템 소리). 기본 프로필이 열어 둔 서비스를 도구를 거치지 않는 호출(Security 프레임워크를 부르는 스크립트)도 못 쓰게 한다. 닫으면 `bun`, `node`, `python3`, `sh`, `git`, `curl`이 그대로 도는 것을 확인했다. **열어 두는 서비스**(닫으면 `os.userInfo()`, python `pwd`·`getpass`, `git`의 작성자 조회가 깨진다): `com.apple.system.opendirectoryd.libinfo`와 `.membership`(사용자·그룹 이름 조회: 이 컴퓨터의 로컬 계정 목록과 그룹 소속이 `dscacheutil -q user`, `id root`로 읽힌다), `com.apple.system.notification_center`(notifyd), `com.apple.logd`, `com.apple.system.logger`, `com.apple.bsd.dirhelper`, `com.apple.fonts`.
  - macOS 시스템 정보 막기(`systemInfoDeny: true`, 프로필 끝 규칙은 `wrap-argv.ts`의 `SYSTEM_INFO_RULES`): `(deny process-info*)` 뒤에 자기 프로세스와 같은 샌드박스 안 프로세스만 다시 허용하고, 프로세스 표·인자·환경 변수를 주는 `sysctl`(`kern.proc.all`, `kern.proc.pgrp.`, `kern.proc.pid.`, `kern.procargs`), IOKit 레지스트리 속성(`iokit-get-properties`: 시리얼 번호, 하드웨어 UUID), 전원 관리 사용자 클라이언트(`RootDomainUserClient`), 배포 알림 보내기(`distributed-notification-post`)를 막는다. 근거: 이 길들은 srt 기본 프로필이 열어 두었고, 도구를 막아도(`ps`, `lsof`, `ioreg`) `bun:ffi`나 `ctypes`로 직접 부르면 열렸다(우회 시험의 "전" 열). 이 규칙은 `systemTools`를 켠 스크립트 실행기에만 적용한다.
  - 읽기 허용 이름에 더한 것: `/System/Library/OpenSSL/openssl.cnf`(`node`가 시작할 때 읽는다. 없이는 `OpenSSL configuration error`로 `node`가 시작 직후 끝나서 `node` 실행기가 샌드박스 안에서 아예 돌지 않았다), `/dev/null`(`cat`이 표준 출력의 정보를 읽는다. 없이는 `cat > /dev/null`이 `Operation not permitted`로 실패했다).
  - **덧붙이기가 실패하면 스크립트를 띄우지 않는다**(fail-closed): 프로필 끝에 규칙을 덧붙이는 방식은 srt가 만든 `sandbox-exec -p '…'` 문자열의 모양에 기댄다. Seatbelt인데 (가) 경로나 서비스 이름에 따옴표·역슬래시·줄바꿈이 있거나 상대 경로라서 규칙을 만들 수 없거나, (나) 프로필 문자열을 찾지 못하거나 닫는 따옴표가 없거나, (다) 덧붙인 뒤 표지(`; script tools`)가 정확히 한 번이 아니면 `wrapArgv`는 규칙을 빼고 계속하지 않고 `err({ kind: "failed", message })`를 돌려주고 srt가 만든 것을 되돌린다(`cleanup`, 임시 폴더 삭제). 시험: `wrap-argv.test.ts`(여섯 가지 안전하지 않은 값, 문자열 모양 변경, 닫히지 않는 따옴표). Seatbelt가 아닌 제공자(bwrap, 격리 없음)는 이 덧붙이기를 쓰지 않으므로 그대로 둔다.
  - Linux(bwrap): `/bin`과 `/usr/bin`을 더한다(라이브러리는 `/lib*`, `/usr/lib*`가 이미 연다). `toolDeny`, `machDeny`, `systemInfoDeny`, `readAllowLiteral`은 Seatbelt 전용이라 Linux에서는 무시한다. **이 맥에서 실행해 확인하지 못했다. 아래 표는 srt 0.0.79 `linux-sandbox-utils.js`와 이 패키지의 코드를 읽은 것이다.**

    | 맥에서 막은 것 | Linux(bwrap)가 막는 방식(코드로 읽음) | 대응이 없는 것 |
    |---|---|---|
    | 다른 프로세스 목록·인자·환경 변수, `ps`, `lsof` | `--unshare-pid`와 새 `/proc`(`--proc /proc`)이라 샌드박스 안 프로세스만 보인다. 단 srt의 `enableWeakerNestedSandbox`가 켜지면 `--bind /proc /proc`로 호스트 `/proc`이 열린다(이 서비스는 켜지 않는다) | 도구 개별 막기는 없다(`ps`는 돈다. 자기 프로세스만 보인다) |
    | 폴더 밖 읽기 | 루트를 빈 tmpfs로 덮고 허용 항목만 다시 연다 | — |
    | 키체인·클립보드·화면·다른 앱 조작·앱 실행(서비스) | 대응하는 Mach 서비스가 없다. 같은 일을 하는 데스크톱 서비스(D-Bus, X11/Wayland, 시크릿 서비스)는 유닉스 소켓인데, 파일은 tmpfs로 가려지고 `seccomp`이 `socket(AF_UNIX)`을 막는다 | `seccomp` 실행 파일이 없으면 srt가 "유닉스 소켓 막기 꺼짐" 경고만 내고 계속한다. 이 서비스는 그 경고를 막지 않는다 → **유닉스 소켓이 열린 채 도는 길이 있다** |
    | IOKit 속성(시리얼 번호) | `--dev /dev`로 최소 장치만 두고 `/sys`는 읽기 허용 목록에 없다. 단 `/sys/class/dmi/id`가 목록에 들어가면 열린다 | `systemInfoDeny`에 해당하는 규칙 없음 |
    | 전원 관리·소리·배포 알림 | 서비스 소켓이 가려진다 | 개별 규칙 없음 |
    | `launchd` | 없음(systemd 사용자 서비스는 D-Bus/소켓이라 위와 같다) | `systemctl --user`는 소켓이 없어 실패하지만 `seccomp`이 꺼진 경우의 시험이 없다 |
    | 막은 도구(`security`, `launchctl`, `osascript`, `open`, `sudo`, `su`) | 도구 개별 막기 없음. `/usr/bin`이 열려 있어 `xdg-open`, `loginctl`, `systemctl`이 실행된다(소켓·`/proc`이 막혀 일을 못 한다고 코드는 말하지만 확인하지 못했다). `sudo`·`su`는 사용자 이름공간 안이라 권한이 오르지 않는다 | **도구 실행 막기가 Linux에는 없다** |
    | `/dev/null`·OpenSSL 설정 읽기 | `--dev /dev`가 `/dev/null`을 준다. OpenSSL 설정은 `/etc`가 가려져서 파일이 없다(`EPERM`이 아니라 `ENOENT`라 `node`가 시작한다고 코드는 말한다) | — |

    맥에서 막은 것 가운데 Linux에 대응이 없는 목록: (1) 도구 개별 실행 막기(`toolDeny`), (2) Mach 서비스 막기(`machDeny`: Linux에는 해당 서비스가 없고 소켓은 seccomp이 막는다), (3) `systemInfoDeny`의 네 가지(프로세스 정보는 PID 이름공간이 막지만 IOKit 속성·전원 관리·배포 알림은 개별 규칙이 없다), (4) 덧붙이기 실패 시 시작 거절(Linux는 덧붙이기를 쓰지 않아 해당 없음), (5) 우회 시험(`script-bypass.int.test.ts`)은 맥에서만 돈다(`process.platform === "darwin"`). 추측으로 고치지 않았다.
  - **실행기 `python3`의 설치 폴더 읽기**(AGE-58 마무리, [결정: 2026-11-19, 사용자, AGE-58 "1-다 2-가"], 해석은 [제안]): 파이썬은 표준 라이브러리와 공유 라이브러리가 든 설치 폴더를 읽어야 시작한다. 그래서 실행기 `python3`만 읽기 허용(`IsolationSpawnSpec.runtimeReadRoots`)에 설치 폴더를 더한다. 쓰기는 더하지 않는다(그래서 `PYTHONDONTWRITEBYTECODE=1`을 스크립트 환경에 준다).
    - 가장 좁게 연다. 엔진이 실행기를 풀 때(`apps/host/src/assembly/python-runtime.ts`) 샌드박스 밖에서 PATH의 `python3`에 고정 인자(`-I -S -c`)로 한 번 물어 `sys.executable`, `sys.base_prefix`, `sys.base_exec_prefix`, `sys.prefix`를 받는다. 읽기로 여는 것은 `base_prefix`와 `base_exec_prefix`(보통 같은 폴더 하나)이고, 가상환경이면 그 `pyvenv.cfg` 파일 하나를 더한다(가상환경의 `site-packages`는 열지 않는다). 사용자 홈, 설치 폴더의 윗 폴더, 다른 설치(다른 버전, 다른 버전 관리자 폴더)는 열지 않는다. 접두 폴더가 없거나 절대 경로가 아니거나 `/` 바로 아래 한 단계뿐이면 열지 않고 실행기를 `runner_unavailable`로 답한다. 접두 폴더가 사용자 홈 폴더이거나 홈을 품는 폴더면(`--prefix=$HOME`으로 지은 인터프리터) 홈 전체가 읽기로 열리므로 거절하고 실행기는 `runner_unavailable`이다(홈 아래의 설치 폴더는 그 폴더만 연다) [제안, 오케스트레이터].
    - shim을 풀어 쓴다. PATH의 `python3`가 mise나 pyenv shim이면 실행 파일은 shim이 아니라 인터프리터가 알려 준 `sys.executable`이다(shim은 다른 파일을 부르는 껍데기라서 샌드박스 안에서 설치 폴더를 못 찾는다). 가상환경이 아니면 그 실행 파일의 실제 경로를 쓰고, 가상환경이면 링크 경로 그대로 쓴다(가상환경으로 인식하려면 필요하다).
    - macOS `/usr/bin/python3` 껍데기는 같은 방법으로 개발자 도구 폴더의 실제 인터프리터(`.../Developer/Library/Frameworks/Python3.framework/Versions/3.9`)로 풀리므로 `xcrun` 캐시를 쓰려다 실패하는 길은 피한다. 다만 Apple의 Python 3.9는 난수를 만들려고 `/dev/urandom`을 읽는데 이 프로필은 그것을 열지 않아서 `Fatal Python error: _Py_HashRandomization_Init`으로 시작하지 못한다(`/dev/urandom` 하나를 더하면 돌아가는 것을 시험으로 확인하고 되돌렸다). 이 한 줄은 모든 스크립트 실행기에 더해지는 범위 넓힘이라 사용자의 결정(설치 폴더 읽기) 밖이므로 열지 않았다. 개발자 도구 파이썬이 필요하면 mise나 Homebrew 같은 파이썬을 PATH 앞에 둔다. [제안]
    - 연 탓에 새로 읽히는 것은 종류로 이것이다: 그 설치 폴더 안의 표준 라이브러리, 실행 파일, 공유 라이브러리, 헤더, 그리고 그 설치의 `site-packages`(`pip`로 깐 패키지의 소스와 메타데이터)다. 값은 읽지도 출력하지도 않았다. 설치 폴더의 윗 폴더와 다른 설치는 시험으로 막혀 있음을 확인했다(`script-python.int.test.ts`).
    - 연 뒤에도 막혀 있는 것(시험 `script-python.int.test.ts`, 실제 샌드박스): 플러그인 폴더 밖 파일 읽기, 홈 폴더 읽기와 목록, 플러그인 폴더·폴더 밖·설치 폴더·`/etc`에 쓰기, `/etc/passwd` 읽기, 막은 도구(`security`, `launchctl`, `osascript`, `pbpaste`)의 실행(이름으로, 절대 경로로, `env`와 `sh -c`를 거쳐서). `ctypes`로 `bun:ffi` 시험과 같은 것을 했다: 막은 Mach 서비스 열두 개 조회는 모두 `1100`, 다른 프로세스의 목록·경로·작업 폴더·열린 파일은 막힘, 키체인 조회는 데몬에 닿지 못함, 자기 프로세스 정보만 읽힘. 훅 스크립트가 표준 입력의 JSON을 읽고(`json`, `sys`, `re`, `os`) `jq`와 `git --version`을 `subprocess`로 불러 결정을 낸다. 가져온 `.py` 훅의 끝까지 시험은 `migration-hook-run.int.test.ts`다.
  - **막지 못한 길**(우회 시험의 결론, 2026-11-19, enK6):
    - `launchd`(맥의 작업 관리자)에 부트스트랩 포트로 직접 말하는 길은 프로필로 막을 수 없다. 시험(막은 `launchctl`만 임시로 풀어 같은 샌드박스에서 돌렸다): `print user/<uid>`가 서비스 목록 1,524줄을 돌려주고(밖에서 돌린 것과 같다), `kickstart`·`bootout`·`blame`이 launchd까지 닿아 "그런 서비스 없음"이라는 launchd의 답을 받았고(권한 오류가 아니다), 내용 없는 작업 파일의 `bootstrap`은 밖에서와 같은 launchd의 오류(`5: Input/output error`)로 끝났다. 즉 조회뿐 아니라 시작·중지·등록 요청이 launchd에서 처리된다. 스크립트가 쓸 수 있는 임시 폴더에 작업 파일을 쓰고 등록하면 샌드박스 밖에서 도는 작업이 생길 수 있다. 지금 이 길을 막는 것은 `launchctl` 실행 막기 하나뿐이다. 네이티브 호출(`bun:ffi`, `ctypes`)이 launchd의 비공개 통신 규약을 직접 쓰면 돌아간다. 이 규약 호출은 구현하지 않았고(작업 등록 위험) 따라서 네이티브 경로는 "확인 불가, 열린 것으로 취급"이다. [결정: 2026-11-19, 사용자, AGE-58 "1-다 2-가"] 이 길은 지금대로 두고 승인 카드의 "코드 실행" 안내와 사용자의 승인에 기댄다. 더 강하게 격리된 별도 프로세스로 스크립트 실행기를 띄우는 것은 후속 이슈로 설계한다(10절 14번).
    - 네트워크는 2026-11-17 결정대로 열려 있다(프록시 주소와 인증 값이 자식 환경에 오고 전역 정책이라 이 프로필에서 따로 막지 못한다).
    - 로컬 계정 목록·그룹 소속(`libinfo`), notifyd(알림 상태 읽기와 보내기), `logd`(로그 쓰기), POSIX 공유 메모리 이름 공간(`ipc-posix-shm`), IOKit 레지스트리의 기기 종류·클래스 이름 목록(속성 값은 막았다), 같은 샌드박스 안에서 만든 프로그램의 실행(임시 폴더에 쓴 스크립트와 컴파일한 실행 파일이 돈다. 같은 프로필 아래라서 밖으로 나가지는 않는다)은 열려 있다.
  - **우회 시험 표**(실제 샌드박스, `apps/host/test/int/script-bypass.int.test.ts`와 시험용 임시 틀. "전"은 이 커밋 전의 프로필, "후"는 이 커밋): 막힘 = 샌드박스가 거부함, 열림 = 값이 돌아옴. 값은 읽지 않았고 종류만 적는다.

    | 길 | 전 | 후 | 열렸던 것이 새는 정보 |
    |---|---|---|---|
    | 키체인(`SecKeychainFindGenericPassword`, 없는 항목) | 막힘(`-50`, "항목 없음" `-25300`이 아니다) | 막힘 | — |
    | 클립보드(`com.apple.pasteboard.1` 조회, `PasteboardCreate`) | 막힘 | 막힘 | — |
    | 화면 캡처·창 서버(`windowserver.active`, `CARenderServer`, `replayd`) | 막힘 | 막힘 | — |
    | 다른 앱 조작(`coreservices.appleevents`) | 막힘 | 막힘 | — |
    | 앱 실행(`launchservicesd`, `lsd.open`, `lsd.modifydb`) | 막힘 | 막힘 | — |
    | LaunchServices 데이터베이스(`lsd.mapdb`) | **열림** | 막힘 | 설치된 앱과 문서 형식 |
    | Spotlight(`metadata.mds`) | 막힘 | 막힘 | — |
    | 사용자 기본 설정(`cfprefsd.*`, `CFPreferencesCopyAppValue` 다른 앱) | 막힘(`null`) | 막힘 | — |
    | 개인정보 서비스(`tccd`, 위치, 연락처) | 막힘 | 막힘 | — |
    | 다른 프로세스 목록(`proc_listallpids`, `sysctl kern.proc.all`) | **열림**(약 700개) | 막힘 | 실행 중인 프로세스 전체 |
    | 다른 프로세스의 인자와 환경 변수(`sysctl kern.procargs2`) | **열림** | 막힘 | 같은 사용자 프로세스의 명령줄과 환경 변수(시크릿이 들어 있을 수 있다) |
    | 다른 프로세스의 경로, 작업 폴더, 열린 파일(`proc_pidpath`, `proc_pidinfo`) | **열림** | 막힘 | 실행 파일 경로, 작업 폴더, 열린 파일 목록 |
    | IOKit 속성(`ioreg`, `IORegistryEntryCreateCFProperty`) | **열림**(`ioreg`에서 시리얼 번호가 읽혔다) | 막힘(속성). 레지스트리 이름 목록은 열림 | 기기 시리얼 번호, 하드웨어 UUID |
    | 전원 관리(`PowerManagement.control`, `IOPMrootDomain` 열기) | **열림**(연결이 열렸다) | 막힘 | 잠자기 요청, 잠자기 방지 |
    | 배포 알림 보내기(`distributed_notifications`) | **열림** | 막힘 | (보내기) 다른 앱에 알림 |
    | 시스템 소리(`audio.systemsoundserver`) | **열림** | 막힘 | (재생) |
    | 사용자·그룹 조회(`libinfo`, `id`, `dscacheutil`) | 열림 | 열림 | 로컬 계정 이름 목록, 그룹 소속 |
    | `launchd` 부트스트랩 포트(`launchctl`을 임시로 풀고 시험) | **열림**(조회, 시작, 중지, 등록 요청이 처리된다) | 열림. 프로필로 막을 수 없다 | 서비스 목록, 작업 시작·등록 |
    | 막은 도구의 직접 실행(`security`, `launchctl`, `osascript`, `open`, `pbpaste`, `defaults`, `screencapture`, `lsof`, `ps`) | 막힘 | 막힘 | — |
    | `env`, `xcrun`, `sh -c`, `arch`, `xargs`, `find -exec`, `script`, `exec -a`, `/usr/bin/../bin/…`로 막은 도구 실행 | 막힘 | 막힘 | — |
    | 막은 도구의 심볼릭 링크 실행, `cp`·`cat`으로 임시 폴더에 복사해 실행 | 막힘(읽기도 막혀 복사본이 빈 파일이다) | 막힘 | — |
    | `DYLD_INSERT_LIBRARIES`로 막은 도구 실행 | 막힘 | 막힘 | — |
    | 임시 폴더에 쓴 스크립트 실행 | 열림 | 열림(같은 프로필 안이라 밖으로 나가지 않는다) | — |
    | 열린 도구로 폴더 밖 읽기(`cat`, `find`, `tar`, `sqlite3`, `plutil`, `grep`, `dd`, `strings`, `xxd`, `curl file://`, `awk`, `openssl`, `git`, `ditto`, `perl`, `ruby`로 시험용 가짜 파일, 홈, `~/.ssh`, `/Users`, `/Applications`, `/etc/passwd`, 키체인 폴더, `/var/db`, `/var/run/utmpx` 목록·읽기) | 막힘 | 막힘 | — |
    | 프로세스 도구(`pgrep`, `pkill`, `sample`, `vmmap`, `nettop`, `crontab`, `at`, `sysctl -a`, `netstat`) | 막힘(서비스가 없어서) | 막힘 | — |
    | 시험이 이 기계에 남긴 것 | — | — | 없음(아래 "흔적" 확인) |

    위 "열림"은 모두 도구 없이 `bun:ffi`로 부른 값이다. `python3 ctypes`로 같은 시험(서비스 조회 열한 개, 키체인, 프로세스 목록, 다른 프로세스 인자·경로)을 한 결과는 "후"에서 `bun:ffi`와 같았다(서비스 조회 `1100`, 키체인 `-50`, 프로세스 정보 막힘). `node`의 네이티브 애드온은 컴파일해야 해서 시험하지 않았다(프로필은 프로세스 단위라서 런타임과 상관없다고 본다).
  - **정상 훅 스크립트 확인**(`script-bypass.int.test.ts`): `grep`, `sed`, `awk`, `sort`, `jq`, `git --version`, 빈 커밋을 만드는 `git init`·`commit`·`log`, `curl --version`, `id -un`, `hostname`, `uname`, 임시 폴더 쓰기, `cat > /dev/null`, 자식 프로세스 만들고 죽이기, 백그라운드와 `wait`가 돈다. `bun`과 `node` 스크립트의 `os.userInfo()`, `os.hostname()`, `os.cpus()`, `process.memoryUsage()`, `spawnSync`(`sh`, `jq`, `git`)가 돈다. 알려진 기존 한계(이 변경과 무관, 전 후 같다): 이름 없이 부른 `mktemp`는 `TMPDIR`을 무시하고 `/var/folders`에 쓰려다 실패한다(`mktemp "$TMPDIR/x.XXXX"`는 된다), `perl`·`ruby`·`shasum`(Perl 스크립트)은 `/System/Library/Perl`을 읽지 못해 못 돈다, `/usr/bin/python3` 껍데기는 이제 개발자 도구의 실제 인터프리터로 풀리지만 Apple의 Python 3.9가 `/dev/urandom`을 읽지 못해 시작하지 못한다(위 "실행기 `python3`의 설치 폴더 읽기"), `os.uptime()`은 `EPERM`, `node`가 PATH의 읽을 수 없는 폴더를 만나면 `spawn("grep")`이 `EPERM`(절대 경로는 된다), 실행기 `python3`는 설치 폴더를 읽기로 열어 돈다(위 "실행기 `python3`의 설치 폴더 읽기").
  - 도구 동작(실제 샌드박스 시험, `script-boundary.int.test.ts`): `command -v`(PATH 탐색), `grep`, `sed`, `awk`, `cat`, `find`, `sort`, `jq`, `curl --version`, 개발자 폴더의 진짜 `git`과 PATH의 `git`(Apple 껍데기: `xcrun` 캐시를 쓰지 못한다는 경고만 내고 돈다)의 읽기 전용 명령이 돈다. 종료 코드, 표준 출력, 표준 오류는 그대로 돌아온다.
- 확인: `sandbox.no-write.int.test.ts`(실제 srt). 플러그인 폴더 안 읽기, 다른 플러그인 폴더·홈 파일 읽기 거부, 폴더 안 쓰기·작업 폴더 쓰기 거부, 자기 임시 폴더 쓰기와 읽기, `cleanup` 뒤 폴더 삭제, 두 프로세스의 폴더가 다름을 값으로 본다. macOS Seatbelt와 Linux bubblewrap(Docker arm64)에서 모두 통과했다. https(example.com)가 되는 것은 실제 샌드박스 아래 컴파일 바이너리로 손으로 확인했다(시험에 넣지 않았다: 바깥 인터넷이 필요하다).

#### 스크립트 환경 프로필 `script-env` (옵트인: 설정 `l0.sandbox.sandboxImportedHooks`를 켰을 때만) [결정: 2026-11-20, 사용자, AGE-58 "다른애들도 허용하면 우리도 막지말고 허용해 무조건"; 이름과 세부는 [제안]]

스크립트 실행기에는 세 길이 있다. **좁은 모드**는 위의 "쓰기 없음 프로필과 읽기 허용 목록"이고 지금까지와 같다(Fresnel에서 새로 만든 플러그인의 스크립트가 쓴다, 결정 (3)). **환경 모드 기본 길**은 가져온 훅을 샌드박스 없이 사용자 권한으로 돌린다. 이 절의 프로필을 쓰지 않는다. 다른 하네스의 훅과 같은 모양이다 [결정: 2026-11-20, 사용자, AGE-58 "다른애들도 허용하면 우리도 막지말고 허용해 무조건"]. **환경 모드 옛 길**은 설정 `l0.sandbox.sandboxImportedHooks`(managed·user 범위, 기본 끔, 이름은 [제안])를 켰을 때만 쓴다. 이 옛 길에서는 가져온 훅이 `profile: "script-env"` 안에서 돌아 보호 경로를 읽지 못하고, 프로젝트와 임시 폴더 밖에 쓰지 못하며, 도구와 Mach 서비스를 쓰지 못한다 [결정: 2026-11-20, 사용자, AGE-58 "다른애들도 허용하면 우리도 막지말고 허용해 무조건"; 앞선 샌드박스 작업을 버리지 않으려고 남겼다]. 환경 모드를 받는 쪽(누가 받을 수 있는가)은 X.loading-trust §3.8 "환경 모드"가 정한다. 이 프로필은 `IsolationSpawnSpec.scriptEnv`가 있을 때만 만들어진다. 아래 글머리는 모두 옛 길, 즉 설정을 켰을 때만 적용된다.

- **읽기**: `readAllow`가 없는 거부 목록 방식이다. 읽기를 거부하는 보호 경로(Fresnel 자신의 시크릿과 데이터, 설정 `extra`; 3.3절)만 읽기를 막는다. 자격 폴더(`~/.ssh`, `~/.claude`, 키체인 등)와 `.env`는 쓰기만 막으므로 읽힌다 [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"]. 쓰기 없음 프로필의 `systemTools`가 더하던 허용 목록은 필요 없어 더하지 않는다.
- **읽기 예외(`readCarveOuts`)**: 보호 경로 안에 있는 파일 가운데 가져올 때 지문을 적은 참조 파일만 다시 읽게 한다(예: 설정 `extra`에 적은 폴더 안의 `hooks/x.py`. 자격 폴더 안의 스크립트는 기본으로 읽히므로 예외가 필요 없다). 파일이 보호 경로의 엄격한 하위 폴더에 있으면 그 폴더(옆 모듈 import가 깨지지 않게, 결정 (4)의 이유), 보호 경로 바로 아래에 있으면 그 파일 하나다(`readCarveOutsOf`, 호스트). Seatbelt 프로필 끝에 `(allow file-read* (subpath …))`, 파일은 `(literal …)`로 더하고 보호 거부를 이긴다(실제 srt 프로필에서 확인: 시험 `sandbox.script-env.int.test.ts`). 같은 보호 경로의 다른 파일(예: 같은 폴더의 `secret.json`)은 계속 막힌다. 닫힌 실패(띄우지 않는다): 경로가 절대 경로가 아니거나 없거나 안전하지 않은 글자를 가짐, 읽기 거부 경로와 같거나 그것을 품은 폴더(`extra`에 적은 폴더 자체, 홈, `/`), 읽기 거부 파일 이름(기본 목록에는 없다)이거나 그것이 든 폴더(깊이 3까지 탐색). 예외는 `script-env` 프로필에서만 받고 bwrap은 예외를 받지 않는다(예외가 없으면 거부 목록 방식 그대로). 예외를 받는 것은 읽기 거부 `agent_credentials` 항목(다른 AI 하네스의 설정 폴더) 안의 스크립트 파일(`.sh`, `.py`, `.js`, `.mjs`, `.ts`, `.rb`, `.pl`)뿐이다. 기본 목록은 그런 항목을 읽기 거부로 두지 않으므로 기본으로는 예외가 생기지 않는다. `extra`에 적힌 경로는 `user_extra`라서 이 규칙의 대상이 아니다 [미결, 15번. 근거 `xeon/apps/host/src/assembly/script-env-host.ts`]. 명령 문자열에 경로가 적혀 있다는 이유만으로는 열지 않는다: 토큰 파일, 대화 기록, 그 밖의 데이터 파일과 읽기 거부 경로(Fresnel 데이터, `extra`)는 참조로 적혀 있어도 계속 막힌다 [결정: 2026-11-20, 오케스트레이터, AGE-58 "시크릿 읽기는 막는다"의 적용].
- **쓰기**: 프로젝트 폴더(`projectDir`, 정규 경로)와 이 호출 전용 임시 폴더(`se-<id>`, 0700, `TMPDIR`로 알림, 끝나면 지움)뿐이다. 설정 `writeRoots.extra`는 쓰지 않고, srt가 정책과 상관없이 허용하는 `/tmp/claude`, `~/.npm/_logs`, `~/.claude/debug`는 쓰기 거부에 더한다. 보호 경로(쓰기)는 프로젝트 안에서도 거부다(`.git/hooks`, `.git/config` 등). 홈의 캐시와 로그에는 쓰지 못한다(`uv`의 `~/.cache/uv`, `>> ~/….log`는 오류로 끝난다) [결정: 2026-11-20, 사용자, AGE-58 (1)].
- **막기(그대로 얹는다)**: 쓰기 없음+`systemTools` 프로필과 같은 `toolDeny`(`osascript`, `security`, `launchctl`, `open` 등), `machDeny`(키체인 데몬, LaunchServices), `systemInfoDeny`, 그리고 프로필 끝에 덧붙이지 못하면 띄우지 않는 닫힌 실패. 네트워크는 정책 그대로(차단 도메인 목록만)다. `launchd` 직접 통신은 이 프로필로도 막지 못한다(위 "막지 못한 길"). 읽기를 넓힌 탓에 `extra`에 적히지 않은 자격 파일(`~/.ssh`, `.env` 등)은 읽힌다: 막는 것은 방지턱이고, 막을 것은 사용자가 `extra`에 적어 줄인다 [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"].
- **샌드박스 밖 실행 없음**: `allowEscape`는 거절하고, 격리를 쓸 수 없으면 `onUnavailable` 설정과 상관없이 거절한다(`run_unsandboxed`로 돌리지 않는다). 스크립트 실행기(좁은 모드와 옛 길)는 사용자가 격리를 껐을 때(`disabled`)에도 띄우지 않고 `sandbox_unavailable`(사유 `sandbox_off`)로 거절한다 [근거: `xeon/packages/ext-host/src/isolation/script-runner.ts`의 `sandboxAvailable` 검사, `xeon/packages/platform-sandbox/src/status.ts`의 `disabled`]. 셸 도구(`wrapShell`)가 `disabled`에서 격리 없이 도는 것과 다르다. 기본 환경 모드 길은 샌드박스를 쓰지 않으므로 이 검사가 없다 [결정: 2026-11-20, 사용자, AGE-58 "다른애들도 허용하면 우리도 막지말고 허용해 무조건"]. `wrapShell`은 이 프로필을 거절하고(`sandbox_failed`) `wrapArgv`로만 돈다.
- **정책 모양**: `defaultPolicy({profile: "script-env", projectDir, readCarveOuts, systemTools: true, …})`는 `writeRoots = [정규 projectDir]`(상대 경로나 없는 폴더면 빈 목록), `readDeny`는 보호 경로(읽기), `readAllow` 없음, `profile: "script-env"`를 준다. `platform-process`의 `spawn`은 `spec.scriptEnv`가 있으면 작업 폴더를 `projectDir`로 하고 자식 env를 `childEnv(부모, spec.env)`로 만든다(호출자가 사용자 환경에서 시크릿 거부 패턴을 이미 뺐다). 없으면 동작은 이전과 같다.
- **Linux(bwrap)**: 거부 목록 방식(홈을 빈 tmpfs로 덮고 보호 경로를 막는다)과 프로젝트·임시 폴더 쓰기까지는 같은 모양이지만 이 맥에서 시험하지 못했다(코드 읽기와 단위 시험뿐). 읽기 예외는 거절하고, 도구·서비스·시스템 정보 막기는 Seatbelt 전용이라 없다(위 표).
- **시험 틀 수정**: srt의 위반 기록은 프로세스 전체가 공유하고 명령 id로 맞춘다. 시험 도구가 서비스마다 같은 난수 씨앗(`seededRandom(11)`)을 쓰면 파일 사이에 id가 겹쳐 한 파일의 거부가 다음 파일의 명령에 붙었다. 프로세스마다 다른 난수로 바꿨다.

## 5. 실패와 경계 사례

### 5.1 경계 사례

| 사례 | 동작 |
|---|---|
| 래핑 중 srt 오류(`LinuxSandboxProfileError` 등) | `sandbox_failed`. 메시지에는 오류 이름과 `.code`만. `cleanupAfterCommand` 부르지 않음 |
| 실행 중 새로 생긴 `.env` 파일 | 덮지 못한다(basename 전개는 실행 전에만). L2 파일 도구 검사는 실행 뒤에도 적용된다. 위험으로 남긴다 |
| Linux에서 존재하지 않는 거부 경로 | srt가 마운트 경로를 만들고 `cleanupAfterCommand`가 지운다(`_research/notes/L0-1.md` §8) |
| 병렬 명령 | 같은 프로세스의 srt 싱글턴을 공유한다. 파일 정책은 명령마다 다르다. 네트워크 정책은 프로세스에 하나다 |
| 취소 | `context.abortSignal`을 srt 래핑과 아래 `exec` 모두에 넘긴다. 프로세스 정리는 exec(`L0.exec.spec` B-17) |
| 쓰기 루트가 없음(빈 목록) | 샌드박스 안 쓰기 전부 거부. `autoAllow`는 조건을 만족할 수 있다 |
| 위반 기록이 상한(50) 초과 | 앞 50개만, `violationsTruncated: true` |
| srt 버전과 설정 스키마 불일치 | `toSrtConfig` 결과 검증 실패는 버그. 시작 시 1회 검증으로 드러난다 |

### 5.2 플랫폼별 제약

| 항목 | macOS | Linux(WSL2 포함) | Windows 네이티브 |
|---|---|---|---|
| 격리 수단 | Seatbelt(`sandbox-exec`, 동적 프로필). 시스템 기능이라 추가 설치 없음 | bubblewrap + seccomp(apply-seccomp 정적 바이너리 x64·arm64 번들) | srt `srt-win.exe`는 alpha. Fresnel 1차는 쓰지 않는다 |
| 필요 프로그램 | `rg`(ripgrep) | `bwrap`(0.4.0 이상, 0.5.0 이상 권장), `socat`, `rg`. 없으면 `missing` 목록과 설치 안내, 환경 문제(종료 코드 2 계열) | 해당 없음 |
| status | `srt` | `srt`. WSL2는 Linux로 다룬다. WSL1은 `none`(`unsupported_os`) | `none`(`unsupported_os`) → `onUnavailable` 적용 |
| 알려진 제약 | Apple Events·pty 기본 거부. macOS `sandbox-exec`의 Apple 측 지원 상태 [미확인] | Ubuntu 24.04 이후 `kernel.apparmor_restrict_unprivileged_userns`가 bwrap 사용자 네임스페이스를 막는다(sysctl 또는 AppArmor 프로필 필요). 루트 실행은 `CAP_SETFCAP` 필요. 중첩 사용자 네임스페이스 거부로 Chromium·rootless podman이 샌드박스 안에서 실패. x64·arm64 밖은 seccomp 미번들 | srt-win 설치는 관리자 승인 1회. SMB·WSL 기동·시스템 리졸버 DNS는 차단 밖(srt README:1000-1011) |
| 경로 문법 | gitignore식 글로브 가능. Fresnel은 리터럴만 넘긴다 | `allowWrite`·`denyWrite`는 리터럴만 | 해당 없음 |
| 위반 기록 | 로그 스트림(`enableLogMonitor` 참) | 프록시 거부만 기본. seccomp 모니터는 진단용이라 기본 끔(그래서 Linux 쓰기·읽기 거부는 기록되지 않는다, 4.2절 11번) | 해당 없음 |
| 근거 | `_research/notes/L0-1.md` §6 | 같음, `_research/packages.md` §4.2 159행·§6 338행 | 같음, `_research/refs/claude-code.md` §3.2 "네이티브 Windows는 미지원, WSL2 사용"(원문 확인 필요 [가정]) |

### 5.3 Bun과 사이드카

- srt는 Node 기준 패키지이고 Bun 분기가 있다. 라이브러리를 Bun 1.4 호스트에서 직접 호출할 수 있다 [가정: `_research/notes/L0-1.md`는 Bun 분기 코드를 확인했을 뿐 실행하지 않았다. `L0.sandbox.plan` SB-01 스파이크 결과로 확정한다]. `_research/refs/claude-code.md` 326행의 "호스트 언어가 Node가 아니면 CLI 래핑 필요"는 근거가 없다(`_research/notes/L0-1.md` §9 정정).
- `bun build --compile` 사이드카에서 srt는 헬퍼(apply-seccomp 등)를 `import.meta.url` 기준 상대 경로로 찾는다. 컴파일 산출물에서 이 경로가 맞는지는 확인하지 않았다 [가정: 맞지 않을 가능성이 높음]. 1차 대응은 상태 탐지가 찾은 절대 경로를 `seccomp.applyPath`, `bwrapPath`, `socatPath`, `ripgrep.command`로 넘기는 것이다(`L0.sandbox.plan` SB-01 스파이크).

## 6. 설정 노출

| 키 | 타입 | 기본값 | 범위(`allowedScopes`) | 변경 반영 | 단계 | L4 노출 |
|---|---|---|---|---|---|---|
| `l0.sandbox.enabled` | `boolean` | `true` | `managed`, `user` | `nextTurn` | M1 | 탭 `permissions`(임시. `"sandbox"` 추가 요청, 목표는 '샌드박스와 네트워크' 탭), `toggle`. 끌 때 위험 고지 필요 |
| `l0.sandbox.onUnavailable` | `string`(`range.enum`: `disable_execute`, `run_unsandboxed`) | `disable_execute` | `managed`, `user` | `nextTurn` | M1 | `permissions`(임시), `select`. `run_unsandboxed` 선택 시 위험 고지 |
| `l0.sandbox.protectedPaths.extra` | `string[]`(절대 경로 또는 `~/`로 시작) | `[]` | `managed`, `user`, `project` | `nextTurn` | M1 | `permissions`(임시), `list`. 제안 목록(`SUGGESTED_PROTECTED_PATHS`)을 함께 보여 준다. 적은 경로는 읽기와 쓰기를 모두 막는다. 기본은 읽기를 막지 않는다 [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"] |
| `l0.sandbox.writeRoots.extra` | `string[]` | `[]` | `managed`, `user` | `nextTurn` | M1 | `permissions`(임시), `list` |
| `l0.sandbox.escapeRetry` | `boolean` | `false` | `managed`, `user` | `nextTurn` | M1 | `permissions`(임시), `toggle`. 아직 쓰이지 않는다(§4.3 둘째 줄). 막힌 쓰기는 L2.workspace.spec §4.3.1이 묻는다 |
| `l0.sandbox.network.blockedDomains` | `string[]`(`host`, `*.host`, `host:port`) | `[]` | `managed`, `user`, `project` | `restart` | M3 | `permissions`(임시), `list`. 목록 밖은 모두 허용 |
| `l0.sandbox.nestedNamespaces` | `boolean` | `false` | `managed`, `user` | `restart` | M3 | `permissions`(임시), `toggle`. 켤 때 위험 고지 필요 |
| `l0.sandbox.sandboxImportedHooks` | `boolean` | `false` | `managed`, `user` | `nextTurn` | M5g [제안] | `permissions`(임시), `toggle`. 켜면 가져온 훅이 샌드박스 안에서 돈다(§4.9 "스크립트 환경 프로필"). 기본은 끔이다 [결정: 2026-11-20, 사용자, AGE-58 "다른애들도 허용하면 우리도 막지말고 허용해 무조건"; 키 이름은 [제안]] |
| `l0.sandbox.selfTestIntervalMin` | `integer`(`range` 0~1440, 0은 시작 때만) | `60` | `managed`, `user` | `restart` | M1 | 탭 `advanced`(파일만) |
| `l0.sandbox.network.allowedDomains` | `string[]`(`host` 또는 `host:port`) | 정의하지 않음 | | | 후속 | 기본 허용 방식이라 허용 목록 키는 두지 않는다(§10 1번) |

- 키 문법은 `F.wire-settings.spec` §3.8.1을 따른다. 정의는 `src/settings.ts`의 `defineSettings("l0.sandbox", …)`다.
- 넓히는 키(`enabled` 끄기, `onUnavailable`, `writeRoots.extra`, `escapeRetry`, `nestedNamespaces`)는 `project` 범위를 받지 않는다. `sandboxImportedHooks`는 끄는 쪽이 넓히는 키라 같은 규칙을 받는다 [결정: 2026-11-20, 사용자, AGE-58 "다른애들도 허용하면 우리도 막지말고 허용해 무조건"]. 좁히는 키(`protectedPaths.extra`, `network.blockedDomains`)만 작업 폴더 파일에서 받는다 [제안: 저장소를 여는 것만으로 격리가 풀리지 않게 한다, `_research/notes/L0-1.md` §3.6].
- [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"] `l0.sandbox.protectedPaths.allowRead`와 `l0.sandbox.credentialFiles`는 뺐다(3.3.1절). 저장 파일에 남은 옛 키는 설정 엔진의 알 수 없는 키 처리를 따른다.
- 네트워크 키는 srt가 프로세스당 정책 하나라 `restart`다(`_research/notes/L0-1.md` §8). 실행 중 변경(`updateConfig`)은 2차에서 다시 본다.
- 탭: `_research/settings.md` §4의 5번 탭 '샌드박스와 네트워크'에 둔다. F `SettingsTab`(`F.wire-settings.spec` §3.8.2)에 해당 값이 없어 `"sandbox"` 추가를 F에 요청한다(8.2절). 추가 전까지는 `"permissions"`에 둔다 [제안].
- 시크릿 값 키는 없다.

## 7. 훅

- `fresnel.sandbox`는 `on` 훅을 선언하지 않는다. 도구 실행 훅(`tool.call.before` first, `tool.result` chain)은 L1이 선언하고(`F.extensions.spec`), 자동 허용 판정 결과를 쓰는 곳도 L1이다.
- `post`, `drive`와 관계없다.
- 확장(플러그인)이 정책을 완화하는 경로는 없다. 확장은 `scope`로 `SandboxServiceName`을 주입받아 `status()`, `protectedPaths()`, `autoAllow()`를 읽을 수 있다. `wrapShell`을 직접 써서 자기 프로세스를 감쌀 수 있다 [제안]. 다만 승인된 가져온 훅의 기본 길(환경 모드)은 이 샌드박스 밖에서 돈다. 확장이 정책을 바꾸는 API는 여전히 없고, 이 길은 가져오기 검토를 승인한 사용자의 결정으로 열린다(X.loading-trust §3.8) [결정: 2026-11-20, 사용자, AGE-58].

## 8. 다른 문서와의 인터페이스

### 8.1 제공

| 이름 | 소비 문서 |
|---|---|
| `fresnel.sandbox`(`SandboxService`): `status`, `defaultPolicy`, `protectedPaths`, `protectedPathKey`, `suggestedProtectedPaths`, `wrapShell`, `wrapArgv`, `autoAllow`, `selfTest`, `lastSelfTestReport` | `L1.tools.spec`, `L2.workspace.spec`, `L4.host-service.spec`(자가 시험 주기 호출), `L4.cli.spec`(doctor), `platform-process`(stdio MCP 서버, 4.9절) |
| `describeSandboxStatus`(F `services/sandbox.ts`의 순수 함수, review.decisions-2 D-04) | `L4.cli.spec`, `L4.settings-ui.spec`. 구현 패키지를 import하지 않고 F에서 가져온다(DR-14) |
| `@fresnel/platform-sandbox/testing`: `fakeSandbox`(상태와 판정을 표로 고정, `wrapShell`은 기록만 하는 통과 데코레이터, `wrapArgv`는 요청을 `wrappedArgv`에 기록하고 판정대로 argv를 돌려준다) | `L1.tools.plan`, `L2.workspace.plan` |

### 8.2 F에 요청

| 요청 | 대상 | 이유 |
|---|---|---|
| `SandboxPlatform`, `SandboxUnavailableReason`, `OnUnavailable`, `SandboxStatus`(+Schema), `SandboxNetworkPolicy`, `SandboxPolicy`(+Schema), `ProtectedAccess`, `ProtectedMatch`, `ProtectedPathEntry`, `matchProtectedPath`, `AutoAllowBlock`, `AutoAllowDecision`, `SelfTestItemId`, `SelfTestItem`, `SelfTestReport`(+Schema), `SandboxViolation`, `SandboxRunReport`(+Schema), `SandboxService`, `SandboxServiceName`을 `@fresnel/contracts/services`(`services/sandbox.ts`)에 둔다 [결정: review.decisions-2 D-04] | `F.capabilities.spec` §3.12(services) | 3.1절. L1 tools, L2 workspace가 같은 타입을 쓴다 |
| `ShellExecResult.sandbox?: SandboxRunReport`. `SandboxRunReport`·`SandboxViolation`은 `services/sandbox-report.ts`에 두고 `exec.ts`·`sandbox.ts`가 그 파일만 import한다 | `F.capabilities.spec` §3.12(services) | `L0.exec.spec` §3.1과 같은 요청. 순환 import 방지 |
| `describeSandboxStatus`, `SandboxStatusSummary`, `SandboxStatus.installHints`를 `services/sandbox.ts`에 둔다 | `F.capabilities.spec` §3.12(services, 규칙 6의 순수 함수) | 4.6절. L4 소비자가 구현 패키지를 import하지 않게 한다 |
| `SettingsTab`에 `"sandbox"` 추가 | `F.wire-settings.spec` §3.8.2 | 6절. `_research/settings.md` §4 5번 탭 |

### 8.3 요구

| 대상 | 요구 |
|---|---|
| `fresnel.os`(`OsService`, `L0.os.spec`) | `OsDirs.home`, `OsDirs.config`, `OsDirs.data`(DB·blob 포함), `OsDirs.tmp`의 절대 경로(`L0.os.spec` §3.2). `resolveBinary("rg" \| "bwrap" \| "socat")`(§3.6) |
| `fresnel.secrets`(`SecretService`, `L0.secrets.spec`) | `protectedPaths()`: 시크릿 파일 절대 경로 목록(값 없음, `L0.secrets.spec` §3.6). 보호 경로 `secret_key` 행. 후속에서 sentinel 모드의 프록시 훅 요구를 받는다(10절 9번) |
| `fresnel.exec`(`L0.exec.spec`) | `SENSITIVE_ENV_PATTERNS`를 F에 두는 것(자가 시험 `env_allowlist`), `Shell` 데코레이션 성질(§3.7) |
| `L1.tools.spec` | (1) 셸 도구 실행 경로에서 `wrapShell`로 감싼 `Shell`을 쓰는 조립. (2) `onUnavailable` 표(4.5절)의 도구 광고 처리(`disable_execute`면 광고하지 않는다). (3) `autoAllow` 판정의 적용. (4) 파일 도구가 `protectedPaths()`와 `matchProtectedPath`로 realpath 검사(18 R-12). (5) 격리 없이 실행한 호출의 기록(이벤트 소유 [미결]) |
| `L2.workspace.spec` | §4.3 6번 보호 경로 검사에 `matchProtectedPath` 사용. 쓰기 루트를 `defaultPolicy` 입력과 같은 값으로 쓰기 |
| `L4.host-service.spec`, apps/host | 시작 때와 `l0.sandbox.selfTestIntervalMin`마다 `selfTest(<fresnel.exec Shell>, …)` 호출. exec·sandbox 조립 위치 |
| `L4.cli.spec` | doctor 출력에 `describeSandboxStatus`, `missing_dependency`는 종료 코드 2 계열 |
| `L2.mcp.spec` | MCP stdio 서버를 샌드박스에 넣을지 협의(10절 3번) |

## 9. 수용 기준

1. Linux·macOS CI의 실제 srt에서 샌드박스 안 `cat <fresnelData>/selftest/canary`가 실패하고 출력에 canary 값이 없다. 같은 자리에서 `cat <home>/.ssh/<canary>`는 기본으로 성공하고(3.3.1절), 설정 `extra`에 `<home>/.ssh`를 적은 시험에서는 실패한다 [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"].
2. 샌드박스 안 `touch <fresnelData>/x`, `touch <root>/.git/hooks/pre-commit`, `echo >> <root>/.git/config`가 실패하고 파일이 바뀌지 않는다.
3. 샌드박스 안 `touch <writeRoot>/ok`가 성공한다.
4. 호출자가 `readDeny: []`, `writeDeny: []`인 정책으로 `wrapShell`을 써도 1·2번 결과가 같다(보호 경로는 줄일 수 없다). `l0.sandbox.protectedPaths.extra`에 경로를 더하면 그 경로 읽기도 실패한다.
5. 의존 프로그램이 없는 환경(가짜 provider로 `bwrap` 부재)에서 `status()`가 `{ available: false, reason: "missing_dependency", missing: ["bwrap"] }`이고 `describeSandboxStatus`의 `severity`가 `critical`, `hints`에 설치 안내가 있다.
6. `l0.sandbox.enabled = false`이면 `status().reason`이 `disabled`이고 시작 로그와 doctor 출력에 경고가 있으며, 실행 결과의 `sandbox.unsandboxedBy`가 `"disabled"`다.
7. Windows provider(가짜 `process.platform = "win32"`)에서 `status()`가 `{ level: "none", reason: "unsupported_os" }`이고, 기본 설정에서 `wrapShell(...).exec`는 자식 프로세스를 만들지 않고 `sandbox_unavailable`을 돌려준다. `run_unsandboxed`로 바꾸면 실행되고 `unsandboxedBy: "run_unsandboxed"`가 붙는다.
8. `autoAllow`가 4.3절 조건 조합별 판정표(조건 5개의 참·거짓 32조합)에서 기대 결과와 `blocks` 목록을 낸다.
9. 성공한 샌드박스 실행의 `ShellExecResult.sandbox.sandboxed`가 참이고, M1 스모크의 bash 도구 호출 이벤트 details에서 이 값을 확인할 수 있다.
10. `wrapShell`이 넘긴 `secretEnv` 참조는 아래 `Shell`에 그대로 도착하고, `SandboxRunReport`와 시작 로그에 시크릿 값이 없다.
11. srt 래핑이 throw하면 `sandbox_failed`이고 `cleanupAfterCommand` 호출이 0회다.
12. 실제 srt와 OS 격리(Linux bubblewrap, macOS Seatbelt)로 `sandbox.int.test.ts`가 다음을 확인한다. 각 거부 시험은 같은 명령을 감싸지 않은 Shell로 돌려 성공함을 보이는 대조를 함께 둔다. (a) 쓰기 루트 안 쓰기는 성공하고 `sandbox.sandboxed`가 참이다. (b) 쓰기 루트 밖 쓰기가 종료 코드 0이 아니고 파일이 생기지 않는다(M1 종료 조건). (c) 쓰기 루트 안의 `.git/hooks` 쓰기가 거부된다. (d) `<fresnelData>/selftest/canary` 읽기가 거부된다. (e) 호출자 `readDeny`·`writeDeny`가 비어도 (c)와 `protectedPaths.extra` 경로 읽기 거부가 그대로다. (f) 로컬 TCP 서버로 가는 `/dev/tcp` 연결이 거부되고 서버가 연결을 받지 못한다. (g) 자가 시험 여섯 항목이 모두 통과한다. (h) `sandbox.default-reads.int.test.ts`가 기본 상태의 읽기 허용(`~/.ssh`, 키체인 모양 폴더, `~/.claude`, `~/.codex`, 작업 폴더의 `.env`), 자격 폴더 쓰기 거부, 쓰기 루트에 더한 자격 폴더의 쓰기 거부, Fresnel 자신의 경로 읽기 거부, `extra` 경로의 읽기·쓰기 거부, 셸 정책과 파일 도구 목록의 일치를 값으로 확인한다. `sandbox.secret-folders.int.test.ts`가 제안 목록 폴더를 기본에서 읽고 `extra`에서 막는다(3.3.1절).
13. 12번 시험의 필수 바이너리(Linux: `bwrap`, `socat`, `rg` / macOS: `rg`)가 없으면, 환경 변수 `FRESNEL_REQUIRE_SANDBOX=1`이거나 `CI=true`일 때 종료 코드 2(환경 문제)로 끝나고 stderr에 `ENV sandbox.int: missing <이름>. <설치 안내>`를 쓴다. 그 밖의 기기에서는 건너뛰고 stderr에 `SKIPPED ENV sandbox.int: …`를 한 줄 남긴다. CI가 이 파일을 건너뛴 채 통과하지 않게 하는 쪽은 Z 트랙(G4-07)이 `test-capped.sh`의 종료 코드 전달과 건너뜀 수 출력으로 잇는다.
14. `test/wrap-argv.test.ts`가 4.9절을 값으로 확인한다. 격리 가능 시 srt가 준 argv와 한 번만 인용한 명령 문자열, 부모 env와 다른 항목만 든 env, `wrapShell`과 같은 srt 설정, `cleanup` 두 번 호출에 `cleanupAfterCommand` 한 번, 래핑 실패의 `failed`(이름과 code만)와 `cleanupAfterCommand` 0회, 중단의 `aborted`, 격리 불가의 `unavailable`, 실행 허락 시 요청 그대로의 argv와 `unsandboxedBy`, 허용 도메인의 `failed`.

근거 위치: `_research/packages.md` §4.2 L0-b, `_research/refs/claude-code.md` §3.2·326행, `_research/notes/L0-1.md`, `_research/settings.md` §2.2·§4, `docs/design/18-security.md` §3.11.1·§3.11.4·§3.11.5, `docs/design/13-tools-and-execution.md` §3.5·§3.6.

## 10. 미결 사항

1. [결정: review.m3-design-inputs D-M3-18 행 1] 샌드박스 안 네트워크는 기본 허용이다. 사용자가 차단 도메인 목록 `l0.sandbox.network.blockedDomains`를 관리한다. 패키지 설치가 샌드박스 안에서 그대로 돈다. 차단은 srt 프록시의 `deniedDomains`와 질의 콜백(항상 허용)으로 한다. 시험은 `sandbox-network.int.test.ts`가 실제 bwrap으로 같은 요청이 목록 밖이면 200, 목록 안이면 403인 것을 값으로 확인한다. 프록시를 거치지 않는 직접 소켓은 네트워크 네임스페이스가 막으므로 그대로 거부된다(§4.4 `network_denied`). 환경 변수 `NO_PROXY`의 루프백·사설 대역은 프록시를 거치지 않으므로 샌드박스 안에서 닿지 못한다.
2. [결정: 오케스트레이터 기본값] 격리 없이 실행한 호출(`tool.sandbox_bypassed`)과 자가 시험 실패의 감사 이벤트 소유자는 L1 tools(`tool.` 접두)다(§4.8). `platform-sandbox`는 이벤트 type을 소유하지 않는다(`eng.context-map.design` §4.1). 이벤트를 만드는 구현은 B3-SEC가 한다.
3. [결정: review.m3-design-inputs D-M3-19 행 1] MCP stdio 서버는 출처별 기본값을 쓴다. 작업 폴더 출처 서버는 샌드박스에 넣고, 사용자 출처 서버는 넣지 않는다. 서버별 설정으로 바꿀 수 있다(`L2.mcp.spec`, M3-REQ-57).
4. [결정: review.m3-design-inputs D-M3-18 행 3] 샌드박스 밖 재시도(`l0.sandbox.escapeRetry`)를 둔다. 기본은 끔이고, 켜도 재시도마다 승인을 받는다(`_research/notes/L0-1.md` §9).
5. [미결] x64·arm64 밖 Linux 지원. seccomp 필터가 번들되지 않아 `select.ts`는 `unsupported_os`를 돌려준다. 지금은 `fresnel.os`가 해당 arch를 등록 실패로 처리하므로 운영 경로가 없다(3.5절). 지원을 넓히면 두 문서를 함께 고친다.
6. [결정: 오케스트레이터 기본값] 중첩 사용자 네임스페이스. 기본 브라우저 provider는 Stagehand다([결정: review.m3-design-inputs D-M3-23]). srt 0.0.79에는 `allowNestedUserNamespaces`가 없어 `enableWeakerNestedSandbox`로 허용하고 설정 `l0.sandbox.nestedNamespaces`(기본 거짓, `restart`)로 켠다(§4.8). 쓰기 거부가 약해질 수 있다(`_research/notes/L0-1.md` §6). 켠 상태에서 브라우저가 실제로 뜨는지는 실기 확인이 필요하다.
7. [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"] 자격 파일 행(`~/.npmrc`, `~/.config/gh` 등)은 기본으로 읽기를 허용하고 쓰기만 막는다(3.3절). 설정 `credentialFiles`는 뺐다. 막으려면 `extra`에 적는다. 이전 결정(review.m3-design-inputs D-M3-18 행 2)의 기본 읽기 허용은 그대로다. 시크릿 env 주입(`L0.exec.spec` §3.6)으로 대신할 수 있는지는 `L0.secrets.spec`과 함께 정한다 [미결: 근거 결정 2026-11-20, AGE-63].
8. [미결] `SettingsTab`의 `"sandbox"` 추가(F 변경).
9. [미결] 프록시 훅(후속, sentinel 모드). `L0.secrets.spec` §4.3 M2 sentinel 설계는 자식 HTTPS가 `fresnel.sandbox` 프록시를 지나고 허용 호스트로 가는 요청의 헤더에서 sentinel을 값으로 바꾸는 훅을 요구한다. 이 문서는 아직 그 훅을 정하지 않았다. srt `mitmProxy`(외부 Unix 소켓) 연결 안과 `parentProxy` 체이닝 안을 `L0.sandbox.plan` SB-16에서 비교하고 TLS 종단(`L0.secrets.spec` §10 6번)과 함께 정한다.
10. [미결] `wrapArgv`의 위반 수집. 장수 프로세스는 위반 줄을 언제 모을지 정해야 한다(종료 때 한 번, 주기적으로 등). 1차는 모으지 않고, `SandboxedArgv`에도 위반 필드가 없다(4.9절).
11. [미결] `cleanupAfterCommand`의 전역 범위. srt 상태는 프로세스 전역이고, 이 함수는 실행 중인 다른 샌드박스가 쓰는 마운트 경로를 지울 수 있다(`_research/notes/L0-1.md` §8). `wrapArgv`의 `cleanup`은 호출 횟수만 한 번으로 막는다. 여러 장수 프로세스의 정리 시점을 어떻게 정할지 정해야 한다(4.9절).
12. [미결] 위반 수집 시점. macOS 로그 스트림의 줄은 명령이 끝난 뒤에 도착할 수 있다(위 요약의 측정). 그래서 명령이 끝난 직후 `getViolationsForCommand`로 모으면 쓰기 거부가 빠질 수 있고, 막은 것의 분류(4.2절 11번)도 같은 공백을 가진다. 모든 셸 호출에 대기를 넣으면 지연이 생기므로, 0이 아닌 종료에만 짧게 기다리는 방안과 로그 출력을 줄 단위로 읽는 방안을 비교해 정한다.
13. [결정: 2026-11-19, 사용자, AGE-58 "1-다 2-가"] 스크립트 실행기가 `launchd` 직접 통신으로 샌드박스 밖에서 도는 작업을 등록할 수 있는 길(4.9절 "막지 못한 길")은 지금대로 두고, 승인 카드의 "코드 실행" 안내와 사용자의 승인에 기댄다(승인된 플러그인만 스크립트를 돌린다). 실행기 `bun`·`node`·`python3`를 빼지 않는다. 스크립트 실행기를 별도 프로세스 계정이나 별도 샌드박스(작업 관리자 연결이 없는 환경)에서 더 강하게 격리해 띄우는 것은 후속 이슈로 설계하고, 이 스펙의 범위에서는 만들지 않는다. 실행기 `python3`는 설치 폴더를 읽기로 열어 샌드박스 안에서 돈다(4.9절 "실행기 `python3`의 설치 폴더 읽기"). 카드 안내: 초안 호출의 승인 카드(`ScriptCard.uses`)와 검토 카드의 스크립트 줄(`CardScript.uses`)이 `system_tools`와 `network`를 싣는다. 데스크톱 화면에서 이 값을 문구로 보이는 곳은 아직 없다(화면 작업).
14. [미결] 기본 읽기 허용으로 셸 명령이 읽을 수 있게 된 것: `~/.ssh`의 개인 키, 키체인 데이터(macOS `~/Library/Keychains`, Linux 키링), 브라우저 쿠키와 저장된 로그인(`~/Library/Cookies`, 브라우저 프로필), CLI 인증 파일. 이것들의 유출 방지는 네트워크 차단 목록과 `L2.knowledge`의 유출 차단 규칙에만 기댄다. 쓰기 거부는 그대로다. 사용자가 막을 것을 고르는 대화 도구(3.3.1절)를 어느 층에 둘지와, 에이전트가 `extra`를 바꿀 수 있는 범위를 정해야 한다 [근거: `xeon/packages/platform-sandbox/src/protected-paths.ts`].
15. [미결] 읽기 예외의 대상. `apps/host`의 `readCarveOutsOf`는 읽기 거부 `agent_credentials` 항목 안의 스크립트에만 예외를 준다. 기본 목록에는 그런 항목이 없어 예외가 생기지 않고, 스크립트는 기본으로 읽힌다. 사용자가 `extra`에 다른 AI 하네스 폴더를 적으면(`user_extra`) 그 폴더의 훅 스크립트는 스크립트 환경이 읽지 못한다. 대상을 `user_extra`까지 넓힐지 정한다 [근거: `xeon/apps/host/src/assembly/script-env-host.ts`].
