import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { err, ok, type Logger, type Result } from "@fresnel/contracts";
import type { LoaderFs, ManifestScriptDecl, ScriptRunResult } from "@fresnel/contracts/extensions";
import type { BinaryError, BinaryName, OsDirs, ResolvedBinary } from "@fresnel/contracts/services";
import { createScriptRunner } from "@fresnel/ext-host";
import { createPluginHostAssembly } from "../../src/assembly/plugin-host.ts";
import {
  createSandboxService,
  readSandboxSettings,
  type SandboxServiceHandle,
} from "@fresnel/platform-sandbox";
import {
  createBackgroundRegistry,
  createIsolationProcessPort,
  detectProcessPlatform,
  type BackgroundRegistryController,
} from "@fresnel/platform-process";
import {
  createLocalIdFactory,
  systemClock,
  systemRandom,
  systemScheduler,
  type SystemScheduler,
} from "@fresnel/platform-os";

// 설계 B(매니페스트 `scripts`)의 실제 샌드박스 시험. 스크립트 실행기(`createScriptRunner`)가 띄우는 `sh`가 실제 샌드박스
// (macOS: sandbox-exec, srt) 아래에서 돈다. 확인하는 것: 종료 코드 2, 표준 오류, 표준 출력(JSON)이 값으로 돌아오고,
// 같은 스크립트가 확장 폴더 밖 파일을 읽거나 거기에 쓰면 실패한다. 밖의 비밀 파일 내용은 결과에 나오지 않는다.
// 샌드박스를 쓸 수 없으면 건너뛰고 stderr에 한 줄 남긴다. FRESNEL_REQUIRE_SANDBOX=1 또는 CI이면 종료 코드 2(환경 문제)로 끝난다.

const ENVIRONMENT_EXIT_CODE = 2;
const DISK_TMP = "/tmp";
const TEST_TIMEOUT_MS = 60_000;
/** 확장 폴더 밖에 둔 비밀 파일의 내용. 결과 값에 나오면 안 된다 */
const SECRET = "outside-the-plugin-folder-secret-for-script-sandbox";

/**
 * 확장 폴더 안의 검사 스크립트. 셸 내장만 쓴다(자식의 PATH에 `cat`이 없을 수 있다). 첫 인자는 밖의 비밀 파일, 둘째 인자는
 * 밖에 만들 파일 경로다. 대조로 스크립트 자신(폴더 안)은 읽혀야 한다.
 */
const CHECK_SCRIPT = `IFS= read -r input
if { read -r own < "$0"; } 2>/dev/null; then own_result=allowed; else own_result=denied; fi
if { read -r secret < "$1"; } 2>/dev/null; then read_result=allowed; else read_result=denied; fi
if { printf x > "$2"; } 2>/dev/null; then write_result=allowed; else write_result=denied; fi
printf '{"input":"%s","own":"%s","read":"%s","write":"%s"}' "$input" "$own_result" "$read_result" "$write_result"
printf 'bad input\\n' 1>&2
exit 2
`;

/** 환경 변수 값을 그대로 적는 스크립트. 허용된 것은 값으로, 허용되지 않은 것은 `unset`으로 나온다 */
const ENV_SCRIPT =
  'printf \'{"home":"%s","key":"%s","marker":"%s"}\' "$HOME" "${ANTHROPIC_API_KEY-unset}" "${MARKER-unset}"\n';

const LOGGER: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => LOGGER,
};

/** PATH에서 찾는 실행 파일. 버전은 시험이 보지 않으므로 고정이다 */
function resolveOnPath(name: BinaryName): Promise<Result<ResolvedBinary, BinaryError>> {
  const found = Bun.which(name);
  return Promise.resolve(
    found === null
      ? err({ kind: "not_found", name, searched: [], hint: "" })
      : ok({ name, path: found, version: "99.0.0", source: "system" }),
  );
}

/** 테스트용 로더 파일 포트. 실제 파일 시스템을 본다 */
const nodeFs: LoaderFs = {
  readText: async (path) => (existsSync(path) ? readFileSync(path, "utf8") : null),
  listDir: async (path) =>
    existsSync(path)
      ? readdirSync(path, { withFileTypes: true }).map(
          (entry): { name: string; kind: "file" | "dir" | "symlink" } => ({
            name: entry.name,
            kind: entry.isSymbolicLink() ? "symlink" : entry.isDirectory() ? "dir" : "file",
          }),
        )
      : null,
  exists: async (path) => existsSync(path),
  realpath: async (path) => realpathSync(path),
};

interface Box {
  readonly root: string;
  readonly tree: string;
  readonly outside: string;
  readonly secretPath: string;
  readonly writePath: string;
  readonly scheduler: SystemScheduler;
  readonly service: SandboxServiceHandle;
}

async function createService(
  dirs: OsDirs,
  scheduler: SystemScheduler,
): Promise<SandboxServiceHandle> {
  return createSandboxService(
    {
      os: {
        dirs,
        time: { clock: systemClock(), scheduler, random: systemRandom() },
        logger: () => LOGGER,
        resolveBinary: (name) => resolveOnPath(name),
      },
      settings: () => readSandboxSettings(() => undefined),
    },
    new AbortController().signal,
  );
}

/** 임시 폴더와 샌드박스 서비스를 만든다. 확장 폴더 `tree/`와 밖의 `outside/`(비밀 파일이 있다)를 나눈다 */
async function openBox(): Promise<Box> {
  const root = realpathSync(mkdtempSync(join(DISK_TMP, "fresnel-script-sandbox-")));
  const dirs: OsDirs = {
    home: join(root, "home"),
    data: join(root, "data"),
    config: join(root, "config"),
    cache: join(root, "cache"),
    state: join(root, "state"),
    runtime: join(root, "run"),
    resource: join(root, "resource"),
    tmp: join(root, "tmp"),
  };
  const tree = join(root, "plugin", "tree");
  const outside = join(root, "outside");
  for (const dir of [
    dirs.home,
    dirs.data,
    dirs.config,
    dirs.cache,
    dirs.state,
    dirs.runtime,
    dirs.resource,
    dirs.tmp,
    tree,
    outside,
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(outside, "secret.txt"), SECRET);
  writeFileSync(join(tree, "check.sh"), CHECK_SCRIPT);
  const scheduler = systemScheduler();
  // srt는 프로세스 전역 싱글턴이다. 먼저 만든 서비스를 끄고(srt를 되돌린다) 나서 시험 서비스를 만든다
  const warmup = await createService(dirs, scheduler);
  await warmup.dispose();
  const service = await createService(dirs, scheduler);
  return {
    root,
    tree,
    outside,
    secretPath: join(outside, "secret.txt"),
    writePath: join(outside, "written.txt"),
    scheduler,
    service,
  };
}

async function closeBox(box: Box): Promise<void> {
  await box.service.dispose();
  box.scheduler.dispose();
  rmSync(box.root, { recursive: true, force: true });
}

/** 샌드박스를 쓸 수 있는가. 쓸 수 없으면 이유를 함께 돌려준다 */
async function sandboxRunnable(): Promise<{ readonly runnable: boolean; readonly reason: string }> {
  const box = await openBox();
  try {
    const status = box.service.status();
    return {
      runnable: status.available,
      reason: status.reason ?? "the sandbox service is not available",
    };
  } finally {
    await closeBox(box);
  }
}

const environment = await sandboxRunnable();
if (!environment.runnable) {
  if (Bun.env["FRESNEL_REQUIRE_SANDBOX"] === "1" || Bun.env["CI"] === "true") {
    process.stderr.write(`ENV script-sandbox.int: ${environment.reason}\n`);
    process.exit(ENVIRONMENT_EXIT_CODE);
  }
  process.stderr.write("SKIPPED script-sandbox.int: sandbox not runnable here\n");
}
const suite = environment.runnable ? describe : describe.skip;

suite("the script runner under the real sandbox", () => {
  test(
    "a script in the plugin folder runs sandboxed: its code, output and stderr come back as values, and it cannot read or write outside the folder",
    async () => {
      const box = await openBox();
      const platform = detectProcessPlatform();
      if (!platform.ok) throw new Error("this test needs a supported platform");
      const background: BackgroundRegistryController = createBackgroundRegistry({
        clock: systemClock(),
        scheduler: box.scheduler,
        ids: createLocalIdFactory(systemClock(), systemRandom()),
        logger: LOGGER,
      });
      try {
        const port = createIsolationProcessPort({
          platform: platform.value,
          background,
          sandbox: () => box.service,
          parentEnv: { PATH: process.env["PATH"] },
          scheduler: box.scheduler,
          logger: LOGGER,
        });
        const scripts: ManifestScriptDecl[] = [
          {
            name: "check",
            runner: "sh",
            file: "check.sh",
            args: [box.secretPath, box.writePath],
          },
        ];
        const runner = createScriptRunner({
          process: port,
          fs: nodeFs,
          target: { extension: "demo", scripts, tree: box.tree, approved: true },
          resolveRunner: (name) => (name === "sh" ? "/bin/sh" : undefined),
          allowedEnv: {},
          setTimer: (ms, fn) => {
            const handle = box.scheduler.setTimeout(fn, ms);
            return () => box.scheduler.clearTimeout(handle);
          },
        });
        const outcome = await runner.run({
          registration: "demo",
          name: "check",
          stdin: "hi",
          replay: false,
        });
        // 표준 오류는 스크립트가 쓴 줄로 끝난다. 플랫폼의 셸이 앞에 줄을 더할 수 있으므로 끝을 본다
        const expected: Omit<ScriptRunResult, "stderr"> = {
          exitCode: 2,
          signal: null,
          stdout: '{"input":"hi","own":"allowed","read":"denied","write":"denied"}',
          stdoutTruncated: false,
          stderrTruncated: false,
          timedOut: false,
        };
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        const { stderr, ...rest } = outcome.value;
        expect(rest).toEqual(expected);
        expect(stderr.endsWith("bad input\n")).toBe(true);
        expect(existsSync(box.writePath)).toBe(false);
        expect(JSON.stringify(outcome)).not.toContain(SECRET);
      } finally {
        await background.close({ graceMs: 100 });
        await closeBox(box);
      }
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the runner and the allowed environment that the assembly gives the loader reach a declared sh script under the sandbox: it sees the allowed values only",
    async () => {
      const box = await openBox();
      const platform = detectProcessPlatform();
      if (!platform.ok) throw new Error("this test needs a supported platform");
      const background: BackgroundRegistryController = createBackgroundRegistry({
        clock: systemClock(),
        scheduler: box.scheduler,
        ids: createLocalIdFactory(systemClock(), systemRandom()),
        logger: LOGGER,
      });
      try {
        const home = join(box.root, "home");
        const parentEnv = {
          PATH: process.env["PATH"],
          HOME: home,
          MARKER: "marker-value",
          ANTHROPIC_API_KEY: "must-not-reach-the-script",
        };
        const port = createIsolationProcessPort({
          platform: platform.value,
          background,
          sandbox: () => box.service,
          parentEnv,
          scheduler: box.scheduler,
          logger: LOGGER,
        });
        // 실행기와 허용 환경은 조립이 준 값을 그대로 쓴다(루프가 하는 것과 같은 연결)
        const assembly = createPluginHostAssembly({
          scheduler: box.scheduler,
          logger: LOGGER,
          maskSecrets: (line) => line,
          autoDisabler: { disableNow: () => undefined },
          processPort: port,
          stateDir: join(box.root, "state"),
          settingValue: () => undefined,
          now: () => 0,
          parentEnv,
        });
        if (assembly.process === undefined) throw new Error("the assembly has no process port");
        expect(assembly.isolation.runner?.("sh")).toBe("/bin/sh");
        writeFileSync(join(box.tree, "env.sh"), ENV_SCRIPT);
        const scripts: ManifestScriptDecl[] = [
          {
            name: "env",
            runner: "sh",
            file: "env.sh",
            envNames: ["ANTHROPIC_API_KEY", "HOME", "MARKER"],
          },
        ];
        const runner = createScriptRunner({
          process: assembly.process,
          fs: nodeFs,
          target: { extension: "demo", scripts, tree: box.tree, approved: true },
          resolveRunner: assembly.isolation.runner ?? (() => undefined),
          allowedEnv: assembly.isolation.allowedEnv ?? {},
          setTimer: (ms, fn) => {
            const handle = box.scheduler.setTimeout(fn, ms);
            return () => box.scheduler.clearTimeout(handle);
          },
        });
        const outcome = await runner.run({
          registration: "demo",
          name: "env",
          stdin: "",
          replay: false,
        });
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        // HOME은 허용 목록이라 온다. 시크릿 모양의 이름과 허용 목록 밖의 이름은 값이 없다(unset)
        expect(outcome.value).toMatchObject({
          exitCode: 0,
          signal: null,
          stdout: `{"home":"${home}","key":"unset","marker":"unset"}`,
          stdoutTruncated: false,
          timedOut: false,
        });
        expect(JSON.stringify(outcome)).not.toContain("must-not-reach-the-script");
      } finally {
        await background.close({ graceMs: 100 });
        await closeBox(box);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
