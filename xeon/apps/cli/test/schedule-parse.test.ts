import { expect, test } from "bun:test";
import { parseArgv, type TerminalFacts, type UsageError } from "../src/cli/command.ts";

// M3b B1-SCH2: `xeon schedule add|list|cancel|run`의 인자 파서. 값은 파싱한 모양으로 비교하고, 사용법 오류는 코드와 해결 문구로 비교한다.

const TTY: TerminalFacts = { stdinIsTty: true, stdoutIsTty: true };

function command(argv: readonly string[]): unknown {
  const parsed = parseArgv(argv, TTY, {});
  return parsed.ok ? parsed.value.command : parsed.error.code;
}

function usageOf(argv: readonly string[]): UsageError {
  const parsed = parseArgv(argv, TTY, {});
  if (parsed.ok) throw new Error(`expected a usage error for ${argv.join(" ")}`);
  return parsed.error;
}

const ADD_USAGE = "xeon schedule add <프롬프트>";

test("add with --every parses the seconds, joins the prompt words, and defaults the rest", () => {
  expect(command(["schedule", "add", "--every", "300", "요약", "해줘"])).toEqual({
    kind: "schedule.add",
    prompt: "요약 해줘",
    trigger: { kind: "every", everySeconds: 300 },
    title: null,
    workspace: null,
    disabled: false,
  });
  // 프롬프트 낱말은 플래그 사이에 흩어져도 된다
  expect(command(["schedule", "add", "요약", "--every", "300", "해줘"])).toMatchObject({
    prompt: "요약 해줘",
  });
  // `--` 뒤는 플래그가 아니다
  expect(command(["schedule", "add", "--every", "300", "--", "--dry-run은 아니다"])).toMatchObject({
    prompt: "--dry-run은 아니다",
  });
});

test("add with --at parses the instant with Date.parse", () => {
  expect(command(["schedule", "add", "--at", "2026-11-01T09:00:00+09:00", "점검"])).toMatchObject({
    kind: "schedule.add",
    trigger: { kind: "at", atMs: 1793491200000 },
  });
});

test("add with --remote is the trigger, and a global --remote before the word is still the address", () => {
  expect(command(["schedule", "add", "--remote", "프롬프트"])).toMatchObject({
    kind: "schedule.add",
    prompt: "프롬프트",
    trigger: { kind: "remote" },
  });
  const parsed = parseArgv(["--remote", "unix:/run/xeon.sock", "schedule", "list"], TTY, {});
  expect(parsed.ok && parsed.value.global.remote).toBe("unix:/run/xeon.sock");
  expect(parsed.ok && parsed.value.command).toEqual({
    kind: "schedule.list",
    all: false,
    output: "text",
  });
  const trigger = parseArgv(["schedule", "add", "--remote", "x"], TTY, {});
  expect(trigger.ok && trigger.value.global.remote).toBe(null);
});

test("add with --watch splits the paths, trims them, and defaults the debounce to 1000 ms", () => {
  expect(command(["schedule", "add", "--watch", "src, docs", "정리한다"])).toEqual({
    kind: "schedule.add",
    prompt: "정리한다",
    trigger: { kind: "watch", paths: ["src", "docs"], debounceMs: 1000 },
    title: null,
    workspace: null,
    disabled: false,
  });
  expect(
    command(["schedule", "add", "--watch", "src", "--debounce", "0", "정리한다"]),
  ).toMatchObject({ trigger: { kind: "watch", paths: ["src"], debounceMs: 0 } });
});

test("add with --loop needs --max-iterations and --expires-in and keeps them as given", () => {
  expect(
    command([
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
  ).toMatchObject({
    kind: "schedule.add",
    prompt: "반복",
    trigger: { kind: "loop", intervalSeconds: 60, maxIterations: 5, expiresInSeconds: 3600 },
  });
  expect(
    command([
      "schedule",
      "add",
      "--loop",
      "0",
      "--max-iterations",
      "10000",
      "--expires-in",
      "1",
      "반복",
    ]),
  ).toMatchObject({
    trigger: { kind: "loop", intervalSeconds: 0, maxIterations: 10000, expiresInSeconds: 1 },
  });
});

test("add takes --title, --workspace and --disabled as they are", () => {
  expect(
    command([
      "schedule",
      "add",
      "--every",
      "300",
      "--title",
      "  주간 요약  ",
      "--workspace",
      "../other",
      "--disabled",
      "요약",
    ]),
  ).toEqual({
    kind: "schedule.add",
    prompt: "요약",
    trigger: { kind: "every", everySeconds: 300 },
    title: "주간 요약",
    workspace: "../other",
    disabled: true,
  });
});

test("add without a trigger, with two triggers, or without a prompt is a usage error", () => {
  const none = usageOf(["schedule", "add", "요약"]);
  expect(none.code).toBe("missingArgument");
  expect(none.message).toBe(
    "예약 트리거가 없다 (--every, --at, --remote, --watch, --loop 가운데 하나)",
  );
  expect(none.fix).toContain(ADD_USAGE);

  const two = usageOf(["schedule", "add", "요약", "--every", "300", "--remote"]);
  expect(two.code).toBe("conflictingFlags");
  expect(two.message).toBe("트리거 플래그를 둘 쓸 수 없다 (--every, --remote)");
  expect(two.fix).toBe("--every, --at, --remote, --watch, --loop 가운데 하나만 쓴다");

  const noPrompt = usageOf(["schedule", "add", "--every", "300"]);
  expect(noPrompt.code).toBe("missingArgument");
  expect(noPrompt.message).toBe("예약 프롬프트가 없다");
  expect(noPrompt.fix).toContain(ADD_USAGE);

  expect(command(["schedule", "add", "   ", "--every", "300"])).toBe("missingArgument");
});

test("a non-integer or out-of-range --every is a usage error that names the flag", () => {
  for (const value of ["0", "abc", "1.5", "-1", "31536001", "1e3"]) {
    const error = usageOf(["schedule", "add", "요약", "--every", value]);
    expect(error.code).toBe("unexpectedArgument");
    expect(error.message).toBe("--every 값이 맞지 않다 (1 이상 31536000 이하의 정수)");
    expect(error.fix).toBe("--every <값>으로 쓴다");
  }
  // 300초 미만은 여기서 막지 않는다. 최소 간격은 host가 `interval_too_short`로 거부한다
  expect(command(["schedule", "add", "요약", "--every", "5"])).toMatchObject({
    trigger: { kind: "every", everySeconds: 5 },
  });
});

test("an unreadable --at is a usage error", () => {
  const error = usageOf(["schedule", "add", "요약", "--at", "내일 아침"]);
  expect(error.code).toBe("unexpectedArgument");
  expect(error.message).toBe("--at 시각을 읽지 못했다");
  expect(error.fix).toBe("RFC 3339 형식으로 쓴다 (예: 2026-11-01T09:00:00+09:00)");
});

test("a bad --watch list is a usage error: empty path, empty item, or more than 16 paths", () => {
  expect(usageOf(["schedule", "add", "요약", "--watch", ""]).code).toBe("unexpectedArgument");
  expect(usageOf(["schedule", "add", "요약", "--watch", "a,,b"]).code).toBe("unexpectedArgument");
  const seventeen = Array.from({ length: 17 }, (_, index) => `p${String(index)}`).join(",");
  const error = usageOf(["schedule", "add", "요약", "--watch", seventeen]);
  expect(error.code).toBe("unexpectedArgument");
  expect(error.message).toBe("--watch 경로가 맞지 않다 (1~16개, 빈 경로 없이 쉼표로 나눈다)");
  const sixteen = Array.from({ length: 16 }, (_, index) => `p${String(index)}`).join(",");
  expect(command(["schedule", "add", "요약", "--watch", sixteen])).toMatchObject({
    trigger: { kind: "watch" },
  });
});

test("--debounce without --watch, and --debounce out of range, are usage errors", () => {
  const alone = usageOf(["schedule", "add", "요약", "--every", "300", "--debounce", "500"]);
  expect(alone.code).toBe("conflictingFlags");
  expect(alone.message).toBe("--debounce는 --watch와 함께 쓴다");
  const negative = usageOf(["schedule", "add", "요약", "--watch", "src", "--debounce", "-1"]);
  expect(negative.code).toBe("unexpectedArgument");
  expect(negative.message).toBe("--debounce 값이 맞지 않다 (0 이상 3600000 이하의 정수)");
});

test("--loop needs both caps, --max-iterations and --expires-in belong to --loop, and both are bounded", () => {
  const missing = usageOf(["schedule", "add", "요약", "--loop", "60"]);
  expect(missing.code).toBe("missingArgument");
  expect(missing.message).toBe("--loop에는 --max-iterations와 --expires-in이 필요하다");
  expect(missing.fix).toBe(
    "xeon schedule add <프롬프트> --loop <초> --max-iterations <n> --expires-in <초>",
  );
  expect(usageOf(["schedule", "add", "요약", "--loop", "60", "--max-iterations", "5"]).code).toBe(
    "missingArgument",
  );

  const zero = usageOf([
    "schedule",
    "add",
    "요약",
    "--loop",
    "60",
    "--max-iterations",
    "0",
    "--expires-in",
    "3600",
  ]);
  expect(zero.code).toBe("unexpectedArgument");
  expect(zero.message).toBe("--max-iterations 값이 맞지 않다 (1 이상 10000 이하의 정수)");

  const tooMany = usageOf([
    "schedule",
    "add",
    "요약",
    "--loop",
    "60",
    "--max-iterations",
    "10001",
    "--expires-in",
    "3600",
  ]);
  expect(tooMany.code).toBe("unexpectedArgument");

  const expires = usageOf([
    "schedule",
    "add",
    "요약",
    "--loop",
    "60",
    "--max-iterations",
    "5",
    "--expires-in",
    "0",
  ]);
  expect(expires.code).toBe("unexpectedArgument");
  expect(expires.message).toBe("--expires-in 값이 맞지 않다 (1 이상 31536000 이하의 정수)");

  const stray = usageOf(["schedule", "add", "요약", "--every", "300", "--max-iterations", "5"]);
  expect(stray.code).toBe("conflictingFlags");
  expect(stray.message).toBe("--max-iterations와 --expires-in은 --loop와 함께 쓴다");
  expect(usageOf(["schedule", "add", "요약", "--every", "300", "--expires-in", "60"]).code).toBe(
    "conflictingFlags",
  );
});

test("a blank --title, a 201-character --title, and an empty --workspace are usage errors", () => {
  const blank = usageOf(["schedule", "add", "요약", "--every", "300", "--title", "  "]);
  expect(blank.code).toBe("missingArgument");
  expect(blank.message).toBe("--title: 제목이 비어 있다");
  const long = usageOf(["schedule", "add", "요약", "--every", "300", "--title", "가".repeat(201)]);
  expect(long.code).toBe("unexpectedArgument");
  expect(long.message).toBe("--title: 제목이 너무 길다 (200자 이하)");
  const workspace = usageOf(["schedule", "add", "요약", "--every", "300", "--workspace", ""]);
  expect(workspace.code).toBe("missingArgument");
  expect(workspace.message).toBe("--workspace에 폴더가 없다");
});

test("add takes no approval flag and no --json: both are unknown flags", () => {
  expect(command(["schedule", "add", "요약", "--every", "300", "--auto-approve"])).toBe(
    "unknownFlag",
  );
  expect(command(["schedule", "add", "요약", "--every", "300", "--json"])).toBe("unknownFlag");
});

test("a repeated trigger flag is a conflict", () => {
  expect(command(["schedule", "add", "요약", "--every", "300", "--every", "600"])).toBe(
    "conflictingFlags",
  );
});

test("list parses --all and --json and rejects positional words", () => {
  expect(command(["schedule", "list"])).toEqual({
    kind: "schedule.list",
    all: false,
    output: "text",
  });
  expect(command(["schedule", "list", "--all", "--json"])).toEqual({
    kind: "schedule.list",
    all: true,
    output: "json",
  });
  const extra = usageOf(["schedule", "list", "x"]);
  expect(extra.code).toBe("unexpectedArgument");
  expect(extra.fix).toBe("xeon schedule list [--all] [--json]");
  expect(command(["schedule", "list", "--bogus"])).toBe("unknownFlag");
});

test("cancel and run take exactly one schedule id", () => {
  expect(command(["schedule", "cancel", "sch_abc123"])).toEqual({
    kind: "schedule.cancel",
    scheduleId: "sch_abc123",
  });
  expect(command(["schedule", "run", "sch_abc123"])).toEqual({
    kind: "schedule.run",
    scheduleId: "sch_abc123",
  });
  expect(usageOf(["schedule", "cancel"]).code).toBe("missingArgument");
  expect(usageOf(["schedule", "run"]).message).toBe("schedule run에는 예약 id가 필요하다");
  expect(usageOf(["schedule", "cancel", "nope"]).code).toBe("invalidScheduleId");
  expect(usageOf(["schedule", "cancel", "nope"]).fix).toBe(
    "xeon schedule list --all로 sch_로 시작하는 id를 확인한다",
  );
  expect(command(["schedule", "cancel", "sch_a", "sch_b"])).toBe("unexpectedArgument");
});

test("schedule without a known subcommand is a usage error", () => {
  expect(usageOf(["schedule"]).code).toBe("missingArgument");
  expect(usageOf(["schedule", "frob"]).code).toBe("unknownCommand");
  expect(usageOf(["schedule", "frob"]).message).toBe("모르는 명령 schedule frob");
});
