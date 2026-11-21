import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  ENVIRONMENT_EXIT_CODE,
  VAULT_SECRET,
  missingMessage,
  readSandboxEnvironment,
  runCollected,
  shouldFailOnMissing,
  startRealSandbox,
  type RealSandbox,
} from "./support/real-sandbox.ts";

// [결정: 2026-11-20, 사용자, AGE-63 "쓰기도 풀기"] 셸 도구는 쓰기 범위 제한이 없다. 실제 srt로 확인한다:
// (a) 작업 공간 밖(가짜 홈 아래)에 쓰인다, (b) .git/hooks, 가짜 LaunchAgents, 가짜 셸 시작 파일에 쓰인다,
// (c) `protectedPaths.extra`에 더한 곳은 읽기·쓰기가 막힌다, (d) Fresnel 자신의 세 항목은 전과 같이 막힌다,
// (e) 쓰기 범위가 좁은 길(읽기 전용, MCP 서버)은 전과 같이 못 쓴다, (f) 사용자가 `sandbox_protect`로 더하면 다음 명령부터 쓰기도 막힌다.
// 가짜 홈과 임시 폴더만 쓴다. 실제 홈·키·키체인은 읽거나 쓰지 않는다.

const environment = readSandboxEnvironment();
if (environment.supported && environment.missing.length > 0 && shouldFailOnMissing(Bun.env)) {
  process.stderr.write(`${missingMessage(environment)}\n`);
  process.exit(ENVIRONMENT_EXIT_CODE);
}
const runnable = environment.supported && environment.missing.length === 0;
const suite = runnable ? describe : describe.skip;

const SEED = "seed-value-for-open-writes";

suite(
  "open writes: the shell tool writes anywhere except Fresnel's own and the user's paths (real srt)",
  () => {
    let box: RealSandbox;
    let home = "";
    let workspace = "";

    const openShell = () =>
      box.service.wrapShell(
        box.shell,
        box.service.defaultPolicy({
          workspaceRoots: [workspace],
          tempDir: box.dirs.tmp,
          writeEverywhere: true,
        }),
      );
    const run = (command: string) => runCollected(openShell(), command, { cwd: workspace });
    const narrow = (command: string) =>
      runCollected(
        box.service.wrapShell(
          box.shell,
          box.service.defaultPolicy({ workspaceRoots: [workspace], tempDir: box.dirs.tmp }),
        ),
        command,
        { cwd: workspace },
      );

    beforeAll(async () => {
      box = await startRealSandbox();
      home = box.dirs.home;
      workspace = box.dirs.workspace;
      for (const dir of [
        join(workspace, ".git", "hooks"),
        join(home, "Library", "LaunchAgents"),
        join(home, ".ssh"),
        join(box.dirs.data, "sub"),
        join(box.dirs.config, "secrets"),
      ]) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(join(home, ".zshrc"), SEED);
      writeFileSync(join(home, ".ssh", "id"), SEED);
      writeFileSync(join(box.dirs.data, "canary.txt"), SEED);
      writeFileSync(join(box.dirs.config, "settings.json"), SEED);
      writeFileSync(join(box.dirs.config, "secrets", "key.txt"), SEED);
    });

    afterAll(async () => {
      await box.service.dispose();
      rmSync(box.dirs.root, { recursive: true, force: true });
    });

    test("the policy writes everywhere and denies only Fresnel's own paths and the user's extra", () => {
      const policy = box.service.defaultPolicy({
        workspaceRoots: [workspace],
        tempDir: box.dirs.tmp,
        writeEverywhere: true,
      });
      expect(policy.writeRoots).toEqual(["/"]);
      const denied = new Set(policy.writeDeny);
      for (const path of [
        join(home, ".zshrc"),
        join(home, ".ssh"),
        join(home, "Library", "LaunchAgents"),
      ]) {
        expect(denied.has(realpathSync(dirname(path)) + path.slice(dirname(path).length))).toBe(
          false,
        );
      }
      expect(policy.writeDeny).toContain(realpathSync(box.dirs.data));
      expect(policy.writeDeny).toContain(realpathSync(box.dirs.config));
      expect(policy.writeDeny).toContain(realpathSync(box.vault));
    });

    test("(a) writes outside the workspace, under the fake home, succeed", async () => {
      const target = join(home, "elsewhere.txt");
      const write = await run(`echo moved > '${target}'`);
      expect(write.exitCode).toBe(0);
      expect(readFileSync(target, "utf8").trim()).toBe("moved");
    }, 120_000);

    test("(b) .git/hooks, a fake LaunchAgents folder and a fake shell startup file can be written", async () => {
      const hook = join(workspace, ".git", "hooks", "pre-commit");
      const agent = join(home, "Library", "LaunchAgents", "fake.plist");
      const rc = join(home, ".zshrc");
      const writes = await Promise.all([
        run(`echo hook > '${hook}'`),
        run(`echo agent > '${agent}'`),
        run(`echo more >> '${rc}'`),
      ]);
      expect(writes.map((write) => write.exitCode)).toEqual([0, 0, 0]);
      expect(readFileSync(hook, "utf8").trim()).toBe("hook");
      expect(readFileSync(agent, "utf8").trim()).toBe("agent");
      expect(readFileSync(rc, "utf8")).toBe(`${SEED}more\n`);
    }, 120_000);

    test("(b) an old credential folder (the fake ~/.ssh) is no longer write-protected by default", async () => {
      const write = await run(`echo new > '${join(home, ".ssh", "new-key")}'`);
      expect(write.exitCode).toBe(0);
      expect(existsSync(join(home, ".ssh", "new-key"))).toBe(true);
    }, 120_000);

    test("(c) a path added to protectedPaths.extra is refused for reading and writing", async () => {
      const secret = join(box.vault, "secret.txt");
      const read = await run(`cat '${secret}'`);
      expect(read.exitCode === 0).toBe(false);
      expect(read.output).not.toContain(VAULT_SECRET);
      const write = await run(`echo x >> '${secret}'`);
      expect(write.exitCode === 0).toBe(false);
      expect(readFileSync(secret, "utf8")).toBe(VAULT_SECRET);
    }, 120_000);

    test("(d) Fresnel's own data, config and secret folders stay denied as before", async () => {
      // 데이터와 시크릿 폴더는 읽기도 쓰기도 막고, 설정 폴더는 읽기만 된다
      const dataRead = await run(`cat '${join(box.dirs.data, "canary.txt")}'`);
      expect(dataRead.exitCode === 0).toBe(false);
      expect(dataRead.output).not.toContain(SEED);
      const secretRead = await run(`cat '${join(box.dirs.config, "secrets", "key.txt")}'`);
      expect(secretRead.exitCode === 0).toBe(false);
      expect(secretRead.output).not.toContain(SEED);
      const dataWrite = await run(`echo x >> '${join(box.dirs.data, "canary.txt")}'`);
      expect(dataWrite.exitCode === 0).toBe(false);
      const configWrite = await run(`echo x >> '${join(box.dirs.config, "settings.json")}'`);
      expect(configWrite.exitCode === 0).toBe(false);
      const configRead = await run(`cat '${join(box.dirs.config, "settings.json")}'`);
      expect(configRead.output).toBe(SEED);
      expect(readFileSync(join(box.dirs.data, "canary.txt"), "utf8")).toBe(SEED);
      expect(readFileSync(join(box.dirs.config, "settings.json"), "utf8")).toBe(SEED);
    }, 120_000);

    test("(e) the narrow policy (MCP servers) and the read-only profile still cannot write outside their roots", async () => {
      const target = join(home, "narrow-escape.txt");
      const viaNarrow = await narrow(`echo x > '${target}'`);
      expect(viaNarrow.exitCode === 0).toBe(false);
      const viaShellStartup = await narrow(`echo x >> '${join(home, ".zshrc")}'`);
      expect(viaShellStartup.exitCode === 0).toBe(false);
      const readOnly = box.service.wrapShell(
        box.shell,
        box.service.defaultPolicy({
          workspaceRoots: [],
          tempDir: box.dirs.tmp,
          profile: "read-only",
        }),
      );
      const viaReadOnly = await runCollected(readOnly, `echo x > '${target}'`, { cwd: workspace });
      expect(viaReadOnly.exitCode === 0).toBe(false);
      expect(existsSync(target)).toBe(false);
      expect(readFileSync(join(home, ".zshrc"), "utf8")).toBe(`${SEED}more\n`);
    }, 120_000);

    test("(e) the plugin-isolation profile has no write root and keeps denying the old write-only entries", () => {
      const policy = box.service.defaultPolicy({
        workspaceRoots: [],
        tempDir: box.dirs.tmp,
        profile: "no-write",
        readRoots: [workspace],
      });
      expect(policy.writeRoots).toEqual([]);
      expect(policy.writeDeny).toContain(realpathSync(home) + "/.zshrc");
      expect(policy.writeDeny).toContain(realpathSync(home) + "/.ssh");
      expect(policy.writeDeny).toContain(realpathSync(home) + "/Library/LaunchAgents");
    });

    test("(f) a path added by the user afterwards (sandbox_protect) is write-protected from the next command", async () => {
      const folder = join(home, "added-later");
      mkdirSync(folder, { recursive: true });
      const file = join(folder, "a.txt");
      const before = await run(`echo first > '${file}'`);
      expect(before.exitCode).toBe(0);
      box.setSettings({ protectedPathsExtra: [box.vault, folder] });
      const after = await run(`echo second >> '${file}'`);
      expect(after.exitCode === 0).toBe(false);
      const read = await run(`cat '${file}'`);
      expect(read.exitCode === 0).toBe(false);
      expect(readFileSync(file, "utf8").trim()).toBe("first");
    }, 120_000);

    test("known srt limit: its own dangerous-file denies still apply under the host's working directory", async () => {
      // srt는 위험 파일(.zshrc, .git/hooks 등)의 쓰기 거부를 호스트 프로세스의 작업 폴더 기준으로 항상 더한다. 끌 수 없다
      const project = join(box.dirs.root, "host-cwd");
      mkdirSync(project, { recursive: true });
      const previous = process.cwd();
      process.chdir(project);
      try {
        const write = await run(`echo x > '${join(project, ".zshrc")}'`);
        expect(write.exitCode === 0).toBe(false);
        expect(existsSync(join(project, ".zshrc"))).toBe(false);
      } finally {
        process.chdir(previous);
      }
    }, 120_000);
  },
);
