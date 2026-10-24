import { afterEach, describe, expect, test } from "bun:test";
import {
  createFetchCache,
  cacheKeyOf,
  rawRefOf,
  type SaveInput,
} from "../src/cache/fetch-cache.ts";
import { manualClock } from "./support/clock.ts";
import { openWebStore, releaseStores } from "./support/store.ts";

const MINUTE = 60_000;

function saveInput(overrides: Partial<SaveInput> = {}): SaveInput {
  const raw = new TextEncoder().encode("<html><body>hello</body></html>");
  return {
    cacheKey: cacheKeyOf({
      urlNorm: "https://a.example/",
      format: "markdown",
      render: "auto",
      provider: "local",
    }),
    urlNorm: "https://a.example/",
    finalUrl: "https://a.example/",
    provider: "local",
    status: 200,
    contentType: "text/html",
    method: "readability",
    title: "Hello",
    publishedAt: "2026-10-01",
    retention: "persist",
    sessionId: undefined,
    rawBytes: raw,
    text: "# Hello\n\nhello",
    ttlMs: 15 * MINUTE,
    ...overrides,
  };
}

async function setup() {
  const clock = manualClock();
  const store = await openWebStore(clock);
  const cache = createFetchCache({ store: store.service, clock });
  const migrated = cache.migrate();
  expect(migrated.ok).toBe(true);
  return { clock, store, cache };
}

afterEach(releaseStores);

describe("fetch cache on a real sqlite file", () => {
  test("a saved page is found until it expires", async () => {
    const { clock, cache } = await setup();
    const input = saveInput();
    const saved = cache.save(input);
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.value.rawRef).toBe(rawRefOf(input.rawBytes));
    const hit = cache.lookup(input.cacheKey);
    expect(hit.ok && hit.value?.text).toBe("# Hello\n\nhello");
    if (hit.ok && hit.value !== undefined) {
      expect(hit.value.title).toBe("Hello");
      expect(hit.value.publishedAt).toBe("2026-10-01");
      expect(hit.value.status).toBe(200);
      expect(hit.value.expiresAt - hit.value.retrievedAt).toBe(15 * MINUTE);
      expect(hit.value.rawBytes).toBe(input.rawBytes.byteLength);
    }
    clock.advance(16 * MINUTE);
    const expired = cache.lookup(input.cacheKey);
    expect(expired.ok && expired.value).toBeUndefined();
  });

  test("session retention writes only the raw row", async () => {
    const { store, cache } = await setup();
    const input = saveInput({ retention: "session", sessionId: "thr_A" });
    const saved = cache.save(input);
    expect(saved.ok).toBe(true);
    const counts = await store.rowCounts();
    expect(counts["cap_web_raw"]).toBe(1);
    expect(counts["cap_web_fetch_cache"]).toBe(0);
    // 캐시 조회는 못 하고, 같은 세션의 rawRef 재조회만 된다
    expect(cache.lookup(input.cacheKey).ok && cache.lookup(input.cacheKey)).toMatchObject({
      value: undefined,
    });
    const rawRef = rawRefOf(input.rawBytes);
    const same = cache.readRaw(rawRef, "thr_A");
    expect(same.ok && same.value?.text).toBe("# Hello\n\nhello");
    const other = cache.readRaw(rawRef, "thr_B");
    expect(other.ok && other.value).toBeUndefined();
    const none = cache.readRaw(rawRef, undefined);
    expect(none.ok && none.value).toBeUndefined();
  });

  test("persist raw can be read from any session and is never downgraded", async () => {
    const { cache } = await setup();
    const persist = saveInput();
    cache.save(persist);
    // 같은 원문을 session으로 다시 저장해도 persist가 남는다
    cache.save(saveInput({ retention: "session", sessionId: "thr_A" }));
    const read = cache.readRaw(rawRefOf(persist.rawBytes), "thr_other");
    expect(read.ok && read.value?.retention).toBe("persist");
  });

  test("session raw is upgraded when the same bytes are later persisted", async () => {
    const { cache } = await setup();
    const session = saveInput({ retention: "session", sessionId: "thr_A" });
    cache.save(session);
    cache.save(saveInput());
    const read = cache.readRaw(rawRefOf(session.rawBytes), "thr_other");
    expect(read.ok && read.value?.retention).toBe("persist");
  });

  test("an unknown rawRef is not found", async () => {
    const { cache } = await setup();
    const read = cache.readRaw(`webraw:${"0".repeat(64)}`, "thr_A");
    expect(read.ok && read.value).toBeUndefined();
  });

  test("the size cap removes the rows that expire first", async () => {
    const { clock, cache } = await setup();
    const pages = ["a", "b", "c"].map((name, index) =>
      saveInput({
        cacheKey: cacheKeyOf({
          urlNorm: `https://${name}.example/`,
          format: "markdown",
          render: "auto",
          provider: "local",
        }),
        urlNorm: `https://${name}.example/`,
        rawBytes: new TextEncoder().encode(name.repeat(1000)),
        text: name.repeat(1000),
        ttlMs: (index + 1) * MINUTE,
      }),
    );
    for (const page of pages) {
      clock.advance(1000);
      expect(cache.save(page).ok).toBe(true);
    }
    // 페이지마다 원문 1000 + 본문 1000 = 2000바이트. 상한 4500이면 하나를 지운다
    const swept = cache.sweep(4500);
    expect(swept.ok && swept.value.removed).toBe(1);
    const first = cache.lookup(pages[0]?.cacheKey ?? "");
    expect(first.ok && first.value).toBeUndefined();
    const second = cache.lookup(pages[1]?.cacheKey ?? "");
    expect(second.ok && second.value?.urlNorm).toBe("https://b.example/");
    const none = cache.sweep(1_000_000);
    expect(none.ok && none.value.removed).toBe(0);
    const all = cache.sweep(0);
    expect(all.ok && all.value.removed).toBe(2);
  });

  test("raw rows of sessions that no longer exist are purged", async () => {
    const { store, cache } = await setup();
    cache.save(
      saveInput({
        retention: "session",
        sessionId: "thr_live",
        rawBytes: new TextEncoder().encode("live"),
      }),
    );
    cache.save(
      saveInput({
        retention: "session",
        sessionId: "thr_gone",
        rawBytes: new TextEncoder().encode("gone"),
      }),
    );
    cache.save(saveInput());
    const purged = cache.purgeSessionRaw(new Set(["thr_live"]));
    expect(purged.ok && purged.value.removed).toBe(1);
    const counts = await store.rowCounts();
    expect(counts["cap_web_raw"]).toBe(2);
  });

  test("migrations are idempotent", async () => {
    const { store, cache } = await setup();
    const again = cache.migrate();
    expect(again.ok).toBe(true);
    const counts = await store.rowCounts();
    expect(counts["cap_web_usage"]).toBe(0);
  });
});
