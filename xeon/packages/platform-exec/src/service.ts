import { access } from "node:fs/promises";
import { attemptAsync, err, ok, type LogFields, type Logger, type Result } from "@xeon/contracts";
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
import { spillUsageBytes, type SpillError } from "./spill-store.ts";
import { getShellConfig, NodeExecutionEnv, resolvePath } from "./upstream/env/node.ts";
import { formatSize, truncateHead, truncateHeadOf } from "./upstream/truncate.ts";

// L0.exec.spec §3.8, §3.8.2. 포크 NodeExecutionEnv와 provider, env 빌더, 비밀 주입을 묶는다.
// Cordis 등록은 ext-host의 서비스 등록 API로 한다(조립 루트). 이 파일은 Cordis를 import하지 않는다(DR-11).

/** 상한 사용량 측정 결과를 재사용하는 기간(L0.exec.spec §3.8.2 [결정: M3-REQ-47]) */
const SPILL_USAGE_TTL_MS = 30_000;

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
  /**
   * 임시 디렉터리와 출력 spill 파일을 두는 디렉터리(조립 루트가 `<dirs.state>/spill`을 넘긴다, L0.exec.spec §3.8).
   * 없으면 OS 임시 폴더를 쓴다(원본 동작). 평문 출력이 남으므로 운영 조립은 항상 넘긴다.
   */
  readonly tempDir?: string;
  /**
   * l0.exec.spillMaxBytes. undefined나 0이면 상한이 없다. 상한은 `tempDir` 아래 사용량으로 잰다.
   * `tempDir`이 없으면 OS 임시 폴더에는 다른 파일이 섞이므로 상한을 적용하지 않는다(L0.exec.spec §3.8.2).
   */
  readonly spillMaxBytes?: number;
  /** 사용량 캐시의 시계(epoch ms). 시험이 주입한다. 없으면 Date.now */
  readonly now?: () => number;
}

/** 상한 사용량 표본. 같은 표본 구간에서는 기록을 한 번만 남긴다 */
interface SpillUsageSample {
  readonly takenAt: number;
  readonly scan: Promise<Result<number, SpillError>>;
  logged: boolean;
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
  const clock = options.now ?? (() => Date.now());
  /** 상한 사용량 표본. spill이 생긴 명령 뒤에는 버린다. 한 spill 디렉터리를 모든 파생 env가 쓴다 */
  let usage: SpillUsageSample | undefined;

  /** 기록은 표본 구간마다 한 번만 남긴다 */
  function noteOnce(sample: SpillUsageSample, event: string, fields: LogFields): void {
    if (sample.logged) return;
    sample.logged = true;
    deps.logger?.warn(event, fields);
  }

  /** 새 spill을 시작하면 안 되는지 본다. 사용량이 상한 이상이거나 잴 수 없으면 true다 */
  async function spillCapReached(): Promise<boolean> {
    const maxBytes = options.spillMaxBytes ?? 0;
    const dir = options.tempDir;
    if (maxBytes <= 0 || dir === undefined) return false;
    const nowMs = clock();
    const current = usage;
    const sample: SpillUsageSample =
      current !== undefined &&
      nowMs >= current.takenAt &&
      nowMs - current.takenAt < SPILL_USAGE_TTL_MS
        ? current
        : { takenAt: nowMs, logged: false, scan: spillUsageBytes(dir) };
    usage = sample;
    const scanned = await sample.scan;
    if (!scanned.ok) {
      // 잴 수 없는 디렉터리에는 spill을 늘리지 않는다(L0.exec.spec §3.8.2 [결정: 오케스트레이터 기본값])
      noteOnce(sample, "exec.spill_usage_failed", { kind: scanned.error.kind });
      return true;
    }
    if (scanned.value < maxBytes) return false;
    noteOnce(sample, "exec.spill_cap_reached", { usedBytes: scanned.value, capBytes: maxBytes });
    return true;
  }

  /** 명령에 넘길 spill. 호출자가 준 것이나 기본 spill이 상한에 막히면 undefined다 */
  async function spillFor(
    execOptions: ShellExecOptions | undefined,
  ): Promise<ShellExecOptions["spill"]> {
    const requested = execOptions?.spill ?? defaultSpill(options);
    if (requested === undefined) return undefined;
    return (await spillCapReached()) ? undefined : requested;
  }

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
      ...(options.tempDir === undefined ? {} : { tempRoot: options.tempDir }),
      // 정리 단계 close 실패와 감시 콜백 예외를 기록한다(open-issues N-10, PATCHES P16)
      ...(deps.logger === undefined ? {} : { logger: deps.logger }),
    });

    const exec: Shell["exec"] = async (command, execOptions, context) => {
      const prepared = await prepareRun(command, execOptions, context);
      if (!prepared.ok) return prepared;
      try {
        const { childEnv, secretRequest } = prepared.value;
        // 비밀이 출력에 섞이면 spill 파일에 원문이 남는다. spill 위치가 정해지기 전에는 끈다(L0.exec.plan R-9).
        const spill = secretRequest === undefined ? await spillFor(execOptions) : undefined;
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
        const result = await inner.exec(command, forwarded, context);
        // spill 파일이 생겼으면 사용량이 바뀌었으므로 다음 명령이 다시 잰다(L0.exec.spec §3.8.2)
        if ((result.ok ? result.value.spillPath : result.error.spillPath) !== undefined) {
          usage = undefined;
        }
        return result;
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

function defaultSpill(options: ExecServiceOptions): ShellExecOptions["spill"] {
  if (options.outputSpillBytes <= 0) return undefined;
  return { afterBytes: options.outputSpillBytes, afterLines: Number.MAX_SAFE_INTEGER };
}
