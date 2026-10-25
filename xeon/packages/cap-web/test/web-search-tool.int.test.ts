import { afterAll, describe, expect, test } from "bun:test";
import type { Logger } from "@xeon/contracts";
import { parse } from "@xeon/contracts";
import { UNTRUSTED_OPEN, WebSearch, WebSearchOutputSchema } from "@xeon/contracts/capabilities";
import type { HostedSearchPort } from "@xeon/contracts/services";
import { directConvertRunner } from "../src/fetch/convert-runner.ts";
import type { HttpTransport } from "../src/ports/transport.ts";
import { createWebRuntime, type WebRuntime } from "../src/runtime.ts";
import { decideModelSearchTool, isWrapperOnlyChain } from "../src/search/model-tool.ts";
import { readWebSettings, type WebSettings } from "../src/settings.ts";
import { fakeSessionSources } from "../src/testing/fake-ports.ts";
import { fakeResolver } from "../src/testing/fake-resolver.ts";
import { fixtureTransport } from "../src/testing/http-fixtures.ts";
import { createHttpTransport } from "../src/transport/http-transport.ts";
import { manualClock } from "./support/clock.ts";
import { fixedLocalIds } from "./support/ids.ts";
import { hostedTape } from "./support/tapes.ts";

// m2-plan G4-05. `web_search` 모델 도구를 계약의 도구 정의(파라미터 파싱 → 서비스 입력 → 서비스 → 모델용 결과) 그대로 걸어
// 실제 조립(`createWebRuntime`)에서 시험한다. SearXNG는 루프백 가짜 서버(127.0.0.1)이고 운영 전송(`createHttpTransport`)이 실제로 연결한다.
// 기본 설정(주소 없음)에서는 어느 주소에도 요청이 나가지 않고 내장 래퍼가 답한다(H1). 인터넷으로 나가는 요청은 없다.

const SEARX_JSON = JSON.stringify({
  query: "xeon",
  results: [{ url: "https://docs.example.org/a", title: "Alpha", content: "first result" }],
});

const hits: string[] = [];
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
    hits.push(new URL(request.url).pathname);
    return new Response(SEARX_JSON, { headers: { "content-type": "application/json" } });
  },
});

afterAll(async () => {
  await server.stop(true);
});

const SILENT: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => SILENT,
};

function build(
  settings: WebSettings,
  options: { readonly hosted: HostedSearchPort; readonly transport?: HttpTransport },
): WebRuntime {
  const resolver = fakeResolver({ localhost: ["127.0.0.1"] });
  return createWebRuntime({
    clock: manualClock(),
    ids: fixedLocalIds(),
    logger: SILENT,
    settings: () => settings,
    sessionSources: fakeSessionSources(),
    resolver,
    transport: options.transport ?? createHttpTransport({ resolver }),
    convert: directConvertRunner(),
    hostedSearch: options.hosted,
  });
}

/** 모델이 `web_search`를 부르는 길: 파라미터 파싱, 서비스 입력으로 변환, 서비스 호출, 모델용 결과 */
async function callTool(runtime: WebRuntime, args: unknown) {
  const tool = WebSearch.tools[0];
  if (tool.toInput === undefined || tool.toContent === undefined) {
    throw new Error("web_search must declare toInput and toContent");
  }
  const params = parse(tool.parameters, args);
  if (!params.ok) throw new Error("tool parameters were rejected");
  const output = await runtime.service.search.search(tool.toInput(params.value));
  const checked = parse(WebSearchOutputSchema, output);
  if (!checked.ok) throw new Error("service output does not match the contract");
  const content = tool.toContent(checked.value);
  const first = content.content[0];
  return {
    output: checked.value,
    text: first !== undefined && first.type === "text" ? first.text : "",
  };
}

describe("web_search tool path (G4-05)", () => {
  test("with default settings the wrapper answers, nothing is probed and the model tool is hosted", async () => {
    hits.length = 0;
    const hosted = hostedTape("wrapper-basic");
    const transport = fixtureTransport({}, fakeResolver());
    const runtime = build(readWebSettings([]), { hosted, transport });
    const { output, text } = await callTool(runtime, { query: "xeon" });
    expect(output.meta.provider).toBe("builtin-wrapper");
    expect(output.meta.fallbacks).toEqual([]);
    expect(output.results.map((result) => result.sourceId)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(text.startsWith(UNTRUSTED_OPEN)).toBe(true);
    expect(text).toContain("[s1] Guide");
    expect(text).toContain("https://docs.example.org/guide");
    // 기본 설정에서 후보는 내장 래퍼뿐이고, 설정이 없는 SearXNG를 찾으러 나간 요청은 없다
    expect(runtime.catalog.searchCandidates().map((candidate) => candidate.provider.id)).toEqual([
      "builtin-wrapper",
    ]);
    expect(transport.requests).toHaveLength(0);
    expect(hits).toEqual([]);
    expect(
      decideModelSearchTool({
        setting: readWebSettings([]).search.modelTool,
        wrapperOnlyChain: isWrapperOnlyChain(runtime.catalog.searchCandidates()),
        hostedSupported: true,
      }),
    ).toBe("hosted");
    await runtime.close();
  });

  test("with a SearXNG address set the same tool answers from the loopback server and the model tool becomes function", async () => {
    hits.length = 0;
    const hosted = hostedTape("wrapper-basic");
    const base = readWebSettings([]);
    const settings: WebSettings = {
      ...base,
      search: { ...base.search, searxng: { url: `http://127.0.0.1:${String(server.port)}` } },
    };
    const runtime = build(settings, { hosted });
    const { output, text } = await callTool(runtime, { query: "xeon" });
    expect(output.meta.provider).toBe("searxng");
    expect(output.results.map((result) => result.url)).toEqual(["https://docs.example.org/a"]);
    expect(text).toContain("[s1] Alpha");
    // 탐침 한 번과 검색 한 번. 래퍼는 부르지 않았다
    expect(hits).toEqual(["/search", "/search"]);
    expect(hosted.requests).toHaveLength(0);
    expect(
      decideModelSearchTool({
        setting: settings.search.modelTool,
        wrapperOnlyChain: isWrapperOnlyChain(runtime.catalog.searchCandidates()),
        hostedSupported: true,
      }),
    ).toBe("function");
    await runtime.close();
  });
});
