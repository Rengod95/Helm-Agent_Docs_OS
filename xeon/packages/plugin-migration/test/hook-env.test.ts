// 환경 모드 시험(migration.md §4.3.5, AGE-58 사용자 결정 2026-11-20): 명령 원문을 싣고, 참조 파일의 지문과 도구와 버전 근거를 찾는다.
// 표의 명령은 설계 메모(_notes/w2/script-env-design.md 2절)의 목록이다. 값을 비교하고, 명령은 실행하지 않는다.
import { describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attemptAsync, parseJson } from "@fresnel/contracts";
import {
  describeHookCommand,
  HOOK_INPUT_NAMES,
  type HookFileInfo,
} from "../src/adapters/hook-env.ts";
import { sha256Hex } from "../src/hash.ts";
import {
  decodeScanItem,
  emit,
  parseScanChildLine,
  propose,
  scanJsonReplacer,
  scanRoots,
  type MigrationScan,
  type PlannedPluginWithMigration,
  type ReportLine,
  type ScanContext,
} from "../src/index.ts";
import { memoryFs } from "./support.ts";
import {
  FAKE_TOKEN,
  HOME,
  PROJECT_ROOT,
  USER_ROOT,
  decode,
  manifestOf,
  projectFiles,
  rulesetsOf,
} from "./hook-support.ts";

const APP = PROJECT_ROOT.path;

/** PATH에 `uv`만 있다고 보는 조회 */
const ONLY_UV_ON_PATH = (name: string): string | undefined =>
  name === "uv" ? `/usr/bin/${name}` : undefined;

/** 메모리 값으로 만든 참조 정보. 없는 경로는 undefined다 */
function fakeInfo(
  files: Readonly<Record<string, string>>,
): (path: string) => Promise<HookFileInfo | undefined> {
  return async (path) => {
    if (!Object.hasOwn(files, path)) return undefined;
    const text = files[path] ?? "";
    return {
      size: text.length,
      sha256: sha256Hex(text),
      firstLine: text.split("\n")[0],
      inputNames: HOOK_INPUT_NAMES.filter((name) => text.includes(name)),
    };
  };
}

/** 실제 파일을 읽는 참조 정보(임시 폴더 시험용). 정규 파일이 아니면 undefined다 */
async function diskFileInfo(path: string): Promise<HookFileInfo | undefined> {
  const stat = await attemptAsync(() => lstat(path));
  if (!stat.ok || !stat.value.isFile()) return undefined;
  const bytes = new Uint8Array(await readFile(path));
  const text = new TextDecoder().decode(bytes);
  return {
    size: bytes.byteLength,
    sha256: sha256Hex(bytes),
    firstLine: (text.split("\n")[0] ?? "").replace(/\r$/, ""),
    inputNames: HOOK_INPUT_NAMES.filter((name) => text.includes(name)),
  };
}

function contextOf(onPath: ((name: string) => string | undefined) | undefined): ScanContext {
  return onPath === undefined ? { homeDir: HOME } : { homeDir: HOME, onPath };
}

/** 프로젝트 범위의 PreToolUse 설정 하나로 훑고 제안한다. `files`의 키는 프로젝트 폴더 기준이다 */
async function proposeProject(
  command: string,
  files: Readonly<Record<string, string>>,
  onPath?: (name: string) => string | undefined,
): Promise<{ readonly scan: MigrationScan; readonly proposal: ReturnType<typeof propose> }> {
  const settings = { hooks: { PreToolUse: [{ hooks: [{ type: "command", command }] }] } };
  const scan = await scanRoots({
    roots: [PROJECT_ROOT],
    fs: memoryFs(projectFiles(settings, files)),
    ctx: contextOf(onPath),
  });
  return { scan, proposal: propose(scan, rulesetsOf(), { answers: {} }) };
}

/** 훑기 결과에서 Hook 플러그인 하나를 꺼낸다 */
function hookPluginOf(plugins: readonly PlannedPluginWithMigration[]): PlannedPluginWithMigration {
  const found = plugins.find((plugin) => plugin.runtime !== undefined);
  if (found === undefined) throw new Error("no hook plugin was proposed");
  return found;
}

function hookLine(report: readonly ReportLine[]): ReportLine {
  const line = report.find((entry) => entry.kind === "hook");
  if (line === undefined) throw new Error("no hook report line");
  return line;
}

const hashOf = (text: string): string => `sha256:${sha256Hex(text)}`;

/** 프로젝트 폴더 기준 상대 경로들을 절대 경로와 지문의 목록으로 바꾼다 */
function refsOf(files: Readonly<Record<string, string>>, relPaths: readonly string[]) {
  return relPaths.map((rel) => ({ path: `${APP}/${rel}`, hash: hashOf(files[rel] ?? "") }));
}

// ── 1. 설계 메모 2절의 명령 표: 파이프라인을 끝까지 돌려 매니페스트 선언을 본다 ──────────

describe("환경 모드: 설계 메모 2절의 명령 표가 옮겨진다", () => {
  const SRC = "print(1)\n";
  test.each<[string, string, Record<string, string>, readonly string[]]>([
    ["python3.11 x.py", "python3.11 x.py", { "x.py": SRC }, ["x.py"]],
    [
      "<프로젝트>/.venv/bin/python x.py",
      "$CLAUDE_PROJECT_DIR/.venv/bin/python x.py",
      { "x.py": SRC },
      ["x.py"],
    ],
    ["uv run x.py", "uv run x.py", { "x.py": SRC }, ["x.py"]],
    ["uv run --with requests x.py", "uv run --with requests x.py", { "x.py": SRC }, ["x.py"]],
    ["npx prettier --write $FILE", "npx prettier --write $FILE", {}, []],
    ["bun run x.ts", "bun run x.ts", { "x.ts": "export {};\n" }, ["x.ts"]],
    ["bash -c '…'", "bash -c 'npx prettier --check . && echo ok'", {}, []],
    ["jq … | xargs …", "jq -r .tool_input.file_path | xargs npx prettier --write", {}, []],
    ["FOO=1 python3 x.py", "FOO=1 python3 x.py", { "x.py": SRC }, ["x.py"]],
    ["cd … && ./x.sh", 'cd "$CLAUDE_PROJECT_DIR" && ./x.sh', { "x.sh": "exit 0\n" }, ["x.sh"]],
    ["osascript -e '…'", `osascript -e 'display notification "done" with title "Claude"'`, {}, []],
    [
      "인라인 f=$(jq …) && npx prettier",
      `f=$(jq -r '.tool_input.file_path') && npx prettier --write "$f"`,
      {},
      [],
    ],
    ["알 수 없는 스크립트", "node --test ./no-such.mjs", {}, []],
  ])("%s는 환경 모드 선언이 된다", async (_label, command, files, refs) => {
    const { proposal, scan } = await proposeProject(command, files);
    const item = scan.items.find((entry) => entry.kind === "hook");
    expect(item?.ir.kind === "hook" ? item.ir.env?.command : undefined).toBe(command);
    // 선언 이름: 읽는 첫 파일의 이름(확장자 없이), 없으면 `hook-<이벤트>`
    const name =
      refs[0] === undefined
        ? "hook-pretooluse"
        : (refs[0].split("/").pop() ?? "").replace(/\.[^.]+$/, "");
    const decl = manifestOf(emit(hookPluginOf(proposal.plugins))).scripts?.[0];
    expect(decl?.name).toBe(name);
    expect(decl?.runner).toBe("sh");
    expect(decl?.file).toBe(`scripts/${name}.cmd`);
    expect(decl?.timeoutMs).toBe(29000);
    expect(decl?.args).toBeUndefined();
    expect(decl?.env).toEqual({
      command,
      shell: "sh",
      refs: refsOf(files, refs),
      refsKnown: refs.length > 0,
    });
  });

  test("`$CLAUDE_PROJECT_DIR/.claude/hooks/block-rm-rf.sh`는 환경 모드로 옮기고 스크립트를 복사하지 않는다", async () => {
    const files = { ".claude/hooks/block-rm-rf.sh": "exit 0\n" };
    const { proposal } = await proposeProject(
      "$CLAUDE_PROJECT_DIR/.claude/hooks/block-rm-rf.sh",
      files,
    );
    const tree = emit(hookPluginOf(proposal.plugins));
    const decl = manifestOf(tree).scripts?.[0];
    expect(decl).toEqual({
      name: "block-rm-rf",
      runner: "sh",
      file: "scripts/block-rm-rf.cmd",
      timeoutMs: 29000,
      env: {
        command: "$CLAUDE_PROJECT_DIR/.claude/hooks/block-rm-rf.sh",
        shell: "sh",
        refs: refsOf(files, [".claude/hooks/block-rm-rf.sh"]),
        refsKnown: true,
      },
    });
    expect(tree.has("scripts/block-rm-rf.sh")).toBe(false);
  });

  test("`~/.claude/hooks/x.py`는 사용자 범위에서 환경 모드로 옮기고, 지문은 파일 바이트에서 나온다", async () => {
    const settings = {
      hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "~/.claude/hooks/x.py" }] }] },
    };
    const scan = await scanRoots({
      roots: [USER_ROOT],
      fs: memoryFs({
        [`${HOME}/.claude/settings.json`]: JSON.stringify(settings),
        [`${HOME}/.claude/hooks/x.py`]: "print(2)\n",
      }),
      ctx: contextOf(undefined),
    });
    const item = scan.items.find((entry) => entry.kind === "hook");
    expect(item?.ir.kind === "hook" ? item.ir.env?.refs : undefined).toEqual([
      { path: `${HOME}/.claude/hooks/x.py`, hash: hashOf("print(2)\n") },
    ]);
  });
});

// ── 2. 참조 파일의 지문은 실제 파일의 바이트에서 나온다(임시 폴더) ─────────────────────

describe("describeHookCommand: 실제 파일의 지문", () => {
  test("`~/.claude/hooks/x.py`는 참조로 찾고, 지문은 파일 바이트의 sha256이다", async () => {
    const home = await mkdtemp(join(tmpdir(), "fresnel-hook-env-"));
    try {
      const body = "print('hi')\n";
      await mkdir(join(home, ".claude", "hooks"), { recursive: true });
      await writeFile(join(home, ".claude", "hooks", "x.py"), body);
      const env = await describeHookCommand("~/.claude/hooks/x.py", {
        homeDir: home,
        projectDir: undefined,
        shell: undefined,
        fileInfo: diskFileInfo,
        onPath: undefined,
      });
      expect(env.refs).toEqual([
        { path: join(home, ".claude", "hooks", "x.py"), hash: `sha256:${sha256Hex(body)}` },
      ]);
      expect(env.refsKnown).toBe(true);
      expect(env.command).toBe("~/.claude/hooks/x.py");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

// ── 3. 순수 함수의 가장자리 ───────────────────────────────────────────────────

describe("describeHookCommand: 가장자리", () => {
  const PROJECT = { homeDir: HOME, projectDir: APP, shell: undefined, onPath: undefined };

  test("명령 원문은 한 글자도 바꾸지 않는다(따옴표, $, 역슬래시, 주석)", async () => {
    const command =
      "printf '%s\\n' \"$CLAUDE_PROJECT_DIR\" | npx prettier --stdin-filepath 'a b.ts' # it's $X";
    const env = await describeHookCommand(command, { ...PROJECT, fileInfo: fakeInfo({}) });
    expect(env.command).toBe(command);
    expect(env.shell).toBe("sh");
  });

  test("shell이 bash면 셸도 bash다", async () => {
    const env = await describeHookCommand("npx prettier --check .", {
      ...PROJECT,
      shell: "bash",
      fileInfo: fakeInfo({}),
    });
    expect(env.shell).toBe("bash");
  });

  test("`cd`는 셸 내장이라 건너뛰고, 환경 변수 접두를 건너뛴 첫 실행 단어를 적는다", async () => {
    const env = await describeHookCommand("cd x && FOO=1 BAR='a b' ./x.sh", {
      ...PROJECT,
      fileInfo: fakeInfo({ [`${APP}/x.sh`]: "exit 0\n" }),
    });
    expect(env.firstWord).toBe("./x.sh");
    expect(env.refs.map((ref) => ref.path)).toEqual([`${APP}/x.sh`]);
  });

  test("기준 폴더가 없는 프로젝트 변수 파일은 찾지 못하고, 그 사실을 적는다", async () => {
    const env = await describeHookCommand("uv run $CLAUDE_PROJECT_DIR/x.py", {
      homeDir: HOME,
      projectDir: undefined,
      shell: undefined,
      fileInfo: fakeInfo({}),
      onPath: undefined,
    });
    expect(env.refs).toEqual([]);
    expect(env.refsKnown).toBe(false);
    expect(env.notes.length).toBe(1);
  });

  test("도구 검사는 PATH 조회가 있을 때만 하고, 경로와 변수와 셸 내장은 빼고 없는 이름만 적는다", async () => {
    const env = await describeHookCommand(
      "cd x; uv run y; python3.11 z; $CLAUDE_PROJECT_DIR/bin/tool; ./x.sh",
      { ...PROJECT, onPath: ONLY_UV_ON_PATH, fileInfo: fakeInfo({}) },
    );
    expect(env.missingTools).toEqual(["python3.11"]);
    const unchecked = await describeHookCommand("python3.11 z", {
      ...PROJECT,
      fileInfo: fakeInfo({}),
    });
    expect(unchecked.missingTools).toEqual([]);
  });

  test("버전 근거: 이름, shebang 줄, 옆의 버전 파일 값(첫 줄)", async () => {
    const env = await describeHookCommand("uv run x.py", {
      ...PROJECT,
      fileInfo: fakeInfo({
        [`${APP}/x.py`]: "#!/usr/bin/env python3.11\nprint(1)\n",
        [`${APP}/.python-version`]: "3.11.4\n",
      }),
    });
    expect(env.versionHints).toEqual([
      'shebang "#!/usr/bin/env python3.11"',
      'file ".python-version": "3.11.4"',
    ]);
  });

  test("참조 파일 본문이 읽는 입력 필드 이름을 모아 적는다(목록의 순서)", async () => {
    const env = await describeHookCommand("uv run log.py", {
      ...PROJECT,
      fileInfo: fakeInfo({
        [`${APP}/log.py`]:
          "print(open(0).read()['transcript_path'], os.environ['CLAUDE_PLUGIN_DATA'])\n",
      }),
    });
    expect(env.readsInputs).toEqual(["transcript_path", "CLAUDE_PLUGIN_DATA"]);
  });

  test("`exec`는 셸 내장으로 건너뛰지 않는다. 실행 단어로 보고 PATH에 없으면 없는 도구다", async () => {
    const env = await describeHookCommand("exec ./x.sh", {
      ...PROJECT,
      onPath: ONLY_UV_ON_PATH,
      fileInfo: fakeInfo({ [`${APP}/x.sh`]: "exit 0\n" }),
    });
    expect(env.firstWord).toBe("exec");
    expect(env.missingTools).toEqual(["exec"]);
  });

  test("지문을 내지 못한 파일은 해시가 null인 참조다", async () => {
    const env = await describeHookCommand("uv run big.py", {
      ...PROJECT,
      fileInfo: async (path) =>
        path === `${APP}/big.py`
          ? { size: 2000000, sha256: null, firstLine: undefined, inputNames: [] }
          : undefined,
    });
    expect(env.refs).toEqual([{ path: `${APP}/big.py`, hash: null }]);
    expect(env.refsKnown).toBe(true);
    expect(env.notes.some((note) => note.includes("big.py"))).toBe(true);
  });

  test("참조는 16개까지만 적고 나머지는 그 사실을 적는다", async () => {
    const names = Array.from({ length: 17 }, (_, index) => `x${index}.py`);
    const files = Object.fromEntries(names.map((name) => [`${APP}/${name}`, "print(1)\n"]));
    const env = await describeHookCommand(`uv run ${names.join(" ")}`, {
      ...PROJECT,
      fileInfo: fakeInfo(files),
    });
    expect(env.refs.length).toBe(16);
    expect(env.notes.some((note) => note.includes("16개"))).toBe(true);
  });
});

// ── 4. 파이프라인: 시크릿, 긴 명령, 도구 알림, 결정성, 동반 파일, shell 키 ──────────

describe("환경 모드: 파이프라인 시험", () => {
  test("동반 파일은 명령 원문과 줄바꿈 하나이고, 매니페스트 선언의 명령과 같다", async () => {
    const command = `printf '%s' "$HOME" | npx prettier --stdin-filepath 'a b.ts' && echo $X`;
    const { proposal } = await proposeProject(command, {});
    const tree = emit(hookPluginOf(proposal.plugins));
    expect(decode(tree.get("scripts/hook-pretooluse.cmd"))).toBe(`${command}\n`);
    expect(manifestOf(tree).scripts?.[0]?.env?.command).toBe(command);
  });

  test("같은 입력을 두 번 내보내면 모든 파일의 바이트가 같다", async () => {
    const files = { "x.py": "print(1)\n" };
    const first = emit(hookPluginOf((await proposeProject("uv run x.py", files)).proposal.plugins));
    const second = emit(
      hookPluginOf((await proposeProject("uv run x.py", files)).proposal.plugins),
    );
    expect([...first.keys()]).toEqual([...second.keys()]);
    for (const [path, bytes] of first) expect(decode(second.get(path))).toBe(decode(bytes));
  });

  test("명령이 바뀌면 동반 파일과 매니페스트가 바뀐다", async () => {
    const files = { "x.py": "print(1)\n" };
    const before = emit(
      hookPluginOf((await proposeProject("uv run x.py", files)).proposal.plugins),
    );
    const after = emit(
      hookPluginOf((await proposeProject("uv run --quiet x.py", files)).proposal.plugins),
    );
    expect(decode(before.get("scripts/x.cmd"))).not.toBe(decode(after.get("scripts/x.cmd")));
    expect(decode(before.get(".fresnel-plugin/plugin.json"))).not.toBe(
      decode(after.get(".fresnel-plugin/plugin.json")),
    );
  });

  test("보고 줄은 환경 모드 알림, 없는 도구, 버전 근거를 싣는다", async () => {
    const { proposal } = await proposeProject(
      "python3.11 x.py",
      {
        "x.py": "#!/usr/bin/env python3.11\nprint(1)\n",
      },
      () => undefined,
    );
    const line = hookLine(proposal.report);
    expect(line.status).toBe("differs");
    expect(line.output).toEqual({ plugin: "claude-code-project-hooks", path: "plugin.js" });
    const codes = (line.notes ?? []).map((note) => note.code);
    expect(codes).toContain("env_mode");
    expect(codes).toContain("tool_missing");
    expect(codes).toContain("version_hint");
    expect(line.notes?.find((note) => note.code === "tool_missing")?.text).toContain("python3.11");
    expect(line.notes?.find((note) => note.code === "env_mode")?.text).toContain("python3.11 x.py");
  });

  test("시크릿 형태의 명령은 옮기지 않고(secret_in_command), 값은 어떤 파일에도 보고서에도 없다", async () => {
    const { scan, proposal } = await proposeProject(`npx prettier --key ${FAKE_TOKEN}`, {});
    const line = hookLine(proposal.report);
    expect(line.status).toBe("not_ported");
    expect(line.reason?.code).toBe("literal_secret_in_source");
    expect(proposal.plugins.some((plugin) => plugin.runtime !== undefined)).toBe(false);
    expect(JSON.stringify({ scan: scan.items, report: proposal.report })).not.toContain(FAKE_TOKEN);
  });

  test("명령이 4096자를 넘으면 옮기지 않는다(hook_command_too_long)", async () => {
    const { proposal } = await proposeProject(`npx prettier ${"a".repeat(4100)}`, {});
    const line = hookLine(proposal.report);
    expect(line.status).toBe("not_ported");
    expect(line.reason?.code).toBe("hook_command_too_long");
    expect(JSON.stringify(proposal.report)).not.toContain("aaaaaaaaaa");
  });

  test("`shell: bash`는 환경 모드이고 선언의 runner도 bash다", async () => {
    const settings = {
      hooks: {
        PreToolUse: [
          { hooks: [{ type: "command", command: "npx prettier --check .", shell: "bash" }] },
        ],
      },
    };
    const scan = await scanRoots({
      roots: [PROJECT_ROOT],
      fs: memoryFs(projectFiles(settings, {})),
      ctx: contextOf(undefined),
    });
    const proposal = propose(scan, rulesetsOf(), { answers: {} });
    const decl = manifestOf(emit(hookPluginOf(proposal.plugins))).scripts?.[0];
    expect(decl?.runner).toBe("bash");
    expect(decl?.env?.shell).toBe("bash");
    expect(decl?.env?.command).toBe("npx prettier --check .");
  });

  test("`shell`이 sh나 bash가 아니면 옮기지 않는다(hook_key_unsupported)", async () => {
    const settings = {
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: "npx prettier", shell: "zsh" }] }],
      },
    };
    const scan = await scanRoots({
      roots: [PROJECT_ROOT],
      fs: memoryFs(projectFiles(settings, {})),
      ctx: contextOf(undefined),
    });
    const proposal = propose(scan, rulesetsOf(), { answers: {} });
    expect(hookLine(proposal.report).reason?.code).toBe("hook_key_unsupported");
  });
});

describe("환경 모드: 엔진이 받는 wire 모양", () => {
  test("환경 모드 항목은 JSON 줄로 가고 스키마를 통과해 값이 그대로 돌아온다", async () => {
    const { scan } = await proposeProject("uv run --quiet x.py", { "x.py": "print(1)\n" });
    const item = scan.items.find((entry) => entry.kind === "hook");
    if (item === undefined) throw new Error("no hook item");
    const line = JSON.stringify(
      { kind: "ok", limitReached: false, scan: { scanned: [], items: [item], diagnostics: [] } },
      scanJsonReplacer,
    );
    const parsed = parseJson(line);
    if (!parsed.ok) throw new Error("the encoded line is not JSON");
    const checked = parseScanChildLine(parsed.value);
    if (!checked.ok)
      throw new Error(
        `the line does not match the schema: ${JSON.stringify(checked.error.issues)}`,
      );
    if (checked.value.kind !== "ok") throw new Error("expected an ok line");
    const [wire] = checked.value.scan.items;
    if (wire === undefined) throw new Error("expected one item");
    expect(decodeScanItem(wire).ir).toEqual(item.ir);
  });
});
