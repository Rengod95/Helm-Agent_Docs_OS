import { writeFileSync } from "node:fs";
import { parseJson } from "@xeon/contracts";

// 실제 stdio MCP 서버 대역(자식 프로세스로 뜬다). 사용: bun mcp-stdio-server.ts <pid 파일> <도구 목록 응답 뒤 만드는 표식 파일>
// 줄바꿈으로 나뉜 JSON-RPC를 stdin에서 읽어 stdout으로 답한다. 도구 `stdio_marker`가 고정 문자열을 돌려주고, stdin이 닫히면 끝난다.
// pid 파일은 시험이 엔진을 닫은 뒤 프로세스가 남았는지 보는 데, 표식 파일은 엔진이 서버 연결을 끝냈는지(도구 목록을 받아 갔는지) 기다리는 데 쓴다.

const pidFile: string = process.argv[2] ?? "";
const listedFile: string = process.argv[3] ?? "";
if (pidFile !== "") writeFileSync(pidFile, String(process.pid));

const TOOL = {
  name: "stdio_marker",
  description: "Returns a fixed marker over stdio.",
  inputSchema: { type: "object", properties: {} },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reply(id: unknown, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function fail(id: unknown, code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

function handle(message: unknown): void {
  if (!isRecord(message) || typeof message["method"] !== "string") return;
  const { method, id } = message;
  // 알림(id 없음)에는 답하지 않는다
  if (id === undefined) return;
  const params = isRecord(message["params"]) ? message["params"] : {};
  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion: params["protocolVersion"],
        capabilities: { tools: {} },
        serverInfo: { name: "stdio-fixture", version: "0.0.0" },
      });
      return;
    case "tools/list":
      reply(id, { tools: [TOOL] });
      if (listedFile !== "") writeFileSync(listedFile, "1");
      return;
    case "tools/call":
      reply(id, { content: [{ type: "text", text: "marker-from-stdio" }] });
      return;
    case "ping":
      reply(id, {});
      return;
    default:
      fail(id, -32601, `method not found: ${method}`);
  }
}

const state = { buffer: "" };
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  state.buffer += chunk;
  for (;;) {
    const newline = state.buffer.indexOf("\n");
    if (newline < 0) return;
    const line = state.buffer.slice(0, newline).trim();
    state.buffer = state.buffer.slice(newline + 1);
    if (line === "") continue;
    const parsed = parseJson(line);
    if (parsed.ok) handle(parsed.value);
  }
});
process.stdin.on("end", () => {
  process.exit(0);
});
