import type { MessageArgs, MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { McpBlockedReason, McpServerState } from "@fresnel/contracts/capabilities";
import type { CommandError } from "../../commands.ts";
import type {
  DraftIssue,
  HiddenReasonKind,
  LocationNote,
  SourceChip,
  StatusChip,
} from "./settings-mcp-model.ts";

// 설정 "MCP 서버" 구역의 문장 고르기. 문장은 메시지 키와 인자로 들고 있다가 그릴 때 `t()`로 만든다.

/** 메시지 키와 인자. `t(id, args)`로 푼다 */
export interface MsgRef {
  readonly id: MessageId;
  readonly args?: MessageArgs;
}

const STATE_ID: Readonly<Record<McpServerState, MessageId>> = {
  connected: "desktop.settings.mcp.state.connected",
  connecting: "desktop.settings.mcp.state.connecting",
  reconnecting: "desktop.settings.mcp.state.reconnecting",
  failed: "desktop.settings.mcp.state.failed",
  disabled: "desktop.settings.mcp.state.disabled",
  blocked: "desktop.settings.mcp.state.blocked",
};

/** 상태 칩의 글. 항상 끄기로 차단한 서버는 "차단됨"이다 */
export function chipIdOf(chip: StatusChip): MessageId {
  return chip === "alwaysBlocked" ? "desktop.settings.mcp.state.alwaysBlocked" : STATE_ID[chip];
}

/** 상태 칩의 색. 차단됨은 경고다 */
export function chipToneOf(chip: StatusChip): ReturnType<typeof stateToneOf> {
  return chip === "alwaysBlocked" ? "warning" : stateToneOf(chip);
}

/** 상태 칩의 색. 연결됨은 성공, 실패는 위험, 막힘은 경고다 */
function stateToneOf(state: McpServerState): "success" | "danger" | "warning" | "info" | "neutral" {
  switch (state) {
    case "connected":
      return "success";
    case "failed":
      return "danger";
    case "blocked":
      return "warning";
    case "connecting":
    case "reconnecting":
      return "info";
    case "disabled":
      return "neutral";
    default:
      return assertNever(state, "McpServerState");
  }
}

const BLOCKED_ID: Readonly<Record<McpBlockedReason, MessageId>> = {
  approval_required: "desktop.settings.mcp.blocked.approvalRequired",
  denied_by_policy: "desktop.settings.mcp.blocked.deniedByPolicy",
  not_in_allowlist: "desktop.settings.mcp.blocked.notInAllowlist",
  managed_only: "desktop.settings.mcp.blocked.managedOnly",
  untrusted_project: "desktop.settings.mcp.blocked.untrustedProject",
  sandbox_unavailable: "desktop.settings.mcp.blocked.sandboxUnavailable",
};

/** 막힌 사유의 한 줄 글 */
export function blockedIdOf(reason: McpBlockedReason): MessageId {
  return BLOCKED_ID[reason];
}

const HIDDEN_ID: Readonly<Record<HiddenReasonKind, MessageId>> = {
  name_conflict: "desktop.settings.mcp.hidden.nameConflict",
  denied: "desktop.settings.mcp.hidden.denied",
  not_allowed: "desktop.settings.mcp.hidden.notAllowed",
  name_invalid: "desktop.settings.mcp.hidden.nameInvalid",
  schema_invalid: "desktop.settings.mcp.hidden.schemaInvalid",
  other: "desktop.settings.mcp.hidden.other",
};

/** 숨은 도구 사유의 글 */
export function hiddenIdOf(kind: HiddenReasonKind): MessageId {
  return HIDDEN_ID[kind];
}

/** 출처 칩의 글. 확장은 이름을 인자로 준다 */
export function sourceRefOf(chip: SourceChip): MsgRef {
  switch (chip.kind) {
    case "mcpjson":
      return { id: "desktop.settings.mcp.source.mcpjson" };
    case "settings":
      return { id: "desktop.settings.mcp.source.settings" };
    case "extension":
      return { id: "desktop.settings.mcp.source.extension", args: { name: chip.name } };
    default:
      return assertNever(chip, "SourceChip");
  }
}

/** 고치는 곳 안내(정보 아이콘 뒤). `null`이면 안내가 없다 */
export function locationIdOf(note: LocationNote): MessageId | null {
  switch (note) {
    case "mcpjson":
      return "desktop.settings.mcp.location.mcpjson";
    case "extension":
      return "desktop.settings.mcp.location.extension";
    case "readonly":
      return "desktop.settings.mcp.location.readonly";
    case null:
      return null;
    default:
      return assertNever(note, "LocationNote");
  }
}

const DRAFT_ISSUE_ID: Readonly<Record<DraftIssue, MessageId>> = {
  id: "desktop.settings.mcp.issue.id",
  idTaken: "desktop.settings.mcp.issue.idTaken",
  title: "desktop.settings.mcp.issue.nameLength",
  command: "desktop.settings.mcp.issue.command",
  url: "desktop.settings.mcp.issue.url",
  envName: "desktop.settings.mcp.issue.envName",
  envDuplicate: "desktop.settings.mcp.issue.envDuplicate",
  headerName: "desktop.settings.mcp.issue.headerName",
  headerDuplicate: "desktop.settings.mcp.issue.headerDuplicate",
};

/** 폼 입력 문제의 글 */
export function draftIssueIdOf(issue: DraftIssue): MessageId {
  return DRAFT_ISSUE_ID[issue];
}

/**
 * 명령 실패의 글. 호스트가 준 문장(`detail`)이 있으면 그것을 그대로 보인다(설정 화면의 값 검사 문장과 같다).
 * 없으면 실패 종류의 글이다.
 */
export function commandErrorRefOf(error: CommandError): MsgRef {
  switch (error.kind) {
    case "offline":
      return { id: "desktop.settings.offline" };
    case "unsupported":
      return { id: "desktop.settings.mcp.error.unsupported" };
    case "switching":
      return { id: "desktop.settings.mcp.error.switching" };
    case "locked":
      return { id: "desktop.settings.mcp.error.locked" };
    case "rejected":
      return error.detail === undefined
        ? { id: "desktop.settings.mcp.error.failed" }
        : { id: "desktop.settings.mcp.error.detail", args: { detail: error.detail } };
    case "failed":
      return { id: "desktop.settings.mcp.error.failed" };
    default:
      return assertNever(error, "CommandError");
  }
}
