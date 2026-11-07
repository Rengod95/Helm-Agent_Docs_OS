import { describe, expect, test } from "bun:test";
import type { ApprovalRequestedPayload } from "@fresnel/contracts/records";
import { thr } from "../state/helpers.ts";
import {
  approvalAnnouncement,
  newApprovalIds,
  turnAnnouncement,
} from "../../src/views/announce-model.ts";

describe("announce model (scD 1-2)", () => {
  test("only approvals that were not pending before are new", () => {
    expect(newApprovalIds(["a"], ["a", "b", "c"])).toEqual(["b", "c"]);
    expect(newApprovalIds(["a", "b"], ["b"])).toEqual([]);
  });

  test("a turn end is announced once; failure wins over done", () => {
    expect(turnAnnouncement(true, false, null)).toEqual({ id: "desktop.announce.turnDone" });
    expect(turnAnnouncement(true, false, "boom")).toEqual({ id: "desktop.announce.turnFailed" });
    expect(turnAnnouncement(false, false, null)).toBeNull();
    expect(turnAnnouncement(true, true, null)).toBeNull();
  });
});

const origin = { threadId: thr(1), turnId: null, stepId: null, toolCallId: null, caller: "main" };

function toolRequest(title: string): ApprovalRequestedPayload {
  return {
    origin,
    requestKey: "k",
    title,
    remember: ["once"],
    surfaceThreadId: thr(1),
    requestedAt: 0,
    body: {
      kind: "tool",
      tool: { toolName: "edit", risk: "write", args: {}, argsHash: "h", ruleId: null },
    },
  };
}

describe("approval announcement", () => {
  test("a tool approval names the tool", () => {
    expect(approvalAnnouncement(toolRequest('Allow tool "edit"?'))).toEqual({
      id: "desktop.announce.approval",
      params: { what: "edit" },
    });
  });

  test("a memory or skill write approval is announced in Korean with the target name", () => {
    expect(approvalAnnouncement(toolRequest("Approve memory.add on user memory?"))).toEqual({
      id: "desktop.announce.approval.write.memory",
      params: { name: "user" },
    });
    expect(approvalAnnouncement(toolRequest("Approve skill.create on skill deploy?"))).toEqual({
      id: "desktop.announce.approval.write.skill",
      params: { name: "deploy" },
    });
  });

  test("a start approval is announced with the server name from its args", () => {
    const request = toolRequest('Start MCP server "gh" with secret://gh-token?');
    expect(
      approvalAnnouncement({
        ...request,
        body: {
          kind: "tool",
          tool: {
            toolName: "mcp_start",
            risk: "exec",
            args: {
              server: "gh",
              source: "settings:user",
              command: "gh-mcp",
              args: [],
              cwd: null,
              envNames: [],
              secretEnv: {},
              definitionHash: "h",
            },
            argsHash: "h",
            ruleId: "mcp.start",
          },
        },
      }),
    ).toEqual({ id: "desktop.announce.approval.mcpStart", params: { name: "gh" } });
  });

  test("an unknown title is announced as is", () => {
    expect(approvalAnnouncement(toolRequest("Something else"))).toEqual({
      id: "desktop.announce.approval",
      params: { what: "Something else" },
    });
  });
});
