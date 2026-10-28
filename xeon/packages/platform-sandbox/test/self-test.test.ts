import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ok } from "@xeon/contracts";
import type { SelfTestItemId, Shell } from "@xeon/contracts/services";
import {
  runSelfTest,
  SELF_TEST_ITEM_IDS,
  isSensitiveEnvName,
  type SelfTestDeps,
} from "../src/self-test.ts";
import { manualClock, seededRandom } from "./support/clock.ts";
import {
  execFailure,
  makeTestDirs,
  memoryLogger,
  NO_CANCEL,
  recordingShell,
  selfTestShell,
  type TestDirs,
} from "./support/fakes.ts";

function deps(dirs: TestDirs): SelfTestDeps {
  return {
    dirs,
    clock: manualClock(),
    random: seededRandom(3),
    logger: memoryLogger(),
    // 감싸지 않고 통과시킨다. 시험 대역 Shell이 명령 텍스트로 동작을 정한다
    wrap: (shell) => shell,
    defaultPolicy: ({ workspaceRoots, tempDir }) => ({
      writeRoots: [...workspaceRoots, tempDir],
      readDeny: [],
      writeDeny: [],
      network: { allowedDomains: [], deniedDomains: [] },
      allowEscape: false,
    }),
  };
}

describe("self-test", () => {
  test("passes all six items when the sandbox behaves as expected", async () => {
    const dirs = makeTestDirs();
    const report = await runSelfTest(deps(dirs), selfTestShell(), NO_CANCEL);
    expect(report.passed).toBe(true);
    expect(report.items.map((item) => item.id)).toEqual([...SELF_TEST_ITEM_IDS]);
    expect(report.items.every((item) => item.passed)).toBe(true);
    expect(report.at).toBe(1767571200000);
    expect(report.durationMs).toBe(0);
  });

  test.each([...SELF_TEST_ITEM_IDS])(
    "reports %s as the only failing item and never carries the raw output",
    async (id) => {
      const dirs = makeTestDirs();
      const report = await runSelfTest(
        deps(dirs),
        selfTestShell(new Set<SelfTestItemId>([id])),
        NO_CANCEL,
      );
      expect(report.passed).toBe(false);
      expect(report.items.filter((item) => !item.passed).map((item) => item.id)).toEqual([id]);
      const text = JSON.stringify(report);
      expect(text).not.toContain("canary-");
      expect(text).not.toContain("value-that-must-not-be-reported");
      expect(text).not.toContain("ANTHROPIC_API_KEY");
    },
  );

  test("an exec error is a failure for a denial check, not a pass", async () => {
    const dirs = makeTestDirs();
    const report = await runSelfTest(
      deps(dirs),
      recordingShell(() => execFailure("spawn_error")),
      NO_CANCEL,
    );
    expect(report.passed).toBe(false);
    expect(report.items.every((item) => !item.passed)).toBe(true);
    expect(report.items[0]?.detail).toBe("exec_error=spawn_error");
  });

  test("cleans the canary, the probe directory and the temp workspace", async () => {
    const dirs = makeTestDirs();
    await runSelfTest(deps(dirs), selfTestShell(), NO_CANCEL);
    expect(existsSync(join(dirs.data, "selftest"))).toBe(false);
    expect(readdirSync(dirs.tmp)).toEqual([]);
    // 실패한 시험 뒤에도 정리한다
    await runSelfTest(
      deps(dirs),
      selfTestShell(new Set<SelfTestItemId>(["xeon_data_write_denied", "git_hooks_write_denied"])),
      NO_CANCEL,
    );
    expect(existsSync(join(dirs.data, "selftest"))).toBe(false);
    expect(readdirSync(dirs.tmp)).toEqual([]);
  });

  test("runs every attempt in the temp workspace with allowEscape false", async () => {
    const dirs = makeTestDirs();
    const seen: boolean[] = [];
    const base = deps(dirs);
    const shell = selfTestShell();
    await runSelfTest(
      {
        ...base,
        defaultPolicy: (input) => {
          const policy = base.defaultPolicy(input);
          seen.push(policy.allowEscape);
          return policy;
        },
      },
      shell,
      NO_CANCEL,
    );
    expect(seen).toEqual([false]);
    expect(shell.calls.length).toBe(6);
    expect(shell.calls.every((call) => call.options?.cwd?.startsWith(dirs.tmp) === true)).toBe(
      true,
    );
    expect(shell.calls.every((call) => call.options?.timeout === 20)).toBe(true);
  });

  test("a setup failure fails the items it could not run", async () => {
    const dirs = makeTestDirs();
    const logger = memoryLogger();
    const report = await runSelfTest(
      { ...deps(dirs), logger, dirs: { data: join(dirs.root, "no", "such\0dir"), tmp: dirs.tmp } },
      selfTestShell(),
      NO_CANCEL,
    );
    expect(report.passed).toBe(false);
    expect(report.items.map((item) => item.id)).toEqual([...SELF_TEST_ITEM_IDS]);
    expect(logger.entries.some((entry) => entry.event === "sandbox.self_test_setup_failed")).toBe(
      true,
    );
  });
});

/** `env` 출력만 바꾸고 나머지는 selfTestShell 그대로인 Shell */
function shellWithEnvOutput(envOutput: string): Shell {
  const base = selfTestShell();
  return {
    ...base,
    exec(command, options, context) {
      const text = typeof command === "string" ? command : command.join(" ");
      if (/(^|\s)env$/.test(text)) {
        options?.onOutput?.(envOutput, { abortSignal: undefined }, { stream: "stdout" });
        return Promise.resolve(ok({ exitCode: 0 }));
      }
      return base.exec(command, options, context);
    },
    cleanup: (context) => base.cleanup(context),
  };
}

describe("env_allowlist with the proxy credential srt exports", () => {
  test("srt's own proxy password name is not counted, and the item passes", async () => {
    const dirs = makeTestDirs();
    const report = await runSelfTest(
      deps(dirs),
      shellWithEnvOutput("PATH=/usr/bin\nCLOUDSDK_PROXY_PASSWORD=per-process-proxy-token\n"),
      NO_CANCEL,
    );
    const item = report.items.find((entry) => entry.id === "env_allowlist");
    expect(item).toEqual({ id: "env_allowlist", passed: true, detail: "exit=0 sensitive=0" });
  });

  test("any other sensitive name still fails, and only that one is counted", async () => {
    const dirs = makeTestDirs();
    const report = await runSelfTest(
      deps(dirs),
      shellWithEnvOutput(
        "PATH=/usr/bin\nCLOUDSDK_PROXY_PASSWORD=per-process-proxy-token\nGH_TOKEN=x\nOTHER_PASSWORD=y\n",
      ),
      NO_CANCEL,
    );
    const item = report.items.find((entry) => entry.id === "env_allowlist");
    expect(item).toEqual({ id: "env_allowlist", passed: false, detail: "exit=0 sensitive=2" });
    expect(JSON.stringify(report)).not.toContain("per-process-proxy-token");
  });
});

describe("sensitive env names", () => {
  test("match the F pattern list with leading and trailing wildcards", () => {
    for (const name of [
      "GH_TOKEN",
      "MY_API_KEY",
      "SOPS_AGE_KEY_FILE",
      "AWS_REGION",
      "XEON_HOME",
      "SSH_AUTH_SOCK",
      "NODE_OPTIONS",
    ]) {
      expect(isSensitiveEnvName(name)).toBe(true);
    }
    for (const name of ["PATH", "HOME", "LANG", "HTTP_PROXY", "TOKENIZER", "KEYBOARD"]) {
      expect(isSensitiveEnvName(name)).toBe(false);
    }
  });
});
