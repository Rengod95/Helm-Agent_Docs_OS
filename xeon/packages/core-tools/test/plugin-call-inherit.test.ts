import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { canonicalJson, parse } from "@fresnel/contracts";
import {
  WorkspaceFiles,
  WorkspaceFilesKey,
  WorkspaceShell,
  WorkspaceShellKey,
} from "@fresnel/contracts/capabilities";
import { EffectIntentSchema } from "@fresnel/contracts/records";
import type { JsonValue, ThreadId } from "@fresnel/contracts/conversation";
import type {
  ApprovalCaller,
  HumanDecisionGrant,
  PluginCallRequest,
} from "@fresnel/contracts/services";
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

/**
 * 검토 카드를 열고 사람이 답하게 한 승인 id를 돌려준다. `files`는 카드가 보여 준 파일 목록이다(기본은 `src/a.ts` 하나)
 */
async function answeredReviewCard(
  h: Harness,
  writes: readonly string[],
  key: string = "rvw-card",
  files: readonly string[] = ["src/a.ts"],
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
        files: files.map((path) => ({ path, change: "modified", binary: false, hunks: 1 })),
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

/**
 * 카드가 뜨는지 본다: 대화 `threadId`에 도구 카드가 하나 생기면(`caller` 주체) 거부해서 호출을 끝낸다
 */
async function expectsCard(
  h: Harness,
  pending: Promise<unknown>,
  threadId: ThreadId = h.thread,
  caller: ApprovalCaller = "plugin:cap-artifacts",
): Promise<void> {
  const toolCards = (): ReturnType<typeof h.runtime.approvals.pending> =>
    h.runtime.approvals.pending(threadId).filter((request) => request.body.kind === "tool");
  await until(() => toolCards().length === 1);
  const [card] = toolCards();
  expect(card?.origin.caller).toBe(caller);
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "deny" });
  expect(await pending).toMatchObject({ ok: false, error: { kind: "denied" } });
}

/**
 * 이 대화의 `cap-artifacts` 플러그인이 `path`를 편집하는 호출에 쓰는 사람의 결정 허용. `covers`는 호출 입력의 `path`로 쓰기를 고른다
 * (학습 제안 결정은 증거의 출처와 제안 id로 고르지만 편집 도구 입력에는 그 필드가 없다. 그 대조는 apps/host 시험이 본다)
 */
function decisionFor(h: Harness, path: string): HumanDecisionGrant {
  return {
    id: `decision:test:${path}`,
    threadId: h.thread,
    plugin: "cap-artifacts",
    risk: "write",
    covers: (call) =>
      call.capability === "workspace.files" &&
      call.method === "edit" &&
      call.input["path"] === path,
  };
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
  const grant: HumanDecisionGrant = {
    id: "decision:test:prop_1",
    threadId: h.thread,
    plugin: "cap-artifacts",
    risk: "write",
    covers: (call) => call.capability === "workspace.files" && call.method === "edit",
  };
  // 결정 밖: 카드가 뜬다
  await expectsCard(h, h.runtime.tools.executeForPlugin(editCall(h, EDIT_A, "outside")));
  // 결정 안: 가리킨 쓰기는 카드 없이, 가리키지 않은 기능은 카드가 뜬다
  await h.runtime.withHumanDecision(grant, async () => {
    const covered = await h.runtime.tools.executeForPlugin(editCall(h, EDIT_A, "inside-1"));
    expect(covered).toMatchObject({ ok: true });
    expect(h.runtime.approvals.pending(h.thread)).toEqual([]);
    // 기록: 의도에 어느 결정(grant id)으로 통과했는지가 승인 상속과 같은 모양으로 남는다
    const intents = h.session.events.filter((event) => event.kind === "effect.intent");
    const last = intents.at(-1);
    const intent = parse(EffectIntentSchema, last?.payload);
    expect(intent.ok && intent.value.inheritedApproval).toEqual({
      approvalId: grant.id,
      key: `${grant.id}:${digestOf(EDIT_A)}`,
    });
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

test("a human decision passes only the calls of its own conversation", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  const other = h.deps.ids.next("thr");
  await h.host.host.openThread(other);
  await h.runtime.withHumanDecision(decisionFor(h, EDIT_A.path), async () => {
    // 같은 쓰기라도 다른 대화의 호출은 카드를 건너뛰지 못한다
    await expectsCard(
      h,
      h.runtime.tools.executeForPlugin(editCall(h, EDIT_A, "other-thread", { threadId: other })),
      other,
    );
    // 결정이 실행되는 대화의 같은 호출은 지난다
    const here = await h.runtime.tools.executeForPlugin(editCall(h, EDIT_A, "this-thread"));
    expect(here).toMatchObject({ ok: true });
  });
  expect(probe.calls).toHaveLength(1);
});

test("a human decision passes only the calls of the plugin it names", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  await h.runtime.withHumanDecision(decisionFor(h, EDIT_A.path), async () => {
    const otherPlugin = editCall(h, EDIT_A, "other-plugin", {
      plugin: { name: "cap-other", scopeId: "scope-other" },
    });
    await expectsCard(
      h,
      h.runtime.tools.executeForPlugin(otherPlugin),
      h.thread,
      "plugin:cap-other",
    );
    const named = await h.runtime.tools.executeForPlugin(editCall(h, EDIT_A, "named-plugin"));
    expect(named).toMatchObject({ ok: true });
  });
  expect(probe.calls).toHaveLength(1);
});

test("a human decision covers only the write it names: a write to another path opens a card", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  await h.runtime.withHumanDecision(decisionFor(h, EDIT_A.path), async () => {
    await expectsCard(
      h,
      h.runtime.tools.executeForPlugin(editCall(h, EDIT_OTHER_PATH, "other-path")),
    );
  });
  expect(probe.calls).toEqual([]);
});

/** 작업 폴더 하나를 임시로 만들어 파일과 링크를 채우고, 시험이 끝나면 지운다 */
async function withTree(
  setup: (dir: string) => void,
  body: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "inherit-links-"));
  try {
    setup(dir);
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a write through a link to a file the card lists by its own name inherits; a link to an unlisted file opens a card", async () => {
  await withTree(
    (dir) => {
      writeFileSync(join(dir, "real.ts"), "one\n");
      writeFileSync(join(dir, "other.ts"), "two\n");
      symlinkSync("real.ts", join(dir, "alias.ts"));
      symlinkSync("other.ts", join(dir, "to-other.ts"));
    },
    async (dir) => {
      const h = await createHarness({ workdir: dir });
      const probe = registerWorkspace(h);
      const alias = { path: "alias.ts", edits: EDIT_A.edits };
      const listed = await answeredReviewCard(h, [digestOf(alias)], "alias-card", ["real.ts"]);
      await answer(h, listed);
      const passed = await h.runtime.tools.executeForPlugin(
        editCall(h, alias, "alias-call", { inheritApproval: { approvalId: listed } }),
      );
      expect(passed).toMatchObject({ ok: true });
      // 같은 카드가 가리키지 않은 파일(other.ts)을 가리키는 링크는 카드를 건너뛰지 못한다
      const toOther = { path: "to-other.ts", edits: EDIT_A.edits };
      const unlisted = await answeredReviewCard(h, [digestOf(toOther)], "other-card", ["real.ts"]);
      await answer(h, unlisted);
      await expectsCard(
        h,
        h.runtime.tools.executeForPlugin(
          editCall(h, toOther, "other-call", { inheritApproval: { approvalId: unlisted } }),
        ),
      );
      expect(probe.calls).toHaveLength(1);
    },
  );
});

test("a card that names only a link, while the file it points to is not on the card, does not pass that link's write", async () => {
  await withTree(
    (dir) => {
      writeFileSync(join(dir, "real.ts"), "one\n");
      symlinkSync("real.ts", join(dir, "shown-link.ts"));
    },
    async (dir) => {
      const h = await createHarness({ workdir: dir });
      const probe = registerWorkspace(h);
      const input = { path: "shown-link.ts", edits: EDIT_A.edits };
      const approvalId = await answeredReviewCard(h, [digestOf(input)], "link-card", [
        "shown-link.ts",
      ]);
      await answer(h, approvalId);
      await expectsCard(
        h,
        h.runtime.tools.executeForPlugin(
          editCall(h, input, "link-call", { inheritApproval: { approvalId } }),
        ),
      );
      expect(probe.calls).toEqual([]);
    },
  );
});

test("without a path resolver the call never inherits a review card's approval", async () => {
  const h = await createHarness({ noPathEnv: true });
  const probe = registerWorkspace(h);
  const approvalId = await answeredReviewCard(h, [digestOf(EDIT_A)]);
  await answer(h, approvalId);
  await expectsCard(
    h,
    h.runtime.tools.executeForPlugin(
      editCall(h, EDIT_A, "no-resolver", { inheritApproval: { approvalId } }),
    ),
  );
  expect(probe.calls).toEqual([]);
});
