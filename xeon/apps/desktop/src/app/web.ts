import { ok, type Result } from "@fresnel/contracts";
import type { HostConnection } from "@fresnel/contracts/wire";
import { toolsWebViewOf, type OrderUpdate } from "@fresnel/client";
import type { CommandError, WebCommands } from "../views/commands.ts";

// 도구와 웹 화면(P-12)이 부르는 wire. `web.providers`는 읽기만 하고, 순서 저장은 `settings.set` 한 번이다(사용자 범위).
// 기대한 실패는 없고 연결과 host 실패만 `CommandError`다. 값은 보내기 전에 `orderUpdateOf`가 검사했다.

const SCOPE = "user";

type Run = <T>(
  work: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

export function createWebCommands(run: Run): WebCommands {
  return {
    async providers() {
      const listed = await run((c) => c.request("web.providers", {}));
      return listed.ok ? ok(toolsWebViewOf(listed.value)) : listed;
    },
    async setOrder(update: OrderUpdate) {
      const written = await run((c) =>
        c.request("settings.set", { key: update.key, value: [...update.value], scope: SCOPE }),
      );
      return written.ok ? ok(null) : written;
    },
  };
}
