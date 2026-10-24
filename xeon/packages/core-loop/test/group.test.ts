import { expect, test } from "bun:test";
import { createHarness, type Harness } from "./support/harness.ts";
import { countKind, kindsOf, payloadField } from "./support/inspect.ts";
import { createTestGroup, TEST_GROUP_ID, TEST_NOTE_KIND } from "./support/test-group.ts";
import type { ScriptedResponse } from "./support/fake-models.ts";

const read = (id: string): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "toolCall", id, name: "read", arguments: {} }],
  stopReason: "toolUse",
});
const answer = (value: string): ScriptedResponse => ({
  kind: "message",
  content: [{ type: "text", text: value }],
  stopReason: "stop",
});

/** 한 단계의 T4 커밋이 담은 이벤트 종류 */
function stepEndKinds(h: Harness, stepIndex: number): string[] {
  const events = h.fake.events(h.threadId);
  const keys = h.fake.commitKeys(h.threadId);
  const suffix = `:${stepIndex}:end`;
  return events.flatMap((event, index) =>
    (keys[index] ?? "").endsWith(suffix) ? [event.kind] : [],
  );
}

test("group_on_post_and_scope_walk_through_a_turn_with_the_loop", async () => {
  const h = await createHarness({
    tools: [{ name: "read" }],
    script: [read("c1"), answer("first done"), answer("follow up done")],
  });
  const group = createTestGroup({ ids: h.host.ids, postFollowUp: true });
  const installed = await h.host.host.install(group.unit);
  expect(installed.entryError).toBeUndefined();
  await h.host.settled();

  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();

  const events = h.fake.events(h.threadId);
  // on: turn_end 핸들러가 단계 경계마다 불리고 엔트리가 T4 커밋에 들어간다
  expect(group.probe.turnEnds.length).toBeGreaterThanOrEqual(2);
  expect(stepEndKinds(h, 0)).toContain(TEST_NOTE_KIND);
  // post: followUp은 첫 turn이 정착한 뒤 새 turn의 입력이 된다
  expect(countKind(events, "turn.started")).toBe(2);
  const inputs = events.filter((event) => event.kind === "input.queued");
  expect(inputs.map((event) => payloadField(event, "source"))).toContainEqual({
    type: "extension",
    scopeId: TEST_GROUP_ID,
  });
  expect(h.models.requests.at(-1)?.messages.at(-1)).toMatchObject({ content: "group follow up" });
});

test("scope_toggles_apply_at_the_step_boundary_not_mid_step", async () => {
  const state: { h: Harness | null } = { h: null };
  const h = await createHarness({
    tools: [
      {
        name: "read",
        run: () => {
          // 단계 0 안에서 켜기를 요청한다. 적용은 그 단계의 경계다
          state.h?.host.host.scope(TEST_GROUP_ID)?.enable();
          return Promise.resolve({ text: "A" });
        },
      },
      {
        name: "ls",
        run: () => {
          // 단계 1 안에서 끄기를 요청한다
          state.h?.host.host.scope(TEST_GROUP_ID)?.disable();
          return Promise.resolve({ text: "B" });
        },
      },
    ],
    script: [
      read("c1"),
      {
        kind: "message",
        content: [{ type: "toolCall", id: "c2", name: "ls", arguments: {} }],
        stopReason: "toolUse",
      },
      answer("done"),
    ],
  });
  state.h = h;
  const group = createTestGroup({ ids: h.host.ids, enabled: false });
  await h.host.host.install(group.unit);
  await h.host.settled();

  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();

  const step0 = stepEndKinds(h, 0);
  const step1 = stepEndKinds(h, 1);
  const step2 = stepEndKinds(h, 2);
  // 단계 0의 경계에서 켜지고, 그 경계의 turn_end 핸들러는 아직 목록에 없다(스냅샷)
  expect(step0).toContain("scope.changed");
  expect(step0).not.toContain(TEST_NOTE_KIND);
  // 단계 1의 turn_end에는 핸들러가 있다. 이 단계 안에서 끄기를 요청했고 경계에서 적용된다
  expect(step1).toContain(TEST_NOTE_KIND);
  expect(step1).toContain("scope.changed");
  // 단계 2에는 핸들러가 없다
  expect(step2).not.toContain(TEST_NOTE_KIND);
  expect(group.probe.turnEnds).toHaveLength(1);
  const changes = h.fake
    .events(h.threadId)
    .filter((event) => event.kind === "scope.changed")
    .map((event) => payloadField(event, "status"));
  expect(changes).toEqual(["enabled", "disabled"]);
});

test("drive_group_gets_a_lease_at_a_boundary_and_runs_a_turn_after_the_user_turn_settles", async () => {
  const state: { h: Harness | null } = { h: null };
  const h = await createHarness({
    tools: [
      {
        name: "read",
        run: () => {
          // 단계 0 안에서 그룹을 켠다. 켜기와 drive 임대는 그 단계의 경계에서 적용된다
          state.h?.host.host.scope(TEST_GROUP_ID)?.enable();
          return Promise.resolve({ text: "A" });
        },
      },
    ],
    script: [read("c1"), answer("user turn done"), answer("drive turn done")],
  });
  state.h = h;
  const group = createTestGroup({ ids: h.host.ids, driveTurns: 1, enabled: false });
  await h.host.host.install(group.unit);
  await h.host.settled();

  await h.loop.admit({ threadId: h.threadId, content: "go", via: "interactive" });
  await h.settle();
  await h.host.settled();
  await h.settle();

  const events = h.fake.events(h.threadId);
  const kinds = kindsOf(events);
  // 켜기와 임대 부여는 단계 0의 T4 커밋 안에 있다
  expect(stepEndKinds(h, 0).slice(0, 4)).toEqual([
    "step.completed",
    "scope.changed",
    "lease.acquired",
    "checkpoint.step",
  ]);
  // drive 함수는 turn이 정착한 뒤 loop.turn을 불러 임대 scope의 turn을 연다
  const started = events.filter((event) => event.kind === "turn.started");
  expect(started).toHaveLength(2);
  const driveStart = started[1];
  expect(driveStart === undefined ? null : payloadField(driveStart, "scopeId")).toBe(TEST_GROUP_ID);
  const driveStartIndex = events.findIndex(
    (event) => event.kind === "turn.started" && payloadField(event, "scopeId") === TEST_GROUP_ID,
  );
  expect(kinds.indexOf("turn.completed")).toBeLessThan(driveStartIndex);
  expect(group.probe.driveCalls).toBe(1);
  expect(countKind(events, "turn.completed")).toBe(2);
  expect(new Set(started.map((event) => event.turnId)).size).toBe(2);
});
