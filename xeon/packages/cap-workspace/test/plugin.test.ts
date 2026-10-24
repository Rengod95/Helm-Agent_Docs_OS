import { describe, expect, test } from "bun:test";
import {
  WorkspaceFilesKey,
  WorkspaceShellKey,
  type CapabilityApi,
  type WorkspaceFiles,
  type WorkspaceShell,
} from "@xeon/contracts/capabilities";
import { err, ok, type Logger, type LogFields, type Result } from "@xeon/contracts";
import {
  defineManifest,
  validateManifest,
  type ExtensionEntry,
  type PortKey,
  type ToolRegisterError,
} from "@xeon/contracts/extensions";
import type { ToolRegistration, Unregister } from "@xeon/contracts/services";
import type { ExtensionUnit } from "@xeon/ext-host";
import { createTestHost } from "@xeon/ext-host/testing";
import { IMPLEMENTED_FILES_TOOLS, workspacePlugin } from "../src/plugin.ts";
import { WORKSPACE_EXTENSION_NAME, workspaceManifest } from "../src/manifest.ts";
import { rejection } from "./support/assertions.ts";
import { fakeSandbox } from "./support/fakes.ts";
import { memoryEnv, type MemoryEnv } from "./support/memory-env.ts";

interface FakeTools {
  register(registration: ToolRegistration): Result<Unregister, ToolRegisterError>;
}
interface FakeOs {
  readonly dirs: { readonly tmp: string };
  readonly time: { readonly clock: { now(): number } };
  logger(component: string): Logger;
}

const ExecKey: PortKey<MemoryEnv> = { name: "xeon.exec" };
const OsKey: PortKey<FakeOs> = { name: "xeon.os" };
const SandboxKey: PortKey<ReturnType<typeof fakeSandbox>> = { name: "xeon.sandbox" };
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

async function boot(options: { sandbox?: boolean; tools?: boolean; refuse?: string } = {}) {
  const t = await createTestHost();
  const env = memoryEnv({ cwd: "/work" });
  env.mkdir("/work");
  const registered: ToolRegistration[] = [];
  const unregistered: string[] = [];
  const lines: LogLine[] = [];
  await t.host.registerPlatform({
    name: "fake-l0",
    setup(ctx) {
      ctx.providePort(ExecKey, env);
      ctx.providePort(OsKey, {
        dirs: { tmp: "/tmp/xeon" },
        time: { clock: { now: () => 0 } },
        logger: () => recordingLogger(lines),
      });
      if (options.sandbox !== false) ctx.providePort(SandboxKey, fakeSandbox());
      if (options.tools !== false) {
        ctx.providePort(ToolsKey, {
          register: (registration) => {
            registered.push(registration);
            const label = registration.kind === "capability" ? registration.def.id : "direct";
            if (label === options.refuse) return err({ kind: "name_conflict", toolName: label });
            return ok(() => {
              unregistered.push(label);
            });
          },
        });
      }
    },
  });
  const installed = await t.host.install(workspacePlugin({ settings: { layers: () => [] } }));
  return { t, env, installed, registered, unregistered, lines };
}

/** workspace 능력을 requires로 쓰는 소비자 확장. 사용 예(L3 그룹 경로: 서비스를 직접 부른다) */
function consumer() {
  const apis: {
    files?: CapabilityApi<typeof WorkspaceFiles>;
    shell?: CapabilityApi<typeof WorkspaceShell>;
  } = {};
  const entry: ExtensionEntry = ({ manifest, scope }) => {
    scope(manifest.name, {}, (g) => {
      apis.files = g.capability(WorkspaceFilesKey);
      apis.shell = g.capability(WorkspaceShellKey);
    });
  };
  const unit: ExtensionUnit = {
    manifest: defineManifest({
      schemaVersion: 1,
      name: "ws-consumer",
      version: "0.1.0",
      layer: "L3",
      kind: "plugin",
      entry: "./src/index.ts",
      requires: [
        { id: "workspace.files", range: "^1.0.0" },
        { id: "workspace.shell", range: "^1.0.0" },
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
    const checked = validateManifest(workspaceManifest());
    expect(checked.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(checked.manifest?.name).toBe(WORKSPACE_EXTENSION_NAME);
    expect(checked.manifest?.layer).toBe("L2");
    expect(checked.manifest?.kind).toBe("plugin");
    expect(checked.manifest?.provides).toEqual([
      { id: "workspace.files", version: "1.0.0" },
      { id: "workspace.shell", version: "1.0.0" },
    ]);
    const unit = workspacePlugin({ settings: { layers: () => [] } });
    expect(unit.builtin).toBe(true);
    expect(unit.manifest.points).toEqual([]);
    expect(unit.manifest.usesDrive).toBe(false);
  });
});

describe("plugin", () => {
  test("installing provides the capabilities and a consumer reads them", async () => {
    const { t, env, installed } = await boot();
    expect(installed.setups[0]?.status).toBe("applied");
    expect(installed.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    const { apis, unit } = consumer();
    const result = await t.host.install(unit);
    expect(result.setups[0]?.status).toBe("applied");
    await t.settled();

    env.put("/work/hello.txt", "hello\nworld\n");
    const read = await apis.files?.read({ path: "hello.txt" });
    expect(read).toMatchObject({ kind: "text", text: "hello\nworld\n", totalLines: 2 });
    env.reply({ chunks: [{ text: "ok\n" }], exitCode: 0 });
    const run = await apis.shell?.run({ command: "echo ok" });
    expect(run).toMatchObject({ exitCode: 0, output: "ok\n", sandboxed: true });
    // 구현하지 않은 메서드는 unsupported로 거부한다
    const write = await rejection(
      apis.files?.write({ path: "x", content: "y" }) ?? Promise.resolve(),
    );
    expect(write.data.code).toBe("unsupported");
  });

  test("only implemented tools reach L1.tools, with their risk", async () => {
    const { registered } = await boot();
    expect(registered).toHaveLength(2);
    const [files, shell] = registered;
    expect(files?.kind === "capability" ? files.def.id : undefined).toBe("workspace.files");
    expect(files?.kind === "capability" ? files.def.tools.map((tool) => tool.name) : []).toEqual([
      ...IMPLEMENTED_FILES_TOOLS,
    ]);
    expect(files?.kind === "capability" ? files.key : undefined).toEqual(WorkspaceFilesKey);
    expect(files?.kind === "capability" ? files.policy : undefined).toEqual({
      read: { risk: "read" },
      ls: { risk: "read" },
    });
    expect(shell?.kind === "capability" ? shell.def.tools.map((tool) => tool.name) : []).toEqual([
      "bash",
    ]);
    expect(shell?.kind === "capability" ? shell.key : undefined).toEqual(WorkspaceShellKey);
    expect(shell?.kind === "capability" ? shell.policy : undefined).toEqual({
      bash: { risk: "exec" },
    });
  });

  test("uninstalling removes the tool registrations", async () => {
    const { t, unregistered } = await boot();
    await t.host.uninstall(WORKSPACE_EXTENSION_NAME);
    expect(unregistered.toSorted()).toEqual(["workspace.files", "workspace.shell"]);
  });

  test("a refused tool registration fails the setup by value and takes back the first one", async () => {
    const { installed, unregistered } = await boot({ refuse: "workspace.shell" });
    expect(installed.setups[0]).toMatchObject({
      status: "failed",
      failure: { kind: "threw", code: "scope_setup_failed" },
    });
    expect(unregistered).toEqual(["workspace.files"]);
  });

  test("without the sandbox service bash is rejected and a warning is logged", async () => {
    const { t, lines } = await boot({ sandbox: false });
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    const error = await rejection(apis.shell?.run({ command: "echo hi" }) ?? Promise.resolve());
    expect(error.data.code).toBe("unavailable");
    expect(lines.map((line) => line.event)).toContain("workspace.sandbox_missing");
  });

  test("without the tools service nothing is advertised but the capabilities still work", async () => {
    const { t, env, registered, lines } = await boot({ tools: false });
    expect(registered).toEqual([]);
    expect(lines.map((line) => line.event)).toContain("workspace.tools_missing");
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    env.put("/work/a.txt", "a\n");
    expect(await apis.files?.read({ path: "a.txt" })).toMatchObject({ kind: "text", text: "a\n" });
  });
});
