import { assertNever } from "@fresnel/contracts";
import { t } from "@fresnel/client/i18n";
import type { JsonObject } from "@fresnel/contracts/conversation";
import {
  groupToolCalls,
  summarizeToolArgs,
  type ToolCategory,
} from "../../state/engine/tool-summary.ts";

// 활동 묶음 머리 문장(dzT2a 시안 6절). 순수 함수이고 화면 없이 시험한다.
// 개수만 말하지 않는다: 읽은 파일이 둘 이하면 이름을 그대로 쓴다("app.ts, model.ts 읽음"). 도는 동안은 현재형이다.

export type ActivityCall = {
  readonly name: string;
  readonly args: JsonObject;
  readonly server: string | null;
};

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p !== "");
  return parts.at(-1) ?? path;
}

/** read 범주의 파일 이름(처음 나온 순서, 고유) */
function readNamesOf(calls: readonly ActivityCall[]): readonly string[] {
  const seen = new Set<string>();
  for (const call of calls) {
    const summary = summarizeToolArgs(call.name, call.args, call.server);
    if (summary.kind === "read" && call.name === "read") seen.add(baseName(summary.path));
  }
  return [...seen];
}

function pieceOf(
  category: ToolCategory,
  count: number,
  distinct: number | null,
  names: readonly string[],
): string {
  switch (category) {
    case "read":
      if (names.length > 0 && names.length <= 2)
        return t("desktop.convo.group.readNames", { names: names.join(", ") });
      return t("desktop.convo.group.read", {
        count: distinct === null || distinct === 0 ? count : distinct,
      });
    case "search":
      return t("desktop.convo.group.search", { count });
    case "command":
      return t("desktop.convo.group.command", { count });
    case "edit":
      return t("desktop.convo.group.edit", {
        count: distinct === null || distinct === 0 ? count : distinct,
      });
    case "write":
      return t("desktop.convo.group.write", {
        count: distinct === null || distinct === 0 ? count : distinct,
      });
    case "web":
      return t("desktop.convo.group.web", { count });
    case "agent":
      return t("desktop.convo.group.agent", { count });
    case "tasks":
      return t("desktop.convo.group.tasks", { count });
    case "memory":
      return t("desktop.convo.group.memory", { count });
    case "mcp":
      return t("desktop.convo.group.mcp", { count });
    case "other":
      return t("desktop.convo.group.other", { count });
    default:
      return assertNever(category, "ToolCategory");
  }
}

/** 끝난 묶음의 머리 문장: "app.ts, model.ts 읽음 · 명령 2개 실행함" */
export function activitySummaryOf(calls: readonly ActivityCall[]): string {
  const grouped = groupToolCalls(
    calls.map((c) => ({ toolName: c.name, args: c.args, mcpServer: c.server })),
  );
  const names = readNamesOf(calls);
  return grouped.counts.map((c) => pieceOf(c.category, c.count, c.distinct, names)).join(" · ");
}
