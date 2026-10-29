import { describe, expect, test } from "bun:test";
import {
  WorkspaceFilesKey,
  WorkspaceImagesKey,
  WorkspaceShellKey,
  type CapabilityApi,
  type WorkspaceFiles,
  type WorkspaceImages,
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
import type { ThreadId } from "@xeon/contracts/conversation";
import type { ToolRegistration, Unregister } from "@xeon/contracts/services";
import type { ScopeLayer } from "@xeon/contracts/settings";
import type { ExtensionUnit } from "@xeon/ext-host";
import { createTestHost, fixedIdFactory } from "@xeon/ext-host/testing";
import { workspacePlugin } from "../src/plugin.ts";
import { WORKSPACE_EXTENSION_NAME, workspaceManifest } from "../src/manifest.ts";
import { rejection } from "./support/assertions.ts";
import { fakeSandbox } from "./support/fakes.ts";
import { memoryBlobs, pngBytes, toBase64, type MemoryBlobs } from "./support/images.ts";
import { memoryEnv, type MemoryEnv } from "./support/memory-env.ts";

interface FakeTools {
  register(registration: ToolRegistration): Result<Unregister, ToolRegisterError>;
}
interface FakeOs {
  readonly dirs: { readonly tmp: string };
  readonly time: { readonly clock: { now(): number } };
  logger(component: string): Logger;
  resolveBinary(
    name: string,
    options: unknown,
    signal: AbortSignal,
  ): Promise<Result<{ readonly path: string }, { readonly kind: string }>>;
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

interface FakeSession {
  query: {
    thread(threadId: ThreadId): Result<{ readonly workspace: string | null } | undefined, never>;
  };
}
const SessionKey: PortKey<FakeSession> = { name: "xeon.session" };
const StoreKey: PortKey<MemoryBlobs> = { name: "xeon.store" };

async function boot(
  options: {
    sandbox?: boolean;
    tools?: boolean;
    refuse?: string;
    workspaces?: Readonly<Record<string, string>>;
    store?: boolean;
    /** 번들 rg를 찾지 못하는 대역 */
    rgMissing?: boolean;
    /** 설정 층. 기본은 비어 있다 */
    layers?: readonly ScopeLayer[];
  } = {},
) {
  // 시험 호스트가 기본으로 내는 xeon.session(ext 멤버만)이 이 시험의 session 포트와 겹치지 않게 뺀다
  const t = await createTestHost({ without: ["records"] });
  const env = memoryEnv({ cwd: "/work" });
  env.mkdir("/work");
  const registered: ToolRegistration[] = [];
  const unregistered: string[] = [];
  const lines: LogLine[] = [];
  const resolved: string[] = [];
  await t.host.registerPlatform({
    name: "fake-l0",
    setup(ctx) {
      ctx.providePort(ExecKey, env);
      ctx.providePort(OsKey, {
        dirs: { tmp: "/tmp/xeon" },
        time: { clock: { now: () => 0 } },
        logger: () => recordingLogger(lines),
        resolveBinary: (name) => {
          resolved.push(name);
          if (options.rgMissing === true) {
            return Promise.resolve(err({ kind: "not_found" }));
          }
          return Promise.resolve(ok({ path: `/bundle/${name}` }));
        },
      });
      if (options.sandbox !== false) ctx.providePort(SandboxKey, fakeSandbox());
      const { workspaces } = options;
      if (workspaces !== undefined) {
        ctx.providePort(SessionKey, {
          query: {
            thread: (id) => ok({ workspace: workspaces[id] ?? null }),
          },
        });
      }
      if (options.store === true) ctx.providePort(StoreKey, memoryBlobs());
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
  const installed = await t.host.install(
    workspacePlugin({ settings: { layers: () => options.layers ?? [] } }),
  );
  return { t, env, installed, registered, unregistered, lines, resolved };
}

/** workspace 능력을 requires로 쓰는 소비자 확장. 사용 예(L3 그룹 경로: 서비스를 직접 부른다) */
function consumer() {
  const apis: {
    files?: CapabilityApi<typeof WorkspaceFiles>;
    shell?: CapabilityApi<typeof WorkspaceShell>;
    images?: CapabilityApi<typeof WorkspaceImages>;
  } = {};
  const entry: ExtensionEntry = ({ manifest, scope }) => {
    scope(manifest.name, {}, (g) => {
      apis.files = g.capability(WorkspaceFilesKey);
      apis.shell = g.capability(WorkspaceShellKey);
      apis.images = g.capability(WorkspaceImagesKey);
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
        { id: "workspace.images", range: "^1.0.0" },
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
      { id: "workspace.images", version: "1.0.0" },
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
    // grep은 구현되었다. 번들 rg가 있으면 검색 결과를 돌려준다
    env.reply({ exitCode: 1 });
    expect(await apis.files?.grep({ pattern: "x" })).toEqual({ root: "/work", matches: [] });
  });

  test("without ripgrep grep is unavailable with rg_missing", async () => {
    const { t, env } = await boot({ rgMissing: true });
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    env.put("/work/a.txt", "foo\n");
    const error = await rejection(apis.files?.grep({ pattern: "foo" }) ?? Promise.resolve());
    expect(error.data.code).toBe("unavailable");
    expect(error.data.detail).toEqual({ reason: "rg_missing" });
    expect(env.calls).toHaveLength(0);
  });

  test("grep finds the bundled rg through xeon.os, and grep.rgPath replaces it", async () => {
    const bundled = await boot();
    const { apis, unit } = consumer();
    await bundled.t.host.install(unit);
    await bundled.t.settled();
    bundled.env.reply({ exitCode: 1 });
    await apis.files?.find({ pattern: "*" });
    expect(bundled.resolved).toEqual(["rg"]);
    expect(bundled.env.calls[0]?.command).toEqual([
      "/bundle/rg",
      "--files",
      "--no-config",
      "--no-require-git",
      "--sort",
      "path",
      "--glob",
      "*",
      "--no-messages",
      "--",
      ".",
    ]);

    const configured = await boot({
      layers: [{ scope: "user", values: new Map([["l2.workspace.grep.rgPath", "/opt/rg/rg"]]) }],
    });
    const second = consumer();
    await configured.t.host.install(second.unit);
    await configured.t.settled();
    configured.env.reply({ exitCode: 1 });
    await second.apis.files?.find({ pattern: "*" });
    expect(configured.resolved).toEqual([]);
    expect(configured.env.calls[0]?.command[0]).toBe("/opt/rg/rg");
  });

  test("all six files tools reach L1.tools, with their risk", async () => {
    const { registered } = await boot();
    expect(registered).toHaveLength(2);
    const [files, shell] = registered;
    expect(files?.kind === "capability" ? files.def.id : undefined).toBe("workspace.files");
    expect(files?.kind === "capability" ? files.def.tools.map((tool) => tool.name) : []).toEqual([
      "read",
      "write",
      "edit",
      "ls",
      "grep",
      "find",
    ]);
    expect(files?.kind === "capability" ? files.key : undefined).toEqual(WorkspaceFilesKey);
    expect(files?.kind === "capability" ? files.policy : undefined).toEqual({
      read: { risk: "read" },
      write: { risk: "write" },
      edit: { risk: "write" },
      ls: { risk: "read" },
      grep: { risk: "read" },
      find: { risk: "read" },
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

describe("session and store ports", () => {
  test("thread workspaces and image blobs come from xeon.session and xeon.store", async () => {
    const ids = fixedIdFactory();
    const alpha = ids.next("thr");
    const other = ids.next("thr");
    const { t, env } = await boot({ workspaces: { [alpha]: "/projects/alpha" }, store: true });
    env.mkdir("/projects/alpha");
    env.put("/projects/alpha/a.txt", "alpha\n");
    env.put("/projects/alpha/pic.png", pngBytes(4, 3, 64));
    env.put("/work/a.txt", "engine\n");
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    const inAlpha = { context: { threadId: alpha, caller: { kind: "host" } } } as const;
    const inOther = { context: { threadId: other, caller: { kind: "host" } } } as const;
    expect(await apis.files?.read({ path: "a.txt" }, inAlpha)).toMatchObject({ text: "alpha\n" });
    expect(await apis.files?.read({ path: "a.txt" }, inOther)).toMatchObject({ text: "engine\n" });
    const image = await apis.images?.load({ path: "pic.png" }, inAlpha);
    expect(image).toMatchObject({ mimeType: "image/png" });
    const register = await apis.images?.register({
      data: toBase64(pngBytes(4, 3, 64)),
      mimeType: "image/png",
    });
    expect(register?.blob.sha256).toBe(image?.blob.sha256);
  });

  test("without the store or the session the gaps are logged and images are unavailable", async () => {
    const { t, lines } = await boot();
    const { apis, unit } = consumer();
    await t.host.install(unit);
    await t.settled();
    const events = lines.map((line) => line.event);
    expect(events).toContain("workspace.store_missing");
    expect(events).toContain("workspace.session_missing");
    const error = await rejection(
      apis.images?.register({ data: toBase64(pngBytes()), mimeType: "image/png" }) ??
        Promise.resolve(),
    );
    expect(error.data.code).toBe("unavailable");
  });
});
