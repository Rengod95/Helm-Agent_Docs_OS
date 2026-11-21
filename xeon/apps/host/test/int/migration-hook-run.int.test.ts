import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { expect, test } from "bun:test";
import type { JsonObject } from "@fresnel/contracts/conversation";
import type { ScriptUse } from "@fresnel/contracts/extensions";
import type { EventWire } from "@fresnel/contracts/wire";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@fresnel/core-models/testing";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { isolatedPluginHost } from "../fixtures/isolated-plugin-host.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { requireSandboxOrSkip, sandboxGate } from "../fixtures/sandbox-service.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { toolResultTexts } from "../fixtures/tool-results.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// AGE-58 후속(enK6), L4.host-service §4.27, X.loading-trust "스크립트 실행기"와 "환경 모드"(2026-11-20): 가져온 Claude Code 훅은 원래 명령 문자열을
// 원래 환경(사용자의 셸 환경, 프로젝트 폴더에서)으로, 사용자 권한 그대로 돈다. 기본(설정 `l0.sandbox.sandboxImportedHooks` 꺼짐)은 샌드박스가 없다.
// 실제 엔진, 격리 자식으로 끝까지 시험한다.
// 시험 1: 훑기 → 제안 → 적용 → 검토에서 승인 → 프로필에 넣은 대화 → 도구 호출. `jq`·`grep`을 쓰는 셸 훅과 `python3` 훅이 돈다. 큰 입력은 묻기 카드.
// 시험 2: 같은 파이프라인에서 인라인 한 줄 훅, 절대 경로 `python3` 훅, `~/.claude/hooks`의 형제 모듈 import, 홈에 쓰는 훅(쓰인다),
//   프로젝트 안에 쓰는 포매터 대역(바이트를 본다), 1 MiB를 넘어 지문이 없는(null) 참조 데이터 파일을 읽는 훅을 돌린다(묻지 않고 돈다).
//   지문이 있는 참조 파일을 바꾸면 묻기 카드가 뜨고 돌지 않으며, 되돌리면 다시 돈다.
//   없는 실행 파일은 종료 코드 127로 묻기 카드가 된다(표준 오류의 첫 줄을 싣는다).
// 샌드박스를 쓸 수 없으면 건너뛴다(격리 자식은 실제 샌드박스로 뜬다). FRESNEL_REQUIRE_SANDBOX=1 또는 CI이면 종료 코드 2(환경 문제)로 끝난다.

const gate = await realEngineGate();
const sandbox = await sandboxGate(tmpdir());
requireSandboxOrSkip(sandbox, "migration-hook-run.int");
const runnable = gate.blocker === undefined && sandbox.runnable && process.platform === "darwin";
const scanTest = runnable ? test : test.skip;

const TIMEOUT_MS = 120_000;
const PROFILE = "migrated-hooks";
const CHAIN_PROFILE = "migrated-hook-chain";
const KIB = 1024;
/** 훅 입력 상한(`SCRIPT_LIMITS.stdinBytes`, 256 KiB)을 넘는 쓰기 본문 */
const BIG_BYTES = 300 * KIB;
/** 환경 모드 카드의 기대 사용 목록(`SCRIPT_ENV_USES`, 샌드박스 설정 꺼짐 = 사용자 권한 그대로) */
const ENV_USES: readonly ScriptUse[] = ["user_full_access", "user_environment", "network"];
/** 묻기 사유의 머리(`refusalOutcome`의 문구) */
const UNRUNNABLE_HEAD = "훅을 돌릴 수 없어요: ";

/** `jq`로 도구 입력의 명령을 꺼내 `grep`으로 위험한 명령을 막는 훅 스크립트(Claude Code PreToolUse 훅의 표준 모양) */
const GUARD_TEXT = `#!/bin/sh
# 위험한 명령을 막는다: jq로 입력을 읽고 grep으로 찾는다
input=$(cat)
command=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
if printf '%s' "$command" | grep -q 'rm -rf'; then
  echo "rm -rf is blocked by the guard" >&2
  exit 2
fi
exit 0
`;

/** 표준 입력의 JSON을 읽고 `re`로 명령을 보고 `subprocess`로 `git --version`을 부르는 `python3` 훅(AGE-58 마무리, enK7). 위험한 SQL이면 막는다 */
const PY_GUARD_TEXT = `#!/usr/bin/env python3
import json
import re
import subprocess
import sys

event = json.load(sys.stdin)
command = (event.get("tool_input") or {}).get("command", "")
git = subprocess.run(["/usr/bin/git", "--version"], capture_output=True, text=True)
if git.returncode != 0:
    sys.stderr.write("git is not reachable from the python hook\\n")
    sys.exit(1)
if re.search(r"drop\\s+table", command, re.IGNORECASE):
    sys.stderr.write("drop table is blocked by the python guard\\n")
    sys.exit(2)
sys.exit(0)
`;

const HOOK_SETTINGS = {
  hooks: {
    PreToolUse: [
      {
        matcher: "Bash|Write",
        hooks: [{ type: "command", command: "$CLAUDE_PROJECT_DIR/.claude/hooks/guard.sh" }],
      },
      {
        matcher: "Bash",
        hooks: [{ type: "command", command: "$CLAUDE_PROJECT_DIR/.claude/hooks/py_guard.py" }],
      },
    ],
  },
};

/** 시험 2의 인라인 한 줄 훅(`jq`와 `case`). `rm -rf`가 든 명령을 막는다 */
const INLINE_GUARD = `f=$(jq -r '.tool_input.command // empty'); case "$f" in *'rm -rf'*) echo blocked >&2; exit 2;; esac`;
/** 홈에 쓰려는 훅. 쓰지 못하면 1로 끝나 막지 않고 지나간다 */
const HOME_WRITE_HOOK = "echo x >> $HOME/.cache-test.log || exit 1";
/** 이 기기에 없는 실행 파일을 부르는 훅(종료 코드 127) */
const MISSING_TOOL_HOOK = "fresnel-no-such-tool-xyz --check";
/** 훑기의 파일 상한(`maxFileBytes`, 1 MiB)을 넘는 참조 데이터 파일. 훑기는 지문을 내지 못해 `hash: null`로 적는다 */
const BIG_DATA_BYTES = 1024 * KIB + KIB;
/**
 * 큰 데이터 파일을 읽기만 하는 인라인 훅. 명령이 스크립트 파일 하나가 아니라서 옮기지 않는 이유가 되지 않고, 참조는 `hash: null`로 실린다.
 * 지문을 못 냈다고 묻지 않고 돈다(허용 중심, 2026-11-20)
 */
const BIG_DATA_HOOK = "head -c 1 $CLAUDE_PROJECT_DIR/data/big.txt >/dev/null";
/** 시험 2의 `python3` 가드(절대 경로). 표식 파일에 한 줄 적고 `drop table`을 막는다 */
const GUARD_PY_TEXT = `import json
import os
import re
import sys

marker = os.path.join(os.environ["CLAUDE_PROJECT_DIR"], "guard-ran.txt")
with open(marker, "a") as handle:
    handle.write("ran\\n")
event = json.load(sys.stdin)
command = (event.get("tool_input") or {}).get("command", "")
if re.search(r"drop\\s+table", command, re.IGNORECASE):
    sys.stderr.write("drop table is blocked by guard.py\\n")
    sys.exit(2)
sys.exit(0)
`;
/** 참조 파일을 바꾼 뒤의 본문(크기가 달라진다) */
const GUARD_PY_EDITED = `${GUARD_PY_TEXT}# edited by the test\n`;
/** `~/.claude/hooks/x.py`: 옆 모듈 `helper`를 import해 명령을 본다. 형제 import가 되는지가 막기로 드러난다 */
const X_PY_TEXT = `import json
import sys

import helper

event = json.load(sys.stdin)
command = (event.get("tool_input") or {}).get("command", "")
if helper.is_blocked(command):
    sys.stderr.write(helper.MESSAGE + "\\n")
    sys.exit(2)
sys.exit(0)
`;
const HELPER_PY_TEXT = `BLOCKED_WORD = "helper-blocked-word"
MESSAGE = "helper blocked the word"


def is_blocked(command):
    return BLOCKED_WORD in command
`;
/** 포매터 대역: 쓴 파일을 대문자로 고쳐 제자리에 쓴다(프로젝트 폴더 안이라 쓸 수 있다) */
const FORMAT_SH_TEXT = `#!/bin/sh
f=$(jq -r '.tool_input.file_path // empty')
if [ -n "$f" ] && [ -f "$f" ]; then
  tr '[:lower:]' '[:upper:]' < "$f" > "$f.tmp" && mv "$f.tmp" "$f"
fi
exit 0
`;
const NOTES_WRITTEN = "hello fmt\n";
const NOTES_FORMATTED = "HELLO FMT\n";

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** 훅 스크립트. Claude Code는 명령을 셸로 돌리므로(`$CLAUDE_PROJECT_DIR/.claude/hooks/guard.sh`) 실행 권한이 있어야 한다 */
function writeHook(path: string, text: string): void {
  writeText(path, text);
  chmodSync(path, 0o755);
}

/** 바이트의 sha256 지문(매니페스트와 카드의 `sha256:<hex>` 모양) */
function sha256Of(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/** 폴더 아래 모든 파일의 상대 경로(정렬). 훅이 쓴 것이 있는지 보려고 쓴다 */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(relative(dir, path));
    }
  };
  walk(dir);
  return out.toSorted();
}

/** 도구 호출 하나를 내는 차례 */
function callTurn(label: string, tool: string, args: JsonObject, callId: string) {
  return {
    role: "main" as const,
    label,
    response: {
      type: "message" as const,
      content: [t.toolCall(tool, args, callId)],
      stopReason: "toolUse" as const,
    },
  };
}

/** 대화 한 차례를 끝내는 답 */
function answerTurn(label: string, text: string) {
  return {
    role: "main" as const,
    label,
    response: {
      type: "message" as const,
      content: [t.text(text)],
      stopReason: "stop" as const,
    },
  };
}

/** 한 턴 안에서 도구 호출 넷(통과, 막기, 큰 입력)과 마지막 답을 순서대로 내는 모델 테이프 */
function hookTape(bigPath: string) {
  const big: JsonObject = { path: bigPath, content: "z".repeat(BIG_BYTES) };
  return tapeBuildModels(
    tapeProvider(
      tapePlayer(
        tape("migration-hook-run", [
          callTurn("passes", "bash", { command: "echo hook-pass-ok" }, "call_pass"),
          callTurn("is blocked", "bash", { command: "rm -rf ./nothing-here" }, "call_block"),
          callTurn(
            "is blocked by python",
            "bash",
            { command: "echo DROP TABLE users" },
            "call_py_block",
          ),
          callTurn("big input", "write", big, "call_big"),
          answerTurn("answers", "finished."),
        ]),
        { clock: realTapeClock() },
      ),
    ),
  );
}

/**
 * 시험 2의 네 턴: 1) 다섯 호출(인라인 막기, python3 막기, 형제 import 막기, 포매터 쓰기, 그 전에 통과 하나),
 * 2) 참조 파일을 바꾼 뒤의 호출(묻기), 3) 되돌린 뒤의 호출(통과), 4) 없는 도구를 부르는 호출(묻기)
 */
function chainTape(notesPath: string) {
  return tapeBuildModels(
    tapeProvider(
      tapePlayer(
        tape("migration-hook-chain", [
          callTurn("chain pass", "bash", { command: "echo hook-pass-ok" }, "call_chain_pass"),
          callTurn("inline rm", "bash", { command: "rm -rf ./nothing-here" }, "call_chain_rm"),
          callTurn("python drop", "bash", { command: "echo DROP TABLE users" }, "call_chain_drop"),
          callTurn(
            "sibling import",
            "bash",
            { command: "echo helper-blocked-word" },
            "call_chain_helper",
          ),
          callTurn(
            "formatter",
            "write",
            { path: notesPath, content: NOTES_WRITTEN },
            "call_chain_write",
          ),
          answerTurn("chain one done", "chain one done."),
          callTurn("after change", "bash", { command: "echo after-change" }, "call_chain_changed"),
          answerTurn("chain two done", "chain two done."),
          callTurn(
            "after restore",
            "bash",
            { command: "echo after-restore" },
            "call_chain_restored",
          ),
          answerTurn("chain three done", "chain three done."),
          callTurn("missing tool", "read", { path: notesPath }, "call_chain_missing"),
          answerTurn("chain four done", "chain four done."),
        ]),
        { clock: realTapeClock() },
      ),
    ),
  );
}

/** 프로젝트 설정: 인라인 훅, 절대 경로 python 훅, 홈 쓰기 훅, 큰 데이터 파일을 읽는 훅, 없는 도구 훅, 포매터 훅 */
function projectChainSettings(guardPath: string) {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            { type: "command", command: INLINE_GUARD },
            { type: "command", command: `python3 ${guardPath}` },
            { type: "command", command: HOME_WRITE_HOOK },
            { type: "command", command: BIG_DATA_HOOK },
          ],
        },
        {
          matcher: "Read",
          hooks: [{ type: "command", command: MISSING_TOOL_HOOK }],
        },
      ],
      PostToolUse: [
        {
          matcher: "Write",
          hooks: [{ type: "command", command: "sh $CLAUDE_PROJECT_DIR/.claude/hooks/format.sh" }],
        },
      ],
    },
  };
}

/** 사용자 범위 설정(`~/.claude/settings.json`): 홈의 훅 스크립트 하나(형제 모듈을 import한다) */
function userChainSettings(userHome: string) {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: `python3 ${userHome}/.claude/hooks/x.py` }],
        },
      ],
    },
  };
}

function redirectHome(home: string): () => void {
  const previous = process.env["HOME"];
  // macOS의 /usr/bin/python3은 바이트코드 캐시를 홈(~/Library/Caches/com.apple.python)에 쓴다. 이 시험은 훅이 홈에 쓴 파일만 세므로 인터프리터의 캐시 쓰기를 끈다
  const previousNoBytecode = process.env["PYTHONDONTWRITEBYTECODE"];
  process.env["HOME"] = home;
  process.env["PYTHONDONTWRITEBYTECODE"] = "1";
  return () => {
    if (previous === undefined) delete process.env["HOME"];
    else process.env["HOME"] = previous;
    if (previousNoBytecode === undefined) delete process.env["PYTHONDONTWRITEBYTECODE"];
    else process.env["PYTHONDONTWRITEBYTECODE"] = previousNoBytecode;
  };
}

function approvalOf(event: EventWire): boolean {
  return event.kind === "approval.requested";
}

/** 도구 호출 하나의 승인 요청(호출 id가 든 것). `waitFor`가 앞의 것을 돌려주지 않게 호출마다 고른다 */
function approvalForCall(callId: string): (event: EventWire) => boolean {
  return (event) => event.kind === "approval.requested" && JSON.stringify(event).includes(callId);
}

function turnDoneOf(turnId: string): (event: EventWire) => boolean {
  return (event) => event.kind === "turn.completed" && event.turnId === turnId;
}

scanTest(
  "an imported Claude Code hook runs as a real hook: the jq/grep guard script blocks rm -rf and passes echo in the isolated child, and a 300 KiB write raises an ask card instead of passing silently",
  async () => {
    const home = useEngineHome();
    // 도구 권한 모드는 bypass로 둔다: 카드가 뜨면 그것은 모드가 아니라 훅의 묻기다
    writeUserSettings(home, { ...TAPE_SETTINGS, "l1.tools.permissionMode": "bypass" });
    const root = realpathSync(mkdtempSync(join(tmpdir(), "xh-migration-hook-run-")));
    const userHome = join(root, "home");
    const project = join(root, "proj");
    mkdirSync(userHome, { recursive: true });
    writeText(
      join(project, ".claude", "settings.json"),
      `${JSON.stringify(HOOK_SETTINGS, null, 2)}\n`,
    );
    writeHook(join(project, ".claude", "hooks", "guard.sh"), GUARD_TEXT);
    writeHook(join(project, ".claude", "hooks", "py_guard.py"), PY_GUARD_TEXT);
    const bundles = mkdtempSync(join(tmpdir(), "migration-hook-bundles-"));
    const bigPath = join(project, "big.txt");
    const restoreHome = redirectHome(userHome);
    const previousCwd = process.cwd();
    // 대화의 작업 폴더는 훅이 든 프로젝트 폴더다: 환경 모드 훅은 `$CLAUDE_PROJECT_DIR`(= 대화의 프로젝트 폴더)에서 돈다
    process.chdir(project);
    const startHost = () =>
      startInProcessHost({
        devChecks: true,
        defaultPluginsDir: bundles,
        extraPlugins: [],
        buildModels: hookTape(bigPath),
        pluginHost: isolatedPluginHost({ realSandbox: true }),
      });
    let host = await startHost();
    let connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);

      // 1. 훑기 → 제안 → 적용: 훅 하나가 플러그인 드래프트 하나가 된다
      const scanned = await connection.request("migration.scan", {
        roots: [{ path: project, scope: "project", label: "proj" }],
      });
      expect(scanned.items.filter((item) => item.kind === "hook").length).toBe(2);
      const proposal = await connection.request("migration.proposal", { scanId: scanned.scanId });
      expect(proposal.plugins.length).toBe(1);
      const applied = await connection.request("migration.apply", {
        proposalId: proposal.proposalId,
        choices: { answers: {} },
      });
      const draft = applied.drafts[0];
      if (draft === undefined) throw new Error("expected one hook plugin draft");

      // 2. 검토에서 승인한다(보관). 승인은 다음 시작의 로더 목록에 오른다
      const decided = await connection.request("pluginReview.decide", {
        itemId: draft.itemId,
        decision: { kind: "approve", profileIds: [], libraryOnly: true },
      });
      expect(decided.item.state).toBe("approved");
      // 환경 모드 카드: 원래 명령 문자열이 그대로 있고, 참조 파일은 가져올 때의 지문과 함께 적힌다. 프로젝트 범위 훅은 `origin`이 `project`이고 `fromProject`가 참이다
      const guardPath = join(project, ".claude", "hooks", "guard.sh");
      const pyPath = join(project, ".claude", "hooks", "py_guard.py");
      const envScripts = decided.item.card.does.inject?.scripts ?? [];
      expect(envScripts.map((script) => script.name)).toEqual(["guard", "py-guard"]);
      expect(envScripts.map((script) => script.env)).toEqual([
        {
          command: "$CLAUDE_PROJECT_DIR/.claude/hooks/guard.sh",
          shell: "sh",
          interpreter: null,
          refs: [{ path: guardPath, hash: sha256Of(GUARD_TEXT) }],
          refsKnown: true,
          missingTools: [],
          versionHints: [],
          origin: "project",
          originLabel: envScripts[0]?.env?.originLabel ?? null,
          fromProject: true,
        },
        {
          command: "$CLAUDE_PROJECT_DIR/.claude/hooks/py_guard.py",
          shell: "sh",
          interpreter: null,
          refs: [{ path: pyPath, hash: sha256Of(PY_GUARD_TEXT) }],
          refsKnown: true,
          missingTools: [],
          versionHints: [],
          origin: "project",
          originLabel: envScripts[0]?.env?.originLabel ?? null,
          fromProject: true,
        },
      ]);
      expect(envScripts.map((script) => script.uses)).toEqual([ENV_USES, ENV_USES]);
      await connection.close();
      await host.close();

      // 3. 같은 엔진 홈을 다시 열어 프로필에 넣고 그 프로필로 대화를 연다
      host = await startHost();
      connection = createHostConnection(host.client);
      await connection.request("host.hello", HELLO_PARAMS);
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });
      await connection.request("profile.put", {
        profile: {
          id: PROFILE,
          title: "Migrated hooks",
          plugins: [{ name: draft.name }],
          settings: [],
          startDrive: null,
        },
        baseRev: null,
      });
      const created = await connection.request("thread.create", {
        workspace: project,
        profileId: PROFILE,
      });

      // 4. 턴을 시작한다. 첫 호출(통과)과 둘째 호출(막기)은 카드 없이 끝나고, 셋째(python 막기)도 막히고, 넷째(큰 입력)는 묻기 카드가 뜬다
      const started = await startTurnWhenIdle(connection, {
        threadId: created.threadId,
        input: "run the three calls",
      });
      const asked = await collector.waitFor(approvalOf, 90_000);
      // 카드가 뜬 시점에 앞의 세 호출은 이미 끝나 있다
      const before = toolResultTexts(collector.events, 4000);
      expect(before.length).toBe(3);
      const [passed, blocked, pyBlocked] = before;
      expect(passed).toContain("hook-pass-ok");
      expect(passed).not.toContain('isError":true');
      expect(blocked).toContain("rm -rf is blocked by the guard");
      expect(blocked).toContain('isError":true');
      // `python3` 훅: 같은 호출의 통과(위 `passed`)에도 돌았고(JSON을 읽고 `git --version`까지 불러 종료 0), 위험한 SQL은 막는다
      expect(pyBlocked).toContain("drop table is blocked by the python guard");
      expect(pyBlocked).toContain('isError":true');

      // 카드는 훅이 낸 묻기다: 큰 입력이라 스크립트를 돌리지 못했다는 이유가 담긴다. 쓰기는 아직 일어나지 않았다
      const pending = await connection.request("approval.list", { threadId: created.threadId });
      expect(pending.approvals).toHaveLength(1);
      expect(pending.approvals[0]?.approvalId).toBe(asked.id);
      expect(pending.approvals[0]?.request.body.kind).toBe("tool");
      expect(JSON.stringify(pending.approvals[0]?.request)).toContain("write");
      // 카드에 훅이 묻는 이유가 실린다(생성 코드의 문구)
      expect(JSON.stringify(pending.approvals[0]?.request)).toContain(
        "입력이 너무 커서 훅 스크립트를 돌리지 못했다",
      );
      expect(existsSync(bigPath)).toBe(false);
      expect(collector.events.some((event) => event.kind === "turn.completed")).toBe(false);

      // 5. 거절하면 쓰기는 일어나지 않고 턴이 끝난다
      const answered = await connection.request("approval.respond", {
        approvalId: asked.id,
        decision: "deny",
        answer: { feedback: "too big" },
      });
      expect(answered).toEqual({ applied: true });
      await collector.waitFor(turnDoneOf(started.turnId), 60_000);
      expect(existsSync(bigPath)).toBe(false);
      const results = toolResultTexts(collector.events, 4000);
      expect(results.length).toBe(4);
      expect(results[3]).toContain('isError":true');
      expect(results[3]).toContain("too big");
      expect(statSyncOrZero(bigPath)).toBe(0);
    } finally {
      await connection.close();
      await host.close();
      process.chdir(previousCwd);
      restoreHome();
      rmSync(bundles, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
      home.dispose();
    }
  },
  TIMEOUT_MS,
);

scanTest(
  "the Claude Code hook chain runs in environment mode: an inline one-liner, a python3 script by absolute path, a ~/.claude/hooks script that imports a sibling module, a write to the home folder that succeeds, a formatter stand-in that rewrites a project file, and a hook that reads a referenced file over the scan's size limit (no fingerprint) and runs without asking; a changed referenced script asks and does not run, restoring it runs again, and a missing tool asks with its first stderr line",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, { ...TAPE_SETTINGS, "l1.tools.permissionMode": "bypass" });
    const root = realpathSync(mkdtempSync(join(tmpdir(), "xh-migration-env-chain-")));
    const userHome = join(root, "home");
    const project = join(root, "proj");
    // 참조 파일은 훑기가 읽는 루트(프로젝트) 안에 둔다. 밖의 파일은 훑기가 찾지 못해 지문이 없다(보고 참조)
    const guardPath = join(project, "tools", "guard.py");
    const notesPath = join(project, "notes.txt");
    const markerPath = join(project, "guard-ran.txt");
    const cacheLogPath = join(userHome, ".cache-test.log");
    const bigPath = join(project, "data", "big.txt");
    writeText(
      join(project, ".claude", "settings.json"),
      `${JSON.stringify(projectChainSettings(guardPath), null, 2)}\n`,
    );
    writeText(join(project, ".claude", "hooks", "format.sh"), FORMAT_SH_TEXT);
    writeText(bigPath, "x".repeat(BIG_DATA_BYTES));
    writeText(guardPath, GUARD_PY_TEXT);
    writeText(
      join(userHome, ".claude", "settings.json"),
      `${JSON.stringify(userChainSettings(userHome), null, 2)}\n`,
    );
    writeText(join(userHome, ".claude", "hooks", "x.py"), X_PY_TEXT);
    writeText(join(userHome, ".claude", "hooks", "helper.py"), HELPER_PY_TEXT);
    const bundles = mkdtempSync(join(tmpdir(), "migration-hook-bundles-"));
    const restoreHome = redirectHome(userHome);
    const previousCwd = process.cwd();
    process.chdir(project);
    const startHost = () =>
      startInProcessHost({
        devChecks: true,
        defaultPluginsDir: bundles,
        extraPlugins: [],
        buildModels: chainTape(notesPath),
        pluginHost: isolatedPluginHost({ realSandbox: true }),
      });
    let host = await startHost();
    let connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);

      // 1. 훑기(프로젝트와 사용자 범위) → 제안 → 적용 → 승인. 프로젝트 훅과 사용자 훅은 플러그인 둘이 된다
      const scanned = await connection.request("migration.scan", {
        roots: [
          { path: project, scope: "project", label: "proj" },
          { path: userHome, scope: "user", label: "home" },
        ],
      });
      expect(scanned.items.filter((item) => item.kind === "hook").length).toBe(7);
      const proposal = await connection.request("migration.proposal", { scanId: scanned.scanId });
      const applied = await connection.request("migration.apply", {
        proposalId: proposal.proposalId,
        choices: { answers: {} },
      });
      expect(applied.drafts.length).toBe(2);
      for (const draft of applied.drafts) {
        // 초안마다 차례로 승인한다(승인은 같은 검토 저장소를 쓴다)
        // eslint-disable-next-line no-await-in-loop -- 초안마다 차례로 승인한다
        const result = await connection.request("pluginReview.decide", {
          itemId: draft.itemId,
          decision: { kind: "approve", profileIds: [], libraryOnly: true },
        });
        expect(result.item.state).toBe("approved");
      }
      // 두 초안은 사용자 폴더의 플러그인이다(이름에 범위가 든다). 프로젝트 범위 훅과 사용자 범위 훅이 따로 간다
      const projectPlugin = "claude-code-project-hooks";
      const userPlugin = "claude-code-user-hooks";
      expect(applied.drafts.map((draft) => draft.name).toSorted()).toEqual([
        projectPlugin,
        userPlugin,
      ]);
      await connection.close();
      await host.close();

      // 2. 같은 엔진 홈을 다시 열어 두 플러그인을 프로필에 넣고 프로젝트 폴더를 작업 폴더로 한 대화를 연다
      host = await startHost();
      connection = createHostConnection(host.client);
      await connection.request("host.hello", HELLO_PARAMS);
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });
      await connection.request("profile.put", {
        profile: {
          id: CHAIN_PROFILE,
          title: "Migrated hook chain",
          plugins: [{ name: projectPlugin }, { name: userPlugin }],
          settings: [],
          startDrive: null,
        },
        baseRev: null,
      });
      const created = await connection.request("thread.create", {
        workspace: project,
        profileId: CHAIN_PROFILE,
      });
      const homeBefore = filesUnder(userHome);

      // 3. 첫 턴: 인라인 막기, python 막기, 형제 import 막기, 홈 쓰기(성공), 포매터의 쓰기, 큰 데이터 파일을 읽는 훅(지문 없음). 승인 카드는 없다
      const first = await startTurnWhenIdle(connection, {
        threadId: created.threadId,
        input: "run the chain",
      });
      await collector.waitFor(turnDoneOf(first.turnId), 90_000);
      expect(collector.events.some(approvalOf)).toBe(false);
      const roundOne = toolResultTexts(collector.events, 4000);
      expect(roundOne.length).toBe(5);
      const [pass, inlineBlocked, pythonBlocked, siblingBlocked, formatted] = roundOne;
      expect(pass).toContain("hook-pass-ok");
      expect(pass).not.toContain('isError":true');
      expect(inlineBlocked).toContain("blocked");
      expect(inlineBlocked).toContain('isError":true');
      expect(pythonBlocked).toContain("drop table is blocked by guard.py");
      expect(pythonBlocked).toContain('isError":true');
      // 형제 import가 되어야 막힌다(import가 깨지면 종료 코드 1이라 막지 않고 지나간다)
      expect(siblingBlocked).toContain("helper blocked the word");
      expect(siblingBlocked).toContain('isError":true');
      expect(formatted).not.toContain('isError":true');
      // 포매터 대역은 프로젝트 안의 파일을 제자리에서 고쳤다(바이트를 본다)
      expect(readFileSync(notesPath, "utf8")).toBe(NOTES_FORMATTED);
      // 가드는 네 번의 Bash 호출에서 돌았다(표식 한 줄씩). 홈 쓰기 훅도 네 번 돌아 한 줄씩 썼다(기본 길은 샌드박스가 없어 홈에 쓸 수 있다)
      expect(readFileSync(markerPath, "utf8")).toBe("ran\nran\nran\nran\n");
      expect(readFileSync(cacheLogPath, "utf8")).toBe("x\nx\nx\nx\n");
      expect(filesUnder(userHome)).toEqual([...homeBefore, ".cache-test.log"].toSorted());

      // 4. 참조 파일을 바꾼다. 다음 호출은 묻기 카드가 뜨고, 바뀐 스크립트는 돌지 않는다(표식을 지우고 확인한다)
      rmSync(markerPath);
      writeFileSync(guardPath, GUARD_PY_EDITED);
      const changed = await startTurnWhenIdle(connection, {
        threadId: created.threadId,
        input: "run after the change",
      });
      const askedChanged = await collector.waitFor(approvalForCall("call_chain_changed"), 90_000);
      expect(JSON.stringify(askedChanged)).toContain(
        `${UNRUNNABLE_HEAD}스크립트 ${guardPath}가 바뀌었어요. 가져오기를 다시 해야 해요. 계속할까요?`,
      );
      expect(existsSync(markerPath)).toBe(false);
      const denied = await connection.request("approval.respond", {
        approvalId: askedChanged.id,
        decision: "deny",
        answer: { feedback: "the script changed" },
      });
      expect(denied).toEqual({ applied: true });
      await collector.waitFor(turnDoneOf(changed.turnId), 60_000);
      expect(existsSync(markerPath)).toBe(false);
      const roundTwo = toolResultTexts(collector.events, 4000).slice(roundOne.length);
      expect(roundTwo.length).toBe(1);
      expect(roundTwo[0]).toContain('isError":true');
      expect(roundTwo[0]).not.toContain("after-change");

      // 5. 되돌린다. 같은 바이트라 다시 확인이 통과하고, 가드가 다시 돈다
      writeFileSync(guardPath, GUARD_PY_TEXT);
      const restored = await startTurnWhenIdle(connection, {
        threadId: created.threadId,
        input: "run after the restore",
      });
      await collector.waitFor(turnDoneOf(restored.turnId), 90_000);
      const roundThree = toolResultTexts(collector.events, 4000).slice(roundOne.length + 1);
      expect(roundThree.length).toBe(1);
      expect(roundThree[0]).toContain("after-restore");
      expect(roundThree[0]).not.toContain('isError":true');
      expect(readFileSync(markerPath, "utf8")).toBe("ran\n");

      // 6. 없는 실행 파일을 부르는 훅은 종료 코드 127이다. 막지 않고 조용히 지나가지 않고, 표준 오류의 첫 줄을 실은 묻기 카드가 된다
      const missing = await startTurnWhenIdle(connection, {
        threadId: created.threadId,
        input: "run the missing tool",
      });
      const askedMissing = await collector.waitFor(approvalForCall("call_chain_missing"), 90_000);
      // 사유는 표준 오류의 첫 줄이다(셸이 낸 "찾을 수 없다" 글). 종료 코드 127로 돌리지 못한 것이다
      expect(JSON.stringify(askedMissing)).toContain(
        `${UNRUNNABLE_HEAD}/bin/sh: fresnel-no-such-tool-xyz: command not found. 계속할까요?`,
      );
      await connection.request("approval.respond", {
        approvalId: askedMissing.id,
        decision: "deny",
        answer: { feedback: "no tool" },
      });
      await collector.waitFor(turnDoneOf(missing.turnId), 60_000);

      // 7. 승인된 항목의 카드: 원래 명령과 참조 파일, 프로젝트 출처 표시, 사용 목록. 순서는 이벤트 이름순(PostToolUse가 먼저)이다
      const projectItem = await connection.request("pluginReview.get", {
        itemId: applied.drafts.find((draft) => draft.name === projectPlugin)?.itemId ?? "",
      });
      const projectScripts = projectItem.item.card.does.inject?.scripts ?? [];
      expect(projectScripts.map((script) => script.name)).toEqual([
        "format",
        "hook-pretooluse",
        "guard",
        "hook-pretooluse-2",
        "big",
        "hook-pretooluse-3",
      ]);
      expect(projectScripts.map((script) => script.uses)).toEqual([
        ENV_USES,
        ENV_USES,
        ENV_USES,
        ENV_USES,
        ENV_USES,
        ENV_USES,
      ]);
      expect(projectScripts.map((script) => script.env?.command)).toEqual([
        "sh $CLAUDE_PROJECT_DIR/.claude/hooks/format.sh",
        INLINE_GUARD,
        `python3 ${guardPath}`,
        HOME_WRITE_HOOK,
        BIG_DATA_HOOK,
        MISSING_TOOL_HOOK,
      ]);
      // 참조 파일이 있는 훅은 지문을 싣는다. 가져올 때의 지문은 바뀐 뒤의 것이 아니다(원본 바이트).
      // 지문을 못 낸 큰 파일은 `hash: null`이다. 그래도 묻지 않고 돈다(위 첫 턴에 카드가 없었다)
      expect(projectScripts.map((script) => script.env?.refs)).toEqual([
        [
          {
            path: join(project, ".claude", "hooks", "format.sh"),
            hash: sha256Of(FORMAT_SH_TEXT),
          },
        ],
        [],
        [{ path: guardPath, hash: sha256Of(GUARD_PY_TEXT) }],
        [],
        [{ path: bigPath, hash: null }],
        [],
      ]);
      expect(projectScripts.map((script) => script.env?.refsKnown)).toEqual([
        true,
        false,
        true,
        false,
        true,
        false,
      ]);
      // 프로젝트 범위 훅: 가져오기가 읽은 설정 파일의 자리에서 엔진이 정한 출처가 검토 항목까지 실려 온다(이식 드래프트는 사용자 폴더에 놓여도)
      expect(projectScripts.map((script) => script.env?.origin)).toEqual([
        "project",
        "project",
        "project",
        "project",
        "project",
        "project",
      ]);
      // 라벨은 프로젝트 폴더의 표시다(설정 파일 자리에서 `/.claude/settings.json`을 뺀 것. 홈 밑이면 `~`). 임시 폴더가 실제 경로로 풀릴 수 있어 끝만 본다
      expect(
        projectScripts.map((script) => script.env?.originLabel?.endsWith("/proj") === true),
      ).toEqual([true, true, true, true, true, true]);
      expect(projectScripts.map((script) => script.env?.fromProject)).toEqual([
        true,
        true,
        true,
        true,
        true,
        true,
      ]);
      // 이 기기에 없는 실행 파일은 카드가 이름으로 적는다. 명령이 변수로 시작하면 실행 파일 위치는 찾지 않는다
      expect(projectScripts[5]?.env?.missingTools).toEqual(["fresnel-no-such-tool-xyz"]);
      expect(projectScripts[5]?.env?.interpreter).toBeNull();
      expect(projectScripts[1]?.env?.missingTools).toEqual([]);
      // 데이터 파일을 읽는 인라인 명령의 첫 단어(`head`)는 이 기기에 있다
      expect(projectScripts[4]?.env?.missingTools).toEqual([]);
      // `sh`는 이 기기의 `/bin/sh`로 찾는다. 명령이 `$CLAUDE_PROJECT_DIR`로 시작하면 찾지 않는다(null)
      expect(projectScripts[0]?.env?.interpreter).toBe("/bin/sh");
      expect(projectScripts[1]?.env?.interpreter).toBeNull();

      // 사용자 범위 훅은 프로젝트 출처가 아니다
      const userItem = await connection.request("pluginReview.get", {
        itemId: applied.drafts.find((draft) => draft.name === userPlugin)?.itemId ?? "",
      });
      const userScripts = userItem.item.card.does.inject?.scripts ?? [];
      expect(userScripts.map((script) => script.env?.fromProject)).toEqual([false]);
      expect(userScripts.map((script) => script.env?.origin)).toEqual(["user"]);
      expect(userScripts.map((script) => script.env?.originLabel)).toEqual([null]);
      expect(userScripts.map((script) => script.env?.command)).toEqual([
        `python3 ${userHome}/.claude/hooks/x.py`,
      ]);
    } finally {
      await connection.close();
      await host.close();
      process.chdir(previousCwd);
      restoreHome();
      rmSync(bundles, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
      home.dispose();
    }
  },
  TIMEOUT_MS,
);

function statSyncOrZero(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}
