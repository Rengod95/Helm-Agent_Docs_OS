import { afterEach, expect, test } from "bun:test";
import type { UsageGauge } from "@fresnel/contracts/wire";
import { EXIT } from "../src/exit-codes.ts";
import { tallyOf } from "../src/commands/usage.ts";
import { parseArgv } from "../src/cli/command.ts";
import { assistantItem, turnCompleted, userItem } from "./support/events.ts";
import type { TurnContext } from "./support/fake-server.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { threadId } from "./support/ids.ts";

// `fresnel usage [--thread <id>] [--json]`와 `chat -p`가 끝에 stderr로 내는 사용량 한 줄(--quiet이면 없다).

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

function harness(options: Parameters<typeof createHarness>[0] = {}): Harness {
  const created = createHarness({ env: { NO_COLOR: "1" }, ...options });
  harnesses.push(created);
  return created;
}

function gauge(providerId: string, unit: UsageGauge["unit"], used: number): UsageGauge {
  return {
    id: `${providerId}::session:${unit}`,
    providerId,
    account: null,
    window: "session",
    unit,
    used,
    limit: null,
    resetsAt: null,
  };
}

const GAUGES: readonly UsageGauge[] = [
  gauge("anthropic", "tokens", 12_345),
  gauge("anthropic", "usd", 0.0123456),
  gauge("anthropic", "requests", 3),
  gauge("anthropic", "cacheRead", 1000),
  gauge("anthropic", "cacheWrite", 20),
];

const TERMINAL = { stdinIsTty: true, stdoutIsTty: false, stderrIsTty: false, columns: null };

test("usage parses --thread and --json, and rejects a bad thread id and stray arguments", () => {
  const parsed = parseArgv(["usage", "--thread", threadId(1), "--json"], TERMINAL, {});
  expect(parsed.ok ? parsed.value.command : null).toEqual({
    kind: "usage",
    threadId: threadId(1),
    output: "json",
  });
  const bare = parseArgv(["usage"], TERMINAL, {});
  expect(bare.ok ? bare.value.command : null).toEqual({
    kind: "usage",
    threadId: null,
    output: "text",
  });
  const bad = parseArgv(["usage", "--thread", "nope"], TERMINAL, {});
  expect(bad.ok ? null : bad.error.code).toBe("invalidThreadId");
  const stray = parseArgv(["usage", "extra"], TERMINAL, {});
  expect(stray.ok ? null : stray.error.code).toBe("unexpectedArgument");
});

test("chat parses --quiet", () => {
  const parsed = parseArgv(["chat", "-p", "x", "--quiet"], TERMINAL, {});
  expect(parsed.ok ? parsed.value.command : null).toMatchObject({ kind: "chat", quiet: true });
});

test("tallyOf adds the session gauges per provider and in total, and skips other windows", () => {
  const month: UsageGauge = { ...gauge("anthropic", "tokens", 999), window: "month" };
  expect(
    tallyOf([...GAUGES, gauge("openai", "tokens", 5), gauge("openai", "requests", 1), month]),
  ).toEqual({
    providers: [
      [
        "anthropic",
        { tokens: 12_345, usd: 0.0123456, requests: 3, cacheRead: 1000, cacheWrite: 20 },
      ],
      ["openai", { tokens: 5, usd: 0, requests: 1, cacheRead: 0, cacheWrite: 0 }],
    ],
    total: { tokens: 12_350, usd: 0.0123456, requests: 4, cacheRead: 1000, cacheWrite: 20 },
  });
});

test("usage without a thread asks for all conversations and prints one line per provider", async () => {
  const seen: unknown[] = [];
  const h = harness({
    server: {
      handlers: {
        "usage.get": (params) => {
          seen.push(params);
          return { gauges: GAUGES, asOf: "2026-11-07T00:00:00.000Z" };
        },
      },
    },
  });
  expect(await h.run(["usage"])).toBe(EXIT.ok);
  expect(seen).toEqual([{}]);
  expect(h.stdoutText()).toBe(
    [
      "모든 대화의 사용량 (2026-11-07T00:00:00.000Z 기준)",
      "  anthropic  토큰 12,345 · 비용 $0.0123 · 호출 3회 · 캐시 읽기 1,000 · 캐시 쓰기 20",
      "",
    ].join("\n"),
  );
  expect(h.closed()).toBe(true);
});

test("usage --thread sends the thread id and shows the context line", async () => {
  const seen: unknown[] = [];
  const h = harness({
    server: {
      handlers: {
        "usage.get": (params) => {
          seen.push(params);
          return {
            gauges: GAUGES,
            asOf: "2026-11-07T00:00:00.000Z",
            context: { model: "anthropic/claude-haiku-5-5", used: 2000, limit: 200_000 },
          };
        },
      },
    },
  });
  expect(await h.run(["usage", "--thread", threadId(1)])).toBe(EXIT.ok);
  expect(seen).toEqual([{ threadId: threadId(1) }]);
  const lines = h.stdoutText().trimEnd().split("\n");
  expect(lines[0]).toBe(`대화 ${threadId(1)}의 사용량 (2026-11-07T00:00:00.000Z 기준)`);
  expect(lines.at(-1)).toBe("문맥: anthropic/claude-haiku-5-5 2,000 / 200,000 토큰");
});

test("usage --json prints the wire result as it is", async () => {
  const result = { gauges: GAUGES, asOf: "2026-11-07T00:00:00.000Z" };
  const h = harness({ server: { handlers: { "usage.get": () => result } } });
  expect(await h.run(["usage", "--json"])).toBe(EXIT.ok);
  expect(JSON.parse(h.stdoutText())).toEqual(result);
});

test("usage with no recorded gauges says so", async () => {
  const h = harness({
    server: { handlers: { "usage.get": () => ({ gauges: [], asOf: "2026-11-07T00:00:00.000Z" }) } },
  });
  expect(await h.run(["usage"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toBe("기록된 사용량이 없다\n");
});

function answer(text: string): (context: TurnContext) => void {
  return (context) => {
    context.server.commit(context.threadId, [
      userItem(context.turnId, 1, "hello"),
      assistantItem(context.turnId, 2, { text }),
      turnCompleted(context.turnId),
    ]);
  };
}

test("chat -p ends with one usage line on stderr and keeps stdout as the answer", async () => {
  const seen: unknown[] = [];
  const h = harness({
    server: {
      onTurn: answer("안녕하세요"),
      handlers: {
        "usage.get": (params) => {
          seen.push(params);
          return { gauges: GAUGES, asOf: "2026-11-07T00:00:00.000Z" };
        },
      },
    },
  });
  expect(await h.run(["chat", "-p", "hello"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toBe("안녕하세요\n");
  expect(h.stderrText()).toBe("사용량: 토큰 12,345 · 비용 $0.0123 · 호출 3회\n");
  expect(seen).toHaveLength(1);
});

test("chat -p --quiet does not ask for or write the usage line", async () => {
  const seen: unknown[] = [];
  const h = harness({
    server: {
      onTurn: answer("안녕하세요"),
      handlers: {
        "usage.get": (params) => {
          seen.push(params);
          return { gauges: GAUGES, asOf: "2026-11-07T00:00:00.000Z" };
        },
      },
    },
  });
  expect(await h.run(["chat", "-p", "hello", "--quiet"])).toBe(EXIT.ok);
  expect(h.stderrText()).toBe("");
  expect(seen).toEqual([]);
});

test("chat -p against an engine without usage.get writes no usage line", async () => {
  const h = harness({ server: { onTurn: answer("안녕하세요") } });
  expect(await h.run(["chat", "-p", "hello"])).toBe(EXIT.ok);
  expect(h.stderrText()).toBe("");
});
