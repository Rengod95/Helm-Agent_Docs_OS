import { describe, expect, test } from "bun:test";
import { createLocalSettings, LOCAL } from "../../src/settings-store/index.ts";
import { notifyPrefsOf, notifyPrefsPortOf } from "../../src/views/os-notify-prefs.ts";
import { fakeIpc } from "../transport/fake-ipc.ts";

// OS 알림 종류별 켜짐의 로컬 설정(B-10). 값이 없으면 켠 것이다. 값은 `l4.desktop.window.notify.*` 키에 불리언으로 저장한다.

const ALL_ON = { turnDone: true, approval: true, scheduleFailed: true };

describe("notify preference keys", () => {
  test("the three keys sit under the window prefix that the shell allows", () => {
    expect(LOCAL.notifyTurnDone.key).toBe("l4.desktop.window.notify.turnDone");
    expect(LOCAL.notifyApproval.key).toBe("l4.desktop.window.notify.approval");
    expect(LOCAL.notifyScheduleFailed.key).toBe("l4.desktop.window.notify.scheduleFailed");
  });
});

describe("notifyPrefsOf defaults", () => {
  test("with no saved values every category is on", async () => {
    const fake = fakeIpc();
    const local = createLocalSettings(fake.ipc);
    await local.load();
    expect(notifyPrefsOf(local)).toEqual(ALL_ON);
  });

  test("a stored value of the wrong type reads as the default, on", async () => {
    const fake = fakeIpc();
    fake.settingsFile["l4.desktop.window.notify.approval"] = "no";
    const local = createLocalSettings(fake.ipc);
    await local.load();
    expect(notifyPrefsOf(local)).toEqual(ALL_ON);
  });

  test("a value set to off is read back as off, and the others stay on", async () => {
    const fake = fakeIpc();
    const local = createLocalSettings(fake.ipc);
    await local.load();
    const port = notifyPrefsPortOf(local);
    expect(await port.set("approval", false)).toBe(true);
    expect(fake.settingsFile).toEqual({ "l4.desktop.window.notify.approval": false });
    expect(port.get()).toEqual({ turnDone: true, approval: false, scheduleFailed: true });
  });

  test("a write the file refuses reports false and changes nothing", async () => {
    const failing = createLocalSettings({
      readSettings: () => Promise.resolve({ ok: true, value: {} }),
      writeSettings: () =>
        Promise.resolve({
          ok: false,
          error: { kind: "command", command: "desktop_settings_write", code: "storage" },
        }),
    });
    await failing.load();
    const port = notifyPrefsPortOf(failing);
    expect(await port.set("turnDone", false)).toBe(false);
    expect(port.get()).toEqual(ALL_ON);
  });
});
