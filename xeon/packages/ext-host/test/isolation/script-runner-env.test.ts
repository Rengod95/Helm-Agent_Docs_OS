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

// 환경 모드(AGE-58 원칙 가)의 실행기 시험. 좁은 모드는 script-runner.test.ts가 그대로 본다.
// 띄우기 포트는 가짜다: 자식을 띄우지 않고 받은 명세를 기록하고 준비한 자식을 돌려준다. 값으로 비교한다.
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
): ManifestScriptDecl {
  return {
    name: "hook",
    runner: "sh",
    file: "hook.cmd",
    env: { command: COMMAND, shell, refs, refsKnown: true },
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
  /** 띄우기 포트가 받은 호출 수(거절된 호출은 0이어야 한다) */
  readonly spawns: number;
}

async function attempt(
  target: ScriptTarget,
  request: ScriptRunRequest,
  extra: Partial<ScriptRunnerDeps> = {},
): Promise<Attempt> {
  const fake = fakeProcess({});
  const outcome = await runnerFor(target, fake.port, extra).run(request);
  return { outcome, spawns: fake.specs.length };
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
  expect([noGrant, denied, draftWithGate, noFolder, relativeFolder, relativeWins]).toEqual([
    { outcome: refused, spawns: 0 },
    { outcome: refused, spawns: 0 },
    { outcome: refused, spawns: 0 },
    { outcome: refused, spawns: 0 },
    { outcome: refused, spawns: 0 },
    { outcome: refused, spawns: 0 },
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
    },
    {
      outcome: { ok: false, error: { kind: "script_env_not_granted" } },
      spawns: 0,
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
  expect(outcome).toEqual({ outcome: { ok: false, error: { kind: "script_missing" } }, spawns: 0 });
  expect(refs.statCalls).toEqual([]);
});

// ── 2. 자격이 있는 정상 경로 ─────────────────────────────────────────────

test("a granted run spawns the original command under the shell, in the thread's project folder, with the filtered environment", async () => {
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

test("without a thread folder the folder comes from the grant, and a grant without a folder takes the thread's folder", async () => {
  const tree = layout();
  const fromGrant = fakeProcess({});
  await runnerFor(envTarget(tree, [hookOf()], GRANTED), fromGrant.port, {
    userEnv: USER_ENV,
    projectDirOf: () => undefined,
  }).run(REQUEST);
  const fromThread = fakeProcess({});
  await runnerFor(
    envTarget(tree, [hookOf()], { granted: true, projectDir: null, fromProject: false }),
    fromThread.port,
    { userEnv: USER_ENV, projectDirOf: () => THREAD_DIR },
  ).run(IN_THREAD);
  expect(fromGrant.specs.map((spec) => spec.readRoot)).toEqual([GRANT_DIR]);
  expect(fromGrant.specs.map((spec) => spec.env["CLAUDE_PROJECT_DIR"])).toEqual([GRANT_DIR]);
  expect(fromThread.specs.map((spec) => spec.readRoot)).toEqual([THREAD_DIR]);
  expect(fromThread.specs.map((spec) => spec.scriptEnv)).toEqual([
    { projectDir: THREAD_DIR, readCarveOuts: [] },
  ]);
});

test("shell bash uses the runner resolved for bash, with the same command string", async () => {
  const tree = layout();
  const asked: string[] = [];
  const fake = fakeProcess({});
  await runnerFor(envTarget(tree, [hookOf([], "bash")], GRANTED), fake.port, {
    userEnv: USER_ENV,
    resolveRunner: (name) => {
      asked.push(name);
      return name === "bash" ? BASH_PATH : undefined;
    },
  }).run(REQUEST);
  expect(asked).toEqual(["bash"]);
  expect(fake.specs).toStrictEqual([
    {
      command: BASH_PATH,
      args: ["-c", COMMAND],
      readRoot: GRANT_DIR,
      systemTools: true,
      scriptEnv: { projectDir: GRANT_DIR, readCarveOuts: [] },
      env: { PATH: "/usr/bin:/bin", HOME: "/Users/tester", CLAUDE_PROJECT_DIR: GRANT_DIR },
      label: "script:demo:hook",
    },
  ]);
});

// ── 3. 환경 정책 표 ──────────────────────────────────────────────────────

test("the user environment reaching the child is only the allowed names: PATH, HOME, LANG, MISE_SHELL and the project folder", async () => {
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

test("a reference whose fingerprint still matches lets the run start", async () => {
  const tree = layout();
  const refs = memoryRefs();
  refs.files.set(REF_ALPHA, { size: 10, mtimeMs: 100, hash: HASH_A });
  const fake = fakeProcess({ stdout: "ok" });
  const outcome = await runnerFor(
    envTarget(tree, [hookOf([{ path: REF_ALPHA, hash: HASH_A }])], GRANTED),
    fake.port,
    { userEnv: USER_ENV, refs: refs.reader },
  ).run(REQUEST);
  expect(outcome.ok).toBe(true);
  expect(fake.specs.length).toBe(1);
});

test("a reference whose content changed is script_ref_changed with reason changed, and nothing starts", async () => {
  const tree = layout();
  const refs = memoryRefs();
  refs.files.set(REF_ALPHA, { size: 10, mtimeMs: 100, hash: HASH_B });
  const fake = fakeProcess({});
  const outcome = await runnerFor(
    envTarget(tree, [hookOf([{ path: REF_ALPHA, hash: HASH_A }])], GRANTED),
    fake.port,
    { userEnv: USER_ENV, refs: refs.reader },
  ).run(REQUEST);
  expect(outcome).toEqual({
    ok: false,
    error: { kind: "script_ref_changed", path: REF_ALPHA, reason: "changed" },
  });
  expect(fake.specs.length).toBe(0);
});

test("a reference that is gone is script_ref_changed with reason missing", async () => {
  const tree = layout();
  const refs = memoryRefs();
  const fake = fakeProcess({});
  const outcome = await runnerFor(
    envTarget(tree, [hookOf([{ path: REF_ALPHA, hash: HASH_A }])], GRANTED),
    fake.port,
    { userEnv: USER_ENV, refs: refs.reader },
  ).run(REQUEST);
  expect(outcome).toEqual({
    ok: false,
    error: { kind: "script_ref_changed", path: REF_ALPHA, reason: "missing" },
  });
  expect(fake.specs.length).toBe(0);
});

test("a reference whose stat or content cannot be read is script_ref_changed with reason unreadable", async () => {
  const tree = layout();
  const statFails = memoryRefs();
  statFails.files.set(REF_ALPHA, { size: 10, mtimeMs: 100, hash: HASH_A });
  statFails.statBroken.add(REF_ALPHA);
  const hashFails = memoryRefs();
  hashFails.files.set(REF_ALPHA, { size: 10, mtimeMs: 100, hash: HASH_A });
  hashFails.hashBroken.add(REF_ALPHA);
  const fake = fakeProcess({});
  const scripts = [hookOf([{ path: REF_ALPHA, hash: HASH_A }])];
  const onStat = await runnerFor(envTarget(tree, scripts, GRANTED), fake.port, {
    userEnv: USER_ENV,
    refs: statFails.reader,
  }).run(REQUEST);
  const onHash = await runnerFor(envTarget(tree, scripts, GRANTED), fake.port, {
    userEnv: USER_ENV,
    refs: hashFails.reader,
  }).run(REQUEST);
  const unreadable = err<ScriptRunFailure>({
    kind: "script_ref_changed",
    path: REF_ALPHA,
    reason: "unreadable",
  });
  expect([onStat, onHash]).toEqual([unreadable, unreadable]);
  expect(fake.specs.length).toBe(0);
});

test("with no reference reader at all, a reference that has a fingerprint is unreadable: the failure is closed", async () => {
  const tree = layout();
  const fake = fakeProcess({});
  const outcome = await runnerFor(
    envTarget(tree, [hookOf([{ path: REF_ALPHA, hash: HASH_A }])], GRANTED),
    fake.port,
    { userEnv: USER_ENV },
  ).run(REQUEST);
  expect(outcome).toEqual({
    ok: false,
    error: { kind: "script_ref_changed", path: REF_ALPHA, reason: "unreadable" },
  });
  expect(fake.specs.length).toBe(0);
});

test("a reference whose fingerprint was not taken at import fails closed: unreadable when the file exists now, missing when it does not, and unreadable without a reader", async () => {
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
  const absent = await attempt(envTarget(tree, [decl], GRANTED), REQUEST, {
    userEnv: USER_ENV,
    refs: memoryRefs().reader,
  });
  const failure = (reason: "missing" | "unreadable"): Result<never, ScriptRunFailure> =>
    err<ScriptRunFailure>({ kind: "script_ref_changed", path: REF_ALPHA, reason });
  expect([withoutReader, existing, absent]).toEqual([
    { outcome: failure("unreadable"), spawns: 0 },
    { outcome: failure("unreadable"), spawns: 0 },
    { outcome: failure("missing"), spawns: 0 },
  ]);
});

test("a fingerprint is computed again only when size or mtime changes or the declared hash changes; the stat happens every time", async () => {
  const tree = layout();
  const refs = memoryRefs();
  refs.files.set(REF_ALPHA, { size: 10, mtimeMs: 100, hash: HASH_A });
  const scripts: ManifestScriptDecl[] = [hookOf([{ path: REF_ALPHA, hash: HASH_A }])];
  const fake = fakeProcess({});
  const runner = runnerFor(envTarget(tree, scripts, GRANTED), fake.port, {
    userEnv: USER_ENV,
    refs: refs.reader,
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
  expect(fake.specs.length).toBe(4);
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
  expect([zedFirst.spawns, alphaFirst.spawns]).toEqual([0, 0]);
});

// ── 5. 돌려 보기, 샌드박스, 사용자 환경, 띄우기 실패 ──────────────────────

test("a replay request is replay_mode_denied and nothing starts", async () => {
  const tree = layout();
  const fake = fakeProcess({});
  const outcome = await runnerFor(envTarget(tree, [hookOf()], GRANTED), fake.port, {
    userEnv: USER_ENV,
  }).run({ ...REQUEST, replay: true });
  expect(outcome).toEqual({ ok: false, error: { kind: "replay_mode_denied" } });
  expect(fake.specs.length).toBe(0);
});

test("when the sandbox is off the run is sandbox_unavailable with reason sandbox_off, and nothing starts", async () => {
  const tree = layout();
  const fake = fakeProcess({});
  const outcome = await runnerFor(envTarget(tree, [hookOf()], GRANTED), fake.port, {
    userEnv: USER_ENV,
    sandboxAvailable: () => false,
  }).run(REQUEST);
  expect(outcome).toEqual({
    ok: false,
    error: { kind: "sandbox_unavailable", reason: "sandbox_off" },
  });
  expect(fake.specs.length).toBe(0);
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

test("a spawn refused by the port comes back as the same failure values as the narrow path", async () => {
  const tree = layout();
  const unavailable = fakeProcess({}, { kind: "sandbox_unavailable", reason: "service_missing" });
  const failed = fakeProcess({}, { kind: "spawn_failed", code: "ENOENT", message: "no such file" });
  const onUnavailable = await runnerFor(envTarget(tree, [hookOf()], GRANTED), unavailable.port, {
    userEnv: USER_ENV,
  }).run(REQUEST);
  const onFailed = await runnerFor(envTarget(tree, [hookOf()], GRANTED), failed.port, {
    userEnv: USER_ENV,
  }).run(REQUEST);
  expect([onUnavailable, onFailed]).toEqual([
    { ok: false, error: { kind: "sandbox_unavailable", reason: "service_missing" } },
    { ok: false, error: { kind: "spawn_failed", code: "ENOENT", message: "no such file" } },
  ]);
  expect([unavailable.specs.length, failed.specs.length]).toEqual([1, 1]);
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

test("a run that exits 1 logs one warning with the masked last 512 characters of stderr and no environment value", async () => {
  const tree = layout();
  const { logger, calls } = recordingLogger();
  // 머리 200자, 가운데 400자, 끝 "TAIL SECRET". 끝 512자는 머리 101자와 가운데 400자와 꼬리 11자다
  const stderr = `${"H".repeat(200)}${"M".repeat(400)}TAIL SECRET`;
  const fake = fakeProcess({ stderr, exit: { code: 1, signal: null } });
  const outcome = await runnerFor(envTarget(tree, [hookOf()], GRANTED), fake.port, {
    userEnv: async () => ({ PATH: "/usr/bin", LANG: "en_US.SENTINEL-LANG-7f3a" }),
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
        uses: "user_environment,read_wide,write_project,network",
      },
    },
  ]);
  const logged = JSON.stringify(calls);
  expect(logged).not.toContain("SENTINEL-LANG-7f3a");
  expect(logged).not.toContain(GRANT_DIR);
});

test("a run that exits 0 or 2 logs nothing", async () => {
  const tree = layout();
  const { logger, calls } = recordingLogger();
  const ok0 = fakeProcess({ stdout: "fine", exit: { code: 0, signal: null } });
  const ok2 = fakeProcess({ stderr: "not ok", exit: { code: 2, signal: null } });
  const first = await runnerFor(envTarget(tree, [hookOf()], GRANTED), ok0.port, {
    userEnv: USER_ENV,
    logger,
    maskText: (text) => text,
  }).run(REQUEST);
  const second = await runnerFor(envTarget(tree, [hookOf()], GRANTED), ok2.port, {
    userEnv: USER_ENV,
    logger,
    maskText: (text) => text,
  }).run(REQUEST);
  expect([first.ok, second.ok]).toEqual([true, true]);
  expect(calls).toEqual([]);
});

test("a run that outlives its deadline logs one warning with a null exit code and timedOut true", async () => {
  const tree = layout();
  const timers = manualTimers();
  const { logger, calls } = recordingLogger();
  const fake = fakeProcess({ hang: true });
  const runner = runnerFor(envTarget(tree, [hookOf()], GRANTED), fake.port, {
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

test("without a masking function the logged stderr tail is empty, so unmasked text is never logged", async () => {
  const tree = layout();
  const { logger, calls } = recordingLogger();
  const fake = fakeProcess({ stderr: "token=plain-text", exit: { code: 1, signal: null } });
  await runnerFor(envTarget(tree, [hookOf()], GRANTED), fake.port, {
    userEnv: USER_ENV,
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
