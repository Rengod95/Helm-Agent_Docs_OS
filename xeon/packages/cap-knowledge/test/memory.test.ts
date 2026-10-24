import { afterEach, describe, expect, test } from "bun:test";
import { eachAsync, parse } from "@xeon/contracts";
import type { CallOptions } from "@xeon/contracts/capabilities";
import { Type } from "typebox";
import { sha256Hex } from "../src/hash.ts";
import { entryIdOf } from "../src/memory/format.ts";
import { scriptedApprovals } from "./support/approvals.ts";
import { asHost, rejection, threadIdOf } from "./support/helpers.ts";
import { contextOf } from "./support/plans.ts";
import { closeWorlds, createWorld, MEMORY_DIR, userLayer, type World } from "./support/world.ts";

afterEach(closeWorlds);

const MemoryFullDetail = Type.Object({
  limit: Type.Number(),
  used: Type.Number(),
  wouldBe: Type.Number(),
  entries: Type.Array(
    Type.Object({ id: Type.String(), chars: Type.Number(), preview: Type.String() }),
  ),
});

const USER_FILE = `${MEMORY_DIR}/USER.md`;
const ENV_FILE = `${MEMORY_DIR}/MEMORY.md`;
const THREAD = threadIdOf(1);

function asModel(agent: "main" | "subagent" | "background", extra: Partial<CallOptions> = {}) {
  return { context: contextOf(THREAD, { kind: "model", agent }), ...extra };
}

async function add(world: World, text: string, store: "user" | "env" = "user") {
  return world.runtime.memoryApi.add({ store, text }, asHost());
}

async function viewOf(world: World, store: "user" | "env" = "user") {
  const read = await world.runtime.memoryApi.read({ stores: [store] }, asHost());
  const view = read.stores[0];
  if (view === undefined) throw new Error("no view");
  return view;
}

describe("memory read and add", () => {
  test("an empty store reads as no entries with the hash of empty content", async () => {
    const world = await createWorld();
    const read = await world.runtime.memoryApi.read({}, asHost());
    expect(read.stores.map((view) => view.store)).toEqual(["user", "env"]);
    expect(read.stores[0]).toEqual({
      store: "user",
      entries: [],
      usedChars: 0,
      limitChars: 1375,
      fileHash: sha256Hex(""),
      writeBlocked: false,
    });
    expect(read.stores[1]?.limitChars).toBe(2200);
  });

  test("entries are separated by a delimiter line and carry text-derived ids", async () => {
    const world = await createWorld();
    const first = await add(world, "답변은 한국어로 쓴다.");
    expect(first.outcome).toMatchObject({ status: "applied", approvedBy: "user" });
    await add(world, "  Commits wait for the user.  \n");
    expect(world.fs.text(USER_FILE)).toBe("답변은 한국어로 쓴다.\n§\nCommits wait for the user.\n");
    const view = await viewOf(world);
    expect(view.entries.map((entry) => entry.text)).toEqual([
      "답변은 한국어로 쓴다.",
      "Commits wait for the user.",
    ]);
    expect(view.entries[0]?.id).toBe(entryIdOf("답변은 한국어로 쓴다."));
    expect(view.entries[0]?.id).toMatch(/^[0-9a-f]{12}$/);
    expect(view.usedChars).toBe(Array.from(world.fs.text(USER_FILE) ?? "").length);
    expect(view.fileHash).toBe(sha256Hex(world.fs.text(USER_FILE) ?? ""));
    // 두 저장소는 서로 다른 파일이다
    expect(world.fs.has(ENV_FILE)).toBe(false);
  });

  test("entry id and duplicate", async () => {
    const world = await createWorld();
    await add(world, "café");
    const composed = "café";
    const dup = await rejection(add(world, composed));
    expect(dup.data.code).toBe("duplicate_entry");
    expect(entryIdOf("café".normalize("NFC"))).toBe((await viewOf(world)).entries[0]?.id ?? "");
    // 같은 텍스트라도 다른 저장소에는 넣을 수 있다
    expect((await add(world, "café", "env")).outcome.status).toBe("applied");
  });

  test("an entry with a delimiter-looking line or no text is refused", async () => {
    const world = await createWorld();
    await eachAsync(["a\n§\nb", "§ heading", "   ", "ok\n  §x"], async (text) => {
      const error = await rejection(add(world, text));
      expect(error.data.code).toBe("invalid_input");
      return undefined;
    });
    expect(world.fs.has(USER_FILE)).toBe(false);
  });

  test("limit exceeded rejected with entries", async () => {
    const world = await createWorld();
    world.setLayers([userLayer({ "l2.knowledge.memory.userLimitChars": 200 })]);
    await add(world, "x".repeat(100));
    await add(world, "y".repeat(60));
    const before = world.fs.text(USER_FILE);
    const full = await rejection(add(world, "z".repeat(60)));
    expect(full.data.code).toBe("memory_full");
    const parsed = parse(MemoryFullDetail, full.data.detail);
    if (!parsed.ok) throw new Error("memory_full detail has an unexpected shape");
    const detail = parsed.value;
    expect(detail.limit).toBe(200);
    expect(detail.wouldBe).toBeGreaterThan(200);
    expect(detail.entries).toHaveLength(2);
    expect(detail.entries[0]?.preview).toBe("x".repeat(80));
    expect(world.fs.text(USER_FILE)).toBe(before);
    expect((await world.runtime.ledgerApi.list({}, asHost())).entries).toHaveLength(2);
  });
});

describe("memory replace, remove and batch", () => {
  test("replace and remove need the current fileHash and a known entry id", async () => {
    const world = await createWorld();
    await add(world, "first");
    await add(world, "second");
    const view = await viewOf(world);
    const id = view.entries[0]?.id ?? "";
    const stale = await rejection(
      world.runtime.memoryApi.replace(
        { store: "user", entryId: id, text: "x", baseHash: "0".repeat(64) },
        asHost(),
      ),
    );
    expect(stale.data.code).toBe("base_stale");
    const unknown = await rejection(
      world.runtime.memoryApi.remove(
        { store: "user", entryId: "0".repeat(12), baseHash: view.fileHash },
        asHost(),
      ),
    );
    expect(unknown.data.code).toBe("not_found");
    const replaced = await world.runtime.memoryApi.replace(
      { store: "user", entryId: id, text: "first, rewritten", baseHash: view.fileHash },
      asHost(),
    );
    expect(replaced.outcome.status).toBe("applied");
    expect(replaced.view.entries.map((entry) => entry.text)).toEqual([
      "first, rewritten",
      "second",
    ]);
    const removed = await world.runtime.memoryApi.remove(
      {
        store: "user",
        entryId: replaced.view.entries[1]?.id ?? "",
        baseHash: replaced.view.fileHash,
      },
      asHost(),
    );
    expect(removed.view.entries.map((entry) => entry.text)).toEqual(["first, rewritten"]);
    expect(world.fs.text(USER_FILE)).toBe("first, rewritten\n");
  });

  test("replacing an entry with the text of another is a duplicate", async () => {
    const world = await createWorld();
    await add(world, "one");
    await add(world, "two");
    const view = await viewOf(world);
    const dup = await rejection(
      world.runtime.memoryApi.replace(
        {
          store: "user",
          entryId: view.entries[0]?.id ?? "",
          text: "two",
          baseHash: view.fileHash,
        },
        asHost(),
      ),
    );
    expect(dup.data.code).toBe("duplicate_entry");
  });

  test("batch is atomic", async () => {
    const world = await createWorld();
    world.setLayers([userLayer({ "l2.knowledge.memory.userLimitChars": 200 })]);
    await add(world, "a".repeat(90));
    await add(world, "b".repeat(90));
    const view = await viewOf(world);
    const idA = view.entries[0]?.id ?? "";
    const before = world.fs.text(USER_FILE);
    // 지우고 더해서 한도 안에 든다
    const ok = await world.runtime.memoryApi.manage(
      {
        store: "user",
        action: "batch",
        baseHash: view.fileHash,
        ops: [
          { action: "remove", entryId: idA },
          { action: "add", text: "c".repeat(90) },
        ],
      },
      asHost(),
    );
    expect(ok.outcome.status).toBe("applied");
    expect(ok.view.entries.map((entry) => entry.text[0])).toEqual(["b", "c"]);
    const ledger = (await world.runtime.ledgerApi.list({}, asHost())).entries[0];
    expect(ledger?.op).toBe("memory.batch");

    // 둘째 연산이 한도를 넘으면 첫째도 반영되지 않는다
    const view2 = await viewOf(world);
    const again = await rejection(
      world.runtime.memoryApi.manage(
        {
          store: "user",
          action: "batch",
          baseHash: view2.fileHash,
          ops: [
            { action: "remove", entryId: view2.entries[0]?.id ?? "" },
            { action: "add", text: "d".repeat(150) },
          ],
        },
        asHost(),
      ),
    );
    expect(again.data.code).toBe("memory_full");
    expect(world.fs.text(USER_FILE)).not.toBe(before);
    expect((await viewOf(world)).entries).toHaveLength(2);
    expect((await viewOf(world)).fileHash).toBe(view2.fileHash);
  });

  test("a batch that replaces or removes needs the fileHash, an add-only batch does not", async () => {
    const world = await createWorld();
    await add(world, "keep");
    const view = await viewOf(world);
    const stale = await rejection(
      world.runtime.memoryApi.manage(
        {
          store: "user",
          action: "batch",
          ops: [{ action: "remove", entryId: view.entries[0]?.id ?? "" }],
        },
        asHost(),
      ),
    );
    expect(stale.data.code).toBe("base_stale");
    const added = await world.runtime.memoryApi.manage(
      { store: "user", action: "batch", ops: [{ action: "add", text: "extra" }] },
      asHost(),
    );
    expect(added.view.entries).toHaveLength(2);
    const empty = await rejection(
      world.runtime.memoryApi.manage({ store: "user", action: "batch", ops: [] }, asHost()),
    );
    expect(empty.data.code).toBe("invalid_input");
  });

  test("manage maps add, replace and remove and names a missing field", async () => {
    const world = await createWorld();
    const manage = world.runtime.memoryApi.manage;
    const missing = await rejection(manage({ store: "user", action: "add" }, asHost()));
    expect(missing.data.code).toBe("invalid_input");
    const added = await manage({ store: "user", action: "add", text: "one" }, asHost());
    const id = added.view.entries[0]?.id ?? "";
    const noBase = await rejection(
      manage({ store: "user", action: "replace", entryId: id, text: "two" }, asHost()),
    );
    expect(noBase.data.code).toBe("invalid_input");
    const replaced = await manage(
      { store: "user", action: "replace", entryId: id, text: "two", baseHash: added.view.fileHash },
      asHost(),
    );
    expect(replaced.view.entries[0]?.text).toBe("two");
    const removed = await manage(
      {
        store: "user",
        action: "remove",
        entryId: replaced.view.entries[0]?.id ?? "",
        baseHash: replaced.view.fileHash,
      },
      asHost(),
    );
    expect(removed.view.entries).toEqual([]);
  });
});

describe("memory outside edits", () => {
  test("external edit drift bak", async () => {
    const world = await createWorld();
    await add(world, "good entry");
    world.fs.put(USER_FILE, "good entry\n§broken delimiter\nmore\n");
    const read = await viewOf(world);
    expect(read.writeBlocked).toBe(true);
    const blocked = await rejection(add(world, "new entry"));
    expect(blocked.data.code).toBe("drift_detected");
    // 같은 내용은 사본을 한 번만 남긴다
    await rejection(add(world, "another"));
    await viewOf(world);
    const bak = [...world.fs.files(`${MEMORY_DIR}/.bak`).keys()];
    expect(bak).toHaveLength(1);
    expect(bak[0]).toMatch(/\.bak\/USER\.md\.\d{8}T\d{6}Z$/);
    expect(world.fs.text(bak[0] ?? "")).toBe("good entry\n§broken delimiter\nmore\n");
    // 원본은 그대로다
    expect(world.fs.text(USER_FILE)).toBe("good entry\n§broken delimiter\nmore\n");
    // 사람이 고치면 다시 쓸 수 있다
    world.fs.put(USER_FILE, "good entry\n");
    expect((await add(world, "new entry")).outcome.status).toBe("applied");
  });

  test("not utf-8, NUL and oversize files are drift too", async () => {
    const world = await createWorld();
    world.fs.put(USER_FILE, new Uint8Array([0xff, 0xfe, 0x41]));
    expect((await viewOf(world)).writeBlocked).toBe(true);
    world.fs.put(USER_FILE, "text\0more");
    expect((await viewOf(world)).writeBlocked).toBe(true);
    world.fs.put(USER_FILE, "x".repeat(2 * 1375 + 1));
    expect((await viewOf(world)).writeBlocked).toBe(true);
    world.fs.put(USER_FILE, "fine\n");
    expect((await viewOf(world)).writeBlocked).toBe(false);
  });

  test("valid external edit recorded", async () => {
    const world = await createWorld();
    await add(world, "mine");
    const before = await viewOf(world);
    world.fs.put(USER_FILE, "mine\n§\nedited by hand\n");
    const after = await viewOf(world);
    expect(after.entries.map((entry) => entry.text)).toEqual(["mine", "edited by hand"]);
    expect(after.writeBlocked).toBe(false);
    const entries = (await world.runtime.ledgerApi.list({}, asHost())).entries;
    expect(entries[0]).toMatchObject({ op: "external", actor: { kind: "external" } });
    expect(entries[0]?.beforeHash).toBe(sha256Hex("mine\n"));
    // 읽은 뒤 바깥 편집이 있었으면 옛 baseHash의 쓰기는 거부된다
    const stale = await rejection(
      world.runtime.memoryApi.replace(
        {
          store: "user",
          entryId: before.entries[0]?.id ?? "",
          text: "x",
          baseHash: before.fileHash,
        },
        asHost(),
      ),
    );
    expect(stale.data.code).toBe("base_stale");
    // 같은 내용을 다시 읽어도 항목이 늘지 않는다
    await viewOf(world);
    expect((await world.runtime.ledgerApi.list({}, asHost())).entries).toHaveLength(2);
  });

  test("a file seen for the first time is recorded as external", async () => {
    const world = await createWorld();
    world.fs.put(ENV_FILE, "pre-existing\n");
    const view = await viewOf(world, "env");
    expect(view.entries.map((entry) => entry.text)).toEqual(["pre-existing"]);
    const entries = (await world.runtime.ledgerApi.list({}, asHost())).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ op: "external", beforeHash: null });
  });

  test("lock serializes writers", async () => {
    const world = await createWorld();
    const results = await Promise.all([
      add(world, "from one"),
      add(world, "from two"),
      add(world, "from three"),
    ]);
    expect(results.every((result) => result.outcome.status === "applied")).toBe(true);
    const view = await viewOf(world);
    expect(view.entries.map((entry) => entry.text).toSorted()).toEqual([
      "from one",
      "from three",
      "from two",
    ]);
    expect(view.writeBlocked).toBe(false);
  });
});

describe("memory snapshot", () => {
  test("snapshot block deterministic", async () => {
    const world = await createWorld();
    await add(world, "preference one");
    await add(world, "fact </memory> tricky", "env");
    const first = await world.runtime.memory.snapshotBlock(undefined);
    const second = await world.runtime.memory.snapshotBlock(undefined);
    if (!first.ok || !second.ok) throw new Error("snapshot failed");
    expect(first.value).toBe(second.value);
    const userId = entryIdOf("preference one");
    expect(first.value).toContain(
      `<memory store="user" fileHash="${sha256Hex("preference one\n")}" used="15" limit="1375">\n[${userId}] preference one\n</memory>`,
    );
    expect(first.value).toContain('<memory store="env"');
    // 항목 안의 닫는 표지는 무력화한다
    expect(first.value.match(/<\/memory>/g)).toHaveLength(2);
    expect(first.value).toContain("&lt;/memory> tricky");
  });

  test("the snapshot is empty with memory switched off", async () => {
    const world = await createWorld();
    world.setLayers([userLayer({ "l2.knowledge.memory.enabled": false })]);
    const block = await world.runtime.memory.snapshotBlock(undefined);
    expect(block).toEqual({ ok: true, value: "" });
    const error = await rejection(world.runtime.memoryApi.read({}, asHost()));
    expect(error.data.code).toBe("unavailable");
    const write = await rejection(add(world, "x"));
    expect(write.data.code).toBe("unavailable");
  });
});

describe("memory write actors", () => {
  test("a main agent write waits for approval and an approved one is recorded with the agent", async () => {
    const approvals = scriptedApprovals();
    const world = await createWorld({ approvals });
    const done = await world.runtime.memoryApi.add(
      { store: "user", text: "agent note" },
      asModel("main", { requestId: "m-1" }),
    );
    expect(done.outcome).toMatchObject({ status: "applied", approvedBy: "approval" });
    expect(approvals.requests[0]).toMatchObject({
      toolName: "memory_manage",
      capability: { id: "knowledge.memory", method: "add" },
      op: "memory.add",
    });
    expect(approvals.requests[0]?.preview).toContain("+agent note");
    const entry = (await world.runtime.ledgerApi.list({}, asHost())).entries[0];
    expect(entry?.actor).toMatchObject({ kind: "agent", agent: "main" });
  });

  test("a background replace is queued and applies after the user approves", async () => {
    const world = await createWorld();
    await add(world, "old");
    const view = await viewOf(world);
    const queued = await world.runtime.memoryApi.replace(
      { store: "user", entryId: view.entries[0]?.id ?? "", text: "new", baseHash: view.fileHash },
      asModel("background"),
    );
    expect(queued.outcome.status).toBe("queued");
    expect(queued.view.entries[0]?.text).toBe("old");
    expect(world.fs.text(USER_FILE)).toBe("old\n");
    const decided = await world.runtime.ledgerApi.decide(
      { proposalId: queued.outcome.proposalId ?? "", decision: "approve" },
      asHost(),
    );
    expect(decided.outcome?.status).toBe("applied");
    expect(world.fs.text(USER_FILE)).toBe("new\n");
  });

  test("every memory operation lands in the ledger and rolls back to its before hash", async () => {
    const world = await createWorld();
    const hashes: string[] = [sha256Hex("")];
    const a = await add(world, "one");
    hashes.push((await viewOf(world)).fileHash);
    const view1 = await viewOf(world);
    const b = await world.runtime.memoryApi.replace(
      { store: "user", entryId: view1.entries[0]?.id ?? "", text: "uno", baseHash: view1.fileHash },
      asHost(),
    );
    hashes.push(b.view.fileHash);
    const c = await world.runtime.memoryApi.manage(
      { store: "user", action: "batch", ops: [{ action: "add", text: "two" }] },
      asHost(),
    );
    hashes.push(c.view.fileHash);
    const d = await world.runtime.memoryApi.remove(
      { store: "user", entryId: c.view.entries[0]?.id ?? "", baseHash: c.view.fileHash },
      asHost(),
    );
    const ids = [a, b, c, d].map((result) => result.outcome.ledgerId ?? "");
    const ops = (await world.runtime.ledgerApi.list({}, asHost())).entries.map((entry) => entry.op);
    expect(ops.toReversed()).toEqual([
      "memory.add",
      "memory.replace",
      "memory.batch",
      "memory.remove",
    ]);
    await eachAsync([3, 2, 1, 0], async (index) => {
      await world.runtime.ledgerApi.rollback({ ledgerId: ids[index] ?? "" }, asHost());
      // 첫 항목을 되돌리면 파일이 없던 때로 돌아간다
      expect((await viewOf(world)).fileHash).toBe(hashes[index] ?? "");
      return undefined;
    });
    expect(world.fs.has(USER_FILE)).toBe(false);
  });
});
