// 생성된 Hook 플러그인의 값 시험(수용 기준 2, 7, 28, 29, 30). `plugin.js`를 임시 폴더에서 실제로 불러 가짜 `g`로 부른다.
import { describe, expect, test } from "bun:test";
import { parseJson } from "@fresnel/contracts";
import { sha256Hex } from "../src/hash.ts";
import { emit, type PlannedPluginWithMigration } from "../src/index.ts";
import {
  FAKE_TOKEN,
  decode,
  loadHookPlugin,
  sortedText,
  stdinOf,
  manifestOf,
  projectFiles,
  proposeFrom,
  PROJECT_ROOT,
  ran,
  type FakeOutcome,
  type LoadedHookPlugin,
} from "./hook-support.ts";

const HOOK = (file: string) => `$CLAUDE_PROJECT_DIR/.claude/hooks/${file}`;
const HOOK_SCRIPT = "echo ok\n";

function hookPluginOf(plugins: readonly PlannedPluginWithMigration[]): PlannedPluginWithMigration {
  const found = plugins.find((plugin) => plugin.runtime !== undefined);
  if (found === undefined) throw new Error("no hook plugin was proposed");
  return found;
}

/** 훅 하나를 건 PreToolUse 설정 */
function preToolSettings(matcher: string | undefined, commands: readonly string[]) {
  return {
    hooks: {
      PreToolUse: [
        {
          ...(matcher === undefined ? {} : { matcher }),
          hooks: commands.map((command) => ({ type: "command", command })),
        },
      ],
    },
  };
}

async function loadFrom(settings: unknown, scripts: Readonly<Record<string, string>>) {
  const { proposal } = await proposeFrom(projectFiles(settings, scripts), [PROJECT_ROOT]);
  const plugin = hookPluginOf(proposal.plugins);
  const tree = emit(plugin);
  return { proposal, tree, plugin };
}

describe("Hook 플러그인: 매처 판정(수용 기준 28)", () => {
  const settings = {
    hooks: {
      PreToolUse: [
        { matcher: "Edit|Write", hooks: [{ type: "command", command: HOOK("edit.sh") }] },
        { matcher: "Bash", hooks: [{ type: "command", command: HOOK("bash.sh") }] },
        { matcher: "bash", hooks: [{ type: "command", command: HOOK("typo.sh") }] },
        { matcher: "^Notebook", hooks: [{ type: "command", command: HOOK("notebook.sh") }] },
        { matcher: "mcp__memory__.*", hooks: [{ type: "command", command: HOOK("memory.sh") }] },
        { matcher: "*", hooks: [{ type: "command", command: HOOK("star.sh") }] },
        { matcher: "", hooks: [{ type: "command", command: HOOK("empty.sh") }] },
      ],
    },
  };

  test.each([
    ["edit", ["edit", "star", "empty"]],
    ["write", ["edit", "star", "empty"]],
    // 대소문자가 다른 `bash` 매처는 `Bash`에 맞지 않는다(원본과 같다)
    ["bash", ["bash", "star", "empty"]],
    ["NotebookEdit", ["notebook", "star", "empty"]],
    ["mcp__memory__create", ["memory", "star", "empty"]],
    ["read", ["star", "empty"]],
  ])("도구 %s에서 불린 스크립트는 %j", async (tool, expected) => {
    const { tree } = await loadFrom(settings, {
      ".claude/hooks/edit.sh": HOOK_SCRIPT,
      ".claude/hooks/bash.sh": HOOK_SCRIPT,
      ".claude/hooks/typo.sh": HOOK_SCRIPT,
      ".claude/hooks/notebook.sh": HOOK_SCRIPT,
      ".claude/hooks/memory.sh": HOOK_SCRIPT,
      ".claude/hooks/star.sh": HOOK_SCRIPT,
      ".claude/hooks/empty.sh": HOOK_SCRIPT,
    });
    const loaded = await loadHookPlugin(tree, () => ran({ exitCode: 0 }));
    const handler = loaded.handlers.get("tool.call.before");
    if (handler === undefined) throw new Error("tool.call.before is not registered");
    await handler({ toolCallId: "call_1", toolName: tool, input: {} }, { threadId: "thr_1" });
    // 선언 이름은 읽는 첫 파일의 이름이다(`edit.sh` → `edit`)
    const called = loaded.calls.map((call) => call.name);
    expect(sortedText(called)).toEqual(sortedText(expected));
  });
});

/** 도구 하나를 부른 뒤 첫 스크립트가 받은 표준 입력 */
async function stdinFor(toolName: string, input: unknown, timeoutSettings = false) {
  const command = HOOK("guard.sh");
  const settings = timeoutSettings
    ? { hooks: { PreToolUse: [{ hooks: [{ type: "command", command, timeout: 5 }] }] } }
    : preToolSettings(undefined, [command]);
  const { tree } = await loadFrom(settings, { ".claude/hooks/guard.sh": HOOK_SCRIPT });
  const loaded = await loadHookPlugin(tree, () => ran({ exitCode: 0 }));
  const handler = loaded.handlers.get("tool.call.before");
  if (handler === undefined) throw new Error("tool.call.before is not registered");
  await handler({ toolCallId: "call_1", toolName, input }, { threadId: "thr_1" });
  const first = loaded.calls[0];
  if (first === undefined) throw new Error("the script was not run");
  return stdinOf(first.stdin);
}

describe("Hook 플러그인: 입력 모양 변환(수용 기준 28)", () => {
  test("bash는 Bash이고 시간 제한은 초에서 밀리초가 된다", async () => {
    const stdin = await stdinFor("bash", { command: "ls", timeout: 2 });
    expect(stdin).toEqual({
      session_id: "thr_1",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls", timeout: 2000 },
      tool_use_id: "call_1",
    });
  });

  test("read는 Read이고 path는 file_path가 된다. transcript_path는 없다", async () => {
    const stdin = await stdinFor("read", { path: "a.ts", offset: 3, limit: 10 });
    expect(stdin.tool_name).toBe("Read");
    expect(stdin.tool_input).toEqual({ file_path: "a.ts", offset: 3, limit: 10 });
    expect("transcript_path" in stdin).toBe(false);
  });

  test("write와 한 편집은 Write와 Edit이고, 여러 편집은 edits 배열을 그대로 둔다", async () => {
    expect((await stdinFor("write", { path: "b.ts", content: "x" })).tool_input).toEqual({
      file_path: "b.ts",
      content: "x",
    });
    expect(
      (await stdinFor("edit", { path: "c.ts", edits: [{ oldText: "a", newText: "b" }] }))
        .tool_input,
    ).toEqual({
      file_path: "c.ts",
      old_string: "a",
      new_string: "b",
    });
    expect(
      (
        await stdinFor("edit", {
          path: "c.ts",
          edits: [
            { oldText: "a", newText: "b" },
            { oldText: "c", newText: "d" },
          ],
        })
      ).tool_input,
    ).toEqual({
      file_path: "c.ts",
      edits: [
        { old_string: "a", new_string: "b" },
        { old_string: "c", new_string: "d" },
      ],
    });
  });

  test("원본에 있던 시간 제한 5초는 입력에서 5000밀리초가 된다", async () => {
    const stdin = await stdinFor("bash", { command: "pwd" }, true);
    expect(stdin.tool_input).toEqual({ command: "pwd" });
  });
});

describe("Hook 플러그인: 결정 변환 표(수용 기준 29)", () => {
  const SETTINGS = preToolSettings(undefined, [HOOK("guard.sh")]);
  const decisionOf = (outcome: FakeOutcome | "reject") => async () => {
    const { tree } = await loadFrom(SETTINGS, { ".claude/hooks/guard.sh": HOOK_SCRIPT });
    const loaded = await loadHookPlugin(tree, () => {
      if (outcome === "reject") return Promise.reject(new Error("adapter fault"));
      return outcome;
    });
    const handler = loaded.handlers.get("tool.call.before");
    if (handler === undefined) throw new Error("tool.call.before is not registered");
    return handler(
      { toolCallId: "call_1", toolName: "bash", input: { command: "ls" } },
      { threadId: "thr_1" },
    );
  };

  test.each<[string, FakeOutcome, unknown]>([
    [
      "종료 코드 2는 막기이고 사유는 표준 오류다",
      ran({ exitCode: 2, stderr: "no rm -rf" }),
      { block: true, reason: "no rm -rf" },
    ],
    [
      "사유가 500자를 넘으면 자른다",
      ran({ exitCode: 2, stderr: "x".repeat(600) }),
      { block: true, reason: "x".repeat(500) },
    ],
    ["사유가 비면 기본 문장이다", ran({ exitCode: 2 }), { block: true, reason: "훅이 막았다" }],
    [
      "permissionDecision deny는 막기다",
      ran({
        exitCode: 0,
        stdout: JSON.stringify({
          hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "nope" },
        }),
      }),
      { block: true, reason: "nope" },
    ],
    [
      "최상위 decision block도 막기다",
      ran({ exitCode: 0, stdout: JSON.stringify({ decision: "block", reason: "because" }) }),
      { block: true, reason: "because" },
    ],
    [
      "permissionDecision ask는 묻기다",
      ran({
        exitCode: 0,
        stdout: JSON.stringify({
          hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: "check it" },
        }),
      }),
      { ask: true, reason: "check it" },
    ],
    [
      "allow는 통과다(값 없음)",
      ran({
        exitCode: 0,
        stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: "allow" } }),
      }),
      undefined,
    ],
    [
      "defer는 통과다",
      ran({
        exitCode: 0,
        stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: "defer" } }),
      }),
      undefined,
    ],
    [
      "updatedInput은 기본으로 묻기다",
      ran({
        exitCode: 0,
        stdout: JSON.stringify({
          hookSpecificOutput: { permissionDecision: "allow", updatedInput: { command: "ls" } },
        }),
      }),
      { ask: true, reason: "입력을 바꾸려 했으나 지원하지 않는다" },
    ],
    ["종료 코드 1은 통과다", ran({ exitCode: 1, stderr: "oops" }), undefined],
    ["종료 코드 3도 통과다", ran({ exitCode: 3 }), undefined],
    ["시간 초과는 통과다", ran({ exitCode: null, signal: "SIGKILL", timedOut: true }), undefined],
    ["신호로 끝나면 통과다", ran({ exitCode: null, signal: "SIGSEGV" }), undefined],
    ["JSON이 아닌 출력은 통과다", ran({ exitCode: 0, stdout: "ok done" }), undefined],
    // 띄우지 못한 것은 묻는다(AGE-58 (2)). 이전에는 통과였다
    [
      "띄우지 못한 실행은 묻는다",
      { ok: false, error: { kind: "spawn_failed", code: "ENOENT" } },
      { ask: true, reason: "훅을 돌릴 수 없어요: 띄우지 못했어요(ENOENT). 계속할까요?" },
    ],
    [
      "샌드박스를 쓸 수 없는 실행은 묻는다",
      { ok: false, error: { kind: "sandbox_unavailable" } },
      {
        ask: true,
        reason: "훅을 돌릴 수 없어요: 이 기기에서 샌드박스를 쓸 수 없어요. 계속할까요?",
      },
    ],
  ])("%s", async (_name, outcome, expected) => {
    expect(await decisionOf(outcome)()).toEqual(expected);
  });

  test("어댑터 자체의 예외는 던진다(엔진의 닫힌 실패 정책을 탄다)", async () => {
    let thrown: unknown;
    try {
      await decisionOf("reject")();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).toContain("adapter fault");
  });

  test("여러 훅이 같이 걸리면 막기가 묻기보다 이긴다", async () => {
    const settings = preToolSettings(undefined, [HOOK("ask.sh"), HOOK("block.sh")]);
    const { tree } = await loadFrom(settings, {
      ".claude/hooks/ask.sh": HOOK_SCRIPT,
      ".claude/hooks/block.sh": HOOK_SCRIPT,
    });
    const loaded = await loadHookPlugin(tree, (name) =>
      name === "ask"
        ? ran({
            exitCode: 0,
            stdout: JSON.stringify({
              hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: "look" },
            }),
          })
        : ran({ exitCode: 2, stderr: "stop" }),
    );
    const handler = loaded.handlers.get("tool.call.before");
    if (handler === undefined) throw new Error("tool.call.before is not registered");
    expect(
      await handler({ toolCallId: "c", toolName: "bash", input: {} }, { threadId: "t" }),
    ).toEqual({
      block: true,
      reason: "stop",
    });
  });
});

describe("Hook 플러그인: 나머지 지점", () => {
  const SETTINGS = {
    hooks: {
      PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: HOOK("post.sh") }] }],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: HOOK("prompt.sh") }] }],
      Stop: [{ hooks: [{ type: "command", command: HOOK("stop.sh") }] }],
      SessionStart: [
        { matcher: "startup", hooks: [{ type: "command", command: HOOK("start.sh") }] },
      ],
    },
  };
  const SCRIPTS = {
    ".claude/hooks/post.sh": HOOK_SCRIPT,
    ".claude/hooks/prompt.sh": HOOK_SCRIPT,
    ".claude/hooks/stop.sh": HOOK_SCRIPT,
    ".claude/hooks/start.sh": HOOK_SCRIPT,
  };

  test("PostToolUse는 결과 본문 뒤에 훅 출력을 덧붙이고, 매처에 맞는 도구만 부른다", async () => {
    const { tree } = await loadFrom(SETTINGS, SCRIPTS);
    const loaded = await loadHookPlugin(tree, (name) =>
      name === "post" ? ran({ exitCode: 2, stderr: "careful" }) : ran({ exitCode: 0 }),
    );
    const handler = loaded.handlers.get("tool.result");
    if (handler === undefined) throw new Error("tool.result is not registered");
    const patch = await handler(
      { toolCallId: "call_9", toolName: "bash", input: { command: "ls" } },
      { content: [{ type: "text", text: "out" }], isError: false },
      { threadId: "thr_1" },
    );
    expect(patch).toEqual({
      content: [
        { type: "text", text: "out" },
        { type: "text", text: "careful" },
      ],
    });
    const stdin = stdinOf(loaded.calls[0]?.stdin ?? "{}");
    expect(stdin.tool_response).toEqual({ text: "out", isError: false });
    expect(stdin.hook_event_name).toBe("PostToolUse");
    expect(
      await handler(
        { toolCallId: "c", toolName: "read", input: {} },
        { content: [], isError: false },
        { threadId: "t" },
      ),
    ).toBeUndefined();
    expect(loaded.calls.length).toBe(1);
  });

  test("UserPromptSubmit는 막으면 입력을 삼키고(handled), 아니면 그대로 둔다", async () => {
    const { tree } = await loadFrom(SETTINGS, SCRIPTS);
    const loaded = await loadHookPlugin(tree, () => ran({ exitCode: 2, stderr: "no" }));
    const handler = loaded.handlers.get("input.user.before");
    if (handler === undefined) throw new Error("input.user.before is not registered");
    expect(
      await handler(
        { text: "hi", source: "user" },
        { text: "hi", handled: false },
        { threadId: "t" },
      ),
    ).toEqual({
      action: "handled",
    });
    expect(stdinOf(loaded.calls[0]?.stdin ?? "{}").prompt).toBe("hi");
    const passing = await loadHookPlugin(tree, () => ran({ exitCode: 0 }));
    const passHandler = passing.handlers.get("input.user.before");
    if (passHandler === undefined) throw new Error("input.user.before is not registered");
    expect(
      await passHandler(
        { text: "hi", source: "user" },
        { text: "hi", handled: false },
        { threadId: "t" },
      ),
    ).toBeUndefined();
  });

  test("Stop는 막으면 계속하게 하고, 같은 턴의 다음 호출에는 stop_hook_active가 참이다", async () => {
    const { tree } = await loadFrom(SETTINGS, SCRIPTS);
    let answer: FakeOutcome = ran({ exitCode: 2, stderr: "keep going" });
    const loaded = await loadHookPlugin(tree, () => answer);
    const handler = loaded.handlers.get("boundary.settle.before");
    if (handler === undefined) throw new Error("boundary.settle.before is not registered");
    const payload = { turnId: "turn_1" };
    expect(await handler(payload, { continue: false, entries: [] }, { threadId: "t" })).toEqual({
      continue: true,
    });
    expect(await handler(payload, { continue: false, entries: [] }, { threadId: "t" })).toEqual({
      continue: true,
    });
    answer = ran({ exitCode: 0 });
    expect(
      await handler(payload, { continue: false, entries: [] }, { threadId: "t" }),
    ).toBeUndefined();
    expect(
      await handler(payload, { continue: false, entries: [] }, { threadId: "t" }),
    ).toBeUndefined();
    // 막은 두 번은 참/거짓 순서로 active를 넘기고, 통과하면 상태가 지워져 다음 호출은 거짓이다
    expect(loaded.calls.map((call) => stdinOf(call.stdin).stop_hook_active)).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  test("SessionStart는 시작할 때 한 번 돈다. 출력은 버린다(지켜보는 훅)", async () => {
    const { tree } = await loadFrom(SETTINGS, SCRIPTS);
    const loaded = await loadHookPlugin(tree, () => ran({ exitCode: 2, stderr: "ignored" }));
    const handler = loaded.handlers.get("thread.start");
    if (handler === undefined) throw new Error("thread.start is not registered");
    expect(await handler({}, { threadId: "thr_9" })).toBeUndefined();
    const stdin = stdinOf(loaded.calls[0]?.stdin ?? "{}");
    expect(stdin).toEqual({
      session_id: "thr_9",
      hook_event_name: "SessionStart",
      source: "startup",
    });
  });
});

function hookLine(
  proposal: {
    readonly report: readonly {
      readonly label: string;
      readonly differences: readonly { readonly text: string }[];
    }[];
  },
  label: string,
) {
  const line = proposal.report.find((entry) => entry.label === label);
  if (line === undefined) throw new Error(`no report line ${label}`);
  return line;
}

describe("Hook 플러그인: 시간 제한과 입력 차이 보고(수용 기준 30)", () => {
  test("시간 제한이 달라지면 원본 초와 최대 초를 항목마다 적는다", async () => {
    const settings = {
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: HOOK("pre.sh") }] }],
        SessionStart: [{ hooks: [{ type: "command", command: HOOK("start.sh"), timeout: 2 }] }],
      },
    };
    const { proposal, tree } = await loadFrom(settings, {
      ".claude/hooks/pre.sh": HOOK_SCRIPT,
      ".claude/hooks/start.sh": HOOK_SCRIPT,
    });
    const pre = hookLine(proposal, "Hook PreToolUse");
    expect(pre.differences.map((difference) => difference.text)).toContain(
      "시간 제한이 달라진다: 원본 600초, 여기서는 최대 29초",
    );
    const start = hookLine(proposal, "Hook SessionStart");
    expect(start.differences.some((difference) => difference.text.startsWith("시간 제한"))).toBe(
      false,
    );
    const timeouts = (manifestOf(tree).scripts ?? [])
      .map((decl) => decl.timeoutMs ?? 0)
      .toSorted((a, b) => a - b);
    expect(timeouts).toEqual([2000, 29000]);
  });

  test("지점 예산이 5초인 SessionStart의 기본 시간 제한은 4초로 줄어든다", async () => {
    const { proposal, tree } = await loadFrom(
      { hooks: { SessionStart: [{ hooks: [{ type: "command", command: HOOK("start.sh") }] }] } },
      { ".claude/hooks/start.sh": HOOK_SCRIPT },
    );
    expect(hookLine(proposal, "Hook SessionStart").differences.map((d) => d.text)).toContain(
      "시간 제한이 달라진다: 원본 600초, 여기서는 최대 4초",
    );
    expect((manifestOf(tree).scripts ?? [])[0]?.timeoutMs).toBe(4000);
  });

  test("스크립트가 입력에 없는 필드를 읽으면 그 차이를 적고, 모든 옮긴 Hook은 입력 공백을 적는다", async () => {
    const { proposal } = await loadFrom(preToolSettings(undefined, [HOOK("log.sh")]), {
      ".claude/hooks/log.sh": 'jq -r .transcript_path "$1"\necho "$CLAUDE_PLUGIN_DATA"\n',
    });
    const texts = hookLine(proposal, "Hook PreToolUse").differences.map(
      (difference) => difference.text,
    );
    expect(texts.some((text) => text.includes("transcript_path"))).toBe(true);
    expect(texts.some((text) => text.includes("CLAUDE_PLUGIN_DATA"))).toBe(true);
    expect(texts.some((text) => text.includes("cwd와 permission_mode"))).toBe(true);
  });
});

describe("Hook 플러그인: 결정성과 매니페스트(수용 기준 2, 생성 검사)", () => {
  test("같은 입력을 두 번 내보내면 모든 파일의 바이트가 같다", async () => {
    const settings = {
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: HOOK("a.sh") }] }],
        PostToolUse: [{ hooks: [{ type: "command", command: HOOK("b.sh") }] }],
      },
    };
    const files = projectFiles(settings, {
      ".claude/hooks/a.sh": HOOK_SCRIPT,
      ".claude/hooks/b.sh": "echo b\n",
    });
    const first = emit(hookPluginOf((await proposeFrom(files, [PROJECT_ROOT])).proposal.plugins));
    const second = emit(hookPluginOf((await proposeFrom(files, [PROJECT_ROOT])).proposal.plugins));
    expect([...first.keys()]).toEqual([...second.keys()]);
    for (const [path, bytes] of first) {
      expect(decode(second.get(path))).toBe(decode(bytes));
    }
    const paths = [...first.keys()];
    for (const path of [
      ".fresnel-plugin/plugin.json",
      "plugin.js",
      "hooks.data.json",
      "scripts/a.cmd",
      "scripts/b.cmd",
    ]) {
      expect(paths).toContain(path);
    }
  });

  test("매니페스트는 검사를 통과하고 진입과 지점과 결정 상한과 스크립트 선언을 가진다", async () => {
    const { tree } = await loadFrom(preToolSettings("Bash", [HOOK("a.sh")]), {
      ".claude/hooks/a.sh": HOOK_SCRIPT,
    });
    const manifest = manifestOf(tree);
    expect(manifest.entry).toBe("./plugin.js");
    expect(manifest.plugins).toEqual([
      {
        layer: "plugin",
        hooks: ["tool.call.before"],
        hookDecides: [{ hook: "tool.call.before", decides: ["ask", "block"] }],
      },
    ]);
    // 모든 명령은 환경 모드다: 명령 원문을 매니페스트에 싣고, 스크립트는 복사하지 않고 지문만 낸다
    expect(manifest.scripts).toEqual([
      {
        name: "a",
        runner: "sh",
        file: "scripts/a.cmd",
        timeoutMs: 29000,
        env: {
          command: HOOK("a.sh"),
          shell: "sh",
          refs: [
            {
              path: `${PROJECT_ROOT.path}/.claude/hooks/a.sh`,
              hash: `sha256:${sha256Hex(HOOK_SCRIPT)}`,
            },
          ],
          refsKnown: true,
        },
      },
    ]);
    expect(decode(tree.get("scripts/a.cmd"))).toBe(`${HOOK("a.sh")}\n`);
    expect(tree.has("scripts/a.sh")).toBe(false);
    expect(manifest.purpose).toContain("훅");
  });
});

describe("Hook 플러그인: 시크릿 값 부재(수용 기준 7)", () => {
  test("명령의 리터럴 시크릿과 스크립트 본문의 값은 어디에도 남지 않는다", async () => {
    const files = projectFiles(
      {
        hooks: {
          PreToolUse: [
            { hooks: [{ type: "command", command: `${HOOK("a.sh")} --token ${FAKE_TOKEN}` }] },
            { hooks: [{ type: "command", command: HOOK("b.sh") }] },
          ],
        },
      },
      { ".claude/hooks/b.sh": `echo ${FAKE_TOKEN}\n` },
    );
    const { proposal, scan } = await proposeFrom(files, [PROJECT_ROOT]);
    const serialized = JSON.stringify({ proposal, items: scan.items });
    expect(serialized).not.toContain(FAKE_TOKEN);
    // 스크립트 본문의 값은 옮기는 이유가 아니다(환경 모드는 복사하지 않는다). 옮기지 않는 이유는 명령의 리터럴 시크릿뿐이다
    const reasons = sortedText(
      proposal.report
        .filter((line) => line.status === "not_ported")
        .map((line) => line.reason?.code),
    );
    expect(reasons).toEqual(["literal_secret_in_source"]);
    for (const plugin of proposal.plugins) {
      for (const bytes of emit(plugin).values()) expect(decode(bytes)).not.toContain(FAKE_TOKEN);
    }
  });
});

/** 엔진이 표준 입력 상한 초과를 `invalid_params`로 거절한 호출. 엔진 쪽 오류와 같이 `kind`를 가진다 */
function refusal(kind = "invalid_params"): Error {
  return Object.assign(new Error(`engine refused: ${kind}`), { kind });
}

describe("Hook 플러그인: 큰 입력은 막는 지점에서 묻는다(수용 기준 29, 표준 입력 상한)", () => {
  const UNRUNNABLE = "입력이 너무 커서 훅 스크립트를 돌리지 못했다. 사람이 확인한다";
  const SETTINGS = {
    hooks: {
      PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: HOOK("guard.sh") }] }],
      PostToolUse: [{ hooks: [{ type: "command", command: HOOK("post.sh") }] }],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: HOOK("prompt.sh") }] }],
      Stop: [{ hooks: [{ type: "command", command: HOOK("stop.sh") }] }],
    },
  };
  const SCRIPTS = {
    ".claude/hooks/guard.sh": HOOK_SCRIPT,
    ".claude/hooks/post.sh": HOOK_SCRIPT,
    ".claude/hooks/prompt.sh": HOOK_SCRIPT,
    ".claude/hooks/stop.sh": HOOK_SCRIPT,
  };

  test("tool.call.before는 거절된 호출을 묻기로 준다. 입력은 엔진에 한 번 넘어갔다", async () => {
    const { tree } = await loadFrom(SETTINGS, SCRIPTS);
    const loaded = await loadHookPlugin(tree, () => Promise.reject(refusal()));
    const handler = loaded.handlers.get("tool.call.before");
    if (handler === undefined) throw new Error("tool.call.before is not registered");
    expect(
      await handler(
        { toolCallId: "call_big", toolName: "write", input: { path: "a.txt", content: "x" } },
        { threadId: "thr_1" },
      ),
    ).toEqual({ ask: true, reason: UNRUNNABLE });
    expect(loaded.calls.map((call) => call.name)).toEqual(["guard"]);
    expect(stdinOf(loaded.calls[0]?.stdin ?? "{}").tool_name).toBe("Write");
  });

  test("같은 호출의 다른 훅이 막으면 막기가 이긴다", async () => {
    const settings = preToolSettings(undefined, [HOOK("big.sh"), HOOK("stop.sh")]);
    const { tree } = await loadFrom(settings, {
      ".claude/hooks/big.sh": HOOK_SCRIPT,
      ".claude/hooks/stop.sh": HOOK_SCRIPT,
    });
    const loaded = await loadHookPlugin(tree, (name) =>
      name === "big" ? Promise.reject(refusal()) : ran({ exitCode: 2, stderr: "no" }),
    );
    const handler = loaded.handlers.get("tool.call.before");
    if (handler === undefined) throw new Error("tool.call.before is not registered");
    expect(
      await handler(
        { toolCallId: "c", toolName: "bash", input: { command: "ls" } },
        { threadId: "t" },
      ),
    ).toEqual({ block: true, reason: "no" });
  });

  test("나머지 지점은 거절을 통과로 본다(값을 더하지 않는다)", async () => {
    const { tree } = await loadFrom(SETTINGS, SCRIPTS);
    const loaded = await loadHookPlugin(tree, () => Promise.reject(refusal()));
    const result = loaded.handlers.get("tool.result");
    const prompt = loaded.handlers.get("input.user.before");
    const stop = loaded.handlers.get("boundary.settle.before");
    if (result === undefined || prompt === undefined || stop === undefined) {
      throw new Error("a position is not registered");
    }
    const content = [{ type: "text", text: "out" }];
    expect(
      await result(
        { toolCallId: "c", toolName: "bash", input: { command: "ls" } },
        { content, isError: false },
        { threadId: "t" },
      ),
    ).toBeUndefined();
    expect(await prompt({ text: "hi" }, {}, { threadId: "t" })).toBeUndefined();
    expect(await stop({ turnId: "turn_1" }, {}, { threadId: "t" })).toBeUndefined();
    expect(loaded.calls.map((call) => call.name)).toEqual(["post", "prompt", "stop"]);
  });

  test("거절이 아닌 다른 던짐은 그대로 다시 던진다(엔진의 닫힌 실패 정책)", async () => {
    const { tree } = await loadFrom(SETTINGS, SCRIPTS);
    const loaded = await loadHookPlugin(tree, () => Promise.reject(refusal("engine_call_failed")));
    const handler = loaded.handlers.get("tool.call.before");
    if (handler === undefined) throw new Error("tool.call.before is not registered");
    let thrown: unknown;
    try {
      await handler({ toolCallId: "c", toolName: "write", input: {} }, { threadId: "t" });
    } catch (error) {
      thrown = error;
    }
    expect(String(thrown)).toContain("engine refused: engine_call_failed");
  });

  test("hooks.data.json은 템플릿 버전 adapter-hooks@5를 적는다", async () => {
    const { tree } = await loadFrom(SETTINGS, SCRIPTS);
    const data = parseJson(decode(tree.get("hooks.data.json")));
    if (!data.ok) throw new Error("hooks.data.json is not JSON");
    expect(data.value).toMatchObject({ schemaVersion: 1, adapter: "adapter-hooks@5" });
  });
});

/** 불러온 플러그인에서 지점의 핸들러를 꺼낸다. 없으면 던진다(시험의 전제가 깨진 것이다) */
function handlerOf(plugin: LoadedHookPlugin, point: string) {
  const handler = plugin.handlers.get(point);
  if (handler === undefined) throw new Error(`${point} is not registered`);
  return handler;
}

describe("Hook 플러그인: 돌리지 못한 훅은 묻는다(AGE-58 사용자 결정 2026-11-20 (2))", () => {
  const SETTINGS_ALL = {
    hooks: {
      PreToolUse: [{ hooks: [{ type: "command", command: HOOK("pre.sh") }] }],
      PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: HOOK("post.sh") }] }],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: HOOK("prompt.sh") }] }],
      Stop: [{ hooks: [{ type: "command", command: HOOK("stop.sh") }] }],
      SessionStart: [
        { matcher: "startup", hooks: [{ type: "command", command: HOOK("start.sh") }] },
      ],
    },
  };
  const SCRIPTS_ALL = {
    ".claude/hooks/pre.sh": HOOK_SCRIPT,
    ".claude/hooks/post.sh": HOOK_SCRIPT,
    ".claude/hooks/prompt.sh": HOOK_SCRIPT,
    ".claude/hooks/stop.sh": HOOK_SCRIPT,
    ".claude/hooks/start.sh": HOOK_SCRIPT,
  };
  const CALL = { toolCallId: "call_1", toolName: "bash", input: { command: "ls" } };

  /** 모든 훅이 같은 답을 내는 플러그인을 불러온다 */
  async function pluginAnswering(answer: FakeOutcome) {
    const { tree } = await loadFrom(SETTINGS_ALL, SCRIPTS_ALL);
    return loadHookPlugin(tree, () => answer);
  }

  /** 도구 호출 앞 지점의 결정 */
  async function preToolDecision(answer: FakeOutcome): Promise<unknown> {
    const plugin = await pluginAnswering(answer);
    return handlerOf(plugin, "tool.call.before")(CALL, { threadId: "thr_1" });
  }

  test.each<[string, FakeOutcome, string]>([
    [
      "스크립트가 바뀌었다",
      {
        ok: false,
        error: {
          kind: "script_ref_changed",
          path: `${PROJECT_ROOT.path}/.claude/hooks/pre.sh`,
          reason: "changed",
        },
      },
      `훅을 돌릴 수 없어요: 스크립트 ${PROJECT_ROOT.path}/.claude/hooks/pre.sh가 바뀌었어요. 가져오기를 다시 해야 해요. 계속할까요?`,
    ],
    [
      "스크립트가 없어졌다",
      {
        ok: false,
        error: { kind: "script_ref_changed", path: "/opt/x.sh", reason: "missing" },
      },
      "훅을 돌릴 수 없어요: 스크립트 /opt/x.sh가 없어요. 가져오기를 다시 해야 해요. 계속할까요?",
    ],
    [
      "스크립트를 읽을 수 없다",
      {
        ok: false,
        error: { kind: "script_ref_changed", path: "/opt/y.sh", reason: "unreadable" },
      },
      "훅을 돌릴 수 없어요: 스크립트 /opt/y.sh가 읽을 수 없어요. 가져오기를 다시 해야 해요. 계속할까요?",
    ],
    [
      "띄우지 못했다",
      { ok: false, error: { kind: "spawn_failed", code: "EACCES" } },
      "훅을 돌릴 수 없어요: 띄우지 못했어요(EACCES). 계속할까요?",
    ],
    [
      "샌드박스를 쓸 수 없다",
      { ok: false, error: { kind: "sandbox_unavailable" } },
      "훅을 돌릴 수 없어요: 이 기기에서 샌드박스를 쓸 수 없어요. 계속할까요?",
    ],
    [
      "환경 모드를 받을 수 없다",
      { ok: false, error: { kind: "script_env_not_granted" } },
      "훅을 돌릴 수 없어요: 이 훅은 환경 모드를 받을 수 없어요. 계속할까요?",
    ],
    [
      "선언에 없다",
      { ok: false, error: { kind: "script_not_declared" } },
      "훅을 돌릴 수 없어요: script_not_declared. 계속할까요?",
    ],
    [
      "플러그인 밖이다",
      { ok: false, error: { kind: "script_outside_tree" } },
      "훅을 돌릴 수 없어요: script_outside_tree. 계속할까요?",
    ],
    [
      "파일이 없다",
      { ok: false, error: { kind: "script_missing" } },
      "훅을 돌릴 수 없어요: script_missing. 계속할까요?",
    ],
    [
      "승인되지 않았다",
      { ok: false, error: { kind: "script_not_approved" } },
      "훅을 돌릴 수 없어요: script_not_approved. 계속할까요?",
    ],
  ])("%s면 도구 호출 앞에서 그 사유로 묻는다", async (_label, answer, reason) => {
    expect(await preToolDecision(answer)).toEqual({ ask: true, reason });
  });

  test("재생 거절과 승인 카드의 거절은 사람이 정한 결과라 통과다", async () => {
    expect(
      await preToolDecision({ ok: false, error: { kind: "replay_mode_denied" } }),
    ).toBeUndefined();
    expect(await preToolDecision({ ok: false, error: { kind: "script_denied" } })).toBeUndefined();
  });

  test("종료 코드 127은 표준 오류의 첫 줄을 사유로 묻는다", async () => {
    expect(
      await preToolDecision(ran({ exitCode: 127, stderr: "python3.11: command not found\n" })),
    ).toEqual({
      ask: true,
      reason: "훅을 돌릴 수 없어요: python3.11: command not found. 계속할까요?",
    });
  });

  test("종료 코드 127이고 표준 오류가 비면 종료 코드로 말한다", async () => {
    expect(await preToolDecision(ran({ exitCode: 127 }))).toEqual({
      ask: true,
      reason: "훅을 돌릴 수 없어요: 명령을 찾을 수 없어요(127). 계속할까요?",
    });
  });

  test("종료 코드 126이고 표준 오류가 비면 실행할 수 없다고 말한다", async () => {
    expect(await preToolDecision(ran({ exitCode: 126 }))).toEqual({
      ask: true,
      reason: "훅을 돌릴 수 없어요: 실행할 수 없어요(126). 계속할까요?",
    });
  });

  test("표준 오류의 첫 줄은 160글자까지만 쓰고, 사유 전체는 500글자를 넘지 않는다", async () => {
    const long = "x".repeat(300);
    const reason = await preToolDecision(ran({ exitCode: 127, stderr: long }));
    expect(reason).toEqual({
      ask: true,
      reason: `훅을 돌릴 수 없어요: ${"x".repeat(160)}. 계속할까요?`,
    });
  });

  test("다른 종료 코드는 그대로다: 1과 3은 통과, 2는 표준 오류가 사유인 막기, 시간 초과는 통과", async () => {
    expect(await preToolDecision(ran({ exitCode: 1, stderr: "oops" }))).toBeUndefined();
    expect(await preToolDecision(ran({ exitCode: 3 }))).toBeUndefined();
    expect(await preToolDecision(ran({ exitCode: 2, stderr: "no" }))).toEqual({
      block: true,
      reason: "no",
    });
    expect(
      await preToolDecision(ran({ exitCode: null, signal: "SIGKILL", timedOut: true })),
    ).toBeUndefined();
  });

  test("도구 결과 지점은 돌리지 못한 훅의 사유를 결과 본문 뒤에 붙인다", async () => {
    const { tree } = await loadFrom(SETTINGS_ALL, SCRIPTS_ALL);
    const loaded = await loadHookPlugin(tree, (name) =>
      name === "post"
        ? ran({ exitCode: 127, stderr: "jq: command not found" })
        : ran({ exitCode: 0 }),
    );
    const patch = await handlerOf(loaded, "tool.result")(
      { toolCallId: "call_9", toolName: "bash", input: { command: "ls" } },
      { content: [{ type: "text", text: "out" }], isError: false },
      { threadId: "thr_1" },
    );
    expect(patch).toEqual({
      content: [
        { type: "text", text: "out" },
        { type: "text", text: "훅을 돌릴 수 없어요: jq: command not found. 계속할까요?" },
      ],
    });
  });

  test("입력, 멈춤, 시작 지점은 돌리지 못한 훅을 막지 않고 통과시킨다", async () => {
    const plugin = await pluginAnswering({ ok: false, error: { kind: "sandbox_unavailable" } });
    expect(
      await handlerOf(plugin, "input.user.before")(
        { text: "hi" },
        { text: "hi", handled: false },
        { threadId: "t" },
      ),
    ).toBeUndefined();
    expect(
      await handlerOf(plugin, "boundary.settle.before")(
        { turnId: "turn_1" },
        { continue: false, entries: [] },
        { threadId: "t" },
      ),
    ).toBeUndefined();
    expect(await handlerOf(plugin, "thread.start")({}, { threadId: "thr_9" })).toBeUndefined();
    expect(plugin.calls.map((call) => call.name)).toEqual(["prompt", "stop", "start"]);
  });
});
