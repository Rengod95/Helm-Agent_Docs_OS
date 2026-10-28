import { describe, expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { WebCallMetaSchema } from "@xeon/contracts/capabilities";
import { buildMeta, NO_COST, normalizeWarnings } from "../src/contract/meta.ts";
import { manualClock } from "./support/clock.ts";
import { fixedLocalIds } from "./support/ids.ts";

describe("buildMeta", () => {
  test("builds a schema-valid meta with an injected clock and ids", () => {
    const clock = manualClock();
    const startedAt = clock.now();
    clock.advance(42);
    const meta = buildMeta({
      ids: fixedLocalIds(),
      clock,
      startedAt,
      provider: "searxng",
      selectedBy: "auto",
      fallbacks: [{ provider: "plugin:web-x", stage: "probe", reason: "no-key" }],
      cache: "miss",
      cost: NO_COST,
      warnings: [],
    });
    expect(parse(WebCallMetaSchema, meta).ok).toBe(true);
    expect(meta.latencyMs).toBe(42);
    expect(meta.untrusted).toBe(true);
    expect(meta.callId.startsWith("wcl_")).toBe(true);
  });

  test("warnings are deduplicated and bounded", () => {
    const many = Array.from({ length: 30 }, (_, index) => `w${index}`);
    const out = normalizeWarnings(["dup", "dup", ...many, "x".repeat(900)]);
    expect(out.length).toBe(16);
    expect(out.filter((warning) => warning === "dup").length).toBe(1);
    expect(normalizeWarnings(["x".repeat(900)])[0]?.length).toBe(512);
  });
});
