import { afterEach, describe, expect, test } from "bun:test";
import { err, ok, type LogFields, type Logger, type Result } from "@xeon/contracts";
import {
  KnowledgeLedgerKey,
  KnowledgeSkillsKey,
  type CapabilityApi,
  type KnowledgeLedger,
  type KnowledgeSkills,
} from "@xeon/contracts/capabilities";
import {
  defineManifest,
  validateManifest,
  type ExtensionEntry,
  type PortKey,
  type ToolRegisterError,
} from "@xeon/contracts/extensions";
import type { StoreService } from "@xeon/contracts/records";
import type { ToolRegistration, Unregister } from "@xeon/contracts/services";
import type { ExtensionUnit } from "@xeon/ext-host";
import { createTestHost } from "@xeon/ext-host/testing";
import { openTestStore, type TestStore } from "@xeon/platform-store/testing";
import { KNOWLEDGE_EXTENSION_NAME, knowledgeManifest } from "../src/manifest.ts";
import { IMPLEMENTED_SKILL_TOOLS, knowledgePlugin } from "../src/plugin.ts";
import { fixedIdFactory, fixedLocalIds, manualClock } from "./support/clock.ts";
import { rejection } from "./support/helpers.ts";
import { createMemoryFs, type MemoryFs } from "./support/memory-fs.ts";
import { PROJECT_SKILLS, putSkill, USER_SKILLS } from "./support/world.ts";

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
  } = {},
) {
  const clock = manualClock();
  const store = await openTestStore({ clock, ids: fixedIdFactory(clock) });
  stores.push(store);
  const fs = createMemoryFs();
  options.prepare?.(fs);
  const t = await createTestHost();
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
      settings: { layers: () => [] },
      ids: fixedLocalIds(),
      fs,
      ...(options.projectTrust === undefined ? {} : { projectTrust: options.projectTrust }),
    }),
  );
  return { t, fs, store, installed, registered, unregistered, lines };
}

function consumer() {
  const apis: {
    skills?: CapabilityApi<typeof KnowledgeSkills>;
    ledger?: CapabilityApi<typeof KnowledgeLedger>;
  } = {};
  const entry: ExtensionEntry = ({ manifest, scope }) => {
    scope(manifest.name, {}, (g) => {
      apis.skills = g.capability(KnowledgeSkillsKey);
      apis.ledger = g.capability(KnowledgeLedgerKey);
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
      { id: "knowledge.ledger", version: "1.0.0" },
    ]);
    const unit = knowledgePlugin({ settings: { layers: () => [] }, ids: fixedLocalIds() });
    expect(unit.builtin).toBe(true);
    expect(unit.manifest.points).toEqual([]);
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

  test("a consumer extension cannot roll back until the approval gate exists", async () => {
    const { t } = await boot({
      prepare: (fs) => putSkill(fs, USER_SKILLS, "deploy"),
    });
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    const entries = await apis.ledger?.list({});
    const error = await rejection(
      apis.ledger?.rollback({ ledgerId: entries?.entries[0]?.ledgerId ?? "" }) ?? Promise.resolve(),
    );
    expect(error.data.code).toBe("denied");
    // 쓰기 메서드는 아직 열려 있지 않다
    const write = await rejection(
      apis.skills?.create({ name: "x", description: "d", body: "b" }) ?? Promise.resolve(),
    );
    expect(write.data.code).toBe("unsupported");
  });

  test("only the read tool reaches L1.tools, with its risk", async () => {
    const { registered } = await boot();
    expect(registered).toHaveLength(1);
    const [skills] = registered;
    expect(skills?.kind === "capability" ? skills.def.id : undefined).toBe("knowledge.skills");
    expect(skills?.kind === "capability" ? skills.def.tools.map((tool) => tool.name) : []).toEqual([
      ...IMPLEMENTED_SKILL_TOOLS,
    ]);
    expect(skills?.kind === "capability" ? skills.key : undefined).toEqual(KnowledgeSkillsKey);
    expect(skills?.kind === "capability" ? skills.policy : undefined).toEqual({
      skill_view: { risk: "read" },
    });
  });

  test("uninstalling removes the tool registrations", async () => {
    const { t, unregistered } = await boot();
    await t.host.uninstall(KNOWLEDGE_EXTENSION_NAME);
    expect(unregistered).toEqual(["knowledge.skills"]);
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
