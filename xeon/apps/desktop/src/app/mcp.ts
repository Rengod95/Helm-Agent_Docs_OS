import { ok, type Result } from "@fresnel/contracts";
import type { HostConnection } from "@fresnel/contracts/wire";
import type { CommandError, McpCommands } from "../views/commands.ts";
import { MCP_SERVERS_KEY } from "../views/pages/settings/settings-mcp-model.ts";

// "MCP 서버" 구역(W-15)이 부르는 wire. `mcp.servers`와 `mcp.serverAction`은 호스트가 준 값을 그대로 돌려준다.
// 표 쓰기는 `settings.set { key: "l2.mcp.servers", scope: "user" }` 한 번이다. 값은 사용자 범위 표 전체다(화면이 읽고 고친다).

const SCOPE = "user";

type Run = <T>(
  work: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

export function createMcpCommands(read: Run, write: Run): McpCommands {
  return {
    async servers() {
      const listed = await read((c) => c.request("mcp.servers", {}));
      return listed.ok ? ok(listed.value.servers) : listed;
    },
    async serverAction(server, action) {
      const done = await write((c) => c.request("mcp.serverAction", { server, action }));
      return done.ok ? ok(done.value) : done;
    },
    async setUserTable(table) {
      const written = await write((c) =>
        c.request("settings.set", { key: MCP_SERVERS_KEY, value: table, scope: SCOPE }),
      );
      return written.ok ? ok(null) : written;
    },
  };
}
