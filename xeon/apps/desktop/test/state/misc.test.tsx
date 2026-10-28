import { describe, expect, test } from "bun:test";
import { Bug, type Scheduler } from "@xeon/contracts";
import { renderToString } from "react-dom/server";
import { decodeDurable, decodeVolatile } from "../../src/state/engine/decode.ts";
import { SETTLED_CAP, type EngineMirror } from "../../src/state/engine/state.ts";
import { checkMirror } from "../../src/state/engine/invariants.ts";
import { createFrameClock } from "../../src/state/shared/frame.ts";
import { createUiStore } from "../../src/state/ui/store.ts";
import type { Commands } from "../../src/views/commands.ts";
import { fakeCommands } from "../views/fake-commands.ts";
import { Providers } from "../../src/views/providers.tsx";
import { StatusBar } from "../../src/views/status-bar.tsx";
import { Transcript } from "../../src/views/transcript.tsx";
import { SUB, delta, evt, itm, openedHarness, recorded, thr, trn, userItem } from "./helpers.ts";

function fakes() {
  let rafCb: (() => void) | undefined;
  let timerCb: (() => void) | undefined;
  const cancelled = { raf: 0, timer: 0 };
  const frames = {
    requestAnimationFrame: (cb: () => void): number => {
      rafCb = cb;
      return 1;
    },
    cancelAnimationFrame: (): void => void (cancelled.raf += 1),
  };
  const scheduler: Scheduler = {
    setTimeout: (cb) => {
      timerCb = cb;
      return 2;
    },
    clearTimeout: () => void (cancelled.timer += 1),
  };
  return { frames, scheduler, cancelled, raf: () => rafCb?.(), timer: () => timerCb?.() };
}

describe("frame clock", () => {
  test("runs once even if both rAF and the fallback timer fire", () => {
    const f = fakes();
    let runs = 0;
    createFrameClock(f.frames, f.scheduler, 100).request(() => void (runs += 1));
    f.raf();
    f.timer();
    expect(runs).toBe(1);
  });

  test("hidden window: rAF never fires, fallback timer drains the queue", () => {
    const f = fakes();
    let runs = 0;
    createFrameClock(f.frames, f.scheduler, 100).request(() => void (runs += 1));
    f.timer();
    expect(runs).toBe(1);
    expect(f.cancelled.raf).toBe(1);
  });

  test("cancel prevents the run and clears both handles", () => {
    const f = fakes();
    let runs = 0;
    const cancel = createFrameClock(f.frames, f.scheduler, 100).request(() => void (runs += 1));
    cancel();
    f.raf();
    f.timer();
    expect(runs).toBe(0);
    expect(f.cancelled).toEqual({ raf: 1, timer: 1 });
  });
});

describe("ui store", () => {
  test("approval send marks are set and cleared without touching other keys", () => {
    const ui = createUiStore();
    ui.actions.approvalSending(evt(1));
    ui.actions.approvalFailed(evt(2));
    ui.actions.approvalSettled(evt(1));
    expect(ui.read.getState().approvalSends).toEqual({ [evt(2)]: "failed" });
    ui.actions.toggleSidebar();
    expect(ui.read.getState().sidebarOpen).toBe(false);
  });
});

describe("decode boundary", () => {
  const base = {
    id: evt(3),
    version: 1,
    parentId: null,
    stepId: null,
    causationId: null,
    correlationId: "c",
    redactions: [],
    threadId: thr(1),
    turnId: null,
    recordedAt: "2026-10-24T00:00:00.000Z",
  };

  test("valid item.recorded decodes; invalid payload becomes unreadable with the position kept", () => {
    const ok = decodeDurable({
      ...base,
      kind: "item.recorded",
      durable: true,
      seq: 7,
      payload: { item: userItem(1) },
    });
    expect(ok.type).toBe("item.recorded");
    const bad = decodeDurable({
      ...base,
      kind: "item.recorded",
      durable: true,
      seq: 8,
      payload: { item: { nope: 1 } },
    });
    expect(bad).toMatchObject({ type: "unreadable", seq: 8 });
  });

  test("a kind outside the table is other (position only)", () => {
    expect(
      decodeDurable({ ...base, kind: "settings.changed", durable: true, seq: 9, payload: {} }),
    ).toMatchObject({ type: "other", seq: 9 });
    expect(
      decodeVolatile({
        ...base,
        kind: "x.demo.tool.progress",
        durable: false,
        n: 4,
        afterSeq: 0,
        payload: 1,
      }),
    ).toMatchObject({ type: "other", n: 4 });
  });

  test("unreadable and other still advance the cursor", () => {
    const h = openedHarness();
    h.store.ingest({
      type: "batch",
      sub: SUB,
      from: 5,
      to: 6,
      caughtUp: true,
      facts: [decodeDurable({ ...base, kind: "item.recorded", durable: true, seq: 6, payload: 1 })],
    });
    h.store.flush();
    expect(h.store.read.getState().cursor?.seq).toBe(6);
  });
});

describe("settled markers", () => {
  test("snapshot that already contains a streaming item removes the slot (snapshot ahead of cursor)", () => {
    const h = openedHarness();
    h.store.ingest({ type: "transcript_opening", threadId: thr(1) });
    h.store.ingest({ type: "chunk", fact: delta(0, "partial", 1) });
    h.store.ingest({
      type: "transcript",
      threadId: thr(1),
      asOfSeq: 9,
      items: [userItem(1, "final")],
    });
    h.store.flush();
    expect(h.failures).toEqual([]);
    expect(h.store.read.getState().streaming.itemIds).toEqual([]);
    // 뒤늦게 도착한 같은 item의 확정 이벤트(seq <= asOfSeq)는 레코드를 건드리지 않고 슬롯도 만들지 않는다
    h.store.ingest({
      type: "batch",
      sub: SUB,
      from: 5,
      to: 9,
      caughtUp: true,
      facts: [recorded(8, userItem(1, "final"))],
    });
    h.store.flush();
    expect(checkMirror(h.store.read.getState())).toEqual([]);
  });

  test("markers are bounded by SETTLED_CAP", () => {
    const h = openedHarness();
    const total = SETTLED_CAP + 40;
    for (let i = 1; i <= total; i += 1) {
      h.store.ingest({
        type: "batch",
        sub: SUB,
        from: 4 + i,
        to: 5 + i,
        caughtUp: true,
        facts: [recorded(5 + i, userItem(i))],
      });
    }
    h.store.flush();
    const s: EngineMirror = h.store.read.getState();
    expect(s.streaming.settledItems).toHaveLength(SETTLED_CAP);
    expect(s.streaming.settledItems.at(-1)).toBe(itm(total));
  });

  test("turn tombstone: chunk of a finished turn is stale and creates no slot", () => {
    const h = openedHarness();
    const turn = trn(1);
    h.store.ingest({
      type: "batch",
      sub: SUB,
      from: 5,
      to: 6,
      caughtUp: true,
      facts: [
        {
          type: "turn.completed",
          seq: 6,
          eventId: evt(6),
          threadId: thr(1),
          turnId: turn,
          at: "t",
          payload: { status: "completed", stepCount: 0, usage: null, error: null },
        },
      ],
    });
    h.store.ingest({ type: "chunk", fact: delta(0, "late", 3, thr(1), turn) });
    h.store.flush();
    expect(h.store.read.getState().streaming.itemIds).toEqual([]);
    expect(
      h.journal
        .entries()
        .some((e) => e.kind === "input" && e.input === "chunk:item.updated" && e.note === "stale"),
    ).toBe(true);
  });
});

describe("react surface (server render, no DOM)", () => {
  const commands: Commands = fakeCommands();

  test("hooks without a provider throw Bug (FS context rule)", () => {
    expect(() => renderToString(<Transcript />)).toThrow(Bug);
  });

  test("provider + no open thread renders the empty notice", () => {
    const h = openedHarness();
    const ui = createUiStore();
    const html = renderToString(
      <Providers engine={h.store.read} ui={ui.read} commands={commands}>
        <Transcript />
      </Providers>,
    );
    expect(html).toContain("notice");
  });

  test("status bar renders the initial mirror (server render reads getInitialState)", () => {
    const h = openedHarness();
    const ui = createUiStore();
    const html = renderToString(
      <Providers engine={h.store.read} ui={ui.read} commands={commands}>
        <StatusBar />
      </Providers>,
    );
    expect(html).toContain("엔진 상태 확인 중");
    expect(html).toContain("연결 없음");
    expect(html).toContain("진행 중 <!-- -->0");
  });
});
