import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { Result } from "@xeon/contracts";
import { pruneSpill, spillUsageBytes, type SpillError } from "../src/spill-store.ts";

// L0.exec.spec §3.8.2 [결정: M3-REQ-47]: 보관 정리와 사용량. 시각은 주입한 기준 시각에서 거꾸로 맞춘다.

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 9, 29);
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    // 읽기 전용으로 바꾼 디렉터리를 되돌린 뒤 지운다
    rmSync(root, { recursive: true, force: true });
  }
});

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "xeon-spill-store-"));
  roots.push(dir);
  return dir;
}

/** 파일을 쓰고 mtime을 기준 시각에서 `daysAgo`일 전으로 맞춘다 */
function fileAged(path: string, bytes: number, daysAgo: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "x".repeat(bytes));
  const when = new Date(NOW - daysAgo * DAY_MS);
  utimesSync(path, when, when);
}

/** 디렉터리 mtime을 맞춘다. 안에 파일을 더 쓰거나 지우면 시각이 바뀌므로 마지막에 부른다 */
function dirAged(path: string, daysAgo: number): void {
  const when = new Date(NOW - daysAgo * DAY_MS);
  utimesSync(path, when, when);
}

function valueOf<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error("expected ok");
  return result.value;
}

function errorOf<T, E>(result: Result<T, E>): E {
  if (result.ok) throw new Error("expected an error");
  return result.error;
}

describe("pruneSpill", () => {
  test("maxAgeDays 0 removes nothing and reports zeros", () => {
    const dir = join(root(), "spill");
    fileAged(join(dir, "old.log"), 5, 400);
    fileAged(join(dir, "tmp-a", "old.log"), 7, 400);
    dirAged(join(dir, "tmp-a"), 400);
    const report = valueOf(pruneSpill({ dir, maxAgeDays: 0, now: NOW }));
    expect(report).toEqual({ removed: 0, bytesFreed: 0, failed: 0 });
    expect(existsSync(join(dir, "old.log"))).toBe(true);
    expect(existsSync(join(dir, "tmp-a", "old.log"))).toBe(true);
  });

  test("maxAgeDays 0 does not read a missing directory", () => {
    const report = valueOf(pruneSpill({ dir: join(root(), "absent"), maxAgeDays: 0, now: NOW }));
    expect(report).toEqual({ removed: 0, bytesFreed: 0, failed: 0 });
  });

  test("maxAgeDays 7 deletes only the older regular files and the empty old tmp directories", () => {
    const dir = join(root(), "spill");
    fileAged(join(dir, "old.log"), 10, 10);
    fileAged(join(dir, "new.log"), 4, 1);
    fileAged(join(dir, "tmp-a", "old.log"), 3, 30);
    fileAged(join(dir, "tmp-a", "new.log"), 6, 2);
    dirAged(join(dir, "tmp-a"), 30);
    mkdirSync(join(dir, "tmp-b"));
    dirAged(join(dir, "tmp-b"), 20);
    // tmp-* 밖의 하위 디렉터리는 건드리지 않는다
    fileAged(join(dir, "keep", "old.log"), 2, 30);

    const report = valueOf(pruneSpill({ dir, maxAgeDays: 7, now: NOW }));

    expect(report).toEqual({ removed: 2, bytesFreed: 13, failed: 0 });
    expect(existsSync(join(dir, "old.log"))).toBe(false);
    expect(existsSync(join(dir, "new.log"))).toBe(true);
    expect(existsSync(join(dir, "tmp-a", "old.log"))).toBe(false);
    expect(existsSync(join(dir, "tmp-a", "new.log"))).toBe(true);
    expect(existsSync(join(dir, "tmp-b"))).toBe(false);
    expect(existsSync(join(dir, "keep", "old.log"))).toBe(true);
  });

  test("a symlink pointing outside the directory is neither followed nor removed", () => {
    const work = root();
    const dir = join(work, "spill");
    const outside = join(work, "outside");
    fileAged(join(outside, "target.log"), 9, 400);
    fileAged(join(dir, "old.log"), 4, 400);
    symlinkSync(join(outside, "target.log"), join(dir, "link.log"));
    symlinkSync(outside, join(dir, "tmp-ext"), "dir");

    const report = valueOf(pruneSpill({ dir, maxAgeDays: 7, now: NOW }));

    expect(report).toEqual({ removed: 1, bytesFreed: 4, failed: 0 });
    expect(existsSync(join(outside, "target.log"))).toBe(true);
    expect(lstatSync(join(dir, "link.log")).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(dir, "tmp-ext")).isSymbolicLink()).toBe(true);
  });

  test("a file that cannot be deleted is counted in failed and the others are still removed", () => {
    // 권한 검사를 피하는 사용자(root)에서는 삭제가 막히지 않으므로 POSIX 비루트에서만 본다
    if (process.platform === "win32" || process.getuid?.() === 0) return;
    const dir = join(root(), "spill");
    fileAged(join(dir, "tmp-ro", "stuck.log"), 8, 40);
    fileAged(join(dir, "tmp-ro", "other.log"), 3, 40);
    dirAged(join(dir, "tmp-ro"), 40);
    chmodSync(join(dir, "tmp-ro"), 0o500);
    try {
      fileAged(join(dir, "free.log"), 5, 40);
      const report = valueOf(pruneSpill({ dir, maxAgeDays: 7, now: NOW }));
      expect(report).toEqual({ removed: 1, bytesFreed: 5, failed: 2 });
      expect(existsSync(join(dir, "free.log"))).toBe(false);
      expect(existsSync(join(dir, "tmp-ro", "stuck.log"))).toBe(true);
    } finally {
      chmodSync(join(dir, "tmp-ro"), 0o700);
    }
  });

  test("a negative or fractional maxAgeDays is an invalid_max_age error", () => {
    const dir = root();
    expect(errorOf(pruneSpill({ dir, maxAgeDays: -1, now: NOW }))).toEqual({
      kind: "invalid_max_age",
      maxAgeDays: -1,
    });
    expect(errorOf(pruneSpill({ dir, maxAgeDays: 1.5, now: NOW })).kind).toBe("invalid_max_age");
  });

  test("a spill path that is not a directory is an unreadable error", () => {
    const file = join(root(), "not-a-dir");
    writeFileSync(file, "x");
    const error: SpillError = errorOf(pruneSpill({ dir: file, maxAgeDays: 7, now: NOW }));
    expect(error.kind).toBe("unreadable");
    expect(existsSync(file)).toBe(true);
  });
});

describe("spillUsageBytes", () => {
  test("sums regular files recursively and does not follow symlinks", async () => {
    const work = root();
    const dir = join(work, "spill");
    fileAged(join(dir, "a.log"), 3, 1);
    fileAged(join(dir, "tmp-a", "b.log"), 5, 1);
    fileAged(join(dir, "tmp-a", "deeper", "c.log"), 7, 1);
    fileAged(join(work, "outside.log"), 100, 1);
    symlinkSync(join(work, "outside.log"), join(dir, "link.log"));

    expect(valueOf(await spillUsageBytes(dir))).toBe(15);
  });

  test("a missing directory uses 0 bytes", async () => {
    expect(valueOf(await spillUsageBytes(join(root(), "absent")))).toBe(0);
  });
});
