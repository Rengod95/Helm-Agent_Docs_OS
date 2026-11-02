import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@fresnel/core-models/testing";
import type { JsonObject } from "@fresnel/contracts/conversation";
import {
  WireError,
  type EventWire,
  type HostConnection,
  type ReviewGetResult,
} from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import {
  collectEvents,
  HELLO_PARAMS,
  startTurnWhenIdle,
  type EventCollector,
} from "../fixtures/wire-client.ts";

// W-02 (int): 모델이 파일을 고치고 review_request로 리뷰를 열면 `review.get`이 hunk 본문을 돌려준다. 검토 승인은 답하지 않고 대기 중으로 둔다.
// 둘째 시험은 호스트를 껐다 다시 올린 뒤 같은 리뷰를 읽는다. 이 프로세스가 승인을 요청하지 않은 리뷰라서 대기 승인이 있는 대화를 훑어 찾는다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const ORIGINAL = ["one", "two", "three", "four", "five", "six", "seven", "eight"].join("\n") + "\n";

/** `four`를 `FOUR`로 바꾼 hunk 하나. 컨텍스트는 앞뒤 3줄이라 파일의 1~7행이 hunk가 된다 */
const EXPECTED_FILES: ReviewGetResult["files"] = [
  {
    path: "a.txt",
    hunks: [
      {
        hunkId: "f0h0",
        header: "@@ -1,7 +1,7 @@",
        oldStart: 1,
        newStart: 1,
        lines: [
          { kind: "context", text: "one" },
          { kind: "context", text: "two" },
          { kind: "context", text: "three" },
          { kind: "del", text: "four" },
          { kind: "add", text: "FOUR" },
          { kind: "context", text: "five" },
          { kind: "context", text: "six" },
          { kind: "context", text: "seven" },
        ],
      },
    ],
  },
];

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

function tapeSteps() {
  return [
    step(
      "edit",
      "edit",
      { path: "a.txt", edits: [{ oldText: "four\n", newText: "FOUR\n" }] },
      "call_1",
    ),
    step("open review", "review_request", {}, "call_2"),
    say("first done"),
  ];
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value));
}

/** 검토 승인(kind review)의 요청이면 그 리뷰 id */
function reviewIdOf(event: EventWire): string | undefined {
  if (event.kind !== "approval.requested") return undefined;
  const body = recordOf(recordOf(event.payload)["body"]);
  if (body["kind"] !== "review") return undefined;
  const reviewId = recordOf(body["review"])["reviewId"];
  return typeof reviewId === "string" ? reviewId : undefined;
}

/**
 * 턴을 시작하고 도구 승인은 허용한다. 검토 승인이 오면 답하지 않고 그 리뷰 id를 돌려준다. 턴이 끝날 때까지 기다린다.
 */
async function runUntilReview(
  connection: HostConnection,
  collector: EventCollector,
  dir: string,
): Promise<string> {
  const created = await connection.request("thread.create", { workspace: dir });
  const started = await startTurnWhenIdle(connection, { threadId: created.threadId, input: "go" });
  const handled = new Set<string>();
  let reviewId: string | undefined;
  while (reviewId === undefined) {
    // eslint-disable-next-line no-await-in-loop -- 승인이 오는 순서대로 답한다
    const asked = await collector.waitFor(
      (event) => event.kind === "approval.requested" && !handled.has(event.id),
    );
    handled.add(asked.id);
    reviewId = reviewIdOf(asked);
    if (reviewId === undefined) {
      // eslint-disable-next-line no-await-in-loop -- 위와 같다
      await connection.request("approval.respond", { approvalId: asked.id, decision: "allow" });
    }
  }
  await collector.waitFor(
    (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
  );
  return reviewId;
}

function tapeHost() {
  return startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    buildModels: tapeBuildModels(
      tapeProvider(tapePlayer(tape("review-get", tapeSteps()), { clock: realTapeClock() })),
    ),
  });
}

realTest(
  "review.get returns the hunk of a review the model opened, with each line's kind and text; an unknown id is invalid params on reviewId",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, { ...TAPE_SETTINGS, "l0.sandbox.enabled": false });
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "xh-review-get-")));
    writeFileSync(join(dir, "a.txt"), ORIGINAL);
    const host = await tapeHost();
    const connection = createHostConnection(host.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });
      const reviewId = await runUntilReview(connection, collector, dir);

      expect(await connection.request("review.get", { reviewId })).toEqual({
        reviewId,
        files: EXPECTED_FILES,
      });

      const missing = await rejectionOf(
        connection.request("review.get", { reviewId: "rvw_never_opened" }),
      );
      expect(missing).toBeInstanceOf(WireError);
      if (missing instanceof WireError) {
        expect(missing.code).toBe(-32602);
        expect(missing.data.details).toEqual({
          issues: [{ path: "reviewId", message: "unknown review" }],
        });
      }
    } finally {
      await connection.close();
      await host.close();
      rmSync(dir, { recursive: true, force: true });
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "after a restart the host finds a review whose approval is still pending, though it did not request that approval",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, { ...TAPE_SETTINGS, "l0.sandbox.enabled": false });
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "xh-review-get-restart-")));
    writeFileSync(join(dir, "a.txt"), ORIGINAL);
    let reviewId = "";
    const first = await tapeHost();
    const firstConnection = createHostConnection(first.client);
    try {
      await firstConnection.request("host.hello", HELLO_PARAMS);
      const collector = collectEvents(firstConnection);
      await firstConnection.request("events.subscribe", { from: "head" });
      reviewId = await runUntilReview(firstConnection, collector, dir);
    } finally {
      await firstConnection.close();
      await first.close();
    }

    const second = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const connection = createHostConnection(second.client);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      expect(await connection.request("review.get", { reviewId })).toEqual({
        reviewId,
        files: EXPECTED_FILES,
      });
    } finally {
      await connection.close();
      await second.close();
      rmSync(dir, { recursive: true, force: true });
      home.dispose();
    }
  },
  60_000,
);
