import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { WireError } from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { recordingModels } from "../fixtures/recording-tape.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, type EventCollector } from "../fixtures/wire-client.ts";

// AGE-33 앱의 편집 통신(구성원, 의존, 떼기, 합치기)이 쓴 변경은 원본 폴더 훑기가 먼저 보아도 "앱에서 고친 변경"으로 올라 승인할 수 있다.
// 사람이 편집기로 직접 고친 변경(출처 unknown)은 기존 규칙대로 승인할 수 없다. 확인은 모두 값 비교다.
// 모든 파일은 임시 가짜 홈(`useEngineHome`) 안에 만든다. 이름 `core`는 예약어라 `zz-core`, `aa-app`을 쓴다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const CORE = "zz-core";
const APP = "aa-app";
const KIT = "aa-kit";
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
    decision: { kind: "approve", profileIds: [], libraryOnly: true, purpose: "Fixture purpose" },
  });
  expect(decided.item.state).toBe("approved");
}

/** 같은 승인을 거절당하게 한다. 거절된 wire 오류를 돌려준다 */
function refusedApproval(connection: Connection, itemId: string): Promise<WireError> {
  return wireErrorOf(
    connection.request("pluginReview.decide", {
      itemId,
      decision: { kind: "approve", profileIds: [], libraryOnly: true, purpose: "Fixture purpose" },
    }),
  );
}

function userPluginDir(session: Session, name: string): string {
  return join(session.home.root, "config", "plugins", name);
}

/** 원본 폴더 감시가 하는 일: 훑기를 한 번 돌려 대기 항목을 만든다 */
async function scanOnce(connection: Connection): Promise<void> {
  await connection.request("plugin.scan", {});
}

async function pendingOf(connection: Connection, name: string) {
  const listed = await connection.request("pluginReview.list", { state: "pending" });
  return listed.items.filter((entry) => entry.name === name);
}

realTest(
  "a members edit that the folder scan saw first is still approvable after plugin.draft.create + submitDraft",
  async () => {
    const session = await openSession("appedit-members");
    try {
      const { connection } = session;
      const dir = userPluginDir(session, KIT);
      await connection.request("ext.scaffold", { kind: "single-plugin", name: KIT, dir });
      await connection.request("ext.members.edit", {
        dir,
        ops: [{ kind: "add", id: "tap", mode: "hook" }],
      });
      await approveInLibrary(connection, await submit(connection, dir));

      // 앱의 편집 통신이 쓴 뒤, 원본 폴더 감시(훑기)가 먼저 본다
      await connection.request("ext.members.edit", {
        dir,
        ops: [{ kind: "add", id: "more", mode: "hook" }],
      });
      await scanOnce(connection);
      const item = await submit(connection, dir);
      const pending = await pendingOf(connection, KIT);
      expect(pending.map((entry) => [entry.itemId === item, entry.kind, entry.provenance])).toEqual(
        [[true, "update", "assistant"]],
      );
      await approveInLibrary(connection, item);
    } finally {
      await session.close();
    }
  },
  180_000,
);

realTest(
  "a hand edit (the same folder changed outside the app's edit calls) stays unapprovable with handEditNotAllowed",
  async () => {
    const session = await openSession("appedit-hand");
    try {
      const { connection } = session;
      const dir = userPluginDir(session, KIT);
      await connection.request("ext.scaffold", { kind: "single-plugin", name: KIT, dir });
      await approveInLibrary(connection, await submit(connection, dir));

      writeFileSync(join(dir, "README.md"), "edited by hand\n");
      await scanOnce(connection);
      const item = await submit(connection, dir);
      const pending = await pendingOf(connection, KIT);
      expect(pending.map((entry) => [entry.itemId === item, entry.provenance])).toEqual([
        [true, "unknown"],
      ]);
      const refused = await refusedApproval(connection, item);
      expect(refused.data.kind).toBe("pluginReview.handEditNotAllowed");
    } finally {
      await session.close();
    }
  },
  180_000,
);

realTest(
  "dependency edits, detach and merge outputs are approvable app edits even when the scan saw them first",
  async () => {
    const session = await openSession("appedit-others");
    try {
      const { connection, calls } = session;
      const core = userPluginDir(session, CORE);
      const app = userPluginDir(session, APP);
      writePlugin(core, { name: CORE, version: "1.0.0" }, calls);
      writePlugin(app, { name: APP, version: "1.0.0" }, calls);
      await approveInLibrary(connection, await submit(connection, core));
      await approveInLibrary(connection, await submit(connection, app));

      await connection.request("ext.dependencies.edit", {
        dir: app,
        ops: [{ kind: "add", dependency: { plugin: CORE, kind: "soft" } }],
      });
      await scanOnce(connection);
      const depItem = await submit(connection, app);
      expect(
        (await pendingOf(connection, APP)).map((entry) => [
          entry.itemId === depItem,
          entry.provenance,
        ]),
      ).toEqual([[true, "assistant"]]);
      await approveInLibrary(connection, depItem);

      const kit = userPluginDir(session, KIT);
      await connection.request("ext.scaffold", { kind: "single-plugin", name: KIT, dir: kit });
      await connection.request("ext.members.edit", {
        dir: kit,
        ops: [{ kind: "add", id: "tap", mode: "hook" }],
      });
      const out = userPluginDir(session, `${KIT}-tap`);
      await connection.request("ext.members.detach", { dir: kit, member: "tap", outDir: out });
      await scanOnce(connection);
      const detachItem = await submit(connection, out);
      expect(
        (await pendingOf(connection, `${KIT}-tap`)).map((entry) => [
          entry.itemId === detachItem,
          entry.provenance,
        ]),
      ).toEqual([[true, "assistant"]]);

      const merged = userPluginDir(session, "zz-merged");
      await connection.request("ext.members.merge", {
        dirs: [core, app],
        outDir: merged,
        name: "zz-merged",
      });
      await scanOnce(connection);
      const mergeItem = await submit(connection, merged);
      expect(
        (await pendingOf(connection, "zz-merged")).map((entry) => [
          entry.itemId === mergeItem,
          entry.provenance,
        ]),
      ).toEqual([[true, "assistant"]]);
    } finally {
      await session.close();
    }
  },
  180_000,
);

realTest(
  "a brand-new plugin folder dropped in by hand is a new item and the engine lets it be approved (only a changed reviewed plugin is a hand edit)",
  async () => {
    const session = await openSession("appedit-new");
    try {
      const { connection, calls } = session;
      writePlugin(userPluginDir(session, CORE), { name: CORE, version: "1.0.0" }, calls);
      await scanOnce(connection);
      const pending = await pendingOf(connection, CORE);
      expect(pending.map((entry) => [entry.kind, entry.provenance])).toEqual([["new", "unknown"]]);
      const [item] = pending;
      if (item === undefined) throw new Error("the scan did not queue the folder");
      await approveInLibrary(connection, item.itemId);
    } finally {
      await session.close();
    }
  },
  180_000,
);
