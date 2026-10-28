import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WriteOutcome } from "@xeon/contracts/capabilities";
import { closeWorlds, createWorld, type World } from "./support/world.ts";
import { asHost } from "./support/helpers.ts";
import { createMemoryFs, type MemoryFs } from "./support/memory-fs.ts";

// M3-REQ-88·89, ADR-0015 §3.6, L2.knowledge.spec §4.4.5: 멱등 쓰기 열한 개는 같은 requestId를 두 번 불러도 효과가 한 번이고 결과가 같다.
// 두 번째 호출은 저장소를 닫았다 다시 연 뒤에 한다. 입력은 처음 호출 때 정한 것을 그대로 다시 보내므로
// 멱등 확인이 계산보다 앞서지 않으면 base_stale이나 name_conflict로 실패한다.

afterEach(closeWorlds);

interface Case {
  readonly name: string;
  /** 쓰기 입력을 정하고 필요한 앞선 상태를 만든다. 반환한 함수가 시험할 호출이다 */
  readonly setup: (
    world: World,
  ) => Promise<(world: World, requestId: string) => Promise<WriteOutcome>>;
}

const DEPLOY = { name: "deploy", description: "Use when deploying.", body: "v1\n" };

async function create(world: World, requestId: string): Promise<void> {
  await world.runtime.skillsApi.create(DEPLOY, asHost({ requestId }));
}

async function hashOf(world: World): Promise<string> {
  return (await world.runtime.skillsApi.view({ name: "deploy" }, asHost())).treeHash;
}

async function memoryView(world: World) {
  const read = await world.runtime.memoryApi.read({ stores: ["user"] }, asHost());
  const view = read.stores[0];
  if (view === undefined) throw new Error("no memory view");
  return view;
}

const CASES: readonly Case[] = [
  {
    name: "knowledge.skills.create",
    setup: () =>
      Promise.resolve((world, requestId) =>
        world.runtime.skillsApi.create(DEPLOY, asHost({ requestId })),
      ),
  },
  {
    name: "knowledge.skills.edit",
    setup: async (world) => {
      await create(world, "setup");
      const input = { name: "deploy", baseHash: await hashOf(world), body: "v2\n" };
      return (target, requestId) => target.runtime.skillsApi.edit(input, asHost({ requestId }));
    },
  },
  {
    name: "knowledge.skills.patch",
    setup: async (world) => {
      await create(world, "setup");
      const input = {
        name: "deploy",
        baseHash: await hashOf(world),
        edits: [{ oldText: "v1", newText: "v2" }],
      };
      return (target, requestId) => target.runtime.skillsApi.patch(input, asHost({ requestId }));
    },
  },
  {
    name: "knowledge.skills.writeFile",
    setup: async (world) => {
      await create(world, "setup");
      const input = { name: "deploy", path: "references/a.md", content: "A" };
      return (target, requestId) =>
        target.runtime.skillsApi.writeFile(input, asHost({ requestId }));
    },
  },
  {
    name: "knowledge.skills.remove",
    setup: async (world) => {
      await create(world, "setup");
      const input = { name: "deploy", baseHash: await hashOf(world), mode: "archive" as const };
      return (target, requestId) => target.runtime.skillsApi.remove(input, asHost({ requestId }));
    },
  },
  {
    name: "knowledge.skills.manage",
    setup: () => {
      const input = {
        action: "create" as const,
        name: "other",
        description: "Use when other.",
        body: "b\n",
      };
      return Promise.resolve((target, requestId) =>
        target.runtime.skillsApi.manage(input, asHost({ requestId })),
      );
    },
  },
  {
    name: "knowledge.memory.add",
    setup: () =>
      Promise.resolve(async (world, requestId) => {
        const done = await world.runtime.memoryApi.add(
          { store: "user", text: "likes tea" },
          asHost({ requestId }),
        );
        return done.outcome;
      }),
  },
  {
    name: "knowledge.memory.replace",
    setup: async (world) => {
      await world.runtime.memoryApi.add({ store: "user", text: "old" }, asHost());
      const view = await memoryView(world);
      const input = {
        store: "user" as const,
        entryId: view.entries[0]?.id ?? "",
        text: "new",
        baseHash: view.fileHash,
      };
      return async (target, requestId) =>
        (await target.runtime.memoryApi.replace(input, asHost({ requestId }))).outcome;
    },
  },
  {
    name: "knowledge.memory.remove",
    setup: async (world) => {
      await world.runtime.memoryApi.add({ store: "user", text: "old" }, asHost());
      const view = await memoryView(world);
      const input = {
        store: "user" as const,
        entryId: view.entries[0]?.id ?? "",
        baseHash: view.fileHash,
      };
      return async (target, requestId) =>
        (await target.runtime.memoryApi.remove(input, asHost({ requestId }))).outcome;
    },
  },
  {
    name: "knowledge.memory.manage",
    setup: () =>
      Promise.resolve(async (world, requestId) => {
        const done = await world.runtime.memoryApi.manage(
          { store: "user", action: "add", text: "manage note" },
          asHost({ requestId }),
        );
        return done.outcome;
      }),
  },
  {
    name: "knowledge.ledger.rollback",
    setup: async (world) => {
      await create(world, "setup");
      const entry = (await world.runtime.ledgerApi.list({}, asHost())).entries[0];
      if (entry === undefined) throw new Error("the setup wrote no ledger entry");
      const input = { ledgerId: entry.ledgerId };
      return (target, requestId) => target.runtime.ledgerApi.rollback(input, asHost({ requestId }));
    },
  },
];

async function ledgerCount(world: World): Promise<number> {
  return (await world.runtime.ledgerApi.list({}, asHost())).entries.length;
}

describe("knowledge writes dedupe on requestId across a store reopen", () => {
  for (const { name, setup } of CASES) {
    test(name, async () => {
      const dir = mkdtempSync(join(tmpdir(), "xeon-knowledge-idem-"));
      const path = join(dir, "xeon.db");
      const fs: MemoryFs = createMemoryFs();
      const first = await createWorld({ path, fs });
      let second: World | undefined;
      try {
        const call = await setup(first);
        const base = await ledgerCount(first);

        const applied = await call(first, "idem-key");
        expect(applied.status).toBe("applied");
        expect(await ledgerCount(first)).toBe(base + 1);
        const files = fs.files("/");

        first.runtime.dispose();
        await first.store[Symbol.asyncDispose]();
        second = await createWorld({ path, fs });
        const replayed = await call(second, "idem-key");

        expect(replayed).toEqual(applied);
        expect(await ledgerCount(second)).toBe(base + 1);
        expect(fs.files("/")).toEqual(files);
      } finally {
        second?.runtime.dispose();
        await second?.store[Symbol.asyncDispose]();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  test("a different requestId is a new write", async () => {
    const world = await createWorld();
    const input = { store: "user" as const, text: "likes tea" };
    await world.runtime.memoryApi.add(input, asHost({ requestId: "one" }));
    await world.runtime.memoryApi.add(
      { ...input, text: "likes coffee" },
      asHost({ requestId: "two" }),
    );
    expect(await ledgerCount(world)).toBe(2);
  });
});
