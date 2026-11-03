import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { SecretNameSchema } from "@fresnel/contracts/capabilities";
import {
  ItemIdSchema,
  ItemUpdatedPayloadSchema,
  maskPartText,
  type ItemId,
  type ItemRecord,
} from "@fresnel/contracts/conversation";
import {
  EventsBatchParamsSchema,
  StreamChunkParamsSchema,
  type EventWire,
  type StreamChunkParams,
} from "@fresnel/contracts/wire";
import { createRedactor } from "@fresnel/platform-secrets/testing";
import { createPartMasker, itemLeafMasks, itemMaskEntries } from "../../src/display-mask.ts";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { rawClient } from "../fixtures/raw-client.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";
import { flushMicrotasks } from "../fixtures/clock.ts";

// L0.secrets.spec §3.5.1, F.wire-settings.spec §3.4.5a [결정: 2026-11-03 사용자].
// 공통 규칙: 새 wire 필드(`mask`, `masks`, 파트 `mask`)에는 값도 그 형태도 없다. payload와 저장 행은 바뀌지 않는다.

const SECRET = "maskprobe-value-one";
const PATTERN_TOKEN = `ghp_${"d".repeat(36)}`;
const encoder = new TextEncoder();

function redactorWithSecret(): ReturnType<typeof createRedactor> {
  const redactor = createRedactor();
  const name = parse(SecretNameSchema, "display-token");
  if (!name.ok) throw new Error("bad test secret name");
  expect(redactor.registerKnown(name.value, encoder.encode(SECRET)).ok).toBe(true);
  return redactor;
}

function itemIdOf(n: number): ItemId {
  const parsed = parse(ItemIdSchema, `itm_${"0".repeat(22)}${String(n).padStart(4, "0")}`);
  if (!parsed.ok) throw new Error("bad test item id");
  return parsed.value;
}

function userItem(itemId: ItemId, content: string): ItemRecord {
  return {
    itemId,
    status: "completed",
    kind: "user",
    requestId: null,
    message: { role: "user", content, timestamp: 0 },
  };
}

type RawClient = ReturnType<typeof rawClient>;

/** 받은 events.batch의 이벤트를 모은다. 각 메시지는 contract의 parse로 검증한다 */
function eventsOf(raw: RawClient): EventWire[] {
  const out: EventWire[] = [];
  for (const { message } of raw.received) {
    if (typeof message !== "object" || message === null || !("method" in message)) continue;
    if (message.method !== "events.batch" || !("params" in message)) continue;
    const parsed = parse(EventsBatchParamsSchema, message.params);
    if (!parsed.ok) throw new Error("events.batch is not a valid wire message");
    out.push(...parsed.value.events);
  }
  return out;
}

/** 받은 stream.chunk의 조각을 모은다 */
function chunksOf(raw: RawClient): StreamChunkParams[] {
  const out: StreamChunkParams[] = [];
  for (const { message } of raw.received) {
    if (typeof message !== "object" || message === null || !("method" in message)) continue;
    if (message.method !== "stream.chunk" || !("params" in message)) continue;
    const parsed = parse(StreamChunkParamsSchema, message.params);
    if (!parsed.ok) throw new Error("stream.chunk is not a valid wire message");
    out.push(parsed.value);
  }
  return out;
}

test("item.recorded carries a mask for the registered value; payload and the stored event are unchanged", async () => {
  const host = createFakeHost({ display: redactorWithSecret() });
  const threadId = host.fake.ids.next("thr");
  host.fake.commit([{ kind: "thread.started", threadId }]);
  const { client, connection } = host.connect();
  const raw = rawClient(client);
  await connection.request("host.hello", HELLO_PARAMS);
  await connection.request("events.subscribe", { from: "head" });

  const item = userItem(itemIdOf(1), `use ${SECRET} now`);
  host.fake.commit([{ kind: "item.recorded", threadId, payload: { item } }]);
  await flushMicrotasks();
  const stored = JSON.stringify(host.fake.events);

  const event = eventsOf(raw).find((e) => e.kind === "item.recorded");
  expect(event?.payload).toEqual({ item });
  expect(event?.mask).toEqual([
    {
      pointer: "/message/content",
      len: `use ${SECRET} now`.length,
      ranges: [{ start: 4, end: 4 + SECRET.length, label: "known:display-token" }],
    },
  ]);
  // 새 필드에 값이 없다
  expect(JSON.stringify(event?.mask)).not.toContain(SECRET);
  // 저장된 이벤트는 바뀌지 않는다
  expect(JSON.stringify(host.fake.events)).toBe(stored);
  await connection.close();
});

test("a pattern-only value is masked on the wire, and a clean record has no mask field at all", async () => {
  const host = createFakeHost({ display: createRedactor() });
  const threadId = host.fake.ids.next("thr");
  host.fake.commit([{ kind: "thread.started", threadId }]);
  const { client, connection } = host.connect();
  const raw = rawClient(client);
  await connection.request("host.hello", HELLO_PARAMS);
  await connection.request("events.subscribe", { from: "head" });

  host.fake.commit([
    {
      kind: "item.recorded",
      threadId,
      payload: { item: userItem(itemIdOf(1), `t ${PATTERN_TOKEN}`) },
    },
    { kind: "item.recorded", threadId, payload: { item: userItem(itemIdOf(2), "nothing here") } },
  ]);
  await flushMicrotasks();
  const [withToken, clean] = eventsOf(raw).filter((e) => e.kind === "item.recorded");
  expect(withToken?.mask?.[0]?.ranges[0]?.label).toBe("github_token");
  expect(JSON.stringify(withToken?.mask)).not.toContain(PATTERN_TOKEN);
  expect("mask" in (clean ?? {})).toBe(false);
  await connection.close();
});

test("a streamed part carries cumulative masks; the client never shows the value or a prefix of it", async () => {
  const host = createFakeHost({ display: redactorWithSecret() });
  const { client, connection } = host.connect();
  const raw = rawClient(client);
  await connection.request("host.hello", HELLO_PARAMS);
  const created = await connection.request("thread.create", {});
  const turn = host.fake.ids.next("trn");
  const itemId = itemIdOf(7);
  const partId = host.fake.ids.next("prt");
  const send = (n: number, phase: "start" | "delta" | "end", delta: string): void => {
    host.fake.emitVolatile({
      threadId: created.threadId,
      turnId: turn,
      n,
      afterSeq: 1,
      payload: {
        itemId,
        update: {
          kind: "part_delta",
          delta: { partId, itemId, contentIndex: 0, kind: "text", phase, delta },
        },
      },
    });
  };
  send(0, "start", "");
  // 비밀은 두 조각에 걸쳐 온다
  const pieces = ["the key is maskprobe-", "value-one and ", "more text. ", ""];
  pieces.forEach((piece, index) => {
    send(index + 1, index === pieces.length - 1 ? "end" : "delta", piece);
  });
  await flushMicrotasks();

  // 클라이언트처럼 조각을 이어 붙이고 표식을 적용한다. 보이는 텍스트에 값이나 그 앞부분이 없어야 한다
  let accumulated = "";
  const shown: string[] = [];
  const params = chunksOf(raw);
  for (const chunk of params) {
    // 파트 조각의 모양(표식 포함)은 contract의 parse가 검증한다
    const payload = parse(ItemUpdatedPayloadSchema, chunk.event.payload);
    if (!payload.ok || payload.value.update.kind !== "part_delta") continue;
    const part = payload.value.update.delta;
    if (part.phase === "delta") accumulated += part.delta;
    const mask = part.mask;
    expect(JSON.stringify(mask ?? {})).not.toContain(SECRET);
    const visible = maskPartText(accumulated, mask);
    shown.push(visible);
    expect(visible).not.toContain(SECRET);
    expect(visible).not.toContain(SECRET.slice(0, 8));
  }
  expect(shown.length).toBe(pieces.length + 1);
  expect(accumulated).toBe(`the key is ${SECRET} and more text. `);
  expect(shown.at(-1)).toBe("the key is [REDACTED:known:display-token] and more text. ");
  await connection.close();
});

test("a part the host never saw start is unverified; a completed part forgets its text", () => {
  const masker = createPartMasker(createRedactor());
  expect(masker.delta("prt_x", "delta", "abc")).toEqual({ verified: false });
  expect(masker.delta("prt_y", "start", "")).toEqual({
    verified: true,
    len: 0,
    visible: 0,
    ranges: [],
  });
  masker.completed("prt_y");
  expect(masker.delta("prt_y", "delta", "abc")).toEqual({ verified: false });
});

test("the thread.read entries carry leaf masks by item id and never the value", () => {
  const redactor = redactorWithSecret();
  const clean = userItem(itemIdOf(2), "plain");
  const dirty = userItem(itemIdOf(1), `use ${SECRET}`);
  const entries = itemMaskEntries(redactor, [clean, dirty]);
  expect(entries.map((entry) => entry.itemId)).toEqual([dirty.itemId]);
  expect(JSON.stringify(entries)).not.toContain(SECRET);
  expect(itemLeafMasks(redactor, clean)).toBeUndefined();
});
