import { describe, expect, test } from "bun:test";
import {
  buildCatalog,
  checkSettingDef,
  type ScopeLayer,
  type ScopeStack,
} from "@xeon/contracts/settings";
import { createFilesApi } from "../src/service.ts";
import {
  DEFAULT_WORKSPACE_SETTINGS,
  readWorkspaceSettings,
  WORKSPACE_SETTING_DEFS,
} from "../src/settings.ts";
import { numbered } from "./support/assertions.ts";
import { depsFor } from "./support/fakes.ts";
import { memoryEnv } from "./support/memory-env.ts";

function layer(scope: ScopeLayer["scope"], values: Record<string, unknown>): ScopeLayer {
  return { scope, values: new Map(Object.entries(values)) };
}

describe("settings", () => {
  test("settings defs pass checks", () => {
    // 읽는 키만 선언한다: read.*, shell.*, list.maxEntries(M1), images.*(M2), edit.fuzzy·grep.*·find.*(M3b). plan W8
    expect(WORKSPACE_SETTING_DEFS.map((def) => def.key)).toEqual([
      "l2.workspace.read.maxLines",
      "l2.workspace.read.maxBytes",
      "l2.workspace.shell.maxLines",
      "l2.workspace.shell.maxBytes",
      "l2.workspace.shell.defaultTimeoutSec",
      "l2.workspace.grep.maxMatches",
      "l2.workspace.grep.maxLineLength",
      "l2.workspace.find.maxResults",
      "l2.workspace.list.maxEntries",
      "l2.workspace.edit.fuzzy",
      "l2.workspace.images.maxWidth",
      "l2.workspace.images.maxHeight",
      "l2.workspace.images.maxBytes",
      "l2.workspace.images.maxInputBytes",
      "l2.workspace.grep.rgPath",
    ]);
    for (const def of WORKSPACE_SETTING_DEFS) {
      expect(checkSettingDef(def)).toEqual([]);
      expect(def.key.startsWith("l2.workspace.")).toBe(true);
      expect(def.layer).toBe("L2");
      expect(def.since).toBe("0.1.0");
      expect(def.secret).toBeUndefined();
      // rgPath는 실행 파일을 바꾸므로 다시 시작해야 적용되고, 프로젝트 설정으로는 바꿀 수 없다(spec §6)
      const rgPath = def.key === "l2.workspace.grep.rgPath";
      expect(def.runtimeChange).toBe(rgPath ? "restart" : "nextTurn");
      expect(def.ui?.tab).toBe("tools");
    }
    const rgDef = WORKSPACE_SETTING_DEFS.find((def) => def.key === "l2.workspace.grep.rgPath");
    expect(rgDef?.allowedScopes).toEqual(["managed", "user"]);
    expect(rgDef?.default).toBe("");
    const built = buildCatalog([
      { owner: "cap-workspace", namespace: "l2.workspace", defs: WORKSPACE_SETTING_DEFS },
    ]);
    expect(built.ok).toBe(true);
  });

  test("defaults match the spec table", () => {
    expect(readWorkspaceSettings([])).toEqual(DEFAULT_WORKSPACE_SETTINGS);
    expect(DEFAULT_WORKSPACE_SETTINGS).toEqual({
      read: { maxLines: 2000, maxBytes: 51200 },
      shell: { maxLines: 2000, maxBytes: 51200, defaultTimeoutSec: 0 },
      grep: { maxMatches: 100, maxLineLength: 500, rgPath: "" },
      find: { maxResults: 1000 },
      list: { maxEntries: 500 },
      edit: { fuzzy: true },
      images: { maxWidth: 2000, maxHeight: 2000, maxBytes: 4718592, maxInputBytes: 41943040 },
    });
  });

  test("grep and find keys read their ranges and types, and rgPath is only a string", () => {
    const stack: ScopeStack = [
      layer("user", {
        "l2.workspace.grep.maxMatches": 7,
        "l2.workspace.grep.maxLineLength": 80,
        "l2.workspace.find.maxResults": 3,
        "l2.workspace.grep.rgPath": "/opt/rg/bin/rg",
      }),
      // 범위 밖(최솟값 80 미만)과 형식 틀림(문자열이 아님)은 건너뛴다
      layer("managed", {
        "l2.workspace.grep.maxLineLength": 79,
        "l2.workspace.find.maxResults": "3",
      }),
    ];
    const settings = readWorkspaceSettings(stack);
    expect(settings.grep).toEqual({ maxMatches: 7, maxLineLength: 80, rgPath: "/opt/rg/bin/rg" });
    expect(settings.find).toEqual({ maxResults: 3 });
    // rgPath는 managed·user 범위만 허용한다. project 층의 값은 읽지 않는다
    const project = readWorkspaceSettings([
      layer("project", { "l2.workspace.grep.rgPath": "/tmp/evil" }),
    ]);
    expect(project.grep.rgPath).toBe("");
  });

  test("scopes follow the precedence and invalid values are skipped", () => {
    const stack: ScopeStack = [
      layer("user", { "l2.workspace.read.maxLines": 100, "l2.workspace.list.maxEntries": 20 }),
      layer("session", { "l2.workspace.read.maxLines": 50 }),
      // 범위 밖 값(최솟값 1 미만)은 건너뛰고 아래 층 값이 이긴다
      layer("project", { "l2.workspace.list.maxEntries": 0, "l2.workspace.shell.maxBytes": 3 }),
    ];
    const settings = readWorkspaceSettings(stack);
    expect(settings.read.maxLines).toBe(50);
    expect(settings.list.maxEntries).toBe(20);
    expect(settings.shell.maxBytes).toBe(DEFAULT_WORKSPACE_SETTINGS.shell.maxBytes);
  });

  test("settings change applies next call", async () => {
    const env = memoryEnv({ cwd: "/work" });
    env.mkdir("/work");
    env.put("/work/big.txt", numbered(10));
    let layers: ScopeStack = [layer("user", { "l2.workspace.read.maxLines": 3 })];
    const files = createFilesApi(depsFor(env, { settings: () => readWorkspaceSettings(layers) }));
    const first = await files.read({ path: "big.txt" });
    expect(first.kind === "text" ? first.endLine : -1).toBe(3);
    layers = [layer("user", { "l2.workspace.read.maxLines": 6 })];
    const second = await files.read({ path: "big.txt" });
    expect(second.kind === "text" ? second.endLine : -1).toBe(6);
  });
});
