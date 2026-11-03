import { describe, expect, test } from "bun:test";
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
