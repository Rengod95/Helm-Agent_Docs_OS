import { describe, expect, test } from "bun:test";
import type { EffectiveSetting } from "@fresnel/contracts/settings";
import { createLocalSettings, createLocalSettingsPort } from "../../src/settings-store/index.ts";
import { fakeIpc } from "../transport/fake-ipc.ts";

// 데스크톱 로컬 저장소의 설정 포트(L4.settings-ui §4.1.3). 가짜 IPC 위에서 읽고 쓴다. 값은 `toEqual`로 비교한다.

const CLOSE = "l4.desktop.window.closeBehavior";
const RESTART = "l4.desktop.engine.restartLimit";
const GRACE = "l4.desktop.engine.shutdownGraceMs";

/** 파일 내용을 미리 넣은 포트. 파일은 `fake.settingsFile`에 있다 */
async function portOver(initial: Readonly<Record<string, unknown>> = {}) {
  const fake = fakeIpc();
  Object.assign(fake.settingsFile, initial);
  const local = createLocalSettings(fake.ipc);
  await local.load();
  return { fake, port: createLocalSettingsPort(local) };
}

/** 저장한 값의 유효 값 모양 */
function savedOf(key: string, value: unknown): EffectiveSetting {
  return {
    key,
    value,
    source: { scope: "user" },
    locked: false,
    shadowed: [],
    runtimeChange: "live",
    pendingUntil: null,
    deprecated: false,
  };
}

/** 기본값의 유효 값 모양 */
function defaultOf(key: string, value: unknown): EffectiveSetting {
  return { ...savedOf(key, value), source: { scope: "default" } };
}

describe("desktop local settings port (localStore)", () => {
  test("the definitions are the shell's three declared keys, each with its tab and range", async () => {
    const { port } = await portOver();
    const defs = port.defs();
    expect(defs.map((def) => def.key).toSorted()).toEqual([RESTART, GRACE, CLOSE].toSorted());
    expect(defs.find((def) => def.key === CLOSE)).toMatchObject({
      type: { type: "string" },
      default: "tray",
      range: { enum: ["quit", "tray"] },
      runtimeChange: "live",
      layer: "L4",
      allowedScopes: ["managed", "user"],
      ui: { tab: "appearance", widget: "select", order: 10 },
    });
    expect(defs.find((def) => def.key === RESTART)?.ui?.tab).toBe("execution");
    expect(defs.find((def) => def.key === GRACE)?.ui?.tab).toBe("advanced");
  });

  test("a key with no saved value reads its default from the declaration, with source default", async () => {
    const { port } = await portOver();
    expect(port.get(CLOSE)).toEqual(defaultOf(CLOSE, "tray"));
    expect(port.get(GRACE)).toEqual(defaultOf(GRACE, 7000));
    expect(port.get("l4.desktop.window.sidebarOpen")).toBeUndefined();
  });

  test("a stored value that fails the key's schema reads as the default", async () => {
    const { port } = await portOver({ [RESTART]: 99 });
    expect(port.get(RESTART)).toEqual(defaultOf(RESTART, 3));
  });

  test("a valid value is written to the file and answered as a user-scope setting", async () => {
    const { fake, port } = await portOver();
    expect(await port.set(CLOSE, "tray")).toEqual({
      ok: true,
      setting: savedOf(CLOSE, "tray"),
    });
    expect(fake.settingsFile).toEqual({ [CLOSE]: "tray" });
    expect(port.get(CLOSE)).toEqual(savedOf(CLOSE, "tray"));
  });

  test("an out-of-range value is refused as settings.invalidValue and the file stays as it was", async () => {
    const { fake, port } = await portOver();
    expect(await port.set(RESTART, 11)).toEqual({
      ok: false,
      kind: "settings.invalidValue",
      details: {},
    });
    expect(await port.set(CLOSE, "maximized")).toEqual({
      ok: false,
      kind: "settings.invalidValue",
      details: {},
    });
    expect(fake.settingsFile).toEqual({});
  });

  test("a key that is not declared is refused as settings.unknownKey and writes nothing", async () => {
    const { fake, port } = await portOver();
    expect(await port.set("l4.desktop.window.sidebarOpen", true)).toEqual({
      ok: false,
      kind: "settings.unknownKey",
      details: {},
    });
    expect(await port.set("l1.models.default", "x")).toEqual({
      ok: false,
      kind: "settings.unknownKey",
      details: {},
    });
    expect(fake.settingsFile).toEqual({});
  });

  test("reset writes the declared default, so the file holds it and the answer is the default value", async () => {
    const { fake, port } = await portOver({ [RESTART]: 5 });
    expect(await port.reset(RESTART)).toEqual({
      ok: true,
      setting: savedOf(RESTART, 3),
    });
    expect(fake.settingsFile).toEqual({ [RESTART]: 3 });
  });

  test("a file write failure is storage, and a value the file refuses is not announced", async () => {
    const failing = createLocalSettings({
      readSettings: () => Promise.resolve({ ok: true, value: {} }),
      writeSettings: () =>
        Promise.resolve({
          ok: false,
          error: { kind: "command", command: "desktop_settings_write", code: "storage" },
        }),
    });
    await failing.load();
    const port = createLocalSettingsPort(failing);
    const heard: EffectiveSetting[] = [];
    port.onChange((setting) => heard.push(setting));
    expect(await port.set(GRACE, 5000)).toEqual({ ok: false, kind: "storage", details: {} });
    expect(heard).toEqual([]);
  });

  test("a saved change reaches the change listeners until they unsubscribe", async () => {
    const { port } = await portOver();
    const heard: EffectiveSetting[] = [];
    const stop = port.onChange((setting) => heard.push(setting));
    await port.set(GRACE, 5000);
    stop();
    await port.set(GRACE, 6000);
    expect(heard).toEqual([savedOf(GRACE, 5000)]);
  });
});
