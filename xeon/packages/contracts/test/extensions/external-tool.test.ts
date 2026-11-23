import { describe, expect, test } from "bun:test";
import {
  cardExternalToolOf,
  externalToolAppliesOn,
  PluginCardSchema,
  validateManifest,
} from "../../src/extensions/index.ts";
import { parse } from "../../src/index.ts";
import { pluginJson, validManifest } from "./helpers.ts";

const INSTALL = { ko: "brew install sops", en: "brew install sops" };

function toolJson(
  decl: Readonly<Record<string, unknown>>,
  extra: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return pluginJson({ externalTool: { binary: "sops", install: INSTALL, ...decl }, ...extra });
}

function codesOf(input: Readonly<Record<string, unknown>>): string[] {
  return validateManifest(input).issues.map((found) => found.code);
}

describe("externalTool declaration", () => {
  test("a valid declaration passes and the card field fills the defaults", () => {
    const manifest = validManifest(toolJson({ minVersion: "3.10.0", platforms: ["darwin"] }));
    const decl = manifest.externalTool;
    if (decl === undefined) throw new Error("externalTool was dropped");
    expect(cardExternalToolOf(decl)).toEqual({
      binary: "sops",
      minVersion: "3.10.0",
      versionArgs: "--version",
      install: INSTALL,
      bundled: false,
      platforms: ["darwin"],
    });
  });

  test("a binary name with a path, a space or a shell character is refused", () => {
    for (const binary of ["/usr/bin/sops", "sops --x", "sops;rm", "../sops", "Sops", ""]) {
      expect(codesOf(toolJson({ binary }))).toContain("external_tool_invalid");
    }
  });

  test("version arguments outside the closed list are refused", () => {
    expect(codesOf(toolJson({ versionArgs: "--exec=rm" }))).toContain("external_tool_invalid");
    expect(codesOf(toolJson({ versionArgs: "-V" }))).toEqual([]);
  });

  test("install text needs both languages and stays short", () => {
    expect(codesOf(toolJson({ install: { ko: "설치" } }))).toContain("external_tool_invalid");
    expect(codesOf(toolJson({ install: { ko: "a", en: "x".repeat(301) } }))).toContain(
      "external_tool_invalid",
    );
  });

  test("a tool-type plugin cannot declare model tools or a drive", () => {
    const tools = [{ name: "run_sops", description: "run" }];
    expect(codesOf(toolJson({}, { tools }))).toContain("external_tool_conflict");
    const drive = pluginJson(
      { externalTool: { binary: "sops", install: INSTALL } },
      { drives: true },
    );
    expect(codesOf(drive)).toContain("external_tool_conflict");
  });

  test("a duplicate platform is refused", () => {
    expect(codesOf(toolJson({ platforms: ["linux", "linux"] }))).toContain("external_tool_invalid");
  });

  test("platforms decide where the plugin shows", () => {
    expect(externalToolAppliesOn({}, "win32")).toBe(true);
    expect(externalToolAppliesOn({ platforms: ["linux"] }, "darwin")).toBe(false);
    expect(externalToolAppliesOn({ platforms: ["linux"] }, "linux")).toBe(true);
  });

  test("the card schema keeps the status variants and rejects an unknown one", () => {
    const base = cardExternalToolOf({ binary: "git", install: INSTALL });
    const statuses = [
      { kind: "ready", version: "2.40.0" },
      { kind: "bundled", version: "14.1.0" },
      { kind: "missing" },
      { kind: "too_old", found: "3.9.0", required: "3.10.0" },
      { kind: "unusable", reason: "version_unreadable" },
    ];
    for (const status of statuses) {
      const parsed = parse(PluginCardSchema, cardWith({ ...base, status }));
      expect(parsed.ok).toBe(true);
    }
    expect(parse(PluginCardSchema, cardWith({ ...base, status: { kind: "weird" } })).ok).toBe(
      false,
    );
  });
});

function cardWith(externalTool: unknown): Record<string, unknown> {
  return {
    name: "tool-git",
    displayName: "Git",
    purpose: null,
    does: { inject: null, hook: null, drive: null },
    enforcement: "advisory",
    runs: { code: false, isolated: null },
    cost: { always: 0, drive: null, onDemand: 0, toolCount: 0, basis: "declared" },
    health: { state: "idle", lastActiveAt: null, lastError: null },
    origin: { kind: "builtin" },
    review: { state: "approved", currentHash: null, pendingItemId: null, approvedAt: null },
    usedBy: [],
    externalTool,
  };
}
