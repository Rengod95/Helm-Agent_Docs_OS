import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import { err, ok, parse, type Logger } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import {
  createVersionHistory,
  type ExtensionLoader,
  type LoadDiagnostic,
  type LoadedExtensionInfo,
  type ReloadApplied,
  type RegistrationInfo,
  type UiEntryReport,
  type VersionHistory,
  type VersionHistoryFs,
} from "@fresnel/ext-host";
import type { BundledPluginVersion } from "../../src/assembly/default-plugins.ts";
import {
  createExtMethodPort,
  createExtUiVersionPort,
} from "../../src/assembly/m4/ext-ui-version-port.ts";
import type {
  ExtUiVersionSource,
  ReviewedVersions,
} from "../../src/assembly/m4/ext-ui-version-source.ts";
import type {
  PluginStore,
  PluginVersionInfo,
  ReviewLogEntry,
} from "../../src/assembly/plugins/store.ts";
import type { ExtUiVersionPort } from "../../src/handlers/m4/ext-ui-version.ts";
import { partial } from "../fixtures/unsafe.ts";

// T-XV 포트(HS-108). 로더와 등록은 가짜, 버전 기록은 메모리 파일 시스템 위의 실제 보관 모듈이다. 되돌리기 순서는 끄기, 기록, 교체,
// 상태 비우기, 켜기다(X.loading-trust §4.4.8). 시험 본문에 단언이 없고 값을 그대로 비교한다.

const EXT_DIR = "/cfg/extensions";
const BASE_MS = Date.UTC(2026, 10, 1);

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

/** 매니페스트 해시. 호스트가 버전 기록에 쓰는 것과 같은 sha256 16진수다 */
function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** 확장 설치본 하나: 매니페스트와 엔트리 파일 */
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
  explicitOff: boolean = false,
): RegistrationInfo {
  return {
    id,
    extension,
    status,
    generation: 1,
    waiting: [],
    drive: "none",
    ...(explicitOff ? { explicitOff } : {}),
  };
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
  const loader: Pick<
    ExtensionLoader,
    | "list"
    | "uiEntries"
    | "reload"
    | "reloadFromReviewed"
    | "loadInstalled"
    | "unload"
    | "ensureLoaded"
  > = {
    ensureLoaded: (name) => {
      calls.push(`ensureLoaded ${name}`);
      return Promise.resolve(loaded(name, "active", "user", "0.2.0"));
    },
    // 이 시험은 설치와 지우기를 부르지 않는다
    loadInstalled: () => Promise.resolve(err({ kind: "not_found", diagnostics: [] })),
    reloadFromReviewed: () => Promise.resolve(err({ kind: "unknown_extension" })),
    unload: () => Promise.resolve(false),
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
    reviewed: partial<ReviewedVersions>({}),
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

  test("carries the declared icon of an entry and has no icon key when none is declared", () => {
    const rig = rigOf({
      infos: [loaded("helm", "active", "user", "0.2.0")],
      scopes: [scope("helm/main", "helm", "enabled")],
      entries: [
        { ...entryOfUi("helm", "tab", "ok", [], "Tab", "page"), icon: "Compass" },
        entryOfUi("helm", "panel", "ok", [], "Helm"),
      ],
    });
    const items = rig.port.uiList({}).items;
    expect(items).toEqual([
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
      {
        extension: "helm",
        id: "tab",
        placement: "page",
        mode: "native",
        title: "Tab",
        icon: "Compass",
        state: "ok",
        version: "0.2.0",
        trust: "user",
        issues: [],
      },
    ]);
    expect(items.map((item) => "icon" in item)).toEqual([false, true]);
  });

  test("maps the loader's entries to wire items: sorted, disabled by loader state or by registration, issues as diagnostics", async () => {
    const rig = rigOf({
      infos: [
        loaded("helm", "active", "user", "0.2.0"),
        loaded("account-rotation", "disabled", "user", "0.2.0"),
        loaded("tools-kit", "active", "user", "0.2.0"),
        loaded("closed", "active", "user", "0.2.0"),
        loaded("core-tools", "active", "builtin", "1.0.0"),
      ],
      scopes: [
        scope("helm/main", "helm", "enabled"),
        scope("account-rotation/main", "account-rotation", "enabled"),
        scope("tools-kit/main", "tools-kit", "disabled", true),
        scope("closed/main", "closed", "disabled"),
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
        entryOfUi("closed", "board", "ok", [], "Closed", "page"),
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
          extension: "closed",
          version: "0.2.0",
          trust: "user",
          id: "board",
          placement: "page",
          mode: "native",
          title: "Closed",
          state: "ok",
          issues: [],
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

// W-05: 재시작 직후 미뤄 둔 확장(`lazy_deferred`)은 꺼진 것이 아니다. 화면이 열리고, 확장에 말을 걸 때 싣는다.
const DEFERRED: LoadedExtensionInfo = {
  ...loaded("helm", "disabled", "user", "0.2.0"),
  diagnostics: [
    {
      extension: "helm",
      source: "user",
      stage: "set",
      severity: "info",
      code: "lazy_deferred",
      message: "deferred until a conversation uses it",
      generation: 1,
    },
  ],
};

test("a plugin deferred at startup lists as openable and loads when its app posts", async () => {
  const rig = rigOf({
    infos: [DEFERRED],
    scopes: [],
    entries: [entryOfUi("helm", "tab", "ok", [], "Tab", "page")],
  });
  expect(rig.port.uiList({}).items.map((item) => item.state)).toEqual(["ok"]);
  await rig.port.uiPost({
    extension: "helm",
    ui: "tab",
    threadId: "thr_01HZZZZZZZZZZZZZZZZZZZZZZZ",
    name: "list",
  });
  expect(rig.calls).toEqual([
    "ensureLoaded helm",
    "post thr_01HZZZZZZZZZZZZZZZZZZZZZZZ helm/tab/list",
  ]);
});

test("a plugin the user turned off (no deferred note) still lists as disabled and is not loaded", async () => {
  const rig = rigOf({
    infos: [loaded("helm", "disabled", "user", "0.2.0")],
    entries: [entryOfUi("helm", "tab", "ok", [], "Tab", "page")],
  });
  expect(rig.port.uiList({}).items.map((item) => item.state)).toEqual(["disabled"]);
  await rig.port.uiPost({
    extension: "helm",
    ui: "tab",
    threadId: "thr_01HZZZZZZZZZZZZZZZZZZZZZZZ",
    name: "list",
  });
  expect(rig.calls).toEqual(["post thr_01HZZZZZZZZZZZZZZZZZZZZZZZ helm/tab/list"]);
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

// 검토본 저장소가 버전 목록과 되돌리기의 원천이다(M5c §4.6.8). 되돌리기는 `current`만 바꾸고, 검토 항목 없이 기록에 `rollback`을 남긴다.

const COPY_OLD = `sha256:${"a".repeat(64)}`;
const COPY_NEW = `sha256:${"b".repeat(64)}`;
const COPY_TIME = "2026-11-01T00:00:00.000Z";
const NOW = "2026-11-18T00:00:00.000Z";

interface StoreState {
  current: string | null;
  readonly copies: readonly { readonly version: string; readonly contentHash: string }[];
  readonly setCalls: string[];
  readonly logs: ReviewLogEntry[];
}

function copiesOf(state: StoreState): PluginVersionInfo[] {
  return state.copies.map((copy) => ({
    contentHash: copy.contentHash,
    approvedAt: COPY_TIME,
    current: copy.contentHash === state.current,
    version: copy.version,
    origin: "user",
  }));
}

/** 검토본 저장소와 로더를 가진 되돌리기 포트. 저장소 목록은 최근 승인이 앞이다(`versions`의 약속) */
function reviewedRigOf(options: {
  readonly current: string | null;
  readonly loaded: LoadedExtensionInfo | undefined;
  readonly reload?: () => ReturnType<ExtensionLoader["reloadFromReviewed"]>;
  readonly copies?: StoreState["copies"];
}): {
  readonly port: ExtUiVersionPort;
  readonly state: StoreState;
  readonly reloads: string[];
  readonly refreshes: { count: number };
} {
  const state: StoreState = {
    current: options.current,
    copies: options.copies ?? [
      { version: "0.2.0", contentHash: COPY_NEW },
      { version: "0.1.0", contentHash: COPY_OLD },
    ],
    setCalls: [],
    logs: [],
  };
  const reloads: string[] = [];
  const refreshes = { count: 0 };
  const store = partial<PluginStore>({
    versions: () => Promise.resolve(ok(copiesOf(state))),
    setCurrent: (_name, contentHash) => {
      state.setCalls.push(contentHash);
      state.current = contentHash;
      return Promise.resolve(ok(undefined));
    },
    clearCurrent: () => {
      state.current = null;
      return Promise.resolve(ok(undefined));
    },
    appendLog: (entry) => {
      state.logs.push(entry);
      return Promise.resolve(ok(undefined));
    },
  });
  const loader = partial<ExtensionLoader>({
    list: () => (options.loaded === undefined ? [] : [options.loaded]),
    reloadFromReviewed: (name) => {
      reloads.push(name);
      return options.reload === undefined
        ? Promise.resolve(reloadedNow(name, 0))
        : options.reload();
    },
  });
  const source = partial<ExtUiVersionSource>({
    loader: () => loader,
    reviewed: partial<ReviewedVersions>({
      store,
      now: () => NOW,
      log: partial<Logger>({}),
      refreshPluginSet: () => {
        refreshes.count += 1;
        return Promise.resolve();
      },
    }),
    bundle: () => Promise.resolve(null),
  });
  return { port: createExtUiVersionPort({ extUi: source }), state, reloads, refreshes };
}

const ACTIVE_HELM = loaded("helm", "active", "user", "0.2.0");

describe("ext-ui-version port: reviewed copies", () => {
  test("versions lists the reviewed copies newest first with a version text and the current flag", async () => {
    const rig = reviewedRigOf({ current: COPY_NEW, loaded: ACTIVE_HELM });
    expect(await rig.port.versions("helm")).toEqual(
      ok({
        versions: [
          {
            version: "0.2.0+bbbbbbbb",
            installedAt: COPY_TIME,
            source: "user",
            manifestHash: COPY_NEW,
            stateSchemaVersion: null,
            current: true,
          },
          {
            version: "0.1.0+aaaaaaaa",
            installedAt: COPY_TIME,
            source: "user",
            manifestHash: COPY_OLD,
            stateSchemaVersion: null,
            current: false,
          },
        ],
      }),
    );
  });

  test("a name with no reviewed copy and no load is an unknown extension", async () => {
    const rig = reviewedRigOf({ current: null, loaded: undefined, copies: [] });
    expect(await rig.port.versions("ghost")).toEqual(
      err({ kind: "unknown_extension", name: "ghost" }),
    );
  });

  test("rollback to an older copy moves current, reloads the reviewed copy, and records the rollback without a review item", async () => {
    const rig = reviewedRigOf({ current: COPY_NEW, loaded: ACTIVE_HELM });
    expect(await rig.port.rollback({ name: "helm", version: "0.1.0+aaaaaaaa" })).toEqual(
      ok({ appliesAt: "nextStepBoundary", stateCleared: false }),
    );
    expect(rig.state.current).toBe(COPY_OLD);
    expect(rig.reloads).toEqual(["helm"]);
    expect(rig.refreshes.count).toBe(1);
    expect(rig.state.logs).toEqual([
      {
        at: NOW,
        itemId: null,
        name: "helm",
        kind: null,
        candidateHash: COPY_OLD,
        baseHash: COPY_NEW,
        decision: "rollback",
        profileIds: [],
        actor: "user",
        provenance: null,
        originThreadId: null,
      },
    ]);
  });

  test("a rejected reload puts the previous copy back as current and records nothing", async () => {
    const rig = reviewedRigOf({
      current: COPY_NEW,
      loaded: ACTIVE_HELM,
      reload: () =>
        Promise.resolve(
          err({
            kind: "rejected",
            diagnostics: [partial<LoadDiagnostic>({ message: "the manifest is invalid" })],
          }),
        ),
    });
    expect(await rig.port.rollback({ name: "helm", version: "0.1.0+aaaaaaaa" })).toEqual(
      err({
        kind: "rollback_failed",
        reason: "the manifest is invalid (current restored true)",
      }),
    );
    expect(rig.state.current).toBe(COPY_NEW);
    expect(rig.state.logs).toEqual([]);
    expect(rig.refreshes.count).toBe(0);
  });

  test("an unknown version answers unknown_version and changes nothing", async () => {
    const rig = reviewedRigOf({ current: COPY_NEW, loaded: ACTIVE_HELM });
    expect(await rig.port.rollback({ name: "helm", version: "9.9.9+ffffffff" })).toEqual(
      err({ kind: "unknown_version", version: "9.9.9+ffffffff" }),
    );
    expect(rig.state.setCalls).toEqual([]);
    expect(rig.reloads).toEqual([]);
  });

  test("a copy of an extension that is not loaded only moves current and records the rollback", async () => {
    const rig = reviewedRigOf({ current: COPY_NEW, loaded: undefined });
    expect(await rig.port.rollback({ name: "helm", version: "0.1.0+aaaaaaaa" })).toEqual(
      ok({ appliesAt: "nextStepBoundary", stateCleared: false }),
    );
    expect(rig.state.current).toBe(COPY_OLD);
    expect(rig.reloads).toEqual([]);
    expect(rig.state.logs.map((entry) => entry.decision)).toEqual(["rollback"]);
  });
});

// X-01: 재시작 직후 앱 화면의 첫 메서드 호출은 미뤄 둔 확장을 올린 뒤에 처리된다
test("a method call on a deferred plugin loads it first, then calls", async () => {
  const order: string[] = [];
  const source = partial<ExtUiVersionSource>({
    loader: () =>
      partial<ReturnType<ExtUiVersionSource["loader"]>>({
        list: () => [DEFERRED],
        ensureLoaded: (name: string) => {
          order.push(`load ${name}`);
          return Promise.resolve(loaded(name, "active", "user", "0.2.0"));
        },
      }),
  });
  const port = createExtMethodPort((request) => {
    order.push(`call ${request.extension}.${request.verb}`);
    return Promise.resolve({ kind: "ok", value: { items: [] } });
  }, source);
  const outcome = await port.call({
    extension: "helm",
    verb: "list",
    params: {},
    threadId: null,
    signal: new AbortController().signal,
  });
  expect(outcome).toEqual({ kind: "ok", value: { items: [] } });
  expect(order).toEqual(["load helm", "call helm.list"]);
});

// X-04: 승인 전 드래프트의 화면은 목록에 올리지 않고, 그 드래프트를 시험 중인 대화에서만 보인다
test("a draft screen is listed only for the thread that is testing that draft", () => {
  const DRAFT_NAME = "dabc123-todo";
  const draftInfo: LoadedExtensionInfo = {
    ...loaded(DRAFT_NAME, "active", "user", "0.1.0"),
    draft: { plugin: "todo", draftId: "drf_01HZZZZZZZZZZZZZZZZZZZZZZZ" },
  };
  const entries = [
    entryOfUi(DRAFT_NAME, "tab", "ok", [], "Todo", "page"),
    entryOfUi("helm", "tab", "ok", [], "Helm", "page"),
  ];
  const source = partial<ExtUiVersionSource>({
    host: partial<ExtUiVersionSource["host"]>({ registrations: () => [] }),
    loader: () =>
      partial<ReturnType<ExtUiVersionSource["loader"]>>({
        list: () => [draftInfo, loaded("helm", "active", "user", "0.2.0")],
        uiEntries: () => entries,
      }),
  });
  const testing = "thr_01HZZZZZZZZZZZZZZZZZZZZZZZ";
  const port = createExtUiVersionPort({ extUi: source }, (threadId) =>
    threadId === testing ? [DRAFT_NAME] : [],
  );
  const names = (params: { readonly threadId?: string }): string[] =>
    port.uiList(params).items.map((item) => item.extension);
  expect(names({})).toEqual(["helm"]);
  expect(names({ threadId: "thr_01HYYYYYYYYYYYYYYYYYYYYYYY" })).toEqual(["helm"]);
  expect(names({ threadId: testing })).toEqual([DRAFT_NAME, "helm"]);
  // 드래프트 화면에만 draft 표시가 붙는다(데스크톱이 "테스트 중"을 단다)
  expect(port.uiList({ threadId: testing }).items.map((item) => item.draft)).toEqual([
    true,
    undefined,
  ]);
});

// Y-04: 승인 전 드래프트의 화면은 그 드래프트를 테스트하는 대화에서만 말을 건다
describe("a draft screen talks only from the thread that tests that draft", () => {
  const DRAFT_NAME = "dabc123-todo";
  const testing = "thr_01HZZZZZZZZZZZZZZZZZZZZZZZ";
  const other = "thr_01HYYYYYYYYYYYYYYYYYYYYYYY";
  const draftInfo: LoadedExtensionInfo = {
    ...loaded(DRAFT_NAME, "active", "user", "0.1.0"),
    draft: { plugin: "todo", draftId: "drf_01HZZZZZZZZZZZZZZZZZZZZZZZ" },
  };
  const source = partial<ExtUiVersionSource>({
    host: partial<ExtUiVersionSource["host"]>({
      registrations: () => [],
      ui: partial<ExtUiVersionSource["host"]["ui"]>({
        post: () => Promise.resolve(ok({ duplicate: false })),
      }),
    }),
    loader: () =>
      partial<ReturnType<ExtUiVersionSource["loader"]>>({
        list: () => [draftInfo, loaded("helm", "active", "user", "0.2.0")],
      }),
  });
  const testedOf = (threadId: ThreadId): readonly string[] =>
    threadId === testing ? [DRAFT_NAME] : [];

  async function callFrom(extension: string, raw: string | null): Promise<string> {
    const parsed = raw === null ? undefined : parse(ThreadIdSchema, raw);
    expect(parsed === undefined || parsed.ok).toBe(true);
    const threadId = parsed?.ok === true ? parsed.value : null;
    const port = createExtMethodPort(
      () => Promise.resolve({ kind: "ok", value: { items: [] } }),
      source,
      testedOf,
    );
    const outcome = await port.call({
      extension,
      verb: "list",
      params: {},
      threadId,
      signal: new AbortController().signal,
    });
    return outcome.kind;
  }

  test("methods are refused outside the testing thread and run inside it", async () => {
    expect(await callFrom(DRAFT_NAME, testing)).toBe("ok");
    expect(await callFrom(DRAFT_NAME, other)).toBe("not_found");
    expect(await callFrom(DRAFT_NAME, null)).toBe("not_found");
    // 승인된 확장은 대화와 상관없이 그대로다
    expect(await callFrom("helm", other)).toBe("ok");
  });

  test("ui.post follows the same rule", async () => {
    const port = createExtUiVersionPort({ extUi: source }, testedOf);
    const post = (threadId: string): Promise<boolean> =>
      port
        .uiPost({ extension: DRAFT_NAME, ui: "page", threadId, name: "x" })
        .then((result) => result.ok);
    expect(await post(testing)).toBe(true);
    expect(await post(other)).toBe(false);
  });
});
