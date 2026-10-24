import { describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import { secretRef } from "@xeon/contracts/capabilities";
import {
  checkSecretArgument,
  checkSettingRef,
  findHandleTokens,
  handleForName,
  parseHandle,
} from "../src/ref.ts";

describe("secret reference input checks (spec §3.1)", () => {
  test("accepts secret://github-token", () => {
    const parsed = parseHandle("secret://github-token");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect<string>(parsed.value.name).toBe("github-token");
      expect(parsed.value.handle).toBe(secretRef("github-token"));
    }
  });

  test("rejects bad names and schemes", () => {
    const cases: readonly [string, string, string][] = [
      ["secret://a", "invalid_ref", "name_pattern"],
      ["secret://GitHub-Token", "invalid_ref", "name_pattern"],
      ["secret://github-token/extra", "invalid_ref", "trailing"],
      ["secrets://x-y", "invalid_ref", "scheme"],
      ["secret:x-y", "invalid_ref", "scheme"],
    ];
    for (const [input, kind, reason] of cases) {
      const parsed = parseHandle(input);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect<string>(parsed.error.kind).toBe(kind);
        expect(Reflect.get(parsed.error, "reason")).toBe(reason);
      }
    }
  });

  test("rejects foreign syntaxes", () => {
    const cases: readonly [string, string][] = [
      ["$GITHUB_TOKEN", "env_var"],
      ["${GITHUB_TOKEN}", "env_var"],
      ["{{secret:github-token}}", "template"],
      ["%github-token%", "percent"],
      ["op://vault/item/field", "provider_uri"],
      ["sops:dev/KEY", "provider_uri"],
    ];
    for (const [input, syntax] of cases) {
      const parsed = parseHandle(input);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.kind).toBe("unsupported_ref_syntax");
        expect(Reflect.get(parsed.error, "syntax")).toBe(syntax);
      }
    }
  });

  test("secretRef throws Bug on invalid name", () => {
    expect(() => secretRef("exa_key")).toThrow(Bug);
  });

  test("meta names and setting values go through the same F parser", () => {
    expect(handleForName("github-token").ok).toBe(true);
    expect(handleForName("Github").ok).toBe(false);
    expect(handleForName("a/b").ok).toBe(false);
    expect(checkSettingRef("secret://exa-key").ok).toBe(true);
    expect(checkSettingRef("exa-key").ok).toBe(false);
  });

  test("secret argument fields reject embedded foreign syntax", () => {
    const embedded = checkSecretArgument("Bearer $TOKEN");
    expect(embedded.ok).toBe(false);
    if (!embedded.ok) expect(embedded.error.kind).toBe("unsupported_ref_syntax");
    expect(checkSecretArgument("secret://exa-key").ok).toBe(true);
  });

  test("finds handle tokens inside text and keeps path characters so they are rejected", () => {
    expect(findHandleTokens('{"k":"secret://a-b","n":"secret://c-d."}')).toEqual([
      "secret://a-b",
      "secret://c-d",
    ]);
    const tokens = findHandleTokens("x secret://exa-key/extra y");
    expect(tokens).toEqual(["secret://exa-key/extra"]);
    const first = tokens[0] ?? "";
    expect(parseHandle(first).ok).toBe(false);
  });
});
