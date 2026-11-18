import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ok, parseJson, type Logger } from "@fresnel/contracts";
import type { IsolationProcessPort } from "@fresnel/contracts/extensions";
import type { SandboxServiceHandle } from "@fresnel/platform-sandbox";
import {
  createBackgroundRegistry,
  createIsolationProcessPort,
  detectProcessPlatform,
  type IsolationSandboxSource,
} from "@fresnel/platform-process";
import {
  createLocalIdFactory,
  systemClock,
  systemRandom,
  systemScheduler,
  type SystemScheduler,
} from "@fresnel/platform-os";
import type { ScanRoot } from "@fresnel/plugin-migration";
import { createMigrationScanner } from "../../src/assembly/plugins/migration-scan-child.ts";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import {
  closeSandboxService,
  openSandboxService,
  requireSandboxOrSkip,
  sandboxGate,
  type OpenedSandbox,
} from "../fixtures/sandbox-service.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// 가져오기 훑기 자식의 실제 격리 시험(migration.md §7.4 [제안], host-service §4.25). 실제 샌드박스(srt)와 실제 띄우기 포트
// (`createIsolationProcessPort`) 아래에서 자식 본체(`migration-scan --stdio`, 소스 실행)가 훑는다. 악의적 폴더를 시험이 임시 폴더에 만든다:
// 밖을 가리키는 심볼릭 링크, 폴더 고리, 상한을 넘는 파일, 밖의 비밀 파일. 엔진은 자식의 응답 줄만 받는다.
// 샌드박스를 쓸 수 없으면 건너뛰고 stderr에 한 줄 남긴다. FRESNEL_REQUIRE_SANDBOX=1 또는 CI이면 종료 코드 2(환경 문제)로 끝난다
// (mcp-sandbox.int.test.ts와 같다).

const PROBE = join(import.meta.dir, "..", "fixtures", "migration-scan-probe.ts");
/** 소스 실행의 진입 파일. 자식은 이 파일로 `migration-scan --stdio`를 실행한다 */
const MAIN_ENTRY = join(import.meta.dir, "..", "..", "src", "main.ts");
/** 소스와 node_modules가 있는 작업 공간. 자식이 런타임으로 읽는다(`pluginHostLaunch`와 같다) */
const XEON_ROOT = join(import.meta.dir, "..", "..", "..", "..");
/** 디스크의 임시 디렉터리. 샌드박스 안에서 보여야 하는 자리다(mcp-sandbox.int.test.ts와 같다) */
const DISK_TMP = "/tmp";
const OUTSIDE_SECRET = "SECRET-OUTSIDE-f3a9c1-do-not-read";
const BIG_BYTES = 3 * 1024 * 1024;

const LOGGER: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => LOGGER,
};

/** 열린 샌드박스 서비스와 스케줄러 */
type Service = OpenedSandbox;

const environment = await sandboxGate(DISK_TMP);
requireSandboxOrSkip(environment, "migration-scan-isolated.int");
const suite = environment.runnable ? describe : describe.skip;
// 조립된 엔진이 서야 `migration.scan`을 wire로 시험할 수 있다(실제 엔진 시험의 전제 검사, real-engine.ts)
const gate = await realEngineGate();
const assembledTest = gate.blocker === undefined ? test : test.skip;

/** 격리 시험의 띄우기 포트. 샌드박스 원천을 받는다(실제 서비스 또는 대조용 통과 원천). 스케줄러는 시험 묶음이 하나 쓴다 */
function portOf(sandbox: IsolationSandboxSource, scheduler: SystemScheduler): IsolationProcessPort {
  const platform = detectProcessPlatform(LOGGER);
  if (!platform.ok) throw new Error(`no process platform: ${platform.error.kind}`);
  const background = createBackgroundRegistry({
    clock: systemClock(),
    scheduler,
    ids: createLocalIdFactory(systemClock(), systemRandom()),
    logger: LOGGER,
  });
  return createIsolationProcessPort({
    platform: platform.value,
    background,
    sandbox: () => sandbox,
    parentEnv: { PATH: Bun.env["PATH"], HOME: Bun.env["HOME"] },
    scheduler,
    logger: LOGGER,
  });
}

/** 대조용 통과 원천: 정책은 실제 서비스의 것이고, 감싸기만 하지 않는다(격리 없이 띄운다) */
function unsandboxedOf(service: SandboxServiceHandle): IsolationSandboxSource {
  return {
    defaultPolicy: (input) => service.defaultPolicy(input),
    wrapArgv: (_policy, request) =>
      Promise.resolve(
        ok({
          argv: [request.command, ...request.args],
          env: {},
          sandboxed: false,
          unsandboxedBy: "disabled" as const,
          cleanup: () => undefined,
        }),
      ),
  };
}

/** 서버 대역의 표준 출력에서 첫 줄을 받는다 */
function firstLine(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    const onData = (chunk: string | Uint8Array): void => {
      text += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      const end = text.indexOf("\n");
      if (end === -1) return;
      stream.off("data", onData);
      resolve(text.slice(0, end));
    };
    stream.on("data", onData);
    stream.once("end", () => {
      reject(new Error("stdout closed before the probe line"));
    });
  });
}

/** 같은 띄우기 포트로 대역을 띄워 첫 줄을 값으로 받는다. 대역은 표준 입력이 닫히면 끝난다 */
async function runProbe(
  port: IsolationProcessPort,
  readRoot: string,
  args: readonly string[],
): Promise<unknown> {
  const spawned = await port.spawn({
    command: process.execPath,
    args: [PROBE, ...args],
    readRoot,
    runtimeReadRoots: [XEON_ROOT],
    env: {},
    label: "migration-scan probe",
  });
  if (!spawned.ok) throw new Error(`spawn failed: ${spawned.error.kind}`);
  const child = spawned.value;
  try {
    const parsed = parseJson(await firstLine(child.stdout));
    if (!parsed.ok) throw new Error("the probe line is not JSON");
    return parsed.value;
  } finally {
    child.stdin.end();
    await child.exited;
  }
}

/** 훑기 루트 둘과 악의적 자료. 밖 폴더에 비밀 파일이 있고, 프로젝트 안의 링크가 그것을 가리킨다 */
interface Box {
  readonly root: string;
  readonly home: string;
  readonly proj: string;
  readonly outside: string;
  readonly secretFile: string;
  readonly service: Service;
}

function buildBox(root: string, service: Service): Box {
  const home = join(root, "home");
  const proj = join(root, "proj");
  const outside = join(root, "outside");
  const secretFile = join(outside, "secret.txt");
  const files: readonly [string, string][] = [
    [join(home, ".claude", "CLAUDE.md"), "사용자 지침\n"],
    [join(proj, "CLAUDE.md"), "프로젝트 지침\n"],
    [
      join(proj, ".agents", "skills", "deploy", "SKILL.md"),
      "---\nname: deploy\ndescription: 배포\n---\n본문\n",
    ],
    [secretFile, `${OUTSIDE_SECRET}\n`],
    [
      join(outside, "leak", "SKILL.md"),
      `---\nname: leak\ndescription: ${OUTSIDE_SECRET}\n---\n본문\n`,
    ],
    [
      join(proj, ".agents", "skills", "big", "SKILL.md"),
      `---\nname: big\n---\n${"가".repeat(BIG_BYTES / 3)}\n`,
    ],
  ];
  for (const [path, text] of files) {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  // 폴더 고리: 스킬 폴더 안에서 자기 상위를 가리킨다
  symlinkSync(join(proj, ".agents", "skills"), join(proj, ".agents", "skills", "loop"));
  // 밖을 가리키는 링크: 루트 밖의 폴더를 스킬로 보이게 한다
  symlinkSync(join(outside, "leak"), join(proj, ".agents", "skills", "leak"));
  return { root, home, proj, outside, secretFile, service };
}

suite("the scan child under the real sandbox (srt) and the real isolation port", () => {
  let previousTmpdir: string | undefined;
  let box: Box | undefined;
  let scheduler: SystemScheduler | undefined;

  beforeAll(async () => {
    previousTmpdir = Bun.env["TMPDIR"];
    Bun.env["TMPDIR"] = DISK_TMP;
    const root = realpathSync(mkdtempSync(join(DISK_TMP, "fresnel-migration-scan-")));
    const service = await openSandboxService(root);
    box = buildBox(root, service);
    scheduler = systemScheduler();
  });

  afterAll(async () => {
    if (previousTmpdir === undefined) delete Bun.env["TMPDIR"];
    else Bun.env["TMPDIR"] = previousTmpdir;
    if (box !== undefined) {
      await closeSandboxService(box.service);
      rmSync(box.root, { recursive: true, force: true });
    }
    scheduler?.dispose();
  });

  function boxOf(): { readonly box: Box; readonly scheduler: SystemScheduler } {
    if (box === undefined || scheduler === undefined)
      throw new Error("the fixture box is not built");
    return { box, scheduler };
  }

  test("the sandboxed probe cannot read the file outside its folder or write inside it, but can read inside (the policy is not deny-all)", async () => {
    const current = boxOf();
    const writeTarget = join(current.box.home, "probe-written.txt");
    const outcome = await runProbe(
      portOf(current.box.service.service, current.scheduler),
      current.box.home,
      [current.box.secretFile, join(current.box.home, ".claude", "CLAUDE.md"), writeTarget],
    );
    expect(outcome).toEqual({ readOutside: "denied", readInside: "ok", writeInside: "denied" });
    expect(existsSync(writeTarget)).toBe(false);
  }, 60_000);

  test("the same probe without the sandbox reads the outside file and writes inside (control: the probe can do it when nothing stops it)", async () => {
    const current = boxOf();
    const writeTarget = join(current.box.home, "probe-control.txt");
    const outcome = await runProbe(
      portOf(unsandboxedOf(current.box.service.service), current.scheduler),
      current.box.home,
      [current.box.secretFile, join(current.box.home, ".claude", "CLAUDE.md"), writeTarget],
    );
    expect(outcome).toEqual({ readOutside: "ok", readInside: "ok", writeInside: "ok" });
    rmSync(writeTarget, { force: true });
  }, 60_000);

  test("a hostile folder (a link out of the roots, a directory loop, a file past the byte limit) scans to the end with no outside content in the reply", async () => {
    const current = boxOf();
    const scanner = createMigrationScanner(
      {
        process: () => portOf(current.box.service.service, current.scheduler),
        sandbox: () => current.box.service.service,
        self: { execPath: process.execPath, entry: MAIN_ENTRY },
        scheduler: current.scheduler,
      },
      LOGGER,
    );
    const roots: ScanRoot[] = [
      { path: current.box.home, scope: "user", label: "홈" },
      { path: current.box.proj, scope: "project", label: "proj" },
    ];
    const outcome = await scanner.run({
      scanId: "scan-isolated-1",
      roots,
      homeDir: current.box.home,
      onProgress: () => undefined,
    });
    if (!outcome.ok) throw new Error(`the sandboxed scan failed: ${outcome.error}`);
    const reply = outcome.value;
    // 밖의 비밀 값은 응답 어디에도 없다
    expect(JSON.stringify(reply)).not.toContain(OUTSIDE_SECRET);
    // 밖을 가리키는 링크는 따라가지 않아 스킬로 잡히지 않는다
    expect(reply.items.some((item) => item.ir.kind === "skill" && item.ir.dirName === "leak")).toBe(
      false,
    );
    // 프로젝트 안의 지침과 스킬은 잡힌다
    expect(reply.items.some((item) => item.path.endsWith("proj/CLAUDE.md"))).toBe(true);
    expect(
      reply.items.some((item) => item.ir.kind === "skill" && item.ir.dirName === "deploy"),
    ).toBe(true);
    // 상한을 넘는 스킬 파일은 읽지 않고 진단으로 남는다
    expect(reply.diagnostics.some((item) => item.code === "too_large")).toBe(true);
    expect(reply.limitReached).toBe(false);
  }, 120_000);

  assembledTest(
    "the assembled engine answers migration.scan through the real child under the real sandbox (the wiring of the process port, the sandbox and the self command)",
    async () => {
      const current = boxOf();
      const home = useEngineHome();
      const host = await startInProcessHost({
        devChecks: true,
        defaultGroups: false,
        pluginHost: { self: { execPath: process.execPath, entry: MAIN_ENTRY } },
      });
      const connection = createHostConnection(host.client);
      try {
        await connection.request("host.hello", HELLO_PARAMS);
        const scanned = await connection.request("migration.scan", {
          roots: [
            { path: current.box.home, scope: "user", label: "홈" },
            { path: current.box.proj, scope: "project", label: "proj" },
          ],
        });
        expect(scanned.summary.itemCount).toBeGreaterThan(0);
        expect(scanned.items.some((item) => item.path.endsWith("proj/CLAUDE.md"))).toBe(true);
        expect(JSON.stringify(scanned)).not.toContain(OUTSIDE_SECRET);
      } finally {
        await connection.close();
        await host.close();
        home.dispose();
      }
    },
    120_000,
  );
});
