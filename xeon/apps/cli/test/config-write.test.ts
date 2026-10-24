import { afterEach, expect, test } from "bun:test";
import { EXIT } from "../src/exit-codes.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { def, fakeSettings } from "./support/m2.ts";

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

const DEFS = [
  def("l4.cli.theme", { default: "system", range: { enum: ["system", "dark", "light"] } }),
  def("l1.loop.maxSteps", {
    type: { type: "integer" },
    default: 50,
    range: { min: 1, max: 200 },
    runtimeChange: "nextTurn",
    layer: "L1",
  }),
  def("l1.loop.flag", {
    type: { type: "boolean" },
    default: false,
    layer: "L1",
    allowedScopes: ["user"],
  }),
  def("l2.web.search.provider", { default: "auto", layer: "L2" }),
];

function harness(initial: Record<string, unknown> = {}): {
  h: Harness;
  settings: ReturnType<typeof fakeSettings>;
} {
  const settings = fakeSettings(DEFS, initial);
  const h = createHarness({ env: { NO_COLOR: "1" }, server: { handlers: settings.handlers } });
  harnesses.push(h);
  return { h, settings };
}

test("config set reads the value as JSON first, and the scope defaults to user", async () => {
  const { h, settings } = harness();
  expect(await h.run(["config", "set", "l1.loop.maxSteps", "80"])).toBe(EXIT.ok);
  expect(await h.run(["config", "set", "l1.loop.flag", "true"])).toBe(EXIT.ok);
  expect(await h.run(["config", "set", "l4.cli.theme", "dark"])).toBe(EXIT.ok);
  expect(settings.writes.map((w) => [w.key, w.value, w.scope])).toEqual([
    ["l1.loop.maxSteps", 80, "user"],
    ["l1.loop.flag", true, "user"],
    ["l4.cli.theme", "dark", "user"],
  ]);
  expect(h.stdoutText()).toContain("l1.loop.maxSteps = 80");
  expect(h.stdoutText()).toContain("source: user");
});

test("config set --scope project and a JSON string value", async () => {
  const { h, settings } = harness();
  expect(await h.run(["config", "set", "l4.cli.theme", '"light"', "--scope", "project"])).toBe(
    EXIT.ok,
  );
  expect(settings.writes[0]).toMatchObject({ value: "light", scope: "project" });
});

test("config set errors from the host become the §4.10 sentences and codes", async () => {
  const { h } = harness();
  expect(await h.run(["config", "set", "l1.loop.nothing", "1"])).toBe(EXIT.usage);
  expect(h.stderrText()).toContain("등록되지 않은 설정 키: l1.loop.nothing");
  expect(h.stderrText()).toContain("xeon config list");

  const scoped = harness();
  expect(await scoped.h.run(["config", "set", "l1.loop.flag", "true", "--scope", "local"])).toBe(
    EXIT.usage,
  );
  expect(scoped.h.stderrText()).toContain("허용 범위: user");
});

test("config reset clears the value in that scope and prints the value that remains", async () => {
  const { h, settings } = harness({ "l4.cli.theme": "dark" });
  expect(await h.run(["config", "reset", "l4.cli.theme", "--scope", "local"])).toBe(EXIT.ok);
  expect(settings.writes[0]).toMatchObject({
    key: "l4.cli.theme",
    scope: "local",
    value: undefined,
  });
  expect(h.stdoutText()).toContain('l4.cli.theme = "system"');
});

test("config list prints every definition with its value, scopes and range; --prefix narrows it", async () => {
  const { h } = harness({ "l1.loop.maxSteps": 80 });
  expect(await h.run(["config", "list", "--prefix", "l1.loop"])).toBe(EXIT.ok);
  const text = h.stdoutText();
  expect(text).toContain("l1.loop.maxSteps = 80");
  expect(text).toContain("범위: 1..200");
  expect(text).toContain("쓸 수 있는 범위: user, project, local, session");
  expect(text).toContain("l1.loop.flag = false");
  expect(text).not.toContain("l4.cli.theme");
});

test("config list --json pairs each definition with its effective value", async () => {
  const { h } = harness();
  expect(await h.run(["config", "list", "--prefix", "l4.cli", "--json"])).toBe(EXIT.ok);
  const rows: unknown = JSON.parse(h.stdoutText());
  expect(rows).toMatchObject([
    { def: { key: "l4.cli.theme" }, setting: { key: "l4.cli.theme", value: "system" } },
  ]);
});

test("config list reads values in chunks of 256 keys", async () => {
  const many = Array.from({ length: 300 }, (_, index) =>
    def(`l4.cli.k${String(index)}`, { default: index }),
  );
  const settings = fakeSettings(many);
  const h = createHarness({ env: { NO_COLOR: "1" }, server: { handlers: settings.handlers } });
  harnesses.push(h);
  expect(await h.run(["config", "list", "--json"])).toBe(EXIT.ok);
  expect(h.methods().filter((method) => method === "settings.get")).toHaveLength(2);
  const rows: unknown = JSON.parse(h.stdoutText());
  expect(Array.isArray(rows) ? rows.length : -1).toBe(300);
});
