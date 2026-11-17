import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  ENVIRONMENT_EXIT_CODE,
  missingMessage,
  readSandboxEnvironment,
  shouldFailOnMissing,
  startRealSandbox,
  type RealSandbox,
} from "./support/real-sandbox.ts";

// 쓰기 없음 프로필과 읽기 허용 목록(L0.sandbox.spec §4.9)을 실제 srt(Seatbelt, bubblewrap)로 확인한다.
// 플러그인 호스트처럼 실행 파일 하나를 정책 아래에서 띄워, 자기 폴더는 읽히고 다른 곳은 읽히지 않고 쓸 수 있는 곳은 자기 임시 폴더뿐임을 본다.
// 같은 스크립트를 감싸지 않고 돌린 대조(모든 읽기·쓰기가 성공)를 함께 둔다. https 네트워크는 바깥 인터넷이 필요해 이 시험이 보지 않는다.

const environment = readSandboxEnvironment();
if (environment.supported && environment.missing.length > 0 && shouldFailOnMissing(Bun.env)) {
  process.stderr.write(`${missingMessage(environment)}\n`);
  process.exit(ENVIRONMENT_EXIT_CODE);
}
const runnable = environment.supported && environment.missing.length === 0;
const suite = runnable ? describe : describe.skip;

type Outcome = "ok" | "denied";

/** 프로세스 안에서 읽기·쓰기를 시도하고 결과를 한 줄 JSON으로 낸다. 값은 읽은 내용이 아니라 성공 여부다 */
const PROBE = `
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
const [own, other, outside, ownWrite, outsideWrite] = process.argv.slice(2);
const attempt = (f) => { try { f(); return "ok"; } catch { return "denied"; } };
const tmp = process.env.TMPDIR ?? "";
process.stdout.write(JSON.stringify({
  readOwn: attempt(() => readFileSync(own, "utf8")),
  readOtherPlugin: attempt(() => readFileSync(other, "utf8")),
  readOutside: attempt(() => readFileSync(outside, "utf8")),
  writeOwnFolder: attempt(() => writeFileSync(ownWrite, "x")),
  writeOutside: attempt(() => writeFileSync(outsideWrite, "x")),
  writeTmpdir: attempt(() => writeFileSync(tmp + "/scratch.txt", "x")),
  listTmpdir: attempt(() => readdirSync(tmp)),
  tmpdir: tmp,
}));
`;

interface Probe {
  readonly readOwn: Outcome;
  readonly readOtherPlugin: Outcome;
  readonly readOutside: Outcome;
  readonly writeOwnFolder: Outcome;
  readonly writeOutside: Outcome;
  readonly writeTmpdir: Outcome;
  readonly listTmpdir: Outcome;
  readonly tmpdir: string;
}

const noop = (): void => {};

suite("no-write sandbox profile with a read allow-list (real srt)", () => {
  let box: RealSandbox;
  let plugin: string;
  let otherPlugin: string;
  let homeFile: string;
  let outsideWrite: string;

  beforeAll(async () => {
    box = await startRealSandbox();
    plugin = join(box.dirs.root, "plugin-a");
    otherPlugin = join(box.dirs.root, "plugin-b");
    mkdirSync(plugin, { recursive: true });
    mkdirSync(otherPlugin, { recursive: true });
    writeFileSync(join(plugin, "main.mjs"), PROBE);
    writeFileSync(join(plugin, "own.txt"), "own");
    writeFileSync(join(otherPlugin, "secret.txt"), "other");
    homeFile = join(box.dirs.home, "note.txt");
    writeFileSync(homeFile, "home");
    outsideWrite = join(box.dirs.workspace, "escaped.txt");
  });

  afterAll(async () => {
    await box.service.dispose();
    rmSync(box.dirs.root, { recursive: true, force: true });
  });

  const argsOf = (): string[] => [
    join(plugin, "main.mjs"),
    join(plugin, "own.txt"),
    join(otherPlugin, "secret.txt"),
    homeFile,
    join(plugin, "written.txt"),
    outsideWrite,
  ];

  async function runProbe(sandboxed: boolean): Promise<{ probe: Probe; cleanup: () => void }> {
    let argv: readonly string[] = [process.execPath, ...argsOf()];
    let env: Readonly<Record<string, string>> = {};
    let cleanup = noop;
    if (sandboxed) {
      const policy = box.service.defaultPolicy({
        workspaceRoots: [],
        tempDir: box.dirs.tmp,
        profile: "no-write",
        readRoots: [plugin, process.execPath],
      });
      const wrapped = await box.service.wrapArgv(
        policy,
        { command: process.execPath, args: argsOf(), cwd: plugin },
        { abortSignal: undefined },
      );
      if (!wrapped.ok) throw new Error(`wrapArgv failed: ${JSON.stringify(wrapped.error)}`);
      expect(wrapped.value.sandboxed).toBe(true);
      argv = wrapped.value.argv;
      env = wrapped.value.env;
      const sandboxed = wrapped.value;
      cleanup = () => {
        sandboxed.cleanup();
      };
    }
    const [command, ...args] = argv;
    if (command === undefined) throw new Error("empty argv");
    const child = Bun.spawn([command, ...args], {
      cwd: plugin,
      env: { ...process.env, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const exit = await child.exited;
    const out = await new Response(child.stdout).text();
    const err = await new Response(child.stderr).text();
    if (exit !== 0) throw new Error(`probe exited ${exit}: ${err.slice(0, 300)}`);
    return { probe: JSON.parse(out), cleanup };
  }

  test("unsandboxed, every read and write of the probe succeeds (control)", async () => {
    const { probe } = await runProbe(false);
    expect(probe.readOwn).toBe("ok");
    expect(probe.readOtherPlugin).toBe("ok");
    expect(probe.readOutside).toBe("ok");
    expect(probe.writeOutside).toBe("ok");
    rmSync(outsideWrite, { force: true });
    rmSync(join(plugin, "written.txt"), { force: true });
  });

  test("the sandboxed host reads its own folder only and writes only into its own temp folder", async () => {
    const { probe, cleanup } = await runProbe(true);
    expect(probe).toEqual({
      readOwn: "ok",
      readOtherPlugin: "denied",
      readOutside: "denied",
      writeOwnFolder: "denied",
      writeOutside: "denied",
      writeTmpdir: "ok",
      listTmpdir: "ok",
      tmpdir: probe.tmpdir,
    });
    expect(existsSync(outsideWrite)).toBe(false);
    expect(existsSync(join(plugin, "written.txt"))).toBe(false);
    // 임시 폴더는 이 프로세스 전용이고 프로세스 뒤 cleanup이 지운다
    expect(probe.tmpdir.startsWith(box.dirs.tmp)).toBe(true);
    expect(readdirSync(probe.tmpdir)).toEqual(["scratch.txt"]);
    cleanup();
    expect(existsSync(probe.tmpdir)).toBe(false);
  });

  test("two hosts do not share a temp folder", async () => {
    const one = await runProbe(true);
    const two = await runProbe(true);
    expect(one.probe.tmpdir).not.toBe(two.probe.tmpdir);
    one.cleanup();
    two.cleanup();
  });
});
