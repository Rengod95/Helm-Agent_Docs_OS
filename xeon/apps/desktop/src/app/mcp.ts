import { ok, type Result } from "@fresnel/contracts";
import type { HostConnection } from "@fresnel/contracts/wire";
import type { CommandError, McpCommands } from "../views/commands.ts";

// "MCP 서버" 구역(W-15)이 부르는 wire. `mcp.servers`와 `mcp.serverAction`은 호스트가 준 값을 그대로 돌려준다.
// 서버 정의의 쓰기는 이 파일에 없다: 화면이 `settings.readFile`과 `settings.writeFile { baseSha256 }`로 한다(`settings-mcp-screen.tsx`).

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
  };
}
