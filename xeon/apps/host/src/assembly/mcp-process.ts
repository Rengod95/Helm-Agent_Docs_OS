import type { Logger, Scheduler } from "@xeon/contracts";
import type { PortKey } from "@xeon/contracts/extensions";
import {
  ProcessServiceName,
  SandboxServiceName,
  type ProcessService,
  type SandboxService,
  type SecretService,
} from "@xeon/contracts/services";
import type { ExtHost } from "@xeon/ext-host";
import {
  createMcpProcessPort,
  detectProcessPlatform,
  type McpProcessPort,
} from "@xeon/platform-process";

// G1-04, 결정 D6(ADR-0011). stdio MCP 서버를 사용자 권한 자식 프로세스로 띄우는 포트. cap-mcp는 L0를 import하지 않아 같은 모양의
// `McpProcessPort`를 자기 포트로 선언해 두었고, 이 파일이 L0 platform-process의 구현(`createMcpProcessPort`)을 그 모양으로 건넨다.
// 샌드박스를 요청한 서버는 `xeon.sandbox`의 `wrapArgv` 명령줄로 뜨고, 격리할 수 없으면 `sandbox_unavailable`로 막힌다(P-15).
// 종료 순서(stdin 닫기 → 유예 → SIGTERM → 유예 → SIGKILL)와 `BackgroundRegistry` 등록은 platform-process가 한다.
// 비밀 env(`secret://`)를 쓰는 서버의 기동 승인 증거는 cap-mcp가 spawn 요청에 싣는다(`mcp-start.ts`, M3-05). 조립 루트 코드(DR-14 예외 2).

/** stdio 서버가 끝난 뒤 표준 출력이 닫히기를 기다리는 시간(ms) */
const MCP_DRAIN_MS = 1000;

const PROCESS_SERVICE_KEY: PortKey<ProcessService> = { name: ProcessServiceName };
const SANDBOX_SERVICE_KEY: PortKey<SandboxService> = { name: SandboxServiceName };

export interface McpProcessDeps {
  readonly ext: Pick<ExtHost, "ports">;
  readonly secrets: Pick<SecretService, "withEnv">;
  /** 샌드박스 정책의 쓰기 루트로 더하는 임시 디렉터리(`os.dirs.tmp`) */
  readonly tempDir: string;
  readonly scheduler: Scheduler;
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  readonly logger: Logger;
}

/**
 * xeon.process가 올라와 있지 않으면 undefined다(그러면 stdio 서버는 연결에 실패한다). 프로세스 트리 종료 수단이 없는 OS면 포트는 만들어지지만
 * 모든 기동이 `unsupported_platform`으로 실패한다
 */
export function createHostMcpProcessPort(deps: McpProcessDeps): McpProcessPort | undefined {
  const service = deps.ext.ports.get(PROCESS_SERVICE_KEY);
  if (service === undefined) return undefined;
  const platform = detectProcessPlatform(deps.logger);
  return createMcpProcessPort({
    platform: platform.ok ? platform.value : undefined,
    background: service.background,
    secrets: deps.secrets,
    // xeon.sandbox는 이 포트보다 늦게 올라온다. spawn 때마다 찾고, 없으면 샌드박스가 필요한 서버는 막힌다(P-15)
    sandbox: () => deps.ext.ports.get(SANDBOX_SERVICE_KEY),
    tempDir: deps.tempDir,
    scheduler: deps.scheduler,
    parentEnv: deps.parentEnv,
    logger: deps.logger,
    drainMs: MCP_DRAIN_MS,
  });
}
