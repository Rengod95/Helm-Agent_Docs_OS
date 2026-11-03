import { describe, expect, test } from "bun:test";
import type { Logger } from "@fresnel/contracts";
import { parse } from "@fresnel/contracts";
import { UNTRUSTED_OPEN, WebSearch, WebSearchOutputSchema } from "@fresnel/contracts/capabilities";
import type { HostedSearchPort } from "@fresnel/contracts/services";
import { directConvertRunner } from "../src/fetch/convert-runner.ts";
import { createWebRuntime, type WebRuntime } from "../src/runtime.ts";
import { decideModelSearchTool, isWrapperOnlyChain } from "../src/search/model-tool.ts";
import type { PluginRegistration } from "../src/search/registry.ts";
import { readWebSettings, type WebSettings } from "../src/settings.ts";
import { fakeSearchProvider, type FakeSearchProvider } from "../src/testing/fake-providers.ts";
import { fakeSessionSources } from "../src/testing/fake-ports.ts";
import { fakeResolver } from "../src/testing/fake-resolver.ts";
import { fixtureTransport, type FixtureTransport } from "../src/testing/http-fixtures.ts";
import { manualClock } from "./support/clock.ts";
import { fixedLocalIds } from "./support/ids.ts";
import { hostedTape } from "./support/tapes.ts";

// m2-plan G4-05. `web_search` 모델 도구를 계약의 도구 정의(파라미터 파싱 → 서비스 입력 → 서비스 → 모델용 결과) 그대로 걸어
// 실제 조립(`createWebRuntime`)에서 시험한다. 기본 설정(플러그인 없음)에서는 어느 주소에도 요청이 나가지 않고 내장 래퍼가 답한다(H1).
// 키를 등록한 플러그인을 설치해 순서의 앞에 올리면 그 플러그인이 답한다. 플러그인은 가짜이고, 인터넷으로 나가는 요청은 없다.

const PLUGIN_ID = "plugin:example-search";

const SILENT: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => SILENT,
};

interface Built {
  readonly runtime: WebRuntime;
  /** 네트워크로 나간 요청. 이 시험의 어떤 경로에서도 비어 있어야 한다 */
  readonly transport: FixtureTransport;
}

function build(
  settings: WebSettings,
  options: { readonly hosted: HostedSearchPort; readonly plugin?: FakeSearchProvider },
): Built {
  const resolver = fakeResolver();
  const transport = fixtureTransport({}, resolver);
  const plugin = options.plugin;
  const registrations: readonly PluginRegistration[] =
    plugin === undefined
      ? []
      : [
          {
            extension: "example-search",
            registration: { capability: "web.search", create: () => plugin },
          },
        ];
  const runtime = createWebRuntime({
    clock: manualClock(),
    ids: fixedLocalIds(),
    logger: SILENT,
    settings: () => settings,
    sessionSources: fakeSessionSources(),
    resolver,
    transport,
    convert: directConvertRunner(),
    registrations: { list: () => registrations },
    hostedSearch: options.hosted,
  });
  return { runtime, transport };
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
    const hosted = hostedTape("wrapper-basic");
    const { runtime, transport } = build(readWebSettings([]), { hosted });
    const { output, text } = await callTool(runtime, { query: "fresnel" });
    expect(output.meta.provider).toBe("builtin-wrapper");
    expect(output.meta.fallbacks).toEqual([]);
    expect(output.results.map((result) => result.sourceId)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(text.startsWith(UNTRUSTED_OPEN)).toBe(true);
    expect(text).toContain("[s1] Guide");
    expect(text).toContain("https://docs.example.org/guide");
    // 기본 설정에서 후보는 내장 래퍼뿐이고, 설치하지 않은 플러그인을 찾으러 나간 요청은 없다
    expect(runtime.catalog.searchCandidates().map((candidate) => candidate.provider.id)).toEqual([
      "builtin-wrapper",
    ]);
    expect(transport.requests).toHaveLength(0);
    expect(
      decideModelSearchTool({
        setting: readWebSettings([]).search.modelTool,
        wrapperOnlyChain: isWrapperOnlyChain(runtime.catalog.searchCandidates()),
        hostedSupported: true,
      }),
    ).toBe("hosted");
    await runtime.close();
  });

  test("with a key plugin listed first the same tool answers from the plugin and the model tool becomes function", async () => {
    const hosted = hostedTape("wrapper-basic");
    const plugin = fakeSearchProvider(PLUGIN_ID, {
      result: () => ({
        items: [
          {
            url: "https://docs.example.org/a",
            title: "Alpha",
            passages: [{ text: "first result", kind: "snippet" }],
          },
        ],
        appliedNatively: [],
        warnings: [],
      }),
    });
    const base = readWebSettings([]);
    const settings: WebSettings = {
      ...base,
      search: { ...base.search, order: [PLUGIN_ID] },
    };
    const { runtime, transport } = build(settings, { hosted, plugin });
    const { output, text } = await callTool(runtime, { query: "fresnel" });
    expect(output.meta.provider).toBe(PLUGIN_ID);
    expect(output.results.map((result) => result.url)).toEqual(["https://docs.example.org/a"]);
    expect(text).toContain("[s1] Alpha");
    expect(plugin.searches.map((request) => request.terms)).toEqual(["fresnel"]);
    // 래퍼는 부르지 않았다
    expect(hosted.requests).toHaveLength(0);
    expect(transport.requests).toHaveLength(0);
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
