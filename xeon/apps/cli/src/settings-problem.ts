import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { SettingsFileProblem } from "@fresnel/contracts/wire";

// 읽지 못한 설정 파일(`host.status.settingsProblems`, F wire §3.3.1)을 CLI 문구로 바꾼다. wire에는 파일 값과 원문이 없어서
// 여기서도 값은 다루지 않는다. `config get`·`config list`의 경고와 `doctor`의 `settings.file` 항목이 함께 쓴다.

/** 줄과 칸이 있으면 " (N줄 M칸)" 꼴의 위치 문구다. 없으면 빈 문자열이다 */
export function settingsProblemWhere(problem: SettingsFileProblem): string {
  if (problem.line === null || problem.column === null) return "";
  return t("cli.config.fileProblem.where", { line: problem.line, column: problem.column });
}

/** 이유 문구. 읽기 오류는 OS 오류 코드를 붙인다 */
export function settingsProblemReason(problem: SettingsFileProblem): string {
  switch (problem.reason) {
    case "invalid_json":
      return t("cli.config.fileProblem.reason.invalidJson");
    case "not_object":
      return t("cli.config.fileProblem.reason.notObject");
    case "unreadable":
      return t("cli.config.fileProblem.reason.unreadable", {
        code: problem.code ?? t("cli.errors.common.unknown"),
      });
    default:
      return assertNever(problem.reason, "SettingsFileProblem.reason");
  }
}
