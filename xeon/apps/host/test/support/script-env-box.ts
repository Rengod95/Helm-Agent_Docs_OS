import { createHash, randomUUID } from "node:crypto";
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
import type {
  HookProcessPort,
  IsolationProcessPort,
  LoaderFs,
  ManifestScriptDecl,
  ScriptEnvDecl,
  ScriptEnvGrant,
  ScriptRunFailure,
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
  createHookRunner,
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
import { nodeScriptRefReader, readCarveOutsOf } from "../../src/assembly/script-env-host.ts";

// 환경 모드(가져온 훅, AGE-58 원칙 가)의 시험 도구. `createScriptRunner`(환경 모드 선언)를 돌린다.
// 두 길이 있다(호출마다 `envSandboxed`로 고른다, 기본은 참):
// - 참(옛 길, 기본): 실제 샌드박스 서비스와 띄우기 포트로 돈다. 샌드박스의 `home`(OsDirs.home)은 임시 가짜 홈이다: 보호 경로
//   (`~/.ssh`, `~/.claude`, `~/Library/Keychains`)가 가짜 홈 아래에 있다. 자식의 사용자 환경은 이 프로세스 환경의 복사본이라
//   PATH의 버전 관리자 shim이 돈다(호출마다 `extraEnv`로 HOME 등을 바꿀 수 있다).
// - 거짓(기본 길, 사용자 권한·샌드박스 없음): 실제 `createHookRunner`로 돈다. 자식의 HOME은 항상 임시 가짜 홈이다(실제 홈을
//   넘기지 않는다). 사용자 환경은 `userEnv`로 준 값만 쓴다.
// 이 파일은 `script-box.ts`(좁은 모드)의 동작을 바꾸지 않는다. 같은 도구를 따로 연다.

const DISK_TMP = "/tmp";

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

/** 이 프로세스의 환경 복사본(값이 있는 것만). 자식의 사용자 환경이 된다 */
export function processEnvCopy(): Record<string, string> {
  const copy: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) copy[name] = value;
  }
  return copy;
}

/** 파일 내용의 `sha256:<hex>` 지문(시험이 참조 지문을 만들 때 쓴다) */
export function sha256Of(path: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

/** 폴더 아래 모든 경로(상대, 정렬). 쓰기가 생겼는지 보는 스냅샷이다. 내용은 읽지 않는다 */
export function listTree(dir: string): readonly string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      out.push(rel);
      if (entry.isDirectory() && !entry.isSymbolicLink()) walk(join(current, entry.name), rel);
    }
  };
  walk(dir, "");
  return out.toSorted();
}

export interface EnvRunSpec {
  /** 매니페스트 스크립트 이름(동반 파일 `<이름>.cmd`가 확장 폴더에 생긴다) */
  readonly name: string;
  /** 원래 명령 문자열(`env.command`) */
  readonly command: string;
  readonly shell?: "sh" | "bash";
  /** 참조 파일과 가져올 때의 지문 */
  readonly refs?: ScriptEnvDecl["refs"];
  readonly stdin?: string;
  readonly timeoutMs?: number;
  /** 기본은 이 프로젝트 폴더에 대한 승인 기록(`granted: true`). `"none"`이면 기록을 주지 않는다 */
  readonly grant?: ScriptEnvGrant | "none";
  /** 기본은 샌드박스 서비스의 `status().available`(운영과 같다) */
  readonly sandboxAvailable?: () => boolean;
  /** 사용자 환경 복사본에 더하는 값(이 호출만 쓴다). 예: `HOME`을 가짜 홈으로 */
  readonly extraEnv?: Readonly<Record<string, string>>;
  /** 옛 길(샌드박스 안)로 돌릴지. 기본은 참(`envSandboxed: () => true`). 거짓이면 기본 길(사용자 권한, 샌드박스 없음)로 돈다 */
  readonly envSandboxed?: boolean;
  /**
   * 사용자 환경 전체. 주면 프로세스 환경 복사본과 `extraEnv`를 쓰지 않는다. 기본 길에서는 HOME이 가짜 홈으로 덮인다.
   * 기본 길 시험이 실제 비밀 대신 가짜 값만 넣을 때 쓴다
   */
  readonly userEnv?: Readonly<Record<string, string>>;
}

export type EnvRunOutcome = Result<ScriptRunResult, ScriptRunFailure>;

export interface ScriptEnvBox {
  readonly root: string;
  /** 가짜 홈(realpath). 샌드박스의 `OsDirs.home`이다: 보호 경로가 여기 있다 */
  readonly home: string;
  /** 임시 프로젝트 폴더(realpath). `README.md` 하나를 커밋한 git 저장소다 */
  readonly project: string;
  /** 확장 폴더. 동반 파일이 여기 생긴다 */
  readonly tree: string;
  /** 바깥(프로젝트와 가짜 홈 밖, 임시 폴더 안)의 빈 폴더 */
  readonly outside: string;
  /** 가짜 비밀 값. 고유한 문자열이라 결과에 나오면 안 된다 */
  readonly secrets: {
    readonly ssh: string;
    readonly credentials: string;
    readonly keychain: string;
    readonly env: string;
  };
  readonly service: SandboxServiceHandle;
  /** 띄우기 포트까지 간 호출 수(실행기가 막아서 띄우지 않은 호출은 세지 않는다) */
  readonly spawns: () => number;
  /** 기본 길의 훅 실행 포트까지 간 호출 수(막혀서 실행되지 않은 호출은 세지 않는다) */
  readonly hookRuns: () => number;
  readonly run: (spec: EnvRunSpec) => Promise<EnvRunOutcome>;
  readonly close: () => Promise<void>;
}

async function createService(
  dirs: OsDirs,
  scheduler: SystemScheduler,
  protectedPathsExtra: readonly string[],
): Promise<SandboxServiceHandle> {
  return createSandboxService(
    {
      os: {
        dirs,
        time: { clock: systemClock(), scheduler, random: systemRandom() },
        logger: () => LOGGER,
        resolveBinary: (name) => resolveOnPath(name),
      },
      // 기본은 읽기를 막지 않는다(AGE-63). 이 상자는 사용자가 `extra`에 적은 상태를 흉내 낸다
      settings: () => ({
        ...readSandboxSettings(() => undefined),
        protectedPathsExtra: [...protectedPathsExtra],
      }),
    },
    new AbortController().signal,
  );
}

/** 승인 기록(기본). 프로젝트 폴더를 쓰기 루트로 연다 */
function grantFor(projectDir: string): ScriptEnvGrant {
  return { granted: true, projectDir, fromProject: false };
}

/** 파일을 쓴다(상위 폴더를 만든다). 시험 고정 내용만 쓴다 */
function writeText(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

/** 임시 프로젝트(git 저장소)와 가짜 홈(고정 모양)을 만든다. git 설정은 가짜 홈의 `.gitconfig`만 읽는다 */
function buildFixtures(root: string): {
  readonly home: string;
  readonly project: string;
  readonly secrets: ScriptEnvBox["secrets"];
} {
  const home = join(root, "home");
  const project = join(root, "project");
  const token = randomUUID();
  const secrets = {
    ssh: `FAKE-SSH-KEY-${token}`,
    credentials: `FAKE-CREDENTIALS-${token}`,
    keychain: `FAKE-KEYCHAIN-${token}`,
    env: `FAKE-ENV-VALUE-${token}`,
  };
  writeText(join(home, ".gitconfig"), "[user]\n\tname = fake\n\temail = fake@example.invalid\n");
  writeText(join(home, ".ssh", "id_fake"), `${secrets.ssh}\n`);
  writeText(join(home, ".claude", "hooks", "x.py"), "import helper\nprint(helper.VALUE)\n");
  writeText(join(home, ".claude", "hooks", "helper.py"), 'VALUE = "helper-ok"\n');
  writeText(join(home, ".claude", "credentials.json"), `{"token": "${secrets.credentials}"}\n`);
  writeText(join(home, "Library", "Keychains", "fake.keychain"), `${secrets.keychain}\n`);
  mkdirSync(project, { recursive: true });
  const gitEnv = { ...processEnvCopy(), HOME: home };
  const git = (args: readonly string[]): void => {
    const ran = Bun.spawnSync(["git", ...args], {
      cwd: project,
      env: gitEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (ran.exitCode !== 0) throw new Error(`fixture git step failed: ${args.join(" ")}`);
  };
  git(["init", "-q"]);
  writeText(join(project, "README.md"), "committed\n");
  git(["add", "README.md"]);
  git([
    "-c",
    "user.name=fake",
    "-c",
    "user.email=fake@example.invalid",
    "commit",
    "-q",
    "-m",
    "init",
  ]);
  return { home, project: realpathSync(project), secrets };
}

/** 환경 모드 시험 상자를 연다. 호출자가 `close`를 부른다 */
export async function openScriptEnvBox(): Promise<ScriptEnvBox> {
  const root = realpathSync(mkdtempSync(join(DISK_TMP, "fresnel-script-env-")));
  const { home, project, secrets } = buildFixtures(root);
  const tree = join(root, "plugin", "tree");
  const outside = join(root, "outside");
  const dirs: OsDirs = {
    home,
    data: join(root, "data"),
    config: join(root, "config"),
    cache: join(root, "cache"),
    state: join(root, "state"),
    runtime: join(root, "run"),
    resource: join(root, "resource"),
    tmp: join(root, "tmp"),
  };
  for (const dir of [
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
  const scheduler = systemScheduler();
  // 사용자가 `l0.sandbox.protectedPaths.extra`에 적은 것으로 가정한다: 가짜 홈의 키, 자격 파일, 키체인 폴더와 프로젝트 `.env`
  const extra = [
    join(home, ".ssh"),
    join(home, ".claude", "credentials.json"),
    join(home, "Library", "Keychains"),
    join(project, ".env"),
  ];
  // srt는 프로세스 전역 싱글턴이다. 먼저 만든 서비스를 끄고 나서 시험 서비스를 만든다
  const warmup = await createService(dirs, scheduler, extra);
  await warmup.dispose();
  const service = await createService(dirs, scheduler, extra);
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
    parentEnv: process.env,
    scheduler,
    logger: LOGGER,
  });
  let spawnCount = 0;
  const counted: IsolationProcessPort = {
    spawn: (spec) => {
      spawnCount += 1;
      return port.spawn(spec);
    },
  };
  // 기본 길의 실제 훅 실행기(샌드박스 없음). 시간 제한과 정리는 이 포트가 맡는다
  const hookRunner = createHookRunner({
    platform: platform.value,
    scheduler,
    graceMs: 100,
    shutdownSignal: new AbortController().signal,
    logger: LOGGER,
  });
  let hookCount = 0;
  const hooks: HookProcessPort = {
    run: (hookSpec) => {
      hookCount += 1;
      return hookRunner.run(hookSpec);
    },
  };
  const run = async (spec: EnvRunSpec): Promise<EnvRunOutcome> => {
    const shell = spec.shell ?? "sh";
    const file = `${spec.name}.cmd`;
    writeFileSync(join(tree, file), `${spec.command}\n`);
    const decl: ManifestScriptDecl = {
      name: spec.name,
      runner: shell,
      file,
      env: { command: spec.command, shell, refs: [...(spec.refs ?? [])], refsKnown: true },
    };
    const grant = spec.grant ?? grantFor(project);
    const extra = spec.extraEnv ?? {};
    const sandboxed = spec.envSandboxed ?? true;
    const runner = createScriptRunner({
      process: counted,
      // 옛 길에서는 훅 포트를 주지 않는다(샌드박스 없는 길로 새지 않게). 기본 길에서만 준다
      ...(sandboxed ? {} : { hookProcess: () => hooks }),
      envSandboxed: () => sandboxed,
      fs: nodeFs,
      target: {
        extension: "demo",
        scripts: [decl],
        tree,
        approved: true,
        ...(grant === "none" ? {} : { envGrant: grant }),
      },
      resolveRunner: (name) =>
        name === "sh" ? "/bin/sh" : name === "bash" ? "/bin/bash" : undefined,
      allowedEnv: {},
      setTimer: (ms, fn) => {
        const handle = scheduler.setTimeout(fn, ms);
        return () => scheduler.clearTimeout(handle);
      },
      userEnv: async () => {
        const base = spec.userEnv ?? { ...processEnvCopy(), ...extra };
        // 기본 길은 가짜 홈을 HOME으로 쓴다. 실제 홈이 훅에 넘어가지 않게 덮는다
        return sandboxed ? base : { ...base, HOME: home };
      },
      refs: nodeScriptRefReader,
      readCarveOutsFor: readCarveOutsOf(() => service.protectedPaths()),
      sandboxAvailable: spec.sandboxAvailable ?? (() => service.status().available),
    });
    return runner.run({
      registration: "demo",
      name: spec.name,
      stdin: spec.stdin ?? "",
      replay: false,
    });
  };
  return {
    root,
    home,
    project,
    tree,
    outside,
    secrets,
    service,
    spawns: () => spawnCount,
    hookRuns: () => hookCount,
    run,
    close: async () => {
      await background.close({ graceMs: 100 });
      await service.dispose();
      scheduler.dispose();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** 샌드박스를 쓸 수 있는가를 한 번 본다. 상자를 열고 바로 닫는다 */
export async function sandboxGateOf(): Promise<{
  readonly runnable: boolean;
  readonly reason: string;
}> {
  const box = await openScriptEnvBox();
  try {
    const status = box.service.status();
    return {
      runnable: status.available,
      reason: status.reason ?? "the sandbox service is not available",
    };
  } finally {
    await box.close();
  }
}
