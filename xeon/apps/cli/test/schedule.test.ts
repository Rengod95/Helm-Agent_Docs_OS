import { afterEach, expect, test } from "bun:test";
import { EXIT, type ExitCode } from "../src/exit-codes.ts";
import type { FakeHandlers } from "./support/fake-server.ts";
import { createHarness, type Harness } from "./support/harness.ts";

// M3b B1-SCH2: `xeon schedule`의 명령 실행. 가짜 호스트가 schedule.create·list·cancel·fire를 받아 돌려주는 값으로 문구와 종료 코드를 확인한다.
// 보낸 params는 서버가 받은 요청 목록(`requests`)으로 본다. 실제 처리기와의 종단 시험은 schedule-host.int.test.ts가 한다.

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

const TTY = { stdinIsTty: true, stdoutIsTty: true, columns: 80 } as const;
/** harness의 manualClock 시작 시각(2026-01-05T00:00:00.000Z) */
const NOW = 1_767_571_200_000;
const ROOT = "/work/project";

function harness(handlers: FakeHandlers = {}): Harness {
  const h = createHarness({ terminal: TTY, env: { NO_COLOR: "1" }, server: { handlers } });
  harnesses.push(h);
  return h;
}

type Params = Readonly<Record<string, unknown>>;

/** 만들어진 항목. 실제 host가 돌려주는 모양과 같고, 다음 기한만 시험이 정한다 */
function createdWith(
  nextDueAt: number | null,
  warnings: readonly "service_mode_off"[] = [],
): (params: Params) => unknown {
  return (params) => ({
    ok: true,
    entry: {
      id: "sch_1",
      trigger: params["trigger"],
      prompt: params["prompt"],
      workspace: typeof params["workspace"] === "string" ? params["workspace"] : null,
      title: typeof params["title"] === "string" ? params["title"] : null,
      sessionKind: "cron",
      enabled: params["enabled"] !== false,
      createdAt: NOW,
      nextDueAt,
      lastStartedAt: null,
      iterations: 0,
      stoppedReason: null,
    },
    warnings,
  });
}

function createdSent(h: Harness): unknown[] {
  return h
    .server()
    .requests.filter((request) => request.method === "schedule.create")
    .map((r) => r.params);
}

test("add --every sends an interval trigger and prints the id, the trigger and the next run", async () => {
  const h = harness({ "schedule.create": createdWith(NOW + 300_000) });
  expect(await h.run(["schedule", "add", "--every", "300", "요약", "해줘"])).toBe(EXIT.ok);
  expect(createdSent(h)).toEqual([
    { trigger: { kind: "interval", everySeconds: 300 }, prompt: "요약 해줘" },
  ]);
  expect(h.stdoutText()).toBe("예약했다: sch_1  간격 300초  다음 실행 2026-01-05T00:05:00.000Z\n");
  expect(h.stderrText()).toBe("");
});

test("add --at sends the parsed instant, and the next run is that instant", async () => {
  const h = harness({ "schedule.create": createdWith(1793491200000) });
  expect(await h.run(["schedule", "add", "--at", "2026-11-01T09:00:00+09:00", "점검"])).toBe(
    EXIT.ok,
  );
  expect(createdSent(h)).toEqual([
    { trigger: { kind: "at", atMs: 1793491200000 }, prompt: "점검" },
  ]);
  expect(h.stdoutText()).toBe(
    "예약했다: sch_1  시각 2026-11-01T00:00:00.000Z  다음 실행 2026-11-01T00:00:00.000Z\n",
  );
});

test("add --remote sends the remote trigger and has no next run", async () => {
  const h = harness({ "schedule.create": createdWith(null) });
  expect(await h.run(["schedule", "add", "--remote", "나중에 실행"])).toBe(EXIT.ok);
  expect(createdSent(h)).toEqual([{ trigger: { kind: "remote" }, prompt: "나중에 실행" }]);
  expect(h.stdoutText()).toBe("예약했다: sch_1  원격  다음 실행 없음\n");
});

test("add --watch resolves the paths against the workspace and passes the debounce", async () => {
  const h = harness({ "schedule.create": createdWith(null) });
  expect(
    await h.run(["schedule", "add", "--watch", "src,/abs/docs", "--debounce", "500", "정리"]),
  ).toBe(EXIT.ok);
  expect(createdSent(h)).toEqual([
    {
      trigger: { kind: "file_watch", paths: [`${ROOT}/src`, "/abs/docs"], debounceMs: 500 },
      prompt: "정리",
    },
  ]);
  expect(h.stdoutText()).toBe(
    "예약했다: sch_1  감시 /work/project/src, /abs/docs (디바운스 500ms)  다음 실행 없음\n",
  );
});

test("add --watch without --debounce uses 1000 ms", async () => {
  const h = harness({ "schedule.create": createdWith(null) });
  expect(await h.run(["schedule", "add", "--watch", "src", "정리"])).toBe(EXIT.ok);
  expect(createdSent(h)).toEqual([
    { trigger: { kind: "file_watch", paths: [`${ROOT}/src`], debounceMs: 1000 }, prompt: "정리" },
  ]);
});

test("add --loop turns the expires-in seconds into expiresAtMs from the clock", async () => {
  const h = harness({ "schedule.create": createdWith(NOW) });
  expect(
    await h.run([
      "schedule",
      "add",
      "--loop",
      "60",
      "--max-iterations",
      "5",
      "--expires-in",
      "3600",
      "반복",
    ]),
  ).toBe(EXIT.ok);
  expect(createdSent(h)).toEqual([
    {
      trigger: {
        kind: "loop",
        intervalSeconds: 60,
        maxIterations: 5,
        expiresAtMs: 1767574800000,
      },
      prompt: "반복",
    },
  ]);
  expect(h.stdoutText()).toBe(
    "예약했다: sch_1  루프 60초 간격, 최대 5회, 만료 2026-01-05T01:00:00.000Z  다음 실행 2026-01-05T00:00:00.000Z\n",
  );
});

test("title, workspace and --disabled are sent only when given", async () => {
  const h = harness({ "schedule.create": createdWith(null) });
  expect(
    await h.run([
      "schedule",
      "add",
      "--every",
      "300",
      "--title",
      "주간 요약",
      "--workspace",
      "sub",
      "--disabled",
      "요약",
    ]),
  ).toBe(EXIT.ok);
  expect(createdSent(h)).toEqual([
    {
      trigger: { kind: "interval", everySeconds: 300 },
      prompt: "요약",
      title: "주간 요약",
      workspace: `${ROOT}/sub`,
      enabled: false,
    },
  ]);
});

test("a host outside service mode saves the entry and the warning goes to stderr", async () => {
  const h = harness({ "schedule.create": createdWith(NOW + 300_000, ["service_mode_off"]) });
  expect(await h.run(["schedule", "add", "--every", "300", "요약"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toBe("예약했다: sch_1  간격 300초  다음 실행 2026-01-05T00:05:00.000Z\n");
  expect(h.stderrText()).toBe(
    "경고: 서비스 모드가 꺼져 있어 이 예약은 실행되지 않는다. xeon service start로 서비스를 띄운 뒤에 실행된다\n",
  );
});

const CREATE_ERRORS: readonly {
  readonly kind: string;
  readonly error: Record<string, unknown>;
  readonly stderr: string;
  readonly code: ExitCode;
}[] = [
  {
    kind: "interval_too_short",
    error: { kind: "interval_too_short", minSeconds: 300 },
    stderr: "xeon: 간격이 최소값(300초)보다 짧다\n  해결: --every를 300 이상으로 쓴다\n",
    code: EXIT.error,
  },
  {
    kind: "at_in_past",
    error: { kind: "at_in_past" },
    stderr: "xeon: 시각이 이미 지났다\n  해결: --at에 앞으로의 시각을 쓴다\n",
    code: EXIT.error,
  },
  {
    kind: "invalid_trigger",
    error: { kind: "invalid_trigger", reason: "watch paths" },
    stderr:
      "xeon: 트리거 값이 엔진 규칙에 맞지 않다 (watch paths)\n  해결: xeon help schedule로 트리거 규칙을 확인한다\n",
    code: EXIT.error,
  },
  {
    kind: "limit_reached",
    error: { kind: "limit_reached", max: 50 },
    stderr:
      "xeon: 켜진 예약이 상한(50개)이라 더 만들 수 없다\n  해결: xeon schedule list로 예약을 보고 필요 없는 것은 xeon schedule cancel <id>로 끈다\n",
    code: EXIT.error,
  },
  {
    kind: "store_failed",
    error: { kind: "store_failed", message: "EACCES /secret/path" },
    stderr:
      "xeon: 예약 상태 파일을 읽거나 쓰지 못했다\n  해결: 상태 디렉터리의 schedule/state.json을 고치거나 지운다. 지우면 예약이 모두 사라진다\n",
    code: EXIT.environment,
  },
];

test.each(CREATE_ERRORS)(
  "create error $kind has its own line and exit code, and the host message is not echoed",
  async (scenario) => {
    const h = harness({ "schedule.create": () => ({ ok: false, error: scenario.error }) });
    expect(await h.run(["schedule", "add", "--every", "60", "요약"])).toBe(scenario.code);
    expect(h.stdoutText()).toBe("");
    expect(h.stderrText()).toBe(scenario.stderr);
    expect(h.stderrText()).not.toContain("EACCES");
  },
);

test("list shows the enabled entries by default, one line each, and --all asks for every entry", async () => {
  const on = {
    entry: {
      id: "sch_a1",
      trigger: { kind: "interval", everySeconds: 300 },
      prompt:
        "매일 아침 요약을 만든다.\n  항목을 나눠 정리하고 그리고 길게 이어진다 끝까지 더 쓴다",
      workspace: null,
      title: null,
      sessionKind: "cron",
      enabled: true,
      createdAt: NOW,
      nextDueAt: NOW + 300_000,
      lastStartedAt: null,
      iterations: 0,
      stoppedReason: null,
    },
    lastRun: null,
  };
  const off = {
    entry: {
      id: "sch_b2",
      trigger: { kind: "at", atMs: 1793491200000 },
      prompt: "점검",
      workspace: null,
      title: "주간 요약",
      sessionKind: "cron",
      enabled: false,
      createdAt: NOW,
      nextDueAt: null,
      lastStartedAt: NOW,
      iterations: 1,
      stoppedReason: "cancelled",
    },
    lastRun: {
      runId: "run_1",
      scheduleId: "sch_b2",
      firedBy: "at",
      dueAt: 1793491200000,
      claimedAt: NOW,
      missed: false,
      status: "finished",
      threadId: "thr_x",
      startedAt: NOW,
      endedAt: NOW,
      outcome: "completed",
      reason: null,
      skippedCount: 0,
    },
  };
  const handlers: FakeHandlers = {
    "schedule.list": (params) => ({
      ok: true,
      items: params["enabled"] === true ? [on] : [on, off],
    }),
  };
  const h = harness(handlers);
  expect(await h.run(["schedule", "list"])).toBe(EXIT.ok);
  expect(h.server().requests.at(-1)?.params).toEqual({ enabled: true });
  // 제목이 없으면 프롬프트의 앞 40자를 쓴다. 줄바꿈과 연속 공백은 한 칸으로 줄어든다
  const line =
    "sch_a1  on  간격 300초  다음 2026-01-05T00:05:00.000Z  마지막 없음  매일 아침 요약을 만든다. 항목을 나눠 정리하고 그리고 길게 이어진다 끝";
  expect(h.stdoutText()).toBe(`${line}\n`);

  h.stdout.length = 0;
  expect(await h.run(["schedule", "list", "--all"])).toBe(EXIT.ok);
  expect(h.server().requests.at(-1)?.params).toEqual({});
  expect(h.stdoutText().split("\n")).toEqual([
    line,
    "sch_b2  off  시각 2026-11-01T00:00:00.000Z  다음 -  마지막 finished/completed 2026-01-05T00:00:00.000Z  주간 요약",
    "",
  ]);
  expect(h.stderrText()).toBe("");
});

test("list --json prints the items array as pretty JSON", async () => {
  const item = {
    entry: {
      id: "sch_r1",
      trigger: { kind: "remote" },
      prompt: "원격",
      workspace: null,
      title: null,
      sessionKind: "cron",
      enabled: true,
      createdAt: NOW,
      nextDueAt: null,
      lastStartedAt: null,
      iterations: 0,
      stoppedReason: null,
    },
    lastRun: null,
  };
  const h = harness({ "schedule.list": () => ({ ok: true, items: [item] }) });
  expect(await h.run(["schedule", "list", "--json"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toBe(`${JSON.stringify([item], null, 2)}\n`);
  expect(h.stderrText()).toBe("");
});

test("an empty list says so on stderr; --json still prints an empty array", async () => {
  const h = harness({ "schedule.list": () => ({ ok: true, items: [] }) });
  expect(await h.run(["schedule", "list"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toBe("");
  expect(h.stderrText()).toBe("예약이 없다\n");

  const json = harness({ "schedule.list": () => ({ ok: true, items: [] }) });
  expect(await json.run(["schedule", "list", "--json"])).toBe(EXIT.ok);
  expect(json.stdoutText()).toBe("[]\n");
  expect(json.stderrText()).toBe("예약이 없다\n");
});

test("cancel prints the id it turned off, and a missing id is a failure", async () => {
  const handlers: FakeHandlers = {
    "schedule.cancel": (params) =>
      params["scheduleId"] === "sch_a1"
        ? {
            ok: true,
            entry: {
              id: "sch_a1",
              trigger: { kind: "remote" },
              prompt: "x",
              workspace: null,
              title: null,
              sessionKind: "cron",
              enabled: false,
              createdAt: NOW,
              nextDueAt: null,
              lastStartedAt: null,
              iterations: 0,
              stoppedReason: "cancelled",
            },
          }
        : { ok: false, error: { kind: "not_found" } },
  };
  const h = harness(handlers);
  expect(await h.run(["schedule", "cancel", "sch_a1"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toBe("껐다: sch_a1\n");
  expect(h.server().requests.at(-1)).toEqual({
    method: "schedule.cancel",
    params: { scheduleId: "sch_a1" },
  });

  const missing = await h.run(["schedule", "cancel", "sch_zz9"]);
  expect(missing).toBe(EXIT.error);
  expect(h.stderrText()).toBe(
    "xeon: 그런 예약이 없다\n  해결: xeon schedule list --all로 id를 확인한다\n",
  );
});

test("run prints the run id and status of a remote entry; other kinds are refused with their message", async () => {
  const run = {
    runId: "run_1",
    scheduleId: "sch_r1",
    firedBy: "remote",
    dueAt: NOW,
    claimedAt: NOW,
    missed: false,
    status: "started",
    threadId: "thr_x",
    startedAt: NOW,
    endedAt: null,
    outcome: null,
    reason: null,
    skippedCount: 0,
  };
  const handlers: FakeHandlers = {
    "schedule.fire": (params) => {
      if (params["scheduleId"] === "sch_r1") return { ok: true, run };
      if (params["scheduleId"] === "sch_a1") return { ok: false, error: { kind: "not_remote" } };
      if (params["scheduleId"] === "sch_d1") return { ok: false, error: { kind: "disabled" } };
      return { ok: false, error: { kind: "not_found" } };
    },
  };
  const h = harness(handlers);
  expect(await h.run(["schedule", "run", "sch_r1"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toBe("실행했다: sch_r1  run run_1  started\n");

  h.stdout.length = 0;
  expect(await h.run(["schedule", "run", "sch_a1"])).toBe(EXIT.error);
  expect(h.stdoutText()).toBe("");
  expect(h.stderrText()).toBe(
    "xeon: 원격 트리거 예약만 지금 실행할 수 있다\n  해결: 간격·시각 예약은 기한이 되면 실행된다. 원격 예약은 xeon schedule add --remote로 만든다\n",
  );

  h.stderr.length = 0;
  expect(await h.run(["schedule", "run", "sch_d1"])).toBe(EXIT.error);
  expect(h.stderrText()).toBe(
    "xeon: 꺼진 예약이라 실행하지 않는다\n  해결: xeon schedule add로 새 예약을 만든다\n",
  );
});

test("a host without the schedule methods is an environment problem for every schedule command", async () => {
  const h = harness({});
  const add = await h.run(["schedule", "add", "--every", "300", "요약"]);
  const list = await h.run(["schedule", "list"]);
  const cancel = await h.run(["schedule", "cancel", "sch_a1"]);
  const run = await h.run(["schedule", "run", "sch_a1"]);
  expect([add, list, cancel, run]).toEqual([
    EXIT.environment,
    EXIT.environment,
    EXIT.environment,
    EXIT.environment,
  ]);
  expect(h.stderrText()).toBe(
    "xeon: 연결한 host가 예약 명령을 아직 지원하지 않는다\n  해결: host를 갱신한다 (xeon version으로 버전을 확인한다)\n".repeat(
      4,
    ),
  );
  expect(h.methods().filter((method) => method.startsWith("schedule."))).toEqual([]);
});

test("a usage error prints the usage line and sends nothing", async () => {
  const h = harness({ "schedule.create": createdWith(null) });
  expect(await h.run(["schedule", "add", "요약"])).toBe(EXIT.usage);
  expect(h.stderrText()).toBe(
    "xeon: 예약 트리거가 없다 (--every, --at, --remote, --watch, --loop 가운데 하나)\n  해결: xeon schedule add <프롬프트> (--every <초> | --at <시각> | --remote | --watch <경로>[,<경로>…] | --loop <초> --max-iterations <n> --expires-in <초>) [--title <제목>] [--workspace <폴더>] [--disabled]\n",
  );
  // 사용법 오류는 엔진에 연결하기 전에 끝난다
  expect(h.methods()).toEqual([]);
});
