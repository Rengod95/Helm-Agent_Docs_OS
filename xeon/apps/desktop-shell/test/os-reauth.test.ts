import { describe, expect, test } from "bun:test";
import { type CommandRegistry, createCommandRegistry } from "../src/main/commands.ts";
import type { IpcCaller, ShellContext } from "../src/main/context.ts";
import { kindOfLaCode, MacSecurityError, reasonText } from "mac-security";
import {
  createOsReauthModule,
  type OsReauthPorts,
  promptText,
  reauthKindOf,
} from "../src/main/os-reauth.ts";
import { loadMacSecurity, macSecuritySpecifier } from "../src/main/lib/mac-security.ts";

/** 시험의 현재 시각. 실제 시계가 아니라 주입한 값이 그대로 나오는지 본다 */
const NOW = 1_792_800_000_123;

/** `register`가 쓰는 것은 `handle`뿐이다. 나머지 자리는 쓰지 않는 빈 구현이다 */
function contextWith(registry: CommandRegistry): ShellContext {
  return {
    env: {},
    platform: "darwin",
    paths: { userData: "", configDir: "", logs: "", resources: "", ui: "" },
    dialogs: {
      openFolder: () => Promise.resolve(null),
      openFile: () => Promise.resolve(null),
      saveFile: () => Promise.resolve(null),
    },
    openExternal: () => Promise.resolve(),
    handle: (command, handler) => {
      registry.handle(command, handler);
    },
    channel: () => null,
    emit: () => {},
    showMainWindow: () => {},
    onQuit: () => {},
    handleScheme: () => undefined,
    windows: () => [],
    windowOptions: () => undefined,
    onWindow: () => undefined,
  };
}

interface SetupOptions {
  platform?: NodeJS.Platform;
  canPrompt?: () => boolean;
  prompt?: (reason: string) => Promise<void>;
}

/** 명령을 등록부에 올리고, 호출 기록을 남기는 가짜 포트를 붙인다 */
function setup(options: SetupOptions = {}) {
  const prompts: string[] = [];
  const logs: string[] = [];
  const counts = { canPrompt: 0 };
  const ports: OsReauthPorts = {
    platform: options.platform ?? "darwin",
    canAuthenticate: () => {
      counts.canPrompt += 1;
      return options.canPrompt?.() ?? true;
    },
    authenticate: (reason) => {
      prompts.push(reason);
      return options.prompt?.(reason) ?? Promise.resolve();
    },
    now: () => NOW,
    log: (line) => {
      logs.push(line);
    },
  };
  const registry = createCommandRegistry();
  createOsReauthModule(ports).register(contextWith(registry));
  const caller: IpcCaller = { sender: Object.create(null) };
  return {
    prompts,
    logs,
    counts,
    dispatch: (args: unknown) => registry.dispatch(caller, "os_reauth", args),
  };
}

/** 거절된 인증 창의 답을 흉내 낸다. 애드온은 `kind`가 있는 `MacSecurityError`로 거절한다 */
function rejectWith(error: unknown): () => Promise<void> {
  return async () => {
    throw error;
  };
}

describe("prompt text", () => {
  test("keeps plain text and joins whitespace runs", () => {
    expect(promptText("  Show   the\tsecret\nvalue  ")).toBe("Show the secret value");
  });

  test("turns control characters into spaces", () => {
    expect(promptText("a\u001b[31mb")).toBe("a [31mb");
  });

  test("turns C1 control characters into spaces and collapses Unicode white space", () => {
    expect(promptText("x\u0085y\u009bz")).toBe("x y z");
    expect(promptText("a　b")).toBe("a b");
  });

  test("an empty or blank prompt falls back to the app name", () => {
    expect(promptText("")).toBe("Fresnel");
    expect(promptText("  \n\t ")).toBe("Fresnel");
    expect(promptText("\u0000\u0007")).toBe("Fresnel");
  });

  test("is clipped to 120 characters", () => {
    expect(promptText("a".repeat(200))).toBe("a".repeat(120));
  });

  test("counts characters, not bytes", () => {
    expect(promptText("가".repeat(130))).toBe("가".repeat(120));
  });

  test("counts code points, so a surrogate pair is never split", () => {
    expect(promptText("😀".repeat(130))).toBe("😀".repeat(120));
  });

  test("clipping does not leave a trailing space", () => {
    expect(promptText(`${"a".repeat(119)} b`)).toBe("a".repeat(119));
  });
});

describe("mac-security agreement", () => {
  test("promptText equals the module's reasonText", () => {
    const samples = [
      "  Show   the\tsecret\nvalue  ",
      "a\u001b[31mb",
      "x\u0085y\u009bz",
      "a　b",
      "",
      "  \n\t ",
      "a".repeat(200),
      "가".repeat(130),
      "😀".repeat(130),
      `${"a".repeat(119)} b`,
    ];
    expect(samples.map((text) => promptText(text))).toEqual(
      samples.map((text) => reasonText(text)),
    );
  });
});

describe("rejection kind", () => {
  test("the kind of a MacSecurityError is used as it is", () => {
    expect(reauthKindOf(new MacSecurityError("cancelled", -2))).toBe("cancelled");
    expect(reauthKindOf(new MacSecurityError("denied", -1))).toBe("denied");
    expect(reauthKindOf(new MacSecurityError("unavailable", -5))).toBe("unavailable");
    expect(reauthKindOf(new MacSecurityError("failed", -1000))).toBe("failed");
  });

  test("the module's LAError mapping reaches the command as the same kind", () => {
    const codes = [-1, -2, -3, -4, -5, -6, -7, -8, -9, -1004, -1000, 7];
    expect(
      codes.map((code) => reauthKindOf(new MacSecurityError(kindOfLaCode(code), code))),
    ).toEqual([
      "denied",
      "cancelled",
      "cancelled",
      "cancelled",
      "unavailable",
      "unavailable",
      "unavailable",
      "unavailable",
      "cancelled",
      "unavailable",
      "failed",
      "failed",
    ]);
  });

  test("a value without a known kind is failed", () => {
    expect(reauthKindOf(new Error("User canceled the authentication"))).toBe("failed");
    expect(reauthKindOf({ kind: "weird" })).toBe("failed");
    expect(reauthKindOf({ kind: 3 })).toBe("failed");
    expect(reauthKindOf("cancelled")).toBe("failed");
    expect(reauthKindOf(42)).toBe("failed");
    expect(reauthKindOf(null)).toBe("failed");
    expect(reauthKindOf(undefined)).toBe("failed");
  });
});

describe("addon loading", () => {
  const api = { canAuthenticate: () => ({ available: true }), authenticate: async () => {} };

  test("a bundled copy under Resources wins, else the module name is used", () => {
    expect(macSecuritySpecifier("/R", (file) => file === "/R/mac-security/index.js")).toBe(
      "/R/mac-security/index.js",
    );
    expect(macSecuritySpecifier("/R", () => false)).toBe("mac-security");
  });

  test("the chosen specifier is loaded and a good module is returned", () => {
    const seen: string[] = [];
    const loaded = loadMacSecurity(
      "/R",
      (specifier) => {
        seen.push(specifier);
        return api;
      },
      () => true,
    );
    expect(seen).toEqual(["/R/mac-security/index.js"]);
    expect(loaded?.canAuthenticate()).toEqual({ available: true });
  });

  test("a load failure or a wrong shape gives null, never a throw", () => {
    const fail = loadMacSecurity(
      "/R",
      () => {
        throw new Error("dlopen failed");
      },
      () => false,
    );
    expect(fail).toBeNull();
    expect(
      loadMacSecurity(
        "/R",
        () => ({ canAuthenticate: 1 }),
        () => false,
      ),
    ).toBeNull();
    expect(
      loadMacSecurity(
        "/R",
        () => null,
        () => false,
      ),
    ).toBeNull();
  });

  test("the real module in node_modules loads in development and has the documented shape", () => {
    const loaded = loadMacSecurity("/nonexistent-resources");
    if (process.platform === "darwin") {
      expect(loaded).not.toBeNull();
      expect(typeof loaded?.canAuthenticate().available).toBe("boolean");
    } else {
      expect(loaded?.canAuthenticate().available ?? false).toBe(false);
    }
  });
});

describe("os_reauth command", () => {
  test("non-macOS is unavailable and never prompts", async () => {
    const platforms: NodeJS.Platform[] = ["linux", "win32"];
    const runs = platforms.map((platform) => setup({ platform }));
    const replies = await Promise.all(runs.map((run) => run.dispatch({ reason: "Show it" })));
    expect(replies).toEqual(platforms.map(() => ({ ok: false, error: { kind: "unavailable" } })));
    expect(runs.map((run) => run.prompts)).toEqual(platforms.map(() => []));
    expect(runs.map((run) => run.counts.canPrompt)).toEqual(platforms.map(() => 0));
    expect(runs.map((run) => run.logs)).toEqual(platforms.map(() => ["os reauth: unavailable"]));
  });

  test("without an available authenticator the answer is unavailable and nothing is shown", async () => {
    const run = setup({ canPrompt: () => false });
    expect(await run.dispatch({ reason: "Show it" })).toEqual({
      ok: false,
      error: { kind: "unavailable" },
    });
    expect(run.prompts).toEqual([]);
    expect(run.logs).toEqual(["os reauth: unavailable"]);
  });

  test("success returns the injected time and passes the cleaned prompt", async () => {
    const run = setup();
    expect(await run.dispatch({ reason: "  Show   the\tsecret  " })).toEqual({
      ok: true,
      value: { verifiedAtMs: NOW },
    });
    expect(run.prompts).toEqual(["Show the secret"]);
    expect(run.logs).toEqual(["os reauth: ok"]);
  });

  test("a cancelled prompt is rejected with cancelled", async () => {
    const run = setup({ prompt: rejectWith(new MacSecurityError("cancelled", -2)) });
    expect(await run.dispatch({ reason: "Show it" })).toEqual({
      ok: false,
      error: { kind: "cancelled" },
    });
    expect(run.logs).toEqual(["os reauth: cancelled"]);
  });

  test("a denied prompt is rejected with denied", async () => {
    const run = setup({ prompt: rejectWith(new MacSecurityError("denied", -1)) });
    expect(await run.dispatch({ reason: "Show it" })).toEqual({
      ok: false,
      error: { kind: "denied" },
    });
    expect(run.logs).toEqual(["os reauth: denied"]);
  });

  test("an unavailable prompt is rejected with unavailable", async () => {
    const run = setup({ prompt: rejectWith(new MacSecurityError("unavailable", -7)) });
    expect(await run.dispatch({ reason: "Show it" })).toEqual({
      ok: false,
      error: { kind: "unavailable" },
    });
    expect(run.logs).toEqual(["os reauth: unavailable"]);
  });

  test("an unknown prompt failure is rejected with failed", async () => {
    const run = setup({ prompt: rejectWith(new Error("something unexpected")) });
    expect(await run.dispatch({ reason: "Show it" })).toEqual({
      ok: false,
      error: { kind: "failed" },
    });
    expect(run.logs).toEqual(["os reauth: failed"]);
  });

  test("a throw from the availability check is failed", async () => {
    const run = setup({
      canPrompt: () => {
        throw new Error("boom");
      },
    });
    expect(await run.dispatch({ reason: "Show it" })).toEqual({
      ok: false,
      error: { kind: "failed" },
    });
    expect(run.prompts).toEqual([]);
    expect(run.logs).toEqual(["os reauth: failed"]);
  });

  test("the log never contains the reason text", async () => {
    const reason = "시크릿-이름 SECRET_NAME_42";
    const okRun = setup();
    await okRun.dispatch({ reason });
    expect(okRun.prompts).toEqual(["시크릿-이름 SECRET_NAME_42"]);
    expect(okRun.logs).toEqual(["os reauth: ok"]);

    const failRun = setup({ prompt: rejectWith(new MacSecurityError("cancelled", -2)) });
    await failRun.dispatch({ reason });
    expect(failRun.logs).toEqual(["os reauth: cancelled"]);
    expect(failRun.logs.join("\n")).not.toContain("SECRET_NAME_42");
  });

  test("malformed args are bad-request and nothing runs", async () => {
    const inputs: unknown[] = [undefined, null, "text", {}, { reason: 5 }, { reason: null }];
    const cases = inputs.map((args) => {
      const run = setup();
      return { run, reply: run.dispatch(args) };
    });
    const replies = await Promise.all(cases.map((item) => item.reply));
    expect(replies).toEqual(inputs.map(() => ({ ok: false, error: "bad-request" })));
    expect(cases.map((item) => item.run.prompts)).toEqual(inputs.map(() => []));
    expect(cases.map((item) => item.run.counts.canPrompt)).toEqual(inputs.map(() => 0));
    expect(cases.map((item) => item.run.logs)).toEqual(inputs.map(() => []));
  });
});
