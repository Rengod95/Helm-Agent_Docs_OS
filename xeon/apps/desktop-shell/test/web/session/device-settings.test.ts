// 웹 기기별 설정 시험. 쓰고 읽기, 기기 둘의 격리, origin 전용 키 거절, 기기 id 검사, 파일과 폴더 권한, 상한과 깨진 파일을 본다.
// 명령은 탭의 `dispatch`로 부른다(와이어와 같은 길).
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ShellReply } from "../../../src/main/commands.ts";
import { createWebContext, type WebContext } from "../../../src/web/session/web-context.ts";
import { cleanupTempDirs, tempDir } from "../support/fixtures.ts";
import { recordedLog, sessionOptions } from "./support.ts";

const tabs: WebContext[] = [];

afterEach(async () => {
  await Promise.all(tabs.splice(0).map((tab) => tab.close()));
  cleanupTempDirs();
});

/** 같은 상태 폴더를 쓰는 기기 하나의 탭. 소켓은 없는 경로라 엔진은 실패 상태로 기다린다 */
function deviceTab(stateDir: string, deviceId: string): WebContext {
  const tab = createWebContext({
    ...sessionOptions(path.join(tempDir(), "absent.sock"), recordedLog()),
    stateDir,
    deviceId,
    tabId: "tab_test",
    send: () => undefined,
  });
  tabs.push(tab);
  return tab;
}

/** 기기 설정 폴더와 그 안의 기기 파일 경로 */
function settingsDirOf(stateDir: string): string {
  return path.join(stateDir, "remote", "device-settings");
}

const REFUSED_BAD_REQUEST: ShellReply = { ok: false, error: "bad-request" };

describe("device settings round trip", () => {
  test("a device reads back what it wrote, also from a new tab", async () => {
    const stateDir = tempDir();
    const device = deviceTab(stateDir, "dev_a");
    expect(await device.dispatch("desktop_settings_read", undefined)).toEqual({
      ok: true,
      value: {},
    });
    expect(
      await device.dispatch("desktop_settings_write", {
        key: "l4.desktop.appearance.zoom",
        value: 125,
      }),
    ).toEqual({ ok: true, value: null });
    expect(
      await device.dispatch("desktop_settings_write", {
        key: "l4.desktop.window.sidebarWidth",
        value: 320,
      }),
    ).toEqual({ ok: true, value: null });
    const expected: ShellReply = {
      ok: true,
      value: { "l4.desktop.appearance.zoom": 125, "l4.desktop.window.sidebarWidth": 320 },
    };
    expect(await device.dispatch("desktop_settings_read", undefined)).toEqual(expected);
    // 연결이 끊겼다 다시 붙어도 같은 기기의 설정은 파일에 남아 있다
    const again = deviceTab(stateDir, "dev_a");
    expect(await again.dispatch("desktop_settings_read", undefined)).toEqual(expected);
  });

  test("two devices sharing a state folder keep separate settings", async () => {
    const stateDir = tempDir();
    const a = deviceTab(stateDir, "dev_a");
    const b = deviceTab(stateDir, "dev_b");
    await a.dispatch("desktop_settings_write", { key: "l4.desktop.appearance.zoom", value: 150 });
    expect(await b.dispatch("desktop_settings_read", undefined)).toEqual({ ok: true, value: {} });
    await b.dispatch("desktop_settings_write", {
      key: "l4.desktop.appearance.motion",
      value: true,
    });
    expect(await a.dispatch("desktop_settings_read", undefined)).toEqual({
      ok: true,
      value: { "l4.desktop.appearance.zoom": 150 },
    });
    expect(await b.dispatch("desktop_settings_read", undefined)).toEqual({
      ok: true,
      value: { "l4.desktop.appearance.motion": true },
    });
    expect(readdirSync(settingsDirOf(stateDir)).toSorted()).toEqual(["dev_a.json", "dev_b.json"]);
  });
});

describe("origin-only keys", () => {
  test("closeBehavior, shutdownGraceMs, restartLimit and unknown keys are refused and not stored", async () => {
    const stateDir = tempDir();
    const device = deviceTab(stateDir, "dev_a");
    const refused = await Promise.all([
      device.dispatch("desktop_settings_write", {
        key: "l4.desktop.window.closeBehavior",
        value: "quit",
      }),
      device.dispatch("desktop_settings_write", {
        key: "l4.desktop.engine.shutdownGraceMs",
        value: 5000,
      }),
      device.dispatch("desktop_settings_write", {
        key: "l4.desktop.engine.restartLimit",
        value: 2,
      }),
      device.dispatch("desktop_settings_write", { key: "l4.desktop.engine.other", value: 1 }),
    ]);
    expect(refused).toEqual([
      REFUSED_BAD_REQUEST,
      REFUSED_BAD_REQUEST,
      REFUSED_BAD_REQUEST,
      REFUSED_BAD_REQUEST,
    ]);
    expect(await device.dispatch("desktop_settings_read", undefined)).toEqual({
      ok: true,
      value: {},
    });
  });

  test("a write without a string key is refused", async () => {
    const device = deviceTab(tempDir(), "dev_a");
    expect(await device.dispatch("desktop_settings_write", undefined)).toEqual(REFUSED_BAD_REQUEST);
    expect(await device.dispatch("desktop_settings_write", { key: 5, value: 1 })).toEqual(
      REFUSED_BAD_REQUEST,
    );
  });

  test("a file that already holds the origin-only keys is read without them", async () => {
    const stateDir = tempDir();
    mkdirSync(settingsDirOf(stateDir), { recursive: true });
    writeFileSync(
      path.join(settingsDirOf(stateDir), "dev_a.json"),
      JSON.stringify({
        "l4.desktop.window.closeBehavior": "quit",
        "l4.desktop.engine.restartLimit": 2,
        "l4.desktop.appearance.zoom": 90,
      }),
    );
    const device = deviceTab(stateDir, "dev_a");
    expect(await device.dispatch("desktop_settings_read", undefined)).toEqual({
      ok: true,
      value: { "l4.desktop.appearance.zoom": 90 },
    });
  });
});

describe("device id", () => {
  test("a device id that is not a plain name is refused and creates no folder", async () => {
    const stateDir = tempDir();
    const badIds = ["", "../escape", "a/b", "dev.a", "x".repeat(65)];
    const devices = badIds.map((id) => deviceTab(stateDir, id));
    const reads = await Promise.all(
      devices.map((device) => device.dispatch("desktop_settings_read", undefined)),
    );
    const writes = await Promise.all(
      devices.map((device) =>
        device.dispatch("desktop_settings_write", {
          key: "l4.desktop.appearance.zoom",
          value: 90,
        }),
      ),
    );
    expect(reads).toEqual(badIds.map(() => REFUSED_BAD_REQUEST));
    expect(writes).toEqual(badIds.map(() => REFUSED_BAD_REQUEST));
    // "../escape"가 통과했다면 `remote` 폴더가 생겼을 것이다
    expect(existsSync(path.join(stateDir, "remote"))).toEqual(false);
  });

  test("a 64-character device id is accepted", async () => {
    const stateDir = tempDir();
    const id = "x".repeat(64);
    const device = deviceTab(stateDir, id);
    expect(
      await device.dispatch("desktop_settings_write", {
        key: "l4.desktop.appearance.zoom",
        value: 90,
      }),
    ).toEqual({ ok: true, value: null });
    expect(readdirSync(settingsDirOf(stateDir))).toEqual([`${id}.json`]);
  });
});

describe("file modes and limits", () => {
  test("the device file is 0600, its folder 0700, and no temporary file is left", async () => {
    const stateDir = tempDir();
    const device = deviceTab(stateDir, "dev_a");
    await device.dispatch("desktop_settings_write", {
      key: "l4.desktop.appearance.zoom",
      value: 90,
    });
    const dir = settingsDirOf(stateDir);
    expect(statSync(path.join(dir, "dev_a.json")).mode & 0o777).toEqual(0o600);
    expect(statSync(dir).mode & 0o777).toEqual(0o700);
    expect(readdirSync(dir).toSorted()).toEqual(["dev_a.json"]);
  });

  test("a value that makes the file larger than 64 KiB is refused and nothing is written", async () => {
    const device = deviceTab(tempDir(), "dev_a");
    expect(
      await device.dispatch("desktop_settings_write", {
        key: "l4.desktop.appearance.big",
        value: "x".repeat(65_536),
      }),
    ).toEqual({ ok: false, error: "too-large" });
    expect(await device.dispatch("desktop_settings_read", undefined)).toEqual({
      ok: true,
      value: {},
    });
  });

  test("a damaged device file is reported and not overwritten", async () => {
    const stateDir = tempDir();
    mkdirSync(settingsDirOf(stateDir), { recursive: true });
    const file = path.join(settingsDirOf(stateDir), "dev_a.json");
    writeFileSync(file, "not json");
    const device = deviceTab(stateDir, "dev_a");
    expect(await device.dispatch("desktop_settings_read", undefined)).toEqual({
      ok: false,
      error: "storage-failed",
    });
    expect(
      await device.dispatch("desktop_settings_write", {
        key: "l4.desktop.appearance.zoom",
        value: 90,
      }),
    ).toEqual({ ok: false, error: "storage-failed" });
    expect(readFileSync(file, "utf8")).toEqual("not json");
  });
});
