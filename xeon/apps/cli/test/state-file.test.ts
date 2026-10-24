import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import {
  EMPTY_CLI_STATE,
  entryFor,
  readCliState,
  withEntry,
  writeCliStateSync,
} from "../src/state.ts";
import { storeId } from "./support/ids.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "xstate-"));
  dirs.push(dir);
  return dir;
}

const POSITION = { storeId: storeId(1), seq: 12 };

test("writing creates the folder, uses mode 0600 and leaves no temporary file", () => {
  const dir = temp();
  const path = join(dir, "deep", "state.json");
  const state = withEntry(EMPTY_CLI_STATE, "/w", "thr_x", POSITION, "2026-01-05T00:00:00.000Z");
  writeCliStateSync(path, state);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(() => statSync(`${path}.tmp`)).toThrow();
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(state);
});

test("reading a written file returns it as loaded", async () => {
  const path = join(temp(), "state.json");
  const state = withEntry(EMPTY_CLI_STATE, "/w", "thr_x", POSITION, "2026-01-05T00:00:00.000Z");
  writeCliStateSync(path, state);
  const outcome = await readCliState(path);
  expect(outcome.kind).toBe("loaded");
  expect(entryFor(outcome.state, "/w")).toEqual({
    threadId: "thr_x",
    position: { storeId: POSITION.storeId, seq: 12 },
    updatedAt: "2026-01-05T00:00:00.000Z",
  });
  expect(entryFor(outcome.state, "/other")).toBeUndefined();
});

test("a missing file is an empty state, not an error", async () => {
  const outcome = await readCliState(join(temp(), "nope.json"));
  expect(outcome).toEqual({ kind: "missing", state: EMPTY_CLI_STATE });
});

test("a broken file is discarded with a reason and never throws", async () => {
  const dir = temp();
  const cases: readonly [string, string][] = [
    ["not json {", "JSON이 아니다"],
    [JSON.stringify({ version: 2, workspaces: {} }), "형식이 맞지 않다"],
    [JSON.stringify({ version: 1, workspaces: { "/w": { threadId: 1 } } }), "형식이 맞지 않다"],
    [
      JSON.stringify({
        version: 1,
        workspaces: {
          "/w": {
            threadId: "t",
            position: { storeId: "s", seq: -1 },
            updatedAt: "2026-01-05T00:00:00.000Z",
          },
        },
      }),
      "형식이 맞지 않다",
    ],
  ];
  const outcomes = await Promise.all(
    cases.map(async ([text], index) => {
      const path = join(dir, `broken-${index}.json`);
      writeFileSync(path, text);
      return readCliState(path);
    }),
  );
  expect(outcomes).toEqual(
    cases.map(([, reason]) => ({ kind: "discarded", state: EMPTY_CLI_STATE, reason })),
  );
});

test("a directory where the file should be is discarded as unreadable", async () => {
  const dir = temp();
  mkdirSync(join(dir, "state.json"));
  const outcome = await readCliState(join(dir, "state.json"));
  expect(outcome).toEqual({ kind: "discarded", state: EMPTY_CLI_STATE, reason: "읽을 수 없다" });
});

test("withEntry replaces one workspace and keeps the others and unknown top-level fields", () => {
  const base = {
    version: 1 as const,
    note: "keep",
    workspaces: {
      "/a": { threadId: "thr_a", position: { storeId: "s", seq: 1 }, updatedAt: "t" },
    },
  };
  const next = withEntry(base, "/b", "thr_b", POSITION, "2026-01-05T00:00:00.000Z");
  expect(next).toMatchObject({ note: "keep", workspaces: { "/a": { threadId: "thr_a" } } });
  expect(entryFor(next, "/b")?.threadId).toBe("thr_b");
  expect(Object.keys(base.workspaces)).toEqual(["/a"]);
});
