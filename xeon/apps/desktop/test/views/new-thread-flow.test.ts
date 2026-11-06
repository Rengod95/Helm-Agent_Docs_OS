import { beforeEach, expect, test } from "bun:test";
import { ok, type Result } from "@fresnel/contracts";
import type { ThreadSummary } from "@fresnel/contracts/wire";
import type { CommandError } from "../../src/views/commands.ts";
import {
  resetNewThreadGuard,
  runNewThread,
  type NewThreadDeps,
} from "../../src/views/new-thread-flow.ts";
import { thr } from "../state/helpers.ts";

function summary(patch: Partial<ThreadSummary>): ThreadSummary {
  return {
    threadId: thr(1),
    title: "작업",
    status: "idle",
    workspace: "/w/a",
    createdAt: "2026-11-07T00:00:00.000Z",
    updatedAt: "2026-11-07T00:00:00.000Z",
    headSeq: 1,
    forkedFrom: null,
    resumable: null,
    queuedInputs: 0,
    pendingApprovals: 0,
    ...patch,
  };
}

interface Calls {
  readonly created: (string | undefined)[];
  readonly selected: string[];
  composer: number;
  chat: number;
}

function fixture(patch: Partial<NewThreadDeps>): { deps: NewThreadDeps; calls: Calls } {
  const calls: Calls = { created: [], selected: [], composer: 0, chat: 0 };
  const deps: NewThreadDeps = {
    threads: [],
    selected: null,
    folderPick: undefined,
    showChat: () => {
      calls.chat += 1;
    },
    selectThread: (id) => {
      calls.selected.push(id);
    },
    requestComposer: () => {
      calls.composer += 1;
    },
    createThread: (workspace) => {
      calls.created.push(workspace);
      const done: Result<null, CommandError> = ok(null);
      return Promise.resolve(done);
    },
    ...patch,
  };
  return { deps, calls };
}

beforeEach(resetNewThreadGuard);

test("with no folder known the folder picker opens, and the chosen folder gets the new thread and the composer", async () => {
  const { deps, calls } = fixture({ folderPick: () => Promise.resolve("/w/picked") });
  expect(await runNewThread(deps, undefined)).toEqual({ kind: "created" });
  expect(calls.created).toEqual(["/w/picked"]);
  expect(calls.composer).toBe(1);
  expect(calls.chat).toBe(1);
});

test("cancelling the folder picker creates nothing", async () => {
  const { deps, calls } = fixture({ folderPick: () => Promise.resolve(null) });
  expect(await runNewThread(deps, undefined)).toEqual({ kind: "cancelled" });
  expect(calls.created).toEqual([]);
  expect(calls.composer).toBe(0);
});

test("pressing again while the picker is open is ignored and only one picker opens", async () => {
  let opened = 0;
  const gate = Promise.withResolvers<string>();
  const pending = gate.promise;
  const { deps, calls } = fixture({
    folderPick: () => {
      opened += 1;
      return pending;
    },
  });
  const first = runNewThread(deps, undefined);
  const second = await runNewThread(deps, undefined);
  const third = await runNewThread(deps, undefined);
  expect(second).toEqual({ kind: "busy" });
  expect(third).toEqual({ kind: "busy" });
  gate.resolve("/w/x");
  expect(await first).toEqual({ kind: "created" });
  expect(opened).toBe(1);
  expect(calls.created).toEqual(["/w/x"]);
});

test("the viewed folder opens a new thread there and focuses the composer without a picker", async () => {
  const used = summary({});
  const { deps, calls } = fixture({
    threads: [used],
    selected: thr(1),
    folderPick: () => Promise.reject(new Error("picker must not open")),
  });
  expect(await runNewThread(deps, undefined)).toEqual({ kind: "created" });
  expect(calls.created).toEqual(["/w/a"]);
  expect(calls.composer).toBe(1);
});

test("a blank thread in the folder is opened instead of creating another, with the composer focused", async () => {
  const blank = summary({ threadId: thr(2), title: null });
  const { deps, calls } = fixture({ threads: [summary({}), blank], selected: thr(1) });
  expect(await runNewThread(deps, undefined)).toEqual({ kind: "opened" });
  expect(calls.selected).toEqual([thr(2)]);
  expect(calls.created).toEqual([]);
  expect(calls.composer).toBe(1);
});

test("the no-folder choice from the dialog creates without opening the picker", async () => {
  const { deps, calls } = fixture({
    folderPick: () => Promise.reject(new Error("picker must not open")),
  });
  expect(await runNewThread(deps, null)).toEqual({ kind: "created" });
  expect(calls.created).toEqual([undefined]);
});
