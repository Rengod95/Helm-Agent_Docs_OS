import { expect, test } from "bun:test";
import { PrimitiveError } from "@xeon/ext-host";
import { gatherContext, callSource, degradeOf } from "../../src/knowledge.ts";
import { linkWork } from "../../src/outputs.ts";
import { INITIAL_HELM_STATE, type HelmFinding } from "../../src/state.ts";
import { createWorld } from "../support/rig.ts";
import { capabilityLookup } from "../support/unsafe.ts";

const INQUIRY = { inquiryId: "habcdefghijklm", topic: "캐시 무효화", round: 1 };
const SIGNAL = new AbortController().signal;

function lookupOf(world: ReturnType<typeof createWorld>, absent: readonly string[] = []) {
  const table = new Map<string, object>([
    ["web.search", world.services.web],
    ["knowledge.search", world.services.knowledge],
    ["knowledge.memory", world.services.memory],
    ["work.tasks", world.services.work],
  ]);
  for (const id of absent) table.delete(id);
  return capabilityLookup(
    table,
    (id) => new PrimitiveError("capability_unavailable", `no provider for ${id}`),
  );
}

test("gatherContext collects skills, sessions and web sources in order, without a request id", async () => {
  const world = createWorld();
  const digest = await gatherContext({ capability: lookupOf(world) }, INQUIRY, { signal: SIGNAL });
  expect(digest.degraded).toEqual([]);
  expect(digest.sources).toEqual([
    { origin: "knowledge", ref: "skill:skill-1", title: "skill 항목" },
    { origin: "session", ref: "session:session-1", title: "session 항목" },
    { origin: "web", ref: "https://example.test/cache", title: "캐시 문서" },
  ]);
  expect(world.fakes.web.requestIds).toEqual([undefined]);
  expect(world.fakes.knowledge.requestIds).toEqual([undefined, undefined]);
});

test("knowledge.degrades-when-web-missing: a missing provider lists the source as degraded and keeps the rest", async () => {
  const world = createWorld();
  const digest = await gatherContext({ capability: lookupOf(world, ["web.search"]) }, INQUIRY, {
    signal: SIGNAL,
  });
  expect(digest.degraded).toEqual(["web"]);
  expect(digest.sources.map((source) => source.origin)).toEqual(["knowledge", "session"]);
});

test("knowledge.learning-absent-is-empty: with no knowledge capability at all the digest is empty and nothing throws", async () => {
  const world = createWorld();
  const none = await gatherContext(
    { capability: lookupOf(world, ["web.search", "knowledge.search", "knowledge.memory"]) },
    INQUIRY,
    { signal: SIGNAL },
  );
  expect(none).toEqual({ sources: [], degraded: ["knowledge", "session", "web"] });
});

test("an aborted capability call stops the remaining sources", async () => {
  const world = createWorld({ webError: "aborted" });
  const digest = await gatherContext({ capability: lookupOf(world) }, INQUIRY, { signal: SIGNAL });
  expect(digest.degraded).toEqual(["web"]);
  const failed = await callSource("web.search", () => {
    throw new TypeError("not a capability error");
  }).then(
    () => "returned",
    (caught: unknown) => (caught instanceof TypeError ? "rethrown" : "other"),
  );
  expect(failed).toBe("rethrown");
  expect(degradeOf({ kind: "lease_lost" })).toBe("abort");
  expect(degradeOf({ kind: "capability", capability: "web.search", code: "timeout" })).toBe("skip");
});

function withFollowUps(): readonly HelmFinding[] {
  return [
    {
      id: "analogy-1",
      lensId: "analogy",
      claim: "a",
      sources: [],
      confidence: "low",
      followUp: "작업 A",
    },
    { id: "prior-art-1", lensId: "prior-art", claim: "b", sources: [], confidence: "low" },
    {
      id: "inversion-1",
      lensId: "inversion",
      claim: "c",
      sources: [],
      confidence: "low",
      followUp: "작업 C",
    },
  ];
}

test("work.link-idempotent-across-replay: the same finding linked twice creates one task and the same result", async () => {
  const world = createWorld();
  const state = { ...INITIAL_HELM_STATE, findings: [...withFollowUps()] };
  const g = { capability: lookupOf(world) };
  const first = await linkWork(g, state, INQUIRY.inquiryId, { signal: SIGNAL });
  const second = await linkWork(g, state, INQUIRY.inquiryId, { signal: SIGNAL });
  expect(world.fakes.tasks.created).toEqual(["작업 A", "작업 C"]);
  expect(world.fakes.tasks.calls).toBe(4);
  expect([...second.tasks]).toEqual([...first.tasks]);
  expect([...first.tasks]).toEqual([
    ["analogy-1", "t1"],
    ["inversion-1", "t2"],
  ]);
  expect(world.fakes.tasks.created).toHaveLength(2);
});

test("a missing work capability skips every link and reports how many", async () => {
  const world = createWorld();
  const state = { ...INITIAL_HELM_STATE, findings: [...withFollowUps()] };
  const result = await linkWork(
    { capability: lookupOf(world, ["work.tasks"]) },
    state,
    INQUIRY.inquiryId,
    {
      signal: SIGNAL,
    },
  );
  expect(result).toEqual({ tasks: new Map(), leaseLost: false, skipped: 2 });
});
