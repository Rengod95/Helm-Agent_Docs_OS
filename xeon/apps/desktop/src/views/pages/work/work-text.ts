import { assertNever } from "@fresnel/contracts";
import type { MessageId } from "@fresnel/client/i18n";
import type { CommandError } from "../../commands.ts";

// 목표와 작업 화면의 문장 고르기. 연결이나 host 오류(`CommandError`)를 화면 문장 id로 바꾼다.

export function commandErrorIdOf(error: CommandError): MessageId {
  switch (error.kind) {
    case "offline":
      return "desktop.offline.hint";
    case "unsupported":
      return "desktop.work.command.unsupported";
    case "switching":
      return "desktop.approvals.failure.switching";
    case "locked":
      return "desktop.work.command.locked";
    case "rejected":
    case "failed":
      return "desktop.work.command.failed";
    default:
      return assertNever(error, "CommandError");
  }
}
