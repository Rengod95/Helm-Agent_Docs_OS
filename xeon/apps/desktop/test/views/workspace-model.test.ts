import { describe, expect, test } from "bun:test";
import {
  checkWorkspaceInput,
  createFailureText,
  workspaceHint,
} from "../../src/views/workspace-model.ts";

describe("checkWorkspaceInput", () => {
  test("an empty or blank input is no folder", () => {
    expect(checkWorkspaceInput("")).toEqual({ kind: "none" });
    expect(checkWorkspaceInput("   ")).toEqual({ kind: "none" });
  });

  test("absolute POSIX, drive and UNC paths pass trimmed and unchanged", () => {
    expect(checkWorkspaceInput("  /Users/me/project \n")).toEqual({
      kind: "path",
      path: "/Users/me/project",
    });
    expect(checkWorkspaceInput("C:\\work\\app")).toEqual({ kind: "path", path: "C:\\work\\app" });
    expect(checkWorkspaceInput("d:/work")).toEqual({ kind: "path", path: "d:/work" });
    expect(checkWorkspaceInput("\\\\server\\share")).toEqual({
      kind: "path",
      path: "\\\\server\\share",
    });
  });

  test("relative paths and the home shorthand are refused before anything is sent", () => {
    for (const text of ["project", "./project", "../x", "~/project", "C:work"]) {
      expect(checkWorkspaceInput(text)).toEqual({ kind: "invalid", reason: "relative" });
    }
  });

  test("a path over the wire limit is refused", () => {
    expect(checkWorkspaceInput(`/${"a".repeat(4096)}`)).toEqual({
      kind: "invalid",
      reason: "too_long",
    });
    expect(checkWorkspaceInput(`/${"a".repeat(4095)}`).kind).toBe("path");
  });
});

describe("workspace texts", () => {
  test("hints appear only for invalid input", () => {
    expect(workspaceHint({ kind: "none" })).toBeNull();
    expect(workspaceHint({ kind: "path", path: "/x" })).toBeNull();
    expect(workspaceHint({ kind: "invalid", reason: "relative" })).toContain("절대 경로");
    expect(workspaceHint({ kind: "invalid", reason: "too_long" })).toContain("너무 깁니다");
  });

  test("a refused folder is named, any other failure is the general message", () => {
    const refused = { kind: "rejected", code: -32602 } as const;
    expect(createFailureText(refused, true)).toContain("작업 폴더를 열 수 없습니다");
    // 폴더를 보내지 않았다면 폴더 탓이 아니다
    expect(createFailureText(refused, false)).toBe("새 대화를 만들지 못했습니다.");
    expect(createFailureText({ kind: "offline" }, true)).toBe("새 대화를 만들지 못했습니다.");
  });
});
