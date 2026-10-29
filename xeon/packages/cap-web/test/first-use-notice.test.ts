import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { err, type Logger } from "@xeon/contracts";
import type { CallOptions, WebProviderManifest } from "@xeon/contracts/capabilities";
import type { MigrationSet, StoreReadError, StoreWriteError } from "@xeon/contracts/records";
import { createFetchCache } from "../src/cache/fetch-cache.ts";
import { CAP_WEB_MIGRATIONS, WEB_STORE_OWNER } from "../src/cache/migrations.ts";
import { createFirstUseNotices } from "../src/cache/notices.ts";
import { browseCandidate, fakeBrowseProvider } from "../src/testing/fake-browser.ts";
import {
  fakeCatalog,
  fakeFetchProvider,
  fakeManifest,
  fakeSearchProvider,
  fetchCandidate,
  searchCandidate,
} from "../src/testing/fake-providers.ts";
import { manualClock } from "./support/clock.ts";
import { threadIdOf } from "./support/ids.ts";
import { openWebStore, releaseStores } from "./support/store.ts";
import { makeWebWorld } from "./support/web-world.ts";

// 키 플러그인 첫 사용 고지(L2.web.spec §4.8.2, §4.9.1, §4.10). 호출 경고 `first_use_notice:<id>`는 provider마다 한 번이고,
// 기록은 `cap_web_notices`에 남아 재시작 뒤에도 유지된다.

afterEach(releaseStores);

const SPA = new Uint8Array(readFileSync(new URL("./fixtures/html/spa.html", import.meta.url)));
const HTML = { "content-type": "text/html; charset=utf-8" };

/** 인증 방식이 헤더 비밀인 플러그인 매니페스트 */
function keyed(name: string, services: WebProviderManifest["services"]): WebProviderManifest {
  return fakeManifest(name, {
    services,
    auth: { kind: "header", secrets: [{ setting: `ext.${name}.apiKey`, header: "x-api-key" }] },
  });
}

function notices(warnings: readonly string[]): string[] {
  return warnings.filter((warning) => warning.startsWith("first_use_notice:"));
}

/** 기록만 남기는 로거. 경고 이벤트 이름을 모은다 */
function logsTo(events: string[]): Logger {
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (event) => {
      events.push(event);
    },
    error: (event) => {
      events.push(event);
    },
    child: () => logger,
  };
  return logger;
}

const HOST: CallOptions = {
  requestId: "req-host",
  context: { threadId: threadIdOf(1), caller: { kind: "host" } },
};

describe("first use notice", () => {
  test("the first search through a key plugin carries the notice once, later calls do not", async () => {
    const key = fakeSearchProvider("plugin:web-key", { manifest: keyed("web-key", ["search"]) });
    const world = await makeWebWorld({
      catalog: fakeCatalog([searchCandidate(key, "plugin")]),
    });
    const first = await world.search({ query: "xeon notice" });
    expect(notices(first.meta.warnings)).toEqual(["first_use_notice:plugin:web-key"]);
    const second = await world.search({ query: "xeon again" });
    expect(notices(second.meta.warnings)).toEqual([]);
    // 같은 질의는 메모에서 나온다. 메모 호출에는 고지가 붙지 않는다
    const third = await world.search({ query: "xeon notice" });
    expect(third.meta.cache).toBe("hit");
    expect(notices(third.meta.warnings)).toEqual([]);
    expect(key.searches.length).toBe(2);
  });

  test("a keyless plugin and a builtin provider never carry the notice", async () => {
    const keyless = fakeSearchProvider("plugin:web-free", {
      manifest: fakeManifest("web-free", { services: ["search"] }),
    });
    const keylessWorld = await makeWebWorld({
      catalog: fakeCatalog([searchCandidate(keyless, "plugin")]),
    });
    const freeOut = await keylessWorld.search({ query: "free plugin" });
    expect(freeOut.meta.provider).toBe("plugin:web-free");
    expect(notices(freeOut.meta.warnings)).toEqual([]);

    // 내장 provider는 인증 방식과 무관하게 고지 대상이 아니다(출처 규칙)
    const builtin = fakeSearchProvider("builtin-wrapper", {
      manifest: keyed("builtin-wrapper", ["search"]),
    });
    const builtinWorld = await makeWebWorld({
      catalog: fakeCatalog([searchCandidate(builtin, "builtin")]),
    });
    const builtinOut = await builtinWorld.search({ query: "builtin" });
    expect(builtinOut.meta.provider).toBe("builtin-wrapper");
    expect(notices(builtinOut.meta.warnings)).toEqual([]);
  });

  test("two key plugins in a fan-out each carry the notice once", async () => {
    const a = fakeSearchProvider("plugin:web-a", { manifest: keyed("web-a", ["search"]) });
    const b = fakeSearchProvider("plugin:web-b", { manifest: keyed("web-b", ["search"]) });
    const world = await makeWebWorld({
      settings: { search: { parallel: 2, order: ["plugin:web-a", "plugin:web-b"] } },
      catalog: fakeCatalog([searchCandidate(a, "plugin"), searchCandidate(b, "plugin")]),
    });
    const first = await world.search({ query: "fan notice" });
    expect(first.meta.warnings).toContain("fanout:plugin:web-a,plugin:web-b");
    expect(notices(first.meta.warnings)).toEqual([
      "first_use_notice:plugin:web-a",
      "first_use_notice:plugin:web-b",
    ]);
    const second = await world.search({ query: "fan again" });
    expect(notices(second.meta.warnings)).toEqual([]);
  });

  test("the record survives a restart on the same store", async () => {
    const key = fakeSearchProvider("plugin:web-key", { manifest: keyed("web-key", ["search"]) });
    const before = await makeWebWorld({ catalog: fakeCatalog([searchCandidate(key, "plugin")]) });
    const first = await before.search({ query: "before restart" });
    expect(notices(first.meta.warnings)).toEqual(["first_use_notice:plugin:web-key"]);

    const after = await makeWebWorld({
      store: before.store,
      catalog: fakeCatalog([searchCandidate(key, "plugin")]),
    });
    const second = await after.search({ query: "after restart" });
    expect(second.meta.provider).toBe("plugin:web-key");
    expect(notices(second.meta.warnings)).toEqual([]);
  });

  test("a fetch promotion through a key plugin carries the notice on the first use", async () => {
    const provider = fakeFetchProvider("plugin:web-fetch-key", {
      manifest: fakeManifest("web-fetch-key", {
        services: ["fetch"],
        auth: { kind: "query", secrets: [{ setting: "ext.web-fetch-key.apiKey", query: "key" }] },
      }),
    });
    const world = await makeWebWorld({
      routes: {
        "https://example.com/app": { headers: HTML, body: SPA },
        "https://example.com/other": { headers: HTML, body: SPA },
      },
      catalog: fakeCatalog([], [fetchCandidate(provider, "plugin", "session")]),
    });
    const first = await world.fetch({ url: "https://example.com/app" });
    expect(first.pages[0]?.method).toBe("provider:plugin:web-fetch-key");
    expect(notices(first.meta.warnings)).toEqual(["first_use_notice:plugin:web-fetch-key"]);
    const second = await world.fetch({ url: "https://example.com/other" });
    expect(second.pages[0]?.method).toBe("provider:plugin:web-fetch-key");
    expect(notices(second.meta.warnings)).toEqual([]);
  });

  test("a browser opened through a key plugin carries the notice on the first open", async () => {
    const provider = fakeBrowseProvider("plugin:web-browse-key", {
      manifest: fakeManifest("web-browse-key", {
        services: ["browse"],
        auth: { kind: "bearer", secrets: [{ setting: "ext.web-browse-key.apiKey" }] },
      }),
    });
    const world = await makeWebWorld({
      catalog: fakeCatalog([], [], [browseCandidate(provider, "plugin")]),
    });
    const first = await world.browse.open({}, HOST);
    expect(first.meta.provider).toBe("plugin:web-browse-key");
    expect(notices(first.meta.warnings)).toEqual(["first_use_notice:plugin:web-browse-key"]);
    const second = await world.browse.open({}, HOST);
    expect(notices(second.meta.warnings)).toEqual([]);
  });
});

describe("first use notice records", () => {
  test("the store-backed record takes each provider once and reads it back in a new instance", async () => {
    const clock = manualClock();
    const store = await openWebStore(clock);
    expect(createFetchCache({ store: store.service, clock }).migrate().ok).toBe(true);
    const events: string[] = [];
    const first = createFirstUseNotices({ store: store.service, clock, logger: logsTo(events) });
    expect(first.has("plugin:web-key")).toBe(false);
    expect(first.take("plugin:web-key")).toBe(true);
    expect(first.take("plugin:web-key")).toBe(false);
    expect(first.has("plugin:web-key")).toBe(true);

    // 새 인스턴스(재시작)는 저장된 기록을 읽는다
    const restarted = createFirstUseNotices({
      store: store.service,
      clock,
      logger: logsTo(events),
    });
    expect(restarted.has("plugin:web-key")).toBe(true);
    expect(restarted.take("plugin:web-key")).toBe(false);
    expect(restarted.take("plugin:web-other")).toBe(true);
    expect(events).toEqual([]);

    const rows = store.service
      .scoped(WEB_STORE_OWNER)
      .read((tx) => tx.all("SELECT provider, noticed_at FROM cap_web_notices ORDER BY provider"));
    expect(rows.ok && rows.value.map((row) => [row.provider, row.noticed_at])).toEqual([
      ["plugin:web-key", clock.now()],
      ["plugin:web-other", clock.now()],
    ]);
  });

  test("a failing table write logs once and the process keeps the record in memory", () => {
    const events: string[] = [];
    const busyWrite: StoreWriteError = { kind: "busy" };
    const busyRead: StoreReadError = { kind: "busy" };
    const failing = {
      scoped: () => ({
        write: () => err(busyWrite),
        read: () => err(busyRead),
      }),
    };
    const notices = createFirstUseNotices({
      store: failing,
      clock: manualClock(),
      logger: logsTo(events),
    });
    expect(notices.take("plugin:web-key")).toBe(true);
    expect(notices.take("plugin:web-key")).toBe(false);
    expect(notices.take("plugin:web-other")).toBe(true);
    expect(notices.has("plugin:web-other")).toBe(true);
    expect(notices.has("plugin:web-unknown")).toBe(false);
    expect(events).toEqual(["web.notice_write_failed"]);
  });

  test("migration 2 adds cap_web_notices and keeps the version 1 rows", async () => {
    const clock = manualClock();
    const store = await openWebStore(clock);
    const v1: MigrationSet = {
      owner: WEB_STORE_OWNER,
      version: 1,
      steps: CAP_WEB_MIGRATIONS.steps.slice(0, 1),
    };
    expect(store.service.migrations.apply(v1).ok).toBe(true);
    const written = store.service
      .scoped(WEB_STORE_OWNER)
      .write((tx) =>
        tx.run(
          "INSERT INTO cap_web_usage (provider, month, unit, count, usd) VALUES (?, ?, ?, ?, ?)",
          ["plugin:web-x", "2026-10", "search", 3, 0.25],
        ),
      );
    expect(written.ok).toBe(true);

    const migrated = createFetchCache({ store: store.service, clock }).migrate();
    expect(migrated.ok && migrated.value).toEqual({ owner: WEB_STORE_OWNER, from: 1, to: 2 });
    const counts = await store.rowCounts();
    expect(counts["cap_web_notices"]).toBe(0);
    const usage = store.service
      .scoped(WEB_STORE_OWNER)
      .read((tx) => tx.all("SELECT provider, unit, count, usd FROM cap_web_usage"));
    expect(
      usage.ok && usage.value.map((row) => [row.provider, row.unit, row.count, row.usd]),
    ).toEqual([["plugin:web-x", "search", 3, 0.25]]);
    // 새 표는 바로 쓸 수 있다
    const notices = createFirstUseNotices({ store: store.service, clock, logger: logsTo([]) });
    expect(notices.take("plugin:web-key")).toBe(true);
    // 두 번째 적용은 아무것도 바꾸지 않는다
    expect(createFetchCache({ store: store.service, clock }).migrate().ok).toBe(true);
    expect((await store.rowCounts())["cap_web_notices"]).toBe(1);
  });
});
