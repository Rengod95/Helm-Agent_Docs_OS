import type { CapabilityApi, McpClient } from "../capabilities/index.ts";
import type { McpPort } from "../extensions/index.ts";

// L2.mcp.spec §3.2. 구현은 cap-mcp다. McpService는 X 포트 McpPort(F.extensions.spec §3.2.1)를 확장한다.
// capabilities는 extensions보다 낮은 서브패스라 이 인터페이스는 capabilities/defs/mcp.ts가 아니라 여기에 둔다(F.capabilities.spec §3.12 규칙 7).

/** Cordis 서비스 이름. SERVICE_NAMES.mcp, eng.context-map.design §5.3 표와 같다 */
export const McpServiceName = "xeon.mcp" as const;

/**
 * xeon.mcp에 Cordis로 등록하는 서비스 인터페이스. X McpPort(registerServer)를 확장한다.
 * L2 서비스 이름 중 Cordis에 등록하는 것은 이것 하나다.
 */
export interface McpService extends McpPort {
  /** 능력 API. 같은 객체를 cap:mcp.client 바인딩(g.capability(McpClientKey))으로도 얻는다 */
  readonly client: CapabilityApi<typeof McpClient>;
}
