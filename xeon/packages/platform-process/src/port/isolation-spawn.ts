import { err, ok, type Logger, type Result, type Scheduler } from "@fresnel/contracts";
import type {
  IsolatedChild,
  IsolationProcessPort,
  IsolationSpawnError,
  IsolationSpawnSpec,
} from "@fresnel/contracts/extensions";
import type {
  BackgroundRegistry,
  SandboxedArgv,
  SandboxPolicy,
  SandboxService,
} from "@fresnel/contracts/services";
import { isAbsolute, resolve as resolvePath } from "node:path";
import type { ProcessPlatformProvider } from "../select.ts";
import { childEnv, VALID_ENV_NAME } from "./child-env.ts";
import { DEFAULT_STDIN_CLOSE_MS, stopperOfPiped } from "./child-stop.ts";
import { spawnPiped } from "./spawn-piped.ts";

// L0.process.spec §4.8 `spawn`, review.m5-drive-isolation §3.1·§3.4(M5b-1). 격리 확장의 플러그인 호스트 프로세스를 띄운다.
// 1. 명령줄은 샌드박스 서비스 `wrapArgv`가 만든 것이다. 격리를 쓸 수 없으면 띄우지 않고 `sandbox_unavailable`이다(닫힌 실패).
//    사용자가 격리를 껐거나(`disabled`) 격리 불가 시 실행을 허락한(`run_unsandboxed`) 때만 격리 없이 띄우고 경고 `isolation.sandbox_not_enforced`를 남긴다.
// 2. 정책은 §3.4대로다. 샌드박스의 "쓰기 없음" 프로필(`profile: "no-write"`): 쓰기 루트 없음(이 프로세스 전용 빈 임시 폴더 하나만, 끝나면 지운다),
//    네트워크는 허용 목록 없이 거부 목록만(사용자 차단 도메인), 샌드박스 밖 실행 없음. 읽기는 허용 목록이다:
//    `readRoot`(플러그인 폴더), 실행 파일, `spec.runtimeReadRoots`(소스 실행의 작업 공간)와 런타임이 꼭 필요한 시스템 경로뿐이다.
//    `profile: "read-only"`는 네트워크를 막으므로 쓰지 않는다.
// 3. 자식 env는 부모 env의 허용 목록 이름(거부 패턴 제외)에 `spec.env`(호출자가 허용 목록으로 만든 값)를 더하고, 샌드박스가 준 env를 마지막에 덮는다.
//    시크릿은 넘기지 않는다. cwd는 `spec.readRoot`다.
// 4. `BackgroundRegistry`에 owner kind `plugin-host`, ref 라벨로 등록한다. 정지 순서는 MCP 서버와 같다(stdin 닫기, 유예, SIGTERM, 유예, SIGKILL).
// 5. `kill(SIGTERM|SIGKILL)`은 프로세스 트리 전체에 보낸다. `exited`는 종료와 표준 출력 닫힘 뒤에 이행한다.

/** 샌드박스 서비스 중 이 포트가 쓰는 메서드. platform-sandbox를 import하지 않고 F 인터페이스로만 받는다(DR-02) */
export type IsolationSandboxSource = Pick<SandboxService, "defaultPolicy" | "wrapArgv">;

/** 자식이 끝난 뒤 표준 출력이 닫히기를 기다리는 시간(ms) 기본값. MCP 서버의 기본과 같다 */
export const DEFAULT_ISOLATION_DRAIN_MS = 1000;

export interface IsolationProcessDeps {
  /** 프로세스 트리 종료 수단. undefined면 모든 spawn이 `unsupported_platform`으로 실패한다 */
  readonly platform: ProcessPlatformProvider | undefined;
  readonly background: BackgroundRegistry;
  /** 샌드박스 서비스를 spawn 때마다 찾는다(조립 순서상 이 포트가 서비스보다 먼저 만들어진다). undefined를 돌려주면 `sandbox_unavailable`이다 */
  readonly sandbox: () => IsolationSandboxSource | undefined;
  /** 부모 env. 허용 목록 이름만 자식에게 옮긴다 */
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  readonly scheduler: Scheduler;
  readonly logger: Logger;
  /** 자식이 끝난 뒤 표준 출력이 닫히기를 기다리는 시간(ms). 기본 `DEFAULT_ISOLATION_DRAIN_MS` */
  readonly drainMs?: number;
  /** graceful 정지에서 stdin을 닫은 뒤 SIGTERM을 보내기 전까지 기다리는 시간(ms). 기본 `DEFAULT_STDIN_CLOSE_MS` */
  readonly stdinCloseMs?: number;
}

function spawnFailed(code: string, message: string): Result<never, IsolationSpawnError> {
  return err({ kind: "spawn_failed", code, message });
}

/**
 * 플러그인 호스트의 샌드박스 정책: "쓰기 없음" 프로필과 읽기 허용 목록이다(L0.sandbox.spec §4.9). `defaultPolicy`가 보호 경로,
 * 사용자의 차단 도메인, 런타임이 꼭 필요한 시스템 읽기 경로를 채운다. 이 포트는 플러그인 폴더, 실행 파일, 런타임 읽기 경로만 더한다.
 */
function pluginHostPolicy(
  sandbox: IsolationSandboxSource,
  cwd: string,
  spec: IsolationSpawnSpec,
): SandboxPolicy {
  return sandbox.defaultPolicy({
    workspaceRoots: [],
    tempDir: cwd,
    profile: "no-write",
    readRoots: [cwd, spec.command, ...(spec.runtimeReadRoots ?? [])],
  });
}

/** 격리 자식을 띄우는 포트를 만든다. `ProcessService.spawn`이 이 포트를 그대로 쓴다 */
export function createIsolationProcessPort(deps: IsolationProcessDeps): IsolationProcessPort {
  const stdinCloseMs = deps.stdinCloseMs ?? DEFAULT_STDIN_CLOSE_MS;
  const drainMs = deps.drainMs ?? DEFAULT_ISOLATION_DRAIN_MS;

  /** 샌드박스로 감싼 명령줄을 돌려준다. 격리를 쓸 수 없으면 값으로 막고 아무것도 띄우지 않는다 */
  async function wrapForSandbox(
    spec: IsolationSpawnSpec,
    cwd: string,
  ): Promise<Result<SandboxedArgv, IsolationSpawnError>> {
    const sandbox = deps.sandbox();
    if (sandbox === undefined) {
      deps.logger.warn("isolation.sandbox_unavailable", {
        label: spec.label,
        reason: "service_missing",
      });
      return err({ kind: "sandbox_unavailable", reason: "service_missing" });
    }
    const wrapped = await sandbox.wrapArgv(
      pluginHostPolicy(sandbox, cwd, spec),
      { command: spec.command, args: spec.args, cwd },
      { abortSignal: undefined },
    );
    if (!wrapped.ok) {
      const failure = wrapped.error;
      if (failure.kind === "aborted") return spawnFailed("aborted", "aborted");
      if (failure.kind === "failed") return spawnFailed("sandbox_failed", failure.message);
      const reason = failure.reason ?? "unknown";
      deps.logger.warn("isolation.sandbox_unavailable", { label: spec.label, reason });
      return err({ kind: "sandbox_unavailable", reason });
    }
    if (!wrapped.value.sandboxed) {
      deps.logger.warn("isolation.sandbox_not_enforced", {
        label: spec.label,
        by: wrapped.value.unsandboxedBy ?? "unknown",
      });
    }
    return ok(wrapped.value);
  }

  return {
    async spawn(spec) {
      const platform = deps.platform;
      if (platform === undefined) {
        return spawnFailed("unsupported_platform", "process trees cannot be stopped on this OS");
      }
      for (const name of Object.keys(spec.env)) {
        if (!VALID_ENV_NAME.test(name)) {
          return spawnFailed("env_denied", `Invalid environment variable name: ${name}`);
        }
      }
      if (!isAbsolute(spec.readRoot)) {
        return spawnFailed("EINVAL", "readRoot must be an absolute path");
      }
      const cwd = resolvePath(spec.readRoot);
      // 샌드박스를 먼저 정한다. 막힌 호스트는 아무것도 띄우지 않는다
      const sandboxed = await wrapForSandbox(spec, cwd);
      if (!sandboxed.ok) return sandboxed;
      const wrapped = sandboxed.value;
      const [command, ...args] = wrapped.argv;
      if (command === undefined) {
        wrapped.cleanup();
        return spawnFailed("EINVAL", "the sandbox returned an empty command line");
      }
      const spawned = await spawnPiped(
        {
          command,
          args,
          cwd,
          // 샌드박스가 정한 값(프록시 주소 등)은 허용 목록 env보다 앞선다
          env: Object.assign(childEnv(deps.parentEnv, spec.env), wrapped.env),
          label: spec.label,
        },
        { platform, scheduler: deps.scheduler, logger: deps.logger, drainMs },
      );
      if (!spawned.ok) {
        wrapped.cleanup();
        return spawned;
      }
      const child = spawned.value;
      // 프로세스가 끝나면 샌드박스 마운트 지점을 정리한다(cleanup은 한 번만 실행된다)
      const cleanup = (): void => {
        wrapped.cleanup();
      };
      child.exited.then(cleanup, cleanup);
      const registered = deps.background.register({
        label: spec.label,
        owner: { kind: "plugin-host", threadId: null, ref: spec.label },
        pid: child.pid,
        stopper: stopperOfPiped(child, { scheduler: deps.scheduler, stdinCloseMs }),
      });
      if (!registered.ok) {
        child.signalTree("force");
        return spawnFailed(registered.error.kind, "background registry rejected the plugin host");
      }
      return ok({
        pid: child.pid,
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        exited: child.exited,
        kill(signal) {
          child.signalTree(signal === "SIGTERM" ? "graceful" : "force");
        },
      } satisfies IsolatedChild);
    },
  };
}
