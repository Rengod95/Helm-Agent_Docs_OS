import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "@xeon/contracts";
import { secretRef, SecretNameSchema, SecretRef } from "@xeon/contracts/capabilities";
import { defineSettings } from "@xeon/contracts/settings";
import { DEFAULT_SECRETS_CONFIG } from "@xeon/platform-secrets";
import { buildEngineCatalog } from "../../src/assembly/catalog.ts";
import { createSecretsPort, settingKeysReferencing } from "../../src/assembly/secrets.ts";
import { createSettingsEngine } from "../../src/assembly/settings-engine.ts";
import { createFakeSecrets, FAKE_SECRETS_CONFIG } from "../fixtures/fake-secrets.ts";

const scratch = mkdtempSync(join(tmpdir(), "xh-sec-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function nameOf(text: string) {
  const parsed = parse(SecretNameSchema, text);
  if (!parsed.ok) throw new Error(`not a secret name: ${text}`);
  return parsed.value;
}

test("the default metadata of a new secret follows the first SOPS file and the secret settings", () => {
  const port = createSecretsPort(createFakeSecrets().port.admin, () => ({
    ...FAKE_SECRETS_CONFIG,
    approval: { default: "per-use", writeHosts: "per-use" },
    lease: { ttlSeconds: 60, maxUses: 3 },
  }));
  expect(port.newMeta(nameOf("exa-key"))).toEqual({
    name: nameOf("exa-key"),
    desc: "exa-key",
    provider: "sops",
    ref: "dev/EXA_KEY",
    scope: "user",
    expiresAt: null,
    use: { modes: [], tools: [], hosts: [] },
    approval: "per-use",
    ttlSeconds: 60,
    maxUses: 3,
  });
});

test("a new secret has nowhere to go without a SOPS file, or with a default provider whose ref rule is unknown", () => {
  const admin = createFakeSecrets().port.admin;
  expect(createSecretsPort(admin, () => DEFAULT_SECRETS_CONFIG).newMeta(nameOf("exa-key"))).toBe(
    undefined,
  );
  expect(
    createSecretsPort(admin, () => ({ ...FAKE_SECRETS_CONFIG, defaultProvider: "op" })).newMeta(
      nameOf("exa-key"),
    ),
  ).toBe(undefined);
});

test("settingKeysReferencing lists the secret setting keys whose effective value is the handle", async () => {
  const group = defineSettings("l4.cli", {
    exaKey: {
      type: SecretRef,
      secret: true,
      runtimeChange: "live",
      allowedScopes: ["user"],
      since: "0.1.0",
    },
    otherKey: {
      type: SecretRef,
      secret: true,
      runtimeChange: "live",
      allowedScopes: ["user"],
      since: "0.1.0",
    },
  });
  const built = buildEngineCatalog([group]);
  if (!built.ok) throw new Error("the catalog must build");
  const settings = createSettingsEngine(built.catalog);
  const path = join(scratch, "settings.json");
  writeFileSync(
    path,
    JSON.stringify({
      "l4.cli.exaKey": "secret://exa-key",
      "l4.cli.otherKey": "secret://github-token",
    }),
  );
  await settings.loadUserFile(path);
  expect(settingKeysReferencing(settings, secretRef("exa-key"))).toEqual(["l4.cli.exaKey"]);
  expect(settingKeysReferencing(settings, secretRef("unused-key"))).toEqual([]);
});
