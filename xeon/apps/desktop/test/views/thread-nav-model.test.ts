import { describe, expect, test } from "bun:test";
import { rowOpensChat } from "../../src/views/thread-nav-model.ts";

describe("rowOpensChat", () => {
  test("goes to the chat from settings in either area", () => {
    expect(rowOpensChat({ screen: "settings", area: "chat", chatPlaceScreen: "chat" })).toBe(true);
    expect(rowOpensChat({ screen: "settings", area: "workbench", chatPlaceScreen: "chat" })).toBe(
      true,
    );
  });
  test("goes to the chat from a full page of the chat area", () => {
    for (const place of ["inbox", "schedules", "proposals", "connection", "first-run"]) {
      expect(rowOpensChat({ screen: "chat", area: "chat", chatPlaceScreen: place })).toBe(true);
    }
  });
  test("stays put when already in the chat or in the workbench area", () => {
    expect(rowOpensChat({ screen: "chat", area: "chat", chatPlaceScreen: "chat" })).toBe(false);
    expect(rowOpensChat({ screen: "chat", area: "workbench", chatPlaceScreen: "inbox" })).toBe(
      false,
    );
  });
});
