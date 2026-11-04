import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { SecretNameSchema } from "@fresnel/contracts/capabilities";
import { EventIdSchema, type EventId } from "@fresnel/contracts/conversation";
import {
  ApprovalRequestedPayloadSchema,
  InputQueuedPayloadSchema,
  type ApprovalRequestedPayload,
} from "@fresnel/contracts/records";
import {
  EventsBatchParamsSchema,
  type EventWire,
  type PendingApproval,
} from "@fresnel/contracts/wire";
import { createRedactor } from "@fresnel/platform-secrets/testing";
import { approvalLeafMasks, approvalMaskEntries } from "../../src/display-mask.ts";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { rawClient } from "../fixtures/raw-client.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";
import { flushMicrotasks } from "../fixtures/clock.ts";

// L0.secrets.spec §3.5.1, F.wire-settings.spec §3.4.5a [결정: 2026-11-03 사용자].
// 승인 카드의 제목과 도구 인자는 transcript와 같은 방식으로 가린다. 저장 이벤트와 payload는 그대로다.

const SECRET = "maskprobe-value-one";
const encoder = new TextEncoder();

function redactorWithSecret(): ReturnType<typeof createRedactor> {
  const redactor = createRedactor();
  const name = parse(SecretNameSchema, "display-token");
  if (!name.ok) throw new Error("bad test secret name");
  expect(redactor.registerKnown(name.value, encoder.encode(SECRET)).ok).toBe(true);
  return redactor;
}

/** 승인 요청 payload(검증된 것). 식별자는 호스트가 준 thread id를 쓴다 */
function approvalPayload(
  threadId: string,
  title: string,
  command: string,
): ApprovalRequestedPayload {
  const parsed = parse(ApprovalRequestedPayloadSchema, {
    origin: { threadId, turnId: null, stepId: null, toolCallId: null, caller: "main" },
    requestKey: "req-1",
    title,
    body: {
      kind: "tool",
      tool: {
        toolName: "bash",
        risk: "write",
        args: { command },
        argsHash: "hash-1",
        ruleId: null,
      },
    },
    remember: ["once"],
    surfaceThreadId: threadId,
    requestedAt: 1,
  });
  if (!parsed.ok) throw new Error("the test approval payload must be valid");
  return parsed.value;
}

function eventsOf(messages: readonly { readonly message: unknown }[]): EventWire[] {
  const out: EventWire[] = [];
  for (const { message } of messages) {
    if (typeof message !== "object" || message === null || !("method" in message)) continue;
    if (message.method !== "events.batch" || !("params" in message)) continue;
    const parsed = parse(EventsBatchParamsSchema, message.params);
    if (!parsed.ok) throw new Error("events.batch is not a valid wire message");
    out.push(...parsed.value.events);
  }
  return out;
}

test("approval.requested carries leaf masks for the title and the tool arguments; payload and stored event are unchanged", async () => {
  const host = createFakeHost({ display: redactorWithSecret() });
  const threadId = host.fake.ids.next("thr");
  host.fake.commit([{ kind: "thread.started", threadId }]);
  const { client, connection } = host.connect();
  const raw = rawClient(client);
  await connection.request("host.hello", HELLO_PARAMS);
  await connection.request("events.subscribe", { from: "head" });

  const title = `Run bash with ${SECRET}`;
  const command = `curl -H token=${SECRET} https://example.test`;
  const payload = approvalPayload(threadId, title, command);
  host.fake.commit([{ kind: "approval.requested", threadId, payload }]);
  await flushMicrotasks();
  const stored = JSON.stringify(host.fake.events);

  const event = eventsOf(raw.received).find((e) => e.kind === "approval.requested");
  expect(event?.payload).toEqual(payload);
  expect(event?.mask?.map((leaf) => leaf.pointer)).toEqual(["/title", "/body/tool/args/command"]);
  // 새 필드에 값이 없다
  expect(JSON.stringify(event?.mask)).not.toContain(SECRET);
  expect(JSON.stringify(host.fake.events)).toBe(stored);
  await connection.close();
});

test("the approval leaves are computed for the title and the tool arguments only", () => {
  const redactor = redactorWithSecret();
  const payload = approvalPayload("thr_" + "0".repeat(26), `title ${SECRET}`, `ls ${SECRET}`);
  const leaves = approvalLeafMasks(redactor, payload);
  expect(leaves?.map((leaf) => leaf.pointer)).toEqual(["/title", "/body/tool/args/command"]);
  expect(JSON.stringify(leaves)).not.toContain(SECRET);
});

function eventIdOf(n: number): EventId {
  const parsed = parse(EventIdSchema, `evt_${"0".repeat(22)}${String(n).padStart(4, "0")}`);
  if (!parsed.ok) throw new Error("bad test event id");
  return parsed.value;
}

test("the approval.list entries carry masks by approval id and leave clean approvals out", () => {
  const redactor = redactorWithSecret();
  const threadId = "thr_" + "0".repeat(22) + "0001";
  const dirty: PendingApproval = {
    approvalId: eventIdOf(1),
    seq: 1,
    request: approvalPayload(threadId, "t", SECRET),
  };
  const clean: PendingApproval = {
    approvalId: eventIdOf(2),
    seq: 2,
    request: approvalPayload(threadId, "t", "ls"),
  };
  const entries = approvalMaskEntries(redactor, [dirty, clean]);
  expect(entries.map((entry) => entry.approvalId)).toEqual([dirty.approvalId]);
  expect(JSON.stringify(entries)).not.toContain(SECRET);
});

test("input.queued carries a leaf mask for the queued text; payload and stored event are unchanged", async () => {
  const host = createFakeHost({ display: redactorWithSecret() });
  const threadId = host.fake.ids.next("thr");
  host.fake.commit([{ kind: "thread.started", threadId }]);
  const { client, connection } = host.connect();
  const raw = rawClient(client);
  await connection.request("host.hello", HELLO_PARAMS);
  await connection.request("events.subscribe", { from: "head" });

  const parsed = parse(InputQueuedPayloadSchema, {
    mode: "followUp",
    item: { kind: "user", content: `use ${SECRET} please` },
    requestId: "q-1",
    source: { type: "user", via: "interactive" },
  });
  if (!parsed.ok) throw new Error("the test queued payload must be valid");
  host.fake.commit([{ kind: "input.queued", threadId, payload: parsed.value }]);
  await flushMicrotasks();
  const stored = JSON.stringify(host.fake.events);

  const event = eventsOf(raw.received).find((e) => e.kind === "input.queued");
  expect(event?.payload).toEqual(parsed.value);
  expect(event?.mask?.map((leaf) => leaf.pointer)).toEqual(["/item/content"]);
  expect(JSON.stringify(event?.mask)).not.toContain(SECRET);
  expect(JSON.stringify(host.fake.events)).toBe(stored);
  await connection.close();
});
