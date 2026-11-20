import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  ENVIRONMENT_EXIT_CODE,
  missingMessage,
  readSandboxEnvironment,
  runCollected,
  shouldFailOnMissing,
  startRealSandbox,
  type RealSandbox,
} from "./support/real-sandbox.ts";

// 보호 경로 표에 더한 시크릿 폴더(L0.sandbox.spec §3.3)를 실제 srt로 확인한다. 임시 홈에 같은 모양의 폴더와
// 가짜 값을 만들어 두고, 샌드박스 안에서 목록 나열과 파일 읽기가 거부되는지, 감싸지 않은 같은 명령은 되는지 본다.
// 실제 홈의 파일은 읽지 않는다.

const environment = readSandboxEnvironment();
if (environment.supported && environment.missing.length > 0 && shouldFailOnMissing(Bun.env)) {
  process.stderr.write(`${missingMessage(environment)}\n`);
  process.exit(ENVIRONMENT_EXIT_CODE);
}
const runnable = environment.supported && environment.missing.length === 0;
const suite = runnable ? describe : describe.skip;

const FAKE = "fake-secret-for-sandbox-test";

const COMMON = [
  ".gnupg",
  ".password-store",
  ".azure",
  ".config/op",
  ".gemini",
  ".cursor",
  ".config/github-copilot",
  ".local/share/opencode",
];
const COMMON_FILES = [
  ".cargo/credentials.toml",
  ".terraform.d/credentials.tfrc.json",
  ".gem/credentials",
];
const MAC = [
  "Library/Keychains",
  "Library/Application Support/Google/Chrome",
  "Library/Application Support/Chromium",
  "Library/Application Support/Microsoft Edge",
  "Library/Application Support/BraveSoftware",
  "Library/Application Support/Arc",
  "Library/Application Support/Vivaldi",
  "Library/Application Support/com.operasoftware.Opera",
  "Library/Application Support/Firefox",
  "Library/Application Support/1Password",
  "Library/Application Support/Bitwarden",
  "Library/Application Support/KeePassXC",
  "Library/Cookies",
];
const LINUX = [
  ".config/google-chrome",
  ".config/chromium",
  ".config/microsoft-edge",
  ".config/BraveSoftware",
  ".config/vivaldi",
  ".config/opera",
  ".mozilla",
  ".config/1Password",
  ".config/Bitwarden",
  ".config/KeePassXC",
  ".local/share/keyrings",
];

suite("secret folders in the default protected table (real srt, temp home)", () => {
  let box: RealSandbox;
  const folders = [...COMMON, ...(process.platform === "darwin" ? MAC : LINUX)];
  const files = COMMON_FILES;

  const run = (command: string, wrapped: boolean) => {
    const shell = wrapped
      ? box.service.wrapShell(
          box.shell,
          box.service.defaultPolicy({
            workspaceRoots: [box.dirs.workspace],
            tempDir: box.dirs.tmp,
          }),
        )
      : box.shell;
    return runCollected(shell, command, { cwd: box.dirs.workspace });
  };

  beforeAll(async () => {
    box = await startRealSandbox();
    for (const name of folders) {
      mkdirSync(join(box.dirs.home, name), { recursive: true });
      writeFileSync(join(box.dirs.home, name, "secret.txt"), FAKE);
    }
    for (const name of files) {
      mkdirSync(dirname(join(box.dirs.home, name)), { recursive: true });
      writeFileSync(join(box.dirs.home, name), FAKE);
    }
  });

  afterAll(async () => {
    await box.service.dispose();
    rmSync(box.dirs.root, { recursive: true, force: true });
  });

  test("every added folder refuses listing and reading, while the unsandboxed control reads it", async () => {
    await Promise.all(
      folders.map(async (name) => {
        const dir = join(box.dirs.home, name);
        const control = await run(`cat '${dir}/secret.txt'`, false);
        expect({ name, output: control.output }).toEqual({ name, output: FAKE });
        const listing = await run(`ls '${dir}'`, true);
        expect({ name, ok: listing.exitCode === 0 }).toEqual({ name, ok: false });
        const read = await run(`cat '${dir}/secret.txt'`, true);
        expect({ name, ok: read.exitCode === 0 }).toEqual({ name, ok: false });
        expect(read.output).not.toContain(FAKE);
      }),
    );
  }, 120_000);

  test("every added credential file refuses reading and writing", async () => {
    await Promise.all(
      files.map(async (name) => {
        const path = join(box.dirs.home, name);
        const read = await run(`cat '${path}'`, true);
        expect({ name, ok: read.exitCode === 0 }).toEqual({ name, ok: false });
        expect(read.output).not.toContain(FAKE);
        const write = await run(`echo x >> '${path}'`, true);
        expect({ name, ok: write.exitCode === 0 }).toEqual({ name, ok: false });
      }),
    );
  }, 120_000);

  test("a sibling that is not in the table stays readable (cargo config, not credentials)", async () => {
    const config = join(box.dirs.home, ".cargo", "config.toml");
    writeFileSync(config, "# plain\n");
    const read = await run(`cat '${config}'`, true);
    expect(read.exitCode).toBe(0);
    expect(read.output).toBe("# plain\n");
  });

  test("everyday tools keep working with the protected folders in place", async () => {
    const env = { HOME: box.dirs.home, GIT_CONFIG_NOSYSTEM: "1" };
    const shell = box.service.wrapShell(
      box.shell,
      box.service.defaultPolicy({ workspaceRoots: [box.dirs.workspace], tempDir: box.dirs.tmp }),
    );
    const sh = (command: string) => runCollected(shell, command, { cwd: box.dirs.workspace, env });
    // git init은 .git/config와 hooks를 쓰므로(보호 경로) 샌드박스 밖에서 만든다
    const init = await runCollected(box.shell, "git init -q", { cwd: box.dirs.workspace, env });
    expect(init.exitCode).toBe(0);
    expect((await sh("git status --short")).exitCode).toBe(0);
    await Bun.write(join(box.dirs.workspace, "a.txt"), "a\n");
    const commit = await sh(
      "git add a.txt && git -c user.name=t -c user.email=t@example.com commit -q -m first && git log --format=%s",
    );
    expect(commit.exitCode).toBe(0);
    expect(commit.output).toBe("first\n");
    expect((await sh("ssh -V")).exitCode).toBe(0);
    expect((await sh("curl --version")).exitCode).toBe(0);
  });

  test("macOS system keychain folder refuses listing", async () => {
    if (process.platform !== "darwin") return;
    const control = await run("ls /Library/Keychains >/dev/null", false);
    expect(control.exitCode).toBe(0);
    const wrapped = await run("ls /Library/Keychains >/dev/null", true);
    expect(wrapped.exitCode).not.toBe(0);
  });
});
