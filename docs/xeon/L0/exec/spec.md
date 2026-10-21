---
id: L0.exec.spec
layer: L0
domain: exec
kind: spec
status: draft
depends_on: [F.capabilities.spec, F.conversation.spec, adr.0003, eng.typescript.guide, eng.dependency-rules.guide, L0.sandbox.spec, L0.secrets.spec, L0.os.spec, L0.process.spec]
binds: [xeon/packages/platform-exec/**]
---

# L0 exec 스펙: 실행 환경 `xeon.exec`

## 1. 목적과 범위

`platform-exec`는 파일 연산과 셸 실행을 한 인터페이스 `ExecutionEnv`(= `FileSystem` + `Shell`) 뒤에 두고, 로컬 구현을 Cordis 서비스 `xeon.exec`로 등록한다. 구현 원본은 pi durable `env` 모듈의 포크다 [결정: adr.0003 §3.1, `_research/foundation-plan.md` §1 결정 1].

정하는 것:

- F에 둘 실행 계약 초안: `CancelScope`, `ExecutionEnv`, `FileSystem`, `Shell`, 오류 코드, 서비스 이름 `ExecServiceName`(3.1절)
- 포크 범위, 포크 기록, 바꿀 점(패치 표, 3.3절)
- OS 분기 인터페이스 `ExecPlatformProvider`와 선택 지점 `select.ts`(3.4절)
- 포크 위에 얹는 Xeon 연결 코드: 자식 프로세스 환경 변수 허용 목록 빌더, 비밀 주입 지점 `ShellExecOptions.secretEnv`(M1), 데코레이션 가능한 `Shell` 요구(3.5절~3.7절), 백그라운드 실행 `startBackground`(3.9절)
- 동작 보장 표(포크 원본 주석의 보장과 변경 여부, 4절), 플랫폼별 제약(5.2절), 설정 키(6절), 수용 기준(9절)

다루지 않는 것:

| 대상 | 정하는 곳 |
|---|---|
| 도구 본문(`D/src/tools/*`), 이미지 처리(`D/src/images/*`), 출력 절단(`D/src/truncate.ts`)의 포크 | `L2.workspace.spec`, `L2.workspace.plan`. 이 문서는 env 5파일만 포크한다 [결정: adr.0003 §3.1] |
| OS 샌드박스, 보호 경로, 자동 허용 판정 | `L0.sandbox.spec` |
| 장시간 백그라운드 프로세스 레지스트리, 엔진 프로세스 수명 | `L0.process.spec`. 레지스트리에 넘길 pid와 정지 수단은 이 문서의 `startBackground`(3.9절)가 만든다 |
| 비밀 해석(lease), 마스킹, 사용 감사 | `L0.secrets.spec` |
| 사용자 디렉터리 질의, `Clock`·`Scheduler`·`RandomSource` 구현 | `L0.os.spec` |
| 앱 설정·스킬·플러그인 디렉터리 감시 | `L0.os.spec` §3.8. 파일 감시 책임 경계: 작업 공간 파일 감시는 `xeon.exec`의 `ExecutionEnv.watch`가 맡고, 앱 설정·스킬·플러그인 디렉터리 감시는 `xeon.os`의 `FileWatcher`가 맡는다. 판정은 경로 기준이다. `OsDirs`(config, data, state) 아래 경로는 os, 작업 공간 루트 아래 경로(프로젝트 안 `.xeon/` 포함)는 exec다 [미결: `L0.os.spec` 10절 2번과 같은 문장] |
| 도구 승인, 권한 모드, 명령 패턴 규칙 | `L1.tools.spec` |

범위와 단계:

| 구성요소 | 단계 | 표지 |
|---|---|---|
| 로컬 `NodeExecutionEnv`(포크) + Xeon 연결 코드 | 1차, M0(포크·적합성), M1(env 빌더·서비스 등록) | [결정: `_research/foundation-plan.md` §5 P4 M0 `platform-exec`] |
| 비밀 주입 지점 `secretEnv`(에이전트 env 모드) | 1차, M1. M1 비밀 검증 경로다(3.6절) | [결정(잠정): review.decisions-2 U-19] |
| 백그라운드 실행 `startBackground` | 1차, 구현은 M2 이후(소비자 L1 tools 백그라운드 셸, L2 mcp가 M2 이후다) | [제안] |
| Docker 어댑터(`ExecutionEnv`의 컨테이너 구현) | 1차 목표, 구현은 M2 이후 | [제안, `_research/layer-plan-v2.json` L0-a "Docker만 어댑터"] |
| SSH 원격 워크스페이스 | 보류. `@earendil-works/pi-env` 1.3.0을 채택 후보로 둔다 | [결정: 계획 v2 L0-a "보류"], `_research/packages.md` §4.2 158행 |
| git worktree 작업 트리 격리(서브에이전트 병렬 수정) | 2차. 100줄 안팎의 래퍼 | [제안, `_research/packages.md` §4.2 157행] |
| Windows 네이티브 구현 보강 | M2 이후. 1차는 인터페이스와 제약 표만 | [결정: `_research/decisions-log.md` 2026-10-19 "Windows 네이티브는 나중"] |

## 2. 용어

| 용어 | 뜻 |
|---|---|
| `ExecutionEnv` | 파일 연산(`FileSystem`)과 명령 실행(`Shell`)을 합친 인터페이스. 원본 `D/src/env/index.ts:324` |
| 포크 원본 | `~/projects/_ref/pi-src/packages/durable/src/`(이하 `D/src/`), 저장소 `https://github.com/earendil-works/pi`, 커밋 `cdaf6c227d4718a72b59ccd02152c9614df44cfc`(약칭 `cdaf6c2`), 패키지 버전 1.1.0. 줄 번호는 이 사본 기준이다 [가정: adr.0003 §3.2] |
| 포크 코드 | `platform-exec/src/upstream/` 아래에 복사한 원본 파일. 바꾼 줄에는 `// XEON-PATCH: <id>`를 단다 |
| 연결 코드 | `src/upstream/` 밖에 Xeon이 새로 쓴 코드. 서비스 등록, env 빌더, 비밀 주입, provider |
| `CancelScope` | 취소 신호 하나만 담는 객체 `{ readonly abortSignal }`. Chord `Context`(`chord/src/types.ts:15-16`)와 같은 모양이다 |
| spill | 명령 출력이 임계(바이트 또는 줄)를 넘으면 전체 원출력을 임시 파일에 쓰는 동작 |
| window | 호출자가 출력의 꼬리만 남길 때 넘기는 범위. 구현은 범위 밖 출력을 건너뛰고 `skipped`로 알린다 |
| 소유자 | `ExecutionEnv` 인스턴스를 만든 쪽. 서비스 인스턴스의 소유자는 `platform-exec` Cordis 플러그인이다 |
| 허용 목록 env | 자식 프로세스에 넘기는 환경 변수를 이름 목록으로 고른 결과. 부모 `process.env` 전체를 넘기지 않는다 |
| lease | `xeon.secrets`가 돌려주는 비밀 값 보관 객체. 사용 후 폐기한다(`_research/secrets.md` §6.2) |

## 3. 인터페이스

### 3.1 F에 둘 실행 계약 초안

아래 타입은 F `@xeon/contracts/services` 서브패스의 `services/exec.ts`에 둔다. L0·L1 서비스 인터페이스는 이 서브패스에 둔다 [결정(잠정): review.decisions-2 D-04]. L0 `platform-exec`(구현), L0 `platform-sandbox`(`Shell` 데코레이터), L1 `core-tools`, L2 `cap-workspace`(포크한 도구 본문)가 같은 타입을 쓰므로 F 외에는 공유할 곳이 없다(`eng.dependency-rules.guide` DR-02, DR-07의 "pi durable env 포크는 `platform-exec`만"). 이 절의 이름은 `F.capabilities.spec` §3.12 파일별 이름 표의 `services/exec.ts` 행에 있다. 아래 블록은 F로 옮기기 전의 초안이고, 필드는 이 블록을 F로 옮겨 확정한다(같은 절 규칙 1, `F.capabilities.plan` P9). 8절 'F에 요청'은 그 작업의 목록이다.

- 모양은 포크 원본 `D/src/env/index.ts`의 선언을 그대로 옮긴다. 포크한 도구 본문(`L2.workspace.plan`)이 원본 시그니처로 `env.exec(…, context)`를 부르기 때문이다.
- F 규칙(`F.readme` §1): `node:*` 타입을 쓰지 않는다. 원본의 `NodeJS.ProcessEnv`는 연결 코드 쪽 생성 옵션에만 있고 아래 계약에는 없다.
- 오류 클래스 두 개(`FileError`, `ExecutionError`)는 F 런타임 예외 4번 "오류 클래스"(`F.readme` §1)에 해당한다.

```ts
// @xeon/contracts/services — exec.ts
import type { Result } from "../base/index.ts";
// services(F 순서 4)는 base·conversation·records·capabilities·extensions를 import type으로만 쓴다(F.readme §3 순서 표)
import type { SecretRef } from "../capabilities/index.ts";      // capabilities/secrets.ts, F.capabilities.spec §3.10. 값은 "secret://<name>"
import type { UseCtx } from "./secrets.ts";                      // services/secrets.ts(F.capabilities.spec §3.12). 초안 L0.secrets.spec §3.3
import type { SandboxRunReport } from "./sandbox-report.ts";       // L0.sandbox.spec §3.1. 순환을 피하려고 따로 둔 파일

/** 취소 신호만 전달한다. DI 기능은 없다(adr.0003 §3.1). */
export interface CancelScope {
  readonly abortSignal: AbortSignal | undefined;
}

export type FileKind = "file" | "directory" | "symlink";
export type FileErrorCode =
  | "aborted" | "not_found" | "permission_denied" | "not_directory"
  | "is_directory" | "invalid" | "not_supported" | "unknown";
export type ExecutionErrorCode =
  | "aborted" | "timeout" | "shell_unavailable" | "spawn_error" | "callback_error" | "unknown"
  // Xeon 추가 [제안]: 원본에 없다. 데코레이터와 연결 코드만 만든다.
  | "env_denied"            // 허용 목록 규칙이 막는 이름을 요청함(3.5절)
  | "secret_unavailable"    // secretEnv의 lease를 얻지 못함(3.6절)
  | "sandbox_unavailable"   // 격리가 필요한데 쓸 수 없음(L0.sandbox.spec §4.5)
  | "sandbox_failed";       // 샌드박스 래핑 자체가 실패함(L0.sandbox.spec §5)

export class FileError extends Error {
  readonly code: FileErrorCode;
  readonly path?: string;
  constructor(code: FileErrorCode, message: string, path?: string, cause?: Error);
}
export class ExecutionError extends Error {
  readonly code: ExecutionErrorCode;
  /** 시간 초과·취소된 명령의 spill 파일. 출력이 spill 임계를 넘은 뒤 끝난 경우만 */
  spillPath?: string;
  constructor(code: ExecutionErrorCode, message: string, cause?: Error);
}

export interface FileInfo { name: string; path: string; kind: FileKind; size: number; mtimeMs: number }
export interface TextLine { text: string; terminated: boolean }
export interface TextLineReader {
  readLine(context: CancelScope): Promise<Result<TextLine | undefined, FileError>>;
  close(context: CancelScope): Promise<void>;
}
export interface LineScan {
  newlines: number; start: number; end: number;
  firstLineEnd: number; lastLineStart: number;
  selectedBytes: number; firstLineBytes: number;
}
export interface BinaryReader {
  info(context: CancelScope): Promise<Result<FileInfo, FileError>>;
  read(offset: number, length: number, context: CancelScope): Promise<Result<Uint8Array, FileError>>;
  scanLines(options: { startLine: number; endLine?: number }, context: CancelScope): Promise<Result<LineScan, FileError>>;
  close(context: CancelScope): Promise<void>;
}
export interface DirReader {
  next(maxEntries: number, context: CancelScope): Promise<Result<{ entries: FileInfo[]; done: boolean }, FileError>>;
  close(context: CancelScope): Promise<void>;
}
export interface WatchTarget {
  path: string;
  recursive?: boolean;
  exclude?: { hidden?: boolean; names?: readonly string[] };
}
export type WatchChange = { paths: string[] } | { overflow: true } | { error: FileError };
export interface FileWatcher {
  readonly mode: "native" | "polling";
  close(context: CancelScope): Promise<void>;
}

export interface FileSystem {
  readonly id: string;
  cwd: string;
  absolutePath(path: string, context: CancelScope): Promise<Result<string, FileError>>;
  joinPath(parts: string[], context: CancelScope): Promise<Result<string, FileError>>;
  readTextFile(path: string, context: CancelScope): Promise<Result<string, FileError>>;
  openTextLineReader(path: string, context: CancelScope): Promise<Result<TextLineReader, FileError>>;
  readTextLines(path: string, options: { maxLines?: number } | undefined, context: CancelScope): Promise<Result<string[], FileError>>;
  readBinaryFile(path: string, context: CancelScope): Promise<Result<Uint8Array, FileError>>;
  openBinaryReader(path: string, options: { noFollow?: boolean } | undefined, context: CancelScope): Promise<Result<BinaryReader, FileError>>;
  writeFile(path: string, content: string | Uint8Array, context: CancelScope): Promise<Result<void, FileError>>;
  appendFile(path: string, content: string | Uint8Array, context: CancelScope): Promise<Result<void, FileError>>;
  truncateFile(path: string, size: number, context: CancelScope): Promise<Result<void, FileError>>;
  flushFile(path: string, context: CancelScope): Promise<Result<void, FileError>>;
  renameFile(sourcePath: string, destinationPath: string, context: CancelScope): Promise<Result<void, FileError>>;
  fileInfo(path: string, context: CancelScope): Promise<Result<FileInfo, FileError>>;
  listDir(path: string, context: CancelScope): Promise<Result<FileInfo[], FileError>>;
  openDirReader(path: string, context: CancelScope): Promise<Result<DirReader, FileError>>;
  watch(targets: readonly WatchTarget[], onChange: (change: WatchChange) => void, context: CancelScope): Promise<Result<FileWatcher, FileError>>;
  canonicalPath(path: string, context: CancelScope): Promise<Result<string, FileError>>;
  exists(path: string, context: CancelScope): Promise<Result<boolean, FileError>>;
  createDir(path: string, options: { recursive?: boolean } | undefined, context: CancelScope): Promise<Result<void, FileError>>;
  remove(path: string, options: { recursive?: boolean; force?: boolean } | undefined, context: CancelScope): Promise<Result<void, FileError>>;
  createTempDir(prefix: string | undefined, context: CancelScope): Promise<Result<string, FileError>>;
  createTempFile(options: { prefix?: string; suffix?: string } | undefined, context: CancelScope): Promise<Result<string, FileError>>;
  cleanup(context: CancelScope): Promise<void>;
}

export interface ShellSpillOptions { afterBytes: number; afterLines: number }
export interface ShellOutputWindow { maxBytes: number; maxLines: number; minIntervalMs: number; bytesPerSecond: number }
export interface ShellOutputSkip { bytes: number; newlines: number; endsWithNewline: boolean }
export interface ShellOutputInfo { stream: "stdout" | "stderr"; skipped?: ShellOutputSkip }

export interface ShellExecOptions {
  cwd?: string;
  /** 자식 env에 더할 이름과 값. 허용 목록 규칙(3.5절)을 통과해야 한다 */
  env?: Record<string, string>;
  /** Xeon 연결 코드에서는 "허용 목록 기본 env를 물려받는가"로 뜻이 바뀐다(4절 B-12) */
  inheritEnv?: boolean;
  /** 초 단위. 원본과 같다 */
  timeout?: number;
  onOutput?: (text: string, context: CancelScope, info: ShellOutputInfo) => void;
  spill?: ShellSpillOptions;
  window?: ShellOutputWindow;
  /** [제안] Xeon 추가, M1. env 이름 → 비밀 참조와 사용 맥락. 값은 spawn 직전에만 env에 들어간다(3.6절) */
  secretEnv?: SecretEnvRequest;
}

/** [제안] M1. secrets의 env 모드 lease(L0.secrets.spec §3.6 withEnv)에 넘길 맥락을 함께 싣는다 */
export interface SecretEnvRequest {
  readonly refs: Readonly<Record<string, SecretRef>>;
  /** mode는 "env", target은 연결 코드가 명령줄에서 채운다. purpose, toolCallId, approval(ApprovalEvidence)은 호출자(L1 tools)가 채운다 */
  readonly ctx: Omit<UseCtx, "mode" | "target">;
}

export interface ShellExecResult {
  exitCode: number;
  spillPath?: string;
  /** [제안] Xeon 추가. 데코레이터가 붙인 실행 정보. 값(비밀, 파일 내용)은 싣지 않는다. 모양은 L0.sandbox.spec §3.1 */
  sandbox?: SandboxRunReport;
}

export interface Shell {
  exec(command: string | readonly string[], options: ShellExecOptions | undefined, context: CancelScope): Promise<Result<ShellExecResult, ExecutionError>>;
  cleanup(context: CancelScope): Promise<void>;
}

export interface ExecutionEnv extends FileSystem, Shell {}

/** 기다리지 않는 실행의 핸들(3.9절). 모양이 L0.process.spec §3.1 BackgroundStopper와 같아 등록자가 그대로 넘긴다 */
export interface BackgroundExecHandle {
  readonly pid: number;
  /** graceful: 프로세스 그룹에 SIGTERM(win32는 taskkill /T). force: killProcessTree. 이미 끝났으면 바로 이행 */
  stop(mode: "graceful" | "force"): Promise<void>;
  readonly exited: Promise<{ readonly code: number | null; readonly signal: string | null }>;
}

/** xeon.exec 서비스. 서비스 값 자체가 ExecutionEnv이고, 작업 디렉터리가 다른 파생 env를 만든다 */
export interface ExecService extends ExecutionEnv {
  /** 같은 구현과 설정을 쓰고 cwd만 다른 env. 파생 env의 cleanup은 그 env가 시작한 명령만 끝낸다 */
  withCwd(cwd: string): ExecutionEnv;
  /** [제안] 종료를 기다리지 않는 실행(3.9절). spawn이 끝나면 이행한다. timeout은 받지 않는다 */
  startBackground(command: string | readonly string[], options: Omit<ShellExecOptions, "timeout" | "spill"> | undefined, context: CancelScope): Promise<Result<BackgroundExecHandle, ExecutionError>>;
}
export const ExecServiceName = "xeon.exec" as const;
```

- `SandboxRunReport`는 `L0.sandbox.spec` §3.1의 초안이고 F 위치는 `services/sandbox-report.ts`다(`F.capabilities.spec` §3.12). `ShellExecResult`가 그 이름을 참조하므로 두 블록은 같은 F 변경(`F.capabilities.plan` P9)으로 옮긴다.
- import 방향 [제안]: `sandbox.ts`는 `exec.ts`(`CancelScope`, `Shell`)를 import한다. 그래서 `exec.ts`가 `sandbox.ts`를 import하면 `import/no-cycle`(타입 import 포함)에 걸린다. `SandboxRunReport`와 `SandboxViolation`은 아무것도 import하지 않는 `services/sandbox-report.ts`에 두고, `exec.ts`와 `sandbox.ts`가 둘 다 이 파일을 import한다. 방향은 `sandbox-report.ts` ← `exec.ts` ← `sandbox.ts` 한 방향이다(`L0.store.spec` §3.1의 `sql.ts` 분리와 같은 방식).
- `SecretRef`는 F `capabilities/secrets.ts`가 정본이고(`F.capabilities.spec` §3.10) settings가 다시 export한다. services(순서 4)는 capabilities를 `import type`으로 쓸 수 있다(`F.readme` §3). `UseCtx`는 같은 서브패스의 `services/secrets.ts`에 있고, 그 파일은 같은 서브패스의 다른 파일을 import하지 않으므로 순환이 없다(`F.capabilities.spec` §3.12 규칙 4).
- [결정(잠정): review.decisions-2 D-04] `xeon.exec`의 F 인터페이스는 `ExecService`(`ExecService extends ExecutionEnv`)다. 세션마다 cwd가 다른 공유 서비스 모드(`L0.process.spec`, ADR-0006)에서 파생 env가 필요해 `withCwd`와 `startBackground`를 더했다. `F.capabilities.spec` §3.12 표와 `eng.context-map.design` §5.3 표가 이 이름을 쓴다.
- [제안] 원본 `Result`, `ok`, `err`는 F 루트(`eng.typescript.guide` §1.2)의 것으로 바꾼다(3.3절 P2). F 계약의 `Result`는 F 루트 타입이다.
- [제안] `CancelScope`는 원본 모양대로 `AbortSignal | undefined`를 받는다. `eng.typescript.guide` §1.2·TY-22 예시는 `AbortSignal`(undefined 없음)이다. 원본 테스트와 적합성 스위트가 취소 없는 호출을 `{ abortSignal: undefined }`로 표현하므로(`D/src/testing/env-conformance.ts`, `BACKGROUND_CONTEXT`) undefined를 허용한다. 10절 [미결] 1과 함께 정한다.

### 3.2 `CancelScope` 위치

| 근거 | 내용 |
|---|---|
| adr.0003 §3.1 [제안] | `CancelScope`와 추출한 도구 타입은 F(`xeon/packages/contracts`)에 둔다. 포크 위치가 L0와 L2로 나뉘기 때문이다 |
| `eng.typescript.guide` §1.2, TY-22 4번 | `CancelScope`는 `platform-exec` 안의 로컬 타입이다. 포크 경계 밖 API는 `AbortSignal`을 받는다. 다른 패키지는 같은 이름을 새로 만들지 않는다 |
| `L2.workspace.plan` 102행 | `CancelScope`는 L0와 L2가 함께 쓰므로 F에 둔다 |

- 위치 [결정(잠정): review.decisions-2 D-04]: F `services/exec.ts`에 둔다(`F.capabilities.spec` §3.12 파일별 이름 표). L2 `cap-workspace`의 포크한 도구 본문(`tools/read.ts:1`, `bash.ts:1`, `file-mutation-queue.ts:1`, `path-utils.ts:1`)이 같은 타입을 쓰고, L2는 L0 패키지를 import할 수 없다(DR-14). 로컬 타입으로 두면 L2가 같은 모양을 다시 선언해야 하고, 이는 TY-22 4번이 금지한 것이다.
- 남은 일은 `eng.typescript.guide` 문구다. 확정은 사용자와 `eng.typescript.guide` 소유자가 한다. TY-22 4번과 §1.2 마지막 항목의 문구를 "F `services`(`@xeon/contracts/services`)의 `CancelScope`. 포크 코드와 그 직접 소비자만 쓴다. 그 밖의 API는 `AbortSignal`을 받는다"로 고치기를 요청한다(8절).

### 3.3 포크 범위, 기록, 바꿀 점

#### 3.3.1 가져오는 파일

[결정: adr.0003 §3.1] env 5파일 2,250줄을 포크한다. 함께 가져오는 검증 자산은 [제안]이다.

| 원본(`D/` = `packages/durable`) | 줄 | 포크 위치(`platform-exec/`) | 내용 |
|---|---|---|---|
| `src/env/index.ts` | 327 | `src/upstream/env/index.ts` | 인터페이스, 오류, `Result` 도우미 |
| `src/env/node.ts` | 1,226 | `src/upstream/env/node.ts` | `NodeExecutionEnv` |
| `src/env/node-watch.ts` | 522 | `src/upstream/env/node-watch.ts` | `NodeFileWatcher`(native·polling) |
| `src/env/decode.ts` | 30 | `src/upstream/env/decode.ts` | `StreamDecoder`, BOM 판정 |
| `src/env/line-scan.ts` | 145 | `src/upstream/env/line-scan.ts` | `LineScanner` |
| `src/testing/env-conformance.ts` | 511 | `src/upstream/testing/env-conformance.ts` | 실행기 독립 적합성 사례(24개) |
| `src/testing/types.ts`(env 부분), `runner.ts`(`registerEnvConformance`), `assertions.ts` | 44·38·39 중 env 관련 부분 | `src/upstream/testing/` | 적합성 스위트가 import하는 타입과 등록기 [제안: brief 목록에 없던 보조 파일. `env-conformance.ts:12`와 `env-node-conformance.test.ts:9`가 import한다] |
| `test/env-node.test.ts` | 1,002 | `test/upstream/env-node.int.test.ts` | 노드 구현 단위·통합 시험 |
| `test/env-node-conformance.test.ts` | 126 | `test/upstream/env-node-conformance.int.test.ts` | 적합성 스위트 등록 |
| `test/env-node-spill.test.ts` | 89 | `test/upstream/env-node-spill.int.test.ts` | spill 역압 시험 |
| `test/env-line-scan.test.ts` | 107 | `test/upstream/env-line-scan.test.ts` | 줄 스캔 단위 시험 |

- 포크 env 폐포의 import는 `node:child_process`, `node:crypto`, `node:fs`, `node:fs/promises`, `node:os`, `node:path`, `node:url`와 Chord `import type` 3줄뿐이다(원본 소스 확인). 외부 npm 의존은 들어오지 않는다.
- `test/env-truncate.test.ts`(98줄)는 `truncate.ts`를 시험하므로 `L2.workspace.plan`으로 간다.
- 테스트 파일 이름의 태그(`.int`)는 `eng.testing.guide` TS-01을 따른다. 실제 자식 프로세스와 파일 시스템을 쓰기 때문이다.

#### 3.3.2 포크 기록 [제안: adr.0003 §3.4]

- `UPSTREAM.json`: `upstream`(`https://github.com/earendil-works/pi`), `commit`(`cdaf6c227d4718a72b59ccd02152c9614df44cfc`), `version`(`1.1.0`), `license`(`MIT`), `copiedPaths`(원본 → 포크 경로 표, 3.3.1절), `notCopied`(`tools/`, `images/`, `truncate.ts`, `harness/`, `session/`, `storage/`, `testing/storage-*`), `modifications`(패치 id 목록).
- `PATCHES.md`: 아래 패치 표와 같은 열(패치 id, 파일:줄, 이유, 확인 테스트).
- `LICENSE.pi`: pi 저장소 루트 `LICENSE`(MIT, "Copyright (c) 2025 Mario Zechner") 원문 사본.
- 패치 표지: 고친 줄 바로 위에 `// XEON-PATCH: <id>`. 세 기록(UPSTREAM.json `modifications`, PATCHES.md 행, 표지)의 id 집합이 같아야 한다(`L0.exec.plan` EX-11 검사).

#### 3.3.3 패치 표

줄 번호는 원본 기준이다. 포크 본문 변경은 아래가 전부다.

| 패치 id | 파일:줄 | 바꾸는 점 | 이유 | 확인 테스트 |
|---|---|---|---|---|
| P1 | `env/index.ts:1`, `env/node.ts:23`, `env/node-watch.ts:5` | `import type { Context } from "@earendil-works/chord"`를 `import type { CancelScope as Context } from "@xeon/contracts/services"`로 바꾼다. 본문의 `context.abortSignal` 접근(`node.ts` 31곳, 예: `:403`, `:624`, `:1082`)과 `Context` 타입 표기는 그대로 둔다 | Chord 제거 [결정: adr.0003 §3.1]. 별칭 import로 본문 diff를 3줄로 줄인다 [제안] | `tsc -b`가 chord 미설치 상태에서 통과. `grep -rnE "from ['\"][^'\"]*chord" src test` 0건(adr.0003 §4.2 검증 1·3) |
| P2 | `env/index.ts:3-17` | 자체 `Result`, `ok`, `err`를 지우고 `export type { Result } from "@xeon/contracts"`, `export { ok, err } from "@xeon/contracts"`로 바꾼다. `getOrThrow`, `getOrUndefined`, `toError`(:14-32)는 남긴다 | 모양 대조 결과 같다: 원본 `{ ok: true; value } \| { ok: false; error }`, F `{ readonly ok: true; readonly value } \| { readonly ok: false; readonly error }`(`eng.typescript.guide` §1.2). 원본의 두 타입 인자 `ok<TValue, TError>`는 F의 `ok<T>(): Result<T, never>`로 바뀐다. 원본 env 안에 타입 인자를 직접 쓴 호출(`ok<`, `err<`)이 없음을 확인했다 | 타입체크. 적합성 스위트 전체 통과 |
| P3 | `env/node.ts:76, 194, 224, 275, 805, 971`, `env/node-watch.ts:184, 294, 415, 512` | `process.platform` 분기 10곳을 `ExecPlatformProvider`(3.4절) 질의로 바꾼다. `NodeExecutionEnv` 생성 옵션과 `NodeWatchOptions`에 `platform: ExecPlatformProvider`를 더한다. `node.ts:226, 228, 278`의 `process.env` 읽기(Git Bash 후보, `SystemRoot`)는 win32 provider로 옮긴다 | DR-13, 3.4절. [제안] brief는 `node.ts` 6곳을 적었으나 원본 확인 결과 `node-watch.ts`에도 4곳(win32 polling 강제, darwin FSEvents 재스캔, linux 디렉터리별 감시, linux statfs 검사)이 있다 | `process-platform-scan` 검사(9절 7번), provider별 단위 시험 |
| P4 | `test/env-*.test.ts` 4파일 | `vitest`를 `bun:test`로 바꾼다. `vi.spyOn`(`env-node.test.ts:442, 541`)은 `spyOn`, `vi.restoreAllMocks`(:139)는 `mock.restore`, `env-node-spill.test.ts:12-15`의 `vi.hoisted` + `vi.mock("node:fs")`는 `mock.module("node:fs", …)`로 옮긴다 | Vitest 미사용 [결정: `_research/foundation-plan.md` §2 테스트 행] | 포팅한 4파일 통과. `mock.module` 예외 기록(5.3절) |
| P5 | `src/testing/env-conformance.ts:1-2`, `test/env-node.test.ts:7`, `test/env-node-conformance.test.ts:5`, `test/env-node-spill.test.ts:5` | `BACKGROUND_CONTEXT`를 `{ abortSignal: undefined }`로, `withAbortSignal(ctx, signal)`을 `{ abortSignal: signal }` 직접 조합으로 바꾼다. `env-conformance.ts:1`의 `import type { Context }`는 P1과 같은 별칭 import로 바꾼다 | Chord 값 import 제거(`_research/durable-and-search-facts.md` §A-3) | 적합성 스위트 통과 |
| P6 | `env/index.ts:34-74` | `FileError`, `ExecutionError` 클래스와 코드 유니온 선언을 지우고 F에서 다시 export한다 | F 계약(3.1절)과 포크가 같은 클래스를 써야 `instanceof`(`node.ts:119`, `node-watch.ts:271`)와 L2 도구 본문의 판정이 한 클래스로 맞는다 [제안] | 타입체크, `instanceof` 경로 시험(`env-node.int.test.ts`) |

- 원본 인터페이스 선언(`index.ts:76-324`)은 지우지 않는다. 업스트림 diff를 작게 두기 위해서다. 대신 계약 시험 `test/exec-contract.contract.test.ts`가 포크 선언과 F 선언이 서로 대입 가능함을 타입 수준에서 확인한다 [제안].
- 포크 코드가 TS 규칙을 지킬 수 없는 줄은 `eng.typescript.guide` §1 "포크 코드"와 §4.1 형식으로 표시한다. 예상되는 예외(줄 단위 주석, 이유 `(eng.typescript.guide §1 포크 코드)`):

| 규칙 | 위치 | 이유 |
|---|---|---|
| TY-11(`throw`는 `Bug`만) | `index.ts:14-17` `getOrThrow` | 원본 시험 110여 곳이 쓴다. 시험 도우미로만 쓰고 운영 코드에서는 쓰지 않는다 |
| TY-12(판별 필드 `kind`) | `FileError.code`, `ExecutionError.code` | L2 도구 본문과 적합성 스위트가 `.code`로 분기한다. 이름을 바꾸면 포크 diff가 커진다 |
| TY-16(클래스) | `NodeExecutionEnv`, reader 클래스들 | 원본 구조 |
| TY-21(난수 주입) | `node.ts:1212` `randomUUID()` | 임시 파일 이름의 충돌 방지용이고 도메인 ID가 아니다 |

### 3.4 OS 분기: `ExecPlatformProvider`

[결정: `eng.dependency-rules.guide` DR-13] OS 분기는 `platform-exec/src/` 안에만 두고, 선택은 `src/select.ts` 한 곳에서 한다. 소비자 코드에는 OS 분기가 없다.

```ts
// platform-exec/src/provider.ts [제안]
import type { Result } from "@xeon/contracts";
import type { ExecutionError } from "@xeon/contracts/services";

export interface ShellConfig {
  readonly shell: string;
  readonly args: readonly string[];
  /** 구형 WSL bash.exe는 명령을 stdin으로 받는다(-s) */
  readonly commandTransport?: "argv" | "stdin";
}

export type ExecPlatform =
  | { readonly kind: "darwin" }
  | { readonly kind: "linux"; readonly wsl: boolean }
  | { readonly kind: "win32" };

export interface ExecPlatformProvider {
  readonly platform: ExecPlatform;
  /** node.ts:76 — "~\\"를 홈 기준 경로로 읽는가 */
  readonly backslashTilde: boolean;
  /** node.ts:224 — 고정 후보 경로. darwin·linux ["/bin/bash"], win32 Git Bash 후보 */
  shellCandidates(): readonly string[];
  /** node.ts:194 — PATH에서 bash를 찾는 명령. ["which", "bash"] | ["where", "bash.exe"] */
  readonly bashLookup: readonly [string, ...string[]];
  /** node.ts:258 — bash가 없을 때 쓰는 셸. POSIX {sh -c}, win32 없음(shell_unavailable) */
  readonly fallbackShell: ShellConfig | undefined;
  /** node.ts:213 — 경로에 맞는 bash 인자(구형 WSL bash.exe 판정 포함) */
  bashConfig(path: string): ShellConfig;
  /** node.ts:275 — 프로세스 트리 종료. POSIX kill(-pid, SIGKILL) 후 kill(pid), win32 taskkill /F /T */
  killProcessTree(pid: number): void;
  /** node.ts:805 — spawn detached 값. POSIX true(새 프로세스 그룹), win32 false */
  readonly detachedSpawn: boolean;
  /** node.ts:971 — noFollow 구현. POSIX "open_flag"(O_NOFOLLOW), win32 "lstat_precheck"(경합 가능) */
  readonly noFollow: "open_flag" | "lstat_precheck";
  /** node-watch.ts:184 — 기본 감시 방식을 polling으로 강제하는가(win32) */
  readonly forcePollingWatch: boolean;
  /** node-watch.ts:512 — statfs magic으로 감시 신뢰도가 낮은 파일 시스템을 판정하는가(linux) */
  readonly statfsUnreliableCheck: boolean;
  /** node-watch.ts:415 — 디렉터리마다 native watcher를 두는가(linux). 아니면 대상마다 recursive 하나 */
  readonly perDirectoryWatchers: boolean;
  /** node-watch.ts:294 — 감시 설치 뒤 FSEvents 지연 보정 재스캔을 하는가(darwin, 500 ms) */
  readonly fsEventsSettleRescan: boolean;
  /** 자식 env 허용 목록에 OS가 더하는 이름(3.5절). win32: SystemRoot, ComSpec, PATHEXT, USERPROFILE, TEMP, TMP */
  readonly envAllowlistExtra: readonly string[];
}
```

```ts
// platform-exec/src/select.ts [제안]
export type ExecSelectError = { readonly kind: "unsupported_platform"; readonly platform: string };

/** process.platform을 읽는 유일한 곳. wsl 판정 기준은 L0.os.spec §3.1과 같다 */
export function selectExecPlatform(input: {
  readonly platform: string;                                     // process.platform
  readonly env: Readonly<Record<string, string | undefined>>;     // process.env 읽기 전용 사본(WSL_DISTRO_NAME)
  readonly procVersion: string | undefined;                       // linux만 /proc/version 내용
}): Result<ExecPlatformProvider, ExecSelectError>;
```

- 구현 파일: `src/providers/darwin.ts`, `src/providers/linux.ts`(WSL은 `wsl: true` 변종), `src/providers/win32.ts`.
- `select.ts`는 `"darwin" | "linux" | "win32"` 밖의 값(`freebsd`, `android` 등)을 `err({ kind: "unsupported_platform" })`로 돌려준다(DR-13 열린 외부 값 규칙, TY-14). 원본은 `android`를 linux처럼 다룬다(`node-watch.ts:415, 512`). Xeon은 android를 지원 목록에 넣지 않는다 [제안].
- WSL 판정 기준은 `L0.os.spec` §3.1을 따른다: `platform === "linux"`이고 `WSL_DISTRO_NAME`이 비어 있지 않거나 `/proc/version`에 `microsoft` 또는 `WSL`(대소문자 무시)이 있으면 `wsl: true`다(`L0.readme` §3.1 WSL 판정 행). exec에서 WSL 여부는 동작을 바꾸지 않는다. `/mnt/*`(9P)는 원본의 statfs 판정(`node-watch.ts:67` `0x01021997`)이 polling으로 바꾼다.

### 3.5 자식 프로세스 환경 변수 허용 목록

원본은 `inheritEnv`가 기본 참이고 부모 `process.env` 전체를 자식에 넘긴다(`node.ts:262-271` `getShellEnv`). Xeon 연결 코드는 이 경로를 쓰지 않는다. 포크한 `exec`에는 항상 `inheritEnv: false`와 아래 빌더의 결과를 `env`로 넘긴다 [제안]. 포크 본문은 바꾸지 않는다.

```ts
// platform-exec/src/env-builder.ts [제안]
export interface EnvPolicy {
  /** 부모 env에서 값을 그대로 옮기는 이름 */
  readonly pass: readonly string[];
  /** 부모 값과 무관하게 고정하는 값 */
  readonly fixed: Readonly<Record<string, string>>;
  /** 어떤 경로로도 자식에 넣지 않는 이름 패턴. 끝의 *만 와일드카드다 */
  readonly deny: readonly string[];
}

export const BASE_ENV_POLICY: EnvPolicy;

export type EnvBuildError = { readonly kind: "env_denied"; readonly names: readonly string[] };

/** 순수 함수. 부모 env, 정책, 설정 추가분, 호출자 요청에서 자식 env를 만든다 */
export function buildChildEnv(input: {
  readonly parent: Readonly<Record<string, string | undefined>>;
  readonly policy: EnvPolicy;
  readonly extraPass: readonly string[];          // l0.exec.envAllowlist.extra + provider.envAllowlistExtra
  readonly requested: Readonly<Record<string, string>> | undefined;   // ShellExecOptions.env
  readonly inherit: boolean;                       // ShellExecOptions.inheritEnv ?? true
}): Result<Record<string, string>, EnvBuildError>;
```

`BASE_ENV_POLICY` [제안, `docs/design/18-security.md` §3.11.1 R-2를 Xeon 이름으로 옮김]:

| 구분 | 이름 |
|---|---|
| `pass` | `PATH`, `HOME`, `USER`, `LOGNAME`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`, `TMPDIR`, `SHELL` |
| `fixed` | `TERM=dumb`, `NO_COLOR=1`, `CI=1`. `LANG`이 부모에 없으면 `LANG=C.UTF-8` |
| `deny` | `*_TOKEN`, `*_KEY`, `*_SECRET`, `*_PASSWORD`, `*_API_KEY`, `SOPS_*`, `SOPS_AGE_*`, `AGE_*`, `OP_*`, `BWS_*`, `BW_SESSION`, `AWS_*`, `ANTHROPIC_*`, `OPENAI_*`, `GEMINI_*`, `OPENROUTER_*`, `XEON_*`, `SSH_AUTH_SOCK`, `DBUS_SESSION_BUS_ADDRESS`, `XDG_RUNTIME_DIR`, `WSL_INTEROP`, `WSL_DISTRO_NAME`, `NODE_OPTIONS`, `BUN_OPTIONS` |

- [제안] 자식 env 거부 목록의 정본은 F 상수 `SENSITIVE_ENV_PATTERNS`(`@xeon/contracts/services`의 `services/exec.ts`, `F.capabilities.spec` §3.12) 하나다. 위 `deny` 행이 그 값이고 `BASE_ENV_POLICY.deny`는 이 상수를 그대로 쓴다. `L0.sandbox.spec`의 자가 시험(env 허용 목록 항목)과 `L0.secrets.spec` §4.5(sops 호출 env)도 같은 상수를 쓴다. secrets 서비스에는 별도 거부 목록(`childEnvPolicy`)을 두지 않으므로 `xeon.exec`는 `xeon.secrets`가 없어도 같은 목록으로 동작한다. 비밀 제공자 변수(`SOPS_*`, `AGE_*`, `OP_*`, `BWS_*`, `BW_SESSION`, `XEON_*` 아래 `XEON_SECRET_*`)가 모두 이 목록에 들어 있다.

규칙:

1. 결과 = (`inherit`이면 `pass` ∪ `extraPass` 이름의 부모 값) ⊕ `fixed` ⊕ `requested`. 뒤가 앞을 덮는다.
2. `deny` 패턴에 맞는 이름은 `pass`·`extraPass`에 있어도 옮기지 않는다. `requested`에 있으면 `err({ kind: "env_denied", names })`이고 연결 코드는 `ExecutionError("env_denied")`로 돌려준다. 명령은 실행되지 않는다.
3. `l0.exec.envAllowlist.extra`에 `deny` 패턴에 맞는 이름을 적으면 설정 검증에서 거부한다(6절). 목록은 더하기만 할 수 있고 `pass`를 줄일 수 없다.
4. `secretEnv`(3.6절)로 넣는 이름만 `deny` 규칙을 따르지 않는다. 비밀을 넣는 명시 경로가 이것 하나다.
5. `inheritEnv: false`이면 `pass`·`extraPass`를 옮기지 않고 `fixed`와 `requested`만 쓴다. 어떤 경우에도 부모 `process.env` 전체를 넘기지 않는다.
6. 원본 생성 옵션 `shellEnv`(`node.ts:612`)는 쓰지 않는다(`undefined`).

### 3.6 비밀 주입 지점 `ShellExecOptions.secretEnv` (M1)

[제안] 계획 v2 L0-c "값은 도구를 실행하기 직전에만 풀리고 … 도구 자식 프로세스의 기본 env에는 들어가지 않는다"(`_research/layer-plan-v2.json` L0-c note)와 `_research/secrets.md` §6.2 M1 env 모드(M1은 사용 모드 번호다)를 구현하는 지점이다.

단계 [결정(잠정): review.decisions-2 U-19]: 마일스톤 M1의 비밀 검증 경로는 bash 도구의 env 주입(실행마다 승인)이다. 그래서 이 주입 지점과 `SecretEnvRequest`, `secret_unavailable` 코드를 M1에 둔다. `L0.secrets.spec` §3.6 `withEnv`, `L2.workspace.spec` §3.3과 같은 배치다.

구현의 전제 [제안]:

- `xeon.secrets`가 env 모드 lease 메서드 `withEnv`(`L0.secrets.spec` §3.6)를 제공한다. 이 메서드는 `SecretService.lease(handle, ctx)`와 같은 `UseCtx`를 받는다.
- `SecretEnvRequest.ctx`가 `UseCtx`에서 `mode`·`target`을 뺀 값을 싣는다. `purpose`(예: `"bash:gh"`), `toolCallId`, `threadId`, `projectId`, `approval`(`ApprovalEvidence`, env 모드는 `per-use` 필수)은 L1 tools가 승인 뒤 채운다. 연결 코드는 `mode: "env"`, `target: { kind: "command", argv0, commandLine }`을 실행할 명령에서 채운다.

순서(연결 코드 `src/service.ts`의 `exec`):

1. `buildChildEnv`로 기본 env를 만든다. 실패하면 3번 이후를 하지 않는다.
2. `signal`이 이미 취소됐으면 `aborted`.
3. `secretEnv.refs`의 각 항목에 대해 `xeon.secrets`의 env 모드 lease를 요청한다(`withEnv`, 인자는 `secretEnv.ctx`와 위에서 채운 `mode`·`target`). 하나라도 실패하면 이미 얻은 lease를 모두 폐기하고 `ExecutionError("secret_unavailable")`를 돌려준다. 오류 메시지에는 참조 이름(`secret://…`)만 넣는다.
4. lease 값을 기본 env 사본에 넣어 포크 `exec`를 부른다(`inheritEnv: false`).
5. `exec`가 끝나면(성공, 실패, 취소, 시간 초과 모두) `finally`에서 lease를 폐기하고 env 사본의 참조를 버린다.

규칙:

- `platform-exec`는 `platform-secrets`를 import하지 않는다(DR-02). `xeon.secrets`는 Cordis로 주입받는다. 서비스가 없으면 `secretEnv`가 있는 호출은 `secret_unavailable`이다.
- 값은 지역 변수와 spawn 인자에만 있다. 인스턴스 필드, 캐시, 로그, 오류 메시지, `ShellExecResult`, `onOutput` 호출 인자에 넣지 않는다. 자식이 출력으로 값을 되돌려 보내는 경우의 마스킹은 `L0.secrets.spec`과 `L1.tools.spec`이 한다.
- `secretEnv`는 모델 도구 파라미터로 노출하지 않는다(`L2.workspace.spec` 454행). 승인과 명령 패턴 검사는 `L1.tools.spec`이 이 호출 전에 한다(`_research/secrets.md` §6.2 "M1은 승인과 명령 패턴이 있을 때만").
- 데코레이터(`L0.sandbox.spec`의 `wrapShell`)는 `secretEnv`를 해석하지 않고 그대로 아래 `Shell`에 넘긴다. 그래서 값은 샌드박스 래핑 뒤, spawn 직전에만 env에 들어간다.

### 3.7 데코레이션 가능한 `Shell`

exec와 sandbox는 서로 import하지 않고 F의 `Shell` 인터페이스로만 만난다. `xeon.sandbox`의 `wrapShell`은 F `Shell`을 받아 F `Shell`을 돌려주고, 두 서비스의 조립은 L1 tools 또는 apps/host가 한다.

`Shell` 구현이 지킬 것 [제안]:

1. `exec`와 `cleanup`은 인스턴스의 숨은 상태 없이 인자만으로 동작한다. 감싼 쪽이 `exec`만 바꿔 넘겨도 원래 동작이 유지된다.
2. 인식하지 못한 옵션 필드를 지우지 않고 아래로 전달한다(`secretEnv`, `window`, `spill`, `onOutput`).
3. `command`는 문자열(셸 경유)과 argv 배열(셸 없이 직접 실행) 둘 다 받는다. 데코레이터가 문자열을 argv로 바꿔 넘겨도 같은 결과 계약을 지킨다.
4. `ShellExecResult`에 데코레이터가 필드(`sandbox`)를 더할 수 있다. 구현은 모르는 필드를 지우지 않는다.
5. `cleanup`은 감싼 쪽이 아래 `cleanup`을 부르는 것으로 충분하다.
- `ExecutionEnv` 전체를 넘겨야 하는 소비자(포크한 도구 본문)를 위해, 조립하는 쪽은 파일 메서드는 원래 env에, `exec`·`cleanup`은 감싼 `Shell`에 위임하는 객체를 만든다. 이 조립 도우미의 위치는 `L1.tools.spec`이 정한다(8절 요구).

### 3.8 서비스 등록과 생성 옵션

```ts
// platform-exec/src/service.ts [제안]
import type { ExecService } from "@xeon/contracts/services";

export interface ExecServiceOptions {
  readonly cwd: string;                         // 엔진 시작 cwd
  readonly shellPath: string | undefined;       // l0.exec.shell
  readonly defaultTimeoutMs: number;            // l0.exec.defaultTimeoutMs, 0이면 없음
  readonly outputSpillBytes: number;            // l0.exec.outputSpillBytes, 0이면 기본 spill 없음
  readonly envExtra: readonly string[];         // l0.exec.envAllowlist.extra
}

/** 포크 NodeExecutionEnv와 provider, env 빌더, 비밀 주입을 묶는다. Cordis 등록은 ext-host API로 한다 */
export function createExecService(
  options: ExecServiceOptions,
  deps: { readonly platform: ExecPlatformProvider; readonly secrets: SecretService | undefined; readonly parentEnv: Readonly<Record<string, string | undefined>> },
): ExecService;
```

- 등록은 ext-host의 서비스 등록 API로 하고(adr.0003 §3.3, `X.primitives.spec`), 이름은 `ExecServiceName`(`"xeon.exec"`)이다. `platform-exec`는 Cordis를 직접 import하지 않는다(DR-11).
- 플러그인 dispose 때 서비스 `cleanup`을 한 번 부른다. 파생 env(`withCwd`)의 `cleanup`은 파생 env를 만든 소유자가 부른다.
- `defaultTimeoutMs`는 호출자가 `timeout`을 주지 않았을 때만 쓴다. 원본 `timeout`이 초 단위이므로 `defaultTimeoutMs / 1000`으로 넘긴다.
- `outputSpillBytes`는 호출자가 `spill`을 주지 않았을 때 `{ afterBytes: outputSpillBytes, afterLines: Number.MAX_SAFE_INTEGER }`로 넘긴다.

### 3.9 백그라운드 실행 `startBackground` [제안]

`L0.process.spec` §4.3의 백그라운드 레지스트리는 등록자가 `pid`와 `BackgroundStopper`를 넘긴다고 전제한다. `Shell.exec`는 종료까지 기다리는 호출이고 pid와 개별 정지 수단을 돌려주지 않으므로, 그 전제를 채우는 실행 계약을 여기서 정한다.

- `withCwd` 파생 env의 `cleanup`으로는 대신하지 않는다. `cleanup`은 그 env의 모든 명령을 SIGKILL로 끝내는 소유자 종료용이고(B-18), pid를 주지 않으며 graceful과 force를 나누지 않는다.
- `startBackground(command, options, context)`는 포크 `exec`를 쓰지 않고 연결 코드 `src/background.ts`가 직접 spawn한다. 실행 형태(문자열은 셸, argv는 직접 실행), 자식 env 구성(3.5절), `onOutput`·`window` 전달, `detachedSpawn`(새 프로세스 그룹)은 `exec`와 같다. `timeout`과 `spill`은 받지 않는다. 출력 보관은 호출자가 `onOutput`으로 한다.
- spawn이 성공하면 `ok(BackgroundExecHandle)`이다. 실패는 `exec`와 같은 `ExecutionError` 코드(`spawn_error`, `shell_unavailable`, `env_denied`)다.
- `stop("graceful")`은 POSIX에서 프로세스 그룹에 SIGTERM, win32에서 `taskkill /T /PID`(강제 아님)다. `stop("force")`는 `ExecPlatformProvider.killProcessTree`다. 이미 끝난 프로세스면 아무것도 하지 않고 이행한다. graceful 뒤 기다리는 시한은 레지스트리(`BackgroundRegistry.stop`의 `graceMs`)가 정한다.
- `exited`는 프로세스가 끝나면 종료 코드와 신호 이름으로 이행한다.
- `context.abortSignal`이 취소되면 `stop("force")`와 같다.
- 결과 모양이 `BackgroundStopper`(`L0.process.spec` §3.1)와 같으므로 등록자(L1 tools, L2 mcp)는 `{ label, owner, pid: handle.pid, stopper: handle }`로 `BackgroundRegistry.register`를 부른다. `platform-exec`는 레지스트리를 부르지 않는다(DR-02).
- 서비스 dispose 때 서비스 `cleanup`이 아직 살아 있는 백그라운드 프로세스도 끝낸다. 파생 env의 `cleanup`은 그 env로 시작한 백그라운드 프로세스만 끝낸다.
- 단계: 1차 계약, 구현은 M2 이후(`L0.exec.plan` EX-20). stdin 파이프가 필요한 MCP stdio 서버를 이 계약으로 띄울지는 10절 9번이다.

## 4. 동작 규칙

### 4.1 원본 보장 표

원본 인터페이스 주석(`D/src/env/index.ts:76-324`)의 보장을 옮긴다. "변경" 열은 Xeon 연결 코드에서 바뀌는지다.

| # | 대상 | 보장 | 원본 위치 | 변경 |
|---|---|---|---|---|
| B-1 | 전체 | 예상 가능한 실패는 throw하지 않고 `Result`로 돌려준다(`FileError`, `ExecutionError`) | `index.ts:170` | 변경 없음(`Result` 타입만 F 것, P2) |
| B-2 | `FileSystem.id` | 같은 id는 cwd와 무관하게 같은 경로에서 같은 파일을 본다. 로컬 env는 모두 `"node:local"` 하나다 | `:172-176`, `node.ts:605` | 변경 없음. 파생 env(`withCwd`)도 같은 id |
| B-3 | `BinaryReader` | 연 파일 하나에 대한 위치 읽기. 경로가 rename되어도 같은 파일을 본다. `info`는 연 파일의 메타데이터 | `:96-100` | 변경 없음 |
| B-4 | `BinaryReader.read` | 최대 `length` 바이트. 파일 끝에서만 적게 돌려준다 | `:101` | 변경 없음 |
| B-5 | `scanLines` | 한 번의 훑기로 `[startLine, endLine)` 위치를 찾는다. 줄 k는 k번째 개행 바이트 뒤에서 시작한다. 디코드 크기는 `TextDecoder().decode(file)` 기준이라 시작 BOM을 세지 않는다 | `:103-108` | 변경 없음 |
| B-6 | `openBinaryReader` | 디렉터리는 `is_directory`, 그 밖의 비정규 파일은 `invalid`. `noFollow`면 마지막 경로 성분의 심볼릭 링크를 `invalid`로 거부한다. 앞 성분은 해석한다 | `:192-197` | 구현만 provider로 이동(P3). win32는 사전 lstat이라 경합 가능(5.2절) |
| B-7 | `watch` | 감시자가 돌아오면 감시 범위가 성립한다. 감시 후 적재하는 호스트는 적재 중 변경을 놓치지 않는다. 호출은 거짓 양성이 있을 수 있고, 정상인 동안 변경을 놓치지 않는다 | `:123-131`, `:220-224` | 변경 없음 |
| B-8 | `WatchChange` | `paths`(경로 이하 변경 가능), `overflow`(전체 재스캔 필요), `error`(감시 중지, 이후 호출 없음) | `:123-131` | 변경 없음 |
| B-9 | `FileWatcher.mode` | `native`는 약 2초 안 보고. `polling`은 스냅숏 비교라 두 스냅숏 사이에 되돌린 변경을 놓칠 수 있다 | `:134-141` | 변경 없음 |
| B-10 | `DirReader.next` | 파일 시스템 순서로 최대 `maxEntries`. `done`은 마지막 항목과 함께 또는 빈 페이지로 온다. 메타데이터를 읽기 전에 사라진 항목, 지원하지 않는 종류는 건너뛴다. 실패·취소 뒤에는 닫는다 | `:159-167` | 변경 없음 |
| B-11 | `Shell.exec` 명령 형태 | 문자열은 env의 셸로, 배열은 `command[0]`을 셸 없이 직접 실행하고 나머지를 해석 없이 인자로 넘긴다 | `:310-315` | 변경 없음 |
| B-12 | `ShellExecOptions.inheritEnv` | 원본: 참이면 부모 env 전체를 물려받는다 | `node.ts:262-271` | **변경됨**: 참이면 허용 목록 기본 env만, 거짓이면 `fixed`와 요청분만(3.5절) |
| B-13 | `onOutput` | stdout·stderr의 디코드한 조각을 도착 순서로, 원본 그대로, 상한·조절 없이 받는다. 스트림마다 따로 디코드하므로 조각 경계에 걸친 문자가 보존된다 | `:276-280` | 변경 없음 |
| B-14 | `spill` | 출력이 `afterBytes` 또는 `afterLines`를 넘으면 전체 원출력을 임시 파일에 쓰고 `spillPath`로 알린다. 시간 초과·취소된 명령도 `ExecutionError.spillPath`로 알린다 | `:230-235`, `:66` | **변경됨**: 호출자가 `spill`을 주지 않으면 `l0.exec.outputSpillBytes`를 기본으로 쓴다(3.8절) |
| B-15 | `window` | 호출자가 꼬리만 남길 때 env는 범위 밖 출력을 빼고 `info.skipped`로 알린다. `window`가 없으면 모든 조각을 준다 | `:282-286`, `:290-307` | 변경 없음 |
| B-16 | `skipped` 크기 | 빠진 텍스트의 UTF-8 바이트(U+FFFD는 3바이트), 개행 수, 개행으로 끝나는지. 빠짐 바로 뒤 조각은 창보다 1바이트 또는 1줄 이상 크다. 그래서 빠진 텍스트는 남길 꼬리에 들어갈 수 없다. 빠짐과 조각은 두 스트림에 걸칠 수 있고 `stream`은 조각의 마지막 스트림이다 | `:290-307` | 변경 없음 |
| B-17 | 취소·시간 초과 | 컨텍스트 취소나 시간 초과는 이 명령의 프로세스만 끝낸다. `aborted`와 `timeout`을 구분한다 | `:313-314` | 변경 없음. 종료 수단은 provider(P3) |
| B-18 | `Shell.cleanup` | 이 env가 아직 실행 중인 모든 명령을 끝낸다. 소유자 종료용이고 요청 하나를 위해 부르지 않는다 | `:321-322` | 변경 없음. 파생 env는 자기 명령만(3.1절) |
| B-19 | `timeout` 단위 | 초. 양의 유한수이고 최대 2,147,483.647초 | `node.ts:49-69` | 변경 없음. 설정 키는 ms라 연결 코드가 변환한다 |

### 4.2 실패 표현

- 예상 가능한 실패는 모두 `Result`다. 연결 코드가 더하는 실패(`env_denied`, `secret_unavailable`)도 `ExecutionError` 코드로 돌려준다.
- throw는 버그(`Bug`)에 한정한다(`eng.typescript.guide` TY-11). 원본 `onOutput` 콜백이 던진 예외는 원본이 `callback_error`로 바꾼다(`node.ts` 실행부).
- 종료 코드가 0이 아닌 명령도 `ok({ exitCode })`로 돌려준다. 실패 판정은 소비자(L2 `exit_nonzero`)가 한다.

### 4.3 취소와 정리

- 취소는 `CancelScope.abortSignal`로만 받는다. 취소되면 그 명령의 프로세스 그룹(POSIX) 또는 프로세스 트리(win32)를 끝내고 `aborted`를 돌려준다.
- `cleanup()`은 소유자 종료 때만 부른다. 도구 호출 하나가 끝날 때 부르지 않는다. 다른 요청의 명령까지 끝내기 때문이다(B-18).
- spill 파일은 원본이 OS 임시 디렉터리에 `pi-output-<uuid>.log`로 만들고 지우지 않는다(`node.ts:780`, `:1206-1214`). 지우는 시점과 위치는 10절 [미결] 4다.

### 4.4 줄 스캔 API

- `BinaryReader.scanLines`와 `LineScanner`는 개행 바이트(0x0A)만 줄 경계로 센다. CRLF 파일의 `\r`은 줄 내용에 남는다. 표시용 정리는 소비자(L2 `read`)가 한다.
- 시작 BOM은 크기 계산에서 빠진다(B-5). `startsWithBom`, `rangeDecoder`, `StreamDecoder`는 `index.ts:326-327`에서 다시 export한다. 연결 코드 `src/index.ts`도 같은 이름을 다시 export한다.

### 4.5 원본에서 바뀌지 않는 것

- 재생 규칙은 없다. `xeon.exec`는 이벤트를 쓰지 않고 이벤트 type을 소유하지 않는다(`eng.context-map.design` §4.1 platform-execution 행 "없음"). 도구 효과의 의도·결과 기록과 재생 판단은 `L1.tools.spec`이 한다.

## 5. 실패와 경계 사례

### 5.1 경계 사례

| 사례 | 동작 |
|---|---|
| cwd가 없음 | `spawn_error`, 메시지 "Working directory does not exist"(`node.ts:681-692`) |
| 빈 argv | `spawn_error`("Empty argv")(`node.ts:676`) |
| 셸을 찾지 못함(win32에 Git Bash 없음) | `shell_unavailable`. 메시지에 탐색한 후보 경로와 설치 안내(`node.ts:238-250`) |
| `l0.exec.shell` 경로가 없음 | `shell_unavailable`("Custom shell path not found")(`node.ts:222`) |
| timeout이 0·음수·무한·최대 초과 | `timeout` 오류로 거부(`node.ts:59-69`) |
| spill 쓰기 실패 | `unknown`("Failed to preserve complete shell output")(`node.ts:752-757`) |
| `requested` env에 금지 이름 | `env_denied`, 실행하지 않음(3.5절) |
| lease 실패 | `secret_unavailable`, 실행하지 않음, 얻은 lease 폐기(3.6절) |
| 감시 대상 트리가 상한(기본 디렉터리 10,000개)을 넘음 | `WatchChange { error }`, 이후 호출 없음(`node-watch.ts:54`) |
| 지원 밖 OS | `select.ts`가 `unsupported_platform`. 서비스를 등록하지 않고 시작 로그와 doctor에 남긴다 |

### 5.2 플랫폼별 제약

1차 지원은 macOS와 Linux(WSL2 포함)다 [결정: `_research/decisions-log.md` 2026-10-19]. Windows 네이티브 열은 원본 코드에 있는 동작과 확인하지 않은 제약이다.

| 항목 | macOS | Linux(WSL2 포함) | Windows 네이티브 |
|---|---|---|---|
| 셸 | `/bin/bash`, 없으면 `which bash`, 없으면 `sh -c` | 같음 | bash.exe 필요. 순서: `%ProgramFiles%\Git\bin\bash.exe` → `%ProgramFiles(x86)%\Git\bin\bash.exe` → `where bash.exe` 첫 결과. 없으면 `shell_unavailable`(`node.ts:224-250`) |
| 구형 WSL bash.exe | 해당 없음 | 해당 없음 | `C:\Windows\System32\bash.exe`·`Sysnative\bash.exe`는 명령을 stdin으로 보낸다(`-s`, `node.ts:208-215`) |
| 프로세스 트리 종료 | `process.kill(-pid, SIGKILL)`, 실패하면 `kill(pid)` | 같음 | `taskkill.exe /F /T /PID`(`node.ts:275-290`). 프로세스 그룹 kill(`-pid`)은 없다 |
| spawn `detached` | 참: 새 프로세스 그룹을 만들어 그룹 kill을 가능하게 한다 | 같음 | 거짓. Windows의 `detached`는 새 콘솔을 뜻해 의미가 다르다(`node.ts:805`) |
| `noFollow` | `O_NOFOLLOW`, ELOOP/EMLINK를 `invalid`로 | 같음 | `O_NOFOLLOW` 없음. 열기 전 `lstat` 검사라 경합 가능(`node.ts:971-973`) |
| FIFO 열기 | `O_NONBLOCK`으로 쓰기 쪽을 기다리지 않음 | 같음 | 해당 플래그 없음 |
| 감시 | native(FSEvents). 설치 직후 변경 약 2%가 누락되므로 500 ms 뒤 재스캔(`node-watch.ts:47-52`) | native, 디렉터리마다 watcher. NFS·SMB·FUSE·9P 등은 statfs로 판정해 polling(`node-watch.ts:60-70`) | 기본 polling. native 감시가 상위 디렉터리 rename을 막기 때문이다(`node-watch.ts:180-186`) |
| WSL `/mnt/*` | 해당 없음 | 9P라 polling으로 바뀐다. 감시 지연(기본 2초 간격)과 잠금 신뢰도가 낮다 [가정: 잠금은 `L0.store.spec`·`_research/notes/L0-2.md`에서 `/mnt/c` 미실측] | 해당 없음 |
| 경로 | POSIX | POSIX | 드라이브 문자, `\` 구분자, `~\` 확장(`node.ts:76`), 경로 길이 260자 제한(긴 경로 설정 여부에 따름) [가정] |
| 줄바꿈 | LF | LF | CRLF 파일이 흔하다. 줄 스캔은 LF만 경계로 센다(4.4절) |
| 프로세스 그룹 kill의 Bun 동작 | `node:child_process` + `process.kill(-pid)`가 Bun 1.4에서 Node와 같다 [가정: `L0.exec.plan` M0 스파이크] | 같음 [가정] | 해당 없음 |
| 적합성 스위트 | 전부 통과가 목표 | 전부 통과가 목표 | 아래 표의 항목만 |

Windows 네이티브에서 통과를 기대하는 적합성 사례 [가정, M2 이후 확인]:

| 사례 묶음(원본 이름) | 개수 | Windows 기대 | 이유 |
|---|---|---|---|
| binary reader 4종(byte ranges, scans lines, keeps reading after rename, refuses directories) | 4 | 통과 | 파일 API만 쓴다. rename 중 열린 파일 처리는 [가정] |
| directory reader 4종 | 4 | 통과 | |
| argv exec 3종(인자 전달, cwd·종료 코드, 없는 프로그램), exec stream, windowed exec | 5 | 통과(Git Bash `sh -c`) | `options.shell`을 Git Bash로 준다 |
| argv exec distinguishes timeout from abort | 1 | 통과 [가정] | taskkill 경로 |
| watch 8종(심볼릭 링크 제외) | 8 | polling으로 통과 [가정] | 지연이 길어 사례 제한 시간(30초) 안인지 확인 필요 |
| binary reader noFollow, watch symlinked file | 2 | 제외(`symlinks: false`) | Git Bash `ln -s`가 링크를 만들지 않을 수 있다 |

### 5.3 테스트 쪽 경계

- `env-node-spill.int.test.ts`는 `mock.module("node:fs")`로 쓰기 스트림을 느리게 만든다. `eng.testing.guide` TS-05의 외부 모듈 예외로 `eng.dependency-rules.guide` 4절 허용 목록에 `TS-05/platform-exec-spill`을 기록하고 이 파일은 `bun test --isolate`로 돈다 [제안].
- `int` 태그 파일은 10초 이하여야 한다(TS-01). watch 사례는 사례당 30초 상한을 쓴다(`env-conformance.ts:108`). 파일 분할 방식은 `L0.exec.plan` 위험 표와 10절 [미결] 5다.

## 6. 설정 노출

키 문법은 `l0.<도메인>.<이름>`이다(`F.wire-settings.spec` §3.8.1). 정의는 `src/settings.ts`에서 `defineSettings("l0.exec", …)`로 한다.

| 키 | 타입 | 기본값 | 범위(`allowedScopes`) | 변경 반영 | L4 노출 |
|---|---|---|---|---|---|
| `l0.exec.shell` | `string`(절대 경로) | 없음(자동 탐색, 5.2절) | `managed`, `user` | `restart` | 탭 `execution`, `text`, 현재 값과 탐색 결과를 함께 표시 [제안] |
| `l0.exec.defaultTimeoutMs` | `integer` | `0`(호출자가 정하지 않으면 제한 없음) | `managed`, `user`, `project` | `nextTurn` | 탭 `execution`, `number`, 단위 ms [제안] |
| `l0.exec.outputSpillBytes` | `integer` | `10485760`(10 MiB) | `managed`, `user`, `project` | `nextTurn` | 탭 `advanced`(파일 편집기만) [제안] |
| `l0.exec.envAllowlist.extra` | `string[]`(이름 패턴 `^[A-Za-z_][A-Za-z0-9_]{0,127}$`) | `[]` | `managed`, `user` | `nextTurn` | 탭 `execution`, `list` [제안] |

- `range`: `defaultTimeoutMs` 0~2,147,483,647, `outputSpillBytes` 0~1,073,741,824.
- `l0.exec.shell`과 `l0.exec.envAllowlist.extra`는 `project` 범위를 받지 않는다 [제안]. 저장소 파일이 실행 셸을 바꾸거나 부모 env를 자식에 열면 저장소를 여는 것만으로 코드 실행이나 정보 노출이 생긴다(`_research/notes/L0-1.md` §3.6과 같은 신뢰 원칙).
- `envAllowlist.extra`는 더하기만 가능하다. `deny` 패턴(3.5절)에 맞는 이름은 쓰기 검사(`checkSettingWrite`)에서 거부하고, 그 이유를 화면에 보인다. 비밀 값은 `secretEnv`로만 넣고 이 키로는 넣지 않는다.
- [제안] L4 탭 이름 '실행'은 F `SettingsTab`의 `"execution"`이다(`F.wire-settings.spec` §3.8.2, `_research/settings.md` §4 10번 "실행과 알림").

## 7. 확장 지점

- `xeon.exec`는 `on` 지점을 선언하지 않는다. 도구 실행 전후 지점(`tool_call`, `tool_result`)은 L1이 선언한다(`F.extensions.spec`).
- `post`, `drive`와 관계가 없다. drive 임대 반납·단계 경계 비활성화가 진행 중 명령을 끝낼 때는 L1이 `CancelScope.abortSignal`을 취소한다(B-17).
- 확장은 `scope`로 `ExecServiceName`을 주입받아 쓸 수 있다. 확장이 자기 셸 데코레이터를 끼우는 것은 이 문서가 열지 않는다. `Shell` 데코레이터 조립 지점은 L1 tools와 apps/host 하나다(3.7절) [제안].

## 8. 다른 문서와의 인터페이스

### 8.1 제공

| 이름 | 소비 문서 |
|---|---|
| `xeon.exec`(`ExecService`): 파일 연산, 셸 실행, `withCwd` | `L1.tools.spec`, `L2.workspace.spec`, `L1.tasks.spec`(경로 키 산출) |
| `ExecService.startBackground`와 `BackgroundExecHandle`(3.9절). 결과를 `BackgroundStopper`로 그대로 넘긴다 | `L0.process.spec` §4.3(레지스트리 등록자 계약), `L1.tools.spec`(백그라운드 셸), `L2.mcp.spec` |
| 파일 감시 책임 경계 문장(1절 다루지 않는 것 표) | `L0.os.spec` §3.8 |
| `@xeon/platform-exec/testing`: `fakeExec`(명령별 응답 표), `memoryFs`, `registerExecConformance` | `eng.testing.guide` TS-05, `L2.workspace.plan`, 다른 `ExecutionEnv` 구현(Docker 어댑터) |
| 동작 보장 표(4.1절), 플랫폼 제약 표(5.2절) | `L2.workspace.spec` §4.2·§4.3 |

### 8.2 F에 요청

| 요청 | 대상 | 이유 |
|---|---|---|
| `CancelScope`, `FileKind`, `FileErrorCode`, `ExecutionErrorCode`, `FileError`, `ExecutionError`, `FileInfo`, `TextLine`, `TextLineReader`, `LineScan`, `BinaryReader`, `DirReader`, `WatchTarget`, `WatchChange`, `FileWatcher`, `FileSystem`, `ShellSpillOptions`, `ShellOutputWindow`, `ShellOutputSkip`, `ShellOutputInfo`, `ShellExecOptions`, `ShellExecResult`, `Shell`, `ExecutionEnv`, `ExecService`, `ExecServiceName`를 `@xeon/contracts/services`(`services/exec.ts`)에 둔다 [결정(잠정): review.decisions-2 D-04] | `F.capabilities.spec` §3.12(services) | 3.1절. L0 두 패키지와 L1·L2가 공유한다 |
| `ShellExecResult.sandbox`(`SandboxRunReport`) 필드 추가. `SandboxRunReport`·`SandboxViolation`은 아무것도 import하지 않는 `services/sandbox-report.ts`에 둔다 [결정(잠정): review.decisions-2 D-04] | `F.capabilities.spec` §3.12(services) | 3.1절 import 방향, `L0.sandbox.spec` §3.1 |
| `ShellExecOptions.secretEnv`(`SecretEnvRequest`: `refs`와 `ctx`) 필드 추가 | `F.capabilities.spec` §3.12(services) | 반영되었다. 파일별 이름 표 `services/exec.ts` 행에 `ShellExecOptions`(`secretEnv?: SecretEnvRequest` 포함)와 `SecretEnvRequest`가 있다. `SecretRef`는 `capabilities/secrets.ts`(§3.10, settings가 다시 export), `UseCtx`는 `services/secrets.ts`에서 가져온다. 3.6절. M1 F 변경에 넣는다(U-19) |
| `BackgroundExecHandle`, `ExecService.startBackground` | `F.capabilities.spec` §3.12(services) | 반영되었다(`services/exec.ts` 행과 `ExecService` 발췌 블록). 3.9절 |
| `SENSITIVE_ENV_PATTERNS`(3.5절 `deny` 표의 값, `readonly string[]` 상수). 자식 env 거부 목록의 유일한 정본 | `F.capabilities.spec` §3.12(services) | 이름은 `services/exec.ts` 행에 있다. exec env 빌더, sandbox 자가 시험, secrets의 sops 호출 env가 같은 목록을 쓴다 |
| `ExecutionErrorCode`에 Xeon 코드 4개(`env_denied`, `secret_unavailable`, `sandbox_unavailable`, `sandbox_failed`) 추가 | `F.capabilities.spec` §3.12(services) | 3.1절. 필드를 옮길 때(P9) 넣는다 |
| `eng.typescript.guide` TY-22 4번·§1.2 문구 정정(`CancelScope`는 F `services/exec.ts`) | `eng.typescript.guide` | 3.2절 |

### 8.3 요구 서비스

| 서비스 | 쓰는 곳 | 요구 내용 |
|---|---|---|
| `xeon.secrets`(`SecretService`) | 3.6절 비밀 주입(M1) | env 모드 lease 메서드 `withEnv(handle, ctx)`(`L0.secrets.spec` §3.6). 값은 lease 안에만. 실패는 `Result` |
| `xeon.os`(`OsService`) | 3.4절 WSL 판정 | WSL 판정 기준은 `L0.os.spec` §3.1이 정본이다(`WSL_DISTRO_NAME` 또는 `/proc/version`의 `microsoft`·`WSL`). exec `select.ts`는 같은 기준을 쓴다 |
| ext-host 서비스 등록 API | 3.8절 | 서비스 이름 상수로 등록, dispose 콜백(`X.primitives.spec`) |
| 조립 도우미 | 3.7절 | 파일 메서드는 원래 env, `exec`·`cleanup`은 감싼 `Shell`에 위임하는 `ExecutionEnv` 조립. 위치는 `L1.tools.spec`이 정한다 |

## 9. 수용 기준

1. 적합성 스위트(`registerExecConformance`, 원본 사례 24개)가 Linux와 macOS CI에서 `NodeExecutionEnv` 기반 `xeon.exec`로 모두 통과한다.
2. `sh -c 'sleep 30 & sleep 30 & wait'`을 실행하고 abort하면, `aborted`가 돌아온 뒤 1초 안에 그 명령의 프로세스 그룹에 속한 프로세스가 0개다(`ps -o pid= -g <pgid>` 결과가 비어 있음). 시간 초과도 같다.
3. 부모 env에 `GITHUB_TOKEN=x`, `SOPS_AGE_KEY=y`, `OP_SESSION_z=w`, `FOO=1`이 있을 때 `env`를 실행한 출력에 네 이름이 모두 없다. `l0.exec.envAllowlist.extra = ["FOO"]`이면 `FOO=1`만 나타난다.
4. `env: { AWS_SECRET_ACCESS_KEY: "v" }` 요청은 `env_denied`이고 자식 프로세스가 생기지 않는다.
5. (M1) `secretEnv: { refs: { GH_TOKEN: "secret://gh" }, ctx }` 호출에서 자식은 값을 받는다(`printenv GH_TOKEN`의 종료 코드 0). 값을 출력하지 않는 명령으로 실행했을 때 그 호출의 `ShellExecResult`, `ExecutionError` 메시지, 연결 코드의 로그 기록에 값 문자열이 나타나지 않는다. 호출이 끝난 뒤 가짜 `xeon.secrets`의 lease 폐기 횟수가 획득 횟수와 같다(성공, 실패, 취소, 시간 초과 4경우).
6. `select.ts`에 `platform: "freebsd"`를 주면 `err({ kind: "unsupported_platform", platform: "freebsd" })`이다.
7. `platform-exec/src`에서 `process.platform`을 읽는 줄이 `src/select.ts` 밖에 0건이다(`src/upstream/**`, `src/providers/*` 포함). provider 파일은 `select.ts`가 고른 결과로만 쓰인다(`L0.readme` §3.1). 검사 스크립트가 이를 확인한다.
8. 포크 5파일과 테스트의 변경점이 `PATCHES.md`, `UPSTREAM.json` `modifications`, `// XEON-PATCH:` 표지 셋에서 같은 id 집합이다.
9. chord 패키지가 설치되지 않은 상태에서 `tsc -b`가 통과하고 `platform-exec`의 `src`·`test`에 chord import가 0건이다.
10. Windows provider 단위 시험에서 `killProcessTree`는 `taskkill.exe /F /T /PID <pid>`를 만들고, `noFollow`는 `lstat_precheck`, `detachedSpawn`은 거짓이다. Windows 네이티브 적합성은 5.2절 표에 적은 사례만 통과 대상이다.
11. 포크 선언(`src/upstream/env/index.ts`)과 F 선언(`exec.ts`)이 서로 대입 가능하다(`exec-contract.contract.test.ts`의 타입 수준 검사).
12. (M2 이후) `startBackground(["sh", "-c", "trap '' TERM; sleep 30 & sleep 30; wait"], …)`의 핸들에서 `pid`가 양수이고, `stop("graceful")` 뒤에도 남은 프로세스가 `stop("force")` 뒤 1초 안에 그룹째 0개이며, `exited`가 이행한다.

근거 위치: adr.0003 §3.1·§3.4·§4.2, `_research/durable-and-search-facts.md` §A-1~A-4, `_research/packages.md` §2.2·§4.2 L0-a, `eng.typescript.guide` §1(포크 코드)·§4.1, `docs/design/18-security.md` §3.11.1 R-2.

## 10. 미결 사항

1. [미결] `abortSignal`의 `undefined` 허용 여부와 `eng.typescript.guide` §1.2·TY-22 문구 정정. 위치는 F `services/exec.ts`로 정해졌다([결정(잠정): review.decisions-2 D-04], 3.2절).
2. [미결] `ExecService.withCwd` 추가와 `eng.context-map.design` §5.3 표 정정(3.1절). 공유 서비스 모드에서 세션별 cwd를 어떻게 줄지 `L0.process.spec`과 함께 정한다.
3. [미결] 포크 업그레이드 정책(정기 diff 또는 보안·버그 수정 때만). adr.0003 §6을 이어받는다.
4. [미결] spill 파일 위치와 삭제 시점. 원본은 OS 임시 디렉터리에 남긴다. env 모드 비밀이 출력에 섞이면 원문이 디스크에 남으므로 위치(`xeon.os`의 임시 디렉터리, 권한 0600)와 세션 종료 시 삭제를 `L0.secrets.spec`, `L2.workspace.spec`과 함께 정한다.
5. [미결] 적합성 스위트의 watch 사례(사례당 최대 30초)를 `int` 파일 10초 상한(`eng.testing.guide` TS-01)에 맞추는 방법: 파일 분할, 별도 태그, 상한 예외 중 하나.
6. [미결] `l0.exec.defaultTimeoutMs` 기본값. 0(제한 없음)과 안전 상한(예: 2시간) 중 고른다. `l2.workspace.shell.defaultTimeoutSec`과의 우선순위는 호출자 값이 앞선다.
7. [미결] Windows 네이티브 적합성 기대 표(5.2절)는 실행하지 않은 [가정]이다. M2 이후 Windows CI에서 확인한다.
8. [결정(잠정): review.decisions-2 U-19] 마일스톤 M1의 비밀 경로는 에이전트 env 모드(`secretEnv`, bash 도구, 실행마다 승인)다. `L0.secrets.spec` §3.6에 `withEnv`를 두고 EX-13을 M1에 둔다.
9. [미결] stdin 파이프가 필요한 장시간 프로세스(MCP stdio 서버)를 `startBackground`로 띄울지, 옵션에 stdin 스트림을 더할지. `L2.mcp.spec`, `L0.process.spec` 미결 P-4와 함께 정한다.
