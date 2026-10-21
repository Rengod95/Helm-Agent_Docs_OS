import { err, type Logger, type Result } from "@xeon/contracts";
import {
  ExecutionError,
  type BackgroundExecHandle,
  type CancelScope,
  type ExecService,
  type ExecutionEnv,
  type Shell,
  type ShellExecOptions,
} from "@xeon/contracts/services";
import { BASE_ENV_POLICY, buildChildEnv } from "./env-builder.ts";
import type { ExecPlatformProvider } from "./provider.ts";
import { forwardFileSystem } from "./forward.ts";
import { acquireSecretEnv, type SecretEnvSource } from "./secret-env.ts";
import { NodeExecutionEnv } from "./upstream/env/node.ts";

// L0.exec.spec §3.8. 포크 NodeExecutionEnv와 provider, env 빌더, 비밀 주입을 묶는다.
// Cordis 등록은 ext-host의 서비스 등록 API로 한다(조립 루트). 이 파일은 Cordis를 import하지 않는다(DR-11).

export interface ExecServiceOptions {
  /** 엔진 시작 cwd */
  readonly cwd: string;
  /** l0.exec.shell */
  readonly shellPath: string | undefined;
  /** l0.exec.defaultTimeoutMs, 0이면 없음 */
  readonly defaultTimeoutMs: number;
  /** l0.exec.outputSpillBytes, 0이면 기본 spill 없음 */
  readonly outputSpillBytes: number;
  /** l0.exec.envAllowlist.extra */
  readonly envExtra: readonly string[];
}

export interface ExecServiceDeps {
  readonly platform: ExecPlatformProvider;
  /** 없으면 secretEnv가 있는 호출은 `secret_unavailable`이다 */
  readonly secrets: SecretEnvSource | undefined;
  /** 부모 env의 읽기 전용 사본. 허용 목록 빌더가 여기서 이름을 골라 옮긴다 */
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  /** 값은 싣지 않는다. 비밀은 참조 이름만 로그에 남긴다 */
  readonly logger?: Logger;
}

function startBackgroundNotImplemented(): Promise<Result<BackgroundExecHandle, ExecutionError>> {
  return Promise.resolve(
    err(
      new ExecutionError(
        "unknown",
        "startBackground is not implemented yet (L0.exec.plan EX-20, M2 and later)",
      ),
    ),
  );
}

export function createExecService(options: ExecServiceOptions, deps: ExecServiceDeps): ExecService {
  const extraPass = [...options.envExtra, ...deps.platform.envAllowlistExtra];

  function createEnv(cwd: string): ExecutionEnv {
    const inner = new NodeExecutionEnv({
      cwd,
      platform: deps.platform,
      ...(options.shellPath === undefined ? {} : { shellPath: options.shellPath }),
    });

    const exec: Shell["exec"] = async (command, execOptions, context) => {
      // 1. 허용 목록 env. 실패하면 비밀을 열지 않고 실행하지 않는다.
      const built = buildChildEnv({
        parent: deps.parentEnv,
        policy: BASE_ENV_POLICY,
        extraPass,
        requested: execOptions?.env,
        inherit: execOptions?.inheritEnv ?? true,
      });
      if (!built.ok) {
        deps.logger?.warn("exec.env_denied", { names: built.error.names.join(",") });
        return err(
          new ExecutionError(
            "env_denied",
            `Environment variables not allowed: ${built.error.names.join(", ")}. ` +
              "Pass secrets through secretEnv; l0.exec.envAllowlist.extra only adds names to inherit from the parent.",
          ),
        );
      }
      // 2. 이미 취소됐으면 실행하지 않는다.
      if (context.abortSignal?.aborted === true)
        return err(new ExecutionError("aborted", "aborted"));

      // 3. 비밀 lease. 하나라도 실패하면 얻은 것을 모두 폐기하고 끝낸다.
      const secretRequest = execOptions?.secretEnv;
      const leases =
        secretRequest === undefined
          ? undefined
          : await acquireSecretEnv({
              request: secretRequest,
              command,
              secrets: deps.secrets,
              signal: context.abortSignal,
            });
      if (leases !== undefined && !leases.ok) return leases;
      try {
        const childEnv = { ...built.value, ...leases?.value.values };
        if (secretRequest !== undefined) {
          deps.logger?.info("exec.secret_env", {
            refs: Object.values(secretRequest.refs).join(","),
          });
        }
        // 비밀이 출력에 섞이면 spill 파일에 원문이 남는다. spill 위치가 정해지기 전에는 끈다(L0.exec.plan R-9).
        const spill = secretRequest === undefined ? defaultSpill(execOptions, options) : undefined;
        const timeout = execOptions?.timeout ?? defaultTimeout(options);
        // 4. 포크 exec에는 항상 inheritEnv: false와 완성된 env를 넘긴다.
        const forwarded: ShellExecOptions = {
          ...(execOptions?.cwd === undefined ? {} : { cwd: execOptions.cwd }),
          env: childEnv,
          inheritEnv: false,
          ...(timeout === undefined ? {} : { timeout }),
          ...(execOptions?.onOutput === undefined ? {} : { onOutput: execOptions.onOutput }),
          ...(spill === undefined ? {} : { spill }),
          ...(execOptions?.window === undefined ? {} : { window: execOptions.window }),
        };
        return await inner.exec(command, forwarded, context);
      } finally {
        // 5. 성공, 실패, 취소, 시간 초과 모두 lease를 폐기하고 env 사본의 참조를 버린다.
        leases?.value.dispose();
      }
    };

    return {
      ...forwardFileSystem(inner),
      get cwd(): string {
        return inner.cwd;
      },
      set cwd(value: string) {
        inner.cwd = value;
      },
      exec,
      cleanup: (context) => inner.cleanup(context),
    };
  }

  const service = createEnv(options.cwd);
  const result: ExecService = {
    ...forwardFileSystem(service),
    get cwd(): string {
      return service.cwd;
    },
    set cwd(value: string) {
      service.cwd = value;
    },
    exec: (command, execOptions, context) => service.exec(command, execOptions, context),
    cleanup: (context: CancelScope) => service.cleanup(context),
    withCwd: (cwd) => createEnv(cwd),
    startBackground: startBackgroundNotImplemented,
  };
  return result;
}

function defaultTimeout(options: ExecServiceOptions): number | undefined {
  return options.defaultTimeoutMs > 0 ? options.defaultTimeoutMs / 1000 : undefined;
}

function defaultSpill(
  execOptions: ShellExecOptions | undefined,
  options: ExecServiceOptions,
): ShellExecOptions["spill"] {
  if (execOptions?.spill !== undefined) return execOptions.spill;
  if (options.outputSpillBytes <= 0) return undefined;
  return { afterBytes: options.outputSpillBytes, afterLines: Number.MAX_SAFE_INTEGER };
}
