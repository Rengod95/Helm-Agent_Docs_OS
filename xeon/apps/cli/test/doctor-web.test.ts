import { afterEach, expect, test } from "bun:test";
import { wireError } from "@xeon/contracts/wire";
import { EXIT } from "../src/exit-codes.ts";
import type { FakeHandlers } from "./support/fake-server.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { def, fakeSettings } from "./support/m2.ts";
import {
  BUILTIN_FETCH,
  DEFAULT_RESULT,
  EXA_NO_KEY,
  PLAYWRIGHT,
  providerOf,
  resultOf,
  WRAPPER,
} from "./support/web-providers.ts";

// X9(M3-12, M3-REQ-96): `xeon doctor`의 "검색 provider"와 "웹 provider" 블록이 `web.providers`의 view-model 값을 그대로 옮기는지 본다.
// 블록 전체를 줄 단위 값으로 비교한다. 상세 문구(detail)와 비밀 값은 출력에 없어야 한다.

const harnesses: Harness[] = [];
afterEach(() => {
  for (const h of harnesses.splice(0)) h.dispose();
});

const SEARCH_DEFS = [
  def("l2.web.search.searxng.url", { default: "", layer: "L2" }),
  def("l0.process.service.enabled", { type: { type: "boolean" }, default: false, layer: "L0" }),
];

/** 가짜 엔진 위의 doctor. `web`은 가짜 엔진의 메서드 처리기다. 빈 객체면 엔진이 `web.providers`를 모른다 */
function harness(web: FakeHandlers): Harness {
  const settings = fakeSettings(SEARCH_DEFS);
  const h = createHarness({
    env: { NO_COLOR: "1", LANG: "ko_KR.UTF-8" },
    server: {
      handlers: { ...settings.handlers, "secret.list": () => ({ secrets: [] }), ...web },
    },
  });
  harnesses.push(h);
  return h;
}

/** 출력의 `검색 provider` 블록 줄들. 블록은 출력의 끝까지다 */
function blockOf(text: string): string[] {
  return text.slice(text.indexOf("검색 provider\n")).trimEnd().split("\n");
}

const SEARXNG_UNSET =
  "  SearXNG: 주소를 설정하지 않았다 (자동 감지는 하지 않는다) — 쓰려면: xeon config set l2.web.search.searxng.url <주소>";

test("(a) default: the builtin wrapper is current, Exa needs a key and Brave is not installed", async () => {
  const h = harness({ "web.providers": () => DEFAULT_RESULT });
  expect(await h.run(["doctor"])).toBe(EXIT.ok);
  expect(blockOf(h.stdoutText())).toEqual([
    "검색 provider",
    "  검색 provider: auto → Built-in search (model provider) (builtin-wrapper)",
    SEARXNG_UNSET,
    "  권장 키 플러그인: Exa(키 필요 — xeon secret add exa-api-key), Brave(설치 필요 — 플러그인을 설치한다)",
    "웹 provider",
    "  [ok]   builtin-wrapper  내장 · 검색 · 순위 1 · 현재 · 사용할 수 있다",
    "  [경고] plugin:web-exa  플러그인 · 검색 · 순위 2 · 키가 없다 — 해결: xeon secret add exa-api-key · 첫 사용 고지 대기",
    "  [ok]   playwright-mcp  플러그인 · 브라우저 · 순위 1 · 현재 · 사용할 수 있다",
    "  [ok]   builtin-fetch  내장 · 가져오기 · 순위 없음 · 사용할 수 있다",
  ]);
});

const EXA_READY = providerOf("plugin:web-exa", "web.search", {
  origin: "plugin",
  displayName: "Exa",
  auth: "header",
  pricingAsOf: "2026-10-01",
  pricingStale: true,
  firstUseNoticed: true,
  autoRank: 0,
});

const BRAVE_READY = providerOf("plugin:web-brave", "web.search", {
  origin: "plugin",
  displayName: "Brave",
  auth: "header",
  firstUseNoticed: false,
  autoRank: 1,
});

test("(b) Exa and Brave both ready, the user order puts Exa first: auto goes to Exa and both are said ready", async () => {
  const h = harness({
    "web.providers": () =>
      resultOf(
        [
          EXA_READY,
          BRAVE_READY,
          providerOf("builtin-wrapper", "web.search", {
            displayName: "Built-in search (model provider)",
            autoRank: 2,
          }),
        ],
        { searchOrder: ["plugin:web-exa", "plugin:web-brave", "builtin-wrapper"] },
      ),
  });
  expect(await h.run(["doctor"])).toBe(EXIT.ok);
  expect(blockOf(h.stdoutText())).toEqual([
    "검색 provider",
    "  검색 provider: auto → Exa (plugin:web-exa)",
    SEARXNG_UNSET,
    "  키 플러그인: Exa, Brave 모두 쓸 수 있다",
    "웹 provider",
    "  [ok]   plugin:web-exa  플러그인 · 검색 · 순위 1 · 현재 · 사용할 수 있다 · 가격표 오래됨(2026-10-01)",
    "  [ok]   plugin:web-brave  플러그인 · 검색 · 순위 2 · 사용할 수 있다 · 첫 사용 고지 대기",
    "  [ok]   builtin-wrapper  내장 · 검색 · 순위 3 · 사용할 수 있다",
  ]);
});

test("(c) an engine without web.providers: the search lines say unknown, the defaults note appears, no web block", async () => {
  const h = harness({});
  expect(await h.run(["doctor"])).toBe(EXIT.ok);
  expect(h.methods()).not.toContain("web.providers");
  expect(blockOf(h.stdoutText())).toEqual([
    "검색 provider",
    "  검색 provider: 알 수 없다 (엔진에서 provider 목록을 읽지 못했다)",
    SEARXNG_UNSET,
    "  키 플러그인: 알 수 없다 (엔진에서 provider 목록을 읽지 못했다)",
    "  (엔진에서 검색 설정을 읽지 못해 기본 설정으로 판정했다)",
  ]);
});

test("(c) a web.providers request that fails gives the same unknown lines", async () => {
  const h = harness({
    "web.providers": () => {
      throw wireError("internal");
    },
  });
  expect(await h.run(["doctor"])).toBe(EXIT.ok);
  expect(h.methods()).toContain("web.providers");
  expect(blockOf(h.stdoutText())).toEqual([
    "검색 provider",
    "  검색 provider: 알 수 없다 (엔진에서 provider 목록을 읽지 못했다)",
    SEARXNG_UNSET,
    "  키 플러그인: 알 수 없다 (엔진에서 provider 목록을 읽지 못했다)",
    "  (엔진에서 검색 설정을 읽지 못해 기본 설정으로 판정했다)",
  ]);
});

test("--json carries the view-model as web next to search, with the rows and recommendation states by value", async () => {
  const h = harness({ "web.providers": () => DEFAULT_RESULT });
  expect(await h.run(["doctor", "--json"])).toBe(EXIT.ok);
  const doc: unknown = JSON.parse(h.stdoutText());
  expect(doc).toMatchObject({
    search: { assumedDefaults: false },
    web: {
      search: {
        provider: "auto",
        rows: [
          { id: "builtin-wrapper", rank: 0, current: true, ok: true },
          { id: "plugin:web-exa", rank: 1, current: false, ok: false, noticePending: true },
        ],
      },
      browse: { rows: [{ id: "playwright-mcp", rank: 0, current: true, ok: true }] },
      fetch: { rows: [{ id: "builtin-fetch", rank: null, current: false, ok: true }] },
      recommendations: [
        {
          label: "Exa",
          providerId: "plugin:web-exa",
          secretName: "exa-api-key",
          state: "needs-key",
          hint: "xeon secret add exa-api-key",
        },
        {
          label: "Brave",
          providerId: "plugin:web-brave",
          secretName: "brave-api-key",
          state: "not-installed",
          hint: "플러그인을 설치한다",
        },
      ],
    },
  });
});

test("--json has web null when the engine has no web view", async () => {
  const h = harness({});
  expect(await h.run(["doctor", "--json"])).toBe(EXIT.ok);
  const doc: unknown = JSON.parse(h.stdoutText());
  expect(doc).toMatchObject({ web: null, search: { assumedDefaults: true } });
});

test("the detail text of a provider is never printed (only the short note is)", async () => {
  const detail = "x".repeat(300);
  const h = harness({
    "web.providers": () =>
      resultOf([
        WRAPPER,
        providerOf("playwright-mcp", "web.browse", {
          origin: "plugin",
          displayName: "Playwright MCP",
          status: { kind: "unavailable", reason: "unreachable", detail },
          autoRank: 0,
        }),
      ]),
  });
  expect(await h.run(["doctor"])).toBe(EXIT.ok);
  const text = h.stdoutText();
  expect(text).toContain("  [경고] playwright-mcp  플러그인 · 브라우저 · 순위 1 · 응답이 없다");
  expect(text).not.toContain("x".repeat(10));
});

test("a fixed provider that cannot be used says why on the search line and marks the row pinned", async () => {
  const h = harness({
    "web.providers": () => resultOf([WRAPPER, EXA_NO_KEY], { searchProvider: "plugin:web-exa" }),
  });
  expect(await h.run(["doctor"])).toBe(EXIT.ok);
  const lines = blockOf(h.stdoutText());
  expect(lines[1]).toBe(
    "  검색 provider: plugin:web-exa (l2.web.search.provider로 고정) — 키가 없다 — 해결: xeon secret add exa-api-key",
  );
  expect(lines).toContain(
    "  [경고] plugin:web-exa  플러그인 · 검색 · 순위 2 · 현재 · 고정 · 키가 없다 — 해결: xeon secret add exa-api-key · 첫 사용 고지 대기",
  );
});

test("a fixed provider that is not in the list is said to be unknown", async () => {
  const h = harness({
    "web.providers": () => resultOf([WRAPPER], { searchProvider: "web-nope" }),
  });
  expect(await h.run(["doctor"])).toBe(EXIT.ok);
  expect(blockOf(h.stdoutText())[1]).toBe(
    "  검색 provider: web-nope (l2.web.search.provider로 고정) — 목록에 없는 provider다",
  );
});

test("auto with no usable search provider says so, and the recommendation lists both key plugins", async () => {
  const h = harness({ "web.providers": () => resultOf([EXA_NO_KEY]) });
  expect(await h.run(["doctor"])).toBe(EXIT.ok);
  const lines = blockOf(h.stdoutText());
  expect(lines[1]).toBe("  검색 provider: auto → 쓸 수 있는 provider가 없다");
  expect(lines[3]).toBe(
    "  권장 키 플러그인: Exa(키 필요 — xeon secret add exa-api-key), Brave(설치 필요 — 플러그인을 설치한다)",
  );
});

test("a key plugin that is installed but unusable is recommended as unavailable with its reason", async () => {
  const h = harness({
    "web.providers": () =>
      resultOf([
        EXA_READY,
        providerOf("plugin:web-brave", "web.search", {
          origin: "plugin",
          displayName: "Brave",
          status: { kind: "unavailable", reason: "unreachable" },
          autoRank: 1,
        }),
      ]),
  });
  expect(await h.run(["doctor"])).toBe(EXIT.ok);
  expect(blockOf(h.stdoutText())[3]).toBe("  권장 키 플러그인: Brave(사용 불가 — unreachable)");
});

test("an empty provider list prints the search lines as no usable provider and a placeholder web block", async () => {
  const h = harness({ "web.providers": () => resultOf([]) });
  expect(await h.run(["doctor"])).toBe(EXIT.ok);
  expect(blockOf(h.stdoutText())).toEqual([
    "검색 provider",
    "  검색 provider: auto → 쓸 수 있는 provider가 없다",
    SEARXNG_UNSET,
    "  권장 키 플러그인: Exa(설치 필요 — 플러그인을 설치한다), Brave(설치 필요 — 플러그인을 설치한다)",
    "웹 provider",
    "  provider가 없다",
  ]);
});

test("the browse and fetch rows keep their own sections after the search rows", async () => {
  const h = harness({
    "web.providers": () => resultOf([WRAPPER, PLAYWRIGHT, BUILTIN_FETCH]),
  });
  expect(await h.run(["doctor"])).toBe(EXIT.ok);
  const lines = blockOf(h.stdoutText());
  expect(lines.slice(4)).toEqual([
    "웹 provider",
    "  [ok]   builtin-wrapper  내장 · 검색 · 순위 1 · 현재 · 사용할 수 있다",
    "  [ok]   playwright-mcp  플러그인 · 브라우저 · 순위 1 · 현재 · 사용할 수 있다",
    "  [ok]   builtin-fetch  내장 · 가져오기 · 순위 없음 · 사용할 수 있다",
  ]);
});
