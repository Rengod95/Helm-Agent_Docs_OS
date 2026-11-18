import { expect, test } from "bun:test";
import {
  maskItemRecord,
  type ItemId,
  type ItemRecord,
  type LeafMask,
  type ThreadId,
} from "@fresnel/contracts/conversation";
import type { HostConnection, WireResult } from "@fresnel/contracts/wire";
import {
  t,
  tape,
  tapeBuildModels,
  tapePlayer,
  tapeProvider,
  type TapePlayer,
  type TapeRequest,
} from "@fresnel/core-models/testing";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import {
  collectEvents,
  HELLO_PARAMS,
  startTurnWhenIdle,
  type EventCollector,
} from "../fixtures/wire-client.ts";

// L0.secrets.spec §3.5 큰 내용 [결정: AGE-59]. 큰 내용(분리된 blob)에도 작은 내용과 같은 가림 규칙이 적용된다.
// 실제 엔진에 큰 사용자 메시지(시크릿 모양 값 포함)를 맡기고 wire 이벤트, thread.read의 표식, 모델 입력을 값으로 본다.
// 시험용 가짜 값만 쓴다. 값은 소스에 모양 그대로 적지 않고 시험에서 이어 붙여 만든다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const KIB = 1024;
const MIB = 1024 * KIB;
const FAKE_TOKEN = ["gh", "p_", "q".repeat(36)].join("");
const FAKE_PASSWORD = "hunter2hunter2";
const FILLER_LINE = "plain filler line without anything to hide.\n";

/** 가릴 값 둘(접두 패턴 토큰과 키-값 비밀번호)이 가운데 든 글. 길이는 `bytes` 이상이다 */
function textOf(bytes: number): { readonly raw: string; readonly masked: string } {
  const half = FILLER_LINE.repeat(Math.ceil(bytes / 2 / FILLER_LINE.length));
  const middle = `token ${FAKE_TOKEN} and password=${FAKE_PASSWORD} end\n`;
  const maskedMiddle = "token [REDACTED:github_token] and password=[REDACTED:kv] end\n";
  return { raw: half + middle + half, masked: half + maskedMiddle + half };
}

interface Run {
  readonly connection: HostConnection;
  readonly collector: EventCollector;
  readonly requests: string[];
  close(): Promise<void>;
}

async function start(): Promise<Run> {
  const home = useEngineHome();
  writeUserSettings(home, TAPE_SETTINGS);
  const requests: string[] = [];
  const inner = tapePlayer(
    tape("large-redaction", [
      {
        role: "main" as const,
        label: "answer",
        response: {
          type: "message" as const,
          content: [t.text("ok")],
          stopReason: "stop" as const,
        },
      },
    ]),
    { clock: realTapeClock() },
  );
  const player: TapePlayer = {
    stream(request: TapeRequest) {
      requests.push(JSON.stringify(request.context.messages));
      return inner.stream(request);
    },
    remaining: () => inner.remaining(),
    consumed: () => inner.consumed(),
    assertExhausted: () => {
      inner.assertExhausted();
    },
  };
  const host = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    buildModels: tapeBuildModels(tapeProvider(player)),
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  const collector = collectEvents(connection);
  await connection.request("events.subscribe", { from: "head" });
  return {
    connection,
    collector,
    requests,
    async close() {
      await connection.close();
      await host.close();
      home.dispose();
    },
  };
}

function userContent(item: ItemRecord): string {
  if (item.kind !== "user" || typeof item.message.content !== "string") {
    throw new Error("expected a user item with string content");
  }
  return item.message.content;
}

type ThreadRead = WireResult<"thread.read">;

/** 한 응답은 1 MiB 예산이라 큰 item은 자기 쪽에서만 온다(하나는 항상 담는다). 사용자 item이 나올 때까지 오래된 쪽으로 되읽는다 */
async function readUntilUser(
  connection: HostConnection,
  threadId: ThreadId,
  before: ItemId | undefined,
  pagesLeft: number,
): Promise<ThreadRead> {
  const read = await connection.request("thread.read", {
    threadId,
    ...(before === undefined ? {} : { before }),
  });
  const oldest = read.items[0];
  if (read.items.some((item) => item.kind === "user") || oldest === undefined || !read.hasMore) {
    return read;
  }
  if (pagesLeft <= 1) return read;
  return readUntilUser(connection, threadId, oldest.itemId, pagesLeft - 1);
}

interface Case {
  readonly name: string;
  readonly bytes: number;
  /** 기록이 큰 값을 blob으로 분리하는가. 분리하면 wire 이벤트에는 자리표시만 실린다 */
  readonly detached: boolean;
}

// 분리는 기록 한 건이 256 KiB 목표를 넘을 때 64 KiB 이상 문자열에 일어난다
const CASES: readonly Case[] = [
  { name: "60 KiB (inline)", bytes: 60 * KIB, detached: false },
  { name: "300 KiB (detached)", bytes: 300 * KIB, detached: true },
  { name: "3 MiB (detached)", bytes: 3 * MIB, detached: true },
];

for (const c of CASES) {
  realTest(
    `a ${c.name} message with secrets: wire event, thread.read marks and model input follow the same masking rules`,
    async () => {
      const run = await start();
      try {
        const { connection, collector } = run;
        const { threadId } = await connection.request("thread.create", {});
        const text = textOf(c.bytes);
        const started = await startTurnWhenIdle(connection, { threadId, input: text.raw });
        await collector.waitFor(
          (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
          60_000,
        );

        // wire 이벤트: 분리된 내용은 자리표시만 싣는다. 작은 내용은 원문이고 표식이 붙는다(저장 이벤트는 바꾸지 않는 결정)
        const recorded = collector.events.find(
          (event) =>
            event.kind === "item.recorded" && JSON.stringify(event.payload).includes('"user"'),
        );
        if (recorded === undefined) throw new Error("the user item.recorded event is missing");
        const payloadText = JSON.stringify(recorded.payload);
        if (c.detached) {
          expect(payloadText.includes(FAKE_TOKEN)).toBe(false);
          expect(payloadText.includes(FAKE_PASSWORD)).toBe(false);
          expect(payloadText.includes("blob:sha256:")).toBe(true);
          expect(payloadText.length).toBeLessThan(4 * KIB);
          expect(recorded.mask).toBeUndefined();
        } else {
          expect(payloadText.includes(FAKE_TOKEN)).toBe(true);
          expect(recorded.mask?.length).toBe(1);
        }

        // thread.read: 되돌린 원문과, 호스트가 계산한 표식. 표식을 적용하면 두 값이 같은 표지로 가려진다
        const read = await readUntilUser(connection, threadId, undefined, 6);
        const user = read.items.find((item) => item.kind === "user");
        if (user === undefined) throw new Error("the user item is missing");
        expect(userContent(user)).toBe(text.raw);
        const leaves: readonly LeafMask[] | undefined = read.masks?.find(
          (entry) => entry.itemId === user.itemId,
        )?.leaves;
        expect(leaves?.map((leaf) => leaf.pointer)).toEqual(["/message/content"]);
        const shown = maskItemRecord(user, leaves);
        expect(shown === null ? null : userContent(shown)).toBe(text.masked);

        // 모델 입력: 투영이 되돌린 원문에 같은 규칙을 적용한다. 값은 요청에 없다
        const sent = run.requests[0] ?? "";
        expect(sent.includes(FAKE_TOKEN)).toBe(false);
        expect(sent.includes(FAKE_PASSWORD)).toBe(false);
        expect(sent.includes("[REDACTED:github_token]")).toBe(true);
        expect(sent.includes("password=[REDACTED:kv]")).toBe(true);
      } finally {
        await run.close();
      }
    },
    120_000,
  );
}
