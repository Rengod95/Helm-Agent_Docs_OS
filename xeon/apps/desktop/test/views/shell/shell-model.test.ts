import { describe, expect, test } from "bun:test";
import { layoutOf, panelDefaults } from "../../../src/state/shell/layout.ts";
import {
  initialShell,
  openEndTab,
  pinThread,
  resize,
  selectChatThread,
  setContextKind,
  switchArea,
  unpinThread,
  updatePlace,
} from "../../../src/state/shell/model.ts";

describe("shell.layout-steps-at-breakpoints", () => {
  test("widths step at 720 and 1100, the boundary belonging to the lower step", () => {
    expect([480, 720, 721, 1100, 1101, 1600].map(layoutOf)).toEqual([
      "compact",
      "compact",
      "medium",
      "medium",
      "wide",
      "wide",
    ]);
  });

  test("panel defaults: the start panel is docked unless compact, the end well starts closed", () => {
    expect(panelDefaults("wide")).toEqual({ startOpen: true, endOpen: false });
    expect(panelDefaults("medium")).toEqual({ startOpen: true, endOpen: false });
    expect(panelDefaults("compact")).toEqual({ startOpen: false, endOpen: false });
  });

  test("crossing a breakpoint resets the panels, staying in a step keeps them", () => {
    const wide = openEndTab(initialShell(1400), "runtime");
    expect(wide.endOpen).toBe(true);
    expect(resize(wide, 1200)).toBe(wide);
    const medium = resize(wide, 1000);
    expect(medium.layout).toBe("medium");
    expect(medium.endOpen).toBe(false);
    expect(medium.startOpen).toBe(true);
    const compact = resize(medium, 600);
    expect(compact.startOpen).toBe(false);
    // 단계가 바뀌어도 영역 자리는 그대로다
    expect(compact.places.chat.endTab).toBe("runtime");
  });
});

describe("area.switch-restores-place", () => {
  test("each area returns with the same screen, scroll and right tab", () => {
    let s = initialShell(1400);
    s = updatePlace(s, { screen: "proposals", scroll: 340, endTab: "runtime" });
    s = switchArea(s, "workbench");
    s = updatePlace(s, { screen: "extensions", scroll: 12, endTab: "inspect" });
    s = switchArea(s, "chat");
    expect(s.area).toBe("chat");
    expect(s.places.chat).toEqual({ screen: "proposals", scroll: 340, endTab: "runtime" });
    expect(s.places.workbench).toEqual({ screen: "extensions", scroll: 12, endTab: "inspect" });
    s = switchArea(s, "workbench");
    expect(s.places.workbench).toEqual({ screen: "extensions", scroll: 12, endTab: "inspect" });
  });

  test("opening a tab in the other area does not move the current area's tab", () => {
    const s = openEndTab(initialShell(1400), "log", "workbench");
    expect(s.places.chat.endTab).toBe("inbox");
    expect(s.places.workbench.endTab).toBe("log");
    expect(s.endOpen).toBe(true);
  });
});

const withContext = (threadId: string) =>
  setContextKind(selectChatThread(initialShell(1400), threadId), "thread");

describe("workbench.context-follows-unless-pinned", () => {
  test("the thread context follows the thread opened in the chat area", () => {
    let s = withContext("t1");
    expect(s.context).toEqual({ kind: "thread", threadId: "t1", pinned: false });
    s = selectChatThread(s, "t2");
    expect(s.context).toEqual({ kind: "thread", threadId: "t2", pinned: false });
  });

  test("pinning from 'view in workbench' fixes the context and goes to the workbench", () => {
    let s = selectChatThread(initialShell(1400), "t1");
    s = pinThread(s, "t1");
    expect(s.area).toBe("workbench");
    s = selectChatThread(s, "t2");
    expect(s.context).toEqual({ kind: "thread", threadId: "t1", pinned: true });
    expect(s.chatThreadId).toBe("t2");
  });

  test("unpinning follows the chat area's thread again", () => {
    let s = pinThread(selectChatThread(initialShell(1400), "t1"), "t1");
    s = selectChatThread(s, "t2");
    s = unpinThread(s);
    expect(s.context).toEqual({ kind: "thread", threadId: "t2", pinned: false });
    s = selectChatThread(s, "t3");
    expect(s.context).toEqual({ kind: "thread", threadId: "t3", pinned: false });
  });

  test("all, profile and trial contexts never follow", () => {
    let s = selectChatThread(initialShell(1400), "t1");
    s = setContextKind(s, "all");
    expect(selectChatThread(s, "t2").context).toEqual({ kind: "all" });
    s = setContextKind(s, "profile", "p1");
    expect(selectChatThread(s, "t2").context).toEqual({ kind: "profile", profileId: "p1" });
    s = setContextKind(s, "trial", "tr9");
    expect(selectChatThread(s, "t2").context).toEqual({ kind: "trial", threadId: "tr9" });
  });

  test("the thread context needs a thread: without one the value stays as it was", () => {
    const s = initialShell(1400);
    expect(setContextKind(s, "thread")).toBe(s);
    expect(setContextKind(s, "profile")).toBe(s);
  });
});
