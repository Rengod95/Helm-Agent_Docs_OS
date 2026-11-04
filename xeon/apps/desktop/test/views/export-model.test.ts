import { describe, expect, test } from "bun:test";
import { err, ok, type Result } from "@fresnel/contracts";
import type { ItemId } from "@fresnel/contracts/conversation";
import type { WireResult } from "@fresnel/contracts/wire";
import type { CommandError, ExportDocument } from "../../src/views/commands.ts";
import {
  EXPORT_PAGE_LIMIT,
  collectExport,
  exportAndSave,
  exportFailureId,
  primaryLabelOf,
  type ExportPageFetch,
} from "../../src/views/export-model.ts";
import type { FileSaveInvoke } from "../../src/views/file-save.ts";
import { itm } from "../state/helpers.ts";

// 대화 내보내기의 순수 부분을 가짜 쪽 읽기와 가짜 저장 창으로 돌린다. 값은 `toEqual`로 정확히 비교한다.

type Page = WireResult<"thread.export">;

/** 쪽 하나. `next`가 있으면 그 item id를 싣는다 */
function page(chunk: string, next: number | undefined, itemCount = 1): Page {
  return {
    format: "markdown",
    filename: "chat.md",
    chunk,
    itemCount,
    ...(next === undefined ? {} : { next: itm(next) }),
  };
}

/** 미리 정한 답을 차례로 돌려주는 쪽 읽기. 부른 `after`를 기록한다. 답이 모자라면 오류다 */
function scripted(replies: readonly Result<Page, CommandError>[]): {
  readonly fetch: ExportPageFetch;
  readonly afters: (ItemId | undefined)[];
} {
  const afters: (ItemId | undefined)[] = [];
  let index = 0;
  const fetch: ExportPageFetch = async (after) => {
    afters.push(after);
    const reply = replies[index];
    index += 1;
    return reply ?? err({ kind: "failed" });
  };
  return { fetch, afters };
}

describe("collectExport", () => {
  test("joins every page in order and adds the item counts, asking each page with the previous next", async () => {
    const { fetch, afters } = scripted([
      ok(page("# 제목\n- Thread ID\n", 2, 2)),
      ok(page("## User\nhi\n", 3, 1)),
      ok(page("## Assistant\nyo\n", undefined, 1)),
    ]);
    expect(await collectExport(fetch)).toEqual({
      ok: true,
      value: {
        filename: "chat.md",
        content: "# 제목\n- Thread ID\n## User\nhi\n## Assistant\nyo\n",
        itemCount: 4,
      },
    });
    expect(afters).toEqual([undefined, itm(2), itm(3)]);
  });

  test("a single page without next is the whole document", async () => {
    const { fetch, afters } = scripted([ok(page("[]", undefined, 0))]);
    expect(await collectExport(fetch)).toEqual({
      ok: true,
      value: { filename: "chat.md", content: "[]", itemCount: 0 },
    });
    expect(afters).toEqual([undefined]);
  });

  test("a next that equals the id the page was asked with is a runaway export, not a loop", async () => {
    const { fetch } = scripted([ok(page("a", 2)), ok(page("b", 2))]);
    expect(await collectExport(fetch)).toEqual({ ok: false, error: { kind: "failed" } });
  });

  test("a failure on page 2 comes back as that error and no partial document", async () => {
    const { fetch, afters } = scripted([ok(page("a", 2)), err({ kind: "offline" })]);
    expect(await collectExport(fetch)).toEqual({ ok: false, error: { kind: "offline" } });
    expect(afters.length).toBe(2);
  });

  test("more pages than the limit fail after exactly the limit of reads", async () => {
    let reads = 0;
    const fetch: ExportPageFetch = async () => {
      reads += 1;
      return ok(page("x", reads + 1));
    };
    expect(await collectExport(fetch)).toEqual({ ok: false, error: { kind: "failed" } });
    expect(reads).toBe(EXPORT_PAGE_LIMIT);
  });
});

describe("exportFailureId", () => {
  test("offline, a host without thread.export, and any other read failure each get their own sentence", () => {
    expect(exportFailureId({ kind: "offline" })).toBe("desktop.threads.menu.failed.offline");
    expect(exportFailureId({ kind: "unsupported" })).toBe("desktop.threads.export.unsupported");
    expect(exportFailureId({ kind: "failed" })).toBe("desktop.threads.export.failed.read");
  });
});

describe("primaryLabelOf", () => {
  test("desktop saves, the web downloads, and a failure always offers a retry", () => {
    expect(primaryLabelOf(true, false)).toBe("desktop.threads.export.save");
    expect(primaryLabelOf(false, false)).toBe("desktop.threads.export.download");
    expect(primaryLabelOf(true, true)).toBe("desktop.threads.export.retry");
    expect(primaryLabelOf(false, true)).toBe("desktop.threads.export.retry");
  });
});

/** Tauri는 Rust가 준 `Err(String)`으로 거절한다. 이유는 `unknown`으로 받아 그 값을 그대로 던진다 */
function rejecting(reason: unknown): () => Promise<unknown> {
  return async () => {
    throw reason;
  };
}

/** 저장 창 가짜. 부른 명령과 인자를 기록한다 */
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

const document: ExportDocument = { filename: "chat.md", content: "# x", itemCount: 3 };

describe("exportAndSave", () => {
  test("reads in the chosen format, saves through save_file, and reports the file name and item count", async () => {
    const formats: string[] = [];
    const fake = saving(async () => "/Users/me/chat.md");
    const outcome = await exportAndSave({
      exportThread: async (format) => {
        formats.push(format);
        return ok(document);
      },
      format: "json",
      fileSave: fake.invoke,
    });
    expect(outcome).toEqual({ kind: "saved", filename: "chat.md", itemCount: 3 });
    expect(formats).toEqual(["json"]);
    expect(fake.calls).toEqual([
      { command: "save_file", args: { suggestedName: "chat.md", content: "# x" } },
    ]);
  });

  test("a cancelled save dialog is a cancel, not a failure", async () => {
    const fake = saving(async () => null);
    expect(
      await exportAndSave({
        exportThread: async () => ok(document),
        format: "markdown",
        fileSave: fake.invoke,
      }),
    ).toEqual({ kind: "cancelled" });
  });

  test("a read failure stops before the save dialog opens", async () => {
    const fake = saving(async () => "/Users/me/chat.md");
    expect(
      await exportAndSave({
        exportThread: async () => err({ kind: "unsupported" }),
        format: "markdown",
        fileSave: fake.invoke,
      }),
    ).toEqual({ kind: "failed", message: "desktop.threads.export.unsupported" });
    expect(fake.calls).toEqual([]);
  });

  test("a save that the shell refuses is a save failure with its own sentence", async () => {
    const fake = saving(rejecting("write_failed"));
    expect(
      await exportAndSave({
        exportThread: async () => ok(document),
        format: "markdown",
        fileSave: fake.invoke,
      }),
    ).toEqual({ kind: "failed", message: "desktop.threads.export.failed.save" });
  });
});
