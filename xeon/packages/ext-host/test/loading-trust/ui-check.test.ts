// Plugin UI 검사 시험(X.loading-trust.spec §4.3.4): 항목마다 상태, 진단 코드, 화면 트리, 정책 분기를 값으로 맞춘다.
import { expect, test } from "bun:test";
import type { AppDecl, UiContribution, UiDecl } from "@fresnel/contracts/extensions";
import {
  checkUiDecl,
  HOST_BRIDGE_VERSION,
  HOST_WIDGETS_VERSION,
  UI_FILE_MAX_BYTES,
  type UiCheckInput,
  type UiIssue,
  type UiItemReport,
  type UiPolicy,
} from "../../src/loading-trust/index.ts";
import {
  memoryLoaderFs,
  type MemoryLoaderFs,
  type MemoryTree,
} from "./support/memory-loader-fs.ts";

const ROOT = "/ext/demo";
const POLICY_ON: UiPolicy = { apps: true, allowProjectApps: false };
const TEXT_TREE = '{"type":"Text","props":{"text":"hi"}}';
const APP: AppDecl = {
  root: "./ui/graph",
  entry: "index.html",
  bridge: "^1.0.0",
  reason: "canvas",
};

/** 화면 목록으로 매니페스트 `ui` 하나를 만든다. 위젯 범위의 기본값 `^1.0.0`은 호스트 위젯 버전 `1.0.0`을 포함한다 */
function uiOf(items: readonly UiContribution[], widgets = "^1.0.0"): UiDecl {
  return { schemaVersion: 1, items, widgets };
}

/** 메모리 파일 시스템으로 검사를 돌리고, 보고와 함께 시스템을 돌려준다(읽은 경로와 본 경로를 확인하려고) */
async function checkWith(
  ui: UiDecl,
  tree: MemoryTree,
  extra: Partial<Pick<UiCheckInput, "source" | "policy" | "hostWidgetsVersion">> = {},
): Promise<{ readonly reports: readonly UiItemReport[]; readonly fs: MemoryLoaderFs }> {
  const fs = memoryLoaderFs(tree);
  const reports = await checkUiDecl({
    ui,
    root: ROOT,
    fs,
    source: extra.source ?? "user",
    policy: extra.policy ?? POLICY_ON,
    hostWidgetsVersion: extra.hostWidgetsVersion ?? HOST_WIDGETS_VERSION,
    hostBridgeVersion: HOST_BRIDGE_VERSION,
  });
  return { reports, fs };
}

/** 파일 하나짜리 native 화면 */
function nativeTree(text: string): MemoryTree {
  return { files: { "/ext/demo/ui/page.json": text } };
}

const PAGE: UiContribution = { id: "page", placement: "page", title: "Page", file: "ui/page.json" };

test("ui: a valid native tree is ok and attaches the tree", async () => {
  const { reports } = await checkWith(uiOf([PAGE]), nativeTree(TEXT_TREE));
  expect(reports).toEqual([
    {
      id: "page",
      placement: "page",
      mode: "native",
      title: "Page",
      state: "ok",
      tree: { type: "Text", props: { text: "hi" } },
      issues: [],
    },
  ]);
});

test("ui: a missing native file is invalid with ui_file_missing and no tree", async () => {
  const { reports } = await checkWith(uiOf([PAGE]), {});
  expect(reports).toEqual([
    {
      id: "page",
      placement: "page",
      mode: "native",
      title: "Page",
      state: "invalid",
      issues: [
        {
          severity: "error",
          code: "ui_file_missing",
          path: "/ui/items/0/file",
          message: "ui/page.json does not exist",
        },
      ],
    },
  ]);
});

test("ui: a file that is not JSON is invalid with ui_invalid and no parser text", async () => {
  const { reports } = await checkWith(uiOf([PAGE]), nativeTree('{"type":'));
  expect(reports.map((report) => [report.state, report.issues])).toEqual([
    [
      "invalid",
      [
        {
          severity: "error",
          code: "ui_invalid",
          path: "/ui/items/0/file",
          message: "ui/page.json is not valid JSON",
        },
      ],
    ],
  ]);
});

test("ui: a schema violation in the tree is ui_invalid with a pointer into the file", async () => {
  const { reports } = await checkWith(uiOf([PAGE]), nativeTree('{"type":"text"}'));
  expect(reports.map((report) => [report.state, report.issues])).toEqual([
    [
      "invalid",
      [
        {
          severity: "error",
          code: "ui_invalid",
          path: "/ui/items/0/file#/type",
          message: 'ui/page.json: must match pattern "^[A-Z][A-Za-z0-9]{0,47}$"',
        },
      ],
    ],
  ]);
});

test("ui: a tree over the node limit is ui_limit at the item's file", async () => {
  const children = Array.from({ length: 2000 }, () => ({ type: "Text" }));
  const text = JSON.stringify({ type: "Stack", children });
  const { reports } = await checkWith(uiOf([PAGE]), nativeTree(text));
  expect(reports.map((report) => [report.state, report.issues])).toEqual([
    [
      "invalid",
      [
        {
          severity: "error",
          code: "ui_limit",
          path: "/ui/items/0/file",
          message: "ui/page.json: tree has 2001 nodes, the limit is 2000",
        },
      ],
    ],
  ]);
});

test("ui: a file of exactly 1 MiB is read, and one byte more is ui_limit", async () => {
  const base = '{"type":"Text"}';
  const exact = base + " ".repeat(UI_FILE_MAX_BYTES - base.length);
  const fitting = await checkWith(uiOf([PAGE]), nativeTree(exact));
  expect(fitting.reports.map((report) => [report.state, report.issues])).toEqual([["ok", []]]);

  const over = await checkWith(uiOf([PAGE]), nativeTree(`${exact} `));
  expect(over.reports.map((report) => [report.state, report.issues])).toEqual([
    [
      "invalid",
      [
        {
          severity: "error",
          code: "ui_limit",
          path: "/ui/items/0/file",
          message: "ui/page.json is larger than 1048576 bytes",
        },
      ],
    ],
  ]);
});

test("ui: a byte order mark in front of the JSON is skipped", async () => {
  const { reports } = await checkWith(uiOf([PAGE]), nativeTree(`﻿${TEXT_TREE}`));
  expect(reports.map((report) => report.state)).toEqual(["ok"]);
});

test("ui: a symlink that leaves the extension is ui_path_invalid and the target is never read", async () => {
  const { reports, fs } = await checkWith(uiOf([PAGE]), {
    files: { "/outside/secret.json": TEXT_TREE },
    links: { "/ext/demo/ui/page.json": "/outside/secret.json" },
  });
  expect(reports.map((report) => [report.state, report.issues])).toEqual([
    [
      "invalid",
      [
        {
          severity: "error",
          code: "ui_path_invalid",
          path: "/ui/items/0/file",
          message: "ui/page.json resolves outside the extension",
        },
      ],
    ],
  ]);
  expect(fs.read).toEqual([]);
});

test("ui: a lexical escape is ui_path_invalid even though the manifest check normally catches it", async () => {
  const escaping: UiContribution = {
    id: "esc",
    placement: "page",
    title: "Esc",
    file: "../x.json",
  };
  const { reports, fs } = await checkWith(uiOf([escaping]), {});
  expect(reports.map((report) => report.issues)).toEqual([
    [
      {
        severity: "error",
        code: "ui_path_invalid",
        path: "/ui/items/0/file",
        message: "../x.json must be inside the extension",
      },
    ],
  ]);
  expect(fs.probed).toEqual([]);
});

test("ui: a native item without file is ui_invalid", async () => {
  const bare: UiContribution = { id: "bare", placement: "card", title: "Bare", forKind: "k" };
  const { reports } = await checkWith(uiOf([bare]), {});
  expect(reports.map((report) => [report.state, report.issues])).toEqual([
    [
      "invalid",
      [
        {
          severity: "error",
          code: "ui_invalid",
          path: "/ui/items/0/file",
          message: "a native view requires file",
        },
      ],
    ],
  ]);
});

test("ui: an unsatisfied widgets range makes every native item invalid with widgets_unsupported", async () => {
  const second: UiContribution = {
    id: "second",
    placement: "panel",
    title: "Second",
    file: "ui/page.json",
  };
  const { reports } = await checkWith(uiOf([PAGE, second], "^2.0.0"), nativeTree(TEXT_TREE));
  const widgetsIssue: UiIssue = {
    severity: "error",
    code: "widgets_unsupported",
    path: "/ui/widgets",
    message: 'ui.widgets "^2.0.0" does not include host widgets 1.0.0',
  };
  expect(reports.map((report) => [report.id, report.state, report.issues])).toEqual([
    ["page", "invalid", [widgetsIssue]],
    ["second", "invalid", [widgetsIssue]],
  ]);
});

test("ui: a command placement is not checked, so its missing file is not read", async () => {
  const command: UiContribution = {
    id: "run",
    placement: "command",
    title: "Run",
    file: "ui/none.json",
  };
  const { reports, fs } = await checkWith(uiOf([command]), {});
  expect(reports).toEqual([
    { id: "run", placement: "command", mode: "native", title: "Run", state: "ok", issues: [] },
  ]);
  expect(fs.probed).toEqual([]);
});

test("ui: an app view that the policy allows is ok when its root and entry exist", async () => {
  const graph: UiContribution = {
    id: "graph",
    placement: "page",
    title: "Graph",
    mode: "app",
    app: APP,
  };
  const { reports } = await checkWith(uiOf([graph]), {
    files: { "/ext/demo/ui/graph/index.html": "<html></html>" },
  });
  expect(reports).toEqual([
    {
      id: "graph",
      placement: "page",
      mode: "app",
      title: "Graph",
      state: "ok",
      app: APP,
      appRoot: "/ext/demo/ui/graph",
      issues: [],
    },
  ]);
});

test("ui: appRoot is left out for a builtin extension and for an app view that is not ok", async () => {
  const graph: UiContribution = {
    id: "graph",
    placement: "page",
    title: "Graph",
    mode: "app",
    app: APP,
  };
  const builtin = await checkWith(
    uiOf([graph]),
    { files: { "/ext/demo/ui/graph/index.html": "<html></html>" } },
    { source: "builtin" },
  );
  expect(builtin.reports.map((report) => [report.state, report.appRoot])).toEqual([
    ["ok", undefined],
  ]);
  const missing = await checkWith(uiOf([graph]), {});
  expect(missing.reports.map((report) => [report.state, report.appRoot])).toEqual([
    ["invalid", undefined],
  ]);
});

test("ui: a missing app root is ui_file_missing at /app/root", async () => {
  const graph: UiContribution = {
    id: "graph",
    placement: "page",
    title: "Graph",
    mode: "app",
    app: APP,
  };
  const { reports } = await checkWith(uiOf([graph]), {});
  expect(reports.map((report) => [report.state, report.issues])).toEqual([
    [
      "invalid",
      [
        {
          severity: "error",
          code: "ui_file_missing",
          path: "/ui/items/0/app/root",
          message: "./ui/graph does not exist",
        },
      ],
    ],
  ]);
});

test("ui: a missing app entry is ui_file_missing at /app/entry", async () => {
  const graph: UiContribution = {
    id: "graph",
    placement: "page",
    title: "Graph",
    mode: "app",
    app: APP,
  };
  const { reports } = await checkWith(uiOf([graph]), { dirs: ["/ext/demo/ui/graph"] });
  expect(reports.map((report) => [report.state, report.issues])).toEqual([
    [
      "invalid",
      [
        {
          severity: "error",
          code: "ui_file_missing",
          path: "/ui/items/0/app/entry",
          message: "ui/graph/index.html does not exist",
        },
      ],
    ],
  ]);
});

test("ui: an app entry that is a folder is ui_file_missing (not a file)", async () => {
  const graph: UiContribution = {
    id: "graph",
    placement: "page",
    title: "Graph",
    mode: "app",
    app: APP,
  };
  const { reports } = await checkWith(uiOf([graph]), {
    dirs: ["/ext/demo/ui/graph/index.html"],
  });
  expect(reports.map((report) => report.issues)).toEqual([
    [
      {
        severity: "error",
        code: "ui_file_missing",
        path: "/ui/items/0/app/entry",
        message: "ui/graph/index.html is not a file",
      },
    ],
  ]);
});

test("ui: an app root that is a symlink outside the extension is ui_path_invalid", async () => {
  const graph: UiContribution = {
    id: "graph",
    placement: "page",
    title: "Graph",
    mode: "app",
    app: APP,
  };
  const { reports } = await checkWith(uiOf([graph]), {
    files: { "/outside/index.html": "<html></html>" },
    dirs: ["/ext/demo/ui"],
    links: { "/ext/demo/ui/graph": "/outside" },
  });
  expect(reports.map((report) => report.issues)).toEqual([
    [
      {
        severity: "error",
        code: "ui_path_invalid",
        path: "/ui/items/0/app/root",
        message: "./ui/graph resolves outside the extension",
      },
    ],
  ]);
});

test("ui: an app bridge range the host does not satisfy is bridge_unsupported", async () => {
  const graph: UiContribution = {
    id: "graph",
    placement: "page",
    title: "Graph",
    mode: "app",
    app: { ...APP, bridge: "^2.0.0" },
  };
  const { reports } = await checkWith(uiOf([graph]), {
    files: { "/ext/demo/ui/graph/index.html": "<html></html>" },
  });
  expect(reports.map((report) => [report.state, report.issues])).toEqual([
    [
      "invalid",
      [
        {
          severity: "error",
          code: "bridge_unsupported",
          path: "/ui/items/0/app/bridge",
          message: "app bridge ^2.0.0 does not include host bridge 1.0.0",
        },
      ],
    ],
  ]);
});

test("ui: with apps off and a fallback, the fallback tree is served as native and no app file is probed", async () => {
  const graph: UiContribution = {
    id: "graph",
    placement: "page",
    title: "Graph",
    mode: "app",
    app: APP,
    fallback: "ui/fallback.json",
  };
  const { reports, fs } = await checkWith(
    uiOf([graph]),
    { files: { "/ext/demo/ui/fallback.json": TEXT_TREE } },
    { policy: { apps: false, allowProjectApps: false } },
  );
  expect(reports).toEqual([
    {
      id: "graph",
      placement: "page",
      mode: "native",
      title: "Graph",
      state: "ok",
      tree: { type: "Text", props: { text: "hi" } },
      issues: [
        {
          severity: "info",
          code: "ui_mode_not_allowed",
          path: "/ui/items/0/mode",
          message: "app view is not allowed (x.ui.apps is off); the fallback tree is served",
        },
      ],
    },
  ]);
  expect(fs.probed).toEqual(["/ext/demo/ui/fallback.json"]);
});

test("ui: with apps off and no fallback the item is disabled and warned with ui_mode_not_allowed", async () => {
  const graph: UiContribution = {
    id: "graph",
    placement: "page",
    title: "Graph",
    mode: "app",
    app: APP,
  };
  const { reports, fs } = await checkWith(
    uiOf([graph]),
    {},
    { policy: { apps: false, allowProjectApps: false } },
  );
  expect(reports).toEqual([
    {
      id: "graph",
      placement: "page",
      mode: "app",
      title: "Graph",
      state: "disabled",
      app: APP,
      issues: [
        {
          severity: "warning",
          code: "ui_mode_not_allowed",
          path: "/ui/items/0/mode",
          message: "app view is not allowed (x.ui.apps is off) and has no fallback",
        },
      ],
    },
  ]);
  expect(fs.probed).toEqual([]);
});

test("ui: a project-installed app is replaced by its fallback unless allowProjectApps is on", async () => {
  const graph: UiContribution = {
    id: "graph",
    placement: "page",
    title: "Graph",
    mode: "app",
    app: APP,
    fallback: "ui/fallback.json",
  };
  const tree = {
    files: {
      "/ext/demo/ui/fallback.json": TEXT_TREE,
      "/ext/demo/ui/graph/index.html": "<html></html>",
    },
  };
  const denied = await checkWith(uiOf([graph]), tree, { source: "project" });
  expect(denied.reports.map((report) => [report.mode, report.state, report.issues])).toEqual([
    [
      "native",
      "ok",
      [
        {
          severity: "info",
          code: "ui_mode_not_allowed",
          path: "/ui/items/0/mode",
          message:
            "app view is not allowed (a project extension needs x.ui.allowProjectApps); the fallback tree is served",
        },
      ],
    ],
  ]);

  const allowed = await checkWith(uiOf([graph]), tree, {
    source: "project",
    policy: { apps: true, allowProjectApps: true },
  });
  expect(allowed.reports.map((report) => [report.mode, report.state, report.issues])).toEqual([
    ["app", "ok", []],
  ]);
});

test("ui: a broken fallback tree leaves the item invalid and keeps the info issue", async () => {
  const graph: UiContribution = {
    id: "graph",
    placement: "page",
    title: "Graph",
    mode: "app",
    app: APP,
    fallback: "ui/fallback.json",
  };
  const { reports } = await checkWith(
    uiOf([graph]),
    { files: { "/ext/demo/ui/fallback.json": "{" } },
    { policy: { apps: false, allowProjectApps: false } },
  );
  expect(reports.map((report) => [report.state, report.issues])).toEqual([
    [
      "invalid",
      [
        {
          severity: "info",
          code: "ui_mode_not_allowed",
          path: "/ui/items/0/mode",
          message: "app view is not allowed (x.ui.apps is off); the fallback tree is served",
        },
        {
          severity: "error",
          code: "ui_invalid",
          path: "/ui/items/0/fallback",
          message: "ui/fallback.json is not valid JSON",
        },
      ],
    ],
  ]);
});

test("ui: an app view without its app declaration is ui_invalid", async () => {
  const bare: UiContribution = { id: "bare", placement: "page", title: "Bare", mode: "app" };
  const { reports } = await checkWith(uiOf([bare]), {});
  expect(reports.map((report) => [report.mode, report.state, report.issues])).toEqual([
    [
      "app",
      "invalid",
      [
        {
          severity: "error",
          code: "ui_invalid",
          path: "/ui/items/0/app",
          message: "an app view requires app",
        },
      ],
    ],
  ]);
});

test("ui: reports keep the declaration order of the items", async () => {
  const first: UiContribution = {
    id: "first",
    placement: "status",
    title: "First",
    file: "ui/page.json",
  };
  const second: UiContribution = { id: "second", placement: "command", title: "Second" };
  const { reports } = await checkWith(uiOf([first, second]), nativeTree(TEXT_TREE));
  expect(reports.map((report) => report.id)).toEqual(["first", "second"]);
});
