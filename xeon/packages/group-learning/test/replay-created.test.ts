import { expect, test } from "bun:test";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { createLearningProjector } from "../src/proposals/sql.ts";
import { NEW_SKILL, queueApi, startReview, submit } from "./support/flow.ts";
import { foldEvents } from "./support/projection.ts";

test("projection.created-replay: a replayed proposal.created keeps the decided status", async () => {
  const review = await startReview();
  const { rig } = review;
  const made = await submit(review, NEW_SKILL);
  const id = made.ok ? made.proposalId : "";
  await queueApi(rig).decide({ kind: "approve", proposalId: id, revision: 1 });
  const events = rig.foldedEvents();
  const created = events.filter((event) => event.kind === "grp.learning.proposal.created");
  expect(created).toHaveLength(1);
  const once = foldEvents(events).proposals.get(id);
  const twice = foldEvents([...events, ...created]).proposals.get(id);
  expect(once?.status).not.toBe("pending");
  expect(twice).toEqual(once);
});

test("projection.undecodable: an event that cannot be decoded is reported and does not throw", () => {
  const ids = fixedIdFactory(5);
  const skipped: string[] = [];
  const projector = createLearningProjector((kind) => skipped.push(kind));
  const tx = {
    run: () => undefined,
    get: () => undefined,
    all: () => [],
  };
  projector.apply(tx, {
    id: ids.next("evt"),
    kind: "grp.learning.proposal.decided",
    version: 1,
    threadId: ids.next("thr"),
    turnId: null,
    stepId: null,
    recordedAt: 1,
    causationId: null,
    correlationId: null,
    payload: { broken: true },
    durable: true,
    seq: 1,
    parentId: null,
  });
  expect(skipped).toEqual(["grp.learning.proposal.decided"]);
});
