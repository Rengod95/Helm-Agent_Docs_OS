import { afterEach, expect, test } from "bun:test";
import { wireError } from "@fresnel/contracts/wire";
import { failureOfWire } from "../src/errors.ts";
import { EXIT } from "../src/exit-codes.ts";
import type { FakeHandlers } from "./support/fake-server.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { threadId } from "./support/ids.ts";
import { def, fakeSettings, summary } from "./support/m2.ts";

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

const T1 = threadId(1);

function harness(
  initial: Record<string, unknown> = {},
  folderThreads: readonly ReturnType<typeof threadId>[] = [T1],
  extraHandlers: FakeHandlers = {},
): {
  h: Harness;
  settings: ReturnType<typeof fakeSettings>;
} {
  const settings = fakeSettings(DEFS, initial);
  const h = createHarness({
    env: { NO_COLOR: "1" },
    server: {
      handlers: {
        ...settings.handlers,
        "thread.list": () => ({
          threads: folderThreads.map((id) => summary(id)),
          nextCursor: null,
        }),
        ...extraHandlers,
      },
    },
  });
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
  // project 범위는 이 작업 폴더의 대화로 작업 폴더를 정한다
  expect(settings.writes[0]).toMatchObject({ value: "light", scope: "project", threadId: T1 });
});

test("config set --scope project without a conversation in the folder says why and exits 2", async () => {
  const { h, settings } = harness({}, []);
  expect(await h.run(["config", "set", "l4.cli.theme", '"light"', "--scope", "project"])).toBe(
    EXIT.usage,
  );
  expect(settings.writes).toEqual([]);
  expect(h.stderrText()).toContain(
    "이 작업 폴더에 대화가 없어 project 범위를 쓸 곳을 정할 수 없다",
  );
});

test("config set errors from the host become the §4.10 sentences and codes", async () => {
  const { h } = harness();
  expect(await h.run(["config", "set", "l1.loop.nothing", "1"])).toBe(EXIT.usage);
  expect(h.stderrText()).toContain("등록되지 않은 설정 키: l1.loop.nothing");
  expect(h.stderrText()).toContain("fresnel config list");

  const scoped = harness();
  expect(await scoped.h.run(["config", "set", "l1.loop.flag", "true", "--scope", "local"])).toBe(
    EXIT.usage,
  );
  expect(scoped.h.stderrText()).toContain("허용 범위: user");
});

test("a refused project write names the reason instead of listing allowed scopes", () => {
  const caught = wireError("settings.scopeNotAllowed", {
    details: {
      key: "l4.cli.theme",
      scope: "project",
      allowedScopes: ["user", "project"],
      reason: "untrustedProject",
    },
  });
  const failure = failureOfWire(caught);
  expect(failure.message).toBe(
    "작업 폴더를 신뢰하지 않아 l4.cli.theme를 project·local 범위에 쓰거나 읽을 수 없다",
  );
  expect(failure.fix).toBe("`fresnel trust allow`로 이 작업 폴더를 신뢰한 뒤 다시 한다");
});

test("config reset clears the value in that scope and prints the value that remains", async () => {
  const { h, settings } = harness({ "l4.cli.theme": "dark" });
  expect(await h.run(["config", "reset", "l4.cli.theme", "--scope", "local"])).toBe(EXIT.ok);
  expect(settings.writes[0]).toMatchObject({
    key: "l4.cli.theme",
    scope: "local",
    value: undefined,
    threadId: T1,
  });
  expect(h.stdoutText()).toContain('l4.cli.theme = "system"');
});

test("config list prints every definition with its value, scopes and range; --prefix narrows it", async () => {
  const { h } = harness({ "l1.loop.maxSteps": 80 });
  expect(await h.run(["config", "list", "--prefix", "l1.loop"])).toBe(EXIT.ok);
  const text = h.stdoutText();
  expect(text).toContain("l1.loop.maxSteps = 80");
  expect(text).toContain("범위: 1..200");
  expect(text).toContain("쓸 수 있는 범위: user, project, local, launch");
  expect(text).toContain("l1.loop.flag = false");
  expect(text).not.toContain("l4.cli.theme");
});

test("config list warns on stderr about a settings file it could not read, and lists as before", async () => {
  const { h } = harness({ "l1.loop.maxSteps": 80 }, [T1], {
    "host.status": () => ({
      mode: "in-process",
      pid: 1,
      startedAt: "2026-11-01T00:00:00.000Z",
      connections: 1,
      liveTurns: 0,
      idleShutdownAt: null,
      settingsProblems: [
        {
          scope: "user",
          path: "/home/u/.fresnel/settings.json",
          reason: "unreadable",
          line: null,
          column: null,
          code: "EACCES",
        },
      ],
    }),
  });
  expect(await h.run(["config", "list", "--prefix", "l1.loop"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toContain("l1.loop.maxSteps = 80");
  expect(h.stderrText()).toBe(
    "경고: 설정 파일 /home/u/.fresnel/settings.json을 읽지 못해 그 범위를 기본값으로 본다 (읽기 실패: EACCES)\n",
  );
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
