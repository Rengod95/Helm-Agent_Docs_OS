import type { LoaderFs } from "@xeon/contracts/extensions";

/**
 * `.mcp.json`을 읽는 포트. `readText`는 없으면 null이고, `exists`는 내용을 읽지 않고 있는지만 본다(신뢰되지 않은
 * 프로젝트에서 진단을 남기는 데 쓴다). `LoaderFs`의 부분형이라 L0.os 구현을 그대로 쓴다.
 */
export type McpFileReader = Pick<LoaderFs, "readText" | "exists">;
