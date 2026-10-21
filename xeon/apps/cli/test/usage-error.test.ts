import { afterEach, expect, test } from "bun:test";
import { EXIT } from "../src/exit-codes.ts";
import { createHarness, type Harness } from "./support/harness.ts";

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

function harness(options: Parameters<typeof createHarness>[0] = {}): Harness {
  const created = createHarness(options);
  harnesses.push(created);
  return created;
}

const CASES: readonly (readonly string[])[] = [
  ["frobnicate"],
  ["chat", "--nope"],
  ["chat", "--resume"],
  ["chat", "stray"],
  ["chat", "--set", "bad"],
  ["chat", "--resume", "nope"],
  ["secret", "add", "api-key", "value"],
  ["secret", "add", "BAD"],
  ["chat", "--continue", "--resume", "thr_00000000000000000000000001"],
  ["chat", "--json"],
  ["config", "schema"],
  ["config", "set", "l4.cli.theme"],
];

test("every usage error is two lines (what, fix) and exits 2 (AC12)", async () => {
  await Promise.all(
    CASES.map(async (argv) => {
      const h = harness({ terminal: { stdinIsTty: true, stdoutIsTty: true } });
      const code = await h.run(argv);
      expect(code).toBe(EXIT.usage);
      const lines = h.stderrText().split("\n");
      expect(lines).toHaveLength(3);
      expect(lines[0]).toMatch(/^xeon: .+/);
      expect(lines[1]).toMatch(/^ {2}해결: .+/);
      expect(lines[2]).toBe("");
      expect(h.stdoutText()).toBe("");
      expect(h.closed()).toBe(false);
    }),
  );
});
