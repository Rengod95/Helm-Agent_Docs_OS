import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import {
  DialogCommands,
  DialogCommandsKey,
  type CapabilityApi,
} from "@xeon/contracts/capabilities";
import { defineManifest, type ExtensionEntry } from "@xeon/contracts/extensions";
import { SessionPortKey } from "@xeon/contracts/services";
import type { SessionService } from "@xeon/contracts/records";
import { hostOf } from "@xeon/ext-host";
import { assemble } from "../../src/assemble.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { writeUserSettings } from "../fixtures/user-settings.ts";

// HOST.6 병합 연결: 슬래시 명령의 셸 주입(`!{...}`)이 cap-dialog의 `shellPortOver`, core-loop의 `runUserBash`, L1.tools의 `runUserShell`,
// cap-workspace의 셸 서비스를 지나 실제 명령을 실행하고, 그 출력이 명령 치환 결과가 된다. 셸 효과 레코드가 세션에 남는다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const home = useEngineHome();
const workspace = mkdtempSync(join(tmpdir(), "xeon-shell-injection-"));
afterAll(() => {
  home.dispose();
  rmSync(workspace, { recursive: true, force: true });
});

interface Captured {
  commands: CapabilityApi<typeof DialogCommands> | undefined;
  session: SessionService | undefined;
}

function captureModule(into: Captured) {
  const manifest = defineManifest({
    schemaVersion: 1,
    name: "shell-injection-capture",
    version: "0.1.0",
    layer: "plugin",
    kind: "plugin",
    entry: "./index.ts",
    requires: [{ id: DialogCommands.id, range: `^${DialogCommands.version}` }],
    points: [],
    usesDrive: false,
    trust: { level: "builtin" },
  });
  const extension: ExtensionEntry = ({ manifest: loaded, scope }) => {
    scope(loaded.name, {}, (g) => {
      into.commands = g.capability(DialogCommandsKey);
      into.session = hostOf(g).port(SessionPortKey);
    });
  };
  return { manifest, extension };
}

realTest(
  "a slash command with a shell injection runs the command through runUserBash and substitutes its output",
  async () => {
    writeUserSettings(home, { "l0.sandbox.enabled": false });
    mkdirSync(join(workspace, ".xeon", "commands"), { recursive: true });
    writeFileSync(
      join(workspace, ".xeon", "commands", "probe.md"),
      "---\ndescription: probe\n---\noutput: !{echo hello-from-shell}\n",
    );
    const captured: Captured = { commands: undefined, session: undefined };
    const engine = await assemble({
      mode: "in-process",
      dataDir: home.dataDir,
      extraPlugins: [captureModule(captured)],
    });
    try {
      const { commands, session } = captured;
      if (commands === undefined || session === undefined) {
        throw new Error("the capture extension did not start");
      }
      const created = await engine.ports.threads.create({ workspace });
      const locked = await engine.ports.locks.tryAcquire(created.threadId, "cli");
      if (!locked.ok) throw new Error("the thread is locked by someone else");
      const context = { threadId: created.threadId, caller: { kind: "host" as const } };

      // 확인 없이는 실행하지 않고 명령을 보여 준다
      const pending = await commands.run({ text: "/probe" }, { context });
      expect(pending).toMatchObject({ status: "needs_confirmation", name: "probe" });

      const ran = await commands.run(
        { text: "/probe", confirmShell: true },
        { context, requestId: "shell-injection-1" },
      );
      expect(ran.status).toBe("expanded");
      if (ran.status !== "expanded") throw new Error("the command did not expand");
      expect(ran.text).toContain("hello-from-shell");

      // 셸 실행은 효과 레코드로 남는다
      const kinds: string[] = [];
      for await (const read of session.readFrom(0)) {
        if (read.ok && read.value.threadId === created.threadId) kinds.push(read.value.kind);
      }
      expect(kinds).toContain("effect.intent");
      expect(kinds).toContain("effect.result");
    } finally {
      await engine.close();
    }
  },
  30_000,
);
