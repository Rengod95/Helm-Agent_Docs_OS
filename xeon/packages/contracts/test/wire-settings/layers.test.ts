import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import {
  SCOPE_PRECEDENCE,
  buildCatalog,
  checkSettingWrite,
  resolveSetting,
  validateSettingValue,
  type ScopeLayer,
  type SettingCatalog,
  type SettingDef,
  type SettingNamespace,
  type SettingScope,
} from "../../src/wire-settings/settings/index.ts";
import { boolDef, intDef, secretDef } from "./helpers.ts";

function layer(scope: SettingScope, key: string, value: unknown, path?: string): ScopeLayer {
  return {
    scope,
    values: new Map([[key, value]]),
    ...(path === undefined ? {} : { path }),
  };
}

function namespaceOf(def: SettingDef): SettingNamespace {
  const [prefix = "", domain = ""] = def.key.split(".");
  switch (prefix) {
    case "ext":
      return `ext.${domain}`;
    case "f":
    case "x":
    case "l0":
    case "l1":
    case "l2":
    case "l3":
    case "l4":
      return `${prefix}.${domain}`;
    default:
      throw new Error(`bad key ${def.key}`);
  }
}

function catalogOf(...defs: readonly SettingDef[]): SettingCatalog {
  const result = buildCatalog(
    defs.map((def) => ({ owner: def.key, namespace: namespaceOf(def), defs: [def] })),
  );
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.catalog;
}

const KEY = intDef().key;

describe("precedence (S5)", () => {
  test("the table is managed > session > local > project > user", () => {
    expect(SCOPE_PRECEDENCE).toEqual(["managed", "session", "local", "project", "user"]);
  });

  test("session wins, shadowed lists local, project, user in order", () => {
    const { setting } = resolveSetting(intDef(), [
      layer("user", KEY, 1, "/u"),
      layer("project", KEY, 2, "/p"),
      layer("local", KEY, 3, "/l"),
      layer("session", KEY, 4),
    ]);
    expect(setting.value).toBe(4);
    expect(setting.source).toEqual({ scope: "session" });
    expect(setting.shadowed).toEqual([
      { scope: "local", path: "/l" },
      { scope: "project", path: "/p" },
      { scope: "user", path: "/u" },
    ]);
    expect(setting.locked).toBe(false);
  });

  test("layer order in the stack does not matter", () => {
    const stack = [layer("project", KEY, 2), layer("user", KEY, 1), layer("local", KEY, 3)];
    const forward = resolveSetting(intDef(), stack).setting;
    const backward = resolveSetting(intDef(), stack.toReversed()).setting;
    expect(forward).toEqual(backward);
    expect(forward.value).toBe(3);
  });

  test("falls back to the default, then to null", () => {
    expect(resolveSetting(intDef(), []).setting.source).toEqual({ scope: "default" });
    expect(resolveSetting(intDef(), []).setting.value).toBe(0);
    expect(resolveSetting(intDef({ default: undefined }), []).setting.value).toBeNull();
  });

  test("objects are replaced whole, never deep-merged", () => {
    const def: SettingDef = {
      key: "l3.helm.driveLimits",
      layer: "L3",
      type: Type.Object(
        { turns: Type.Integer(), spawns: Type.Integer() },
        { additionalProperties: false },
      ),
      default: { turns: 4, spawns: 8 },
      runtimeChange: "live",
      allowedScopes: ["managed", "user", "project", "local", "session"],
      since: "0.1.0",
    };
    const { setting } = resolveSetting(def, [
      layer("user", def.key, { turns: 4, spawns: 8 }),
      layer("project", def.key, { turns: 9, spawns: 1 }),
    ]);
    expect(setting.value).toEqual({ turns: 9, spawns: 1 });
  });
});

describe("managed locks (S4)", () => {
  test("a managed value wins, locks, and keeps the others as shadowed", () => {
    const { setting } = resolveSetting(intDef(), [
      layer("managed", KEY, 7, "/etc/xeon/managed.json"),
      layer("user", KEY, 1),
      layer("session", KEY, 2),
    ]);
    expect(setting.value).toBe(7);
    expect(setting.locked).toBe(true);
    expect(setting.source).toEqual({ scope: "managed", path: "/etc/xeon/managed.json" });
    expect(setting.shadowed).toEqual([{ scope: "session" }, { scope: "user" }]);
  });

  test("writes to other scopes are settings.locked, writes to managed itself are not", () => {
    const catalog = catalogOf(intDef());
    const stack = [layer("managed", KEY, 7, "/etc/xeon/managed.json")];
    const blocked = checkSettingWrite(catalog, stack, KEY, "user", 3);
    expect(blocked).toEqual({
      ok: false,
      kind: "settings.locked",
      details: { key: KEY, lockedBy: "managed", path: "/etc/xeon/managed.json" },
    });
    expect(checkSettingWrite(catalog, stack, KEY, "managed", 3).ok).toBe(true);
    expect(checkSettingWrite(catalog, [], KEY, "user", 3).ok).toBe(true);
  });
});

describe("scopes (S3)", () => {
  test("session writes are settings.scopeNotAllowed when the key forbids session", () => {
    const def = intDef({ allowedScopes: ["managed", "user"] });
    const result = checkSettingWrite(catalogOf(def), [], KEY, "session", 3);
    expect(result).toMatchObject({ ok: false, kind: "settings.scopeNotAllowed" });
  });

  test("a scope-limited key found in a project file is ignored with an issue", () => {
    const def = intDef({ allowedScopes: ["managed", "user"] });
    const { setting, issues } = resolveSetting(def, [
      layer("project", KEY, 99, "/repo/.xeon/settings.json"),
      layer("user", KEY, 5),
    ]);
    expect(setting.value).toBe(5);
    expect(setting.source).toEqual({ scope: "user" });
    expect(issues.length).toBe(1);
    expect(issues[0]?.scope).toBe("project");
  });
});

describe("invalid values", () => {
  test("a schema-violating file value is skipped and the next scope is used", () => {
    const { setting, issues } = resolveSetting(intDef(), [
      layer("local", KEY, "not a number"),
      layer("project", KEY, 20_000),
      layer("user", KEY, 5),
    ]);
    expect(setting.value).toBe(5);
    expect(issues.map((i) => i.scope)).toEqual(["local", "project"]);
  });

  test("checkSettingWrite reports unknown keys and invalid values", () => {
    const catalog = catalogOf(intDef());
    expect(checkSettingWrite(catalog, [], "l1.loop.nope", "user", 1)).toEqual({
      ok: false,
      kind: "settings.unknownKey",
      details: { key: "l1.loop.nope" },
    });
    const invalid = checkSettingWrite(catalog, [], KEY, "user", 10_001);
    expect(invalid).toMatchObject({ ok: false, kind: "settings.invalidValue" });
    expect(validateSettingValue(intDef(), 10_001).ok).toBe(false);
    expect(validateSettingValue(intDef(), 10_000)).toEqual({ ok: true });
  });

  test("an accepted write returns the value unchanged", () => {
    expect(checkSettingWrite(catalogOf(boolDef()), [], boolDef().key, "user", false)).toEqual({
      ok: true,
      value: false,
    });
  });
});

describe("secrets never resolve (S8)", () => {
  const secret = secretDef();

  test("effective value is the reference string or null", () => {
    const withRef = resolveSetting(secret, [layer("user", secret.key, "secret://exa-key")]).setting;
    expect(withRef.value).toBe("secret://exa-key");
    expect(resolveSetting(secret, []).setting.value).toBeNull();
    expect(resolveSetting(secret, [layer("user", secret.key, null)]).setting.value).toBeNull();
  });

  test("plaintext in a file is skipped with a diagnostic that does not contain the value", () => {
    const { setting, issues } = resolveSetting(secret, [
      layer("user", secret.key, "sk-live-123456"),
    ]);
    expect(setting.value).toBeNull();
    expect(issues.length).toBe(1);
    expect(issues[0]?.message).not.toContain("sk-live-123456");
  });

  test("a plaintext write is settings.secretValue and the details do not carry the value", () => {
    const result = checkSettingWrite(catalogOf(secret), [], secret.key, "user", "sk-live-123456");
    expect(result).toEqual({
      ok: false,
      kind: "settings.secretValue",
      details: { key: secret.key },
    });
    expect(JSON.stringify(result)).not.toContain("sk-live");
    expect(
      checkSettingWrite(catalogOf(secret), [], secret.key, "user", "secret://exa-key").ok,
    ).toBe(true);
    expect(checkSettingWrite(catalogOf(secret), [], secret.key, "user", null).ok).toBe(true);
  });
});

describe("effective setting flags", () => {
  test("pendingUntil follows runtimeChange and deprecated follows the definition", () => {
    expect(resolveSetting(boolDef(), []).setting.pendingUntil).toBeNull();
    expect(resolveSetting(intDef(), []).setting.pendingUntil).toBe("nextTurn");
    expect(
      resolveSetting(intDef({ runtimeChange: "restart", allowedScopes: ["user"] }), []).setting
        .pendingUntil,
    ).toBe("restart");
    expect(resolveSetting(intDef({ deprecated: { since: "0.2.0" } }), []).setting.deprecated).toBe(
      true,
    );
  });
});
