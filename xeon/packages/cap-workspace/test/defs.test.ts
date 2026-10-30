import { describe, expect, test } from "bun:test";
import {
  orderTools,
  validateCapability,
  validateCapabilitySet,
  WorkspaceFiles,
  WorkspaceImages,
  WorkspaceShell,
  type AnyCapabilityDef,
} from "@xeon/contracts/capabilities";

const ALL: readonly AnyCapabilityDef[] = [WorkspaceFiles, WorkspaceShell, WorkspaceImages];

describe("workspace definitions", () => {
  test("workspace defs have no issues", () => {
    for (const def of ALL) expect(validateCapability(def)).toEqual([]);
    expect(validateCapabilitySet(ALL)).toEqual([]);
  });

  test("every declared files tool is implemented and advertised", () => {
    // 여섯 도구가 모두 구현되어 광고된다(plugin.ts의 등록이 WorkspaceFiles 정의 그대로를 쓴다)
    expect(WorkspaceFiles.tools.map((tool) => tool.name)).toEqual([
      "read",
      "write",
      "edit",
      "ls",
      "grep",
      "find",
    ]);
  });

  test("replay and execution policy declared", () => {
    const tools = [...WorkspaceFiles.tools, ...WorkspaceShell.tools];
    expect(tools.map((tool) => tool.name).toSorted()).toEqual([
      "bash",
      "edit",
      "find",
      "grep",
      "ls",
      "read",
      "write",
    ]);
    const methods = { ...WorkspaceFiles.service.methods, ...WorkspaceShell.service.methods };
    for (const tool of tools) {
      const method = methods[tool.method];
      expect(method.replay).toBe(tool.replay);
      if (["read", "ls", "grep", "find"].includes(tool.name)) {
        expect(tool.replay).toBe("safe");
        expect(tool.executionMode).toBe("parallel");
        expect(tool.hints?.readOnly).toBe(true);
      } else {
        expect(tool.replay).toBe("unsafe");
      }
    }
    const images = WorkspaceImages.service.methods;
    expect([images.load.replay, images.resize.replay, images.register.replay]).toEqual([
      "safe",
      "safe",
      "unsafe",
    ]);
  });

  test("tool order is stable", () => {
    expect(
      orderTools([WorkspaceShell, WorkspaceImages, WorkspaceFiles]).map((tool) => tool.name),
    ).toEqual(["edit", "find", "grep", "ls", "read", "write", "bash"]);
    expect(orderTools([WorkspaceShell, WorkspaceFiles]).map((tool) => tool.name)).toEqual([
      "edit",
      "find",
      "grep",
      "ls",
      "read",
      "write",
      "bash",
    ]);
  });

  test("edit toInput repairs shapes", () => {
    const edit = WorkspaceFiles.tools[2];
    expect(edit.name).toBe("edit");
    const pair = { oldText: "a", newText: "b" };
    const expected = { path: "f.ts", edits: [pair] };
    expect(edit.toInput?.({ path: "f.ts", edits: JSON.stringify([pair]) })).toEqual(expected);
    expect(edit.toInput?.({ path: "f.ts", edits: pair })).toEqual(expected);
    expect(edit.toInput?.({ path: "f.ts", ...pair })).toEqual(expected);
    expect(edit.toInput?.({ path: "f.ts", edits: [pair] })).toEqual(expected);
  });

  test("bash maps its timeout and always fails on a non-zero exit", () => {
    const bash = WorkspaceShell.tools[0];
    expect(bash.toInput?.({ command: "ls", timeout: 5 })).toEqual({
      command: "ls",
      failOnNonZero: true,
      timeoutSec: 5,
    });
    expect(bash.executionMode).toBe("sequential");
  });
});
