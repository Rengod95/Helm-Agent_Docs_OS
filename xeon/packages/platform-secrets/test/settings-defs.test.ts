import { describe, expect, test } from "bun:test";
import { buildCatalog, checkSettingDef, validateSettingValue } from "@xeon/contracts/settings";
import { SECRETS_SETTING_DEFS } from "../src/index.ts";

function defOf(key: string) {
  const def = SECRETS_SETTING_DEFS.find((candidate) => candidate.key === key);
  if (def === undefined) throw new Error(`missing setting ${key}`);
  return def;
}

describe("l0.secrets settings", () => {
  test("declares exactly the keys of the spec table", () => {
    expect(SECRETS_SETTING_DEFS.map((def) => def.key)).toEqual([
      "l0.secrets.providers",
      "l0.secrets.defaultProvider",
      "l0.secrets.sops.files",
      "l0.secrets.sops.binary",
      "l0.secrets.ageKey.source",
      "l0.secrets.ageKey.filePath",
      "l0.secrets.approval.default",
      "l0.secrets.approval.writeHosts",
      "l0.secrets.lease.ttlSeconds",
      "l0.secrets.lease.maxUses",
      "l0.secrets.redaction.enabled",
      "l0.secrets.audit.retentionDays",
    ]);
  });

  test("every definition passes checkSettingDef, is an L0 setting and builds a catalog", () => {
    for (const def of SECRETS_SETTING_DEFS) {
      expect(checkSettingDef(def)).toEqual([]);
      expect(def.layer).toBe("L0");
      expect(def.since).toBe("0.1.0");
    }
    const built = buildCatalog([
      { owner: "platform-secrets", namespace: "l0.secrets", defs: SECRETS_SETTING_DEFS },
    ]);
    expect(built.ok).toBe(true);
  });

  test("values outside the documented type or range are rejected, valid ones pass", () => {
    expect(validateSettingValue(defOf("l0.secrets.redaction.enabled"), false).ok).toBe(false);
    expect(
      validateSettingValue(defOf("l0.secrets.sops.files"), [
        { env: "dev", path: "/home/u/dev.sops.yaml" },
      ]).ok,
    ).toBe(true);
  });

  test("project, local and session scopes are not allowed", () => {
    for (const def of SECRETS_SETTING_DEFS) {
      for (const scope of ["project", "local", "session"] as const) {
        expect(def.allowedScopes).not.toContain(scope);
      }
    }
  });

  test("defaults come from DEFAULT_SECRETS_CONFIG", () => {
    expect(defOf("l0.secrets.providers").default).toEqual(["sops"]);
    expect(defOf("l0.secrets.lease.ttlSeconds").default).toBe(900);
    expect(defOf("l0.secrets.lease.maxUses").default).toBe(200);
    expect(defOf("l0.secrets.approval.writeHosts").default).toBe("per-use");
    expect(defOf("l0.secrets.redaction.enabled").default).toBe(true);
    expect(defOf("l0.secrets.audit.retentionDays").default).toBe(90);
  });
});
