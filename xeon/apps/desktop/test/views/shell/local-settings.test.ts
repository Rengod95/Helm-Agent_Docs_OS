import { describe, expect, test } from "bun:test";
import { LOCAL, createLocalSettings } from "../../../src/settings-store/index.ts";
import {
  initialShell,
  setContextKind,
  switchArea,
  updatePlace,
} from "../../../src/state/shell/model.ts";
import { persistShell, restoreShell } from "../../../src/views/shell/persist.ts";
import { fakeIpc } from "../../transport/fake-ipc.ts";

describe("local settings store (V-14)", () => {
  test("values written are read back after a reload from the file", async () => {
    const fake = fakeIpc();
    const a = createLocalSettings(fake.ipc);
    await a.load();
    const place = { screen: "proposals", scroll: 40, endTab: "work" };
    expect((await a.set(LOCAL.areaChat, place)).ok).toBe(true);
    expect(fake.settingsFile["l4.desktop.window.area.chat"]).toEqual(place);
    const b = createLocalSettings(fake.ipc);
    await b.load();
    expect(b.get(LOCAL.areaChat)).toEqual(place);
  });

  test("an out-of-range value is refused before anything is written", async () => {
    const fake = fakeIpc();
    const s = createLocalSettings(fake.ipc);
    expect(await s.set(LOCAL.sidebarWidth, 10)).toEqual({
      ok: false,
      error: { kind: "invalid", key: "l4.desktop.window.sidebarWidth" },
    });
    expect(fake.settingsFile).toEqual({});
  });

  test("palette command counts are kept under the window prefix and read back after a reload", async () => {
    const fake = fakeIpc();
    const a = createLocalSettings(fake.ipc);
    await a.load();
    const counts = { "thread.new": 3, "diagnostics.copy": 1 };
    expect((await a.set(LOCAL.paletteUses, counts)).ok).toBe(true);
    expect(fake.settingsFile["l4.desktop.window.paletteUses"]).toEqual(counts);
    const b = createLocalSettings(fake.ipc);
    await b.load();
    expect(b.get(LOCAL.paletteUses)).toEqual(counts);
  });

  test("a palette count that is negative or not a whole number is refused", async () => {
    const fake = fakeIpc();
    const s = createLocalSettings(fake.ipc);
    expect((await s.set(LOCAL.paletteUses, { "thread.new": -1 })).ok).toBe(false);
    expect((await s.set(LOCAL.paletteUses, { "thread.new": 1.5 })).ok).toBe(false);
    expect(fake.settingsFile).toEqual({});
  });

  test("a stored value of the wrong shape reads as absent", async () => {
    const fake = fakeIpc();
    fake.settingsFile["l4.desktop.window.area.current"] = "elsewhere";
    const s = createLocalSettings(fake.ipc);
    await s.load();
    expect(s.get(LOCAL.areaCurrent)).toBeUndefined();
  });
});

describe("shell persistence", () => {
  test("area and places are restored; scroll alone is not written until the area is left", async () => {
    const fake = fakeIpc();
    const s = createLocalSettings(fake.ipc);
    await s.load();
    const base = initialShell(1400);
    const moved = updatePlace(base, { screen: "schedules" });
    await Promise.all(persistShell(base, moved, s));
    const scrolled = updatePlace(moved, { scroll: 500 });
    expect(persistShell(moved, scrolled, s)).toEqual([]);
    const left = switchArea(scrolled, "workbench");
    await Promise.all(persistShell(scrolled, left, s));
    const reopened = createLocalSettings(fake.ipc);
    await reopened.load();
    const restored = restoreShell(initialShell(1400), reopened);
    expect(restored.area).toBe("workbench");
    expect(restored.places.chat).toEqual({ screen: "schedules", scroll: 500, endTab: "inbox" });
  });

  test("the context is not persisted", async () => {
    const fake = fakeIpc();
    const s = createLocalSettings(fake.ipc);
    const base = initialShell(1400);
    const next = setContextKind(base, "profile", "p1");
    expect(persistShell(base, next, s)).toEqual([]);
  });
});
