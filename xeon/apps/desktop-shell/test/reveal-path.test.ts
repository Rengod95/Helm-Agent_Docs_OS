import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRevealPathModule } from "../src/main/reveal-path.ts";
import { fakeCtx } from "./support/fake-ctx.ts";

function setup(): { readonly fake: ReturnType<typeof fakeCtx>; readonly shown: string[] } {
  const fake = fakeCtx();
  const shown: string[] = [];
  createRevealPathModule((target) => {
    shown.push(target);
  }).register(fake.ctx);
  return { fake, shown };
}

describe("reveal_path command", () => {
  test("reveals an existing regular file and nothing else", async () => {
    const { fake, shown } = setup();
    const file = path.join(fake.dir, "full-output.txt");
    writeFileSync(file, "line\n");
    expect(await fake.call("reveal_path", { path: file })).toEqual({ ok: true, value: null });
    expect(shown).toEqual([file]);
  });

  test("a missing path, a folder and a symlink are not_found and reveal nothing", async () => {
    const { fake, shown } = setup();
    const folder = path.join(fake.dir, "inner");
    mkdirSync(folder);
    const file = path.join(fake.dir, "real.txt");
    writeFileSync(file, "x");
    const link = path.join(fake.dir, "link.txt");
    symlinkSync(file, link);
    const targets = [path.join(fake.dir, "missing.txt"), folder, link];
    const replies = await Promise.all(
      targets.map((target) => fake.call("reveal_path", { path: target })),
    );
    expect(replies).toEqual(targets.map(() => ({ ok: false, error: "not_found" })));
    expect(shown).toEqual([]);
  });

  test("a relative path, control characters, a non-string and an overlong path are path_not_allowed", async () => {
    const { fake, shown } = setup();
    const bad: unknown[] = [
      "relative/out.txt",
      "",
      `${fake.dir}/a\u0000b`,
      `${fake.dir}/a\nb`,
      42,
      null,
      `/${"a".repeat(5000)}`,
    ];
    const replies = await Promise.all(
      bad.map((value) => fake.call("reveal_path", { path: value })),
    );
    expect(replies).toEqual(bad.map(() => ({ ok: false, error: "path_not_allowed" })));
    expect(await fake.call("reveal_path", {})).toEqual({ ok: false, error: "path_not_allowed" });
    expect(shown).toEqual([]);
  });

  test("a failing OS call gives open_failed", async () => {
    const fake = fakeCtx();
    createRevealPathModule(() => {
      throw new Error("boom");
    }).register(fake.ctx);
    const file = path.join(fake.dir, "out.txt");
    writeFileSync(file, "x");
    expect(await fake.call("reveal_path", { path: file })).toEqual({
      ok: false,
      error: "open_failed",
    });
  });
});
