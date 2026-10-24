import { describe, expect, test } from "bun:test";
import { Bug, parse } from "../../src/index.ts";
import {
  SECRET_NAME_PATTERN,
  SECRET_REF_PATTERN,
  SecretMetaSchema,
  SecretNameSchema,
  SecretRef,
  SecretUsePolicySchema,
  findForeignSecretSyntax,
  parseSecretRef,
  secretRef,
  type SecretRefError,
} from "../../src/capabilities/index.ts";

describe("parseSecretRef", () => {
  test("accepts secret://github-token", () => {
    const result = parseSecretRef("secret://github-token");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const name: string = result.value.name;
      const handle: string = result.value.handle;
      expect(name).toBe("github-token");
      expect(handle).toBe("secret://github-token");
    }
  });

  const rejections: readonly (readonly [string, SecretRefError])[] = [
    ["secret://a", { kind: "invalid_ref", reason: "name_pattern" }],
    ["secret://A", { kind: "invalid_ref", reason: "name_pattern" }],
    ["secret://GitHub-Token", { kind: "invalid_ref", reason: "name_pattern" }],
    ["secret://github-token/extra", { kind: "invalid_ref", reason: "trailing" }],
    ["secret://github-token?x=1", { kind: "invalid_ref", reason: "trailing" }],
    ["secrets://x-y", { kind: "invalid_ref", reason: "scheme" }],
    ["secret:x-y", { kind: "invalid_ref", reason: "scheme" }],
    ["plain-text", { kind: "invalid_ref", reason: "scheme" }],
    ["$GITHUB_TOKEN", { kind: "unsupported_ref_syntax", syntax: "env_var" }],
    ["${GITHUB_TOKEN}", { kind: "unsupported_ref_syntax", syntax: "env_var" }],
    ["{{secret:github-token}}", { kind: "unsupported_ref_syntax", syntax: "template" }],
    ["%github-token%", { kind: "unsupported_ref_syntax", syntax: "percent" }],
    ["op://vault/item/field", { kind: "unsupported_ref_syntax", syntax: "provider_uri" }],
    ["sops:dev/KEY", { kind: "unsupported_ref_syntax", syntax: "provider_uri" }],
  ];
  for (const [input, error] of rejections) {
    test(`rejects ${input}`, () => {
      const result = parseSecretRef(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toEqual(error);
    });
  }

  test("is deterministic", () => {
    expect(parseSecretRef("secret://a-b")).toEqual(parseSecretRef("secret://a-b"));
  });
});

describe("secretRef", () => {
  test("builds a handle for a valid name and throws Bug otherwise", () => {
    const handle: string = secretRef("exa-key");
    expect(handle).toBe("secret://exa-key");
    expect(() => secretRef("A")).toThrow(Bug);
    expect(() => secretRef("a/b")).toThrow(Bug);
  });
});

describe("findForeignSecretSyntax", () => {
  test("finds template and provider_uri in one pass", () => {
    expect(findForeignSecretSyntax("{{token}} op://v/i")).toEqual([
      { kind: "unsupported_ref_syntax", syntax: "template" },
      { kind: "unsupported_ref_syntax", syntax: "provider_uri" },
    ]);
  });

  test("finds $VAR and %name% inside text, nothing for plain text or secret://", () => {
    expect(
      findForeignSecretSyntax("curl -H $TOKEN").map(
        (e) => e.kind === "unsupported_ref_syntax" && e.syntax,
      ),
    ).toEqual(["env_var"]);
    expect(findForeignSecretSyntax("path %temp%").length).toBe(1);
    expect(findForeignSecretSyntax("use secret://github-token please")).toEqual([]);
    expect(findForeignSecretSyntax("hello")).toEqual([]);
  });
});

describe("patterns and schemas", () => {
  test("SecretRef schema accepts secret://openai-key, rejects short and uppercase names", () => {
    expect(parse(SecretRef, "secret://openai-key").ok).toBe(true);
    expect(parse(SecretRef, "secret://a").ok).toBe(false);
    expect(parse(SecretRef, "secret://A-b").ok).toBe(false);
    expect(new RegExp(SECRET_REF_PATTERN).test("secret://openai-key")).toBe(true);
  });

  test("SecretNameSchema validates names and yields the branded type", () => {
    const parsed = parse(SecretNameSchema, "exa-key");
    expect(parsed.ok).toBe(true);
    expect(parse(SecretNameSchema, "Exa").ok).toBe(false);
    expect(new RegExp(SECRET_NAME_PATTERN).test("exa-key")).toBe(true);
  });
});

describe("meta schemas", () => {
  const policy = {
    modes: ["env"],
    tools: ["bash:gh"],
    hosts: [],
    commands: ["gh api *"],
  };
  const meta = {
    name: "github-token",
    desc: "GitHub personal access token",
    provider: "sops",
    ref: "dev/GITHUB_TOKEN",
    scope: "user",
    expiresAt: null,
    use: policy,
    approval: "per-use",
    ttlSeconds: 300,
    maxUses: 10,
  };

  test("a valid policy and meta pass", () => {
    expect(parse(SecretUsePolicySchema, policy).ok).toBe(true);
    expect(parse(SecretMetaSchema, meta).ok).toBe(true);
    expect(
      parse(SecretMetaSchema, { ...meta, scope: "project:/home/u/repo", expiresAt: "2027-01-31" })
        .ok,
    ).toBe(true);
  });

  test("bad values fail", () => {
    expect(parse(SecretUsePolicySchema, { ...policy, modes: ["env", "env"] }).ok).toBe(false);
    expect(parse(SecretUsePolicySchema, { ...policy, modes: ["nope"] }).ok).toBe(false);
    expect(
      parse(SecretUsePolicySchema, { ...policy, origins: ["http://insecure.example"] }).ok,
    ).toBe(false);
    expect(parse(SecretMetaSchema, { ...meta, ttlSeconds: 0 }).ok).toBe(false);
    expect(parse(SecretMetaSchema, { ...meta, provider: "vault" }).ok).toBe(false);
    expect(parse(SecretMetaSchema, { ...meta, scope: "team" }).ok).toBe(false);
    expect(parse(SecretMetaSchema, { ...meta, extra: 1 }).ok).toBe(false);
  });
});
