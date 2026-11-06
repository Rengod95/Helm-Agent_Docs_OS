import { t } from "@fresnel/client/i18n";
import { parseJson } from "@fresnel/contracts";

// 제작 대화의 `authoring_*` 도구 행을 사람 말로 줄이는 순수 값(L3.authoring.spec §3.2). 이름은 단계 이름이고, 요약은 결과에서 읽은 숫자와 상태다.
// 내부 도구 이름과 인자 JSON을 그대로 보이지 않는다. 결과가 아직 없으면(실행 중) 단계 이름만 말한다.

export interface AuthoringRowText {
  readonly name: string;
  readonly detail: string;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function countOf(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function reportErrorCount(report: unknown): number {
  const issues = recordOf(report)?.["issues"];
  if (!Array.isArray(issues)) return 0;
  return issues.filter((issue) => recordOf(issue)?.["severity"] === "error").length;
}

function failureText(result: Record<string, unknown>): string | null {
  if (result["ok"] !== false) return null;
  const kind = recordOf(result["error"])?.["kind"];
  if (kind === "needs_folder") return t("desktop.item.authoring.needsFolder");
  if (kind === "session_open") return t("desktop.item.authoring.sessionOpen");
  if (kind === "awaiting_confirmation") return t("desktop.item.authoring.awaitingConfirm");
  return null;
}

/** 이 도구 이름이 제작 도구가 아니면 null. `output`은 결과 글(JSON)이고 없으면 아직 끝나지 않은 호출이다 */
export function authoringRowOf(
  toolName: string,
  output: string | undefined,
): AuthoringRowText | null {
  const name = NAMES[toolName];
  if (name === undefined) return null;
  const label = t(name);
  if (output === undefined) return { name: label, detail: "" };
  const parsed = parseJson(output);
  const result = parsed.ok ? recordOf(parsed.value) : null;
  if (result === null) return { name: label, detail: "" };
  const failed = failureText(result);
  if (failed !== null) return { name: label, detail: failed };
  return { name: label, detail: summaryOf(toolName, result) };
}

type Summary = (result: Record<string, unknown>) => string;

const confirmOrDone: Summary = (result) =>
  result["status"] === "awaiting_confirmation"
    ? t("desktop.item.authoring.awaitingConfirm")
    : result["ok"] === true
      ? t("desktop.item.authoring.done")
      : "";

const SUMMARIES: Readonly<Record<string, Summary>> = {
  authoring_kinds: (result) => {
    const count = countOf(result["kinds"]);
    return count === null ? "" : t("desktop.item.authoring.kinds", { count });
  },
  authoring_start: (result) => (result["ok"] === true ? t("desktop.item.authoring.started") : ""),
  authoring_compose: (result) =>
    result["saved"] === true
      ? t("desktop.item.authoring.composeSaved")
      : t("desktop.item.authoring.composeFailed", { count: reportErrorCount(result["report"]) }),
  authoring_scaffold: (result) => {
    const count = countOf(result["files"]);
    return count === null ? "" : t("desktop.item.authoring.scaffold", { count });
  },
  authoring_validate: (result) =>
    result["ok"] === true
      ? t("desktop.item.authoring.validatePassed")
      : t("desktop.item.authoring.validateFailed", { count: reportErrorCount(result["report"]) }),
  authoring_stop: (result) =>
    result["status"] === "closed"
      ? t("desktop.item.authoring.stopped")
      : t("desktop.item.authoring.noSession"),
  authoring_trial: confirmOrDone,
  authoring_package: confirmOrDone,
  authoring_install: confirmOrDone,
  authoring_replay: (result) =>
    result["ok"] === true
      ? t("desktop.item.authoring.replayPassed")
      : t("desktop.item.authoring.replayFailed"),
};

function summaryOf(toolName: string, result: Record<string, unknown>): string {
  return SUMMARIES[toolName]?.(result) ?? "";
}

const NAMES: Readonly<Record<string, Parameters<typeof t>[0]>> = {
  authoring_kinds: "desktop.item.authoring.name.kinds",
  authoring_start: "desktop.item.authoring.name.start",
  authoring_compose: "desktop.item.authoring.name.compose",
  authoring_scaffold: "desktop.item.authoring.name.scaffold",
  authoring_validate: "desktop.item.authoring.name.validate",
  authoring_trial: "desktop.item.authoring.name.trial",
  authoring_replay: "desktop.item.authoring.name.replay",
  authoring_package: "desktop.item.authoring.name.package",
  authoring_install: "desktop.item.authoring.name.install",
  authoring_stop: "desktop.item.authoring.name.stop",
};
