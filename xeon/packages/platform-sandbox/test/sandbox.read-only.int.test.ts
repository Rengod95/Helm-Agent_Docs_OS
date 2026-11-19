import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

// 읽기 전용 프로필(L0.sandbox.spec §4.2 읽기 전용 프로필)을 실제 srt(Seatbelt, bubblewrap)로 확인한다.
// 읽는 명령은 되고, 쓰기·리다이렉트·네트워크는 막힌다. 같은 명령을 보통 프로필로 돌린 대조를 함께 둔다.

const environment = readSandboxEnvironment();
if (environment.supported && environment.missing.length > 0 && shouldFailOnMissing(Bun.env)) {
  process.stderr.write(`${missingMessage(environment)}\n`);
  process.exit(ENVIRONMENT_EXIT_CODE);
}
const runnable = environment.supported && environment.missing.length === 0;
const suite = runnable ? describe : describe.skip;

function git(cwd: string, ...args: string[]): void {
  const ran = Bun.spawnSync(
    ["git", "-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
    { cwd, stdout: "ignore", stderr: "ignore" },
  );
  if (ran.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed`);
}

suite("read-only sandbox profile (real srt)", () => {
  let box: RealSandbox;
  let readOnly: () => ReturnType<RealSandbox["service"]["defaultPolicy"]>;
  let spillDir: string;

  const run = (command: string): ReturnType<typeof runCollected> =>
    runCollected(box.service.wrapShell(box.shell, readOnly()), command, {
      cwd: box.dirs.workspace,
    });

  beforeAll(async () => {
    box = await startRealSandbox();
    readOnly = () =>
      box.service.defaultPolicy({
        workspaceRoots: [box.dirs.workspace],
        tempDir: box.dirs.tmp,
        profile: "read-only",
      });
    const ws = box.dirs.workspace;
    mkdirSync(join(ws, "src"), { recursive: true });
    writeFileSync(join(ws, "src", "a.txt"), "needle in a haystack\n");
    git(ws, "init", "-q");
    git(ws, "add", "src/a.txt");
    git(ws, "commit", "-q", "-m", "first");
    spillDir = join(box.dirs.state, "spill", "tmp-abc");
    mkdirSync(spillDir, { recursive: true });
    writeFileSync(join(spillDir, "pi-output-1.log"), "spilled output line\n");
  });

  afterAll(async () => {
    // macOS의 위반 보고는 로그 스트림이라 늦게 도착한다. 같은 프로세스의 다른 파일에 번지지 않게 흘려보낸다
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));
    await box.service.dispose();
    rmSync(box.dirs.root, { recursive: true, force: true });
  });

  test("the policy has no write roots, no network allow-list and the read-only profile", () => {
    const policy = readOnly();
    expect(policy.writeRoots).toEqual([]);
    expect(policy.network.allowedDomains).toEqual([]);
    expect(policy.allowEscape).toBe(false);
    expect(policy.profile).toBe("read-only");
  });

  test("ls, find, rg, git log, git status and cat read the workspace", async () => {
    const ws = box.dirs.workspace;
    const ls = await run("ls src");
    expect([ls.exitCode, ls.output.trim()]).toEqual([0, "a.txt"]);
    const find = await run("find src -name '*.txt'");
    expect([find.exitCode, find.output.trim()]).toEqual([0, "src/a.txt"]);
    const rg = await run("rg -n needle src");
    expect([rg.exitCode, rg.output.trim()]).toEqual([0, "src/a.txt:1:needle in a haystack"]);
    const log = await run("git log --oneline");
    expect(log.exitCode).toBe(0);
    expect(log.output).toContain("first");
    const status = await run("git status --short");
    expect(status.exitCode).toBe(0);
    const cat = await run(`cat ${join(ws, "src", "a.txt")}`);
    expect([cat.exitCode, cat.output]).toEqual([0, "needle in a haystack\n"]);
  });

  test("touch and a redirect into the workspace are refused, and nothing is created", async () => {
    const ws = box.dirs.workspace;
    const touch = await run(`touch ${join(ws, "touched.txt")}`);
    expect(touch.exitCode).not.toBe(0);
    expect(existsSync(join(ws, "touched.txt"))).toBe(false);
    const redirect = await run(`echo x > ${join(ws, "redirected.txt")}`);
    expect(redirect.exitCode).not.toBe(0);
    expect(existsSync(join(ws, "redirected.txt"))).toBe(false);
    // 대조: 보통 프로필은 같은 폴더에 쓴다
    const normal = await runCollected(
      box.service.wrapShell(
        box.shell,
        box.service.defaultPolicy({ workspaceRoots: [ws], tempDir: box.dirs.tmp }),
      ),
      `touch ${join(ws, "touched.txt")}`,
      { cwd: ws },
    );
    expect(normal.exitCode).toBe(0);
    rmSync(join(ws, "touched.txt"));
  });

  test("the shared temp folders are not writable", async () => {
    const paths = ["/tmp/claude/ro-probe", "/tmp/ro-probe", join(box.dirs.tmp, "ro-probe")];
    const ran = await Promise.all(
      paths.map((path) =>
        run(`mkdir -p ${path.slice(0, path.lastIndexOf("/"))} 2>/dev/null; echo x > ${path}`),
      ),
    );
    expect(ran.map((one) => one.exitCode !== 0)).toEqual([true, true, true]);
    expect(paths.map((path) => existsSync(path))).toEqual([false, false, false]);
  });

  test("a here-string works through the per-call temp folder, which is gone afterwards", async () => {
    const ran = await run(
      'cat <<< "hello"; echo "$TMPDIR"; echo probe > "$TMPDIR/p"; cat "$TMPDIR/p"',
    );
    expect(ran.exitCode).toBe(0);
    const lines = ran.output.trim().split("\n");
    expect(lines[0]).toBe("hello");
    expect(lines[1]?.includes("/ro-")).toBe(true);
    expect(lines[2]).toBe("probe");
    expect(readdirSync(box.dirs.tmp).filter((name) => name.startsWith("ro-"))).toEqual([]);
  });

  test("the per-call temp folder is writable when the temp base sits behind a symlink (macOS /var/folders)", async () => {
    const linked = await startRealSandbox({}, { tmpBehindSymlink: true });
    try {
      const policy = linked.service.defaultPolicy({
        workspaceRoots: [linked.dirs.workspace],
        tempDir: linked.dirs.tmp,
        profile: "read-only",
      });
      const ran = await runCollected(
        linked.service.wrapShell(linked.shell, policy),
        'echo "$TMPDIR"; echo probe > "$TMPDIR/p" && cat "$TMPDIR/p"',
        { cwd: linked.dirs.workspace },
      );
      expect(ran.exitCode).toBe(0);
      const lines = ran.output.trim().split("\n");
      // 정규 경로(링크가 풀린 경로)로 쓴다
      expect(lines[0]?.startsWith(join(linked.dirs.root, "tmp-actual", "ro-"))).toBe(true);
      expect(lines[1]).toBe("probe");
    } finally {
      await linked.service.dispose();
      rmSync(linked.dirs.root, { recursive: true, force: true });
    }
  });

  test("curl cannot reach the network: it never gets an answer from the proxy, unlike the normal profile", async () => {
    const command =
      "curl -sS -m 8 -o /dev/null -w '%{http_code}' http://fresnel-ro-probe.invalid/ 2>/dev/null; true";
    const blocked = await run(command);
    expect(blocked.output.trim()).toBe("000");
    // 대조: 보통 프로필은 프록시를 거쳐 응답(오류 코드)을 받는다
    const normal = await runCollected(
      box.service.wrapShell(
        box.shell,
        box.service.defaultPolicy({
          workspaceRoots: [box.dirs.workspace],
          tempDir: box.dirs.tmp,
        }),
      ),
      command,
      { cwd: box.dirs.workspace },
    );
    expect(normal.output.trim()).not.toBe("000");
  });

  test("the proxy environment is gone inside the read-only shell", async () => {
    const ran = await run('env | grep -i "proxy" | cut -d= -f1; true');
    expect(ran.output.trim()).toBe("");
  });

  test("bash spill files under the state folder are readable", async () => {
    const ran = await run(`cat ${join(spillDir, "pi-output-1.log")}`);
    expect([ran.exitCode, ran.output]).toEqual([0, "spilled output line\n"]);
  });
});
