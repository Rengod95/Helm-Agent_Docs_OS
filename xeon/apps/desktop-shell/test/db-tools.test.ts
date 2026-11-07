import { describe, expect, test } from "bun:test";
import { err, ok, type Result } from "@fresnel/contracts";
import { backupFolderName, createDbToolsModule } from "../src/main/db-tools.ts";
import type { LaunchFailure, Launcher, OnceOutput } from "../src/main/engine/launcher.ts";
import { fakeCtx } from "./support/fake-ctx.ts";

const NOW = new Date("2026-11-07T10:20:30.456Z");

function rig(
  reply: Result<OnceOutput, LaunchFailure> = ok({ exitCode: 0, stdout: "{}", stderr: "" }),
) {
  const runs: (readonly string[])[] = [];
  const opened: string[] = [];
  let openText = "";
  const launcher: Launcher = {
    launch: () => Promise.reject(new Error("not used")),
    runOnce: (args) => {
      runs.push(args);
      return Promise.resolve(reply);
    },
  };
  const fake = fakeCtx();
  createDbToolsModule({
    launcherOf: () => launcher,
    open: (target) => {
      opened.push(target);
      return Promise.resolve(openText);
    },
    now: () => NOW,
  }).register(fake.ctx);
  return {
    fake,
    runs,
    opened,
    failOpen: (text: string) => {
      openText = text;
    },
  };
}

describe("backupFolderName", () => {
  test("is the UTC time to the second", () => {
    expect(backupFolderName(NOW)).toBe("fresnel-backup-20261107-102030");
  });
});

describe("db_export", () => {
  test("exports into a new folder named by the time inside the picked folder, with --json --yes", async () => {
    const r = rig(ok({ exitCode: 0, stdout: '{"blobCount":1}', stderr: "w" }));
    expect(await r.fake.call("db_export", { parent: "/Users/me/backups" })).toEqual({
      ok: true,
      value: { exitCode: 0, stdout: '{"blobCount":1}', stderr: "w" },
    });
    expect(r.runs).toEqual([
      ["db", "export", "/Users/me/backups/fresnel-backup-20261107-102030", "--json", "--yes"],
    ]);
  });

  test("a relative, empty or non-string folder is refused and nothing runs", async () => {
    const r = rig();
    const replies = await Promise.all(
      ["relative/dir", "", 7].map((parent) => r.fake.call("db_export", { parent })),
    );
    expect(replies).toEqual(Array.from({ length: 3 }, () => ({ ok: false, error: "bad-request" })));
    expect(r.runs).toEqual([]);
  });

  test("a command that cannot run is storage-failed", async () => {
    const r = rig(err({ message: "spawn failed" }));
    expect(await r.fake.call("db_export", { parent: "/x" })).toEqual({
      ok: false,
      error: "storage-failed",
    });
  });
});

describe("db_usage and db_previous_remove", () => {
  test("usage runs `db usage --json`", async () => {
    const r = rig();
    await r.fake.call("db_usage");
    expect(r.runs).toEqual([["db", "usage", "--json"]]);
  });

  test("only a restore-previous folder name is passed on", async () => {
    const r = rig();
    expect(await r.fake.call("db_previous_remove", { name: "20261104T001500000Z" })).toMatchObject({
      ok: true,
    });
    const bad = await Promise.all(
      ["../x", "20261104T001500000Z/..", "latest", 5].map((name) =>
        r.fake.call("db_previous_remove", { name }),
      ),
    );
    expect(bad).toEqual(Array.from({ length: 4 }, () => ({ ok: false, error: "bad-request" })));
    expect(r.runs).toEqual([["db", "previous-rm", "20261104T001500000Z", "--yes", "--json"]]);
  });
});

describe("open_data_dir", () => {
  test("opens exactly the data folder the CLI reports", async () => {
    const r = rig(ok({ exitCode: 0, stdout: '{"dataDir":"/Users/me/fresnel/data"}', stderr: "" }));
    expect(await r.fake.call("open_data_dir")).toEqual({ ok: true, value: null });
    expect(r.opened).toEqual(["/Users/me/fresnel/data"]);
  });

  test("a failing CLI, a relative path or an OS error is open_failed", async () => {
    const failing = rig(ok({ exitCode: 3, stdout: "", stderr: "x" }));
    expect(await failing.fake.call("open_data_dir")).toEqual({ ok: false, error: "open_failed" });
    const relative = rig(ok({ exitCode: 0, stdout: '{"dataDir":"data"}', stderr: "" }));
    expect(await relative.fake.call("open_data_dir")).toEqual({ ok: false, error: "open_failed" });
    expect(relative.opened).toEqual([]);
    const os = rig(ok({ exitCode: 0, stdout: '{"dataDir":"/d"}', stderr: "" }));
    os.failOpen("no handler");
    expect(await os.fake.call("open_data_dir")).toEqual({ ok: false, error: "open_failed" });
  });
});
