import { afterEach, describe, expect, test } from "bun:test";
import { WebBrowse, WebFetch, WebResearch, WebSearch } from "@xeon/contracts/capabilities";
import { fakeCatalog, fakeSearchProvider, searchCandidate } from "../src/testing/fake-providers.ts";
import { releaseStores } from "./support/store.ts";
import { makeWebWorld } from "./support/web-world.ts";

// M3-REQ-88·89, ADR-0015 §3.6: readOnly 메서드는 세션 DB 이벤트와 다른 영역의 표에 효과를 남기지 않는다.
// fetch가 남기는 원문 사본(rawRef의 sys_blobs 행)은 다시 받을 수 있는 캐시라 효과로 세지 않는다 [제안]. web에는 멱등 쓰기가 없다. 선언 없는 메서드(browse.open·act·close, research.start·cancel·run)는 replay unsafe다.

afterEach(releaseStores);

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

  test("search and fetch change nothing outside the cap_web tables and the raw blob cache", async () => {
    const world = await makeWebWorld({
      catalog: fakeCatalog([searchCandidate(fakeSearchProvider("searxng"), "detected", "persist")]),
      routes: {
        "https://example.com/a": { headers: { "content-type": "text/plain" }, body: "alpha" },
      },
    });
    const store = world.store;
    if (store === undefined) throw new Error("the world has a store");
    const foreign = (): unknown => {
      const tables = store.root.read((tx) =>
        tx.all(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'cap_web_%' AND name NOT LIKE 'sqlite_%' AND name <> 'sys_blobs' ORDER BY name",
        ),
      );
      if (!tables.ok) throw new Error("the table list is readable");
      return tables.value.map((row) => {
        const name = String(row["name"]);
        const counted = store.root.read((tx) => tx.get(`SELECT count(*) AS n FROM "${name}"`));
        return [name, counted.ok ? counted.value?.["n"] : "unreadable"];
      });
    };
    const before = foreign();
    await world.search({ query: "xeon" });
    await world.fetch({ url: "https://example.com/a" });
    await world.search({ query: "xeon" });
    await world.fetch({ url: "https://example.com/a" });
    expect(foreign()).toEqual(before);
  });
});
