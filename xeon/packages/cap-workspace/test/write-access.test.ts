import { describe, expect, test } from "bun:test";
import { ok } from "@fresnel/contracts";
import type { CallOptions, SandboxBlock } from "@fresnel/contracts/capabilities";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ProtectedPathEntry, SandboxRunReport } from "@fresnel/contracts/services";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import type { WriteAccessPort, WriteAccessRequest } from "../src/ports/write-access.ts";
import { createFilesApi } from "../src/service.ts";
import { createShellApi } from "../src/shell/run.ts";
import { grantRootFor, pathsFromDenialOutput, planWriteAccess } from "../src/write-access.ts";
import { rejection } from "./support/assertions.ts";
import { depsFor, fakeSandbox } from "./support/fakes.ts";
import { memoryEnv } from "./support/memory-env.ts";

// L2.workspace.spec §4.3.1. 작업 폴더 밖 쓰기를 막지 않고 묻는다. 보호 경로와 무인 호출은 묻지 않는다.

const HOME = "/Users/me";
const THREAD: ThreadId = fixedIdFactory().next("thr");
const PROTECTED: readonly ProtectedPathEntry[] = [
  { path: `${HOME}/.ssh`, match: "prefix", access: "read_write", reason: "credentials" },
  { path: `${HOME}/.claude`, match: "prefix", access: "read_write", reason: "credentials" },
  { path: ".env", match: "basename", access: "read_write", reason: "secret_key" },
];

function asker(answer: "allow" | "deny") {
  const requests: WriteAccessRequest[] = [];
  const port: WriteAccessPort = {
    ask: (request) => {
      requests.push(request);
      return Promise.resolve(ok(answer));
    },
  };
  return { port, requests };
}

function human(interactive = true): CallOptions {
  return {
    context: {
      threadId: THREAD,
      toolCallId: "call_1",
      caller: { kind: "model", agent: "main" },
      interactive,
    },
  };
}

function blockedRun(paths: readonly string[], exitCode: number) {
  const blocks: SandboxBlock[] = paths.map((path) => ({ code: "sandbox.write_blocked", path }));
  const sandbox: SandboxRunReport = {
    sandboxed: true,
    level: "srt",
    violations: [],
    violationsTruncated: false,
    blocks,
  };
  return { chunks: [{ text: exitCode === 0 ? "done\n" : "denied\n" }], exitCode, sandbox };
}

function shellSetup(answer: "allow" | "deny") {
  const env = memoryEnv({ cwd: "/work" });
  env.mkdir("/work");
  const sandbox = fakeSandbox(PROTECTED);
  sandbox.wrapShell = (inner, policy) => {
    sandbox.policies.push(policy);
    return inner;
  };
  const { port, requests } = asker(answer);
  const shell = createShellApi(
    depsFor(env, { sandbox, protectedPaths: PROTECTED, writeAccess: port, homeDir: HOME }),
  );
  return { env, shell, sandbox, requests };
}

describe("grantRootFor", () => {
  test("lifts a blocked path to a reasonable folder", () => {
    expect(grantRootFor(`${HOME}/.npm/_cacache/index-v5/ab`, HOME)).toBe(`${HOME}/.npm`);
    expect(grantRootFor(`${HOME}/Library/Caches/Homebrew/api/x.json`, HOME)).toBe(
      `${HOME}/Library/Caches/Homebrew`,
    );
    expect(grantRootFor(`${HOME}/.cache/pip/http/a`, HOME)).toBe(`${HOME}/.cache/pip`);
    expect(grantRootFor("/private/var/folders/ab/cd123/T/xcrun_db-9", HOME)).toBe(
      "/private/var/folders/ab/cd123/T",
    );
    expect(grantRootFor(`${HOME}/projects/other/out.txt`, HOME)).toBe(`${HOME}/projects/other`);
  });

  test("a file directly under home offers the home folder, a top-level system folder is not offered", () => {
    expect(grantRootFor(`${HOME}/scratch.txt`, HOME)).toBe(HOME);
    expect(grantRootFor("/etc/hosts", HOME)).toBeUndefined();
    expect(grantRootFor("/tmp/out/x.txt", HOME)).toBe("/tmp/out");
  });
});

describe("planWriteAccess", () => {
  test("drops protected paths, already granted paths and non-absolute paths", () => {
    const plan = planWriteAccess(
      [
        `${HOME}/.ssh/config`,
        `${HOME}/.claude/settings.json`,
        `${HOME}/projects/a/.env`,
        "relative/x",
        "/work/inside.txt",
        `${HOME}/.npm/_logs/1.log`,
      ],
      PROTECTED,
      ["/work"],
      HOME,
    );
    expect(plan).toEqual({ roots: [`${HOME}/.npm`], paths: [`${HOME}/.npm/_logs/1.log`] });
  });
});

describe("pathsFromDenialOutput", () => {
  test("takes absolute paths from EPERM lines only", () => {
    const output = [
      "mkdir: /Users/me/.npm/_logs: Operation not permitted",
      "xcrun: error: couldn't create cache file '/var/folders/ab/cd/T/xcrun_db-1' (errno=Operation not permitted)",
      "cat: /etc/shadow: Permission denied",
      "ordinary line /tmp/ignored",
      "touch: ./relative: Operation not permitted",
    ].join("\n");
    expect(pathsFromDenialOutput(output)).toEqual([
      "/Users/me/.npm/_logs",
      "/var/folders/ab/cd/T/xcrun_db-1",
    ]);
  });
});

describe("bash write access", () => {
  test("falls back to the output path when the sandbox reported no violation", async () => {
    const { env, shell, requests } = shellSetup("allow");
    env.reply(
      {
        chunks: [{ text: "mkdir: /Users/me/.cache/pip/http: Operation not permitted\n" }],
        exitCode: 1,
        sandbox: { sandboxed: true, level: "srt", violations: [], violationsTruncated: false },
      },
      blockedRun([], 0),
    );
    const out = await shell.run({ command: "pip install x" }, human());
    expect(out.exitCode).toBe(0);
    expect(requests[0]).toMatchObject({
      paths: [`${HOME}/.cache/pip/http`],
      roots: [`${HOME}/.cache/pip`],
    });
  });

  test("an output path that is protected is not asked about", async () => {
    const { env, shell, requests } = shellSetup("allow");
    env.reply({
      chunks: [{ text: `touch: ${HOME}/.ssh/x: Operation not permitted\n` }],
      exitCode: 1,
      sandbox: { sandboxed: true, level: "srt", violations: [], violationsTruncated: false },
    });
    await shell.run({ command: "touch ~/.ssh/x" }, human());
    expect(requests).toHaveLength(0);
  });

  test("asks about the blocked path, then reruns the same command with the root added", async () => {
    const { env, shell, sandbox, requests } = shellSetup("allow");
    env.reply(blockedRun([`${HOME}/.npm/_logs/1.log`], 1), blockedRun([], 0));
    const out = await shell.run({ command: "npm ci" }, human());
    expect(out.exitCode).toBe(0);
    expect(out.output).toBe("done\n");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      threadId: THREAD,
      via: "bash",
      paths: [`${HOME}/.npm/_logs/1.log`],
      roots: [`${HOME}/.npm`],
    });
    expect(env.calls.map((call) => call.command)).toEqual(["npm ci", "npm ci"]);
    expect(sandbox.policies[0]?.writeRoots).not.toContain(`${HOME}/.npm`);
    expect(sandbox.policies[1]?.writeRoots).toEqual(["/work", `${HOME}/.npm`, "/tmp/fresnel"]);
  });

  test("a denied request returns the first failure untouched and does not rerun", async () => {
    const { env, shell, requests } = shellSetup("deny");
    env.reply(blockedRun([`${HOME}/.npm/_logs/1.log`], 1));
    const out = await shell.run({ command: "npm ci" }, human());
    expect(out.exitCode).toBe(1);
    expect(out.sandboxBlocks).toEqual([
      { code: "sandbox.write_blocked", path: `${HOME}/.npm/_logs/1.log` },
    ]);
    expect(requests).toHaveLength(1);
    expect(env.calls).toHaveLength(1);
  });

  test("protected paths are never asked about and the failure stays", async () => {
    const { env, shell, requests } = shellSetup("allow");
    env.reply(blockedRun([`${HOME}/.ssh/authorized_keys`, `${HOME}/.claude/x`], 1));
    const out = await shell.run({ command: "echo > ~/.ssh/authorized_keys" }, human());
    expect(out.exitCode).toBe(1);
    expect(requests).toHaveLength(0);
    expect(env.calls).toHaveLength(1);
  });

  test("an unattended call is not asked and fails as before", async () => {
    const { env, shell, requests } = shellSetup("allow");
    env.reply(blockedRun([`${HOME}/.npm/_logs/1.log`], 1));
    const out = await shell.run({ command: "npm ci" }, human(false));
    expect(out.exitCode).toBe(1);
    expect(requests).toHaveLength(0);
    expect(env.calls).toHaveLength(1);
  });

  test("a command that exits 0 is not retried even if a write was blocked", async () => {
    const { env, shell, requests } = shellSetup("allow");
    env.reply(blockedRun([`${HOME}/.npm/_logs/1.log`], 0));
    await shell.run({ command: "npm ci || true" }, human());
    expect(requests).toHaveLength(0);
  });

  test("asks at most three rounds as the command reveals more paths", async () => {
    const { env, shell, requests } = shellSetup("allow");
    env.reply(
      blockedRun([`${HOME}/.npm/a`], 1),
      blockedRun([`${HOME}/.cache/pip/b`], 1),
      blockedRun([`${HOME}/Library/Caches/Foo/c`], 1),
      blockedRun([`${HOME}/.cargo/d`], 1),
    );
    const out = await shell.run({ command: "build" }, human());
    expect(out.exitCode).toBe(1);
    expect(requests).toHaveLength(3);
    expect(env.calls).toHaveLength(4);
  });
});

function filesSetup(answer: "allow" | "deny") {
  const env = memoryEnv({ cwd: "/work" });
  env.mkdir("/work");
  env.mkdir(`${HOME}/notes`);
  const { port, requests } = asker(answer);
  const files = createFilesApi(
    depsFor(env, { protectedPaths: PROTECTED, writeAccess: port, homeDir: HOME }),
  );
  return { env, files, requests };
}

describe("file tools outside the workspace", () => {
  test("write outside the workspace is asked, and written once allowed", async () => {
    const { env, files, requests } = filesSetup("allow");
    await files.write({ path: `${HOME}/notes/a.txt`, content: "hi" }, human());
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ via: "write", roots: [`${HOME}/notes/a.txt`] });
    const read = await env.readTextFile(`${HOME}/notes/a.txt`, { abortSignal: undefined });
    expect(read.ok && read.value).toBe("hi");
  });

  test("a denied write is refused as outside_root and nothing is written", async () => {
    const { env, files } = filesSetup("deny");
    const error = await rejection(
      files.write({ path: `${HOME}/notes/a.txt`, content: "hi" }, human()),
    );
    expect(error.data.code).toBe("denied");
    expect(error.data.detail).toMatchObject({ reason: "outside_root" });
    expect((await env.exists(`${HOME}/notes/a.txt`, { abortSignal: undefined })).ok).toBe(true);
  });

  test("a protected path outside the workspace is refused without asking", async () => {
    const { files, requests } = filesSetup("allow");
    const error = await rejection(
      files.write({ path: `${HOME}/.ssh/authorized_keys`, content: "x" }, human()),
    );
    expect(error.data.detail).toMatchObject({ reason: "outside_root" });
    expect(requests).toHaveLength(0);
  });

  test("an unattended write outside the workspace is refused without asking", async () => {
    const { files, requests } = filesSetup("allow");
    const error = await rejection(
      files.write({ path: `${HOME}/notes/a.txt`, content: "hi" }, human(false)),
    );
    expect(error.data.detail).toMatchObject({ reason: "outside_root" });
    expect(requests).toHaveLength(0);
  });
});
