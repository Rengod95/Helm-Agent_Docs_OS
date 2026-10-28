import { describe, expect, test } from "bun:test";
import { secretRef } from "@xeon/contracts/capabilities";
import type { SecretEnvRequest } from "@xeon/contracts/services";
import { acquireSecretEnv, commandTarget } from "../src/secret-env.ts";
import { fakeSecrets } from "./support/fake-secrets.ts";

const ctx: SecretEnvRequest["ctx"] = {
  purpose: "bash:gh",
  actor: "agent",
  threadId: null,
  toolCallId: "call-1",
  projectId: null,
  approval: null,
};

const SECRET_VALUE = "ghp_super_secret_value_1234";

function request(refs: Record<string, `secret://${string}`>): SecretEnvRequest {
  return { refs, ctx };
}

describe("acquireSecretEnv", () => {
  test("secretEnv leases every ref and fills mode target from the command", async () => {
    const secrets = fakeSecrets({ gh: SECRET_VALUE, other: "other_value_12345" });
    const leased = await acquireSecretEnv({
      request: request({ GH_TOKEN: "secret://gh", OTHER: "secret://other" }),
      command: "gh api user",
      secrets,
      signal: undefined,
    });
    expect(leased.ok && leased.value.values).toEqual({
      GH_TOKEN: SECRET_VALUE,
      OTHER: "other_value_12345",
    });
    expect(secrets.acquired()).toBe(2);
    expect(secrets.calls[0]).toEqual({
      handle: secretRef("gh"),
      ctx: { ...ctx, target: { kind: "command", argv0: "gh", commandLine: "gh api user" } },
    });
    if (!leased.ok) return;
    leased.value.dispose();
    expect(secrets.disposed()).toBe(2);
    expect(leased.value.values).toEqual({});
    leased.value.dispose();
    expect(secrets.disposed()).toBe(2);
  });

  test("two env names for one handle lease it once, even when a lease allows one use", async () => {
    const secrets = fakeSecrets({ gh: SECRET_VALUE, other: "other_value_12345" }, { maxUses: 1 });
    const leased = await acquireSecretEnv({
      request: request({
        GH_TOKEN: "secret://gh",
        GITHUB_TOKEN: "secret://gh",
        OTHER: "secret://other",
      }),
      command: "gh api user",
      secrets,
      signal: undefined,
    });
    expect(leased.ok && leased.value.values).toEqual({
      GH_TOKEN: SECRET_VALUE,
      GITHUB_TOKEN: SECRET_VALUE,
      OTHER: "other_value_12345",
    });
    expect(secrets.calls.map((call) => call.handle)).toEqual([secretRef("gh"), secretRef("other")]);
    expect(secrets.acquired()).toBe(2);
    if (!leased.ok) return;
    leased.value.dispose();
    expect(secrets.disposed()).toBe(2);
    expect(leased.value.values).toEqual({});
  });

  test("secretEnv failure disposes acquired leases", async () => {
    const secrets = fakeSecrets(
      { gh: SECRET_VALUE, other: "other_value_12345" },
      { missing: ["other"] },
    );
    const leased = await acquireSecretEnv({
      request: request({ GH_TOKEN: "secret://gh", OTHER: "secret://other" }),
      command: ["gh", "api"],
      secrets,
      signal: undefined,
    });
    expect(leased.ok).toBe(false);
    if (leased.ok) return;
    expect(leased.error.code).toBe("secret_unavailable");
    expect(secrets.acquired()).toBe(1);
    expect(secrets.disposed()).toBe(1);
  });

  test("missing secrets service rejects secretEnv", async () => {
    const leased = await acquireSecretEnv({
      request: request({ GH_TOKEN: "secret://gh" }),
      command: "gh",
      secrets: undefined,
      signal: undefined,
    });
    expect(leased.ok).toBe(false);
    if (leased.ok) return;
    expect(leased.error.code).toBe("secret_unavailable");
    expect(leased.error.message).toContain("secret://gh");
  });

  test("an empty refs map needs no service", async () => {
    const leased = await acquireSecretEnv({
      request: request({}),
      command: "true",
      secrets: undefined,
      signal: undefined,
    });
    expect(leased.ok && leased.value.values).toEqual({});
  });

  test("an invalid reference or env name is refused without leasing", async () => {
    const secrets = fakeSecrets({ gh: SECRET_VALUE });
    const badRef = await acquireSecretEnv({
      request: request({ GH_TOKEN: "secret://BAD NAME" }),
      command: "gh",
      secrets,
      signal: undefined,
    });
    expect(!badRef.ok && badRef.error.code).toBe("secret_unavailable");
    const badName = await acquireSecretEnv({
      request: request({ "A=B": "secret://gh" }),
      command: "gh",
      secrets,
      signal: undefined,
    });
    expect(!badName.ok && badName.error.code).toBe("env_denied");
    expect(secrets.calls).toEqual([]);
  });

  test("an already aborted signal stops before any lease and a later abort disposes", async () => {
    const secrets = fakeSecrets({ gh: SECRET_VALUE });
    const controller = new AbortController();
    controller.abort();
    const leased = await acquireSecretEnv({
      request: request({ GH_TOKEN: "secret://gh" }),
      command: "gh",
      secrets,
      signal: controller.signal,
    });
    expect(!leased.ok && leased.error.code).toBe("aborted");
    expect(secrets.acquired()).toBe(0);
  });

  test("secret value never appears in error messages", async () => {
    const secrets = fakeSecrets(
      { gh: SECRET_VALUE, other: "other_value_12345" },
      { missing: ["other"] },
    );
    const leased = await acquireSecretEnv({
      request: request({ GH_TOKEN: "secret://gh", OTHER: "secret://other" }),
      command: "gh",
      secrets,
      signal: undefined,
    });
    expect(!leased.ok && leased.error.message).not.toContain(SECRET_VALUE);
    expect(!leased.ok && JSON.stringify(leased.error)).not.toContain(SECRET_VALUE);
  });
});

describe("commandTarget", () => {
  test("derives argv0 and the command line from strings and argv", () => {
    expect(commandTarget("  gh   api user ")).toEqual({
      kind: "command",
      argv0: "gh",
      commandLine: "gh   api user",
    });
    expect(commandTarget(["curl", "-s", "https://example.com"])).toEqual({
      kind: "command",
      argv0: "curl",
      commandLine: "curl -s https://example.com",
    });
    expect(commandTarget([])).toEqual({ kind: "command", argv0: "", commandLine: "" });
  });
});
