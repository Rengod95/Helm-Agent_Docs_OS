import { describe, expect, test } from "bun:test";
import {
  buildPlainEnv,
  buildSopsEnv,
  filterSensitiveEnv,
  isSensitiveEnvName,
} from "../src/env-filter.ts";

const PARENT: Record<string, string | undefined> = {
  PATH: "/usr/bin:/bin",
  HOME: "/home/test",
  LANG: "C.UTF-8",
  SOPS_AGE_KEY: "parent-leak",
  SOPS_AGE_KEY_FILE: "/parent/keys",
  SOPS_AGE_KEY_CMD: "parent cmd",
  AGE_X: "x",
  OP_SERVICE_ACCOUNT_TOKEN: "x",
  BWS_ACCESS_TOKEN: "x",
  BW_SESSION: "x",
  XEON_SECRET_GITHUB_TOKEN: "x",
  GITHUB_TOKEN: "x",
  EXA_API_KEY: "x",
  UNDEFINED_ONE: undefined,
};

describe("sops invocation env (spec §4.5, §9 1번)", () => {
  test("strips SOPS_AGE_ and provider tokens", () => {
    const names = [
      "SOPS_AGE_KEY_CMD",
      "SOPS_AGE_KEY_FILE",
      "SOPS_AGE_KEY",
      "AGE_X",
      "OP_SERVICE_ACCOUNT_TOKEN",
      "BWS_ACCESS_TOKEN",
      "BW_SESSION",
      "XEON_SECRET_X",
      "GITHUB_TOKEN",
      "EXA_API_KEY",
      "ssh_auth_sock",
    ];
    for (const name of names) expect(isSensitiveEnvName(name)).toBe(true);
    expect(isSensitiveEnvName("PATH")).toBe(false);
    expect(isSensitiveEnvName("HOME")).toBe(false);
    const filtered = filterSensitiveEnv(PARENT);
    expect(Object.keys(filtered).toSorted()).toEqual(["HOME", "LANG", "PATH"]);
  });

  test("sops env carries exactly one key variable", () => {
    const withCmd = buildSopsEnv(PARENT, { SOPS_AGE_KEY_CMD: "secret-tool lookup" });
    expect(Object.keys(withCmd).toSorted()).toEqual(["HOME", "LANG", "PATH", "SOPS_AGE_KEY_CMD"]);
    expect(withCmd["SOPS_AGE_KEY_CMD"]).toBe("secret-tool lookup");

    const withFile = buildSopsEnv(PARENT, { SOPS_AGE_KEY_FILE: "/k/keys.txt" });
    expect(Object.keys(withFile).filter((n) => n.startsWith("SOPS_"))).toEqual([
      "SOPS_AGE_KEY_FILE",
    ]);

    const both = buildSopsEnv(PARENT, { SOPS_AGE_KEY_CMD: "a", SOPS_AGE_KEY_FILE: "b" });
    expect(Object.keys(both).filter((n) => n.startsWith("SOPS_"))).toHaveLength(1);

    const none = buildSopsEnv(PARENT, {});
    expect(Object.keys(none).some((n) => n.startsWith("SOPS_"))).toBe(false);
    expect(Object.keys(buildPlainEnv(PARENT)).some((n) => n.startsWith("SOPS_"))).toBe(false);
  });

  test("does not mutate the parent env", () => {
    const copy = { ...PARENT };
    buildSopsEnv(PARENT, { SOPS_AGE_KEY_FILE: "/k" });
    expect(PARENT).toEqual(copy);
  });
});
