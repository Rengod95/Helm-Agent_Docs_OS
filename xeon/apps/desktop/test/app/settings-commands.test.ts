import { describe, expect, test } from "bun:test";
import type { SettingsReadFileResult, SettingsWriteFileResult } from "@fresnel/contracts/wire";
import { summary, thr } from "../state/helpers.ts";
import { engineFake, makeApp, tick, until, type EngineExtra } from "./support.ts";

// 설정 화면의 명령(`commands.settings.open()`)을 가짜 엔진 위에서 돌린다. 값 저장은 `settings.set`의 정확한 인자로,
// 변경 알림은 열린 대화에 따라 다시 읽을지로 본다. 값은 `toEqual`로 비교한다.

const KEY = "l1.models.default";
const SAVED_VALUE = "anthropic/claude-sonnet-5-5";

/** 와이어 모양의 정의 하나. 사용자 범위에 쓸 수 있다 */
const DEF = {
  key: KEY,
  type: { type: "string" },
  runtimeChange: "live",
  layer: "L1",
  allowedScopes: ["user", "project", "local", "launch"],
  since: "0.1.0",
  ui: { tab: "models", widget: "text", order: 1, label: "기본 모델" },
};

/** 유효 값 한 줄. 출처는 사용자 파일이다 */
function setting(value: unknown) {
  return {
    key: KEY,
    value,
    source: { scope: "user" },
    locked: false,
    shadowed: [],
    runtimeChange: "live",
    pendingUntil: null,
    deprecated: false,
  };
}

const EXTRA: EngineExtra = {
  results: {
    "settings.list": { defs: [DEF] },
    "settings.get": { settings: [setting("anthropic/claude-haiku-5-5")] },
    "settings.set": { setting: setting(SAVED_VALUE) },
  },
};

async function liveApp(extra: EngineExtra) {
  const engine = engineFake([summary(thr(1))], undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().link.phase === "live", "live link");
  return { app, ...engine };
}

const countOf = (methods: readonly string[], method: string): number =>
  methods.filter((name) => name === method).length;

describe("settings page commands", () => {
  test("an edited field is saved with settings.set and exactly key, value and scope", async () => {
    const { app, params } = await liveApp(EXTRA);
    const controller = app.commands.settings.open();
    if (controller === null) throw new Error("a live connection must give a controller");
    await controller.load();
    controller.edit(KEY, SAVED_VALUE);
    await controller.commit(KEY);
    expect(params.filter((entry) => entry.method === "settings.set")).toEqual([
      { method: "settings.set", params: { key: KEY, value: SAVED_VALUE, scope: "user" } },
    ]);
    expect(controller.getState().drafts.has(KEY)).toBe(false);
    await controller.dispose();
    await app.stop();
  });

  test("without a connection there is no controller to open", async () => {
    const engine = engineFake([summary(thr(1))], undefined, EXTRA);
    const app = makeApp(engine.fake);
    expect(app.commands.settings.open()).toBeNull();
    await app.stop();
  });

  test("a change for another conversation does not reload, a user-scope change does", async () => {
    const { app, fake, methods } = await liveApp(EXTRA);
    app.commands.selectThread(thr(1));
    const controller = app.commands.settings.open();
    if (controller === null) throw new Error("a live connection must give a controller");
    await controller.load();
    const before = countOf(methods, "settings.get");

    // 열린 대화(thr(1))가 아닌 대화의 대화 범위 변경은 다시 읽지 않는다
    fake.emitLine({
      jsonrpc: "2.0",
      method: "settings.invalidated",
      params: { keys: [KEY], scopes: ["launch"], threadId: thr(2) },
    });
    await tick(20);
    expect(countOf(methods, "settings.get")).toBe(before);

    // 사용자 범위 변경은 열린 대화와 상관없이 다시 읽는다
    fake.emitLine({
      jsonrpc: "2.0",
      method: "settings.invalidated",
      params: { keys: [KEY], scopes: ["user"], threadId: null },
    });
    await until(() => countOf(methods, "settings.get") === before + 1, "one reload");
    await tick(20);
    expect(countOf(methods, "settings.get")).toBe(before + 1);
    await controller.dispose();
    await app.stop();
  });
});

// 설정 파일 편집기(P-09 "파일로 보기")의 읽기와 쓰기. 보내는 인자는 wire 모양 그대로 `toEqual`로 본다.
// `user` 범위는 대화를 보내지 않고, `project`와 `local`은 대화의 작업 폴더를 정하려고 보낸다.

const SHA = "ab".repeat(32);
const NEXT = "cd".repeat(32);
const PATH = "/home/user/.fresnel/settings.json";
const TEXT = '{"l1.models.default": "sonnet"}\n';

const READ_RESULT: SettingsReadFileResult = {
  scope: "user",
  path: PATH,
  exists: true,
  readOnly: false,
  text: TEXT,
  sha256: SHA,
  unknownKeys: [],
};
const WRITE_RESULT: SettingsWriteFileResult = { path: PATH, sha256: NEXT, unknownKeys: [] };

describe("settings file commands", () => {
  test("reading the user file sends only the scope and returns the text with its hash", async () => {
    const { app, params } = await liveApp({ results: { "settings.readFile": READ_RESULT } });
    const read = await app.commands.settings.readFile({ scope: "user", threadId: thr(1) });
    expect(params.filter((entry) => entry.method === "settings.readFile")).toEqual([
      { method: "settings.readFile", params: { scope: "user" } },
    ]);
    expect(read).toEqual({ ok: true, value: READ_RESULT });
    await app.stop();
  });

  test("reading a project file sends the conversation whose folder it belongs to", async () => {
    const { app, params } = await liveApp({
      results: { "settings.readFile": { ...READ_RESULT, scope: "project" } },
    });
    await app.commands.settings.readFile({ scope: "project", threadId: thr(1) });
    expect(params.filter((entry) => entry.method === "settings.readFile")).toEqual([
      { method: "settings.readFile", params: { scope: "project", threadId: thr(1) } },
    ]);
    await app.stop();
  });

  test("writing sends the scope, the whole text and the hash it was read with", async () => {
    const { app, params } = await liveApp({ results: { "settings.writeFile": WRITE_RESULT } });
    const written = await app.commands.settings.writeFile({
      scope: "user",
      threadId: thr(1),
      text: '{"l1.models.default": "haiku"}\n',
      baseSha256: SHA,
    });
    expect(params.filter((entry) => entry.method === "settings.writeFile")).toEqual([
      {
        method: "settings.writeFile",
        params: { scope: "user", text: '{"l1.models.default": "haiku"}\n', baseSha256: SHA },
      },
    ]);
    expect(written).toEqual({ ok: true, value: WRITE_RESULT });
    await app.stop();
  });

  test("a file that did not exist is written with a null base hash", async () => {
    const { app, params } = await liveApp({ results: { "settings.writeFile": WRITE_RESULT } });
    await app.commands.settings.writeFile({
      scope: "user",
      threadId: null,
      text: "{}\n",
      baseSha256: null,
    });
    expect(params.filter((entry) => entry.method === "settings.writeFile")).toEqual([
      { method: "settings.writeFile", params: { scope: "user", text: "{}\n", baseSha256: null } },
    ]);
    await app.stop();
  });

  test("a file changed since it was read comes back as a conflict", async () => {
    const { app } = await liveApp({
      errors: {
        "settings.writeFile": {
          code: 3107,
          kind: "settings.fileConflict",
          details: { scope: "user" },
        },
      },
    });
    const written = await app.commands.settings.writeFile({
      scope: "user",
      threadId: null,
      text: "{}\n",
      baseSha256: SHA,
    });
    expect(written).toEqual({ ok: false, error: { kind: "conflict" } });
    await app.stop();
  });

  test("a text the host rejects shows the first sentence the host gave", async () => {
    const { app } = await liveApp({
      errors: {
        "settings.writeFile": {
          code: 3108,
          kind: "settings.fileInvalid",
          details: {
            scope: "user",
            issues: [{ path: "/l1.models.default", message: "모르는 모델이에요" }],
          },
        },
      },
    });
    const written = await app.commands.settings.writeFile({
      scope: "user",
      threadId: null,
      text: "[]",
      baseSha256: SHA,
    });
    expect(written).toEqual({
      ok: false,
      error: { kind: "rejected", code: 3108, detail: "모르는 모델이에요" },
    });
    await app.stop();
  });

  test("without a connection reading and writing answer offline and send nothing", async () => {
    const engine = engineFake([summary(thr(1))], undefined, EXTRA);
    const app = makeApp(engine.fake);
    expect(await app.commands.settings.readFile({ scope: "user", threadId: null })).toEqual({
      ok: false,
      error: { kind: "offline" },
    });
    expect(
      await app.commands.settings.writeFile({
        scope: "user",
        threadId: null,
        text: "{}\n",
        baseSha256: SHA,
      }),
    ).toEqual({ ok: false, error: { kind: "offline" } });
    expect(
      engine.params.filter(
        (entry) => entry.method === "settings.readFile" || entry.method === "settings.writeFile",
      ),
    ).toEqual([]);
    await app.stop();
  });
});
