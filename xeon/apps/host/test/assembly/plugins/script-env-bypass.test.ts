import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { err, type Result } from "@fresnel/contracts";
import type {
  IsolatedChild,
  IsolationProcessPort,
  IsolationSpawnError,
  IsolationSpawnSpec,
  ManifestScriptDecl,
  PluginScriptPort,
  ScriptEnvGrant,
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
// (5) 검토본 목록은 그 표시를 마이그레이션 검토본에만 싣는다.
// 띄우기 포트는 기록만 하는 가짜다. 실행기가 띄우려 했다면 기록에 남는다(0이어야 한다). 로더의 자격 계산(`scriptEnvGrantOf`)은 ext-host 시험이 본다.

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
const THREAD_ID = "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV";

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
      entry: "./plugin.js",
      scripts: [ENV_DECL],
    }),
    "plugin.js": "export const extension = () => {};\n",
    "scripts/guard.cmd": `echo ran > "$CLAUDE_PROJECT_DIR/${MARKER_FILE}"\n`,
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

function runnerOf(target: ScriptTarget, port: IsolationProcessPort): PluginScriptPort {
  const deps: ScriptRunnerDeps = {
    process: port,
    fs: createLoaderFs(),
    resolveRunner: () => undefined,
    allowedEnv: {},
    setTimer: () => () => {},
    target,
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
  const runner = runnerOf(target, port);
  expect(await runner.run(requestOf("handmade"))).toEqual(err({ kind: "script_env_not_granted" }));
  expect(spawned).toEqual([]);
  // 대조: 같은 대상에 자격을 달면 자격 검사를 지나 사용자 환경 단계에서 멈춘다(띄우지 않는다). 위 거절은 자격 때문이다
  const granted: ScriptTarget = {
    ...target,
    envGrant: { granted: true, projectDir: rig.root, fromProject: false },
  };
  expect(await runnerOf(granted, port).run(requestOf("handmade"))).toEqual(
    err({
      kind: "spawn_failed",
      code: "user_env_unavailable",
      message: "the user environment is not available",
    }),
  );
  expect(spawned).toEqual([]);
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
  expect(await runnerOf(target, port).run(requestOf("builder-kit"))).toEqual(
    err({ kind: "script_env_not_granted" }),
  );
  expect(spawned).toEqual([]);
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
  const draftTarget: ScriptTarget = {
    extension: "moved-hook",
    scripts: scriptsOf(dir),
    tree: dir,
    approved: false,
  };
  expect(await runnerOf(draftTarget, port).run(requestOf("moved-hook"))).toEqual(
    err({ kind: "script_env_not_granted" }),
  );
  // 자격을 억지로 달아도 초안이면 막는다(승인 여부가 자격보다 먼저다)
  const granted: ScriptEnvGrant = { granted: true, projectDir: null, fromProject: false };
  const forced: ScriptTarget = { ...draftTarget, envGrant: granted };
  expect(await runnerOf(forced, port).run(requestOf("moved-hook"))).toEqual(
    err({ kind: "script_env_not_granted" }),
  );
  expect(spawned).toEqual([]);
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
