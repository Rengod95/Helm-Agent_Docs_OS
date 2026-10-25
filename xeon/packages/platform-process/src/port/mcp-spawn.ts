import { err, ok, type Logger, type Result, type Scheduler } from "@xeon/contracts";
import { parseSecretRef } from "@xeon/contracts/capabilities";
import {
  SENSITIVE_ENV_PATTERNS,
  type BackgroundRegistry,
  type SecretService,
} from "@xeon/contracts/services";
import type { ProcessPlatformProvider } from "../select.ts";
import { spawnPiped, type PipedChild, type PipedExit } from "./spawn-piped.ts";

// L0.process.spec §4.9, L0.process.plan PR-23. stdio MCP 서버를 사용자 권한으로 띄우는 포트(결정 D6).
// L2.mcp는 L0를 import하지 않으므로 같은 모양을 `cap-mcp/src/ports/process.ts`의 `McpProcessPort`로 선언해 두었고,
// 이 파일은 그 모양에 구조로 맞는 구현이다(조립 루트가 잇는다).
//
// 1. 자식 env는 부모 env의 허용 목록 이름(거부 패턴 제외)에 `secretEnv`를 더해 만든다.
// 2. `secretEnv`의 `secret://` 참조는 spawn 직전에 `SecretService.withEnv`로 푼다. 값은 이 함수의 지역 변수와 spawn 인자에만 있고
//    spawn이 끝나면 lease를 닫는다. 오류와 로그에는 참조 이름만 쓴다.
// 3. `BackgroundRegistry`에 owner kind `mcp`, ref 서버 id로 등록한다. 정지 순서는 stdin 닫기, 유예, SIGTERM, 유예, SIGKILL이다.

/** 한 서버를 띄우는 요청. cap-mcp의 `McpSpawnSpec`과 같은 모양이다 */
export interface McpSpawnSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
  /** 환경 변수 이름 → `secret://` 참조 */
  readonly secretEnv: Readonly<Record<string, string>>;
  /** 화면 표시. 비밀 값을 넣지 않는다 */
  readonly label: string;
  /** BackgroundOwner.ref에 들어가는 서버 id */
  readonly server: string;
}

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
  | { readonly kind: "secret_denied"; readonly ref: string };

export interface McpProcessPort {
  spawn(spec: McpSpawnSpec, signal: AbortSignal): Promise<Result<McpChild, McpSpawnError>>;
}

/** secrets 서비스 중 이 포트가 쓰는 메서드. platform-secrets를 import하지 않고 F 인터페이스로만 받는다(DR-02) */
export type McpSecretSource = Pick<SecretService, "withEnv">;

/** 정지 첫 단계에서 stdin을 닫고 서버가 스스로 끝나기를 기다리는 시간(ms) 기본값 */
export const DEFAULT_MCP_STDIN_CLOSE_MS = 500;

export interface McpProcessDeps {
  /** 프로세스 트리 종료 수단. 지원하지 않는 OS면 undefined이고 모든 spawn이 `unsupported_platform`으로 실패한다 */
  readonly platform: ProcessPlatformProvider | undefined;
  readonly background: BackgroundRegistry;
  /** 없으면 `secretEnv`가 있는 서버는 `secret_unavailable`로 실패한다 */
  readonly secrets: McpSecretSource | undefined;
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
  const target = {
    kind: "command",
    argv0: spec.command,
    commandLine: [spec.command, ...spec.args].join(" "),
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
    // 서버 시작은 사람이 승인하는 지점이 없어 승인 증거가 없다. env 모드는 실행마다 승인을 요구하므로(L0.secrets.spec §4.2 6단계)
    // 증거가 없으면 `denied`(approval_missing)이고 `secret_denied`로 돌려준다 [미결 P-12, M3]
    const leased = await secrets.withEnv(parsed.value.handle, {
      purpose: `mcp:${spec.server}`,
      target,
      actor: "runtime",
      threadId: null,
      toolCallId: null,
      projectId: null,
      approval: null,
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
  secretValues: Readonly<Record<string, string>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of INHERITED_ENV) {
    if (isDeniedName(name)) continue;
    const value = parent[name];
    if (value !== undefined) env[name] = value;
  }
  if (!("LANG" in env)) env["LANG"] = DEFAULT_LANG;
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

  return {
    async spawn(spec, signal) {
      const platform = deps.platform;
      if (platform === undefined) {
        return spawnFailed("unsupported_platform", "process trees cannot be stopped on this OS");
      }
      if (signal.aborted) return spawnFailed("aborted", "aborted");
      const secretEnv = await acquireSecretEnv(spec, deps.secrets, signal);
      if (!secretEnv.ok) return secretEnv;
      let spawned: Awaited<ReturnType<typeof spawnPiped>>;
      try {
        spawned = await spawnPiped(
          {
            command: spec.command,
            args: spec.args,
            cwd: spec.cwd,
            env: childEnv(deps.parentEnv, secretEnv.value.values),
            label: spec.server,
          },
          { platform, scheduler: deps.scheduler, logger: deps.logger, drainMs: deps.drainMs },
        );
      } finally {
        // 값은 spawn 인자로 복사되었다. 부모의 lease와 값 사본을 바로 폐기한다
        secretEnv.value.dispose();
      }
      if (!spawned.ok) return spawned;
      const child = spawned.value;
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
