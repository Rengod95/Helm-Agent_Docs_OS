import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SandboxPolicy } from "@fresnel/contracts/services";
import {
  ENVIRONMENT_EXIT_CODE,
  missingMessage,
  readSandboxEnvironment,
  shouldFailOnMissing,
  startRealSandbox,
  type RealSandbox,
} from "./support/real-sandbox.ts";

// 플러그인 프로세스의 두 길(AGE-63, narrowDrafts)을 실제 srt로 본다. 검토본이나 초안 사본처럼 Fresnel 데이터 폴더(보호 경로) 안에 있는 플러그인 폴더를
// 좁은 길(`no-write` 프로필)과 열린 길(읽기 예외)로 띄워, 자기 파일을 읽고(양쪽), 가짜 홈에는 열린 길만 쓰는 것을 본다.
// 시험이 돌리는 것은 파일 읽기·쓰기를 하는 Bun 스크립트뿐이다. 가짜 홈과 임시 폴더만 쓰고, 실제 홈·키체인·클립보드·화면·시스템 서비스를 건드리는 명령은 없다.

const environment = readSandboxEnvironment();
if (environment.supported && environment.missing.length > 0 && shouldFailOnMissing(Bun.env)) {
  process.stderr.write(`${missingMessage(environment)}\n`);
  process.exit(ENVIRONMENT_EXIT_CODE);
}
const runnable = environment.supported && environment.missing.length === 0;
const suite = runnable ? describe : describe.skip;

const PROBE = `
import { readFileSync, writeFileSync } from "node:fs";
const [own, canary, homeWrite] = process.argv.slice(2);
const attempt = (f) => { try { f(); return "ok"; } catch { return "denied"; } };
process.stdout.write(JSON.stringify({
  readOwn: attempt(() => readFileSync(own, "utf8")),
  readDataSibling: attempt(() => readFileSync(canary, "utf8")),
  writeFakeHome: attempt(() => writeFileSync(homeWrite, "x")),
}));
`;

interface Probe {
  readonly readOwn: string;
  readonly readDataSibling: string;
  readonly writeFakeHome: string;
}

suite(
  "plugin process inside Fresnel's data folder: narrow (no-write) and open policies (real srt)",
  () => {
    let box: RealSandbox;
    let tree: string;
    let canary: string;
    let homeWrite: string;

    beforeAll(async () => {
      box = await startRealSandbox();
      tree = join(box.dirs.data, "plugin-store", "drafts", "d1", "tree");
      mkdirSync(tree, { recursive: true });
      writeFileSync(join(tree, "main.mjs"), PROBE);
      writeFileSync(join(tree, "own.txt"), "own");
      canary = join(box.dirs.data, "canary.txt");
      writeFileSync(canary, "canary");
      homeWrite = join(box.dirs.home, "written-by-plugin.txt");
    });

    afterAll(async () => {
      await box.service.dispose();
      rmSync(box.dirs.root, { recursive: true, force: true });
    });

    async function run(policy: SandboxPolicy): Promise<{ probe: Probe }> {
      const wrapped = await box.service.wrapArgv(
        policy,
        {
          command: process.execPath,
          args: [join(tree, "main.mjs"), join(tree, "own.txt"), canary, homeWrite],
          cwd: tree,
        },
        { abortSignal: undefined },
      );
      if (!wrapped.ok) throw new Error(`wrapArgv failed: ${JSON.stringify(wrapped.error)}`);
      try {
        const [command, ...args] = wrapped.value.argv;
        if (command === undefined) throw new Error("empty argv");
        const child = Bun.spawn([command, ...args], {
          cwd: tree,
          env: { ...process.env, ...wrapped.value.env },
          stdout: "pipe",
          stderr: "pipe",
        });
        const exit = await child.exited;
        const out = await new Response(child.stdout).text();
        const err = await new Response(child.stderr).text();
        if (exit !== 0) throw new Error(`probe exited ${exit}: ${err.slice(0, 300)}`);
        return { probe: JSON.parse(out) };
      } finally {
        wrapped.value.cleanup();
      }
    }

    test("narrow: reads its own folder in the data folder, cannot read the data folder's other files, cannot write the fake home", async () => {
      rmSync(homeWrite, { force: true });
      const { probe } = await run(
        box.service.defaultPolicy({
          workspaceRoots: [],
          tempDir: box.dirs.tmp,
          profile: "no-write",
          readRoots: [tree, process.execPath],
        }),
      );
      expect(probe).toEqual({ readOwn: "ok", readDataSibling: "denied", writeFakeHome: "denied" });
      expect(existsSync(homeWrite)).toBe(false);
    }, 120_000);

    test("open (approved plugin, or narrowDrafts off): reads its own folder through the read exception, still cannot read the data folder's other files, and writes the fake home", async () => {
      rmSync(homeWrite, { force: true });
      const { probe } = await run(
        box.service.defaultPolicy({
          workspaceRoots: [],
          tempDir: box.dirs.tmp,
          writeEverywhere: true,
          readCarveOuts: [tree],
        }),
      );
      expect(probe).toEqual({ readOwn: "ok", readDataSibling: "denied", writeFakeHome: "ok" });
      expect(existsSync(homeWrite)).toBe(true);
      rmSync(homeWrite, { force: true });
    }, 120_000);
  },
);
