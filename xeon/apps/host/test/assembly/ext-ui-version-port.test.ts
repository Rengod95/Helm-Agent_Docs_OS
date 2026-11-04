import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import { err, ok, parse } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import {
  createVersionHistory,
  type ExtensionLoader,
  type LoadedExtensionInfo,
  type ReloadApplied,
  type RegistrationInfo,
  type UiEntryReport,
  type VersionHistory,
  type VersionHistoryFs,
  type VersionSource,
} from "@fresnel/ext-host";
import type { BundledPluginVersion } from "../../src/assembly/default-plugins.ts";
import { createExtUiVersionPort } from "../../src/assembly/m4/ext-ui-version-port.ts";
import type { ExtUiVersionSource } from "../../src/assembly/m4/ext-ui-version-source.ts";
import type { ExtUiVersionPort } from "../../src/handlers/m4/ext-ui-version.ts";

// T-XV 포트(HS-108). 로더와 등록은 가짜, 버전 기록은 메모리 파일 시스템 위의 실제 보관 모듈이다. 되돌리기 순서는 끄기, 기록, 교체,
// 상태 비우기, 켜기다(X.loading-trust §4.4.8). 시험 본문에 단언이 없고 값을 그대로 비교한다.

const EXT_DIR = "/cfg/extensions";
const BUNDLE_DIR = "/bundle";
const BASE_MS = Date.UTC(2026, 10, 1);
const THREAD = parseThread("thr_01ARZ3NDEKTSV4RRFFQ69G5FAV");
const OTHER_THREAD = parseThread("thr_01ARZ3NDEKTSV4RRFFQ69G5FAW");

function parseThread(raw: string): ThreadId {
  const parsed = parse(ThreadIdSchema, raw);
  if (!parsed.ok) throw new Error(`not a thread id: ${raw}`);
  return parsed.value;
}

type Node = { readonly kind: "dir" } | { readonly kind: "file"; readonly text: string };

interface Faults {
  /** 참이면 메타 파일 읽기가 EACCES로 실패한다 */
  metaReadFails: boolean;
}

/** 메모리 위의 버전 기록 파일 접근. 디렉터리는 키로 표시하고, 옮기기와 복사는 아래 항목을 통째로 옮긴다 */
function memoryFs(faults: Faults): {
  readonly fs: VersionHistoryFs;
  readonly nodes: Map<string, Node>;
} {
  const nodes = new Map<string, Node>();
  const makeDirs = (path: string): void => {
    let current = "";
    for (const part of path.split("/").filter((item) => item !== "")) {
      current = `${current}/${part}`;
      if (!nodes.has(current)) nodes.set(current, { kind: "dir" });
    }
  };
  const within = (path: string): string[] =>
    [...nodes.keys()].filter((key) => key === path || key.startsWith(`${path}/`));
  const moveTree = (from: string, to: string): void => {
    for (const key of within(from)) {
      const node = nodes.get(key);
      nodes.delete(key);
      if (node !== undefined) nodes.set(`${to}${key.slice(from.length)}`, node);
    }
  };
  const fs: VersionHistoryFs = {
    readText: (path) => {
      if (faults.metaReadFails && path.endsWith("meta.json")) {
        return Promise.reject(Object.assign(new Error("permission denied"), { code: "EACCES" }));
      }
      const node = nodes.get(path);
      return Promise.resolve(node?.kind === "file" ? node.text : null);
    },
    writeText: (path, text) => {
      makeDirs(dirname(path));
      nodes.set(path, { kind: "file", text });
      return Promise.resolve();
    },
    exists: (path) => Promise.resolve(nodes.has(path)),
    listDir: (path) => {
      if (nodes.get(path)?.kind !== "dir") return Promise.resolve(null);
      const children = [...nodes]
        .filter(([key]) => dirname(key) === path)
        .map(([key, node]): { readonly name: string; readonly kind: "dir" | "file" } => ({
          name: basename(key),
          kind: node.kind,
        }));
      return Promise.resolve(children);
    },
    copyDir: (from, to) => {
      if (nodes.get(from)?.kind !== "dir") return Promise.reject(new Error(`no folder ${from}`));
      if (nodes.has(to)) return Promise.reject(new Error(`${to} exists`));
      makeDirs(dirname(to));
      for (const key of within(from)) {
        const node = nodes.get(key);
        if (node !== undefined) nodes.set(`${to}${key.slice(from.length)}`, node);
      }
      return Promise.resolve();
    },
    removeDir: (path) => {
      for (const key of within(path)) nodes.delete(key);
      return Promise.resolve();
    },
    renameDir: (from, to) => {
      if (!nodes.has(from)) return Promise.reject(new Error(`no ${from}`));
      if (nodes.has(to)) return Promise.reject(new Error(`${to} exists`));
      makeDirs(dirname(to));
      moveTree(from, to);
      return Promise.resolve();
    },
  };
  return { fs, nodes };
}

function manifestOf(name: string, version: string): string {
  return JSON.stringify({ name, version });
}

/** 매니페스트 해시. 호스트가 버전 기록에 쓰는 것과 같은 sha256 16진수다 */
function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** 확장 설치본 하나: 매니페스트와 엔트리 파일 */
async function writeInstall(
  fs: VersionHistoryFs,
  dir: string,
  name: string,
  version: string,
): Promise<void> {
  await fs.writeText(join(dir, ".fresnel-plugin", "plugin.json"), manifestOf(name, version));
  await fs.writeText(join(dir, "dist", "index.js"), `export const version = "${version}";\n`);
}

function loaded(
  name: string,
  state: LoadedExtensionInfo["state"],
  source: LoadedExtensionInfo["source"],
  version: LoadedExtensionInfo["version"],
): LoadedExtensionInfo {
  return {
    name,
    version,
    source,
    trust: "user",
    state,
    isolation: "none",
    essential: false,
    loadIndex: 0,
    generation: 1,
    diagnostics: [],
  };
}

/** 바로 적용되어 끝난 다시 읽기 */
function reloadedNow(
  name: string,
  statesCleared: number,
): ReturnType<ExtensionLoader["reload"]> extends Promise<infer R> ? R : never {
  const applied: ReloadApplied = {
    status: "applied",
    statesCleared,
    info: loaded(name, "active", "user", "0.1.0"),
  };
  return ok({ appliesAt: "now", applied: Promise.resolve(applied) });
}

function scope(
  id: string,
  extension: string,
  status: RegistrationInfo["status"],
): RegistrationInfo {
  return { id, extension, status, generation: 1, waiting: [], drive: "none" };
}

type HostView = ExtUiVersionSource["host"];

interface RigOptions {
  readonly infos?: readonly LoadedExtensionInfo[];
  readonly entries?: readonly UiEntryReport[];
  readonly scopes?: readonly RegistrationInfo[];
  readonly threads?: readonly ThreadId[];
  /** 지금 설치본의 상태 스키마 버전. 생략하면 모른다(null) */
  readonly schema?: number;
  /** 상태 재설정의 응답. 생략하면 거부된 상태가 없다 */
  readonly reset?: HostView["resetRegistrationState"];
  /** 참이면 끄기 요청이 던진다 */
  readonly disableFails?: boolean;
  /** 앱에 든 기본 플러그인(helm)의 번들 판. 생략하면 번들이 없다 */
  readonly bundled?: BundledPluginVersion;
  /** 로더의 다시 읽기. 생략하면 바로 적용되고 비운 상태가 없다 */
  readonly reload?: (
    name: string,
    resetRefusedState: boolean,
  ) => ReturnType<ExtensionLoader["reload"]>;
}

interface Rig {
  readonly port: ExtUiVersionPort;
  readonly history: VersionHistory;
  readonly nodes: Map<string, Node>;
  readonly fs: VersionHistoryFs;
  readonly faults: Faults;
  /** 호스트에 건 호출의 기록(순서대로) */
  readonly calls: string[];
}

function rigOf(options: RigOptions): Rig {
  const faults: Faults = { metaReadFails: false };
  const { fs, nodes } = memoryFs(faults);
  let tick = 0;
  const history = createVersionHistory({
    fs,
    historyRoot: join(EXT_DIR, ".history"),
    now: () => {
      tick += 1;
      return BASE_MS + tick * 1000;
    },
    hash: hashOf,
  });
  const calls: string[] = [];
  const scopes = options.scopes ?? [];
  const host: HostView = {
    registrations: () => scopes,
    registration: (id) => ({
      id,
      status: "enabled",
      enable: () => {
        calls.push(`enable ${id}`);
      },
      disable: () => {
        calls.push(`disable ${id}`);
        if (options.disableFails === true) throw new Error("the registration refused to stop");
      },
    }),
    ui: {
      post: (input) => {
        calls.push(`post ${input.threadId} ${input.extension}/${input.ui}/${input.name}`);
        return Promise.resolve(ok({ duplicate: false }));
      },
      requestApproval: (input) => {
        calls.push(`approve ${input.threadId} ${input.extension}/${input.ui}/${input.method}`);
        return Promise.resolve(ok({ approvalId: "evt_approval" }));
      },
    },
    resetRegistrationState: (threadId, scopeId) => {
      calls.push(`reset ${threadId} ${scopeId}`);
      return (options.reset ?? (() => Promise.resolve(err({ kind: "not_refused" }))))(
        threadId,
        scopeId,
      );
    },
  };
  const loader: Pick<ExtensionLoader, "list" | "uiEntries" | "reload"> = {
    list: () => options.infos ?? [],
    uiEntries: () => options.entries ?? [],
    reload: (name, _signal, reloadOptions) => {
      const clear = reloadOptions?.resetRefusedState === true;
      calls.push(`reload ${name} clearState=${String(clear)}`);
      return (options.reload ?? ((target) => Promise.resolve(reloadedNow(target, 0))))(name, clear);
    },
  };
  const source: ExtUiVersionSource = {
    host,
    loader: () => loader,
    history,
    extensionsDir: EXT_DIR,
    heldThreads: () => options.threads ?? [],
    stateSchemaVersion: () => options.schema ?? null,
    installGate: { safeMode: () => false, managedLocked: () => false },
    bundle: (name) => Promise.resolve(name === "helm" ? (options.bundled ?? null) : null),
    hash: hashOf,
  };
  return { port: createExtUiVersionPort({ extUi: source }), history, nodes, fs, faults, calls };
}

/** 보관 항목 하나를 기록한다. 내용은 `bundle/<이름>`에서 복사한다 */
async function record(
  rig: Rig,
  name: string,
  version: string,
  source: VersionSource,
  stateSchemaVersion: number | null,
): Promise<void> {
  const bundle = join(BUNDLE_DIR, `${name}-${version}`);
  await writeInstall(rig.fs, bundle, name, version);
  const recorded = await rig.history.record({
    name,
    version,
    source,
    extensionDir: bundle,
    manifestText: manifestOf(name, version),
    stateSchemaVersion,
  });
  expect(recorded.ok).toBe(true);
}

function entryOfUi(
  extension: string,
  id: string,
  state: UiEntryReport["state"],
  issues: UiEntryReport["issues"],
  title: string,
  placement: UiEntryReport["placement"] = "panel",
): UiEntryReport {
  return {
    extension,
    id,
    placement,
    mode: "native",
    title,
    state,
    issues,
    version: "0.2.0",
    trust: "user",
  };
}

describe("ext-ui-version port: versions", () => {
  test("lists the recorded versions newest first and marks the installed one as current", async () => {
    const rig = rigOf({ infos: [loaded("helm", "active", "user", "0.2.0")] });
    await record(rig, "helm", "0.1.0", "bundled", null);
    await record(rig, "helm", "0.2.0", "user", null);
    expect(await rig.port.versions("helm")).toEqual(
      ok({
        versions: [
          {
            version: "0.2.0",
            installedAt: new Date(BASE_MS + 2000).toISOString(),
            source: "user",
            manifestHash: hashOf(manifestOf("helm", "0.2.0")),
            stateSchemaVersion: null,
            current: true,
          },
          {
            version: "0.1.0",
            installedAt: new Date(BASE_MS + 1000).toISOString(),
            source: "bundled",
            manifestHash: hashOf(manifestOf("helm", "0.1.0")),
            stateSchemaVersion: null,
            current: false,
          },
        ],
      }),
    );
  });

  test("an extension from the bundled or project location has no history and an empty list", async () => {
    const rig = rigOf({ infos: [loaded("core-tools", "active", "builtin", "1.0.0")] });
    expect(await rig.port.versions("core-tools")).toEqual(ok({ versions: [] }));
  });

  test("a name that no extension has is unknown_extension", async () => {
    const rig = rigOf({});
    expect(await rig.port.versions("ghost")).toEqual(
      err({ kind: "unknown_extension", name: "ghost" }),
    );
  });

  test("a metadata read that fails is reported as io with the OS code", async () => {
    const rig = rigOf({ infos: [loaded("helm", "active", "user", "0.2.0")] });
    await record(rig, "helm", "0.1.0", "bundled", null);
    rig.faults.metaReadFails = true;
    expect(await rig.port.versions("helm")).toEqual(err({ kind: "io", code: "EACCES" }));
  });
});

describe("ext-ui-version port: rollback", () => {
  test("an extension the loader did not load swaps the files, records the installed version and reports restart", async () => {
    const rig = rigOf({
      infos: [loaded("helm", "error", "user", "0.2.0")],
      scopes: [scope("helm/main", "helm", "enabled")],
    });
    await writeInstall(rig.fs, join(EXT_DIR, "helm"), "helm", "0.2.0");
    await record(rig, "helm", "0.1.0", "bundled", null);

    const rolled = await rig.port.rollback({ name: "helm", version: "0.1.0" });

    expect(rolled).toEqual(ok({ appliesAt: "restart", stateCleared: false }));
    expect(rig.calls).toEqual(["disable helm/main", "enable helm/main"]);
    expect(rig.nodes.get(join(EXT_DIR, "helm", "dist", "index.js"))).toEqual({
      kind: "file",
      text: 'export const version = "0.1.0";\n',
    });
    // 되돌리기 전 설치본이 `user` 출처로 기록되어 다시 앞으로 갈 수 있다
    const listing = await rig.history.list("helm", "0.1.0");
    expect(listing.ok).toBe(true);
    if (listing.ok) {
      expect(listing.value.versions.map((entry) => [entry.version, entry.source])).toEqual([
        ["0.2.0", "user"],
        ["0.1.0", "bundled"],
      ]);
    }
  });

  test("a schema mismatch stops before any file changes, then clearState resets the refused state", async () => {
    const rig = rigOf({
      infos: [loaded("helm", "active", "user", "0.2.0")],
      scopes: [scope("helm/main", "helm", "enabled")],
      threads: [THREAD],
      schema: 2,
      reset: () => Promise.resolve(err({ kind: "not_refused" })),
    });
    await writeInstall(rig.fs, join(EXT_DIR, "helm"), "helm", "0.2.0");
    await record(rig, "helm", "0.1.0", "bundled", 1);

    expect(await rig.port.rollback({ name: "helm", version: "0.1.0" })).toEqual(
      err({ kind: "state_schema_mismatch", targetSchemaVersion: 1, currentSchemaVersion: 2 }),
    );
    expect(rig.calls).toEqual([]);
    expect(rig.nodes.get(join(EXT_DIR, "helm", "dist", "index.js"))).toEqual({
      kind: "file",
      text: 'export const version = "0.2.0";\n',
    });
  });

  test("a not-loaded extension: clearState reports stateCleared when a refused state was reset, between disable and enable", async () => {
    const rig = rigOf({
      infos: [loaded("helm", "error", "user", "0.2.0")],
      scopes: [scope("helm/main", "helm", "enabled")],
      threads: [THREAD],
      schema: 2,
      reset: () => Promise.resolve(ok({ rev: 1 })),
    });
    await writeInstall(rig.fs, join(EXT_DIR, "helm"), "helm", "0.2.0");
    await record(rig, "helm", "0.1.0", "bundled", 1);

    expect(await rig.port.rollback({ name: "helm", version: "0.1.0", clearState: true })).toEqual(
      ok({ appliesAt: "restart", stateCleared: true }),
    );
    expect(rig.calls).toEqual([
      "disable helm/main",
      `reset ${THREAD} helm/main`,
      "enable helm/main",
    ]);
  });

  test("a not-loaded extension: clearState with nothing refused reports stateCleared false", async () => {
    const rig = rigOf({
      infos: [loaded("helm", "error", "user", "0.2.0")],
      scopes: [scope("helm/main", "helm", "enabled")],
      threads: [THREAD, OTHER_THREAD],
    });
    await writeInstall(rig.fs, join(EXT_DIR, "helm"), "helm", "0.2.0");
    await record(rig, "helm", "0.1.0", "bundled", null);

    expect(await rig.port.rollback({ name: "helm", version: "0.1.0", clearState: true })).toEqual(
      ok({ appliesAt: "restart", stateCleared: false }),
    );
    expect(rig.calls).toEqual([
      "disable helm/main",
      `reset ${THREAD} helm/main`,
      `reset ${OTHER_THREAD} helm/main`,
      "enable helm/main",
    ]);
  });

  test("a failed state reset stops the rollback as rollback_failed after the swap, with the extension left off", async () => {
    const rig = rigOf({
      infos: [loaded("helm", "error", "user", "0.2.0")],
      scopes: [scope("helm/main", "helm", "enabled")],
      threads: [THREAD],
      reset: () => Promise.resolve(err({ kind: "port_unavailable" })),
    });
    await writeInstall(rig.fs, join(EXT_DIR, "helm"), "helm", "0.2.0");
    await record(rig, "helm", "0.1.0", "bundled", null);

    expect(await rig.port.rollback({ name: "helm", version: "0.1.0", clearState: true })).toEqual(
      err({ kind: "rollback_failed", reason: "clear_state_failed" }),
    );
    expect(rig.calls).toEqual(["disable helm/main", `reset ${THREAD} helm/main`]);
  });

  test("a disable that throws changes nothing and reports disable_failed", async () => {
    const rig = rigOf({
      infos: [loaded("helm", "error", "user", "0.2.0")],
      scopes: [scope("helm/main", "helm", "enabled")],
      disableFails: true,
    });
    await writeInstall(rig.fs, join(EXT_DIR, "helm"), "helm", "0.2.0");
    await record(rig, "helm", "0.1.0", "bundled", null);

    expect(await rig.port.rollback({ name: "helm", version: "0.1.0" })).toEqual(
      err({ kind: "rollback_failed", reason: "disable_failed" }),
    );
    expect(rig.nodes.get(join(EXT_DIR, "helm", "dist", "index.js"))).toEqual({
      kind: "file",
      text: 'export const version = "0.2.0";\n',
    });
  });

  test("a version that is not recorded is unknown_version", async () => {
    const rig = rigOf({ infos: [loaded("helm", "active", "user", "0.2.0")] });
    await writeInstall(rig.fs, join(EXT_DIR, "helm"), "helm", "0.2.0");
    expect(await rig.port.rollback({ name: "helm", version: "0.9.0" })).toEqual(
      err({ kind: "unknown_version", version: "0.9.0" }),
    );
  });

  test("an extension that no one installed is unknown_extension, and a builtin one has no history", async () => {
    const rig = rigOf({ infos: [loaded("core-tools", "active", "builtin", "1.0.0")] });
    expect(await rig.port.rollback({ name: "ghost", version: "0.1.0" })).toEqual(
      err({ kind: "unknown_extension", name: "ghost" }),
    );
    expect(await rig.port.rollback({ name: "core-tools", version: "0.1.0" })).toEqual(
      err({ kind: "history_unavailable", reason: "builtin extension has no version history" }),
    );
  });
});

async function hotRig(options: Partial<RigOptions> = {}): Promise<Rig> {
  const rig = rigOf({
    infos: [loaded("helm", "active", "user", "0.2.0")],
    scopes: [scope("helm/main", "helm", "enabled")],
    threads: [THREAD],
    ...options,
  });
  await writeInstall(rig.fs, join(EXT_DIR, "helm"), "helm", "0.2.0");
  await record(rig, "helm", "0.1.0", "bundled", null);
  return rig;
}

const installedText = (rig: Rig): unknown =>
  rig.nodes.get(join(EXT_DIR, "helm", "dist", "index.js"));

describe("ext-ui-version port: hot rollback", () => {
  test("a loaded extension is reloaded instead of disabled and re-enabled", async () => {
    const rig = await hotRig();
    expect(await rig.port.rollback({ name: "helm", version: "0.1.0" })).toEqual(
      ok({ appliesAt: "nextStepBoundary", stateCleared: false }),
    );
    expect(rig.calls).toEqual(["reload helm clearState=false"]);
    expect(installedText(rig)).toEqual({ kind: "file", text: 'export const version = "0.1.0";\n' });
  });

  test("clearState goes to the reload and its cleared count decides stateCleared", async () => {
    const rig = await hotRig({
      schema: 2,
      reload: (name) => Promise.resolve(reloadedNow(name, 1)),
    });
    await record(rig, "helm", "0.0.5", "bundled", 1);
    expect(await rig.port.rollback({ name: "helm", version: "0.0.5", clearState: true })).toEqual(
      ok({ appliesAt: "nextStepBoundary", stateCleared: true }),
    );
    expect(rig.calls).toEqual(["reload helm clearState=true"]);
  });

  test("a reload that is waiting for a step boundary does not hold the call and reports the state as not cleared yet", async () => {
    const waiting = Promise.withResolvers<ReloadApplied>();
    const rig = await hotRig({
      reload: () =>
        Promise.resolve(ok({ appliesAt: "nextStepBoundary", applied: waiting.promise })),
    });
    expect(await rig.port.rollback({ name: "helm", version: "0.1.0", clearState: true })).toEqual(
      ok({ appliesAt: "nextStepBoundary", stateCleared: false }),
    );
    waiting.resolve({ status: "superseded" });
  });

  test("a new version that cannot be loaded puts the installed files back and reports rollback_failed", async () => {
    const rig = await hotRig({
      reload: () =>
        Promise.resolve(
          err({
            kind: "rejected",
            diagnostics: [
              {
                extension: "helm",
                source: "user",
                stage: "entry",
                severity: "error",
                code: "entry_import_failed",
                message: "entry ./src/index.ts failed to import",
                generation: 1,
              },
            ],
          }),
        ),
    });
    expect(await rig.port.rollback({ name: "helm", version: "0.1.0" })).toEqual(
      err({
        kind: "rollback_failed",
        reason: "reload_failed (files restored true): entry ./src/index.ts failed to import",
      }),
    );
    // 도는 코드와 디스크가 모두 0.2.0이고 보관본 0.1.0도 남아 있다
    expect(installedText(rig)).toEqual({ kind: "file", text: 'export const version = "0.2.0";\n' });
    const listing = await rig.history.list("helm", "0.2.0");
    expect(listing.ok ? listing.value.versions.map((entry) => entry.version) : null).toContain(
      "0.1.0",
    );
  });

  test("a reload that applies and then fails at the boundary is reported while the call is open", async () => {
    const rig = await hotRig({
      reload: () =>
        Promise.resolve(
          ok({
            appliesAt: "now",
            applied: Promise.resolve({
              status: "failed",
              restored: true,
              diagnostics: [
                {
                  extension: "helm",
                  source: "user",
                  stage: "activate",
                  severity: "error",
                  code: "reload_failed",
                  message: "reload of helm failed at helm (registration_setup_failed)",
                  generation: 1,
                },
              ],
            }),
          }),
        ),
    });
    expect(await rig.port.rollback({ name: "helm", version: "0.1.0" })).toEqual(
      err({
        kind: "rollback_failed",
        reason:
          "reload_failed (files restored true): reload of helm failed at helm (registration_setup_failed)",
      }),
    );
    expect(installedText(rig)).toEqual({ kind: "file", text: 'export const version = "0.2.0";\n' });
  });
});

describe("ext-ui-version port: ui list", () => {
  test("carries version, install tier and the app root of an app entry", () => {
    const app = { root: "ui/graph", entry: "index.html", bridge: "^1.0.0", reason: "graph editor" };
    const rig = rigOf({
      infos: [loaded("helm", "active", "project", "1.4.0")],
      scopes: [scope("helm/main", "helm", "enabled")],
      entries: [
        {
          ...entryOfUi("helm", "graph", "ok", [], "Graph", "page"),
          mode: "app",
          version: "1.4.0",
          trust: "project",
          app,
          appRoot: "/work/proj/.fresnel/extensions/helm/ui/graph",
        },
      ],
    });
    expect(rig.port.uiList({}).items).toEqual([
      {
        extension: "helm",
        id: "graph",
        placement: "page",
        mode: "app",
        title: "Graph",
        state: "ok",
        version: "1.4.0",
        trust: "project",
        appRoot: "/work/proj/.fresnel/extensions/helm/ui/graph",
        app,
        issues: [],
      },
    ]);
  });

  test("carries the forKind of a card entry and leaves it out of a panel entry", () => {
    const rig = rigOf({
      infos: [loaded("helm", "active", "user", "0.2.0")],
      scopes: [scope("helm/main", "helm", "enabled")],
      entries: [
        {
          ...entryOfUi("helm", "inquiry", "ok", [], "Inquiry", "card"),
          forKind: "grp.helm.inquiry.finished",
        },
        entryOfUi("helm", "panel", "ok", [], "Helm"),
      ],
    });
    expect(rig.port.uiList({}).items).toEqual([
      {
        extension: "helm",
        id: "inquiry",
        placement: "card",
        mode: "native",
        title: "Inquiry",
        state: "ok",
        version: "0.2.0",
        trust: "user",
        forKind: "grp.helm.inquiry.finished",
        issues: [],
      },
      {
        extension: "helm",
        id: "panel",
        placement: "panel",
        mode: "native",
        title: "Helm",
        state: "ok",
        version: "0.2.0",
        trust: "user",
        issues: [],
      },
    ]);
  });

  test("maps the loader's entries to wire items: sorted, disabled by loader state or by registration, issues as diagnostics", async () => {
    const rig = rigOf({
      infos: [
        loaded("helm", "active", "user", "0.2.0"),
        loaded("account-rotation", "disabled", "user", "0.2.0"),
        loaded("tools-kit", "active", "user", "0.2.0"),
        loaded("core-tools", "active", "builtin", "1.0.0"),
      ],
      scopes: [
        scope("helm/main", "helm", "enabled"),
        scope("account-rotation/main", "account-rotation", "enabled"),
        scope("tools-kit/main", "tools-kit", "disabled"),
      ],
      entries: [
        entryOfUi("helm", "panel", "ok", [], "Helm"),
        {
          extension: "helm",
          version: "0.2.0",
          trust: "user",
          id: "broken",
          placement: "card",
          mode: "native",
          title: "Broken",
          state: "invalid",
          issues: [
            {
              severity: "error",
              code: "ui_file_missing",
              path: "/ui/items/1",
              message: "view/broken.json does not exist",
            },
          ],
        },
        {
          extension: "account-rotation",
          version: "0.2.0",
          trust: "user",
          id: "status",
          placement: "status",
          mode: "native",
          title: "Rotation",
          state: "ok",
          issues: [
            {
              severity: "info",
              code: "ui_mode_not_allowed",
              path: "/ui/items/0",
              message: "apps are off",
            },
          ],
        },
        entryOfUi("tools-kit", "home", "ok", [], "Tools", "page"),
      ],
    });

    expect(rig.port.uiList({})).toEqual({
      items: [
        {
          extension: "account-rotation",
          version: "0.2.0",
          trust: "user",
          id: "status",
          placement: "status",
          mode: "native",
          title: "Rotation",
          state: "disabled",
          issues: [{ severity: "warning", code: "ui_mode_not_allowed", message: "apps are off" }],
        },
        {
          extension: "helm",
          version: "0.2.0",
          trust: "user",
          id: "broken",
          placement: "card",
          mode: "native",
          title: "Broken",
          state: "invalid",
          issues: [
            {
              severity: "error",
              code: "ui_file_missing",
              message: "view/broken.json does not exist",
            },
          ],
        },
        {
          extension: "helm",
          version: "0.2.0",
          trust: "user",
          id: "panel",
          placement: "panel",
          mode: "native",
          title: "Helm",
          state: "ok",
          issues: [],
        },
        {
          extension: "tools-kit",
          version: "0.2.0",
          trust: "user",
          id: "home",
          placement: "page",
          mode: "native",
          title: "Tools",
          state: "disabled",
          issues: [],
        },
      ],
    });
  });

  test("the list is capped at 500 after sorting, so the same entries give the same first 500 in any input order", async () => {
    const entries = Array.from({ length: 501 }, (_, index) =>
      entryOfUi("bulk", `i${String(index).padStart(3, "0")}`, "ok", [], "Bulk"),
    );
    const rig = rigOf({
      infos: [loaded("bulk", "active", "user", "0.1.0")],
      entries: entries.toReversed(),
    });
    const items = rig.port.uiList({}).items;
    expect(items).toHaveLength(500);
    expect(items[0]?.id).toBe("i000");
    expect(items[499]?.id).toBe("i499");
  });

  test("without a loader the port lists nothing and names no extension", async () => {
    const port = createExtUiVersionPort({});
    expect(port.uiList({})).toEqual({ items: [] });
    expect(await port.versions("helm")).toEqual(err({ kind: "unknown_extension", name: "helm" }));
    expect(await port.rollback({ name: "helm", version: "0.1.0" })).toEqual(
      err({ kind: "unknown_extension", name: "helm" }),
    );
  });
});

// ext.ui.post와 ext.ui.requestApproval(HS-108). 포트는 params의 대화를 ExtHost.ui에 넘기고, 대화 id가 아니면 열린 대화가 아니라고 한다.

test("uiPost passes the thread to ExtHost.ui and accepts", async () => {
  const rig = rigOf({});
  const result = await rig.port.uiPost({
    extension: "helm",
    ui: "panel",
    threadId: "thr_01HZZZZZZZZZZZZZZZZZZZZZZZ",
    name: "refresh",
  });
  expect(result).toEqual({ ok: true, value: { accepted: true } });
  expect(rig.calls).toEqual(["post thr_01HZZZZZZZZZZZZZZZZZZZZZZZ helm/panel/refresh"]);
});

test("uiRequestApproval returns the approval id and rejects a malformed thread id", async () => {
  const rig = rigOf({});
  expect(
    await rig.port.uiRequestApproval({
      extension: "helm",
      ui: "panel",
      threadId: "thr_01HZZZZZZZZZZZZZZZZZZZZZZZ",
      method: "apply",
    }),
  ).toEqual({ ok: true, value: { approvalId: "evt_approval" } });
  expect(
    await rig.port.uiRequestApproval({
      extension: "helm",
      ui: "panel",
      threadId: "not-a-thread",
      method: "apply",
    }),
  ).toEqual({ ok: false, error: { kind: "unknown_thread", threadId: "not-a-thread" } });
  expect(rig.calls).toEqual(["approve thr_01HZZZZZZZZZZZZZZZZZZZZZZZ helm/panel/apply"]);
});

describe("ext-ui-version port: bundled version", () => {
  const BUNDLED_DIR = join(BUNDLE_DIR, "helm");
  const bundledHelm = (version: string): BundledPluginVersion => ({
    version,
    manifestText: manifestOf("helm", version),
    dir: BUNDLED_DIR,
  });

  test("versions carries the bundled version of a default plugin and no field for other extensions", async () => {
    const rig = rigOf({
      infos: [
        loaded("helm", "active", "user", "0.2.0"),
        loaded("notes", "active", "user", "0.1.0"),
      ],
      bundled: bundledHelm("0.1.0"),
    });
    await record(rig, "helm", "0.2.0", "user", null);
    expect(await rig.port.versions("helm")).toEqual(
      ok({
        versions: [
          {
            version: "0.2.0",
            installedAt: new Date(BASE_MS + 1000).toISOString(),
            source: "user",
            manifestHash: hashOf(manifestOf("helm", "0.2.0")),
            stateSchemaVersion: null,
            current: true,
          },
        ],
        bundledVersion: "0.1.0",
      }),
    );
    expect(await rig.port.versions("notes")).toEqual(ok({ versions: [] }));
  });

  test("rolling back to the bundled version records it as bundled, then swaps the files", async () => {
    const rig = rigOf({
      infos: [loaded("helm", "error", "user", "0.2.0")],
      scopes: [scope("helm/main", "helm", "enabled")],
      bundled: bundledHelm("0.1.0"),
    });
    await writeInstall(rig.fs, join(EXT_DIR, "helm"), "helm", "0.2.0");
    await writeInstall(rig.fs, BUNDLED_DIR, "helm", "0.1.0");

    expect(await rig.port.rollback({ name: "helm", version: "0.1.0" })).toEqual(
      ok({ appliesAt: "restart", stateCleared: false }),
    );
    expect(rig.calls).toEqual(["disable helm/main", "enable helm/main"]);
    expect(rig.nodes.get(join(EXT_DIR, "helm", "dist", "index.js"))).toEqual({
      kind: "file",
      text: 'export const version = "0.1.0";\n',
    });
    const listing = await rig.history.list("helm", "0.1.0");
    expect(listing).toEqual(
      ok({
        versions: [
          {
            version: "0.2.0",
            installedAt: new Date(BASE_MS + 2000).toISOString(),
            source: "user",
            manifestHash: hashOf(manifestOf("helm", "0.2.0")),
            stateSchemaVersion: null,
            current: false,
          },
          {
            version: "0.1.0",
            installedAt: new Date(BASE_MS + 1000).toISOString(),
            source: "bundled",
            manifestHash: hashOf(manifestOf("helm", "0.1.0")),
            stateSchemaVersion: null,
            current: true,
          },
        ],
        skipped: [],
      }),
    );
  });

  test("a bundled version already in the history is not recorded again", async () => {
    const rig = rigOf({
      infos: [loaded("helm", "error", "user", "0.2.0")],
      scopes: [scope("helm/main", "helm", "enabled")],
      bundled: bundledHelm("0.1.0"),
    });
    await writeInstall(rig.fs, join(EXT_DIR, "helm"), "helm", "0.2.0");
    await writeInstall(rig.fs, BUNDLED_DIR, "helm", "0.1.0");
    await record(rig, "helm", "0.1.0", "bundled", null);

    expect(await rig.port.rollback({ name: "helm", version: "0.1.0" })).toEqual(
      ok({ appliesAt: "restart", stateCleared: false }),
    );
    // 0.1.0의 기록 시각은 처음 기록 때(BASE+1000) 그대로다. 다시 기록했다면 BASE+2000이 된다
    const listing = await rig.history.list("helm", "0.1.0");
    expect(
      listing.ok ? listing.value.versions.map((entry) => [entry.version, entry.installedAt]) : null,
    ).toEqual([
      ["0.2.0", new Date(BASE_MS + 2000).toISOString()],
      ["0.1.0", new Date(BASE_MS + 1000).toISOString()],
    ]);
  });

  test("a same-version entry whose manifest hash differs from the bundle is replaced by the bundle", async () => {
    const rig = rigOf({
      infos: [loaded("helm", "error", "user", "0.2.0")],
      scopes: [scope("helm/main", "helm", "enabled")],
      bundled: bundledHelm("0.1.0"),
    });
    await writeInstall(rig.fs, join(EXT_DIR, "helm"), "helm", "0.2.0");
    await writeInstall(rig.fs, BUNDLED_DIR, "helm", "0.1.0");
    // 판 글자는 같지만 매니페스트가 다른 보관 항목이다(번들과 다른 내용을 같은 판으로 적어 둔 것)
    const edited = join(BUNDLE_DIR, "edited-helm-0.1.0");
    await writeInstall(rig.fs, edited, "helm", "0.1.0");
    const recorded = await rig.history.record({
      name: "helm",
      version: "0.1.0",
      source: "user",
      extensionDir: edited,
      manifestText: '{"name":"helm","version":"0.1.0","edited":true}',
      stateSchemaVersion: null,
    });
    expect(recorded.ok).toBe(true);

    expect(await rig.port.rollback({ name: "helm", version: "0.1.0" })).toEqual(
      ok({ appliesAt: "restart", stateCleared: false }),
    );
    expect(await rig.history.list("helm", "0.1.0")).toEqual(
      ok({
        versions: [
          {
            version: "0.2.0",
            installedAt: new Date(BASE_MS + 3000).toISOString(),
            source: "user",
            manifestHash: hashOf(manifestOf("helm", "0.2.0")),
            stateSchemaVersion: null,
            current: false,
          },
          {
            version: "0.1.0",
            installedAt: new Date(BASE_MS + 2000).toISOString(),
            source: "bundled",
            manifestHash: hashOf(manifestOf("helm", "0.1.0")),
            stateSchemaVersion: null,
            current: true,
          },
        ],
        skipped: [],
      }),
    );
  });

  test("rolling back to the bundled version that is already installed is unknown_version and changes nothing", async () => {
    const rig = rigOf({
      infos: [loaded("helm", "error", "user", "0.1.0")],
      scopes: [scope("helm/main", "helm", "enabled")],
      bundled: bundledHelm("0.1.0"),
    });
    await writeInstall(rig.fs, join(EXT_DIR, "helm"), "helm", "0.1.0");
    await writeInstall(rig.fs, BUNDLED_DIR, "helm", "0.1.0");

    expect(await rig.port.rollback({ name: "helm", version: "0.1.0" })).toEqual(
      err({ kind: "unknown_version", version: "0.1.0" }),
    );
    expect(rig.calls).toEqual([]);
    const listing = await rig.history.list("helm", "0.1.0");
    expect(listing.ok ? listing.value.versions : null).toEqual([]);
  });

  test("a builtin extension is still refused even when a bundled version is named", async () => {
    const rig = rigOf({
      infos: [loaded("helm", "active", "builtin", "0.2.0")],
      bundled: bundledHelm("0.1.0"),
    });
    expect(await rig.port.versions("helm")).toEqual(ok({ versions: [] }));
    expect(await rig.port.rollback({ name: "helm", version: "0.1.0" })).toEqual(
      err({ kind: "history_unavailable", reason: "builtin extension has no version history" }),
    );
  });

  test("a bundle that cannot be copied fails the record as io and leaves the install alone", async () => {
    const rig = rigOf({
      infos: [loaded("helm", "error", "user", "0.2.0")],
      scopes: [scope("helm/main", "helm", "enabled")],
      bundled: bundledHelm("0.1.0"),
    });
    await writeInstall(rig.fs, join(EXT_DIR, "helm"), "helm", "0.2.0");

    expect(await rig.port.rollback({ name: "helm", version: "0.1.0" })).toEqual(
      err({ kind: "io", code: "io" }),
    );
    expect(rig.calls).toEqual([]);
    expect(rig.nodes.get(join(EXT_DIR, "helm", "dist", "index.js"))).toEqual({
      kind: "file",
      text: 'export const version = "0.2.0";\n',
    });
  });
});
