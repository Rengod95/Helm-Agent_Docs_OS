import { describe, expect, test } from "bun:test";
import { Bug, ok, parse, type Result } from "@xeon/contracts";
import type { EventId, ItemId, TurnId } from "@xeon/contracts/conversation";
import { InputQueuedPayloadSchema } from "@xeon/contracts/records";
import type {
  DrainMode,
  InputDraft,
  InputQueueError,
  PlacementPoint,
  PlacementSelection,
} from "@xeon/contracts/services";
import { createStaticTasksSettings } from "../src/settings-source.ts";
import { createWorld, restart, userDraft, type World } from "./support/world.ts";

/** 시험에서 오류 값을 받지 않는 호출의 결과를 꺼낸다 */
function unwrapped<T>(result: Result<T, { readonly kind: string }>): T {
  if (!result.ok) throw new Bug(`unexpected failure: ${result.error.kind}`);
  return result.value;
}

/** requestId로 input.queued 이벤트를 찾아 입력 id를 돌려준다 */
function enqueued(world: World, draft: InputDraft): EventId {
  for (const event of world.session.events) {
    if (event.kind !== "input.queued") continue;
    const payload = parse(InputQueuedPayloadSchema, event.payload);
    if (payload.ok && payload.value.requestId === draft.requestId) return event.id;
  }
  throw new Bug(`no input.queued for ${draft.requestId}`);
}

async function mustEnqueue(world: World, draft: InputDraft): Promise<EventId> {
  const result = await world.tasks.inputs.enqueue(draft);
  if (!result.ok) throw new Bug(`enqueue failed: ${result.error.kind}`);
  return result.value.inputId;
}

/** 차례로 넣는다. enqueue는 호출 시점에 커밋하므로 순서가 지켜진다 */
async function enqueueAll(world: World, drafts: readonly InputDraft[]): Promise<void> {
  const results = await Promise.all(drafts.map((draft) => world.tasks.inputs.enqueue(draft)));
  for (const result of results) {
    if (!result.ok) throw new Bug(`enqueue failed: ${result.error.kind}`);
  }
}

const names = (selection: PlacementSelection): string[] =>
  selection.inputs.map((input) => input.requestId);

async function seeded(options?: Parameters<typeof createWorld>[0]): Promise<World> {
  const world = createWorld(options);
  // seq 1: steer, 2: followUp, 3: steer, 4: followUp
  await enqueueAll(world, [
    userDraft(world.threadId, "s1"),
    userDraft(world.threadId, "f1", { mode: "followUp" }),
    userDraft(world.threadId, "s2"),
    userDraft(world.threadId, "f2", { mode: "followUp" }),
  ]);
  return world;
}

interface Placed {
  readonly selection: PlacementSelection;
  readonly turnId: TurnId;
  readonly itemIds: readonly ItemId[];
}

/** loop의 경계 커밋을 흉내 낸다: drain으로 고르고 input.placed 초안을 한 커밋에 넣는다 */
function placeAt(world: World, at: PlacementPoint, key: string, continuing = false): Placed {
  const turnId = world.ids.next("trn");
  const itemIds: ItemId[] = [];
  const holder: { selection: PlacementSelection | undefined } = { selection: undefined };
  const result = world.session.commit({
    threadId: world.threadId,
    requestId: key,
    fingerprintSource: { key },
    build: (view) => {
      const selection = unwrapped(
        world.tasks.inputs.drain(view, world.threadId, at, { continuing }),
      );
      holder.selection = selection;
      const placements = selection.inputs.map((input) => {
        const itemId = world.ids.next("itm");
        itemIds.push(itemId);
        return { inputId: input.inputId, itemId, turnId };
      });
      if (placements.length === 0) return { kind: "reject", code: "nothing", detail: null };
      return { kind: "append", drafts: selection.drafts(placements), checkpoint: null };
    },
  });
  if (!result.ok || holder.selection === undefined) throw new Bug("placement commit failed");
  return { selection: holder.selection, turnId, itemIds };
}

function viewSelection(world: World, at: PlacementPoint, continuing = false): PlacementSelection {
  const holder: { selection: PlacementSelection | undefined } = { selection: undefined };
  world.session.commit({
    threadId: world.threadId,
    requestId: `peek:${world.session.commitCalls}`,
    fingerprintSource: { n: world.session.commitCalls },
    build: (view) => {
      holder.selection = unwrapped(
        world.tasks.inputs.drain(view, world.threadId, at, { continuing }),
      );
      return { kind: "reject", code: "view_only", detail: null };
    },
  });
  if (holder.selection === undefined) throw new Bug("drain did not run");
  return holder.selection;
}

describe("enqueue", () => {
  test("a steer and a followUp become input.queued events and queued projection rows", async () => {
    const world = createWorld();
    const steer = userDraft(world.threadId, "r-steer");
    const followUp = userDraft(world.threadId, "r-follow", { mode: "followUp" });
    const first = await world.tasks.inputs.enqueue(steer);
    const second = await world.tasks.inputs.enqueue(followUp);
    expect(first.ok && first.value).toEqual({
      requestId: "r-steer",
      duplicate: false,
      inputId: enqueued(world, steer),
      state: "queued",
    });
    expect(second.ok && second.value.duplicate).toBe(false);
    expect(world.session.events.map((event) => event.kind)).toEqual([
      "input.queued",
      "input.queued",
    ]);
    expect(world.session.events[0]?.payload).toEqual({
      mode: "steer",
      item: { kind: "user", content: "text r-steer" },
      requestId: "r-steer",
      source: { type: "user", via: "interactive" },
    });
    expect(world.session.events[0]?.turnId).toBeNull();
    expect(
      unwrapped(world.tasks.inputs.peek(world.threadId)).map((input) => input.requestId),
    ).toEqual(["r-steer", "r-follow"]);
  });

  test("post_duplicate_request_id_enqueues_once", async () => {
    const world = createWorld();
    const original = userDraft(world.threadId, "same");
    const changed = userDraft(world.threadId, "same", {
      mode: "followUp",
      item: { kind: "user", content: "a different message" },
    });
    const first = await world.tasks.inputs.enqueue(original);
    const second = await world.tasks.inputs.enqueue(changed);
    if (!first.ok || !second.ok) throw new Bug("enqueue failed");
    expect(first.value.duplicate).toBe(false);
    // 내용이 달라도 duplicate:true이고 key_reused는 나오지 않는다
    expect(second.value.duplicate).toBe(true);
    expect(second.value.inputId).toBe(first.value.inputId);
    expect(second.value.state).toBe("queued");
    expect(world.session.events.filter((event) => event.kind === "input.queued").length).toBe(1);
    // 첫 입력의 내용이 남는다
    expect(unwrapped(world.tasks.inputs.peek(world.threadId))[0]).toMatchObject({
      mode: "steer",
      item: { kind: "user", content: "text same" },
    });
  });

  test("a duplicate reports the current state of the existing input", async () => {
    const world = createWorld();
    const draft = userDraft(world.threadId, "r1");
    const inputId = await mustEnqueue(world, draft);
    placeAt(world, "stepEnd", "step:a:0:end");
    const placed = await world.tasks.inputs.enqueue(draft);
    expect(placed.ok && placed.value).toMatchObject({ duplicate: true, inputId, state: "placed" });

    const other = userDraft(world.threadId, "r2");
    await mustEnqueue(world, other);
    await world.tasks.inputs.withdraw(world.threadId, "all", "user");
    const withdrawn = await world.tasks.inputs.enqueue(other);
    expect(withdrawn.ok && withdrawn.value).toMatchObject({ duplicate: true, state: "withdrawn" });
  });

  test("post_same_request_id_other_source_is_distinct", async () => {
    const world = createWorld();
    const sources: InputDraft["source"][] = [
      { type: "user", via: "rpc" },
      { type: "extension", scopeId: "helm" },
      { type: "extension", scopeId: "helm/review" },
      { type: "delegation", childThreadId: world.ids.next("thr") },
      { type: "schedule", timerId: "tmr_1" },
    ];
    const results = await Promise.all(
      sources.map((source) =>
        world.tasks.inputs.enqueue(userDraft(world.threadId, "shared-id", { source })),
      ),
    );
    for (const result of results) expect(result.ok && result.value.duplicate).toBe(false);
    expect(world.session.events.filter((event) => event.kind === "input.queued").length).toBe(5);
    // 같은 출처는 다시 들어가지 않는다
    const again = await world.tasks.inputs.enqueue(
      userDraft(world.threadId, "shared-id", {
        source: { type: "extension", scopeId: "helm/review" },
      }),
    );
    expect(again.ok && again.value.duplicate).toBe(true);
  });

  test("a different requestId in the same source is a different input", async () => {
    const world = createWorld();
    await mustEnqueue(world, userDraft(world.threadId, "a"));
    await mustEnqueue(world, userDraft(world.threadId, "b"));
    expect(unwrapped(world.tasks.inputs.peek(world.threadId)).length).toBe(2);
  });

  test("an input already queued by another commit is reported as a duplicate", async () => {
    const world = createWorld();
    const draft = userDraft(world.threadId, "deleg-report", {
      source: { type: "delegation", childThreadId: world.ids.next("thr") },
    });
    // 위임 완료 보고처럼 다른 사실과 한 커밋에 넣는다(다른 커밋 키)
    const direct = world.session.commit({
      threadId: world.threadId,
      requestId: "agent:child:settled",
      fingerprintSource: { child: "x" },
      build: (view) => {
        const queued = world.tasks.inputs.draftQueued(view, draft);
        expect(queued.existing).toBeUndefined();
        return { kind: "append", drafts: queued.drafts, checkpoint: null };
      },
    });
    expect(direct.ok).toBe(true);
    const inputId = enqueued(world, draft);

    const again = await world.tasks.inputs.enqueue(draft);
    expect(again.ok && again.value).toEqual({
      requestId: "deleg-report",
      duplicate: true,
      inputId,
      state: "queued",
    });
    expect(world.session.events.filter((event) => event.kind === "input.queued").length).toBe(1);

    // draftQueued도 같은 입력을 existing으로 돌려준다
    const check = world.session.commit({
      threadId: world.threadId,
      requestId: "probe",
      fingerprintSource: {},
      build: (view) => {
        const queued = world.tasks.inputs.draftQueued(view, draft);
        expect(queued.drafts).toEqual([]);
        expect(queued.existing?.inputId).toBe(inputId);
        return { kind: "reject", code: "probe", detail: null };
      },
    });
    expect(check.ok).toBe(true);
  });

  // spec plan aside_mode_per_decision (D7 1안)
  test("aside_mode_per_decision: aside is a user/CLI mode; extension, delegation and schedule sources are refused", async () => {
    const world = createWorld();
    const sources = [
      { type: "extension", scopeId: "helm" },
      { type: "delegation", childThreadId: world.ids.next("thr") },
      { type: "schedule", timerId: "t1" },
    ] as const;
    const refused = await Promise.all(
      sources.map((source, index) =>
        world.tasks.inputs.enqueue(
          userDraft(world.threadId, `a-${String(index)}`, { mode: "aside", source }),
        ),
      ),
    );
    expect(refused).toEqual(
      sources.map(() => ({ ok: false, error: { kind: "mode_not_supported", mode: "aside" } })),
    );
    expect(world.session.events).toEqual([]);
    const accepted = await world.tasks.inputs.enqueue(
      userDraft(world.threadId, "a-user", { mode: "aside" }),
    );
    expect(accepted.ok && accepted.value).toMatchObject({ duplicate: false, state: "queued" });
    // next는 어떤 출처에서든 받는다
    const next = await world.tasks.inputs.enqueue(
      userDraft(world.threadId, "n-ext", {
        mode: "next",
        source: { type: "extension", scopeId: "helm" },
      }),
    );
    expect(next.ok).toBe(true);
    expect(
      unwrapped(world.tasks.inputs.peek(world.threadId, ["next", "aside"])).map((i) => i.mode),
    ).toEqual(["aside", "next"]);
  });

  test("invalid request ids are rejected before any commit", async () => {
    const world = createWorld();
    const invalid = ["", "x".repeat(65), "has space", "slash/inside", "한글"];
    const results = await Promise.all(
      invalid.map((requestId) => world.tasks.inputs.enqueue(userDraft(world.threadId, requestId))),
    );
    expect(results).toEqual(
      invalid.map((requestId) => ({ ok: false, error: { kind: "invalid_request_id", requestId } })),
    );
    expect(world.session.commitCalls).toBe(0);
    // 64자는 들어간다
    const longest = await world.tasks.inputs.enqueue(userDraft(world.threadId, "y".repeat(64)));
    expect(longest.ok).toBe(true);
  });

  test("a closed or unknown thread is refused", async () => {
    const world = createWorld();
    world.session.setThreadStatus(world.threadId, "closed");
    const closed = await world.tasks.inputs.enqueue(userDraft(world.threadId, "r"));
    expect(closed).toEqual({
      ok: false,
      error: { kind: "thread_closed", threadId: world.threadId },
    });

    const missing = world.ids.next("thr");
    const absent = await world.tasks.inputs.enqueue(userDraft(missing, "r"));
    expect(absent).toEqual({ ok: false, error: { kind: "thread_not_found", threadId: missing } });
    expect(world.session.events).toEqual([]);
  });

  test("a store error is passed through and a busy store is retried with the same key", async () => {
    const world = createWorld();
    world.session.failNext({ kind: "busy" }, 2);
    const retried = await world.tasks.inputs.enqueue(userDraft(world.threadId, "r"));
    expect(retried.ok && retried.value.duplicate).toBe(false);
    expect(world.session.commitCalls).toBe(3);

    world.session.failNext({ kind: "disk_full" });
    const failed = await world.tasks.inputs.enqueue(userDraft(world.threadId, "r2"));
    const error: InputQueueError | undefined = failed.ok ? undefined : failed.error;
    expect(error).toEqual({ kind: "disk_full" });
  });

  test("context items keep their custom type, display flag and details through the event", async () => {
    const world = createWorld();
    const draft = userDraft(world.threadId, "ctx", {
      mode: "followUp",
      item: {
        kind: "context",
        customType: "grp.helm.note.recorded",
        content: [{ type: "text", text: "remember this" }],
        display: true,
        details: { score: 3, tags: ["a"] },
      },
      source: { type: "extension", scopeId: "helm" },
    });
    const inputId = await mustEnqueue(world, draft);
    const [stored] = unwrapped(world.tasks.inputs.peek(world.threadId));
    expect(stored).toEqual({ ...draft, inputId, seq: 1 });

    const bare = userDraft(world.threadId, "ctx2", {
      item: { kind: "context", customType: "x.note.log.line", content: "plain", display: false },
    });
    await mustEnqueue(world, bare);
    const loaded = unwrapped(world.tasks.inputs.peek(world.threadId))[1];
    expect(loaded?.item).toEqual({
      kind: "context",
      customType: "x.note.log.line",
      content: "plain",
      display: false,
      details: null,
    });
  });
});

describe("extension post", () => {
  test("a post writes input.queued only", async () => {
    const world = createWorld();
    const result = await world.tasks.enqueue({
      threadId: world.threadId,
      scopeId: "helm/review",
      requestId: "post-1",
      when: "followUp",
      item: { kind: "user", content: "hello" },
    });
    expect(result).toEqual(ok({ duplicate: false }));
    expect(world.session.commitCalls).toBe(1);
    const [queued, ...rest] = world.session.events;
    expect(rest).toEqual([]);
    expect(queued?.kind).toBe("input.queued");
    expect(queued?.payload).toMatchObject({
      mode: "followUp",
      requestId: "post-1",
      source: { type: "extension", scopeId: "helm/review" },
    });
    expect(unwrapped(world.tasks.inputs.peek(world.threadId))[0]?.inputId).toBe(queued?.id);
  });

  test("a second post with the same requestId is a duplicate and writes nothing", async () => {
    const world = createWorld();
    const request = {
      threadId: world.threadId,
      scopeId: "helm",
      requestId: "dup",
      when: "steer" as const,
      item: { kind: "user" as const, content: "x" },
    };
    await world.tasks.enqueue(request);
    const before = world.session.events.length;
    expect(await world.tasks.enqueue({ ...request, item: { kind: "user", content: "y" } })).toEqual(
      ok({ duplicate: true }),
    );
    expect(world.session.events.length).toBe(before);
    expect(world.session.events.filter((event) => event.kind === "input.queued").length).toBe(1);
  });

  test("the same requestId from two scopes is two posts", async () => {
    const world = createWorld();
    const base = {
      threadId: world.threadId,
      requestId: "r",
      when: "steer" as const,
      item: { kind: "user" as const, content: "x" },
    };
    expect(await world.tasks.enqueue({ ...base, scopeId: "helm" })).toEqual(
      ok({ duplicate: false }),
    );
    expect(await world.tasks.enqueue({ ...base, scopeId: "learning" })).toEqual(
      ok({ duplicate: false }),
    );
    expect(await world.tasks.enqueue({ ...base, scopeId: "helm" })).toEqual(
      ok({ duplicate: true }),
    );
  });

  test("post.when next is accepted and queued as a next input", async () => {
    const world = createWorld();
    const accepted = await world.tasks.enqueue({
      threadId: world.threadId,
      scopeId: "helm",
      requestId: "n",
      when: "next",
      item: { kind: "user", content: "x" },
    });
    expect(accepted).toEqual(ok({ duplicate: false }));
    expect(
      unwrapped(world.tasks.inputs.peek(world.threadId)).map((i) => [i.requestId, i.mode]),
    ).toEqual([["n", "next"]]);
  });
});

describe("restart", () => {
  test("queue_restored_after_restart", async () => {
    const before = createWorld();
    await mustEnqueue(before, userDraft(before.threadId, "r-steer"));
    await mustEnqueue(
      before,
      userDraft(before.threadId, "r-follow", {
        mode: "followUp",
        source: { type: "schedule", timerId: "tmr_1" },
      }),
    );
    const expected = unwrapped(before.tasks.inputs.peek(before.threadId));
    expect(expected.map((input) => input.mode)).toEqual(["steer", "followUp"]);
    await before.tasks.close();

    // 저장소는 그대로 두고 서비스만 새로 만든다
    const after = restart(before);
    expect(unwrapped(after.tasks.inputs.peek(after.threadId))).toEqual(expected);
    // 복원된 입력만으로는 turn이 열리지 않는다. 다음 배치 지점에서 고른다
    expect(after.session.commitCalls).toBe(before.session.commitCalls);
    expect(viewSelection(after, "turnStart").inputs.map((input) => input.requestId)).toEqual([
      "r-steer",
    ]);
  });

  test("a restarted service sees an old duplicate without writing", async () => {
    const before = createWorld();
    await mustEnqueue(before, userDraft(before.threadId, "r1"));
    const after = restart(before);
    const again = await after.tasks.inputs.enqueue(userDraft(after.threadId, "r1"));
    expect(again.ok && again.value).toMatchObject({ duplicate: true, state: "queued" });
    expect(after.session.events.length).toBe(1);
  });
});

describe("peek", () => {
  test("peek filters by mode and keeps seq order", async () => {
    const world = createWorld();
    await enqueueAll(world, [
      userDraft(world.threadId, "a", { mode: "followUp" }),
      userDraft(world.threadId, "b"),
      userDraft(world.threadId, "c", { mode: "followUp" }),
    ]);
    const { inputs } = world.tasks;
    expect(unwrapped(inputs.peek(world.threadId)).map((input) => input.requestId)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(
      unwrapped(inputs.peek(world.threadId, ["followUp"])).map((input) => input.requestId),
    ).toEqual(["a", "c"]);
    expect(unwrapped(inputs.peek(world.threadId, ["next"]))).toEqual([]);
    const seqs = unwrapped(inputs.peek(world.threadId)).map((input) => input.seq);
    expect(seqs).toEqual([...seqs].toSorted((x, y) => x - y));
  });

  test("an input whose event payload is broken is skipped and logged", async () => {
    const world = createWorld();
    await mustEnqueue(world, userDraft(world.threadId, "ok"));
    const [event] = world.session.events;
    if (event === undefined) throw new Bug("missing event");
    Reflect.set(event, "payload", { mode: "steer" });
    expect(unwrapped(world.tasks.inputs.peek(world.threadId))).toEqual([]);
    expect(world.log.records.map((record) => record.event)).toEqual([
      "tasks.queued_payload_invalid",
    ]);
  });
});

describe("detached payloads", () => {
  test("an input with a detached field is not handed out, and is logged", async () => {
    const world = createWorld();
    await mustEnqueue(world, userDraft(world.threadId, "big"));
    const [event] = world.session.events;
    if (event === undefined) throw new Bug("missing event");
    Reflect.set(event, "detached", [
      {
        pointer: "/item/content",
        ref: { type: "blob", sha256: "a".repeat(64), size: 10, mediaType: null },
      },
    ]);
    expect(unwrapped(world.tasks.inputs.peek(world.threadId))).toEqual([]);
    expect(viewSelection(world, "stepEnd").inputs).toEqual([]);
    expect(world.log.records.map((record) => record.event)).toEqual([
      "tasks.queued_input_detached",
      "tasks.queued_input_detached",
    ]);
  });
});

describe("drain", () => {
  test("steer_vs_followup_drain_order", async () => {
    const world = await seeded();
    // stepEnd, one-at-a-time: 첫 steer 하나만. followUp은 고르지 않는다
    expect(names(viewSelection(world, "stepEnd"))).toEqual(["s1"]);
    expect(names(viewSelection(world, "stepEnd", true))).toEqual(["s1"]);

    // stepEnd, all: steer 전부, followUp은 고르지 않는다
    const all = await seeded({ settings: { steeringMode: "all" } });
    expect(names(viewSelection(all, "stepEnd"))).toEqual(["s1", "s2"]);

    // turnStart: 가장 오래된 시작 가능 입력 하나(steer 또는 followUp, seq 순)
    expect(names(viewSelection(world, "turnStart"))).toEqual(["s1"]);
  });

  test("turnStart takes the oldest startable input, and followUpMode all bundles every followUp", async () => {
    const world = createWorld();
    await mustEnqueue(world, userDraft(world.threadId, "f1", { mode: "followUp" }));
    await mustEnqueue(world, userDraft(world.threadId, "s1"));
    await mustEnqueue(world, userDraft(world.threadId, "f2", { mode: "followUp" }));
    expect(names(viewSelection(world, "turnStart"))).toEqual(["f1"]);

    const bundled = createWorld({ settings: { followUpMode: "all" } });
    await mustEnqueue(bundled, userDraft(bundled.threadId, "f1", { mode: "followUp" }));
    await mustEnqueue(bundled, userDraft(bundled.threadId, "s1"));
    await mustEnqueue(bundled, userDraft(bundled.threadId, "f2", { mode: "followUp" }));
    expect(names(viewSelection(bundled, "turnStart"))).toEqual(["f1", "f2"]);
    // 가장 오래된 입력이 steer이면 steer 하나다
    const steerFirst = createWorld({ settings: { followUpMode: "all" } });
    await mustEnqueue(steerFirst, userDraft(steerFirst.threadId, "s1"));
    await mustEnqueue(steerFirst, userDraft(steerFirst.threadId, "f1", { mode: "followUp" }));
    expect(names(viewSelection(steerFirst, "turnStart"))).toEqual(["s1"]);
  });

  test("the drain mode is read at every placement point", async () => {
    const mode: { steering: DrainMode } = { steering: "one-at-a-time" };
    const world = createWorld({
      settingsSource: { ...createStaticTasksSettings(), steeringMode: () => mode.steering },
    });
    await enqueueAll(world, [userDraft(world.threadId, "s1"), userDraft(world.threadId, "s2")]);
    expect(names(viewSelection(world, "stepEnd"))).toEqual(["s1"]);
    // 설정이 바뀌면 다음 배치 지점부터 적용된다
    mode.steering = "all";
    expect(names(viewSelection(world, "stepEnd"))).toEqual(["s1", "s2"]);
  });

  test("drain_consumed_seq_matches_selection", async () => {
    const world = await seeded({ settings: { steeringMode: "all" } });
    const selection = viewSelection(world, "stepEnd");
    expect(selection.inputs.map((input) => input.seq)).toEqual([1, 3]);
    expect(selection.consumedSeq).toBe(3);

    // 선택이 없으면 직전 값(체크포인트의 consumedSeq)이다
    const empty = createWorld();
    expect(viewSelection(empty, "stepEnd").consumedSeq).toBe(0);
    empty.session.setConsumedSeq(empty.threadId, 9);
    expect(viewSelection(empty, "stepEnd").consumedSeq).toBe(9);
    // 줄어들지 않는다
    await mustEnqueue(empty, userDraft(empty.threadId, "late"));
    expect(viewSelection(empty, "stepEnd").consumedSeq).toBe(9);
  });

  test("drain is pure: it selects without changing the queue", async () => {
    const world = await seeded();
    const before = world.session.events.length;
    viewSelection(world, "stepEnd");
    viewSelection(world, "turnStart");
    expect(world.session.events.length).toBe(before);
    expect(unwrapped(world.tasks.inputs.peek(world.threadId)).length).toBe(4);
  });

  test("placing the selection removes it from the queue and writes input.placed", async () => {
    const world = await seeded();
    const placed = placeAt(world, "stepEnd", "step:t:0:end");
    const events = world.session.events.filter((event) => event.kind === "input.placed");
    expect(events.length).toBe(1);
    expect(events[0]?.payload).toEqual({
      inputId: placed.selection.inputs[0]?.inputId,
      itemId: placed.itemIds[0],
    });
    expect(events[0]?.turnId).toBe(placed.turnId);
    expect(events[0]?.causationId).toBe(placed.selection.inputs[0]?.inputId);
    expect(
      unwrapped(world.tasks.inputs.peek(world.threadId)).map((input) => input.requestId),
    ).toEqual(["f1", "s2", "f2"]);
  });

  test("drafts refuses a placement for an input that was not selected", async () => {
    const world = await seeded();
    const selection = viewSelection(world, "stepEnd");
    expect(() =>
      selection.drafts([
        {
          inputId: world.ids.next("evt"),
          itemId: world.ids.next("itm"),
          turnId: world.ids.next("trn"),
        },
      ]),
    ).toThrow("tasks.unknown_placement");
  });

  test("a queued input behind the checkpoint cursor is still selected and logged once", async () => {
    const world = createWorld();
    await mustEnqueue(world, userDraft(world.threadId, "old"));
    world.session.setConsumedSeq(world.threadId, 5);
    expect(names(viewSelection(world, "stepEnd"))).toEqual(["old"]);
    expect(names(viewSelection(world, "stepEnd"))).toEqual(["old"]);
    expect(world.log.records.filter((r) => r.event === "tasks.queue_cursor_mismatch").length).toBe(
      1,
    );
  });
});

describe("withdraw", () => {
  test("withdraw_skips_placed_inputs", async () => {
    const world = createWorld();
    await mustEnqueue(world, userDraft(world.threadId, "a"));
    await mustEnqueue(world, userDraft(world.threadId, "b", { mode: "followUp" }));
    await mustEnqueue(world, userDraft(world.threadId, "c", { mode: "followUp" }));
    placeAt(world, "stepEnd", "step:t:0:end"); // a가 배치된다
    const result = await world.tasks.inputs.withdraw(world.threadId, "all", "user");
    // 배치된 입력은 거두지 않고 수에도 세지 않는다
    expect(result).toEqual({ ok: true, value: 2 });
    expect(unwrapped(world.tasks.inputs.peek(world.threadId))).toEqual([]);
    const withdrawn = world.session.events.filter((event) => event.kind === "input.withdrawn");
    expect(withdrawn.map((event) => event.payload)).toEqual([
      { inputId: enqueued(world, userDraft(world.threadId, "b")), reason: "user" },
      { inputId: enqueued(world, userDraft(world.threadId, "c")), reason: "user" },
    ]);
  });

  test("a single input can be withdrawn by id, and a placed one is not counted", async () => {
    const world = createWorld();
    const a = await mustEnqueue(world, userDraft(world.threadId, "a"));
    const b = await mustEnqueue(world, userDraft(world.threadId, "b"));
    expect(await world.tasks.inputs.withdraw(world.threadId, b, "superseded")).toEqual({
      ok: true,
      value: 1,
    });
    expect(
      unwrapped(world.tasks.inputs.peek(world.threadId)).map((input) => input.inputId),
    ).toEqual([a]);
    // 이미 거둔 입력과 모르는 id는 0
    expect(await world.tasks.inputs.withdraw(world.threadId, b, "user")).toEqual({
      ok: true,
      value: 0,
    });
    placeAt(world, "stepEnd", "step:t:0:end");
    expect(await world.tasks.inputs.withdraw(world.threadId, a, "user")).toEqual({
      ok: true,
      value: 0,
    });
  });

  test("a store failure during withdraw is returned with the count so far unwritten", async () => {
    const world = createWorld();
    await mustEnqueue(world, userDraft(world.threadId, "a"));
    world.session.failNext({ kind: "read_only", reason: "observer" });
    const result = await world.tasks.inputs.withdraw(world.threadId, "all", "aborted");
    expect(result).toEqual({ ok: false, error: { kind: "read_only", reason: "observer" } });
    expect(unwrapped(world.tasks.inputs.peek(world.threadId)).length).toBe(1);
  });
});

describe("notifications", () => {
  test("onQueued fires for every committed input.queued, including draftQueued in another commit", async () => {
    const world = createWorld();
    const seen: string[] = [];
    const off = world.tasks.inputs.onQueued((threadId) => {
      seen.push(threadId);
    });
    await mustEnqueue(world, userDraft(world.threadId, "a"));
    // 중복은 커밋하지 않으므로 알리지 않는다
    await mustEnqueue(world, userDraft(world.threadId, "a"));
    world.session.commit({
      threadId: world.threadId,
      requestId: "agent:x:settled",
      fingerprintSource: {},
      build: (view) => ({
        kind: "append",
        drafts: world.tasks.inputs.draftQueued(
          view,
          userDraft(world.threadId, "report", {
            source: { type: "delegation", childThreadId: world.ids.next("thr") },
          }),
        ).drafts,
        checkpoint: null,
      }),
    });
    expect(seen).toEqual([world.threadId, world.threadId]);
    off();
    await mustEnqueue(world, userDraft(world.threadId, "b"));
    expect(seen.length).toBe(2);
  });

  test("a throwing listener does not break the others and is logged", async () => {
    const world = createWorld();
    const seen: string[] = [];
    world.tasks.inputs.onQueued(() => {
      throw new Error("listener failed");
    });
    world.tasks.inputs.onQueued((threadId) => {
      seen.push(threadId);
    });
    await mustEnqueue(world, userDraft(world.threadId, "a"));
    expect(seen).toEqual([world.threadId]);
    expect(world.log.records.map((record) => record.event)).toEqual([
      "tasks.on_queued_listener_failed",
    ]);
  });

  test("a closed service stops listening to commits", async () => {
    const world = createWorld();
    const seen: string[] = [];
    world.tasks.inputs.onQueued((threadId) => {
      seen.push(threadId);
    });
    await world.tasks.close();
    await mustEnqueue(world, userDraft(world.threadId, "a"));
    expect(seen).toEqual([]);
  });
});

describe("read failures", () => {
  test("peek and withdraw return the read failure instead of throwing", async () => {
    const world = await seeded();
    world.session.failNextRead({ kind: "busy" });
    expect(world.tasks.inputs.peek(world.threadId)).toEqual({
      ok: false,
      error: { kind: "busy" },
    });
    // 실패는 한 번뿐이다. 다음 읽기는 입력을 돌려준다
    expect(unwrapped(world.tasks.inputs.peek(world.threadId)).length).toBe(4);

    world.session.failNextRead({ kind: "io", code: "SQLITE_IOERR" });
    expect(await world.tasks.inputs.withdraw(world.threadId, "all", "user")).toEqual({
      ok: false,
      error: { kind: "io", code: "SQLITE_IOERR" },
    });
    expect(unwrapped(world.tasks.inputs.peek(world.threadId)).length).toBe(4);
  });

  test("drain reports a failed event read and the commit aborts without recording a result", async () => {
    const world = await seeded();
    world.session.failNextRead({ kind: "row_invalid", where: "events.envelope" });
    const before = world.session.events.length;
    const request = {
      threadId: world.threadId,
      requestId: "place:read-fault",
      fingerprintSource: { key: "place:read-fault" },
      build: (view: Parameters<typeof world.tasks.inputs.drain>[0]) => {
        const drained = world.tasks.inputs.drain(view, world.threadId, "turnStart", {
          continuing: false,
        });
        if (!drained.ok) return { kind: "abort", error: drained.error } as const;
        return { kind: "reject", code: "unexpected", detail: null } as const;
      },
    };
    expect(world.session.commit(request)).toEqual({
      ok: false,
      error: { kind: "row_invalid", where: "events.envelope" },
    });
    expect(world.session.events.length).toBe(before);
    // 결과가 남지 않았으므로 같은 키로 다시 낼 수 있다
    const retried = world.session.commit({
      ...request,
      build: (view) => {
        const drained = world.tasks.inputs.drain(view, world.threadId, "turnStart", {
          continuing: false,
        });
        return drained.ok
          ? { kind: "reject", code: "viewed", detail: String(drained.value.inputs.length) }
          : { kind: "abort", error: drained.error };
      },
    });
    expect(retried).toMatchObject({ ok: true, value: { status: "rejected", code: "viewed" } });
  });

  test("a duplicate enqueue reports a read failure while resolving the stored input", async () => {
    const world = createWorld();
    await mustEnqueue(world, userDraft(world.threadId, "dup"));
    world.session.failNextRead({ kind: "busy" });
    const again = await world.tasks.inputs.enqueue(userDraft(world.threadId, "dup"));
    expect(again).toEqual({ ok: false, error: { kind: "busy" } });
    const third = await world.tasks.inputs.enqueue(userDraft(world.threadId, "dup"));
    expect(third).toMatchObject({ ok: true, value: { duplicate: true, state: "queued" } });
  });
});

describe("next and aside placement (D7: attach only)", () => {
  const ext = { type: "extension", scopeId: "helm" } as const;

  // spec plan next_attached_only_when_continuing
  test("next_attached_only_when_continuing: stepEnd takes next and aside only when a request follows", async () => {
    const world = createWorld();
    await enqueueAll(world, [
      userDraft(world.threadId, "n1", { mode: "next", source: ext }),
      userDraft(world.threadId, "as", { mode: "aside" }),
      userDraft(world.threadId, "n2", { mode: "next", source: ext }),
    ]);
    // 요청이 이어지지 않으면 남긴다
    expect(names(viewSelection(world, "stepEnd", false))).toEqual([]);
    // 요청이 이어지면 전부 seq 순서로 함께 고른다
    expect(names(viewSelection(world, "stepEnd", true))).toEqual(["n1", "as", "n2"]);
  });

  test("a selected steer guarantees a request, so next and aside ride along without continuing", async () => {
    const world = createWorld();
    await enqueueAll(world, [
      userDraft(world.threadId, "n1", { mode: "next", source: ext }),
      userDraft(world.threadId, "s1"),
      userDraft(world.threadId, "n2", { mode: "next", source: ext }),
    ]);
    const selection = viewSelection(world, "stepEnd", false);
    expect(names(selection)).toEqual(["n1", "s1", "n2"]);
    // consumedSeq는 고른 입력 중 가장 큰 seq다
    expect(selection.consumedSeq).toBe(Math.max(...selection.inputs.map((input) => input.seq)));
  });

  test("an idle thread does not start from next or aside: turnStart picks nothing without a steer or followUp", async () => {
    const world = createWorld();
    await enqueueAll(world, [
      userDraft(world.threadId, "n1", { mode: "next", source: ext }),
      userDraft(world.threadId, "as", { mode: "aside" }),
    ]);
    expect(names(viewSelection(world, "turnStart"))).toEqual([]);
    expect(unwrapped(world.tasks.inputs.peek(world.threadId)).map((i) => i.requestId)).toEqual([
      "n1",
      "as",
    ]);
  });

  test("turnStart attaches only the next and aside that are older than the chosen start input", async () => {
    const world = createWorld();
    await enqueueAll(world, [
      userDraft(world.threadId, "n-old", { mode: "next", source: ext }),
      userDraft(world.threadId, "f1", { mode: "followUp" }),
      userDraft(world.threadId, "n-new", { mode: "next", source: ext }),
    ]);
    expect(names(viewSelection(world, "turnStart"))).toEqual(["n-old", "f1"]);
  });

  test("with followUpMode all the attached ones are older than the last chosen followUp", async () => {
    const world = createWorld({ settings: { followUpMode: "all" } });
    await enqueueAll(world, [
      userDraft(world.threadId, "f1", { mode: "followUp" }),
      userDraft(world.threadId, "n1", { mode: "next", source: ext }),
      userDraft(world.threadId, "f2", { mode: "followUp" }),
      userDraft(world.threadId, "n2", { mode: "next", source: ext }),
    ]);
    expect(names(viewSelection(world, "turnStart"))).toEqual(["f1", "n1", "f2"]);
  });

  test("onQueued fires for steer and followUp only: next and aside never start a request", async () => {
    const world = createWorld();
    const seen: string[] = [];
    world.tasks.inputs.onQueued((threadId) => {
      seen.push(threadId);
    });
    await enqueueAll(world, [
      userDraft(world.threadId, "n1", { mode: "next", source: ext }),
      userDraft(world.threadId, "as", { mode: "aside" }),
    ]);
    expect(seen).toEqual([]);
    await enqueueAll(world, [userDraft(world.threadId, "s1")]);
    expect(seen).toEqual([world.threadId]);
  });

  test("placed next and aside leave the queue and the placement drafts use the chosen input ids", async () => {
    const world = createWorld();
    await enqueueAll(world, [
      userDraft(world.threadId, "s1"),
      userDraft(world.threadId, "n1", { mode: "next", source: ext }),
    ]);
    const selection = viewSelection(world, "stepEnd", false);
    expect(names(selection)).toEqual(["s1", "n1"]);
    const turnId = world.ids.next("trn");
    const drafts = selection.drafts(
      selection.inputs.map((input) => ({
        inputId: input.inputId,
        itemId: world.ids.next("itm"),
        turnId,
      })),
    );
    expect(drafts.map((entry) => entry.draft.kind)).toEqual(["input.placed", "input.placed"]);
  });
});
