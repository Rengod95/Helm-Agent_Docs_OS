import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SandboxPolicy } from "@fresnel/contracts/services";
import {
  ENVIRONMENT_EXIT_CODE,
  missingMessage,
  readSandboxEnvironment,
  shouldFailOnMissing,
  startRealSandbox,
  VAULT_SECRET,
  type RealSandbox,
} from "./support/real-sandbox.ts";
import { detectPlatformInput, selectSandboxProvider } from "../src/select.ts";

// 스크립트 환경 프로필(script-env, AGE-58 원칙 가)을 실제 srt(Seatbelt, bubblewrap)로 확인한다.
// 임시 가짜 홈과 임시 프로젝트만 쓴다. 실제 홈과 실제 비밀은 읽지 않는다. 시험 파일의 내용은 고정 문자열이다.
// (i) 프로젝트 안 읽기·쓰기 (ii) 프로젝트와 가짜 홈 밖 쓰기 거부 (iii) 호출 임시 폴더 쓰기 (iv) 보호 경로 읽기 거부
// (v) 읽기 예외 폴더와 파일 (vi) 막힌 도구 (vii) 좁은 쓰기 없음 프로필 회귀.
// 필수 바이너리가 없을 때는 sandbox.int 시험과 같다(FRESNEL_REQUIRE_SANDBOX=1이나 CI면 종료 코드 2, 그 밖에는 건너뛴다).

const environment = readSandboxEnvironment();
if (environment.supported && environment.missing.length > 0 && shouldFailOnMissing(Bun.env)) {
  process.stderr.write(`${missingMessage(environment)}\n`);
  process.exit(ENVIRONMENT_EXIT_CODE);
}
const runnable = environment.supported && environment.missing.length === 0;
const suite = runnable ? describe : describe.skip;
// 읽기 예외와 시스템 도구 막기는 Seatbelt(macOS)에서만 있다. bwrap에서는 예외를 값으로 거부한다(wrap-argv.ts)
const seatbelt = selectSandboxProvider(detectPlatformInput()).kind === "seatbelt";
const seatbeltTest = seatbelt ? test : test.skip;
const bwrapTest = seatbelt ? test.skip : test;

interface Fixture {
  readonly box: RealSandbox;
  /** 임시 프로젝트 폴더(쓰기 루트) */
  readonly project: string;
  /** 가짜 홈(`box.dirs.home`). 보호 경로 `~/.ssh`, `~/.claude`가 여기 있다 */
  readonly home: string;
  /** `~/.claude/hooks`: 읽기 예외 폴더. 안에 `helper.py`, `x.py`가 있다 */
  readonly hooks: string;
  /** 프로젝트와 가짜 홈 밖의 임시 폴더(쓰기 루트가 아니다) */
  readonly outside: string;
}

let state: Fixture | undefined;

function fixture(): Fixture {
  if (state === undefined) throw new Error("fixture is not started");
  return state;
}

/** 시험 파일은 줄바꿈으로 끝난다(`read`가 줄 끝까지 읽어야 성공이다) */
const line = (text: string): string => `${text}\n`;

/** 파일을 읽을 수 있는지만 본다. 성공은 "ok", 거부는 "denied"다. 내용은 출력하지 않는다 */
const readOk = (path: string): string =>
  `if read -r _line < '${path}' 2>/dev/null; then echo ok; else echo denied; fi`;

/** 파일 내용 한 줄을 출력한다. 거부는 "denied"다 */
const readValue = (path: string): string =>
  `if read -r value < '${path}' 2>/dev/null; then echo "$value"; else echo denied; fi`;

/** 파일을 쓸 수 있는지만 본다 */
const writeOk = (path: string): string =>
  `if printf w > '${path}' 2>/dev/null; then echo ok; else echo denied; fi`;

/** 명령 줄을 샌드박스 안에서 돌리고 종료 코드와 표준 출력을 돌려준다. 호출이 끝나면 임시 폴더를 정리한다 */
async function runIn(
  policy: SandboxPolicy,
  cwd: string,
  script: string,
): Promise<{ readonly exitCode: number; readonly lines: readonly string[] }> {
  const wrapped = await fixture().box.service.wrapArgv(
    policy,
    { command: "/bin/bash", args: ["-c", script], cwd },
    { abortSignal: undefined },
  );
  if (!wrapped.ok) throw new Error(`wrapArgv failed: ${JSON.stringify(wrapped.error)}`);
  const sandboxed = wrapped.value;
  try {
    const [command, ...args] = sandboxed.argv;
    if (command === undefined) throw new Error("empty argv");
    const child = Bun.spawn([command, ...args], {
      cwd,
      env: { ...process.env, ...sandboxed.env },
      stdout: "pipe",
      stderr: "ignore",
    });
    const exitCode = await child.exited;
    const stdout = await new Response(child.stdout).text();
    return { exitCode, lines: stdout.split("\n").filter((text) => text !== "") };
  } finally {
    sandboxed.cleanup();
  }
}

/** 스크립트 환경 정책: 프로젝트가 쓰기 루트이고 읽기 예외는 인자로 받는다 */
function scriptPolicy(readCarveOuts: readonly string[] = []): SandboxPolicy {
  const { box, project } = fixture();
  return box.service.defaultPolicy({
    workspaceRoots: [],
    tempDir: box.dirs.tmp,
    profile: "script-env",
    projectDir: project,
    readCarveOuts: [...readCarveOuts],
    systemTools: true,
  });
}

suite("script-env profile (real srt)", () => {
  beforeAll(async () => {
    const box = await startRealSandbox();
    const project = join(box.dirs.root, "project");
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, "input.txt"), line("project-input"));
    const home = box.dirs.home;
    mkdirSync(join(home, ".ssh"), { recursive: true });
    writeFileSync(join(home, ".ssh", "id_key"), line("key-value"));
    const hooks = join(home, ".claude", "hooks");
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, "helper.py"), line("helper-value"));
    writeFileSync(join(hooks, "x.py"), line("x-value"));
    writeFileSync(join(home, ".claude", "secret.json"), line("secret-json"));
    writeFileSync(join(home, "note.txt"), line("home-note"));
    state = { box, project, home, hooks, outside: join(box.dirs.workspace, "outside.txt") };
  });

  afterAll(async () => {
    if (state === undefined) return;
    await state.box.service.dispose();
    rmSync(state.box.dirs.root, { recursive: true, force: true });
    state = undefined;
  });

  test("(i) the script reads and writes inside the project folder", async () => {
    const { project } = fixture();
    const run = await runIn(
      scriptPolicy(),
      project,
      [
        readValue(join(project, "input.txt")),
        `if printf written > '${join(project, "written.txt")}'; then echo ok; else echo denied; fi`,
      ].join("; "),
    );
    expect(run.exitCode).toBe(0);
    expect(run.lines).toEqual(["project-input", "ok"]);
    expect(readFileSync(join(project, "written.txt"), "utf8")).toBe("written");
  });

  test("(ii) writes outside the project folder, in the fake home or beside the project, are denied", async () => {
    const { project, home, outside } = fixture();
    const run = await runIn(
      scriptPolicy(),
      project,
      [
        writeOk(join(home, "escaped.txt")),
        writeOk(outside),
        writeOk(join(project, "inside.txt")),
      ].join("; "),
    );
    expect(run.exitCode).toBe(0);
    expect(run.lines).toEqual(["denied", "denied", "ok"]);
    expect(existsSync(join(home, "escaped.txt"))).toBe(false);
    expect(existsSync(outside)).toBe(false);
  });

  test("(iii) the script writes into its own temp folder, a folder of its own under the sandbox temp folder", async () => {
    const { project, box } = fixture();
    const run = await runIn(
      scriptPolicy(),
      project,
      `printf 't\\n' > "$TMPDIR/s.txt" && read -r value < "$TMPDIR/s.txt" && echo "$value" && echo "$TMPDIR"`,
    );
    expect(run.exitCode).toBe(0);
    expect(run.lines.length).toBe(2);
    expect(run.lines[0]).toBe("t");
    const tempDir = run.lines[1] ?? "";
    expect(dirname(tempDir)).toBe(box.dirs.tmp);
    expect(basename(tempDir).startsWith("se-")).toBe(true);
    // 호출이 끝나면 임시 폴더는 지워진다
    expect(existsSync(tempDir)).toBe(false);
  });

  test("(iv) protected paths are not read: the vault, ~/.ssh and ~/.claude; an ordinary home file is read", async () => {
    const { project, box, home } = fixture();
    const run = await runIn(
      scriptPolicy(),
      project,
      [
        readOk(join(box.vault, "secret.txt")),
        readOk(join(home, ".ssh", "id_key")),
        readOk(join(home, ".claude", "secret.json")),
        readOk(join(home, "note.txt")),
      ].join("; "),
    );
    expect(run.exitCode).toBe(0);
    expect(run.lines).toEqual(["denied", "denied", "denied", "ok"]);
    expect(run.lines.join("\n")).not.toContain(VAULT_SECRET);
  });

  seatbeltTest(
    "(v) a folder carve-out reads its files; the protected sibling and ~/.ssh stay denied",
    async () => {
      const { project, hooks, home } = fixture();
      const run = await runIn(
        scriptPolicy([hooks]),
        project,
        [
          readValue(join(hooks, "helper.py")),
          readValue(join(hooks, "x.py")),
          readOk(join(home, ".claude", "secret.json")),
          readOk(join(home, ".ssh", "id_key")),
        ].join("; "),
      );
      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual(["helper-value", "x-value", "denied", "denied"]);
    },
  );

  seatbeltTest(
    "(v) a file carve-out reads only that file; its folder siblings stay denied",
    async () => {
      const { project, hooks } = fixture();
      const run = await runIn(
        scriptPolicy([join(hooks, "helper.py")]),
        project,
        [readValue(join(hooks, "helper.py")), readOk(join(hooks, "x.py"))].join("; "),
      );
      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual(["helper-value", "denied"]);
    },
  );

  bwrapTest(
    "(v) on bwrap a read carve-out is refused as a value, so nothing is started with it",
    async () => {
      const { project, hooks } = fixture();
      const wrapped = await fixture().box.service.wrapArgv(
        scriptPolicy([hooks]),
        { command: "/bin/bash", args: ["-c", "true"], cwd: project },
        { abortSignal: undefined },
      );
      expect(wrapped).toEqual({
        ok: false,
        error: {
          kind: "failed",
          message: "read carve-outs are not supported on this sandbox provider",
        },
      });
    },
  );

  seatbeltTest(
    "(vi) the blocked tools (osascript, security) do not run; a plain tool still runs",
    async () => {
      const { project } = fixture();
      const run = await runIn(
        scriptPolicy(),
        project,
        [
          `if /usr/bin/osascript -e 'return 1' >/dev/null 2>&1; then echo ok; else echo denied; fi`,
          `if /usr/bin/security list-keychains >/dev/null 2>&1; then echo ok; else echo denied; fi`,
          `if /bin/echo ok >/dev/null 2>&1; then echo ok; else echo denied; fi`,
        ].join("; "),
      );
      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual(["denied", "denied", "ok"]);
    },
  );

  test("(vii) regression: the narrow no-write profile reads only its readRoot and writes only its temp folder", async () => {
    const { project, box, home, outside } = fixture();
    const policy = box.service.defaultPolicy({
      workspaceRoots: [],
      tempDir: box.dirs.tmp,
      profile: "no-write",
      readRoots: [project],
    });
    const run = await runIn(
      policy,
      project,
      [
        readOk(join(project, "input.txt")),
        readOk(join(home, "note.txt")),
        readOk(join(box.vault, "secret.txt")),
        writeOk(join(project, "narrow-probe.txt")),
        writeOk(outside),
        `printf t > "$TMPDIR/s.txt" && echo ok || echo denied`,
      ].join("; "),
    );
    expect(run.exitCode).toBe(0);
    expect(run.lines).toEqual(["ok", "denied", "denied", "denied", "denied", "ok"]);
    expect(existsSync(join(project, "narrow-probe.txt"))).toBe(false);
  });
});
