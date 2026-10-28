import type { Logger, Scheduler } from "@xeon/contracts";
import type { PortKey } from "@xeon/contracts/extensions";
import {
  ProcessServiceName,
  type ProcessService,
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
// 종료 순서(stdin 닫기 → 유예 → SIGTERM → 유예 → SIGKILL)와 `BackgroundRegistry` 등록은 platform-process가 한다.
// 비밀 env(`secret://`)를 쓰는 서버는 기동 승인 지점이 없어 `secret_denied`로 끝난다(M3, ADR-0011). 조립 루트 코드(DR-14 예외 2).

/** stdio 서버가 끝난 뒤 표준 출력이 닫히기를 기다리는 시간(ms) */
const MCP_DRAIN_MS = 1000;

const PROCESS_SERVICE_KEY: PortKey<ProcessService> = { name: ProcessServiceName };

export interface McpProcessDeps {
  readonly ext: Pick<ExtHost, "ports">;
  readonly secrets: Pick<SecretService, "withEnv">;
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
    scheduler: deps.scheduler,
    parentEnv: deps.parentEnv,
    logger: deps.logger,
    drainMs: MCP_DRAIN_MS,
  });
}
