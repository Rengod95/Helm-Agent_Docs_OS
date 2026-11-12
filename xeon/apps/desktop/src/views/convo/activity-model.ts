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

/** 머리 문장에 이을 범주 조각의 상한. 넘으면 앞 두 조각 뒤에 "외 N가지"로 줄인다(DP-154: 머리는 한 줄로 읽힌다) */
const SUMMARY_PIECES = 3;

/** 끝난 묶음의 머리 문장: "app.ts, model.ts 읽음 · 명령 2개 실행함". 범주가 셋을 넘으면 "… · 외 N가지" */
export function activitySummaryOf(calls: readonly ActivityCall[]): string {
  const grouped = groupToolCalls(
    calls.map((c) => ({ toolName: c.name, args: c.args, mcpServer: c.server })),
  );
  const names = readNamesOf(calls);
  const pieces = grouped.counts.map((c) => pieceOf(c.category, c.count, c.distinct, names));
  if (pieces.length <= SUMMARY_PIECES) return pieces.join(" · ");
  const shown = pieces.slice(0, SUMMARY_PIECES - 1);
  return [...shown, t("desktop.convo.group.more", { count: pieces.length - shown.length })].join(
    " · ",
  );
}

/** 묶음 머리의 곁 정보 한 조각. 실패 조각만 위험 글자색이다 */
export type GroupMetaPiece = { readonly text: string; readonly tone: "danger" | null };

/**
 * 묶음 머리의 문장과 곁 정보(DP-154). 상태는 머리에서 한 번만 말하고 줄에는 작은 표시 하나만 둔다.
 * - 한 번에 부른 묶음(호출 여럿이 한 단계, `steps === 1`): 도는 동안 "도구 N개를 한 번에 부르는 중", 끝나면 무엇을 했는지의 요약
 * - 차례로 부른 묶음: 도는 동안 지금 도는 도구의 현재형 동사(`currentVerb`), 끝나면 같은 요약
 * 곁 정보: 도는 동안 "K개 실행 중 · F개 실패 · S초", 끝나면 "N개 한 번에"(한 단계) 또는 "N단계" + 실패 수. 같은 수를 두 번 말하지 않는다
 */
export function groupHeadOf(input: {
  readonly calls: readonly ActivityCall[];
  readonly steps: number;
  readonly pending: number;
  readonly failed: number;
  readonly live: boolean;
  readonly seconds: number;
  readonly currentVerb: string | null;
}): { readonly title: string; readonly meta: readonly GroupMetaPiece[] } {
  const count = input.calls.length;
  const parallel = input.steps === 1 && count > 1;
  const failed: GroupMetaPiece[] =
    input.failed > 0
      ? [{ text: t("desktop.convo.group.failed", { count: input.failed }), tone: "danger" }]
      : [];
  if (input.live) {
    const title =
      parallel || input.currentVerb === null
        ? t("desktop.convo.group.parallelLive", { count })
        : input.currentVerb;
    const progress: GroupMetaPiece[] = parallel
      ? [{ text: t("desktop.convo.group.running", { count: input.pending }), tone: null }]
      : [{ text: t("desktop.convo.group.meta", { count: input.steps }), tone: null }];
    const time: GroupMetaPiece[] =
      input.seconds > 0
        ? [{ text: t("desktop.convo.group.seconds", { seconds: input.seconds }), tone: null }]
        : [];
    return { title, meta: [...progress, ...failed, ...time] };
  }
  const shape: GroupMetaPiece = parallel
    ? { text: t("desktop.convo.group.parallel", { count }), tone: null }
    : { text: t("desktop.convo.group.meta", { count: input.steps }), tone: null };
  return { title: activitySummaryOf(input.calls), meta: [shape, ...failed] };
}

/** 실패 줄의 한 줄 요약: 결과 글의 첫 빈 줄 아닌 줄(DP-154). 접힌 실패 줄 아래에 둔다 */
export function failureLineOf(output: string): string | null {
  const line = output
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part !== "");
  return line === undefined ? null : line;
}
