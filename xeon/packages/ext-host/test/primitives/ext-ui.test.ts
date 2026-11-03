// 화면의 post와 승인 요청(X.primitives.spec §4.13, M4 T-UIPOST). 대화·확장·화면 선언·켜짐 검사, 입력 큐와 승인 서비스로 넘기는 값, 멱등을 확인한다.
import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ExtMethodDecl, UiDecl } from "@fresnel/contracts/extensions";
import {
  ApprovalServicePortKey,
  type ApprovalRequest,
  type ApprovalService,
} from "@fresnel/contracts/services";
import type { ExtensionUnit } from "../../src/primitives/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { makeManifest, makeUnit } from "./fixtures/support.ts";

type Host = Awaited<ReturnType<typeof createTestHost>>;

const ui: UiDecl = {
  schemaVersion: 1,
  widgets: "^1.0.0",
  items: [{ id: "panel", placement: "panel", mode: "native", title: "Panel", file: "p.json" }],
};
const method: ExtMethodDecl = {
  verb: "apply",
  params: {},
  result: {},
  readOnly: false,
  approval: true,
};

/** 화면과 메서드를 선언한 확장. 매니페스트 도우미에 없는 `ui`는 펼쳐서 더한다 */
function unitOf(name: string, usesPost: boolean, initialEnabled?: boolean): ExtensionUnit {
  const base = makeUnit(
    {
      name,
      usesPost,
      methods: [method],
      ...(initialEnabled === undefined ? {} : { initialEnabled }),
    },
    () => {},
  );
  return { ...base, manifest: { ...makeManifest({ name, usesPost, methods: [method] }), ui } };
}

/** 열린 승인 요청을 기억하는 최소 대역. open만 의미가 있고 나머지는 쓰지 않는다 */
function approvalsOf(): { readonly service: ApprovalService; readonly created: ApprovalRequest[] } {
  const created: ApprovalRequest[] = [];
  const byKey = new Map<string, ApprovalRequest>();
  const service: ApprovalService = {
    request: () => Promise.resolve(err({ kind: "key_reused", requestId: "unused" })),
    respond: () => Promise.resolve({ applied: false }),
    pending: () => created,
    restore: () => Promise.resolve(ok(created)),
    cancel: () => Promise.resolve({ applied: false }),
    open(input) {
      const known = byKey.get(input.requestKey);
      if (known !== undefined) return Promise.resolve(ok({ request: known, resolution: null }));
      const request: ApprovalRequest = {
        ...input,
        approvalId: `appr_${String(created.length + 1)}`,
        surfaceThreadId: input.origin.threadId,
        requestedAt: 0,
      };
      created.push(request);
      byKey.set(input.requestKey, request);
      return Promise.resolve(ok({ request, resolution: null }));
    },
    wait: () => Promise.resolve(err({ kind: "unknown" })),
    get: () => undefined,
  };
  return { service, created };
}

async function setup(units: readonly ExtensionUnit[]): Promise<{
  readonly t: Host;
  readonly thread: ThreadId;
  readonly approvals: ReturnType<typeof approvalsOf>;
}> {
  const t = await createTestHost();
  const approvals = approvalsOf();
  await t.host.registerPlatform({
    name: "test-approvals",
    setup: (ctx) => {
      ctx.providePort(ApprovalServicePortKey, approvals.service);
    },
  });
  await eachInOrder(units, async (unit) => {
    await t.host.install(unit);
    return "continue";
  });
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  return { t, thread, approvals };
}

test("post queues a context item at the step boundary and is idempotent by requestId", async () => {
  const { t, thread } = await setup([unitOf("poster", true)]);
  const input = {
    extension: "poster",
    ui: "panel",
    threadId: thread,
    name: "refresh",
    payload: { n: 1 },
    requestId: "r1",
  };
  expect(await t.host.ui.post(input)).toEqual({ ok: true, value: { duplicate: false } });
  expect(await t.host.ui.post(input)).toEqual({ ok: true, value: { duplicate: true } });
  expect(t.queue.items).toEqual([
    {
      threadId: thread,
      scopeId: "poster",
      requestId: "r1",
      when: "steer",
      item: {
        kind: "context",
        customType: "x.poster.ui.refresh",
        content: 'refresh: {"n":1}',
        display: true,
        details: { n: 1 },
      },
    },
  ]);
  // 키를 생략하면 호출마다 새 키라 둘 다 들어간다
  const { requestId: _omitted, ...keyless } = input;
  await t.host.ui.post(keyless);
  await t.host.ui.post(keyless);
  expect(t.queue.items).toHaveLength(3);
});

test("post refuses unknown thread, extension, ui, post permission, off state and bad names", async () => {
  const { t, thread } = await setup([
    unitOf("poster", true),
    unitOf("mute", false),
    unitOf("sleeper", true, false),
  ]);
  const base = { extension: "poster", ui: "panel", threadId: thread, name: "go" };
  const refusal = async (patch: Partial<typeof base>): Promise<unknown> => {
    const result = await t.host.ui.post({ ...base, ...patch });
    return result.ok ? "accepted" : result.error;
  };
  const stranger = t.newThread();
  expect(await refusal({ threadId: stranger })).toEqual({
    kind: "unknown_thread",
    threadId: stranger,
  });
  expect(await refusal({ extension: "nobody" })).toEqual({
    kind: "unknown_extension",
    extension: "nobody",
  });
  expect(await refusal({ ui: "other" })).toEqual({ kind: "ui_not_declared", ui: "other" });
  expect(await refusal({ extension: "mute" })).toEqual({
    kind: "post_not_allowed",
    extension: "mute",
  });
  expect(await refusal({ extension: "sleeper" })).toEqual({
    kind: "extension_off",
    extension: "sleeper",
  });
  expect(await refusal({ name: "Bad Name" })).toEqual({ kind: "name_invalid", name: "Bad Name" });
  expect(t.queue.items).toEqual([]);
});

test("requestApproval opens a question approval attributed to the plugin and is idempotent", async () => {
  const { t, thread, approvals } = await setup([unitOf("asker", false)]);
  const input = {
    extension: "asker",
    ui: "panel",
    threadId: thread,
    method: "apply",
    params: { id: 7 },
    requestId: "a1",
  };
  const first = await t.host.ui.requestApproval(input);
  const again = await t.host.ui.requestApproval(input);
  expect(first).toEqual({ ok: true, value: { approvalId: "appr_1" } });
  expect(again).toEqual(first);
  const [only, ...rest] = approvals.created;
  expect(rest).toEqual([]);
  expect(only?.origin).toEqual({
    threadId: thread,
    turnId: null,
    stepId: null,
    toolCallId: null,
    caller: "ext:asker",
  });
  expect(only?.body.kind).toBe("question");
  expect(only?.remember).toEqual(["once"]);
  expect(only?.title).toBe("asker asks to run apply");
  // 다른 키는 다른 승인이다
  const other = await t.host.ui.requestApproval({ ...input, requestId: "a2" });
  expect(other).toEqual({ ok: true, value: { approvalId: "appr_2" } });
});

test("requestApproval refuses undeclared method, unknown thread and off extensions", async () => {
  const { t, thread } = await setup([unitOf("asker", false), unitOf("sleeper", false, false)]);
  const base = { extension: "asker", ui: "panel", threadId: thread, method: "apply" };
  const refusal = async (patch: Partial<typeof base>): Promise<unknown> => {
    const result = await t.host.ui.requestApproval({ ...base, ...patch });
    return result.ok ? "accepted" : result.error;
  };
  expect(await refusal({ method: "nope" })).toEqual({
    kind: "method_not_declared",
    method: "nope",
  });
  expect(await refusal({ ui: "other" })).toEqual({ kind: "ui_not_declared", ui: "other" });
  expect(await refusal({ extension: "sleeper" })).toEqual({
    kind: "extension_off",
    extension: "sleeper",
  });
  const stranger = t.newThread();
  expect(await refusal({ threadId: stranger })).toEqual({
    kind: "unknown_thread",
    threadId: stranger,
  });
});

test("requestApproval reports a missing approvals port", async () => {
  const t = await createTestHost();
  await t.host.install(unitOf("asker", false));
  const thread = t.newThread();
  await t.host.openThread(thread);
  const result = await t.host.ui.requestApproval({
    extension: "asker",
    ui: "panel",
    threadId: thread,
    method: "apply",
  });
  expect(result).toEqual({ ok: false, error: { kind: "port_unavailable", port: "approvals" } });
});
