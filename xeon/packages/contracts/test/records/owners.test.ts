import { describe, expect, test } from "bun:test";
import {
  CONTEXTS,
  CORE_EVENT_KINDS,
  EXT_ID_PATTERN,
  RESERVED_EXT_IDS,
  TABLE_PREFIX_OWNERS,
  TYPE_PREFIX_OWNERS,
  extTablePrefix,
  ownerOfKind,
} from "../../src/records/index.ts";

/** routes.yaml layout 도메인 전부(층별) */
const LAYOUT_DOMAINS: readonly string[] = [
  "conversation",
  "records",
  "capabilities",
  "extensions",
  "wire-settings",
  "loading-trust",
  "primitives",
  "operations",
  "exec",
  "sandbox",
  "secrets",
  "process",
  "store",
  "os",
  "tasks",
  "loop",
  "models",
  "tools",
  "context",
  "persistence",
  "agents",
  "workspace",
  "mcp",
  "web",
  "knowledge",
  "work",
  "dialog",
  "artifacts",
  "schedule",
  "group-kit",
  "helm",
  "learning",
  "slots",
  "cli",
  "desktop",
  "host-service",
  "settings-ui",
];

describe("TYPE_PREFIX_OWNERS", () => {
  test("every core kind has a producer", () => {
    for (const kind of CORE_EVENT_KINDS) expect(ownerOfKind(kind)).toBeDefined();
  });

  test("owners match the context map", () => {
    expect(ownerOfKind("thread.started")).toBe("core.persistence");
    expect(ownerOfKind("thread.compacted")).toBe("core.context");
    expect(ownerOfKind("turn.updated")).toBe("core.loop");
    expect(ownerOfKind("effect.intent")).toBe("core.tools");
    expect(ownerOfKind("secret.used")).toBe("core.tools");
    expect(ownerOfKind("input.queued")).toBe("core.tasks");
    expect(ownerOfKind("post.accepted")).toBe("core.tasks");
    expect(ownerOfKind("scope.handler_failed")).toBe("xh");
    expect(ownerOfKind("lease.acquired")).toBe("xh");
    expect(ownerOfKind("work.item_added")).toBe("cap.work");
    expect(ownerOfKind("artifact.created")).toBe("cap.artifacts");
  });

  test("extension and group kinds belong to ext.<id>", () => {
    expect(ownerOfKind("x.web-exa.search.done")).toBe("ext.web-exa");
    expect(ownerOfKind("grp.helm.item.tagged")).toBe("ext.helm");
    expect(ownerOfKind("ui.toast")).toBeUndefined();
    expect(TYPE_PREFIX_OWNERS["ui."]).toBeUndefined();
  });

  test("every producer named in a context has its prefixes owned", () => {
    for (const context of CONTEXTS) {
      for (const prefix of context.typePrefixes) {
        if (prefix.startsWith("grp.")) continue;
        expect(TYPE_PREFIX_OWNERS[prefix]).toBeDefined();
      }
    }
  });
});

describe("tables and extension ids", () => {
  test("extTablePrefix maps hyphens to underscores", () => {
    expect(extTablePrefix("focus-lens")).toBe("x_focus_lens_");
    expect(extTablePrefix("helm")).toBe("x_helm_");
  });

  test("ext id pattern: no underscores, reserved words exist", () => {
    const pattern = new RegExp(EXT_ID_PATTERN);
    expect(pattern.test("focus-lens")).toBe(true);
    expect(pattern.test("focus_lens")).toBe(false);
    expect(pattern.test("a")).toBe(false);
    expect(RESERVED_EXT_IDS).toEqual(["core", "cap", "xh", "sys", "ext"]);
  });

  test("table prefix owners point at real contexts", () => {
    const ids = new Set(CONTEXTS.map((c) => c.id));
    for (const owner of Object.values(TABLE_PREFIX_OWNERS)) expect(ids.has(owner)).toBe(true);
  });
});

describe("CONTEXTS", () => {
  test("ids are unique and every layout domain belongs to exactly one context", () => {
    expect(new Set(CONTEXTS.map((c) => c.id)).size).toBe(CONTEXTS.length);
    const counts = new Map<string, number>();
    for (const context of CONTEXTS) {
      for (const domain of context.domains) counts.set(domain, (counts.get(domain) ?? 0) + 1);
    }
    for (const domain of LAYOUT_DOMAINS) expect(counts.get(domain)).toBe(1);
    expect(counts.size).toBe(LAYOUT_DOMAINS.length);
  });
});
