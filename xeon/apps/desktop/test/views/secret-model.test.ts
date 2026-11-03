import { describe, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { SecretNameSchema, type SecretName } from "@fresnel/contracts/capabilities";
import type { SecretListEntry } from "@fresnel/contracts/wire";
import {
  initialSecretsState,
  keyIntentOf,
  secretsReducer,
  secretsViewOf,
  SEARCH_THRESHOLD,
  type KeyFacts,
  type SecretsAction,
  type SecretsState,
} from "../../src/views/pages/secrets/secret-model.ts";
import { lastUsedTextOf } from "../../src/views/pages/secrets/secret-text.ts";

// 시크릿 화면의 상태 기계(순수 함수)를 시험한다. 목록은 값 없는 항목이고, 값은 이 상태 어디에도 없다.

function nameOf(text: string): SecretName {
  const parsed = parse(SecretNameSchema, text);
  if (!parsed.ok) throw new Error("test name must parse");
  return parsed.value;
}

interface EntryOptions {
  readonly status?: SecretListEntry["status"];
  readonly lastUsedAt?: string;
  readonly expiresAt?: string | null;
  readonly hosts?: readonly string[];
}

/** 값 없는 시크릿 항목 하나(목록 응답 모양) */
function entryOf(name: string, options: EntryOptions = {}): SecretListEntry {
  return {
    name: nameOf(name),
    status: options.status ?? "valid",
    ...(options.lastUsedAt === undefined ? {} : { lastUsedAt: options.lastUsedAt }),
    meta: {
      name: nameOf(name),
      desc: `${name} fixture`,
      provider: "sops",
      ref: "dev/FIXTURE",
      scope: "user",
      expiresAt: options.expiresAt ?? null,
      use: {
        modes: ["runtime-http"],
        tools: [],
        hosts: [...(options.hosts ?? ["api.example.com"])],
      },
      approval: "none",
      ttlSeconds: 3600,
      maxUses: 100,
    },
  };
}

function run(...actions: readonly SecretsAction[]): SecretsState {
  return actions.reduce(secretsReducer, initialSecretsState(false));
}

function loaded(rows: readonly SecretListEntry[]): SecretsState {
  return run({ type: "listStarted" }, { type: "listLoaded", rows });
}

const KEY: KeyFacts = {
  key: "",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  editable: false,
  onRow: true,
  revealed: false,
};

describe("secret list selection", () => {
  test("a loaded list selects the first visible row, and a reload keeps the same row", () => {
    const first = loaded([entryOf("zeta-key"), entryOf("alpha-key")]);
    expect(first.detail?.name).toBe(nameOf("alpha-key"));
    const reloaded = secretsReducer(run({ type: "select", name: nameOf("zeta-key") }), {
      type: "listLoaded",
      rows: [entryOf("alpha-key"), entryOf("zeta-key")],
    });
    expect(reloaded.detail?.name).toBe(nameOf("zeta-key"));
  });

  test("a reload that drops the selected row falls back to the first visible row", () => {
    const state = run(
      { type: "listLoaded", rows: [entryOf("alpha-key"), entryOf("zeta-key")] },
      { type: "select", name: nameOf("zeta-key") },
      { type: "listLoaded", rows: [entryOf("beta-key")] },
    );
    expect(state.detail?.name).toBe(nameOf("beta-key"));
  });

  test("an empty list has no selection", () => {
    expect(loaded([]).detail).toBeNull();
  });

  test("reference and test results for another name are ignored", () => {
    const state = run(
      { type: "listLoaded", rows: [entryOf("alpha-key"), entryOf("zeta-key")] },
      { type: "refs", name: nameOf("zeta-key"), load: { kind: "loading" } },
    );
    expect(state.detail?.refs.kind).toBe("idle");
  });

  test("moving with the arrow keys walks the visible order and stops at the ends", () => {
    const state = loaded([entryOf("beta-key"), entryOf("alpha-key"), entryOf("gamma-key")]);
    const down = secretsReducer(state, { type: "move", delta: 1 });
    expect(down.detail?.name).toBe(nameOf("beta-key"));
    const up = secretsReducer(state, { type: "move", delta: -1 });
    expect(up.detail?.name).toBe(nameOf("alpha-key"));
    const bottom = run(
      { type: "listLoaded", rows: [entryOf("beta-key"), entryOf("alpha-key")] },
      { type: "move", delta: 1 },
      { type: "move", delta: 1 },
    );
    expect(bottom.detail?.name).toBe(nameOf("beta-key"));
  });

  test("selecting nothing clears the detail, and asking to remove needs a selection", () => {
    const state = run(
      { type: "listLoaded", rows: [entryOf("alpha-key")] },
      { type: "confirmRemove", open: true },
      { type: "select", name: null },
    );
    expect(state.detail).toBeNull();
    expect(state.confirmRemove).toBe(false);
  });
});

describe("search and sort only appear past the threshold", () => {
  test("a short list ignores the query, and the search shows only past 50 rows", () => {
    const rows = [entryOf("alpha-key"), entryOf("zeta-key")];
    const state = run({ type: "listLoaded", rows }, { type: "query", query: "zeta" });
    expect(secretsViewOf(state).showSearch).toBe(false);
    expect(secretsViewOf(state).rows).toHaveLength(2);
  });

  test("past the threshold the query filters by name, provider, description, and host", () => {
    const many = Array.from({ length: SEARCH_THRESHOLD }, (_, i) =>
      entryOf(`key-${String(i).padStart(2, "0")}`),
    );
    const rows = [...many, entryOf("zeta-key", { hosts: ["hooks.internal.test"] })];
    const state = run({ type: "listLoaded", rows }, { type: "query", query: "INTERNAL" });
    const view = secretsViewOf(state);
    expect(view.showSearch).toBe(true);
    expect(view.rows.map((row) => row.name)).toEqual([nameOf("zeta-key")]);
  });

  test("the sort orders by last use (newest first, unused last), expiry (soonest first), and status (worst first)", () => {
    const rows = [
      entryOf("alpha-key", {
        lastUsedAt: "2026-11-01T00:00:00.000Z",
        expiresAt: "2027-01-01",
        status: "valid",
      }),
      entryOf("beta-key", { expiresAt: null, status: "expired" }),
      entryOf("gamma-key", {
        lastUsedAt: "2026-11-03T00:00:00.000Z",
        expiresAt: "2026-11-20",
        status: "expiring",
      }),
    ];
    const names = (sort: "lastUsed" | "expiry" | "status") =>
      secretsViewOf(run({ type: "listLoaded", rows }, { type: "sort", sort })).rows.map(
        (row) => row.name,
      );
    expect(names("lastUsed")).toEqual([
      nameOf("gamma-key"),
      nameOf("alpha-key"),
      nameOf("beta-key"),
    ]);
    expect(names("expiry")).toEqual([nameOf("gamma-key"), nameOf("alpha-key"), nameOf("beta-key")]);
    expect(names("status")).toEqual([nameOf("beta-key"), nameOf("gamma-key"), nameOf("alpha-key")]);
  });
});

describe("the entry and metadata dialogs", () => {
  test("adding goes name, then value; a host that takes the value closes the dialog", () => {
    const named = run({ type: "entryAdd" }, { type: "entryName", name: "exa-key" });
    expect(named.entry).toEqual({ kind: "name", name: "exa-key", error: null, busy: false });
    const value = secretsReducer(named, {
      type: "entryBegun",
      name: nameOf("exa-key"),
      action: "add",
      started: false,
    });
    expect(value.entry).toEqual({
      kind: "value",
      name: nameOf("exa-key"),
      action: "add",
      error: null,
      busy: false,
    });
    const hosted = secretsReducer(value, {
      type: "entryBegun",
      name: nameOf("exa-key"),
      action: "add",
      started: true,
    });
    expect(hosted.entry).toEqual({ kind: "closed" });
  });

  test("a failed step keeps the dialog open with its message and releases the busy flag", () => {
    const state = run(
      { type: "entryChange", name: nameOf("exa-key") },
      { type: "entryFailed", error: "값을 입력해 주세요." },
    );
    expect(state.entry).toEqual({
      kind: "value",
      name: nameOf("exa-key"),
      action: "set",
      error: "값을 입력해 주세요.",
      busy: false,
    });
  });

  test("changing a draft clears its error, and closing resets it", () => {
    const draft = {
      desc: "",
      hosts: "",
      expiresAt: "",
      approval: "none" as const,
      ttlSeconds: "",
      maxUses: "",
    };
    const opened = run({ type: "metaOpen", name: nameOf("exa-key"), draft });
    const failed = secretsReducer(opened, { type: "metaFailed", error: "설명을 적어 주세요." });
    expect(failed.meta.kind === "open" && failed.meta.error).toBe("설명을 적어 주세요.");
    const edited = secretsReducer(failed, { type: "metaDraft", draft: { ...draft, desc: "x" } });
    expect(edited.meta.kind === "open" && edited.meta.error).toBeNull();
    expect(secretsReducer(edited, { type: "metaClosed" }).meta).toEqual({ kind: "closed" });
  });
});

describe("secrets view model", () => {
  test("an offline list keeps its rows and locks the actions", () => {
    const state = run(
      { type: "listLoaded", rows: [entryOf("alpha-key")] },
      { type: "listFailed", error: { kind: "offline" } },
    );
    const view = secretsViewOf(state);
    expect(view.offline).toBe(true);
    expect(view.acting).toBe(false);
    expect(view.failed).toBeNull();
    expect(view.rows).toHaveLength(1);
  });

  test("a failed list that is not offline reports the failure and keeps the actions", () => {
    const state = run({ type: "listFailed", error: { kind: "failed" } });
    const view = secretsViewOf(state);
    expect(view.offline).toBe(false);
    expect(view.failed).toEqual({ kind: "failed" });
    expect(view.acting).toBe(true);
  });

  test("a busy screen locks the actions, and a first read with no rows is loading", () => {
    const loading = secretsViewOf(initialSecretsState(false));
    expect(loading.loading).toBe(true);
    const busy = secretsViewOf(secretsReducer(loaded([]), { type: "busy", busy: true }));
    expect(busy.acting).toBe(false);
  });

  test("the view model carries no value: the reveal state is a status and a countdown only", () => {
    const state = run(
      { type: "listLoaded", rows: [entryOf("alpha-key")] },
      {
        type: "reveal",
        view: { status: "revealed", name: nameOf("alpha-key"), hostShown: false, remainingSec: 30 },
      },
    );
    expect(secretsViewOf(state).reveal).toEqual({
      status: "revealed",
      name: nameOf("alpha-key"),
      hostShown: false,
      remainingSec: 30,
    });
  });
});

describe("keyboard intent", () => {
  test("arrow keys move only from a row, and never from an input", () => {
    expect(keyIntentOf({ ...KEY, key: "ArrowDown" })).toEqual({ type: "move", delta: 1 });
    expect(keyIntentOf({ ...KEY, key: "ArrowUp" })).toEqual({ type: "move", delta: -1 });
    expect(keyIntentOf({ ...KEY, key: "ArrowDown", onRow: false })).toBeNull();
    expect(keyIntentOf({ ...KEY, key: "ArrowDown", editable: true })).toBeNull();
  });

  test("Enter on a row goes to the detail", () => {
    expect(keyIntentOf({ ...KEY, key: "Enter" })).toEqual({ type: "detail" });
    expect(keyIntentOf({ ...KEY, key: "Enter", onRow: false })).toBeNull();
  });

  test("copy works only while the value is visible", () => {
    expect(keyIntentOf({ ...KEY, key: "c", metaKey: true })).toBeNull();
    expect(keyIntentOf({ ...KEY, key: "c", metaKey: true, revealed: true })).toEqual({
      type: "copy",
    });
    expect(
      keyIntentOf({ ...KEY, key: "c", ctrlKey: true, shiftKey: true, revealed: true }),
    ).toBeNull();
  });

  test("Escape hides the value only while it is visible", () => {
    expect(keyIntentOf({ ...KEY, key: "Escape" })).toBeNull();
    expect(keyIntentOf({ ...KEY, key: "Escape", revealed: true })).toEqual({ type: "hide" });
  });
});

describe("last used text", () => {
  const NOW = 1_800_000_000_000;

  test("a time that is missing or unreadable has no text", () => {
    expect(lastUsedTextOf(undefined, NOW, "ko")).toBeNull();
    expect(lastUsedTextOf("not a date", NOW, "ko")).toBeNull();
  });

  test("a recent use reads as a relative time in the locale", () => {
    const twoMinutesAgo = new Date(NOW - 2 * 60 * 1000).toISOString();
    expect(lastUsedTextOf(twoMinutesAgo, NOW, "ko")).toBe("2분 전");
    expect(lastUsedTextOf(twoMinutesAgo, NOW, "en")).toBe("2 minutes ago");
  });
});
