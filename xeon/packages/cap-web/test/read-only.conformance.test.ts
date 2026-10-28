import { afterEach, describe, expect, test } from "bun:test";
import { WebBrowse, WebFetch, WebResearch, WebSearch } from "@xeon/contracts/capabilities";
import { fakeCatalog, fakeSearchProvider, searchCandidate } from "../src/testing/fake-providers.ts";
import { releaseStores } from "./support/store.ts";
import { makeWebWorld } from "./support/web-world.ts";

// M3-REQ-88·89, ADR-0015 §3.6: readOnly 메서드는 세션 DB 이벤트와 다른 영역의 표에 효과를 남기지 않는다.
// readOnly는 파생 데이터(캐시, 계량, 내용 주소 blob)를 쓸 수 있다(ADR-0015 3.3). web에는 멱등 쓰기가 없다. 선언 없는 메서드(browse.open·act·close, research.start·cancel·run)는 replay unsafe다.

afterEach(releaseStores);

/**
 * search와 fetch가 쓰는 파생 표(ADR-0015 3.3). `cap_web_fetch_cache`·`cap_web_raw`는 응답 캐시, `sys_blobs`는 원문 사본(내용 주소 blob),
 * `cap_web_usage`는 비용 계량이다. 세션당 fetch 상한 카운터(`session_limit`)는 메모리 계량이라 표에 없다.
 * 사용자 데이터나 대화 기록 표는 없다. 새 표에 쓰면 이 목록에 없어 시험이 실패한다
 */
const DERIVED_TABLES_WRITTEN: string[] = [
  "cap_web_fetch_cache",
  "cap_web_raw",
  "cap_web_usage",
  "sys_blobs",
];

function declared(
  def: typeof WebSearch | typeof WebFetch | typeof WebBrowse | typeof WebResearch,
): readonly string[] {
  return Object.entries(def.service.methods).map(([name, method]) => {
    const effect =
      method.readOnly === true ? "readOnly" : method.idempotent === true ? "idempotent" : "none";
    return `${def.id}.${name} ${effect} ${method.replay ?? "unsafe"}`;
  });
}

describe("web readOnly conformance", () => {
  test("the declared classes are the reads and the undeclared writes", () => {
    expect([WebSearch, WebFetch, WebBrowse, WebResearch].flatMap((def) => declared(def))).toEqual([
      "web.search.search readOnly safe",
      "web.fetch.fetch readOnly safe",
      "web.browse.open none unsafe",
      "web.browse.act none unsafe",
      "web.browse.read readOnly safe",
      "web.browse.close none unsafe",
      "web.research.start none unsafe",
      "web.research.get readOnly safe",
      "web.research.cancel none unsafe",
      "web.research.run none unsafe",
    ]);
  });

  test("search and fetch write only the derived tables listed here", async () => {
    const world = await makeWebWorld({
      catalog: fakeCatalog([searchCandidate(fakeSearchProvider("searxng"), "detected", "persist")]),
      routes: {
        "https://example.com/a": { headers: { "content-type": "text/plain" }, body: "alpha" },
      },
    });
    const store = world.store;
    if (store === undefined) throw new Error("the world has a store");
    const before = await store.rowDigests();
    await world.search({ query: "xeon" });
    await world.fetch({ url: "https://example.com/a" });
    await world.search({ query: "xeon" });
    await world.fetch({ url: "https://example.com/a" });
    const after = await store.rowDigests();
    const changed = Object.keys(after)
      .filter((name) => after[name] !== before[name])
      .toSorted();
    // 파생 데이터만 바뀐다(ADR-0015 3.3의 readOnly 정의): 응답 캐시, 원문 사본(내용 주소 blob), 세션당 fetch 계량.
    // 새 표에 쓰면 이 목록에 없어 시험이 실패한다
    expect(changed).toEqual(DERIVED_TABLES_WRITTEN);
  });
});
