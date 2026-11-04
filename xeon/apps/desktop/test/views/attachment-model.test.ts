import { describe, expect, test } from "bun:test";
import {
  attachDisabledReason,
  base64Of,
  baseNameOf,
  chipsReady,
  exceedsLimit,
  failureOf,
  formatBytes,
  readyParts,
  replaceChip,
  sourceOfFile,
  turnInputOf,
  type AttachChip,
} from "../../src/views/attachment-model.ts";

const PART = { type: "text", text: "<attachment>hi</attachment>" } as const;

function chip(over: Partial<AttachChip>): AttachChip {
  return {
    id: "a",
    name: "note.txt",
    size: 2,
    source: { kind: "path", path: "/w/note.txt" },
    status: "ready",
    failure: null,
    parts: [PART],
    ...over,
  };
}

describe("failureOf", () => {
  test("reads the limit the host wrote in the too-large sentence", () => {
    const error = {
      kind: "rejected",
      code: -32602,
      issue: "attachment_too_large: The attachment is 30 bytes, over the 20 byte limit.",
    } as const;
    expect(failureOf(error, 999)).toEqual({ kind: "tooLarge", limit: 20 });
  });

  test("falls back to the limit read beforehand when the sentence has none", () => {
    const error = { kind: "rejected", code: -32602, issue: "attachment_too_large: big" } as const;
    expect(failureOf(error, 1024)).toEqual({ kind: "tooLarge", limit: 1024 });
  });

  test("an unreadable format is its own failure and other errors keep their kind", () => {
    expect(
      failureOf(
        { kind: "rejected", code: -32602, issue: "attachment_type_unsupported: nope" },
        null,
      ),
    ).toEqual({ kind: "unsupported" });
    expect(failureOf({ kind: "offline" }, null)).toEqual({
      kind: "other",
      error: { kind: "offline" },
    });
  });
});

describe("sizes", () => {
  test("formatBytes uses 1024 steps", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(20971520)).toBe("20 MB");
  });

  test("exceedsLimit is false without a known limit and true only above it", () => {
    expect(exceedsLimit(10, null)).toBe(false);
    expect(exceedsLimit(10, 10)).toBe(false);
    expect(exceedsLimit(11, 10)).toBe(true);
  });
});

describe("turn input", () => {
  test("no parts keeps the plain text", () => {
    expect(turnInputOf("hello", [])).toBe("hello");
  });

  test("text goes first and the attachment parts follow", () => {
    expect(turnInputOf("see this", [PART])).toEqual([{ type: "text", text: "see this" }, PART]);
  });

  test("an empty text sends the parts alone", () => {
    expect(turnInputOf("", [PART])).toEqual([PART]);
  });
});

describe("chips", () => {
  test("only ready chips give parts and block nothing, a failed chip blocks sending", () => {
    const chips = [chip({ id: "1" }), chip({ id: "2", status: "failed", parts: null })];
    expect(readyParts(chips)).toEqual([PART]);
    expect(chipsReady(chips)).toBe(false);
    expect(chipsReady([chip({ id: "1" })])).toBe(true);
  });

  test("replaceChip changes only the chip with that id", () => {
    const next = replaceChip([chip({ id: "1" }), chip({ id: "2" })], "2", (c) => ({
      ...c,
      status: "uploading",
    }));
    expect(next.map((c) => c.status)).toEqual(["ready", "uploading"]);
  });

  test("attach is locked by the composer reason first, then by a running turn", () => {
    expect(attachDisabledReason({ composerReason: "off", running: true })).toBe("off");
    expect(attachDisabledReason({ composerReason: null, running: false })).toBeNull();
    expect(attachDisabledReason({ composerReason: null, running: true })).not.toBeNull();
  });
});

describe("files", () => {
  test("base64Of matches the known encoding, also across the chunk size", () => {
    expect(base64Of(new Uint8Array([104, 105]))).toBe("aGk=");
    const big = new Uint8Array(0x8000 * 2 + 5).fill(65);
    expect(atob(base64Of(big))).toBe("A".repeat(big.length));
  });

  test("sourceOfFile sends bytes with the file's name and mime", async () => {
    const file = new File(["hi"], "a.txt", { type: "text/plain" });
    expect(await sourceOfFile(file)).toEqual({
      kind: "data",
      data: "aGk=",
      mime: file.type,
      name: "a.txt",
    });
  });

  test("a pasted file without a name or mime has neither", async () => {
    expect(await sourceOfFile(new File(["hi"], ""))).toEqual({
      kind: "data",
      data: "aGk=",
      mime: "application/octet-stream",
    });
  });

  test("baseNameOf takes the last path piece for both separators", () => {
    expect(baseNameOf("/Users/me/a.png")).toBe("a.png");
    expect(baseNameOf("C:\\Users\\me\\b.txt")).toBe("b.txt");
  });
});
