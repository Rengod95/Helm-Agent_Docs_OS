import { describe, expect, test } from "bun:test";
import {
  availableCommands,
  commandValue,
  decodeValue,
  PALETTE_COMMAND_IDS,
  threadValue,
} from "../../src/views/palette/palette-model.ts";
import { approvalOriginView } from "../../src/views/approval-form.ts";

describe("palette values", () => {
  test("a thread value and a command value read back as what they were made from", () => {
    expect(decodeValue(threadValue("thr_abc"))).toEqual({ kind: "thread", threadId: "thr_abc" });
    expect(decodeValue(commandValue("thread.new"))).toEqual({ kind: "command", id: "thread.new" });
    for (const id of PALETTE_COMMAND_IDS) {
      expect(decodeValue(commandValue(id))).toEqual({ kind: "command", id });
    }
  });

  test("unknown commands, empty ids and other shapes are not values", () => {
    expect(decodeValue("command:rm.rf")).toBeNull();
    expect(decodeValue("thread:")).toBeNull();
    expect(decodeValue("settings:x")).toBeNull();
    expect(decodeValue("nocolon")).toBeNull();
  });

  test("without an open thread the interrupt command is not offered", () => {
    expect(availableCommands(false).map((c) => c.id)).not.toContain("turn.interrupt");
    expect(availableCommands(true).map((c) => c.id)).toContain("turn.interrupt");
    expect(availableCommands(true)).toHaveLength(PALETTE_COMMAND_IDS.length);
  });
});

describe("approvalOriginView", () => {
  test("main shows nothing; background, host, sub-agents and extension groups show their source", () => {
    expect(approvalOriginView("main")).toBeNull();
    expect(approvalOriginView("background")).toEqual({ kind: "background" });
    expect(approvalOriginView("host")).toEqual({ kind: "host" });
    expect(approvalOriginView("subagent:렌즈")).toEqual({ kind: "subagent", name: "렌즈" });
    expect(approvalOriginView("ext:helm")).toEqual({ kind: "group", name: "helm" });
  });
});
