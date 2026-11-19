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
import type { ThreadId } from "@fresnel/contracts/conversation";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import type {
  IsolationSpawnSpec,
  LoaderFs,
  ManifestScriptDecl,
  ScriptDraftGate,
  ScriptRunner,
  ScriptRunResult,
} from "@fresnel/contracts/extensions";
import type { BinaryError, BinaryName, OsDirs, ResolvedBinary } from "@fresnel/contracts/services";
import { createScriptRunner } from "@fresnel/ext-host";
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

// 스크립트 실행기의 경계 시험이 같이 쓰는 도구. 실제 샌드박스 아래에서 임시 폴더의 확장 폴더 `tree/`에 스크립트를 두고 돌린다.
// 시험이 만든 가짜 비밀 파일과 시험이 띄운 로컬 수신기만 쓴다(실제 홈, 키체인, 외부 주소는 쓰지 않는다).

const DISK_TMP = "/tmp";
const DRAFT_THREAD: ThreadId = fixedIdFactory(51).next("thr");

const LOGGER: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => LOGGER,
};

function resolveOnPath(name: BinaryName): Promise<Result<ResolvedBinary, BinaryError>> {
  const found = Bun.which(name);
  return Promise.resolve(
    found === null
      ? err({ kind: "not_found", name, searched: [], hint: "" })
      : ok({ name, path: found, version: "99.0.0", source: "system" }),
  );
}

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

export interface ScriptBox {
  readonly root: string;
  readonly tree: string;
  readonly outside: string;
  readonly home: string;
  readonly scheduler: SystemScheduler;
  readonly service: SandboxServiceHandle;
  /** 선언한 스크립트 하나를 한 번 돌린다. 본문은 `tree/<name>.<ext>`로 둔다 */
  readonly run: (spec: RunSpec) => Promise<ScriptRunResult | string>;
  /** 실행기 이름의 절대 경로. 이 기기에 없으면 undefined */
  readonly runner: (name: ScriptRunner) => string | undefined;
  readonly close: () => Promise<void>;
}

interface RunSpec {
  readonly runner: ScriptRunner;
  readonly body: string;
  readonly args?: readonly string[];
  readonly stdin?: string;
  readonly timeoutMs?: number;
  /**
   * `false`면 실행기가 켠 시스템 도구 읽기(`systemTools`)를 떼고 띄운다. 넓히기 전의 경계를 같은 시험으로 다시 보는 대조용이다. 기본은 실행기가 정한 대로(켬)다
   */
  readonly systemTools?: boolean;
  /** 있으면 초안(검토 전)으로 돌린다: 승인 문을 걸고 호출한 대화를 붙인다 */
  readonly draft?: { readonly gate: ScriptDraftGate };
}

/** 실행기 이름을 절대 경로로 푼다. 시험이 쓰는 값이다 */
interface RunnerPaths {
  readonly sh: string;
  readonly bash: string;
  readonly bun: string | undefined;
}

function runnerPaths(): RunnerPaths {
  const real = Bun.which("bun");
  return { sh: "/bin/sh", bash: "/bin/bash", bun: real === null ? undefined : realpathSync(real) };
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

export async function openScriptBox(options?: {
  readonly resolve?: (name: ScriptRunner) => string | undefined;
}): Promise<ScriptBox> {
  const root = realpathSync(mkdtempSync(join(DISK_TMP, "fresnel-script-box-")));
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
  const dirList: readonly string[] = [
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
  ];
  for (const dir of dirList) mkdirSync(dir, { recursive: true });
  const scheduler = systemScheduler();
  // srt는 프로세스 전역 싱글턴이다. 먼저 만든 서비스를 끄고 나서 시험 서비스를 만든다
  const warmup = await createService(dirs, scheduler);
  await warmup.dispose();
  const service = await createService(dirs, scheduler);
  const platform = detectProcessPlatform();
  if (!platform.ok) throw new Error("this test needs a supported platform");
  const background: BackgroundRegistryController = createBackgroundRegistry({
    clock: systemClock(),
    scheduler,
    ids: createLocalIdFactory(systemClock(), systemRandom()),
    logger: LOGGER,
  });
  const port = createIsolationProcessPort({
    platform: platform.value,
    background,
    sandbox: () => service,
    parentEnv: { PATH: process.env["PATH"] },
    scheduler,
    logger: LOGGER,
  });
  const paths = runnerPaths();
  const resolve =
    options?.resolve ??
    ((name: ScriptRunner) =>
      name === "sh"
        ? paths.sh
        : name === "bash"
          ? paths.bash
          : name === "bun"
            ? paths.bun
            : undefined);
  let counter = 0;
  const run = async (spec: RunSpec): Promise<ScriptRunResult | string> => {
    counter += 1;
    const name = `s${counter}`;
    const file = `${name}.${spec.runner === "bun" ? "ts" : spec.runner === "node" ? "mjs" : spec.runner === "python3" ? "py" : "sh"}`;
    writeFileSync(join(tree, file), spec.body);
    const scripts: ManifestScriptDecl[] = [
      {
        name,
        runner: spec.runner,
        file,
        ...(spec.args === undefined ? {} : { args: [...spec.args] }),
        ...(spec.timeoutMs === undefined ? {} : { timeoutMs: spec.timeoutMs }),
      },
    ];
    const process =
      spec.systemTools === false
        ? {
            spawn: (request: IsolationSpawnSpec) => {
              const { systemTools: _dropped, ...narrowed } = request;
              return port.spawn(narrowed);
            },
          }
        : port;
    const runner = createScriptRunner({
      process,
      fs: nodeFs,
      target: { extension: "demo", scripts, tree, approved: spec.draft === undefined },
      resolveRunner: resolve,
      allowedEnv: {},
      ...(spec.draft === undefined ? {} : { draftGate: spec.draft.gate }),
      setTimer: (ms, fn) => {
        const handle = scheduler.setTimeout(fn, ms);
        return () => scheduler.clearTimeout(handle);
      },
    });
    const outcome = await runner.run({
      registration: "demo",
      name,
      stdin: spec.stdin ?? "",
      replay: false,
      ...(spec.draft === undefined ? {} : { threadId: DRAFT_THREAD }),
    });
    return outcome.ok ? outcome.value : `failure:${JSON.stringify(outcome.error)}`;
  };
  return {
    root,
    tree,
    outside,
    home: dirs.home,
    scheduler,
    service,
    run,
    runner: resolve,
    close: async () => {
      await background.close({ graceMs: 100 });
      await service.dispose();
      scheduler.dispose();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function sandboxAvailable(box: ScriptBox): boolean {
  return box.service.status().available;
}
