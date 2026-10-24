import { access } from "node:fs/promises";
import { attemptAsync, err, ok, type Logger, type Result } from "@xeon/contracts";
import {
  ExecutionError,
  type BackgroundExecHandle,
  type CancelScope,
  type ExecService,
  type ExecutionEnv,
  type SecretEnvRequest,
  type Shell,
  type ShellExecOptions,
} from "@xeon/contracts/services";
import { spawnBackground } from "./background.ts";
import { BASE_ENV_POLICY, buildChildEnv } from "./env-builder.ts";
import type { ExecPlatformProvider } from "./provider.ts";
import { forwardFileSystem } from "./forward.ts";
import { acquireSecretEnv, type SecretEnvSource } from "./secret-env.ts";
import { getShellConfig, NodeExecutionEnv, resolvePath } from "./upstream/env/node.ts";
import { formatSize, truncateHead, truncateHeadOf } from "./upstream/truncate.ts";

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

/** exec와 startBackground가 같은 규칙으로 만드는 실행 준비물: 완성된 자식 env와 비밀 lease 폐기 수단 */
interface PreparedRun {
  readonly childEnv: Record<string, string>;
  readonly secretRequest: SecretEnvRequest | undefined;
  /** lease를 폐기하고 env 사본의 참조를 버린다. 두 번 불러도 된다 */
  dispose(): void;
}

export function createExecService(options: ExecServiceOptions, deps: ExecServiceDeps): ExecService {
  const extraPass = [...options.envExtra, ...deps.platform.envAllowlistExtra];

  /** 1. 허용 목록 env, 2. 취소 확인, 3. 비밀 lease. 하나라도 실패하면 얻은 것을 모두 폐기하고 실행하지 않는다 */
  async function prepareRun(
    command: string | readonly string[],
    execOptions: Pick<ShellExecOptions, "env" | "inheritEnv" | "secretEnv"> | undefined,
    context: CancelScope,
  ): Promise<Result<PreparedRun, ExecutionError>> {
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
    if (context.abortSignal?.aborted === true) return err(new ExecutionError("aborted", "aborted"));
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
    if (secretRequest !== undefined) {
      deps.logger?.info("exec.secret_env", { refs: Object.values(secretRequest.refs).join(",") });
    }
    return ok({
      childEnv: { ...built.value, ...leases?.value.values },
      secretRequest,
      dispose: () => {
        leases?.value.dispose();
      },
    });
  }

  function createEnv(cwd: string): ExecutionEnv {
    const inner = new NodeExecutionEnv({
      cwd,
      platform: deps.platform,
      ...(options.shellPath === undefined ? {} : { shellPath: options.shellPath }),
      // 정리 단계 close 실패와 감시 콜백 예외를 기록한다(open-issues N-10, PATCHES P16)
      ...(deps.logger === undefined ? {} : { logger: deps.logger }),
    });

    const exec: Shell["exec"] = async (command, execOptions, context) => {
      const prepared = await prepareRun(command, execOptions, context);
      if (!prepared.ok) return prepared;
      try {
        const { childEnv, secretRequest } = prepared.value;
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
        prepared.value.dispose();
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

  /** 살아 있는 백그라운드 프로세스(spec §3.9). 서비스 cleanup이 끝낸다. 파생 env는 startBackground를 갖지 않는다 */
  const background = new Set<BackgroundExecHandle>();

  const startBackground: ExecService["startBackground"] = async (command, execOptions, context) => {
    const prepared = await prepareRun(command, execOptions, context);
    if (!prepared.ok) return prepared;
    try {
      const cwd =
        execOptions?.cwd === undefined
          ? service.cwd
          : resolvePath(service.cwd, execOptions.cwd, deps.platform);
      const reachable = await attemptAsync(() => access(cwd));
      if (!reachable.ok) {
        return err(
          new ExecutionError(
            "spawn_error",
            `Working directory does not exist: ${cwd}\nCannot execute bash commands.`,
          ),
        );
      }
      // 문자열은 셸로, argv는 셸 없이 직접 실행한다(B-11). exec와 같은 규칙이다
      const [first, ...rest] = typeof command === "string" ? [] : command;
      let program: string;
      let args: readonly string[];
      let stdinCommand: string | undefined;
      if (typeof command === "string") {
        const shell = await getShellConfig(options.shellPath, deps.platform);
        if (!shell.ok) return shell;
        const fromStdin = shell.value.commandTransport === "stdin";
        program = shell.value.shell;
        args = fromStdin ? shell.value.args : [...shell.value.args, command];
        stdinCommand = fromStdin ? command : undefined;
      } else {
        if (first === undefined) {
          return err(new ExecutionError("spawn_error", "Empty argv: no program to run"));
        }
        program = first;
        args = rest;
        stdinCommand = undefined;
      }
      const slot: { handle: BackgroundExecHandle | undefined } = { handle: undefined };
      const started = await spawnBackground(
        {
          program,
          args,
          stdinCommand,
          cwd,
          env: prepared.value.childEnv,
          onOutput: execOptions?.onOutput,
          platform: deps.platform,
          context,
          logger: deps.logger,
        },
        () => {
          if (slot.handle !== undefined) background.delete(slot.handle);
        },
      );
      if (started.ok) {
        slot.handle = started.value;
        background.add(started.value);
      }
      return started;
    } finally {
      // 값은 spawn 인자로 이미 복사됐다. 프로세스가 사는 동안 lease를 쥐고 있지 않는다
      prepared.value.dispose();
    }
  };

  const result: ExecService = {
    ...forwardFileSystem(service),
    get cwd(): string {
      return service.cwd;
    },
    set cwd(value: string) {
      service.cwd = value;
    },
    exec: (command, execOptions, context) => service.exec(command, execOptions, context),
    cleanup: async (context: CancelScope) => {
      await service.cleanup(context);
      // 서비스 소유자 종료: 아직 살아 있는 백그라운드 프로세스도 끝낸다(spec §3.9)
      await Promise.all(Array.from(background, (handle) => handle.stop("force")));
    },
    withCwd: (cwd) => createEnv(cwd),
    startBackground,
    // 출력 절단은 순수 계산이다. L1·L2가 사본 없이 xeon.exec로 부른다(review.decisions-2 D-08, B-04)
    truncateHead,
    truncateHeadOf,
    formatSize,
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
