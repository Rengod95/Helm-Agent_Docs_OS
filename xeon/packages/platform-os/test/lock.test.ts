import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import type { OsInfo } from "@xeon/contracts/services";
import { generateBinariesLock, type LockInput } from "../src/binaries/lock.ts";
import {
  createBinaryResolver,
  createNodeBinaryFs,
  parseBinariesLock,
} from "../src/binaries/resolve.ts";
import type { RunCommand } from "../src/proc.ts";
import { tempDir, type TempDir } from "../src/testing/index.ts";
import { memoryLogger } from "./support/clock.ts";

const LINUX: OsInfo = { platform: "linux", arch: "x64", isWsl: false, release: "" };
const signal = new AbortController().signal;
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

let temp: TempDir | undefined;
afterEach(async () => {
  await temp?.remove();
  temp = undefined;
});

async function resourceDir(files: Readonly<Record<string, string>>): Promise<string> {
  temp = await tempDir();
  const root = temp.path;
  await Promise.all(
    Object.entries(files).map(async ([relative, content]) => {
      const full = join(root, relative);
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, content);
      await chmod(full, 0o755);
    }),
  );
  return root;
}

const RG: LockInput = {
  name: "rg",
  platform: "linux",
  arch: "x64",
  path: "bin/rg",
  version: "14.1.1",
};

describe("generateBinariesLock", () => {
  test("hashes each file and writes the shape the resolver reads", async () => {
    const dir = await resourceDir({ "bin/rg": "rg-bytes", "bin/rg-arm": "arm-bytes" });
    const armRg: LockInput = { ...RG, platform: "darwin", arch: "arm64", path: "bin/rg-arm" };
    const text = await generateBinariesLock(dir, [RG, armRg], createNodeBinaryFs());
    expect(text.ok).toBe(true);
    if (!text.ok) return;
    const parsed = parseBinariesLock(text.value);
    expect(parsed).toEqual(
      ok([
        { ...armRg, sha256: sha("arm-bytes") },
        { ...RG, sha256: sha("rg-bytes") },
      ]),
    );
    expect(text.value.endsWith("\n")).toBe(true);
  });

  test("the same inputs give the same text in any input order", async () => {
    const dir = await resourceDir({ "bin/rg": "a", "bin/age": "b" });
    const age: LockInput = { ...RG, name: "age", path: "bin/age", version: "1.2.1" };
    const first = await generateBinariesLock(dir, [RG, age], createNodeBinaryFs());
    const second = await generateBinariesLock(dir, [age, RG], createNodeBinaryFs());
    expect(first).toEqual(second);
  });

  test("a generated list is accepted by the resolver and a tampered file is not", async () => {
    const dir = await resourceDir({ "bin/rg": "original" });
    const text = await generateBinariesLock(dir, [RG], createNodeBinaryFs());
    if (!text.ok) throw new Error("lock generation failed");
    await writeFile(join(dir, "binaries.lock.json"), text.value);
    const runs: string[][] = [];
    const run: RunCommand = (argv) => {
      runs.push([...argv]);
      return Promise.resolve(err({ kind: "spawn_failed", code: "ENOENT" }));
    };
    const resolve = createBinaryResolver({
      info: LINUX,
      resourceDir: dir,
      pathEnv: "",
      fs: createNodeBinaryFs(),
      run,
      logger: memoryLogger().logger,
      lifetime: signal,
    });
    expect(await resolve("rg", {}, signal)).toEqual(
      ok({ name: "rg", path: join(dir, "bin/rg"), version: "14.1.1", source: "bundled" }),
    );

    await writeFile(join(dir, "bin/rg"), "tampered");
    const fresh = createBinaryResolver({
      info: LINUX,
      resourceDir: dir,
      pathEnv: "/usr/bin",
      fs: createNodeBinaryFs(),
      run,
      logger: memoryLogger().logger,
      lifetime: signal,
    });
    expect(await fresh("rg", {}, signal)).toEqual(
      err({
        kind: "integrity_mismatch",
        name: "rg",
        expected: sha("original"),
        actual: sha("tampered"),
      }),
    );
    expect(runs).toEqual([]);
  });

  test("entries that leave the resource directory are refused", async () => {
    const dir = await resourceDir({ "bin/rg": "x" });
    const paths = ["../outside", "/etc/passwd", ".", ""];
    const results = await Promise.all(
      paths.map((path) => generateBinariesLock(dir, [{ ...RG, path }], createNodeBinaryFs())),
    );
    expect(results).toEqual(paths.map((path) => err({ kind: "path_escapes", path })));
  });

  test("a missing file is read_failed with the error code", async () => {
    const dir = await resourceDir({});
    const generated = await generateBinariesLock(dir, [RG], createNodeBinaryFs());
    expect(generated).toEqual(err({ kind: "read_failed", path: "bin/rg", code: "ENOENT" }));
  });

  test("two entries for the same name, platform and arch are refused", async () => {
    const dir = await resourceDir({ "bin/rg": "x", "bin/rg2": "y" });
    const generated = await generateBinariesLock(
      dir,
      [RG, { ...RG, path: "bin/rg2" }],
      createNodeBinaryFs(),
    );
    expect(generated).toEqual(
      err({ kind: "duplicate_entry", name: "rg", platform: "linux", arch: "x64" }),
    );
  });
});
