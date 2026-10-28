import { describe, expect, test } from "bun:test";
import { McpClient, validateCapability } from "@xeon/contracts/capabilities";

// L2 정의의 readOnly·idempotent 분류는 M3-REQ-88이 채운다. 그 전까지 분류 경고(effect_class_missing)는 이슈로 세지 않는다.
function withoutClassWarnings(
  issues: ReturnType<typeof validateCapability>,
): ReturnType<typeof validateCapability> {
  return issues.filter((issue) => issue.code !== "effect_class_missing");
}

describe("mcp.client definition", () => {
  test("mcp.client def has no issues", () => {
    expect(withoutClassWarnings(validateCapability(McpClient))).toEqual([]);
  });

  test("static tools are read only", () => {
    expect(McpClient.tools.map((tool) => tool.name)).toEqual([
      "mcp_servers",
      "mcp_list_resources",
      "mcp_read_resource",
    ]);
    for (const tool of McpClient.tools) {
      expect(tool.replay).toBe("safe");
      expect(tool.hints?.readOnly).toBe(true);
    }
  });
});
