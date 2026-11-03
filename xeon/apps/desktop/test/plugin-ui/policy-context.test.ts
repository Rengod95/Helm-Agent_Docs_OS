import { describe, expect, test } from "bun:test";
import {
  appsAllowed,
  bridgeTrustOf,
  policyContextOf,
  UI_ALLOW_PROJECT_APPS_KEY,
  UI_APPS_KEY,
} from "../../src/plugin-ui/policy-context.ts";
import { HELM_MANIFEST, extGetOf, uiEntryOf } from "./support.ts";

const commands = [
  { name: "helm", origin: "helm" },
  { name: "plan", origin: "/home/u/.fresnel/commands/plan.md" },
  { name: "other", origin: "other-ext" },
];

describe("policyContextOf", () => {
  test("the methods map carries readOnly and approval, and only declared verbs", () => {
    const context = policyContextOf({
      get: extGetOf(),
      entry: uiEntryOf(),
      openThreadId: undefined,
      commands,
    });
    expect(context.ok).toBe(true);
    if (!context.ok) return;
    expect([...context.value.methods.entries()]).toEqual([
      ["status", { readOnly: true, approval: false }],
      ["reset", { readOnly: false, approval: true }],
      ["save", { readOnly: false, approval: false }],
    ]);
    expect(context.value.methods.has("missing")).toBe(false);
  });

  test("readsRecordKinds is the union over the plugins; declared setting keys come from userConfig", () => {
    const context = policyContextOf({
      get: extGetOf(),
      entry: uiEntryOf(),
      openThreadId: undefined,
      commands,
    });
    if (!context.ok) throw new Error("expected a context");
    expect(context.value.readsRecordKinds).toEqual(["x.other.note.item"]);
    expect([...context.value.declaredSettingKeys].toSorted()).toEqual([
      "ext.helm.model",
      "ext.helm.token",
    ]);
    expect(context.value.settingPrefixes).toEqual(["ext.helm."]);
  });

  test("only the extension's own commands count as ownCommands", () => {
    const context = policyContextOf({
      get: extGetOf(),
      entry: uiEntryOf(),
      openThreadId: undefined,
      commands,
    });
    if (!context.ok) throw new Error("expected a context");
    expect([...context.value.ownCommands].toSorted()).toEqual(["helm"]);
  });

  test("post follows the trust tier: only builtin may post", () => {
    const user = policyContextOf({
      get: extGetOf(),
      entry: uiEntryOf({ trust: "user" }),
      openThreadId: undefined,
      commands,
    });
    const builtin = policyContextOf({
      get: extGetOf(),
      entry: uiEntryOf({ trust: "builtin" }),
      openThreadId: undefined,
      commands,
    });
    const project = policyContextOf({
      get: extGetOf(),
      entry: uiEntryOf({ trust: "project" }),
      openThreadId: undefined,
      commands,
    });
    if (!user.ok || !builtin.ok || !project.ok) throw new Error("expected contexts");
    expect([user.value.allowPost, builtin.value.allowPost, project.value.allowPost]).toEqual([
      false,
      true,
      false,
    ]);
  });

  test("managed installs are judged as user (the bridge has no managed tier)", () => {
    expect(bridgeTrustOf("managed")).toBe("user");
    expect(bridgeTrustOf("project")).toBe("project");
    expect(bridgeTrustOf("builtin")).toBe("builtin");
    const context = policyContextOf({
      get: extGetOf(),
      entry: uiEntryOf({ trust: "managed" }),
      openThreadId: undefined,
      commands,
    });
    if (!context.ok) throw new Error("expected a context");
    expect(context.value.trust).toBe("user");
    expect(context.value.allowPost).toBe(false);
  });

  test("builtin extensions also get the l3 group setting prefix", () => {
    const context = policyContextOf({
      get: extGetOf(),
      entry: uiEntryOf({ trust: "builtin" }),
      openThreadId: undefined,
      commands,
    });
    if (!context.ok) throw new Error("expected a context");
    expect(context.value.settingPrefixes).toEqual(["ext.helm.", "l3.helm."]);
  });

  test("enabled follows the registration status, safeMode follows the safe-mode exclusion", () => {
    const off = policyContextOf({
      get: extGetOf(HELM_MANIFEST, { status: "disabled" }),
      entry: uiEntryOf(),
      openThreadId: undefined,
      commands,
    });
    const safe = policyContextOf({
      get: extGetOf(HELM_MANIFEST, { safeModeExcluded: "safe_mode" }),
      entry: uiEntryOf(),
      openThreadId: undefined,
      commands,
    });
    if (!off.ok || !safe.ok) throw new Error("expected contexts");
    expect(off.value.enabled).toBe(false);
    expect(safe.value.safeMode).toBe(true);
  });

  test("the open thread id is carried as given", () => {
    const context = policyContextOf({
      get: extGetOf(),
      entry: uiEntryOf(),
      openThreadId: "thr_01HZX0000000000000000000AA",
      commands,
    });
    if (!context.ok) throw new Error("expected a context");
    expect(context.value.openThreadId).toBe("thr_01HZX0000000000000000000AA");
  });

  test("a manifest that does not parse is an error value, not a throw", () => {
    const broken = { ...HELM_MANIFEST, entry: undefined };
    const result = policyContextOf({
      get: extGetOf(broken),
      entry: uiEntryOf(),
      openThreadId: undefined,
      commands,
    });
    expect(result).toEqual({ ok: false, error: { kind: "manifest_invalid" } });
  });

  test("an entry of another extension is refused", () => {
    const result = policyContextOf({
      get: extGetOf(),
      entry: uiEntryOf({ extension: "other" }),
      openThreadId: undefined,
      commands,
    });
    expect(result).toEqual({ ok: false, error: { kind: "extension_mismatch" } });
  });
});

describe("appsAllowed", () => {
  test("apps are on and project apps are off by default", () => {
    expect(appsAllowed("user", {})).toBe(true);
    expect(appsAllowed("builtin", {})).toBe(true);
    expect(appsAllowed("project", {})).toBe(false);
  });

  test("x.ui.apps false blocks every tier", () => {
    const off = { [UI_APPS_KEY]: false };
    expect(appsAllowed("user", off)).toBe(false);
    expect(appsAllowed("builtin", off)).toBe(false);
    expect(appsAllowed("project", { ...off, [UI_ALLOW_PROJECT_APPS_KEY]: true })).toBe(false);
  });

  test("project apps need x.ui.allowProjectApps true", () => {
    expect(appsAllowed("project", { [UI_ALLOW_PROJECT_APPS_KEY]: true })).toBe(true);
    expect(appsAllowed("project", { [UI_ALLOW_PROJECT_APPS_KEY]: false })).toBe(false);
    expect(appsAllowed("user", { [UI_ALLOW_PROJECT_APPS_KEY]: false })).toBe(true);
  });

  test("a value that is not a boolean falls back to the default", () => {
    expect(appsAllowed("user", { [UI_APPS_KEY]: "no" })).toBe(true);
    expect(appsAllowed("project", { [UI_ALLOW_PROJECT_APPS_KEY]: 1 })).toBe(false);
  });
});
