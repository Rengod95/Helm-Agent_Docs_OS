import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProtectedPathEntry } from "@fresnel/contracts/services";
import { nodeScriptRefReader, readCarveOutsOf } from "../../src/assembly/script-env-host.ts";

const root = mkdtempSync(join(tmpdir(), "script-env-host-"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("nodeScriptRefReader", () => {
  test("stat gives size and mtime, a missing file is ok(null), a folder is unreadable", async () => {
    const file = join(root, "x.py");
    writeFileSync(file, "print(1)\n");
    const seen = await nodeScriptRefReader.stat(file);
    expect(seen.ok && seen.value?.size).toBe(9);
    expect(await nodeScriptRefReader.stat(join(root, "missing.py"))).toEqual({
      ok: true,
      value: null,
    });
    expect(await nodeScriptRefReader.stat(root)).toEqual({
      ok: false,
      error: { kind: "unreadable" },
    });
  });

  test("sha256 is the digest of the bytes with the sha256: prefix", async () => {
    const file = join(root, "h.bin");
    const bytes = new Uint8Array([0, 255, 10, 200]);
    writeFileSync(file, bytes);
    const expected = createHash("sha256").update(bytes).digest("hex");
    expect(await nodeScriptRefReader.sha256(file)).toEqual({
      ok: true,
      value: `sha256:${expected}`,
    });
    expect(await nodeScriptRefReader.sha256(join(root, "nope"))).toEqual({
      ok: false,
      error: { kind: "unreadable" },
    });
  });
});

describe("readCarveOutsOf", () => {
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  const entries: ProtectedPathEntry[] = [
    { path: `${home}/.claude`, match: "prefix", access: "read_write", reason: "agent_credentials" },
    { path: `${home}/.ssh`, match: "prefix", access: "read_write", reason: "secret_key" },
    { path: `${home}/.config/x`, match: "prefix", access: "write", reason: "persistence" },
    { path: ".env", match: "basename", access: "read_write", reason: "credentials" },
  ];
  const carve = readCarveOutsOf(() => entries);

  test("a file below a protected folder opens its own folder so sibling imports work", () => {
    expect(carve([`${home}/.claude/hooks/x.py`])).toEqual([`${home}/.claude/hooks`]);
  });

  test("a file directly in a protected folder opens only that file, never the folder", () => {
    expect(carve([`${home}/.claude/x.py`])).toEqual([`${home}/.claude/x.py`]);
  });

  test("files outside protected paths and under write-only entries need no exception", () => {
    expect(carve([`${home}/proj/hooks/x.sh`, `${home}/.config/x/a.sh`])).toEqual([]);
  });

  test("the result is sorted and without duplicates", () => {
    expect(
      carve([
        `${home}/.ssh/h/b.sh`,
        `${home}/.claude/hooks/b.py`,
        `${home}/.claude/hooks/a.py`,
        `${home}/.claude/c.py`,
      ]),
    ).toEqual([`${home}/.claude/c.py`, `${home}/.claude/hooks`, `${home}/.ssh/h`]);
  });
});
