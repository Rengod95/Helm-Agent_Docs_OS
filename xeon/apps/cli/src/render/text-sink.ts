import { assertNever } from "@xeon/contracts";
import { sequentially } from "../util.ts";
import type { RenderOp } from "./model.ts";

// L4.cli.spec §3.5 RenderSink(text), §4.2, §4.5. 제어 문자 없는 줄 출력이다(print 모드, 비TTY). color가 참일 때만 ANSI를 쓴다.
// print 모드의 stdout은 응답 텍스트뿐이다(§3.1 "응답 텍스트를 stdout에 쓴다"). 도구 호출·결과·알림은 stderr로 보낸다.
// 대화형(full)은 모두 stdout이다.

export interface RenderSink {
  write(ops: readonly RenderOp[]): Promise<void>;
  close(): Promise<void>;
}

export type TextSinkLayout = "print" | "full";

export interface TextSinkOptions {
  readonly stdout: (text: string) => Promise<void>;
  readonly stderr: (text: string) => Promise<void>;
  readonly layout: TextSinkLayout;
  /** 참이면 ANSI 색을 쓴다. 비TTY·NO_COLOR·TERM=dumb이면 거짓이어야 한다 */
  readonly color: boolean;
}

interface Piece {
  readonly target: "stdout" | "stderr";
  readonly text: string;
}

const ESC = String.fromCodePoint(27);

function paint(color: boolean, code: string, text: string): string {
  return color ? `${ESC}[${code}m${text}${ESC}[0m` : text;
}

function indent(lines: readonly string[]): string {
  return lines.map((line) => `  ${line}`).join("\n");
}

const REMEMBER_TEXT: Readonly<Record<"once" | "thread" | "always", string>> = {
  once: "이번만 허용",
  thread: "이 세션 동안 허용",
  always: "항상 허용",
};

/**
 * 승인이 끝났을 때 사용자가 알아야 하는 사실(L1.tools.spec 동의 표시 요건, G2-10). 사용자가 직접 답했고 요청한 범위 그대로 적용됐으면 없다.
 * - 요청한 기억 범위와 적용한 범위가 다르면(예: 항상 허용이 이 세션 동안으로 낮춰짐) 낮춰 적용했음을 알린다.
 * - 사용자 응답이 아닌 해결(만료, 비대화 자동 처리, turn 취소, 다른 요청으로 대체)은 그 이유를 알린다
 */
function resolutionNotice(op: Extract<RenderOp, { kind: "approvalResolved" }>): string | undefined {
  const lines: string[] = [];
  switch (op.resolvedBy) {
    case "user":
      break;
    case "expired":
      lines.push("승인 요청이 만료되어 정해 둔 대로 처리했다");
      break;
    case "noninteractive":
      lines.push("대화형 입력이 없어 승인 요청을 자동으로 처리했다");
      break;
    case "cancelled":
      lines.push("turn이 취소되어 승인 요청을 닫았다");
      break;
    case "superseded":
      lines.push("다른 요청으로 대체되어 승인 요청을 닫았다");
      break;
    default:
      return assertNever(op.resolvedBy, "ApprovalResolvedBy");
  }
  if (op.requestedRemember !== null && op.requestedRemember !== op.remember) {
    lines.push(
      `${REMEMBER_TEXT[op.requestedRemember]}을 골랐지만 ${REMEMBER_TEXT[op.remember]}으로 낮춰 적용했다`,
    );
  }
  return lines.length === 0 ? undefined : lines.join("\n");
}

/** RenderOp 하나를 쓸 조각으로 바꾼다. 그리지 않는 op는 undefined다. 순수 함수 */
export function pieceOf(op: RenderOp, layout: TextSinkLayout, color: boolean): Piece | undefined {
  const side = layout === "print" ? "stderr" : "stdout";
  switch (op.kind) {
    case "user":
      return layout === "print"
        ? undefined
        : { target: "stdout", text: `${paint(color, "1", ">")} ${op.text}\n` };
    case "assistant": {
      const lines: string[] = [];
      if (op.thinking !== null && layout === "full") {
        lines.push(paint(color, "2", `(생각) ${op.thinking.split("\n")[0] ?? ""}`));
      }
      if (op.markdown.length > 0) lines.push(op.markdown);
      return { target: "stdout", text: `${lines.join("\n")}\n` };
    }
    case "toolCall":
      return {
        target: side,
        text: `${paint(color, "2", `● ${op.view.toolName}`)} ${paint(color, "2", op.view.argsSummary)}\n`,
      };
    case "toolResult": {
      const marks: string[] = [];
      if (op.view.isError) marks.push(paint(color, "31", "error"));
      if (op.view.synthesized) marks.push(paint(color, "33", "재개 때 중단됨으로 기록됨"));
      const head = marks.length === 0 ? "" : `[${marks.join(", ")}] `;
      const body = op.view.lines.length === 0 ? [""] : op.view.lines;
      const [first = "", ...more] = body;
      return {
        target: side,
        text: `${paint(color, "2", `  ↳ ${head}${first}`)}${more.length === 0 ? "" : `\n${indent(more.map((line) => paint(color, "2", `  ${line}`)))}`}\n`,
      };
    }
    case "custom":
      return { target: side, text: `${op.text}\n` };
    case "progress":
    case "clearProgress":
      // 진행 줄은 텍스트 출력에 그리지 않는다. 대화형 최소 renderer가 따로 다룬다
      return undefined;
    case "approval":
      return {
        target: "stderr",
        text: `${paint(color, "33", `승인 요청: ${op.view.title}`)}\n${indent(op.view.body)}\n`,
      };
    case "approvalResolved": {
      const notice = resolutionNotice(op);
      return notice === undefined
        ? undefined
        : { target: "stderr", text: `${paint(color, "33", notice)}\n` };
    }
    case "turnEnd":
      if (op.status === "completed") return undefined;
      return {
        target: "stderr",
        text: `${paint(color, "31", op.status === "interrupted" ? "turn이 중단되었다" : "turn이 실패했다")}${op.error === null ? "" : `: ${op.error}`}\n`,
      };
    case "notice":
      return { target: "stderr", text: `${op.text}\n` };
    default:
      return assertNever(op, "RenderOp");
  }
}

export function createTextSink(options: TextSinkOptions): RenderSink {
  return {
    write(ops) {
      return sequentially(ops, async (op) => {
        const piece = pieceOf(op, options.layout, options.color);
        if (piece === undefined) return;
        await (piece.target === "stdout" ? options.stdout(piece.text) : options.stderr(piece.text));
      });
    },
    close() {
      return Promise.resolve();
    },
  };
}
