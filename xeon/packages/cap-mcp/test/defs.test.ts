import { describe, expect, test } from "bun:test";
import { McpClient, validateCapability } from "@xeon/contracts/capabilities";

describe("mcp.client definition", () => {
  test("mcp.client def has no issues", () => {
    expect(validateCapability(McpClient)).toEqual([]);
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
