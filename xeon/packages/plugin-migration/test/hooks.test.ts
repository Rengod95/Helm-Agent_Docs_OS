// Hook 어댑터의 사례집(migration.md §4.3.5, §10 수용 기준 1, 7): 이벤트별, 핸들러 종류별, 경로 형태별, 이유 코드별.
import { describe, expect, test } from "bun:test";
import { HOOK_NAMES } from "@fresnel/contracts/extensions";
import { memoryFs } from "./support.ts";
import {
  scanRoots,
  type IrHook,
  type ReportLine,
  type ReportStatus,
  type SourceItem,
} from "../src/index.ts";
import {
  FAKE_TOKEN,
  HOME,
  USER_ROOT,
  decode,
  proposeFrom,
  rulesetsOf,
  sortedText,
} from "./hook-support.ts";

const CLAUDE = `${HOME}/.claude`;
const SCRIPT = "echo ok\n";

/** 사용자 설정 하나와 스크립트들로 제안을 만든다. 보고 줄은 설정 자리(keyPath)로 찾는다 */
async function reportOf(settings: unknown, files: Readonly<Record<string, string>> = {}) {
  const entries = {
    [`${CLAUDE}/settings.json`]: JSON.stringify(settings),
    ...Object.fromEntries(Object.entries(files).map(([path, text]) => [`${HOME}/${path}`, text])),
  };
  const { scan, proposal } = await proposeFrom(entries, [USER_ROOT]);
  const lineAt = (key: string): ReportLine => {
    const found = proposal.report.filter((line) => line.source.key === key);
    if (found.length !== 1)
      throw new Error(`expected one report line at ${key}, got ${found.length}`);
    const [line] = found;
    if (line === undefined) throw new Error("unreachable");
    return line;
  };
  return { scan, proposal, lineAt };
}

const cmd = (command: string, extra: Record<string, unknown> = {}) => ({
  type: "command",
  command,
  ...extra,
});

describe("Hook 어댑터: 이벤트별 판정", () => {
  test.each<[string, ReportStatus, string]>([
    ["PreToolUse", "differs", "tool.call.before"],
    ["PostToolUse", "differs", "tool.result"],
    ["UserPromptSubmit", "differs", "input.user.before"],
    ["Stop", "differs", "boundary.settle.before"],
    ["SessionStart", "differs", "thread.start"],
  ])("%s는 옮긴다(%s, 지점 %s)", async (event, status, position) => {
    const { lineAt, proposal } = await reportOf(
      { hooks: { [event]: [{ hooks: [cmd("~/.claude/hooks/x.sh")] }] } },
      { ".claude/hooks/x.sh": SCRIPT },
    );
    const line = lineAt(`settings.hooks.${event}[0].hooks[0]`);
    expect(line.status).toBe(status);
    expect(line.output).toEqual({ plugin: "claude-code-user-hooks", path: "plugin.js" });
    expect(
      proposal.plugins.find((plugin) => plugin.name === "claude-code-user-hooks")?.runtime?.hooks,
    ).toEqual([position]);
  });

  test("옮기지 않는 이벤트는 이유를 적은 보고 줄이다(조용한 누락 없음)", async () => {
    const { lineAt } = await reportOf(
      { hooks: { Notification: [{ hooks: [cmd("~/.claude/hooks/x.sh")] }] } },
      { ".claude/hooks/x.sh": SCRIPT },
    );
    const line = lineAt("settings.hooks.Notification[0].hooks[0]");
    expect(line.status).toBe("not_ported");
    expect(line.reason?.code).toBe("hook_event_unsupported");
    expect(line.alternative).toBeDefined();
  });
});

describe("Hook 어댑터: 핸들러 종류별 판정", () => {
  test.each([
    [
      "http",
      { type: "http", url: "https://example.invalid/hook" },
      "hook_handler_http_unsupported",
    ],
    ["prompt", { type: "prompt", prompt: "check" }, "hook_handler_prompt_unsupported"],
    ["agent", { type: "agent", prompt: "check" }, "hook_handler_agent_unsupported"],
    ["mcp_tool", { type: "mcp_tool", server: "s", tool: "t" }, "hook_handler_mcp_tool_unsupported"],
    ["알 수 없는 종류", { type: "weird" }, "hook_handler_unknown"],
  ])("%s 핸들러는 not_ported(%s)", async (_name, handler, code) => {
    const { lineAt } = await reportOf({ hooks: { PreToolUse: [{ hooks: [handler] }] } });
    const line = lineAt("settings.hooks.PreToolUse[0].hooks[0]");
    expect(line.status).toBe("not_ported");
    expect(line.reason?.code).toBe(code);
  });

  test.each([
    ["if 조건", cmd("~/.claude/hooks/x.sh", { if: "Bash(git *)" }), "hook_if_unsupported"],
    ["async 키", cmd("~/.claude/hooks/x.sh", { async: true }), "hook_key_unsupported"],
    ["시간 제한이 글자", cmd("~/.claude/hooks/x.sh", { timeout: "abc" }), "hook_timeout_invalid"],
    ["시간 제한이 0", cmd("~/.claude/hooks/x.sh", { timeout: 0 }), "hook_timeout_invalid"],
  ])("command 핸들러의 %s는 이유가 붙은 not_ported다", async (_name, handler, code) => {
    const { lineAt } = await reportOf(
      { hooks: { PreToolUse: [{ hooks: [handler] }] } },
      { ".claude/hooks/x.sh": SCRIPT },
    );
    const line = lineAt("settings.hooks.PreToolUse[0].hooks[0]");
    expect(line.status).toBe("not_ported");
    expect(line.reason?.code).toBe(code);
  });
});

describe("Hook 어댑터: 경로와 스크립트별 판정", () => {
  test("스크립트를 복사하고 그 바이트를 그대로 싣는다", async () => {
    const { scan } = await reportOf(
      {
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [cmd("~/.claude/hooks/guard.sh --strict")] }],
        },
      },
      { ".claude/hooks/guard.sh": "exit 0\n" },
    );
    const item = scan.items.find((entry) => entry.ir.kind === "hook");
    if (item?.ir.kind !== "hook") throw new Error("no hook item");
    expect(item.ir.script?.runner).toBe("sh");
    expect(item.ir.script?.args).toEqual(["--strict"]);
    expect(decode(item.ir.script?.bytes)).toBe("exit 0\n");
    expect(item.ir.matcher).toBe("Bash");
  });

  test.each([
    ["셸 파이프", "cat ~/.claude/x.sh | sh", "inline_command"],
    ["홈의 다른 폴더", "~/scripts/x.sh", "script_outside_root"],
    ["알 수 없는 확장자", "~/.claude/hooks/x.txt", "unknown_runner"],
    ["없는 파일", "~/.claude/hooks/missing.sh", "script_missing"],
  ])("%s는 %s", async (_name, command, code) => {
    const { lineAt } = await reportOf(
      { hooks: { PreToolUse: [{ hooks: [cmd(command)] }] } },
      { ".claude/hooks/x.txt": SCRIPT },
    );
    const line = lineAt("settings.hooks.PreToolUse[0].hooks[0]");
    expect(line.status).toBe("not_ported");
    expect(line.reason?.code).toBe(code);
  });

  test("심볼릭 링크로 밖을 가리키는 스크립트는 script_outside_root다", async () => {
    const files = {
      [`${CLAUDE}/settings.json`]: JSON.stringify({
        hooks: { PreToolUse: [{ hooks: [cmd("~/.claude/hooks/link.sh")] }] },
      }),
      [`${CLAUDE}/hooks/link.sh`]: { symlinkTo: `${HOME}/elsewhere/secret.sh` },
      [`${HOME}/elsewhere/secret.sh`]: SCRIPT,
    };
    const scan = await scanRoots({
      roots: [USER_ROOT],
      fs: memoryFs(files),
      ctx: { homeDir: HOME },
    });
    const hook = scan.items.find((item) => item.ir.kind === "hook");
    if (hook?.ir.kind !== "hook") throw new Error("no hook item");
    expect(hook.ir.code).toBe("script_outside_root");
  });

  test("스크립트 본문의 시크릿 값은 복사하지 않고 값을 어디에도 싣지 않는다", async () => {
    const { scan, proposal, lineAt } = await reportOf(
      { hooks: { PreToolUse: [{ hooks: [cmd("~/.claude/hooks/leak.sh")] }] } },
      { ".claude/hooks/leak.sh": `curl -H "Authorization: Bearer ${FAKE_TOKEN}"\n` },
    );
    expect(lineAt("settings.hooks.PreToolUse[0].hooks[0]").reason?.code).toBe("secret_in_script");
    expect(JSON.stringify({ scan: scan.items, report: proposal.report })).not.toContain(FAKE_TOKEN);
  });

  test("명령 문자열의 리터럴 시크릿은 명령을 싣지 않고 값도 싣지 않는다", async () => {
    const { scan, proposal, lineAt } = await reportOf({
      hooks: { PreToolUse: [{ hooks: [cmd(`~/.claude/hooks/x.sh --key ${FAKE_TOKEN}`)] }] },
    });
    expect(lineAt("settings.hooks.PreToolUse[0].hooks[0]").reason?.code).toBe(
      "literal_secret_in_source",
    );
    expect(JSON.stringify({ scan: scan.items, report: proposal.report })).not.toContain(FAKE_TOKEN);
  });
});

describe("Hook 어댑터: 모양이 틀린 설정(조용한 누락 없음)", () => {
  test("이벤트 값이 배열이 아니거나 묶음 키가 모르는 것이면 보고 줄이 생긴다", async () => {
    const { scan, proposal } = await reportOf(
      {
        hooks: {
          PreToolUse: "not-an-array",
          Stop: [{ hooks: [cmd("~/.claude/hooks/x.sh")], note: "extra" }],
        },
      },
      { ".claude/hooks/x.sh": SCRIPT },
    );
    expect(proposal.report.length).toBe(scan.items.length);
    const reasons = sortedText(proposal.report.map((line) => line.reason?.code));
    expect(reasons).toContain("hook_malformed");
    expect(reasons).toContain("hook_group_key_unsupported");
  });

  test("수 보존: 항목마다 보고 줄이 정확히 하나다(수용 기준 1)", async () => {
    const { scan, proposal } = await reportOf(
      {
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [cmd("~/.claude/hooks/a.sh"), cmd("cat x | sh"), { type: "http", url: "x" }],
            },
          ],
          Notification: [{ hooks: [cmd("~/.claude/hooks/a.sh")] }],
          SessionStart: [
            { matcher: "startup", hooks: [cmd("~/.claude/hooks/a.sh", { timeout: 3 })] },
          ],
        },
      },
      { ".claude/hooks/a.sh": SCRIPT },
    );
    const hookItems: readonly SourceItem[] = scan.items.filter((item) => item.kind === "hook");
    expect(hookItems.length).toBe(5);
    expect(proposal.report.filter((line) => line.kind === "hook").length).toBe(hookItems.length);
    expect(proposal.report.length).toBe(scan.items.length);
  });

  test("매처 정규식이 깨지면 matcher_invalid다", async () => {
    const { lineAt } = await reportOf(
      { hooks: { PreToolUse: [{ matcher: "[unclosed", hooks: [cmd("~/.claude/hooks/x.sh")] }] } },
      { ".claude/hooks/x.sh": SCRIPT },
    );
    expect(lineAt("settings.hooks.PreToolUse[0].hooks[0]").reason?.code).toBe("matcher_invalid");
  });
});

describe("Hook 어댑터: 원본 불변", () => {
  test("읽기 포트에는 쓰기 메서드가 없다(구조 검사)", () => {
    expect(sortedText(Object.keys(memoryFs({})))).toEqual([
      "listDir",
      "lstat",
      "readBounded",
      "realpath",
    ]);
  });

  test("옮긴 Hook의 IR은 명령 문자열 필드를 싣지 않는다", async () => {
    const { scan } = await reportOf(
      { hooks: { PreToolUse: [{ hooks: [cmd("~/.claude/hooks/x.sh --token-file ~/t")] }] } },
      { ".claude/hooks/x.sh": SCRIPT },
    );
    const hook = scan.items.find((item) => item.ir.kind === "hook");
    if (hook?.ir.kind !== "hook") throw new Error("no hook item");
    const ir: IrHook = hook.ir;
    expect("command" in ir).toBe(false);
    expect(ir.script?.args).toEqual(["--token-file", "~/t"]);
  });

  test("규칙의 지점 이름은 모두 계약의 Hook 이름이다", () => {
    for (const ruleset of rulesetsOf()) {
      for (const rule of ruleset.rules) {
        if (rule.hook !== undefined) {
          expect(HOOK_NAMES.some((name) => name === rule.hook?.position)).toBe(true);
        }
      }
    }
  });
});
