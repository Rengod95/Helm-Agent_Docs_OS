import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { Logger } from "@xeon/contracts";
import type { WebService } from "@xeon/contracts/capabilities";
import type { HostedSearchPort } from "@xeon/contracts/services";
import { directConvertRunner } from "../src/fetch/convert-runner.ts";
import type { HttpTransport } from "../src/ports/transport.ts";
import { createWebRuntime, type WebRuntime } from "../src/runtime.ts";
import { DEFAULT_WEB_SETTINGS, type WebSettings } from "../src/settings.ts";
import { fakeSessionSources } from "../src/testing/fake-ports.ts";
import { fakeResolver } from "../src/testing/fake-resolver.ts";
import { fixtureTransport } from "../src/testing/http-fixtures.ts";
import { createHttpTransport } from "../src/transport/http-transport.ts";
import { manualClock } from "./support/clock.ts";
import { fixedLocalIds } from "./support/ids.ts";
import { hostedTape } from "./support/tapes.ts";

// m2-plan E4: `web.search`가 SearXNG를 감지하면 SearXNG, 없으면 내장 검색 래퍼(L2.web.spec §9 수용 기준 1, 2).
// SearXNG는 루프백 가짜 서버(127.0.0.1)이고 운영 전송(`createHttpTransport`)이 그 서버로 실제 연결한다. 모델 호출은 테이프다.
// 인터넷으로 나가는 요청은 없다.

const SEARX_JSON = JSON.stringify({
  query: "xeon",
  results: [
    { url: "https://docs.example.org/a", title: "A", content: "first result" },
    { url: "https://docs.example.org/b", title: "B", content: "second result" },
  ],
});

interface ServerState {
  mode: "json" | "forbidden";
  hits: string[];
}

const state: ServerState = { mode: "json", hits: [] };

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
    state.hits.push(new URL(request.url).pathname);
    if (state.mode === "forbidden") return new Response("Forbidden", { status: 403 });
    return new Response(SEARX_JSON, { headers: { "content-type": "application/json" } });
  },
});

afterAll(async () => {
  await server.stop(true);
});

afterEach(() => {
  state.mode = "json";
  state.hits.length = 0;
});

const SILENT: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => SILENT,
};

/** 사용하지 않는 포트. 열었다가 닫아 그 포트에 연결하면 거부된다 */
async function closedPort(): Promise<number> {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") });
  const port = probe.port ?? 0;
  await probe.stop(true);
  return port;
}

interface Built {
  readonly runtime: WebRuntime;
  readonly service: WebService;
}

function build(
  searxng: Partial<WebSettings["search"]["searxng"]>,
  options: { readonly hosted?: HostedSearchPort; readonly transport?: HttpTransport } = {},
): Built {
  const settings: WebSettings = {
    ...DEFAULT_WEB_SETTINGS,
    search: {
      ...DEFAULT_WEB_SETTINGS.search,
      searxng: { ...DEFAULT_WEB_SETTINGS.search.searxng, ...searxng },
    },
  };
  const resolver = fakeResolver({ localhost: ["127.0.0.1"] });
  const runtime = createWebRuntime({
    clock: manualClock(),
    ids: fixedLocalIds(),
    logger: SILENT,
    settings: () => settings,
    sessionSources: fakeSessionSources(),
    resolver,
    transport: options.transport ?? createHttpTransport({ resolver }),
    convert: directConvertRunner(),
    ...(options.hosted === undefined ? {} : { hostedSearch: options.hosted }),
  });
  return { runtime, service: runtime.service };
}

const SEARX_URL = `http://127.0.0.1:${String(server.port)}`;

describe("E4 web.search provider selection", () => {
  test("a reachable SearXNG answers and the wrapper is never called", async () => {
    const hosted = hostedTape("wrapper-basic");
    const { service } = build({ url: SEARX_URL, detect: false }, { hosted });
    const found = await service.search.search({ query: "xeon" });
    expect(found.meta.provider).toBe("searxng");
    expect(found.meta.selectedBy).toBe("auto");
    expect(found.meta.fallbacks).toEqual([]);
    expect(found.meta.cost).toMatchObject({ basis: "free", usd: 0 });
    expect(found.results.map((result) => result.url)).toEqual([
      "https://docs.example.org/a",
      "https://docs.example.org/b",
    ]);
    // 탐침 한 번과 검색 한 번이 루프백 서버에 도착했다
    expect(state.hits).toEqual(["/search", "/search"]);
    expect(hosted.requests).toHaveLength(0);
  });

  test("without a SearXNG the built-in wrapper answers and the fallback names the probe", async () => {
    const hosted = hostedTape("wrapper-basic");
    const port = await closedPort();
    const { service } = build(
      { url: `http://127.0.0.1:${String(port)}`, detect: false },
      { hosted },
    );
    const found = await service.search.search({ query: "xeon" });
    expect(found.meta.provider).toBe("builtin-wrapper");
    expect(found.meta.selectedBy).toBe("auto");
    expect(found.meta.fallbacks).toHaveLength(1);
    expect(found.meta.fallbacks[0]).toMatchObject({
      provider: "searxng",
      stage: "probe",
      reason: "unreachable",
    });
    expect(found.meta.cost.basis).toBe("estimated");
    expect(hosted.requests).toHaveLength(1);
    expect(found.results.length).toBeGreaterThan(0);
  });

  test("a SearXNG with json turned off falls back and says how to fix it once per thread", async () => {
    state.mode = "forbidden";
    const hosted = hostedTape("wrapper-basic");
    const { service } = build({ url: SEARX_URL, detect: false }, { hosted });
    const first = await service.search.search({ query: "xeon one" });
    expect(first.meta.provider).toBe("builtin-wrapper");
    expect(first.meta.fallbacks[0]).toMatchObject({ provider: "searxng", reason: "json-disabled" });
    expect(first.meta.warnings.some((line) => line.startsWith("searxng_json_disabled"))).toBe(true);
    // 두 번째 호출은 같은 안내를 다시 붙이지 않는다. 탐침 실패는 30초 동안 기억되어 서버에도 다시 가지 않는다
    const second = await service.search.search({ query: "xeon two" });
    expect(second.meta.fallbacks[0]).toMatchObject({ reason: "json-disabled" });
    expect(second.meta.warnings.some((line) => line.startsWith("searxng_json_disabled"))).toBe(
      false,
    );
    expect(state.hits).toEqual(["/search"]);
  });

  test("an explicit builtin-wrapper never asks SearXNG", async () => {
    const hosted = hostedTape("wrapper-basic");
    const { service } = build({ url: SEARX_URL, detect: false }, { hosted });
    const found = await service.search.search({ query: "xeon", provider: "builtin-wrapper" });
    expect(found.meta.provider).toBe("builtin-wrapper");
    expect(found.meta.selectedBy).toBe("call");
    expect(state.hits).toEqual([]);
  });

  test("an explicit searxng that is down does not fall back", async () => {
    const hosted = hostedTape("wrapper-basic");
    const port = await closedPort();
    const { service } = build(
      { url: `http://127.0.0.1:${String(port)}`, detect: false },
      { hosted },
    );
    const failed = await service.search.search({ query: "xeon", provider: "searxng" }).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(failed).toMatchObject({
      data: { code: "unavailable", detail: { reason: "unreachable" } },
    });
    expect(hosted.requests).toHaveLength(0);
  });

  test("neither provider available is unavailable with the whole fallback list", async () => {
    const port = await closedPort();
    const { service } = build({ url: `http://127.0.0.1:${String(port)}`, detect: false });
    const failed = await service.search.search({ query: "xeon" }).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    // 래퍼 포트가 없으면 후보는 SearXNG 하나다
    expect(failed).toMatchObject({ data: { code: "unavailable" } });
  });

  test("detection finds a SearXNG on a default candidate address", async () => {
    const hosted = hostedTape("wrapper-basic");
    const resolver = fakeResolver({ localhost: ["127.0.0.1"] });
    const transport = fixtureTransport(
      {
        "http://127.0.0.1:8888/search?q=xeon&format=json&pageno=1": {
          failure: { kind: "network", message: "refused" },
        },
        "http://127.0.0.1:8080/search?q=xeon&format=json&pageno=1": { body: SEARX_JSON },
        "http://127.0.0.1:8080/search?q=xeon&format=json&pageno=1&categories=general": {
          body: SEARX_JSON,
        },
      },
      resolver,
    );
    const { service } = build({ url: "", detect: true }, { hosted, transport });
    const found = await service.search.search({ query: "xeon" });
    expect(found.meta.provider).toBe("searxng");
    expect(found.meta.fallbacks).toEqual([]);
    expect(hosted.requests).toHaveLength(0);
  });

  test("with detection off and no address the wrapper answers", async () => {
    const hosted = hostedTape("wrapper-basic");
    const transport = fixtureTransport({}, fakeResolver());
    const { service } = build({ url: "", detect: false }, { hosted, transport });
    const found = await service.search.search({ query: "xeon" });
    expect(found.meta.provider).toBe("builtin-wrapper");
    expect(found.meta.fallbacks[0]).toMatchObject({ provider: "searxng", reason: "unreachable" });
    expect(transport.requests).toHaveLength(0);
  });
});
