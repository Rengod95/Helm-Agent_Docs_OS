import type { Logger, Scheduler } from "@fresnel/contracts";
import type { IsolationProcessPort, PortKey } from "@fresnel/contracts/extensions";
import {
  ProcessServiceName,
  SandboxServiceName,
  type ProcessService,
  type SandboxService,
} from "@fresnel/contracts/services";
import type {
  ExtHost,
  LoaderIsolation,
  OperationsPolicy,
  PluginHostSupervisor,
} from "@fresnel/ext-host";
import { pluginHostLaunch } from "../plugin-host/launch.ts";
import type { SelfRunTarget } from "../self-command.ts";

// L4.host-service.spec §4.1 3단계, §4.9. 격리 확장(플러그인 호스트 프로세스)의 조립 의존을 만든다: 띄울 명령, 시계, 진단, 재시작 한도 처리,
// 감독자 목록(표준오류 꼬리 읽기). 조립 루트 코드(DR-14 예외 2).

/** host.init 응답 시한(ms). 설정 예산 `x.operations.budget.setupMs`(기본 10초) 안에 host.init과 확장 등록이 끝나야 하므로 5초로 낮춘다 */
const PLUGIN_HOST_INIT_TIMEOUT_MS = 5000;
/** 마지막 호출 뒤 내리기까지(ms). 설정 키가 없어 상수로 둔다 */
const PLUGIN_HOST_IDLE_MS = 60000;
/** 죽은 뒤 다시 띄우는 횟수. 넘으면 자동 끄기(X.loading-trust §4.9.7) */
const PLUGIN_HOST_MAX_RESTARTS = 1;

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

export interface PluginHostAssemblyDeps {
  readonly scheduler: Scheduler;
  readonly logger: Logger;
  /** 표준오류 한 줄을 저장하기 전에 가린다(엔진의 시크릿 마스킹) */
  readonly maskSecrets: (line: string) => string;
  readonly autoDisabler: Pick<OperationsPolicy["autoDisabler"], "disableNow">;
  /** 자기 실행 값. 시험이 넣고, 운영은 생략해 이 실행 파일을 쓴다 */
  readonly self?: SelfRunTarget;
}

export interface PluginHostAssembly {
  /** 로더에 넘기는 격리 설정 */
  readonly isolation: LoaderIsolation;
  /** 확장 하나의 표준오류 꼬리(줄 상한과 마스킹 뒤). 세션이 열린 적이 없으면 빈 목록이다. 진단 화면은 아직 이것을 읽지 않는다 */
  readonly stderrTail: (name: string) => readonly string[];
}

export function createPluginHostAssembly(deps: PluginHostAssemblyDeps): PluginHostAssembly {
  const supervisors = new Map<string, PluginHostSupervisor>();
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
      maxRestarts: PLUGIN_HOST_MAX_RESTARTS,
      maskSecrets: deps.maskSecrets,
      // 재시작 한도를 넘은 확장은 기준과 무관하게 바로 끈다(X.operations.spec §4.3.4). 다시 켜기는 설정으로 한다
      onRestartLimit: (name) => {
        deps.autoDisabler.disableNow(`ext:${name}`, "isolation_restart_limit");
      },
      onSupervisor: (name, supervisor) => {
        supervisors.set(name, supervisor);
      },
    },
    stderrTail: (name) => supervisors.get(name)?.stderrTail() ?? [],
  };
}
