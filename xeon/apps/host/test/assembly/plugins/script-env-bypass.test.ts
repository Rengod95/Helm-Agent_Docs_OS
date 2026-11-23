import { afterEach, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { err, ok, parse, type Result } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import type {
  HookProcessPort,
  HookRawRun,
  HookRunSpec,
  IsolatedChild,
  IsolationProcessPort,
  IsolationSpawnError,
  IsolationSpawnSpec,
  ManifestScriptDecl,
  PluginScriptPort,
  ScriptDraftGate,
  ScriptEnvGrant,
  ScriptRunFailure,
  ScriptRunRequest,
} from "@fresnel/contracts/extensions";
import { createScriptRunner, type ScriptRunnerDeps, type ScriptTarget } from "@fresnel/ext-host";
import { createLoaderFs } from "../../../src/assembly/trust.ts";
import { readPluginFolder } from "../../../src/assembly/plugins/folder-reader.ts";
import { createReviewedSource } from "../../../src/assembly/plugins/reviewed-source.ts";
import {
  APPROVE_TO_WORK,
  pluginRigOf,
  removeRigs,
  SILENT,
  valueOf,
  type PluginRig,
} from "./intake-rig.ts";
import { writeFiles } from "./support.ts";

// AGE-58 환경 모드의 우회 시험(안전, 실제 검토 서비스와 저장소). 매니페스트가 `scripts[].env`를 선언해도 받을 자격은 호스트 기록뿐이다.
// (1) 손으로 만든 플러그인(출처 unknown)을 승인해도, (2) 빌더가 만든 것을 승인해도, (3) 승인하지 않은 마이그레이션 초안은 시험 런에서도
// `script_env_not_granted`이고 아무것도 띄우지 않는다. (4) 승인 기록(`meta.json`)의 `importedScripts`는 마이그레이션 출처에서만 참이다.
// (5) 검토본 목록은 그 표시를 마이그레이션 검토본에만 싣는다. (6) 승인하지 않은 버전은 자격이 있어도 돌지 않는다.
// (7) 좁은 스크립트(환경 모드 선언이 없는 것)는 샌드박스 띄우기 포트로만 가고, 자격이 붙어 있어도 외부 훅 실행 포트로 가지 않는다.
// 띄우기 포트와 외부 훅 실행 포트는 기록만 하는 가짜다. 실행기가 띄우려 했다면 기록에 남는다(0이어야 한다). 로더의 자격 계산(`scriptEnvGrantOf`)은 ext-host 시험이 본다.

afterEach(() => {
  removeRigs();
});

const SCRIPT_NAME = "guard";
const MARKER_FILE = "ran.txt";
const EVIDENCE = {
  kind: "turn",
  threadId: "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  turnId: "trn_01ARZ3NDEKTSV4RRFFQ69G5FAV",
} as const;
const THREAD_ID: ThreadId = valueOf(parse(ThreadIdSchema, "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV"));

/**
 * 사용자 환경 가짜. `FRESNEL_*`(Fresnel 내부 값)와 잘못된 이름만 빠진다. `*_TOKEN`처럼 시크릿으로 보이는 이름도 기본 길에서는 넘긴다
 */
const USER_ENV: Readonly<Record<string, string>> = {
  PATH: "/usr/bin:/bin",
  MY_SERVICE_TOKEN: "dummy-token-value",
  FRESNEL_INTERNAL_KEY: "internal-value",
  "1BAD-NAME": "not-a-variable-name",
};

/** 사용자 환경을 돌려주는 가짜(호출마다 같은 값) */
const userEnvOfTest = async (): Promise<Readonly<Record<string, string>>> => USER_ENV;

/** `sh`만 이 기기의 `/bin/sh`로 푸는 실행 파일 찾기 가짜 */
const resolveShellOnly = (name: string): string | undefined =>
  name === "sh" ? "/bin/sh" : undefined;

/** 매니페스트가 선언하는 환경 모드 스크립트 하나. 실행되면 프로젝트 폴더에 표식 파일을 쓴다 */
const ENV_DECL: ManifestScriptDecl = {
  name: SCRIPT_NAME,
  runner: "sh",
  file: "scripts/guard.cmd",
  timeoutMs: 5000,
  env: {
    command: `echo ran > "$CLAUDE_PROJECT_DIR/${MARKER_FILE}"`,
    shell: "sh",
    refs: [],
    refsKnown: false,
  },
};

/** 환경 모드를 선언한 플러그인 폴더 하나. 목적 문장이 있어야 검토에서 승인할 수 있다 */
function envPluginFiles(name: string): Record<string, string> {
  return {
    ".fresnel-plugin/plugin.json": JSON.stringify({
      schemaVersion: 2,
      name,
      version: "1.0.0",
      purpose: "환경 모드를 선언하는 플러그인",
      description: "환경 모드 스크립트를 선언해 시험하는 플러그인이다.",
      entry: "./plugin.js",
      scripts: [ENV_DECL],
    }),
    "plugin.js": "export const extension = () => {};\n",
    "scripts/guard.cmd": `echo ran > "$CLAUDE_PROJECT_DIR/${MARKER_FILE}"\n`,
  };
}

/** 환경 모드 선언이 없는 좁은 스크립트 하나(샌드박스 띄우기 포트로 간다) */
const NARROW_DECL: ManifestScriptDecl = {
  name: SCRIPT_NAME,
  runner: "sh",
  file: "scripts/guard.cmd",
  timeoutMs: 5000,
};

/** 좁은 스크립트를 선언한 플러그인 폴더 하나 */
function narrowPluginFiles(name: string): Record<string, string> {
  return {
    ".fresnel-plugin/plugin.json": JSON.stringify({
      schemaVersion: 2,
      name,
      version: "1.0.0",
      purpose: "좁은 스크립트를 선언하는 플러그인",
      description: "좁은 스크립트를 선언해 시험하는 플러그인이다.",
      entry: "./plugin.js",
      scripts: [NARROW_DECL],
    }),
    "plugin.js": "export const extension = () => {};\n",
    "scripts/guard.cmd": "echo narrow\n",
  };
}

/** 띄우기 포트 가짜. 받은 명세를 기록하고 띄우지 못했다고 답한다(자식을 만들지 않는다) */
function spyPortOf(): {
  readonly port: IsolationProcessPort;
  readonly spawned: IsolationSpawnSpec[];
} {
  const spawned: IsolationSpawnSpec[] = [];
  const port: IsolationProcessPort = {
    spawn(spec): Promise<Result<IsolatedChild, IsolationSpawnError>> {
      spawned.push(spec);
      return Promise.resolve(
        err({ kind: "spawn_failed", code: "spy", message: "the spy port never starts a child" }),
      );
    },
  };
  return { port, spawned };
}

/** 외부 훅 실행 포트 가짜(환경 모드의 기본 길). 받은 명세를 기록하고 정상 종료(0)로 답한다 */
function hookSpyOf(): { readonly port: HookProcessPort; readonly runs: HookRunSpec[] } {
  const runs: HookRunSpec[] = [];
  const port: HookProcessPort = {
    run(spec): Promise<HookRawRun> {
      runs.push(spec);
      return Promise.resolve({
        exitCode: 0,
        signal: null,
        stdout: "",
        stdoutTruncated: false,
        stderr: "",
        timedOut: false,
      });
    },
  };
  return { port, runs };
}

/** `runnerOf`의 선택 값. 없으면 사용자 환경도, 승인 문도, 실행 파일 위치도 없다 */
interface RunnerOptions {
  /** 외부 훅 실행 포트(환경 모드의 기본 길). 없으면 환경 모드는 `hook_process_unavailable`이다 */
  readonly hooks?: HookProcessPort;
  readonly userEnv?: () => Promise<Readonly<Record<string, string>>>;
  readonly resolveRunner?: (name: string) => string | undefined;
  readonly draftGate?: ScriptDraftGate;
}

function runnerOf(
  target: ScriptTarget,
  port: IsolationProcessPort,
  options: RunnerOptions = {},
): PluginScriptPort {
  const { hooks, userEnv, resolveRunner, draftGate } = options;
  const deps: ScriptRunnerDeps = {
    process: port,
    hookProcess: () => hooks,
    envSandboxed: () => false,
    fs: createLoaderFs(),
    resolveRunner: resolveRunner ?? (() => undefined),
    allowedEnv: {},
    setTimer: () => () => {},
    target,
    ...(userEnv === undefined ? {} : { userEnv }),
    ...(draftGate === undefined ? {} : { draftGate }),
  };
  return createScriptRunner(deps);
}

/** 폴더의 매니페스트에서 스크립트 선언을 읽는다(호스트의 폴더 읽기와 같은 검사) */
function scriptsOf(dir: string): readonly ManifestScriptDecl[] {
  const folder = readPluginFolder(dir, { origin: "user" });
  if (!folder.ok) throw new Error(`the folder is rejected: ${folder.error.kind}`);
  return folder.value.manifest.scripts ?? [];
}

/** 승인된 검토본으로 만든 대상. 로더는 `importedScripts`가 없는 후보에 `envGrant`를 달지 않으므로 여기서도 달지 않는다 */
async function reviewedTargetOf(rig: PluginRig, name: string): Promise<ScriptTarget> {
  const reviewed = valueOf(await rig.store.current(name));
  if (reviewed === null) throw new Error(`no reviewed copy of ${name}`);
  return {
    extension: name,
    scripts: scriptsOf(reviewed.treePath),
    tree: reviewed.treePath,
    approved: true,
  };
}

function requestOf(name: string) {
  return { registration: name, name: SCRIPT_NAME, stdin: "", replay: false } as const;
}

test("a hand-made plugin that declares an environment-mode script, approved as a user item, is refused the script and nothing starts", async () => {
  const rig = pluginRigOf();
  writeFiles(join(rig.userDir, "handmade"), envPluginFiles("handmade"));
  const queued = valueOf(await rig.review.scan()).queued;
  expect(queued.length).toBe(1);
  const itemId = queued[0] ?? "";
  const item = valueOf(await rig.review.get(itemId)).item;
  // 사용자 폴더를 훑어 얻은 항목의 출처는 알 수 없음(unknown)이다. 마이그레이션도 빌더도 아니다
  expect(item.provenance).toBe("unknown");
  expect(valueOf(await rig.review.decide(itemId, APPROVE_TO_WORK)).item.state).toBe("approved");

  // 승인된 검토본이다. 선언은 있고 자격은 없다
  const target = await reviewedTargetOf(rig, "handmade");
  expect(target.scripts.map((script) => script.env?.command)).toEqual([
    `echo ran > "$CLAUDE_PROJECT_DIR/${MARKER_FILE}"`,
  ]);
  const { port, spawned } = spyPortOf();
  const hooks = hookSpyOf();
  // 사용자 환경과 기본 길을 다 갖춰도 자격이 없으면 거절한다(거절의 이유는 자격이다)
  const refused = runnerOf(target, port, { hooks: hooks.port, userEnv: async () => USER_ENV });
  expect(await refused.run(requestOf("handmade"))).toEqual(err({ kind: "script_env_not_granted" }));
  expect(spawned).toEqual([]);
  expect(hooks.runs).toEqual([]);
  // 대조: 같은 대상에 자격을 달면 자격 검사를 지나 사용자 환경 단계에서 멈춘다(띄우지 않는다). 위 거절은 자격 때문이다
  const granted: ScriptTarget = {
    ...target,
    envGrant: { granted: true, projectDir: rig.root, fromProject: false },
  };
  expect(await runnerOf(granted, port, { hooks: hooks.port }).run(requestOf("handmade"))).toEqual(
    err({
      kind: "spawn_failed",
      code: "user_env_unavailable",
      message: "the user environment is not available",
    }),
  );
  expect(spawned).toEqual([]);
  expect(hooks.runs).toEqual([]);
});

test("a grant lets the same declaration reach the hook runner: it runs as the user's own shell command in the project folder, with the user environment minus Fresnel's own values, and no sandboxed process starts", async () => {
  const rig = pluginRigOf();
  writeFiles(join(rig.userDir, "handmade"), envPluginFiles("handmade"));
  valueOf(
    await rig.review.decide(valueOf(await rig.review.scan()).queued[0] ?? "", APPROVE_TO_WORK),
  );
  const target = await reviewedTargetOf(rig, "handmade");
  const granted: ScriptTarget = {
    ...target,
    envGrant: { granted: true, projectDir: rig.root, fromProject: false },
  };
  const { port, spawned } = spyPortOf();
  const hooks = hookSpyOf();
  const runner = runnerOf(granted, port, { hooks: hooks.port, userEnv: async () => USER_ENV });
  expect(await runner.run(requestOf("handmade"))).toEqual(
    ok({
      exitCode: 0,
      signal: null,
      stdout: "",
      stdoutTruncated: false,
      stderr: "",
      stderrTruncated: false,
      timedOut: false,
    }),
  );
  expect(spawned).toEqual([]);
  expect(
    hooks.runs.map((spec) => ({
      argv: spec.argv,
      cwd: spec.cwd,
      env: spec.env,
      stdin: spec.stdin,
    })),
  ).toEqual([
    {
      argv: ["/bin/sh", "-c", `echo ran > "$CLAUDE_PROJECT_DIR/${MARKER_FILE}"`],
      cwd: rig.root,
      env: {
        PATH: "/usr/bin:/bin",
        MY_SERVICE_TOKEN: "dummy-token-value",
        CLAUDE_PROJECT_DIR: rig.root,
      },
      stdin: "",
    },
  ]);
});

test("an assistant-built plugin that declares an environment-mode script is refused the script even after it is approved", async () => {
  const rig = pluginRigOf();
  const dir = join(rig.root, "builder-kit");
  writeFiles(dir, envPluginFiles("builder-kit"));
  const made = valueOf(
    await rig.intake.submit({
      dir,
      provenance: "assistant",
      originThreadId: THREAD_ID,
      originProfileId: null,
      evidence: [EVIDENCE],
      purpose: "환경 모드를 선언하는 플러그인",
    }),
  );
  const item = valueOf(await rig.review.get(made.itemId)).item;
  expect(item.provenance).toBe("assistant");
  expect(valueOf(await rig.review.decide(made.itemId, APPROVE_TO_WORK)).item.state).toBe(
    "approved",
  );

  const target = await reviewedTargetOf(rig, "builder-kit");
  const { port, spawned } = spyPortOf();
  const hooks = hookSpyOf();
  expect(
    await runnerOf(target, port, { hooks: hooks.port, userEnv: async () => USER_ENV }).run(
      requestOf("builder-kit"),
    ),
  ).toEqual(err({ kind: "script_env_not_granted" }));
  expect(spawned).toEqual([]);
  expect(hooks.runs).toEqual([]);
});

test("a migration draft that is not approved is refused in a test run, even when a grant is attached to its target", async () => {
  const rig = pluginRigOf();
  const dir = join(rig.root, "moved-hook");
  writeFiles(dir, envPluginFiles("moved-hook"));
  const made = valueOf(
    await rig.intake.submit({
      dir,
      provenance: "migration",
      originThreadId: null,
      originProfileId: null,
      evidence: [],
      purpose: "옮긴 훅",
    }),
  );
  // 승인하지 않았다: 검토본이 없고 항목은 대기 중이다
  expect(valueOf(await rig.store.current("moved-hook"))).toBeNull();
  expect(valueOf(await rig.review.get(made.itemId)).item.state).toBe("pending");

  const { port, spawned } = spyPortOf();
  const hooks = hookSpyOf();
  const userEnv = userEnvOfTest;
  const draftTarget: ScriptTarget = {
    extension: "moved-hook",
    scripts: scriptsOf(dir),
    tree: dir,
    approved: false,
  };
  expect(
    await runnerOf(draftTarget, port, { hooks: hooks.port, userEnv }).run(requestOf("moved-hook")),
  ).toEqual(err({ kind: "script_env_not_granted" }));
  // 자격을 억지로 달아도 초안이면 막는다(승인 여부가 자격보다 먼저다)
  const granted: ScriptEnvGrant = { granted: true, projectDir: null, fromProject: false };
  const forced: ScriptTarget = { ...draftTarget, envGrant: granted };
  expect(
    await runnerOf(forced, port, { hooks: hooks.port, userEnv }).run(requestOf("moved-hook")),
  ).toEqual(err({ kind: "script_env_not_granted" }));
  expect(spawned).toEqual([]);
  expect(hooks.runs).toEqual([]);
});

test("an unapproved version never starts: an environment-mode draft with a grant attached and a narrow draft, with or without a gate, stop before any process", async () => {
  const rig = pluginRigOf();
  const { port, spawned } = spyPortOf();
  const hooks = hookSpyOf();
  const userEnv = userEnvOfTest;

  // 환경 모드 초안: 자격을 억지로 달아도 승인하지 않았으면 막힌다
  const envDir = join(rig.root, "unapproved-env");
  writeFiles(envDir, envPluginFiles("unapproved-env"));
  const envDraft: ScriptTarget = {
    extension: "unapproved-env",
    scripts: scriptsOf(envDir),
    tree: envDir,
    approved: false,
    envGrant: { granted: true, projectDir: rig.root, fromProject: false },
  };
  expect(
    await runnerOf(envDraft, port, { hooks: hooks.port, userEnv }).run(requestOf("unapproved-env")),
  ).toEqual(err({ kind: "script_env_not_granted" }));

  // 좁은 초안: 승인 문이 없으면 띄우지 않는다(`script_not_approved`)
  const narrowDir = join(rig.root, "unapproved-narrow");
  writeFiles(narrowDir, narrowPluginFiles("unapproved-narrow"));
  const narrowDraft: ScriptTarget = {
    extension: "unapproved-narrow",
    scripts: scriptsOf(narrowDir),
    tree: narrowDir,
    approved: false,
  };
  expect(await runnerOf(narrowDraft, port).run(requestOf("unapproved-narrow"))).toEqual(
    err({ kind: "script_not_approved" }),
  );

  // 승인 문이 있어도 사람이 거절하면 띄우지 않는다. 문은 대화 안의 호출마다 한 번 묻는다
  const calls: string[] = [];
  const refused: ScriptRunFailure = {
    kind: "script_denied",
    cause: "noninteractive",
    resolvedBy: "noninteractive",
  };
  const gate: ScriptDraftGate = (call) => {
    calls.push(call.name);
    return Promise.resolve(err(refused));
  };
  const inThread: ScriptRunRequest = {
    registration: "unapproved-narrow",
    name: SCRIPT_NAME,
    stdin: "",
    replay: false,
    threadId: THREAD_ID,
  };
  expect(
    await runnerOf(narrowDraft, port, { draftGate: gate, resolveRunner: resolveShellOnly }).run(
      inThread,
    ),
  ).toEqual(err(refused));
  expect(calls).toEqual([SCRIPT_NAME]);

  expect(spawned).toEqual([]);
  expect(hooks.runs).toEqual([]);
});

test("a narrow script goes through the sandboxed process port and never through the hook runner, even when a grant is attached to its target", async () => {
  const rig = pluginRigOf();
  const dir = join(rig.root, "narrow-kit");
  writeFiles(dir, narrowPluginFiles("narrow-kit"));
  const target: ScriptTarget = {
    extension: "narrow-kit",
    scripts: scriptsOf(dir),
    tree: dir,
    approved: true,
    envGrant: { granted: true, projectDir: rig.root, fromProject: false },
  };
  const { port, spawned } = spyPortOf();
  const hooks = hookSpyOf();
  const runner = runnerOf(target, port, {
    hooks: hooks.port,
    userEnv: async () => USER_ENV,
    resolveRunner: resolveShellOnly,
  });
  // 띄우기 포트까지 갔다(가짜는 띄우지 않는다고 답한다)
  expect(await runner.run(requestOf("narrow-kit"))).toEqual(
    err({ kind: "spawn_failed", code: "spy", message: "the spy port never starts a child" }),
  );
  expect(
    spawned.map((spec) => ({
      command: spec.command,
      args: spec.args,
      readRoot: spec.readRoot,
      systemTools: spec.systemTools,
      env: spec.env,
    })),
  ).toEqual([
    {
      command: "/bin/sh",
      args: [realpathSync(join(dir, "scripts", "guard.cmd"))],
      readRoot: dir,
      systemTools: true,
      env: {},
    },
  ]);
  // 좁은 스크립트는 환경 모드 길을 타지 않는다: 원래 명령의 사용자 환경도, 자격에 따른 외부 훅 실행도 없다
  expect(spawned[0]?.scriptEnv).toBeUndefined();
  expect(hooks.runs).toEqual([]);
});

test("only an approved migration item stamps importedScripts into the review meta; a user item or an assistant item does not", async () => {
  const rig = pluginRigOf();
  writeFiles(join(rig.userDir, "handmade"), envPluginFiles("handmade"));
  const handmadeItem = valueOf(await rig.review.scan()).queued[0] ?? "";
  valueOf(await rig.review.decide(handmadeItem, APPROVE_TO_WORK));

  const assistantDir = join(rig.root, "builder-kit");
  writeFiles(assistantDir, envPluginFiles("builder-kit"));
  const assistant = valueOf(
    await rig.intake.submit({
      dir: assistantDir,
      provenance: "assistant",
      originThreadId: THREAD_ID,
      originProfileId: null,
      evidence: [EVIDENCE],
      purpose: "환경 모드를 선언하는 플러그인",
    }),
  );
  valueOf(await rig.review.decide(assistant.itemId, APPROVE_TO_WORK));

  const migrationDir = join(rig.root, "moved-hook");
  writeFiles(migrationDir, envPluginFiles("moved-hook"));
  const migrated = valueOf(
    await rig.intake.submit({
      dir: migrationDir,
      provenance: "migration",
      originThreadId: null,
      originProfileId: null,
      evidence: [],
      purpose: "옮긴 훅",
    }),
  );
  valueOf(await rig.review.decide(migrated.itemId, APPROVE_TO_WORK));

  const meta = async (name: string) => {
    const reviewed = valueOf(await rig.store.current(name));
    if (reviewed === null) throw new Error(`no reviewed copy of ${name}`);
    return reviewed.meta.importedScripts;
  };
  expect([await meta("moved-hook"), await meta("builder-kit"), await meta("handmade")]).toEqual([
    true,
    undefined,
    undefined,
  ]);
});

test("the reviewed-source listing passes importedScripts only for the migration copy", async () => {
  const rig = pluginRigOf();
  writeFiles(join(rig.userDir, "handmade"), envPluginFiles("handmade"));
  valueOf(
    await rig.review.decide(valueOf(await rig.review.scan()).queued[0] ?? "", APPROVE_TO_WORK),
  );

  const assistantDir = join(rig.root, "builder-kit");
  writeFiles(assistantDir, envPluginFiles("builder-kit"));
  valueOf(
    await rig.review.decide(
      valueOf(
        await rig.intake.submit({
          dir: assistantDir,
          provenance: "assistant",
          originThreadId: THREAD_ID,
          originProfileId: null,
          evidence: [EVIDENCE],
          purpose: "환경 모드를 선언하는 플러그인",
        }),
      ).itemId,
      APPROVE_TO_WORK,
    ),
  );

  const migrationDir = join(rig.root, "moved-hook");
  writeFiles(migrationDir, envPluginFiles("moved-hook"));
  valueOf(
    await rig.review.decide(
      valueOf(
        await rig.intake.submit({
          dir: migrationDir,
          provenance: "migration",
          originThreadId: null,
          originProfileId: null,
          evidence: [],
          purpose: "옮긴 훅",
        }),
      ).itemId,
      APPROVE_TO_WORK,
    ),
  );

  const listing = await createReviewedSource(rig.store, SILENT).list();
  expect(listing.diagnostics).toEqual([]);
  expect(
    listing.entries
      .map((entry) => [entry.name, entry.importedScripts])
      .toSorted((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ).toEqual([
    ["builder-kit", undefined],
    ["handmade", undefined],
    ["moved-hook", true],
  ]);
});
