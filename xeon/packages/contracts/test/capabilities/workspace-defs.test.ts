import { describe, expect, test } from "bun:test";
import type { Static } from "typebox";
import { parse } from "../../src/base/index.ts";
import {
  type EditToolParams,
  RunOutput,
  WorkspaceFiles,
  WorkspaceFilesKey,
  WorkspaceImages,
  WorkspaceImagesKey,
  WorkspaceServiceName,
  WorkspaceShell,
  WorkspaceShellKey,
  orderTools,
  validateCapability,
  validateCapabilitySet,
  type AnyCapabilityDef,
  type ToolContent,
} from "../../src/capabilities/index.ts";

const DEFS: readonly AnyCapabilityDef[] = [WorkspaceFiles, WorkspaceShell, WorkspaceImages];

describe("workspace definitions (M1)", () => {
  test("each definition has no validation issues", () => {
    for (const def of DEFS) expect(validateCapability(def)).toEqual([]);
  });

  test("the set has no conflicts", () => {
    expect(validateCapabilitySet(DEFS)).toEqual([]);
  });

  test("seven tools are declared: read write edit ls grep find bash", () => {
    // 능력 ID 순(workspace.files < workspace.shell), 그 안에서 이름 순
    expect(orderTools(DEFS).map((t) => t.name)).toEqual([
      "edit",
      "find",
      "grep",
      "ls",
      "read",
      "write",
      "bash",
    ]);
  });

  test("keys and the bundle name", () => {
    expect(WorkspaceFilesKey).toEqual({ capability: "workspace.files", version: "1.0.0" });
    expect(WorkspaceShellKey).toEqual({ capability: "workspace.shell", version: "1.0.0" });
    expect(WorkspaceImagesKey).toEqual({ capability: "workspace.images", version: "1.0.0" });
    expect(WorkspaceServiceName).toBe("xeon.workspace");
  });

  test("workspace.images is toolless", () => {
    expect(WorkspaceImages.tools).toEqual([]);
  });
});

function content(result: ToolContent): string {
  const first = result.content[0];
  return first !== undefined && first.type === "text" ? first.text : "";
}

function editsOf(params: Static<typeof EditToolParams>): unknown {
  const result = WorkspaceFiles.tools[2].toInput?.(params);
  if (result === undefined) throw new Error("edit has no toInput");
  return result.edits;
}

describe("RunOutput unsandboxedBy", () => {
  const base = { exitCode: 0, output: "ok\n", truncated: false, durationMs: 4, sandboxed: false };

  test("is optional and takes only the three bypass reasons", () => {
    expect(parse(RunOutput, base)).toEqual({ ok: true, value: base });
    for (const reason of ["escape", "run_unsandboxed", "disabled"] as const) {
      const value = { ...base, unsandboxedBy: reason };
      expect(parse(RunOutput, value)).toEqual({ ok: true, value });
    }
    expect(parse(RunOutput, { ...base, unsandboxedBy: "none" }).ok).toBe(false);
  });
});

describe("tool adapters", () => {
  const read = WorkspaceFiles.tools[0];
  const ls = WorkspaceFiles.tools[3];
  const bash = WorkspaceShell.tools[0];

  test("ls maps to the list method and renders directories with a slash", () => {
    expect(ls.name).toBe("ls");
    expect(ls.method).toBe("list");
    const out = ls.toContent?.({
      path: "/w",
      entries: [
        { name: "a.txt", kind: "file" },
        { name: "src", kind: "directory" },
      ],
    });
    expect(out && content(out)).toBe("a.txt\nsrc/");
  });

  test("read renders text with a continuation note when truncated", () => {
    const out = read.toContent?.({
      kind: "text",
      path: "/w/a",
      text: "line1",
      startLine: 1,
      endLine: 1,
      totalLines: 9,
      truncated: { by: "lines", shown: 1, total: 9, nextOffset: 2 },
    });
    expect(out && content(out)).toContain("offset=2");
  });

  test("read renders an image with a blob placeholder", () => {
    const sha = "a".repeat(64);
    const out = read.toContent?.({
      kind: "image",
      path: "/w/i.png",
      image: {
        blob: { type: "blob", sha256: sha, size: 3, mediaType: "image/png" },
        mimeType: "image/png",
      },
    });
    const image = out?.content[1];
    expect(image).toEqual({ type: "image", data: `blob:sha256:${sha}`, mimeType: "image/png" });
  });

  test("bash maps timeout to timeoutSec and always fails on non-zero exit", () => {
    expect(bash.toInput?.({ command: "ls", timeout: 5 })).toEqual({
      command: "ls",
      failOnNonZero: true,
      timeoutSec: 5,
    });
    expect(bash.toInput?.({ command: "ls" })).toEqual({ command: "ls", failOnNonZero: true });
    expect(bash.executionMode).toBe("sequential");
  });

  test("edit normalizes the variants models send", () => {
    const pair = { oldText: "a", newText: "b" };
    expect(editsOf({ path: "f", edits: [pair] })).toEqual([pair]);
    expect(editsOf({ path: "f", edits: pair })).toEqual([pair]);
    expect(editsOf({ path: "f", edits: JSON.stringify([pair]) })).toEqual([pair]);
    expect(editsOf({ path: "f", edits: "not json" })).toEqual([]);
    expect(editsOf({ path: "f", ...pair })).toEqual([pair]);
  });
});
