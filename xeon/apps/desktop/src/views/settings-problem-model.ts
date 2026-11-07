// 읽지 못한 설정 파일의 문구 조각(`host.status.settingsProblems`, F wire §3.3.1). 띠 그림은 `settings-problem-banner.tsx`가 그린다.
// 파일 내용과 값은 wire에 없어서 여기서도 다루지 않는다. 위치는 JSON 문법 오류의 줄과 칸이고, 없으면 이유 글을 쓴다.
import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { SettingsFileProblem } from "@fresnel/contracts/wire";
import { shortenHome } from "./pages/settings/settings-file-paths.ts";

/** 띠에 보이는 문구 조각. 본문은 `desktop.settings.problem.location`이 "경로 (위치나 이유)" 꼴로 묶는다 */
export interface SettingsProblemText {
  /** 홈을 `~`로 줄인 파일 경로 */
  readonly path: string;
  /** 줄과 칸이 있으면 "3줄 5칸", 없으면 이유 글(JSON 문법 오류, JSON 객체가 아님, 읽기 실패: 코드) */
  readonly where: string;
}

/**
 * 문제 목록에서 띠에 보일 첫 문제. 지금은 사용자 범위 파일 하나만 실리므로 첫 항목으로 충분하다.
 * 문제가 없으면 null이다.
 */
export function firstSettingsProblemOf(
  problems: readonly SettingsFileProblem[],
): SettingsFileProblem | null {
  return problems[0] ?? null;
}

/** 문제 하나를 문구 조각으로 바꾼다. 줄과 칸이 모두 있으면 위치 글을, 아니면 이유 글을 쓴다 */
export function settingsProblemTextOf(problem: SettingsFileProblem): SettingsProblemText {
  return { path: shortenHome(problem.path), where: whereOf(problem) };
}

function whereOf(problem: SettingsFileProblem): string {
  if (problem.line !== null && problem.column !== null) {
    return t("desktop.settings.problem.where", { line: problem.line, column: problem.column });
  }
  switch (problem.reason) {
    case "invalid_json":
      return t("desktop.settings.problem.reason.invalidJson");
    case "not_object":
      return t("desktop.settings.problem.reason.notObject");
    case "unreadable":
      return t("desktop.settings.problem.reason.unreadable", {
        code: problem.code ?? t("desktop.settings.problem.codeUnknown"),
      });
    default:
      return assertNever(problem.reason, "SettingsFileProblem.reason");
  }
}
