import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { canonicalJson, parse } from "@fresnel/contracts";
import { WorkspaceFiles, WorkspaceFilesKey } from "@fresnel/contracts/capabilities";
import type { JsonValue } from "@fresnel/contracts/conversation";
import { ApprovalRequestedPayloadSchema, EffectIntentSchema } from "@fresnel/contracts/records";
import type { DraftMark, PluginCallRequest } from "@fresnel/contracts/services";
import { Type } from "typebox";
import {
  callTool,
  createHarness,
  EDITED_FILE_CHANGE,
  expectOk,
  layer,
  until,
  type Harness,
} from "./support/harness.ts";

// L1.tools.spec §4.6.1 [결정: 2026-11-17 사용자, U2]: 초안 출신 호출은 모드·allow 규칙·위험 등급과 무관하게 항상 묻고, 카드에 초안 표지를 단다.
// 거부 규칙은 그대로 막고, 상속 승인은 물려주지 않는다. 답할 사람이 없으면 묻지 않고 거부한다(검토된 호출은 그대로다).

const DRAFTS: ReadonlyMap<string, DraftMark> = new Map([
  ["draft-ext", { plugin: "draft-ext", draftId: "d-7" }],
  ["draft-plug", { plugin: "draft-plug", draftId: "d-8" }],
]);

function draftOf(scopeId: string): DraftMark | undefined {
  return DRAFTS.get(scopeId);
}

const BYPASS = layer("user", { "l1.tools.permissionMode": "bypass" });

/** 호출 횟수를 세는 도구를 등록한다. `owner`가 등록 스코프(초안이면 draftOf가 표지를 준다) */
function countingTool(h: Harness, owner: string, name: string): { calls: number } {
  const probe = { calls: 0 };
  expectOk(
    h.runtime.tools.register(owner, {
      name,
      description: `test tool ${name}`,
      parameters: Type.Object({}),
      replay: "safe",
      execute: () => {
        probe.calls += 1;
        return Promise.resolve("ok");
      },
    }),
  );
  return probe;
}

function toolCards(h: Harness, threadId = h.thread) {
  return h.runtime.approvals.pending(threadId).filter((request) => request.body.kind === "tool");
}

const EDIT_A = { path: "src/a.ts", edits: [{ oldText: "new a", newText: "old a" }] };

function digestOf(input: JsonValue): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

/** `workspace.files.edit`을 쓰기 위험으로 올린다. 호출 기록을 돌려준다 */
function registerEdit(h: Harness): { readonly calls: string[] } {
  const calls: string[] = [];
  h.apis.set(WorkspaceFiles.id, {
    edit: () => {
      calls.push("edit");
      return Promise.resolve({ applied: 1, matchMode: "exact", change: EDITED_FILE_CHANGE });
    },
  });
  expectOk(
    h.runtime.tools.register({
      kind: "capability",
      def: WorkspaceFiles,
      key: WorkspaceFilesKey,
      policy: { edit: { risk: "write" } },
    }),
  );
  return { calls };
}

/** 사람이 답한 검토 카드를 만들고 허용해 승인 id를 돌려준다. 카드가 가리키는 쓰기는 `EDIT_A`다 */
async function answeredReviewCard(h: Harness): Promise<string> {
  const opened = await h.runtime.approvals.open({
    origin: { threadId: h.thread, turnId: null, stepId: null, toolCallId: null, caller: "main" },
    requestKey: "draft-review",
    title: "Review the changes",
    body: {
      kind: "review",
      review: {
        reviewId: "rvw_01ARZ3NDEKTSV4RRFFQ69G5FAV",
        artifactId: "art_01ARZ3NDEKTSV4RRFFQ69G5FAV",
        title: "t",
        round: 1,
        files: [{ path: "src/a.ts", change: "modified", binary: false, hunks: 1 }],
        writes: [digestOf(EDIT_A)],
      },
    },
    remember: ["once"],
  });
  if (!opened.ok) throw new Error("the review card was not opened");
  const approvalId = opened.value.request.approvalId;
  const applied = await h.runtime.approvals.respond(approvalId, {
    decision: "answer",
    answer: { decisions: [{ hunkId: "f0h0", decision: "rejected" }], comments: [], submit: true },
  });
  expect(applied).toEqual({ applied: true });
  return approvalId;
}

/** 플러그인이 `workspace.files.edit`을 부르는 요청(스코프 id가 곧 플러그인 이름이다). 대화 id는 호출하는 쪽이 붙인다 */
function editFrom(
  scopeId: string,
  requestId: string,
  inheritApproval?: { approvalId: string },
): Omit<PluginCallRequest, "threadId"> {
  return {
    plugin: { name: scopeId, scopeId },
    via: "method",
    target: { kind: "capability", capability: WorkspaceFiles.id, method: "edit" },
    input: EDIT_A,
    requestId,
    ...(inheritApproval === undefined ? {} : { inheritApproval }),
  };
}

test("bypass: a tool owned by a draft asks with the draft mark, while the same tool from a reviewed owner runs with no card", async () => {
  const h = await createHarness({ draftOf, layers: [BYPASS] });
  const reviewed = countingTool(h, "ok-ext", "ok_tool");
  const draft = countingTool(h, "draft-ext", "draft_tool");

  // 대조: 검토된 호출은 bypass라서 카드 없이 돈다
  const control = await callTool(h.runtime.tools, h.run(), { id: "c1", name: "ok_tool", args: {} });
  expect(control.blocked).toBeUndefined();
  expect(reviewed.calls).toBe(1);
  expect(h.runtime.approvals.pending(h.thread)).toEqual([]);

  const done = callTool(h.runtime.tools, h.run(), { id: "d1", name: "draft_tool", args: {} });
  await until(() => toolCards(h).length === 1);
  const [card] = toolCards(h);
  expect(card?.body).toMatchObject({ kind: "tool", tool: { toolName: "draft_tool" } });
  expect(draft.calls).toBe(0);
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "allow" });
  expect((await done).blocked).toBeUndefined();
  expect(draft.calls).toBe(1);
});

test("an allow rule does not skip the card for a draft call, and a deny rule still denies it", async () => {
  const h = await createHarness({
    draftOf,
    layers: [
      layer("user", {
        "l1.tools.permissionMode": "default",
        "l1.tools.rules": [
          {
            id: "u.allow-draft",
            action: "tool.call",
            resource: { tool: "*_tool" },
            effect: "allow",
          },
          {
            id: "u.deny-draft",
            action: "tool.call",
            resource: { tool: "draft_denied" },
            effect: "deny",
          },
        ],
      }),
    ],
  });
  const reviewed = countingTool(h, "ok-ext", "ok_tool");
  const allowed = countingTool(h, "draft-ext", "draft_tool");
  const denied = countingTool(h, "draft-ext", "draft_denied");

  // 대조: 검토된 호출은 allow 규칙으로 카드 없이 돈다
  const control = await callTool(h.runtime.tools, h.run(), { id: "a0", name: "ok_tool", args: {} });
  expect(control.blocked).toBeUndefined();
  expect(reviewed.calls).toBe(1);
  expect(h.runtime.approvals.pending(h.thread)).toEqual([]);

  const done = callTool(h.runtime.tools, h.run(), { id: "a1", name: "draft_tool", args: {} });
  await until(() => toolCards(h).length === 1);
  const [card] = toolCards(h);
  // 카드의 사유는 허용 규칙이 아니다: 초안이 물은 것이라 규칙 id를 싣지 않는다
  expect(card?.body).toMatchObject({
    kind: "tool",
    tool: { toolName: "draft_tool", ruleId: null },
  });
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "allow" });
  await done;
  expect(allowed.calls).toBe(1);

  const out = await callTool(h.runtime.tools, h.run(), {
    id: "a2",
    name: "draft_denied",
    args: {},
  });
  expect(out.blocked).toContain("[fresnel:denied_by_policy]");
  expect(denied.calls).toBe(0);
  expect(toolCards(h)).toEqual([]);
});

test("a deny rule still denies a draft call under bypass, and no card opens", async () => {
  const h = await createHarness({
    draftOf,
    layers: [
      layer("user", {
        "l1.tools.permissionMode": "bypass",
        "l1.tools.rules": [
          {
            id: "u.deny-draft",
            action: "tool.call",
            resource: { tool: "draft_denied" },
            effect: "deny",
          },
        ],
      }),
    ],
  });
  const denied = countingTool(h, "draft-ext", "draft_denied");
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "b1",
    name: "draft_denied",
    args: {},
  });
  expect(out.blocked).toContain("[fresnel:denied_by_policy]");
  expect(denied.calls).toBe(0);
  expect(toolCards(h)).toEqual([]);
});

test("a plugin call from a draft plugin asks under bypass", async () => {
  const h = await createHarness({ draftOf, layers: [BYPASS] });
  const probe = registerEdit(h);
  const pending = h.runtime.tools.executeForPlugin({
    threadId: h.thread,
    ...editFrom("draft-plug", "draft-call-1"),
  });
  await until(() => toolCards(h).length === 1);
  const [card] = toolCards(h);
  expect(card?.origin.caller).toBe("plugin:draft-plug");
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "deny" });
  expect(await pending).toMatchObject({ ok: false, error: { kind: "denied" } });
  expect(probe.calls).toEqual([]);
});

test("a plugin call from a draft plugin still asks under bypass when it names a valid inherited approval", async () => {
  const h = await createHarness({ draftOf, layers: [BYPASS] });
  const probe = registerEdit(h);
  const approvalId = await answeredReviewCard(h);
  const pending = h.runtime.tools.executeForPlugin({
    threadId: h.thread,
    ...editFrom("draft-plug", "draft-call-2", { approvalId }),
  });
  await until(() => toolCards(h).length === 1);
  const [card] = toolCards(h);
  expect(card?.origin.caller).toBe("plugin:draft-plug");
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "allow" });
  expect(await pending).toMatchObject({ ok: true, value: { isError: false } });
  expect(probe.calls).toEqual(["edit"]);
  // 상속으로 건너뛰지 않았으므로 의도 기록에 상속 승인이 없다
  const intents = h.session.events.filter((event) => event.kind === "effect.intent");
  expect(intents).toHaveLength(1);
  const intent = parse(EffectIntentSchema, intents[0]?.payload);
  if (!intent.ok) throw new Error("the effect.intent of the draft call is unreadable");
  expect(intent.value.inheritedApproval).toBeUndefined();
});

test("the same valid inherited approval lets a reviewed plugin's write through with no card (control)", async () => {
  const h = await createHarness({
    layers: [layer("user", { "l1.tools.permissionMode": "default" })],
  });
  const probe = registerEdit(h);
  const approvalId = await answeredReviewCard(h);
  const result = await h.runtime.tools.executeForPlugin({
    threadId: h.thread,
    ...editFrom("ok-plug", "reviewed-call", { approvalId }),
  });
  expect(result).toMatchObject({ ok: true, value: { isError: false } });
  expect(toolCards(h)).toEqual([]);
  expect(probe.calls).toEqual(["edit"]);
});

test("a reviewed plugin calling a tool owned by a draft asks with the tool owner's mark", async () => {
  const h = await createHarness({ draftOf, layers: [BYPASS] });
  const draft = countingTool(h, "draft-ext", "draft_tool");
  const pending = h.runtime.tools.executeForPlugin({
    threadId: h.thread,
    plugin: { name: "ok-plug", scopeId: "ok-plug" },
    via: "tool",
    target: { kind: "tool", name: "draft_tool" },
    input: {},
    requestId: "tool-call-1",
  });
  await until(() => toolCards(h).length === 1);
  const [card] = toolCards(h);
  expect(card?.origin.caller).toBe("plugin:ok-plug");
  expect(card?.body.kind === "tool" ? card.body.tool.draft : undefined).toEqual({
    plugin: "draft-ext",
    draftId: "d-7",
  });
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "allow" });
  expect(await pending).toMatchObject({ ok: true });
  expect(draft.calls).toBe(1);
});

test("with no one to answer, a draft call is denied and never runs, even under bypass", async () => {
  // 시험 기본 무인 정책은 deny다: 사람이 없는 주 대화의 승인은 바로 거부한다
  const h = await createHarness({ draftOf, layers: [BYPASS] });
  const reviewed = countingTool(h, "ok-ext", "ok_tool");
  const draft = countingTool(h, "draft-ext", "draft_tool");

  const control = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "u0",
    name: "ok_tool",
    args: {},
  });
  expect(control.blocked).toBeUndefined();
  expect(reviewed.calls).toBe(1);

  const out = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "u1",
    name: "draft_tool",
    args: {},
  });
  expect(out.blocked).toContain("[fresnel:noninteractive_ask_denied]");
  expect(draft.calls).toBe(0);
  expect(toolCards(h)).toEqual([]);
});

test("unattended expire: a draft call opens a card and waits instead of running", async () => {
  const h = await createHarness({
    draftOf,
    layers: [BYPASS],
    unattended: { approval: "expire", timeoutSeconds: 60 },
  });
  const draft = countingTool(h, "draft-ext", "draft_tool");
  const done = callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "e1",
    name: "draft_tool",
    args: {},
  });
  await until(() => toolCards(h).length === 1);
  expect(draft.calls).toBe(0);
  const [card] = toolCards(h);
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "deny" });
  expect((await done).blocked).toBe("The user denied this tool call.");
  expect(draft.calls).toBe(0);
});

test("the card and the recorded approval.requested carry the draft mark as one value; a reviewed card carries none", async () => {
  const h = await createHarness({
    draftOf,
    layers: [layer("user", { "l1.tools.permissionMode": "default" })],
  });
  countingTool(h, "ok-ext", "ok_tool");
  countingTool(h, "draft-ext", "draft_tool");

  // 검토된 도구는 default 모드에서 exec이라 묻는다. 표지가 없어야 한다
  const reviewed = callTool(h.runtime.tools, h.run(), { id: "t1", name: "ok_tool", args: {} });
  await until(() => toolCards(h).length === 1);
  const [reviewedCard] = toolCards(h);
  expect(reviewedCard?.body.kind).toBe("tool");
  expect(reviewedCard?.body.kind === "tool" ? reviewedCard.body.tool.draft : "missing").toBe(
    undefined,
  );
  expect(reviewedCard?.title).not.toContain("Draft plugin");
  await h.runtime.approvals.respond(reviewedCard?.approvalId ?? "", { decision: "deny" });
  await reviewed;

  const draft = callTool(h.runtime.tools, h.run(), { id: "t2", name: "draft_tool", args: {} });
  await until(() => toolCards(h).length === 1);
  const [card] = toolCards(h);
  expect(card?.body.kind === "tool" ? card.body.tool.draft : undefined).toEqual({
    plugin: "draft-ext",
    draftId: "d-7",
  });
  // 표지 문장은 제목 앞에 온다(120자 잘림에도 남는다)
  expect(card?.title.startsWith('Draft plugin "draft-ext" asks.')).toBe(true);
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "allow" });
  await draft;

  // 기록된 approval.requested도 같은 값을 싣는다(스키마가 받는다)
  const requested = h.session.events.filter((event) => event.kind === "approval.requested");
  const parsed = requested.map((event) => parse(ApprovalRequestedPayloadSchema, event.payload));
  const drafted = parsed.find(
    (result) => result.ok && result.value.body.kind === "tool" && result.value.body.tool.draft,
  );
  if (drafted === undefined || !drafted.ok || drafted.value.body.kind !== "tool") {
    throw new Error("the draft card was not recorded as a tool approval with a draft mark");
  }
  expect(drafted.value.body.tool.draft).toEqual({ plugin: "draft-ext", draftId: "d-7" });
});
