import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { suggestedProtectedPaths } from "../src/protected-paths.ts";
import {
  ENVIRONMENT_EXIT_CODE,
  missingMessage,
  readSandboxEnvironment,
  runCollected,
  shouldFailOnMissing,
  startRealSandbox,
  type RealSandbox,
} from "./support/real-sandbox.ts";

// 제안 목록의 자격 폴더·파일(L0.sandbox.spec §3.3)을 실제 srt로 확인한다. 임시 홈에 같은 모양의 폴더와 가짜 값을 만든다.
// [결정: 2026-11-20, 사용자, AGE-63] 기본은 읽기를 허용하고 쓰기만 막는다. 설정 `extra`에 적은 경로는 읽기와 쓰기를 모두 막는다.
// 실제 홈의 파일은 읽지 않는다.

const environment = readSandboxEnvironment();
if (environment.supported && environment.missing.length > 0 && shouldFailOnMissing(Bun.env)) {
  process.stderr.write(`${missingMessage(environment)}\n`);
  process.exit(ENVIRONMENT_EXIT_CODE);
}
const runnable = environment.supported && environment.missing.length === 0;
const suite = runnable ? describe : describe.skip;

const FAKE = "fake-secret-for-sandbox-test";
const PLATFORM = process.platform === "darwin" ? "darwin" : "linux";

// 제안 목록에 든 폴더(이 OS의 줄)와 파일. 이름은 홈 기준 상대 경로다
const FOLDERS = [
  ".gnupg",
  ".password-store",
  ".azure",
  ".config/op",
  ".gemini",
  ".cursor",
  ".config/github-copilot",
  ".local/share/opencode",
  ...(PLATFORM === "darwin"
    ? [
        "Library/Keychains",
        "Library/Application Support/1Password",
        "Library/Application Support/Bitwarden",
        "Library/Application Support/KeePassXC",
        "Library/Cookies",
      ]
    : [".config/1Password", ".config/Bitwarden", ".config/KeePassXC", ".local/share/keyrings"]),
];
const CREDENTIAL_FILES = [
  ".cargo/credentials.toml",
  ".terraform.d/credentials.tfrc.json",
  ".gem/credentials",
  ".npmrc",
  ".netrc",
  ".pypirc",
  ".docker/config.json",
];
// 브라우저 프로필과 메신저 데이터는 기본으로 막지 않는다 [결정: 2026-11-20, 사용자, AGE-63]
const OPEN_FOLDERS =
  PLATFORM === "darwin"
    ? ["Library/Application Support/Google/Chrome", "Library/Application Support/Slack"]
    : [".config/google-chrome", ".config/Slack"];

/** 제안 목록의 이 OS 줄을 설정 `extra`에 적을 값으로 만든다(`~/…`은 서비스가 홈으로 푼다) */
const suggestedExtra = (): string[] => suggestedProtectedPaths(PLATFORM).map((row) => row.path);

function seedFiles(box: RealSandbox): void {
  for (const name of FOLDERS) {
    mkdirSync(join(box.dirs.home, name), { recursive: true });
    writeFileSync(join(box.dirs.home, name, "secret.txt"), FAKE);
  }
  for (const name of CREDENTIAL_FILES) {
    mkdirSync(dirname(join(box.dirs.home, name)), { recursive: true });
    writeFileSync(join(box.dirs.home, name), FAKE);
  }
  for (const name of OPEN_FOLDERS) {
    mkdirSync(join(box.dirs.home, name), { recursive: true });
    writeFileSync(join(box.dirs.home, name, "data.txt"), FAKE);
  }
}

suite(
  "suggested credential folders by default: readable, not writable (real srt, temp home)",
  () => {
    let box: RealSandbox;

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
      seedFiles(box);
    });

    afterAll(async () => {
      await box.service.dispose();
      rmSync(box.dirs.root, { recursive: true, force: true });
    });

    test("every suggested folder and credential file is readable inside the sandbox, as the unsandboxed control reads it", async () => {
      const targets = [
        ...FOLDERS.map((name) => ({ name, path: join(box.dirs.home, name, "secret.txt") })),
        ...CREDENTIAL_FILES.map((name) => ({ name, path: join(box.dirs.home, name) })),
      ];
      await Promise.all(
        targets.map(async ({ name, path }) => {
          const control = await run(`cat '${path}'`, false);
          expect({ name, output: control.output }).toEqual({ name, output: FAKE });
          const read = await run(`cat '${path}'`, true);
          expect({ name, output: read.output }).toEqual({ name, output: FAKE });
        }),
      );
    }, 120_000);

    test("a folder listing works inside the sandbox by default", async () => {
      await Promise.all(
        FOLDERS.map(async (name) => {
          const listing = await run(`ls '${join(box.dirs.home, name)}' >/dev/null`, true);
          expect({ name, ok: listing.exitCode === 0 }).toEqual({ name, ok: true });
        }),
      );
    }, 120_000);

    test("every suggested folder and credential file refuses writing inside the sandbox", async () => {
      await Promise.all([
        ...FOLDERS.map(async (name) => {
          const write = await run(`echo x > '${join(box.dirs.home, name, "new.txt")}'`, true);
          expect({ name, ok: write.exitCode === 0 }).toEqual({ name, ok: false });
        }),
        ...CREDENTIAL_FILES.map(async (name) => {
          const path = join(box.dirs.home, name);
          const write = await run(`echo x >> '${path}'`, true);
          expect({ name, ok: write.exitCode === 0 }).toEqual({ name, ok: false });
          expect(await Bun.file(path).text()).toBe(FAKE);
        }),
      ]);
    }, 120_000);

    test("browser profile and messenger folders are readable by default but still not writable", async () => {
      await Promise.all(
        OPEN_FOLDERS.map(async (name) => {
          const dir = join(box.dirs.home, name);
          const read = await run(`cat '${dir}/data.txt'`, true);
          expect({ name, output: read.output }).toEqual({ name, output: FAKE });
          const write = await run(`echo x > '${dir}/new.txt'`, true);
          expect({ name, ok: write.exitCode === 0 }).toEqual({ name, ok: false });
        }),
      );
    }, 120_000);

    test("a sibling that is not in the table stays readable and writable inside the workspace (cargo config)", async () => {
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
      const sh = (command: string) =>
        runCollected(shell, command, { cwd: box.dirs.workspace, env });
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

    test("the macOS system keychain folder lists inside the sandbox by default", async () => {
      if (process.platform !== "darwin") return;
      const listing = await run("ls /Library/Keychains >/dev/null", true);
      expect(listing.exitCode).toBe(0);
    });
  },
);

suite(
  "suggested credential folders listed in protectedPaths.extra: refused for reading and writing (real srt)",
  () => {
    let box: RealSandbox;

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
      box = await startRealSandbox({ protectedPathsExtra: suggestedExtra() });
      seedFiles(box);
    });

    afterAll(async () => {
      await box.service.dispose();
      rmSync(box.dirs.root, { recursive: true, force: true });
    });

    test("every listed folder refuses listing and reading, while the unsandboxed control reads it", async () => {
      await Promise.all(
        FOLDERS.map(async (name) => {
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

    test("every listed credential file refuses reading and writing", async () => {
      await Promise.all(
        CREDENTIAL_FILES.map(async (name) => {
          const path = join(box.dirs.home, name);
          const read = await run(`cat '${path}'`, true);
          expect({ name, ok: read.exitCode === 0 }).toEqual({ name, ok: false });
          expect(read.output).not.toContain(FAKE);
          const write = await run(`echo x >> '${path}'`, true);
          expect({ name, ok: write.exitCode === 0 }).toEqual({ name, ok: false });
        }),
      );
    }, 120_000);

    test("browser profile and messenger folders stay readable even with the whole suggested list listed", async () => {
      await Promise.all(
        OPEN_FOLDERS.map(async (name) => {
          const read = await run(`cat '${join(box.dirs.home, name, "data.txt")}'`, true);
          expect({ name, output: read.output }).toEqual({ name, output: FAKE });
        }),
      );
    }, 120_000);
  },
);
