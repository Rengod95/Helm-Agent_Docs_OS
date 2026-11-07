import { describe, expect, test } from "bun:test";
import { setActiveLocale } from "@fresnel/client/i18n";
import {
  attachDisabledReason,
  base64Of,
  baseNameOf,
  chipsReady,
  dataSourceLimit,
  exceedsLimit,
  failureOf,
  formatBytes,
  readyParts,
  replaceChip,
  sendBlockedText,
  chipPreviewOf,
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
  test("formatBytes uses 1024 steps and the locale's number and unit names", () => {
    setActiveLocale("en");
    expect(formatBytes(512)).toBe("512 byte");
    expect(formatBytes(1536)).toBe("1.5 kB");
    expect(formatBytes(20971520)).toBe("20 MB");
    expect(formatBytes(1_300_000_000)).toBe("1.2 GB");
    setActiveLocale("ko");
    expect(formatBytes(1536)).toBe("1.5kB");
    expect(formatBytes(512)).toBe("512byte");
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

describe("sendBlockedText", () => {
  test("names the failed chip and its reason", () => {
    const failed = chip({
      name: "big.bin",
      status: "failed",
      failure: { kind: "tooLarge", limit: 1024 },
      parts: null,
    });
    expect(sendBlockedText([chip({}), failed])).toContain("big.bin");
    setActiveLocale("en");
    expect(sendBlockedText([failed])).toContain("1 kB");
    setActiveLocale("ko");
  });
  test("an upload in flight blocks with its own sentence, ready chips do not block", () => {
    expect(sendBlockedText([chip({ status: "uploading", parts: null })])).not.toBeNull();
    expect(sendBlockedText([chip({})])).toBeNull();
  });
});

describe("chipPreviewOf", () => {
  test("only a ready image data source has a preview", () => {
    const image = chip({ source: { kind: "data", data: "QUJD", mime: "image/png" } });
    expect(chipPreviewOf(image)).toBe("data:image/png;base64,QUJD");
    expect(chipPreviewOf(chip({}))).toBeNull();
    expect(chipPreviewOf({ ...image, status: "failed" })).toBeNull();
  });
});

describe("dataSourceLimit", () => {
  test("a byte upload is capped by what fits in one 1 MiB request line, whatever the engine setting says", () => {
    const framed = 780_288;
    expect(dataSourceLimit(null)).toBe(framed);
    expect(dataSourceLimit(20_971_520)).toBe(framed);
    expect(dataSourceLimit(1024)).toBe(1024);
    // base64로 늘어난 크기가 한 줄 한도 안에 든다
    expect(Math.ceil(framed / 3) * 4).toBeLessThan(1_048_576 - 8 * 1024 + 1);
  });
});
