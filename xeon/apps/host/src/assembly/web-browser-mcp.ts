import { attemptAsync, err, ok } from "@xeon/contracts";
import type { CapabilityApi, McpClient } from "@xeon/contracts/capabilities";
import type { JsonObject } from "@xeon/contracts/conversation";
import type { StoreService } from "@xeon/contracts/records";
import type { BrowserMcpImage, BrowserMcpPort } from "@xeon/cap-web";
import { messageOf } from "../util.ts";

// L2.web.spec §4.10.4a. `BrowserMcpPort`(cap-web이 아는 최소 모양)를 cap-mcp의 `mcp.client` 능력으로 맞춘다. cap-web은 cap-mcp를 import하지 않는다.
// 서버 이름 `playwright`는 사용자가 설정에 둔 MCP 서버(`@playwright/mcp`)의 이름이다. 다른 이름을 고르는 설정은 나중 옵션이다 [결정: 오케스트레이터 기본값].
// 이 경로는 cap-mcp의 `callTool`을 직접 부른다. 서버 도구의 승인 모드(`l2.mcp` approval)는 L1.tools 도구 경로에서만 검사하므로 여기에는 없다.
// 브라우저 동작의 사람 확인(`browseConfirm`)은 아직 조립하지 않아 확인이 필요한 동작은 거부된다(cap-web 기본 동작) [미결].

/** 브라우저 MCP 서버의 설정 이름 */
export const BROWSER_MCP_SERVER = "playwright";

const NOT_CONNECTED = `MCP server '${BROWSER_MCP_SERVER}' is not connected`;
/** 실패 문구를 오류 메시지에 싣는 길이. 도구가 돌려준 본문이 길어도 줄인다 */
const MESSAGE_MAX = 200;

export interface BrowserMcpDeps {
  /** `mcp.client` 능력의 목록과 호출 메서드. 조립이 `g.capability(McpClientKey)`로 얻는다 */
  readonly mcp: Pick<CapabilityApi<typeof McpClient>, "listServers" | "callTool">;
  /** 스크린샷 blob을 바이트로 읽는다. MCP 결과의 이미지는 blob 참조다 */
  readonly store: Pick<StoreService, "readBlob">;
}

/** cap-web의 인자 모양(문자열, 수, 불리언, 문자열 목록)을 MCP 호출의 JSON 객체로 옮긴다 */
function jsonArgsOf(
  args: Readonly<Record<string, string | number | boolean | readonly string[]>>,
): JsonObject {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [
      key,
      typeof value === "object" ? [...value] : value,
    ]),
  );
}

export function createBrowserMcpPort(deps: BrowserMcpDeps): BrowserMcpPort {
  return {
    async available(signal) {
      const listed = await attemptAsync(() => deps.mcp.listServers({}, { signal }));
      if (!listed.ok) return { ok: false, detail: NOT_CONNECTED };
      const server = listed.value.servers.find((entry) => entry.server === BROWSER_MCP_SERVER);
      return server?.state === "connected" ? { ok: true } : { ok: false, detail: NOT_CONNECTED };
    },
    async callTool(tool, args, signal) {
      const called = await attemptAsync(() =>
        deps.mcp.callTool(
          { server: BROWSER_MCP_SERVER, tool, arguments: jsonArgsOf(args) },
          { signal },
        ),
      );
      if (!called.ok) {
        if (signal.aborted) return err({ kind: "aborted" });
        return err({
          kind: "unavailable",
          message: messageOf(called.error.cause).slice(0, MESSAGE_MAX),
        });
      }
      const result = called.value;
      // 입력 요청(`input_required`)에는 답할 자리가 없다. 브라우저 도구는 한 번에 끝나는 호출만 쓴다
      if (result.status !== "complete") {
        return err({
          kind: "unavailable",
          message: `MCP server '${BROWSER_MCP_SERVER}' asked for input, which the browser tools do not answer`,
        });
      }
      const texts: string[] = [];
      const images: BrowserMcpImage[] = [];
      for (const part of result.content) {
        if (part.type === "text") {
          texts.push(part.text);
        } else if (part.type === "image") {
          const bytes = deps.store.readBlob(part.blob);
          if (!bytes.ok) {
            return err({
              kind: "unavailable",
              message: "the image from the browser server could not be read",
            });
          }
          images.push({
            mediaType: part.mimeType,
            data: Buffer.from(bytes.value).toString("base64"),
          });
        }
      }
      return ok({ text: texts.join("\n"), images, isError: result.isError });
    },
  };
}
