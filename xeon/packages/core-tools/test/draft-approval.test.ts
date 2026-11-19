import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { canonicalJson, parse } from "@fresnel/contracts";
import {
  defineCapability,
  serviceKey,
  WorkspaceFiles,
  WorkspaceFilesKey,
} from "@fresnel/contracts/capabilities";
import type { JsonValue, ThreadId } from "@fresnel/contracts/conversation";
import type { ToolCallTraceEvent } from "@fresnel/contracts/extensions";
import { ApprovalRequestedPayloadSchema, EffectIntentSchema } from "@fresnel/contracts/records";
import type { DraftMark, PluginCallRequest } from "@fresnel/contracts/services";
import { Type } from "typebox";
import {
  callTool,
  createHarness,
  EDITED_FILE_CHANGE,
  expectOk,
  installHandlers,
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

// 초안 출신 호출은 읽기 수준이어도 카드를 지난다: 도구 매핑이 없는 readOnly 기능 메서드는 검토된 플러그인에는 파이프라인 항목이 없지만
// (가벼운 길로 간다) 초안에는 합성 항목을 주어 카드를 띄운다. 어떤 길로도 카드 없이 실행되지 않는다.

const PeekInput = Type.Object({ value: Type.String() });
const Peeker = defineCapability({
  id: "test.peeker",
  version: "1.0.0",
  description: "a capability with one readOnly method and no tool mapping",
  service: {
    methods: {
      peek: {
        description: "reads a value",
        input: PeekInput,
        output: Type.Object({ ok: Type.Boolean() }),
        replay: "safe",
        readOnly: true,
      },
    },
  },
  tools: [],
});

function peekFrom(h: Harness, scopeId: string, requestId: string): PluginCallRequest {
  return {
    threadId: h.thread,
    plugin: { name: scopeId, scopeId },
    via: "hook",
    target: { kind: "capability", capability: "test.peeker", method: "peek" },
    input: { value: "x" },
    requestId,
  };
}

test("a readOnly capability call from a draft plugin asks under bypass and runs only after the card is allowed", async () => {
  const h = await createHarness({ draftOf, layers: [BYPASS], capabilityDefs: [Peeker] });
  const peeks: string[] = [];
  h.apis.set(Peeker.id, {
    peek: (input: { value: string }) => {
      peeks.push(input.value);
      return Promise.resolve({ ok: true });
    },
  });
  h.runtime.tools.register({ kind: "capability", def: Peeker, key: serviceKey(Peeker) });
  const pending = h.runtime.tools.executeForPlugin(peekFrom(h, "draft-plug", "draft-peek-1"));
  await until(() => toolCards(h).length === 1);
  const [card] = toolCards(h);
  expect(card?.origin.caller).toBe("plugin:draft-plug");
  expect(card?.body.kind === "tool" ? card.body.tool.draft : undefined).toEqual({
    plugin: "draft-plug",
    draftId: "d-8",
  });
  expect(peeks).toEqual([]);
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "allow" });
  expect(await pending).toMatchObject({ ok: true, value: { isError: false } });
  expect(peeks).toEqual(["x"]);
});

test("a readOnly capability call from a draft plugin is denied when the card is denied, and the capability is not called", async () => {
  const h = await createHarness({ draftOf, layers: [BYPASS], capabilityDefs: [Peeker] });
  const peeks: string[] = [];
  h.apis.set(Peeker.id, {
    peek: (input: { value: string }) => {
      peeks.push(input.value);
      return Promise.resolve({ ok: true });
    },
  });
  h.runtime.tools.register({ kind: "capability", def: Peeker, key: serviceKey(Peeker) });
  const pending = h.runtime.tools.executeForPlugin(peekFrom(h, "draft-plug", "draft-peek-2"));
  await until(() => toolCards(h).length === 1);
  await h.runtime.approvals.respond(toolCards(h)[0]?.approvalId ?? "", { decision: "deny" });
  expect(await pending).toMatchObject({ ok: false, error: { kind: "denied" } });
  expect(peeks).toEqual([]);
});

test("the same readOnly capability call from a reviewed plugin has no pipeline entry (it takes the light path) and opens no card", async () => {
  const h = await createHarness({ draftOf, layers: [BYPASS], capabilityDefs: [Peeker] });
  h.apis.set(Peeker.id, { peek: () => Promise.resolve({ ok: true }) });
  h.runtime.tools.register({ kind: "capability", def: Peeker, key: serviceKey(Peeker) });
  const result = await h.runtime.tools.executeForPlugin(peekFrom(h, "ok-plug", "reviewed-peek"));
  expect(result).toMatchObject({ ok: false, error: { kind: "unavailable" } });
  expect(toolCards(h)).toEqual([]);
});

test("isDraftScope is true for a registration scope the draft lookup knows and false for any other", async () => {
  const h = await createHarness({ draftOf });
  expect(h.runtime.tools.isDraftScope?.("draft-plug")).toBe(true);
  expect(h.runtime.tools.isDraftScope?.("ok-plug")).toBe(false);
});

// 테스트 실행의 드래프트 승인 `auto`(L1.tools.spec §4.6.1 [결정: 2026-11-18 사용자, AGE-56]). 호출한 대화가 `auto`면 드래프트 판정(3번)과
// 승인 상속 금지(4번)만 건너뛴다. 모드, 규칙, 위험 등급, 비대화형 거부, 가드 Hook은 일반 대화와 같다. 같은 드래프트를 `auto`가 아닌 대화에서
// 부르면 여전히 카드다. `auto`는 대화 단위다: 등록 범위의 표지와 무관하게 호출한 대화의 값으로 정한다.

test("auto: a draft call in an auto thread runs with no card under bypass, and the same draft in another thread still asks with the draft mark", async () => {
  const autoThreads: ThreadId[] = [];
  const h = await createHarness({
    draftOf,
    layers: [BYPASS],
    draftAutoApproved: (threadId) => autoThreads.includes(threadId),
  });
  autoThreads.push(h.thread);
  const draft = countingTool(h, "draft-ext", "draft_tool");

  const auto = await callTool(h.runtime.tools, h.run(), {
    id: "au-1",
    name: "draft_tool",
    args: {},
  });
  expect(auto.blocked).toBeUndefined();
  expect(draft.calls).toBe(1);
  expect(toolCards(h)).toEqual([]);

  // 같은 드래프트 도구를 `auto`가 아닌 대화에서 부르면 드래프트 카드가 뜬다(bypass라 모드가 묻지 않으므로 카드는 드래프트 때문이다)
  const other = h.ids.next("thr");
  const pending = callTool(h.runtime.tools, h.run({ threadId: other }), {
    id: "au-2",
    name: "draft_tool",
    args: {},
  });
  await until(() => toolCards(h, other).length === 1);
  const [card] = toolCards(h, other);
  expect(card?.body.kind === "tool" ? card.body.tool.draft : undefined).toEqual({
    plugin: "draft-ext",
    draftId: "d-7",
  });
  expect(draft.calls).toBe(1);
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "allow" });
  expect((await pending).blocked).toBeUndefined();
  expect(draft.calls).toBe(2);
});

test("auto: the default mode's ask on a draft call is allowed with no card, and the trace records why", async () => {
  const autoThreads: ThreadId[] = [];
  const events: ToolCallTraceEvent[] = [];
  const h = await createHarness({
    draftOf,
    layers: [layer("user", { "l1.tools.permissionMode": "default" })],
    draftAutoApproved: (threadId) => autoThreads.includes(threadId),
    callTrace: {
      record: (event) => {
        events.push(event);
      },
    },
  });
  autoThreads.push(h.thread);
  const draft = countingTool(h, "draft-ext", "draft_tool");
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "mo-1",
    name: "draft_tool",
    args: {},
  });
  expect(out.blocked).toBeUndefined();
  expect(draft.calls).toBe(1);
  expect(toolCards(h)).toEqual([]);
  // 자동으로 허용한 호출은 정책 기록에 표지가 남고, 승인 기록은 없다(시크릿 사용 증거가 되지 않는다)
  expect(events.find((event) => event.toolCallId === "mo-1")).toMatchObject({
    verdict: "allowed",
    policy: { effect: "allow", tier: "auto_test_run" },
    approval: null,
  });
});

test("auto: a reviewed tool's mode ask is allowed in an auto thread, while the same call in another thread still asks", async () => {
  const autoThreads: ThreadId[] = [];
  const h = await createHarness({
    draftOf,
    layers: [layer("user", { "l1.tools.permissionMode": "default" })],
    draftAutoApproved: (threadId) => autoThreads.includes(threadId),
  });
  autoThreads.push(h.thread);
  const tool = countingTool(h, "reviewed-ext", "reviewed_exec");
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "rv-1",
    name: "reviewed_exec",
    args: {},
  });
  expect(out.blocked).toBeUndefined();
  expect(tool.calls).toBe(1);
  expect(toolCards(h)).toEqual([]);
  // 같은 호출이라도 auto가 아닌 대화는 묻는다(번지지 않는다)
  autoThreads.length = 0;
  const done = callTool(h.runtime.tools, h.run(), { id: "rv-2", name: "reviewed_exec", args: {} });
  await until(() => toolCards(h).length === 1);
  const [card] = toolCards(h);
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "deny" });
  expect((await done).blocked).toBe("The user denied this tool call.");
  expect(tool.calls).toBe(1);
});

test("auto: a user ask rule and a tool.call.before ask still open the card", async () => {
  const autoThreads: ThreadId[] = [];
  const h = await createHarness({
    draftOf,
    layers: [
      layer("user", {
        "l1.tools.permissionMode": "default",
        "l1.tools.rules": [
          { id: "u.ask", action: "tool.call", resource: { tool: "ask_tool" }, effect: "ask" },
        ],
      }),
    ],
    draftAutoApproved: (threadId) => autoThreads.includes(threadId),
  });
  autoThreads.push(h.thread);
  const asked = countingTool(h, "reviewed-ext", "ask_tool");
  const hooked = countingTool(h, "reviewed-ext", "hooked_tool");
  await installHandlers(h, "guard", ["tool.call.before"], (g) => {
    g.on("tool.call.before", (event) =>
      event.toolName === "hooked_tool" ? { ask: true, reason: "check the path" } : undefined,
    );
  });
  const first = callTool(h.runtime.tools, h.run(), { id: "ua-1", name: "ask_tool", args: {} });
  await until(() => toolCards(h).length === 1);
  const [card] = toolCards(h);
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "deny" });
  expect((await first).blocked).toBe("The user denied this tool call.");
  expect(asked.calls).toBe(0);
  const second = callTool(h.runtime.tools, h.run(), { id: "ua-2", name: "hooked_tool", args: {} });
  await until(() => toolCards(h).length === 1);
  const [hookCard] = toolCards(h);
  await h.runtime.approvals.respond(hookCard?.approvalId ?? "", { decision: "deny" });
  expect((await second).blocked).toBeDefined();
  expect(hooked.calls).toBe(0);
});

test("auto: a managed scope that sets the mode or forbids bypass wins over the auto thread", async () => {
  const autoThreads: ThreadId[] = [];
  const h = await createHarness({
    draftOf,
    layers: [
      layer("managed", { "l1.tools.bypassAllowed": false }),
      layer("user", { "l1.tools.permissionMode": "bypass" }),
    ],
    draftAutoApproved: (threadId) => autoThreads.includes(threadId),
  });
  autoThreads.push(h.thread);
  const tool = countingTool(h, "reviewed-ext", "managed_tool");
  const done = callTool(h.runtime.tools, h.run(), { id: "mg-1", name: "managed_tool", args: {} });
  await until(() => toolCards(h).length === 1);
  const [card] = toolCards(h);
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "deny" });
  expect((await done).blocked).toBe("The user denied this tool call.");
  expect(tool.calls).toBe(0);
});

test("auto: a deny rule still denies a draft call under bypass, and no card opens", async () => {
  const autoThreads: ThreadId[] = [];
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
    draftAutoApproved: (threadId) => autoThreads.includes(threadId),
  });
  autoThreads.push(h.thread);
  const denied = countingTool(h, "draft-ext", "draft_denied");
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "au-deny",
    name: "draft_denied",
    args: {},
  });
  expect(out.blocked).toContain("[fresnel:denied_by_policy]");
  expect(denied.calls).toBe(0);
  expect(toolCards(h)).toEqual([]);
});

test("auto: a tool.call.before block still stops a draft call with no card, and the trace names the blocking hook", async () => {
  const autoThreads: ThreadId[] = [];
  const events: ToolCallTraceEvent[] = [];
  const h = await createHarness({
    draftOf,
    layers: [BYPASS],
    draftAutoApproved: (threadId) => autoThreads.includes(threadId),
    callTrace: {
      record: (event) => {
        events.push(event);
      },
    },
  });
  autoThreads.push(h.thread);
  const draft = countingTool(h, "draft-ext", "draft_tool");
  await installHandlers(h, "guard", ["tool.call.before"], (g) => {
    g.on("tool.call.before", () => ({ block: true, reason: "no drafts today" }));
  });
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "au-guard",
    name: "draft_tool",
    args: {},
  });
  expect(out.blocked).toBe("[fresnel:denied_by_extension] no drafts today");
  expect(draft.calls).toBe(0);
  expect(toolCards(h)).toEqual([]);
  expect(events.find((event) => event.toolCallId === "au-guard")).toMatchObject({
    verdict: "blocked_hook",
    blockedBy: { plugin: "guard", hook: "tool.call.before" },
  });
});

test("auto: with no one to answer, a draft call that the default mode asks is denied and never runs", async () => {
  const autoThreads: ThreadId[] = [];
  const h = await createHarness({
    draftOf,
    layers: [layer("user", { "l1.tools.permissionMode": "default" })],
    draftAutoApproved: (threadId) => autoThreads.includes(threadId),
  });
  autoThreads.push(h.thread);
  const draft = countingTool(h, "draft-ext", "draft_tool");
  const out = await callTool(h.runtime.tools, h.run({ interactive: false }), {
    id: "au-noninteractive",
    name: "draft_tool",
    args: {},
  });
  expect(out.blocked).toContain("[fresnel:noninteractive_ask_denied]");
  expect(draft.calls).toBe(0);
  expect(toolCards(h)).toEqual([]);
});

test("auto: a draft plugin call may inherit a valid approval, so it runs with no card in default mode", async () => {
  const autoThreads: ThreadId[] = [];
  const h = await createHarness({
    draftOf,
    layers: [layer("user", { "l1.tools.permissionMode": "default" })],
    draftAutoApproved: (threadId) => autoThreads.includes(threadId),
  });
  autoThreads.push(h.thread);
  const probe = registerEdit(h);
  const approvalId = await answeredReviewCard(h);
  const result = await h.runtime.tools.executeForPlugin({
    threadId: h.thread,
    ...editFrom("draft-plug", "auto-inherit", { approvalId }),
  });
  expect(result).toMatchObject({ ok: true, value: { isError: false } });
  expect(toolCards(h)).toEqual([]);
  expect(probe.calls).toEqual(["edit"]);
});

test("auto: a readOnly capability call from a draft plugin takes the pipeline and runs with no card under bypass", async () => {
  const autoThreads: ThreadId[] = [];
  const h = await createHarness({
    draftOf,
    layers: [BYPASS],
    capabilityDefs: [Peeker],
    draftAutoApproved: (threadId) => autoThreads.includes(threadId),
  });
  autoThreads.push(h.thread);
  const peeks: string[] = [];
  h.apis.set(Peeker.id, {
    peek: (input: { value: string }) => {
      peeks.push(input.value);
      return Promise.resolve({ ok: true });
    },
  });
  h.runtime.tools.register({ kind: "capability", def: Peeker, key: serviceKey(Peeker) });
  const result = await h.runtime.tools.executeForPlugin(peekFrom(h, "draft-plug", "auto-peek-1"));
  expect(result).toMatchObject({ ok: true, value: { isError: false } });
  expect(peeks).toEqual(["x"]);
  expect(toolCards(h)).toEqual([]);
});

// ── 초안 스크립트 실행(`script` 대상, AGE-58 [제안]) ────────────────────────────────────

const SCRIPT_CARD_INPUT = {
  command: "/bin/sh",
  args: ["/draft/tree/check.sh", "--flag"],
  envNames: ["MARKER"],
  stdinBytes: 5,
  stdinPreview: "hello",
};

/** 초안 플러그인이 스크립트를 부르는 요청. `run`이 불린 횟수를 센다 */
function scriptFrom(
  scopeId: string,
  requestId: string,
  probe: { runs: number },
  inheritApproval?: { approvalId: string },
): Omit<PluginCallRequest, "threadId"> {
  return {
    plugin: { name: scopeId, scopeId },
    via: "method",
    target: {
      kind: "script",
      name: "check",
      run: () => {
        probe.runs += 1;
        return Promise.resolve({ ok: true, value: { exitCode: 0, timedOut: false } });
      },
    },
    input: SCRIPT_CARD_INPUT,
    requestId,
    ...(inheritApproval === undefined ? {} : { inheritApproval }),
  };
}

test("script: a draft script call opens a card with the draft mark, the exec risk and the shown command, and runs only after the card is allowed", async () => {
  const h = await createHarness({ draftOf, layers: [BYPASS] });
  const probe = { runs: 0 };
  const pending = h.runtime.tools.executeForPlugin({
    threadId: h.thread,
    ...scriptFrom("draft-plug", "script-1", probe),
  });
  await until(() => toolCards(h).length === 1);
  expect(probe.runs).toBe(0);
  const [card] = toolCards(h);
  expect(card?.origin.caller).toBe("plugin:draft-plug");
  expect(card?.body.kind === "tool" ? card.body.tool.draft : undefined).toEqual({
    plugin: "draft-plug",
    draftId: "d-8",
  });
  expect(card?.body.kind === "tool" ? card.body.tool.toolName : undefined).toBe("script_check");
  expect(card?.body.kind === "tool" ? card.body.tool.args : undefined).toEqual(SCRIPT_CARD_INPUT);
  expect(card?.body.kind === "tool" ? card.body.tool.risk : undefined).toBe("exec");
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "allow" });
  const result = await pending;
  expect(result).toMatchObject({
    ok: true,
    value: { isError: false, structuredContent: { exitCode: 0, timedOut: false } },
  });
  expect(probe.runs).toBe(1);
});

test("script: a declined card never runs the script and comes back as denied by the human", async () => {
  const h = await createHarness({ draftOf, layers: [BYPASS] });
  const probe = { runs: 0 };
  const pending = h.runtime.tools.executeForPlugin({
    threadId: h.thread,
    ...scriptFrom("draft-plug", "script-2", probe),
  });
  await until(() => toolCards(h).length === 1);
  const [card] = toolCards(h);
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "deny" });
  expect(await pending).toMatchObject({
    ok: false,
    error: { kind: "denied", resolvedBy: "human" },
  });
  expect(probe.runs).toBe(0);
});

test("script: an auto thread still opens the card for a draft script, under bypass, while an auto draft tool call opens none", async () => {
  const autoThreads: ThreadId[] = [];
  const h = await createHarness({
    draftOf,
    layers: [BYPASS],
    draftAutoApproved: (threadId) => autoThreads.includes(threadId),
  });
  autoThreads.push(h.thread);
  const probe = { runs: 0 };
  const pending = h.runtime.tools.executeForPlugin({
    threadId: h.thread,
    ...scriptFrom("draft-plug", "script-3", probe),
  });
  await until(() => toolCards(h).length === 1);
  expect(probe.runs).toBe(0);
  const [card] = toolCards(h);
  // 카드는 드래프트 표지를 단다(auto여도 건너뛰지 않는 카드다)
  expect(card?.body.kind === "tool" ? card.body.tool.draft : undefined).toEqual({
    plugin: "draft-plug",
    draftId: "d-8",
  });
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "deny" });
  expect(await pending).toMatchObject({ ok: false, error: { kind: "denied" } });
  expect(probe.runs).toBe(0);
});

test("script: a valid inherited approval does not skip the card of a draft script, even in an auto thread", async () => {
  const autoThreads: ThreadId[] = [];
  const h = await createHarness({
    draftOf,
    layers: [BYPASS],
    draftAutoApproved: (threadId) => autoThreads.includes(threadId),
  });
  autoThreads.push(h.thread);
  const probe = { runs: 0 };
  const pending = h.runtime.tools.executeForPlugin({
    threadId: h.thread,
    ...scriptFrom("draft-plug", "script-4", probe, { approvalId: "apr_not_a_real_approval" }),
  });
  await until(() => toolCards(h).length === 1);
  expect(probe.runs).toBe(0);
  const [card] = toolCards(h);
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "deny" });
  await pending;
  expect(probe.runs).toBe(0);
});

test("script: with no one to answer, a draft script is denied and never runs", async () => {
  const h = await createHarness({ draftOf, layers: [BYPASS] });
  const probe = { runs: 0 };
  const result = await h.runtime.tools.executeForPlugin({
    threadId: h.thread,
    conditions: { interactive: false },
    ...scriptFrom("draft-plug", "script-5", probe),
  });
  expect(result).toMatchObject({
    ok: false,
    error: { kind: "denied", message: expect.stringContaining("noninteractive_ask_denied") },
  });
  expect(probe.runs).toBe(0);
  expect(toolCards(h)).toEqual([]);
});

test("script: a script call from a reviewed plugin has no entry, so it is unavailable and runs nothing", async () => {
  const h = await createHarness({ draftOf, layers: [BYPASS] });
  const probe = { runs: 0 };
  const result = await h.runtime.tools.executeForPlugin({
    threadId: h.thread,
    ...scriptFrom("ok-plug", "script-6", probe),
  });
  expect(result).toMatchObject({ ok: false, error: { kind: "unavailable" } });
  expect(probe.runs).toBe(0);
  expect(toolCards(h)).toEqual([]);
});

test("script: a deny rule still denies a draft script and no card opens", async () => {
  const h = await createHarness({
    draftOf,
    layers: [
      layer("user", {
        "l1.tools.permissionMode": "bypass",
        "l1.tools.rules": [
          {
            id: "u.deny-script",
            action: "tool.call",
            resource: { tool: "script_check" },
            effect: "deny",
          },
        ],
      }),
    ],
  });
  const probe = { runs: 0 };
  const result = await h.runtime.tools.executeForPlugin({
    threadId: h.thread,
    ...scriptFrom("draft-plug", "script-7", probe),
  });
  expect(result).toMatchObject({ ok: false, error: { kind: "denied" } });
  expect(probe.runs).toBe(0);
  expect(toolCards(h)).toEqual([]);
});
