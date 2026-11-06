import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { EventWire } from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { createStdioTransport } from "../../src/transport/stdio.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { APPROVAL_COMMAND } from "../fixtures/approval-tape.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { answeringModels } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// HOST.4 A1 (m2-plan, open-issues M-02): 승인 요청 → SIGKILL → 재개 → 응답을 한 엔진(저장소) 위에서 이어 본다.
// 첫 호스트는 실제 자식 프로세스(stdio)이고 SIGKILL로 죽인다. 둘째 호스트는 같은 저장소를 여는 새 엔진이다.
// 재개 뒤에는 응답이 없으면 turn이 이어지지 않고, 응답을 받으면 같은 도구 호출이 실행되어 turn이 끝난다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const CRASH_HOST: string = join(import.meta.dir, "..", "fixtures", "crash-host.ts");

function kindsOf(events: readonly EventWire[]): string[] {
  return events.map((event) => event.kind);
}

realTest(
  "a pending approval survives SIGKILL: the new host lists it, restores it on open, and the answer continues the turn",
  async () => {
    const home = useEngineHome();
    // 이 기기에 샌드박스 도구가 없을 수 있다. 승인 흐름을 보는 시험이라 샌드박스는 끈다
    writeUserSettings(home, { ...TAPE_SETTINGS, "l0.sandbox.enabled": false });
    const workspace = mkdtempSync(join(tmpdir(), "xh-a1-"));
    const previousCwd = process.cwd();
    const child = Bun.spawn([process.execPath, CRASH_HOST], {
      cwd: workspace,
      env: { ...process.env, FRESNEL_HOME: home.root },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    let errorText = "";
    const decoder = new TextDecoder();
    const reading = (async () => {
      for await (const chunk of child.stderr) errorText += decoder.decode(chunk, { stream: true });
    })();
    try {
      // ── 1. 첫 호스트: 승인이 올라올 때까지 ─────────────────────────────
      const first = createHostConnection(
        createStdioTransport({
          readable: child.stdout,
          writable: new WritableStream<Uint8Array>({
            async write(chunk) {
              await child.stdin.write(chunk);
              await child.stdin.flush();
            },
          }),
        }),
      );
      await first.request("host.hello", HELLO_PARAMS);
      const seen = collectEvents(first);
      await first.request("events.subscribe", { from: "head" });
      const created = await first.request("thread.create", { workspace });
      await first.request("turn.start", { threadId: created.threadId, input: "run it" });
      const asked = await seen.waitFor((event) => event.kind === "approval.requested");
      const lastSeq = Math.max(...seen.events.map((event) => event.seq));

      // ── 2. SIGKILL ─────────────────────────────────────────────────────
      child.kill("SIGKILL");
      expect(await child.exited, errorText).not.toBe(0);
      await reading;

      // ── 3. 새 호스트: 같은 저장소 ──────────────────────────────────────
      process.chdir(workspace);
      const host = await startInProcessHost({
        devChecks: true,
        defaultGroups: false,
        buildModels: answeringModels("resume", "finished."),
      });
      const connection = createHostConnection(host.client);
      await connection.request("host.hello", HELLO_PARAMS);
      const collected = collectEvents(connection);
      const subscribed = await connection.request("events.subscribe", {
        from: "head",
        filter: { threadIds: [created.threadId] },
      });
      expect(subscribed.headSeq).toBeGreaterThanOrEqual(lastSeq);

      // 소유하지 않은 thread도 대기 승인을 읽는다
      const listed = await connection.request("approval.list", { threadId: created.threadId });
      expect(listed.approvals.map((entry) => entry.approvalId)).toEqual([asked.id]);
      const thread = (await connection.request("thread.list", {})).threads.find(
        (row) => row.threadId === created.threadId,
      );
      expect(thread?.pendingApprovals).toBe(1);
      expect(thread?.resumable).not.toBeNull();

      // 소유하지 않아도 응답은 필요한 소유를 한 번 얻어서(미해결 요청을 되살리며, HS-52) 커밋하고 놓는다.
      // turn은 이어지지 않는다: 이어 실행은 turn.resume이다(HS-74)
      const answered = await connection.request("approval.respond", {
        approvalId: asked.id,
        decision: "allow",
      });
      expect(answered).toEqual({ applied: true });
      expect(kindsOf(collected.events)).not.toContain("turn.completed");
      expect(
        (await connection.request("approval.list", { threadId: created.threadId })).approvals,
      ).toEqual([]);

      // turn.resume이 쓰기 소유를 얻고 끊긴 turn을 이어 실행한다(G1-02). 이미 해결된 승인이라 도구 호출이 이어진다
      const resumed = await connection.request("turn.resume", { threadId: created.threadId });
      expect(resumed).toMatchObject({ status: "resumed", turnId: asked.turnId });
      const done = await collected.waitFor((event) => event.kind === "turn.completed");
      expect(done.turnId).toBe(asked.turnId);
      expect(done.payload).toMatchObject({ status: "completed" });
      const ran = collected.events.filter((event) => event.kind === "item.recorded");
      expect(JSON.stringify(ran)).toContain("approved-by-user");
      expect(APPROVAL_COMMAND).toContain("approved-by-user");
      const seqs = collected.events.map((event) => event.seq);
      expect(new Set(seqs).size).toBe(seqs.length);

      await connection.close();
      await host.close();
    } finally {
      child.kill("SIGKILL");
      process.chdir(previousCwd);
      rmSync(workspace, { recursive: true, force: true });
      home.dispose();
    }
  },
  60_000,
);
