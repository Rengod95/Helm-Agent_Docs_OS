import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, stat } from "node:fs/promises";
import { err, ok } from "@xeon/contracts";
import type { OsDirs } from "@xeon/contracts/services";
import { createNodeDirFs, ensureDirs, type DirFs } from "../src/dirs.ts";
import { tempDir, type TempDir } from "../src/testing/index.ts";
import { exists } from "./support/json.ts";

let temp: TempDir | undefined;
afterEach(async () => {
  await temp?.remove();
  temp = undefined;
});

async function makeDirs(): Promise<OsDirs> {
  temp = await tempDir();
  const root = temp.path;
  return {
    home: `${root}/home`,
    data: `${root}/state-root/data/xeon`,
    config: `${root}/state-root/config/xeon`,
    cache: `${root}/state-root/cache/xeon`,
    state: `${root}/state-root/state/xeon`,
    runtime: `${root}/run/xeon`,
    resource: `${root}/resource`,
    tmp: `${root}/tmp/xeon-1`,
  };
}

const uid = process.getuid?.();
const permissionBits = process.platform === "win32" ? test.skip : test;

describe("ensureDirs", () => {
  permissionBits("0700 생성", async () => {
    const dirs = await makeDirs();
    const result = await ensureDirs(dirs, createNodeDirFs(uid), new AbortController().signal);
    expect(result).toEqual({ ok: true, value: undefined });
    const all = [dirs.data, dirs.config, dirs.cache, dirs.state, dirs.runtime, dirs.tmp];
    const stats = await Promise.all(all.map((dir) => stat(dir)));
    expect(stats.map((st) => st.isDirectory())).toEqual(all.map(() => true));
    expect(stats.map((st) => st.mode & 0o777)).toEqual(all.map(() => 0o700));
  });

  permissionBits("home과 resource는 만들지 않는다", async () => {
    const dirs = await makeDirs();
    await ensureDirs(dirs, createNodeDirFs(uid), new AbortController().signal);
    expect(await exists(dirs.home)).toBe(false);
    expect(await exists(dirs.resource)).toBe(false);
  });

  permissionBits("이미 있고 0700이면 그대로 통과한다(두 번 불러도 같다)", async () => {
    const dirs = await makeDirs();
    const fs = createNodeDirFs(uid);
    const signal = new AbortController().signal;
    expect((await ensureDirs(dirs, fs, signal)).ok).toBe(true);
    expect((await ensureDirs(dirs, fs, signal)).ok).toBe(true);
  });

  permissionBits("권한 검사: 0755 기존 디렉터리는 permission_too_open", async () => {
    const dirs = await makeDirs();
    await mkdir(dirs.data, { recursive: true, mode: 0o755 });
    await chmod(dirs.data, 0o755);
    const result = await ensureDirs(dirs, createNodeDirFs(uid), new AbortController().signal);
    expect(result).toEqual({
      ok: false,
      error: { kind: "permission_too_open", path: dirs.data, mode: 0o755 },
    });
    // 자동으로 고치지 않는다
    expect((await stat(dirs.data)).mode & 0o777).toBe(0o755);
  });

  test("소유 검사: 소유 uid 불일치는 주입된 stat으로 not_owned", async () => {
    const dirs = await makeDirs();
    const foreign: DirFs = {
      uid: 1000,
      stat: () => Promise.resolve(ok({ isDirectory: true, mode: 0o40_700, uid: 4242 })),
      mkdir: () => Promise.resolve(ok(undefined)),
    };
    const result = await ensureDirs(dirs, foreign, new AbortController().signal);
    expect(result).toEqual({ ok: false, error: { kind: "not_owned", path: dirs.data } });
  });

  test("Windows(uid 없음)는 소유자와 권한 비트를 검사하지 않는다", async () => {
    const dirs = await makeDirs();
    const windows: DirFs = {
      uid: undefined,
      stat: () => Promise.resolve(ok({ isDirectory: true, mode: 0o40_777, uid: 0 })),
      mkdir: () => Promise.resolve(ok(undefined)),
    };
    expect((await ensureDirs(dirs, windows, new AbortController().signal)).ok).toBe(true);
  });

  test("디렉터리가 아닌 파일이 있으면 io(ENOTDIR)", async () => {
    const dirs = await makeDirs();
    const fileLike: DirFs = {
      uid: 1000,
      stat: () => Promise.resolve(ok({ isDirectory: false, mode: 0o100_600, uid: 1000 })),
      mkdir: () => Promise.resolve(ok(undefined)),
    };
    expect(await ensureDirs(dirs, fileLike, new AbortController().signal)).toEqual({
      ok: false,
      error: { kind: "io", path: dirs.data, code: "ENOTDIR" },
    });
  });

  test("stat·mkdir 오류는 io로 돌려준다", async () => {
    const dirs = await makeDirs();
    const failing: DirFs = {
      uid: 1000,
      stat: () => Promise.resolve(ok(undefined)),
      mkdir: () => Promise.resolve(err({ code: "EACCES" })),
    };
    expect(await ensureDirs(dirs, failing, new AbortController().signal)).toEqual({
      ok: false,
      error: { kind: "io", path: dirs.data, code: "EACCES" },
    });
  });

  test("중단 신호는 io(ABORT_ERR)로 끝낸다", async () => {
    const dirs = await makeDirs();
    const controller = new AbortController();
    controller.abort();
    const result = await ensureDirs(dirs, createNodeDirFs(uid), controller.signal);
    expect(result).toEqual({
      ok: false,
      error: { kind: "io", path: dirs.data, code: "ABORT_ERR" },
    });
  });
});
