// 다른 패키지 테스트가 쓰는 MCP 스텁(`@xeon/cap-mcp/testing`, eng.testing.guide TS-06).
export { createStubServer, STUB_LEGACY_VERSION, STUB_MODERN_VERSION } from "./stub-server.ts";
export type {
  StubCall,
  StubClientReply,
  StubEra,
  StubOutcome,
  StubPrompt,
  StubRequest,
  StubResource,
  StubServer,
  StubServerOptions,
  StubTool,
} from "./stub-server.ts";
export { createStubProcessPort } from "./stub-process.ts";
export type { StubProcessOptions, StubProcessPort } from "./stub-process.ts";
