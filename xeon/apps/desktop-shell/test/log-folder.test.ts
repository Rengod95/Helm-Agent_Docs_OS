import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createLogFolderModule } from "../src/main/log-folder.ts";
import { fakeCtx } from "./support/fake-ctx.ts";

describe("open_log_dir command", () => {
  test("creates the log folder and opens exactly that folder", async () => {
    const fake = fakeCtx();
    const opened: string[] = [];
    createLogFolderModule((target) => {
      opened.push(target);
      return Promise.resolve("");
    }).register(fake.ctx);
    expect(await fake.call("open_log_dir")).toEqual({ ok: true, value: null });
    expect(opened).toEqual([fake.ctx.paths.logs]);
    expect(existsSync(fake.ctx.paths.logs)).toBe(true);
  });

  test("an OS error text or a throw gives open_failed", async () => {
    const texts = createLogFolderModule(() => Promise.resolve("no handler at /x"));
    const first = fakeCtx();
    texts.register(first.ctx);
    expect(await first.call("open_log_dir")).toEqual({ ok: false, error: "open_failed" });
    const throws = fakeCtx();
    createLogFolderModule(() => Promise.reject(new Error("boom"))).register(throws.ctx);
    expect(await throws.call("open_log_dir")).toEqual({ ok: false, error: "open_failed" });
  });
});
