import { afterEach, expect, test } from "bun:test";
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
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { err, ok, type LogFields, type Logger, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  HookProcessPort,
  HookRunSpec,
  IsolatedChild,
  IsolationProcessPort,
  IsolationSpawnError,
  IsolationSpawnSpec,
  LoaderFs,
  ManifestScriptDecl,
  PluginScriptPort,
  ScriptDraftGate,
  ScriptEnvDecl,
  ScriptEnvGrant,
  ScriptRunFailure,
  ScriptRunRequest,
  ScriptRunResult,
} from "@fresnel/contracts/extensions";
import {
  createScriptRunner,
  type ScriptRefReader,
  type ScriptRunnerDeps,
  type ScriptTarget,
} from "../../src/isolation/script-runner.ts";
import { fixedIdFactory } from "../../src/testing/index.ts";

// 환경 모드(AGE-58)의 실행기 시험. 기본 길은 샌드박스 없이 훅 포트(`hookProcess`)로 돈다. 샌드박스 길(`envSandboxed: () => true`)은
// 띄우기 포트(`process.spawn`)로 돈다. 좁은 모드는 script-runner.test.ts가 그대로 본다.
// 두 포트는 가짜다: 실제 프로세스를 띄우지 않고 받은 명세를 기록한 뒤 계획대로 답한다. 값으로 비교한다.
// 헬퍼(자식, 시계, 파일 시스템)는 script-runner.test.ts의 것을 그대로 옮겼다.

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 임시 폴더. 맥의 `/var`가 `/private/var`로 풀리므로 실제 경로로 만든다 */
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "script-runner-env-"));
  dirs.push(dir);
  return realpathSync(dir);
}

/** 명령 원문과 같은 내용의 동반 파일(`hook.cmd`)과 좁은 모드의 `check.sh`를 가진 확장 루트 `tree/` */
const COMMAND = "echo $CLAUDE_PROJECT_DIR && ./lint.sh --strict";

function layout(): string {
  const tree = join(tempRoot(), "tree");
  mkdirSync(tree);
  writeFileSync(join(tree, "hook.cmd"), `${COMMAND}\n`);
  writeFileSync(join(tree, "check.sh"), "echo ok\n");
  return tree;
}

/** 테스트에 필요한 만큼의 LoaderFs. 실제 파일 시스템을 본다 */
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

interface Plan {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exit?: { readonly code: number | null; readonly signal: string | null };
  /** 표준 입력을 다 읽어도 끝나지 않는다(기한 시험). 죽이면 끝난다 */
  readonly hang?: boolean;
}

interface Launched {
  readonly spec: IsolationSpawnSpec;
  readonly stdinText: () => string;
  readonly signals: string[];
}

interface ExitInfo {
  readonly code: number | null;
  readonly signal: string | null;
}

/** 스트림이 끝까지 읽혀 `end`가 나면 끝난 것이다. 실제 자식도 표준 출력이 닫힌 뒤에 끝났다고 답한다 */
function endOf(stream: PassThrough): Promise<void> {
  return new Promise<void>((resolve) => {
    stream.on("end", () => resolve());
  });
}

/** 표준 입력을 다 받으면 계획대로 출력하고 끝나는 자식 하나 */
function startChild(plan: Plan): {
  child: IsolatedChild;
  stdinText: () => string;
  signals: string[];
} {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdin.setEncoding("utf8");
  let input = "";
  stdin.on("data", (chunk: string) => {
    input += chunk;
  });
  const signals: string[] = [];
  let outcome: ExitInfo | undefined;
  let finished = false;
  const drained = Promise.all([endOf(stdout), endOf(stderr)]);
  const exited = drained.then((): ExitInfo => outcome ?? { code: null, signal: null });
  function finish(info: ExitInfo): void {
    if (finished) return;
    finished = true;
    outcome = info;
    stdout.end(plan.stdout ?? "");
    stderr.end(plan.stderr ?? "");
  }
  stdin.on("finish", () => {
    if (plan.hang !== true) finish(plan.exit ?? { code: 0, signal: null });
  });
  const child: IsolatedChild = {
    pid: 4242,
    stdin,
    stdout,
    stderr,
    exited,
    kill(signal) {
      signals.push(signal);
      finish({ code: null, signal: "SIGKILL" });
    },
  };
  return { child, stdinText: () => input, signals };
}

interface FakePort {
  readonly port: IsolationProcessPort;
  /** 띄우기 호출마다 받은 명세를 받은 순서대로 기록한다(실패한 호출도) */
  readonly specs: IsolationSpawnSpec[];
  /** 실제로 띄운 자식 */
  readonly children: Launched[];
}

/** 띄우기 포트 대역. `failure`가 있으면 띄우지 않고 그 오류를 값으로 낸다 */
function fakeProcess(plan: Plan, failure?: IsolationSpawnError): FakePort {
  const specs: IsolationSpawnSpec[] = [];
  const children: Launched[] = [];
  const port: IsolationProcessPort = {
    async spawn(spec) {
      specs.push(spec);
      if (failure !== undefined) return err(failure);
      const started = startChild(plan);
      children.push({ spec, stdinText: started.stdinText, signals: started.signals });
      return ok(started.child);
    },
  };
  return { port, specs, children };
}

/** 훅 포트 계획. 생략하면 표준 출력과 오류가 비고 종료 코드 0이다 */
interface HookPlan {
  readonly stdout?: string;
  readonly stdoutTruncated?: boolean;
  readonly stderr?: string;
  readonly exit?: ExitInfo;
  readonly timedOut?: boolean;
  /** 명령을 시작하지 못했다(예: `ENOENT`). 결과의 `spawnError`로 간다 */
  readonly spawnError?: string;
  /** 기한 신호가 올 때까지 끝나지 않는다. 신호가 오면 기한이 난 것으로 답한다(기한 연결 시험) */
  readonly waitForAbort?: boolean;
}

interface FakeHook {
  readonly port: HookProcessPort;
  /** 훅 포트가 받은 명세를 받은 순서대로 기록한다 */
  readonly runs: HookRunSpec[];
}

/** 훅 실행 포트 대역. 명세를 기록하고 계획대로 답한다. 실제 프로세스는 띄우지 않는다 */
function fakeHook(plan: HookPlan = {}): FakeHook {
  const runs: HookRunSpec[] = [];
  const port: HookProcessPort = {
    async run(spec) {
      runs.push(spec);
      if (plan.waitForAbort === true) {
        await new Promise<void>((resolve) => {
          if (spec.signal.aborted) resolve();
          else spec.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return {
          exitCode: null,
          signal: "SIGKILL",
          stdout: "",
          stdoutTruncated: false,
          stderr: "",
          timedOut: true,
        };
      }
      const exit = plan.exit ?? { code: 0, signal: null };
      return {
        exitCode: exit.code,
        signal: exit.signal,
        stdout: plan.stdout ?? "",
        stdoutTruncated: plan.stdoutTruncated ?? false,
        stderr: plan.stderr ?? "",
        timedOut: plan.timedOut ?? false,
        ...(plan.spawnError === undefined ? {} : { spawnError: plan.spawnError }),
      };
    },
  };
  return { port, runs };
}

/** 명세의 값 부분. 신호는 따로 본다(`AbortSignal`은 값으로 비교하지 않는다) */
function valuesOf(run: HookRunSpec): Omit<HookRunSpec, "signal"> {
  return {
    argv: run.argv,
    cwd: run.cwd,
    env: run.env,
    stdin: run.stdin,
    maxStdoutChars: run.maxStdoutChars,
    maxStderrChars: run.maxStderrChars,
  };
}

/** 기본 길에서 종료 코드 0으로 끝난 결과(출력 없음) */
const RAN_CLEAN: Result<ScriptRunResult, ScriptRunFailure> = {
  ok: true,
  value: {
    exitCode: 0,
    signal: null,
    stdout: "",
    stdoutTruncated: false,
    stderr: "",
    stderrTruncated: false,
    timedOut: false,
  },
};

interface ArmedTimer {
  readonly ms: number;
  readonly fn: () => void;
  cancelled: boolean;
}

/** 손으로 울리는 시계. 기한을 건 순간을 기다렸다가 울린다(시간에 기대지 않는다) */
function manualTimers(): {
  setTimer: (ms: number, fn: () => void) => () => void;
  armed: () => Promise<void>;
  fire: () => void;
  timers: ArmedTimer[];
} {
  const timers: ArmedTimer[] = [];
  let onArm: (() => void) | undefined;
  return {
    setTimer(ms, fn) {
      const timer: ArmedTimer = { ms, fn, cancelled: false };
      timers.push(timer);
      onArm?.();
      return () => {
        timer.cancelled = true;
      };
    },
    armed() {
      if (timers.length > 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        onArm = () => resolve();
      });
    },
    fire() {
      for (const timer of timers) if (!timer.cancelled) timer.fn();
    },
    timers,
  };
}

const SH_RESOLVER = (name: string): string | undefined => (name === "sh" ? "/bin/sh" : undefined);
const BASH_PATH = "/opt/homebrew/bin/bash";

const GRANT_DIR = "/work/project-grant";
const THREAD_DIR = "/work/project-thread";
const GRANTED: ScriptEnvGrant = { granted: true, projectDir: GRANT_DIR, fromProject: true };
const THREAD: ThreadId = fixedIdFactory(41).next("thr");
const REQUEST: ScriptRunRequest = { registration: "demo", name: "hook", stdin: "", replay: false };
const IN_THREAD: ScriptRunRequest = { ...REQUEST, threadId: THREAD };

const REF_ALPHA = "/refs/alpha-config.json";
const REF_ZED = "/refs/zed-config.json";
const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

const USER_ENV = async (): Promise<Readonly<Record<string, string>>> => ({
  PATH: "/usr/bin:/bin",
  HOME: "/Users/tester",
});

/** 환경 모드 선언 하나. 명령 원문은 `COMMAND`, 동반 파일은 `hook.cmd`다 */
function hookOf(
  refs: ScriptEnvDecl["refs"] = [],
  shell: ScriptEnvDecl["shell"] = "sh",
  refsKnown = true,
): ManifestScriptDecl {
  return {
    name: "hook",
    runner: "sh",
    file: "hook.cmd",
    env: { command: COMMAND, shell, refs, refsKnown },
  };
}

function envTarget(
  tree: string,
  scripts: ManifestScriptDecl[],
  grant: ScriptEnvGrant | undefined,
  approved = true,
): ScriptTarget {
  return {
    extension: "demo",
    scripts,
    tree,
    approved,
    ...(grant === undefined ? {} : { envGrant: grant }),
  };
}

/** 환경 모드 시험의 실행기. 시계는 손으로 울리고, 실행기 이름은 `sh`(또는 주어진 대역)만 푼다 */
function runnerFor(
  target: ScriptTarget,
  port: IsolationProcessPort,
  extra: Partial<ScriptRunnerDeps> = {},
): PluginScriptPort {
  return createScriptRunner({
    process: port,
    fs: nodeFs,
    target,
    resolveRunner: SH_RESOLVER,
    allowedEnv: {},
    setTimer: manualTimers().setTimer,
    ...extra,
  });
}

interface Attempt {
  readonly outcome: Result<ScriptRunResult, ScriptRunFailure>;
  /** 띄우기 포트(샌드박스 길)가 받은 호출 수. 거절된 호출은 0이어야 한다 */
  readonly spawns: number;
  /** 훅 포트(기본 길)가 받은 호출 수. 거절된 호출은 0이어야 한다 */
  readonly hookRuns: number;
}

/** 한 번 돌려 본다. 두 포트는 모두 가짜다. 훅은 `hook` 계획대로 답한다 */
async function attempt(
  target: ScriptTarget,
  request: ScriptRunRequest,
  extra: Partial<ScriptRunnerDeps> = {},
  hook: HookPlan = {},
): Promise<Attempt> {
  const proc = fakeProcess({});
  const hooks = fakeHook(hook);
  const outcome = await runnerFor(target, proc.port, {
    hookProcess: () => hooks.port,
    ...extra,
  }).run(request);
  return { outcome, spawns: proc.specs.length, hookRuns: hooks.runs.length };
}

// ── 1. 안전: 자격이 없으면 돌지 않는다 ─────────────────────────────────────────

test("environment mode without a usable grant (none, disabled, a draft, or no absolute folder) is refused as script_env_not_granted and nothing starts", async () => {
  const tree = layout();
  const decl = hookOf();
  const gateCalls: string[] = [];
  const gate: ScriptDraftGate = async (call) => {
    gateCalls.push(call.name);
    return call.run(new AbortController().signal);
  };
  const withUserEnv = { userEnv: USER_ENV };
  const noGrant = await attempt(envTarget(tree, [decl], undefined), REQUEST, withUserEnv);
  const denied = await attempt(
    envTarget(tree, [decl], { granted: false, projectDir: GRANT_DIR, fromProject: true }),
    REQUEST,
    withUserEnv,
  );
  const draftWithGate = await attempt(envTarget(tree, [decl], GRANTED, false), IN_THREAD, {
    ...withUserEnv,
    draftGate: gate,
  });
  const noFolder = await attempt(
    envTarget(tree, [decl], { granted: true, projectDir: null, fromProject: true }),
    REQUEST,
    { ...withUserEnv, projectDirOf: () => undefined },
  );
  const relativeFolder = await attempt(
    envTarget(tree, [decl], { granted: true, projectDir: null, fromProject: true }),
    REQUEST,
    { ...withUserEnv, projectDirOf: () => "relative/project" },
  );
  // 호스트가 준 절대 경로가 있어도 대화가 준 상대 경로가 이긴다(`??`), 그래서 거절된다
  const relativeWins = await attempt(envTarget(tree, [decl], GRANTED), REQUEST, {
    ...withUserEnv,
    projectDirOf: () => "relative/project",
  });
  const refused = err<ScriptRunFailure>({ kind: "script_env_not_granted" });
  const none = { outcome: refused, spawns: 0, hookRuns: 0 };
  expect([noGrant, denied, draftWithGate, noFolder, relativeFolder, relativeWins]).toEqual([
    none,
    none,
    none,
    none,
    none,
    none,
  ]);
  expect(gateCalls).toEqual([]);
});

test("the not-granted answer comes before the companion file, the refs and the folder are read", async () => {
  const tree = layout();
  rmSync(join(tree, "hook.cmd"));
  const refs = memoryRefs();
  // 가져올 때의 지문과 다르다: 확인했다면 `script_ref_changed`가 났을 것이다
  refs.files.set(REF_ALPHA, { size: 3, mtimeMs: 1, hash: HASH_B });
  const decl = hookOf([{ path: REF_ALPHA, hash: HASH_A }]);
  const missingCompanion = await attempt(envTarget(tree, [decl], undefined), REQUEST, {
    userEnv: USER_ENV,
    refs: refs.reader,
  });
  const outsideCompanion = await attempt(
    envTarget(tree, [{ ...decl, file: "../escape.cmd" }], undefined),
    REQUEST,
    { userEnv: USER_ENV, refs: refs.reader },
  );
  expect([missingCompanion, outsideCompanion]).toEqual([
    {
      outcome: { ok: false, error: { kind: "script_env_not_granted" } },
      spawns: 0,
      hookRuns: 0,
    },
    {
      outcome: { ok: false, error: { kind: "script_env_not_granted" } },
      spawns: 0,
      hookRuns: 0,
    },
  ]);
  expect(refs.statCalls).toEqual([]);
  expect(refs.hashCalls).toEqual([]);
});

test("with the grant, a missing companion is script_missing and nothing starts (the grant does not skip the location check)", async () => {
  const tree = layout();
  rmSync(join(tree, "hook.cmd"));
  const refs = memoryRefs();
  const outcome = await attempt(envTarget(tree, [hookOf()], GRANTED), REQUEST, {
    userEnv: USER_ENV,
    refs: refs.reader,
  });
  expect(outcome).toEqual({
    outcome: { ok: false, error: { kind: "script_missing" } },
    spawns: 0,
    hookRuns: 0,
  });
  expect(refs.statCalls).toEqual([]);
});

// ── 2. 자격이 있는 정상 경로: 기본 길(훅 포트)과 샌드박스 길(띄우기 포트) ─────────

test("sandboxed: a granted run spawns the original command under the shell, in the thread's project folder, with the filtered environment", async () => {
  const tree = layout();
  const refs = memoryRefs();
  refs.files.set(REF_ALPHA, { size: 12, mtimeMs: 5, hash: HASH_A });
  const fake = fakeProcess({ stdout: "ok" });
  const asked: (ThreadId | undefined)[] = [];
  const carveInput: (readonly string[])[] = [];
  const outcome = await runnerFor(
    envTarget(tree, [hookOf([{ path: REF_ALPHA, hash: HASH_A }])], GRANTED),
    fake.port,
    {
      envSandboxed: () => true,
      userEnv: USER_ENV,
      refs: refs.reader,
      projectDirOf: (threadId) => {
        asked.push(threadId);
        return THREAD_DIR;
      },
      readCarveOutsFor: (paths) => {
        carveInput.push(paths);
        return ["/Users/tester/.claude/hooks"];
      },
    },
  ).run(IN_THREAD);
  expect(outcome).toEqual({
    ok: true,
    value: {
      exitCode: 0,
      signal: null,
      stdout: "ok",
      stdoutTruncated: false,
      stderr: "",
      stderrTruncated: false,
      timedOut: false,
    },
  });
  expect(fake.specs).toStrictEqual([
    {
      command: "/bin/sh",
      args: ["-c", COMMAND],
      readRoot: THREAD_DIR,
      systemTools: true,
      scriptEnv: { projectDir: THREAD_DIR, readCarveOuts: ["/Users/tester/.claude/hooks"] },
      env: { PATH: "/usr/bin:/bin", HOME: "/Users/tester", CLAUDE_PROJECT_DIR: THREAD_DIR },
      label: "script:demo:hook",
    },
  ]);
  // 대화 폴더가 이긴다(grant의 폴더는 아니다). 대화 id는 요청에서 그대로 넘어온다
  expect(asked).toEqual([THREAD]);
  // 읽기 예외 후보는 참조 파일 경로 그대로다. 지문은 한 번만 낸다
  expect(carveInput).toEqual([[REF_ALPHA]]);
  expect(refs.hashCalls).toEqual([REF_ALPHA]);
});

test("default: a granted run hands the original command to the hook port under the shell, in the thread's project folder, with stdin and the output limits", async () => {
  const tree = layout();
  const hook = fakeHook({ stdout: "ok" });
  const proc = fakeProcess({});
  const outcome = await runnerFor(envTarget(tree, [hookOf()], GRANTED), proc.port, {
    userEnv: USER_ENV,
    hookProcess: () => hook.port,
    projectDirOf: () => THREAD_DIR,
  }).run({ ...IN_THREAD, stdin: "payload" });
  expect(outcome).toEqual({
    ok: true,
    value: {
      exitCode: 0,
      signal: null,
      stdout: "ok",
      stdoutTruncated: false,
      stderr: "",
      stderrTruncated: false,
      timedOut: false,
    },
  });
  // 출력 상한은 `SCRIPT_LIMITS.outputBytes`(64 KiB)다
  expect(hook.runs.map(valuesOf)).toStrictEqual([
    {
      argv: ["/bin/sh", "-c", COMMAND],
      cwd: THREAD_DIR,
      env: { PATH: "/usr/bin:/bin", HOME: "/Users/tester", CLAUDE_PROJECT_DIR: THREAD_DIR },
      stdin: "payload",
      maxStdoutChars: 65536,
      maxStderrChars: 65536,
    },
  ]);
  expect(hook.runs.map((run) => run.signal instanceof AbortSignal)).toEqual([true]);
  // 기본 길에서는 띄우기 포트를 부르지 않는다
  expect(proc.specs.length).toBe(0);
});

test("default: without a thread folder the hook's folder comes from the grant, and a grant without a folder takes the thread's folder", async () => {
  const tree = layout();
  const fromGrant = fakeHook({});
  await runnerFor(envTarget(tree, [hookOf()], GRANTED), fakeProcess({}).port, {
    userEnv: USER_ENV,
    projectDirOf: () => undefined,
    hookProcess: () => fromGrant.port,
  }).run(REQUEST);
  const fromThread = fakeHook({});
  await runnerFor(
    envTarget(tree, [hookOf()], { granted: true, projectDir: null, fromProject: false }),
    fakeProcess({}).port,
    { userEnv: USER_ENV, projectDirOf: () => THREAD_DIR, hookProcess: () => fromThread.port },
  ).run(IN_THREAD);
  expect(fromGrant.runs.map((run) => run.cwd)).toEqual([GRANT_DIR]);
  expect(fromGrant.runs.map((run) => run.env["CLAUDE_PROJECT_DIR"])).toEqual([GRANT_DIR]);
  expect(fromThread.runs.map((run) => run.cwd)).toEqual([THREAD_DIR]);
  expect(fromThread.runs.map((run) => run.env["CLAUDE_PROJECT_DIR"])).toEqual([THREAD_DIR]);
});

test("default: shell bash uses the runner resolved for bash, with the same command string", async () => {
  const tree = layout();
  const asked: string[] = [];
  const hook = fakeHook({});
  await runnerFor(envTarget(tree, [hookOf([], "bash")], GRANTED), fakeProcess({}).port, {
    userEnv: USER_ENV,
    hookProcess: () => hook.port,
    resolveRunner: (name) => {
      asked.push(name);
      return name === "bash" ? BASH_PATH : undefined;
    },
  }).run(REQUEST);
  expect(asked).toEqual(["bash"]);
  expect(hook.runs.map(valuesOf)).toStrictEqual([
    {
      argv: [BASH_PATH, "-c", COMMAND],
      cwd: GRANT_DIR,
      env: { PATH: "/usr/bin:/bin", HOME: "/Users/tester", CLAUDE_PROJECT_DIR: GRANT_DIR },
      stdin: "",
      maxStdoutChars: 65536,
      maxStderrChars: 65536,
    },
  ]);
});

// ── 3. 환경 정책 표: 기본 길은 사용자 환경을 넘기고, 샌드박스 길은 시크릿 이름을 뺀다 ──

test("sandboxed: the environment reaching the child is only the allowed names (PATH, HOME, LANG, MISE_SHELL and the project folder); secret-named and invalid names are dropped", async () => {
  const tree = layout();
  const fake = fakeProcess({});
  const userEnv: Readonly<Record<string, string>> = {
    PATH: "/usr/bin:/bin",
    HOME: "/Users/tester",
    LANG: "en_US.UTF-8",
    MISE_SHELL: "zsh",
    CLAUDE_PROJECT_DIR: "/somewhere/else",
    AWS_SECRET_ACCESS_KEY: "aws-value",
    GITHUB_TOKEN: "gh-value",
    github_token: "lower-value",
    MY_API_KEY: "api-value",
    SSH_AUTH_SOCK: "/tmp/agent.sock",
    FRESNEL_HOME: "/Users/tester/.fresnel",
    NODE_OPTIONS: "--require /evil.js",
    SOPS_AGE_KEY_FILE: "/Users/tester/key.txt",
    "bad-name": "bad",
    "1X": "digit",
  };
  await runnerFor(envTarget(tree, [hookOf()], GRANTED), fake.port, {
    envSandboxed: () => true,
    userEnv: async () => userEnv,
  }).run(REQUEST);
  expect(fake.specs.map((spec) => spec.env)).toStrictEqual([
    {
      PATH: "/usr/bin:/bin",
      HOME: "/Users/tester",
      LANG: "en_US.UTF-8",
      MISE_SHELL: "zsh",
      // 사용자 환경의 값은 프로젝트 폴더로 덮인다
      CLAUDE_PROJECT_DIR: GRANT_DIR,
    },
  ]);
});

test("default: the hook gets the user's environment minus Fresnel internals (FRESNEL_*, _FRESNEL_*) and invalid names, with the project folder as CLAUDE_PROJECT_DIR", async () => {
  const tree = layout();
  const hook = fakeHook({});
  const userEnv: Readonly<Record<string, string>> = {
    PATH: "/usr/bin:/bin",
    HOME: "/Users/tester",
    LANG: "en_US.UTF-8",
    MISE_SHELL: "zsh",
    CLAUDE_PROJECT_DIR: "/somewhere/else",
    GH_TOKEN: "gh-value",
    AWS_ACCESS_KEY_ID: "aws-id-value",
    SSH_AUTH_SOCK: "/tmp/agent.sock",
    ANTHROPIC_API_KEY: "anthropic-value",
    NODE_OPTIONS: "--require /evil.js",
    FRESNEL_HOME: "/Users/tester/.fresnel",
    fresnel_dev: "dev-value",
    __FRESNEL_X: "internal-value",
    "bad-name": "bad",
    "1X": "digit",
  };
  const proc = fakeProcess({});
  await runnerFor(envTarget(tree, [hookOf()], GRANTED), proc.port, {
    userEnv: async () => userEnv,
    hookProcess: () => hook.port,
  }).run(REQUEST);
  expect(hook.runs.map((run) => run.env)).toStrictEqual([
    {
      PATH: "/usr/bin:/bin",
      HOME: "/Users/tester",
      LANG: "en_US.UTF-8",
      MISE_SHELL: "zsh",
      GH_TOKEN: "gh-value",
      AWS_ACCESS_KEY_ID: "aws-id-value",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
      ANTHROPIC_API_KEY: "anthropic-value",
      NODE_OPTIONS: "--require /evil.js",
      CLAUDE_PROJECT_DIR: GRANT_DIR,
    },
  ]);
  expect(proc.specs.length).toBe(0);
});

// ── 4. 참조 파일의 지문 ──────────────────────────────────────────────────

interface MemoryFile {
  readonly size: number;
  readonly mtimeMs: number;
  readonly hash: string;
}

interface MemoryRefs {
  readonly reader: ScriptRefReader;
  /** 있는 파일. 여기 없는 경로는 없음이다 */
  readonly files: Map<string, MemoryFile>;
  /** 겉모습(stat)을 읽지 못하는 경로 */
  readonly statBroken: Set<string>;
  /** 내용(sha256)을 읽지 못하는 경로 */
  readonly hashBroken: Set<string>;
  /** 받은 순서대로 기록한 경로. 호출 횟수는 길이다 */
  readonly statCalls: string[];
  readonly hashCalls: string[];
}

/** 메모리 안의 참조 파일 대역. 호출한 경로를 센다 */
function memoryRefs(): MemoryRefs {
  const files = new Map<string, MemoryFile>();
  const statBroken = new Set<string>();
  const hashBroken = new Set<string>();
  const statCalls: string[] = [];
  const hashCalls: string[] = [];
  const reader: ScriptRefReader = {
    stat: async (path) => {
      statCalls.push(path);
      if (statBroken.has(path)) return err({ kind: "unreadable" });
      const file = files.get(path);
      return ok(file === undefined ? null : { size: file.size, mtimeMs: file.mtimeMs });
    },
    sha256: async (path) => {
      hashCalls.push(path);
      const file = files.get(path);
      if (hashBroken.has(path) || file === undefined) return err({ kind: "unreadable" });
      return ok(file.hash);
    },
  };
  return { reader, files, statBroken, hashBroken, statCalls, hashCalls };
}

test("default: a reference whose fingerprint still matches lets the run start", async () => {
  const tree = layout();
  const refs = memoryRefs();
  refs.files.set(REF_ALPHA, { size: 10, mtimeMs: 100, hash: HASH_A });
  const result = await attempt(
    envTarget(tree, [hookOf([{ path: REF_ALPHA, hash: HASH_A }])], GRANTED),
    REQUEST,
    { userEnv: USER_ENV, refs: refs.reader },
    { stdout: "ok" },
  );
  expect(result).toEqual({
    outcome: {
      ok: true,
      value: {
        exitCode: 0,
        signal: null,
        stdout: "ok",
        stdoutTruncated: false,
        stderr: "",
        stderrTruncated: false,
        timedOut: false,
      },
    },
    spawns: 0,
    hookRuns: 1,
  });
});

test("a reference whose content changed is script_ref_changed with reason changed, and nothing starts", async () => {
  const tree = layout();
  const refs = memoryRefs();
  refs.files.set(REF_ALPHA, { size: 10, mtimeMs: 100, hash: HASH_B });
  const result = await attempt(
    envTarget(tree, [hookOf([{ path: REF_ALPHA, hash: HASH_A }])], GRANTED),
    REQUEST,
    { userEnv: USER_ENV, refs: refs.reader },
  );
  expect(result).toEqual({
    outcome: {
      ok: false,
      error: { kind: "script_ref_changed", path: REF_ALPHA, reason: "changed" },
    },
    spawns: 0,
    hookRuns: 0,
  });
});

test("a reference that is gone is script_ref_changed with reason missing", async () => {
  const tree = layout();
  const refs = memoryRefs();
  const result = await attempt(
    envTarget(tree, [hookOf([{ path: REF_ALPHA, hash: HASH_A }])], GRANTED),
    REQUEST,
    { userEnv: USER_ENV, refs: refs.reader },
  );
  expect(result).toEqual({
    outcome: {
      ok: false,
      error: { kind: "script_ref_changed", path: REF_ALPHA, reason: "missing" },
    },
    spawns: 0,
    hookRuns: 0,
  });
});

test("a reference whose stat or content cannot be read is script_ref_changed with reason unreadable", async () => {
  const tree = layout();
  const statFails = memoryRefs();
  statFails.files.set(REF_ALPHA, { size: 10, mtimeMs: 100, hash: HASH_A });
  statFails.statBroken.add(REF_ALPHA);
  const hashFails = memoryRefs();
  hashFails.files.set(REF_ALPHA, { size: 10, mtimeMs: 100, hash: HASH_A });
  hashFails.hashBroken.add(REF_ALPHA);
  const scripts = [hookOf([{ path: REF_ALPHA, hash: HASH_A }])];
  const onStat = await attempt(envTarget(tree, scripts, GRANTED), REQUEST, {
    userEnv: USER_ENV,
    refs: statFails.reader,
  });
  const onHash = await attempt(envTarget(tree, scripts, GRANTED), REQUEST, {
    userEnv: USER_ENV,
    refs: hashFails.reader,
  });
  const unreadable = err<ScriptRunFailure>({
    kind: "script_ref_changed",
    path: REF_ALPHA,
    reason: "unreadable",
  });
  expect([onStat, onHash]).toEqual([
    { outcome: unreadable, spawns: 0, hookRuns: 0 },
    { outcome: unreadable, spawns: 0, hookRuns: 0 },
  ]);
});

test("with no reference reader at all, a reference that has a fingerprint is unreadable: the failure is closed", async () => {
  const tree = layout();
  const result = await attempt(
    envTarget(tree, [hookOf([{ path: REF_ALPHA, hash: HASH_A }])], GRANTED),
    REQUEST,
    { userEnv: USER_ENV },
  );
  expect(result).toEqual({
    outcome: {
      ok: false,
      error: { kind: "script_ref_changed", path: REF_ALPHA, reason: "unreadable" },
    },
    spawns: 0,
    hookRuns: 0,
  });
});

test("a reference whose fingerprint was not taken at import (null) is not checked: the run starts with no reader, with the file present, or with the file gone", async () => {
  const tree = layout();
  const decl = hookOf([{ path: REF_ALPHA, hash: null }]);
  const withoutReader = await attempt(envTarget(tree, [decl], GRANTED), REQUEST, {
    userEnv: USER_ENV,
  });
  const present = memoryRefs();
  present.files.set(REF_ALPHA, { size: 1, mtimeMs: 1, hash: HASH_A });
  const existing = await attempt(envTarget(tree, [decl], GRANTED), REQUEST, {
    userEnv: USER_ENV,
    refs: present.reader,
  });
  const gone = memoryRefs();
  const absent = await attempt(envTarget(tree, [decl], GRANTED), REQUEST, {
    userEnv: USER_ENV,
    refs: gone.reader,
  });
  expect([withoutReader, existing, absent]).toEqual([
    { outcome: RAN_CLEAN, spawns: 0, hookRuns: 1 },
    { outcome: RAN_CLEAN, spawns: 0, hookRuns: 1 },
    { outcome: RAN_CLEAN, spawns: 0, hookRuns: 1 },
  ]);
  // 확인하지 않으므로 겉모습도 지문도 읽지 않는다
  expect([present.statCalls, present.hashCalls, gone.statCalls, gone.hashCalls]).toEqual([
    [],
    [],
    [],
    [],
  ]);
});

test("refsKnown false with no listed references just runs, and no reference is read", async () => {
  const tree = layout();
  const refs = memoryRefs();
  const result = await attempt(envTarget(tree, [hookOf([], "sh", false)], GRANTED), REQUEST, {
    userEnv: USER_ENV,
    refs: refs.reader,
  });
  expect(result).toEqual({ outcome: RAN_CLEAN, spawns: 0, hookRuns: 1 });
  expect([refs.statCalls, refs.hashCalls]).toEqual([[], []]);
});

test("a fingerprint is computed again only when size or mtime changes or the declared hash changes; the stat happens every time", async () => {
  const tree = layout();
  const refs = memoryRefs();
  refs.files.set(REF_ALPHA, { size: 10, mtimeMs: 100, hash: HASH_A });
  const scripts: ManifestScriptDecl[] = [hookOf([{ path: REF_ALPHA, hash: HASH_A }])];
  const hook = fakeHook({});
  const runner = runnerFor(envTarget(tree, scripts, GRANTED), fakeProcess({}).port, {
    userEnv: USER_ENV,
    refs: refs.reader,
    hookProcess: () => hook.port,
  });
  const trace: { readonly ok: boolean; readonly stats: number; readonly hashes: number }[] = [];
  const step = async (): Promise<void> => {
    const outcome = await runner.run(REQUEST);
    trace.push({ ok: outcome.ok, stats: refs.statCalls.length, hashes: refs.hashCalls.length });
  };
  await step(); // 처음: 겉모습과 지문을 한 번씩
  await step(); // 같은 크기와 수정 시각: 겉모습만 다시 본다
  refs.files.set(REF_ALPHA, { size: 10, mtimeMs: 200, hash: HASH_A });
  await step(); // 수정 시각이 바뀌었다: 지문을 한 번 다시 낸다
  await step(); // 다시 같다: 더 내지 않는다
  // 매니페스트를 고쳐 기대 지문을 바꾼다(파일 겉모습은 그대로): 지문을 다시 내고 다르다고 답한다
  scripts.splice(0, 1, hookOf([{ path: REF_ALPHA, hash: HASH_B }]));
  await step();
  expect(trace).toEqual([
    { ok: true, stats: 1, hashes: 1 },
    { ok: true, stats: 2, hashes: 1 },
    { ok: true, stats: 3, hashes: 2 },
    { ok: true, stats: 4, hashes: 2 },
    { ok: false, stats: 5, hashes: 3 },
  ]);
  expect(hook.runs.length).toBe(4);
});

test("with several references the first failing one in declaration order is reported", async () => {
  const tree = layout();
  const refs = memoryRefs();
  // 두 참조 모두 어긋난다: 하나는 내용이 다르고(zed) 하나는 없다(alpha). 목록 순서가 이긴다(알파벳 순서가 아니다)
  refs.files.set(REF_ZED, { size: 1, mtimeMs: 1, hash: HASH_B });
  const zedFirst = await attempt(
    envTarget(
      tree,
      [
        hookOf([
          { path: REF_ZED, hash: HASH_A },
          { path: REF_ALPHA, hash: HASH_A },
        ]),
      ],
      GRANTED,
    ),
    REQUEST,
    { userEnv: USER_ENV, refs: refs.reader },
  );
  const alphaFirst = await attempt(
    envTarget(
      tree,
      [
        hookOf([
          { path: REF_ALPHA, hash: HASH_A },
          { path: REF_ZED, hash: HASH_A },
        ]),
      ],
      GRANTED,
    ),
    REQUEST,
    { userEnv: USER_ENV, refs: refs.reader },
  );
  expect([zedFirst.outcome, alphaFirst.outcome]).toEqual([
    { ok: false, error: { kind: "script_ref_changed", path: REF_ZED, reason: "changed" } },
    { ok: false, error: { kind: "script_ref_changed", path: REF_ALPHA, reason: "missing" } },
  ]);
  expect([zedFirst.hookRuns, alphaFirst.hookRuns]).toEqual([0, 0]);
});

// ── 5. 돌려 보기, 샌드박스 없음 설정, 사용자 환경, 띄우기 실패 ─────────────────

test("a replay request is replay_mode_denied and nothing starts", async () => {
  const tree = layout();
  const result = await attempt(
    envTarget(tree, [hookOf()], GRANTED),
    { ...REQUEST, replay: true },
    { userEnv: USER_ENV },
  );
  expect(result).toEqual({
    outcome: { ok: false, error: { kind: "replay_mode_denied" } },
    spawns: 0,
    hookRuns: 0,
  });
});

test("sandboxed: when the sandbox is off the run is sandbox_unavailable with reason sandbox_off, and nothing starts", async () => {
  const tree = layout();
  const fake = fakeProcess({});
  const hook = fakeHook({});
  const outcome = await runnerFor(envTarget(tree, [hookOf()], GRANTED), fake.port, {
    envSandboxed: () => true,
    userEnv: USER_ENV,
    sandboxAvailable: () => false,
    hookProcess: () => hook.port,
  }).run(REQUEST);
  expect(outcome).toEqual({
    ok: false,
    error: { kind: "sandbox_unavailable", reason: "sandbox_off" },
  });
  expect(fake.specs.length).toBe(0);
  expect(hook.runs.length).toBe(0);
});

test("default: sandboxAvailable false is ignored; the run goes to the hook port and the process port is never called, whether envSandboxed is absent or false", async () => {
  const tree = layout();
  const proc = fakeProcess({ stdout: "not used" });
  const hook = fakeHook({ stdout: "hooked" });
  const deps = {
    userEnv: USER_ENV,
    hookProcess: () => hook.port,
    sandboxAvailable: () => false,
  };
  const absent = await runnerFor(envTarget(tree, [hookOf()], GRANTED), proc.port, deps).run(
    REQUEST,
  );
  const answersFalse = await runnerFor(envTarget(tree, [hookOf()], GRANTED), proc.port, {
    ...deps,
    envSandboxed: () => false,
  }).run(REQUEST);
  const hooked: Result<ScriptRunResult, ScriptRunFailure> = {
    ok: true,
    value: {
      exitCode: 0,
      signal: null,
      stdout: "hooked",
      stdoutTruncated: false,
      stderr: "",
      stderrTruncated: false,
      timedOut: false,
    },
  };
  expect([absent, answersFalse]).toEqual([hooked, hooked]);
  expect(proc.specs).toEqual([]);
  expect(hook.runs.length).toBe(2);
});

test("without a user environment dependency the run is spawn_failed with code user_env_unavailable, and nothing starts", async () => {
  const tree = layout();
  const fake = fakeProcess({});
  const outcome = await runnerFor(envTarget(tree, [hookOf()], GRANTED), fake.port).run(REQUEST);
  expect(outcome).toEqual({
    ok: false,
    error: {
      kind: "spawn_failed",
      code: "user_env_unavailable",
      message: "the user environment is not available",
    },
  });
  expect(fake.specs.length).toBe(0);
});

test("sandboxed: a spawn refused by the port comes back as the same failure values as the narrow path", async () => {
  const tree = layout();
  const unavailable = fakeProcess({}, { kind: "sandbox_unavailable", reason: "service_missing" });
  const failed = fakeProcess({}, { kind: "spawn_failed", code: "ENOENT", message: "no such file" });
  const onUnavailable = await runnerFor(envTarget(tree, [hookOf()], GRANTED), unavailable.port, {
    envSandboxed: () => true,
    userEnv: USER_ENV,
  }).run(REQUEST);
  const onFailed = await runnerFor(envTarget(tree, [hookOf()], GRANTED), failed.port, {
    envSandboxed: () => true,
    userEnv: USER_ENV,
  }).run(REQUEST);
  expect([onUnavailable, onFailed]).toEqual([
    { ok: false, error: { kind: "sandbox_unavailable", reason: "service_missing" } },
    { ok: false, error: { kind: "spawn_failed", code: "ENOENT", message: "no such file" } },
  ]);
  expect([unavailable.specs.length, failed.specs.length]).toEqual([1, 1]);
});

test("default: without a hook process port the run is spawn_failed with code hook_process_unavailable, whether the port is absent or answers undefined, and nothing starts", async () => {
  const tree = layout();
  const proc = fakeProcess({});
  const absent = await runnerFor(envTarget(tree, [hookOf()], GRANTED), proc.port, {
    userEnv: USER_ENV,
  }).run(REQUEST);
  const answersUndefined = await runnerFor(envTarget(tree, [hookOf()], GRANTED), proc.port, {
    userEnv: USER_ENV,
    hookProcess: () => undefined,
  }).run(REQUEST);
  const unavailable: Result<ScriptRunResult, ScriptRunFailure> = {
    ok: false,
    error: {
      kind: "spawn_failed",
      code: "hook_process_unavailable",
      message: "the hook process port is not available",
    },
  };
  expect([absent, answersUndefined]).toEqual([unavailable, unavailable]);
  expect(proc.specs.length).toBe(0);
});

test("default: a hook command the system refuses to start (spawnError ENOENT) is spawn_failed with that code", async () => {
  const tree = layout();
  const result = await attempt(
    envTarget(tree, [hookOf()], GRANTED),
    REQUEST,
    { userEnv: USER_ENV },
    { spawnError: "ENOENT" },
  );
  expect(result).toEqual({
    outcome: {
      ok: false,
      error: {
        kind: "spawn_failed",
        code: "ENOENT",
        message: "the hook command could not be started",
      },
    },
    spawns: 0,
    hookRuns: 1,
  });
});

test("default: the exit codes 0, 2 and 7 and the stdout and stderr pass through unchanged, with stdoutTruncated from the hook port", async () => {
  const tree = layout();
  const plans: HookPlan[] = [
    { stdout: "fine", exit: { code: 0, signal: null } },
    { stderr: "not ok", exit: { code: 2, signal: null } },
    { stdout: "partial", stdoutTruncated: true, stderr: "boom", exit: { code: 7, signal: null } },
  ];
  const outcomes = await Promise.all(
    plans.map(
      async (plan) =>
        (await attempt(envTarget(tree, [hookOf()], GRANTED), REQUEST, { userEnv: USER_ENV }, plan))
          .outcome,
    ),
  );
  expect(outcomes).toEqual([
    {
      ok: true,
      value: {
        exitCode: 0,
        signal: null,
        stdout: "fine",
        stdoutTruncated: false,
        stderr: "",
        stderrTruncated: false,
        timedOut: false,
      },
    },
    {
      ok: true,
      value: {
        exitCode: 2,
        signal: null,
        stdout: "",
        stdoutTruncated: false,
        stderr: "not ok",
        stderrTruncated: false,
        timedOut: false,
      },
    },
    {
      ok: true,
      value: {
        exitCode: 7,
        signal: null,
        stdout: "partial",
        stdoutTruncated: true,
        stderr: "boom",
        stderrTruncated: false,
        timedOut: false,
      },
    },
  ]);
});

test("default: the hook run gets a deadline signal from the declared timeoutMs; a run that never ends is cut at that deadline and answers timedOut", async () => {
  const tree = layout();
  const hook = fakeHook({ waitForAbort: true });
  // 선언 기한 1ms다. 기본값(10초)이었다면 이 시험은 테스트의 5초 한도에 걸린다
  const decl: ManifestScriptDecl = { ...hookOf(), timeoutMs: 1 };
  const outcome = await runnerFor(envTarget(tree, [decl], GRANTED), fakeProcess({}).port, {
    userEnv: USER_ENV,
    hookProcess: () => hook.port,
  }).run(REQUEST);
  expect(outcome).toEqual({
    ok: true,
    value: {
      exitCode: null,
      signal: "SIGKILL",
      stdout: "",
      stdoutTruncated: false,
      stderr: "",
      stderrTruncated: false,
      timedOut: true,
    },
  });
  expect(hook.runs.map((run) => run.signal instanceof AbortSignal)).toEqual([true]);
  expect(hook.runs.map((run) => run.signal.aborted)).toEqual([true]);
});

// ── 6. 실패 기록(script.env_failed) ──────────────────────────────────────

interface LogCall {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly event: string;
  readonly fields: LogFields | undefined;
}

/** 호출을 기록하는 로거 대역. 자식 로거는 같은 기록에 쓴다 */
function recordingLogger(): { readonly logger: Logger; readonly calls: LogCall[] } {
  const calls: LogCall[] = [];
  const record =
    (level: LogCall["level"]) =>
    (event: string, fields?: LogFields): void => {
      calls.push({ level, event, fields });
    };
  const logger: Logger = {
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    child: () => logger,
  };
  return { logger, calls };
}

test("default: a run that exits 1 logs one warning with the masked last 512 characters of stderr, the default uses, and no environment value", async () => {
  const tree = layout();
  const { logger, calls } = recordingLogger();
  // 머리 200자, 가운데 400자, 끝 "TAIL SECRET". 끝 512자는 머리 101자와 가운데 400자와 꼬리 11자다
  const stderr = `${"H".repeat(200)}${"M".repeat(400)}TAIL SECRET`;
  const hook = fakeHook({ stderr, exit: { code: 1, signal: null } });
  const outcome = await runnerFor(envTarget(tree, [hookOf()], GRANTED), fakeProcess({}).port, {
    userEnv: async () => ({ PATH: "/usr/bin", LANG: "en_US.SENTINEL-LANG-7f3a" }),
    hookProcess: () => hook.port,
    logger,
    maskText: (text) => text.replaceAll("SECRET", "[masked]"),
  }).run(REQUEST);
  expect(outcome).toEqual({
    ok: true,
    value: {
      exitCode: 1,
      signal: null,
      stdout: "",
      stdoutTruncated: false,
      stderr,
      stderrTruncated: false,
      timedOut: false,
    },
  });
  expect(calls).toEqual([
    {
      level: "warn",
      event: "script.env_failed",
      fields: {
        extension: "demo",
        script: "hook",
        exitCode: 1,
        timedOut: false,
        stderrTail: `${"H".repeat(101)}${"M".repeat(400)}TAIL [masked]`,
        uses: "user_full_access,user_environment,network",
      },
    },
  ]);
  const logged = JSON.stringify(calls);
  expect(logged).not.toContain("SENTINEL-LANG-7f3a");
  expect(logged).not.toContain(GRANT_DIR);
});

test("sandboxed: a run that exits 1 logs one warning with the sandboxed uses (user_environment, read_wide, write_project, network)", async () => {
  const tree = layout();
  const { logger, calls } = recordingLogger();
  const fake = fakeProcess({ stderr: "boom", exit: { code: 1, signal: null } });
  await runnerFor(envTarget(tree, [hookOf()], GRANTED), fake.port, {
    envSandboxed: () => true,
    userEnv: USER_ENV,
    logger,
    maskText: (text) => text,
  }).run(REQUEST);
  expect(calls).toEqual([
    {
      level: "warn",
      event: "script.env_failed",
      fields: {
        extension: "demo",
        script: "hook",
        exitCode: 1,
        timedOut: false,
        stderrTail: "boom",
        uses: "user_environment,read_wide,write_project,network",
      },
    },
  ]);
});

test("default: a run that exits 0 or 2 logs nothing", async () => {
  const tree = layout();
  const { logger, calls } = recordingLogger();
  const ok0 = fakeHook({ stdout: "fine", exit: { code: 0, signal: null } });
  const ok2 = fakeHook({ stderr: "not ok", exit: { code: 2, signal: null } });
  const first = await runnerFor(envTarget(tree, [hookOf()], GRANTED), fakeProcess({}).port, {
    userEnv: USER_ENV,
    hookProcess: () => ok0.port,
    logger,
    maskText: (text) => text,
  }).run(REQUEST);
  const second = await runnerFor(envTarget(tree, [hookOf()], GRANTED), fakeProcess({}).port, {
    userEnv: USER_ENV,
    hookProcess: () => ok2.port,
    logger,
    maskText: (text) => text,
  }).run(REQUEST);
  expect([first, second]).toEqual([
    {
      ok: true,
      value: {
        exitCode: 0,
        signal: null,
        stdout: "fine",
        stdoutTruncated: false,
        stderr: "",
        stderrTruncated: false,
        timedOut: false,
      },
    },
    {
      ok: true,
      value: {
        exitCode: 2,
        signal: null,
        stdout: "",
        stdoutTruncated: false,
        stderr: "not ok",
        stderrTruncated: false,
        timedOut: false,
      },
    },
  ]);
  expect(calls).toEqual([]);
});

test("default: a run the hook port reports as timed out logs one warning with a null exit code and timedOut true", async () => {
  const tree = layout();
  const { logger, calls } = recordingLogger();
  const hook = fakeHook({ exit: { code: null, signal: "SIGKILL" }, timedOut: true });
  const outcome = await runnerFor(envTarget(tree, [hookOf()], GRANTED), fakeProcess({}).port, {
    userEnv: USER_ENV,
    hookProcess: () => hook.port,
    logger,
    maskText: (text) => text,
  }).run(REQUEST);
  expect(outcome).toEqual({
    ok: true,
    value: {
      exitCode: null,
      signal: "SIGKILL",
      stdout: "",
      stdoutTruncated: false,
      stderr: "",
      stderrTruncated: false,
      timedOut: true,
    },
  });
  expect(calls).toEqual([
    {
      level: "warn",
      event: "script.env_failed",
      fields: {
        extension: "demo",
        script: "hook",
        exitCode: null,
        timedOut: true,
        stderrTail: "",
        uses: "user_full_access,user_environment,network",
      },
    },
  ]);
});

test("sandboxed: a run that outlives its deadline is killed and logs one warning with a null exit code and timedOut true", async () => {
  const tree = layout();
  const timers = manualTimers();
  const { logger, calls } = recordingLogger();
  const fake = fakeProcess({ hang: true });
  const runner = runnerFor(envTarget(tree, [hookOf()], GRANTED), fake.port, {
    envSandboxed: () => true,
    userEnv: USER_ENV,
    logger,
    maskText: (text) => text,
    setTimer: timers.setTimer,
  });
  const pending = runner.run(REQUEST);
  await timers.armed();
  timers.fire();
  const outcome = await pending;
  expect(outcome).toEqual({
    ok: true,
    value: {
      exitCode: null,
      signal: "SIGKILL",
      stdout: "",
      stdoutTruncated: false,
      stderr: "",
      stderrTruncated: false,
      timedOut: true,
    },
  });
  expect(calls).toEqual([
    {
      level: "warn",
      event: "script.env_failed",
      fields: {
        extension: "demo",
        script: "hook",
        exitCode: null,
        timedOut: true,
        stderrTail: "",
        uses: "user_environment,read_wide,write_project,network",
      },
    },
  ]);
});

test("default: without a masking function the logged stderr tail is empty, so unmasked text is never logged", async () => {
  const tree = layout();
  const { logger, calls } = recordingLogger();
  const hook = fakeHook({ stderr: "token=plain-text", exit: { code: 1, signal: null } });
  await runnerFor(envTarget(tree, [hookOf()], GRANTED), fakeProcess({}).port, {
    userEnv: USER_ENV,
    hookProcess: () => hook.port,
    logger,
  }).run(REQUEST);
  expect(calls.map((call) => call.fields?.["stderrTail"])).toEqual([""]);
});

// ── 7. 좁은 모드 회귀 ───────────────────────────────────────────────────

test("a narrow declaration with no env still spawns the narrow way, even when the environment grant is recorded", async () => {
  const tree = layout();
  const fake = fakeProcess({ stdout: "ok" });
  const narrow: ManifestScriptDecl = {
    name: "check",
    runner: "sh",
    file: "check.sh",
    args: ["--strict"],
    envNames: ["PATH"],
  };
  const outcome = await runnerFor(envTarget(tree, [narrow], GRANTED), fake.port, {
    allowedEnv: { PATH: "/usr/bin" },
  }).run({ ...REQUEST, name: "check" });
  expect(outcome).toEqual({
    ok: true,
    value: {
      exitCode: 0,
      signal: null,
      stdout: "ok",
      stdoutTruncated: false,
      stderr: "",
      stderrTruncated: false,
      timedOut: false,
    },
  });
  // 좁은 모드의 명세 그대로다(`script-runner.test.ts`의 같은 시험과 같은 값)
  expect(fake.specs).toStrictEqual([
    {
      command: "/bin/sh",
      args: [join(tree, "check.sh"), "--strict"],
      readRoot: tree,
      systemTools: true,
      env: { PATH: "/usr/bin" },
      label: "script:demo:check",
    },
  ]);
});
