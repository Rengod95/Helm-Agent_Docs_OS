import { describe, expect, test } from "bun:test";
import type { ItemRecord, LeafMask, PartMask } from "@fresnel/contracts/conversation";
import type { EventWire } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import type { VolatileFact } from "../../src/state/engine/input.ts";
import { decodeDurable } from "../../src/state/engine/decode.ts";
import { selectPartText } from "../../src/state/engine/selectors.ts";
import { createThreadReaderPort } from "../../src/state/engine/thread-reader.ts";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import { createUiStore } from "../../src/state/ui/store.ts";
import { Providers } from "../../src/views/providers.tsx";
import { RecordedItem } from "../../src/views/item-view.tsx";
import { fakeConnection } from "../state/fake-connection.ts";
import { STORE, SUB, evt, itm, openedHarness, prt, thr, userItem } from "../state/helpers.ts";
import { fakeCommands } from "./fake-commands.ts";

// L0.secrets.spec §3.5.1, L4.desktop-ux 화면 가림 [결정: 2026-11-03 사용자].
// 호스트가 준 표식(구간)을 화면이 같은 문자열에 적용한다. 원문은 거울에 들어가지 않고, 화면과 화면에서 복사되는 글에는 값이 없다.
// 이 시험의 표식은 손으로 쓴 것이다. 호스트가 실제로 만든 표식은 apps/host 시험이 확인한다.

const SECRET = "maskprobe-value-one";
const LABEL = "known:display-token";
const MARKER = `[REDACTED:${LABEL}]`;
const CREATED = "2026-10-24T00:00:00.000Z";

function itemRecordedWire(seq: number, item: ItemRecord, mask?: LeafMask[]): EventWire {
  return {
    id: evt(seq),
    kind: "item.recorded",
    version: 1,
    durable: true,
    seq,
    parentId: null,
    threadId: thr(1),
    turnId: null,
    stepId: null,
    recordedAt: CREATED,
    causationId: null,
    correlationId: null,
    payload: { item },
    redactions: [],
    ...(mask === undefined ? {} : { mask }),
  };
}

function partChunk(
  n: number,
  phase: "start" | "delta" | "end",
  text: string,
  mask?: PartMask,
): VolatileFact {
  return {
    type: "item.updated",
    n,
    threadId: thr(1),
    turnId: null,
    payload: {
      itemId: itm(7),
      update: {
        kind: "part_delta",
        delta: {
          partId: prt(70),
          itemId: itm(7),
          contentIndex: 0,
          kind: "text",
          phase,
          delta: text,
          ...(mask === undefined ? {} : { mask }),
        },
      },
    },
  };
}

/** 서버 렌더는 getInitialState를 읽는다. 초기 상태가 곧 그 상태인 읽기 전용 스토어 */
function frozen<T>(state: T): ReadonlyStore<T> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

describe("recorded items from the wire", () => {
  test("the host mask is applied to a copy; the event payload object is not changed", () => {
    const text = `use ${SECRET} now`;
    const item = userItem(1, text);
    const mask: LeafMask[] = [
      {
        pointer: "/message/content",
        len: text.length,
        ranges: [{ start: 4, end: 4 + SECRET.length, label: LABEL }],
      },
    ];
    const wire = itemRecordedWire(3, item, mask);
    const payloadBefore = JSON.stringify(wire.payload);

    const fact = decodeDurable(wire);
    expect(fact).toMatchObject({
      type: "item.recorded",
      item: { message: { content: `use ${MARKER} now` } },
    });
    expect(JSON.stringify(wire.payload)).toBe(payloadBefore);
    expect(JSON.stringify(fact)).not.toContain(SECRET);
  });

  test("a record without a mask field is shown as it is", () => {
    const item = userItem(2, "plain");
    expect(decodeDurable(itemRecordedWire(4, item))).toMatchObject({
      type: "item.recorded",
      item: { message: { content: "plain" } },
    });
  });

  test("a mask that does not fit the record makes the fact unreadable, not raw", () => {
    const item = userItem(3, SECRET);
    const wire = itemRecordedWire(5, item, [{ pointer: "/message", len: 0, ranges: [] }]);
    expect(decodeDurable(wire)).toMatchObject({ type: "unreadable" });
  });
});

describe("streamed parts", () => {
  test("the visible prefix is masked and the held tail is not shown", () => {
    const h = openedHarness();
    const first = "the key is maskprobe-value-one";
    h.store.ingest({
      type: "chunk",
      fact: partChunk(0, "delta", first, {
        verified: true,
        len: first.length,
        visible: 11,
        ranges: [],
      }),
    });
    h.store.flush();
    expect(selectPartText(h.store.read.getState(), itm(7), 0)).toBe("the key is ");

    const full = `${first} and more `;
    h.store.ingest({
      type: "chunk",
      fact: partChunk(1, "delta", full.slice(first.length), {
        verified: true,
        len: full.length,
        visible: full.length,
        ranges: [{ start: 11, end: 11 + SECRET.length, label: LABEL }],
      }),
    });
    h.store.flush();
    const shown = selectPartText(h.store.read.getState(), itm(7), 0);
    expect(shown).toBe(`the key is ${MARKER} and more `);
    expect(shown).not.toContain(SECRET);
  });

  test("a length mismatch (a dropped chunk) hides the part until the record arrives", () => {
    const h = openedHarness();
    h.store.ingest({
      type: "chunk",
      fact: partChunk(0, "delta", "short", { verified: true, len: 99, visible: 5, ranges: [] }),
    });
    h.store.flush();
    expect(selectPartText(h.store.read.getState(), itm(7), 0)).toBe("");
  });

  test("an unverified part is hidden", () => {
    const h = openedHarness();
    h.store.ingest({ type: "chunk", fact: partChunk(0, "delta", "anything", { verified: false }) });
    h.store.flush();
    expect(selectPartText(h.store.read.getState(), itm(7), 0)).toBe("");
  });
});

describe("thread.read snapshot", () => {
  test("items get their masks; an item whose mask does not fit is left out of the transcript", async () => {
    const fake = fakeConnection({
      "thread.read": () =>
        Promise.resolve({
          threadId: thr(1),
          items: [userItem(1, `use ${SECRET}`), userItem(2, "bad")],
          position: { storeId: STORE, seq: 40 },
          hasMore: false,
          masks: [
            {
              itemId: itm(1),
              leaves: [
                {
                  pointer: "/message/content",
                  len: `use ${SECRET}`.length,
                  ranges: [{ start: 4, end: 4 + SECRET.length, label: LABEL }],
                },
              ],
            },
            { itemId: itm(2), leaves: [{ pointer: "/message", len: 0, ranges: [] }] },
          ],
        }),
    });
    const port = createThreadReaderPort({ connection: fake.connection, storeId: () => STORE });
    const loaded = await port.load(thr(1));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.items).toEqual([userItem(1, `use ${MARKER}`)]);
  });
});

describe("the rendered transcript row", () => {
  test("a masked record renders without the value, so a copy of the row has no value either", () => {
    const h = openedHarness();
    const text = `use ${SECRET} now`;
    const fact = decodeDurable(
      itemRecordedWire(6, userItem(9, text), [
        {
          pointer: "/message/content",
          len: text.length,
          ranges: [{ start: 4, end: 4 + SECRET.length, label: LABEL }],
        },
      ]),
    );
    h.store.ingest({ type: "batch", sub: SUB, from: 5, to: 6, caughtUp: true, facts: [fact] });
    h.store.flush();
    const ui = createUiStore();
    const html = renderToString(
      <Providers engine={frozen(h.store.read.getState())} ui={ui.read} commands={fakeCommands()}>
        <RecordedItem id={itm(9)} />
      </Providers>,
    );
    expect(html).toContain(MARKER);
    expect(html).not.toContain(SECRET);
  });
});
