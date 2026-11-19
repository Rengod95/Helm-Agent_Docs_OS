import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { DraftMark } from "@fresnel/contracts/services";
import { Type } from "typebox";
import type { ToolExposure } from "../src/deps.ts";
import {
  callTool,
  createHarness,
  expectOk,
  layer,
  textOf,
  until,
  type Harness,
} from "./support/harness.ts";

// L1.tools.spec §3.3.1 [결정: 2026-11-19, 사용자, AGE-56]: 대화별 도구 이름과 가시성.
// 승인본(`ok-ext`)과 드래프트(`draft-ext`)가 같은 이름 `check`를 요청해도 한 표에 함께 있고, 대화마다 자기 쪽만 같은 이름으로 보인다.

const DRAFTS: ReadonlyMap<string, DraftMark> = new Map([
  ["draft-ext", { plugin: "ok-ext", draftId: "d-7" }],
]);
const BYPASS = layer("user", { "l1.tools.permissionMode": "bypass" });

/** 대화 id → 그 대화가 실은 (주인 → 노출 이름 표). 표에 없는 주인은 그 대화에 보이지 않는다 */
function exposureTable(table: ReadonlyMap<ThreadId, ReadonlyMap<string, string>>) {
  return (threadId: ThreadId | null): ToolExposure | undefined => {
    if (threadId === null) return undefined;
    const mine = table.get(threadId) ?? new Map<string, string>();
    return { nameOf: (owner) => mine.get(owner) ?? null };
  };
}

function register(h: Harness, owner: string, answer: string): { calls: number } {
  const probe = { calls: 0 };
  expectOk(
    h.runtime.tools.register(
      owner,
      {
        name: "check",
        description: `check from ${owner}`,
        parameters: Type.Object({}),
        replay: "safe",
        execute: () => {
          probe.calls += 1;
          return Promise.resolve(answer);
        },
      },
      { perThread: true },
    ),
  );
  return probe;
}

async function names(h: Harness, threadId: ThreadId): Promise<string[]> {
  const listed = expectOk(
    await h.runtime.tools.advertise({ run: h.run({ threadId }), activated: new Set() }),
  );
  return listed.tools.map((tool) => tool.name).filter((name) => name !== "tool_search");
}

test("two owners can register the same requested name; the same owner twice is a name_conflict", async () => {
  const h = await createHarness();
  register(h, "ok-ext", "approved");
  register(h, "draft-ext", "draft");
  const again = h.runtime.tools.register(
    "ok-ext",
    {
      name: "check",
      description: "d",
      parameters: Type.Object({}),
      replay: "safe",
      execute: () => Promise.resolve("x"),
    },
    { perThread: true },
  );
  expect(again.ok).toBe(false);
  if (!again.ok) expect(again.error).toEqual({ kind: "name_conflict", toolName: "check" });
});

test("a global name still conflicts: a non-perThread tool cannot reuse a name another global tool holds", async () => {
  const h = await createHarness();
  const def = {
    name: "shared",
    description: "d",
    parameters: Type.Object({}),
    replay: "safe" as const,
    execute: () => Promise.resolve("x"),
  };
  expectOk(h.runtime.tools.register("a-ext", def));
  const second = h.runtime.tools.register("b-ext", def);
  expect(second.ok).toBe(false);
});

test("each conversation advertises only its own plugins' tools, under the name that conversation sees", async () => {
  const ids = new Map<ThreadId, ReadonlyMap<string, string>>();
  const h = await createHarness({
    draftOf: (scope) => DRAFTS.get(scope),
    exposureOf: exposureTable(ids),
  });
  const other = h.ids.next("thr");
  const third = h.ids.next("thr");
  ids.set(h.thread, new Map([["ok-ext", "check"]]));
  ids.set(other, new Map([["draft-ext", "check"]]));
  ids.set(third, new Map([["ok-ext", "ok-ext__check"]]));
  register(h, "ok-ext", "approved");
  register(h, "draft-ext", "draft");
  expect(await names(h, h.thread)).toEqual(["check"]);
  expect(await names(h, other)).toEqual(["check"]);
  expect(await names(h, third)).toEqual(["ok-ext__check"]);
  const fourth = h.ids.next("thr");
  expect(await names(h, fourth)).toEqual([]);
});

test("a call reaches the owner that conversation loaded: the same name runs the approved tool in one conversation and the draft in another", async () => {
  const ids = new Map<ThreadId, ReadonlyMap<string, string>>();
  const h = await createHarness({
    draftOf: (scope) => DRAFTS.get(scope),
    exposureOf: exposureTable(ids),
    layers: [BYPASS],
  });
  const other = h.ids.next("thr");
  ids.set(h.thread, new Map([["ok-ext", "check"]]));
  ids.set(other, new Map([["draft-ext", "check"]]));
  const approved = register(h, "ok-ext", "approved");
  const draft = register(h, "draft-ext", "draft");

  const first = await callTool(h.runtime.tools, h.run(), { id: "a1", name: "check", args: {} });
  expect(first.blocked).toBeUndefined();
  expect(textOf(first.result)).toContain("approved");
  expect([approved.calls, draft.calls]).toEqual([1, 0]);

  // 드래프트 호출은 bypass에서도 카드가 뜬다. 카드를 허용하면 드래프트 쪽이 돈다
  const pending = callTool(h.runtime.tools, h.run({ threadId: other }), {
    id: "b1",
    name: "check",
    args: {},
  });
  await until(() => h.runtime.approvals.pending(other).length === 1);
  const [card] = h.runtime.approvals.pending(other);
  expect(card?.body).toMatchObject({ kind: "tool", tool: { toolName: "check" } });
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "allow" });
  const second = await pending;
  expect(textOf(second.result)).toContain("draft");
  expect([approved.calls, draft.calls]).toEqual([1, 1]);
});

test("negative: a conversation that did not load a plugin cannot call its tool by name", async () => {
  const ids = new Map<ThreadId, ReadonlyMap<string, string>>();
  const h = await createHarness({
    draftOf: (scope) => DRAFTS.get(scope),
    exposureOf: exposureTable(ids),
    layers: [BYPASS],
  });
  const other = h.ids.next("thr");
  ids.set(h.thread, new Map([["ok-ext", "check"]]));
  ids.set(other, new Map());
  const approved = register(h, "ok-ext", "approved");
  const draft = register(h, "draft-ext", "draft");
  const blocked = await callTool(h.runtime.tools, h.run({ threadId: other }), {
    id: "n1",
    name: "check",
    args: {},
  });
  expect(blocked.blocked).toContain("tool_unavailable");
  // 다른 대화의 정식 이름으로도 닿지 않는다
  const qualified = await callTool(h.runtime.tools, h.run({ threadId: other }), {
    id: "n2",
    name: "ok-ext__check",
    args: {},
  });
  expect(qualified.blocked).toContain("tool_unavailable");
  expect([approved.calls, draft.calls]).toEqual([0, 0]);
});

test("negative: an allow rule written for the reviewed tool does not let the draft's same-named call skip its card; the card carries the draft mark", async () => {
  const ids = new Map<ThreadId, ReadonlyMap<string, string>>();
  const h = await createHarness({
    draftOf: (scope) => DRAFTS.get(scope),
    exposureOf: exposureTable(ids),
    layers: [
      layer("user", {
        "l1.tools.permissionMode": "default",
        "l1.tools.rules": [
          {
            id: "u.allow-check",
            action: "tool.call",
            resource: { tool: "check" },
            effect: "allow",
          },
        ],
      }),
    ],
  });
  const other = h.ids.next("thr");
  ids.set(h.thread, new Map([["ok-ext", "check"]]));
  ids.set(other, new Map([["draft-ext", "check"]]));
  const approved = register(h, "ok-ext", "approved");
  const draft = register(h, "draft-ext", "draft");

  const reviewed = await callTool(h.runtime.tools, h.run(), { id: "r1", name: "check", args: {} });
  expect(reviewed.blocked).toBeUndefined();
  expect(approved.calls).toBe(1);
  expect(h.runtime.approvals.pending(h.thread)).toEqual([]);

  const pending = callTool(h.runtime.tools, h.run({ threadId: other }), {
    id: "r2",
    name: "check",
    args: {},
  });
  await until(() => h.runtime.approvals.pending(other).length === 1);
  expect(draft.calls).toBe(0);
  const [card] = h.runtime.approvals.pending(other);
  expect(card?.body).toMatchObject({
    kind: "tool",
    tool: { toolName: "check", draft: { plugin: "ok-ext", draftId: "d-7" } },
  });
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "deny" });
  await pending;
  expect(draft.calls).toBe(0);
});

test("without an exposure rule, perThread tools are visible under the name they asked for (hosts that do not scope names)", async () => {
  const h = await createHarness({ layers: [BYPASS] });
  register(h, "ok-ext", "approved");
  expect(await names(h, h.thread)).toEqual(["check"]);
  const ran = await callTool(h.runtime.tools, h.run(), { id: "z1", name: "check", args: {} });
  expect(textOf(ran.result)).toContain("approved");
});

function toolDef(name: string) {
  return {
    name,
    description: "d",
    parameters: Type.Object({}),
    replay: "safe" as const,
    execute: () => Promise.resolve("x"),
  };
}

test("a perThread tool cannot take a name a global tool already holds, and a global tool cannot take a name a perThread tool asked for", async () => {
  const h = await createHarness();
  expectOk(h.runtime.tools.register("a-ext", toolDef("held")));
  const scopedSecond = h.runtime.tools.register("b-ext", toolDef("held"), { perThread: true });
  expect(scopedSecond.ok).toBe(false);
  if (!scopedSecond.ok)
    expect(scopedSecond.error).toEqual({ kind: "name_conflict", toolName: "held" });
  expectOk(h.runtime.tools.register("c-ext", toolDef("asked"), { perThread: true }));
  const globalSecond = h.runtime.tools.register("d-ext", toolDef("asked"));
  expect(globalSecond.ok).toBe(false);
});
