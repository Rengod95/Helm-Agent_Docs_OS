import { afterEach, expect, test } from "bun:test";
import type { EffectiveSetting } from "@fresnel/contracts/settings";
import type { HostCommand } from "@fresnel/host";
import { cliSettingGroups } from "../src/settings.ts";
import { formatSettings } from "../src/commands/config.ts";
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

const SETTINGS = { "l4.cli.theme": "dark", "l4.cli.outputMode": "text" };

test("config get --json prints the settings array the host returned (AC3)", async () => {
  const h = harness({ server: { settings: SETTINGS } });
  expect(await h.run(["config", "get", "l4.cli.theme", "--json"])).toBe(0);
  const response = h.observed.find(
    (message) => "result" in message && "settings" in message.result,
  );
  const result = response !== undefined && "result" in response ? response.result : undefined;
  expect(JSON.parse(h.stdoutText())).toEqual(result?.["settings"]);
  expect(h.server().requests.map((request) => request.method)).toEqual([
    "host.hello",
    "settings.get",
  ]);
  expect(h.server().requests[1]?.params).toEqual({ keys: ["l4.cli.theme"] });
});

const BROKEN_FILE = {
  scope: "user",
  path: "/home/u/.fresnel/settings.json",
  reason: "invalid_json",
  line: 3,
  column: 5,
};

/** host.status 응답. 읽지 못한 설정 파일이 있으면 `settingsProblems`를 싣는다 */
function statusWith(settingsProblems: readonly unknown[]): Record<string, unknown> {
  return {
    mode: "in-process",
    pid: 1,
    startedAt: "2026-11-01T00:00:00.000Z",
    connections: 1,
    liveTurns: 0,
    idleShutdownAt: null,
    settingsProblems,
  };
}

test("config get warns on stderr about a settings file it could not read, and prints the values as before", async () => {
  const h = harness({
    server: {
      settings: SETTINGS,
      handlers: { "host.status": () => statusWith([BROKEN_FILE]) },
    },
  });
  expect(await h.run(["config", "get", "l4.cli.theme"])).toBe(0);
  expect(h.stdoutText()).toBe('l4.cli.theme = "dark"\n  source: default\n');
  expect(h.stderrText()).toBe(
    "경고: 설정 파일 /home/u/.fresnel/settings.json (3줄 5칸)을 읽지 못해 그 범위를 기본값으로 본다 (JSON 문법 오류)\n",
  );
  expect(h.server().requests.map((request) => request.method)).toEqual([
    "host.hello",
    "settings.get",
    "host.status",
  ]);
});

test("config get --json keeps stdout to the JSON and says what is wrong on stderr", async () => {
  const h = harness({
    server: {
      settings: SETTINGS,
      handlers: {
        "host.status": () =>
          statusWith([{ ...BROKEN_FILE, reason: "not_object", line: null, column: null }]),
      },
    },
  });
  expect(await h.run(["config", "get", "l4.cli.theme", "--json"])).toBe(0);
  expect(JSON.parse(h.stdoutText())).toEqual([
    expect.objectContaining({ key: "l4.cli.theme", value: "dark" }),
  ]);
  expect(h.stderrText()).toBe(
    "경고: 설정 파일 /home/u/.fresnel/settings.json을 읽지 못해 그 범위를 기본값으로 본다 (JSON 객체가 아니다)\n",
  );
});

test("config get stays quiet when the host reports no settings file it could not read", async () => {
  const h = harness({
    server: { settings: SETTINGS, handlers: { "host.status": () => statusWith([]) } },
  });
  expect(await h.run(["config", "get", "l4.cli.theme"])).toBe(0);
  expect(h.stderrText()).toBe("");
});

test("config get without keys asks for everything", async () => {
  const h = harness({ server: { settings: SETTINGS } });
  expect(await h.run(["config", "get"])).toBe(0);
  expect(h.server().requests[1]?.params).toEqual({});
  expect(h.stdoutText()).toContain('l4.cli.theme = "dark"');
  expect(h.stdoutText()).toContain('l4.cli.outputMode = "text"');
});

test("the text output has the scope for every setting (AC3)", async () => {
  const h = harness({ server: { settings: SETTINGS } });
  await h.run(["config", "get", "l4.cli.theme"]);
  expect(h.stdoutText()).toBe('l4.cli.theme = "dark"\n  source: default\n');
  expect(h.closed()).toBe(true);
});

test("the text output shows path, shadowed scopes, pending and the locked tag (§4.8)", () => {
  const settings: EffectiveSetting[] = [
    {
      key: "l1.loop.maxSteps",
      value: 50,
      source: { scope: "project", path: "/repo/.fresnel/settings.json" },
      locked: false,
      shadowed: [{ scope: "user", path: "~/.config/fresnel/settings.json" }],
      runtimeChange: "nextTurn",
      pendingUntil: "nextTurn",
      deprecated: false,
    },
    {
      key: "l1.models.default",
      value: "provider/model",
      source: { scope: "managed" },
      locked: true,
      shadowed: [],
      runtimeChange: "live",
      pendingUntil: null,
      deprecated: true,
    },
  ];
  expect(formatSettings(settings)).toBe(
    [
      "l1.loop.maxSteps = 50",
      "  source: project (/repo/.fresnel/settings.json)",
      "  shadowed: user (~/.config/fresnel/settings.json)",
      "  pending: nextTurn",
      'l1.models.default = "provider/model"  [locked: managed, deprecated]',
      "  source: managed",
      "",
    ].join("\n"),
  );
  expect(formatSettings([])).toBe("");
});

test("a secret setting is shown as its reference or null, never a value", () => {
  const settings: EffectiveSetting[] = [
    {
      key: "l1.models.anthropic.apiKey",
      value: "secret://anthropic-key",
      source: { scope: "user" },
      locked: false,
      shadowed: [],
      runtimeChange: "live",
      pendingUntil: null,
      deprecated: false,
    },
  ];
  expect(formatSettings(settings)).toContain('= "secret://anthropic-key"');
});

function textOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function writeAll(stream: WritableStream<Uint8Array>, text: string): Promise<void> {
  const writer = stream.getWriter();
  await writer.write(textOf(text));
  writer.releaseLock();
}

test("config schema runs the host command without connecting and returns its code", async () => {
  const seen: HostCommand[] = [];
  const h = harness({
    runHostCommand: async (command, io) => {
      seen.push(command);
      await writeAll(io.stdout, "{}\n");
      await writeAll(io.stderr, "note\n");
      return 0;
    },
  });
  expect(await h.run(["config", "schema", "--scope", "user", "--core-only"])).toBe(0);
  expect(seen).toEqual([
    { kind: "config-schema", scope: "user", coreOnly: true, settingGroups: cliSettingGroups },
  ]);
  expect(h.stdoutText()).toBe("{}\n");
  expect(h.stderrText()).toBe("note\n");
  expect(h.methods()).toEqual([]);
  expect(h.closed()).toBe(false);
});

test("config schema passes --out through and keeps the host's 1 and 2 as they are", async () => {
  const seen: HostCommand[] = [];
  const failing = (code: 1 | 2) =>
    harness({
      runHostCommand: (command) => {
        seen.push(command);
        return Promise.resolve(code);
      },
    });
  expect(await failing(1).run(["config", "schema", "--scope", "managed", "--out", "s.json"])).toBe(
    1,
  );
  expect(await failing(2).run(["config", "schema", "--scope", "local"])).toBe(2);
  expect(seen).toEqual([
    {
      kind: "config-schema",
      scope: "managed",
      coreOnly: false,
      settingGroups: cliSettingGroups,
      out: "s.json",
    },
    { kind: "config-schema", scope: "local", coreOnly: false, settingGroups: cliSettingGroups },
  ]);
});
