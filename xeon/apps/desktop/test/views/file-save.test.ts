import { describe, expect, test } from "bun:test";
import {
  mimeOf,
  saveExport,
  type FileSaveInvoke,
  type WebDownload,
} from "../../src/views/file-save.ts";

// 저장 함수를 가짜 저장 창과 가짜 내려받기로 돌린다. 저장 창의 답(경로, 취소, 거절)과 웹의 내려받기 호출을 값으로 본다.

/** 저장 창 가짜. 부른 명령과 인자를 기록하고 정한 답을 돌려준다 */
function saving(reply: () => Promise<unknown>): {
  readonly invoke: FileSaveInvoke;
  readonly calls: { readonly command: string; readonly args: unknown }[];
} {
  const calls: { command: string; args: unknown }[] = [];
  const invoke: FileSaveInvoke = (command, args) => {
    calls.push({ command, args });
    return reply();
  };
  return { invoke, calls };
}

/** Tauri는 Rust가 준 `Err(String)`으로 거절한다. 이유는 `unknown`으로 받아 그 값을 그대로 던진다 */
function rejecting(reason: unknown): () => Promise<unknown> {
  return async () => {
    throw reason;
  };
}

/** 브라우저 내려받기 가짜. 호출을 기록하고 주소를 `blob:fake/1`처럼 만든다 */
function fakeDownload(options: { readonly clickFails?: boolean } = {}): {
  readonly download: WebDownload;
  readonly made: Blob[];
  readonly clicks: { url: string; fileName: string }[];
  readonly released: string[];
} {
  const made: Blob[] = [];
  const clicks: { url: string; fileName: string }[] = [];
  const released: string[] = [];
  const download: WebDownload = {
    createUrl: (blob) => {
      made.push(blob);
      return `blob:fake/${made.length}`;
    },
    click: (url, fileName) => {
      if (options.clickFails === true) throw new Error("no document");
      clicks.push({ url, fileName });
    },
    release: (url) => {
      released.push(url);
    },
  };
  return { download, made, clicks, released };
}

describe("saveExport on desktop", () => {
  test("a saved path is saved, and the command gets the suggested name and the content", async () => {
    const fake = saving(async () => "/Users/me/chat.md");
    expect(await saveExport(fake.invoke, "chat.md", "# 제목")).toEqual({
      ok: true,
      value: "saved",
    });
    expect(fake.calls).toEqual([
      { command: "save_file", args: { suggestedName: "chat.md", content: "# 제목" } },
    ]);
  });

  test("null from the dialog is a cancel, not an error", async () => {
    const fake = saving(async () => null);
    expect(await saveExport(fake.invoke, "chat.json", "[]")).toEqual({
      ok: true,
      value: "cancelled",
    });
  });

  test("a refusal from the shell comes back as an error with the reason it gave", async () => {
    const fake = saving(rejecting("dialog_unavailable"));
    expect(await saveExport(fake.invoke, "chat.md", "x")).toEqual({
      ok: false,
      error: { kind: "threw", cause: "dialog_unavailable" },
    });
  });

  test("an answer that is neither a path nor null is an error, not a silent save", async () => {
    const number = saving(async () => 42);
    expect(await saveExport(number.invoke, "chat.md", "x")).toEqual({
      ok: false,
      error: { kind: "threw", cause: 42 },
    });
    const empty = saving(async () => "");
    expect(await saveExport(empty.invoke, "chat.md", "x")).toEqual({
      ok: false,
      error: { kind: "threw", cause: "" },
    });
  });
});

describe("saveExport on the web", () => {
  test("with no invoke the content goes to a browser download under the same name", async () => {
    const fake = fakeDownload();
    expect(await saveExport(null, "chat.md", "# 제목\n", fake.download)).toEqual({
      ok: true,
      value: "saved",
    });
    expect(fake.clicks).toEqual([{ url: "blob:fake/1", fileName: "chat.md" }]);
    expect(fake.released).toEqual(["blob:fake/1"]);
    const [blob] = fake.made;
    expect(blob?.type).toBe("text/markdown;charset=utf-8");
    expect(await blob?.text()).toBe("# 제목\n");
  });

  test("a JSON export is downloaded as JSON", async () => {
    const fake = fakeDownload();
    await saveExport(null, "chat.json", "[]", fake.download);
    expect(fake.made[0]?.type).toBe("application/json;charset=utf-8");
  });

  test("a download that cannot start is an error and the address is still released", async () => {
    const fake = fakeDownload({ clickFails: true });
    const result = await saveExport(null, "chat.md", "x", fake.download);
    expect(result.ok).toBe(false);
    expect(fake.released).toEqual(["blob:fake/1"]);
  });
});

describe("mimeOf", () => {
  test("the two export formats get their own types and any other name is plain text", () => {
    expect(mimeOf("a.md")).toBe("text/markdown;charset=utf-8");
    expect(mimeOf("a.json")).toBe("application/json;charset=utf-8");
    expect(mimeOf("a.txt")).toBe("text/plain;charset=utf-8");
  });
});
