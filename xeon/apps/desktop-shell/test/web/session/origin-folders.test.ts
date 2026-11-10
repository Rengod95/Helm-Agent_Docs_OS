// 서버 폴더 목록 시험. 홈 기본값, 거절 값, 디렉터리만과 정렬, 심볼릭 링크, 상한 표시를 본다. 값 전체를 `toEqual`로 비교한다.
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Result } from "@fresnel/contracts";
import {
  listOriginFolders,
  type OriginFolderError,
  type OriginFolderListing,
} from "../../../src/web/session/origin-folders.ts";
import { createWebContext } from "../../../src/web/session/web-context.ts";
import { cleanupTempDirs, tempDir } from "../support/fixtures.ts";
import { recordedLog, sessionOptions } from "./support.ts";

afterEach(cleanupTempDirs);

/** 홈 폴더 하나: 디렉터리 넷(대소문자와 점 이름 포함)과 파일 하나. `home`은 만든 그대로, `real`은 실제 경로다 */
function homeTree(): { readonly home: string; readonly real: string } {
  const home = tempDir();
  for (const name of ["Zeta", "alpha", "beta", ".ssh"]) mkdirSync(path.join(home, name));
  writeFileSync(path.join(home, "notes.txt"), "x");
  return { home, real: realpathSync(home) };
}

/** 목록 값. 폴더의 실제 경로가 `real`이고 항목은 그 아래 경로다 */
function listingOf(
  real: string,
  home: string,
  names: readonly string[],
  truncated: boolean,
): OriginFolderListing {
  return {
    path: real,
    parent: path.dirname(real),
    home,
    entries: names.map((name) => ({ name, path: path.join(real, name) })),
    truncated,
  };
}

describe("origin folder listing", () => {
  test("with no path the listing starts at the home folder", () => {
    const { home, real } = homeTree();
    const expected: Result<OriginFolderListing, OriginFolderError> = {
      ok: true,
      value: listingOf(real, home, ["alpha", "beta", "Zeta", ".ssh"], false),
    };
    expect(listOriginFolders(undefined, { home })).toEqual(expected);
    expect(listOriginFolders("", { home })).toEqual(expected);
  });

  test("a relative path, a NUL and a non-string path are bad requests", () => {
    const { home } = homeTree();
    const rejected: Result<OriginFolderListing, OriginFolderError> = {
      ok: false,
      error: "bad-request",
    };
    const requests: unknown[] = ["relative", ".", "~/docs", `${home}\u0000x`, 7];
    expect(requests.map((request) => listOriginFolders(request, { home }))).toEqual([
      rejected,
      rejected,
      rejected,
      rejected,
      rejected,
    ]);
  });

  test("a file or a missing path is read_failed", () => {
    const { home } = homeTree();
    expect(listOriginFolders(path.join(home, "notes.txt"), { home })).toEqual({
      ok: false,
      error: "read_failed",
    });
    expect(listOriginFolders(path.join(home, "absent"), { home })).toEqual({
      ok: false,
      error: "read_failed",
    });
  });

  test("the parent of / is null", () => {
    const { home } = homeTree();
    // 루트의 항목은 기계마다 다르므로 경로와 상위만 본다
    const root = listOriginFolders("/", { home, maxEntries: 0 });
    expect(root.ok ? { path: root.value.path, parent: root.value.parent } : root).toEqual({
      path: "/",
      parent: null,
    });
  });

  test("only folders are listed, in name order with dot folders last", () => {
    const { home, real } = homeTree();
    const child = path.join(home, "alpha");
    for (const name of ["b-dir", "A-dir", "c-dir", ".cache"]) mkdirSync(path.join(child, name));
    writeFileSync(path.join(child, "readme.md"), "x");
    expect(listOriginFolders(child, { home })).toEqual({
      ok: true,
      value: {
        path: path.join(real, "alpha"),
        parent: real,
        home,
        entries: [
          { name: "A-dir", path: path.join(real, "alpha", "A-dir") },
          { name: "b-dir", path: path.join(real, "alpha", "b-dir") },
          { name: "c-dir", path: path.join(real, "alpha", "c-dir") },
          { name: ".cache", path: path.join(real, "alpha", ".cache") },
        ],
        truncated: false,
      },
    });
  });

  test("a symbolic link to a folder is listed; a broken link and a file link are not", () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, "target"));
    writeFileSync(path.join(dir, "note.txt"), "x");
    symlinkSync(path.join(dir, "target"), path.join(dir, "link"));
    symlinkSync(path.join(dir, "absent"), path.join(dir, "broken"));
    symlinkSync(path.join(dir, "note.txt"), path.join(dir, "file-link"));
    const real = realpathSync(dir);
    expect(listOriginFolders(dir, { home: dir })).toEqual({
      ok: true,
      value: listingOf(real, dir, ["link", "target"], false),
    });
  });

  test("the listing stops at the injected cap and says so", () => {
    const dir = tempDir();
    for (const name of ["d1", "d2", "d3"]) mkdirSync(path.join(dir, name));
    const real = realpathSync(dir);
    expect(listOriginFolders(dir, { home: dir, maxEntries: 2 })).toEqual({
      ok: true,
      value: listingOf(real, dir, ["d1", "d2"], true),
    });
    expect(listOriginFolders(dir, { home: dir, maxEntries: 3 })).toEqual({
      ok: true,
      value: listingOf(real, dir, ["d1", "d2", "d3"], false),
    });
  });

  test("a folder that cannot be read is read_failed", () => {
    const dir = tempDir();
    const locked = path.join(dir, "locked");
    mkdirSync(locked);
    chmodSync(locked, 0o000);
    try {
      expect(listOriginFolders(locked, { home: dir })).toEqual({
        ok: false,
        error: "read_failed",
      });
    } finally {
      chmodSync(locked, 0o700);
    }
  });

  test("the command answers the listing and the rejection on the wire", async () => {
    const { home, real } = homeTree();
    const web = createWebContext({
      ...sessionOptions(path.join(tempDir(), "absent.sock"), recordedLog()),
      home,
      deviceId: "dev_test",
      tabId: "tab_test",
      send: () => undefined,
    });
    try {
      expect(await web.dispatch("origin_folder_list", { path: "relative" })).toEqual({
        ok: false,
        error: "bad-request",
      });
      expect(
        await web.dispatch("origin_folder_list", { path: path.join(home, "notes.txt") }),
      ).toEqual({ ok: false, error: "read_failed" });
      expect(await web.dispatch("origin_folder_list", {})).toEqual({
        ok: true,
        value: listingOf(real, home, ["alpha", "beta", "Zeta", ".ssh"], false),
      });
    } finally {
      await web.close();
    }
  });
});
