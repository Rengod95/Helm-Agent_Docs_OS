import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { err, ok, parse, type Result } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import type { InvocableEntry, OverlayRef } from "@fresnel/contracts/wire";
import type { PluginPortFailure } from "../../../src/handlers/m5/plugins.ts";
import { buildPluginCard } from "../../../src/assembly/plugins/card.ts";
import { readPluginFolder } from "../../../src/assembly/plugins/folder-reader.ts";
import { invocablesOf, type InvocableSource } from "../../../src/assembly/plugins/invocables.ts";
import {
  NO_DRAFTS,
  createOverlayPort,
  planOverlay,
  type OverlayTarget,
} from "../../../src/assembly/plugins/overlay.ts";
import { createPluginService } from "../../../src/assembly/plugins/service.ts";
import { createPluginStore, type PluginReviewMeta } from "../../../src/assembly/plugins/store.ts";
import { passThroughFileLock, removeTree, tempRoot, writeFiles } from "./support.ts";

// M5c §3.4 `plugin.invocables`·`plugin.get`의 entries, §4.3.1~4·9 `turn.start.overlay`의 검사와 얹기.
// 시험은 값을 `toEqual`로 비교한다. 검토본은 실제 저장소(승격, current)에서 만든다.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTree(root);
});

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function threadId(): ThreadId {
  const parsed = parse(ThreadIdSchema, "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV");
  if (!parsed.ok) throw new Error("fixture thread id is invalid");
  return parsed.value;
}

function target(
  name: string,
  reviewedHash: string | null,
  entries: OverlayTarget["entries"] = [],
  addsTools = false,
): OverlayTarget {
  return { name, reviewedHash, entries, addsTools };
}

function refsOf(...plugins: readonly string[]): OverlayRef[] {
  return plugins.map((plugin) => ({ plugin }));
}

// ── invocablesOf ───────────────────────────────────────────────────────────

test("invocablesOf는 스킬, 명령, Drive 시작, 플러그인 전체 순서로 항목을 낸다. 설명이 없는 스킬은 이름을 제목으로 쓴다", () => {
  const source: InvocableSource = {
    plugin: "review",
    reviewedHash: HASH_A,
    card: {
      displayName: "Review helper",
      does: {
        inject: null,
        hook: null,
        drive: { start: true, commands: [] },
      },
    },
    folder: {
      materials: {
        instructions: [],
        skills: [
          {
            name: "lint",
            path: "skills/lint/SKILL.md",
            description: "Lints code",
            descriptionChars: 11,
            when: "on_demand",
          },
          {
            name: "plain",
            path: "skills/plain/SKILL.md",
            description: null,
            descriptionChars: 0,
            when: "on_demand",
          },
        ],
        mcpServers: [],
        agents: [],
        commands: [{ name: "fix", path: "commands/fix.md", text: "x", when: "on_demand" }],
      },
    },
  };
  const expected: InvocableEntry[] = [
    { plugin: "review", entry: "lint", kind: "skill", title: "Lints code", reviewedHash: HASH_A },
    { plugin: "review", entry: "plain", kind: "skill", title: "plain", reviewedHash: HASH_A },
    { plugin: "review", entry: "fix", kind: "command", title: "fix", reviewedHash: HASH_A },
    {
      plugin: "review",
      entry: "start",
      kind: "drive",
      title: "Review helper",
      reviewedHash: HASH_A,
    },
    {
      plugin: "review",
      entry: "review",
      kind: "plugin",
      title: "Review helper",
      reviewedHash: HASH_A,
    },
  ];
  expect(invocablesOf(source)).toEqual(expected);
});

test("invocablesOf는 검토본 폴더를 읽지 못하면 스킬과 명령을 빼고 플러그인 항목만 남긴다", () => {
  const card = { displayName: "Quiet", does: { inject: null, hook: null, drive: null } };
  expect(invocablesOf({ plugin: "quiet", reviewedHash: HASH_A, card, folder: null })).toEqual([
    { plugin: "quiet", entry: "quiet", kind: "plugin", title: "Quiet", reviewedHash: HASH_A },
  ]);
});

// ── planOverlay ────────────────────────────────────────────────────────────

test("planOverlay는 한 턴에 다섯 개를 넘기면 limit이다", async () => {
  const result = await planOverlay(
    refsOf("a", "b", "c", "d", "e"),
    () => Promise.resolve(ok(undefined)),
    new Set(),
  );
  expect(result).toEqual(err({ kind: "limit" }));
});

test("planOverlay는 이름이 없으면 not_found, 검토본이 없으면 not_reviewed다", async () => {
  const targets: Record<string, OverlayTarget | undefined> = {
    draft: target("draft", null),
  };
  const targetOf = (name: string): Promise<Result<OverlayTarget | undefined, PluginPortFailure>> =>
    Promise.resolve(ok(targets[name]));
  expect(await planOverlay(refsOf("missing"), targetOf, new Set())).toEqual(
    err({ kind: "not_found", name: "missing" }),
  );
  expect(await planOverlay(refsOf("draft"), targetOf, new Set())).toEqual(
    err({ kind: "not_reviewed", name: "draft" }),
  );
});

/** 시작 Drive 항목과 플러그인 항목을 가진 대상 조회. 이름은 요청한 이름이다 */
function driverTargetOf(
  name: string,
): Promise<Result<OverlayTarget | undefined, PluginPortFailure>> {
  return Promise.resolve(
    ok(
      target(name, HASH_A, [
        { entry: "start", kind: "drive" },
        { entry: name, kind: "plugin" },
      ]),
    ),
  );
}

test("planOverlay는 항목이 그 플러그인에 없으면 no_entry다. 시작 Drive 항목(start)은 있으면 얹는다(overlay-drive.test.ts)", async () => {
  expect(
    await planOverlay([{ plugin: "driver", entry: "other" }], driverTargetOf, new Set()),
  ).toEqual(err({ kind: "no_entry", name: "driver" }));
  expect(
    await planOverlay([{ plugin: "driver", entry: "start" }], driverTargetOf, new Set()),
  ).toEqual(
    ok([
      {
        plugin: "driver",
        contentHash: HASH_A,
        alreadyInProfile: false,
        addsTools: false,
        invoked: [{ plugin: "driver", entry: "start", kind: "drive" }],
      },
    ]),
  );
});

test("planOverlay는 초안 저장소에 없는 초안 식별자를 draft_not_found로 거절하고, 이미 든 플러그인은 alreadyInProfile로 표시하며 같은 이름은 한 번만 얹는다", async () => {
  const targetOf = (name: string): Promise<Result<OverlayTarget | undefined, PluginPortFailure>> =>
    Promise.resolve(ok(target(name, HASH_A, [], true)));
  expect(
    await planOverlay([{ plugin: "x", draftId: "d1" }], targetOf, new Set(), NO_DRAFTS),
  ).toEqual(err({ kind: "draft_not_found", name: "x", draftId: "d1" }));
  expect(
    await planOverlay(
      [{ plugin: "inside" }, { plugin: "outside" }, { plugin: "outside" }],
      targetOf,
      new Set(["inside"]),
    ),
  ).toEqual(
    ok([
      {
        plugin: "inside",
        contentHash: HASH_A,
        alreadyInProfile: true,
        addsTools: true,
        invoked: [{ plugin: "inside", entry: "inside", kind: "plugin" }],
      },
      {
        plugin: "outside",
        contentHash: HASH_A,
        alreadyInProfile: false,
        addsTools: true,
        invoked: [{ plugin: "outside", entry: "outside", kind: "plugin" }],
      },
    ]),
  );
});

test("planOverlay는 이름으로 준 항목의 종류를 싣고, 같은 플러그인의 여러 항목을 한 덩어리에 모두 적는다", async () => {
  const targetOf = (name: string): Promise<Result<OverlayTarget | undefined, PluginPortFailure>> =>
    Promise.resolve(
      ok(
        target(name, HASH_A, [
          { entry: "greet", kind: "skill" },
          { entry: "report", kind: "command" },
          { entry: name, kind: "plugin" },
        ]),
      ),
    );
  expect(
    await planOverlay(
      [
        { plugin: "notes", entry: "greet" },
        { plugin: "notes", entry: "report" },
        { plugin: "notes", entry: "greet" },
      ],
      targetOf,
      new Set(),
    ),
  ).toEqual(
    ok([
      {
        plugin: "notes",
        contentHash: HASH_A,
        alreadyInProfile: false,
        addsTools: false,
        invoked: [
          { plugin: "notes", entry: "greet", kind: "skill" },
          { plugin: "notes", entry: "report", kind: "command" },
        ],
      },
    ]),
  );
});

test("planOverlay는 대상을 읽는 저장소 실패를 plugin 거절로 그대로 준다", async () => {
  const failure: PluginPortFailure = { kind: "store", code: "io" };
  const targetOf = (): Promise<Result<OverlayTarget | undefined, PluginPortFailure>> =>
    Promise.resolve(err(failure));
  expect(await planOverlay(refsOf("x"), targetOf, new Set())).toEqual(
    err({ kind: "plugin", failure }),
  );
});

// ── createOverlayPort ──────────────────────────────────────────────────────

test("덧씌우기 포트는 집합에 없는 것만 적재를 요청하고 얹으며, 도구를 더하면 tool_change_append다", async () => {
  const loaded: string[][] = [];
  const attached: unknown[] = [];
  const cancelled: string[] = [];
  const port = createOverlayPort({
    draftOf: NO_DRAFTS,
    loadDrafts: () => Promise.resolve(ok(undefined)),
    targetOf: (name) =>
      Promise.resolve(ok(target(name, name === "tools" ? HASH_B : HASH_A, [], name === "tools"))),
    inSet: () => ["core-thing"],
    ensureLoaded: (names) => {
      loaded.push([...names]);
      return Promise.resolve();
    },
    pluginSet: {
      attachOverlay: (_threadId, marks) => {
        attached.push(marks);
        return Promise.resolve();
      },
      cancelOverlay: (threadId) => {
        cancelled.push(threadId);
        return Promise.resolve();
      },
    },
    startDrive: () => ok(undefined),
  });
  const id = threadId();
  const result = await port.attach(id, refsOf("core-thing", "tools"));
  expect(result).toEqual(
    ok({
      cacheImpact: "tool_change_append",
      invoked: [{ plugin: "tools", entry: "tools", kind: "plugin" }],
    }),
  );
  expect(loaded).toEqual([["tools"]]);
  expect(attached).toEqual([[{ plugin: "tools", contentHash: HASH_B, until: "turn" }]]);
  await port.cancel(id, false);
  expect(cancelled).toEqual([id]);
});

test("덧씌우기 포트는 이미 든 플러그인만 얹으면 아무것도 적재하거나 얹지 않고 cacheImpact는 none이다", async () => {
  let touched = false;
  const port = createOverlayPort({
    draftOf: NO_DRAFTS,
    loadDrafts: () => Promise.resolve(ok(undefined)),
    targetOf: (name) => Promise.resolve(ok(target(name, HASH_A))),
    inSet: () => ["already"],
    ensureLoaded: () => {
      touched = true;
      return Promise.resolve();
    },
    pluginSet: {
      attachOverlay: () => {
        touched = true;
        return Promise.resolve();
      },
      cancelOverlay: () => Promise.resolve(),
    },
    startDrive: () => ok(undefined),
  });
  expect(await port.attach(threadId(), refsOf("already"))).toEqual(
    ok({ cacheImpact: "none", invoked: [] }),
  );
  expect(touched).toBe(false);
});

// ── 플러그인 서비스: 검토본 폴더에서 항목과 대상 ─────────────────────────────

const SKILL = "---\nname: greeter\ndescription: Greets people\n---\nBody\n";

/** 검토본 하나를 저장소에 승격하고 current로 둔다(승인 흐름의 저장소 부분) */
async function approveSkillFolder(
  root: string,
): Promise<{ readonly store: ReturnType<typeof createPluginStore>; readonly hash: string }> {
  const store = createPluginStore({
    root: join(root, "plugin-store"),
    fileLock: passThroughFileLock,
  });
  // 폴더 이름이 플러그인 이름이다(카드 이름은 폴더 이름에서 온다)
  const src = join(root, "greeter");
  writeFiles(src, { "SKILL.md": SKILL, "commands/hello.md": "say hello\n" });
  const folder = readPluginFolder(src, { origin: "user" });
  if (!folder.ok) throw new Error(`fixture folder rejected: ${folder.error.kind}`);
  const snapshot = await store.snapshotCandidate(src);
  if (!snapshot.ok) throw new Error(`snapshot failed: ${snapshot.error.kind}`);
  const contentHash = snapshot.value.contentHash;
  const meta: PluginReviewMeta = {
    name: "greeter",
    version: folder.value.manifest.version,
    contentHash,
    approvedAt: "2026-11-18T00:00:00.000Z",
    decisionId: "rvw_fixture",
    origin: "user",
    inferredManifest: folder.value.inferred,
    card: buildPluginCard({
      folder: folder.value,
      origin: { kind: "user" },
      review: {
        state: "approved",
        currentHash: contentHash,
        pendingItemId: null,
        approvedAt: "2026-11-18T00:00:00.000Z",
      },
      usedBy: [],
      health: { state: "idle", lastActiveAt: null, lastError: null },
    }),
  };
  const promoted = await store.promote(contentHash, meta);
  if (!promoted.ok) throw new Error(`promote failed: ${promoted.error.kind}`);
  const switched = await store.setCurrent("greeter", contentHash);
  if (!switched.ok) throw new Error(`setCurrent failed: ${switched.error.kind}`);
  return { store, hash: contentHash };
}

test("검토된 플러그인의 호출 항목은 검토본 폴더의 스킬과 명령, 플러그인 항목이고 reviewedHash는 현재 검토본 해시다", async () => {
  const root = tempRoot("overlay-invocables-");
  roots.push(root);
  const { store, hash } = await approveSkillFolder(root);
  const configDir = join(root, "config");
  writeFiles(configDir, {
    "plugins/notes/SKILL.md": "---\nname: notes\ndescription: Notes\n---\nBody\n",
  });
  const service = createPluginService({
    configDir,
    projectRoots: () => Promise.resolve([]),
    managedDir: null,
    bundleDir: null,
    records: () => [],
    profiles: {
      list: () =>
        Promise.resolve(
          ok({
            profiles: [],
            common: { plugins: [], settings: [], updatedAt: "2026-11-18T00:00:00.000Z", rev: 1 },
            rev: 1,
          }),
        ),
    },
    store,
    log: { info: () => undefined },
  });

  const invocables = await service.invocables();
  expect(invocables).toEqual(
    ok({
      entries: [
        {
          plugin: "greeter",
          entry: "greeter",
          kind: "skill",
          title: "Greets people",
          reviewedHash: hash,
        },
        { plugin: "greeter", entry: "hello", kind: "command", title: "hello", reviewedHash: hash },
        {
          plugin: "greeter",
          entry: "greeter",
          kind: "plugin",
          title: "greeter",
          reviewedHash: hash,
        },
      ],
    }),
  );

  const detail = await service.get("greeter");
  expect(detail).toEqual(
    ok(expect.objectContaining({ entries: invocables.ok ? invocables.value.entries : [] })),
  );

  // 검토본이 없는 원본 폴더는 항목이 없고 대상으로는 검토본 해시가 null이다
  expect(await service.overlayTarget("notes")).toEqual(
    ok({ name: "notes", reviewedHash: null, entries: [], addsTools: false, origin: "user" }),
  );
  expect(await service.overlayTarget("greeter")).toEqual(
    ok({
      name: "greeter",
      reviewedHash: hash,
      entries: [
        { entry: "greeter", kind: "skill" },
        { entry: "hello", kind: "command" },
        { entry: "greeter", kind: "plugin" },
      ],
      addsTools: false,
      origin: "user",
    }),
  );
  expect(await service.overlayTarget("missing")).toEqual(ok(undefined));
});
