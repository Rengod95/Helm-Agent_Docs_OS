import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  validateManifest,
  validateManifestSet,
  type ExtensionManifest,
} from "@fresnel/contracts/extensions";
import { WireError } from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { fillScaffoldTextsOf } from "../fixtures/plugin-review.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { recordingModels } from "../fixtures/recording-tape.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import {
  collectEvents,
  HELLO_PARAMS,
  startTurnWhenIdle,
  until,
  type EventCollector,
} from "../fixtures/wire-client.ts";

// AGE-33 의존(`dependsOn`)의 끝에서 끝까지 시험(int, 실제 엔진). 설치 거절, 프로필 검증, 끄기와 삭제 거절과 함께 끄기,
// 업데이트 막기, 순환, 켜는 순서, 선 편집 뒤 리뷰 재통과, 떼기, 합치기를 wire로 부른다. 확인은 모두 값 비교다.
// 모든 파일은 임시 가짜 홈(`useEngineHome`) 안에 만든다. 이름 `core`는 예약어라 `zz-core`, `aa-app`을 쓴다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const CORE = "zz-core";
const APP = "aa-app";
const SOFT = "aa-soft";
const KIT = "aa-kit";
const BASE = "cap-knowledge";
const PROFILE = "dep-profile";
const SOFT_PROFILE = "dep-soft";
const MODEL_ANSWERS = Array.from({ length: 16 }, (_, index) => `answer ${String(index + 1)}.`);

type Connection = ReturnType<typeof createHostConnection>;

/** 플러그인 코드가 호출될 때 적는 로그 파일 두 개. 설정(setup)은 켜질 때, 훅은 턴이 정산될 때 한 줄씩 붙는다 */
interface CallLog {
  readonly setup: string;
  readonly hook: string;
}

interface Dep {
  readonly plugin: string;
  readonly kind: "hard" | "soft";
  readonly range?: string;
}

interface PluginSpec {
  readonly name: string;
  readonly version: string;
  readonly dependsOn?: readonly Dep[];
  readonly provides?: readonly { readonly id: string; readonly version: string }[];
}

interface Session {
  readonly home: EngineHome;
  /** 가짜 홈의 실제 경로. 작업 폴더와 로그 파일이 여기 있다 */
  readonly root: string;
  readonly calls: CallLog;
  readonly connection: Connection;
  readonly collector: EventCollector;
  close(): Promise<void>;
}

/** 단일 플러그인 폴더 하나의 코드: 켜질 때 setup 로그에, 턴이 정산될 때 훅 로그에 이름 한 줄을 붙인다 */
function entryOf(name: string, calls: CallLog): string {
  return [
    'import { appendFileSync } from "node:fs";',
    "export const extension = ({ register }) => {",
    `  register(${JSON.stringify(name)}, {}, (g) => {`,
    `    appendFileSync(${JSON.stringify(calls.setup)}, ${JSON.stringify(`${name}\n`)});`,
    `    g.on("boundary.settle.after", () => { appendFileSync(${JSON.stringify(calls.hook)}, ${JSON.stringify(`${name}\n`)}); });`,
    "  });",
    "};",
    "",
  ].join("\n");
}

/** 독립 플러그인 폴더 하나를 쓴다(스키마 2, 선언 하나, 훅 하나). 같은 폴더에 다시 쓰면 판만 바뀐다 */
function writePlugin(dir: string, spec: PluginSpec, calls: CallLog): void {
  mkdirSync(join(dir, ".fresnel-plugin"), { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  const decl = {
    layer: "plugin",
    hooks: ["boundary.settle.after"],
    ...(spec.dependsOn === undefined ? {} : { dependsOn: spec.dependsOn }),
    ...(spec.provides === undefined ? {} : { provides: spec.provides }),
  };
  writeFileSync(
    join(dir, ".fresnel-plugin", "plugin.json"),
    `${JSON.stringify(
      {
        schemaVersion: 2,
        name: spec.name,
        version: spec.version,
        purpose: `Dependency fixture ${spec.name}`,
        description: `Dependency fixture ${spec.name} (test fixture).`,
        defaultEnabled: false,
        entry: "./src/index.ts",
        plugins: [decl],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(dir, "src", "index.ts"), entryOf(spec.name, calls));
}

/** 폴더 안 모든 파일의 바이트(base64). 원본이 그대로인지 값으로 비교한다 */
function snapshotOf(root: string, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(out, snapshotOf(root, rel));
    else out[rel] = readFileSync(join(root, rel)).toString("base64");
  }
  return out;
}

/** 로그 파일의 줄들. 없으면 빈 배열이다 */
function readLog(path: string): readonly string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

async function openSession(tag: string): Promise<Session> {
  const home = useEngineHome();
  writeUserSettings(home, TAPE_SETTINGS);
  const root = realpathSync(home.root);
  const work = join(root, "work");
  const bundles = join(root, "bundles");
  mkdirSync(work, { recursive: true });
  mkdirSync(bundles, { recursive: true });
  const calls: CallLog = { setup: join(root, "setup.log"), hook: join(root, "hook.log") };
  const model = recordingModels(tag, MODEL_ANSWERS, { contextWindow: 200_000 });
  const previousCwd = process.cwd();
  process.chdir(work);
  const host = await startInProcessHost({
    devChecks: true,
    pluginHost: { disabled: true },
    defaultPluginsDir: bundles,
    extraPlugins: [],
    buildModels: model.buildModels,
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  const collector = collectEvents(connection);
  await connection.request("events.subscribe", { from: "head" });
  return {
    home,
    root,
    calls,
    connection,
    collector,
    async close() {
      await connection.close();
      await host.close();
      process.chdir(previousCwd);
      home.dispose();
    },
  };
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

/** 설치 화면과 같은 길: 폴더로 초안을 만들고 검토함에 제출한다. 항목 id를 돌려준다 */
async function submit(connection: Connection, dir: string): Promise<string> {
  const draft = await connection.request("plugin.draft.create", { dir });
  const submitted = await connection.request("pluginReview.submitDraft", {
    draftId: draft.draftId,
  });
  return submitted.itemId;
}

/** 프로필에 넣지 않고 보관만 하는 승인. 승인이 끝났는지 값으로 본다 */
async function approveInLibrary(connection: Connection, itemId: string): Promise<void> {
  const decided = await connection.request("pluginReview.decide", {
    itemId,
    decision: { kind: "approve", profileIds: [], libraryOnly: true },
  });
  expect(decided.item.state).toBe("approved");
}

/** 같은 승인을 거절당하게 한다. 거절된 wire 오류를 돌려준다 */
function refusedApproval(connection: Connection, itemId: string): Promise<WireError> {
  return wireErrorOf(
    connection.request("pluginReview.decide", {
      itemId,
      decision: { kind: "approve", profileIds: [], libraryOnly: true },
    }),
  );
}

function profileBody(id: string, plugins: readonly string[], startDrive: string | null = null) {
  return {
    id,
    title: id,
    plugins: plugins.map((name) => ({ name })),
    settings: [],
    startDrive,
  };
}

async function runTurn(session: Session, threadId: ThreadId, input: string): Promise<void> {
  const started = await startTurnWhenIdle(session.connection, { threadId, input });
  await session.collector.waitFor(
    (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
  );
}

/** 검사 함수에 넘길 매니페스트 하나. 형식이 맞지 않으면 시험이 던진다 */
function manifestOf(name: string, target: string, kind: "hard" | "soft"): ExtensionManifest {
  const checked = validateManifest({
    schemaVersion: 2,
    name,
    version: "1.0.0",
    purpose: `Cycle fixture ${name}`,
    description: `Cycle fixture ${name} (test fixture).`,
    defaultEnabled: false,
    entry: "./src/index.ts",
    plugins: [{ layer: "plugin", hooks: [], dependsOn: [{ plugin: target, kind }] }],
  });
  if (checked.manifest === undefined) {
    throw new Error(`the fixture manifest ${name} is invalid`);
  }
  return checked.manifest;
}

realTest(
  "a hard dependency that is not approved yet refuses the approval with plugin.dependency unmet, the item stays pending, and a soft one is approved as a warning",
  async () => {
    const session = await openSession("dep-install");
    try {
      const { connection, root, calls } = session;
      const appDir = join(root, "work", APP);
      writePlugin(
        appDir,
        { name: APP, version: "1.0.0", dependsOn: [{ plugin: CORE, kind: "hard" }] },
        calls,
      );
      const appItem = await submit(connection, appDir);
      const unmet = {
        reason: "unmet",
        plugin: APP,
        items: [
          {
            from: APP,
            target: CORE,
            kind: "hard",
            range: null,
            problem: "target_missing",
            found: null,
          },
        ],
      };

      // 1. 대상이 검토함에도 없다
      const missing = await refusedApproval(connection, appItem);
      expect(missing.data.kind).toBe("plugin.dependency");
      expect(missing.data.details).toEqual(unmet);

      // 2. 대상이 검토함에는 있지만 승인 전이다: 여전히 설치된 것이 없어 거절하고, 항목은 대기로 남는다
      const coreDir = join(root, "work", CORE);
      writePlugin(coreDir, { name: CORE, version: "1.0.0" }, calls);
      const coreItem = await submit(connection, coreDir);
      const beforeCore = await refusedApproval(connection, appItem);
      expect(beforeCore.data.details).toEqual(unmet);
      const stillPending = await connection.request("pluginReview.get", { itemId: appItem });
      expect(stillPending.item.state).toBe("pending");

      // 3. soft 대상은 승인 전이어도 승인된다(경고만)
      const softDir = join(root, "work", SOFT);
      writePlugin(
        softDir,
        { name: SOFT, version: "1.0.0", dependsOn: [{ plugin: CORE, kind: "soft" }] },
        calls,
      );
      const softItem = await submit(connection, softDir);
      await approveInLibrary(connection, softItem);
      const softCard = await connection.request("pluginReview.get", { itemId: softItem });
      expect(softCard.item.card.dependencies?.dependsOn).toEqual([
        { from: SOFT, target: CORE, kind: "soft", range: null, problem: "target_missing" },
      ]);

      // 4. 대상을 승인하면 기대는 쪽도 승인된다
      await approveInLibrary(connection, coreItem);
      await approveInLibrary(connection, appItem);
    } finally {
      await session.close();
    }
  },
  180_000,
);

realTest(
  "a profile with a hard dependency whose target is approved but not in the profile is refused as dependency_disabled, adding the target passes, and a soft dependency is saved with a warning",
  async () => {
    const session = await openSession("dep-profile");
    try {
      const { connection, root, calls } = session;
      const coreDir = join(root, "work", CORE);
      const appDir = join(root, "work", APP);
      const softDir = join(root, "work", SOFT);
      writePlugin(coreDir, { name: CORE, version: "1.0.0" }, calls);
      writePlugin(
        appDir,
        { name: APP, version: "1.0.0", dependsOn: [{ plugin: CORE, kind: "hard" }] },
        calls,
      );
      writePlugin(
        softDir,
        { name: SOFT, version: "1.0.0", dependsOn: [{ plugin: CORE, kind: "soft" }] },
        calls,
      );
      await approveInLibrary(connection, await submit(connection, coreDir));
      await approveInLibrary(connection, await submit(connection, appDir));
      await approveInLibrary(connection, await submit(connection, softDir));

      // 1. hard: 대상이 승인되어 있어도 프로필에 없으면 저장을 막는다
      const refused = await wireErrorOf(
        connection.request("profile.put", {
          profile: profileBody(PROFILE, [BASE, APP]),
          baseRev: null,
        }),
      );
      expect(refused.data.kind).toBe("profile.invalid");
      expect(refused.data.details).toEqual({
        issues: [{ code: "dependency_disabled", severity: "error", plugin: APP, other: CORE }],
      });

      // 2. 대상을 넣으면 통과하고 저장된다
      const stored = await connection.request("profile.put", {
        profile: profileBody(PROFILE, [BASE, APP, CORE]),
        baseRev: null,
      });
      expect(stored.issues).toEqual([]);
      expect(stored.profile.plugins).toEqual([{ name: BASE }, { name: APP }, { name: CORE }]);

      // 3. soft: 대상이 프로필에 없어도 경고만 내고 저장한다
      const softStored = await connection.request("profile.put", {
        profile: profileBody(SOFT_PROFILE, [BASE, SOFT]),
        baseRev: null,
      });
      expect(softStored.issues).toEqual([
        { code: "dependency_disabled", severity: "warning", plugin: SOFT, other: CORE },
      ]);
      const reread = await connection.request("profile.get", { id: SOFT_PROFILE });
      expect(reread.profile.plugins).toEqual([{ name: BASE }, { name: SOFT }]);
    } finally {
      await session.close();
    }
  },
  180_000,
);

realTest(
  "removing a plugin that a hard dependency needs is refused as profile.invalid with the dependent listed, withDependents removes both in one edit, and requestRemove refuses with required_by while the dependent is installed",
  async () => {
    const session = await openSession("dep-remove");
    try {
      const { connection, root, calls } = session;
      const coreDir = join(root, "work", CORE);
      const appDir = join(root, "work", APP);
      writePlugin(coreDir, { name: CORE, version: "1.0.0" }, calls);
      writePlugin(
        appDir,
        { name: APP, version: "1.0.0", dependsOn: [{ plugin: CORE, kind: "hard" }] },
        calls,
      );
      await approveInLibrary(connection, await submit(connection, coreDir));
      await approveInLibrary(connection, await submit(connection, appDir));
      const put = await connection.request("profile.put", {
        profile: profileBody(PROFILE, [BASE, CORE, APP]),
        baseRev: null,
      });
      const rev = put.profile.rev;

      // 1. 끄기: 기대는 쪽이 남아 있으므로 거절하고 프로필은 그대로다
      const blocked = await wireErrorOf(
        connection.request("profile.removePlugin", { id: PROFILE, plugin: CORE, baseRev: rev }),
      );
      expect(blocked.data.kind).toBe("profile.invalid");
      expect(blocked.data.details).toEqual({
        issues: [{ code: "dependency_disabled", severity: "error", plugin: APP, other: CORE }],
      });
      const unchanged = await connection.request("profile.get", { id: PROFILE });
      expect(unchanged.profile.plugins).toEqual([{ name: BASE }, { name: CORE }, { name: APP }]);

      // 2. withDependents: 기대는 쪽까지 한 번의 편집으로 같이 뺀다
      const removed = await connection.request("profile.removePlugin", {
        id: PROFILE,
        plugin: CORE,
        baseRev: rev,
        withDependents: true,
      });
      expect(removed.profile.plugins).toEqual([{ name: BASE }]);

      // 3. 삭제: 설치된 APP이 hard로 기대므로 제거 항목을 만들지 않는다
      const remove = await wireErrorOf(connection.request("plugin.requestRemove", { name: CORE }));
      expect(remove.data.kind).toBe("plugin.dependency");
      expect(remove.data.details).toEqual({
        reason: "required_by",
        plugin: CORE,
        items: [
          {
            from: APP,
            target: CORE,
            kind: "hard",
            range: null,
            problem: "depended_on",
            found: null,
          },
        ],
      });
      const pending = await connection.request("pluginReview.list", { state: "pending" });
      expect(pending.items.filter((item) => item.kind === "remove")).toEqual([]);
    } finally {
      await session.close();
    }
  },
  180_000,
);

realTest(
  "a major update of a plugin that a hard dependency's range excludes is refused with breaks_range listing the dependent, and a minor update that keeps the range is approved",
  async () => {
    const session = await openSession("dep-update");
    try {
      const { connection, root, calls } = session;
      const coreDir = join(root, "work", CORE);
      const appDir = join(root, "work", APP);
      writePlugin(coreDir, { name: CORE, version: "1.0.0" }, calls);
      await approveInLibrary(connection, await submit(connection, coreDir));
      writePlugin(
        appDir,
        {
          name: APP,
          version: "1.0.0",
          dependsOn: [{ plugin: CORE, kind: "hard", range: "^1.0.0" }],
        },
        calls,
      );
      await approveInLibrary(connection, await submit(connection, appDir));

      // 2.0.0은 aa-app이 기대는 ^1.0.0을 깬다
      writePlugin(coreDir, { name: CORE, version: "2.0.0" }, calls);
      const major = await submit(connection, coreDir);
      const refused = await refusedApproval(connection, major);
      expect(refused.data.kind).toBe("plugin.dependency");
      expect(refused.data.details).toEqual({
        reason: "breaks_range",
        plugin: CORE,
        items: [
          {
            from: APP,
            target: CORE,
            kind: "hard",
            range: "^1.0.0",
            problem: "range_unmet",
            found: "2.0.0",
          },
        ],
      });
      const stillPending = await connection.request("pluginReview.get", { itemId: major });
      expect(stillPending.item.state).toBe("pending");

      // 1.1.0은 범위 안이라 승인된다
      writePlugin(coreDir, { name: CORE, version: "1.1.0" }, calls);
      const minor = await submit(connection, coreDir);
      await approveInLibrary(connection, minor);
    } finally {
      await session.close();
    }
  },
  180_000,
);

test("the manifest set check reports a hard dependency cycle as a dependency_cycle error, and a cycle made of soft dependencies passes", () => {
  expect(
    validateManifestSet([manifestOf(APP, CORE, "hard"), manifestOf(CORE, APP, "hard")]),
  ).toEqual([
    {
      severity: "error",
      code: "dependency_cycle",
      path: `${APP}/dependsOn`,
      message: `hard dependencies form a cycle: ${APP} -> ${CORE} -> ${APP}`,
    },
  ]);
  expect(
    validateManifestSet([manifestOf(APP, CORE, "soft"), manifestOf(CORE, APP, "soft")]),
  ).toEqual([]);
});

realTest(
  "turning on a plugin whose hard target is in the same profile starts the target first, while the hook order stays the profile's order",
  async () => {
    const session = await openSession("dep-order");
    try {
      const { connection, root, calls } = session;
      const coreDir = join(root, "work", CORE);
      const appDir = join(root, "work", APP);
      writePlugin(coreDir, { name: CORE, version: "1.0.0" }, calls);
      writePlugin(
        appDir,
        { name: APP, version: "1.0.0", dependsOn: [{ plugin: CORE, kind: "hard" }] },
        calls,
      );
      await approveInLibrary(connection, await submit(connection, coreDir));
      await approveInLibrary(connection, await submit(connection, appDir));
      // 프로필은 aa-app을 zz-core보다 앞에 적는다: 훅 호출 순서는 이 순서를 따른다
      await connection.request("profile.put", {
        profile: profileBody(PROFILE, [BASE, APP, CORE]),
        baseRev: null,
      });
      const thread = await connection.request("thread.create", {
        workspace: join(root, "work"),
        profileId: PROFILE,
      });
      await runTurn(session, thread.threadId, "hello");
      expect(await until(() => readLog(calls.hook).length >= 2, 10_000)).toBe(true);

      // 켜기: 기대는 aa-app보다 zz-core가 먼저 싣는다
      expect(readLog(calls.setup)).toEqual([CORE, APP]);
      // 훅 호출: 프로필이 정한 순서(aa-app, zz-core) 그대로다
      expect(readLog(calls.hook)).toEqual([APP, CORE]);
    } finally {
      await session.close();
    }
  },
  180_000,
);

realTest(
  "after an edit that adds a hard line, the folder goes through review again: the new item's card shows the line in dependsOn, and editing the installed copy is denied",
  async () => {
    const session = await openSession("dep-edit");
    try {
      const { connection, root, calls } = session;
      const coreDir = join(root, "work", CORE);
      const appDir = join(root, "work", APP);
      writePlugin(coreDir, { name: CORE, version: "1.0.0" }, calls);
      writePlugin(appDir, { name: APP, version: "1.0.0" }, calls);
      await approveInLibrary(connection, await submit(connection, coreDir));
      await approveInLibrary(connection, await submit(connection, appDir));

      // 원본 폴더에서 선을 긋고 새 초안으로 다시 검토한다
      const edited = await connection.request("ext.dependencies.edit", {
        dir: appDir,
        ops: [{ kind: "add", dependency: { plugin: CORE, range: "^1.0.0", kind: "hard" } }],
      });
      expect(edited.dependencies).toEqual([
        { from: APP, target: CORE, kind: "hard", range: "^1.0.0" },
      ]);
      const item = await submit(connection, appDir);
      const listed = await connection.request("pluginReview.list", { state: "pending" });
      expect(
        listed.items
          .filter((entry) => entry.name === APP)
          .map((entry) => [entry.itemId === item, entry.kind]),
      ).toEqual([[true, "update"]]);
      const got = await connection.request("pluginReview.get", { itemId: item });
      expect(got.item.card.dependencies?.dependsOn).toEqual([
        { from: APP, target: CORE, kind: "hard", range: "^1.0.0", problem: null },
      ]);
      await approveInLibrary(connection, item);

      // 설치본 폴더(검토본 저장소 안)는 원본이 아니라서 편집을 거절한다
      const stored = join(root, "data", "plugin-store", "reviewed", APP);
      expect(existsSync(stored)).toBe(true);
      const denied = await wireErrorOf(
        connection.request("ext.dependencies.edit", {
          dir: stored,
          ops: [{ kind: "add", dependency: { plugin: CORE, kind: "soft" } }],
        }),
      );
      expect(denied.data.kind).toBe("jsonrpc.invalidParams");
      expect(denied.data.details).toEqual({
        issues: [
          {
            path: "/dir",
            message:
              "denied: the folder is an installed or stored copy, not a source folder; edit the source folder instead",
          },
        ],
      });
    } finally {
      await session.close();
    }
  },
  180_000,
);

realTest(
  "detaching a member keeps the source folder's bytes, and the new folder passes plugin.draft.create with a dependsOn line back to the original name",
  async () => {
    const session = await openSession("dep-detach");
    try {
      const { connection, root } = session;
      const kitDir = join(root, "work", KIT);
      await connection.request("ext.scaffold", { kind: "single-plugin", name: KIT, dir: kitDir });
      fillScaffoldTextsOf(kitDir);
      await connection.request("ext.members.edit", {
        dir: kitDir,
        ops: [
          { kind: "add", id: "hook", mode: "hook" },
          { kind: "add", id: "tap", mode: "hook" },
        ],
      });
      const before = snapshotOf(kitDir);
      const outDir = join(root, "work", `${KIT}-tap`);
      const detached = await connection.request("ext.members.detach", {
        dir: kitDir,
        member: "tap",
        outDir,
        keepDependency: true,
        dependencyKind: "hard",
      });
      expect(detached.name).toBe(`${KIT}-tap`);
      expect(detached.profileMove).toEqual({ from: `${KIT}/tap`, to: `${KIT}-tap` });
      expect(snapshotOf(kitDir)).toEqual(before);

      const item = await submit(connection, outDir);
      const listed = await connection.request("pluginReview.list", { state: "pending" });
      expect(
        listed.items
          .filter((entry) => entry.name === `${KIT}-tap`)
          .map((entry) => [entry.itemId === item, entry.kind]),
      ).toEqual([[true, "new"]]);
      const got = await connection.request("pluginReview.get", { itemId: item });
      expect(got.item.card.dependencies?.dependsOn).toEqual([
        { from: `${KIT}-tap`, target: KIT, kind: "hard", range: null, problem: "target_missing" },
      ]);
    } finally {
      await session.close();
    }
  },
  180_000,
);

realTest(
  "merging two independent folders writes a new folder that passes plugin.draft.create and leaves the sources as they were; a same-provides clash is refused with capability_duplicate",
  async () => {
    const session = await openSession("dep-merge");
    try {
      const { connection, root, calls } = session;
      const alpha = join(root, "work", "aa-alpha");
      const beta = join(root, "work", "aa-beta");
      const gamma = join(root, "work", "aa-gamma");
      writePlugin(
        alpha,
        { name: "aa-alpha", version: "1.0.0", provides: [{ id: "web.search", version: "0.1.0" }] },
        calls,
      );
      writePlugin(beta, { name: "aa-beta", version: "1.0.0" }, calls);
      writePlugin(
        gamma,
        { name: "aa-gamma", version: "1.0.0", provides: [{ id: "web.search", version: "0.1.0" }] },
        calls,
      );
      const alphaBefore = snapshotOf(alpha);
      const betaBefore = snapshotOf(beta);

      const merged = join(root, "work", "zz-merged");
      const made = await connection.request("ext.members.merge", {
        dirs: [alpha, beta],
        outDir: merged,
        name: "zz-merged",
      });
      expect(made.name).toBe("zz-merged");
      expect(made.members.map((member) => member.id)).toEqual(["aa-alpha", "aa-beta"]);
      expect(made.profileMove).toEqual([
        { from: "aa-alpha", to: "zz-merged/aa-alpha" },
        { from: "aa-beta", to: "zz-merged/aa-beta" },
      ]);
      expect(made.changedFiles).toEqual([".fresnel-plugin/plugin.json"]);
      expect(snapshotOf(alpha)).toEqual(alphaBefore);
      expect(snapshotOf(beta)).toEqual(betaBefore);

      const item = await submit(connection, merged);
      const listed = await connection.request("pluginReview.list", { state: "pending" });
      expect(
        listed.items
          .filter((entry) => entry.name === "zz-merged")
          .map((entry) => [entry.itemId === item, entry.kind]),
      ).toEqual([[true, "new"]]);

      // 같은 기능을 두 원본이 제공하면 합치기를 거절하고 아무것도 쓰지 않는다
      const clashOut = join(root, "work", "zz-clash");
      const clash = await wireErrorOf(
        connection.request("ext.members.merge", {
          dirs: [alpha, gamma],
          outDir: clashOut,
          name: "zz-clash",
        }),
      );
      expect(clash.data.kind).toBe("jsonrpc.invalidParams");
      expect(clash.data.details).toEqual({
        issues: [
          {
            path: "/dirs",
            message: "invalid_input: the folders cannot be merged: capability_duplicate",
          },
        ],
        reasons: [
          {
            code: "capability_duplicate",
            field: "dirs/1",
            message: "capability web.search is declared by aa-alpha and aa-gamma",
          },
        ],
      });
      expect(existsSync(clashOut)).toBe(false);
    } finally {
      await session.close();
    }
  },
  180_000,
);
