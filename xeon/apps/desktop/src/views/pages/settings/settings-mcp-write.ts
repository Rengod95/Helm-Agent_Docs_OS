import type { McpServerDef } from "@fresnel/contracts/capabilities";
import type { Commands } from "../../commands.ts";
import { fileTextWithTable, tableWithServer, userTableOf } from "./settings-mcp-model.ts";
import { commandErrorRefOf, type MsgRef } from "./settings-mcp-text.ts";

// 설정 "MCP 서버" 구역의 서버 정의 쓰기(W-15). 화면 상태 없이 명령만 쓴다.

/** 저장과 지우기가 쓰는 서버 한 칸. `previousId`가 없으면 새 서버다 */
export interface ServerChange {
  readonly previousId: string | null;
  readonly id: string;
  readonly def: McpServerDef | null;
}

/**
 * 사용자 설정 파일을 읽어 서버 표의 한 서버만 바꾸고 읽은 해시(`baseSha256`)로 다시 쓴다. 읽은 뒤 다른 쪽이 파일을 고쳤으면
 * 덮어쓰지 않고 충돌 글을 돌려준다. 실패하면 글을 돌려주고, 성공하면 `null`이다
 */
export async function persistServer(
  commands: Commands,
  change: ServerChange,
): Promise<MsgRef | null> {
  const target: { readonly scope: "user"; readonly threadId: null } = {
    scope: "user",
    threadId: null,
  };
  const read = await commands.settings.readFile(target);
  if (!read.ok) return commandErrorRefOf(read.error);
  const table = userTableOf(read.value.text);
  if (!table.ok) {
    return table.error === "unreadable"
      ? { id: "desktop.settings.mcp.error.tableUnreadable" }
      : { id: "desktop.settings.mcp.error.tableInvalid" };
  }
  const text = fileTextWithTable(read.value.text, tableWithServer(table.value, change));
  if (!text.ok) return { id: "desktop.settings.mcp.error.tableUnreadable" };
  const written = await commands.settings.writeFile({
    ...target,
    text: text.value,
    baseSha256: read.value.sha256,
  });
  if (written.ok) return null;
  return written.error.kind === "conflict"
    ? { id: "desktop.settings.mcp.error.conflict" }
    : commandErrorRefOf(written.error);
}
