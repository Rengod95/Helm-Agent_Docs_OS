import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { editMembers } from "@fresnel/core-authoring";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { WireError } from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { recordingModels } from "../fixtures/recording-tape.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import {
  collectEvents,
  HELLO_PARAMS,
  startInputWhenIdle,
  startTurnWhenIdle,
  until,
  type EventCollector,
} from "../fixtures/wire-client.ts";

// 구성원이 둘 이상인 플러그인이 끝에서 끝까지 도는 것(실제 엔진). 뿌리 하나와 구성원 넷(Hook 둘, Drive 하나, 지침만 있는 Inject 하나)을 가진
// 폴더 플러그인을 검토 흐름(초안 → 제출 → 승인)으로 프로필에 넣고 턴을 돌린다. 확인은 모두 값 비교다: 등록 id 목록, 검토 항목 수,
// 호출 로그(배열), 모델 입력 본문(지침과 구동 입력의 글), 도구 광고 목록, 상태 값.
// 훅 호출 순서는 로그 파일에 한 줄씩 적히는 순서로 본다. 구성원은 `editMembers`로 고치고 새 초안으로 다시 승인한다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const NAME = "members-kit";
const PROFILE = "members-profile";
const OFF_PROFILE = "members-off";
const BASE = "cap-knowledge";
const GUIDE = "MEMBERS-INJECT-GUIDE: answer the members kit question.";
const DRIVE_TEXT = "DRIVE-MEMBER-START";
const MODEL_ANSWERS = Array.from({ length: 16 }, (_, index) => `answer ${String(index + 1)}.`);

type Connection = ReturnType<typeof createHostConnection>;

/** 구성원 코드의 훅 하나: 호출될 때 로그 파일에 `tag` 한 줄을 붙인다 */
function hookSource(log: string, tag: string): string {
  return [
    'import { appendFileSync } from "node:fs";',
    'import type { RegistrationApi } from "@fresnel/contracts/extensions";',
    "export function setup(g: RegistrationApi<unknown>): void {",
    `  g.on("boundary.settle.after", () => { appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(`${tag}\n`)}); });`,
    "}",
    "",
  ].join("\n");
}

/** Drive 구성원: 사용자 입력을 받으면 자기 입력 글로 턴 하나를 내고, 그 결과를 받으면 끝낸다 */
function driveSource(): string {
  return [
    'import type { RegistrationApi } from "@fresnel/contracts/extensions";',
    "export function setup(g: RegistrationApi<unknown>): void {",
    "  g.drive(({ last }) => {",
    `    if (last?.kind === "user") return Promise.resolve({ do: "turn", input: { kind: "user", content: ${JSON.stringify(DRIVE_TEXT)} } });`,
    '    return Promise.resolve({ do: "done" });',
    "  });",
    "}",
    "",
  ].join("\n");
}

/** 뿌리와 구성원을 등록하는 엔트리(템플릿과 같은 모양): 구성원 setup은 `src/members.generated.ts`에서 가져온다 */
function entrySource(log: string): string {
  return [
    'import { appendFileSync } from "node:fs";',
    'import { pluginsOf, type ExtensionEntry } from "@fresnel/contracts/extensions";',
    'import { memberSetups } from "./members.generated.ts";',
    "const noSetup = (): void => {};",
    "export const extension: ExtensionEntry = ({ manifest, register }) => {",
    "  register(manifest.name, {}, (g) => {",
    `    g.on("boundary.settle.after", () => { appendFileSync(${JSON.stringify(log)}, "ROOT\\n"); });`,
    "  });",
    "  for (const member of pluginsOf(manifest)) {",
    "    const id = member.decl.id;",
    "    if (member.root || id === undefined) continue;",
    "    register(member.registrationId, {}, memberSetups[id] ?? noSetup);",
    "  }",
    "};",
    "",
  ].join("\n");
}

/** 생성 파일 글(`editMembers`가 쓰는 것과 같은 모양). 코드가 있는 구성원만 적는다 */
function generatedSource(ids: readonly string[]): string {
  const imports = ids.map(
    (id, index) => `import { setup as setupOf${String(index)} } from "./members/${id}.ts";`,
  );
  const entries = ids.map((id, index) => `  ${JSON.stringify(id)}: setupOf${String(index)},`);
  return [
    "// 생성 파일: 직접 고치지 않는다",
    'import type { RegistrationApi } from "@fresnel/contracts/extensions";',
    ...imports,
    "",
    "export const memberSetups: Readonly<Record<string, (g: RegistrationApi<unknown>) => void | Promise<void>>> = {",
    ...entries,
    "};",
    "",
  ].join("\n");
}

/** 구성원 여럿과 뿌리의 Hook, Drive, 지침 구성원을 가진 폴더를 쓴다(순서: 뿌리, hook, tap, drive, inject) */
function writeKit(root: string, log: string): void {
  mkdirSync(join(root, ".fresnel-plugin"), { recursive: true });
  mkdirSync(join(root, "src", "members"), { recursive: true });
  writeFileSync(
    join(root, ".fresnel-plugin", "plugin.json"),
    JSON.stringify(
      {
        schemaVersion: 2,
        name: NAME,
        version: "1.0.0",
        purpose: "Members integration kit: two hooks, a drive and an instruction under one root.",
        defaultEnabled: false,
        entry: "./src/index.ts",
        orchestration: {},
        plugins: [
          { layer: "L3", hooks: ["boundary.settle.after"] },
          { id: "hook", layer: "L3", hooks: ["boundary.settle.after"], defaultEnabled: false },
          { id: "tap", layer: "L3", hooks: ["boundary.settle.after"] },
          { id: "drive", layer: "L3", hooks: [], drives: true },
          { id: "inject", layer: "L3", hooks: [] },
        ],
        components: { instructions: ["instructions.md"] },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(root, "instructions.md"), `${GUIDE}\n`);
  writeFileSync(join(root, "src", "index.ts"), entrySource(log));
  writeFileSync(
    join(root, "src", "members.generated.ts"),
    generatedSource(["hook", "tap", "drive"]),
  );
  writeFileSync(join(root, "src", "members", "hook.ts"), hookSource(log, "HOOK"));
  writeFileSync(join(root, "src", "members", "tap.ts"), hookSource(log, "TAP"));
  writeFileSync(join(root, "src", "members", "drive.ts"), driveSource());
}

/** 로그 파일의 줄들. 없으면 빈 배열이다 */
function readLog(log: string): readonly string[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

/** 턴이 끝난 뒤 정산 훅이 로그에 쓰기를 끝낼 때까지 짧게 기다린다(호출이 없어야 한다는 부정 확인 전용) */
async function settle(): Promise<void> {
  await Bun.sleep(300);
}

async function waitLog(log: string, count: number): Promise<void> {
  if (!(await until(() => readLog(log).length >= count, 10_000))) {
    throw new Error(`the hook log did not reach ${String(count)} lines: ${readLog(log).join(",")}`);
  }
}

function startHost(model: ReturnType<typeof recordingModels>) {
  return startInProcessHost({
    devChecks: true,
    pluginHost: { disabled: true },
    defaultPluginsDir: mkdtempSync(join(tmpdir(), "members-bundles-")),
    extraPlugins: [],
    buildModels: model.buildModels,
  });
}

async function runTurn(
  connection: Connection,
  collector: EventCollector,
  threadId: ThreadId,
  input: string,
): Promise<void> {
  const started = await startTurnWhenIdle(connection, { threadId, input });
  await collector.waitFor(
    (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
  );
}

/** 설치 화면과 같은 길: 폴더로 초안을 만들고 검토함에 제출한다. 항목 id를 돌려준다 */
async function submit(connection: Connection, dir: string): Promise<string> {
  const draft = await connection.request("plugin.draft.create", { dir });
  const submitted = await connection.request("pluginReview.submitDraft", {
    draftId: draft.draftId,
  });
  return submitted.itemId;
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

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value));
}

/** 이슈 코드만 값으로 비교한다(`profile.invalid`의 `details.issues`) */
function issueCodesOf(error: WireError): readonly string[] {
  const issues: unknown = recordOf(error.data.details)["issues"];
  if (!Array.isArray(issues)) return [];
  return issues.map((issue: unknown) => {
    const code = recordOf(issue)["code"];
    return typeof code === "string" ? code : "";
  });
}

/** 확장 하나의 Registration 목록(id 순서 그대로)과 대화에서의 상태 */
async function registrationsOf(
  connection: Connection,
  threadId: ThreadId | undefined,
): Promise<
  readonly {
    readonly registrationId: string;
    readonly status: string;
    readonly thread: string | undefined;
  }[]
> {
  const listed = await connection.request("ext.list", threadId === undefined ? {} : { threadId });
  const entry = listed.extensions.find((item) => item.name === NAME);
  if (entry === undefined) return [];
  return entry.plugins.map((plugin) => ({
    registrationId: plugin.registrationId,
    status: plugin.status,
    thread: plugin.thread,
  }));
}

/** 프로필 `profileId`의 새 대화를 열고 턴 하나를 돌린다 */
async function runTurnOn(
  connection: Connection,
  collector: EventCollector,
  workspace: string,
  profileId: string,
  input: string,
): Promise<ThreadId> {
  const thread = await connection.request("thread.create", { workspace, profileId });
  await runTurn(connection, collector, thread.threadId, input);
  return thread.threadId;
}

/** 검토 항목 하나를 승인해 프로필 PROFILE에 넣는다 */
async function approveInto(connection: Connection, itemId: string): Promise<readonly string[]> {
  const decided = await connection.request("pluginReview.decide", {
    itemId,
    decision: { kind: "approve", profileIds: [PROFILE], libraryOnly: false },
  });
  expect(decided.item.state).toBe("approved");
  return decided.appliedTo;
}

realTest(
  "a folder plugin with a root and four members is reviewed as one item, approved into a profile, and its root, hook, drive and instruction members all run in a turn; a profile without it runs none of them",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-members-")));
    const log = join(workspace, "calls.log");
    const source = join(workspace, "source", NAME);
    writeKit(source, log);
    const model = recordingModels("members", MODEL_ANSWERS, { contextWindow: 200_000 });
    const previousCwd = process.cwd();
    process.chdir(workspace);
    const host = await startHost(model);
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });
      await connection.request("profile.put", {
        profile: profileBody(PROFILE, [BASE]),
        baseRev: null,
      });
      await connection.request("profile.put", {
        profile: profileBody(OFF_PROFILE, [BASE]),
        baseRev: null,
      });

      // 1. 검토: 폴더 하나가 항목 하나다. 카드는 구성원들의 훅·Drive·지침을 합쳐 보여 준다
      const itemId = await submit(connection, source);
      const listed = await connection.request("pluginReview.list", { state: "pending" });
      const mine = listed.items.filter((entry) => entry.name === NAME);
      expect(mine.map((entry) => [entry.itemId === itemId, entry.kind])).toEqual([[true, "new"]]);
      const pending = await connection.request("pluginReview.get", { itemId });
      expect(pending.item.card.does.hook?.hooks.map((hook) => hook.name)).toEqual([
        "boundary.settle.after",
      ]);
      expect(pending.item.card.does.drive).not.toBeNull();
      expect(pending.item.card.does.inject).not.toBeNull();

      // 승인하기 전에는 프로필에 넣을 수 없다
      const beforeApprove = await connection.request("profile.get", { id: PROFILE });
      const notReviewed = await wireErrorOf(
        connection.request("profile.put", {
          profile: profileBody(PROFILE, [BASE, NAME]),
          baseRev: beforeApprove.profile.rev,
        }),
      );
      expect(issueCodesOf(notReviewed)).toEqual(["plugin_not_reviewed"]);

      // 2. 승인과 함께 프로필에 넣는다. 로더는 뿌리와 구성원 넷을 등록하고 진단에 등록 누락이 없다
      expect(await approveInto(connection, itemId)).toEqual([PROFILE]);
      const profileStored = await connection.request("profile.get", { id: PROFILE });
      expect(profileStored.profile.plugins).toEqual([{ name: BASE }, { name: NAME }]);
      const installed = await connection.request("ext.list", {});
      const kit = installed.extensions.find((item) => item.name === NAME);
      expect(kit?.plugins.map((plugin) => plugin.registrationId)).toEqual([
        NAME,
        `${NAME}/hook`,
        `${NAME}/tap`,
        `${NAME}/drive`,
        `${NAME}/inject`,
      ]);
      expect(kit?.diagnostics.some((item) => item.code === "plugin_not_registered")).toBe(false);

      // 3. 프로필의 대화는 턴에서 각 구성원의 블록을 돈다: 뿌리와 두 훅은 등록 순서대로 불리고, 지침은 모델 입력에 실린다
      const thread = await connection.request("thread.create", { workspace, profileId: PROFILE });
      await runTurn(connection, collector, thread.threadId, "hello");
      await waitLog(log, 3);
      expect(readLog(log)).toEqual(["ROOT", "HOOK", "TAP"]);
      expect(model.requestBodies().some((body) => body.includes(GUIDE))).toBe(true);
      const onThread = await registrationsOf(connection, thread.threadId);
      expect(onThread.map((plugin) => plugin.thread)).toEqual([
        "enabled",
        "enabled",
        "enabled",
        "enabled",
        "enabled",
      ]);

      // 4. 프로필 밖의 대화는 구성원을 하나도 켜지 않는다: 호출 로그가 비고, 상태는 꺼짐이다
      rmSync(log, { force: true });
      const outside = await connection.request("thread.create", {
        workspace,
        profileId: OFF_PROFILE,
      });
      await runTurn(connection, collector, outside.threadId, "hello");
      expect(readLog(log)).toEqual([]);
      const offThread = await registrationsOf(connection, outside.threadId);
      expect(offThread.map((plugin) => plugin.thread)).toEqual([
        "disabled",
        "disabled",
        "disabled",
        "disabled",
        "disabled",
      ]);

      // 5. Drive 구성원: 스타트 Drive로 넣으면 그 구성원의 단계가 턴 입력을 낸다
      const stored = await connection.request("profile.get", { id: PROFILE });
      await connection.request("profile.put", {
        profile: profileBody(PROFILE, [BASE, NAME], NAME),
        baseRev: stored.profile.rev,
      });
      const driven = await connection.request("thread.create", { workspace, profileId: PROFILE });
      // 주도 중인 구성원이 받은 입력은 턴이 아니라 주도 입력이다(`delivered`)
      const handed = await startInputWhenIdle(connection, {
        threadId: driven.threadId,
        input: "go",
      });
      expect("turnId" in handed).toBe(false);
      expect(
        await until(() => model.requestBodies().some((body) => body.includes(DRIVE_TEXT)), 15_000),
      ).toBe(true);
    } finally {
      await connection.close();
      await host.close();
      process.chdir(previousCwd);
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    }
  },
  180_000,
);

realTest(
  "editMembers adds a member and moves another; a new draft of the same name goes back to review, the profile keeps running the approved version until approval, and the reordered hooks run in plugins order after it",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-members-order-")));
    const log = join(workspace, "calls.log");
    const source = join(workspace, "source", NAME);
    writeKit(source, log);
    const model = recordingModels("members-order", MODEL_ANSWERS, { contextWindow: 200_000 });
    const previousCwd = process.cwd();
    process.chdir(workspace);
    const host = await startHost(model);
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });
      await connection.request("profile.put", {
        profile: profileBody(PROFILE, [BASE]),
        baseRev: null,
      });

      // 1. 처음 승인한 판은 plugins[] 순서로 호출된다: 뿌리, hook, tap
      const firstItem = await submit(connection, source);
      await approveInto(connection, firstItem);
      await runTurnOn(connection, collector, workspace, PROFILE, "first");
      await waitLog(log, 3);
      expect(readLog(log)).toEqual(["ROOT", "HOOK", "TAP"]);

      // 2. editMembers로 구성원 gamma를 더하고 tap을 맨 앞으로 옮긴다(구성원끼리의 순서)
      const edited = await editMembers({
        dir: source,
        ops: [
          { kind: "add", id: "gamma", mode: "hook" },
          { kind: "move", id: "tap", toIndex: 0 },
        ],
      });
      if (!edited.ok) throw new Error(`editMembers failed: ${edited.error.kind}`);
      expect(edited.value.members.map((member) => member.id)).toEqual([
        "tap",
        "hook",
        "drive",
        "inject",
        "gamma",
      ]);
      writeFileSync(join(source, "src", "members", "gamma.ts"), hookSource(log, "GAMMA"));

      // 3. 고친 폴더로 새 초안을 만들면 검토 항목이 하나 새로 생기고(update), 승인 전에는 프로필에서 옛 검토본이 그대로 돈다
      const secondItem = await submit(connection, source);
      const pending = await connection.request("pluginReview.list", { state: "pending" });
      const updates = pending.items.filter((entry) => entry.name === NAME);
      expect(updates.map((entry) => [entry.itemId === secondItem, entry.kind])).toEqual([
        [true, "update"],
      ]);
      const beforeApprove = await registrationsOf(connection, undefined);
      expect(beforeApprove.map((plugin) => plugin.registrationId)).not.toContain(`${NAME}/gamma`);
      rmSync(log, { force: true });
      await runTurnOn(connection, collector, workspace, PROFILE, "before approve");
      await waitLog(log, 3);
      expect(readLog(log)).toEqual(["ROOT", "HOOK", "TAP"]);

      // 4. 열린 대화가 있어도 승인하면 새 판이 켜진다: gamma가 나타나고 호출 순서는 바뀐 plugins[] 순서다
      await approveInto(connection, secondItem);
      const afterApprove = await registrationsOf(connection, undefined);
      expect(afterApprove.map((plugin) => plugin.registrationId)).toContain(`${NAME}/gamma`);
      rmSync(log, { force: true });
      await runTurnOn(connection, collector, workspace, PROFILE, "after approve");
      await waitLog(log, 4);
      expect(readLog(log)).toEqual(["ROOT", "TAP", "HOOK", "GAMMA"]);
    } finally {
      await connection.close();
      await host.close();
      process.chdir(previousCwd);
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    }
  },
  240_000,
);

const TOOL = "members_tap_tick";

/**
 * 구성원 `boom`의 setup이 `flag` 파일이 있을 때만 던지는 변형 플러그인. 검토 때는 flag가 없어 통과하고, 켜기 때 flag가 있어 던진다.
 * 구성원 `tap`은 도구 하나를 등록하고, `hook`과 뿌리는 훅 하나씩 `log`에 적는다
 */
function writeRollbackKit(root: string, log: string, flag: string, eager = false): void {
  const onAtInstall = eager ? ", defaultEnabled: true" : "";
  mkdirSync(join(root, ".fresnel-plugin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, ".fresnel-plugin", "plugin.json"),
    JSON.stringify(
      {
        schemaVersion: 2,
        name: NAME,
        version: "1.0.0",
        purpose: "Members rollback kit: the last member's setup fails when enabled.",
        defaultEnabled: false,
        entry: "./src/index.ts",
        orchestration: {},
        plugins: [
          { layer: "L3", hooks: ["boundary.settle.after"] },
          {
            id: "hook",
            layer: "L3",
            hooks: ["boundary.settle.after"],
            ...(eager ? { defaultEnabled: true } : {}),
          },
          { id: "tap", layer: "L3", hooks: ["boundary.settle.after"] },
          { id: "boom", layer: "L3", hooks: [], ...(eager ? { defaultEnabled: true } : {}) },
        ],
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(root, "src", "index.ts"),
    [
      'import { appendFileSync, existsSync } from "node:fs";',
      'import { Type } from "typebox";',
      'import { defineOrchestration, defineOrchestrationMember, orchestrationManifest } from "@fresnel/orchestration-sdk";',
      `const LOG = ${JSON.stringify(log)};`,
      `const FLAG = ${JSON.stringify(flag)};`,
      "const manifest = orchestrationManifest({",
      "  schemaVersion: 2,",
      `  name: ${JSON.stringify(NAME)},`,
      '  version: "1.0.0",',
      '  purpose: "Members rollback kit: the last member\'s setup fails when enabled.",',
      "  defaultEnabled: false,",
      '  entry: "./src/index.ts",',
      "  orchestration: {},",
      "  plugins: [",
      '    { layer: "L3", hooks: ["boundary.settle.after"] },',
      `    { id: "hook", layer: "L3", hooks: ["boundary.settle.after"]${onAtInstall} },`,
      '    { id: "tap", layer: "L3", hooks: ["boundary.settle.after"] },',
      `    { id: "boom", layer: "L3", hooks: []${onAtInstall} },`,
      "  ],",
      "});",
      "const group = defineOrchestration({",
      "  manifest,",
      "  setup(g) {",
      '    g.on("boundary.settle.after", () => { appendFileSync(LOG, "ROOT\\n"); });',
      "  },",
      "  members: {",
      "    hook: defineOrchestrationMember({",
      "      setup(g) {",
      '        g.on("boundary.settle.after", () => { appendFileSync(LOG, "HOOK\\n"); });',
      "      },",
      "    }),",
      "    tap: defineOrchestrationMember({",
      "      setup(g) {",
      "        g.registerTool({",
      `          name: ${JSON.stringify(TOOL)},`,
      '          description: "Tap tool",',
      "          parameters: Type.Object({}),",
      '          replay: "safe",',
      '          execute: () => Promise.resolve("tap"),',
      "        });",
      '        g.on("boundary.settle.after", () => { appendFileSync(LOG, "TAP\\n"); });',
      "      },",
      "    }),",
      "    boom: defineOrchestrationMember({",
      "      setup() {",
      '        if (existsSync(FLAG)) throw new Error("boom: the member setup fails on purpose");',
      "      },",
      "    }),",
      "  },",
      "});",
      "export const extension = (ctx) => group.entry(ctx);",
      "",
    ].join("\n"),
  );
}

realTest(
  "when the last member's setup fails as the plugin is enabled, none of the members' registrations, hooks or tools is left on, and the profile keeps its previous state",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-members-roll-")));
    const log = join(workspace, "calls.log");
    const flag = join(workspace, "boom.flag");
    const source = join(workspace, "source", NAME);
    writeRollbackKit(source, log, flag);
    const model = recordingModels("members-roll", MODEL_ANSWERS, { contextWindow: 200_000 });
    const previousCwd = process.cwd();
    process.chdir(workspace);
    const host = await startHost(model);
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });
      await connection.request("profile.put", {
        profile: profileBody(PROFILE, [BASE]),
        baseRev: null,
      });
      await approveInto(connection, await submit(connection, source));
      const approved = await connection.request("profile.get", { id: PROFILE });
      expect(approved.profile.plugins).toEqual([{ name: BASE }, { name: NAME }]);

      // 켜기 때 구성원 boom의 setup이 던진다: 뿌리와 다른 구성원은 하나도 켜지지 않고, 도구도 광고되지 않는다
      writeFileSync(flag, "");
      const failedThread = await runTurnOn(connection, collector, workspace, PROFILE, "hello");
      await settle();
      expect(readLog(log)).toEqual([]);
      expect(model.requestBodies().some((body) => body.includes(TOOL))).toBe(false);
      const global = await registrationsOf(connection, undefined);
      expect(global.map((plugin) => [plugin.registrationId, plugin.status])).toEqual([
        [NAME, "disabled"],
        [`${NAME}/hook`, "disabled"],
        [`${NAME}/tap`, "disabled"],
        [`${NAME}/boom`, "disabled"],
      ]);
      const onThread = await registrationsOf(connection, failedThread);
      expect(onThread.map((plugin) => plugin.thread)).toEqual([
        "disabled",
        "disabled",
        "disabled",
        "disabled",
      ]);
      // 프로필은 승인 때의 판 그대로다
      const kept = await connection.request("profile.get", { id: PROFILE });
      expect([kept.profile.rev, kept.profile.plugins]).toEqual([
        approved.profile.rev,
        [{ name: BASE }, { name: NAME }],
      ]);

      // 원인을 치우면 새 대화가 플러그인을 켠다
      rmSync(flag, { force: true });
      await runTurnOn(connection, collector, workspace, PROFILE, "again");
      await waitLog(log, 3);
      expect(readLog(log)).toEqual(["ROOT", "HOOK", "TAP"]);
      expect(model.requestBodies().some((body) => body.includes(TOOL))).toBe(true);
    } finally {
      await connection.close();
      await host.close();
      process.chdir(previousCwd);
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    }
  },
  180_000,
);

realTest(
  "when a member's setup fails at install (the members that default on run their setup when the plugin loads), the plugin does not load: no registration, hook or tool of it stays on, the diagnostic says setup_threw, and the profile keeps its approved content",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-members-inst-")));
    const log = join(workspace, "calls.log");
    const flag = join(workspace, "boom.flag");
    const source = join(workspace, "source", NAME);
    writeRollbackKit(source, log, flag, true);
    writeFileSync(flag, "");
    const model = recordingModels("members-inst", MODEL_ANSWERS, { contextWindow: 200_000 });
    const previousCwd = process.cwd();
    process.chdir(workspace);
    const host = await startHost(model);
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });
      await connection.request("profile.put", {
        profile: profileBody(PROFILE, [BASE]),
        baseRev: null,
      });
      await approveInto(connection, await submit(connection, source));
      const approved = await connection.request("profile.get", { id: PROFILE });

      // 대화를 열면 로더가 플러그인을 싣는다. 구성원 boom의 setup이 설치 때 던진다
      const thread = await connection.request("thread.create", { workspace, profileId: PROFILE });
      await runTurn(connection, collector, thread.threadId, "hello");
      await settle();
      expect(readLog(log)).toEqual([]);
      expect(model.requestBodies().some((body) => body.includes(TOOL))).toBe(false);
      const listed = await connection.request("ext.list", {});
      const kit = listed.extensions.find((item) => item.name === NAME);
      expect(kit?.diagnostics.map((item) => item.code)).toContain("setup_threw");
      expect(kit?.status).toBe("disabled");
      expect(kit?.plugins.map((plugin) => plugin.status)).toEqual([
        "disabled",
        "disabled",
        "disabled",
        "disabled",
      ]);
      const kept = await connection.request("profile.get", { id: PROFILE });
      expect([kept.profile.rev, kept.profile.plugins]).toEqual([
        approved.profile.rev,
        [{ name: BASE }, { name: NAME }],
      ]);
    } finally {
      await connection.close();
      await host.close();
      process.chdir(previousCwd);
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    }
  },
  180_000,
);
