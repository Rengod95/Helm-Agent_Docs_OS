import { afterEach, expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { attemptAsync, err, ok } from "@fresnel/contracts";
import {
  SCRIPT_LIMITS,
  type EngineCallParams,
  type IsolatedChild,
  type IsolationProcessPort,
  type IsolationSpawnError,
  type IsolationSpawnSpec,
  type LoaderFs,
  type ManifestScriptDecl,
  type ScriptRunResult,
} from "@fresnel/contracts/extensions";
import { createScriptRunner, type ScriptTarget } from "../../src/isolation/script-runner.ts";
import {
  createChildRegistration,
  PluginEngineCallError,
  type CallScope,
  type ChildEnv,
} from "../../src/isolation/child-api.ts";
import type { JsonValue } from "@fresnel/contracts/conversation";

// 설계 B의 실행기 시험(값으로 비교한다). 띄우기 포트는 가짜다: 자식을 띄우지 않고 받은 표준 입력과 명세를 기록한다.
// 실제 샌드박스 아래의 시험은 apps/host/test/int/script-sandbox.int.test.ts가 본다.

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 임시 폴더. 맥의 `/var`가 `/private/var`로 풀리므로 실제 경로로 만든다 */
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "script-runner-"));
  dirs.push(dir);
  return realpathSync(dir);
}

/** 확장 루트 `tree/`와 밖의 폴더 `outside/`를 만든다. 밖에는 읽히면 안 되는 비밀 파일이 있다 */
function layout(): { root: string; tree: string; outside: string; secret: string } {
  const root = tempRoot();
  const tree = join(root, "tree");
  const outside = join(root, "outside");
  mkdirSync(tree);
  mkdirSync(outside);
  const secret = join(outside, "secret.sh");
  writeFileSync(secret, "echo leaked\n");
  writeFileSync(join(tree, "check.sh"), "echo ok\n");
  return { root, tree, outside, secret };
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

/** 띄우기 포트 대역. `failure`가 있으면 띄우지 않고 그 오류를 값으로 낸다 */
function fakeProcess(
  plan: Plan,
  failure?: IsolationSpawnError,
): {
  port: IsolationProcessPort;
  launched: Launched[];
} {
  const launched: Launched[] = [];
  const port: IsolationProcessPort = {
    async spawn(spec) {
      if (failure !== undefined) return err(failure);
      const started = startChild(plan);
      launched.push({ spec, stdinText: started.stdinText, signals: started.signals });
      return ok(started.child);
    },
  };
  return { port, launched };
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

function targetOf(
  tree: string,
  scripts: readonly ManifestScriptDecl[],
  approved = true,
): ScriptTarget {
  return { extension: "demo", scripts, tree, approved };
}

const SH_RESOLVER = (name: string): string | undefined => (name === "sh" ? "/bin/sh" : undefined);

test("a name that is not declared is refused and nothing starts", async () => {
  const { tree } = layout();
  const { port, launched } = fakeProcess({});
  const runner = createScriptRunner({
    process: port,
    fs: nodeFs,
    target: targetOf(tree, [{ name: "check", runner: "sh", file: "check.sh" }]),
    resolveRunner: SH_RESOLVER,
    allowedEnv: {},
    setTimer: manualTimers().setTimer,
  });
  const outcome = await runner.run({
    registration: "demo",
    name: "other",
    stdin: "",
    replay: false,
  });
  expect(outcome).toEqual({ ok: false, error: { kind: "script_not_declared" } });
  expect(launched.length).toBe(0);
});

test("a file that links out of the extension folder is refused as outside the tree", async () => {
  const { tree, secret } = layout();
  symlinkSync(secret, join(tree, "link.sh"));
  const { port, launched } = fakeProcess({});
  const runner = createScriptRunner({
    process: port,
    fs: nodeFs,
    target: targetOf(tree, [{ name: "link", runner: "sh", file: "link.sh" }]),
    resolveRunner: SH_RESOLVER,
    allowedEnv: {},
    setTimer: manualTimers().setTimer,
  });
  const outcome = await runner.run({
    registration: "demo",
    name: "link",
    stdin: "",
    replay: false,
  });
  expect(outcome).toEqual({ ok: false, error: { kind: "script_outside_tree" } });
  expect(launched.length).toBe(0);
});

test("a file name that climbs out with .. is refused as outside the tree, even when it exists", async () => {
  const { tree } = layout();
  const { port, launched } = fakeProcess({});
  const runner = createScriptRunner({
    process: port,
    fs: nodeFs,
    target: targetOf(tree, [{ name: "up", runner: "sh", file: "../outside/secret.sh" }]),
    resolveRunner: SH_RESOLVER,
    allowedEnv: {},
    setTimer: manualTimers().setTimer,
  });
  const outcome = await runner.run({ registration: "demo", name: "up", stdin: "", replay: false });
  expect(outcome).toEqual({ ok: false, error: { kind: "script_outside_tree" } });
  expect(launched.length).toBe(0);
});

test("a file that does not exist, and a folder given as the file, are script_missing", async () => {
  const { tree } = layout();
  mkdirSync(join(tree, "folder"));
  const { port, launched } = fakeProcess({});
  const runner = createScriptRunner({
    process: port,
    fs: nodeFs,
    target: targetOf(tree, [
      { name: "gone", runner: "sh", file: "gone.sh" },
      { name: "dir", runner: "sh", file: "folder" },
    ]),
    resolveRunner: SH_RESOLVER,
    allowedEnv: {},
    setTimer: manualTimers().setTimer,
  });
  const gone = await runner.run({ registration: "demo", name: "gone", stdin: "", replay: false });
  const dir = await runner.run({ registration: "demo", name: "dir", stdin: "", replay: false });
  expect(gone).toEqual({ ok: false, error: { kind: "script_missing" } });
  expect(dir).toEqual({ ok: false, error: { kind: "script_missing" } });
  expect(launched.length).toBe(0);
});

test("a draft (not approved) is refused as script_not_approved and nothing starts", async () => {
  const { tree } = layout();
  const { port, launched } = fakeProcess({});
  const runner = createScriptRunner({
    process: port,
    fs: nodeFs,
    target: targetOf(tree, [{ name: "check", runner: "sh", file: "check.sh" }], false),
    resolveRunner: SH_RESOLVER,
    allowedEnv: {},
    setTimer: manualTimers().setTimer,
  });
  const outcome = await runner.run({
    registration: "demo",
    name: "check",
    stdin: "",
    replay: false,
  });
  expect(outcome).toEqual({ ok: false, error: { kind: "script_not_approved" } });
  expect(launched.length).toBe(0);
});

test("a replay request is refused as replay_mode_denied and nothing starts", async () => {
  const { tree } = layout();
  const { port, launched } = fakeProcess({});
  const runner = createScriptRunner({
    process: port,
    fs: nodeFs,
    target: targetOf(tree, [{ name: "check", runner: "sh", file: "check.sh" }]),
    resolveRunner: SH_RESOLVER,
    allowedEnv: {},
    setTimer: manualTimers().setTimer,
  });
  const outcome = await runner.run({
    registration: "demo",
    name: "check",
    stdin: "",
    replay: true,
  });
  expect(outcome).toEqual({ ok: false, error: { kind: "replay_mode_denied" } });
  expect(launched.length).toBe(0);
});

test("a runner with no absolute path is refused as runner_unavailable and nothing starts", async () => {
  const { tree } = layout();
  const { port, launched } = fakeProcess({});
  const runner = createScriptRunner({
    process: port,
    fs: nodeFs,
    target: targetOf(tree, [{ name: "check", runner: "python3", file: "check.sh" }]),
    resolveRunner: () => undefined,
    allowedEnv: {},
    setTimer: manualTimers().setTimer,
  });
  const outcome = await runner.run({
    registration: "demo",
    name: "check",
    stdin: "",
    replay: false,
  });
  expect(outcome).toEqual({
    ok: false,
    error: {
      kind: "spawn_failed",
      code: "runner_unavailable",
      message: "no absolute path is set for the python3 runner",
    },
  });
  expect(launched.length).toBe(0);
});

test("a sandbox that cannot be used and a failed spawn come back as values", async () => {
  const { tree } = layout();
  const scripts: ManifestScriptDecl[] = [{ name: "check", runner: "sh", file: "check.sh" }];
  const unavailable = createScriptRunner({
    process: fakeProcess({}, { kind: "sandbox_unavailable", reason: "service_missing" }).port,
    fs: nodeFs,
    target: targetOf(tree, scripts),
    resolveRunner: SH_RESOLVER,
    allowedEnv: {},
    setTimer: manualTimers().setTimer,
  });
  const failed = createScriptRunner({
    process: fakeProcess({}, { kind: "spawn_failed", code: "ENOENT", message: "no such file" })
      .port,
    fs: nodeFs,
    target: targetOf(tree, scripts),
    resolveRunner: SH_RESOLVER,
    allowedEnv: {},
    setTimer: manualTimers().setTimer,
  });
  const request = { registration: "demo", name: "check", stdin: "", replay: false };
  expect(await unavailable.run(request)).toEqual({
    ok: false,
    error: { kind: "sandbox_unavailable", reason: "service_missing" },
  });
  expect(await failed.run(request)).toEqual({
    ok: false,
    error: { kind: "spawn_failed", code: "ENOENT", message: "no such file" },
  });
});

test("a script that exits with 2 returns its code, stdout and stderr as values, and starts with the declared command", async () => {
  const { tree } = layout();
  const { port, launched } = fakeProcess({
    stdout: '{"ok":false,"reason":"empty"}',
    stderr: "bad input\n",
    exit: { code: 2, signal: null },
  });
  const runner = createScriptRunner({
    process: port,
    fs: nodeFs,
    target: targetOf(tree, [
      { name: "check", runner: "sh", file: "check.sh", args: ["--strict"], envNames: ["PATH"] },
    ]),
    resolveRunner: SH_RESOLVER,
    allowedEnv: { PATH: "/usr/bin" },
    setTimer: manualTimers().setTimer,
  });
  const outcome = await runner.run({
    registration: "demo",
    name: "check",
    stdin: "",
    replay: false,
  });
  const expected: ScriptRunResult = {
    exitCode: 2,
    signal: null,
    stdout: '{"ok":false,"reason":"empty"}',
    stdoutTruncated: false,
    stderr: "bad input\n",
    stderrTruncated: false,
    timedOut: false,
  };
  expect(outcome).toEqual({ ok: true, value: expected });
  expect(launched.length).toBe(1);
  expect(launched[0]?.spec).toEqual({
    command: "/bin/sh",
    args: [join(tree, "check.sh"), "--strict"],
    readRoot: tree,
    env: { PATH: "/usr/bin" },
    label: "script:demo:check",
  });
});

test("the standard input is written to the child and then closed", async () => {
  const { tree } = layout();
  const { port, launched } = fakeProcess({ stdout: "done" });
  const runner = createScriptRunner({
    process: port,
    fs: nodeFs,
    target: targetOf(tree, [{ name: "check", runner: "sh", file: "check.sh" }]),
    resolveRunner: SH_RESOLVER,
    allowedEnv: {},
    setTimer: manualTimers().setTimer,
  });
  const outcome = await runner.run({
    registration: "demo",
    name: "check",
    stdin: '{"text":"hi"}',
    replay: false,
  });
  expect(outcome).toMatchObject({ ok: true, value: { exitCode: 0, stdout: "done" } });
  expect(launched[0]?.stdinText()).toBe('{"text":"hi"}');
});

test("only declared, allowed, non-secret environment names reach the child", async () => {
  const { tree } = layout();
  const { port, launched } = fakeProcess({});
  const runner = createScriptRunner({
    process: port,
    fs: nodeFs,
    target: targetOf(tree, [
      {
        name: "check",
        runner: "sh",
        file: "check.sh",
        envNames: ["PATH", "API_TOKEN", "NOT_ALLOWED"],
      },
    ]),
    resolveRunner: SH_RESOLVER,
    allowedEnv: { PATH: "/usr/bin", API_TOKEN: "secret-value", OTHER: "not-declared" },
    setTimer: manualTimers().setTimer,
  });
  await runner.run({ registration: "demo", name: "check", stdin: "", replay: false });
  expect(launched[0]?.spec.env).toEqual({ PATH: "/usr/bin" });
});

test("a child that outlives its deadline is killed and reported as timed out", async () => {
  const { tree } = layout();
  const timers = manualTimers();
  const { port, launched } = fakeProcess({ hang: true });
  const runner = createScriptRunner({
    process: port,
    fs: nodeFs,
    target: targetOf(tree, [{ name: "check", runner: "sh", file: "check.sh", timeoutMs: 1500 }]),
    resolveRunner: SH_RESOLVER,
    allowedEnv: {},
    setTimer: timers.setTimer,
  });
  const pending = runner.run({ registration: "demo", name: "check", stdin: "", replay: false });
  await timers.armed();
  timers.fire();
  const outcome = await pending;
  expect(timers.timers[0]?.ms).toBe(1500);
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
  expect(launched[0]?.signals).toEqual(["SIGKILL"]);
});

test("a script without a declared deadline gets the default deadline", async () => {
  const { tree } = layout();
  const timers = manualTimers();
  const { port } = fakeProcess({ exit: { code: 0, signal: null } });
  const runner = createScriptRunner({
    process: port,
    fs: nodeFs,
    target: targetOf(tree, [{ name: "check", runner: "sh", file: "check.sh" }]),
    resolveRunner: SH_RESOLVER,
    allowedEnv: {},
    setTimer: timers.setTimer,
  });
  const outcome = await runner.run({
    registration: "demo",
    name: "check",
    stdin: "",
    replay: false,
  });
  expect(outcome).toMatchObject({ ok: true, value: { exitCode: 0, timedOut: false } });
  expect(timers.timers[0]?.ms).toBe(SCRIPT_LIMITS.timeoutDefaultMs);
  expect(timers.timers[0]?.cancelled).toBe(true);
});

test("output over the limit is cut to the limit and marked truncated; a short stream is not", async () => {
  const { tree } = layout();
  const long = "a".repeat(SCRIPT_LIMITS.outputBytes + 100);
  const { port } = fakeProcess({ stdout: long, stderr: "short\n" });
  const runner = createScriptRunner({
    process: port,
    fs: nodeFs,
    target: targetOf(tree, [{ name: "check", runner: "sh", file: "check.sh" }]),
    resolveRunner: SH_RESOLVER,
    allowedEnv: {},
    setTimer: manualTimers().setTimer,
  });
  const outcome = await runner.run({
    registration: "demo",
    name: "check",
    stdin: "",
    replay: false,
  });
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) return;
  expect(outcome.value.stdout.length).toBe(SCRIPT_LIMITS.outputBytes);
  expect(outcome.value.stdoutTruncated).toBe(true);
  expect(outcome.value.stderr).toBe("short\n");
  expect(outcome.value.stderrTruncated).toBe(false);
});

test("a file reached through a folder link that points outside is refused, and nothing starts", async () => {
  const { tree, outside } = layout();
  // 확장 폴더 안의 폴더 링크가 밖을 가리킨다. 파일 이름은 안에 있는 것처럼 보인다
  symlinkSync(outside, join(tree, "linked"));
  const { port, launched } = fakeProcess({ stdout: "leaked" });
  const runner = createScriptRunner({
    process: port,
    fs: nodeFs,
    target: targetOf(tree, [{ name: "peek", runner: "sh", file: "linked/secret.sh" }]),
    resolveRunner: SH_RESOLVER,
    allowedEnv: {},
    setTimer: manualTimers().setTimer,
  });
  const outcome = await runner.run({
    registration: "demo",
    name: "peek",
    stdin: "",
    replay: false,
  });
  expect(outcome).toEqual({ ok: false, error: { kind: "script_outside_tree" } });
  expect(launched.length).toBe(0);
});

// ── 격리 자식의 `g.runScript` (child-api.ts) ──────────────────────────────

/** 자식이 정상으로 끝났을 때의 결과 값 */
const RUN: ScriptRunResult = {
  exitCode: 0,
  signal: null,
  stdout: "{}",
  stdoutTruncated: false,
  stderr: "",
  stderrTruncated: false,
  timedOut: false,
};

/** 엔진이 답하는 값(`Result<ScriptRunResult, ScriptRunFailure>`의 JSON) */
const REPLY: JsonValue = { ok: true, value: { ...RUN } };

/** 자식 쪽 환경. 엔진 호출은 받은 것을 기록하고 준비한 답을 돌려준다 */
function childEnvWith(answer: (params: EngineCallParams) => JsonValue): {
  env: ChildEnv;
  sent: EngineCallParams[];
} {
  const sent: EngineCallParams[] = [];
  const env: ChildEnv = {
    extension: "demo",
    initSettings: {},
    scopes: new AsyncLocalStorage<CallScope>(),
    lifetime: new AbortController().signal,
    engineCall: (params) => {
      sent.push(params);
      return Promise.resolve(answer(params));
    },
    declaredHooks: new Map(),
    report: () => undefined,
  };
  return { env, sent };
}

test("the child's runScript sends the name and stdin and returns the engine's result as a value", async () => {
  const { env, sent } = childEnvWith(() => REPLY);
  const registration = createChildRegistration("demo", {}, () => undefined, env);
  const outcome = await registration.api.runScript("check", { stdin: "x" });
  expect(outcome).toEqual(ok(RUN));
  expect(sent).toEqual([
    {
      method: "runScript",
      registration: "demo",
      requestId: null,
      params: { name: "check", stdin: "x" },
    },
  ]);
});

test("the child's runScript sends an empty stdin when none is given", async () => {
  const { env, sent } = childEnvWith(() => ({ ok: false, error: { kind: "replay_mode_denied" } }));
  const registration = createChildRegistration("demo", {}, () => undefined, env);
  const outcome = await registration.api.runScript("check");
  expect(outcome).toEqual({ ok: false, error: { kind: "replay_mode_denied" } });
  expect(sent[0]?.params).toEqual({ name: "check", stdin: "" });
});

test("a reply that does not have the script result shape is an invalid_result engine error", async () => {
  const { env } = childEnvWith(() => ({ ok: true }));
  const registration = createChildRegistration("demo", {}, () => undefined, env);
  const attempted = await attemptAsync(() => registration.api.runScript("check"));
  expect(attempted.ok).toBe(false);
  if (attempted.ok) return;
  expect(attempted.error.cause).toBeInstanceOf(PluginEngineCallError);
  expect(attempted.error.cause).toMatchObject({ kind: "invalid_result" });
});
