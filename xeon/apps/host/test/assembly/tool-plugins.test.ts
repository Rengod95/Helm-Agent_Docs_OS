import { describe, expect, test } from "bun:test";
import { ok } from "@fresnel/contracts";
import { dependenciesOf, validateManifest, type PluginCard } from "@fresnel/contracts/extensions";
import type { OsPlatform } from "@fresnel/contracts/services";
import { workspaceManifest } from "@fresnel/cap-workspace";
import { binaryRequirements, type BinaryCheckReport } from "@fresnel/platform-os";
import { buildPluginCard, withToolStatus } from "../../src/assembly/plugins/card.ts";
import {
  TOOL_PLUGIN_NAMES,
  TOOL_PLUGIN_ROWS,
  toolPluginManifest,
  toolPluginRowsOn,
} from "../../src/assembly/tool-plugins.ts";
import { createToolStatusSource, toolStatusesOf } from "../../src/assembly/tool-status.ts";

// AGE-76 질문 2: 도구 종류 플러그인. 분류(카드의 externalTool), 점검 상태, 의존, OS별 목록, 임의 명령 금지.

const PLATFORMS: readonly OsPlatform[] = ["darwin", "linux", "win32"];

function cardOf(name: string): PluginCard {
  const row = TOOL_PLUGIN_ROWS.find((item) => item.name === name);
  if (row === undefined) throw new Error(`no tool plugin ${name}`);
  return buildPluginCard({
    folder: {
      name,
      manifest: toolPluginManifest(row),
      materials: { instructions: [], skills: [], mcpServers: [], agents: [], commands: [] },
    },
    origin: { kind: "builtin" },
    review: { state: "approved", currentHash: null, pendingItemId: null, approvedAt: null },
    usedBy: [],
    health: { state: "idle", lastActiveAt: null, lastError: null },
  });
}

function report(
  platform: OsPlatform,
  status: (name: string) => BinaryCheckReport["items"][number]["status"],
): BinaryCheckReport {
  const items = binaryRequirements(platform).flatMap((row) =>
    row.need === "not_used"
      ? []
      : [
          {
            name: row.name,
            need: row.need,
            usedBy: row.usedBy,
            impact: row.impact,
            status: status(row.name),
          },
        ],
  );
  return { platform, items, ready: true, blocking: [], degraded: [] };
}

describe("every manifest is a valid tool-type plugin", () => {
  test("the manifests validate and carry no model tools, no hooks and no drive", () => {
    for (const row of TOOL_PLUGIN_ROWS) {
      const manifest = toolPluginManifest(row);
      const checked = validateManifest(manifest);
      expect(checked.issues.filter((found) => found.severity === "error")).toEqual([]);
      expect(manifest.tools).toBeUndefined();
      expect(manifest.plugins).toEqual([{ layer: "L2", hooks: [] }]);
      expect((manifest.purpose ?? "").trim()).not.toBe("");
      expect((manifest.description ?? "").trim()).not.toBe("");
    }
  });

  test("the declared install text is non-empty in ko and en and the version args are the safe list", () => {
    for (const row of TOOL_PLUGIN_ROWS) {
      expect(row.tool.install.ko.trim()).not.toBe("");
      expect(row.tool.install.en.trim()).not.toBe("");
      expect(["--version", "version", "-V", "-version"]).toContain(
        row.tool.versionArgs ?? "--version",
      );
    }
  });
});

describe("classification", () => {
  test("the card of a tool plugin carries its declaration, filled with defaults, and no status before a check", () => {
    const card = cardOf("tool-sops");
    expect(card.externalTool).toEqual({
      binary: "sops",
      minVersion: "3.10.0",
      versionArgs: "--version",
      install: {
        ko: "sops를 설치하세요: brew install sops (또는 https://github.com/getsops/sops/releases)",
        en: "Install sops: brew install sops (or https://github.com/getsops/sops/releases)",
      },
      bundled: true,
    });
    expect(card.does).toEqual({ inject: null, hook: null, drive: null });
  });

  test("socat reads its version with -V", () => {
    expect(cardOf("tool-socat").externalTool?.versionArgs).toBe("-V");
  });
});

describe("the list per OS", () => {
  test("only the tools of that OS are listed and they match the check table of L0.os", () => {
    for (const platform of PLATFORMS) {
      const table = binaryRequirements(platform)
        .filter((row) => row.need !== "not_used")
        .map((row) => row.name)
        .toSorted();
      const listed = toolPluginRowsOn(platform)
        .map((row) => row.tool.binary)
        .toSorted();
      expect(listed).toEqual(table);
    }
    expect(toolPluginRowsOn("darwin").map((row) => row.name)).toEqual([
      "tool-rg",
      "tool-sops",
      "tool-age",
      "tool-git",
      "tool-security",
    ]);
    expect(toolPluginRowsOn("linux").map((row) => row.name)).toEqual([
      "tool-rg",
      "tool-sops",
      "tool-age",
      "tool-git",
      "tool-bwrap",
      "tool-socat",
      "tool-secret-tool",
    ]);
    expect(toolPluginRowsOn("win32").map((row) => row.name)).toEqual([
      "tool-rg",
      "tool-sops",
      "tool-age",
      "tool-git",
    ]);
  });

  test("the minimum versions equal the check table", () => {
    for (const platform of PLATFORMS) {
      for (const row of binaryRequirements(platform)) {
        const tool = TOOL_PLUGIN_ROWS.find((item) => item.tool.binary === row.name);
        if (row.need === "not_used" || tool === undefined) continue;
        expect(tool.tool.minVersion).toBe(row.minVersion);
      }
    }
  });
});

describe("check status", () => {
  test("a system tool is ready, a bundled one is bundled, and a missing, old or unusable one says so", () => {
    const special: Readonly<Record<string, BinaryCheckReport["items"][number]["status"]>> = {
      rg: { kind: "ok", path: "/home/u/.cache/rg", version: "14.1.0", source: "bundled" },
      sops: { kind: "too_old", found: "3.9.0", required: "3.10.0" },
      age: { kind: "missing", hint: "install age" },
      bwrap: { kind: "unusable", reason: "version_unreadable" },
    };
    const checked = report(
      "linux",
      (name) =>
        special[name] ?? { kind: "ok", path: "/usr/bin/x", version: "1.2.3", source: "system" },
    );
    const statuses = toolStatusesOf(checked);
    expect(statuses.get("tool-rg")).toEqual({ kind: "bundled", version: "14.1.0" });
    expect(statuses.get("tool-sops")).toEqual({
      kind: "too_old",
      found: "3.9.0",
      required: "3.10.0",
    });
    expect(statuses.get("tool-age")).toEqual({ kind: "missing" });
    expect(statuses.get("tool-bwrap")).toEqual({ kind: "unusable", reason: "version_unreadable" });
    expect(statuses.get("tool-git")).toEqual({ kind: "ready", version: "1.2.3" });
    expect(JSON.stringify([...statuses])).not.toContain("/usr/bin");
  });

  test("a tool the OS does not use has no status", () => {
    const statuses = toolStatusesOf(
      report("darwin", () => ({ kind: "ok", path: "/p", version: "1", source: "system" })),
    );
    expect(statuses.has("tool-bwrap")).toBe(false);
    expect(statuses.has("tool-security")).toBe(true);
  });

  test("the source copies the last check and a cancelled check leaves it as it was", () => {
    const source = createToolStatusSource();
    expect(source.statusOf("tool-git")).toBeUndefined();
    source.accept(
      ok(report("darwin", () => ({ kind: "ok", path: "/p", version: "2.40.0", source: "system" }))),
    );
    expect(source.statusOf("tool-git")).toEqual({ kind: "ready", version: "2.40.0" });
    source.accept({ ok: false, error: { kind: "cancelled" } });
    expect(source.statusOf("tool-git")).toEqual({ kind: "ready", version: "2.40.0" });
    source.accept(ok(report("darwin", () => ({ kind: "missing", hint: "h" }))));
    expect(source.statusOf("tool-git")).toEqual({ kind: "missing" });
  });

  test("the response card gets the status only for a builtin card with a declaration", () => {
    const source = createToolStatusSource();
    source.accept(
      ok(report("darwin", () => ({ kind: "ok", path: "/p", version: "9.9.9", source: "system" }))),
    );
    const card = cardOf("tool-git");
    expect(withToolStatus(card, (name) => source.statusOf(name)).externalTool?.status).toEqual({
      kind: "ready",
      version: "9.9.9",
    });
    // 사용자 출처 카드는 같은 선언이 있어도 엔진이 점검하지 않는다
    const user: PluginCard = { ...card, origin: { kind: "user" } };
    expect(withToolStatus(user, (name) => source.statusOf(name))).toEqual(user);
    // 선언이 없는 카드는 그대로다
    const plain: PluginCard = { ...card, name: "tool-git" };
    const { externalTool: _declaration, ...rest } = plain;
    expect(withToolStatus(rest, (name) => source.statusOf(name))).toEqual(rest);
  });
});

describe("dependencies", () => {
  test("the workspace tools depend hard on rg and softly on git", () => {
    const lines = dependenciesOf(workspaceManifest()).map((line) => [line.target, line.kind]);
    expect(lines).toEqual([
      ["tool-rg", "hard"],
      ["tool-git", "soft"],
    ]);
    expect(TOOL_PLUGIN_NAMES).toContain("tool-rg");
    expect(TOOL_PLUGIN_NAMES).toContain("tool-git");
  });
});
