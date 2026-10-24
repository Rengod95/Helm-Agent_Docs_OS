import { describe, expect, test } from "bun:test";
import { SENSITIVE_ENV_PATTERNS } from "@xeon/contracts/services";
import { BASE_ENV_POLICY, buildChildEnv, isDeniedEnvName } from "../src/env-builder.ts";

const parent = {
  PATH: "/usr/bin",
  HOME: "/home/u",
  GITHUB_TOKEN: "x",
  SOPS_AGE_KEY: "y",
  OP_SESSION_z: "w",
  FOO: "1",
};

function build(overrides: Partial<Parameters<typeof buildChildEnv>[0]> = {}) {
  return buildChildEnv({
    parent,
    policy: BASE_ENV_POLICY,
    extraPass: [],
    requested: undefined,
    inherit: true,
    ...overrides,
  });
}

describe("buildChildEnv", () => {
  test("env allowlist passes only listed names", () => {
    const built = build();
    expect(built.ok && built.value).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/u",
      TERM: "dumb",
      NO_COLOR: "1",
      CI: "1",
      LANG: "C.UTF-8",
    });
    const extra = build({ extraPass: ["FOO"] });
    expect(extra.ok && extra.value["FOO"]).toBe("1");
    expect(extra.ok && Object.keys(extra.value).toSorted()).toEqual([
      "CI",
      "FOO",
      "HOME",
      "LANG",
      "NO_COLOR",
      "PATH",
      "TERM",
    ]);
  });

  test("env allowlist applies fixed values", () => {
    const fromParent = build({ parent: { LANG: "ko_KR.UTF-8", TERM: "xterm" } });
    expect(fromParent.ok && fromParent.value).toEqual({
      LANG: "ko_KR.UTF-8",
      TERM: "dumb",
      NO_COLOR: "1",
      CI: "1",
    });
    const noLang = build({ parent: {} });
    expect(noLang.ok && noLang.value["LANG"]).toBe("C.UTF-8");
  });

  test("env request adds names and overrides fixed values", () => {
    const built = build({ requested: { EXTRA: "v", CI: "0" } });
    expect(built.ok && built.value["EXTRA"]).toBe("v");
    expect(built.ok && built.value["CI"]).toBe("0");
  });

  test("env request with a denied name fails before spawn", () => {
    for (const name of [
      "AWS_SECRET_ACCESS_KEY",
      "GITHUB_TOKEN",
      "SOPS_AGE_KEY",
      "node_options",
      "XEON_SECRET_X",
    ]) {
      const built = build({ requested: { [name]: "v" } });
      expect(built).toEqual({ ok: false, error: { kind: "env_denied", names: [name] } });
    }
  });

  test("env request with an unusable name is refused", () => {
    const built = build({ requested: { "A=B": "v", "": "v" } });
    expect(built.ok).toBe(false);
  });

  test("inheritEnv false never copies parent", () => {
    const built = build({ inherit: false, extraPass: ["FOO"] });
    expect(built.ok && built.value).toEqual({
      TERM: "dumb",
      NO_COLOR: "1",
      CI: "1",
      LANG: "C.UTF-8",
    });
    const withRequest = build({ inherit: false, requested: { ONLY: "1" } });
    expect(withRequest.ok && withRequest.value["ONLY"]).toBe("1");
    expect(withRequest.ok && "PATH" in withRequest.value).toBe(false);
  });

  test("a denied name in extraPass is never copied", () => {
    const built = build({ extraPass: ["GITHUB_TOKEN", "SOPS_AGE_KEY"] });
    expect(built.ok && "GITHUB_TOKEN" in built.value).toBe(false);
    expect(built.ok && "SOPS_AGE_KEY" in built.value).toBe(false);
  });

  test("the policy deny list is the shared F constant", () => {
    expect(BASE_ENV_POLICY.deny).toBe(SENSITIVE_ENV_PATTERNS);
  });

  test("isDeniedEnvName matches wildcard patterns at either end", () => {
    expect(isDeniedEnvName("GH_TOKEN", SENSITIVE_ENV_PATTERNS)).toBe(true);
    expect(isDeniedEnvName("OP_SERVICE_ACCOUNT_TOKEN", SENSITIVE_ENV_PATTERNS)).toBe(true);
    expect(isDeniedEnvName("BW_SESSION", SENSITIVE_ENV_PATTERNS)).toBe(true);
    expect(isDeniedEnvName("PATH", SENSITIVE_ENV_PATTERNS)).toBe(false);
    expect(isDeniedEnvName("TOKENIZER", SENSITIVE_ENV_PATTERNS)).toBe(false);
    expect(isDeniedEnvName("A.B", ["A.B"])).toBe(true);
    expect(isDeniedEnvName("AxB", ["A.B"])).toBe(false);
  });
});
