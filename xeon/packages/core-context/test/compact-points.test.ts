import { describe, expect, test } from "bun:test";
import { POINTS } from "@xeon/contracts/extensions";
import { assembleOptions, binding } from "./support/builders.ts";
import { harness, installHandlers, type Harness } from "./support/harness.ts";
import { present, valueOf } from "./support/result.ts";
import { buildChat } from "./support/scenario.ts";

// L1.context.plan §5 compact-points: session_before_compact 거부·확장 요약, session_compact, session_compact_failed,
// cache_warming_decision(선언만).

const SMALL = { keepRecentTokens: 250, reserveTokens: 1024 };

function request(overrides: { reason?: "manual" | "threshold" | "overflow" } = {}) {
  return {
    reason: "manual" as const,
    binding,
    contextWindow: 200_000,
    willRetry: false,
    ...overrides,
  };
}

async function ready(): Promise<Harness> {
  const h = await harness({ settings: SMALL });
  await buildChat(h, 6);
  return h;
}

describe("session_before_compact", () => {
  test("session_before_compact_denial_blocks: a cancel decision stops before the model and the commit", async () => {
    const h = await ready();
    await installHandlers(h.host, "guard", 3, ["session_before_compact"], (g) => {
      g.on("session_before_compact", () => ({ cancel: true as const, reason: "not now" }));
    });
    const outcome = valueOf(await h.service.compact(h.log.threadId, request()));
    expect(outcome).toEqual({ status: "cancelled", by: "guard", reason: "not now" });
    expect(h.fake.calls).toHaveLength(0);
    expect(h.log.commits).toHaveLength(0);
  });

  test("a handler that throws also cancels (fail-closed)", async () => {
    const h = await ready();
    await installHandlers(h.host, "broken", 3, ["session_before_compact"], (g) => {
      g.on("session_before_compact", () => {
        throw new Error("handler exploded");
      });
    });
    const outcome = valueOf(await h.service.compact(h.log.threadId, request()));
    expect(outcome.status).toBe("cancelled");
    expect(h.fake.calls).toHaveLength(0);
    expect(h.log.commits).toHaveLength(0);
  });

  test("the payload carries the preparation counts and the merged instructions", async () => {
    const h = await ready();
    h.setSettings({ compactionInstructions: "from settings" });
    const seen: unknown[] = [];
    await installHandlers(h.host, "spy", 3, ["session_before_compact"], (g) => {
      g.on("session_before_compact", (payload) => {
        seen.push(payload);
        return undefined;
      });
    });
    h.fake.replies.push({ kind: "text", text: "S" });
    valueOf(
      await h.service.compact(h.log.threadId, { ...request(), instructions: "from the user" }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      threadId: h.log.threadId,
      reason: "manual",
      willRetry: false,
      instructions: "from settings\nfrom the user",
      preparation: { isSplitTurn: false, previousSummary: null },
    });
  });

  test("extension_summary_skips_model_call: the summary is recorded with the extension name", async () => {
    const h = await ready();
    const chosen = present(
      h.log.events.find((event) => event.kind === "item.recorded" && event.seq > 6),
    );
    await installHandlers(h.host, "own-summary", 3, ["session_before_compact"], (g) => {
      g.on("session_before_compact", () => ({
        cancel: false as const,
        compaction: {
          summary: "EXTENSION SUMMARY",
          firstKeptEventId: chosen.id,
          details: { by: "x" },
        },
      }));
    });
    const outcome = valueOf(await h.service.compact(h.log.threadId, request()));
    expect(outcome).toMatchObject({ status: "compacted", fromExtension: "own-summary" });
    expect(h.fake.calls).toHaveLength(0);
    const compacted = present(h.log.events.findLast((event) => event.kind === "thread.compacted"));
    expect(compacted.payload).toMatchObject({
      summary: "EXTENSION SUMMARY",
      firstKeptEventId: chosen.id,
      fromExtension: "own-summary",
      usage: null,
      details: { extension: { by: "x" } },
    });
  });

  test("an extension summary pointing off the branch is refused", async () => {
    const h = await ready();
    const foreign = h.log.ids.next("evt");
    await installHandlers(h.host, "bad-cut", 3, ["session_before_compact"], (g) => {
      g.on("session_before_compact", () => ({
        cancel: false as const,
        compaction: { summary: "x", firstKeptEventId: foreign, details: null },
      }));
    });
    const outcome = valueOf(await h.service.compact(h.log.threadId, request()));
    expect(outcome).toMatchObject({ status: "cancelled", by: "bad-cut" });
    expect(h.log.commits).toHaveLength(0);
  });
});

describe("after the decision", () => {
  test("session_compact fires once with the new event and the failed point stays quiet", async () => {
    const h = await ready();
    const compacts: unknown[] = [];
    const fails: unknown[] = [];
    await installHandlers(
      h.host,
      "watch",
      3,
      ["session_compact", "session_compact_failed"],
      (g) => {
        g.on("session_compact", (payload) => {
          compacts.push(payload);
        });
        g.on("session_compact_failed", (payload) => {
          fails.push(payload);
        });
      },
    );
    h.fake.replies.push({ kind: "text", text: "S" });
    const outcome = valueOf(
      await h.service.compact(h.log.threadId, request({ reason: "threshold" })),
    );
    await h.host.settled();
    expect(compacts).toHaveLength(1);
    expect(fails).toHaveLength(0);
    expect(compacts[0]).toMatchObject({
      threadId: h.log.threadId,
      reason: "threshold",
      willRetry: false,
      fromExtension: null,
      eventId: outcome.status === "compacted" ? outcome.eventId : null,
    });
  });

  test("a cancelled compaction fires neither point", async () => {
    const h = await ready();
    const seen: string[] = [];
    await installHandlers(
      h.host,
      "deny-and-watch",
      3,
      ["session_before_compact", "session_compact", "session_compact_failed"],
      (g) => {
        g.on("session_before_compact", () => ({ cancel: true as const, reason: "no" }));
        g.on("session_compact", () => {
          seen.push("compact");
        });
        g.on("session_compact_failed", () => {
          seen.push("failed");
        });
      },
    );
    valueOf(await h.service.compact(h.log.threadId, request()));
    await h.host.settled();
    expect(seen).toEqual([]);
  });
});

describe("cache_warming_decision_declared_not_fired", () => {
  test("the point is declared but nothing in M2 fires it", async () => {
    expect(Object.keys(POINTS)).toContain("cache_warming_decision");
    const h = await ready();
    let fired = 0;
    await installHandlers(h.host, "warmer", 3, ["cache_warming_decision"], (g) => {
      g.on("cache_warming_decision", () => {
        fired += 1;
        return undefined;
      });
    });
    h.fake.replies.push({ kind: "text", text: "S" });
    valueOf(await h.service.compact(h.log.threadId, request()));
    valueOf(await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)));
    await h.host.settled();
    expect(fired).toBe(0);
  });
});
