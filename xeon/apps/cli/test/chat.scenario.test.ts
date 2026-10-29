import { afterEach, expect, test } from "bun:test";
import { parse, parseJson } from "@xeon/contracts";
import type { TurnId } from "@xeon/contracts/conversation";
import type { ExtensionEntry, ScopeHandle } from "@xeon/contracts/extensions";
import {
  checkEnvelope,
  EventsBatchParamsSchema,
  WIRE_PROTOCOL_VERSION,
  WireError,
  type EventWire,
} from "@xeon/contracts/wire";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@xeon/core-models/testing";
import { smokeGroup } from "@xeon/group-kit/testing";
import { startInProcessHost } from "@xeon/host";
import { createHostConnection } from "../src/host-client.ts";
import {
  createEventLog,
  isKind,
  payloadField,
  scopeChanged,
  stepEvent,
  turnEnded,
  BUSY_RETRY_LIMIT,
  nextEventLoopTurn,
  type EventLog,
} from "./support/event-log.ts";
import {
  createScenarioHome,
  NOTES_TEXT,
  realTapeClock,
  SCENARIO_MAIN,
  TAPES_DIR,
  type ScenarioHome,
} from "./support/scenario.ts";

// M1 걸어 다니는 골격의 스모크(foundation-plan §6, L4.cli.plan §5.2). 저장소에서 유일한 scenario다(eng.testing.guide TS-01).
// 모델은 테이프다. 엔진은 가짜가 아니라 실제 조립(@xeon/host)이다.
//   1. xeon chat 한 턴이 read 도구를 쓰고 끝난다(실제 자식 프로세스).
//   2. 실행 중 SIGKILL 뒤 --continue로 다시 열면 같은 thread에서 이벤트가 이어진다(실제 자식 프로세스).
//   3. 테스트 그룹의 scope 토글은 단계 경계에서 적용되고, drive가 turn을 만든다(같은 프로세스 안 엔진).
//   4. --set l4.ui.locale=en이면 글 모드 턴의 문장이 영어가 되고, 없으면 같은 테이프가 한국어로 나온다(실제 자식 프로세스).
// 결정성은 D1이다: 이벤트열을 바이트로 비교하지 않고 순서와 관계만 본다(TS-08 3번).

const homes: ScenarioHome[] = [];
const children: ScenarioChild[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill();
  for (const home of homes.splice(0)) home.dispose();
});

function newHome(): ScenarioHome {
  const home = createScenarioHome();
  homes.push(home);
  return home;
}

// ── 자식 프로세스 ────────────────────────────────────────────────────────

interface ScenarioChild {
  readonly log: EventLog;
  stderr(): string;
  /** 조건에 맞는 이벤트가 이미 있거나 오면 돌려준다 */
  waitFor(predicate: (event: EventWire) => boolean, what: string): Promise<EventWire>;
  /** 종료 코드. 신호로 죽으면 0이 아닌 값이다 */
  readonly exited: Promise<number>;
  kill(): void;
}

/** stdout 한 줄(--json이라 한 줄에 메시지 하나)이 담은 events.batch의 이벤트들 */
function eventsIn(line: string): readonly EventWire[] {
  const decoded = parseJson(line);
  if (!decoded.ok) return [];
  const checked = checkEnvelope(decoded.value);
  if (!checked.ok) return [];
  const message = checked.message;
  if (!("method" in message) || message.method !== "events.batch") return [];
  const batch = parse(EventsBatchParamsSchema, message.params);
  return batch.ok ? batch.value.events : [];
}

/** chat 명령을 실제 프로세스로 띄운다. 모델은 `tapeName` 테이프 파일이다 */
function spawnChat(home: ScenarioHome, tapeName: string, args: readonly string[]): ScenarioChild {
  const proc = Bun.spawn([process.execPath, SCENARIO_MAIN, "chat", ...args, "--json"], {
    cwd: home.work,
    env: {
      ...process.env,
      XEON_HOME: home.root,
      XEON_CLI_STATE_FILE: home.stateFile,
      XEON_SCENARIO_TAPE: `${TAPES_DIR}/${tapeName}.tape.jsonl`,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const log = createEventLog();
  let errorText = "";
  const readOut = async (): Promise<void> => {
    const decoder = new TextDecoder();
    let pending = "";
    for await (const chunk of proc.stdout) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) for (const event of eventsIn(line)) log.push(event);
    }
  };
  const readErr = async (): Promise<void> => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stderr) errorText += decoder.decode(chunk, { stream: true });
  };
  const child: ScenarioChild = {
    log,
    stderr: () => errorText,
    waitFor: (predicate, what) => log.waitFor(predicate, what, () => `stderr: ${errorText}`),
    exited: Promise.all([proc.exited, readOut(), readErr()]).then(([code]) => code),
    kill() {
      proc.kill("SIGKILL");
    },
  };
  children.push(child);
  return child;
}

/** chat을 글 모드(--json 없이)로 띄우고 끝까지 기다린다. 로케일 단서는 LANG과 LC_ALL로 ko에 고정한다 */
async function runTextChat(
  home: ScenarioHome,
  tapeName: string,
  args: readonly string[],
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  const proc = Bun.spawn([process.execPath, SCENARIO_MAIN, "chat", ...args], {
    cwd: home.work,
    env: {
      ...process.env,
      XEON_HOME: home.root,
      XEON_CLI_STATE_FILE: home.stateFile,
      XEON_SCENARIO_TAPE: `${TAPES_DIR}/${tapeName}.tape.jsonl`,
      // 호스트 로케일이 결과를 바꾸지 못하게 OS 단서를 ko로 고정한다. 영어가 되는 것은 --set 뿐이어야 한다
      LANG: "ko_KR.UTF-8",
      LC_ALL: "ko_KR.UTF-8",
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

// ── 1. 한 턴과 read 도구 ─────────────────────────────────────────────────

test("scenario-1: chat -p runs one tape turn that uses the read tool", async () => {
  const home = newHome();
  const child = spawnChat(home, "chat-complete", ["-p", "read notes.txt"]);
  const code = await child.exited;
  expect(code, child.stderr()).toBe(0);

  const { log } = child;
  const intent = log.need(isKind("effect.intent"), "effect.intent");
  expect(payloadField(intent, "toolName")).toBe("read");
  const result = log.need(isKind("effect.result"), "effect.result");
  expect(payloadField(result, "status")).toBe("ok");
  // 도구 결과 item에 파일 내용이 담긴다
  const toolResultItem = log.need(
    (event) =>
      event.kind === "item.recorded" &&
      JSON.stringify(event.payload).includes('"kind":"toolResult"'),
    "toolResult item",
  );
  expect(JSON.stringify(toolResultItem.payload)).toContain(JSON.stringify(NOTES_TEXT).slice(1, -1));
  // 도구 결과 뒤 두 번째 단계의 답으로 turn이 끝난다
  const ended = log.need(isKind("turn.completed"), "turn.completed");
  expect(payloadField(ended, "status")).toBe("completed");
  expect(payloadField(ended, "stepCount")).toBe(2);
  expect(intent.seq).toBeLessThan(result.seq);
  expect(result.seq).toBeLessThan(ended.seq);
}, 40_000);

// ── 2. 강제 종료 뒤 재개 ─────────────────────────────────────────────────

test("scenario-2: after SIGKILL, --continue resumes the same thread and the events carry on", async () => {
  const home = newHome();
  const first = spawnChat(home, "chat-first", ["-p", "read notes.txt"]);
  // read의 결과가 커밋되고 두 번째 단계의 모델 호출(테이프의 stall)이 시작된 때까지 기다린다
  await first.waitFor(isKind("effect.result"), "effect.result");
  const turnId = first.log.need(isKind("turn.started"), "turn.started").turnId;
  if (turnId === null) throw new Error("turn.started carries no turn id");
  await first.waitFor(stepEvent("step.started", turnId, 1), "second step");
  const seen = first.log.events;
  const threadId = first.log.need(isKind("turn.started"), "turn.started").threadId;
  const lastSeq = Math.max(...seen.map((event) => event.seq));
  first.kill();
  expect(await first.exited).not.toBe(0);

  const second = spawnChat(home, "chat-continue", ["--continue", "-p", "keep going"]);
  const code = await second.exited;
  expect(code, second.stderr()).toBe(0);

  const after = second.log.events;
  // 같은 thread이고, 새로 받은 seq가 모두 이전보다 크며 중복 없이 늘어난다
  expect(after.length).toBeGreaterThan(0);
  expect(new Set(after.map((event) => event.threadId))).toEqual(new Set([threadId]));
  const afterSeqs = after.map((event) => event.seq);
  expect(Math.min(...afterSeqs)).toBeGreaterThan(lastSeq);
  expect(new Set(afterSeqs).size).toBe(afterSeqs.length);
  expect(afterSeqs).toEqual(afterSeqs.toSorted((a, b) => a - b));
  // 끊긴 turn은 정리되어 끝나고, 새 입력이 새 turn에서 끝까지 돈다
  const closed = second.log.need(turnEnded(turnId), "the interrupted turn's end");
  expect(payloadField(closed, "status")).not.toBe("completed");
  const resumed = second.log.all(
    (event) => event.kind === "turn.completed" && event.turnId !== turnId,
  );
  expect(resumed).toHaveLength(1);
  expect(payloadField(resumed[0] ?? closed, "status")).toBe("completed");
  const recorded = second.log.all(isKind("item.recorded")).map((event) => event.payload);
  expect(JSON.stringify(recorded)).toContain("resumed and answered.");
}, 60_000);

// ── 3. 그룹의 scope 토글과 drive ─────────────────────────────────────────

test("scenario-3: a scope toggle applies at the step boundary and the group's drive makes a turn", async () => {
  const home = newHome();
  // 엔진은 시작할 때의 작업 폴더를 읽기·쓰기 root로 잡는다(cap-workspace M1). 시험이 끝나면 되돌린다
  const previousHome = process.env["XEON_HOME"];
  const previousCwd = process.cwd();
  process.env["XEON_HOME"] = home.root;
  process.chdir(home.work);
  const fake = tapeProvider(
    tapePlayer(
      tape("cli/group-toggle", [
        {
          role: "main",
          label: "first user turn: a plain answer",
          response: { type: "message", content: [t.text("hello.")], stopReason: "stop" },
        },
        {
          role: "main",
          label: "the group's drive turn",
          response: {
            type: "message",
            content: [t.text("drive turn answered.")],
            stopReason: "stop",
          },
        },
        {
          role: "main",
          label: "second user turn asks to read a file",
          response: {
            type: "message",
            content: [t.toolCall("read", { path: "notes.txt" }, "call_1")],
            stopReason: "toolUse",
          },
        },
        {
          role: "main",
          label: "second user turn answers after the read",
          response: { type: "message", content: [t.text("read it.")], stopReason: "stop" },
        },
      ]),
      { clock: realTapeClock() },
    ),
  );
  // 테스트 그룹(group-kit). 시험이 덧붙인 도구 호출 지점 처리기가 자기 scope를 끄도록 요청한다
  // (단계 안에서 요청하고, 적용은 단계 경계여야 한다)
  const group = smokeGroup({ followUps: 0, driveTurns: 1 });
  const hold: { handle: ScopeHandle | undefined } = { handle: undefined };
  const entry: ExtensionEntry = (host) =>
    group.entry({
      manifest: host.manifest,
      scope: (id, def, setup) => {
        const handle = host.scope(id, def, async (g) => {
          await setup(g);
          g.on("tool.call.before", () => {
            hold.handle?.disable();
            return undefined;
          });
        });
        hold.handle = handle;
        return handle;
      },
    });
  const host = await startInProcessHost({
    buildModels: tapeBuildModels(fake),
    defaultGroups: false,
    extraPlugins: [{ manifest: group.manifest, extension: entry }],
  });
  try {
    const groupId = group.manifest.name;
    const connection = createHostConnection(host.client);
    const log = createEventLog();
    connection.onNotification("events.batch", (params) => {
      for (const event of params.events) log.push(event);
    });
    await connection.request("host.hello", {
      protocolVersion: WIRE_PROTOCOL_VERSION,
      client: { name: "xeon-cli-scenario", version: "0.0.0", kind: "other" },
    });
    const created = await connection.request("thread.create", { workspace: home.work });
    await connection.request("events.subscribe", {
      from: created.position,
      filter: { threadIds: [created.threadId] },
    });
    // turn.completed가 커밋된 직후에는 루프가 아직 정착 중일 수 있어 turn.busy(retryable)가 온다.
    // M1 엔진에는 정착을 알리는 포트가 없다(ActivityPort는 task 그래프 변화만 알리고 snapshot은 M1에서 던진다).
    // 그래서 이벤트 루프를 한 바퀴 넘기며 시도 횟수 상한 안에서 다시 시도한다: 전역 시각과 고정 지연을 쓰지 않는다
    const startTurn = async (
      input: string,
      attemptsLeft: number = BUSY_RETRY_LIMIT,
    ): Promise<{ readonly turnId: TurnId }> => {
      try {
        return await connection.request("turn.start", {
          threadId: created.threadId,
          input,
          requestId: host.engine.ports.ids.next("evt"),
        });
      } catch (caught) {
        const busy = caught instanceof WireError && caught.data.kind === "turn.busy";
        if (!busy || attemptsLeft <= 1) throw caught;
        await nextEventLoopTurn();
        return startTurn(input, attemptsLeft - 1);
      }
    };

    // 첫 사용자 turn. 그룹의 scope는 첫 단계 경계에서 켜지고, 그 뒤 유휴가 되면 drive가 임대를 받아 turn을 만든다
    const first = await startTurn("hello");
    const firstEnded = await log.waitFor(turnEnded(first.turnId), "first turn end");
    const driveStarted = await log.waitFor(
      (event) => event.kind === "turn.started" && payloadField(event, "scopeId") === groupId,
      "the drive's turn.started",
    );
    const driveTurnId = driveStarted.turnId;
    if (driveTurnId === null) throw new Error("the drive's turn has no turn id");
    const driveEnded = await log.waitFor(turnEnded(driveTurnId), "the drive turn's end");
    const enabled = log.need(scopeChanged(groupId, "enabled"), "scope enabled");
    const acquired = log.need(isKind("lease.acquired"), "lease.acquired");
    // 유휴 thread의 켜기는 실제 기록 포트로 thread를 열 때 커밋된다(open-issues M-01 이후): 첫 turn보다 앞이다
    expect(enabled.seq).toBeLessThan(firstEnded.seq);
    // drive: 임대는 켜진 뒤에 나오고, 그 임대가 만든 turn이 끝까지 돈다
    expect(enabled.seq).toBeLessThan(acquired.seq);
    expect(acquired.seq).toBeLessThan(driveStarted.seq);
    expect(payloadField(acquired, "scopeId")).toBe(groupId);
    expect(String(payloadField(driveStarted, "requestId"))).toStartWith(
      String(payloadField(acquired, "leaseId")),
    );
    expect(payloadField(driveEnded, "status")).toBe("completed");
    const driveAnswer = log.all(isKind("item.recorded")).map((event) => event.payload);
    expect(JSON.stringify(driveAnswer)).toContain("drive turn answered.");

    // 두 번째 사용자 turn: 도구 호출 지점에서 그룹이 자기 scope 끄기를 요청한다. 같은 단계는 그대로 끝나고,
    // 끄기는 그 단계의 경계에서 적용된다
    const second = await startTurn("read the notes");
    const secondEnded = await log.waitFor(turnEnded(second.turnId), "second turn end");
    const toolResult = log.need(
      (event) => event.kind === "effect.result" && event.turnId === second.turnId,
      "the read result",
    );
    const stepDone = log.need(stepEvent("step.completed", second.turnId, 0), "step 0 end");
    const nextStep = log.need(stepEvent("step.started", second.turnId, 1), "step 1 start");
    const disabled = log.need(scopeChanged(groupId, "disabled"), "scope disabled");
    expect(payloadField(toolResult, "status")).toBe("ok");
    // 도구 호출 단계는 끊기지 않고 끝난다. 끄기는 그 단계가 끝난 뒤, 다음 단계가 시작되기 전에 적용된다
    expect(toolResult.seq).toBeLessThan(stepDone.seq);
    expect(stepDone.seq).toBeLessThan(disabled.seq);
    expect(disabled.seq).toBeLessThan(nextStep.seq);
    // 끄기 요청이 turn을 끊지 않는다
    expect(payloadField(secondEnded, "status")).toBe("completed");
    // 꺼진 그룹은 그 뒤 단계의 boundary.step.after를 보지 않는다. 켜져 있던 동안의 boundary.step.after는 봤다
    expect(group.probe.turnEndSteps).not.toContain(nextStep.stepId);
    expect(group.probe.turnEndSteps.length).toBeGreaterThanOrEqual(2);
  } finally {
    await host.close();
    process.chdir(previousCwd);
    if (previousHome === undefined) delete process.env["XEON_HOME"];
    else process.env["XEON_HOME"] = previousHome;
  }
}, 60_000);

// ── 4. 표시 언어 ─────────────────────────────────────────────────────────

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/u;

test("scenario-4: --set l4.ui.locale=en makes the print turn's messages English, and without it they stay Korean", async () => {
  // 인자 없는 명령은 승인이 필요하고, 글 모드(비대화)라 자동으로 거부된다. 거부 문장이 로케일을 보여 준다
  const english = await runTextChat(newHome(), "chat-locale", [
    "-p",
    "run it",
    "--set",
    "l4.ui.locale=en",
  ]);
  expect(english.code, english.stderr).toBe(0);
  const englishText = `${english.stdout}${english.stderr}`;
  expect(englishText).toContain(
    'Denied approval request "Allow tool "bash"?" because print mode is non-interactive',
  );
  expect(englishText).not.toMatch(HANGUL);

  const korean = await runTextChat(newHome(), "chat-locale", ["-p", "run it"]);
  expect(korean.code, korean.stderr).toBe(0);
  const koreanText = `${korean.stdout}${korean.stderr}`;
  expect(koreanText).toContain('승인 요청 "Allow tool "bash"?"에 비대화 모드라 거부로 답했다');
  expect(koreanText).not.toContain("print mode");
}, 60_000);
