import { describe, expect, test } from "bun:test";
import { err, ok, parse, type Result } from "@fresnel/contracts";
import { SecretNameSchema, type SecretName } from "@fresnel/contracts/capabilities";
import type { BridgeBackendDeps, PluginShellCommand } from "../../src/plugin-ui/backend.ts";
import { createBridgeBackend } from "../../src/plugin-ui/backend.ts";
import { policyContextOf } from "../../src/plugin-ui/policy-context.ts";
import { fakeConnection, type Table } from "../state/fake-connection.ts";
import { extGetOf, uiEntryOf } from "./support.ts";

// 셸 기능 op의 백엔드(ADR-0021 §3.4.3): 셸 명령 답을 다리 값으로 바꾸고, 경로와 오류 원문은 프레임에 주지 않는다

const snapshot = {
  threadId: undefined,
  threadTitle: undefined,
  connection: "connected" as const,
  locale: "ko",
  theme: "dark" as const,
  extension: { enabled: true, trust: "user" as const, safeMode: false },
};

function nameOf(text: string): SecretName {
  const parsed = parse(SecretNameSchema, text);
  if (!parsed.ok) throw new Error("fixture name must parse");
  return parsed.value;
}

interface ShellLog {
  readonly commands: { command: PluginShellCommand; args: unknown }[];
  readonly secrets: { name: string; action: string; value: string }[];
  /** 부른 직후의 값 바이트. 부른 뒤 0으로 덮였는지 본다 */
  readonly secretBytes: Uint8Array[];
}

function harness(
  replies: Partial<Record<PluginShellCommand, unknown>>,
  table: Table = {},
  options: { reject?: unknown; secretResult?: Result<null, unknown>; noShell?: boolean } = {},
) {
  const log: ShellLog = { commands: [], secrets: [], secretBytes: [] };
  const fake = fakeConnection(table);
  const built = policyContextOf({
    get: extGetOf(),
    entry: uiEntryOf(),
    openThreadId: undefined,
    commands: [],
  });
  if (!built.ok) throw new Error("the fixture manifest must parse");
  const policy = built.value;
  const deps: BridgeBackendDeps = {
    connection: () => fake.connection,
    extension: "helm",
    screen: "status",
    openThreadId: () => undefined,
    policy: () => policy,
    snapshot: () => snapshot,
    navigate: () => false,
    openExternal: () => Promise.resolve(),
    resize: () => {},
    diagnostic: () => {},
    shell: options.noShell
      ? undefined
      : {
          invoke: (command, args) => {
            log.commands.push({ command, args });
            // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- 셸은 문자열 코드와 `{kind}` 값으로 거부한다 (L4.desktop.spec §11.1)
            if (options.reject !== undefined) return Promise.reject(options.reject);
            return Promise.resolve(replies[command]);
          },
          registerSecret: (name, action, value) => {
            log.secrets.push({ name, action, value: new TextDecoder().decode(value) });
            log.secretBytes.push(value);
            return Promise.resolve(options.secretResult ?? ok(null));
          },
        },
  };
  return { backend: createBridgeBackend(deps), log, calls: fake.calls };
}

function setting(key: string, value: unknown) {
  return {
    key,
    value,
    source: { scope: "user" as const },
    locked: false,
    shadowed: [],
    runtimeChange: "live" as const,
    pendingUntil: null,
    deprecated: false,
  };
}
function def(key: string, secret: boolean) {
  return {
    key,
    type: { type: "string" },
    runtimeChange: "live" as const,
    layer: "L3" as const,
    allowedScopes: ["user" as const],
    since: "0.1.0",
    secret,
  };
}

describe("files", () => {
  test("pickFile gives name and content; pickFolder gives only the last path segment", async () => {
    const h = harness({
      pick_file_read: { name: "a.md", content: "hi" },
      pick_folder: "/Users/me/projects/docs/",
    });
    expect(await h.backend.pickFile()).toEqual(ok({ name: "a.md", content: "hi" }));
    expect(await h.backend.pickFolder()).toEqual(ok({ name: "docs" }));
    // 폴더 경로의 앞부분은 프레임에 가지 않는다
    expect(JSON.stringify(await h.backend.pickFolder())).not.toContain("Users");
  });

  test("a cancelled dialog is null", async () => {
    const h = harness({ pick_file_read: null, pick_folder: null, save_file: null });
    expect(await h.backend.pickFile()).toEqual(ok(null));
    expect(await h.backend.pickFolder()).toEqual(ok(null));
    expect(await h.backend.saveFile("a.md", "x")).toEqual(ok({ saved: false }));
  });

  test("saveFile sends only the suggested name and content and hides the chosen path", async () => {
    const h = harness({ save_file: "/Users/me/secret-folder/a.md" });
    const result = await h.backend.saveFile("a.md", "body");
    expect(result).toEqual(ok({ saved: true }));
    expect(h.log.commands).toEqual([
      { command: "save_file", args: { suggestedName: "a.md", content: "body" } },
    ]);
    expect(JSON.stringify(result)).not.toContain("secret-folder");
  });

  test("a shell code is passed on, any other rejection is hidden, and a missing shell is unavailable", async () => {
    expect(await harness({}, {}, { reject: "too-large" }).backend.pickFile()).toEqual(
      err({ kind: "too_large" }),
    );
    expect(await harness({}, {}, { reject: "not-text" }).backend.pickFile()).toEqual(
      err({ kind: "failed", detail: "not-text" }),
    );
    expect(
      await harness({}, {}, { reject: { kind: "x", path: "/Users/me/leak" } }).backend.pickFile(),
    ).toEqual(err({ kind: "failed", detail: "shell" }));
    expect(await harness({}, {}, { noShell: true }).backend.pickFile()).toEqual(
      err({ kind: "failed", detail: "shell_unavailable" }),
    );
    expect(await harness({ pick_file_read: { name: 1 } }).backend.pickFile()).toEqual(
      err({ kind: "failed", detail: "shell_reply" }),
    );
  });
});

describe("notify", () => {
  test("shown, denied by the OS, and not shown map to distinct answers", async () => {
    const shown = harness({ notify_os: { kind: "shown" } });
    expect(await shown.backend.notify("helm · t", "b")).toEqual(ok({ shown: true }));
    expect(shown.log.commands).toEqual([
      { command: "notify_os", args: { title: "helm · t", body: "b" } },
    ]);
    expect(await harness({ notify_os: { kind: "denied" } }).backend.notify("t", "")).toEqual(
      err({ kind: "denied", detail: "os_denied" }),
    );
    expect(await harness({ notify_os: { kind: "failed" } }).backend.notify("t", "")).toEqual(
      err({ kind: "failed", detail: "not_shown" }),
    );
  });
});

const set = (key: string) => ({
  "settings.list": () =>
    Promise.resolve({ defs: [def("ext.helm.model", false), def("ext.helm.token", true)] }),
  "settings.set": () => Promise.resolve({ setting: setting(key, "v") }),
});

describe("writeSetting", () => {
  test("a plain defined key is written in the user scope", async () => {
    const h = harness({}, set("ext.helm.model"));
    expect(await h.backend.writeSetting("ext.helm.model", "gpt-y")).toEqual(ok(null));
    expect(h.calls.map((call) => call.method)).toEqual(["settings.list", "settings.set"]);
    expect(h.calls[1]?.params).toEqual({ key: "ext.helm.model", value: "gpt-y", scope: "user" });
  });

  test("a secret key and an unknown key are refused without writing", async () => {
    const h = harness({}, set("ext.helm.token"));
    expect(await h.backend.writeSetting("ext.helm.token", "v")).toEqual(
      err({ kind: "denied", detail: "setting_secret" }),
    );
    expect(await h.backend.writeSetting("ext.helm.nothing", "v")).toEqual(
      err({ kind: "denied", detail: "setting_secret" }),
    );
    expect(h.calls.map((call) => call.method)).toEqual(["settings.list", "settings.list"]);
  });
});

describe("secrets", () => {
  test("secretExists reads the name list and registerSecret picks add or set, then wipes the value bytes", async () => {
    const h = harness(
      {},
      {
        "secret.list": () =>
          Promise.resolve({ secrets: [{ name: nameOf("ext--helm--token"), status: "valid" }] }),
      },
    );
    expect(await h.backend.secretExists("ext--helm--token")).toEqual(ok(true));
    expect(await h.backend.secretExists("ext--helm--other")).toEqual(ok(false));
    expect(await h.backend.registerSecret("ext--helm--token", "s3cret", true)).toEqual(ok(null));
    expect(await h.backend.registerSecret("ext--helm--other", "s3cret", false)).toEqual(ok(null));
    expect(h.log.secrets).toEqual([
      { name: "ext--helm--token", action: "set", value: "s3cret" },
      { name: "ext--helm--other", action: "add", value: "s3cret" },
    ]);
    expect(h.log.secretBytes.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
  });

  test("a shell rejection never carries its detail to the frame, and a bad name is refused", async () => {
    const h = harness(
      {},
      {},
      {
        secretResult: err({ kind: "rejected", exitCode: 1, detail: "leaks s3cret" }),
      },
    );
    const result = await h.backend.registerSecret("ext--helm--token", "s3cret", false);
    expect(result).toEqual(err({ kind: "failed", detail: "secret_register" }));
    expect(JSON.stringify(result)).not.toContain("s3cret");
    expect(await h.backend.registerSecret("Bad Name", "v", false)).toEqual(
      err({ kind: "args_invalid", detail: "secret_name" }),
    );
  });
});
