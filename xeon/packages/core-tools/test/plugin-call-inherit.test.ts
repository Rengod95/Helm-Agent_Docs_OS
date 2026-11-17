import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { canonicalJson, parse } from "@fresnel/contracts";
import {
  WorkspaceFiles,
  WorkspaceFilesKey,
  WorkspaceShell,
  WorkspaceShellKey,
} from "@fresnel/contracts/capabilities";
import { EffectIntentSchema } from "@fresnel/contracts/records";
import type { JsonValue } from "@fresnel/contracts/conversation";
import type { PluginCallRequest } from "@fresnel/contracts/services";
import { createToolRuntime } from "../src/runtime.ts";
import {
  createHarness,
  EDITED_FILE_CHANGE,
  installHandlers,
  layer,
  until,
  type Harness,
} from "./support/harness.ts";

// hooks-core-boundary §5.3 U-11 [제안 규칙]: 사람이 이미 답한 승인이 가리킨 쓰기만 새 카드 없이 지난다.
// 사람의 답에서만, 카드가 가리킨 쓰기(같은 경로·같은 내용)에만, 한 번만, 정책 deny와 훅 block은 그대로.

const REVIEW_ID = "rvw_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const EDIT_A = { path: "src/a.ts", edits: [{ oldText: "new a", newText: "old a" }] };
const EDIT_OTHER_PATH = { path: "src/b.ts", edits: [{ oldText: "new a", newText: "old a" }] };
const EDIT_OTHER_TEXT = { path: "src/a.ts", edits: [{ oldText: "new a", newText: "evil" }] };

function digestOf(input: unknown): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

function editCall(
  h: Harness,
  input: JsonValue,
  requestId: string,
  patch: Partial<PluginCallRequest> = {},
): PluginCallRequest {
  return {
    threadId: h.thread,
    plugin: { name: "cap-artifacts", scopeId: "scope-artifacts" },
    via: "method",
    target: { kind: "capability", capability: "workspace.files", method: "edit" },
    input,
    requestId,
    ...patch,
  };
}

/** `cap-workspace`처럼 `edit`는 write, `bash`는 exec로 올린다. 호출 기록(편집 입력)을 돌려준다 */
function registerWorkspace(h: Harness): { readonly calls: { readonly method: string }[] } {
  const calls: { method: string }[] = [];
  h.apis.set(WorkspaceFiles.id, {
    edit: () => {
      calls.push({ method: "edit" });
      return Promise.resolve({ applied: 1, matchMode: "exact", change: EDITED_FILE_CHANGE });
    },
  });
  h.apis.set(WorkspaceShell.id, {
    run: () => {
      calls.push({ method: "run" });
      return Promise.resolve({
        exitCode: 0,
        output: "ok\n",
        truncated: false,
        durationMs: 1,
        sandboxed: false,
      });
    },
  });
  h.runtime.tools.register({
    kind: "capability",
    def: WorkspaceFiles,
    key: WorkspaceFilesKey,
    policy: {
      edit: { risk: "write" },
      read: { risk: "read" },
      grep: { risk: "read" },
      write: { risk: "write" },
    },
  });
  h.runtime.tools.register({
    kind: "capability",
    def: WorkspaceShell,
    key: WorkspaceShellKey,
    policy: { bash: { risk: "exec", riskUnderReadOnlySandbox: "read" } },
  });
  return { calls };
}

/** 검토 카드를 열고 사람이 답하게 한 승인 id를 돌려준다 */
async function answeredReviewCard(
  h: Harness,
  writes: readonly string[],
  key: string = "rvw-card",
): Promise<string> {
  const opened = await h.runtime.approvals.open({
    origin: { threadId: h.thread, turnId: null, stepId: null, toolCallId: null, caller: "main" },
    requestKey: key,
    title: "Review the changes",
    body: {
      kind: "review",
      review: {
        reviewId: REVIEW_ID,
        artifactId: "art_01ARZ3NDEKTSV4RRFFQ69G5FAV",
        title: "t",
        round: 1,
        files: [{ path: "src/a.ts", change: "modified", binary: false, hunks: 1 }],
        writes,
      },
    },
    remember: ["once"],
  });
  if (!opened.ok) throw new Error("the review card was not opened");
  return opened.value.request.approvalId;
}

async function answer(h: Harness, approvalId: string): Promise<void> {
  const applied = await h.runtime.approvals.respond(approvalId, {
    decision: "answer",
    answer: { decisions: [{ hunkId: "f0h0", decision: "rejected" }], comments: [], submit: true },
  });
  expect(applied).toEqual({ applied: true });
}

/** 카드가 뜨는지 본다: 대기 카드가 하나 생기면 거부해서 호출을 끝낸다 */
async function expectsCard(h: Harness, pending: Promise<unknown>): Promise<void> {
  const toolCards = (): ReturnType<typeof h.runtime.approvals.pending> =>
    h.runtime.approvals.pending(h.thread).filter((request) => request.body.kind === "tool");
  await until(() => toolCards().length === 1);
  const [card] = toolCards();
  expect(card?.origin.caller).toBe("plugin:cap-artifacts");
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "deny" });
  expect(await pending).toMatchObject({ ok: false, error: { kind: "denied" } });
}

test("a human-answered review card lets the write it names run without a new card, and the intent records which approval was inherited", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  const approvalId = await answeredReviewCard(h, [digestOf(EDIT_A)]);
  await answer(h, approvalId);
  const result = await h.runtime.tools.executeForPlugin(
    editCall(h, EDIT_A, "inherit-1", { inheritApproval: { approvalId } }),
  );
  expect(result).toMatchObject({ ok: true, value: { isError: false } });
  expect(h.runtime.approvals.pending(h.thread)).toEqual([]);
  expect(probe.calls.map((call) => call.method)).toEqual(["edit"]);
  const intents = h.session.events.filter((event) => event.kind === "effect.intent");
  expect(intents).toHaveLength(1);
  const intent = parse(EffectIntentSchema, intents[0]?.payload);
  expect(intent.ok && intent.value.inheritedApproval).toEqual({
    approvalId,
    key: `${approvalId}:${digestOf(EDIT_A)}`,
  });
});

test("a write to another path or with other content than the card names opens a new card", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  const approvalId = await answeredReviewCard(h, [digestOf(EDIT_A)]);
  await answer(h, approvalId);
  await expectsCard(
    h,
    h.runtime.tools.executeForPlugin(
      editCall(h, EDIT_OTHER_PATH, "other-path", { inheritApproval: { approvalId } }),
    ),
  );
  await expectsCard(
    h,
    h.runtime.tools.executeForPlugin(
      editCall(h, EDIT_OTHER_TEXT, "other-text", { inheritApproval: { approvalId } }),
    ),
  );
  expect(probe.calls).toEqual([]);
});

test("a write whose hash is on the card but whose path is not in the card's file list opens a new card", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  // 카드의 파일 목록은 src/a.ts뿐인데 writes에는 src/b.ts 쓰기의 해시가 들었다(카드를 연 플러그인이 해시를 바꿔 넣은 경우)
  const approvalId = await answeredReviewCard(h, [digestOf(EDIT_A), digestOf(EDIT_OTHER_PATH)]);
  await answer(h, approvalId);
  const pending = h.runtime.tools.executeForPlugin(
    editCall(h, EDIT_OTHER_PATH, "inherit-off-list", { inheritApproval: { approvalId } }),
  );
  await expectsCard(h, pending);
  expect(probe.calls).toEqual([]);
  // 목록 안의 경로는 그대로 지난다
  const listed = await h.runtime.tools.executeForPlugin(
    editCall(h, EDIT_A, "inherit-on-list", { inheritApproval: { approvalId } }),
  );
  expect(listed).toMatchObject({ ok: true, value: { isError: false } });
});

test("the same approval and the same write pass only once; the second use opens a card", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  const approvalId = await answeredReviewCard(h, [digestOf(EDIT_A)]);
  await answer(h, approvalId);
  const first = await h.runtime.tools.executeForPlugin(
    editCall(h, EDIT_A, "once-1", { inheritApproval: { approvalId } }),
  );
  expect(first).toMatchObject({ ok: true });
  await expectsCard(
    h,
    h.runtime.tools.executeForPlugin(
      editCall(h, EDIT_A, "once-2", { inheritApproval: { approvalId } }),
    ),
  );
  expect(probe.calls).toHaveLength(1);
});

test("after a restart the used key is read from the effect record, so the approval is still spent", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const approvalId = await answeredReviewCard(h, [digestOf(EDIT_A)]);
  await answer(h, approvalId);
  const first = await h.runtime.tools.executeForPlugin(
    editCall(h, EDIT_A, "durable-1", { inheritApproval: { approvalId } }),
  );
  expect(first).toMatchObject({ ok: true });
  const restarted: Harness = { ...h, runtime: createToolRuntime(h.deps) };
  registerWorkspace(restarted);
  const restoredCards = await restarted.runtime.approvals.restore(h.thread);
  expect(restoredCards.ok).toBe(true);
  const again = restarted.runtime.tools.executeForPlugin(
    editCall(h, EDIT_A, "durable-2", { inheritApproval: { approvalId } }),
  );
  await until(() => restarted.runtime.approvals.pending(h.thread).length === 1);
  const [card] = restarted.runtime.approvals.pending(h.thread);
  expect(card?.body.kind).toBe("tool");
  await restarted.runtime.approvals.respond(card?.approvalId ?? "", { decision: "deny" });
  expect(await again).toMatchObject({ ok: false, error: { kind: "denied" } });
});

test("an approval id the engine never issued does not skip the card", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  await expectsCard(
    h,
    h.runtime.tools.executeForPlugin(
      editCall(h, EDIT_A, "forged", { inheritApproval: { approvalId: "apv_forged" } }),
    ),
  );
  expect(probe.calls).toEqual([]);
});

test("a card nobody answered and a card that was cancelled give no inheritance", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  const unanswered = await answeredReviewCard(h, [digestOf(EDIT_A)], "card-unanswered");
  await expectsCard(
    h,
    h.runtime.tools.executeForPlugin(
      editCall(h, EDIT_A, "unanswered", { inheritApproval: { approvalId: unanswered } }),
    ),
  );
  // 사람이 아닌 해결(취소)은 승인이 아니다
  const cancelledId = unanswered;
  const cancelled = await h.runtime.approvals.cancel(cancelledId, "turn aborted");
  expect(cancelled.applied).toBe(true);
  await expectsCard(
    h,
    h.runtime.tools.executeForPlugin(
      editCall(h, EDIT_A, "cancelled", { inheritApproval: { approvalId: cancelledId } }),
    ),
  );
  expect(probe.calls).toEqual([]);
});

test("a policy deny rule beats the inherited approval", async () => {
  const h = await createHarness({
    layers: [
      layer("managed", {
        "l1.tools.rules": [
          { id: "m.no-edit", action: "tool.call", resource: { tool: "edit" }, effect: "deny" },
        ],
      }),
    ],
  });
  const probe = registerWorkspace(h);
  const approvalId = await answeredReviewCard(h, [digestOf(EDIT_A)]);
  await answer(h, approvalId);
  const result = await h.runtime.tools.executeForPlugin(
    editCall(h, EDIT_A, "deny", { inheritApproval: { approvalId } }),
  );
  expect(result).toMatchObject({ ok: false, error: { kind: "denied", resolvedBy: "policy" } });
  expect(probe.calls).toEqual([]);
});

test("a plugin hook block still applies to an inherited write, and the blocked call does not spend the approval", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  let blocking = true;
  await installHandlers(h, "guard", ["tool.call.before"], (g) => {
    g.on("tool.call.before", () => (blocking ? { block: true, reason: "frozen" } : undefined));
  });
  const approvalId = await answeredReviewCard(h, [digestOf(EDIT_A)]);
  await answer(h, approvalId);
  const blocked = await h.runtime.tools.executeForPlugin(
    editCall(h, EDIT_A, "blocked", { inheritApproval: { approvalId } }),
  );
  expect(blocked).toMatchObject({ ok: false, error: { kind: "blocked" } });
  expect(probe.calls).toEqual([]);
  blocking = false;
  const retried = await h.runtime.tools.executeForPlugin(
    editCall(h, EDIT_A, "retry", { inheritApproval: { approvalId } }),
  );
  expect(retried).toMatchObject({ ok: true });
  expect(probe.calls).toHaveLength(1);
});

test("a host human decision lets the covered write pass without a card only while the decision runs, and only once", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  const grant = {
    id: "decision:test:prop_1",
    risk: "write",
    covers: (call: { readonly capability: string; readonly method: string }) =>
      call.capability === "workspace.files" && call.method === "edit",
  } as const;
  // 결정 밖: 카드가 뜬다
  await expectsCard(h, h.runtime.tools.executeForPlugin(editCall(h, EDIT_A, "outside")));
  // 결정 안: 가리킨 쓰기는 카드 없이, 가리키지 않은 기능은 카드가 뜬다
  await h.runtime.tools.withHumanDecision(grant, async () => {
    const covered = await h.runtime.tools.executeForPlugin(editCall(h, EDIT_A, "inside-1"));
    expect(covered).toMatchObject({ ok: true });
    expect(h.runtime.approvals.pending(h.thread)).toEqual([]);
    const second = h.runtime.tools.executeForPlugin(editCall(h, EDIT_A, "inside-2"));
    await expectsCard(h, second);
    const uncovered = h.runtime.tools.executeForPlugin(
      editCall(h, EDIT_A, "inside-shell", {
        target: { kind: "capability", capability: "workspace.shell", method: "run" },
        input: { command: "echo hi" },
      }),
    );
    await expectsCard(h, uncovered);
  });
  // 결정이 끝나면 꺼진다
  await expectsCard(h, h.runtime.tools.executeForPlugin(editCall(h, EDIT_OTHER_PATH, "after")));
  expect(probe.calls).toHaveLength(1);
});
