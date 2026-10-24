import { describe, expect, test } from "bun:test";
import {
  createThreadReaderPort,
  MAX_SNAPSHOT_ITEMS,
} from "../../src/state/engine/thread-reader.ts";
import { fakeConnection } from "./fake-connection.ts";
import { STORE, itm, thr, userItem } from "./helpers.ts";

const position = { storeId: STORE, seq: 40 };

describe("thread.read snapshot port", () => {
  test("one page: items and the first page position become the snapshot", async () => {
    const fake = fakeConnection({
      "thread.read": () =>
        Promise.resolve({
          threadId: thr(1),
          items: [userItem(1), userItem(2)],
          position,
          hasMore: false,
        }),
    });
    const port = createThreadReaderPort({ connection: fake.connection, storeId: () => STORE });
    const loaded = await port.load(thr(1));
    expect(loaded.ok && loaded.value.asOfSeq).toBe(40);
    expect(loaded.ok && loaded.value.items.map((i) => i.itemId)).toEqual([itm(1), itm(2)]);
  });

  test("older pages are requested with before = items[0] and put in front; their position is not used", async () => {
    const befores: unknown[] = [];
    const fake = fakeConnection({
      "thread.read": (params) => {
        befores.push(params.before);
        return Promise.resolve(
          params.before === undefined
            ? { threadId: thr(1), items: [userItem(3)], position, hasMore: true }
            : {
                threadId: thr(1),
                items: [userItem(1), userItem(2)],
                position: { storeId: STORE, seq: 99 },
                hasMore: false,
              },
        );
      },
    });
    const port = createThreadReaderPort({ connection: fake.connection, storeId: () => STORE });
    const loaded = await port.load(thr(1));
    expect(befores).toEqual([undefined, itm(3)]);
    expect(loaded.ok && loaded.value.asOfSeq).toBe(40);
    expect(loaded.ok && loaded.value.items.map((i) => i.itemId)).toEqual([itm(1), itm(2), itm(3)]);
  });

  test("stops at MAX_SNAPSHOT_ITEMS even if the host says there is more", async () => {
    let page = 0;
    const fake = fakeConnection({
      "thread.read": () => {
        page += 1;
        const items = Array.from({ length: 200 }, (_, i) => userItem(page * 1000 + i));
        return Promise.resolve({ threadId: thr(1), items, position, hasMore: true });
      },
    });
    const port = createThreadReaderPort({ connection: fake.connection, storeId: () => STORE });
    const loaded = await port.load(thr(1));
    expect(loaded.ok && loaded.value.items.length).toBe(MAX_SNAPSHOT_ITEMS);
    expect(page).toBe(MAX_SNAPSHOT_ITEMS / 200);
  });

  test("a position from another store is unavailable; a failing request is failed", async () => {
    const other = fakeConnection({
      "thread.read": () =>
        Promise.resolve({
          threadId: thr(1),
          items: [],
          position: { storeId: "sto_00000000000000000000000002", seq: 1 },
          hasMore: false,
        }),
    });
    const a = await createThreadReaderPort({
      connection: other.connection,
      storeId: () => STORE,
    }).load(thr(1));
    expect(!a.ok && a.error.kind).toBe("unavailable");
    const broken = fakeConnection({ "thread.read": () => Promise.reject(new Error("x")) });
    const b = await createThreadReaderPort({
      connection: broken.connection,
      storeId: () => STORE,
    }).load(thr(1));
    expect(!b.ok && b.error.kind).toBe("failed");
  });
});
