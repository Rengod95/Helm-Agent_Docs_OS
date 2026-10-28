import { afterEach, describe, expect, test } from "bun:test";
import { eachAsync } from "@xeon/contracts";
import { SCAN_RULESET_VERSION } from "../src/scan/rules.ts";
import type { ChangeSpec } from "../src/ledger/change.ts";
import { hashOfTarget, readTarget, type ChangeTarget } from "../src/ledger/target.ts";
import { treeHash } from "../src/skills/tree.ts";
import { rejection, treeFrom, asHost, MODEL, idem } from "./support/helpers.ts";
import { closeWorlds, createWorld, USER_SKILLS, type World } from "./support/world.ts";

afterEach(closeWorlds);

const SCAN = { rulesetVersion: SCAN_RULESET_VERSION, findings: [] };
const SKILL_DIR = `${USER_SKILLS}/deploy`;
const MEMORY_FILE = "/data/memory/USER.md";

function skillTarget(): ChangeTarget {
  return { kind: "skill", name: "deploy", scope: "user", path: SKILL_DIR };
}

function memoryTarget(): ChangeTarget {
  return { kind: "memory", name: "user", path: MEMORY_FILE };
}

function skillText(body: string): string {
  return `---\nname: deploy\ndescription: Deploy steps.\n---\n${body}`;
}

function spec(
  overrides: Partial<ChangeSpec> & Pick<ChangeSpec, "target" | "next" | "op">,
): ChangeSpec {
  return {
    actor: { kind: "user" },
    requestId: undefined,
    baseHash: undefined,
    removal: "archive",
    scan: SCAN,
    approvedBy: "user",
    evidence: undefined,
    reason: undefined,
    proposalId: undefined,
    rollbackOf: undefined,
    captureFailure: "internal",
    ...overrides,
  };
}

async function hashOf(world: World, target: ChangeTarget): Promise<string | null> {
  const tree = await readTarget(world.fs, target);
  if (!tree.ok) throw new Error(tree.error.message);
  return hashOfTarget(target.kind, tree.value);
}

function rollback(world: World, ledgerId: string, requestId?: string) {
  return world.runtime.ledgerApi.rollback(
    { ledgerId },
    asHost(requestId === undefined ? {} : { requestId }),
  );
}

describe("ledger", () => {
  test("ledger round trip", async () => {
    const world = await createWorld();
    const created = treeFrom({ "SKILL.md": skillText("v1\n"), "references/a.md": "A" });
    const edited = treeFrom({
      "SKILL.md": skillText("v2\n"),
      "references/a.md": "A",
      "scripts/x.sh": "x",
    });
    const trimmed = treeFrom({ "SKILL.md": skillText("v2\n") });

    const steps: [string, ReturnType<typeof treeFrom> | null, ChangeSpec["op"]][] = [
      ["create", created, "skill.create"],
      ["edit", edited, "skill.edit"],
      ["remove file", trimmed, "skill.write_file"],
      ["archive", null, "skill.archive"],
    ];
    const hashes: (string | null)[] = [await hashOf(world, skillTarget())];
    const ledgerIds: string[] = [];
    await eachAsync(steps, async ([, next, op]) => {
      const result = await world.executor.apply(spec({ target: skillTarget(), next, op }));
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.status).toBe("applied");
      ledgerIds.push(result.value.ledgerId ?? "");
      hashes.push(await hashOf(world, skillTarget()));
      return undefined;
    });
    expect(hashes[0]).toBeNull();
    expect(hashes[4]).toBeNull();
    expect(new Set(hashes.slice(1, 4)).size).toBe(3);

    // 마지막부터 거꾸로 되돌리면 해시가 각 단계 이전 값으로 돌아간다
    await eachAsync([3, 2, 1, 0], async (index) => {
      const rolled = await rollback(world, ledgerIds[index] ?? "");
      expect(rolled.status).toBe("applied");
      expect(await hashOf(world, skillTarget())).toBe(hashes[index] ?? null);
      return undefined;
    });
    // 생성의 되돌림은 보관함 이동이다
    expect(world.fs.has(SKILL_DIR)).toBe(false);
    const archived = world.fs.has(`${USER_SKILLS}/.archive`);
    expect(archived).toBe(true);

    // 되돌림도 원장에 남는다: 항목 4 + 되돌림 4
    const listed = await world.runtime.ledgerApi.list({}, asHost());
    expect(listed.entries.filter((entry) => entry.op === "rollback")).toHaveLength(4);
    expect(listed.entries).toHaveLength(8);
    const first = listed.entries.find((entry) => entry.ledgerId === ledgerIds[0]);
    expect(first?.rolledBackBy).toBeDefined();
    expect(first?.actor).toEqual({ kind: "user" });
  });

  test("memory file round trip", async () => {
    const world = await createWorld();
    const add = await world.executor.apply(
      spec({ target: memoryTarget(), next: treeFrom({ "USER.md": "one\n" }), op: "memory.add" }),
    );
    if (!add.ok) throw new Error(add.error.message);
    const replace = await world.executor.apply(
      spec({
        target: memoryTarget(),
        next: treeFrom({ "USER.md": "two\n" }),
        op: "memory.replace",
      }),
    );
    if (!replace.ok) throw new Error(replace.error.message);
    expect(world.fs.text(MEMORY_FILE)).toBe("two\n");
    await rollback(world, replace.value.ledgerId ?? "");
    expect(world.fs.text(MEMORY_FILE)).toBe("one\n");
    await rollback(world, add.value.ledgerId ?? "");
    expect(world.fs.has(MEMORY_FILE)).toBe(false);
  });

  test("rollback refused when safe capture fails", async () => {
    const world = await createWorld();
    const first = await world.executor.apply(
      spec({
        target: skillTarget(),
        next: treeFrom({ "SKILL.md": skillText("v1\n") }),
        op: "skill.create",
      }),
    );
    if (!first.ok) throw new Error(first.error.message);
    const second = await world.executor.apply(
      spec({
        target: skillTarget(),
        next: treeFrom({ "SKILL.md": skillText("v2\n") }),
        op: "skill.edit",
      }),
    );
    if (!second.ok) throw new Error(second.error.message);
    const before = world.fs.files(SKILL_DIR);
    const rows = await world.store.rowCounts();

    world.blobFault.putFails = true;
    const error = await rejection(rollback(world, second.value.ledgerId ?? ""));
    expect(error.data.code).toBe("rollback_unsafe");
    expect(error.data.retryable).toBe(true);
    expect(world.fs.files(SKILL_DIR)).toEqual(before);
    expect(await world.store.rowCounts()).toEqual(rows);
  });

  test("write refused when safe capture fails", async () => {
    const world = await createWorld();
    const created = await world.executor.apply(
      spec({
        target: skillTarget(),
        next: treeFrom({ "SKILL.md": skillText("v1\n") }),
        op: "skill.create",
      }),
    );
    if (!created.ok) throw new Error(created.error.message);
    const before = world.fs.files(SKILL_DIR);
    const rows = await world.store.rowCounts();

    world.blobFault.putFails = true;
    const result = await world.executor.apply(
      spec({
        target: skillTarget(),
        next: treeFrom({ "SKILL.md": skillText("v2\n") }),
        op: "skill.edit",
      }),
    );
    expect(result.ok ? "ok" : result.error.kind).toBe("internal");
    expect(world.fs.files(SKILL_DIR)).toEqual(before);
    // prepared 행도 남지 않는다
    expect(await world.store.rowCounts()).toEqual(rows);
  });

  test("rollback conflict", async () => {
    const world = await createWorld();
    const first = await world.executor.apply(
      spec({
        target: skillTarget(),
        next: treeFrom({ "SKILL.md": skillText("v1\n") }),
        op: "skill.create",
      }),
    );
    const second = await world.executor.apply(
      spec({
        target: skillTarget(),
        next: treeFrom({ "SKILL.md": skillText("v2\n") }),
        op: "skill.edit",
      }),
    );
    if (!first.ok || !second.ok) throw new Error("setup failed");
    const error = await rejection(rollback(world, first.value.ledgerId ?? ""));
    expect(error.data.code).toBe("rollback_conflict");
    expect(world.fs.text(`${SKILL_DIR}/SKILL.md`)).toContain("v2");
    // 이미 되돌린 항목은 다시 되돌릴 수 없다
    await rollback(world, second.value.ledgerId ?? "");
    const again = await rejection(rollback(world, second.value.ledgerId ?? ""));
    expect(again.data.code).toBe("invalid_input");
  });

  test("a model caller cannot roll back directly: the rollback is queued and the files stay", async () => {
    const world = await createWorld();
    const created = await world.executor.apply(
      spec({
        target: skillTarget(),
        next: treeFrom({ "SKILL.md": skillText("v1\n") }),
        op: "skill.create",
      }),
    );
    if (!created.ok) throw new Error(created.error.message);
    // 모델에는 롤백 도구가 없지만 서비스는 호출 문맥으로 행위자를 가린다. 세션이 없는 모델 호출은 대기열로 간다
    const queued = await world.runtime.ledgerApi.rollback(
      { ledgerId: created.value.ledgerId ?? "" },
      { context: MODEL },
    );
    expect(queued.status).toBe("queued");
    expect(world.fs.has(SKILL_DIR)).toBe(true);
    const noContext = await rejection(
      world.runtime.ledgerApi.rollback({ ledgerId: created.value.ledgerId ?? "" }),
    );
    expect(noContext.data.code).toBe("denied");
    expect(world.fs.has(SKILL_DIR)).toBe(true);
  });

  test("base stale", async () => {
    const world = await createWorld();
    const created = await world.executor.apply(
      spec({
        target: skillTarget(),
        next: treeFrom({ "SKILL.md": skillText("v1\n") }),
        op: "skill.create",
      }),
    );
    if (!created.ok) throw new Error(created.error.message);
    const before = world.fs.files(SKILL_DIR);
    const stale = await world.executor.apply(
      spec({
        target: skillTarget(),
        next: treeFrom({ "SKILL.md": skillText("v2\n") }),
        op: "skill.edit",
        baseHash: "0".repeat(64),
      }),
    );
    expect(stale.ok ? "ok" : stale.error.kind).toBe("base_stale");
    expect(world.fs.files(SKILL_DIR)).toEqual(before);
    const current = treeHash(treeFrom({ "SKILL.md": skillText("v1\n") }));
    const fresh = await world.executor.apply(
      spec({
        target: skillTarget(),
        next: treeFrom({ "SKILL.md": skillText("v2\n") }),
        op: "skill.edit",
        baseHash: current,
      }),
    );
    expect(fresh.ok).toBe(true);
  });

  test("idempotent request id", async () => {
    const world = await createWorld();
    const request = spec({
      target: skillTarget(),
      next: treeFrom({ "SKILL.md": skillText("v1\n") }),
      op: "skill.create",
      requestId: idem("req-1"),
    });
    const first = await world.executor.apply(request);
    const second = await world.executor.apply(
      spec({ ...request, next: treeFrom({ "SKILL.md": skillText("different\n") }) }),
    );
    if (!first.ok || !second.ok) throw new Error("apply failed");
    expect(second.value).toEqual(first.value);
    expect(world.fs.text(`${SKILL_DIR}/SKILL.md`)).toContain("v1");
    const listed = await world.runtime.ledgerApi.list({}, asHost());
    expect(listed.entries).toHaveLength(1);
  });

  test("a failed write restores the previous content and aborts the row", async () => {
    const world = await createWorld();
    const created = await world.executor.apply(
      spec({
        target: skillTarget(),
        next: treeFrom({ "SKILL.md": skillText("v1\n"), "references/a.md": "A" }),
        op: "skill.create",
      }),
    );
    if (!created.ok) throw new Error(created.error.message);
    const before = world.fs.files(SKILL_DIR);
    world.fs.failNext("writeAtomic", "references/a.md", "disk_full");
    const result = await world.executor.apply(
      spec({
        target: skillTarget(),
        next: treeFrom({ "SKILL.md": skillText("v2\n"), "references/a.md": "B" }),
        op: "skill.edit",
        requestId: idem("req-2"),
      }),
    );
    expect(result.ok ? "ok" : result.error.kind).toBe("unavailable");
    expect(world.fs.files(SKILL_DIR)).toEqual(before);
    const listed = await world.runtime.ledgerApi.list({}, asHost());
    expect(listed.entries).toHaveLength(1);
    // 중단한 행은 멱등 키를 비워 같은 키로 다시 시도할 수 있다
    const retry = await world.executor.apply(
      spec({
        target: skillTarget(),
        next: treeFrom({ "SKILL.md": skillText("v2\n"), "references/a.md": "B" }),
        op: "skill.edit",
        requestId: idem("req-2"),
      }),
    );
    expect(retry.ok).toBe(true);
  });

  test("recover prepared rows", async () => {
    const { recoverPrepared } = await import("../src/ledger/recover.ts");
    const { insertRecord } = await import("../src/ledger/rows.ts");
    const world = await createWorld();
    const afterTree = treeFrom({ "SKILL.md": skillText("v1\n") });
    const afterHash = treeHash(afterTree);
    const prepare = (ledgerId: string, hash: string | null): void => {
      const written = world.deps.db.write((tx) => {
        insertRecord(tx, {
          ledgerId,
          at: world.clock.now(),
          actor: { kind: "user" },
          target: skillTarget(),
          op: "skill.create",
          beforeHash: null,
          afterHash: hash,
          beforeManifest: null,
          afterManifest: null,
          requestId: undefined,
          approvedBy: "user",
          evidence: undefined,
          scan: SCAN,
          reason: undefined,
          proposalId: undefined,
          rollbackOf: undefined,
          status: "prepared",
          indexChanged: false,
          outcome: undefined,
        });
      });
      if (!written.ok) throw new Error("insert failed");
    };
    // 파일이 이미 after 상태면 applied, 아직 before 상태(없음)면 aborted
    prepare("knl_0000000000000000000000AAAA", afterHash);
    prepare("knl_0000000000000000000000BBBB", "f".repeat(64));
    world.fs.put(`${SKILL_DIR}/SKILL.md`, skillText("v1\n"));
    const report = await recoverPrepared(world.deps);
    expect(report).toEqual({ ok: true, value: { applied: 1, aborted: 1 } });
    const listed = await world.runtime.ledgerApi.list({}, asHost());
    expect(listed.entries.map((entry) => entry.ledgerId)).toEqual([
      "knl_0000000000000000000000AAAA",
    ]);
  });
});
