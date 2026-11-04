import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attempt, parseJson, type Logger } from "@fresnel/contracts";
import type { HookProcessPort } from "@fresnel/contracts/extensions";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  createOperationsPolicy,
  DEFAULT_BUDGETS_MS,
  type OperationsPolicy,
  type RegistrationControl,
} from "@fresnel/ext-host";
import { createTestHost, fakeTimers, portAs, type TestHost } from "@fresnel/ext-host/testing";
import { systemScheduler } from "@fresnel/platform-os";
import { createHookRunner, detectProcessPlatform } from "@fresnel/platform-process";
import {
  createExternalHooks,
  hookDefsOf,
  HOOK_DEFS_KEY,
} from "../../src/assembly/external-hooks.ts";
import { ProcessPortKey } from "@fresnel/contracts/extensions";
import { sequentially } from "../../src/util.ts";

// X.operations §4.7 외부 훅: 실제 자식 프로세스(bun 스크립트)로 입력·출력, 종료 코드, 시간 초과와 정리, 출력 상한, 환경 정리,
// 신뢰 범위, 5회 실패 뒤 질문, 저장된 꺼짐, 안전 모드를 값으로 비교한다. 임시 명령은 임시 폴더 안에서만 돈다.

const dirs: string[] = [];
const hosts: TestHost[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "fresnel-hooks-real-"));
  dirs.push(dir);
  return dir;
}

const quietLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => quietLogger,
};

const platform = detectProcessPlatform();
const noScopes: RegistrationControl = {
  requestDisable: () => {},
  requestEnable: () => {},
  scopesOf: () => [],
};

interface Rig {
  readonly t: TestHost;
  readonly policy: OperationsPolicy;
  readonly dir: string;
  readonly thread: ThreadId;
  readonly installed: readonly string[];
  readonly hooks: ReturnType<typeof createExternalHooks>;
  /** 층에 든 `hookDefs` 값. 바꾸고 `hooks.sync()`를 부르면 설정 변경을 흉내 낸다 */
  readonly state: { defs: readonly unknown[] };
}

interface RigOptions {
  readonly defs: readonly unknown[];
  readonly saved?: readonly string[];
  readonly safeMode?: boolean;
  /** 부모 환경 */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly envAllow?: readonly string[];
  /** 바깥 범위 층도 함께 둔다(작업 폴더 신뢰 시험) */
  readonly projectDefs?: readonly unknown[];
}

async function rig(options: RigOptions): Promise<Rig> {
  const dir = tmp();
  const late: { policy?: OperationsPolicy; t?: TestHost } = {};
  const state: { defs: readonly unknown[] } = { defs: options.defs };
  const processRunner = createHookRunner({
    platform: platform.ok ? platform.value : undefined,
    scheduler: systemScheduler(),
    graceMs: 300,
    shutdownSignal: new AbortController().signal,
    logger: quietLogger,
  });
  const port: HookProcessPort = processRunner;
  const hooks = createExternalHooks({
    layers: () => [
      { scope: "user", values: new Map([[HOOK_DEFS_KEY, state.defs]]) },
      ...(options.projectDefs === undefined
        ? []
        : [{ scope: "project" as const, values: new Map([[HOOK_DEFS_KEY, options.projectDefs]]) }]),
    ],
    ports: {
      get: (key) => (key.name === ProcessPortKey.name ? portAs(key, port) : undefined),
    },
    workspaceOf: () => dir,
    homeDir: () => dir,
    parentEnv: () => options.env ?? { PATH: process.env["PATH"], HOME: dir },
    savedDisabled: () => options.saved ?? [],
    envAllow: () => options.envAllow ?? [],
    budgetMs: () => 30_000,
    setTimer: (ms, fn) => {
      const handle = setTimeout(fn, ms);
      return () => clearTimeout(handle);
    },
    now: () => Date.now(),
    report: (record) => late.policy?.autoDisabler.onOutcome(record),
    log: () => {},
  });
  const policy = createOperationsPolicy({
    now: () => Date.now(),
    setTimer: (ms, fn) => {
      const handle = setTimeout(fn, ms);
      return () => clearTimeout(handle);
    },
    hooks: hooks.runner,
    settings: {
      budgets: () => DEFAULT_BUDGETS_MS,
      autoDisable: () => ({
        enabled: true,
        consecutive: 5,
        windowSize: 50,
        minFailures: 10,
        failureRate: 0.5,
      }),
    },
    scopes: noScopes,
    ports: { get: (key) => late.t?.host.ports.get(key) },
    canAsk: () => true,
  });
  late.policy = policy;
  const timers = fakeTimers();
  const t = await createTestHost({
    timers,
    policy,
    resourcePolicy: policy.resources,
    setupBudget: () => policy.setupBudgetMs(),
  });
  late.t = t;
  hosts.push(t);
  const installed = await hooks.install(t.host, options.safeMode === true, policy.tiers);
  const thread = t.newThread();
  await t.host.openThread(thread);
  return { t, policy, dir, thread, installed, hooks, state };
}

/** 스크립트를 임시 폴더에 쓰고 argv를 돌려준다 */
function script(dir: string, name: string, body: string): string[] {
  const path = join(dir, `${name}.ts`);
  writeFileSync(path, body);
  return [process.execPath, path];
}

const toolPayload = {
  toolCallId: "call_1",
  toolName: "bash",
  input: { command: "echo hi" },
};

async function callTool(r: Rig, key: string, toolName = "bash") {
  return r.t.host.dispatch(
    "tool.call.before",
    { ...toolPayload, toolName },
    { threadId: r.thread, dispatchKey: key },
  );
}

function jsonFile(path: string): unknown {
  const parsed = parseJson(readFileSync(path, "utf8"));
  return parsed.ok ? parsed.value : undefined;
}

function alive(pid: number): boolean {
  return attempt(() => process.kill(pid, 0)).ok;
}

/** 기한 안에 조건이 참이 될 때까지 이벤트 루프를 돌려 준다 */
async function until(check: () => boolean, deadlineMs = 5000): Promise<boolean> {
  const end = Date.now() + deadlineMs;
  const step = async (): Promise<boolean> => {
    if (check()) return true;
    if (Date.now() >= end) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
    return step();
  };
  return step();
}

function pidsOf(path: string): { readonly child: number; readonly grandchild: number } {
  const value = jsonFile(path);
  if (
    typeof value === "object" &&
    value !== null &&
    "child" in value &&
    "grandchild" in value &&
    typeof value.child === "number" &&
    typeof value.grandchild === "number"
  ) {
    return { child: value.child, grandchild: value.grandchild };
  }
  throw new Error("pids file is not written");
}

async function makeSingle(command: string[]): Promise<Rig> {
  return rig({ defs: [{ id: "h-one", point: "tool.call.before", command }] });
}

async function chainRun(command: string[]) {
  const r = await rig({ defs: [{ id: "wrap-input", point: "input.user.before", command }] });
  return r.t.host.dispatch(
    "input.user.before",
    { text: "hello", source: "interactive" },
    { threadId: r.thread, dispatchKey: "k", initial: { text: "hello", handled: false } },
  );
}

test("a decision hook gets the input JSON on stdin and its stdout decision is the dispatch result", async () => {
  const dir0 = tmp();
  const argv = script(
    dir0,
    "allow-block",
    `import { writeFileSync } from "node:fs";
const text = await Bun.stdin.text();
writeFileSync(process.argv[2] ?? "", text);
console.log(JSON.stringify({ decision: { block: true, reason: "no bash today", terminate: false } }));`,
  );
  const seen = join(dir0, "stdin.json");
  const r = await rig({
    defs: [{ id: "no-bash", point: "tool.call.before", tools: ["bash"], command: [...argv, seen] }],
  });
  expect(r.installed).toEqual(["fresnel-hooks-no-bash"]);
  const outcome = await callTool(r, "k1");
  expect(outcome).toMatchObject({
    fold: "first",
    decision: { block: true, reason: "no bash today", terminate: false },
  });
  expect(jsonFile(seen)).toEqual({
    schemaVersion: "fresnel.hook.v1",
    hookId: "no-bash",
    point: "tool.call.before",
    fold: "first",
    threadId: r.thread,
    cwd: r.dir,
    payload: toolPayload,
  });
  // 도구 이름이 맞지 않으면 실행하지 않는다
  const other = await callTool(r, "k2", "read");
  expect(other).toMatchObject({ fold: "first", decision: undefined });
});

test("exit 2 denies with the stderr text, other non-zero exits deny as a failure, and an empty exit 0 passes", async () => {
  const dir0 = tmp();
  const deny = script(dir0, "deny", `console.error("rm is blocked"); process.exit(2);`);
  const crash = script(dir0, "crash", `process.exit(7);`);
  const pass = script(dir0, "pass", `process.exit(0);`);
  const denied = await callTool(await makeSingle(deny), "k");
  expect(denied).toMatchObject({
    decision: { block: true, reason: "rm is blocked", terminate: false },
  });
  const crashed = await callTool(await makeSingle(crash), "k");
  expect(crashed).toMatchObject({ decision: { block: true, terminate: false } });
  const passed = await callTool(await makeSingle(pass), "k");
  expect(passed).toMatchObject({ decision: undefined });
});

test("a chain hook's stdout patch is applied; invalid JSON drops the patch", async () => {
  const dir0 = tmp();
  const good = script(
    dir0,
    "patch",
    `const input = JSON.parse(await Bun.stdin.text());
console.log(JSON.stringify({ patch: { action: "transform", text: "[" + input.current.text + "]" } }));`,
  );
  const bad = script(dir0, "bad", `console.log("not json");`);
  expect(await chainRun(good)).toMatchObject({ fold: "chain", value: { text: "[hello]" } });
  expect(await chainRun(bad)).toMatchObject({ fold: "chain", value: { text: "hello" } });
});

test("a hook over its time budget is killed with its whole process group and denied", async () => {
  const dir0 = tmp();
  const pids = join(dir0, "pids.json");
  const argv = script(
    dir0,
    "slow",
    `import { writeFileSync } from "node:fs";
const grandchild = Bun.spawn(["sleep", "60"]);
writeFileSync(process.argv[2] ?? "", JSON.stringify({ child: process.pid, grandchild: grandchild.pid }));
await new Promise(() => {});`,
  );
  const r = await rig({
    defs: [{ id: "slow-one", point: "tool.call.before", command: [...argv, pids], timeoutMs: 300 }],
  });
  const outcome = await callTool(r, "k");
  expect(outcome).toMatchObject({ decision: { block: true, terminate: false } });
  const { child, grandchild } = pidsOf(pids);
  expect(await until(() => !alive(child) && !alive(grandchild))).toBe(true);
  expect(r.policy.ledger.stats("hook:slow-one")).toMatchObject({ consecutive: 1 });
});

test("stdout beyond the limit is a failure, and the environment carries no secret names", async () => {
  const dir0 = tmp();
  const big = script(dir0, "big", `console.log("x".repeat(20000));`);
  const r = await rig({ defs: [{ id: "big-out", point: "tool.call.before", command: big }] });
  expect(await callTool(r, "k")).toMatchObject({ decision: { block: true, terminate: false } });

  const envFile = join(dir0, "env.json");
  const dump = script(
    dir0,
    "env",
    `import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2] ?? "", JSON.stringify(process.env));`,
  );
  const e = await rig({
    defs: [
      {
        id: "env-dump",
        point: "thread.start",
        command: [...dump, envFile],
        env: ["MY_VAR", "GITHUB_TOKEN", "NOT_LISTED"],
      },
    ],
    env: {
      PATH: process.env["PATH"],
      HOME: "/home/test",
      ANTHROPIC_API_KEY: "sk-secret-value",
      GITHUB_TOKEN: "ghp-secret-value",
      MY_VAR: "kept",
      NOT_LISTED: "dropped",
      OTHER_SECRET: "dropped",
    },
    envAllow: ["MY_VAR", "GITHUB_TOKEN"],
  });
  await e.t.host.dispatch(
    "thread.start",
    { reason: "startup", threadId: e.thread },
    { threadId: e.thread, dispatchKey: "k" },
  );
  const env: Record<string, unknown> = Object(jsonFile(envFile));
  expect(env.MY_VAR).toBe("kept");
  expect(env.HOME).toBe("/home/test");
  expect(env.FRESNEL_HOOK_ID).toBe("env-dump");
  expect(env.FRESNEL_HOOK_HOOK).toBe("thread.start");
  expect(env.FRESNEL_THREAD_ID).toBe(e.thread);
  expect(env.FRESNEL_PROJECT_DIR).toBe(e.dir);
  for (const name of ["ANTHROPIC_API_KEY", "GITHUB_TOKEN", "NOT_LISTED", "OTHER_SECRET"]) {
    expect(env[name]).toBeUndefined();
  }
  expect(JSON.stringify(env)).not.toContain("secret-value");
});

test("hooks of a work folder scope only exist where the settings layer holds them (trusted folders)", async () => {
  const defs = [{ id: "proj-hook", point: "thread.start", command: ["x"] }];
  const user = [{ id: "user-hook", point: "thread.start", command: ["x"] }];
  const without = hookDefsOf([{ scope: "user", values: new Map([[HOOK_DEFS_KEY, user]]) }]);
  expect(without.hooks.map((h) => [h.def.id, h.source, h.tier])).toEqual([
    ["user-hook", "user", "user"],
  ]);
  const withProject = hookDefsOf([
    { scope: "user", values: new Map([[HOOK_DEFS_KEY, user]]) },
    { scope: "project", values: new Map([[HOOK_DEFS_KEY, defs]]) },
  ]);
  expect(withProject.hooks.map((h) => [h.def.id, h.source, h.tier])).toEqual([
    ["user-hook", "user", "user"],
    ["proj-hook", "project", "project"],
  ]);
});

test("five failures ask whether to turn the hook off; answering yes stops it; a saved id never runs after a restart", async () => {
  const dir0 = tmp();
  const marker = join(dir0, "runs.txt");
  const fail = script(
    dir0,
    "fail",
    `import { appendFileSync } from "node:fs";
appendFileSync(process.argv[2] ?? "", "x");
process.exit(1);`,
  );
  const defs = [{ id: "flaky-one", point: "tool.call.before", command: [...fail, marker] }];
  const r = await rig({ defs });
  await sequentially(["a", "b", "c", "d", "e"], async (key) => {
    expect(await callTool(r, key)).toMatchObject({ decision: { block: true } });
  });
  expect(r.policy.autoDisabler.questions().map((q) => [q.key, q.rule, q.consecutive])).toEqual([
    ["hook:flaky-one", "consecutive", 5],
  ]);
  expect(readFileSync(marker, "utf8")).toBe("xxxxx");
  expect(r.policy.autoDisabler.answer("hook:flaky-one", true)).toBe(true);
  expect(await callTool(r, "after")).toMatchObject({ decision: undefined });
  expect(readFileSync(marker, "utf8")).toBe("xxxxx");

  // 재시작: 저장된 꺼짐 id(`x.operations.hookDisabled`)는 새 실행에서도 실행하지 않는다
  const again = await rig({ defs, saved: ["flaky-one"] });
  expect(await callTool(again, "k")).toMatchObject({ decision: undefined });
  expect(readFileSync(marker, "utf8")).toBe("xxxxx");
});

test("safe mode loads no external hook unit and nothing runs", async () => {
  const dir0 = tmp();
  const marker = join(dir0, "ran.txt");
  const touch = script(
    dir0,
    "touch",
    `import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2] ?? "", "ran");
console.log(JSON.stringify({ decision: { block: true, reason: "x", terminate: false } }));`,
  );
  const r = await rig({
    defs: [{ id: "should-not-run", point: "tool.call.before", command: [...touch, marker] }],
    safeMode: true,
  });
  expect(r.installed).toEqual([]);
  expect(await callTool(r, "k")).toMatchObject({ decision: undefined });
  expect(existsSync(marker)).toBe(false);
});

/** 싣은 단위는 단계 경계에서 켜진다. 모두 켜질 때까지 기한을 두고 기다린다 */
async function settled(r: Rig): Promise<void> {
  expect(
    await until(() => r.t.host.registrations().every((info) => info.status === "enabled")),
  ).toBe(true);
}

test("a hookDefs change adds and removes the hook's unit at the next sync; a changed point loads the unit again", async () => {
  const dir0 = tmp();
  const deny = (name: string) =>
    script(
      dir0,
      name,
      `console.log(JSON.stringify({ decision: { block: true, reason: "${name}", terminate: false } }));`,
    );
  const first = { id: "first-hook", point: "tool.call.before", command: deny("first") };
  const second = { id: "second-hook", point: "tool.call.before", command: deny("second") };
  const r = await rig({ defs: [first] });
  expect(r.installed).toEqual(["fresnel-hooks-first-hook"]);
  expect(await callTool(r, "k1")).toMatchObject({ decision: { reason: "first" } });

  // 훅을 하나 더하면 그 훅의 단위가 실린다. 순서 덮어쓰기가 없으면 설정 순서(first, second)다
  r.state.defs = [second, first];
  await r.hooks.sync();
  await settled(r);
  expect(r.t.host.registration("fresnel-hooks-second-hook")).toBeDefined();
  expect(await callTool(r, "k2")).toMatchObject({ decision: { reason: "second" } });

  // 훅을 빼면 단위도 빠진다
  r.state.defs = [first];
  await r.hooks.sync();
  await settled(r);
  expect(r.t.host.registration("fresnel-hooks-second-hook")).toBeUndefined();
  expect(await callTool(r, "k3")).toMatchObject({ decision: { reason: "first" } });

  // 지점이 바뀐 훅은 새 지점에 달린다
  r.state.defs = [{ ...first, point: "thread.start" }];
  await r.hooks.sync();
  await settled(r);
  expect(await callTool(r, "k4")).toMatchObject({ decision: undefined });
});
