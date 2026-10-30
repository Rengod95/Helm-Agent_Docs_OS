import { expect, test } from "bun:test";
import { err, ok, type Result } from "@xeon/contracts";
import {
  CapabilityError,
  type CallToolInputValue,
  type CallToolOutputValue,
  type ListServersOutputValue,
  type McpServerState,
} from "@xeon/contracts/capabilities";
import type { StoreService } from "@xeon/contracts/records";
import type { BrowserMcpPort } from "@xeon/cap-web";
import { createBrowserMcpPort } from "../../src/assembly/web-browser-mcp.ts";

// L2.web.spec §4.10.4a. 브라우저 MCP 포트를 `mcp.client` 능력의 목록과 호출로 맞춘다. 서버 이름은 `playwright`다.

const PNG_BYTES = new TextEncoder().encode("PNGDATA");
const PNG_BASE64 = "UE5HREFUQQ==";
const NO_SERVER = "MCP server 'playwright' is not connected";

function servers(
  entries: readonly { readonly server: string; readonly state: McpServerState }[],
): ListServersOutputValue {
  return {
    servers: entries.map((entry) => ({
      server: entry.server,
      source: "settings:user",
      state: entry.state,
      transport: "stdio",
      toolCount: 0,
      promptCount: 0,
    })),
  };
}

function store(): Pick<StoreService, "readBlob"> {
  return { readBlob: (): Result<Uint8Array, never> => ok(PNG_BYTES) };
}

interface Calls {
  readonly listed: number;
  readonly called: CallToolInputValue[];
}

/** `mcp.client`의 두 메서드 대역. 호출 기록과 응답을 준다 */
function fakeMcp(options: {
  readonly list?: () => ListServersOutputValue | Error;
  readonly call?: (
    input: CallToolInputValue,
    signal: AbortSignal | undefined,
  ) => Promise<CallToolOutputValue>;
}): { readonly mcp: Parameters<typeof createBrowserMcpPort>[0]["mcp"]; readonly calls: Calls } {
  const calls: { listed: number; called: CallToolInputValue[] } = { listed: 0, called: [] };
  const mcp: Parameters<typeof createBrowserMcpPort>[0]["mcp"] = {
    listServers: () => {
      calls.listed += 1;
      const answer = options.list?.() ?? servers([]);
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve(answer);
    },
    callTool: (input, callOptions) => {
      calls.called.push(input);
      if (options.call === undefined) return Promise.reject(new Error("no call expected"));
      return options.call(input, callOptions?.signal);
    },
  };
  return { mcp, calls };
}

function portOver(
  mcp: Parameters<typeof createBrowserMcpPort>[0]["mcp"],
  readable = true,
): BrowserMcpPort {
  return createBrowserMcpPort({
    mcp,
    store: readable
      ? store()
      : { readBlob: () => err({ kind: "blob_missing", sha256: "0".repeat(64) }) },
  });
}

const LIVE_SIGNAL = new AbortController().signal;

test("available is ok only when the playwright server is connected", async () => {
  const connected = fakeMcp({
    list: () => servers([{ server: "playwright", state: "connected" }]),
  });
  expect(await portOver(connected.mcp).available(LIVE_SIGNAL)).toEqual({ ok: true });

  const failed = fakeMcp({ list: () => servers([{ server: "playwright", state: "failed" }]) });
  expect(await portOver(failed.mcp).available(LIVE_SIGNAL)).toEqual({
    ok: false,
    detail: NO_SERVER,
  });

  const other = fakeMcp({ list: () => servers([{ server: "docs", state: "connected" }]) });
  expect(await portOver(other.mcp).available(LIVE_SIGNAL)).toEqual({
    ok: false,
    detail: NO_SERVER,
  });

  const broken = fakeMcp({ list: () => new Error("mcp is gone") });
  expect(await portOver(broken.mcp).available(LIVE_SIGNAL)).toEqual({
    ok: false,
    detail: NO_SERVER,
  });
});

test("callTool joins the text parts, decodes the image parts from the blob store, and passes isError through", async () => {
  const fake = fakeMcp({
    call: () =>
      Promise.resolve({
        status: "complete",
        isError: false,
        content: [
          { type: "text", text: "### Page" },
          {
            type: "image",
            blob: {
              type: "blob",
              sha256: "a".repeat(64),
              size: PNG_BYTES.length,
              mediaType: "image/png",
            },
            mimeType: "image/png",
          },
          { type: "text", text: "done" },
          { type: "unsupported", originalType: "audio" },
        ],
      }),
  });

  const result = await portOver(fake.mcp).callTool(
    "browser_snapshot",
    { depth: 2, full: false },
    LIVE_SIGNAL,
  );

  expect(result).toEqual({
    ok: true,
    value: {
      text: "### Page\ndone",
      images: [{ mediaType: "image/png", data: PNG_BASE64 }],
      isError: false,
    },
  });
  expect(fake.calls.called).toEqual([
    { server: "playwright", tool: "browser_snapshot", arguments: { depth: 2, full: false } },
  ]);
});

test("a tool that reports an error keeps its text and the isError flag", async () => {
  const fake = fakeMcp({
    call: () =>
      Promise.resolve({
        status: "complete",
        isError: true,
        content: [{ type: "text", text: "Element not found" }],
      }),
  });

  const result = await portOver(fake.mcp).callTool("browser_click", { element: "e7" }, LIVE_SIGNAL);

  expect(result).toEqual({
    ok: true,
    value: { text: "Element not found", images: [], isError: true },
  });
});

test("a server that asks for input is unavailable, because the browser tools cannot answer it", async () => {
  const fake = fakeMcp({
    call: () =>
      Promise.resolve({
        status: "input_required",
        round: 1,
        inputRequests: {},
        requestState: null,
        questions: [],
      }),
  });

  const result = await portOver(fake.mcp).callTool(
    "browser_navigate",
    { url: "https://a.example" },
    LIVE_SIGNAL,
  );

  expect(result.ok).toBe(false);
  expect(result.ok ? undefined : result.error.kind).toBe("unavailable");
  expect(
    result.ok ? "" : result.error.kind === "unavailable" ? result.error.message : "",
  ).toContain("asked for input");
});

test("a failed call is unavailable with the message, and an aborted call is aborted", async () => {
  const failing = fakeMcp({
    call: () =>
      Promise.reject(
        new CapabilityError({
          capability: "mcp.client",
          method: "callTool",
          code: "server_disconnected",
          message: "playwright went away",
          retryable: true,
        }),
      ),
  });
  expect(await portOver(failing.mcp).callTool("browser_close", {}, LIVE_SIGNAL)).toEqual({
    ok: false,
    error: { kind: "unavailable", message: "playwright went away" },
  });

  const controller = new AbortController();
  const aborting = fakeMcp({
    call: () => {
      controller.abort();
      return Promise.reject(new Error("aborted by the caller"));
    },
  });
  expect(await portOver(aborting.mcp).callTool("browser_close", {}, controller.signal)).toEqual({
    ok: false,
    error: { kind: "aborted" },
  });
});

test("an image the blob store cannot read makes the call unavailable, without dropping the text silently", async () => {
  const fake = fakeMcp({
    call: () =>
      Promise.resolve({
        status: "complete",
        isError: false,
        content: [
          {
            type: "image",
            blob: { type: "blob", sha256: "b".repeat(64), size: 3, mediaType: "image/png" },
            mimeType: "image/png",
          },
        ],
      }),
  });

  const result = await portOver(fake.mcp, false).callTool(
    "browser_take_screenshot",
    {},
    LIVE_SIGNAL,
  );

  expect(result).toEqual({
    ok: false,
    error: { kind: "unavailable", message: "the image from the browser server could not be read" },
  });
});

test("a tool whose MCP approval mode is deny is refused on the direct path without reaching the server; prompt and auto pass", async () => {
  const { mcp, calls } = fakeMcp({
    call: () => Promise.resolve({ status: "complete", content: [], isError: false }),
  });
  const modes: Record<string, "deny" | "prompt" | "auto"> = {
    browser_close: "deny",
    browser_click: "prompt",
    browser_snapshot: "auto",
  };
  const port = createBrowserMcpPort({
    mcp,
    store: store(),
    approvalModeOf: (tool) => modes[tool] ?? "prompt",
  });
  const signal = new AbortController().signal;
  expect(await port.callTool("browser_close", {}, signal)).toEqual({
    ok: false,
    error: {
      kind: "unavailable",
      message: "MCP server 'playwright' tool 'browser_close' is denied by the MCP approval mode",
    },
  });
  expect((await port.callTool("browser_click", {}, signal)).ok).toBe(true);
  expect((await port.callTool("browser_snapshot", {}, signal)).ok).toBe(true);
  expect(calls.called.map((call) => call.tool)).toEqual(["browser_click", "browser_snapshot"]);
});
