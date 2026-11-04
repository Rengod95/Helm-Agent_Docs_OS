import { expect, test } from "bun:test";
import { err, ok, parse, type Result } from "@fresnel/contracts";
import { SecretNameSchema } from "@fresnel/contracts/capabilities";
import {
  ItemIdSchema,
  PartIdSchema,
  type AssistantMessage,
  type ItemId,
  type ItemRecord,
  type ItemStatus,
  type LeafMask,
  type ThreadId,
  type UserMessage,
} from "@fresnel/contracts/conversation";
import {
  WireError,
  type WireParams,
  type WireRequestContext,
  type WireResult,
} from "@fresnel/contracts/wire";
import { createRedactor } from "@fresnel/platform-secrets/testing";
import { createThreadExportHandler } from "../../src/handlers/thread.ts";
import type { ThreadReadFailure } from "../../src/types.ts";
import {
  createFakeEngine,
  FAKE_STORE_ID,
  type FakeEngineOptions,
} from "../fixtures/fake-engine.ts";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";
import { partial } from "../fixtures/unsafe.ts";

// M4 thread.export(F.wire-settings.spec §3.4.7 [제안]). 가짜 엔진 위의 실제 처리기다. `thread.read`는 가짜가 쪽 크기를 정해 돌려준다.
// 쪽 나누기 시험은 예산을 작게 넣어 여러 쪽을 만든다(예산은 처리기 인자로 넘긴다).

const SECRET = "export-probe-value";
const encoder = new TextEncoder();
const CONTEXT = partial<WireRequestContext>({ signal: new AbortController().signal });

const USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function itemIdOf(n: number): ItemId {
  const parsed = parse(ItemIdSchema, `itm_${"0".repeat(22)}${String(n).padStart(4, "0")}`);
  if (!parsed.ok) throw new Error("bad test item id");
  return parsed.value;
}

function partIdOf(n: number) {
  const parsed = parse(PartIdSchema, `prt_${"0".repeat(22)}${String(n).padStart(4, "0")}`);
  if (!parsed.ok) throw new Error("bad test part id");
  return parsed.value;
}

function userItem(n: number, content: UserMessage["content"]): ItemRecord {
  return {
    itemId: itemIdOf(n),
    status: "completed",
    kind: "user",
    requestId: null,
    message: { role: "user", content, timestamp: n },
  };
}

function assistantItem(
  n: number,
  content: AssistantMessage["content"],
  status: ItemStatus = "completed",
): ItemRecord {
  return {
    itemId: itemIdOf(n),
    status,
    kind: "assistant",
    partIds: content.map((_, index) => partIdOf(n * 10 + index)),
    message: {
      role: "assistant",
      content,
      api: "test",
      provider: "test",
      model: "tape",
      usage: USAGE,
      stopReason: "stop",
      timestamp: n,
    },
  };
}

function toolResultItem(n: number, text: string, isError = false): ItemRecord {
  return {
    itemId: itemIdOf(n),
    status: "completed",
    kind: "toolResult",
    effectId: null,
    message: {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "read_file",
      content: [{ type: "text", text }],
      isError,
      timestamp: n,
    },
  };
}

type ReadResult = Result<WireResult<"thread.read">, ThreadReadFailure>;

/** 가짜 `thread.read`: 가장 새 쪽부터 `pageCap`개(요청의 `limit`보다 작을 수 있다)씩 돌려주고 `hasMore`를 정확히 잰다 */
function pagedRead(items: readonly ItemRecord[], pageCap: number) {
  return (params: WireParams<"thread.read">): Promise<ReadResult> => {
    const end =
      params.before === undefined
        ? items.length
        : items.findIndex((item) => item.itemId === params.before);
    if (end < 0) return Promise.resolve(missingTarget());
    const start = Math.max(0, end - Math.min(pageCap, params.limit ?? 200));
    return Promise.resolve(
      ok({
        threadId: params.threadId,
        items: items.slice(start, end),
        position: { storeId: FAKE_STORE_ID, seq: items.length },
        hasMore: start > 0,
      }),
    );
  };
}

function missingTarget(): ReadResult {
  return err({ kind: "invalid_target", reason: "item_not_found" });
}

interface Export {
  readonly threadId: ThreadId;
  readonly handler: ReturnType<typeof createThreadExportHandler>;
  readonly ids: () => ThreadId;
}

async function exportOf(options: {
  readonly items: readonly ItemRecord[];
  readonly title?: string | null;
  readonly pageCap?: number;
  readonly budget?: number;
  readonly display?: FakeEngineOptions["display"];
}): Promise<Export> {
  const fake = createFakeEngine({
    ...(options.display === undefined ? {} : { display: options.display }),
    overrides: {
      threads: {
        read: pagedRead(options.items, options.pageCap ?? 500),
        title: () => ok(options.title ?? null),
      },
    },
  });
  const created = await fake.engine.ports.threads.create({});
  return {
    threadId: created.threadId,
    handler: createThreadExportHandler(fake.engine, options.budget),
    ids: () => fake.ids.next("thr"),
  };
}

/** 쪽을 `next`가 없을 때까지 차례로 부른다. 돌려준 쪽들을 그대로 모은다 */
async function everyChunk(
  exported: Export,
  format: "markdown" | "json",
): Promise<{ readonly chunks: readonly string[]; readonly filename: string }> {
  const chunks: string[] = [];
  let after: ItemId | undefined;
  let filename = "";
  let more = true;
  while (more && chunks.length < 100) {
    // oxlint-disable-next-line no-await-in-loop -- 다음 쪽은 앞 쪽의 next가 있어야 부를 수 있다 (F.wire-settings.spec §3.4.7)
    const page = await exported.handler(
      { threadId: exported.threadId, format, ...(after === undefined ? {} : { after }) },
      CONTEXT,
    );
    chunks.push(page.chunk);
    filename = page.filename;
    after = page.next;
    more = after !== undefined;
  }
  return { chunks, filename };
}

function bytesOf(text: string): number {
  return encoder.encode(text).byteLength;
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  try {
    await call;
  } catch (caught) {
    if (caught instanceof WireError) return caught;
    throw caught;
  }
  throw new Error("expected the request to fail with a WireError");
}

function redactorWithSecret(): ReturnType<typeof createRedactor> {
  const redactor = createRedactor();
  const name = parse(SecretNameSchema, "display-token");
  if (!name.ok) throw new Error("bad test secret name");
  expect(redactor.registerKnown(name.value, encoder.encode(SECRET)).ok).toBe(true);
  return redactor;
}

/** 쓰는 자리마다 긴 본문을 가진 item 다섯 개. 예산을 작게 넣으면 여러 쪽이 된다 */
function fiveItems(): ItemRecord[] {
  return [1, 2, 3, 4, 5].map((n) => userItem(n, `${n} `.repeat(30)));
}

test("(a) markdown of a mixed branch is the exact expected document", async () => {
  const items: ItemRecord[] = [
    userItem(1, "안녕하세요. 회의 메모를 만들어 줘."),
    assistantItem(2, [
      { type: "thinking", thinking: "속으로 계획을 세운다" },
      { type: "text", text: "먼저 파일을 읽겠다." },
      { type: "toolCall", id: "call_1", name: "read_file", arguments: { path: "notes.md" } },
    ]),
    toolResultItem(3, "# 메모\n- 항목 하나"),
    assistantItem(4, [{ type: "text", text: "정리했다." }]),
    userItem(5, [
      { type: "text", text: "이 그림도 봐" },
      { type: "image", data: "aGk=", mimeType: "image/png" },
    ]),
  ];
  const exported = await exportOf({ items, title: "회의 메모" });
  const page = await exported.handler({ threadId: exported.threadId, format: "markdown" }, CONTEXT);

  const expected =
    `# 회의 메모\n\n- Thread ID: ${exported.threadId}\n- Items: 5\n\n` +
    "## User\n\n안녕하세요. 회의 메모를 만들어 줘.\n\n" +
    '## Assistant\n\n먼저 파일을 읽겠다.\n\nTool call: `read_file`\n\n```json\n{\n  "path": "notes.md"\n}\n```\n\n' +
    "## Tool result: read_file\n\n```\n# 메모\n- 항목 하나\n```\n\n" +
    "## Assistant\n\n정리했다.\n\n" +
    "## User\n\n이 그림도 봐\n\n[image: image/png]\n\n";
  expect(page.chunk).toBe(expected);
  expect(page.filename).toBe("회의 메모.md");
  expect(page.itemCount).toBe(5);
  expect("next" in page).toBe(false);
});

test("(b) json pieces joined in order parse back to the same items, and equal the one-piece export", async () => {
  const items = fiveItems();
  const whole = await exportOf({ items, pageCap: 2 });
  const single = await everyChunk(whole, "json");
  expect(single.chunks).toHaveLength(1);

  const split = await exportOf({ items, pageCap: 2, budget: 700 });
  const pieces = await everyChunk(split, "json");
  expect(pieces.chunks.length).toBeGreaterThan(1);
  for (const piece of pieces.chunks) expect(bytesOf(piece)).toBeLessThanOrEqual(700);

  const joined = pieces.chunks.join("");
  expect(joined).toBe(single.chunks.join(""));
  expect(JSON.parse(joined)).toEqual(items);
  expect(pieces.filename).toBe(`${split.threadId}.json`);
});

test("(b) an item larger than the piece budget is omitted in json and cut in markdown; both stay valid", async () => {
  const big = userItem(3, "x".repeat(2000));
  const items = [userItem(1, "짧다"), userItem(2, "둘째"), big, userItem(4, "넷째")];

  const json = await exportOf({ items, budget: 700 });
  const jsonPieces = await everyChunk(json, "json");
  for (const piece of jsonPieces.chunks) expect(bytesOf(piece)).toBeLessThanOrEqual(700);
  expect(JSON.parse(jsonPieces.chunks.join(""))).toEqual([
    items[0],
    items[1],
    { itemId: big.itemId, omitted: "too_large" },
    items[3],
  ]);

  const md = await exportOf({ items, budget: 700 });
  const mdPieces = await everyChunk(md, "markdown");
  const mdText = mdPieces.chunks.join("");
  expect(mdText.split("_(item shortened: response size limit reached)_")).toHaveLength(2);
  expect(mdText).toContain("## User\n\nx");
  expect(mdText).not.toContain("x".repeat(1000));
  for (const piece of mdPieces.chunks) expect(bytesOf(piece)).toBeLessThanOrEqual(700);
});

test("(b) a markdown item cut inside a code fence closes the fence before the cut marker", async () => {
  // 도구 결과는 펜스 안에 있다. 예산 안에서 줄이면 펜스가 열린 채 남으므로 닫는 줄을 붙인다
  const items = [toolResultItem(1, "a".repeat(2000)), userItem(2, "뒤")];
  const exported = await exportOf({ items, budget: 300 });
  const pieces = await everyChunk(exported, "markdown");
  const first = pieces.chunks[0] ?? "";
  expect(first.endsWith("\n```\n\n_(item shortened: response size limit reached)_\n\n")).toBe(true);
  expect(bytesOf(first)).toBeLessThanOrEqual(300);
  // 펜스 줄 수가 짝수라서 뒤따르는 항목은 본문으로 보인다
  expect(pieces.chunks.join("").split("```")).toHaveLength(3);
  expect(pieces.chunks.join("")).toContain("## User\n\n뒤\n\n");
});

test("(b) markdown pieces joined in order equal the one-piece export", async () => {
  const items = fiveItems();
  const whole = await everyChunk(await exportOf({ items, title: "나눔" }), "markdown");
  const pieces = await everyChunk(
    await exportOf({ items, title: "나눔", pageCap: 1, budget: 250 }),
    "markdown",
  );
  expect(pieces.chunks.length).toBeGreaterThan(1);
  expect(pieces.chunks.join("")).toBe(whole.chunks.join(""));
  expect(pieces.filename).toBe("나눔.md");
});

test("(c) a secret value is absent from markdown, json and the file name; the masks show as placeholders", async () => {
  const items: ItemRecord[] = [
    userItem(1, `비밀은 ${SECRET} 이다`),
    assistantItem(2, [
      { type: "toolCall", id: "call_1", name: "login", arguments: { token: SECRET } },
    ]),
    toolResultItem(3, `응답: ${SECRET}`),
  ];
  const display = redactorWithSecret();
  const exported = await exportOf({ items, title: `회의 ${SECRET}`, display });

  const md = await exported.handler({ threadId: exported.threadId, format: "markdown" }, CONTEXT);
  const json = await exported.handler({ threadId: exported.threadId, format: "json" }, CONTEXT);
  expect(md.chunk).not.toContain(SECRET);
  expect(json.chunk).not.toContain(SECRET);
  expect(md.filename).not.toContain(SECRET);
  expect(json.filename).not.toContain(SECRET);
  // 제목에 값이 있으면 파일 이름은 thread id다
  expect(md.filename).toBe(`${exported.threadId}.md`);
  expect(md.chunk).toContain("# 회의 [REDACTED:known:display-token]");

  const placeholder = "[REDACTED:known:display-token]";
  expect(JSON.parse(json.chunk)).toEqual([
    userItem(1, `비밀은 ${placeholder} 이다`),
    assistantItem(2, [
      { type: "toolCall", id: "call_1", name: "login", arguments: { token: placeholder } },
    ]),
    toolResultItem(3, `응답: ${placeholder}`),
  ]);
  expect(md.chunk).toContain(`비밀은 ${placeholder} 이다`);
});

test("(c) an item that cannot be masked is an unreadable placeholder in both formats", async () => {
  // 시계 숫자 잎을 가린다고 주장하는 면이라 항목마다 적용이 실패해 읽을 수 없는 item이 된다
  const timestampLeaf: LeafMask = { pointer: "/message/timestamp", len: 1, ranges: [] };
  const display: FakeEngineOptions["display"] = {
    displayRanges: () => [],
    displayVisibleLength: (text: string) => text.length,
    displayLeafMasks: () => [timestampLeaf],
  };
  const first = userItem(1, "가림 실패");
  const second = toolResultItem(2, "가림 실패");
  const exported = await exportOf({ items: [first, second], display });

  const md = await exported.handler({ threadId: exported.threadId, format: "markdown" }, CONTEXT);
  expect(md.chunk).toBe(
    `# ${exported.threadId}\n\n- Thread ID: ${exported.threadId}\n- Items: 2\n\n` +
      "## User\n\n[unreadable item]\n\n## Tool result\n\n[unreadable item]\n\n",
  );
  const json = await exported.handler({ threadId: exported.threadId, format: "json" }, CONTEXT);
  expect(JSON.parse(json.chunk)).toEqual([
    { itemId: first.itemId, omitted: "unreadable" },
    { itemId: second.itemId, omitted: "unreadable" },
  ]);
});

test("(d) an unknown thread is 3001, the same error thread.read gives", async () => {
  const exported = await exportOf({ items: fiveItems() });
  const error = await wireErrorOf(
    exported.handler({ threadId: exported.ids(), format: "json" }, CONTEXT),
  );
  expect([error.code, error.data.kind]).toEqual([3001, "thread.notFound"]);
});

test("(e) an after that is not on the branch is 3005 item_not_found", async () => {
  const exported = await exportOf({ items: fiveItems() });
  const stranger = itemIdOf(99);
  const error = await wireErrorOf(
    exported.handler({ threadId: exported.threadId, format: "json", after: stranger }, CONTEXT),
  );
  expect([error.code, error.data.kind]).toEqual([3005, "thread.invalidTarget"]);
  expect(error.data.details).toEqual({ reason: "item_not_found" });
});

test("(e) after the last item leaves an empty last piece: json closes the array, markdown adds nothing", async () => {
  const exported = await exportOf({ items: fiveItems() });
  const last = itemIdOf(5);
  const json = await exported.handler(
    { threadId: exported.threadId, format: "json", after: last },
    CONTEXT,
  );
  expect(json).toEqual({
    format: "json",
    filename: `${exported.threadId}.json`,
    chunk: "]",
    itemCount: 0,
  });
  const md = await exported.handler(
    { threadId: exported.threadId, format: "markdown", after: last },
    CONTEXT,
  );
  expect(md.chunk).toBe("");
  expect(md.itemCount).toBe(0);
});

test("an empty thread exports as a valid empty json array and a markdown header alone", async () => {
  const exported = await exportOf({ items: [], title: null });
  const json = await exported.handler({ threadId: exported.threadId, format: "json" }, CONTEXT);
  expect(json.chunk).toBe("[]");
  expect(json.filename).toBe(`${exported.threadId}.json`);
  const md = await exported.handler({ threadId: exported.threadId, format: "markdown" }, CONTEXT);
  expect(md.chunk).toBe(
    `# ${exported.threadId}\n\n- Thread ID: ${exported.threadId}\n- Items: 0\n\n`,
  );
});

test("thread.export is registered, listed by hello, and answers over the wire with a valid result", async () => {
  const items = [userItem(1, "첫 입력"), toolResultItem(2, "결과")];
  const host = createFakeHost({
    overrides: { threads: { read: pagedRead(items, 500), title: () => ok("메모") } },
  });
  const { connection } = host.connect();
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  expect(hello.features.map((feature) => feature.name)).toContain("thread.export");
  const created = await connection.request("thread.create", {});
  const result = await connection.request("thread.export", {
    threadId: created.threadId,
    format: "json",
  });
  expect(result.filename).toBe("메모.json");
  expect(result.itemCount).toBe(2);
  expect("next" in result).toBe(false);
  expect(JSON.parse(result.chunk)).toEqual(items);
  await connection.close();
});
