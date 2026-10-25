import { afterEach, describe, expect, test } from "bun:test";
import { err, ok, type LogFields, type Logger, type Result } from "@xeon/contracts";
import {
  KnowledgeLedgerKey,
  KnowledgeSearchKey,
  KnowledgeSkillsKey,
  type CapabilityApi,
  type KnowledgeLedger,
  type KnowledgeSearch,
  type KnowledgeSkills,
} from "@xeon/contracts/capabilities";
import {
  defineManifest,
  validateManifest,
  type ExtensionEntry,
  type PortKey,
  type ToolRegisterError,
} from "@xeon/contracts/extensions";
import type { SessionService, StoreService } from "@xeon/contracts/records";
import type { ScopeStack } from "@xeon/contracts/settings";
import type { ToolRegistration, Unregister } from "@xeon/contracts/services";
import type { ExtensionUnit } from "@xeon/ext-host";
import { createTestHost } from "@xeon/ext-host/testing";
import { openTestStore, type TestStore } from "@xeon/platform-store/testing";
import { KNOWLEDGE_EXTENSION_NAME, knowledgeManifest } from "../src/manifest.ts";
import { IMPLEMENTED_SKILL_TOOLS, knowledgePlugin } from "../src/plugin.ts";
import { fixedIdFactory, fixedLocalIds, manualClock } from "./support/clock.ts";
import { rejection } from "./support/helpers.ts";
import { createMemoryFs, type MemoryFs } from "./support/memory-fs.ts";
import { createSessionKit } from "./support/sessions.ts";
import { PROJECT_SKILLS, putSkill, USER_SKILLS, userLayer } from "./support/world.ts";

interface FakeTools {
  register(registration: ToolRegistration): Result<Unregister, ToolRegisterError>;
}
interface FakeOs {
  readonly dirs: { readonly data: string };
  readonly time: { readonly clock: { now(): number } };
  logger(component: string): Logger;
}

const OsKey: PortKey<FakeOs> = { name: "xeon.os" };
const StoreKey: PortKey<StoreService> = { name: "xeon.store" };
const ExecKey: PortKey<{ readonly cwd: string }> = { name: "xeon.exec" };
const ToolsKey: PortKey<FakeTools> = { name: "xeon.tools" };
const SessionKey: PortKey<SessionService> = { name: "xeon.session" };

interface LogLine {
  readonly event: string;
  readonly fields: LogFields | undefined;
}

function recordingLogger(lines: LogLine[]): Logger {
  const logger: Logger = {
    debug: (event, fields) => void lines.push({ event, fields }),
    info: (event, fields) => void lines.push({ event, fields }),
    warn: (event, fields) => void lines.push({ event, fields }),
    error: (event, fields) => void lines.push({ event, fields }),
    child: () => logger,
  };
  return logger;
}

const stores: TestStore[] = [];
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store[Symbol.asyncDispose]()));
});

async function boot(
  options: {
    tools?: boolean;
    refuse?: boolean;
    prepare?: (fs: MemoryFs) => void;
    projectTrust?: (projectDir: string) => Promise<boolean>;
    layers?: ScopeStack;
    /** true면 실제 세션 서비스를 `xeon.session`으로 제공한다 */
    sessions?: boolean;
    /** true면 시험 호스트가 기본으로 주는 부분 구현(RecordCommitPort 대역)을 `xeon.session`으로 둔다 */
    partialSession?: boolean;
  } = {},
) {
  const clock = manualClock();
  const ids = fixedIdFactory(clock);
  const store = await openTestStore({ clock, ids });
  stores.push(store);
  const fs = createMemoryFs();
  options.prepare?.(fs);
  const kit =
    options.sessions === true
      ? createSessionKit({ store, clock, ids, logger: recordingLogger([]) })
      : undefined;
  // `xeon.session`은 SessionService 전체여야 한다. 시험 호스트의 부분 구현(records)은 `partialSession`일 때만 남긴다
  const t = await createTestHost(options.partialSession === true ? {} : { without: ["records"] });
  const registered: ToolRegistration[] = [];
  const unregistered: string[] = [];
  const lines: LogLine[] = [];
  await t.host.registerPlatform({
    name: "fake-l0",
    setup(ctx) {
      ctx.providePort(OsKey, {
        dirs: { data: "/data" },
        time: { clock },
        logger: () => recordingLogger(lines),
      });
      ctx.providePort(StoreKey, store.service);
      ctx.providePort(ExecKey, { cwd: "/proj" });
      if (kit !== undefined) ctx.providePort(SessionKey, kit.session);
      if (options.tools !== false) {
        ctx.providePort(ToolsKey, {
          register: (registration) => {
            registered.push(registration);
            if (options.refuse === true)
              return err({ kind: "name_conflict", toolName: "skill_view" });
            return ok(() => {
              unregistered.push(
                registration.kind === "capability" ? registration.def.id : "direct",
              );
            });
          },
        });
      }
    },
  });
  const installed = await t.host.install(
    knowledgePlugin({
      settings: { layers: () => options.layers ?? [] },
      ids: fixedLocalIds(),
      fs,
      ...(options.projectTrust === undefined ? {} : { projectTrust: options.projectTrust }),
    }),
  );
  return { t, fs, store, installed, registered, unregistered, lines, kit };
}

function consumer() {
  const apis: {
    skills?: CapabilityApi<typeof KnowledgeSkills>;
    ledger?: CapabilityApi<typeof KnowledgeLedger>;
    search?: CapabilityApi<typeof KnowledgeSearch>;
  } = {};
  const entry: ExtensionEntry = ({ manifest, scope }) => {
    scope(manifest.name, {}, (g) => {
      apis.skills = g.capability(KnowledgeSkillsKey);
      apis.ledger = g.capability(KnowledgeLedgerKey);
      apis.search = g.capability(KnowledgeSearchKey);
    });
  };
  const unit: ExtensionUnit = {
    manifest: defineManifest({
      schemaVersion: 1,
      name: "kn-consumer",
      version: "0.1.0",
      layer: "L3",
      kind: "plugin",
      entry: "./src/index.ts",
      requires: [
        { id: "knowledge.skills", range: "^1.0.0" },
        { id: "knowledge.ledger", range: "^1.0.0" },
        { id: "knowledge.search", range: "^1.0.0" },
      ],
      points: [],
      usesDrive: false,
    }),
    entry,
    loadIndex: 1,
    builtin: false,
  };
  return { apis, unit };
}

describe("manifest", () => {
  test("the manifest passes validateManifest and is a builtin L2 plugin", () => {
    const checked = validateManifest(knowledgeManifest());
    expect(checked.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(checked.manifest?.name).toBe(KNOWLEDGE_EXTENSION_NAME);
    expect(checked.manifest?.layer).toBe("L2");
    expect(checked.manifest?.provides).toEqual([
      { id: "knowledge.skills", version: "1.0.0" },
      { id: "knowledge.memory", version: "1.0.0" },
      { id: "knowledge.search", version: "1.0.0" },
      { id: "knowledge.ledger", version: "1.0.0" },
    ]);
    const unit = knowledgePlugin({ settings: { layers: () => [] }, ids: fixedLocalIds() });
    expect(unit.builtin).toBe(true);
    expect(unit.manifest.points).toEqual([
      "session_start",
      "before_agent_start",
      "session_shutdown",
    ]);
  });
});

describe("plugin", () => {
  test("installing migrates, reindexes at startup and provides the capabilities", async () => {
    const { t, installed, store } = await boot({
      prepare: (fs) => putSkill(fs, USER_SKILLS, "deploy", { description: "Deploy steps" }),
    });
    expect(installed.setups[0]?.status).toBe("applied");
    expect(installed.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    const tables = Object.keys(await store.rowCounts());
    expect(tables).toContain("cap_knowledge_ledger");
    expect(tables).toContain("cap_knowledge_skills");

    const { apis, unit } = consumer();
    const result = await t.host.install(unit);
    expect(result.setups[0]?.status).toBe("applied");
    await t.settled();
    const listed = await apis.skills?.list({});
    expect(listed?.skills.map((skill) => skill.name)).toEqual(["deploy"]);
    const viewed = await apis.skills?.view({ name: "deploy" });
    expect(viewed?.description).toBe("Deploy steps");
    // 시작 시 재색인이 처음 본 스킬을 바깥 편집으로 원장에 남겼다
    const entries = await apis.ledger?.list({});
    expect(entries?.entries.map((entry) => entry.op)).toEqual(["external"]);
  });

  test("with a session service the plugin registers the projector, indexes messages and serves search", async () => {
    const { t, kit, store, lines } = await boot({
      sessions: true,
      prepare: (fs) => putSkill(fs, USER_SKILLS, "deploy", { description: "Deploy steps." }),
    });
    if (kit === undefined) throw new Error("no sessions");
    const threadId = kit.newThread({ title: "Plugin thread" });
    kit.say(threadId, "user", "plugin wiring works end to end");
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    // 소비자가 커밋을 받아 색인할 시간을 준다
    await Bun.sleep(50);
    const tables = Object.keys(await store.rowCounts());
    expect(tables).toContain("cap_knowledge_sessionfts");
    expect(tables).toContain("cap_knowledge_docsfts");
    expect(lines.map((line) => line.event)).not.toContain("knowledge.search_unavailable");
    const found = await apis.search?.query({ query: "wiring works", kinds: ["session"] });
    expect(found?.hits.map((hit) => hit.sessionId)).toEqual([threadId]);
    // 시작 때 스킬·메모리 검색 색인도 다시 만들어졌다
    const skill = await apis.search?.query({ query: "Deploy steps", kinds: ["skill"] });
    expect(skill?.hits.map((hit) => hit.ref)).toEqual(["deploy"]);
    const list = await apis.search?.list({});
    expect(list?.sessions.map((session) => session.title)).toEqual(["Plugin thread"]);
  });

  test("without a session service search still starts and reports session search as unavailable", async () => {
    const { t, lines } = await boot({
      prepare: (fs) => putSkill(fs, USER_SKILLS, "deploy", { description: "Deploy steps." }),
    });
    expect(lines.map((line) => line.event)).toContain("knowledge.search_unavailable");
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    const only = await apis.search?.query({ query: "anything", kinds: ["session"] }).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(only).toMatchObject({ data: { code: "unavailable" } });
    const skill = await apis.search?.query({ query: "Deploy steps", kinds: ["skill"] });
    expect(skill?.hits.map((hit) => hit.ref)).toEqual(["deploy"]);
  });

  test("a partial xeon.session is not accepted: the plugin setup fails instead of starting without search", async () => {
    const { installed } = await boot({ partialSession: true });
    expect(installed.setups[0]?.status).toBe("failed");
    const failure = installed.setups[0]?.failure;
    const error = failure?.kind === "threw" ? failure.error : undefined;
    // 실패 원인이 부분 구현의 빠진 멤버(projectors)여야 한다: 다른 이유로 실패해도 통과하는 시험이 아니다
    expect(error).toBeInstanceOf(TypeError);
    expect(error instanceof Error && error.message).toContain("session.projectors");
  });

  test("a consumer extension whose call carries no caller context cannot write", async () => {
    const { t } = await boot({
      prepare: (fs) => putSkill(fs, USER_SKILLS, "deploy"),
    });
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    const entries = await apis.ledger?.list({});
    // 시험용 호스트의 capability 래퍼는 호출 문맥을 채우지 않는다. 행위자를 알 수 없는 쓰기는 거부한다
    const rollback = await rejection(
      apis.ledger?.rollback({ ledgerId: entries?.entries[0]?.ledgerId ?? "" }) ?? Promise.resolve(),
    );
    expect(rollback.data.code).toBe("denied");
    const write = await rejection(
      apis.skills?.create({ name: "x", description: "d", body: "b" }) ?? Promise.resolve(),
    );
    expect(write.data.code).toBe("denied");
    expect((await apis.skills?.list({}))?.skills.map((skill) => skill.name)).toEqual(["deploy"]);
  });

  test("the skill, memory and search tools reach L1.tools with their risk", async () => {
    const { registered } = await boot();
    expect(registered).toHaveLength(3);
    const [skills, memory, search] = registered;
    expect(skills?.kind === "capability" ? skills.def.id : undefined).toBe("knowledge.skills");
    expect(skills?.kind === "capability" ? skills.def.tools.map((tool) => tool.name) : []).toEqual([
      ...IMPLEMENTED_SKILL_TOOLS,
    ]);
    expect(skills?.kind === "capability" ? skills.key : undefined).toEqual(KnowledgeSkillsKey);
    expect(skills?.kind === "capability" ? skills.policy : undefined).toEqual({
      skill_view: { risk: "read" },
      skill_manage: { risk: "write", classes: ["shared_state_write"] },
    });
    expect(memory?.kind === "capability" ? memory.def.id : undefined).toBe("knowledge.memory");
    expect(memory?.kind === "capability" ? memory.def.tools.map((tool) => tool.name) : []).toEqual([
      "memory_manage",
    ]);
    expect(memory?.kind === "capability" ? memory.policy : undefined).toEqual({
      memory_manage: { risk: "write", classes: ["shared_state_write"] },
    });
    expect(search?.kind === "capability" ? search.def.id : undefined).toBe("knowledge.search");
    expect(search?.kind === "capability" ? search.def.tools.map((tool) => tool.name) : []).toEqual([
      "knowledge_search",
      "session_scroll",
      "session_read",
    ]);
    expect(search?.kind === "capability" ? search.policy : undefined).toEqual({
      knowledge_search: { risk: "read" },
      session_scroll: { risk: "read" },
      session_read: { risk: "read" },
    });
  });

  test("a memory switched off at startup is not advertised", async () => {
    const { registered } = await boot({
      layers: [userLayer({ "l2.knowledge.memory.enabled": false })],
    });
    expect(registered.map((item) => (item.kind === "capability" ? item.def.id : "direct"))).toEqual(
      ["knowledge.skills", "knowledge.search"],
    );
  });

  test("uninstalling removes the tool registrations", async () => {
    const { t, unregistered } = await boot();
    await t.host.uninstall(KNOWLEDGE_EXTENSION_NAME);
    expect(unregistered).toEqual(["knowledge.skills", "knowledge.memory", "knowledge.search"]);
  });

  test("a refused tool registration fails the setup by value", async () => {
    const { installed } = await boot({ refuse: true });
    expect(installed.setups[0]).toMatchObject({
      status: "failed",
      failure: { kind: "threw", code: "scope_setup_failed" },
    });
  });

  test("without the tools service nothing is advertised but the capabilities still work", async () => {
    const { t, registered, lines } = await boot({
      tools: false,
      prepare: (fs) => putSkill(fs, USER_SKILLS, "deploy"),
    });
    expect(registered).toEqual([]);
    expect(lines.map((line) => line.event)).toContain("knowledge.tools_missing");
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    expect((await apis.skills?.list({}))?.skills).toHaveLength(1);
  });

  test("an unreadable skill root is a warning, not a startup failure", async () => {
    const { installed, lines } = await boot({
      prepare: (fs) => {
        putSkill(fs, USER_SKILLS, "deploy");
        fs.failNext("list", USER_SKILLS, "io", 100);
      },
    });
    expect(installed.setups[0]?.status).toBe("applied");
    // 읽을 수 없는 스킬 루트는 경고 진단이다. 저장소 쓰기 실패와 달리 시작 오류가 아니다
    expect(lines.map((line) => line.event)).not.toContain("knowledge.startup_failed");
  });
});

async function agentStart(
  t: Awaited<ReturnType<typeof boot>>["t"],
  thread: ReturnType<Awaited<ReturnType<typeof boot>>["t"]["newThread"]>,
  key: string,
) {
  const out = await t.host.dispatch(
    "before_agent_start",
    { prompt: "hi", systemPrompt: "BASE", systemPromptOptions: {} },
    { threadId: thread, dispatchKey: key, initial: { messages: [], systemPrompt: "BASE" } },
  );
  return out.value.messages;
}

describe("turn hooks", () => {
  test("the first turn carries the index block, a later change one delta memo, and shutdown forgets", async () => {
    const { t, fs } = await boot({ prepare: (memory) => putSkill(memory, USER_SKILLS, "deploy") });
    const thread = t.newThread();
    await t.host.openThread(thread);
    await t.host.dispatch(
      "session_start",
      { reason: "new", threadId: thread },
      { threadId: thread, dispatchKey: "start" },
    );

    const first = await agentStart(t, thread, "turn-1");
    expect(first).toHaveLength(1);
    expect(first[0]?.customType).toBe("knowledge.context");
    expect(first[0]?.content).toContain("<name>deploy</name>");
    expect(await agentStart(t, thread, "turn-2")).toEqual([]);

    // 엔진 밖에서 스킬이 늘면 세션 시작이나 재색인 뒤 다음 turn에 델타 하나가 간다
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    putSkill(fs, USER_SKILLS, "rollback", { description: "Roll back." });
    await apis.skills?.reindex({});
    const third = await agentStart(t, thread, "turn-3");
    expect(third.map((message) => message.customType)).toEqual(["knowledge.index-delta"]);
    expect(third[0]?.content).toBe("스킬 인덱스 변경: 추가 rollback(Roll back.)");

    await t.host.dispatch(
      "session_shutdown",
      { reason: "quit" },
      { threadId: thread, dispatchKey: "stop" },
    );
    const again = await agentStart(t, thread, "turn-4");
    expect(again[0]?.customType).toBe("knowledge.context");
  });
});

function withProjectSkill(fs: MemoryFs): void {
  putSkill(fs, USER_SKILLS, "deploy");
  putSkill(fs, PROJECT_SKILLS, "repo-skill", { description: "From the repository" });
}

async function skillNames(options: Parameters<typeof boot>[0]) {
  const { t } = await boot(options);
  const { apis, unit } = consumer();
  await t.host.install(unit);
  await t.settled();
  const listed = await apis.skills?.list({});
  const names: string[] = listed?.skills.map((skill) => skill.name).toSorted() ?? [];
  const diagnostics: { severity: string; message: string; path: string }[] =
    listed?.diagnostics ?? [];
  return { names, diagnostics };
}

describe("project skills and project trust", () => {
  test("without a trust decision the repository's skills are not loaded and a diagnostic says so", async () => {
    const { names, diagnostics } = await skillNames({ prepare: withProjectSkill });
    expect(names).toEqual(["deploy"]);
    expect(diagnostics.map((item) => [item.severity, item.path])).toEqual([
      ["warning", PROJECT_SKILLS],
    ]);
  });

  test("a refusing or failing trust check keeps the repository's skills out", async () => {
    expect(
      (await skillNames({ prepare: withProjectSkill, projectTrust: () => Promise.resolve(false) }))
        .names,
    ).toEqual(["deploy"]);
    const failing = await skillNames({
      prepare: withProjectSkill,
      projectTrust: () => Promise.reject(new Error("store unreadable")),
    });
    expect(failing.names).toEqual(["deploy"]);
  });

  test("a trusted project contributes its skills", async () => {
    const asked: string[] = [];
    const { names, diagnostics } = await skillNames({
      prepare: withProjectSkill,
      projectTrust: (dir) => {
        asked.push(dir);
        return Promise.resolve(true);
      },
    });
    expect(names).toEqual(["deploy", "repo-skill"]);
    expect(diagnostics).toEqual([]);
    expect(asked[0]).toBe("/proj");
  });

  test("no diagnostic when an untrusted project has no skills directory", async () => {
    const { diagnostics } = await skillNames({
      prepare: (fs) => putSkill(fs, USER_SKILLS, "deploy"),
    });
    expect(diagnostics).toEqual([]);
  });
});
