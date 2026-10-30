import { ok, type Result } from "@xeon/contracts";
import type { BrowserMcpError, BrowserMcpPort, BrowserMcpResult } from "../ports/browser-mcp.ts";

// 가짜 Playwright MCP 포트(L2.web.spec §4.10.4a, M3-new-13). 도구 호출을 기록하고 스크립트한 응답을 돌려준다.
// 기본 응답은 페이지 상태 Markdown이고, `browser_navigate`의 주소를 따라 간다. 그래서 기본 스냅샷의 주소는 항상 방금 연 주소다.

export const DEFAULT_TITLE = "Fake page";

/** 기본 스냅샷: 버튼 "Pay now"(e3)와 링크 "Docs"(e4) */
export const DEFAULT_SNAPSHOT_YAML: string = [
  '- button "Pay now" [ref=e3]',
  '- link "Docs" [ref=e4]',
].join("\n");

type BrowserMcpToolArgs = Readonly<Record<string, string | number | boolean | readonly string[]>>;

interface BrowserMcpCall {
  readonly tool: string;
  readonly args: BrowserMcpToolArgs;
}

export type BrowserMcpReply = Result<BrowserMcpResult, BrowserMcpError>;

export interface BrowserMcpScript {
  /** 탐침 결과. 기본은 연결됨 */
  readonly available?: { readonly ok: true } | { readonly ok: false; readonly detail: string };
  /** 도구 이름 → 응답 함수. 없는 도구는 기본 응답을 돌려준다 */
  readonly replies?: Readonly<Record<string, (call: BrowserMcpCall) => BrowserMcpReply>>;
}

export interface FakeBrowserMcp extends BrowserMcpPort {
  /** 받은 도구 호출 기록(순서대로) */
  readonly calls: BrowserMcpCall[];
}

/** 도구 응답 Markdown의 페이지 상태 모양. 실제 응답의 "### Page state" 블록을 흉내 낸다 */
export function pageStateText(url: string, title: string, yaml: string): string {
  return [
    "### Page state",
    `- Page URL: ${url}`,
    `- Page Title: ${title}`,
    "- Page Snapshot:",
    "```yaml",
    yaml,
    "```",
  ].join("\n");
}

export function fakeBrowserMcp(script: BrowserMcpScript = {}): FakeBrowserMcp {
  const calls: BrowserMcpCall[] = [];
  let currentUrl = "about:blank";

  function defaultReply(call: BrowserMcpCall): BrowserMcpReply {
    if (call.tool === "browser_navigate") {
      const url = call.args["url"];
      currentUrl = typeof url === "string" ? url : currentUrl;
    }
    if (call.tool === "browser_navigate" || call.tool === "browser_snapshot") {
      return ok({
        text: pageStateText(currentUrl, DEFAULT_TITLE, DEFAULT_SNAPSHOT_YAML),
        images: [],
        isError: false,
      });
    }
    if (call.tool === "browser_close") {
      return ok({ text: "Browser closed.", images: [], isError: false });
    }
    return ok({ text: "Done.", images: [], isError: false });
  }

  return {
    calls,
    available: () => Promise.resolve(script.available ?? { ok: true }),
    callTool(tool, args) {
      const call: BrowserMcpCall = { tool, args };
      calls.push(call);
      const reply = script.replies?.[tool];
      return Promise.resolve(reply === undefined ? defaultReply(call) : reply(call));
    },
  };
}
