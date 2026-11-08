import { afterEach, describe, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { createLocalSettings, LOCAL } from "../../src/settings-store/index.ts";
import {
  appearancePortOf,
  appearancePrefsOf,
  applyAppearance,
  zoomStepOf,
  type AppearanceRoot,
} from "../../src/views/appearance-prefs.ts";
import {
  getTranscriptDetail,
  setTranscriptDetailValue,
  TRANSCRIPT_DETAILS,
} from "../../src/views/transcript-detail.ts";

// 접근성 값(움직임 줄이기, 확대)과 대화 기록 표시 정도의 읽기·쓰기·화면에 걸기. 값은 `toEqual`로 비교한다.
// 대화 기록 표시 정도의 저장소는 모듈 상태라 시험마다 "full"로 되돌린다.

afterEach(() => setTranscriptDetailValue("full"));

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
    expect(appearancePrefsOf(local)).toEqual({
      motion: "system",
      zoom: 100,
      transcriptDetail: "full",
    });
  });

  test("saved values are read, and a zoom outside the steps falls back to 100", async () => {
    const a = storeOf({ [LOCAL.motionReduce.key]: true, [LOCAL.zoomPercent.key]: 150 });
    await a.local.load();
    expect(appearancePrefsOf(a.local)).toEqual({
      motion: "reduce",
      zoom: 150,
      transcriptDetail: "full",
    });
    expect(zoomStepOf(111)).toBe(100);
    expect(zoomStepOf(undefined)).toBe(100);
  });

  test("applying sets the attribute and zoom, and 100% clears them", () => {
    const root = rootOf();
    applyAppearance(root, { motion: "reduce", zoom: 125, transcriptDetail: "full" });
    expect(root.dataset).toEqual({ motion: "reduce", zoom: "125" });
    expect(root.style.zoom).toBe("1.25");
    applyAppearance(root, { motion: "system", zoom: 100, transcriptDetail: "full" });
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
    expect(port.get()).toEqual({ motion: "reduce", zoom: 200, transcriptDetail: "full" });

    const bad = storeOf({}, true);
    await bad.local.load();
    const badRoot = rootOf();
    expect(await appearancePortOf(bad.local, badRoot).setZoom(150)).toBe(false);
    expect(badRoot.style.zoom).toBe("");
  });

  test("the transcript detail defaults to full, and a stored value outside the three falls back to full", async () => {
    const none = storeOf({});
    await none.local.load();
    expect(appearancePrefsOf(none.local).transcriptDetail).toBe("full");

    const bogus = storeOf({ [LOCAL.transcriptDetail.key]: "verbose" });
    await bogus.local.load();
    expect(appearancePrefsOf(bogus.local).transcriptDetail).toBe("full");
  });

  test("the setting schema accepts exactly the three values", () => {
    expect(TRANSCRIPT_DETAILS).toEqual(["full", "summary", "hidden"]);
    for (const detail of TRANSCRIPT_DETAILS) {
      expect(parse(LOCAL.transcriptDetail.schema, detail).ok).toBe(true);
    }
    expect(parse(LOCAL.transcriptDetail.schema, "verbose").ok).toBe(false);
    expect(parse(LOCAL.transcriptDetail.schema, undefined).ok).toBe(false);
  });

  test.each([...TRANSCRIPT_DETAILS])(
    "the transcript detail %s round-trips through the file, the port, and the store",
    async (detail) => {
      const { local, file } = storeOf({});
      await local.load();
      const port = appearancePortOf(local, rootOf());
      expect(await port.setTranscriptDetail(detail)).toBe(true);
      expect(file).toEqual({ [LOCAL.transcriptDetail.key]: detail });
      expect(port.get().transcriptDetail).toBe(detail);
      expect(getTranscriptDetail()).toBe(detail);

      const reopened = storeOf(file);
      await reopened.local.load();
      expect(appearancePrefsOf(reopened.local).transcriptDetail).toBe(detail);
    },
  );

  test("a failed transcript detail save leaves the store at its value", async () => {
    setTranscriptDetailValue("summary");
    const bad = storeOf({}, true);
    await bad.local.load();
    expect(await appearancePortOf(bad.local, rootOf()).setTranscriptDetail("hidden")).toBe(false);
    expect(getTranscriptDetail()).toBe("summary");
  });

  test("applying pushes the transcript detail to the store at startup and after a save", () => {
    applyAppearance(rootOf(), { motion: "system", zoom: 100, transcriptDetail: "hidden" });
    expect(getTranscriptDetail()).toBe("hidden");
  });
});
