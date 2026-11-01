import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NEW_APPLICATION_ID,
  OLD_APPLICATION_ID,
  formatReport,
  migrate,
  planMoves,
  readMarker,
  type MigrateInput,
} from "./migrate-dev-machine.ts";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "migrate-dev-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function input(overrides: Partial<MigrateInput> = {}): MigrateInput {
  return {
    home,
    platform: "linux",
    uid: 4242,
    env: {},
    listProcesses: () => [],
    probeSocket: () => Promise.resolve(false),
    apply: false,
    ...overrides,
  };
}

function seedLinux(applicationId: number): { config: string; data: string } {
  const config = join(home, ".config", "xeon");
  const data = join(home, ".local", "share", "xeon");
  mkdirSync(join(config, "secrets", "age"), { recursive: true });
  writeFileSync(join(config, "secrets", "age", "keys.txt"), "not-a-real-key");
  writeFileSync(join(config, "settings.json"), "{}");
  mkdirSync(data, { recursive: true });
  const db = new Database(join(data, "xeon.db"));
  db.run("PRAGMA synchronous = OFF");
  db.run("PRAGMA journal_mode = WAL");
  db.run("CREATE TABLE t (a INTEGER)");
  db.run("INSERT INTO t VALUES (1)");
  db.run(`PRAGMA application_id = ${String(applicationId)}`);
  db.close();
  writeFileSync(join(data, "xeon.db.pre-1"), "snapshot");
  return { config, data };
}

test("planMoves lists the Linux and macOS locations", () => {
  expect(planMoves({ home: "/h", platform: "linux", env: {} }).map((m) => [m.from, m.to])).toEqual([
    ["/h/.config/xeon", "/h/.config/fresnel"],
    ["/h/.local/share/xeon", "/h/.local/share/fresnel"],
    ["/h/.local/state/xeon", "/h/.local/state/fresnel"],
    ["/h/.cache/xeon", "/h/.cache/fresnel"],
  ]);
  expect(planMoves({ home: "/h", platform: "darwin", env: {} }).map((m) => [m.from, m.to])).toEqual(
    [
      ["/h/Library/Application Support/xeon", "/h/Library/Application Support/fresnel"],
      ["/h/Library/Caches/xeon", "/h/Library/Caches/fresnel"],
      [
        "/h/Library/Application Support/dev.helm.xeon",
        "/h/Library/Application Support/dev.fresnel.desktop",
      ],
    ],
  );
  expect(
    planMoves({ home: "/h", platform: "linux", env: { XDG_CONFIG_HOME: "/x/cfg" } })[0],
  ).toEqual({
    label: "config (secrets included)",
    from: "/x/cfg/xeon",
    to: "/x/cfg/fresnel",
  });
  expect(planMoves({ home: "/h", platform: "linux", env: { XEON_HOME: "/custom" } })).toEqual([]);
});

test("dry-run changes nothing and reports counts and the marker", async () => {
  const { config, data } = seedLinux(OLD_APPLICATION_ID);
  const report = await migrate(input());
  expect(existsSync(config)).toBe(true);
  expect(existsSync(join(data, "xeon.db"))).toBe(true);
  expect(report.dirs.find((d) => d.label.startsWith("config"))?.status).toBe("planned");
  expect(report.dirs.find((d) => d.label.startsWith("config"))?.files).toBe(2);
  expect(report.dbs).toEqual([
    {
      path: join(data, "xeon.db"),
      marker: OLD_APPLICATION_ID,
      action: "rename_and_set",
      done: false,
    },
  ]);
  const text = formatReport(report, false).join("\n");
  expect(text).toContain("dry-run");
  expect(text).not.toContain("not-a-real-key");
}, 60_000);

test("apply moves directories, renames the DB family and sets the new marker", async () => {
  const { config, data } = seedLinux(OLD_APPLICATION_ID);
  const report = await migrate(input({ apply: true }));
  const newData = join(home, ".local", "share", "fresnel");
  expect(report.dirs.find((d) => d.label === "data")?.status).toBe("moved");
  expect(existsSync(config)).toBe(false);
  expect(existsSync(data)).toBe(false);
  expect(readFileSync(join(home, ".config", "fresnel", "secrets", "age", "keys.txt"), "utf8")).toBe(
    "not-a-real-key",
  );
  expect(existsSync(join(newData, "xeon.db"))).toBe(false);
  expect(existsSync(join(newData, "fresnel.db.pre-1"))).toBe(true);
  expect(readMarker(join(newData, "fresnel.db"))).toBe(NEW_APPLICATION_ID);
  const db = new Database(join(newData, "fresnel.db"), { readonly: true });
  expect(db.query("SELECT a FROM t").all()).toEqual([{ a: 1 }]);
  db.close();
  expect(report.dbs[0]?.done).toBe(true);
}, 60_000);

test("apply moves stored settings.changed events from scope session to launch", async () => {
  const { data } = seedLinux(OLD_APPLICATION_ID);
  const seed = new Database(join(data, "xeon.db"));
  seed.run(
    "CREATE TABLE events (seq INTEGER PRIMARY KEY, kind TEXT NOT NULL, envelope TEXT NOT NULL)",
  );
  seed.run(
    "CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events are immutable'); END",
  );
  const rows = [
    ["settings.changed", JSON.stringify({ payload: { key: "k", scope: "session", value: 1 } })],
    ["settings.changed", JSON.stringify({ payload: { key: "k", scope: "user", value: 2 } })],
    ["other.kind", JSON.stringify({ payload: { scope: "session" } })],
  ] as const;
  for (const [kind, envelope] of rows) {
    seed.run("INSERT INTO events (kind, envelope) VALUES (?, ?)", [kind, envelope]);
  }
  seed.close();

  await migrate(input({ apply: true }));

  const db = new Database(join(home, ".local", "share", "fresnel", "fresnel.db"));
  const scopes = db
    .query<{ scope: string }, []>(
      "SELECT json_extract(envelope, '$.payload.scope') AS scope FROM events ORDER BY seq",
    )
    .all()
    .map((row) => row.scope);
  expect(scopes).toEqual(["launch", "user", "session"]);
  expect(() => db.run("UPDATE events SET kind = 'x'")).toThrow("events are immutable");
  db.close();
}, 60_000);

test("an unknown marker is reported and the DB is left alone", async () => {
  const { data } = seedLinux(777);
  const report = await migrate(input({ apply: true }));
  expect(report.dbs[0]?.action).toBe("unknown_marker");
  const newData = join(home, ".local", "share", "fresnel");
  expect(readMarker(join(newData, "xeon.db"))).toBe(777);
  expect(existsSync(join(newData, "fresnel.db"))).toBe(false);
  expect(existsSync(data)).toBe(false);
}, 60_000);

test("a running process blocks everything", async () => {
  const { config } = seedLinux(OLD_APPLICATION_ID);
  const report = await migrate(input({ apply: true, listProcesses: () => ["123 xeon"] }));
  expect(report.blocked).toEqual(["process: 123 xeon"]);
  expect(existsSync(config)).toBe(true);
  expect(existsSync(join(home, ".config", "fresnel"))).toBe(false);
});

test("an answering service socket blocks everything", async () => {
  const { config } = seedLinux(OLD_APPLICATION_ID);
  const socketDir = join(home, "run", "xeon");
  mkdirSync(socketDir, { recursive: true });
  writeFileSync(join(socketDir, "xeon.sock"), "");
  const report = await migrate(
    input({
      apply: true,
      env: { XDG_RUNTIME_DIR: join(home, "run") },
      probeSocket: () => Promise.resolve(true),
    }),
  );
  expect(report.blocked).toEqual([`service socket answers: ${join(socketDir, "xeon.sock")}`]);
  expect(existsSync(config)).toBe(true);
});

test("an existing target directory is never overwritten", async () => {
  const { config } = seedLinux(OLD_APPLICATION_ID);
  mkdirSync(join(home, ".config", "fresnel"), { recursive: true });
  writeFileSync(join(home, ".config", "fresnel", "settings.json"), '{"keep":true}');
  const report = await migrate(input({ apply: true }));
  expect(report.dirs.find((d) => d.label.startsWith("config"))?.status).toBe("target_exists");
  expect(existsSync(config)).toBe(true);
  expect(readFileSync(join(home, ".config", "fresnel", "settings.json"), "utf8")).toBe(
    '{"keep":true}',
  );
});

test("macOS moves app support, cache and the Tauri app data", async () => {
  const support = join(home, "Library", "Application Support");
  mkdirSync(join(support, "xeon", "config"), { recursive: true });
  mkdirSync(join(support, "dev.helm.xeon"), { recursive: true });
  writeFileSync(join(support, "dev.helm.xeon", "state.bin"), "x");
  const db = new Database(join(support, "xeon", "xeon.db"));
  db.run(`PRAGMA application_id = ${String(OLD_APPLICATION_ID)}`);
  db.run("CREATE TABLE t (a INTEGER)");
  db.close();
  const report = await migrate(input({ platform: "darwin", apply: true }));
  expect(report.dirs.map((d) => [d.label, d.status])).toEqual([
    ["app support", "moved"],
    ["cache", "missing"],
    ["tauri app data", "moved"],
  ]);
  expect(existsSync(join(support, "dev.fresnel.desktop", "state.bin"))).toBe(true);
  expect(readMarker(join(support, "fresnel", "fresnel.db"))).toBe(NEW_APPLICATION_ID);
}, 60_000);

test("readMarker returns unreadable for a file that is not SQLite", () => {
  const path = join(home, "other.db");
  writeFileSync(path, "x".repeat(200));
  expect(readMarker(path)).toBe("unreadable");
  expect(readMarker(join(home, "absent.db"))).toBe("unreadable");
});
