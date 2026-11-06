import { describe, expect, test } from "bun:test";
import { createLocalSettings, LOCAL } from "../../src/settings-store/index.ts";
import {
  appearancePortOf,
  appearancePrefsOf,
  applyAppearance,
  zoomStepOf,
  type AppearanceRoot,
} from "../../src/views/appearance-prefs.ts";

// 접근성 값(움직임 줄이기, 확대)의 읽기·쓰기·화면에 걸기. 값은 `toEqual`로 비교한다.

function rootOf(): AppearanceRoot {
  return { style: { zoom: "" }, dataset: {} };
}

function storeOf(initial: Record<string, unknown>, failWrite = false) {
  const file: Record<string, unknown> = { ...initial };
  const local = createLocalSettings({
    readSettings: () => Promise.resolve({ ok: true, value: { ...file } }),
    writeSettings: (key, value) => {
      if (failWrite)
        return Promise.resolve({ ok: false, error: { kind: "invalid", command: "write" } });
      file[key] = value;
      return Promise.resolve({ ok: true, value: null });
    },
  });
  return { local, file };
}

describe("appearance prefs", () => {
  test("without saved values the app follows the system at 100%", async () => {
    const { local } = storeOf({});
    await local.load();
    expect(appearancePrefsOf(local)).toEqual({ motion: "system", zoom: 100 });
  });

  test("saved values are read, and a zoom outside the steps falls back to 100", async () => {
    const a = storeOf({ [LOCAL.motionReduce.key]: true, [LOCAL.zoomPercent.key]: 150 });
    await a.local.load();
    expect(appearancePrefsOf(a.local)).toEqual({ motion: "reduce", zoom: 150 });
    expect(zoomStepOf(111)).toBe(100);
    expect(zoomStepOf(undefined)).toBe(100);
  });

  test("applying sets the attribute and zoom, and 100% clears them", () => {
    const root = rootOf();
    applyAppearance(root, { motion: "reduce", zoom: 125 });
    expect(root.dataset).toEqual({ motion: "reduce", zoom: "125" });
    expect(root.style.zoom).toBe("1.25");
    applyAppearance(root, { motion: "system", zoom: 100 });
    expect(root.dataset).toEqual({});
    expect(root.style.zoom).toBe("");
  });

  test("the port saves then applies, and a failed save leaves the screen alone", async () => {
    const ok = storeOf({});
    await ok.local.load();
    const root = rootOf();
    const port = appearancePortOf(ok.local, root);
    expect(await port.setMotion("reduce")).toBe(true);
    expect(await port.setZoom(200)).toBe(true);
    expect(ok.file).toEqual({
      [LOCAL.motionReduce.key]: true,
      [LOCAL.zoomPercent.key]: 200,
    });
    expect(root.dataset).toEqual({ motion: "reduce", zoom: "200" });
    expect(root.style.zoom).toBe("2");
    expect(port.get()).toEqual({ motion: "reduce", zoom: 200 });

    const bad = storeOf({}, true);
    await bad.local.load();
    const badRoot = rootOf();
    expect(await appearancePortOf(bad.local, badRoot).setZoom(150)).toBe(false);
    expect(badRoot.style.zoom).toBe("");
  });
});
