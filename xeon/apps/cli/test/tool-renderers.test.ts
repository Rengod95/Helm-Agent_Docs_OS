import { expect, test } from "bun:test";
import {
  BUILTIN_TOOL_RENDERERS,
  CONTENT_LINE_LIMIT,
  contentLines,
  resultLines,
} from "../src/render/tools.ts";
import { displayWidth } from "../src/render/width.ts";

const TEXT = (text: string): { type: "text"; text: string } => ({ type: "text", text });

test("M1 has a renderer for read, ls and bash only", () => {
  expect(BUILTIN_TOOL_RENDERERS.map((renderer) => renderer.toolName)).toEqual([
    "read",
    "ls",
    "bash",
  ]);
});

test("the read renderer shows the path and the line count, or image", () => {
  const read = BUILTIN_TOOL_RENDERERS.find((renderer) => renderer.toolName === "read");
  expect(read?.render({ path: "a.txt", kind: "text", text: "1\n2\n3" }, 80)).toEqual([
    "a.txt (3줄)",
  ]);
  expect(read?.render({ path: "p.png", kind: "image" }, 80)).toEqual(["p.png (image)"]);
  expect(read?.render({ nothing: true }, 80)).toBeUndefined();
});

test("the ls renderer lists names, directories with a slash", () => {
  const ls = BUILTIN_TOOL_RENDERERS.find((renderer) => renderer.toolName === "ls");
  expect(
    ls?.render(
      {
        entries: [
          { name: "src", kind: "directory" },
          { name: "a.ts", kind: "file" },
        ],
      },
      80,
    ),
  ).toEqual(["src/", "a.ts"]);
  expect(ls?.render({ entries: [{ kind: "file" }] }, 80)).toBeUndefined();
  expect(ls?.render("not an object", 80)).toBeUndefined();
});

test("the bash renderer shows the exit code, the time and the output tail", () => {
  const bash = BUILTIN_TOOL_RENDERERS.find((renderer) => renderer.toolName === "bash");
  expect(bash?.render({ exitCode: 0, durationMs: 12, output: "a\nb" }, 80)).toEqual([
    "exit 0 (12ms)",
    "a",
    "b",
  ]);
  const long = Array.from({ length: 30 }, (_, i) => `l${i}`).join("\n");
  const lines = bash?.render({ exitCode: 1, output: long }, 80) ?? [];
  expect(lines).toHaveLength(CONTENT_LINE_LIMIT + 1);
  expect(lines.at(-1)).toBe("l29");
  expect(bash?.render({ output: "x" }, 80)).toBeUndefined();
});

test("details win when a renderer accepts them; otherwise content is used", () => {
  const content = [TEXT("fallback text")];
  expect(resultLines("bash", { exitCode: 2 }, content, 80)).toEqual(["exit 2"]);
  expect(resultLines("bash", { weird: true }, content, 80)).toEqual(["fallback text"]);
  expect(resultLines("bash", null, content, 80)).toEqual(["fallback text"]);
  expect(resultLines("unknown-tool", { a: 1 }, content, 80)).toEqual(["fallback text"]);
});

test("content shows the first 20 lines and a count of the hidden ones; images get one line", () => {
  const many = TEXT(Array.from({ length: 22 }, (_, i) => `line ${i}`).join("\n"));
  const lines = contentLines([many]);
  expect(lines).toHaveLength(21);
  expect(lines[20]).toBe("… (2줄 더 있음)");
  expect(contentLines([{ type: "image", data: "xx", mimeType: "image/png" }])).toEqual([
    "[image image/png]",
  ]);
  expect(contentLines([TEXT("")])).toEqual([]);
});

test("long renderer lines are cut to the width", () => {
  const read = BUILTIN_TOOL_RENDERERS.find((renderer) => renderer.toolName === "read");
  const lines = read?.render({ path: "x".repeat(100), kind: "image" }, 20) ?? [];
  expect(lines[0]?.length).toBe(20);
  expect(lines[0]?.endsWith("…")).toBe(true);
});

test("renderer lines with Hangul are cut by display columns", () => {
  const read = BUILTIN_TOOL_RENDERERS.find((renderer) => renderer.toolName === "read");
  const lines =
    read?.render({ path: "가나다라마바사아자차카타파하".repeat(3), kind: "image" }, 20) ?? [];
  expect(displayWidth(lines[0] ?? "")).toBeLessThanOrEqual(20);
  expect(lines[0]?.endsWith("…")).toBe(true);
});
