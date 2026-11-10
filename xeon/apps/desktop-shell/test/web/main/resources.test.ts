// 사이드카 폴더 고르기: 개발 트리는 셸 패키지 폴더, 빌드된 게이트웨이는 실행 파일 옆(패키지 앱의 Resources)이다.
import { describe, expect, test } from "bun:test";
import path from "node:path";
import { resourcesDirOf } from "../../../src/web/main/resources.ts";

describe("resourcesDirOf", () => {
  test("the development tree looks in the desktop-shell package folder, two levels above src/web", () => {
    expect(resourcesDirOf("/work/fxWK/xeon/apps/desktop-shell/src/web", "/usr/local/bin/bun")).toBe(
      "/work/fxWK/xeon/apps/desktop-shell",
    );
  });

  test("a built gateway (bun --compile, /$bunfs/root) looks next to its own program, not at /", () => {
    const execPath = "/Applications/Fresnel.app/Contents/Resources/fresnel-web";
    expect(resourcesDirOf("/$bunfs/root", execPath)).toBe(
      "/Applications/Fresnel.app/Contents/Resources",
    );
  });

  test("a built gateway on Windows (B:\\~BUN\\root) is recognized the same way", () => {
    const execPath = "C:\\Fresnel\\resources\\fresnel-web.exe";
    expect(resourcesDirOf("B:\\~BUN\\root", execPath)).toBe(path.dirname(execPath));
  });

  test("a folder that only merely contains the word bunfs is not a built gateway", () => {
    expect(resourcesDirOf("/home/u/bunfs-notes/apps/desktop-shell/src/web", "/x/bun")).toBe(
      "/home/u/bunfs-notes/apps/desktop-shell",
    );
  });
});
