import { expect, test } from "bun:test";
import type { DurableEventDraft } from "@xeon/contracts/records";
import { err, ok } from "@xeon/contracts";
import { ToolsPortKey } from "@xeon/contracts/extensions";
import { Type } from "typebox";
import { hostOf } from "../../src/primitives/index.ts";
import { makeDraft } from "../../src/primitives/drafts.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { makeUnit } from "./fixtures/support.ts";

// M3-REQ-39: 내구 이벤트 접두 조회와 도구 소유 scope 조회

test("queryEvents returns only the active-branch events whose kind starts with the prefix, in commit order, and honours limit", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const commit = (requestId: string, drafts: DurableEventDraft[]) =>
    t.records.commit({ threadId: thread, requestId, drafts });
  const first = makeDraft(t.ids, { threadId: thread, kind: "lease.acquired", payload: { n: 1 } });
  await commit("q:1", [
    first,
    makeDraft(t.ids, { threadId: thread, kind: "turn.completed", payload: { n: 2 } }),
    makeDraft(t.ids, { threadId: thread, kind: "lease.released", payload: { n: 3 } }),
  ]);
  const leases = await t.host.queryEvents(thread, { kindPrefix: "lease." });
  expect(leases.ok && leases.value.map((e) => `${e.seq}:${e.kind}`)).toEqual([
    "1:lease.acquired",
    "3:lease.released",
  ]);
  const limited = await t.host.queryEvents(thread, { kindPrefix: "lease.", limit: 1 });
  expect(limited.ok && limited.value.map((e) => e.id)).toEqual([first.id]);
  const none = await t.host.queryEvents(thread, { kindPrefix: "tool." });
  expect(none).toEqual({ ok: true, value: [] });
});

test("queryEvents skips events on an abandoned branch", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const kept = makeDraft(t.ids, { threadId: thread, kind: "lease.acquired", payload: {} });
  await t.records.commit({
    threadId: thread,
    requestId: "b:1",
    drafts: [kept, makeDraft(t.ids, { threadId: thread, kind: "lease.released", payload: {} })],
  });
  t.records.rewindTo(thread, kept.id);
  const rows = await t.host.queryEvents(thread, { kindPrefix: "lease." });
  expect(rows.ok && rows.value.map((e) => e.id)).toEqual([kept.id]);
});

test("queryEvents rejects an empty prefix and reports a missing session port", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  expect(await t.host.queryEvents(thread, { kindPrefix: "" })).toEqual({
    ok: false,
    error: { kind: "invalid_prefix" },
  });
  const bare = await createTestHost({ without: ["records"] });
  expect(await bare.host.queryEvents(thread, { kindPrefix: "lease." })).toEqual({
    ok: false,
    error: { kind: "port_unavailable" },
  });
});

test("toolOwner names the scope that registered the tool, by exposed or requested name", async () => {
  const t = await createTestHost();
  await t.host.registerPlatform({
    name: "test-tools-port",
    setup(ctx) {
      ctx.providePort(ToolsPortKey, {
        register: (_owner, def) =>
          def.name === ""
            ? err({ kind: "name_conflict", toolName: def.name })
            : ok(() => undefined),
      });
    },
  });
  await t.host.openThread(t.newThread());
  await t.host.install(
    makeUnit({ name: "owner-a" }, (g) => {
      hostOf(g).registerTool({
        name: "probe",
        description: "probe",
        parameters: Type.Object({}),
        replay: "safe",
        execute: () => Promise.resolve("ok"),
      });
    }),
  );
  const owner = t.host.toolOwner("probe");
  expect(owner?.extension).toBe("owner-a");
  expect(owner?.scopeId).toBe(t.host.scopes().find((s) => s.extension === "owner-a")?.id);
  expect(t.host.toolOwner("missing")).toBeUndefined();
});
