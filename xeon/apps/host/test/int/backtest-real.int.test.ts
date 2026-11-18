import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@fresnel/core-models/testing";
import {
  WireError,
  type BacktestProgressParams,
  type HostConnection,
  type WireParams,
  type WireResult,
} from "@fresnel/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import type { AssembleOptions } from "../../src/types.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { isolatedPluginHost } from "../fixtures/isolated-plugin-host.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// 지난 턴에 돌려 보기(`backtest.*`, turn-record-metrics.md §3.5, §4.8)를 실제 엔진으로 시험한다. 실제 엔진이 두 턴을 돌려 도구 호출 둘을 기록하고,
// 사용자 플러그인 후보(`guard.tool.before`)를 초안으로 만들어 돌려 본다. 후보는 플러그인 호스트 자식 프로세스에서만 돈다.
// 후보의 훅은 자기 프로세스 번호와 부모 번호와 받은 입력을 보고 파일에 쓴다. 보고 파일은 엔진 홈(임시 폴더) 안에 둔다.
// 격리가 꺼진 엔진에서는 실행이 시작되지 않고(3524), 보고 파일이 생기지 않아야 한다. 이 파일은 그 음성 시험을 먼저 두고 양성 시험을 둔다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const CANDIDATE_NAME = "btguard";
const CANDIDATE_HOOK = "guard.tool.before";
const BLOCKED_PATH = "forbidden-note.txt";
const PLAIN_PATH = "plain-page.md";
const TIMEOUT_MS = 60_000;
/** 기록된 두 호출이 돌려 본 뒤 `backtest.progress`의 마지막 값을 기다리는 시한 */
const RUN_DEADLINE_MS = 60_000;
/** 지표 조회의 고정 기간(창이 시계에 따라 움직이지 않게 한다) */
const PERIOD = { from: 0, to: 4_102_444_800_000 } as const;
const SHA_PREFIX = "sha256:";
const NOT_REPRODUCIBLE = [
  "model_reaction_after_block",
  "later_call_order_and_count",
  "other_plugin_hook_interaction",
  "human_answer_to_ask",
  "candidate_time_or_external_state",
  "candidate_network_side_effects",
];

// ── 후보 플러그인(초안) ─────────────────────────────────────────────────

/** 후보의 진입점. 입력에 `forbidden`이 들면 막고, 아니면 의견이 없다(`undefined`, 규칙상 통과) */
function candidateEntry(reportPath: string): string {
  return `import { appendFileSync } from "node:fs";
export const extension = ({ register }) => {
  register(${JSON.stringify(CANDIDATE_NAME)}, {}, (g) => {
    g.on(${JSON.stringify(CANDIDATE_HOOK)}, (payload) => {
      appendFileSync(${JSON.stringify(reportPath)}, JSON.stringify({ pid: process.pid, ppid: process.ppid, input: payload.input }) + "\\n");
      if (JSON.stringify(payload.input).includes("forbidden")) return { block: true, reason: "forbidden argument" };
    });
  });
};
`;
}

const CANDIDATE_MANIFEST = JSON.stringify({
  schemaVersion: 2,
  name: CANDIDATE_NAME,
  version: "1.0.0",
  purpose: "Blocks a tool call whose input says forbidden",
  defaultEnabled: false,
  entry: "./src/index.ts",
  plugins: [{ layer: "plugin", hooks: [CANDIDATE_HOOK] }],
});

/** 후보 폴더를 엔진 홈 안에 쓴다. 살아 있는 확장 폴더가 아니라 작업 폴더다(초안으로만 복사된다) */
function writeCandidateFolder(home: EngineHome, reportPath: string): string {
  const root = join(home.root, "work", CANDIDATE_NAME);
  mkdirSync(join(root, ".fresnel-plugin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, ".fresnel-plugin", "plugin.json"), CANDIDATE_MANIFEST);
  writeFileSync(join(root, "src", "index.ts"), candidateEntry(reportPath));
  return root;
}

// ── 모델 테이프: 턴 하나에 읽기 도구 호출 하나 ─────────────────────────────

function readCall(label: string, id: string, path: string) {
  return {
    role: "main" as const,
    label,
    response: {
      type: "message" as const,
      content: [t.toolCall("read", { path }, id)],
      stopReason: "toolUse" as const,
    },
  };
}

function answer(label: string, text: string) {
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

/** 첫 턴은 막힐 인자로, 둘째 턴은 막히지 않을 인자로 읽기 도구를 부른다. 턴마다 답을 한 번 낸다 */
function twoTurnModels(id: string): NonNullable<AssembleOptions["buildModels"]> {
  return tapeBuildModels(
    tapeProvider(
      tapePlayer(
        tape(id, [
          readCall("first turn reads the forbidden path", "call_forbidden", BLOCKED_PATH),
          answer("first turn answers", "first."),
          readCall("second turn reads a plain path", "call_plain", PLAIN_PATH),
          answer("second turn answers", "second."),
        ]),
        { clock: realTapeClock() },
      ),
    ),
  );
}

// ── 도우미 ──────────────────────────────────────────────────────────────

/** 턴을 시작하고 `turn.completed`를 기다린다. 턴 기록은 이 뒤에 쓰이므로 기록 쪽은 따로 기다린다 */
async function runTurn(
  connection: HostConnection,
  collector: ReturnType<typeof collectEvents>,
  threadId: ThreadId,
  input: string,
): Promise<string> {
  const started = await startTurnWhenIdle(connection, { threadId, input });
  await collector.waitFor(
    (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
  );
  return started.turnId;
}

/** 대화의 턴 기록이 `count`개가 될 때까지 기다린다(마감을 넘으면 마지막 목록을 돌려준다) */
async function recordedTurnIds(
  connection: HostConnection,
  threadId: ThreadId,
  count: number,
  deadline: number,
): Promise<string[]> {
  const listed = await connection.request("turnRecord.list", { threadId });
  const ids = listed.items.map((item) => item.turnId);
  if (ids.length >= count || Date.now() > deadline) return ids;
  await Bun.sleep(25);
  return recordedTurnIds(connection, threadId, count, deadline);
}

/** 초안을 만들고 그 버전 id(`draft:<초안 id>:<해시 앞 8 hex>`)를 돌려준다 */
async function draftVersionOf(connection: HostConnection, dir: string): Promise<string> {
  const draft = await connection.request("plugin.draft.create", { dir });
  const hex = draft.contentHash.slice(SHA_PREFIX.length, SHA_PREFIX.length + 8);
  return `draft:${draft.draftId}:${hex}`;
}

/**
 * 진행 알림을 모은다. `untilDone`은 실행의 마지막 진행(`done === total`)이 오면 끝나고, 마감을 넘으면 거부한다.
 * 알림이 `backtest.run`의 응답보다 먼저 와도 모은 목록에서 찾는다
 */
function progressFeed(connection: HostConnection) {
  const events: BacktestProgressParams[] = [];
  const waiters = new Set<() => void>();
  connection.onNotification("backtest.progress", (params) => {
    events.push(params);
    for (const wake of Array.from(waiters)) wake();
  });
  return {
    events,
    untilDone(runId: string, timeoutMs: number): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const check = (): void => {
          if (!events.some((event) => event.runId === runId && event.done === event.total)) return;
          clearTimeout(timer);
          waiters.delete(check);
          resolve();
        };
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error(`no final backtest.progress for ${runId} within ${timeoutMs}ms`));
        }, timeoutMs);
        waiters.add(check);
        check();
      });
    },
  };
}

interface CandidateReport {
  readonly pid: number;
  readonly ppid: number;
  readonly input: unknown;
}

function reportOf(value: unknown): CandidateReport {
  if (
    typeof value !== "object" ||
    value === null ||
    !("pid" in value) ||
    !("ppid" in value) ||
    !("input" in value) ||
    typeof value.pid !== "number" ||
    typeof value.ppid !== "number"
  ) {
    throw new Error("the candidate wrote an unexpected report line");
  }
  return { pid: value.pid, ppid: value.ppid, input: value.input };
}

/** 후보가 쓴 보고(한 줄에 한 호출). 파일이 없으면 빈 목록이다(후보가 한 번도 돌지 않았다) */
function reportsOf(path: string): CandidateReport[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => reportOf(JSON.parse(line)));
}

function pathOf(input: unknown): string | null {
  if (typeof input !== "object" || input === null || !("path" in input)) return null;
  return typeof input.path === "string" ? input.path : null;
}

/**
 * 대화 상태의 스냅숏: 턴 기록 목록, 턴 기록 본문, 대화 목록, 지표 값. 돌려 보기 전후에 같은 값이어야 한다(섞임이 없다)
 */
/** 턴 기록 하나의 기록된 호출 id와 턴 id. 기록이 없으면 빈 목록이다(그러면 호출 수 비교가 실패한다) */
interface RecordedCall {
  readonly toolCallId: string;
  readonly turnId: string;
}

function recordedCallsOf(read: WireResult<"turnRecord.get">): RecordedCall[] {
  if (read.record === null) return [];
  const turnId = read.record.turnId;
  return read.record.steps.flatMap((step) =>
    step.calls.map((call) => ({ toolCallId: call.toolCallId, turnId })),
  );
}

async function snapshotOf(
  connection: HostConnection,
  threadId: ThreadId,
  turnIds: readonly string[],
) {
  const catalog = await connection.request("metrics.catalog", {});
  const metricIds = catalog.metrics.slice(0, 16).map((metric) => metric.id);
  const [listed, threads, measured, records] = await Promise.all([
    connection.request("turnRecord.list", { threadId }),
    connection.request("thread.list", {}),
    connection.request("metrics.query", {
      metrics: metricIds,
      filter: { period: PERIOD },
    }),
    Promise.all(
      turnIds.map((turnId) => connection.request("turnRecord.get", { threadId, turnId })),
    ),
  ]);
  return {
    turnList: listed,
    threads: threads.threads.map((thread) => thread.threadId),
    metrics: measured,
    records,
    recordedCalls: records.map((read) => recordedCallsOf(read).length),
  };
}

// ── 시험 ────────────────────────────────────────────────────────────────

realTest(
  "with the plugin host disabled, backtest.run answers 3524 and the candidate never runs anywhere",
  async () => {
    const home = useEngineHome();
    const reportPath = join(home.root, "candidate-report.jsonl");
    writeUserSettings(home, TAPE_SETTINGS);
    const dir = writeCandidateFolder(home, reportPath);
    const bundles = mkdtempSync(join(tmpdir(), "backtest-real-off-bundles-"));
    const host = await startInProcessHost({
      devChecks: true,
      defaultPluginsDir: bundles,
      buildModels: twoTurnModels("backtest-real-off"),
      pluginHost: { disabled: true },
    });
    const connection = createHostConnection(host.client);
    const collector = collectEvents(connection);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      await connection.request("events.subscribe", { from: "head" });
      const created = await connection.request("thread.create", {});
      await runTurn(connection, collector, created.threadId, "first question");
      await runTurn(connection, collector, created.threadId, "second question");
      const version = await draftVersionOf(connection, dir);

      const failure = await rejectionOf(
        connection.request("backtest.run", {
          candidate: { pluginId: CANDIDATE_NAME, versionId: version },
          hook: CANDIDATE_HOOK,
          scope: { threadIds: [created.threadId], include: ["live"] },
        }),
      );
      expect(failure instanceof WireError ? [failure.code, failure.data.kind] : failure).toEqual([
        3524,
        "backtest.isolationUnavailable",
      ]);
      // 격리가 없으면 후보는 어디서도 돌지 않는다. 보고 파일이 한 번도 생기지 않았다
      expect(existsSync(reportPath)).toBe(false);
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
      rmSync(bundles, { recursive: true, force: true });
    }
  },
  TIMEOUT_MS,
);

realTest(
  "a guard hook candidate replays the two recorded calls in its own process: one is newly caught, the other passes, and no record changes",
  async () => {
    const home = useEngineHome();
    const reportPath = join(home.root, "candidate-report.jsonl");
    writeUserSettings(home, TAPE_SETTINGS);
    const dir = writeCandidateFolder(home, reportPath);
    const bundles = mkdtempSync(join(tmpdir(), "backtest-real-bundles-"));
    const host = await startInProcessHost({
      devChecks: true,
      defaultPluginsDir: bundles,
      buildModels: twoTurnModels("backtest-real"),
      pluginHost: isolatedPluginHost(),
    });
    const connection = createHostConnection(host.client);
    const collector = collectEvents(connection);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      await connection.request("events.subscribe", { from: "head" });
      const created = await connection.request("thread.create", {});
      const threadId = created.threadId;
      const firstTurn = await runTurn(connection, collector, threadId, "first question");
      const secondTurn = await runTurn(connection, collector, threadId, "second question");
      const recorded = await recordedTurnIds(connection, threadId, 2, Date.now() + 20_000);
      expect(recorded.toSorted()).toEqual([firstTurn, secondTurn].toSorted());

      const before = await snapshotOf(connection, threadId, [firstTurn, secondTurn]);
      expect(before.recordedCalls).toEqual([1, 1]);
      // 엔진은 도구 호출 id에 접미사를 붙이므로(예: `call_forbidden_<접미사>`) 기대값은 기록에서 읽는다
      const allCalls = before.records.flatMap((read) => recordedCallsOf(read));
      const blockedCalls = allCalls.filter((call) => call.toolCallId.startsWith("call_forbidden"));
      const plainCalls = allCalls.filter((call) => call.toolCallId.startsWith("call_plain"));
      expect([blockedCalls.length, plainCalls.length]).toEqual([1, 1]);
      const version = await draftVersionOf(connection, dir);
      const feed = progressFeed(connection);

      const run = await connection.request("backtest.run", {
        candidate: { pluginId: CANDIDATE_NAME, versionId: version },
        hook: CANDIDATE_HOOK,
        scope: { threadIds: [threadId], include: ["live"] },
      } satisfies WireParams<"backtest.run">);
      expect(run).toEqual({ runId: expect.any(String) });
      await feed.untilDone(run.runId, RUN_DEADLINE_MS);
      expect(await connection.request("backtest.status", { runId: run.runId })).toEqual({
        state: "done",
        done: 2,
        total: 2,
      });
      const result = await connection.request("backtest.result", { runId: run.runId });

      // 요약과 항목은 값으로 본다. 막힌 호출은 새로 막힌 것이고, 막히지 않은 호출은 같다
      expect(result.summary.turns).toBe(2);
      expect(result.summary.calls).toBe(2);
      expect(result.summary.replayed).toBe(2);
      expect(result.summary.counts).toEqual({
        newly_caught: 1,
        already_stopped: 0,
        agrees_block: 0,
        would_block_allowed_by_human: 0,
        passes_same: 1,
        candidate_fault: 0,
        unreplayable: 0,
      });
      expect(result.summary.candidateFaults).toEqual({ threw: 0, timeout: 0 });
      expect(result.notReproducible).toEqual(NOT_REPRODUCIBLE);
      expect(result.next).toBeNull();
      expect(
        result.items.map((item) => [
          item.toolCallId,
          item.turnId,
          item.tool,
          item.live.verdict,
          item.class,
          item.candidate.result,
          item.candidate.reason,
          item.nondeterministic ?? null,
        ]),
      ).toEqual([
        ...blockedCalls.map((call) => [
          call.toolCallId,
          call.turnId,
          "read",
          "allowed",
          "newly_caught",
          "block",
          "forbidden argument",
          null,
        ]),
        ...plainCalls.map((call) => [
          call.toolCallId,
          call.turnId,
          "read",
          "allowed",
          "passes_same",
          "pass",
          null,
          null,
        ]),
      ]);

      // 진행 알림은 호출마다 한 번씩, 실행 id와 함께 온다
      expect(feed.events.filter((event) => event.runId === run.runId)).toEqual([
        { runId: run.runId, done: 1, total: 2 },
        { runId: run.runId, done: 2, total: 2 },
      ]);

      // 후보는 엔진과 다른 프로세스에서, 엔진이 띄운 자식으로 돌았다. 호출마다 두 번씩 돈다(규칙 48, 같은 입력의 비결정성 확인)
      const reports = reportsOf(reportPath);
      expect(reports.map((report) => pathOf(report.input))).toEqual([
        BLOCKED_PATH,
        BLOCKED_PATH,
        PLAIN_PATH,
        PLAIN_PATH,
      ]);
      expect({
        ownProcess: reports.some((report) => report.pid === process.pid),
        parentIsThisProcess: reports.every((report) => report.ppid === process.pid),
        onePid: new Set(reports.map((report) => report.pid)).size,
      }).toEqual({ ownProcess: false, parentIsThisProcess: true, onePid: 1 });

      // 돌려 보기 전후로 턴 기록, 대화 목록, 지표 값, 기록된 호출 수가 같다(섞이지 않는다)
      const after = await snapshotOf(connection, threadId, [firstTurn, secondTurn]);
      expect(after).toEqual(before);
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
      rmSync(bundles, { recursive: true, force: true });
    }
  },
  TIMEOUT_MS,
);
