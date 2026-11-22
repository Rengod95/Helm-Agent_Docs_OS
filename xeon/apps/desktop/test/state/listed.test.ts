import { describe, expect, test } from "bun:test";
import { hiddenFromLists } from "../../src/state/engine/listed.ts";
import { summary, thr } from "./helpers.ts";

describe("hiddenFromLists", () => {
  test("hides internal threads and every test chat, keeps plain threads and a missing summary", () => {
    expect(
      hiddenFromLists(summary(thr(1), { spawnedBy: { threadId: thr(2), kind: "internal" } })),
    ).toBe(true);
    expect(hiddenFromLists(summary(thr(1), { craftChat: { plugin: null } }))).toBe(true);
    expect(hiddenFromLists(summary(thr(1), { craftChat: { plugin: "repo-guard" } }))).toBe(true);
    expect(hiddenFromLists(summary(thr(1)))).toBe(false);
    expect(hiddenFromLists(undefined)).toBe(false);
  });
});
