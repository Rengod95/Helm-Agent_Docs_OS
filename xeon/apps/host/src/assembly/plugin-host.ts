import { isAbsolute, join } from "node:path";
import type { Logger, Scheduler } from "@fresnel/contracts";
import type { IsolationProcessPort, PortKey, ScriptRunner } from "@fresnel/contracts/extensions";
import {
  ProcessServiceName,
  SandboxServiceName,
  SENSITIVE_ENV_PATTERNS,
  type ProcessService,
  type SandboxService,
} from "@fresnel/contracts/services";
import type {
  ExtHost,
  LoaderIsolation,
  OperationsPolicy,
  PluginHostSupervisor,
} from "@fresnel/ext-host";
import { BASE_ENV_POLICY, isDeniedEnvName } from "@fresnel/platform-exec";
import { readOsRuntime } from "@fresnel/platform-os";
import { detectProcessPlatform } from "@fresnel/platform-process";
import { pluginHostLaunch } from "../plugin-host/launch.ts";
import type { SelfRunTarget } from "../self-command.ts";
import {
  nodePluginHostFiles,
  ORPHAN_GRACE_MS,
  PLUGIN_HOSTS_DIR,
  psCommandOf,
  sweepOrphanPluginHosts,
  trackedPluginHostPort,
} from "./plugin-host-orphans.ts";

// L4.host-service.spec §4.1 3단계, §4.9. 격리 확장(플러그인 호스트 프로세스)의 조립 의존을 만든다: 띄울 명령, 시계, 진단, 재시작 한도 처리,
// 감독자 목록(표준오류 꼬리 읽기), 자식 기록과 엔진 시작 때 고아 정리. 조립 루트 코드(DR-14 예외 2).

/** host.init 응답 시한(ms). 설정 예산 `x.operations.budget.setupMs`(기본 10초) 안에 host.init과 확장 등록이 끝나야 하므로 5초로 낮춘다 */
const PLUGIN_HOST_INIT_TIMEOUT_MS = 5000;
/** 마지막 호출 뒤 내리기까지(ms). 설정 키가 없어 상수로 둔다 */
const PLUGIN_HOST_IDLE_MS = 60000;

/** 재시작 한도 설정 키(X.loading-trust §4.9.7). 죽음을 셀 때마다 읽는다(live) */
const MAX_RESTARTS_KEY = "x.loading-trust.isolation.maxRestarts";
const RESTART_WINDOW_KEY = "x.loading-trust.isolation.restartWindowSec";
/** 설정 값을 읽지 못할 때의 기본. 설정 정의(`loading-trust/settings-keys.ts`)와 같다(시험 `settings-keys.test.ts`가 값을 본다) */
const MAX_RESTARTS_DEFAULT = 3;
const RESTART_WINDOW_DEFAULT_SEC = 600;

const PROCESS_SERVICE_KEY: PortKey<ProcessService> = { name: ProcessServiceName };
const SANDBOX_SERVICE_KEY: PortKey<SandboxService> = { name: SandboxServiceName };

/** 격리 자식을 띄우는 포트(`fresnel.process`). 플랫폼 프로세스가 없으면 undefined다 */
export function processPortOf(ext: Pick<ExtHost, "ports">): IsolationProcessPort | undefined {
  return ext.ports.get(PROCESS_SERVICE_KEY);
}

/** 샌드박스 서비스를 띄울 때마다 찾는다. 샌드박스는 프로세스 포트보다 늦게 올라오므로 지연 조회다(P-15, mcp-process.ts와 같은 방식) */
export function sandboxSourceOf(ext: Pick<ExtHost, "ports">): () => SandboxService | undefined {
  return () => ext.ports.get(SANDBOX_SERVICE_KEY);
}

/** 설정 값이 정수면 그 값, 아니면 기본이다(설정 정의 범위 밖이나 빈 값의 방어) */
function integerOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

export interface PluginHostAssemblyDeps {
  readonly scheduler: Scheduler;
  readonly logger: Logger;
  /** 표준오류 한 줄을 저장하기 전에 가린다(엔진의 시크릿 마스킹) */
  readonly maskSecrets: (line: string) => string;
  readonly autoDisabler: Pick<OperationsPolicy["autoDisabler"], "disableNow">;
  /** 띄우기 포트(`fresnel.process`). 플랫폼 프로세스가 없으면 undefined다. 그러면 격리는 꺼진다 */
  readonly processPort: IsolationProcessPort | undefined;
  /** 호스트 상태 디렉터리(`OsDirs.state`). 자식 기록은 그 아래 `plugin-hosts/`에 둔다 */
  readonly stateDir: string;
  /** 설정 읽기. 재시작 한도 설정(`x.loading-trust.isolation.*`)을 죽음을 셀 때마다 읽는다 */
  readonly settingValue: (key: string) => unknown;
  readonly now: () => number;
  /** 엔진 pid. 시험이 넣고, 운영은 생략해 이 프로세스의 pid를 쓴다 */
  readonly enginePid?: number;
  /** 자기 실행 값. 시험이 넣고, 운영은 생략해 이 실행 파일을 쓴다 */
  readonly self?: SelfRunTarget;
  /** 세션을 열 때마다 부른다. 시험이 감독의 상태를 읽는다. 운영은 생략한다 */
  readonly onSupervisor?: (name: string, supervisor: PluginHostSupervisor) => void;
  /** 스크립트에 넘길 부모 환경 값과 실행기 PATH의 원천. 시험이 넣고, 운영은 생략해 `process.env`를 쓴다 */
  readonly parentEnv?: Readonly<Record<string, string | undefined>>;
  /** 실행기 이름을 절대 경로로 푼다. 시험이 넣고, 운영은 생략해 `parentEnv`의 PATH에서 찾는다. 없으면 undefined다 */
  readonly resolveRunner?: (name: ScriptRunner) => string | undefined;
}

/**
 * 스크립트에 넘길 수 있는 부모 환경 값(설계 B [제안]). 자식 env의 허용 목록(`BASE_ENV_POLICY.pass`, platform-process의
 * `childEnv`가 쓰는 같은 목록)에서 시크릿 거부 패턴(`SENSITIVE_ENV_PATTERNS`)에 걸리는 이름을 뺀 값만 담는다.
 * 선언된 `envNames`와 교차하는 것은 실행기가 한다.
 */
export function allowedEnvOf(
  parent: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of BASE_ENV_POLICY.pass) {
    if (isDeniedEnvName(name, SENSITIVE_ENV_PATTERNS)) continue;
    const value = parent[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

/**
 * 실행기 이름을 부모 환경의 PATH에서 찾아 절대 경로로 돌려준다. 자식이 받을 PATH와 같은 값으로 찾는다.
 * PATH에 없거나 절대 경로가 아니면 undefined다(실행기는 `runner_unavailable`로 답한다).
 */
export function runnerOnPath(
  parent: Readonly<Record<string, string | undefined>>,
): (name: ScriptRunner) => string | undefined {
  return (name) => {
    const path = parent["PATH"];
    if (path === undefined) return undefined;
    const found = Bun.which(name, { PATH: path });
    return found === null || !isAbsolute(found) ? undefined : found;
  };
}

export interface PluginHostAssembly {
  /** 로더에 넘기는 격리 설정 */
  readonly isolation: LoaderIsolation;
  /** 로더에 넘기는 띄우기 포트. 띄울 때마다 자식의 기록을 남긴다. 플랫폼 포트가 없으면 undefined */
  readonly process: IsolationProcessPort | undefined;
  /**
   * 엔진 시작 때 한 번 부른다. 죽은 엔진이 남긴 자식을 정리한다. 플랫폼 포트가 없으면 아무것도 하지 않는다.
   * 던지지 않는다(실패는 진단으로 남긴다)
   */
  readonly sweepOrphans: () => Promise<void>;
  /** 확장 하나의 표준오류 꼬리(줄 상한과 마스킹 뒤). 세션이 열린 적이 없으면 빈 목록이다. 진단 화면은 아직 이것을 읽지 않는다 */
  readonly stderrTail: (name: string) => readonly string[];
}

export function createPluginHostAssembly(deps: PluginHostAssemblyDeps): PluginHostAssembly {
  const supervisors = new Map<string, PluginHostSupervisor>();
  const parentEnv = deps.parentEnv ?? process.env;
  const recordDir = join(deps.stateDir, PLUGIN_HOSTS_DIR);
  const enginePid = deps.enginePid ?? process.pid;
  const port = deps.processPort;
  const tracked =
    port === undefined
      ? undefined
      : trackedPluginHostPort(port, {
          dir: recordDir,
          enginePid,
          now: deps.now,
          files: nodePluginHostFiles,
          logger: deps.logger,
        });
  return {
    isolation: {
      launch: (info) => pluginHostLaunch(info, deps.self),
      setTimer: (ms, fn) => {
        const handle = deps.scheduler.setTimeout(fn, ms);
        return () => {
          deps.scheduler.clearTimeout(handle);
        };
      },
      logger: deps.logger,
      initTimeoutMs: PLUGIN_HOST_INIT_TIMEOUT_MS,
      idleMs: PLUGIN_HOST_IDLE_MS,
      // 설정 값은 죽음을 셀 때마다 읽는다(live). 없거나 정수가 아니면 설정 정의의 기본이다
      maxRestarts: () => integerOr(deps.settingValue(MAX_RESTARTS_KEY), MAX_RESTARTS_DEFAULT),
      restartWindowSec: () =>
        integerOr(deps.settingValue(RESTART_WINDOW_KEY), RESTART_WINDOW_DEFAULT_SEC),
      maskSecrets: deps.maskSecrets,
      // 재시작 한도를 넘은 확장은 기준과 무관하게 바로 끈다(X.operations.spec §4.3.4). 다시 켜기는 설정으로 한다
      onRestartLimit: (name) => {
        deps.autoDisabler.disableNow(`ext:${name}`, "isolation_restart_limit");
      },
      onSupervisor: (name, supervisor) => {
        supervisors.set(name, supervisor);
        deps.onSupervisor?.(name, supervisor);
      },
      // 스크립트 실행기(설계 B [제안]). 실행기 이름은 부모 환경의 PATH에서 절대 경로로 풀고, 없으면 실행기가 `runner_unavailable`로 답한다
      runner: deps.resolveRunner ?? runnerOnPath(parentEnv),
      allowedEnv: allowedEnvOf(parentEnv),
    },
    process: tracked,
    sweepOrphans: async () => {
      if (port === undefined) return;
      const platform = detectProcessPlatform(deps.logger);
      if (!platform.ok) {
        deps.logger.warn("plugin_host.orphan_sweep_skipped", { reason: platform.error.kind });
        return;
      }
      const provider = platform.value;
      await sweepOrphanPluginHosts({
        dir: recordDir,
        enginePid,
        files: nodePluginHostFiles,
        commandOf: psCommandOf(readOsRuntime().runSync),
        signalTree: (pid, signal) => {
          provider.signalTree(pid, signal);
        },
        wait: (ms) =>
          new Promise<void>((resolve) => {
            deps.scheduler.setTimeout(() => {
              resolve();
            }, ms);
          }),
        graceMs: ORPHAN_GRACE_MS,
        logger: deps.logger,
      });
    },
    stderrTail: (name) => supervisors.get(name)?.stderrTail() ?? [],
  };
}
