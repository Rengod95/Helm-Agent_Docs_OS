import { describe, expect, test } from "bun:test";
import { buildCatalog, checkSettingDef } from "@xeon/contracts/settings";
import {
  DEFAULT_MCP_SETTINGS,
  MCP_SETTING_DEFS,
  readMcpSettings,
  readSettingsServers,
} from "../src/settings.ts";
import { layer } from "./support/layers.ts";

const SPEC_KEYS = [
  "servers",
  "importMcpJson",
  "connectTimeoutMs",
  "callTimeoutMs",
  "approvalMode",
  "allowedServers",
  "deniedServers",
  "managedOnly",
  "sampling",
  "inputRequired.maxRounds",
  "result.maxBytes",
  "reconnect.maxDelayMs",
  "reconnect.maxAttempts",
  "versionNegotiation",
].map((name) => `l2.mcp.${name}`);

const stdio = (command: string) => ({ transport: { type: "stdio", command } });

describe("mcp settings", () => {
  test("fourteen keys pass checkSettingDef", () => {
    expect(MCP_SETTING_DEFS.map((def) => def.key).toSorted()).toEqual(SPEC_KEYS.toSorted());
    for (const def of MCP_SETTING_DEFS) {
      expect(checkSettingDef(def)).toEqual([]);
      expect(def.layer).toBe("L2");
      expect(def.secret).toBeUndefined();
      expect(def.ui?.tab).toBe("tools");
      expect(def.since).toBe("0.1.0");
    }
    expect(
      buildCatalog([{ owner: "cap-mcp", namespace: "l2.mcp", defs: MCP_SETTING_DEFS }]).ok,
    ).toBe(true);
  });

  test("scope limits follow the spec", () => {
    const byKey = new Map(MCP_SETTING_DEFS.map((def) => [def.key, def]));
    const scopes = (name: string): readonly string[] =>
      byKey.get(`l2.mcp.${name}`)?.allowedScopes ?? [];
    expect(scopes("allowedServers")).toEqual(["managed", "user"]);
    expect(scopes("managedOnly")).toEqual(["managed"]);
    expect(scopes("deniedServers")).toEqual(["managed", "user", "project"]);
    expect(scopes("servers")).not.toContain("session");
    expect(scopes("callTimeoutMs")).toContain("session");
    expect(byKey.get("l2.mcp.managedOnly")?.runtimeChange).toBe("restart");
    expect(byKey.get("l2.mcp.versionNegotiation")?.runtimeChange).toBe("restart");
    expect(byKey.get("l2.mcp.servers")?.ui?.widget).toBe("table");
  });

  test("defaults match the spec table", () => {
    expect(readMcpSettings([])).toEqual(DEFAULT_MCP_SETTINGS);
    expect(DEFAULT_MCP_SETTINGS).toMatchObject({
      importMcpJson: true,
      connectTimeoutMs: 30000,
      callTimeoutMs: 120000,
      approvalMode: "prompt",
      managedOnly: false,
      sampling: "deny",
      maxInputRounds: 10,
      resultMaxBytes: 51200,
      reconnect: { maxDelayMs: 60000, maxAttempts: 5 },
      versionNegotiation: "auto",
    });
  });

  test("scalar keys take the highest scope and skip invalid values", () => {
    const settings = readMcpSettings([
      layer("user", { "l2.mcp.callTimeoutMs": 5000, "l2.mcp.approvalMode": "auto" }),
      layer("session", { "l2.mcp.callTimeoutMs": 7000 }),
      layer("local", { "l2.mcp.result.maxBytes": 5 }),
      // project가 허용하지 않는 키는 무시한다
      layer("project", { "l2.mcp.sampling": "ask", "l2.mcp.managedOnly": true }),
    ]);
    expect(settings.callTimeoutMs).toBe(7000);
    expect(settings.approvalMode).toBe("auto");
    expect(settings.resultMaxBytes).toBe(51200);
    expect(settings.sampling).toBe("deny");
    expect(settings.managedOnly).toBe(false);
  });

  test("lists: deny is a union and a managed allow list cannot be widened", () => {
    const settings = readMcpSettings([
      layer("managed", { "l2.mcp.allowedServers": ["id:corp"], "l2.mcp.deniedServers": ["id:x"] }),
      layer("user", { "l2.mcp.allowedServers": ["id:mine"], "l2.mcp.deniedServers": ["id:y"] }),
      layer("project", { "l2.mcp.deniedServers": ["id:z", "id:x"] }),
    ]);
    expect(settings.allowedServers).toEqual(["id:corp"]);
    expect(settings.deniedServers.toSorted()).toEqual(["id:x", "id:y", "id:z"]);
    const userOnly = readMcpSettings([layer("user", { "l2.mcp.allowedServers": ["id:mine"] })]);
    expect(userOnly.allowedServers).toEqual(["id:mine"]);
  });

  test("servers: higher scope wins and bad entries are skipped with diagnostics", () => {
    const read = readSettingsServers([
      layer("project", { "l2.mcp.servers": { shared: stdio("project"), onlyproject: stdio("p") } }),
      layer("user", {
        "l2.mcp.servers": {
          shared: stdio("user"),
          "Bad Name": stdio("x"),
          broken: { transport: { type: "stdio" } },
          fine: stdio("f"),
        },
      }),
      layer("session", { "l2.mcp.servers": { ignored: stdio("s") } }),
    ]);
    const summary = Object.fromEntries(
      read.servers.map((server) => [
        server.id,
        `${server.source}${server.requiresTrust ? "!" : ""}`,
      ]),
    );
    expect(summary).toEqual({
      shared: "settings:project!",
      onlyproject: "settings:project!",
      fine: "settings:user",
    });
    expect(read.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.server])).toEqual([
      ["invalid_name", "Bad Name"],
      ["invalid_definition", "broken"],
    ]);
  });
});
