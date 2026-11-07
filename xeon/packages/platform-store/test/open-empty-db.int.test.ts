import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { openStore } from "../src/index.ts";
import { compactTimestamp } from "../src/snapshot.ts";
import { manualClock } from "./support/clock.ts";
import { own, releaseOwned } from "./support/own.ts";
import { directOptions } from "./support/store.ts";
import { tempDir } from "./support/tmp.ts";

afterEach(releaseOwned);

describe("opening a zero-byte database file (L0.store.spec §4.4)", () => {
  test("the empty file is moved aside under a dated name and a new database opens in its place", async () => {
    const dir = own(tempDir());
    const realDir = realpathSync(dir.path);
    const path = join(realDir, "fresnel.db");
    writeFileSync(path, "");
    const clock = manualClock();
    const movedTo = join(realDir, `fresnel.db.broken-${compactTimestamp(clock.now())}`);

    const opened = await openStore(directOptions(path, {}, clock).options);
    if (!opened.ok) throw new Error(`open failed: ${opened.error.kind}`);
    const store = own(opened.value);

    expect(store.warnings).toEqual([{ kind: "empty_replaced", path, movedTo }]);
    expect(statSync(movedTo).size).toBe(0);
    expect(statSync(path).size).toBeGreaterThan(0);
    expect(
      store.root.read((tx) => tx.all("SELECT value FROM sys_meta WHERE key = 'store_id'")),
    ).toEqual({
      ok: true,
      value: [{ value: expect.stringMatching(/^sto_/) }],
    });
  });

  test("a second open of the database that replaced it reports nothing", async () => {
    const dir = own(tempDir());
    const path = join(realpathSync(dir.path), "fresnel.db");
    writeFileSync(path, "");
    const first = await openStore(directOptions(path).options);
    if (!first.ok) throw new Error(`first open failed: ${first.error.kind}`);
    await first.value.close();

    const second = await openStore(directOptions(path).options);
    if (!second.ok) throw new Error(`second open failed: ${second.error.kind}`);
    own(second.value);
    expect(second.value.warnings.filter((w) => w.kind === "empty_replaced")).toEqual([]);
  });

  test("a -wal file moves with the empty database under the same suffix", async () => {
    const dir = own(tempDir());
    const realDir = realpathSync(dir.path);
    const path = join(realDir, "fresnel.db");
    writeFileSync(path, "");
    writeFileSync(`${path}-wal`, "wal-bytes");
    const clock = manualClock();
    const movedTo = join(realDir, `fresnel.db.broken-${compactTimestamp(clock.now())}`);

    const opened = await openStore(directOptions(path, {}, clock).options);
    if (!opened.ok) throw new Error(`open failed: ${opened.error.kind}`);
    own(opened.value);

    expect(opened.value.warnings).toEqual([{ kind: "empty_replaced", path, movedTo }]);
    expect(readFileSync(`${movedTo}-wal`, "utf8")).toBe("wal-bytes");
    expect(existsSync(`${movedTo}-shm`)).toBe(false);
  });

  test("a database file that does not exist yet reports no moved file", async () => {
    const dir = own(tempDir());
    const opened = await openStore(
      directOptions(join(realpathSync(dir.path), "fresnel.db")).options,
    );
    if (!opened.ok) throw new Error(`open failed: ${opened.error.kind}`);
    own(opened.value);
    expect(opened.value.warnings.filter((w) => w.kind === "empty_replaced")).toEqual([]);
  });

  test("a name that is already taken is never overwritten, and the open is an io error", async () => {
    const dir = own(tempDir());
    const realDir = realpathSync(dir.path);
    const path = join(realDir, "fresnel.db");
    writeFileSync(path, "");
    const clock = manualClock();
    const taken = join(realDir, `fresnel.db.broken-${compactTimestamp(clock.now())}`);
    writeFileSync(taken, "earlier copy");

    const opened = await openStore(directOptions(path, {}, clock).options);

    expect(opened).toEqual({ ok: false, error: { kind: "io", code: "EEXIST" } });
    expect(readFileSync(taken, "utf8")).toBe("earlier copy");
    expect(statSync(path).size).toBe(0);
  });

  test("a read-only open leaves the empty file alone and refuses it as a foreign database", async () => {
    const dir = own(tempDir());
    const realDir = realpathSync(dir.path);
    const path = join(realDir, "fresnel.db");
    writeFileSync(path, "");

    const opened = await openStore(directOptions(path, { readOnly: true }).options);

    expect(opened).toEqual({ ok: false, error: { kind: "foreign_database", applicationId: 0 } });
    expect(statSync(path).size).toBe(0);
    expect(readdirSync(realDir).filter((name) => name.includes(".broken-"))).toEqual([]);
  });
});
