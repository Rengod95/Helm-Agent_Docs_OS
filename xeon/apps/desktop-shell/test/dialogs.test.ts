import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { absolutePathText, bareFileName, dialogsModule } from "../src/main/dialogs.ts";
import { fakeCtx } from "./support/fake-ctx.ts";

describe("file name sanitizing", () => {
  test("traversal keeps only the last name", () => {
    expect(bareFileName("../x")).toBe("x");
    expect(bareFileName("../../etc/passwd.md")).toBe("passwd.md");
  });

  test("both separator styles are cut", () => {
    expect(bareFileName("a/b.md")).toBe("b.md");
    expect(bareFileName("C:\\Users\\me\\chat.json")).toBe("chat.json");
  });

  test("empty and dot names fall back to export.txt", () => {
    expect(bareFileName("")).toBe("export.txt");
    expect(bareFileName("   ")).toBe("export.txt");
    expect(bareFileName("dir/")).toBe("export.txt");
    expect(bareFileName(".")).toBe("export.txt");
    expect(bareFileName("..")).toBe("export.txt");
  });

  test("a long name is capped at 200 characters", () => {
    const name = bareFileName("가".repeat(300));
    expect(Array.from(name).length).toBe(200);
    expect(name).toBe("가".repeat(200));
  });

  test("control characters are dropped before the cap", () => {
    expect(bareFileName("a\u0000b\nc.md")).toBe("abc.md");
    expect(bareFileName(`${"\u0001".repeat(5)}${"x".repeat(199)}y`)).toBe(`${"x".repeat(199)}y`);
  });
});

describe("picked path text", () => {
  test("an absolute path becomes its text", () => {
    expect(absolutePathText("/Users/me/project")).toBe("/Users/me/project");
  });

  test("a relative path or a file URL is not an answer", () => {
    expect(absolutePathText("project/src")).toBeNull();
    expect(absolutePathText("file:///Users/me/project")).toBeNull();
    expect(absolutePathText("")).toBeNull();
  });
});

describe("pick commands", () => {
  test("pick_folder and pick_file answer the absolute path or null on cancel", async () => {
    const fake = fakeCtx();
    dialogsModule.register(fake.ctx);
    fake.dialogs.folder = "/Users/me/project";
    expect(await fake.call("pick_folder")).toEqual({ ok: true, value: "/Users/me/project" });
    fake.dialogs.folder = null;
    expect(await fake.call("pick_folder")).toEqual({ ok: true, value: null });
    fake.dialogs.file = "/Users/me/notes.md";
    expect(await fake.call("pick_file")).toEqual({ ok: true, value: "/Users/me/notes.md" });
    fake.dialogs.file = null;
    expect(await fake.call("pick_file")).toEqual({ ok: true, value: null });
  });

  test("a relative answer from the dialog is treated as a cancel", async () => {
    const fake = fakeCtx();
    dialogsModule.register(fake.ctx);
    fake.dialogs.folder = "project/src";
    expect(await fake.call("pick_folder")).toEqual({ ok: true, value: null });
  });

  test("a dialog that cannot open gives dialog_unavailable", async () => {
    const fake = fakeCtx();
    const broken = {
      ...fake.ctx,
      dialogs: {
        openFolder: async (): Promise<string | null> => {
          throw new Error("window gone");
        },
        openFile: async (): Promise<string | null> => {
          throw new Error("window gone");
        },
        saveFile: async (): Promise<string | null> => {
          throw new Error("window gone");
        },
      },
    };
    dialogsModule.register(broken);
    expect(await fake.call("pick_folder")).toEqual({ ok: false, error: "dialog_unavailable" });
    expect(await fake.call("pick_file")).toEqual({ ok: false, error: "dialog_unavailable" });
    expect(await fake.call("save_file", { suggestedName: "a.md", content: "x" })).toEqual({
      ok: false,
      error: "dialog_unavailable",
    });
  });
});

describe("save_file command", () => {
  test("writes the exact UTF-8 content and answers the saved path", async () => {
    const fake = fakeCtx();
    dialogsModule.register(fake.ctx);
    const target = path.join(fake.dir, "chat.md");
    fake.dialogs.save = target;
    const content = "# 제목\n\n- 항목 1\n";
    expect(await fake.call("save_file", { suggestedName: "../../chat.md", content })).toEqual({
      ok: true,
      value: target,
    });
    expect(readFileSync(target, "utf8")).toBe(content);
  });

  test("overwrites an existing file the dialog chose", async () => {
    const fake = fakeCtx();
    dialogsModule.register(fake.ctx);
    const target = path.join(fake.dir, "chat.md");
    fake.dialogs.save = target;
    await fake.call("save_file", { suggestedName: "chat.md", content: "first" });
    await fake.call("save_file", { suggestedName: "chat.md", content: "second" });
    expect(readFileSync(target, "utf8")).toBe("second");
  });

  test("a cancelled dialog answers null and writes nothing", async () => {
    const fake = fakeCtx();
    dialogsModule.register(fake.ctx);
    fake.dialogs.save = null;
    expect(await fake.call("save_file", { suggestedName: "a.md", content: "x" })).toEqual({
      ok: true,
      value: null,
    });
  });

  test("the dialog gets the sanitized name", async () => {
    const fake = fakeCtx();
    const asked: string[] = [];
    const recording = {
      ...fake.ctx,
      dialogs: {
        openFolder: async (): Promise<string | null> => null,
        openFile: async (): Promise<string | null> => null,
        saveFile: async (name: string): Promise<string | null> => {
          asked.push(name);
          return null;
        },
      },
    };
    dialogsModule.register(recording);
    await fake.call("save_file", { suggestedName: "../../etc/passwd.md", content: "x" });
    await fake.call("save_file", { suggestedName: "dir/", content: "x" });
    expect(asked).toEqual(["passwd.md", "export.txt"]);
  });

  test("a relative path from the dialog gives write_failed and writes nothing", async () => {
    const fake = fakeCtx();
    dialogsModule.register(fake.ctx);
    fake.dialogs.save = "relative/chat.md";
    expect(await fake.call("save_file", { suggestedName: "chat.md", content: "x" })).toEqual({
      ok: false,
      error: "write_failed",
    });
    expect(existsSync(path.join(fake.dir, "relative"))).toBe(false);
  });

  test("a folder that does not exist gives write_failed", async () => {
    const fake = fakeCtx();
    dialogsModule.register(fake.ctx);
    fake.dialogs.save = path.join(fake.dir, "missing", "chat.md");
    expect(await fake.call("save_file", { suggestedName: "chat.md", content: "x" })).toEqual({
      ok: false,
      error: "write_failed",
    });
  });

  test("malformed args give bad-request", async () => {
    const fake = fakeCtx();
    dialogsModule.register(fake.ctx);
    expect(await fake.call("save_file", { suggestedName: 1, content: "x" })).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(await fake.call("save_file", { suggestedName: "a.md" })).toEqual({
      ok: false,
      error: "bad-request",
    });
  });
});
