import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { Type } from "typebox";
import { parse } from "@fresnel/contracts";
import { tapeBuildModels, tapePlayer, tapeProvider } from "@fresnel/core-models/testing";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { EventWire } from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { createStdioTransport } from "../../src/transport/stdio.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { REVIEW_EDITED, REVIEW_ORIGINAL, reviewResumeTape } from "../fixtures/review-tape.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle, until } from "../fixtures/wire-client.ts";

// AGE-46 (L2.artifacts.spec §4.2.8): 거절 답을 기록한 직후 엔진 프로세스가 강제로 죽으면 거절한 변경의 되돌림이 끊긴다.
// 다음 시작 때 답은 있는데 적용 기록이 없는 검토를 찾아 되돌림을 이어서 한다. 자식 호스트는 fixtures/review-crash-host.ts다.
// 되돌림이 파일에 닿기 전에 죽도록, 자식 호스트는 되돌림 쓰기 직전의 실행 가드(guard.output.before)에서 영원히 멈추는 시험용 플러그인을 싣는다.
// 그래서 승인 해결(approval.resolved)은 기록되고 적용 기록(artifact.review_applied)은 없는 채로 SIGKILL을 맞는다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const CRASH_HOST: string = join(import.meta.dir, "..", "fixtures", "review-crash-host.ts");
const FIELDS = Type.Record(Type.String(), Type.Unknown());

function fieldOf(value: unknown, key: string): unknown {
  const fields = parse(FIELDS, value);
  return fields.ok ? fields.value[key] : undefined;
}

function isReviewCard(event: EventWire): boolean {
  return fieldOf(fieldOf(event.payload, "body"), "kind") === "review";
}

function countOf(events: readonly EventWire[], kind: string): number {
  return events.filter((event) => event.kind === kind).length;
}

interface Killed {
  readonly workspace: string;
  readonly file: string;
  readonly threadId: ThreadId;
  readonly cleanup: () => void;
}

/** 자식 호스트에서 검토를 열고 거절 답을 낸 뒤, 되돌림이 파일에 닿기 전에 SIGKILL로 죽인다 */
async function killedAfterRejection(): Promise<Killed> {
  const home = useEngineHome();
  writeUserSettings(home, { ...TAPE_SETTINGS, "l0.sandbox.enabled": false });
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "xh-review-kill-")));
  const file = join(workspace, "a.txt");
  writeFileSync(file, REVIEW_ORIGINAL);
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
  const cleanup = (): void => {
    child.kill("SIGKILL");
    rmSync(workspace, { recursive: true, force: true });
    home.dispose();
  };
  try {
    const connection = createHostConnection(
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
    await connection.request("host.hello", HELLO_PARAMS);
    const seen = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    const created = await connection.request("thread.create", { workspace });
    await startTurnWhenIdle(connection, { threadId: created.threadId, input: "go" });
    // 도구 승인(edit)은 허용하고, 검토 카드가 오면 멈춘다
    const handled = new Set<string>();
    let reviewCard: EventWire | undefined;
    while (reviewCard === undefined) {
      // eslint-disable-next-line no-await-in-loop -- 승인이 오는 순서대로 답한다
      const asked = await seen.waitFor(
        (event) => event.kind === "approval.requested" && !handled.has(event.id),
        60_000,
      );
      handled.add(asked.id);
      if (isReviewCard(asked)) {
        reviewCard = asked;
        break;
      }
      // eslint-disable-next-line no-await-in-loop -- 위와 같다
      await connection.request("approval.respond", { approvalId: asked.id, decision: "allow" });
    }
    expect(readFileSync(file, "utf8")).toBe(REVIEW_EDITED);
    const answered = await connection.request("approval.respond", {
      approvalId: reviewCard.id,
      decision: "answer",
      answer: {
        decisions: [{ hunkId: "f0h0", decision: "rejected" }],
        comments: [],
        submit: true,
      },
    });
    expect(answered).toEqual({ applied: true });
    await seen.waitFor((event) => event.kind === "approval.resolved", 30_000);
    // 자식의 가드 플러그인이 되돌림을 붙잡고 있다: 적용 기록이 생기지 않는다
    await Bun.sleep(1_000);
    expect(countOf(seen.events, "artifact.review_applied")).toBe(0);
    child.kill("SIGKILL");
    await child.exited;
    expect(child.signalCode).toBe("SIGKILL");
    await reading;
    expect(errorText).not.toContain("review-crash-host:");
    return { workspace, file, threadId: created.threadId, cleanup };
  } catch (caught) {
    cleanup();
    throw caught;
  }
}

/** 같은 저장소에 새 호스트를 올려 이 대화의 이벤트를 처음부터 읽는다 */
async function restarted(
  threadId: ThreadId,
  workspace: string,
): Promise<{ readonly events: readonly EventWire[]; readonly close: () => Promise<void> }> {
  process.chdir(workspace);
  const host = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    buildModels: tapeBuildModels(
      tapeProvider(tapePlayer(reviewResumeTape("review-resume"), { clock: realTapeClock() })),
    ),
  });
  const connection = createHostConnection(host.client);
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  const collected = collectEvents(connection);
  await connection.request("events.subscribe", {
    from: { storeId: hello.storeId, seq: 0 },
    filter: { threadIds: [threadId] },
  });
  // 대화를 다시 열면(쓰기 소유) 끊긴 검토 답을 이어서 처리한다(thread.start)
  await connection.request("thread.open", { threadId, mode: "write" });
  return {
    events: collected.events,
    close: async () => {
      await connection.close();
      await host.close();
    },
  };
}

realTest(
  "a rejection answered right before a forced kill is reverted at the next start, and a third start changes nothing",
  async () => {
    const previousCwd = process.cwd();
    const killed = await killedAfterRejection();
    try {
      // 거절한 변경(FOUR)이 파일에 있는 채로 죽었다
      writeFileSync(killed.file, REVIEW_EDITED);

      const second = await restarted(killed.threadId, killed.workspace);
      expect(
        await until(() => countOf(second.events, "artifact.review_applied") === 1, 30_000),
      ).toBe(true);
      expect(
        await until(() => countOf(second.events, "artifact.review_submitted") === 1, 30_000),
      ).toBe(true);
      expect(readFileSync(killed.file, "utf8")).toBe(REVIEW_ORIGINAL);
      expect(
        JSON.stringify(second.events.filter((e) => e.kind === "artifact.review_applied")),
      ).toContain('"result":"reverted"');
      await second.close();

      // 세 번째 시작은 아무것도 하지 않는다: 같은 파일, 적용·제출 기록은 하나씩
      const third = await restarted(killed.threadId, killed.workspace);
      await Bun.sleep(2_000);
      expect(readFileSync(killed.file, "utf8")).toBe(REVIEW_ORIGINAL);
      expect(countOf(third.events, "artifact.review_applied")).toBe(1);
      expect(countOf(third.events, "artifact.review_submitted")).toBe(1);
      await third.close();
    } finally {
      process.chdir(previousCwd);
      killed.cleanup();
    }
  },
  180_000,
);

realTest(
  "a file that changed while the engine was down is not overwritten at the next start and the conflict is reported",
  async () => {
    const previousCwd = process.cwd();
    const killed = await killedAfterRejection();
    try {
      // 그사이 다른 대화나 사람이 같은 줄을 고쳤다
      const changed = REVIEW_EDITED.replace("FOUR\n", "FOUR!\n");
      writeFileSync(killed.file, changed);

      const second = await restarted(killed.threadId, killed.workspace);
      expect(
        await until(() => countOf(second.events, "artifact.review_applied") === 1, 30_000),
      ).toBe(true);
      expect(existsSync(killed.file)).toBe(true);
      expect(readFileSync(killed.file, "utf8")).toBe(changed);
      const applied = JSON.stringify(
        second.events.filter((event) => event.kind === "artifact.review_applied"),
      );
      expect(applied).toContain('"result":"conflict"');
      expect(applied).not.toContain('"result":"reverted"');
      await second.close();
    } finally {
      process.chdir(previousCwd);
      killed.cleanup();
    }
  },
  180_000,
);
