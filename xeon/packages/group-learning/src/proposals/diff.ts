import { assertNever } from "@xeon/contracts";
import type { ProposalOp } from "./proposal.ts";
import { parsePatchEdits } from "./target.ts";

const DIFF_MAX = 200_000;

function prefixed(sign: "+" | "-", text: string): string {
  return text
    .split("\n")
    .map((line) => `${sign} ${line}`)
    .join("\n");
}

/**
 * 표시용 diff(순수 함수). create·add·add_file은 빈 기준에 대한 diff다. patch는 치환 목록을, replace는 새 항목 본문을,
 * remove는 지우려는 항목 본문을 보인다. 길이가 상한을 넘으면 자른다
 */
export function renderDiff(op: ProposalOp, target: string, body: string): string {
  const text = renderBody(op, target, body);
  return text.length > DIFF_MAX ? text.slice(0, DIFF_MAX) : text;
}

function renderBody(op: ProposalOp, target: string, body: string): string {
  switch (op) {
    case "create":
    case "add":
    case "add_file":
      return prefixed("+", body);
    case "replace":
      return `@@ replace ${target}\n${prefixed("+", body)}`;
    case "remove":
      return `@@ remove ${target}\n${prefixed("-", body)}`;
    case "archive":
      return `@@ archive ${target}`;
    case "patch": {
      const edits = parsePatchEdits(body);
      if (!edits.ok) return prefixed("+", body);
      return edits.value
        .map(
          (edit, index) =>
            `@@ edit ${String(index + 1)}\n${prefixed("-", edit.oldText)}\n${prefixed("+", edit.newText)}`,
        )
        .join("\n");
    }
    default:
      return assertNever(op, "ProposalOp");
  }
}
