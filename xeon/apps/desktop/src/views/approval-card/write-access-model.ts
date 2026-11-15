import type { JsonValue } from "@fresnel/contracts/conversation";
import type { LiveApprovalRequest } from "../../state/engine/input.ts";
import { WRITE_ACCESS_RULE_ID } from "@fresnel/contracts/services";
import type { ToolApprovalBody } from "../approval-form.ts";
import type { ApprovalDecision } from "../commands.ts";

// 샌드박스 밖 쓰기 승인(L2.workspace §4.3.1, DP-204)의 순수 값. 엔진(cap-workspace `write-access-adapter.ts`)이 도구 승인 body에
// `{ subject: "write_access", tool, command?, writePaths, allowRoots, homeWide }`를 싣고 `ruleId`를 `sandbox.write_access`로 둔다.
// 카드는 둘 중 하나만 맞아도 이 종류로 그린다(옛 일반 도구 카드로 떨어지지 않게). 값 모양이 어긋난 칸은 빈 값으로 읽는다.

/** 막힌 쓰기를 낸 도구. 엔진이 모르는 값을 보내면 "other"이고 도구 이름을 그대로 보인다 */
export type WriteAccessTool = "bash" | "write" | "edit" | "other";

export type WriteAccessView = {
  readonly tool: WriteAccessTool;
  /** 도구 이름(원문). tool이 other일 때 보인다 */
  readonly toolName: string;
  /** bash 명령 원문. 없으면 null */
  readonly command: string | null;
  /** 막힌 경로들 */
  readonly writePaths: readonly string[];
  /** 허용하면 쓰기가 열리는 루트들 */
  readonly allowRoots: readonly string[];
  /** 홈 폴더 전체가 허용 범위에 든다 */
  readonly homeWide: boolean;
  /** allowRoots 가운데 홈 폴더로 보이는 것. homeWide가 아니거나 고를 수 없으면 null */
  readonly homeRoot: string | null;
  /** 요청이 "이 대화에서 계속 허용"(remember thread)을 제안했다 */
  readonly offersThread: boolean;
};

/** 인자가 본문을 실은 객체면 그 객체, 별도 저장소 참조(BlobRef)면 빈 객체 */
function argsOf(body: ToolApprovalBody): Readonly<Record<string, JsonValue>> {
  const { args } = body;
  return "sha256" in args && args["type"] === "blob" ? {} : args;
}

function stringsOf(value: JsonValue | undefined): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item !== "");
}

const HOME_LIKE = /^(?:\/Users\/[^/]+|\/home\/[^/]+|\/root|[A-Za-z]:\\Users\\[^\\]+)[/\\]?$/;

/** 이 도구 승인이 샌드박스 밖 쓰기 승인인가 */
export function isWriteAccessTool(body: ToolApprovalBody): boolean {
  if (body.ruleId === WRITE_ACCESS_RULE_ID) return true;
  return argsOf(body)["subject"] === "write_access";
}

/** 샌드박스 밖 쓰기 승인이면 그 값, 아니면 null */
export function writeAccessViewOf(request: LiveApprovalRequest): WriteAccessView | null {
  const { body } = request;
  if (body.kind !== "tool" || !isWriteAccessTool(body.tool)) return null;
  const args = argsOf(body.tool);
  const named = args["tool"];
  const tool: WriteAccessTool =
    named === "bash" || named === "write" || named === "edit" ? named : "other";
  const command = args["command"];
  const allowRoots = stringsOf(args["allowRoots"]);
  const homeWide = args["homeWide"] === true;
  const homeRoot = homeWide
    ? (allowRoots.find((root) => HOME_LIKE.test(root)) ??
      (allowRoots.length === 1 ? (allowRoots[0] ?? null) : null))
    : null;
  return {
    tool,
    toolName: typeof named === "string" && named !== "" ? named : body.tool.toolName,
    command: typeof command === "string" && command !== "" ? command : null,
    writePaths: stringsOf(args["writePaths"]),
    allowRoots,
    homeWide,
    homeRoot,
    offersThread: request.remember.includes("thread"),
  };
}

/** 접힌 카드에 보이는 경로 수. 넘으면 "외 N개"다 */
export const WRITE_PATHS_FOLDED = 3;
/** 이 글자 수를 넘는 경로는 접힌 카드에서 잘린다고 보고 "전체 보기"를 둔다(좁은 폭은 화면이 넘침을 재어 더한다) */
const WRITE_PATH_CHARS = 64;
/** 접힌 카드의 명령 한 줄 최대 글자 수(이보다 길거나 여러 줄이면 펼침 단추가 생긴다) */
const WRITE_COMMAND_CHARS = 72;

/**
 * 경로를 폴더 부분과 마지막 이름으로 나눈다(폴더 부분은 끝 구분자까지). 화면은 폴더 부분만 줄여(말줄임) 마지막 이름이 늘 보이게 한다.
 * 구분자가 없거나 끝이 구분자면 dir은 빈 글이다
 */
export function pathPartsOf(path: string): { readonly dir: string; readonly base: string } {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (cut < 0 || cut === path.length - 1) return { dir: "", base: path };
  return { dir: path.slice(0, cut + 1), base: path.slice(cut + 1) };
}

/** 글자 수로 보아 접힌 카드에서 잘리는 것이 있는가(펼침 단추를 둘지). 폭 때문에 잘리는 것은 화면이 따로 잰다 */
export function writeAccessFoldsOf(view: WriteAccessView): boolean {
  const longPath = [...view.writePaths, ...view.allowRoots].some(
    (path) => path.length > WRITE_PATH_CHARS,
  );
  const longCommand =
    view.command !== null &&
    (view.command.length > WRITE_COMMAND_CHARS || view.command.includes("\n"));
  return view.writePaths.length > WRITE_PATHS_FOLDED || longPath || longCommand;
}

/**
 * 세 선택지의 답(dzSx 2차, 사용자 결정 2026-11-13): 이번만 허용은 allow + once(주 동작, Y), 이 대화에서 계속 허용은 allow + thread,
 * 거부는 deny(N). 요청이 thread를 제안하지 않으면 thread는 null이고 단추를 그리지 않는다
 */
export function writeAccessDecisionsOf(view: WriteAccessView): {
  readonly once: ApprovalDecision;
  readonly thread: ApprovalDecision | null;
  readonly deny: ApprovalDecision;
} {
  return {
    once: { decision: "allow", remember: "once" },
    thread: view.offersThread ? { decision: "allow", remember: "thread" } : null,
    deny: { decision: "deny" },
  };
}
