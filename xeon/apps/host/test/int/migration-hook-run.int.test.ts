import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "bun:test";
import type { JsonObject } from "@fresnel/contracts/conversation";
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

// AGE-58 후속(enK6), L4.host-service §4.27, X.loading-trust "스크립트 실행기": 가져오기로 만든 훅 플러그인을 끝까지 시험한다(실제 엔진, 실제 샌드박스, 격리 자식).
// 훑기 → 제안 → 적용 → 검토에서 승인 → 프로필에 넣은 대화 → 도구 호출 → `jq`·`grep`을 쓰는 훅 스크립트가 격리 자식에서 실행 → 막기·통과.
// 이어서 같은 대화에서 256 KiB가 넘는 입력의 `write` 호출이 훅 입력 상한을 넘어 "묻기" 카드로 떨어지는지 본다(막지도, 조용히 통과시키지도 않는다).
// 샌드박스를 쓸 수 없으면 건너뛴다. FRESNEL_REQUIRE_SANDBOX=1 또는 CI이면 종료 코드 2(환경 문제)로 끝난다.

const gate = await realEngineGate();
const sandbox = await sandboxGate(tmpdir());
requireSandboxOrSkip(sandbox, "migration-hook-run.int");
const runnable = gate.blocker === undefined && sandbox.runnable && process.platform === "darwin";
const scanTest = runnable ? test : test.skip;

const TIMEOUT_MS = 120_000;
const PROFILE = "migrated-hooks";
const KIB = 1024;
/** 훅 입력 상한(`SCRIPT_LIMITS.stdinBytes`, 256 KiB)을 넘는 쓰기 본문 */
const BIG_BYTES = 300 * KIB;

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

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
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
          {
            role: "main" as const,
            label: "answers",
            response: {
              type: "message" as const,
              content: [t.text("finished.")],
              stopReason: "stop" as const,
            },
          },
        ]),
        { clock: realTapeClock() },
      ),
    ),
  );
}

function redirectHome(home: string): () => void {
  const previous = process.env["HOME"];
  process.env["HOME"] = home;
  return () => {
    if (previous === undefined) delete process.env["HOME"];
    else process.env["HOME"] = previous;
  };
}

function approvalOf(event: EventWire): boolean {
  return event.kind === "approval.requested";
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
    const workspace = join(root, "work");
    for (const dir of [userHome, workspace]) mkdirSync(dir, { recursive: true });
    writeText(
      join(project, ".claude", "settings.json"),
      `${JSON.stringify(HOOK_SETTINGS, null, 2)}\n`,
    );
    writeText(join(project, ".claude", "hooks", "guard.sh"), GUARD_TEXT);
    writeText(join(project, ".claude", "hooks", "py_guard.py"), PY_GUARD_TEXT);
    const bundles = mkdtempSync(join(tmpdir(), "migration-hook-bundles-"));
    const bigPath = join(workspace, "big.txt");
    const restoreHome = redirectHome(userHome);
    const previousCwd = process.cwd();
    process.chdir(workspace);
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
        workspace,
        profileId: PROFILE,
      });

      // 4. 턴을 시작한다. 첫 호출(통과)과 둘째 호출(막기)은 카드 없이 끝나고, 셋째(큰 입력)는 묻기 카드가 뜬다
      const started = await startTurnWhenIdle(connection, {
        threadId: created.threadId,
        input: "run the three calls",
      });
      const asked = await collector.waitFor(approvalOf, 90_000);
      // 카드가 뜬 시점에 앞의 두 호출은 이미 끝나 있다
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
      await collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
        60_000,
      );
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

function statSyncOrZero(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}
