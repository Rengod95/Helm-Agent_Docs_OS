import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { openTestStore } from "../src/testing/index.ts";
import type { ChildReply } from "./fixtures/lease-child.ts";
import { startChild, type Child } from "./support/child.ts";
import { fixedIdFactory, manualClock } from "./support/clock.ts";
import { tempDir } from "./support/tmp.ts";
import { own, releaseOwned } from "./support/own.ts";

afterEach(releaseOwned);

const THREAD = "thr_01HZZZZZZZZZZZZZZZZZZZZZZZ";
const SESSION = `session:${THREAD}`;
const CHILD = join(import.meta.dir, "fixtures", "lease-child.ts");

async function ask(child: Child, line: string): Promise<ChildReply> {
  const answer = await child.ask(line);
  if (answer === null) throw new Error(`child ended while waiting for ${line}`);
  const parsed: unknown = JSON.parse(answer);
  return typeof parsed === "object" && parsed !== null ? parsed : {};
}

async function ready(child: Child): Promise<void> {
  expect(await child.nextLine()).toBe("READY");
}

async function until<T>(
  attempt: () => Promise<T | undefined>,
  deadline: number = performance.now() + 10_000,
): Promise<T> {
  const value = await attempt();
  if (value !== undefined) return value;
  if (performance.now() > deadline) throw new Error("condition not reached in time");
  await Bun.sleep(50);
  return until(attempt, deadline);
}

async function openShared(path: string): Promise<Awaited<ReturnType<typeof openTestStore>>> {
  const clock = manualClock();
  const store = await openTestStore({ path, clock, ids: fixedIdFactory(clock, "parent") });
  store.root.write((tx) => {
    tx.run("CREATE TABLE t_commit (writer TEXT NOT NULL) STRICT");
  });
  return store;
}

describe("two processes and one session", () => {
  test("two processes own one session and the survivor takes over at once", async () => {
    const dir = own(tempDir());
    const path = dir.join("xeon.db");
    const store = own(await openShared(path));
    const a = startChild(CHILD, [path, "native", "30000"]);
    const b = startChild(CHILD, [path, "native", "30000"]);
    try {
      await ready(a);
      await ready(b);
      const [ra, rb] = await Promise.all([
        ask(a, `acquire ${SESSION} holder-a`),
        ask(b, `acquire ${SESSION} holder-b`),
      ]);
      expect([ra.ok, rb.ok]).toContain(true);
      expect([ra.ok, rb.ok]).toContain(false);
      const [owner, loser, loserId] = ra.ok === true ? [a, b, "holder-b"] : [b, a, "holder-a"];
      const lost = ra.ok === true ? rb : ra;
      expect(lost).toMatchObject({ ok: false, kind: "lock_busy", reason: "os_lock_held" });

      owner.kill("SIGKILL");
      await owner.exited;
      // 임대가 아직 만료되지 않았어도(30초) OS 잠금이 풀렸으므로 바로 인수한다
      const started = performance.now();
      const taken = await ask(loser, `acquire ${SESSION} ${loserId}`);
      expect(taken).toEqual({ ok: true, epoch: 2 });
      expect(performance.now() - started).toBeLessThan(5000);
      const info = store.service.leases.inspect(SESSION);
      expect(info).toMatchObject({ ok: true, value: { holderId: loserId, epoch: 2 } });
      await loser.ask("exit");
    } finally {
      a.kill("SIGKILL");
      b.kill("SIGKILL");
    }
  }, 30_000);

  test.skipIf(process.platform !== "linux")(
    "a stopped owner that wakes up after takeover is fenced",
    async () => {
      const dir = own(tempDir());
      const path = dir.join("xeon.db");
      const store = own(await openShared(path));
      // OS 잠금이 없는 후퇴안(win32 선택)으로 돌려 만료 뒤 인수와 늦은 쓰기 거부를 본다
      const a = startChild(CHILD, [path, "win32", "800"]);
      const b = startChild(CHILD, [path, "win32", "800"]);
      try {
        await ready(a);
        await ready(b);
        expect(await ask(a, `acquire ${SESSION} holder-a`)).toEqual({ ok: true, epoch: 1 });
        // 만료 전에는 살아 있는 프로세스가 쥐고 있으므로 인수할 수 없다
        expect(await ask(b, `acquire ${SESSION} holder-b`)).toMatchObject({
          ok: false,
          reason: "lease_active",
        });
        a.kill("SIGSTOP");
        const taken = await until(async () => {
          const reply = await ask(b, `acquire ${SESSION} holder-b`);
          return reply.ok === true ? reply : undefined;
        });
        expect(taken.epoch).toBe(2);

        a.kill("SIGCONT");
        expect(await ask(a, "holds")).toEqual({ holds: false });
        expect(await ask(a, "commit")).toEqual({ committed: false });
        expect(await ask(a, "renew")).toMatchObject({ ok: false, kind: "lease_lost" });
        expect(await ask(b, "commit")).toEqual({ committed: true });
        const rows = store.root.read((tx) => tx.all("SELECT writer FROM t_commit"));
        expect(rows).toEqual({ ok: true, value: [{ writer: "holder-b" }] });
        await a.ask("exit");
        await b.ask("exit");
      } finally {
        a.kill("SIGKILL");
        b.kill("SIGKILL");
      }
    },
    30_000,
  );
});

describe("first open by several processes", () => {
  test("concurrent first opens of a new database all succeed with one store identity", async () => {
    const dir = own(tempDir());
    const path = dir.join("fresh", "xeon.db");
    const children = [0, 1, 2, 3].map(() => startChild(CHILD, [path, "native", "30000"]));
    try {
      const lines = await Promise.all(children.map((child) => child.nextLine()));
      expect(lines).toEqual(["READY", "READY", "READY", "READY"]);
      const clock = manualClock();
      const store = own(await openTestStore({ path, clock, ids: fixedIdFactory(clock, "late") }));
      const meta = store.root.read((tx) =>
        tx.all("SELECT value FROM sys_meta WHERE key = 'store_id'"),
      );
      expect(meta.ok && meta.value).toHaveLength(1);
      const versions = store.root.read((tx) =>
        tx.all("SELECT version FROM sys_migrations WHERE owner = 'sys' ORDER BY version"),
      );
      expect(versions).toEqual({
        ok: true,
        value: [{ version: 1 }, { version: 2 }, { version: 3 }],
      });
      await Promise.all(children.map((child) => child.ask("exit")));
    } finally {
      for (const child of children) child.kill("SIGKILL");
    }
  }, 30_000);
});
