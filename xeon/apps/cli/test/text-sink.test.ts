import { expect, test } from "bun:test";
import { createJsonTap } from "../src/render/json-tap.ts";
import type { RenderOp } from "../src/render/model.ts";
import { createTextSink, pieceOf } from "../src/render/text-sink.ts";
import { displayWidth } from "../src/render/width.ts";
import { createMinimalSink, progressLine } from "../src/tui/minimal.ts";
import { itemId } from "./support/ids.ts";

const ESC = String.fromCodePoint(27);

function methodOf(line: string): unknown {
  const value: unknown = JSON.parse(line);
  return typeof value === "object" && value !== null ? Reflect.get(value, "method") : undefined;
}

const ASSISTANT: RenderOp = {
  kind: "assistant",
  itemId: itemId(1),
  markdown: "answer",
  thinking: "hmm",
};
const USER: RenderOp = { kind: "user", itemId: itemId(2), text: "question" };
const CALL: RenderOp = {
  kind: "toolCall",
  view: { itemId: itemId(3), toolCallId: "c", toolName: "ls", argsSummary: '{"path":"."}' },
};
const RESULT: RenderOp = {
  kind: "toolResult",
  view: {
    toolCallId: "c",
    toolName: "ls",
    isError: true,
    synthesized: true,
    lines: ["first", "second"],
  },
};

test("print layout: the response goes to stdout, everything else to stderr, no user echo", () => {
  expect(pieceOf(ASSISTANT, "print", false)).toEqual({ target: "stdout", text: "answer\n" });
  expect(pieceOf(USER, "print", false)).toBeUndefined();
  expect(pieceOf(CALL, "print", false)?.target).toBe("stderr");
  expect(pieceOf({ kind: "notice", text: "n" }, "print", false)).toEqual({
    target: "stderr",
    text: "n\n",
  });
});

test("full layout: everything goes to stdout and thinking is a folded line", () => {
  expect(pieceOf(USER, "full", false)).toEqual({ target: "stdout", text: "> question\n" });
  expect(pieceOf(ASSISTANT, "full", false)).toEqual({
    target: "stdout",
    text: "(생각) hmm\nanswer\n",
  });
  expect(pieceOf(CALL, "full", false)?.target).toBe("stdout");
});

test("results carry the error and synthesized markers and indent following lines", () => {
  const piece = pieceOf(RESULT, "full", false);
  expect(piece?.text).toBe("  ↳ [error, 재개 때 중단됨으로 기록됨] first\n    second\n");
});

test("colour adds escape sequences only when asked", () => {
  expect(pieceOf(CALL, "full", true)?.text).toContain(ESC);
  expect(pieceOf(CALL, "full", false)?.text).not.toContain(ESC);
  for (const op of [USER, ASSISTANT, CALL, RESULT]) {
    expect(pieceOf(op, "print", false)?.text ?? "").not.toContain(ESC);
  }
});

test("turn ends: nothing for completed, a line for interrupted and failed", () => {
  expect(
    pieceOf({ kind: "turnEnd", status: "completed", error: null }, "print", false),
  ).toBeUndefined();
  expect(
    pieceOf({ kind: "turnEnd", status: "interrupted", error: null }, "print", false)?.text,
  ).toBe("turn이 중단되었다\n");
  expect(pieceOf({ kind: "turnEnd", status: "failed", error: "boom" }, "print", false)?.text).toBe(
    "turn이 실패했다: boom\n",
  );
});

test("progress ops are not drawn by the text sink", () => {
  expect(pieceOf({ kind: "progress", itemId: itemId(1), text: "t" }, "full", true)).toBeUndefined();
  expect(pieceOf({ kind: "clearProgress", itemId: itemId(1) }, "full", true)).toBeUndefined();
  expect(pieceOf({ kind: "approvalResolved", approvalId: "a" }, "full", true)).toBeUndefined();
});

test("approvals are announced on stderr with the body indented", () => {
  const piece = pieceOf(
    {
      kind: "approval",
      view: {
        approvalId: "a",
        title: "T",
        body: ["x", "y"],
        allowsAnswer: false,
        remember: ["once"],
        form: { kind: "tool" },
      },
    },
    "print",
    false,
  );
  expect(piece).toEqual({ target: "stderr", text: "승인 요청: T\n  x\n  y\n" });
});

test("the text sink writes ops in order", async () => {
  const written: string[] = [];
  const sink = createTextSink({
    stdout: (text) => {
      written.push(`out:${text}`);
      return Promise.resolve();
    },
    stderr: (text) => {
      written.push(`err:${text}`);
      return Promise.resolve();
    },
    layout: "print",
    color: false,
  });
  await sink.write([CALL, ASSISTANT]);
  await sink.close();
  expect(written).toEqual(['err:● ls {"path":"."}\n', "out:answer\n"]);
});

test("the minimal sink overwrites one progress line and clears it before other output", async () => {
  const written: string[] = [];
  const sink = createMinimalSink({
    stdout: (text) => {
      written.push(text);
      return Promise.resolve();
    },
    stderr: () => Promise.resolve(),
    color: false,
    progress: true,
    columns: 20,
  });
  await sink.write([
    { kind: "progress", itemId: itemId(1), text: "Hel" },
    { kind: "progress", itemId: itemId(1), text: "Hello" },
    { kind: "clearProgress", itemId: itemId(1) },
    ASSISTANT,
  ]);
  expect(written[0]).toBe(`\r${ESC}[2KHel`);
  expect(written[1]).toBe(`\r${ESC}[2KHello`);
  expect(written[2]).toBe(`\r${ESC}[2K`);
  expect(written.slice(3).join("")).toContain("answer");
  // 이미 지웠으니 두 번 지우지 않는다
  expect(written.filter((text) => text === `\r${ESC}[2K`)).toHaveLength(1);
});

test("without progress support the minimal sink draws no cursor control at all", async () => {
  const written: string[] = [];
  const sink = createMinimalSink({
    stdout: (text) => {
      written.push(text);
      return Promise.resolve();
    },
    stderr: () => Promise.resolve(),
    color: false,
    progress: false,
    columns: null,
  });
  await sink.write([{ kind: "progress", itemId: itemId(1), text: "Hel" }, ASSISTANT]);
  await sink.close();
  expect(written.join("")).not.toContain(ESC);
  expect(written.join("")).toContain("answer");
});

test("the progress line shows the last non-empty line, cut to the terminal width", () => {
  expect(progressLine("first\nsecond line\n\n", null)).toBe("second line");
  expect(progressLine("x".repeat(30), 10)).toBe(`${"x".repeat(8)}…`);
  expect(progressLine("", 10)).toBe("");
});

test("the progress line counts Hangul and CJK as two columns", () => {
  // 한글 20자는 40칸이다. 문자 수로 자르면 40칸 터미널에서 줄이 접힌다
  const hangul = "가나다라마바사아자차카타파하거너더러머버서";
  const cut = progressLine(hangul, 20);
  expect(displayWidth(cut)).toBeLessThanOrEqual(19);
  expect(cut.endsWith("…")).toBe(true);
  expect(progressLine("한글", 20)).toBe("한글");
  expect(displayWidth(progressLine("漢字漢字漢字漢字漢字", 11))).toBeLessThanOrEqual(10);
});

test("the json tap holds lines until it is decided, then writes them in order", async () => {
  const written: string[] = [];
  const tap = createJsonTap((line) => {
    written.push(line);
    return Promise.resolve();
  }, "undecided");
  tap.observe({ jsonrpc: "2.0", method: "a", params: {} });
  tap.observe({ jsonrpc: "2.0", method: "b", params: {} });
  expect(written).toEqual([]);
  tap.decide(true);
  tap.observe({ jsonrpc: "2.0", method: "c", params: {} });
  await tap.flush();
  expect(written.map(methodOf)).toEqual(["a", "b", "c"]);
  expect(written.every((line) => line.endsWith("\n"))).toBe(true);
  tap.decide(false);
  expect(tap.mode).toBe("on");
});

test("the json tap drops everything when it is decided off, and flush reports a write error", async () => {
  const off = createJsonTap(() => Promise.reject(new TypeError("never called")), "undecided");
  off.observe({ jsonrpc: "2.0", method: "a", params: {} });
  off.decide(false);
  off.observe({ jsonrpc: "2.0", method: "b", params: {} });
  await off.flush();
  expect(off.mode).toBe("off");

  const broken = createJsonTap(() => Promise.reject(new TypeError("EPIPE")), "on");
  broken.observe({ jsonrpc: "2.0", method: "a", params: {} });
  const outcome = await broken.flush().then(
    () => "flushed",
    (caught: unknown) => caught,
  );
  expect(outcome).toBeInstanceOf(TypeError);
});
