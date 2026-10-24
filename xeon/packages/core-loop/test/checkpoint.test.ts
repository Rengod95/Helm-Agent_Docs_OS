import { expect, test } from "bun:test";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { Type } from "typebox";
import type { EventId, StepId, ThreadId, TurnId } from "@xeon/contracts/conversation";
import {
  defineManifest,
  type BoundaryValue,
  type ExtensionEntry,
} from "@xeon/contracts/extensions";
import type { CatalogEntry, DurableEventDraft } from "@xeon/contracts/records";
import type { ExtensionUnit } from "@xeon/ext-host";
import { finalizeBoundary, type BoundaryCheckContext } from "../src/index.ts";
import { createHarness } from "./support/harness.ts";
import { countKind, kindsOf } from "./support/inspect.ts";

const ids = fixedIdFactory(0);
const threadId: ThreadId = ids.next("thr");
const turnId: TurnId = ids.next("trn");
const stepId: StepId = ids.next("stp");

const NOTE_KIND = "grp.demo.note.recorded";
const noteCatalog: CatalogEntry = {
  kind: "thread.updated",
  version: 1,
  durable: true,
  payload: Type.Object({ text: Type.String() }),
};

function context(overrides: Partial<BoundaryCheckContext> = {}): BoundaryCheckContext {
  return {
    threadId,
    turnId,
    stepId,
    lookup: (kind) => (kind === NOTE_KIND ? noteCatalog : undefined),
    committed: () => false,
    canContinue: true,
    ...overrides,
  };
}

function itemLookup(kind: string): CatalogEntry | undefined {
  return kind === "item.recorded" ? { ...noteCatalog, payload: Type.Unknown() } : undefined;
}

function entry(overrides: Partial<DurableEventDraft> = {}): DurableEventDraft {
  return {
    id: ids.next("evt"),
    kind: NOTE_KIND,
    version: 1,
    threadId,
    turnId,
    stepId,
    causationId: null,
    correlationId: null,
    payload: { text: "hi" },
    durable: true,
    ...overrides,
  };
}

/** 형식이 틀린 kind를 가진 초안을 만든다(타입이 막는 값이라 Reflect로 넣는다) */
function withKind(draft: DurableEventDraft, kind: string): DurableEventDraft {
  const copy = structuredClone(draft);
  Reflect.set(copy, "kind", kind);
  return copy;
}

function verdictOf(entries: readonly DurableEventDraft[], ctx = context(), cont = false) {
  const value: BoundaryValue = { entries: [...entries], continue: cont };
  return finalizeBoundary(value, ctx);
}

test("boundary_finalize_accepts_a_valid_extension_entry", () => {
  const verdict = verdictOf([entry()], context(), true);
  expect(verdict.ok).toBe(true);
  expect(verdict.value.entries).toHaveLength(1);
  expect(verdict.value.continue).toBe(true);
});

test("boundary_finalize_rejects_invalid_entries", () => {
  const cases: readonly [string, DurableEventDraft][] = [
    ["a kind without an owner prefix", withKind(entry(), "note.recorded")],
    ["a step.completed entry", entry({ kind: "step.completed", payload: {} })],
    ["a core kind other than a custom item", entry({ kind: "turn.completed", payload: {} })],
    ["a payload that breaks its schema", entry({ payload: { text: 7 } })],
    ["another thread", entry({ threadId: ids.next("thr") })],
    ["another turn", entry({ turnId: ids.next("trn") })],
    ["another step", entry({ stepId: ids.next("stp") })],
    ["an unregistered extension kind", entry({ kind: "grp.demo.other.recorded" })],
    ["a payload larger than 256 KiB", entry({ payload: { text: "x".repeat(300_000) } })],
  ];
  for (const [label, bad] of cases) {
    const verdict = verdictOf([entry(), bad], context(), true);
    expect(verdict.ok, label).toBe(false);
    expect(verdict.value, label).toEqual({ entries: [], continue: false });
    expect(!verdict.ok && verdict.issues.length, label).toBeGreaterThan(0);
  }
});

test("boundary_finalize_rejects_duplicate_ids_and_committed_ids", () => {
  const first = entry();
  expect(verdictOf([first, { ...first }]).ok).toBe(false);
  const committed = new Set<EventId>([first.id]);
  expect(verdictOf([first], context({ committed: (id) => committed.has(id) })).ok).toBe(false);
});

test("boundary_finalize_allows_only_custom_item_recorded_among_core_kinds", () => {
  const custom = entry({
    kind: "item.recorded",
    payload: {
      item: {
        itemId: ids.next("itm"),
        status: "completed",
        kind: "custom",
        message: {
          role: "custom",
          customType: NOTE_KIND,
          content: "x",
          display: false,
          details: null,
          timestamp: 1,
        },
      },
    },
  });
  expect(verdictOf([custom], context({ lookup: itemLookup })).ok).toBe(true);
  const user = entry({
    kind: "item.recorded",
    payload: { item: { itemId: ids.next("itm"), status: "completed", kind: "user" } },
  });
  expect(verdictOf([user], context({ lookup: itemLookup })).ok).toBe(false);
});

test("boundary_finalize_keeps_entries_but_drops_continue_when_it_cannot_continue", () => {
  const verdict = verdictOf([entry()], context({ canContinue: false }), true);
  expect(verdict.ok).toBe(true);
  expect(verdict.value.entries).toHaveLength(1);
  expect(verdict.value.continue).toBe(false);
});

function boundaryGroup(
  entries: (
    stepId: StepId,
    threadId: ThreadId,
    turnId: TurnId | null,
  ) => readonly DurableEventDraft[],
): ExtensionUnit {
  const entry: ExtensionEntry = ({ manifest, scope }) => {
    scope(manifest.name, {}, (g) => {
      g.on("turn_end", (payload, current, ctx) => ({
        entries: [...current.entries, ...entries(payload.stepId, ctx.threadId, null)],
      }));
    });
  };
  return {
    manifest: defineManifest({
      schemaVersion: 1,
      name: "boundary-writer",
      version: "0.1.0",
      layer: "plugin",
      kind: "plugin",
      entry: "./index.ts",
      points: ["turn_end"],
      usesDrive: false,
    }),
    entry,
    loadIndex: 3,
    builtin: false,
  };
}

const answer = {
  kind: "message",
  content: [{ type: "text", text: "ok" }],
  stopReason: "stop",
} as const;

test("valid_boundary_entries_land_in_the_step_end_commit", async () => {
  const h = await createHarness({ script: [answer] });
  const own = fixedIdFactory(9_000_000);
  await h.host.host.install(
    boundaryGroup((step, thread) => [
      {
        id: own.next("evt"),
        kind: NOTE_KIND,
        version: 1,
        threadId: thread,
        turnId:
          h.fake.events(thread).find((event) => event.kind === "turn.started")?.turnId ?? null,
        stepId: step,
        causationId: null,
        correlationId: null,
        payload: { text: "from the extension" },
        durable: true,
      },
    ]),
  );
  await h.host.settled();
  await h.loop.admit({ threadId: h.threadId, content: "hi", via: "interactive" });
  await h.settle();
  const events = h.fake.events(h.threadId);
  const kinds = kindsOf(events);
  const end = kinds.indexOf("step.completed");
  expect(kinds.slice(end, end + 3)).toEqual(["step.completed", NOTE_KIND, "checkpoint.step"]);
  const keys = h.fake.commitKeys(h.threadId);
  expect(keys[end]).toBe(keys[end + 1]);
});

test("invalid_boundary_entries_are_dropped_and_logged_not_committed", async () => {
  const h = await createHarness({ script: [answer] });
  const own = fixedIdFactory(9_500_000);
  await h.host.host.install(
    boundaryGroup((step, thread) => [
      {
        id: own.next("evt"),
        kind: "step.completed",
        version: 1,
        threadId: thread,
        turnId: null,
        stepId: step,
        causationId: null,
        correlationId: null,
        payload: {},
        durable: true,
      },
    ]),
  );
  await h.host.settled();
  await h.loop.admit({ threadId: h.threadId, content: "hi", via: "interactive" });
  await h.settle();
  const events = h.fake.events(h.threadId);
  expect(countKind(events, "step.completed")).toBe(1);
  expect(h.logs.records.some((record) => record.event === "loop.boundary_invalid")).toBe(true);
  expect(countKind(events, "turn.completed")).toBe(1);
});
