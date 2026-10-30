import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@xeon/core-models/testing";
import type { JsonObject } from "@xeon/contracts/conversation";
import type { EventWire } from "@xeon/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle, until } from "../fixtures/wire-client.ts";

// B2-ART (int): 모델이 파일을 고치고 review_request로 리뷰를 열면 검토 승인(kind review)이 올라온다.
// 모두 승인하면 파일 변경이 남고, 거절하면 거절한 hunk가 되돌아가 파일 변경이 0이 된다(L2.artifacts.spec §4.2.4~§4.2.6).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const ORIGINAL = ["one", "two", "three", "four", "five", "six", "seven", "eight"].join("\n") + "\n";
const EDITED = ORIGINAL.replace("four\n", "FOUR\n");

function step(label: string, name: string, args: JsonObject, id: string) {
  return {
    role: "main" as const,
    label,
    response: {
      type: "message" as const,
      content: [t.toolCall(name, args, id)],
      stopReason: "toolUse" as const,
    },
  };
}

function say(label: string) {
  return {
    role: "main" as const,
    label,
    response: { type: "message" as const, content: [t.text("done.")], stopReason: "stop" as const },
  };
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value));
}

function bodyKindOf(event: EventWire): string {
  const kind = recordOf(recordOf(event.payload)["body"])["kind"];
  return typeof kind === "string" ? kind : "";
}

interface Outcome {
  readonly content: string;
  readonly kinds: readonly string[];
  readonly applied: readonly unknown[];
}

async function run(reviewAnswer: JsonObject, settledKind: string): Promise<Outcome> {
  const home = useEngineHome();
  writeUserSettings(home, { ...TAPE_SETTINGS, "l0.sandbox.enabled": false });
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "xh-review-")));
  const file = join(dir, "a.txt");
  writeFileSync(file, ORIGINAL);
  const host = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    buildModels: tapeBuildModels(
      tapeProvider(
        tapePlayer(
          tape("review", [
            step(
              "edit",
              "edit",
              { path: "a.txt", edits: [{ oldText: "four\n", newText: "FOUR\n" }] },
              "call_1",
            ),
            step("open review", "review_request", {}, "call_2"),
            say("first done"),
            say("follow-up done"),
          ]),
          { clock: realTapeClock() },
        ),
      ),
    ),
  });
  const connection = createHostConnection(host.client);
  try {
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    const created = await connection.request("thread.create", { workspace: dir });
    const started = await startTurnWhenIdle(connection, {
      threadId: created.threadId,
      input: "go",
    });
    // 도구 승인(edit)은 모두 허용하고, 검토 승인이 오면 답한다
    const handled = new Set<string>();
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- 승인이 오는 순서대로 답한다
      const asked = await collector.waitFor(
        (event) => event.kind === "approval.requested" && !handled.has(event.id),
      );
      handled.add(asked.id);
      if (bodyKindOf(asked) === "review") {
        // eslint-disable-next-line no-await-in-loop -- 위와 같다
        const answered = await connection.request("approval.respond", {
          approvalId: asked.id,
          decision: "answer",
          answer: reviewAnswer,
        });
        expect(answered).toEqual({ applied: true });
        break;
      }
      // eslint-disable-next-line no-await-in-loop -- 위와 같다
      await connection.request("approval.respond", { approvalId: asked.id, decision: "allow" });
    }
    await collector.waitFor(
      (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
    );
    await collector.waitFor((event) => event.kind === settledKind);
    // 거절은 되돌림이 파일에 닿은 뒤에 submitted가 기록된다
    expect(
      await until(
        () => collector.events.some((e) => e.kind === "artifact.review_submitted"),
        10_000,
      ),
    ).toBe(true);
    return {
      content: readFileSync(file, "utf8"),
      kinds: collector.events.map((event) => event.kind),
      applied: collector.events
        .filter((event) => event.kind === "artifact.review_applied")
        .map((event) => event.payload),
    };
  } finally {
    await connection.close();
    await host.close();
    rmSync(dir, { recursive: true, force: true });
    home.dispose();
  }
}

realTest(
  "approving every hunk of a review keeps the edit and reverts nothing",
  async () => {
    const outcome = await run(
      { decisions: [], comments: [], submit: true, approveRemaining: true },
      "artifact.review_submitted",
    );
    expect(outcome.content).toBe(EDITED);
    expect(outcome.applied).toEqual([]);
  },
  60_000,
);

realTest(
  "rejecting the hunk reverts the file to its original content",
  async () => {
    const outcome = await run(
      { decisions: [{ hunkId: "f0h0", decision: "rejected" }], comments: [], submit: true },
      "artifact.review_applied",
    );
    expect(outcome.content).toBe(ORIGINAL);
    expect(JSON.stringify(outcome.applied)).toContain('"result":"reverted"');
  },
  60_000,
);
