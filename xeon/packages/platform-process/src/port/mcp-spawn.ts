import { err, ok, type Logger, type Result, type Scheduler } from "@xeon/contracts";
import { parseSecretRef } from "@xeon/contracts/capabilities";
import { resolve as resolvePath } from "node:path";
import {
  SENSITIVE_ENV_PATTERNS,
  type ApprovalEvidence,
  type BackgroundRegistry,
  type SandboxedArgv,
  type SandboxService,
  type SecretService,
} from "@xeon/contracts/services";
import type { ProcessPlatformProvider } from "../select.ts";
import { spawnPiped, type PipedChild, type PipedExit } from "./spawn-piped.ts";

// L0.process.spec §4.9, L0.process.plan PR-23. stdio MCP 서버를 사용자 권한으로 띄우는 포트(결정 D6).
// L2.mcp는 L0를 import하지 않으므로 같은 모양을 `cap-mcp/src/ports/process.ts`의 `McpProcessPort`로 선언해 두었고,
// 이 파일은 그 모양에 구조로 맞는 구현이다(조립 루트가 잇는다).
//
// 1. 자식 env는 부모 env의 허용 목록 이름(거부 패턴 제외)에 정의의 평문 `env`와 `secretEnv`를 더해 만든다(M3-REQ-97).
//    평문 env는 정의 파일에 이미 평문으로 있는 값이다. 비밀 이름 패턴 거부는 정의를 읽는 L2가 했다.
// 2. `secretEnv`의 `secret://` 참조는 spawn 직전에 `SecretService.withEnv`로 푼다. 값은 이 함수의 지역 변수와 spawn 인자에만 있고
//    spawn이 끝나면 lease를 닫는다. 오류와 로그에는 참조 이름만 쓴다. 사용 목적은 `mcp.start:<서버 id>`이고 대상은
//    `mcp:<서버 id>` 명령줄이다. 정의 해시마다 한 번 받은 기동 승인 증거(`approval`)를 그대로 넘긴다(L0.secrets.spec §4.3.1, M3-REQ-58).
// 3. `BackgroundRegistry`에 owner kind `mcp`, ref 서버 id로 등록한다. 정지 순서는 stdin 닫기, 유예, SIGTERM, 유예, SIGKILL이다.

/** 한 서버를 띄우는 요청. cap-mcp의 `McpSpawnSpec`과 같은 모양이다 */
export interface McpSpawnSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
  /** 환경 변수 이름 → `secret://` 참조 */
  readonly secretEnv: Readonly<Record<string, string>>;
  /** 평문 환경 변수. 생략하면 없다. `secretEnv`와 이름이 겹치면 `secretEnv`가 이긴다 */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * 샌드박스에 넣어 띄우라는 요청(L2 `sandboxOf`의 결과, M3-REQ-97). 참이면 `SandboxService.wrapArgv`가 돌려준 명령줄로 띄운다.
   * 격리를 쓸 수 없으면(서비스 없음, 의존 프로그램 없음 등) 띄우지 않고 `sandbox_unavailable`을 돌려준다(닫힌 실패, P-15).
   * 사용자가 격리를 끄거나(`l0.sandbox.enabled`) 격리 불가 시 실행을 허락한(`onUnavailable = run_unsandboxed`) 때만
   * 격리 없이 띄우고 경고 `mcp.sandbox_not_enforced`를 남긴다(L0.process.spec §4.9)
   */
  readonly sandbox?: boolean;
  /** 비밀 env의 기동 승인 증거(정의 해시마다 한 번 받은 것). 비밀 env가 없으면 쓰지 않는다 */
  readonly approval?: ApprovalEvidence | null;
  /** 화면 표시. 비밀 값을 넣지 않는다 */
  readonly label: string;
  /** BackgroundOwner.ref에 들어가는 서버 id */
  readonly server: string;
}

/** 기동 승인에 쓰는 `UseCtx.purpose` 접두. `platform-secrets`의 `MCP_START_PURPOSE_PREFIX`와 같은 값이다(L0끼리 import하지 않는다) */
const MCP_START_PURPOSE_PREFIX = "mcp.start:";

export interface McpChild {
  readonly pid: number;
  readonly stdin: NodeJS.WritableStream;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  /** 프로세스가 끝나고 표준 출력이 닫힌 뒤(또는 닫히지 않아 시한이 지난 뒤) 이행한다 */
  readonly exited: Promise<PipedExit>;
  /** 프로세스 트리 전체에 보낸다 */
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}

export type McpSpawnError =
  | { readonly kind: "spawn_failed"; readonly code: string; readonly message: string }
  | { readonly kind: "secret_missing"; readonly ref: string }
  | { readonly kind: "secret_denied"; readonly ref: string }
  /** 샌드박스에 넣어야 하는데 이 기기에서 격리할 수 없다. `reason`은 `SandboxUnavailableReason` 또는 `service_missing`·`unknown` */
  | { readonly kind: "sandbox_unavailable"; readonly reason: string };

export interface McpProcessPort {
  spawn(spec: McpSpawnSpec, signal: AbortSignal): Promise<Result<McpChild, McpSpawnError>>;
}

/** secrets 서비스 중 이 포트가 쓰는 메서드. platform-secrets를 import하지 않고 F 인터페이스로만 받는다(DR-02) */
export type McpSecretSource = Pick<SecretService, "withEnv">;

/** sandbox 서비스 중 이 포트가 쓰는 메서드. platform-sandbox를 import하지 않고 F 인터페이스로만 받는다(DR-02) */
export type McpSandboxSource = Pick<SandboxService, "defaultPolicy" | "wrapArgv">;

/** 정지 첫 단계에서 stdin을 닫고 서버가 스스로 끝나기를 기다리는 시간(ms) 기본값 */
export const DEFAULT_MCP_STDIN_CLOSE_MS = 500;

export interface McpProcessDeps {
  /** 프로세스 트리 종료 수단. 지원하지 않는 OS면 undefined이고 모든 spawn이 `unsupported_platform`으로 실패한다 */
  readonly platform: ProcessPlatformProvider | undefined;
  readonly background: BackgroundRegistry;
  /** 없으면 `secretEnv`가 있는 서버는 `secret_unavailable`로 실패한다 */
  readonly secrets: McpSecretSource | undefined;
  /**
   * 샌드박스 서비스를 spawn 때마다 찾는다(조립 순서상 이 포트가 서비스보다 먼저 만들어진다).
   * 함수가 없거나 undefined를 돌려주면 샌드박스 요청이 있는 서버는 `sandbox_unavailable`로 막힌다
   */
  readonly sandbox?: (() => McpSandboxSource | undefined) | undefined;
  /** 샌드박스 정책의 쓰기 루트로 더하는 임시 디렉터리. `sandbox`가 있을 때 쓴다 */
  readonly tempDir?: string | undefined;
  readonly scheduler: Scheduler;
  /** 부모 env. 허용 목록 이름만 자식에게 옮긴다 */
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  readonly logger: Logger;
  /** 자식이 끝난 뒤 표준 출력이 닫히기를 기다리는 시간(ms) */
  readonly drainMs: number;
  /** graceful 정지에서 stdin을 닫은 뒤 SIGTERM을 보내기 전까지 기다리는 시간(ms). 기본 `DEFAULT_MCP_STDIN_CLOSE_MS` */
  readonly stdinCloseMs?: number;
}

/** 자식에게 옮기는 부모 env 이름(L0.exec.spec §3.5 `BASE_ENV_POLICY.pass`와 같은 목록) */
const INHERITED_ENV: readonly string[] = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "SHELL",
];
const VALID_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_LANG = "C.UTF-8";

function escapeRegExp(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function isDeniedName(name: string): boolean {
  return SENSITIVE_ENV_PATTERNS.some((pattern) =>
    new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`, "i").test(name),
  );
}

function spawnFailed(code: string, message: string): Result<never, McpSpawnError> {
  return err({ kind: "spawn_failed", code, message });
}

interface SecretEnv {
  readonly values: Record<string, string>;
  dispose(): void;
}

/**
 * `secretEnv`의 각 항목을 env 모드 lease로 푼다. 하나라도 실패하면 이미 연 lease를 모두 닫는다.
 * 같은 핸들을 가리키는 env 이름이 여럿이면 lease가 이름마다 열리고 승인은 `SecretService`가 한 번만 센다(L0.secrets.spec §4.2).
 */
async function acquireSecretEnv(
  spec: McpSpawnSpec,
  secrets: McpSecretSource | undefined,
  signal: AbortSignal,
): Promise<Result<SecretEnv, McpSpawnError>> {
  const values: Record<string, string> = {};
  const leases: { dispose(): void }[] = [];
  const dispose = (): void => {
    for (const name of Object.keys(values)) delete values[name];
    for (const lease of leases.splice(0)) lease.dispose();
  };
  const entries = Object.entries(spec.secretEnv);
  if (entries.length === 0) return ok({ values, dispose });
  if (secrets === undefined) {
    return spawnFailed("secret_unavailable", "Secrets service is not available");
  }
  // 비밀 메타의 use.commands에는 `mcp:<서버 id>` 패턴을 적는다(L0.secrets.spec §4.3.1 2번)
  const target = {
    kind: "command",
    argv0: spec.command,
    commandLine: `mcp:${spec.server}`,
  } as const;
  // 앞 lease가 열린 뒤에 다음 lease를 연다. 하나가 실패하면 이미 연 것을 모두 닫아야 하므로 순서대로 한다
  const leaseFrom = async (index: number): Promise<McpSpawnError | undefined> => {
    const entry = entries[index];
    if (entry === undefined) return undefined;
    const [name, ref] = entry;
    if (!VALID_ENV_NAME.test(name)) {
      return {
        kind: "spawn_failed",
        code: "env_denied",
        message: `Invalid environment variable name: ${name}`,
      };
    }
    const parsed = parseSecretRef(ref);
    if (!parsed.ok) return { kind: "secret_missing", ref };
    if (signal.aborted) return { kind: "spawn_failed", code: "aborted", message: "aborted" };
    // 기동 승인 증거가 없거나 만료되었으면 정책이 `denied`(approval_missing)를 돌려주고 `secret_denied`가 된다.
    // 증거를 받는 일은 이 포트의 호출자가 spawn 전에 한다(L2.mcp.spec §4.3, M3-05)
    const leased = await secrets.withEnv(parsed.value.handle, {
      purpose: `${MCP_START_PURPOSE_PREFIX}${spec.server}`,
      target,
      actor: "runtime",
      threadId: null,
      toolCallId: null,
      projectId: null,
      approval: spec.approval ?? null,
    });
    if (!leased.ok) {
      const failure = leased.error;
      if (failure.kind === "secret_missing") return { kind: "secret_missing", ref };
      if (failure.kind === "denied") return { kind: "secret_denied", ref };
      return {
        kind: "spawn_failed",
        code: "secret_unavailable",
        message: `Secret is unavailable: ${ref}`,
      };
    }
    leases.push(leased.value);
    const value = await leased.value.use((view) => view.text());
    if (!value.ok) {
      return {
        kind: "spawn_failed",
        code: "secret_unavailable",
        message: `Secret is unavailable: ${ref}`,
      };
    }
    values[name] = value.value;
    return leaseFrom(index + 1);
  };
  const failure = await leaseFrom(0);
  if (failure !== undefined) {
    dispose();
    return err(failure);
  }
  return ok({ values, dispose });
}

function childEnv(
  parent: Readonly<Record<string, string | undefined>>,
  plain: Readonly<Record<string, string>>,
  secretValues: Readonly<Record<string, string>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of INHERITED_ENV) {
    if (isDeniedName(name)) continue;
    const value = parent[name];
    if (value !== undefined) env[name] = value;
  }
  if (!("LANG" in env)) env["LANG"] = DEFAULT_LANG;
  // 평문 env는 정의가 이름과 값을 정한 것이라 거부 패턴을 거치지 않는다(비밀 이름 패턴은 L2가 정의를 읽을 때 거부했다)
  Object.assign(env, plain);
  // 비밀 값은 거부 패턴(`*_TOKEN` 등)을 거치지 않는다: 사용자가 이름을 골라 정책을 통과한 값이다(exec와 같다)
  return Object.assign(env, secretValues);
}

export function createMcpProcessPort(deps: McpProcessDeps): McpProcessPort {
  const stdinCloseMs = deps.stdinCloseMs ?? DEFAULT_MCP_STDIN_CLOSE_MS;

  /** 레지스트리가 부르는 정지 수단. graceful은 stdin 닫기 → 유예 → SIGTERM, force는 SIGKILL이다 */
  function stopperOf(child: PipedChild): {
    stop(mode: "graceful" | "force"): Promise<void>;
    readonly exited: Promise<PipedExit>;
  } {
    return {
      async stop(mode) {
        if (mode === "force") {
          child.signalTree("force");
          return;
        }
        child.stdin.end();
        const ended = await new Promise<boolean>((resolve) => {
          const timer = deps.scheduler.setTimeout(() => {
            resolve(false);
          }, stdinCloseMs);
          const settled = (): boolean => {
            deps.scheduler.clearTimeout(timer);
            resolve(true);
            return true;
          };
          child.exited.then(settled, settled);
        });
        if (!ended) child.signalTree("graceful");
      },
      exited: child.exited,
    };
  }

  /**
   * 샌드박스 요청이 있으면 명령줄을 감싼다. 요청이 없으면 undefined(감싸지 않음)다.
   * 격리를 쓸 수 없으면 값으로 `sandbox_unavailable`을 돌려주고 띄우지 않는다. 격리 없이 띄우는 경우는
   * 사용자가 끄거나 격리 불가 시 실행을 허락한 것(`unsandboxedBy`)뿐이고, 그때만 경고를 남긴다
   */
  async function wrapForSandbox(
    spec: McpSpawnSpec,
    signal: AbortSignal,
  ): Promise<Result<SandboxedArgv | undefined, McpSpawnError>> {
    if (spec.sandbox !== true) return ok(undefined);
    const sandbox = deps.sandbox?.();
    if (sandbox === undefined || deps.tempDir === undefined) {
      deps.logger.warn("mcp.sandbox_unavailable", {
        server: spec.server,
        reason: "service_missing",
      });
      return err({ kind: "sandbox_unavailable", reason: "service_missing" });
    }
    // 서버는 작업 디렉터리와 임시 디렉터리에만 쓴다. 읽기는 보호 경로 거부 목록을 따른다(L0.sandbox.spec §4.9)
    const cwd = spec.cwd === undefined ? undefined : resolvePath(spec.cwd);
    const policy = sandbox.defaultPolicy({
      workspaceRoots: cwd === undefined ? [] : [cwd],
      tempDir: deps.tempDir,
    });
    const wrapped = await sandbox.wrapArgv(
      policy,
      { command: spec.command, args: spec.args, cwd },
      { abortSignal: signal },
    );
    if (!wrapped.ok) {
      const failure = wrapped.error;
      if (failure.kind === "aborted") return spawnFailed("aborted", "aborted");
      if (failure.kind === "failed") return spawnFailed("sandbox_failed", failure.message);
      const reason = failure.reason ?? "unknown";
      deps.logger.warn("mcp.sandbox_unavailable", { server: spec.server, reason });
      return err({ kind: "sandbox_unavailable", reason });
    }
    if (!wrapped.value.sandboxed) {
      deps.logger.warn("mcp.sandbox_not_enforced", {
        server: spec.server,
        by: wrapped.value.unsandboxedBy ?? "unknown",
      });
    }
    return ok(wrapped.value);
  }

  return {
    async spawn(spec, signal) {
      const platform = deps.platform;
      if (platform === undefined) {
        return spawnFailed("unsupported_platform", "process trees cannot be stopped on this OS");
      }
      if (signal.aborted) return spawnFailed("aborted", "aborted");
      for (const name of Object.keys(spec.env ?? {})) {
        if (!VALID_ENV_NAME.test(name)) {
          return spawnFailed("env_denied", `Invalid environment variable name: ${name}`);
        }
      }
      // 샌드박스는 비밀을 풀기 전에 정한다. 막힌 서버가 비밀 lease를 열지 않게 한다
      const sandboxed = await wrapForSandbox(spec, signal);
      if (!sandboxed.ok) return sandboxed;
      const wrapped = sandboxed.value;
      const secretEnv = await acquireSecretEnv(spec, deps.secrets, signal);
      if (!secretEnv.ok) {
        wrapped?.cleanup();
        return secretEnv;
      }
      const [command = spec.command, ...args] = wrapped?.argv ?? [spec.command, ...spec.args];
      let spawned: Awaited<ReturnType<typeof spawnPiped>>;
      try {
        spawned = await spawnPiped(
          {
            command,
            args,
            cwd: spec.cwd,
            // 샌드박스가 정한 값(프록시 주소 등)은 정의의 env보다 앞선다
            env: {
              ...childEnv(deps.parentEnv, spec.env ?? {}, secretEnv.value.values),
              ...wrapped?.env,
            },
            label: spec.server,
          },
          { platform, scheduler: deps.scheduler, logger: deps.logger, drainMs: deps.drainMs },
        );
      } finally {
        // 값은 spawn 인자로 복사되었다. 부모의 lease와 값 사본을 바로 폐기한다
        secretEnv.value.dispose();
      }
      if (!spawned.ok) {
        wrapped?.cleanup();
        return spawned;
      }
      const child = spawned.value;
      // 프로세스가 끝나면 샌드박스 마운트 지점을 정리한다
      if (wrapped !== undefined) {
        const cleanup = (): void => {
          wrapped.cleanup();
        };
        child.exited.then(cleanup, cleanup);
      }
      const registered = deps.background.register({
        label: spec.label,
        owner: { kind: "mcp", threadId: null, ref: spec.server },
        pid: child.pid,
        stopper: stopperOf(child),
      });
      if (!registered.ok) {
        child.signalTree("force");
        return spawnFailed(registered.error.kind, "background registry rejected the server");
      }
      return ok({
        pid: child.pid,
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        exited: child.exited,
        kill(sig) {
          child.signalTree(sig === "SIGTERM" ? "graceful" : "force");
        },
      });
    },
  };
}
