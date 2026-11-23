import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { err, ok, parse } from "@fresnel/contracts";
import {
  ThreadIdSchema,
  TurnIdSchema,
  type ThreadId,
  type TurnId,
} from "@fresnel/contracts/conversation";
import type { PluginCard } from "@fresnel/contracts/extensions";
import type { DraftInfo, Profile } from "@fresnel/contracts/wire";
import { createDevkitPort } from "../../src/assembly/m4/devkit-port.ts";
import type { M4HostEnv, M4PortDeps } from "../../src/assembly/m4/deps.ts";
import type { ExtUiVersionSource } from "../../src/assembly/m4/ext-ui-version-source.ts";
import type { FixedDraftMark } from "../../src/assembly/m4/plugin-set.ts";
import type { PreparedTestRunDrafts } from "../../src/assembly/plugins/test-run-drafts.ts";
import type { OverlayRefusal } from "../../src/assembly/plugins/overlay.ts";
import type { PluginPortFailure } from "../../src/handlers/m5/plugins.ts";
import type { ProfileTestRunPort } from "../../src/handlers/m4/profile-test-run.ts";
import { openFileLock, type OpenedFileLock } from "../fixtures/file-lock.ts";
import { locateTemplateDirs, scaffoldExtension } from "@fresnel/core-authoring";
import { partial } from "../fixtures/unsafe.ts";

// 설치하지 않은 폴더의 Test run(`trialRun`, L3.authoring.spec §4.3). 폴더를 초안으로 만들고 `testRun.start`와 같은 구성으로 Test run 대화에만 묶는다.
// 사용자 확장 폴더에는 아무것도 쓰지 않는다. 초안, 구성, 대화 생성은 가짜이고 시험 기록은 실제 파일 잠금과 기록 파일 위에서 본다.

const root = mkdtempSync(join(tmpdir(), "devkit-trial-run-"));
const locks: OpenedFileLock[] = [];
afterAll(async () => {
  await Promise.all(locks.map((lock) => lock.dispose()));
  rmSync(root, { recursive: true, force: true });
});

const parsedThread = parse(ThreadIdSchema, "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV");
if (!parsedThread.ok) throw new Error("the fixture thread id is not a thread id");
const THREAD: ThreadId = parsedThread.value;
const parsedTurn = parse(TurnIdSchema, "trn_01ARZ3NDEKTSV4RRFFQ69G5FAV");
if (!parsedTurn.ok) throw new Error("the fixture turn id is not a turn id");
const parseTurn: TurnId = parsedTurn.value;
const CLOCK_MS = Date.parse("2026-11-23T09:00:00.000Z");
const HASH = `sha256:${"a".repeat(64)}`;

interface RigOptions {
  readonly draftFails?: PluginPortFailure;
  readonly prepareFails?: OverlayRefusal;
  readonly createThrows?: boolean;
  readonly unknownProfile?: boolean;
}

let rigCount = 0;
async function rig(options: RigOptions = {}) {
  rigCount += 1;
  const dir = join(root, `rig-${String(rigCount)}`);
  const configDir = join(dir, "config");
  const extensionsDir = join(dir, "extensions");
  mkdirSync(configDir, { recursive: true });
  mkdirSync(join(dir, "os"), { recursive: true });
  const lock = await openFileLock(join(dir, "os"));
  locks.push(lock);
  const drafted: string[] = [];
  const prepared: { plugin: string; draftId: string }[][] = [];
  const bound: { threadId: ThreadId; marks: readonly FixedDraftMark[] }[] = [];
  const unheld: string[] = [];
  const created: { workspace?: string; title?: string; testRun?: boolean; profileId?: string }[] =
    [];
  const marked: { threadId: ThreadId; profileId: string | null; draftsJson: string | undefined }[] =
    [];
  const mark: FixedDraftMark = {
    plugin: "draft:kanban-board:1",
    draftId: "drf_1",
    contentHash: HASH,
    replaces: "kanban-board",
  };
  const deps = partial<M4PortDeps>({
    extUi: partial<ExtUiVersionSource>({ extensionsDir }),
    threads: {
      isCraftChat: () => ok(false),
      lastTurnIdOf: () => ok(parseTurn),
      exists: () => ok(true),
      create: (input) => {
        created.push(input);
        if (options.createThrows === true) return Promise.reject(new Error("no thread"));
        return Promise.resolve({ threadId: THREAD });
      },
      remove: () => Promise.resolve(ok(undefined)),
    },
    log: { error: () => undefined },
    draftCreate: (folder) => {
      drafted.push(folder);
      if (options.draftFails !== undefined) return Promise.resolve(err(options.draftFails));
      return Promise.resolve(
        ok({
          draftId: "drf_1",
          contentHash: HASH,
          card: partial<PluginCard>({}),
          info: partial<DraftInfo>({ name: "kanban-board", draftId: "drf_1" }),
        }),
      );
    },
    testRunDrafts: {
      prepare: (refs) => {
        prepared.push(refs.map((ref) => ({ plugin: ref.plugin, draftId: ref.draftId })));
        if (options.prepareFails !== undefined) return Promise.resolve(err(options.prepareFails));
        const value: PreparedTestRunDrafts = {
          marks: [mark],
          unhold: () => {
            unheld.push("unhold");
          },
        };
        return Promise.resolve(ok(value));
      },
      bind: (threadId, parts) => {
        bound.push({ threadId, marks: parts.flatMap((part) => part.marks) });
        return Promise.resolve();
      },
    },
    env: partial<M4HostEnv>({
      configDir,
      fileLock: lock.fileLock,
      signal: new AbortController().signal,
      clock: { now: () => CLOCK_MS },
    }),
  });
  const profiles = partial<ProfileTestRunPort>({
    get: (id) =>
      Promise.resolve(
        options.unknownProfile === true ? err({ kind: "not_found", id }) : ok(partial<Profile>({})),
      ),
    registerTestRun: (threadId, profileId, _group, draftsJson) => {
      marked.push({ threadId, profileId, draftsJson });
    },
  });
  const port = createDevkitPort(deps, { profiles, newTestId: () => "t-1" });
  return { port, extensionsDir, drafted, prepared, bound, unheld, created, marked };
}

test("a folder that is not installed starts a Test run: it becomes a draft, the draft is bound to the new thread, and nothing is installed", async () => {
  const session = await rig();
  const run = await session.port.trialRun({ dir: "/work/kanban-board", workspace: "/work" });
  expect(run).toEqual(ok({ testId: "t-1", threadId: THREAD }));
  expect(session.drafted).toEqual(["/work/kanban-board"]);
  expect(session.prepared).toEqual([[{ plugin: "kanban-board", draftId: "drf_1" }]]);
  expect(session.created).toEqual([{ workspace: "/work", title: "kanban-board", testRun: true }]);
  expect(session.bound).toHaveLength(1);
  expect(session.bound[0]?.threadId).toBe(THREAD);
  expect(session.bound[0]?.marks.map((item) => [item.replaces, item.draftId])).toEqual([
    ["kanban-board", "drf_1"],
  ]);
  expect(session.marked).toEqual([
    {
      threadId: THREAD,
      profileId: null,
      draftsJson: JSON.stringify({
        drafts: [{ plugin: "kanban-board", draftId: "drf_1", contentHash: HASH }],
      }),
    },
  ]);
  expect(session.unheld).toEqual([]);
  // 사용자 확장 폴더에는 아무것도 만들지 않았다
  expect(existsSync(session.extensionsDir)).toBe(false);
  // 기록은 실행 중이고 대상 이름과 대화를 적는다
  expect(await session.port.testList()).toEqual(
    ok({
      tests: [
        {
          testId: "t-1",
          kind: "testRun",
          target: "kanban-board",
          state: "running",
          startedAt: "2026-11-23T09:00:00.000Z",
          durationMs: null,
          threadId: THREAD,
          replay: null,
        },
      ],
    }),
  );
});

test("a folder that fails the draft check is refused with its reasons and opens no thread", async () => {
  const session = await rig({
    draftFails: {
      kind: "draft_invalid",
      issues: [
        { severity: "error", code: "manifest_missing", path: "/manifest", message: "no manifest" },
      ],
    },
  });
  expect(await session.port.trialRun({ dir: "/work/kanban-board" })).toEqual(
    err({
      kind: "invalid_input",
      message: "the plugin folder is not valid",
      reasons: [{ code: "manifest_missing", field: "manifest", message: "no manifest" }],
    }),
  );
  expect(session.created).toEqual([]);
  expect(session.prepared).toEqual([]);
});

test("a draft that cannot be loaded opens no thread, and a thread that cannot be created releases the draft", async () => {
  const refused = await rig({
    prepareFails: {
      kind: "draft_unavailable",
      name: "kanban-board",
      reason: "not_active",
      detail: "entry of kanban-board threw: boom",
    },
  });
  expect(await refused.port.trialRun({ dir: "/work/kanban-board" })).toEqual(
    err({
      kind: "invalid_input",
      message:
        "the draft could not be loaded for a Test run (draft_unavailable: not_active, entry of kanban-board threw: boom)",
    }),
  );
  expect(refused.created).toEqual([]);
  const broken = await rig({ createThrows: true });
  const failed = await broken.port.trialRun({ dir: "/work/kanban-board" });
  expect(failed.ok).toBe(false);
  expect(broken.unheld).toEqual(["unhold"]);
  expect(broken.bound).toEqual([]);
});

test("an unknown profile is refused before any draft is made", async () => {
  const session = await rig({ unknownProfile: true });
  expect(await session.port.trialRun({ dir: "/work/kanban-board", profileId: "p-9" })).toEqual(
    err({ kind: "not_found", message: "profile p-9 is not found" }),
  );
  expect(session.drafted).toEqual([]);
});

/** 검사를 통과하는 뼈대 폴더(훅 방식)를 새로 만든다 */
async function scaffoldedFolder(name: string): Promise<string> {
  const templates = locateTemplateDirs({});
  if (templates === null) throw new Error("templates are missing in the source tree");
  const dir = join(root, `scaffold-${name}`);
  const made = await scaffoldExtension(
    { kind: "single-plugin", name, dir, purpose: "Greet", description: "Greets the user" },
    { templates },
  );
  if (!made.ok) throw new Error(made.error.message);
  return dir;
}

test("validate loads the entry as a draft too: a plugin that cannot be loaded fails with AU-014 and the first line of the cause", async () => {
  const session = await rig({
    prepareFails: {
      kind: "draft_unavailable",
      name: "kanban-board",
      reason: "not_active",
      detail: "entry of kanban-board threw: boom",
    },
  });
  const checked = await session.port.validate(await scaffoldedFolder("kanban-board"));
  expect(checked.ok ? checked.value.ok : null).toBe(false);
  expect(
    checked.ok ? checked.value.issues.filter((issue) => issue.code === "AU-014") : null,
  ).toEqual([
    {
      severity: "error",
      code: "AU-014",
      path: "/entry",
      message:
        "the plugin could not be loaded: draft_unavailable: not_active, entry of kanban-board threw: boom",
    },
  ]);
});

test("validate releases the draft it loaded and stays ok when the entry loads", async () => {
  const session = await rig();
  const checked = await session.port.validate(await scaffoldedFolder("greeter-ok"));
  expect(checked.ok ? checked.value.issues.map((issue) => issue.code) : null).not.toContain(
    "AU-014",
  );
  expect(session.unheld).toEqual(["unhold"]);
  expect(session.bound).toEqual([]);
});

test("validate skips the load check when isolation is not available", async () => {
  const session = await rig({
    prepareFails: {
      kind: "draft_unavailable",
      name: "kanban-board",
      reason: "isolation_unavailable",
    },
  });
  const checked = await session.port.validate(await scaffoldedFolder("greeter-iso"));
  expect(checked.ok ? checked.value.issues.map((issue) => issue.code) : null).not.toContain(
    "AU-014",
  );
});

test("latestTurn reads the last turn id of the Test run thread and refuses an id that is not a conversation (F-46)", async () => {
  const session = await rig();
  expect(await session.port.latestTurn("not-a-thread")).toMatchObject({
    ok: false,
    error: { kind: "not_found" },
  });
  expect(await session.port.latestTurn(THREAD)).toEqual(ok(parseTurn));
});
